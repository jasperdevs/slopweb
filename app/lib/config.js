import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR = path.dirname(path.dirname(__filename));
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export const config = Object.freeze({
  port: Number(process.env.PORT || 8787),
  allowLan: process.env.SLOPWEB_ALLOW_LAN === '1',
  host: process.env.HOST || (process.env.SLOPWEB_ALLOW_LAN === '1' ? '0.0.0.0' : 'localhost'),
  codexBin: stripWrappingQuotes(process.env.CODEX_BIN || 'codex'),
  codexModel: process.env.CODEX_MODEL || 'gpt-5.3-codex-spark',
  codexReasoningEffort: process.env.CODEX_REASONING_EFFORT || 'low',
  codexTimeoutMs: Number(process.env.CODEX_TIMEOUT_MS || 120_000),
  codexMock: process.env.CODEX_MOCK === '1',
  aiProvider: (process.env.AI_PROVIDER || 'auto').toLowerCase(),
  aiSdkModel: process.env.AI_SDK_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  aiSdkTimeoutMs: Number(process.env.AI_SDK_TIMEOUT_MS || process.env.CODEX_TIMEOUT_MS || 120_000)
});

export function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return text.slice(1, -1);
  }
  return text;
}

export function shouldTryAiSdk() {
  if (config.aiProvider === 'codex') return false;
  if (config.aiProvider === 'ai-sdk') return true;
  return Boolean(process.env.OPENAI_API_KEY);
}
