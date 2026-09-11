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

import { makeRaster, cellSizeMetres } from "./raster-analysis.js?v=20260911-57f9875";

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
  const n = width * height;
  const out = new Float32Array(n).fill(NaN);
  const done = new Uint8Array(n);
  /**
   * A heap on TYPED ARRAYS. Each cell enters it once, so its capacity is the
   * grid; an object per entry was two million allocations on a landslide
   * model mapped at the DEM's own posts, and most of the time spent filling.
   */
  const key = new Float64Array(n);
  const idx = new Int32Array(n);
  let size = 0;
  const push = (k, i) => {
    let c = size; size += 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (key[p] <= k) break;
      key[c] = key[p]; idx[c] = idx[p]; c = p;
    }
    key[c] = k; idx[c] = i;
  };
  const pop = () => {
    const top = idx[0]; const topKey = key[0];
    size -= 1;
    if (size > 0) {
      const k = key[size]; const i = idx[size];
      let c = 0;
      for (;;) {
        const l = 2 * c + 1; if (l >= size) break;
        const r = l + 1;
        const m = r < size && key[r] < key[l] ? r : l;
        if (key[m] >= k) break;
        key[c] = key[m]; idx[c] = idx[m]; c = m;
      }
      key[c] = k; idx[c] = i;
    }
    popped.key = topKey; popped.i = top;
    return popped;
  };
  const popped = { key: 0, i: 0 };

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
        push(band[i], i);
      }
    }
  }

  while (size) {
    const { key: k, i: ci } = pop();
    const cx = ci % width; const cy = (ci - cx) / width;
    for (let q = 0; q < 8; q += 1) {
      const x = cx + NEIGHBOURS[q][0];
      const y = cy + NEIGHBOURS[q][1];
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = y * width + x;
      if (done[i]) continue;
      // The filled height is whichever is higher: the ground, or just above
      // the lowest rim reached so far.
      out[i] = Math.max(band[i], k + epsilon);
      done[i] = 1;
      push(out[i], i);
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

/**
 * MULTIPLE FLOW DIRECTION routing (Quinn et al. 1991, Freeman 1991): each cell
 * passes its flow to EVERY lower neighbour in proportion to (tan β)^p times the
 * contour length it shares with it (half a cell for a side, 0.354 for a
 * corner). D8 sends everything one way, which is right in a channel and wrong
 * on a hillslope, where water spreads — and the spreading is exactly what
 * separates a convex nose from the hollow beside it. Freeman's p = 1.1.
 *
 * Built ONCE per DEM as flat arrays (a high-to-low order, up to eight
 * receivers and fractions per cell) so that routing a new recharge field — one
 * per rainfall map — is a single linear pass with no sort and no allocation.
 * `raster` should be sink-filled, or flow stops in every hollow.
 */
export function mfdTopology(raster, { exponent = 1.1 } = {}) {
  const { width, height, band, noData } = raster;
  const n = width * height;
  const cell = cellSizeMetres(raster);
  let count = 0;
  for (let i = 0; i < n; i += 1) if (isData(band[i], noData)) count += 1;
  const order = new Int32Array(count);
  for (let i = 0, k = 0; i < n; i += 1) if (isData(band[i], noData)) { order[k] = i; k += 1; }
  order.sort((a, b) => band[b] - band[a]);
  const side = Math.sqrt(cell.x * cell.y);
  const runs = NEIGHBOURS.map(([dx, dy]) => Math.hypot(dx * cell.x, dy * cell.y));
  const contours = NEIGHBOURS.map(([dx, dy]) => (dx && dy ? 0.354 : 0.5) * side);
  // Compressed rows: a cell's receivers are recv[offsets[i] .. offsets[i+1]).
  // Eight slots a cell was 128 MB at two million cells for about three used.
  const offsets = new Int32Array(n + 1);
  let recv = new Int32Array(Math.max(16, count * 4));
  let frac = new Float32Array(recv.length);
  const w = new Float64Array(8); const j8 = new Int32Array(8);
  let used = 0; let outlets = 0; let last = 0;
  for (let i = 0; i < n; i += 1) {
    offsets[i] = used;
    if (!isData(band[i], noData)) continue;
    const x = i % width; const y = (i - x) / width;
    let total = 0; let m = 0;
    for (let q = 0; q < 8; q += 1) {
      const nx = x + NEIGHBOURS[q][0]; const ny = y + NEIGHBOURS[q][1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (!isData(band[j], noData)) continue;
      const tan = (band[i] - band[j]) / runs[q];
      if (!(tan > 0)) continue;
      const weight = (tan ** exponent) * contours[q];
      j8[m] = j; w[m] = weight; total += weight; m += 1;
    }
    if (!m) { outlets += 1; continue; }
    if (used + m > recv.length) {
      const grow = (a, T) => { const b = new T(Math.ceil(a.length * 1.5) + 8); b.set(a); return b; };
      recv = grow(recv, Int32Array); frac = grow(frac, Float32Array);
    }
    for (let k = 0; k < m; k += 1) { recv[used] = j8[k]; frac[used] = w[k] / total; used += 1; }
    last = i;
  }
  offsets[n] = used;
  return {
    order, offsets, recv: recv.subarray(0, used), frac: frac.subarray(0, used), width, height,
    cellArea: cell.x * cell.y, contour: side, outlets, last,
  };
}

/**
 * Route a per-cell source (m³/s, or any additive quantity) down the topology:
 * each cell's total is its own source plus everything routed into it. Linear
 * in the cells; the result is a Float64Array so a large catchment's sum does
 * not lose its small contributions.
 */
export function routeFlux(topo, source, { inPlace = false } = {}) {
  // In place when asked: a caller routing a new source every rainfall map
  // over two million cells would otherwise throw away 16 MB a map.
  const acc = inPlace && source instanceof Float64Array ? source
    : Float64Array.from(source, (v) => (Number.isFinite(v) ? v : 0));
  const { order, offsets, recv, frac } = topo;
  for (let o = 0; o < order.length; o += 1) {
    const i = order[o];
    const a = acc[i];
    if (!a) continue;
    for (let k = offsets[i], e = offsets[i + 1]; k < e; k += 1) acc[recv[k]] += a * frac[k];
  }
  return acc;
}

/** Everything that drains to one cell: 1 inside the catchment, NaN outside. */
export function watershed(raster, lat, lon, { filled = null } = {}) {
  const dem = filled || fillSinks(raster);
  const { width, height, bounds } = dem;
  const x = Math.min(width - 1, Math.max(0, Math.floor(
    ((lon - bounds.minX) / (bounds.maxX - bounds.minX)) * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(
    ((bounds.maxY - lat) / (bounds.maxY - bounds.minY)) * height)));
  // NaN compares false against everything, so a NaN outlet SLIPPED this check
  // and seeded nothing -- an empty basin returned as success. Finite first.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)
    || lat < bounds.minY || lat > bounds.maxY || lon < bounds.minX || lon > bounds.maxX) {
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
  window.GeoIDHydrology = { fillSinks, flowDirection, flowAccumulation, watershed, streams, viewshed,
    mfdTopology, routeFlux };
}
