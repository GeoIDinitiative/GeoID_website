/**
 * The risk reader window: people at risk in every study area, from every hazard
 * map over it.
 *
 * A study area is the question and the hazard maps are the evidence. Draw a
 * polygon over Naples, switch on the volcanic buffers, the flood inundation and
 * the sea level, and the window holds one TAB PER STUDY AREA and, inside it,
 * one ROW PER HAZARD MAP that reaches the area: the people living there, how
 * many are exposed and how many at very high or high. Open a row for the full
 * breakdown -- levels, depths, wind, magnitude, VEI, statistics, polygons, CSV
 * and report. A second study area is a second tab, never a replacement for the
 * first.
 *
 * Nobody asks for a reading. A map switched on, a sheet refining as the view
 * settles, a forecast stepping, a study area drawn or redrawn: each re-reads
 * the pairs it touches, one reading at a time, and WorldPop is read once per
 * area box. With no study area drawn the window reads the ground in view, so
 * the answer is never empty, and says to draw one.
 *
 * Doors: automatic (the window opens by itself once a session, then the
 * shield pulses), the Workspace header's shield, and Hazards ▸ Exposure.
 */

import { riskMaps, assessOver, hazardKey, hazardTitle, readableMember, chooseFollowed, ringsBox, studyAreas, coversBox, viewArea, riskMapKind } from "./risk-reader.js?v=20260919-fa12b59";
import { renderAssessment, annotationOf, el } from "./risk-reader-view.js?v=20260919-fa12b59";
import { promptDrawTool } from "./extent-picker.js?v=20260919-fa12b59";
import { showAnnotation, removeAnnotation } from "./exposure-annotation.js?v=20260919-fa12b59";
import { formatCount, formatNumber, LEVEL_COLOURS } from "./risk-assessment.js?v=20260919-fa12b59";
import { visibleBounds, onViewSettled } from "./view-extent.js?v=20260919-fa12b59";

const NOTE_ID = "risk-reader";
const POS_KEY = "geoid-gis:risk-reader-pos";
const OPENED_KEY = "geoid-gis:risk-reader-opened";
/** How long something done to an area keeps the window on it before the camera decides again. */
const TOUCH_FRESH_MS = 90000;
/** The id of the view, read only while no study area is drawn. */
const VIEW_ID = "view";
const byId = (id) => document.getElementById(id);

/** Why the window is showing an area, in words. */
const AREA_REASONS = {
  chosen: "chosen here",
  new: "just drawn",
  edited: "redrawn",
  workspace: "opened in Workspace",
  map: "a hazard map over it changed",
  top: "in view",
  severe: "the most people at risk",
  hidden: "",
  touched: "last touched",
};

const areas = new Map(); // study area id → area
const state = {
  activeId: null, why: "", explicitId: null, open: false,
  queue: [], running: false, timer: 0, editTimer: 0, viewBox: null, readOnce: false,
};

/* ── the hazard maps, grouped ───────────────────────────────────────────── */

/** The hazard maps on the globe: key → the layers that carry it. Only hazards: a DEM is not read here. */
function hazards() {
  const out = new Map();
  for (const m of riskMaps({ hidden: true })) {
    if (!m.auto) continue;
    const key = hazardKey(m.layer);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(m);
  }
  return out;
}

/**
 * WHAT A READING DEPENDS ON, in parts. A new layer object or band is a rebuild
 * (a sheet refining); a new view is another reading chosen; a new band, frame
 * or step is the time-lapse moving; a new outline is the area redrawn.
 */
function partsOf(member, area) {
  const layer = member.layer;
  const src = member.kind === "forecast" ? window.GeoIDLandslidePipeline?.exposureSource?.() : null;
  return [
    layer.id, layer.raster?.band?.length ?? "", (layer.features || layer.collection?.features || []).length,
    layer.riskView || layer.cycloneView || layer.activeView || "",
    layer.riskBand || "", layer.riskFrame?.label || "", src ? `${src.times.length}:${src.step()}` : "",
    layer.legendInfo?.label || "", layer.legendInfo?.max ?? "",
    area.shape,
  ].join("|");
}

