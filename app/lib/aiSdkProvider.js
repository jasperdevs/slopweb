import { config } from './config.js';
import { resolveLocalModel } from './localModels.js';

function timeoutOptions() {
  const totalMs = Number(config.aiSdkTimeoutMs || 120_000);
  return {
    totalMs,
    stepMs: totalMs,
    chunkMs: Math.min(25_000, Math.max(8_000, Math.floor(totalMs / 4)))
  };
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
  const resolved = await resolveLocalModel();
  if (!resolved) {
    throw new Error('No local model server detected. Run `slopweb models`, start a local model server, or pass --base-url and --model.');
  }

  const [{ streamText, generateText, smoothStream }, { createOpenAICompatible }] = await Promise.all([
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
