import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { debugTiming, nowMs } from './diagnostics.js';

export const LOCAL_MODELS_CONFIG = path.join(os.homedir(), '.slopweb', 'models.json');

const DETECT_TIMEOUT_MS = Number(process.env.SLOPWEB_DETECT_TIMEOUT_MS || 700);
const LIVE_DETECT_TIMEOUT_MS = Number(process.env.SLOPWEB_LIVE_DETECT_TIMEOUT_MS || 220);
const DETECT_CACHE_MS = Number(process.env.SLOPWEB_DETECT_CACHE_MS || 5_000);
const MAX_MODEL_FILES = 80;
let localModelsCache = null;
let liveModelsCache = null;
let firstLiveModelCache = null;
let configCache = null;
const commandPathCache = new Map();
const providerProbeCache = new Map();
const PROVIDER_PRIORITY = new Map([
  ['config', 0],
  ['custom1', 5],
  ['custom2', 6],
  ['ollama', 10],
  ['lmstudio', 20],
  ['llamacpp', 30],
  ['vllm', 40],
  ['sglang', 50],
  ['jan', 60],
  ['msty', 70],
  ['textgen', 80],
  ['koboldcpp', 90],
  ['localai', 100],
  ['litellm', 110],
  ['tabbyapi', 120],
  ['aphrodite', 130],
  ['xinference', 140],
  ['openwebui', 150],
  ['anythingllm', 160],
  ['gpt4all', 170]
]);

