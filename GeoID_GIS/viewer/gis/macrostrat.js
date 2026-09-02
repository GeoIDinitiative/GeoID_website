/**
 * Global geology, from Macrostrat's Burwell compilation.
 *
 * This is the global base the geology tab was built around and never had. It
 * is not one downloadable map, and could not be: the compilation stitches
 * hundreds of national and state surveys, so the best sheet over any ground is
 * whichever survey mapped it — BGS over Northern Ireland, the USGS over
 * Montana — and the whole thing is far too large to serve as a file. It is
 * published as vector tiles instead, which is the same idea as the imagery
 * basemap: the map at the resolution the view deserves. 713 KB is the whole
 * world; 2 KB is a valley.
 *
 * What arrives is an ordinary GeoJSON layer, so everything the app already
 * does to geology — the click card, the legend, symbology, clipping, sampling,
 * extraction, export — works on it with nothing added. `mvt.js` is the only
 * new machinery, and it is a decoder rather than a special case.
 *
 * Licence: CC BY 4.0, plus the credit each source map carries. Every feature
 * keeps its own `ref_name` / `ref_title` / `ref_url`, so a polygon can always
 * say which survey mapped it — that is the honest unit of attribution here,
 * not one line about Macrostrat.
 */

import { decodeTile, tilesForBounds } from "./mvt.js?v=20260902-989ed19";
import { visibleBounds } from "./view-extent.js?v=20260902-989ed19";
import * as THREE from "../vendor/three.module.js";

const TILES = "https://tiles.macrostrat.org/carto";
/** The JSON API, which answers with real geometry rather than tiles. */
const API = "https://macrostrat.org/api/v2";

/** The service's own limit; asking past it returns the deepest it has. */
const MAX_ZOOM = 13;

/**
 * Enough tiles to cover a view, few enough not to be a bulk download.
 *
 * Sixteen is a full 4x4 ring around a view — the same budget the imagery
 * refine uses — and at these sizes that is about 1-3 MB.
 */
const MAX_TILES = 16;

/**
 * How much deeper than the baked copy a view may ask to go.
 *
 * The bake stops at zoom 5. Past that every tile is a round trip to somebody
 * else's server, so the budget stays modest and the depth is only worth it
 * when the view is small enough to need it — which is exactly when the tiles
 * themselves are small (2-20 KB).
 */
const LIVE_ZOOM_REACH = 5;

/**
 * The zoom whose tiles suit this span.
 *
 * One tile spans 360/2^z degrees, so this picks the level where the view is a
 * couple of tiles across, then steps back out while the cover exceeds the
 * budget. Stepping out rather than truncating matters: a truncated cover is a
 * map with a bite out of it, and nothing on screen says why.
 */
export function zoomForBounds(bounds, {
  maxTiles = MAX_TILES, maxZoom = MAX_ZOOM, minZoom = 0,
} = {}) {
  /**
   * The DEEPEST zoom the budget allows, not the shallowest that covers.
   *
   * The old rule picked the level where the view was about one tile across —
   * which spends a sixteen-tile budget on one tile and hands you the coarsest
   * generalisation that fits. Measured over Europe: 3,800 km up it chose zoom
   * 2, a median 25 km between vertices, on a view where a pixel is 3 km. Using
   * the whole budget instead moves that to zoom 4, about 6 km — the same
   * request count, four times the detail.
   */
  let best = Math.max(0, Math.min(maxZoom, minZoom));
  for (let z = best; z <= maxZoom; z += 1) {
    if (tilesForBounds(bounds, z).length > maxTiles) break;
    best = z;
  }
  return best;
}

/** The current camera's extent, in the box shape this module speaks. */
export function viewBounds() {
  const b = visibleBounds(window.GeoIDViewer, THREE);
  if (!b) return null;
  return { west: b.minLon, east: b.maxLon, south: b.minLat, north: b.maxLat };
}

/** The whole world, for the first load and for a view that cannot be read. */
export const WORLD = { west: -180, east: 180, south: -85, north: 85 };

