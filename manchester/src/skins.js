// Allianz-style continuous ETFE skins whose cushion seams trace rose geometry.
// The skin is a single parametric surface F(θ, s): θ = angle around the bowl, s = 0 (ground) … 1 (oculus rim).
// Each option is a *pattern* drawn in (θ, s) space -> colour / alpha / emissive / cushion-normal maps.
import * as THREE from 'three';
import { PAL, seP, sePath, paramSurface, tube, canvasTex, std } from './kit.js';
import { A, B, NE, section, envPoint, offsetOn, materials, oculusRing } from './stadium.js';
import { buildBowl, withImage } from './bowl.js';
import { buildAtrium } from './atrium.js';

const TAU = Math.PI * 2;
// Allianz-like "rubber ring" section, tall enough to clear the 100k bowl
const SKIN = [[0.93, 0], [0.985, 12], [1.01, 28], [1.0, 44], [0.965, 56], [0.9, 63], [0.78, 67.5], [0.64, 68.5], [0.53, 66.5], [0.5, 64.5]];
const W = 8192, H = 1024;
const col = (c) => '#' + new THREE.Color(c).getHexString();
const rgba = (c, a) => { const k = new THREE.Color(c); return `rgba(${k.r * 255 | 0},${k.g * 255 | 0},${k.b * 255 | 0},${a})`; };

// ---------- pattern drawing in (θ, s) space ----------
class Pattern {
  constructor() { this.fills = []; this.lines = []; this.ribs = []; this.glow = []; }
  fill(pts, color, alpha = 1, glow = 0) { this.fills.push({ pts, color, alpha, glow }); }
  line(pts, w = 4, rib = false, kind = 'seam') { this.lines.push({ pts, w, kind }); if (rib) this.ribs.push(pts); }
}
const px = ([th, s]) => [((th % TAU) + TAU) % TAU / TAU * W, (1 - s) * H];
function tracePath(g, pts, dx) {
  g.beginPath();
  let prev = null;
  pts.forEach((p, i) => {
    let [x, y] = px(p);
    // keep curves continuous across the θ seam
    if (prev !== null) { while (x - prev > W / 2) x -= W; while (prev - x > W / 2) x += W; }
    prev = x; i ? g.lineTo(x + dx, y) : g.moveTo(x + dx, y);
  });
}
function forWrap(g, pts, fn) { for (const dx of [-W, 0, W]) { tracePath(g, pts, dx); fn(); } }

// diamond (crossing-spiral) cushion grid — the Allianz signature, kept faint under the rose
function diamondGrid(P, n = 96, twist = 1.6, w = 1.6) {
  for (let i = 0; i < n; i++) for (const sg of [1, -1]) {
    const pts = []; for (let k = 0; k <= 40; k++) { const s = k / 40; pts.push([i / n * TAU + sg * twist * s, s]); }
    P.line(pts, w);
  }
  for (let k = 1; k < 14; k++) { const s = k / 14; P.line(Array.from({ length: 129 }, (_, i) => [i / 128 * TAU, s]), 1.2); }
}
function petalOutline(th0, s0, s1, tw, hw, shape, sign, N = 48) {
  return Array.from({ length: N + 1 }, (_, k) => { const u = k / N; return [th0 + tw * u + sign * hw * shape(u), s0 + (s1 - s0) * u]; });
}
const petalPoly = (th0, s0, s1, tw, hw, shape) => [...petalOutline(th0, s0, s1, tw, hw, shape, 1), ...petalOutline(th0, s0, s1, tw, hw, shape, -1).reverse()];

