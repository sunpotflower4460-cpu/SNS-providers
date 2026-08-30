import { readFile, stat } from 'node:fs/promises';

const manifestPath = new URL('../public/manifest.webmanifest', import.meta.url);
const indexPath = new URL('../index.html', import.meta.url);
const swPath = new URL('../public/sw.js', import.meta.url);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const indexHtml = await readFile(indexPath, 'utf8');
const serviceWorker = await readFile(swPath, 'utf8');

for (const [key, expected] of Object.entries({ id: './', start_url: './', scope: './', display: 'standalone' })) {
  if (manifest[key] !== expected) throw new Error(`PWA manifest ${key} must be ${expected}`);
}

const requiredIcons = [
  { src: './icon-192.png', size: 192, type: 'image/png' },
  { src: './icon-512.png', size: 512, type: 'image/png' },
  { src: './icon-1024.png', size: 1024, type: 'image/png' },
];

for (const required of requiredIcons) {
  const entry = manifest.icons?.find((icon) => icon.src === required.src);
  if (!entry) throw new Error(`PWA manifest icon missing: ${required.src}`);
  if (entry.type !== required.type || entry.sizes !== `${required.size}x${required.size}`) {
    throw new Error(`PWA manifest icon metadata is invalid: ${required.src}`);
  }
  await assertTruecolorPng(new URL(`../public/${required.src.replace('./', '')}`, import.meta.url), required.size);
}

const svgEntry = manifest.icons?.find((icon) => icon.src === './icon.svg');
if (!svgEntry || svgEntry.type !== 'image/svg+xml') throw new Error('SVG PWA fallback icon is missing.');
await assertNonEmpty(new URL('../public/icon.svg', import.meta.url));
await assertTruecolorPng(new URL('../public/icon-180.png', import.meta.url), 180);

const indexRequirements = [
  '%BASE_URL%manifest.webmanifest',
  '%BASE_URL%icon-180.png',
  'apple-mobile-web-app-capable',
  'apple-mobile-web-app-status-bar-style',
  'viewport-fit=cover',
];
for (const expected of indexRequirements) {
  if (!indexHtml.includes(expected)) throw new Error(`index.html lost PWA metadata: ${expected}`);
}

for (const icon of ['icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-1024.png']) {
  if (!serviceWorker.includes(icon)) throw new Error(`Service Worker CORE cache missing ${icon}`);
}

if (!serviceWorker.includes('isApiLikeRequest(event.request, requestUrl)')
  || !serviceWorker.includes("relativePath.startsWith('api/')")
  || !serviceWorker.includes("accept.toLowerCase().includes('application/json')")
  || !serviceWorker.includes('responseForbidsStorage(response)')
  || !serviceWorker.includes('no-store|private')) {
  throw new Error('Service Worker can cache personal API/JSON or Cache-Control: no-store responses.');
}

if (!serviceWorker.includes("const CACHE_PREFIX = 'social-mission-'")
  || !serviceWorker.includes('key.startsWith(CACHE_PREFIX) && key !== CACHE')) {
  throw new Error('Service Worker cache cleanup can delete Cache Storage owned by another app on the same origin.');
}

console.log('PWA assets OK: manifest identity, iOS metadata, icon dimensions, offline shell, private-response no-store and app-scoped cache eviction are consistent.');

async function assertNonEmpty(url) {
  const info = await stat(url);
  if (!info.isFile() || info.size <= 0) throw new Error(`Missing or empty file: ${url.pathname}`);
}

async function assertTruecolorPng(url, expected) {
  const buffer = await readFile(url);
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.length < 26 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Invalid PNG file: ${url.pathname}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  if (width !== expected || height !== expected) {
    throw new Error(`Unexpected PNG dimensions for ${url.pathname}: ${width}x${height}, expected ${expected}x${expected}`);
  }
  if (bitDepth !== 8 || colorType !== 2) {
    throw new Error(`PWA icon ${url.pathname} must be 8-bit RGB (not palette/low-bit). bitDepth=${bitDepth} colorType=${colorType}`);
  }
}
