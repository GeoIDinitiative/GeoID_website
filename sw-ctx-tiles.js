// GeoID Explorer — Service Worker (root scope)
// Covers all viewers: GeoID Earth, Mars, Venus, Mercury, Earth (PE),
// Jupiter, Saturn, Uranus, Neptune.
//
// Handles two jobs:
//   1. Pre-cache default viewer assets (texture, elevation, geology) so
//      repeat launches are instant instead of waiting on network.
//   2. Runtime-cache CTX tile images so previously-seen tiles serve at
//      <5 ms instead of ~300 ms on revisit.
//
// Bump CACHE_VERSION to force all clients to discard old caches on deploy.

const CACHE_VERSION = 'v134';
const TILE_CACHE  = `geoid-ctx-tiles-${CACHE_VERSION}`;
const ASSET_CACHE = `geoid-assets-${CACHE_VERSION}`;

// Default layers loaded on every first render — pre-cached at install time.
const DEFAULT_ASSETS = [
  // GeoID Earth (GeoHUB viewer)
  'https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_color.jpg?v=5e18afce2860',
  'https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_elevation.png?v=6f89e540b82e',
  'https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_geology_sim3292.png?v=0ceabcf21789',
  '/GeoID_Earth/assets/earth_seismic_events.json',
  '/GeoID_Earth/assets/earth_geology_features.json',

  // Mars
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_color.jpg?v=aff5dbff30d7',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_elevation_upscaled.png?v=36d60c8f04d3',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_geology_sim3292.png?v=c6b825f8e610',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_insight_seismic_events.json?v=072e5c50bc29',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_geology_features.json?v=12bcfcabc5b8',

  // Venus
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-venus/venus_color.jpg?v=bbb8cd8e9a5f',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-venus/venus_elevation.png?v=aa27ba044619',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-venus/venus_geology_sim3292.png?v=bd00fdeb3248',
  '/planet_explorer/venus/viewer/assets/venus_insight_seismic_events.json',
  '/planet_explorer/venus/viewer/assets/venus_geology_features.json',

  // Mercury
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_color.jpg?v=f0148673d25a',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_elevation.png?v=1032ec850126',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_geology_sim3292.png?v=68624230d2de',
  '/planet_explorer/mercury/viewer/assets/mercury_insight_seismic_events.json',
  '/planet_explorer/mercury/viewer/assets/mercury_geology_features.json',

  // Jupiter
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-jupiter/jupiter_color.jpg?v=6b835ddd8036',
  '/planet_explorer/jupiter/viewer/assets/jupiter_elevation.png',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-jupiter/jupiter_geology_sim3292.png?v=9f5ac25d643f',
  '/planet_explorer/jupiter/viewer/assets/jupiter_insight_seismic_events.json',
  '/planet_explorer/jupiter/viewer/assets/jupiter_geology_features.json',

  // Saturn
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-saturn/saturn_body_color.jpg?v=fe5cffc880ae',
  '/planet_explorer/saturn/viewer/assets/saturn_elevation.png',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-saturn/saturn_geology_sim3292.png?v=90ad8cc0e799',
  '/planet_explorer/saturn/viewer/assets/saturn_insight_seismic_events.json',
  '/planet_explorer/saturn/viewer/assets/saturn_geology_features.json',

  // Uranus
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-uranus/uranus_body_color.jpg?v=ab7b9dae8f1b',
  '/planet_explorer/uranus/viewer/assets/uranus_elevation.png',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-uranus/uranus_geology_sim3292.png?v=36c18ceb158b',
  '/planet_explorer/uranus/viewer/assets/uranus_insight_seismic_events.json',
  '/planet_explorer/uranus/viewer/assets/uranus_geology_features.json',

  // Neptune
  '/planet_explorer/neptune/viewer/assets/neptune_body_color.jpg',
  '/planet_explorer/neptune/viewer/assets/neptune_elevation.png',
  'https://data.geoidinitiative.com/assets/hotlink-ok/planet-neptune/neptune_geology_sim3292.png?v=b20b8e177743',
  '/planet_explorer/neptune/viewer/assets/neptune_insight_seismic_events.json',
  '/planet_explorer/neptune/viewer/assets/neptune_geology_features.json',
];

