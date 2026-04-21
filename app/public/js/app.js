import { activateTab, activeTab, closeTab, commitActiveTab, createTab, state, saveHistory, updateActiveTabTitle } from './state.js';
import { checkAuthStatus, readNdjsonStream } from './api.js';
import { composeLiveSrcdoc, composeSrcdoc } from './frame.js';
import { els, setStatus, updateOmniboxState, focusAddress, setLiveMode, setSourceOpen, toggleSource, renderHistory, renderTabs, renderSource } from './ui.js';

let liveFrameReady = false;
let liveFrameTimer = 0;
let lastLiveFrameHtml = '';

function normalizeInput(value, base = state.entries[state.index]) {
  const raw = String(value || '').trim();
  if (!raw) return 'synthetic://home';
  if (/^#/i.test(raw)) return null;
  if (/^javascript:/i.test(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) {
    try { return new URL(raw, base || 'synthetic://local').href; }
    catch { return `synthetic://local${raw}`; }
  }
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
  return `synthetic://search/${encodeURIComponent(raw)}`;
}

async function checkAuth() {
  try {
    const data = await checkAuthStatus();
    if (data.connected) setStatus('good', data.provider === 'ai-sdk' ? 'Local AI ready' : 'Codex ready');
    else setStatus('bad', data.provider === 'ai-sdk' ? 'Local AI needed' : 'Login needed');
    return data;
  } catch {
    setStatus('bad', 'Offline');
    return { connected: false };
  }
}

function resetLiveDocument(reason = 'document') {
  state.liveBuffer = '';
  state.liveRenderQueued = false;
  state.sourceRenderQueued = false;
  state.renderFrameQueued = false;
  els.sourceStatus.textContent = 'waiting';
  renderSource(els.liveSource, els.sourceStatus, '');
  setLiveMode(true, reason === 'model' || reason === 'codex-final' ? 'receiving html' : 'waiting');
  if (liveFrameTimer) {
    window.clearTimeout(liveFrameTimer);
    liveFrameTimer = 0;
  }
  liveFrameReady = false;
  lastLiveFrameHtml = '';
  els.frame.onload = () => {
    liveFrameReady = true;
    postLivePreview();
  };
  els.frame.srcdoc = composeLiveSrcdoc();
}

function hasOpenRawTextTag(html, tag) {
  const text = String(html || '').toLowerCase();
  return text.lastIndexOf(`<${tag}`) > text.lastIndexOf(`</${tag}`);
}

function canRenderLiveHtml(html) {
  const text = String(html || '');
  if (!/<body[\s>]/i.test(text)) return false;
  if (text.lastIndexOf('<') > text.lastIndexOf('>')) return false;
  return !['style', 'script', 'textarea', 'title'].some(tag => hasOpenRawTextTag(text, tag));
}

function postLivePreview() {
  if (!liveFrameReady || !els.frame.contentWindow || !canRenderLiveHtml(state.liveBuffer)) return;
  if (state.liveBuffer === lastLiveFrameHtml) return;
  lastLiveFrameHtml = state.liveBuffer;
  els.frame.contentWindow.postMessage({ type: 'slopweb:preview', html: state.liveBuffer }, '*');
}

function scheduleLiveFrameRender() {
  if (liveFrameTimer) return;
  liveFrameTimer = window.setTimeout(() => {
    liveFrameTimer = 0;
    postLivePreview();
  }, 180);
}

function scheduleLiveRender({ source = true, frame = true } = {}) {
  state.sourceRenderQueued ||= source;
  state.liveRenderQueued ||= frame;
  if (state.renderFrameQueued) return;
  state.renderFrameQueued = true;
  requestAnimationFrame(() => {
    const shouldRenderSource = state.sourceRenderQueued;
    const shouldRenderFrame = state.liveRenderQueued;
    state.renderFrameQueued = false;
    state.sourceRenderQueued = false;
    state.liveRenderQueued = false;
    if (shouldRenderSource) renderSource(els.liveSource, els.sourceStatus, state.liveBuffer);
    if (shouldRenderFrame) scheduleLiveFrameRender();
  });
}

function appendLiveHtml(chunk) {
  if (!chunk) return;
  state.liveBuffer += chunk;
  scheduleLiveRender();
}

function beginLiveHtml(address) {
  if (state.abortController) state.abortController.abort();
  state.abortController = new AbortController();
  setLiveMode(true, 'assembling elements');
  els.addressInput.value = address;
  resetLiveDocument('opening');
  renderSource(els.liveSource, els.sourceStatus, state.liveBuffer);
  return state.abortController;
}

function finishLiveHtml(controller = state.abortController) {
  setLiveMode(false);
  els.sourceStatus.textContent = state.liveBuffer ? 'done' : 'idle';
  if (!controller || state.abortController === controller) state.abortController = null;
}

window.addEventListener('message', event => {
  if (event.source !== els.frame.contentWindow) return;
  if (event.data?.type !== 'slopweb:navigate') return;
  const next = normalizeInput(event.data.href, state.entries[state.index]);
  if (next) navigate(next);
});

function renderFinalPage(page) {
  document.title = `${page.title || 'Generated page'} · Slopweb`;
  state.currentHtml = page.html || '';
  state.liveBuffer = page.html || state.liveBuffer;
  updateActiveTabTitle(page.title || 'Generated page');
  renderTabs({ activate: switchTab, close: closeExistingTab });
  renderSource(els.liveSource, els.sourceStatus, state.liveBuffer);
  if (liveFrameTimer) {
    window.clearTimeout(liveFrameTimer);
    liveFrameTimer = 0;
  }
  els.frame.onload = null;
  liveFrameReady = false;
  els.frame.srcdoc = composeSrcdoc(page.html || state.liveBuffer || '');
}

export async function navigate(rawAddress, options = {}) {
  const address = normalizeInput(rawAddress);
  if (!address) return;
  const serial = ++state.navigationSerial;
  els.addressInput.value = address;
  updateOmniboxState();

  if (options.push !== false) {
    state.entries = state.entries.slice(0, state.index + 1);
    if (state.entries[state.entries.length - 1] !== address) state.entries.push(address);
    state.index = state.entries.length - 1;
  } else if (typeof options.index === 'number') {
    state.index = options.index;
  }
  saveHistory();
  renderHistory(navigate);

  const controller = beginLiveHtml(address);
  let finalPage = null;
  let authInfo = null;

  try {
    const res = await fetch('/api/page-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, history: state.entries }),
      signal: controller.signal
    });

    if (!res.ok || !res.body) throw new Error(`Stream failed with status ${res.status}.`);

    await readNdjsonStream(res, event => {
      if (serial !== state.navigationSerial) return;
      if (event.type === 'reset') resetLiveDocument(event.reason || 'document');
      else if (event.type === 'status') {
        setLiveMode(true, event.text || 'assembling elements');
      }
      else if (event.type === 'chunk') appendLiveHtml(event.text || '');
      else if (event.type === 'done') {
        finalPage = event.page;
        if (event.page?.authRequired) authInfo = event.page;
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Generation failed.');
      }
    });

    if (serial !== state.navigationSerial) return;
    finishLiveHtml(controller);

    if (!finalPage) throw new Error('Generator stream ended without a page.');
    renderFinalPage(finalPage);
    saveHistory();

    if (authInfo) {
      setStatus('bad', 'Login needed');
      showAuthCommands(authInfo.authMessage || 'Codex login needed.');
    }
  } catch (error) {
    if (controller.signal.aborted || serial !== state.navigationSerial) return;
    finishLiveHtml(controller);
    if (els.activeTabTitle) els.activeTabTitle.textContent = 'Generation error';
    renderFinalPage({ title: 'Generation error', html: errorPage(address, error.message) });
  }
}

function errorPage(address, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Generation error</title><style>:root{color-scheme:light;font-family:Arial,"Segoe UI",Roboto,sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#202124}main{width:min(720px,calc(100vw - 40px));border:1px solid #dadce0;border-radius:20px;padding:32px;background:#fff;box-shadow:0 1px 2px rgba(60,64,67,.16),0 8px 28px rgba(60,64,67,.12)}.mark{width:48px;height:48px;border-radius:50%;background:conic-gradient(#4285f4 0 25%,#ea4335 0 50%,#fbbc04 0 75%,#34a853 0);margin-bottom:18px}h1{margin:0 0 10px;font-size:28px;font-weight:500;letter-spacing:-.02em}p{color:#5f6368;line-height:1.55}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}a{display:inline-flex;align-items:center;min-height:38px;padding:0 16px;border-radius:999px;text-decoration:none;font-weight:600}.primary{background:#1a73e8;color:#fff}.secondary{background:#f1f3f4;color:#3c4043}details{margin-top:18px;border:1px solid #edf0f2;border-radius:14px;background:#f8fafd}summary{cursor:pointer;padding:14px 16px;color:#3c4043;font-weight:600}pre{white-space:pre-wrap;margin:0;padding:0 16px 16px;color:#a50e0e;font-size:12px;line-height:1.45;max-height:240px;overflow:auto}</style></head><body><main><div class="mark" aria-hidden="true"></div><h1>Generator hiccup</h1><p><strong>Address:</strong> ${escapeHtml(address)}</p><p>The shell is fine. This was an internal page-generation failure. Try reload, or go home and search again.</p><div class="actions"><a class="primary" href="${escapeHtml(address)}">Try again</a><a class="secondary" href="synthetic://home">Go home</a></div><details><summary>Technical details</summary><pre>${escapeHtml(message || 'Unknown generator error.')}</pre></details></main></body></html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showAuthCommands(message = 'Codex login needed.') {
  if (!els.authDialog.open) els.authDialog.showModal();
  els.authLog.textContent = `${message}\n\nRun in your terminal:\nslopweb login\nslopweb status`;
}

function clearHistory() {
  state.entries = [];
  state.index = -1;
  state.currentHtml = '';
  state.liveBuffer = '';
  saveHistory();
  renderHistory(navigate);
  if (els.chromeMenu) els.chromeMenu.open = false;
  navigate('synthetic://home');
}

function renderActiveTab() {
  const tab = activeTab();
  els.addressInput.value = state.entries[state.index] || tab?.entries?.[tab.index] || 'synthetic://home';
  document.title = `${tab?.title || 'New Tab'} · Slopweb`;
  state.liveBuffer = tab?.source || tab?.html || '';
  state.currentHtml = tab?.html || '';
  renderTabs({ activate: switchTab, close: closeExistingTab });
  renderHistory(navigate);
  updateOmniboxState();
  renderSource(els.liveSource, els.sourceStatus, state.liveBuffer);
  if (state.currentHtml) {
    els.frame.onload = null;
    liveFrameReady = false;
    els.frame.srcdoc = composeSrcdoc(state.currentHtml);
  } else {
    navigate('synthetic://home', { push: false, index: 0 });
  }
}

function switchTab(id) {
  if (id === state.activeTabId) return;
  if (state.abortController) state.abortController.abort();
  commitActiveTab();
  activateTab(id);
  renderActiveTab();
}

function closeExistingTab(id) {
  if (state.abortController) state.abortController.abort();
  closeTab(id);
  renderActiveTab();
}

function openNewTab() {
  if (state.abortController) state.abortController.abort();
  createTab('synthetic://home');
  renderActiveTab();
}

els.navForm.addEventListener('submit', event => {
  event.preventDefault();
  navigate(els.addressInput.value);
});
els.addressInput.addEventListener('input', updateOmniboxState);
els.addressInput.addEventListener('focus', () => requestAnimationFrame(() => els.addressInput.select()));
els.omniboxClear.addEventListener('click', () => { els.addressInput.value = ''; updateOmniboxState(); els.addressInput.focus(); });
els.newTabBtn.addEventListener('click', openNewTab);
els.tabList.addEventListener('dblclick', event => {
  if (event.target.closest('.tab')) return;
  openNewTab();
});
els.backBtn.addEventListener('click', () => { if (state.index > 0) navigate(state.entries[state.index - 1], { push: false, index: state.index - 1 }); });
els.forwardBtn.addEventListener('click', () => { if (state.index < state.entries.length - 1) navigate(state.entries[state.index + 1], { push: false, index: state.index + 1 }); });
els.reloadBtn.addEventListener('click', () => { navigate(state.entries[state.index] || els.addressInput.value, { push: false, index: Math.max(state.index, 0) }); });
els.homeBtn.addEventListener('click', () => navigate('synthetic://home'));
els.clearBtn.addEventListener('click', clearHistory);
els.menuNewTab?.addEventListener('click', () => { if (els.chromeMenu) els.chromeMenu.open = false; openNewTab(); });
els.menuFocusAddress?.addEventListener('click', () => { if (els.chromeMenu) els.chromeMenu.open = false; focusAddress(); });
els.sourceCollapse.addEventListener('click', toggleSource);

document.querySelectorAll('[data-jump]').forEach(button => {
  button.addEventListener('click', () => {
    if (els.chromeMenu) els.chromeMenu.open = false;
    navigate(button.dataset.jump);
  });
});

window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'l') { event.preventDefault(); focusAddress(); }
  if ((event.ctrlKey || event.metaKey) && key === 'r') { event.preventDefault(); els.reloadBtn.click(); }
  if ((event.ctrlKey || event.metaKey) && key === 't') { event.preventDefault(); openNewTab(); }
  if ((event.ctrlKey || event.metaKey) && key === 'w') { event.preventDefault(); closeExistingTab(state.activeTabId); }
  if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(key)) {
    event.preventDefault();
    const index = Math.min(Number(key) - 1, state.tabs.length - 1);
    if (state.tabs[index]) switchTab(state.tabs[index].id);
  }
  if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); els.backBtn.click(); }
  if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); els.forwardBtn.click(); }
});

setSourceOpen(state.sourceOpen);
updateOmniboxState();
await checkAuth();
renderTabs({ activate: switchTab, close: closeExistingTab });
renderHistory(navigate);
const params = new URLSearchParams(location.search);
if (params.get('resume') === '1' && state.entries[state.index]) {
  els.addressInput.value = state.entries[state.index];
  updateOmniboxState();
  await navigate(state.entries[state.index], { push: false, index: state.index });
} else {
  renderActiveTab();
}
