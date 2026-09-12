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

import { cellAnswer, planeWetness, slopeStresses, steadyWetness } from "./slope-hydrology.js?v=20260912-e5b0314";
import { rockCell } from "./rock-slope.js?v=20260912-e5b0314";
import { partition, waveStep, floodFos, riseFor } from "./flood-fos.js?v=20260912-e5b0314";

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
export function stationStep({ cell, weights, rainMm, windowH, cells, topo, infiltration = true, lateral = 1, rock = null }) {
  const B = cells.block || null; const P = cells.props || cells;
  const perSecond = 1 / (1000 * windowH * 3600);
  let q = 0; let rainArea = 0; let area = 0;
  const { idx, w } = weights;
  for (let k = 0; k < idx.length; k += 1) {
    const u = idx[k];
    if (!cells.data[u]) continue;
    const j = B ? B[u] : u;
    const rain = rainMm[j];
    if (!Number.isFinite(rain)) continue;
    // The rain the catchment received, weighted by how much of each cell's
    // water reaches the station: what the station's water table is fed.
    rainArea += w[k] * rain; area += w[k];
    let r = rain * perSecond;
    if (infiltration && r > P.K[j]) r = P.K[j];
    q += w[k] * r * topo.cellArea;
  }
  const j = B ? B[cell] : cell;
  const here = { K: P.K[j], zs: P.zs[j], zf: P.zf[j], slopeRad: cells.slopeRad[cell], c: P.c[j], phi: P.phi[j], gamma: P.gamma[j] };
  const a = cellAnswer({ q, contour: topo.contour, lateral, cell: here });
  const m = planeWetness(a.W, here.zs, here.zf);
  const st = slopeStresses({ slopeRad: here.slopeRad, c: here.c, phi: here.phi, gamma: here.gamma, zf: here.zf, m });
  let r = Number.isFinite(rainMm[j]) ? rainMm[j] * perSecond : NaN;
  if (infiltration && r > P.K[j]) r = P.K[j];
  // The rock model at the same cell under the same routed recharge — the
  // map's own per-cell function, so the two cannot disagree.
  const rk = rock ? rockCell({ q, contour: topo.contour, betaRad: here.slopeRad, ...rock }) : null;
  return {
    rockFos: rk ? rk.fos : NaN, ru: rk ? rk.ru : NaN,
    fos: a.fos, W: a.W, m, h: a.W * here.zs, depth: here.zs - a.W * here.zs,
    rain: rainMm[j], catchRain: area > 0 ? rainArea / area : NaN, recharge: r * 1000 * 86400, qb: (q / topo.contour) * 86400,
    pore: st.pore, effective: st.effective, strength: st.resisting, stress: st.driving,
  };
}

/**
 * THE FLOOD AT A STATION, from its own catchment and nothing else.
 *
 * A CATCHMENT IS CLOSED UNDER DONORS: if a cell's water reaches the station,
 * so does the water of every cell flowing into it. So routing over the
 * catchment alone gives each of its cells the SAME flux the whole-grid pass
 * gives it — which is what lets a station work out the saturation at every
 * cell above it, and so the runoff, and so the wave, without the grid. Water
 * leaving the catchment sideways is simply dropped: by definition it never
 * reaches the station.
 *
 * `idx` must be the catchment in the topology's own high-to-low order, which
 * is how `upslopeWeights` returns it.
 */
export function catchmentTopology(topo, idx, pos) {
  const m = idx.length;
  for (let a = 0; a < m; a += 1) pos[idx[a]] = a;
  const offsets = new Int32Array(m + 1);
  let count = 0;
  for (let a = 0; a < m; a += 1) {
    const u = idx[a];
    for (let e = topo.offsets[u], z = topo.offsets[u + 1]; e < z; e += 1) if (pos[topo.recv[e]] >= 0) count += 1;
  }
  const recv = new Int32Array(count); const frac = new Float32Array(count);
  let w = 0;
  for (let a = 0; a < m; a += 1) {
    offsets[a] = w;
    const u = idx[a];
    for (let e = topo.offsets[u], z = topo.offsets[u + 1]; e < z; e += 1) {
      const v = pos[topo.recv[e]];
      if (v < 0) continue;
      recv[w] = v; frac[w] = topo.frac[e]; w += 1;
    }
  }
  offsets[m] = w;
  // Local indices are already high to low, because `idx` is.
  const order = new Int32Array(m);
  for (let a = 0; a < m; a += 1) order[a] = a;
  for (let a = 0; a < m; a += 1) pos[idx[a]] = -1;
  return { order, offsets, recv, frac };
}

/** Buffers a catchment march needs, sized to the biggest catchment among the stations. */
export function floodScratch(m) {
  return { q: new Float64Array(m), src: new Float64Array(m), out: new Float32Array(m), inflow: new Float64Array(m) };
}

/**
 * ONE MAP AT ONE STATION, for the flood: the recharge routed over the
 * catchment, the saturation it builds at every cell, the runoff that leaves
 * on the surface, and one step of the wave. `store` is the station's own and
 * is carried between maps — a flood is a wave, so the maps must be walked in
 * order.
 */