// Pre-cache default assets. Individual failures don't abort install.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(ASSET_CACHE)
      .then(cache => Promise.allSettled(DEFAULT_ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// Remove caches from previous versions and take control immediately.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => (k.startsWith('geoid-') && !k.endsWith(CACHE_VERSION)))
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// CTX services reachable through the same-origin /ctx-proxy/ route below.
const CTX_PROXY_SERVICES = {
  CTX:  'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer',
  CTX1: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer',
};

// A 1×1 transparent PNG, returned in place of a missing/broken tile.
const BLANK_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
), c => c.charCodeAt(0));

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  // Only handle GET requests.
  if (request.method !== 'GET') return;

  // ── /ctx-proxy/ — SAME-ORIGIN tile + metadata proxy ──────────────────────
  // The viewers build their preferred tile base as `${origin}/ctx-proxy/tile/
  // {service}` precisely so tiles are fetched same-origin: no CORS check applies
  // to the page at all. That matters because ArcGIS omits Access-Control-Allow-
  // Origin on ERROR responses, so going direct turns every 404/500 into an opaque
  // CORS failure the streamer cannot classify. Proxying here lets us translate a
  // failure into a real, readable response: a blank tile tagged with
  // X-CTX-Blank-Tile, which is exactly what the streamers already look for
  // (`?blankTile=true` → `X-CTX-Blank-Tile: 1`), so they blacklist that tile and
  // fall back to a coarser parent instead of stalling.
  if (url.includes('/ctx-proxy/')) {
    const u = new URL(url);
    const tileMatch = u.pathname.match(/\/ctx-proxy\/tile\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/);
    if (tileMatch) {
      const [, name, z, y, x] = tileMatch;
      const base = CTX_PROXY_SERVICES[name] || CTX_PROXY_SERVICES.CTX;
      const upstream = `${base}/tile/${z}/${y}/${x}`;
      const wantBlank = u.searchParams.get('blankTile') === 'true';
      event.respondWith((async () => {
        const cache = await caches.open(TILE_CACHE);
        const hit = await cache.match(upstream);
        if (hit) return hit;
        let status = 0;
        try {
          const res = await fetch(upstream);
          status = res.status;
          if (res.ok) {
            const body = await res.blob();
            const out = new Response(body, {
              status: 200,
              headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/png' },
            });
            cache.put(upstream, out.clone());
            return out;
          }
        } catch (_e) { /* cross-origin/network failure — fall through to blank */ }
        if (!wantBlank) {
          return new Response('', { status: status || 504, statusText: 'CTX tile unavailable' });
        }
        return new Response(BLANK_PNG, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'X-CTX-Blank-Tile': '1',
            'X-CTX-Upstream-Status': String(status || 0),
          },
        });
      })());
      return;
    }
    if (u.pathname.startsWith('/ctx-proxy/service')) {
      const base = CTX_PROXY_SERVICES[u.searchParams.get('name')] || CTX_PROXY_SERVICES.CTX;
      event.respondWith((async () => {
        try {
          const res = await fetch(`${base}?f=json`);
          return new Response(await res.text(), {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (_e) {
          return new Response('{}', { status: 502, headers: { 'Content-Type': 'application/json' } });
        }
      })());
      return;
    }
  }

  // CTX tile service (ArcGIS) — cache-first: tiles are immutable once fetched.
  if (url.includes('MapServer/tile/') || url.includes('arcgis.com')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        // ArcGIS omits Access-Control-Allow-Origin on ERROR responses (404 for a
        // missing tile, 500 for a region-dead level), so the CORS check fails and
        // fetch() REJECTS. Letting that rejection escape makes respondWith produce
        // "a network error response", which reaches the page as an opaque
        // TypeError — the tile streamer then can't see a status code and its
        // coarser-parent fallback chain never runs, so nothing renders at all.
        // Convert the failure into a real Response the page can inspect.
        // Direct (non-proxy) ESRI path. Whether the tile 404/500s or the CORS
        // check rejects it outright, hand the page a BLANK TILE tagged with
        // X-CTX-Blank-Tile instead of an error. The streamers check that header
        // unconditionally (not just on the proxy path), so a failure becomes a
        // clean "no imagery here" → blacklist + fall back to a coarser parent,
        // rather than an opaque TypeError that stalls the queue. A Response
        // synthesised here is delivered to the page directly, so no CORS check
        // applies to it.
        let upstreamStatus = 0;
        try {
          const response = await fetch(request);
          upstreamStatus = response.status;
          if (response.ok) {
            cache.put(request, response.clone());
            return response;
          }
        } catch (_e) { /* CORS/network rejection — fall through to blank tile */ }
        return new Response(BLANK_PNG, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'X-CTX-Blank-Tile': '1',
            'X-CTX-Upstream-Status': String(upstreamStatus),
          },
        });
      })
    );
    return;
  }

  // Local image assets — cache-first, populate on first fetch.
  if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url) && url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Local JSON data — stale-while-revalidate: serve cached instantly,
  // refresh in background so data stays current without blocking load.
  if (/\.json(\?|$)/i.test(url) && url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async cache => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => null);
        return cached || networkFetch;
      })
    );
  }
});
