const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODELS_DEV_TIMEOUT_MS = Number(process.env.SLOPWEB_MODELS_DEV_TIMEOUT_MS || 1_500);
let modelsDevIndex = null;
let modelsDevPromise = null;

export function warmModelsDevIndex() {
  if (process.env.SLOPWEB_MODELS_DEV === '0') return Promise.resolve(null);
  if (modelsDevIndex) return Promise.resolve(modelsDevIndex);
  if (modelsDevPromise) return modelsDevPromise;

  modelsDevPromise = fetchModelsDevIndex()
    .then(index => {
      modelsDevIndex = index;
      return index;
    })
    .catch(() => null)
    .finally(() => {
      modelsDevPromise = null;
    });
  return modelsDevPromise;
}

export function modelGenerationProfile(model = {}) {
  const text = modelIdentity(model);
  const metadata = modelsDevIndex ? modelsDevIndex.get(bestModelsDevKey(model)) : null;
  const family = String(metadata?.family || '').toLowerCase();
  const isQwenThinking = /\bqwen[-_. ]?3(?:[.\-_ ]?\d+)?\b/i.test(text) || family === 'qwen' && /\bqwen[-_. ]?3/i.test(text);
  const isReasoningModel = Boolean(metadata?.reasoning)
    || isQwenThinking
    || /\b(qwq|deepseek[-_. ]?r1|gpt[-_. ]?oss|reasoner|reasoning|think(?:ing)?)\b/i.test(text);

  const promptPrefix = [
    isQwenThinking ? '/no_think' : '',
    isReasoningModel ? 'Do not output reasoning, analysis, or <think> blocks. Output final HTML immediately.' : ''
  ].filter(Boolean).join('\n');

  return {
    promptPrefix,
    reasoning: isReasoningModel,
    supportsTemperature: metadata?.temperature !== false,
    source: metadata ? 'models.dev' : 'heuristic'
  };
}

function modelIdentity(model) {
  return [
    model.id,
    model.name,
    model.model,
    model.label,
    model.providerName,
    model.providerId,
    model.filePath
  ].filter(Boolean).join(' ');
}

function bestModelsDevKey(model) {
  for (const value of [model.id, model.name, model.model, model.label]) {
    const key = modelKey(value);
    if (key && modelsDevIndex?.has(key)) return key;
    const compact = compactModelKey(value);
    if (compact && modelsDevIndex?.has(compact)) return compact;
  }
  return '';
}

async function fetchModelsDevIndex() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return buildModelsDevIndex(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function buildModelsDevIndex(data) {
  const index = new Map();
  for (const provider of Object.values(data || {})) {
    for (const model of Object.values(provider?.models || {})) {
      for (const key of [modelKey(model?.id), modelKey(model?.name), compactModelKey(model?.id), compactModelKey(model?.name)]) {
        if (key && !index.has(key)) index.set(key, model);
      }
    }
  }
  return index;
}

function modelKey(value) {
  return String(value || '').toLowerCase().trim();
}

function compactModelKey(value) {
  return modelKey(value)
    .split(/[\\/]/).pop()
    .replace(/\.(gguf|bin|safetensors)$/i, '')
    .replace(/[-_. ](?:ud[-_. ])?(?:iq\d[_\w]*|q\d(?:_[a-z0-9]+)*)$/i, '')
    .replace(/[-_. ](?:instruct|chat|latest)$/i, '');
}
