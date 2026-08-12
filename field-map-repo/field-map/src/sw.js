/* Hobart Road field map — offline shell.
   GitHub Pages serves HTML with Cache-Control: max-age=600, so without this
   the app disappears ten minutes after the last load. Cache-first for the
   shell; map tiles are handled separately by the app's own IndexedDB store. */
const CACHE = 'fieldmap-v1';
const SHELL = ['./', './field-map.html', './field-map-locked.html', './index.html'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.allSettled(SHELL.map(u => c.add(u)))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;   /* tiles: app handles caching */

  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) {
      /* refresh in the background, but never block on it */
      fetch(e.request).then(r => {
        if (r && r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
      }).catch(() => {});
      return hit;
    }
    try {
      const r = await fetch(e.request);
      if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    } catch (err) {
      /* resolving to undefined would surface as ERR_FAILED */
      return new Response('Offline and not cached', { status: 504, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
