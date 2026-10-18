/**
 * The HUD. Plain DOM over the canvas: text is refreshed ten times a second,
 * the waypoint marker every frame.
 *
 * WHAT IS ON SCREEN IS DECIDED IN ONE PLACE: game/uiman.js. Every element
 * here, and every element a system adds through addPanel(), is registered
 * there with a group (vitals, navigation, mission, environment, base, data,
 * prompts, hints, alerts) and a policy, and fades in and out with it. The
 * instruments are small and unboxed, grouped in the corners:
 *
 *   top left      the objective (contextual: a new objective, near the target, on request)
 *   top right     the clock line, a system's read-outs (weather), the annunciators, base / scan panels
 *   bottom left   the corner map (navmap.js)
 *   bottom centre the compass (navmap.js), the hint row (a pulse), prompts (only when an action is available)
 *   bottom right  the vitals cluster (speed while moving, battery when it matters, the suit on foot)
 *                 with the data read-out above it (Full preset, or when it matters)
 *
 * The ground's data sources are still computed (prov-* elements) but not shown: the game has no
 * data-honesty view.
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";
import { PROV } from "./heightfield.js?v=6d37c9c-9b39e129";
import { clockText } from "./state.js?v=6d37c9c-9b39e129";
import { UiManager } from "./uiman.js?v=6d37c9c-9b39e129";
import { installStory } from "./uistory.js?v=6d37c9c-9b39e129";

const $ = (id) => document.getElementById(id);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const _v = new THREE.Vector3();

export function fmtDistance(m, units) {
  if (units === "imperial") { const mi = m / 1609.344; return mi < 0.2 ? Math.round(m * 3.28084) + " ft" : mi.toFixed(2) + " mi"; }
  return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km";
}
export function fmtSpeed(ms, units) {
  if (units === "imperial") return [(ms * 2.23694).toFixed(1), "mph"];
  if (units === "kmh") return [(ms * 3.6).toFixed(1), "km/h"];
  return [ms.toFixed(1), "m/s"];
}
const fmtPower = (w) => Math.abs(w) >= 1000 ? (w / 1000).toFixed(2) + " kW" : Math.round(w) + " W";
/** A ring read-out's arc (an SVG circle of circumference 100), set from a fraction 0..1; cls "low" | "crit" colours it. */
export function setRing(circle, f, cls = "") {
  const v = Math.max(0, Math.min(1, f)) * 100;
  circle.setAttribute("stroke-dasharray", v.toFixed(1) + " 100");
  const want = ("fg " + cls).trim();
  if (circle.getAttribute("class") !== want) circle.setAttribute("class", want);
}
export const ringLevel = (f, low = 0.25, crit = 0.1) => f < crit ? "crit" : f < low ? "low" : "";
/** Markup for a ring read-out (used by the suit's vitals too). */
export const ringHTML = (key, label, title = "") => `<div class="ring-read" data-ring="${key}"${title ? ` title="${title}"` : ""}><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.9155"/><circle class="fg" cx="18" cy="18" r="15.9155"/></svg><b>&nbsp;</b><small>${label}</small></div>`;

/** The annunciator for an alert id: short caps, cockpit-style (a system may pass its own as setAlert's 4th argument). */
const ICONS = { storm: "DUST", radiation: "RAD", cold: "COLD", "battery-cold": "PACK", speed: "VIS", sand: "SAND", slope: "TILT", rocks: "ROCK",
  suit: "SUIT", battery: "BATT", build: "BLD", "base:blocked": "BLK", "base:dock": "DOCK" };
const iconFor = (id) => ICONS[id] || (id.startsWith("base:") ? "BASE" : id.slice(0, 4).toUpperCase());
const SHOW_S = { danger: 10, warn: 7, info: 6 };
const RANK = { info: 0, warn: 1, danger: 2 };
const TOAST_MAX = 3;

