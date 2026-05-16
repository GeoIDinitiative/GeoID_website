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

const CACHE_VERSION = 'v130';
const TILE_CACHE  = `geoid-ctx-tiles-${CACHE_VERSION}`;
const ASSET_CACHE = `geoid-assets-${CACHE_VERSION}`;

// Default layers loaded on every first render — pre-cached at install time.
const DEFAULT_ASSETS = [
  // GeoID Earth (myGeoID viewer)
  '/GeoID_Earth/assets/earth_color.jpg',
  '/GeoID_Earth/assets/earth_elevation.png',
  '/GeoID_Earth/assets/earth_geology_sim3292.png',
  '/GeoID_Earth/assets/earth_seismic_events.json',
  '/GeoID_Earth/assets/earth_geology_features.json',

  // Mars
  '/planet_explorer/mars/viewer/assets/mars_color.jpg',
  '/planet_explorer/mars/viewer/assets/mars_elevation_upscaled.png',
  '/planet_explorer/mars/viewer/assets/mars_geology_sim3292.png',
  '/planet_explorer/mars/viewer/assets/mars_insight_seismic_events.json',
  '/planet_explorer/mars/viewer/assets/mars_geology_features.json',

  // Venus
  '/planet_explorer/venus/assets/venus_color.jpg',
  '/planet_explorer/venus/assets/venus_elevation.png',
  '/planet_explorer/venus/assets/venus_geology_sim3292.png',
  '/planet_explorer/venus/assets/venus_insight_seismic_events.json',
  '/planet_explorer/venus/assets/venus_geology_features.json',

  // Mercury
  '/planet_explorer/mercury/assets/mercury_color.jpg',
  '/planet_explorer/mercury/assets/mercury_elevation.png',
  '/planet_explorer/mercury/assets/mercury_geology_sim3292.png',
  '/planet_explorer/mercury/assets/mercury_insight_seismic_events.json',
  '/planet_explorer/mercury/assets/mercury_geology_features.json',

  // Jupiter
  '/planet_explorer/jupiter/viewer/assets/jupiter_color.jpg',
  '/planet_explorer/jupiter/viewer/assets/jupiter_elevation.png',
  '/planet_explorer/jupiter/viewer/assets/jupiter_geology_sim3292.png',
  '/planet_explorer/jupiter/viewer/assets/jupiter_insight_seismic_events.json',
  '/planet_explorer/jupiter/viewer/assets/jupiter_geology_features.json',

  // Saturn
  '/planet_explorer/saturn/viewer/assets/saturn_body_color.jpg',
  '/planet_explorer/saturn/viewer/assets/saturn_elevation.png',
  '/planet_explorer/saturn/viewer/assets/saturn_geology_sim3292.png',
  '/planet_explorer/saturn/viewer/assets/saturn_insight_seismic_events.json',
  '/planet_explorer/saturn/viewer/assets/saturn_geology_features.json',

  // Uranus
  '/planet_explorer/uranus/viewer/assets/uranus_body_color.jpg',
  '/planet_explorer/uranus/viewer/assets/uranus_elevation.png',
  '/planet_explorer/uranus/viewer/assets/uranus_geology_sim3292.png',
  '/planet_explorer/uranus/viewer/assets/uranus_insight_seismic_events.json',
  '/planet_explorer/uranus/viewer/assets/uranus_geology_features.json',

  // Neptune
  '/planet_explorer/neptune/viewer/assets/neptune_body_color.jpg',
  '/planet_explorer/neptune/viewer/assets/neptune_elevation.png',
  '/planet_explorer/neptune/viewer/assets/neptune_geology_sim3292.png',
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

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  // Only handle GET requests.
  if (request.method !== 'GET') return;

  // CTX tile service (ArcGIS) — cache-first: tiles are immutable once fetched.
  if (url.includes('MapServer/tile/') || url.includes('arcgis.com')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
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
