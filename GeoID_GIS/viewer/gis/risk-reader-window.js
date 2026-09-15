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

import { riskMapKind, riskMaps, assessLayer, hazardKey, hazardTitle, readableMember, chooseFollowed, FOLLOW_REASONS, ringsBox } from "./risk-reader.js?v=20260915-c40de8b";
import { renderAssessment, annotationOf, el } from "./risk-reader-view.js?v=20260915-c40de8b";
import { refreshPolygonOptions, promptDrawTool } from "./extent-picker.js?v=20260915-c40de8b";
import { showAnnotation, removeAnnotation } from "./exposure-annotation.js?v=20260915-c40de8b";
import { formatCount } from "./risk-assessment.js?v=20260915-c40de8b";
import { visibleBounds, onViewSettled } from "./view-extent.js?v=20260915-c40de8b";

const NOTE_ID = "risk-reader";
const POS_KEY = "geoid-gis:risk-reader-pos";
const OPENED_KEY = "geoid-gis:risk-reader-opened";
/** How long something done to a map keeps the window on it before the camera decides again. */
const TOUCH_FRESH_MS = 90000;
const byId = (id) => document.getElementById(id);

const tabs = new Map(); // hazard key → tab
const state = {
  active: null, open: false, queue: [], running: false, areaChoice: "auto", timer: 0, areaTimer: 0,
  explicitKey: null, why: "", viewBox: null,
};

/* ── the maps, grouped into hazards ─────────────────────────────────────── */

/** The maps on the globe as hazards: key → the layers that carry it. */
function hazards() {
  const out = new Map();
  for (const m of riskMaps({ hidden: true })) {
    const key = hazardKey(m.layer);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(m);
  }
  return out;
}

const membersOf = (tab) => hazards().get(tab.key) || [];
const isHidden = (members) => !members.some((m) => m.visible);

/** The layer a tab reads: the one chosen in it, else the frame on screen, else a shown one. */
function memberFor(tab, members = membersOf(tab)) {
  return readableMember(members, tab.readFrom);
}

/**
 * WHAT A READING DEPENDS ON, in parts, so a change can say WHY it happened.
 * A new layer object is a rebuild (a sheet refining as the view settles); a
 * new view is the reader choosing another reading; a new band, frame or step
 * is the time-lapse moving. Only the last two are something somebody did.
 */
function partsOf(member, readFrom) {
  const layer = member.layer;
  const src = member.kind === "forecast" ? window.GeoIDLandslidePipeline?.exposureSource?.() : null;
  return {
    rebuilt: [layer.id, layer.raster?.band?.length ?? "", (layer.features || layer.collection?.features || []).length, readFrom].join("|"),
    view: String(layer.riskView || layer.cycloneView || layer.activeView || ""),
    frame: [layer.riskBand || "", layer.riskFrame?.label || "", src ? `${src.times.length}:${src.step()}` : ""].join("|"),
  };
}
const sameParts = (a, b) => a && b && a.rebuilt === b.rebuilt && a.view === b.view && a.frame === b.frame;

function newTab(key, members, { manual = false } = {}) {
  const lead = members[0];
  return {
    key, members, manual,
    title: hazardTitle(key, lead.layer, lead.label),
    auto: members.some((m) => m.auto),
    readFrom: "auto", touchedAt: 0, touchedHow: "",
    hidden: isHidden(members), stale: false,
    assessment: null, error: null, busy: false, parts: null, areaBox: null, readName: "",
  };
}

/* ── touching a map ─────────────────────────────────────────────────────── */

/**
 * SOMETHING WAS DONE TO THIS MAP. The window follows it: switching a layer on,
 * opening its Workspace row or its legend card, clicking one of its features,
 * choosing another reading of it, stepping its frame. A tab chosen by hand is
 * followed only until another map is touched — so a click here holds, and the
 * next thing done on the globe takes over again.
 */
function touch(tab, how) {
  if (!tab) return;
  tab.touchedAt = Date.now();
  tab.touchedHow = how;
  if (state.explicitKey && state.explicitKey !== tab.key) state.explicitKey = null;
  refollow();
}

function tabForLayer({ id = null, name = null } = {}) {
  for (const tab of tabs.values()) {
    if (tab.members.some((m) => (id !== null && id !== undefined && String(m.layer.id) === String(id)) || (name && m.layer.name === name))) return tab;
  }
  return null;
}

