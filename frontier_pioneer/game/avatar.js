/**
 * THE ASTRONAUT ON FOOT: movement on the real ground, the suit, the picture
 * and its animation, the on-foot cameras, and the suit HUD.
 *
 * System "avatar" (order 60). Publishes
 *
 *   getSystem("avatar").api = {
 *     active, onFoot, inVehicle, inside,          // who the player is right now
 *     position: {x, y, z}, heading,               // the active body (the walker, or the rover)
 *     suit: { o2, power, co2, temp, integrity,    // 0..1 fractions (temp in deg C; co2 = scrubber cartridge left)
 *             co2_kPa, timeLeft_s, limiting, emergency, sop_s, dose_mSv, refuge, safeRange_m, turnBack },
 *     exitVehicle(), enterVehicle(), refill(why), recover(cause), on(event, fn)
 *   }
 *
 * GROUND. The walker stands on game.surface.height(): the same function the
 * renderer draws and the wheels feel. Rocks of 0.45 m and more, the rover and
 * placed base modules are simple colliders (circles and one oriented box).
 * Slope is limited by what the regolith map says is underfoot: 38 degrees on
 * firm ground, 26 on loose sand; steeper than that the walker cannot climb
 * and slides back.
 *
 * TWO CLOCKS, as everywhere: movement is in real seconds, the suit's
 * consumables are per SIMULATED second (state.clock.scale per real one), so
 * the suit and the Sun agree about how long an EVA is.
 *
 * THE PICTURE. The NASA suit rigged on the Kestrel skeleton (game/charrig.js,
 * assets/models/characters.glb, built in Blender by tools/assets/build_characters.py)
 * and its authored clips: idle, walk, lope and sprint blended by speed and
 * phase-locked to the ground speed (no foot sliding), the hop in three parts
 * (dip, a 1.4 s float, the landing), crouch, slip, a scramble on steep ground,
 * turning on the spot, and the EVA poses (coring, scanning, setting down). The
 * feet are re-planted on uneven ground by two-bone IK. See Avatar._animate.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { MARS, CAMERA } from "./config.js?v=6d37c9c-9b39e129";
import { registerSystem, getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { advanceClock } from "./state.js?v=6d37c9c-9b39e129";
import { DRIVING_HELP } from "./input.js?v=6d37c9c-9b39e129";
import { setRing, ringLevel, ringHTML } from "./hud.js?v=6d37c9c-9b39e129";
import { loadCharacters, Character } from "./charrig.js?v=6d37c9c-9b39e129";
import { prepareSuitRig } from "./cosmetics.js?v=6d37c9c-9b39e129";

/** Suit upgrades and mods (game/progress.js) scale a few numbers below through these factors (1 = the stock suit). They are
 *  read by getters in WALK and SUIT, so every use of WALK.x / SUIT.x sees them; the suit's own code is unchanged. */
export const SUIT_MODS = { o2: 1, power: 1, scrub: 1, scrubW: 1, sprint: 1, hop: 1, air: 1, rad: 1, dust: 1 };

export const WALK = {
  walk: 1.3, run: 3.0, get sprint() { return 4.5 * SUIT_MODS.sprint; }, aim: 0.7, crouch: 0.6,     // m/s
  accel: 9, brake: 11, get air() { return 1.2 * SUIT_MODS.air; },                                   // m/s^2
  get jumpV0() { return 2.6 * SUIT_MODS.hop; }, jumpCooldown: 0.30,                                // m/s, s: apex 0.91 m, 1.40 s of flight at 3.71 m/s^2
  radius: 0.28, slopeFirm: 38, slopeSand: 26, slopeBand: 8,    // degrees
  fallSafe: 4.5, fallDamage: 0.09,                             // m/s landing speed that starts to hurt; integrity lost per m/s above it
  rockSolid: 0.45,                                             // rocks this size and up are obstacles; smaller are stepped over
};

/** The suit, in physical units. Rates are per SIMULATED second. */
export const SUIT = {
  get o2_kg() { return 0.60 * SUIT_MODS.o2; },          // primary oxygen (an EMU-class tank: about 8 h at 250 W)
  get battery_J() { return 3.6e6 * SUIT_MODS.power; },  // 1.0 kWh
  get scrubber_kg() { return 0.80 * SUIT_MODS.scrub; }, // CO2 the cartridge can take
  K_O2: 7.1e-8,                // kg of O2 per joule of metabolic work (1 litre per 20.1 kJ)
  CO2_PER_O2: 1.17,            // kg CO2 per kg O2 at a respiratory quotient of 0.85
  leak_kgps: 1.4e-6,           // suit leakage at full integrity (5 g an hour)
  M_rest: 115, M_a: 103, M_b: 0.7, sprintFactor: 1.2,   // metabolic watts = rest + a v + b v^2
  climbEff: 0.5, mass: 140,    // kg, astronaut + suit
  P_base: 60, P_pump: 0.08, P_light: 30,                // watts: avionics and fan; cooling pump per metabolic watt; helmet lamp
  heater_W_per_K: 0.9, heaterBelow_K: 263,              // glove and boot heaters: 0.9 W per kelvin below -10 C
  get scrubCap_W() { return 520 * SUIT_MODS.scrubW; },   // the scrubber keeps up with this much metabolic rate; sprinting outruns it
  co2Gain: 5.3e-6, co2Base: 0.3, co2Warn: 1.0, co2Limit: 2.0, co2Emergency: 4.0,   // kPa
  tempSet: 21, UA: 2.5, C: 6e4, tempLow: 5, tempHigh: 40,
  sop_s: 1800,                 // secondary oxygen pack: the emergency window (30 simulated minutes)
  reserve: 1.15,               // the walk home is costed 15% long
  turnBack: 1.25,              // warn when the refuge is further than (what the suit covers) / 1.25
  penalty_s: 4 * 3600,         // waking at the refuge costs four hours of the sol
  integrityFail: 0.15,
};

export const metabolic = (v, { sprint = false, climb = 0, sand = 0 } = {}) => {
  let m = SUIT.M_a * v + SUIT.M_b * v * v;
  if (sprint && v > WALK.run + 0.2) m *= SUIT.sprintFactor;
  m *= 1 + 0.4 * sand;
  return SUIT.M_rest + m + SUIT.mass * MARS.gravity * Math.max(0, climb) / SUIT.climbEff;
};
/** Metres of walking the given oxygen and battery cover, at walking pace, costed with the reserve. */
export function safeRange(suit, scale, powerW) {
  const perMetre = scale / WALK.walk * SUIT.reserve;
  const o2 = suit.o2 / ((metabolic(WALK.walk) * SUIT.K_O2 + leakRate(suit.integrity)) * perMetre);
  const pw = suit.power / (Math.max(40, powerW) * perMetre);
  return { o2, power: pw, range: Math.min(o2, pw), limiting: o2 <= pw ? "O2" : "power" };
}
const leakRate = (integrity) => SUIT.leak_kgps * (1 + 60 * (1 - integrity) * (1 - integrity));

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ"), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _c = new THREE.Color();
const SUB = 1 / 120;
const L_LEG = 0.6236;            // hip pivot above the sole, from the kit
const HIP_X = 0.1772, HIP_Z = 0.0987;
const FOOTPRINTS = 160, PUFFS = 14;

function radialTexture(stops, size = 64) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"), r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) r.addColorStop(o, col);
  g.fillStyle = r; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
  return t;
}
function bootTexture() {
  const c = document.createElement("canvas"); c.width = 32; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, 32, 64);
  g.fillStyle = "#909090";
  g.beginPath(); g.ellipse(16, 22, 10, 17, 0, 0, TAU); g.fill();          // sole
  g.beginPath(); g.ellipse(16, 51, 8, 9, 0, 0, TAU); g.fill();            // heel
  g.fillStyle = "#ffffff";
  for (let y = 9; y < 60; y += 6) g.fillRect(7, y, 18, 2);                // tread bars
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
  return t;
}
/** A shadow-like decal: black, with the texture as its alpha. */
function darkenMaterial(map, opacity) {
  return new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: map, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false });
}

export class Avatar {
  constructor(game) {
    this.game = game;
    this.p = new THREE.Vector3();           // the soles, world
    this.q = new THREE.Quaternion();        // facing (so anything that follows a vehicle can follow this)
    this.vel = new THREE.Vector3();
    this.yaw = 0;                           // radians clockwise from north
    this.grounded = true; this.airT = 0; this.lastAir = 0; this.jumpCd = 0; this.stun = 0;
    this.crouch = false; this.light = false; this.onFoot = false; this.inside = null;
    this.t = { speed: 0, heading: 0, slope: 0, sand: 0, slipping: false, airborne: false, stance: "STAND", maxSlope: WALK.slopeFirm, M: SUIT.M_rest, power_W: SUIT.P_base };
    this.suit = this._fullSuit();
    this.stats = { evas: 0, walked_m: 0, eva_s: 0, hops: 0, falls: 0, emergencies: 0, recoveries: 0, o2_kg: 0 };
    this.evaStart = null; this.evaWalked = 0;
    this.emergency = null;
    this.cam = { mode: "third", yaw: 0, pitch: 0.2, dist: 4.4, y: 0, fov: CAMERA.fov, shake: 0 };
    this.in = { mx: 0, mz: 0, sprint: false, aim: false, jump: false };
    this.override = null;                   // tests and the touch stick: {mx, mz (world frame), sprint, aim, jump}
    this.pose = null;                       // eva.js: {kind: "drill" | "scan" | "place", k: 0..1}
    this.gait = { u: 0, amp: 0, move: 0, lean: 0.03, hip: L_LEG, slope: 0, land: 0, air: 0, turn: 0, foot: -1 };
    this.listeners = {};
    this._drag = { x: 0, y: 0 }; this._zoom = 1; this._jumpQ = false; this._acc = 0;
    this._rate = { o2: 0, pw: 0 }; this._hudT = 0; this._lastYaw = 0;
    this.group = new THREE.Group(); this.group.name = "astronaut"; this.group.visible = false;
    this.parts = null;
  }
  // the streaming focus and the HUD read these
  get x() { return this.p.x; } get z() { return this.p.z; } get y() { return this.p.y; }
  get heading() { return this.t.heading; }
  on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  emit(name, d) { for (const f of this.listeners[name] || []) { try { f(d); } catch (e) { console.error("[avatar]", e); } } this.game.emit("eva:" + name, d); }
  _fullSuit() { return { o2: SUIT.o2_kg, power: SUIT.battery_J, scrubber: SUIT.scrubber_kg, co2: SUIT.co2Base, temp: SUIT.tempSet, integrity: 1, sop: SUIT.sop_s, dose: 0 }; }

