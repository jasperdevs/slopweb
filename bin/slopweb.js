#!/usr/bin/env node

import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const VERSION = readPackageVersion();
const COLOR_ENABLED = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

const COMMANDS = new Set(['start', 'serve', 'dev', 'open', 'login', 'status', 'logout', 'doctor', 'health', 'models', 'help']);
const BANNER_LINES = [
  ' ███████╗ ██╗       ██████╗  ██████╗  ██╗    ██╗ ███████╗ ██████╗',
  ' ██╔════╝ ██║      ██╔═══██╗ ██╔══██╗ ██║    ██║ ██╔════╝ ██╔══██╗',
  ' ███████╗ ██║      ██║   ██║ ██████╔╝ ██║ █╗ ██║ █████╗   ██████╔╝',
  ' ╚════██║ ██║      ██║   ██║ ██╔═══╝  ██║███╗██║ ██╔══╝   ██╔══██╗',
  ' ███████║ ███████╗ ╚██████╔╝ ██║      ╚███╔███╔╝ ███████╗ ██████╔╝',
  ' ╚══════╝ ╚══════╝  ╚═════╝  ╚═╝       ╚══╝╚══╝  ╚══════╝ ╚═════╝'
];
const LOGO_COLORS = ['97;33;210', '19;31;159', '35;143;255', '35;139;255', '97;33;210', '19;31;159'];
const PALETTE = {
  accent: '138;155;255',
  accentSoft: '196;205;255',
  muted: '138;144;159',
  dim: '96;102;119',
  green: '34;197;94',
  red: '239;68;68',
  yellow: '250;176;5'
};
const BANNER_SUBTITLE = 'A new web where AI generates every page.';
const LOADING_SPINNER = ['◐', '◓', '◑', '◒', '◌'];
const LOADING_SPINNER_MS = 25;
const FRAME_PAD_X = 3;
const FRAME_PAD_Y = 1;
let interactiveScreenActive = false;
let lastInteractiveFrame = [];
let loadingSpinnerTimer = null;
let loadingSpinnerIndex = 0;
let loadingSpinnerMessage = '';

function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function supportsColor() {
  return COLOR_ENABLED;
}

function color(text, rgb) {
  return supportsColor() ? `\x1b[38;2;${rgb}m${text}\x1b[0m` : text;
}

function dim(text)     { return color(text, PALETTE.dim); }
function muted(text)   { return color(text, PALETTE.muted); }
function accent(text)  { return color(text, PALETTE.accent); }
function headline(text){ return supportsColor() ? `\x1b[1m${text}\x1b[0m` : text; }

function renderBanner() {
  const art = BANNER_LINES
    .map((line, index) => color(line, LOGO_COLORS[index % LOGO_COLORS.length]))
    .join('\n');
  const pad = ' '.repeat(4);
  return `${art}\n${pad}${dim(BANNER_SUBTITLE)}`;
}

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

function rejectUnusedArgs(context) {
  if (!args.length) return;
  throw new Error(`Unknown ${context}: ${args.join(' ')}. Run \`slopweb --help\` for usage.`);
}

