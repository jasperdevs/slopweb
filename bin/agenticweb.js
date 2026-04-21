#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

function takeFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  const value = args[index + 1] || '';
  args.splice(index, 2);
  return value;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Agentic Web

Usage:
  agenticweb [--port 8787] [--host 127.0.0.1] [--lan] [--mock]

Examples:
  agenticweb
  agenticweb --port 9000
  agenticweb --mock

The server is local-only by default and opens at http://localhost:8787.`);
  process.exit(0);
}

const port = takeFlag('--port');
const host = takeFlag('--host');

if (port) process.env.PORT = port;
if (host) process.env.HOST = host;
if (args.includes('--lan')) process.env.CODEGEN_ALLOW_LAN = '1';
if (args.includes('--mock')) process.env.CODEX_MOCK = '1';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(resolve(rootDir, 'codegen-browser'));
await import('../codegen-browser/server.js');
