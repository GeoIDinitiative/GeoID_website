// Old Trafford — existing ("before") and reimagined ("after": tiers 2 & 3 removed, ~35,000, re-roofed, living museum).
// Local frame: x = pitch long axis (Stretford End at -x, East Stand at +x), z = short axis (Sir Alex Ferguson Stand at -z).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTicker, BOARD_ADS, roundRectPath } from './bowl.js';
import { PAL, sePath, canvasTex, pitchTex, std, diagridTex, brickTex, tube, seatLettering } from './kit.js';

export const OT = { x: 0, z: 0, rot: 0.335 };

// stand parameters per compass side: depth D (from pitch edge) and back height H
const SIDES = { N: { D: 64, H: 50 }, E: { D: 58, H: 42 }, W: { D: 60, H: 43 }, S: { D: 32, H: 27 } };

function sideBlend(nx, nz) {
  // weights from outward normal direction -> N(-z) E(+x) W(-x) S(+z)
  const w = { N: Math.max(0, -nz), S: Math.max(0, nz), E: Math.max(0, nx), W: Math.max(0, -nx) };
  for (const k in w) w[k] = Math.pow(w[k], 3);
  const t = w.N + w.S + w.E + w.W || 1;
  let D = 0, H = 0; for (const k in w) { D += SIDES[k].D * w[k] / t; H += SIDES[k].H * w[k] / t; }
  return { D, H };
}

// sweep with a per-point profile function (all profiles same length)
function sweepVar(path, profFn, { uScale = 1, arcD = null, skip = null } = {}) {
  const N = path.pts.length, pos = [], uv = [], idx = [];
  let P = 0;
  // u by true arc length along the line at offset arcD, so text and aisles keep an even pitch round the corners
  const cum = [0]; if (arcD !== null) for (let i = 1; i <= N; i++) { const a = path.pts[i - 1], b = path.pts[i % N]; cum.push(cum[i - 1] + Math.hypot(b.x + b.nx * arcD - a.x - a.nx * arcD, b.z + b.nz * arcD - a.z - a.nz * arcD)); }
  const uAt = (i) => (arcD === null ? i / N : cum[i] / cum[N]);
  for (let i = 0; i <= N; i++) {
    const p = path.pts[i % N], prof = profFn(p); P = prof.length;
    prof.forEach(({ d, y }, k) => { pos.push(p.x + p.nx * d, y, p.z + p.nz * d); uv.push(uAt(i) * uScale, k / (P - 1)); });
  }
  for (let i = 0; i < N; i++) { for (let k = 0; k < P - 1; k++) { if (skip && skip(path.pts[i], path.pts[(i + 1) % N], k, i)) continue; const a = i * P + k, b = (i + 1) * P + k; idx.push(a, b, a + 1, b, b + 1, a + 1); } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

const seatTex = (rows) => canvasTex(64, 512, (g, w, h) => {
  g.fillStyle = '#c40f2c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < rows; i++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, i * h / rows, w, h / rows * 0.28); }
}, { repeat: [160, 1] });

function facadeTex({ museum = false } = {}) {
  return canvasTex(512, 512, (g, w, h) => {
    // top: grey cladding; middle: aqua glazing band (the OT windows); bottom: red brick
    g.fillStyle = '#9fa3a6'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, 0, 2, h * 0.55); }
    const gb0 = museum ? h * 0.2 : h * 0.45, gb1 = h * 0.68;
    const gr = g.createLinearGradient(0, gb0, 0, gb1); gr.addColorStop(0, '#6cc3b8'); gr.addColorStop(1, '#3e8f86');
    g.fillStyle = gr; g.fillRect(0, gb0, w, gb1 - gb0);
    g.strokeStyle = '#e6ecec'; g.lineWidth = 3;
    for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, gb0); g.lineTo(x, gb1); g.stroke(); }
    g.beginPath(); g.moveTo(0, (gb0 + gb1) / 2); g.lineTo(w, (gb0 + gb1) / 2); g.stroke();
    // brick base
    for (let r = 0; r < 40; r++) for (let c = 0; c < 32; c++) {
      g.fillStyle = `hsl(${9 + Math.random() * 7},${46 + Math.random() * 8}%,${27 + Math.random() * 7}%)`;
      g.fillRect(c * 16 + (r % 2) * 8, gb1 + r * 5, 15, 4);
    }
    if (museum) { g.fillStyle = '#c8102e'; g.fillRect(0, 0, w, h * 0.06); }
  }, { repeat: [40, 1] });
}

