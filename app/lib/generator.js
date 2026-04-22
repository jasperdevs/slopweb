import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config, shouldTryAiSdk } from './config.js';
import { sendNdjson, readJsonBody } from './http.js';
import { makePrompt, makeSystemPrompt } from './prompts.js';
import { loadAiSdkModel } from './aiSdkProvider.js';
import { makeBuiltInPage, makeLocalGeneratedPage } from './builtinPages.js';
import { normalizeAddress, extractHtmlFromOutput, validateHtmlPagePayload, hardenPagePayload } from './html.js';
import { sleep } from './utils.js';
import { codexStatus } from './codexLauncher.js';
import { saveGeneratedPage } from './pageStore.js';
import { debugTiming, nowMs } from './diagnostics.js';
import { modelGenerationProfile } from './modelProfiles.js';

const CODEX_FIRST_HTML_TIMEOUT_MS = Number(process.env.SLOPWEB_CODEX_FIRST_HTML_TIMEOUT_MS || 5_000);
const CODEX_LOCAL_RACE_DELAY_MS = Number(process.env.SLOPWEB_CODEX_LOCAL_RACE_DELAY_MS || Math.min(2_500, CODEX_FIRST_HTML_TIMEOUT_MS));
const LIVE_READY_CHUNK_MAX = Number(process.env.SLOPWEB_LIVE_READY_CHUNK_MAX || 720);
const CODEX_REPLAY_DELAY_MS = Number(process.env.SLOPWEB_CODEX_REPLAY_DELAY_MS || 12);

export async function generatePage(body) {
  const address = normalizeAddress(body.address || body.url || body.q);
  const builtInPage = makeBuiltInPage(address);
  if (builtInPage) return finalizePage(builtInPage, address);

  if (shouldTryAiSdk()) {
    try { return finalizePage(await generatePageWithAiSdk({ address, history: body.history }), address); }
    catch (error) {
      if (['ai-sdk', 'local'].includes(config.aiProvider)) throw error;
      console.warn(`AI SDK generation failed, falling back to Codex CLI: ${error.message}`);
    }
  }

  const status = await codexStatus();
  if (!status.connected) return finalizePage(authFallbackPage(address, body.history, status), address);

  return finalizePage(await generateWithCodexCapture({ address, history: body.history }), address);
}

export async function handlePageStream(req, res) {
  const startedAt = nowMs();
  const body = await readJsonBody(req);
  const address = normalizeAddress(body.address || body.url || body.q);
  const history = Array.isArray(body.history) ? body.history : [];
  let closed = false;
  const generationAbort = new AbortController();
  res.on('close', () => {
    closed = true;
    generationAbort.abort();
  });

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  let firstChunkSent = false;
  const safeSend = payload => {
    if (closed) return false;
    if (payload?.type === 'chunk' && !firstChunkSent) {
      firstChunkSent = true;
      debugTiming('pageStream.firstChunk', startedAt, { address });
    }
    return sendNdjson(res, payload);
  };
  const waitForDrain = () => {
    if (closed || !res.writableNeedDrain) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        res.off('drain', done);
        res.off('close', done);
        resolve();
      };
      res.once('drain', done);
      res.once('close', done);
    });
  };
  safeSend.waitForDrain = waitForDrain;
  const reveal = async (page, options = {}) => {
    const finalPage = hardenPagePayload(page, address);
    safeSend({ type: 'reset', reason: options.reason || 'document' });
    await streamHtmlChunks(safeSend, finalPage.html, { ...options, shouldStop: () => closed, waitForDrain });
    return saveGeneratedPage(finalPage, address);
  };

  try {
    safeSend({ type: 'start', address, mode: 'self-contained-html', model: shouldStreamLocalFirst() ? config.aiSdkModel : config.codexModel });

    const builtInPage = makeBuiltInPage(address);
    if (builtInPage) {
      const page = await reveal(builtInPage, { minChunk: 160, maxChunk: 620, delayMs: 0, reason: 'built-in' });
      safeSend({ type: 'done', page });
      debugTiming('pageStream.done', startedAt, { address, mode: 'built-in' });
      if (!closed) res.end();
      return;
    }

    safeSend({ type: 'status', text: 'Waiting for generated HTML' });

    if (shouldStreamLocalFirst()) {
      try {
        const page = await streamAiSdkRawHtml({ address, history, safeSend, closedRef: () => closed, signal: generationAbort.signal });
        safeSend({ type: 'done', page: await finalizePage(page, address) });
        debugTiming('pageStream.done', startedAt, { address, mode: 'ai-sdk' });
        if (!closed) res.end();
        return;
      } catch (error) {
        if (closed || error.name === 'AbortError') return;
        if (['ai-sdk', 'local'].includes(config.aiProvider)) throw error;
        console.warn(`AI SDK streaming failed, falling back to Codex CLI: ${error.message}`);
        safeSend({ type: 'status', text: 'AI SDK failed, trying Codex' });
      }
    }

    if (shouldStreamAutoRace()) {
      try {
        const page = await streamAutoRawHtml({ address, history, safeSend, closedRef: () => closed, signal: generationAbort.signal });
        safeSend({ type: 'done', page: await finalizePage(page, address) });
        debugTiming('pageStream.done', startedAt, { address, mode: 'auto-race' });
        if (!closed) res.end();
        return;
      } catch (error) {
        if (closed || error.name === 'AbortError') return;
        safeSend({ type: 'status', text: 'Auto generation failed, trying Codex' });
      }
    }

    try {
      const page = await streamCodexRawHtml({ address, history, safeSend, closedRef: () => closed, signal: generationAbort.signal });
      safeSend({ type: 'done', page: await finalizePage(page, address) });
      debugTiming('pageStream.done', startedAt, { address, mode: 'codex' });
    } catch (error) {
      if (closed || error.name === 'AbortError') return;
      safeSend({ type: 'error', error: error.message || String(error) });
    }

    if (!closed) res.end();
  } catch (error) {
    if (!closed) {
      safeSend({ type: 'error', error: error.message || String(error) });
      res.end();
    }
  }
}

