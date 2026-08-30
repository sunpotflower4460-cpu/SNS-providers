import { readFile, stat } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const indexHtml = await readFile(new URL('index.html', dist), 'utf8');
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', dist), 'utf8'));
const serviceWorker = await readFile(new URL('sw.js', dist), 'utf8');
const base = normalizeBase(process.env.VITE_BASE_PATH || '/');
const apiOrigin = safeOrigin(process.env.VITE_API_BASE_URL);

if (indexHtml.includes('__CSP_CONNECT_SRC__')) throw new Error('Production CSP placeholder was not replaced.');
const expectedConnect = `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''};`;
if (!indexHtml.includes(expectedConnect)) {
  throw new Error(`Built CSP does not contain expected directive: ${expectedConnect}`);
}

for (const expected of [
  `${base}manifest.webmanifest`,
  `${base}icon-180.png`,
]) {
  if (!indexHtml.includes(expected)) throw new Error(`Built index is missing base-path binding: ${expected}`);
}

for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-1024.png']) {
  await assertNonEmpty(new URL(file, dist));
}

if (manifest.id !== './' || manifest.start_url !== './' || manifest.scope !== './' || manifest.display !== 'standalone') {
  throw new Error('Built manifest lost portable relative identity/scope settings.');
}

for (const icon of ['icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-1024.png']) {
  if (!serviceWorker.includes(icon)) throw new Error(`Built Service Worker CORE cache missing ${icon}`);
}

const assetReferences = [...indexHtml.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map((match) => match[1]);
if (!assetReferences.length) throw new Error('Built index contains no JS/CSS asset references.');
for (const reference of assetReferences) {
  if (!reference.startsWith(base)) throw new Error(`Built asset escaped configured base path: ${reference}`);
  const relative = reference.slice(base.length);
  if (!relative || relative.includes('..')) throw new Error(`Invalid built asset reference: ${reference}`);
  await assertNonEmpty(new URL(relative, dist));
}

console.log(`Built PWA OK: base=${base}, CSP=${expectedConnect}, assets=${assetReferences.length}, portable manifest and offline shell present.`);

function normalizeBase(value) {
  const trimmed = value.trim() || '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

function safeOrigin(value) {
  if (!value?.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
    return url.origin;
  } catch {
    throw new Error('VITE_API_BASE_URL must be a valid HTTP(S) URL when provided.');
  }
}

async function assertNonEmpty(url) {
  const info = await stat(url);
  if (!info.isFile() || info.size <= 0) throw new Error(`Missing or empty built file: ${url.pathname}`);
}
