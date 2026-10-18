/**
 * The builder's interface: the build ribbon, the base status panel in the
 * HUD, the settlement screen in the pause menu, and the small additions to
 * the shell (two menu buttons, the sandbox toggle, the "Building" help).
 *
 * All of it is DOM made here and styled by the "base builder" block at the
 * end of mars.css; index.html is not touched. Everything sits under
 * [data-pad-skip] while the player is building, so the shared controller
 * module never offers it a focus ring: in build mode the D-pad IS the menu
 * (up / down category, left / right module) and is read by builder.js.
 */
import { MODULES, KIT, CATEGORIES, RULES } from "./basenet.js?v=6d37c9c-9b39e129";
import { getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { setRing, ringLevel } from "./hud.js?v=6d37c9c-9b39e129";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const kW = (w) => (Math.abs(w) >= 1000 ? (w / 1000).toFixed(Math.abs(w) >= 10000 ? 0 : 1) + " kW" : Math.round(w) + " W");
const signed = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const hours = (h) => (!Number.isFinite(h) ? "∞" : h >= 100 ? Math.round(h) + " h" : h.toFixed(1) + " h");
const amount = (v) => (v >= 10000 ? (v / 1000).toFixed(1) + "k" : v >= 100 ? Math.round(v) : v.toFixed(1));
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

/** The controller map shown by Triangle while building (the module's help overlay). */
export const BUILD_HELP = [
  { control: "ls", text: "Move the build cursor over the ground" },
  { control: "rs", text: "Orbit and tilt the camera" },
  { control: "l2 r2", text: "Zoom out / in" },
  { control: "cross", text: "Place the module (when the ghost is green or amber); in a campaign it is a blueprint: no materials" },
  { control: "l1 r1", text: "Rotate 90 degrees; when snapped to a port, choose which of the module's ports joins; a first module turns in 15 degree steps" },
  { control: "square", text: "Hold: salvage the module under the cursor (75% of its cost back, all of it while under construction)" },
  { control: "l3", text: "Undo the last placement" },
  { control: "r3", text: "Time warp on / off (construction and the Sun run fast)" },
  { heading: "Build menu" },
  { control: "dpad-ud", text: "Previous / next category; the last tab, HALO-1, sends the plan (Cross)" },
  { control: "dpad-lr", text: "Previous / next module" },
  { heading: "Leaving" },
  { control: "circle", text: "Back to the rover" },
  { control: "options", text: "Pause (the settlement screen is in the pause menu)" },
  { control: "triangle", text: "Show or hide this map" },
  { control: "share", text: "Hide / show the whole interface (screenshots)" },
  { heading: "From the driver's seat" },
  { control: "cross", text: "Hold for build mode; tap beside dusty solar arrays to clean them" },
];
export const BUILD_KEYS = [
  ["B", "Build mode (from the rover); B or Esc leaves it"], ["Mouse", "Move the ghost; click to place"], ["Right drag / wheel", "Orbit and tilt / zoom"],
  ["W A S D", "Move the camera (and the cursor without a mouse)"], ["Q E", "Rotate; choose the joining port when snapped"], ["Enter / Space", "Place"],
  ["Tab, 1 to 8", "Category (8: HALO-1)"], ["G", "Send the plan to HALO-1 (a campaign)"], ["[ ]", "Module"], ["Hold X / Delete", "Salvage the module under the cursor"], ["Z", "Undo the last placement"], ["T", "Time warp"],
];

function effects(type) {
  const B = MODULES[type], out = [];
  if (B.solar) out.push(["Power", `+${kW(1100)} at noon`, "good"]);
  else if (B.power_w < 0) out.push(["Power", "−" + kW(-B.power_w) + (B.nightOnly ? " at night" : ""), ""]);
  if (B.battery_wh) out.push(["Storage", (B.battery_wh / 1000) + " kWh", "good"]);
  if (B.charge_w) out.push(["Rover charger", kW(B.charge_w), "good"]);
  const life = [];
  if (B.o2) life.push(`O₂ ${signed(B.o2, Math.abs(B.o2) < 10 ? 1 : 0)} kg`);
  if (B.water) life.push(`water ${signed(B.water, 0)} L`);
  if (B.food) life.push(`food ${signed(B.food, 0)} kg`);
  if (life.length) out.push(["Per sol", life.join(", "), (B.o2 || 0) + (B.food || 0) + (B.water || 0) > 0 ? "good" : ""]);
  if (B.materials) out.push(["Materials", `+${B.materials} per sol`, "good"]);
  if (B.crew) out.push(["Crew", "+" + B.crew + " places", "good"]);
  const c = B.cap || {}, holds = [];
  if (c.o2 >= 100) holds.push(amount(c.o2) + " kg O₂"); if (c.water >= 1000) holds.push(amount(c.water) + " L water"); if (c.food >= 100) holds.push(amount(c.food) + " kg food"); if (c.mat >= 400) holds.push(amount(c.mat) + " materials");
  if (holds.length) out.push(["Holds", holds.join(", "), "good"]);
  if (B.shield) out.push(["Shelter", "radiation and blast berm", "good"]);
  return out;
}
const TIER = { 1: "Life support: never shed; runs on its own reserve when the bus fails", 2: "Comfort load: shed when storage is nearly empty", 3: "Industry: runs on solar surplus once storage is 90% full" };

export class BuildUI {
  constructor(game, sys, builder) {
    this.game = game; this.sys = sys; this.builder = builder;
    this.acc = 1; this.flashUntil = 0; this.statusKey = ""; this.alertIds = new Set(); this.thumbsStarted = false;
    this._ribbon();
    this._panel();
    this._shell();
    this.sync();
  }

  /* ── the ribbon ───────────────────────────────────────────────────────── */
  _ribbon() {
    const b = this.builder, root = this.root = el("div"); root.id = "build-ui"; root.hidden = true; root.setAttribute("data-pad-skip", "");
    this.statusEl = el("div", "b-status", `<i class="b-dot"></i><span class="b-reason"></span><span class="b-sub"></span><span class="b-hold" hidden><i></i></span>`);
    const ribbon = el("div", "b-ribbon panel");
    const head = el("div", "b-head");
    this.tabs = el("div", "b-tabs");
    b.catalog.forEach((c, i) => { const t = el("button", "b-tab", `<span>${i + 1}</span>${c.name}`); t.type = "button"; t.tabIndex = -1; t.addEventListener("click", () => { b.cat = i; b.nav(0, 0); }); this.tabs.appendChild(t); });
    this.mat = el("div", "b-mat");
    head.append(this.tabs, this.mat);
    const body = el("div", "b-body");
    this.cards = el("div", "b-cards");
    this.detail = el("div", "b-detail");
    body.append(this.cards, this.detail);
    this.hintsEl = el("div", "b-hints");
    ribbon.append(head, body, this.hintsEl);
    root.append(this.statusEl, ribbon);
    document.body.appendChild(root);
    // the plan on the table (a campaign): what HALO-1 will send, who comes with it, what credit allows
    const plan = this.planEl = el("div", "plan-ui panel"); plan.id = "plan-ui"; plan.hidden = true; plan.setAttribute("data-pad-skip", "");
    plan.innerHTML = `<div class="eyebrow">The plan \u00b7 for HALO-1</div><h3 class="pl-title"></h3><ul class="pl-items"></ul><dl class="pl-rows"></dl><ul class="pl-story"></ul>
      <button type="button" class="btn primary pl-send" tabindex="-1">Send plan to HALO-1</button><p class="pl-key"></p><p class="pl-inbound"></p>`;
    plan.querySelector(".pl-send").addEventListener("click", () => this.builder.sendPlan());
    document.body.appendChild(plan);
    this.hintKey = "";
    // the ribbon's key row pulses like the HUD's hint row: at the start of build mode, on a device change, after a pause
    const ui = this.game.hud.ui;
    if (ui) ui.register("build-hints", { el: this.hintsEl, group: "hints", policy: "contextual", hold: 0.8, when: () => ui.hintsWanted });
  }
  show(on) { this.root.hidden = !on; this.planEl.hidden = !(on && this.builder.planning); if (on) { this.sync(); this.acc = 1; this._fillPlan(); } }

  sync() {
    const b = this.builder, cat = b.catalog[b.cat];
    const planning = b.planning;
    [...this.tabs.children].forEach((t, i) => { t.classList.toggle("on", i === b.cat); t.hidden = !!b.catalog[i].action && !planning; });
    this.cards.innerHTML = "";
    if (cat.action) {
      const M = b.manifest();
      const c = el("button", "b-card on b-send", `<span class="b-thumb b-halo" aria-hidden="true">\u2191</span><span class="b-name">Send plan</span><span class="b-cost">${M.modules} \u00b7 ${M.crates}</span>`);
      c.type = "button"; c.tabIndex = -1; c.addEventListener("click", () => b.sendPlan()); this.cards.appendChild(c);
      this.detail.innerHTML = `<div class="b-title"><b>Send the plan to HALO-1</b><span>${M.modules ? `${M.modules} module${M.modules > 1 ? "s" : ""} \u00b7 ${M.crates} crates` : "nothing planned yet"}</span></div>
        <div class="b-stats"><span>Caretakers <b>${M.caretakers}</b></span><span>Food <b>${M.supplies.food} kg</b></span><span>Water <b>${M.supplies.water} L</b></span><span>O\u2082 <b>${M.supplies.o2} kg</b></span><span>Descent <b>20\u201330 min</b></span></div>
        <div class="b-note">${M.modules ? "The package lands beside the plan; the caretakers carry the components to each blueprint and build them, power and life support first." : "Lay out blueprints in the other tabs first: they cost no materials, only Contribution Credit."}</div>`;
      this.acc = 1;
      return;
    }
    const cc = planning ? (getSystem("halo") && getSystem("halo").api.cc()) : null, hand = planning ? this.sys.net.onHand : {};
    cat.items.forEach((id, i) => {
      const B = MODULES[id], K = KIT[id], url = this.sys.kit.thumbs.get(id);
      const cost = planning ? (hand[id] > 0 ? "on hand" : Math.round(B.cost / 2) + " CC") : B.cost;
      const c = el("button", "b-card" + (i === b.item[b.cat] ? " on" : ""), `<span class="b-thumb" data-thumb="${id}">${url ? `<img alt="" src="${url}">` : ""}</span><span class="b-name">${B.name}</span><span class="b-cost"><i></i>${cost}</span>`);
      void cc;
      c.type = "button"; c.tabIndex = -1; c.dataset.type = id;
      c.addEventListener("click", () => { b.item[b.cat] = i; b.nav(0, 0); });
      this.cards.appendChild(c);
      void K;
    });
    const id = b.type, B = MODULES[id], K = KIT[id] || { fp: [1, 1], description: "" };
    const fx = K.fp[0], fz = K.fp[1];
    const cells = `<span class="b-fp" style="--fx:${fx};--fz:${fz}">${"<i></i>".repeat(fx * fz)}</span>`;
    this.detail.innerHTML = `<div class="b-title"><b>${B.name}</b><span>${fx} × ${fz} cell${fx * fz > 1 ? "s" : ""} · ${fx * 4} × ${fz * 4} m ${cells}</span></div>
      <div class="b-stats">${b.planning ? `<span>Footprint <b>${Math.round(B.cost / 2)} CC</b></span><span>Crates <b>${Math.max(1, Math.ceil(B.cost / 70))}</b></span>` : `<span>Cost <b>${B.cost}</b></span>`}<span>Build <b>${B.build_h >= 1 ? B.build_h + " h" : Math.round(B.build_h * 60) + " min"}</b></span>${effects(id).map(([k, v, c]) => `<span>${k} <b class="${c}">${v}</b></span>`).join("")}</div>
      <div class="b-note">${TIER[B.tier] || (B.solar ? "Tracks the Sun; dust builds up and can be cleaned" : B.battery_wh ? "Buffers the night; arrives half charged" : B.shield ? "Chains east to west; shelters what is beside it" : "No power needed")}</div>`;
    this.acc = 1;
  }

  /** Render the menu's pictures, one a frame, the first time build mode opens. */
  thumbnails() {
    if (this.thumbsStarted) return this.thumbsDone;
    this.thumbsStarted = true;
    const ids = this.builder.catalog.flatMap((c) => c.items);
    this.thumbsDone = (async () => {
      for (const id of ids) {
        try {
          const url = await this.sys.kit.thumbnail(id, this.game.renderer);
          const slot = this.cards.querySelector(`[data-thumb="${id}"]`);
          if (slot && !slot.firstChild) slot.innerHTML = `<img alt="" src="${url}">`;
        } catch (e) { console.warn("[build] thumbnail", id, e.message); }
        await new Promise((r) => setTimeout(r, 0));
      }
      return true;
    })();
    return this.thumbsDone;
  }

  /** The one-line verdict under the ghost. */
  status(r, pose, hover) {
    const B = MODULES[r.type];
    let reason = r.reason, sub = "";
    if (r.state !== "bad") {
      const bits = [];
      if (pose.snapped) bits.push(`snapped: ${pose.snapped.gp.name.replace("port_", "").toUpperCase()} port` + (pose.snapped.n > 1 ? ` (1 of ${pose.snapped.n}: rotate to change)` : ""));
      if (!pose.level && r.leg > 0.25) bits.push(`legs ${r.leg.toFixed(1)} m`);
      if (!pose.level) bits.push(`slope ${Math.round(r.slope)}°`);
      bits.push(this.sys.net.sandbox ? "sandbox" : this.builder.planning ? (r.onHand ? "components on hand: you build it" : `blueprint \u00b7 no materials \u00b7 ${Math.round(B.cost / 2)} CC footprint`) : `${B.cost} materials`);
      sub = bits.join(" · ");
    } else if (hover) sub = hover.plan === "draft" ? "hold to take the blueprint back" : `hold to salvage: ${this.sys.net.sandbox || this.builder.planning ? "nothing to refund" : "+" + this.sys.net.refund(hover) + " materials"}`;
    const key = r.state + "|" + reason + "|" + sub;
    if (key === this.statusKey && performance.now() > this.flashUntil) return;
    this.statusKey = key;
    if (performance.now() < this.flashUntil) return;
    this.statusEl.className = "b-status " + r.state;
    this.statusEl.querySelector(".b-reason").textContent = reason.charAt(0).toUpperCase() + reason.slice(1);
    this.statusEl.querySelector(".b-sub").textContent = sub;
  }
  /** The HALO-1 tab: no ghost, the status line is the plan. */
  planStatus() {
    const M = this.builder.manifest(), ok = M.modules > 0;
    const credit = M.credit ? `${M.credit.free} CC free \u00b7 drops open ${M.credit.open} / ${M.credit.maxOpen}` : "";
    const key = "plan|" + M.modules + "|" + credit;
    if (key === this.statusKey || performance.now() < this.flashUntil) { this._fillPlan(M); return; }
    this.statusKey = key;
    this.statusEl.className = "b-status " + (ok ? "ok" : "warn");
    this.statusEl.querySelector(".b-reason").textContent = ok ? `Send the plan to HALO-1: ${M.modules} module${M.modules > 1 ? "s" : ""}, ${M.crates} crates` : "Nothing planned yet: lay out blueprints in the other tabs";
    this.statusEl.querySelector(".b-sub").textContent = credit;
    this._fillPlan(M);
  }
  /** The plan went up: say so where the eye is. */
  sent(pkg) {
    this.statusEl.className = "b-status ok flash";
    this.statusEl.querySelector(".b-reason").textContent = `Plan sent: package ${String(pkg.id).replace("pkg_", "")}, descent ${pkg.minutes} minutes`;
    this.statusEl.querySelector(".b-sub").textContent = `${(pkg.modules || []).length} modules \u00b7 ${(pkg.manifest && pkg.manifest.crates) || 0} crates \u00b7 HALO-1 confirms`;
    this.flashUntil = performance.now() + 3500; this.statusKey = "";
    this.sync(); this._fillPlan();
  }
  _fillPlan(M) {
    const p = this.planEl; if (!p) return;
    const on = !this.root.hidden && this.builder.planning;
    p.hidden = !on; if (!on) return;
    M = M || this.builder.manifest();
    const q = (c) => p.querySelector(c), C = M.credit;
    q(".pl-title").textContent = M.modules ? `${M.modules} module${M.modules > 1 ? "s" : ""} \u00b7 ${M.crates} crate${M.crates > 1 ? "s" : ""}` : "No blueprints yet";
    q(".pl-items").innerHTML = M.items.map((x) => `<li><b>${x.n}</b> ${esc(x.name)}</li>`).join("") || `<li class="pl-empty">Place modules: each is a blueprint, no materials</li>`;
    const crew = M.crew ? M.crew.text : `${M.caretakers} caretaker${M.caretakers === 1 ? "" : "s"}`;
    const rows = [];
    if (M.modules) {
      rows.push(["Caretakers", `${M.caretakers} needed \u00b7 ${esc(crew)}`]);
      rows.push(["Supplies", `food ${M.supplies.food} kg \u00b7 water ${M.supplies.water} L \u00b7 O\u2082 ${M.supplies.o2} kg \u00b7 spares ${M.supplies.spares}`]);
      rows.push(["Descent", M.descent]);
    }
    if (C) {
      rows.push(["Credit", `${M.modules ? `plan ${M.footprint} CC \u00b7 ` : ""}${Math.max(0, C.free)} free of ${C.capacity}` + (C.free < 0 ? " (over)" : "")]);
      rows.push(["Limits", `${C.tier || "tier"}: ${C.maxModules} modules a base \u00b7 drops open ${C.open} / ${C.maxOpen}`]);
    }
    for (const b of M.bases) rows.push([esc(b.name) + " base", `${b.modules} / ${b.cap ?? "?"} modules, ${b.drafts} planned`]);
    if (M.tier && M.tier.next) rows.push(["Tier", `${M.tier.tier === "none" ? "no tier yet" : M.tier.tier}; ${M.tier.next} needs ${esc(M.tier.need)}`]);
    q(".pl-rows").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    q(".pl-story").innerHTML = M.story.length ? `<li class="pl-head">The story asks for</li>` + M.story.map((n) => `<li class="${n.built >= n.count ? "done" : n.built + n.planned >= n.count ? "ok" : "miss"}">${esc(n.text)}<span>${n.built >= n.count ? "built" : n.built + n.planned >= n.count ? "planned" : "not in the plan"}</span></li>`).join("") : "";
    const send = q(".pl-send"); send.disabled = !M.modules || (C && C.open >= C.maxOpen);
    const usePad = this.game.input.padConnected && this.game.input.lastDevice === "pad", P = window.GeoIDPad;
    q(".pl-key").hidden = !M.modules;
    q(".pl-key").innerHTML = usePad && P ? `${P.glyph("dpad")} down to the HALO-1 tab, then ${P.glyph("cross")}` : "<kbd>G</kbd>, or the HALO-1 tab (8)";
    q(".pl-inbound").innerHTML = M.inbound.map((k) => `Package ${String(k.id).replace("pkg_", "")}: ${k.modules} modules \u00b7 ${k.phase === "final" ? "inbound now" : "T-" + mmss(k.left)}`).join("<br>");
  }
  flash(text) {
    this.statusEl.className = "b-status bad flash";
    this.statusEl.querySelector(".b-reason").textContent = text.charAt(0).toUpperCase() + text.slice(1);
    this.statusEl.querySelector(".b-sub").textContent = "";
    this.flashUntil = performance.now() + 1600; this.statusKey = "";
  }
  holdProgress(f) {
    const h = this.statusEl.querySelector(".b-hold");
    h.hidden = !(f > 0);
    if (f > 0) h.firstChild.style.width = Math.min(100, f * 100).toFixed(0) + "%";
  }

  /* ── the base status panel (HUD) ──────────────────────────────────────── */
  _panel() {
    const p = this.panel = el("div", "base-panel");
    p.innerHTML = `<div class="bp-head"><span class="eyebrow" id="bp-name">Base</span><span class="bp-score" id="bp-score"></span>
        <span class="ring-read bp-ring" title="Base storage"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.9155"/><circle class="fg" id="bp-fill" cx="18" cy="18" r="15.9155"/></svg><b id="bp-pct">0%</b><small>Store</small></span></div>
      <div class="mini bp-row"><span>Reserve <b id="bp-res">0 h</b></span><span>Sun <b id="bp-gen">0 W</b></span><span>Load <b id="bp-load">0 W</b></span></div>
      <div class="bp-detail">
        <div class="mini bp-row"><span>O₂ <b id="bp-o2">0</b></span><span>H₂O <b id="bp-h2o">0</b></span><span>Food <b id="bp-food">0</b></span></div>
        <div class="mini bp-row"><span>Crew <b id="bp-crew">0</b></span><span id="bp-mat-wrap">Materials <b id="bp-mat">0</b></span><span id="bp-build-wrap">Building <b id="bp-build">0</b></span></div>
        <div class="mini bp-row" id="bp-plan-row"><span>Planned <b id="bp-plan">0</b></span><span>Inbound <b id="bp-inbound">0</b></span><span>At the pod <b id="bp-pod">0</b></span><span>Spares <b id="bp-spares">0</b></span></div>
      </div>`;
    p.hidden = true;
    const hud = this.game.hud;
    if (hud.addPanel) hud.addPanel("base", p, "right-low"); else $("hud").appendChild(p);
    // contextual: near a base (250 m), in build mode, or for a while when the base raises a new alert
    if (hud.ui) hud.ui.register("base", { el: p, group: "base", policy: "contextual", hold: 4, when: (g) => g.mode === "build" || !!this.near });
    this.bp = {};
    for (const id of ["name", "score", "fill", "pct", "res", "gen", "load", "o2", "h2o", "food", "crew", "mat", "mat-wrap", "build", "build-wrap", "plan-row", "plan", "inbound", "pod", "spares"]) this.bp[id] = p.querySelector("#bp-" + id);
  }

  frame(dt) {
    this.acc += dt || 0.05;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const g = this.game, sys = this.sys, net = sys.net, b = this.builder;
    const at = b.active ? b.cursor : g.vehicle.p, base = sys.currentBase(at.x, at.z), near = base && Math.hypot(base.x - at.x, base.z - at.z) < 1500;
    const s = near ? sys.summary(base.id) : null;
    this.summary = s;
    this.panel.hidden = !s;
    this.near = !!(base && Math.hypot(base.x - at.x, base.z - at.z) < 250);
    const live = new Set();
    if (s) {
      const e = this.bp, P = s.power;
      e.name.textContent = "Base · " + s.name;
      e.score.textContent = s.score.total + " " + s.score.rating;
      setRing(e.fill, P.capacity_Wh > 0 ? P.fraction : 0, ringLevel(P.fraction, 0.35, 0.15));
      e.pct.textContent = P.capacity_Wh > 0 ? Math.round(P.fraction * 100) + "%" : "\u2014";
      e.res.textContent = P.capacity_Wh > 0 ? hours(P.reserve_h) : "0 h";
      e.res.className = P.capacity_Wh > 0 && P.reserve_h < Math.max(2, P.nightLeft_h) ? "bad" : P.reserveNight_h < P.nightLen_h ? "warn" : "";
      e.gen.textContent = kW(P.gen_W); e.load.textContent = kW(P.load_W);
      const flow = (stock, rate, unit, crated) => amount(stock) + " " + unit + (crated > 0.5 ? ` +${amount(crated)} crated` : "") + (Math.abs(rate) > 0.005 ? (rate > 0 ? " ▲" : " ▼") : "");
      const cr = s.crated || {};
      e.o2.textContent = flow(s.o2.kg, s.o2.perSol, "kg", cr.o2); e.h2o.textContent = flow(s.water.l, s.water.perSol, "L", cr.water); e.food.textContent = flow(s.food.kg, s.food.perSol, "kg", cr.food);
      const chain = b.planning;
      e["mat-wrap"].hidden = chain; e["plan-row"].hidden = !chain;
      if (chain) { e.plan.textContent = s.planned || 0; e.inbound.textContent = s.inbound || 0; e.pod.textContent = s.atPod || 0; e.spares.textContent = Math.round(s.spares || 0); }
      e.o2.className = s.o2.perSol < 0 && s.o2.kg / -s.o2.perSol < 5 ? "warn" : ""; e.h2o.className = s.water.perSol < 0 && s.water.l / -s.water.perSol < 5 ? "warn" : ""; e.food.className = s.food.perSol < 0 && s.food.kg / -s.food.perSol < 5 ? "warn" : "";
      e.crew.textContent = s.crew.capacity + " / " + s.crew.places;
      e.mat.textContent = s.materials.sandbox ? "∞" : Math.floor(s.materials.stock);
      e["build-wrap"].hidden = !s.building; e.build.textContent = s.building;
      if (g.hud.setAlert && g.mode !== "menu") s.alerts.slice(0, 3).forEach((a) => { live.add("base:" + a.id); g.hud.setAlert("base:" + a.id, a.text, a.level); });
    }
    if (sys.touching && g.mode === "driving") { live.add("base:blocked"); g.hud.setAlert && g.hud.setAlert("base:blocked", `Blocked by the ${MODULES[sys.touching.type].name.toLowerCase()}`, "warn"); }
    if (sys.docked && g.mode === "driving") { live.add("base:dock"); g.hud.setAlert && g.hud.setAlert("base:dock", sys.docked.garage ? `In the garage: charging ${kW(sys.docked.delivered_W || 0)}` : `Docked at the ${sys.docked.port.replace("port_", "")} port: ${kW(sys.docked.delivered_W || 0)}`, "info"); }
    for (const id of this.alertIds) if (!live.has(id)) g.hud.setAlert && g.hud.setAlert(id, null);
    for (const id of live) if (!this.alertIds.has(id) && g.hud.ui && id !== "base:dock" && id !== "base:blocked") g.hud.ui.poke("base", 8);      // a new base alert: show the base read-out with it
    this.alertIds = live;

    if (!this.root.hidden) {
      const m = net.materials, cap = net.materialsCap();
      const H = b.planning ? getSystem("halo") : null, cc = H && H.api ? H.api.cc() : null;
      if (cc) {
        const nd = [...net.modules.values()].filter((x) => x.plan === "draft").length;
        this.mat.innerHTML = `Credit <b>${Math.max(0, cc.free)}</b> free of ${cc.capacity}<span>${nd ? nd + " blueprint" + (nd > 1 ? "s" : "") + " on the table" : "materials: HALO-1's"}</span>`;
        for (const c of this.cards.children) if (c.dataset.type) c.classList.toggle("poor", !(net.onHand[c.dataset.type] > 0) && MODULES[c.dataset.type].cost / 2 > cc.free);
      } else {
        this.mat.innerHTML = net.sandbox ? `Materials <b>∞</b><span>sandbox</span>` : `Materials <b>${Math.floor(m)}</b> / ${cap}<span>${net.materialsRate > 0 ? "+" + Math.round(net.materialsRate) + " per sol" : "no ISRU"}</span>`;
        for (const c of this.cards.children) if (c.dataset.type) c.classList.toggle("poor", !net.canAfford(c.dataset.type));
      }
      if (b.planning) this._fillPlan();
      const usePad = g.input.padConnected && g.input.lastDevice === "pad", key = usePad ? "pad" : "keys";
      const hk = key + (b.planning ? "|plan" : "");
      if (hk !== this.hintKey) {
        this.hintKey = hk;
        const P = window.GeoIDPad, gl = (n) => n.split(" ").map((x) => P.glyph(x)).join(""), kb = (t) => `<kbd>${t}</kbd>`;
        const rows = usePad
          ? [[gl("cross"), b.planning ? "Place blueprint" : "Place"], [gl("l1 r1"), "Rotate"], [gl("dpad"), b.planning ? "Menu · HALO-1 tab sends" : "Menu"], [gl("square"), "Hold: salvage"], [gl("l3"), "Undo"], [gl("l2 r2"), "Zoom"], [gl("circle"), "Leave"], [gl("triangle"), "Controls"]]
          : [[kb("Click"), b.planning ? "Place blueprint" : "Place"], [kb("Q") + kb("E"), "Rotate"], [kb("Tab") + kb("[") + kb("]"), "Menu"], ...(b.planning ? [[kb("G"), "Send plan"]] : []), [kb("X"), "Hold: salvage"], [kb("Z"), "Undo"], [kb("Right drag"), "Orbit"], [kb("T"), "Warp"], [kb("Esc"), "Leave"]];
        this.hintsEl.innerHTML = rows.map(([a, t]) => `<span>${a} ${t}</span>`).join("");
      }
    }
    if (this.screen && !this.screen.hidden) this._fillScreen();
  }

  /* ── the shell: pause-menu buttons, the settlement screen, settings, help ── */
  _shell() {
    const g = this.game, b = this.builder, resume = $("btn-resume"), menu = $("screen-menu");
    if (resume && menu) {
      const build = el("button", "btn", "Build mode"); build.type = "button"; build.id = "btn-build";
      const base = el("button", "btn", "Settlement"); base.type = "button"; base.id = "btn-base";
      resume.after(build, base);
      build.addEventListener("click", () => {
        if (g.mode !== "menu") return;
        menu.hidden = true;
        if (window.GeoIDPad) window.GeoIDPad.focus.clear();
        if (b.active) g.pause(false);
        else if (g._resumeMode === "driving" || !g._resumeMode) { if (!b.enter()) g.pause(false); }
        else { g.pause(false); g.hud.toast("Board the rover to build<small>build mode is run from the driver's seat</small>", 3.5); }
      });
      base.addEventListener("click", () => { menu.hidden = true; this.openScreen(); });
    }
    // the settlement screen
    const s = this.screen = el("section", "screen modal"); s.id = "screen-base"; s.hidden = true; s.setAttribute("data-pad-closable", "");
    s.innerHTML = `<div class="card wide base-card"><div class="bs-head"><div><div class="eyebrow">Settlement</div><h2 id="bs-name">No base yet</h2></div><div class="bs-rating"><b id="bs-score">0</b><span id="bs-rating">Camp</span></div></div>
      <div class="bs-cols"><div><div class="eyebrow">Resources</div><dl class="keys bs-res" id="bs-res"></dl><div class="eyebrow">Rating</div><div id="bs-bars" class="bs-bars"></div></div>
      <div><div class="eyebrow">Networks</div><div id="bs-map" class="bs-map"></div><div class="bs-legend"><span><i class="l-press"></i>Pressurised joint</span><span><i class="l-util"></i>Utility joint</span><span><i class="l-range"></i>In range (${RULES.utilityRange} m)</span><span><i class="l-off"></i>No power</span><span><i class="l-site"></i>Under construction</span></div>
      <div class="eyebrow">Alerts</div><ul id="bs-alerts" class="bs-alerts"></ul></div></div>
      <div class="row"><button type="button" id="btn-base-close" class="btn primary" data-pad-close>Back</button><button type="button" id="btn-base-build" class="btn">Build mode</button></div></div>`;
    document.body.appendChild(s);
    const close = () => { s.hidden = true; if (g.mode === "menu" && menu) { menu.hidden = false; const P = window.GeoIDPad; if (P && P.connected) setTimeout(() => { if (!menu.hidden) P.focus.first(menu); }, 60); } };
    s.querySelector("#btn-base-close").addEventListener("click", close);
    s.querySelector("#btn-base-build").addEventListener("click", () => { s.hidden = true; $("btn-build").click(); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !s.hidden) { e.stopPropagation(); close(); } }, true);
    g.on("mode", (mode) => { if (mode !== "menu") s.hidden = true; });

    // settings: sandbox
    const done = $("btn-settings-close");
    if (done) {
      const lab = el("label", "field check", `<input type="checkbox" id="set-sandbox"> Sandbox building (unlimited materials, instant build)`);
      done.before(lab);
      const box = lab.querySelector("input");
      box.checked = !!g.settings.sandbox;
      box.addEventListener("change", () => { g.settings.sandbox = box.checked; g.applySettings(); this.sys.net.sandbox = box.checked; this.acc = 1; });
    }
    // help: the Building maps beside the Driving ones
    const keys = $("help-keys"), padList = $("help-pad"), P = window.GeoIDPad;
    if (keys) keys.insertAdjacentHTML("beforeend", `<dt class="keys-head">Building</dt><dd></dd>` + BUILD_KEYS.map(([k, t]) => `<dt>${k}</dt><dd>${t}</dd>`).join(""));
    if (padList) padList.insertAdjacentHTML("beforeend", `<dt class="keys-head">Building</dt><dd></dd>` + BUILD_HELP.filter((e) => e.control).slice(0, 13).map((e) => `<dt>${P ? e.control.split(/\s+/).map((c) => P.glyph(c)).join(" ") : e.control}</dt><dd>${e.text}</dd>`).join(""));
  }
  openScreen() {
    this.screen.hidden = false;
    this._fillScreen();
    const P = window.GeoIDPad;
    if (P && P.connected) setTimeout(() => { if (!this.screen.hidden) P.focus.first(this.screen); }, 60);
  }
  _fillScreen() {
    const sys = this.sys, net = sys.net, base = sys.currentBase(), s = base ? sys.summary(base.id) : null, q = (id) => this.screen.querySelector("#" + id);
    if (!s) {
      q("bs-name").textContent = "No base yet"; q("bs-score").textContent = "0"; q("bs-rating").textContent = "";
      q("bs-res").innerHTML = `<dt>Materials</dt><dd>${net.sandbox ? "unlimited (sandbox)" : Math.floor(net.materials) + " brought by the lander"}</dd>`;
      q("bs-bars").innerHTML = ""; q("bs-alerts").innerHTML = "<li>Park on level ground and open build mode to found one.</li>";
      q("bs-map").innerHTML = "";
      return;
    }
    const P = s.power, sc = s.score, pct = (v) => Math.round(v * 100) + "%";
    q("bs-name").textContent = s.name + " base"; q("bs-score").textContent = sc.total; q("bs-rating").textContent = sc.rating;
    const rate = (v, unit) => (Math.abs(v) < 0.005 ? "steady" : signed(v, Math.abs(v) < 10 ? 1 : 0) + " " + unit + " per sol");
    const left = (stock, r) => (r < -0.005 ? `, ${(stock / -r).toFixed(1)} sols left` : "");
    q("bs-res").innerHTML = [
      ["Power", `${kW(P.gen_W)} from the Sun, ${kW(P.load_W)} load (${signed(P.net_W / 1000, 2)} kW)`],
      ["Storage", P.capacity_Wh > 0 ? `${(P.stored_Wh / 1000).toFixed(1)} of ${(P.capacity_Wh / 1000).toFixed(0)} kWh: ${hours(P.reserveNight_h)} of night load (${kW(P.nightLoad_W)}); the night is ${hours(P.nightLen_h)}` : "no battery bank"],
      ["Shedding", `comfort loads ${pct(P.comfort)}, industry ${pct(P.industry)}`],
      ["Oxygen", `${amount(s.o2.kg)} of ${amount(s.o2.cap)} kg, ${rate(s.o2.perSol, "kg")}${left(s.o2.kg, s.o2.perSol)}`],
      ["Water", `${amount(s.water.l)} of ${amount(s.water.cap)} L, ${rate(s.water.perSol, "L")}${left(s.water.l, s.water.perSol)}`],
      ["Food", `${amount(s.food.kg)} of ${amount(s.food.cap)} kg, ${rate(s.food.perSol, "kg")}${left(s.food.kg, s.food.perSol)}`],
      ...((s.crated && (s.crated.food + s.crated.water + s.crated.o2) > 0.5) ? [["Crated", `${amount(s.crated.food)} kg food, ${amount(s.crated.water)} L water, ${amount(s.crated.o2)} kg O₂ beside the stores (they go in as room appears)`]] : []),
      ...(this.builder.planning ? [["Spares", `${Math.round(s.spares || 0)}`], ["The plan", `${s.planned || 0} blueprints on the table, ${s.inbound || 0} in descent, ${s.atPod || 0} waiting at the pod`]] : []),
      ["Crew", `${s.crew.capacity} of ${s.crew.places} places habitable`],
      ["Materials", this.builder.planning ? "HALO-1's, unlimited: Contribution Credit is the limit" : s.materials.sandbox ? "unlimited (sandbox)" : `${Math.floor(s.materials.stock)} of ${s.materials.cap}, ${s.materials.perSol > 0 ? "+" + Math.round(s.materials.perSol) + " per sol" : "no ISRU output"}`],
      ["Modules", `${s.built} built` + (s.building ? `, ${s.building} under construction` : "") + (s.arrays ? `; arrays ${Math.round(s.dust * 100)}% dusty` : "")],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    const bar = (label, v) => `<div class="bs-bar"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i><em>${pct(v)}</em></div>`;
    q("bs-bars").innerHTML = `<div class="bs-group">Self-sufficiency <b>${pct(sc.selfSufficiency)}</b></div>` + bar("Power", sc.self.power) + bar("Air", sc.self.air) + bar("Water", sc.self.water) + bar("Food", sc.self.food)
      + `<div class="bs-group">Resilience <b>${pct(sc.resilienceScore)}</b></div>` + bar("Night reserve", sc.resilience.reserve) + bar("Redundancy", sc.resilience.redundancy) + bar("Shelter", sc.resilience.shelter)
      + `<div class="bs-group">Site <b>${pct(sc.siteScore)}</b></div>` + bar("Level ground", sc.site.slope) + bar("Open sky", sc.site.solar) + bar("Sheltered", sc.site.shelter);
    q("bs-alerts").innerHTML = s.alerts.length ? s.alerts.map((a) => `<li class="${a.level}">${a.text}</li>`).join("") : "<li>Nothing to report.</li>";
    q("bs-map").innerHTML = this.schematic(base.id);
  }

  /** The base from above, in its own frame: modules, joints and what is in range of what. */
  schematic(baseId) {
    const net = this.sys.net, T = net.topology(baseId), W = 440, H = 280;
    if (!T.mods.length) return "";
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const rects = T.mods.map((m) => {
      const fp = KIT[m.type].fp, hx = (m.r & 1 ? fp[1] : fp[0]) * 2, hz = (m.r & 1 ? fp[0] : fp[1]) * 2;
      x0 = Math.min(x0, m.lx - hx); x1 = Math.max(x1, m.lx + hx); z0 = Math.min(z0, m.lz - hz); z1 = Math.max(z1, m.lz + hz);
      return { m, hx, hz };
    });
    const k = Math.min((W - 24) / Math.max(8, x1 - x0), (H - 24) / Math.max(8, z1 - z0), 13), ox = W / 2 - (x0 + x1) / 2 * k, oz = H / 2 - (z0 + z1) / 2 * k;
    const X = (x) => (ox + x * k).toFixed(1), Z = (z) => (oz + z * k).toFixed(1), at = new Map(T.mods.map((m) => [m.id, m]));
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Base schematic">`;
    for (const l of T.links) { const a = at.get(l.a), b = at.get(l.b); if (!a || !b || l.kind === "stack") continue; out += `<line class="k-${l.kind}" x1="${X(a.lx)}" y1="${Z(a.lz)}" x2="${X(b.lx)}" y2="${Z(b.lz)}"/>`; }
    for (const { m, hx, hz } of rects.sort((a, b) => a.m.level - b.m.level)) {
      const B = MODULES[m.type], built = m.progress >= 1, cut = built && T.networkOf.get(m.id) !== T.main;
      const cls = "m c-" + B.cat + (built ? "" : " site") + (built && !m.st.on && B.power_w < 0 ? " off" : "") + (cut ? " cut" : "") + (m.level ? " up" : "");
      const pad = m.level ? 0.5 : 0.25;
      out += `<rect class="${cls}" x="${X(m.lx - hx + pad)}" y="${Z(m.lz - hz + pad)}" width="${((hx - pad) * 2 * k).toFixed(1)}" height="${((hz - pad) * 2 * k).toFixed(1)}" rx="2"/>`;
      if (k * Math.min(hx, hz) > 9 && ABBR[m.type]) out += `<text x="${X(m.lx)}" y="${(+Z(m.lz) + 3).toFixed(1)}">${ABBR[m.type]}</text>`;
    }
    return out + "</svg>";
  }
}

const ABBR = { hab_small: "HAB", hab_large: "HAB", hab_hdu: "HDU", node_hub: "HUB", corridor_straight: "", corridor_corner: "", airlock: "AL", solar_array: "PV", battery_bank: "BAT", greenhouse: "GH",
  isru_plant: "ISRU", water_tank: "H₂O", oxygen_tank: "O₂", storage_crate: "ST", garage: "GAR", landing_pad: "PAD", comms_tower: "COM", light_mast: "LT", regolith_berm: "" };
void CATEGORIES;
