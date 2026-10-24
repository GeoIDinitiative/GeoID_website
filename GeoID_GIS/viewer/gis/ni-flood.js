/**
 * Flood susceptibility for the Northern Ireland prototype, computed in the page.
 *
 * WHY THIS EXISTS. Hazards ▸ Flood offered "Flood susceptibility (NI
 * prototype)" as a tick box that fetched `/ni-prototype/data/
 * ni_flood_susceptibility.tif`. That file was never shipped: `*.tif` is in the
 * repo's .gitignore, so the raster lived only on the machine that baked it and
 * every other copy of the site answered 404. The failure was then reported to
 * `#demo-status`, which sits inside the Landslides ▸ NI prototype subtab — a
 * collapsed section in a different part of the column — and the box quietly
 * un-ticked itself. From the Flood tab, nothing happened at all.
 *
 * The prototype's VECTOR inputs did ship (they are GeoJSON, which is not
 * ignored): the BGS 625k bedrock and superficial sheets, the HadUK rainfall
 * grid and the OpenStreetMap rivers. Those are enough to rebuild a screening
 * map honestly, so when the baked raster is unreachable the map is computed
 * from them here and goes onto the globe through the ordinary import path as a
 * GeoTIFF, like any dropped file.
 *
 * The model is a weighted overlay, ranked into five quantile classes:
 *
 *   proximity  P = exp(−d / 500 m)          d: distance to a mapped river
 *   deposit    D = table below               the superficial unit at the cell
 *   rainfall   R = (pr − min) / (max − min)  HadUK 1991–2020 annual total
 *   height     H = exp(−max(0, HAND) / 4 m)  only where a DEM is held
 *
 *   S = 0.45 P + 0.40 D + 0.15 R             no DEM
 *   S = 0.30 P + 0.30 D + 0.10 R + 0.30 H    with DEM
 *
 * HAND (height above nearest drainage) is the cell's height less the height of
 * the river cell the distance transform found nearest — the same nearest-
 * source pass that gives d, so it costs nothing extra. Alluvium leads the
 * deposit table because it is the floodplain by definition: it is what rivers
 * left where they have flooded.
 *
 * This is SCREENING, not a hazard map, and the layer's note says so.
 */

/** NI's extent, a little padded. Cells off the bedrock sheet are no-data. */
export const NI_BOUNDS = Object.freeze({ minX: -8.25, maxX: -5.35, minY: 53.98, maxY: 55.48 });

/** ~257 m east-west and ~278 m north-south at 54.7° N. */
export const DEFAULT_CELL = Object.freeze({ dLon: 0.004, dLat: 0.0025 });

/**
 * How readily each BGS superficial unit floods, 0–1, keyed by its LEX code.
 * A cell with no superficial cover is bedrock at or near surface (thin soil,
 * fast runoff, but not a floodplain).
 */
export const DEPOSIT_SCORE = Object.freeze({
  ALV: 1.0,    // alluvium: the floodplain itself
  LDE: 0.9,    // lacustrine deposits: old lake floors, flat and low
  RMD: 0.7,    // raised marine deposits: low coastal flats
  RTDU: 0.6,   // river terrace deposits: old floodplain, a step up
  PEAT: 0.55,  // saturated, slow to drain
  BSA: 0.4,    // blown sand
  GSG: 0.3,    // glacial sand and gravel: permeable
  TILL: 0.25,  // diamicton
  SLIP: 0.15,  // landslip: a slope
  UNKND: 0.2,
});
export const BEDROCK_SCORE = 0.2;

export const WEIGHTS = Object.freeze({
  noDem: { P: 0.45, D: 0.40, R: 0.15, H: 0 },
  dem: { P: 0.30, D: 0.30, R: 0.10, H: 0.30 },
});

export const PROXIMITY_M = 500;
export const HAND_SCALE_M = 4;

