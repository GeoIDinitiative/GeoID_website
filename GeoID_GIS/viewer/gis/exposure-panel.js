/**
 * Hazards ▸ Exposure ▸ People exposed — the risk reader.
 *
 * Pick a study area and any hazard on the globe; the panel reads WorldPop's
 * counts under the area at their own resolution, integrates them against the
 * hazard, and reads the answer out as a risk assessment (risk-assessment.js):
 * people by risk level from very high to very low, each level's threshold in
 * the hazard's own units, the people with no reading apart, people-weighted
 * statistics, every polygon of the area on its own, and a CSV and a printable
 * report of all of it.
 *
 * Four kinds of hazard, each integrated the way its numbers mean:
 *
 *  - a GRID (the landslide factor of safety, flood depth, any raster): people
 *    on cells in each class — risk levels for a hazard whose direction is
 *    known, value bands for one whose direction is not;
 *  - a PROBABILITY map (every risk grid carrying `p_yr`): people by annual
 *    chance and the expected people reached a year, with the map's own second
 *    readings — hurricane-force chance and the strongest storm on record for
 *    cyclones, the largest magnitude for earthquakes, the largest VEI for
 *    volcanoes;
 *  - STORM TRACKS: people by the strongest storm that passed within 200 km;
 *  - the landslide FORECAST as a series: people on failing and marginal ground
 *    map by map, plotted and exported, and the annotation follows the
 *    time-lapse bar as the factor of safety changes from map to map.
 */

import {
  polygonsOf, polygonIndex, peopleOnGrid, polygonMask, cellKm2, formatPeople, seriesCsv, boxOf,
} from "./exposure.js?v=20260915-2db6686";
import {
  SCHEMES, LEVEL_COLOURS, chanceScheme, bandScheme, schemeForLayerName, riskLayerKind, assessGrid,
  assessPopulation, groupByFeature, formatCount, formatShare, formatNumber, returnPeriod,
  stackedBarSvg, assessmentCsv, reportHtml, summarySentence, windLookup, bandColour,
} from "./risk-assessment.js?v=20260915-2db6686";
import { showAnnotation, removeAnnotation } from "./exposure-annotation.js?v=20260915-2db6686";
import { refreshPolygonOptions, resolvePolygonRings, promptDrawTool } from "./extent-picker.js?v=20260915-2db6686";
import { drawTimeSeries } from "./time-series-plot.js?v=20260915-2db6686";
import { may, refusal } from "./membership.js?v=20260915-2db6686";

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

/* ── which hazards are on the globe ─────────────────────────────────────── */

const featuresOf = (l) => l.features || l.collection?.features || [];

