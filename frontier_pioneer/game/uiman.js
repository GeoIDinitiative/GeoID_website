/**
 * THE INTERFACE LAYER MANAGER: one place that decides what is on screen.
 *
 * Every HUD element (the foundation's, and anything a system adds) is
 * registered here with a GROUP and a VISIBILITY POLICY:
 *
 *   ui.register(id, {
 *     el,                       // the element (required); it gets .ui-el and fades with opacity
 *     group: "vitals",          // one of GROUPS below: the player switches groups, not elements
 *     policy: "contextual",     // "always" | "contextual" (shown while relevant, then fades) | "hidden" (only when the group is "on")
 *     lean: "hidden",           // optional: the policy under the Minimal preset (defaults to `policy`)
 *     when: (game) => bool,     // contextual: is it relevant now? (called ten times a second; keep it cheap)
 *     force: (game) => bool,    // optional: show even if the policy says no (not when the group is "off"); e.g. the honesty view
 *     hold: 3,                  // seconds it lingers after `when` turns false or after a poke
 *   })  ->  handle { id, el, poke(seconds), shown }
 *   ui.poke(id, seconds)        // "this just changed": show it for a while (a new objective, a weather change)
 *   ui.unregister(id)
 *   ui.fade(el, on)             // `el.hidden`, but with the fade: sets hidden once the fade-out has run
 *
 * The OWNER of an element still says whether it has anything to show (its
 * `hidden` attribute: no base nearby, not on foot, no storm): the manager
 * only adds `.ui-off` on top. So `el.hidden` keeps meaning what it meant.
 *
 * THE PLAYER'S SIDE (Settings > Interface, and the pause menu):
 *   a preset  Minimal | Standard (default) | Full, and per group on / auto / off;
 *   "auto" runs the policies, "on" shows everything the group has (Full sets every group on),
 *   "off" hides the group. Hide everything: F1 on the keyboard, Share on the pad
 *   (both were unused in every controls table), for screenshots.
 *   Saved in the game's settings store as settings.ui = { preset, groups: {group: mode}, used: {action: n} }.
 *
 * PROMPTS learn: ui.gate(action, available) is true while a press / hold
 * action is available, and after the player has done that action twice
 * (ui.used(action)), only for the first few seconds it is available.
 * HINTS (the controller row) pulse: at the start of a mode, when the device
 * changes, and after half a minute without input; never permanently.
 *
 * FOR OTHER MODULES (sound, progression, anything later): `game.hud.ui` is
 * this object. Register your HUD element with a group, or add a group of
 * your own with ui.addGroup({ id, label, note }). `ui.settingsSlot` is the
 * element in the Settings screen to append a section to (a <fieldset
 * class="set-sec">), `ui.menuSlot` the place in the pause menu for a button.
 * ui.on("change", fn) fires when the preset, a group or hide-all changes.
 */

export const GROUPS = [
  { id: "vitals", label: "Vitals", note: "speed, battery, suit" },
  { id: "navigation", label: "Navigation", note: "map, compass, waypoint" },
  { id: "mission", label: "Mission", note: "objective, samples" },
  { id: "environment", label: "Environment", note: "clock, weather, hazard map" },
  { id: "base", label: "Base", note: "base status, construction labels" },
  { id: "data", label: "Data", note: "position, what is under you, scans" },
  { id: "prompts", label: "Prompts", note: "press and hold actions" },
  { id: "hints", label: "Control hints", note: "the button row" },
  { id: "alerts", label: "Alerts", note: "warnings and messages" },
];
const MODES = ["on", "auto", "off"];
const all = (v) => Object.fromEntries(GROUPS.map((g) => [g.id, v]));
export const PRESETS = {
  minimal: { label: "Minimal", note: "the picture first: instruments appear only when they matter", lean: true,
    groups: Object.assign(all("auto"), { hints: "off" }) },
  standard: { label: "Standard", note: "instruments fade in when relevant, out when not", groups: all("auto") },
  full: { label: "Full", note: "every readout, all the time", groups: Object.assign(all("on"), { prompts: "auto", hints: "auto" }) },
};
const LEARNED = 2;            // uses after which a prompt only shows briefly
const LINGER_S = 4;           // ... for this long after it becomes available
const HINT_START_S = 8, HINT_DEVICE_S = 6, IDLE_S = 30;
const FADE_MS = 360;

const now = () => performance.now() / 1000;

