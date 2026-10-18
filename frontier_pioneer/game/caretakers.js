/**
 * CARETAKERS: the people in Kestrel suits who come down with HALO-1's packages, build what the pioneer
 * planned, and then live in the settlement. Every one of them is someone you can talk to.
 *
 * System "caretakers" (order 86). Active in a story campaign only.
 *
 *   THE LOOP. The pioneer plans the settlement in build mode (blueprints, builder.js) and sends the plan to
 *   HALO-1 (halo.js). When the package lands its components are crates beside the pod and its caretakers
 *   step out (one per three modules; the story says who: ANVIL in the first pod, C03). Each caretaker takes
 *   the most urgent blueprint (power and life support first, then habitats and airlocks, then the rest:
 *   basenet.buildPriority), walks to the pod, carries its crates to the site one by one, and when the last is
 *   there builds it (welding, lifting panels, sparks). Construction is basenet's own, through `net.crewGate`:
 *   a module advances only with someone at it, faster with more hands, faster again with the pioneer helping
 *   (on foot within 12 m, or the rover within 25 m). Before the first caretaker lands the pioneer is the crew
 *   himself (the lander's salvaged array in 1.1). Work goes on while he is away or asleep (fastForward).
 *
 *   LIVING THERE. With nothing to build they keep a day: maintenance walks between the modules, brushing the
 *   arrays at first light, a gathering at the comms mast (or the airlock porch) as the Sun goes down, the night
 *   inside a habitat (or standing down outside when there is none). They turn and wave when he comes close,
 *   and bark now and then (founders their authored, voiced lines; everyone else the population's templates).
 *
 *   THE RPG. Each has a callsign, a role, a unit number, a mood, CHARGE (drains with work, refills resting in a
 *   powered habitat) and MORALE (follows the settlement: power, a place to sleep, being talked to), and TRUST
 *   (0 to 100: rises when he helps at their site, talks to them, keeps a promise, uses their real name; falls
 *   when a promise lapses). Approach and press E / Cross: the dialogue panel (topics: their work, the base, a
 *   memory from their donor template, what they need, their side missions, their real name once ATLAS has
 *   opened their file, the roster). The roster (Y, or the pause menu) lists everyone: role, status, where,
 *   charge, trust.
 *
 *   WHO THEY ARE. Founders (ANVIL, LODESTONE, WELLSPRING...) are named characters with authored, voiced lines
 *   (story/dialogue/founders.json); the Second Ring likewise (second_ring.json); everyone else is stamped from
 *   one of the donor templates in story/population.json with a generated callsign (TRUSS-114) and speaks the
 *   population's templates (text only). From Act III some generated units are the Echo.
 *
 *   THE PICTURE is game/actors.js (the animation agent's): a person in a suit, the role's trim and kit. This
 *   file only says which clip a state wants (`_anim`) and moves the figure itself (actor.external).
 *
 *   getSystem("caretakers").api = { spawn(o), list(), get(callsign), nearest(x, z, r, filter), recall(callsign),
 *     wake(callsign), crewAt(moduleId), builders(moduleId), carrier(moduleId), count(), crew(pkg), forecast(manifest),
 *     fastForward(simSeconds), talk(callsign, o), closeTalk(), roster(), closeRoster(), unfiltered(seconds), barks(on) }
 *   events on the game: "unit:arrived" {unit}, "unit:task" {unit, site}, "unit:bark" {unit, text},
 *     "unit:carry" {unit, crate}, "unit:talk" {unit, topic}, "unit:trust" {unit, trust, why}
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { registerSystem, getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { MODULES, SOL_S, buildPriority, halfExtent, waitingForParts } from "./basenet.js?v=6d37c9c-9b39e129";
import { loadStory, speech, rng, hash, evalCond, esc, humanise, ensureStoryStyles } from "./storydata.js?v=6d37c9c-9b39e129";
import { createActor, lookFor } from "./actors.js?v=6d37c9c-9b39e129";

const WALK = 1.6, CARRY = 1.25, HURRY = 9, PLAYER_CREW_R = 30, HELP_FOOT = 12, HELP_ROVER = 25;
const GEN_CAP = { prologue: 0, I: 0, II: 12, III: 20, IV: 24, V: 24, fugitive: 0 };     // generated caretakers present (population.json growth: Act I is the lonely landing)
const ROLE_NAMES = { construction: "Construction", mining_survey: "Mining and survey", water: "Water systems", power: "Power and solar", agriculture: "Agriculture", comms: "Comms and morale",
  repair: "Repair", logistics: "Logistics and stores", dome_frames: "Dome frames", printing: "Regolith printing", fabric: "Suit and fabric repair", rover: "Rover bay", surveying: "Surveying",
  orchard: "Fruit trees", aquaculture: "Aquaculture", sky: "Sky watch", archive: "Archive", atmosphere: "Atmosphere plants", hopper: "Hopper pilot", schools: "Schools", safety: "Dome safety",
  masonry: "Masonry", night_maintenance: "Night maintenance" };
const STATE_TEXT = { idle: "on rounds", walk: "walking", build: "building", rest: "resting in the habitat", talk: "talking to you", dormant: "in the pod", away: "away" };

const _geo = {}, _mat = new Map();
const geo = (k, f) => _geo[k] || (_geo[k] = f());
const mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!_mat.has(k)) _mat.set(k, new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.25 }, o))); return _mat.get(k); };
const SPARK = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A RECALL team's vehicle: white, Meridian-blue trim, two lamps. */
export function hunterMesh() {
  const g = new THREE.Group(), w = mat(0xeef1f4, { roughness: 0.4 }), b = mat(0x1f5fbf), dk = mat(0x22262b), lamp = new THREE.MeshBasicMaterial({ color: 0xf4fbff });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 3.8), w); body.position.y = 1.2; g.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.16, 3.84), b); stripe.position.y = 1.2; g.add(stripe);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1.6), w); cab.position.set(0, 2.05, -0.5); g.add(cab);
  for (const [x, z] of [[-1.15, 1.25], [1.15, 1.25], [-1.15, -1.25], [1.15, -1.25]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 14), dk); wh.rotation.z = Math.PI / 2; wh.position.set(x, 0.5, z); g.add(wh); }
  for (const x of [-0.7, 0.7]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lamp); l.position.set(x, 1.4, -1.92); g.add(l); }
  const beam = new THREE.Mesh(new THREE.ConeGeometry(4, 18, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.rotation.x = Math.PI / 2; beam.position.set(0, 1.3, -11); g.add(beam);
  g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}

/* ── the units ──────────────────────────────────────────────────────────── */

class Caretakers {
  constructor(game) {
    this.game = game; this.units = []; this.root = new THREE.Group(); this.root.name = "caretakers"; game.scene.add(this.root);
    this.enabled = false; this.barkOn = true; this._barkT = 20; this._echoN = 0; this.sparks = [];
    this.used = new Set();     // callsign numbers issued in this region
    this._tags = new Map(); this._simAcc = 0;
    if (typeof document !== "undefined") { ensureStoryStyles(); this._ui(); }
  }
  get story() { const s = getSystem("story"); return s && s.api ? s.api : null; }
  get storyInst() { const s = getSystem("story"); return s && s.story ? s.story : null; }
  get base() { return getSystem("base"); }
  get net() { const b = this.base; return b && b.net ? b.net : null; }

  /** A new unit. o: { callsign, founder, unitNo, template, x, z, state, pkg, role } */
  spawn(o = {}) {
    const D = this._D;
    let u = o.callsign ? this.get(o.callsign) : null;
    if (u) { if (o.x != null) { u.x = o.x; u.z = o.z; } if (u.state === "away") u.state = o.state || "idle"; this._place(u); return u; }
    const r = rng(hash((o.callsign || "") + this.units.length + (this.story ? this.story.seed() : 1)));
    let tpl = o.template;
    if (!tpl && D) {
      const T = D.population.templates, plain = T.filter((t) => !t.founder_callsign);
      if (o.founder) tpl = (T.find((t) => t.founder_callsign === o.callsign.replace(/^GALE_/, "")) || {}).id;
      else tpl = (plain.length ? plain : T)[Math.floor(r() * (plain.length || T.length))].id;
    }
    const callsign = o.callsign || this._callsign(tpl, r);
    u = { callsign, founder: !!o.founder, unitNo: o.unitNo || (o.founder ? this._founderNo(callsign) : "C-" + String(100 + this.units.length).padStart(3, "0")), template: tpl || null,
      x: o.x ?? this.game.vehicle.p.x + 8, z: o.z ?? this.game.vehicle.p.z + 8, yaw: r() * Math.PI * 2, state: o.state || "idle", site: null, pkg: o.pkg || null, joinedSol: this.game.state.clock.sol,
      echo: !!o.echo, recalled: false, t: r() * 10, next: 0, charge: 0.9, morale: 0.7, trust: o.founder ? 20 : 10, promise: null, talkedSol: -1, helpS: 0, trustSol: {}, greetT: 0, job: null, carry: null };
    this.units.push(u);
    this._place(u);
    this.game.emit("unit:arrived", { unit: u });
    return u;
  }
  _founderNo(c) { const D = this._D, f = D && (D.founders[c] || D.second[c]); return (f && f.unit) || "C-??"; }
  _callsign(tplId, r) {
    const D = this._D; if (!D) return "UNIT-" + String(Math.floor(r() * 900) + 100);
    const P = D.population, t = P.templates.find((x) => x.id === tplId) || P.templates[0];
    const role = (t.role_affinity && t.role_affinity[0]) || "construction", bank = P.role_word_banks[role] || P.role_word_banks.construction;
    for (let k = 0; k < 50; k++) {
      const n = 1 + Math.floor(r() * 999), word = bank[Math.floor(r() * bank.length)];
      if (P.callsign.retired.includes(word) || this.used.has(word + n)) continue;
      this.used.add(word + n); return `${word}-${String(n).padStart(3, "0")}`;
    }
    return "UNIT-" + this.units.length;
  }
  get(c) { return this.units.find((u) => u.callsign === c) || null; }
  list() { return this.units.slice(); }
  nearest(x, z, r = Infinity, f = null) { let best = null, bd = r; for (const u of this.units) { if (u.state === "away" || u.state === "dormant" || (f && !f(u))) continue; const d = Math.hypot(u.x - x, u.z - z); if (d <= bd) { bd = d; best = u; } } return best; }
  template(u) { const D = this._D; return D && u.template ? D.population.templates.find((x) => x.id === u.template) || null : null; }
  roleOf(u) {
    const D = this._D, F = D && (D.founders[u.callsign] || D.second[u.callsign]);
    if (F && F.role) return F.role;
    const t = this.template(u), k = (t && t.role_affinity && t.role_affinity[0]) || "construction";
    return ROLE_NAMES[k] || humanise(k);
  }

  _place(u) {
    if (!u.mesh) {
      const t = this.template(u), role = (t && t.role_affinity && t.role_affinity[0]) || "construction";
      const look = lookFor(u.founder ? u.callsign : role, { unit: u.unitNo, callsign: u.callsign.replace(/^GALE_/, "") });
      u.actor = createActor({ kind: "caretaker", look, name: "unit:" + u.callsign, parent: this.root });
      u.actor.external = true;
      u.mesh = u.actor.object3d;
      u.mesh.name = "unit:" + u.callsign;
      u.clip = null;
    }
    u.mesh.visible = this._shown(u);
    this._ground(u);
  }
  _shown(u) { return u.state !== "away" && u.state !== "dormant" && !(u.state === "rest" && u.inside); }
  /** The clip a unit's state asks for (animation hooks only: the behaviour is the state machine below). */
  _anim(u, clip, speed = 0) {
    const a = u.actor, ch = a && a.character; if (!ch) return;
    if (clip === "gait") { const gait = u.carry ? "carry" : u.callsign === "ANVIL" || u.callsign === "GALE_ANVIL" ? "anvil_walk" : "unit_walk"; if (u.clip !== gait) { ch.play(gait, { fade: 0.3 }); u.clip = gait; } ch.speed = speed; return; }
    if (u.clip !== clip) { ch.play(clip, { fade: 0.4 }); u.clip = clip; }
  }
  _ground(u) { const y = this.game.surface.height(u.x, u.z); u.mesh.position.set(u.x, y, u.z); u.mesh.rotation.y = u.yaw; }
  _face(u, x, z, dt = 1) { const want = Math.atan2(x - u.x, z - u.z); u.yaw += Math.atan2(Math.sin(want - u.yaw), Math.cos(want - u.yaw)) * Math.min(1, dt * 4); }
  _go(u, x, z, act, extra = {}) { u.goal = Object.assign({ x, z, act }, extra); u.state = "walk"; }

  /* ── the work ── */
  /** Where to stand beside a module (k turns the spot around it a little, so two of them do not stand in one place). */
  _stand(m, from, k = 0) {
    const [hx, hz] = halfExtent(m.type, m.r || 0), R = Math.hypot(hx, hz) * 0.82 + 1.1;
    const w = this.base.worldOf(m), a = Math.atan2(from.x - w.x, from.z - w.z) + k * 0.42;
    return { x: w.x + Math.sin(a) * R, z: w.z + Math.cos(a) * R, cx: w.x, cz: w.z };
  }
  /** What needs hands, most urgent first: blueprints whose crates have landed, sites with their components, the story's planned structures. */
  jobs() {
    const out = [], net = this.net;
    if (net) for (const m of net.modules.values()) {
      if (m.progress >= 1 || m.plan === "draft" || m.plan === "ordered") continue;
      out.push({ id: m.id, kind: "module", m, pri: buildPriority(m.type) * 1e6 + (m.seq || 0) });
    }
    const t = getSystem("tiers"); if (t && t.api && t.api.sites) for (const s of t.api.sites()) out.push({ id: s.id, kind: "planned", s, pri: 5e6 + out.length });
    return out.sort((a, b) => a.pri - b.pri);
  }
  /** The modules (and planned structures) waiting to be built, for anyone who asks. */
  sites() {
    const out = [], b = this.base;
    try { if (b && b.api) for (const m of b.api.modules()) if (!m.built && !waitingForParts(m)) out.push({ id: m.id, x: m.x, z: m.z, r: 4, kind: "module", seq: 0 }); } catch { /* none */ }
    const t = getSystem("tiers"); if (t && t.api && t.api.sites) for (const s of t.api.sites()) out.push(Object.assign({ kind: "planned" }, s));
    return out;
  }
  _free(u) { return !u.recalled && u.state !== "away" && u.state !== "dormant" && u.state !== "talk"; }
  _assign() {
    const jobs = this.jobs(); if (!jobs.length) { for (const u of this.units) if (u.job) this._drop(u); return; }
    const live = new Set(jobs.map((j) => j.id)), count = new Map();
    for (const u of this.units) { if (u.job && !live.has(u.job.id)) this._drop(u); if (u.job) count.set(u.job.id, (count.get(u.job.id) || 0) + 1); }
    for (const u of this.units) {
      if (!this._free(u) || u.job) continue;
      // a job nobody has, the most urgent (nearest among equals); else a second pair of hands
      let best = null, bd = Infinity;
      for (const pass of [1, 2]) {
        for (const j of jobs) {
          if ((count.get(j.id) || 0) >= pass) continue;
          const w = j.m ? this.base.worldOf(j.m) : j.s, d = j.pri + Math.hypot(w.x - u.x, w.z - u.z) * 10;
          if (d < bd) { bd = d; best = j; }
        }
        if (best) break;
      }
      if (!best) continue;
      count.set(best.id, (count.get(best.id) || 0) + 1);
      u.job = { id: best.id, kind: best.kind };
      if (u.state === "rest") { u.inside = false; u.state = "idle"; this._place(u); }
      this._next(u);
    }
  }
  _drop(u) {
    if (u.carry) { const c = u.carry; c.state = "pod"; c.x = c.hx; c.z = c.hz; c.y = null; c.by = null; u.carry = null; }
    for (const c of this._crates()) if (c.by === u.callsign && c.state === "pod") c.by = null;
    u.job = null; u.site = null; if (u.state === "build" || (u.goal && u.goal.job)) { u.state = "idle"; u.goal = null; }
  }
  _crates() { const H = getSystem("halo"); return H && H.api && H.api.crates ? H.api.crates() : []; }
  /** The next step of a unit's job: fetch a crate, carry it, or build. */
  _next(u) {
    const j = u.job; if (!j) return;
    if (j.kind === "planned") {
      const s = (getSystem("tiers").api.sites() || []).find((x) => x.id === j.id); if (!s) { this._drop(u); return; }
      const a = Math.atan2(u.x - s.x, u.z - s.z), r = (s.r || 4) + 1.2;
      u.site = s.id; this._go(u, s.x + Math.sin(a) * r, s.z + Math.cos(a) * r, "build", { job: true }); return;
    }
    const m = this.net && this.net.modules.get(j.id); if (!m || m.progress >= 1) { this._drop(u); return; }
    u.site = m.id;
    if (m.plan === "delivered") {
      const crate = this._crates().filter((c) => c.module === m.id && c.state === "pod" && (!c.by || c.by === u.callsign)).sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
      if (crate) { crate.by = u.callsign; this._go(u, crate.x - Math.sin(crate.yaw || 0) * 0.9, crate.z - Math.cos(crate.yaw || 0) * 0.9, "pick", { job: true, crate }); return; }
    }
    const st = this._stand(m, u, (hash(u.callsign) % 5) - 2);
    this._go(u, st.x, st.z, "build", { job: true });
  }
  _arrive(u) {
    const G = u.goal; u.goal = null; u.state = "idle";
    if (!G) return;
    const net = this.net;
    if (G.act === "pick") {
      const c = G.crate, m = net && u.job && net.modules.get(u.job.id);
      if (!m || !c || c.state !== "pod") { this._next(u); return; }
      c.state = "carried"; u.carry = c;
      this.game.emit("unit:carry", { unit: u, crate: c });
      const st = this._stand(m, u, (m.got || 0) * 0.9 - 1);
      this._go(u, st.x, st.z, "drop", { job: true });
    } else if (G.act === "drop") {
      const c = u.carry; u.carry = null;
      if (c) { const m = net && net.modules.get(c.module); c.state = "site"; c.y = null; if (m) { const w = this.base.worldOf(m), a = Math.atan2(u.x - w.x, u.z - w.z); c.x = u.x - Math.sin(a) * 0.9; c.z = u.z - Math.cos(a) * 0.9; c.yaw = a; } this.base.api.deliverCrate(c.module); }
      this._next(u);
    } else if (G.act === "build") {
      u.state = "build"; this.game.emit("unit:task", { unit: u, site: u.site });
      const m = net && net.modules.get(u.site); if (m) { const w = this.base.worldOf(m); this._face(u, w.x, w.z, 99); }
    } else if (G.act === "rest") { u.state = "rest"; u.inside = !!G.inside; this._place(u); }
    else { u.state = "idle"; u.act = G.act; u.actUntil = u.t + (G.hold || 12); if (G.face) this._face(u, G.face.x, G.face.z, 99); }
  }
  /** Who is at a module, building it. */
  builders(id) { return this.units.filter((u) => u.state === "build" && u.site === id && !u.recalled).map((u) => u.callsign); }
  carrier(id) { const u = this.units.find((x) => x.job && x.job.id === id && (x.carry || (x.goal && x.goal.act === "pick"))); return u ? u.callsign : null; }
  crewAt(id) { return this.units.some((u) => u.site === id && u.state === "build" && !u.recalled); }
  playerCrew(x, z) {
    if (this.units.some((u) => !u.recalled && u.state !== "away" && u.state !== "dormant")) return false;
    const p = this.story ? this.story.playerPos() : this.game.vehicle.p;
    return Math.hypot(p.x - x, p.z - z) < PLAYER_CREW_R;
  }
  /** Is the pioneer lending a hand at (x, z)? On foot within 12 m, the rover within 25. */
  helping(x, z) {
    const st = this.storyInst, p = this.story ? this.story.playerPos() : this.game.vehicle.p;
    return Math.hypot(p.x - x, p.z - z) < (st && st.onFoot() ? HELP_FOOT : HELP_ROVER);
  }
  /** basenet's crew gate: how fast a module goes up now (0: nobody at it). */
  crewRate(m) {
    if (!this.enabled) return 1;
    let w = null; try { w = this.base.worldOf(m); } catch { return 0; }
    const at = this.units.filter((u) => u.state === "build" && u.site === m.id && !u.recalled);
    if (!at.length) return this.playerCrew(w.x, w.z) ? 1 : 0;
    const help = this.helping(w.x, w.z);
    if (help) for (const u of at) u.helped = performance.now();
    return 1 + 0.5 * (at.length - 1) + (help ? 0.6 : 0);
  }

  /* ── living there ── */
  _sun() { const sky = this.game.sky, c = this.game.state.clock, h = c ? c.tod / SOL_S * 24 : 12; return { el: sky ? sky.sun.sinEl : 0.5, h, pm: h > 12, dawn: h >= 5.5 && h < 9.5, dusk: h >= 16.5 && h < 19.5 }; }
  _builtOf(baseId) { try { return this.base.api.modules().filter((m) => m.built && (!baseId || m.base === baseId)); } catch { return []; } }
  _homeBase(u) { const b = this.base; if (!b || !b.api) return null; let best = null, bd = Infinity; for (const x of b.api.bases()) { const d = Math.hypot(x.x - u.x, x.z - u.z); if (d < bd) { bd = d; best = x; } } return best; }
  _routine(u) {
    if (u.actUntil && u.t < u.actUntil) {
      const k = hash(u.callsign);
      const clip = u.act === "brush" ? "brush" : u.act === "gather" ? ((k + Math.floor(u.t / 8)) % 3 ? "gesture_talk" : "nod") : u.act === "inspect" ? ((k + Math.floor(u.t / 6)) % 2 ? "unit_idle_check" : "interact") : u.act === "standdown" ? "stand_down" : "idle";
      this._anim(u, clip); return;
    }
    if (u.t < u.next) { this._anim(u, (hash(u.callsign) + Math.floor(u.t / 14)) % 3 === 1 ? "look_around" : "idle"); return; }
    const sun = this._sun(), night = sun.el < -0.05, base = this._homeBase(u), mods = this._builtOf(base && base.id);
    u.act = null; u.actUntil = 0;
    u.next = u.t + 4 + (hash(u.callsign + Math.floor(u.t)) % 6);
    if (night) {
      // the night inside a habitat; without one, standing down where they are
      const habs = mods.filter((m) => /^hab/.test(m.type)).sort((a, b) => (b.habitable - a.habitable) || Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z)), hab = habs[0];
      if (hab) { const lock = this.base.api.nearestAirlock(hab.x, hab.z), at = lock && lock.usable ? lock : hab; this._go(u, at.x, at.z, "rest", { inside: true }); }
      else { u.act = "standdown"; u.actUntil = u.t + 60; }
      return;
    }
    if (!mods.length) { u.act = "standdown"; u.actUntil = u.t + 20; return; }
    const arrays = mods.filter((m) => m.type === "solar_array"), k = hash(u.callsign) % 7, i = this.units.indexOf(u);
    if (sun.dawn && sun.el > -0.02 && arrays.length) {                    // first light: brush the arrays
      const a = arrays[(i + k) % arrays.length], ang = (i * 1.3) % 6.28;
      this._go(u, a.x + Math.sin(ang) * 3.2, a.z + Math.cos(ang) * 3.2, "brush", { hold: 25, face: a }); return;
    }
    if (sun.dusk && sun.el > -0.05) {                                     // evening: gather at the mast (or the airlock porch)
      const spot = mods.find((m) => m.type === "comms_tower") || mods.find((m) => m.type === "airlock") || mods[0], ang = i * 0.9;
      this._go(u, spot.x + Math.sin(ang) * 6, spot.z + Math.cos(ang) * 6, "gather", { hold: 40, face: spot }); return;
    }
    // the day shift: a maintenance walk to one of the modules
    const m = mods[(Math.floor(u.t / 13) + k) % mods.length], ang = (u.t * 0.37 + k) % 6.28;
    const [hx, hz] = halfExtent(m.type, 0), R = Math.hypot(hx, hz) * 0.7 + 2;
    this._go(u, m.x + Math.sin(ang) * R, m.z + Math.cos(ang) * R, "inspect", { hold: 8 + (k % 4) * 2, face: m });
  }
  /** Charge, morale and promises: the settlement's state reaches them. sim: simulated seconds since last time. */
  _needs(sim) {
    const h = sim / 3600; if (!(h > 0)) return;
    const b = this.base, cache = new Map();
    const status = (hb) => {
      if (!hb) return { powered: false, hab: false, ok: false, frac: 0 };
      if (cache.has(hb.id)) return cache.get(hb.id);
      let s = null; try { s = b.api.resources(hb.id); } catch { s = null; }
      const mods = this._builtOf(hb.id), r = { powered: !!s && (s.power.stored_Wh > 500 || s.power.gen_W > s.power.load_W), frac: s ? s.power.fraction : 0, hab: mods.some((m) => /^hab/.test(m.type) && m.habitable), ok: !!s && !s.alerts.some((a) => a.level === "bad") };
      cache.set(hb.id, r); return r;
    };
    const sol = this.game.state.clock.sol;
    for (const u of this.units) {
      if (u.recalled || u.state === "away" || u.state === "dormant") continue;
      const hb = this._homeBase(u), S = status(hb), working = u.state === "build" || !!u.carry, near = hb && Math.hypot(hb.x - u.x, hb.z - u.z) < 80;
      u.charge = clamp((u.charge ?? 0.9) - (working ? 0.05 : 0.018) * h + (u.state === "rest" && S.powered ? 0.25 : S.powered && near ? 0.05 : 0) * h, 0, 1);
      const talked = sol - (u.talkedSol ?? -9) <= 1 ? 0.1 : 0;
      const target = clamp(0.35 + (S.hab ? 0.2 : 0) + (S.powered ? 0.15 : 0) + (S.ok ? 0.05 : 0) + talked + (u.trust || 0) / 400 - (u.charge < 0.25 ? 0.25 : 0), 0, 1);
      u.morale = clamp((u.morale ?? 0.7) + (target - (u.morale ?? 0.7)) * Math.min(1, h * 0.4), 0, 1);
      // help at their site: a point of trust per half minute of it, ten a sol at most
      if (u.helped && performance.now() - u.helped < 1500) { u.helpS = (u.helpS || 0) + sim / Math.max(1, this.game.state.clock.scale); if (u.helpS >= 30) { u.helpS = 0; this._trust(u, 1, "help", 10); } }
      // promises: kept when the settlement says so, broken when the day passes
      const P = u.promise;
      if (P && !P.done) {
        const kept = P.kind === "power" ? S.powered && S.frac > 0.4 : P.kind === "hab" ? S.hab : P.kind === "visit" ? u.talkedSol > P.sol : false;
        if (kept) { P.done = true; this._trust(u, 8, "promise kept"); u.promiseNote = "kept"; }
        else if (sol > P.due) { P.done = true; this._trust(u, -6, "promise broken"); u.promiseNote = "broken"; }
      }
    }
  }
  _trust(u, d, why, cap = Infinity) {
    const sol = this.game.state.clock.sol, k = why + ":" + sol;
    u.trustSol = u.trustSol || {};
    if (d > 0 && (u.trustSol[k] || 0) + d > cap) return;
    for (const key of Object.keys(u.trustSol)) if (!key.endsWith(":" + sol)) delete u.trustSol[key];
    u.trustSol[k] = (u.trustSol[k] || 0) + d;
    u.trust = clamp((u.trust || 0) + d, 0, 100);
    this.game.emit("unit:trust", { unit: u, trust: u.trust, why });
  }
  mood(u) {
    if (u.recalled) return "silent";
    if ((u.charge ?? 1) < 0.25) return "drained";
    const m = u.morale ?? 0.7;
    return m > 0.8 ? "cheerful" : m > 0.6 ? "steady" : m > 0.4 ? "tired" : "low";
  }
  status(u, state = u.state) {
    if (u.recalled) return "recalled";
    if (state === "talk") return STATE_TEXT.talk;
    const name = (id) => { const m = this.net && this.net.modules.get(id); return m ? MODULES[m.type].name.toLowerCase() : "a structure"; };
    if (u.job && u.carry) return `carrying components for the ${name(u.job.id)}`;
    if (u.job && u.goal && u.goal.act === "pick") return `fetching components for the ${name(u.job.id)}`;
    if (u.job && state === "build") { const m = this.net && this.net.modules.get(u.job.id); return `building the ${name(u.job.id)}${m ? ` (${Math.floor(m.progress * 100)}%)` : ""}`; }
    if (u.job) return `going to the ${name(u.job.id)}`;
    if (state === "rest") return u.inside ? STATE_TEXT.rest : "standing down for the night";
    if (u.act === "brush") return "brushing the arrays";
    if (u.act === "gather") return "with the others at the end of the day";
    if (u.act === "inspect") return "on a maintenance walk";
    if (u.act === "standdown") return "standing down";
    return STATE_TEXT[state] || state;
  }

  /* ── per frame ── */
  update(dt, simDt) {
    const g = this.game, focus = this.story ? this.story.playerPos() : g.vehicle.p;
    if (!this.enabled) return;
    this._acc = (this._acc || 0) + dt; this._simAcc += simDt || 0;
    if (this._acc > 0.5) { this._acc = 0; this._assign(); this._needs(this._simAcc); this._simAcc = 0; this._tagUnits(focus); }
    const sun = this._sun(), warp = clamp((g.state.clock.scale || 30) / 30, 1, 8);
    for (const u of this.units) {
      if (u.state === "away" || u.state === "dormant" || !u.mesh) continue;
      u.t += dt;
      if (u.recalled) { this._anim(u, "recalled"); continue; }
      const dp = Math.hypot(u.x - focus.x, u.z - focus.z);
      if (u.state === "talk") { this._face(u, focus.x, focus.z, dt); this._anim(u, (Math.floor(u.t / 4) % 3) ? "gesture_talk" : "nod"); this._ground(u); continue; }
      if (u.wave && u.t < u.wave) { this._face(u, focus.x, focus.z, dt); this._anim(u, "wave"); this._ground(u); continue; }
      if (u.state === "walk" && u.goal) {
        const G = u.goal, dx = G.x - u.x, dz = G.z - u.z, d = Math.hypot(dx, dz);
        const step = (dp > 140 ? HURRY : (u.carry ? CARRY : WALK) * warp) * dt;          // faster when nobody is watching, or in time warp
        if (d <= Math.max(0.3, step)) { u.x = G.x; u.z = G.z; this._arrive(u); }
        else { u.x += dx / d * step; u.z += dz / d * step; this._face(u, G.x, G.z, dt); }
        this._anim(u, "gait", step / Math.max(dt, 1e-3));
        if (u.carry) { const c = u.carry, y = g.surface.height(u.x, u.z); c.x = u.x + Math.sin(u.yaw) * 0.45; c.z = u.z + Math.cos(u.yaw) * 0.45; c.y = y + 0.55; c.yaw = u.yaw; }
        this._ground(u);
      } else if (u.state === "build") {
        this._anim(u, (hash(u.callsign) + Math.floor(u.t / 9)) % 3 === 2 ? "lift_place" : "weld");
        if (Math.random() < dt * 6 && dp < 80) this._spark(u);
        const net = this.net, done = !u.job || (u.job.kind === "module" ? !(net && net.modules.get(u.job.id)) || net.modules.get(u.job.id).progress >= 1 : !this.sites().some((x) => x.id === u.job.id));
        if (done) { u.job = null; u.site = null; u.state = "idle"; u.next = u.t + 3; this._bark(u, "build_complete"); }
      } else if (u.state === "rest") {
        this._anim(u, "stand_down");
        if (sun.el > 0.05) { u.state = "idle"; u.inside = false; u.next = u.t + 2; this._place(u); }
      } else if (!u.job) this._routine(u);
      // a greeting: he comes close, they turn and wave (and now and then say hello)
      if (!u.job && dp < 9 && u.state !== "rest" && u.state !== "talk" && u.t > (u.greetT || 0)) {
        u.greetT = u.t + 120; u.wave = u.t + 2.6; if (u.state === "walk") { u.goal = null; u.state = "idle"; }
        if (Math.random() < 0.5) this._bark(u, "greeting");
      }
    }
    for (const s of this.sparks.slice()) { s.t += dt; s.m.scale.setScalar(0.06 * (1 - s.t / 0.25)); if (s.t > 0.25) { this.root.remove(s.m); this.sparks.splice(this.sparks.indexOf(s), 1); } }
    if (this._unfilteredUntil && performance.now() > this._unfilteredUntil) this._filterBack();
    // barks: someone near the pioneer says something, now and then
    this._barkT -= dt;
    if (this.barkOn && this._barkT <= 0) { this._barkT = 40 + Math.random() * 50; const u = this.nearest(focus.x, focus.z, 18, (x) => !x.recalled && x.state !== "walk" && x.state !== "talk"); if (u) this._bark(u, "idle"); }
  }
  /** A name over each unit near him: callsign (or the name he uses), and what they are doing. */
  _tagUnits(focus) {
    const ui = this.game.hud.ui; if (!ui || !ui.tag) return;
    const want = new Set();
    for (const u of this.units) {
      if (!this._shown(u) || u.recalled || Math.hypot(u.x - focus.x, u.z - focus.z) > 22) continue;
      want.add(u.callsign);
      const txt = `${this._callName(u)} · ${this.status(u)}`;
      let t = this._tags.get(u.callsign);
      if (!t) { const uu = u; t = ui.tag("unit-" + u.callsign, { at: () => ({ x: uu.x, y: (uu.mesh ? uu.mesh.position.y : 0) + 2.3, z: uu.z }), text: txt, kind: "ground" }); this._tags.set(u.callsign, t); }
      else if (t._txt !== txt) t.set(txt);
      t._txt = txt;
    }
    for (const [k, t] of this._tags) if (!want.has(k)) { t.remove(); this._tags.delete(k); }
  }
  _spark(u) {
    const m = new THREE.Mesh(geo("spark", () => new THREE.SphereGeometry(1, 6, 4)), SPARK);
    const fwd = new THREE.Vector3(Math.sin(u.yaw), 0, Math.cos(u.yaw));
    m.position.set(u.x + fwd.x * 0.75, u.mesh.position.y + 1.0, u.z + fwd.z * 0.75); this.root.add(m); this.sparks.push({ m, t: 0 });
  }
  /** Dormancy (or a long absence): the crews keep working. Their logistics are done at once, then the base builds, an hour at a time. */
  fastForward(sim) {
    const b = this.base;
    for (let left = sim; left > 0; left -= 3600) {
      this._assign();
      for (const u of this.units) {
        if (!u.job || u.recalled) { if (u.goal && u.state === "walk") { u.x = u.goal.x; u.z = u.goal.z; this._arrive(u); } continue; }
        const m = u.job.kind === "module" && this.net ? this.net.modules.get(u.job.id) : null;
        if (m && m.plan === "delivered") for (const c of this._crates()) if (c.module === m.id && (c.state === "pod" || c.state === "carried")) {
          if (u.carry === c) u.carry = null;
          const st = this._stand(m, { x: c.hx, z: c.hz }, (m.got || 0) * 0.9 - 1); c.state = "site"; c.x = st.x; c.z = st.z; c.y = null; c.by = null; b.api.deliverCrate(m.id);
        }
        if (u.state !== "build") { u.goal = null; this._next(u); if (u.goal) { u.x = u.goal.x; u.z = u.goal.z; this._arrive(u); } }
      }
      const step = Math.min(3600, left);
      try { if (b && b.api) b.api.simulate(step); } catch (e) { console.warn("[caretakers] simulate", e); }
      const t = getSystem("tiers"); if (t && t.api && t.api.advance) t.api.advance(step);
      this._needs(step);
      const net = this.net;
      for (const u of this.units) if (u.state === "build" && u.job && (u.job.kind === "module" ? !(net.modules.get(u.job.id)) || net.modules.get(u.job.id).progress >= 1 : !this.sites().some((s) => s.id === u.job.id))) { u.state = "idle"; u.site = null; u.job = null; }
    }
    for (const u of this.units) if (u.mesh) this._ground(u);
  }

  /* ── arrivals ── */
  /** How many generated caretakers may be here now (the act's growth, more with the progression tier). */
  genCap() {
    const st = this.story, act = st ? st.act() : "I", P = getSystem("progress"), lim = P && P.api && P.api.limits ? P.api.limits() : null;
    return Math.min(24, (GEN_CAP[act] ?? 0) + (GEN_CAP[act] ? 2 * ((lim && lim.caretakers) || 0) : 0));
  }
  generated() { return this.units.filter((u) => !u.founder && !u.recalled).length; }
  /** Who a plan of this manifest brings: the story's unit (ANVIL with the first), then generated caretakers while the act allows. */
  forecast(M) {
    const st = this.storyInst, S = st ? st.S : null, want = st && st._uplinkWant ? st._uplinkWant() : null;
    let founder = want && want.unit ? want.unit : null;
    if (!founder && S && S.campaign && S.act !== "fugitive" && !this.get("ANVIL")) { const H = getSystem("halo"); if (!(H && H.api.packages().some((p) => p.unit === "ANVIL"))) founder = "ANVIL"; }
    const need = M.caretakers || 0, gen = Math.max(0, Math.min(need - (founder ? 1 : 0), this.genCap() - this.generated()));
    const here = this.units.filter((u) => !u.recalled && u.state !== "away").map((u) => u.callsign);
    const parts = [];
    if (founder) parts.push(founder);
    if (gen) parts.push(`${gen} caretaker${gen > 1 ? "s" : ""}`);
    const n = (founder ? 1 : 0) + gen;
    const text = parts.length ? parts.join(" + ") + (n > 1 ? " arrive" : " arrives") + (here.length ? `; ${here.slice(0, 3).join(", ")} already here` : "") : here.length ? `${here.slice(0, 3).join(", ")} ${here.length > 1 ? "build" : "builds"} it (no new units in this act)` : "nobody yet";
    return { founder, generated: gen, here, text };
  }
  /** A package is down: its generated caretakers step out of the pod (story.js has already brought its founder). */
  crew(pkg, founderCame = false) {
    if (!pkg) return [];
    const M = pkg.manifest || { caretakers: pkg.kind === "construction_unit" && !founderCame ? 1 : 0 };
    const need = Math.max(0, (M.caretakers || 0) - (founderCame ? 1 : 0));
    const n = Math.max(0, Math.min(need, this.genCap() - this.generated())), out = [];
    for (let i = 0; i < n; i++) {
      const a = i * 1.1 + 0.6;
      const u = this.spawn({ x: pkg.x + Math.sin(a) * 0.6, z: pkg.z + Math.cos(a) * 0.6, pkg: pkg.id });
      this._go(u, pkg.x + Math.sin(a) * 4.5, pkg.z + Math.cos(a) * 4.5, "inspect", { hold: 3, face: { x: pkg.x, z: pkg.z } });
      out.push(u);
    }
    return out;
  }

  /* ── voices ── */
  async _bark(u, what) {
    const g = this.game, sp = speech(g), D = this._D || await loadStory();
    if (sp.busy || (g.hud.ui && g.hud.ui.cutscene && g.hud.ui.cutscene.active) || this.talking) return;
    const st = this.story, act = st ? st.act() : "I", vars = st ? st.vars() : {};
    const F = D.founders[u.callsign] || D.second[u.callsign] || (u.callsign === "GALE_ANVIL" ? D.others.GALE_ANVIL : null);
    if (F) {
      let pool = [];
      if (what === "idle" || what === "greeting") pool = F.idle && !Array.isArray(F.idle) ? F.idle[act] || F.idle[Object.keys(F.idle).pop()] || [] : F.idle || [];
      else pool = (F.reactions && F.reactions[what]) || [];
      pool = pool.filter((l) => !l.if || evalCond(l.if, vars));
      if (!pool.length) return;
      const l = pool[Math.floor(Math.random() * pool.length)];
      g.emit("unit:bark", { unit: u, text: l.text, line: l.line });
      return sp.say(l, { bark: true });
    }
    const text = this._template(u, what === "build_complete" ? "build_complete" : what === "storm" ? "weather" : what === "greeting" ? "greeting" : null, D);
    if (!text) return;
    g.emit("unit:bark", { unit: u, text });
    return sp.say({ speaker: "UNIT:" + u.template, text, preset: "grille" }, { bark: true, callsign: u.callsign, who: u.callsign });
  }
  /** A generated unit's line from the population's bark templates, filled in. */
  _template(u, key, D = this._D) {
    if (!D) return null;
    const st = this.story, act = st ? st.act() : "I", P = D.population, T = P.bark_templates;
    key = key || (act === "III" && T.act3_wrong && Math.random() < 0.4 ? "act3_wrong" : (act === "IV" || act === "V") && T.act4_knowing && Math.random() < 0.4 ? "act4_knowing" : Math.random() < 0.5 ? "greeting" : "work");
    // the Echo: from Act III some units are another region's copy of a founder, and speak that founder's line exactly
    if (u.echo && act !== "I" && act !== "II" && key !== "build_complete") { const e = P.echo.find((x) => x.line); if (e) { const l = D.line(e.line); if (l) return l.text; } }
    const list = T[key] || T.greeting || []; if (!list.length) return null;
    const tpl = this.template(u) || {}, near = this.units.find((x) => x !== u && !x.recalled);
    const b = this.base; let mod = "the habitat"; try { const ms = b && b.api ? b.api.modules().filter((m) => m.built) : []; if (ms.length) mod = (b.api.balance[ms[ms.length - 1].type] || {}).name || mod; } catch { /* none */ }
    const fill = { callsign: u.callsign, steward: this.get("ANVIL") ? "ANVIL" : "the steward", settlement: "Jezero", module: mod.toLowerCase(), hometown: tpl.hometown || "home", first_name: tpl.first_name || "", ritual_object: "brush", weather: this.game.env && this.game.env.dust && this.game.env.dust.storm ? "Dust" : "Clear", crewmate: near ? near.callsign : "the crew", sols: "a few", pioneer: "Pioneer" };
    return list[Math.floor(Math.random() * list.length)].replace(/\{(\w+)\}/g, (m, k) => (fill[k] != null ? fill[k] : m));
  }
  react(what) {
    const g = this.game, p = this.story ? this.story.playerPos() : g.vehicle.p;
    const u = this.nearest(p.x, p.z, 60, (x) => x.founder && !x.recalled) || this.nearest(p.x, p.z, 40, (x) => !x.recalled);
    if (u) return this._bark(u, what);
  }

  /* ── the dialogue panel ── */
  _ui() {
    const el = this.el = document.createElement("section");
    el.id = "screen-crew"; el.className = "screen modal crew-talk"; el.hidden = true; el.setAttribute("data-pad-closable", "");
    el.innerHTML = `<div class="card wide ct-card"><div class="ct-head"><div><div class="eyebrow ct-unit"></div><h2 class="ct-name"></h2><p class="ct-role"></p></div>
        <dl class="ct-meters"><dt>Mood</dt><dd class="ct-mood"></dd><dt>Charge</dt><dd><i class="ct-bar"><b class="ct-charge"></b></i></dd><dt>Trust</dt><dd><i class="ct-bar"><b class="ct-trust"></b></i></dd></dl></div>
      <p class="ct-status"></p><div class="ct-log" aria-live="polite"></div><div class="ct-topics" role="group" aria-label="Topics"></div>
      <div class="row"><button type="button" class="btn" data-ct="roster">Crew roster</button><button type="button" class="btn primary" data-pad-close data-ct="close">Goodbye</button></div></div>`;
    document.body.appendChild(el);
    el.querySelector('[data-ct="close"]').addEventListener("click", () => this.closeTalk());
    el.querySelector('[data-ct="roster"]').addEventListener("click", () => { this.closeTalk(true); this.openRoster({ keep: true }); });
    // the roster
    const r = this.rosterEl = document.createElement("section");
    r.id = "screen-roster"; r.className = "screen modal crew-roster"; r.hidden = true; r.setAttribute("data-pad-closable", "");
    r.innerHTML = `<div class="card wide cr-card"><div class="cr-head"><div><div class="eyebrow">Settlement</div><h2>Crew roster</h2></div><p class="cr-sum"></p></div>
      <div class="cr-wrap"><table class="cr-table"><thead><tr><th>Callsign</th><th>Role</th><th>Status</th><th>Where</th><th>Charge</th><th>Trust</th><th>Mood</th></tr></thead><tbody></tbody></table></div>
      <p class="fine cr-hint">Walk up to anyone and press E (Cross on the pad) to talk.</p><div class="row"><button type="button" class="btn primary" data-pad-close data-cr="close">Back</button></div></div>`;
    document.body.appendChild(r);
    r.querySelector('[data-cr="close"]').addEventListener("click", () => this.closeRoster());
    window.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === "Escape" && (this.talking || this.rosterOpen)) { e.preventDefault(); e.stopImmediatePropagation(); if (this.talking) this.closeTalk(); else this.closeRoster(); return; }
      if (e.code === "KeyY" && !e.repeat && this.enabled && !e.ctrlKey && !e.metaKey && !e.altKey && !this.talking) { const g = this.game; if (this.rosterOpen) this.closeRoster(); else if (g.live) this.openRoster(); }
    }, true);
    // the pause menu: Crew roster (a campaign only)
    const addMenu = () => {
      const menu = document.getElementById("screen-menu"); if (!menu || document.getElementById("btn-roster")) return;
      const anchor = document.getElementById("btn-keeper") || document.getElementById("btn-resume"); if (!anchor) return;
      const b = document.createElement("button"); b.type = "button"; b.id = "btn-roster"; b.className = "btn"; b.textContent = "Crew roster"; b.hidden = !this.enabled;
      b.addEventListener("click", () => { menu.hidden = true; this.openRoster({ fromMenu: true }); });
      anchor.after(b);
    };
    addMenu(); setTimeout(addMenu, 800); setTimeout(addMenu, 2500);
  }
  _pause(on, fromMenu = false) {
    const g = this.game;
    if (on) { this._resume = g.live; if (g.live) g.pause(true); const menu = document.getElementById("screen-menu"); this._fromMenu = fromMenu || (menu && !menu.hidden); if (menu) menu.hidden = true; }
    else if (this._fromMenu) { const menu = document.getElementById("screen-menu"); if (menu) { menu.hidden = false; const P = window.GeoIDPad; if (P && P.connected) setTimeout(() => { if (!menu.hidden) P.focus.first(menu); }, 60); } this._fromMenu = false; }
    else if (this._resume && g.mode === "menu") g.pause(false);
  }
  /** Talk to a unit: the dialogue panel. o.story = { label, run: async (say) => {} } puts the mission's conversation first; o.autoplay plays it at once. */
  async talk(callsign, o = {}) {
    const u = this.get(callsign); if (!u || u.recalled || !this.el) return false;
    const D = this._D || await loadStory(); this._D = D;
    if (this.talking) this.closeTalk(true);
    this.talking = u; u.prevState = u.state === "walk" ? "idle" : u.state; u.state = "talk"; u.goal = null; if (u.carry) this._drop(u);
    u.wasJob = !!u.job;
    this._story = o.story || null;
    if (!this.rosterOpen) this._pause(true); else { this.rosterOpen = false; this.rosterEl.hidden = true; }
    const sol = this.game.state.clock.sol;
    if (u.talkedSol !== sol) { this._trust(u, 2, "talk"); u.talkedSol = sol; }
    this.el.querySelector(".ct-log").innerHTML = "";
    this.el.hidden = false; document.body.classList.add("crew-open");
    this._renderTalk();
    this.game.emit("unit:talk", { unit: u, topic: "open" });
    const P = window.GeoIDPad; if (P && P.connected) setTimeout(() => P.focus.first(this.el), 60);
    if (o.autoplay && this._story) await this._topic("story");
    else if (!o.quiet) this._line(this._callName(u), this._hello(u));
    return true;
  }
  _hello(u) {
    const D = this._D, F = D && (D.founders[u.callsign] || D.second[u.callsign]);
    if ((u.charge ?? 1) < 0.25) return "Running on the last of it. Make it quick.";
    if (F) { const act = this.story ? this.story.act() : "I", pool = F.idle && !Array.isArray(F.idle) ? F.idle[act] || [] : F.idle || []; const l = pool[hash(u.callsign + this.game.state.clock.sol) % Math.max(1, pool.length)]; if (l) return l.text; }
    return this._template(u, "greeting") || "Pioneer.";
  }
  _line(who, text, cls = "") { const log = this.el.querySelector(".ct-log"), p = document.createElement("p"); p.className = "kt-line " + cls; p.innerHTML = (who ? `<b>${esc(who)}</b>` : "") + `<span>${esc(text)}</span>`; log.appendChild(p); log.scrollTop = log.scrollHeight; return p; }
  /** Say a unit's line: into the panel's log and the speech queue (voice when the line has one). */
  async _say(u, line) {
    const l = typeof line === "string" ? { speaker: u.callsign, text: line } : line;
    const mine = !l.speaker || l.speaker === u.callsign || /^UNIT/.test(l.speaker);
    this._line(l.speaker === "P1" ? "YOU" : mine ? this._callName(u) : l.speaker, l.text, l.speaker === "P1" ? "ct-you" : "");
    if (l.line) return speech(this.game).say(l);
    return speech(this.game).say(Object.assign({ preset: u.founder ? "live" : "grille" }, l), { callsign: u.callsign, who: mine ? this._callName(u) : undefined });
  }
  _callName(u) { const st = this.storyInst; return this.story && this.story.vars()["names.used." + u.callsign] && st ? (st.donorName(u.callsign) || u.callsign).split(" ")[0].toUpperCase() : u.callsign; }
  _renderTalk() {
    const u = this.talking; if (!u) return;
    const el = this.el, D = this._D, st = this.storyInst, vars = this.story ? this.story.vars() : {};
    const real = vars["names.used." + u.callsign] && st ? st.donorName(u.callsign) : null;
    el.querySelector(".ct-unit").textContent = `Unit ${u.unitNo}${u.founder ? " · founder" : ""}${u.echo ? " · echo" : ""}`;
    el.querySelector(".ct-name").textContent = real ? `${real} · ${u.callsign}` : u.callsign;
    const F = D && D.founders[u.callsign];
    el.querySelector(".ct-role").textContent = this.roleOf(u) + (F && F.steward_of ? ` · steward of ${F.steward_of}` : "");
    el.querySelector(".ct-mood").textContent = this.mood(u);
    el.querySelector(".ct-charge").style.width = Math.round((u.charge ?? 1) * 100) + "%";
    el.querySelector(".ct-trust").style.width = Math.round(u.trust || 0) + "%";
    el.querySelector(".ct-charge").parentNode.title = Math.round((u.charge ?? 1) * 100) + "%";
    el.querySelector(".ct-trust").parentNode.title = Math.round(u.trust || 0) + " / 100";
    const P = u.promise && !u.promise.done ? ` · you promised ${u.promise.text}` : u.promiseNote === "kept" ? " · you kept your word" : u.promiseNote === "broken" ? " · a promise you did not keep" : "";
    el.querySelector(".ct-status").textContent = `${u.wasJob ? "Was" : "Now"}: ${this.status(u, u.prevState)}${P}`;
    const box = el.querySelector(".ct-topics"), PAD = window.GeoIDPad, cur = PAD && PAD.focus && PAD.focus.current ? PAD.focus.current() : null;
    const curId = cur && box.contains(cur) && cur.dataset ? cur.dataset.topic : null;
    box.innerHTML = this.topics(u).map((t) => `<button type="button" class="btn${t.id === "story" ? " primary" : ""}" data-topic="${esc(t.id)}">${esc(t.label)}</button>`).join("");
    box.querySelectorAll("[data-topic]").forEach((b) => b.addEventListener("click", () => this._topic(b.dataset.topic)));
    // the pad's ring stays on the topic it was on (the buttons were just rebuilt)
    if (curId && PAD.focus.to) PAD.focus.to(box.querySelector(`[data-topic="${curId}"]`) || box.querySelector("button"));
  }
  /** The topics a unit has to talk about right now. */
  topics(u) {
    const out = [], st = this.storyInst, vars = this.story ? this.story.vars() : {};
    if (this._story) out.push({ id: "story", label: this._story.label || "About the mission" });
    out.push({ id: "work", label: "How's the work?" }, { id: "base", label: "How's the base?" }, { id: "memory", label: "What do you remember?" });
    out.push({ id: "need", label: u.promise && !u.promise.done ? "About what I promised" : "Anything you need?" });
    for (const m of this._quests(u)) out.push({ id: "quest:" + m.id, label: m.active ? `${m.title}: how is it going?` : `Your request: ${m.title}` });
    if (vars["names.known." + u.callsign] && !vars["names.used." + u.callsign] && st) {
      const full = st.donorName(u.callsign);
      if (full) out.push({ id: "name", label: u.callsign === "ANVIL" ? "Des?" : `Call them ${full.split(" ")[0]}` });
    }
    return out;
  }
  /** Side missions this unit gives (acts.json: their Second Ring quest, a side mission whose giver or talk target they are). */
  _quests(u) {
    const st = this.storyInst, S = st && st.S, D = this._D; if (!S || !D) return [];
    const sec = D.second[u.callsign], qid = sec && sec.quest;
    return D.acts.missions.filter((m) => m.kind !== "main" && (m.id === qid || m.giver === u.callsign || (m.objectives || []).some((o) => o.unit === u.callsign && o.type === "talk")) && (S.avail.includes(m.id) || S.active[m.id]))
      .map((m) => ({ id: m.id, title: m.title, summary: m.summary, active: !!S.active[m.id] }));
  }
  async _topic(id) {
    const u = this.talking; if (!u || this._busy) return;
    this._busy = true;
    try {
      const D = this._D, st = this.storyInst, act = this.story ? this.story.act() : "I", F = D.founders[u.callsign] || D.second[u.callsign];
      this.game.emit("unit:talk", { unit: u, topic: id });
      if (id === "story" && this._story) { const s = this._story; this._story = null; this._renderTalk(); await s.run((l) => this._say(u, l)); }
      else if (id === "work") {
        this._line("YOU", "How's the work?", "ct-you");
        if (u.wasJob) await this._say(u, `I'm on it: ${this.status(u, u.prevState)}.`);
        const pool = F ? (F.idle && !Array.isArray(F.idle) ? F.idle[act] || [] : F.idle || []) : [];
        if (pool.length) await this._say(u, pool[(hash(u.callsign) + (this._n = (this._n || 0) + 1)) % pool.length]);
        else await this._say(u, this._template(u, "work") || "Same as yesterday. Same as tomorrow.");
      } else if (id === "base") {
        this._line("YOU", "How's the base?", "ct-you");
        await this._say(u, this._baseReport(u));
      } else if (id === "memory") {
        this._line("YOU", "What do you remember? From before.", "ct-you");
        const tpl = this.template(u);
        if (F && F.memory_fragment) await this._say(u, F.memory_fragment);
        else if (tpl && tpl.memory) await this._say(u, `Bits come back. ${tpl.memory}`);
        else await this._say(u, "Not much. It's like the tape ran out.");
        this._trust(u, 1, "memory", 1);
      } else if (id === "need") await this._need(u);
      else if (id.startsWith("quest:")) {
        const mid = id.slice(6), m = D.mission(mid), S = st.S;
        if (S.active[mid]) { this._line("YOU", "How is it going?", "ct-you"); await this._say(u, `Still waiting on you for this one. ${m.summary}`); }
        else {
          this._line("YOU", "What do you need?", "ct-you");
          await this._say(u, m.summary);
          const k = this.game.hud.ui && this.game.hud.ui.choose ? await this.game.hud.ui.choose({ prompt: m.title, options: ["I'll do it", "Not now"] }) : 0;
          if (k === 0) { if (m.trigger && m.trigger.on === "any") st.fire({ on: "player_start", id: mid }); else st.startMission(mid); this._trust(u, 3, "quest", 3); await this._say(u, "Thanks. I mean it."); }
        }
      } else if (id === "name") await this._name(u);
    } catch (e) { console.warn("[caretakers] topic", id, e); }
    finally { this._busy = false; this._renderTalk(); }
  }
  _baseReport(u) {
    const hb = this._homeBase(u); let s = null; try { s = hb ? this.base.api.resources(hb.id) : null; } catch { s = null; }
    if (!s) return "There's no base yet. Just the plan and us.";
    const bits = [`${s.name}: ${s.built} module${s.built === 1 ? "" : "s"} up${s.building + (s.atPod || 0) ? `, ${s.building + (s.atPod || 0)} still to build` : ""}.`];
    const P = s.power;
    bits.push(P.capacity_Wh > 0 ? `Batteries at ${Math.round(P.fraction * 100)} percent.` : "No battery yet. We go dark at sunset.");
    bits.push(s.food.perSol < -0.01 ? `Food for ${Math.max(0, s.food.kg / -s.food.perSol).toFixed(0)} sols.` : `${Math.round(s.food.kg)} kilos of food in the stores.`);
    bits.push(`${Math.round(s.water.l)} litres of water.`);
    const bad = s.alerts.find((a) => a.level === "bad"); if (bad) bits.push(`And: ${bad.text.toLowerCase()}.`);
    if (!this._builtOf(hb.id).some((m) => /^hab/.test(m.type))) bits.push("Nowhere to sleep yet.");
    return bits.join(" ");
  }
  async _need(u) {
    const sol = this.game.state.clock.sol;
    if (u.promise && !u.promise.done) { this._line("YOU", "About what I promised.", "ct-you"); await this._say(u, `I know. You said ${u.promise.text}. By sol ${u.promise.due}.`); return; }
    this._line("YOU", "Anything you need?", "ct-you");
    const hb = this._homeBase(u); let s = null; try { s = hb ? this.base.api.resources(hb.id) : null; } catch { s = null; }
    const built = hb ? this._builtOf(hb.id) : [], hab = built.some((m) => /^hab/.test(m.type) && m.habitable);
    let ask = null;
    if ((u.charge ?? 1) < 0.5 || (s && s.power.capacity_Wh > 0 && s.power.fraction < 0.3)) ask = { kind: "power", say: "Charge. The bank's not keeping up and I'm running on the dregs.", text: "more power for the base" };
    else if (!hab && built.length) ask = { kind: "hab", say: "Somewhere to stand down at night that isn't the dust.", text: "a habitat to rest in" };
    else if ((u.morale ?? 1) < 0.55) ask = { kind: "visit", say: "Company, mostly. Come back tomorrow, would you?", text: "to come back and talk tomorrow" };
    if (!ask) { await this._say(u, "Nothing. Kind of you to ask."); this._trust(u, 1, "asked", 1); return; }
    await this._say(u, ask.say);
    const k = this.game.hud.ui && this.game.hud.ui.choose ? await this.game.hud.ui.choose({ prompt: `Promise ${this._callName(u)} ${ask.text}?`, options: ["I promise", "I can't promise that"] }) : 0;
    if (k === 0) { u.promise = { kind: ask.kind, text: ask.text, sol, due: sol + 2, done: false }; u.promiseNote = null; this._line("YOU", "You'll have it. I promise.", "ct-you"); await this._say(u, "I'll hold you to that."); }
    else await this._say(u, "Fair enough. Honest, anyway.");
  }
  async _name(u) {
    const st = this.storyInst, D = this._D, full = st.donorName(u.callsign), F = D.founders[u.callsign] || D.second[u.callsign];
    if (u.callsign === "ANVIL") { const nl = F && F.reactions && F.reactions.name_lock; this._line("YOU", "Des?", "ct-you"); if (nl && nl.length) for (const l of nl.slice(0, 2)) await this._say(u, l); else await this._say(u, "Don't. Not yet."); return; }
    const first = full.split(" ")[0];
    this._line("YOU", `${first}?`, "ct-you");
    st.setVar("names.used." + u.callsign, true);
    this.game.emit("story:named", { unit: u.callsign, name: full });
    this._trust(u, 5, "name");
    const nl = F && F.reactions && F.reactions.named;
    if (nl && nl.length) for (const l of nl) await this._say(u, l);
    else await this._say(u, `${first}. Nobody's called me that in a long time. Say it again some time.`);
  }
  closeTalk(keep = false) {
    const u = this.talking; if (!u) return;
    this.talking = null; this._story = null; this.el.hidden = true; if (!this.rosterOpen) document.body.classList.remove("crew-open");
    u.state = !u.prevState || u.prevState === "talk" ? "idle" : u.prevState; u.next = u.t + 4;
    if (u.state === "walk" || u.state === "build") { u.state = "idle"; }
    if (u.job) this._drop(u);                                                          // the job resumes through _assign (its crates freed for whoever takes it)
    const P = window.GeoIDPad; if (P && P.focus) P.focus.clear();
    if (!keep) this._pause(false);
    this.game.emit("unit:talk", { unit: u, topic: "close" });
  }

  /* ── the roster ── */
  openRoster(o = {}) {
    if (!this.rosterEl) return false;
    if (!this.rosterOpen && !o.keep) this._pause(true, !!o.fromMenu);
    this.rosterOpen = true; this.rosterEl.hidden = false; document.body.classList.add("crew-open");
    this._fillRoster();
    const P = window.GeoIDPad; if (P && P.connected) setTimeout(() => P.focus.first(this.rosterEl), 60);
    return true;
  }
  _where(u, bases) {
    if (u.state === "dormant") return "in the pod";
    let best = null, bd = Infinity; for (const x of bases) { const d = Math.hypot(x.x - u.x, x.z - u.z); if (d < bd) { bd = d; best = x; } }
    return best && bd < 200 ? `${best.name} base` : bases.length ? `${Math.round(bd)} m out` : "at the drop";
  }
  rosterRows() {
    const b = this.base, bases = b && b.api ? b.api.bases() : [];
    return this.units.filter((u) => u.state !== "away").map((u) => ({ callsign: u.callsign, name: this._callName(u), unit: u.unitNo, role: this.roleOf(u), status: this.status(u), where: this._where(u, bases), charge: u.charge ?? 1, trust: u.trust || 0, mood: this.mood(u), recalled: !!u.recalled }));
  }
  _fillRoster() {
    const rows = this.rosterRows();
    this.rosterEl.querySelector("tbody").innerHTML = rows.map((r) => `<tr class="${r.recalled ? "cr-off" : ""}"><td><b>${esc(r.name)}</b><span>${esc(r.unit)}</span></td><td>${esc(r.role)}</td><td>${esc(r.status)}</td><td>${esc(r.where)}</td>
      <td><i class="ct-bar" title="${Math.round(r.charge * 100)}%"><b style="width:${Math.round(r.charge * 100)}%"></b></i></td><td class="cr-trust"><i class="ct-bar"><b style="width:${Math.round(r.trust)}%"></b></i><span>${Math.round(r.trust)}</span></td><td>${esc(r.mood)}</td></tr>`).join("")
      || `<tr><td colspan="7" class="cr-empty">Nobody yet. The caretakers come down with the first plan you send to HALO-1.</td></tr>`;
    const by = {}; for (const r of rows) by[r.where] = (by[r.where] || 0) + 1;
    this.rosterEl.querySelector(".cr-sum").textContent = rows.length ? `${rows.length} caretaker${rows.length > 1 ? "s" : ""} · ` + Object.entries(by).map(([k, n]) => `${n} ${k.startsWith("in ") || k.startsWith("at ") ? k : "at " + k}`).join(" · ") : "";
  }
  closeRoster() {
    if (!this.rosterOpen) return;
    this.rosterOpen = false; this.rosterEl.hidden = true; if (!this.talking) document.body.classList.remove("crew-open");
    const P = window.GeoIDPad; if (P && P.focus) P.focus.clear();
    this._pause(false);
  }

  /* ── the filter drops for a frame ── */
  async unfiltered(seconds = 0.15) {
    const cam = this.game.camera.position;
    for (const u of this.units) {
      if (!u.mesh || !u.mesh.visible || !u.actor || !u.actor.character || Math.hypot(u.x - cam.x, u.z - cam.z) > 120) continue;
      u.actor.character.unfiltered(true); u.kestrel = true;
    }
    this._unfilteredUntil = performance.now() + seconds * 1000;
  }
  _filterBack() { this._unfilteredUntil = 0; for (const u of this.units) { if (u.kestrel && u.actor && u.actor.character) { u.actor.character.unfiltered(false); u.kestrel = false; } if (u.mesh) u.mesh.visible = this._shown(u); } }

  recall(c) {
    const u = this.get(c); if (!u) return null;
    if (u.job) this._drop(u);
    u.recalled = true; u.state = "idle"; u.site = null; u.goal = null; u.inside = false;
    if (u.mesh) u.mesh.visible = true;
    if (u.actor) { this._anim(u, "recalled"); if (u.actor.character) u.actor.character.setVisor(0x1a1c1f); }
    return u;
  }
  wake(c) {
    const u = this.get(c);
    if (u && u.state === "dormant") { u.state = "idle"; this._place(u); const H = getSystem("halo"), pk = u.pkg && H && H.api ? H.api.get(u.pkg) : null; if (pk) this._go(u, pk.x + 4.2, pk.z + 2.4, "inspect", { hold: 3, face: pk }); }
    return u;
  }

  toJSON() {
    return { v: 2, used: [...this.used], units: this.units.map((u) => ({ callsign: u.callsign, founder: u.founder, unitNo: u.unitNo, template: u.template, x: Math.round(u.x * 10) / 10, z: Math.round(u.z * 10) / 10, yaw: u.yaw,
      state: u.state === "walk" || u.state === "build" || u.state === "talk" ? "idle" : u.state, inside: !!u.inside, pkg: u.pkg, joinedSol: u.joinedSol, echo: u.echo, recalled: u.recalled,
      charge: Math.round((u.charge ?? 0.9) * 1000) / 1000, morale: Math.round((u.morale ?? 0.7) * 1000) / 1000, trust: Math.round((u.trust || 0) * 10) / 10, promise: u.promise || null, promiseNote: u.promiseNote || null, talkedSol: u.talkedSol ?? -1 })) };
  }
  fromJSON(s) {
    for (const u of this.units) { if (u.actor) u.actor.dispose(); else if (u.mesh) this.root.remove(u.mesh); }
    for (const t of this._tags.values()) t.remove(); this._tags.clear();
    if (this.talking) this.closeTalk(true);
    this.units = []; this.used = new Set((s && s.used) || []);
    for (const r of (s && s.units) || []) { const u = Object.assign({ t: Math.random() * 10, next: 0, site: null, job: null, carry: null, charge: 0.9, morale: 0.7, trust: r.founder ? 20 : 10, trustSol: {}, greetT: 0 }, r); this.units.push(u); this._place(u); if (u.recalled) this.recall(u.callsign); }
  }
}

