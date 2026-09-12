/**
 * THE FLOOD MODEL — the slope model's other half, on the same water.
 *
 * The hydrogeological model already says what the rain does when it lands: a
 * cell takes in what its ground can pass (r = min(P, Ks)), routes it downslope
 * and builds a water table. What that model CAPS is what this one routes.
 * `steadyWetness` holds h at the soil column's own depth — W = 1 — precisely
 * where the hillside cannot carry any more water away, and the water it
 * cannot carry does not vanish: it stays on the surface and runs off. So one
 * rainfall map drives two hazards out of ONE water balance, and neither
 * double-counts the other's water:
 *
 *   P              the rain's rate over the map's own window          (m/s)
 *   r  = min(P, Ks)          infiltrates — the slope model's recharge
 *   e_h = P − r              infiltration excess          (Horton: rain too fast)
 *   e_s = r · W              saturation excess   (Dunne: the column is already full)
 *   e  = e_h + e_s           runoff, this model's supply
 *
 * A CATCHMENT THE SLOPE MODEL CALLS SATURATED IS A CATCHMENT THAT FLOODS, and
 * that is the whole coupling: W is the slope model's own number, so as the
 * hillsides fill, the same storm turns from recharge into runoff and the
 * rivers rise. The runoff coefficient e/P is that sentence as a map.
 *
 * THE FLOOD IS A WAVE, so unlike the slope model this one is not static. Each
 * cell is a linear reservoir on the flow topology — it holds water and lets it
 * go at a rate set by how long water takes to cross it — and the storm is
 * marched through the series in order. A hillslope passes water on in tens of
 * minutes, a channel in minutes; a big catchment therefore peaks hours after
 * the rain that made it, which is the thing a flood forecast exists to say and
 * a steady-state model cannot.
 *
 *   v        hillslope   k_v·√(sin β)                      clamped
 *            channel     0.514 · Q_bank^0.2                clamped
 *   k_i      = L / v                               the cell's residence time
 *   S(t+Δt) = S·a + u·k·(1 − a),   a = e^(−Δt/k),   Q = (S + u·Δt − S(t+Δt)) / Δt
 *
 * That release is the EXACT integral of the reservoir under a constant
 * arrival u over the step, which is what makes the answer independent of how
 * finely the rainfall series happens to be sampled. The obvious form — dump
 * the step's water in, then let a share of the total go — is not: measured,
 * hourly steps released 4 % more water and held 65 % less than the same ten
 * hours at five-minute steps, so the forecast would have depended on the
 * reader's choice of cadence.
 *
 * The channel velocity needs no slope and is not a guess: eliminating Q from
 * the same downstream hydraulic geometry `inundation.js` already uses for
 * depth (w = 7.2 Q^0.5, d = 0.27 Q^0.3) leaves v = Q/(w·d) = 0.514 Q^0.2 —
 * and 0.5 + 0.3 + 0.2 = 1 exactly, which is Leopold & Maddock's (1953) own
 * closure. About 0.5 m/s on a small stream and 2 m/s on a large river.
 *
 * THE FACTOR OF SAFETY IS THE CHANNEL'S, and it is the same shape as the
 * slope's — what holds, over what pushes:
 *
 *   FoS = Q_bankfull / Q          below 1 the channel overtops
 *
 * with the bankfull discharge from the river's own width through the same
 * relation turned round (`meanFlowFromWidth`), times the annual-flood ratio
 * `inundation.js`'s scenarios already call bankfull. So a forecast flood and
 * a scenario flood speak one language, and the stage the overtopping water
 * stands at goes into the SAME `inundate` the scenario map uses.
 *
 * AN ORDER-OF-MAGNITUDE SCREENING MODEL. The capacity is estimated from a
 * satellite width, not surveyed; there is no channel storage, no backwater, no
 * tide, no reservoir, no gauge; and the velocities are typical rather than
 * this river's. It says WHERE and WHEN a channel is over its brim, not by how
 * much to the centimetre.
 *
 * Pure: arrays in, arrays out.
 */

import { FOS_CAP } from "./slope-hydrology.js?v=20260912-4b6c6ec";
import { meanFlowFromWidth, stageRise, channelDepth } from "./inundation.js?v=20260912-4b6c6ec";