export class Hud {
  constructor() {
    this.root = $("hud");
    this.el = {};
    for (const id of ["obj-name", "obj-dist", "obj-count", "obj-bearing", "clk-sol", "clk-time", "clk-warp", "clk-sun",
      "spd", "spd-unit", "gear", "hdg", "pitch", "roll", "slope", "grnd", "odo", "batt-fill", "batt-pct", "batt-kwh", "pw-solar", "pw-load",
      "pos-ll", "pos-el", "prov-dot", "prov-h", "prov-i", "prov-d", "marker", "marker-text", "toast", "status", "hints",
      "hud-obj", "hud-clock", "clk-detail", "hud-right", "hud-left", "hud-alerts", "hud-prov", "vitals", "v-rover", "v-detail", "v-batt", "v-speed", "prompts"]) this.el[id] = $(id);
    this.acc = 0;
    this.hintKey = "";
    this.alertBox = this.el["hud-alerts"];
    this.ui = new UiManager();
    this.ui.settingsSlot = $("settings-slot");
    this.ui.menuSlot = document.querySelector("#screen-menu .col");
    installStory(this.ui);              // dialogue, choices, cutscenes, the perception filter, world tags (uistory.js)
    this._toasts = [];
    this._prompts = new Map();
    this._battHist = [];
    this._seen = { obj: "", prov: -1 };
  }
  show(on) { this.root.hidden = !on; }

  /** Bind to the game (its settings carry the interface choices) and register the foundation's elements. */
  attach(game) {
    this.game = game;
    const ui = this.ui.attach(game), e = this.el;
    const speedOf = (g) => g.vehicle ? Math.abs(g.vehicle.t.speed) : 0;
    const near = (g, r) => { const t = g.target, f = g.focus || (g.vehicle && g.vehicle.p); return !!(t && f && Math.hypot(t.x - f.x, t.z - f.z) < r); };
    ui.register("objective", { el: e["hud-obj"], group: "mission", policy: "contextual", hold: 3, when: (g) => near(g, 250) });
    ui.register("clock", { el: e["hud-clock"], group: "environment", policy: "always", lean: "contextual", hold: 4,
      when: (g) => g.warp || !!(g.sky && Math.abs(g.sky.sun.elevation) < 4) });
    ui.register("clock-detail", { el: e["clk-detail"], group: "environment", policy: "hidden" });
    ui.register("speed", { el: e["v-speed"], group: "vitals", policy: "contextual", hold: 3,
      when: (g) => speedOf(g) > 0.3 || !!(g.vehicle && (g.vehicle.flat || g.input.ctl.crawl)) });
    ui.register("battery", { el: e["v-batt"], group: "vitals", policy: "contextual", hold: 4, when: (g) => this._battRelevant(g) });
    ui.register("rover-detail", { el: e["v-detail"], group: "vitals", policy: "contextual", lean: "hidden", hold: 3,
      when: (g) => !!g.vehicle && Math.max(Math.abs(g.vehicle.t.pitch), Math.abs(g.vehicle.t.roll)) > 18 });
    ui.register("data", { el: e["hud-prov"], group: "data", policy: "contextual", lean: "hidden", hold: 0.5 });
    ui.register("marker", { el: e.marker, group: "navigation", policy: "always", lean: "contextual", hold: 2, when: (g) => near(g, 400) });
    ui.register("alerts", { el: this.alertBox, group: "alerts", policy: "always" });
    ui.register("toasts", { el: e.toast, group: "alerts", policy: "always" });
    ui.register("status", { el: e.status, group: "prompts", policy: "always" });
    ui.register("hints", { el: e.hints, group: "hints", policy: "contextual", hold: 0.8, when: () => this.ui.hintsWanted });
    const tags = document.getElementById("world-tags");
    if (tags) ui.register("world-tags", { el: tags, group: "mission", policy: "always" });
    ui.on("change", () => { this.acc = 1; if (this.alerts) for (const a of this.alerts.values()) a.state = null; });
    if (game.on) game.on("mode", (mode) => { if (mode === "driving" || mode === "onfoot") { ui.poke("objective", 8); ui.poke("battery", 5); } });
    return this;
  }
  _battRelevant(g) {
    const v = g.vehicle;
    if (!v) return false;
    if (v.batteryFraction < 0.3 || v.flat || g.warp) return true;
    const h = this._battHist;                       // [t, f] over the last ten seconds: "changing fast" is more than 0.1% a second
    if (h.length > 1) { const a = h[0], b = h[h.length - 1]; if (b[0] - a[0] > 2 && Math.abs(b[1] - a[1]) / (b[0] - a[0]) > 0.001) return true; }
    return false;
  }

