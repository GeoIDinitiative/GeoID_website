/**
 * WHAT CUSTOMISATION AND UPGRADES LOOK LIKE. Pure picture: three.js and a
 * canvas, no game state. game/progress.js dresses the live astronaut and
 * rover with these; game/workshop.js dresses its turntable copies with the
 * same functions, so the preview is the thing you get.
 *
 *   dressAstronaut({ body, parts }, look, visuals)   colours, visor, patch, name tag, proportions, suit hardware
 *   dressRover(model, design, fit, paint, kit)       paint, decals, bolt-on parts, the wheel set
 *   prepareSuitModel(model)                          the avatar's own material treatment, for a copy of the kit's astronaut
 *   prepareSuitRig(character)                        the same treatment for a rigged Character (charrig.js), once
 *
 * THE RIG IS NOT TOUCHED. The astronaut is the skinned Kestrel rig (charrig.js):
 * customisation changes the suit's and the visor's materials, hangs small
 * meshes on the rig's sockets (sk_patch_L, sk_nametag, sk_wrist_*, sk_shin_*,
 * sk_knee_*, sk_back, sk_hip_R: empties on the bones, made in Blender with the
 * radius of the suit there), each tagged userData.cosmetic and rebuilt on every
 * change, and scales the whole body for height and a little across for build
 * (every bone scales with it, so the clips still meet the ground). The old
 * six-part model (no rig) is still dressed the old way if it is all there is.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { COLOUR, VISOR, DESIGN } from "./progress_data.js?v=6d37c9c-9b39e129";

const col = (hex) => new THREE.Color(hex);
const WHITE = new THREE.Color(1, 1, 1);
const PART_NAMES = ["torso", "head", "armL", "armR", "legL", "legR"];
const std = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.15 }, o));

/* ── textures ─────────────────────────────────────────────────────────────── */

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const texCache = new Map();
function cached(key, make) { if (!texCache.has(key)) texCache.set(key, make()); return texCache.get(key); }

