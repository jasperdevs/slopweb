# Slopweb

A local shell where synthetic addresses generate self-contained static HTML pages.

## Install

```powershell
npx slopweb
```

From the repository root:

```powershell
npm install
npm start
```

For a permanent install:

```powershell
npm install -g slopweb
slopweb
```

Open:

```text
http://localhost:8787
```

## Codex OAuth

Slopweb wraps Codex OAuth directly:

```powershell
npx slopweb login
npx slopweb status
npx slopweb
```

The app also exposes the same login flow through the Codex button.

## AI SDK Mode

Set an API key to stream model text directly through the Vercel AI SDK:

```powershell
$env:OPENAI_API_KEY="your_key_here"
$env:AI_PROVIDER="ai-sdk"
npx slopweb
```

## Notes

Generated pages are forced to static HTML and CSS only. The sanitizer removes script tags, inline event handlers, `javascript:` URLs, and generated iframes. Navigation still works because the parent shell intercepts normal links and forms.
