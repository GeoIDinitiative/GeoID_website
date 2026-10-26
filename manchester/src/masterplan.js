// The Sir Matt Busby Complex — 3D build of the layout in data/plan.json (made by tools/plan_layout.py).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL, canvasTex, flatPoly, ribbon, std, rng, pitchTex, facadeTex, pavingTex, tube } from './kit.js';
import { trees } from './context.js';

export const STADIUM_POS = { x: -790, z: -290, rot: -0.044 };
export const KEEP_FREIGHT = [[-960, 178], [-250, 138], [-470, 335], [-690, 450], [-905, 340]];

// wall geometry with metre-scaled UVs (one texture tile = 28 m × 19.2 m = 6 floors)
function wallGeo(poly, h, y0 = 0) {
  let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  if (a > 0) poly = [...poly].reverse();
  const pos = [], uv = [], idx = []; let acc = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length], L = Math.hypot(x2 - x1, z2 - z1), b = pos.length / 3;
    pos.push(x1, y0, z1, x2, y0, z2, x2, y0 + h, z2, x1, y0 + h, z1);
    uv.push(acc / 28, 0, (acc + L) / 28, 0, (acc + L) / 28, h / 19.2, acc / 28, h / 19.2);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3); acc += L;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g.toNonIndexed();
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);
const ring = (p) => (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1] ? p.slice(0, -1) : p);