// ---------- the four patterns ----------
const PATTERNS = {
  // A — ROSA: layered spiralling petals, as in the original sketch (white skin, red blush at petal edges)
  A(P) {
    diamondGrid(P, 120, 1.3, 1.2);
    const layers = [
      { n: 11, s0: 0.0, s1: 0.8, tw: 0.55, wf: 0.82, tint: PAL.red, rot: 0 },
      { n: 10, s0: 0.24, s1: 0.96, tw: 0.62, wf: 0.86, tint: PAL.blush, rot: 0.5 },
      { n: 9, s0: 0.5, s1: 1.0, tw: 0.7, wf: 0.9, tint: PAL.red, rot: 0.25 },
    ];
    const shape = (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.85)), 0.65);
    for (const L of layers) for (let i = 0; i < L.n; i++) {
      const th0 = (i + L.rot) / L.n * TAU, hw = Math.PI / L.n * 2 * L.wf;
      P.fill(petalPoly(th0, L.s0, L.s1, L.tw, hw, shape), L.tint, L.tint === PAL.red ? 0.36 : 0.4, 0.8);
      P.fill(petalPoly(th0, L.s0, L.s1, L.tw, hw * 0.55, shape), 0xffffff, 0.22);
      for (const sg of [1, -1]) P.line(petalOutline(th0, L.s0, L.s1, L.tw, hw, shape, sg), 7, true);
      P.line(petalOutline(th0, L.s0, L.s1, L.tw, 0, shape, 1), 3);
      for (const f of [0.33, 0.66]) for (const sg of [1, -1]) P.line(petalOutline(th0, L.s0, L.s1, L.tw, hw * f, shape, sg), 2.4);
    }
  },
  // B — LANCASHIRE ROSE: five red heraldic petals on the façade, five white petals over the roof, green sepals at the base
  B(P) {
    diamondGrid(P, 100, 1.1, 1.3);
    const heart = (u) => { const e = Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.47) / 0.53, 2))); return e * (1 - 0.18 * Math.exp(-Math.pow((u - 1) / 0.06, 2))); };
    for (let i = 0; i < 5; i++) { // sepals first (underneath)
      const th = (i + 0.5) / 5 * TAU;
      P.fill([[th - 0.09, 0], [th, 0.42], [th + 0.09, 0]], PAL.green, 0.75, 0.8);
      P.line([[th - 0.09, 0], [th, 0.42], [th + 0.09, 0]], 6, true);
    }
    for (let i = 0; i < 5; i++) {
      const th = i / 5 * TAU, hw = Math.PI / 5 * 0.96;
      P.fill(petalPoly(th, 0.0, 0.66, 0, hw, heart), PAL.red, 0.55, 1);
      P.fill(petalPoly(th, 0.05, 0.6, 0, hw * 0.55, heart), 0xe8475e, 0.35, 1);
      for (const sg of [1, -1]) P.line(petalOutline(th, 0.0, 0.66, 0, hw, heart, sg), 9, true);
      for (const f of [0.25, 0.5, 0.75]) for (const sg of [1, -1]) P.line(petalOutline(th, 0.02, 0.64, 0, hw * f, heart, sg), 3);
    }
    for (let i = 0; i < 5; i++) {
      const th = (i + 0.5) / 5 * TAU, hw = Math.PI / 5 * 1.0;
      const sh = (u) => Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * u)), 0.6);
      P.fill(petalPoly(th, 0.5, 1.0, 0, hw, sh), 0xffffff, 0.55);
      P.fill(petalPoly(th, 0.5, 1.0, 0, hw, sh), PAL.blush, 0.18, 0.4);
      for (const sg of [1, -1]) P.line(petalOutline(th, 0.5, 1.0, 0, hw, sh, sg), 7, true);
      for (const f of [0.33, 0.66]) for (const sg of [1, -1]) P.line(petalOutline(th, 0.52, 1.0, 0, hw * f, sh, sg), 2.6);
    }
  },
  // C — TRINITY ROSE: three woven bands (Charlton · Law · Best) that close over the roof as a three-petal rose
  C(P) {
    diamondGrid(P, 120, 1.4, 1.4);
    const bands = [[PAL.red, 0], [PAL.lightBlue, 1], [PAL.green, 2]];
    for (const [c, k] of bands) {
      const ph = k / 3 * TAU, N = 240;
      const sc = (th) => 0.3 + 0.17 * Math.sin(th - ph), hwS = (th) => 0.055 + 0.05 * Math.pow(Math.max(0, Math.sin(th - ph)), 6);
      const top = [], bot = [];
      for (let i = 0; i <= N; i++) { const th = i / N * TAU; top.push([th, sc(th) + hwS(th)]); bot.push([th, sc(th) - hwS(th)]); }
      P.fill([...top, ...bot.reverse()], c, 0.78, 1);
      P.line(top, 7, true); P.line(bot.reverse(), 7, true);
      // roof lobe of the three-petal rose, rising from the band's crest
      const crest = ph + Math.PI / 2, lobe = [];
      for (let i = 0; i <= 80; i++) { const th = crest - Math.PI / 3 + i / 80 * (TAU / 3); lobe.push([th, 1 - 0.42 * Math.pow(Math.cos(1.5 * (th - crest)), 2)]); }
      P.fill([...lobe, [crest + Math.PI / 3, 1], [crest - Math.PI / 3, 1]], c, 0.3, 0.7);
      P.line(lobe, 8, true);
    }
  },
  // D — ROSE WINDOW: concentric rings of petal-shaped cushions (Manchester Cathedral rose window), aqua at the base rising to red
  D(P) {
    const rows = 9;
    for (let r = 0; r < rows; r++) {
      const s0 = 0.06 + r / rows * 0.94, ds = 0.94 / rows * 1.45, n = Math.round(44 - r * 2.6);
      const t = r / (rows - 1);
      const c = t < 0.35 ? PAL.aqua : t < 0.7 ? 0xffffff : PAL.red;
      for (let i = 0; i < n; i++) {
        const th = (i + (r % 2) * 0.5) / n * TAU, hw = Math.PI / n * 1.05;
        const sh = (u) => Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * u)), 0.5) * (1 - 0.15 * u);
        const poly = petalPoly(th, s0 - 0.02, Math.min(1, s0 + ds), 0, hw, sh);
        P.fill(poly, c, 0.32 + 0.1 * (i % 2), c === 0xffffff ? 0.2 : 0.8);
        for (const sg of [1, -1]) P.line(petalOutline(th, s0 - 0.02, Math.min(1, s0 + ds), 0, hw, sh, sg), 4.5, r % 3 === 0);
      }
    }
  },
};

