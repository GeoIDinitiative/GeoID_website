/**
 * THE CHARACTERS: one skinned rig for everyone in MARS: Frontier Pioneer.
 *
 * assets/models/characters.glb is built in Blender by tools/assets/build_characters.py (one command): the
 * NASA suit rigged on the Kestrel skeleton (24 bones: root, hips, spine, chest, neck, head, clavicles,
 * upper arms, forearms, hands, fingers, thighs, shins, feet, toes), its variants as meshes on the same
 * skeleton (suit, helmet, trim, human, face, hair_*), sockets for cosmetics and props (sk_*), and every
 * clip (charclips.py). Nothing here is downloaded: the rig and the clips are ours.
 *
 * EVERY CARETAKER IS A PERSON IN A SUIT, like the pioneer (the owner's direction): ANVIL and the rest are told
 * apart by suit colour, trim, the visor's tint, shoulder markings, a stencilled callsign and the kit they
 * carry (game/actors.js dresses them).
 *
 *   const lib = await loadCharacters();
 *   const ch = new Character(lib, { kind: "pioneer" | "caretaker" | "kestrel" | "recall" | "covenant" | "human" | "child",
 *                                   suit, trim, visor (colours), hair: "long" | "bun" | "short" | "tied" | null,
 *                                   look: "memory" | "cloth" | "silhouette", helmet: true });
 *   scene.add(ch.root); ch.play("idle"); ch.update(dt);
 *   ch.play(name, { fade, speed, from, hold })   -> Promise (a one-shot clip resolves when it ends, then plays its `base`)
 *   ch.locomote(speed, { walk, lope, sprint, idle })   the gaits blended by speed, phase-locked (no foot sliding)
 *   ch.lookAt(worldPoint | null, weight)          the head and neck turn to it within a helmet's limits (eyelines)
 *   ch.ground = (x, z) => y                       feet planted on uneven ground (two-bone IK per leg, the pelvis drops)
 *   ch.attach("sk_grip_R", object)                a prop in the hand; ch.socket(name)
 *   ch.setKind(kind, o) / ch.unfiltered(on)       the perception filter: anyone drawn as the Kestrel chassis it is
 *
 * THE LIFE LAYER: held poses ('hold' clips) are two frames in the GLB; breathing and a slow drift are added
 * here, after the mixer, so a held pose is never dead and the file stays small.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

const STAMP = new URL(import.meta.url).search;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (cur, to, rate, dt) => cur + (to - cur) * (1 - Math.exp(-rate * dt));

let _lib = null;
/** Load the GLB once; every Character clones it. */
export function loadCharacters() {
  if (_lib) return _lib;
  _lib = (async () => {
    const { GLTFLoader } = await import("../vendor/GLTFLoader.js" + STAMP);
    const g = await new GLTFLoader().loadAsync(new URL("../assets/models/characters.glb", import.meta.url).href + STAMP);
    const arm = g.scene.getObjectByName("kestrel") || g.scene;
    let meta = {};
    try { meta = JSON.parse(arm.userData.clips || "{}"); } catch { meta = {}; }
    const clips = new Map();
    for (const a of g.animations) {
      // scale tracks never animate here; position tracks only on the hips (the clips are in place)
      a.tracks = a.tracks.filter((t) => !/\.scale$/.test(t.name) && (!/\.position$/.test(t.name) || /^hips\./.test(t.name)));
      clips.set(a.name, a);
    }
    // the rest pose, for the life layer and IK: every bone's model-space rotation in the bind pose
    const rest = new Map();
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => { if (o.isBone) { const q = new THREE.Quaternion(); o.getWorldQuaternion(q); rest.set(o.name, q); } });
    const helmet = g.scene.getObjectByName("prop_helmet");
    if (helmet) helmet.parent.remove(helmet);
    g.scene.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; } });
    return { gltf: g, scene: g.scene, clips, meta, rest, props: { helmet } };
  })();
  _lib.catch(() => { _lib = null; });
  return _lib;
}

