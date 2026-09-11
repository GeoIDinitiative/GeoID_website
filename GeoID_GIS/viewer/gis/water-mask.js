/**
 * WHERE THE WATER IS, on the streamed DEM's own grid — and where a sea level
 * puts it.
 *
 * The paleo-sea overlay was a threshold on the shipped elevation texture:
 * every pixel below the slider was sea. That is a picture of the texture, and
 * it is wrong in three ways the real polygons can put right:
 *
 *   - AT 0 m IT IS NOT THE COASTLINE. A 19.6 km height field below zero is not
 *     where the sea is: it floods the Netherlands' polders and the Dead Sea and
 *     misses every harbour. The ocean polygons ARE the coastline, so the sea at
 *     today's level is exactly them, whatever the DEM says under them.
 *   - LOW GROUND IS NOT SEA UNLESS THE SEA CAN REACH IT. A basin below the new
 *     level with a ridge between it and the coast stays dry; a threshold fills
 *     it. So the sea spreads from the ocean polygons through ground below the
 *     level (8-neighbour), and what it cannot reach is reported separately as
 *     cut-off low ground rather than painted as sea.
 *   - A LAKE IS AT ITS OWN LEVEL, which is not the height of its bed. The DEM
 *     inside a big lake is its bathymetry or noise; HydroLAKES carries each
 *     lake's surveyed surface elevation, and that is the height a lake cell
 *     takes — so the Caspian (−29 m) stays a lake at today's sea level and a
 *     rising sea reaches it only by crossing land lower than the new level.
 *
 * The pure half (burn, flood) is tested in Node; the fetch reads the same baked
 * pyramids the Hydrology rows stream, straight from their manifests.
 */

import { decodeTile, tilesForBounds } from "./mvt.js?v=20260911-18f9802";

/* ── classes a cell can end up in ───────────────────────────────────────── */
export const DRY = 0;
export const SEA = 1;          // the sea as it is at this level
export const LAKE = 2;
export const FLOODED = 3;      // land under a risen sea, reached from the ocean
export const EXPOSED = 4;      // seabed above a fallen sea
export const CUT_OFF = 5;      // below the level, but the sea cannot reach it

/**
 * Burn polygons onto a grid by scanline, even-odd — so a hole is a hole and a
 * multipolygon's parts are each filled. A cell is inside when its CENTRE is.
 *
 * `bounds` is west/south/east/north in degrees; row 0 is the north edge, the
 * raster convention. `valueOf(feature)` is what the cells are set to.
 */
export function burnPolygons(features, bounds, width, height, out, valueOf = () => 1) {
  const sx = width / (bounds.east - bounds.west);
  const sy = height / (bounds.north - bounds.south);
  for (const feature of features || []) {
    const g = feature?.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates]
      : g.type === "MultiPolygon" ? g.coordinates : [];
    const value = valueOf(feature);
    for (const rings of polys) {
      // Crossings per row, over every ring of this polygon at once: even-odd
      // across outer and holes together is what makes the holes empty.
      const rows = new Map();
      let jMin = Infinity; let jMax = -Infinity;
      for (const ring of rings) {
        for (let k = 0; k < ring.length - 1; k += 1) {
          const x1 = (ring[k][0] - bounds.west) * sx;
          const y1 = (bounds.north - ring[k][1]) * sy;
          const x2 = (ring[k + 1][0] - bounds.west) * sx;
          const y2 = (bounds.north - ring[k + 1][1]) * sy;
          if (y1 === y2) continue;
          const lo = Math.max(0, Math.ceil(Math.min(y1, y2) - 0.5));
          const hi = Math.min(height - 1, Math.floor(Math.max(y1, y2) - 0.5));
          for (let j = lo; j <= hi; j += 1) {
            const yc = j + 0.5;
            // Half-open, so a vertex exactly on a row centre counts once.
            if ((y1 <= yc) === (y2 <= yc)) continue;
            const x = x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1);
            let list = rows.get(j);
            if (!list) { list = []; rows.set(j, list); }
            list.push(x);
            if (j < jMin) jMin = j;
            if (j > jMax) jMax = j;
          }
        }
      }
      for (const [j, xs] of rows) {
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const i0 = Math.max(0, Math.ceil(xs[k] - 0.5));
          const i1 = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
          for (let i = i0; i <= i1; i += 1) out[(j * width) + i] = value;
        }
      }
    }
  }
  return out;
}

