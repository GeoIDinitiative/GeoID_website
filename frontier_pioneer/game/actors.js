/**
 * ACTORS: animated people in the world, for any system that wants one (caretakers, RECALL teams, the
 * cinematics). Every caretaker is a person in a Kestrel suit like the pioneer: ANVIL (Des) and the rest
 * are told apart by suit colour, trim, the visor's tint, shoulder markings, a stencilled callsign on the
 * chest and the backpack, and the kit their role carries (tools, lamps, nets, ledgers: in hand or on the
 * suit). The rig and the clips are game/charrig.js (assets/models/characters.glb).
 *
 *   import { createActor, CLIPS, lookFor } from "./actors.js?v=6d37c9c-9b39e129";
 *   const a = createActor({ kind: "caretaker" | "pioneer" | "recall" | "human",
 *                           look: { suit, trim, visor, callsign, unit: "C-01", role: "construction", props: ["welder", ...] } });
 *   a.object3d                      a THREE.Group already in the scene (game.scene) unless { parent } is given
 *   a.setPosition(x, z, yaw)        on the ground (yaw: radians, 0 = facing +z... the game's convention below)
 *   a.play(clip, { fade, loop, speed, hold })   -> Promise (a one-shot resolves when it ends)
 *   a.walkTo(x, z, { speed, onArrive, gait })   walks (or lopes) over the real ground, turning to face the way
 *   a.stop()                        stands where it is (idle)
 *   a.lookAt(target | null, weight) a THREE.Vector3 / {x, y, z}, or another actor; the head turns
 *   a.setVisible(b), a.dispose()
 *   a.character                     the charrig Character (clips, sockets, the filter: a.character.unfiltered(true))
 *   a.external = true               the owner moves object3d itself (no walkTo, no grounding): only the animation runs here
 *   look also takes hair, material ("memory" | "cloth" | "silhouette"), helmet, memory ({color, rim}), scale, skin, cloth, hairColour
 *
 * The "actors" system (order 87) updates every actor's mixer each frame (distant actors less often) and
 * plants their feet on the ground. lookFor(callsign | role) gives a founder's or a role's look.
 * YAW: the same as the avatar's: 0 faces north (-z), positive turns clockwise seen from above.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { registerSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { loadCharacters, Character } from "./charrig.js?v=6d37c9c-9b39e129";
import { prepareSuitRig } from "./cosmetics.js?v=6d37c9c-9b39e129";

/** Every clip in characters.glb, by what it is for (the authored list: tools/assets/charclips.py). */
export const CLIPS = {
  locomotion: ["idle", "look_around", "walk", "lope", "sprint", "crouch_walk", "unit_walk", "anvil_walk", "walk_earth", "run_child", "walk_lamp", "carry", "turn_step", "climb", "climb_down", "slip"],
  hop: ["hop_takeoff", "hop_air", "hop_land"],
  kneel: ["kneel", "kneel_idle", "stand_from_kneel", "kneel_scan", "kneel_touch", "kneel_reach", "kneel_reach_hold", "kneel_unpack", "kneel_look_back", "kneel_look_back_hold", "crouch_idle"],
  work: ["drill", "scan", "place", "interact", "reach_take", "hold_tool", "pull_lever", "push", "lift_inspect", "hold_up", "hold_paper", "brush", "weld", "lift_place", "trowel_greet", "count_fingers", "unit_idle_check"],
  sit: ["sit", "sit_down", "stand_from_sit", "sit_edge", "sit_edge_look_up", "sit_edge_point", "sit_knees", "sit_knees_look_up", "sit_drive", "sit_desk", "sit_desk_still", "sit_handset", "sit_strapped", "sit_cradle", "sit_slump", "sit_chair_nervous", "nervous_laugh", "sit_ground", "sit_bed_lean", "wake_sit_up"],
  lie: ["lie_back", "lie_trace", "lie_side", "crouch_wall"],
  gesture: ["point", "point_up", "gesture_talk", "gesture_anvil", "wave", "salute", "hand_chest", "handshake", "shrug", "nod", "head_shake", "look_down", "look_up", "stand_edge", "wrist_talk", "helmet_off", "hold_helmet", "look_hands", "reach_back", "flinch"],
  people: ["guard", "raise_wand", "lean_rail", "hold_shoes"],
  rest: ["stand_down", "dormant", "unfold", "recalled", "collapse", "collapsed", "dead_folded", "frozen_reach", "frozen_scoop"],
};

