/**
 * Hydrology in the browser, so no tool in the catalogue needs a second process.
 *
 * These five were sidecar-only, which meant the toolbox advertised them with a
 * chip saying they would not run — a list of things you cannot do. Each is a
 * well-defined grid algorithm; none of them needs GDAL, and the reason they
 * were deferred was effort, not capability.
 *
 * The sidecar still exists for what a browser genuinely cannot do: run a
 * solver, hold a secret, write outside the sandbox. Nothing in this file is
 * one of those.
 */

import { makeRaster, cellSizeMetres } from "./raster-analysis.js?v=20260826-9c40c2e";

/* A binary heap keyed on elevation. Priority-flood is O(n log n) with one and
   O(n²) without, which on a 1800×1400 DEM is the difference between a second
   and a coffee. */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].key <= this.items[i].key) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < this.items.length && this.items[l].key < this.items[small].key) small = l;
        if (r < this.items.length && this.items[r].key < this.items[small].key) small = r;
        if (small === i) break;
        [this.items[small], this.items[i]] = [this.items[i], this.items[small]];
        i = small;
      }
    }
    return top;
  }
}

const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function isData(v, noData) {
  return Number.isFinite(v) && !(noData != null && Number.isFinite(noData) && v === noData);
}

/**
 * Priority-flood depression filling (Barnes et al.).
 *
 * Water cannot leave a closed hollow, so every flow calculation stalls in one;
 * filling raises each hollow to the lowest point on its rim. `epsilon` adds a
 * whisker of gradient across the filled surface, without which a flat filled
 * lake has no downhill direction at all and the flow routing below it splits
 * arbitrarily.
 */
export function fillSinks(raster, { epsilon = 1e-4 } = {}) {
  const { width, height, band, noData } = raster;
  const out = new Float32Array(width * height).fill(NaN);
  const done = new Uint8Array(width * height);
  const heap = new MinHeap();

  // Seed from the edge and from the boundary with no-data: those are where
  // water leaves the grid.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!isData(band[i], noData)) { done[i] = 1; continue; }
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const besideGap = !edge && NEIGHBOURS.some(([dx, dy]) =>
        !isData(band[(y + dy) * width + (x + dx)], noData));
      if (edge || besideGap) {
        out[i] = band[i];
        done[i] = 1;
        heap.push({ key: band[i], x, y });
      }
    }
  }

  while (heap.size) {
    const cell = heap.pop();
    for (const [dx, dy] of NEIGHBOURS) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = y * width + x;
      if (done[i]) continue;
      // The filled height is whichever is higher: the ground, or just above
      // the lowest rim reached so far.
      out[i] = Math.max(band[i], cell.key + epsilon);
      done[i] = 1;
      heap.push({ key: out[i], x, y });
    }
  }
  return makeRaster(out, width, height, raster.bounds, NaN);
}

/** D8 flow direction as a neighbour index (0–7), or −1 where water leaves. */
export function flowDirection(raster) {
  const { width, height, band, noData } = raster;
  const dir = new Int8Array(width * height).fill(-1);
  const cell = cellSizeMetres(raster);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!isData(band[i], noData)) continue;
      let best = 0;
      let bestAt = -1;
      NEIGHBOURS.forEach(([dx, dy], n) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const j = ny * width + nx;
        if (!isData(band[j], noData)) return;
        // Steepest DESCENT per unit distance, so a diagonal does not win on
        // drop alone: it is 1.41 cells away and must fall proportionally more.
        const run = Math.hypot(dx * cell.x, dy * cell.y);
        const drop = (band[i] - band[j]) / run;
        if (drop > best) { best = drop; bestAt = n; }
      });
      dir[i] = bestAt;
    }
  }
  return { dir, width, height };
}

/**
 * How many cells drain through each cell.
 *
 * Cells are processed from high to low, so every contributor is counted before
 * the cell it flows into — no recursion, and no risk of a cycle in a filled
 * surface.
 */
export function flowAccumulation(raster, { filled = null } = {}) {
  const dem = filled || fillSinks(raster);
  const { width, height, band, noData } = dem;
  const { dir } = flowDirection(dem);
  const order = [];
  for (let i = 0; i < band.length; i += 1) if (isData(band[i], noData)) order.push(i);
  order.sort((a, b) => band[b] - band[a]);
  const acc = new Float32Array(width * height).fill(NaN);
  order.forEach((i) => { acc[i] = 1; });
  order.forEach((i) => {
    const n = dir[i];
    if (n < 0) return;
    const [dx, dy] = NEIGHBOURS[n];
    const j = (Math.floor(i / width) + dy) * width + ((i % width) + dx);
    if (Number.isFinite(acc[j])) acc[j] += acc[i];
  });
  return makeRaster(acc, width, height, raster.bounds, NaN);
}