export function hazardChoices() {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  const out = [];
  const pipeline = window.GeoIDLandslidePipeline?.exposureSource?.();
  if (pipeline) out.push({ value: "forecast", label: "Landslide forecast — every map, over time" });
  for (const l of layers) {
    if (l.visible === false || l.status !== "loaded") continue;
    if (/^Population density/.test(l.name)) continue;
    const feats = featuresOf(l);
    if (l.raster?.band && l.raster.width) out.push({ value: `raster:${l.id}`, label: l.name });
    else if (feats.some((f) => Number.isFinite(Number(f?.properties?.p_yr)))) out.push({ value: `risk:${l.id}`, label: `${l.name} (annual chance)` });
    else if (feats.some((f) => Number(f?.properties?.peak_wind_kts) > 0)) out.push({ value: `wind:${l.id}`, label: `${l.name} (strongest storm within 200 km)` });
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

const sourceOf = (layer) => [layer?.metadata?.source, layer?.metadata?.citation || layer?.info?.citation].filter(Boolean).join(" · ") || null;

/* ── the integrations ───────────────────────────────────────────────────── */

/**
 * People inside the polygons on POPULATION cells the hazard grid does not
 * reach: counted as no reading, so "0 exposed" over ground the map does not
 * cover is never read as safe.
 */
function offGrid(pop, gb, polys) {
  const popMask = polygonMask({ width: pop.width, height: pop.height, bounds: pop.bounds }, polys);
  const pdx = (pop.bounds.east - pop.bounds.west) / pop.width; const pdy = (pop.bounds.north - pop.bounds.south) / pop.height;
  let people = 0; let areaKm2 = 0;
  for (let y = 0; y < pop.height; y += 1) {
    const lat = pop.bounds.north - (y + 0.5) * pdy;
    const km2 = cellKm2(pdx, pdy, lat);
    for (let x = 0; x < pop.width; x += 1) {
      const i = y * pop.width + x;
      if (!popMask[i]) continue;
      const lon = pop.bounds.west + (x + 0.5) * pdx;
      if (lon >= gb.west && lon <= gb.east && lat >= gb.south && lat <= gb.north) continue;
      const v = pop.band[i];
      if (Number.isFinite(v) && v > 0 && v < 1e30) people += v;
      areaKm2 += km2;
    }
  }
  return { people, areaKm2 };
}

async function assessRaster(layer, area) {
  const r = layer.raster;
  const grid = { width: r.width, height: r.height, bounds: r.bounds };
  const gb = boxOf(r.bounds);
  const pop = await countsUnder(ringsBox(area.polys));
  const people = peopleOnGrid(pop, grid);
  const mask = polygonMask(grid, area.polys);
  let scheme = schemeForLayerName(layer.name);
  if (!scheme) {
    // A layer whose direction is not known: equal value bands over what is inside.
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      const v = r.band[i];
      if (!Number.isFinite(v) || v <= -1e30 || (r.noData != null && v === r.noData)) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    scheme = bandScheme(lo, hi, { measure: r.unit ? `Value (${r.unit})` : "Value", unit: r.unit || "", hazard: layer.name });
  }
  const run = (polys, m) => assessGrid({ people, values: r.band, mask: m, width: r.width, height: r.height, bounds: r.bounds, scheme, noData: r.noData ?? null, outside: offGrid(pop, gb, polys) });
  const main = run(area.polys, mask);
  const { groups, truncated } = groupByFeature(area.polys);
  const byPolygon = groups.length > 1 ? groups.map((g) => ({ name: g.name, breakdown: run(g.polys, polygonMask(grid, g.polys)) })) : [];
  return { breakdowns: [main], byPolygon, truncated, hazard: scheme.bands ? layer.name : scheme.hazard, layer: layer.name, source: sourceOf(layer) };
}

/** The storm tracks on the globe, if any: features carrying a peak wind. */
function trackFeatures() {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  const tracks = layers.find((l) => l.status === "loaded" && featuresOf(l).some((f) => Number(f?.properties?.peak_wind_kts) > 0));
  return tracks ? { layer: tracks, features: tracks._allFeatures || featuresOf(tracks) } : null;
}

async function assessRisk(layer, area) {
  const box = ringsBox(area.polys);
  const pop = await countsUnder(box);
  const feats = featuresOf(layer);
  // Only the cells near the area are indexed: a global risk map is tens of
  // thousands of polygons and the area touches a handful.
  const near = feats.filter((f) => {
    const b = polygonsOf({ features: [f] })[0]?.box;
    return b && !(b.east < box.west || b.west > box.east || b.north < box.south || b.south > box.north);
  });
  const index = polygonIndex(polygonsOf({ features: near }), { bucketDeg: 0.5 });
  const propsAt = (lon, lat) => index.at(lon, lat)?.feature?.properties || null;
  const kind = riskLayerKind(layer.name, near[0]?.properties || {});
  const hazard = { cyclone: "Tropical cyclone", seismic: "Earthquake", volcanic: "Volcanic ashfall", risk: layer.name }[kind];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const schemes = [{
    scheme: chanceScheme(hazard, kind === "cyclone" ? "Annual chance of a storm within 200 km" : "Annual chance of reaching here"),
    valueAt: (lon, lat) => { const p = propsAt(lon, lat); return p ? (num(p.p_yr) ?? 0) : null; },
  }];
  let note = null;
  if (kind === "cyclone") {
    schemes.push({
      scheme: chanceScheme("Tropical cyclone", "Annual chance of hurricane-force winds (≥ 64 kt) within 200 km",
        "The chance in any one year that a storm at hurricane force (one-minute sustained wind of 64 kt, 119 km/h, or more) passes within 200 km."),
      valueAt: (lon, lat) => { const p = propsAt(lon, lat); return p ? (num(p.p_hur_yr) ?? 0) : null; },
    });
    const tracks = trackFeatures();
    if (tracks) {
      const lookup = windLookup(tracks.features, box, { reachKm: 200 });
      schemes.push({ scheme: SCHEMES.wind, valueAt: (lon, lat) => lookup.at(lon, lat) });
    } else note = "Tick Tropical cyclone tracks on to add the strongest storm on record, by wind speed.";
  }
  if (kind === "seismic") schemes.push({ scheme: SCHEMES.magnitude, valueAt: (lon, lat) => { const p = propsAt(lon, lat); return p ? (p.none ? 0 : num(p.mag_max) ?? 0) : null; } });
  if (kind === "volcanic") schemes.push({ scheme: SCHEMES.vei, valueAt: (lon, lat) => { const p = propsAt(lon, lat); return p ? ((p.none || !(num(p.p_yr) > 0)) ? -1 : num(p.vei_max) ?? -1) : null; } });
  const breakdowns = assessPopulation({ pop, polys: area.polys, schemes });
  const { groups, truncated } = groupByFeature(area.polys);
  const byPolygon = groups.length > 1 ? groups.map((g) => ({ name: g.name, breakdown: assessPopulation({ pop, polys: g.polys, schemes: [schemes[0]] })[0] })) : [];
  return { breakdowns, byPolygon, truncated, hazard, layer: layer.name, source: sourceOf(layer), hazardNote: note };
}

async function assessTracks(layer, area) {
  const box = ringsBox(area.polys);
  const pop = await countsUnder(box);
  const lookup = windLookup(layer._allFeatures || featuresOf(layer), box, { reachKm: 200 });
  const schemes = [{ scheme: SCHEMES.wind, valueAt: (lon, lat) => lookup.at(lon, lat) }];
  const breakdowns = assessPopulation({ pop, polys: area.polys, schemes });
  const { groups, truncated } = groupByFeature(area.polys);
  const byPolygon = groups.length > 1 ? groups.map((g) => ({ name: g.name, breakdown: assessPopulation({ pop, polys: g.polys, schemes })[0] })) : [];
  return { breakdowns, byPolygon, truncated, hazard: "Tropical cyclone", layer: layer.name, source: sourceOf(layer),
    hazardNote: `${lookup.segments.toLocaleString("en-GB")} track segments within 200 km of the area.` };
}

async function exposeForecast() {
  const src = window.GeoIDLandslidePipeline?.exposureSource?.();
  if (!src) throw new Error("Run the landslide forecast first.");
  // The forecast's own area is the study area here: the model exists nowhere else.
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
  // Over the whole window, by the LOWEST factor of safety each cell reaches.
  const ever = assessGrid({ people, values: src.minFos, mask, width: src.grid.width, height: src.grid.height, bounds: src.grid.bounds, scheme: { ...SCHEMES.landslide, measure: "Lowest factor of safety over the forecast" } });
  return { kind: "series", layer: src.label, ring: src.ring, inArea, picks, times: picks.map((k) => src.times[k]), values, stride, ever, src };
}

/* ── showing it ─────────────────────────────────────────────────────────── */

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v); });
  children.flat().forEach((c) => n.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return n;
}

