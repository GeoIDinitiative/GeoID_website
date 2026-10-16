/**
 * SURFACE STYLES: the procedural detail provider, conditioned per site.
 *
 * Jezero and Gale carry 1 m HiRISE terrain where you drive; the regional
 * sites (tools/build_regional.py) carry 50 to 200 m posts (HRSC, the MOLA-HRSC
 * blend, MOLA's polar grid). Between those posts and a wheel there is two
 * orders of magnitude of ground that nobody has measured, and what it looks
 * like is what makes a place read as itself: layered ice and frost on the
 * polar scarps, scallops in Utopia, benches and talus on a canyon wall, pit
 * chains in Tharsis lava. A site's manifest carries a "style" (written from
 * tools/sites/<id>.site.json) and this module turns it into the same
 * detail-provider contract detail.js documents:
 *
 *     height(x, z)        CPU, metres added to the measured surface
 *     regolith(x, z, out) {res, sand, rock, rough, ice, calm}
 *     glslVertex          float detailHeight(vec2 xz, float dist)  (+ detailHeightC, dCond)
 *     glslFragment        detailShade(...) and detailTint(...)
 *
 * EVERYTHING HERE IS GENERATED. The CPU and GPU agree by the rule detail.js
 * set out: every random number is a byte of the one seeded lattice texture
 * (texelFetch on the GPU, the array on the CPU), every condition is read from
 * a map built once from data complete at boot (the 16 m heights, their
 * provenance, the base image), with an explicit bilinear on both sides; the
 * GLSL below is written line for line against the JavaScript next to it.
 *
 * WHAT A STYLE CAN ASK FOR (all optional; tools/sites/*.site.json "style")
 *   fill: [{lambda, amp, ridged}]  octaves longer than the stock 24 m one, added
 *                       where the data's post spacing exceeds lambda / 2.5
 *   fillGain, microGain, microRidged   the stock octaves' strength; ridged
 *                       micro octaves read as blocky lava
 *   sand, rock, rockBias, ripples, craters   the regolith heuristic and the stock features
 *   polygons: [{cell, depth, width}]   patterned ground (thermal-contraction polygons)
 *   scallops: {cell, chance, depth, aspect}   rimless, asymmetric depressions:
 *                       steep pole-facing scarp, gentle equator-facing slope
 *   terraces: {spacing, sharp, slope}   layering: the measured surface stepped into
 *                       benches and risers on slopes steeper than slope[0] degrees
 *   cracks: {lambda, width, depth}     a network of narrow fractures
 *   pitChains: {az, lx, ly, chance, pit, rMin, rMax, depth}   collapse-pit chains
 *   ice: {elev, bright, slope, region}   where the ground is ice (tint, firmness, smoothness)
 *   calmDamp           how much a "calm" feature flattens the generated relief
 *   features: [{type: crater | pit | calm, x, z, r, depth, rim, ice, ramp: {az, width, len}}]
 *   tint: {dark, mid, bright, ice, frost, range, iceAmount, frost amount, bands}
 * The honesty view hatches all of it magenta (it is all displacement), and
 * the HUD's detail line names the style.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";

const MAXF = 8;
const TYPES = { crater: 1, pit: 2, calm: 3 };
const LUM = [0.299, 0.587, 0.114];

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fx = (v) => { const s = String(+(+v).toPrecision(7)); return /[.e]/.test(s) ? s : s + ".0"; };
const v3 = (c) => `vec3(${fx(c[0])}, ${fx(c[1])}, ${fx(c[2])})`;

/** The stock octaves (detail.js) and the style's longer ones, in one table. */
function octaveTable(S, stock) {
  const out = [];
  let k = 0;
  for (const o of S.fill || []) {
    const rot = 0.37 + 1.13 * k, ox = 19.7 + 31.3 * k, oz = 7.3 + 23.9 * k; k++;
    out.push({ lambda: o.lambda, amp: o.amp, rot, ox, oz, family: "fill", ridged: !!o.ridged });
  }
  for (const o of stock) out.push(Object.assign({}, o, { ridged: o.family === "micro" ? !!S.microRidged : !!S.fillRidged }));
  for (const o of out) { o.c = Math.cos(o.rot); o.s = Math.sin(o.rot); }
  return out;
}

