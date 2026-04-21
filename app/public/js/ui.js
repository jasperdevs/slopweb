import { activeTab, state, saveSourceOpen } from './state.js';

export const els = {
  authStatus: document.querySelector('#authStatus'),
  navForm: document.querySelector('#navForm'),
  addressInput: document.querySelector('#addressInput'),
  omnibox: document.querySelector('.omnibox'),
  omniboxClear: document.querySelector('#omniboxClear'),
  backBtn: document.querySelector('#backBtn'),
  forwardBtn: document.querySelector('#forwardBtn'),
  reloadBtn: document.querySelector('#reloadBtn'),
  homeBtn: document.querySelector('#homeBtn'),
  clearBtn: document.querySelector('#clearBtn'),
  historyList: document.querySelector('#historyList'),
  tabList: document.querySelector('#tabList'),
  newTabBtn: document.querySelector('#newTabBtn'),
  frame: document.querySelector('#pageFrame'),
  sourceRail: document.querySelector('#sourceRail'),
  sourceCollapse: document.querySelector('#sourceCollapse'),
  sourceStatus: document.querySelector('#sourceStatus'),
  liveSource: document.querySelector('#liveSource'),
  authDialog: document.querySelector('#authDialog'),
  authLog: document.querySelector('#authLog'),
  activeTabTitle: document.querySelector('#activeTabTitle'),
  chromeMenu: document.querySelector('.chrome-menu'),
  menuNewTab: document.querySelector('#menuNewTab'),
  menuFocusAddress: document.querySelector('#menuFocusAddress'),
  viewportShell: document.querySelector('.viewport-shell')
};

export function setStatus(kind, text) {
  els.authStatus.className = `status-pill ${kind}`;
  els.authStatus.textContent = text;
}

export function updateOmniboxState() {
  els.omnibox.classList.toggle('has-text', Boolean(els.addressInput.value.trim()));
}

export function focusAddress() {
  els.addressInput.focus();
  els.addressInput.select();
}

export function setLiveMode(active, text = 'assembling elements') {
  if (els.sourceStatus) els.sourceStatus.textContent = active ? text : 'idle';
}

export function setSourceOpen(open) {
  state.sourceOpen = Boolean(open);
  els.viewportShell.classList.toggle('source-collapsed', !state.sourceOpen);
  els.sourceCollapse.setAttribute('aria-label', state.sourceOpen ? 'Collapse source rail' : 'Expand source rail');
  els.sourceCollapse.title = state.sourceOpen ? 'Collapse source rail' : 'Expand source rail';
  saveSourceOpen();
}

export function toggleSource() {
  setSourceOpen(!state.sourceOpen);
}

export function renderHistory(navigate) {
  const items = state.entries.map((address, index) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    const span = document.createElement('span');
    span.textContent = address;
    button.append(span);
    button.classList.toggle('active', index === state.index);
    button.addEventListener('click', () => {
      if (els.chromeMenu) els.chromeMenu.open = false;
      navigate(address, { push: false, index });
    });
    li.append(button);
    return li;
  });
  els.historyList.replaceChildren(...items);
  els.backBtn.disabled = state.index <= 0;
  els.forwardBtn.disabled = state.index >= state.entries.length - 1;
}