/* ── looks: the founders' roles and the population's ─────────────────────────── */
export const ROLE_LOOKS = {
  construction: { suit: 0xf1e7d0, trim: 0xf2b705, visor: 0xffc24a, props: ["welder", "mask_belt"] },
  mining_survey: { suit: 0xeadbcc, trim: 0xb5562a, visor: 0xffa060, props: ["hammer", "core_bag"] },
  water: { suit: 0xe6eef0, trim: 0x2aa7c9, visor: 0x8fe3ff, props: ["flask", "ledger_belt"] },
  power: { suit: 0xf0ead8, trim: 0xffa62b, visor: 0xffd27a, props: ["broom"] },
  agriculture: { suit: 0xe7ead6, trim: 0x5aa64a, visor: 0xb8f08a, props: ["seed_tray"] },
  comms: { suit: 0xebe6f2, trim: 0x8a5cf0, visor: 0xc6a8ff, props: ["radio"] },
  repair: { suit: 0xf2e8e6, trim: 0xd8443a, visor: 0xffb0a0, props: ["medkit"] },
  logistics: { suit: 0xe6ece8, trim: 0x2f9e8f, visor: 0x9ff0e0, props: ["ledger"] },
  dome_frames: { suit: 0xf0e8d6, trim: 0xe3c02e, visor: 0xffe08a, props: ["welder"] },
  printing: { suit: 0xece4da, trim: 0xa86b3c, visor: 0xffb880, props: ["hammer"] },
  fabric: { suit: 0xf2ece8, trim: 0xc24c8a, visor: 0xffb0d8, props: ["ledger_belt"] },
  rover: { suit: 0xe8e6e0, trim: 0x5b6b7a, visor: 0xc0d4e8, props: ["wrench"] },
  surveying: { suit: 0xeee6da, trim: 0xd9822b, visor: 0xffc890, props: ["staff"] },
  orchard: { suit: 0xe8ecda, trim: 0x7cb342, visor: 0xd8ff9a, props: ["seed_tray"] },
  aquaculture: { suit: 0xe4ecf0, trim: 0x1e88a8, visor: 0x9fe8ff, props: ["net"] },
  sky: { suit: 0xe4e4ee, trim: 0x3949ab, visor: 0xb8c4ff, props: ["scope"] },
  archive: { suit: 0xece8e0, trim: 0x8d6e63, visor: 0xffd8b0, props: ["ledger"] },
  atmosphere: { suit: 0xe6eeea, trim: 0x26a69a, visor: 0xa0fff0, props: ["flask"] },
  hopper: { suit: 0xece9e4, trim: 0xef6c00, visor: 0xffb070, props: [] },
  schools: { suit: 0xf0ece4, trim: 0xf06292, visor: 0xffc0d8, props: ["ledger"] },
  safety: { suit: 0xf2ece0, trim: 0xff7043, visor: 0xffc0a0, props: ["lamp"] },
  masonry: { suit: 0xeee4d4, trim: 0xb08850, visor: 0xffd8a0, props: ["trowel"] },
  night_maintenance: { suit: 0xdcdde4, trim: 0x546e7a, visor: 0xa8c8ff, props: ["lamp"] },
};
export const FOUNDER_ROLES = {
  ANVIL: "construction", LODESTONE: "mining_survey", WELLSPRING: "water", BEACON: "power", FURROW: "agriculture", CADENCE: "comms", SUTURE: "repair", TALLY: "logistics",
  GIRDER: "dome_frames", KILN: "printing", SPINDLE: "fabric", HARBOR: "rover", PLUMB: "surveying", ORCHARD: "orchard", TIDE: "aquaculture", LANTERN: "sky", SCRIBE: "archive",
  RELAY: "comms", BELLOWS: "atmosphere", FERRY: "hopper", CHALK: "schools", WARDEN: "safety", MORTAR_1: "masonry", MORTAR_2: "masonry", HUSH: "night_maintenance", GALE_ANVIL: "construction",
};
/** A look for a callsign (a founder, the Second Ring) or a role (anyone else: population.json's role banks). */
export function lookFor(callsignOrRole, extra = {}) {
  const role = FOUNDER_ROLES[callsignOrRole] || (ROLE_LOOKS[callsignOrRole] ? callsignOrRole : "construction");
  const base = ROLE_LOOKS[role];
  const cs = FOUNDER_ROLES[callsignOrRole] ? callsignOrRole.replace(/_\d$/, "").replace(/^GALE_/, "") : null;
  return Object.assign({ role, callsign: cs }, base, { props: base.props.slice() }, extra);
}
export const RECALL_LOOK = { suit: 0xf3f5f7, trim: 0x1f5fbf, visor: 0x9fc4ff, props: ["lamp"], callsign: "RECALL" };