// ---------- ROSA studies: the rose as sweeping grooves pressed into one smooth, milky skin ----------
// Lines here are grooves (normal-map valleys + a soft shadow/highlight), never ribs; a fine net sits under everything.
function net(P, n = 220, twist = 0.9) {
  for (let i = 0; i < n; i++) for (const sg of [1, -1]) P.line(Array.from({ length: 21 }, (_, k) => [i / n * TAU + sg * twist * k / 20, k / 20]), 1, false, 'net');
}
function loop(th0, sc, dth, ds, skew, rot = 0, N = 160) {
  // closed petal loop on the skin: ellipse in (θ, s), sheared so it sweeps diagonally
  return Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N * TAU, c = Math.cos(t), s = Math.sin(t);
    const u = c * Math.cos(rot) - s * Math.sin(rot) * 0.6, v = c * Math.sin(rot) * 0.6 + s * Math.cos(rot);
    const sv = sc + ds * v; return [th0 + dth * u + skew * (sv - sc), sv];
  });
}
Object.assign(PATTERNS, {
  // R1 — BLOOM: seven great petal loops round the body, six smaller loops rolling over the roof into the oculus
  R1(P) {
    P.groove = true; net(P);
    for (let i = 0; i < 9; i++) {
      const th = i / 9 * TAU, pts = loop(th, 0.5, 0.6, 0.58, 0.9, 0.35);
      P.fill(pts, 0xffffff, 0.1, 0.25); P.line(pts, 7);
    }
    for (let i = 0; i < 9; i++) {
      const th = (i + 0.5) / 9 * TAU, pts = loop(th, 0.44, 0.5, 0.42, -0.7, -0.25);
      P.line(pts, 5);
    }
    for (let i = 0; i < 7; i++) {
      const th = (i + 0.3) / 7 * TAU, pts = loop(th, 0.86, 0.48, 0.24, 0.7, -0.3);
      P.fill(pts, PAL.blush, 0.14, 0.6); P.line(pts, 6);
    }
  },
  // R2 — SWIRL: long spiral grooves sweeping from the ground to the oculus, crossed by a few counter-sweeps that close into petals
  R2(P) {
    P.groove = true; net(P);
    for (let i = 0; i < 9; i++) {
      const th = i / 9 * TAU, pts = Array.from({ length: 81 }, (_, k) => { const s = k / 80; return [th + 2.1 * Math.pow(s, 1.25), s]; });
      P.line(pts, 7);
      const cs = Array.from({ length: 61 }, (_, k) => { const s = 0.28 + 0.72 * k / 60; return [th + 0.5 - 1.15 * Math.pow((s - 0.28) / 0.72, 0.9), s]; });
      P.line(cs, 6);
      if (i % 2 === 0) P.fill([...pts.filter(([, s]) => s >= 0.28), ...cs.slice().reverse()], PAL.blush, 0.16, 0.5);
    }
  },
  // R3 — UNFURLING: crescent petals ring the oculus like a rose seen from above; the body below carries a few long, slow sweeps
  R3(P) {
    P.groove = true; net(P);
    const rings = [[0.98, 5, 0.16], [0.84, 6, 0.17], [0.68, 7, 0.17], [0.52, 8, 0.15]];
    rings.forEach(([s0, n, a], r) => {
      for (let i = 0; i < n; i++) {
        const th0 = (i + r * 0.37) / n * TAU, span = TAU / n * 1.45;
        const arc = Array.from({ length: 61 }, (_, k) => { const u = k / 60; return [th0 + span * u, s0 - a * Math.sin(Math.PI * u) - 0.04 * u]; });
        P.line(arc, r === 0 ? 7 : 6);
        P.fill([...arc, [th0 + span, s0], [th0, s0]], r < 2 ? PAL.blush : 0xffffff, r < 2 ? 0.2 : 0.12, 0.45);
      }
    });
    for (let i = 0; i < 5; i++) {
      const th = i / 5 * TAU; P.line(Array.from({ length: 61 }, (_, k) => { const s = 0.02 + 0.42 * k / 60; return [th + 1.4 * Math.sin(Math.PI * 0.5 * k / 60), s]; }), 6);
    }
  },
});

