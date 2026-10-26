// The Flowers of Manchester Arena — parametric stadium generator.
// Local frame: x = long (pitch) axis, z = short axis, y = up, metres. Origin = centre spot.
import * as THREE from 'three';
import { PAL, seP, sePath, sweepProfile, paramSurface, tube, canvasTex, seatRowsTex, glazingTex, diagridTex, pitchTex, std, shade } from './kit.js';

// Envelope plan base (outer footprint ~296 x 248 m)
export const A = 148, B = 124, NE = 2.6;

// ---------- section curves (k = plan scale of the envelope oval, y = height) ----------
export function section(pts, kScale = 1) {
  // kScale > 1 measures arc length in true metres (plan scale k × kScale) so s is real surface distance
  const c = new THREE.CatmullRomCurve3(pts.map(([k, y]) => new THREE.Vector3(k * kScale, y, 0)), false, 'centripetal');
  c.arcLengthDivisions = 2000;
  return (s) => { const p = c.getPointAt(Math.min(1, Math.max(0, s))); return [p.x / kScale, p.y]; };
}
export const envPoint = (sec) => (th, s, kAdd = 0, yAdd = 0) => {
  const [k, y] = sec(s); const [x, z] = seP(th, A * (k + kAdd), B * (k + kAdd), NE); return [x, y + yAdd, z];
};
// offset a parametric surface point along its outward normal
export function offsetOn(F, th, s, off) {
  const e = 1e-3, p = F(th, s), a = F(th + e, s), b = F(th, Math.min(1, s + e)), b2 = F(th, Math.max(0, s - e));
  const t1 = new THREE.Vector3(a[0] - p[0], a[1] - p[1], a[2] - p[2]);
  const t2 = new THREE.Vector3(b[0] - b2[0], b[1] - b2[1], b[2] - b2[2]);
  const n = new THREE.Vector3().crossVectors(t2, t1).normalize();
  if (n.x * p[0] / A + n.z * p[2] / B < 0 && Math.abs(n.y) < 0.95) n.negate();
  if (Math.abs(n.y) >= 0.95 && n.y < 0) n.negate();
  return [p[0] + n.x * off, p[1] + n.y * off, p[2] + n.z * off];
}
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mix = (c1, c2, t) => { const a = new THREE.Color(c1), b = new THREE.Color(c2); return a.lerp(b, t); };

// ---------- shared materials ----------
export function materials() {
  const etfe = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: diagridTex('#ffffff', '#dfe4e8', 10, 3), vertexColors: true,
    roughness: 0.3, metalness: 0.0, clearcoat: 0.6, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false });
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xeef3f6, map: diagridTex('#ffffff', '#c9d3da', 24, 2), roughness: 0.2,
    transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
  const aquaGlass = new THREE.MeshStandardMaterial({ map: glazingTex('#5fb8ad', '#e9eef0', 10, 3), roughness: 0.12, metalness: 0.35, side: THREE.DoubleSide });
  const rib = std(0xf7f7f5, { roughness: 0.35, metalness: 0.4 });
  const concrete = std(0xbdb8b0, { roughness: 0.9 });
  return { etfe, skin, aquaGlass, rib, concrete };
}

// ---------- seating bowl (common to all options; ~100k capacity) ----------
export function buildBowl({ letteringNorth = ['MANCHESTER', 'UNITED'], letteringSouth = ['THE FLOWERS', 'OF MANCHESTER'] } = {}) {
  const g = new THREE.Group(); g.name = 'bowl';
  const P0 = sePath(60, 41, 5, 360);
  const per = (d) => sePath(60 + d, 41 + d, 5, 8).length;
  // tiers: [front d, front y, back d, back y, rows]
  const tiers = [[1, 1.2, 30, 14, 38], [25, 20, 46, 32, 27], [43, 37, 68, 52, 32]];
  const fasciaMat = new THREE.MeshStandardMaterial({ map: glazingTex('#5fb8ad', '#d9dfe2', 30, 2), roughness: 0.2, metalness: 0.3, side: THREE.DoubleSide });
  const redFascia = std(PAL.red, { side: THREE.DoubleSide, roughness: 0.5 });
  tiers.forEach(([d0, y0, d1, y1, rows], ti) => {
    const L = per((d0 + d1) / 2), mV = Math.hypot(d1 - d0, y1 - y0);
    let tex;
    const words = [];
    // north side is at path fraction ~0.75, south ~0.25 (path runs +x -> +z -> -x -> -z)
    if (ti === 0) { words.push({ text: letteringNorth[1], at: 0.75 }); words.push({ text: 'UNITED', at: 0.25 }); }
    if (ti === 1) { words.push({ text: letteringNorth[0], at: 0.75 }); words.push({ text: letteringSouth[1] ?? '', at: 0.25 }); }
    if (ti === 2) { words.push({ text: letteringSouth[0] ?? '', at: 0.25 }); }
    tex = seatBanner(words, L, mV, rows);
    const geo = sweepProfile(P0, [{ d: d0, y: y0 }, { d: d1, y: y1 }]);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
    m.name = 'tier' + (ti + 1); g.add(m);
    // front fascia / balcony
    if (ti > 0) g.add(new THREE.Mesh(sweepProfile(P0, [{ d: d0, y: y0 - 2.6 }, { d: d0, y: y0 + 0.4 }]), ti === 1 ? fasciaMat : redFascia));
    else g.add(new THREE.Mesh(sweepProfile(P0, [{ d: d0 - 0.2, y: 0 }, { d: d0 - 0.2, y: y0 + 0.2 }]), redFascia));
    // soffit under each upper tier
    if (ti > 0) g.add(new THREE.Mesh(sweepProfile(P0, [{ d: d0, y: y0 - 2.6 }, { d: d1, y: y0 - 2.6 }]), std(0x9a958d, { side: THREE.DoubleSide })));
    // back wall (hospitality glazing band in OT aqua)
    const nextFrontY = ti < 2 ? tiers[ti + 1][1] - 2.6 : y1 + 1;
    g.add(new THREE.Mesh(sweepProfile(P0, [{ d: d1, y: y1 }, { d: d1, y: nextFrontY }]), ti < 2 ? fasciaMat : std(0x6f6a64, { side: THREE.DoubleSide })));
  });
  // outer concourse wall, closes the bowl to ground
  g.add(new THREE.Mesh(sweepProfile(P0, [{ d: 72, y: 0 }, { d: 72, y: 53 }]), std(0x8f8a84, { side: THREE.DoubleSide })));
  // pitch + surround
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(126, 88), std(0x2f6e2a)); surround.rotation.x = -Math.PI / 2; surround.position.y = 0.05; g.add(surround);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshStandardMaterial({ map: pitchTex(), roughness: 0.9 }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.1; pitch.name = 'pitch'; g.add(pitch);
  // goals
  const goalMat = std(0xffffff);
  for (const sx of [-1, 1]) {
    const gp = new THREE.Group();
    for (const zz of [-3.66, 3.66]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44), goalMat); p.position.set(0, 1.22, zz); gp.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32), goalMat); bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; gp.add(bar);
    gp.position.x = sx * 52.5; g.add(gp);
  }
  return g;
}

