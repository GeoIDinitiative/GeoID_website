/**
 * THE CINEMATICS' SETS, PROPS AND EFFECTS (game/cinema.js uses them). Everything is procedural three.js:
 * no downloaded model, texture or image. Canvas textures for what is written or drawn (Alice's drawings,
 * the calendar, plaques, stencils, the advert), simple meshes for the rest.
 *
 *   buildSet(kind, params, ctx) -> { scene | group, anchors: { name: [x, y, z, yawDeg] }, update(dt, t), dispose(), interior }
 *     interior sets have their own THREE.Scene (rendered instead of the world while a shot is in them);
 *     exterior "dressing" sets are a THREE.Group placed in the world at the stage.
 *   makeProp(name, params) -> THREE.Object3D            (the torch, the drawing, the ice core, a helmet...)
 *   makeFx(name, params) -> { obj, update(dt), done }    (dust burst, smoke, sparks, retro glare, dust motes, light shafts)
 *   memoryize(root, { center, radius })                  a set as a reconstructed memory: its edges dissolve into points
 *
 * SETS. Interiors: lander (C01), bedroom (C01, memory), module (C04, C09, C12, C13, C18a: one hab module with its
 * props switched by params), tube (C10: the Arsia skylight, the drift, the airlock and Pioneer-3's room), biome (C06),
 * dome (C15, C16), apartment (C17), bay (C18b), beach and pier and garden (memories: C18b, C05, C02), interview
 * (C20, archive tape), hideout (C19), advert (C13, the 2059 broadcast), tunnel (C18a's service tunnel).
 * World dressing: drill_rig + ice scarp (C05), dune_ghost (C08's lander under the sand), gale_outpost (C09),
 * drones (C11's field of Gen-1 machines), city (C14 / C18a: lit domes to the horizon), sky_lights (the string of
 * HALO stations, the Covenant's braking burns, the second light), dust_drifts (C04's buried array), flare (C02).
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

const D2R = Math.PI / 180;
let SEED = 1;
const rnd = () => { SEED = (SEED * 16807) % 2147483647; return SEED / 2147483647; };
const seed = (s) => { SEED = (s >>> 0) % 2147483646 + 1; };

/* ── materials and canvas textures ──────────────────────────────────────────── */
/* a noise map already carries its colours: the material colour stays white so the two do not multiply into black */
const std = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: o.map && o.map.userData.tinted ? 0xffffff : c, roughness: 0.8, metalness: 0.05 }, o));
const glow = (c, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const TEX = new Map();
const tex = (k, f, tinted) => { if (!TEX.has(k)) { const t = f(); if (tinted) t.userData.tinted = true; TEX.set(k, t); } return TEX.get(k); };

/** Alice's drawing: a red planet, a stick man, DAD in wobbly capitals (each a little different). */
export function drawingTex(n = 0) {
  return tex("drawing" + n, () => canvasTex(256, 320, (g, w, h) => {
    seed(1000 + n * 77);
    g.fillStyle = "#f4efe2"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(120,110,90,0.25)"; for (let y = 30; y < h; y += 22) { g.beginPath(); g.moveTo(8, y); g.lineTo(w - 8, y); g.stroke(); }
    const cx = 128 + (rnd() - 0.5) * 20, cy = 120 + (rnd() - 0.5) * 16, r = 70 + rnd() * 10;
    g.fillStyle = "#c8432a"; g.beginPath();
    for (let a = 0; a <= 6.3; a += 0.25) { const rr = r * (0.94 + rnd() * 0.1); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.fill();
    g.strokeStyle = "#8a2a18"; g.lineWidth = 4; g.stroke();
    g.fillStyle = "#e07a3a"; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(cx + (rnd() - 0.5) * r, cy + (rnd() - 0.5) * r, 6 + rnd() * 10, 0, 7); g.fill(); }
    // the stick man, standing on it
    const sx = cx + 10, sy = cy - r - 6;
    g.strokeStyle = "#222"; g.lineWidth = 4; g.lineCap = "round";
    g.beginPath(); g.arc(sx, sy - 52, 11, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(sx, sy - 41); g.lineTo(sx, sy - 14); g.moveTo(sx, sy - 14); g.lineTo(sx - 10, sy); g.moveTo(sx, sy - 14); g.lineTo(sx + 10, sy);
    g.moveTo(sx - 14, sy - 32); g.lineTo(sx + 14, sy - 30); g.stroke();
    g.fillStyle = "#2a4fa0"; g.font = "bold 46px Comic Sans MS, Chalkboard, sans-serif"; g.textAlign = "center";
    const L = ["D", "A", "D"];
    L.forEach((ch, i) => { g.save(); g.translate(78 + i * 50, 270 + (rnd() - 0.5) * 14); g.rotate((rnd() - 0.5) * 0.4); g.fillText(ch, 0, 0); g.restore(); });
    g.fillStyle = "#f2c84b"; for (let i = 0; i < 5; i++) { const x = rnd() * w, y = 10 + rnd() * 40; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  }));
}
export function textTex(lines, o = {}) {
  const key = "txt:" + lines.join("|") + JSON.stringify(o);
  return tex(key, () => canvasTex(o.w || 512, o.h || 128, (g, w, h) => {
    g.fillStyle = o.bg || "#1a1712"; g.fillRect(0, 0, w, h);
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12); }
    g.fillStyle = o.fg || "#e8dcc0"; g.textAlign = "center"; g.textBaseline = "middle";
    const px = o.px || Math.min(h / (lines.length + 0.6), w / (Math.max(...lines.map((l) => l.length)) * 0.62));
    g.font = `${o.weight || 700} ${px}px ${o.font || '"Chakra Petch", "Exo 2", sans-serif'}`;
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * px * 1.15));
  }));
}
function panelTex() {
  return tex("panels", () => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#6c6e70"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#3e4042"; g.lineWidth = 3;
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = "#4a4c4e"; for (let i = 0; i < 40; i++) g.fillRect((i * 37) % w + 6, ((i * 91) % h) + 6, 3, 3);
  }, [3, 1]));
}
function noiseTex(a, b, k = 512, rep = [8, 8]) {
  return tex("noise" + a + b + k + rep, () => canvasTex(k, k, (g, w, h) => {
    const A = new THREE.Color(a), B = new THREE.Color(b);
    const id = g.createImageData(w, h); seed(7);
    for (let i = 0; i < w * h; i++) { const t = rnd() * 0.5 + 0.5 * Math.abs(Math.sin(i * 0.013) * Math.cos(i * 0.0007)); id.data[i * 4] = (A.r + (B.r - A.r) * t) * 255; id.data[i * 4 + 1] = (A.g + (B.g - A.g) * t) * 255; id.data[i * 4 + 2] = (A.b + (B.b - A.b) * t) * 255; id.data[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0);
  }, rep), true);
}

/* ── geometry helpers ──────────────────────────────────────────────────────── */
const M = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; };
const BOX = (w, h, d, mat, x, y, z, ry = 0) => M(new THREE.BoxGeometry(w, h, d), mat, x, y, z, 0, ry, 0);
function addLight(root, type, o) {
  let L;
  if (type === "point") { L = new THREE.PointLight(o.color ?? 0xffffff, o.intensity ?? 10, o.dist ?? 0, 2); }
  else if (type === "spot") { L = new THREE.SpotLight(o.color ?? 0xffffff, o.intensity ?? 20, o.dist ?? 0, (o.angle ?? 35) * D2R, o.pen ?? 0.5, 2); L.target.position.set(...(o.target || [0, 0, 0])); root.add(L.target); }
  else if (type === "dir") { L = new THREE.DirectionalLight(o.color ?? 0xffffff, o.intensity ?? 2); L.target.position.set(...(o.target || [0, 0, 0])); root.add(L.target); }
  else { L = new THREE.HemisphereLight(o.color ?? 0xffffff, o.ground ?? 0x202020, o.intensity ?? 1); }
  if (o.at) L.position.set(...o.at);
  L.name = o.name || type;
  root.add(L);
  return L;
}
/** Rough rock: an icosphere pushed about by a seeded noise. */
function rockGeo(r, s = 1, detail = 2) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position; seed(s);
  const off = [rnd() * 10, rnd() * 10, rnd() * 10];
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.18 * Math.sin(x * 3 + off[0]) * Math.cos(y * 2.6 + off[1]) + 0.1 * Math.sin(z * 5 + off[2]); p.setXYZ(i, x * k, y * k * 0.8, z * k); }
  g.computeVertexNormals(); return g;
}

/* ── memory: a remembered place rebuilt by the filter ──────────────────────── */
/** Patch every standard material under root: fragments dissolve with distance from center (noise), and add
 *  dust motes. Returns an update(dt) that animates both. */
export function memoryize(root, o = {}) {
  const C = new THREE.Vector3(...(o.center || [0, 1, 0])), R = o.radius || 5, uni = { uMemT: { value: 0 }, uMemC: { value: C }, uMemR: { value: R } };
  root.traverse((m) => {
    if (!m.isMesh || !m.material || m.material.userData.memorised || m.material.isShaderMaterial || m.userData.noMemory) return;
    const mat = m.material.clone(); mat.userData.memorised = true; mat.transparent = false;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMemW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvMemW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vMemW; uniform float uMemT, uMemR; uniform vec3 uMemC;\nfloat memH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }")
        .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n{ float d = length(vMemW - uMemC) / uMemR; float n = memH(floor(vMemW * 70.0) + floor(uMemT * 5.0)); if (n < smoothstep(0.72, 1.08, d) * 1.1) discard; }")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n{ float d = length(vMemW - uMemC) / uMemR; totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.32) * smoothstep(0.65, 1.0, d) * 0.7; }");
    };
    mat.customProgramCacheKey = () => "memoryize";
    m.material = mat;
  });
  // dust motes: slow, lit warm, drifting through the light
  const N = o.motes ?? 260, pos = new Float32Array(N * 3); seed(o.seed || 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = C.x + (rnd() - 0.5) * R * 1.6; pos[i * 3 + 1] = C.y - 1 + rnd() * 2.6; pos[i * 3 + 2] = C.z + (rnd() - 0.5) * R * 1.6; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(0xffd2a0).multiplyScalar(2.4), size: 0.022, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  motes.userData.noMemory = true; motes.frustumCulled = false;
  root.add(motes);
  return (dt) => {
    uni.uMemT.value += dt;
    const p = g.attributes.position;
    for (let i = 0; i < N; i++) { p.array[i * 3 + 1] += Math.sin(uni.uMemT.value * 0.3 + i) * 0.0008; p.array[i * 3] += Math.cos(uni.uMemT.value * 0.2 + i * 1.7) * 0.0006; }
    p.needsUpdate = true;
  };
}

/* ── props ─────────────────────────────────────────────────────────────────── */
export function makeProp(name, o = {}) {
  const g = new THREE.Group(); g.name = "prop:" + name;
  const metal = std(0x8d949c, { metalness: 0.7, roughness: 0.35 }), dark = std(0x2b2f35, { metalness: 0.4, roughness: 0.5 });
  switch (name) {
    case "torch": { g.add(M(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 12), dark, 0, 0, 0.05, Math.PI / 2)); g.add(M(new THREE.CylinderGeometry(0.008, 0.012, 0.09, 8), metal, 0, 0, 0.2, Math.PI / 2));
      const f = M(new THREE.ConeGeometry(0.02, 0.12, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6fb8ff).multiplyScalar(4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, 0.3, -Math.PI / 2); f.name = "flame"; f.visible = !!o.lit; g.add(f);
      if (o.lit) { const L = new THREE.PointLight(0x7fc4ff, 3, 4, 2); L.position.set(0, 0, 0.3); L.name = "flame-light"; g.add(L); }
      break; }
    case "drawing": { const p = M(new THREE.PlaneGeometry(0.21, 0.27), new THREE.MeshStandardMaterial({ map: drawingTex(o.n || 0), roughness: 0.9, side: THREE.DoubleSide }), 0, 0.02, 0.06, -Math.PI / 2 + 0.3); g.add(p); break; }
    case "core": { const m = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.75, emissive: 0x6688aa, emissiveIntensity: 0.25 });
      const c = M(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 16), m, 0.0, 0, 0.0, 0, 0, Math.PI / 2); g.add(c);
      for (let i = 0; i < 12; i++) g.add(M(new THREE.CylinderGeometry(0.046, 0.046, 0.012, 16), std(0x5a4636, { roughness: 1 }), -0.45 + i * 0.08, 0, 0, 0, 0, Math.PI / 2));
      break; }
    case "handset": { g.add(BOX(0.05, 0.2, 0.05, dark, 0, 0.02, 0.04)); g.add(M(new THREE.TorusGeometry(0.06, 0.006, 6, 18, Math.PI), dark, 0.0, -0.12, 0.04)); break; }
    case "wand": { g.add(M(new THREE.CylinderGeometry(0.025, 0.03, 0.34, 12), std(0xeef1f4), 0, 0, 0.12, Math.PI / 2)); const t = M(new THREE.SphereGeometry(0.03, 10, 8), glow(0x9fd0ff, 4), 0, 0, 0.3); t.name = "tip"; g.add(t); break; }
    case "spotlamp":
    case "lamp": { g.add(M(new THREE.CylinderGeometry(0.04, 0.05, 0.2, 12), dark, 0, 0, 0.06, Math.PI / 2)); g.add(M(new THREE.CircleGeometry(0.045, 16), glow(0xfff4e0, 5), 0, 0, 0.162)); const S = new THREE.SpotLight(0xf4f8ff, o.intensity ?? 60, 30, 26 * D2R, 0.45, 2); S.position.set(0, 0, 0.17); S.target.position.set(0, 0, 3); g.add(S, S.target); break; }
    case "helmet": { if (o.mesh) { const h = o.mesh.clone(); h.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.frustumCulled = false; } }); g.add(h); } else g.add(M(new THREE.SphereGeometry(0.17, 18, 12), std(0xe8e8e8))); break; }
    case "crate": { g.add(BOX(0.9, 0.55, 0.6, std(0x6d6a60, { roughness: 0.9 }), 0, 0.275, 0)); g.add(BOX(0.92, 0.05, 0.62, std(0x3e3d38), 0, 0.53, 0)); break; }
    case "notebook": { g.add(BOX(0.17, 0.02, 0.23, std(o.color ?? 0x4a3f2e, { roughness: 0.95 }), 0, 0, 0)); break; }
    case "rock_hammer": { g.add(M(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), std(0x7a5536), 0, -0.1, 0.04)); g.add(BOX(0.12, 0.035, 0.035, metal, 0, 0.04, 0.04)); break; }
    case "shoes": { for (const s of [-1, 1]) g.add(BOX(0.09, 0.08, 0.24, std(0x3a2a20), s * 0.05, -0.1, 0.03)); break; }
    case "paper_sheet": { g.add(M(new THREE.PlaneGeometry(0.21, 0.27), new THREE.MeshStandardMaterial({ map: drawingTex(o.n || 3), side: THREE.DoubleSide, roughness: 0.9 }), 0, 0.12, 0.03)); break; }
    case "recall_tag": { g.add(BOX(0.09, 0.05, 0.008, std(0xff7a1a, { emissive: 0x401800, roughness: 0.5 }), 0.06, -0.02, 0.008)); break; }
    default: g.add(BOX(0.1, 0.1, 0.1, std(0x888888)));
  }
  g.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
  return g;
}

