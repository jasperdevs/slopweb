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

Open the printed local URL. Press `Ctrl+C` to stop the server.

## Local Models

Slopweb works with local OpenAI-compatible model servers and detects common local runtimes.

```powershell
slopweb models
```

```powershell
slopweb --base-url http://localhost:11434/v1 --model llama3.2
```

## Codex OAuth

```powershell
slopweb login
slopweb --codex
```

## CLI

```powershell
slopweb
slopweb open
slopweb --port 9000
slopweb --strict-port
slopweb --lan
slopweb status
slopweb doctor
```

## From Source

```powershell
pnpm install
pnpm start
```

```powershell
pnpm run check
```

## License

MIT