const shapeOf = (a) => a.polys.map((p) => p.coords[0].length + ":" + ["west", "east", "south", "north"].map((k) => p.box[k].toFixed(5)).join(",")).join(";");

/* ── the areas ──────────────────────────────────────────────────────────── */

function newArea(src) {
  return { ...src, shape: shapeOf(src), readings: new Map(), openKey: null, touchedAt: 0, touchedHow: "" };
}

function newReading(key, members) {
  const lead = members[0];
  return {
    key, members, title: hazardTitle(key, lead.layer, lead.label),
    hidden: !members.some((m) => m.visible), covers: true,
    assessment: null, error: null, busy: false, parts: null, touchedAt: 0,
  };
}

/** Something was done to this area: drawn, redrawn, its Workspace row opened, a map over it changed. */
function touchArea(area, how) {
  if (!area) return;
  area.touchedAt = Date.now();
  area.touchedHow = how;
  if (state.explicitId && state.explicitId !== area.id) state.explicitId = null;
}

/**
 * A hazard map was touched: open its row in every area it reaches. When the
 * area on screen is not one of them, show the first that is -- a touch that
 * changes nothing a reader can see reads as a map with no reading.
 */
function touchMap({ id = null, name = null } = {}) {
  const hits = [];
  for (const area of areas.values()) {
    for (const r of area.readings.values()) {
      if (r.members.some((m) => (id !== null && id !== undefined && String(m.layer.id) === String(id)) || (name && m.layer.name === name))) {
        area.openKey = r.key;
        r.touchedAt = Date.now();
        if (!hits.includes(area)) hits.push(area);
      }
    }
  }
  if (!hits.length) return;
  if (!hits.some((a) => a.id === state.activeId)) touchArea(hits[0], "touched");
  refollow();
  render();
}

/** The area a Workspace row belongs to, when the row is a study area. */
function areaForLayer(id) {
  return areas.get(`layer:${id}`) || null;
}

/* ── which area to show ─────────────────────────────────────────────────── */

let THREE = null;
async function readView() {
  try {
    if (!THREE) THREE = await import("../vendor/three.module.js");
    const b = visibleBounds(window.GeoIDViewer, THREE);
    state.viewBox = b && [b.minLon, b.maxLon, b.minLat, b.maxLat].every(Number.isFinite)
      ? { west: b.minLon, east: b.maxLon, south: b.minLat, north: b.maxLat } : null;
  } catch (e) { state.viewBox = null; }
}

/** The worst share at very high or high over an area's hazard maps. */
function severityOf(area) {
  let worst = -1;
  for (const r of area.readings.values()) {
    const b = r.assessment?.breakdowns?.[0];
    if (b?.total > 0) worst = Math.max(worst, b.veryHighHigh / b.total);
  }
  return worst;
}

/** The same rule the reader has always followed, with study areas as the tabs. */
function refollow() {
  const list = [...areas.values()].map((a) => ({
    key: a.id, hidden: false, touchedAt: a.touchedAt, touchedHow: a.touchedHow,
    order: 0, areaBox: a.box, severity: severityOf(a),
  }));
  const { tab, why } = chooseFollowed(list, { explicitKey: state.explicitId, viewBox: state.viewBox, now: Date.now(), freshMs: TOUCH_FRESH_MS });
  const next = tab ? tab.key : null;
  const changed = next !== state.activeId || why !== state.why;
  state.activeId = next;
  state.why = why;
  return changed;
}

/* ── the reading loop ───────────────────────────────────────────────────── */

function enqueue(area, reading) {
  if (reading.hidden) { reading.stale = true; return; }
  if (!state.queue.some((j) => j.areaId === area.id && j.key === reading.key)) state.queue.push({ areaId: area.id, key: reading.key });
  reading.busy = true;
  if (!state.running) void drain();
}