/** The grid for a box and cell size; rows run north to south. */
export function makeGrid(bounds = NI_BOUNDS, cell = DEFAULT_CELL) {
  const width = Math.max(1, Math.round((bounds.maxX - bounds.minX) / cell.dLon));
  const height = Math.max(1, Math.round((bounds.maxY - bounds.minY) / cell.dLat));
  const midLat = (bounds.minY + bounds.maxY) / 2;
  return {
    width, height,
    bounds: { ...bounds },
    dLon: (bounds.maxX - bounds.minX) / width,
    dLat: (bounds.maxY - bounds.minY) / height,
    // metres per cell, for the distance transform
    mx: ((bounds.maxX - bounds.minX) / width) * 111320 * Math.cos(midLat * Math.PI / 180),
    my: ((bounds.maxY - bounds.minY) / height) * 110574,
  };
}

/** Every polygon of a geometry as a list of rings, [[ [lon,lat], … ], …]. */
function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/**
 * Paint polygons onto the grid: `paint(index, feature)` for every cell whose
 * centre falls inside. Even-odd per polygon, so holes stay holes. Scanline by
 * edge: each edge visits only the rows it crosses.
 */
export function rasterisePolygons(features, grid, paint) {
  const { width, height, bounds, dLon, dLat } = grid;
  for (const feature of features || []) {
    for (const rings of polygonsOf(feature?.geometry)) {
      const rowsX = new Map();
      for (const ring of rings) {
        for (let k = 0; k < ring.length - 1; k += 1) {
          const [x0, y0] = ring[k];
          const [x1, y1] = ring[k + 1];
          if (y0 === y1) continue;
          const lo = Math.min(y0, y1);
          const hi = Math.max(y0, y1);
          // rows whose centre latitude c satisfies lo <= c < hi
          const rTop = Math.max(0, Math.ceil((bounds.maxY - hi) / dLat - 0.5));
          const rBot = Math.min(height - 1, Math.floor((bounds.maxY - lo) / dLat - 0.5));
          for (let r = rTop; r <= rBot; r += 1) {
            const c = bounds.maxY - (r + 0.5) * dLat;
            if (c < lo || c >= hi) continue;
            const x = x0 + ((c - y0) / (y1 - y0)) * (x1 - x0);
            let list = rowsX.get(r);
            if (!list) rowsX.set(r, (list = []));
            list.push(x);
          }
        }
      }
      for (const [r, xs] of rowsX) {
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const c0 = Math.max(0, Math.ceil((xs[i] - bounds.minX) / dLon - 0.5));
          const c1 = Math.min(width - 1, Math.floor((xs[i + 1] - bounds.minX) / dLon - 0.5));
          for (let col = c0; col <= c1; col += 1) paint(r * width + col, feature);
        }
      }
    }
  }
}

/** Mark every cell a line passes through (stepped at a third of a cell). */
export function rasteriseLines(features, grid, mark) {
  const { width, height, bounds, dLon, dLat } = grid;
  const visit = (lon, lat) => {
    const col = Math.floor((lon - bounds.minX) / dLon);
    const row = Math.floor((bounds.maxY - lat) / dLat);
    if (col >= 0 && col < width && row >= 0 && row < height) mark(row * width + col);
  };
  const lines = (g) => {
    if (!g) return [];
    if (g.type === "LineString") return [g.coordinates];
    if (g.type === "MultiLineString") return g.coordinates;
    return [];
  };
  for (const feature of features || []) {
    for (const line of lines(feature?.geometry)) {
      for (let k = 0; k < line.length - 1; k += 1) {
        const [x0, y0] = line[k];
        const [x1, y1] = line[k + 1];
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0) / dLon, Math.abs(y1 - y0) / dLat) * 3));
        for (let s = 0; s <= steps; s += 1) visit(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
      }
      if (line.length === 1) visit(line[0][0], line[0][1]);
    }
  }
}

/**
 * Distance in metres from every cell to the nearest source cell, and WHICH
 * source that was — a two-pass chamfer with the grid's own anisotropic steps.
 * Returns { dist, nearest } (nearest = −1 where there is no source at all).
 */
export function distanceTransform(sources, grid) {
  const { width, height, mx, my } = grid;
  const md = Math.hypot(mx, my);
  const n = width * height;
  const dist = new Float64Array(n).fill(Infinity);
  const nearest = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i += 1) if (sources[i]) { dist[i] = 0; nearest[i] = i; }
  const relax = (i, j, w) => {
    const d = dist[j] + w;
    if (d < dist[i]) { dist[i] = d; nearest[i] = nearest[j]; }
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x > 0) relax(i, i - 1, mx);
      if (y > 0) {
        relax(i, i - width, my);
        if (x > 0) relax(i, i - width - 1, md);
        if (x < width - 1) relax(i, i - width + 1, md);
      }
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (x < width - 1) relax(i, i + 1, mx);
      if (y < height - 1) {
        relax(i, i + width, my);
        if (x < width - 1) relax(i, i + width + 1, md);
        if (x > 0) relax(i, i + width - 1, md);
      }
    }
  }
  return { dist, nearest };
}

