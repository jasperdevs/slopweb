import { config } from './config.js';

export function makePrompt({ address, history = [] }) {
  const safeHistory = Array.isArray(history)
    ? history.slice(-8).map(item => String(item).slice(0, 200))
    : [];

  return `You are the raw HTML page compiler for a local app called Slopweb.

Task:
Generate one complete, original, static HTML document for this synthetic browser address:
${address}

Rules:
- Return ONLY raw HTML. No JSON. No markdown. No code fences. No explanation.
- The first bytes of your answer must be <!doctype html>.
- Output one full document with <html>, <head>, and <body>.
- Do not include JavaScript at all: no <script>, no inline event handlers, no javascript: URLs, no modules, no imports.
- Use semantic HTML and inline CSS in one <style> tag only.
- Do not fetch, embed, or depend on external websites, external CSS, external JS, external images, CDNs, APIs, trackers, fonts, iframes, object tags, embeds, or media.
- Make the page feel like a real browsable page for the address, but do not clone exact copyrighted layouts or copy protected text from real sites.
- All links and form actions must point to plausible synthetic addresses. The browser shell will intercept them and generate the next page.
- Use polished static controls: nav, cards, forms, filters, tables, chips, accordions made with <details>, and useful content.
- Keep it safe: no credential collection, no payment forms, no malware, no hidden network calls, no attempts to escape the iframe, no parent/window manipulation.
- No reasoning text. No mention that you are an AI unless the requested address is explicitly about AI.
- Prefer concise, fast-rendering HTML and CSS.

Default mode:
- Model: ${config.codexModel}
- Reasoning/thinking UI: off. Do not show chain-of-thought, planning, or hidden analysis.

Recent synthetic navigation history:
${safeHistory.length ? safeHistory.join('\n') : '(none)'}

Generate the raw HTML document now.`;
}

export function makeJsonPrompt({ address, history = [] }) {
  const safeHistory = Array.isArray(history)
    ? history.slice(-8).map(item => String(item).slice(0, 200))
    : [];

  return `Generate a complete static HTML page for Slopweb address ${address}.
Return a JSON object with title, summary, and html. The html field must start with <!doctype html>.
No JavaScript at all: no script tags, inline handlers, javascript: URLs, modules, imports, object/embed tags, or iframes.
Use inline CSS only. No external dependencies or network calls.
Recent synthetic navigation history:\n${safeHistory.length ? safeHistory.join('\n') : '(none)'}`;
}