  /* ── the picture ─────────────────────────────────────────────────────── */

  async build() {
    const g = this.game;
    let lib = null;
    try { lib = await loadCharacters(); } catch (e) { console.warn("[avatar] characters.glb did not load: primitives instead", e); lib = null; }
    if (lib) {
      const ch = this.rig = new Character(lib, { kind: "pioneer", name: "pioneer" });
      prepareSuitRig(ch);                                  // the kit's suit is close to white and burns out under this Sun
      this.body = ch.root; this.group.add(ch.root);
      const B = ch.bones;
      this.parts = { torso: B.get("chest"), head: B.get("head"), armL: B.get("upperarm_L"), armR: B.get("upperarm_R"), legL: B.get("thigh_L"), legR: B.get("thigh_R") };
      this.source = "glb:characters.glb";
      ch.play("idle", { fade: 0 });
    } else {
      const body = new THREE.Group(); body.name = "astronaut-body";
      this.body = body; this.group.add(body);
      this.parts = this._primitive(body);
      this.source = "primitive";
    }
    const p = this.parts;
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.1 }, o));
    // the corer and the scanner live in the right hand (the arm's own frame: it points along -X from the shoulder)
    const drill = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 10), mat(0x8d949c, { metalness: 0.6, roughness: 0.35 }));
    const bit = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), mat(0x2b2f35, { metalness: 0.8, roughness: 0.3 }));
    bit.position.y = 0.3; drill.add(barrel, bit); drill.visible = false;
    if (this.rig) { drill.rotation.x = Math.PI / 2; drill.position.set(0, -0.02, 0.06); this.rig.attach("sk_grip_R", drill); }
    else { drill.rotation.z = Math.PI / 2; drill.position.set(-0.72, 0, 0.02); p.armR.add(drill); }
    this.drill = drill; this.bit = bit;
    const scanner = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.1), mat(0x30363d));
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    scanner.visible = false;
    if (this.rig) { scanner.rotation.y = Math.PI / 2; eye.position.x = -0.085; scanner.add(eye); scanner.position.set(0, 0, 0.07); this.rig.attach("sk_grip_R", scanner); }
    else { eye.position.x = -0.085; scanner.add(eye); scanner.position.set(-0.66, 0, 0.02); p.armR.add(scanner); }
    this.scanner = scanner;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.reticle.rotation.x = -Math.PI / 2; this.reticle.visible = false;

    // contact shadow, footprints, dust
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), darkenMaterial(radialTexture([[0, "#ffffff"], [0.4, "#a0a0a0"], [1, "#000"]]), 0.5));
    this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 2;
    this.prints = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15, 0.33).rotateX(-Math.PI / 2), darkenMaterial(bootTexture(), 0.34), FOOTPRINTS);
    this.prints.frustumCulled = false; this.prints.count = 0; this.prints.renderOrder = 1; this.prints.name = "footprints";
    this.printList = []; this.printHead = 0;
    const puffTex = radialTexture([[0, "rgba(255,255,255,0.9)"], [0.5, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]);
    this.puffs = [];
    for (let i = 0; i < PUFFS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0, color: 0xb98a63 }));
      s.visible = false; this.puffs.push({ s, t: 1, life: 1, v: new THREE.Vector3(), size: 0.3 });
    }
    this.fx = new THREE.Group(); this.fx.name = "astronaut-fx";
    this.fx.add(this.blob, this.prints, this.reticle, ...this.puffs.map((x) => x.s));
    g.scene.add(this.group, this.fx);
  }

  /** Six boxes, if characters.glb is not there (no animation: the game still plays). */
  _primitive(body) {
    const m = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.7 });
    const box = (w, h, d, x, y, z, parent) => { const g = new THREE.Group(); g.position.set(x, y, z); const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.add(b); parent.add(g); return [g, b]; };
    const [torso, tb] = box(0.5, 0.75, 0.32, 0, L_LEG, 0.0886, body); tb.position.y = 0.42;
    const [head, hb] = box(0.3, 0.3, 0.3, 0, 0.9746, -0.1, torso); hb.position.y = 0.12;
    const [armL, al] = box(0.6, 0.14, 0.14, 0.349, 0.772, 0, torso); al.position.x = 0.3; armL.rotation.z = -72 * DEG;
    const [armR, ar] = box(0.6, 0.14, 0.14, -0.349, 0.772, 0, torso); ar.position.x = -0.3; armR.rotation.z = 72 * DEG;
    const [legL, ll] = box(0.2, L_LEG, 0.22, HIP_X, 0, 0.01, torso); ll.position.y = -L_LEG / 2;
    const [legR, lr] = box(0.2, L_LEG, 0.22, -HIP_X, 0, 0.01, torso); lr.position.y = -L_LEG / 2;
    return { torso, head, armL, armR, legL, legR };
  }

  /* ── mode ────────────────────────────────────────────────────────────── */

  /** Step out behind the rover. Returns false if there is nowhere to stand. */
  exitVehicle() {
    const g = this.game, v = g.vehicle, S = g.surface;
    if (this.onFoot || !this.parts) return false;
    const fw = _a.set(0, 0, -1).applyQuaternion(v.q); fw.y = 0; fw.normalize();
    const head = Math.atan2(fw.x, -fw.z), half = v.def.box.length / 2 + 0.55;
    const tries = [[0, half + 1.3], [0, half + 2.4], [v.def.box.width / 2 + 1.7, half - 0.6], [-v.def.box.width / 2 - 1.7, half - 0.6]];
    let spot = null;
    for (const [sx, sz] of tries) {
      const x = v.p.x - fw.x * sz + Math.cos(head) * sx, z = v.p.z - fw.z * sz + Math.sin(head) * sx;
      if (S.slopeDeg(x, z, 0.8) < 30 && g.site.inside(x, z, 70)) { spot = { x, z }; break; }
    }
    if (!spot) spot = { x: v.p.x - fw.x * (half + 1.3), z: v.p.z - fw.z * (half + 1.3) };
    this.place(spot.x, spot.z, head + Math.PI - 0.6);
    this.cam.yaw = head + 0.45; this.cam.pitch = 0.2; this.cam.dist = 5.6; this.cam.y = this.p.y + 0.85;
    this.onFoot = true; this.inside = null; this.group.visible = true;
    this.evaStart = { sol: g.state.clock.sol, tod: g.state.clock.tod }; this.evaWalked = 0; this.stats.evas++;
    if (g.warp) g.setWarp(false);
    g.focus = this;
    g.setMode("onfoot");
    this.emit("exit", { x: this.p.x, z: this.p.z });
    return true;
  }
  /** Back into the rover: the suit is recharged from the rover and the EVA ends. */
  enterVehicle(silent = false) {
    const g = this.game;
    this.onFoot = false; this.inside = null; this.group.visible = false; this.emergency = null; this.pose = null;
    this.refill("rover");
    g.focus = null;
    g.camera.fov = CAMERA.fov; g.camera.updateProjectionMatrix();
    if (g.rig) { g.rig.followYaw = null; g.rig.recentre(); }
    g.lamp = null;
    if (g.mode !== "driving") { if (g.mode === "menu" || g.mode === "complete") g._resumeMode = "driving"; else g.setMode("driving"); }
    if (!silent) this.emit("enter", { walked_m: this.evaWalked });
  }
  place(x, z, yaw = this.yaw) {
    this.p.set(x, this.game.surface.height(x, z), z);
    this.vel.set(0, 0, 0); this.yaw = yaw; this.grounded = true; this.airT = 0; this.stun = 0;
    this.gait.hip = L_LEG; this.cam.y = this.p.y + 0.85;
    this.q.setFromAxisAngle(_a.set(0, 1, 0), -yaw);
  }
  refill(why = "rover") {
    const s = this.suit, g = this.game, used = SUIT.battery_J - s.power;
    if (why === "rover" && g.vehicle && used > 0) g.vehicle.battery = Math.max(0, g.vehicle.battery - used / 0.9);
    const dose = s.dose;
    this.suit = this._fullSuit(); this.suit.dose = dose;
    this.emergency = null;
    g.hud.setAlert && g.hud.setAlert("suit", null);
    this.emit("refill", { why });
  }
  /** The emergency window ran out: wake at the nearest refuge, four hours later, without the samples. */
  recover(cause = "O2") {
    const g = this.game, ref = this.refuge();
    advanceClock(g.state.clock, SUIT.penalty_s);
    this.stats.recoveries++;
    const detail = { cause, penalty_s: SUIT.penalty_s, at: ref.kind, lost: 0 };
    this.emit("blackout", detail);                       // eva.js empties the sample bag here and reports how many
    if (ref.kind === "airlock" && ref.enter) { ref.enter(); this.refill("base"); this.inside = { kind: "airlock", id: ref.id, x: ref.x, z: ref.z }; this.group.visible = false; }
    else this.enterVehicle(true);
    g.hud.toast(`You blacked out (${cause})<small>The ${ref.kind === "airlock" ? "base crew" : "rover"} brought you in. ${Math.round(SUIT.penalty_s / 3600)} hours lost${detail.lost ? ", and the " + detail.lost + " sample" + (detail.lost > 1 ? "s" : "") + " you were carrying" : ""}.</small>`, 8);
    this.emit("recovered", detail);
    g.save();
    return detail;
  }

  /** Nearest place that ends an EVA: the rover's hatch, or a base airlock if the base system offers one. */
  refuge() {
    const g = this.game, v = g.vehicle;
    const out = { kind: "rover", x: v.p.x, z: v.p.z, d: Math.max(0, Math.hypot(v.p.x - this.p.x, v.p.z - this.p.z) - 3.2) };
    const base = getSystem("base"), api = base && base.api;
    if (api && typeof api.nearestAirlock === "function") {
      try {
        const a = api.nearestAirlock(this.p.x, this.p.z);
        const ax = a && (a.x ?? (a.def && a.def.x) ?? (a.position && a.position.x)), az = a && (a.z ?? (a.def && a.def.z) ?? (a.position && a.position.z));
        if (a && Number.isFinite(ax) && Number.isFinite(az)) {
          const id = a.id ?? (a.def && a.def.id), d = Math.hypot(ax - this.p.x, az - this.p.z);
          const c = typeof api.canEnter === "function" ? api.canEnter(id) : true, ok = a.usable !== false && (c === true || !!(c && c.ok));
          if (ok && d < out.d) Object.assign(out, { kind: "airlock", x: ax, z: az, d, id, name: a.name, enter: () => { try { const r = api.enter && api.enter(id); return !r || r.ok !== false; } catch (e) { console.warn("[avatar] base.enter", e); return false; } } });
        }
      } catch (e) { /* the base system is not ready: the rover is the refuge */ }
    }
    return out;
  }

  /* ── input ───────────────────────────────────────────────────────────── */

  _readInput(dt) {
    const g = this.game, k = g.input.keys, P = window.GeoIDPad, I = this.in;
    let fx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), fz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    let mag = Math.hypot(fx, fz); if (mag > 1) { fx /= mag; fz /= mag; mag = 1; }
    let sprint = !!(k.ShiftLeft || k.ShiftRight), aim = !!(k.KeyZ || this._rmb), lx = 0, ly = 0;
    if (mag > 0 && !sprint && !aim) { fx *= 0.72; fz *= 0.72; }             // keys are binary: walk-to-run without Shift is a steady lope
    if (P && P.connected && g.padMode === "flight") {
      const a = P.axes();
      if (Math.hypot(a.lx, a.ly) > mag) { fx = a.lx; fz = -a.ly; }
      sprint = sprint || a.r2 > 0.4; aim = aim || a.l2 > 0.4;
      lx = a.rx; ly = a.ry;
      if (Math.abs(a.lx) + Math.abs(a.ly) + Math.abs(a.rx) + Math.abs(a.ry) > 0.2) g.input.lastDevice = "pad";
    }
    if (this.touch) { if (Math.hypot(this.touch.x, this.touch.y) > Math.hypot(fx, fz)) { fx = this.touch.x; fz = -this.touch.y; } sprint = sprint || this.touch.run; }
    // look: stick as a rate, mouse drag as an angle
    const inv = g.settings.invertY ? -1 : 1, c = this.cam;
    c.yaw = wrap(c.yaw + lx * 2.4 * dt + this._drag.x);
    c.pitch = clamp(c.pitch + (ly * 1.6 * dt + this._drag.y) * inv, c.mode === "first" ? -1.2 : -0.35, 1.25);
    this._drag.x = 0; this._drag.y = 0;
    c.dist = clamp(c.dist * this._zoom, 2.2, 11); this._zoom = 1;
    // camera frame -> world
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    I.mx = fx * cy + fz * sy; I.mz = fx * sy - fz * cy;
    I.sprint = sprint; I.aim = aim; I.jump = this._jumpQ; this._jumpQ = false;
    if (this.override) { const o = this.override; I.mx = o.mx || 0; I.mz = o.mz || 0; I.sprint = !!o.sprint; I.aim = !!o.aim; I.jump = I.jump || !!o.jump; o.jump = false; }
  }

  /* ── physics ─────────────────────────────────────────────────────────── */

  maxSlope(sand) { return lerp(WALK.slopeFirm, WALK.slopeSand, clamp(sand, 0, 1)) + (this.crouch ? 5 : 0); }

  /** Push a point out of every solid thing near it. Returns the highest thing it may stand on. */
  _collide(pos, feetY) {
    const g = this.game, S = g.surface, R = g.rocks, r0 = WALK.radius;
    let stand = -Infinity;
    if (R && R.at) {
      const ci = Math.floor(pos.x / 2), cj = Math.floor(pos.z / 2);
      for (let b = cj - 1; b <= cj + 1; b++) for (let a = ci - 1; a <= ci + 1; a++) {
        const k = R.at(a, b);
        if (!k || k.size < WALK.rockSolid) continue;
        const rx = k.x, rz = k.z, rad = k.size * 0.62, top = S.height(rx, rz) + 1.1 * k.size * k.squash;
        const dx = pos.x - rx, dz = pos.z - rz, d = Math.hypot(dx, dz);
        if (d < rad && feetY >= top - 0.12) { stand = Math.max(stand, top); continue; }
        const min = rad + r0;
        if (d < min && feetY < top - 0.12) { const f = d > 1e-4 ? min / d : 1; pos.x = rx + (d > 1e-4 ? dx * f : min); pos.z = rz + dz * f; this._hit(dx, dz, d); }
      }
    }
    // the rover: one oriented box
    const v = g.vehicle;
    if (v) {
      _b.set(pos.x - v.p.x, 0, pos.z - v.p.z); const lq = _q.copy(v.q).invert(); _a.copy(_b).applyQuaternion(lq);
      const hx = v.def.box.width / 2 + 0.38 + r0, hz = v.def.box.length / 2 + 0.25 + r0;
      if (Math.abs(_a.x) < hx && Math.abs(_a.z) < hz && feetY < v.p.y + 2.2) {
        const px = hx - Math.abs(_a.x), pz = hz - Math.abs(_a.z);
        if (px < pz) _a.x = Math.sign(_a.x || 1) * hx; else _a.z = Math.sign(_a.z || 1) * hz;
        _a.y = 0; _a.applyQuaternion(v.q);
        const nx = v.p.x + _a.x, nz = v.p.z + _a.z; this._hit(pos.x - nx, pos.z - nz, 1, true);
        pos.x = nx; pos.z = nz;
      }
    }
    // base modules. The base system publishes its obstacle boxes ({x, z, hx, hz, c, s}: centre, half extents, frame); ask it.
    // Without it, anything on the placement layer with a real footprint is a circle (or its catalogue box).
    const base = getSystem("base"), boxes = base && Array.isArray(base.obstacles) ? base.obstacles : null;
    if (boxes) for (const o of boxes) {
      const dx = pos.x - o.x, dz = pos.z - o.z, reach = o.hx + o.hz + r0;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
      const qx = clamp(lx, -o.hx, o.hx), qz = clamp(lz, -o.hz, o.hz);
      let nx = lx - qx, nz = lz - qz, d = Math.hypot(nx, nz), depth;
      if (d > 1e-6) { if (d >= r0) continue; nx /= d; nz /= d; depth = r0 - d; }
      else { const ex = o.hx - Math.abs(lx), ez = o.hz - Math.abs(lz); if (ex < ez) { nx = Math.sign(lx) || 1; nz = 0; depth = ex + r0; } else { nx = 0; nz = Math.sign(lz) || 1; depth = ez + r0; } }
      const wx = nx * o.c + nz * o.s, wz = -nx * o.s + nz * o.c;
      pos.x += wx * depth; pos.z += wz * depth; this._hit(wx, wz, 1);
    }
    const E = g.entities;
    if (E && E.items) for (const e of E.items.values()) {
      const T = e.type; if (!T || T.walkThrough || T.kind === "marker" || !(T.footprint >= 0.6) || (boxes && T.kind === "base")) continue;
      const dx = pos.x - e.def.x, dz = pos.z - e.def.z, far = T.footprint * 1.5 + 3;
      if (Math.abs(dx) > far || Math.abs(dz) > far) continue;
      const d = Math.hypot(dx, dz), min = T.footprint + r0;
      if (d < min) { const f = d > 1e-4 ? min / d : 1; pos.x = e.def.x + (d > 1e-4 ? dx * f : min); pos.z = e.def.z + dz * f; this._hit(dx, dz, d); }
    }
    return stand;
  }
  _hit(dx, dz, d, stop = false) {
    if (stop || d < 1e-4) { this.vel.x *= 0.2; this.vel.z *= 0.2; return; }
    const nx = dx / d, nz = dz / d, into = this.vel.x * nx + this.vel.z * nz;
    if (into < 0) { this.vel.x -= nx * into; this.vel.z -= nz * into; }
  }

  _substep(dt) {
    const g = this.game, S = g.surface, I = this.in, t = this.t, v = this.vel;
    const reg = S.regolith(this.p.x, this.p.z), sand = reg.sand || 0;
    const n = S.normal(this.p.x, this.p.z, 0.6, _n);
    const slope = Math.acos(clamp(n.y, -1, 1)) / DEG, maxS = this.maxSlope(sand);
    const gl = Math.hypot(n.x, n.z), ux = gl > 1e-5 ? -n.x / gl : 0, uz = gl > 1e-5 ? -n.z / gl : 0;       // uphill, horizontal
    t.slope = slope; t.sand = sand; t.maxSlope = maxS;
    this.jumpCd = Math.max(0, this.jumpCd - dt); this.stun = Math.max(0, this.stun - dt);

    // what the player asks for
    let mag = Math.min(1, Math.hypot(I.mx, I.mz));
    const co2Slow = this.suit.co2 > SUIT.co2Limit, sprint = I.sprint && !I.aim && !this.crouch && !co2Slow && mag > 0.7;
    let top = I.aim ? WALK.aim : this.crouch ? WALK.crouch : sprint ? WALK.sprint : mag < 0.55 ? lerp(0, WALK.walk, mag / 0.55) : lerp(WALK.walk, WALK.run, (mag - 0.55) / 0.45);
    if (I.aim || this.crouch || sprint) top *= Math.min(1, mag * 1.4);
    if (co2Slow) top *= 0.75;
    if (this.emergency) top = Math.min(top, WALK.run * 0.85);
    if (this.stun > 0 || this.pose) top = 0;
    let wx = 0, wz = 0;
    if (mag > 0.02 && top > 0) { wx = I.mx / mag * top; wz = I.mz / mag * top; }

    if (this.grounded) {
      // uphill progress fades out over the last few degrees before the limit
      const up = wx * ux + wz * uz;
      if (up > 0) { const k = 1 - clamp((maxS - slope) / WALK.slopeBand, 0, 1); wx -= ux * up * k; wz -= uz * up * k; }
      const ax = wx - v.x, az = wz - v.z, al = Math.hypot(ax, az);
      const rate = (top > 0 && mag > 0.02 ? WALK.accel : WALK.brake) * (1 - 0.3 * sand);
      if (al > 1e-5) { const k = Math.min(1, rate * dt / al); v.x += ax * k; v.z += az * k; }
      t.slipping = slope > maxS;
      if (t.slipping) {
        const s = slope * DEG, acc = Math.max(0.4, MARS.gravity * (Math.sin(s) - 0.55 * Math.cos(s)));
        v.x -= ux * acc * dt; v.z -= uz * acc * dt;
        const upv = v.x * ux + v.z * uz; if (upv > 0) { v.x -= ux * upv; v.z -= uz * upv; }
        const sp = Math.hypot(v.x, v.z); if (sp > 5) { v.x *= 5 / sp; v.z *= 5 / sp; }
      }
      if (I.jump && this.jumpCd <= 0 && !t.slipping && this.stun <= 0 && !this.pose) {
        I.jump = false;
        v.y = WALK.jumpV0 * (this.crouch ? 0.8 : 1); this.grounded = false; this.airT = 0; this.takeoff = Math.hypot(v.x, v.z);
        this.stats.hops++; this._pulse = (this._pulse || 0) + 8000;                         // joules of effort, spent over the next moments
        this._hopped = performance.now();
        this.emit("hop", {});
      }
    } else {
      // in the air: a little steering, never a gain in speed (no bunny-hopping)
      const ax = wx - v.x, az = wz - v.z, al = Math.hypot(ax, az);
      if (al > 1e-5 && mag > 0.02) { const k = Math.min(1, WALK.air * dt / al); v.x += ax * k; v.z += az * k; }
      const sp = Math.hypot(v.x, v.z), cap = Math.max(this.takeoff || 0, 0.6);
      if (sp > cap) { v.x *= cap / sp; v.z *= cap / sp; }
      v.y -= MARS.gravity * dt;
      this.airT += dt;
    }
    I.jump = false;

    // move, then resolve against rocks, the rover and placed modules
    const ox = this.p.x, oz = this.p.z;
    _v.set(ox + v.x * dt, 0, oz + v.z * dt);
    const stand = this._collide(_v, this.p.y);
    const site = g.site, m = 60;
    this.edge = !site.inside(_v.x, _v.z, m + 25);
    _v.x = clamp(_v.x, -site.halfX + m, site.halfX - m); _v.z = clamp(_v.z, -site.halfZ + m, site.halfZ - m);
    let gh = Math.max(S.height(_v.x, _v.z), stand);
    if (this.grounded) {
      if (gh > this.p.y + 0.5) { _v.x = ox; _v.z = oz; v.x *= 0.3; v.z *= 0.3; gh = Math.max(S.height(ox, oz), this.p.y); }     // a step too high: a rock face
      const drop = this.p.y - gh;
      if (drop > 0.22 + Math.hypot(v.x, v.z) * dt * 1.2) { this.grounded = false; this.airT = 0; v.y = 0; this.takeoff = Math.hypot(v.x, v.z); this.p.set(_v.x, this.p.y, _v.z); }
      else this.p.set(_v.x, gh, _v.z);
    } else {
      let y = this.p.y + v.y * dt;
      if (gh > y + 0.45 && v.y > -1) { _v.x = ox; _v.z = oz; v.x = 0; v.z = 0; gh = Math.max(S.height(ox, oz), stand); }           // flew into a wall
      if (y <= gh) {
        const impact = -v.y;
        y = gh; this.grounded = true; v.y = 0; this.lastAir = this.airT; this.jumpCd = WALK.jumpCooldown;
        const hard = impact > WALK.fallSafe;
        v.x *= hard ? 0.3 : 0.72; v.z *= hard ? 0.3 : 0.72;
        this.gait.land = Math.min(1, impact / 3.2);
        this._landT = 0.25 + 0.4 * this.gait.land;
        if (hard) {
          const lost = (impact - WALK.fallSafe) * WALK.fallDamage;
          this.suit.integrity = Math.max(0, this.suit.integrity - lost); this.stun = 0.6; this.stats.falls++; this.cam.shake = 0.5;
          g.hud.toast(`Hard landing<small>suit integrity ${Math.round(this.suit.integrity * 100)}%: it leaks faster now</small>`, 3.5);
          this.emit("fall", { impact, lost });
        }
        this._puff(_v.x, y, _v.z, 0.5 + Math.min(1, impact / 4));
        this.emit("land", { impact, airtime: this.lastAir });
      }
      this.p.set(_v.x, y, _v.z);
    }
    const moved = Math.hypot(this.p.x - ox, this.p.z - oz);
    this.stats.walked_m += moved; this.evaWalked += moved;
    this._climb = dt > 0 ? (S.height(this.p.x, this.p.z) - S.height(ox, oz)) / dt : 0;
  }

  /** dt real seconds, simDt simulated. */
  step(dt, simDt) {
    this._readInput(dt);
    this._acc += Math.min(dt, 0.1);
    while (this._acc >= SUB) { this._substep(SUB); this._acc -= SUB; }
    const t = this.t, v = this.vel, sp = Math.hypot(v.x, v.z), I = this.in;
    t.speed = sp; t.airborne = !this.grounded;
    // facing: toward where it is going; with the camera when aiming or looking through the visor
    const want = (I.aim || this.cam.mode === "first") ? this.cam.yaw : sp > 0.25 && this.grounded && !t.slipping ? Math.atan2(v.x, -v.z) : this.yaw;
    const dy = wrap(want - this.yaw), turn = clamp(dy, -9 * dt, 9 * dt);
    this.yaw = wrap(this.yaw + turn); this.gait.turn = damp(this.gait.turn, dt > 0 ? turn / dt : 0, 8, dt);
    this.q.setFromAxisAngle(_a.set(0, 1, 0), -this.yaw);
    t.heading = (this.yaw / DEG + 360) % 360;
    t.stance = this.emergency ? "EMERG" : !this.grounded ? "HOP" : t.slipping ? "SLIP" : this.crouch ? "CROUCH" : I.aim ? "STEADY" : sp > WALK.run + 0.4 ? "SPRINT" : sp > WALK.walk + 0.35 ? "RUN" : sp > 0.15 ? "WALK" : "STAND";
    this._suit(dt, simDt, sp);
    if (this.onFoot) { this.stats.eva_s += simDt; }
  }

  /* ── the suit ────────────────────────────────────────────────────────── */

  env() {
    const g = this.game, e = g.env || null, clk = g.state.clock;
    const hour = clk.tod / MARS.solSeconds * 24;
    const air = e && e.temp && Number.isFinite(e.temp.air_K) ? e.temp.air_K : 220 + 30 * Math.cos((hour - 14.5) / 24 * TAU);     // 190 K before dawn, 250 K mid-afternoon
    const w = e && e.wind, wind = w == null ? 4 : typeof w === "number" ? w : (w.speed ?? w.speed_ms ?? w.mps ?? 4);
    const rad = e && e.radiation;
    return { air_K: air, wind: Number.isFinite(wind) ? wind : 4, dose: rad && Number.isFinite(rad.dose_mSv_per_sol) ? rad.dose_mSv_per_sol : 0.67,
      spe: !!(rad && rad.spe), storm: !!(e && e.dust && e.dust.storm), visibility: e && Number.isFinite(e.visibility_m) ? e.visibility_m : null, live: !!e };
  }

  _suit(dt, simDt, sp) {
    const s = this.suit, g = this.game, t = this.t, env = this.env();
    let M = metabolic(sp, { sprint: t.stance === "SPRINT", climb: this.grounded ? this._climb || 0 : 0, sand: t.sand });
    if (this.pose && this.pose.kind === "drill") M += 180;
    if (this._pulse > 0) { const j = Math.min(this._pulse, 900 * simDt); this._pulse -= j; M += simDt > 0 ? j / simDt : 0; }
    t.M = M;
    const heater = Math.max(0, SUIT.heaterBelow_K - env.air_K) * SUIT.heater_W_per_K * (1 + 0.02 * env.wind);
    const P = SUIT.P_base + SUIT.P_pump * M + (this.light ? SUIT.P_light : 0) + heater;
    t.power_W = P; t.heater_W = heater; t.air_K = env.air_K;
    const leak = leakRate(s.integrity) * (env.storm ? 1 + 0.5 * SUIT_MODS.dust : 1);      // SUIT_MODS.dust: sealed joints (progress.js)
    const o2Rate = M * SUIT.K_O2 + leak;
    if (!this.emergency || this.emergency.cause !== "O2") { const d = Math.min(s.o2, o2Rate * simDt); s.o2 -= d; this.stats.o2_kg += d; }
    const flat = s.power <= 0;
    s.power = Math.max(0, s.power - P * simDt);
    // CO2: the scrubber keeps up to scrubCap_W; above it (sprinting), or with a spent cartridge, the partial pressure climbs
    const cap = s.scrubber > 0 && !flat ? SUIT.scrubCap_W : 0;
    const scrubbed = Math.min(M, cap) * SUIT.K_O2 * SUIT.CO2_PER_O2 * simDt;
    s.scrubber = Math.max(0, s.scrubber - scrubbed);
    if (M > cap) s.co2 += (M - cap) * SUIT.co2Gain * simDt; else s.co2 = Math.max(SUIT.co2Base, s.co2 - (cap - M) * SUIT.co2Gain * 2 * simDt);
    s.co2 = Math.min(8, s.co2);
    // temperature: held at the set point while there is power; without it, the suit drifts to what the body and the air make of it
    if (!flat) s.temp = damp(s.temp, SUIT.tempSet, 1 / 600, simDt);
    else s.temp = clamp(s.temp + (0.8 * M + 40 * Math.max(0, g.sky.sun.sinEl) - SUIT.UA * (s.temp + 273.15 - env.air_K)) / SUIT.C * simDt, -80, 60);
    if (env.storm) s.integrity = Math.max(0, s.integrity - 2e-6 * SUIT_MODS.dust * simDt);
    s.dose += env.dose * (env.spe ? 20 : 1) * SUIT_MODS.rad * simDt / MARS.solSeconds;      // SUIT_MODS.rad: a shielding liner (progress.js)
    // smoothed rates for the time-remaining estimate
    const k = 1 - Math.exp(-simDt / 240);
    this._rate.o2 += (o2Rate - this._rate.o2) * (this._rate.o2 ? k : 1); this._rate.pw += (P - this._rate.pw) * (this._rate.pw ? k : 1);

    // emergencies
    const cause = s.o2 <= 0 ? "O2" : s.co2 >= SUIT.co2Emergency ? "CO2" : s.temp < SUIT.tempLow ? "cold" : s.temp > SUIT.tempHigh ? "heat" : s.integrity < SUIT.integrityFail ? "suit breach" : null;
    if (cause && !this.emergency) { this.emergency = { cause }; this.stats.emergencies++; this.emit("emergency", { cause, sop_s: s.sop }); }
    if (this.emergency) {
      if (!cause) { this.emergency = null; this.emit("emergency-over", {}); }
      else { this.emergency.cause = cause; s.sop -= simDt; if (s.sop <= 0) { s.sop = 0; this._blackout = cause; } }
    }
  }

  /** Everything the HUD and the API say about the suit. */
  status() {
    const s = this.suit, g = this.game, scale = g.state.clock.scale, ref = this.refuge();
    const sr = safeRange(s, scale, SUIT.P_base + SUIT.P_pump * metabolic(WALK.walk) + (this.light ? SUIT.P_light : 0) + (this.t.heater_W || 0));
    const tO2 = s.o2 / Math.max(1e-9, this._rate.o2 || metabolic(0) * SUIT.K_O2), tPw = s.power / Math.max(1, this._rate.pw || SUIT.P_base);
    const timeLeft = Math.min(tO2, tPw);
    const turnBack = this.onFoot && !this.inside ? (ref.d >= sr.range ? "now" : ref.d * SUIT.turnBack >= sr.range ? "soon" : null) : null;
    return { o2: s.o2 / SUIT.o2_kg, power: s.power / SUIT.battery_J, co2: s.scrubber / SUIT.scrubber_kg, temp: s.temp, integrity: s.integrity,
      co2_kPa: s.co2, timeLeft_s: timeLeft, limiting: tO2 <= tPw ? "O2" : "power", emergency: this.emergency ? this.emergency.cause : null, sop_s: s.sop,
      dose_mSv: s.dose, refuge: ref, safeRange_m: sr.range, rangeLimit: sr.limiting, turnBack, M_W: this.t.M, power_W: this.t.power_W, air_K: this.t.air_K };
  }

  /* ── animation ───────────────────────────────────────────────────────── */

  /**
   * The clips, chosen from what the body is doing: the EVA poses (eva.js sets this.pose), in the air (the
   * hop: a float timed to this hop's real flight, or a fall), the landing (its impact scaled by the speed it
   * landed at), sliding, crouched, a scramble on steep ground, turning on the spot, or the gaits blended by
   * speed. The gaits are phase-locked to the ground speed, so footprints land where the soles do.
   */
  _animate(dt) {
    const ch = this.rig, t = this.t, gt = this.gait, I = this.in;
    this.group.position.copy(this.p);
    this.group.rotation.y = Math.PI - this.yaw;
    if (!ch) return;
    const sp = t.speed;
    gt.move = damp(gt.move, this.grounded && sp > 0.12 ? 1 : 0, 9, dt);
    // which way is uphill along the facing, and how steep
    const S = this.game.surface, fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const along = Math.atan2(S.height(this.p.x + fx * 0.45, this.p.z + fz * 0.45) - S.height(this.p.x - fx * 0.45, this.p.z - fz * 0.45), 0.9);
    gt.slope = damp(gt.slope, along, 7, dt);
    if (this._landT > 0) this._landT -= dt;
    let mode = "loco";
    if (this.pose) mode = "pose:" + this.pose.kind;
    else if (!this.grounded) mode = "air";
    else if (this._landT > 0 && sp < 2.2) mode = "land";
    else if (t.slipping) mode = "slip";
    else if (this.crouch) mode = sp > 0.15 ? "crouchwalk" : "crouch";
    else if (gt.slope > 0.3 && sp > 0.12) mode = "climb";
    else if (sp < 0.15 && Math.abs(gt.turn) > 1.2) mode = "turn";
    if (mode !== this._mode) {
      const prev = this._mode; this._mode = mode;
      if (mode === "air") {
        // a hop is timed to its own flight (2 v0 / g); walking off an edge starts the float part-way
        const hop = this._hopped && performance.now() - this._hopped < 400;
        const T = 2 * WALK.jumpV0 / MARS.gravity;
        ch.play("hop_air", { fade: 0.08, speed: hop ? 1.4 / T : 1, from: hop ? 0 : 0.5, hold: true });
      } else if (mode === "land") ch.play("hop_land", { fade: 0.05, speed: 0.8 + 0.4 * gt.land, hold: true });
      else if (mode === "slip") ch.play("slip", { fade: 0.2 });
      else if (mode === "crouch") ch.play("crouch_idle", { fade: 0.3 });
      else if (mode === "crouchwalk") ch.play("crouch_walk", { fade: 0.3 });
      else if (mode === "climb") ch.play("climb", { fade: 0.35 });
      else if (mode === "turn") ch.play("turn_step", { fade: 0.2 });
      else if (mode === "pose:drill") ch.play("drill", { fade: 0.3 });
      else if (mode === "pose:scan") ch.play("scan", { fade: 0.25 });
      else if (mode === "pose:place") ch.play("place", { fade: 0.2, hold: true });
      void prev;
    }
    const u0 = ch.phase;
    if (mode === "loco") ch.locomote(sp, { walk: "walk", lope: "lope", sprint: "sprint", idle: "idle" });
    else ch.speed = sp;
    // the head follows the camera (the visor is where you look), as far as a helmet turns
    const c = this.cam;
    if (c.mode === "first" || this.pose) ch.lookAt(null);
    else {
      this._lookP = this._lookP || new THREE.Vector3();
      this._lookP.set(this.p.x + Math.sin(c.yaw) * 30, this.p.y + 1.6 + Math.sin(clamp(c.pitch * 0.4 - 0.05, -0.3, 0.45)) * -30, this.p.z - Math.cos(c.yaw) * 30);
      ch.lookAt(this._lookP, 0.75);
    }
    ch.ground = this._groundFn || (this._groundFn = (x, z) => this.game.surface.height(x, z));
    ch.ikOn = this.grounded && mode !== "air";
    ch.update(dt);
    // footfalls: the left heel strikes at phase 0, the right at 0.5
    if (this.grounded && sp > 0.12 && (mode === "loco" || mode === "crouchwalk" || mode === "climb")) {
      if (u0 > ch.phase + 0.5) this._footfall(1);
      if (u0 < 0.5 && ch.phase >= 0.5) this._footfall(-1);
    }
    this.drill.visible = mode === "pose:drill"; this.scanner.visible = mode === "pose:scan";
    if (this.drill.visible) this.bit.rotation.y += dt * 40;
  }

  _footfall(side) {
    const S = this.game.surface, sand = this.t.sand, f = this.rig && this.rig.bones.get(side > 0 ? "foot_L" : "foot_R");
    let x, z;
    if (f) { f.getWorldPosition(_v); x = _v.x + Math.sin(this.yaw) * 0.07; z = _v.z - Math.cos(this.yaw) * 0.07; }
    else { const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw); x = this.p.x + fx * 0.2 + fz * 0.17 * side; z = this.p.z + fz * 0.2 - fx * 0.17 * side; }
    const y = S.height(x, z);
    this.gait.foot = side;
    this._puff(x, y, z, 0.22 + 0.2 * Math.min(1, this.t.speed / 3) + 0.25 * sand);
    this._print(x, y, z, this.yaw + side * 0.1, 0.25 + 0.6 * sand);
    if (this.cam.mode === "first") this.cam.shake = Math.max(this.cam.shake, 0.06 + 0.05 * this.t.speed / 3);
  }
  _print(x, y, z, yaw, strength) {
    const S = this.game.surface, n = S.normal(x, z, 0.25, _n);
    _q.setFromUnitVectors(_a.set(0, 1, 0), n); _q.multiply(new THREE.Quaternion().setFromAxisAngle(_a.set(0, 1, 0), -yaw));
    const i = this.printHead; this.printHead = (i + 1) % FOOTPRINTS;
    this.printList[i] = { x, z, k: strength, born: performance.now() };
    _m.compose(_v.set(x, y + 0.025, z).addScaledVector(n, 0.005), _q, _s.setScalar(0.85 + 0.3 * strength));
    this.prints.setMatrixAt(i, _m);
    this.prints.count = Math.min(FOOTPRINTS, Math.max(this.prints.count, i + 1));
    this.prints.instanceMatrix.needsUpdate = true;
  }
  _puff(x, y, z, size) {
    const sky = this.game.sky, lum = clamp(0.18 + 0.33 * (sky.sunColor.r + sky.sunColor.g) * Math.max(0, sky.sun.sinEl) + sky.ambSky.r, 0.05, 1.3);
    let best = this.puffs[0];
    for (const f of this.puffs) if (f.t / f.life > best.t / best.life) best = f;
    best.t = 0; best.life = 0.9 + size; best.size = size;
    best.s.position.set(x, y + 0.05, z); best.s.visible = true;
    best.v.set(this.vel.x * 0.12 + (Math.random() - 0.5) * 0.25, 0.32 + Math.random() * 0.2, this.vel.z * 0.12 + (Math.random() - 0.5) * 0.25);
    best.s.material.color.setRGB(0.72 * lum, 0.52 * lum, 0.36 * lum);
  }
  _fx(dt) {
    for (const f of this.puffs) {
      if (!f.s.visible) continue;
      f.t += dt; const k = f.t / f.life;
      if (k >= 1) { f.s.visible = false; continue; }
      f.v.y -= 0.9 * dt;                                                   // dust falls back slowly here
      f.s.position.addScaledVector(f.v, dt);
      const sz = f.size * (0.5 + 1.9 * Math.sqrt(k)); f.s.scale.set(sz, sz * 0.7, 1);
      f.s.material.opacity = 0.42 * (1 - k) * (1 - k);
    }
    // contact shadow: stretched away from the Sun, gone at night
    const sky = this.game.sky, el = sky.sun.sinEl, b = this.blob;
    const on = this.group.visible && el > 0.03;
    b.visible = this.group.visible;
    const sx = -sky.sunDir.x, sz = -sky.sunDir.z, hl = Math.hypot(sx, sz) || 1;
    const len = on ? clamp(1.5 / Math.max(el, 0.12) * Math.sqrt(1 - el * el), 0.2, 7) : 0;
    const gy = this.game.surface.height(this.p.x, this.p.z);
    const lift = Math.max(0, this.p.y - gy);
    b.position.set(this.p.x + sx / hl * (len * 0.5 + lift * 0.8), gy + 0.03, this.p.z + sz / hl * (len * 0.5 + lift * 0.8));
    b.rotation.z = Math.atan2(-sx, -sz);
    b.scale.set(0.95, 0.9 + len, 1);
    const direct = on ? clamp((sky.sunColor.r + sky.sunColor.g + sky.sunColor.b) / 3, 0, 1) : 0;
    b.material.opacity = (0.16 + 0.42 * direct) * (1 - Math.min(0.6, lift * 0.4));
  }

  /* ── cameras ─────────────────────────────────────────────────────────── */

  _camera(dt) {
    const g = this.game, cam = g.camera, c = this.cam, S = g.surface, aim = this.in.aim;
    const fovT = aim ? 44 : c.mode === "first" ? 66 : CAMERA.fov;
    if (Math.abs(cam.fov - fovT) > 0.05) { cam.fov = damp(cam.fov, fovT, 10, dt || 0.016); cam.updateProjectionMatrix(); }
    c.shake = Math.max(0, c.shake - (dt || 0) * 1.6);
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), cp = Math.cos(c.pitch), spt = Math.sin(c.pitch);
    const now = performance.now() / 1000, jx = Math.sin(now * 31) * c.shake * 0.03, jy = Math.cos(now * 27) * c.shake * 0.03;
    if (this.rig) { if (this.rig.parts.helmet) this.rig.parts.helmet.visible = c.mode !== "first"; }
    else this.parts.head.visible = c.mode !== "first";
    if (c.mode === "first") {
      this.group.updateMatrixWorld(true);
      this.parts.head.getWorldPosition(_v);
      _v.y += this.rig ? 0.15 : 0.13; _v.x += sy * 0.1; _v.z -= cy * 0.1;
      cam.position.set(_v.x + jx, _v.y + jy, _v.z);
      _e.set(-c.pitch, -c.yaw, Math.sin(this.gait.u * TAU) * 0.006 * this.gait.move);
      cam.quaternion.setFromEuler(_e);
      return;
    }
    // an orbit about the waist, a little over the right shoulder: the walker stands in the middle of the picture with the ground ahead in view
    const dist = aim ? 2.4 : c.dist, side = aim ? 0.5 : 0.3;
    const ty = this.p.y + (this.crouch ? 0.7 : 0.85) + (aim ? 0.45 : 0);
    c.y = Math.abs(ty - c.y) > 3 ? ty : damp(c.y, ty, 10, dt || 0.016);
    const tx = this.p.x + cy * side, tz = this.p.z + sy * side;
    // pull the boom in until nothing along it is under the ground
    let d = dist;
    const v = g.vehicle, lq = _q.copy(v.q).invert(), hw = v.def.box.width / 2 + 0.55, hl = v.def.box.length / 2 + 0.55;
    for (let k = 1; k <= 10; k++) {
      const f = dist * k / 10, px = tx - sy * cp * f, pz = tz + cy * cp * f, py = c.y + spt * f;
      _a.set(px - v.p.x, 0, pz - v.p.z).applyQuaternion(lq);                 // and never inside the rover's hull
      const inRover = Math.abs(_a.x) < hw && Math.abs(_a.z) < hl && py < v.p.y + 2.9;
      if (inRover || py < S.height(px, pz) + 0.25) { d = Math.max(0.7, dist * (k - 1) / 10 - 0.15); break; }
    }
    cam.position.set(tx - sy * cp * d + jx, c.y + spt * d + jy, tz + cy * cp * d);
    const floor = S.height(cam.position.x, cam.position.z) + 0.25;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, c.y + 0.1, tz);
  }
  toggleCamera() { this.cam.mode = this.cam.mode === "third" ? "first" : "third"; if (this.cam.mode === "first") this.cam.pitch = Math.min(this.cam.pitch, 0.3); return this.cam.mode; }
  recentre() { this.cam.yaw = this.yaw; this.cam.pitch = this.cam.mode === "first" ? 0 : 0.2; }

  /** Every rendered frame while on foot. */
  frame(dt) {
    this._animate(dt);
    this._fx(dt);
    this._camera(dt);
    const g = this.game;
    // the helmet lamp borrows the terrain's one lamp (main.js: game.lamp)
    if (this.light && this.suit.power > 0) {
      this.parts.head.getWorldPosition(_v);
      const c = this.cam, a = c.mode === "first" ? c.yaw : this.yaw + (this._headYaw ? -this._headYaw : 0);
      this._lamp = this._lamp || { pos: new THREE.Vector3(), dir: new THREE.Vector3(), on: true };
      this._lamp.pos.copy(_v).y += 0.15;
      this._lamp.dir.set(Math.sin(a), -0.34, -Math.cos(a)).normalize();
      g.lamp = this._lamp;
    } else g.lamp = null;
  }

  toJSON() {
    return { onFoot: this.onFoot, inside: this.inside, p: this.p.toArray(), yaw: this.yaw, suit: this.suit, stats: this.stats, light: this.light, crouch: this.crouch,
      cam: { mode: this.cam.mode, yaw: this.cam.yaw, pitch: this.cam.pitch, dist: this.cam.dist }, evaStart: this.evaStart, evaWalked: this.evaWalked };
  }
  fromJSON(s) {
    this.suit = Object.assign(this._fullSuit(), s && s.suit);
    this.stats = Object.assign({ evas: 0, walked_m: 0, eva_s: 0, hops: 0, falls: 0, emergencies: 0, recoveries: 0, o2_kg: 0 }, s && s.stats);
    this.light = !!(s && s.light); this.crouch = !!(s && s.crouch);
    if (s && s.cam) Object.assign(this.cam, s.cam);
    this.emergency = null; this._blackout = null; this.pose = null;
    this.evaStart = s && s.evaStart || null; this.evaWalked = s && s.evaWalked || 0;
    this._pending = s && s.onFoot && Array.isArray(s.p) ? { p: s.p, yaw: s.yaw || 0, inside: s.inside || null } : null;
    if (!this._pending && this.onFoot) { this.onFoot = false; this.inside = null; this.group.visible = false; this.game.focus = null; this.game.lamp = null; }
  }
}

