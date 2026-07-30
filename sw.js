// GeoID Initiative — site-wide service worker
// Bump STATIC_CACHE version string whenever shared.css, nav.js, or
// key assets change significantly — this forces all clients to discard
// stale cached copies on their next visit.

const STATIC_CACHE = 'geoid-site-v2';

// Pre-fetched at install time so they are cache-warm on first navigation
const PRECACHE = [
  '/styles/shared.css',
  '/styles/nav.js',
  '/assets/GeoID_logo_icon.png',
  '/assets/explorer_logo.png',
  '/assets/mygeoid_logo.png',
  '/earth_explorer/assets/logo.png',
];

// ── Install: pre-warm cache ───────────────────────────────────────────────────
self.addEventListener('install', evt => {
  self.skipWaiting();
  evt.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(e => console.warn('[site-sw] precache miss:', url, e))
        )
      )
    )
  );
});

// ── Activate: delete old site caches, leave viewer caches untouched ──────────
self.addEventListener('activate', evt => {
  evt.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        // Only delete old versions of THIS SW's cache family.
        // Viewer caches (etna-*, geoid-ctx-*, geoid-assets-*) are untouched.
        .filter(k => k.startsWith('geoid-site-') && k !== STATIC_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', evt => {
  const { request } = evt;
  const url = new URL(request.url);

  // Google Fonts — cache-first (URLs are content-addressed / versioned by Google)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evt.respondWith((async () => {
      const cache  = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const resp = await fetch(request);
      if (resp.ok) cache.put(request, resp.clone());
      return resp;
    })());
    return;
  }

  // Skip all other cross-origin requests (Supabase, Stripe, arcgis, etc.)
  if (url.origin !== self.location.origin) return;

  // HTML navigation — network-first so page edits always reach the user.
  // Falls back to cache only when offline.
  if (request.mode === 'navigate') {
    evt.respondWith(
      fetch(request)
        .then(resp => {
          if (resp.ok) caches.open(STATIC_CACHE).then(c => c.put(request, resp.clone()));
          return resp;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets — cache-first, populate on miss.
  // Covers shared CSS/JS, all /assets/ images, fonts, icons.
  const p = url.pathname;
  const isStatic = (
    p.startsWith('/styles/')   ||
    p.startsWith('/assets/')   ||
    p.startsWith('/scripts/')  ||
    p.startsWith('/earth_explorer/assets/') ||
    /\.(css|js|png|jpg|jpeg|webp|svg|woff2|woff|ico)$/.test(p)
  );

  if (isStatic) {
    evt.respondWith((async () => {
      const cache  = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const resp = await fetch(request);
      if (resp.ok) cache.put(request, resp.clone());
      return resp;
    })());
  }
});
