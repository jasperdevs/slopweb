export function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

export function debugEnabled() {
  return process.env.SLOPWEB_DEBUG_TIMING === '1' || process.env.SLOPWEB_DEBUG === '1';
}

export function debugTiming(label, startMs, fields = {}) {
  if (!debugEnabled()) return;
  const elapsedMs = Math.max(0, nowMs() - startMs);
  const detail = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  console.error(`[slopweb:timing] ${label} ${elapsedMs}ms${detail ? ` ${detail}` : ''}`);
}

