/**
 * Hazards ▸ Exposure ▸ People exposed.
 *
 * Pick a study area and any hazard on the globe; the panel reads WorldPop's
 * counts under the area at their own resolution, integrates them against the
 * hazard (exposure.js), writes the answer on the map over the area, and lists
 * it by class. Three kinds of hazard, each integrated the way its numbers mean:
 *
 *  - a GRID with a threshold (the landslide factor of safety, flood depth):
 *    people on cells in each class;
 *  - a PROBABILITY map (every risk grid carrying `p_yr`): expected people
 *    reached a year, and people by return period;
 *  - the landslide FORECAST as a series: people on failing and marginal ground
 *    map by map, plotted and exported, and the annotation follows the
 *    time-lapse bar as the factor of safety changes from map to map.
 */

import {
  polygonsOf, polygonIndex, peopleOnGrid, polygonMask, gridExposure, riskExposure, formatPeople, seriesCsv,
} from "./exposure.js?v=20260914-cfe1b52";
import { showAnnotation, removeAnnotation } from "./exposure-annotation.js?v=20260914-cfe1b52";
import { refreshPolygonOptions, resolvePolygonRings, promptDrawTool } from "./extent-picker.js?v=20260914-cfe1b52";
import { drawTimeSeries } from "./time-series-plot.js?v=20260914-cfe1b52";

const search = new URL(import.meta.url).search;
const byId = (id) => document.getElementById(id);
const NOTE_ID = "exposure";
const say = (m) => { const n = byId("exp-status"); if (n) n.textContent = m || ""; };
const tick = () => new Promise((r) => setTimeout(r, 0));

const FOS_CLASSES = [
  { label: "Failing — factor of safety below 1", colour: "#d7191c", test: (v) => v < 1 },
  { label: "Marginal — 1 to 1.5", colour: "#fdae61", test: (v) => v >= 1 && v < 1.5 },
];
const DEPTH_CLASSES = [
  { label: "Under 0.5 m of water", colour: "#9ecae1", test: (v) => v > 0 && v < 0.5 },
  { label: "0.5–1 m", colour: "#4292c6", test: (v) => v >= 0.5 && v < 1 },
  { label: "1–2 m", colour: "#2171b5", test: (v) => v >= 1 && v < 2 },
  { label: "Over 2 m", colour: "#08306b", test: (v) => v >= 2 },
];
const ANY_CLASS = [{ label: "Under the layer", colour: "#ff3ec8", test: (v) => Number.isFinite(v) }];
const RP_EDGES = [0.001, 0.01, 0.1, 0.5];
const RP_LABELS = ["Rarer than 1 in 1,000 years", "1 in 100 to 1 in 1,000 years", "1 in 10 to 1 in 100 years", "1 in 2 to 1 in 10 years", "More often than 1 in 2 years"];
const RP_COLOURS = ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"];

const state = { result: null, series: null, follow: 0 };

/* ── which hazards are on the globe ─────────────────────────────────────── */

function classesFor(layer) {
  const name = String(layer.name || "");
  if (/landslide risk/i.test(name) || /factor of safety/i.test(name)) return FOS_CLASSES;
  if (/flood|inundation|discharge|river corridor/i.test(name)) return DEPTH_CLASSES;
  return ANY_CLASS;
}

export function hazardChoices() {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  const out = [];
  const pipeline = window.GeoIDLandslidePipeline?.exposureSource?.();
  if (pipeline) out.push({ value: "forecast", label: "Landslide forecast — every map, over time" });
  for (const l of layers) {
    if (l.visible === false || l.status !== "loaded") continue;
    if (/^Population density/.test(l.name)) continue;
    if (l.raster?.band && l.raster.width) out.push({ value: `raster:${l.id}`, label: l.name });
    else if ((l.features || l.collection?.features || []).some((f) => Number.isFinite(Number(f?.properties?.p_yr)))) {
      out.push({ value: `risk:${l.id}`, label: `${l.name} (annual chance)` });
    }
  }
  return out;
}

function refreshHazards() {
  const select = byId("exp-hazard");
  if (!select) return;
  const was = select.value;
  const choices = hazardChoices();
  // Rebuilt only when the set CHANGES: replacing the options of a select that
  // is open shuts it under the reader's pointer.
  const sig = choices.map((c) => `${c.value}|${c.label}`).join("\n");
  if (select.dataset.sig === sig && select.options.length) return;
  select.dataset.sig = sig;
  select.replaceChildren(...(choices.length ? choices : [{ value: "", label: "No hazard map on the globe yet" }])
    .map((c) => { const o = document.createElement("option"); o.value = c.value; o.textContent = c.label; return o; }));
  if (choices.some((c) => c.value === was)) select.value = was;
  byId("exp-run").disabled = !choices.length;
}

