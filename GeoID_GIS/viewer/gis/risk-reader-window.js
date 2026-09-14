/**
 * The risk reader window: every risk map on the globe, read for people as it is
 * developed.
 *
 * Nobody opens a tab to ask for this. Tick a cyclone risk map, run the
 * landslide forecast, build a flood sheet, switch on the volcanic buffers: the
 * reader sees a map it can read, finds the ground (the drawn study area, else
 * the map's own local extent), reads WorldPop under it, and adds the map as a
 * tab here with the full breakdown — levels, flood depths, wind, magnitude,
 * VEI, statistics, polygons, CSV and report. It re-reads a map when the map is
 * rebuilt (a flood sheet refining, a forecast stepping, another reading chosen)
 * and every map when the study area is redrawn.
 *
 * Three rules keep that from being a nuisance:
 *  - the window OPENS for a newly developed map and nothing else: an update
 *    re-reads in place, and a closed window stays closed until the next new map;
 *  - a map that is not a hazard (a DEM, soil thickness) is read only on request,
 *    from its layer drawer — banding an elevation by value unasked is noise;
 *  - one reading at a time, debounced, and WorldPop is read once per box.
 *
 * Doors: automatic, the Workspace header's shield, and "Risk to people" in any
 * readable layer's drawer. Hazards ▸ Exposure reads through the same engine.
 */

import { riskMapKind, riskMaps, assessLayer } from "./risk-reader.js?v=20260915-f3f8fff";
import { renderAssessment, annotationOf, el } from "./risk-reader-view.js?v=20260915-f3f8fff";
import { refreshPolygonOptions, promptDrawTool } from "./extent-picker.js?v=20260915-f3f8fff";
import { showAnnotation, removeAnnotation } from "./exposure-annotation.js?v=20260915-f3f8fff";
import { formatCount } from "./risk-assessment.js?v=20260915-f3f8fff";

const NOTE_ID = "risk-reader";
const POS_KEY = "geoid-gis:risk-reader-pos";
const byId = (id) => document.getElementById(id);

const tabs = new Map(); // layer name → tab
const state = { active: null, open: false, queue: [], running: false, areaChoice: "auto", timer: 0, areaTimer: 0 };

/* ── the reading loop ───────────────────────────────────────────────────── */

function layerOf(tab) {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  return layers.find((l) => String(l.id) === String(tab.layerId)) || layers.find((l) => l.name === tab.name);
}

/** What makes a map "rebuilt": a new layer object, a new band, another reading, a new step. */
function signatureOf(layer, kind) {
  const src = kind === "forecast" ? window.GeoIDLandslidePipeline?.exposureSource?.() : null;
  return [layer.id, layer.raster?.band?.length ?? "", (layer.features || layer.collection?.features || []).length,
    layer.riskView || layer.cycloneView || layer.activeView || "", src ? `${src.times.length}:${src.step()}` : ""].join("|");
}

function enqueue(tab) {
  if (!state.queue.includes(tab)) state.queue.push(tab);
  tab.busy = true;
  renderTabs();
  if (!state.running) void drain();
}

async function drain() {
  state.running = true;
  while (state.queue.length) {
    const tab = state.queue.shift();
    const layer = layerOf(tab);
    if (!layer) { tabs.delete(tab.name); continue; }
    try {
      if (tab === state.active) say(`Reading people under ${tab.name}…`);
      const first = !tab.assessment;
      const out = await assessLayer(layer, state.areaChoice);
      tab.assessment = out.assessment;
      tab.error = null;
      tab.layerId = layer.id;
      tab.signature = signatureOf(layer, tab.kind);
      if (first && tab.auto) {
        state.active = tab;
        open({ fromMap: true });
      }
    } catch (error) {
      tab.assessment = null;
      tab.error = error.message;
      // Not retried on every layer change: the next rebuild or a new area asks again.
      tab.signature = signatureOf(layer, tab.kind);
    } finally {
      tab.busy = false;
    }
    if (tab === state.active) { say(""); renderActive(); }
    renderTabs();
  }
  state.running = false;
}

/** The maps on the globe against the tabs held: new maps read, gone maps dropped, rebuilt maps re-read. */
function scan() {
  const maps = riskMaps();
  const names = new Set(maps.map((m) => m.layer.name));
  for (const [name, tab] of tabs) if (!names.has(name)) { tabs.delete(name); if (state.active === tab) state.active = null; }
  for (const m of maps) {
    let tab = tabs.get(m.layer.name);
    if (!tab) {
      if (!m.auto) continue;
      tab = { name: m.layer.name, layerId: m.layer.id, kind: m.kind, label: m.label, auto: true, assessment: null, error: null, busy: false, signature: "" };
      tabs.set(tab.name, tab);
      enqueue(tab);
      continue;
    }
    if (!tab.busy && signatureOf(m.layer, m.kind) !== tab.signature) enqueue(tab);
  }
  if (!state.active && tabs.size) state.active = tabs.values().next().value;
  renderTabs();
  updateLauncher();
}