function fasciaTex(text, base = '#c8102e', fg = '#ffffff') {
  return canvasTex(8192, 128, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `700 ${h * 0.62}px Arial, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(text, w * 0.75, h / 2);
  });
}

export function buildOldTrafford(state = 'after') {
  const g = new THREE.Group(); g.name = 'oldTrafford';
  const P0 = sePath(58, 39, 9, 400);
  const before = state === 'before';

  // pitch
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(122, 84), std(0x2f6e2a)); surround.rotation.x = -Math.PI / 2; surround.position.y = 0.05; g.add(surround);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105 / 0.94, 68 / 0.9069), new THREE.MeshStandardMaterial({ map: pitchTex(), roughness: 0.9 }));   // painted lines exactly 105 x 68
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.1; g.add(pitch);

  const seat = new THREE.MeshStandardMaterial({ map: seatTex(30), roughness: 0.8, side: THREE.DoubleSide });
  const seatUpper = new THREE.MeshStandardMaterial({ map: seatTex(26), roughness: 0.8, side: THREE.DoubleSide });
  const grey = std(0x8d8a86, { side: THREE.DoubleSide });

  // Tier 1 (kept in both states)
  const t1 = (p) => { const { D } = sideBlend(p.nx, p.nz); const d1 = Math.min(30, D * 0.5); return [{ d: 1, y: 1.1 }, { d: d1, y: 1.1 + d1 * 0.42 }]; };
  if (before) g.add(new THREE.Mesh(sweepVar(P0, t1), seat));
  g.add(new THREE.Mesh(sweepVar(P0, () => [{ d: 0.8, y: 0 }, { d: 0.8, y: 1.2 }]), std(PAL.red, { side: THREE.DoubleSide })));

  const facade = new THREE.MeshStandardMaterial({ map: facadeTex({ museum: !before }), roughness: 0.75, side: THREE.DoubleSide });

  if (before) {
    // Tiers 2 & 3 grow with stand height; collapse to nothing on the single-tier South Stand
    const t2 = (p) => {
      const { D, H } = sideBlend(p.nx, p.nz); const k = Math.min(1, Math.max(0, (H - 28) / 12));
      const d0 = Math.min(30, D * 0.5) - 4, d1 = d0 + (D * 0.78 - d0) * k;
      const y0 = 1.1 + (d0 + 4) * 0.42 + 4; return [{ d: d0, y: y0 }, { d: d1, y: y0 + (d1 - d0) * 0.6 }];
    };
    const t3 = (p) => {
      const { D, H } = sideBlend(p.nx, p.nz); const k = Math.min(1, Math.max(0, (H - 44) / 5));
      const d0 = D * 0.72, d1 = d0 + (D * 0.98 - d0) * k; const y0 = H * 0.6;
      return [{ d: d0, y: y0 }, { d: d1, y: y0 + (d1 - d0) * 0.75 }];
    };
    g.add(new THREE.Mesh(sweepVar(P0, t2), seatUpper));
    g.add(new THREE.Mesh(sweepVar(P0, t3), seatUpper));
    // tier soffits / fascias
    g.add(new THREE.Mesh(sweepVar(P0, (p) => { const r = t2(p)[0]; return [{ d: r.d, y: r.y - 3 }, { d: r.d, y: r.y + 0.3 }]; }), std(0x3a3d40, { side: THREE.DoubleSide })));
    // outer facade
    g.add(new THREE.Mesh(sweepVar(P0, (p) => { const { D, H } = sideBlend(p.nx, p.nz); return [{ d: D, y: 0 }, { d: D, y: H }]; }), facade));
    // roof: cantilever, slightly falling to the front
    const roofMat = std(0xdfe1e2, { side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2 });
    g.add(new THREE.Mesh(sweepVar(P0, (p) => { const { D, H } = sideBlend(p.nx, p.nz); return [{ d: 3, y: H - 2 }, { d: D * 0.5, y: H + 0.5 }, { d: D + 1, y: H + 1 }]; }), roofMat));
    const fascia = new THREE.MeshStandardMaterial({ map: fasciaTex('MANCHESTER UNITED'), side: THREE.DoubleSide });
    g.add(new THREE.Mesh(sweepVar(P0, (p) => { const { H } = sideBlend(p.nx, p.nz); return [{ d: 3, y: H - 5.5 }, { d: 3, y: H - 1.5 }]; }), fascia));
    // the iconic cantilever trusses on the roof
    const truss = std(0xe9e9e9, { metalness: 0.4, roughness: 0.4 });
    for (let i = 0; i < P0.pts.length; i += 10) {
      const p = P0.pts[i]; const { D, H } = sideBlend(p.nx, p.nz);
      g.add(tube([[p.x + p.nx * 3, H - 1.5, p.z + p.nz * 3], [p.x + p.nx * D * 0.55, H + 6, p.z + p.nz * D * 0.55], [p.x + p.nx * (D + 1), H + 1, p.z + p.nz * (D + 1)]], 0.35, truss, 10));
    }
  } else {
    // AFTER: tiers 2 & 3 removed on every side -> one even tier all round (~35,000), styled on today's South Stand:
    // red seats under a dark roof soffit, the red "THE THEATRE OF DREAMS" fascia along the back of the tier,
    // white ribbed cladding broken by tall red-brick piers outside, and white steel lattice trusses on the roof.
    const D = 30, YB = 13.5, ROOF_F = 24, ROOF_B = 21, perim = (dd) => P0.length + 2 * Math.PI * dd;
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const wS = () => 1;                                                      // every stand takes the real South Stand's section: one even height and depth all round
    const isS = () => true;                                                   // every stand takes the South Stand's roof finish and truss grid
    const isG = () => true;                                                  // the concourse tube wraps the whole stadium
    const rF = (p) => ROOF_F + (19.6 - ROOF_F) * wS(p), rB = (p) => ROOF_B + (19.4 - ROOF_B) * wS(p), back = (p) => D + 2 + (49 - D - 2) * wS(p);
    const notS = (a, b) => isS(a) && isS(b), onlyS = (a, b) => !(isS(a) && isS(b));
    const Lmid = perim(D / 2), ROWS = 28, sdd = (D - 1) / ROWS, sdy = (YB - 1.1) / ROWS, R0 = 12, R1 = 17;
    const VOMS = [];
    { const cum = [0]; for (let i = 1; i <= P0.pts.length; i++) { const a = P0.pts[i - 1], b = P0.pts[i % P0.pts.length]; cum.push(cum[i - 1] + Math.hypot(b.x + b.nx * D / 2 - a.x - a.nx * D / 2, b.z + b.nz * D / 2 - a.z - a.nz * D / 2)); }
      const nA = Math.round(Lmid / 12);
      for (let k = 0; k < nA; k++) {
        const L = (k + 0.5) / nA * cum[cum.length - 1]; let i = 0; while (cum[i + 1] < L) i++;
        const f = (L - cum[i]) / (cum[i + 1] - cum[i]), a = P0.pts[i % P0.pts.length], b = P0.pts[(i + 1) % P0.pts.length];
        let nx = a.nx + (b.nx - a.nx) * f, nz = a.nz + (b.nz - a.nz) * f; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
        VOMS.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, nx, nz, k });
      } }
    const seatProf = []; for (let r = 0; r < ROWS; r++) { seatProf.push({ d: 1 + r * sdd, y: 1.1 + r * sdy }); seatProf.push({ d: 1 + r * sdd, y: 1.1 + (r + 1) * sdy }); } seatProf.push({ d: D, y: YB });
    let swI = 0; P0.pts.forEach((p, i) => { if (-p.x / 58 + p.z / 39 > -P0.pts[swI].x / 58 + P0.pts[swI].z / 39) swI = i; });
    const swP = P0.pts[swI], SLOT = { sx: swP.x + swP.nx, sz: swP.z + swP.nz, ux: swP.nx, uz: swP.nz, w: 5.6, rows: 8, depth: 8 * sdd };
    const inSlot = (qx, qz) => { const ax = qx - SLOT.sx, az = qz - SLOT.sz, al = ax * SLOT.ux + az * SLOT.uz; return al > -1.5 && al < SLOT.depth + 0.6 && Math.abs(ax * SLOT.uz - az * SLOT.ux) < SLOT.w / 2; };
    for (let i = VOMS.length - 1; i >= 0; i--) { const v = VOMS[i], ax = v.x - SLOT.sx, az = v.z - SLOT.sz; if (Math.abs(ax * SLOT.uz - az * SLOT.ux) < 8 && ax * SLOT.ux + az * SLOT.uz > -3) VOMS.splice(i, 1); }
    const segIn = (pa, pb, d) => inSlot((pa.x + pb.x) / 2 + (pa.nx + pb.nx) / 2 * d, (pa.z + pb.z) / 2 + (pa.nz + pb.nz) / 2 * d);
    const inVom = (pa, pb, k) => {
      if (k <= SLOT.rows * 2 && segIn(pa, pb, (seatProf[k].d + seatProf[k + 1].d) / 2)) return true;
      if (k < 2 * R0 || k > 2 * R1) return false;
      const d = (seatProf[k].d + seatProf[k + 1].d) / 2, qx = (pa.x + pb.x) / 2 + (pa.nx + pb.nx) / 2 * d, qz = (pa.z + pb.z) / 2 + (pa.nz + pb.nz) / 2 * d;
      return VOMS.some((v) => { const ax = qx - v.x, az = qz - v.z, al = ax * v.nx + az * v.nz - (1 + R0 * sdd); return al > -0.4 && al < (R1 - R0) * sdd + 0.4 && Math.abs(ax * v.nz - az * v.nx) < 1.4; });
    };
    g.add(new THREE.Mesh(sweepVar(P0, () => seatProf, { arcD: D / 2, skip: inVom }), new THREE.MeshStandardMaterial({ map: unitedSeats(Lmid), roughness: 0.8, side: THREE.DoubleSide })));
    g.add(new THREE.Mesh(sweepVar(P0, () => [{ d: 0.6, y: 0 }, { d: 0.6, y: 1.3 }], { skip: (a, b) => segIn(a, b, 0.6) }), std(PAL.red, { side: THREE.DoubleSide })));           // pitch-side wall
    {
      const brick = new THREE.MeshStandardMaterial({ map: gantryTex(), roughness: 0.9 }), black = std(0x111111), red = std(PAL.red, { roughness: 0.55, side: THREE.DoubleSide });
      const crest = (w) => { const t = new THREE.TextureLoader().load('assets/crest.png'); t.colorSpace = THREE.SRGBColorSpace; return new THREE.Mesh(new THREE.PlaneGeometry(w, w), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.05 })); };
      let len = 6; for (let t = 0; t < 40; t += 0.25) { const x = SLOT.sx - SLOT.ux * t, z = SLOT.sz - SLOT.uz * t; if (Math.abs(x) <= 54 && Math.abs(z) <= 35.5) { len = Math.max(2.5, t); break; } }
      const grp = new THREE.Group(); grp.position.set(SLOT.sx, 0, SLOT.sz); grp.rotation.y = -Math.atan2(SLOT.uz, SLOT.ux) + Math.PI / 2;   // local +z points into the stand
      const W = SLOT.w, D2 = SLOT.depth, rake = (z) => 1.1 + sdy + z * sdy / sdd;
      const flr = new THREE.Mesh(new THREE.PlaneGeometry(W, D2 + 1), std(0x2a2a2a)); flr.rotation.x = -Math.PI / 2; flr.position.set(0, 0.05, D2 / 2); grp.add(flr);
      for (const sx of [-1, 1]) {
        const sh2 = new THREE.Shape([new THREE.Vector2(-0.6, 0), new THREE.Vector2(D2 + 0.6, 0), new THREE.Vector2(D2 + 0.6, rake(D2 + 0.6) + 0.9), new THREE.Vector2(-0.6, rake(-0.6) + 0.9)]);
        const wall = new THREE.Mesh(new THREE.ExtrudeGeometry(sh2, { depth: 0.4, bevelEnabled: false }), brick); wall.rotation.y = -Math.PI / 2; wall.position.set(sx * (W / 2) + (sx > 0 ? 0.4 : 0), 0, 0); grp.add(wall);
      }
      const backW = new THREE.Mesh(new THREE.BoxGeometry(W, rake(D2) + 0.9, 0.4), black); backW.position.set(0, (rake(D2) + 0.9) / 2, D2 + 0.4); grp.add(backW);
      const tw = 4.4, th = 3.1, t = 0.18, sh = new THREE.Shape();
      sh.moveTo(-tw / 2, 0); sh.lineTo(-tw / 2, th - 0.6); sh.quadraticCurveTo(-tw / 2, th, -tw / 2 + 0.6, th); sh.lineTo(tw / 2 - 0.6, th); sh.quadraticCurveTo(tw / 2, th, tw / 2, th - 0.6); sh.lineTo(tw / 2, 0);
      sh.lineTo(tw / 2 - t, 0); sh.lineTo(tw / 2 - t, th - 0.6); sh.quadraticCurveTo(tw / 2 - t, th - t, tw / 2 - 0.6, th - t); sh.lineTo(-tw / 2 + 0.6, th - t); sh.quadraticCurveTo(-tw / 2 + t, th - t, -tw / 2 + t, th - 0.6); sh.lineTo(-tw / 2 + t, 0); sh.closePath();
      const runL = len + D2 + 0.2, tube = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: runL, bevelEnabled: false, curveSegments: 6 }), red); tube.position.set(0, 0.05, -len); grp.add(tube);
      for (let k = 0; k <= 12; k++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.12, 0.1, 0.12), std(0x9c0c22)); rib.position.set(0, th + 0.09, -len + k * runL / 12); grp.add(rib); }
      const arch = new THREE.Group(); arch.position.set(0, 0, -len - 0.1); grp.add(arch);
      for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.2, 0.5), red); post.position.set(sx * (tw / 2 + 0.35), 2.1, 0); arch.add(post); for (const y of [1.1, 2.4]) { const c = crest(0.55); c.position.set(sx * (tw / 2 + 0.35), y, -0.26); c.rotation.y = Math.PI; arch.add(c); } }
      const lt = canvasTex(1024, 159, (c) => { c.fillStyle = '#c8102e'; c.fillRect(0, 0, 1024, 128); c.fillStyle = '#fff'; c.font = '700 70px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('MANCHESTER UNITED', 512, 68); });
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(tw + 1.4, 0.9, 0.5), [red, red, red, red, new THREE.MeshBasicMaterial({ map: lt }), new THREE.MeshBasicMaterial({ map: lt })]); lintel.position.set(0, 3.75, 0); arch.add(lintel);
      g.add(grp);
    }
    const todTex = canvasTex(2048, 96, (c) => { c.fillStyle = '#a3112a'; c.fillRect(0, 0, 2048, 96); c.fillStyle = '#f4f2ee'; c.font = '700 64px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('THE THEATRE OF DREAMS', 1024, 52); c.fillStyle = '#f1c040'; c.fillRect(0, 0, 2048, 4); c.fillRect(0, 92, 2048, 4); }, { repeat: [1, 1] });
        const roomTex = canvasTex(512, 64, (c) => { for (let x = 0; x < 512; x += 64) { const gr = c.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#f3e6cc'); gr.addColorStop(1, '#a9845a'); c.fillStyle = gr; c.fillRect(x, 0, 64, 64);
      c.fillStyle = 'rgba(40,30,25,0.4)'; c.fillRect(x + 8, 40, 46, 8); c.fillRect(x + 18 + (x % 3) * 7, 22, 6, 18); c.fillStyle = '#2a2c30'; c.fillRect(x, 0, 5, 64); } });
    const vipGlass = canvasTex(256, 64, (c) => { c.fillStyle = 'rgba(95,184,173,0.55)'; c.fillRect(0, 0, 256, 64); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, 0, 256, 8);
      c.fillStyle = 'rgba(235,242,242,0.95)'; for (let x = 0; x < 256; x += 32) c.fillRect(x, 0, 3, 64); c.fillRect(0, 0, 256, 3); c.fillRect(0, 61, 256, 3); });
    const vipReps = Math.round(perim(D) / 32);
    const rooms = new THREE.Mesh(sweepVar(P0, () => [{ d: D + 0.6, y: YB }, { d: D + 0.6, y: YB + 2.6 }], { uScale: vipReps, arcD: D }), new THREE.MeshStandardMaterial({ map: roomTex, emissiveMap: roomTex, emissive: 0xffffff, emissiveIntensity: 0.2, side: THREE.DoubleSide }));
    rooms.material.userData.nightGlow = true; g.add(rooms);
    const vg = new THREE.Mesh(sweepVar(P0, () => [{ d: D - 0.05, y: YB }, { d: D - 0.05, y: YB + 2.6 }], { uScale: vipReps * 2, arcD: D }), new THREE.MeshPhysicalMaterial({ map: vipGlass, transparent: true, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    vg.renderOrder = 3; g.add(vg);
    g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: D + 0.7, y: YB + 2.6 }, { d: D + 0.7, y: rF(p) - 2.4 }]), std(0x2b2d31, { side: THREE.DoubleSide })));     // rear wall to the roof, above the VIP boxes
    g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: D, y: YB }, { d: back(p) - 1, y: YB }]), std(0x8d8a86, { side: THREE.DoubleSide })));   // concourse deck behind the seats
    // outer façade: white ribbed cladding, tall brick piers every 24 m, brick plinth
    g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: back(p) - 1, y: 0 }, { d: back(p) - 1, y: rB(p) }], { uScale: Math.round(perim(D + 1) / 24) }), new THREE.MeshStandardMaterial({ map: southStandTex(), roughness: 0.75, side: THREE.DoubleSide })));
    // stand names on the outside, in club red: MANCHESTER UNITED across the East Stand, the three named stands
    const sign = (text, w, h, x, y, z, ry) => {
      const W = 2048, H = Math.round(W * h / w), tex = canvasTex(W, H, (c) => { c.clearRect(0, 0, W, H); c.fillStyle = '#da291c'; c.font = `900 ${H * 0.86}px "Archivo Black", "Arial Black", Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
        const k = Math.min(1, W * 0.98 / c.measureText(text).width); c.save(); c.translate(W / 2, H * 0.54); c.scale(k, k); c.fillText(text, 0, 0); c.restore(); });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25 }));
      m.material.name = 'brand'; m.position.set(x, y, z); m.rotation.y = ry; g.add(m);
    };
    const fx = 58 + 48 + 0.4, fz = 39 + 48 + 0.4;
    // all on the shell above the red tube that wraps the stadium
    sign('MANCHESTER UNITED', 58, 3.6, fx + 5.2, 17.2, 0, Math.PI / 2);
    sign('SIR ALEX FERGUSON STAND', 80, 3.2, 0, 17.2, -fz - 5.2, Math.PI);
    sign('SIR BOBBY CHARLTON STAND', 80, 3.2, 0, 17.2, fz + 5.2, 0);
    sign('STRETFORD END', 46, 3.4, -fx - 5.2, 17.2, 0, -Math.PI / 2);
    // goals on the goal lines
    const goalMat = std(0xffffff), net = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 });
    for (const sx of [-1, 1]) {
      const gp = new THREE.Group();
      for (const zz of [-3.66, 3.66]) { const po = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44), goalMat); po.position.set(0, 1.22, zz); gp.add(po); }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32), goalMat); bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; gp.add(bar);
      const nt = new THREE.Mesh(new THREE.BoxGeometry(2, 2.44, 7.32, 4, 6, 14), net); nt.position.set(sx, 1.22, 0); gp.add(nt);
      gp.position.set(sx * 52.5, 0.1, 0); g.add(gp);
    }
    // animated pitch-side LED boards on a rounded rectangle, with a gap where the tunnel comes out
    {
      const bp = roundRectPath(55, 36.5, 6), tk = makeTicker(BOARD_ADS, 96, 0.9, bp.length, { speed: 5 });
      const N = bp.pts.length, pos = [], uv = [], idx = []; let acc = 0;
      for (let i = 0; i <= N; i++) { const q = bp.pts[i % N], r = bp.pts[(i + N - 1) % N]; if (i) acc += Math.hypot(q.x - r.x, q.z - r.z); pos.push(q.x, 0.1, q.z, q.x, 1.0, q.z); uv.push(acc / bp.length, 0, acc / bp.length, 1); }
      for (let i = 0; i < N; i++) { const q = bp.pts[i]; if (inSlot(q.x, q.z) || Math.hypot(q.x - SLOT.sx, q.z - SLOT.sz) < 9) continue; const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      const boards = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tk.tex, side: THREE.DoubleSide, toneMapped: false })); boards.name = 'ledBoards'; g.add(boards);
      g.userData.animate = (t) => tk.animate(t);
    }
    // floodlights along the underside of the roof's front edge, evenly spaced, aimed at the pitch
    {
      // mounted flush under the roof, 1.5 m in from its front edge, on the same plan line as the roof
      const ry = (p, d) => rF(p) + (rB(p) - rF(p)) * (d + 2) / (back(p) + 2);
      const lp = sePath(58 - 0.5, 39 - 0.5, 9, 720), n = Math.round(lp.length / 5), dIn = -0.5;
      const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.3, 0.9), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0.4 }), n);
      lamp.material.userData.lampHead = true; const o = new THREE.Object3D();
      for (let i = 0; i < n; i++) { const q = lp.pts[Math.floor(i / n * lp.pts.length)]; const yU = ry(q, dIn) - 0.12; o.position.set(q.x, yU - 0.15, q.z); o.lookAt(0, -40, 0); o.rotateX(-Math.PI / 2); o.updateMatrix(); lamp.setMatrixAt(i, o.matrix); }
      lamp.name = 'otFloodRing'; g.add(lamp);
      g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: -1.0, y: ry(p, -1.0) - 0.02 }, { d: -1.0, y: ry(p, -1.0) - 0.45 }, { d: 0.0, y: ry(p, 0) - 0.45 }, { d: 0.0, y: ry(p, 0) - 0.02 }]), std(0x2b2d31, { side: THREE.DoubleSide })));   // lighting gantry beam
    }
    // roof: grey sheeting on top, dark soffit underneath, translucent leading edge
    const glassGrid = canvasTex(256, 256, (c) => { c.fillStyle = 'rgba(200,222,226,0.38)'; c.fillRect(0, 0, 256, 256); c.fillStyle = 'rgba(245,247,248,0.95)'; c.fillRect(0, 0, 256, 10); c.fillRect(0, 0, 8, 256); c.fillRect(124, 0, 4, 256); });
    const roofY = (d) => ROOF_F + (ROOF_B - ROOF_F) * (d + 2) / (D + 4), ry = (p, d) => rF(p) + (rB(p) - rF(p)) * (d + 2) / (back(p) + 2);
    const glass = new THREE.Mesh(sweepVar(P0, (p) => [{ d: -2, y: rF(p) }, { d: back(p) - 6, y: ry(p, back(p) - 6) }], { uScale: Math.round(perim(D / 2) / 6), arcD: D / 2, skip: notS }),
      new THREE.MeshPhysicalMaterial({ map: glassGrid, transparent: true, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    glass.material.map.repeat.y = 4; glass.renderOrder = 2; g.add(glass);
    const sheet = new THREE.MeshStandardMaterial({ map: roofSheet(), roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: back(p) - 6, y: ry(p, back(p) - 6) }, { d: back(p), y: rB(p) }], { uScale: 120, skip: notS }), sheet));      // solid strip at the back edge
    // South Stand roof as it is today: grey cladding panels with two lighter bands, a lattice grid of trusses, a gantry along the back
    const sTex = canvasTex(64, 512, (c) => { c.fillStyle = '#6f7478'; c.fillRect(0, 0, 64, 512); c.fillStyle = '#b9bdc0'; c.fillRect(0, 150, 64, 46); c.fillRect(0, 330, 64, 46);
      c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < 512; y += 16) c.fillRect(0, y, 64, 2); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(0, 0, 3, 512); });
    g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: 14, y: ry(p, 14) }, { d: back(p), y: rB(p) }], { uScale: Math.round(perim(D) / 6), arcD: D, skip: onlyS }), new THREE.MeshStandardMaterial({ map: sTex, roughness: 0.6, metalness: 0.25, side: THREE.DoubleSide })));
    const frontGlass = new THREE.Mesh(sweepVar(P0, (p) => [{ d: -2, y: rF(p) }, { d: 14, y: ry(p, 14) }], { uScale: Math.round(perim(6) / 6), arcD: 6, skip: onlyS }),
      new THREE.MeshPhysicalMaterial({ map: glassGrid, transparent: true, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));    // translucent leading 16 m over the seats
    frontGlass.material.map.repeat.y = 2; frontGlass.renderOrder = 2; g.add(frontGlass);
    for (const dL of [4, 16, 28, 40]) g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: Math.min(dL, back(p) - 1), y: ry(p, Math.min(dL, back(p) - 1)) }, { d: Math.min(dL, back(p) - 1), y: ry(p, Math.min(dL, back(p) - 1)) + 1.6 }], { skip: onlyS, arcD: dL, uScale: Math.round(perim(dL) / 6) }), new THREE.MeshStandardMaterial({ map: latticeTex(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })));   // one even 6 m bay per tile
    g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: back(p) - 1, y: 7 }, { d: back(p) + 5, y: 7 }, { d: back(p) + 5, y: 15 }, { d: back(p) - 1, y: 15 }, { d: back(p) - 1, y: 7 }], { uScale: Math.round(perim(52) / 10), skip: (a, b) => !(isG(a) && isG(b)) }), new THREE.MeshStandardMaterial({ map: tubeTex(), roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide })));
    const fascia = new THREE.MeshStandardMaterial({ map: fasciaTex('', '#f2f2f2', '#c8102e'), side: THREE.DoubleSide });
    g.add(new THREE.Mesh(sweepVar(P0, (p) => [{ d: -2, y: rF(p) - 1.6 }, { d: -2, y: rF(p) + 0.2 }]), fascia));
    {
      const dd = sdd, dy = sdy, r0 = R0, r1 = R1;
      const pos = [], wpos = [], fpos = [], fuv = [], hpos = [], huv = [], quad = (arr, a, b, c, d) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);
      const stand = (v) => (v.nz > Math.abs(v.nx) ? 'S' : -v.nz > Math.abs(v.nx) ? 'N' : v.nx > 0 ? 'E' : 'W');
      const codes = [];
      for (const v of VOMS) {
        const p = v, tx = -p.nz, tz = p.nx, q = (d, w, y) => [p.x + p.nx * d + tx * w, y, p.z + p.nz * d + tz * w];
        const d0 = 1 + r0 * dd, d1 = 1 + r1 * dd, y0 = 1.1 + r0 * dy + 0.02, y1 = 1.1 + r1 * dy + 0.05, W2 = 1.3, yF = y0 - 2.6;
        quad(fpos, q(d0, -W2, y0), q(d0, W2, y0), q(d1, W2, yF), q(d1, -W2, yF)); fuv.push(0, 0, 1, 0, 1, 7, 0, 0, 1, 7, 0, 7);   // stepped walkway down into the concourse
        quad(pos, q(d1, -W2, yF), q(d1, W2, yF), q(d1, W2, y1), q(d1, -W2, y1));                                                 // dark portal
        quad(pos, q(d0, -W2, yF - 0.1), q(d1, -W2, yF - 0.1), q(d1, W2, yF - 0.1), q(d0, W2, yF - 0.1));
        for (const w of [-W2, W2]) quad(wpos, q(d0, w, yF), q(d1, w, yF), q(d1, w, y1 + 1), q(d0, w, y0 + 1));
        quad(wpos, q(d0 - 0.05, -W2, y0 - 0.2), q(d0 - 0.05, W2, y0 - 0.2), q(d0 - 0.05, W2, y0 + 1), q(d0 - 0.05, -W2, y0 + 1));    // front parapet
        const c = codes.length, cu = (c % 16) / 16, cv = 1 - (Math.floor(c / 16) + 1) / 8; codes.push(stand(v) + String(v.k + 1).padStart(2, '0'));
        quad(hpos, q(d1 + 0.05, -W2, y1 + 0.1), q(d1 + 0.05, W2, y1 + 0.1), q(d1 + 0.05, W2, y1 + 0.1 + W2), q(d1 + 0.05, -W2, y1 + 0.1 + W2));
        huv.push(cu, cv, cu + 1 / 16, cv, cu + 1 / 16, cv + 1 / 8, cu, cv, cu + 1 / 16, cv + 1 / 8, cu, cv + 1 / 8);
      }
      const mk = (arr, mat, uvs) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); if (uvs) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, mat)); };
      const stepTex = canvasTex(64, 64, (c) => { c.fillStyle = '#b9b5ae'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#f1c040'; c.fillRect(0, 0, 64, 5); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 5, 64, 3); });
      const atlas = canvasTex(2048, 512, (c) => codes.forEach((t, i) => { const x = (i % 16) * 128, y = Math.floor(i / 16) * 64; c.fillStyle = '#c8102e'; c.fillRect(x, y, 128, 64); c.fillStyle = '#fff'; c.font = '700 30px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, x + 64, y + 34); c.fillStyle = '#f1c040'; c.fillRect(x, y + 58, 128, 6); }));
      mk(fpos, new THREE.MeshStandardMaterial({ map: stepTex, side: THREE.DoubleSide }), fuv); mk(hpos, new THREE.MeshStandardMaterial({ map: atlas, side: THREE.DoubleSide }), huv);
      mk(pos, std(0x0b0b0b, { side: THREE.DoubleSide })); mk(wpos, std(0xf2f2f2, { side: THREE.DoubleSide }));
    }
    g.add(seatLettering({ text: 'UNITED', R: 39, d0: 1, y0: 1.1, d1: D, y1: YB, rows: 28, frac: 0.5, width: 96, height: 19 }));
    g.add(seatLettering({ img: 'assets/adidas_white.png', R: 58, d0: 1, y0: 1.1, d1: D, y1: YB, rows: 28, frac: 0.5, width: 34, height: 19, rotY: -Math.PI / 2 }));
    const nameTex = canvasTex(2048, 64, (c) => { c.clearRect(0, 0, 2048, 64); c.fillStyle = '#c8102e'; c.font = '900 50px "Arial Black", Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('MANCHESTER UNITED FOOTBALL CLUB', 1024, 34); });
    const name = new THREE.Mesh(new THREE.PlaneGeometry(80, 2.5), new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, alphaTest: 0.3 }));
    name.position.set(0, 19.6 - 0.7, -(39 - 2) + 0.15); g.add(name);
    // slim white rafters over the roof sheeting (no lattice), one every ~12 m
    const parts = [], seg = (a, b, r) => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), L = A.distanceTo(Bv); const c = new THREE.CylinderGeometry(r, r, L, 6); c.translate(0, L / 2, 0);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize())); c.translate(A.x, A.y, A.z); parts.push(c); };
    for (let i = 0; i < P0.pts.length; i += isS(P0.pts[i]) ? 4 : 8) { const p = P0.pts[i], at = (d, y) => [p.x + p.nx * d, y, p.z + p.nz * d], s2 = isS(p);
      seg(at(back(p), rB(p) + 0.35), at(-2, rF(p) + 0.35), s2 ? 0.18 : 0.22);
      if (!s2) { const n = 6, top = (t) => at(back(p) + (-2 - back(p)) * t, rB(p) + 6.5 + (rF(p) + 1.4 - rB(p) - 6.5) * t), bot = (t) => at(back(p) + (-2 - back(p)) * t, rB(p) + 0.35 + (rF(p) - rB(p)) * t);
        seg(top(0), top(1), 0.26); for (let k = 0; k <= n; k++) { seg(bot(k / n), top(k / n), 0.11); if (k < n) seg(bot(k / n), top((k + 1) / n), 0.09); } }
      if (s2) {   // tapered truss: deep at the back, closing to a tip at the roof opening
        const H = 5.5, top = (d) => [...at(d, ry(p, d) + 0.35 + H * (d + 2) / (back(p) + 2))].slice(0, 3), bot = (d) => at(d, ry(p, d) + 0.35);
        seg(top(back(p)), top(-2), 0.14); seg(bot(back(p)), top(back(p)), 0.14);
        for (let d = back(p) - 6; d > -2; d -= 6) { seg(bot(d), top(d), 0.08); seg(bot(d), top(d + 6), 0.07); }
      }
    }
    {
      const tun = new THREE.Group(), legM = std(0x9aa0a6);
      P0.pts.forEach((p, i) => { if (i % 3 || !isG(p)) return; const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7, 0.7), legM); leg.position.set(p.x + p.nx * (back(p) + 4), 3.5, p.z + p.nz * (back(p) + 4)); tun.add(leg); });
      
      g.add(tun);
    }
    const trussMesh = new THREE.Mesh(mergeGeometries(parts), std(0xf2f2f2, { metalness: 0.4, roughness: 0.4 })); trussMesh.castShadow = true; g.add(trussMesh);
  }

  // Holy Trinity statue (East Stand forecourt) and Munich memorial (SE corner)
  g.add(trinityStatue(SIDES.E.D + 70, 0, Math.PI / 2));
  const mun = new THREE.Group();
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.6), std(0x3a3a3a)); plaque.position.y = 2; mun.add(plaque);
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.3, 24), std(0xf1f1f1)); clock.rotation.x = Math.PI / 2; clock.position.set(0, 5.2, 0); mun.add(clock);
  mun.position.set(58 + 20, 0, 39 + 12); mun.rotation.y = -Math.PI / 4; g.add(mun);
  return g;
}