/* ── the population under a box ─────────────────────────────────────────── */

async function countsUnder(box) {
  const { readCounts } = await import(`./worldpop.js${search}`);
  // A cell of margin, so the polygon's edge cells have their population cell.
  const pad = 1 / 120;
  const want = { west: box.west - pad, east: box.east + pad, south: box.south - pad, north: box.north + pad };
  // Once more on failure: the first range request against a cold bucket can
  // fail ("Request failed") where the same read a moment later succeeds.
  const read = await readCounts(want).catch(() => new Promise((r) => setTimeout(r, 800)).then(() => readCounts(want)));
  if (!read) throw new Error("WorldPop has no data under that area.");
  return read;
}

function ringsBox(polys) {
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const p of polys) { w = Math.min(w, p.box.west); e = Math.max(e, p.box.east); s = Math.min(s, p.box.south); n = Math.max(n, p.box.north); }
  return { west: w, east: e, south: s, north: n };
}

function studyArea() {
  const got = resolvePolygonRings(byId("exp-area").value, { arm: false });
  if (!got || got.error) throw new Error(got?.error || "Pick a study area first.");
  const fc = got.maskFc || { type: "FeatureCollection", features: got.rings.map((r) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [r.vertices.map((v) => [v.lon > 180 ? v.lon - 360 : v.lon, v.lat])] } })) };
  const polys = polygonsOf(fc).map((p) => ({ ...p, coords: p.coords.map((ring) => ring.map(([x, y]) => [x > 180 ? x - 360 : x, y])) }));
  polys.forEach((p) => {
    let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
    for (const [x, y] of p.coords[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    p.box = { west: w, east: e, south: s, north: n };
  });
  if (!polys.length) throw new Error("That area holds no polygon.");
  return { label: got.label, polys };
}

/* ── the three integrations ─────────────────────────────────────────────── */

async function exposeRaster(layer, area) {
  const r = layer.raster;
  const grid = { width: r.width, height: r.height, bounds: r.bounds };
  const box = ringsBox(area.polys);
  const pop = await countsUnder(box);
  const people = peopleOnGrid(pop, grid);
  const mask = polygonMask(grid, area.polys);
  const classes = classesFor(layer);
  const noData = r.noData;
  const ex = gridExposure({
    people, values: r.band, mask, width: r.width, classes: classes.map((c) => c.label),
    classOf: (v) => {
      if (!Number.isFinite(v) || (noData != null && v === noData) || v <= -1e30) return -1;
      return classes.findIndex((c) => c.test(v));
    },
  });
  /**
   * THE AREA'S PEOPLE ARE COUNTED ON THE HAZARD'S OWN CELLS where it has any.
   * Counting whole 1 km population cells by their centres instead read 2.4
   * thousand people in a 10 km box where the forecast's 21 m grid read 3.1
   * thousand in the same box — the centre test misjudges every edge cell of a
   * small area. Only the part of the polygon the grid does not reach falls
   * back to the population cells, and is reported apart, so "0 exposed" over
   * ground the map does not cover is never read as safe.
   */
  const gb = { west: r.bounds.minX ?? r.bounds.west, east: r.bounds.maxX ?? r.bounds.east, south: r.bounds.minY ?? r.bounds.south, north: r.bounds.maxY ?? r.bounds.north };
  const popGrid = { width: pop.width, height: pop.height, bounds: pop.bounds };
  const popMask = polygonMask(popGrid, area.polys);
  const pdx = (pop.bounds.east - pop.bounds.west) / pop.width; const pdy = (pop.bounds.north - pop.bounds.south) / pop.height;
  let outside = 0;
  for (let y = 0; y < pop.height; y += 1) {
    const lat = pop.bounds.north - (y + 0.5) * pdy;
    for (let x = 0; x < pop.width; x += 1) {
      const i = y * pop.width + x;
      if (!popMask[i]) continue;
      const lon = pop.bounds.west + (x + 0.5) * pdx;
      if (lon >= gb.west && lon <= gb.east && lat >= gb.south && lat <= gb.north) continue;
      const v = pop.band[i];
      if (Number.isFinite(v) && v > 0) outside += v;
    }
  }
  return { kind: "grid", layer: layer.name, classes, ex, inArea: ex.total + outside, outside, pop };
}

async function exposeRisk(layer, area) {
  const box = ringsBox(area.polys);
  const pop = await countsUnder(box);
  const feats = (layer.features || layer.collection?.features || []);
  // Only the cells near the area are indexed: a global risk map is tens of
  // thousands of polygons and the area touches a handful.
  const near = feats.filter((f) => {
    const b = polygonsOf({ features: [f] })[0]?.box;
    return b && !(b.east < box.west || b.west > box.east || b.north < box.south || b.south > box.north);
  });
  const index = polygonIndex(polygonsOf({ features: near }), { bucketDeg: 0.5 });
  const ex = riskExposure({ pop, polys: area.polys, index, edges: RP_EDGES, labels: RP_LABELS });
  return { kind: "risk", layer: layer.name, ex, pop };
}

async function exposeForecast(area) {
  const src = window.GeoIDLandslidePipeline?.exposureSource?.();
  if (!src) throw new Error("Run the landslide forecast first.");
  // The forecast's own area is the study area here: the model exists nowhere else.
  const polys = polygonsOf({ features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [src.ring] } }] });
  const box = ringsBox(polys);
  const pop = await countsUnder(box);
  const people = peopleOnGrid(pop, src.grid);
  const mask = src.model;
  let inArea = 0; for (let i = 0; i < people.length; i += 1) if (mask[i]) inArea += people[i];
  const n = src.times.length;
  const stride = Math.max(1, Math.ceil(n / 120));
  const picks = []; for (let k = 0; k < n; k += stride) picks.push(k);
  if (picks[picks.length - 1] !== n - 1) picks.push(n - 1);
  const values = FOS_CLASSES.map(() => []);
  try {
    for (let p = 0; p < picks.length; p += 1) {
      const fos = src.fosAt(picks[p]);
      const ex = gridExposure({ people, values: fos, mask, classes: FOS_CLASSES.map((c) => c.label),
        classOf: (v) => (Number.isFinite(v) ? FOS_CLASSES.findIndex((c) => c.test(v)) : -1) });
      ex.byClass.forEach((c, k) => values[k].push(c.people));
      if (p % 4 === 3) { say(`Integrating people over the forecast… ${p + 1} of ${picks.length} maps`); await tick(); }
    }
  } finally {
    src.restore();
  }
  // Ever failing: people on ground whose lowest factor of safety over the whole
  // window drops below 1.
  const ever = gridExposure({ people, values: src.minFos, mask, classes: FOS_CLASSES.map((c) => c.label),
    classOf: (v) => (Number.isFinite(v) ? FOS_CLASSES.findIndex((c) => c.test(v)) : -1) });
  return { kind: "series", layer: src.label, ring: src.ring, inArea, picks, times: picks.map((k) => src.times[k]), values, stride, ever, src };
}