function p(text, quiet = false) {
  const n = el("p", { class: "compact-copy" }, text);
  Object.assign(n.style, { margin: "0.3rem 0 0", opacity: quiet ? "0.75" : "1" });
  return n;
}

function svgNode(markup) {
  const holder = document.createElement("div");
  holder.className = "exp-svg";
  holder.innerHTML = markup;
  return holder;
}

function card(value, label) {
  return el("div", { class: "exp-card" }, el("b", {}, value), el("span", {}, label));
}

function breakdownTable(b) {
  const table = el("table", { class: "exp-table" });
  const head = el("tr", {}, el("th", {}, b.scheme.bands ? "Band" : "Level"), el("th", { class: "n" }, "People"), el("th", { class: "n" }, "%"), el("th", { class: "n" }, "km²"));
  table.append(el("thead", {}, head));
  const body = el("tbody");
  b.byClass.forEach((c, k) => {
    const sw = el("span", { class: "exp-sw" });
    sw.style.background = c.level ? LEVEL_COLOURS[c.level] : bandColour(k, b.byClass.length);
    const name = el("td", {}, sw, el("span", {}, c.level ? `${c.level} — ${c.label}` : c.label), el("small", {}, c.threshold));
    name.title = c.threshold;
    body.append(el("tr", { class: c.people >= 0.5 ? "" : "is-empty" }, name, el("td", { class: "n" }, formatCount(c.people)), el("td", { class: "n" }, formatShare(c.shareOfArea)), el("td", { class: "n" }, formatNumber(c.areaKm2, 100))));
  });
  body.append(el("tr", { class: "is-quiet" }, el("td", {}, "Not exposed"), el("td", { class: "n" }, formatCount(b.notExposed)), el("td", { class: "n" }, formatShare(b.total ? b.notExposed / b.total : 0)), el("td", {})));
  body.append(el("tr", { class: "is-quiet" }, el("td", {}, "No reading (off the map)"), el("td", { class: "n" }, formatCount(b.noReading)), el("td", { class: "n" }, formatShare(b.total ? b.noReading / b.total : 0)), el("td", { class: "n" }, formatNumber(b.noReadingAreaKm2, 100))));
  table.append(body);
  return table;
}

