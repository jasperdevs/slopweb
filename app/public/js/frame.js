export function securityMeta() {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
}

export function composeLiveSrcdoc() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${securityMeta()}<style>
html,body{margin:0;min-height:100%;background:transparent;color:#1a1e30;font-family:"Inter","Segoe UI",Roboto,Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
#slopweb-style{display:none}
#slopweb-preview{min-height:100vh}
#slopweb-preview[data-slopweb-waiting]{height:100vh;box-sizing:border-box;display:grid;align-items:stretch;justify-items:center;padding:clamp(10px,2.4vw,28px);background:linear-gradient(180deg,#f8fafc 0%,#eef2f8 100%);overflow:hidden}
#slopweb-preview[data-slopweb-waiting]:before{content:"";position:fixed;inset:-44px;pointer-events:none;background:linear-gradient(90deg,rgba(18,22,38,.035) 1px,transparent 1px),linear-gradient(rgba(18,22,38,.03) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(180deg,rgba(0,0,0,.72),transparent 78%);animation:slopweb-grid-drift 7s linear infinite}
.slopweb-skeleton{width:min(1220px,100%);height:100%;min-height:0;display:grid;grid-template-rows:clamp(44px,8vh,58px) minmax(0,1fr) clamp(72px,16vh,112px);gap:clamp(8px,1.6vh,14px);opacity:.99;position:relative;animation:slopweb-skeleton-in 320ms cubic-bezier(.22,1,.36,1) both}
.slopweb-skeleton-top{height:58px;border-radius:14px;background:rgba(255,255,255,.88);box-shadow:0 1px 2px rgba(18,22,38,.05),0 18px 44px rgba(18,22,38,.09);position:relative;overflow:hidden;display:grid;grid-template-columns:90px minmax(0,1fr) 130px;align-items:center;gap:16px;padding:0 18px;animation:slopweb-top-breathe 3.8s cubic-bezier(.45,0,.2,1) infinite}
.slopweb-skeleton-top:before,.slopweb-skeleton-top:after{content:"";display:block;height:14px;border-radius:999px;background:#d9e0ec}
.slopweb-skeleton-top:before{width:72px;box-shadow:88px 0 0 #eef2f8,118px 0 0 #eef2f8}
.slopweb-skeleton-top:after{justify-self:end;width:110px;background:#c8d3ff}
.slopweb-skeleton-address{height:20px;border-radius:999px;background:linear-gradient(90deg,#edf1f8,#dce4f2 38%,#edf1f8);position:relative;overflow:hidden;animation:slopweb-address-pulse 2.6s cubic-bezier(.45,0,.2,1) infinite}
.slopweb-skeleton-hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(260px,.95fr);gap:14px;align-items:stretch}
.slopweb-skeleton-card{border-radius:18px;background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(18,22,38,.05),0 22px 52px rgba(18,22,38,.11);overflow:hidden;position:relative;min-height:0}
.slopweb-skeleton-card.primary{display:grid;align-content:center;gap:clamp(8px,1.7vh,14px);padding:clamp(18px,3.4vw,34px);animation:slopweb-float-a 4.4s cubic-bezier(.45,0,.2,1) infinite}
.slopweb-skeleton-card.visual{display:grid;grid-template-columns:1fr 1fr;gap:clamp(8px,1.5vh,14px);padding:clamp(12px,2.4vw,22px);background:linear-gradient(135deg,#f9fbff 0%,#eef4ff 56%,#f7fbf3 100%);animation:slopweb-float-b 4.8s cubic-bezier(.45,0,.2,1) infinite}
.slopweb-skeleton-card:after,.slopweb-skeleton-address:after,.slopweb-skeleton-line:before,.slopweb-skeleton-pill:before,.slopweb-skeleton-panel:before,.slopweb-skeleton-tile:before{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 0%,transparent 34%,rgba(255,255,255,.82) 48%,transparent 62%,transparent 100%);transform:translateX(-100%);animation:slopweb-sheen 1.25s cubic-bezier(.2,0,0,1) infinite}
.slopweb-skeleton-line,.slopweb-skeleton-pill,.slopweb-skeleton-panel,.slopweb-skeleton-tile{position:relative;overflow:hidden}
.slopweb-skeleton-line{display:block;height:15px;border-radius:999px;background:#dde5f1;transition:width 420ms cubic-bezier(.22,1,.36,1),height 420ms cubic-bezier(.22,1,.36,1),background-color 420ms cubic-bezier(.22,1,.36,1)}
.slopweb-skeleton-line.head{width:62%;height:50px;background:#c9d5e8}
.slopweb-skeleton-line.copy-a{width:94%}
.slopweb-skeleton-line.copy-b{width:78%}
.slopweb-skeleton-actions{display:flex;gap:10px;margin-top:10px}
.slopweb-skeleton-pill{height:36px;border-radius:12px;background:#c8d3ff}
.slopweb-skeleton-pill:first-child{width:128px}.slopweb-skeleton-pill:last-child{width:92px;background:#e8edf6}
.slopweb-skeleton-panel{border-radius:16px;background:rgba(255,255,255,.68);box-shadow:inset 0 0 0 1px rgba(255,255,255,.9),0 10px 30px rgba(18,22,38,.08);transition:transform 520ms cubic-bezier(.22,1,.36,1),opacity 520ms cubic-bezier(.22,1,.36,1)}
.slopweb-skeleton-panel.tall{grid-row:span 2;min-height:0}.slopweb-skeleton-panel.wide{min-height:0}.slopweb-skeleton-panel.small{min-height:0}
.slopweb-skeleton-panel:after{content:"";position:absolute;left:18px;right:18px;bottom:18px;height:12px;border-radius:999px;background:#d9e2f1;box-shadow:0 -28px 0 #eef3fa,0 -56px 0 #dfe8f6}
.slopweb-skeleton-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.slopweb-skeleton-tile{height:100%;border-radius:16px;background:rgba(255,255,255,.82);box-shadow:0 1px 2px rgba(18,22,38,.04),0 12px 28px rgba(18,22,38,.08);transition:opacity 420ms cubic-bezier(.22,1,.36,1),transform 420ms cubic-bezier(.22,1,.36,1)}
.slopweb-skeleton-tile:after{content:"";position:absolute;left:16px;right:28%;bottom:18px;height:12px;border-radius:999px;background:#dbe3f0;box-shadow:0 -28px 0 #edf2f8}
.slopweb-skeleton-tile:nth-child(1){animation:slopweb-tile-drift 4.1s cubic-bezier(.45,0,.2,1) infinite}
.slopweb-skeleton-tile:nth-child(2){animation:slopweb-tile-drift 4.4s cubic-bezier(.45,0,.2,1) .2s infinite}
.slopweb-skeleton-tile:nth-child(3){animation:slopweb-tile-drift 4.2s cubic-bezier(.45,0,.2,1) .4s infinite reverse}
.slopweb-skeleton-tile:nth-child(4){animation:slopweb-tile-drift 4.6s cubic-bezier(.45,0,.2,1) .1s infinite reverse}
#slopweb-preview[data-slopweb-stage="1"] .slopweb-skeleton-line.head{width:48%}
#slopweb-preview[data-slopweb-stage="1"] .slopweb-skeleton-line.copy-a{width:82%}
#slopweb-preview[data-slopweb-stage="1"] .slopweb-skeleton-line.copy-b{width:91%}
#slopweb-preview[data-slopweb-stage="1"] .slopweb-skeleton-panel.wide{transform:translateY(8px);opacity:.78}
#slopweb-preview[data-slopweb-stage="1"] .slopweb-skeleton-card.primary{transform:translateY(-6px)}
#slopweb-preview[data-slopweb-stage="2"] .slopweb-skeleton-line.head{width:70%}
#slopweb-preview[data-slopweb-stage="2"] .slopweb-skeleton-pill:first-child{background:#bfcaff}
#slopweb-preview[data-slopweb-stage="2"] .slopweb-skeleton-panel.tall{transform:translateX(8px)}
#slopweb-preview[data-slopweb-stage="2"] .slopweb-skeleton-tile:nth-child(2){transform:translateY(-8px)}
#slopweb-preview[data-slopweb-stage="2"] .slopweb-skeleton-card.visual{transform:translateY(-8px)}
#slopweb-preview[data-slopweb-stage="3"] .slopweb-skeleton-line.copy-a{width:88%}
#slopweb-preview[data-slopweb-stage="3"] .slopweb-skeleton-tile:nth-child(3){transform:translateY(-8px);opacity:.86}
#slopweb-preview[data-slopweb-stage="3"] .slopweb-skeleton-tile:nth-child(4){transform:translateY(6px)}
#slopweb-preview[data-slopweb-stage="3"] .slopweb-skeleton-top{transform:translateY(5px)}
@keyframes slopweb-skeleton-in{from{opacity:0;transform:translateY(4px)}to{opacity:.98;transform:none}}
@keyframes slopweb-sheen{to{transform:translateX(100%)}}
@keyframes slopweb-grid-drift{to{transform:translate3d(44px,44px,0)}}
@keyframes slopweb-top-breathe{0%,100%{translate:0 0;filter:saturate(1)}50%{translate:0 5px;filter:saturate(1.08)}}
@keyframes slopweb-address-pulse{0%,100%{opacity:1;scale:1 1}48%{opacity:.72;scale:.96 1}}
@keyframes slopweb-float-a{0%,100%{translate:0 0}45%{translate:0 -8px}72%{translate:0 4px}}
@keyframes slopweb-float-b{0%,100%{translate:0 0}38%{translate:8px 5px}70%{translate:-4px -7px}}
@keyframes slopweb-tile-drift{0%,100%{translate:0 0}45%{translate:0 -6px}74%{translate:0 4px}}
#slopweb-preview [data-slopweb-new]{animation:slopweb-reveal 520ms cubic-bezier(.22,1,.36,1) both;will-change:opacity,transform,filter}
#slopweb-preview [data-slopweb-new][data-slopweb-inline]{animation-duration:360ms}
#slopweb-preview [data-slopweb-leaving]{animation:slopweb-leave 320ms cubic-bezier(.22,1,.36,1) both;pointer-events:none}
@keyframes slopweb-reveal{0%{opacity:0;transform:translateY(6px);filter:blur(5px)}55%{opacity:.94;filter:blur(.4px)}100%{opacity:1;transform:none;filter:blur(0)}}
@keyframes slopweb-leave{from{opacity:1;transform:none;filter:blur(0)}to{opacity:0;transform:translateY(-4px);filter:blur(4px)}}
@media(max-width:720px){.slopweb-skeleton{grid-template-rows:clamp(42px,8vh,58px) minmax(0,1fr) clamp(70px,18vh,110px)}.slopweb-skeleton-top{grid-template-columns:70px 1fr;padding:0 14px}.slopweb-skeleton-top:after{display:none}.slopweb-skeleton-hero{grid-template-columns:1fr}.slopweb-skeleton-grid{grid-template-columns:1fr 1fr}.slopweb-skeleton-card.visual{grid-template-columns:1fr 1fr}.slopweb-skeleton-line.head{height:42px}}
@media(prefers-reduced-motion:reduce){#slopweb-preview[data-slopweb-waiting]:before,.slopweb-skeleton,.slopweb-skeleton-top,.slopweb-skeleton-address,.slopweb-skeleton-card.primary,.slopweb-skeleton-card.visual,.slopweb-skeleton-card:after,.slopweb-skeleton-address:after,.slopweb-skeleton-line:before,.slopweb-skeleton-pill:before,.slopweb-skeleton-panel:before,.slopweb-skeleton-tile,.slopweb-skeleton-tile:before,#slopweb-preview [data-slopweb-new],#slopweb-preview [data-slopweb-leaving]{animation:none}}
</style></head><body><style id="slopweb-style"></style><main id="slopweb-preview"></main><script>
(() => {
  const seen = new Set();
  const styleEl = document.querySelector('#slopweb-style');
  const preview = document.querySelector('#slopweb-preview');
  const parser = new DOMParser();
  let lastBody = '';
  let lastStyle = '';
  let firstElementSent = false;
  let skeletonActive = false;
  let skeletonTimer = 0;
  let skeletonStage = 0;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const skeletonHtml = '<div class="slopweb-skeleton" aria-hidden="true"><div class="slopweb-skeleton-top"><i></i><i class="slopweb-skeleton-address"></i><i></i></div><div class="slopweb-skeleton-hero"><section class="slopweb-skeleton-card primary"><i class="slopweb-skeleton-line head"></i><i class="slopweb-skeleton-line copy-a"></i><i class="slopweb-skeleton-line copy-b"></i><div class="slopweb-skeleton-actions"><i class="slopweb-skeleton-pill"></i><i class="slopweb-skeleton-pill"></i></div></section><section class="slopweb-skeleton-card visual"><i class="slopweb-skeleton-panel tall"></i><i class="slopweb-skeleton-panel wide"></i><i class="slopweb-skeleton-panel small"></i></section></div><div class="slopweb-skeleton-grid"><i class="slopweb-skeleton-tile"></i><i class="slopweb-skeleton-tile"></i><i class="slopweb-skeleton-tile"></i><i class="slopweb-skeleton-tile"></i></div></div>';
  const showSkeleton = () => {
    skeletonActive = true;
    skeletonStage = 0;
    preview.dataset.slopwebWaiting = '';
    preview.dataset.slopwebStage = '0';
    preview.innerHTML = skeletonHtml;
    if (!reduceMotion && !skeletonTimer) {
      skeletonTimer = setInterval(() => {
        skeletonStage = (skeletonStage + 1) % 4;
        preview.dataset.slopwebStage = String(skeletonStage);
      }, 620);
    }
  };
  const hideSkeleton = () => {
    if (!skeletonActive) return;
    skeletonActive = false;
    if (skeletonTimer) {
      clearInterval(skeletonTimer);
      skeletonTimer = 0;
    }
    delete preview.dataset.slopwebWaiting;
    delete preview.dataset.slopwebStage;
    preview.innerHTML = '';
  };
  const complete = html => {
    let doc = String(html || '');
    if (!doc.trim()) return '';
    if (doc.lastIndexOf('<') > doc.lastIndexOf('>')) doc = doc.slice(0, doc.lastIndexOf('<'));
    if (!/<body[\\s>]/i.test(doc)) doc = '<body>' + doc + '</body>';
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
  const inlineTags = /^(A|BUTTON|INPUT|TEXTAREA|SELECT|LABEL|IMG|SVG|SPAN)$/;
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
    let staggerIndex = 0;
    elements.forEach(element => {
      const key = keyFor(element);
      if (seen.has(key)) return;
      seen.add(key);
      if (!firstElementSent) {
        firstElementSent = true;
        parent.postMessage({ type: 'slopweb:first-element' }, '*');
      }
      element.dataset.slopwebNew = '';
      if (inlineTags.test(element.tagName)) element.dataset.slopwebInline = '';
      element.style.animationDelay = Math.min(staggerIndex * 10, 140) + 'ms';
      staggerIndex += 1;
    });
  };
  const clearPreview = () => {
    seen.clear();
    styleEl.textContent = '';
    lastBody = '';
    lastStyle = '';
    firstElementSent = false;
    showSkeleton();
  };
  const render = html => {
    const full = complete(html);
    if (!full) {
      clearPreview();
      return;
    }
    const doc = parser.parseFromString(full, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,link[rel~="stylesheet" i]').forEach(node => node.remove());
    const nextStyle = Array.from(doc.querySelectorAll('style')).map(node => node.textContent || '').join('\\n');
    const nextBody = doc.body ? doc.body.innerHTML : '';
    if (nextStyle !== lastStyle) {
      styleEl.textContent = nextStyle;
      lastStyle = nextStyle;
    }
    if (nextBody === lastBody) return;
    hideSkeleton();
    let decorateRoots = [preview];
    if (lastBody && nextBody.startsWith(lastBody)) {
      const start = preview.children.length;
      preview.insertAdjacentHTML('beforeend', nextBody.slice(lastBody.length));
      decorateRoots = Array.from(preview.children).slice(start);
    } else decorateRoots = morphChildren(preview, doc.body);
    lastBody = nextBody;
    decorate(decorateRoots);
  };
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
    const action = form.getAttribute('action') || 'slopweb://search';
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    const query = params.toString();
    send(method === 'get' && query ? action + (action.includes('?') ? '&' : '?') + query : action);
  }, true);
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data) return;
    if (data.type === 'slopweb:preview') render(data.html);
    else if (data.type === 'slopweb:reset') clearPreview();
  });
  showSkeleton();
})();
</script></body></html>`;
}

export function composeStaticSrcdoc(html) {
  let doc = sanitizeClientHtml(html || '<!doctype html><title>Empty</title><body></body>');
  if (!/^\s*<!doctype html>/i.test(doc)) doc = `<!doctype html>\n${doc}`;
  const headInjection = securityMeta();
  if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, match => `${match}<head>${headInjection}</head>`);
  else doc = `<!doctype html><html><head>${headInjection}</head><body>${doc}</body></html>`;
  if (/<\/body\s*>/i.test(doc)) doc = doc.replace(/<\/body\s*>/i, `${bridgeScript()}</body>`);
  else doc += bridgeScript();
  return doc;
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
    const action = form.getAttribute('action') || 'slopweb://search';
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
