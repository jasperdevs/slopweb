import { activeTab, state, saveSourceOpen, saveSourceWidth } from './state.js';
import { escapeHtml } from './utils.js';

export const els = {
  authStatus: document.querySelector('#authStatus'),
  navForm: document.querySelector('#navForm'),
  addressInput: document.querySelector('#addressInput'),
  omnibox: document.querySelector('.omnibox'),
  omniboxClear: document.querySelector('#omniboxClear'),
  stopBtn: document.querySelector('#stopBtn'),
  regenBtn: document.querySelector('#regenBtn'),
  savedPagesMenu: document.querySelector('#savedPagesMenu'),
  savedPagesList: document.querySelector('#savedPagesList'),
  refreshPagesBtn: document.querySelector('#refreshPagesBtn'),
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
  if (els.sourceRail) els.sourceRail.dataset.streaming = active ? '1' : '0';
}

export function setSourceOpen(open) {
  state.sourceOpen = Boolean(open);
  els.viewportShell.classList.toggle('source-collapsed', !state.sourceOpen);
  els.sourceCollapse.setAttribute('aria-label', state.sourceOpen ? 'Collapse source rail' : 'Expand source rail');
  els.sourceCollapse.title = state.sourceOpen ? 'Collapse source rail' : 'Expand source rail';
  saveSourceOpen();
}