// R4 — ORIGINAL: the sketch's geometry. Every line is a closed loop round the oculus, cut by an inclined plane
// through the dome; loops nest outward from the oculus and their tilt direction turns like the spiral of a rose.
export const ROSE_LOOPS = [
  // nested plan ellipses (normalised to the footprint): [radius, centre offset, offset azimuth (deg)]
  // offsets turn by ~140° (near the golden angle) so successive petals cross like a rose seen from above
  [0.56, 0.15, 200], [0.65, 0.21, 340], [0.74, 0.26, 120], [0.84, 0.29, 260],
  [0.94, 0.3, 40], [1.03, 0.29, 180], [1.1, 0.27, 320], [1.15, 0.22, 100],
];
// fuller, dome-like body of the original sketch
export const SKIN_ORIG = [[0.92, 0], [1.0, 14], [1.025, 28], [1.01, 42], [0.96, 54], [0.88, 64], [0.77, 72], [0.64, 78.5], [0.53, 82], [0.46, 83]];
function planLoop(sec, r, off, azDeg, N = 900) {
  // locate the section's widest point: inside it the loop lies on the roof, beyond it the loop rolls down the wall
  let sEq = 0, kMax = 0; for (let i = 0; i <= 200; i++) { const [kk] = sec(i / 200); if (kk > kMax) { kMax = kk; sEq = i / 200; } }
  const sOfK = (kk) => { let lo = sEq, hi = 1; for (let j = 0; j < 30; j++) { const m = (lo + hi) / 2; sec(m)[0] > kk ? lo = m : hi = m; } return lo; };
  const az = azDeg * Math.PI / 180, ou = off * Math.cos(az), ov = off * Math.sin(az), pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N * TAU, u = ou + r * Math.cos(t), v = ov + r * Math.sin(t);
    const kk = Math.pow(Math.pow(Math.abs(u), NE) + Math.pow(Math.abs(v), NE), 1 / NE);
    const th = Math.atan2(Math.sign(v) * Math.pow(Math.abs(v) / kk, NE / 2), Math.sign(u) * Math.pow(Math.abs(u) / kk, NE / 2));
    let s;
    if (kk <= kMax) s = sOfK(kk);
    else s = sEq * (1 - (kk - kMax) / 0.2);
    pts.push(s > 0.01 && s < 0.995 ? [th, s] : null);
  }
  const runs = []; let cur = [];
  for (const p of pts) { if (p) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } }
  if (cur.length) runs.push(cur);
  return runs;
}
Object.assign(PATTERNS, {
  R4(P) {
    P.groove = true; P.bands = true;
    P.skin = SKIN_ORIG; const sec = section(SKIN_ORIG);
    // fine fibrous net under everything
    const rnd = (() => { let s = 9; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 4200; i++) {
      const th = rnd() * TAU, s = rnd(), L = 0.04 + rnd() * 0.12, a = rnd() * Math.PI;
      P.line([[th, s], [th + Math.cos(a) * L * 2.2, s + Math.sin(a) * L], [th + Math.cos(a + 0.3) * L * 4, s + Math.sin(a + 0.3) * L * 1.6]], 1.1, false, 'fiber');
    }
    for (const [r, off, az] of ROSE_LOOPS) {
      for (const run of planLoop(sec, r, off, az)) if (run.length > 4) P.line(run, 17, false, 'band');
    }
  },
});

// R5 — LOCKED v9 GEOMETRY (tools/rose_diagram2.py): client section + two-spiral lattice + golden-angle rose petals.
// Section: straight wall leaning out 20°, 4.5 m upstand, rounded eave, straight roof falling 7 m to the opening.
const V9 = { R0: 0.38, LEAN: 20, H_EAVE: 60, R_EAVE: 1.1, ROOF_DROP: 7, R_EAVE_F: 12 };   // v10: single generous eave curve
function filletPolyline(P, radii, n = 24) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], len = (v) => Math.hypot(v[0], v[1]), nrm = (v) => { const l = len(v); return [v[0] / l, v[1] / l]; };
  const out = [P[0]];
  for (let k = 1; k < P.length - 1; k++) {
    const Pc = P[k], R = radii[k - 1], u1 = nrm(sub(P[k - 1], Pc)), u2 = nrm(sub(P[k + 1], Pc));
    const ang = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))), dT = R / Math.tan(ang / 2);
    const T1 = [Pc[0] + u1[0] * dT, Pc[1] + u1[1] * dT], T2 = [Pc[0] + u2[0] * dT, Pc[1] + u2[1] * dT];
    const bis = nrm([u1[0] + u2[0], u1[1] + u2[1]]), h = R / Math.sin(ang / 2), C = [Pc[0] + bis[0] * h, Pc[1] + bis[1] * h];
    let a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    if (a2 - a1 > Math.PI) a2 -= TAU; if (a1 - a2 > Math.PI) a2 += TAU;
    for (let i = 0; i <= n; i++) { const a = a1 + (a2 - a1) * i / n; out.push([C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]); }
  }
  out.push(P[P.length - 1]);
  const dense = [out[0]];   // densify straight runs (~1.5 m)
  for (let i = 1; i < out.length; i++) { const [x0, y0] = out[i - 1], [x1, y1] = out[i], m = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 1.5)); for (let j = 1; j <= m; j++) dense.push([x0 + (x1 - x0) * j / m, y0 + (y1 - y0) * j / m]); }
  return dense;
}
let _v9 = null;
export const skinV9 = () => _v9 ||= (() => {
  const M = (A + B) / 2, v = V9;
  const Pr = [v.R0 * M, v.H_EAVE - v.ROOF_DROP], Pc = [v.R_EAVE * M, v.H_EAVE];
  const Pb = [Pc[0] - Pc[1] * Math.tan(v.LEAN * Math.PI / 180), 0];
  return filletPolyline([Pr, Pc, Pb], [v.R_EAVE_F]).reverse().map(([x, y]) => [x / M, y]);  // ground -> rim, as (plan scale, height)
})();
Object.assign(PATTERNS, {
  R5(P) {
    P.groove = true; P.bands = true; P.skin = skinV9();
    const rnd = (() => { let s = 11; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 4200; i++) {   // fine fibre net
      const th = rnd() * TAU, s = rnd(), L = 0.04 + rnd() * 0.12, a = rnd() * Math.PI;
      P.line([[th, s], [th + Math.cos(a) * L * 2.2, s + Math.sin(a) * L], [th + Math.cos(a + 0.3) * L * 4, s + Math.sin(a + 0.3) * L * 1.6]], 1.1, false, 'fiber');
    }
    // lattice: two opposite spiral families (13 clockwise, 21 anticlockwise), opening (t=0) -> ground (t=1); texture s = 1 - t
    for (const [cnt, wind] of [[13, 260], [21, -200]]) for (let i = 0; i < cnt; i++)
      P.line(Array.from({ length: 241 }, (_, j) => { const t = j / 240; return [TAU * i / cnt + wind * Math.PI / 180 * Math.pow(t, 0.8), 1 - t]; }), 4);
    // rose petals: 15 crescents from the opening, each turned 137.5°, reaching progressively down to the base
    const N = 15;
    for (let i = 0; i < N; i++) {
      const reach = 0.3 + 0.7 * Math.sqrt(i / (N - 1)), span = (200 + 60 * i / (N - 1)) * Math.PI / 180;
      P.line(Array.from({ length: 321 }, (_, j) => { const u = j / 320; return [i * 137.5 * Math.PI / 180 + span * u, 1 - reach * Math.pow(Math.sin(Math.PI * u), 0.85)]; }), 22, false, 'band');
    }
  },
});

// groove-mode texture synthesis: smooth milky skin, aqua-white at the base warming to white/blush at the crown
function synthesizeGroove(P) {
  const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const colC = mk(), g = colC.getContext('2d');
  const gr = g.createLinearGradient(0, H, 0, 0);
  if (P.bands) { gr.addColorStop(0, '#7fd3cc'); gr.addColorStop(0.4, '#a9e4dd'); gr.addColorStop(0.7, '#dff3ec'); gr.addColorStop(1, '#fff8ec'); } else { gr.addColorStop(0, '#b5e2dc'); gr.addColorStop(0.4, '#d3efea'); gr.addColorStop(0.8, '#eef7f5'); gr.addColorStop(1, '#fbf4f2'); }
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (const f of P.fills) { g.fillStyle = rgba(f.color, f.alpha); forWrap(g, f.pts, () => g.fill()); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const l of P.lines) {
    if (l.kind === 'net') { g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1; forWrap(g, l.pts, () => g.stroke()); continue; }
    if (l.kind === 'fiber') { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.6; forWrap(g, l.pts, () => g.stroke()); continue; }
    if (l.kind === 'band') {
      g.strokeStyle = 'rgba(255,255,248,0.3)'; g.lineWidth = l.w * 2.4; forWrap(g, l.pts, () => g.stroke());
      g.strokeStyle = 'rgba(255,254,246,1)'; g.lineWidth = l.w * 0.7; forWrap(g, l.pts, () => g.stroke());
      g.strokeStyle = 'rgba(255,255,255,0.0)'; g.lineWidth = l.w * 0.18; forWrap(g, l.pts, () => g.stroke());
      continue;
    }
    g.strokeStyle = 'rgba(120,145,150,0.28)'; g.lineWidth = l.w; forWrap(g, l.pts, () => g.stroke());
    g.save(); g.translate(0, -l.w * 0.4); g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = l.w * 0.45; forWrap(g, l.pts, () => g.stroke()); g.restore();
  }
  const emC = mk(), e = emC.getContext('2d');
  const eg = e.createLinearGradient(0, H, 0, 0); eg.addColorStop(0, 'rgba(70,190,180,1)'); eg.addColorStop(0.55, 'rgba(170,230,220,1)'); eg.addColorStop(1, 'rgba(255,244,226,1)');
  e.fillStyle = eg; e.fillRect(0, 0, W, H); e.globalAlpha = 0.35; e.fillStyle = '#000'; e.fillRect(0, 0, W, H); e.globalAlpha = 1;
  for (const f of P.fills) if (f.glow) { e.fillStyle = rgba(f.color === 0xffffff ? 0xffffff : 0xffb7bf, f.glow * 0.35); forWrap(e, f.pts, () => e.fill()); }
  e.lineCap = 'round';
  for (const l of P.lines) {
    if (l.kind === 'net') continue;
    if (l.kind === 'fiber') { e.strokeStyle = 'rgba(255,255,255,0.25)'; e.lineWidth = 1.2; forWrap(e, l.pts, () => e.stroke()); continue; }
    if (l.kind === 'band') { e.strokeStyle = 'rgba(255,250,230,0.35)'; e.lineWidth = l.w * 2.2; forWrap(e, l.pts, () => e.stroke()); }
    e.strokeStyle = 'rgba(255,248,225,0.95)'; e.lineWidth = l.w * 0.55; forWrap(e, l.pts, () => e.stroke());
  }
  const alC = mk(), a = alC.getContext('2d'); a.fillStyle = 'rgb(226,226,226)'; a.fillRect(0, 0, W, H);
  if (P.bands) { const ag = a.createLinearGradient(0, H, 0, 0); ag.addColorStop(0, 'rgb(150,150,150)'); ag.addColorStop(0.5, 'rgb(140,140,140)'); ag.addColorStop(1, 'rgb(150,150,150)'); /* ~55-60% opaque: the atrium reads through the skin */ a.fillStyle = ag; a.fillRect(0, 0, W, H); }
  a.lineCap = 'round'; a.strokeStyle = 'rgb(250,250,250)';
  for (const l of P.lines) if (l.kind !== 'net' && l.kind !== 'fiber') { a.lineWidth = l.w; forWrap(a, l.pts, () => a.stroke()); }
  // height: soft wide valleys along the grooves, a whisper of the net
  const hW = W / 2, hH = H / 2, hC = mk(hW, hH), h = hC.getContext('2d');
  h.fillStyle = '#fff'; h.fillRect(0, 0, hW, hH); h.scale(0.5, 0.5); h.lineCap = 'round';
  for (const l of P.lines) { const thin = l.kind === 'net' || l.kind === 'fiber'; h.strokeStyle = thin ? 'rgba(0,0,0,0.12)' : '#000'; h.lineWidth = thin ? 1.5 : (l.kind === 'band' ? l.w * 0.45 : l.w * 1.6 + 4); forWrap(h, l.pts, () => h.stroke()); }
  h.setTransform(1, 0, 0, 1, 0, 0);
  const bC = mk(hW, hH), b = bC.getContext('2d'); b.filter = 'blur(4px)'; b.drawImage(hC, 0, 0); b.filter = 'none';
  const src = b.getImageData(0, 0, hW, hH).data, nC = mk(hW, hH), nctx = nC.getContext('2d'), out = nctx.createImageData(hW, hH), o = out.data;
  const Hh = (x, y) => src[(((y + hH) % hH) * hW + ((x + hW) % hW)) * 4] / 255;
  for (let y = 0; y < hH; y++) for (let x = 0; x < hW; x++) {
    const dx = (Hh(x + 1, y) - Hh(x - 1, y)) * 4, dy = (Hh(x, y + 1) - Hh(x, y - 1)) * 4;
    const l = Math.hypot(dx, dy, 1), i = (y * hW + x) * 4;
    o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  nctx.putImageData(out, 0, 0);
  const T = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 16; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: T(colC), emissiveMap: T(emC), alphaMap: T(alC, false), normalMap: T(nC, false) };
}

// ---------- texture synthesis ----------
function synthesize(P) {
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const colC = mk(), g = colC.getContext('2d');
  g.fillStyle = '#f3f4f2'; g.fillRect(0, 0, W, H);
  for (const f of P.fills) { g.fillStyle = rgba(f.color, f.alpha); forWrap(g, f.pts, () => g.fill()); }
  // aqua concourse band (the OT windows)
  const band = H * 0.085; const gr = g.createLinearGradient(0, H - band, 0, H); gr.addColorStop(0, '#6fc4b9'); gr.addColorStop(1, '#3f8f86');
  g.fillStyle = gr; g.fillRect(0, H - band, W, band);
  g.fillStyle = 'rgba(235,240,240,0.9)'; for (let x = 0; x < W; x += 24) g.fillRect(x, H - band, 3, band);
  // seams (silver)
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const l of P.lines) { g.strokeStyle = l.w > 5 ? '#fdfdfd' : 'rgba(205,210,214,0.95)'; g.lineWidth = l.w; forWrap(g, l.pts, () => g.stroke()); }

  // emissive glow map: only the tinted fills
  const emC = mk(), e = emC.getContext('2d'); e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (const f of P.fills) if (f.glow) { e.fillStyle = rgba(f.color, f.glow); forWrap(e, f.pts, () => e.fill()); }
  e.fillStyle = 'rgba(255,255,255,0.32)'; e.fillRect(0, 0, W, H);

  // alpha: cushions semi-clear, seams + glazing more solid
  const alC = mk(), a = alC.getContext('2d'); a.fillStyle = 'rgb(218,218,218)'; a.fillRect(0, 0, W, H);
  a.fillStyle = 'rgb(240,240,240)'; a.fillRect(0, H - band, W, band);
  a.strokeStyle = '#fff'; a.lineCap = 'round';
  for (const l of P.lines) { a.lineWidth = l.w + 1; forWrap(a, l.pts, () => a.stroke()); }

  // cushion height field: blur of the seam mask -> normal map
  const hW = W / 2, hH = H / 2, hC = document.createElement('canvas'); hC.width = hW; hC.height = hH; const h = hC.getContext('2d');
  h.fillStyle = '#fff'; h.fillRect(0, 0, hW, hH); h.scale(0.5, 0.5); h.strokeStyle = '#000'; h.lineCap = 'round';
  for (const l of P.lines) { h.lineWidth = l.w * 1.4 + 2; forWrap(h, l.pts, () => h.stroke()); }
  h.setTransform(1, 0, 0, 1, 0, 0);
  const bC = document.createElement('canvas'); bC.width = hW; bC.height = hH; const b = bC.getContext('2d');
  b.filter = 'blur(6px)'; b.drawImage(hC, 0, 0); b.filter = 'none';
  const src = b.getImageData(0, 0, hW, hH).data, nC = document.createElement('canvas'); nC.width = hW; nC.height = hH;
  const nctx = nC.getContext('2d'), out = nctx.createImageData(hW, hH), o = out.data;
  const Hh = (x, y) => src[(((y + hH) % hH) * hW + ((x + hW) % hW)) * 4] / 255;
  for (let y = 0; y < hH; y++) for (let x = 0; x < hW; x++) {
    const dx = (Hh(x + 1, y) - Hh(x - 1, y)) * 3.2, dy = (Hh(x, y + 1) - Hh(x, y - 1)) * 3.2;
    const l = Math.hypot(dx, dy, 1), i = (y * hW + x) * 4;
    o[i] = (-dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  nctx.putImageData(out, 0, 0);
  const T = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 16; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: T(colC), emissiveMap: T(emC), alphaMap: T(alC, false), normalMap: T(nC, false) };
}

export const OPTIONS = {
  A: { key: 'A', name: 'Rosa', subtitle: 'Layered spiralling petals — the original sketch, made buildable' },
  B: { key: 'B', name: 'The Lancashire Rose', subtitle: 'Five red heraldic petals, five white roof petals, green sepals' },
  C: { key: 'C', name: 'The Trinity Rose', subtitle: 'Three woven bands — Charlton · Law · Best — closing as a three-petal rose' },
  D: { key: 'D', name: 'The Rose Window', subtitle: 'Concentric petal cushions after Manchester Cathedral’s rose window' },
  R1: { key: 'R1', name: 'Rosa · Bloom', subtitle: 'Seven great petal loops round the body; six smaller loops roll over the roof' },
  R2: { key: 'R2', name: 'Rosa · Swirl', subtitle: 'Long spiral grooves from ground to oculus, closed into petals by counter-sweeps' },
  R4: { key: 'R4', name: 'Rosa · Original', subtitle: 'The sketch’s geometry: nested loops cut by tilted planes, turning like a rose' },
  R5: { key: 'R5', name: 'Rosa · v9 (locked)', subtitle: 'Client section; 13 + 21 spiral lattice; 15 golden-angle rose petals' },
  R3: { key: 'R3', name: 'Rosa · Unfurling', subtitle: 'Crescent petals ring the oculus like a rose seen from above' },
};
// taller, softer "cushion" body for the Rosa studies (closer to the sketch)
const SKIN_ROSA = [[0.92, 0], [0.99, 10], [1.025, 24], [1.03, 38], [1.0, 51], [0.94, 61], [0.84, 68], [0.72, 71], [0.61, 69.5], [0.56, 66]];

const cache = {};
export function buildSkin(key, { night = false } = {}) {
  const g = new THREE.Group(); g.name = 'envelope';
  const P = new Pattern(); PATTERNS[key](P);
  const sec = P.skin && P.skin === _v9 ? section(_v9, (A + B) / 2) : section(P.skin || (P.groove ? SKIN_ROSA : SKIN)), F = envPoint(sec);
  const tex = cache[key] ||= (P.groove ? synthesizeGroove(P) : synthesize(P));
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex.map, alphaMap: tex.alphaMap, normalMap: tex.normalMap, normalScale: new THREE.Vector2(P.bands ? 1.6 : P.groove ? 3.2 : 2.4, P.bands ? 1.6 : P.groove ? 3.2 : 2.4),
    emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: night ? 2.0 : (P.bands ? 0.5 : P.groove ? 0.3 : 0.16),
    roughness: 0.3, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xffffff),
    transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false,
  });
  // two passes so the translucent skin sorts correctly: far (inner) faces first, then near faces writing depth
  const geo = paramSurface((u, v) => F(u * TAU, v), 512, 96);
  const back = new THREE.Mesh(geo, mat.clone()); back.material.side = THREE.BackSide; back.name = 'skin'; back.renderOrder = 3; back.material.opacity = 0.22; back.material.emissiveIntensity *= 0.3;   // far side reads faintly through the near side
  mat.side = THREE.FrontSide; mat.depthWrite = true;
  const skin = new THREE.Mesh(geo, mat); skin.name = 'skin'; skin.renderOrder = 5; g.add(back, skin);
  // which side is "front"? paramSurface winding: flip if normals point inward
  // decide by majority over the whole surface: outward = away from the stadium axis on the wall, upward on the roof
  { const n = geo.attributes.normal, p0 = geo.attributes.position; let vote = 0;
    for (let i = 0; i < n.count; i += 37) vote += Math.sign(n.getX(i) * p0.getX(i) + n.getZ(i) * p0.getZ(i) + n.getY(i) * 200);
    if (vote < 0) { mat.side = THREE.BackSide; back.material.side = THREE.FrontSide; } }
  // low-poly stand-in for label occlusion tests (never drawn)
  const occ = new THREE.Mesh(paramSurface((u, v) => F(u * TAU, v), 48, 10), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  occ.name = 'occluder'; g.add(occ);
  if (P.groove) {   // give the roof real depth: a soffit 2.4 m below the skin from the eave to the opening, closed at the rim
    let sE = 0, kM = 0; for (let i = 0; i <= 200; i++) { const [kk] = sec(i / 200); if (kk > kM) { kM = kk; sE = i / 200; } }
    const T = 2.4, sMat = mat.clone(); sMat.side = THREE.DoubleSide; sMat.depthWrite = false; sMat.opacity = 0.45;   // same translucent patterned ETFE as the top surface
    const soffit = new THREE.Mesh(paramSurface((u, v) => offsetOn(F, u * TAU, sE + (1 - sE) * v, -T), 360, 48), sMat); soffit.renderOrder = 3;
    { const uv = soffit.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, sE + (1 - sE) * uv.getY(i)); uv.needsUpdate = true; }   // same pattern as the roof above
    soffit.name = 'roofSoffit'; g.add(soffit);
    const rim = new THREE.Mesh(paramSurface((u, v) => offsetOn(F, u * TAU, 1, -T * v), 360, 2), std(0xeef0f1, { roughness: 0.5, side: THREE.DoubleSide }));
    rim.name = 'roofRim'; g.add(rim);
    addBranding(g, F, sec);
  }
  g.userData.sec = sec;
  // white steel exoskeleton along the principal rose curves, standing just proud of the cushions
  const M = materials(); if (night) { M.rib.emissive.set(0xffffff); M.rib.emissiveIntensity = 0.8; }
  for (const r of P.ribs) {
    const pts = r.filter((_, i) => i % 2 === 0 || i === r.length - 1).map(([th, s]) => offsetOn(F, th, Math.min(1, Math.max(0, s)), 0.5));
    if (pts.length > 2) g.add(tube(pts, 0.45, M.rib, pts.length * 2));
  }
  const [ok, oy] = sec(1); const ocuPath = sePath(A * ok, B * ok, NE, 240); const ocu = oculusRing(ocuPath, oy - 7, oy, key === 'C' ? 'BEST  ·  LAW  ·  CHARLTON  ·  THE UNITED TRINITY  ·  ' : 'MANCHESTER UNITED  ·  '); ocu.name = 'oculus'; ocu.userData.perimeter = ocuPath.length; g.add(ocu);
  return g;
}