function statsList(b) {
  const s = b.stats;
  const u = b.scheme.unit && b.scheme.unit !== "per year" ? ` ${b.scheme.unit}` : "";
  const span = Math.abs((s.max ?? 0) - (s.min ?? 0)) || 1;
  const f = (v) => (v === null ? "—" : b.scheme.probability ? returnPeriod(v) : `${formatNumber(v, span)}${u}`);
  const rows = [
    ["People-weighted mean", f(s.mean)], ["Median person", f(s.median)],
    ["10th – 90th percentile", `${f(s.p10)} – ${f(s.p90)}`], ["Range in the area", `${f(s.min)} – ${f(s.max)}`],
  ];
  if (b.expectedPerYear !== null) rows.push(["Expected people reached a year", formatNumber(b.expectedPerYear, b.expectedPerYear)]);
  rows.push(["Population density", `${formatNumber(b.density, 100)} per km²`]);
  rows.push(["People in edge cells (error bar)", formatShare(b.edgeShare)]);
  const dl = el("dl", { class: "exp-stats" });
  rows.forEach(([k, v]) => dl.append(el("dt", {}, k), el("dd", {}, v)));
  return dl;
}

function polygonTable(a) {
  const table = el("table", { class: "exp-table" });
  const prob = a.breakdowns[0].expectedPerYear !== null;
  table.append(el("thead", {}, el("tr", {}, el("th", {}, "Polygon"), el("th", { class: "n" }, "People"), el("th", { class: "n" }, "Exposed"), el("th", { class: "n" }, a.breakdowns[0].scheme.bands ? "Top 2 bands" : "V.high+high"), el("th", { class: "n" }, prob ? "Per yr" : "%"))));
  const body = el("tbody");
  [...a.byPolygon].sort((x, y) => y.breakdown.veryHighHigh - x.breakdown.veryHighHigh || y.breakdown.exposed - x.breakdown.exposed).forEach((row) => {
    const b = row.breakdown;
    body.append(el("tr", {}, el("td", {}, row.name), el("td", { class: "n" }, formatCount(b.total)), el("td", { class: "n" }, formatCount(b.exposed)), el("td", { class: "n" }, formatCount(b.veryHighHigh)), el("td", { class: "n" }, prob ? formatNumber(b.expectedPerYear, b.expectedPerYear) : formatShare(b.exposedShare))));
  });
  table.append(body);
  return table;
}

