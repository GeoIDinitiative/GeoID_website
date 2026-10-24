/**
 * Landslide susceptibility by random forest: the features, once.
 *
 * The forest replaces Recipe A's weighted overlay, which scored AUC 0.53 on
 * held-out Mid/North Wales (validate-landslide.py). It is trained offline
 * (services/bake-landslide-global.py) on inventoried landslides -- BGS's
 * National Landslide Database for Great Britain and NASA's Global Landslide
 * Catalog elsewhere -- and run, like the flood forest, as a baked 0.1° world
 * and a ~250 m map over the view.
 *
 * The features are the flood forest's terrain, land cover, soil and climate
 * (flood-ml.js buildStack, the same code), plus two that a slope failure
 * needs and a flood does not:
 *   - relief       the height range within ~1 km: a landslide needs ground to
 *                  fall from, and a single cell's slope at 250 m reads a
 *                  valley side gentler than it is
 *   - lithology    GLiM's dominant rock class per 0.5° cell (Hartmann &
 *                  Moosdorf 2012, CC BY 3.0), as one-hot groups. Coarse, and
 *                  said so: the polygon GLiM is finer and carries no licence
 *                  statement fit for a product that is sold.
 * A storm's rain is NOT a feature: the inventories mostly lack trustworthy
 * dates, and susceptibility is where ground fails, not when.
 */

import { buildStack, cellCentre, featureRows } from "./flood-ml.js?v=20261024-05d24f9";

export const LS_FEATURES = [
  "elevation_m", "slope_deg", "hand_m", "log10_upstream_km2", "channel_distance_m", "twi", "curvature", "relief_m",
  "water_frac", "trees_frac", "flooded_veg_frac", "crops_frac", "built_frac", "bare_frac", "range_frac",
  "soil_thickness_m", "rain_normal_mm",
  "lith_unconsolidated", "lith_siliciclastic", "lith_mixed_sedimentary", "lith_carbonate", "lith_metamorphic",
  "lith_plutonic", "lith_volcanic",
];

/** GLiM 0.5° class codes (Classnames.txt) into the groups the forest reads. */
export const GLIM_GROUPS = Object.freeze({
  lith_unconsolidated: [1],          // su
  lith_siliciclastic: [3],           // ss
  lith_mixed_sedimentary: [5, 14],   // sm, ev (evaporites)
  lith_carbonate: [6],               // sc
  lith_metamorphic: [8],             // mt
  lith_plutonic: [4, 9, 13],         // pb, pa, pi
  lith_volcanic: [2, 7, 10, 12],     // vb, va, vi, py
});

/** The relief window: ~1 km either side, at least one cell. */
export function reliefRadius(grid) {
  return Math.max(1, Math.round(1000 / Math.min(grid.mx, grid.my)));
}

/**
 * Height range (max - min) over the land cells within `r` cells, separably:
 * a running max and min along rows, then along columns of those. NaN off land.
 */
export function relief(dem, mask, grid, r = reliefRadius(grid)) {
  const { width: w, height: h } = grid;
  const n = w * h;
  const hiRow = new Float32Array(n); const loRow = new Float32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let hi = -Infinity; let lo = Infinity;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) {
        const i = y * w + k;
        if (!mask[i]) continue;
        if (dem[i] > hi) hi = dem[i];
        if (dem[i] < lo) lo = dem[i];
      }
      hiRow[y * w + x] = hi; loRow[y * w + x] = lo;
    }
  }
  const out = new Float32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!mask[i]) { out[i] = NaN; continue; }
      let hi = -Infinity; let lo = Infinity;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) {
        const j = k * w + x;
        if (hiRow[j] > hi) hi = hiRow[j];
        if (loRow[j] < lo) lo = loRow[j];
      }
      out[i] = hi - lo;
    }
  }
  return out;
}

/**
 * GLiM's dominant class at each cell centre (nearest 0.5° cell), one-hot.
 * `glim` is { values (row-major, north row first), lattice: {nLat, nLon, lat0,
 * lon0, dLat, dLon} } with lat0/lon0 the first cell's CENTRE. Ice, water and
 * no-data cells set every group to 0, which is a reading, not a gap.
 */
export function lithologyOnGrid(glim, grid) {
  const n = grid.width * grid.height;
  const out = {};
  const groupOf = new Map();
  for (const [name, codes] of Object.entries(GLIM_GROUPS)) {
    out[name] = new Float32Array(n);
    codes.forEach((c) => groupOf.set(c, out[name]));
  }
  const { nLat, nLon, lat0, lon0, dLat, dLon } = glim.lattice;
  for (let i = 0; i < n; i += 1) {
    const { lon, lat } = cellCentre(grid, i);
    const y = Math.min(nLat - 1, Math.max(0, Math.round((lat - lat0) / dLat)));
    const x = Math.min(nLon - 1, Math.max(0, Math.round((lon - lon0) / dLon)));
    const arr = groupOf.get(glim.values[y * nLon + x]);
    if (arr) arr[i] = 1;
  }
  return out;
}

/** The landslide stack: flood-ml.js's, plus relief and lithology. */
export function buildLandslideStack({ grid, dem, lcClasses, lcK, soil, rainNormal, glim }) {
  const n = grid.width * grid.height;
  const zero = () => new Float32Array(n);
  const base = buildStack({ grid, dem, lcClasses, lcK, soil, rainNormal, rain3: zero(), rain30: zero() });
  const stack = { ...base.stack, relief_m: relief(dem, base.mask, grid), ...lithologyOnGrid(glim, grid) };
  for (const name of Object.keys(GLIM_GROUPS)) {
    for (let i = 0; i < n; i += 1) if (!base.mask[i]) stack[name][i] = NaN;
  }
  const fills = { ...base.fills };
  delete fills.rain_3day_max_mm; delete fills.rain_30day_mm;
  return { stack, mask: base.mask, land: base.land, fills };
}

export function landslideRows(stack, cells) {
  return featureRows(stack, cells, LS_FEATURES);
}
