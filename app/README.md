# Slopweb

A local shell where synthetic addresses generate self-contained HTML pages.

## Install

```powershell
npx slopweb
```

```powershell
pnpm dlx slopweb
```

From the repository root:

```powershell
pnpm install
pnpm start
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

Running `slopweb` in a terminal opens a launchpad for detected local models, Codex OAuth, or a manual local endpoint.

## Codex OAuth

Slopweb can use Codex OAuth from the CLI:

```powershell
npx slopweb login
npx slopweb status
npx slopweb --codex
```

Slopweb uses an existing `codex` command when it finds one, then falls back to `npx @openai/codex`.

## Model Providers

Vercel AI SDK is included for local OpenAI-compatible endpoints. Slopweb does not use OpenAI API keys.

```powershell
slopweb models
```

```powershell
slopweb --base-url http://localhost:11434/v1 --model llama3.2
```

Auto-detection checks running Ollama, LM Studio, llama.cpp/llamafile, vLLM, SGLang, Jan, text-generation-webui, KoboldCpp, LocalAI, LiteLLM, TabbyAPI, Aphrodite, Xinference, Open WebUI, and AnythingLLM endpoints. It also scans installed Ollama manifests, LM Studio, Jan, GPT4All, Msty, Hugging Face cache, and local GGUF model folders.
Set `SLOPWEB_BASE_URLS` to a comma-separated list when you run multiple custom local OpenAI-compatible servers.

## Slash Commands

Type these in the address bar:

```text
/help
/search robots making websites
/go synthetic://news/world-wire
/source
/login
/clear
```

## Notes

Generated pages are self-contained HTML files. External network calls, generated iframes, embeds, and `javascript:` URLs are blocked; links and forms route back through the shell.