export function stationFlood({ sub, cells, topo, rainMm, windowH, infiltration = true, lateral = 1,
  store, kRes, dtS, scratch, capacity = NaN, widthM = NaN, ratio = 5 }) {
  const { idx, local, at } = sub;
  const m = idx.length;
  const B = cells.block || null; const P = cells.props || cells;
  const per = 1 / (1000 * windowH * 3600);
  const q = scratch.q.fill(0);
  for (let a = 0; a < m; a += 1) {
    const u = idx[a];
    if (!cells.data[u]) continue;
    const j = B ? B[u] : u;
    const rain = rainMm[j];
    let r = Number.isFinite(rain) ? rain * per : 0;
    if (infiltration && r > P.K[j]) r = P.K[j];
    q[a] = r * topo.cellArea;
  }
  for (let a = 0; a < m; a += 1) {
    const v = q[a];
    if (!v) continue;
    for (let e = local.offsets[a], z = local.offsets[a + 1]; e < z; e += 1) q[local.recv[e]] += v * local.frac[e];
  }
  const src = scratch.src.fill(0);
  let here = null;
  for (let a = 0; a < m; a += 1) {
    const u = idx[a];
    if (!cells.data[u]) continue;
    const j = B ? B[u] : u;
    const rain = rainMm[j];
    const W = steadyWetness({ q: q[a], b: topo.contour, K: P.K[j], zs: P.zs[j], slopeRad: cells.slopeRad[u], lateral });
    const p = partition({ rainMs: Number.isFinite(rain) ? rain * per : 0, K: P.K[j], W, infiltration });
    src[a] = p.runoff * topo.cellArea;
    if (a === at) here = p;
  }
  const out = waveStep({ topo: local, store, source: src, k: kRes, dtS, out: scratch.out, inflow: scratch.inflow });
  const discharge = out[at];
  return {
    discharge,
    runoff: here ? here.coefficient : NaN,
    excess: here ? here.runoff * 1000 * 86400 : NaN,
    floodFos: floodFos(capacity, discharge),
    stage: Number.isFinite(capacity) ? riseFor({ widthM, q: discharge, capacity, ratio }) : NaN,
  };
}

/**
 * What a landslide station records at every map, in the order the model uses
 * them: the rain, what infiltrates, the water table it builds, the water on
 * the failure plane, the stresses that water changes — and their ratio, the
 * factor of safety. Every intermediate is kept, because a factor of safety
 * that moves says nothing about WHY until the terms under it are plotted too.
 */
export const LANDSLIDE_PARAMS = [
  { key: "fos", label: "Soil slide — factor of safety", unit: "", group: "Stability" },
  { key: "rockFos", label: "Rock slope — factor of safety", unit: "", group: "Stability" },
  { key: "rain", label: "Rain at the station", unit: "mm", group: "Rainfall" },
  { key: "catchRain", label: "Rain over its catchment (flow-weighted mean)", unit: "mm", group: "Rainfall" },
  { key: "recharge", label: "Recharge — what infiltrates at the cell", unit: "mm/day", group: "Rainfall" },
  { key: "qb", label: "Flow through the cell per metre of contour", unit: "m2/day", group: "Soil water" },
  { key: "W", label: "Soil saturation h / z_s", unit: "", group: "Soil water" },
  { key: "h", label: "Water table above bedrock", unit: "m", group: "Soil water" },
  { key: "depth", label: "Depth to the water table", unit: "m", group: "Soil water" },
  { key: "m", label: "Water on the failure plane m", unit: "", group: "Soil water" },
  { key: "pore", label: "Pore pressure on the failure plane", unit: "kPa", group: "Stresses" },
  { key: "effective", label: "Effective normal stress", unit: "kPa", group: "Stresses" },
  { key: "strength", label: "Shear strength", unit: "kPa", group: "Stresses" },
  { key: "stress", label: "Driving shear stress", unit: "kPa", group: "Stresses" },
  { key: "ru", label: "Water in the rock joints — pore-pressure ratio r_u", unit: "", group: "Rock" },
  { key: "runoff", label: "Runoff — the share of the rain that ran off", unit: "", group: "Flood" },
  { key: "excess", label: "Runoff leaving the cell's surface", unit: "mm/day", group: "Flood" },
  { key: "discharge", label: "Discharge through the cell", unit: "m3/s", group: "Flood" },
  { key: "floodFos", label: "Channel — factor of safety", unit: "", group: "Flood" },
  { key: "stage", label: "Water above the river's normal level", unit: "m", group: "Flood" },
];

/**
 * Plots that draw more than one parameter: strength against driving stress is
 * the factor of safety drawn as its two sides, which is how a reader sees the
 * margin close as the water comes in.
 */
export const LANDSLIDE_PLOTS = [
  ...LANDSLIDE_PARAMS.map((p) => ({ key: p.key, label: p.label, unit: p.unit, group: p.group, series: [{ key: p.key }] })),
  { key: "strength-vs-stress", label: "Shear strength (solid) against driving stress (dashed)", unit: "kPa", group: "Stresses",
    series: [{ key: "strength" }, { key: "stress", dash: [4, 3] }] },
  // The hydrograph beside the rain that made it: the lag between them is what
  // routing a wave buys, and it cannot be seen in either plot alone.
  { key: "rain-vs-discharge", label: "Discharge (solid) against the rain that made it (dashed)", unit: "m3/s | mm", group: "Flood",
    series: [{ key: "discharge" }, { key: "catchRain", dash: [4, 3] }] },
  { key: "slope-vs-channel", label: "Slope factor of safety (solid) against the channel's (dashed)", unit: "", group: "Flood",
    series: [{ key: "fos" }, { key: "floodFos", dash: [4, 3] }] },
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