/* ── the suit's vitals: the HUD's vitals cluster while on foot ───────────────
   Oxygen is always there (a ring and the time it leaves you); suit power and CO2 join it when they matter;
   speed and stance while you move; the full read-out (time left, refuge, safe range, temperature, integrity,
   load, heading, slope and limit, ground, distance walked, air) in the Full preset and while turning back
   matters. Each part is registered with the interface manager (uiman.js), group "vitals". */

const fmtDur = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} min`; };
const fmtShort = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`; };
const fmtM = (m) => m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km";
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

class SuitHud {
  constructor(game, av) {
    this.game = game; this.av = av; this.acc = 0;
    const mid = document.createElement("div");
    mid.className = "v-suit suit"; mid.hidden = true;
    mid.innerHTML = `<div class="mini v-detail v-suit-detail">
        <span>LEFT <b data-s="left">&nbsp;</b></span><span data-s="ref-l">ROVER <b data-s="ref">0 m</b></span><span>SAFE TO <b data-s="safe">&nbsp;</b></span>
        <span>TEMP <b data-s="temp">21&deg;C</b></span><span>SUIT <b data-s="integ">100%</b></span><span>LOAD <b data-s="load">&nbsp;</b></span>
        <span>HDG <b data-s="hdg">000&deg;</b></span><span>SLOPE <b data-s="slope">0&deg;</b></span><span>LIMIT <b data-s="limit">38&deg;</b></span>
        <span>GROUND <b data-s="grnd">&nbsp;</b></span><span>EVA <b data-s="walked">0 m</b></span><span>AIR <b data-s="air">&nbsp;</b></span></div>
      <div class="v-row">
        <div class="v-suit-aux"><span class="v-co2">CO<sub>2</sub> <b data-s="co2">0.0 kPa</b></span>${ringHTML("pw", "PWR", "Suit battery")}</div>
        ${ringHTML("o2", "O<sub>2</sub>", "Suit oxygen")}
        <div class="speed v-speed suit-move"><b data-s="spd">0.0</b><span>m/s</span><em data-s="stance">STAND</em></div>
      </div>`;
    const visor = document.createElement("div"); visor.className = "helmet"; visor.hidden = true; visor.innerHTML = "<i></i><b></b>";
    const vign = document.createElement("div"); vign.className = "suit-vignette"; vign.hidden = true;
    this.mid = mid; this.visor = visor; this.vign = vign;
    this.left = mid.querySelector(".suit-move");
    this.detail = mid.querySelector(".v-suit-detail");
    this.aux = mid.querySelector(".v-suit-aux");
    const hud = game.hud;
    if (hud.addPanel) { hud.addPanel("suit-vignette", vign); hud.addPanel("helmet", visor); hud.addPanel("suit", mid, "vitals"); }
    else hud.root.append(vign, visor, mid);
    this.el = {};
    for (const n of mid.querySelectorAll("[data-s]")) this.el[n.dataset.s] = n;
    this.ring = { o2: mid.querySelector('[data-ring="o2"]'), pw: mid.querySelector('[data-ring="pw"]') };
    const ui = hud.ui;
    if (ui) {
      ui.register("suit", { el: mid, group: "vitals", policy: "always" });
      ui.register("suit-aux", { el: this.aux, group: "vitals", policy: "contextual", hold: 4, when: () => !!this.auxOn });
      ui.register("suit-speed", { el: this.left, group: "vitals", policy: "contextual", hold: 3, when: () => !!this.moving });
      ui.register("suit-detail", { el: this.detail, group: "vitals", policy: "contextual", lean: "hidden", hold: 4, when: () => !!this.detailOn });
    }
  }
  show(on) {
    this.mid.hidden = !on;
    this.game.hud.root.dataset.mode = on ? "onfoot" : "";
    const eb = document.querySelector("#hud .prov-head"); if (eb) eb.textContent = on ? "Under your boots" : "Under the wheels";
    if (!on) { this.visor.hidden = true; this.vign.hidden = true; this.game.hud.setAlert && this.game.hud.setAlert("suit", null); }
  }
  update(dt) {
    const av = this.av, g = this.game;
    this.visor.hidden = !(av.onFoot && !av.inside && av.cam.mode === "first");
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const e = this.el, t = av.t, st = av.status();
    e.spd.textContent = t.speed.toFixed(1); e.stance.textContent = t.stance;
    e.stance.className = t.stance === "SLIP" || t.stance === "EMERG" ? "bad" : t.stance === "STAND" || t.stance === "WALK" ? "" : "hot";
    e.hdg.textContent = String(Math.round(t.heading) % 360).padStart(3, "0") + "° " + COMPASS[Math.round(t.heading / 45) % 8];
    e.slope.textContent = t.slope.toFixed(0) + "°"; e.limit.textContent = t.maxSlope.toFixed(0) + "°";
    e.slope.classList.toggle("hot", t.slope > t.maxSlope - WALK.slopeBand);
    e.grnd.textContent = t.sand > 0.55 ? "loose sand" : t.sand > 0.25 ? "regolith" : "firm";
    e.walked.textContent = fmtM(av.evaWalked);
    e.air.textContent = Math.round((t.air_K || 220) - 273.15) + "°C";
    const ring = (key, f, txt, cls) => { const r = this.ring[key]; setRing(r.querySelector(".fg"), f, cls == null ? ringLevel(f) : cls); r.querySelector("b").textContent = txt; };
    ring("o2", st.o2, Math.round(st.o2 * 100) + "%");
    this.ring.o2.querySelector("small").innerHTML = "O<sub>2</sub> " + fmtShort(st.timeLeft_s);
    ring("pw", st.power, Math.round(st.power * 100) + "%");
    const co2bad = st.co2_kPa > SUIT.co2Warn;
    e.co2.textContent = st.co2_kPa.toFixed(1) + " kPa"; e.co2.className = st.co2_kPa > SUIT.co2Limit ? "bad" : co2bad ? "warn" : "";
    e.left.textContent = fmtDur(st.timeLeft_s) + " (" + st.limiting + ")";
    e.temp.textContent = st.temp.toFixed(0) + "°C"; e.integ.textContent = Math.round(st.integrity * 100) + "%";
    e["ref-l"].firstChild.textContent = (st.refuge.kind === "airlock" ? "AIRLOCK " : "ROVER ");
    e.ref.textContent = fmtM(st.refuge.d); e.safe.textContent = fmtM(st.safeRange_m); e.load.textContent = Math.round(st.M_W) + " W";
    e.safe.classList.toggle("hot", !!st.turnBack);
    // what is worth showing (uiman.js reads these)
    this.moving = t.speed > 0.3 || t.stance === "SLIP" || t.stance === "EMERG" || t.stance === "HOP";
    this.auxOn = st.power < 0.35 || st.co2_kPa > SUIT.co2Warn * 0.8 || st.temp < 8 || st.temp > 32;
    this.detailOn = !!(st.turnBack || st.emergency || t.slipping);
    // alerts, worst first
    const hud = g.hud, who = st.refuge.kind === "airlock" ? "the airlock" : "the rover";
    let text = null, level = "warn";
    if (st.emergency) { text = `Emergency (${st.emergency}): secondary oxygen ${fmtDur(st.sop_s)}. Reach ${who}: ${fmtM(st.refuge.d)}`; level = "danger"; }
    else if (st.turnBack === "now") { text = `Beyond safe return: ${st.rangeLimit} covers ${fmtM(st.safeRange_m)}, ${who} is ${fmtM(st.refuge.d)} away`; level = "danger"; }
    else if (st.turnBack === "soon") text = `Turn back: ${st.rangeLimit} covers ${fmtM(st.safeRange_m)} of walking, ${who} is ${fmtM(st.refuge.d)} away`;
    else if (st.co2_kPa > SUIT.co2Limit) text = "CO2 high: slow down and let the scrubber catch up";
    else if (t.slipping) text = "Too steep for this ground: you are sliding";
    else if (st.power <= 0) text = "Suit battery flat: no heater, no scrubber fan";
    else if (st.co2_kPa > SUIT.co2Warn) text = "CO2 rising: you are outrunning the scrubber";
    else if (st.integrity < 0.6) text = "Suit damaged: it is leaking oxygen";
    else if (st.o2 < 0.15) text = `Oxygen ${Math.round(st.o2 * 100)}%: ${fmtDur(st.timeLeft_s)} left`;
    else if (av.edge) text = "Edge of the mapped area";
    this.alert = text ? { text, level } : null;
    if (hud.setAlert) hud.setAlert("suit", text, level, /oxygen|O2|Emergency|return|Turn back/i.test(text || "") ? "O₂" : "SUIT");
    this.vign.hidden = !st.emergency; if (st.emergency) this.vign.style.opacity = String(clamp(1 - st.sop_s / SUIT.sop_s, 0.25, 1));
  }
}

