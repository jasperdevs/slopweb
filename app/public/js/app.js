import { state, saveHistory } from './state.js';
import { checkAuthStatus, readNdjsonStream } from './api.js';
import { composeSrcdoc, updateSourcePreview } from './frame.js';
import { els, setStatus, updateOmniboxState, focusAddress, setLiveMode, setSourceOpen, toggleSource, renderHistory } from './ui.js';

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
    if (data.connected) setStatus('good', data.provider === 'ai-sdk' ? 'AI SDK ready' : 'Codex ready');
    else if (data.mock) setStatus('warn', 'Mock mode');
    else setStatus('bad', data.provider === 'ai-sdk' ? 'API key needed' : 'Login needed');
    return data;
  } catch {
    setStatus('bad', 'Offline');
    return { connected: false };
  }
}

function resetLiveDocument() {
  state.liveBuffer = '';
  state.liveRenderQueued = false;
  els.liveSource.textContent = '';
  els.sourceStatus.textContent = 'waiting';
  els.frame.srcdoc = composeSrcdoc('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Loading</title><style>html,body{margin:0;min-height:100%;background:#fff;font-family:Arial,sans-serif;color:#202124}</style></head><body></body></html>');
}

function scheduleLiveRender() {
  if (state.liveRenderQueued) return;
  state.liveRenderQueued = true;
  requestAnimationFrame(() => {
    state.liveRenderQueued = false;
    els.frame.srcdoc = composeSrcdoc(state.liveBuffer);
  });
}

function appendLiveHtml(chunk) {
  if (!chunk) return;
  state.liveBuffer += chunk;
  updateSourcePreview(els.liveSource, els.sourceStatus, state.liveBuffer);
  scheduleLiveRender();
}

function beginLiveHtml(address) {
  if (state.abortController) state.abortController.abort();
  state.abortController = new AbortController();
  setLiveMode(true, 'assembling elements');
  resetLiveDocument();
  updateSourcePreview(els.liveSource, els.sourceStatus, state.liveBuffer);
  return state.abortController;
}

function finishLiveHtml() {
  setLiveMode(false);
  els.sourceStatus.textContent = state.liveBuffer ? 'done' : 'idle';
}

function wireFrameNavigation() {
  let doc;
  try { doc = els.frame.contentDocument; } catch { return; }
  if (!doc || doc.__slopwebWired) return;
  doc.__slopwebWired = true;

  doc.addEventListener('click', event => {
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    const next = normalizeInput(href, state.entries[state.index]);
    if (!next) return;
    event.preventDefault();
    navigate(next);
  }, true);

  doc.addEventListener('submit', event => {
    const form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    const action = form.getAttribute('action') || 'synthetic://search';
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    const suffix = params.toString();
    const href = method === 'get' && suffix ? action + (action.includes('?') ? '&' : '?') + suffix : action;
    const next = normalizeInput(href, state.entries[state.index]);
    if (next) navigate(next);
  }, true);

  doc.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      focusAddress();
    }
  });
}

function renderFinalPage(page) {
  document.title = `${page.title || 'Generated page'} · Slopweb`;
  if (els.activeTabTitle) els.activeTabTitle.textContent = page.title || 'Generated page';
  state.currentHtml = page.html || '';
  state.liveBuffer = page.html || state.liveBuffer;
  updateSourcePreview(els.liveSource, els.sourceStatus, state.liveBuffer);
  els.frame.srcdoc = composeSrcdoc(page.html || state.liveBuffer || '');
  window.setTimeout(wireFrameNavigation, 80);
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
      if (event.type === 'reset') resetLiveDocument();
      else if (event.type === 'status') setLiveMode(true, event.text || 'assembling elements');
      else if (event.type === 'chunk') appendLiveHtml(event.text || '');
      else if (event.type === 'done') {
        finalPage = event.page;
        if (event.page?.authRequired) authInfo = event.page;
      } else if (event.type === 'error') {
        throw new Error(event.error || 'Generation failed.');
      }
    });

    if (serial !== state.navigationSerial) return;
    finishLiveHtml();

    if (!finalPage) throw new Error('Generator stream ended without a page.');
    renderFinalPage(finalPage);

    if (authInfo) {
      setStatus('bad', 'Login needed');
      if (!els.authDialog.open) els.authDialog.showModal();
      els.authLog.textContent = `${authInfo.authMessage || 'Codex login needed.'}\n\nRun: npm i -g @openai/codex\nThen: codex login`;
    }
  } catch (error) {
    if (controller.signal.aborted || serial !== state.navigationSerial) return;
    finishLiveHtml();
    if (els.activeTabTitle) els.activeTabTitle.textContent = 'Generation error';
    renderFinalPage({ title: 'Generation error', html: errorPage(address, error.message) });
  }
}

