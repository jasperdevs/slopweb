import { stripAnsi, escapeHtml } from './utils.js';

export function normalizeAddress(address) {
  const raw = String(address || '').trim().replace(/^synthetic:\/\//i, 'slopweb://');
  if (!raw) return 'slopweb://home';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `slopweb://local${raw}`;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
  return `slopweb://search/${encodeURIComponent(raw)}`;
}

export function sanitizeGeneratedHtml(html) {
  let cleaned = String(html || '');
  cleaned = repairSlopwebWrappedExternalUrls(cleaned);
  cleaned = stripVisibleInternalBranding(cleaned);
  cleaned = cleaned.replace(/(href|src|action|formaction)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
  cleaned = cleaned.replace(/(href|src|action|formaction)\s*=\s*javascript:[^\s>]+/gi, '$1="#"');
  cleaned = cleaned.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '');
  cleaned = cleaned.replace(/<iframe\b[^>]*\/?\s*>/gi, '');
  cleaned = cleaned.replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, '');
  cleaned = cleaned.replace(/<embed\b[^>]*\/?\s*>/gi, '');
  cleaned = cleaned.replace(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi, '');
  cleaned = moveHeadAssetsAfterVisibleBody(cleaned);
  if (!/^\s*<!doctype html>/i.test(cleaned)) cleaned = `<!doctype html>\n${cleaned}`;
  return cleaned.trim();
}

function moveHeadAssetsAfterVisibleBody(html) {
  let doc = String(html || '');
  const headMatch = doc.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  const bodyMatch = doc.match(/<body\b[^>]*>/i);
  if (!headMatch || !bodyMatch || typeof headMatch.index !== 'number' || typeof bodyMatch.index !== 'number') return doc;

  const styles = [];
  const scripts = [];
  const nextHead = headMatch[1]
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, block => {
      styles.push(block);
      return '';
    })
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, block => {
      scripts.push(block);
      return '';
    });
  if (!styles.length && !scripts.length) return doc;

  doc = `${doc.slice(0, headMatch.index)}${headMatch[0].replace(headMatch[1], nextHead)}${doc.slice(headMatch.index + headMatch[0].length)}`;
  if (styles.length) doc = insertAfterFirstBodyBlock(doc, styles.join('\n'));
  if (scripts.length) doc = insertBeforeBodyClose(doc, scripts.join('\n'));
  return doc;
}

function insertAfterFirstBodyBlock(doc, html) {
  const bodyMatch = doc.match(/<body\b[^>]*>/i);
  if (!bodyMatch || typeof bodyMatch.index !== 'number') return `${doc}\n${html}`;
  const bodyStart = bodyMatch.index + bodyMatch[0].length;
  const tail = doc.slice(bodyStart);
  const firstBlock = tail.match(/<\/(?:header|section|article|div|ul|ol)\s*>/i);
  const insertAt = firstBlock && typeof firstBlock.index === 'number'
    ? bodyStart + firstBlock.index + firstBlock[0].length
    : bodyStart;
  return `${doc.slice(0, insertAt)}\n${html}\n${doc.slice(insertAt)}`;
}

function insertBeforeBodyClose(doc, html) {
  const closeMatch = doc.match(/<\/body\s*>/i);
  if (!closeMatch || typeof closeMatch.index !== 'number') return `${doc}\n${html}`;
  return `${doc.slice(0, closeMatch.index)}\n${html}\n${doc.slice(closeMatch.index)}`;
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

  const bodyFragment = htmlFragmentIndex(unfenced);
  if (bodyFragment >= 0) return wrapHtmlFragment(unfenced.slice(bodyFragment));

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Generated page</title></head><body>${escapeHtml(unfenced)}</body></html>`;
}

function htmlFragmentIndex(text) {
  return String(text || '').search(/<(?:main|header|nav|section|article|aside|div|form|h1|h2|p|ul|ol|table)\b/i);
}

function wrapHtmlFragment(fragment) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Generated page</title></head><body>${mixedMarkdownToHtml(fragment)}</body></html>`;
}

function repairSlopwebWrappedExternalUrls(html) {
  return String(html || '').replace(/\bslopweb:\/\/(https?:\/\/[^\s"'<>)]*)/gi, '$1');
}

function stripVisibleInternalBranding(html) {
  return String(html || '')
    .replace(/>([^<]*)</g, (match, text) => {
      if (!/\bslopp?y?\s*web\b/i.test(text)) return match;
      return `>${cleanInternalBrandText(text) || 'Home'}<`;
    })
    .replace(/\b(placeholder|title|aria-label|alt|value)\s*=\s*(["'])(.*?)\2/gi, (match, name, quote, value) => {
      if (!/\bslopp?y?\s*web\b/i.test(value)) return match;
      return `${name}=${quote}${cleanInternalBrandText(value)}${quote}`;
    });
}

function cleanInternalBrandText(text) {
  return String(text || '')
    .replace(/\bslopp?y?\s*web\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-:|]+|[\s\-:|]+$/g, '')
    .trim();
}

function mixedMarkdownToHtml(text) {
  const lines = String(text || '').split(/\r?\n/);
  const output = [];
  let list = null;

  const closeList = () => {
    if (!list) return;
    output.push(`</${list}>`);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      output.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (list !== 'ol') {
        closeList();
        output.push('<ol>');
        list = 'ol';
      }
      output.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (list !== 'ul') {
        closeList();
        output.push('<ul>');
        list = 'ul';
      }
      output.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }
    closeList();
    output.push(line.includes('<') ? line : `<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  return output.join('\n');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${escapeHtml(repairSlopwebWrappedExternalUrls(href))}">${label}</a>`);
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