export class UiManager {
  constructor() {
    this.els = new Map();
    this.groups = GROUPS.map((g) => Object.assign({}, g));
    this.hidden = false;
    this.listeners = [];
    this._gates = new Map();
    this._acc = 1;
    this.t = 0;                       // play time, advanced by update(): prompts time themselves on it, so a paused or stepped game does not age them
    this.lastInput = now();
    this.hintUntil = 0;
    this._mode = "";
    this._device = "";
    this.settingsSlot = null;
    this.menuSlot = null;
    if (typeof window !== "undefined") {
      const act = () => { this.lastInput = now(); };
      for (const n of ["keydown", "pointerdown", "wheel"]) window.addEventListener(n, act, { passive: true });
    }
  }

  /* ── settings ─────────────────────────────────────────────────────────── */

  /** Bind to the game's settings object (settings.ui is created and normalised here). */
  attach(game) {
    this.game = game;
    const s = game.settings;
    const u = s.ui && typeof s.ui === "object" ? s.ui : {};
    const preset = PRESETS[u.preset] || u.preset === "custom" ? u.preset : "standard";
    const base = (PRESETS[preset] || PRESETS.standard).groups;
    const groups = {};
    for (const g of this.groups) groups[g.id] = MODES.includes(u.groups && u.groups[g.id]) ? u.groups[g.id] : base[g.id] || "auto";
    s.ui = { preset, groups, used: Object.assign({}, u.used) };
    this.cfg = s.ui;
    // the headless harness (?shot) composites only when it takes a picture, so CSS transitions would be caught half way: no fades there
    this.instant = !!game.headless;
    if (this.instant && typeof document !== "undefined") document.body.classList.add("ui-instant");
    this._syncBody();
    return this;
  }
  _save() { if (this.game && this.game.applySettings) this.game.applySettings(); this._syncBody(); this._emit(); }
  /** body[data-ui-<group>="on|auto|off"] and body[data-ui-preset]: lets CSS show the detail lines of a group that is "on". */
  _syncBody() {
    if (typeof document === "undefined" || !this.cfg) return;
    const b = document.body;
    b.dataset.uiPreset = this.cfg.preset;
    for (const g of this.groups) b.setAttribute("data-ui-" + g.id, this.cfg.groups[g.id] || "auto");
  }
  get preset() { return this.cfg ? this.cfg.preset : "standard"; }
  get lean() { const p = PRESETS[this.preset]; return !!(p && p.lean); }
  mode(group) { return (this.cfg && this.cfg.groups[group]) || "auto"; }
  setPreset(name) {
    const p = PRESETS[name];
    if (!p || !this.cfg) return;
    this.cfg.preset = name;
    for (const g of this.groups) this.cfg.groups[g.id] = p.groups[g.id] || "auto";
    this._acc = 1; this._save();
  }
  setGroup(group, mode) {
    if (!this.cfg || !MODES.includes(mode)) return;
    this.cfg.groups[group] = mode;
    // still a named preset if it now matches one, otherwise "custom" (Minimal's lean policies stay with it)
    const match = Object.keys(PRESETS).find((k) => this.groups.every((g) => (PRESETS[k].groups[g.id] || "auto") === this.cfg.groups[g.id]));
    this.cfg.preset = match || (this.cfg.preset === "minimal" ? "minimal" : "custom");
    this._acc = 1; this._save();
  }
  addGroup(g) {
    if (!g || !g.id || this.groups.some((x) => x.id === g.id)) return;
    this.groups.push({ id: g.id, label: g.label || g.id, note: g.note || "" });
    if (this.cfg && !this.cfg.groups[g.id]) this.cfg.groups[g.id] = "auto";
    this._syncBody(); this._emit();
  }
  on(name, fn) { if (name === "change") this.listeners.push(fn); }
  _emit() { for (const f of this.listeners) { try { f(this); } catch (e) { console.warn("[ui] listener", e); } } }

  /** Hide every HUD element (screenshots). Toggle with no argument. */
  hideAll(on = !this.hidden) {
    this.hidden = !!on;
    if (typeof document !== "undefined") {
      document.body.classList.toggle("ui-hidden", this.hidden);
      const n = this._note || (this._note = Object.assign(document.createElement("div"), { id: "ui-note", className: "ui-note" }));
      if (!n.parentNode) document.body.appendChild(n);
      const key = this.game && this.game.input && this.game.input.padConnected && this.game.input.lastDevice === "pad" && window.GeoIDPad ? window.GeoIDPad.glyph("share") : "<kbd>F1</kbd>";
      n.innerHTML = this.hidden ? `Interface hidden &middot; ${key} to show` : "";
      n.classList.remove("go"); void n.offsetWidth; if (this.hidden) n.classList.add("go");
    }
    this._acc = 1;
    this._emit();
    return this.hidden;
  }

  /* ── elements ─────────────────────────────────────────────────────────── */

