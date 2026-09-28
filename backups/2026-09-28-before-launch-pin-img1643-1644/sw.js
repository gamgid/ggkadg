// Small scope-limited offline fallback. Full offline readiness is not guaranteed.
const ROOT = new URL('./', self.location.href);
const PREFIX = `oblik-demo:${ROOT.pathname}:`;
const CACHE = `${PREFIX}pages-v1`;
const FALLBACK = new URL('offline.html', ROOT).href;
const STATIC = new Set(['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'offline.html'].map(p => new URL(p, ROOT).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...STATIC])));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  // Never return an HTML offline page for JS, CSS, or React navigation payloads.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(FALLBACK)) || Response.error()));
  } else if (STATIC.has(url.href)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
  }
});
