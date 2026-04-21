# Slopweb

A local shell where AI generates each page.

## Start

```powershell
npm install -g slopweb
slopweb
```

Press `Ctrl+C` to stop the server.

## Local Models

```powershell
slopweb models
slopweb --base-url http://localhost:11434/v1 --model llama3.2
```

## Codex OAuth

```powershell
slopweb login
slopweb --codex
```

## Source

```powershell
pnpm install
pnpm start
pnpm run check
```