/** Quantile breaks over the finite values, into `classes` ranks 1..classes. */
export function rankByQuantile(values, classes = 5) {
  const finite = [];
  for (const v of values) if (Number.isFinite(v)) finite.push(v);
  finite.sort((a, b) => a - b);
  const out = new Float32Array(values.length).fill(NaN);
  if (!finite.length) return { ranked: out, breaks: [] };
  const breaks = [];
  for (let k = 1; k < classes; k += 1) breaks.push(finite[Math.min(finite.length - 1, Math.floor((k / classes) * finite.length))]);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    let c = 1;
    while (c < classes && v > breaks[c - 1]) c += 1;
    out[i] = c;
  }
  return { ranked: out, breaks };
}

/**
 * The whole model. Inputs are FeatureCollections (or feature arrays):
 * `land` (the bedrock sheet: the mask), `superficial`, `rainfall`, `rivers`.
 * `heightAt(lat, lon)` is optional; where it answers, HAND joins the overlay.
 *
 * Returns { band (ranks 1–5, NaN off land), score (0–1), width, height,
 * bounds, noData: NaN, stats }.
 */
export function computeFloodSusceptibility(inputs, {
  bounds = NI_BOUNDS, cell = DEFAULT_CELL, heightAt = null, classes = 5,
} = {}) {
  const feats = (fc) => (Array.isArray(fc) ? fc : fc?.features || []);
  const grid = makeGrid(bounds, cell);
  const { width, height } = grid;
  const n = width * height;

  const land = new Uint8Array(n);
  rasterisePolygons(feats(inputs.land), grid, (i) => { land[i] = 1; });

  const deposit = new Float32Array(n).fill(BEDROCK_SCORE);
  rasterisePolygons(feats(inputs.superficial), grid, (i, f) => {
    const lex = String(f?.properties?.lex || f?.properties?.LEX || "").trim().toUpperCase();
    const s = DEPOSIT_SCORE[lex];
    if (Number.isFinite(s)) deposit[i] = Math.max(deposit[i] === BEDROCK_SCORE ? 0 : deposit[i], s);
  });

  const rain = new Float32Array(n).fill(NaN);
  let prMin = Infinity;
  let prMax = -Infinity;
  rasterisePolygons(feats(inputs.rainfall), grid, (i, f) => {
    const pr = Number(f?.properties?.pr);
    if (!Number.isFinite(pr)) return;
    rain[i] = pr;
    if (pr < prMin) prMin = pr;
    if (pr > prMax) prMax = pr;
  });
  const prSpan = prMax > prMin ? prMax - prMin : 1;
  // A land cell the rainfall grid's squares miss (the coast's ragged edge)
  // takes the grid's middle rather than zero.
  const prMid = Number.isFinite(prMin) ? (prMin + prMax) / 2 : NaN;

  const river = new Uint8Array(n);
  rasteriseLines(feats(inputs.rivers), grid, (i) => { river[i] = 1; });
  let riverCells = 0;
  for (let i = 0; i < n; i += 1) riverCells += river[i];
  const { dist, nearest } = distanceTransform(river, grid);

  // Heights only where the DEM answers; HAND only where both ends have one.
  let heights = null;
  let demCells = 0;
  if (typeof heightAt === "function") {
    heights = new Float32Array(n).fill(NaN);
    for (let r = 0; r < height; r += 1) {
      const lat = bounds.maxY - (r + 0.5) * grid.dLat;
      for (let c = 0; c < width; c += 1) {
        const i = r * width + c;
        if (!land[i] && !river[i]) continue;
        const h = heightAt(lat, bounds.minX + (c + 0.5) * grid.dLon);
        if (Number.isFinite(h)) { heights[i] = h; if (land[i]) demCells += 1; }
      }
    }
  }

  const score = new Float32Array(n).fill(NaN);
  let landCells = 0;
  for (let i = 0; i < n; i += 1) {
    if (!land[i]) continue;
    landCells += 1;
    const P = Number.isFinite(dist[i]) ? Math.exp(-dist[i] / PROXIMITY_M) : 0;
    const D = deposit[i];
    const pr = Number.isFinite(rain[i]) ? rain[i] : prMid;
    const R = Number.isFinite(pr) && Number.isFinite(prMin) ? Math.min(1, Math.max(0, (pr - prMin) / prSpan)) : 0.5;
    let hand = NaN;
    if (heights && nearest[i] >= 0) hand = heights[i] - heights[nearest[i]];
    if (Number.isFinite(hand)) {
      const H = Math.exp(-Math.max(0, hand) / HAND_SCALE_M);
      const w = WEIGHTS.dem;
      score[i] = w.P * P + w.D * D + w.R * R + w.H * H;
    } else {
      const w = WEIGHTS.noDem;
      score[i] = w.P * P + w.D * D + w.R * R;
    }
  }

  const { ranked, breaks } = rankByQuantile(score, classes);
  return {
    band: ranked,
    score,
    width,
    height,
    bounds: { ...bounds },
    noData: NaN,
    stats: { landCells, riverCells, demCells, breaks, prMin, prMax, cellM: [Math.round(grid.mx), Math.round(grid.my)] },
  };
}

