/**
 * THE LANDSLIDE MODEL AT A STATION — the same static answer the map draws,
 * computed for one cell without routing the whole grid.
 *
 * Routing is linear in the source: a cell's flux is every upslope cell's
 * recharge times the fraction of that cell's water that reaches it. Those
 * fractions depend only on the flow topology, so they are computed ONCE per
 * station (`upslopeWeights`) and every rainfall map after that costs one pass
 * over the station's own catchment rather than over two million cells. That is
 * what lets a station be added after a run and read every map at once.
 *
 * It must agree with `staticStep` exactly, or a station and the map under it
 * say two different things; `landslide-stations.test.mjs` holds them equal.
 */

import { cellAnswer, planeWetness } from "./slope-hydrology.js?v=20260911-dcef8e6";

/**
 * What fraction of every cell's water reaches cell `s`: 1 at `s`, the
 * receivers' fractions weighted by the flow split upslope, 0 elsewhere. The
 * topology's `order` runs from high to low and a receiver is always strictly
 * lower, so walking it BACKWARDS meets every receiver before its donors.
 * Returned sparse — the catchment, not the grid.
 */
export function upslopeWeights(topo, s, scratch = null) {
  const n = topo.offsets.length - 1;
  const f = scratch && scratch.length === n ? scratch.fill(0) : new Float64Array(n);
  f[s] = 1;
  const { order, offsets, recv, frac } = topo;
  let count = 0;
  for (let o = order.length - 1; o >= 0; o -= 1) {
    const u = order[o];
    if (u === s) { count += 1; continue; }
    let acc = 0;
    for (let k = offsets[u], e = offsets[u + 1]; k < e; k += 1) {
      const v = f[recv[k]];
      if (v) acc += v * frac[k];
    }
    if (acc) { f[u] = acc; count += 1; }
  }
  const idx = new Int32Array(count); const w = new Float64Array(count);
  let m = 0;
  for (let o = 0; o < order.length; o += 1) {
    const u = order[o];
    if (f[u]) { idx[m] = u; w[m] = f[u]; m += 1; }
  }
  return { idx: idx.subarray(0, m), w: w.subarray(0, m) };
}

/**
 * One rainfall map at one station: the same recharge, cap and routing as
 * `staticStep`, summed over the station's catchment only.
 */
export function stationStep({ cell, weights, rainMm, windowH, cells, topo, infiltration = true, lateral = 1 }) {
  const B = cells.block || null; const P = cells.props || cells;
  const perSecond = 1 / (1000 * windowH * 3600);
  let q = 0;
  const { idx, w } = weights;
  for (let k = 0; k < idx.length; k += 1) {
    const u = idx[k];
    if (!cells.data[u]) continue;
    const j = B ? B[u] : u;
    const rain = rainMm[j];
    if (!Number.isFinite(rain)) continue;
    let r = rain * perSecond;
    if (infiltration && r > P.K[j]) r = P.K[j];
    q += w[k] * r * topo.cellArea;
  }
  const j = B ? B[cell] : cell;
  const here = { K: P.K[j], zs: P.zs[j], zf: P.zf[j], slopeRad: cells.slopeRad[cell], c: P.c[j], phi: P.phi[j], gamma: P.gamma[j] };
  const a = cellAnswer({ q, contour: topo.contour, lateral, cell: here });
  let r = Number.isFinite(rainMm[j]) ? rainMm[j] * perSecond : NaN;
  if (infiltration && r > P.K[j]) r = P.K[j];
  return {
    fos: a.fos, W: a.W, m: planeWetness(a.W, here.zs, here.zf), h: a.W * here.zs,
    rain: rainMm[j], recharge: r * 1000 * 86400, qb: (q / topo.contour) * 86400,
  };
}

/** The parameters a landslide station records, in the order a table shows them. */
export const LANDSLIDE_PARAMS = [
  { key: "fos", label: "Factor of safety", unit: "" },
  { key: "m", label: "Water on the failure plane m", unit: "" },
  { key: "W", label: "Saturation h / z_s", unit: "" },
  { key: "h", label: "Water table above bedrock", unit: "m" },
  { key: "rain", label: "Rain over the window", unit: "mm" },
  { key: "recharge", label: "Recharge at the cell", unit: "mm/day" },
  { key: "qb", label: "Flux through the cell per metre of contour", unit: "m2/day" },
];

/**
 * THE CELLS MOST LIKELY TO FAIL, as predefined stations: the lowest factors of
 * safety over the window, at least `spacing` cells apart so five stations are
 * five slopes and not five neighbours on one. Sorted in widening bands of FoS
 * rather than all at once: two million cells sorted by a comparator is a second
 * of a frozen page to find five of them.
 */
export function lowestCells({ minFos, model, width, count = 5, spacing = 10, cap = 100, taken = [] }) {
  const out = [];
  // Cells already holding a station are kept clear of too, so asking twice
  // gives the next five rather than the same five again.
  const near = (list, i) => {
    const x = i % width; const y = (i - x) / width;
    return list.some((o) => Math.max(Math.abs((o % width) - x), Math.abs((o - (o % width)) / width - y)) < spacing);
  };
  const far = (i) => !near(out, i) && !near(taken, i);
  let lo = -Infinity;
  for (const hi of [1, 1.3, 1.5, 2, 3, 5, 10, cap]) {
    const band = [];
    for (let i = 0; i < minFos.length; i += 1) {
      const v = minFos[i];
      if (model[i] && v >= lo && v < hi) band.push(i);
    }
    band.sort((a, b) => minFos[a] - minFos[b]);
    for (const i of band) {
      if (!far(i)) continue;
      out.push(i);
      if (out.length >= count) return out;
    }
    lo = hi;
  }
  return out;
}