/**
 * The sea at `level` metres, spread from the ocean mask through the DEM.
 *
 * `heights` is the DEM (NaN where it has not streamed), `ocean` a 0/1 mask,
 * `lakeLevel` each lake cell's SURFACE elevation (NaN where there is no lake).
 * `wrap` joins the east edge to the west, for a grid round the whole planet.
 *
 * Returns the class of every cell and the DEPTH band the map draws: water over
 * formerly dry land where the sea rose, seabed above the water where it fell.
 */
export function floodFromSea({ heights, ocean, lakeLevel, width, height, level, wrap = false }) {
  const n = width * height;
  const classes = new Uint8Array(n);
  const depth = new Float32Array(n).fill(NaN);
  // NaN is "no lake"; −Infinity is "a lake with no published surface", which
  // takes the DEM's height under it — the best the data can say.
  const isLake = (c) => !Number.isNaN(lakeLevel[c]);
  const surface = (c) => (Number.isFinite(lakeLevel[c]) ? lakeLevel[c] : heights[c]);
  for (let c = 0; c < n; c += 1) {
    if (ocean[c]) classes[c] = SEA;
    else if (isLake(c)) classes[c] = LAKE;
  }
  if (level < 0) {
    // A FALLEN SEA leaves the seabed above it dry. Lakes keep their own level.
    for (let c = 0; c < n; c += 1) {
      if (!ocean[c]) continue;
      const h = heights[c];
      if (Number.isFinite(h) && h >= level) {
        classes[c] = EXPOSED;
        depth[c] = h - level;
      }
    }
    return { classes, depth };
  }
  // A RISEN SEA: breadth-first from every ocean cell through ground below the
  // level. A lake is crossed only if its SURFACE is below the new sea, and then
  // it is part of the sea; its own cells are not painted, being water already.
  const below = (c) => {
    const h = isLake(c) ? surface(c) : heights[c];
    return Number.isFinite(h) && h < level;
  };
  const reached = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0; let tail = 0;
  for (let c = 0; c < n; c += 1) {
    if (ocean[c]) { reached[c] = 1; queue[tail] = c; tail += 1; }
  }
  while (head < tail) {
    const c = queue[head]; head += 1;
    const ci = c % width; const cj = (c - ci) / width;
    for (let dj = -1; dj <= 1; dj += 1) {
      const nj = cj + dj;
      if (nj < 0 || nj >= height) continue;
      for (let di = -1; di <= 1; di += 1) {
        if (!di && !dj) continue;
        let ni = ci + di;
        if (ni < 0 || ni >= width) {
          if (!wrap) continue;
          ni = (ni + width) % width;
        }
        const m = (nj * width) + ni;
        if (reached[m] || !below(m)) continue;
        reached[m] = 1;
        queue[tail] = m; tail += 1;
      }
    }
  }
  for (let c = 0; c < n; c += 1) {
    if (ocean[c] || isLake(c)) continue;
    const h = heights[c];
    if (!Number.isFinite(h) || h >= level) continue;
    if (reached[c]) {
      classes[c] = FLOODED;
      depth[c] = level - h;
    } else {
      classes[c] = CUT_OFF;
    }
  }
  return { classes, depth };
}

/** Ground area of each class, in km², from the grid's own cell sizes. */
export function classAreas(classes, width, height, bounds) {
  const R = 6371.0088;
  const dLon = ((bounds.east - bounds.west) / width) * (Math.PI / 180);
  const dLat = ((bounds.north - bounds.south) / height) * (Math.PI / 180);
  const areas = [0, 0, 0, 0, 0, 0];
  for (let j = 0; j < height; j += 1) {
    const lat = bounds.north - ((j + 0.5) / height) * (bounds.north - bounds.south);
    const cell = R * R * dLon * dLat * Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < width; i += 1) areas[classes[(j * width) + i]] += cell;
  }
  return areas;
}