/* ───────────────────────── in the browser ───────────────────────────── */

export const INPUT_PATHS = Object.freeze({
  land: "/ni-prototype/data/ni_bedrock.geojson",
  superficial: "/ni-prototype/data/ni_superficial.geojson",
  rainfall: "/ni-prototype/data/ni_rainfall.geojson",
  rivers: "/ni-prototype/data/ni_rivers.geojson",
});

/**
 * Fetch the shipped inputs, try the streamed DEM (it is optional and may be
 * unreachable offline), compute, and return the map as GeoTIFF bytes.
 * Throws with a readable message when an input cannot be read.
 */
export async function buildFloodGeoTiff({ onProgress = () => {}, fetchImpl = fetch, demTimeoutMs = 15000 } = {}) {
  onProgress("Reading the prototype's inputs (geology, rainfall, rivers)…");
  const entries = await Promise.all(Object.entries(INPUT_PATHS).map(async ([key, path]) => {
    const response = await fetchImpl(path);
    if (!response.ok) throw new Error(`${path.split("/").pop()}: HTTP ${response.status}`);
    try {
      return [key, await response.json()];
    } catch {
      throw new Error(`${path.split("/").pop()} is not valid GeoJSON`);
    }
  }));
  const inputs = Object.fromEntries(entries);

  let heightAt = null;
  let demNote = "no DEM (streamed elevation unreachable), so terrain is not in the score";
  try {
    onProgress("Asking for streamed elevation over Northern Ireland…");
    const dem = await import("./dem-tiles.js?v=20261024-5fec71f");
    const box = { west: NI_BOUNDS.minX, east: NI_BOUNDS.maxX, south: NI_BOUNDS.minY, north: NI_BOUNDS.maxY };
    const result = await Promise.race([
      dem.ensure(box),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "timeout" }), demTimeoutMs)),
    ]);
    if (result?.ok) {
      heightAt = dem.heightAt;
      demNote = "height above the nearest river from the streamed DEM";
    }
  } catch (error) {
    console.warn("[GeoID flood] streamed DEM unavailable:", error?.message || error);
  }

  onProgress("Computing flood susceptibility…");
  // Let the status paint before the main thread is busy.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const grid = computeFloodSusceptibility(inputs, { heightAt });
  if (!grid.stats.landCells) throw new Error("the land mask came out empty");
  if (!grid.stats.riverCells) throw new Error("no rivers fell inside the grid");
  if (heightAt && !grid.stats.demCells) demNote = "no DEM cells held over NI, so terrain is not in the score";

  const { writeGeoTiff } = await import("./geotiff-writer.js?v=20261024-5fec71f");
  const bytes = writeGeoTiff({ band: grid.band, width: grid.width, height: grid.height, bounds: grid.bounds, noData: NaN });
  return { bytes, grid, demNote };
}
