/**
 * Hazards ▸ Exposure ▸ People exposed.
 *
 * One door onto the risk reader (risk-reader.js), not the home of it: every
 * risk map is read for people the moment it is developed, in the risk reader
 * window, and from its own layer drawer. What this tab adds is the choosing —
 * any study area against any readable map, including a raster that is not a
 * hazard — and the one reading only it holds: the landslide forecast as a
 * SERIES, people on failing and marginal ground map by map, plotted and
 * exported, the annotation following the time-lapse bar.
 */

import { polygonsOf, peopleOnGrid, formatPeople, seriesCsv } from "./exposure.js?v=20260919-efed63d";
import { riskMaps, riskMapKind, assessLayer, countsUnder, ringsBox } from "./risk-reader.js?v=20260919-efed63d";
import { renderAssessment, annotationOf, el } from "./risk-reader-view.js?v=20260919-efed63d";
import { showAnnotation, removeAnnotation } from "./exposure-annotation.js?v=20260919-efed63d";
import { refreshPolygonOptions, promptDrawTool } from "./extent-picker.js?v=20260919-efed63d";
import { drawTimeSeries } from "./time-series-plot.js?v=20260919-efed63d";

const search = new URL(import.meta.url).search;
const byId = (id) => document.getElementById(id);
const NOTE_ID = "exposure";
const say = (m) => { const n = byId("exp-status"); if (n) n.textContent = m || ""; };
const tick = () => new Promise((r) => setTimeout(r, 0));

const FOS_CLASSES = [
  { label: "Failing — factor of safety below 1", colour: "#d7191c", test: (v) => v < 1 },
  { label: "Marginal — 1 to 1.5", colour: "#fdae61", test: (v) => v >= 1 && v < 1.5 },
];

const state = { result: null, series: null, follow: 0, assessment: null };

/* ── which maps ─────────────────────────────────────────────────────────── */

export function hazardChoices() {
  const out = [];
  if (window.GeoIDLandslidePipeline?.exposureSource?.()) out.push({ value: "series", label: "Landslide forecast — people over every map" });
  for (const m of riskMaps()) {
    const suffix = m.kind === "risk" ? " (annual chance)" : m.kind === "wind" ? " (strongest storm within 200 km)" : m.kind === "bands" ? " (value bands)" : "";
    out.push({ value: `layer:${m.layer.id}`, label: `${m.layer.name}${suffix}` });
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

/* ── the forecast as a series ───────────────────────────────────────────── */

async function exposeForecast() {
  const src = window.GeoIDLandslidePipeline?.exposureSource?.();
  if (!src) throw new Error("Run the landslide forecast first.");
  const polys = polygonsOf({ features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [src.ring] } }] });
  const pop = await countsUnder(ringsBox(polys));
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
      const sums = [0, 0];
      for (let i = 0; i < people.length; i += 1) {
        if (!mask[i] || !people[i]) continue;
        const v = fos[i];
        if (!Number.isFinite(v)) continue;
        const k = FOS_CLASSES.findIndex((c) => c.test(v));
        if (k >= 0) sums[k] += people[i];
      }
      sums.forEach((s, k) => values[k].push(s));
      if (p % 4 === 3) { say(`Integrating people over the forecast… ${p + 1} of ${picks.length} maps`); await tick(); }
    }
  } finally {
    src.restore();
  }
  let everFailing = 0;
  for (let i = 0; i < people.length; i += 1) if (mask[i] && src.minFos[i] < 1) everFailing += people[i];
  return { layer: src.label, ring: src.ring, inArea, picks, times: picks.map((k) => src.times[k]), values, stride, everFailing, src };
}

const para = (text, quiet = false) => el("p", { class: "compact-copy", style: `margin:0.3rem 0 0;opacity:${quiet ? 0.75 : 1}` }, text);