/** A clone of the rig with its own skeleton (what SkeletonUtils.clone does). */
function cloneRig(src) {
  const root = src.clone(true);
  const bones = new Map();
  root.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const sk = o.skeleton;
    o.bind(new THREE.Skeleton(sk.bones.map((b) => bones.get(b.name)), sk.boneInverses.map((m) => m.clone())), o.bindMatrix);
  });
  return { root, bones };
}

/* ── looks ─────────────────────────────────────────────────────────────────── */

const VERT = /* glsl */`
  #include <common>
  #include <skinning_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    #include <logdepthbuf_vertex>
    vN = normalize(transformedNormal); vV = -mvPosition.xyz; vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  }`;
const MEMORY_FRAG = /* glsl */`
  uniform vec3 uColor, uRim; uniform float uTime, uOpacity, uDissolve, uScan;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  #include <logdepthbuf_pars_fragment>
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vN), v = normalize(vV);
    float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.0);
    // the perception filter rebuilding a remembered body: scanlines climb it, its edges break into points
    float scan = 1.0 - uScan * 0.35 * smoothstep(0.55, 1.0, sin(vW.y * 70.0 - uTime * 2.4));
    vec3 cell = floor(vW * 55.0);
    float g = h3(cell + floor(uTime * 6.0));
    float edge = f * 0.9 + 0.1;
    if (g < uDissolve * edge * 1.6) discard;
    float a = (0.16 + 0.84 * f) * uOpacity;
    vec3 col = uColor * (0.35 + 0.65 * (1.0 - f)) + uRim * f * 1.8;
    col += uRim * step(0.985, h3(cell * 1.7 + floor(uTime * 3.0))) * 1.5 * f;
    gl_FragColor = vec4(col * scan * a, a);
  }`;
/** The luminous silhouette of someone remembered: a warm body, a bright rim, edges dissolving into points. */
export function memoryMaterial(o = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(o.color ?? 0xffb27a) }, uRim: { value: new THREE.Color(o.rim ?? 0xffe2b8) }, uTime: { value: 0 },
      uOpacity: { value: o.opacity ?? 1 }, uDissolve: { value: o.dissolve ?? 0.18 }, uScan: { value: o.scan ?? 1 } },
    vertexShader: VERT, fragmentShader: MEMORY_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  m.userData.memory = true;
  return m;
}
/** The Kestrel chassis without the filter: matte composite, no fabric, no seams. */
export function rawMaterial() { return new THREE.MeshStandardMaterial({ color: 0x4f545a, roughness: 0.62, metalness: 0.28, name: "raw" }); }
/** People in the present (the colonists): matte cloth, warm. */
export function clothMaterial(c = 0x6d5a4a) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0, name: "cloth" }); }
/** The body in clothes with the head and neck in skin: split on the bind-pose height (before skinning), so it holds in any pose. */
export function clothSkinMaterial(cloth, skin) {
  const m = clothMaterial(cloth), sk = new THREE.Color(skin);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSkin = { value: sk };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vBindY;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvBindY = position.y;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vBindY;\nuniform vec3 uSkin;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uSkin, smoothstep(1.47, 1.5, vBindY));");
  };
  m.customProgramCacheKey = () => "clothskin";
  return m;
}

const KINDS = {
  pioneer: { show: ["suit", "helmet"] },
  caretaker: { show: ["suit", "helmet", "trim"] },
  kestrel: { show: ["suit", "helmet"], raw: true },
  recall: { show: ["suit", "helmet", "trim"], suit: 0xf3f5f7, trim: 0x1f5fbf, visor: 0x9fc4ff },
  covenant: { show: ["suit", "helmet", "trim"], suit: 0xe9ecef, trim: 0x1f5fbf },
  human: { show: ["human"], person: true },
  child: { show: ["human"], person: true, scale: [0.6, 0.6, 0.6], head: 1.28 },
};
const SKIN = ["suit", "helmet", "trim", "human", "face", "hair_long", "hair_bun", "hair_short", "hair_tied"];

