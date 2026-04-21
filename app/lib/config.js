import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
export const ROOT_DIR = path.dirname(path.dirname(__filename));
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const ASSETS_DIR = path.join(ROOT_DIR, '..', 'assets');

export const config = Object.freeze({
  version: process.env.SLOPWEB_VERSION || '1.0.0',
  port: Number(process.env.PORT || 8787),
  allowLan: process.env.SLOPWEB_ALLOW_LAN === '1',
  host: process.env.HOST || (process.env.SLOPWEB_ALLOW_LAN === '1' ? '0.0.0.0' : 'localhost'),
  codexBin: stripWrappingQuotes(process.env.CODEX_BIN || 'codex'),
  codexModel: process.env.CODEX_MODEL || 'gpt-5.3-codex-spark',
  codexReasoningEffort: process.env.CODEX_REASONING_EFFORT || 'low',
  codexTimeoutMs: Number(process.env.CODEX_TIMEOUT_MS || 120_000),
  aiProvider: (process.env.SLOPWEB_PROVIDER || process.env.AI_PROVIDER || 'auto').toLowerCase(),
  aiSdkModel: process.env.SLOPWEB_MODEL || process.env.AI_SDK_MODEL || '',
  aiSdkBaseUrl: stripWrappingQuotes(process.env.SLOPWEB_BASE_URL || process.env.AI_SDK_BASE_URL || ''),
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
  if (['local', 'ai-sdk'].includes(config.aiProvider)) return true;
  return config.aiProvider === 'auto' || Boolean(config.aiSdkBaseUrl);
}
