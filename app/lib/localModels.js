import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const LOCAL_MODELS_CONFIG = path.join(os.homedir(), '.slopweb', 'models.json');

const DETECT_TIMEOUT_MS = Number(process.env.SLOPWEB_DETECT_TIMEOUT_MS || 700);
const DETECT_CACHE_MS = Number(process.env.SLOPWEB_DETECT_CACHE_MS || 5_000);
const MAX_MODEL_FILES = 80;
let localModelsCache = null;

const OPENAI_COMPAT_PROBES = [
  { providerId: 'lmstudio', name: 'LM Studio', baseUrl: process.env.LMSTUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1' },
  { providerId: 'llamacpp', name: 'llama.cpp / llamafile', baseUrl: process.env.LLAMA_CPP_BASE_URL || process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8080/v1' },
  { providerId: 'vllm', name: 'vLLM', baseUrl: process.env.VLLM_BASE_URL || 'http://127.0.0.1:8000/v1' },
  { providerId: 'sglang', name: 'SGLang', baseUrl: process.env.SGLANG_BASE_URL || 'http://127.0.0.1:30000/v1' },
  { providerId: 'jan', name: 'Jan', baseUrl: process.env.JAN_BASE_URL || 'http://127.0.0.1:1337/v1' },
  { providerId: 'textgen', name: 'text-generation-webui', baseUrl: process.env.TEXTGEN_BASE_URL || 'http://127.0.0.1:5000/v1' },
  { providerId: 'koboldcpp', name: 'KoboldCpp', baseUrl: process.env.KOBOLDCPP_BASE_URL || 'http://127.0.0.1:5001/v1' },
  { providerId: 'localai', name: 'LocalAI', baseUrl: process.env.LOCALAI_BASE_URL || 'http://127.0.0.1:8080/v1' },
  { providerId: 'litellm', name: 'LiteLLM', baseUrl: process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1' },
  { providerId: 'tabbyapi', name: 'TabbyAPI', baseUrl: process.env.TABBYAPI_BASE_URL || 'http://127.0.0.1:5000/v1' },
  { providerId: 'aphrodite', name: 'Aphrodite Engine', baseUrl: process.env.APHRODITE_BASE_URL || 'http://127.0.0.1:2242/v1' },
  { providerId: 'xinference', name: 'Xinference', baseUrl: process.env.XINFERENCE_BASE_URL || 'http://127.0.0.1:9997/v1' },
  { providerId: 'openwebui', name: 'Open WebUI', baseUrl: process.env.OPENWEBUI_BASE_URL || process.env.OPEN_WEBUI_BASE_URL || 'http://127.0.0.1:3000/v1' },
  { providerId: 'anythingllm', name: 'AnythingLLM', baseUrl: process.env.ANYTHINGLLM_BASE_URL || 'http://127.0.0.1:3001/v1' }
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

async function fetchJson(url, timeoutMs = DETECT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
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

function parseOpenAiModels(json, provider) {
  const items = Array.isArray(json?.data) ? json.data : [];
  return items.map(item => makeModel(provider, item?.id || item?.name, { name: item?.name })).filter(Boolean);
}

function parseOllamaModels(json, provider) {
  const items = Array.isArray(json?.models) ? json.models : [];
  return items.map(item => makeModel(provider, item?.name || item?.model, { name: item?.name || item?.model })).filter(Boolean);
}

function dedupeModels(models) {
  const seen = new Set();
  const deduped = [];
  for (const model of models) {
    const key = `${model.baseUrl}|${model.id}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(model);
  }
  return deduped;
}

function configuredProviders(raw) {
  const providers = raw && typeof raw === 'object' && raw.providers && typeof raw.providers === 'object'
    ? raw.providers
    : {};
  return Object.entries(providers).map(([id, provider]) => {
    const baseUrl = openAiBaseUrl(provider?.baseUrl || provider?.baseURL || provider?.url);
    const models = Array.isArray(provider?.models) ? provider.models : [];
    if (!baseUrl) return null;
    return {
      providerId: String(id),
      name: String(provider?.name || id),
      baseUrl,
      source: 'config',
      models: models
        .map(model => makeModel({ providerId: String(id), name: String(provider?.name || id), baseUrl, source: 'config' }, typeof model === 'string' ? model : model?.id, { name: typeof model === 'object' ? model?.name : '' }))
        .filter(Boolean)
    };
  }).filter(Boolean);
}

export async function readLocalModelsConfig() {
  try {
    return JSON.parse(await readFile(LOCAL_MODELS_CONFIG, 'utf8'));
  } catch {
    return { providers: {} };
  }
}

function commandPath(command) {
  const tool = process.platform === 'win32' ? 'where.exe' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(tool, args, { encoding: 'utf8', shell: process.platform !== 'win32' });
  if (result.status !== 0) return '';
  return String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || '';
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

async function probeOllama() {
  const origin = ollamaOrigin();
  const provider = makeOllamaProvider('detected', true);
  const json = await fetchJson(urlJoin(origin, '/api/tags'));
  return parseOllamaModels(json, provider);
}

async function probeOpenAiProvider(provider) {
  const baseUrl = openAiBaseUrl(provider.baseUrl);
  const json = await fetchJson(urlJoin(baseUrl, '/models'));
  return parseOpenAiModels(json, { ...provider, baseUrl });
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
  return String(process.env.SLOPWEB_BASE_URLS || '')
    .split(/[;,]/g)
    .map((value, index) => ({ providerId: `custom${index + 1}`, name: 'Custom local endpoint', baseUrl: value.trim() }))
    .filter(provider => provider.baseUrl);
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
  const [ollamaCli, ollamaManifests, ggufModels] = await Promise.all([
    detectOllamaCliModels().catch(() => []),
    detectOllamaManifests().catch(() => []),
    detectGgufModels().catch(() => [])
  ]);
  return [...ollamaCli, ...ollamaManifests, ...ggufModels];
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
    probes.push(probeOllama().catch(() => []));
  }
  for (const probe of [...configuredOpenAiProbes(), ...OPENAI_COMPAT_PROBES]) {
    if (configuredProviderIds.has(probe.providerId.toLowerCase())) continue;
    probes.push(probeOpenAiProvider(probe).catch(() => []));
  }

  const [detected, catalog] = await Promise.all([
    Promise.all(probes).then(results => results.flat()),
    detectModelCatalog()
  ]);
  return sortDetectedModels(dedupeModels([...configuredModels, ...detected, ...catalog]));
}

export async function detectLocalModels(options = {}) {
  const key = localModelsCacheKey();
  const now = Date.now();
  if (options.cache !== false && localModelsCache?.key === key) {
    if (localModelsCache.value && localModelsCache.expiresAt > now) return localModelsCache.value;
    if (localModelsCache.promise) return localModelsCache.promise;
  }

  const promise = scanLocalModels()
    .then(models => {
      localModelsCache = { key, value: models, expiresAt: Date.now() + DETECT_CACHE_MS, promise: null };
      return models;
    })
    .catch(error => {
      if (localModelsCache?.promise === promise) localModelsCache = null;
      throw error;
    });

  localModelsCache = { key, value: null, expiresAt: 0, promise };
  return promise;
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

  const models = await detectLocalModels();
  const candidates = options.requireLive || options.verify ? models.filter(model => model.live) : models;
  return preferredModel(candidates, requestedModel);
}

export function detectInstalledLocalRuntimes() {
  return [
    ['ollama', 'Ollama'],
    ['llama-server', 'llama.cpp server'],
    ['llama-cli', 'llama.cpp CLI'],
    ['llamafile', 'llamafile']
  ].map(([command, name]) => ({ command, name, path: commandPath(command) })).filter(item => item.path);
}
