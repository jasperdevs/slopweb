export function securityMeta() {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
}

function bridgeScript() {
  return `<script data-slopweb-bridge>
(() => {
  const send = href => {
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return;
    parent.postMessage({ type: 'slopweb:navigate', href }, '*');
  };
  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    send(link.getAttribute('href'));
  }, true);
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    const action = form.getAttribute('action') || 'synthetic://search';
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    const query = params.toString();
    send(method === 'get' && query ? action + (action.includes('?') ? '&' : '?') + query : action);
  }, true);
})();
</script>`;
}

export function sanitizeClientHtml(html) {
  return String(html || '')
    .replace(/(href|src|action|formaction)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"')
    .replace(/(href|src|action|formaction)\s*=\s*javascript:[^\s>]+/gi, '$1="#"')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe\b[^>]*\/?\s*>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?\s*>/gi, '');
}

function completeLiveDocument(doc) {
  if (!/<body[\s>]/i.test(doc)) return doc;
  let completed = doc;
  if (!/<\/body\s*>/i.test(completed)) completed += '\n</body>';
  if (!/<\/html\s*>/i.test(completed)) completed += '\n</html>';
  return completed;
}

export function composeSrcdoc(html, options = {}) {
  let doc = sanitizeClientHtml(html || '<!doctype html><title>Empty</title><body></body>');
  if (/^\s*```/i.test(doc)) doc = doc.replace(/^\s*```(?:html)?/i, '').replace(/```\s*$/i, '').trim();
  if (!/^\s*<!doctype html>/i.test(doc)) doc = `<!doctype html>\n${doc}`;
  if (options.live) doc = completeLiveDocument(doc);

  const headInjection = securityMeta();
  if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, match => `${match}<head>${headInjection}</head>`);
  else doc = `<!doctype html><html><head>${headInjection}</head><body>${doc}</body></html>`;
  if (/<\/body\s*>/i.test(doc)) doc = doc.replace(/<\/body\s*>/i, `${bridgeScript()}</body>`);
  else doc += bridgeScript();
  return doc;
}