/* ── the system ───────────────────────────────────────────────────────────── */

export const ONFOOT_HELP = [
  { control: "ls", text: "Walk: a little for a walk, all the way for a loping run" },
  { control: "rs", text: "Look around" },
  { control: "cross", text: "Hop (long and slow: this is Mars)" },
  { control: "r2", text: "Sprint, while held: costs oxygen and power faster, and outruns the CO2 scrubber" },
  { control: "l2", text: "Steady: slow, precise steps, camera over the shoulder" },
  { control: "r1", text: "Use / interact, HOLD: enter the rover or an airlock, core a rock, lay a sample tube" },
  { control: "l1", text: "Show the objective and the mission briefing" },
  { control: "square", text: "Camera: third person / helmet" },
  { control: "r3", text: "Recentre the camera behind you" },
  { control: "l3", text: "Crouch / brace (steadier on a slope)" },
  { control: "options", text: "Pause / resume" },
  { heading: "Quick slots" },
  { control: "dpad-ud", text: "Up: helmet lamp. Down: map" },
  { control: "dpad-lr", text: "Left: scan the ground or the rock in front of you. Right: plant a flag (hold: a beacon)" },
  { heading: "Menus" },
  { control: "circle", text: "Open the game menu; with anything open, back / close" },
  { control: "triangle", text: "Show or hide this map" },
  { control: "share", text: "Hide / show the whole interface (for screenshots)" },
  { heading: "Not used" },
  { control: "ps", text: "Never read by the game", unused: true },
  { control: "touchpad", text: "Not read: it stays the pointer", unused: true },
];
export const ONFOOT_KEYS = [
  ["W A S D / arrows", "Walk (a loping run by default)"], ["Shift", "Sprint"], ["Z / right mouse", "Steady: slow, precise steps"], ["Space", "Hop"],
  ["X", "Crouch / brace"], ["Mouse drag", "Look"], ["Wheel", "Camera distance"], ["C", "Camera: third person / helmet"], ["V", "Recentre the camera"],
  ["E (hold)", "Use: rover hatch, airlock, core a rock, lay a tube"], ["L", "Helmet lamp"], ["F", "Plant a flag"], ["B", "Place a beacon"],
  ["Q", "Scan the ground / rock ahead"], ["Tab", "Map"], ["O", "Objective and briefing"],
];