function showSeries(r) {
  const host = byId("exp-result");
  host.replaceChildren();
  stopFollow();
  const score = (k) => r.values[0][k] * 1e6 + r.values[1][k];
  const peak = r.values[0].reduce((m, v, k) => (score(k) > score(m) ? k : m), 0);
  host.append(para(`${formatPeople(r.inArea)} people live in the forecast's area. At the worst map (${String(r.times[peak]).replace("T", " ")}) ${formatPeople(r.values[0][peak])} are on failing ground and ${formatPeople(r.values[1][peak])} on marginal ground. Over the whole window ${formatPeople(r.everFailing)} live on ground that fails at some point.`));
  const canvas = el("canvas", { style: "display:block;width:100%;height:170px;margin:0.35rem 0 0;" });
  const read = para("", true);
  const csv = el("button", { type: "button", class: "button secondary" }, "Exposure over time — CSV");
  csv.addEventListener("click", () => exportSeries(r));
  const full = el("button", { type: "button", class: "button secondary" }, "Full assessment");
  full.title = "The forecast read at this map and at its worst, in the risk reader";
  full.addEventListener("click", () => {
    const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => riskMapKind(l)?.kind === "forecast");
    if (layer) window.GeoIDRiskReader?.open?.(layer.id);
  });
  host.append(canvas, read, el("div", { class: "gis-btn-row" }, csv, full), para(r.stride > 1 ? `Every ${r.stride}th map is integrated (${r.picks.length} of ${r.src.times.length}).` : "", true));
  state.series = { r, canvas, read };
  drawSeries();
  startFollow();
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

/* ── running ────────────────────────────────────────────────────────────── */

async function runExposure() {
  const btn = byId("exp-run");
  btn.disabled = true;
  try {
    const choice = byId("exp-hazard").value;
    say("Reading the population under the area…");
    if (choice === "series") {
      const r = await exposeForecast();
      state.result = r;
      showSeries(r);
    } else {
      const id = choice.replace(/^layer:/, "");
      const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => String(l.id) === id);
      if (!layer) throw new Error("That layer is no longer on the globe.");
      const out = await assessLayer(layer, byId("exp-area").value || "drawn");
      stopFollow();
      state.result = out;
      state.assessment = out.assessment;
      renderAssessment(byId("exp-result"), out.assessment, { say });
      const ring = out.assessment.mapGroups?.[0]?.rings?.[0];
      if (ring) showAnnotation(NOTE_ID, { ring, ...annotationOf(out.assessment) });
    }
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
  state.result = null; state.series = null; state.assessment = null;
  const host = byId("exp-result"); if (host) host.replaceChildren();
  say("");
}

/* ── the panel ──────────────────────────────────────────────────────────── */

function build(host) {
  const mk = (tag, attrs = {}, text) => { const n = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text) n.textContent = text; return n; };
  const area = mk("select", { id: "exp-area", class: "input", "aria-label": "Study area" });
  area.append(mk("option", { value: "drawn" }, "The drawn area"));
  const hazard = mk("select", { id: "exp-hazard", class: "input", "aria-label": "Hazard" });
  const draw = mk("button", { type: "button", class: "button secondary" }, "Draw an area");
  draw.addEventListener("click", () => { promptDrawTool(); say("Draw the area, press Done, then pick it above."); });
  const reader = mk("button", { type: "button", class: "button secondary" }, "Risk reader");
  reader.title = "Every risk map on the globe, read for people as it is developed";
  reader.addEventListener("click", () => { window.GeoIDRiskReader?.scan?.(); window.GeoIDRiskReader?.open?.(null); });
  const run = mk("button", { type: "button", id: "exp-run", class: "button" }, "Assess the risk to people");
  run.addEventListener("click", () => void runExposure());
  const clear = mk("button", { type: "button", class: "button secondary" }, "Clear");
  clear.addEventListener("click", clearExposure);
  const row = (label, control, title) => { const r = mk("div", { class: "row" }); if (title) r.title = title; const l = mk("label", { for: control.id }, label); r.append(l, control); return r; };
  const btns = (...b) => { const r = mk("div", { class: "gis-btn-row" }); r.append(...b); return r; };
  host.replaceChildren(
    mk("p", { class: "compact-copy", style: "margin:0.5rem 0 0.3rem;" }, "Every risk map is read for people as it is developed, in the risk reader. Here, choose any area against any readable map, or follow the landslide forecast map by map."),
    row("Study area", area, "Drawn shapes and every polygon layer on the globe — a layer of several polygons is also assessed polygon by polygon."),
    btns(draw, reader),
    row("Map", hazard, "Every map on the globe the risk reader can read, and the landslide forecast as a series."),
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
  window.GeoIDExposure = {
    run: runExposure, clear: clearExposure, hazardChoices, result: () => state.result, assessment: () => state.assessment,
  };
  return true;
}

if (typeof document !== "undefined") {
  let tries = 0;
  const attempt = () => { if (!install() && tries++ < 60) setTimeout(attempt, 250); };
  attempt();
}
