const MAX_SOURCE_PREVIEW = 80000;
const REVEAL_CSS = `<style data-slopweb-reveal>
@media (prefers-reduced-motion:no-preference){
  html{background:#fff}
  body{animation:slopweb-page-in 280ms cubic-bezier(.2,0,0,1) both}
  body>*{animation:slopweb-materialize 520ms cubic-bezier(.2,0,0,1) both}
  body>*:nth-child(2){animation-delay:60ms}
  body>*:nth-child(3){animation-delay:120ms}
  main>*,section>*,article,aside,form,table,li{animation:slopweb-materialize 460ms cubic-bezier(.2,0,0,1) both}
  main>*:nth-child(2),section>*:nth-child(2),li:nth-child(2){animation-delay:70ms}
  main>*:nth-child(3),section>*:nth-child(3),li:nth-child(3){animation-delay:140ms}
  main>*:nth-child(4),section>*:nth-child(4),li:nth-child(4){animation-delay:210ms}
  a,button,input,select,textarea{transition-property:transform,opacity,filter,background-color,color,box-shadow;transition-duration:160ms;transition-timing-function:cubic-bezier(.2,0,0,1)}
  button:active,a:active{transform:scale(.96)}
}
@keyframes slopweb-page-in{from{opacity:.72;filter:blur(8px) saturate(.9)}to{opacity:1;filter:blur(0) saturate(1)}}
@keyframes slopweb-materialize{from{opacity:0;transform:translateY(14px) scale(.992);filter:blur(6px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
</style>`;

export function securityMeta() {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
}

export function sanitizeClientHtml(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|formaction)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"')
    .replace(/(href|src|action|formaction)\s*=\s*javascript:[^\s>]+/gi, '$1="#"')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe\b[^>]*\/?\s*>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?\s*>/gi, '');
}

export function composeSrcdoc(html) {
  let doc = sanitizeClientHtml(html || '<!doctype html><title>Empty</title><body></body>');
  if (/^\s*```/i.test(doc)) doc = doc.replace(/^\s*```(?:html)?/i, '').replace(/```\s*$/i, '').trim();
  if (!/^\s*<!doctype html>/i.test(doc)) doc = `<!doctype html>\n${doc}`;

  const headInjection = `${securityMeta()}${REVEAL_CSS}`;
  if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, match => `${match}<head>${headInjection}</head>`);
  else doc = `<!doctype html><html><head>${headInjection}</head><body>${doc}</body></html>`;
  return doc;
}

export function updateSourcePreview(sourceEl, statusEl, rawHtml) {
  const text = String(rawHtml || '');
  sourceEl.textContent = text.length > MAX_SOURCE_PREVIEW ? `… trimmed ${text.length - MAX_SOURCE_PREVIEW} chars …\n` + text.slice(-MAX_SOURCE_PREVIEW) : text;
  sourceEl.scrollTop = sourceEl.scrollHeight;
  statusEl.textContent = text.length ? `${Math.round(text.length / 1024)}kb` : 'waiting';
}
