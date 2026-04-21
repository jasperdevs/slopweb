<p align="center">
  <img src="./assets/logo.png" alt="Agentic Web logo" width="220" />
</p>

<h1 align="center">Agentic Web</h1>

<p align="center">A local AI browser where synthetic addresses generate static HTML pages.</p>

## Install

```powershell
npm install -g agenticweb
agenticweb
```

Open:

```text
http://localhost:8787
```

Agentic Web starts on `localhost` by default. If port `8787` is busy, it picks the next open port and prints the URL.

<details>
<summary>Try without installing</summary>

```powershell
npx agenticweb
```

</details>

<details>
<summary>Codex login</summary>

Connect Codex once:

```powershell
agenticweb login
```

Check status:

```powershell
agenticweb status
```

Sign out:

```powershell
agenticweb logout
```

</details>

<details>
<summary>CLI options</summary>

```powershell
agenticweb
agenticweb --port 9000
agenticweb --open
agenticweb --strict-port
agenticweb --mock
agenticweb --lan
agenticweb doctor
```

`--lan` exposes the local server on your network. Keep the default for normal local use.

</details>

<details>
<summary>AI SDK mode</summary>

Use direct model streaming with an API key:

```powershell
$env:OPENAI_API_KEY="your_key_here"
$env:AI_PROVIDER="ai-sdk"
agenticweb
```

</details>

<details>
<summary>Run from source</summary>

```powershell
npm install
npm start
```

Run checks:

```powershell
npm run check
```

</details>

<details>
<summary>License</summary>

MIT

</details>