export class Character {
  constructor(lib, o = {}) {
    this.lib = lib; this.o = Object.assign({}, o);
    const { root, bones } = cloneRig(lib.scene);
    this.model = root; this.bones = bones;
    this.root = new THREE.Group(); this.root.name = "character:" + (o.name || o.kind || "pioneer");
    this.body = new THREE.Group(); this.body.name = "character-body";
    this.root.add(this.body); this.body.add(root);
    this.parts = {};
    root.traverse((o2) => { if (SKIN.includes(o2.name) && !this.parts[o2.name]) this.parts[o2.name] = o2; });
    this.sockets = {};
    root.traverse((o2) => { if (/^sk_/.test(o2.name)) this.sockets[o2.name] = o2; });
    // every material is this character's own (tints, the filter, memory looks)
    root.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.userData.base = m.material; m.userData.rig = true; } });
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map(); this.w = new Map(); this.to = new Map(); this.fade = new Map();
    this.phase = 0; this.speed = 0; this.timeScale = 1;
    this.cur = null; this._pend = null;
    this.life = 1; this.lifeT = Math.random() * 10;
    this._look = null; this._lookW = 0; this._lookYaw = 0; this._lookPitch = 0;
    this.ground = null; this.ikOn = false; this._drop = 0;
    this.setKind(o.kind || "pioneer", o);
  }

  /* ── what it is ── */
  setKind(kind, o = {}) {
    const K = KINDS[kind] || KINDS.pioneer;
    this.kind = kind;
    Object.assign(this.o, o);
    const helmet = this.o.helmet !== false;
    for (const n of SKIN) {
      const p = this.parts[n]; if (!p) continue;
      let on = K.show.includes(n);
      if (n === "helmet") on = on && helmet;
      if (n === "face") on = K.show.includes("suit") && !helmet;
      if (/^hair_/.test(n)) on = (K.person || (K.show.includes("suit") && !helmet)) && this.o.hair && n === "hair_" + this.o.hair;
      if (n === "human") on = !!K.person;
      p.visible = on;
    }
    const s = K.scale || [1, 1, 1], u = this.o.scale || 1;
    this.body.scale.set(s[0] * u, s[1] * u, s[2] * u);
    this._headScale = K.head || 1;
    this._look_ = this.o.look || (K.person ? "memory" : null);
    // materials
    const each = (fn) => this.model.traverse((m) => { if (m.isMesh && m.userData.rig) fn(m); });
    each((m) => { m.material = m.userData.base; });
    if (K.raw) each((m) => { if (/^astnt1_1/.test(m.userData.base.name || "")) m.material = this._raw || (this._raw = rawMaterial()); });
    const suitC = this.o.suit ?? K.suit, trimC = this.o.trim ?? K.trim, visC = this.o.visor ?? K.visor;
    if (suitC != null) this.setSuit(suitC);
    if (trimC != null) this.setTrim(trimC);
    if (visC != null) this.setVisor(visC);
    if (K.person || this.parts.face && this.parts.face.visible) {
      const look = this._look_;
      if (look === "memory") {
        this._mem = this._mem || memoryMaterial(this.o.memory || {});
        for (const n of ["human", "face", "hair_long", "hair_bun", "hair_short", "hair_tied"]) if (this.parts[n]) this.parts[n].traverse((m) => { if (m.isMesh) m.material = this._mem; });
      } else if (look === "silhouette") {
        const sil = new THREE.MeshBasicMaterial({ color: 0x050403 });
        for (const n of ["human", "face", "hair_long", "hair_bun", "hair_short", "hair_tied"]) if (this.parts[n]) this.parts[n].traverse((m) => { if (m.isMesh) m.material = sil; });
      } else {
        const skin = clothMaterial(this.o.skin ?? 0x9a7a66), cloth = clothMaterial(this.o.cloth ?? 0x4e5560), hair = clothMaterial(this.o.hairColour ?? 0x2a211b);
        if (this.parts.human) { const body = clothSkinMaterial(this.o.cloth ?? 0x4e5560, this.o.skin ?? 0x9a7a66); this.parts.human.traverse((m) => { if (m.isMesh) m.material = body; }); }
        if (this.parts.face) this.parts.face.traverse((m) => { if (m.isMesh) m.material = skin; });
        for (const n of ["hair_long", "hair_bun", "hair_short", "hair_tied"]) if (this.parts[n]) this.parts[n].traverse((m) => { if (m.isMesh) m.material = hair; });
      }
    }
    return this;
  }
  _mat(re, fn) { this.model.traverse((m) => { if (m.isMesh && m.userData.rig && re.test(m.userData.base.name || "")) fn(m.userData.base); }); }
  /** The suit's colour (a tint over the NASA texture; the kit's own white is 0xffffff). */
  setSuit(c) { const k = new THREE.Color(c); this._mat(/^astnt1_1/, (m) => { if (!m.userData.c0) m.userData.c0 = m.color.clone(); m.color.copy(m.userData.c0).multiply(k); }); }
  setTrim(c) { this._mat(/^trim/, (m) => m.color.set(c)); }
  setVisor(c) { const k = new THREE.Color(c); this._mat(/^astnt1_2/, (m) => { if (!m.userData.c0) m.userData.c0 = m.color.clone(); m.color.copy(m.userData.c0).lerp(k, 0.7); m.emissive = k.clone(); m.emissiveIntensity = 0.15; m.roughness = 0.2; m.metalness = 0.4; m.needsUpdate = true; }); }
  /** The filter drops: a unit (or anyone) drawn as the Kestrel chassis it is, for `on`. */
  unfiltered(on) {
    if (on === this._unf) return;
    this._unf = on;
    if (on) { this._kindWas = this.kind; this.setKind("kestrel"); }
    else if (this._kindWas) this.setKind(this._kindWas);
  }
  /** The material a whole category of meshes draws with (cinematics: rim lights, the memory look's colour). */
  get memory() { return this._mem || null; }

  /* ── sockets and props ── */
  socket(name) { return this.sockets[name] || null; }
  attach(name, obj, pos = null, rot = null) {
    const s = this.sockets[name] || this.bones.get(name);
    if (!s || !obj) return null;
    s.add(obj);
    if (pos) obj.position.set(pos[0], pos[1], pos[2]);
    if (rot) obj.rotation.set(rot[0], rot[1], rot[2]);
    return obj;
  }

  /* ── clips ── */
  has(name) { return this.lib.clips.has(name); }
  meta(name) { return this.lib.meta[name] || {}; }
  action(name) {
    let a = this.actions.get(name);
    if (a) return a;
    const clip = this.lib.clips.get(name);
    if (!clip) return null;
    a = this.mixer.clipAction(clip);
    const M = this.meta(name);
    if (M.kind === "once") { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    else a.setLoop(THREE.LoopRepeat, Infinity);
    a.enabled = true; a.setEffectiveWeight(0); a.play();
    this.actions.set(name, a);
    this.w.set(name, 0);
    return a;
  }
  /**
   * Play a clip, fading everything else out. A one-shot clip resolves when it ends and then plays its base
   * (meta.base) unless o.hold is set (it then holds its last frame).
   */
  play(name, o = {}) {
    if (!this.has(name)) { name = this.has("idle") ? "idle" : name; }
    const a = this.action(name); if (!a) return Promise.resolve();
    const M = this.meta(name), fade = o.fade ?? 0.3;
    if (this.cur === name && !o.restart && M.kind !== "once") { a.timeScale = (o.speed ?? 1) * this.timeScale; return Promise.resolve(); }
    for (const k of this.to.keys()) this.to.set(k, 0);
    this.to.set(name, 1); this.fade.set(name, Math.max(0.01, fade));
    for (const k of this.fade.keys()) if (k !== name) this.fade.set(k, Math.max(0.01, fade));
    a.reset(); a.enabled = true; a.paused = M.kind === "gait"; a.timeScale = (o.speed ?? 1) * this.timeScale;
    if (o.from) a.time = o.from;
    if (M.kind === "gait") this._gait = { [name]: 1 };
    else this._gait = null;
    if (fade <= 0.01) { for (const k of this.w.keys()) this.w.set(k, 0); this.w.set(name, 1); }
    this.cur = name;
    if (this._pend) { this._pend.res({ interrupted: true }); this._pend = null; }
    if (M.kind !== "once") return Promise.resolve();
    return new Promise((res) => { this._pend = { name, res, hold: !!o.hold, dur: a.getClip().duration / Math.max(0.01, a.timeScale) }; });
  }
  /** A held pose at a time in a clip (no playback). */
  pose(name, t = 0) {
    const a = this.action(name); if (!a) return;
    for (const k of this.to.keys()) { this.to.set(k, 0); this.w.set(k, 0); }
    this.to.set(name, 1); this.w.set(name, 1); a.reset(); a.paused = true; a.time = t; this.cur = name; this._gait = null;
  }
  /** The gaits blended by speed (m/s), phase-locked so a planted foot never slides. names: {idle, walk, lope, sprint}. */
  locomote(speed, n = {}) {
    const N = Object.assign({ idle: "idle", walk: "walk", lope: "lope", sprint: null }, n);
    this.speed = speed;
    const g = {};
    const sp = Math.abs(speed);
    const walkV = (this.meta(N.walk).speed || 1.3), lopeV = N.lope ? (this.meta(N.lope).speed || 3) : 99, sprV = N.sprint ? (this.meta(N.sprint).speed || 4.5) : 99;
    if (sp < 0.08) g[N.idle] = 1;
    else if (sp < walkV * 0.35) { const k = (sp - 0.08) / (walkV * 0.35 - 0.08); g[N.idle] = 1 - k; g[N.walk] = k; }
    else if (!N.lope || sp < (walkV + lopeV) * 0.5 - 0.3) g[N.walk] = 1;
    else if (sp < (walkV + lopeV) * 0.5 + 0.3) { const k = (sp - ((walkV + lopeV) * 0.5 - 0.3)) / 0.6; g[N.walk] = 1 - k; g[N.lope] = k; }
    else if (!N.sprint || sp < (lopeV + sprV) * 0.5 - 0.3) g[N.lope] = 1;
    else if (sp < (lopeV + sprV) * 0.5 + 0.3) { const k = (sp - ((lopeV + sprV) * 0.5 - 0.3)) / 0.6; g[N.lope] = 1 - k; g[N.sprint] = k; }
    else g[N.sprint] = 1;
    for (const k of this.to.keys()) if (!(k in g)) this.to.set(k, 0);
    for (const [k, v] of Object.entries(g)) { const a = this.action(k); if (!a) continue; this.to.set(k, v); this.fade.set(k, 0.25); a.enabled = true; if (this.meta(k).kind === "gait") a.paused = true; else a.paused = false; }
    this._gait = g; this.cur = Object.keys(g).sort((a, b) => g[b] - g[a])[0];
    if (this._pend) { this._pend.res({ interrupted: true }); this._pend = null; }
  }
  /** The head (and neck) turn toward a world point; null releases it. weight 0..1. */
  lookAt(p, weight = 1) { this._look = p ? (this._look || new THREE.Vector3()).copy(p) : null; this._lookTo = p ? weight : 0; }

  /* ── per frame ── */
  update(dt) {
    dt = Math.max(0, Math.min(dt || 0, 0.1));
    // weights toward their targets, normalised so the bind pose never shows through
    let tot = 0;
    for (const [k, to] of this.to) {
      let w = this.w.get(k) || 0; const f = this.fade.get(k) || 0.3;
      w = to > w ? Math.min(to, w + dt / f) : Math.max(to, w - dt / f);
      this.w.set(k, w); tot += w;
    }
    // gait phase: distance over the blended stride
    if (this._gait) {
      let stride = 0, ws = 0;
      for (const k of Object.keys(this._gait)) { const M = this.meta(k); if (M.kind !== "gait") continue; const w = this.w.get(k) || 0; stride += w * (M.speed || 1) * (M.cycle || 1); ws += w; }
      if (ws > 1e-3) this.phase = (this.phase + dt * Math.abs(this.speed) / Math.max(0.2, stride / ws)) % 1;
    }
    for (const [k, a] of this.actions) {
      const w = tot > 1e-6 ? (this.w.get(k) || 0) / tot : 0;
      a.setEffectiveWeight(w);
      if (w <= 0 && (this.to.get(k) || 0) <= 0) { a.enabled = false; continue; }
      a.enabled = true;
      const M = this.meta(k);
      if (M.kind === "gait") { a.paused = true; a.time = this.phase * a.getClip().duration; }
    }
    this.mixer.update(dt);
    // a one-shot that has finished: resolve, then its base
    const P = this._pend;
    if (P) {
      const a = this.actions.get(P.name);
      if (!a || a.time >= a.getClip().duration - 1e-3 || !a.isRunning()) {
        this._pend = null; P.res({ done: true });
        const base = this.meta(P.name).base;
        if (!P.hold && base && this.cur === P.name) this.play(base, { fade: 0.35 });
      }
    }
    this._life(dt);
    this._lookAt(dt);
    if (this._headScale !== 1) { const h = this.bones.get("head"); if (h) h.scale.setScalar(this._headScale); }
    if (this.ikOn && this.ground) this._footIK(dt);
    else if (this._drop) { this._drop = damp(this._drop, 0, 10, dt); this.model.position.y = this._drop; }
    if (this._mem) this._mem.uniforms.uTime.value += dt;
  }

  /** Rotate a bone about a character-space axis (the rest pose's frame), on top of what the clip set. */
  _turn(name, axis, ang) {
    const b = this.bones.get(name), r = this.lib.rest.get(name);
    if (!b || !r || !ang) return;
    _q.setFromAxisAngle(axis, ang);
    _q2.copy(r).invert().multiply(_q).multiply(r);
    b.quaternion.multiply(_q2);
  }
  _life(dt) {
    let hold = 0;
    for (const [k, a] of this.actions) if (a.enabled && this.meta(k).kind === "hold") hold += a.getEffectiveWeight();
    this.lifeT += dt;
    const k = hold * this.life;
    if (k < 0.01) return;
    const t = this.lifeT, br = Math.sin(t * 2 * Math.PI / 4.2), dr = Math.sin(t * 2 * Math.PI / 9.0);
    this._turn("chest", X, -0.02 * br * k);
    this._turn("spine", X, -0.007 * br * k);
    this._turn("clavicle_L", Z, 0.022 * Math.sin(t * 2 * Math.PI / 4.2 - 0.5) * k);
    this._turn("clavicle_R", Z, -0.022 * Math.sin(t * 2 * Math.PI / 4.2 - 0.5) * k);
    this._turn("head", X, 0.014 * Math.sin(t * 2 * Math.PI / 4.2 - 1.2) * k);
    this._turn("spine", Z, 0.008 * dr * k);
    this._turn("neck", Y, 0.03 * Math.sin(t * 0.37) * k);
  }
  _lookAt(dt) {
    this._lookW = damp(this._lookW, this._look ? this._lookTo : 0, 4, dt);
    if (this._lookW < 0.01) return;
    const chest = this.bones.get("chest"), head = this.bones.get("head"), rc = this.lib.rest.get("chest");
    if (!chest || !head || !rc) return;
    if (this._look) {
      this.root.updateMatrixWorld(true);
      head.getWorldPosition(_v);
      _w.copy(this._look).sub(_v).normalize();
      // into the chest's own frame, as character axes
      chest.getWorldQuaternion(_q); _q.multiply(_q2.copy(rc).invert());
      _w.applyQuaternion(_q.invert());
      // where the head looks now (character forward through the head's pose, relative to the chest)
      head.getWorldQuaternion(_q3); _q3.multiply(_q2.copy(this.lib.rest.get("head")).invert());
      chest.getWorldQuaternion(_q); _q.multiply(_q2.copy(rc).invert());
      _u.copy(Z).applyQuaternion(_q3).applyQuaternion(_q.invert());
      const yawT = clamp(Math.atan2(_w.x, _w.z), -1.25, 1.25), pitT = clamp(-Math.asin(clamp(_w.y, -1, 1)), -0.55, 0.7);
      const yawN = Math.atan2(_u.x, _u.z), pitN = -Math.asin(clamp(_u.y, -1, 1));
      this._lookYaw = damp(this._lookYaw, yawT - yawN, 6, dt); this._lookPitch = damp(this._lookPitch, pitT - pitN, 6, dt);
    }
    const w = this._lookW;
    this._turn("neck", Y, this._lookYaw * 0.4 * w); this._turn("head", Y, this._lookYaw * 0.6 * w);
    this._turn("neck", X, this._lookPitch * 0.35 * w); this._turn("head", X, this._lookPitch * 0.65 * w);
  }

  /**
   * FEET ON THE GROUND. The clips assume flat ground at the root's height; on a slope the lower foot drops
   * the pelvis and each leg is re-solved (two bones, the knee kept in its own plane), the foot tilted to the
   * ground under it.
   */
  _footIK(dt) {
    const G = this.ground, B = this.bones;
    this.root.updateMatrixWorld(true);
    const ry = this.root.getWorldPosition(_v).y;      // the ground under the character (world: the root may sit in a parent)
    const legs = [["thigh_L", "shin_L", "foot_L"], ["thigh_R", "shin_R", "foot_R"]].map(([t, s, f]) => ({ t: B.get(t), s: B.get(s), f: B.get(f) }));
    if (legs.some((l) => !l.t || !l.s || !l.f)) return;
    let drop = 0;
    for (const l of legs) {
      l.f.getWorldPosition(_v);
      l.dy = clamp(G(_v.x, _v.z) - ry, -0.4, 0.4);
      drop = Math.min(drop, l.dy);
    }
    this._drop = damp(this._drop, drop, 14, dt);
    this.model.position.y = this._drop / Math.max(0.2, this.body.scale.y);
    this.root.updateMatrixWorld(true);
    for (const l of legs) {
      const need = l.dy - this._drop;
      if (Math.abs(need) < 0.004) continue;
      const H = l.t.getWorldPosition(new THREE.Vector3()), K = l.s.getWorldPosition(new THREE.Vector3()), A = l.f.getWorldPosition(new THREE.Vector3());
      const T = A.clone(); T.y += need;
      const a = H.distanceTo(K), b = K.distanceTo(A);
      const d = clamp(H.distanceTo(T), Math.abs(a - b) + 1e-3, a + b - 1e-3);
      const u = _u.copy(T).sub(H).normalize();
      _s.copy(K).sub(H); _s.addScaledVector(u, -_s.dot(u));
      if (_s.lengthSq() < 1e-8) _s.set(0, 0, 1).applyQuaternion(this.root.quaternion);
      _s.normalize();
      const ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
      const K2 = _a.copy(H).addScaledVector(u, a * ca).addScaledVector(_s, a * sa);
      const footQ = l.f.getWorldQuaternion(new THREE.Quaternion());
      // thigh: from (K - H) to (K2 - H), in world, then into its parent's frame
      _q.setFromUnitVectors(_b.copy(K).sub(H).normalize(), _w.copy(K2).sub(H).normalize());
      this._worldRotate(l.t, _q);
      l.t.updateMatrixWorld(true);
      const Kn = l.s.getWorldPosition(new THREE.Vector3()), An = l.f.getWorldPosition(new THREE.Vector3());
      _q.setFromUnitVectors(_b.copy(An).sub(Kn).normalize(), _w.copy(T).sub(Kn).normalize());
      this._worldRotate(l.s, _q);
      l.s.updateMatrixWorld(true);
      // the foot keeps the orientation the clip gave it
      l.s.getWorldQuaternion(_q3);
      l.f.quaternion.copy(_q3.invert().multiply(footQ));
    }
  }
  _worldRotate(bone, q) {
    bone.getWorldQuaternion(_q3);
    _q3.premultiply(q);
    bone.parent.getWorldQuaternion(_q2);
    bone.quaternion.copy(_q2.invert().multiply(_q3));
  }

  dispose() {
    this.mixer.stopAllAction();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}

/** Convenience: load, then make one. */
export async function makeCharacter(o = {}) { const lib = await loadCharacters(); return new Character(lib, o); }