function scheduleScan(ms = 900) {
  clearTimeout(state.timer);
  state.timer = setTimeout(scan, ms);
}

/** The study area moved: every tab reads again, once the drawing has settled. */
function areaChanged() {
  clearTimeout(state.areaTimer);
  state.areaTimer = setTimeout(() => { tabs.forEach((tab) => enqueue(tab)); }, 1500);
}

/* ── the window ─────────────────────────────────────────────────────────── */

function say(text) {
  const n = byId("risk-reader-status");
  if (n) n.textContent = text || "";
}

function build() {
  if (byId("risk-reader")) return byId("risk-reader");
  injectStyle();
  const win = el("section", { id: "risk-reader", class: "risk-reader", hidden: "", "aria-label": "Risk to people" });
  const head = el("header", { class: "risk-reader-head" },
    el("span", { class: "risk-reader-title" }, "Risk to people"),
    el("button", { type: "button", class: "risk-reader-icon", "data-act": "fold", title: "Fold the window" }, "▾"),
    el("button", { type: "button", class: "risk-reader-icon", "data-act": "close", title: "Close" }, "✕"));
  const tabRow = el("div", { id: "risk-reader-tabs", class: "risk-reader-tabs", role: "tablist" });
  const area = el("select", { id: "risk-reader-area", class: "input", "aria-label": "Study area" });
  area.append(el("option", { value: "auto" }, "Automatic — the drawn area, else the map's own"), el("option", { value: "drawn" }, "The drawn area"));
  const draw = el("button", { type: "button", class: "button secondary" }, "Draw");
  draw.title = "Draw a study area; every map is read again when it is done";
  draw.addEventListener("click", () => promptDrawTool());
  const again = el("button", { type: "button", class: "button secondary" }, "Read again");
  again.addEventListener("click", () => { if (state.active) enqueue(state.active); });
  const controls = el("div", { class: "risk-reader-controls" }, area, draw, again);
  const body = el("div", { class: "risk-reader-body" },
    el("p", { id: "risk-reader-status", class: "risk-reader-status", "aria-live": "polite" }),
    el("div", { id: "risk-reader-view" }));
  win.append(head, tabRow, controls, body);
  document.body.append(win);

  refreshPolygonOptions(area, "auto", { allLayers: true });
  area.addEventListener("focus", () => refreshPolygonOptions(area, area.value || "auto", { allLayers: true }));
  area.addEventListener("change", () => { state.areaChoice = area.value || "auto"; tabs.forEach((tab) => enqueue(tab)); });

  head.querySelector('[data-act="close"]').addEventListener("click", () => close());
  head.querySelector('[data-act="fold"]').addEventListener("click", () => {
    const folded = !win.classList.contains("is-folded");
    win.classList.toggle("is-folded", folded);
    head.querySelector('[data-act="fold"]').textContent = folded ? "▸" : "▾";
  });
  dragBy(win, head);
  return win;
}

function dragBy(win, handle) {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) place(win, saved.left, saved.top);
  } catch (e) { /* default place */ }
  let start = null;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = win.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!start) return;
    place(win, start.left + e.clientX - start.x, start.top + e.clientY - start.y);
  });
  const end = () => {
    if (!start) return;
    start = null;
    const r = win.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top })); } catch (e) { /* not kept */ }
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function place(win, left, top) {
  const w = win.offsetWidth || 340;
  const x = Math.max(8, Math.min(window.innerWidth - Math.min(w, window.innerWidth - 16) - 8, left));
  const y = Math.max(8, Math.min(window.innerHeight - 48, top));
  Object.assign(win.style, { left: `${x}px`, top: `${y}px`, right: "auto" });
}