async function drain() {
  state.running = true;
  while (state.queue.length) {
    const { areaId, key } = state.queue.shift();
    const area = areas.get(areaId);
    const reading = area?.readings.get(key);
    if (!reading) continue;
    const members = hazards().get(key) || [];
    const member = members.length ? readableMember(members) : null;
    if (!member) { area.readings.delete(key); continue; }
    if (area.id === state.activeId) say(`Reading ${reading.title} over ${area.name}…`);
    const first = !reading.assessment && !reading.error;
    try {
      const out = await assessOver(member.layer, { label: area.name, polys: area.polys });
      reading.assessment = out.assessment;
      reading.error = null;
      reading.stale = false;
      reading.parts = partsOf(member, area);
      if (first) arrived();
    } catch (error) {
      reading.assessment = null;
      reading.error = error.message;
      // Not retried on every change: the next rebuild or redraw asks again.
      reading.parts = partsOf(member, area);
    } finally {
      reading.busy = false;
    }
    if (area.id === state.activeId) say("");
    refollow();
    render();
  }
  state.running = false;
}

/**
 * SOMETHING WAS READ. The window opens by itself once a session, the first
 * time it has an answer; after that a new reading nudges the shield rather
 * than jumping in front of whatever is being worked on.
 */
function arrived() {
  if (state.readOnce) { if (!state.open) pulseLauncher(); return; }
  state.readOnce = true;
  let opened = false;
  try { opened = sessionStorage.getItem(OPENED_KEY) === "1"; } catch (e) { opened = false; }
  if (!opened && !state.open) {
    try { sessionStorage.setItem(OPENED_KEY, "1"); } catch (e) { /* asks again next load */ }
    open();
  } else if (!state.open) {
    pulseLauncher();
  }
}

/**
 * THE AREAS ON THE GLOBE against the hazard maps on it. Every pair where the
 * map reaches the area is read; a pair is read again when the map is rebuilt,
 * steps a frame, or the area is redrawn. A map that has moved away from an
 * area (a sheet rebuilt over another view) keeps its last reading, marked.
 */
function scan() {
  let list = studyAreas();
  if (!list.length) {
    const v = viewArea(state.viewBox);
    list = v ? [{ id: VIEW_ID, name: "The ground in view", layerId: null, polys: v.polys, box: ringsBox(v.polys), fromView: true }] : [];
  }
  const ids = new Set(list.map((a) => a.id));
  for (const id of [...areas.keys()]) {
    if (!ids.has(id)) {
      areas.delete(id);
      state.queue = state.queue.filter((j) => j.areaId !== id);
      if (state.explicitId === id) state.explicitId = null;
    }
  }
  const groups = hazards();
  for (const src of list) {
    let area = areas.get(src.id);
    if (!area) {
      area = newArea(src);
      areas.set(src.id, area);
      if (src.id !== VIEW_ID) touchArea(area, "new");
    } else {
      const shape = shapeOf(src);
      if (shape !== area.shape) {
        Object.assign(area, { polys: src.polys, box: src.box, name: src.name, shape });
        if (src.id !== VIEW_ID) touchArea(area, "edited");
      } else area.name = src.name;
    }
    for (const key of [...area.readings.keys()]) if (!groups.has(key)) area.readings.delete(key);
    for (const [key, members] of groups) {
      const member = readableMember(members);
      const covers = Boolean(member) && coversBox(member, area.box);
      let reading = area.readings.get(key);
      if (!reading) {
        if (!covers) continue;
        reading = newReading(key, members);
        area.readings.set(key, reading);
        if (area.id !== VIEW_ID) touchArea(area, "map");
        enqueue(area, reading);
        continue;
      }
      const wasHidden = reading.hidden;
      reading.members = members;
      reading.hidden = !members.some((m) => m.visible);
      reading.covers = covers;
      if (reading.hidden || reading.busy) continue;
      if (!covers) continue; // kept from when the map reached this area
      if ((wasHidden && reading.stale) || partsOf(member, area) !== reading.parts) enqueue(area, reading);
    }
  }
  refollow();
  render();
  updateLauncher();
}

