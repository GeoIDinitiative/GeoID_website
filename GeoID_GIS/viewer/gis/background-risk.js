/**
 * The long-term risk maps, read at a place WITHOUT being on the globe.
 *
 * The total-risk score used to count a cyclone, seismic or volcanic risk map
 * only if somebody had ticked it — so the same place scored differently
 * depending on what else happened to be loaded. These three grids are the
 * same files those rows draw (fingerprinted in `sources.json`, so after the
 * first read they come from the cache, not the network), read once a session
 * into a lookup and asked about one point.
 *
 * Every cell is an axis-aligned rectangle (the bakes' quadtree), so a cell's
 * bounding box IS the cell: a point is in it exactly when it is in the box.
 * The lookup buckets the cells by whole degree and tests only that bucket.
 */

import { dataUrl } from "./data-base.js?v=20261024-86f01f1";

export const GRIDS = [
  { id: "cyclone", path: "/data/global/cyclone-risk.geojson", model: "Tropical cyclone risk map (IBTrACS, within 200 km)", layer: /cyclone risk/i },
  { id: "seismic", path: "/data/global/seismic-risk.geojson", model: "Seismic risk map (shaking ≈ MMI VI)", layer: /seismic risk/i },
  { id: "volcanic", path: "/data/global/volcanic-risk.geojson", model: "Volcanic ash risk map (≥ 1 mm)", layer: /volcanic risk|ashfall/i },
];

/** The rectangle a feature's outer ring spans, signed degrees. */
export function boxOf(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const ring of rings) for (const [x, y] of ring || []) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return Number.isFinite(w) ? { w, e, s, n } : null;
}

/** A degree-bucket index over a grid's cells. */
export function cellIndex(features) {
  const buckets = new Map();
  const cells = [];
  (features || []).forEach((f) => {
    const b = boxOf(f);
    if (!b) return;
    const k = cells.push({ ...b, p: Number(f.properties?.p_yr), props: f.properties }) - 1;
    for (let la = Math.floor(b.s); la < Math.ceil(b.n) || la === Math.floor(b.s); la += 1) {
      for (let lo = Math.floor(b.w); lo < Math.ceil(b.e) || lo === Math.floor(b.w); lo += 1) {
        const key = `${la},${lo}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(k);
      }
    }
  });
  return { cells, buckets };
}

/** The cell under a place, or null where the grid has none (no event on record). */
export function cellAt(index, lat, lon) {
  if (!index) return null;
  const list = index.buckets.get(`${Math.floor(lat)},${Math.floor(lon)}`) || [];
  // Several bakes write the smallest cells last; the smallest containing cell is the finest answer.
  let best = null;
  for (const k of list) {
    const c = index.cells[k];
    if (lat >= c.s && lat <= c.n && lon >= c.w && lon <= c.e) {
      if (!best || (c.n - c.s) * (c.e - c.w) < (best.n - best.s) * (best.e - best.w)) best = c;
    }
  }
  return best;
}

const loaded = new Map();
/** One grid's lookup, fetched once a session. */
export function gridIndex(grid) {
  if (!loaded.has(grid.id)) {
    loaded.set(grid.id, (async () => {
      const res = await fetch(await dataUrl(grid.path));
      if (!res.ok) throw new Error(`${grid.path} answered ${res.status}`);
      return cellIndex((await res.json()).features);
    })().catch((error) => { loaded.delete(grid.id); throw error; }));
  }
  return loaded.get(grid.id);
}

/**
 * Every grid's annual chance at a place: { id, model, p, cell } each, or an
 * `error` for a grid that could not be read. A place no event has reached is
 * p = 0, which is an answer, not a gap.
 */
export async function backgroundAt(lat, lon, { skip = [] } = {}) {
  return Promise.all(GRIDS.filter((g) => !skip.includes(g.id)).map(async (grid) => {
    try {
      const cell = cellAt(await gridIndex(grid), lat, lon);
      const p = cell && Number.isFinite(cell.p) ? cell.p : 0;
      return { id: grid.id, model: grid.model, p, cell };
    } catch (error) {
      return { id: grid.id, model: grid.model, error: error.message };
    }
  }));
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.GeoIDBackgroundRisk = { backgroundAt, GRIDS };
}
