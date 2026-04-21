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

export async function generatePage(body) {
  const address = normalizeAddress(body.address || body.url || body.q);
  const builtInPage = makeBuiltInPage(address);
  if (builtInPage) return hardenPagePayload(builtInPage, address);

  if (shouldTryAiSdk()) {
    try { return await generatePageWithAiSdk({ address, history: body.history }); }
    catch (error) {
      if (['ai-sdk', 'local'].includes(config.aiProvider)) throw error;
      console.warn(`AI SDK generation failed, falling back to Codex CLI: ${error.message}`);
    }
  }

  const status = await codexStatus();
  if (!status.connected) return authFallbackPage(address, body.history, status);

  return generateWithCodexCapture({ address, history: body.history });
}

export async function handlePageStream(req, res) {
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
    Connection: 'keep-alive'
  });

  const safeSend = payload => { if (!closed) sendNdjson(res, payload); };
  const reveal = async (page, options = {}) => {
    const finalPage = hardenPagePayload(page, address);
    safeSend({ type: 'reset', reason: options.reason || 'document' });
    await streamHtmlChunks(safeSend, finalPage.html, { ...options, shouldStop: () => closed });
    return finalPage;
  };

  try {
    safeSend({ type: 'start', address, mode: 'self-contained-html', model: shouldTryAiSdk() ? config.aiSdkModel : config.codexModel });

    const builtInPage = makeBuiltInPage(address);
    if (builtInPage) {
      const page = await reveal(builtInPage, { minChunk: 160, maxChunk: 620, delayMs: 0, reason: 'built-in' });
      safeSend({ type: 'done', page });
      if (!closed) res.end();
      return;
    }

    safeSend({ type: 'status', text: 'Waiting for generated HTML' });

    if (shouldTryAiSdk()) {
      try {
        const page = await streamAiSdkRawHtml({ address, history, safeSend, closedRef: () => closed, signal: generationAbort.signal });
        safeSend({ type: 'done', page: hardenPagePayload(page, address) });
        if (!closed) res.end();
        return;
      } catch (error) {
        if (closed || error.name === 'AbortError') return;
        if (['ai-sdk', 'local'].includes(config.aiProvider)) throw error;
        console.warn(`AI SDK streaming failed, falling back to Codex CLI: ${error.message}`);
        safeSend({ type: 'status', text: 'AI SDK failed, trying Codex' });
      }
    }

    const status = await codexStatus();
    if (!status.connected) {
      const page = await reveal(authFallbackPage(address, history, status), { minChunk: 160, maxChunk: 620, delayMs: 0, reason: 'auth-fallback' });
      safeSend({ type: 'done', page });
      if (!closed) res.end();
      return;
    }

    try {
      const page = await streamCodexRawHtml({ address, history, safeSend, closedRef: () => closed, signal: generationAbort.signal });
      safeSend({ type: 'done', page: hardenPagePayload(page, address) });
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
    send({ type: 'chunk', text: chunk });
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
    /<!doctype\s+html/i,
    /<html[\s>]/i,
    /<head[\s>]/i,
    /<body[\s>]/i
  ];
  for (const marker of markers) {
    const index = String(text || '').search(marker);
    if (index >= 0) return index;
  }
  return -1;
}

function emitReadyHtml(send, state, force = false) {
  if (!state.streaming || !state.pending) return;
  const tagBreak = state.pending.lastIndexOf('>');
  const lineBreak = state.pending.lastIndexOf('\n');
  let end = Math.max(tagBreak, lineBreak) + 1;
  if (end <= 0 && (force || state.pending.length > 1024)) end = state.pending.length;
  if (end <= 0) return;
  send({ type: 'chunk', text: state.pending.slice(0, end) });
  state.pending = state.pending.slice(end);
}

function streamVisibleHtml(send, state) {
  return text => {
    if (!text) return;
    state.raw += text;
    state.pending += text;
    if (!state.streaming) {
      const startIndex = htmlStartIndex(state.pending);
      if (startIndex >= 0) {
        state.streaming = true;
        send({ type: 'reset', reason: 'model' });
        state.pending = state.pending.slice(startIndex);
        emitReadyHtml(send, state);
      }
      return;
    }
    emitReadyHtml(send, state);
  };
}

function flushVisibleHtml(send, state) {
  emitReadyHtml(send, state, true);
}

async function streamAiSdkRawHtml({ address, history, safeSend, closedRef, signal }) {
  throwIfAborted(signal);

  safeSend({ type: 'status', text: 'Starting local model' });
  const { streamText, model, label, providerOptions, timeout } = await loadAiSdkModel();
  safeSend({ type: 'status', text: 'Generating page' });

  const state = { raw: '', pending: '', streaming: false };
  const push = streamVisibleHtml(safeSend, state);

  const result = streamText({
    model,
    system: makeSystemPrompt(),
    prompt: makePrompt({ address, history }),
    maxOutputTokens: 18000,
    maxRetries: 0,
    abortSignal: signal,
    timeout,
    providerOptions
  });

  for await (const delta of result.textStream) {
    if (closedRef()) throwIfAborted(signal);
    push(delta);
  }

  throwIfAborted(signal);
  flushVisibleHtml(safeSend, state);
  const page = validateHtmlPagePayload(extractHtmlFromOutput(state.raw), address, label);
  page.address = address;
  if (!state.streaming) {
    safeSend({ type: 'reset', reason: 'model-final' });
    await streamHtmlChunks(safeSend, page.html, { minChunk: 160, maxChunk: 620, delayMs: 0, shouldStop: () => closedRef() });
  }
  return page;
}

async function generatePageWithAiSdk({ address, history }) {
  const { generateText, model, label, providerOptions, timeout } = await loadAiSdkModel();

  const result = await generateText({
    model,
    system: makeSystemPrompt(),
    prompt: makePrompt({ address, history }),
    maxOutputTokens: 18000,
    maxRetries: 0,
    timeout,
    providerOptions
  });

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
    '--model', config.codexModel,
    '--color', 'never',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '-c', 'approval_policy=never',
    '-c', 'web_search="disabled"',
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
  safeSend({ type: 'status', text: 'Waiting for Codex final HTML' });
  const page = await generateWithCodexCapture({ address, history, signal });
  throwIfAborted(signal);
  safeSend({ type: 'reset', reason: 'codex-final' });
  await streamHtmlChunks(safeSend, page.html, { minChunk: 72, maxChunk: 260, delayMs: 18, shouldStop: () => closedRef() });
  return page;
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