/* ── showing it ─────────────────────────────────────────────────────────── */

function renderTable(rows, total) {
  const table = document.createElement("table");
  table.className = "exp-table";
  Object.assign(table.style, { width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", margin: "0.35rem 0 0" });
  for (const r of rows) {
    const tr = document.createElement("tr");
    const a = document.createElement("td"); const b = document.createElement("td"); const c = document.createElement("td");
    if (r.colour) {
      const sw = document.createElement("span");
      Object.assign(sw.style, { display: "inline-block", width: "9px", height: "9px", borderRadius: "2px", background: r.colour, marginRight: "0.4rem" });
      a.append(sw);
    }
    a.append(document.createTextNode(r.label));
    b.textContent = formatPeople(r.people);
    c.textContent = total > 0 ? `${((100 * r.people) / total).toFixed(1)}%` : "";
    [b, c].forEach((td) => { td.style.textAlign = "right"; td.style.whiteSpace = "nowrap"; td.style.paddingLeft = "0.5rem"; td.style.fontVariantNumeric = "tabular-nums"; });
    tr.append(a, b, c);
    table.append(tr);
  }
  return table;
}

function show(result, area) {
  state.result = result;
  const host = byId("exp-result");
  host.replaceChildren();
  stopFollow();
  const ring = result.kind === "series" ? result.ring : area.polys[0].coords[0];
  if (result.kind === "grid") {
    const { ex, classes, inArea, outside } = result;
    const rows = ex.byClass.map((c, k) => ({ label: c.label, people: c.people, colour: classes[k].colour }));
    host.append(
      p(`${formatPeople(inArea)} people live in ${area.label}; ${formatPeople(ex.exposed)} (${(100 * ex.exposed / Math.max(1, inArea)).toFixed(1)}%) are on ground under ${result.layer}.`),
      renderTable(rows, inArea),
      p(`${outside > 0.5 ? `${formatPeople(outside)} of them are outside the layer's own grid and are not counted either way. ` : ""}`
        + `${(100 * ex.edgeShare).toFixed(0)}% of the area's people sit in cells on its edge — the integral's error bar. WorldPop 2020, 1 km, shared among the hazard's cells.`, true),
    );
    showAnnotation(NOTE_ID, { ring, kicker: "People exposed", title: `${formatPeople(ex.exposed)} of ${formatPeople(inArea)}`,
      lines: rows.filter((r) => r.people >= 0.5).map((r) => ({ text: `${formatPeople(r.people)} · ${r.label}`, colour: r.colour })) });
  } else if (result.kind === "risk") {
    const { ex } = result;
    const rows = ex.byClass.map((c, k) => ({ label: c.label, people: c.people, colour: RP_COLOURS[k] })).reverse();
    host.append(
      p(`${formatPeople(ex.total)} people live in ${area.label}. On ${result.layer}, ${formatPeople(ex.expectedPerYear)} of them are reached in an average year (Σ people × annual chance).`),
      renderTable(rows, ex.total),
      p(`People by how often the hazard reaches where they live.${ex.uncovered > 0.5 ? ` ${formatPeople(ex.uncovered)} live where the map has no cell.` : ""} A chance is not a headcount: the expected figure is the long-run average, and in most years it is nobody.`, true),
    );
    showAnnotation(NOTE_ID, { ring, kicker: "Reached in an average year", title: `${formatPeople(ex.expectedPerYear)} of ${formatPeople(ex.total)}`,
      lines: rows.filter((r) => r.people >= 0.5).slice(0, 3).map((r) => ({ text: `${formatPeople(r.people)} · ${r.label}`, colour: r.colour })) });
  } else {
    const r = result;
    // The worst map is the one with the most people on failing ground, and
    // among those the most on marginal ground: ranking on failing alone picked
    // the first map of a dry window, where every map ties at zero.
    const score = (k) => r.values[0][k] * 1e6 + r.values[1][k];
    const peak = r.values[0].reduce((m, v, k) => (score(k) > score(m) ? k : m), 0);
    host.append(
      p(`${formatPeople(r.inArea)} people live in the forecast's area. At the worst map (${String(r.times[peak]).replace("T", " ")}) ${formatPeople(r.values[0][peak])} are on failing ground and ${formatPeople(r.values[1][peak])} on marginal ground. Over the whole window ${formatPeople(r.ever.byClass[0].people)} live on ground that fails at some point.`),
    );
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { display: "block", width: "100%", height: "170px", margin: "0.35rem 0 0" });
    host.append(canvas);
    const read = p("", true);
    host.append(read);
    const csv = document.createElement("button");
    csv.type = "button"; csv.className = "button secondary"; csv.textContent = "Exposure over time — CSV";
    csv.addEventListener("click", () => exportSeries(r));
    const row = document.createElement("div"); row.className = "gis-btn-row"; row.append(csv);
    host.append(row, p(r.stride > 1 ? `Every ${r.stride}th map is integrated (${r.picks.length} of ${r.src.times.length}).` : "", true));
    state.series = { r, canvas, read };
    drawSeries();
    startFollow();
  }
}

function p(text, quiet = false) {
  const n = document.createElement("p");
  n.className = "compact-copy";
  n.textContent = text;
  Object.assign(n.style, { margin: "0.3rem 0 0", opacity: quiet ? "0.75" : "1" });
  return n;
}

function nearestPick(r, step) {
  let best = 0;
  r.picks.forEach((k, j) => { if (Math.abs(k - step) < Math.abs(r.picks[best] - step)) best = j; });
  return best;
}

function drawSeries() {
  const s = state.series;
  if (!s?.canvas?.isConnected) return;
  const { r } = s;
  const step = r.src.step();
  const j = step >= 0 ? nearestPick(r, step) : -1;
  drawTimeSeries(s.canvas, {
    times: r.times, lines: FOS_CLASSES.map((c, k) => ({ colour: c.colour, values: r.values[k], bold: k === 0 })),
    yLabel: "People", marker: j, now: Date.now(), empty: "No maps.",
  });
  if (j >= 0) {
    const t = String(r.times[j]).replace("T", " ");
    s.read.textContent = `${t}: ${formatPeople(r.values[0][j])} failing · ${formatPeople(r.values[1][j])} marginal`;
    showAnnotation(NOTE_ID, { ring: r.ring, kicker: `People exposed · ${t}`,
      title: `${formatPeople(r.values[0][j] + r.values[1][j])} of ${formatPeople(r.inArea)}`,
      lines: FOS_CLASSES.map((c, k) => ({ text: `${formatPeople(r.values[k][j])} · ${c.label}`, colour: c.colour })) });
  }
}

let lastStep = -2;
function startFollow() {
  stopFollow();
  state.follow = setInterval(() => {
    const s = state.series;
    if (!s?.canvas?.isConnected) { stopFollow(); return; }
    const step = s.r.src.step();
    if (step !== lastStep) { lastStep = step; drawSeries(); }
  }, 350);
}
function stopFollow() { if (state.follow) clearInterval(state.follow); state.follow = 0; lastStep = -2; }

function exportSeries(r) {
  const text = seriesCsv({
    times: r.times, total: r.inArea,
    series: FOS_CLASSES.map((c, k) => ({ label: c.label, values: r.values[k] })),
    header: `GeoID exposure — WorldPop 2020 people on the landslide forecast's ground; ${r.src.times.length} maps${r.stride > 1 ? `, every ${r.stride}th integrated` : ""}`,
  });
  void import(`./extraction.js${search}`).then(({ downloadText }) => downloadText("geoid_exposure_over_time.csv", text, "text/csv"));
}

async function runExposure() {
  const btn = byId("exp-run");
  btn.disabled = true;
  try {
    const choice = byId("exp-hazard").value;
    say("Reading the population under the area…");
    let result; let area;
    if (choice === "forecast") {
      area = { label: "the forecast's area", polys: [] };
      result = await exposeForecast(area);
    } else {
      area = studyArea();
      const [kind, id] = choice.split(":");
      const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => String(l.id) === id);
      if (!layer) throw new Error("That layer is no longer on the globe.");
      result = kind === "raster" ? await exposeRaster(layer, area) : await exposeRisk(layer, area);
    }
    show(result, area);
    say("");
  } catch (error) {
    say(`Could not compute exposure: ${error.message}`);
  } finally {
    btn.disabled = !hazardChoices().length;
  }
}