/* ── which tab to show ──────────────────────────────────────────────────── */

let THREE = null;
async function readView() {
  try {
    if (!THREE) THREE = await import("../vendor/three.module.js");
    const b = visibleBounds(window.GeoIDViewer, THREE);
    state.viewBox = b && [b.minLon, b.maxLon, b.minLat, b.maxLat].every(Number.isFinite)
      ? { west: b.minLon, east: b.maxLon, south: b.minLat, north: b.maxLat } : null;
  } catch (e) { state.viewBox = null; }
}

const orderOf = (tab) => Math.max(-Infinity, ...tab.members.filter((m) => m.visible).map((m) => Number(m.layer.object3D?.renderOrder) || 0));

/** Put the followed tab in front, unless the reader is looking at one they chose. */
function refollow() {
  const list = [...tabs.values()].map((t) => ({
    key: t.key, hidden: t.hidden, touchedAt: t.touchedAt, touchedHow: t.touchedHow,
    order: orderOf(t), areaBox: t.areaBox,
    severity: t.assessment?.breakdowns?.[0]?.total > 0 ? t.assessment.breakdowns[0].veryHighHigh / t.assessment.breakdowns[0].total : -1,
  }));
  const { tab: pick, why } = chooseFollowed(list, { explicitKey: state.explicitKey, viewBox: state.viewBox, now: Date.now(), freshMs: TOUCH_FRESH_MS });
  const next = pick ? tabs.get(pick.key) : null;
  const changed = next !== state.active || why !== state.why;
  state.active = next;
  state.why = why;
  if (changed) { renderTabs(); renderActive(); }
  else renderFollowing();
}

/* ── the reading loop ───────────────────────────────────────────────────── */

function enqueue(tab) {
  if (tab.hidden) { tab.stale = true; return; }
  if (!state.queue.includes(tab)) state.queue.push(tab);
  tab.busy = true;
  renderTabs();
  if (!state.running) void drain();
}

async function drain() {
  state.running = true;
  while (state.queue.length) {
    const tab = state.queue.shift();
    const members = membersOf(tab);
    const member = members.length ? memberFor(tab, members) : null;
    if (!member) { tabs.delete(tab.key); tab.busy = false; continue; }
    try {
      if (tab === state.active) say(`Reading people under ${tab.title}…`);
      const first = !tab.assessment && !tab.error;
      const out = await assessLayer(member.layer, state.areaChoice);
      tab.assessment = out.assessment;
      tab.areaBox = out.area?.polys?.length ? ringsBox(out.area.polys) : null;
      tab.error = null;
      tab.stale = false;
      tab.readName = member.layer.name;
      tab.parts = partsOf(member, tab.readFrom);
      if (first && tab.auto) arrived(tab);
    } catch (error) {
      tab.assessment = null;
      tab.error = error.message;
      // Not retried on every layer change: the next rebuild or a new area asks again.
      tab.parts = partsOf(member, tab.readFrom);
      tab.readName = member.layer.name;
    } finally {
      tab.busy = false;
    }
    if (tab === state.active) { say(""); renderActive(); }
    renderTabs();
    refollow();
  }
  state.running = false;
}

/**
 * A MAP WAS READ FOR THE FIRST TIME. The window opens by itself once a
 * session — the first time it has something to show — and after that a new
 * map adds its tab and nudges the shield, rather than jumping in front of
 * whatever is being worked on.
 */
function arrived(tab) {
  let opened = false;
  try { opened = sessionStorage.getItem(OPENED_KEY) === "1"; } catch (e) { opened = false; }
  if (!opened && !state.open) {
    try { sessionStorage.setItem(OPENED_KEY, "1"); } catch (e) { /* asks again next load */ }
    open({ fromMap: true });
  } else if (!state.open) {
    pulseLauncher();
  }
  refollow();
}