  register(id, o) {
    if (!o || !o.el) throw new Error("ui.register needs an element");
    this.unregister(id);
    const r = { id, el: o.el, group: o.group || "data", policy: o.policy || "always", lean: o.lean || null, when: o.when || null, force: o.force || null,
      hold: o.hold == null ? 2.5 : o.hold, until: 0, lastRel: -1e9, shown: null };
    if (!this.groups.some((g) => g.id === r.group)) this.addGroup({ id: r.group });
    r.el.classList.add("ui-el");
    r.el.dataset.uiGroup = r.group;
    r.el.dataset.ui = id;
    this.els.set(id, r);
    const self = this;
    r.handle = { id, el: r.el, poke: (s) => self.poke(id, s), get shown() { return !!r.shown; } };
    this._apply(r, this._visible(r, now()));
    return r.handle;
  }
  unregister(id) { const r = this.els.get(id); if (r) { r.el.classList.remove("ui-el", "ui-off"); this.els.delete(id); } }
  /** Show a contextual element for `seconds` (it changed). */
  poke(id, seconds = 4) { const r = this.els.get(id); if (r) { r.until = Math.max(r.until, now() + seconds); if (!r.shown) this._apply(r, this._visible(r, now())); } }
  shown(id) { const r = this.els.get(id); return !!(r && r.shown); }

  _visible(r, t) {
    if (this.hidden) return false;
    const m = this.mode(r.group);
    if (m === "off") return false;
    if (m === "on") return true;
    const g = this.game, policy = (this.lean && r.lean) || r.policy;
    if (policy === "always") return true;
    if (r.force && g) { try { if (r.force(g)) return true; } catch { /* a failing test is a "no" */ } }
    if (policy === "hidden") return false;
    let rel = false;
    if (r.when && g) { try { rel = !!r.when(g); } catch { rel = false; } }
    if (rel) r.lastRel = t;
    return rel || t < r.until || t < r.lastRel + r.hold;
  }
  _apply(r, on) {
    if (r.shown === on) return;
    r.shown = on;
    r.el.classList.toggle("ui-off", !on);
  }

  /** `el.hidden = !on`, faded: the element fades out first and is hidden after. */
  fade(el, on) {
    if (!el) return;
    if (on) {
      if (el._fadeT) { clearTimeout(el._fadeT); el._fadeT = 0; }
      if (el.hidden) { el.classList.add("ui-out"); el.hidden = false; void el.offsetWidth; }
      el.classList.remove("ui-out");
      return;
    }
    if (el.hidden || el._fadeT) return;
    el.classList.add("ui-out");
    if (this.instant) { el.hidden = true; return; }
    el._fadeT = setTimeout(() => { el._fadeT = 0; if (el.classList.contains("ui-out")) el.hidden = true; }, FADE_MS);
  }

  /* ── prompts that learn ───────────────────────────────────────────────── */

  /** True while `action` is available and worth saying: always until it has been used twice, then only at first. */
  gate(action, available, { linger = LINGER_S, brief = false } = {}) {
    let g = this._gates.get(action);
    if (!g) { g = { avail: false, since: 0 }; this._gates.set(action, g); }
    if (!available) { g.avail = false; return false; }
    const t = this.t;
    if (!g.avail) { g.avail = true; g.since = t; }
    if (this.hidden || this.mode("prompts") === "off") return false;
    if (this.mode("prompts") === "on" && !brief) return true;
    if ((brief || this.timesUsed(action) >= LEARNED) && t - g.since > linger) return false;
    return true;
  }
  used(action) {
    if (!this.cfg) return;
    const u = this.cfg.used;
    const n = (u[action] || 0) + 1;
    if (n > 9) return;
    u[action] = n;
    if (n <= LEARNED + 1) this._save();
  }
  timesUsed(action) { return (this.cfg && this.cfg.used[action]) || 0; }

  /* ── hints: a pulse, never a fixture ──────────────────────────────────── */
  pulseHints(seconds = HINT_START_S) { this.hintUntil = Math.max(this.hintUntil, now() + seconds); }
  get hintsWanted() {
    const t = now();
    return t < this.hintUntil || (t - this.lastInput > IDLE_S && this.game && this.game.live);
  }

