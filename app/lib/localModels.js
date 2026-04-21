import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const LOCAL_MODELS_CONFIG = path.join(os.homedir(), '.slopweb', 'models.json');

const DETECT_TIMEOUT_MS = Number(process.env.SLOPWEB_DETECT_TIMEOUT_MS || 700);

const OPENAI_COMPAT_PROBES = [
  { providerId: 'lmstudio', name: 'LM Studio', baseUrl: process.env.LMSTUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1' },
  { providerId: 'llamacpp', name: 'llama.cpp / llamafile', baseUrl: process.env.LLAMA_CPP_BASE_URL || process.env.LLAMACPP_BASE_URL || 'http://127.0.0.1:8080/v1' },
  { providerId: 'vllm', name: 'vLLM', baseUrl: process.env.VLLM_BASE_URL || 'http://127.0.0.1:8000/v1' },
  { providerId: 'sglang', name: 'SGLang', baseUrl: process.env.SGLANG_BASE_URL || 'http://127.0.0.1:30000/v1' },
  { providerId: 'jan', name: 'Jan', baseUrl: process.env.JAN_BASE_URL || 'http://127.0.0.1:1337/v1' },
  { providerId: 'textgen', name: 'text-generation-webui', baseUrl: process.env.TEXTGEN_BASE_URL || 'http://127.0.0.1:5000/v1' },
  { providerId: 'koboldcpp', name: 'KoboldCpp', baseUrl: process.env.KOBOLDCPP_BASE_URL || 'http://127.0.0.1:5001/v1' }
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
    source: extra.source || provider.source || 'detected'
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
    const key = `${model.providerId}|${model.baseUrl}|${model.id}`.toLowerCase();
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

async function probeOllama() {
  const origin = serviceOrigin(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434');
  const provider = { providerId: 'ollama', name: 'Ollama', baseUrl: `${origin}/v1` };
  const json = await fetchJson(urlJoin(origin, '/api/tags'));
  return parseOllamaModels(json, provider);
}

async function probeOpenAiProvider(provider) {
  const baseUrl = openAiBaseUrl(provider.baseUrl);
  const json = await fetchJson(urlJoin(baseUrl, '/models'));
  return parseOpenAiModels(json, { ...provider, baseUrl });
}

export async function detectLocalModels() {
  const configured = configuredProviders(await readLocalModelsConfig());
  const configuredModels = configured.flatMap(provider => provider.models);
  const configuredProviderIds = new Set(configured.map(provider => provider.providerId.toLowerCase()));
  const probes = [];

  if (!configuredProviderIds.has('ollama')) {
    probes.push(probeOllama().catch(() => []));
  }
  for (const probe of OPENAI_COMPAT_PROBES) {
    if (configuredProviderIds.has(probe.providerId.toLowerCase())) continue;
    probes.push(probeOpenAiProvider(probe).catch(() => []));
  }

  const detected = (await Promise.all(probes)).flat();
  return dedupeModels([...configuredModels, ...detected]);
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
  return preferredModel(models, requestedModel);
}

function commandPath(command) {
  const tool = process.platform === 'win32' ? 'where.exe' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(tool, args, { encoding: 'utf8', shell: process.platform !== 'win32' });
  if (result.status !== 0) return '';
  return String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || '';
}

export function detectInstalledLocalRuntimes() {
  return [
    ['ollama', 'Ollama'],
    ['llama-server', 'llama.cpp server'],
    ['llama-cli', 'llama.cpp CLI'],
    ['llamafile', 'llamafile']
  ].map(([command, name]) => ({ command, name, path: commandPath(command) })).filter(item => item.path);
}