async function finalizePage(page, address) {
  return saveGeneratedPage(hardenPagePayload(page, address), address);
}

function shouldStreamLocalFirst() {
  if (!shouldTryAiSdk()) return false;
  if (['local', 'ai-sdk'].includes(config.aiProvider)) return true;
  return Boolean(config.aiSdkBaseUrl || config.aiSdkModel);
}

function shouldStreamAutoRace() {
  return config.aiProvider === 'auto' && shouldTryAiSdk() && !config.aiSdkBaseUrl && !config.aiSdkModel;
}

const chunkBreakTokens = ['\n', '>', '</style>'];

async function streamHtmlChunks(send, html, options = {}) {
  const text = String(html || '');
  const minChunk = Number(options.minChunk || 64);
  const maxChunk = Number(options.maxChunk || 520);
  const delayMs = Number(options.delayMs || 0);
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
  let index = 0;
  while (index < text.length && !shouldStop()) {
    let nearBreak = -1;
    for (const token of chunkBreakTokens) {
      const breakAt = text.indexOf(token, index + minChunk);
      if (breakAt > -1 && (nearBreak === -1 || breakAt < nearBreak)) nearBreak = breakAt + 1;
    }
    let end = nearBreak > -1 && nearBreak - index <= maxChunk ? nearBreak : index + maxChunk;
    if (end <= index) end = index + maxChunk;
    const chunk = text.slice(index, Math.min(text.length, end));
    index += chunk.length;
    if (send({ type: 'chunk', text: chunk }) === false && typeof options.waitForDrain === 'function') await options.waitForDrain();
    if (delayMs > 0) await sleep(delayMs);
  }
}

