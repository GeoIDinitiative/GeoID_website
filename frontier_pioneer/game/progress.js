/**
 * PROGRESSION AND CUSTOMISATION: contribution credit, Kestrel hardware for the
 * suit and the rover, rover designs, and the pioneer's appearance.
 *
 * System "progress" (order 80: after the missions, the EVA and the base, so it
 * can read what they did). Tables are in progress_data.js, pictures in
 * cosmetics.js, the screen in workshop.js (+ workshop.css).
 *
 *   getSystem("progress").api = {
 *     xp, xpTotal, limits() -> { name, index, maxOpenRequests, maxBaseModules, caretakers, next },
 *     award(xp, reason, data), spend(xp, reason) -> bool, canAfford(xp), discovery(kind, x, z),
 *     owned(), installed(), pending(), equipped(), equipPending(), buy(id), equip(id), effects(),
 *     designsOwned(), design, buyDesign(id), switchDesign(id, {force}) -> Promise<{ok, reason, drop, eta}>, drop (the delivery under way),
 *     look, setLook(partial), paint, setPaint(partial), where(), open(tab), close(), log()
 *   }
 *   events on the game (game.on): "xp:earned" {xp, reason, total}, "xp:spent" {xp, reason}, "progress:tier" {tier},
 *     "upgrade:bought" {id, group, cost, pending}, "upgrade:installed" {ids}, "design:changed" {from, to},
 *     "custom:changed" {what: "look" | "paint", look | paint}, "workshop:open", "workshop:close"
 *
 * HOW IT ACTS ON THE GAME, without rewriting anyone's internals:
 *   suit   avatar.js SUIT_MODS and eva.js EVA_MODS (getters on SUIT / WALK / EVA read them)
 *   rover  vehicle.modifiers.progress (vehicle.js combines it with the others), vehicle.lampRange (hazards.js),
 *          a share of new array dust shed after hazards.js has settled it (state.weather.panelDust)
 *   design the SAME Vehicle object re-initialised from VEHICLES[id] in place (other systems keep their reference),
 *          a new model from rovermodel.js, the camera rig's numbers
 *
 * WHEN THINGS APPLY. Appearance and paint: at once, anywhere. Suit hardware
 * bought on foot is fitted when you are next in the rover or a base airlock;
 * rover hardware when you are next in the rover or it is parked in a garage;
 * a design is switched from the driver's seat, stopped, anywhere: in a base
 * garage at once, elsewhere by a HALO-1 drop (DROP: a countdown of about a
 * quarter of a minute on the map and the compass, a pod landing beside the
 * rover with dust and a thump, then the swap). The Workshop says which applies.
 *
 * SAVE: state.systems.progress (a new key; SAVE_SCHEMA untouched). The
 * appearance and paint are also kept as the player's PROFILE in
 * localStorage ("geoid.mars_surface.profile"), so they can be edited on the
 * title screen before any save exists, and follow the player between sites.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { registerSystem, getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { VEHICLES, Vehicle } from "./vehicle.js?v=b8cfe8e-efa5b7b7";
import { loadRoverModel } from "./rovermodel.js?v=b8cfe8e-efa5b7b7";
import { SUIT_MODS } from "./avatar.js?v=b8cfe8e-efa5b7b7";
import { EVA_MODS, EVA } from "./eva.js?v=b8cfe8e-efa5b7b7";
import { XP_RULES, tierFor, UPGRADE, UPGRADES, DESIGN, combine, blocker, cleanLook, cleanPaint } from "./progress_data.js?v=b8cfe8e-efa5b7b7";
import { dressAstronaut, dressRover, kitParts } from "./cosmetics.js?v=b8cfe8e-efa5b7b7";
import { Workshop } from "./workshop.js?v=b8cfe8e-efa5b7b7";

const PROFILE_KEY = "geoid.mars_surface.profile";
const SAVE_V = 1;
/** The HALO-1 design drop away from a garage, in REAL seconds (the story's 20 to 30 minute descent is for base supplies). */
export const DROP = { seconds: 15, podFrom_s: 6, podHeight_m: 140, beside_m: 9, hintAfter_s: 5 };
/** progress record vN -> vN+1. Empty: v1 is the first. The step for saves made before this system existed is backPay(). */
const MIGRATIONS = {};
const SUIT_KEYS = ["o2", "power", "scrub", "scrubW", "sprint", "hop", "air", "rad", "dust"];
const EVA_KEYS = ["bag", "core", "scoop", "scan", "range"];
const ROVER_KEYS = ["drive", "speed", "capacity", "solar", "eff", "mu", "muSand", "sink", "crr", "stab", "damp"];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = () => { try { return window.localStorage; } catch { return null; } };

function loadProfile() {
  try { const j = JSON.parse((store() && store().getItem(PROFILE_KEY)) || "null"); return j ? { look: cleanLook(j.look), paint: cleanPaint(j.paint) } : null; }
  catch { return null; }
}
function saveProfile(p) { try { const ls = store(); if (ls) ls.setItem(PROFILE_KEY, JSON.stringify({ look: p.look, paint: p.paint })); } catch { /* private window */ } }

