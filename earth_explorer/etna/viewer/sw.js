// Service worker — cache-first strategy for static assets + ESRI satellite tiles.
// HTML navigation requests are network-first so index.html changes are always picked up.
// Update STATIC_CACHE version string whenever viewer JS/CSS/STL changes significantly.

const STATIC_CACHE = 'etna-static-v387';
const TILES_CACHE  = 'etna-tiles-v1';

const PRECACHE_URLS = [
  // index.html intentionally omitted — served network-first so updates propagate immediately
  './etna-viewer.js',
  './etna-label-layer.js',
  './styles.css',
  './music.js',
  './vendor/three.module.js',
  './vendor/OrbitControls.js',
  './vendor/STLLoader.js',
  '../ETNA_3_chambers/etna.stl',
  './etna-faults.json',
  './etna-seismicity.json',
  './etna-geology-ingv.json',
  './etna-regional-geology.json',
  './etna-tectonic-faults.json',
];

self.addEventListener('install', evt => {
  self.skipWaiting();
  evt.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      // Use allSettled so one slow/failing asset doesn't block the whole install
      Promise.allSettled(PRECACHE_URLS.map(url =>
        cache.add(url).catch(e => console.warn('SW precache miss:', url, e))
      ))
    )
  );
});

self.addEventListener('activate', evt => {
  evt.waitUntil((async () => {
    // Remove caches from previous versions
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== TILES_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', evt => {
  const url = new URL(evt.request.url);

  // ESRI World Imagery satellite tiles — cache-first, store on first fetch
  if (url.hostname.includes('arcgisonline.com')) {
    evt.respondWith((async () => {
      const cache  = await caches.open(TILES_CACHE);
      const cached = await cache.match(evt.request);
      if (cached) return cached;
      const resp = await fetch(evt.request);
      if (resp.ok) cache.put(evt.request, resp.clone());
      return resp;
    })());
    return;
  }

  // HTML navigation requests — network-first so index.html is always fresh
  if (evt.request.mode === 'navigate') {
    evt.respondWith(
      fetch(evt.request).then(resp => {
        if (resp.ok) {
          caches.open(STATIC_CACHE).then(c => c.put(evt.request, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match(evt.request))
    );
    return;
  }

  // Same-origin local assets — cache-first, populate cache on miss
  if (url.origin === self.location.origin) {
    evt.respondWith((async () => {
      const cached = await caches.match(evt.request);
      if (cached) return cached;
      const resp = await fetch(evt.request);
      if (resp.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(evt.request, resp.clone());
      }
      return resp;
    })());
  }
});
