import { activateTab, activeTab, closeTab, commitActiveTab, createTab, state, saveHistory, updateActiveTabTitle } from './state.js';
import { checkAuthStatus, deleteSavedPage, listSavedPages, readNdjsonStream } from './api.js';
import { composeLiveSrcdoc, composeStaticSrcdoc } from './frame.js';
import { homePage } from './home.js';
import { els, setStatus, updateOmniboxState, focusAddress, setLiveMode, setSourceOpen, renderHistory, renderTabs, renderSource, initSourceResizer } from './ui.js';
import { escapeHtml } from './utils.js';

let liveFrameReady = false;
let liveFrameShellActive = true;
let liveFrameTimer = 0;
let liveSourceTimer = 0;
let lastSourceRenderAt = 0;
let lastLiveFrameHtml = '';
const SOURCE_RENDER_INTERVAL_MS = 140;
const streamPerfEnabled = (() => {
  try {
    return new URLSearchParams(location.search).has('streamMetrics') || localStorage.getItem('slopweb-stream-metrics') === '1';
  } catch {
    return false;
  }
})();
const streamTextEncoder = streamPerfEnabled ? new TextEncoder() : null;
const streamPerf = streamPerfEnabled ? (window.__slopStream = window.__slopStream || { current: null, history: [] }) : null;

function beginStreamPerf(address) {
  if (!streamPerf) return null;
  const run = { address, startedAt: performance.now(), ttfbMs: 0, ttfeMs: 0, chunkCount: 0, bytes: 0, renderFrames: 0, iframePosts: 0 };
  streamPerf.current = run;
  streamPerf.history.push(run);
  if (streamPerf.history.length > 20) streamPerf.history.shift();
  return run;
}

function markStreamFirstEvent(run) {
  if (run && !run.ttfbMs) run.ttfbMs = performance.now() - run.startedAt;
}

function markStreamChunk(run, text) {
  if (!run) return;
  run.chunkCount += 1;
  run.bytes += streamTextEncoder ? streamTextEncoder.encode(String(text || '')).byteLength : String(text || '').length;
}

function markStreamFrame(run) {
  if (run) run.renderFrames += 1;
}

function markStreamPost(run) {
  if (run) run.iframePosts += 1;
}

function markStreamFirstElement() {
  const run = streamPerf?.current;
  if (run && !run.ttfeMs) run.ttfeMs = performance.now() - run.startedAt;
}

function postToFrame(message) {
  if (!liveFrameReady || !els.frame.contentWindow) return;
  els.frame.contentWindow.postMessage(message, '*');
}

