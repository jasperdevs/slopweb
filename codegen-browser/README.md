# Codegen Browser

A local Chrome-like browser shell where synthetic addresses generate self-contained static HTML pages.

## Install

```powershell
npx genweb
```

From the repository root:

```powershell
npm install
npm start
```

For a permanent install:

```powershell
npm install -g genweb
genweb
```

Open:

```text
http://localhost:8787
```

## Codex OAuth

Genweb wraps Codex OAuth directly:

```powershell
npx genweb login
npx genweb status
npx genweb
```

The browser also exposes the same login flow through the Codex button.

## AI SDK Mode

Set an API key to stream model text directly through the Vercel AI SDK:

```powershell
$env:OPENAI_API_KEY="your_key_here"
$env:AI_PROVIDER="ai-sdk"
npx genweb
```

## Notes

Generated pages are forced to static HTML and CSS only. The sanitizer removes script tags, inline event handlers, `javascript:` URLs, and generated iframes. Browser navigation still works because the parent shell intercepts normal links and forms.
