import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config, shouldTryAiSdk } from './config.js';
import { sendNdjson, readJsonBody } from './http.js';
import { makePrompt, makeJsonPrompt } from './prompts.js';
import { makeBuiltInPage, makeLiveDraftPage, makeLocalGeneratedPage, makeMockPage } from './builtinPages.js';
import { normalizeAddress, extractHtmlFromOutput, validateHtmlPagePayload, validatePagePayload, hardenPagePayload } from './html.js';
import { sleep, withTimeout } from './utils.js';
import { codexStatus } from './codexLauncher.js';

export async function generatePage(body) {
  const address = normalizeAddress(body.address || body.url || body.q);
  const builtInPage = makeBuiltInPage(address);
  if (builtInPage) return hardenPagePayload(builtInPage, address);

  if (config.codexMock) return hardenPagePayload(makeMockPage(address), address);

  if (shouldTryAiSdk()) {
    try { return await generatePageWithAiSdk({ address, history: body.history }); }
    catch (error) {
      if (config.aiProvider === 'ai-sdk') throw error;
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
    safeSend({ type: 'start', address, mode: 'live-elements-static-html', model: config.codexModel });

    const builtInPage = makeBuiltInPage(address);
    if (builtInPage) {
      const page = await reveal(builtInPage, { minChunk: 96, maxChunk: 280, delayMs: 8, reason: 'built-in' });
      safeSend({ type: 'done', page });
      if (!closed) res.end();
      return;
    }

    // Immediate live elements, not a spinner. This keeps the frame useful even when Codex buffers output.
    const draft = makeLiveDraftPage(address);
    await reveal(draft, { minChunk: 120, maxChunk: 360, delayMs: 5, reason: 'draft' });
    safeSend({ type: 'status', text: 'Compiling final static page' });

    if (config.codexMock) {
      const page = await reveal(makeMockPage(address), { minChunk: 96, maxChunk: 280, delayMs: 8, reason: 'mock' });
      safeSend({ type: 'done', page });
      if (!closed) res.end();
      return;
    }

    if (shouldTryAiSdk()) {
      try {
        const page = await streamAiSdkRawHtml({ address, history, safeSend, closedRef: () => closed, signal: generationAbort.signal });
        safeSend({ type: 'done', page: hardenPagePayload(page, address) });
        if (!closed) res.end();
        return;
      } catch (error) {
        if (closed || error.name === 'AbortError') return;
        if (config.aiProvider === 'ai-sdk') throw error;
        console.warn(`AI SDK streaming failed, falling back to Codex CLI: ${error.message}`);
        safeSend({ type: 'status', text: 'AI SDK failed, trying Codex' });
      }
    }

    const status = await codexStatus();
    if (!status.connected) {
      const page = await reveal(authFallbackPage(address, history, status), { minChunk: 96, maxChunk: 280, delayMs: 8, reason: 'auth-fallback' });
      safeSend({ type: 'done', page });
      if (!closed) res.end();
      return;
    }

    try {
      const page = await streamCodexRawHtml({ address, history, safeSend, closedRef: () => closed, signal: generationAbort.signal });
      safeSend({ type: 'done', page: hardenPagePayload(page, address) });
    } catch (error) {
      if (closed || error.name === 'AbortError') return;
      const fallback = await reveal(makeLocalGeneratedPage(address, history, error.message || String(error)), { minChunk: 96, maxChunk: 280, delayMs: 8, reason: 'fallback' });
      safeSend({ type: 'done', page: fallback });
    }

    if (!closed) res.end();
  } catch (error) {
    if (!closed) {
      const fallback = await reveal(makeLocalGeneratedPage(address, history, error.message || String(error)), { minChunk: 96, maxChunk: 280, delayMs: 8, reason: 'error-fallback' });
      safeSend({ type: 'done', page: fallback });
      res.end();
    }
  }
}

async function streamHtmlChunks(send, html, options = {}) {
  const text = String(html || '');
  const minChunk = Number(options.minChunk || 64);
  const maxChunk = Number(options.maxChunk || 220);
  const delayMs = Number(options.delayMs || 10);
  const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
  let index = 0;
  while (index < text.length && !shouldStop()) {
    const nextBreaks = ['\n', '>', '</style>'].map(token => text.indexOf(token, index + minChunk)).filter(value => value > -1);
    const nearBreak = nextBreaks.length ? Math.min(...nextBreaks) + 1 : -1;
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

function streamVisibleHtml(send, state) {
  return text => {
    if (!text) return;
    state.raw += text;
    if (!state.streaming) {
      state.pending += text;
      const doctypeIndex = state.pending.search(/<!doctype\s+html/i);
      if (doctypeIndex >= 0) {
        state.streaming = true;
        send({ type: 'reset', reason: 'model' });
        send({ type: 'chunk', text: state.pending.slice(doctypeIndex) });
        state.pending = '';
      }
      return;
    }
    send({ type: 'chunk', text });
  };
}

async function streamAiSdkRawHtml({ address, history, safeSend, closedRef, signal }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Vercel AI SDK mode needs OPENAI_API_KEY.');
  throwIfAborted(signal);

  let ai;
  let openaiProvider;
  try {
    ai = await import('ai');
    openaiProvider = await import('@ai-sdk/openai');
  } catch (error) {
    throw new Error(`Vercel AI SDK streaming packages are not installed. Run npm install. Details: ${error.message}`);
  }

  const { streamText } = ai;
  const { openai } = openaiProvider;
  if (typeof streamText !== 'function' || !openai) throw new Error('AI SDK streamText/openai exports were missing.');

  const model = typeof openai.responses === 'function' ? openai.responses(config.aiSdkModel) : openai(config.aiSdkModel);
  safeSend({ type: 'status', text: 'Streaming final HTML from AI SDK' });

  const state = { raw: '', pending: '', streaming: false };
  const push = streamVisibleHtml(safeSend, state);

  const result = await withTimeout(streamText({
    model,
    prompt: makePrompt({ address, history }),
    temperature: 0.35,
    maxOutputTokens: 18000,
    abortSignal: signal
  }), config.aiSdkTimeoutMs, 'Vercel AI SDK streaming generation');

  for await (const delta of result.textStream) {
    if (closedRef()) throwIfAborted(signal);
    push(delta);
  }

  throwIfAborted(signal);
  const page = validateHtmlPagePayload(extractHtmlFromOutput(state.raw), address, `${config.aiSdkModel} via Vercel AI SDK`);
  page.address = address;
  if (!state.streaming) {
    safeSend({ type: 'reset', reason: 'model-final' });
    await streamHtmlChunks(safeSend, page.html, { minChunk: 96, maxChunk: 280, delayMs: 8, shouldStop: () => closedRef() });
  }
  return page;
}

async function generatePageWithAiSdk({ address, history }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Vercel AI SDK mode needs OPENAI_API_KEY.');

  let ai;
  let openaiProvider;
  let zod;
  try {
    ai = await import('ai');
    openaiProvider = await import('@ai-sdk/openai');
    zod = await import('zod');
  } catch (error) {
    throw new Error(`Vercel AI SDK packages are not installed. Run npm install, or set AI_PROVIDER=codex. Details: ${error.message}`);
  }

  const { generateObject } = ai;
  const { openai } = openaiProvider;
  const { z } = zod;
  const schema = z.object({ title: z.string().min(1).max(120), summary: z.string().min(1).max(500), html: z.string().min(1) });
  const model = typeof openai.responses === 'function' ? openai.responses(config.aiSdkModel) : openai(config.aiSdkModel);

  const result = await withTimeout(generateObject({
    model,
    schema,
    prompt: makeJsonPrompt({ address, history }),
    temperature: 0.35,
    maxOutputTokens: 18000
  }), config.aiSdkTimeoutMs, 'Vercel AI SDK generation');

  const page = validatePagePayload(result.object, address, `${config.aiSdkModel} via Vercel AI SDK`);
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
  await streamHtmlChunks(safeSend, page.html, { minChunk: 96, maxChunk: 280, delayMs: 8, shouldStop: () => closedRef() });
  return page;
}

function authFallbackPage(address, history, status) {
  const mock = makeLocalGeneratedPage(address, history, [
    status.message,
    status.binary && `Binary: ${status.binary}`,
    status.error && `Error: ${status.error}`,
    Array.isArray(status.candidates) && status.candidates.length ? `Checked paths:\n${status.candidates.slice(0, 12).join('\n')}` : ''
  ].filter(Boolean).join('\n\n'));
  mock.authRequired = true;
  mock.authMessage = [
    status.message,
    status.binary && `Binary: ${status.binary}`,
    status.error && `Error: ${status.error}`,
    Array.isArray(status.candidates) && status.candidates.length ? `Checked paths:\n${status.candidates.slice(0, 12).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
  return hardenPagePayload(mock, address);
}
