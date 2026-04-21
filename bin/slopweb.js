#!/usr/bin/env node

import net from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const VERSION = '1.0.0';

const COMMANDS = new Set(['start', 'serve', 'dev', 'open', 'login', 'status', 'logout', 'doctor', 'health', 'models', 'help']);

function flagIndex(names) {
  return args.findIndex(value => names.includes(value));
}

function hasFlag(...names) {
  const index = flagIndex(names);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeFlag(...names) {
  const index = flagIndex(names);
  if (index === -1) return '';
  const value = args[index + 1] || '';
  args.splice(index, 2);
  return value;
}

function printHelp() {
  console.log(`Slopweb

Usage:
  slopweb [start] [--port 8787] [--host localhost] [--model llama3.2] [--strict-port] [--open]
  slopweb open [-p 8787]
  slopweb models
  slopweb health [-p 8787]
  slopweb login
  slopweb status
  slopweb logout
  slopweb doctor

Examples:
  slopweb
  slopweb models
  slopweb --base-url http://localhost:11434/v1 --model llama3.2
  slopweb --local --model qwen2.5-coder:7b
  slopweb --codex
  slopweb login
  slopweb status

Inside Slopweb:
  /help       Show address-bar commands
  /search q   Generate search results
  /go addr    Generate any address
  /source     Toggle live HTML

Generation uses local OpenAI-compatible servers through Vercel AI SDK, or Codex through OAuth.
The server is local-only by default and opens at http://localhost:8787.`);
}

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (args[0] && !args[0].startsWith('-') && !COMMANDS.has(args[0])) {
  console.error(`Unknown command: ${args[0]}`);
  console.error('Run `slopweb --help` for usage.');
  process.exit(1);
}

const command = COMMANDS.has(args[0]) ? args.shift() : 'start';
if (command === 'help') {
  printHelp();
  process.exit(0);
}

async function main() {
  if (['start', 'serve', 'dev', 'open'].includes(command)) return startServer({ open: command === 'open' });
  if (command === 'login') return runCodex(['login', '--device-auth']);
  if (command === 'logout') return runCodex(['logout']);
  if (command === 'status') return showStatus();
  if (command === 'doctor') return runDoctor();
  if (command === 'health') return checkHealth();
  if (command === 'models') return listLocalModels();
  throw new Error(`Unknown command: ${command}`);
}

async function startServer(defaults = {}) {
  const requestedPort = Number(takeFlag('--port', '-p') || process.env.PORT || 8787);
  const strictPort = hasFlag('--strict-port');
  const openBrowser = hasFlag('--open', '-o') || Boolean(defaults.open);
  const lan = hasFlag('--lan');
  const mock = hasFlag('--mock');
  const skipPicker = hasFlag('--no-picker', '--yes');
  const forceLocal = hasFlag('--local') || hasFlag('--ai-sdk');
  const forceCodex = hasFlag('--codex');
  const model = takeFlag('--model', '-m');
  const baseUrl = takeFlag('--base-url');
  const provider = takeFlag('--provider');
  const host = takeFlag('--host', '-H') || process.env.HOST || (lan ? '0.0.0.0' : 'localhost');

  if (forceLocal && forceCodex) throw new Error('Use either --local or --codex, not both.');
  if (provider && !['auto', 'local', 'ai-sdk', 'codex'].includes(provider)) throw new Error('Provider must be auto, local, ai-sdk, or codex.');
  if (provider) process.env.SLOPWEB_PROVIDER = provider === 'ai-sdk' ? 'local' : provider;
  if (forceLocal) process.env.SLOPWEB_PROVIDER = 'local';
  if (forceCodex) process.env.SLOPWEB_PROVIDER = 'codex';
  if (model) process.env.SLOPWEB_MODEL = model;
  if (baseUrl) {
    process.env.SLOPWEB_PROVIDER = 'local';
    process.env.SLOPWEB_BASE_URL = baseUrl;
  }

  if (mock) process.env.CODEX_MOCK = '1';
  const explicitGenerator = Boolean(forceLocal || forceCodex || provider || model || baseUrl || mock || process.env.SLOPWEB_PROVIDER || process.env.AI_PROVIDER || process.env.SLOPWEB_BASE_URL || process.env.AI_SDK_BASE_URL);
  if (!explicitGenerator && !skipPicker && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI) {
    await runLaunchPicker();
  }

  if (lan || host === '0.0.0.0') process.env.SLOPWEB_ALLOW_LAN = '1';
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
    throw new Error(`Invalid port: ${requestedPort}`);
  }

  if (strictPort && !(await canListen(requestedPort, host))) {
    throw new Error(`Port ${requestedPort} is not available. Remove --strict-port to choose the next open port.`);
  }
  const port = strictPort ? requestedPort : await choosePort(requestedPort, host);
  if (port !== requestedPort) console.warn(`Port ${requestedPort} is busy; using ${port}. Pass --strict-port to fail instead.`);

  process.env.PORT = String(port);
  process.env.HOST = host;
  process.env.SLOPWEB_VERSION = VERSION;
  process.chdir(resolve(rootDir, 'app'));
  await import('../app/server.js');
  if (openBrowser) setTimeout(() => openUrl(`http://${displayHost(host)}:${port}`), 250).unref?.();
}

