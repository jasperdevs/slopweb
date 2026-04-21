import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config, stripWrappingQuotes, ROOT_DIR } from './config.js';
import { unique, stripAnsi } from './utils.js';

let resolvedCodexBinCache = null;
let codexStatusCache = null;
const CODEX_STATUS_CACHE_MS = 30_000;

function hasPathSeparator(value) {
  return /[\\/]/.test(String(value || ''));
}

function windowsExecutableRank(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.exe') return 0;
  if (ext === '.cmd') return 1;
  if (ext === '.bat') return 2;
  if (ext === '.ps1') return 3;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 4;
  return 5;
}

function sortWindowsCandidates(values) {
  if (process.platform !== 'win32') return unique(values);
  return unique(values)
    .map((value, index) => ({ value, index }))
    .sort((a, b) => windowsExecutableRank(a.value) - windowsExecutableRank(b.value) || a.index - b.index)
    .map(item => item.value);
}

function commandCandidatesFromDirectory(dir) {
  if (!dir) return [];
  const names = process.platform === 'win32'
    ? ['codex.exe', 'codex.cmd', 'codex.bat', 'codex.ps1', 'codex.js', 'codex']
    : ['codex'];
  return names.map(name => path.join(dir, name));
}

function smallCommand(command, args) {
  try {
    return spawnSync(command, args, { encoding: 'utf8', shell: false, timeout: 5_000, windowsHide: true });
  } catch {
    return null;
  }
}