/* ── effects ────────────────────────────────────────────────────────────────── */
const SOFT = () => tex("soft", () => canvasTex(64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.4, "rgba(255,255,255,0.45)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); }));
/** Short-lived effects. Each returns { obj, update(dt) -> alive }. */
export function makeFx(name, o = {}) {
  const obj = new THREE.Group(); obj.name = "fx:" + name;
  let t = 0;
  if (name === "dust" || name === "smoke" || name === "sparks" || name === "steam") {
    const N = o.n ?? (name === "sparks" ? 40 : 26), parts = [];
    const col = new THREE.Color(o.color ?? (name === "smoke" ? 0x4a3f38 : name === "sparks" ? 0xffd9a0 : name === "steam" ? 0xd8e6f0 : 0xb98a63));
    for (let i = 0; i < N; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT(), color: name === "sparks" ? col.clone().multiplyScalar(4) : col, transparent: true, depthWrite: false, opacity: 0, blending: name === "sparks" ? THREE.AdditiveBlending : THREE.NormalBlending }));
      const a = rnd() * Math.PI * 2, up = name === "smoke" || name === "steam" ? 0.4 + rnd() * 0.5 : name === "sparks" ? 1 + rnd() * 2 : 0.15 + rnd() * 0.4;
      const v = new THREE.Vector3(Math.cos(a) * (o.spread ?? 1.6) * (0.3 + rnd()), up * (o.up ?? 1), Math.sin(a) * (o.spread ?? 1.6) * (0.3 + rnd()));
      obj.add(sp); parts.push({ sp, v, life: (o.life ?? (name === "sparks" ? 0.8 : 4)) * (0.6 + rnd() * 0.8), delay: rnd() * (o.over ?? 0.4), size: (o.size ?? (name === "sparks" ? 0.04 : 1.2)) * (0.6 + rnd() * 0.8) });
    }
    const g = name === "sparks" ? 3.71 : 0.25;
    return { obj, update(dt) {
      t += dt; let alive = false;
      for (const p of parts) {
        const k = (t - p.delay) / p.life;
        if (k < 0 || k > 1) { p.sp.visible = k < 0; p.sp.material.opacity = 0; if (k < 0) alive = true; continue; }
        alive = true; p.sp.visible = true;
        p.v.y -= g * dt; p.v.multiplyScalar(1 - dt * (name === "sparks" ? 0.2 : 0.6));
        p.sp.position.addScaledVector(p.v, dt);
        const s = p.size * (name === "sparks" ? 1 : 0.4 + 1.6 * Math.sqrt(k)); p.sp.scale.set(s, s, 1);
        p.sp.material.opacity = (name === "sparks" ? 1 : 0.55) * (1 - k) * Math.min(1, k * 8);
      }
      return alive || t < 0.1;
    } };
  }
  if (name === "glare") {          // a retro burn or a lamp seen head-on
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT(), color: new THREE.Color(o.color ?? 0xffa040).multiplyScalar(o.k ?? 8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(o.size ?? 6); obj.add(s);
    const L = new THREE.PointLight(o.color ?? 0xffa040, o.light ?? 200, o.dist ?? 80, 2); obj.add(L);
    const dur = o.dur ?? 2;
    return { obj, update(dt) { t += dt; const k = Math.min(1, t / 0.15) * Math.max(0, 1 - Math.max(0, t - dur + 0.6) / 0.6); const fl = o.blink ? ((t % o.blink) < o.blink * 0.45 ? 1 : 0) : 0.85 + 0.15 * Math.sin(t * 40); s.material.opacity = k * fl; L.intensity = (o.light ?? 200) * k * fl; if (o.fall) obj.position.y -= o.fall * dt; return t < dur; } };
  }
  if (name === "streak") {         // something burning in: a point that brightens and lengthens across the sky
    const from = new THREE.Vector3(...(o.from || [0, 300, -300])), to = new THREE.Vector3(...(o.to || [0, 60, 0])), dur = o.dur ?? 8;
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT(), color: new THREE.Color(o.color ?? 0xfff0d0).multiplyScalar(8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.trail ?? 0xffb070).multiplyScalar(3), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.15, 1, 8, 1, true), tm);
    obj.add(head, trail); obj.position.set(0, 0, 0);
    const p = new THREE.Vector3(), q = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    return { obj, update(dt) {
      t += dt; const k = Math.min(1, t / dur), e = k * k;
      p.lerpVectors(from, to, e);
      head.position.copy(p); const s = (o.size ?? 6) * (0.3 + 1.4 * k); head.scale.setScalar(s);
      const len = (o.length ?? 120) * Math.min(1, k * 2.5) * (1 - Math.max(0, k - 0.85) * 4);
      q.copy(from).sub(to).normalize();
      trail.position.copy(p).addScaledVector(q, len / 2); trail.scale.set(s * 0.12, Math.max(0.01, len), s * 0.12);
      trail.quaternion.setFromUnitVectors(up, q);
      tm.opacity = 0.8 * Math.min(1, k * 3);
      return t < dur + 0.2;
    } };
  }
  if (name === "shaft") {          // a shaft of dusty light (the skylight, a porthole)
    const h = o.h ?? 10, r0 = o.r0 ?? 1.5, r1 = o.r1 ?? 3;
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color ?? 0xffd6a0).multiplyScalar(o.k ?? 0.35), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const c = M(new THREE.CylinderGeometry(r0, r1, h, 24, 1, true), m, 0, -h / 2, 0); obj.add(c);
    return { obj, update(dt) { t += dt; m.opacity = 0.85 + 0.15 * Math.sin(t * 0.7); return true; } };
  }
  return { obj, update() { return false; } };
}

/** The rover's cab, from inside: seat, yoke, dash (NO RADIO taped to it), windscreen struts, side glass. Origin: the cab floor
 *  under the driver's seat; the windscreen is ahead (-z). */
function cabGroup(o = {}) {
  const g = new THREE.Group(), dark = std(0x23262a, { roughness: 0.6 }), trim = std(0x8a8e92, { metalness: 0.5, roughness: 0.4 });
  g.add(BOX(1.9, 0.08, 2.4, std(0x2e3134), 0, 0, 0.2));
  g.add(BOX(0.56, 0.12, 0.55, std(0x3a3f45), 0, 0.46, 0.1)); const bk = BOX(0.56, 0.75, 0.1, std(0x3a3f45), 0, 0.85, 0.42); bk.rotation.x = -0.15; g.add(bk);
  g.add(BOX(1.8, 0.45, 0.5, dark, 0, 0.82, -0.95));
  const scr = M(new THREE.PlaneGeometry(0.4, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x5fd0ff).multiplyScalar(0.9) }), -0.45, 1.06, -0.73, -0.6, 0, 0); g.add(scr);
  const st = M(new THREE.PlaneGeometry(0.28, 0.07), new THREE.MeshStandardMaterial({ map: textTex(["NO RADIO"], { bg: "#e8e2c8", fg: "#2a2418", w: 256, h: 64, font: "Comic Sans MS, Chalkboard, sans-serif" }), roughness: 0.9 }), 0.35, 1.07, -0.74, -0.6, 0, 0.05); st.name = "no-radio"; g.add(st);
  g.add(M(new THREE.TorusGeometry(0.17, 0.025, 8, 20), trim, 0, 1.05, -0.62, -0.9, 0, 0));
  for (const x of [-0.9, 0.9]) { const p = BOX(0.08, 1.1, 0.08, dark, x, 1.55, -1.0); p.rotation.x = 0.35; g.add(p); }
  g.add(BOX(1.9, 0.1, 0.12, dark, 0, 2.1, -0.75)); g.add(BOX(1.9, 0.08, 1.8, dark, 0, 2.15, 0.2));
  for (const x of [-0.98, 0.98]) { g.add(BOX(0.06, 0.6, 2.2, dark, x, 0.6, 0.2)); g.add(M(new THREE.PlaneGeometry(2.0, 0.9), new THREE.MeshStandardMaterial({ color: 0x223040, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.5, side: THREE.DoubleSide, depthWrite: false }), x, 1.4, 0.2, 0, Math.PI / 2, 0)); }
  const pod = o.handsetMount !== false ? BOX(0.12, 0.2, 0.08, dark, 0.7, 1.25, -0.7) : null; if (pod) g.add(pod);
  return g;
}

/* ── the sets ──────────────────────────────────────────────────────────────── */
function interior(bg = 0x050505, fog = null) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(bg);
  if (fog) scene.fog = new THREE.Fog(fog[0], fog[1], fog[2]);
  return scene;
}
function stars(n = 900, r = 200, ymin = 0.05) {
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3); seed(99);
  for (let i = 0; i < n; i++) { const a = rnd() * 6.283, y = ymin + rnd() * (1 - ymin), s = Math.sqrt(1 - y * y); p.set([Math.cos(a) * s * r, y * r, Math.sin(a) * s * r], i * 3); const k = 0.6 + rnd() * 2.4; c.set([k, k * (0.92 + rnd() * 0.1), k * (0.9 + rnd() * 0.15)], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false })); pts.frustumCulled = false; pts.userData.noMemory = true;
  return pts;
}