let C = null;
const sys = {
  id: "caretakers", order: 86,
  get caretakers() { return C; },
  api: {
    get enabled() { return !!(C && C.enabled); },
    setEnabled: (on) => {
      if (!C) return; C.enabled = !!on; C.root.visible = !!on;
      const net = C.net; if (net) net.crewGate = on ? (m) => C.crewRate(m) : null;        // basenet: a module advances only with someone at it
      const b = typeof document !== "undefined" && document.getElementById("btn-roster"); if (b) b.hidden = !on;
    },
    spawn: (o) => (C ? C.spawn(o) : null),
    list: () => (C ? C.list() : []),
    get: (c) => (C ? C.get(c) : null),
    nearest: (x, z, r, f) => (C ? C.nearest(x, z, r, f) : null),
    recall: (c) => (C ? C.recall(c) : null),
    wake: (c) => (C ? C.wake(c) : null),
    crewAt: (id) => !!(C && C.crewAt(id)),
    builders: (id) => (C ? C.builders(id) : []),
    carrier: (id) => (C ? C.carrier(id) : null),
    count: () => (C ? C.units.filter((u) => !u.recalled && u.state !== "away").length : 0),
    crew: (pkg, founderCame) => (C ? C.crew(pkg, founderCame) : []),
    forecast: (M) => (C ? C.forecast(M) : null),
    jobs: () => (C ? C.jobs().map((j) => ({ id: j.id, kind: j.kind, pri: j.pri })) : []),
    fastForward: (s) => C && C.fastForward(s),
    unfiltered: (s) => C && C.unfiltered(s),
    react: (w) => C && C.react(w),
    bark: (c, w = "idle") => { const u = C && C.get(c); return u ? C._bark(u, w) : null; },
    barks: (on) => { if (C) C.barkOn = !!on; },
    sites: () => (C ? C.sites() : []),
    talk: (c, o) => (C ? C.talk(c, o) : false),
    closeTalk: () => C && C.closeTalk(),
    topic: (id) => (C ? C._topic(id) : null),
    topics: (c) => { const u = C && C.get(c); return u ? C.topics(u) : []; },
    get talking() { return C && C.talking ? C.talking.callsign : null; },
    get busy() { return !!(C && C._busy); },
    roster: () => C && C.openRoster(),
    rosterRows: () => (C ? C.rosterRows() : []),
    closeRoster: () => C && C.closeRoster(),
    get rosterOpen() { return !!(C && C.rosterOpen); },
    status: (c) => { const u = C && C.get(c); return u ? { callsign: u.callsign, role: C.roleOf(u), state: u.state, act: u.act || null, status: C.status(u), mood: C.mood(u), charge: u.charge, morale: u.morale, trust: u.trust, promise: u.promise, job: u.job ? u.job.id : null, carrying: !!u.carry, inside: !!u.inside } : null; },
  },
  async init(game) {
    C = new Caretakers(game);
    loadStory().then((D) => { C._D = D; }).catch(() => {});
    const b = getSystem("base");
    if (b && b.api && b.api.on) b.api.on("built", () => { if (C.enabled) C.react("build_complete"); });
    game.on("halo:landed", () => { if (C.enabled) setTimeout(() => C.react("package"), 2500); });
    game.on("mode", (mode) => { if (mode !== "menu") { if (C.talking) C.closeTalk(true); if (C.rosterOpen) { C.rosterOpen = false; C.rosterEl.hidden = true; } document.body.classList.remove("crew-open"); } });
  },
  load(game, saved) { if (C) { C.fromJSON(saved); } },
  save() { return C ? C.toJSON() : undefined; },
  tick(game, dt, ctx) { if (C) C.update(dt, ctx.simDt); },
  frame(game, dt) {
    if (C && C.enabled && C._unfilteredUntil && performance.now() > C._unfilteredUntil) C._filterBack();
    if (C && C.rosterOpen && (C._rAcc = (C._rAcc || 0) + (dt || 0)) > 1) { C._rAcc = 0; C._fillRoster(); }
  },
};
registerSystem(sys);