function unitedSeats(L = 480) {
  // red seats with grey aisles exactly every ~12 m
  const W = 8192, H = 512, rows = 28, pxU = W / L, nA = Math.round(L / 12);
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#c40f2c'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < rows; i++) { g.fillStyle = 'rgba(0,0,0,0.33)'; g.fillRect(0, i * H / rows, W, H / rows * 0.28); }
    g.fillStyle = '#7d7a76'; for (let k = 0; k < nA; k++) g.fillRect(Math.round((k + 0.5) / nA * W - pxU), 0, Math.round(2 * pxU), H);
  });
}
function latticeTex() {
  return canvasTex(256, 32, (c) => { c.strokeStyle = '#f2f2f2'; c.lineWidth = 3; c.strokeRect(1, 1, 254, 30); for (let x = 0; x < 256; x += 32) { c.beginPath(); c.moveTo(x, 30); c.lineTo(x + 16, 2); c.lineTo(x + 32, 30); c.stroke(); } }, { repeat: [1, 1] });
}
function tubeTex() {
  return canvasTex(128, 64, (c) => { c.fillStyle = '#7a0b1c'; c.fillRect(0, 0, 128, 64); c.fillStyle = 'rgba(0,0,0,0.22)'; for (let x = 0; x < 128; x += 32) c.fillRect(x, 0, 2, 64); c.fillRect(0, 31, 128, 2);
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 0, 128, 4); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 60, 128, 4); });
}
function gantryTex() {
  return canvasTex(128, 64, (c) => {
    for (let r = 0; r < 16; r++) for (let k = 0; k < 8; k++) { c.fillStyle = `hsl(${9 + Math.random() * 7},${46 + Math.random() * 8}%,${27 + Math.random() * 8}%)`; c.fillRect(k * 16 + (r % 2) * 8, r * 4, 15, 3); }
    c.fillStyle = '#5a2a20'; c.fillRect(0, 0, 128, 3); c.fillRect(0, 61, 128, 3);
  });
}
function southStandTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e4e7e9'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h * 0.8; y += 10) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, y, w, 3); }          // horizontal ribbed cladding
    g.fillStyle = 'rgba(40,50,60,0.55)'; for (let x = 140; x < w - 40; x += 120) g.fillRect(x, h * 0.35, 60, h * 0.12); // a few dark windows
    const brick = (x0, y0, ww, hh) => { for (let r = 0; r * 6 < hh; r++) for (let c = 0; c * 16 < ww; c++) { g.fillStyle = `hsl(${9 + Math.random() * 7},${46 + Math.random() * 8}%,${26 + Math.random() * 8}%)`; g.fillRect(x0 + c * 16 + (r % 2) * 8, y0 + r * 6, 15, 5); } };
    brick(0, 0, 64, h);                                    // tall brick pier
    brick(0, h * 0.82, w, h * 0.18);                       // brick plinth
    g.fillStyle = '#c8102e'; g.fillRect(64, h * 0.8, w - 64, 6);
  }, { repeat: [1, 1] });
}
function nineties() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e9ebec'; g.fillRect(0, 0, w, h);                                   // white upper cladding
    for (let x = 0; x < w; x += 6) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, 0, 2, h * 0.45); }
    g.fillStyle = '#c8102e'; g.fillRect(0, h * 0.04, w, h * 0.05);                     // red band under the roof
    g.fillStyle = '#9da2a6'; g.fillRect(0, h * 0.45, w, h * 0.27);                     // grey cladding
    const gr = g.createLinearGradient(0, h * 0.5, 0, h * 0.64); gr.addColorStop(0, '#6cc3b8'); gr.addColorStop(1, '#3e8f86');
    g.fillStyle = gr; for (let x = 8; x < w; x += 64) g.fillRect(x, h * 0.5, 48, h * 0.14); // aqua windows
    for (let r = 0; r < 26; r++) for (let c = 0; c < 32; c++) {                         // red-brick plinth
      g.fillStyle = `hsl(${9 + Math.random() * 7},${46 + Math.random() * 8}%,${27 + Math.random() * 7}%)`;
      g.fillRect(c * 16 + (r % 2) * 8, h * 0.72 + r * 5.5, 15, 4.5);
    }
  }, { repeat: [40, 1] });
}
function roofSheet() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a9aeb2'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 4, 0, 2, h); }
    g.fillStyle = 'rgba(230,240,240,0.6)'; for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 16, h);   // rooflights
  }, { repeat: [1, 1] });
}
function terraceTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6f9a52'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(40,${80 + Math.random() * 60},30,0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    g.fillStyle = '#d9d2c4'; g.fillRect(0, h * 0.4, w, h * 0.2);
    g.fillStyle = 'rgba(120,200,190,0.9)'; for (let x = 10; x < w; x += 64) g.fillRect(x, h * 0.42, 30, h * 0.16);
  }, { repeat: [60, 1] });
}

// Simple bronze figure group on a plinth (three figures, arms linked)
export function trinityStatue(x, z, rot = 0, n = 3) {
  const g = new THREE.Group();
  const bronze = std(0x6b4a2b, { metalness: 0.7, roughness: 0.4 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 3), std(0xcfcac2)); plinth.position.y = 1.2; g.add(plinth);
  for (let i = 0; i < n; i++) {
    const f = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.6, 4, 8), bronze); body.position.y = 1.4; f.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), bronze); head.position.y = 2.6; f.add(head);
    f.position.set((i - (n - 1) / 2) * 1.5, 2.4, 0); f.scale.setScalar(1.25); g.add(f);
  }
  g.position.set(x, 0, z); g.rotation.y = rot; return g;
}