const SETS = {
  /* C01: inside the lander on entry: a cramped cabin, a porthole full of plasma */
  lander(p) {
    const scene = interior(0x020202), root = new THREE.Group(); scene.add(root);
    const wall = std(0x4c4e50, { map: panelTex(), roughness: 0.7, side: THREE.BackSide });
    root.add(M(new THREE.CylinderGeometry(1.45, 1.6, 2.6, 24, 1, true), wall, 0, 1.3, 0));
    root.add(M(new THREE.CircleGeometry(1.6, 24), std(0x2a2b2d), 0, 0.001, 0, -Math.PI / 2));
    root.add(M(new THREE.CircleGeometry(1.45, 24), std(0x1c1d1f), 0, 2.6, 0, Math.PI / 2));
    // the seat, reclined, with its harness posts
    const seat = std(0x26292d, { roughness: 0.6 });
    root.add(BOX(0.62, 0.12, 0.7, seat, 0, 0.5, 0.05)); const back = BOX(0.62, 1.0, 0.12, seat, 0, 1.0, 0.45); back.rotation.x = -0.42; root.add(back);
    for (const s of [-1, 1]) root.add(BOX(0.08, 0.3, 0.55, seat, s * 0.36, 0.72, 0.08));
    for (const s of [-1, 1]) { const st = BOX(0.035, 0.5, 0.012, std(0x3a3020), s * 0.12, 1.25, -0.02); st.rotation.x = -0.35; root.add(st); }
    // the porthole: plasma flowing past
    const pm = new THREE.ShaderMaterial({ uniforms: { t: { value: 0 }, k: { value: 1 } }, vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform float t, k; varying vec2 vUv; float h(vec2 p){return fract(sin(dot(p,vec2(12.9,78.2)))*43758.5);} float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);} void main(){ vec2 q=vUv*vec2(3.0,6.0); q.y+=t*3.5; float v=n(q)*0.6+n(q*2.3+vec2(t,0.0))*0.4; vec3 c=mix(vec3(1.0,0.25,0.02),vec3(1.0,0.9,0.6),v*v); float r=length(vUv-0.5)*2.0; gl_FragColor=vec4(c*(6.0*k)*(1.0-r*0.4),1.0);} " });
    const port = M(new THREE.CircleGeometry(0.28, 32), pm, 0.55, 1.62, -1.32); port.lookAt(0, 1.4, 0); root.add(port);
    { const rim = M(new THREE.TorusGeometry(0.3, 0.04, 10, 32), std(0x9aa0a6, { metalness: 0.7 }), 0.55, 1.62, -1.31); rim.lookAt(0, 1.4, 0); root.add(rim); }
    const fire = addLight(root, "point", { color: 0xff7a2a, intensity: 18, dist: 8, at: [0.48, 1.6, -1.05], name: "plasma" });
    // the instrument panel and its lights
    const panel = BOX(1.1, 0.5, 0.08, std(0x1c1e21), -0.2, 1.55, -1.28); panel.lookAt(0, 1.5, 0); root.add(panel);
    for (let i = 0; i < 18; i++) { const l = M(new THREE.CircleGeometry(0.012, 8), glow(i % 5 === 0 ? 0xff3020 : 0x40ff90, 3), -0.6 + (i % 9) * 0.1, 1.45 + Math.floor(i / 9) * 0.15, -1.22); l.lookAt(0, 1.5, 0); root.add(l); }
    const warn = M(new THREE.SphereGeometry(0.03, 10, 8), glow(0xff2a10, 6), 0.0, 2.2, -1.25); warn.name = "warning"; warn.visible = false; root.add(warn);
    const warnL = addLight(root, "point", { color: 0xff2010, intensity: 0, dist: 4, at: [0, 2.1, -1.0], name: "warning-light" });
    addLight(root, "hemi", { color: 0x40302a, ground: 0x0a0806, intensity: 0.6 });
    // a cold cabin light overhead and the panel's glow on the suit, so the white of it reads against the fire
    addLight(root, "point", { color: 0xc8d8ff, intensity: 4, dist: 4, at: [-0.5, 2.35, 0.7], name: "dome" });
    addLight(root, "point", { color: 0x7fe0c8, intensity: 1.6, dist: 2.5, at: [-0.2, 1.5, -0.9], name: "panel" });
    let t = 0;
    return { scene, root, interior: true, anchors: { seat: [0, 0.03, 0.12, 180], port: [0.55, 1.62, -1.32, 0] },
      update(dt) { t += dt; pm.uniforms.t.value = t; const on = p.state !== "landed"; pm.uniforms.k.value = on ? 1 : 0.02; fire.intensity = on ? 14 + 6 * Math.sin(t * 23) * Math.sin(t * 7.1) : 0; warn.visible = p.state === "landed" && (t % 1.4) < 0.7; warnL.intensity = warn.visible ? 6 : 0; },
      set(k, v) { p[k] = v; } };
  },

  /* C01 (memory): Alice's bedroom in Galway at night, rebuilt by the filter */
  bedroom(p) {
    const scene = interior(0x060404, [0x0c0806, 3, 9]), root = new THREE.Group(); scene.add(root);
    const wall = std(0x8a7a6a, { roughness: 0.95 }), floor = std(0x5a4636, { roughness: 0.9 });
    root.add(M(new THREE.PlaneGeometry(4, 3.6), floor, 0, 0, 0, -Math.PI / 2));
    root.add(M(new THREE.PlaneGeometry(4, 2.6), wall, 0, 1.3, -1.8)); root.add(M(new THREE.PlaneGeometry(3.6, 2.6), wall, -2, 1.3, 0, 0, Math.PI / 2)); root.add(M(new THREE.PlaneGeometry(3.6, 2.6), wall, 2, 1.3, 0, 0, -Math.PI / 2));
    // the bed and the duvet over Alice
    root.add(BOX(1.0, 0.4, 2.0, std(0x6a5040), -1.3, 0.2, -0.7)); root.add(BOX(1.02, 0.18, 0.08, std(0x5a4030), -1.3, 0.55, -1.7));
    const duvet = M(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd8c0a8, { roughness: 1 }), -1.3, 0.4, -0.55); duvet.scale.set(0.48, 0.24, 0.95); root.add(duvet);
    { const pil = M(new THREE.SphereGeometry(1, 16, 10), std(0xf0e6da, { roughness: 1 }), -1.3, 0.5, -1.45); pil.scale.set(0.3, 0.09, 0.18); root.add(pil); }
    // the window: night, the stars, a small red point low in the sky
    const win = M(new THREE.PlaneGeometry(0.9, 1.1), new THREE.MeshBasicMaterial({ color: 0x0a1020 }), 0.6, 1.5, -1.79); root.add(win);
    const frame = new THREE.Group(); for (const [w, h, x, y] of [[0.96, 0.05, 0, 0.55], [0.96, 0.05, 0, -0.55], [0.05, 1.1, -0.46, 0], [0.05, 1.1, 0.46, 0], [0.9, 0.03, 0, 0], [0.03, 1.1, 0, 0]]) frame.add(BOX(w, h, 0.04, std(0xe8e0d0), x, y, 0)); frame.position.set(0.6, 1.5, -1.77); root.add(frame);
    const mars = M(new THREE.SphereGeometry(0.012, 8, 6), glow(0xff5030, 6), 0.78, 1.32, -1.78); mars.name = "mars"; root.add(mars);
    seed(5); for (let i = 0; i < 40; i++) root.add(M(new THREE.SphereGeometry(0.003 + rnd() * 0.003, 4, 3), glow(0xffffff, 2 + rnd() * 3), 0.2 + rnd() * 0.8, 1.0 + rnd() * 1.0, -1.785));
    // the door: a line of light under it
    root.add(BOX(0.9, 2.05, 0.05, std(0x7a6a58), 1.98, 1.03, 0.8, Math.PI / 2));
    root.add(M(new THREE.PlaneGeometry(0.86, 0.03), glow(0xffc070, 5), 1.95, 0.015, 0.8, 0, -Math.PI / 2));
    addLight(root, "point", { color: 0xffb060, intensity: 5, dist: 6, at: [1.8, 0.1, 0.8], name: "door" });
    addLight(root, "point", { color: 0xffc890, intensity: 5, dist: 4, at: [-0.5, 1.1, -1.5], name: "nightlight" });
    root.add(M(new THREE.SphereGeometry(0.06, 10, 8), glow(0xffd8a0, 3), -0.5, 0.95, -1.62));
    // drawings on the wall, a lamp off, a shelf
    for (let i = 0; i < 3; i++) root.add(M(new THREE.PlaneGeometry(0.21, 0.27), new THREE.MeshStandardMaterial({ map: drawingTex(i), roughness: 1 }), -0.6 + i * 0.3, 1.5 + (i % 2) * 0.1, -1.79, 0, 0, (i - 1) * 0.06));
    const moon = addLight(root, "spot", { color: 0xb8c4ff, intensity: 3, dist: 8, angle: 30, at: [0.6, 2.2, -2.6], target: [-1.2, 0.4, -0.6], name: "window" });
    addLight(root, "hemi", { color: 0x6a4a36, ground: 0x1a0e08, intensity: 0.6 });
    const upd = memoryize(root, { center: [-0.4, 1.0, -0.6], radius: 3.6 });
    return { scene, root, interior: true, memory: true, anchors: { bed: [-1.3, 0.42, -0.6, 90], bedside: [-0.62, 0.0, -0.4, -90], window: [0.6, 1.5, -1.8, 0], door: [1.95, 0, 0.8, -90] }, update: (dt) => upd(dt), lights: { moon } };
  },

  /* the hab module: C04 (the bunk, the storm light), C09 (Pioneer-5's, the calendar), C12 / C13 (the terminal, ANVIL's work light
     through the porthole, the advert on the screen), C18a (ANVIL's broom on the wall, the welding torch on its bracket) */
  module(p) {
    const scene = interior(0x030304), root = new THREE.Group(); scene.add(root);
    const L = 5.2, R = 1.45;
    const shell = std(0xb8b2a6, { map: panelTex(), roughness: 0.75, side: THREE.BackSide });
    const cyl = M(new THREE.CylinderGeometry(R, R, L, 28, 1, true, 0, Math.PI * 2), shell, 0, R, 0, Math.PI / 2, 0, 0); root.add(cyl);
    root.add(BOX(2.4, 0.08, L, std(0x3a3c3e, { roughness: 0.9 }), 0, 0.35, 0));
    // the end walls: the porthole (-z) and the airlock door (+z)
    const endM = std(0x9a958c, { roughness: 0.8 });
    const ring = new THREE.RingGeometry(0.34, R, 32);
    root.add(M(ring, endM, 0, R, -L / 2, 0, 0, 0)); root.add(M(new THREE.CircleGeometry(R, 32), endM, 0, R, L / 2, 0, Math.PI, 0));
    root.add(M(new THREE.TorusGeometry(0.36, 0.05, 10, 32), std(0x70757a, { metalness: 0.6 }), 0, R, -L / 2 + 0.02));
    // what the porthole shows
    const ext = new THREE.Group(); ext.position.set(0, R, -L / 2 - 0.05); root.add(ext);
    const view = p.porthole || "night";
    const bg = M(new THREE.CircleGeometry(0.36, 32), new THREE.MeshBasicMaterial({ color: view === "storm" ? 0x5a3a20 : view === "day" ? 0xc89a6a : 0x04060c }), 0, 0, -0.02); ext.add(bg);
    if (view === "night" || view === "anvil") { seed(11); for (let i = 0; i < 30; i++) ext.add(M(new THREE.SphereGeometry(0.003, 4, 3), glow(0xffffff, 2 + rnd() * 2), (rnd() - 0.5) * 0.5, (rnd() - 0.2) * 0.5, -0.01)); }
    let work = null;
    if (view === "anvil") {   // ANVIL on the dome frames: a rib, a moving work light, its tag
      const rib = M(new THREE.TorusGeometry(0.5, 0.006, 6, 40, Math.PI * 0.8), glow(0x6a7a8a, 0.6), 0.1, -0.35, -0.015); rib.rotation.z = 0.2; ext.add(rib);
      work = M(new THREE.SphereGeometry(0.008, 8, 6), glow(0xffd090, 8), 0, 0, -0.012); ext.add(work);
    }
    const portLight = addLight(root, "point", { color: view === "storm" ? 0xb07040 : view === "day" ? 0xffd4a0 : 0x4060a0, intensity: view === "day" || view === "storm" ? 8 : 1.5, dist: 6, at: [0, R, -L / 2 + 0.6], name: "porthole" });
    // ceiling strip lights
    const strip = glow(0xfff2dc, p.dark ? 0.6 : 2.4);
    root.add(BOX(0.12, 0.02, L * 0.8, strip, 0, 2.86, 0));
    const ceiling = addLight(root, "point", { color: 0xffe6c8, intensity: p.dark ? 3.5 : 9, dist: 7, at: [0, 2.6, -0.6], name: "ceiling" });
    addLight(root, "point", { color: 0xffe6c8, intensity: p.dark ? 2.2 : 5, dist: 6, at: [0, 2.6, 1.5], name: "ceiling2" });
    addLight(root, "hemi", { color: 0x6a6258, ground: 0x1a1612, intensity: p.dark ? 0.45 : 0.6 });
    // the bunk (+x side) and the desk with the terminal (-x side)
    root.add(BOX(0.8, 0.12, 2.0, std(0x4a5560), 0.95, 0.75, 0.6)); root.add(BOX(0.75, 0.14, 1.9, std(0xc8c2b4, { roughness: 1 }), 0.95, 0.86, 0.6));
    root.add(BOX(0.8, 0.06, 0.9, std(0x3a3c40), -0.95, 1.05, -0.9));
    const scr = new THREE.MeshBasicMaterial({ color: 0xffffff, map: textTex(["KEEPER", "PIONEER-1 · TERMINAL", "_"], { fg: "#7fe0ff", bg: "#06141a", w: 512, h: 320 }) });
    const screen = M(new THREE.PlaneGeometry(0.62, 0.4), scr, -1.12, 1.45, -0.9, 0, Math.PI / 2, 0); screen.name = "screen"; root.add(screen);
    root.add(BOX(0.04, 0.46, 0.68, std(0x1a1c1f), -1.15, 1.45, -0.9));
    const scrLight = addLight(root, "point", { color: 0x6fd8ff, intensity: 2.5, dist: 3, at: [-0.7, 1.45, -0.9], name: "screen" });
    root.add(BOX(0.45, 0.45, 0.45, std(0x3a3c40), -0.55, 0.62, -0.4));    // a stool
    // the calendar, the drawing behind the terminal, the broom and the torch
    if (p.calendar) root.add(M(new THREE.PlaneGeometry(0.42, 0.56), new THREE.MeshStandardMaterial({ map: calendarTex(), roughness: 1 }), 1.32, 1.55, 1.75, 0, -Math.PI / 2 + 0.25, 0));
    if (p.drawing) { const d = M(new THREE.PlaneGeometry(0.21, 0.27), new THREE.MeshStandardMaterial({ map: drawingTex(0), roughness: 1 }), -1.14, 1.32, -0.48, 0, Math.PI / 2, 0.08); d.name = "drawing"; root.add(d); }
    if (p.broom) { root.add(M(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 8), std(0xb0b4b8, { metalness: 0.5 }), 1.3, 1.5, -1.6, 0, 0, 0.2)); root.add(BOX(0.32, 0.1, 0.06, std(0xd8d0b8, { roughness: 1 }), 1.18, 0.9, -1.6)); }
    if (p.torch) { const tb = BOX(0.06, 0.18, 0.12, std(0x2a2c30), -1.36, 1.85, 0.2); root.add(tb); const tt = makeProp("torch"); tt.position.set(-1.3, 1.85, 0.2); tt.rotation.set(0, -Math.PI / 2, 0); tt.name = "bracket-torch"; root.add(tt); }
    return { scene, root, interior: true, anchors: { bunk: [0.95, 0.42, 0.6, -90], desk: [-0.45, 0.39, -0.9, -90], porthole: [0, R, -L / 2, 0], door: [0, 0.39, 2.2, 180], calendar: [1.3, 1.55, 1.75, -60], bracket: [-1.3, 1.85, 0.2, 90], mid: [0, 0.39, 0, 0] },
      lights: { portLight, ceiling, scrLight }, screen, work,
      update(dt, t) { if (work) { const k = (t * 0.05) % 1; work.position.set(-0.32 + 0.5 * Math.min(1, k * 1.2), -0.3 + 0.5 * Math.sin(Math.min(1, k * 1.2) * 1.4), -0.012); if (p.workStop) work.position.set(0.18, 0.12, -0.012); } if (p.flicker) scrLight.intensity = 2 + Math.sin(t * 31) * 0.6 * Math.sin(t * 7); },
      /** "screen": lines of text on the terminal (KEEPER's answers), or "advert": the broadcast's colours */
      set(k, v) { p[k] = v; if (k === "screen") { scr.map = textTex([].concat(v), { fg: "#7fe0ff", bg: "#06141a", w: 512, h: 320, px: 30 }); scr.needsUpdate = true; } if (k === "advert") { scr.map = textTex(["CITIES IN THE SKY", "A MERIDIAN INITIATIVE"], { fg: "#ffe0b0", bg: "#8a3020", w: 512, h: 320 }); scr.needsUpdate = true; scrLight.color.set(0xffa070); } } };
  },

  /* C10: Arsia. The collapsed skylight into a lava tube, the drift and the frame in it, the airlock, and the room */
  tube(p) {
    const scene = interior(0x020101, [0x0a0705, 8, 60]), root = new THREE.Group(); scene.add(root);
    const basalt = std(0x2c2724, { map: noiseTex(0x1c1816, 0x3a332e, 256, [6, 6]), roughness: 0.95 });
    // the tube: a long rough cylinder, the floor a sand drift
    const g = new THREE.CylinderGeometry(7, 7, 60, 40, 30, true), P = g.attributes.position; seed(4);
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 1 + 0.12 * Math.sin(y * 0.6 + x) * Math.cos(z * 0.8) + 0.05 * Math.sin(y * 2.1 + z * 1.7); P.setXYZ(i, x * k, y, z * k); }
    g.computeVertexNormals();
    root.add(M(g, new THREE.MeshStandardMaterial({ color: 0x2c2724, map: basalt.map, roughness: 0.95, side: THREE.BackSide }), 0, 4.5, -10, Math.PI / 2, 0, 0));
    const sand = std(0x9a7458, { map: noiseTex(0x8a6448, 0xa8846a, 256, [10, 10]), roughness: 1 });
    const fl = new THREE.PlaneGeometry(14, 60, 40, 80), F = fl.attributes.position;
    for (let i = 0; i < F.count; i++) { const x = F.getX(i), y = F.getY(i); F.setZ(i, 0.6 * Math.exp(-((y + 10) ** 2) / 40) * (1 - Math.abs(x) / 7) + 0.08 * Math.sin(x * 2 + y)); }
    fl.computeVertexNormals(); root.add(M(fl, sand, 0, 0, -10, -Math.PI / 2, 0, 0));
    // the skylight: the hole above the drift, the shaft of dust-lit sun
    const sky = M(new THREE.CircleGeometry(3.6, 32), glow(0xd8a070, 2.2), 0, 11.4, -10, Math.PI / 2, 0, 0); root.add(sky);
    const shaft = makeFx("shaft", { h: 11.5, r0: 3.2, r1: 4.0, k: 0.035 }); shaft.obj.position.set(0, 11.4, -10); root.add(shaft.obj);
    const sun = addLight(root, "spot", { color: 0xfff0e0, intensity: 700, dist: 40, angle: 22, pen: 0.6, at: [0, 18, -10.5], target: [0, 0, -10], name: "skylight" });
    addLight(root, "hemi", { color: 0x806450, ground: 0x2a1a10, intensity: 0.7 });
    addLight(root, "point", { color: 0xffb070, intensity: 70, dist: 22, at: [0, 1.5, -10], name: "bounce" });
    // the line down, from the rim
    root.add(M(new THREE.CylinderGeometry(0.012, 0.012, 11.5, 6), std(0xd04020), 1.6, 5.7, -11.2));
    // the airlock in the tube wall, the stencil over it
    const wallZ = 2.5;
    root.add(BOX(8, 4.4, 0.6, basalt, 0, 2.2, wallZ));
    root.add(BOX(1.4, 2.2, 0.3, std(0x6a6c6e, { metalness: 0.5, roughness: 0.5 }), 0, 1.1, wallZ - 0.32));
    const win = M(new THREE.CircleGeometry(0.16, 20), new THREE.MeshBasicMaterial({ color: 0x0a0c10, transparent: true, opacity: 0.35 }), 0.3, 1.6, wallZ - 0.48); root.add(win);
    root.add(M(new THREE.PlaneGeometry(2.6, 0.4), new THREE.MeshStandardMaterial({ map: textTex(["OUTPOST ARSIA · EST. 2061 · PIONEER-3"], { bg: "#4a4844", fg: "#e8e2d0", w: 1024, h: 128 }), roughness: 0.9 }), 0, 2.55, wallZ - 0.31, 0, Math.PI, 0));
    const doorL = addLight(root, "point", { color: 0xffe0b0, intensity: 12, dist: 7, at: [0, 2.6, wallZ - 1.4], name: "door" });
    root.add(M(new THREE.SphereGeometry(0.07, 10, 8), glow(0xfff0d0, 4), 0, 2.85, wallZ - 0.5));
    // the cable from the frame in the sand to the door
    const cab = new THREE.CatmullRomCurve3([new THREE.Vector3(0.4, 0.55, -10.2), new THREE.Vector3(0.8, 0.3, -6), new THREE.Vector3(0.3, 0.12, -1), new THREE.Vector3(0.1, 0.2, wallZ - 0.5)]);
    root.add(new THREE.Mesh(new THREE.TubeGeometry(cab, 40, 0.025, 6), std(0x18191a)));
    // the room behind the door (z > wallZ): a table set for one, rations to the ceiling, the drawings, the cot, the suit on its hook, the rack
    const room = new THREE.Group(); room.position.set(0, 0, wallZ + 3.5); root.add(room);
    const rw = std(0xb4aea2, { map: panelTex(), roughness: 0.8, side: THREE.BackSide });
    room.add(BOX(5, 2.6, 7, rw, 0, 1.3, 0));
    room.add(BOX(1.2, 0.05, 0.8, std(0x8a8478), -1.2, 0.78, -1.6)); room.add(BOX(0.06, 0.78, 0.06, std(0x5a5650), -1.2, 0.39, -1.6));
    room.add(BOX(0.24, 0.02, 0.24, std(0xe8e4dc), -1.0, 0.82, -1.5)); room.add(BOX(0.04, 0.01, 0.2, std(0x9a9a9a, { metalness: 0.6 }), -0.84, 0.81, -1.5));
    const packs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.2, 0.22), std(0x8a8a5a, { roughness: 0.9 }), 240); let k = 0; const mm = new THREE.Matrix4();
    for (let col = 0; col < 8; col++) for (let row = 0; row < 12; row++) for (let d = 0; d < 2; d++) { if (k >= 240) break; mm.makeTranslation(1.8 - d * 0.24, 0.1 + row * 0.205, -3.2 + col * 0.31); packs.setMatrixAt(k++, mm); }
    packs.count = k; room.add(packs);
    const dm = []; for (let i = 0; i < 6; i++) dm.push(new THREE.MeshStandardMaterial({ map: drawingTex(i), roughness: 1 }));
    seed(21);
    for (let i = 0; i < 70; i++) { const side = i % 3, m = M(new THREE.PlaneGeometry(0.21, 0.27), dm[i % 6]); const u = rnd(), v = rnd();
      if (side === 0) m.position.set(-2.48, 0.5 + v * 1.9, -3.2 + u * 6.2), m.rotation.set(0, Math.PI / 2, (rnd() - 0.5) * 0.15);
      else if (side === 1) m.position.set(-2.0 + u * 2.8, 0.5 + v * 1.9, -3.48), m.rotation.set(0, 0, (rnd() - 0.5) * 0.15);
      else m.position.set(-1.6 + u * 3.0, 0.5 + v * 1.9, 3.48), m.rotation.set(0, Math.PI, (rnd() - 0.5) * 0.15);
      room.add(m); }
    room.add(BOX(0.8, 0.3, 1.9, std(0x4a5048), 1.4, 0.3, 2.2)); room.add(BOX(0.76, 0.06, 1.86, std(0xcfc8b8), 1.4, 0.48, 2.2));
    room.add(BOX(0.05, 0.05, 0.25, std(0x888888, { metalness: 0.6 }), -2.4, 2.0, 2.6));
    // the server rack, its screen, its breaker
    room.add(BOX(0.7, 2.0, 0.6, std(0x1c1e20, { metalness: 0.3 }), -0.2, 1.0, 3.05));
    for (let i = 0; i < 8; i++) room.add(M(new THREE.PlaneGeometry(0.5, 0.015), glow(i % 2 ? 0x30ff80 : 0x30c0ff, 1.5), -0.2, 0.25 + i * 0.12, 2.74, 0, Math.PI, 0));
    const rs = new THREE.MeshBasicMaterial({ map: drawingTex(0), color: 0xffffff });
    const rscreen = M(new THREE.PlaneGeometry(0.5, 0.36), rs, -0.2, 1.75, 2.74, 0, Math.PI, 0); rscreen.name = "rack-screen"; room.add(rscreen);
    const breaker = new THREE.Group(); breaker.position.set(0.18, 1.35, 2.9); room.add(breaker);
    breaker.add(BOX(0.1, 0.22, 0.12, std(0x3a3a3a), 0, 0, 0)); const lever = BOX(0.03, 0.14, 0.03, std(0xd04020), 0.02, 0.08, -0.07); lever.name = "lever"; breaker.add(lever);
    const rackL = addLight(room, "point", { color: 0xa8dcff, intensity: 2.5, dist: 3.5, at: [-0.2, 1.6, 2.2], name: "rack" });
    addLight(room, "point", { color: 0xfff0d8, intensity: 30, dist: 9, at: [0, 2.3, -0.5], name: "room" });
    addLight(room, "point", { color: 0xffe0c0, intensity: 14, dist: 6, at: [-1.2, 2.2, -2.4], name: "room2" });
    addLight(room, "hemi", { color: 0x8a7a68, ground: 0x2a2018, intensity: 0.5 });
    room.add(BOX(0.6, 0.04, 0.6, glow(0xfff2dc, 1.8), 0, 2.58, -0.5));
    let t = 0, cycle = 0;
    return { scene, root, interior: true, room, anchors: { rim: [1.4, 11.5, -12.6, 160], drift: [0, 0.35, -10, 0], frame: [0.4, 0.4, -10.4, 30], door_out: [0, 0, wallZ - 1.5, 180], door_in: [0, 0, wallZ + 1.0, 0], table: [-1.2, 0, wallZ + 2.4, 0], rack: [-0.1, 0, wallZ + 5.7, 0], hook: [-2.2, 0, wallZ + 6.1, 180], window: [0.3, 1.6, wallZ - 0.4, 180] },
      lights: { sun, rackL, doorL }, rscreen, lever,
      update(dt) { t += dt; shaft.update(dt); if (p.screenOn !== false) { const rate = p.strobe ? 0.06 : 1.4; cycle += dt; if (cycle > rate) { cycle = 0; rs.map = drawingTex(Math.floor(t * 7) % 6); rs.needsUpdate = true; } rs.color.setScalar(0.8 + 0.4 * Math.random() * (p.strobe ? 1 : 0.2)); rackL.intensity = 2 + Math.random() * (p.strobe ? 3 : 0.4); } else { rs.color.setScalar(0); rackL.intensity = 0; } },
      set(k, v) { p[k] = v; } };
  },

  /* C06: Korolev, the first biome dome: a translucent dome on the ice, a basin filling for the first time */
  biome(p) {
    /* a biome dome by day: printed regolith floor, grow beds, the Martian sky butterscotch through the panes */
    const scene = interior(0xb08a68, [0xb89878, 18, 70]), root = new THREE.Group(); scene.add(root);
    const floor = std(0xa08876, { map: noiseTex(0x8e7868, 0xb09888, 256, [3, 3]), roughness: 0.95 });
    root.add(M(new THREE.RingGeometry(5.2, 30, 64, 2), floor, 0, 0, 0, -Math.PI / 2));
    root.add(M(new THREE.RingGeometry(5.2, 5.6, 64, 1), std(0x9aa8b2, { roughness: 0.5 }), 0, 0.012, 0, -Math.PI / 2));
    const dome = M(new THREE.SphereGeometry(18, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd8b088, transparent: true, opacity: 0.55, side: THREE.BackSide, depthWrite: false, fog: false }), 0, 0, 0); root.add(dome);
    for (let i = 0; i < 12; i++) { const r = M(new THREE.TorusGeometry(18, 0.08, 6, 48, Math.PI), std(0x6a7078, { metalness: 0.6 }), 0, 0, 0, 0, (i / 12) * Math.PI, 0); root.add(r); }
    // grow beds round the far side: dark soil, rows of small green
    const soil = std(0x3a2c24, { roughness: 1 }), leaf = std(0x4f8a3a, { roughness: 0.8 }), leafG = new THREE.IcosahedronGeometry(0.16, 0); seed(31);
    for (let b = 0; b < 7; b++) {
      const a = Math.PI * (0.15 + b * 0.1), cx = Math.cos(a) * 11, cz = -Math.sin(a) * 11, bed = new THREE.Group();
      bed.add(BOX(5, 0.45, 1.3, std(0x8a8480), 0, 0.22, 0)); bed.add(BOX(4.8, 0.06, 1.15, soil, 0, 0.46, 0));
      for (let k = 0; k < 18; k++) { const l = M(leafG, leaf, -2.2 + (k % 9) * 0.55, 0.55 + rnd() * 0.08, (k < 9 ? -0.3 : 0.3)); l.scale.setScalar(0.7 + rnd() * 0.7); bed.add(l); }
      bed.position.set(cx, 0, cz); bed.rotation.y = a + Math.PI / 2; root.add(bed);
    }
    addLight(root, "dir", { color: 0xffe2c0, intensity: 2.4, at: [-10, 20, 8], target: [0, 0, 0], name: "sun" });
    addLight(root, "hemi", { color: 0xf0d8c0, ground: 0x6a5446, intensity: 1.3 });
    // the basin and the channel, the water rising
    root.add(M(new THREE.CylinderGeometry(5.2, 4.6, 0.8, 40, 1, true), std(0x9aa8b2, { side: THREE.DoubleSide }), 0, -0.4, 0));
    root.add(M(new THREE.CircleGeometry(4.6, 40), std(0x7a8a96), 0, -0.79, 0, -Math.PI / 2));
    root.add(BOX(0.5, 0.25, 10, std(0x9aa8b2), 7.5, -0.05, 0, Math.PI / 2));
    const wm = new THREE.ShaderMaterial({ transparent: true, uniforms: { t: { value: 0 } }, vertexShader: "varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
      fragmentShader: "uniform float t; varying vec2 vUv; varying vec3 vW; void main(){ float r=sin(length(vW.xz-vec2(3.0,1.0))*9.0-t*3.0)*0.5+0.5; float s=sin(vW.x*4.0+t*1.3)*sin(vW.z*3.0-t)*0.5+0.5; vec3 c=mix(vec3(0.05,0.12,0.16),vec3(0.55,0.75,0.85),r*0.25+s*0.2); c+=vec3(1.2,1.1,0.9)*pow(r*s,6.0); gl_FragColor=vec4(c,0.82);} " });
    const water = M(new THREE.CircleGeometry(4.7, 48), wm, 0, -0.78, 0, -Math.PI / 2); water.name = "water"; root.add(water);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; root.add(M(new THREE.SphereGeometry(0.06, 8, 6), glow(0xfff0d0, 5), Math.cos(a) * 14, 9 + (i % 2), Math.sin(a) * 14)); }
    addLight(root, "point", { color: 0xffd8e8, intensity: 160, dist: 40, at: [0, 9, -4], name: "dome" });
    // fans on posts
    for (const [x, z] of [[-6, -5], [6, -6]]) { root.add(BOX(0.1, 2.5, 0.1, std(0x5a6068), x, 1.25, z)); const f = M(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), std(0x3a4048), x, 2.5, z, Math.PI / 2, 0, 0); f.lookAt(0, 2.5, 0); root.add(f); }
    let t = 0;
    return { scene, root, interior: true, anchors: { edge: [0, 0, 5.3, 180], channel: [6.5, 0, 0.5, -90], left: [-2.6, 0, 5.4, 160], right: [2.8, 0, 5.6, 200] }, water,
      update(dt) { t += dt; wm.uniforms.t.value = t; water.position.y = -0.78 + Math.min(0.62, t * (p.fill ?? 0.012)); } };
  },

  /* C15 / C16: the city dome at Jezero: grass under artificial light, the plaque, the old module preserved in a corner */
  dome(p) {
    const scene = interior(p.outside ? 0x0b0b12 : 0x8fa6b8, p.outside ? null : [0xb0c4d0, 30, 140]), root = new THREE.Group(); scene.add(root);
    const grass = std(0x9a8a64, { map: noiseTex(0x8a7a58, 0xa89a70, 256, [20, 20]), roughness: 1 });     // a young lawn on dome soil: more soil than green
    root.add(M(new THREE.CircleGeometry(60, 64), grass, 0, 0, 0, -Math.PI / 2));
    const glass = new THREE.MeshStandardMaterial({ color: 0xd8e8f8, transparent: true, opacity: p.outside ? 0.22 : 0.08, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
    root.add(M(new THREE.SphereGeometry(60, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), glass));
    for (let i = 0; i < 16; i++) root.add(M(new THREE.TorusGeometry(60, 0.25, 6, 64, Math.PI), std(0xd0d4d8, { metalness: 0.5 }), 0, 0, 0, 0, (i / 16) * Math.PI, 0));
    for (let r = 1; r < 5; r++) { const ring = M(new THREE.TorusGeometry(60 * Math.cos(r * 0.32), 0.2, 6, 64), std(0xd0d4d8, { metalness: 0.5 }), 0, 60 * Math.sin(r * 0.32), 0, Math.PI / 2, 0, 0); root.add(ring); }
    // the old module, preserved, its airlock, a rope round it
    const old = new THREE.Group(); old.position.set(-14, 0, -10); old.rotation.y = -Math.PI / 2; root.add(old);      // its airlock end towards the lawn
    old.add(M(new THREE.CylinderGeometry(1.5, 1.5, 5.2, 24), std(0x9a8a74, { roughness: 0.85, map: panelTex() }), 0, 1.6, 0, 0, 0, Math.PI / 2));
    old.add(BOX(1.2, 2.0, 1.0, std(0x7a7470), 2.9, 1.0, 0)); old.add(M(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ color: 0x101418 }), 0, 1.9, 1.52));
    old.add(BOX(0.5, 0.5, 0.06, std(0x5a5650), 3.55, 1.4, 0.2, Math.PI / 2));
    // the plaque on its curved wall
    const wall = M(new THREE.CylinderGeometry(9, 9, 3, 24, 1, true, -0.4, 0.8), std(0xc8bca8, { side: THREE.DoubleSide }), 4, 1.5, -2); root.add(wall);
    const plaque = M(new THREE.PlaneGeometry(1.4, 0.45), new THREE.MeshStandardMaterial({ map: textTex(["OUTPOST JEZERO", "FOUNDED 2061"], { bg: "#6a4a20", fg: "#e8c890", border: "#a07838", w: 512, h: 160 }), metalness: 0.7, roughness: 0.35 }), 4 + 9 * Math.sin(0) - 0.1, 1.6, -2 + 9 - 0.05, 0, Math.PI, 0);
    plaque.position.set(4, 1.6, 6.92); plaque.rotation.y = Math.PI; root.add(plaque);
    // benches, young trees, people at a distance (the colonists: cloth, in the present)
    seed(31);
    for (let i = 0; i < 14; i++) { const a = rnd() * 6.28, r = 12 + rnd() * 30, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x > -18 && x < -6 && z > -13 && z < 7) continue;       // keep the line from the cab to the old module clear
      root.add(M(new THREE.CylinderGeometry(0.08, 0.12, 2.2, 6), std(0x5a4030), x, 1.1, z)); root.add(M(new THREE.IcosahedronGeometry(1.3, 1), std(0x4e6a38, { roughness: 1 }), x, 2.8, z)); }
    for (let i = 0; i < 5; i++) root.add(BOX(1.6, 0.4, 0.5, std(0x7a6a58), -8 + i * 5, 0.4, 10 + (i % 2) * 2));
    const sun = addLight(root, "dir", { color: 0xfff4e0, intensity: 2.6, at: [10, 40, 30], target: [0, 0, 0], name: "dome-sun" });
    addLight(root, "hemi", { color: 0xc8dcf0, ground: 0x4a6a3a, intensity: 1.0 });
    let cab = null;
    if (p.cab) { cab = cabGroup(); cab.position.set(...(p.cab.at || [-13.6, 0.55, 3.2])); cab.rotation.y = (p.cab.yaw ?? 0) * D2R; root.add(cab); addLight(root, "point", { color: 0x9fdcff, intensity: 1.2, dist: 2.5, at: [cab.position.x - 0.4, cab.position.y + 1.1, cab.position.z - 0.5], name: "cab" }); }
    if (p.outside) {
      const s = stars(1200, 300); root.add(s);
      addLight(root, "point", { color: 0xfff0d0, intensity: 300, dist: 120, at: [0, 40, 0], name: "dome-glow" });
    }
    return { scene, root, interior: true, cab, anchors: { plaque: [4, 0, 6.2, 0], lawn: [2, 0, 2, 180], module: [-14, 0, -6.8, 0], module_door: [-14, 0, -6.4, 0], outside: [10, 0, -70, 0], lead: [3.2, 0, 3.6, 200], p1: [4.6, 0, 1.6, 20] }, lights: { sun } };
  },

  /* C17: a colonist's new apartment: a crate of rock hammers and field notebooks, the doorway */
  apartment(p) {
    const scene = interior(0x0c0a08), root = new THREE.Group(); scene.add(root);
    const wall = std(0xd8d0c4, { roughness: 0.95, side: THREE.BackSide });
    root.add(BOX(5, 2.7, 4.4, wall, 0, 1.35, 0));
    root.add(M(new THREE.PlaneGeometry(5, 4.4), std(0x8a7a66, { roughness: 0.85 }), 0, 0.001, 0, -Math.PI / 2));
    // a window: Mars daylight through it
    root.add(M(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf0c890).multiplyScalar(2.2) }), -2.48, 1.55, -0.6, 0, Math.PI / 2, 0));
    const sun = addLight(root, "spot", { color: 0xffe0b0, intensity: 120, dist: 14, angle: 32, pen: 0.4, at: [-4.5, 3.0, -0.6], target: [0.2, 0, 0.4], name: "window" });
    // the doorway (+z): a frame, the corridor light behind
    root.add(BOX(1.2, 2.2, 0.15, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8e4f0).multiplyScalar(1.4) }), 1.4, 1.1, 2.24));
    root.add(BOX(0.12, 2.3, 0.3, std(0x6a6458), 0.75, 1.15, 2.2)); root.add(BOX(0.12, 2.3, 0.3, std(0x6a6458), 2.05, 1.15, 2.2)); root.add(BOX(1.42, 0.12, 0.3, std(0x6a6458), 1.4, 2.25, 2.2));
    addLight(root, "point", { color: 0xd8e8ff, intensity: 6, dist: 5, at: [1.4, 1.9, 2.8], name: "corridor" });
    const door = BOX(1.2, 2.2, 0.06, std(0xc8c4bc, { roughness: 0.6 }), 2.6, 1.1, 2.12); door.name = "apt-door"; root.add(door);
    addLight(root, "hemi", { color: 0xd8c8b0, ground: 0x3a3028, intensity: 0.8 });
    // a soft key from the room side (the ceiling panel) so faces read against the window, which rims them
    addLight(root, "point", { color: 0xffe8d0, intensity: 7, dist: 6, at: [1.0, 2.3, -0.4], name: "key" });
    // the crate, opened, its hammers and notebooks; more crates stacked
    const crate = makeProp("crate"); crate.position.set(-0.6, 0, -0.4); crate.rotation.y = 0.2; root.add(crate);
    for (let i = 0; i < 5; i++) { const n = makeProp("notebook", { color: [0x4a3f2e, 0x2e3e4a, 0x5a2e2a, 0x3e4a2e, 0x4a4a4a][i] }); n.position.set(0.3 + (i % 3) * 0.2, 0.012 + Math.floor(i / 3) * 0.022, -0.6 + (i % 2) * 0.05); n.rotation.y = i * 0.3; root.add(n); }
    for (let i = 0; i < 3; i++) { const h = makeProp("rock_hammer"); h.position.set(-0.85 + i * 0.22, 0.58, -0.45); h.rotation.set(Math.PI / 2, 0, 0.3 * i); root.add(h); }
    root.add(BOX(0.8, 0.5, 0.6, std(0x6d6a60), 2.0, 0.25, -1.6)); root.add(BOX(0.7, 0.45, 0.5, std(0x5d5a50), 2.0, 0.72, -1.6, 0.2));
    return { scene, root, interior: true, anchors: { crate: [-0.6, 0, 0.25, 180], door: [1.4, 0, 2.05, 180], window: [-2.4, 1.5, -0.6, 90] }, lights: { sun } };
  },

  /* C18b: the decommissioning bay in the old rover garage: white light, the padded cradle, the rack of helmets */
  bay(p) {
    const scene = interior(0xf4f6f8, [0xe8eef4, 12, 40]), root = new THREE.Group(); scene.add(root);
    root.add(BOX(12, 5, 14, std(0xe8ecef, { roughness: 0.6, side: THREE.BackSide }), 0, 2.5, 0));
    root.add(M(new THREE.PlaneGeometry(12, 14), std(0xc8ccd0, { roughness: 0.4, metalness: 0.1 }), 0, 0.001, 0, -Math.PI / 2));
    for (let i = 0; i < 4; i++) root.add(BOX(8, 0.06, 0.5, glow(0xffffff, 2.2), 0, 4.95, -5 + i * 3.3));
    addLight(root, "point", { color: 0xf4f8ff, intensity: 40, dist: 18, at: [0, 4.5, 0], name: "top" });
    addLight(root, "hemi", { color: 0xffffff, ground: 0xb0b8c0, intensity: 1.4 });
    // the cradle
    const pad = std(0x3a4450, { roughness: 0.7 });
    root.add(BOX(1.0, 0.55, 1.4, std(0xd0d4d8, { metalness: 0.3 }), 0, 0.27, 0)); root.add(BOX(0.9, 0.12, 1.3, pad, 0, 0.6, 0.0));
    const bk = BOX(0.9, 1.3, 0.16, pad, 0, 1.15, 0.62); bk.rotation.x = -0.52; root.add(bk);
    for (const s of [-1, 1]) root.add(BOX(0.12, 0.25, 0.9, pad, s * 0.5, 0.82, 0.1));
    // the rack of surrendered helmets, a name stencilled under each
    const names = ["PIONEER-11", "PIONEER-2", "PIONEER-7", "PIONEER-4", "PIONEER-9", "PIONEER-12", "PIONEER-5", "PIONEER-8"];
    root.add(BOX(0.4, 0.06, 8, std(0x8a9096, { metalness: 0.6 }), -5.6, 1.6, 0));
    names.forEach((n, i) => {
      const h = p.helmet ? makeProp("helmet", { mesh: p.helmet }) : makeProp("helmet"); h.position.set(-5.55, 1.82, -3.4 + i * 0.95); h.rotation.y = Math.PI / 2; root.add(h);
      root.add(M(new THREE.PlaneGeometry(0.6, 0.12), new THREE.MeshStandardMaterial({ map: textTex([n], { bg: "#d8dce0", fg: "#2a2e33", w: 256, h: 48 }) }), -5.92, 1.48, -3.4 + i * 0.95, 0, Math.PI / 2, 0));
    });
    // the window to the dome: green light and people on the grass beyond
    root.add(M(new THREE.PlaneGeometry(4, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9ac080).multiplyScalar(1.3) }), 5.95, 2.0, -1, 0, -Math.PI / 2, 0));
    return { scene, root, interior: true, anchors: { cradle: [0, 0, 0.12, 180], door: [0, 0, -6.5, 0], rack: [-4.8, 0, 0, -90], window: [5.4, 0, -1, 90], lead: [1.4, 0, -0.8, -40], recall: [-1.8, 0, -4, 20] } };
  },

  /* memories: a beach in Galway at evening, the tide far out */
  beach(p) {
    const scene = interior(0x2a1e1a, [0xd89a70, 30, 160]), root = new THREE.Group(); scene.add(root);
    const sand = std(0xc8a07a, { map: noiseTex(0xb89068, 0xd8b088, 256, [30, 30]), roughness: 1 });
    root.add(M(new THREE.PlaneGeometry(400, 400), sand, 0, 0, 0, -Math.PI / 2));
    const sea = new THREE.ShaderMaterial({ uniforms: { t: { value: 0 } }, transparent: true, vertexShader: "varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
      fragmentShader: "uniform float t; varying vec3 vW; void main(){ float w=sin(vW.z*0.6+t*0.8)*0.5+0.5; float g=pow(max(0.0,sin(vW.x*0.15+vW.z*0.9-t)),12.0); vec3 c=mix(vec3(0.25,0.22,0.24),vec3(0.95,0.62,0.4),0.35+0.25*w)+g*vec3(2.0,1.4,0.9); gl_FragColor=vec4(c,0.95);} " });
    root.add(M(new THREE.PlaneGeometry(400, 300), sea, 0, 0.03, -170, -Math.PI / 2));
    const wet = M(new THREE.PlaneGeometry(400, 30), std(0x8a6a58, { roughness: 0.2, metalness: 0.3 }), 0, 0.01, -15, -Math.PI / 2); root.add(wet);
    const sunDisc = M(new THREE.CircleGeometry(7, 32), glow(0xffd090, 6), -30, 14, -300); root.add(sunDisc);
    root.add(M(new THREE.SphereGeometry(500, 24, 12), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, vertexShader: "varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ", fragmentShader: "varying vec3 vD; void main(){ float h=clamp(vD.y*3.0,0.0,1.0); vec3 c=mix(vec3(1.6,0.9,0.55),vec3(0.35,0.3,0.45),h); gl_FragColor=vec4(c,1.0);} " })));
    addLight(root, "dir", { color: 0xffc890, intensity: 2.8, at: [-30, 14, -300], target: [0, 0, 0], name: "sun" });
    addLight(root, "hemi", { color: 0x8a7aa0, ground: 0x8a6448, intensity: 0.9 });
    const upd = memoryize(root, { center: [0, 1, -6], radius: 26, motes: 160 });
    let t = 0;
    return { scene, root, interior: true, memory: true, anchors: { lucy: [-1.6, 0, -13, 180], alice_start: [2, 0, -10, 0], viewer: [1.4, 0, 3, 180] }, update(dt) { t += dt; sea.uniforms.t.value = t; upd(dt); } };
  },
  /* memories: the pier, wind, Lucy at the rail */
  pier(p) {
    const scene = interior(0x30343c, [0x707884, 15, 120]), root = new THREE.Group(); scene.add(root);
    const sea = new THREE.ShaderMaterial({ uniforms: { t: { value: 0 } }, vertexShader: "varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
      fragmentShader: "uniform float t; varying vec3 vW; void main(){ float w=sin(vW.z*0.9+t*1.4+sin(vW.x*0.3))*0.5+0.5; vec3 c=mix(vec3(0.14,0.17,0.2),vec3(0.42,0.46,0.5),w*0.6); gl_FragColor=vec4(c,1.0);} " });
    root.add(M(new THREE.PlaneGeometry(400, 400), sea, 0, -2.2, 0, -Math.PI / 2));
    const wood = std(0x6a5a48, { roughness: 1 });
    for (let i = 0; i < 40; i++) root.add(BOX(3.2, 0.06, 0.22, wood, 0, 0, -i * 0.26));
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) root.add(BOX(0.2, 2.4, 0.2, wood, s * 1.5, -1.1, -i * 2));
    for (const s of [-1, 1]) { root.add(BOX(0.06, 0.06, 10.5, wood, s * 1.55, 1.05, -5.1)); for (let i = 0; i < 9; i++) root.add(BOX(0.06, 1.05, 0.06, wood, s * 1.55, 0.53, -i * 1.3)); }
    root.add(M(new THREE.SphereGeometry(500, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a96a8).multiplyScalar(1.2), side: THREE.BackSide, depthWrite: false })));
    addLight(root, "dir", { color: 0xffe0c8, intensity: 1.8, at: [20, 10, -40], target: [0, 0, 0] });
    addLight(root, "hemi", { color: 0xa0b0c8, ground: 0x40403a, intensity: 1.0 });
    const upd = memoryize(root, { center: [0.8, 1, -6], radius: 7, motes: 140 });
    let t = 0;
    return { scene, root, interior: true, memory: true, anchors: { rail: [1.15, 0.03, -6, 90], end: [0, 0.03, -9.5, 180], viewer: [-0.6, 0.03, -2, 200] }, update(dt) { t += dt; sea.uniforms.t.value = t; upd(dt); } };
  },
  /* memories: a back garden at night, a satellite crossing (C02) and the Plough (C07) */
  garden(p) {
    const scene = interior(0x04060c, [0x0a0c14, 8, 40]), root = new THREE.Group(); scene.add(root);
    root.add(M(new THREE.CircleGeometry(30, 32), std(0x1e2a18, { roughness: 1 }), 0, 0, 0, -Math.PI / 2));
    root.add(BOX(12, 2.8, 0.3, std(0x5a5048), 0, 1.4, 6)); root.add(M(new THREE.PlaneGeometry(1.2, 1.0), glow(0xffc070, 1.6), 1.5, 1.6, 5.84, 0, Math.PI, 0));
    addLight(root, "point", { color: 0xffb060, intensity: 10, dist: 10, at: [1.5, 1.6, 5.2], name: "window" });
    for (let i = 0; i < 14; i++) root.add(BOX(0.12, 1.5, 0.05, std(0x3a3028), -8 + i * 1.2, 0.75, -8));
    root.add(stars(1600, 120, 0.02));
    // the Plough, brighter
    const P = [[-0.5, 0.62], [-0.38, 0.66], [-0.26, 0.64], [-0.14, 0.6], [-0.1, 0.5], [0.06, 0.48], [0.06, 0.58]];
    for (const [a, b] of P) root.add(M(new THREE.SphereGeometry(0.35, 8, 6), glow(0xffffff, 5), Math.sin(a) * 100, b * 100, -Math.cos(a) * 100));
    const sat = M(new THREE.SphereGeometry(0.28, 8, 6), glow(0xfff4e0, 8), 0, 70, -90); sat.name = "satellite"; root.add(sat);
    addLight(root, "hemi", { color: 0x203050, ground: 0x0a0806, intensity: 0.45 });
    const upd = memoryize(root, { center: [0, 1, 0], radius: 7, motes: 120 });
    let t = 0;
    return { scene, root, interior: true, memory: true, anchors: { alice: [0.4, 0, 0, 0], dad: [-0.4, 0, 0.3, 0], viewer: [1.5, 0, 3.5, 200] }, update(dt) { t += dt; sat.position.set(-60 + t * 6, 70, -90); upd(dt); } };
  },

  /* C20: the archive tape, ESI 2056: a plain institutional room, a plastic chair, a banner */
  interview(p) {
    const scene = interior(0x101010), root = new THREE.Group(); scene.add(root);
    root.add(BOX(6, 3, 6, std(0xb8b4a8, { roughness: 1, side: THREE.BackSide }), 0, 1.5, 0));
    root.add(M(new THREE.PlaneGeometry(6, 6), std(0x6a6a64, { roughness: 0.8 }), 0, 0.001, 0, -Math.PI / 2));
    root.add(M(new THREE.PlaneGeometry(2.6, 0.7), new THREE.MeshStandardMaterial({ map: textTex(["EUROPEAN SPACE INITIATIVE", "CANDIDATE SELECTION · 2056"], { bg: "#1d3a6a", fg: "#e8e8f0", w: 1024, h: 280 }), roughness: 0.9 }), 0, 2.15, -2.98));
    // the plastic chair
    const ch = std(0xd8d0b8, { roughness: 0.6 });
    root.add(BOX(0.46, 0.04, 0.44, ch, 0, 0.44, -1.2)); const b = BOX(0.46, 0.5, 0.04, ch, 0, 0.72, -1.42); b.rotation.x = -0.1; root.add(b);
    for (const [x, z] of [[-0.2, -1.4], [0.2, -1.4], [-0.2, -1.0], [0.2, -1.0]]) root.add(M(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 6), std(0x5a5a5a, { metalness: 0.6 }), x, 0.22, z));
    addLight(root, "point", { color: 0xfff0d8, intensity: 14, dist: 9, at: [0.6, 2.8, 0.5], name: "tube" });
    addLight(root, "point", { color: 0xfff4e8, intensity: 5, dist: 5, at: [0.9, 1.6, 0.9], name: "key" });
    addLight(root, "hemi", { color: 0xd8d4c8, ground: 0x3a3832, intensity: 0.8 });
    return { scene, root, interior: true, anchors: { chair: [0, 0, -1.2, 0], camera: [0, 1.3, 1.8, 180] } };
  },

  /* C19: the hideout: a lava tube ledge, a stolen battery humming, names scratched into the rock */
  hideout(p) {
    const scene = interior(0x030406, [0x07080b, 9, 40]), root = new THREE.Group(); scene.add(root);
    const g = new THREE.CylinderGeometry(3.2, 3.2, 24, 32, 20, true), P = g.attributes.position; seed(9);
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 1 + 0.15 * Math.sin(y * 0.9 + x * 2) * Math.cos(z * 1.3); P.setXYZ(i, x * k, y, z * k); }
    g.computeVertexNormals();
    root.add(M(g, std(0x3a3430, { map: noiseTex(0x4a4038, 0x7a6e62, 256, [5, 3]), side: THREE.BackSide, roughness: 0.95 }), 0, 2.2, -6, Math.PI / 2, 0, 0));
    root.add(M(new THREE.PlaneGeometry(6, 24), std(0x5a4636, { roughness: 1 }), 0, 0, -6, -Math.PI / 2));
    const names = (p.names || []).length ? p.names : [];
    if (names.length) {
      const all = []; for (let i = 0; i < 60; i++) all.push(names[i % names.length]);
      const tx = canvasTex(1024, 512, (gg, w, h) => { gg.fillStyle = "#231f1c"; gg.fillRect(0, 0, w, h); gg.strokeStyle = "rgba(200,190,170,0.55)"; gg.fillStyle = "rgba(210,200,180,0.6)"; seed(3); all.forEach((n, i) => { gg.save(); gg.translate(30 + (i % 6) * 165 + rnd() * 20, 40 + Math.floor(i / 6) * 46 + rnd() * 10); gg.rotate((rnd() - 0.5) * 0.12); gg.font = "600 22px monospace"; gg.fillText(n, 0, 0); gg.restore(); }); });
      root.add(M(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshStandardMaterial({ map: tx, roughness: 1 }), -2.4, 1.4, -2, 0, Math.PI / 2, 0));
    }
    const bat = BOX(0.5, 0.35, 0.3, std(0x2a3038, { metalness: 0.4 }), 0.6, 0.18, -2.6); root.add(bat);
    root.add(M(new THREE.PlaneGeometry(0.3, 0.04), glow(0x40ff90, 2), 0.6, 0.3, -2.44));
    const batL = addLight(root, "point", { color: 0x40ff90, intensity: 0.6, dist: 3, at: [0.6, 0.5, -2.3], name: "battery" });
    addLight(root, "hemi", { color: 0x9aa2bc, ground: 0x2a2220, intensity: 1.6 });
    addLight(root, "point", { color: 0x8aa0c8, intensity: 40, dist: 14, at: [1.2, 2.6, 1.0], name: "bounce" });
    addLight(root, "point", { color: 0xc8b090, intensity: 16, dist: 9, at: [-1.0, 1.2, -3.5], name: "deep" });
    // the mouth of the tube, night outside
    root.add(M(new THREE.CircleGeometry(3.4, 32), new THREE.MeshBasicMaterial({ color: 0x05070c }), 0, 2.2, 5.9, 0, Math.PI, 0));
    let t = 0;
    return { scene, root, interior: true, anchors: { wall: [-1.9, 0, -2.4, 90], mouth: [0, 0, 5.2, 180], inside: [0.4, 0, -0.4, 180] }, update(dt) { t += dt; batL.intensity = 0.5 + 0.15 * Math.sin(t * 6); } };
  },

  /* C13: CITIES IN THE SKY, 2059: glossy domes glowing over a red plain at dusk, a rendered family, the logo */
  advert(p) {
    const scene = interior(0x2a1020), root = new THREE.Group(); scene.add(root);
    root.add(M(new THREE.PlaneGeometry(600, 600), std(0xa0402a, { roughness: 0.6, metalness: 0.2 }), 0, 0, 0, -Math.PI / 2));
    root.add(M(new THREE.SphereGeometry(500, 24, 12), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, vertexShader: "varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ", fragmentShader: "varying vec3 vD; void main(){ float h=clamp(vD.y*2.5,0.0,1.0); vec3 c=mix(vec3(2.0,0.7,0.35),vec3(0.25,0.1,0.35),h); gl_FragColor=vec4(c,1.0);} " })));
    const domes = [];
    for (let i = 0; i < 7; i++) { const r = 6 + (i % 3) * 3, x = -40 + i * 13, z = -50 - (i % 2) * 18; const d = M(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffb060, emissiveIntensity: 0, transparent: true, opacity: 0.85, roughness: 0.05, metalness: 0.3 }), x, 0, z); domes.push(d); root.add(d); }
    addLight(root, "dir", { color: 0xffa070, intensity: 2.4, at: [-40, 10, -100], target: [0, 0, 0] });
    addLight(root, "hemi", { color: 0xa070a0, ground: 0x602818, intensity: 0.9 });
    const logo = M(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: textTex(["MERIDIAN"], { bg: "#00000000", fg: "#f4f0e8", w: 512, h: 128 }), transparent: true }), 0, 0, 0); logo.name = "logo"; root.add(logo);
    let t = 0;
    return { scene, root, interior: true, anchors: { family: [0, 0, -12, 180], camera: [0, 1.6, 6, 180] }, logo, domes,
      update(dt) { t += dt; domes.forEach((d, i) => { d.material.emissiveIntensity = Math.max(0, Math.min(1.6, (t - 1.0 - i * 0.7) * 1.2)); }); } };
  },

  /* the rover's cab on its own (C04's NO RADIO, C09's drive to Gale): Mars daylight through the glass */
  cab(p) {
    const scene = interior(p.night ? 0x05060a : 0xc8a888, p.night ? null : [0xc8a280, 80, 3200]), root = new THREE.Group(); scene.add(root);
    root.add(cabGroup());
    root.add(M(new THREE.PlaneGeometry(6000, 6000), std(0x9a6a48, { map: noiseTex(0x8a5a3a, 0xaa7a54, 256, [600, 600]), roughness: 1 }), 0, -0.6, -1500, -Math.PI / 2));
    if (p.tracks) { const tm = new THREE.MeshBasicMaterial({ color: 0x3a2418, transparent: true, opacity: 0.55, depthWrite: false }); for (const x of [-1.5, -0.2, 1.1]) for (const dx of [0, 1.45]) root.add(M(new THREE.PlaneGeometry(0.32, 120), tm, x + dx - 6 + 6, -0.59, -60, -Math.PI / 2, 0, 0.6)); }
    if (p.mountain) { const mt = new THREE.ConeGeometry(1300, 520, 48, 10), P = mt.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i); P.setX(i, P.getX(i) * (1 + 0.06 * Math.sin(y * 0.05))); } mt.computeVertexNormals(); root.add(M(mt, std(0xa07a5c, { roughness: 1 }), 200, 200, -2300)); }
    addLight(root, "dir", { color: p.night ? 0x8090c0 : 0xffd8b0, intensity: p.night ? 0.3 : 2.4, at: [-30, 40, -60], target: [0, 0, 0] });
    addLight(root, "hemi", { color: p.night ? 0x202840 : 0xd8b090, ground: 0x4a3020, intensity: p.night ? 0.2 : 0.9 });
    addLight(root, "point", { color: 0x9fdcff, intensity: 1.2, dist: 2.5, at: [-0.4, 1.1, -0.5], name: "dash" });
    if (p.headlights) for (const x of [-0.7, 0.7]) addLight(root, "spot", { color: 0xfff4e0, intensity: 300, dist: 60, angle: 22, pen: 0.4, at: [x, 0.9, -1.4], target: [x * 0.4, -0.6, -20], name: "head" });
    return { scene, root, interior: true, anchors: { seat: [0, 0.04, 0.12, 180] } };
  },
  /* C18a: the service tunnel ANVIL cut for the cable runs in the first year */
  tunnel(p) {
    const scene = interior(0x020202, [0x050404, 10, 70]), root = new THREE.Group(); scene.add(root);
    root.add(M(new THREE.CylinderGeometry(3.4, 3.4, 120, 24, 1, true), std(0x4a3a2e, { map: noiseTex(0x3a2e24, 0x5a4636, 256, [4, 30]), side: THREE.BackSide }), 0, 2.2, -50, Math.PI / 2, 0, 0));
    root.add(M(new THREE.PlaneGeometry(5, 120), std(0x5a4636, { roughness: 1 }), 0, 0, -50, -Math.PI / 2));
    for (let i = 0; i < 20; i++) root.add(M(new THREE.CylinderGeometry(0.04, 0.04, 6, 6), std(0x1a1a1a), 2.6, 2.6, -i * 6, Math.PI / 2, 0, 0));
    root.add(M(new THREE.CircleGeometry(3.3, 24), new THREE.MeshBasicMaterial({ color: 0x0a0c14 }), 0, 2.2, -109));
    addLight(root, "hemi", { color: 0x302820, ground: 0x0a0806, intensity: 0.15 });
    // headlights coming through: two lamps moving down the tunnel at the rover's speed
    const heads = [];
    for (const x of [-0.6, 0.6]) { const L = addLight(root, "spot", { color: 0xf4f0e0, intensity: 160, dist: 40, angle: 24, pen: 0.4, at: [x, 1.2, 0], target: [x * 0.5, 0.6, -14], name: "head" }); heads.push(L); }
    let t = 0;
    return { scene, root, interior: true, anchors: { start: [0, 0, 0, 180], mouth: [0, 0, -104, 180] },
      update(dt) { if (p.driving) t += dt; const z = -t * (p.speed ?? 8); for (const L of heads) { L.position.z = z; L.target.position.z = z - 14; } }, set(k, v) { p[k] = v; } };
  },
};

