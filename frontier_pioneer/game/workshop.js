/**
 * THE WORKSHOP: Kestrel Dynamics' catalogue, the appearance editor and the
 * garage's design list, on one screen with a live turntable.
 *
 *   tabs   Suit (hardware and mods) | Appearance (name, colours, visor, patch, proportions)
 *          | Rover (hardware and the wheel set) | Designs (scout, crew, hauler; paint and decals)
 *
 * Reached from the pause menu at any time, and from the title screen before a
 * traverse starts (appearance and paint only then: hardware needs a save to
 * buy into). Everything it changes goes through getSystem("progress").api;
 * this module only draws and asks.
 *
 * CONTROLS. Keyboard and mouse as any page (Tab / Enter, clicks; [ and ]
 * change tab; Esc closes). PS4 controller in "app" mode through
 * window.GeoIDPad only: the tabs are role="tab" so the ring lands on them
 * first; the D-pad walks the cards and buttons by geometry, Cross selects a
 * card and presses a button, Cross on a slider adjusts it with the D-pad,
 * Circle closes (the screen is [data-pad-closable] with a [data-pad-close]
 * button). The L1 / R1 shoulders are never read in app mode (the module
 * gives them to the host), so tabs are reached with the D-pad.
 *
 * THE PREVIEW is the real kit model on a turntable in its own small WebGL
 * canvas, dressed by the same functions (cosmetics.js) that dress the live
 * astronaut and rover, so what turns here is what you get.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { Assets } from "./entities.js?v=6d37c9c-9b39e129";
import { UPGRADES, UPGRADE, DESIGNS, DESIGN, PALETTE, VISORS, PATCHES, DECALS, NAMES, LIMITS, COLOUR } from "./progress_data.js?v=6d37c9c-9b39e129";
import { VEHICLES } from "./vehicle.js?v=6d37c9c-9b39e129";
import { dressAstronaut, dressRover, kitParts, prepareSuitModel, prepareSuitRig, drawPatch } from "./cosmetics.js?v=6d37c9c-9b39e129";
import { loadCharacters, Character } from "./charrig.js?v=6d37c9c-9b39e129";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TABS = [["suit", "Suit"], ["appearance", "Appearance"], ["rover", "Rover"], ["designs", "Designs"]];

/** This screen's stylesheet (workshop.css), with the module's own cache stamp (as avatar.js loads eva.css). */
export function ensureWorkshopStyles() {
  if (typeof document === "undefined" || document.getElementById("workshop-css")) return;
  const l = document.createElement("link"); l.id = "workshop-css"; l.rel = "stylesheet"; l.href = "workshop.css" + new URL(import.meta.url).search;
  document.head.appendChild(l);
}

/* ── the turntable ────────────────────────────────────────────────────────── */

