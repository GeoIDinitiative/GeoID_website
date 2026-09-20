// GeoID Initiative — THE site service worker (root scope).
//
// ONE WORKER AT ROOT, and that is the first thing this file is for. Until
// 2026-09-19 the site nav registered /sw.js and the Earth viewer registered
// /sw-ctx-tiles.js, both at scope "/". A registration with a different
// script URL replaces the worker, so every GeoHUB load swapped them — and
// Cache Storage is ORIGIN-WIDE while each worker's activate step deleted
// every "geoid-*" cache that was not its own version. The net effect was a
// cache wiped on every visit, which is why nothing ever loaded warm. The
// viewers register this file now; /sw-ctx-tiles.js only imports it.
//
// Rules:
//   * every family below is named here, and activate deletes ONLY old
//     versions of these families plus the legacy names listed — never a
//     cache it does not own (the page writes "geoid-mosaic-*" itself);
//   * a request that asks for a byte range is never cached (a COG read);
//   * only whole 200 responses are stored.

const SITE_VERSION = 'v60';   // v60: the GeoID wordmark, versioned so no cache holds the old one
const STATIC_CACHE = `geoid-site-${SITE_VERSION}`;
const DATA_CACHE = 'geoid-data-v1';        // data.geoidinitiative.com, fingerprinted (?v=)
const BASEMAP_CACHE = 'geoid-basemap-tiles-v1';  // Sentinel-2 cloudless / GIBS / OSM tiles
const REMOTE_CACHE = 'geoid-remote-v1';    // raw.githubusercontent.com (plates, faults)
const TILE_CACHE = 'geoid-root-ctx-tiles-v1';    // ArcGIS CTX tiles (Mars in the Earth shell)
const OWNED = [STATIC_CACHE, DATA_CACHE, BASEMAP_CACHE, REMOTE_CACHE, TILE_CACHE];
const FAMILIES = ['geoid-site-', 'geoid-data-', 'geoid-basemap-tiles-', 'geoid-remote-', 'geoid-root-'];
// Written by the old root /sw-ctx-tiles.js; nothing reads them any more.
const LEGACY = [/^geoid-ctx-tiles-v13\d$/, /^geoid-assets-v13\d$/];

const LIMITS = { [BASEMAP_CACHE]: 4000, [DATA_CACHE]: 6000, [TILE_CACHE]: 3000 };

const PRECACHE = [
  '/styles/shared.css',
  '/styles/v2-site.css',
  '/styles/site-nav.css',
  '/styles/skins/synthwave.css',
  '/styles/viewer-skin.css',
  '/styles/viewer-skin-ember.css',
  '/styles/nav.js',
  '/scripts/v2-site.js',
  '/scripts/ui-sound.js',
  '/assets/GeoID_logo_icon.png',
  '/assets/GeoID_mark.png',
  '/assets/explorer_logo.png',
  '/assets/mygeoid_logo.png',
  '/earth_explorer/assets/logo.png?v=geoid-2026',
];

self.addEventListener('install', (evt) => {
  self.skipWaiting();
  evt.waitUntil(caches.open(STATIC_CACHE).then((cache) => Promise.allSettled(
    PRECACHE.map((url) => cache.add(url).catch(() => {})))));
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !OWNED.includes(k) && (
      FAMILIES.some((f) => k.startsWith(f)) || LEGACY.some((re) => re.test(k))
    )).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── helpers ──────────────────────────────────────────────────────────────

const LOCAL = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const trimming = new Set();
async function trim(name) {
  const max = LIMITS[name];
  if (!max || trimming.has(name)) return;
  trimming.add(name);
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    // oldest first: Cache Storage keeps insertion order
    for (let i = 0; i < keys.length - max; i += 1) await cache.delete(keys[i]);
  } finally {
    trimming.delete(name);
  }
}
let puts = 0;
function store(name, request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  caches.open(name).then((c) => c.put(request, response)).then(() => {
    if ((puts += 1) % 200 === 0) trim(name);
  }).catch(() => {});
}
function cacheFirst(name, request) {
  return caches.open(name).then(async (cache) => {
    const hit = await cache.match(request);
    if (hit) return hit;
    const resp = await fetch(request);
    store(name, request, resp.clone());
    return resp;
  });
}
function staleWhileRevalidate(name, request) {
  return caches.open(name).then(async (cache) => {
    const hit = await cache.match(request);
    const net = fetch(request).then((resp) => { store(name, request, resp.clone()); return resp; })
      .catch(() => null);
    return hit || (await net) || fetch(request);
  });
}
// stamp.py's own form: moves on every commit, so a URL carrying it never
// changes content. Planet modules carry epoch stamps that do NOT move and
// are left network-first.
const STAMP = /(^|[?&])v=(gis-)?\d{8}-[0-9a-f]{7}(&|$)/;

// ── the CTX proxy (Mars tiles through the same origin) ───────────────────