function printHelp() {
  const rows = [
    renderBanner(),
    '',
    dim('  USAGE'),
    `    ${accent('slopweb')} [start] [--port 8787] [--host localhost] [--model llama3.2] [--strict-port] [--no-open]`,
    `    ${accent('slopweb open')} [-p 8787]`,
    `    ${accent('slopweb models')}`,
    `    ${accent('slopweb health')} [-p 8787]`,
    `    ${accent('slopweb login')}`,
    `    ${accent('slopweb status')}`,
    `    ${accent('slopweb logout')}`,
    `    ${accent('slopweb doctor')}`,
    '',
    dim('  EXAMPLES'),
    `    ${dim('$')} slopweb`,
    `    ${dim('$')} slopweb models`,
    `    ${dim('$')} slopweb --base-url http://localhost:11434/v1 --model llama3.2`,
    `    ${dim('$')} slopweb --local --model qwen2.5-coder:7b`,
    `    ${dim('$')} slopweb --codex`,
    `    ${dim('$')} slopweb login`,
    `    ${dim('$')} slopweb status`,
    '',
    `  ${muted('Generation runs through a local OpenAI-compatible server (AI SDK) or Codex via OAuth.')}`,
    `  ${muted('The server is local-only by default and opens at')} ${accent('http://localhost:8787')}${muted('.')}`,
    `  ${dim('Press Ctrl+C to stop the running server.')}`
  ];
  console.log(rows.join('\n'));
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
  hasFlag('--open', '-o');
  const noOpen = hasFlag('--no-open');
  const openBrowser = !noOpen && process.env.SLOPWEB_NO_OPEN !== '1' && !process.env.CI;
  const lan = hasFlag('--lan');
  const skipPicker = hasFlag('--no-picker', '--yes');
  const forceLocal = hasFlag('--local') || hasFlag('--ai-sdk');
  const forceCodex = hasFlag('--codex');
  const forceManual = hasFlag('--manual');
  const noAutostart = hasFlag('--no-autostart');
  const model = takeFlag('--model', '-m');
  const baseUrl = takeFlag('--base-url');
  const provider = takeFlag('--provider');
  const host = takeFlag('--host', '-H') || process.env.HOST || (lan ? '0.0.0.0' : 'localhost');

  if ([forceLocal, forceCodex, forceManual].filter(Boolean).length > 1) throw new Error('Use only one of --local, --codex, or --manual.');
  if (provider && !['auto', 'local', 'ai-sdk', 'codex'].includes(provider)) throw new Error('Provider must be auto, local, ai-sdk, or codex.');
  if (provider) process.env.SLOPWEB_PROVIDER = provider === 'ai-sdk' ? 'local' : provider;
  if (forceLocal) process.env.SLOPWEB_PROVIDER = 'local';
  if (forceCodex) process.env.SLOPWEB_PROVIDER = 'codex';
  if (model) process.env.SLOPWEB_MODEL = model;
  if (baseUrl) {
    process.env.SLOPWEB_PROVIDER = 'local';
    process.env.SLOPWEB_BASE_URL = baseUrl;
  }
  rejectUnusedArgs('option');

  if (forceManual) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('--manual requires an interactive terminal.');
    enterInteractiveScreen();
    try {
      const manual = await promptManualEndpoint();
      if (!manual) return;
      process.env.SLOPWEB_PROVIDER = 'local';
      process.env.SLOPWEB_BASE_URL = manual.baseUrl;
      process.env.SLOPWEB_MODEL = manual.model;
    } finally {
      exitInteractiveScreen();
    }
  }

  const explicitGenerator = Boolean(forceLocal || forceCodex || forceManual || provider || model || baseUrl || process.env.SLOPWEB_PROVIDER || process.env.AI_PROVIDER || process.env.SLOPWEB_BASE_URL || process.env.AI_SDK_BASE_URL);
  if (!explicitGenerator && !skipPicker && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI) {
    await runLaunchPicker({ autostart: !noAutostart });
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
  if (process.stdout.isTTY) process.env.SLOPWEB_SUPPRESS_SERVER_LOGS = '1';
  if (shouldWarmLocalProvider()) warmLocalProvider().catch(() => {});
  if (shouldWarmCodexProvider()) warmCodexProvider().catch(() => {});
  process.chdir(resolve(rootDir, 'app'));
  await import('../app/server.js');
  renderRunningScreen({ host, port });
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

function shouldWarmLocalProvider() {
  const providerName = String(process.env.SLOPWEB_PROVIDER || process.env.AI_PROVIDER || '').toLowerCase();
  return ['local', 'ai-sdk'].includes(providerName) || Boolean(process.env.SLOPWEB_BASE_URL || process.env.AI_SDK_BASE_URL);
}

function shouldWarmCodexProvider() {
  const providerName = String(process.env.SLOPWEB_PROVIDER || process.env.AI_PROVIDER || 'auto').toLowerCase();
  return providerName === 'codex' || (!shouldWarmLocalProvider() && providerName === 'auto');
}

async function warmLocalProvider() {
  const { warmLocalModel } = await import('../app/lib/aiSdkProvider.js');
  return warmLocalModel();
}

async function warmCodexProvider() {
  const { warmCodexCli } = await import('../app/lib/codexLauncher.js');
  return warmCodexCli();
}

function renderRunningScreen({ host, port }) {
  const url = `http://${displayHost(host)}:${port}`;
  if (!process.stdout.isTTY) return;
  enterInteractiveScreen();
  const provider = process.env.SLOPWEB_PROVIDER || process.env.AI_PROVIDER || (process.env.SLOPWEB_BASE_URL || process.env.AI_SDK_BASE_URL ? 'local' : 'auto');
  const rows = [
    ['url', accent(url)],
    ['provider', provider],
    process.env.SLOPWEB_MODEL ? ['model', process.env.SLOPWEB_MODEL] : null,
    process.env.SLOPWEB_BASE_URL ? ['base url', process.env.SLOPWEB_BASE_URL] : null
  ].filter(Boolean).map(([key, value]) => `    ${dim(key.padEnd(10, ' '))}${value}`);

  const dot = supportsColor() ? color('●', PALETTE.green) : '●';
  const versionBadge = VERSION ? `  ${dim(`v${VERSION}`)}` : '';
  const lines = [
    renderBanner(),
    '',
    `  ${dot} ${headline('Slopweb is running')}${versionBadge}`,
    '',
    ...rows,
    '',
    dim('  Press Ctrl+C to stop Slopweb.')
  ];
  writeInteractiveFrame(lines.join('\n'));
  const stop = () => {
    exitInteractiveScreen();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

function modelChoiceLabel(model) {
  const state = model.live ? 'running' : 'installed';
  return `${modelMarker(model)} ${model.providerName} · ${model.id} (${state})`;
}

function statusMarker(live) {
  if (!supportsColor()) return live ? '🟢' : '🔴';
  return live ? color('●', '34;197;94') : color('●', '239;68;68');
}

function modelMarker(model) {
  if (model?.live) return statusMarker(true);
  if (!supportsColor()) return '🟡';
  return color('●', PALETTE.yellow);
}

function quoteArg(value) {
  const text = String(value || '');
  return /[\s"]/g.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
}

function modelStartHint(model) {
  if (!model?.runtime) return '';
  if (model.providerId === 'llamacpp' && model.filePath) {
    return `${quoteArg(model.runtime)} --model ${quoteArg(model.filePath)} --host 127.0.0.1 --port 8080`;
  }
  if (model.providerId === 'lmstudio') {
    return `${quoteArg(model.runtime)} load ${quoteArg(model.id)} && ${quoteArg(model.runtime)} server start`;
  }
  if (model.providerId === 'ollama') return `${quoteArg(model.runtime)} serve`;
  return '';
}

function codexChoiceLabel(status) {
  if (!status) return `${statusMarker(false)} Codex OAuth (not checked)`;
  return `${statusMarker(Boolean(status?.connected))} Codex OAuth (${status?.connected ? 'connected' : 'not connected'})`;
}

function spawnDetachedRuntime(command, args) {
  const state = { error: '', exit: null };
  let child;
  try {
    child = spawn(command, args, { stdio: 'ignore', detached: true });
  } catch (error) {
    state.error = error.message || String(error);
    return { state, unref() {} };
  }
  child.on('error', error => { state.error = error.message || String(error); });
  child.on('exit', (code, signal) => { state.exit = { code, signal }; });
  return {
    state,
    unref() { child.unref(); }
  };
}

async function waitForRuntimeJson(url, timeoutMs, runtime) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (runtime.state.error) throw new Error(runtime.state.error);
    if (runtime.state.exit) {
      const { code, signal } = runtime.state.exit;
      throw new Error(`Runtime exited before it became ready${signal ? ` (${signal})` : code === null ? '' : ` (code ${code})`}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  return false;
}

function originFromBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
}

async function startDetectedRuntime(model) {
  if (model.live) return model;
  if (!model.runtime) throw new Error(`${model.providerName} is installed, but Slopweb could not find a runtime command to start it.`);

  if (model.providerId === 'ollama') {
    const runtime = spawnDetachedRuntime(model.runtime, ['serve']);
    const origin = originFromBaseUrl(model.baseUrl);
    if (!(await waitForRuntimeJson(`${origin}/api/tags`, 15_000, runtime))) {
      throw new Error('Ollama did not become ready. Start Ollama, then run `slopweb models` again.');
    }
    runtime.unref();
    return { ...model, live: true };
  }

  if (model.providerId === 'llamacpp' && model.filePath) {
    const port = await choosePort(8080, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const args = ['--model', model.filePath, '--host', '127.0.0.1', '--port', String(port)];
    const runtime = spawnDetachedRuntime(model.runtime, args);
    if (!(await waitForRuntimeJson(`${baseUrl}/models`, 60_000, runtime))) {
      throw new Error(`llama.cpp did not become ready for ${model.filePath}.`);
    }
    runtime.unref();
    return { ...model, baseUrl, live: true };
  }

  throw new Error(`${model.providerName} model is installed, but Slopweb does not know how to start this runtime yet.`);
}

function paddedInteractiveFrame(text, cursorPosition = null) {
  if (!process.stdout.isTTY) return { text, cursor: cursorPosition };
  const leftPad = ' '.repeat(FRAME_PAD_X);
  const topPad = Array(FRAME_PAD_Y).fill('');
  const lines = String(text).split('\n').map(line => `${leftPad}${line}`);
  return {
    text: [...topPad, ...lines].join('\n'),
    cursor: cursorPosition
      ? { row: cursorPosition.row + FRAME_PAD_Y, column: cursorPosition.column + FRAME_PAD_X }
      : null
  };
}

function writeInteractiveFrame(text, cursorPosition = null) {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${text}\n`);
    return;
  }
  const frame = paddedInteractiveFrame(text, cursorPosition);
  const nextLines = String(frame.text).split('\n');
  const chunks = ['\x1b[?25l'];
  const maxLines = Math.max(lastInteractiveFrame.length, nextLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    const next = nextLines[index] || '';
    if (lastInteractiveFrame[index] === next && index < nextLines.length) continue;
    chunks.push(`\x1b[${index + 1};1H\x1b[2K${next}`);
  }
  if (nextLines.length < lastInteractiveFrame.length) {
    chunks.push(`\x1b[${nextLines.length + 1};1H\x1b[J`);
  }
  lastInteractiveFrame = nextLines;
  process.stdout.write(chunks.join(''));
  if (frame.cursor) process.stdout.write(`\x1b[${frame.cursor.row};${frame.cursor.column}H\x1b[?25h`);
}

function enterInteractiveScreen() {
  if (!process.stdout.isTTY || interactiveScreenActive) return;
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
  lastInteractiveFrame = [];
  interactiveScreenActive = true;
}

function exitInteractiveScreen() {
  stopLaunchLoadingSpinner();
  if (!interactiveScreenActive) return;
  lastInteractiveFrame = [];
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  interactiveScreenActive = false;
}

function renderInputBox(value = '') {
  const width = Math.min(78, Math.max(42, Number(process.stdout.columns || 80) - 6));
  const top = dim(`╭${'─'.repeat(width)}╮`);
  const bottom = dim(`╰${'─'.repeat(width)}╯`);
  const side = dim('│');
  const prompt = accent('>');
  const visible = [...String(value || '')].slice(-Math.max(0, width - 5)).join('');
  const content = ` ${visible}`.padEnd(Math.max(0, width - 3), ' ');
  return `${top}\n${side} ${prompt}${content} ${side}\n${bottom}`;
}

function inputBoxWidth() {
  return Math.min(78, Math.max(42, Number(process.stdout.columns || 80) - FRAME_PAD_X - 6));
}

function inputCursorColumn(value = '') {
  const visibleChars = [...String(value || '')].slice(-Math.max(0, inputBoxWidth() - 5)).length;
  return 5 + visibleChars;
}

function rowForFrameLine(lines, lineIndex) {
  const before = lines.slice(0, lineIndex).join('\n');
  return before ? before.split('\n').length + 1 : 1;
}

function normalizedSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function choiceSearchText(choice) {
  return [
    choice.label,
    choice.model?.id,
    choice.model?.name,
    choice.model?.providerName,
    choice.model?.filePath,
    choice.model?.baseUrl,
    choice.kind
  ].filter(Boolean).join(' ').toLowerCase();
}

function choiceSemanticTerms(choice) {
  const terms = choiceSearchText(choice).split(/[^a-z0-9.:-]+/i).filter(Boolean);
  if (choice.kind === 'local') {
    terms.push('local', 'offline', 'private', 'model', 'runtime', 'openai-compatible');
    if (choice.model?.live) terms.push('running', 'ready', 'green', 'live');
    else terms.push('installed', 'stopped', 'red', 'not-running');
  }
  if (choice.kind === 'codex') terms.push('codex', 'oauth', 'login', 'cloud', 'openai', 'account');
  if (choice.kind === 'manual') terms.push('manual', 'custom', 'endpoint', 'base-url', 'url', 'server', 'api', 'local', 'lm-studio', 'ollama');
  return [...new Set(terms)];
}

function isSubsequence(needle, haystack) {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function semanticTermScore(term, choicesTerms) {
  if (!term) return 0;
  let score = 0;
  for (const candidate of choicesTerms) {
    if (candidate === term) score = Math.max(score, 100);
    else if (candidate.startsWith(term)) score = Math.max(score, 76);
    else if (candidate.includes(term)) score = Math.max(score, 52);
    else if (term.length >= 3 && isSubsequence(term, candidate)) score = Math.max(score, 28);
  }
  return score;
}

function semanticScore(choice, query) {
  const terms = normalizedSearchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const choiceTerms = choiceSemanticTerms(choice);
  const scores = terms.map(term => semanticTermScore(term, choiceTerms));
  if (scores.some(score => score <= 0)) return 0;
  return scores.reduce((total, score) => total + score, 0);
}

function filteredChoices(choices, query) {
  const text = normalizedSearchText(query);
  if (!text) return choices;
  return choices
    .map((choice, order) => ({ choice, order, score: semanticScore(choice, text) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(item => item.choice);
}

function sortedModels(models) {
  return [...models].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return `${a.providerName} ${a.id}`.localeCompare(`${b.providerName} ${b.id}`);
  });
}

function kindLabel(kind) {
  if (kind === 'local') return 'LOCAL MODELS';
  if (kind === 'codex') return 'CLOUD';
  if (kind === 'manual') return 'CUSTOM';
  return String(kind || '').toUpperCase();
}

function pickerHint() {
  const keyHint = (key, action) => `${accent(key)} ${dim(action)}`;
  const pairs = [
    keyHint('Type', 'filter'),
    keyHint('↑↓', 'move'),
    keyHint('Enter', 'choose'),
    keyHint('Esc', 'clear'),
    keyHint('Ctrl+C', 'quit')
  ];
  return pairs.join(dim('  ·  '));
}

function renderLaunchPicker({ choices, index, models, installed, commandBuffer, message }) {
  stopLaunchLoadingSpinner();
  const visibleChoices = filteredChoices(choices, commandBuffer);
  const safeIndex = visibleChoices.length ? Math.min(index, visibleChoices.length - 1) : 0;
  const lines = [`${renderBanner()}`];
  if (!models.length) {
    lines.push('', `  ${muted('No local models detected.')}`);
    if (installed.length) lines.push(`  ${muted(`Installed runtimes: ${installed.map(item => item.name).join(', ')}`)}`);
  }
  const inputLineIndex = lines.length + 1;
  lines.push('', renderInputBox(commandBuffer || ''));
  if (message) lines.push('', `  ${muted(message)}`);
  if (commandBuffer && !visibleChoices.length) lines.push('', `  ${muted(`No matches for "${commandBuffer}".`)}`);
  lines.push('');
  const showHeaders = !commandBuffer;
  let lastKind = null;
  visibleChoices.forEach((choice, choiceIndex) => {
    if (showHeaders && choice.kind !== lastKind) {
      if (lastKind !== null) lines.push('');
      lines.push(`  ${dim(kindLabel(choice.kind))}`);
      lastKind = choice.kind;
    }
    const pointer = choiceIndex === safeIndex ? accent('›') : ' ';
    lines.push(`  ${pointer} ${choice.label}`);
  });
  lines.push('', `  ${pickerHint()}`);
  writeInteractiveFrame(lines.join('\n'), { row: rowForFrameLine(lines, inputLineIndex) + 1, column: inputCursorColumn(commandBuffer) });
}

function makeLaunchChoices(models, codex = null, options = {}) {
  const choices = models.slice(0, 9).map(model => ({
    kind: 'local',
    label: modelChoiceLabel(model),
    model,
    key: choiceKey({ kind: 'local', model })
  }));
  choices.push({ kind: 'codex', label: codexChoiceLabel(codex), key: 'codex' });
  choices.push({ kind: 'manual', label: 'Manual local endpoint', key: 'manual' });
  return choices;
}

function choiceKey(choice) {
  if (!choice) return '';
  if (choice.key) return choice.key;
  if (choice.kind === 'local') return `local|${choice.model?.baseUrl || ''}|${choice.model?.id || ''}`.toLowerCase();
  return String(choice.kind || '');
}

function mergeModels(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const model of [...primary, ...secondary]) {
    if (!model) continue;
    const key = `${model.baseUrl}|${model.id}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(model);
  }
  return merged;
}

function loadingFrame(message = loadingSpinnerMessage) {
  const dot = supportsColor() ? color(LOADING_SPINNER[loadingSpinnerIndex % LOADING_SPINNER.length], PALETTE.accent) : LOADING_SPINNER[loadingSpinnerIndex % LOADING_SPINNER.length];
  const lines = [
    renderBanner(),
    '',
    renderInputBox(''),
    '',
    `  ${dot} ${muted(message)}`,
    '',
    `  ${accent('Ctrl+C')} ${dim('quit')}`
  ];
  return { text: lines.join('\n'), cursor: { row: rowForFrameLine(lines, 2) + 1, column: inputCursorColumn('') } };
}

function stopLaunchLoadingSpinner() {
  if (!loadingSpinnerTimer) return;
  clearInterval(loadingSpinnerTimer);
  loadingSpinnerTimer = null;
}

function renderLaunchLoading(message = 'Scanning local models') {
  loadingSpinnerMessage = message;
  const frame = loadingFrame();
  writeInteractiveFrame(frame.text, frame.cursor);
  if (loadingSpinnerTimer || !process.stdout.isTTY) return;
  loadingSpinnerTimer = setInterval(() => {
    loadingSpinnerIndex += 1;
    const next = loadingFrame();
    writeInteractiveFrame(next.text, next.cursor);
  }, LOADING_SPINNER_MS);
  loadingSpinnerTimer.unref?.();
}

function selectLaunchChoice(state) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let index = 0;
    let commandBuffer = '';
    let message = state.message || '';
    let closed = false;

    const done = result => {
      closed = true;
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw));
      resolve(result);
    };

    const render = () => {
      const visibleChoices = filteredChoices(state.choices, commandBuffer);
      if (visibleChoices.length && index >= visibleChoices.length) index = visibleChoices.length - 1;
      renderLaunchPicker({ ...state, index, commandBuffer, message });
    };

    state.refreshPromise?.then(update => {
      if (closed || !update) return;
      const currentChoices = filteredChoices(state.choices, commandBuffer);
      const selectedKey = choiceKey(currentChoices[Math.min(index, Math.max(0, currentChoices.length - 1))]);
      if (Array.isArray(update.models)) state.models = update.models;
      if (Array.isArray(update.installed)) state.installed = update.installed;
      if (Array.isArray(update.choices)) state.choices = update.choices;
      if (typeof update.message === 'string') {
        state.message = update.message;
        message = update.message;
      }
      const visibleChoices = filteredChoices(state.choices, commandBuffer);
      const sameIndex = visibleChoices.findIndex(choice => choiceKey(choice) === selectedKey);
      if (!commandBuffer && Array.isArray(update.models) && update.models.length) index = 0;
      else if (sameIndex >= 0) index = sameIndex;
      else if (visibleChoices.length) index = Math.min(index, visibleChoices.length - 1);
      render();
    }).catch(() => {});

    const onData = chunk => {
      const key = String(chunk);
      if (key === '\u0003') {
        exitInteractiveScreen();
        process.stdout.write('\n');
        process.exit(130);
      }
      if (key === '\u001b[A' || key.toLowerCase() === 'k') {
        const visibleChoices = filteredChoices(state.choices, commandBuffer);
        if (!visibleChoices.length) {
          render();
          return;
        }
        index = (index - 1 + visibleChoices.length) % visibleChoices.length;
        render();
        return;
      }
      if (key === '\u001b[B' || key.toLowerCase() === 'j') {
        const visibleChoices = filteredChoices(state.choices, commandBuffer);
        if (!visibleChoices.length) {
          render();
          return;
        }
        index = (index + 1) % visibleChoices.length;
        render();
        return;
      }
      if (key === '\u001b') {
        if (commandBuffer) {
          commandBuffer = '';
          index = 0;
          message = state.message || '';
          render();
        }
        return;
      }
      if (key === '\r' || key === '\n') {
        const visibleChoices = filteredChoices(state.choices, commandBuffer);
        if (visibleChoices.length) done({ type: 'choice', choice: visibleChoices[Math.min(index, visibleChoices.length - 1)] });
        else {
          message = `No matches for "${commandBuffer || ''}".`;
          render();
        }
        return;
      }
      if (key === '\u007f' || key === '\b') {
        if (!commandBuffer) return;
        commandBuffer = [...commandBuffer].slice(0, -1).join('');
        index = 0;
        render();
        return;
      }
      if (/^[\x20-\x7e]$/.test(key)) {
        commandBuffer += key;
        index = 0;
        render();
      }
    };

    stdin.setEncoding('utf8');
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    render();
  });
}

function readInputBox({ title, label, value = '', hint = '', message = '' }) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let text = String(value || '');

    const cleanup = result => {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw));
      resolve(result);
    };

    const render = () => {
      const lines = [`${renderBanner()}`, '', `  ${headline(title)}`];
      if (label) lines.push(`  ${dim(label)}`);
      if (message) lines.push('', `  ${muted(message)}`);
      const inputLineIndex = lines.length + 1;
      lines.push('', renderInputBox(text));
      const sep = dim('  ·  ');
      const hint = `${accent('Enter')} ${dim('accept')}${sep}${accent('Esc')} ${dim('cancel')}${sep}${accent('Ctrl+C')} ${dim('quit')}`;
      lines.push('', `  ${hint}`);
      writeInteractiveFrame(lines.join('\n'), { row: rowForFrameLine(lines, inputLineIndex) + 1, column: inputCursorColumn(text) });
    };

    const onData = chunk => {
      const key = String(chunk);
      if (key === '\u0003') {
        exitInteractiveScreen();
        process.stdout.write('\n');
        process.exit(130);
      }
      if (key === '\u001b') {
        cleanup({ cancelled: true, value: text });
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup({ cancelled: false, value: text.trim() });
        return;
      }
      if (key === '\u007f' || key === '\b') {
        text = [...text].slice(0, -1).join('');
        render();
        return;
      }
      if (/^[\x20-\x7e]$/.test(key)) {
        text += key;
        render();
      }
    };

    stdin.setEncoding('utf8');
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    render();
  });
}

async function promptManualEndpoint() {
  const baseUrlInput = await readInputBox({
    title: 'Manual local endpoint',
    label: 'base url',
    value: 'http://localhost:11434/v1',
    message: 'Enter the OpenAI-compatible server URL.'
  });
  if (baseUrlInput.cancelled) return null;
  const model = await readInputBox({
    title: 'Manual local endpoint',
    label: 'model id',
    message: 'Enter the model id exposed by that server.'
  });
  if (model.cancelled || !model.value) return null;
  return {
    baseUrl: baseUrlInput.value || 'http://localhost:11434/v1',
    model: model.value
  };
}

async function runLaunchPicker(options = {}) {
  let message = '';

  enterInteractiveScreen();
  try {
    renderLaunchLoading('Loading local model detector');
    const { detectLocalModels, detectInstalledLocalRuntimes, resolveLocalModel, LOCAL_MODELS_CONFIG } = await import('../app/lib/localModels.js');
    const { codexStatus } = await import('../app/lib/codexLauncher.js');
    while (true) {
      renderLaunchLoading(message || 'Scanning local models');
      const fullModelsPromise = detectLocalModels().catch(() => []);
      const codexStatusPromise = codexStatus().catch(() => ({ connected: false }));
      const preferredLive = await resolveLocalModel({ verify: true }).catch(() => null);
      const models = sortedModels([preferredLive].filter(Boolean));
      const installed = detectInstalledLocalRuntimes();
      const codex = await codexStatusPromise;
      const choices = makeLaunchChoices(models, codex);
      const refreshPromise = fullModelsPromise.then(fullModels => {
        const merged = sortedModels(mergeModels(models, fullModels));
        return {
          models: merged,
          installed: detectInstalledLocalRuntimes(),
          choices: makeLaunchChoices(merged, codex),
          message: merged.length ? '' : `Custom local providers can live at ${LOCAL_MODELS_CONFIG}`
        };
      });

      if (!models.length && !message) message = `Custom local providers can live at ${LOCAL_MODELS_CONFIG}`;
      const result = await selectLaunchChoice({ choices, models, installed, message, refreshPromise });
      message = '';

      let choice = result.choice;
      if (choice.kind === 'local') {
        try {
          if (!choice.model.live) {
            const hint = modelStartHint(choice.model);
            message = hint
              ? `${choice.model.providerName} · ${choice.model.id} is installed, not running. Start it in another terminal: ${hint}`
              : `${choice.model.providerName} · ${choice.model.id} is installed but not running. Start that runtime first, or choose a green running model.`;
            continue;
          }
          const model = options.autostart === false ? choice.model : await startDetectedRuntime(choice.model);
          process.env.SLOPWEB_PROVIDER = 'local';
          process.env.SLOPWEB_BASE_URL = model.baseUrl;
          process.env.SLOPWEB_MODEL = model.id;
          return;
        } catch (error) {
          message = error.message || String(error);
          continue;
        }
      }
      if (choice.kind === 'codex') {
        process.env.SLOPWEB_PROVIDER = 'codex';
        return;
      }
      const manual = await promptManualEndpoint();
      if (!manual) {
        message = 'Manual endpoint setup canceled.';
        continue;
      }
      process.env.SLOPWEB_PROVIDER = 'local';
      process.env.SLOPWEB_BASE_URL = manual.baseUrl;
      process.env.SLOPWEB_MODEL = manual.model;
      return;
    }
  } finally {
    exitInteractiveScreen();
  }
}

async function listLocalModels() {
  const { detectLocalModels, detectInstalledLocalRuntimes, LOCAL_MODELS_CONFIG } = await import('../app/lib/localModels.js');
  const models = await detectLocalModels();
  if (models.length) {
    console.log('Local models');
    for (const model of models) {
      const state = model.live ? 'running' : 'installed';
      const location = model.filePath || model.baseUrl;
      console.log(`  ${modelMarker(model)} ${model.providerName}\t${model.id}\t${state}\t${location}`);
    }
    return;
  }

  console.log('No local models detected.');
  const installed = detectInstalledLocalRuntimes();
  if (installed.length) {
    console.log('Installed runtimes:');
    installed.forEach(item => console.log(`  ${item.name}: ${item.path}`));
  }
  console.log('Supported local endpoints: Ollama, LM Studio, llama.cpp/llamafile, vLLM, SGLang, Jan, text-generation-webui, KoboldCpp, LocalAI, LiteLLM.');
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
  rejectUnusedArgs('option');
  const url = `http://${displayHost(host)}:${port}/api/health`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exit(1);
});