export function renderTabs({ activate, close }) {
  els.tabList.replaceChildren(...state.tabs.map(tab => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tab ${tab.id === state.activeTabId ? 'active' : ''}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', tab.id === state.activeTabId ? 'true' : 'false');
    button.dataset.tabId = tab.id;

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = '/assets/logo.png';
    favicon.alt = '';
    favicon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New Tab';

    const closeButton = document.createElement('span');
    closeButton.className = 'tab-close';
    closeButton.setAttribute('role', 'button');
    closeButton.setAttribute('aria-label', 'Close tab');
    closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
    closeButton.addEventListener('click', event => {
      event.stopPropagation();
      close(tab.id);
    });

    button.append(favicon, title, closeButton);
    button.addEventListener('click', () => activate(tab.id));
    button.addEventListener('auxclick', event => {
      if (event.button !== 1) return;
      event.preventDefault();
      close(tab.id);
    });
    return button;
  }));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function highlightTagToken(token) {
  const escaped = escapeHtml(token);
  if (/^<!--/i.test(token)) return `<span class="code-comment">${escaped}</span>`;
  if (/^<!doctype/i.test(token)) return `<span class="code-doctype">${escaped}</span>`;
  return escaped
    .replace(/^(&lt;\/?)([a-z][\w-]*)/i, '<span class="code-bracket">$1</span><span class="code-tag">$2</span>')
    .replace(/([\w:-]+)(=)(&quot;.*?&quot;|&#039;.*?&#039;|[^\s&>]+)/g, '<span class="code-attr">$1</span><span class="code-bracket">$2</span><span class="code-value">$3</span>')
    .replace(/(\/?&gt;)$/, '<span class="code-bracket">$1</span>');
}

function highlightCssLine(line) {
  return escapeHtml(line)
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="code-comment">$1</span>')
    .replace(/(#(?:[0-9a-f]{3}){1,2}\b)/gi, '<span class="code-color">$1</span>')
    .replace(/([a-z-]+)(\s*:)/gi, '<span class="code-attr">$1</span><span class="code-bracket">$2</span>')
    .replace(/(&quot;.*?&quot;|&#039;.*?&#039;)/g, '<span class="code-value">$1</span>');
}

function highlightScriptLine(line) {
  return escapeHtml(line)
    .replace(/(\/\/.*$)/g, '<span class="code-comment">$1</span>')
    .replace(/(&quot;.*?&quot;|&#039;.*?&#039;|`.*?`)/g, '<span class="code-value">$1</span>')
    .replace(/\b(const|let|var|function|return|if|else|for|while|await|async|new|class|try|catch|throw|import|export)\b/g, '<span class="code-keyword">$1</span>');
}

function highlightLine(line, mode = 'html') {
  if (mode === 'css') return highlightCssLine(line);
  if (mode === 'script') return highlightScriptLine(line);
  const text = String(line || '');
  const tokenRe = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/?[a-z][^>]*>/gi;
  let html = '';
  let lastIndex = 0;
  for (const match of text.matchAll(tokenRe)) {
    html += escapeHtml(text.slice(lastIndex, match.index));
    html += highlightTagToken(match[0]);
    lastIndex = match.index + match[0].length;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}

function shouldIndentAfter(line) {
  return /^<([a-z][\w-]*)(?:\s[^>]*)?>$/i.test(line)
    && !/^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i.test(line);
}

function formatSourceForDisplay(rawHtml) {
  const raw = String(rawHtml || '');
  if (!raw.trim()) return '';

  const normalized = raw
    .replace(/>\s+</g, '>\n<')
    .replace(/(<\/(?:style|script)\s*>)/gi, '$1\n')
    .replace(/(<(?:style|script)\b[^>]*>)/gi, '\n$1\n');

  let indent = 0;
  let rawTextMode = false;
  const output = [];
  for (const sourceLine of normalized.split('\n')) {
    const line = sourceLine.trim();
    if (!line) continue;

    if (/^<\/(style|script)\s*>/i.test(line)) rawTextMode = false;
    if (!rawTextMode && /^<\//.test(line)) indent = Math.max(0, indent - 1);

    output.push(`${'  '.repeat(rawTextMode ? indent : Math.max(0, indent))}${line}`);

    if (/^<(style|script)\b/i.test(line) && !/<\/(style|script)\s*>/i.test(line)) {
      rawTextMode = true;
      indent += 1;
      continue;
    }
    if (!rawTextMode && shouldIndentAfter(line)) indent += 1;
  }
  return output.join('\n');
}

export function renderSource(sourceEl, statusEl, rawHtml, maxChars = 80000) {
  const fullText = String(rawHtml || '');
  const sourceText = fullText.length > maxChars
    ? `... trimmed ${fullText.length - maxChars} chars ...\n${fullText.slice(-maxChars)}`
    : fullText;
  const text = formatSourceForDisplay(sourceText);
  const lines = text.split('\n');
  let mode = 'html';
  sourceEl.innerHTML = lines.map((line, index) => {
    const activeMode = mode;
    const highlighted = highlightLine(line, activeMode) || ' ';
    if (/<style[\s>]/i.test(line) && !/<\/style\s*>/i.test(line)) mode = 'css';
    if (/<script[\s>]/i.test(line) && !/<\/script\s*>/i.test(line)) mode = 'script';
    if (/<\/style\s*>/i.test(line) || /<\/script\s*>/i.test(line)) mode = 'html';
    return `<span class="code-line"><span class="line-no">${index + 1}</span><span class="line-code">${highlighted}</span></span>`;
  }).join('');
  sourceEl.scrollTop = sourceEl.scrollHeight;
  statusEl.textContent = fullText.length ? `${Math.max(1, Math.round(fullText.length / 1024))}kb` : 'empty';
}
