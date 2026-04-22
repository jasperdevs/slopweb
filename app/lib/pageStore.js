import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { slugWords } from './utils.js';

let generatedPagesDirReady = null;

function ensureGeneratedPagesDir() {
  generatedPagesDirReady ||= mkdir(config.generatedPagesDir, { recursive: true });
  return generatedPagesDirReady;
}

function pageFileSlug(address) {
  return slugWords(address, 'home')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'home';
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}z$/i, 'z').replace(/[:.]/g, '-');
}

function displayPathFor(fileName) {
  return `slopweb/pages/${fileName}`;
}

function urlFor(fileName) {
  return `/slopweb/pages/${fileName}`;
}

function safeFileName(value) {
  const name = path.basename(String(value || ''));
  return /^[a-z0-9][a-z0-9._-]*\.html$/i.test(name) ? name : '';
}

export async function saveGeneratedPage(page, address) {
  await ensureGeneratedPagesDir();
  const fileName = `${timestampSlug()}-${pageFileSlug(address)}.html`;
  const filePath = path.join(config.generatedPagesDir, fileName);
  await writeFile(filePath, page.html, 'utf8');
  return {
    ...page,
    savedFilePath: filePath,
    savedUrl: urlFor(fileName),
    savedDisplayPath: displayPathFor(fileName)
  };
}

export async function listSavedPages(limit = 80) {
  await ensureGeneratedPagesDir();
  const entries = await readdir(config.generatedPagesDir, { withFileTypes: true }).catch(() => []);
  const pages = await Promise.all(entries
    .filter(entry => entry.isFile() && /\.html$/i.test(entry.name))
    .map(async entry => {
      const filePath = path.join(config.generatedPagesDir, entry.name);
      const info = await stat(filePath).catch(() => null);
      return info ? {
        fileName: entry.name,
        savedUrl: urlFor(entry.name),
        savedDisplayPath: displayPathFor(entry.name),
        size: info.size,
        modifiedAt: info.mtime.toISOString()
      } : null;
    }));
  return pages
    .filter(Boolean)
    .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 80, 300)));
}

export async function readSavedPage(fileName) {
  const safeName = safeFileName(fileName);
  if (!safeName) return null;
  const filePath = path.join(config.generatedPagesDir, safeName);
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
}

export async function deleteSavedPage(fileName) {
  const safeName = safeFileName(fileName);
  if (!safeName) return false;
  await rm(path.join(config.generatedPagesDir, safeName), { force: true });
  return true;
}