function normalizeInput(value, base = state.entries[state.index]) {
  const raw = String(value || '').trim().replace(/^synthetic:\/\//i, 'slopweb://');
  if (!raw) return 'slopweb://home';
  if (/^#/i.test(raw)) return null;
  if (/^javascript:/i.test(raw)) return null;
  if (/^slopweb\/pages\/[^/]+\.html$/i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) {
    try { return new URL(raw, base || 'slopweb://local').href; }
    catch { return `slopweb://local${raw}`; }
  }
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
  return `slopweb://search/${encodeURIComponent(raw)}`;
}

async function checkAuth() {
  try {
    const data = await checkAuthStatus();
    if (data.connected) {
      const label = data.provider === 'ai-sdk' ? (data.localModel || data.model || 'Local AI') : 'Codex ready';
      setStatus('good', label.length > 28 ? `${label.slice(0, 25)}...` : label);
      els.authStatus.title = data.provider === 'ai-sdk' ? `Local AI: ${data.localModel || data.model}\n${data.localBaseUrl || ''}` : 'Codex ready';
    }
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
  lastLiveFrameHtml = '';
  clearLiveSourceTimer();
  els.sourceStatus.textContent = 'waiting';
  if (state.sourceOpen) renderSource(els.liveSource, els.sourceStatus, '');
  setLiveMode(true, reason === 'model' || reason === 'codex-final' ? 'receiving html' : 'waiting');
  if (liveFrameTimer) {
    window.clearTimeout(liveFrameTimer);
    liveFrameTimer = 0;
  }
  postToFrame({ type: 'slopweb:reset' });
}

function hasOpenRawTextTag(text, tag) {
  return text.lastIndexOf(`<${tag}`) > text.lastIndexOf(`</${tag}`);
}

function canRenderLiveHtml(html) {
  const text = String(html || '');
  if (!text.trim()) return false;
  const lowerText = text.toLowerCase();
  return !['style', 'script', 'textarea', 'title'].some(tag => hasOpenRawTextTag(lowerText, tag));
}

function postLivePreview() {
  if (!canRenderLiveHtml(state.liveBuffer)) return;
  if (state.liveBuffer === lastLiveFrameHtml) return;
  lastLiveFrameHtml = state.liveBuffer;
  markStreamPost(streamPerf?.current);
  postToFrame({ type: 'slopweb:preview', html: state.liveBuffer });
}

function scheduleLiveFrameRender() {
  if (liveFrameTimer) return;
  liveFrameTimer = window.setTimeout(() => {
    liveFrameTimer = 0;
    postLivePreview();
  }, 0);
}

function clearLiveSourceTimer() {
  if (!liveSourceTimer) return;
  window.clearTimeout(liveSourceTimer);
  liveSourceTimer = 0;
}

function renderLiveSourceNow() {
  clearLiveSourceTimer();
  lastSourceRenderAt = performance.now();
  renderSource(els.liveSource, els.sourceStatus, state.liveBuffer);
}

function scheduleLiveSourceRender() {
  if (!state.sourceOpen || liveSourceTimer) return;
  const delay = Math.max(0, SOURCE_RENDER_INTERVAL_MS - (performance.now() - lastSourceRenderAt));
  if (delay <= 0) {
    renderLiveSourceNow();
    return;
  }
  liveSourceTimer = window.setTimeout(renderLiveSourceNow, delay);
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
    if (shouldRenderSource) scheduleLiveSourceRender();
    if (shouldRenderFrame) {
      markStreamFrame(streamPerf?.current);
      scheduleLiveFrameRender();
    }
  });
}

function appendLiveHtml(chunk) {
  if (!chunk) return;
  state.liveBuffer += chunk;
  scheduleLiveRender({ source: state.sourceOpen, frame: true });
}

function beginLiveHtml(address) {
  if (state.abortController) state.abortController.abort();
  state.abortController = new AbortController();
  if (!liveFrameShellActive) {
    liveFrameReady = false;
    liveFrameShellActive = true;
    els.frame.srcdoc = composeLiveSrcdoc();
  }
  els.stopBtn?.classList.remove('hidden');
  setLiveMode(true, 'assembling elements');
  els.addressInput.value = address;
  resetLiveDocument('opening');
  return state.abortController;
}

function finishLiveHtml(controller = state.abortController) {
  setLiveMode(false);
  els.sourceStatus.textContent = state.liveBuffer ? 'done' : 'idle';
  els.stopBtn?.classList.add('hidden');
  if (!controller || state.abortController === controller) state.abortController = null;
}

window.addEventListener('message', event => {
  if (event.source !== els.frame.contentWindow) return;
  if (event.data?.type === 'slopweb:first-element') {
    markStreamFirstElement();
    return;
  }
  if (event.data?.type !== 'slopweb:navigate') return;
  const next = normalizeInput(event.data.href, state.entries[state.index]);
  if (next) navigate(next);
});

function renderFinalPage(page) {
  document.title = `${page.title || 'Generated page'} · Slopweb`;
  state.currentHtml = page.html || '';
  state.liveBuffer = page.html || state.liveBuffer;
  const tab = activeTab();
  if (tab) {
    tab.savedUrl = page.savedUrl || tab.savedUrl || '';
    tab.savedDisplayPath = page.savedDisplayPath || tab.savedDisplayPath || '';
  }
  els.addressInput.value = page.savedDisplayPath || page.address || state.entries[state.index] || 'slopweb/pages/home.html';
  updateOmniboxState();
  updateActiveTabTitle(page.title || 'Generated page');
  renderTabs({ activate: switchTab, close: closeExistingTab });
  if (state.sourceOpen) renderLiveSourceNow();
  else els.sourceStatus.textContent = state.liveBuffer ? `${Math.max(1, Math.round(state.liveBuffer.length / 1024))}kb` : 'empty';
  if (liveFrameTimer) {
    window.clearTimeout(liveFrameTimer);
    liveFrameTimer = 0;
  }
  lastLiveFrameHtml = '';
  postLivePreview();
}

export async function navigate(rawAddress, options = {}) {
  const address = normalizeInput(rawAddress);
  if (!address) return;
  if (isSavedPageAddress(address)) {
    try {
      await openSavedPage(address, options);
    } catch (error) {
      renderFinalPage({ title: 'Saved page missing', html: errorPage(address, error.message), address });
    }
    return;
  }
  if (isHomeAddress(address)) {
    openHomePage(address, options);
    return;
  }
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
  const streamRun = beginStreamPerf(address);
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
      markStreamFirstEvent(streamRun);
      if (event.type === 'reset') resetLiveDocument(event.reason || 'document');
      else if (event.type === 'status') {
        setLiveMode(true, event.text || 'assembling elements');
      }
      else if (event.type === 'chunk') {
        markStreamChunk(streamRun, event.text);
        appendLiveHtml(event.text || '');
      }
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

function openHomePage(address, options = {}) {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  if (options.push !== false) {
    state.entries = state.entries.slice(0, state.index + 1);
    if (state.entries[state.entries.length - 1] !== address) state.entries.push(address);
    state.index = state.entries.length - 1;
  } else if (typeof options.index === 'number') {
    state.index = options.index;
  }
  els.stopBtn?.classList.add('hidden');
  setLiveMode(false);
  els.addressInput.value = address;
  updateOmniboxState();
  renderHistory(navigate);
  const page = homePage(address);
  renderFinalPage(page);
  liveFrameReady = false;
  liveFrameShellActive = false;
  lastLiveFrameHtml = '';
  els.frame.srcdoc = composeStaticSrcdoc(page.html);
  saveHistory();
}

function isHomeAddress(address) {
  return String(address || '').toLowerCase() === 'slopweb://home';
}

function isSavedPageAddress(address) {
  return /^slopweb\/pages\/[^/]+\.html$/i.test(String(address || ''));
}

function fileNameFromSavedAddress(address) {
  return String(address || '').split('/').pop();
}

async function openSavedPage(address, options = {}) {
  const fileName = fileNameFromSavedAddress(address);
  const savedUrl = `/slopweb/pages/${encodeURIComponent(fileName)}`;
  const res = await fetch(savedUrl);
  if (!res.ok) throw new Error(`Saved page not found: ${address}`);
  const html = await res.text();
  if (options.push !== false) {
    state.entries = state.entries.slice(0, state.index + 1);
    if (state.entries[state.entries.length - 1] !== address) state.entries.push(address);
    state.index = state.entries.length - 1;
  } else if (typeof options.index === 'number') {
    state.index = options.index;
  }
  renderHistory(navigate);
  renderFinalPage({
    title: fileName.replace(/\.html$/i, ''),
    html,
    address,
    savedUrl,
    savedDisplayPath: address
  });
  saveHistory();
}

function errorPage(address, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Generation error</title><style>:root{color-scheme:light;font-family:"Inter","Segoe UI",Roboto,Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 10%,rgba(217,48,37,.06),transparent 45%),radial-gradient(circle at 80% 90%,rgba(97,33,210,.05),transparent 45%),#f6f7fa;color:#1a1e30}main{width:min(720px,calc(100vw - 40px));border:1px solid #eef0f5;border-radius:20px;padding:36px;background:#fff;box-shadow:0 2px 6px rgba(18,22,38,.07),0 28px 60px rgba(18,22,38,.14);position:relative;overflow:hidden;animation:err-in 360ms cubic-bezier(.22,1,.36,1) both}main:before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(135deg,#d93025,#6121d2 52%,#3a4af0)}@keyframes err-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.mark{width:46px;height:46px;object-fit:contain;margin-bottom:20px;filter:drop-shadow(0 4px 16px rgba(97,33,210,.2))}h1{margin:0 0 10px;font-size:28px;font-weight:650;letter-spacing:-.02em;color:#121527}p{color:#5b6378;line-height:1.58;margin:0 0 8px;font-size:14px}strong{color:#1a1e30;font-weight:650}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}a{display:inline-flex;align-items:center;min-height:40px;padding:0 18px;border-radius:10px;text-decoration:none;font-weight:600;font-size:13.5px;letter-spacing:-.003em;transition:all .18s cubic-bezier(.22,1,.36,1)}.primary{background:#121527;color:#fff;box-shadow:0 1px 2px rgba(18,22,38,.12),0 4px 14px rgba(18,22,38,.18)}.primary:hover{background:#000;transform:translateY(-1px)}.secondary{background:#f3f4f9;color:#1a1e30}.secondary:hover{background:#e7eaf1}details{margin-top:22px;border:1px solid #eef0f5;border-radius:12px;background:#f6f7fa}summary{cursor:pointer;padding:14px 16px;color:#3c4043;font-weight:600;font-size:13px;list-style:none}summary::-webkit-details-marker{display:none}summary:before{content:"›";display:inline-block;margin-right:8px;color:#8a909f;transition:transform .18s cubic-bezier(.22,1,.36,1)}details[open] summary:before{transform:rotate(90deg)}pre{white-space:pre-wrap;margin:0;padding:0 16px 16px;color:#a50e0e;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;max-height:240px;overflow:auto}</style></head><body><main><img class="mark" src="/assets/logo.png" alt="Slopweb"><h1>Generation failed</h1><p><strong>Address:</strong> ${escapeHtml(address)}</p><p>The shell is still running. Try reload, or go home and search again.</p><div class="actions"><a class="primary" href="${escapeHtml(address)}">Try again</a><a class="secondary" href="slopweb://home">Go home</a></div><details><summary>Technical details</summary><pre>${escapeHtml(message || 'Unknown generator error.')}</pre></details></main></body></html>`;
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
  navigate('slopweb://home');
}

function renderActiveTab() {
  const tab = activeTab();
  els.addressInput.value = state.entries[state.index] || tab?.entries?.[tab.index] || 'slopweb://home';
  document.title = `${tab?.title || 'New Tab'} · Slopweb`;
  state.liveBuffer = tab?.source || tab?.html || '';
  state.currentHtml = tab?.html || '';
  renderTabs({ activate: switchTab, close: closeExistingTab });
  renderHistory(navigate);
  updateOmniboxState();
  if (state.sourceOpen) renderSource(els.liveSource, els.sourceStatus, state.liveBuffer);
  else els.sourceStatus.textContent = state.liveBuffer ? `${Math.max(1, Math.round(state.liveBuffer.length / 1024))}kb` : 'empty';
  if (state.currentHtml) {
    lastLiveFrameHtml = '';
    postLivePreview();
  } else {
    navigate('slopweb://home', { push: false, index: 0 });
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
  createTab('slopweb://home');
  renderActiveTab();
}

function formatSavedPageDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function refreshSavedPages() {
  if (!els.savedPagesList) return;
  els.savedPagesList.textContent = '';
  const { pages = [] } = await listSavedPages();
  if (!pages.length) {
    const li = document.createElement('li');
    const empty = document.createElement('button');
    empty.type = 'button';
    empty.className = 'saved-open';
    empty.disabled = true;
    empty.textContent = 'No saved pages yet';
    li.append(empty);
    els.savedPagesList.append(li);
    return;
  }
  els.savedPagesList.replaceChildren(...pages.map(page => {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'saved-open';
    const title = document.createElement('span');
    title.className = 'saved-title';
    title.textContent = page.fileName.replace(/^\d{4}-\d{2}-\d{2}t/i, '').replace(/\.html$/i, '');
    const meta = document.createElement('span');
    meta.className = 'saved-meta';
    meta.textContent = `${formatSavedPageDate(page.modifiedAt)} · ${Math.max(1, Math.round(Number(page.size || 0) / 1024))}kb`;
    open.append(title, meta);
    open.addEventListener('click', () => {
      els.savedPagesMenu.open = false;
      navigate(page.savedDisplayPath);
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'saved-delete';
    del.setAttribute('aria-label', `Delete ${page.fileName}`);
    del.textContent = '×';
    del.addEventListener('click', async event => {
      event.stopPropagation();
      await deleteSavedPage(page.fileName);
      await refreshSavedPages();
    });
    li.append(open, del);
    return li;
  }));
}

els.navForm.addEventListener('submit', event => {
  event.preventDefault();
  navigate(els.addressInput.value);
});
els.addressInput.addEventListener('input', updateOmniboxState);
els.addressInput.addEventListener('focus', () => requestAnimationFrame(() => els.addressInput.select()));
els.omniboxClear.addEventListener('click', () => { els.addressInput.value = ''; updateOmniboxState(); els.addressInput.focus(); });
els.stopBtn?.addEventListener('click', () => {
  if (state.abortController) state.abortController.abort();
  finishLiveHtml();
});
els.regenBtn?.addEventListener('click', () => navigate(state.entries[state.index] || 'slopweb://home', { push: false, index: Math.max(state.index, 0) }));
els.savedPagesMenu?.addEventListener('toggle', () => { if (els.savedPagesMenu.open) refreshSavedPages().catch(() => {}); });
els.refreshPagesBtn?.addEventListener('click', () => refreshSavedPages().catch(() => {}));
els.newTabBtn.addEventListener('click', openNewTab);
els.tabList.addEventListener('dblclick', event => {
  if (event.target.closest('.tab')) return;
  openNewTab();
});
els.backBtn.addEventListener('click', () => { if (state.index > 0) navigate(state.entries[state.index - 1], { push: false, index: state.index - 1 }); });
els.forwardBtn.addEventListener('click', () => { if (state.index < state.entries.length - 1) navigate(state.entries[state.index + 1], { push: false, index: state.index + 1 }); });
els.reloadBtn.addEventListener('click', () => { navigate(state.entries[state.index] || els.addressInput.value, { push: false, index: Math.max(state.index, 0) }); });
els.homeBtn.addEventListener('click', () => navigate('slopweb://home'));
els.clearBtn.addEventListener('click', clearHistory);
els.menuNewTab?.addEventListener('click', () => { if (els.chromeMenu) els.chromeMenu.open = false; openNewTab(); });
els.menuFocusAddress?.addEventListener('click', () => { if (els.chromeMenu) els.chromeMenu.open = false; focusAddress(); });
els.sourceCollapse.addEventListener('click', () => {
  setSourceOpen(!state.sourceOpen);
  if (state.sourceOpen) renderSource(els.liveSource, els.sourceStatus, state.liveBuffer);
});

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
initSourceResizer();
updateOmniboxState();
const authReady = checkAuth();
renderTabs({ activate: switchTab, close: closeExistingTab });
renderHistory(navigate);
state.entries = ['slopweb://home'];
state.index = 0;
state.currentHtml = '';
state.liveBuffer = '';
saveHistory();
els.frame.addEventListener('load', () => {
  liveFrameReady = true;
  lastLiveFrameHtml = '';
  if (liveFrameShellActive) postLivePreview();
});
liveFrameShellActive = true;
els.frame.srcdoc = composeLiveSrcdoc();
await navigate('slopweb://home', { push: false, index: 0 });
await authReady;
