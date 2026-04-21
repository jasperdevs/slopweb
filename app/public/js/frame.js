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

  const headInjection = securityMeta();
  if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, match => `${match}<head>${headInjection}</head>`);
  else doc = `<!doctype html><html><head>${headInjection}</head><body>${doc}</body></html>`;
  return doc;
}