function errorPage(address, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Generation error</title><style>:root{color-scheme:light;font-family:Arial,"Segoe UI",Roboto,sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#202124}main{width:min(720px,calc(100vw - 40px));border:1px solid #dadce0;border-radius:20px;padding:32px;background:#fff;box-shadow:0 1px 2px rgba(60,64,67,.16),0 8px 28px rgba(60,64,67,.12)}.mark{width:48px;height:48px;border-radius:50%;background:conic-gradient(#4285f4 0 25%,#ea4335 0 50%,#fbbc04 0 75%,#34a853 0);margin-bottom:18px}h1{margin:0 0 10px;font-size:28px;font-weight:500;letter-spacing:-.02em}p{color:#5f6368;line-height:1.55}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}a{display:inline-flex;align-items:center;min-height:38px;padding:0 16px;border-radius:999px;text-decoration:none;font-weight:600}.primary{background:#1a73e8;color:#fff}.secondary{background:#f1f3f4;color:#3c4043}details{margin-top:18px;border:1px solid #edf0f2;border-radius:14px;background:#f8fafd}summary{cursor:pointer;padding:14px 16px;color:#3c4043;font-weight:600}pre{white-space:pre-wrap;margin:0;padding:0 16px 16px;color:#a50e0e;font-size:12px;line-height:1.45;max-height:240px;overflow:auto}</style></head><body><main><div class="mark" aria-hidden="true"></div><h1>Generator hiccup</h1><p><strong>Address:</strong> ${escapeHtml(address)}</p><p>The browser shell is fine. This was an internal page-generation failure. Try reload, or go home and search again.</p><div class="actions"><a class="primary" href="${escapeHtml(address)}">Try again</a><a class="secondary" href="synthetic://home">Go home</a></div><details><summary>Technical details</summary><pre>${escapeHtml(message || 'Unknown generator error.')}</pre></details></main></body></html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

els.frame.addEventListener('load', wireFrameNavigation);
els.navForm.addEventListener('submit', event => { event.preventDefault(); navigate(els.addressInput.value); });
els.addressInput.addEventListener('input', updateOmniboxState);
els.addressInput.addEventListener('focus', () => requestAnimationFrame(() => els.addressInput.select()));
els.omniboxClear.addEventListener('click', () => { els.addressInput.value = ''; updateOmniboxState(); els.addressInput.focus(); });
els.backBtn.addEventListener('click', () => { if (state.index > 0) navigate(state.entries[state.index - 1], { push: false, index: state.index - 1 }); });
els.forwardBtn.addEventListener('click', () => { if (state.index < state.entries.length - 1) navigate(state.entries[state.index + 1], { push: false, index: state.index + 1 }); });
els.reloadBtn.addEventListener('click', () => { navigate(state.entries[state.index] || els.addressInput.value, { push: false, index: Math.max(state.index, 0) }); });
els.homeBtn.addEventListener('click', () => navigate('synthetic://home'));
els.clearBtn.addEventListener('click', () => { state.entries = []; state.index = -1; saveHistory(); renderHistory(navigate); if (els.chromeMenu) els.chromeMenu.open = false; navigate('synthetic://home'); });
els.connectBtn.addEventListener('click', () => els.authDialog.showModal());
els.menuFocusAddress?.addEventListener('click', () => { if (els.chromeMenu) els.chromeMenu.open = false; focusAddress(); });
els.sourceToggle.addEventListener('click', toggleSource);
els.sourceCollapse.addEventListener('click', () => setSourceOpen(false));
els.menuToggleSource?.addEventListener('click', () => { if (els.chromeMenu) els.chromeMenu.open = false; toggleSource(); });

document.querySelectorAll('[data-jump]').forEach(button => {
  button.addEventListener('click', () => {
    if (els.chromeMenu) els.chromeMenu.open = false;
    navigate(button.dataset.jump);
  });
});

els.startDeviceLoginBtn.addEventListener('click', () => {
  els.authLog.textContent = '';
  const events = new EventSource('/api/auth/login');
  events.addEventListener('log', event => {
    const data = JSON.parse(event.data);
    els.authLog.textContent += data.text;
    els.authLog.scrollTop = els.authLog.scrollHeight;
  });
  events.addEventListener('error', event => {
    try {
      const data = JSON.parse(event.data);
      els.authLog.textContent += `\n${data.text}\n`;
    } catch {
      els.authLog.textContent += '\nLogin stream closed.\n';
    }
    events.close();
    checkAuth();
  });
  events.addEventListener('done', event => {
    const data = JSON.parse(event.data);
    els.authLog.textContent += `\nOAuth process finished with code ${data.code}.\n`;
    events.close();
    checkAuth();
  });
});

window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'l') { event.preventDefault(); focusAddress(); }
  if ((event.ctrlKey || event.metaKey) && key === 'r') { event.preventDefault(); els.reloadBtn.click(); }
  if ((event.ctrlKey || event.metaKey) && key === 't') { event.preventDefault(); navigate('synthetic://home'); }
  if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); els.backBtn.click(); }
  if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); els.forwardBtn.click(); }
});

setSourceOpen(state.sourceOpen);
updateOmniboxState();
await checkAuth();
renderHistory(navigate);
const params = new URLSearchParams(location.search);
if (params.get('resume') === '1' && state.entries[state.index]) {
  els.addressInput.value = state.entries[state.index];
  updateOmniboxState();
  await navigate(state.entries[state.index], { push: false, index: state.index });
} else {
  await navigate('synthetic://home');
}