// Club branding on the façade: the crest on the south and north walls, and the name along the eave.
function decal(F, sec, thC, yMid, wM, hM, mat) {
  const sAt = (y) => { let lo = 0, hi = 0.6; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; sec(m)[1] < y ? lo = m : hi = m; } return lo; };
  let hv = hM; for (let i = 0; i < 8; i++) { const a = F(thC, sAt(yMid - hv / 2)), b = F(thC, sAt(yMid + hv / 2)); hv *= hM / Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }   // true height on the sloping wall
  const s0 = sAt(yMid - hv / 2), s1 = sAt(yMid + hv / 2), sm = (s0 + s1) / 2;
  // half-width in θ for the requested width in metres, measured along the wall
  let dth = 0.05; const arcW = (d) => { let L = 0, p = F(thC - d, sm); for (let i = 1; i <= 40; i++) { const q = F(thC - d + 2 * d * i / 40, sm); L += Math.hypot(q[0] - p[0], q[2] - p[2]); p = q; } return L; };
  for (let i = 0; i < 20; i++) dth *= wM / arcW(dth);   // true width along the curved wall, not the chord
  // u by arc length along the wall (the superellipse's angle parameter is not evenly spaced), so letters keep their size
  const TH = [], LS = [0]; { let p = F(thC + dth, sm); for (let i = 0; i <= 200; i++) { const th = thC + dth - 2 * dth * i / 200, q = F(th, sm); if (i) LS.push(LS[i - 1] + Math.hypot(q[0] - p[0], q[2] - p[2])); TH.push(th); p = q; } }
  const thAt = (u) => { const L = u * LS[200]; let i = 0; while (i < 199 && LS[i + 1] < L) i++; const f = (L - LS[i]) / ((LS[i + 1] - LS[i]) || 1); return TH[i] + (TH[i + 1] - TH[i]) * f; };
  const m = new THREE.Mesh(paramSurface((u, v) => offsetOn(F, thAt(u), s0 + (s1 - s0) * v, 0.9), 80, 30), mat);
  m.renderOrder = 6; return m;
}
// club wordmark: red, in a heavy display face close to the club's lettering (Archivo Black, loaded by the page)
function nameTexture() {
  const draw = (c) => { c.clearRect(0, 0, 4096, 320); c.font = '400 236px "Archivo Black", "Arial Black", Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 10; c.strokeStyle = '#f1c040'; c.strokeText('MANCHESTER UNITED', 2048, 168); c.fillStyle = '#da291c'; c.fillText('MANCHESTER UNITED', 2048, 168); };
  const tex = canvasTex(4096, 320, draw);
  document.fonts?.load?.('400 100px "Archivo Black"').then(() => { draw(tex.image.getContext('2d')); tex.needsUpdate = true; }).catch(() => {});
  return tex;
}
function addBranding(g, F, sec) {
  const crestTex = new THREE.TextureLoader().load('assets/crest.png'); crestTex.colorSpace = THREE.SRGBColorSpace; crestTex.anisotropy = 8;
  const crestMat = new THREE.MeshStandardMaterial({ map: crestTex, transparent: true, alphaTest: 0.05, emissiveMap: crestTex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.5, side: THREE.DoubleSide });
  crestMat.name = 'brand';
  const nameTex = nameTexture();
  const nameMat = new THREE.MeshStandardMaterial({ map: nameTex, transparent: true, alphaTest: 0.05, emissiveMap: nameTex, emissive: 0xffffff, emissiveIntensity: 0.25, side: THREE.DoubleSide });
  nameMat.name = 'brand';
  // three.js local +z is south: θ = π/2 south wall, 3π/2 north wall. Crest 13 m tall over a 70 m wordmark.
  for (const th of [Math.PI / 2, Math.PI * 1.5]) {
    g.add(decal(F, sec, th, 31, 13, 13, crestMat));
    g.add(decal(F, sec, th, 19.5, 70, 5.5, nameMat));
  }
}

export function buildStadium(key, opts = {}) {
  const g = new THREE.Group(); g.name = 'newStadium';
  const bowl = buildBowl(), skin = buildSkin(key, opts);
  g.add(bowl, skin);
  // the 360° screen is the oculus rim itself, facing the pitch
  const ocu = skin.getObjectByName('oculus');
  if (ocu && bowl.userData.makeHalo && skin.userData.sec) {
    ocu.parent?.remove(ocu);                                                              // no ring at the rim: the screen hangs further in
    const [ok, oy] = skin.userData.sec(1), roofY = (k) => oy + (k - ok) / (1.1 - ok) * 7;   // straight roof: rim -> eave
    const band = (k, y0, y1, flip = false) => {
      const path = sePath(A * k, B * k, NE, 360), N = path.pts.length, pos = [], uv = [], idx = [];
      let acc = 0; for (let i = 0; i <= N; i++) { const p = path.pts[i % N], q = path.pts[(i + N - 1) % N]; if (i) acc += Math.hypot(p.x - q.x, p.z - q.z); pos.push(p.x, y0, p.z, p.x, y1, p.z); const u = (flip ? -1 : 1) * acc / path.length; uv.push(u, 0, u, 1); }
      for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      return { geo, path };
    };
    // 360° screen: 7 m tall, set ~10 m in from the rim under the roof
    const kS = ok + 0.055, yS = roofY(kS) - 0.8, sb = band(kS, yS - 7, yS);
    const halo = bowl.userData.makeHalo(sb.path.length, 7); bowl.userData.addTicker(halo);
    // two-sided screen 1.2 m deep: one face to the pitch, one to the upper stands, joined top and bottom
    const kO = kS + 1.2 / ((A + B) / 2), haloMat = new THREE.MeshBasicMaterial({ map: halo.tex, side: THREE.DoubleSide, toneMapped: false });
    const screen = new THREE.Mesh(sb.geo, haloMat); screen.name = 'halo'; skin.add(screen);
    const back = new THREE.Mesh(band(kO, yS - 7, yS, true).geo, haloMat); back.name = 'halo'; skin.add(back);
    const cap = (y) => { const a = sePath(A * kS, B * kS, NE, 360), b = sePath(A * kO, B * kO, NE, 360), pos = [];
      for (let i = 0; i < a.pts.length; i++) { const j = (i + 1) % a.pts.length, p = a.pts[i], q = a.pts[j], r = b.pts[j], t = b.pts[i]; pos.push(p.x, y, p.z, q.x, y, q.z, r.x, y, r.z, p.x, y, p.z, r.x, y, r.z, t.x, y, t.z); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals(); return new THREE.Mesh(geo, std(0x1b1c1f, { side: THREE.DoubleSide })); };
    skin.add(cap(yS - 7), cap(yS));
    const frame = std(0x1b1c1f, { metalness: 0.5, side: THREE.DoubleSide });
    skin.add(new THREE.Mesh(band(kS, yS, roofY(kS)).geo, frame));                                   // hanger skirt up to the roof
    // floodlights embedded in the roof soffit, one evenly spaced ring half-way between the opening and the eave, aimed at the pitch
    const kF = (ok + 1.1) / 2, yF = roofY(kF) - 0.25, fp = sePath(A * kF, B * kF, NE, 720);
    const n = Math.round(fp.length / 7), lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.3, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0.4 }), n);
    lamp.material.userData.lampHead = true;
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const p = fp.pts[Math.floor(i / n * fp.pts.length)];
      o.position.set(p.x, yF, p.z); o.lookAt(0, 0, 0); o.rotateX(-Math.PI / 2); o.updateMatrix(); lamp.setMatrixAt(i, o.matrix);
    }
    lamp.name = 'floodRing'; skin.add(lamp);   // screen and roof lights belong to the façade/roof, so they hide with it
  }
  if (skin.userData.sec && key === 'R5') { const atr = buildAtrium(skin.userData.sec, { A, B, NE }); g.add(atr); g.userData.walkable = [...bowl.userData.walkable, ...atr.userData.walkable]; g.userData.interiorLabels = atr.userData.labels || []; g.userData.solids = [...bowl.userData.solids, ...(atr.userData.solids || [])]; }
  else g.userData.walkable = bowl.userData.walkable;
  g.userData.animate = bowl.userData.animate;
  return g;
}