// Seat texture with properly proportioned lettering. L = perimeter (m), mV = tier depth (m).
function seatBanner(words, L, mV, rows) {
  const W = 8192, H = 512, pxU = W / L, pxV = H / mV;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#c8102e'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < rows; i++) { const y = i * H / rows; g.fillStyle = 'rgba(0,0,0,0.33)'; g.fillRect(0, y, W, H / rows * 0.28); }
    const aisle = 14 * pxU; for (let x = 0; x < W; x += aisle) { g.fillStyle = 'rgba(70,70,70,0.6)'; g.fillRect(x, 0, Math.max(2, 1.1 * pxU), H); }
    g.fillStyle = '#f5f3ef'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const { text, at } of words) {
      if (!text) continue;
      const capM = Math.min(mV * 0.55, 9); // cap height in metres
      g.save(); g.translate(at * W, H * 0.48); g.scale(pxU / pxV, 1);
      g.font = `900 ${capM * pxV}px Arial Black, Arial, sans-serif`;
      const step = capM * pxV * 1.02; const chars = [...text];
      chars.forEach((ch, i) => g.fillText(ch, (i - (chars.length - 1) / 2) * step, 0));
      g.restore();
    }
  });
}

// Red oculus ring fascia with lettering (as in the original interior sketch)
export function oculusRing(path, y0, y1, text = 'MANCHESTER UNITED  ·  THE FLOWERS OF MANCHESTER  ·  ') {
  const W = 8192, H = 256;
  const tex = canvasTex(W, H, (g) => {
    g.fillStyle = '#b30d29'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.font = `700 ${H * 0.45}px Arial, sans-serif`; g.textBaseline = 'middle';
    let x = 20; while (x < W) { g.fillText(text, x, H / 2); x += g.measureText(text).width; }
    g.fillStyle = '#7fc9e8'; g.fillRect(0, H - 14, W, 14);
  });
  const geo = sweepProfile(path, [{ d: 0, y: y0 }, { d: 0, y: y1 }], { uRepeat: 1 });
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.4 }));
}

// Roof underside / membrane (annulus) between oculus path and envelope, following a section
function roofAnnulus(F, s0, s1, mat) {
  return new THREE.Mesh(paramSurface((u, v) => F(u * Math.PI * 2, s0 + (s1 - s0) * v), 240, 24), mat);
}

// ---------- extra textures ----------
function perfTex(base) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 8; y < h; y += 16) for (let x = (y / 16 % 2) * 8 + 4; x < w; x += 16) { g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); }
  }, { repeat: [6, 6] });
}
function sepalTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4f8f3c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${30 + Math.random() * 40},${90 + Math.random() * 60},30,0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = '#e4ddd0'; g.fillRect(w * 0.42, 0, w * 0.16, h);
    g.fillStyle = '#1f7a4a'; g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h);
  });
}
function ribbonTex(c, edge) {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = c; g.fillRect(0, 0, w, h);
    g.fillStyle = edge; g.fillRect(0, 0, w, h * 0.1); g.fillRect(0, h * 0.9, w, h * 0.1);
    g.fillStyle = 'rgba(255,255,255,0.18)'; for (let x = 0; x < w; x += 16) g.fillRect(x, h * 0.1, 3, h * 0.8);
  });
}
function roseWindowTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#f2f1ed'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c8102e'; g.lineWidth = 6;
    // scalloped petal arcs (radial u = around, v = inward)
    for (let r = 0; r < 4; r++) { g.beginPath(); g.ellipse(w / 2, r * h / 4 + h / 8, w * 0.48, h * 0.16, 0, 0, Math.PI * 2); g.stroke(); }
    g.strokeStyle = 'rgba(120,130,140,0.6)'; g.lineWidth = 2;
    for (let x = 0; x <= w; x += w / 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = 'rgba(140,200,236,0.35)'; g.fillRect(0, 0, w, 10);
  });
}

// ---------- public API ----------
export { OPTIONS, buildStadium } from './skins.js';
export const STADIUM_FOOTPRINT = { A, B, n: NE };