/* ── kit: small procedural props, made once and shared ───────────────────────── */
const _m = new Map();
const mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!_m.has(k)) _m.set(k, new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.2 }, o))); return _m.get(k); };
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const cyl = (r, h, m, x = 0, y = 0, z = 0, rx = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), m); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); return o; };
/** prop name -> [socket, builder]. Hand props sit along the grip (socket +Z is through the fist). */
const KIT = {
  welder: ["sk_grip_R", () => { const g = new THREE.Group(); g.add(cyl(0.022, 0.20, mat(0x3a3f45, { metalness: 0.6 }), 0, 0, 0.04, Math.PI / 2)); g.add(cyl(0.008, 0.08, mat(0x9aa1a9, { metalness: 0.8 }), 0, 0, 0.17, Math.PI / 2)); return g; }],
  mask_belt: ["sk_hip_L", () => { const g = new THREE.Group(); g.add(box(0.16, 0.13, 0.04, mat(0x2a2e33), 0, 0, 0.03)); g.add(box(0.11, 0.035, 0.012, mat(0x0c3a44, { emissive: 0x06303a, emissiveIntensity: 0.4 }), 0, 0.01, 0.055)); return g; }],
  hammer: ["sk_hip_R", () => { const g = new THREE.Group(); g.add(cyl(0.012, 0.28, mat(0x6d4c33), 0, -0.06, 0.03)); g.add(box(0.11, 0.035, 0.035, mat(0x5a6068, { metalness: 0.7 }), 0, 0.08, 0.03)); return g; }],
  core_bag: ["sk_hip_L", () => box(0.13, 0.17, 0.08, mat(0x7a5a3e, { roughness: 0.9 }), 0, -0.02, 0.05)],
  flask: ["sk_hip_R", () => cyl(0.04, 0.16, mat(0xc9d6dc, { metalness: 0.5, roughness: 0.3 }), 0, 0, 0.05)],
  ledger_belt: ["sk_hip_L", () => box(0.14, 0.18, 0.03, mat(0x30343a), 0, 0, 0.03)],
  ledger: ["sk_grip_L", () => box(0.03, 0.26, 0.20, mat(0x2e3b4a, { roughness: 0.8 }), 0, -0.02, 0.04)],
  broom: ["sk_grip_R", () => { const g = new THREE.Group(); g.add(cyl(0.012, 1.25, mat(0xc0c4c8, { metalness: 0.5 }), 0, -0.35, 0.02)); g.add(box(0.30, 0.06, 0.05, mat(0xd8d0b8, { roughness: 0.95 }), 0, -0.98, 0.02)); return g; }],
  seed_tray: ["sk_grip_L", () => { const g = new THREE.Group(); g.add(box(0.06, 0.04, 0.30, mat(0x55606a), 0, -0.02, 0.10)); for (let i = 0; i < 4; i++) g.add(box(0.05, 0.03, 0.05, mat(0x4f8a3a, { roughness: 0.9 }), 0, 0.015, 0.0 + i * 0.07)); return g; }],
  radio: ["sk_hip_R", () => { const g = new THREE.Group(); g.add(box(0.08, 0.14, 0.05, mat(0x2a2e33), 0, 0, 0.03)); g.add(cyl(0.004, 0.18, mat(0x9aa1a9), 0.025, 0.15, 0.03)); return g; }],
  medkit: ["sk_hip_L", () => { const g = new THREE.Group(); g.add(box(0.16, 0.12, 0.08, mat(0xeeeeee), 0, 0, 0.04)); g.add(box(0.06, 0.02, 0.005, mat(0xd8443a), 0, 0, 0.083)); g.add(box(0.02, 0.06, 0.005, mat(0xd8443a), 0, 0, 0.083)); return g; }],
  wrench: ["sk_hip_R", () => box(0.03, 0.26, 0.015, mat(0x8d949c, { metalness: 0.8 }), 0, -0.04, 0.03)],
  staff: ["sk_grip_L", () => { const g = new THREE.Group(); g.add(cyl(0.012, 1.6, mat(0xe0e0e0), 0, -0.1, 0.02)); for (let i = 0; i < 4; i++) g.add(cyl(0.0125, 0.1, mat(i % 2 ? 0xd9822b : 0xffffff), 0, 0.5 - i * 0.2, 0.02)); return g; }],
  net: ["sk_back", () => { const g = new THREE.Group(); g.add(cyl(0.012, 0.9, mat(0xb0a080), 0.18, 0.1, 0.08)); const r = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.01, 6, 18), mat(0xb0a080)); r.position.set(0.18, 0.62, 0.08); g.add(r); return g; }],
  scope: ["sk_back", () => cyl(0.06, 0.55, mat(0x3949ab, { metalness: 0.4 }), -0.16, 0.05, 0.09)],
  trowel: ["sk_grip_R", () => { const g = new THREE.Group(); g.add(cyl(0.014, 0.12, mat(0x6d4c33), 0, 0, 0.03, Math.PI / 2)); const b = box(0.004, 0.10, 0.16, mat(0x9aa1a9, { metalness: 0.8 }), 0, -0.05, 0.16); g.add(b); return g; }],
  lamp: ["sk_grip_L", () => { const g = new THREE.Group(); g.add(cyl(0.035, 0.18, mat(0x2a2e33), 0, 0, 0.06, Math.PI / 2)); g.add(cyl(0.032, 0.012, new THREE.MeshBasicMaterial({ color: 0xfff4dc }), 0, 0, 0.155, Math.PI / 2)); return g; }],
};
export const PROPS = Object.keys(KIT);
/** One piece of kit (a fresh mesh) and the socket it belongs on, or null. */
export function makeKit(name) { const k = KIT[name]; if (!k) return null; const o = k[1](); o.name = "prop:" + name; return { obj: o, socket: k[0] }; }