/** A shoulder patch, 128 px. Mission patches are shields; the rest are roundels. */
export function drawPatch(g, id, S = 128) {
  const R = S / 2, font = (px, w = 700) => `${w} ${px}px "Exo 2", "Chakra Petch", sans-serif`;
  g.clearRect(0, 0, S, S);
  const roundel = (bg, ring) => { g.fillStyle = bg; g.beginPath(); g.arc(R, R, R - 3, 0, 7); g.fill(); g.lineWidth = 6; g.strokeStyle = ring; g.stroke(); };
  const shield = (bg, ring) => { g.fillStyle = bg; g.beginPath(); g.moveTo(10, 10); g.lineTo(S - 10, 10); g.lineTo(S - 10, S * 0.55); g.quadraticCurveTo(S - 12, S - 18, R, S - 6); g.quadraticCurveTo(12, S - 18, 10, S * 0.55); g.closePath(); g.fill(); g.lineWidth = 6; g.strokeStyle = ring; g.stroke(); };
  const label = (t, y, c = "#fdf7ff", px = 17) => { g.fillStyle = c; g.font = font(px); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, R, y); };
  switch (id) {
    case "geoid": roundel("#16052e", "#ff2bd6"); g.strokeStyle = "#00e5ff"; g.lineWidth = 9; g.beginPath(); g.arc(R, R - 6, 26, 0.35, Math.PI * 1.85); g.stroke(); g.fillStyle = "#00e5ff"; g.fillRect(R + 2, R - 10, 24, 8); label("GEOID", S - 26, "#ff2bd6", 15); break;
    case "jezero": roundel("#7a3a20", "#ffb347"); g.strokeStyle = "#e9b48a"; g.lineWidth = 5; g.beginPath(); g.arc(R, R - 6, 30, 0, 7); g.stroke(); g.fillStyle = "#3a6fb5"; g.beginPath(); g.moveTo(R - 26, R - 18); g.lineTo(R - 4, R - 4); g.lineTo(R - 22, R + 10); g.closePath(); g.fill(); label("JEZERO", S - 24, "#fdf7ff", 15); break;
    case "ares": roundel("#1f0e45", "#7b4dff"); g.fillStyle = "#ff6a3d"; g.beginPath(); g.moveTo(R, 18); g.lineTo(R + 26, R + 18); g.lineTo(R, R + 6); g.lineTo(R - 26, R + 18); g.closePath(); g.fill(); label("ARES", S - 24, "#fdf7ff", 16); break;
    case "touchdown": shield("#2a1260", "#00e5ff"); g.fillStyle = "#e6e2d8"; g.fillRect(R - 18, R - 8, 36, 12); g.fillRect(R - 26, R + 4, 8, 14); g.fillRect(R + 18, R + 4, 8, 14); label("TOUCHDOWN", S - 30, "#00e5ff", 12); break;
    case "first_core": shield("#3a1a10", "#ff6a3d"); g.fillStyle = "#8a5a44"; g.beginPath(); g.ellipse(R, R + 6, 30, 18, 0, 0, 7); g.fill(); g.fillStyle = "#d9dde2"; g.fillRect(R - 4, 20, 8, 40); label("FIRST CORE", S - 30, "#ffb347", 12); break;
    case "depot": shield("#16052e", "#ffb347"); g.fillStyle = "#d9dde2"; for (let k = 0; k < 4; k++) g.fillRect(R - 30 + k * 16, R - 18 + (k % 2) * 12, 10, 26); label("DEPOT", S - 30, "#ffb347", 14); break;
    case "survey": shield("#0d2a33", "#00e5ff"); g.strokeStyle = "#4dffa6"; g.lineWidth = 4; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(22, 34 + k * 12); g.lineTo(S - 22, 26 + k * 14); g.stroke(); } label("SURVEY", S - 30, "#00e5ff", 14); break;
    case "foothold": shield("#1f0e45", "#4dffa6"); g.fillStyle = "#e6e2d8"; g.beginPath(); g.arc(R, R + 4, 24, Math.PI, 0); g.fill(); g.fillRect(R - 24, R + 4, 48, 8); label("FOOTHOLD", S - 30, "#4dffa6", 12); break;
    case "storm": shield("#3a2a14", "#ffd319"); g.strokeStyle = "#e9b48a"; g.lineWidth = 6; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(R - 10 + k * 8, R - 6 + k * 6, 26 - k * 8, Math.PI * 0.9, Math.PI * 2.2); g.stroke(); } label("STORM", S - 30, "#ffd319", 14); break;
    default: break;
  }
}
const patchTex = (id) => cached("patch:" + id, () => canvasTex(128, 128, (g) => drawPatch(g, id)));
const nameTex = (name, accent) => cached("name:" + name + accent, () => canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = "#16052e"; g.fillRect(0, 0, w, h); g.strokeStyle = accent; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = "#fdf7ff"; g.font = `700 34px "Exo 2", "Chakra Petch", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(name).toUpperCase().slice(0, 14), w / 2, h / 2 + 2);
}));
/** A rover's side decal, 512 x 128, in the accent colour. */
export function drawDecal(g, decal, accent, number, W = 512, H = 128) {
  g.clearRect(0, 0, W, H);
  const num = String(number).padStart(2, "0"), font = (px) => `700 ${px}px "Orbitron", "Audiowide", "Exo 2", sans-serif`;
  g.fillStyle = accent; g.strokeStyle = accent;
  if (decal === "stripe") { for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(40 + k * 40, H - 18); g.lineTo(90 + k * 40, 18); g.lineTo(110 + k * 40, 18); g.lineTo(60 + k * 40, H - 18); g.closePath(); g.fill(); } g.fillRect(200, H / 2 - 8, W - 220, 16); }
  if (decal === "chevron") { g.lineWidth = 16; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(60 + k * 60, 20); g.lineTo(100 + k * 60, H / 2); g.lineTo(60 + k * 60, H - 20); g.stroke(); } }
  if (decal === "geoid") { g.font = font(70); g.textAlign = "left"; g.textBaseline = "middle"; g.fillText("GEOID", 30, H / 2 + 4); }
  if (decal === "number" || decal === "stripe" || decal === "chevron") { g.font = font(84); g.textAlign = "right"; g.textBaseline = "middle"; g.fillText(num, W - 24, H / 2 + 6); }
}
const decalTex = (decal, accent, number) => cached(`decal:${decal}:${accent}:${number}`, () => canvasTex(512, 128, (g) => drawDecal(g, decal, accent, number)));

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Bounding box of a part's OWN geometry in its local frame (not the parts it carries, not cosmetics). */
export function localBox(part, stop = new Set()) {
  const box = new THREE.Box3(), tmp = new THREE.Box3(), m = new THREE.Matrix4();
  part.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(part.matrixWorld).invert();
  const visit = (o) => {
    if (o !== part && (stop.has(o) || o.userData.cosmetic)) return;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
      box.union(tmp);
    }
    for (const c of o.children) visit(c);
  };
  visit(part);
  return box;
}
function cosmeticGroup(part, key) {
  const old = part.children.find((c) => c.userData.cosmetic === key);
  if (old) { part.remove(old); old.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (!o.material.userData.shared) o.material.dispose(); } }); }
  const g = new THREE.Group(); g.userData.cosmetic = key; g.name = "cosmetic-" + key;
  part.add(g);
  return g;
}
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.userData.cosmetic = true; return m; };

/** The avatar's own treatment of the kit's suit (avatar.js build()): its materials, taken down to a dusty off-white. */
export function prepareSuitModel(model) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    for (const m of [].concat(o.material)) { m.color.multiplyScalar(0.62); m.roughness = Math.max(m.roughness ?? 0.8, 0.85); m.metalness = 0; }
  });
  return model;
}

/** The avatar's treatment of the suit for a rigged Character: its own materials taken down to a dusty off-white (once). */
export function prepareSuitRig(ch) {
  if (!ch || ch._suitPrepared) return ch;
  ch._suitPrepared = true;
  ch.model.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.userData.base || o.material;
    if (!m || !/^astnt1_/.test(m.name || "")) return;
    m.color.multiplyScalar(0.62); m.roughness = Math.max(m.roughness ?? 0.8, 0.85); m.metalness = 0;
  });
  return ch;
}

/** Dress a rigged Character: the same look on sockets. */
function dressRig(target, look, visuals) {
  const ch = target.rig, body = target.body || ch.root, K = ch.sockets;
  const b = 1 + (look.build - 1) * 0.6;
  body.scale.set(look.height * b, look.height, look.height * b);
  const suit = col(COLOUR[look.suit].hex), accent = col(COLOUR[look.accent].hex), tint = WHITE.clone().lerp(suit, look.suit === "kit" ? 0 : 0.82);
  const boost = look.suit === "kit" ? 1 : 1.35, v = col(VISOR[look.visor].hex);
  ch.model.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.userData.base || o.material;
    if (!m || !m.color) return;
    if (/^astnt1_1/.test(m.name || "")) {
      if (!m.userData.tintBase) m.userData.tintBase = m.color.clone();
      m.color.copy(m.userData.tintBase).multiply(tint).multiplyScalar(boost);
    } else if (/^astnt1_2/.test(m.name || "")) {
      if (!m.userData.tintBase) m.userData.tintBase = m.color.clone();
      m.color.copy(m.userData.tintBase).multiply(WHITE.clone().lerp(v, 0.85)).multiplyScalar(1.6);
      m.emissive = v.clone(); m.emissiveIntensity = 0.22; m.roughness = 0.22; m.metalness = 0.35; m.needsUpdate = true;
    }
  });
  const aMat = std(accent, { roughness: 0.5 }), dark = std(0x2b2f35, { roughness: 0.5, metalness: 0.4 }), metal = std(0x9aa1a9, { roughness: 0.35, metalness: 0.6 });
  const out = { jet: [] };
  const ring = (sk, key, k, h, mat, torus) => {
    const s = K[sk]; if (!s) return null;
    const g = cosmeticGroup(s, key), r = (s.userData.radius || 0.08) * k;
    const m = mesh(torus ? new THREE.TorusGeometry(r, 0.016, 6, 22) : new THREE.CylinderGeometry(r, r, h, 20, 1, true), mat);
    if (!torus) m.rotation.x = Math.PI / 2;
    g.add(m); return m;
  };
  for (const s of ["sk_wrist_L", "sk_wrist_R"]) ring(s, "accent", 1.06, 0.05, aMat);
  for (const s of ["sk_shin_L", "sk_shin_R"]) ring(s, "accent", 1.04, 0.05, aMat);
  for (const s of ["sk_knee_L", "sk_knee_R"]) {
    const sk = K[s]; if (!sk) continue;
    const g = cosmeticGroup(sk, "kit"), r = sk.userData.radius || 0.12;
    if (visuals.has("knees") || visuals.has("exo")) g.add(mesh(new THREE.TorusGeometry(r * 0.98, 0.016, 6, 22), dark));
    if (visuals.has("exo")) for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.02, 0.025, 0.42), metal, sx * (r + 0.012), 0, -0.05));
  }
  if (K.sk_wrist_R) { const g = cosmeticGroup(K.sk_wrist_R, "gauntlet"); if (visuals.has("gauntlet")) { const r = (K.sk_wrist_R.userData.radius || 0.075) * 1.14; const m = mesh(new THREE.CylinderGeometry(r, r, 0.08, 20, 1, true), std(0x062a33, { emissive: col("#00e5ff"), emissiveIntensity: 1.4 }), 0, 0, -0.06); m.rotation.x = Math.PI / 2; g.add(m); } }
  if (K.sk_patch_L) {
    const g = cosmeticGroup(K.sk_patch_L, "patch");
    if (look.patch !== "none") {
      const pm = new THREE.MeshStandardMaterial({ map: patchTex(look.patch), transparent: true, roughness: 0.7, metalness: 0, alphaTest: 0.05 });
      const p = mesh(new THREE.PlaneGeometry(0.1, 0.1), pm, 0, 0, 0.006); p.name = "patch"; g.add(p);
    }
  }
  if (K.sk_nametag) {
    const g = cosmeticGroup(K.sk_nametag, "nametag");
    if (look.nametag) { const t = mesh(new THREE.PlaneGeometry(0.17, 0.0425), new THREE.MeshStandardMaterial({ map: nameTex(look.name, COLOUR[look.accent].hex), roughness: 0.6 }), 0, 0, 0.012); t.name = "nametag"; g.add(t); }
  }
  if (K.sk_back) {
    const g = cosmeticGroup(K.sk_back, "suitkit");
    const tank = visuals.has("tank2") ? [0.055, 0.42] : visuals.has("tank1") ? [0.042, 0.34] : null;
    if (tank) for (const sx of [-1, 1]) {
      g.add(mesh(new THREE.CylinderGeometry(tank[0], tank[0], tank[1], 14), std(0xd9dde2, { metalness: 0.5, roughness: 0.3 }), sx * 0.17, 0.02, tank[0] * 0.8));
      g.add(mesh(new THREE.CylinderGeometry(tank[0] * 1.04, tank[0] * 1.04, 0.03, 14), aMat, sx * 0.17, 0.02 + tank[1] * 0.3, tank[0] * 0.8));
    }
    if (visuals.has("jet")) {
      g.add(mesh(new THREE.BoxGeometry(0.34, 0.05, 0.06), dark, 0, -0.32, 0.03));
      for (const sx of [-1, 1]) {
        g.add(mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.09, 12), metal, sx * 0.13, -0.34, 0.05));
        const glow = mesh(new THREE.ConeGeometry(0.05, 0.32, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }), sx * 0.13, -0.54, 0.05);
        glow.rotation.x = Math.PI; glow.visible = false; glow.name = "jet-glow"; g.add(glow); out.jet.push(glow);
      }
    }
    if (visuals.has("sled")) g.add(mesh(new THREE.BoxGeometry(0.3, 0.16, 0.14), std(0x565a60, { metalness: 0.4 }), 0, -0.55, 0.07));
  }
  if (K.sk_hip_R) { const g = cosmeticGroup(K.sk_hip_R, "caddy"); if (visuals.has("caddy") && !visuals.has("sled")) g.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 0.09), std(0x565a60, { metalness: 0.4 }), 0, 0, 0.045)); }
  return out;
}

/* ── the astronaut ────────────────────────────────────────────────────────── */

/**
 * Dress the walker (or a copy of it). `target` = { body, parts: {torso, head, armL, armR, legL, legR} };
 * `look` = a cleanLook(); `visuals` = Set of upgrade visual keys installed (tank1, tank2, jet, caddy, sled, gauntlet, knees, exo).
 * Returns handles for the per-frame bits: { jet: [glow meshes] }.
 */
export function dressAstronaut(target, look, visuals = new Set()) {
  if (target && target.rig) return dressRig(target, look, visuals);
  const { body, parts } = target, P = parts;
  if (!body || !P || !P.torso) return {};
  const stop = new Set(PART_NAMES.map((n) => P[n]).filter(Boolean));
  // proportions: height scales the whole body (every pivot with it); build widens the limbs across their own axis
  body.scale.setScalar(look.height);
  for (const a of [P.armL, P.armR]) a.scale.set(1, look.build, look.build);
  for (const l of [P.legL, P.legR]) l.scale.set(look.build, 1, look.build);
  // suit colour: a tint over the kit's texture (the suit material; every material on the primitive fallback)
  const suit = col(COLOUR[look.suit].hex), accent = col(COLOUR[look.accent].hex), tint = WHITE.clone().lerp(suit, look.suit === "kit" ? 0 : 0.82);
  const boost = look.suit === "kit" ? 1 : 1.35;
  for (const n of PART_NAMES) {
    const part = P[n]; if (!part) continue;
    const visit = (o) => {
      if (o !== part && (stop.has(o) || o.userData.cosmetic)) return;
      if (o.isMesh) for (const m of [].concat(o.material)) {
        if (!m || !m.color || (m.name && !/^astnt1_1/.test(m.name))) continue;
        if (!m.userData.base) m.userData.base = m.color.clone();
        m.color.copy(m.userData.base).multiply(tint).multiplyScalar(boost);
      }
      for (const c of o.children) visit(c);
    };
    visit(part);
  }
  const aMat = std(accent, { roughness: 0.5 }), dark = std(0x2b2f35, { roughness: 0.5, metalness: 0.4 }), metal = std(0x9aa1a9, { roughness: 0.35, metalness: 0.6 });
  const out = { jet: [] };
  // the visor: the kit's own visor material (astnt1_2, the face of the helmet), tinted and given a little glow of its colour
  {
    const v = col(VISOR[look.visor].hex);
    P.head.traverse((o) => {
      if (!o.isMesh || o.userData.cosmetic) return;
      for (const m of [].concat(o.material)) {
        if (!m || !/^astnt1_2/.test(m.name || "")) continue;
        if (!m.userData.base) m.userData.base = m.color.clone();
        m.color.copy(m.userData.base).multiply(WHITE.clone().lerp(v, 0.85)).multiplyScalar(1.6);
        m.emissive = v.clone(); m.emissiveIntensity = 0.22; m.roughness = 0.22; m.metalness = 0.35; m.name = "astnt1_2"; m.needsUpdate = true;
      }
    });
  }
  // accent bands at the wrists and shins, the shoulder patch, the gauntlet: placed on slices of the part's own vertices
  for (const [arm, side] of [[P.armL, 1], [P.armR, -1]]) {
    const g = cosmeticGroup(arm, "accent"), pv = partVerts(arm, stop); if (!pv.n) continue;
    const ax = axisSpan(pv, 0), at = (f) => ax.root + ax.along * ax.len * f;
    const ring = (f, k, h, mat) => { const sl = slab(pv, 0, at(f), 0.03); if (!sl) return null; const r = Math.max(sl.hy, sl.hz) * k;
      const m = mesh(new THREE.CylinderGeometry(r, r, h, 18, 1, true), mat, at(f), sl.cy, sl.cz); m.rotation.z = Math.PI / 2; g.add(m); return m; };
    ring(0.8, 1.08, 0.05, aMat);
    if (visuals.has("gauntlet") && side < 0) ring(0.9, 1.14, 0.08, std(0x062a33, { emissive: col("#00e5ff"), emissiveIntensity: 1.4 }));
    if (side > 0 && look.patch !== "none") {
      const sl = slab(pv, 0, at(0.22), 0.04);
      if (sl) {
        const pm = new THREE.MeshStandardMaterial({ map: patchTex(look.patch), transparent: true, roughness: 0.7, metalness: 0, alphaTest: 0.05 });
        const p = mesh(new THREE.PlaneGeometry(0.1, 0.1), pm, at(0.22), sl.maxy + 0.006, sl.cz);
        const up = new THREE.Vector3(-ax.along, 0, 0), n = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(up, n);
        p.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n)); p.name = "patch"; g.add(p);
      }
    }
  }
  for (const leg of [P.legL, P.legR]) {
    const g = cosmeticGroup(leg, "accent"), pv = partVerts(leg, stop); if (!pv.n) continue;
    const ay = axisSpan(pv, 1), at = (f) => ay.root + ay.along * ay.len * f;
    const ring = (f, k, h, mat, torus) => { const sl = slab(pv, 1, at(f), 0.03); if (!sl) return null; const r = Math.max(sl.hx, sl.hz) * k;
      const m = mesh(torus ? new THREE.TorusGeometry(r, 0.016, 6, 20) : new THREE.CylinderGeometry(r, r, h, 18, 1, true), mat, sl.cx, at(f), sl.cz); if (torus) m.rotation.x = Math.PI / 2; g.add(m); return { m, sl }; };
    ring(0.74, 1.06, 0.05, aMat);
    if (visuals.has("knees") || visuals.has("exo")) ring(0.48, 1.04, 0, dark, true);
    if (visuals.has("exo")) { const sl = slab(pv, 1, at(0.5), 0.05); if (sl) for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.02, ay.len * 0.7, 0.025), metal, sl.cx + sx * (sl.hx + 0.012), at(0.5), sl.cz)); }
  }
  {
    const g = cosmeticGroup(P.torso, "suitkit"), pv = partVerts(P.torso, stop);
    if (pv.n) {
      const ay = axisSpan(pv, 1), y0 = Math.min(ay.root, ay.root + ay.along * ay.len), H = ay.len, yAt = (f) => y0 + H * f;
      // where the suit's surface is: a ray at the torso's own mesh (its vertices are too sparse to find the chest by sampling)
      const front = (x, y) => hit(P.torso, stop, x, y, 2, 0, 0, -1), back = (x, y) => hit(P.torso, stop, x, y, -2, 0, 0, 1), side = (y) => hit(P.torso, stop, -2, y, 0, 1, 0, 0);
      if (look.nametag) { const h = front(-0.11, yAt(0.66)); if (h) { const t = mesh(new THREE.PlaneGeometry(0.17, 0.0425), new THREE.MeshStandardMaterial({ map: nameTex(look.name, COLOUR[look.accent].hex), roughness: 0.6 }), -0.11, yAt(0.66), h.z + 0.012); t.name = "nametag"; g.add(t); } }
      const tank = visuals.has("tank2") ? [0.055, 0.42] : visuals.has("tank1") ? [0.042, 0.34] : null;
      if (tank) for (const sx of [-1, 1]) { const h = back(sx * 0.17, yAt(0.62)); if (!h) continue; const z = h.z - tank[0] * 0.8;
        g.add(mesh(new THREE.CylinderGeometry(tank[0], tank[0], tank[1], 14), std(0xd9dde2, { metalness: 0.5, roughness: 0.3 }), sx * 0.17, yAt(0.62), z));
        g.add(mesh(new THREE.CylinderGeometry(tank[0] * 1.04, tank[0] * 1.04, 0.03, 14), aMat, sx * 0.17, yAt(0.62) + tank[1] * 0.3, z)); }
      if (visuals.has("jet")) {
        const h = back(0, yAt(0.42));
        if (h) {
          g.add(mesh(new THREE.BoxGeometry(0.34, 0.05, 0.06), dark, 0, yAt(0.42), h.z - 0.02));
          for (const sx of [-1, 1]) {
            g.add(mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.09, 12), metal, sx * 0.13, yAt(0.4), h.z - 0.04));
            const glow = mesh(new THREE.ConeGeometry(0.05, 0.32, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }), sx * 0.13, yAt(0.4) - 0.2, h.z - 0.04);
            glow.rotation.x = Math.PI; glow.visible = false; glow.name = "jet-glow"; g.add(glow); out.jet.push(glow);
          }
        }
      }
      if (visuals.has("sled")) { const h = back(0, yAt(0.1)); if (h) g.add(mesh(new THREE.BoxGeometry(0.3, 0.16, 0.14), std(0x565a60, { metalness: 0.4 }), 0, yAt(0.1), h.z - 0.07)); }
      else if (visuals.has("caddy")) { const h = side(yAt(0.1)); if (h) g.add(mesh(new THREE.BoxGeometry(0.09, 0.14, 0.16), std(0x565a60, { metalness: 0.4 }), h.x - 0.045, yAt(0.1), h.z)); }
    }
  }
  return out;
}

const _rc = new THREE.Raycaster();
/** The first point of a part's own mesh along a ray given in the part's frame (null if it misses). */
function hit(part, stop, ox, oy, oz, dx, dy, dz) {
  part.updateMatrixWorld(true);
  const o = new THREE.Vector3(ox, oy, oz).applyMatrix4(part.matrixWorld), d = new THREE.Vector3(dx, dy, dz).transformDirection(part.matrixWorld);
  const meshes = [];
  const visit = (x) => { if (x !== part && (stop.has(x) || x.userData.cosmetic)) return; if (x.isMesh) meshes.push(x); for (const c of x.children) visit(c); };
  visit(part);
  _rc.set(o, d); _rc.far = 10;
  const h = _rc.intersectObjects(meshes, false)[0];
  return h ? part.worldToLocal(h.point.clone()) : null;
}

/** A part's own vertices in its local frame (cached: the kit's geometry never changes). */
function partVerts(part, stop) {
  if (part.userData._pv) return part.userData._pv;
  const xs = [], m = new THREE.Matrix4(), v = new THREE.Vector3();
  part.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(part.matrixWorld).invert();
  const visit = (o) => {
    if (o !== part && (stop.has(o) || o.userData.cosmetic)) return;
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 2500));
      m.multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(m); xs.push(v.x, v.y, v.z); }
    }
    for (const c of o.children) visit(c);
  };
  visit(part);
  const out = { a: xs, n: xs.length / 3 };
  part.userData._pv = out;
  return out;
}
/** Along one axis: where the part starts (the end nearer its pivot), which way it runs, and how long it is. */
function axisSpan(pv, k) {
  let lo = Infinity, hi = -Infinity;
  for (let i = k; i < pv.a.length; i += 3) { const x = pv.a[i]; if (x < lo) lo = x; if (x > hi) hi = x; }
  const root = Math.abs(lo) < Math.abs(hi) ? lo : hi;
  return { root, along: root === lo ? 1 : -1, len: hi - lo, lo, hi };
}
/** The cross-section of the vertices within `tol` of `value` along axis k: its centre, half-extents and limits. */
function slab(pv, k, value, tol, filterX = null) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; let n = 0;
  for (let i = 0; i < pv.a.length; i += 3) {
    if (Math.abs(pv.a[i + k] - value) > tol) continue;
    if (filterX && !filterX(pv.a[i])) continue;
    n++;
    for (let j = 0; j < 3; j++) { const x = pv.a[i + j]; if (x < lo[j]) lo[j] = x; if (x > hi[j]) hi[j] = x; }
  }
  if (n < 3) return null;
  return { n, cx: (lo[0] + hi[0]) / 2, cy: (lo[1] + hi[1]) / 2, cz: (lo[2] + hi[2]) / 2, hx: (hi[0] - lo[0]) / 2, hy: (hi[1] - lo[1]) / 2, hz: (hi[2] - lo[2]) / 2,
    minx: lo[0], maxx: hi[0], miny: lo[1], maxy: hi[1], minz: lo[2], maxz: hi[2] };
}

/* ── the rover ────────────────────────────────────────────────────────────── */

/** The bolt-on parts, as templates, from a loaded rover_upgrade_kit (origin of each = its mount point). */
export function kitParts(kitRoot) {
  if (!kitRoot) return null;
  const out = {};
  for (const n of ["kit_battery_pod", "kit_solar_wing", "kit_light_bar", "kit_drill_arm", "kit_dust_filter", "kit_wheel_mesh", "kit_wheel_balloon", "kit_wheel_spring"]) {
    const o = kitRoot.getObjectByName(n);
    if (o) out[n] = o;
  }
  return out;
}
function place(tpl, pos, scale = 1, mirror = false) {
  const o = tpl.clone(true);
  o.position.set(mirror ? -pos[0] : pos[0], pos[1], pos[2]);
  o.scale.set(mirror ? -scale : scale, scale, scale);
  o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.frustumCulled = false; } });
  return o;
}

/**
 * Dress a rover model (rovermodel.js's { scene, wheelNodes, radius } or the Workshop's copy).
 * `fit` = { visuals: Set (pods1, pods2, wings, lightbar, filters, arm), wheels: "wheel_mesh" | "wheel_balloon" | "wheel_spring" | null }.
 * Returns { glow: [light-bar materials], boom: the arm's boom node or null }.
 */
export function dressRover(model, designId, fit, paint, kit) {
  const scene = model && model.scene, D = DESIGN[designId];
  if (!scene || !D) return {};
  const M = D.mounts, out = { glow: [], boom: null };
  const old = scene.getObjectByName("progress-dress");
  if (old) scene.remove(old);
  const grp = new THREE.Group(); grp.name = "progress-dress";
  scene.add(grp);
  const V = fit.visuals || new Set();
  if (kit) {
    if (kit.kit_battery_pod && (V.has("pods1") || V.has("pods2"))) for (const p of M.pods.slice(0, V.has("pods2") ? 2 : 1)) for (const mir of [false, true]) grp.add(place(kit.kit_battery_pod, p, M.podScale || 1, mir));
    if (kit.kit_solar_wing && V.has("wings")) for (const mir of [false, true]) grp.add(place(kit.kit_solar_wing, M.wings, M.wingScale || 1, mir));
    if (kit.kit_light_bar && V.has("lightbar")) { const lb = place(kit.kit_light_bar, M.lightbar, 1); lb.traverse((m) => { if (m.isMesh && /^glow/.test(m.material.name)) out.glow.push(m.material); }); grp.add(lb); }
    if (kit.kit_dust_filter && V.has("filters")) for (const p of M.filters) grp.add(place(kit.kit_dust_filter, p, M.filterScale || 1));
    if (kit.kit_drill_arm && V.has("arm")) { const a = place(kit.kit_drill_arm, M.arm, M.armScale || 1); out.boom = a.getObjectByName("kit_drill_boom"); grp.add(a); }
  }
  // the wheel set: the design's own wheel meshes hidden, the kit's set in their place at the design's radius
  const tpl = kit && fit.wheels ? kit["kit_" + fit.wheels] : null, k = (model.radius || 0.5) / 0.5;
  for (const node of model.wheelNodes || []) {
    if (!node) continue;
    const prev = node.children.find((c) => c.userData.kitWheel);
    if (prev) node.remove(prev);
    const own = (o) => { if (o.isMesh && !o.userData.kitWheel) o.material.visible = !tpl; };
    own(node); for (const c of node.children) if (!c.userData.kitWheel) c.traverse(own);
    if (tpl) {
      const w = tpl.clone(true); w.position.set(0, 0, 0); w.scale.setScalar(k); w.userData.kitWheel = true;
      w.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.frustumCulled = false; } });
      node.add(w);
    }
  }
  // paint: the kit's own named materials (hull, hull_alt, accent), on the rover and on its parts
  const body = col(COLOUR[paint.body].hex), acc = col(COLOUR[paint.accent].hex), grey = new THREE.Color(0.42, 0.43, 0.44);
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || seen.has(m) || !m.color) continue; seen.add(m);
      const base = m.userData.base || (m.userData.base = m.color.clone());
      if (m.name === "hull") m.color.copy(paint.body === "kit" ? base : body);
      else if (m.name === "hull_alt") m.color.copy(paint.body === "kit" ? base : body.clone().lerp(grey, 0.45));
      else if (m.name === "accent") m.color.copy(paint.accent === "safety" ? base : acc);
    }
  });
  // decals on both flanks (each plane faces outward, so the text reads the right way round on both)
  if (paint.decal !== "none" && M.decal) {
    const mat = new THREE.MeshStandardMaterial({ map: decalTex(paint.decal, COLOUR[paint.accent].hex, paint.number), transparent: true, roughness: 0.6, alphaTest: 0.04, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const sx of [1, -1]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(M.decal.size[0], M.decal.size[1]), mat);
      d.position.set(sx * (M.decal.pos[0] + 0.004), M.decal.pos[1], M.decal.pos[2]); d.rotation.y = sx * Math.PI / 2; d.name = "decal"; d.frustumCulled = false;
      grp.add(d);
    }
  }
  return out;
}