const fresh = () => ({
  v: SAVE_V, xp: 0, xpTotal: 0, spent: 0,
  owned: ["wheel_stock"], installed: ["wheel_stock"], pending: [], equipped: { wheels: "wheel_stock" }, equipPending: null,
  designs: ["rover_crew"], design: "rover_crew",
  credited: { tubes: [], missions: {}, pois: [], scans: [], milestones: [], habitable: false },
  log: [], tier: 0, backPaid: false, hinted: [],
});

/* ── the system ───────────────────────────────────────────────────────────── */

const sys = {
  id: "progress", order: 80,
  game: null, S: fresh(), profile: loadProfile() || { look: cleanLook(null), paint: cleanPaint(null) },
  kit: null, handles: { rover: {}, suit: {} }, workshop: null, arm: null, _acc: 0, _switching: false,

  emitGame(name, d) { if (this.game) this.game.emit(name, d); },
  get ready() { return !!(this.game && this.game.ready); },

  /* ── lifecycle ── */
  async init(game) {
    this.game = game;
    try { this.kit = kitParts(await game.assets.load("rover_upgrade_kit")); } catch (e) { console.warn("[progress] upgrade kit not loaded:", e.message); }
    game.on("eva:deposit", (d) => this._deposit(d));
    game.on("eva:scan", (s) => this._scan(s));
    game.on("mission:complete", (d) => this._mission(d));
    game.on("eva:hop", () => { const av = this._avatar(); if (av && this._fx().hop > 1.3 && this.S.installed.includes("suit_jet")) av.suit.power = Math.max(0, av.suit.power - 0.004 * 3.6e6 * SUIT_MODS.power); });
    game.on("interact", () => this._armStart());
    game.on("mode", () => this._installCheck());
    this._shell();
  },
  load(game, saved) {
    const st = game.state, prev = this.S;
    let S = saved && typeof saved === "object" ? JSON.parse(JSON.stringify(saved)) : null;
    if (S) { for (let v = S.v | 0; v < SAVE_V && MIGRATIONS[v]; v++) S = MIGRATIONS[v](S); S = Object.assign(fresh(), S); S.credited = Object.assign(fresh().credited, S.credited); }
    this.S = S || fresh();
    void prev;
    // the profile is the player's look; a save only seeds it when there is none (another browser, cleared storage)
    if (!loadProfile() && saved && (saved.look || saved.paint)) { this.profile = { look: cleanLook(saved.look), paint: cleanPaint(saved.paint) }; saveProfile(this.profile); }
    const v = game.vehicle;
    if (v && v.def && DESIGN[v.def.id] && this.S.design !== v.def.id) this.S.design = v.def.id;
    if (!this.S.designs.includes(this.S.design)) this.S.designs.push(this.S.design);
    if (!saved) {
      // a save from before this system existed: credit what was already done (missions, tubes, scans, the base)
      const sm = st.systems || {};
      if (sm.missions || sm.eva) this._backPay(sm);
      // a restart while driving another design: back to the crew rover
      if (game.ready && v && v.def.id !== "rover_crew") this.switchDesign("rover_crew", { force: true, silent: true });
    }
    this._applyAll();
    // vehicle.fromJSON clamped the saved charge to the stock pack; give back what a bigger pack held
    if (v && st.vehicle && Number.isFinite(st.vehicle.battery_J)) v.battery = Math.min(v.capacity, Math.max(v.battery, st.vehicle.battery_J));
    this.S.tier = tierFor(this.S.xpTotal).index;
    this._sync();
  },
  save() { const S = this.S; S.look = this.profile.look; S.paint = this.profile.paint; return S; },

  tick(game, dt, ctx) {
    const v = game.vehicle, fx = this._fx();
    // the rover's factors (hotel_W follows the lights: a light bar draws less)
    if (v) {
      const m = v.modifiers.progress || (v.modifiers.progress = {});
      for (const k of ROVER_KEYS) m[k] = fx[k];
      m.hotel_W = v.headlights ? fx.lampW : 0;
      v.lampRange = fx.lampRange;
    }
    // dust filters: shed a share of whatever hazards.js settled on the array this tick
    const W = game.state.weather;
    if (fx.dustCut > 0 && Number.isFinite(W.panelDust) && Number.isFinite(this._dust) && W.panelDust > this._dust) W.panelDust -= (W.panelDust - this._dust) * fx.dustCut;
    this._dust = W.panelDust;
    this._armTick(dt);
    this._dropTick(dt);
    this._dustTick(dt);
    this._hintTick(dt);
    this._acc += dt;
    if (this._acc < 0.5) return;
    this._acc = 0;
    this._installCheck();
    // first visits to the published waypoints, by rover
    if (game.mode === "driving") for (const p of game.site.pois) {
      if (this.S.credited.pois.includes(p.id) || Math.hypot(p.x - v.p.x, p.z - v.p.z) > 30) continue;
      this.S.credited.pois.push(p.id);
      if (p.id !== "landing") this.award(XP_RULES.poi, `first visit: ${p.name}`);
    }
    // the base: the first habitable one, and size milestones
    const b = getSystem("base"), st = b && b.api && b.api.stats ? b.api.stats() : null;
    if (st) {
      if (!this.S.credited.habitable && st.crew_places > 0) { this.S.credited.habitable = true; this.award(XP_RULES.firstHabitable, "a habitable base"); }
      for (const [n, xp] of XP_RULES.milestones) if (st.built >= n && !this.S.credited.milestones.includes(n)) { this.S.credited.milestones.push(n); this.award(xp, `${n} base modules built`); }
    }
  },
  frame(game, dt) {
    const av = this._avatar(), h = this.handles;
    if (h.suit.jet && av) { const on = av.onFoot && !av.grounded && av.vel.y > -0.5; for (const g of h.suit.jet) { g.visible = on; if (on) g.scale.y = 0.8 + 0.4 * Math.random(); } }
    if (h.rover.glow) for (const m of h.rover.glow) m.emissiveIntensity = game.vehicle.headlights ? 6 : 0.25;
    if (h.rover.boom) { const out = this.arm ? Math.min(1, this.arm.t / 0.8) : 0, target = -0.9 * (1 - out); h.rover.boom.rotation.x += (target - h.rover.boom.rotation.x) * Math.min(1, (dt || 0.016) * 4); }   // stowed raised, lowered to the rock while coring
    if (this._chip && this._chip.isConnected) { const t = `${this.S.xp} XP`; if (this._chip.textContent !== t) this._chip.textContent = t; }
  },

  /* ── contribution credit ── */
  award(xp, reason = "contribution", data = null, quiet = false) {
    xp = Math.round(+xp || 0);
    if (xp <= 0) return 0;
    const S = this.S, before = tierFor(S.xpTotal).index;
    S.xp += xp; S.xpTotal += xp;
    const c = this.game && this.game.state && this.game.state.clock;
    S.log.push({ sol: c ? c.sol : 0, xp, reason }); if (S.log.length > 80) S.log.shift();
    const g = this.game;
    if (g && g.hud && !quiet && g.mode !== "title") g.hud.toast(`+${xp} XP<small>Contribution credit: ${esc(reason)}</small>`, 3.5);
    this.emitGame("xp:earned", { xp, reason, total: S.xpTotal, data });
    const t = tierFor(S.xpTotal);
    if (t.index > before) {
      S.tier = t.index;
      if (g && g.hud && !quiet) setTimeout(() => g.hud.toast(`Tier: ${t.name}<small>care-package requests open at once: ${t.maxOpenRequests} · base size: ${t.maxBaseModules} modules</small>`, 5), 3600);
      this.emitGame("progress:tier", { tier: t });
    }
    this._sync();
    return xp;
  },
  spend(xp, reason = "") {
    xp = Math.round(+xp || 0);
    if (xp < 0 || xp > this.S.xp) return false;
    this.S.xp -= xp; this.S.spent += xp;
    this.emitGame("xp:spent", { xp, reason });
    this._sync();
    return true;
  },
  _deposit(d) {
    const t = d && d.tube; if (!t || this.S.credited.tubes.includes(t.id)) return;
    this.S.credited.tubes.push(t.id); if (this.S.credited.tubes.length > 600) this.S.credited.tubes.shift();
    const R = XP_RULES, xp = (t.kind === "core" ? R.core : R.regolith) + (d.depot && !d.depot.beacon ? R.depotBonus : 0);
    this.award(xp, `${t.kind === "core" ? "rock core" : "regolith sample"} laid at ${(d.depot && d.depot.name) || "a cache"}`);
  },
  _scan(s) {
    if (!s) return;
    const R = XP_RULES, C = this.S.credited, near = C.scans.some(([x, z]) => Math.hypot(x - s.x, z - s.z) < R.repeatWithin_m);
    let xp = near ? R.scanRepeat : R.scan + (s.measured ? R.scanMeasured : 0) + ((s.dataSlope || 0) >= R.steepDeg ? R.scanSteep : 0), why = near ? "a repeat scan" : "a scan of new ground";
    if (!near && s.hazard && typeof s.hazard.suitability === "number" && s.hazard.suitability >= R.safeSuitability) { xp += R.safeSite; why = "a scan that found a safe base site (hazard-map heuristic)"; }
    if (!near) { C.scans.push([Math.round(s.x), Math.round(s.z)]); if (C.scans.length > 300) C.scans.shift(); }
    this.award(xp, why);
  },
  _mission(d) {
    if (!d || !d.id || this.S.credited.missions[d.id] != null) return;
    const xp = Math.round((d.materials || 0) * XP_RULES.missionPerMaterial);
    this.S.credited.missions[d.id] = xp;
    if (xp > 0) this.award(xp, "mission complete: " + d.id.replace(/_/g, " "));
  },
  /** Saves made before this system: credit the work already in them, once. */
  _backPay(sm) {
    const S = this.S, R = XP_RULES; let xp = 0;
    for (const [id, d] of Object.entries((sm.missions && sm.missions.done) || {})) { const x = Math.round((d.materials || 0) * R.missionPerMaterial); S.credited.missions[id] = x; xp += x; }
    for (const t of (sm.eva && sm.eva.depot) || []) { S.credited.tubes.push(t.id); xp += t.kind === "core" ? R.core : R.regolith; }
    xp += ((sm.eva && sm.eva.scans) || 0) * R.scan;
    S.backPaid = true;
    if (xp > 0) { this.award(xp, "credited for work done before contribution credit was kept", null, true); this._backPayToast = xp; }
  },
  discovery(kind, x, z) { const xp = XP_RULES.discovery[kind] || 0; return this.award(xp, kind.replace(/_/g, " ") + " discovered", { x, z }); },

  /* ── hardware ── */
  _missionsDone() { const ms = getSystem("missions"); return ms && ms.api ? ms.api.list.filter((m) => m.status === "done").map((m) => m.id) : Object.keys(this.S.credited.missions); },
  _blocker(item) {
    const why = blocker(item, this.S.owned, this._missionsDone());
    if (why && item.mission) { const ms = getSystem("missions"), m = ms && ms.api && ms.api.list.find((x) => x.id === item.mission); if (m) return `Complete the mission “${m.title}”`; }
    return why;
  },
  where() {
    const g = this.game;
    if (!this.ready) return { inRover: false, airlock: false, garage: false, canFitSuit: false, canFitRover: false, canSwitch: false, stopped: false };
    const a = getSystem("avatar"), api = a && a.api, onFoot = !!(api && api.onFoot), inside = api && api.inside;
    const b = getSystem("base"); let dock = null;
    try { dock = b && b.api && b.api.dock ? b.api.dock() : null; } catch { dock = null; }
    const garage = !!(dock && dock.garage), inRover = !onFoot, airlock = !!(onFoot && inside && inside.kind === "airlock");
    const stopped = Math.abs(g.vehicle.t.speed) < 0.6;
    // a design is switched from the driver's seat, stopped: at once in a garage, by a HALO-1 drop anywhere else
    return { inRover, airlock, garage, stopped, canFitSuit: inRover || airlock, canFitRover: inRover || garage, canSwitch: inRover && stopped, instantSwitch: inRover && stopped && garage };
  },
  buy(id) {
    const u = UPGRADE[id], S = this.S;
    if (!u) return { ok: false, reason: "No such hardware" };
    if (!this.ready) return { ok: false, reason: "Start or continue a traverse to buy hardware" };
    if (S.owned.includes(id)) return { ok: false, reason: "Already yours" };
    const why = this._blocker(u); if (why) return { ok: false, reason: why };
    if (!this.spend(u.cost, "hardware: " + u.name)) return { ok: false, reason: `Not enough credit: ${u.cost} XP needed, ${S.xp} to spend` };
    S.owned.push(id);
    if (u.exclusive) S.equipPending = id; else S.pending.push(id);
    this.emitGame("upgrade:bought", { id, group: u.group, cost: u.cost });
    const fitted = this._installCheck();
    const pending = S.pending.includes(id) || S.equipPending === id;
    if (this.game) this.game.save();
    return { ok: true, pending, fitted, where: u.group === "suit" ? "It is fitted when you are next in the rover or a base airlock." : "It is fitted when you are next in the rover, or it is parked in a garage." };
  },
  equip(id) {
    const u = UPGRADE[id]; if (!u || !u.exclusive) return { ok: false, reason: "Not a wheel set" };
    if (!this.S.owned.includes(id)) return { ok: false, reason: "Buy it first" };
    this.S.equipPending = id;
    this._installCheck();
    return { ok: true, pending: this.S.equipPending === id };
  },
  /** Fit whatever is waiting, where it can be fitted. Returns the ids fitted. */
  _installCheck() {
    if (!this.ready) return [];
    const S = this.S, w = this.where(), done = [];
    for (const id of S.pending.slice()) {
      const u = UPGRADE[id];
      if (!u || (u.group === "suit" ? !w.canFitSuit : !w.canFitRover)) continue;
      S.pending.splice(S.pending.indexOf(id), 1); S.installed.push(id); done.push(id);
    }
    if (S.equipPending && w.canFitRover) {
      const id = S.equipPending; S.equipPending = null;
      if (!S.installed.includes(id)) S.installed.push(id);
      if (S.equipped.wheels !== id) { S.equipped.wheels = id; done.push(id); }
    }
    if (done.length) {
      const suit = done.some((id) => UPGRADE[id].group === "suit");
      this._applyAll();
      if (suit) { const av = this._avatar(); if (av) av.refill("workshop"); }        // the suit is recharged with its new hardware
      const g = this.game;
      if (g.hud && g.mode !== "title") g.hud.toast(`Kestrel hardware fitted<small>${done.map((id) => esc(UPGRADE[id].name)).join(", ")}</small>`, 4);
      this.emitGame("upgrade:installed", { ids: done });
      this._sync();
    }
    return done;
  },
  _fx() { return combine(this.S.installed, this.S.equipped); },
  _avatar() { const a = getSystem("avatar"); return a && a.avatar; },
  /** Visual keys of the suit hardware fitted (plus `extra`, for the Workshop's preview of a card). */
  suitVisuals(extra = []) {
    const set = new Set();
    for (const id of [...this.S.installed, ...extra]) { const u = UPGRADE[id]; if (u && u.group === "suit" && u.visual) set.add(u.visual); }
    if (set.has("tank2")) set.delete("tank1");
    if (set.has("sled")) set.delete("caddy");
    return set;
  },
  roverFit(extra = []) {
    const visuals = new Set(); let wheels = null;
    const ids = [...this.S.installed, ...extra];
    for (const id of ids) { const u = UPGRADE[id]; if (u && u.group === "rover" && u.visual && !u.exclusive) visuals.add(u.visual); }
    if (visuals.has("pods2")) visuals.delete("pods1");
    const pickW = extra.find((id) => UPGRADE[id] && UPGRADE[id].exclusive) || this.S.equipped.wheels;
    const wu = UPGRADE[pickW]; if (wu && wu.visual) wheels = wu.visual;
    return { visuals, wheels };
  },
  /** Push the installed hardware and the look onto the game. */
  _applyAll() {
    const fx = this._fx();
    for (const k of SUIT_KEYS) SUIT_MODS[k] = fx[k];
    for (const k of EVA_KEYS) EVA_MODS[k] = fx[k];
    const g = this.game, v = g && g.vehicle;
    if (v) {
      const m = v.modifiers.progress || (v.modifiers.progress = {});
      for (const k of ROVER_KEYS) m[k] = fx[k];
      v.lampRange = fx.lampRange;
      if (typeof v._modifiers === "function") v._modifiers();
    }
    this._dressSuit(); this._dressRover();
  },
  _dressSuit() {
    const av = this._avatar();
    if (av && av.parts && av.body) this.handles.suit = dressAstronaut({ body: av.body, parts: av.parts }, this.profile.look, this.suitVisuals());
  },
  _dressRover() {
    const g = this.game;
    if (g && g.model && g.model.scene) { this.handles.rover = dressRover(g.model, g.vehicle.def.id, this.roverFit(), this.profile.paint, this.kit); if (g.model.setHeadlights) g.model.setHeadlights(g.vehicle.headlights); }
  },

  /* ── designs ── */
  buyDesign(id) {
    const D = DESIGN[id], S = this.S;
    if (!D) return { ok: false, reason: "No such design" };
    if (!this.ready) return { ok: false, reason: "Start or continue a traverse first" };
    if (S.designs.includes(id)) return { ok: false, reason: "Already yours" };
    const why = this._blocker(D); if (why) return { ok: false, reason: why };
    if (!this.spend(D.cost, "design: " + D.name)) return { ok: false, reason: `Not enough credit: ${D.cost} XP needed, ${S.xp} to spend` };
    S.designs.push(id);
    this.emitGame("upgrade:bought", { id, group: "design", cost: D.cost });
    const g = this.game;
    if (g.hud) g.hud.toast(`${esc(D.name)} is yours<small>stop and press ${this._menuKey()} (Workshop → Designs → Switch) to have it dropped to you by HALO-1</small>`, 8);
    g.save();
    return { ok: true };
  },
  /** How to open the menu on the device in use: the pad's Options glyph or the key. */
  _menuKey() {
    const g = this.game, P = window.GeoIDPad;
    return g && g.input && g.input.padConnected && g.input.lastDevice === "pad" && P && P.glyph ? P.glyph("options") : "<kbd>Esc</kbd>";
  },
  /**
   * Make `id` the rover. The Vehicle object stays the same one (thermal, hazards, the base, the HUD and the avatar
   * all hold it): its definition, suspension, wheels and pack are rebuilt from VEHICLES[id], then its model.
   */
  async switchDesign(id, { force = false, silent = false } = {}) {
    const g = this.game, S = this.S, def0 = VEHICLES[id];
    if (!g || !g.ready || !def0) return { ok: false, reason: "Not now" };
    if (!force) {
      if (!S.designs.includes(id)) return { ok: false, reason: "Buy the design first" };
      const w = this.where();
      if (!w.inRover) return { ok: false, reason: "Get in the rover first" };
      if (!w.stopped) return { ok: false, reason: "Stop the rover first" };
      if (g.vehicle.def.id === id) return { ok: true };
      if (!w.garage) return this._dropStart(id);
    }
    return this._swap(id, silent);
  },
  /** The swap itself. The Vehicle object stays the same one (thermal, hazards, the base, the HUD and the avatar hold it). */
  async _swap(id, silent = false) {
    const g = this.game, S = this.S, def0 = VEHICLES[id];
    if (this.drop) this._dropEnd(false);
    if (this._switching) return { ok: false, reason: "Already switching" };
    const v = g.vehicle, from = v.def.id;
    if (from === id) return { ok: true };
    this._switching = true;
    try {
      const def = JSON.parse(JSON.stringify(def0));                    // rovermodel.js adjusts the definition to its model: never the shared table
      const frac = v.battery / v.capacity, fw = new THREE.Vector3(0, 0, -1).applyQuaternion(v.q), yaw = Math.atan2(fw.x, -fw.z);
      const t = new Vehicle(def, g.surface);
      for (const k of ["def", "inertia", "k", "c", "rest", "rideHeight", "wheels", "capacity"]) v[k] = t[k];
      v.steer = 0; v._stuckT = 0; v._tipT = 0; v._acc = 0;
      const model = await loadRoverModel(def, v, "assets/models/");
      if (g.model && g.model.group) g.scene.remove(g.model.group);
      g.model = model; g.scene.add(model.group);
      v.place(v.p.x, v.p.z, yaw);
      v._modifiers();
      v.battery = Math.min(v.capacity, frac * v.capacity); v.flat = false;
      if (g.rig) { g.rig.def = def; g.rig.distance = def.cameras.chase.distance; }
      if (g.wheelfx && Array.isArray(g.wheelfx.wheels)) while (g.wheelfx.wheels.length < v.wheels.length) g.wheelfx.wheels.push({ acc: 0, accSpin: 0, accScrub: 0, accHaze: 0, contact: true, vy: 0 });
      S.design = id; if (!S.designs.includes(id)) S.designs.push(id);
      this._applyAll();
      model.sync(v);
      this.emitGame("design:changed", { from, to: id });
      if (!S.hinted.includes(id)) S.hinted.push(id);
      if (!silent && g.hud) g.hud.toast(`${esc(DESIGN[id].name)} rolled out<small>your Kestrel hardware was refitted to it</small>`, 4);
      g.save();
      return { ok: true };
    } catch (e) {
      console.error("[progress] design switch failed", e);
      return { ok: false, reason: "The switch failed: " + e.message };
    } finally { this._switching = false; }
  },

  /* ── the HALO-1 drop: a design delivered away from a garage ── */
  _dropStart(id) {
    const g = this.game, v = g.vehicle;
    if (this.drop) this._dropEnd(false);
    const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(v.q); rt.y = 0; rt.normalize();
    let x = v.p.x + rt.x * DROP.beside_m, z = v.p.z + rt.z * DROP.beside_m;
    if (g.surface.slopeDeg(x, z, 2) > 20) { x = v.p.x - rt.x * DROP.beside_m; z = v.p.z - rt.z * DROP.beside_m; }
    this.drop = { id, t: DROP.seconds, x, z, at: { x: v.p.x, z: v.p.z }, pod: null, landed: false };
    this._marker();
    g.hud.toast(`HALO-1 drop: ${esc(DESIGN[id].name)} in ${DROP.seconds} s<small>stay stopped; watch the marker on the map and the compass</small>`, 5);
    this.emitGame("halo:drop", { phase: "inbound", design: id, eta_s: DROP.seconds, x, z });
    this._sound("relay");
    return { ok: true, drop: true, eta: DROP.seconds };
  },
  _dropEnd(cancelled, why = "") {
    const d = this.drop, g = this.game; if (!d) return;
    this.drop = null;
    if (Array.isArray(g.extraMarkers)) g.extraMarkers = g.extraMarkers.filter((m) => m.id !== "halo-drop");
    if (cancelled) {
      if (d.pod) { g.scene.remove(d.pod); d.pod = null; }
      g.hud.toast(`HALO-1 drop called off<small>${esc(why || "the rover moved")}: request it again from the Workshop</small>`, 4);
      this.emitGame("halo:drop", { phase: "cancelled", design: d.id });
    } else if (d.pod) { const pod = d.pod; setTimeout(() => g.scene.remove(pod), 40000); }       // the empty pod stays a while
  },
  _marker() {
    const g = this.game, d = this.drop; if (!d) return;
    const list = (g.extraMarkers = (g.extraMarkers || []).filter((m) => m.id !== "halo-drop"));
    list.push({ id: "halo-drop", kind: "objective", x: d.x, z: d.z, name: `HALO-1 drop ${Math.max(0, Math.ceil(d.t))} s`, priority: 4 });
  },
  _sound(name) { try { const a = getSystem("audio"); if (a && a.api && a.snd && typeof a.snd.fx === "function") a.snd.fx(name, "world"); } catch { /* no sound */ } },
  _dropTick(dt) {
    const d = this.drop, g = this.game; if (!d) return;
    const v = g.vehicle;
    if (Math.abs(v.t.speed) > 0.6 || Math.hypot(v.p.x - d.at.x, v.p.z - d.at.z) > 6) { this._dropEnd(true, "the rover moved"); return; }
    d.t -= dt;
    this._marker();
    if (d.t <= DROP.podFrom_s && !d.pod) { d.pod = this._podMesh(); g.scene.add(d.pod); }
    if (d.pod && !d.landed) {
      const k = Math.max(0, d.t / DROP.podFrom_s), gy = g.surface.height(d.x, d.z);
      d.pod.position.set(d.x, gy + DROP.podHeight_m * k * k, d.z);                       // decelerating: height goes with the square of time left
      const glow = d.pod.getObjectByName("pod-retro"); if (glow) { glow.visible = true; glow.scale.y = 0.7 + 0.6 * Math.random(); }
    }
    if (d.t <= 0 && !d.landed) {
      d.landed = true;
      const glow = d.pod && d.pod.getObjectByName("pod-retro"); if (glow) glow.visible = false;
      this._dustRing(d.x, d.z);
      this._sound("impact");
      this.emitGame("halo:drop", { phase: "landed", design: d.id, x: d.x, z: d.z });
      const id = d.id;
      this._dropEnd(false);
      this._swap(id);
    }
  },
  _podMesh() {
    const g = new THREE.Group(); g.name = "halo-pod";
    const shell = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.55, metalness: 0.2 }), dark = new THREE.MeshStandardMaterial({ color: 0x30363d, roughness: 0.5, metalness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xe0641c, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.25, 2.0, 18), shell); body.position.y = 1.35;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.7, 18), shell); cap.position.y = 2.7;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.18, 18), accent); band.position.y = 1.9;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.3, 18), dark); base.position.y = 0.3;
    g.add(body, cap, band, base);
    for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), dark); leg.position.set(Math.cos(a) * 1.25, 0.35, Math.sin(a) * 1.25); leg.rotation.z = 0.35 * Math.cos(a); leg.rotation.x = -0.35 * Math.sin(a); g.add(leg); }
    const retro = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    retro.name = "pod-retro"; retro.rotation.x = Math.PI; retro.position.y = -2; retro.visible = false; g.add(retro);
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return g;
  },
  _dustRing(x, z) {
    const g = this.game, y = g.surface.height(x, z), grp = new THREE.Group(); grp.name = "halo-dust";
    const mat = new THREE.MeshBasicMaterial({ color: 0xb98a63, transparent: true, opacity: 0.55, depthWrite: false });
    const geo = new THREE.SphereGeometry(0.9, 10, 6), puffs = [];
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, m = new THREE.Mesh(geo, mat); m.frustumCulled = false; grp.add(m); puffs.push({ m, a }); }
    g.scene.add(grp);
    this._puffs = { grp, puffs, t: 0, mat, geo, x, y, z };
    this._dustTick(0);
  },
  /** The landing's dust ring: expands, rises a little and fades over 3.5 s. */
  _dustTick(dt) {
    const P = this._puffs; if (!P) return;
    P.t += dt;
    const k = Math.min(1, P.t / 3.5), r = 1.2 + 8 * Math.sqrt(k);
    for (const p of P.puffs) { p.m.position.set(P.x + Math.cos(p.a) * r, P.y + 0.4 + 0.8 * k, P.z + Math.sin(p.a) * r); p.m.scale.setScalar(1 + 3 * k); }
    P.mat.opacity = 0.55 * (1 - k);
    if (k >= 1) { this.game.scene.remove(P.grp); P.geo.dispose(); P.mat.dispose(); this._puffs = null; }
  },
  /** A one-time nudge: a better design is owned, and the rover has been stopped a while. */
  _hintTick(dt) {
    const g = this.game, v = g.vehicle, S = this.S;
    if (g.mode !== "driving" || Math.abs(v.t.speed) > 0.3 || this.drop) { this._still = 0; return; }
    this._still = (this._still || 0) + dt;
    if (this._still < DROP.hintAfter_s) return;
    const cur = DESIGN[v.def.id], better = S.designs.find((id) => id !== v.def.id && !S.hinted.includes(id) && DESIGN[id] && cur && DESIGN[id].cost > cur.cost);
    if (!better) return;
    S.hinted.push(better);
    g.hud.toast(`Your ${esc(DESIGN[better].name)} is waiting on HALO-1<small>press ${this._menuKey()}, then Workshop → Designs → Switch: it is dropped beside you in ${DROP.seconds} s</small>`, 8);
  },

  /* ── appearance ── */
  setLook(part) {
    this.profile.look = cleanLook(Object.assign({}, this.profile.look, part));
    saveProfile(this.profile);
    this._dressSuit();
    this.emitGame("custom:changed", { what: "look", look: this.profile.look });
  },
  setPaint(part) {
    this.profile.paint = cleanPaint(Object.assign({}, this.profile.paint, part));
    saveProfile(this.profile);
    this._dressRover();
    this.emitGame("custom:changed", { what: "paint", paint: this.profile.paint });
  },

  /* ── the sampling arm: core a rock from the cab ── */
  _armRock() {
    const g = this.game, v = g.vehicle, R = g.rocks; if (!R || !R.at) return null;
    const tip = new THREE.Vector3(0, 0, -(v.def.box.length / 2 + 1.2)).applyQuaternion(v.q).add(v.p);
    const eva = getSystem("eva"), cored = eva && eva.eva ? eva.eva.cored : new Set();
    const ci = Math.floor(tip.x / 2), cj = Math.floor(tip.z / 2); let best = null;
    for (let b = cj - 3; b <= cj + 3; b++) for (let a = ci - 3; a <= ci + 3; a++) {
      const k = R.at(a, b); if (!k || k.size < 0.3 || cored.has(a + "_" + b)) continue;
      const d = Math.hypot(k.x - tip.x, k.z - tip.z) - k.size * 0.62;
      if (d < 3.3 && (!best || d < best.d)) best = { key: a + "_" + b, x: k.x, z: k.z, size: k.size, d };
    }
    return best;
  },
  _armStart() {
    const g = this.game, v = g && g.vehicle;
    if (!v || g.mode !== "driving" || this.arm || !this._fx().arm) return false;
    if (Math.abs(v.t.speed) > 0.3) { g.hud.toast("Sampling arm<small>stop first</small>", 2); return false; }
    const eva = getSystem("eva"), E = eva && eva.eva;
    if (!E) return false;
    if (E.bag.length >= EVA.bag) { g.hud.toast(`Sampling arm<small>the sample bag is full (${EVA.bag}): lay tubes at a depot</small>`, 3); return false; }
    const rock = this._armRock();
    if (!rock) { g.hud.toast("Sampling arm<small>no uncored rock within reach of the nose (4.5 m)</small>", 2.5); return false; }
    this.arm = { t: 0, dur: 4.0 * EVA_MODS.core, rock };
    g.hud.toast(`Sampling arm: coring the ${rock.size.toFixed(1)} m rock ahead<small>stay stopped for ${this.arm.dur.toFixed(1)} s</small>`, this.arm.dur);
    return true;
  },
  _armTick(dt) {
    const a = this.arm, g = this.game; if (!a) return;
    if (g.mode !== "driving" || Math.abs(g.vehicle.t.speed) > 0.5) { this.arm = null; g.hud.toast("Sampling arm stowed<small>the rover moved</small>", 2); return; }
    a.t += dt;
    if (a.t < a.dur) return;
    this.arm = null;
    const eva = getSystem("eva"), E = eva && eva.eva;
    if (E) { const tube = E.sample({ kind: "core", rock: a.rock }); if (tube) tube.arm = true; }
  },

  /* ── the shell: the pause-menu entry and the title-screen entry ── */
  _shell() {
    if (typeof document === "undefined") return;
    if (!this.workshop) this.workshop = new Workshop(this);
    const menu = document.getElementById("screen-menu");
    if (menu && !document.getElementById("btn-workshop")) {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.id = "btn-workshop";
      b.innerHTML = `Workshop<span class="ws-chipxp">0 XP</span>`; this._chip = b.querySelector(".ws-chipxp");
      const after = document.getElementById("btn-base") || document.getElementById("btn-resume");
      if (after) after.after(b); else (menu.querySelector(".col") || menu).appendChild(b);
      b.addEventListener("click", () => { if (this.game && this.game.mode === "menu") this.workshop.open(null, "menu"); });
    }
    if (this.game) this.game.on("mode", (m) => { if (m !== "menu" && this.workshop && this.workshop.open_ && this.workshop.origin === "menu") this.workshop.close(); });
    if (this.game) this.game.on("mode", (m) => { if (m === "driving" && this._backPayToast) { const n = this._backPayToast; this._backPayToast = 0; setTimeout(() => this.game.hud.toast(`+${n} XP<small>contribution credit for the work already in this save</small>`, 5), 1500); } });
  },
  _sync() { if (this.workshop && this.workshop.open_) this.workshop.render(); },
};

