// The Flowers of Manchester Arena — seating bowl: stepped tiers with seat texture and lettering, vomitories,
// players' tunnel, LED perimeter boards and a 360° halo screen (both animated), pitch and goals.
import * as THREE from 'three';
import { PAL, sePath, canvasTex, glazingTex, pitchTex, std, seatLettering } from './kit.js';

const TAU = Math.PI * 2;
export const BOWL_PATH = () => sePath(60, 41, 5, 360);
// tiers: [front d, front y, back d, back y, rows]
export const TIERS = [[1, 1.2, 30, 15.6, 38], [25, 20, 46, 33.1, 27], [43, 37, 68, 52, 32]];
// back faces of the bowl structure seen from the atrium: [d, y from, y to]
export const BACK_FACES = [[30, 0, 17.4], [46, 17.4, 34.4], [68, 34.4, 53]];

const imgCache = {};
export function withImage(url, fn) {
  const rec = imgCache[url] ||= { img: Object.assign(new Image(), { src: url }), cbs: [] };
  if (rec.img.complete && rec.img.naturalWidth) fn(rec.img);
  else { rec.cbs.push(fn); rec.img.onload = () => rec.cbs.splice(0).forEach((f) => f(rec.img)); }
}

// sweep with explicit v per profile point
function cumAt(path, d = 0) {
  const N = path.pts.length, P = (i) => { const p = path.pts[i % N]; return [p.x + p.nx * d, p.z + p.nz * d]; };
  const cum = [0]; for (let i = 1; i <= N; i++) { const a = P(i - 1), b = P(i); cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  return cum;
}
// path index (fractional) where the arc length at offset d reaches fraction f
function indexAt(cum, f) { const L = cum[cum.length - 1] * f; let i = 0; while (i < cum.length - 2 && cum[i + 1] < L) i++; return i + (L - cum[i]) / ((cum[i + 1] - cum[i]) || 1); }
function sweepV(path, prof, uRepeat = 1, dU = 0, skipQ = null) {
  const N = path.pts.length, Pn = prof.length, pos = [], uv = [], idx = [];
  const cum = cumAt(path, dU);
  for (let i = 0; i <= N; i++) {
    const p = path.pts[i % N];
    for (const { d, y, v } of prof) { pos.push(p.x + p.nx * d, y, p.z + p.nz * d); uv.push(cum[i] / cum[N] * uRepeat, v); }
  }
  for (let i = 0; i < N; i++) { if (skipQ && skipQ(i)) continue; for (let k = 0; k < Pn - 1; k++) { const a = i * Pn + k, b = (i + 1) * Pn + k; idx.push(a, b, a + 1, b, b + 1, a + 1); } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
const flat = (path, prof) => sweepV(path, prof.map(([d, y], i) => ({ d, y, v: i / (prof.length - 1) })));

// Seat texture: one row of texture per row of seats (seat backs on the riser, seat pan + concrete on the tread)
function seatTex(L, rows, marks, nAisles) {
  const W = 8192, H = 2048, pxU = W / L, rowH = H / rows;
  const tex = canvasTex(W, H, (g) => drawSeats(g, W, H, pxU, rowH, rows, marks, null, nAisles));
  for (const m of marks) if (m.img) withImage(m.img, (img) => { drawSeats(tex.image.getContext('2d'), W, H, pxU, rowH, rows, marks, img, nAisles); tex.needsUpdate = true; });
  return tex;
}
function drawSeats(g, W, H, pxU, rowH, rows, marks, img, nAisles) {
  g.fillStyle = '#b90e2a'; g.fillRect(0, 0, W, H);
  // white lettering / logos (drawn as solid seat colour, rows applied on top)
  g.save(); g.translate(0, H); g.scale(1, -1);   // v=0 at the front row
  for (const m of marks) {
    const cx = m.at * W, cy = H * m.v, hM = m.h, hPx = hM * rowH / 0.85;   // ~0.85 m of rake per row
    if (m.text) {
      g.save(); g.translate(cx, cy); g.scale(1, -1); g.scale(pxU / (rowH / 0.85), 1);
      g.fillStyle = '#f4f2ee'; g.font = `900 ${hPx}px "Arial Black", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const step = hPx * 0.86, ch = [...m.text]; ch.forEach((c, i) => g.fillText(c, (i - (ch.length - 1) / 2) * step, 0));
      g.restore();
    }
    if (m.img && img) for (const ox of (m.at === 0 ? [0, W] : [cx])) {
      g.save(); g.translate(ox, cy); g.scale(1, -1); g.scale(pxU / (rowH / 0.85), 1);
      const s = hPx / img.height; g.drawImage(img, -img.width * s / 2, -hPx / 2, img.width * s, hPx); g.restore();
    }
  }
  g.restore();
  // rows: riser (seat backs) 0–45 %, tread (seat pan) 45–72 %, concrete step 72–100 %
  for (let r = 0; r < rows; r++) {
    const y0 = H - (r + 1) * rowH;     // canvas y is flipped vs v
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y0 + rowH * 0.55, W, rowH * 0.06);           // seat-back shadow line
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, y0 + rowH * 0.92, W, rowH * 0.05);       // seat-back top highlight
    g.fillStyle = '#8d8a86'; g.fillRect(0, y0, W, rowH * 0.28);                                   // concrete tread
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y0 + rowH * 0.27, W, 2);
  }
  // individual seats: a thin gap every 0.5 m
  const seat = 0.5 * pxU; g.fillStyle = 'rgba(30,0,6,0.55)';
  for (let x = 0; x < W; x += seat) for (let r = 0; r < rows; r++) g.fillRect(x, H - (r + 1) * rowH + rowH * 0.3, Math.max(1, seat * 0.12), rowH * 0.7);
  // aisles: exactly nAisles, evenly spaced along the tier (stair treads drawn across them)
  const aw = 1.2 * pxU;
  for (let k = 0; k < nAisles; k++) {
    const x = (k + 0.5) / nAisles * W - aw / 2;
    g.fillStyle = '#8f8b86'; g.fillRect(x, 0, aw, H);
    g.fillStyle = '#f1c040'; for (let r = 0; r < rows; r++) g.fillRect(x, H - (r + 1) * rowH + rowH * 0.26, aw, Math.max(2, rowH * 0.04));
  }
}

// ---------------- animated screens ----------------
// ---------------- LED tickers: a strip of panels sized to their content, scrolled by texture offset ----------------
// Bounds and text move together and nothing is clipped, because each panel is as wide as what it shows.
export function makeTicker(panels, Hpx, heightM, perimeterM, { speed = 6, gap = 0 } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 8;
  const font = (px, w = 900) => `${w} ${px}px "Arial Black", Arial, sans-serif`;
  const layout = () => panels.map((p) => {
    g.font = font(Hpx * (p.sub ? 0.46 : 0.58)); const tw = p.text ? g.measureText(p.text).width : 0;
    g.font = font(Hpx * 0.2, 600); const sw = p.sub ? g.measureText(p.sub).width : 0;
    const img = p.img && imgCache[p.img]?.img, iw = img && img.naturalWidth ? Hpx * 0.78 * img.naturalWidth / img.naturalHeight : (p.img ? Hpx * 0.78 : 0);
    return Math.ceil(Math.max(tw, sw) + iw + Hpx * (p.text && p.img ? 1.1 : 0.9));
  });
  const draw = () => {
    let widths = layout(), W = widths.reduce((a, b) => a + b + gap, 0);
    const k = Math.min(1, 16000 / W); if (k < 1) widths = widths.map((w) => Math.floor(w * k));
    W = widths.reduce((a, b) => a + b + gap, 0); c.width = W; c.height = Hpx;
    let x = 0;
    panels.forEach((p, i) => {
      const w = widths[i];
      g.fillStyle = p.bg; g.fillRect(x, 0, w, Hpx);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, 0, 3, Hpx);                      // panel joint
      const img = p.img && imgCache[p.img]?.img; let cx = x + Hpx * 0.45;
      if (img && img.naturalWidth) { const ih = Hpx * 0.78, iw = ih * img.naturalWidth / img.naturalHeight; g.drawImage(img, p.text ? cx : x + (w - iw) / 2, Hpx * 0.11, iw, ih); cx += iw + Hpx * 0.2; }
      if (p.text) {
        g.fillStyle = p.fg; g.textBaseline = 'middle'; g.textAlign = p.img ? 'left' : 'center';
        g.font = font(Hpx * (p.sub ? 0.46 : 0.58)); g.fillText(p.text, p.img ? cx : x + w / 2, Hpx * (p.sub ? 0.4 : 0.54));
        if (p.sub) { g.font = font(Hpx * 0.2, 600); g.fillStyle = p.subFg || p.fg; g.fillText(p.sub, p.img ? cx : x + w / 2, Hpx * 0.8); }
      }
      x += w + gap;
    });
    const stripM = W / Hpx * heightM; tex.repeat.x = Math.max(1, Math.round(perimeterM / stripM)); tex.needsUpdate = true;
    tex.userData.stripM = stripM;
  };
  draw();
  for (const p of panels) if (p.img) withImage(p.img, draw);
  return { tex, animate: (t) => { tex.offset.x = ((t * speed) / (tex.userData.stripM || 100)) % 1; } };
}
const SPONSORS = ['snapdragon', 'dxc', 'apollo', 'betfred', 'cadbury', 'canon', 'dhl', 'casillero', 'doo', 'esteelauder', 'extreme', 'konami',
  'malaysia', 'muily', 'paulsmith', 'remington', 'tiger', 'teamviewer', 'visitmalta'].map((k) => ({ bg: '#ffffff', img: `assets/sponsors/${k}.png` }));
const CLUB = [
  { bg: '#c8102e', fg: '#fff', text: 'MANCHESTER UNITED', img: 'assets/crest.png' },
  { bg: '#000', fg: '#fff', img: 'assets/adidas_white.png' },
  { bg: '#0b1424', fg: '#8cc8ec', text: 'THE FLOWERS OF MANCHESTER' },
  { bg: '#169b62', fg: '#fff', text: 'UNITED FOUNDATION' },
  { bg: '#000', fg: '#f1c040', text: 'SINCE 1878', img: 'assets/crest.png' },
];
// club panels interleaved with the club's sponsors (from logos/all_logos.jpeg)
export const BOARD_ADS = SPONSORS.flatMap((sp, i) => (i % 4 === 0 ? [CLUB[(i / 4) % CLUB.length], sp] : [sp]));
const HALO_PANELS_BASE = [
  { bg: '#c8102e', fg: '#fff', text: 'UNITED  2 – 0', sub: '72′  ·  THE FLOWERS OF MANCHESTER ARENA' },
  { bg: '#0b1424', fg: '#fff', text: 'MANCHESTER UNITED', img: 'assets/crest.png' },
  { bg: '#000', fg: '#fff', img: 'assets/adidas_white.png' },
  { bg: '#fff', fg: '#c8102e', text: 'WELCOME TO THE FLOWERS OF MANCHESTER' },
];
const HALO_PANELS = HALO_PANELS_BASE.flatMap((p, i) => [p, SPONSORS[(i * 3) % SPONSORS.length], SPONSORS[(i * 3 + 1) % SPONSORS.length]]);

// rounded-rectangle path (pitch-side boards), arc-length sampled, with outward normals
export function roundRectPath(hw, hh, r, N = 400) {
  const segs = [], arc = (cx, cz, a0) => { for (let i = 0; i <= 16; i++) { const a = a0 + i / 16 * Math.PI / 2; segs.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); } };
  arc(hw - r, hh - r, 0); arc(-hw + r, hh - r, Math.PI / 2); arc(-hw + r, -hh + r, Math.PI); arc(hw - r, -hh + r, Math.PI * 1.5);
  const cum = [0]; for (let i = 1; i <= segs.length; i++) { const a = segs[i - 1], b = segs[i % segs.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const L = cum[cum.length - 1], pts = [];
  for (let k = 0; k < N; k++) {
    const t = k / N * L; let i = 0; while (cum[i + 1] < t) i++;
    const f = (t - cum[i]) / (cum[i + 1] - cum[i]), a = segs[i], b = segs[(i + 1) % segs.length];
    const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f, tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz);
    pts.push({ x, z, nx: tz / tl, nz: -tx / tl });
  }
  return { pts, length: L };
}
export const BOARDS = { hw: 55.5, hh: 37, r: 7 };

// Closed sweep: a closed profile carried round the closed path -> a watertight ring volume.
// prof: [{d, y, v, m}] where m is the material index of the segment starting at that point. skip(i, k) cuts holes.
function sweepClosed(path, prof, dU, skip = () => false) {
  const N = path.pts.length, Pn = prof.length, pos = [], uv = [], byMat = {};
  const cum = cumAt(path, dU);
  for (let i = 0; i <= N; i++) { const p = path.pts[i % N]; for (const { d, y, v } of prof) { pos.push(p.x + p.nx * d, y, p.z + p.nz * d); uv.push(cum[i] / cum[N], v); } }
  for (let i = 0; i < N; i++) for (let k = 0; k < Pn; k++) {
    if (skip(i, k)) continue;
    const k2 = (k + 1) % Pn, a = i * Pn + k, b = (i + 1) * Pn + k, a2 = i * Pn + k2, b2 = (i + 1) * Pn + k2;
    (byMat[prof[k].m] ||= []).push(a, b, a2, b, b2, a2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const idx = []; for (const [m, list] of Object.entries(byMat)) { g.addGroup(idx.length, list.length, +m); for (const v of list) idx.push(v); }
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// merge helper for many small quads
function quadBatch() {
  const pos = [], uv = [];
  return {
    quad(a, b, c, d, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(...a, ...b, ...c, ...a, ...c, ...d); uv.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]); },
    mesh(mat) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return new THREE.Mesh(g, mat); },
  };
}
const crestDecal = (w, h) => { const t = new THREE.TextureLoader().load('assets/crest.png'); t.colorSpace = THREE.SRGBColorSpace; return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.05 })); };

export function buildBowl() {
  const g = new THREE.Group(); g.name = 'bowl';
  withImage('assets/crest.png', () => {}); withImage('assets/adidas_white.png', () => {});
  const P0 = BOWL_PATH(), N = P0.pts.length;
  const fasciaMat = new THREE.MeshStandardMaterial({ map: glazingTex('#5fb8ad', '#d9dfe2', 30, 2), roughness: 0.2, metalness: 0.3, side: THREE.DoubleSide });
  const redFascia = std(PAL.red, { roughness: 0.5 });
  const concrete = std(0xb4afa7, { roughness: 0.9 }), soffit = std(0xa7a29a), dark = std(0x26272a);
  const MARKS = [[], [], []];    // lettering is laid on as flat panels (seatLettering) so it never distorts round the corners
  const AISLE = 12, walkable = [], solids = [];
  // notches cut into the front of the lower tier: dugouts (north touchline, either side of halfway) and the players' tunnel (SW corner)
  const cumFront = cumAt(P0, 1), Lf = cumFront[N];
  const at = (f) => Math.round(indexAt(cumFront, ((f % 1) + 1) % 1)) % N;
  const halfIdx = (m) => Math.round(m / Lf * N);
  let swC = 0; P0.pts.forEach((p, i) => { if (-p.x / 60 + p.z / 41 > -P0.pts[swC].x / 60 + P0.pts[swC].z / 41) swC = i; });   // south-west corner
  const NOTCHES = [{ c: swC, hw: halfIdx(3.4), rows: 8, kind: 'tunnel' }];
  const TUN_LEN = (() => { const p = P0.pts[swC], sx = p.x + p.nx * TIERS[0][0], sz = p.z + p.nz * TIERS[0][0];
    for (let t = 0; t < 40; t += 0.25) { const x = sx - p.nx * t, z = sz - p.nz * t; if (Math.abs(x) <= 52.5 + 1.5 && Math.abs(z) <= 34 + 1.5) return Math.max(2.5, t); } return 6; })();
  const SLOT = (() => { const p = P0.pts[swC], [d0, , d1, , rows] = TIERS[0]; return { sx: p.x + p.nx * d0, sz: p.z + p.nz * d0, ux: p.nx, uz: p.nz, w: 5.6, rows: 8, depth: 8 * (d1 - d0) / rows }; })();
  const inNotch = (i) => NOTCHES.find((n) => { const d = Math.min(Math.abs(i - n.c), N - Math.abs(i - n.c)); return d <= n.hw; });

  TIERS.forEach(([d0, y0, d1, y1, rows], ti) => {
    const dd = (d1 - d0) / rows, dy = (y1 - y0) / rows, dMid = (d0 + d1) / 2;
    const base = ti === 0 ? 0 : y0 - 2.6;
    // closed profile: front face, stepped seating, back face, underside
    const prof = [{ d: d0, y: base, v: 0, m: 1 }];
    for (let r = 0; r < rows; r++) { prof.push({ d: d0 + r * dd, y: y0 + r * dy, v: r / rows, m: 0 }); prof.push({ d: d0 + r * dd, y: y0 + (r + 1) * dy, v: (r + 0.45) / rows, m: 0 }); }
    prof.push({ d: d1, y: y1, v: 1, m: 2 }); prof.push({ d: d1, y: base, v: 1, m: 3 });
    const cum = cumAt(P0, dMid), L = cum[N], nA = Math.round(L / AISLE);
    const seatMat = new THREE.MeshStandardMaterial({ map: seatTex(L, rows, MARKS[ti], nA), roughness: 0.75 });
    const frontMat = ti === 0 ? redFascia : ti === 1 ? dark : redFascia;
    const backMat = ti === 0 ? dark : ti === 1 ? fasciaMat : std(0x6f6a64);
    // vomitory openings cut right through the seating (same positions as the exits built below)
    const frV = ti === 2 ? 0.3 : 0.45, rvA = Math.round(rows * frV), rvB = rvA + 5, VOMS = [];
    for (let k = 0; k < nA; k++) {
      const fi = indexAt(cum, (k + 0.5) / nA), i0 = Math.floor(fi) % N, f2 = fi - Math.floor(fi), A0 = P0.pts[i0], B0 = P0.pts[(i0 + 1) % N];
      let nx = A0.nx + (B0.nx - A0.nx) * f2, nz = A0.nz + (B0.nz - A0.nz) * f2; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      const px = A0.x + (B0.x - A0.x) * f2, pz = A0.z + (B0.z - A0.z) * f2;
      if (ti === 0) { const ax = px - SLOT.sx, az = pz - SLOT.sz; if (Math.abs(ax * SLOT.uz - az * SLOT.ux) < 8 && ax * SLOT.ux + az * SLOT.uz > -2) continue; }
      VOMS.push({ ox: px + nx * (d0 + rvA * dd), oz: pz + nz * (d0 + rvA * dd), nx, nz, len: (rvB - rvA) * dd });
    }
    const inVom = (i, k) => {
      if (k < 2 * rvA + 1 || k > 2 * rvB) return false;
      const pa = P0.pts[i], pb = P0.pts[(i + 1) % N], d = (prof[k].d + prof[(k + 1) % prof.length].d) / 2;
      const qx = (pa.x + pb.x) / 2 + (pa.nx + pb.nx) / 2 * d, qz = (pa.z + pb.z) / 2 + (pa.nz + pb.nz) / 2 * d;
      return VOMS.some((v) => { const ax = qx - v.ox, az = qz - v.oz, al = ax * v.nx + az * v.nz; return al > -0.3 && al < v.len + 0.3 && Math.abs(ax * v.nz - az * v.nx) < 1.5; });
    };
    const skip = (i, k) => inVom(i, k) || (ti === 0 && slotSkip(i, k));
    const slotSkip = (i, k) => {
      if (k > SLOT.rows * 2) return false;
      const pa = P0.pts[i], pb = P0.pts[(i + 1) % N], d = (prof[k].d + prof[(k + 1) % prof.length].d) / 2;
      const qx = (pa.x + pb.x) / 2 + (pa.nx + pb.nx) / 2 * d - SLOT.sx, qz = (pa.z + pb.z) / 2 + (pa.nz + pb.nz) / 2 * d - SLOT.sz;
      const along = qx * SLOT.ux + qz * SLOT.uz, lat = Math.abs(qx * SLOT.uz - qz * SLOT.ux);
      return along > -1 && along < SLOT.depth + 0.6 && lat < SLOT.w / 2;
    };
    const m = new THREE.Mesh(sweepClosed(P0, prof, dMid, skip), [seatMat, frontMat, backMat, ti === 0 ? concrete : soffit]);
    m.name = 'tier' + (ti + 1); g.add(m); walkable.push(m); solids.push(m);
    // exits: one vomitory on every aisle, mid-tier, with a red header carrying the block number
    const fr = ti === 2 ? 0.3 : 0.45, rv0 = Math.round(rows * fr), rv1 = rv0 + 5;     // spans 5 rows
    const dv0 = d0 + rv0 * dd, dv1 = d0 + rv1 * dd, yv0 = y0 + rv0 * dy, yv1 = y0 + rv1 * dy;
    const holes = quadBatch(), walls = quadBatch(), heads = quadBatch(), floors = quadBatch(), W2 = 1.25;
    const stand = (f) => (f > 0.125 && f <= 0.375 ? 'S' : f > 0.375 && f <= 0.625 ? 'W' : f > 0.625 && f <= 0.875 ? 'N' : 'E');
    const labels = [];
    for (let k = 0; k < nA; k++) {
      const f = (k + 0.5) / nA, fi = indexAt(cum, f), i0 = Math.floor(fi) % N, fr2 = fi - Math.floor(fi);
      const A0 = P0.pts[i0], B0 = P0.pts[(i0 + 1) % N], px = A0.x + (B0.x - A0.x) * fr2, pz = A0.z + (B0.z - A0.z) * fr2;
      if (ti === 0) { const ax = px - SLOT.sx, az = pz - SLOT.sz; if (Math.abs(ax * SLOT.uz - az * SLOT.ux) < 8 && ax * SLOT.ux + az * SLOT.uz > -2) continue; }
      const A_ = P0.pts[i0], B_ = P0.pts[(i0 + 1) % N];
      let nx = A_.nx + (B_.nx - A_.nx) * fr2, nz = A_.nz + (B_.nz - A_.nz) * fr2; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      const tx = -nz, tz = nx;
      const q = (d, w, y) => [px + nx * d + tx * w, y, pz + nz * d + tz * w];
      const floorY0 = yv0 + 0.02, floorY1 = yv0 - 2.4;          // walkway steps down from the seating into the concourse
      floors.quad(q(dv0, -W2, floorY0), q(dv0, W2, floorY0), q(dv1, W2, floorY1), q(dv1, -W2, floorY1), [[0, 0], [1, 0], [1, 6], [0, 6]]);
      holes.quad(q(dv1, -W2, floorY1), q(dv1, W2, floorY1), q(dv1, W2, yv1), q(dv1, -W2, yv1));   // dark portal into the concourse
      for (const w of [-W2, W2]) {                                 // side walls rising with the rake, a parapet on top
        walls.quad(q(dv0, w, floorY0 - 0.1), q(dv1, w, floorY1 - 0.1), q(dv1, w, yv1 + 1.0), q(dv0, w, yv0 + 1.0));
      }
      walls.quad(q(dv0, -W2, floorY0), q(dv0, W2, floorY0), q(dv0, W2, yv0 + 1.0), q(dv0, -W2, yv0 + 1.0));  // front parapet
      // header panel on the back edge
      const code = stand(f) + (ti + 1) + String(k + 1).padStart(2, '0'); labels.push(code);
      const cell = labels.length - 1, cu = (cell % 16) / 16, cv = 1 - (Math.floor(cell / 16) + 1) / 8;
      heads.quad(q(dv1 + 0.05, -W2, yv1 + 0.1), q(dv1 + 0.05, W2, yv1 + 0.1), q(dv1 + 0.05, W2, yv1 + 0.1 + W2), q(dv1 + 0.05, -W2, yv1 + 0.1 + W2),
        [[cu, cv], [cu + 1 / 16, cv], [cu + 1 / 16, cv + 1 / 8], [cu, cv + 1 / 8]]);
    }
    g.add(holes.mesh(std(0x0b0b0b, { roughness: 1, side: THREE.DoubleSide })));
    const stepTex = canvasTex(64, 64, (c) => { c.fillStyle = '#b9b5ae'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#f1c040'; c.fillRect(0, 0, 64, 5); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 5, 64, 3); }, { repeat: [1, 1] });
    g.add(floors.mesh(new THREE.MeshStandardMaterial({ map: stepTex, roughness: 0.9, side: THREE.DoubleSide })));
    g.add(walls.mesh(std(0xf2f2f2, { side: THREE.DoubleSide })));
    const atlas = canvasTex(2048, 512, (c) => {
      labels.forEach((t, i) => { const x = (i % 16) * 128, y = Math.floor(i / 16) * 64; c.fillStyle = '#c8102e'; c.fillRect(x, y, 128, 64); c.fillStyle = '#fff'; c.font = '700 30px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, x + 64, y + 34); c.fillStyle = '#f1c040'; c.fillRect(x, y + 58, 128, 6); });
    });
    g.add(heads.mesh(new THREE.MeshStandardMaterial({ map: atlas, side: THREE.DoubleSide, roughness: 0.6 })));
  });
  g.userData.walkable = walkable; g.userData.solids = solids;

  // structure: columns under the middle and upper tiers, radial downstand beams under their soffits, all standing on the ground
  const colGeo = new THREE.CylinderGeometry(0.55, 0.65, 1, 12), beamGeo = new THREE.BoxGeometry(1, 1, 1), conc = std(0xc9c4bb, { roughness: 0.85 });
  const cols = [], beams = [];
  for (const [d, top, dA, dB, yB] of [[40, 17.4 - 2.6 + 2.6, 25, 46, 17.4], [64, 34.4, 43, 68, 34.4]]) {
    const cumD = cumAt(P0, d), n = Math.round(cumD[N] / 10);
    for (let k = 0; k < n; k++) {
      const fi = indexAt(cumD, (k + 0.5) / n), p = P0.pts[Math.floor(fi) % N];
      cols.push([p.x + p.nx * d, top / 2, p.z + p.nz * d, top]);
      beams.push([p.x + p.nx * (dA + dB) / 2, yB - 0.6, p.z + p.nz * (dA + dB) / 2, dB - dA, Math.atan2(p.nz, p.nx)]);
    }
  }
  const colIM = new THREE.InstancedMesh(colGeo, conc, cols.length), beamIM = new THREE.InstancedMesh(beamGeo, conc, beams.length), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  cols.forEach(([x, y, z, h], i) => { M4.compose(new THREE.Vector3(x, y, z), Q.identity(), new THREE.Vector3(1, h, 1)); colIM.setMatrixAt(i, M4); });
  beams.forEach(([x, y, z, len, a], i) => { M4.compose(new THREE.Vector3(x, y, z), Q.setFromAxisAngle(Y, -a), new THREE.Vector3(len, 1.2, 0.8)); beamIM.setMatrixAt(i, M4); });
  colIM.castShadow = true;   // vertical columns not shown: the atrium floors and slanted columns carry the tiers                // no exposed downstand beams under the tiers

  // ---- dugouts and tunnel, built into their notches
  const brick = new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (c) => { c.fillStyle = '#7b3a2c'; c.fillRect(0, 0, 128, 128); for (let r = 0; r < 16; r++) for (let k = 0; k < 8; k++) { c.fillStyle = `hsl(${10 + Math.random() * 6},45%,${28 + Math.random() * 8}%)`; c.fillRect(k * 16 + (r % 2) * 8, r * 8, 15, 7); } }, { repeat: [3, 1] }), roughness: 0.9 });
  const black = std(0x111111, { roughness: 0.6 }), seatRed = std(0xd21f35, { roughness: 0.45 });
  const [td0, ty0, td1, ty1, trows] = TIERS[0], tdd = (td1 - td0) / trows, tdy = (ty1 - ty0) / trows;
  for (const n of NOTCHES) {
    const p = P0.pts[n.c], ang = Math.atan2(p.nz, p.nx), depth = n.rows * tdd, topY = ty0 + n.rows * tdy, width = (2 * n.hw + 1) / N * Lf;
    const grp = new THREE.Group(); grp.position.set(p.x + p.nx * td0, 0, p.z + p.nz * td0); grp.rotation.y = -ang + Math.PI / 2;   // local +z = outward (into the stand)
    const W = SLOT.w, D2 = SLOT.depth, rake = (z) => ty0 + tdy + z * tdy / tdd;
    const flr = new THREE.Mesh(new THREE.PlaneGeometry(W, D2 + 1), std(0x2a2a2a, { roughness: 1 })); flr.rotation.x = -Math.PI / 2; flr.position.set(0, 0.06, D2 / 2); grp.add(flr);
    for (const sx of [-1, 1]) {      // retaining walls whose tops follow the seat rows
      const sh2 = new THREE.Shape([new THREE.Vector2(-0.6, 0), new THREE.Vector2(D2 + 0.6, 0), new THREE.Vector2(D2 + 0.6, rake(D2 + 0.6) + 0.9), new THREE.Vector2(-0.6, rake(-0.6) + 0.9)]);
      const wall = new THREE.Mesh(new THREE.ExtrudeGeometry(sh2, { depth: 0.4, bevelEnabled: false }), brick); wall.rotation.y = -Math.PI / 2; wall.position.set(sx * (W / 2) + (sx > 0 ? 0.4 : 0), 0, 0); grp.add(wall);
    }
    const backW = new THREE.Mesh(new THREE.BoxGeometry(W, rake(D2) + 0.9, 0.4), black); backW.position.set(0, (rake(D2) + 0.9) / 2, D2 + 0.4); grp.add(backW);
    if (n.kind === 'dugout') {
      for (let r = 0; r < 3; r++) {     // three rising rows of padded red seats
        const seat = new THREE.Mesh(new THREE.BoxGeometry(width - 1.4, 0.6 + r * 0.55, 1.1), seatRed); seat.position.set(0, (0.6 + r * 0.55) / 2 + 0.4, 2.2 + r * 1.3); grp.add(seat);
        const backs = new THREE.Mesh(new THREE.BoxGeometry(width - 1.4, 0.9, 0.2), seatRed); backs.position.set(0, 0.4 + 0.6 + r * 0.55 + 0.45, 2.7 + r * 1.3); grp.add(backs);
      }
      const panel = new THREE.Mesh(new THREE.BoxGeometry(width, 1.2, 0.25), black); panel.position.set(0, 0.6, 0.2); grp.add(panel);
      const crest = crestDecal(1.0, 1.0); crest.position.set(0, 0.62, 0.05); crest.rotation.y = Math.PI; grp.add(crest);
      const lbl = canvasTex(256, 64, (c) => { c.fillStyle = '#111'; c.fillRect(0, 0, 256, 64); c.fillStyle = '#fff'; c.font = '700 22px Arial'; c.fillText(n.team, 10, 40); });
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: lbl })); tag.position.set(-width / 2 + 1.6, 0.9, 0.06); tag.rotation.y = Math.PI; grp.add(tag);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, 2.4), new THREE.MeshPhysicalMaterial({ color: 0xd8eef2, transparent: true, opacity: 0.4, roughness: 0.05 })); roof.position.set(0, topY + 0.1, 1.2); grp.add(roof);
    } else {
      // tunnel mouth under the corner seats, a retractable red tunnel out to the pitch and a branded arch
      
      const red = std(PAL.red, { roughness: 0.55, side: THREE.DoubleSide });
      const len = TUN_LEN, tw = 4.4, th = 3.1, t = 0.18, sh = new THREE.Shape();
      // hollow U-section: outer outline up and over, then back along the inner face
      sh.moveTo(-tw / 2, 0); sh.lineTo(-tw / 2, th - 0.6); sh.quadraticCurveTo(-tw / 2, th, -tw / 2 + 0.6, th); sh.lineTo(tw / 2 - 0.6, th); sh.quadraticCurveTo(tw / 2, th, tw / 2, th - 0.6); sh.lineTo(tw / 2, 0);
      sh.lineTo(tw / 2 - t, 0); sh.lineTo(tw / 2 - t, th - 0.6); sh.quadraticCurveTo(tw / 2 - t, th - t, tw / 2 - 0.6, th - t); sh.lineTo(-tw / 2 + 0.6, th - t); sh.quadraticCurveTo(-tw / 2 + t, th - t, -tw / 2 + t, th - 0.6); sh.lineTo(-tw / 2 + t, 0); sh.closePath();
      const runL = len + SLOT.depth + 0.2, tube = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: runL, bevelEnabled: false, curveSegments: 6 }), red); tube.position.set(0, 0.06, -len); grp.add(tube);   // runs from the pitch end right back into the stand
      const inside = new THREE.Mesh(new THREE.PlaneGeometry(tw - 0.4, runL), std(0x2a2a2a)); inside.rotation.x = -Math.PI / 2; inside.position.set(0, 0.08, -len + runL / 2); grp.add(inside);
      // concertina ribs
      for (let k = 0; k <= 14; k++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.12, 0.1, 0.12), std(0x9c0c22)); rib.position.set(0, 0.06 + th + 0.04, -len + k * runL / 14); grp.add(rib); }
      const arch = new THREE.Group(); arch.position.set(0, 0, -len - 0.1); grp.add(arch);
      for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.2, 0.5), red); post.position.set(sx * (tw / 2 + 0.35), 2.1, 0); arch.add(post); }
      const lintelTex = canvasTex(1024, 159, (c) => { c.fillStyle = '#c8102e'; c.fillRect(0, 0, 1024, 128); c.fillStyle = '#fff'; c.font = '700 70px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('MANCHESTER UNITED', 512, 68); });
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(tw + 1.4, 0.9, 0.5), [red, red, red, red, new THREE.MeshBasicMaterial({ map: lintelTex }), new THREE.MeshBasicMaterial({ map: lintelTex })]);
      lintel.position.set(0, 3.75, 0); arch.add(lintel);
      for (const sx of [-1, 1]) for (const y of [1.1, 2.4]) { const c = crestDecal(0.55, 0.55); c.position.set(sx * (tw / 2 + 0.35), y, -0.26); c.rotation.y = Math.PI; arch.add(c); }
      const green = new THREE.Mesh(new THREE.PlaneGeometry(tw + 3, len), std(0x3f6f3a, { roughness: 1 })); green.rotation.x = -Math.PI / 2; green.position.set(0, 0.12, -len / 2); grp.add(green);
    }
    g.add(grp);
  }

  // pitch, surround, goals
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(126, 88), std(0x2f6e2a)); surround.rotation.x = -Math.PI / 2; surround.position.y = 0.05; g.add(surround);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105 / 0.94, 68 / 0.9069), new THREE.MeshStandardMaterial({ map: pitchTex(), roughness: 0.9 }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.1; pitch.name = 'pitch'; g.add(pitch); walkable.push(pitch, surround);
  const goalMat = std(0xffffff), net = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 });
  for (const sx of [-1, 1]) {
    const gp = new THREE.Group();
    for (const zz of [-3.66, 3.66]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44), goalMat); p.position.set(0, 1.22, zz); gp.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32), goalMat); bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; gp.add(bar);
    const nt = new THREE.Mesh(new THREE.BoxGeometry(2, 2.44, 7.32, 4, 6, 14), net); nt.position.set(sx, 1.22, 0); gp.add(nt);
    gp.position.x = sx * 52.5; g.add(gp);
  }

  // VIP boxes along the back of tiers 1 and 2: a slim band of aqua glass (semi-transparent) over lit rooms, a box every 4 m
  const roomTex = canvasTex(512, 64, (c) => {
    for (let x = 0; x < 512; x += 64) {
      const gr = c.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#f3e6cc'); gr.addColorStop(1, '#a9845a');
      c.fillStyle = gr; c.fillRect(x, 0, 64, 64);
      c.fillStyle = 'rgba(40,30,25,0.4)'; c.fillRect(x + 8, 40, 46, 8); c.fillRect(x + 18 + (x % 3) * 7, 22, 6, 18);
      c.fillStyle = '#2a2c30'; c.fillRect(x, 0, 5, 64);
    }
  });
  const glassTex = canvasTex(256, 64, (c) => {
    c.fillStyle = 'rgba(95,184,173,0.55)'; c.fillRect(0, 0, 256, 64);
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, 0, 256, 8);
    c.fillStyle = 'rgba(235,242,242,0.95)'; for (let x = 0; x < 256; x += 32) c.fillRect(x, 0, 3, 64); c.fillRect(0, 0, 256, 3); c.fillRect(0, 61, 256, 3);
  });
  for (const [ti, top] of [[0, TIERS[1][1] - 2.6], [1, TIERS[2][1] - 2.6]]) {
    const [, , dB, yB] = TIERS[ti], cumB = cumAt(P0, dB), reps = Math.round(cumB[N] / 32);
    const rooms = new THREE.Mesh(sweepV(P0, [{ d: dB + 0.02, y: yB, v: 0 }, { d: dB + 0.02, y: top, v: 1 }], reps, dB),
      new THREE.MeshStandardMaterial({ map: roomTex, emissiveMap: roomTex, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.8, side: THREE.DoubleSide }));
    rooms.material.userData.nightGlow = true; g.add(rooms);
    const glass = new THREE.Mesh(sweepV(P0, [{ d: dB - 0.6, y: yB, v: 0 }, { d: dB - 0.6, y: top, v: 1 }], reps * 2, dB),
      new THREE.MeshPhysicalMaterial({ map: glassTex, transparent: true, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    glass.name = 'vipBoxes' + (ti + 1); glass.renderOrder = 3; g.add(glass);
    g.add(new THREE.Mesh(sweepV(P0, [{ d: dB - 0.7, y: yB + 0.02, v: 0 }, { d: dB + 0.02, y: yB + 0.02, v: 1 }], 1, dB), std(0x2a2c30, { side: THREE.DoubleSide })));   // sill
  }

  // tickers: pitch-side boards, the ribbon between tiers 1 and 2, and the 360° screen on the roof rim
  const bp = roundRectPath(BOARDS.hw, BOARDS.hh, BOARDS.r);
  const boardT = makeTicker(BOARD_ADS, 96, 0.9, bp.length, { speed: 5 });
  const tp = P0.pts[swC], tS = [tp.x + tp.nx * TIERS[0][0], tp.z + tp.nz * TIERS[0][0]], tE = [tS[0] - tp.nx * (TUN_LEN + 1), tS[1] - tp.nz * (TUN_LEN + 1)];
  const nearTunnel = (q) => { const vx = tE[0] - tS[0], vz = tE[1] - tS[1], t = Math.max(0, Math.min(1, ((q.x - tS[0]) * vx + (q.z - tS[1]) * vz) / (vx * vx + vz * vz))); return Math.hypot(q.x - tS[0] - vx * t, q.z - tS[1] - vz * t) < 3.6; };
  const boards = new THREE.Mesh(sweepV(bp, [{ d: 0, y: 0.1, v: 0 }, { d: 0, y: 1.0, v: 1 }], 1, 0, (i) => nearTunnel(bp.pts[i]) || nearTunnel(bp.pts[(i + 1) % bp.pts.length])), new THREE.MeshBasicMaterial({ map: boardT.tex, side: THREE.DoubleSide, toneMapped: false }));
  boards.name = 'ledBoards'; g.add(boards);
  const tickers = [boardT];
  for (const [ti, dir] of [[1, 3], [2, 3]]) {          // every ticker scrolls the same way round the bowl
    const [dT, yT] = TIERS[ti], dB = dT - 0.06, cumT = cumAt(P0, dB);
    const tk = makeTicker(ti === 1 ? BOARD_ADS.slice().reverse() : BOARD_ADS, 96, 1.0, cumT[N], { speed: dir });
    const band = new THREE.Mesh(sweepV(P0, [{ d: dB, y: yT - 1.25, v: 0 }, { d: dB, y: yT - 0.25, v: 1 }], 1, dB), new THREE.MeshBasicMaterial({ map: tk.tex, side: THREE.DoubleSide, toneMapped: false }));
    band.name = 'ledRibbon' + ti; g.add(band); tickers.push(tk);
  }
  // seat lettering: MANCHESTER (tier 2) over UNITED (tier 1) in the North Stand; adidas in tier 2 behind the east goal
  const T1 = TIERS[0], T2 = TIERS[1];
  g.add(seatLettering({ text: 'UNITED', R: 41, d0: T1[0], y0: T1[1], d1: T1[2], y1: T1[3], rows: T1[4], frac: 0.5, width: 74, height: 15 }));
  g.add(seatLettering({ text: 'MANCHESTER', R: 41, d0: T2[0], y0: T2[1], d1: T2[2], y1: T2[3], rows: T2[4], frac: 0.5, width: 104, height: 13 }));
  g.add(seatLettering({ img: 'assets/adidas_white.png', R: 60, d0: T2[0], y0: T2[1], d1: T2[2], y1: T2[3], rows: T2[4], frac: 0.5, width: 34, height: 19, rotY: -Math.PI / 2 }));
  g.userData.makeHalo = (perimeterM, heightM) => makeTicker(HALO_PANELS, 256, heightM, perimeterM, { speed: 2.5 });
  g.userData.addTicker = (t) => tickers.push(t);
  g.userData.animate = (t) => tickers.forEach((k) => k.animate(t));
  return g;
}