function fold(title, open, ...content) {
  const d = el("details", { class: "exp-fold" });
  d.open = open;
  d.append(el("summary", {}, title), ...content);
  return d;
}

function assessmentOf(r, area) {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  const localDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // The map: each polygon of the area with its own share at the top levels.
  const { groups } = groupByFeature(area.polys);
  const shareOf = (b) => (b ? (b.total > 0 ? b.veryHighHigh / b.total : null) : null);
  const mapGroups = groups.map((g, k) => ({
    name: g.name, rings: g.polys.map((q) => q.coords[0]),
    value: shareOf(groups.length > 1 ? r.byPolygon?.[k]?.breakdown : r.breakdowns[0]),
  }));
  const a = {
    area: area.label || "the study area",
    layer: r.layer, hazard: r.hazard, source: r.source, hazardNote: r.hazardNote || null,
    generated: now.toISOString(),
    generatedHuman: now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }),
    generatedDate: localDate,
    reference: `RA-${localDate.replace(/-/g, "")}-${pad(now.getHours())}${pad(now.getMinutes())}`,
    mapGroups,
    breakdowns: r.breakdowns, byPolygon: r.byPolygon, polygonsTruncated: r.truncated || 0,
    polygonCount: Math.max(1, r.byPolygon?.length || new Set(area.polys.map((q) => q.feature)).size),
  };
  a.summaryText = summarySentence(a);
  return a;
}

function showAssessment(a, area, host = byId("exp-result")) {
  state.assessment = a;
  host.replaceChildren();
  if (host.id === "exp-result") stopFollow();
  const b0 = a.breakdowns[0];
  host.append(
    p(a.summaryText),
    el("div", { class: "exp-cards" },
      card(formatCount(b0.total), "people in the area"),
      card(formatCount(b0.exposed), `exposed · ${formatShare(b0.exposedShare)}`),
      card(formatCount(b0.veryHighHigh), b0.scheme.bands ? "in the top two bands" : "very high or high"),
      b0.expectedPerYear !== null ? card(formatNumber(b0.expectedPerYear, b0.expectedPerYear), "reached a year") : card(formatNumber(b0.areaKm2, 100), "km² assessed")),
    svgNode(stackedBarSvg(b0, { width: 300, height: 16 })),
  );
  a.breakdowns.forEach((b, k) => {
    host.append(fold(`${b.scheme.measure}${b.scheme.unit && !b.scheme.probability ? ` (${b.scheme.unit})` : ""}`, k === 0,
      p(b.scheme.definition, true),
      k ? svgNode(stackedBarSvg(b, { width: 300, height: 12 })) : "",
      breakdownTable(b),
      statsList(b)));
  });
  if (a.byPolygon?.length > 1) host.append(fold(`By polygon · ${a.byPolygon.length}${a.polygonsTruncated ? ` of ${a.byPolygon.length + a.polygonsTruncated}` : ""}`, false, polygonTable(a)));
  if (a.hazardNote) host.append(p(a.hazardNote, true));
  const csv = el("button", { type: "button", class: "button secondary" }, "Assessment — CSV");
  csv.addEventListener("click", () => exportAssessmentCsv());
  const pdf = el("button", { type: "button", class: "button" }, "Report (PDF)");
  pdf.title = "Opens the report, ready to print or save as PDF";
  pdf.addEventListener("click", () => openReport({ print: true }));
  const html = el("button", { type: "button", class: "button secondary" }, "Report (HTML)");
  html.addEventListener("click", () => downloadReport());
  host.append(el("div", { class: "gis-btn-row" }, pdf, csv, html));
  const ring = area.polys[0].coords[0];
  showAnnotation(NOTE_ID, {
    ring, kicker: b0.scheme.bands ? "People on the layer" : `People at ${a.hazard.toLowerCase()} risk`,
    title: `${formatPeople(b0.exposed)} of ${formatPeople(b0.total)}`,
    lines: b0.byClass.filter((c) => c.people >= 0.5).slice(0, 3).map((c, k) => ({ text: `${formatPeople(c.people)} · ${c.level || c.label}`, colour: c.level ? LEVEL_COLOURS[c.level] : bandColour(k, 5) })),
  });
}

