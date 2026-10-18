/**
 * EVA: leaving and entering the rover and base airlocks, and what the
 * astronaut can do outside: core a rock, scoop regolith, lay sample tubes at
 * a depot, plant a flag or a beacon, scan the ground, read the map.
 *
 * System "eva" (order 62; needs "avatar"). It owns the things an EVA leaves
 * behind (flags, beacons, tubes: placement-layer entities registered through
 * entities.js's public registerType, saved with THIS system so they never
 * block a base module's footprint), the sample bag, and the on-foot prompts.
 *
 *   getSystem("eva").api = { bag, depot, flags, beacons, scans, cored,
 *     exitRover(), enterRover(), sample(), deposit(), plant("flag" | "beacon"), scan(), target(), depots() }
 *
 * Events on the game (game.on): "eva:exit", "eva:enter", "eva:sample",
 * "eva:deposit", "eva:plant", "eva:scan", "eva:emergency", "eva:recovered".
 *
 * WHICH BUTTON LEAVES THE ROVER: hold L1 + R1 together (keyboard: hold E)
 * for 0.6 s while stopped. Every single button of the driving map is taken
 * (hold Cross is the base builder's "build mode", and Square, Circle and
 * Triangle all act on the press, so a hold on them would fire that first);
 * the two shoulder buttons are both hold-modifiers (low range, handbrake)
 * that mean nothing together at a standstill, so the chord has no side
 * effect, and the ring makes it deliberate. On foot, Cross is the hop and
 * the hold-to-use button is R1 alone (keyboard: E).
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { registerSystem, getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { registerType } from "./entities.js?v=6d37c9c-9b39e129";
import { PROV } from "./heightfield.js?v=6d37c9c-9b39e129";
import { clockText } from "./state.js?v=6d37c9c-9b39e129";
import { ONFOOT_KEYS, ONFOOT_HELP, WALK } from "./avatar.js?v=6d37c9c-9b39e129";

/** Suit tools and carry upgrades (game/progress.js): extra bag slots and time / range factors, read by the getters in EVA (0 / 1 = stock). */
export const EVA_MODS = { bag: 0, core: 1, scoop: 1, scan: 1, range: 1 };
export const EVA = { get bag() { return 6 + (EVA_MODS.bag | 0); }, flags: 40, beacons: 12, reach: 1.5, hatch: 2.6, tubeSpacing: 2, exitHold: 0.6, exitSpeed: 0.5,
  hold: { hatch: 0.6, airlock: 0.8, get core() { return 3.2 * EVA_MODS.core; }, get scoop() { return 2.0 * EVA_MODS.scoop; }, deposit: 1.0 },
  get scan_s() { return 1.3 * EVA_MODS.scan; }, beaconCache: 12 };

const kitOr = (id, make) => async (def, ctx) => (await ctx.assets.load(id)) || make();
const std = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.2 }, o));
registerType("eva_flag", { kind: "marker", persist: false, footprint: 0.1, walkThrough: true,
  create: kitOr("flag_marker", () => { const g = new THREE.Group(), pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 6), std(0x9aa0a8));
    pole.position.y = 0.8; const f = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), std(0xd9480f, { side: THREE.DoubleSide })); f.position.set(0.21, 1.45, 0); g.add(pole, f); return g; }) });
registerType("eva_beacon", { kind: "marker", persist: false, footprint: 0.3, walkThrough: true,
  create: async (def, ctx) => {
    const g = new THREE.Group(), kit = await ctx.assets.load("beacon");
    if (kit) g.add(kit); else { const m = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.4, 3), std(0xb8b4a8)); m.position.y = 0.7; g.add(m); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3a1a }));
    lamp.position.y = 1.5; g.add(lamp); g.userData.lamp = lamp;
    return g;
  } });
registerType("eva_tube", { kind: "marker", persist: false, footprint: 0.1, walkThrough: true,
  create: kitOr("sample_tube", () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 8), std(0xd9dde2, { metalness: 0.7 })); m.rotation.x = Math.PI / 2; m.position.y = 0.012; const g = new THREE.Group(); g.add(m); return g; }) });

const $ = (id) => document.getElementById(id);
const fmtM = (m) => m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km";
const pct = (v) => Math.round(v * 100) + "%";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const R = 2 * Math.PI * 19;

class Eva {
  constructor(game, av) {
    this.game = game; this.av = av;
    this.bag = []; this.depot = []; this.flags = []; this.beacons = []; this.cored = new Set(); this.scans = 0; this.lastScan = null;
    this.hold = { t: 0, key: null, held: false, pad: false, touch: false, show: 0 };
    this.exitHold = { t: 0, pad: false };
    this.busy = null;                 // {kind: "scan" | "place", t, dur, done}
    this.mapOn = false; this.n = 0;
    this._ui();
  }