/* ── the page half: the polygons for a box, from the baked pyramids ─────── */

const PYRAMIDS = {
  ocean: { manifest: "/data/global/ocean/manifest.json", layer: "ocean", dir: "ocean" },
  lakes: { manifest: "/data/global/hydrolakes/manifest.json", layer: "lakes", dir: "hydrolakes" },
  // GRWL's centrelines, for the river corridor zones. Its coarse levels keep
  // only the wide rivers, which is the right set for a coarse grid anyway.
  rivers: { manifest: "/data/global/grwl/manifest.json", layer: "rivers", dir: "grwl" },
};

const STAMP = (() => {
  try { return new URL(import.meta.url).search || ""; } catch { return ""; }
})();
const manifests = new Map();
const tileCache = new Map();
const TILE_CACHE_MAX = 256;

function manifestOf(kind) {
  if (!manifests.has(kind)) {
    const spec = PYRAMIDS[kind];
    manifests.set(kind, fetch(`${spec.manifest}${STAMP}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .catch((error) => { manifests.delete(kind); throw error; }));
  }
  return manifests.get(kind);
}

/**
 * The zoom whose tiles are about as fine as the grid, capped by the pyramid and
 * by a tile budget. Finer than the grid is bytes nobody can see; coarser is a
 * coastline drawn more crudely than the heights beside it.
 */
export function zoomForGrid(bounds, width, maxZoom, maxTiles = 36) {
  const cellDeg = (bounds.east - bounds.west) / width;
  let z = Math.ceil(Math.log2(360 / (256 * Math.max(cellDeg, 1e-9))));
  z = Math.max(0, Math.min(maxZoom, z));
  const box = { west: bounds.west, east: bounds.east, south: bounds.south, north: bounds.north };
  while (z > 0 && tilesForBounds(box, z).length > maxTiles) z -= 1;
  return z;
}

async function tileFeatures(kind, manifest, t) {
  const key = `${t.z}/${t.x}/${t.y}`;
  // A tile the bake did not write is EMPTY water, not a failure: most of a
  // lake pyramid is dry land.
  if (manifest.tiles && !(key in manifest.tiles)) return [];
  const base = manifest.tiles_base || `/data/global/${PYRAMIDS[kind].dir}`;
  const url = `${base}/${key}.mvt?v=${manifest.version || ""}`;
  if (!tileCache.has(url)) {
    if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
    tileCache.set(url, fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => decodeTile(new Uint8Array(buf), { ...t, only: [PYRAMIDS[kind].layer] })
        [PYRAMIDS[kind].layer] || [])
      .catch((error) => { tileCache.delete(url); throw error; }));
  }
  return tileCache.get(url);
}

/** Every ocean or lake polygon piece touching the box, at the grid's own scale. */
export async function waterFeatures(kind, bounds, width) {
  const manifest = await manifestOf(kind);
  const z = zoomForGrid(bounds, width, Number(manifest.max_zoom ?? 6));
  const tiles = tilesForBounds(bounds, z);
  const lists = await Promise.all(tiles.map((t) => tileFeatures(kind, manifest, t)));
  return { features: lists.flat(), zoom: z, tiles: tiles.length };
}

/**
 * The two masks for a grid: the ocean as 0/1, each lake cell carrying its
 * surveyed surface elevation. A lake with no published elevation takes the DEM
 * under it, which is the best the data can say.
 */
export async function waterMasks(bounds, width, height) {
  const [ocean, lakes] = await Promise.all([
    waterFeatures("ocean", bounds, width), waterFeatures("lakes", bounds, width),
  ]);
  const oceanMask = burnPolygons(ocean.features, bounds, width, height,
    new Uint8Array(width * height), () => 1);
  const lakeLevel = burnPolygons(lakes.features, bounds, width, height,
    new Float32Array(width * height).fill(NaN),
    (f) => {
      const z = Number(f.properties?.elevation_m);
      return Number.isFinite(z) ? z : -Infinity;
    });
  return { ocean: oceanMask, lakeLevel, oceanZoom: ocean.zoom, lakeZoom: lakes.zoom };
}
