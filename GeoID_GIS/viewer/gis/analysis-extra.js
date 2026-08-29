/**
 * The four raster functions the hazard work actually needs and did not have.
 *
 * - **TWI**, the topographic wetness index. `slope` and `flowAccumulation` were
 *   both here and the composite that flood and landslide methods actually use
 *   was not, so every recipe had to reinvent it — and the two easy ways to get
 *   it wrong (a zero-slope divide, and mixing cell counts with cell areas) are
 *   exactly the kind of thing a recipe reinvents differently each time.
 * - **Mosaic**, because a DEM download arrives as tiles. Without it the first
 *   step of every real job is done outside the GIS.
 * - **Kernel density**, because an inventory is a scatter of points and a model
 *   wants a surface. It is also how an events layer becomes a validation
 *   target.
 * - **Histogram**, because "what is in this raster" is the first question asked
 *   of every layer and the answer was only ever a min and a max in the legend.
 */

import { makeRaster, cellSizeMetres } from "./raster-analysis.js?v=20260829-9a71f0d";

/* ── topographic wetness index ──────────────────────────────────────────── */

/**
 * `ln(a / tan β)` — upslope area per unit contour length over the local slope.
 *
 * `accumulation` is a flow-accumulation raster in CELLS, `slopeRaster` in
 * degrees, and both must share a grid. Two guards carry the whole numerical
 * behaviour:
 *
 * - **a flat cell has infinite wetness on paper.** tan(0) is 0 and the index
 *   diverges, so slope is floored at a small angle (0.1° ≈ 0.0017) — the
 *   standard treatment, and the reason a TWI map has a ceiling rather than a
 *   scatter of infinities through every valley floor.
 * - **`a` is an AREA per unit width, not a count.** Multiplying the cell count
 *   by the cell area and dividing by the cell width is what makes the number
 *   comparable between a 10 m and a 100 m grid; skipping it shifts every value
 *   by ln(cell size) and quietly makes two runs incomparable.
 */
export function topographicWetness(accumulation, slopeRaster, { minSlopeDeg = 0.1 } = {}) {
  const width = accumulation.width;
  const height = accumulation.height;
  if (slopeRaster.width !== width || slopeRaster.height !== height) {
    return { ok: false, message: "the accumulation and slope grids are different shapes" };
  }
  const cell = cellSizeMetres(accumulation);
  const cellArea = cell.x * cell.y;
  const contourWidth = (cell.x + cell.y) / 2;
  const floor = Math.tan((minSlopeDeg * Math.PI) / 180);
  const out = new Float32Array(width * height).fill(NaN);
  for (let i = 0; i < out.length; i += 1) {
    const cells = accumulation.band[i];
    const deg = slopeRaster.band[i];
    if (!Number.isFinite(cells) || !Number.isFinite(deg)) continue;
    // One cell drains itself, so an upslope area of zero is not possible.
    const a = (Math.max(1, cells) * cellArea) / contourWidth;
    const tanBeta = Math.max(floor, Math.tan((deg * Math.PI) / 180));
    out[i] = Math.log(a / tanBeta);
  }
  return { ok: true, raster: makeRaster(out, width, height, accumulation.bounds, NaN) };
}

/* ── mosaic ─────────────────────────────────────────────────────────────── */

/**
 * Several rasters into one grid covering all of them.
 *
 * Resolution is the FINEST of the inputs, so mosaicking never silently throws
 * detail away; the output can be large, which is the honest cost of that and is
 * reported rather than hidden. Overlaps take the first non-null by input order
 * unless `method` says otherwise — "first" is what a user means by putting a
 * layer on top, and mean is what they mean when the tiles are repeat surveys.
 */