/**
 * The annual flood as a multiple of the mean flow — bankfull, by the usual
 * convention that a channel is formed by the flood it reaches about one year
 * in two. `inundation.js`'s "Winter flood" scenario is this same number, and
 * it is a control here for the same reason it is a slider there: it varies by
 * an order of magnitude between a chalk stream and a monsoon river.
 */
export const BANKFULL_RATIO = 5;

/** Hillslope velocity coefficient in v = k·√(sin β), m/s (NRCS shallow concentrated flow). */
export const HILLSLOPE_V = 1.5;
/** From w = 7.2 Q^0.5 and d = 0.27 Q^0.3: v = Q/(w·d) = 0.514 Q^0.2. */
export const CHANNEL_V_COEF = 1 / (7.2 * 0.27);
export const CHANNEL_V_EXP = 0.2;
/** Nothing crawls and nothing races: a flood wave is between these, m/s. */
export const V_MIN = 0.02;
export const V_MAX = 5;

/** The discharge a channel of this width carries at its brim, m³/s. */
export function bankfullCapacity(widthM, ratio = BANKFULL_RATIO) {
  const mean = meanFlowFromWidth(widthM);
  return Number.isFinite(mean) ? mean * Math.max(0.1, ratio) : NaN;
}

/**
 * The rain's fate at one cell, per second: what soaks in, what runs off, and
 * why. `W` is the slope model's saturation (0–1) at the same cell under the
 * same map — the water table it has already built.
 */
export function partition({ rainMs, K, W, infiltration = true }) {
  const P = Number.isFinite(rainMs) && rainMs > 0 ? rainMs : 0;
  if (!P) return { infiltrated: 0, runoff: 0, horton: 0, dunne: 0, coefficient: 0 };
  const cap = infiltration && Number.isFinite(K) ? Math.max(0, K) : Infinity;
  const r = Math.min(P, cap);
  const horton = P - r;
  const wet = Number.isFinite(W) ? Math.max(0, Math.min(1, W)) : 0;
  const dunne = r * wet;
  const runoff = horton + dunne;
  return { infiltrated: r - dunne, runoff, horton, dunne, coefficient: runoff / P };
}

/** How fast the wave crosses a cell, m/s: the channel's own size, or the hillslope's gradient. */
export function cellVelocity({ slopeRad, capacity, hillV = HILLSLOPE_V, vMin = V_MIN, vMax = V_MAX }) {
  if (Number.isFinite(capacity) && capacity > 0) {
    return Math.min(vMax, Math.max(vMin, CHANNEL_V_COEF * (capacity ** CHANNEL_V_EXP)));
  }
  const s = Math.sin(Number.isFinite(slopeRad) ? Math.abs(slopeRad) : 0);
  return Math.min(vMax, Math.max(vMin, hillV * Math.sqrt(Math.max(0, s))));
}

/**
 * A residence time per cell, seconds — the cell's flow length over its
 * velocity. A channel cell takes its river's bankfull discharge; every other
 * cell its own gradient.
 */
export function residenceTimes({ n, slopeRad, capacity = null, cellM, hillV = HILLSLOPE_V, vMin = V_MIN, vMax = V_MAX }) {
  const k = new Float32Array(n);
  const L = Math.max(1, cellM);
  for (let i = 0; i < n; i += 1) {
    const v = cellVelocity({ slopeRad: slopeRad[i], capacity: capacity ? capacity[i] : NaN, hillV, vMin, vMax });
    k[i] = L / v;
  }
  return k;
}

/**
 * ONE STEP OF THE WAVE. Every cell takes its local runoff and whatever has
 * arrived from upslope this step, releases the share of its store that a
 * linear reservoir of residence time k lets go in Δt, and passes it to its
 * receivers. The topology's order runs high to low and a receiver is always
 * strictly lower, so one pass settles every donor before the cell it feeds.
 *
 * `store` is carried BETWEEN steps — that is what makes this a wave rather
 * than a series of steady states, and why the series must be marched in order.
 * Returns the discharge leaving each cell, m³/s.
 */
