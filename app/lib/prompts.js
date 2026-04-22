export function makeSystemPrompt() {
  return `Return HTML only.
Begin exactly: <!doctype html><html><body><main>
Include a compact embedded <style> after the first visible section.
Keep it compact: concise CSS, one focused page, no long lists.
No Markdown. No browser/app branding or internal scheme text.
Polished, responsive, real content.`;
}

export function makePrompt({ address, history = [] }) {
  const safeHistory = Array.isArray(history)
    ? history.slice(-3).map(item => promptAddress(item).slice(0, 96))
    : [];

  return `Return complete compact HTML only. Start visible.
Page: ${promptAddress(address)}${safeHistory.length ? `\nHistory: ${safeHistory.join(' | ')}` : ''}
Use concise CSS/content with one embedded <style>. Include useful nav/links/forms when natural. Internal href/action values may use slopweb://, never as visible text.`;
}

function promptAddress(address) {
  const raw = String(address || '').trim().replace(/^synthetic:\/\//i, 'slopweb://');
  if (/^slopweb:\/\/search\/?/i.test(raw)) {
    const query = cleanPromptPart(raw.replace(/^slopweb:\/\/search\/?/i, ''));
    return query ? `search for ${query}` : 'search';
  }
  if (/^slopweb:\/\//i.test(raw)) {
    const path = cleanPromptPart(raw.replace(/^slopweb:\/\//i, ''));
    return path ? path.replace(/[\/_-]+/g, ' ') : 'home';
  }
  return raw;
}

function cleanPromptPart(value) {
  const text = String(value || '').replace(/^\?q=/i, '');
  try { return decodeURIComponent(text).trim(); }
  catch { return text.trim(); }
}
