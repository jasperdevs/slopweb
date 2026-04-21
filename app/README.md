# Slopweb

A local shell where AI generates each page.

## Start

```powershell
npm install -g slopweb
slopweb
```

Choose a detected local model or Codex in the terminal picker. Press `Ctrl+C` to stop the server.

<details>
<summary>Local models</summary>

```powershell
slopweb models
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
<summary>Source</summary>

```powershell
pnpm install
pnpm start
pnpm run check
```

</details>
