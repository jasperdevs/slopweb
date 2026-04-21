const TABS_KEY = 'slopweb-tabs';
const ACTIVE_TAB_KEY = 'slopweb-active-tab';
const SOURCE_OPEN_KEY = 'slopweb-source-open';

function newTab(address = 'synthetic://home') {
  return {
    id: crypto.randomUUID(),
    title: 'New Tab',
    entries: [address],
    index: 0,
    html: '',
    source: ''
  };
}

function normalizeTab(tab) {
  const entries = Array.isArray(tab?.entries) ? tab.entries.map(String).filter(Boolean).slice(-80) : ['synthetic://home'];
  return {
    id: String(tab?.id || crypto.randomUUID()),
    title: String(tab?.title || 'New Tab').slice(0, 120),
    entries: entries.length ? entries : ['synthetic://home'],
    index: Math.min(Math.max(Number(tab?.index || 0), 0), Math.max(entries.length - 1, 0)),
    html: String(tab?.html || ''),
    source: String(tab?.source || tab?.html || '')
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
  materializedTags: [],
  sourceOpen: localStorage.getItem(SOURCE_OPEN_KEY) !== '0'
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

export function saveHistory() {
  commitActiveTab();
  localStorage.setItem(TABS_KEY, JSON.stringify(state.tabs));
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
  saveHistory();
  return tab;
}

export function createTab(address = 'synthetic://home') {
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
