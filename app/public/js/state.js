const HISTORY_KEY = 'slopweb-history';
const INDEX_KEY = 'slopweb-index';
const SOURCE_OPEN_KEY = 'slopweb-source-open';

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(parsed)) return parsed.map(String).slice(-80);
  } catch {}
  localStorage.removeItem(HISTORY_KEY);
  return [];
}

function readIndex(entries) {
  const value = Number(localStorage.getItem(INDEX_KEY) || '-1');
  if (!Number.isInteger(value)) return entries.length ? entries.length - 1 : -1;
  return Math.min(Math.max(value, -1), entries.length - 1);
}

const initialEntries = readHistory();

export const state = {
  entries: initialEntries,
  index: readIndex(initialEntries),
  currentHtml: '',
  navigationSerial: 0,
  abortController: null,
  liveBuffer: '',
  liveRenderQueued: false,
  materializedTags: [],
  materializedBytes: 0,
  sourceOpen: localStorage.getItem(SOURCE_OPEN_KEY) !== '0'
};

export function saveHistory() {
  const trimmed = state.entries.slice(-80);
  if (trimmed.length !== state.entries.length) {
    state.entries = trimmed;
    state.index = Math.min(state.index, state.entries.length - 1);
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.entries));
  localStorage.setItem(INDEX_KEY, String(state.index));
}

export function saveSourceOpen() {
  localStorage.setItem(SOURCE_OPEN_KEY, state.sourceOpen ? '1' : '0');
}