/** The maps on the globe against the tabs held. */
function scan() {
  const groups = hazards();
  for (const [key, tab] of tabs) {
    if (!groups.has(key)) { tabs.delete(key); state.queue = state.queue.filter((t) => t !== tab); if (state.explicitKey === key) state.explicitKey = null; }
  }
  for (const [key, members] of groups) {
    let tab = tabs.get(key);
    if (!tab) {
      if (!members.some((m) => m.auto)) continue;
      tab = newTab(key, members);
      tabs.set(key, tab);
      touch(tab, "new");
      enqueue(tab);
      continue;
    }
    const wasHidden = tab.hidden;
    tab.members = members;
    tab.auto = tab.auto || members.some((m) => m.auto);
    tab.hidden = isHidden(members);
    if (tab.readFrom !== "auto" && !members.some((m) => String(m.layer.id) === String(tab.readFrom))) tab.readFrom = "auto";
    if (wasHidden && !tab.hidden) {
      // Shown again: the reading was kept; only read again if something moved while it was off.
      touch(tab, "shown");
      if (tab.stale) enqueue(tab);
    }
    if (tab.hidden || tab.busy) continue;
    const parts = partsOf(memberFor(tab, members), tab.readFrom);
    if (sameParts(parts, tab.parts)) continue;
    if (tab.parts && parts.view !== tab.parts.view) touch(tab, "reading");
    else if (tab.parts && parts.frame !== tab.parts.frame) touch(tab, "frame");
    enqueue(tab);
  }
  refollow();
  // A tab that went grey or came back is not a change of follow: draw it anyway.
  renderTabs();
  renderFrom();
  updateLauncher();
}

function scheduleScan(ms = 900) {
  clearTimeout(state.timer);
  state.timer = setTimeout(scan, ms);
}

/** The study area moved: every shown tab reads again once the drawing has settled; hidden ones when shown. */
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
  const following = el("div", { id: "risk-reader-following", class: "risk-reader-following", "aria-live": "polite" });
  const from = el("label", { id: "risk-reader-from", class: "risk-reader-from", hidden: "" },
    el("span", {}, "Reading from"), el("select", { class: "input", "aria-label": "Which layer of this map is read" }));
  from.querySelector("select").addEventListener("change", (e) => {
    const tab = state.active;
    if (!tab) return;
    tab.readFrom = e.target.value || "auto";
    state.explicitKey = tab.key;
    enqueue(tab);
    renderFrom();
  });
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
  win.append(head, tabRow, following, from, controls, body);
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
    const cls = ["risk-reader-tab", tab === state.active && "is-active", tab.error && "is-error", tab.hidden && "is-hidden", tab.key === state.explicitKey && "is-pinned"].filter(Boolean).join(" ");
    const chip = el("button", { type: "button", role: "tab", class: cls, "aria-selected": String(tab === state.active) },
      el("span", { class: "risk-reader-tab-name" }, tab.title),
      el("b", {}, tab.busy ? "…" : b0 ? formatCount(b0.veryHighHigh) : tab.error ? "!" : "—"));
    const count = b0 ? ` — ${formatCount(b0.veryHighHigh)} people at very high or high, of ${formatCount(b0.total)}` : tab.error ? ` — ${tab.error}` : "";
    chip.title = `${tab.title}${count}${tab.hidden ? " (hidden on the globe; the reading is kept)" : ""}`;
    chip.addEventListener("click", () => {
      state.explicitKey = tab.key;
      refollow();
      renderTabs();
      renderActive();
    });
    row.append(chip);
  }
  if (!tabs.size) row.append(el("span", { class: "risk-reader-empty" }, "No risk map on the globe yet."));
}

/** "Following: Cyclone risk — 2005 · its frame stepped", and a way back to automatic. */
function renderFollowing() {
  const host = byId("risk-reader-following");
  if (!host) return;
  host.replaceChildren();
  const tab = state.active;
  if (!tab) return;
  const frame = tab.assessment?.frame;
  const pinned = state.why === "chosen";
  host.append(
    el("span", { class: "risk-reader-following-lead" }, pinned ? "Showing" : "Following"),
    el("span", { class: "risk-reader-following-name" }, `${tab.title}${frame ? ` — ${frame}` : ""}`),
    el("span", { class: "risk-reader-following-why" }, FOLLOW_REASONS[state.why] || ""));
  if (pinned && tabs.size > 1) {
    const back = el("button", { type: "button", class: "risk-reader-follow-back", title: "Go back to following whichever map is touched or on top" }, "Follow the globe");
    back.addEventListener("click", () => { state.explicitKey = null; refollow(); renderTabs(); });
    host.append(back);
  }
}