  /* ── DOM: prompt + ring, scan card, map, fade, touch ─────────────────── */
  _ui() {
    const hud = this.game.hud, mk = (cls, html = "") => { const d = document.createElement("div"); d.className = cls; d.hidden = true; d.innerHTML = html; return d; };
    this.prompt = mk("eva-prompt", `<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="bg" cx="22" cy="22" r="19"/><circle class="fg" cx="22" cy="22" r="19" stroke-dasharray="${R.toFixed(1)}" stroke-dashoffset="${R.toFixed(1)}"/></svg><span class="eva-key"></span><span class="eva-text"></span>`);
    this.card = mk("eva-scan hud-card");
    this.map = mk("eva-map panel", `<div class="eyebrow">Map <span class="eva-map-scale"></span></div><canvas width="300" height="300"></canvas><div class="mini eva-map-legend"><span><i class="k-you"></i>You</span><span><i class="k-rover"></i>Rover</span><span><i class="k-poi"></i>Site</span><span><i class="k-flag"></i>Flag</span><span><i class="k-safe"></i>Safe return</span></div>`);
    this.bagEl = mk("eva-bag");
    this.fade = mk("eva-fade"); this.fade.hidden = false;
    for (const [id, el, slot] of [["eva-prompt", this.prompt, "prompt"], ["eva-scan", this.card, "right-low"], ["eva-map", this.map, "right-low"], ["eva-bag", this.bagEl, "left"]]) { if (hud.addPanel) hud.addPanel(id, el, slot); else hud.root.appendChild(el); }
    // what the interface manager does with them (uiman.js): the prompt is gated where it is decided (_prompt), the scan card
    // and the map are shown while open, the sample count when it changes or when there is something to do with it
    const ui = hud.ui;
    if (ui) {
      ui.register("eva-prompt", { el: this.prompt, group: "prompts", policy: "always" });
      ui.register("eva-scan", { el: this.card, group: "data", policy: "always" });
      ui.register("eva-map", { el: this.map, group: "navigation", policy: "always" });
      ui.register("eva-bag", { el: this.bagEl, group: "mission", policy: "contextual", lean: "contextual", hold: 3,
        when: () => { const t = this._target; return !!(t && (t.kind === "core" || t.kind === "scoop" || t.kind === "deposit")); } });
    }
    this.fade.setAttribute("data-pad-skip", ""); document.body.appendChild(this.fade);
    // touch: a stick and buttons, shown on coarse pointers while on foot
    const t = document.createElement("div"); t.id = "eva-touch"; t.hidden = true; t.setAttribute("data-pad-skip", "");
    t.innerHTML = `<div class="eva-stick"><i></i></div><div class="eva-tmid">${[["camera", "CAM"], ["light", "LGT"], ["scan", "SCAN"], ["flag", "FLAG"], ["map", "MAP"], ["menu", "MENU"]].map(([a, l]) => `<button type="button" class="tbtn sm" data-eva="${a}">${l}</button>`).join("")}</div>
      <div class="eva-tright"><button type="button" class="tbtn" data-eva="run">RUN</button><button type="button" class="tbtn" data-eva="use">USE</button><button type="button" class="tbtn" data-eva="jump">HOP</button></div>`;
    document.body.appendChild(t); this.touchEl = t;
    const stick = t.querySelector(".eva-stick"), nub = stick.firstChild, av = this.av; av.touch = { x: 0, y: 0, run: false };
    let sid = null;
    const move = (e) => { const r = stick.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1, m = Math.max(1, Math.hypot(x, y)); av.touch.x = x / m; av.touch.y = y / m; nub.style.transform = `translate(${av.touch.x * 30}px, ${av.touch.y * 30}px)`; };
    stick.addEventListener("pointerdown", (e) => { sid = e.pointerId; stick.setPointerCapture?.(sid); move(e); this.game.input.lastDevice = "touch"; e.preventDefault(); });
    stick.addEventListener("pointermove", (e) => { if (e.pointerId === sid) move(e); });
    const up = (e) => { if (e.pointerId === sid) { sid = null; av.touch.x = av.touch.y = 0; nub.style.transform = ""; } };
    stick.addEventListener("pointerup", up); stick.addEventListener("pointercancel", up);
    t.querySelectorAll("[data-eva]").forEach((b) => {
      const a = b.dataset.eva;
      if (a === "use") { b.addEventListener("pointerdown", (e) => { this.hold.touch = true; e.preventDefault(); }); for (const n of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(n, () => { this.hold.touch = false; }); }
      else b.addEventListener("click", (e) => { e.preventDefault(); this.action(a); if (a === "run") b.classList.toggle("is-down", av.touch.run); });
    });
    // a way out of the rover for touch: one more small button in the foundation's column
    const mid = document.querySelector("#touch .t-mid");
    if (mid) { const b = document.createElement("button"); b.type = "button"; b.className = "tbtn sm"; b.textContent = "EVA"; b.setAttribute("aria-label", "Leave the rover"); b.addEventListener("click", (e) => { e.preventDefault(); this.exitRover(); }); mid.insertBefore(b, mid.lastElementChild); }
    // the game's Controls screen: add the on-foot lists under the driving ones
    const hk = $("help-keys"), hp = $("help-pad"), P = window.GeoIDPad;
    if (hk && !hk.dataset.eva) { hk.dataset.eva = "1"; hk.insertAdjacentHTML("beforeend", `<dt class="keys-h">On foot</dt><dd></dd>` + ONFOOT_KEYS.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")); }
    if (hp && !hp.dataset.eva) { hp.dataset.eva = "1"; hp.insertAdjacentHTML("beforeend", `<dt class="keys-h">On foot</dt><dd></dd>` + ONFOOT_HELP.filter((e) => e.control && !e.unused).map((e) => `<dt>${P ? e.control.split(/\s+/).map((c) => P.glyph(c)).join(" ") : e.control}</dt><dd>${e.text}</dd>`).join("")); }
  }
  flash() { const f = this.fade; f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
  key(pad, keys) { const g = this.game, P = window.GeoIDPad; return g.input.padConnected && g.input.lastDevice === "pad" && P ? pad.split(" ").map((b) => P.glyph(b)).join(" ") : `<kbd>${keys}</kbd>`; }

  /* ── leaving and entering ────────────────────────────────────────────── */
  canExit() { const g = this.game, v = g.vehicle; return g.mode === "driving" && !g.paused && !this.av.onFoot && Math.abs(v.t.speed) < EVA.exitSpeed && !v.t.airborne; }
  exitRover() {
    const g = this.game;
    if (g.mode !== "driving" || this.av.onFoot) return false;
    if (Math.abs(g.vehicle.t.speed) >= EVA.exitSpeed) { g.hud.toast("Stop the rover first", 2); return false; }
    this.flash();
    const ok = this.av.exitVehicle();
    if (ok && g.hud.ui) g.hud.ui.used("eva.exit");
    if (ok) { g.save(); if (this.av.stats.evas <= 1) g.hud.toast(`On foot<small>${this.key("r1", "E")} hold near the rover's rear hatch to get back in. The oxygen ring (bottom right) shows what you have left.</small>`, 7); }
    return ok;
  }
  enterRover() {
    if (!this.av.onFoot) return false;
    this.flash();
    const walked = this.av.evaWalked;
    this.av.enterVehicle();
    this.game.hud.toast(`Back in the rover<small>suit recharged from the rover; ${fmtM(walked)} walked</small>`, 3.5);
    this.game.save();
    return true;
  }
  hatch() { const v = this.game.vehicle; return new THREE.Vector3(0, 0, v.def.box.length / 2 + 0.4).applyQuaternion(v.q).add(v.p); }

  /* ── what "use" would do here ────────────────────────────────────────── */
  depots() {
    const g = this.game, out = [], ms = getSystem("missions");
    try { for (const d of (ms && ms.api && ms.api.depots && ms.api.depots()) || []) out.push(d); } catch { /* missions not ready */ }
    if (!out.length) for (const p of g.site.pois) if (/depot|cache/i.test(p.name)) out.push({ id: p.id, name: p.name, x: p.x, z: p.z, r: 30 });
    for (const b of this.beacons) out.push({ id: b.id, name: "Beacon cache", x: b.x, z: b.z, r: EVA.beaconCache, beacon: true });
    return out;
  }
  nearRock(reach = EVA.reach) {                    // reach: a longer one for the scanner (EVA_MODS.range)
    const g = this.game, av = this.av, Rk = g.rocks; if (!Rk || !Rk.at) return null;
    const ci = Math.floor(av.p.x / 2), cj = Math.floor(av.p.z / 2), n = 2 + Math.ceil(Math.max(0, reach - EVA.reach) / 2);
    let best = null;
    for (let b = cj - n; b <= cj + n; b++) for (let a = ci - n; a <= ci + n; a++) {
      const k = Rk.at(a, b); if (!k || k.size < 0.3) continue;
      const d = Math.hypot(k.x - av.p.x, k.z - av.p.z) - k.size * 0.62;
      if (d < reach && (!best || d < best.d)) best = { key: a + "_" + b, x: k.x, z: k.z, size: k.size, d };
    }
    return best;
  }
  target() {
    const g = this.game, av = this.av;
    if (!av.onFoot) return null;
    if (av.inside) return { kind: "leave", text: "Leave the airlock", hold: EVA.hold.airlock };
    const h = this.hatch(), dh = Math.hypot(h.x - av.p.x, h.z - av.p.z);
    if (dh < EVA.hatch) return { kind: "hatch", text: "Enter the rover (recharges the suit)", hold: EVA.hold.hatch };
    const ref = av.refuge();
    if (ref.kind === "airlock" && ref.d < 2.6) return { kind: "airlock", text: "Enter the airlock (ends the EVA)", hold: EVA.hold.airlock, ref };
    const rock = this.nearRock();
    if (rock) {
      const inDepot = this.bag.length && this.depots().some((d) => Math.hypot(d.x - av.p.x, d.z - av.p.z) < d.r);
      if (this.cored.has(rock.key) && !inDepot) return { kind: "none", text: "This rock has been cored already", hold: 0 };
      if (this.bag.length >= EVA.bag && !inDepot) return { kind: "none", text: `Sample bag full (${EVA.bag}): lay tubes at a depot or a beacon`, hold: 0 };
      if (!this.cored.has(rock.key) && this.bag.length < EVA.bag) return { kind: "core", text: `Core this rock (${rock.size.toFixed(1)} m)`, hold: EVA.hold.core, rock };
    }
    if (this.bag.length) {
      const dep = this.depots().find((d) => Math.hypot(d.x - av.p.x, d.z - av.p.z) < d.r);
      if (dep) {
        const close = this.depot.some((t) => Math.hypot(t.x - av.p.x, t.z - av.p.z) < EVA.tubeSpacing);
        return close ? { kind: "none", text: `Too close to another tube: step ${EVA.tubeSpacing} m away`, hold: 0 } : { kind: "deposit", text: `Lay a sample tube at ${dep.beacon ? "this cache" : "the depot"} (${this.bag.length} carried)`, hold: EVA.hold.deposit, dep };
      }
    }
    const ms = getSystem("missions");
    let wants = false; try { wants = !!(ms && ms.api && ms.api.wants && ms.api.wants("sample", av.p.x, av.p.z)); } catch { wants = false; }
    if (wants && this.bag.length < EVA.bag) return { kind: "scoop", text: "Scoop a regolith sample (no rock within reach)", hold: EVA.hold.scoop };
    return null;
  }

  /* ── actions ─────────────────────────────────────────────────────────── */
  _tube(kind, rock) {
    const g = this.game, av = this.av, x = rock ? rock.x : av.p.x, z = rock ? rock.z : av.p.z, ll = g.site.toLonLat(x, z), d = g.surface.describe(x, z);
    return { id: "S" + (++this.n) + "-" + g.state.clock.sol, kind, x, z, lat: ll.lat, lon: ll.lon, elevation_m: g.site.elevation(g.surface.measured(x, z)),
      sol: g.state.clock.sol, time: clockText(g.state.clock), rock_m: rock ? +rock.size.toFixed(2) : null, terrain: d.height, measured: d.prov.cat !== PROV.none };
  }
  sample(t = this.target()) {
    if (!t || (t.kind !== "core" && t.kind !== "scoop")) return null;
    const tube = this._tube(t.kind === "core" ? "core" : "regolith", t.rock);
    if (t.rock) this.cored.add(t.rock.key);
    this.bag.push(tube);
    this.game.hud.toast(`${t.kind === "core" ? "Rock core" : "Regolith sample"} sealed: ${tube.id}<small>${this.bag.length} of ${EVA.bag} tubes carried. The rock is generated; the ground it sits on is ${tube.terrain}.</small>`, 5);
    this.game.emit("eva:sample", { tube, bag: this.bag.length });
    this.game.save();
    return tube;
  }
  async deposit(t = this.target()) {
    if (!t || t.kind !== "deposit" || !this.bag.length) return null;
    const g = this.game, av = this.av, tube = this.bag.shift();
    const x = av.p.x + Math.sin(av.yaw) * 0.6, z = av.p.z - Math.cos(av.yaw) * 0.6;
    const rec = Object.assign({}, tube, { x, z, yaw: av.yaw + 1.2, depot: t.dep.id, placedSol: g.state.clock.sol });
    this.depot.push(rec);
    g.hud.toast(`Tube ${tube.id} laid at ${esc(t.dep.name)}<small>${this.depot.length} on the ground, ${this.bag.length} still carried</small>`, 4);
    g.emit("eva:deposit", { tube: rec, depot: t.dep, count: this.depot.filter((d) => d.depot === t.dep.id).length });
    g.save();
    await this._add("eva_tube", rec);          // the model may still be loading: the record, the event and the save do not wait for it
    return rec;
  }
  async plant(what = "flag") {
    const g = this.game, av = this.av;
    if (!av.onFoot || av.inside || this.busy) return null;
    const list = what === "beacon" ? this.beacons : this.flags, max = what === "beacon" ? EVA.beacons : EVA.flags;
    const x = av.p.x + Math.sin(av.yaw) * 0.8, z = av.p.z - Math.cos(av.yaw) * 0.8;
    if (g.surface.slopeDeg(x, z, 0.8) > 35) { g.hud.toast("Too steep to plant anything here", 2); return null; }
    while (list.length >= max) { const old = list.shift(); g.entities.remove(old.id); }
    const ll = g.site.toLonLat(x, z);
    const rec = { id: (what === "beacon" ? "beacon-" : "flag-") + (++this.n) + "-" + Math.random().toString(36).slice(2, 6), x, z, yaw: av.yaw, sol: g.state.clock.sol, lat: ll.lat, lon: ll.lon };
    list.push(rec);
    this.busy = { kind: "place", t: 0, dur: 0.7 };
    g.hud.toast(what === "beacon" ? `Beacon placed<small>it shows on the map, and tubes can be cached within ${EVA.beaconCache} m of it</small>` : `Flag planted<small>${ll.lat.toFixed(5)}°, ${ll.lon.toFixed(5)}° E</small>`, 3);
    g.emit("eva:plant", { what, x, z, id: rec.id, count: list.length });
    g.save();
    await this._add(what === "beacon" ? "eva_beacon" : "eva_flag", rec);
    return rec;
  }
  _add(type, rec) { return this.game.entities.add({ type, id: rec.id, x: rec.x, z: rec.z, yaw: rec.yaw || 0, data: {} }).catch((e) => console.warn("[eva] could not place", type, e.message)); }

  /** What the data says about the ground (or the rock) 1.5 m ahead. */
  scanAt() {
    const g = this.game, av = this.av, S = g.surface, ahead = 1.5 * EVA_MODS.range, rock = this.nearRock(EVA.reach * EVA_MODS.range);
    const x = rock ? rock.x : av.p.x + Math.sin(av.yaw) * ahead, z = rock ? rock.z : av.p.z - Math.cos(av.yaw) * ahead;
    const d = S.describe(x, z), reg = Object.assign({}, S.regolith(x, z)), ll = g.site.toLonLat(x, z);
    const gr = g.field.gradient(x, z, 8), dataSlope = Math.atan(Math.hypot(gr.dx, gr.dz)) * 180 / Math.PI;
    let hazard = null;
    try { const hm = g.env && g.env.hazardMap; if (hm && hm.sample) hazard = hm.sample(x, z); } catch { hazard = null; }
    return { x, z, lat: ll.lat, lon: ll.lon, elevation_m: g.site.elevation(S.measured(x, z)), terrain: d.height, image: d.image, detail: d.detail, prov: d.prov.cat, mpp: d.prov.mpp,
      measured: d.prov.cat === PROV.hirise || d.prov.cat === PROV.ctx, slope: S.slopeDeg(x, z, 1.5), dataSlope, sand: reg.sand, rock: reg.rock, rough: reg.rough,
      limit: av.maxSlope(reg.sand), target: rock ? { size: rock.size, key: rock.key, cored: this.cored.has(rock.key) } : null, hazard, sol: g.state.clock.sol };
  }
  scan() {
    const av = this.av;
    if (!av.onFoot || av.inside || this.busy || av.pose) return false;
    const s = this.scanAt();
    av.reticle.position.set(s.x, this.game.surface.height(s.x, s.z) + 0.06 + (s.target ? s.target.size * 0.5 : 0), s.z);
    av.yaw = Math.atan2(s.x - av.p.x, -(s.z - av.p.z));
    this.busy = { kind: "scan", t: 0, dur: EVA.scan_s, result: s };
    return true;
  }
  _scanDone(s) {
    const cls = s.prov === PROV.hirise ? "hirise" : s.prov === PROV.ctx ? "ctx" : s.prov === PROV.interpolated ? "interp" : "none";
    const row = (k, v, tag = "", c = "") => `<div class="eva-row"><span>${k}</span><b>${v}</b>${tag ? `<em class="${c}">${tag}</em>` : ""}</div>`;
    const hz = s.hazard == null ? "" : row("Hazard", typeof s.hazard === "object" ? esc(Object.entries(s.hazard).filter(([, v]) => typeof v !== "object").slice(0, 3).map(([k, v]) => k + " " + (typeof v === "number" ? v.toFixed(2) : v)).join(", ")) : esc(s.hazard), "weather", "t-int");
    this.card.innerHTML = `<div class="eyebrow">Scan ${this.scans + 1} &middot; ${s.target ? "rock" : "ground"} ahead</div>
      <div class="coords"><b>${Math.abs(s.lat).toFixed(5)}&deg; ${s.lat >= 0 ? "N" : "S"}  ${s.lon.toFixed(5)}&deg; E</b><span>elevation ${s.elevation_m.toFixed(1)} m (areoid)</span></div>
      <div class="prov"><i class="${cls}"></i><span>Terrain: ${esc(s.terrain)}</span></div>
      <div class="prov"><i class="dot-img"></i><span>Picture: ${esc(s.image)} (tint is not data)</span></div>
      <div class="prov"><i class="dot-proc"></i><span>${esc(s.detail)}</span></div>
      ${row("Slope here", s.slope.toFixed(0) + "&deg;", "as drawn", "t-gen")}${row("Slope in the data", s.dataSlope.toFixed(0) + "&deg; over 16 m", s.measured ? "measured" : "interpolated", s.measured ? "t-meas" : "t-int")}
      ${row("Regolith", `sand ${pct(s.sand)} &middot; rock ${pct(s.rock)}`, "heuristic", "t-gen")}${row("Walkable to", s.limit.toFixed(0) + "&deg;", s.slope > s.limit ? "too steep" : "ok", s.slope > s.limit ? "t-bad" : "t-meas")}
      ${s.target ? row("Rock", s.target.size.toFixed(1) + " m" + (s.target.cored ? ", cored" : ""), "generated", "t-gen") : ""}${hz}`;
    this._fade(this.card, true); this.cardUntil = performance.now() + 12000;
    this.scans++; this.lastScan = s;
    this.game.emit("eva:scan", s);
  }

  action(a) {
    const g = this.game, av = this.av;
    if (a === "menu") { if (g.mode === "onfoot") { g.pause(true); g.emit("padmenu"); } return; }
    if (g.mode !== "onfoot" || g.paused) return;
    // a scan asked for mid-action (planting, another scan) runs as soon as that action ends, rather than being dropped
    if (a === "scan") { if (!this.scan() && (this.busy || av.pose)) this._queued = "scan"; }
    else if (a === "flag" || a === "beacon") this.plant(a);
    else if (a === "map") this.toggleMap();
    else if (a === "objective") g.announceObjective();
    else if (a === "run") av.touch.run = !av.touch.run;
    else { const sys = getSystem("avatar"); if (sys && sys.act && sys.act[a]) sys.act[a](); }
  }
  toggleMap(on = !this.mapOn) { this.mapOn = on; this.map.hidden = !on; this._mapAt = null; }

  /* ── per frame ───────────────────────────────────────────────────────── */
  frame(dt) {
    const g = this.game, av = this.av, k = g.input.keys, P = window.GeoIDPad, now = performance.now();
    const padOn = P && P.connected && g.padMode === "flight";
    // driving: hold Cross / E while stopped to step outside
    if (g.mode === "driving" && !g.paused) {
      const chord = padOn && P.pressed("l1") && P.pressed("r1"), held = !!k.KeyE || chord;
      const eh = this.exitHold;
      if (held && this.canExit()) { eh.t += dt; if (eh.t >= EVA.exitHold) { eh.t = 0; eh.block = true; this.exitRover(); } }
      else { if (!held) eh.block = false; eh.t = 0; }
      const stopped = this.canExit();
      this._still = stopped ? (this._still || 0) + dt : 0;
      // only while it is possible (stopped a moment), and once learned only for the first seconds; always while the hold runs
      const offer = g.hud.ui ? g.hud.ui.gate("eva.exit", this._still > 1.5) : this._still > 2.5;
      this._prompt(eh.t > 0.12 || offer ? { text: "Step outside", key: this.key("l1 r1", "E"), k: eh.t / EVA.exitHold } : null);
      this.card.hidden = true; if (this.mapOn) this.toggleMap(false);
      this.bagEl.hidden = true; this.touchEl.hidden = true;
      return;
    }
    if (g.mode !== "onfoot" && !(g.mode === "menu" && av.onFoot)) { this._prompt(null); this.bagEl.hidden = true; this.touchEl.hidden = true; return; }
    const live = g.mode === "onfoot" && !g.paused;
    const ts = g.settings.touch, coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    this.touchEl.hidden = !(live && (ts === "on" || (ts === "auto" && coarse)));
    // a scan or a planting in progress
    if (this.busy && live) {
      const b = this.busy; b.t += dt;
      av.pose = { kind: b.kind, k: b.t / b.dur };
      if (b.kind === "scan") { av.reticle.visible = true; const s = 1 + 0.5 * Math.sin(b.t * 9); av.reticle.scale.setScalar((b.result.target ? b.result.target.size : 0.8) * s); }
      if (b.t >= b.dur) {
        this.busy = null; av.pose = null; av.reticle.visible = false; if (b.kind === "scan") this._scanDone(b.result);
        if (this._queued === "scan") { this._queued = null; this.scan(); }
      }
    }
    // hold-to-use
    const t = live && !this.busy ? this.target() : null, h = this.hold;
    this._target = t;
    const held = live && (!!k.KeyE || (padOn && P.pressed("r1")) || h.touch);
    if (!held) h.block = false;
    if (t && t.hold > 0 && held && !h.block) {
      if (h.key !== t.kind) { h.key = t.kind; h.t = 0; }
      h.t += dt;
      if (t.kind === "core" || t.kind === "scoop") { av.pose = { kind: "drill", k: h.t / t.hold }; if (t.rock) av.yaw = Math.atan2(t.rock.x - av.p.x, -(t.rock.z - av.p.z)); av.vel.set(0, 0, 0); }
      else if (t.kind === "deposit") { av.pose = { kind: "place", k: h.t / t.hold }; av.vel.set(0, 0, 0); }
      if (h.t >= t.hold) { h.t = 0; h.key = null; h.block = true; av.pose = null; this._do(t); }
    } else if (!this.busy) { if (h.t > 0 && av.pose) av.pose = null; h.t = 0; h.key = null; }
    // a prompt only for an action that is available here; a note with nothing to do ("cored already") just flashes up
    const ui = g.hud.ui, gateKey = t ? (t.kind === "none" ? "eva.note:" + t.text : "eva." + t.kind) : "eva.none";
    const offer = !t || h.t > 0 || !ui ? !!t : ui.gate(gateKey, true, t.kind === "none" ? { linger: 3, brief: true } : undefined);
    if (ui && this._gk && this._gk !== gateKey) ui.gate(this._gk, false);
    this._gk = t ? gateKey : null;
    this._prompt(t && offer ? { text: t.text, key: t.hold > 0 ? this.key("r1", "E") : "", k: t.hold > 0 ? h.t / t.hold : 0, none: t.kind === "none", working: h.t > 0 ? (t.kind === "core" ? "Coring" : t.kind === "scoop" ? "Scooping" : null) : null } : null);
    if (this.cardUntil && now > this.cardUntil) { this._fade(this.card, false); this.cardUntil = 0; }
    this.bagEl.hidden = false;
    const bag = `Samples <b>${this.bag.length} / ${EVA.bag}</b>` + (this.depot.length ? ` &middot; depot <b>${this.depot.length}</b>` : "") + (this.flags.length ? ` &middot; flags <b>${this.flags.length}</b>` : "");
    if (bag !== this._bag) { if (this._bag && ui) ui.poke("eva-bag", 6); this._bag = bag; this.bagEl.innerHTML = bag; }
    for (const b of this.beacons) { const e = g.entities.items.get(b.id); if (e && e.object.userData.lamp) e.object.userData.lamp.visible = (now % 1400) < 300; }
    if (this.mapOn) this._drawMap(now);
  }
  _fade(el, on) { const ui = this.game.hud.ui; if (ui) ui.fade(el, on); else el.hidden = !on; }
  _do(t) {
    if (this.game.hud.ui) this.game.hud.ui.used("eva." + t.kind);
    if (t.kind === "hatch") this.enterRover();
    else if (t.kind === "airlock") { if (t.ref.enter() === false) { this.game.hud.toast("The airlock will not open", 2.5); return; } this.flash(); this.av.refill("base"); this.av.inside = { kind: "airlock", id: t.ref.id, x: t.ref.x, z: t.ref.z }; this.av.group.visible = false; this.game.hud.toast("Inside the airlock<small>suit recharged; the EVA is over</small>", 3.5); this.game.emit("eva:enter", { airlock: t.ref.id, walked_m: this.av.evaWalked }); this.game.save(); }
    else if (t.kind === "leave") { this.flash(); const b = getSystem("base"); try { b && b.api && b.api.exit && b.api.exit(); } catch (e) { console.warn("[eva] base.exit", e); } this.av.inside = null; this.av.group.visible = true; this.av.evaWalked = 0; this.game.emit("eva:exit", { airlock: true }); }
    else if (t.kind === "core" || t.kind === "scoop") this.sample(t);
    else if (t.kind === "deposit") this.deposit(t);
  }
  _prompt(p) {
    const el = this.prompt;
    if (!p) { if (!el.hidden) this._fade(el, false); this._pk = ""; return; }
    const key = p.text + "|" + p.key + "|" + (p.working || "");
    if (key !== this._pk) { this._pk = key; el.querySelector(".eva-key").innerHTML = p.key ? p.key + " hold" : ""; el.querySelector(".eva-text").textContent = p.working ? p.working + "…" : p.text; el.classList.toggle("none", !!p.none); }
    el.querySelector(".fg").setAttribute("stroke-dashoffset", (R * (1 - Math.max(0, Math.min(1, p.k || 0)))).toFixed(1));
    el.classList.toggle("active", (p.k || 0) > 0);
    this._fade(el, true);
  }

  _drawMap(now) {
    if (this._mapT && now - this._mapT < 250) return;
    this._mapT = now;
    const g = this.game, av = this.av, cv = this.map.querySelector("canvas"), c = cv.getContext("2d"), W = cv.width, span = 700, m2p = W / (2 * span);
    // the skin's colours (the GeoHUB theme the player picked)
    const cs = getComputedStyle(document.documentElement), tok = (n, d) => (cs.getPropertyValue(n) || "").trim() || d;
    const INK = tok("--skin-ink", "#fdf7ff"), CHROME = tok("--skin-chrome", "#ff2bd6"), DATA = tok("--skin-data", "#00e5ff"), GROUND = `rgb(${tok("--skin-panel", "31, 14, 69")})`;
    // relief: redrawn only after walking a way
    if (!this._mapAt || Math.hypot(this._mapAt.x - av.p.x, this._mapAt.z - av.p.z) > 60) {
      this._mapAt = { x: av.p.x, z: av.p.z };
      const N = 100, img = c.createImageData(N, N), F = g.field, cell = 2 * span / N;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = av.p.x - span + (i + 0.5) * cell, z = av.p.z - span + (j + 0.5) * cell;
        const gr = F.gradient(x, z, cell, this._gr || (this._gr = { dx: 0, dz: 0 }));
        const shade = Math.max(0, Math.min(1, 0.62 + 0.9 * (gr.dx * 0.6 + gr.dz * 0.6))), o = (j * N + i) * 4;
        const steep = Math.atan(Math.hypot(gr.dx, gr.dz)) * 57.3 > WALK.slopeSand;
        img.data[o] = (steep ? 150 : 172) * shade; img.data[o + 1] = (steep ? 70 : 118) * shade; img.data[o + 2] = (steep ? 52 : 86) * shade; img.data[o + 3] = 255;
      }
      const off = this._off || (this._off = document.createElement("canvas")); off.width = off.height = N; off.getContext("2d").putImageData(img, 0, 0);
      this._relief = off;
    }
    const ox = (this._mapAt.x - av.p.x) * m2p, oz = (this._mapAt.z - av.p.z) * m2p;
    c.fillStyle = GROUND; c.fillRect(0, 0, W, W);
    c.imageSmoothingEnabled = true; c.drawImage(this._relief, ox, oz, W, W);
    const X = (x) => W / 2 + (x - av.p.x) * m2p, Z = (z) => W / 2 + (z - av.p.z) * m2p;
    const dot = (x, z, col, r = 4, label = "") => { const px = Math.max(6, Math.min(W - 6, X(x))), pz = Math.max(6, Math.min(W - 6, Z(z))); c.fillStyle = col; c.beginPath(); c.arc(px, pz, r, 0, 6.3); c.fill(); c.strokeStyle = "rgba(0,0,0,0.8)"; c.lineWidth = 1; c.stroke();
      if (label) { c.font = "600 10px sans-serif"; c.fillStyle = INK; c.fillText(label, Math.min(W - 80, px + 6), pz + 3); } };
    const st = av.status(), ref = st.refuge;
    c.strokeStyle = st.turnBack ? "#ff5a5a" : "#6fe3a1"; c.lineWidth = 1.5; c.setLineDash([5, 4]); c.beginPath(); c.arc(X(ref.x), Z(ref.z), Math.max(2, st.safeRange_m / 1.25 * m2p), 0, 6.3); c.stroke(); c.setLineDash([]);
    for (const p of g.site.pois) dot(p.x, p.z, DATA, 4, p.name.split(/[,:]/)[0].slice(0, 18));
    for (const f of this.flags) dot(f.x, f.z, CHROME, 3);
    for (const b of this.beacons) dot(b.x, b.z, "#ff5a5a", 3);
    for (const t of this.depot) dot(t.x, t.z, "#d9dde2", 2);
    const tg = g.target; if (tg) { c.strokeStyle = CHROME; c.lineWidth = 2; const px = Math.max(8, Math.min(W - 8, X(tg.x))), pz = Math.max(8, Math.min(W - 8, Z(tg.z))); c.strokeRect(px - 6, pz - 6, 12, 12); }
    dot(g.vehicle.p.x, g.vehicle.p.z, "#7fd0ff", 5, "Rover");
    c.save(); c.translate(W / 2, W / 2); c.rotate(av.yaw); c.fillStyle = INK; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); c.fill(); c.restore();
    this.map.querySelector(".eva-map-scale").textContent = `${(2 * span / 1000).toFixed(1)} km across, north up`;
  }

  toJSON() { return { n: this.n, bag: this.bag, depot: this.depot, flags: this.flags, beacons: this.beacons, cored: [...this.cored].slice(-400), scans: this.scans }; }
  async fromJSON(s) {
    const E = this.game.entities;
    for (const r of [...this.flags, ...this.beacons, ...this.depot]) E.remove(r.id);
    s = s || {};
    this.n = s.n || 0; this.bag = s.bag || []; this.depot = s.depot || []; this.flags = s.flags || []; this.beacons = s.beacons || [];
    this.cored = new Set(s.cored || []); this.scans = s.scans || 0; this.busy = null; this.hold.t = 0; this.card.hidden = true; this.toggleMap(false);
    for (const r of this.flags) await this._add("eva_flag", r);
    for (const r of this.beacons) await this._add("eva_beacon", r);
    for (const r of this.depot) await this._add("eva_tube", r);
  }
}

let eva = null;
const sys = {
  id: "eva", order: 62,
  get eva() { return eva; },
  api: {
    get bag() { return eva ? eva.bag : []; }, get depot() { return eva ? eva.depot : []; }, get flags() { return eva ? eva.flags : []; },
    get beacons() { return eva ? eva.beacons : []; }, get scans() { return eva ? eva.scans : 0; }, get lastScan() { return eva ? eva.lastScan : null; },
    get cored() { return eva ? eva.cored.size : 0; }, get ready() { return eva ? eva.ready : null; },
    exitRover: () => !!eva && eva.exitRover(), enterRover: () => !!eva && eva.enterRover(),
    sample: () => eva && eva.sample(), deposit: () => eva && eva.deposit(), plant: (what) => eva && eva.plant(what), scan: () => !!eva && eva.scan(),
    scanAt: () => eva && eva.scanAt(), target: () => eva && eva.target(), depots: () => eva ? eva.depots() : [], nearRock: () => eva && eva.nearRock(), limits: EVA,
  },
  async init(game) {
    const a = getSystem("avatar");
    if (!a || !a.avatar) throw new Error("the eva system needs the avatar system");
    eva = new Eva(game, a.avatar);
    a.avatar.on("blackout", (d) => { d.lost = eva.bag.length; eva.bag = []; });
    const live = () => game.mode === "onfoot" && !game.paused;
    const KEYS = { KeyF: "flag", KeyB: "beacon", KeyQ: "scan", Tab: "map", KeyO: "objective" };
    window.addEventListener("keydown", (e) => {
      if (!live() || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
      if (KEYS[e.code]) { eva.action(KEYS[e.code]); e.preventDefault(); }
    });
    const P = window.GeoIDPad;
    if (P) {
      P.on("left", () => { if (live()) eva.action("scan"); });
      P.on("down", () => { if (live()) eva.action("map"); });
      P.on("l1", () => { if (live()) eva.action("objective"); });
      // right: a tap plants a flag, a hold (0.6 s) places a beacon
      let t0 = 0;
      P.on("right", () => { t0 = live() ? performance.now() : 0; });
      P.on("right:release", () => { if (t0 && live()) eva.action(performance.now() - t0 >= 600 ? "beacon" : "flag"); t0 = 0; });
    }
  },
  load(game, saved) { if (eva) eva.ready = eva.fromJSON(saved); },
  save() { return eva ? eva.toJSON() : undefined; },
  frame(game, dt) { if (eva) eva.frame(dt); },
};
registerSystem(sys);
