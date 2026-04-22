const TABS_KEY = 'slopweb-tabs';
const ACTIVE_TAB_KEY = 'slopweb-active-tab';
const SOURCE_OPEN_KEY = 'slopweb-source-open';

function newTab(address = 'slopweb://home') {
  return {
    id: crypto.randomUUID(),
    title: 'New Tab',
    entries: [address],
    index: 0,
    html: '',
    source: '',
    savedUrl: '',
    savedDisplayPath: ''
  };
}

function normalizeTab(tab) {
  const entries = Array.isArray(tab?.entries) ? tab.entries.map(String).filter(Boolean).slice(-80) : ['slopweb://home'];
  return {
    id: String(tab?.id || crypto.randomUUID()),
    title: String(tab?.title || 'New Tab').slice(0, 120),
    entries: entries.length ? entries : ['slopweb://home'],
    index: Math.min(Math.max(Number(tab?.index || 0), 0), Math.max(entries.length - 1, 0)),
    html: '',
    source: '',
    savedUrl: String(tab?.savedUrl || ''),
    savedDisplayPath: String(tab?.savedDisplayPath || '')
  };
}

function readTabs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TABS_KEY) || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed.map(normalizeTab).slice(-12);
  } catch {}
  localStorage.removeItem(TABS_KEY);
  return [newTab()];
}

const initialTabs = readTabs();
const savedActive = localStorage.getItem(ACTIVE_TAB_KEY);
const initialActive = initialTabs.some(tab => tab.id === savedActive) ? savedActive : initialTabs[0].id;
const active = initialTabs.find(tab => tab.id === initialActive) || initialTabs[0];

export const state = {
  tabs: initialTabs,
  activeTabId: active.id,
  entries: [...active.entries],
  index: active.index,
  currentHtml: active.html,
  navigationSerial: 0,
  abortController: null,
  liveBuffer: active.source || active.html,
  liveRenderQueued: false,
  renderFrameQueued: false,
  sourceRenderQueued: false,
  sourceOpen: localStorage.getItem(SOURCE_OPEN_KEY) !== '0',
  sourceWidth: Number(localStorage.getItem('slopweb-source-width')) || 360
};

export function activeTab() {
  return state.tabs.find(tab => tab.id === state.activeTabId) || state.tabs[0];
}

export function commitActiveTab() {
  const tab = activeTab();
  if (!tab) return;
  tab.entries = [...state.entries].slice(-80);
  tab.index = Math.min(Math.max(state.index, 0), Math.max(tab.entries.length - 1, 0));
  tab.html = state.currentHtml || '';
  tab.source = state.liveBuffer || state.currentHtml || '';
}

function persistedTab(tab) {
  return {
    id: tab.id,
    title: tab.title,
    entries: Array.isArray(tab.entries) ? tab.entries.slice(-80) : ['slopweb://home'],
    index: Number(tab.index || 0),
    savedUrl: tab.savedUrl || '',
    savedDisplayPath: tab.savedDisplayPath || ''
  };
}

export function saveHistory() {
  commitActiveTab();
  localStorage.setItem(TABS_KEY, JSON.stringify(state.tabs.map(persistedTab)));
  localStorage.setItem(ACTIVE_TAB_KEY, state.activeTabId);
}

export function activateTab(id) {
  commitActiveTab();
  const tab = state.tabs.find(item => item.id === id);
  if (!tab) return activeTab();
  state.activeTabId = tab.id;
  state.entries = [...tab.entries];
  state.index = tab.index;
  state.currentHtml = tab.html || '';
  state.liveBuffer = tab.source || tab.html || '';
  state.liveRenderQueued = false;
  state.renderFrameQueued = false;
  state.sourceRenderQueued = false;
  saveHistory();
  return tab;
}

export function createTab(address = 'slopweb://home') {
  commitActiveTab();
  const tab = newTab(address);
  state.tabs.push(tab);
  if (state.tabs.length > 12) state.tabs.shift();
  activateTab(tab.id);
  return tab;
}

export function closeTab(id) {
  if (state.tabs.length <= 1) return activeTab();
  const index = state.tabs.findIndex(tab => tab.id === id);
  if (index === -1) return activeTab();
  state.tabs.splice(index, 1);
  if (state.activeTabId === id) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    state.activeTabId = next.id;
  }
  return activateTab(state.activeTabId);
}

export function updateActiveTabTitle(title) {
  const tab = activeTab();
  if (!tab) return;
  tab.title = String(title || 'Generated page').slice(0, 120);
  saveHistory();
}

export function saveSourceOpen() {
  localStorage.setItem(SOURCE_OPEN_KEY, state.sourceOpen ? '1' : '0');
}

export function saveSourceWidth() {
  localStorage.setItem('slopweb-source-width', String(state.sourceWidth));
}