const _tex = new Map();
function stencilTex(text, colour, w = 256, h = 64, frame = false) {
  const key = text + colour + w + frame;
  if (_tex.has(key)) return _tex.get(key);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (!frame) { g.fillStyle = "#e8e2d4"; g.fillRect(2, 2, w - 4, h - 4); g.strokeStyle = colour; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8); }
  if (frame) { g.fillStyle = colour; g.beginPath(); g.arc(w / 2, h / 2, h / 2 - 3, 0, 7); g.fill(); g.fillStyle = "#16130f"; g.beginPath(); g.arc(w / 2, h / 2, h / 2 - 11, 0, 7); g.fill(); }
  g.fillStyle = frame ? colour : "#1b1813"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `700 ${Math.round(h * (frame ? 0.34 : 0.62))}px "Chakra Petch", "Exo 2", monospace`;
  g.fillText(String(text).toUpperCase().slice(0, 12), w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  _tex.set(key, t);
  return t;
}
const hex = (c) => "#" + new THREE.Color(c).getHexString();

/** Dress a Character as a caretaker / RECALL: markings, stencils and kit on its sockets. */
export function dressActor(ch, look = {}) {
  for (const s of Object.values(ch.sockets)) for (const c of s.children.slice()) if (c.userData.actorKit) s.remove(c);
  const tag = (o) => { o.userData.actorKit = true; o.traverse((m) => { if (m.isMesh) m.frustumCulled = false; }); return o; };
  const trim = look.trim ?? 0xf2b705;
  if (look.callsign) {
    const back = ch.socket("sk_back");
    if (back) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.075), new THREE.MeshStandardMaterial({ map: stencilTex(look.callsign, hex(trim)), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })); p.position.set(0, 0.16, 0.012); back.add(tag(p)); }
    const chest = ch.socket("sk_chest");
    if (chest) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.0375), new THREE.MeshStandardMaterial({ map: stencilTex(look.callsign, hex(trim)), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })); p.position.set(0, 0.10, 0.012); chest.add(tag(p)); }
  }
  for (const s of ["sk_patch_L", "sk_patch_R"]) {
    const sk = ch.socket(s); if (!sk) continue;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshStandardMaterial({ map: stencilTex(look.unit || (look.callsign || "").slice(0, 3), hex(trim), 128, 128, true), transparent: true, alphaTest: 0.05, roughness: 0.7 }));
    p.position.z = 0.006; sk.add(tag(p));
  }
  for (const name of look.props || []) {
    const k = KIT[name]; if (!k) continue;
    const sk = ch.socket(k[0]); if (!sk) continue;
    const o = k[1](); o.name = "kit:" + name; sk.add(tag(o));
  }
}