const CTX_PROXY_SERVICES = {
  CTX: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer',
  CTX1: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer',
};
const BLANK_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
), (c) => c.charCodeAt(0));
const blankTile = (status) => new Response(BLANK_PNG, {
  status: 200,
  headers: { 'Content-Type': 'image/png', 'X-CTX-Blank-Tile': '1', 'X-CTX-Upstream-Status': String(status || 0) },
});

function ctxProxy(url) {
  const tileMatch = url.pathname.match(/\/ctx-proxy\/tile\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/);
  if (tileMatch) {
    const [, name, z, y, x] = tileMatch;
    const upstream = `${CTX_PROXY_SERVICES[name] || CTX_PROXY_SERVICES.CTX}/tile/${z}/${y}/${x}`;
    const wantBlank = url.searchParams.get('blankTile') === 'true';
    return (async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(upstream);
      if (hit) return hit;
      let status = 0;
      try {
        const res = await fetch(upstream);
        status = res.status;
        if (res.ok) {
          const out = new Response(await res.blob(), { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/png' } });
          cache.put(upstream, out.clone());
          return out;
        }
      } catch (_e) { /* CORS or network: fall through */ }
      return wantBlank ? blankTile(status) : new Response('', { status: status || 504, statusText: 'CTX tile unavailable' });
    })();
  }
  const base = CTX_PROXY_SERVICES[url.searchParams.get('name')] || CTX_PROXY_SERVICES.CTX;
  return fetch(`${base}?f=json`).then(async (res) => new Response(await res.text(), {
    status: res.status, headers: { 'Content-Type': 'application/json' },
  })).catch(() => new Response('{}', { status: 502, headers: { 'Content-Type': 'application/json' } }));
}

// ── fetch ────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (evt) => {
  const { request } = evt;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  const host = url.hostname;

  // Google Fonts: content-addressed.
  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
    evt.respondWith(cacheFirst(STATIC_CACHE, request));
    return;
  }
  // The data bucket. Only FINGERPRINTED URLs (?v=): the fingerprint moves when
  // the file does, so the cached copy is the file for as long as the URL is.
  if (host === 'data.geoidinitiative.com') {
    if (url.searchParams.has('v')) evt.respondWith(cacheFirst(DATA_CACHE, request));
    return;
  }
  // Basemap imagery tiles: the launch mosaic is 256 of them.
  if (host === 'tiles.maps.eox.at' || host === 'gibs.earthdata.nasa.gov' || host.endsWith('tile.openstreetmap.org')) {
    evt.respondWith(cacheFirst(BASEMAP_CACHE, request));
    return;
  }
  // Plate boundaries and faults live on GitHub, which sends max-age=300: shown
  // from the cache at once and refreshed behind it.
  if (host === 'raw.githubusercontent.com') {
    evt.respondWith(staleWhileRevalidate(REMOTE_CACHE, request));
    return;
  }
  // ArcGIS CTX tiles, direct: a failure becomes a tagged blank tile the
  // streamers can read instead of an opaque TypeError.
  if (url.href.includes('MapServer/tile/') || host.endsWith('arcgis.com')) {
    evt.respondWith(caches.open(TILE_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      let status = 0;
      try {
        const resp = await fetch(request);
        status = resp.status;
        if (resp.ok) { cache.put(request, resp.clone()); return resp; }
      } catch (_e) { /* fall through */ }
      return blankTile(status);
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/ctx-proxy/')) {
    evt.respondWith(ctxProxy(url));
    return;
  }

  // HTML: network-first so a deploy always reaches the reader (cache:'reload'
  // skips the host's 600 s HTTP cache).
  if (request.mode === 'navigate') {
    evt.respondWith(fetch(request, { cache: 'reload' }).then((resp) => {
      store(STATIC_CACHE, request, resp.clone());
      return resp;
    }).catch(() => caches.match(request)));
    return;
  }

  const p = url.pathname;
  const isCode = /\.(js|mjs|css)$/.test(p);
  // STAMPED code is immutable: served from the cache with no network trip.
  // This is most of a warm launch — two hundred modules that used to be
  // refetched, one round trip each, on every visit.
  if (isCode && !LOCAL && STAMP.test(url.search)) {
    evt.respondWith(cacheFirst(STATIC_CACHE, request));
    return;
  }
  // Unstamped code: network-first (a fresh entry script paired with a stale
  // cached module broke three viewers once).
  if (isCode) {
    evt.respondWith((async () => {
      try {
        const resp = await fetch(request, { cache: 'reload' });
        store(STATIC_CACHE, request, resp.clone());
        return resp;
      } catch (e) {
        const hit = await caches.match(request);
        if (hit) return hit;
        throw e;
      }
    })());
    return;
  }
  // Media: immutable in practice.
  if (/\.(png|jpg|jpeg|webp|svg|woff2|woff|ico|gif|mp3|ogg)$/.test(p)) {
    evt.respondWith(cacheFirst(STATIC_CACHE, request));
    return;
  }
  // Local JSON (catalogue sidecars, manifests): shown at once, refreshed
  // behind — sources.json among them, which is what names the fingerprints.
  if (/\.json$/.test(p)) {
    evt.respondWith(staleWhileRevalidate(STATIC_CACHE, request));
  }
});