function scheduleScan(ms = 900) {
  clearTimeout(state.timer);
  state.timer = setTimeout(scan, ms);
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
  const tabRow = el("div", { id: "risk-reader-tabs", class: "risk-reader-tabs", role: "tablist", "aria-label": "Study areas" });
  const summary = el("div", { id: "risk-reader-summary", class: "risk-reader-summary", "aria-live": "polite" });
  const draw = el("button", { type: "button", class: "button secondary" }, "Draw a study area");
  draw.title = "Draw a polygon on the globe; every hazard map over it is read for people";
  draw.addEventListener("click", () => promptDrawTool());
  const again = el("button", { type: "button", class: "button secondary" }, "Read again");
  again.title = "Read every hazard map over this study area again";
  again.addEventListener("click", () => {
    const area = areas.get(state.activeId);
    if (area) area.readings.forEach((r) => enqueue(area, r));
    render();
  });
  const controls = el("div", { class: "risk-reader-controls" }, draw, again);
  const body = el("div", { class: "risk-reader-body" },
    el("p", { id: "risk-reader-status", class: "risk-reader-status", "aria-live": "polite" }),
    el("div", { id: "risk-reader-rows" }),
    el("div", { id: "risk-reader-view" }));
  win.append(head, tabRow, summary, controls, body);
  document.body.append(win);

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

/** The readings of an area that put somebody at risk, worst first. */
function ranked(area) {
  return [...area.readings.values()].sort((a, b) => {
    const x = a.assessment?.breakdowns?.[0]; const y = b.assessment?.breakdowns?.[0];
    return (y?.veryHighHigh ?? -1) - (x?.veryHighHigh ?? -1) || (y?.exposed ?? -1) - (x?.exposed ?? -1) || a.title.localeCompare(b.title);
  });
}

const exposedIn = (area) => [...area.readings.values()].filter((r) => (r.assessment?.breakdowns?.[0]?.exposed ?? 0) >= 0.5).length;
const busyIn = (area) => [...area.readings.values()].some((r) => r.busy);

function renderTabs() {
  const row = byId("risk-reader-tabs");
  if (!row) return;
  row.replaceChildren();
  for (const area of areas.values()) {
    const n = exposedIn(area);
    const cls = ["risk-reader-tab", area.id === state.activeId && "is-active", area.id === state.explicitId && "is-pinned", area.id === VIEW_ID && "is-view"].filter(Boolean).join(" ");
    const chip = el("button", { type: "button", role: "tab", class: cls, "aria-selected": String(area.id === state.activeId) },
      el("span", { class: "risk-reader-tab-name" }, area.name),
      el("b", {}, busyIn(area) ? "…" : String(n)));
    chip.title = `${area.name} — ${n} hazard map${n === 1 ? "" : "s"} with people exposed, of ${area.readings.size} over it`;
    chip.addEventListener("click", () => {
      state.explicitId = area.id;
      refollow();
      render();
    });
    row.append(chip);
  }
}

function renderSummary(area) {
  const host = byId("risk-reader-summary");
  if (!host) return;
  host.replaceChildren();
  if (!area) return;
  const first = [...area.readings.values()].map((r) => r.assessment?.breakdowns?.[0]).find(Boolean);
  const bits = [];
  if (first) bits.push(`${formatCount(first.total)} people`, `${formatNumber(first.areaKm2 + (first.noReadingAreaKm2 || 0), 100)} km²`);
  bits.push(`${area.readings.size} hazard map${area.readings.size === 1 ? "" : "s"} over it`);
  host.append(
    el("span", { class: "risk-reader-summary-name" }, area.name),
    el("span", { class: "risk-reader-summary-facts" }, bits.join(" · ")),
    state.why && AREA_REASONS[state.why] ? el("span", { class: "risk-reader-summary-why" }, AREA_REASONS[state.why]) : "");
  if (state.why === "chosen" && areas.size > 1) {
    const back = el("button", { type: "button", class: "risk-reader-follow-back", title: "Go back to following the study area drawn, touched or in view" }, "Follow the globe");
    back.addEventListener("click", () => { state.explicitId = null; refollow(); render(); });
    host.append(back);
  }
}

/** A row per hazard map over the area: exposed, and at very high or high. */
function renderRows(area) {
  const host = byId("risk-reader-rows");
  if (!host) return null;
  host.replaceChildren();
  if (!area) return null;
  const rows = ranked(area);
  const quiet = rows.filter((r) => r.assessment && (r.assessment.breakdowns[0].exposed ?? 0) < 0.5 && !r.busy && !r.hidden);
  const loud = rows.filter((r) => !quiet.includes(r));
  // The row open below: the one chosen, else the one touched, else the worst.
  if (!area.openKey || !area.readings.has(area.openKey)) area.openKey = (loud[0] || quiet[0])?.key || null;
  if (!loud.length && !quiet.length) return null;
  if (!loud.length) {
    host.append(el("p", { class: "risk-reader-quiet" }, `Nobody exposed here on ${quiet.map((r) => r.title).join(", ")}.`));
    return area.readings.get(area.openKey) || null;
  }
  const table = el("table", { class: "risk-reader-list" });
  table.append(el("thead", {}, el("tr", {}, el("th", {}, "Hazard map"), el("th", { class: "n" }, "Exposed"), el("th", { class: "n" }, "V.high+high"))));
  const tbody = el("tbody");
  for (const r of loud) {
    const b = r.assessment?.breakdowns?.[0];
    const worst = b?.byClass?.find((c) => c.people >= 0.5 && c.level);
    const sw = el("span", { class: "risk-reader-sw" });
    sw.style.background = worst ? LEVEL_COLOURS[worst.level] : "transparent";
    const note = r.busy ? "reading…" : r.hidden ? "hidden on the globe; kept" : !r.covers && b ? "kept — the map has moved off this area" : r.error || "";
    const tr = el("tr", { class: ["risk-reader-row", r.key === area.openKey && "is-open", r.hidden && "is-hidden", r.error && "is-error"].filter(Boolean).join(" "), tabindex: "0", role: "button", "aria-expanded": String(r.key === area.openKey) },
      el("td", {}, sw, el("span", { class: "risk-reader-row-name" }, r.title), note ? el("small", {}, note) : ""),
      el("td", { class: "n" }, b ? formatCount(b.exposed) : "—"),
      el("td", { class: "n" }, b ? formatCount(b.veryHighHigh) : "—"));
    const choose = () => { area.openKey = r.key; render(); };
    tr.addEventListener("click", choose);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
    tbody.append(tr);
  }
  table.append(tbody);
  host.append(table);
  if (quiet.length) host.append(el("p", { class: "risk-reader-quiet" }, `Nobody exposed here on ${quiet.map((r) => r.title).join(", ")}.`));
  return area.readings.get(area.openKey) || null;
}

function renderEmpty(host) {
  const draw = el("button", { type: "button", class: "button" }, "Draw a study area");
  draw.addEventListener("click", () => promptDrawTool());
  if (!areas.size) {
    host.append(
      el("p", { class: "risk-reader-status" }, "Draw a study area over a hazard map to see who lives in harm's way."),
      el("p", { class: "risk-reader-status" }, "Every hazard map that reaches it is read for people: volcanic hazards, flood inundation, sea level, cyclone, seismic and landslide."),
      draw);
    return;
  }
  const area = areas.get(state.activeId) || [...areas.values()][0];
  const onGlobe = hazards().size;
  host.append(el("p", { class: "risk-reader-status" }, onGlobe
    ? `None of the hazard maps on the globe reaches ${area.name}. A map built over the view reaches only what is in view: bring the area into view, or switch on a map that covers it.`
    : `No hazard map is on the globe yet. Switch one on over ${area.name} — Hazards ▸ Volcanic hazards, Inundation, Sea level, Cyclone, Seismic or Landslide — and it is read here for people.`));
  if (area.id === VIEW_ID) host.append(el("p", { class: "risk-reader-status" }, "Reading the ground in view because no study area is drawn."), draw);
}

function render() {
  renderTabs();
  const area = areas.get(state.activeId) || null;
  renderSummary(area);
  const open = renderRows(area);
  const host = byId("risk-reader-view");
  if (!host) { updateLauncher(); return; }
  host.replaceChildren();
  if (!open) {
    removeAnnotation(NOTE_ID);
    renderEmpty(host);
    updateLauncher();
    return;
  }
  if (open.assessment) {
    renderAssessment(host, open.assessment, { say, compact: true });
    if (area.id === VIEW_ID) host.prepend(el("p", { class: "risk-reader-status risk-reader-kept" }, "Read over the ground in view because no study area is drawn. Draw one to read your own."));
    const ring = open.assessment.mapGroups?.[0]?.rings?.[0];
    if (ring && state.open && !open.hidden) showAnnotation(NOTE_ID, { ring, ...annotationOf(open.assessment) });
    else removeAnnotation(NOTE_ID);
  } else {
    host.append(el("p", { class: "risk-reader-status" }, open.busy ? `Reading ${open.title} over ${area.name}…` : open.hidden ? "Hidden on the globe; switch it on to read it." : open.error || ""));
    removeAnnotation(NOTE_ID);
  }
  updateLauncher();
}

export function open({ layerId = null } = {}) {
  const win = build();
  if (layerId !== null && layerId !== undefined) {
    const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => String(l.id) === String(layerId));
    if (layer && riskMapKind(layer)) touchMap({ id: layer.id });
  }
  try { sessionStorage.setItem(OPENED_KEY, "1"); } catch (e) { /* not kept */ }
  win.hidden = false;
  state.open = true;
  render();
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
  b.title = "Risk to people — every study area, read against every hazard map over it";
  b.setAttribute("aria-label", b.title);
  b.innerHTML = `${SHIELD}<span class="gis-risk-badge" hidden></span>`;
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (state.open) close(); else { scan(); open(); } });
  const settings = row.querySelector(".gis-settings-button");
  row.insertBefore(b, settings || null);
  updateLauncher();
  return true;
}