/** The API other systems use (the story system's award(), HALO-1's spend() and limits()). */
sys.api = {
  get ready() { return sys.ready; },
  get xp() { return sys.S.xp; },
  get xpTotal() { return sys.S.xpTotal; },
  limits: () => { const t = tierFor(sys.S.xpTotal); return { name: t.name, index: t.index, maxOpenRequests: t.maxOpenRequests, maxBaseModules: t.maxBaseModules, caretakers: t.caretakers, next: t.next ? { xp: t.next.xp, name: t.next.name } : null, xpTotal: sys.S.xpTotal }; },
  award: (xp, reason, data) => sys.award(xp, reason, data),
  spend: (xp, reason) => sys.spend(xp, reason),
  canAfford: (xp) => sys.S.xp >= xp,
  discovery: (kind, x, z) => sys.discovery(kind, x, z),
  owned: () => sys.S.owned.slice(), installed: () => sys.S.installed.slice(), pending: () => sys.S.pending.slice(),
  equipped: () => Object.assign({}, sys.S.equipped), equipPending: () => sys.S.equipPending,
  buy: (id) => sys.buy(id), equip: (id) => sys.equip(id), install: () => sys._installCheck(),
  effects: () => sys._fx(), blocker: (item) => sys._blocker(item), missionsDone: () => sys._missionsDone(),
  suitVisuals: (extra) => sys.suitVisuals(extra), roverFit: (extra) => sys.roverFit(extra),
  designsOwned: () => sys.S.designs.slice(), get design() { return sys.S.design; },
  get drop() { const d = sys.drop; return d ? { design: d.id, eta_s: Math.max(0, d.t), x: d.x, z: d.z } : null; },
  buyDesign: (id) => sys.buyDesign(id), switchDesign: (id, o) => sys.switchDesign(id, o),
  get look() { return sys.profile.look; }, setLook: (p) => sys.setLook(p),
  get paint() { return sys.profile.paint; }, setPaint: (p) => sys.setPaint(p),
  where: () => sys.where(),
  open: (tab, origin) => { if (!sys.workshop) sys._shell(); sys.workshop.open(tab, origin || "menu"); },
  close: () => sys.workshop && sys.workshop.close(),
  log: () => sys.S.log.slice(),
  get upgrades() { return UPGRADES; },
};

registerSystem(sys);

/* The title screen: the Workshop (appearance and paint) before any traverse starts. Added once the shell has drawn it. */
if (typeof document !== "undefined") {
  const addTitle = () => {
    // the story title (title.js): "Your pioneer", above Settings
    const st = document.getElementById("st-settings");
    if (st && !document.getElementById("st-workshop")) {
      const p = document.createElement("button"); p.type = "button"; p.className = "btn quiet"; p.id = "st-workshop"; p.textContent = "Your pioneer";
      st.before(p);
      p.addEventListener("click", () => { if (!sys.workshop) sys._shell(); sys.workshop.open("appearance", "title"); });
    }
    if (document.getElementById("btn-title-workshop")) return;
    const anchor = document.getElementById("btn-controls"), title = document.getElementById("screen-title");
    if (!title) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.id = "btn-title-workshop"; b.textContent = "Workshop";
    if (anchor) anchor.before(b); else (title.querySelector(".row") || title).appendChild(b);
    b.addEventListener("click", () => { if (!sys.workshop) sys._shell(); sys.workshop.open("appearance", "title"); });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addTitle); else addTitle();
}