/** Everything that drains to one cell: 1 inside the catchment, NaN outside. */
export function watershed(raster, lat, lon, { filled = null } = {}) {
  const dem = filled || fillSinks(raster);
  const { width, height, bounds } = dem;
  const x = Math.min(width - 1, Math.max(0, Math.floor(
    ((lon - bounds.minX) / (bounds.maxX - bounds.minX)) * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(
    ((bounds.maxY - lat) / (bounds.maxY - bounds.minY)) * height)));
  if (lat < bounds.minY || lat > bounds.maxY || lon < bounds.minX || lon > bounds.maxX) {
    return { ok: false, message: "that outlet is outside the DEM" };
  }
  const { dir } = flowDirection(dem);
  const out = new Float32Array(width * height).fill(NaN);
  const outlet = y * width + x;
  out[outlet] = 1;
  // Walk upstream: a cell belongs if the cell it flows into already belongs.
  // One pass over the height-sorted order does it, low to high.
  const order = [];
  for (let i = 0; i < dem.band.length; i += 1) if (Number.isFinite(dem.band[i])) order.push(i);
  order.sort((a, b) => dem.band[a] - dem.band[b]);
  order.forEach((i) => {
    if (Number.isFinite(out[i])) return;
    const n = dir[i];
    if (n < 0) return;
    const [dx, dy] = NEIGHBOURS[n];
    const j = (Math.floor(i / width) + dy) * width + ((i % width) + dx);
    if (Number.isFinite(out[j])) out[i] = 1;
  });
  const cells = out.reduce((s, v) => (Number.isFinite(v) ? s + 1 : s), 0);
  const cell = cellSizeMetres(dem);
  return {
    ok: true,
    raster: makeRaster(out, width, height, bounds, NaN),
    cells,
    areaKm2: Number(((cells * cell.x * cell.y) / 1e6).toFixed(3)),
  };
}

/** Cells whose accumulation passes a threshold — the channel network. */
export function streams(accumulation, { threshold = 500 } = {}) {
  const { width, height, band, bounds } = accumulation;
  const out = new Float32Array(width * height).fill(NaN);
  let count = 0;
  for (let i = 0; i < band.length; i += 1) {
    if (Number.isFinite(band[i]) && band[i] >= threshold) { out[i] = band[i]; count += 1; }
  }
  return { raster: makeRaster(out, width, height, bounds, NaN), count };
}

/**
 * What an observer can see: 1 visible, 0 hidden.
 *
 * Rays are cast to every cell on the boundary of the search radius and the
 * horizon angle is carried along each one, which is the standard R3 sweep —
 * far cheaper than a line of sight per cell and the same answer to within a
 * cell's width.
 */
export function viewshed(raster, lat, lon, {
  observerHeight = 1.7, targetHeight = 0, radiusKm = 10,
} = {}) {
  const { width, height, band, bounds, noData } = raster;
  if (lat < bounds.minY || lat > bounds.maxY || lon < bounds.minX || lon > bounds.maxX) {
    return { ok: false, message: "the observer is outside the DEM" };
  }
  const cell = cellSizeMetres(raster);
  const ox = Math.min(width - 1, Math.max(0, Math.floor(
    ((lon - bounds.minX) / (bounds.maxX - bounds.minX)) * width)));
  const oy = Math.min(height - 1, Math.max(0, Math.floor(
    ((bounds.maxY - lat) / (bounds.maxY - bounds.minY)) * height)));
  const base = band[oy * width + ox];
  if (!isData(base, noData)) return { ok: false, message: "the observer is on a no-data cell" };
  const eye = base + observerHeight;
  const out = new Float32Array(width * height).fill(NaN);
  const maxCells = Math.max(1, Math.round((radiusKm * 1000) / Math.min(cell.x, cell.y)));

  const ring = [];
  for (let x = ox - maxCells; x <= ox + maxCells; x += 1) {
    ring.push([x, oy - maxCells]); ring.push([x, oy + maxCells]);
  }
  for (let y = oy - maxCells; y <= oy + maxCells; y += 1) {
    ring.push([ox - maxCells, y]); ring.push([ox + maxCells, y]);
  }

  out[oy * width + ox] = 1;
  ring.forEach(([tx, ty]) => {
    const steps = Math.max(Math.abs(tx - ox), Math.abs(ty - oy));
    let horizon = -Infinity;
    for (let s = 1; s <= steps; s += 1) {
      const x = Math.round(ox + ((tx - ox) * s) / steps);
      const y = Math.round(oy + ((ty - oy) * s) / steps);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      const i = y * width + x;
      const v = band[i];
      if (!isData(v, noData)) continue;
      const dist = Math.hypot((x - ox) * cell.x, (y - oy) * cell.y);
      if (dist > radiusKm * 1000) break;
      const angle = (v + targetHeight - eye) / Math.max(1e-6, dist);
      if (angle > horizon) { horizon = angle; out[i] = 1; }
      else if (!Number.isFinite(out[i])) out[i] = 0;
    }
  });
  const seen = out.reduce((s, v) => (v === 1 ? s + 1 : s), 0);
  return {
    ok: true,
    raster: makeRaster(out, width, height, bounds, NaN),
    visibleCells: seen,
    visibleKm2: Number(((seen * cell.x * cell.y) / 1e6).toFixed(3)),
  };
}

if (typeof window !== "undefined") {
  window.GeoIDHydrology = { fillSinks, flowDirection, flowAccumulation, watershed, streams, viewshed };
}