  /* ── extension points for systems (weather, hazards, the builder, the astronaut). Generic: use them freely. ── */

  _col(side) {
    if (side === "right" || side === "right-low") return this.el["hud-right"];
    if (side === "left") return this.el["hud-left"];
    if (side === "prompt") return this.el.prompts;
    if (side === "vitals") return this.el.vitals;
    return this.root;
  }
  /**
   * Put a system's own element in the HUD. slot: omitted = straight into the HUD root (bring your own position);
   * "right" = the right column above the annunciators (read-outs); "right-low" = the right column under them (panels, cards);
   * "left" = the column under the objective; "prompt" = the prompt stack above the compass; "vitals" = the vitals cluster.
   * One element per id (adding again replaces it). Returns the element. Then register it with the interface manager,
   * game.hud.ui.register(id, { el, group, policy, when }) (uiman.js); unregistered, it is simply always shown.
   */
  addPanel(id, element, slot = null) {
    this.panels = this.panels || new Map();
    this.removePanel(id);
    element.dataset.hudPanel = id;
    if (slot === "right") this.el["hud-right"].insertBefore(element, this.alertBox);
    else this._col(slot).appendChild(element);
    this.panels.set(id, element);
    return element;
  }
  removePanel(id) { const e = this.panels && this.panels.get(id); if (e) { e.remove(); this.panels.delete(id); this.ui.unregister(id); } }

  /**
   * An alert: an annunciator in the top-right column, worst first. One per id; a null or empty text clears it.
   * level: "info" | "warn" | "danger" ("bad" is taken as "danger"). The text may carry markup (key caps, glyphs).
   * Cheap to call every frame with the same text. It opens with its full text when it is new (or gets worse), then a
   * warning or danger folds to a small chip that stays (its short name: `icon`, or one made from the id) and an info
   * line fades away. The text stays in the element; the alerts group set to "on" (the Full preset) keeps every one open.
   */
  setAlert(id, text, level = "info", icon = null) {
    const A = this.alerts || (this.alerts = new Map());
    let a = A.get(id);
    if (!text) { if (a) { a.el.remove(); A.delete(id); } return; }
    if (level === "bad") level = "danger";
    if (a && a.text === text && a.level === level) return;
    if (!a) {
      a = { el: document.createElement("div"), text: null, level: null, born: performance.now(), state: null };
      a.el.innerHTML = `<i class="a-ic"></i><span class="a-tx"></span>`;
      a.el.querySelector(".a-ic").textContent = icon || iconFor(id);
      a.el.dataset.alert = id;
      A.set(id, a); this.alertBox.appendChild(a.el);
    } else if (RANK[level] > RANK[a.level]) { a.born = performance.now(); a.state = null; }      // worse: open it again
    if (a.text !== text) a.el.querySelector(".a-tx").innerHTML = text;
    a.text = text; a.level = level;
    a.el.className = "hud-alert " + level;
    a.el.style.order = level === "danger" ? "0" : level === "warn" ? "1" : "2";
    this._alertState(a, performance.now());
  }
  _alertState(a, t) {
    const open = this.ui.mode("alerts") === "on" || t - a.born < SHOW_S[a.level] * 1000;
    const st = open ? "open" : a.level === "info" ? "gone" : "chip";
    if (st !== a.state) { a.state = st; a.el.dataset.state = st; }
  }