class Preview {
  constructor(canvas) {
    this.canvas = canvas; this.renderer = null; this.assets = new Assets("assets/models/");
    this.what = null; this.key = ""; this.spin = 0.6; this.loading = null;
  }
  _init() {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { console.warn("[workshop] no preview:", e.message); return false; }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0x9fd8ff, 1.1); rim.position.set(-4, 3, -3);
    this.scene.add(sun, rim, new THREE.HemisphereLight(0xffe6d0, 0x3a1d10, 1.2));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x5a3322, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; this.floor = floor;
    this.turn = new THREE.Group(); this.scene.add(this.turn, floor);
    return true;
  }
  /** what = { kind: "astronaut", look, visuals } | { kind: "rover", design, fit, paint } */
  async show(what) {
    if (!this._init()) return;
    this.what = what;
    const key = what.kind === "astronaut" ? "astronaut" : "rover:" + what.design;
    if (key !== this.key) {
      this.key = key;
      const token = (this._token = (this._token || 0) + 1);
      const obj = await this._load(what);
      if (token !== this._token) return;
      this.turn.clear();
      if (obj) this.turn.add(obj.root);
      this.obj = obj;
      this._frame();
    }
    this._dress();
    this.render();
  }
  async _load(what) {
    try {
      if (what.kind === "astronaut") {
        // the same rigged suit as the walker (charrig.js), held in its idle pose; the old six-part kit model if the rig is not there
        let lib = null;
        try { lib = await loadCharacters(); } catch { lib = null; }
        if (lib) {
          const ch = new Character(lib, { kind: "pioneer", name: "workshop" });
          prepareSuitRig(ch); ch.pose("idle", 1.2); ch.update(0); ch.life = 0;
          const root = new THREE.Group(); root.add(ch.root);
          return { kind: "astronaut", root, body: ch.root, rig: ch, parts: { torso: ch.bones.get("chest"), head: ch.bones.get("head") } };
        }
        const m = await this.assets.load("astronaut");
        const root = new THREE.Group(), body = new THREE.Group();
        if (!m || !m.getObjectByName("torso")) return null;
        prepareSuitModel(m); body.add(m); root.add(body);
        const P = (n) => m.getObjectByName(n);
        return { kind: "astronaut", root, body, parts: { torso: P("torso"), head: P("head"), armL: P("arm_l"), armR: P("arm_r"), legL: P("leg_l"), legR: P("leg_r") } };
      }
      const D = DESIGN[what.design], def = VEHICLES[what.design];
      const [m, kitRoot, entries] = await Promise.all([this.assets.load(def ? def.model : what.design), this.kit ? null : this.assets.load("rover_upgrade_kit"), this.assets.entries()]);
      if (kitRoot) this.kit = kitParts(kitRoot);
      if (!m || !D) return null;
      m.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((x) => x.clone()) : o.material.clone(); });
      const e = entries.find((x) => x.id === (def ? def.model : what.design)) || {};
      const wheelNodes = (e.wheels || []).map((w) => m.getObjectByName(w.node));
      const root = new THREE.Group(); root.add(m);
      return { kind: "rover", root, model: { scene: m, wheelNodes, radius: (e.wheels && e.wheels[0] && e.wheels[0].radius) || 0.5 } };
    } catch (err) { console.warn("[workshop] preview model:", err.message); return null; }
  }
  _frame() {
    const o = this.obj; if (!o) return;
    const b = new THREE.Box3().setFromObject(o.root), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const big = Math.max(s.x, s.y, s.z), astro = o.kind === "astronaut";
    this.floor.scale.setScalar(astro ? 0.75 : big * 0.75);
    this.target = new THREE.Vector3(0, astro ? c.y * 0.98 : c.y * 0.8, 0);
    this.dist = astro ? 4.4 : big * 2.15; this.elev = astro ? 0.12 : 0.32;
  }
  _dress() {
    const o = this.obj, w = this.what; if (!o || !w) return;
    if (o.kind === "astronaut" && w.kind === "astronaut") dressAstronaut(o, w.look, w.visuals);
    if (o.kind === "rover" && w.kind === "rover") { const h = dressRover(o.model, w.design, w.fit, w.paint, this.kit); for (const m of h.glow || []) m.emissiveIntensity = 2; }
  }
  render(dt = 0) {
    if (!this.renderer || !this.obj) return;
    const cv = this.canvas, W = Math.max(64, cv.clientWidth | 0), H = Math.max(64, cv.clientHeight | 0);
    if (cv.width !== W || cv.height !== H) { this.renderer.setSize(W, H, false); this.camera.aspect = W / H; this.camera.updateProjectionMatrix(); }
    this.turn.rotation.y += dt * this.spin;
    const a = 0.6, t = this.target;
    this.camera.position.set(t.x + Math.sin(a) * this.dist * Math.cos(this.elev), t.y + Math.sin(this.elev) * this.dist, t.z + Math.cos(a) * this.dist * Math.cos(this.elev));
    this.camera.lookAt(t);
    this.renderer.render(this.scene, this.camera);
  }
}

/* ── the screen ───────────────────────────────────────────────────────────── */