function clearExposure() {
  stopFollow();
  removeAnnotation(NOTE_ID);
  state.result = null; state.series = null;
  const host = byId("exp-result"); if (host) host.replaceChildren();
  say("");
}

/* ── the panel ──────────────────────────────────────────────────────────── */

function build(host) {
  const mk = (tag, attrs = {}, text) => { const n = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text) n.textContent = text; return n; };
  const area = mk("select", { id: "exp-area", class: "input", "aria-label": "Study area" });
  const hazard = mk("select", { id: "exp-hazard", class: "input", "aria-label": "Hazard" });
  const draw = mk("button", { type: "button", class: "button secondary" }, "Draw an area");
  draw.addEventListener("click", () => { promptDrawTool(); say("Draw the area, press Done, then pick it above."); });
  const run = mk("button", { type: "button", id: "exp-run", class: "button" }, "Count the people exposed");
  run.addEventListener("click", () => void runExposure());
  const clear = mk("button", { type: "button", class: "button secondary" }, "Clear");
  clear.addEventListener("click", clearExposure);
  const row = (label, control, title) => { const r = mk("div", { class: "row" }); if (title) r.title = title; const l = mk("label", { for: control.id }, label); r.append(l, control); return r; };
  const btns = (...b) => { const r = mk("div", { class: "gis-btn-row" }); r.append(...b); return r; };
  host.replaceChildren(
    mk("p", { class: "compact-copy", style: "margin:0.5rem 0 0.3rem;" }, "People exposed: the population under an area, integrated against any hazard on the globe."),
    row("Study area", area, "Drawn shapes and every polygon layer on the globe. The landslide forecast uses its own area."),
    btns(draw),
    row("Hazard", hazard, "Any hazard grid or risk map on the globe, or the landslide forecast's every map."),
    btns(run, clear),
    mk("p", { id: "exp-status", class: "compact-copy", "aria-live": "polite", style: "margin:0.25rem 0 0;opacity:0.8;" }),
    mk("div", { id: "exp-result" }),
  );
  refreshPolygonOptions(area, "drawn", { allLayers: true });
  refreshHazards();
  const refresh = () => {
    try { refreshPolygonOptions(area, area.value || "drawn", { allLayers: true }); } catch (e) { /* later */ }
    refreshHazards();
  };
  window.addEventListener("geoid-gis:layers-changed", refresh);
  window.GeoIDImportManager?.onChange?.(refresh);
  setInterval(refreshHazards, 3000);
}

function install() {
  const host = byId("exposure-analysis");
  if (!host || host.dataset.built) return false;
  host.dataset.built = "1";
  build(host);
  window.GeoIDExposure = { run: runExposure, clear: clearExposure, hazardChoices, result: () => state.result };
  return true;
}

if (typeof document !== "undefined") {
  let tries = 0;
  const attempt = () => { if (!install() && tries++ < 60) setTimeout(attempt, 250); };
  attempt();
}

