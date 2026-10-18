/**
 * Detail below the data's resolution, and the interface for supplying it.
 *
 * The finest thing measured here is a 1 m HiRISE post (and over most of the
 * site, a 20 m CTX post). A rover wheel is 0.9 m across. Everything between
 * what was measured and what a wheel feels is GENERATED, and this module is
 * the only place it comes from, so that it can be labelled, switched off, and
 * replaced.
 *
 * ── THE DETAIL-PROVIDER INTERFACE ────────────────────────────────────────
 * A provider adds a height to the measured surface. It must give the SAME
 * number on the CPU (physics, placement, saves) and on the GPU (the vertices
 * you see), as a pure function of world position: a base placed today must
 * sit on the same ground next week.
 *
 *   provider.id            "procedural-v1"            saved with the game
 *   provider.label         shown in the HUD's honesty read-out
 *   provider.minWavelength metres; the smallest feature it puts in the
 *                          GEOMETRY (the clipmap sizes its fade from this)
 *   await provider.init({ site, field, albedo })
 *                          build whatever it needs. `field` is the measured
 *                          heightfield, `albedo` the whole-site CTX image
 *                          {data: Uint8Array, width, height}: both complete
 *                          and static, so conditioning on them is
 *                          deterministic whatever has streamed in.
 *   provider.height(x, z)  metres to ADD to field.height at full strength
 *                          (what physics and placement use)
 *   provider.regolith(x, z, out)
 *                          {sand, rock, res} in 0..1: how loose, how rocky,
 *                          and how coarse the data is here. The vehicle reads
 *                          traction from it and rocks.js reads density.
 *   provider.uniforms      three.js uniforms the GLSL below needs
 *   provider.glslVertex    GLSL defining
 *                              float detailHeight(vec2 xz, float dist)
 *                          which must equal provider.height(x, z) wherever
 *                          dist (metres from the focus) is small, and may
 *                          fade what a coarse mesh cannot carry beyond that
 *   provider.glslFragment  GLSL defining
 *                              void detailShade(vec3 P, float dist, inout vec3 N, inout float albedo)
 *                          shading-only detail (no physical meaning)
 *
 * A LEARNED UPSCALER fits the same shape. Precomputed offline per site: ship
 * residual-height tiles (a third pyramid kind), sample them bilinearly in
 * height(), and bind the same window as a texture for detailHeight(). Run in
 * the browser (WebGPU) later: infer residual tiles on demand into the same
 * cache; nothing else changes. What it may NOT do is return different values
 * for the same position on different visits.
 *
 * ── WHAT THE PROCEDURAL PROVIDER DOES ────────────────────────────────────
 * Lattice value noise whose lattice values are bytes of one 256 x 256
 * texture, generated from a fixed seed. JavaScript reads the bytes from the
 * array and the vertex shader reads them with texelFetch, both interpolate
 * with the same smoothstep, so the two agree to float precision without any
 * hash having to behave identically in two languages.
 *
 *   fill      24, 12, 6 and 3 m octaves, only where the data is coarse
 *             (weight = how far the data is from 1 m here), scaled by the
 *             measured 16 m roughness
 *   micro     1.6 and 0.7 m octaves everywhere, stronger on rocky ground
 *   ripples   aeolian ripples (2.6 m wavelength, about 0.1 m high) on flat,
 *             smooth, dark ground
 *   craters   one small bowl with a raised rim in about a third of 40 m
 *             cells, 1 to 7 m across
 *
 * All of it is conditioned on a "regolith map" computed once from the real
 * data on the 16 m grid: slope and roughness from the DTM, brightness from
 * the CTX image. The conditioning is a heuristic and is not a measurement
 * of grain size.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { installStyle } from "./detailstyle.js?v=6d37c9c-9b39e129";

const SEED = 0x4d415253;       // "MARS"
const TAU = Math.PI * 2;

/** wavelength m, amplitude m, rotation rad, family, lattice offset */
export const OCTAVES = [
  { lambda: 24.0, amp: 0.55, rot: 0.00, family: "fill", ox: 11.3, oz: 47.1 },
  { lambda: 12.0, amp: 0.32, rot: 0.56, family: "fill", ox: 71.7, oz: 3.9 },
  { lambda: 6.0, amp: 0.19, rot: 1.12, family: "fill", ox: 29.4, oz: 83.2 },
  { lambda: 3.0, amp: 0.11, rot: 1.68, family: "fill", ox: 53.8, oz: 17.6 },
  { lambda: 1.6, amp: 0.050, rot: 2.24, family: "micro", ox: 5.1, oz: 61.3 },
  { lambda: 0.7, amp: 0.022, rot: 2.80, family: "micro", ox: 37.9, oz: 91.4 },
];
const RIPPLE = { lambda: 2.6, amp: 0.10, warp: 1.7, warpScale: 7.3, dirX: 0.78, dirZ: 0.6258 };
const CRATER = { cell: 40, chance: 0.34, rMin: 0.6, rMax: 3.6, depth: 0.22, rim: 0.05 };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class ProceduralDetail {
  constructor() {
    this.id = "procedural-v1";
    this.label = "procedural (generated, not measured)";
    this.minWavelength = 0.7;
    // The lattice. 256 x 256 RGBA bytes from a fixed seed: R is the value
    // noise lattice, G B A are per-cell randoms for craters and rocks.
    const rnd = mulberry32(SEED);
    this.lattice = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < this.lattice.length; i++) this.lattice[i] = (rnd() * 256) | 0;
    this.latticeTex = new THREE.DataTexture(this.lattice, 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.latticeTex.minFilter = this.latticeTex.magFilter = THREE.NearestFilter;
    this.latticeTex.wrapS = this.latticeTex.wrapT = THREE.RepeatWrapping;
    this.latticeTex.generateMipmaps = false;
    this.latticeTex.needsUpdate = true;

    this.grainTex = makeGrainTexture(rnd);
    this.cond = null; this.cw = 0; this.ch = 0;
    this.uniforms = {
      uLattice: { value: this.latticeTex },
      uGrain: { value: this.grainTex },
      uCond: { value: null },
      uCondGrid: { value: new THREE.Vector4(0, 0, 1, 1) },   // x0, z0 (world of sample 0), 1/sx, 1/sz
      uCondSize: { value: new THREE.Vector2(1, 1) },
      uDetailOn: { value: 1 },
      uFadeK: { value: 12 },          // set by the terrain from its grid: metres of reach per metre of wavelength
      uMicro: { value: 1 },
    };
    for (const o of OCTAVES) { o.c = Math.cos(o.rot); o.s = Math.sin(o.rot); }
  }

  /**
   * Build the regolith map from the static data: R = how coarse the data is
   * (0 HiRISE .. 255 CTX), G = sand, B = rock, A = roughness.
   */
  async init({ site, field, albedo }) {
    // A regional site's manifest carries a surface style (tools/build_regional.py): the same
    // contract, conditioned per site, in detailstyle.js. Jezero and Gale carry none.
    const style = site.manifest && site.manifest.style;
    if (style) return installStyle(this, { site, field, albedo, style, stock: { OCTAVES, RIPPLE, CRATER } });
    const w = field.bw, h = field.bh, H = field.baseH, P = field.baseP;
    const sx = field.base.mpp * site.cos, sz = field.base.mpp;
    const cond = new Uint8Array(w * h * 4);
    // mean brightness of the CTX image per 16 m cell
    const bright = new Float32Array(w * h);
    if (albedo) {
      const ax = albedo.width / w, az = albedo.height / h;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let acc = 0, n = 0;
        const j0 = Math.floor(j * az), j1 = Math.max(j0 + 1, Math.floor((j + 1) * az));
        const i0 = Math.floor(i * ax), i1 = Math.max(i0 + 1, Math.floor((i + 1) * ax));
        for (let b = j0; b < j1; b++) for (let a = i0; a < i1; a++) { acc += albedo.data[b * albedo.width + a]; n++; }
        bright[j * w + i] = acc / n / 255;
      }
    } else bright.fill(0.5);
    let mean = 0; for (let k = 0; k < bright.length; k += 97) mean += bright[k];
    mean /= Math.ceil(bright.length / 97);
    for (let j = 0; j < h; j++) {
      const ja = Math.max(0, j - 1), jb = Math.min(h - 1, j + 1);
      for (let i = 0; i < w; i++) {
        const ia = Math.max(0, i - 1), ib = Math.min(w - 1, i + 1);
        const c = H[j * w + i];
        const dx = (H[j * w + ib] - H[j * w + ia]) / ((ib - ia) * sx);
        const dz = (H[jb * w + i] - H[ja * w + i]) / ((jb - ja) * sz);
        const slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
        // roughness: how far the cell is from the mean of its 8 neighbours (metres)
        const nb = (H[ja * w + ia] + H[ja * w + i] + H[ja * w + ib] + H[j * w + ia] + H[j * w + ib] + H[jb * w + ia] + H[jb * w + i] + H[jb * w + ib]) / 8;
        const rough = Math.abs(c - nb);
        const p = P[j * w + i];
        const res = p >= 255 ? 0 : p > 64 ? 1 - (p - 65) / 190 : 1;
        const dark = smooth(mean - 0.01, mean - 0.13, bright[j * w + i]);
        const sand = (1 - smooth(4, 13, slope)) * (1 - smooth(0.2, 0.8, rough)) * (0.12 + 0.88 * dark) * 0.95;
        const rock = Math.min(1, smooth(7, 24, slope) * 0.8 + smooth(0.35, 1.6, rough) * 0.6 + (1 - dark) * 0.18);
        const k = (j * w + i) * 4;
        cond[k] = Math.round(res * 255);
        cond[k + 1] = Math.round(sand * 255);
        cond[k + 2] = Math.round(rock * 255);
        cond[k + 3] = Math.round(smooth(0.1, 1.6, rough) * 255);
      }
    }
    this.cond = cond; this.cw = w; this.ch = h;
    this.cx0 = -site.halfX + 0.5 * sx; this.cz0 = -site.halfZ + 0.5 * sz;
    this.isx = 1 / sx; this.isz = 1 / sz;
    const tex = new THREE.DataTexture(cond, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.condTex = tex;
    this.uniforms.uCond.value = tex;
    this.uniforms.uCondGrid.value.set(this.cx0, this.cz0, this.isx, this.isz);
    this.uniforms.uCondSize.value.set(w, h);
  }

  /* ── CPU side ─────────────────────────────────────────────────────────*/

  _lat(i, j, ch) { return this.lattice[(((j & 255) << 8) | (i & 255)) * 4 + ch] / 255; }

  _vnoise(px, pz) {
    const i = Math.floor(px), j = Math.floor(pz);
    const fx = px - i, fz = pz - j;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = this._lat(i, j, 0), b = this._lat(i + 1, j, 0), c = this._lat(i, j + 1, 0), d = this._lat(i + 1, j + 1, 0);
    return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
  }

  /** Bilinear read of the regolith map. out = {res, sand, rock, rough}, all 0..1. */
  regolith(x, z, out = {}) {
    const w = this.cw, h = this.ch, C = this.cond;
    let u = (x - this.cx0) * this.isx, v = (z - this.cz0) * this.isz;
    if (u < 0) u = 0; else if (u > w - 1.001) u = w - 1.001;
    if (v < 0) v = 0; else if (v > h - 1.001) v = h - 1.001;
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j;
    const k = (j * w + i) * 4, k2 = k + w * 4;
    const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
    out.res = (C[k] * w00 + C[k + 4] * w10 + C[k2] * w01 + C[k2 + 4] * w11) / 255;
    out.sand = (C[k + 1] * w00 + C[k + 5] * w10 + C[k2 + 1] * w01 + C[k2 + 5] * w11) / 255;
    out.rock = (C[k + 2] * w00 + C[k + 6] * w10 + C[k2 + 2] * w01 + C[k2 + 6] * w11) / 255;
    out.rough = (C[k + 3] * w00 + C[k + 7] * w10 + C[k2 + 3] * w01 + C[k2 + 7] * w11) / 255;
    return out;
  }

  /** Metres added to the measured surface at (x, z). Deterministic. */
  height(x, z) {
    const g = this._g || (this._g = {});
    this.regolith(x, z, g);
    const fill = g.res * (0.45 + 1.1 * g.rough);
    const micro = (0.5 + 0.9 * g.rock) * (1 - 0.6 * g.sand);
    let h = 0;
    for (let n = 0; n < OCTAVES.length; n++) {
      const o = OCTAVES[n];
      const w = o.family === "fill" ? fill : micro;
      if (w <= 0) continue;
      const px = (x * o.c - z * o.s) / o.lambda + o.ox, pz = (x * o.s + z * o.c) / o.lambda + o.oz;
      h += o.amp * w * (2 * this._vnoise(px, pz) - 1);
    }
    if (g.sand > 0.001) {
      const ph = (x * RIPPLE.dirX + z * RIPPLE.dirZ) / RIPPLE.lambda + RIPPLE.warp * this._vnoise(x / RIPPLE.warpScale + 3.3, z / RIPPLE.warpScale + 8.1);
      const s = 0.5 + 0.5 * Math.sin(TAU * ph);
      h += RIPPLE.amp * g.sand * (s * s - 0.375);
    }
    // crater: at most one per 40 m cell, wholly inside its own cell
    const ci = Math.floor(x / CRATER.cell), cj = Math.floor(z / CRATER.cell);
    if (this._lat(ci, cj, 1) < CRATER.chance) {
      const ccx = (ci + 0.25 + 0.5 * this._lat(ci, cj, 2)) * CRATER.cell;
      const ccz = (cj + 0.25 + 0.5 * this._lat(ci, cj, 3)) * CRATER.cell;
      const q = this._lat(ci + 91, cj + 37, 1);
      const r = (CRATER.rMin + (CRATER.rMax - CRATER.rMin) * q * q) * (0.45 + 0.55 * g.res);
      const t = Math.hypot(x - ccx, z - ccz) / r;
      if (t < 1.6) {
        const t2 = t * t;
        const prof = t < 1 ? -CRATER.depth * (1 - t2) + CRATER.rim * t2
          : CRATER.rim * Math.exp(-(t - 1) / 0.3) * (1 - smooth(1.3, 1.6, t));
        h += prof * r * 2;
      }
    }
    return h;
  }
}

