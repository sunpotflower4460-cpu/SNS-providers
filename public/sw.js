const CACHE = 'social-mission-v3';
const SCOPE_URL = new URL('./', self.registration.scope);
const ROOT = SCOPE_URL.pathname;
const CORE = [ROOT, `${ROOT}manifest.webmanifest`, `${ROOT}icon.svg`];

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

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  event.respondWith(networkFirstAsset(event.request));
});

async function precacheAppShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);

  try {
    const rootResponse = await fetch(ROOT, { cache: 'reload' });
    if (!rootResponse.ok) return;
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
      if (!/\.(?:js|css|svg|png|webp|ico|webmanifest)$/i.test(url.pathname)) continue;
      urls.add(url.href);
    } catch {
      // Ignore malformed/non-URL attributes.
    }
  }
  return [...urls];
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(ROOT, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(ROOT)) || Response.error();
  }
}

async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}