function abortError() {
  const error = new Error('Generation was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function htmlStartIndex(text) {
  const markers = [
    /<body[\s>]/i,
    /<(?:main|header|nav|section|article|aside|div|form|h1|h2|p|ul|ol|table)\b/i
  ];
  for (const marker of markers) {
    const index = String(text || '').search(marker);
    if (index >= 0) return index;
  }
  return -1;
}

function readyHtmlLength(text, force = false) {
  const limit = Math.min(text.length, Math.max(220, LIVE_READY_CHUNK_MAX));
  const tagBreak = text.lastIndexOf('>', limit);
  const lineBreak = text.lastIndexOf('\n', limit);
  let end = Math.max(tagBreak, lineBreak) + 1;
  if (end <= 0 && (force || text.length > 256)) end = limit;
  return Math.max(0, end);
}

function emitReadyHtml(send, state, force = false) {
  if (!state.streaming || !state.liveSource) return;
  const optimized = optimizeLiveHtmlOrder(state.liveSource, force);
  if (!optimized.startsWith(state.liveSent)) return;
  const delta = optimized.slice(state.liveSent.length);
  const end = readyHtmlLength(delta, force);
  if (end <= 0) return;
  const chunk = delta.slice(0, end);
  state.liveSent += chunk;
  send({ type: 'chunk', text: chunk });
  return true;
}

function optimizeLiveHtmlOrder(html) {
  let doc = String(html || '');
  const assets = [];
  doc = stripCompleteEarlyAssets(doc, assets);
  doc = stripPartialEarlyAsset(doc);

  const bodyMatch = doc.match(/<body\b[^>]*>/i);
  if (!bodyMatch || typeof bodyMatch.index !== 'number') return doc;

  const bodyStart = bodyMatch.index + bodyMatch[0].length;
  let beforeBody = doc.slice(0, bodyStart);
  let afterBody = doc.slice(bodyStart);
  afterBody = afterBody.replace(/^(\s*)(?:(<style\b[\s\S]*?<\/style\s*>|<script\b[\s\S]*?<\/script\s*>)\s*)+/i, match => {
    return match.match(/^\s*/)?.[0] || '';
  });

  return `${beforeBody}${afterBody}`;
}

function stripCompleteEarlyAssets(doc, assets) {
  const bodyMatch = doc.match(/<body\b[^>]*>/i);
  const limit = bodyMatch && typeof bodyMatch.index === 'number' ? bodyMatch.index : doc.length;
  const before = doc.slice(0, limit).replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, block => {
    assets.push(block);
    return '';
  });
  return `${before}${doc.slice(limit)}`;
}

function stripPartialEarlyAsset(doc) {
  const bodyMatch = doc.match(/<body\b[^>]*>/i);
  if (bodyMatch && typeof bodyMatch.index === 'number') return doc;
  const open = doc.search(/<(style|script)\b/i);
  return open >= 0 ? doc.slice(0, open) : doc;
}

function streamVisibleHtml(send, state) {
  return text => {
    if (!text) return;
    state.raw.push(text);
    if (!state.streaming) {
      state.pending += text;
      const startIndex = htmlStartIndex(state.pending);
      if (startIndex >= 0) {
        state.streaming = true;
        send({ type: 'reset', reason: 'model' });
        state.liveSource = liveHtmlStart(state.pending.slice(startIndex));
        state.pending = '';
        emitReadyHtml(send, state);
      }
      return;
    }
    state.liveSource += text;
    emitReadyHtml(send, state);
  };
}

function liveHtmlStart(html) {
  const text = String(html || '');
  if (/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(text)) return text;
  return `<!doctype html><html><body>${text}`;
}

async function flushVisibleHtml(send, state, options = {}) {
  while (emitReadyHtml(send, state, true)) {
    if (options.delayMs > 0) await sleep(options.delayMs);
  }
}

function localPrompt({ address, history, modelInfo, label }) {
  const prompt = makePrompt({ address, history });
  const profile = modelGenerationProfile({ ...modelInfo, label });
  return profile.promptPrefix ? `${profile.promptPrefix}\n${prompt}` : prompt;
}

function generationOptions(options = {}, profile = {}) {
  const temperature = Number.isFinite(config.aiSdkTemperature) && profile.supportsTemperature !== false
    ? config.aiSdkTemperature
    : undefined;
  return {
    ...options,
    maxOutputTokens: Math.max(400, Math.min(Number(config.maxOutputTokens) || 2_200, 8_000)),
    ...(temperature === undefined ? {} : { temperature }),
    stopSequences: ['</html>'],
    maxRetries: 0
  };
}

