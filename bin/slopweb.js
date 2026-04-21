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
const BANNER_LINES = [
  ' ███████╗ ██╗       ██████╗  ██████╗  ██╗    ██╗ ███████╗ ██████╗',
  ' ██╔════╝ ██║      ██╔═══██╗ ██╔══██╗ ██║    ██║ ██╔════╝ ██╔══██╗',
  ' ███████╗ ██║      ██║   ██║ ██████╔╝ ██║ █╗ ██║ █████╗   ██████╔╝',
  ' ╚════██║ ██║      ██║   ██║ ██╔═══╝  ██║███╗██║ ██╔══╝   ██╔══██╗',
  ' ███████║ ███████╗ ╚██████╔╝ ██║      ╚███╔███╔╝ ███████╗ ██████╔╝',
  ' ╚══════╝ ╚══════╝  ╚═════╝  ╚═╝       ╚══╝╚══╝  ╚══════╝ ╚═════╝'
];
const LOGO_COLORS = ['97;33;210', '19;31;159', '35;143;255', '35;139;255', '97;33;210', '19;31;159'];
let interactiveScreenActive = false;

function supportsColor() {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function color(text, rgb) {
  return supportsColor() ? `\x1b[38;2;${rgb}m${text}\x1b[0m` : text;
}

function renderBanner() {
  return BANNER_LINES
    .map((line, index) => color(line, LOGO_COLORS[index % LOGO_COLORS.length]))
    .join('\n');
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
  console.log(`${renderBanner()}

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

Generation uses local OpenAI-compatible servers through Vercel AI SDK, or Codex through OAuth.
The server is local-only by default and opens at http://localhost:8787.
Press Ctrl+C to stop the running server.`);
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

function renderRunningScreen({ host, port }) {
  const url = `http://${displayHost(host)}:${port}`;
  if (!process.stdout.isTTY) return;
  enterInteractiveScreen();
  const provider = process.env.SLOPWEB_PROVIDER || process.env.AI_PROVIDER || (process.env.SLOPWEB_BASE_URL || process.env.AI_SDK_BASE_URL ? 'local' : 'auto');
  const lines = [
    renderBanner(),
    '',
    'Slopweb is running',
    '',
    `  URL      ${url}`,
    `  Provider ${provider}`,
    process.env.SLOPWEB_MODEL ? `  Model    ${process.env.SLOPWEB_MODEL}` : '',
    process.env.SLOPWEB_BASE_URL ? `  Base URL ${process.env.SLOPWEB_BASE_URL}` : '',
    '',
    'Press Ctrl+C to stop Slopweb.'
  ].filter(line => line !== '');
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
  return `${statusMarker(model.live)} ${model.providerName} · ${model.id} (${state})`;
}

function statusMarker(live) {
  if (!supportsColor()) return live ? '🟢' : '🔴';
  return live ? color('●', '34;197;94') : color('●', '239;68;68');
}

function codexChoiceLabel(status) {
  return `${statusMarker(Boolean(status?.connected))} Codex OAuth (${status?.connected ? 'connected' : 'not connected'})`;
}

async function waitForJson(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
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
    const child = spawn(model.runtime, ['serve'], { stdio: 'ignore', detached: true });
    child.unref();
    const origin = originFromBaseUrl(model.baseUrl);
    if (!(await waitForJson(`${origin}/api/tags`, 15_000))) {
      throw new Error('Ollama did not become ready. Start Ollama, then run `slopweb models` again.');
    }
    return { ...model, live: true };
  }

  if (model.providerId === 'llamacpp' && model.filePath) {
    const port = await choosePort(8080, '127.0.0.1');
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const args = ['--model', model.filePath, '--host', '127.0.0.1', '--port', String(port)];
    const child = spawn(model.runtime, args, { stdio: 'ignore', detached: true });
    child.unref();
    if (!(await waitForJson(`${baseUrl}/models`, 60_000))) {
      throw new Error(`llama.cpp did not become ready for ${model.filePath}.`);
    }
    return { ...model, baseUrl, live: true };
  }

  throw new Error(`${model.providerName} model is installed, but Slopweb does not know how to start this runtime yet.`);
}

function clearInteractiveScreen() {
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
}

function writeInteractiveFrame(text, cursorPosition = null) {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${text}\n`);
    return;
  }
  process.stdout.write(`\x1b[H${text}\x1b[J`);
  if (cursorPosition) process.stdout.write(`\x1b[${cursorPosition.row};${cursorPosition.column}H\x1b[?25h`);
}

function enterInteractiveScreen() {
  if (!process.stdout.isTTY || interactiveScreenActive) return;
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
  interactiveScreenActive = true;
}

function exitInteractiveScreen() {
  if (!interactiveScreenActive) return;
  process.stdout.write('\x1b[?25h\x1b[?1049l');
  interactiveScreenActive = false;
}

function renderInputBox(value = '') {
  const width = Math.min(78, Math.max(42, Number(process.stdout.columns || 80) - 6));
  const top = `╭${'─'.repeat(width)}╮`;
  const bottom = `╰${'─'.repeat(width)}╯`;
  const visible = [...String(value || '')].slice(-Math.max(0, width - 5)).join('');
  const content = `> ${visible}`.padEnd(Math.max(0, width - 2), ' ');
  return `${top}\n│ ${content} │\n${bottom}`;
}

function inputBoxWidth() {
  return Math.min(78, Math.max(42, Number(process.stdout.columns || 80) - 6));
}

function inputCursorColumn(value = '') {
  const visibleChars = [...String(value || '')].slice(-Math.max(0, inputBoxWidth() - 5)).length;
  return 5 + visibleChars;
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

function filteredChoices(choices, query) {
  const text = normalizedSearchText(query);
  if (!text) return choices;
  const terms = text.split(/\s+/).filter(Boolean);
  return choices.filter(choice => terms.every(term => choiceSearchText(choice).includes(term)));
}

function renderLaunchPicker({ choices, index, models, installed, commandBuffer, message }) {
  const visibleChoices = filteredChoices(choices, commandBuffer);
  const safeIndex = visibleChoices.length ? Math.min(index, visibleChoices.length - 1) : 0;
  const lines = [`${renderBanner()}`];
  if (!models.length) {
    lines.push('No local models detected.');
    if (installed.length) lines.push(`Installed runtimes: ${installed.map(item => item.name).join(', ')}`);
  }
  lines.push('', renderInputBox(commandBuffer || ''));
  const inputTopRow = lines.length - 1;
  if (message) lines.push('', message);
  if (commandBuffer && !visibleChoices.length) lines.push('', `No matches for "${commandBuffer}".`);
  lines.push('');
  visibleChoices.forEach((choice, choiceIndex) => {
    const pointer = choiceIndex === safeIndex ? color('›', '35;143;255') : ' ';
    lines.push(`${pointer} ${choice.label}`);
  });
  lines.push('', 'Type to filter  ↑/↓ select  Enter choose  Esc clear  Ctrl+C quit');
  writeInteractiveFrame(lines.join('\n'), { row: inputTopRow + 2, column: inputCursorColumn(commandBuffer) });
}

function selectLaunchChoice(state) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let index = 0;
    let commandBuffer = null;
    let message = state.message || '';

    const done = result => {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw));
      resolve(result);
    };

    const render = () => {
      const visibleChoices = filteredChoices(state.choices, commandBuffer);
      if (visibleChoices.length && index >= visibleChoices.length) index = visibleChoices.length - 1;
      renderLaunchPicker({ ...state, index, commandBuffer, message });
    };

    const onData = chunk => {
      const key = String(chunk);
      if (key === '\u0003') {
        exitInteractiveScreen();
        process.stdout.write('\n');
        process.exit(130);
      }
      if (commandBuffer !== null) {
        if (key === '\u001b') {
          commandBuffer = null;
          message = state.message || '';
          render();
          return;
        }
        if (key === '\r' || key === '\n') {
          const visibleChoices = filteredChoices(state.choices, commandBuffer);
          if (visibleChoices.length) done({ type: 'choice', choice: visibleChoices[Math.min(index, visibleChoices.length - 1)] });
          else {
            message = `No matches for "${commandBuffer}".`;
            render();
          }
          return;
        }
        if (key === '\u007f' || key === '\b') {
          commandBuffer = commandBuffer.length > 1 ? commandBuffer.slice(0, -1) : null;
          index = 0;
          render();
          return;
        }
        if (/^[\x20-\x7e]$/.test(key)) {
          commandBuffer += key;
          index = 0;
          render();
        }
        return;
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
      if (key === '\r' || key === '\n') {
        const visibleChoices = filteredChoices(state.choices, commandBuffer);
        if (visibleChoices.length) done({ type: 'choice', choice: visibleChoices[Math.min(index, visibleChoices.length - 1)] });
        else {
          message = `No matches for "${commandBuffer || ''}".`;
          render();
        }
        return;
      }
      if (/^[\x20-\x7e]$/.test(key)) {
        commandBuffer = key;
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
      const lines = [`${renderBanner()}`, '', title];
      if (message) lines.push('', message);
      lines.push('', renderInputBox(text));
      const inputTopRow = lines.length - 1;
      lines.push(color('hint:', '127;127;127') + ` ${label}${hint ? `, e.g. ${hint}` : ''}`, '', 'Enter accept  Esc cancel  Ctrl+C quit');
      writeInteractiveFrame(lines.join('\n'), { row: inputTopRow + 2, column: inputCursorColumn(text) });
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

async function promptText(question) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('\x1b[?25h');
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
    process.stdout.write('\x1b[?25l');
  }
}

async function pauseForEnter() {
  await promptText('\nPress Enter to return to the launcher.');
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
    hint: 'llama3.2',
    message: 'Enter the model id exposed by that server.'
  });
  if (model.cancelled || !model.value) return null;
  return {
    baseUrl: baseUrlInput.value || 'http://localhost:11434/v1',
    model: model.value
  };
}

async function runLaunchPicker(options = {}) {
  const { detectLocalModels, detectInstalledLocalRuntimes, LOCAL_MODELS_CONFIG } = await import('../app/lib/localModels.js');
  let message = '';

  enterInteractiveScreen();
  try {
    while (true) {
      const models = await detectLocalModels();
      const installed = detectInstalledLocalRuntimes();
      const codex = await import('../app/lib/codexLauncher.js').then(mod => mod.codexStatus()).catch(() => ({ connected: false }));
      const choices = models.slice(0, 9).map(model => ({
        kind: 'local',
        label: modelChoiceLabel(model),
        model
      }));
      choices.push({ kind: 'codex', label: codexChoiceLabel(codex) });
      choices.push({ kind: 'manual', label: 'Manual local endpoint' });

      if (!models.length && !message) message = `Custom local providers can live at ${LOCAL_MODELS_CONFIG}`;
      const result = await selectLaunchChoice({ choices, models, installed, message });
      message = '';

      let choice = result.choice;
      if (result.type === 'command') {
        message = 'Type to filter the model list, then press Enter.';
        continue;
      }

      if (choice.kind === 'local') {
        const model = options.autostart === false ? choice.model : await startDetectedRuntime(choice.model);
        process.env.SLOPWEB_PROVIDER = 'local';
        process.env.SLOPWEB_BASE_URL = model.baseUrl;
        process.env.SLOPWEB_MODEL = model.id;
        return;
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
      console.log(`  ${statusMarker(model.live)} ${model.providerName}\t${model.id}\t${state}\t${location}`);
    }
    return;
  }

  console.log('No local models detected.');
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
