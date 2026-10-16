/**
 * CARETAKERS: the construction units. They ride down in the care packages,
 * walk from the pod to whatever is waiting to be built, assemble it through
 * the base's own construction crews, and then live in the base: rounds,
 * brushing the arrays at first light, standing down at night, talking.
 *
 * System "caretakers" (order 86). Active in a story campaign only.
 *
 *   THE CREW. In a campaign a module under construction advances only while a crew is at it
 *   (basenet's own "waiting for a crew" state, which the construction labels already show): a unit
 *   standing beside it, or, before the first unit has landed, the pioneer himself within 30 m. The
 *   number of modules built at once is the number of units (at least one). The base system's
 *   construction step is wrapped on the instance (game/basenet.js is not edited); free roam is untouched.
 *   Planned structures the kit does not have yet (domes, relay towers: tiers.js) are built the same way.
 *
 *   WHO THEY ARE. Founders (ANVIL, LODESTONE, WELLSPRING...) are named characters with authored,
 *   voiced lines (story/dialogue/founders.json); everyone else is stamped from one of the ~60 donor
 *   templates in story/population.json with a generated callsign (TRUSS-114: a word from the role's
 *   bank and a number unique in this region) and speaks the population's bark templates (text only:
 *   they are runtime lines). From Act III some generated units are the Echo: another region's copy of a
 *   founder's donor, speaking that founder's authored line word for word.
 *
 *   THE FILTER. On a story glitch that drops the filter for a frame, every unit near the camera is drawn
 *   as what it is: a Kestrel chassis (the astronaut model) instead of a yellow machine.
 *
 *   getSystem("caretakers").api = { spawn(o), list(), get(callsign), nearest(x, z, r, filter), recall(callsign),
 *     wake(callsign), crewAt(moduleId), count(), fastForward(simSeconds), unfiltered(seconds), barks(on) }
 *   events on the game: "unit:arrived" {unit}, "unit:task" {unit, site}, "unit:bark" {unit, text}
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { registerSystem, getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { RULES, MODULES } from "./basenet.js?v=b8cfe8e-efa5b7b7";
import { loadStory, speech, rng, hash, evalCond } from "./storydata.js?v=b8cfe8e-efa5b7b7";

const WALK = 2.2, HURRY = 9, SITE_R = 6.5, PLAYER_CREW_R = 30;
const FOUNDER_COLOURS = { ANVIL: 0xf2b705, LODESTONE: 0xd98e04, WELLSPRING: 0xe8c547, BEACON: 0xf2a541, FURROW: 0xc9a227, CADENCE: 0xf6c90e, SUTURE: 0xeec643, TALLY: 0xd4a017, GALE_ANVIL: 0xf2b705 };

/* ── the picture: a squat yellow machine on tracks, a sensor bar for a head ── */
const _geo = {}, _mat = new Map();
const geo = (k, f) => _geo[k] || (_geo[k] = f());
const mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!_mat.has(k)) _mat.set(k, new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.25 }, o))); return _mat.get(k); };
function unitMesh(colour) {
  const g = new THREE.Group(), y = mat(colour), dk = mat(0x2a2e33, { roughness: 0.7 }), sens = mat(0x0b1016, { emissive: 0x00d8ff, emissiveIntensity: 1.6 });
  const box = (w, h, d) => geo(`b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
  const add = (m, x, yy, z, p = g) => { m.position.set(x, yy, z); p.add(m); return m; };
  add(new THREE.Mesh(box(0.32, 0.38, 1.25), dk), -0.42, 0.19, 0); add(new THREE.Mesh(box(0.32, 0.38, 1.25), dk), 0.42, 0.19, 0);
  const body = add(new THREE.Mesh(box(0.86, 0.78, 0.92), y), 0, 0.82, 0);
  const head = new THREE.Group(); head.position.set(0, 1.32, 0.05); g.add(head);
  add(new THREE.Mesh(box(0.62, 0.2, 0.3), dk), 0, 0, 0, head);
  add(new THREE.Mesh(box(0.5, 0.06, 0.02), sens), 0, 0.01, 0.16, head);
  const arm = (s) => {
    const a = new THREE.Group(); a.position.set(s * 0.5, 1.02, 0.2); g.add(a);
    add(new THREE.Mesh(box(0.12, 0.12, 0.62), y), 0, 0, 0.28, a);
    const fore = new THREE.Group(); fore.position.set(0, 0, 0.58); a.add(fore);
    add(new THREE.Mesh(box(0.1, 0.1, 0.5), dk), 0, -0.12, 0.2, fore).rotation.x = 0.5;
    add(new THREE.Mesh(box(0.06, 0.16, 0.12), dk), 0.05, -0.28, 0.42, fore); add(new THREE.Mesh(box(0.06, 0.16, 0.12), dk), -0.05, -0.28, 0.42, fore);
    return a;
  };
  const armL = arm(-1), armR = arm(1);
  const lamp = add(new THREE.Mesh(geo("lamp", () => new THREE.SphereGeometry(0.05, 8, 6)), mat(0xffc000, { emissive: 0xffa000, emissiveIntensity: 2 })), 0, 1.5, -0.1);
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  g.userData = { body, head, armL, armR, lamp };
  return g;
}
const SPARK = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });

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
  }
  get story() { const s = getSystem("story"); return s && s.api ? s.api : null; }
  get base() { return getSystem("base"); }

  /** A new unit. o: { callsign, founder, unitNo, template, x, z, state, pkg, role } */
  spawn(o = {}) {
    const D = this._D;
    let u = o.callsign ? this.get(o.callsign) : null;
    if (u) { if (o.x != null) { u.x = o.x; u.z = o.z; } if (u.state === "away") u.state = o.state || "idle"; this._place(u); return u; }
    const r = rng(hash((o.callsign || "") + this.units.length + (this.story ? this.story.seed() : 1)));
    let tpl = o.template;
    if (!tpl && D) {
      const T = D.population.templates;
      if (o.founder) tpl = (T.find((t) => t.founder_callsign === o.callsign.replace(/^GALE_/, "")) || {}).id;
      else tpl = T[Math.floor(r() * T.length)].id;
    }
    const callsign = o.callsign || this._callsign(tpl, r);
    u = { callsign, founder: !!o.founder, unitNo: o.unitNo || (o.founder ? this._founderNo(callsign) : "C-" + String(100 + this.units.length).padStart(3, "0")), template: tpl || null,
      x: o.x ?? this.game.vehicle.p.x + 8, z: o.z ?? this.game.vehicle.p.z + 8, yaw: r() * Math.PI * 2, state: o.state || "idle", site: null, pkg: o.pkg || null, joinedSol: this.game.state.clock.sol,
      echo: !!o.echo, recalled: false, t: r() * 10, next: 0 };
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

  _place(u) {
    if (!u.mesh) {
      u.mesh = unitMesh(u.founder ? FOUNDER_COLOURS[u.callsign] || 0xf2b705 : u.echo ? 0xe3a008 : 0xdba21a);
      u.mesh.name = "unit:" + u.callsign;
      this.root.add(u.mesh);
    }
    u.mesh.visible = u.state !== "away" && u.state !== "dormant";
    this._ground(u);
  }
  _ground(u) { const y = this.game.surface.height(u.x, u.z); u.mesh.position.set(u.x, y, u.z); u.mesh.rotation.y = u.yaw; }

  /* ── the crew ── */
  /** The modules waiting to be built (kit modules and the story's planned structures), oldest first. */
  sites() {
    const out = [], b = this.base;
    try { if (b && b.api) for (const m of b.api.modules()) if (!m.built) out.push({ id: m.id, x: m.x, z: m.z, r: 4, kind: "module", seq: 0 }); } catch { /* none */ }
    const t = getSystem("tiers"); if (t && t.api && t.api.sites) for (const s of t.api.sites()) out.push(Object.assign({ kind: "planned" }, s));
    return out;
  }
  crewAt(id) { return this.units.some((u) => u.site === id && u.state === "build"); }
  playerCrew(x, z) {
    if (this.units.some((u) => !u.recalled && u.state !== "away" && u.state !== "dormant")) return false;
    const p = this.story ? this.story.playerPos() : this.game.vehicle.p;
    return Math.hypot(p.x - x, p.z - z) < PLAYER_CREW_R;
  }
  /** The base's construction step, wrapped: a module advances only with a crew at it. */
  hookBase() {
    const b = this.base, net = b && b.net;
    if (!net || net._storyWrapped) return;
    const orig = net._construct.bind(net), self = this;
    net._construct = function (h) {
      if (!self.enabled) return orig(h);
      const queue = [...net.modules.values()].filter((m) => !(m.progress >= 1)).sort((a, c) => a.seq - c.seq);
      let crews = Math.max(1, self.units.filter((u) => !u.recalled && u.state !== "away" && u.state !== "dormant").length);
      for (const m of queue) {
        let w = null; try { w = b.worldOf(m); } catch { w = null; }
        const crew = !!w && (self.crewAt(m.id) || self.playerCrew(w.x, w.z));
        m.queued = !crew || crews <= 0;
        if ((!crew || crews <= 0) && !net.sandbox) continue;
        crews--;
        m.progress = net.sandbox ? 1 : Math.min(1, m.progress + h / Math.max(0.05, MODULES[m.type].build_h));
        if (m.progress >= 1) net._commission(m);
      }
    };
    net._storyWrapped = true;
    RULES._storyCrews = RULES.crews;
  }

  /* ── per frame ── */
  update(dt, simDt) {
    const g = this.game, focus = this.story ? this.story.playerPos() : g.vehicle.p;
    if (!this.enabled) return;
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.5) { this._acc = 0; this._assign(); }
    const night = g.sky && g.sky.sun.sinEl < -0.05;
    for (const u of this.units) {
      if (u.state === "away" || u.state === "dormant" || !u.mesh) continue;
      u.t += dt;
      const P = u.mesh.userData;
      if (u.recalled) { P.head.rotation.x = 0.5; P.body.rotation.z = 0.12; continue; }
      if (u.state === "walk" && u.goal) {
        const dx = u.goal.x - u.x, dz = u.goal.z - u.z, d = Math.hypot(dx, dz);
        const far = Math.hypot(u.x - focus.x, u.z - focus.z) > 140;
        const step = (far ? HURRY : WALK) * dt;
        if (d <= Math.max(0.3, step)) { u.x = u.goal.x; u.z = u.goal.z; u.state = u.goal.then || "idle"; u.goal = null; if (u.state === "build") g.emit("unit:task", { unit: u, site: u.site }); }
        else { u.x += dx / d * step; u.z += dz / d * step; const want = Math.atan2(dx, dz); u.yaw += Math.atan2(Math.sin(want - u.yaw), Math.cos(want - u.yaw)) * Math.min(1, dt * 4); }
        P.armL.rotation.x = Math.sin(u.t * 5) * 0.25; P.armR.rotation.x = -Math.sin(u.t * 5) * 0.25;
        this._ground(u);
      } else if (u.state === "build") {
        P.armL.rotation.x = -0.6 + Math.sin(u.t * 7) * 0.5; P.armR.rotation.x = -0.4 + Math.sin(u.t * 7 + 1.7) * 0.5;
        P.head.rotation.y = Math.sin(u.t * 0.9) * 0.4;
        if (Math.random() < dt * 6 && Math.hypot(u.x - focus.x, u.z - focus.z) < 80) this._spark(u);
        const s = this.sites().find((x) => x.id === u.site);
        if (!s) { u.state = "idle"; u.site = null; this._bark(u, "build_complete"); }
      } else {
        // idle: stand down at night, wander between the modules by day
        P.armL.rotation.x *= 0.9; P.armR.rotation.x *= 0.9;
        P.head.rotation.y = Math.sin(u.t * 0.4) * 0.6;
        P.lamp.visible = !night || (u.t % 3) < 1.5;
        if (!night && u.t > u.next) { u.next = u.t + 12 + Math.random() * 20; const spot = this._wanderSpot(u); if (spot) { u.goal = { x: spot.x, z: spot.z, then: "idle" }; u.state = "walk"; } }
      }
    }
    for (const s of this.sparks.slice()) { s.t += dt; s.m.scale.setScalar(0.06 * (1 - s.t / 0.25)); if (s.t > 0.25) { this.root.remove(s.m); this.sparks.splice(this.sparks.indexOf(s), 1); } }
    if (this._unfilteredUntil && performance.now() > this._unfilteredUntil) this._filterBack();
    // barks: someone near the pioneer says something, now and then
    this._barkT -= dt;
    if (this.barkOn && this._barkT <= 0) { this._barkT = 40 + Math.random() * 50; const u = this.nearest(focus.x, focus.z, 18, (x) => !x.recalled && x.state !== "walk"); if (u) this._bark(u, "idle"); }
    void simDt;
  }
  _wanderSpot(u) {
    const b = this.base; let mods = [];
    try { mods = b && b.api ? b.api.modules().filter((m) => m.built) : []; } catch { mods = []; }
    if (!mods.length) return null;
    const m = mods[Math.floor(Math.random() * mods.length)], a = Math.random() * Math.PI * 2;
    // first light: the arrays get brushed
    const sky = this.game.sky, dawn = sky && sky.sun.sinEl > 0 && sky.sun.sinEl < 0.25;
    const pick = dawn ? mods.find((x) => x.type === "solar_array") || m : m;
    return { x: pick.x + Math.cos(a) * 5, z: pick.z + Math.sin(a) * 5 };
    void u;
  }
  _assign() {
    const sites = this.sites(); if (!sites.length) return;
    const taken = new Set(this.units.filter((u) => u.site).map((u) => u.site));
    for (const u of this.units) {
      if (u.recalled || u.state === "away" || u.state === "dormant") continue;
      if (u.site && !sites.some((s) => s.id === u.site)) { u.site = null; if (u.state === "build") u.state = "idle"; }
      if (u.site) continue;
      let best = null, bd = 1500;
      for (const s of sites) { if (taken.has(s.id)) continue; const d = Math.hypot(s.x - u.x, s.z - u.z); if (d < bd) { bd = d; best = s; } }
      if (!best) continue;
      taken.add(best.id); u.site = best.id;
      const a = Math.atan2(u.x - best.x, u.z - best.z), r = Math.min(SITE_R - 1, (best.r || 4) + 1.2);
      u.goal = { x: best.x + Math.sin(a) * r, z: best.z + Math.cos(a) * r, then: "build" }; u.state = "walk";
    }
  }
  _spark(u) {
    const m = new THREE.Mesh(geo("spark", () => new THREE.SphereGeometry(1, 6, 4)), SPARK);
    const fwd = new THREE.Vector3(Math.sin(u.yaw), 0, Math.cos(u.yaw));
    m.position.set(u.x + fwd.x * 1.1, u.mesh.position.y + 0.8, u.z + fwd.z * 1.1); this.root.add(m); this.sparks.push({ m, t: 0 });
  }
  /** Dormancy: the crews keep working. Walk everyone to their site and let the base build, an hour at a time. */
  fastForward(sim) {
    const b = this.base;
    for (let left = sim; left > 0; left -= 3600) {
      this._assign();
      for (const u of this.units) if (u.goal && u.state === "walk") { u.x = u.goal.x; u.z = u.goal.z; u.state = u.goal.then || "idle"; u.goal = null; }
      const step = Math.min(3600, left);
      try { if (b && b.api) b.api.simulate(step); } catch (e) { console.warn("[caretakers] simulate", e); }
      const t = getSystem("tiers"); if (t && t.api && t.api.advance) t.api.advance(step);
      for (const u of this.units) if (u.state === "build" && !this.sites().some((s) => s.id === u.site)) { u.state = "idle"; u.site = null; }
    }
    for (const u of this.units) if (u.mesh) this._ground(u);
  }

  /* ── voices ── */
  async _bark(u, what) {
    const g = this.game, sp = speech(g), D = this._D || await loadStory();
    if (sp.busy || (g.hud.ui && g.hud.ui.cutscene && g.hud.ui.cutscene.active)) return;
    const st = this.story, act = st ? st.act() : "I", vars = st ? st.vars() : {};
    const name = u.callsign.replace(/^GALE_/, "GALE_");
    const F = D.founders[u.callsign] || D.second[u.callsign] || (u.callsign === "GALE_ANVIL" ? D.others.GALE_ANVIL : null);
    if (F) {
      let pool = [];
      if (what === "idle") pool = F.idle && !Array.isArray(F.idle) ? F.idle[act] || F.idle[Object.keys(F.idle).pop()] || [] : F.idle || [];
      else pool = (F.reactions && F.reactions[what]) || [];
      pool = pool.filter((l) => !l.if || evalCond(l.if, vars));
      if (!pool.length) return;
      const l = pool[Math.floor(Math.random() * pool.length)];
      g.emit("unit:bark", { unit: u, text: l.text, line: l.line });
      return sp.say(l, { bark: true });
    }
    // a generated unit: the population's templates, filled in
    const P = D.population, T = P.bark_templates;
    const key = what === "build_complete" ? "build_complete" : what === "storm" ? "weather" : act === "III" && T.act3_wrong && Math.random() < 0.4 ? "act3_wrong" : (act === "IV" || act === "V") && T.act4_knowing && Math.random() < 0.4 ? "act4_knowing" : Math.random() < 0.5 ? "greeting" : "work";
    const list = T[key] || T.greeting || [];
    if (!list.length) return;
    // the Echo: from Act III some units are another region's copy of a founder, and speak that founder's line exactly
    if (u.echo && act !== "I" && act !== "II") { const e = P.echo.find((x) => x.line); if (e) { const l = D.line(e.line); if (l) return sp.say(l, { bark: true, callsign: u.callsign, who: u.callsign }); } }
    const tpl = P.templates.find((t) => t.id === u.template) || {};
    const near = this.units.find((x) => x !== u && !x.recalled);
    const b = this.base; let mod = "the habitat"; try { const ms = b && b.api ? b.api.modules().filter((m) => m.built) : []; if (ms.length) mod = (b.api.balance[ms[ms.length - 1].type] || {}).name || mod; } catch { /* none */ }
    const fill = { callsign: u.callsign, steward: "ANVIL", settlement: "Jezero", module: mod.toLowerCase(), hometown: tpl.hometown || "home", first_name: tpl.first_name || "", ritual_object: "brush", weather: g.env && g.env.dust && g.env.dust.storm ? "Dust" : "Clear", crewmate: near ? near.callsign : "the crew", sols: "a few", pioneer: "Pioneer" };
    const text = list[Math.floor(Math.random() * list.length)].replace(/\{(\w+)\}/g, (m, k) => (fill[k] != null ? fill[k] : m));
    g.emit("unit:bark", { unit: u, text });
    return sp.say({ speaker: "UNIT:" + u.template, text, preset: "grille" }, { bark: true, callsign: u.callsign, who: u.callsign });
    void name;
  }
  react(what) {
    const g = this.game, p = this.story ? this.story.playerPos() : g.vehicle.p;
    const u = this.nearest(p.x, p.z, 60, (x) => x.founder && !x.recalled) || this.nearest(p.x, p.z, 40, (x) => !x.recalled);
    if (u) return this._bark(u, what);
  }

  /* ── the filter drops for a frame ── */
  async unfiltered(seconds = 0.15) {
    const g = this.game;
    if (!this._kestrel) { try { this._kestrel = await g.assets.load("astronaut"); } catch { this._kestrel = null; } }
    if (!this._kestrel) return;
    const cam = g.camera.position;
    for (const u of this.units) {
      if (!u.mesh || !u.mesh.visible || Math.hypot(u.x - cam.x, u.z - cam.z) > 120) continue;
      if (!u.kestrel) { u.kestrel = this._kestrel.clone(true); u.kestrel.name = "kestrel:" + u.callsign; this.root.add(u.kestrel); }
      u.kestrel.position.copy(u.mesh.position); u.kestrel.rotation.y = u.yaw; u.kestrel.visible = true; u.mesh.visible = false;
    }
    this._unfilteredUntil = performance.now() + seconds * 1000;
  }
  _filterBack() { this._unfilteredUntil = 0; for (const u of this.units) { if (u.kestrel) u.kestrel.visible = false; if (u.mesh) u.mesh.visible = u.state !== "away" && u.state !== "dormant"; } }

  recall(c) {
    const u = this.get(c); if (!u) return null;
    u.recalled = true; u.state = "idle"; u.site = null; u.goal = null;
    if (u.mesh) u.mesh.traverse((o) => { if (o.isMesh) { o.material = mat(0x6b6f73, { roughness: 0.9 }); } });
    return u;
  }
  wake(c) { const u = this.get(c); if (u && u.state === "dormant") { u.state = "idle"; this._place(u); } return u; }

  toJSON() { return { v: 1, used: [...this.used], units: this.units.map((u) => ({ callsign: u.callsign, founder: u.founder, unitNo: u.unitNo, template: u.template, x: Math.round(u.x * 10) / 10, z: Math.round(u.z * 10) / 10, yaw: u.yaw, state: u.state === "walk" || u.state === "build" ? "idle" : u.state, pkg: u.pkg, joinedSol: u.joinedSol, echo: u.echo, recalled: u.recalled })) }; }
  fromJSON(s) {
    for (const u of this.units) { if (u.mesh) this.root.remove(u.mesh); if (u.kestrel) this.root.remove(u.kestrel); }
    this.units = []; this.used = new Set((s && s.used) || []);
    for (const r of (s && s.units) || []) { const u = Object.assign({ t: Math.random() * 10, next: 0, site: null }, r); this.units.push(u); this._place(u); if (u.recalled) this.recall(u.callsign); }
  }
}

let C = null;
const sys = {
  id: "caretakers", order: 86,
  get caretakers() { return C; },
  api: {
    get enabled() { return !!(C && C.enabled); },
    setEnabled: (on) => { if (!C) return; C.enabled = !!on; C.root.visible = !!on; if (on) C.hookBase(); },
    spawn: (o) => (C ? C.spawn(o) : null),
    list: () => (C ? C.list() : []),
    get: (c) => (C ? C.get(c) : null),
    nearest: (x, z, r, f) => (C ? C.nearest(x, z, r, f) : null),
    recall: (c) => (C ? C.recall(c) : null),
    wake: (c) => (C ? C.wake(c) : null),
    crewAt: (id) => !!(C && C.crewAt(id)),
    count: () => (C ? C.units.filter((u) => !u.recalled && u.state !== "away").length : 0),
    fastForward: (s) => C && C.fastForward(s),
    unfiltered: (s) => C && C.unfiltered(s),
    react: (w) => C && C.react(w),
    bark: (c, w = "idle") => { const u = C && C.get(c); return u ? C._bark(u, w) : null; },
    barks: (on) => { if (C) C.barkOn = !!on; },
    sites: () => (C ? C.sites() : []),
  },
  async init(game) {
    C = new Caretakers(game);
    loadStory().then((D) => { C._D = D; }).catch(() => {});
    const b = getSystem("base");
    if (b && b.api && b.api.on) b.api.on("built", () => { if (C.enabled) C.react("build_complete"); });
    game.on("halo:landed", () => { if (C.enabled) setTimeout(() => C.react("package"), 2500); });
  },
  load(game, saved) { if (C) { C.fromJSON(saved); } },
  save() { return C ? C.toJSON() : undefined; },
  tick(game, dt, ctx) { if (C) C.update(dt, ctx.simDt); },
  frame(game, dt) { if (C && C.enabled && C._unfilteredUntil && performance.now() > C._unfilteredUntil) C._filterBack(); void dt; },
};
registerSystem(sys);
