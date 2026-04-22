#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'slopweb-test-'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function log(name) {
  console.log(`ok - ${name}`);
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

async function waitForServer(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start on ${port}.`);
}

async function withServer(fn) {
  const port = await freePort();
  const child = spawn(process.execPath, ['app/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      SLOPWEB_PROVIDER: 'codex',
      SLOPWEB_PAGES_DIR: path.join(tempRoot, 'pages'),
      SLOPWEB_SUPPRESS_SERVER_LOGS: '1'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  try {
    await waitForServer(port);
    await fn(port);
  } finally {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 500).unref?.();
  }
  if (child.exitCode && child.exitCode !== 0) throw new Error(stderr || `Server exited ${child.exitCode}.`);
}

async function testPageStore() {
  process.env.SLOPWEB_PAGES_DIR = path.join(tempRoot, 'store');
  const { deleteSavedPage, listSavedPages, readSavedPage, saveGeneratedPage } = await import('../app/lib/pageStore.js');
  const page = await saveGeneratedPage({
    title: 'Test page',
    summary: 'test',
    html: '<!doctype html><html><head><title>Test</title></head><body>ok</body></html>',
    address: 'slopweb://test'
  }, 'slopweb://test');
  assert(page.savedDisplayPath.startsWith('slopweb/pages/'), 'saved display path should be portable');
  assert(page.savedUrl.startsWith('/slopweb/pages/'), 'saved URL should be app-relative');
  const pages = await listSavedPages();
  assert(pages.some(item => item.fileName === path.basename(page.savedFilePath)), 'saved page should be listed');
  const html = await readSavedPage(path.basename(page.savedFilePath));
  assert(html.includes('<body>ok</body>'), 'saved page should be readable');
  assert(await deleteSavedPage(path.basename(page.savedFilePath)), 'saved page should delete');
  log('page store save/list/read/delete');
}

async function testServer() {
  await withServer(async port => {
    const streamResponse = await fetch(`http://127.0.0.1:${port}/api/page-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: 'slopweb://home', history: [] })
    });
    assert(streamResponse.ok, 'stream response should be ok');
    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawChunk = false;
    while (!sawChunk) {
      const { value, done } = await reader.read();
      assert(!done, 'stream should emit a chunk before ending');
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'chunk') sawChunk = true;
      }
    }
    await reader.cancel();

    const traversal = await fetch(`http://127.0.0.1:${port}/slopweb/pages/..%2Fserver.js`);
    assert(traversal.status === 403 || traversal.status === 404, 'saved page traversal should not be served');

    const invalidJson = await fetch(`http://127.0.0.1:${port}/api/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{'
    });
    assert(invalidJson.status === 400, 'invalid JSON should return 400');

    const nullBody = await fetch(`http://127.0.0.1:${port}/api/page-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null'
    });
    assert(nullBody.status === 400, 'non-object JSON bodies should return 400');
    log('server stream and saved-page traversal');
  });
}

async function testPrompts() {
  const { makePrompt, makeSystemPrompt } = await import('../app/lib/prompts.js');
  const { sanitizeGeneratedHtml } = await import('../app/lib/html.js');
  const { modelGenerationProfile } = await import('../app/lib/modelProfiles.js');
  const system = makeSystemPrompt();
  const prompt = makePrompt({ address: 'slopweb://search/youtube.com', history: ['slopweb://home', 'slopweb://news/world-wire'] });
  const html = sanitizeGeneratedHtml('<!doctype html><html><body><a href="slopweb://home">SloppyWeb</a><h1>Slopweb Search</h1><input placeholder="Search SlopWeb"></body></html>');
  const qwen = modelGenerationProfile({ id: 'Qwen3.5-4B-Q4_K_M.gguf' });
  const deepseek = modelGenerationProfile({ id: 'deepseek-r1-distill-qwen-7b' });
  const llama = modelGenerationProfile({ id: 'llama-3.2-3b-instruct' });
  assert(system.includes('Begin exactly'), 'system prompt should bias first visible content');
  assert(system.includes('Keep it compact'), 'system prompt should keep generation concise');
  assert(system.includes('compact embedded <style>'), 'system prompt should require compact styling');
  assert(prompt.includes('Return complete compact HTML only'), 'prompt should keep Codex output concise');
  assert(prompt.includes('one embedded <style>'), 'prompt should request one style block');
  assert(prompt.includes('Page: search for youtube.com'), 'prompt should describe search without internal scheme branding');
  assert(!prompt.includes('Page: slopweb://'), 'prompt page line should hide internal scheme');
  assert(prompt.includes('slopweb://'), 'prompt should still tell models how to make internal links');
  assert(qwen.promptPrefix.includes('/no_think'), 'Qwen thinking models should get no-think control');
  assert(deepseek.promptPrefix.includes('<think>'), 'reasoning models should get no-think-block control');
  assert(!llama.promptPrefix, 'plain instruct models should not get reasoning-family controls');
  assert(html.includes('href="slopweb://home"'), 'sanitizer should keep internal links');
  assert(!/\bslopp?y?\s*web\b/i.test(html.replace(/slopweb:\/\//gi, '')), 'sanitizer should remove visible internal branding');
  log('streaming prompt shape');
}

async function testClientHomePage() {
  const { homePage } = await import('../app/public/js/home.js');
  const page = homePage();
  assert(page.address === 'slopweb://home', 'client home should use the home address');
  assert(page.html.includes('<form class="search" action="slopweb://search"'), 'client home should include the local search form');
  assert(page.html.includes('slopweb://news/world-wire'), 'client home should include shortcuts');
  log('client home page is static');
}

async function testPageSchema() {
  const schema = JSON.parse(await readFile(path.join(root, 'app/schema/page.schema.json'), 'utf8'));
  const required = new Set(schema.required || []);
  ['title', 'summary', 'html', 'address', 'model', 'authRequired', 'authMessage'].forEach(key => {
    assert(required.has(key), `page schema should require ${key}`);
  });
  ['savedFilePath', 'savedUrl', 'savedDisplayPath'].forEach(key => {
    assert(schema.properties?.[key]?.type === 'string', `page schema should describe ${key}`);
  });
  assert(schema.additionalProperties === false, 'page schema should reject undeclared fields');
  log('page schema matches payload shape');
}

function testPackageContents() {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --json'], { cwd: root, encoding: 'utf8', shell: false })
    : spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', shell: false });
  assert(result.status === 0, result.stderr || 'npm pack failed');
  const packs = JSON.parse(result.stdout || '[]');
  const files = packs.flatMap(pack => pack.files || []).map(file => file.path || '');
  assert(!files.some(file => /^app\/slopweb\//.test(file)), 'npm package must not include generated runtime pages');
  assert(files.includes('app/lib/pageStore.js'), 'npm package should include pageStore');
  log('npm package contents');
}

try {
  await testPageStore();
  await testServer();
  await testPrompts();
  await testClientHomePage();
  await testPageSchema();
  testPackageContents();
  console.log('All behavior tests passed.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