  /** Once a frame (cheap): input activity, mode / device changes, and the policies ten times a second. */
  update(game, dt) {
    const t = now();
    if (game.live) this.t += Math.min(dt || 0, 0.25);
    if (this._story && this._story.frame) this._story.frame(game, dt);
    const I = game.input, c = I && I.ctl;
    if (c && (c.throttle > 0.05 || c.brake > 0.05 || Math.abs(c.steer) > 0.08 || Math.abs(I.look.x) + Math.abs(I.look.y) > 0.1)) this.lastInput = t;
    const P = typeof window !== "undefined" ? window.GeoIDPad : null;
    if (P && P.connected && game.padMode === "flight") { const a = P.axes(); if (Math.abs(a.lx) + Math.abs(a.ly) + Math.abs(a.rx) + Math.abs(a.ry) + a.l2 + a.r2 > 0.2) this.lastInput = t; }
    const mode = game.mode;
    if (mode !== this._mode) {
      const live = mode === "driving" || mode === "onfoot" || mode === "build";
      if (live && this._mode !== "menu") this.pulseHints(HINT_START_S);
      this._mode = mode;
      this._acc = 1;
    }
    const dev = I && I.padConnected && I.lastDevice === "pad" ? "pad" : "keys";
    if (dev !== this._device) { if (this._device) this.pulseHints(HINT_DEVICE_S); this._device = dev; }
    this._acc += dt || 0.05;
    if (this._acc < 0.1) return;
    this._acc = 0;
    for (const r of this.els.values()) this._apply(r, this._visible(r, t));
  }

  /** For tests and the console: what is registered and what is shown. */
  state() {
    return { preset: this.preset, groups: Object.assign({}, this.cfg && this.cfg.groups), hidden: this.hidden, used: Object.assign({}, this.cfg && this.cfg.used),
      els: [...this.els.values()].map((r) => ({ id: r.id, group: r.group, policy: r.policy, lean: r.lean, shown: !!r.shown, present: !r.el.hidden })) };
  }

  /* ── the player's switches: Settings > Interface, and the pause menu's presets ── */

  /** Build the Interface section into `parent` (a fieldset). Re-renders itself on change. */
  mountSettings(parent) {
    const box = document.createElement("fieldset");
    box.className = "set-sec set-ui";
    box.id = "set-interface";
    parent.appendChild(box);
    const render = () => {
      const pre = Object.keys(PRESETS).map((k) => `<button type="button" class="seg${this.preset === k ? " on" : ""}" data-preset="${k}" aria-pressed="${this.preset === k}">${PRESETS[k].label}</button>`).join("");
      const rows = this.groups.map((g) => `<div class="ui-row"><span>${g.label}<small>${g.note}</small></span><span class="segs" role="group" aria-label="${g.label}">${MODES.map((m) =>
        `<button type="button" class="seg${this.mode(g.id) === m ? " on" : ""}" data-group="${g.id}" data-mode="${m}" aria-pressed="${this.mode(g.id) === m}">${m}</button>`).join("")}</span></div>`).join("");
      box.innerHTML = `<legend>Interface</legend>
        <div class="ui-presets segs" role="group" aria-label="Interface preset">${pre}</div>
        <p class="fine ui-note-line">${PRESETS[this.preset] ? PRESETS[this.preset].note : "custom: your own mix"}. Hide everything for a screenshot: <kbd>F1</kbd>, or Share on the controller.</p>
        <div class="ui-rows">${rows}</div>`;
    };
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.preset) this.setPreset(b.dataset.preset);
      else if (b.dataset.group) this.setGroup(b.dataset.group, b.dataset.mode);
      const sel = b.dataset.preset ? `[data-preset="${b.dataset.preset}"]` : `[data-group="${b.dataset.group}"][data-mode="${b.dataset.mode}"]`;
      render();
      const again = box.querySelector(sel), P = window.GeoIDPad;          // keep the controller's ring where it was
      if (again && P && P.hasFocus && P.focus && P.focus.to) P.focus.to(again);
    });
    this.on("change", render);
    render();
    return box;
  }
  /** Three preset buttons and the hide control, for the pause menu. */
  mountMenu(parent, before = null) {
    const row = document.createElement("div");
    row.className = "menu-ui";
    row.id = "menu-interface";
    parent.insertBefore(row, before);
    const render = () => {
      row.innerHTML = `<span class="eyebrow">Interface</span><span class="segs">${Object.keys(PRESETS).map((k) =>
        `<button type="button" class="seg${this.preset === k ? " on" : ""}" data-preset="${k}" aria-pressed="${this.preset === k}">${PRESETS[k].label}</button>`).join("")}</span>`;
    };
    row.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-preset]");
      if (!b) return;
      this.setPreset(b.dataset.preset);
      const again = row.querySelector(`[data-preset="${b.dataset.preset}"]`), P = window.GeoIDPad;
      if (again && P && P.hasFocus && P.focus && P.focus.to) P.focus.to(again);
    });
    this.on("change", render);
    render();
    return row;
  }
}
