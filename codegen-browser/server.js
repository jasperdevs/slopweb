import http from 'node:http';
import { config, shouldTryAiSdk } from './lib/config.js';
import { sendJson, sendText, readJsonBody, serveStatic } from './lib/http.js';
import { generatePage, handlePageStream } from './lib/generator.js';
import { codexStatus, makeCodexSpawnSpecs, spawnWithSpec, isLauncherFailureResult, summarizeAttempts } from './lib/codexLauncher.js';
import { stripAnsi } from './lib/utils.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

async function authStatus() {
  if (shouldTryAiSdk()) {
    if (!process.env.OPENAI_API_KEY) {
      return { connected: false, mock: false, provider: 'ai-sdk', message: 'AI SDK mode needs OPENAI_API_KEY, or set AI_PROVIDER=codex to use Codex OAuth.' };
    }
    return {
      connected: true,
      mock: false,
      provider: 'ai-sdk',
      binary: 'Vercel AI SDK',
      foundBinary: true,
      message: `Using Vercel AI SDK with ${config.aiSdkModel}. Set AI_PROVIDER=codex to force local Codex OAuth.`,
      code: 0
    };
  }
  return codexStatus();
}

function hostName(value) {
  try {
    return new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return String(value || '').replace(/^\[|\]$/g, '').split(':')[0].toLowerCase();
  }
}

function originHostName(value) {
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
}

function isLocalApiRequest(req) {
  if (config.allowLan) return true;
  const host = hostName(req.headers.host || '');
  const origin = req.headers.origin ? originHostName(req.headers.origin) : '';
  return LOCAL_HOSTS.has(host) && (!origin || LOCAL_HOSTS.has(origin));
}

async function handleLoginSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });

  const send = (type, data) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const args = ['login', '--device-auth'];
  const specs = makeCodexSpawnSpecs(config.codexBin, args);
  const attempts = [];
  let activeChild = null;
  let closedByClient = false;

  req.on('close', () => {
    closedByClient = true;
    if (activeChild && !activeChild.killed) activeChild.kill('SIGTERM');
  });

  const startAttempt = index => {
    if (closedByClient) return;
    if (index >= specs.length) {
      send('error', { text: `Could not start Codex OAuth after ${attempts.length} attempts.\n${summarizeAttempts(attempts)}` });
      res.end();
      return;
    }

    const spec = specs[index];
    send('log', { text: `Trying ${spec.label} login --device-auth\n` });

    let stdout = '';
    let stderr = '';
    let failedToSpawn = false;
    const child = spawnWithSpec(spec, { stdio: ['ignore', 'pipe', 'pipe'] });
    activeChild = child;

    child.stdout.on('data', chunk => {
      const text = stripAnsi(chunk.toString('utf8'));
      stdout += text;
      send('log', { text });
    });
    child.stderr.on('data', chunk => {
      const text = stripAnsi(chunk.toString('utf8'));
      stderr += text;
      send('log', { text });
    });
    child.on('error', error => {
      failedToSpawn = true;
      attempts.push({ label: spec.label, error: error.message, errorCode: error.code });
      send('log', { text: `Launcher failed: ${error.message}\n` });
      startAttempt(index + 1);
    });
    child.on('close', code => {
      if (closedByClient || failedToSpawn) return;
      const result = { code, stdout, stderr };
      if (isLauncherFailureResult(result)) {
        attempts.push({ label: spec.label, code, stdout, stderr });
        send('log', { text: `Launcher attempt exited ${code}; trying the next method.\n` });
        startAttempt(index + 1);
        return;
      }
      send('done', { code, ok: code === 0, command: spec.label });
      res.end();
    });
  };

  startAttempt(0);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/') && !isLocalApiRequest(req)) {
      sendJson(res, 403, { error: 'Local API access is restricted to localhost. Set CODEGEN_ALLOW_LAN=1 to opt in to LAN access.' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, version: '1.3.0', model: config.codexModel, aiSdkModel: config.aiSdkModel, provider: config.aiProvider, mock: config.codexMock });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      sendJson(res, 200, await authStatus());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/login') {
      await handleLoginSse(req, res);
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/api/page-stream' || url.pathname === '/api/page/stream')) {
      await handlePageStream(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/page') {
      const body = await readJsonBody(req);
      const page = await generatePage(body);
      sendJson(res, 200, page);
      return;
    }

    if (req.method !== 'GET') {
      sendText(res, 405, 'Method not allowed');
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: error.message || String(error) });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  const displayHost = config.host === '0.0.0.0' || config.host === '127.0.0.1' ? 'localhost' : config.host;
  console.log(`Codegen Browser running at http://${displayHost}:${config.port}`);
  console.log(`Model: ${config.codexModel}`);
  console.log(`Provider: ${config.aiProvider}`);
  console.log(`Host: ${config.host}${config.allowLan ? ' (LAN enabled)' : ' (local only)'}`);
  console.log('Live reveal: elements first, raw HTML side rail');
});
