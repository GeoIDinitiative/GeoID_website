/**
 * THE HAZARD MAP: a coarse risk raster for the whole site, computed once at
 * boot from the real terrain, and the ground overlay that shows it.
 *
 *   game.env.hazardMap.sample(x, z) -> { slope, sand, shelter, solar, traversability, suitability, slope_deg }
 *
 * EVERY LAYER IS A HEURISTIC. They are derived from the measured elevation
 * (the 16 m base level: CTX stereo with HiRISE averaged in) and from the
 * detail provider's regolith map (itself a guess from slope, roughness and
 * CTX brightness). Nothing here is a geotechnical survey, and the game says
 * so in the overlay's legend.
 *
 * Grid: two base samples to a cell, so about 30 x 32 m, 640 x 640 cells.
 *
 *   slope_deg       the steepest 16 m slope inside the cell, degrees. MEASURED.
 *   slope           slope instability, 0..1: smoothstep(10, 32 degrees),
 *                   raised by up to 40% where the ground is loose.
 *   sand            sand-trap likelihood, 0..1: loose ground (the regolith
 *                   map's "sand") that also sits in a hollow of the measured
 *                   surface (where drift collects: the cell is 0.5 to 2 m lower
 *                   than the ring 60 m around it) or in a GENERATED drift
 *                   pocket (the top tenth of a 110 m value noise: no dataset
 *                   says where the sand is deep), a little more on gentle
 *                   sandy slopes, none on steep ones. Cleared around the landing site and the POIs
 *                   (mission planners chose them to be safe).
 *   shelter         shelter from the prevailing winds, 0..1: how high the
 *                   terrain stands upwind within 400 m (2 to 12 degrees of
 *                   horizon), for the three winds of the weather model: the
 *                   afternoon wind from 115 degrees (weight 0.45), the night
 *                   wind from 290 (0.30), storm winds from 340 (0.25).
 *   solar           annual mean insolation relative to flat open ground
 *                   (1 = as good as flat; clamped to 1.2): the direct beam on
 *                   the cell's own slope and aspect, shadowed by the horizon
 *                   in eight directions out to 2.5 km, plus the sky's diffuse
 *                   light scaled by how much sky the cell sees, summed over
 *                   six seasons and the daylight hours at tau 0.6, with the
 *                   same irradiance model the sky and the array use.
 *   traversability  0 (do not drive here) .. 1: gentle, firm, smooth.
 *                   (1 - smoothstep(8, 28 deg)) x (1 - 0.85 sand) x (1 - 0.4 roughness)
 *   suitability     base-site score, 0..1: flat (full marks to 3 degrees,
 *                   none at 12), not a sand trap, smooth, sunny, and a little
 *                   for wind shelter.
 *                   flat x (1 - 0.7 sand) x (1 - 0.5 roughness) x (0.5 + 0.5 solar) x (0.85 + 0.15 shelter)
 *
 * The work is sliced (12 ms at a time, yielding through a MessageChannel so a
 * background tab is not throttled to one slice a second) and happens behind
 * the loading screen: about half a second in all.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { sunPosition, surfaceIrradiance } from "./sky.js?v=b8cfe8e-efa5b7b7";

export const LAYERS = [
  { id: "traversability", label: "Traversability", good: "easy", bad: "do not drive", invert: false },
  { id: "suitability", label: "Base suitability", good: "good site", bad: "poor site", invert: false },
  { id: "sand", label: "Sand-trap likelihood", good: "firm", bad: "trap", invert: true },
  { id: "slope", label: "Slope instability", good: "stable", bad: "steep / loose", invert: true },
  { id: "shelter", label: "Wind shelter", good: "sheltered", bad: "exposed", invert: false },
  { id: "solar", label: "Solar exposure (annual)", good: "full sun", bad: "shaded", invert: false },
];
export const PREVAILING = [{ from: 115, w: 0.45 }, { from: 290, w: 0.30 }, { from: 340, w: 0.25 }];
const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function yielder() {
  if (typeof MessageChannel === "undefined") return () => new Promise((r) => setTimeout(r, 0));
  const ch = new MessageChannel();
  return () => new Promise((r) => { ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
}
/** A fixed lattice noise for the generated drift pockets (deterministic, the same for every save). */
function pocketNoise(x, z) {
  const h = (i, j) => { let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ 0x4d415253; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (h(i, j) + (h(i + 1, j) - h(i, j)) * u) * (1 - v) + (h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u) * v;
}

export class HazardMap {
  constructor() {
    this.ready = false; this.layers = LAYERS; this.w = 0; this.h = 0;
    this.data = {}; this.stats = {}; this.overlay = { on: false, layer: "traversability" };
    this.texture = null; this.ms = 0;
  }

  /** Build every layer. `game` needs field, detail and site; resolves when done. */
  async compute(game, onProgress = () => {}) {
    const t0 = performance.now(), field = game.field, site = game.site, detail = game.detail;
    const bw = field.bw, bh = field.bh, B = field.baseH;
    const sx = field.base.mpp * site.cos, sz = field.base.mpp;
    const W = this.w = bw >> 1, H = this.h = bh >> 1, N = W * H;
    this.cx = 2 * sx; this.cz = 2 * sz;                      // cell size, metres
    this.x0 = -site.halfX + sx; this.z0 = -site.halfZ + sz;  // centre of cell (0, 0)
    const mk = () => new Uint8Array(N);
    const D = this.data = { slope_deg: mk(), slope: mk(), sand: mk(), shelter: mk(), solar: mk(), traversability: mk(), suitability: mk(), rough: mk() };
    const mean = new Float32Array(N), gx = new Float32Array(N), gz = new Float32Array(N), loose = new Float32Array(N);
    const next = yielder();
    let slice = performance.now();
    const breathe = async (f) => { if (performance.now() - slice > 12) { onProgress(f); await next(); slice = performance.now(); } };
    const base = (i, j) => B[clamp(j, 0, bh - 1) * bw + clamp(i, 0, bw - 1)];
    const C = detail.cond, cw = detail.cw;

    // A. per cell: mean height, steepest 16 m slope, mean gradient, looseness and roughness from the regolith map
    for (let cj = 0; cj < H; cj++) {
      for (let ci = 0; ci < W; ci++) {
        let hs = 0, steep = 0, sgx = 0, sgz = 0, sand = 0, rough = 0;
        for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
          const i = ci * 2 + a, j = cj * 2 + b;
          const dx = (base(i + 1, j) - base(i - 1, j)) / (2 * sx), dz = (base(i, j + 1) - base(i, j - 1)) / (2 * sz);
          hs += base(i, j); sgx += dx; sgz += dz;
          steep = Math.max(steep, Math.hypot(dx, dz));
          const k = (j * cw + i) * 4;
          sand += C[k + 1]; rough += C[k + 3];
        }
        const n = cj * W + ci;
        mean[n] = hs / 4; gx[n] = sgx / 4; gz[n] = sgz / 4; loose[n] = sand / 4 / 255;
        D.slope_deg[n] = Math.min(255, Math.round(Math.atan(steep) / D2R * 2.5));
        D.rough[n] = Math.round(rough / 4);
      }
      if ((cj & 15) === 0) await breathe(0.15 * cj / H);
    }

    // B. sand traps, slope instability
    const start = site.start, pois = site.pois || [];
    const cm = (i, j) => mean[clamp(j, 0, H - 1) * W + clamp(i, 0, W - 1)];
    for (let cj = 0; cj < H; cj++) {
      for (let ci = 0; ci < W; ci++) {
        const n = cj * W + ci, deg = D.slope_deg[n] / 2.5, x = this.x0 + ci * this.cx, z = this.z0 + cj * this.cz;
        const ring = (cm(ci - 2, cj) + cm(ci + 2, cj) + cm(ci, cj - 2) + cm(ci, cj + 2) + cm(ci - 2, cj - 2) + cm(ci + 2, cj - 2) + cm(ci - 2, cj + 2) + cm(ci + 2, cj + 2)) / 8;
        const hollow = smooth(0.5, 2.0, ring - mean[n]);
        const pocket = smooth(0.70, 0.85, pocketNoise(x / 110 + 7.3, z / 110 + 2.9));
        const drift = Math.max(hollow, pocket);
        let trap = smooth(0.45, 0.80, loose[n]) * clamp(0.95 * drift + 0.25 * Math.min(hollow, pocket) + 0.2 * smooth(3, 8, deg) * drift, 0, 1) * (1 - smooth(14, 22, deg));
        let safe = smooth(120, 240, Math.hypot(x - start.x, z - start.z));
        for (const p of pois) safe = Math.min(safe, smooth(70, 150, Math.hypot(x - p.x, z - p.z)));
        trap *= safe;
        D.sand[n] = Math.round(trap * 255);
        D.slope[n] = Math.round(clamp(smooth(10, 32, deg) * (0.6 + 0.4 * loose[n]) + smooth(26, 40, deg) * 0.4, 0, 1) * 255);
      }
      if ((cj & 15) === 0) await breathe(0.15 + 0.1 * cj / H);
    }

    // C. horizons, shelter and annual insolation
    const AZ = 8, STEPS = [32, 64, 96, 160, 256, 400, 640, 1000, 1600, 2500], hor = new Float32Array(AZ);
    const dirs = []; for (let a = 0; a < AZ; a++) { const t = a * 2 * Math.PI / AZ; dirs.push([Math.sin(t), -Math.cos(t)]); }     // bearing a x 45 deg: (x east, z south)
    const winds = PREVAILING.map((p) => ({ ux: Math.sin(p.from * D2R), uz: -Math.cos(p.from * D2R), w: p.w }));
    const WSTEPS = [32, 64, 96, 160, 240, 400];
    const lat = site.manifest.grid.lat0_deg, suns = [];
    let flat = 0;
    for (const ls of [0, 60, 120, 180, 240, 300]) for (let hr = 5.5; hr <= 18.5; hr += 1) {
      const s = sunPosition(lat, hr / 24 * 88775.244, ls);
      if (s.sinEl <= 0.02) continue;
      const I = surfaceIrradiance(s.sinEl, 0.6), az = s.azimuth * D2R, cosEl = Math.sqrt(1 - s.sinEl * s.sinEl);
      suns.push({ x: Math.sin(az) * cosEl, y: s.sinEl, z: -Math.cos(az) * cosEl, beam: I.direct / s.sinEl, diffuse: I.diffuse, tanEl: s.sinEl / cosEl, a: s.azimuth / 360 * AZ });
      flat += I.direct + I.diffuse;
    }
    const hAt = (x, z) => B[clamp(Math.round((z + site.halfZ) / sz - 0.5), 0, bh - 1) * bw + clamp(Math.round((x + site.halfX) / sx - 0.5), 0, bw - 1)];
    for (let cj = 0; cj < H; cj++) {
      for (let ci = 0; ci < W; ci++) {
        const n = cj * W + ci, x = this.x0 + ci * this.cx, z = this.z0 + cj * this.cz, h0 = mean[n] + 1.5;
        let blocked = 0;
        for (let a = 0; a < AZ; a++) {
          let t = 0;
          for (let s = 0; s < STEPS.length; s++) { const d = STEPS[s], v = (hAt(x + dirs[a][0] * d, z + dirs[a][1] * d) - h0) / d; if (v > t) t = v; }
          hor[a] = t; blocked += t * t / (1 + t * t);                 // sin^2 of the horizon angle
        }
        let sh = 0;
        for (const wd of winds) {
          let t = 0;
          for (let s = 0; s < WSTEPS.length; s++) { const d = WSTEPS[s], v = (hAt(x + wd.ux * d, z + wd.uz * d) - (h0 + 0.5)) / d; if (v > t) t = v; }
          sh += wd.w * smooth(2 * D2R, 12 * D2R, Math.atan(t));
        }
        D.shelter[n] = Math.round(sh * 255);
        // the cell's own facing
        const nl = 1 / Math.hypot(gx[n], 1, gz[n]), nx = -gx[n] * nl, ny = nl, nz = -gz[n] * nl;
        const view = (1 + ny) / 2 * (1 - blocked / AZ);
        let sum = 0;
        for (let k = 0; k < suns.length; k++) {
          const s = suns[k], a0 = Math.floor(s.a) % AZ, f = s.a - Math.floor(s.a);
          const horizon = hor[a0] + (hor[(a0 + 1) % AZ] - hor[a0]) * f;
          const lit = clamp((s.tanEl - horizon) / 0.03 + 0.5, 0, 1);
          const facing = nx * s.x + ny * s.y + nz * s.z;
          sum += s.beam * (facing > 0 ? facing : 0) * lit + s.diffuse * view;
        }
        D.solar[n] = Math.round(clamp(sum / flat, 0, 1.2) / 1.2 * 255);
      }
      if ((cj & 3) === 0) await breathe(0.25 + 0.65 * cj / H);
    }

    // D. the two scores
    let traps = 0, good = 0, sandy = 0;
    for (let n = 0; n < N; n++) {
      const deg = D.slope_deg[n] / 2.5, trap = D.sand[n] / 255, rough = D.rough[n] / 255, solar = Math.min(1, D.solar[n] / 255 * 1.2), shelter = D.shelter[n] / 255;
      D.traversability[n] = Math.round((1 - smooth(8, 28, deg)) * (1 - 0.85 * trap) * (1 - 0.4 * rough) * 255);
      D.suitability[n] = Math.round((1 - smooth(3, 12, deg)) * (1 - 0.7 * trap) * (1 - 0.5 * rough) * (0.5 + 0.5 * solar) * (0.85 + 0.15 * shelter) * 255);
      if (trap > 0.55) traps++;
      if (loose[n] > 0.45) sandy++;
      if (D.suitability[n] > 190) good++;
    }
    this.ms = performance.now() - t0;
    this.stats = { cells: N, cell_m: [this.cx, this.cz], trap_fraction: traps / N, trap_fraction_of_sand: sandy ? traps / sandy : 0, good_base_fraction: good / N, ms: Math.round(this.ms) };
    this.ready = true;
    onProgress(1);
    return this;
  }

  _read(layer, u, v) {
    const W = this.w, H = this.h, A = this.data[layer];
    u = clamp(u, 0, W - 1.001); v = clamp(v, 0, H - 1.001);
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * W + i;
    return (A[k] * (1 - fu) * (1 - fv) + A[k + 1] * fu * (1 - fv) + A[k + W] * (1 - fu) * fv + A[k + W + 1] * fu * fv) / 255;
  }
  /** Bilinear read of every layer at a world position. All 0..1 except slope_deg (degrees) and solar (0..1.2). */
  sample(x, z, out = {}) {
    if (!this.ready) return Object.assign(out, { slope: 0, sand: 0, shelter: 0, solar: 1, traversability: 1, suitability: 0, slope_deg: 0, ready: false });
    const u = (x - this.x0) / this.cx, v = (z - this.z0) / this.cz;
    out.slope = this._read("slope", u, v); out.sand = this._read("sand", u, v); out.shelter = this._read("shelter", u, v);
    out.solar = this._read("solar", u, v) * 1.2; out.traversability = this._read("traversability", u, v); out.suitability = this._read("suitability", u, v);
    out.slope_deg = this._read("slope_deg", u, v) * 255 / 2.5; out.ready = true;
    return out;
  }
  /** One layer at a position (cheaper than sample when only one is wanted). */
  value(layer, x, z) { return this.ready ? this._read(layer, (x - this.x0) / this.cx, (z - this.z0) / this.cz) * (layer === "solar" ? 1.2 : layer === "slope_deg" ? 255 / 2.5 : 1) : 0; }
  /** The best (highest) cell of a layer within `radius` metres: { x, z, value }. For "where should the base go?". */
  best(layer, x, z, radius = 300) {
    if (!this.ready) return null;
    const A = this.data[layer], W = this.w, H = this.h;
    const i0 = Math.round((x - this.x0) / this.cx), j0 = Math.round((z - this.z0) / this.cz), ri = Math.ceil(radius / this.cx), rj = Math.ceil(radius / this.cz);
    let best = null;
    for (let j = Math.max(0, j0 - rj); j <= Math.min(H - 1, j0 + rj); j++) for (let i = Math.max(0, i0 - ri); i <= Math.min(W - 1, i0 + ri); i++) {
      const px = this.x0 + i * this.cx, pz = this.z0 + j * this.cz;
      if (Math.hypot(px - x, pz - z) > radius) continue;
      if (!best || A[j * W + i] > best.raw) best = { x: px, z: pz, raw: A[j * W + i] };
    }
    if (best) { best.value = best.raw / 255 * (layer === "solar" ? 1.2 : 1); delete best.raw; }
    return best;
  }

  /* ── the ground overlay (drawn by the terrain shader through its uOverlay hook) ── */

  /** Paint one layer into the overlay texture: red (bad) through amber to green (good). */
  paint(layerId) {
    const L = LAYERS.find((l) => l.id === layerId) || LAYERS[0], A = this.data[L.id], N = this.w * this.h;
    if (!this.pixels) this.pixels = new Uint8Array(N * 4);
    const px = this.pixels;
    for (let n = 0; n < N; n++) {
      let v = A[n] / 255;
      if (L.id === "solar") v = Math.min(1, v * 1.2);
      const g = L.invert ? 1 - v : v;                 // 1 = good
      // linear-light colours: the terrain shader lights them
      let r, gr, b;
      if (g < 0.5) { const t = g * 2; r = 0.80 + 0.10 * t; gr = 0.05 + 0.50 * t; b = 0.04; }
      else { const t = g * 2 - 2 + 1; r = 0.90 - 0.84 * t; gr = 0.55 + 0.10 * t; b = 0.04 + 0.16 * t; }
      // risk layers leave safe ground almost clear, so the hazards stand out; score layers tint everything, bad ground hardest
      const alpha = L.invert ? 0.08 + 0.62 * smooth(0.08, 0.6, v) : 0.30 + 0.32 * (1 - g);
      px[n * 4] = Math.round(r * 255); px[n * 4 + 1] = Math.round(gr * 255); px[n * 4 + 2] = Math.round(b * 255); px[n * 4 + 3] = Math.round(alpha * 255);
    }
    if (!this.texture) {
      const t = this.texture = new THREE.DataTexture(px, this.w, this.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false;
    }
    this.texture.needsUpdate = true;
    this.overlay.layer = L.id;
    return L;
  }
  /** Show or hide the overlay. Needs the terrain's uOverlay uniforms (terrain.js); does nothing without them. */
  setOverlay(game, on, layerId = this.overlay.layer) {
    const U = game.terrain && game.terrain.uniforms;
    if (!this.ready || !U || !U.uOverlay) return false;
    if (on) {
      this.paint(layerId);
      U.uOverlay.value = this.texture;
      U.uOverlayRect.value.set(this.x0 - this.cx / 2, this.z0 - this.cz / 2, 1 / (this.w * this.cx), 1 / (this.h * this.cz));
    }
    U.uOverlayOn.value = on ? 1 : 0;
    this.overlay.on = !!on;
    return true;
  }
}