function mats() {
  const night = (m) => { m.userData.nightGlow = true; return m; };
  const f = (o) => night(new THREE.MeshStandardMaterial({ map: facadeTex(o), roughness: 0.8 }));
  return {
    res_brick: f({ wall: '#a8553f', glass: '#2f4652', balcony: '#d8d8d8', floors: 6, bays: 8 }),
    res_red: f({ wall: '#8e3b2e', glass: '#31495a', balcony: '#e8e2d8', floors: 6, bays: 7 }),
    res_light: f({ wall: '#e4ddd2', glass: '#3c5562', balcony: '#f6f6f6', floors: 6, bays: 8 }),
    res_dark: f({ wall: '#4d5155', glass: '#6aa9b6', balcony: '#bfc4c8', floors: 6, bays: 10 }),
    retail: f({ wall: '#cfd6da', glass: '#5fb8ad', floors: 3, bays: 14 }),
    leisure: night(new THREE.MeshStandardMaterial({ map: leisureTex(), roughness: 0.45, metalness: 0.2 })),
    pavilion: f({ wall: '#f2f2f2', glass: '#89c9c2', floors: 1, bays: 6 }),
    hotel: f({ wall: '#2d3338', glass: '#7fc4c9', floors: 6, bays: 12 }),
    office: f({ wall: '#9aa6ad', glass: '#3f6c80', floors: 6, bays: 12 }),
    parking: new THREE.MeshStandardMaterial({ map: parkingTex(), roughness: 0.9 }),
    media: f({ wall: '#3b3f44', glass: '#c8102e', floors: 4, bays: 6 }),
    foundation: f({ wall: '#c8102e', glass: '#f4f2ee', floors: 6, bays: 10 }),
    utility: std(0x6c7075, { roughness: 0.8 }),
    station: night(new THREE.MeshStandardMaterial({ map: facadeTex({ wall: '#e8ecee', glass: '#5fb8ad', floors: 2, bays: 16 }), roughness: 0.25, metalness: 0.3 })),
    roofGreen: std(0x8fa877, { roughness: 0.95 }), roofGrey: std(0xb9b6b0, { roughness: 0.9 }), roofSolar: new THREE.MeshStandardMaterial({ map: solarTex(), roughness: 0.4, metalness: 0.4 }),
  };
}
function leisureTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#1e2126'; g.fillRect(0, 0, w, h);
    for (let f = 0; f < 4; f++) {
      const y = f * h / 4;
      const gr = g.createLinearGradient(0, y, 0, y + h / 4); gr.addColorStop(0, '#f5d9a6'); gr.addColorStop(1, '#b07a45');
      g.fillStyle = gr; g.fillRect(0, y + 16, w, h / 4 - 30);
      g.fillStyle = 'rgba(0,0,0,0.35)'; for (let x = 0; x < w; x += 64) g.fillRect(x, y + 16, 4, h / 4 - 30);
      g.fillStyle = ['#c8102e', '#8cc8ec', '#169b62', '#f1c040'][f]; g.fillRect(0, y + 4, w, 10);
    }
  });
}
function parkingTex() { return canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#8a8e92'; g.fillRect(0, 0, w, h); g.fillStyle = '#2b2f33'; for (let y = 0; y < h; y += 64) g.fillRect(0, y + 20, w, 24); g.fillStyle = '#5c9a48'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 14, 12); }); }
function solarTex() { return canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#9da3a8'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f2f4a'; for (let y = 4; y < h; y += 16) for (let x = 4; x < w; x += 20) g.fillRect(x, y, 16, 12); }); }
function lawnTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6b8d4c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = Math.random(); g.fillStyle = `rgba(${60 + v * 50},${95 + v * 55},${40 + v * 25},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  });
}
function roadTexture() {
  return canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#4a4c50'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = '#f0ece0'; g.fillRect(4, 0, 3, h); g.fillRect(w - 7, 0, 3, h);
    for (let y = 0; y < h; y += 64) g.fillRect(w / 2 - 2, y, 4, 30);
  });
}
function fanWalkTex() {
  // pedestrian street: pale granite setts with darker stone bands and a drainage channel down each side
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#bdb6aa'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16 % 2) * 12; x < w; x += 24) { const v = 170 + Math.random() * 30; g.fillStyle = `rgb(${v},${v - 6},${v - 14})`; g.fillRect(x + 1, y + 1, 22, 14); }
    g.fillStyle = '#7d7871'; g.fillRect(0, 0, 14, h); g.fillRect(w - 14, 0, 14, h);
    g.fillStyle = '#8f8a82'; for (let y = 0; y < h; y += 128) g.fillRect(14, y, w - 28, 10);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(14, 0, 3, h); g.fillRect(w - 17, 0, 3, h);
  });
}
// club crest inlaid in the arrival square, ringed with the club's name
function crestPlazaTex() {
  const tex = canvasTex(1024, 1024, (g, w) => drawCrestPlaza(g, w, null));
  const img = new Image(); img.src = 'assets/crest.png'; img.onload = () => { drawCrestPlaza(tex.image.getContext('2d'), 1024, img); tex.needsUpdate = true; };
  return tex;
}
function drawCrestPlaza(g, w, img) {
  const c = w / 2; g.fillStyle = '#cfc8bc'; g.fillRect(0, 0, w, w);
  g.fillStyle = '#e8e2d8'; g.beginPath(); g.arc(c, c, w * 0.49, 0, 7); g.fill();
  g.strokeStyle = '#c8102e'; g.lineWidth = 14; g.beginPath(); g.arc(c, c, w * 0.47, 0, 7); g.stroke();
  g.save(); g.translate(c, c); g.fillStyle = '#2a2a2a'; g.font = `900 ${w * 0.045}px "Arial Black", Arial`; g.textAlign = 'center';
  const ch = [...'MANCHESTER UNITED  ·  THE FLOWERS OF MANCHESTER  ·  '];
  ch.forEach((x, i) => { g.save(); g.rotate(i / ch.length * Math.PI * 2); g.fillText(x, 0, -w * 0.405); g.restore(); }); g.restore();
  if (img) { const s = w * 0.66 / img.height; g.drawImage(img, c - img.width * s / 2, c - img.height * s / 2, img.width * s, img.height * s); }
}

// ---------------- street furniture ----------------
export function alongLine(line, spacing, offset = 0) {
  const out = []; let carry = spacing / 2;
  for (let i = 0; i < line.length - 1; i++) {
    const [x1, z1] = line[i], [x2, z2] = line[i + 1], L = Math.hypot(x2 - x1, z2 - z1); if (!L) continue;
    const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
    let s = carry; for (; s < L; s += spacing) out.push([x1 + tx * s - tz * offset, z1 + tz * s + tx * offset, Math.atan2(tz, tx)]);
    carry = s - L;
  }
  return out;
}
function streetLights(pts) {
  const g = new THREE.Group(); g.name = 'streetlights'; if (!pts.length) return g;
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 9, 6), std(0x2b2d30, { metalness: 0.6 }), pts.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.25, 0.5), new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b8, emissiveIntensity: 0.4 }), pts.length);
  head.material.userData.lampHead = true;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  pts.forEach(([x, z, a = 0], i) => {
    M.compose(new THREE.Vector3(x, 4.5, z), q.identity(), one); pole.setMatrixAt(i, M);
    M.compose(new THREE.Vector3(x, 9, z), q.setFromAxisAngle(Y, -a), one); head.setMatrixAt(i, M);
  });
  pole.castShadow = true; g.add(pole, head); return g;
}

// Trinity Light: three beams — white, blue, green — for Charlton, Law and Best
function trinityLight(x, z) {
  const g = new THREE.Group(); g.name = 'trinityLight';
  // soft beams: widen and fade with altitude, so they read as light in haze rather than solid rods
  const grad = canvasTex(4, 256, (c) => { const gr = c.createLinearGradient(0, 256, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.08, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 4, 256); });
  const beams = new THREE.Group(); beams.name = 'beams'; g.add(beams);
  const RED = new THREE.Color(0xc8102e), cols = [], mats = [];
  [[0xffffff, -4, 0.035], [0x4f9dff, 0, 0], [0x2fd27a, 4, -0.035]].forEach(([col, dx, tilt]) => {
    const pivot = new THREE.Group(); pivot.position.set(dx, 1.5, 0); pivot.rotation.z = tilt; beams.add(pivot);
    for (const [rTop, op] of [[9, 0.35], [30, 0.12]]) {          // a bright core inside a wide, faint halo
      const m = new THREE.MeshBasicMaterial({ color: col, map: grad, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(rTop, 1.1, 1600, 24, 1, true), m); beam.position.y = 800; beam.castShadow = false; beam.receiveShadow = false; beam.userData.noShadow = true;
      pivot.add(beam); mats.push(m); cols.push(new THREE.Color(col));
    }
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 1.2, 20), new THREE.MeshBasicMaterial({ color: col })); lamp.position.set(dx, 1.4, 0); lamp.userData.noShadow = true; g.add(lamp); mats.push(lamp.material); cols.push(new THREE.Color(col));
  });
  // slow cycle: Charlton white, Law blue, Best green fade to United red and back (about 16 s round trip)
  g.userData.animate = (t) => { const k = 0.5 - 0.5 * Math.cos(t * Math.PI * 2 / 16); mats.forEach((m, i) => m.color.copy(cols[i]).lerp(RED, k)); };
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 0.8, 3), std(0x2b2b2b)); plinth.position.y = 0.4; g.add(plinth);
  // 1968 European Cup crest on a low stone
  const ecf = new THREE.TextureLoader().load('assets/ecf1968.png'); ecf.colorSpace = THREE.SRGBColorSpace;
  const stone = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.8), std(0x3a3a3a)); stone.position.set(0, 1.5, 10); g.add(stone);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ map: ecf, transparent: true, alphaTest: 0.05 })); face.position.set(0, 1.6, 10.41); g.add(face);
  g.position.set(x, 0, z); g.userData.beams = beams;
  return g;
}

// Legends' Field: a row of floodlit 5-a-side pitches with low fences
function fivesPitches(list, rot) {
  const g = new THREE.Group(); g.name = 'legendsField';
  const tex = pitchTex(8, true, 512, 300), fence = new THREE.MeshStandardMaterial({ color: 0x1d1f22, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  for (const [x, z] of list) {
    const p = new THREE.Group();
    const base = new THREE.Mesh(new THREE.PlaneGeometry(44, 26), std(0x3f8a35)); base.rotation.x = -Math.PI / 2; base.position.y = 0.32; p.add(base);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(40 / 0.94, 20 / 0.907), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.36; p.add(pitch);
    const cage = new THREE.Mesh(new THREE.BoxGeometry(43, 3, 25, 1, 1, 1), fence); cage.position.y = 1.85; p.add(cage);
    for (const [sx, sz] of [[-21, -12], [21, -12], [-21, 12], [21, 12]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 10), std(0x9a9a9a)); m.position.set(sx, 5, sz); p.add(m);
      const h = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 })); h.material.userData.lampHead = true; h.position.set(sx, 10, sz); p.add(h);
    }
    for (const sx of [-1, 1]) { const goal = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 3.2), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })); goal.position.set(sx * 19.6, 1.1, 0); p.add(goal); }
    p.position.set(x, 0, z); p.rotation.y = rot; g.add(p);
  }
  return g;
}

// Manchester United Football Ground station, rebuilt: two 230 m island platforms under butterfly canopies on red
// tree columns, a glazed footbridge with lift and stair towers to both islands, and a concourse hall on the square
// whose roof sweeps up into a cantilevered red canopy over the entrance, the station's name and crest on its fascia.
// Local frame: platforms along x, the square on +z.
function station(st) {
  const g = new THREE.Group(); g.name = 'station';
  const len = 230, plat = std(0xd5d1c8), red = std(PAL.red, { metalness: 0.3, roughness: 0.45 }), steel = std(0xe9e7e2, { metalness: 0.4, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfe3df, transparent: true, opacity: 0.42, roughness: 0.05, metalness: 0.1, emissive: 0xffe2b0, emissiveIntensity: 0 });
  glass.userData.windowGlow = true;
  const roofWhite = std(0xf4f2ee, { roughness: 0.35, side: THREE.DoubleSide }), soffit = std(0xb98a5a, { roughness: 0.7, side: THREE.DoubleSide });   // timber soffit
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  // island platforms, tactile edges, and a butterfly canopy on each: two wings rising to the edges, a glazed valley
  for (const off of [-9, 9]) {
    box(len, 1.1, 8, plat, 0, 0.55, off);
    for (const e of [-3.6, 3.6]) box(len, 0.05, 0.5, std(0xf1c040), 0, 1.13, off + e);
    const cl = len * 0.78, wing = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(5.2, 1.3), new THREE.Vector2(5.2, 1.55), new THREE.Vector2(0, 0.25)]);
    for (const sd of [1, -1]) {   // shape x -> across the platform (mirrored for the second wing), extruded along it
      const w = new THREE.Mesh(new THREE.ExtrudeGeometry(wing, { depth: cl, bevelEnabled: false }), roofWhite);
      w.rotation.y = -Math.PI / 2; w.scale.x = sd; w.position.set(cl / 2, 6.4, off); g.add(w);
    }
    box(cl, 0.08, 0.9, glass, 0, 6.5, off);                                   // the glazed valley gutter-light
    for (let x = -cl / 2 + 8; x <= cl / 2 - 8; x += 18) {                     // red tree columns: a trunk and two branches
      box(0.5, 5.3, 0.5, red, x, 3.75, off);
      for (const sd of [1, -1]) { const b = box(0.28, 3.4, 0.28, red, x, 6.6, off + sd * 1.4); b.rotation.x = sd * 0.75; }
    }
    for (let x = -cl / 2 + 20; x < cl / 2; x += 40) { box(1.8, 1.1, 0.12, std(0x1d1f22), x, 4.2, off); }   // departure boards
  }
  // footbridge: a glazed tube from the concourse's upper level over both islands, with a lift and stair tower on each
  const fbX = 18;
  box(7, 0.5, 46, steel, fbX, 8.2, 3); box(7, 0.4, 46, steel, fbX, 12.6, 3);
  for (const sd of [1, -1]) box(0.25, 4.2, 46, glass, fbX + sd * 3.4, 10.4, 3);
  for (const off of [-9, 9]) {
    box(3.2, 12.8, 3.2, glass, fbX - 4.8, 6.4, off);                          // lift shaft
    box(3.2, 0.4, 3.2, steel, fbX - 4.8, 12.9, off);
    for (let k = 0; k < 6; k++) box(2.2, 0.25, 1.2, steel, fbX + 4.8, 1.4 + k * 1.15, off - 2.8 + k * 1.1);   // stair flights
  }
  // concourse hall on the square: glass walls behind slender red mullions
  const HX = 110, HZ0 = 19, HZ1 = 35, HH = 12;
  box(HX, 0.4, HZ1 - HZ0, plat, 0, 0.2, (HZ0 + HZ1) / 2);
  box(HX, HH, 0.3, glass, 0, HH / 2, HZ1); box(HX, HH, 0.3, glass, 0, HH / 2, HZ0);
  for (const sd of [1, -1]) box(0.3, HH, HZ1 - HZ0, glass, sd * HX / 2, HH / 2, (HZ0 + HZ1) / 2);
  for (let x = -HX / 2; x <= HX / 2; x += 5) box(0.22, HH, 0.4, red, x, HH / 2, HZ1 + 0.2);
  box(HX - 2, 0.35, HZ1 - HZ0 - 2, steel, 0, 8, (HZ0 + HZ1) / 2);            // mezzanine to the footbridge
  // the roof: one shell that rises from the platform side and sweeps out over the square as a 16 m canopy
  {
    const prof = new THREE.Shape(), z0 = HZ0 - 3, z1 = HZ1 + 16;
    prof.moveTo(z0, HH + 0.6); prof.quadraticCurveTo((z0 + z1) / 2, HH + 7.5, z1, HH + 3.6); prof.lineTo(z1, HH + 4.4); prof.quadraticCurveTo((z0 + z1) / 2, HH + 8.6, z0, HH + 1.4); prof.closePath();
    const geo = new THREE.ExtrudeGeometry(prof, { depth: HX + 16, bevelEnabled: false }); geo.translate(0, 0, -(HX + 16) / 2); geo.rotateY(-Math.PI / 2);
    g.add(new THREE.Mesh(geo, red));
    const under = new THREE.Mesh(geo.clone(), soffit); under.position.y = -0.25; g.add(under);   // timber soffit seen from below
    for (const x of [-HX / 2 - 4, -HX / 4, 0, HX / 4, HX / 2 + 4]) {           // raking red struts out to the canopy edge
      const s = box(0.45, 15.5, 0.45, red, x, 8.6, HZ1 + 10); s.rotation.x = 0.42;
    }
  }
  // the station's name and the crest on a board hung under the canopy edge
  const sign = canvasTex(2048, 112, (c) => { c.fillStyle = '#c8102e'; c.fillRect(0, 0, 2048, 112); c.fillStyle = '#fff'; c.font = '700 80px "Big Shoulders Display", "Arial Narrow", Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('MANCHESTER UNITED FOOTBALL GROUND', 1024, 60); });
  const fascia = new THREE.Mesh(new THREE.PlaneGeometry(76, 4.2), new THREE.MeshBasicMaterial({ map: sign })); fascia.position.set(0, HH + 2.2, HZ1 + 15.6); g.add(fascia);
  const crestImg = new Image(); crestImg.src = 'assets/crest.png';
  const crestTex = canvasTex(512, 512, () => {}); crestImg.onload = () => { const c = crestTex.image.getContext('2d'); c.drawImage(crestImg, 0, 0, 512, 512); crestTex.needsUpdate = true; };
  for (const x of [-44, 44]) { const cr = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: crestTex, transparent: true })); cr.position.set(x, HH + 2.2, HZ1 + 15.65); g.add(cr); }
  for (const sd of [1, -1]) box(0.6, 2.2, 0.6, std(0x1d1f22), sd * 30, 1.1, HZ1 + 6);   // ticket and info totems
  g.traverse((o) => { if (o.isMesh && o.material === glass) o.castShadow = false; });
  g.position.set(st.x, 0.2, st.z); g.rotation.y = -st.ang;
  const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -st.ang);
  if (fwd.x * st.nx + fwd.z * st.nz < 0) g.rotation.y += Math.PI;
  return g;
}

function botanicGarden(x, z, beds = []) {
  const g = new THREE.Group(); g.name = 'botanicGarden';
  const bed = new THREE.InstancedMesh(new THREE.CylinderGeometry(2.2, 2.4, 0.7, 14), std(0xc8102e, { roughness: 1 }), Math.max(1, beds.length));
  const M = new THREE.Matrix4();
  beds.forEach(([bx, bz], i) => { M.makeTranslation(bx, 0.6, bz); bed.setMatrixAt(i, M); });
  bed.count = beds.length; g.add(bed);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(16, 48), std(0xd9cfbd)); plaza.rotation.x = -Math.PI / 2; plaza.position.set(x, 0.47, z); g.add(plaza);   // paved circle round the light
  return g;
}

// ======================================================================
export function buildMasterplan(plan) {
  const g = new THREE.Group(); g.name = 'masterplan';
  const R = rng(42), M = mats(), buckets = {}, add = (k, geo) => (buckets[k] ||= []).push(ni(geo));
  const ground = { paving: new THREE.MeshStandardMaterial({ map: pavingTex('#c2bbaf'), roughness: 0.9 }), block: new THREE.MeshStandardMaterial({ map: pavingTex('#b9b4ab'), roughness: 0.9 }),
    lawn: new THREE.MeshStandardMaterial({ map: lawnTex(), roughness: 1 }), road: new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.85 }),
    kerb: std(0xa8a39a), junction: std(0x4a4c50, { roughness: 0.9 }), fan: new THREE.MeshStandardMaterial({ map: fanWalkTex(), roughness: 0.85 }), prom: new THREE.MeshStandardMaterial({ map: pavingTex('#c9a98a', 'rgba(0,0,0,0.1)', 8), roughness: 0.9 }) };
  const gb = {}, gadd = (k, geo) => (gb[k] ||= []).push(ni(geo));
  for (const p of plan.base || []) { const geo = flatPoly(ring(p), 0.03, 1 / 24); geo.deleteAttribute('normal'); geo.computeVertexNormals(); gadd('paving', geo); }   // lowest layer: pitches, roads and plazas all sit above it
  for (const p of plan.plazas) {
    if (p.kind === 'crest') continue;
    const geo = flatPoly(ring(p.p), p.kind === 'arena' ? 0.22 : 0.18, 1 / 24); geo.deleteAttribute('normal'); geo.computeVertexNormals();
    gadd(p.kind === 'block' ? 'block' : 'paving', geo);
  }
  for (const p of plan.greens) gadd('lawn', flatPoly(ring(p.p), 0.3, 1 / 30));
  // Stacked, never coplanar: where two carriageways overlap (joints, crossings, merges) each has its own level, 12 mm
  // apart, so they cannot fight in the depth buffer and shimmer as the camera moves; junction infill above them all,
  // then the walks.
  plan.roads.forEach((r, i) => { gadd('kerb', ribbon(r.l, r.w + 7, 0.2 + (i % 5) * 0.008)); gadd('road', ribbon(r.l, r.w, 0.26 + (i % 7) * 0.012, 1 / 30)); });
  plan.walks.forEach((w, i) => gadd(w.kind === 'promenade' ? 'prom' : 'fan', ribbon(w.l, w.w, 0.38 + (i % 4) * 0.012, 1 / 16)));
  for (const [x, z, r] of plan.junctions || []) { const c = new THREE.CircleGeometry(r, 24); c.rotateX(-Math.PI / 2); c.translate(x, 0.35, z); gadd('junction', c); }   // junction infill
  for (const [k, list] of Object.entries(gb)) {
    for (const geo of list) for (const key of Object.keys(geo.attributes)) if (!['position', 'uv', 'normal'].includes(key)) geo.deleteAttribute(key);
    const m = new THREE.Mesh(mergeGeometries(list), ground[k]); m.receiveShadow = true; m.name = 'ground_' + k; g.add(m);
  }
  const cp = plan.special.crest, crest = new THREE.Mesh(new THREE.CircleGeometry(cp.r, 96), new THREE.MeshStandardMaterial({ map: crestPlazaTex(), roughness: 0.6 }));
  crest.rotation.set(-Math.PI / 2, 0, cp.dir ? Math.atan2(-cp.dir[0], -cp.dir[1]) : 0); crest.position.set(cp.x, 0.47, cp.z); /* top of the crest points along the fan walk */ crest.receiveShadow = true; crest.name = 'crestPlaza'; g.add(crest);

  for (const b of plan.blocks) {
    const key = b.use === 'res' ? 'res_' + (b.style || 'light') : b.use;
    const poly = ring(b.p), y0 = b.y0 || 0;
    add(M[key] ? key : 'retail', wallGeo(poly, b.h, y0));
    const roof = b.use === 'res' ? (R() < 0.5 ? 'roofGreen' : 'roofSolar') : b.use === 'parking' ? 'roofGreen' : 'roofGrey';
    add(roof, flatPoly(poly, y0 + b.h, 1 / 12));
  }
  for (const [k, list] of Object.entries(buckets)) { const m = new THREE.Mesh(mergeGeometries(list), M[k]); m.castShadow = m.receiveShadow = true; m.name = 'bld_' + k; g.add(m); }

  const arch = std(PAL.red, { metalness: 0.4, roughness: 0.4 }), girder = std(0x5c6066, { metalness: 0.5 });
  // bridges: a humped deck that lands at path level at both ends (so walks and roads run straight onto it), with parapets and arches
  for (const b of plan.bridges) {
    const [ax, az] = b.a, [bx, bz] = b.b, dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = -uz, pz = ux;
    const H = Math.min(4.5, L * 0.07), yAt = (t) => 0.34 + H * Math.sin(Math.PI * t), N = 24, hw = b.w / 2;
    const top = [], uvT = [], side = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, cx = ax + dx * t, cz = az + dz * t, y = yAt(t);
      top.push(cx + px * hw, y, cz + pz * hw, cx - px * hw, y, cz - pz * hw); uvT.push(0, t * L / 16, 1, t * L / 16);
    }
    const idx = []; for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    const deck = new THREE.BufferGeometry(); deck.setAttribute('position', new THREE.Float32BufferAttribute(top, 3)); deck.setAttribute('uv', new THREE.Float32BufferAttribute(uvT, 2)); deck.setIndex(idx); deck.computeVertexNormals();
    g.add(new THREE.Mesh(deck, b.kind === 'fan' ? ground.fan : ground.road));
    const under = deck.clone(); under.translate(0, -0.9, 0); g.add(new THREE.Mesh(under, std(0x9a958e, { side: THREE.DoubleSide })));
    for (const s of [-hw, hw]) {   // solid edge beams and glass/steel parapets following the deck
      const pts = Array.from({ length: N + 1 }, (_, i) => { const t = i / N; return [ax + dx * t + px * s, yAt(t) - 0.45, az + dz * t + pz * s]; });
      g.add(tube(pts, 0.45, std(0xe8e6e1), N * 2));
      g.add(tube(pts.map(([x, y, z]) => [x, y + 1.55, z]), 0.07, std(0x6b6f74, { metalness: 0.6 }), N * 2));
      if (b.kind === 'fan') g.add(tube(Array.from({ length: 13 }, (_, i) => { const t = 0.08 + 0.84 * i / 12; return [ax + dx * t + px * s, yAt(t) + 1 + 13 * Math.sin(Math.PI * (t - 0.08) / 0.84), az + dz * t + pz * s]; }), 0.5, arch, 30));
    }
    for (const t of [0.3, 0.7]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, yAt(t)), std(0x9a958e)); c.position.set(ax + dx * t, yAt(t) / 2 - 0.5, az + dz * t); g.add(c); }   // piers
  }
  const sp = plan.special;
  g.add(station(sp.station));
  g.add(fivesPitches(sp.fives || [], sp.legends.rot));
  g.add(botanicGarden(sp.trinity.x, sp.trinity.z, sp.beds || []));
  const tl = trinityLight(sp.trinity.x, sp.trinity.z); g.add(tl); g.userData.trinity = tl;

  const tpts = plan.trees.slice();
  const tg = trees(tpts, R, { scale: 0.9 }); tg.name = 'trees'; g.add(tg);
  const lights = [];
  for (const r of plan.roads) lights.push(...alongLine(r.l, 30, r.w / 2 + 2));
  // walk lamps line both edges; drop any that land inside another walk, on a road or on the crest plaza
  const segD = (x, z, l) => { let d = Infinity; for (let i = 0; i < l.length - 1; i++) { const [x1, z1] = l[i], [x2, z2] = l[i + 1], dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2)); d = Math.min(d, Math.hypot(x - x1 - t * dx, z - z1 - t * dz)); } return d; };
  const cpl = plan.special.crest;
  for (const w of plan.walks) for (const side of [1, -1]) for (const p of alongLine(w.l, w.kind === 'main' ? 18 : 24, side * (w.w / 2 - 0.8))) {
    if (cpl && Math.hypot(p[0] - cpl.x, p[1] - cpl.z) < cpl.r + 3) continue;
    if (plan.walks.some((o) => o !== w && segD(p[0], p[1], o.l) < o.w / 2 - 0.5)) continue;
    if (plan.roads.some((r) => segD(p[0], p[1], r.l) < r.w / 2 + 0.5)) continue;
    lights.push(p);
  }
  // bollard lamps around the rim of the crest plaza
  if (cpl) for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; lights.push([cpl.x + Math.cos(a) * (cpl.r + 1.2), cpl.z + Math.sin(a) * (cpl.r + 1.2), a + Math.PI / 2]); }
  g.add(streetLights(lights));
  g.userData.lightPoints = lights;
  g.userData.labels = plan.labels;
  g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return g;
}