function calendarTex() {
  return tex("calendar", () => canvasTex(256, 340, (g, w, h) => {
    g.fillStyle = "#efe9dc"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#2a2a2a"; g.font = "700 22px sans-serif"; g.textAlign = "center"; g.fillText("SOL", w / 2, 26);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 6; c++) { const x = 18 + c * 38, y = 46 + r * 40; g.strokeStyle = "#999"; g.strokeRect(x, y, 34, 36); g.strokeStyle = "#a01818"; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + 30, y + 32); g.moveTo(x + 30, y + 4); g.lineTo(x + 4, y + 32); g.stroke(); g.lineWidth = 1; }
  }));
}

/* ── world dressing: groups placed in the world at the stage ───────────────── */
const DRESS = {
  /* C05: the drill rig ANVIL built, and the ice scarp: banded like a cut cake */
  ice_scarp(p) {
    const group = new THREE.Group();
    /* layered polar deposits: pale ice bands under a dusty rind, low contrast, noisy edges */
    const bands = tex("bands", () => canvasTex(128, 1024, (g, w, h) => {
      seed(17); g.fillStyle = "#b39a86"; g.fillRect(0, 0, w, h); let y = 0;
      while (y < h) { const t = 3 + rnd() * 22, ice = rnd() < 0.45, l = ice ? 196 + rnd() * 30 : 150 + rnd() * 30;
        g.fillStyle = ice ? `rgb(${l | 0},${(l * 0.97) | 0},${(l * 0.95) | 0})` : `rgb(${l | 0},${(l * 0.84) | 0},${(l * 0.72) | 0})`;
        for (let x = 0; x < w; x += 4) g.fillRect(x, y + Math.sin(x * 0.09 + y) * 2, 4, t); y += t; }
      const d = g.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const n = (rnd() - 0.5) * 22; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } g.putImageData(d, 0, 0);
      const gr = g.createLinearGradient(0, 0, 0, h * 0.18); gr.addColorStop(0, "rgba(150,110,85,0.85)"); gr.addColorStop(1, "rgba(150,110,85,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.18);
    }));
    bands.wrapS = THREE.RepeatWrapping; bands.repeat.set(3, 1);
    const wall = new THREE.PlaneGeometry(260, 70, 80, 24), P = wall.attributes.position; seed(2);
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i); P.setZ(i, 7 * Math.sin(x * 0.05) + 3 * Math.sin(x * 0.17 + y * 0.05) + (y + 35) * 0.35 + (rnd() - 0.5) * 0.8); }
    wall.computeVertexNormals();
    group.add(M(wall, new THREE.MeshStandardMaterial({ map: bands, roughness: 0.85 }), 0, 30, -95));
    /* talus apron where the wall meets the ground */
    const apron = new THREE.PlaneGeometry(260, 40, 60, 10), A = apron.attributes.position;
    for (let i = 0; i < A.count; i++) { const y = A.getY(i); A.setZ(i, Math.max(0, (y + 20) / 40) * 9 + (rnd() - 0.5) * 0.6); }
    apron.computeVertexNormals();
    group.add(M(apron, std(0x9c8270, { roughness: 1 }), 0, 0.2, -70, -Math.PI / 2));
    group.add(M(new THREE.PlaneGeometry(240, 120), std(0xc9c3bd, { roughness: 0.7 }), 0, 0.12, -10, -Math.PI / 2));
    return { group, anchors: { scarp: [0, 0, -60, 0], shelf: [0, 0, -20, 0] } };
  },
  drill_rig(p) {
    const group = new THREE.Group(), y = std(0xd8a020, { roughness: 0.6 }), dk = std(0x2b2f35, { metalness: 0.4 });
    for (const [x, z] of [[-0.9, -0.6], [0.9, -0.6], [0, 0.9]]) { const l = M(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 8), y, x * 0.6, 1.6, z * 0.6); l.lookAt(0, 3.3, 0); l.rotateX(Math.PI / 2); group.add(l); }
    group.add(BOX(0.5, 0.4, 0.5, dk, 0, 3.2, 0)); group.add(M(new THREE.CylinderGeometry(0.06, 0.06, 3.0, 10), std(0x9aa1a9, { metalness: 0.8 }), 0, 1.6, 0));
    group.add(BOX(0.8, 0.5, 0.6, y, 1.2, 0.25, 0.4));
    return { group, anchors: { rig: [0, 0, 0, 0], beside: [0.9, 0, 1.0, 200] } };
  },
  /* C08: the lander three metres under the sand, outlined by the HUD */
  dune_ghost(p) {
    const group = new THREE.Group();
    const lm = new THREE.LineBasicMaterial({ color: new THREE.Color(0x00e5ff).multiplyScalar(2.5), transparent: true, opacity: 0.9, depthTest: false });
    const shape = new THREE.Group();
    for (const g of [new THREE.CylinderGeometry(1.6, 2.4, 3.0, 12), new THREE.ConeGeometry(1.6, 1.4, 12)]) shape.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), lm));
    shape.children[1].position.y = 2.2; shape.rotation.z = 34 * D2R; shape.position.y = -3.2; shape.renderOrder = 10; group.add(shape);
    shape.traverse((o) => { o.renderOrder = 10; });
    return { group, anchors: { crest: [0, 0, 0, 0] }, update(dt, t) { lm.opacity = 0.55 + 0.35 * Math.sin(t * 2.2); } };
  },
  /* C09: an outpost laid out exactly like his own, down to the angle of the airlock */
  gale_outpost(p) {
    const group = new THREE.Group(), shell = std(0xc8beb0, { map: panelTex() }), dk = std(0x2b2f35);
    group.add(M(new THREE.CylinderGeometry(1.5, 1.5, 5.2, 20), shell, 0, 1.6, 0, 0, 0, Math.PI / 2)); group.add(BOX(1.2, 2.0, 1.0, std(0x8a8480), 2.9, 1.0, 0));
    for (let i = 0; i < 4; i++) { const pnl = BOX(1.8, 0.05, 1.0, std(0x1d2a4a, { metalness: 0.6, roughness: 0.3 }), -4 - i * 2, 1.2, 3); pnl.rotation.z = -0.4; group.add(pnl); }
    group.add(M(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), dk, 4, 3, -3));
    for (let i = 0; i < 6; i++) group.add(M(new THREE.TorusGeometry(7, 0.12, 6, 32, Math.PI * (0.3 + 0.1 * i)), std(0x9aa0a6, { metalness: 0.5 }), 10, 0, -6, 0, i / 6 * Math.PI, 0));
    group.add(BOX(4, 1.0, 0.4, std(0x9a7a5a, { roughness: 1 }), -2, 0.5, -5));
    addLight(group, "point", { color: 0xfff0d0, intensity: 30, dist: 18, at: [1, 4, 2] });
    return { group, anchors: { wall: [-2, 0, -4.2, 180], module: [0, 0, 0, 0], approach: [6, 0, 18, 200] } };
  },
  /* C11: Utopia: the Gen-1 drones, hundreds, every one facing west */
  drones(p) {
    const group = new THREE.Group(), n = p.n || 260, R = p.r || 90;
    const mats = [std(0x8a8478, { roughness: 0.9 }), std(0x6a6e72, { metalness: 0.4, roughness: 0.7 }), std(0x9a7a50, { roughness: 0.9 })];
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.6, 1.4), mats[0], n), wheel = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 1.3, 10), mats[1], n), arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), mats[2], n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(); seed(12);
    const spots = [];
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * R * 2, z = (rnd() - 0.5) * R * 2; if (Math.abs(x) < 2.5 && Math.abs(z) < 30) { spots.push(null); continue; }
      const sink = 0.15 + rnd() * 0.35; spots.push([x, z]);
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.12, -Math.PI / 2 + (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.1));
      m.compose(v.set(x, 0.55 - sink, z), q, s); body.setMatrixAt(i, m);
      m.compose(v.set(x, 0.3 - sink, z), q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))), s); wheel.setMatrixAt(i, m);
      m.compose(v.set(x + 0.2, 1.3 - sink, z), q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 + rnd() * 0.6, 0, 0))), s); arm.setMatrixAt(i, m);
    }
    for (const im of [body, wheel, arm]) { im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; group.add(im); }
    return { group, anchors: { aisle: [0, 0, 0, 0], plug: [1.6, 0, 6, -90] }, spots, ground: true };
  },
  /* the city: lit domes on rings round the old outpost, to the horizon (C14, C18a) */
  city(p) {
    const group = new THREE.Group(), n = p.n || 60;
    const dm = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffa850, emissiveIntensity: p.night === false ? 0.1 : 0.5, transparent: true, opacity: 0.8, roughness: 0.1 });
    const dome = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), dm, n);
    const road = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc88a).multiplyScalar(0.7), fog: true }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(); seed(41);
    for (let i = 0; i < n; i++) {
      const ring = 1 + Math.floor(i / 10), a = (i % 10) / 10 * Math.PI * 2 + ring * 0.37, r = 60 + ring * 70 + rnd() * 30, sz = 10 + rnd() * 18 - ring;
      m.compose(v.set(Math.cos(a) * r, -1, Math.sin(a) * r), q, s.setScalar(Math.max(6, sz))); dome.setMatrixAt(i, m);
      q.setFromEuler(new THREE.Euler(0, -a, 0)); const r0 = 28, len = r - r0 - sz; m.compose(v.set(Math.cos(a) * (r0 + len / 2), 0.06, Math.sin(a) * (r0 + len / 2)), q, s.set(Math.max(1, len), 1, 0.35)); road.setMatrixAt(i, m); q.identity();
    }
    for (const im of [dome, road]) { im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; group.add(im); }
    return { group, anchors: {} };
  },
  /* the sky: the twelve HALO stations along the equator, the Covenant's burns, the second light */
  sky_lights(p) {
    const group = new THREE.Group(); group.userData.sky = true;
    const R = 3000, mk = (c, k, s) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT(), color: new THREE.Color(c).multiplyScalar(k), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); sp.scale.setScalar(s); return sp; };
    const stations = [], flares = [], second = mk(0xfff4e8, 6, 40);
    for (let i = 0; i < 12; i++) { const a = (i / 11 - 0.5) * 2.6, s = mk(0xffffff, 4, 26); s.position.set(Math.sin(a) * R, R * 0.38 + Math.cos(i) * 40, -Math.cos(a) * R * 0.6 - R * 0.4); group.add(s); stations.push(s); }
    for (let i = 0; i < 7; i++) { const s = mk(0xbfe0ff, 8, 60); s.position.set(-900 + i * 300, R * 0.62, -R * 0.7); group.add(s); flares.push(s); }
    second.position.set(R * 0.6, R * 0.18, R * 0.7); group.add(second);
    return { group, anchors: {}, stations, flares, second, params: p, set(k, v) { p[k] = v; },
      update(dt, t) {
        for (const st of stations) st.visible = !!p.stations;
        for (let i = 0; i < flares.length; i++) { const f = flares[i]; f.visible = !!p.burn; if (p.burn) { f.material.opacity = 0.7 + 0.3 * Math.sin(t * 13 + i); f.position.x += dt * 25; } }
        second.visible = !!p.second; if (p.second) { second.position.x -= dt * 20; second.position.y -= dt * 2; } } };
  },
  /* C04: the drifts banked against every panel edge */
  dust_drifts(p) {
    const group = new THREE.Group(), sm = std(0xa8734f, { roughness: 1 }); seed(8);
    for (let i = 0; i < 9; i++) { const d = M(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), sm, -6 + i * 1.5, 0, (rnd() - 0.5) * 1.5); d.scale.set(0.9 + rnd() * 0.6, 0.35 + rnd() * 0.3, 0.6 + rnd() * 0.5); group.add(d); }
    return { group, anchors: {} };
  },
  /* C02: the flare on the plain where he chose the site */
  flare(p) {
    const group = new THREE.Group();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT(), color: new THREE.Color(0xff3020).multiplyScalar(6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(3); s.position.y = 0.6; group.add(s);
    const L = new THREE.PointLight(0xff3020, 5, 10, 2); L.position.y = 1.5; group.add(L);
    return { group, anchors: {}, update(dt, t) { s.material.opacity = 0.75 + 0.25 * Math.sin(t * 17) * Math.sin(t * 5.3); } };
  },
  /* the first outpost as the films show it (C04, C07, C12, C14): one hab module with a flat roof deck (the roof the two of
     them sit on), its airlock, an array, a mast; optionally the drifts after the storm, the first dome glowing below, the
     city round it. Local axes: x right, -z FORWARD (the stage's forward); the roof deck's top is y = 3.3. */
  outpost(p) {
    const group = new THREE.Group(), shell = std(0xc8beb0, { map: panelTex(), roughness: 0.8 }), dk = std(0x34383d, { metalness: 0.4, roughness: 0.5 });
    group.add(M(new THREE.CylinderGeometry(1.5, 1.5, 5.2, 24), shell, 0, 1.75, 0, 0, 0, Math.PI / 2));
    for (const [x, z] of [[-2, -0.9], [2, -0.9], [-2, 0.9], [2, 0.9]]) group.add(M(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 8), dk, x, 0.25, z));
    group.add(BOX(5.0, 0.08, 1.9, std(0x7a756c, { roughness: 0.9 }), 0, 3.26, 0));
    group.add(BOX(5.0, 0.5, 0.05, dk, 0, 3.55, 0.95));
    group.add(BOX(1.3, 2.1, 1.2, std(0x8a8480), 3.2, 1.25, 0)); group.add(BOX(0.06, 1.6, 0.8, dk, 3.86, 1.2, 0));
    group.add(M(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd8a0).multiplyScalar(p.night ? 2.5 : 0.6) }), 0, 1.9, -1.52, 0, Math.PI, 0));
    for (let i = 0; i < 4; i++) { const pn = BOX(1.8, 0.05, 1.0, std(0x1d2a4a, { metalness: 0.6, roughness: 0.3 }), -4.5 + i * 2.1, 1.1, -6.5); pn.rotation.x = 0.45; group.add(pn); group.add(M(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), dk, -4.5 + i * 2.1, 0.55, -6.3)); }
    if (p.drifts) { const sm = std(0x8a6048, { roughness: 1, map: noiseTex(0x7a5440, 0x9a7056, 128, [3, 3]) }); seed(8); for (let i = 0; i < 10; i++) { const d = M(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), sm, -5.4 + i * 0.95, -0.05, -6.0 + (rnd() - 0.5) * 0.5); d.scale.set(1.0 + rnd() * 0.6, 0.55 + rnd() * 0.25, 1.4 + rnd() * 0.4); group.add(d); }
      for (let i = 0; i < 4; i++) { const w = BOX(1.7, 0.12, 0.6, sm, -4.5 + i * 2.1, 1.32, -6.7); w.rotation.x = 0.45; group.add(w); } }
    group.add(M(new THREE.CylinderGeometry(0.05, 0.05, 6, 6), dk, 5.5, 3, 2.0)); group.add(M(new THREE.SphereGeometry(0.08, 8, 6), glow(0xff3020, 3), 5.5, 6.05, 2.0));
    if (p.dome) {
      const dm = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffa850, emissiveIntensity: p.night ? 1.0 : 0.15, transparent: true, opacity: 0.85, roughness: 0.1 });
      group.add(M(new THREE.SphereGeometry(9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), dm, 14, 0, -18));
      for (let i = 0; i < 8; i++) group.add(M(new THREE.TorusGeometry(9.02, 0.06, 6, 40, Math.PI), dk, 14, 0, -18, 0, i / 8 * Math.PI, 0));
      if (p.night) { const L = new THREE.PointLight(0xffb060, 400, 60, 2); L.position.set(14, 4, -18); group.add(L); }
    }
    if (p.frame) {     // the dome under construction: ribs, half framed (C12's night shift)
      for (let i = 0; i < 5; i++) group.add(M(new THREE.TorusGeometry(9, 0.08, 6, 40, Math.PI * (0.35 + 0.13 * i)), std(0x9aa0a6, { metalness: 0.5 }), 14, 0, -18, 0, i / 5 * Math.PI, 0));
    }
    if (p.night) { const L = new THREE.PointLight(0xffd8a0, 6, 6, 2); L.position.set(0, 2.0, -2.4); group.add(L); }
    return { group, anchors: {} };
  },
  /* a copy of the game's own rover (its current model and paint), parked where the film wants it */
  rover_copy(p, ctx) {
    const group = new THREE.Group(), g = ctx && ctx.director && ctx.director.game;
    if (g && g.model && g.model.group) { const c = g.model.group.clone(true); c.position.set(0, 0, 0); c.quaternion.identity(); c.rotation.set(0, 0, 0); c.updateMatrix(); group.add(c);
      const bb = new THREE.Box3().setFromObject(c); c.position.y -= bb.min.y; }
    return { group, anchors: {} };
  },
  /* C01: the lander under its parachute, seen from above the canopy */
  descent(p) {
    const group = new THREE.Group();
    const canopy = M(new THREE.SphereGeometry(9, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), std(0xf2efe8, { side: THREE.DoubleSide, roughness: 0.85 }), 0, 0, 0); group.add(canopy);
    for (let i = 0; i < 8; i++) group.add(M(new THREE.SphereGeometry(9.06, 4, 2, i * Math.PI / 4, 0.18, 0, Math.PI / 2.4), std(0xe0641c, { side: THREE.DoubleSide }), 0, 0, 0));
    const lines = []; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; lines.push(0, -14, 0, Math.cos(a) * 7.6, 2.5, Math.sin(a) * 7.6); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3)); group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xcfc8b8 })));
    const body = new THREE.Group(); body.position.y = -16.5; group.add(body);
    body.add(M(new THREE.CylinderGeometry(1.6, 2.4, 3.0, 20), std(0xcfcac0, { metalness: 0.3 }), 0, 0, 0)); body.add(M(new THREE.ConeGeometry(1.6, 1.4, 20), std(0xcfcac0), 0, 2.2, 0)); body.add(M(new THREE.CylinderGeometry(2.6, 2.5, 0.4, 20), std(0x3b2a20), 0, -1.6, 0));
    return { group, anchors: {}, set(k, v) { p[k] = v; }, update(dt, t) { group.position.y -= dt * (p.sink ?? 9); group.rotation.y += dt * 0.05; canopy.scale.set(1 + 0.02 * Math.sin(t * 3), 1 - 0.03 * Math.sin(t * 3), 1 + 0.02 * Math.sin(t * 3)); } };
  },
  /* the pod's blown hatch and the scorched ring (C03) */
  pod_hatch(p) {
    const group = new THREE.Group();
    const h = M(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 16), std(0x3a3632, { metalness: 0.4 }), 0, 0.05, 0); h.name = "hatch"; group.add(h);
    const ring = M(new THREE.RingGeometry(1.2, 4.2, 32), new THREE.MeshBasicMaterial({ color: 0x140a06, transparent: true, opacity: 0.55, depthWrite: false }), 0, 0.03, 0, -Math.PI / 2); group.add(ring);
    return { group, anchors: {}, hatch: h };
  },
};

/** A set (interior: its own scene) or world dressing (a group the director places at the stage). */
export function buildSet(kind, params = {}, ctx = {}) {
  if (SETS[kind]) { const s = SETS[kind](params, ctx); s.kind = kind; s.update = s.update || (() => {}); s.dispose = () => s.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); return s; }
  if (DRESS[kind]) { const s = DRESS[kind](params, ctx); s.kind = kind; s.interior = false; s.update = s.update || (() => {}); s.dispose = () => { if (s.group.parent) s.group.parent.remove(s.group); s.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }; s.group.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) o.frustumCulled = false; }); return s; }
  console.warn("[cinesets] no such set", kind);
  return null;
}
export const SET_KINDS = Object.keys(SETS), DRESS_KINDS = Object.keys(DRESS);
export { stars };
