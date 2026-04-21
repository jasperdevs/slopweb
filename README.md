<p align="center">
  <img src="./assets/logo.png" alt="Agentic Web logo" width="220" />
</p>

<h1 align="center">Agentic Web</h1>

<p align="center">A new web where every site is generated with AI.</p>

## About

Agentic Web is an early project for exploring AI-generated websites: pages, interfaces, and web experiences produced by agents instead of hand-built from scratch.

## Install

After the package is published to npm, the fastest way to run Agentic Web is:

```powershell
npx agenticweb
```

Then open:

```text
http://localhost:8787
```

For a permanent install:

```powershell
npm install -g agenticweb
agenticweb
```

The app starts on `localhost` by default. LAN access is off unless you opt in with `--lan`.

## Run From Source

If you are working from this repository:

```powershell
npm install
npm start
```

The first app is Codegen Browser, a local browser shell where synthetic addresses generate self-contained static HTML pages.

## Codex Setup

For real Codex-backed generation, install and log in to the Codex CLI first:

```powershell
npm i -g @openai/codex
codex login
npx agenticweb
```

For direct AI SDK streaming instead:

```powershell
$env:OPENAI_API_KEY="your_key_here"
$env:AI_PROVIDER="ai-sdk"
npx agenticweb
```

## CLI Options

```powershell
agenticweb --port 9000
agenticweb --mock
agenticweb --lan
```

## Package Status

This repository is ready to publish as the `agenticweb` npm package, but it has not been published from this repo yet. Until it is published, use the source install flow above.
