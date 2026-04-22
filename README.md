<p align="center">
  <img src="./assets/logo.png" alt="Slopweb logo" width="160" />
</p>

<h1 align="center">Slopweb</h1>

<p align="center">A local browser shell where AI generates every page as live HTML.</p>

<p align="center">
  <img src="./assets/screenshot-browser.png" alt="Slopweb browser shell with generated page and live source" width="1100" />
</p>

## Quick Start

```powershell
npm install -g slopweb
slopweb
```

Pick a local model or Codex in the launcher, then open the printed local URL.

<p align="center">
  <img src="./assets/screenshot-launcher.png" alt="Slopweb launcher model picker" width="680" />
</p>

<details>
<summary>Local models and custom endpoints</summary>

Slopweb detects common local runtimes and OpenAI-compatible APIs, including Ollama, LM Studio, llama.cpp/llamafile, vLLM, SGLang, Jan, text-generation-webui, and KoboldCpp.

```powershell
slopweb models
slopweb --base-url http://localhost:11434/v1 --model llama3.2
```

Custom provider definitions can live in `~/.slopweb/models.json`.

</details>

<details>
<summary>Server options</summary>

```powershell
slopweb --port 9000
slopweb --strict-port
slopweb --lan
slopweb --no-picker
```

The HTTP API is localhost-only by default. Use `--lan` only when you intentionally want LAN access.

</details>

<details>
<summary>Run from source</summary>

```powershell
pnpm install
pnpm start
pnpm run check
```

</details>

## License

MIT