function lookupCodexOnPath(commandName = 'codex') {
  const result = process.platform === 'win32'
    ? smallCommand('where.exe', [commandName])
    : smallCommand('which', [commandName]);
  if (result?.status !== 0 || !result.stdout) return [];
  return unique(result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
}

function npmGlobalBinDirs() {
  const dirs = [];
  const commands = process.platform === 'win32'
    ? [['npm.cmd', ['prefix', '-g']], ['npm.exe', ['prefix', '-g']], ['npm', ['prefix', '-g']]]
    : [['npm', ['prefix', '-g']]];

  for (const [command, args] of commands) {
    const result = smallCommand(command, args);
    if (result?.status === 0 && result.stdout) {
      const prefix = result.stdout.trim().split(/\r?\n/).pop();
      if (prefix) dirs.push(process.platform === 'win32' ? prefix : path.join(prefix, 'bin'));
      break;
    }
  }
  return dirs;
}

function pnpmGlobalBinDirs() {
  const dirs = [];
  const commands = process.platform === 'win32'
    ? [['pnpm.cmd', ['bin', '-g']], ['pnpm.exe', ['bin', '-g']], ['pnpm', ['bin', '-g']]]
    : [['pnpm', ['bin', '-g']]];
  for (const [command, args] of commands) {
    const result = smallCommand(command, args);
    if (result?.status === 0 && result.stdout) {
      const dir = result.stdout.trim().split(/\r?\n/).pop();
      if (dir) dirs.push(dir);
      break;
    }
  }
  return dirs;
}

function readJsonFileSync(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function codexEntrypointCandidatesFromPackageRoot(root) {
  if (!root) return [];
  const candidates = [];
  const add = value => {
    if (!value) return;
    candidates.push(path.isAbsolute(value) ? value : path.join(root, value));
  };

  const packageJson = readJsonFileSync(path.join(root, 'package.json'));
  const bin = packageJson?.bin;
  if (typeof bin === 'string') add(bin);
  else if (bin && typeof bin === 'object') {
    add(bin.codex);
    Object.values(bin).forEach(add);
  }

  ['bin/codex.js', 'bin/codex.mjs', 'bin/codex.cjs', 'bin/codex', 'dist/cli.js', 'dist/codex.js', 'codex.js'].forEach(add);
  return unique(candidates);
}

function codexPackageRootsNearBinDir(dir) {
  if (!dir) return [];
  return unique([
    path.join(dir, 'node_modules', '@openai', 'codex'),
    path.join(dir, '..', 'lib', 'node_modules', '@openai', 'codex'),
    path.join(dir, '..', 'node_modules', '@openai', 'codex'),
    path.join(ROOT_DIR, '..', 'node_modules', '@openai', 'codex'),
    path.join(ROOT_DIR, 'node_modules', '@openai', 'codex')
  ]);
}

function codexPackageScriptCandidatesForShim(shimPath) {
  if (!shimPath || !hasPathSeparator(shimPath)) return [];
  const dir = path.dirname(shimPath);
  const candidates = [];

  for (const root of codexPackageRootsNearBinDir(dir)) candidates.push(...codexEntrypointCandidatesFromPackageRoot(root));

  try {
    const raw = readFileSync(shimPath, 'utf8');
    const expanded = raw
      .replaceAll('%~dp0', dir + path.sep)
      .replaceAll('%dp0%', dir + path.sep)
      .replaceAll('$basedir', dir)
      .replaceAll('${basedir}', dir);

    const patterns = [
      /[A-Za-z]:[^"'\r\n]*node_modules[\\/]+@openai[\\/]+codex[\\/]+(?:bin|dist)[\\/]+[^"'\r\n\s)]+/gi,
      /[^"'\r\n\s]*node_modules[\\/]+@openai[\\/]+codex[\\/]+(?:bin|dist)[\\/]+[^"'\r\n\s)]+/gi
    ];
    for (const pattern of patterns) {
      for (const match of expanded.match(pattern) || []) {
        const normalized = match.replaceAll('/', path.sep).replaceAll('\\', path.sep);
        candidates.push(path.isAbsolute(normalized) ? normalized : path.resolve(dir, normalized));
      }
    }
  } catch {}

  return unique(candidates);
}

function resolveCodexEntrypointNearShim(shimPath) {
  for (const candidate of codexPackageScriptCandidatesForShim(shimPath)) {
    try { if (existsSync(candidate)) return candidate; }
    catch {}
  }
  return null;
}

function getCodexSearchCandidates(rawCommand) {
  const command = stripWrappingQuotes(rawCommand || 'codex');
  const candidates = [];
  const add = value => { if (value) candidates.push(stripWrappingQuotes(value)); };

  if (hasPathSeparator(command)) {
    add(command);
    if (process.platform === 'win32' && !/\.(exe|cmd|bat|ps1|js|mjs|cjs)$/i.test(command)) {
      add(`${command}.exe`);
      add(`${command}.cmd`);
      add(`${command}.bat`);
      add(`${command}.ps1`);
      add(`${command}.js`);
    }
    return sortWindowsCandidates(candidates);
  } else {
    lookupCodexOnPath(command).forEach(add);
  }

  commandCandidatesFromDirectory(path.join(ROOT_DIR, '..', 'node_modules', '.bin')).forEach(add);
  commandCandidatesFromDirectory(path.join(ROOT_DIR, 'node_modules', '.bin')).forEach(add);
  String(process.env.PATH || '').split(path.delimiter).map(stripWrappingQuotes).filter(Boolean).forEach(dir => commandCandidatesFromDirectory(dir).forEach(add));

  if (process.platform === 'win32') {
    [
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm'),
      process.env.PNPM_HOME,
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'pnpm'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'nodejs')
    ].forEach(dir => commandCandidatesFromDirectory(dir).forEach(add));
  } else {
    const home = os.homedir();
    [process.env.PNPM_HOME, home && path.join(home, '.npm-global', 'bin'), home && path.join(home, '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']
      .forEach(dir => commandCandidatesFromDirectory(dir).forEach(add));
  }

  if (!hasPathSeparator(command)) add(command);
  return unique(candidates);
}

function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function cmdCommandPart(value) {
  const text = String(value);
  return /\s|[&()^%!"<>|]/.test(text) || hasPathSeparator(text) ? quoteForCmd(text) : text;
}

function cmdLine(command, args) {
  return ['call', cmdCommandPart(command), ...args.map(quoteForCmd)].join(' ');
}

function powershellPath() {
  if (process.env.SystemRoot) return path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return 'powershell.exe';
}

function specForEntrypoint(entrypoint, args, labelPrefix = 'Codex') {
  const ext = path.extname(entrypoint).toLowerCase();
  if (/\.(js|mjs|cjs)$/i.test(ext)) {
    return { command: process.execPath || 'node', args: [entrypoint, ...args], label: `${labelPrefix}: node ${entrypoint}`, found: true, normalizedFrom: entrypoint };
  }
  if (process.platform === 'win32') {
    if (ext === '.exe') return { command: entrypoint, args, label: `${labelPrefix}: ${entrypoint}`, found: true };
    if (ext === '.cmd' || ext === '.bat') {
      return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', cmdLine(entrypoint, args)], label: `${labelPrefix}: ${entrypoint}`, found: true };
    }
    if (ext === '.ps1') {
      return { command: powershellPath(), args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', entrypoint, ...args], label: `${labelPrefix}: ${entrypoint}`, found: true };
    }
    return null;
  }
  return { command: entrypoint, args, label: `${labelPrefix}: ${entrypoint}`, found: true };
}

function makeSpawnSpecForCandidate(candidate, args) {
  const value = stripWrappingQuotes(candidate);
  if (!value) return null;

  if (hasPathSeparator(value)) {
    try { if (!existsSync(value)) return null; }
    catch { return null; }

    const ext = path.extname(value).toLowerCase();
    if (process.platform === 'win32' && ['.cmd', '.bat', '.ps1'].includes(ext)) {
      const entrypoint = resolveCodexEntrypointNearShim(value);
      if (entrypoint) {
        const spec = specForEntrypoint(entrypoint, args, `Codex npm shim ${value}`);
        if (spec) return { ...spec, shim: value };
      }
    }
    return specForEntrypoint(value, args, 'Codex');
  }

  if (process.platform === 'win32') {
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', cmdLine(value, args)], label: `${value} via cmd.exe PATH`, found: false };
  }
  return { command: value, args, label: value, found: false };
}

function makeWindowsShellSpec(command, args, label = `${command} via cmd.exe PATH`) {
  return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', cmdLine(command, args)], label, found: false };
}

export function makeCodexSpawnSpecs(rawCommand = config.codexBin, args = []) {
  const specs = [];
  const seen = new Set();
  const addSpec = spec => {
    if (!spec) return;
    const key = `${spec.command}\u0000${JSON.stringify(spec.args)}`;
    if (seen.has(key)) return;
    seen.add(key);
    specs.push(spec);
  };

  for (const candidate of getCodexSearchCandidates(rawCommand)) addSpec(makeSpawnSpecForCandidate(candidate, args));
  if (hasPathSeparator(stripWrappingQuotes(rawCommand || ''))) return specs;

  if (process.platform === 'win32') {
    addSpec(makeWindowsShellSpec('codex', args));
    addSpec(makeWindowsShellSpec('npx', ['--yes', '@openai/codex', ...args], 'npx @openai/codex via cmd.exe'));
    addSpec(makeWindowsShellSpec('npm', ['exec', '--yes', '@openai/codex', '--', ...args], 'npm exec @openai/codex via cmd.exe'));
  } else {
    addSpec(makeSpawnSpecForCandidate('codex', args));
    addSpec(makeSpawnSpecForCandidate('npx', ['--yes', '@openai/codex', ...args]));
    addSpec(makeSpawnSpecForCandidate('npm', ['exec', '--yes', '@openai/codex', '--', ...args]));
  }

  return specs;
}

export function resolveCodexBin(rawCommand = config.codexBin) {
  if (resolvedCodexBinCache && resolvedCodexBinCache.rawCommand === rawCommand) return resolvedCodexBinCache;
  const candidates = getCodexSearchCandidates(rawCommand);
  const specs = makeCodexSpawnSpecs(rawCommand, []);
  const primary = specs[0] || { command: stripWrappingQuotes(rawCommand || 'codex'), label: stripWrappingQuotes(rawCommand || 'codex'), found: false };
  resolvedCodexBinCache = { rawCommand, command: primary.command, label: primary.label, found: Boolean(primary.found), candidates, specs: specs.map(spec => spec.label) };
  return resolvedCodexBinCache;
}

export function spawnWithSpec(spec, options = {}) {
  const child = spawn(spec.command, spec.args, {
    cwd: options.cwd || ROOT_DIR,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.stdio || ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true
  });
  child.slopwebCommand = spec.label;
  child.slopwebSpec = spec;
  return child;
}

export function isLauncherFailureText(text) {
  return /\bENOENT\b|\bEINVAL\b|\bUNKNOWN\b|not recognized as an internal or external command|operable program or batch file|command not found|no such file or directory|cannot find the path|unable to locate.*codex|missing optional dependency/i.test(String(text || ''));
}

export function isLauncherFailureResult(result) {
  if (!result) return true;
  if (result.errorCode && /^(ENOENT|EINVAL|UNKNOWN)$/i.test(result.errorCode)) return true;
  const output = [result.error, result.stdout, result.stderr].filter(Boolean).join('\n');
  return result.code !== 0 && isLauncherFailureText(output);
}

export function summarizeAttempts(attempts) {
  return attempts
    .map((attempt, index) => {
      const bits = [`${index + 1}. ${attempt.label}`];
      if (attempt.code !== undefined && attempt.code !== null) bits.push(`exit ${attempt.code}`);
      if (attempt.errorCode) bits.push(attempt.errorCode);
      const text = String(attempt.error || attempt.stderr || attempt.stdout || '').trim();
      if (text) bits.push(text.split(/\r?\n/).slice(0, 3).join(' '));
      return bits.join(' - ');
    })
    .join('\n');
}

function possibleCodexAuthFiles() {
  const homes = unique([process.env.CODEX_HOME, os.homedir(), process.env.HOME, process.env.USERPROFILE]);
  const files = [];
  for (const home of homes) {
    if (!home) continue;
    if (path.basename(home).toLowerCase() === '.codex') files.push(path.join(home, 'auth.json'));
    else files.push(path.join(home, '.codex', 'auth.json'));
  }
  return unique(files);
}

function hasLocalCodexAuthFile() {
  return possibleCodexAuthFiles().some(file => {
    try { return existsSync(file); }
    catch { return false; }
  });
}

export function spawnCaptureWithSpec(spec, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnWithSpec(spec, { cwd: options.cwd || ROOT_DIR, env: options.env || {}, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;
    let killedByAbort = false;
    let forceKillTimer = null;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      forceKillTimer.unref?.();
    }, options.timeoutMs || config.codexTimeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener?.('abort', abortChild);
    };

    const abortChild = () => {
      if (killedByAbort) return;
      killedByAbort = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      forceKillTimer.unref?.();
    };

    if (options.signal?.aborted) abortChild();
    else options.signal?.addEventListener?.('abort', abortChild, { once: true });

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', error => {
      cleanup();
      if (killedByAbort) {
        resolve({ code: null, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), killedByTimeout, killedByAbort, command: spec.label, spec });
        return;
      }
      reject(Object.assign(error, { codexCommand: spec.label, spec, errorCode: error.code }));
    });
    child.on('close', code => {
      cleanup();
      resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), killedByTimeout, killedByAbort, command: spec.label, spec });
    });

    if (options.stdin) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

export async function spawnCapture(command, args, options = {}) {
  const specs = makeCodexSpawnSpecs(command || config.codexBin, args);
  const attempts = [];
  const resolved = resolveCodexBin(command || config.codexBin);

  for (const spec of specs) {
    try {
      const result = await spawnCaptureWithSpec(spec, options);
      if (result.killedByAbort) return result;
      if (isLauncherFailureResult(result)) {
        attempts.push({ label: spec.label, code: result.code, stdout: result.stdout, stderr: result.stderr });
        continue;
      }
      result.attempts = attempts;
      return result;
    } catch (error) {
      attempts.push({ label: spec.label, error: error.message, errorCode: error.code || error.errorCode });
      if (isLauncherFailureResult({ error: error.message, errorCode: error.code || error.errorCode, code: 1 })) continue;
      error.codexCommand = spec.label;
      error.candidates = resolved.candidates || [];
      error.attempts = attempts;
      throw error;
    }
  }

  const error = new Error(`Could not launch Codex after ${attempts.length} attempts.\n${summarizeAttempts(attempts)}`);
  error.codexCommand = specs[0]?.label || resolved.label;
  error.candidates = resolved.candidates || [];
  error.attempts = attempts;
  throw error;
}

export async function codexStatus() {
  if (codexStatusCache && Date.now() - codexStatusCache.createdAt < CODEX_STATUS_CACHE_MS) return codexStatusCache.status;

  const resolved = resolveCodexBin(config.codexBin);
  try {
    const result = await spawnCapture(config.codexBin, ['login', 'status'], { timeoutMs: 15_000 });
    const rawMessage = (result.stdout || result.stderr || '').trim();
    const hardCommandFailure = result.code !== 0 && isLauncherFailureText(rawMessage);
    const connected = !hardCommandFailure && (result.code === 0 || process.env.CODEX_SKIP_AUTH_CHECK === '1' || hasLocalCodexAuthFile());
    const status = { connected, provider: 'codex', binary: result.command || resolved.label, foundBinary: resolved.found, message: rawMessage || (connected ? 'Codex is connected.' : 'Codex is not connected.'), code: result.code };
    codexStatusCache = { createdAt: Date.now(), status };
    return status;
  } catch (error) {
    const status = {
      connected: false,
      provider: 'codex',
      binary: error.codexCommand || resolved.label,
      foundBinary: resolved.found,
      message: 'Could not run Codex from this app process after trying npm shims, direct node entrypoints, Windows CMD wrappers, and npx fallback.',
      error: error.message,
      attempts: (error.attempts || []).slice(0, 12),
      candidates: unique([...(error.candidates || resolved.candidates || []), ...(resolved.specs || [])]).slice(0, 24)
    };
    codexStatusCache = { createdAt: Date.now(), status };
    return status;
  }
}