export async function installStyle(P, { site, field, albedo, style, stock }) {
  const S = style;
  const man = site.manifest;
  P.style = S;
  P.id = "procedural-styled-v1:" + site.id;
  P.label = `procedural, "${S.name || "styled"}" style (generated, not measured)`;
  const OCT = octaveTable(S, stock.OCTAVES);
  const RIPPLE = stock.RIPPLE, CRATER = stock.CRATER;
  const crChance = CRATER.chance * (S.craters != null ? S.craters : 1);
  const ripAmp = RIPPLE.amp * (S.ripples != null ? S.ripples : 1);
  const fillGain = S.fillGain != null ? S.fillGain : 1, microGain = S.microGain != null ? S.microGain : 1;
  const calmDamp = S.calmDamp != null ? S.calmDamp : 0.85;
  const iceSmooth = S.iceSmooth != null ? S.iceSmooth : 0.75;
  const polys = (S.polygons || []).slice(0, 2);
  const sc = S.scallops, tr = S.terraces, ck = S.cracks, pc = S.pitChains;

  // ── features ────────────────────────────────────────────────────────────
  const feats = (S.features || []).filter((f) => TYPES[f.type]).slice(0, 16);
  const shaped = feats.filter((f) => f.type !== "calm").slice(0, MAXF);
  const FA = [], FB = [], FC = [];
  for (let i = 0; i < MAXF; i++) {
    const f = shaped[i];
    FA.push(new THREE.Vector4(f ? f.x : 0, f ? f.z : 0, f ? f.r : 1, f ? f.depth || 0 : 0));
    const ramp = f && f.ramp;
    FB.push(new THREE.Vector4(f ? TYPES[f.type] : 0, f ? f.rim || 0 : 0, ramp ? ramp.az * Math.PI / 180 : 0, ramp ? ramp.width : 0));
    FC.push(new THREE.Vector4(ramp ? ramp.len : 0, f && f.ice ? 1 : 0, 0, 0));
  }
  P.features = shaped;

  // ── the condition maps (once, from the static data) ───────────────────
  const w = field.bw, h = field.bh, H = field.baseH, PB = field.baseP;
  const sx = field.base.mpp * site.cos, sz = field.base.mpp;
  const ref = man.height.ref;
  const nat = S.native_m || {};
  const n255 = nat["255"] || 50, n64 = nat["64"] || 200;
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
  const cond = new Uint8Array(w * h * 4), cond2 = new Uint8Array(w * h * 4);
  const cx0 = -site.halfX + 0.5 * sx, cz0 = -site.halfZ + 0.5 * sz;
  const ice = S.ice || null;
  const calmF = feats.filter((f) => f.type === "calm");
  for (let j = 0; j < h; j++) {
    const ja = Math.max(0, j - 1), jb = Math.min(h - 1, j + 1);
    const wz = cz0 + j * sz;
    for (let i = 0; i < w; i++) {
      const ia = Math.max(0, i - 1), ib = Math.min(w - 1, i + 1);
      const wx = cx0 + i * sx;
      const c = H[j * w + i];
      const dx = (H[j * w + ib] - H[j * w + ia]) / ((ib - ia) * sx);
      const dz = (H[jb * w + i] - H[ja * w + i]) / ((jb - ja) * sz);
      const slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
      const nb = (H[ja * w + ia] + H[ja * w + i] + H[ja * w + ib] + H[j * w + ia] + H[j * w + ib] + H[jb * w + ia] + H[jb * w + i] + H[jb * w + ib]) / 8;
      const rough = Math.abs(c - nb);
      const p = PB[j * w + i];
      const native = p >= 255 ? n255 : p > 64 ? n64 + (n255 - n64) * (p - 65) / 189 : n64;
      const br = bright[j * w + i];
      const dark = sm(mean - 0.01, mean - 0.13, br);
      // ice: where the style says the ground is ice
      let ic = 0;
      if (ice) {
        ic = 1;
        const elev = c + ref;
        if (ice.elev) ic *= sm(ice.elev[0], ice.elev[1], elev);
        if (ice.bright) ic *= sm(ice.bright[0], ice.bright[1], br / mean);
        if (ice.slope) ic *= 1 - sm(ice.slope[0], ice.slope[1], slope);
        if (ice.region) { const R = ice.region; ic *= 1 - sm(R.r, R.r + (R.fade || 1000), Math.hypot(wx - R.x, wz - R.z)); }
        ic *= ice.amount != null ? ice.amount : 1;
      }
      let calm = 0;
      for (const f of calmF) calm = Math.max(calm, 1 - sm(f.r, f.r * 1.5 + 30, Math.hypot(wx - f.x, wz - f.z)));
      let sand = (1 - sm(4, 13, slope)) * (1 - sm(0.2 * native / 16, 0.8 * native / 16, rough)) * (0.12 + 0.88 * dark) * 0.95;
      let rock = Math.min(1, sm(7, 24, slope) * 0.8 + sm(0.35, 1.6, rough) * 0.6 + (1 - dark) * 0.18);
      sand = Math.min(1, sand * (S.sand != null ? S.sand : 1)) * (1 - 0.9 * ic);
      rock = Math.min(1, Math.max(0, rock * (S.rock != null ? S.rock : 1) + (S.rockBias || 0))) * (1 - 0.75 * ic);
      for (const f of shaped) {
        const t = Math.hypot(wx - f.x, wz - f.z) / f.r;
        if (f.type === "crater") rock = Math.max(rock, 0.85 * sm(0.6, 1.0, t) * (1 - sm(1.4, 2.6, t)));
        if (f.type === "pit") { rock = Math.max(rock, 0.8 * (1 - sm(1.0, 1.6, t))); sand *= sm(0.9, 1.3, t); }
      }
      rock *= 1 - 0.92 * calm; sand *= 1 - 0.4 * calm;
      let ro = sm(0.1, 1.6, rough) * (1 - calm);
      const k = (j * w + i) * 4;
      cond[k] = Math.round(sm(1, 30, native) * 255);
      cond[k + 1] = Math.round(sand * 255);
      cond[k + 2] = Math.round(rock * 255);
      cond[k + 3] = Math.round(ro * 255);
      cond2[k] = Math.round(Math.min(1, Math.max(0, Math.log2(native) / 9)) * 255);
      cond2[k + 1] = Math.round(Math.min(1, ic) * 255);
      cond2[k + 2] = Math.round(calm * 255);
      cond2[k + 3] = Math.round(Math.min(1, slope / 60) * 255);
    }
  }
  const tex = (data, fmt, type, filt) => {
    const t = new THREE.DataTexture(data, w, h, fmt, type);
    t.minFilter = t.magFilter = filt; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };
  P.cond = cond; P.cond2 = cond2; P.cw = w; P.ch = h;
  P.cx0 = cx0; P.cz0 = cz0; P.isx = 1 / sx; P.isz = 1 / sz;
  P.condTex = tex(cond, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter);
  P.cond2Tex = tex(cond2, THREE.RGBAFormat, THREE.UnsignedByteType, THREE.LinearFilter);
  // The 16 m base heights (world Y), for the terraces: the same array the CPU reads.
  P.baseH = H;
  P.baseTex = tex(H, THREE.RedFormat, THREE.FloatType, THREE.NearestFilter);

  // ── colour: Viking MDIM 2.1 hue (measured, 232 m) ─────────────────────
  const T = S.tint || {};
  const colourTex = await loadColour(site, man.imagery && man.imagery.colour_tex);
  const cm = (man.imagery && man.imagery.colour_tex && man.imagery.colour_tex.mean_rgb) || [128, 128, 128];
  const cml = cm[0] * LUM[0] + cm[1] * LUM[1] + cm[2] * LUM[2];

  const U = P.uniforms;
  Object.assign(U, {
    uCond: { value: P.condTex }, uCond2: { value: P.cond2Tex }, uBaseH: { value: P.baseTex },
    uFeatA: { value: FA }, uFeatB: { value: FB }, uFeatC: { value: FC }, uFeatN: { value: shaped.length },
    uTintDark: { value: new THREE.Vector3(...(T.dark || [0.105, 0.060, 0.042])) },
    uTintMid: { value: new THREE.Vector3(...(T.mid || [0.34, 0.195, 0.115])) },
    uTintBright: { value: new THREE.Vector3(...(T.bright || [0.60, 0.42, 0.28])) },
    uTintIce: { value: new THREE.Vector3(...(T.ice || [0.66, 0.64, 0.62])) },
    uTintFrost: { value: new THREE.Vector3(...(T.frost || [0.78, 0.78, 0.80])) },
    uTintRange: { value: new THREE.Vector4(...(T.range || [0.24, 0.80]), T.iceAmount != null ? T.iceAmount : 0.9, T.frostAmount || 0) },
    uBands: { value: new THREE.Vector4(...(T.bands || [12, 0, 0, 0])) },
    uColourTex: { value: colourTex }, uColourOn: { value: colourTex ? (T.colourAmount != null ? T.colourAmount : 0.6) : 0 },
    uColourRect: { value: new THREE.Vector4(-site.halfX, -site.halfZ, 1 / (2 * site.halfX), 1 / (2 * site.halfZ)) },
    uColourMean: { value: new THREE.Vector3(cm[0] / cml, cm[1] / cml, cm[2] / cml) },
    uHemi: { value: man.grid.lat0_deg >= 0 ? 1 : -1 },
  });
  U.uCondGrid.value.set(cx0, cz0, 1 / sx, 1 / sz);
  U.uCondSize.value.set(w, h);

  // the longest thing generated, so the clipmap evaluates the detail far enough out (terrain.js)
  P.maxLambda = Math.max(24, ...OCT.map((o) => o.lambda), ...shaped.map((f) => Math.max(f.r * 3, 30)),
    sc ? sc.cell * 0.6 : 0, tr ? tr.spacing * 2 : 0, ck ? ck.lambda * 0.5 : 0, pc ? pc.rMax * 3 : 0);

  /* ── CPU ──────────────────────────────────────────────────────────────*/
  const L = P.lattice;
  const lat = (i, j, ch) => L[(((j & 255) << 8) | (i & 255)) * 4 + ch] / 255;
  const vn = (px, pz) => {
    const i = Math.floor(px), j = Math.floor(pz), a = px - i, b = pz - j;
    const ux = a * a * (3 - 2 * a), uz = b * b * (3 - 2 * b);
    const p = lat(i, j, 0), q = lat(i + 1, j, 0), r = lat(i, j + 1, 0), s = lat(i + 1, j + 1, 0);
    return (p + (q - p) * ux) * (1 - uz) + (r + (s - r) * ux) * uz;
  };
  const bil = (C, x, z, k) => {
    let u = (x - cx0) / sx, v = (z - cz0) / sz;
    if (u < 0) u = 0; else if (u > w - 1.001) u = w - 1.001;
    if (v < 0) v = 0; else if (v > h - 1.001) v = h - 1.001;
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = (j * w + i) * 4 + k, o2 = o + w * 4;
    return ((C[o] * (1 - fu) + C[o + 4] * fu) * (1 - fv) + (C[o2] * (1 - fu) + C[o2 + 4] * fu) * fv) / 255;
  };
  const baseAt = (x, z) => {
    let u = (x - cx0) / sx, v = (z - cz0) / sz;
    if (u < 0) u = 0; else if (u > w - 1.001) u = w - 1.001;
    if (v < 0) v = 0; else if (v > h - 1.001) v = h - 1.001;
    const i = u | 0, j = v | 0, fu = u - i, fv = v - j, o = j * w + i;
    return (H[o] * (1 - fu) + H[o + 1] * fu) * (1 - fv) + (H[o + w] * (1 - fu) + H[o + w + 1] * fu) * fv;
  };
  P.regolith = function (x, z, out = {}) {
    out.res = bil(cond, x, z, 0); out.sand = bil(cond, x, z, 1); out.rock = bil(cond, x, z, 2); out.rough = bil(cond, x, z, 3);
    out.ice = bil(cond2, x, z, 1); out.calm = bil(cond2, x, z, 2);
    return out;
  };
  const g = {};
  P.height = function (x, z) {
    P.regolith(x, z, g);
    const qn = bil(cond2, x, z, 0), qi = g.ice, qc = g.calm, slope = bil(cond2, x, z, 3) * 60;
    const native = Math.pow(2, qn * 9);
    const amp = 1 - calmDamp * qc;
    const wFill = fillGain * (0.55 + 0.9 * g.rough) * amp * (1 - 0.5 * iceSmooth * qi);
    const wMicro = microGain * (0.5 + 0.9 * g.rock) * (1 - 0.6 * g.sand) * amp * (1 - iceSmooth * qi);
    let hh = 0;
    for (let n = 0; n < OCT.length; n++) {
      const o = OCT[n];
      const ww = o.family === "fill" ? wFill * sm(0.4 * o.lambda, 0.9 * o.lambda, native) : wMicro;
      if (ww <= 0) continue;
      const px = (x * o.c - z * o.s) / o.lambda + o.ox, pz = (x * o.s + z * o.c) / o.lambda + o.oz;
      let v = vn(px, pz);
      if (o.ridged) { const r = 1 - Math.abs(2 * v - 1); v = 0.5 + 0.5 * (r * r * 3 - 1) * 0.5; }
      hh += o.amp * ww * (2 * v - 1);
    }
    if (ripAmp > 0 && g.sand > 0.001) {
      const ph = (x * RIPPLE.dirX + z * RIPPLE.dirZ) / RIPPLE.lambda + RIPPLE.warp * vn(x / RIPPLE.warpScale + 3.3, z / RIPPLE.warpScale + 8.1);
      const s = 0.5 + 0.5 * Math.sin(2 * Math.PI * ph);
      hh += ripAmp * g.sand * amp * (s * s - 0.375);
    }
    if (crChance > 0) {
      const ci = Math.floor(x / CRATER.cell), cj = Math.floor(z / CRATER.cell);
      if (lat(ci, cj, 1) < crChance) {
        const ccx = (ci + 0.25 + 0.5 * lat(ci, cj, 2)) * CRATER.cell, ccz = (cj + 0.25 + 0.5 * lat(ci, cj, 3)) * CRATER.cell;
        const q = lat(ci + 91, cj + 37, 1);
        const r = (CRATER.rMin + (CRATER.rMax - CRATER.rMin) * q * q) * (0.45 + 0.55 * g.res) * (1 - 0.6 * qi);
        const t = Math.hypot(x - ccx, z - ccz) / r;
        if (t < 1.6) {
          const t2 = t * t;
          const prof = t < 1 ? -CRATER.depth * (1 - t2) + CRATER.rim * t2 : CRATER.rim * Math.exp(-(t - 1) / 0.3) * (1 - sm(1.3, 1.6, t));
          hh += prof * r * 2 * amp;
        }
      }
    }
    for (let pi = 0; pi < polys.length; pi++) {
      const pg = polys[pi], C = pg.cell, off = 17 + 61 * pi;
      const u = x / C, v = z / C, ci = Math.floor(u), cj = Math.floor(v);
      let f1 = 1e9, f2 = 1e9;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ii = ci + a, jj = cj + b;
        const px = ii + 0.15 + 0.7 * lat(ii + off, jj + 59, 1), pz = jj + 0.15 + 0.7 * lat(ii + off, jj + 59, 2);
        const d = Math.hypot(u - px, v - pz);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      const e = (f2 - f1) * C * 0.5;
      const wp = (1 - sm(6, 16, slope)) * amp * (pg.onIce != null ? 1 - pg.onIce + pg.onIce * qi : 1);
      hh += pg.depth * wp * (0.3 * (1 - sm(0, 0.7, f1)) - (1 - sm(0, pg.width, e)));
    }
    if (sc) {
      const C = sc.cell, u = x / C, v = z / C, ci = Math.floor(u), cj = Math.floor(v);
      let m = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ii = ci + a, jj = cj + b, o = (((jj + 97) & 255) << 8 | ((ii + 211) & 255)) * 4;
        const l0 = L[o] / 255;
        if (l0 >= sc.chance) continue;
        const l1 = L[o + 1] / 255, l2 = L[o + 2] / 255, l3 = L[o + 3] / 255;
        const ccx = (ii + 0.2 + 0.6 * l1) * C, ccz = (jj + 0.2 + 0.6 * l2) * C;
        const r = C * (0.28 + 0.32 * l3);
        const dx = (x - ccx) / r / sc.aspect, dz = (z - ccz) / r * P._hemi;
        const kz = dz > 0 ? 1 : 0.62;
        const t = Math.hypot(dx, dz * kz);
        if (t < 1) {
          const lo = 0.12 + (0.8 - 0.12) * sm(-0.25, 0.25, dz);
          m = Math.min(m, -sc.depth * (0.55 + 0.45 * l3) * (1 - sm(lo, 1, t)));
        }
      }
      hh += m * amp;
    }
    if (tr) {
      const hb = baseAt(x, z);
      const f = hb / tr.spacing + 0.6 * vn(x / 420 + 7.7, z / 420 + 1.3);
      const k = Math.floor(f), fr = f - k, sw = 0.5 * (1 - tr.sharp);
      const st = sm(0.5 - sw, 0.5 + sw, fr);
      const vr = 0.55 + 0.9 * lat((k | 0) & 255, 7, 0);
      hh += (st - fr) * tr.spacing * vr * (tr.amount != null ? tr.amount : 1) * sm(tr.slope[0], tr.slope[1], slope) * amp;
    }
    if (ck) {
      const n1 = vn(x / ck.lambda + 13.1, z / ck.lambda + 71.7);
      const a = 0.83, b = 0.557;
      const n2 = vn((x * a - z * b) / (ck.lambda * 0.53) + 41.3, (x * b + z * a) / (ck.lambda * 0.53) + 5.9);
      const e = Math.min(Math.abs(n1 - 0.5), Math.abs(n2 - 0.5) * 1.3);
      let wc = (ck.onIce != null ? 1 - ck.onIce + ck.onIce * qi : 1) * amp * (1 - sm(12, 25, slope)), wd = ck.width;
      if (ck.field) { const f = 1 - sm(ck.field.r, ck.field.r * 1.6, Math.hypot(x - ck.field.x, z - ck.field.z)); wc *= 1 + ck.field.gain * f; wd *= 1 + f; }
      hh -= ck.depth * (1 - sm(0, wd, e)) * wc;
    }
    if (pc) {
      const a = pc.az * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
      const rx = x * cs - z * sn, rz = x * sn + z * cs;
      const row = Math.floor(rz / pc.ly);
      let m = 0;
      if (lat(row | 0, 333, 0) < pc.chance) {
        const cell = Math.floor(rx / pc.lx);
        for (let d = -1; d <= 1; d++) {
          const ci = cell + d, o = ((((row | 0) + 7) & 255) << 8 | (((ci | 0) + 41) & 255)) * 4;
          if (L[o] / 255 >= pc.pit) continue;
          const ccx = (ci + 0.5 + 0.3 * (L[o + 1] / 255 - 0.5)) * pc.lx, ccz = (row + 0.5 + 0.2 * (L[o + 2] / 255 - 0.5)) * pc.ly;
          const rad = pc.rMin + (pc.rMax - pc.rMin) * (L[o + 3] / 255);
          const t = Math.hypot(rx - ccx, rz - ccz) / rad;
          if (t < 1) m = Math.min(m, -pc.depth * rad * (1 - sm(0.65, 1, t)));
        }
      }
      hh += m * (1 - qc);
    }
    for (let i = 0; i < shaped.length; i++) {
      const A = FA[i], B = FB[i], Cc = FC[i];
      const dx = x - A.x, dz = z - A.y, t = Math.hypot(dx, dz) / A.z;
      let fh = 0;
      if (B.x < 1.5) {
        if (t < 2.6) fh = t < 1 ? -A.w * (1 - t * t) + B.y * t * t : B.y * Math.exp(-(t - 1) / 0.35) * (1 - sm(1.6, 2.6, t));
      } else if (B.x < 2.5) {
        if (t < 1.4) {
          const rb = Math.max(0, 1 - t / 0.55);
          fh = (t < 1 ? -A.w * (1 - sm(0.86, 1, t)) + A.w * 0.22 * rb * rb : 0) + B.y * sm(0.9, 1, t) * (1 - sm(1, 1.4, t));
        }
        if (B.w > 0) {
          const ddx = Math.sin(B.z), ddz = -Math.cos(B.z);
          const s = dx * ddx + dz * ddz, q = Math.abs(-dx * ddz + dz * ddx);
          const rr = A.z, Ln = Cc.x;
          if (s > 0.3 * rr && s < rr + Ln + 1 && q < B.w * 1.8) {
            const rampH = -A.w * Math.min(1, Math.max(0, (rr + Ln - s) / (Ln + 0.55 * rr)));
            const m = (1 - sm(B.w, B.w * 1.8, q)) * sm(0.3 * rr, 0.5 * rr, s);
            fh = fh + (rampH - fh) * m;
          }
        }
      }
      hh += fh;
    }
    return hh;
  };
  P._hemi = man.grid.lat0_deg >= 0 ? 1 : -1;

  /* ── GPU: written against the JavaScript above ───────────────────────*/
  const octGlsl = OCT.map((o) => {
    const ww = o.family === "fill" ? `wFill * dSm(${fx(0.4 * o.lambda)}, ${fx(0.9 * o.lambda)}, native)` : "wMicro";
    const n = `dVnoise(vec2(xz.x * ${fx(o.c)} - xz.y * ${fx(o.s)}, xz.x * ${fx(o.s)} + xz.y * ${fx(o.c)}) / ${fx(o.lambda)} + vec2(${fx(o.ox)}, ${fx(o.oz)}))`;
    const v = o.ridged ? `dRidge(${n})` : n;
    return `    h += ${fx(o.amp)} * ${ww} * dFade(${fx(o.lambda)}, dist) * (2.0 * ${v} - 1.0);`;
  }).join("\n");
  const polyGlsl = polys.map((pg, pi) => `
    {
      vec2 u = xz / ${fx(pg.cell)}; vec2 c = floor(u);
      float f1 = 1e9, f2 = 1e9;
      for (int b = -1; b <= 1; b++) for (int a = -1; a <= 1; a++) {
        ivec2 ii = ivec2(c) + ivec2(a, b);
        vec4 l = dLat(ii + ivec2(${17 + 61 * pi}, 59));
        vec2 p = vec2(ii) + 0.15 + 0.7 * l.gb;
        float d = length(u - p);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
      }
      float e = (f2 - f1) * ${fx(pg.cell)} * 0.5;
      float wp = (1.0 - dSm(6.0, 16.0, slope)) * amp${pg.onIce != null ? ` * (${fx(1 - pg.onIce)} + ${fx(pg.onIce)} * qi)` : ""};
      h += ${fx(pg.depth)} * wp * (0.3 * (1.0 - dSm(0.0, 0.7, f1)) - (1.0 - dSm(0.0, ${fx(pg.width)}, e))) * dFade(${fx(pg.cell * 2)}, dist);
    }`).join("\n");
  const scGlsl = !sc ? "" : `
    {
      vec2 u = xz / ${fx(sc.cell)}; vec2 c = floor(u);
      float m = 0.0;
      for (int b = -1; b <= 1; b++) for (int a = -1; a <= 1; a++) {
        ivec2 ii = ivec2(c) + ivec2(a, b);
        vec4 l = dLat(ii + ivec2(211, 97));
        if (l.r >= ${fx(sc.chance)}) continue;
        vec2 cc = (vec2(ii) + 0.2 + 0.6 * l.gb) * ${fx(sc.cell)};
        float r = ${fx(sc.cell)} * (0.28 + 0.32 * l.a);
        float dx = (xz.x - cc.x) / r / ${fx(sc.aspect)}, dz = (xz.y - cc.y) / r * uHemi;
        float kz = dz > 0.0 ? 1.0 : 0.62;
        float t = length(vec2(dx, dz * kz));
        if (t < 1.0) {
          float lo = 0.12 + (0.8 - 0.12) * dSm(-0.25, 0.25, dz);
          m = min(m, -${fx(sc.depth)} * (0.55 + 0.45 * l.a) * (1.0 - dSm(lo, 1.0, t)));
        }
      }
      h += m * amp * dFade(${fx(sc.cell * 0.6)}, dist);
    }`;
  const trGlsl = !tr ? "" : `
    {
      float hb = dBase(xz);
      float f = hb / ${fx(tr.spacing)} + 0.6 * dVnoise(xz / 420.0 + vec2(7.7, 1.3));
      float k = floor(f), fr = f - k;
      float st = dSm(${fx(0.5 - 0.5 * (1 - tr.sharp))}, ${fx(0.5 + 0.5 * (1 - tr.sharp))}, fr);
      float vr = 0.55 + 0.9 * dLat(ivec2(int(k) & 255, 7)).r;
      h += (st - fr) * ${fx(tr.spacing)} * vr * ${fx(tr.amount != null ? tr.amount : 1)} * dSm(${fx(tr.slope[0])}, ${fx(tr.slope[1])}, slope) * amp * dFade(${fx(tr.spacing * 2)}, dist);
    }`;
  const ckIce = ck && ck.onIce != null ? "(" + fx(1 - ck.onIce) + " + " + fx(ck.onIce) + " * qi)" : "1.0";
  const ckField = ck && ck.field ? "{ float f = 1.0 - dSm(" + fx(ck.field.r) + ", " + fx(ck.field.r * 1.6) + ", length(xz - vec2(" + fx(ck.field.x) + ", " + fx(ck.field.z) + "))); wc *= 1.0 + " + fx(ck.field.gain) + " * f; wd *= 1.0 + f; }" : "";
  const ckGlsl = !ck ? "" : `
    {
      float n1 = dVnoise(xz / ${fx(ck.lambda)} + vec2(13.1, 71.7));
      float n2 = dVnoise(vec2(xz.x * 0.83 - xz.y * 0.557, xz.x * 0.557 + xz.y * 0.83) / ${fx(ck.lambda * 0.53)} + vec2(41.3, 5.9));
      float e = min(abs(n1 - 0.5), abs(n2 - 0.5) * 1.3);
      float wc = ${ckIce} * amp * (1.0 - dSm(12.0, 25.0, slope)), wd = ${fx(ck.width)};
      ${ckField}
      h -= ${fx(ck.depth)} * (1.0 - dSm(0.0, wd, e)) * wc * dFade(${fx(ck.lambda * 0.5)}, dist);
    }`;
  const pcGlsl = !pc ? "" : (() => {
    const a = pc.az * Math.PI / 180;
    return `
    {
      vec2 rr = vec2(xz.x * ${fx(Math.cos(a))} - xz.y * ${fx(Math.sin(a))}, xz.x * ${fx(Math.sin(a))} + xz.y * ${fx(Math.cos(a))});
      float row = floor(rr.y / ${fx(pc.ly)});
      float m = 0.0;
      if (dLat(ivec2(int(row), 333)).r < ${fx(pc.chance)}) {
        float cell = floor(rr.x / ${fx(pc.lx)});
        for (int d = -1; d <= 1; d++) {
          float ci = cell + float(d);
          vec4 l = dLat(ivec2(int(ci), int(row)) + ivec2(41, 7));
          if (l.r >= ${fx(pc.pit)}) continue;
          vec2 cc = vec2((ci + 0.5 + 0.3 * (l.g - 0.5)) * ${fx(pc.lx)}, (row + 0.5 + 0.2 * (l.b - 0.5)) * ${fx(pc.ly)});
          float rad = ${fx(pc.rMin)} + ${fx(pc.rMax - pc.rMin)} * l.a;
          float t = length(rr - cc) / rad;
          if (t < 1.0) m = min(m, -${fx(pc.depth)} * rad * (1.0 - dSm(0.65, 1.0, t)));
        }
      }
      h += m * (1.0 - qc) * dFade(${fx(pc.rMax * 3)}, dist);
    }`;
  })();

  const ripGlsl = ripAmp <= 0 ? "" : /* glsl */`    if (g.g > 0.001) {
      float ph = dot(xz, vec2(${fx(RIPPLE.dirX)}, ${fx(RIPPLE.dirZ)})) / ${fx(RIPPLE.lambda)} + ${fx(RIPPLE.warp)} * dVnoise(xz / ${fx(RIPPLE.warpScale)} + vec2(3.3, 8.1));
      float s = 0.5 + 0.5 * sin(6.283185307179586 * ph);
      h += ${fx(ripAmp)} * g.g * amp * dFade(${fx(RIPPLE.lambda)}, dist) * (s * s - 0.375);
    }`;
  const craterGlsl = crChance <= 0 ? "" : /* glsl */`    {
      vec2 cf = floor(xz / ${fx(CRATER.cell)});
      ivec2 ci = ivec2(cf);
      vec4 l = dLat(ci);
      if (l.g < ${fx(crChance)}) {
        vec2 cc = (cf + 0.25 + 0.5 * l.ba) * ${fx(CRATER.cell)};
        float qq = dLat(ci + ivec2(91, 37)).g;
        float r = (${fx(CRATER.rMin)} + ${fx(CRATER.rMax - CRATER.rMin)} * qq * qq) * (0.45 + 0.55 * g.r) * (1.0 - 0.6 * qi);
        float t = length(xz - cc) / r;
        if (t < 1.6) {
          float t2 = t * t;
          float prof = t < 1.0 ? -${fx(CRATER.depth)} * (1.0 - t2) + ${fx(CRATER.rim)} * t2
            : ${fx(CRATER.rim)} * exp(-(t - 1.0) / 0.3) * (1.0 - dSm(1.3, 1.6, t));
          h += prof * r * 2.0 * amp * dFade(max(r, 1.0), dist);
        }
      }
    }`;

  P.glslVertex = /* glsl */`
  uniform highp sampler2D uLattice;
  uniform highp sampler2D uCond;
  uniform highp sampler2D uCond2;
  uniform highp sampler2D uBaseH;
  uniform vec4  uCondGrid;
  uniform vec2  uCondSize;
  uniform float uDetailOn;
  uniform float uFadeK;
  uniform vec4  uFeatA[${MAXF}];
  uniform vec4  uFeatB[${MAXF}];
  uniform vec4  uFeatC[${MAXF}];
  uniform float uFeatN;
  uniform float uHemi;

  vec4 dLat(ivec2 p) { return texelFetch(uLattice, p & 255, 0); }
  float dSm(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  float dVnoise(vec2 p) {
    vec2 i = floor(p), fr = p - i;
    vec2 u = fr * fr * (3.0 - 2.0 * fr);
    ivec2 b = ivec2(i);
    float a = dLat(b).r, bb = dLat(b + ivec2(1, 0)).r, c = dLat(b + ivec2(0, 1)).r, d = dLat(b + ivec2(1, 1)).r;
    return (a + (bb - a) * u.x) * (1.0 - u.y) + (c + (d - c) * u.x) * u.y;
  }
  float dRidge(float v) { float r = 1.0 - abs(2.0 * v - 1.0); return 0.5 + 0.5 * (r * r * 3.0 - 1.0) * 0.5; }
  vec2 dUV(vec2 xz) { return clamp((xz - uCondGrid.xy) * uCondGrid.zw, vec2(0.0), uCondSize - 1.001); }
  vec4 dCondT(highp sampler2D t, vec2 xz) {
    vec2 uv = dUV(xz);
    vec2 i = floor(uv), fr = uv - i;
    ivec2 b = ivec2(i);
    vec4 a = texelFetch(t, b, 0), bb = texelFetch(t, b + ivec2(1, 0), 0);
    vec4 c = texelFetch(t, b + ivec2(0, 1), 0), d = texelFetch(t, b + ivec2(1, 1), 0);
    return (a * (1.0 - fr.x) + bb * fr.x) * (1.0 - fr.y) + (c * (1.0 - fr.x) + d * fr.x) * fr.y;
  }
  vec4 dCond(vec2 xz) { return dCondT(uCond, xz); }
  float dBase(vec2 xz) {
    vec2 uv = dUV(xz);
    vec2 i = floor(uv), fr = uv - i;
    ivec2 b = ivec2(i);
    float a = texelFetch(uBaseH, b, 0).r, bb = texelFetch(uBaseH, b + ivec2(1, 0), 0).r;
    float c = texelFetch(uBaseH, b + ivec2(0, 1), 0).r, d = texelFetch(uBaseH, b + ivec2(1, 1), 0).r;
    return (a * (1.0 - fr.x) + bb * fr.x) * (1.0 - fr.y) + (c * (1.0 - fr.x) + d * fr.x) * fr.y;
  }
  float dFade(float lambda, float dist) {
    float reach = max(6.0, lambda * uFadeK);
    return 1.0 - smoothstep(0.5 * reach, reach, dist);
  }

  float detailHeightC(vec2 xz, float dist, vec4 g) {
    vec4 q = dCondT(uCond2, xz);
    float native = exp2(q.r * 9.0), qi = q.g, qc = q.b, slope = q.a * 60.0;
    float amp = 1.0 - ${fx(calmDamp)} * qc;
    float wFill = ${fx(fillGain)} * (0.55 + 0.9 * g.a) * amp * (1.0 - ${fx(0.5 * iceSmooth)} * qi);
    float wMicro = ${fx(microGain)} * (0.5 + 0.9 * g.b) * (1.0 - 0.6 * g.g) * amp * (1.0 - ${fx(iceSmooth)} * qi);
    float h = 0.0;
${octGlsl}
${ripGlsl}
${craterGlsl}
${polyGlsl}
${scGlsl}
${trGlsl}
${ckGlsl}
${pcGlsl}
    for (int i = 0; i < ${MAXF}; i++) {
      if (float(i) >= uFeatN) break;
      vec4 A = uFeatA[i], B = uFeatB[i], C = uFeatC[i];
      vec2 d = xz - A.xy;
      float t = length(d) / A.z;
      float fh = 0.0;
      if (B.x < 1.5) {
        if (t < 2.6) fh = t < 1.0 ? -A.w * (1.0 - t * t) + B.y * t * t : B.y * exp(-(t - 1.0) / 0.35) * (1.0 - dSm(1.6, 2.6, t));
      } else if (B.x < 2.5) {
        if (t < 1.4) {
          float rb = max(0.0, 1.0 - t / 0.55);
          fh = (t < 1.0 ? -A.w * (1.0 - dSm(0.86, 1.0, t)) + A.w * 0.22 * rb * rb : 0.0) + B.y * dSm(0.9, 1.0, t) * (1.0 - dSm(1.0, 1.4, t));
        }
        if (B.w > 0.0) {
          vec2 dir = vec2(sin(B.z), -cos(B.z));
          float s = dot(d, dir), qq = abs(-d.x * dir.y + d.y * dir.x);
          float rr = A.z, Ln = C.x;
          if (s > 0.3 * rr && s < rr + Ln + 1.0 && qq < B.w * 1.8) {
            float rampH = -A.w * clamp((rr + Ln - s) / (Ln + 0.55 * rr), 0.0, 1.0);
            float m = (1.0 - dSm(B.w, B.w * 1.8, qq)) * dSm(0.3 * rr, 0.5 * rr, s);
            fh = fh + (rampH - fh) * m;
          }
        }
      }
      h += fh * dFade(max(A.z * 3.0, 30.0), dist);
    }
    return h * uDetailOn;
  }

  float detailHeight(vec2 xz, float dist) { return detailHeightC(xz, dist, dCond(xz)); }
`;

  P.glslFragment = /* glsl */`
  uniform sampler2D uGrain;
  uniform highp sampler2D uCond;
  uniform highp sampler2D uCond2;
  uniform vec4  uCondGrid;
  uniform vec2  uCondSize;
  uniform float uDetailOn;
  uniform float uMicro;
  uniform vec3  uTintDark, uTintMid, uTintBright, uTintIce, uTintFrost;
  uniform vec4  uTintRange;
  uniform vec4  uBands;
  uniform sampler2D uColourTex;
  uniform float uColourOn;
  uniform vec4  uColourRect;
  uniform vec3  uColourMean;
  uniform float uHemi;
  uniform vec4  uFeatA[${MAXF}];
  uniform vec4  uFeatB[${MAXF}];
  uniform vec4  uFeatC[${MAXF}];
  uniform float uFeatN;

  vec4 detailCond(vec2 xz) { return texture2D(uCond, ((xz - uCondGrid.xy) * uCondGrid.zw + 0.5) / uCondSize); }
  vec4 detailCond2(vec2 xz) { return texture2D(uCond2, ((xz - uCondGrid.xy) * uCondGrid.zw + 0.5) / uCondSize); }

  void detailShade(vec3 P, float dist, inout vec3 N, inout float albedo) {
    if (uDetailOn <= 0.0 || uMicro <= 0.0) return;
    vec4 g = detailCond(P.xz);
    float ice = detailCond2(P.xz).g;
    float near = 1.0 - smoothstep(60.0, 220.0, dist);
    vec2 p0 = vec2(P.x * 0.966 + P.z * 0.259, -P.x * 0.259 + P.z * 0.966) / 23.0;
    vec2 p1 = P.xz / 5.2;
    vec2 p2 = vec2(P.x * 0.829 - P.z * 0.559, P.x * 0.559 + P.z * 0.829) / 1.15;
    vec3 c = texture2D(uGrain, p0).rgb - 0.5;
    vec3 a = texture2D(uGrain, p1).rgb - 0.5;
    vec3 b = texture2D(uGrain, p2).rgb - 0.5;
    float k = uMicro * (0.75 + 0.9 * g.b - 0.3 * g.g) * (1.0 - 0.6 * ice) * near;
    vec2 slope = (a.gb * 0.9 + vec2(b.g * 0.829 + b.b * 0.559, -b.g * 0.559 + b.b * 0.829) * 1.2) * k;
    N = normalize(N - vec3(slope.x, 0.0, slope.y) * 1.6);
    albedo *= 1.0 + (c.r * 0.30 + a.r * 0.34 + b.r * 0.36) * k;
  }

  /* The site's own ramp (hue from Viking MDIM 2.1, brightness from the imagery), then
     layering on steep ground, ice where the style puts it, frost on pole-facing slopes and
     exposed ice in a feature that says so. All of it shading: nothing here moves a vertex. */
  void detailTint(vec3 P, float dist, vec3 N, float lum, inout vec3 albedo) {
    float l = clamp((lum - uTintRange.x) / (uTintRange.y - uTintRange.x), 0.0, 1.0);
    vec3 c = l < 0.5 ? mix(uTintDark, uTintMid, l * 2.0) : mix(uTintMid, uTintBright, l * 2.0 - 1.0);
    if (uColourOn > 0.0) {
      vec3 m = texture2D(uColourTex, clamp((P.xz - uColourRect.xy) * uColourRect.zw, 0.0, 1.0)).rgb;
      vec3 ch = m / max(dot(m, vec3(0.299, 0.587, 0.114)), 0.02);
      c *= mix(vec3(1.0), clamp(ch / uColourMean, 0.6, 1.6), uColourOn);
    }
    vec4 q = detailCond2(P.xz);
    float steep = 1.0 - smoothstep(0.72, 0.93, N.y);
    if (uBands.y > 0.0) {
      float wob = texture2D(uGrain, P.xz / 517.0).r - 0.5;
      float band = sin(6.2831853 * (P.y + 9.0 * wob) / uBands.x) + 0.5 * sin(6.2831853 * (P.y + 4.0 * wob) / (uBands.x * 0.37));
      c *= 1.0 + uBands.y * band * steep;
    }
    float ice = clamp(q.g * uTintRange.z, 0.0, 1.0);
    for (int i = 0; i < ${MAXF}; i++) {
      if (float(i) >= uFeatN) break;
      if (uFeatC[i].y < 0.5) continue;
      float t = length(P.xz - uFeatA[i].xy) / uFeatA[i].z;
      float ptch = smoothstep(0.35, 0.65, texture2D(uGrain, P.xz / 9.0).r + 0.25);
      ice = max(ice, smoothstep(0.2, 0.4, t) * (1.0 - smoothstep(0.82, 0.98, t)) * ptch * (0.4 + 0.6 * steep));
    }
    c = mix(c, uTintIce * (0.85 + 0.3 * l), ice);
    float frost = uTintRange.w * smoothstep(0.0, 0.35, -N.z * uHemi) * (0.4 + 0.6 * steep + 0.4 * q.g);
    c = mix(c, uTintFrost, clamp(frost, 0.0, 0.85));
    albedo = c;
  }
`;
}

async function loadColour(site, ct) {
  if (!ct || !ct.path) return null;
  try {
    const r = await fetch(site.base + ct.path, { cache: "force-cache" });
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // Row 0 of the PNG is the north edge: the texture's v runs south with world Z, as the image's rows do.
    const t = new THREE.DataTexture(new Uint8Array(d), c.width, c.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  } catch (e) {
    console.warn("[detail] colour texture not loaded:", e.message);
    return null;
  }
}
