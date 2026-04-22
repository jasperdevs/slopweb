#!/usr/bin/env node

import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const root = process.cwd();
const args = process.argv.slice(2);

function takeFlag(name, fallback = '') {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1] || fallback;
  args.splice(index, 2);
  return value;
}

function hasFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

const provider = takeFlag('--provider', process.env.SLOPWEB_PROVIDER || 'local');
const address = takeFlag('--address', 'slopweb://search/youtube.com');
const runs = Math.max(1, Number(takeFlag('--runs', '1')) || 1);
const browser = hasFlag('--browser');

if (args.length) throw new Error(`Unknown option: ${args.join(' ')}`);

function now() {
  return performance.now();
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value) {
  return Math.round(Number(value || 0));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.listen(0, '127.0.0.1');
  });
}

async function waitHealth(port, timeoutMs = 10_000) {
  const start = now();
  let lastError = '';
  while (now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return { ms: now() - start, health: await response.json() };
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message || String(error);
    }
    await sleep(80);
  }
  throw new Error(`Health check timed out: ${lastError}`);
}

function serverEnv(port) {
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    SLOPWEB_PROVIDER: provider,
    SLOPWEB_SUPPRESS_SERVER_LOGS: '1'
  };
  if (provider === 'local') {
    env.SLOPWEB_BASE_URL ||= 'http://127.0.0.1:8080/v1';
    env.SLOPWEB_MODEL ||= 'Qwen3.5-4B-Q4_K_M.gguf';
  }
  return env;
}

async function withServer(fn) {
  const port = await freePort();
  const child = spawn(process.execPath, ['app/server.js'], {
    cwd: root,
    env: serverEnv(port),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

  try {
    const ready = await waitHealth(port);
    return await fn(port, ready);
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 500).unref?.();
    await new Promise(resolve => child.once('close', resolve));
    if (stderr.trim()) console.error(stderr.trim());
  }
}

async function measureHttp(port) {
  const started = now();
  const response = await fetch(`http://127.0.0.1:${port}/api/page-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, history: ['slopweb://home', address] })
  });
  if (!response.ok || !response.body) throw new Error(`Stream failed: HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstEventMs = 0;
  let firstChunkMs = 0;
  let doneMs = 0;
  let chunkCount = 0;
  let bytes = 0;
  let maxChunkGapMs = 0;
  let lastChunkMs = 0;
  let model = '';
  const statuses = [];

  const consumeLine = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    const at = now() - started;
    if (!firstEventMs) firstEventMs = at;
    if (event.type === 'status') statuses.push(`${round(at)}ms ${event.text || ''}`);
    if (event.type === 'chunk') {
      if (!firstChunkMs) firstChunkMs = at;
      if (lastChunkMs) maxChunkGapMs = Math.max(maxChunkGapMs, at - lastChunkMs);
      lastChunkMs = at;
      chunkCount += 1;
      bytes += Buffer.byteLength(String(event.text || ''));
    }
    if (event.type === 'done') {
      doneMs = at;
      model = event.page?.model || '';
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }

  buffer += decoder.decode();
  if (buffer) consumeLine(buffer);

  return { firstEventMs, firstChunkMs, doneMs: doneMs || now() - started, chunkCount, bytes, maxChunkGapMs, model, statuses };
}

async function measureBrowser(port) {
  if (!browser) return null;
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { error: 'Playwright is not installed in this workspace.' };
  }

  const instance = await chromium.launch({ headless: true });
  try {
    const page = await instance.newPage({ viewport: { width: 1280, height: 820 } });
    await page.goto(`http://127.0.0.1:${port}/?streamMetrics`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#addressInput');
    await page.fill('#addressInput', address);
    await page.press('#addressInput', 'Enter');
    await page.waitForFunction(target => {
      const run = window.__slopStream?.current;
      return run && run.address === target && run.ttfeMs > 0;
    }, address, { timeout: 120_000 });
    return await page.evaluate(() => ({ ...window.__slopStream.current }));
  } finally {
    await instance.close();
  }
}

const results = [];
for (let index = 0; index < runs; index += 1) {
  const result = await withServer(async (port, ready) => {
    const http = await measureHttp(port);
    const page = await measureBrowser(port);
    return { provider, address, startupMs: ready.ms, health: ready.health, http, browser: page };
  });
  results.push(result);
  console.log(JSON.stringify(result, null, 2));
}

const firstChunks = results.map(result => result.http.firstChunkMs).filter(Boolean);
const doneTimes = results.map(result => result.http.doneMs).filter(Boolean);
const gaps = results.map(result => result.http.maxChunkGapMs).filter(Boolean);
console.log(JSON.stringify({
  summary: {
    runs,
    provider,
    address,
    firstChunkMs: { p50: round(percentile(firstChunks, 50)), p95: round(percentile(firstChunks, 95)) },
    doneMs: { p50: round(percentile(doneTimes, 50)), p95: round(percentile(doneTimes, 95)) },
    maxChunkGapMs: { p50: round(percentile(gaps, 50)), p95: round(percentile(gaps, 95)) }
  }
}, null, 2));
