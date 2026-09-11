/**
 * THE ROCK MODEL — the soil model's complement.
 *
 * The soil model is a shallow translational slide in the soil column: its
 * strength is the soil's, its trigger the water table the rain builds, its
 * failure plane a metre or two down. Bedrock fails differently and at a
 * different scale. A rock slope is as strong as its rock MASS — the intact
 * rock weakened by every joint in it — and whether it stands depends on how
 * HIGH it is as much as how steep; and where the rock is bare and steep, the
 * common failure is not a slide at all but blocks falling and running out
 * below. So two products, both from the ground and the rain the pipeline
 * already has:
 *
 *   ROCK SLOPE — a planar failure through the toe of a slope of height H and
 *   face angle β (Culmann), on the rock mass's strength: the Generalised
 *   Hoek–Brown criterion from intact strength σci, mi and GSI (Hoek,
 *   Carranza-Torres & Corkum 2002), fitted to an equivalent c′, φ′ over the
 *   stress range a slope of that height applies. Water in the joints enters
 *   as a pore-pressure ratio ru from the same routed recharge.
 *
 *   ROCKFALL — sources where bedrock is bare and steep, and the reach of what
 *   falls from them by the energy-line (Fahrböschung) method: a block travels
 *   down slope while it stays under a line dropping from its source at the
 *   reach angle, and the height of that line above the ground is its energy,
 *   v = √(2 g h).
 *
 * Pure: arrays in, arrays out.
 */

import { FOS_CAP, WATER_UNIT_WEIGHT } from "./slope-hydrology.js?v=20260912-ac4605b";

const RAD = Math.PI / 180;

/** Generalised Hoek–Brown constants for a rock mass (D = disturbance, 0 for a natural slope). */
export function hoekBrown({ gsi, mi, D = 0 }) {
  const mb = mi * Math.exp((gsi - 100) / (28 - 14 * D));
  const s = Math.exp((gsi - 100) / (9 - 3 * D));
  const a = 0.5 + (Math.exp(-gsi / 15) - Math.exp(-20 / 3)) / 6;
  return { mb, s, a };
}

/** The rock mass's global strength σcm, MPa (Hoek et al. 2002, eq. 18). */
export function rockMassStrength({ sci, mb, s, a }) {
  return sci * ((mb + 4 * s - a * (mb - 8 * s)) * (mb / 4 + s) ** (a - 1)) / (2 * (1 + a) * (2 + a));
}

/**
 * The equivalent Mohr–Coulomb strength of a rock mass for a SLOPE of height
 * H: Hoek et al. (2002) eqs. 13–14 over σ3 up to σ3max, with σ3max from their
 * slope relation (eq. 19). σci in MPa, γ in kN/m³, H in m; returns c′ in kPa
 * and φ′ in degrees.
 */
export function equivalentMohrCoulomb({ sci, gsi, mi, gamma, H, D = 0 }) {
  const { mb, s, a } = hoekBrown({ gsi, mi, D });
  const scm = rockMassStrength({ sci, mb, s, a });
  const gH = Math.max(1e-6, (gamma * Math.max(H, 1)) / 1000);          // MPa
  const s3max = 0.72 * scm * (scm / gH) ** -0.91;
  const s3n = s3max / sci;
  const k = 6 * a * mb * (s + mb * s3n) ** (a - 1);
  const phi = Math.asin(k / (2 * (1 + a) * (2 + a) + k)) / RAD;
  const c = (sci * ((1 + 2 * a) * s + (1 - a) * mb * s3n) * (s + mb * s3n) ** (a - 1))
    / ((1 + a) * (2 + a) * Math.sqrt(1 + k / ((1 + a) * (2 + a))));
  return { c: c * 1000, phi, mb, s, a, scm, s3max };
}