/** This layer's stylesheet (eva.css), with the same cache stamp as the module that asks for it. */
export function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById("eva-css")) return;
  const l = document.createElement("link"); l.id = "eva-css"; l.rel = "stylesheet"; l.href = "eva.css" + new URL(import.meta.url).search;
  document.head.appendChild(l);
}

let avatar = null, suitHud = null;
const sys = {
  id: "avatar", order: 60,
  get avatar() { return avatar; },
  api: {
    get active() { return !!(avatar && avatar.onFoot && !avatar.inside); },
    get onFoot() { return !!(avatar && avatar.onFoot); },
    get inVehicle() { return !avatar || !avatar.onFoot; },
    get inside() { return avatar ? avatar.inside : null; },
    get position() { const g = avatar && avatar.game, p = avatar && avatar.onFoot ? avatar.p : g && g.vehicle ? g.vehicle.p : null; return p ? { x: p.x, y: p.y, z: p.z } : null; },
    get heading() { return avatar && avatar.onFoot ? avatar.t.heading : avatar && avatar.game.vehicle ? avatar.game.vehicle.t.heading : 0; },
    get suit() { return avatar ? avatar.status() : null; },
    get stats() { return avatar ? avatar.stats : null; },
    get telemetry() { return avatar ? avatar.t : null; },
    exitVehicle: () => !!avatar && avatar.exitVehicle(),
    enterVehicle: () => { if (avatar && avatar.onFoot) avatar.enterVehicle(); },
    refill: (why) => avatar && avatar.refill(why),
    recover: (cause) => avatar && avatar.recover(cause),
    on: (name, fn) => avatar && avatar.on(name, fn),
  },

  async init(game) {
    ensureStyles();
    avatar = new Avatar(game);
    await avatar.build();
    suitHud = new SuitHud(game, avatar);
    const clk = document.querySelector("#hud .hud-tr .eyebrow"); if (clk) clk.textContent = game.site.name.replace(/ crater$/i, "") + " local time";
    this.hud = suitHud;
    const live = () => game.mode === "onfoot" && !game.paused && avatar.onFoot && !avatar.inside;
    // look and zoom: the canvas already has the foundation's listeners; these only run on foot
    const c = game.canvas; let dragging = null;
    c.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && e.button === 2) avatar._rmb = true; if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return; dragging = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
    c.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      if (live()) { avatar._drag.x += (e.clientX - dragging.x) * 0.005; avatar._drag.y += (e.clientY - dragging.y) * 0.004; }
      dragging.x = e.clientX; dragging.y = e.clientY;
    });
    const end = (e) => { if (dragging && e.pointerId === dragging.id) dragging = null; avatar._rmb = false; };
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    c.addEventListener("wheel", (e) => { if (live()) avatar._zoom *= e.deltaY > 0 ? 1.1 : 0.9; }, { passive: true });
    const act = { camera: () => avatar.toggleCamera(), recentre: () => avatar.recentre(), jump: () => { avatar._jumpQ = true; },
      crouch: () => { avatar.crouch = !avatar.crouch; }, light: () => { avatar.light = !avatar.light; } };
    this.act = act;
    const KEYS = { KeyC: "camera", KeyV: "recentre", Space: "jump", KeyX: "crouch", KeyL: "light" };
    window.addEventListener("keydown", (e) => {
      if (!live() || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
      if (KEYS[e.code]) { act[KEYS[e.code]](); e.preventDefault(); }
    });
    const P = window.GeoIDPad;
    if (P) {
      const map = { cross: "jump", square: "camera", r3: "recentre", l3: "crouch", up: "light" };
      for (const b in map) P.on(b, () => { if (live()) { game.input.lastDevice = "pad"; act[map[b]](); } });
      // Options and Circle open the menu on foot exactly as they do when driving
      // (main.js's own Options handler runs first and may just have resumed INTO "onfoot": that press is spent)
      let resumed = false;
      game.on("padresume", () => { resumed = true; });
      P.on("options", () => { if (resumed) { resumed = false; return; } if (game.storyHold) return; if (game.mode === "onfoot") { game.pause(true); game.emit("padmenu"); } });
      P.onBack(() => { if (game.storyHold) return true; if (game.mode === "onfoot") { game.pause(true); game.emit("padmenu"); return true; } return false; });
    }
    game.on("menukey", () => { if (game.mode === "onfoot" && !game.storyHold) { game.pause(true); game.emit("padmenu"); } });
    document.addEventListener("visibilitychange", () => { if (document.hidden && game.mode === "onfoot" && !game.headless) { game.pause(true); game.emit("padmenu"); } });
  },

  load(game, saved) { if (avatar) avatar.fromJSON(saved || null); if (suitHud) suitHud.show(false); },
  save() { return avatar ? avatar.toJSON() : undefined; },

  tick(game, dt, ctx) {
    const av = avatar;
    if (!av || !av.onFoot) return;
    // the rover is parked, not switched off: its array and hotel loads keep running on the sol clock
    const v = game.vehicle;
    if (v && typeof v._energy === "function") v._energy(dt, 0, { sunDir: game.sky.sunDir, irradiance: game.sky.irradiance, sinEl: game.sky.sun.sinEl, timeScale: game.state.clock.scale, panelFactor: 1 - (game.state.weather.panelDust || 0) });
    if (av.inside) { av.stats.eva_s += 0; return; }
    av.step(dt, ctx.simDt);
    if (av._blackout) { const c = av._blackout; av._blackout = null; av.recover(c); return; }
    this._auto = (this._auto || 0) + dt;
    if (this._auto > 20) { this._auto = 0; game.save(); }
  },

  frame(game, dt) {
    const av = avatar;
    if (!av) return;
    // a save made on foot: step back out once the game has started
    if (av._pending && game.mode === "driving") {
      const s = av._pending; av._pending = null;
      av.onFoot = true; av.group.visible = !s.inside; av.inside = s.inside; av.p.fromArray(s.p); av.place(s.p[0], s.p[2], s.yaw); if (Number.isFinite(s.p[1])) av.p.y = Math.max(av.p.y, s.p[1]);
      game.focus = av; game.setMode("onfoot");
    }
    if (game.mode === "onfoot" && !av.onFoot) { game.setMode("driving"); return; }      // e.g. "Restart" while walking
    const on = av.onFoot && (game.mode === "onfoot" || game.mode === "menu");
    if (on && !av.inside) av.frame(dt);
    else if (av._fx && av.fx) av._fx(dt);
    suitHud.update(dt || 0.2);
  },

  onMode(game, mode) {
    const on = mode === "onfoot" || (mode === "menu" && avatar && avatar.onFoot);
    if (suitHud) suitHud.show(on);
    const P = window.GeoIDPad;
    // the controller map for this mode, through the module's help API (main.js presents game.helpMaps[mode] on Triangle)
    (game.helpMaps = game.helpMaps || {}).onfoot = { entries: ONFOOT_HELP, title: "On foot" };
    if (P && (mode === "onfoot" || mode === "driving")) P.setHelp(mode === "onfoot" ? ONFOOT_HELP : DRIVING_HELP, mode === "onfoot" ? "On foot" : "Driving");
    if (game.hud.setHints) game.hud.setHints(mode === "onfoot" || on ? "onfoot" : null, mode === "onfoot" || on ? (usePad, g, k) => usePad
      ? [[g("ls"), "Walk"], [g("r2"), "Sprint"], [g("cross"), "Hop"], [g("r1"), "Use (hold)"], [g("square"), "Camera"], [g("circle"), "Menu"], [g("triangle"), "Controls"]]
      : [[k("W") + k("A") + k("S") + k("D"), "Walk"], [k("Shift"), "Sprint"], [k("Space"), "Hop"], [k("E"), "Use (hold)"], [k("C"), "Camera"], [k("Esc"), "Menu"], [k("H"), "Controls"]] : null);
  },
};
registerSystem(sys);