/**
 * The world at zoom ONE, not zero, and this is measured rather than cautious.
 *
 * Zoom 0 is one 713 KB tile holding 5,792 units, which sounds like the world
 * and is not: the tiler generalises hard at that level and drops whole
 * regions. Point-in-polygon over the decoded tile finds nothing under Northern
 * Ireland or Alice Springs, while Bern and Boulder answer — so a click on
 * Ireland reported no geology at all. Zoom 1 answers everywhere.
 *
 * Zoom 2 is the backdrop because it is the whole world for 1.3 MB — sixteen
 * baked tiles, off disk — and it is what the far side of the planet is drawn
 * from when you spin the globe. Twenty kilometres between vertices rather than
 * twenty-eight, for a quarter of a second more.
 */
export const WORLD_ZOOM = 2;

/**
 * One tile, with a retry that exists for a specific measured reason.
 *
 * Some objects in the tile server's Varnish cache were stored WITHOUT their
 * `Access-Control-Allow-Origin` header, so the browser blocks them — while
 * curl, which does not care about CORS, fetches them happily. Measured on
 * `carto/1/0/0`: a cache hit comes back with no such header and the fetch
 * fails; the identical tile requested under a query string is a cache miss,
 * carries the header, and loads. That tile is the quarter of the planet
 * holding Ireland and North America, so the symptom was a world map with the
 * Atlantic's edges missing and nothing to say why.
 *
 * So: one retry, on a URL the cache has not got, and no more than one — this
 * is somebody else's tile server and a loop against it is an attack.
 */
