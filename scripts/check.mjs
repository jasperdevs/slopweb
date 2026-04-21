#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['bin', 'app', 'scripts'];
const skipDirs = new Set(['.git', 'node_modules', '.omx']);
const files = [];

async function walk(target) {
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    const fullPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) await walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
}

for (const target of roots) {
  await walk(path.resolve(root, target));
}

files.sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.error('No JavaScript files found to check.');
  process.exit(1);
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Checked ${files.length} JavaScript files.`);
