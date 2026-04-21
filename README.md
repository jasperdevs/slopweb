<p align="center">
  <img src="./assets/logo.png" alt="Genweb logo" width="220" />
</p>

<h1 align="center">Genweb</h1>

<p align="center">A new web where AI generates every page.</p>

## Install

```powershell
npm install -g @jasperdevs/genweb
genweb
```

Open:

```text
http://localhost:8787
```

Genweb starts on `localhost` by default. If port `8787` is busy, it picks the next open port and prints the URL.

<details>
<summary>Try without installing</summary>

```powershell
npx @jasperdevs/genweb
```

</details>

<details>
<summary>Codex login</summary>

Connect Codex once:

```powershell
genweb login
```

Check status:

```powershell
genweb status
```

Sign out:

```powershell
genweb logout
```

</details>

<details>
<summary>CLI options</summary>

```powershell
genweb
genweb --port 9000
genweb --open
genweb --strict-port
genweb --mock
genweb --lan
genweb doctor
```

`--lan` exposes the local server on your network. Keep the default for normal local use.

</details>

<details>
<summary>AI SDK mode</summary>

Use direct model streaming with an API key:

```powershell
$env:OPENAI_API_KEY="your_key_here"
$env:AI_PROVIDER="ai-sdk"
genweb
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