/**
 * CULMANN'S PLANAR FAILURE through the toe of a slope of height H and face
 * angle β, minimised over the plane's angle θ. With T the driving force,
 *
 *   FoS(θ) = 2c′·sinβ / (γH·sinθ·sin(β−θ)) + (1 − ru)·tanφ′·cotθ
 *
 * and its minimum where K·sin(β − 2u) = tanφ_w·sin²u, u = β − θ, K = 2c′sinβ/γH,
 * tanφ_w = (1 − ru)tanφ′ — one root in (0, β/2), found by bisection. At ru = 0
 * and FoS = 1 this is Culmann's critical height Hc = 4c′·sinβ·cosφ′ /
 * (γ(1 − cos(β − φ′))), which the tests hold it to.
 */
export function culmann({ H, betaRad, c, phi, gamma, ru = 0 }) {
  if (!(H > 0) || !(betaRad > 1e-3) || !(gamma > 0)) return { fos: FOS_CAP, theta: NaN };
  const K = (2 * c * Math.sin(betaRad)) / (gamma * H);
  const tw = Math.max(0, 1 - ru) * Math.tan(phi * RAD);
  let lo = 1e-6; let hi = betaRad / 2;
  if (tw <= 0) { lo = hi = betaRad / 2; }
  else {
    for (let k = 0; k < 40; k += 1) {
      const u = (lo + hi) / 2;
      const g = K * Math.sin(betaRad - 2 * u) - tw * Math.sin(u) ** 2;
      if (g > 0) lo = u; else hi = u;
    }
  }
  const u = (lo + hi) / 2;
  const theta = betaRad - u;
  const fos = K / (Math.sin(theta) * Math.sin(u)) + tw / Math.tan(theta);
  return { fos: Math.min(FOS_CAP, fos), theta: theta / RAD };
}

/** Culmann's critical height, m: the highest slope of angle β the rock mass holds dry. */
export function criticalHeight({ betaRad, c, phi, gamma }) {
  const d = 1 - Math.cos(betaRad - phi * RAD);
  if (!(d > 0) || betaRad <= phi * RAD) return Infinity;
  return (4 * c * Math.sin(betaRad) * Math.cos(phi * RAD)) / (gamma * d);
}

/**
 * Water in the joints, as a pore-pressure ratio: the routed recharge q
 * through a fractured zone of thickness zw at the rock mass's conductivity,
 * saturated at 1, and ru = W·γw / 2γ — the ratio a slope fully drained by
 * seepage parallel to its face carries (Bishop's ru ≈ 0.2 for rock).
 */
export function jointWater({ q, b, K, zw = 10, betaRad, gamma }) {
  const s = Math.sin(betaRad);
  if (!(q > 0) || !(K > 0) || !(b > 0)) return { W: 0, ru: 0 };
  const W = s > 1e-6 ? Math.min(1, q / (b * K * zw * s)) : 1;
  return { W, ru: (W * WATER_UNIT_WEIGHT) / (2 * gamma) };
}

/**
 * LOCAL RELIEF — the slope's height: each cell's height above the lowest
 * ground within `r` cells (a square window), by separable running minima
 * (van Herk / Gil-Werman), so a window of any size costs the same per cell.
 * NaN (no DEM) never counts as the lowest ground.
 */
export function localRelief(band, width, height, r) {
  const n = width * height;
  const rowMin = new Float32Array(n);
  const out = new Float32Array(n).fill(NaN);
  const w = 2 * r + 1;
  const line = (get, set, len) => {
    const g = new Float32Array(len); const h = new Float32Array(len);
    for (let i = 0; i < len; i += 1) {
      const v = get(i);
      g[i] = i % w === 0 ? v : Math.min(g[i - 1], v);
    }
    for (let i = len - 1; i >= 0; i -= 1) {
      const v = get(i);
      h[i] = (i % w === w - 1 || i === len - 1) ? v : Math.min(h[i + 1], v);
    }
    for (let i = 0; i < len; i += 1) {
      const a = i - r; const b = i + r;
      // The block trick is exact only for a full-width window; the r cells
      // at each end of a line are read directly.
      if (a < 0 || b > len - 1) {
        let m = Infinity;
        for (let j = Math.max(0, a); j <= Math.min(len - 1, b); j += 1) m = Math.min(m, get(j));
        set(i, m);
      } else set(i, Math.min(h[a], g[b]));
    }
  };
  const val = (v) => (Number.isFinite(v) ? v : Infinity);
  for (let y = 0; y < height; y += 1) line((x) => val(band[y * width + x]), (x, v) => { rowMin[y * width + x] = v; }, width);
  for (let x = 0; x < width; x += 1) {
    line((y) => rowMin[y * width + x], (y, v) => {
      const i = y * width + x;
      if (Number.isFinite(band[i]) && Number.isFinite(v)) out[i] = band[i] - v;
    }, height);
  }
  return out;
}

