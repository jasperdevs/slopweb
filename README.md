<p align="center">
  <img src="./assets/logo.png" alt="Slopweb logo" width="220" />
</p>

<h1 align="center">Slopweb</h1>

<p align="center">A new web where AI generates every page.</p>

## Install

```powershell
npm install -g slopweb
slopweb
```

Open:

```text
http://localhost:8787
```

Slopweb starts on `localhost` by default. If port `8787` is busy, it picks the next open port and prints the URL.
Running `slopweb` in a terminal opens an arrow-key launchpad where you can pick a detected local model, Codex OAuth, or a manual local endpoint. `🟢` means the model endpoint is already running; `🔴` means the model is installed and Slopweb can try to start it.
Press `Ctrl+C` in the terminal to stop the running server.

List detected local models:

```powershell
slopweb models
```

Use a local model directly:

```powershell
slopweb --base-url http://localhost:11434/v1 --model llama3.2
```

<details>
<summary>Try without installing</summary>

```powershell
npx slopweb
```

```powershell
pnpm dlx slopweb
```

</details>

<details>
<summary>Codex login</summary>

Slopweb uses local models through Vercel AI SDK. Codex CLI remains available for OAuth-based use.

Connect Codex once:

```powershell
slopweb login
```

Check status:

```powershell
slopweb status
```

Sign out:

```powershell
slopweb logout
```

Run through Codex:

```powershell
slopweb --codex
```

</details>

<details>
<summary>CLI options</summary>

```powershell
slopweb
slopweb open
slopweb --port 9000
slopweb -p 9000 -o
slopweb models
slopweb --local --model llama3.2
slopweb --base-url http://localhost:11434/v1 --model llama3.2
slopweb --codex
slopweb --no-picker
slopweb --strict-port
slopweb --lan
slopweb health
slopweb doctor
```

`--lan` exposes the local server on your network. Keep the default for normal local use.

</details>

<details>
<summary>Terminal slash commands</summary>

Type these in the terminal launchpad:

```text
/help
/model
/models
/status
/login
/codex
/manual
/quit
```

</details>

<details>
<summary>Model providers</summary>

Vercel AI SDK is included for local OpenAI-compatible servers. Slopweb does not use OpenAI API keys.

```powershell
slopweb models
```

```powershell
$env:SLOPWEB_BASE_URL="http://localhost:11434/v1"
$env:SLOPWEB_MODEL="llama3.2"
slopweb
```

Auto-detection checks running Ollama, LM Studio, llama.cpp/llamafile, vLLM, SGLang, Jan, text-generation-webui, KoboldCpp, LocalAI, LiteLLM, TabbyAPI, Aphrodite, Xinference, Open WebUI, and AnythingLLM endpoints. It also scans installed Ollama manifests, LM Studio, Jan, GPT4All, Msty, Hugging Face cache, and local GGUF model folders. Custom local providers can be added in `%USERPROFILE%\.slopweb\models.json`.
Set `SLOPWEB_BASE_URLS` to a comma-separated list when you run multiple custom local OpenAI-compatible servers.

</details>

<details>
<summary>Run from source</summary>

```powershell
pnpm install
pnpm start
```

Run checks:

```powershell
pnpm run check
```

</details>

<details>
<summary>License</summary>

MIT

</details>