/** The chooser, only where a hazard is carried by more than one layer. */
function renderFrom() {
  const host = byId("risk-reader-from");
  if (!host) return;
  const tab = state.active;
  const members = tab ? tab.members : [];
  host.hidden = members.length < 2;
  if (host.hidden) return;
  const select = host.querySelector("select");
  select.replaceChildren(el("option", { value: "auto" }, "Automatic — the frame on screen"),
    ...members.map((m) => el("option", { value: String(m.layer.id) }, `${m.layer.name}${m.visible ? "" : " (hidden)"}`)));
  select.value = tab.readFrom;
  host.title = tab.readName ? `Last read from ${tab.readName}` : "";
}

function renderActive() {
  const host = byId("risk-reader-view");
  renderFollowing();
  renderFrom();
  if (!host) return;
  const tab = state.active;
  if (!tab) { host.replaceChildren(); removeAnnotation(NOTE_ID); return; }
  if (tab.assessment) {
    renderAssessment(host, tab.assessment, { say });
    if (tab.hidden) host.prepend(el("p", { class: "risk-reader-status risk-reader-kept" }, "This map is hidden on the globe. The reading is kept; switch it back on to follow it again."));
    const polys = tab.assessment.mapGroups?.[0]?.rings?.[0];
    if (polys && state.open && !tab.hidden) showAnnotation(NOTE_ID, { ring: polys, ...annotationOf(tab.assessment) });
    else removeAnnotation(NOTE_ID);
  } else {
    host.replaceChildren(el("p", { class: "risk-reader-status" }, tab.busy ? `Reading ${tab.title}…` : tab.hidden ? "Hidden on the globe; switch it on to read it." : tab.error || ""));
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
    if (layer && riskMapKind(layer)) {
      const key = hazardKey(layer);
      let tab = tabs.get(key);
      if (!tab) {
        tab = newTab(key, hazards().get(key) || [], { manual: true });
        tabs.set(key, tab);
        enqueue(tab);
      }
      touch(tab, "drawer");
    }
  }
  try { sessionStorage.setItem(OPENED_KEY, "1"); } catch (e) { /* not kept */ }
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

/** A map was read while the window is shut: say so on the shield, once, without opening anything. */
function pulseLauncher() {
  const b = document.querySelector(".gis-risk-button");
  if (!b) return;
  b.classList.remove("is-pulse");
  void b.offsetWidth;
  b.classList.add("is-pulse");
  setTimeout(() => b.classList.remove("is-pulse"), 2600);
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
#risk-reader .risk-reader-tab.is-hidden { opacity: 0.45; border-style: dashed; }
#risk-reader .risk-reader-tab.is-hidden.is-active { background: transparent; color: inherit; border-color: var(--nav-accent, #ff2bd6); }
#risk-reader .risk-reader-tab.is-pinned .risk-reader-tab-name::before { content: "\\2022"; margin-right: 0.3rem; }
#risk-reader .risk-reader-following { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem; padding: 0.4rem 0.55rem 0; font-size: 0.68rem; line-height: 1.3; }
#risk-reader .risk-reader-following:empty { display: none; }
#risk-reader .risk-reader-following-lead { text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; color: var(--skin-data, #52e4e8); }
#risk-reader .risk-reader-following-name { font-weight: 600; }
#risk-reader .risk-reader-following-why { opacity: 0.7; }
#risk-reader .risk-reader-following-why::before { content: "\\00b7"; margin-right: 0.3rem; }
#risk-reader .risk-reader-follow-back { margin-left: auto; padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px solid rgba(var(--skin-data-rgb, 82, 228, 232), 0.5); background: transparent; color: var(--skin-data, #52e4e8); font: inherit; font-size: 0.64rem; cursor: pointer; }
#risk-reader .risk-reader-from { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0.4rem; padding: 0.4rem 0.55rem 0; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em; }
#risk-reader .risk-reader-from[hidden] { display: none; }
#risk-reader .risk-reader-from .input { min-width: 0; text-transform: none; letter-spacing: 0; }
#risk-reader .risk-reader-kept { font-style: italic; }
#risk-reader .risk-reader-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 10rem; }
#risk-reader .risk-reader-tab b { font-variant-numeric: tabular-nums; }
#risk-reader .risk-reader-empty { font-size: 0.7rem; opacity: 0.7; }
#risk-reader .risk-reader-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 0.3rem; padding: 0.45rem 0.55rem 0; }
#risk-reader .risk-reader-controls .input { min-width: 0; }
#risk-reader .risk-reader-body { overflow-y: auto; padding: 0.2rem 0.55rem 0.6rem; min-height: 0; }
#risk-reader .risk-reader-status { margin: 0.3rem 0 0; font-size: 0.7rem; opacity: 0.8; }
#risk-reader .risk-reader-status:empty { display: none; }
#risk-reader.is-folded .risk-reader-controls, #risk-reader.is-folded .risk-reader-body, #risk-reader.is-folded .risk-reader-from { display: none; }
.layer-dock-head .gis-risk-button { position: relative; }
.layer-dock-head .gis-risk-button.is-on { background: var(--nav-accent, #ff2bd6) !important; color: #1a0520 !important; }
.layer-dock-head .gis-risk-badge { position: absolute; top: -0.35rem; right: -0.35rem; min-width: 0.85rem; height: 0.85rem; padding: 0 0.15rem; border-radius: 999px; background: var(--nav-accent, #ff2bd6); color: #1a0520; font-size: 0.55rem; line-height: 0.85rem; font-weight: 700; text-align: center; }
.layer-dock-head .gis-risk-badge[hidden] { display: none; }
.layer-dock-head .gis-risk-button.is-pulse { animation: gis-risk-pulse 0.8s ease-in-out 3; }
@keyframes gis-risk-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(var(--nav-accent-rgb, 255, 43, 214), 0); } 50% { box-shadow: 0 0 0 0.3rem rgba(var(--nav-accent-rgb, 255, 43, 214), 0.45); } }
@media (prefers-reduced-motion: reduce) { .layer-dock-head .gis-risk-button.is-pulse { animation: none; outline: 2px solid var(--nav-accent, #ff2bd6); } }
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

  // A time-lapse steps without announcing it, and a view is chosen in a
  // dialog that announces nothing either: follow both by looking.
  setInterval(() => {
    for (const tab of tabs.values()) {
      if (tab.busy || tab.hidden) continue;
      const member = memberFor(tab);
      if (!member) continue;
      const parts = partsOf(member, tab.readFrom);
      if (!tab.parts || sameParts(parts, tab.parts)) continue;
      if (parts.view !== tab.parts.view) touch(tab, "reading");
      else if (parts.frame !== tab.parts.frame) touch(tab, "frame");
      enqueue(tab);
    }
  }, 700);

  // Touches the page makes: a card on a feature, a Workspace row, a legend card.
  document.addEventListener("geoid-gis:layer-touched", (e) => touch(tabForLayer(e.detail || {}), e.detail?.how || "card"));
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element) || t.closest("#risk-reader")) return;
    const row = t.closest("#layer-dock [data-layer-id]");
    if (row) { touch(tabForLayer({ id: row.dataset.layerId }), "workspace"); return; }
    const card = t.closest("#map-legend-panel [data-legend-key]");
    if (card) touch(tabForLayer({ name: card.dataset.legendKey }), "legend");
  }, true);

  // Which map is on top in view moves with the camera.
  let settleTries = 0;
  const watchView = () => {
    if (!window.GeoIDViewer?.camera) { if (settleTries++ < 120) setTimeout(watchView, 500); return; }
    onViewSettled(window.GeoIDViewer, async () => {
      if (!tabs.size) return;
      await readView();
      refollow();
    }, { settleMs: 700 });
  };
  watchView();
  let launcherTries = 0;
  const launcher = () => { if (!installLauncher() && launcherTries++ < 120) setTimeout(launcher, 500); };
  launcher();
  // The Workspace header is rebuilt with the dock; put the shield back.
  setInterval(installLauncher, 3000);
  window.GeoIDRiskReader = {
    open: (layerId) => { open({ layerId }); },
    close, scan, canRead: (layer) => Boolean(riskMapKind(layer)),
    tabs: () => [...tabs.values()].map((t) => ({ key: t.key, title: t.title, members: t.members.map((m) => m.layer.name), readFrom: t.readFrom, readName: t.readName, hidden: t.hidden, busy: t.busy, error: t.error, frame: t.assessment?.frame || null, assessment: t.assessment })),
    active: () => state.active?.assessment || null,
    following: () => ({ key: state.active?.key || null, title: state.active?.title || null, why: state.why, pinned: state.explicitKey }),
  };
}

if (typeof document !== "undefined" && typeof window !== "undefined" && typeof window.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}
