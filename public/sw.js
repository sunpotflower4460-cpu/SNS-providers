const CACHE = 'social-mission-v5';
const SCOPE_URL = new URL('./', self.registration.scope);
const ROOT = SCOPE_URL.pathname;
const CORE = [
  ROOT,
  `${ROOT}manifest.webmanifest`,
  `${ROOT}icon.svg`,
  `${ROOT}icon-180.png`,
  `${ROOT}icon-192.png`,
  `${ROOT}icon-512.png`,
];
const STATIC_ASSET_PATTERN = /\.(?:js|css|svg|png|webp|ico|webmanifest)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  // Personal/provider endpoints must always stay network-only. Today the Worker may be
  // cross-origin, but a future same-origin route must not cause budget/OAuth/sync JSON to
  // enter Cache Storage despite the API's Cache-Control: no-store responses.
  if (isApiLikeRequest(event.request, requestUrl)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  // Do not turn the service worker into a generic HTTP cache. Only immutable-ish app
  // shell assets that are useful offline belong here.
  if (!STATIC_ASSET_PATTERN.test(requestUrl.pathname)) return;
  event.respondWith(networkFirstAsset(event.request));
});

async function precacheAppShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);

  try {
    const rootResponse = await fetch(ROOT, { cache: 'reload' });
    if (!rootResponse.ok || responseForbidsStorage(rootResponse)) return;
    await cache.put(ROOT, rootResponse.clone());
    const html = await rootResponse.text();
    const assetUrls = discoverSameOriginAssets(html);
    await Promise.allSettled(assetUrls.map((url) => cache.add(url)));
  } catch {
    // CORE is still cached. Dynamic asset caching can recover on the next online load.
  }
}

function discoverSameOriginAssets(html) {
  const urls = new Set();
  const attributePattern = /(?:src|href)=["']([^"']+)["']/g;
  for (const match of html.matchAll(attributePattern)) {
    try {
      const url = new URL(match[1], SCOPE_URL);
      if (url.origin !== self.location.origin) continue;
      if (!url.pathname.startsWith(ROOT)) continue;
      if (!STATIC_ASSET_PATTERN.test(url.pathname)) continue;
      urls.add(url.href);
    } catch {
      // Ignore malformed/non-URL attributes.
    }
  }
  return [...urls];
}

function isApiLikeRequest(request, url) {
  const relativePath = url.pathname.startsWith(ROOT) ? url.pathname.slice(ROOT.length) : url.pathname.replace(/^\//, '');
  if (relativePath === 'api' || relativePath.startsWith('api/')) return true;
  const accept = request.headers.get('accept') || '';
  return accept.toLowerCase().includes('application/json');
}

function responseForbidsStorage(response) {
  const cacheControl = response.headers.get('cache-control') || '';
  return /(?:^|,)\s*(?:no-store|private)\b/i.test(cacheControl);
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !responseForbidsStorage(response)) await cache.put(ROOT, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(ROOT)) || Response.error();
  }
}

async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !responseForbidsStorage(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}