/** A reading arrived while the window is shut: say so on the shield, once, without opening anything. */
function pulseLauncher() {
  const b = document.querySelector(".gis-risk-button");
  if (!b) return;
  b.classList.remove("is-pulse");
  void b.offsetWidth;
  b.classList.add("is-pulse");
  setTimeout(() => b.classList.remove("is-pulse"), 2600);
}

/** The badge counts study areas with somebody exposed in them. */
function updateLauncher() {
  const b = document.querySelector(".gis-risk-button");
  if (!b) return;
  b.classList.toggle("is-on", state.open);
  const n = [...areas.values()].filter((a) => a.id !== VIEW_ID && exposedIn(a) > 0).length;
  const badge = b.querySelector(".gis-risk-badge");
  if (badge) { badge.hidden = !n; badge.textContent = String(n); }
}

/* ── style ──────────────────────────────────────────────────────────────── */

const STYLE = `
#risk-reader { position: fixed; top: 7.5rem; right: 5.5rem; width: min(24rem, calc(100vw - 2rem)); max-height: calc(100vh - 10rem); z-index: 16; display: flex; flex-direction: column; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.45); border-radius: 0.7rem; background: rgb(16, 7, 36); background: var(--skin-tab-ground, rgb(16, 7, 36)); color: var(--text, #e8eaf2); box-shadow: 0 0 18px rgba(var(--nav-accent-rgb, 255, 43, 214), 0.22); font-family: var(--skin-body, 'Exo 2', system-ui, sans-serif); overflow: hidden; }
#risk-reader[hidden] { display: none !important; }
body.studio-open #risk-reader, body.research-open #risk-reader { display: none !important; }
#risk-reader .risk-reader-head { display: flex; align-items: center; gap: 0.35rem; padding: 0.45rem 0.55rem; cursor: move; background: linear-gradient(90deg, rgba(var(--nav-accent-rgb, 255, 43, 214), 0.32), rgba(var(--nav-accent-rgb, 255, 43, 214), 0.08)); touch-action: none; }
#risk-reader .risk-reader-title { flex: 1; font-size: 0.76rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }
#risk-reader .risk-reader-icon { width: 1.5rem; height: 1.5rem; padding: 0; border-radius: 0.3rem; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.45); background: transparent; color: inherit; cursor: pointer; }
#risk-reader .risk-reader-tabs { display: flex; flex-wrap: wrap; gap: 0.3rem; padding: 0.45rem 0.55rem 0; }
#risk-reader .risk-reader-tabs:empty { display: none; }
#risk-reader .risk-reader-tab { display: inline-flex; align-items: center; gap: 0.35rem; max-width: 100%; padding: 0.2rem 0.5rem; border-radius: 999px; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.4); background: transparent; color: inherit; font: inherit; font-size: 0.68rem; cursor: pointer; }
#risk-reader .risk-reader-tab.is-active { background: var(--nav-accent, #ff2bd6); color: #1a0520; }
#risk-reader .risk-reader-tab.is-view { border-style: dashed; }
#risk-reader .risk-reader-tab.is-pinned .risk-reader-tab-name::before { content: "\\2022"; margin-right: 0.3rem; }
#risk-reader .risk-reader-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 12rem; }
#risk-reader .risk-reader-tab b { font-variant-numeric: tabular-nums; }
#risk-reader .risk-reader-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.2rem 0.45rem; padding: 0.45rem 0.55rem 0; font-size: 0.7rem; line-height: 1.3; }
#risk-reader .risk-reader-summary:empty { display: none; }
#risk-reader .risk-reader-summary-name { font-weight: 700; }
#risk-reader .risk-reader-summary-facts { opacity: 0.8; font-variant-numeric: tabular-nums; }
#risk-reader .risk-reader-summary-why { color: var(--skin-data, #52e4e8); }
#risk-reader .risk-reader-summary-why::before { content: "\\00b7"; margin-right: 0.3rem; color: var(--text, #e8eaf2); opacity: 0.6; }
#risk-reader .risk-reader-follow-back { margin-left: auto; padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px solid rgba(var(--skin-data-rgb, 82, 228, 232), 0.5); background: transparent; color: var(--skin-data, #52e4e8); font: inherit; font-size: 0.64rem; cursor: pointer; }
#risk-reader .risk-reader-controls { display: flex; gap: 0.3rem; padding: 0.45rem 0.55rem 0; }
#risk-reader .risk-reader-controls .button { flex: 1; }
#risk-reader .risk-reader-body { overflow-y: auto; padding: 0.2rem 0.55rem 0.6rem; min-height: 0; }
#risk-reader .risk-reader-status { margin: 0.35rem 0 0; font-size: 0.72rem; line-height: 1.4; opacity: 0.85; }
#risk-reader .risk-reader-status:empty { display: none; }
#risk-reader .risk-reader-body > div > .button { margin-top: 0.45rem; }
#risk-reader .risk-reader-kept { font-style: italic; }
#risk-reader .risk-reader-list { width: 100%; border-collapse: collapse; font-size: 0.72rem; margin: 0.35rem 0 0; }
#risk-reader .risk-reader-list th { text-align: left; font-weight: 600; opacity: 0.75; border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding: 0.15rem 0.25rem; }
#risk-reader .risk-reader-list td { padding: 0.25rem; border-bottom: 1px solid rgba(255, 255, 255, 0.06); vertical-align: top; }
#risk-reader .risk-reader-list .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
#risk-reader .risk-reader-row { cursor: pointer; }
#risk-reader .risk-reader-row:hover td, #risk-reader .risk-reader-row:focus-visible td { background: rgba(var(--nav-accent-rgb, 255, 43, 214), 0.1); }
#risk-reader .risk-reader-row:focus-visible { outline: 1px solid var(--nav-accent, #ff2bd6); }
#risk-reader .risk-reader-row.is-open td { background: rgba(var(--nav-accent-rgb, 255, 43, 214), 0.18); }
#risk-reader .risk-reader-row.is-open td:first-child { box-shadow: inset 3px 0 0 var(--nav-accent, #ff2bd6); }
#risk-reader .risk-reader-row.is-hidden td { opacity: 0.55; }
#risk-reader .risk-reader-row small { display: block; font-size: 0.62rem; opacity: 0.7; }
#risk-reader .risk-reader-row.is-error small { color: #ff8a80; opacity: 1; }
#risk-reader .risk-reader-row-name { font-weight: 600; }
#risk-reader .risk-reader-sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 0.35rem; vertical-align: -1px; border: 1px solid rgba(255, 255, 255, 0.35); }
#risk-reader .risk-reader-quiet { margin: 0.35rem 0 0; font-size: 0.66rem; opacity: 0.65; }
#risk-reader #risk-reader-view { margin-top: 0.45rem; border-top: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.25); }
#risk-reader #risk-reader-view:empty { border-top: 0; margin-top: 0; }
#risk-reader.is-folded .risk-reader-controls, #risk-reader.is-folded .risk-reader-body { display: none; }
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
  // A drag announces on every pointermove: read the redrawn area once it has settled.
  document.addEventListener("geoid-study-area-edited", () => { clearTimeout(state.editTimer); state.editTimer = setTimeout(scan, 1500); });

  // A time-lapse steps without announcing it, and a reading is chosen in a
  // dialog that announces nothing either: follow both by looking.
  setInterval(() => {
    if (state.running || !areas.size) return;
    const groups = hazards();
    for (const area of areas.values()) {
      for (const r of area.readings.values()) {
        if (r.busy || r.hidden || !r.parts || !r.covers) continue;
        const member = readableMember(groups.get(r.key) || []);
        if (member && partsOf(member, area) !== r.parts) { r.touchedAt = Date.now(); enqueue(area, r); }
      }
    }
  }, 700);

  // Touches the page makes: a card on a feature, a Workspace row, a legend card.
  document.addEventListener("geoid-gis:layer-touched", (e) => touchMap(e.detail || {}));
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element) || t.closest("#risk-reader")) return;
    const row = t.closest("#layer-dock [data-layer-id]");
    if (row) {
      const area = areaForLayer(row.dataset.layerId);
      if (area) { touchArea(area, "workspace"); refollow(); render(); }
      else touchMap({ id: row.dataset.layerId });
      return;
    }
    const card = t.closest("#map-legend-panel [data-legend-key]");
    if (card) touchMap({ name: card.dataset.legendKey });
  }, true);

  // Which area is in view moves with the camera; the view itself is read
  // again where it settles while no study area is drawn.
  let settleTries = 0;
  const watchView = () => {
    if (!window.GeoIDViewer?.camera) { if (settleTries++ < 120) setTimeout(watchView, 500); return; }
    onViewSettled(window.GeoIDViewer, async () => {
      await readView();
      if (refollow()) render();
      if (!areas.size || areas.has(VIEW_ID)) scan();
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
    /** Every study area as read: its hazard maps, what each found. */
    areas: () => [...areas.values()].map((a) => ({
      id: a.id, name: a.name, openKey: a.openKey,
      readings: [...a.readings.values()].map((r) => ({ key: r.key, title: r.title, busy: r.busy, hidden: r.hidden, covers: r.covers, error: r.error, assessment: r.assessment })),
    })),
    active: () => { const a = areas.get(state.activeId); return a?.readings.get(a.openKey)?.assessment || null; },
    following: () => ({ id: state.activeId, name: areas.get(state.activeId)?.name || null, why: state.why, pinned: state.explicitId }),
  };
}

if (typeof document !== "undefined" && typeof window !== "undefined" && typeof window.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}
