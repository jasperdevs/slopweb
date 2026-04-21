import { config } from './config.js';
import { resolveLocalModel } from './localModels.js';

const warmups = new Map();

function timeoutOptions() {
  const totalMs = Number(config.aiSdkTimeoutMs || 120_000);
  return {
    totalMs,
    stepMs: totalMs,
    chunkMs: Math.min(25_000, Math.max(8_000, Math.floor(totalMs / 4)))
  };
}

function baseOrigin(baseUrl) {
  return String(baseUrl || '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
}

async function postJson(url, body, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function aiSdkStatus() {
  const resolved = await resolveLocalModel({ verify: true });
  const connected = Boolean(resolved);
  return {
    connected,
    provider: 'ai-sdk',
    runtime: resolved?.providerId || 'local',
    binary: 'Vercel AI SDK',
    foundBinary: connected,
    model: resolved?.id || config.aiSdkModel || '',
    baseUrl: resolved?.baseUrl || config.aiSdkBaseUrl || '',
    message: connected
      ? `Using ${resolved.id} through ${resolved.providerName} at ${resolved.baseUrl}.`
      : 'No local model server detected. Start Ollama, LM Studio, llama.cpp, vLLM, SGLang, Jan, text-generation-webui, or pass --base-url and --model.',
    code: connected ? 0 : 1
  };
}

export async function loadAiSdkModel() {
  const resolved = await resolveLocalModel({ requireLive: true });
  if (!resolved) {
    throw new Error('No local model server detected. Run `slopweb models`, start a local model server, or pass --base-url and --model.');
  }

  const [{ streamText, generateText }, { createOpenAICompatible }] = await Promise.all([
    import('ai'),
    import('@ai-sdk/openai-compatible')
  ]);

  const provider = createOpenAICompatible({
    name: resolved.providerId || 'local',
    baseURL: resolved.baseUrl,
    includeUsage: true
  });

  return {
    generateText,
    streamText,
    smoothStream,
    model: provider(resolved.id),
    label: `${resolved.id} via ${resolved.providerName}`,
    providerOptions: undefined,
    timeout: timeoutOptions()
  };
}

export async function warmLocalModel() {
  const resolved = await resolveLocalModel({ requireLive: true });
  if (!resolved) return null;

  const key = `${resolved.baseUrl}|${resolved.id}`.toLowerCase();
  if (warmups.has(key)) return warmups.get(key);

  const warmup = postJson(`${baseOrigin(resolved.baseUrl)}/v1/chat/completions`, {
    model: resolved.id,
    messages: [{ role: 'user', content: 'OK' }],
    max_tokens: 1,
    temperature: 0,
    stream: false
  }).then(() => resolved).catch(() => null).finally(() => {
    setTimeout(() => warmups.delete(key), 60_000).unref?.();
  });

  warmups.set(key, warmup);
  return warmup;
}