function slug(text) { return String(text || "area").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "area"; }

function exportAssessmentCsv() {
  const a = state.assessment;
  if (!a) return;
  void import(`./extraction.js${search}`).then(({ downloadText }) => {
    try { downloadText(`geoid_risk_${slug(a.hazard)}_${slug(a.area)}.csv`, assessmentCsv(a), "text/csv"); } catch (e) { say(e.message); }
  });
}

function downloadReport() {
  const a = state.assessment;
  if (!a) return;
  void import(`./extraction.js${search}`).then(({ downloadText }) => {
    try { downloadText(`geoid_risk_report_${slug(a.hazard)}_${slug(a.area)}.html`, reportHtml(a), "text/html"); } catch (e) { say(e.message); }
  });
}

/**
 * The report opens as its own page, print-ready: the browser's own "Save as
 * PDF" is the PDF writer, so nothing is vendored and the layout is the same on
 * paper as on screen.
 */
function openReport({ print = false } = {}) {
  const a = state.assessment;
  if (!a) return;
  if (!may("save")) { say(refusal("save")); return; }
  const html = reportHtml(a);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const w = window.open(`${url}${print ? "#print" : ""}`, "_blank");
  if (!w) say("The browser blocked the report window: allow pop-ups for this site, or use Report (HTML).");
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  try { window.GeoIDResearch?.bridge?.saveExport?.(`geoid_risk_report_${slug(a.hazard)}_${slug(a.area)}.html`, html); } catch (e) { /* no project */ }
}

function showSeries(r) {
  const host = byId("exp-result");
  host.replaceChildren();
  stopFollow();
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
  const csv = el("button", { type: "button", class: "button secondary" }, "Exposure over time — CSV");
  csv.addEventListener("click", () => exportSeries(r));
  host.append(el("div", { class: "gis-btn-row" }, csv), p(r.stride > 1 ? `Every ${r.stride}th map is integrated (${r.picks.length} of ${r.src.times.length}).` : "", true));
  // The window's worst case, as a risk assessment of its own.
  const area = { label: "the forecast's area", polys: polygonsOf({ features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [r.ring] } }] }) };
  const a = assessmentOf({ breakdowns: [r.ever], byPolygon: [], hazard: "Landslide", layer: r.layer, source: "GeoID landslide forecast (static hydrogeological model)",
    hazardNote: `Classed by each cell's lowest factor of safety over ${r.src.times.length} maps.` }, area);
  state.assessment = a;
  const sub = el("div");
  host.append(fold("Risk assessment — worst case over the window", false, sub));
  showAssessment(a, area, sub);
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

