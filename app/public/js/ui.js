import { activeTab, state, saveSourceOpen } from './state.js';

export const els = {
  authStatus: document.querySelector('#authStatus'),
  connectBtn: document.querySelector('#connectBtn'),
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
  liveBadge: document.querySelector('#liveBadge'),
  liveBadgeText: document.querySelector('#liveBadge b'),
  elementTrail: document.querySelector('#elementTrail'),
  sourceRail: document.querySelector('#sourceRail'),
  sourceToggle: document.querySelector('#sourceToggle'),
  sourceCollapse: document.querySelector('#sourceCollapse'),
  sourceStatus: document.querySelector('#sourceStatus'),
  liveSource: document.querySelector('#liveSource'),
  authDialog: document.querySelector('#authDialog'),
  authLog: document.querySelector('#authLog'),
  startDeviceLoginBtn: document.querySelector('#startDeviceLoginBtn'),
  activeTabTitle: document.querySelector('#activeTabTitle'),
  chromeMenu: document.querySelector('.chrome-menu'),
  menuNewTab: document.querySelector('#menuNewTab'),
  menuFocusAddress: document.querySelector('#menuFocusAddress'),
  menuToggleSource: document.querySelector('#menuToggleSource'),
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
  els.liveBadge.classList.add('hidden');
  els.liveBadgeText.textContent = text;
  if (els.sourceStatus) els.sourceStatus.textContent = active ? 'streaming' : 'idle';
}

export function setSourceOpen(open) {
  state.sourceOpen = Boolean(open);
  els.viewportShell.classList.toggle('source-collapsed', !state.sourceOpen);
  els.sourceToggle.classList.toggle('active', state.sourceOpen);
  els.sourceToggle.setAttribute('aria-pressed', state.sourceOpen ? 'true' : 'false');
  saveSourceOpen();
}

export function toggleSource() {
  setSourceOpen(!state.sourceOpen);
}

export function renderHistory(navigate) {
  els.historyList.innerHTML = '';
  state.entries.forEach((address, index) => {
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
    els.historyList.append(li);
  });
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

    const favicon = document.createElement('span');
    favicon.className = 'tab-favicon';
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
    return button;
  }));
}

export function renderElementTrail(tags) {
  const recent = tags.slice(-12);
  els.elementTrail.replaceChildren(...recent.map(tag => {
    const chip = document.createElement('span');
    chip.textContent = tag;
    return chip;
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

function highlightLine(line) {
  return escapeHtml(line)
    .replace(/(&lt;\/?)([a-z][\w-]*)/gi, '$1<span class="code-tag">$2</span>')
    .replace(/([\w:-]+)=(&quot;.*?&quot;|&#039;.*?&#039;)/g, '<span class="code-attr">$1</span>=<span class="code-value">$2</span>')
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="code-comment">$1</span>');
}

export function renderSource(sourceEl, statusEl, rawHtml, maxChars = 80000) {
  const fullText = String(rawHtml || '');
  const text = fullText.length > maxChars
    ? `... trimmed ${fullText.length - maxChars} chars ...\n${fullText.slice(-maxChars)}`
    : fullText;
  const lines = text.split('\n');
  sourceEl.innerHTML = lines.map((line, index) => `<span class="code-line"><span class="line-no">${index + 1}</span><span class="line-code">${highlightLine(line) || ' '}</span></span>`).join('');
  sourceEl.scrollTop = sourceEl.scrollHeight;
  statusEl.textContent = fullText.length ? `${Math.max(1, Math.round(fullText.length / 1024))}kb` : 'waiting';
}