export function waveStep({ topo, store, source, k, dtS, out = null, inflow = null }) {
  const n = store.length;
  const q = out && out.length === n ? out.fill(0) : new Float32Array(n);
  const inn = inflow && inflow.length === n ? inflow : new Float64Array(n);
  for (let i = 0; i < n; i += 1) inn[i] = source[i] || 0;
  const { order, offsets, recv, frac } = topo;
  const dt = Math.max(1, dtS);
  for (let o = 0; o < order.length; o += 1) {
    const i = order[o];
    const u = inn[i];
    const s0 = store[i];
    if (!(u > 0) && !(s0 > 0)) { store[i] = 0; continue; }
    /**
     * THE EXACT SOLUTION over the step, not a dump followed by a decay. For a
     * constant arrival rate u, dS/dt = u − S/k integrates to
     * S(Δt) = S₀·a + u·k·(1 − a), and the water that left is what came in less
     * what is still held. Written the obvious way instead — put the whole
     * step's water in, then release a share of the total — a reservoir under
     * steady rain settles on I·a/(1−a) rather than on u·k, which is a third of
     * the right answer at Δt = k and biases every hydrograph towards its own
     * time step: measured, an hour's steps released 4% more water than the
     * same hours stepped every five minutes, and held 65% less back.
     */
    const kk = Math.max(1, k[i]);
    const a = Math.exp(-dt / kk);
    const s1 = (s0 * a) + (u * kk * (1 - a));
    const rate = (s0 + (u * dt) - s1) / dt;
    store[i] = s1 > 0 ? s1 : 0;
    if (!(rate > 0)) continue;
    q[i] = rate;
    for (let m = offsets[i], e = offsets[i + 1]; m < e; m += 1) inn[recv[m]] += rate * frac[m];
  }
  return q;
}

/** The channel's factor of safety: what it carries at the brim, over what is arriving. */
export function floodFos(capacity, q) {
  if (!Number.isFinite(capacity) || capacity <= 0) return NaN;
  if (!Number.isFinite(q) || q <= 0) return FOS_CAP;
  return Math.min(FOS_CAP, capacity / q);
}

/**
 * How far above its normal level the water stands at a channel carrying `q`,
 * in metres — the at-a-station law `inundation.js` already uses, driven by the
 * forecast discharge instead of a scenario's multiple.
 */
export function riseFor({ widthM, q, capacity, ratio = BANKFULL_RATIO, exponent = 0.4 }) {
  const mean = capacity / Math.max(0.1, ratio);
  if (!(mean > 0) || !Number.isFinite(q)) return 0;
  return stageRise(widthM, { flow: q / mean, exponent, extra: 0, widthCap: Infinity });
}

/**
 * The classes the channel map is read with. The same five bands as the slope
 * model's factor of safety, in a channel's own words, so a reader who has read
 * one map can read the other.
 */
export const FLOOD_CLASSES = [
  { max: 1, label: "over the brim (FoS < 1)", colour: [140, 20, 130] },
  { max: 1.1, label: "at the brim (1–1.1)", colour: [206, 60, 150] },
  { max: 1.3, label: "little freeboard (1.1–1.3)", colour: [251, 140, 190] },
  { max: 1.5, label: "adequate (1.3–1.5)", colour: [161, 218, 180] },
  { max: Infinity, label: "well within bank (≥ 1.5)", colour: [44, 127, 184] },
];

export function floodClass(v) {
  if (!Number.isFinite(v)) return -1;
  return FLOOD_CLASSES.findIndex((k) => v < k.max);
}

/** Runoff coefficient classes — the fraction of the rain that ran off. */
export const RUNOFF_CLASSES = [
  { max: 0.05, label: "under 5% — it all soaks in", colour: [237, 248, 251] },
  { max: 0.2, label: "5–20%", colour: [191, 211, 230] },
  { max: 0.4, label: "20–40%", colour: [158, 188, 218] },
  { max: 0.6, label: "40–60%", colour: [140, 150, 198] },
  { max: 0.8, label: "60–80%", colour: [136, 65, 157] },
  { max: Infinity, label: "80% and more — the ground is full", colour: [110, 1, 107] },
];

/** Discharge classes, m³/s — a log ladder, because a catchment spans orders. */
export const DISCHARGE_CLASSES = [
  { max: 1, label: "under 1 m³/s", colour: [237, 248, 251] },
  { max: 10, label: "1–10", colour: [204, 236, 230] },
  { max: 100, label: "10–100", colour: [153, 216, 201] },
  { max: 1000, label: "100–1,000", colour: [44, 162, 95] },
  { max: 10000, label: "1,000–10,000", colour: [0, 109, 44] },
  { max: Infinity, label: "10,000 and more", colour: [0, 68, 27] },
];

export { channelDepth, meanFlowFromWidth };
