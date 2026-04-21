<p align="center">
  <img src="./assets/logo.png" alt="Slopweb logo" width="220" />
</p>

<h1 align="center">Slopweb</h1>

<p align="center">A new web where AI generates every page.</p>

![Slopweb app]()

![Slopweb CLI]()

## Install

```powershell
npm install -g slopweb
slopweb
```

Choose a detected local model or Codex in the terminal picker, then open the printed local URL. Press `Ctrl+C` to stop the server.

<details>
<summary>Local models</summary>

Slopweb works with local OpenAI-compatible model servers and detects common local runtimes.

```powershell
slopweb models
```

Use a specific endpoint when auto-detection is not enough:

```powershell
slopweb --base-url http://localhost:11434/v1 --model llama3.2
```

</details>

<details>
<summary>Codex OAuth</summary>

```powershell
slopweb login
slopweb --codex
```

</details>

<details>
<summary>CLI options</summary>

```powershell
slopweb
slopweb open
slopweb --port 9000
slopweb --strict-port
slopweb --lan
slopweb status
slopweb doctor
```

</details>

<details>
<summary>Run from source</summary>

```powershell
pnpm install
pnpm start
```

```powershell
pnpm run check
```

</details>

<details>
<summary>License</summary>

MIT

</details>