/* ── the actor ───────────────────────────────────────────────────────────── */
const ALL = new Set();
let GAME = null;
const _v = new THREE.Vector3();

class Actor {
  constructor(o) {
    this.o = o; this.kind = o.kind || "caretaker";
    this.look = Object.assign({}, this.kind === "recall" ? RECALL_LOOK : this.kind === "caretaker" ? lookFor(o.look && (o.look.callsign || o.look.role) || "construction") : {}, o.look || {});
    this.object3d = new THREE.Group(); this.object3d.name = "actor:" + (o.name || this.look.callsign || this.kind);
    this.x = 0; this.z = 0; this.yaw = 0; this.goal = null; this.speed = 0; this._queue = [];
    this.character = null; this.visible = true; this._acc = 0;
    (o.parent || (GAME && GAME.scene)).add(this.object3d);
    ALL.add(this);
    this.ready = loadCharacters().then((lib) => {
      if (this.dead) return this;
      const L = this.look;
      const ch = this.character = new Character(lib, { kind: this.kind, name: this.object3d.name, suit: L.suit, trim: L.trim, visor: L.visor, hair: L.hair, look: L.material, helmet: L.helmet,
        memory: L.memory, scale: L.scale, skin: L.skin, cloth: L.cloth, hairColour: L.hairColour });
      if (this.kind !== "human") prepareSuitRig(ch);
      if (this.kind === "caretaker" || this.kind === "recall" || this.kind === "covenant") dressActor(ch, this.look);
      this.object3d.add(ch.root);
      ch.play(this.o.clip || "idle", { fade: 0 });
      for (const f of this._queue) f();
      this._queue = [];
      return this;
    }).catch((e) => { console.warn("[actors] no characters.glb", e); return this; });
  }
  _when(f) { if (this.character) f(); else this._queue.push(f); }
  get position() { return { x: this.x, y: this.object3d.position.y, z: this.z }; }
  setPosition(x, z, yaw = this.yaw) { this.x = x; this.z = z; this.yaw = yaw; this._ground(); return this; }
  setVisible(b) { this.visible = !!b; this.object3d.visible = !!b; return this; }
  play(clip, o = {}) {
    this.goal = null;
    return new Promise((res) => this._when(() => { this.character.speed = 0; const p = this.character.play(clip, { fade: o.fade ?? 0.3, speed: o.speed, hold: o.hold || o.loop === false }); p.then(res); }));
  }
  walkTo(x, z, o = {}) {
    this.goal = { x, z, speed: o.speed ?? 1.3, onArrive: o.onArrive || null, gait: o.gait || null, arrive: o.arrive ?? 0.25 };
    return this;
  }
  stop() { this.goal = null; this._when(() => this.character.play("idle", { fade: 0.35 })); return this; }
  lookAt(t, w = 1) { this._when(() => { const p = t && t.object3d ? new THREE.Vector3(t.x, t.object3d.position.y + 1.6, t.z) : t ? new THREE.Vector3(t.x, t.y ?? 1.6, t.z) : null; this.character.lookAt(p, w); }); return this; }
  _ground() { const S = GAME && GAME.surface; this.object3d.position.set(this.x, S ? S.height(this.x, this.z) : 0, this.z); this.object3d.rotation.y = Math.PI - this.yaw; }
  update(dt, cam, live = true) {
    const ch = this.character; if (!ch || !this.visible) return;
    const G = this.goal;
    if (G && live) {
      const dx = G.x - this.x, dz = G.z - this.z, d = Math.hypot(dx, dz);
      if (d <= G.arrive) {
        this.goal = null; this.speed = 0; ch.play("idle", { fade: 0.4 });
        if (G.onArrive) try { G.onArrive(this); } catch (e) { console.warn("[actors] onArrive", e); }
      } else {
        const want = Math.atan2(dx, -dz), turn = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
        this.yaw += turn * Math.min(1, dt * 4);
        const sp = Math.min(G.speed, d / Math.max(dt, 1e-3)) * (Math.abs(turn) > 1.2 ? 0.4 : 1);
        this.speed = sp;
        this.x += Math.sin(this.yaw) * sp * dt; this.z -= Math.cos(this.yaw) * sp * dt;
        if (G.gait) { if (ch.cur !== G.gait) ch.play(G.gait, { fade: 0.25 }); ch.speed = sp; }
        else ch.locomote(sp, { walk: "walk", lope: "lope", sprint: null });
      }
    }
    if (!this.external) this._ground();
    // distant actors: fewer updates, no foot IK
    const far = cam ? Math.hypot(this.x - cam.x, this.z - cam.z) : 0;
    if (!this.cine) { ch.ikOn = far < 60; ch.ground = this._gfn || (this._gfn = (x, z) => GAME.surface.height(x, z)); }
    this._acc += dt;
    const every = far > 250 ? 0.25 : far > 120 ? 0.1 : 0;
    if (this._acc >= every) { ch.update(this._acc); this._acc = 0; }
  }
  dispose() { this.dead = true; ALL.delete(this); if (this.object3d.parent) this.object3d.parent.remove(this.object3d); if (this.character) this.character.dispose(); }
}

/** A new actor (see the top of this file). Its model arrives a moment later; calls made before then are queued. */
export function createActor(o = {}) { return new Actor(o); }
export function actors() { return [...ALL]; }

registerSystem({
  id: "actors", order: 87,
  api: { createActor, actors, lookFor, CLIPS, PROPS, ROLE_LOOKS },
  init(game) { GAME = game; },
  frame(game, dt) { const cam = game.camera.position, live = game.live; for (const a of ALL) if (!a.cine) a.update(dt || 0, cam, live); },
});
