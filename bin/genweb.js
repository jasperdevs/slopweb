#!/usr/bin/env node

import net from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION = '1.0.0';

const COMMANDS = new Set(['start', 'login', 'status', 'logout', 'doctor', 'help']);

function hasFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function takeFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  const value = args[index + 1] || '';
  args.splice(index, 2);
  return value;
}

function printHelp() {
  console.log(`Genweb

Usage:
  genweb [start] [--port 8787] [--host localhost] [--strict-port] [--open]
  genweb login
  genweb status
  genweb logout
  genweb doctor

Examples:
  genweb
  genweb --port 9000 --open
  genweb login
  genweb status

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
  console.error('Run `genweb --help` for usage.');
  process.exit(1);
}

const command = COMMANDS.has(args[0]) ? args.shift() : 'start';
if (command === 'help') {
  printHelp();
  process.exit(0);
}

async function main() {
  if (command === 'start') return startServer();
  if (command === 'login') return runCodex(['login', '--device-auth']);
  if (command === 'logout') return runCodex(['logout']);
  if (command === 'status') return showStatus();
  if (command === 'doctor') return runDoctor();
  throw new Error(`Unknown command: ${command}`);
}

async function startServer() {
  const requestedPort = Number(takeFlag('--port') || process.env.PORT || 8787);
  const strictPort = hasFlag('--strict-port');
  const openBrowser = hasFlag('--open');
  const lan = hasFlag('--lan');
  const mock = hasFlag('--mock');
  const host = takeFlag('--host') || process.env.HOST || (lan ? '0.0.0.0' : 'localhost');

  if (mock) process.env.CODEX_MOCK = '1';
  if (lan || host === '0.0.0.0') process.env.CODEGEN_ALLOW_LAN = '1';
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
  process.chdir(resolve(rootDir, 'codegen-browser'));
  await import('../codegen-browser/server.js');
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

async function runCodex(codexArgs) {
  const { makeCodexSpawnSpecs, spawnWithSpec, isLauncherFailureResult, summarizeAttempts } = await import('../codegen-browser/lib/codexLauncher.js');
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
  const { codexStatus } = await import('../codegen-browser/lib/codexLauncher.js');
  const status = await codexStatus();
  console.log(status.connected ? 'Codex: connected' : 'Codex: not connected');
  if (status.provider) console.log(`Provider: ${status.provider}`);
  if (status.binary) console.log(`Binary: ${status.binary}`);
  if (status.message) console.log(status.message);
  process.exitCode = status.connected ? 0 : 1;
}

async function runDoctor() {
  console.log('Genweb doctor');
  console.log(`Node: ${process.version}`);
  console.log(`Package: ${rootDir}`);
  console.log('Default URL: http://localhost:8787');
  await showStatus();
}

main().catch(error => {
  console.error(error.message || String(error));
  process.exit(1);
});
