import http from 'node:http';
import { config, shouldTryAiSdk } from './lib/config.js';
import { sendJson, sendText, readJsonBody, serveStatic } from './lib/http.js';
import { generatePage, handlePageStream } from './lib/generator.js';
import { codexStatus } from './lib/codexLauncher.js';

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/') && !isLocalApiRequest(req)) {
      sendJson(res, 403, { error: 'Local API access is restricted to localhost. Set SLOPWEB_ALLOW_LAN=1 to opt in to LAN access.' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, version: config.version, model: config.codexModel, aiSdkModel: config.aiSdkModel, provider: config.aiProvider, mock: config.codexMock });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      sendJson(res, 200, await authStatus());
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
  console.log(`Slopweb running at http://${displayHost}:${config.port}`);
  console.log(`Model: ${config.codexModel}`);
  console.log(`Provider: ${config.aiProvider}`);
  console.log(`Host: ${config.host}${config.allowLan ? ' (LAN enabled)' : ' (local only)'}`);
  console.log('Live reveal: elements first, raw HTML side rail');
});
