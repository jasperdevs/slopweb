import { stripAnsi, escapeHtml } from './utils.js';

export function normalizeAddress(address) {
  const raw = String(address || '').trim();
  if (!raw) return 'synthetic://home';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `synthetic://local${raw}`;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
  return `synthetic://search/${encodeURIComponent(raw)}`;
}

export function sanitizeGeneratedHtml(html) {
  let cleaned = String(html || '');
  cleaned = cleaned.replace(/(href|src|action|formaction)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
  cleaned = cleaned.replace(/(href|src|action|formaction)\s*=\s*javascript:[^\s>]+/gi, '$1="#"');
  cleaned = cleaned.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '');
  cleaned = cleaned.replace(/<iframe\b[^>]*\/?\s*>/gi, '');
  cleaned = cleaned.replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '');
  cleaned = cleaned.replace(/<embed\b[^>]*\/?\s*>/gi, '');
  cleaned = cleaned.replace(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi, '');
  if (!/^\s*<!doctype html>/i.test(cleaned)) cleaned = `<!doctype html>\n${cleaned}`;
  return cleaned.trim();
}

export function extractHtmlFromOutput(rawText) {
  const cleaned = stripAnsi(String(rawText || '')).trim();
  if (!cleaned) throw new Error('The generator returned an empty message.');

  try {
    const maybeJson = JSON.parse(cleaned);
    if (maybeJson && typeof maybeJson.html === 'string') return maybeJson.html;
  } catch {}

  const fence = cleaned.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const unfenced = fence ? fence[1].trim() : cleaned;
  const doctypeIndex = unfenced.search(/<!doctype\s+html>/i);
  if (doctypeIndex >= 0) return sliceCompleteDocument(unfenced.slice(doctypeIndex));

  const htmlIndex = unfenced.search(/<html[\s>]/i);
  if (htmlIndex >= 0) return `<!doctype html>\n${sliceCompleteDocument(unfenced.slice(htmlIndex))}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Generated page</title></head><body>${escapeHtml(unfenced)}</body></html>`;
}

function sliceCompleteDocument(text) {
  const endMatch = text.match(/<\/html\s*>/i);
  if (endMatch && typeof endMatch.index === 'number') return text.slice(0, endMatch.index + endMatch[0].length);
  return text;
}

export function hardenPagePayload(page, address) {
  const html = sanitizeGeneratedHtml(page?.html || '');
  return {
    title: cleanTitle(page?.title || titleFromHtml(html) || 'Generated page'),
    summary: String(page?.summary || `Generated page for ${address}.`).slice(0, 600),
    html,
    address,
    model: page?.model || 'local generator',
    authRequired: Boolean(page?.authRequired),
    authMessage: page?.authMessage || ''
  };
}

export function validateHtmlPagePayload(html, address, model = 'generator') {
  const safeHtml = sanitizeGeneratedHtml(html);
  return hardenPagePayload({
    title: titleFromHtml(safeHtml) || 'Generated page',
    summary: `Generated page for ${address}.`,
    html: safeHtml,
    model
  }, address);
}

function titleFromHtml(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return cleanTitle(match[1].replace(/<[^>]*>/g, ''));
}

function cleanTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}