/**
 * ROCKFALL REACH by the energy line: sources start with their own height as
 * energy; each cell passes down its flow receivers the highest energy line
 * reaching it less tan(reach angle) × the distance travelled; a cell is
 * reached while the line is above it. `order` runs high to low (the flow
 * topology's), so every donor is settled before its receivers. Returns the
 * energy-line height above the ground (NaN where nothing reaches), from
 * which v = √(2g·h).
 */
export function rockfallReach({ band, width, topo, sources, reachDeg = 32, cellM }) {
  const n = band.length;
  const E = new Float32Array(n).fill(-Infinity);
  const tanR = Math.tan(reachDeg * RAD);
  for (let i = 0; i < n; i += 1) if (sources[i]) E[i] = band[i];
  const { order, offsets, recv } = topo;
  for (let o = 0; o < order.length; o += 1) {
    const u = order[o];
    const e = E[u];
    if (!(e >= band[u])) continue;     // nothing reaches here
    const ux = u % width; const uy = (u - ux) / width;
    for (let k = offsets[u], end = offsets[u + 1]; k < end; k += 1) {
      const v = recv[k];
      const vx = v % width; const vy = (v - vx) / width;
      const d = Math.hypot(vx - ux, vy - uy) * cellM;
      const ev = e - tanR * d;
      if (ev > E[v]) E[v] = ev;
    }
  }
  const out = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i += 1) if (E[i] >= band[i]) out[i] = E[i] - band[i];
  return out;
}

export const velocityOf = (h) => (Number.isFinite(h) ? Math.sqrt(2 * 9.81 * Math.max(0, h)) : NaN);

/**
 * Culmann's FoS on a GIVEN plane θ — used with each cell's dry critical plane
 * for every wet map. By the envelope theorem the minimum moves only to second
 * order in ru, and measured across weak to strong rock, 20–900 m slopes,
 * 25–75° faces and ru up to 0.25 the result overestimates the re-minimised
 * FoS by at most 0.44 % — for one evaluation a cell instead of a 40-step
 * bisection on every one of hundreds of maps. The map and a station both
 * use this, so they cannot disagree.
 */
export function culmannAt({ H, betaRad, c, phi, gamma, ru = 0, thetaRad }) {
  if (!(H > 0) || !(betaRad > 1e-3) || !(thetaRad > 0) || !(thetaRad < betaRad)) return FOS_CAP;
  const K = (2 * c * Math.sin(betaRad)) / (gamma * H);
  const tw = Math.max(0, 1 - ru) * Math.tan(phi * RAD);
  return Math.min(FOS_CAP, K / (Math.sin(thetaRad) * Math.sin(betaRad - thetaRad)) + tw / Math.tan(thetaRad));
}

/** One rock cell under one map: the water in its joints and the rock slope's factor of safety. */
export function rockCell({ q, contour, betaRad, c, phi, gamma, K, H, thetaRad, zw = 10 }) {
  const { W, ru } = jointWater({ q, b: contour, K, zw, betaRad, gamma });
  return { W, ru, fos: culmannAt({ H, betaRad, c, phi, gamma, ru, thetaRad }) };
}