/**
 * A tileable fractal noise and its slope, for shading only: R = value,
 * G = d/dx, B = d/dz (0.5 = flat). Filtered and mip-mapped, so it costs one
 * fetch an octave and never aliases; it never moves a vertex.
 */
function makeGrainTexture(rnd) {
  const N = 256, f = new Float32Array(N * N);
  for (let o = 0; o < 5; o++) {
    const per = 8 << o, amp = Math.pow(0.55, o);
    const lat = new Float32Array(per * per);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd() * 2 - 1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N * per, v = y / N * per;
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const ux = fu * fu * (3 - 2 * fu), uy = fv * fv * (3 - 2 * fv);
      const a = lat[(j % per) * per + (i % per)], b = lat[(j % per) * per + ((i + 1) % per)];
      const c = lat[((j + 1) % per) * per + (i % per)], d = lat[((j + 1) % per) * per + ((i + 1) % per)];
      f[y * N + x] += amp * ((a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy);
    }
  }
  const out = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = y * N + x;
    const dx = f[y * N + ((x + 1) % N)] - f[y * N + ((x + N - 1) % N)];
    const dy = f[((y + 1) % N) * N + x] - f[((y + N - 1) % N) * N + x];
    out[k * 4] = Math.max(0, Math.min(255, 128 + f[k] * 70));
    out[k * 4 + 1] = Math.max(0, Math.min(255, 128 + dx * 260));
    out[k * 4 + 2] = Math.max(0, Math.min(255, 128 + dy * 260));
    out[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(out, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;            // the ground is always seen at a grazing angle
  t.needsUpdate = true;
  return t;
}

/* ── GPU side: generated from the same tables ───────────────────────────── */

const f = (v) => { const s = String(v); return /[.e]/.test(s) ? s : s + ".0"; };

const octaveGlsl = OCTAVES.map((o) => {
  const c = Math.cos(o.rot), s = Math.sin(o.rot);
  const w = o.family === "fill" ? "wFill" : "wMicro";
  return `    h += ${f(o.amp)} * ${w} * dFade(${f(o.lambda)}, dist) * (2.0 * dVnoise(vec2(xz.x * ${f(c)} - xz.y * ${f(s)}, xz.x * ${f(s)} + xz.y * ${f(c)}) / ${f(o.lambda)} + vec2(${f(o.ox)}, ${f(o.oz)})) - 1.0);`;
}).join("\n");

ProceduralDetail.prototype.glslVertex = /* glsl */`
  uniform highp sampler2D uLattice;
  uniform highp sampler2D uCond;
  uniform vec4  uCondGrid;
  uniform vec2  uCondSize;
  uniform float uDetailOn;
  uniform float uFadeK;

  vec4 dLat(ivec2 p) { return texelFetch(uLattice, p & 255, 0); }

  float dVnoise(vec2 p) {
    vec2 i = floor(p), fr = p - i;
    vec2 u = fr * fr * (3.0 - 2.0 * fr);
    ivec2 b = ivec2(i);
    float a = dLat(b).r, bb = dLat(b + ivec2(1, 0)).r, c = dLat(b + ivec2(0, 1)).r, d = dLat(b + ivec2(1, 1)).r;
    return (a + (bb - a) * u.x) * (1.0 - u.y) + (c + (d - c) * u.x) * u.y;
  }

  /* The regolith map, read with an explicit bilinear so the weights are the
     CPU's weights and not the sampler's 8-bit ones. */
  vec4 dCond(vec2 xz) {
    vec2 uv = clamp((xz - uCondGrid.xy) * uCondGrid.zw, vec2(0.0), uCondSize - 1.001);
    vec2 i = floor(uv), fr = uv - i;
    ivec2 b = ivec2(i);
    vec4 a = texelFetch(uCond, b, 0), bb = texelFetch(uCond, b + ivec2(1, 0), 0);
    vec4 c = texelFetch(uCond, b + ivec2(0, 1), 0), d = texelFetch(uCond, b + ivec2(1, 1), 0);
    return (a * (1.0 - fr.x) + bb * fr.x) * (1.0 - fr.y) + (c * (1.0 - fr.x) + d * fr.x) * fr.y;
  }

  /* An octave is drawn only where the mesh is fine enough to carry it. Full
     strength near the focus (where the wheels are), gone before the ring
     whose cells are too coarse for it. */
  float dFade(float lambda, float dist) {
    float reach = max(6.0, lambda * uFadeK);
    return 1.0 - smoothstep(0.5 * reach, reach, dist);
  }

  float detailHeightC(vec2 xz, float dist, vec4 g) {
    float wFill = g.r * (0.45 + 1.1 * g.a);
    float wMicro = (0.5 + 0.9 * g.b) * (1.0 - 0.6 * g.g);
    float h = 0.0;
${octaveGlsl}
    if (g.g > 0.001) {
      float ph = dot(xz, vec2(${f(RIPPLE.dirX)}, ${f(RIPPLE.dirZ)})) / ${f(RIPPLE.lambda)} + ${f(RIPPLE.warp)} * dVnoise(xz / ${f(RIPPLE.warpScale)} + vec2(3.3, 8.1));
      float s = 0.5 + 0.5 * sin(6.283185307179586 * ph);
      h += ${f(RIPPLE.amp)} * g.g * dFade(${f(RIPPLE.lambda)}, dist) * (s * s - 0.375);
    }
    vec2 cf = floor(xz / ${f(CRATER.cell)});
    ivec2 ci = ivec2(cf);
    vec4 l = dLat(ci);
    if (l.g < ${f(CRATER.chance)}) {
      vec2 cc = (cf + 0.25 + 0.5 * l.ba) * ${f(CRATER.cell)};
      float q = dLat(ci + ivec2(91, 37)).g;
      float r = (${f(CRATER.rMin)} + ${f(CRATER.rMax - CRATER.rMin)} * q * q) * (0.45 + 0.55 * g.r);
      float t = length(xz - cc) / r;
      if (t < 1.6) {
        float t2 = t * t;
        float prof = t < 1.0 ? -${f(CRATER.depth)} * (1.0 - t2) + ${f(CRATER.rim)} * t2
          : ${f(CRATER.rim)} * exp(-(t - 1.0) / 0.3) * (1.0 - smoothstep(1.3, 1.6, t));
        h += prof * r * 2.0 * dFade(max(r, 1.0), dist);
      }
    }
    return h * uDetailOn;
  }

  float detailHeight(vec2 xz, float dist) { return detailHeightC(xz, dist, dCond(xz)); }
`;

ProceduralDetail.prototype.glslFragment = /* glsl */`
  uniform sampler2D uGrain;
  uniform highp sampler2D uCond;
  uniform vec4  uCondGrid;
  uniform vec2  uCondSize;
  uniform float uDetailOn;
  uniform float uMicro;

  vec4 detailCond(vec2 xz) {
    return texture2D(uCond, ((xz - uCondGrid.xy) * uCondGrid.zw + 0.5) / uCondSize);
  }

  /* Shading-only grain: two scales of a mip-mapped slope texture, rotated
     against each other so their lattices never line up. Bends the normal and
     nudges the brightness; moves nothing. */
  void detailShade(vec3 P, float dist, inout vec3 N, inout float albedo) {
    if (uDetailOn <= 0.0 || uMicro <= 0.0) return;
    vec4 g = detailCond(P.xz);
    float near = 1.0 - smoothstep(60.0, 220.0, dist);
    vec2 p0 = vec2(P.x * 0.966 + P.z * 0.259, -P.x * 0.259 + P.z * 0.966) / 23.0;
    vec2 p1 = P.xz / 5.2;
    vec2 p2 = vec2(P.x * 0.829 - P.z * 0.559, P.x * 0.559 + P.z * 0.829) / 1.15;
    vec3 c = texture2D(uGrain, p0).rgb - 0.5;
    vec3 a = texture2D(uGrain, p1).rgb - 0.5;
    vec3 b = texture2D(uGrain, p2).rgb - 0.5;
    float k = uMicro * (0.75 + 0.9 * g.b - 0.3 * g.g) * near;
    vec2 slope = (a.gb * 0.9 + vec2(b.g * 0.829 + b.b * 0.559, -b.g * 0.559 + b.b * 0.829) * 1.2) * k;
    N = normalize(N - vec3(slope.x, 0.0, slope.y) * 1.6);
    albedo *= 1.0 + (c.r * 0.30 + a.r * 0.34 + b.r * 0.36) * k;
  }

  /* The site's tint (detailstyle.js). The stock provider leaves the terrain's own ramp alone. */
  void detailTint(vec3 P, float dist, vec3 N, float lum, inout vec3 albedo) {}
`;