async function choosePort(startPort, host) {
  for (let port = startPort; port < startPort + 50 && port <= 65535; port += 1) {
    if (await canListen(port, host)) return port;
  }
  throw new Error(`No available port found from ${startPort} to ${Math.min(startPort + 49, 65535)}.`);
}

function canListen(port, host) {
  return new Promise(resolvePort => {
    const server = net.createServer();
    server.once('error', error => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolvePort(false);
      else resolvePort(false);
    });
    server.once('listening', () => server.close(() => resolvePort(true)));
    server.listen(port, host);
  });
}

function displayHost(host) {
  return host === '0.0.0.0' || host === '127.0.0.1' ? 'localhost' : host;
}

function openUrl(url) {
  const commandByPlatform = {
    win32: ['cmd', ['/c', 'start', '', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]]
  };
  const [cmd, cmdArgs] = commandByPlatform[process.platform] || commandByPlatform.linux;
  const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true });
  child.unref();
}

async function runLaunchPicker() {
  const { createInterface } = await import('node:readline/promises');
  const { detectLocalModels, detectInstalledLocalRuntimes, LOCAL_MODELS_CONFIG } = await import('../app/lib/localModels.js');
  const models = await detectLocalModels();
  const installed = detectInstalledLocalRuntimes();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const choices = models.slice(0, 9).map(model => ({
    kind: 'local',
    label: `${model.providerName} · ${model.id}`,
    model
  }));
  choices.push({ kind: 'codex', label: 'Codex OAuth' });
  choices.push({ kind: 'manual', label: 'Manual local endpoint' });
  choices.push({ kind: 'mock', label: 'Demo mode' });

  try {
    console.log('\nSlopweb launchpad');
    if (models.length) {
      console.log('Detected local models:');
    } else {
      console.log('No running local model server detected.');
      if (installed.length) console.log(`Installed runtimes: ${installed.map(item => item.name).join(', ')}`);
      console.log(`Custom local providers can live at ${LOCAL_MODELS_CONFIG}`);
    }
    choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice.label}`));
    const answer = (await rl.question(`Pick a generator [1-${choices.length}]: `)).trim();
    const index = answer ? Number(answer) - 1 : 0;
    const choice = choices[index] || choices[0];

    if (choice.kind === 'local') {
      process.env.SLOPWEB_PROVIDER = 'local';
      process.env.SLOPWEB_BASE_URL = choice.model.baseUrl;
      process.env.SLOPWEB_MODEL = choice.model.id;
      return;
    }
    if (choice.kind === 'codex') {
      process.env.SLOPWEB_PROVIDER = 'codex';
      return;
    }
    if (choice.kind === 'mock') {
      process.env.CODEX_MOCK = '1';
      return;
    }

    const baseUrl = (await rl.question('OpenAI-compatible base URL [http://localhost:11434/v1]: ')).trim() || 'http://localhost:11434/v1';
    const model = (await rl.question('Model id: ')).trim();
    if (!model) throw new Error('A local model id is required for a manual endpoint.');
    process.env.SLOPWEB_PROVIDER = 'local';
    process.env.SLOPWEB_BASE_URL = baseUrl;
    process.env.SLOPWEB_MODEL = model;
  } finally {
    rl.close();
  }
}

async function listLocalModels() {
  const { detectLocalModels, detectInstalledLocalRuntimes, LOCAL_MODELS_CONFIG } = await import('../app/lib/localModels.js');
  const models = await detectLocalModels();
  if (models.length) {
    console.log('Local models');
    for (const model of models) {
      console.log(`  ${model.providerName}\t${model.id}\t${model.baseUrl}`);
    }
    return;
  }

  console.log('No running local model servers detected.');
  const installed = detectInstalledLocalRuntimes();
  if (installed.length) {
    console.log('Installed runtimes:');
    installed.forEach(item => console.log(`  ${item.name}: ${item.path}`));
  }
  console.log('Supported local endpoints: Ollama, LM Studio, llama.cpp/llamafile, vLLM, SGLang, Jan, text-generation-webui, KoboldCpp.');
  console.log(`Custom providers: ${LOCAL_MODELS_CONFIG}`);
}

async function runCodex(codexArgs) {
  const { makeCodexSpawnSpecs, spawnWithSpec, isLauncherFailureResult, summarizeAttempts } = await import('../app/lib/codexLauncher.js');
  const attempts = [];

  for (const spec of makeCodexSpawnSpecs(process.env.CODEX_BIN || 'codex', codexArgs)) {
    const result = await runInteractiveAttempt(spawnWithSpec, spec);
    if (isLauncherFailureResult(result)) {
      attempts.push({ label: spec.label, code: result.code, stdout: result.stdout, stderr: result.stderr, error: result.error, errorCode: result.errorCode });
      continue;
    }
    process.exitCode = result.code || 0;
    return;
  }

  console.error(`Could not start Codex.\n${summarizeAttempts(attempts)}`);
  process.exitCode = 1;
}

function runInteractiveAttempt(spawnWithSpec, spec) {
  return new Promise(resolveAttempt => {
    let stdout = '';
    let stderr = '';
    const child = spawnWithSpec(spec, { stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8');
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', error => resolveAttempt({ code: 1, stdout, stderr, error: error.message, errorCode: error.code }));
    child.on('close', code => resolveAttempt({ code, stdout, stderr }));
  });
}

async function showStatus() {
  const forcedLocal = ['local', 'ai-sdk'].includes(String(process.env.SLOPWEB_PROVIDER || process.env.AI_PROVIDER || '').toLowerCase()) || Boolean(process.env.SLOPWEB_BASE_URL || process.env.AI_SDK_BASE_URL);
  const { aiSdkStatus } = await import('../app/lib/aiSdkProvider.js');
  const local = await aiSdkStatus();
  console.log(local.connected ? 'Local AI: ready' : 'Local AI: not detected');
  if (local.runtime) console.log(`Runtime: ${local.runtime}`);
  if (local.model) console.log(`Model: ${local.model}`);
  if (local.baseUrl) console.log(`Base URL: ${local.baseUrl}`);
  if (local.message) console.log(local.message);
  if (forcedLocal) {
    process.exitCode = local.connected ? 0 : 1;
    return;
  }

  const { codexStatus } = await import('../app/lib/codexLauncher.js');
  const status = await codexStatus();
  console.log(status.connected ? 'Codex: connected' : 'Codex: not connected');
  if (status.provider) console.log(`Provider: ${status.provider}`);
  if (status.binary) console.log(`Binary: ${status.binary}`);
  if (status.message) console.log(status.message);
  process.exitCode = local.connected || status.connected ? 0 : 1;
}

function canResolve(specifier) {
  try {
    require.resolve(specifier, { paths: [rootDir, process.cwd()] });
    return true;
  } catch {
    return false;
  }
}

function printAiSdkStatus() {
  const packages = ['ai', '@ai-sdk/openai-compatible'];
  const missing = packages.filter(name => !canResolve(name));
  if (!missing.length) {
    console.log('AI SDK packages: installed');
    return;
  }
  console.log('AI SDK packages: not installed');
  console.log(`  Missing: ${missing.join(', ')}`);
}

async function runDoctor() {
  console.log('Slopweb doctor');
  console.log(`Version: ${VERSION}`);
  console.log(`Node: ${process.version}`);
  console.log(`Package: ${rootDir}`);
  console.log('Default URL: http://localhost:8787');
  console.log('Generation: local AI through Vercel AI SDK, or Codex CLI through OAuth.');
  printAiSdkStatus();
  await showStatus();
}

async function checkHealth() {
  const port = Number(takeFlag('--port', '-p') || process.env.PORT || 8787);
  const host = takeFlag('--host', '-H') || process.env.HOST || 'localhost';
  const url = `http://${displayHost(host)}:${port}/api/health`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exit(1);
});
