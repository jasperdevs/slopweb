export function makeSystemPrompt() {
  return `You are Slopweb's page compiler.
Return raw HTML only. The first output bytes must be <!doctype html>.
Build one complete self-contained HTML document with embedded CSS and optional embedded JavaScript.
Keep the head compact: charset, viewport, title, and a short initial style block only.
Open <body> quickly and put the first visible header/main elements early so the browser can reveal real elements while tokens stream.
Add larger page-specific CSS after the first visible structure if needed.
Do not use external assets, CDNs, iframes, trackers, network calls, credential/payment collection, malware, or parent/window access.`;
}

export function makePrompt({ address, history = [] }) {
  const safeHistory = Array.isArray(history)
    ? history.slice(-4).map(item => String(item).slice(0, 120))
    : [];

  return `Generate a real page for:
${address}

Include <html>, <head>, and <body>.
Use embedded <style> and embedded <script> only when useful.
Links/forms should point to plausible synthetic:// or normal-looking addresses so Slopweb can generate the next page.
Do not explain. Do not use markdown. Do not copy protected layouts/text.
History: ${safeHistory.length ? safeHistory.join(' | ') : 'none'}`;
}