export function mosaic(rasters, { method = "first", maxCells = 4_000_000 } = {}) {
  const list = (rasters || []).filter((r) => r?.band && r.width && r.height);
  if (!list.length) return { ok: false, message: "no rasters to merge" };
  if (list.length === 1) return { ok: true, raster: list[0], message: "one raster: nothing to merge" };

  const bounds = list.reduce((acc, r) => ({
    minX: Math.min(acc.minX, r.bounds.minX), minY: Math.min(acc.minY, r.bounds.minY),
    maxX: Math.max(acc.maxX, r.bounds.maxX), maxY: Math.max(acc.maxY, r.bounds.maxY),
  }), { ...list[0].bounds });

  const finestX = Math.min(...list.map((r) => (r.bounds.maxX - r.bounds.minX) / r.width));
  const finestY = Math.min(...list.map((r) => (r.bounds.maxY - r.bounds.minY) / r.height));
  let width = Math.max(1, Math.round((bounds.maxX - bounds.minX) / finestX));
  let height = Math.max(1, Math.round((bounds.maxY - bounds.minY) / finestY));
  let note = "";
  if (width * height > maxCells) {
    // Coarsen rather than refuse: a merged overview is worth more than an
    // error, and saying by how much keeps it honest.
    const scale = Math.sqrt(maxCells / (width * height));
    const before = `${width}x${height}`;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    note = ` Coarsened from ${before} to fit ${maxCells.toLocaleString()} cells.`;
  }

  const out = new Float32Array(width * height).fill(NaN);
  const counts = method === "mean" ? new Float32Array(width * height) : null;
  const sums = method === "mean" ? new Float32Array(width * height) : null;

  for (const raster of list) {
    const rw = raster.width;
    const rh = raster.height;
    const noData = raster.noData;
    for (let y = 0; y < height; y += 1) {
      // Cell centres, so a mosaic of two halves has no seam of half a cell.
      const lat = bounds.maxY - ((y + 0.5) / height) * (bounds.maxY - bounds.minY);
      if (lat > raster.bounds.maxY || lat < raster.bounds.minY) continue;
      const sy = Math.min(rh - 1, Math.max(0, Math.floor(
        ((raster.bounds.maxY - lat) / (raster.bounds.maxY - raster.bounds.minY)) * rh)));
      for (let x = 0; x < width; x += 1) {
        const lon = bounds.minX + ((x + 0.5) / width) * (bounds.maxX - bounds.minX);
        if (lon < raster.bounds.minX || lon > raster.bounds.maxX) continue;
        const sx = Math.min(rw - 1, Math.max(0, Math.floor(
          ((lon - raster.bounds.minX) / (raster.bounds.maxX - raster.bounds.minX)) * rw)));
        const v = raster.band[sy * rw + sx];
        if (!Number.isFinite(v) || (noData != null && v === noData)) continue;
        const at = y * width + x;
        if (method === "mean") { sums[at] += v; counts[at] += 1; }
        else if (method === "last") out[at] = v;
        else if (method === "max") out[at] = Number.isFinite(out[at]) ? Math.max(out[at], v) : v;
        else if (method === "min") out[at] = Number.isFinite(out[at]) ? Math.min(out[at], v) : v;
        else if (!Number.isFinite(out[at])) out[at] = v;      // "first"
      }
    }
  }
  if (method === "mean") {
    for (let i = 0; i < out.length; i += 1) out[i] = counts[i] ? sums[i] / counts[i] : NaN;
  }
  const filled = out.reduce((n, v) => (Number.isFinite(v) ? n + 1 : n), 0);
  return {
    ok: true,
    raster: makeRaster(out, width, height, bounds, NaN),
    message: `${list.length} rasters merged into ${width}x${height}; `
      + `${((filled / out.length) * 100).toFixed(1)}% of the box has data.${note}`,
  };
}

/* ── kernel density ─────────────────────────────────────────────────────── */

/**
 * Points to a surface, with a quartic (Epanechnikov-like) kernel — the one
 * ArcGIS and QGIS both use, so a density map made here is comparable with one
 * made there.
 *
 * The output is per square kilometre, not per cell: a density that changes when
 * you change the grid size is not a density, and that is the mistake worth
 * writing down.
 */
