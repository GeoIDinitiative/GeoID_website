// GeoID Initiative — site-wide service worker
// Bump STATIC_CACHE version string whenever shared.css, nav.js, or
// key assets change significantly — this forces all clients to discard
// stale cached copies on their next visit.

const STATIC_CACHE = 'geoid-site-v30';  // v30: warp bar pulses

// Pre-fetched at install time so they are cache-warm on first navigation
const PRECACHE = [
  '/styles/shared.css',
  '/styles/v2-site.css',
  '/styles/site-nav.css',
  '/styles/skins/synthwave.css',
  '/styles/viewer-skin.css',
  '/styles/viewer-skin-ember.css',

  '/styles/nav.js',
  '/scripts/v2-site.js',
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
      // cache:'reload' bypasses the browser's HTTP cache. The host sends
      // cache-control: max-age=600, so a plain fetch() here was still served
      // from that cache for ten minutes after a deploy — the service worker
      // was network-first but the network never got asked. This is why fixes
      // kept appearing "not deployed" until the page was hard-reloaded.
      fetch(request, { cache: 'reload' })
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

  // Code is NETWORK-FIRST, media stays cache-first. Cache-first JS/CSS kept
  // pairing a fresh entry script with a stale cached module or stylesheet —
  // a combination that never existed in the repo — and that broke three
  // viewers in the wild (Venus black screen; Uranus/Saturn/Neptune failing
  // to boot). Freshness beats offline for code; images and fonts are
  // immutable-in-practice and keep the fast path.
  const isCode = /\.(js|css)$/.test(p);

  if (isStatic && isCode) {
    evt.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      try {
        // Same reasoning as navigations: skip the 600 s HTTP cache so a
        // freshly deployed script is actually fetched.
        const resp = await fetch(request, { cache: 'reload' });
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
      } catch (_e) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw _e;
      }
    })());
    return;
  }

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