async function streamAiSdkRawHtml({ address, history, safeSend, closedRef, signal }) {
  throwIfAborted(signal);

  safeSend({ type: 'status', text: 'Starting local model' });
  const { streamText, model, label, providerOptions, timeout, resolved } = await loadAiSdkModel();
  safeSend({ type: 'status', text: 'Generating page' });

  const state = { raw: [], pending: '', liveSource: '', liveSent: '', streaming: false };
  const push = streamVisibleHtml(safeSend, state);
  const profile = modelGenerationProfile({ ...resolved, label });

  const result = streamText(generationOptions({
    model,
    system: makeSystemPrompt(),
    prompt: localPrompt({ address, history, modelInfo: resolved, label }),
    abortSignal: signal,
    timeout,
    providerOptions
  }, profile));

  for await (const delta of result.textStream) {
    if (closedRef()) throwIfAborted(signal);
    push(delta);
  }

  throwIfAborted(signal);
  await flushVisibleHtml(safeSend, state);
  const page = validateHtmlPagePayload(extractHtmlFromOutput(state.raw.join('')), address, label);
  page.address = address;
  if (!state.streaming) {
    safeSend({ type: 'reset', reason: 'model-final' });
    await streamHtmlChunks(safeSend, page.html, { minChunk: 160, maxChunk: 620, delayMs: 0, shouldStop: () => closedRef(), waitForDrain: () => safeSend.waitForDrain?.() });
  }
  return page;
}

async function generatePageWithAiSdk({ address, history }) {
  const { generateText, model, label, providerOptions, timeout, resolved } = await loadAiSdkModel();
  const profile = modelGenerationProfile({ ...resolved, label });

  const result = await generateText(generationOptions({
    model,
    system: makeSystemPrompt(),
    prompt: localPrompt({ address, history, modelInfo: resolved, label }),
    timeout,
    providerOptions
  }, profile));

  const page = validateHtmlPagePayload(extractHtmlFromOutput(result.text), address, label);
  page.address = address;
  return page;
}

function normalizeReasoningEffort(value) {
  const effort = String(value || 'low').trim().toLowerCase();
  if (['low', 'medium', 'high', 'xhigh'].includes(effort)) return effort;
  return 'low';
}

function codexReasoningEffortsToTry() {
  const requested = normalizeReasoningEffort(config.codexReasoningEffort);
  return [...new Set([requested, 'low', 'medium'])];
}