  /** A message: they stack (three at most), fade in, and fade out after `seconds` (2 to 7). The same text again just stays longer. */
  toast(html, seconds = 4) {
    const box = this.el.toast, t = performance.now();
    let it = this._toasts.find((x) => x.html === html);
    if (!it) {
      const el = document.createElement("div");
      el.className = "toast";
      el.innerHTML = html;
      box.appendChild(el);
      it = { html, el, until: 0 };
      this._toasts.push(it);
      while (this._toasts.length > TOAST_MAX) this._dropToast(this._toasts[0], true);
    }
    it.until = t + Math.min(Math.max(seconds, 2), 7) * 1000;
  }
  _dropToast(it, fade) {
    this._toasts = this._toasts.filter((x) => x !== it);
    if (!fade) { it.el.remove(); return; }
    it.el.classList.add("out");
    setTimeout(() => it.el.remove(), 400);
  }
  /** When the last message goes. Setting a time in the past clears every message at once (the tests do: toastUntil = 1). */
  get toastUntil() { return this._toasts.reduce((m, x) => Math.max(m, x.until), 0); }
  set toastUntil(v) { if (v < performance.now()) for (const it of this._toasts.slice()) this._dropToast(it, false); }

  /**
   * A press / hold prompt in the stack above the compass: prompt(id, html, {k}) shows it (fading in; k is a hold's
   * progress 0..1), prompt(id, null) fades it out. Decide availability with hud.ui.gate(action, available): it also
   * retires a prompt once the player has learned it (see uiman.js). Returns the element.
   */
  prompt(id, html, { k = 0 } = {}) {
    let p = this._prompts.get(id);
    if (!html) { if (p) this.ui.fade(p.el, false); return p ? p.el : null; }
    if (!p) {
      const el = document.createElement("div");
      el.className = "hud-prompt";
      el.dataset.prompt = id;
      el.hidden = true;
      el.innerHTML = `<span class="p-text"></span><i class="p-bar"><b></b></i>`;
      this.el.prompts.appendChild(el);
      p = { el, html: null };
      this._prompts.set(id, p);
      this.ui.register("prompt:" + id, { el, group: "prompts", policy: "always" });
    }
    if (p.html !== html) { p.html = html; p.el.querySelector(".p-text").innerHTML = html; }
    p.el.querySelector(".p-bar b").style.width = (Math.max(0, Math.min(1, k)) * 100).toFixed(0) + "%";
    p.el.classList.toggle("active", k > 0);
    this.ui.fade(p.el, true);
    return p.el;
  }

  /** The hint row: key caps, or controller glyphs when a pad is the device in use. It pulses (uiman.js), never stays. */
  /** A system that owns a mode may supply the hint row: setHints(id, (usePad, glyph, keycap) => [[html, text]…]); setHints(null) restores driving's. */
  setHints(id, fn = null) {
    const next = id && fn ? id : "";
    if (next !== (this.hintId || "")) this.ui.pulseHints(6);
    this.hintId = next; this.hintFn = id && fn ? fn : null; this.hintKey = "";
  }
  hints(usePad, pad) {
    const key = (usePad ? "pad" : "keys") + (this.hintId || "");
    if (key === this.hintKey) return;
    this.hintKey = key;
    const g = (n) => pad ? pad.glyph(n) : `<kbd>${n}</kbd>`, k = (t) => `<kbd>${t}</kbd>`;
    const rows = this.hintFn ? this.hintFn(usePad, g, k) : usePad
      ? [[g("r2"), "Drive"], [g("l2"), "Brake / reverse"], [g("ls"), "Steer"], [g("l1"), "Low range"], [g("square"), "Camera"], [g("circle"), "Menu"], [g("triangle"), "Controls"]]
      : [[k("W") + k("S"), "Drive / brake"], [k("A") + k("D"), "Steer"], [k("Shift"), "Low range"], [k("C"), "Camera"], [k("Esc"), "Menu"], [k("H"), "Controls"]];
    this.el.hints.innerHTML = rows.map(([a, b]) => `<span>${a} ${b}</span>`).join("");
  }