async function fetchTile(tile, only, signal) {
  const base = `${TILES}/${tile.z}/${tile.x}/${tile.y}.mvt`;
  let response = null;
  try {
    response = await fetch(base, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    response = await fetch(`${base}?cors=1`, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return { tile, bytes: buffer.byteLength, layers: decodeTile(buffer, { ...tile, only }) };
}

/**
 * Fetch the geology covering a box.
 *
 * `kind` is "units" (the polygons — the map) or "lines" (contacts and faults).
 * Tiles are fetched four at a time: the whole point is that the first look at
 * a region is a couple of seconds, and one at a time makes that eight.
 *
 * A tile that fails is skipped rather than fatal — one 500 from a tile server
 * should cost a corner of the map, not the map.
 */
export async function fetchGeology({
  bounds = null, kind = "units", maxTiles = MAX_TILES, zoom: askedZoom = null,
  signal = null, onProgress = null,
} = {}) {
  const box = bounds || viewBounds() || WORLD;
  const zoom = askedZoom == null ? zoomForBounds(box, { maxTiles }) : askedZoom;
  const wanted = tilesForBounds(box, zoom).slice(0, maxTiles);
  const features = [];
  let bytes = 0;
  let failed = 0;
  let done = 0;
  const queue = [...wanted];
  const worker = async () => {
    for (;;) {
      const tile = queue.shift();
      if (!tile) return;
      try {
        const result = await fetchTile(tile, [kind], signal);
        bytes += result.bytes;
        (result.layers[kind] || []).forEach((f) => features.push(f));
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        failed += 1;
      }
      done += 1;
      onProgress?.(done, wanted.length);
    }
  };
  await Promise.all([0, 1, 2, 3].map(worker));
  return {
    collection: { type: "FeatureCollection", features },
    zoom,
    tiles: wanted.length,
    failed,
    bytes,
    bounds: box,
  };
}

/**
 * The legend, from the colours the source itself uses.
 *
 * Macrostrat ships a `color` per polygon — the colour that map is drawn in,
 * chosen for its lithology and age — so the layer is painted with those rather
 * than with a palette of ours. That is also why the legend cannot be built the
 * usual way: `categoricalSymbology` assigns colours, and here the data has
 * already assigned them. This counts the units on screen and keys the commonest
 * `count` of them, each in its own colour.
 *
 * A global view holds hundreds of units, so the key is a summary and the caller
 * says so. Twelve rows of the map's own colours beats fifty of ours.
 */
/**
 * The ground a ring covers, in square kilometres.
 *
 * A legend is read against the MAP, so what earns a row is how much of the
 * picture a unit occupies. Spherical, because a degree of longitude is 111 km
 * at the equator and 64 km at 55 N, and a legend that ranked by degrees would
 * quietly favour the tropics.
 */
const EARTH_RADIUS_KM = 6371.0088;
function ringAreaKm2(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [lon1, lat1] = ring[j];
    const [lon2, lat2] = ring[i];
    if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) continue;
    total += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

/** A feature's ground: outer rings less their holes, across every part. */
export function featureAreaKm2(feature) {
  const g = feature?.geometry;
  if (!g) return 0;
  const polys = g.type === "Polygon" ? [g.coordinates]
    : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.reduce((sum, poly) => sum
    + poly.reduce((a, ring, i) => a + (i === 0 ? ringAreaKm2(ring) : -ringAreaKm2(ring)), 0), 0);
}

export function legendFrom(features, { field = "name", count = 12,
  colourField = "color" } = {}) {
  const seen = new Map();
  (features || []).forEach((f) => {
    const label = f?.properties?.[field];
    const colour = f?.properties?.[colourField];
    if (!label || !colour) return;
    const row = seen.get(label) || { label, colour, count: 0, area: 0 };
    row.count += 1;
    row.area += featureAreaKm2(f);
    seen.set(label, row);
  });
  /**
   * RANKED BY GROUND, not by how many pieces a unit arrived in.
   *
   * Sorting on `count` reads a map by fragmentation: a unit broken into nine
   * slivers outranks one solid mass, and the mass is what a reader is looking
   * at. Measured on a 47 km clip, the legend showed "12 of 23 units" and the
   * one it left out was a SINGLE polygon covering 351 km2 — the pale
   * "Precambrian-Phanerozoic crystalline metamorphic rocks", which is close
   * enough to white that with no legend row there was nothing to tell a reader
   * it was a unit at all rather than a hole in the map. It was reported as a
   * gap in the data twice.
   *
   * Count breaks the tie, so a legend over features with no geometry still
   * orders sensibly rather than arbitrarily.
   */
  const rows = [...seen.values()]
    .sort((a, b) => (b.area - a.area) || (b.count - a.count))
    .slice(0, count);
  return {
    palette: rows.map((r) => String(r.colour).replace("#", "")),
    labels: rows.map((r) => r.label),
    values: rows.map((r) => r.label),
    counts: rows.map((r) => r.count),
    areasKm2: rows.map((r) => Math.round(r.area)),
    categorical: true,
    classed: true,
    field,
    shown: rows.length,
    total: seen.size,
  };
}

/**
 * What a polygon is, at one point, without loading anything.
 *
 * The same compilation through its JSON API: one request, one unit, with the
 * source map's own reference. Useful where a tile is not wanted — a click on
 * ground the layer is not covering.
 */
export async function unitAt(lat, lon, { signal = null } = {}) {
  const url = `${API}/geologic_units/map?lat=${lat}&lng=${lon}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body?.success?.data?.[0] || null;
}

/**
 * THE UNITS THEMSELVES, not the tiles they were served in.
 *
 * `carto` is a TILE service, and a tile is a cut of the map: a unit crossing a
 * tile boundary arrives as two polygons sharing a straight cut edge. Stitching
 * tiles can therefore never reproduce the source outlines — measured on a
 * 45 km study area at zoom 13, the clip came back as 417 pieces laid out in a
 * visible lattice, one unit split into two wherever a tile edge crossed it.
 *
 * The JSON API answers with the mapped polygon itself, and takes `map_id` in
 * batches, so the tiles can be used for the cheap question they are good at —
 * WHICH units are here — and the true geometry fetched for the answer.
 *
 * Ids that the API does not return are simply absent: the caller keeps its
 * tiled version of those rather than losing the ground, because a hole is a
 * worse answer than a seam.
 */
export async function unitsByMapId(ids, { batch = 50, concurrency = 4, signal = null,
  onProgress = null } = {}) {
  const wanted = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
  if (!wanted.length) return { type: "FeatureCollection", features: [] };
  const chunks = [];
  for (let i = 0; i < wanted.length; i += batch) chunks.push(wanted.slice(i, i + batch));

  const features = [];
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const url = `${API}/geologic_units/map?map_id=${chunk.join(",")}&format=geojson_bare`;
      try {
        const response = await fetch(url, { signal });
        if (response.ok) {
          const body = await response.json();
          for (const f of body?.features || []) if (f?.geometry) features.push(f);
        }
      } catch (error) {
        // One batch failing costs its units, not the run.
      }
      done += 1;
      onProgress?.(done / chunks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return { type: "FeatureCollection", features };
}

if (typeof window !== "undefined") {
  window.GeoIDMacrostrat = {
    fetchGeology, legendFrom, unitAt, unitsByMapId, viewBounds, zoomForBounds,
    WORLD, WORLD_ZOOM,
  };
}
