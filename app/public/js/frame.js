export function securityMeta() {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
}

export function composeLiveSrcdoc() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${securityMeta()}<style>
html,body{margin:0;min-height:100%;background:#fff;color:#202124;font-family:Arial,"Segoe UI",Roboto,sans-serif}
#slopweb-style{display:none}
#slopweb-preview{min-height:100vh}
#slopweb-preview:empty:before{content:"";display:block;min-height:100vh;background:#fff}
#slopweb-preview [data-slopweb-new]{animation:slopweb-reveal .72s cubic-bezier(.2,0,0,1) both;will-change:opacity,transform,filter}
@keyframes slopweb-reveal{0%{opacity:0;transform:translateY(10px) scale(.985);filter:blur(7px)}60%{opacity:1;filter:blur(0)}100%{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
@media(prefers-reduced-motion:reduce){#slopweb-preview [data-slopweb-new]{animation:none}}
</style></head><body><style id="slopweb-style"></style><main id="slopweb-preview"></main><script>
(() => {
  const seen = new Set();
  const styleEl = document.querySelector('#slopweb-style');
  const preview = document.querySelector('#slopweb-preview');
  const parser = new DOMParser();
  let lastBody = '';
  let lastStyle = '';
  let firstElementSent = false;
  const complete = html => {
    let doc = String(html || '');
    if (!/<body[\\s>]/i.test(doc)) return '';
    if (!/<\\/body\\s*>/i.test(doc)) doc += '\\n</body>';
    if (!/<\\/html\\s*>/i.test(doc)) doc += '\\n</html>';
    return doc;
  };
  const keyFor = element => {
    const parts = [];
    let node = element;
    while (node && node !== preview && parts.length < 5) {
      const parent = node.parentElement;
      const index = parent ? Array.prototype.indexOf.call(parent.children, node) : 0;
      parts.push(node.tagName + ':' + index + ':' + (node.id || '') + ':' + (node.className || ''));
      node = parent;
    }
    return parts.reverse().join('/') + ':' + (element.textContent || '').trim().slice(0, 60);
  };
  const decoratedSelector = 'body,main,section,article,header,footer,nav,aside,div,h1,h2,h3,p,a,button,input,textarea,select,ul,ol,li,table,form,canvas,svg,img';
  const morphKey = node => node.nodeType === 1 ? (node.id || node.getAttribute('data-slopweb-key') || '') : '';
  const compatible = (from, to) => from.nodeType === to.nodeType && (from.nodeType !== 1 || from.tagName === to.tagName);
  const syncAttrs = (from, to) => {
    Array.from(from.attributes).forEach(attr => {
      if (!attr.name.startsWith('data-slopweb') && attr.name !== 'style' && !to.hasAttribute(attr.name)) from.removeAttribute(attr.name);
    });
    Array.from(to.attributes).forEach(attr => {
      if (from.getAttribute(attr.name) !== attr.value) from.setAttribute(attr.name, attr.value);
    });
  };
  const morphNode = (from, to, added) => {
    if (!compatible(from, to)) {
      const replacement = to.cloneNode(true);
      from.replaceWith(replacement);
      if (replacement.nodeType === 1) added.push(replacement);
      return replacement;
    }
    if (from.nodeType !== 1) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return from;
    }
    syncAttrs(from, to);
    morphChildren(from, to, added);
    return from;
  };
  const morphChildren = (fromParent, toParent, added = []) => {
    let from = fromParent.firstChild;
    Array.from(toParent.childNodes).forEach(to => {
      let match = null;
      const key = morphKey(to);
      if (key) {
        let scan = from;
        while (scan && !match) {
          if (morphKey(scan) === key && compatible(scan, to)) match = scan;
          scan = scan.nextSibling;
        }
      }
      if (!match && from && compatible(from, to)) match = from;
      if (match) {
        if (match !== from) fromParent.insertBefore(match, from);
        morphNode(match, to, added);
        from = match.nextSibling;
      } else {
        const node = to.cloneNode(true);
        fromParent.insertBefore(node, from);
        if (node.nodeType === 1) added.push(node);
      }
    });
    while (from) {
      const next = from.nextSibling;
      from.remove();
      from = next;
    }
    return added;
  };
  const decorate = (roots = [preview]) => {
    const elements = roots.flatMap(root => [
      ...(root === preview ? [] : [root]),
      ...root.querySelectorAll(decoratedSelector)
    ]).filter(el => el !== preview);
    elements.forEach((element, index) => {
      const key = keyFor(element);
      if (seen.has(key)) return;
      seen.add(key);
      if (!firstElementSent) {
        firstElementSent = true;
        parent.postMessage({ type: 'slopweb:first-element' }, '*');
      }
      element.dataset.slopwebNew = '';
      element.style.animationDelay = Math.min(index * 28, 420) + 'ms';
    });
  };
  const render = html => {
    const full = complete(html);
    if (!full) return;
    const doc = parser.parseFromString(full, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,link[rel~="stylesheet" i]').forEach(node => node.remove());
    const nextStyle = Array.from(doc.querySelectorAll('style')).map(node => node.textContent || '').join('\\n');
    const nextBody = doc.body ? doc.body.innerHTML : '';
    if (nextStyle !== lastStyle) {
      styleEl.textContent = nextStyle;
      lastStyle = nextStyle;
    }
    if (nextBody === lastBody) return;
    let decorateRoots = [preview];
    if (lastBody && nextBody.startsWith(lastBody)) {
      const start = preview.children.length;
      preview.insertAdjacentHTML('beforeend', nextBody.slice(lastBody.length));
      decorateRoots = Array.from(preview.children).slice(start);
    } else decorateRoots = morphChildren(preview, doc.body);
    lastBody = nextBody;
    decorate(decorateRoots);
  };
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data && event.data.type === 'slopweb:preview') render(event.data.html);
  });
})();
</script></body></html>`;
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