const OPENAI_COMPAT_PROBES = [
  { providerId: 'lmstudio', name: 'LM Studio', baseUrl: process.env.LMSTUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1' },
  { providerId: 'llamacpp', name: 'llama.cpp / llamafile', baseUrl: process.env.LLAMA_CPP_BASE_URL || process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8080/v1' },
  { providerId: 'vllm', name: 'vLLM', baseUrl: process.env.VLLM_BASE_URL || 'http://127.0.0.1:8000/v1' },
  { providerId: 'sglang', name: 'SGLang', baseUrl: process.env.SGLANG_BASE_URL || 'http://127.0.0.1:30000/v1' },
  { providerId: 'jan', name: 'Jan', baseUrl: process.env.JAN_BASE_URL || 'http://127.0.0.1:1337/v1', apiKey: process.env.JAN_API_KEY || '' },
  { providerId: 'msty', name: 'Msty', baseUrl: process.env.MSTY_BASE_URL || 'http://127.0.0.1:10000/v1' },
  { providerId: 'textgen', name: 'text-generation-webui', baseUrl: process.env.TEXTGEN_BASE_URL || 'http://127.0.0.1:5000/v1' },
  { providerId: 'koboldcpp', name: 'KoboldCpp', baseUrl: process.env.KOBOLDCPP_BASE_URL || 'http://127.0.0.1:5001/v1' },
  { providerId: 'localai', name: 'LocalAI', baseUrl: process.env.LOCALAI_BASE_URL || 'http://127.0.0.1:8080/v1', apiKey: process.env.LOCALAI_API_KEY || '' },
  { providerId: 'litellm', name: 'LiteLLM', baseUrl: process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1', apiKey: process.env.LITELLM_API_KEY || '' },
  { providerId: 'tabbyapi', name: 'TabbyAPI', baseUrl: process.env.TABBYAPI_BASE_URL || 'http://127.0.0.1:5000/v1' },
  { providerId: 'aphrodite', name: 'Aphrodite Engine', baseUrl: process.env.APHRODITE_BASE_URL || 'http://127.0.0.1:2242/v1' },
  { providerId: 'xinference', name: 'Xinference', baseUrl: process.env.XINFERENCE_BASE_URL || 'http://127.0.0.1:9997/v1' },
  { providerId: 'openwebui', name: 'Open WebUI', baseUrl: process.env.OPENWEBUI_BASE_URL || process.env.OPEN_WEBUI_BASE_URL || 'http://127.0.0.1:3000/v1', apiKey: process.env.OPENWEBUI_API_KEY || process.env.OPEN_WEBUI_API_KEY || '' },
  { providerId: 'anythingllm', name: 'AnythingLLM', baseUrl: process.env.ANYTHINGLLM_BASE_URL || 'http://127.0.0.1:3001/v1', apiKey: process.env.ANYTHINGLLM_API_KEY || '' },
  { providerId: 'gpt4all', name: 'GPT4All', baseUrl: process.env.GPT4ALL_BASE_URL || 'http://127.0.0.1:4891/v1' }
];

function normalizeUrl(value) {
  let text = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  return text.replace(/\/+$/, '');
}

function openAiBaseUrl(value) {
  const base = normalizeUrl(value);
  if (!base) return '';
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

function serviceOrigin(value) {
  const base = normalizeUrl(value);
  if (!base) return '';
  return base.replace(/\/v1$/i, '');
}

function urlJoin(base, pathname) {
  return `${normalizeUrl(base)}/${String(pathname || '').replace(/^\/+/, '')}`;
}

async function fetchJson(url, timeoutMs = DETECT_TIMEOUT_MS, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function modelName(id) {
  return String(id || '').replace(/:latest$/i, '').replace(/[._-]+/g, ' ').trim();
}

function makeModel(provider, id, extra = {}) {
  const modelId = String(id || '').trim();
  if (!modelId) return null;
  return {
    providerId: provider.providerId,
    providerName: provider.name,
    id: modelId,
    name: extra.name || modelName(modelId) || modelId,
    baseUrl: openAiBaseUrl(provider.baseUrl),
    source: extra.source || provider.source || 'detected',
    live: extra.live ?? provider.live ?? true,
    filePath: extra.filePath || '',
    runtime: extra.runtime || provider.runtime || ''
  };
}

function providerAuthHeaders(provider) {
  const apiKey = String(provider?.apiKey || '').trim();
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function parseOpenAiModels(json, provider) {
  const items = Array.isArray(json?.data) ? json.data
    : Array.isArray(json?.models) ? json.models
      : Array.isArray(json) ? json
        : [];
  return items.map(item => {
    if (typeof item === 'string') return makeModel(provider, item);
    return makeModel(provider, item?.id || item?.name || item?.model, { name: item?.name || item?.model });
  }).filter(Boolean);
}

function parseOllamaModels(json, provider) {
  const items = Array.isArray(json?.models) ? json.models : [];
  return items.map(item => makeModel(provider, item?.name || item?.model, { name: item?.name || item?.model })).filter(Boolean);
}

function dedupeModels(models) {
  const seen = new Set();
  const deduped = [];
  for (const model of models) {
    const key = model.filePath ? `file:${path.resolve(model.filePath)}`.toLowerCase() : `${model.baseUrl}|${model.id}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(model);
  }
  return deduped;
}

function providerPriority(model) {
  const id = String(model?.providerId || '').toLowerCase();
  if (model?.source === 'config') return PROVIDER_PRIORITY.get('config');
  return PROVIDER_PRIORITY.get(id) ?? 500;
}

function configuredProviders(raw) {
  const providers = raw && typeof raw === 'object' && raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)
    ? Object.entries(raw.providers)
    : Array.isArray(raw?.providers)
      ? raw.providers.map((provider, index) => [provider?.id || provider?.providerId || `custom${index + 1}`, provider])
      : [];
  return providers.map(([id, provider]) => {
    const baseUrl = openAiBaseUrl(provider?.baseUrl || provider?.baseURL || provider?.url);
    const models = Array.isArray(provider?.models) ? provider.models : [];
    if (!baseUrl) return null;
    const providerId = String(provider?.providerId || id);
    const name = String(provider?.name || id);
    return {
      providerId,
      name,
      baseUrl,
      apiKey: provider?.apiKey || provider?.key || '',
      source: 'config',
      models: models
        .map(model => makeModel({ providerId, name, baseUrl, source: 'config' }, typeof model === 'string' ? model : model?.id, { name: typeof model === 'object' ? model?.name : '' }))
        .filter(Boolean)
    };
  }).filter(Boolean);
}

export async function readLocalModelsConfig() {
  const now = Date.now();
  if (configCache?.value && configCache.expiresAt > now) return configCache.value;
  if (configCache?.promise) return configCache.promise;

  const promise = readFile(LOCAL_MODELS_CONFIG, 'utf8')
    .then(text => JSON.parse(text))
    .catch(() => ({ providers: {} }))
    .then(value => {
      configCache = { value, expiresAt: Date.now() + DETECT_CACHE_MS, promise: null };
      return value;
    });
  configCache = { value: null, expiresAt: 0, promise };
  return promise;
}

function commandPath(command) {
  const key = `${process.platform}|${process.env.PATH || ''}|${command}`;
  if (commandPathCache.has(key)) return commandPathCache.get(key);
  const tool = process.platform === 'win32' ? 'where.exe' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(tool, args, { encoding: 'utf8', shell: process.platform !== 'win32' });
  const found = result.status === 0
    ? String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || ''
    : '';
  commandPathCache.set(key, found);
  return found;
}

function ollamaOrigin() {
  return serviceOrigin(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434');
}

function makeOllamaProvider(source = 'detected', live = true) {
  const origin = ollamaOrigin();
  return {
    providerId: 'ollama',
    name: 'Ollama',
    baseUrl: `${origin}/v1`,
    source,
    live,
    runtime: commandPath('ollama')
  };
}

async function probeOllama(timeoutMs = DETECT_TIMEOUT_MS) {
  const origin = ollamaOrigin();
  const provider = makeOllamaProvider('detected', true);
  const json = await fetchJson(urlJoin(origin, '/api/tags'), timeoutMs);
  return parseOllamaModels(json, provider);
}

async function probeOpenAiProvider(provider, options = {}) {
  const baseUrl = openAiBaseUrl(provider.baseUrl);
  const cacheKey = `openai:${baseUrl}:${provider.apiKey ? 'auth' : 'anon'}`.toLowerCase();
  const now = Date.now();
  if (options.cache !== false) {
    const cached = providerProbeCache.get(cacheKey);
    if (cached?.value && cached.expiresAt > now) return cached.value;
    if (cached?.promise) return cached.promise;
  }

  const promise = fetchJson(urlJoin(baseUrl, '/models'), Number(options.timeoutMs || DETECT_TIMEOUT_MS), providerAuthHeaders(provider))
    .then(json => {
      const models = parseOpenAiModels(json, { ...provider, baseUrl });
      providerProbeCache.set(cacheKey, { value: models, expiresAt: Date.now() + DETECT_CACHE_MS, promise: null });
      return models;
    })
    .catch(error => {
      const cached = providerProbeCache.get(cacheKey);
      if (cached?.promise === promise) providerProbeCache.delete(cacheKey);
      throw error;
    });

  providerProbeCache.set(cacheKey, { value: null, expiresAt: 0, promise });
  return promise;
}

async function probeOllamaCached(options = {}) {
  const origin = ollamaOrigin();
  const cacheKey = `ollama:${origin}`.toLowerCase();
  const now = Date.now();
  if (options.cache !== false) {
    const cached = providerProbeCache.get(cacheKey);
    if (cached?.value && cached.expiresAt > now) return cached.value;
    if (cached?.promise) return cached.promise;
  }

  const promise = probeOllama(Number(options.timeoutMs || DETECT_TIMEOUT_MS))
    .then(models => {
      providerProbeCache.set(cacheKey, { value: models, expiresAt: Date.now() + DETECT_CACHE_MS, promise: null });
      return models;
    })
    .catch(error => {
      const cached = providerProbeCache.get(cacheKey);
      if (cached?.promise === promise) providerProbeCache.delete(cacheKey);
      throw error;
    });

  providerProbeCache.set(cacheKey, { value: null, expiresAt: 0, promise });
  return promise;
}

function configuredSearchRoots() {
  const roots = [
    process.env.SLOPWEB_MODEL_DIRS,
    path.join(os.homedir(), '.lmstudio', 'models'),
    path.join(os.homedir(), 'Library', 'Application Support', 'LM Studio', 'models'),
    path.join(os.homedir(), 'Library', 'Caches', 'lm-studio', 'models'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'LM Studio', 'models'),
    path.join(os.homedir(), 'AppData', 'Local', 'LM Studio', 'models'),
    path.join(os.homedir(), '.cache', 'lm-studio', 'models'),
    path.join(os.homedir(), '.cache', 'huggingface', 'hub'),
    path.join(os.homedir(), 'Library', 'Caches', 'huggingface', 'hub'),
    path.join(os.homedir(), 'AppData', 'Local', 'huggingface', 'hub'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Jan', 'models'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Jan', 'models'),
    path.join(os.homedir(), 'jan', 'models'),
    path.join(os.homedir(), '.jan', 'models'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'nomic.ai', 'GPT4All'),
    path.join(os.homedir(), 'AppData', 'Local', 'nomic.ai', 'GPT4All'),
    path.join(os.homedir(), 'Library', 'Application Support', 'nomic.ai', 'GPT4All'),
    path.join(os.homedir(), '.local', 'share', 'nomic.ai', 'GPT4All'),
    path.join(os.homedir(), '.cache', 'gpt4all'),
    path.join(os.homedir(), '.msty', 'models'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Msty', 'models'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Msty', 'models'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'anythingllm-desktop', 'storage', 'models'),
    path.join(os.homedir(), 'Library', 'Application Support', 'anythingllm-desktop', 'storage', 'models'),
    path.join(os.homedir(), '.local', 'share', 'llama.cpp', 'models'),
    path.join(os.homedir(), 'AppData', 'Local', 'llama.cpp', 'models'),
    path.join(os.homedir(), 'models'),
    path.join(os.homedir(), 'Models')
  ];
  return roots
    .flatMap(value => String(value || '').split(/[;,]/g))
    .map(value => value.trim())
    .filter(Boolean);
}

function configuredOpenAiProbes() {
  const explicit = String(process.env.SLOPWEB_BASE_URLS || '')
    .split(/[;,]/g)
    .map((value, index) => ({ providerId: `custom${index + 1}`, name: 'Custom local endpoint', baseUrl: value.trim() }))
    .filter(provider => provider.baseUrl);
  const envUrls = [
    ['OPENAI_BASE_URL', process.env.OPENAI_BASE_URL],
    ['OPENAI_API_BASE', process.env.OPENAI_API_BASE],
    ['OPENAI_API_BASE_URL', process.env.OPENAI_API_BASE_URL]
  ].map(([name, value]) => ({
    providerId: name.toLowerCase(),
    name: 'OpenAI-compatible local endpoint',
    baseUrl: value,
    apiKey: process.env.OPENAI_API_KEY || ''
  })).filter(provider => provider.baseUrl && isLikelyLocalUrl(provider.baseUrl));
  return dedupeProviders([...explicit, ...envUrls]);
}

function dedupeProviders(providers) {
  const seen = new Set();
  return providers.filter(provider => {
    const key = openAiBaseUrl(provider.baseUrl).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isLikelyLocalUrl(value) {
  try {
    const hostname = new URL(normalizeUrl(value)).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname === '0.0.0.0' || hostname === 'host.docker.internal') return true;
    if (hostname.endsWith('.local')) return true;
    if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
    const match = hostname.match(/^172\.(\d+)\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch {
    return false;
  }
}

function runJsonCommand(command, args, timeout = 2500) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

async function listDirEntries(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function findFilesByExtension(root, extensions, options = {}) {
  const files = [];
  const maxDepth = Number(options.maxDepth || 5);
  const limit = Number(options.limit || MAX_MODEL_FILES);
  const seen = new Set();

  async function walk(dir, depth) {
    if (files.length >= limit || depth > maxDepth) return;
    const normalized = path.resolve(dir).toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);

    const entries = await listDirEntries(dir);
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name.startsWith('.') && depth > 0) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  await walk(root, 0);
  return files;
}

async function detectGgufModels() {
  const command = commandPath('llama-server') || commandPath('llamafile');
  if (!command) return [];
  const provider = {
    providerId: 'llamacpp',
    name: 'llama.cpp',
    baseUrl: process.env.LLAMA_CPP_BASE_URL || process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8080/v1',
    source: 'catalog',
    live: false,
    runtime: command
  };
  const roots = configuredSearchRoots();
  const batches = await Promise.all(roots.map(root => findFilesByExtension(root, ['.gguf'], { maxDepth: 5, limit: 30 }).catch(() => [])));
  return batches.flat().filter(file => !/(^|[.\-_])mmproj([.\-_]|$)/i.test(path.basename(file))).slice(0, MAX_MODEL_FILES).map(file => makeModel(provider, path.basename(file, path.extname(file)), {
    filePath: file,
    name: path.basename(file, path.extname(file)),
    source: 'catalog',
    live: false
  })).filter(Boolean);
}

function resolveModelFilePath(filePath) {
  if (!filePath) return '';
  if (path.isAbsolute(filePath) && existsSync(filePath)) return filePath;
  for (const root of configuredSearchRoots()) {
    const candidate = path.join(root, filePath);
    if (existsSync(candidate)) return candidate;
  }
  return '';
}

function lmStudioModelId(item) {
  return item?.identifier || item?.modelIdentifier || item?.indexedModelIdentifier || item?.path || item?.modelKey || item?.displayName || '';
}

async function detectLmStudioCliModels() {
  const command = commandPath('lms');
  if (!command) return [];
  const json = runJsonCommand(command, ['ls', '--llm', '--json'], 6000);
  const items = Array.isArray(json) ? json : [];
  const provider = {
    providerId: 'lmstudio',
    name: 'LM Studio',
    baseUrl: process.env.LMSTUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1',
    source: 'catalog',
    live: false,
    runtime: command
  };
  return items.map(item => makeModel(provider, lmStudioModelId(item), {
    name: item?.displayName || item?.modelKey || '',
    filePath: resolveModelFilePath(item?.path || ''),
    source: 'catalog',
    live: false
  })).filter(Boolean);
}

function lmStudioServerBaseUrl(status) {
  const port = status?.port || status?.serverPort || status?.portNumber || 1234;
  return process.env.LMSTUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL || `http://127.0.0.1:${port}/v1`;
}

function detectRunningLmStudioModels() {
  const command = commandPath('lms');
  if (!command) return [];
  const status = runJsonCommand(command, ['server', 'status', '--json']);
  if (!status?.running) return [];
  const json = runJsonCommand(command, ['ps', '--json']);
  const items = Array.isArray(json) ? json : [];
  const provider = {
    providerId: 'lmstudio',
    name: 'LM Studio',
    baseUrl: lmStudioServerBaseUrl(status),
    source: 'process',
    live: true,
    runtime: command
  };
  return items.map(item => makeModel(provider, lmStudioModelId(item), {
    name: item?.displayName || item?.modelKey || '',
    filePath: resolveModelFilePath(item?.path || ''),
    source: 'process',
    live: true
  })).filter(Boolean);
}

function splitCommandLine(value) {
  const args = [];
  let current = '';
  let quote = '';
  for (const char of String(value || '')) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

function argValue(args, name) {
  const index = args.findIndex(arg => arg === name);
  return index >= 0 ? args[index + 1] || '' : '';
}

function runningLlamaServerCommandLines() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"name = 'llama-server.exe'\" | Select-Object -ExpandProperty CommandLine | ConvertTo-Json -Compress"
    ], { encoding: 'utf8', timeout: 2500 });
    if (result.status !== 0 || !result.stdout.trim()) return [];
    try {
      const parsed = JSON.parse(result.stdout);
      return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
    } catch {
      return [];
    }
  }

  const result = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8', timeout: 2500 });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout.split('\n').filter(line => /\bllama-server\b/.test(line));
}

function detectRunningLlamaServerModels() {
  const runtime = commandPath('llama-server');
  return runningLlamaServerCommandLines().map(commandLine => {
    const args = splitCommandLine(commandLine);
    const filePath = argValue(args, '--model') || argValue(args, '-m');
    const port = argValue(args, '--port') || '8080';
    const host = argValue(args, '--host') || '127.0.0.1';
    if (!filePath) return null;
    const provider = {
      providerId: 'llamacpp',
      name: 'llama.cpp',
      baseUrl: `http://${host}:${port}/v1`,
      source: 'process',
      live: true,
      runtime: runtime || args[0] || ''
    };
    return makeModel(provider, path.basename(filePath, path.extname(filePath)), {
      filePath,
      name: path.basename(filePath, path.extname(filePath)),
      source: 'process',
      live: true
    });
  }).filter(Boolean);
}

async function detectOllamaCliModels() {
  const command = commandPath('ollama');
  if (!command) return [];
  const result = spawnSync(command, ['list'], { encoding: 'utf8', timeout: 2500 });
  if (result.status !== 0 || !result.stdout) return [];

  const provider = makeOllamaProvider('cli', true);
  return String(result.stdout)
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim().split(/\s+/)[0])
    .filter(name => name && !/^(name|id)$/i.test(name))
    .map(name => makeModel(provider, name, { source: 'cli', live: true }))
    .filter(Boolean);
}

async function findOllamaManifestFiles() {
  const manifestsRoot = path.join(os.homedir(), '.ollama', 'models', 'manifests');
  return findFilesByExtension(manifestsRoot, [''], { maxDepth: 6, limit: MAX_MODEL_FILES });
}

function modelIdFromOllamaManifest(file) {
  const parts = file.split(/[\\/]+/);
  const manifestsIndex = parts.findIndex(part => part === 'manifests');
  if (manifestsIndex < 0 || parts.length < manifestsIndex + 5) return '';
  const after = parts.slice(manifestsIndex + 2);
  const tag = after.pop();
  const model = after.pop();
  const namespace = after.pop();
  if (!model || !tag) return '';
  return namespace && namespace !== 'library' ? `${namespace}/${model}:${tag}` : `${model}:${tag}`;
}

async function detectOllamaManifests() {
  const provider = makeOllamaProvider('catalog', false);
  const files = await findOllamaManifestFiles();
  return files
    .map(file => makeModel(provider, modelIdFromOllamaManifest(file), { source: 'catalog', live: false, runtime: provider.runtime }))
    .filter(Boolean);
}

async function detectModelCatalog() {
  const [ollamaCli, ollamaManifests, lmStudioCli, ggufModels] = await Promise.all([
    detectOllamaCliModels().catch(() => []),
    detectOllamaManifests().catch(() => []),
    detectLmStudioCliModels().catch(() => []),
    detectGgufModels().catch(() => [])
  ]);
  return [...ollamaCli, ...ollamaManifests, ...lmStudioCli, ...ggufModels];
}

function localModelsCacheKey() {
  return [
    process.env.SLOPWEB_BASE_URLS,
    process.env.SLOPWEB_MODEL_DIRS,
    process.env.SLOPWEB_BASE_URL,
    process.env.AI_SDK_BASE_URL,
    process.env.SLOPWEB_MODEL,
    process.env.AI_SDK_MODEL,
    process.env.OLLAMA_HOST
  ].map(value => String(value || '')).join('\n');
}

function sortDetectedModels(models) {
  return [...models].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    const priorityDelta = providerPriority(a) - providerPriority(b);
    if (priorityDelta) return priorityDelta;
    if (a.source !== b.source) return a.source === 'detected' ? -1 : 1;
    return `${a.providerName} ${a.id}`.localeCompare(`${b.providerName} ${b.id}`);
  });
}

async function scanLocalModels() {
  const configured = configuredProviders(await readLocalModelsConfig());
  const configuredModels = configured.flatMap(provider => provider.models);
  const configuredProviderIds = new Set(configured.map(provider => provider.providerId.toLowerCase()));
  const probes = [];

  if (!configuredProviderIds.has('ollama')) {
    probes.push(probeOllamaCached({ timeoutMs: LIVE_DETECT_TIMEOUT_MS }).catch(() => []));
  }
  for (const probe of configuredOpenAiProbes()) {
    if (configuredProviderIds.has(probe.providerId.toLowerCase())) continue;
    probes.push(probeOpenAiProvider(probe, { timeoutMs: DETECT_TIMEOUT_MS }).catch(() => []));
  }
  for (const probe of OPENAI_COMPAT_PROBES) {
    if (configuredProviderIds.has(probe.providerId.toLowerCase())) continue;
    probes.push(probeOpenAiProvider(probe, { timeoutMs: LIVE_DETECT_TIMEOUT_MS }).catch(() => []));
  }

  const [detected, running, catalog] = await Promise.all([
    Promise.all(probes).then(results => results.flat()),
    Promise.resolve([...detectRunningLlamaServerModels(), ...detectRunningLmStudioModels()]).catch(() => []),
    detectModelCatalog()
  ]);
  return sortDetectedModels(dedupeModels([...configuredModels, ...running, ...detected, ...catalog]));
}

async function probeConfiguredProvider(provider, options = {}) {
  const detected = await probeOpenAiProvider(provider, options);
  if (detected.length) return detected.map(model => ({ ...model, source: 'config' }));
  return provider.models;
}

async function scanLiveLocalModels() {
  const configured = configuredProviders(await readLocalModelsConfig());
  const configuredProviderIds = new Set(configured.map(provider => provider.providerId.toLowerCase()));
  const probes = configured.map(provider => probeConfiguredProvider(provider, { timeoutMs: DETECT_TIMEOUT_MS }).catch(() => []));

  if (!configuredProviderIds.has('ollama')) {
    probes.push(probeOllamaCached({ timeoutMs: LIVE_DETECT_TIMEOUT_MS }).catch(() => []));
  }
  for (const probe of configuredOpenAiProbes()) {
    if (configuredProviderIds.has(probe.providerId.toLowerCase())) continue;
    probes.push(probeOpenAiProvider(probe, { timeoutMs: DETECT_TIMEOUT_MS }).catch(() => []));
  }
  for (const probe of OPENAI_COMPAT_PROBES) {
    if (configuredProviderIds.has(probe.providerId.toLowerCase())) continue;
    probes.push(probeOpenAiProvider(probe, { timeoutMs: LIVE_DETECT_TIMEOUT_MS }).catch(() => []));
  }

  const [detected, running] = await Promise.all([
    Promise.all(probes).then(results => results.flat()),
    Promise.resolve([...detectRunningLlamaServerModels(), ...detectRunningLmStudioModels()]).catch(() => [])
  ]);
  return sortDetectedModels(dedupeModels([...running, ...detected]).filter(model => model.live));
}

export async function detectLocalModels(options = {}) {
  const startedAt = nowMs();
  const key = localModelsCacheKey();
  const now = Date.now();
  if (options.cache !== false && localModelsCache?.key === key) {
    if (localModelsCache.value && localModelsCache.expiresAt > now) return localModelsCache.value;
    if (localModelsCache.promise) return localModelsCache.promise;
  }

  const promise = scanLocalModels()
    .then(models => {
      localModelsCache = { key, value: models, expiresAt: Date.now() + DETECT_CACHE_MS, promise: null };
      debugTiming('localModels.full', startedAt, { count: models.length });
      return models;
    })
    .catch(error => {
      if (localModelsCache?.promise === promise) localModelsCache = null;
      throw error;
    });

  localModelsCache = { key, value: null, expiresAt: 0, promise };
  return promise;
}

export async function detectLiveLocalModels(options = {}) {
  const startedAt = nowMs();
  const key = localModelsCacheKey();
  const now = Date.now();
  if (options.cache !== false && liveModelsCache?.key === key) {
    if (liveModelsCache.value && liveModelsCache.expiresAt > now) return liveModelsCache.value;
    if (liveModelsCache.promise) return liveModelsCache.promise;
  }

  const promise = scanLiveLocalModels()
    .then(models => {
      liveModelsCache = { key, value: models, expiresAt: Date.now() + DETECT_CACHE_MS, promise: null };
      debugTiming('localModels.live', startedAt, { count: models.length });
      return models;
    })
    .catch(error => {
      if (liveModelsCache?.promise === promise) liveModelsCache = null;
      throw error;
    });

  liveModelsCache = { key, value: null, expiresAt: 0, promise };
  return promise;
}

async function findFirstLiveLocalModel(options = {}) {
  const startedAt = nowMs();
  const key = localModelsCacheKey();
  const now = Date.now();
  if (options.cache !== false && firstLiveModelCache?.key === key) {
    if (firstLiveModelCache.value && firstLiveModelCache.expiresAt > now) return firstLiveModelCache.value;
    if (firstLiveModelCache.promise) return firstLiveModelCache.promise;
  }

  const promise = raceFirstLiveLocalModel()
    .then(model => {
      firstLiveModelCache = { key, value: model, expiresAt: Date.now() + DETECT_CACHE_MS, promise: null };
      debugTiming('localModels.firstLive', startedAt, { provider: model?.providerName, model: model?.id });
      return model;
    })
    .catch(error => {
      if (firstLiveModelCache?.promise === promise) firstLiveModelCache = null;
      throw error;
    });
  firstLiveModelCache = { key, value: null, expiresAt: 0, promise };
  return promise;
}

async function raceFirstLiveLocalModel() {
  const configured = configuredProviders(await readLocalModelsConfig());
  const configuredChoice = await firstConfiguredLiveModel(configured);
  if (configuredChoice) return configuredChoice;

  const configuredProviderIds = new Set(configured.map(provider => provider.providerId.toLowerCase()));
  const probes = [];
  if (!configuredProviderIds.has('ollama')) {
    probes.push(probeOllamaCached({ timeoutMs: LIVE_DETECT_TIMEOUT_MS }));
  }
  for (const probe of configuredOpenAiProbes()) {
    if (configuredProviderIds.has(probe.providerId.toLowerCase())) continue;
    probes.push(probeOpenAiProvider(probe, { timeoutMs: DETECT_TIMEOUT_MS }));
  }
  for (const probe of OPENAI_COMPAT_PROBES) {
    if (configuredProviderIds.has(probe.providerId.toLowerCase())) continue;
    probes.push(probeOpenAiProvider(probe, { timeoutMs: LIVE_DETECT_TIMEOUT_MS }));
  }

  if (!probes.length) return null;
  try {
    return await Promise.any(probes.map(probe => probe
      .then(models => {
        const choice = preferredModel(sortDetectedModels(models.filter(model => model.live)), '');
        if (choice) return choice;
        throw new Error('No live model from this provider.');
      })));
  } catch {
    return null;
  }
}

async function firstConfiguredLiveModel(configured) {
  for (const provider of configured) {
    const models = await probeConfiguredProvider(provider, { timeoutMs: DETECT_TIMEOUT_MS }).catch(() => []);
    const choice = preferredModel(sortDetectedModels(models.filter(model => model.live)), '');
    if (choice) return choice;
  }
  return null;
}

function modelMatches(model, requested) {
  const text = String(requested || '').trim().toLowerCase();
  if (!text) return false;
  return [
    model.id,
    model.name,
    `${model.providerId}/${model.id}`,
    `${model.providerName}/${model.id}`
  ].some(value => String(value || '').toLowerCase() === text);
}

function preferredModel(models, requested) {
  if (!models.length) return null;
  if (requested) {
    const exact = models.find(model => modelMatches(model, requested));
    if (exact) return exact;
    const fuzzy = models.find(model => `${model.providerId} ${model.providerName} ${model.id} ${model.name}`.toLowerCase().includes(String(requested).toLowerCase()));
    if (fuzzy) return fuzzy;
  }
  return models[0];
}

export async function resolveLocalModel(options = {}) {
  const requestedModel = options.model ?? process.env.SLOPWEB_MODEL ?? process.env.AI_SDK_MODEL ?? '';
  const explicitBaseUrl = openAiBaseUrl(options.baseUrl ?? process.env.SLOPWEB_BASE_URL ?? process.env.AI_SDK_BASE_URL ?? '');
  if (explicitBaseUrl) {
    const models = await probeOpenAiProvider({ providerId: 'local', name: 'Local AI', baseUrl: explicitBaseUrl }).catch(() => []);
    const listed = preferredModel(models, requestedModel);
    if (listed) return listed;
    if (options.verify) return null;
    if (requestedModel) return makeModel({ providerId: 'local', name: 'Local AI', baseUrl: explicitBaseUrl, source: 'cli' }, requestedModel);
    return null;
  }

  if ((options.requireLive || options.verify) && !requestedModel && options.fast !== false) {
    return findFirstLiveLocalModel(options);
  }

  const candidates = options.requireLive || options.verify ? await detectLiveLocalModels(options) : await detectLocalModels(options);
  return preferredModel(candidates, requestedModel);
}

export function detectInstalledLocalRuntimes() {
  return [
    ['ollama', 'Ollama'],
    ['lms', 'LM Studio CLI'],
    ['llama-server', 'llama.cpp server'],
    ['llama-cli', 'llama.cpp CLI'],
    ['llamafile', 'llamafile']
  ].map(([command, name]) => ({ command, name, path: commandPath(command) })).filter(item => item.path);
}