function renderTabs() {
  const row = byId("risk-reader-tabs");
  if (!row) return;
  row.replaceChildren();
  for (const tab of tabs.values()) {
    const b0 = tab.assessment?.breakdowns[0];
    const chip = el("button", { type: "button", role: "tab", class: `risk-reader-tab${tab === state.active ? " is-active" : ""}${tab.error ? " is-error" : ""}`, "aria-selected": String(tab === state.active) },
      el("span", { class: "risk-reader-tab-name" }, tab.label || tab.name),
      el("b", {}, tab.busy ? "…" : b0 ? formatCount(b0.veryHighHigh) : tab.error ? "!" : "—"));
    chip.title = `${tab.name}${b0 ? ` — ${formatCount(b0.veryHighHigh)} people at very high or high, of ${formatCount(b0.total)}` : tab.error ? ` — ${tab.error}` : ""}`;
    chip.addEventListener("click", () => { state.active = tab; renderTabs(); renderActive(); });
    row.append(chip);
  }
  if (!tabs.size) row.append(el("span", { class: "risk-reader-empty" }, "No risk map on the globe yet."));
}

function renderActive() {
  const host = byId("risk-reader-view");
  if (!host) return;
  const tab = state.active;
  if (!tab) { host.replaceChildren(); removeAnnotation(NOTE_ID); return; }
  if (tab.assessment) {
    renderAssessment(host, tab.assessment, { say });
    const polys = tab.assessment.mapGroups?.[0]?.rings?.[0];
    if (polys && state.open) showAnnotation(NOTE_ID, { ring: polys, ...annotationOf(tab.assessment) });
  } else {
    host.replaceChildren(el("p", { class: "risk-reader-status" }, tab.busy ? `Reading ${tab.name}…` : tab.error || ""));
    if (/Draw a study area/.test(tab.error || "")) {
      const draw = el("button", { type: "button", class: "button" }, "Draw a study area");
      draw.addEventListener("click", () => promptDrawTool());
      host.append(draw);
    }
    removeAnnotation(NOTE_ID);
  }
}

export function open({ fromMap = false, layerId = null } = {}) {
  const win = build();
  if (layerId !== null) {
    const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => String(l.id) === String(layerId));
    const k = riskMapKind(layer);
    if (layer && k) {
      let tab = tabs.get(layer.name);
      if (!tab) {
        tab = { name: layer.name, layerId: layer.id, kind: k.kind, label: k.label, auto: k.auto, assessment: null, error: null, busy: false, signature: "" };
        tabs.set(tab.name, tab);
        enqueue(tab);
      }
      state.active = tab;
    }
  }
  if (fromMap && win.hidden === false) { renderTabs(); renderActive(); return; }
  win.hidden = false;
  state.open = true;
  renderTabs();
  renderActive();
  updateLauncher();
}

export function close() {
  const win = byId("risk-reader");
  if (win) win.hidden = true;
  state.open = false;
  removeAnnotation(NOTE_ID);
  updateLauncher();
}

/* ── the launcher, in the Workspace header ──────────────────────────────── */

const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6 5.4 6v5.4c0 4.2 2.8 7.6 6.6 9 3.8-1.4 6.6-4.8 6.6-9V6Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 8.2v4.6M12 15.6v.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

function installLauncher() {
  const row = document.querySelector("#layer-dock .layer-dock-head .gis-add-row-icons");
  if (!row) return false;
  if (row.querySelector(".gis-risk-button")) return true;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "button secondary gis-risk-button";
  b.title = "Risk to people — every risk map on the globe, read for people";
  b.setAttribute("aria-label", b.title);
  b.innerHTML = `${SHIELD}<span class="gis-risk-badge" hidden></span>`;
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (state.open) close(); else { scan(); open(); } });
  const settings = row.querySelector(".gis-settings-button");
  row.insertBefore(b, settings || null);
  updateLauncher();
  return true;
}

function updateLauncher() {
  const b = document.querySelector(".gis-risk-button");
  if (!b) return;
  b.classList.toggle("is-on", state.open);
  const badge = b.querySelector(".gis-risk-badge");
  if (badge) { badge.hidden = !tabs.size; badge.textContent = String(tabs.size); }
}

/* ── style ──────────────────────────────────────────────────────────────── */

