# Codegen Browser

A local Chrome-like browser shell where synthetic addresses generate self-contained static HTML pages.

## Run

From npm, after the package is published:

```powershell
npx agenticweb
```

From the repository root:

```powershell
npm install
npm start
```

Or from this folder:

```powershell
npm start
```

Open:

```text
http://localhost:8787
```

## Codex OAuth mode

This is the default mode. The app launches your local Codex CLI and uses the same auth store as `codex login`.

```powershell
npm i -g @openai/codex
codex login
npm start
```

## Optional AI SDK streaming mode

This path streams model text directly through the Vercel AI SDK. Install the optional deps and set an API key:

```powershell
npm install
$env:OPENAI_API_KEY="your_key_here"
$env:AI_PROVIDER="ai-sdk"
npm start
```

## Notes

Generated pages are forced to static HTML and CSS only. The sanitizer removes script tags, inline event handlers, `javascript:` URLs, and generated iframes. Browser navigation still works because the parent shell intercepts normal links and forms.