function isCodexRuntimeConfigError(text) {
  return /tools cannot be used with reasoning\.effort|web_search.*reasoning\.effort|reasoning\.effort.*web_search|unsupported value: ['"]?minimal|minimal.*not supported.*model|supported values are:.*low.*medium.*high/i.test(String(text || ''));
}

function makeCodexArgs(effort, workspace, outputPath = '') {
  const args = [
    'exec',
    '--disable', 'plugins',
    '--disable', 'codex_hooks',
    '--model', config.codexModel,
    '--color', 'never',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--ignore-rules',
    '-c', 'approval_policy=never',
    '-c', 'web_search="disabled"',
    '-c', 'shell_environment_policy.inherit="none"',
    '-c', `model_reasoning_effort="${effort}"`,
    '-c', 'model_reasoning_summary="none"',
    '-c', 'model_verbosity="low"'
  ];
  if (outputPath) args.push('--output-last-message', outputPath);
  args.push('--cd', workspace, '-');
  return args;
}

async function generateWithCodexCapture({ address, history, signal }) {
  const runId = randomUUID();
  const workspace = path.join(os.tmpdir(), `slopweb-${runId}`);
  const outputPath = path.join(workspace, 'page.html');
  throwIfAborted(signal);
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, 'README.txt'), 'Empty throwaway workspace for Slopweb page generation. Do not read local user files.\n');

  const prompt = makePrompt({ address, history });
  let lastErrorText = '';
  try {
    for (const effort of codexReasoningEffortsToTry()) {
      throwIfAborted(signal);
      const { spawnCapture } = await import('./codexLauncher.js');
      const result = await spawnCapture(config.codexBin, makeCodexArgs(effort, workspace, outputPath), { cwd: workspace, stdin: prompt, timeoutMs: config.codexTimeoutMs, signal });
      if (result.killedByAbort) throw abortError();
      if (result.killedByTimeout) throw new Error(`Codex timed out after ${config.codexTimeoutMs}ms.`);
      if (result.code !== 0) {
        lastErrorText = (result.stderr || result.stdout || `Codex exited with code ${result.code}`).trim();
        if (isCodexRuntimeConfigError(lastErrorText)) continue;
        throw new Error(lastErrorText);
      }
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const finalMessage = existsSync(outputPath) ? await readFile(outputPath, 'utf8') : result.stdout;
      const page = validateHtmlPagePayload(extractHtmlFromOutput(finalMessage), address, `${config.codexModel} / ${effort} effort`);
      page.address = address;
      return page;
    }
    throw new Error(lastErrorText || 'Codex rejected every reasoning effort this app tried.');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function streamCodexRawHtml({ address, history, safeSend, closedRef, signal }) {
  safeSend({ type: 'status', text: 'Starting Codex' });
  const codexAbort = new AbortController();
  const localAbort = new AbortController();
  const abortAll = () => {
    codexAbort.abort();
    localAbort.abort();
  };
  if (signal?.aborted) abortAll();
  else signal?.addEventListener?.('abort', abortAll, { once: true });

  let winner = '';
  const chooseWinner = name => {
    if (!winner) {
      winner = name;
      if (name === 'codex') localAbort.abort();
      else codexAbort.abort();
    }
    return winner === name;
  };

  const codexSend = makeRacingSend('codex', safeSend, closedRef, () => winner, chooseWinner);
  const codexRun = streamWithCodexStdout({ address, history, safeSend: codexSend, closedRef, signal: codexAbort.signal });

  let localRun = null;
  const startLocalRun = () => {
    if (localRun) return localRun;
    if (winner || closedRef()) return new Promise(() => {});
    const localSend = makeRacingSend('local', safeSend, closedRef, () => winner, chooseWinner);
    localRun = streamAiSdkRawHtml({ address, history, safeSend: localSend, closedRef, signal: localAbort.signal })
      .then(page => {
        page.model = `${page.model} fallback after slow Codex`;
        return page;
      });
    return localRun;
  };

  try {
    return await firstSuccessfulRun(codexRun, startLocalRun, CODEX_LOCAL_RACE_DELAY_MS);
  } finally {
    signal?.removeEventListener?.('abort', abortAll);
  }
}

async function streamAutoRawHtml({ address, history, safeSend, closedRef, signal }) {
  const localAbort = new AbortController();
  const codexAbort = new AbortController();
  const abortAll = () => {
    localAbort.abort();
    codexAbort.abort();
  };
  if (signal?.aborted) abortAll();
  else signal?.addEventListener?.('abort', abortAll, { once: true });

  const shadowSend = () => true;
  shadowSend.waitForDrain = () => Promise.resolve();
  shadowSend.shadow = true;

  const localRun = streamAiSdkRawHtml({ address, history, safeSend, closedRef, signal: localAbort.signal });
  const codexRun = streamWithCodexStdout({ address, history, safeSend: shadowSend, closedRef, signal: codexAbort.signal });

  try {
    const { name, page } = await firstCompletedPage([
      ['local', localRun],
      ['codex', codexRun]
    ]);
    if (name === 'codex') {
      localAbort.abort();
      safeSend({ type: 'reset', reason: 'codex-final' });
      await streamHtmlChunks(safeSend, page.html, { minChunk: 72, maxChunk: 260, delayMs: 0, shouldStop: () => closedRef(), waitForDrain: () => safeSend.waitForDrain?.() });
    } else {
      codexAbort.abort();
    }
    throwIfAborted(signal);
    return page;
  } finally {
    signal?.removeEventListener?.('abort', abortAll);
  }
}

function makeRacingSend(name, safeSend, closedRef, getWinner, chooseWinner) {
  let pendingReset = null;
  const send = payload => {
    if (closedRef()) return false;
    const winner = getWinner();
    if (winner && winner !== name) return false;
    if (payload?.type === 'reset' && !winner) {
      pendingReset = payload;
      return true;
    }
    if (payload?.type === 'chunk') {
      if (!chooseWinner(name)) return false;
      if (pendingReset) {
        safeSend(pendingReset);
        pendingReset = null;
      }
      return safeSend(payload);
    }
    if (payload?.type === 'status' && !winner) return name === 'codex' ? safeSend(payload) : true;
    if (!winner || winner === name) return safeSend(payload);
    return true;
  };
  send.waitForDrain = () => getWinner() === name ? safeSend.waitForDrain?.() : Promise.resolve();
  return send;
}

async function firstSuccessfulRun(codexRun, startLocalRun, localDelayMs) {
  const errors = [];
  let localStarted = false;
  let resolveLocalStart;
  const localDelayed = new Promise(resolve => { resolveLocalStart = resolve; }).then(run => run);
  const localTimer = setTimeout(() => {
    localStarted = true;
    resolveLocalStart(startLocalRun());
  }, localDelayMs);
  localTimer.unref?.();

  const pending = new Map([
    ['codex', codexRun.then(page => ({ name: 'codex', page }), error => ({ name: 'codex', error }))],
    ['local', localDelayed.then(page => ({ name: 'local', page }), error => ({ name: 'local', error }))]
  ]);

  while (pending.size) {
    const { key, outcome } = await Promise.race(
      Array.from(pending, ([key, promise]) => promise.then(outcome => ({ key, outcome })))
    );
    pending.delete(key);
    if (outcome.page) {
      clearTimeout(localTimer);
      return outcome.page;
    }
    errors.push(outcome.error);
    if (outcome.name === 'codex' && !localStarted) {
      clearTimeout(localTimer);
      localStarted = true;
      resolveLocalStart(startLocalRun());
    }
  }

  const message = errors.map(error => error?.message || String(error)).filter(Boolean).join(' ');
  throw new Error(message || 'Generation failed.');
}

async function firstCompletedPage(runs) {
  const errors = [];
  const pending = new Map(runs.map(([name, promise]) => [
    name,
    promise.then(page => ({ name, page }), error => ({ name, error }))
  ]));

  while (pending.size) {
    const { key, outcome } = await Promise.race(
      Array.from(pending, ([key, promise]) => promise.then(outcome => ({ key, outcome })))
    );
    pending.delete(key);
    if (outcome.page) return { name: outcome.name, page: outcome.page };
    if (outcome.error?.name !== 'AbortError') errors.push(outcome.error);
  }

  const message = errors.map(error => error?.message || String(error)).filter(Boolean).join(' ');
  throw new Error(message || 'Generation failed.');
}

async function streamWithCodexStdout({ address, history, safeSend, closedRef, signal }) {
  const workspace = os.tmpdir();
  const prompt = makePrompt({ address, history });
  const state = { raw: [] };
  let lastErrorText = '';

  throwIfAborted(signal);

  for (const effort of codexReasoningEffortsToTry()) {
    throwIfAborted(signal);
    const { spawnCapture } = await import('./codexLauncher.js');
    const result = await spawnCapture(config.codexBin, makeCodexArgs(effort, workspace), {
      cwd: workspace,
      stdin: prompt,
      timeoutMs: config.codexTimeoutMs,
      signal,
      onStdout: chunk => {
        if (closedRef()) return;
        state.raw.push(chunk);
      }
    });
    if (result.killedByAbort) throw abortError();
    if (result.killedByTimeout) throw new Error(`Codex timed out after ${config.codexTimeoutMs}ms.`);
    if (result.code !== 0) {
      lastErrorText = (result.stderr || result.stdout || `Codex exited with code ${result.code}`).trim();
      if (isCodexRuntimeConfigError(lastErrorText)) continue;
      throw new Error(lastErrorText);
    }
    state.raw = [result.stdout || state.raw.join('')];
    const page = validateHtmlPagePayload(extractHtmlFromOutput(state.raw.join('')), address, `${config.codexModel} / ${effort} effort`);
    page.address = address;
    if (!safeSend.shadow) {
      safeSend({ type: 'reset', reason: 'codex-final' });
      await streamHtmlChunks(safeSend, page.html, { minChunk: 96, maxChunk: 420, delayMs: CODEX_REPLAY_DELAY_MS, shouldStop: () => closedRef(), waitForDrain: () => safeSend.waitForDrain?.() });
    }
    return page;
  }
  throw new Error(lastErrorText || 'Codex rejected every reasoning effort this app tried.');
}

function authFallbackPage(address, history, status) {
  const page = makeLocalGeneratedPage(address, history, [
    status.message,
    status.binary && `Binary: ${status.binary}`,
    status.error && `Error: ${status.error}`,
    Array.isArray(status.candidates) && status.candidates.length ? `Checked paths:\n${status.candidates.slice(0, 12).join('\n')}` : ''
  ].filter(Boolean).join('\n\n'));
  page.authRequired = true;
  page.authMessage = [
    status.message,
    status.binary && `Binary: ${status.binary}`,
    status.error && `Error: ${status.error}`,
    Array.isArray(status.candidates) && status.candidates.length ? `Checked paths:\n${status.candidates.slice(0, 12).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
  return hardenPagePayload(page, address);
}