const STYLE = `
#risk-reader { position: fixed; top: 7.5rem; right: 5.5rem; width: min(23rem, calc(100vw - 2rem)); max-height: calc(100vh - 10rem); z-index: 16; display: flex; flex-direction: column; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.45); border-radius: 0.7rem; background: rgb(16, 7, 36); background: var(--skin-tab-ground, rgb(16, 7, 36)); color: var(--text, #e8eaf2); box-shadow: 0 0 18px rgba(var(--nav-accent-rgb, 255, 43, 214), 0.22); font-family: 'Exo 2', system-ui, sans-serif; overflow: hidden; }
#risk-reader[hidden] { display: none !important; }
body.studio-open #risk-reader, body.research-open #risk-reader { display: none !important; }
#risk-reader .risk-reader-head { display: flex; align-items: center; gap: 0.35rem; padding: 0.45rem 0.55rem; cursor: move; background: linear-gradient(90deg, rgba(var(--nav-accent-rgb, 255, 43, 214), 0.32), rgba(var(--nav-accent-rgb, 255, 43, 214), 0.08)); touch-action: none; }
#risk-reader .risk-reader-title { flex: 1; font-size: 0.76rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }
#risk-reader .risk-reader-icon { width: 1.5rem; height: 1.5rem; padding: 0; border-radius: 0.3rem; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.45); background: transparent; color: inherit; cursor: pointer; }
#risk-reader .risk-reader-tabs { display: flex; flex-wrap: wrap; gap: 0.3rem; padding: 0.45rem 0.55rem 0; }
#risk-reader .risk-reader-tab { display: inline-flex; align-items: center; gap: 0.35rem; max-width: 100%; padding: 0.2rem 0.5rem; border-radius: 999px; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.4); background: transparent; color: inherit; font: inherit; font-size: 0.68rem; cursor: pointer; }
#risk-reader .risk-reader-tab.is-active { background: var(--nav-accent, #ff2bd6); color: #1a0520; }
#risk-reader .risk-reader-tab.is-error b { color: #ff8a80; }
#risk-reader .risk-reader-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 10rem; }
#risk-reader .risk-reader-tab b { font-variant-numeric: tabular-nums; }
#risk-reader .risk-reader-empty { font-size: 0.7rem; opacity: 0.7; }
#risk-reader .risk-reader-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0.3rem; padding: 0.45rem 0.55rem 0; }
#risk-reader .risk-reader-controls .input { min-width: 0; }
#risk-reader .risk-reader-body { overflow-y: auto; padding: 0.2rem 0.55rem 0.6rem; min-height: 0; }
#risk-reader .risk-reader-status { margin: 0.3rem 0 0; font-size: 0.7rem; opacity: 0.8; }
#risk-reader .risk-reader-status:empty { display: none; }
#risk-reader.is-folded .risk-reader-controls, #risk-reader.is-folded .risk-reader-body { display: none; }
.layer-dock-head .gis-risk-button { position: relative; }
.layer-dock-head .gis-risk-button.is-on { background: var(--nav-accent, #ff2bd6) !important; color: #1a0520 !important; }
.layer-dock-head .gis-risk-badge { position: absolute; top: -0.35rem; right: -0.35rem; min-width: 0.85rem; height: 0.85rem; padding: 0 0.15rem; border-radius: 999px; background: var(--nav-accent, #ff2bd6); color: #1a0520; font-size: 0.55rem; line-height: 0.85rem; font-weight: 700; text-align: center; }
.layer-dock-head .gis-risk-badge[hidden] { display: none; }
`;

function injectStyle() {
  if (byId("risk-reader-style")) return;
  const s = document.createElement("style");
  s.id = "risk-reader-style";
  s.textContent = STYLE;
  document.head.append(s);
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

function install() {
  injectStyle();
  const hookManager = () => {
    const im = window.GeoIDImportManager;
    if (!im?.onChange) return false;
    im.onChange(() => scheduleScan());
    return true;
  };
  let tries = 0;
  const wait = () => {
    const ok = hookManager();
    if (!ok && tries++ < 120) setTimeout(wait, 500);
  };
  wait();
  window.addEventListener("geoid-gis:layers-changed", () => scheduleScan());
  document.addEventListener("geoid-gis:sheet-built", () => scheduleScan(400));
  document.addEventListener("geoid-study-area-edited", areaChanged);
  // A forecast steps without any event: follow the time-lapse bar.
  setInterval(() => {
    for (const tab of tabs.values()) {
      if (tab.kind !== "forecast" || tab.busy) continue;
      const layer = layerOf(tab);
      if (layer && signatureOf(layer, tab.kind) !== tab.signature) enqueue(tab);
    }
  }, 700);
  let launcherTries = 0;
  const launcher = () => { if (!installLauncher() && launcherTries++ < 120) setTimeout(launcher, 500); };
  launcher();
  // The Workspace header is rebuilt with the dock; put the shield back.
  setInterval(installLauncher, 3000);
  window.GeoIDRiskReader = {
    open: (layerId) => { open({ layerId }); },
    close, scan, canRead: (layer) => Boolean(riskMapKind(layer)),
    tabs: () => [...tabs.values()].map((t) => ({ name: t.name, kind: t.kind, busy: t.busy, error: t.error, assessment: t.assessment })),
    active: () => state.active?.assessment || null,
  };
}

if (typeof document !== "undefined" && typeof window !== "undefined" && typeof window.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}