export function kernelDensity(points, bounds, {
  cellSizeDeg = 0.01, radiusKm = 5, weightField = null,
} = {}) {
  const list = (points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (!list.length) return { ok: false, message: "no points to spread" };
  const width = Math.max(1, Math.round((bounds.maxX - bounds.minX) / cellSizeDeg));
  const height = Math.max(1, Math.round((bounds.maxY - bounds.minY) / cellSizeDeg));
  if (width * height > 4_000_000) {
    return { ok: false, message: `that cell size needs ${width * height} cells — use a coarser one` };
  }
  const out = new Float32Array(width * height);
  const midLat = (bounds.minY + bounds.maxY) / 2;
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos((midLat * Math.PI) / 180);
  const rLat = radiusKm / kmPerDegLat;
  const rLon = radiusKm / Math.max(1e-6, kmPerDegLon);

  list.forEach((point) => {
    const weight = weightField && Number.isFinite(point[weightField]) ? point[weightField] : 1;
    const x0 = Math.max(0, Math.floor(((point.lon - rLon - bounds.minX) / (bounds.maxX - bounds.minX)) * width));
    const x1 = Math.min(width - 1, Math.ceil(((point.lon + rLon - bounds.minX) / (bounds.maxX - bounds.minX)) * width));
    const y0 = Math.max(0, Math.floor(((bounds.maxY - (point.lat + rLat)) / (bounds.maxY - bounds.minY)) * height));
    const y1 = Math.min(height - 1, Math.ceil(((bounds.maxY - (point.lat - rLat)) / (bounds.maxY - bounds.minY)) * height));
    for (let y = y0; y <= y1; y += 1) {
      const lat = bounds.maxY - ((y + 0.5) / height) * (bounds.maxY - bounds.minY);
      for (let x = x0; x <= x1; x += 1) {
        const lon = bounds.minX + ((x + 0.5) / width) * (bounds.maxX - bounds.minX);
        const dLatKm = (lat - point.lat) * kmPerDegLat;
        const dLonKm = (lon - point.lon) * kmPerDegLon;
        const d = Math.sqrt(dLatKm * dLatKm + dLonKm * dLonKm);
        if (d >= radiusKm) continue;
        const u = 1 - (d / radiusKm) ** 2;
        // Quartic kernel normalised so it integrates to the weight: 3/(πr²).
        out[y * width + x] += weight * ((3 / (Math.PI * radiusKm * radiusKm)) * u * u);
      }
    }
  });
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) if (out[i] > peak) peak = out[i];
  return {
    ok: true,
    raster: makeRaster(out, width, height, bounds, null),
    message: `${list.length} points spread over ${width}x${height} cells, `
      + `peak ${peak.toFixed(3)} per km2 at a ${radiusKm} km radius.`,
  };
}

/* ── histogram ──────────────────────────────────────────────────────────── */

/** Counts per bin, plus the summary statistics the legend never showed. */
export function histogram(values, { bins = 20, min = null, max = null } = {}) {
  const list = (values || []).filter(Number.isFinite);
  if (!list.length) return { ok: false, message: "nothing to count" };
  const lo = min == null ? Math.min(...list) : min;
  const hi = max == null ? Math.max(...list) : max;
  if (hi === lo) {
    return {
      ok: true, bins: [{ from: lo, to: hi, count: list.length, fraction: 1 }],
      min: lo, max: hi, mean: lo, median: lo, stdDev: 0, count: list.length,
      message: `every one of ${list.length} cells is ${lo}`,
    };
  }
  const width = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  list.forEach((v) => {
    if (v < lo || v > hi) return;
    // The top edge belongs to the last bin, or the maximum falls out of the
    // histogram entirely and the counts do not sum to the sample.
    const index = v === hi ? bins - 1 : Math.floor((v - lo) / width);
    counts[index] += 1;
  });
  const sorted = list.slice().sort((a, b) => a - b);
  const mean = list.reduce((s, v) => s + v, 0) / list.length;
  const variance = list.reduce((s, v) => s + (v - mean) ** 2, 0) / list.length;
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return {
    ok: true,
    bins: counts.map((count, i) => ({
      from: Number((lo + i * width).toFixed(6)),
      to: Number((lo + (i + 1) * width).toFixed(6)),
      count,
      fraction: Number((count / list.length).toFixed(6)),
    })),
    count: list.length,
    min: lo, max: hi,
    mean: Number(mean.toFixed(6)),
    median: Number(median.toFixed(6)),
    stdDev: Number(Math.sqrt(variance).toFixed(6)),
    message: `${list.length} values, ${lo} to ${hi}, mean ${mean.toFixed(3)}`,
  };
}

/** Points out of a vector collection, for the density tool. */
export function pointsOf(collection) {
  const out = [];
  (collection?.features || []).forEach((feature) => {
    const geometry = feature?.geometry;
    if (!geometry) return;
    const push = (c) => { if (Number.isFinite(c?.[0])) out.push({ lon: c[0], lat: c[1], ...feature.properties }); };
    if (geometry.type === "Point") push(geometry.coordinates);
    else if (geometry.type === "MultiPoint") geometry.coordinates.forEach(push);
    else if (geometry.type === "Polygon") {
      // A polygon inventory is still an inventory; its centroid is where the
      // thing is. Refusing polygons would make the tool useless on the layers
      // people actually hold.
      const ring = geometry.coordinates?.[0] || [];
      if (ring.length) {
        const n = ring.length;
        push([ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]);
      }
    }
  });
  return out;
}

if (typeof window !== "undefined") {
  window.GeoIDAnalysisExtra = { topographicWetness, mosaic, kernelDensity, histogram, pointsOf };
}