export class Workshop {
  constructor(sys) {
    this.sys = sys; this.tab = "suit"; this.sel = {}; this.origin = null;
    ensureWorkshopStyles();
    const s = this.el = document.createElement("section");
    s.id = "screen-workshop"; s.className = "screen modal ws"; s.hidden = true; s.setAttribute("data-pad-closable", "");
    s.innerHTML = `<div class="card wide ws-card">
      <div class="ws-head"><div><div class="eyebrow">Kestrel Dynamics</div><h2>Workshop</h2></div>
        <div class="ws-headr"><div class="ws-bal"><b data-w="xp">0</b><span>XP to spend</span><em data-w="tier">&nbsp;</em></div>
        <button type="button" class="btn primary" id="btn-workshop-close" data-pad-close data-key="close">Back</button></div></div>
      <div class="ws-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" role="tab" class="ws-tab" data-tab="${id}" data-key="tab-${id}" aria-selected="false">${label}</button>`).join("")}</div>
      <p class="ws-where" data-w="where">&nbsp;</p><p class="ws-msg" data-w="msg" aria-live="polite"></p>
      <div class="ws-body"><div class="ws-list" data-w="list"></div>
        <div class="ws-side"><canvas class="ws-preview" width="320" height="300" aria-label="Preview"></canvas><div class="ws-detail" data-w="detail"></div></div></div>
    </div>`;
    document.body.appendChild(s);
    this.w = {}; for (const n of s.querySelectorAll("[data-w]")) this.w[n.dataset.w] = n;
    this.preview = new Preview(s.querySelector(".ws-preview"));
    s.querySelectorAll(".ws-tab").forEach((b) => b.addEventListener("click", () => this.setTab(b.dataset.tab)));
    s.querySelector("#btn-workshop-close").addEventListener("click", () => this.close());
    s.addEventListener("click", (e) => this._click(e));
    s.addEventListener("input", (e) => this._input(e));
    s.addEventListener("change", (e) => this._input(e, true));
    window.addEventListener("keydown", (e) => {
      if (s.hidden) return;
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); this.close(); return; }
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type === "text") { e.stopPropagation(); return; }     // typing a name drives nothing else
      if (e.key === "[" || e.key === "]") { const i = TABS.findIndex((t) => t[0] === this.tab); this.setTab(TABS[(i + (e.key === "]" ? 1 : TABS.length - 1)) % TABS.length][0]); e.preventDefault(); e.stopPropagation(); }
    }, true);
    this._loop = this._loop.bind(this);
  }
  get api() { return this.sys.api; }
  get open_() { return !this.el.hidden; }

  open(tab, origin = "menu") {
    this.origin = origin;
    if (tab) this.tab = tab;
    // the title it came from: the story title (default) or the development picker (?dev)
    this._titleEl = origin === "title" ? ["screen-story", "screen-title"].map((id) => document.getElementById(id)).find((el) => el && !el.hidden) || null : null;
    const hide = origin === "title" ? this._titleEl : document.getElementById("screen-menu");
    if (hide) hide.hidden = true;
    this.el.hidden = false;
    this.render();
    const P = window.GeoIDPad;
    if (P && P.connected) setTimeout(() => { if (!this.el.hidden) P.focus.to(this.el.querySelector(`.ws-tab[data-tab="${this.tab}"]`)); }, 60);
    this._t = performance.now();
    if (!this._running) { this._running = true; requestAnimationFrame(this._loop); }
    this.sys.emitGame && this.sys.emitGame("workshop:open", { tab: this.tab });
  }
  close() {
    if (this.el.hidden) return;
    this.el.hidden = true; this._running = false;
    const P = window.GeoIDPad;
    const back = this.origin === "title" ? this._titleEl : document.getElementById("screen-menu");
    const g = this.sys.game;
    if (back && (this.origin === "title" || (g && g.mode === "menu"))) { back.hidden = false; if (P && P.connected) setTimeout(() => { if (!back.hidden) P.focus.first(back); }, 60); }
    else if (P) P.focus.clear();
    this.sys.emitGame && this.sys.emitGame("workshop:close", {});
  }
  _loop(now) {
    if (!this._running) return;
    const dt = Math.min(0.1, (now - (this._t || now)) / 1000); this._t = now;
    this.preview.render(dt);
    requestAnimationFrame(this._loop);
  }
  setTab(t) { if (!TABS.some((x) => x[0] === t)) return; this.tab = t; this.render(); this.say(""); }
  say(t) { this.w.msg.textContent = t || ""; }

  /* ── drawing ── */
  render() {
    const A = this.api, P = window.GeoIDPad, cur = P && P.hasFocus && P.focus.current(), key = cur && cur.dataset ? cur.dataset.key : null;
    const L = A.limits();
    this.w.xp.textContent = A.xp.toLocaleString("en");
    this.w.tier.textContent = `${L.name} · ${A.xpTotal.toLocaleString("en")} XP earned` + (L.next ? ` · ${L.next.xp - A.xpTotal} to ${L.next.name}` : "");
    for (const b of this.el.querySelectorAll(".ws-tab")) { const on = b.dataset.tab === this.tab; b.setAttribute("aria-selected", String(on)); b.classList.toggle("on", on); }
    this.w.where.textContent = this._where();
    const list = this.w.list;
    if (this.tab === "suit" || this.tab === "rover") list.innerHTML = this._upgrades(this.tab);
    else if (this.tab === "designs") list.innerHTML = this._designs();
    else list.innerHTML = this._appearance();
    this._detail();
    this._preview();
    if (key && P && P.hasFocus) { const el = this.el.querySelector(`[data-key="${key}"]`); if (el) P.focus.to(el); }
  }
  _where() {
    const A = this.api, w = A.where();
    if (!A.ready) return "Appearance and paint are saved now and applied when you land. Kestrel hardware is bought into a traverse: start or continue one.";
    const fit = (ok, what, at) => ok ? `${what} is fitted at once.` : `${what} bought now is fitted when you are next ${at}.`;
    if (this.tab === "suit") return fit(w.canFitSuit, "Suit hardware", "in the rover or a base airlock");
    if (this.tab === "rover") return fit(w.canFitRover, "Rover hardware", "in the rover, or it is parked in a garage");
    if (this.tab === "designs") return !w.inRover ? "Designs are switched from the driver's seat: get in the rover. Paint and decals apply at once, anywhere."
      : !w.stopped ? "Stop the rover to switch designs. Paint and decals apply at once, anywhere."
      : w.garage ? "In a garage: a design you own is switched at once. Paint applies at once."
      : "Stopped: a design you own is dropped beside you by HALO-1 in about a quarter of a minute (in a base garage it is instant). Paint applies at once.";
    return "Appearance applies at once, anywhere. The perception filter renders it; the hardware underneath is unchanged.";
  }
  _state(u) {
    const A = this.api;
    if (A.installed().includes(u.id)) return u.exclusive ? (A.equipped().wheels === u.id ? ["fitted", "Fitted"] : ["owned", "Owned"]) : ["fitted", "Fitted"];
    if (A.pending().includes(u.id)) return ["pending", "Pending"];
    if (A.owned().includes(u.id)) return u.exclusive && A.equipPending() === u.id ? ["pending", "Pending"] : ["owned", "Owned"];
    const why = A.blocker(u);
    if (why) return ["locked", "Locked"];
    return [A.xp >= u.cost ? "buy" : "short", u.cost + " XP"];
  }
  _upgrades(group) {
    let out = "", last = "";
    for (const u of UPGRADES.filter((x) => x.group === group)) {
      if (u.lineName !== last) { out += `<div class="ws-line eyebrow">${esc(u.lineName)}</div>`; last = u.lineName; }
      const [st, badge] = this._state(u), on = this.sel[group] === u.id;
      out += `<button type="button" class="ws-item st-${st}${on ? " on" : ""}" data-pick="${u.id}" data-key="u-${u.id}" aria-pressed="${on}"><b>${esc(u.name)}</b><span>${esc(u.text.split(/[.:](?=\s|$)/)[0])}</span><em>${esc(badge)}</em></button>`;
      if (on) out += `<div class="ws-inline">${this._upgradeAction(u)}</div>`;      // under the card: the D-pad goes straight down to it
    }
    return out;
  }
  _designs() {
    const A = this.api, cur = A.design, p = A.paint;
    let out = `<div class="ws-line eyebrow">Kestrel designs</div>`;
    for (const d of DESIGNS) {
      const v = VEHICLES[d.id], own = A.designsOwned().includes(d.id), on = (this.sel.designs || cur) === d.id;
      const badge = cur === d.id ? "Current" : own ? "Owned" : A.blocker(d) ? "Locked" : d.cost + " XP";
      out += `<button type="button" class="ws-item st-${cur === d.id ? "fitted" : own ? "owned" : A.blocker(d) ? "locked" : A.xp >= d.cost ? "buy" : "short"}${on ? " on" : ""}" data-design="${d.id}" data-key="d-${d.id}" aria-pressed="${on}">
        <b>${esc(d.name)}</b><span>${v ? `${v.drive.maxSpeed} m/s · ${v.power.battery_kWh} kWh · ${v.wheels.length} wheels · ${(v.mass / 1000).toFixed(1)} t` : ""}</span><em>${esc(badge)}</em></button>`;
      if (on) out += `<div class="ws-inline">${this._designAction(d.id)}</div>`;
    }
    out += `<div class="ws-line eyebrow">Paint</div>` + this._swatches("paint-body", PALETTE, p.body, "Body") + this._swatches("paint-accent", PALETTE, p.accent, "Accent");
    out += `<div class="ws-row"><span class="ws-lab">Decal</span>${DECALS.map((d) => `<button type="button" class="ws-chip${p.decal === d.id ? " on" : ""}" data-set="paint-decal" data-val="${d.id}" data-key="decal-${d.id}" aria-pressed="${p.decal === d.id}">${esc(d.name)}</button>`).join("")}</div>`;
    out += `<div class="ws-row"><span class="ws-lab">Number</span><button type="button" class="ws-chip" data-set="paint-num" data-val="-1" data-key="num-dn" aria-label="Number down">&minus;</button><b class="ws-num">${String(p.number).padStart(2, "0")}</b><button type="button" class="ws-chip" data-set="paint-num" data-val="1" data-key="num-up" aria-label="Number up">+</button></div>`;
    return out;
  }
  _swatches(set, list, val, label) {
    return `<div class="ws-row"><span class="ws-lab">${label}</span>${list.map((c) => `<button type="button" class="ws-sw${val === c.id ? " on" : ""}" data-set="${set}" data-val="${c.id}" data-key="${set}-${c.id}" title="${esc(c.name)}" aria-label="${esc(label + ": " + c.name)}" aria-pressed="${val === c.id}"><i style="background:${c.hex}"></i></button>`).join("")}</div>`;
  }
  _appearance() {
    const A = this.api, l = A.look, done = A.missionsDone();
    let out = `<div class="ws-line eyebrow">Identity</div>
      <div class="ws-row"><span class="ws-lab">Name tag</span><b class="ws-fixed">${esc(l.name)}</b></div>
      <div class="ws-line eyebrow">Suit colours</div>` + this._swatches("look-suit", PALETTE, l.suit, "Suit") + this._swatches("look-accent", PALETTE, l.accent, "Accent") + this._swatches("look-visor", VISORS, l.visor, "Visor");
    out += `<div class="ws-line eyebrow">Shoulder patch</div><div class="ws-row ws-patches">${PATCHES.map((p) => {
      const lock = p.mission && !done.includes(p.mission);
      return `<button type="button" class="ws-patch${l.patch === p.id ? " on" : ""}" data-set="look-patch" data-val="${p.id}" data-key="patch-${p.id}" ${lock ? "disabled" : ""} aria-pressed="${l.patch === p.id}" title="${esc(lock ? "Earned by completing " + p.name : p.name)}"><canvas width="48" height="48" data-patch="${p.id}"></canvas><span>${esc(p.name)}</span></button>`;
    }).join("")}</div>`;
    out += `<div class="ws-line eyebrow">Proportions</div>
      <label class="ws-slider">Height <b>${Math.round(l.height * 100)}%</b><input type="range" min="${LIMITS.height[0]}" max="${LIMITS.height[1]}" step="0.01" value="${l.height}" data-set="look-height" data-key="height"></label>
      <label class="ws-slider">Build <b>${Math.round(l.build * 100)}%</b><input type="range" min="${LIMITS.build[0]}" max="${LIMITS.build[1]}" step="0.01" value="${l.build}" data-set="look-build" data-key="build"></label>`;
    setTimeout(() => { for (const c of this.el.querySelectorAll("canvas[data-patch]")) { const g = c.getContext("2d"); g.save(); g.scale(48 / 128, 48 / 128); drawPatch(g, c.dataset.patch); g.restore(); } }, 0);
    return out;
  }
  _upgradeAction(u) {
    const A = this.api, [st] = this._state(u), why = A.blocker(u);
    if (u.exclusive && A.owned().includes(u.id)) return A.equipped().wheels === u.id ? `<button type="button" class="btn" disabled data-key="act">Fitted</button>` : `<button type="button" class="btn primary" data-act="equip" data-id="${u.id}" data-key="act">${A.equipPending() === u.id ? "Fitting at the rover" : "Fit this set"}</button>`;
    if (st === "fitted") return `<button type="button" class="btn" disabled data-key="act">Fitted</button>`;
    if (st === "pending") return `<button type="button" class="btn" disabled data-key="act">Bought: fitted at the ${u.group === "suit" ? "rover or an airlock" : "rover or a garage"}</button>`;
    return `<button type="button" class="btn primary" data-act="buy" data-id="${u.id}" data-key="act" ${why || A.xp < u.cost || !A.ready ? "disabled" : ""}>${!A.ready ? "Start a traverse to buy" : why ? "Locked" : A.xp < u.cost ? `Needs ${u.cost} XP` : `Buy for ${u.cost} XP`}</button>`;
  }
  _designAction(id) {
    const A = this.api, D = DESIGN[id], own = A.designsOwned().includes(id), why = A.blocker(D), w = A.where(), drop = A.drop;
    if (A.design === id) return `<button type="button" class="btn" disabled data-key="act">Current design</button>`;
    if (!own) return `<button type="button" class="btn primary" data-act="buy-design" data-id="${id}" data-key="act" ${why || A.xp < D.cost || !A.ready ? "disabled" : ""}>${!A.ready ? "Start a traverse to buy" : why ? "Locked" : A.xp < D.cost ? `Needs ${D.cost} XP` : `Buy for ${D.cost} XP`}</button>`;
    if (drop && drop.design === id) return `<button type="button" class="btn" disabled data-key="act">HALO-1 drop on its way: ${Math.ceil(drop.eta_s)} s</button>`;
    if (!w.inRover) return `<button type="button" class="btn" disabled data-key="act">Get in the rover first</button>`;
    if (!w.stopped) return `<button type="button" class="btn" disabled data-key="act">Stop the rover first</button>`;
    return `<button type="button" class="btn primary" data-act="switch" data-id="${id}" data-key="act">${w.garage ? "Switch now (garage)" : "Switch: HALO-1 drop, 15 s"}</button>`;
  }
  _detail() {
    const A = this.api, d = this.w.detail;
    if (this.tab === "appearance") { d.innerHTML = `<p class="ws-note">${esc(A.look.name)}: ${esc(COLOUR[A.look.suit].name.toLowerCase())} suit, ${esc(COLOUR[A.look.accent].name.toLowerCase())} trim. Changes show on the turntable and on you at once.</p>`; return; }
    if (this.tab === "designs") {
      const id = this.sel.designs || A.design, D = DESIGN[id], v = VEHICLES[id], why = A.blocker(D);
      d.innerHTML = `<h3>${esc(D.name)}</h3><p>${esc(D.text)}</p>${v ? `<dl class="ws-stats"><dt>Top speed</dt><dd>${v.drive.maxSpeed} m/s</dd><dt>Battery</dt><dd>${v.power.battery_kWh} kWh</dd><dt>Array</dt><dd>${v.power.solarArea_m2} m&sup2;</dd><dt>Drive</dt><dd>${(v.drive.stallForce / 1000).toFixed(1)} kN</dd><dt>Mass</dt><dd>${(v.mass / 1000).toFixed(1)} t</dd><dt>Wheels</dt><dd>${v.wheels.length} &times; ${(v.wheelRadius * 2).toFixed(2)} m</dd></dl>` : ""}${why ? `<p class="ws-why">${esc(why)}</p>` : ""}`;
      return;
    }
    const u = UPGRADE[this.sel[this.tab]];
    if (!u) { d.innerHTML = `<p class="ws-note">Choose a card to see what it does; its button appears under it. Hardware is bought with contribution credit (XP); fitting it is free.</p>`; return; }
    const why = A.blocker(u);
    d.innerHTML = `<h3>${esc(u.name)}</h3><p>${esc(u.text)}</p>${why ? `<p class="ws-why">${esc(why)}</p>` : ""}${!A.ready ? `<p class="ws-why">Start or continue a traverse to buy hardware.</p>` : ""}`;
  }
  _preview() {
    const A = this.api;
    if (this.tab === "suit" || this.tab === "appearance") {
      const pick = this.tab === "suit" ? UPGRADE[this.sel.suit] : null;
      const vis = A.suitVisuals(pick ? [pick.id] : []);
      this.preview.show({ kind: "astronaut", look: A.look, visuals: vis });
    } else {
      const design = this.tab === "designs" ? (this.sel.designs || A.design) : A.design;
      const pick = this.tab === "rover" ? UPGRADE[this.sel.rover] : null;
      this.preview.show({ kind: "rover", design, fit: A.roverFit(pick ? [pick.id] : []), paint: A.paint });
    }
  }

  /* ── input ── */
  _click(e) {
    const b = e.target.closest("button"); if (!b || b.disabled || !this.el.contains(b)) return;
    const A = this.api;
    // a chosen card opens its button row under it: bring that row into the list's view, or the pad's ring cannot reach it
    const reveal = () => { const il = this.el.querySelector(".ws-inline"); if (il) try { il.scrollIntoView({ block: "nearest" }); } catch { /* old engine */ } };
    if (b.dataset.pick) { this.sel[this.tab] = b.dataset.pick; this.render(); reveal(); return; }
    if (b.dataset.design) { this.sel.designs = b.dataset.design; this.render(); reveal(); return; }
    const act = b.dataset.act, id = b.dataset.id;
    if (act === "buy") { const r = A.buy(id); this.say(r.ok ? (r.pending ? `${UPGRADE[id].name}: bought. ${r.where}` : `${UPGRADE[id].name}: fitted.`) : r.reason); this.render(); return; }
    if (act === "equip") { const r = A.equip(id); this.say(r.ok ? (r.pending ? `Wheel set changes when you are next at the rover.` : `${UPGRADE[id].name} fitted.`) : r.reason); this.render(); return; }
    if (act === "buy-design") { const r = A.buyDesign(id); this.say(r.ok ? `${DESIGN[id].name} is yours. Stop the rover and choose Switch: HALO-1 drops it beside you (in a garage, at once).` : r.reason); this.render(); return; }
    if (act === "switch") {
      this.say("Switching…");
      A.switchDesign(id).then((r) => {
        if (r.ok && r.drop) {
          this.say(`HALO-1 drop requested: ${DESIGN[id].name} lands beside you in ${r.eta} s. Back to the surface to watch it.`);
          // the drop runs on the surface, not in the menu: close and resume so the player sees the pod come down
          setTimeout(() => { const g = this.sys.game; this.close(); if (g && g.mode === "menu") { const m = document.getElementById("screen-menu"); if (m) m.hidden = true; g.pause(false); } }, 900);
        } else this.say(r.ok ? `${DESIGN[id].name} is now your rover.` : r.reason);
        this.render();
      });
      return;
    }
    const set = b.dataset.set, val = b.dataset.val;
    if (!set) return;
    if (set.startsWith("look-")) A.setLook({ [set.slice(5)]: val });
    else if (set === "paint-num") A.setPaint({ number: A.paint.number + Number(val) });
    else if (set.startsWith("paint-")) A.setPaint({ [set.slice(6)]: val });
    this.render();
  }
  _input(e, final = false) {
    const t = e.target;
    if (t.dataset && t.dataset.set === "look-height") { this.api.setLook({ height: +t.value }); t.previousElementSibling.textContent = Math.round(t.value * 100) + "%"; this._preview(); }
    if (t.dataset && t.dataset.set === "look-build") { this.api.setLook({ build: +t.value }); t.previousElementSibling.textContent = Math.round(t.value * 100) + "%"; this._preview(); }
  }
}