  update(dt, game) {
    const now = performance.now();
    for (const it of this._toasts.slice()) if (now > it.until) this._dropToast(it, true);
    this._marker(game);
    this.ui.update(game, dt);
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    if (this.alerts) for (const a of this.alerts.values()) this._alertState(a, now);
    const e = this.el, v = game.vehicle, t = v.t, st = game.state, units = game.settings.units, site = game.site;

    const [sp, un] = fmtSpeed(Math.abs(t.speed), units);
    e.spd.textContent = sp; e["spd-unit"].textContent = un;
    const gear = v.flat ? "FLAT" : game.input.ctl.crawl ? "LOW" : t.speed < -0.3 ? "R" : "D";
    e.gear.textContent = gear; e.gear.className = gear === "D" ? "" : gear === "FLAT" ? "bad" : "hot";
    e.hdg.textContent = String(Math.round(t.heading) % 360).padStart(3, "0") + "° " + COMPASS[Math.round(t.heading / 45) % 8];
    e.pitch.textContent = (t.pitch >= 0 ? "+" : "") + t.pitch.toFixed(0) + "°";
    e.roll.textContent = (t.roll >= 0 ? "+" : "") + t.roll.toFixed(0) + "°";
    e.slope.textContent = t.slope.toFixed(0) + "°";
    e.grnd.textContent = t.sand > 0.55 ? "loose sand" : t.sand > 0.25 ? "regolith" : "firm";
    e.odo.textContent = fmtDistance(v.odometer, units);

    const f = v.batteryFraction, ts = now / 1000;
    this._battHist.push([ts, f]); while (this._battHist.length > 2 && ts - this._battHist[0][0] > 10) this._battHist.shift();
    setRing(e["batt-fill"], f, ringLevel(f));
    e["batt-pct"].textContent = Math.round(f * 100) + "%";
    e["batt-kwh"].textContent = (v.battery / 3.6e6).toFixed(1) + " kWh";
    // Solar and the hotel loads run on the sol clock; drive energy is work per distance, so it is shown per kilometre.
    const net = t.solar_W - t.hotel_W;
    e["pw-solar"].textContent = (net >= 0 ? "+" : "−") + fmtPower(Math.abs(net));
    e["pw-load"].textContent = Math.abs(t.speed) > 0.5 ? (t.drive_W / Math.abs(t.speed) / 3600).toFixed(1) + " kWh/km" : "0.0 kWh/km";
    // a low battery is an annunciator (a chip that stays), not a banner
    if (v.flat) this.setAlert("battery", "Battery flat: the rover waits for the Sun", "danger");
    else if (f < 0.12) this.setAlert("battery", `Battery ${Math.round(f * 100)}%: find the Sun, or a base to charge at`, "warn");
    else if (f > 0.14) this.setAlert("battery", null);

    e["clk-sol"].textContent = "Sol " + st.clock.sol;
    e["clk-time"].textContent = clockText(st.clock);
    e["clk-warp"].textContent = "×" + st.clock.scale;
    e["clk-warp"].classList.toggle("hot", game.warp);
    e["clk-sun"].textContent = game.sky.sun.elevation.toFixed(0) + "°";

    const fp = game.focus || v.p, fh = game.focus && Number.isFinite(game.focus.heading) ? game.focus.heading : t.heading;      // the active body: the rover, or whoever holds the streaming focus
    const ll = site.toLonLat(fp.x, fp.z);
    e["pos-ll"].textContent = Math.abs(ll.lat).toFixed(5) + (ll.lat < 0 ? "° S  " : "° N  ") + ll.lon.toFixed(5) + "° E";
    const ground = game.surface.measured(fp.x, fp.z);
    e["pos-el"].textContent = "elevation " + site.elevation(ground).toFixed(1) + " m (areoid)";
    const d = game.surface.describe(fp.x, fp.z);
    e["prov-h"].textContent = "Terrain: " + d.height;
    e["prov-dot"].className = d.prov.cat === PROV.hirise ? "hirise" : d.prov.cat === PROV.ctx ? "ctx" : d.prov.cat === PROV.interpolated ? "interp" : "none";
    e["prov-i"].textContent = "Picture: " + d.image + " (tint is not data)";
    e["prov-d"].textContent = d.detail;
    this._seen.prov = d.prov.cat;

    const target = game.target, oh = st.objectives.hud;       // oh: {name, meta, count} from a missions system, for objectives that are not a place
    if (target) {
      const dx = target.x - fp.x, dz = target.z - fp.z, dist = Math.hypot(dx, dz);
      const brg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
      let rel = ((brg - fh + 540) % 360) - 180;
      e["obj-name"].textContent = oh ? oh.name : target.name;
      e["obj-dist"].textContent = fmtDistance(dist, units) + " · bearing " + String(Math.round(brg) % 360).padStart(3, "0") + "°";
      e["obj-count"].textContent = oh ? oh.count : (st.objectives.index + 1) + " / " + st.objectives.route.length;
      e["obj-bearing"].style.left = (50 + Math.max(-90, Math.min(90, rel)) / 90 * 48) + "%";
      e["obj-bearing"].hidden = false;
    } else if (oh) {
      e["obj-name"].textContent = oh.name; e["obj-dist"].textContent = oh.meta || " "; e["obj-count"].textContent = oh.count || "";
      e["obj-bearing"].hidden = true;
    } else {
      e["obj-name"].textContent = "Traverse complete: free exploration";
      e["obj-dist"].textContent = fmtDistance(v.odometer, units) + " driven"; e["obj-count"].textContent = "";
    }
    // a new objective (or the next step of one): show the tracker for a while
    const sig = e["obj-name"].textContent + "|" + e["obj-count"].textContent;
    if (sig !== this._seen.obj) { if (this._seen.obj) this.ui.poke("objective", 8); this._seen.obj = sig; }

    let status = "", bad = false;
    if (v.flat) { status = "Battery flat: wait for the Sun (time warp: T)"; bad = true; }
    else if (t.tipped) { status = "Tipped over: right the rover (R / L3)"; bad = true; }
    else if (t.stuck) status = t.sand > 0.3 ? "Bogged in loose ground: back out, or hold low range (Shift / L1)" : "Not moving: too steep? Try low range (Shift / L1), or right the rover (R / L3)";
    else if (game.edge) status = "Edge of the mapped area";
    if (status) { e.status.textContent = status; e.status.classList.toggle("bad", bad); }
    this.ui.fade(e.status, !!status && game.mode === "driving");
  }

  _marker(game) {
    const m = this.el.marker, target = game.target;
    if (!target) { m.hidden = true; return; }
    const cam = game.camera;
    _v.set(target.x, game.surface.measured(target.x, target.z) + 9, target.z);
    const dist = game.focus ? Math.hypot(target.x - game.focus.x, target.z - game.focus.z) : _v.distanceTo(game.vehicle.p);
    _v.project(cam);
    const w = window.innerWidth, h = window.innerHeight;
    let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    const behind = _v.z > 1;
    const off = behind || x < 40 || x > w - 40 || y < 60 || y > h - 120;
    if (behind) { x = w - x; y = h - 130; }
    x = Math.max(40, Math.min(w - 40, x)); y = Math.max(70, Math.min(h - 130, y));
    m.hidden = false;
    m.classList.toggle("off", off);
    m.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    this.el["marker-text"].textContent = fmtDistance(dist, game.settings.units);
  }
}