async function runExposure() {
  const btn = byId("exp-run");
  btn.disabled = true;
  try {
    const choice = byId("exp-hazard").value;
    say("Reading the population under the area…");
    if (choice === "forecast") {
      const r = await exposeForecast();
      state.result = r;
      showSeries(r);
    } else {
      const area = studyArea();
      const [kind, id] = choice.split(":");
      const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => String(l.id) === id);
      if (!layer) throw new Error("That layer is no longer on the globe.");
      const r = kind === "raster" ? await assessRaster(layer, area) : kind === "wind" ? await assessTracks(layer, area) : await assessRisk(layer, area);
      state.result = { kind, ...r };
      showAssessment(assessmentOf(r, area), area);
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

const STYLE = `
#exposure-analysis .exp-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.35rem; margin: 0.45rem 0; }
#exposure-analysis .exp-card { border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.3); border-left: 3px solid var(--nav-accent, #ff2bd6); border-radius: 0.4rem; padding: 0.3rem 0.45rem; display: grid; }
#exposure-analysis .exp-card b { font-size: 0.95rem; font-variant-numeric: tabular-nums; }
#exposure-analysis .exp-card span { font-size: 0.66rem; opacity: 0.75; }
#exposure-analysis .exp-svg svg { display: block; width: 100%; border-radius: 0.2rem; margin: 0.2rem 0; }
#exposure-analysis .exp-fold { margin: 0.35rem 0 0; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.2); border-radius: 0.45rem; padding: 0.25rem 0.45rem; }
#exposure-analysis .exp-fold > summary { cursor: pointer; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; }
#exposure-analysis .exp-table { width: 100%; border-collapse: collapse; font-size: 0.72rem; margin: 0.3rem 0 0; }
#exposure-analysis .exp-table th { text-align: left; font-weight: 600; opacity: 0.8; border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding: 0.1rem 0.2rem; }
#exposure-analysis .exp-table td { padding: 0.15rem 0.2rem; border-bottom: 1px solid rgba(255, 255, 255, 0.06); vertical-align: top; }
#exposure-analysis .exp-table .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
#exposure-analysis .exp-table small { display: block; opacity: 0.6; font-size: 0.62rem; }
#exposure-analysis .exp-table tr.is-empty td { opacity: 0.5; }
#exposure-analysis .exp-table tr.is-quiet td { opacity: 0.7; font-style: italic; }
#exposure-analysis .exp-sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 0.35rem; vertical-align: -1px; border: 1px solid rgba(0, 0, 0, 0.4); }
#exposure-analysis .exp-stats { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.1rem 0.5rem; font-size: 0.68rem; margin: 0.35rem 0 0.2rem; }
#exposure-analysis .exp-stats dt { opacity: 0.7; }
#exposure-analysis .exp-stats dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
`;

function build(host) {
  if (!byId("exp-style")) { const s = document.createElement("style"); s.id = "exp-style"; s.textContent = STYLE; document.head.append(s); }
  const mk = (tag, attrs = {}, text) => { const n = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text) n.textContent = text; return n; };
  const area = mk("select", { id: "exp-area", class: "input", "aria-label": "Study area" });
  const hazard = mk("select", { id: "exp-hazard", class: "input", "aria-label": "Hazard" });
  const draw = mk("button", { type: "button", class: "button secondary" }, "Draw an area");
  draw.addEventListener("click", () => { promptDrawTool(); say("Draw the area, press Done, then pick it above."); });
  const run = mk("button", { type: "button", id: "exp-run", class: "button" }, "Assess the risk to people");
  run.addEventListener("click", () => void runExposure());
  const clear = mk("button", { type: "button", class: "button secondary" }, "Clear");
  clear.addEventListener("click", clearExposure);
  const row = (label, control, title) => { const r = mk("div", { class: "row" }); if (title) r.title = title; const l = mk("label", { for: control.id }, label); r.append(l, control); return r; };
  const btns = (...b) => { const r = mk("div", { class: "gis-btn-row" }); r.append(...b); return r; };
  host.replaceChildren(
    mk("p", { class: "compact-copy", style: "margin:0.5rem 0 0.3rem;" }, "The people under an area, read as a risk assessment against any hazard on the globe: by risk level, flood depth, wind speed, magnitude or VEI, per polygon, with a CSV and a printable report."),
    row("Study area", area, "Drawn shapes and every polygon layer on the globe — a layer of several polygons is also assessed polygon by polygon. The landslide forecast uses its own area."),
    btns(draw),
    row("Hazard", hazard, "Any hazard grid, risk map or storm tracks on the globe, or the landslide forecast's every map."),
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
    run: runExposure, clear: clearExposure, hazardChoices, result: () => state.result,
    assessment: () => state.assessment, report: (opts) => openReport(opts), csv: () => (state.assessment ? assessmentCsv(state.assessment) : null),
  };
  return true;
}

if (typeof document !== "undefined") {
  let tries = 0;
  const attempt = () => { if (!install() && tries++ < 60) setTimeout(attempt, 250); };
  attempt();
}
