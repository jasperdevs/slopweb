import { state, saveSourceOpen } from './state.js';

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
  frame: document.querySelector('#pageFrame'),
  liveBadge: document.querySelector('#liveBadge'),
  liveBadgeText: document.querySelector('#liveBadge b'),
  materializeLayer: document.querySelector('#materializeLayer'),
  buildStatus: document.querySelector('#buildStatus'),
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
  menuFocusAddress: document.querySelector('#menuFocusAddress'),
  menuToggleSource: document.querySelector('#menuToggleSource'),
  viewportShell: document.querySelector('.viewport-shell')
};

let materializeHideTimer = null;

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
  els.liveBadge.classList.toggle('hidden', !active);
  els.liveBadgeText.textContent = text;
  if (els.sourceStatus) els.sourceStatus.textContent = active ? 'streaming' : 'idle';
}

export function resetMaterialize(address, reason = 'opening') {
  clearTimeout(materializeHideTimer);
  state.materializedTags = [];
  state.materializedBytes = 0;
  els.materializeLayer.classList.remove('hidden', 'settled');
  els.frame.classList.add('is-materializing');
  els.buildStatus.textContent = `${reason.replace(/-/g, ' ')}: ${address}`;
  els.elementTrail.replaceChildren();
}

export function updateMaterialize(tags, bytes) {
  state.materializedTags = tags.slice(-36);
  state.materializedBytes = bytes;
  const recent = state.materializedTags.slice(-7);
  const count = state.materializedTags.length;
  els.buildStatus.textContent = count
    ? `${count} elements · ${Math.max(1, Math.round(bytes / 1024))}kb`
    : `${Math.max(1, Math.round(bytes / 1024))}kb received`;
  els.elementTrail.replaceChildren(...recent.map((tag, index) => {
    const item = document.createElement('li');
    item.style.setProperty('--stagger', String(index));
    item.textContent = `<${tag}>`;
    return item;
  }));
}

export function settleMaterialize() {
  els.materializeLayer.classList.add('settled');
  els.frame.classList.remove('is-materializing');
  clearTimeout(materializeHideTimer);
  materializeHideTimer = setTimeout(() => {
    els.materializeLayer.classList.add('hidden');
    els.materializeLayer.classList.remove('settled');
  }, 900);
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