export function initSourceResizer() {
  const resizer = document.querySelector('.source-resizer');
  const shell = els.viewportShell;
  if (!resizer || !shell) return;
  const clamp = value => Math.min(720, Math.max(220, value));
  shell.style.setProperty('--source-w', `${clamp(state.sourceWidth)}px`);
  let dragging = false;
  resizer.addEventListener('pointerdown', event => {
    if (!state.sourceOpen) return;
    dragging = true;
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add('active');
    shell.classList.add('source-resizing');
  });
  resizer.addEventListener('pointermove', event => {
    if (!dragging) return;
    const rect = shell.getBoundingClientRect();
    const next = clamp(rect.right - event.clientX);
    state.sourceWidth = next;
    shell.style.setProperty('--source-w', `${next}px`);
  });
  const end = event => {
    if (!dragging) return;
    dragging = false;
    try { resizer.releasePointerCapture(event.pointerId); } catch {}
    resizer.classList.remove('active');
    shell.classList.remove('source-resizing');
    saveSourceWidth();
  };
  resizer.addEventListener('pointerup', end);
  resizer.addEventListener('pointercancel', end);
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

function highlightTagToken(token) {
  if (/^<!--/i.test(token)) return `<span class="code-comment">${escapeHtml(token)}</span>`;
  if (/^<!doctype/i.test(token)) return `<span class="code-doctype">${escapeHtml(token)}</span>`;

  const tag = token.match(/^<\/?([a-z][\w-]*)/i);
  if (!tag) return escapeHtml(token);

  const opener = token.startsWith('</') ? '</' : '<';
  const end = token.match(/\/?>$/)?.[0] || '';
  const body = token.slice(opener.length + tag[1].length, end ? -end.length : undefined);
  let html = `<span class="code-bracket">${escapeHtml(opener)}</span><span class="code-tag">${escapeHtml(tag[1])}</span>`;
  let lastIndex = 0;
  const attrRe = /([\w:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g;
  for (const match of body.matchAll(attrRe)) {
    html += escapeHtml(body.slice(lastIndex, match.index));
    html += `<span class="code-attr">${escapeHtml(match[1])}</span><span class="code-bracket">${escapeHtml(match[2])}</span><span class="code-value">${escapeHtml(match[3])}</span>`;
    lastIndex = match.index + match[0].length;
  }
  html += escapeHtml(body.slice(lastIndex));
  if (end) html += `<span class="code-bracket">${escapeHtml(end)}</span>`;
  return html;
}

function highlightCssLine(line) {
  const text = String(line || '');
  const comment = text.match(/\/\*[\s\S]*?\*\//);
  if (comment) {
    const before = text.slice(0, comment.index);
    const after = text.slice(comment.index + comment[0].length);
    return `${highlightCssLine(before)}<span class="code-comment">${escapeHtml(comment[0])}</span>${highlightCssLine(after)}`;
  }
  return text.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g).map(part => {
    if (!part) return '';
    if (/^["']/.test(part)) return `<span class="code-value">${escapeHtml(part)}</span>`;
    return escapeHtml(part)
      .replace(/(#(?:[0-9a-f]{3}){1,2}\b)/gi, '<span class="code-color">$1</span>')
      .replace(/([a-z-]+)(\s*:)/gi, '<span class="code-attr">$1</span><span class="code-bracket">$2</span>');
  }).join('');
}

function highlightScriptLine(line) {
  const text = String(line || '');
  const commentIndex = text.indexOf('//');
  const code = commentIndex >= 0 ? text.slice(0, commentIndex) : text;
  const comment = commentIndex >= 0 ? text.slice(commentIndex) : '';
  const highlighted = code.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g).map(part => {
    if (!part) return '';
    if (/^["'`]/.test(part)) return `<span class="code-value">${escapeHtml(part)}</span>`;
    return escapeHtml(part).replace(/\b(const|let|var|function|return|if|else|for|while|await|async|new|class|try|catch|throw|import|export)\b/g, '<span class="code-keyword">$1</span>');
  }).join('');
  return comment ? `${highlighted}<span class="code-comment">${escapeHtml(comment)}</span>` : highlighted;
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

function splitCssForDisplay(line) {
  const chunks = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    current += char;
    if (quote) {
      if (char === '\\') {
        index += 1;
        current += line[index] || '';
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (char === '{' || char === '}' || char === ';')) {
      const chunk = current.trim();
      if (chunk) chunks.push(chunk);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail) chunks.push(tail);
  return chunks.length ? chunks : [line];
}

function splitRawTextForDisplay(line, mode) {
  if (mode === 'css') return splitCssForDisplay(line);
  return [line];
}

function formatSourceForDisplay(rawHtml) {
  const raw = String(rawHtml || '');
  if (!raw.trim()) return '';

  const normalized = raw
    .replace(/>\s+</g, '>\n<')
    .replace(/(<\/(?:style|script)\s*>)/gi, '\n$1\n')
    .replace(/(<(?:style|script)\b[^>]*>)/gi, '\n$1\n');

  let indent = 0;
  let rawTextMode = '';
  const output = [];
  for (const sourceLine of normalized.split('\n')) {
    const line = sourceLine.trim();
    if (!line) continue;

    if (/^<\/(style|script)\s*>/i.test(line)) rawTextMode = '';
    if (!rawTextMode && /^<\//.test(line)) indent = Math.max(0, indent - 1);

    const displayLines = rawTextMode && !/^<\/(style|script)\s*>/i.test(line)
      ? splitRawTextForDisplay(line, rawTextMode)
      : [line];
    displayLines.forEach(displayLine => {
      output.push(`${'  '.repeat(rawTextMode ? indent : Math.max(0, indent))}${displayLine}`);
    });

    if (/^<(style|script)\b/i.test(line) && !/<\/(style|script)\s*>/i.test(line)) {
      rawTextMode = /^<style\b/i.test(line) ? 'css' : 'script';
      indent += 1;
      continue;
    }
    if (!rawTextMode && shouldIndentAfter(line)) indent += 1;
  }
  return output.join('\n');
}

export function renderSource(sourceEl, statusEl, rawHtml, maxChars = 80000) {
  const fullText = String(rawHtml || '');
  if (!fullText.trim()) {
    sourceEl.textContent = '';
    if (sourceEl.closest('.source-rail')?.dataset.streaming !== '1') statusEl.textContent = 'empty';
    return;
  }
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
