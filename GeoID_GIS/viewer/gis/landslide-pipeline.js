/**
 * FORECAST LANDSLIDE RISK — a hydrogeological slope model under a series of
 * GFS rainfall maps, drawn as a flowchart.
 *
 * The model underneath is built ONCE from the ground: the streamed DEM (slope,
 * and multiple-flow-direction routing over the study area plus a margin, so
 * every cell knows how much hillside drains through it), the soil-thickness
 * model (the column above bedrock and the shallow failure plane in it), and
 * the material the maps on the globe name — a mapped deposit, the FAO soil
 * map's topsoil texture, or the regolith over the bedrock — read through the
 * rock-properties database for c′, φ′, unit weight, porosity and hydraulic
 * conductivity.
 *
 * Then GFS (NOAA, through Open-Meteo) is read over the area for a window of
 * dates, on its own ~13 km grid, as a series of RAINFALL MAPS: each the rain
 * summed over the hours before it. Every map is the input to one STATIC model
 * — the steady water table that recharge would build, routed downslope, and
 * the factor of safety that water table leaves on the failure plane — so the
 * run is a stack of static answers, one per map, played through the bar.
 *
 * The physics is `slope-hydrology.js` and the rainfall is `gfs-rain.js`; this
 * file only orchestrates them and says, on every card, what it has read.
 */

import { refreshPolygonOptions, resolvePolygonExtent, promptDrawTool } from "./extent-picker.js?v=20260911-9c953a5";
import { fetchWindow, fetchGfsNodes, rainfallFrames, interpolatorFor, dayHours, GFS_CREDIT, GFS_ARCHIVE_START } from "./gfs-rain.js?v=20260911-9c953a5";
import {
  columnMaterial, soilColumn, steadyWetness, planeWetness, factorOfSafety, criticalRecharge,
  FOS_CLASSES, fosClass, SHALLOW_FAILURE_CAP_M, LATERAL_FACTOR, FOS_CAP,
} from "./slope-hydrology.js?v=20260911-9c953a5";
import { fillSinks, mfdTopology, routeFlux } from "./hydrology.js?v=20260911-9c953a5";
import { makeRaster, slope as slopeOf } from "./raster-analysis.js?v=20260911-9c953a5";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260911-9c953a5";
import { loadRockProperties, parameterValue, resolveLithology } from "./rock-properties.js?v=20260911-9c953a5";
import { GEE_RAIN_SOURCES, coversBox, daysBetween, geeRainDates, fetchGeeRainDays, pixelIndex, isoDay as dayOf } from "./gee-rain.js?v=20260911-9c953a5";
import { mathsFor } from "./equations.js?v=20260911-9c953a5";
import { startPlayer, stopPlayer } from "./timelapse-player.js?v=20260911-9c953a5";

const search = new URL(import.meta.url).search;
export const LAYER_NAME = "Landslide risk — forecast (factor of safety)";

/* ── pure: the pieces the tests run ─────────────────────────────────────── */

/** The DEM as a raster over the bounds, sampled from a height reader. */
export function demGridFor(bounds, heightAt, { maxCells = 90000 } = {}) {
  const { west, south, east, north } = bounds;
  const midLat = (south + north) / 2;
  const widthM = (east - west) * 111320 * Math.cos(midLat * Math.PI / 180);
  const heightM = (north - south) * 110574;
  const step = Math.max(10, Math.sqrt((widthM * heightM) / maxCells));
  const cols = Math.max(4, Math.round(widthM / step));
  const rows = Math.max(4, Math.round(heightM / step));
  const band = new Float32Array(cols * rows);
  let known = 0;
  for (let y = 0; y < rows; y += 1) {
    const lat = north - ((y + 0.5) / rows) * (north - south);
    for (let x = 0; x < cols; x += 1) {
      const lon = west + ((x + 0.5) / cols) * (east - west);
      const h = heightAt(lat, lon);
      band[y * cols + x] = Number.isFinite(h) ? h : NaN;
      if (Number.isFinite(h)) known += 1;
    }
  }
  return { band, width: cols, height: rows, bounds: { minX: west, maxX: east, minY: south, maxY: north }, noData: NaN, stepM: Math.round(step), known };
}

/** The study box widened by a margin, so catchments are not cut at its edge. */
export function withMargin(bounds, km) {
  const midLat = (bounds.south + bounds.north) / 2;
  const dLat = km / 110.574;
  const dLon = km / (111.32 * Math.cos(midLat * Math.PI / 180));
  return { west: bounds.west - dLon, east: bounds.east + dLon, south: bounds.south - dLat, north: bounds.north + dLat };
}

/** The margin a box deserves: a tenth of its larger side, at least 1 km, at most 5. */
export function autoMarginKm(bounds) {
  const midLat = (bounds.south + bounds.north) / 2;
  const w = (bounds.east - bounds.west) * 111.32 * Math.cos(midLat * Math.PI / 180);
  const h = (bounds.north - bounds.south) * 110.574;
  return Math.max(1, Math.min(5, 0.1 * Math.max(w, h)));
}

/** A point-in-polygon sampler over a layer's GeoJSON features (bbox first). */
export function samplerOver(features, pick = (p) => p) {
  const list = (features || []).map((f) => {
    const polys = polygonsOf(f.geometry);
    if (!polys.length) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    polys.forEach((rings) => rings[0].forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }));
    return { props: f.properties || {}, polys, minX, minY, maxX, maxY };
  }).filter(Boolean);
  return (lat, lon) => {
    for (const e of list) {
      if (lon < e.minX || lon > e.maxX || lat < e.minY || lat > e.maxY) continue;
      for (const rings of e.polys) {
        if (!inRing(rings[0], lon, lat)) continue;
        if (rings.slice(1).some((h) => inRing(h, lon, lat))) continue;
        return pick(e.props);
      }
    }
    return null;
  };
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The text the material is read from, whichever map answered. */
export function lithologyOf(props = {}) {
  return props.lith || props.rcs_d || props.lex_rcs_d || props.lex_d || props.RCS_D
    || props.unit_label || props.class || null;
}

/**
 * A MAP'S WORDS, AS THE DATABASE'S. GLiM calls a whole class "Unconsolidated
 * Sediments", which the database cannot resolve — and an unresolved lithology
 * takes the no-information PRIOR, φ′ 40° and c′ 8 MPa, an intact rock's
 * strength on loose sediment. GLiM defines the class as alluvial, fluvial and
 * glacial deposits; it reads as alluvium.
 */
export function groundText(lith) {
  if (!lith) return null;
  if (/unconsolidated sediments?/i.test(lith)) return "alluvium";
  return lith;
}

/** Soil or rock, by which the resolved constituents mostly are. */
export function stateOf(text, resolve = resolveLithology) {
  const rows = text ? resolve(text) : [];
  if (!rows.length) return null;
  const soil = rows.reduce((s, r) => s + (r.entry?.state === "soil" ? r.fraction : 0), 0);
  return soil >= 0.5 ? "soil" : "rock";
}

/** A FAO soil unit's topsoil texture, or peat for a Histosol, or nothing where it is not a soil. */
export function textureOf(props = {}) {
  if (!props || props.group === "Not a soil") return null;
  if (/histosol/i.test(`${props.group || ""} ${props.name || ""}`)) return { peat: true };
  const t = { sand: props.sand_pct, silt: props.silt_pct, clay: props.clay_pct };
  return [t.sand, t.silt, t.clay].some(Number.isFinite) ? t : null;
}

/** The static answer at one cell for one recharge flux. */
export function cellAnswer({ q, cell, contour, lateral = 1 }) {
  const W = steadyWetness({ q, b: contour, K: cell.K, zs: cell.zs, slopeRad: cell.slopeRad, lateral });
  const m = planeWetness(W, cell.zs, cell.zf);
  const fos = factorOfSafety({ slopeRad: cell.slopeRad, c: cell.c, phi: cell.phi, gamma: cell.gamma, zf: cell.zf, m });
  return { W, m, fos };
}

/**
 * ONE STATIC MODEL for one rainfall map: recharge from the map (capped at the
 * ground's Ks where it infiltrates), routed down the MFD topology, then the
 * steady water table and the factor of safety at every modelled cell. Pure
 * given its arrays.
 */
export function staticStep({ rainMm, windowH, cells, topo, infiltration = true, lateral = LATERAL_FACTOR }) {
  const n = cells.K.length;
  const source = new Float64Array(n);
  const perSecond = 1 / (1000 * windowH * 3600);
  for (let i = 0; i < n; i += 1) {
    const P = rainMm[i];
    if (!Number.isFinite(P) || !cells.data[i]) continue;
    let r = P * perSecond;
    if (infiltration && r > cells.K[i]) r = cells.K[i];
    source[i] = r * topo.cellArea;
  }
  const q = routeFlux(topo, source);
  const fos = new Float32Array(n).fill(NaN);
  const W = new Float32Array(n).fill(NaN);
  let failing = 0; let applicable = 0; let wSum = 0; let wN = 0;
  for (let i = 0; i < n; i += 1) {
    if (!cells.data[i]) continue;
    const answer = cellAnswer({ q: q[i], contour: topo.contour, lateral, cell: {
      K: cells.K[i], zs: cells.zs[i], zf: cells.zf[i], slopeRad: cells.slopeRad[i],
      c: cells.c[i], phi: cells.phi[i], gamma: cells.gamma[i],
    } });
    W[i] = answer.W;
    if (!cells.model[i]) continue;
    if (Number.isFinite(answer.W)) { wSum += answer.W; wN += 1; }
    if (!Number.isFinite(answer.fos)) continue;
    fos[i] = answer.fos; applicable += 1;
    if (answer.fos < 1) failing += 1;
  }
  return { fos, W, q, failing, applicable, meanW: wN ? wSum / wN : 0 };
}

/**
 * WHICH SOURCE SERVES WHICH DAY. Earth Engine's archives are history (CHIRPS
 * runs about six weeks behind); GFS is the only thing with tomorrow in it. So
 * "auto" takes every day Earth Engine holds from Earth Engine — the higher
 * resolution — and every later day from GFS, and one date range reads straight
 * from last spring into next week. A named source takes every day from itself
 * and refuses the days it does not have rather than quietly borrowing them.
 */
export function planRain({ source, start, end, windowH = 24, today, gee = null, covers = true }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "")) return { ok: false, message: "Give a start and an end date." };
  if (start > end) return { ok: false, message: "The start is after the end." };
  const windowDays = Math.max(1, Math.round(windowH / 24));
  const first = dayOf(Date.parse(`${start}T00:00:00Z`) - (windowDays - 1) * 86400000);
  const days = daysBetween(first, end);
  const lastForecast = dayOf(Date.parse(`${today}T00:00:00Z`) + 15 * 86400000);
  if (end > lastForecast) return { ok: false, message: `Nothing forecasts past ${lastForecast}; the window ends ${end}.` };
  const sourceOf = new Map();
  const geeUsable = gee && covers;
  for (const d of days) {
    const inGee = geeUsable && d >= gee.first && d <= gee.last;
    if (source !== "auto" && source !== "gfs") {
      if (!covers) return { ok: false, message: `${GEE_RAIN_SOURCES[source]?.short || source} does not reach this area (it stops at ${GEE_RAIN_SOURCES[source]?.maxLat}° of latitude).` };
      if (!gee) return { ok: false, message: "Earth Engine did not say which dates it holds." };
      if (!inGee) return { ok: false, message: `${GEE_RAIN_SOURCES[source].short} holds ${gee.first} to ${gee.last}; the window needs ${d}. Choose Auto to let GFS take the days after.` };
      sourceOf.set(d, "gee");
    } else if (source === "auto" && inGee) sourceOf.set(d, "gee");
    else {
      if (d < GFS_ARCHIVE_START) return { ok: false, message: `GFS begins ${GFS_ARCHIVE_START} and ${geeUsable ? "Earth Engine does not hold" : "Earth Engine cannot serve this area for"} ${d}.` };
      sourceOf.set(d, "gfs");
    }
  }
  const geeDays = days.filter((d) => sourceOf.get(d) === "gee");
  const gfsDays = days.filter((d) => sourceOf.get(d) === "gfs");
  return { ok: true, days, windowDays, sourceOf, geeDays, gfsDays, start, end };
}

/** One map per day, each the sum of the window's days, whichever source each day came from. */
export function dailyFrames(plan) {
  const frames = [];
  const at = new Map(plan.days.map((d, k) => [d, k]));
  for (const d of plan.days) {
    if (d < plan.start) continue;
    const k = at.get(d);
    const parts = plan.days.slice(k - plan.windowDays + 1, k + 1).map((day) => ({ day, source: plan.sourceOf.get(day) }));
    const sources = [...new Set(parts.map((p) => p.source))];
    frames.push({ time: d, from: parts[0].day, parts, source: sources.length > 1 ? "mixed" : sources[0] });
  }
  return frames;
}

/* ── state ──────────────────────────────────────────────────────────────── */

const state = {
  bounds: null, rain: null, ground: null, run: null, step: -1, playing: false, view: "fos",
  params: { strength: "peak", root: 0, infiltration: true, lateral: LATERAL_FACTOR },
};

const STEPS = [
  { id: "area", n: 1, title: "Study area", blurb: "Where the model runs." },
  { id: "rain", n: 2, title: "Rainfall maps", blurb: "Earth Engine's historical archives and NOAA's GFS over the area, by date: each map the rain over the hours before it." },
  { id: "ground", n: 3, title: "Ground", blurb: "DEM, routing, soil thickness and material — built once." },
  { id: "hydro", n: 4, title: "Hydrogeology", blurb: "The steady water table each rainfall map would build." },
  { id: "fos", n: 5, title: "Factor of safety", blurb: "Infinite slope, on the failure plane in the soil." },
  { id: "run", n: 6, title: "Run and play", blurb: "One static model per rainfall map, through the bar." },
];

export function readiness(s = state) {
  return {
    area: s.bounds ? "done" : "ready",
    rain: s.rain ? "done" : s.bounds ? "ready" : "blocked",
    ground: s.ground ? "done" : s.bounds ? "ready" : "blocked",
    hydro: s.ground ? "done" : "ready",
    fos: "ready",
    run: s.run ? "done" : (s.rain && s.ground) ? "ready" : "blocked",
  };
}

const byId = (id) => document.getElementById(id);
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => `${Math.round((100 * a) / Math.max(1, b))}%`;

function say(id, text, kind = "") {
  const node = byId(`lsp-status-${id}`);
  if (node) { node.textContent = text; node.dataset.kind = kind; }
}

function markStates() {
  const r = readiness();
  STEPS.forEach((s) => {
    const card = byId(`lsp-card-${s.id}`);
    if (!card) return;
    card.dataset.state = r[s.id];
    const pill = card.querySelector(".lsp-pill");
    if (pill) pill.textContent = { done: "done", ready: "ready", blocked: "needs a step above" }[r[s.id]];
    card.querySelectorAll("button, select, input").forEach((el) => {
      if (el.dataset.always) return;
      el.disabled = r[s.id] === "blocked";
    });
  });
}

const STYLE = `
.lsp-chart { display: grid; gap: 0.5rem; }
.lsp-card { border: 1px solid rgba(var(--nav-accent-rgb, 255,43,214), 0.35); border-radius: 0.6rem; padding: 0.55rem 0.65rem; background: var(--skin-card-ground, rgb(24,13,47)); position: relative; }
.lsp-card + .lsp-card::before { content: "\\2193"; position: absolute; top: -0.95rem; left: 1.1rem; color: var(--nav-accent, #ff2bd6); font-size: 0.8rem; }
.lsp-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; }
.lsp-n { display: inline-grid; place-items: center; width: 1.4rem; height: 1.4rem; border-radius: 999px; background: var(--nav-accent, #ff2bd6); color: #1a0520; font: 700 0.7rem "Exo 2", sans-serif; }
.lsp-title { font: 600 0.76rem "Exo 2", sans-serif; letter-spacing: 0.06em; text-transform: uppercase; flex: 1 1 auto; }
.lsp-pill { font-size: 0.66rem; padding: 0.1rem 0.45rem; border-radius: 999px; border: 1px solid rgba(255,255,255,0.25); opacity: 0.85; }
.lsp-card[data-state="done"] .lsp-pill { border-color: var(--skin-data, #52e4e8); color: var(--skin-data, #52e4e8); }
.lsp-card[data-state="blocked"] { opacity: 0.55; }
.lsp-card[data-state="blocked"] .lsp-pill { color: #f5a742; border-color: #f5a742; }
.lsp-blurb { font-size: 0.72rem; opacity: 0.75; margin: 0 0 0.35rem; }
.lsp-status { font-size: 0.72rem; margin: 0.35rem 0 0; min-height: 1em; white-space: pre-line; }
.lsp-status[data-kind="error"] { color: #ff7b7b; }
.lsp-eq { font: 0.7rem/1.45 ui-monospace, Menlo, monospace; opacity: 0.85; margin: 0.25rem 0; white-space: pre-line; }
.lsp-card .row { margin: 0.2rem 0; }
.lsp-maps { display: grid; gap: 0.2rem; margin: 0.25rem 0; font-size: 0.72rem; }
.lsp-map { display: flex; align-items: center; gap: 0.4rem; }
.lsp-map span { flex: 1 1 auto; min-width: 0; }
.lsp-map b { font-weight: 600; }
.lsp-map .button { flex: 0 0 auto; padding: 0.12rem 0.5rem; font-size: 0.66rem; }
`;

function ensureStyle() {
  if (document.getElementById("lsp-style")) return;
  const tag = document.createElement("style");
  tag.id = "lsp-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

function card(step, body) {
  return `<div class="lsp-card" id="lsp-card-${step.id}" data-state="ready">
    <div class="lsp-head"><span class="lsp-n">${step.n}</span><span class="lsp-title">${esc(step.title)}</span><span class="lsp-pill">ready</span></div>
    <p class="lsp-blurb">${esc(step.blurb)}</p>
    ${body}
    <p class="lsp-status" id="lsp-status-${step.id}" aria-live="polite"></p>
  </div>`;
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function render(host) {
  ensureStyle();
  const now = Date.now();
  host.innerHTML = `<div class="lsp-chart">
    ${card(STEPS[0], `
      <div class="row"><label for="lsp-extent">Extent</label><select id="lsp-extent" class="input"><option value="drawn">Drawn / boxed area</option></select></div>
      <div class="gis-btn-row"><button type="button" class="button secondary" id="lsp-draw">Draw an area</button><button type="button" class="button" id="lsp-use">Use this extent</button></div>`)}
    ${card(STEPS[1], `
      <div class="row"><label for="lsp-rain-source" title="Earth Engine's archives are history at the highest resolution there is; GFS is the only source with the days ahead. Auto reads one date range from both: Earth Engine for every day it holds, GFS after.">Source</label><select id="lsp-rain-source" class="input">
        <option value="auto" selected>Auto — Earth Engine for the past, GFS after</option>
        <option value="gfs">GFS (NOAA) — hourly, ~13 km, Mar 2021 to +15 days</option>
        <option value="chirps">Earth Engine CHIRPS — daily, ~5.5 km, 1981 to ~6 weeks ago, 50°S–50°N</option>
        <option value="imerg">Earth Engine GPM IMERG — daily, ~11 km (needs the service redeployed)</option>
        <option value="era5land">Earth Engine ERA5-Land — daily, ~9 km (needs the service redeployed)</option></select></div>
      <div class="row"><label for="lsp-rain-start">From</label><input id="lsp-rain-start" class="input" type="date" value="${isoDay(now)}"></div>
      <div class="row"><label for="lsp-rain-end">To</label><input id="lsp-rain-end" class="input" type="date" value="${isoDay(now + 6 * 86400000)}"></div>
      <div class="gis-btn-row"><button type="button" class="button secondary" id="lsp-rain-next">Next 7 days</button><button type="button" class="button secondary" id="lsp-rain-past">Past 7 days</button></div>
      <div class="row"><label for="lsp-rain-window" title="Each map is the GFS rain summed over this many hours before it. The slope model is a steady state, so this is the duration the recharge is assumed to be sustained over — a day is the usual choice; longer carries more of the antecedent wet.">Each map: rain over the last</label><select id="lsp-rain-window" class="input">
        <option value="6">6 h</option><option value="12">12 h</option><option value="24" selected>24 h</option><option value="48">48 h</option><option value="72">72 h</option></select></div>
      <div class="row"><label for="lsp-rain-every">One map every</label><select id="lsp-rain-every" class="input">
        <option value="1">1 h</option><option value="3">3 h</option><option value="6" selected>6 h</option><option value="12">12 h</option><option value="24">24 h</option></select></div>
      <p class="compact-copy" style="margin:0;opacity:0.8">Earth Engine's archives are daily, so a series with any Earth Engine day in it is one map a day, each window rounded to whole days.</p>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-rain-fetch">Fetch rainfall</button></div>`)}
    ${card(STEPS[2], `
      <div class="row"><label for="lsp-ground-cells" title="The model's own grid over the area plus its margin. The DEM is read at the level the area deserves and thinned to this many cells.">Cells (max)</label><select id="lsp-ground-cells" class="input"><option value="40000">40,000</option><option value="90000" selected>90,000</option><option value="160000">160,000</option><option value="250000">250,000</option><option value="500000">500,000 (slow)</option></select></div>
      <div class="row"><label for="lsp-ground-margin" title="Ground outside the study area whose water drains into it. Without a margin every catchment is cut at the box's edge.">Upslope margin</label><select id="lsp-ground-margin" class="input"><option value="auto" selected>Auto (a tenth of the area)</option><option value="0.5">0.5 km</option><option value="1">1 km</option><option value="2">2 km</option><option value="5">5 km</option></select></div>
      <div class="lsp-maps" id="lsp-maps"></div>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-ground-read">Read the ground</button></div>`)}
    ${card(STEPS[3], `
      <div class="lsp-eq">r = min(P / Δt, Ks)            recharge, what infiltrates
q = Σ upslope r · A             routed, multiple flow directions
h = min(z_s, q / (b · F·Ks · sin β))  the steady water table
m = (h − (z_s − z_f)) / z_f     water on the failure plane</div>
      <div class="row"><label for="lsp-lateral" title="Downslope flow runs through macropores and soil pipes one to two orders of magnitude faster than the vertical matrix Ks a pedotransfer function or a lab gives. 30 puts a typical loam at the low end of the transmissivities Montgomery &amp; Dietrich (1994) used; 1 is the matrix alone, and saturates almost everything.">Lateral flow F (× Ks)</label><select id="lsp-lateral" class="input" data-always="1"><option value="1">1 — the matrix alone</option><option value="10">10</option><option value="30" selected>30</option><option value="100">100</option><option value="300">300</option></select></div>
      <div class="row"><label for="lsp-infiltration" title="Rain faster than the ground's saturated conductivity runs off instead of recharging it.">Infiltration capped at Ks</label><span class="checkbox-wrap"><input id="lsp-infiltration" type="checkbox" checked data-always="1"></span></div>`)}
    ${card(STEPS[4], `
      <div class="lsp-eq">FoS = [c′ + c_r + (γ − m·γw)·z_f·cos²β·tan φ′] / [γ·z_f·sin β·cos β]</div>
      <div class="row"><label for="lsp-strength" title="Peak for a first-time failure; residual where the ground has slid before and the shear surface is already polished.">Strength</label><select id="lsp-strength" class="input" data-always="1"><option value="peak" selected>Peak — first-time failure</option><option value="residual">Residual — reactivation</option></select></div>
      <div class="row"><label for="lsp-root" title="The extra cohesion roots give a soil: 0 bare, a few kPa grassland, 5–20 kPa forest.">Root cohesion (kPa)</label><input id="lsp-root" class="input" type="number" min="0" max="40" step="1" value="0" data-always="1"></div>
      <p class="compact-copy" style="margin:0;opacity:0.8">z_f is the soil column capped at ${SHALLOW_FAILURE_CAP_M} m (a shallow translational slide). Every cell is modelled: on gentle ground the factor of safety is large (capped at ${FOS_CAP}) and falls in "stable". Classes: failure &lt; 1, marginal &lt; 1.1, low margin &lt; 1.3, adequate &lt; 1.5, stable.</p>`)}
    ${card(STEPS[5], `
      <div class="row"><label for="lsp-view">Show</label><select id="lsp-view" class="input" data-always="1">
        <option value="fos" selected>Factor of safety — this map</option>
        <option value="wet">Saturation h / z_s — this map</option>
        <option value="rain">GFS rainfall — this map</option>
        <option value="minfos">Lowest factor of safety over the window</option>
        <option value="crit">Rainfall to fail (static, mm/day)</option></select></div>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-run">Run and play</button><button type="button" class="button secondary" id="lsp-clear">Clear</button></div>`)}
  </div>`;
  wire();
  drawMaps();
  markStates();
}

function wire() {
  const extent = byId("lsp-extent");
  refreshPolygonOptions(extent, "drawn", { allLayers: true });
  window.addEventListener("geoid-gis:layers-changed", () => {
    try { refreshPolygonOptions(extent, extent.value || "drawn", { allLayers: true }); } catch (e) { /* redraw later */ }
    drawMaps();
  });
  window.GeoIDImportManager?.onChange?.(() => drawMaps());
  byId("lsp-draw").addEventListener("click", () => { promptDrawTool(); say("area", "Draw the area on the globe, press Done, then Use this extent."); });
  byId("lsp-use").addEventListener("click", () => {
    const b = resolvePolygonExtent(extent.value, { arm: false });
    if (!b || ![b.west, b.south, b.east, b.north].every(Number.isFinite)) { say("area", "No area yet — draw one, or pick a layer.", "error"); return; }
    clear({ keepInputs: true });
    state.bounds = b; state.rain = null; state.ground = null;
    const w = (b.east - b.west) * 111.32 * Math.cos(((b.south + b.north) / 2) * Math.PI / 180);
    const h = (b.north - b.south) * 110.574;
    say("area", `${w.toFixed(1)} × ${h.toFixed(1)} km — ${b.west.toFixed(3)} to ${b.east.toFixed(3)}°E, ${b.south.toFixed(3)} to ${b.north.toFixed(3)}°N`);
    ["rain", "ground", "hydro", "run"].forEach((id) => say(id, ""));
    markStates();
  });
  const setDates = (from, to) => { byId("lsp-rain-start").value = isoDay(from); byId("lsp-rain-end").value = isoDay(to); };
  byId("lsp-rain-next").addEventListener("click", () => setDates(Date.now(), Date.now() + 6 * 86400000));
  byId("lsp-rain-past").addEventListener("click", () => setDates(Date.now() - 7 * 86400000, Date.now() - 86400000));
  byId("lsp-rain-fetch").addEventListener("click", () => void fetchRain());
  byId("lsp-ground-read").addEventListener("click", () => void readGround());
  byId("lsp-infiltration").addEventListener("change", (e) => { state.params.infiltration = e.target.checked; rerun(); });
  byId("lsp-lateral").addEventListener("change", (e) => { state.params.lateral = Number(e.target.value) || LATERAL_FACTOR; describeStatic(); rerun(); });
  byId("lsp-strength").addEventListener("change", (e) => { state.params.strength = e.target.value; remater(); });
  const root = byId("lsp-root");
  root.addEventListener("keydown", (e) => e.stopPropagation());
  root.addEventListener("change", () => { state.params.root = Math.max(0, Number(root.value) || 0); remater(); });
  byId("lsp-view").addEventListener("change", (e) => { state.view = e.target.value; showStep(Math.max(0, state.step)); });
  byId("lsp-run").addEventListener("click", () => void run());
  byId("lsp-clear").addEventListener("click", () => clear());
}

/* ── the ground maps: which are on, and a door to the ones that are not ──── */

const SOIL_MAP = /soils of the world|fao/i;
const SUPERFICIAL = /superficial|drift|quaternary/i;
const BEDROCK = /world geology|macrostrat|glim|surface lithology|geolog|lithology|bedrock/i;

function groundLayers() {
  const layers = (window.GeoIDImportManager?.getLayers?.() || []).filter((l) => l.status === "loaded");
  const soil = layers.find((l) => SOIL_MAP.test(l.name || "")) || null;
  const superficial = layers.find((l) => SUPERFICIAL.test(l.name || "") && !SOIL_MAP.test(l.name || "")) || null;
  const bedrock = layers.find((l) => l !== superficial && !SOIL_MAP.test(l.name || "") && BEDROCK.test(l.name || "")
    && !/risk|forecast|factor of safety/i.test(l.name || "")) || null;
  return { soil, superficial, bedrock };
}

function drawMaps() {
  const host = byId("lsp-maps");
  if (!host) return;
  const { soil, superficial, bedrock } = groundLayers();
  const row = (label, layer, load, loadLabel) => `<div class="lsp-map"><span><b>${esc(label)}</b> — ${layer ? esc(layer.name) : "not on the globe"}</span>${!layer && load ? `<button type="button" class="button secondary" data-load="${load}" data-always="1">${esc(loadLabel)}</button>` : ""}</div>`;
  // The doors are drawn whether or not the seams exist yet and the seam is
  // looked up at the PRESS: this runs at boot, before the geology and soil
  // modules have published, and a door decided then was never drawn at all.
  host.innerHTML = row("Material", superficial || bedrock, "geology", "Load world geology")
    + row("Texture", soil, "soil", "Load the soil map")
    + `<div class="lsp-map"><span><b>Thickness</b> — Pelletier et al. (2016), read directly</span></div>`
    + `<div class="lsp-map"><span><b>Properties</b> — the rock-properties database</span></div>`;
  host.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      const load = b.dataset.load === "geology" ? () => window.GeoIDGeology?.load?.("macrostrat-units")
        : () => window.GeoIDSoilCover?.load?.();
      const got = await load();
      if (got === undefined && !(b.dataset.load === "geology" ? window.GeoIDGeology?.load : window.GeoIDSoilCover?.load)) {
        throw new Error("the map's module has not loaded yet — try again in a moment");
      }
    } catch (e) { say("ground", `That map could not be loaded: ${e.message}`, "error"); }
    drawMaps();
  }));
}

/* ── step 2: GFS rainfall maps ──────────────────────────────────────────── */

async function fetchRain() {
  const b = state.bounds;
  if (!b) return;
  const source = byId("lsp-rain-source").value;
  const windowH = Number(byId("lsp-rain-window").value) || 24;
  const everyH = Number(byId("lsp-rain-every").value) || 6;
  const start = byId("lsp-rain-start").value; const end = byId("lsp-rain-end").value;
  // The nodes and pictures must cover the MARGIN too: water falling there drains into the area.
  const cover = withMargin(b, marginKm());
  try {
    state.rain = source === "gfs"
      ? await fetchGfsSeries({ cover, start, end, windowH, everyH })
      : await fetchDailySeries({ cover, source, start, end, windowH });
    state.run = null;
    say("rain", state.rain.summary);
  } catch (error) {
    say("rain", `Rainfall could not be read: ${error.message}`, "error");
  }
  markStates();
}

/** GFS alone: hourly, so any window and any interval. */
async function fetchGfsSeries({ cover, start, end, windowH, everyH }) {
  const win = fetchWindow({ start, end, windowH });
  if (!win.ok) throw new Error(win.message);
  say("rain", "Asking GFS…");
  const got = await fetchGfsNodes(cover, { from: win.from, to: win.to }, {
    onProgress: (done, all) => say("rain", `Asking GFS… ${done} of ${all} points`),
  });
  const series = rainfallFrames(got.times, got.nodes, { start: win.start, windowH, everyH });
  if (!series.frames.length) throw new Error("no complete rainfall window in those dates");
  let maxAcc = 0; let wettest = null;
  series.frames.forEach((f) => { series.accumulation(f).forEach((v) => { if (v > maxAcc) { maxAcc = v; wettest = f; } }); });
  const shape = got.grid.regular ? `${got.grid.lats.length} × ${got.grid.lons.length} GFS nodes, ~13 km apart, drawn bilinearly`
    : `${got.nodes.length} GFS nodes (irregular here — read by distance)`;
  const frames = series.frames.map((f) => ({ time: f.time, from: f.from, source: "gfs",
    pieces: [{ kind: "gfs", lo: f.index - windowH + 1, hi: f.index }] }));
  return {
    kind: "gfs", frames, windowH, everyH, window: win, cover, gfs: { ...got, ...series }, gee: null,
    credit: GFS_CREDIT, sourceLabel: (fr) => "GFS",
    summary: `${frames.length} rainfall maps from GFS, one every ${everyH} h, each the rain over the previous ${windowH} h${series.stride > 1 ? ` (every ${series.stride}th kept)` : ""}. ${shape}. `
      + `Wettest map ${wettest ? wettest.time.replace("T", " ") : "—"}: ${maxAcc.toFixed(0)} mm in ${windowH} h at a node.`
      + `${series.missing ? ` ${series.missing} node-hours had no value and count as dry.` : ""} ${GFS_CREDIT}.`,
  };
}

/** Earth Engine, or Earth Engine then GFS: a map a day, each day from whichever holds it. */
async function fetchDailySeries({ cover, source, start, end, windowH }) {
  const geeKey = source === "auto" ? "chirps" : source;
  const geeSource = GEE_RAIN_SOURCES[geeKey];
  const covers = coversBox(geeKey, cover);
  let gee = null; let geeProblem = null;
  if (covers) {
    say("rain", `Asking Earth Engine which dates ${geeSource.short} holds…`);
    try { gee = await geeRainDates(geeKey); } catch (error) { geeProblem = error.message; }
  }
  if (!gee && source !== "auto") {
    throw new Error(covers ? `Earth Engine ${geeSource.short}: ${geeProblem}` : `${geeSource.short} does not reach this area (it stops at ${geeSource.maxLat}° of latitude).`);
  }
  const plan = planRain({ source, start, end, windowH, today: dayOf(Date.now()), gee, covers });
  if (!plan.ok) throw new Error(plan.message);
  let grids = [];
  if (plan.geeDays.length) {
    grids = await fetchGeeRainDays(geeKey, cover, plan.geeDays, {
      onProgress: (done, all) => say("rain", `Earth Engine ${geeSource.short}: ${done} of ${all} days (one render each)…`),
    });
  }
  let gfs = null;
  if (plan.gfsDays.length) {
    say("rain", "Asking GFS for the days Earth Engine does not hold…");
    const from = plan.gfsDays[0];
    const lastDay = plan.gfsDays[plan.gfsDays.length - 1];
    const cap = dayOf(Date.now() + 15 * 86400000);
    const to = dayOf(Date.parse(`${lastDay}T00:00:00Z`) + 86400000) > cap ? lastDay : dayOf(Date.parse(`${lastDay}T00:00:00Z`) + 86400000);
    const got = await fetchGfsNodes(cover, { from, to }, { onProgress: (done, all) => say("rain", `Asking GFS… ${done} of ${all} points`) });
    const series = rainfallFrames(got.times, got.nodes, { start: from, windowH: 1, everyH: 1 });
    gfs = { ...got, ...series };
  }
  const byDay = new Map(plan.geeDays.map((d, k) => [d, k]));
  const frames = dailyFrames(plan).map((f) => ({
    ...f,
    pieces: f.parts.map((p) => {
      if (p.source === "gee") return { kind: "gee", grid: byDay.get(p.day) };
      const hours = dayHours(gfs.times, p.day);
      return hours ? { kind: "gfs", lo: hours.lo, hi: hours.hi } : { kind: "none", day: p.day };
    }),
  }));
  // What each day's picture held, to say it plainly.
  let geeMax = 0; let geeNaN = 0; let geeCells = 0;
  grids.forEach((gd) => gd.values.forEach((v) => { geeCells += 1; if (Number.isFinite(v)) { if (v > geeMax) geeMax = v; } else geeNaN += 1; }));
  const label = (fr) => (fr.source === "gee" ? geeSource.short : fr.source === "gfs" ? "GFS" : `${geeSource.short} and GFS`);
  const parts = [];
  if (plan.geeDays.length) parts.push(`${plan.geeDays.length} day${plan.geeDays.length > 1 ? "s" : ""} from Earth Engine ${geeSource.short} (${geeSource.res}, daily; wettest day ${geeMax.toFixed(0)} mm at a pixel${geeNaN / Math.max(1, geeCells) > 0.01 ? `; ${Math.round((100 * geeNaN) / geeCells)}% of the picture has no value — sea, or beyond the archive — and counts as dry` : ""})`);
  if (plan.gfsDays.length) parts.push(`${plan.gfsDays.length} day${plan.gfsDays.length > 1 ? "s" : ""} from GFS (~13 km, hourly)`);
  const why = source === "auto" && !gee ? (covers ? ` Earth Engine did not answer (${geeProblem}), so GFS takes every day.` : ` ${geeSource.short} stops at ${geeSource.maxLat}° of latitude, so GFS takes every day here.`) : "";
  const handover = plan.geeDays.length && plan.gfsDays.length ? ` The handover is ${plan.gfsDays[0]}: a change of source there is not a change in the rain.` : "";
  const credits = [plan.geeDays.length ? geeSource.credit : null, plan.gfsDays.length ? GFS_CREDIT : null].filter(Boolean).join("; ");
  return {
    kind: "daily", frames, windowH: plan.windowDays * 24, everyH: 24, window: { start, end }, cover,
    gfs, gee: { key: geeKey, source: geeSource, grids }, plan, credit: credits, sourceLabel: label,
    summary: `${frames.length} daily rainfall maps, each the rain over ${plan.windowDays} day${plan.windowDays > 1 ? "s" : ""}: ${parts.join("; ")}.${handover}${why} ${credits}.`,
  };
}

/* ── step 3: the ground, built once ─────────────────────────────────────── */

function marginKm() {
  const v = byId("lsp-ground-margin")?.value || "auto";
  return v === "auto" && state.bounds ? autoMarginKm(state.bounds) : Math.max(0, Number(v) || 1);
}

async function borrow(layer, box) {
  if (!layer) return null;
  if (typeof layer.featuresIn === "function") {
    try {
      const got = await layer.featuresIn({ minX: box.west, maxX: box.east, minY: box.south, maxY: box.north });
      return got?.features || layer.features || [];
    } catch (e) { return layer.features || []; }
  }
  return layer.features || [];
}

/** Which rock-properties numbers a cell's column takes; cached per distinct ground. */
function materialTable() {
  const cache = new Map();
  const list = [];
  const rp = (name, key) => parameterValue(name, key);
  const state_ = (text) => stateOf(text);
  return {
    list,
    indexOf(lith, texture) {
      const key = `${lith || ""}|${texture ? (texture.peat ? "peat" : `${Math.round(texture.sand ?? -1)}/${Math.round(texture.silt ?? -1)}/${Math.round(texture.clay ?? -1)}`) : ""}`;
      if (cache.has(key)) return cache.get(key);
      const text = groundText(lith);
      const mat = texture?.peat
        ? columnMaterial({ lith: "peat", rp, state: state_, strength: state.params.strength, rootCohesionKPa: state.params.root })
        : columnMaterial({ lith: text, texture, rp, state: state_, strength: state.params.strength, rootCohesionKPa: state.params.root });
      mat.lith = lith; mat.texture = texture;
      if (texture?.peat) mat.from = "the soil map (a Histosol — peat)";
      list.push(mat); cache.set(key, list.length - 1);
      return list.length - 1;
    },
  };
}

async function readGround() {
  const b = state.bounds;
  if (!b) return;
  const maxCells = Number(byId("lsp-ground-cells").value) || 90000;
  const margin = marginKm();
  const eb = withMargin(b, margin);
  const { soil, superficial, bedrock } = groundLayers();
  const borrowed = [];
  try {
    say("ground", "Reading the elevation…");
    const dem = window.GeoIDDem;
    let label = "the viewer's elevation model";
    let got = null;
    if (dem?.ensure) {
      got = await dem.ensure(eb, { maxTiles: 256 });
      if (got?.ok) label = `streamed DEM at zoom ${got.zoom} (${Math.round(dem.metresPerPixel(got.zoom, (b.south + b.north) / 2))} m posts)`;
    }
    const heightAt = (lat, lon) => {
      const h = dem?.heightAt?.(lat, lon);
      return Number.isFinite(h) ? h : window.GeoIDViewer?.sampleElevationMeters?.(lat, lon);
    };
    const grid = demGridFor(eb, heightAt, { maxCells });
    if (!grid.known) throw new Error("no elevation under the area");
    say("ground", "Reading the slope at the DEM's own posts…");
    await tick();
    const grad = slopeOf(grid);
    /**
     * THE SLOPE IS READ AT THE DEM'S OWN POSTS, not off the thinned grid. The
     * model's cells are 100 m and more over any sizeable area, and a slope
     * taken across 100 m cells flattens every hillside: over the Apennines
     * above Forlì the median came out 12.8° and nothing reached 35°, while a
     * saturated sand fails at 19° and the clays at 22°. Horn's stencil at the
     * native post spacing at each cell's centre is the slope the ground
     * actually has there; the routing stays on the model's grid.
     */
    let slopeFrom = `the model's ${grid.stepM} m grid`;
    const post = got?.ok && dem?.metresPerPixel ? Math.max(10, dem.metresPerPixel(got.zoom, (b.south + b.north) / 2)) : null;
    if (post && grid.stepM > 1.5 * post) {
      // One stencil at the centre is a POINT of the hillside and read as
      // speckle across a 100 m cell; four, a quarter-cell each way, averaged
      // (in the tangent, which is what the model uses), are the cell's slope
      // at the ground's own resolution.
      let replaced = 0;
      const cellLat = (eb.north - eb.south) / grid.height; const cellLon = (eb.east - eb.west) / grid.width;
      for (let y = 0; y < grid.height; y += 1) {
        const lat = eb.north - ((y + 0.5) / grid.height) * (eb.north - eb.south);
        const dy = post / 110574; const dx = post / (111320 * Math.cos(lat * Math.PI / 180));
        for (let x = 0; x < grid.width; x += 1) {
          const i = y * grid.width + x;
          if (!Number.isFinite(grid.band[i])) continue;
          const lon = eb.west + ((x + 0.5) / grid.width) * (eb.east - eb.west);
          const deg = cellSlope(heightAt, lat, lon, cellLat / 4, cellLon / 4, dx, dy, post);
          if (Number.isFinite(deg)) { grad.band[i] = deg; replaced += 1; }
        }
        if (y % 32 === 31) await tick();
      }
      if (replaced) slopeFrom = `the DEM's ${Math.round(post)} m posts, four stencils in each cell`;
    }
    say("ground", "Routing the water…");
    await tick();
    const filled = fillSinks(makeRaster(grid.band, grid.width, grid.height, grid.bounds, NaN));
    const topo = mfdTopology(filled, { exponent: 1.1 });
    const n = grid.width * grid.height;
    const area = routeFlux(topo, Float64Array.from(grid.band, (v) => (Number.isFinite(v) ? topo.cellArea : 0)));

    say("ground", "Reading the maps…");
    await tick();
    const superFeats = await borrow(superficial, eb); if (superficial?.restoreLive) borrowed.push(superficial);
    const bedFeats = await borrow(bedrock, eb); if (bedrock?.restoreLive) borrowed.push(bedrock);
    const soilFeats = await borrow(soil, eb); if (soil?.restoreLive) borrowed.push(soil);
    const superAt = superficial ? samplerOver(superFeats, lithologyOf) : null;
    const bedAt = bedrock ? samplerOver(bedFeats, lithologyOf) : null;
    const texAt = soil ? samplerOver(soilFeats, textureOf) : null;

    say("ground", "Reading the soil thickness…");
    let thickAt = null;
    try {
      const mod = await import(`./soil-thickness.js${search}`);
      const tg = await mod.thicknessGridFor(eb);
      if (tg) thickAt = (lat, lon) => mod.metresIn(tg, lat, lon);
    } catch (e) { /* the stated default serves */ }
    await loadRockProperties().catch(() => null);

    const table = materialTable();
    const cells = {
      data: new Uint8Array(n), model: new Uint8Array(n), thin: new Uint8Array(n), mat: new Int32Array(n).fill(-1),
      slopeRad: new Float32Array(n), zs: new Float32Array(n), zf: new Float32Array(n), K: new Float32Array(n),
      c: new Float32Array(n), phi: new Float32Array(n), gamma: new Float32Array(n), area: new Float32Array(n),
      depthFrom: new Uint8Array(n), lat: new Float32Array(n), lon: new Float32Array(n),
    };
    const tally = { deposit: 0, texture: 0, regolith: 0, thick: 0, thin: 0, model: 0, cells: 0, gentle: 0 };
    let x0 = Infinity; let x1 = -1; let y0 = Infinity; let y1 = -1;
    for (let y = 0; y < grid.height; y += 1) {
      const lat = eb.north - ((y + 0.5) / grid.height) * (eb.north - eb.south);
      for (let x = 0; x < grid.width; x += 1) {
        const i = y * grid.width + x;
        if (!Number.isFinite(grid.band[i])) continue;
        const lon = eb.west + ((x + 0.5) / grid.width) * (eb.east - eb.west);
        cells.data[i] = 1; cells.lat[i] = lat; cells.lon[i] = lon;
        const lith = (superAt && superAt(lat, lon)) || (bedAt && bedAt(lat, lon)) || null;
        const texture = texAt ? texAt(lat, lon) : null;
        const k = table.indexOf(lith, texture);
        const mat = table.list[k];
        cells.mat[i] = k;
        const t = thickAt ? thickAt(lat, lon) : null;
        const col = soilColumn(t, 2);
        cells.zs[i] = col.zs; cells.zf[i] = col.zf; cells.thin[i] = col.thin ? 1 : 0;
        cells.depthFrom[i] = Number.isFinite(t) ? 1 : 0;
        cells.K[i] = mat.K; cells.c[i] = mat.cohesionKPa; cells.phi[i] = mat.friction; cells.gamma[i] = mat.unitWeight;
        const deg = grad.band[i];
        cells.slopeRad[i] = Number.isFinite(deg) ? deg * Math.PI / 180 : 0;
        cells.area[i] = area[i];
        const inside = lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
        if (!inside) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        tally.cells += 1;
        if (/mapped deposit/.test(mat.from)) tally.deposit += 1;
        else if (/soil map/.test(mat.from)) tally.texture += 1; else tally.regolith += 1;
        if (Number.isFinite(t)) tally.thick += 1;
        if (col.thin) tally.thin += 1;
        if (!(deg >= 5)) tally.gentle += 1;
        cells.model[i] = 1; tally.model += 1;
      }
    }
    // The drawn sheet is the study area's own cells, bounded by their EDGES.
    const sub = { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    const cw = (eb.east - eb.west) / grid.width; const ch = (eb.north - eb.south) / grid.height;
    sub.bounds = { minX: eb.west + x0 * cw, maxX: eb.west + (x1 + 1) * cw, maxY: eb.north - y0 * ch, minY: eb.north - (y1 + 1) * ch };
    state.ground = { grid, eb, margin, topo, cells, sub, table, demLabel: label, slopeFrom, n, tally,
      maps: { soil: soil?.name || null, superficial: superficial?.name || null, bedrock: bedrock?.name || null } };
    if (state.rain) { state.rain.weights = null; state.rain.geePixels = null; }
    state.run = null;
    const kinds = [];
    if (tally.deposit) kinds.push(`${pct(tally.deposit, tally.cells)} a mapped deposit`);
    if (tally.texture) kinds.push(`${pct(tally.texture, tally.cells)} the soil map's texture`);
    if (tally.regolith) kinds.push(`${pct(tally.regolith, tally.cells)} regolith${bedrock || superficial ? " over the mapped rock" : ""}`);
    say("ground", `${tally.cells.toLocaleString()} cells at ${grid.stepM} m in the area (${(grid.width * grid.height).toLocaleString()} with a ${margin.toFixed(1)} km upslope margin), from ${label}; slope from ${slopeFrom}. `
      + `Material: ${kinds.join(", ")}.${soil ? "" : " Load the soil map for the topsoil texture — without it every column takes the database's regolith."} `
      + `Thickness from the model for ${pct(tally.thick, tally.cells)}${tally.thin ? ` (${pct(tally.thin, tally.cells)} under a metre, modelled as a veneer)` : ""}; ${pct(tally.gentle, tally.cells)} is gentle ground under 5°, modelled like the rest. `
      + `All ${tally.model.toLocaleString()} cells modelled.`, soil || bedrock || superficial ? "" : "error");
    describeStatic();
  } catch (error) {
    say("ground", `The ground could not be read: ${error.message}`, "error");
  } finally {
    borrowed.forEach((l) => { try { l.restoreLive?.(); } catch (e) { /* keep */ } });
  }
  markStates();
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A cell's slope: Horn at the posts at four points a quarter-cell from its centre, averaged in tan β. */
export function cellSlope(heightAt, lat, lon, qLat, qLon, dx, dy, post) {
  let sum = 0; let n = 0;
  for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const deg = hornAt(heightAt, lat + a * qLat, lon + b * qLon, dx, dy, post);
    if (Number.isFinite(deg)) { sum += Math.tan(deg * Math.PI / 180); n += 1; }
  }
  return n ? Math.atan(sum / n) * 180 / Math.PI : NaN;
}

/** Horn's slope in degrees at a point, from a height reader at a post spacing. */
export function hornAt(heightAt, lat, lon, dx, dy, post) {
  const z = (r, c) => heightAt(lat + r * dy, lon + c * dx);
  const a = z(1, -1); const bN = z(1, 0); const cc = z(1, 1);
  const d = z(0, -1); const f = z(0, 1);
  const g = z(-1, -1); const h = z(-1, 0); const k = z(-1, 1);
  if (![a, bN, cc, d, f, g, h, k].every(Number.isFinite)) return NaN;
  const dzdx = ((cc + 2 * f + k) - (a + 2 * d + g)) / (8 * post);
  const dzdy = ((a + 2 * bN + cc) - (g + 2 * h + k)) / (8 * post);
  return Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
}

/** The rainfall to fail at every modelled cell, and what it says about the area. */
function describeStatic() {
  const g = state.ground;
  if (!g) return;
  const { cells, topo, n } = g;
  const crit = new Float32Array(n).fill(NaN);
  let dry = 0; let never = 0; const finite = [];
  for (let i = 0; i < n; i += 1) {
    if (!cells.model[i]) continue;
    const r = criticalRecharge({ slopeRad: cells.slopeRad[i], c: cells.c[i], phi: cells.phi[i], gamma: cells.gamma[i],
      zs: cells.zs[i], zf: cells.zf[i], K: cells.K[i], b: topo.contour, areaM2: cells.area[i], lateral: state.params.lateral });
    crit[i] = r;
    if (r === 0) dry += 1; else if (r === Infinity) never += 1; else if (Number.isFinite(r)) finite.push(r);
  }
  finite.sort((a, b) => a - b);
  const med = finite.length ? finite[Math.floor(finite.length / 2)] : NaN;
  const p10 = finite.length ? finite[Math.floor(finite.length / 10)] : NaN;
  g.crit = crit;
  const total = g.tally.model;
  say("hydro", `Rainfall to fail, as steady recharge over each cell's catchment: ${pct(dry, total)} fail even dry, ${pct(never, total)} hold even saturated; `
    + `for the rest the median is ${Number.isFinite(med) ? med.toFixed(0) : "—"} mm/day and the wettest-to-fail tenth ${Number.isFinite(p10) ? p10.toFixed(0) : "—"} mm/day or less.`);
}

/** Changing the strength re-reads every cell's c′ and φ′ from its material; the rest stands. */
function remater() {
  const g = state.ground;
  if (!g) return;
  g.table.list.forEach((mat) => {
    const again = columnMaterial({ lith: mat.texture?.peat ? "peat" : groundText(mat.lith), texture: mat.texture?.peat ? null : mat.texture,
      rp: (name, key) => parameterValue(name, key), state: (t) => stateOf(t), strength: state.params.strength, rootCohesionKPa: state.params.root });
    mat.cohesionKPa = again.cohesionKPa; mat.friction = again.friction; mat.rootCohesionKPa = again.rootCohesionKPa; mat.strength = again.strength;
  });
  for (let i = 0; i < g.n; i += 1) {
    const k = g.cells.mat[i];
    if (k < 0) continue;
    g.cells.c[i] = g.table.list[k].cohesionKPa; g.cells.phi[i] = g.table.list[k].friction;
  }
  describeStatic();
  rerun();
}

function rerun() {
  if (state.run) void run({ keepStep: true });
}

/* ── step 6: every map through the static model, then the bar ───────────── */

function rainWeights() {
  const r = state.rain; const g = state.ground;
  if (r.weights?.n === g.n) return r.weights;
  const idx = new Int32Array(g.n * 4); const wt = new Float32Array(g.n * 4);
  for (let i = 0; i < g.n; i += 1) {
    if (!g.cells.data[i]) continue;
    const it = interpolatorFor(r.gfs.grid, r.gfs.nodes, g.cells.lat[i], g.cells.lon[i]);
    idx.set(it.idx, i * 4); wt.set(it.wt, i * 4);
  }
  r.weights = { idx, wt, n: g.n };
  return r.weights;
}

/** The pixel of an Earth Engine day each model cell reads; one table per picture geometry. */
function geePixels(grid) {
  const r = state.rain; const g = state.ground;
  r.geePixels = r.geePixels || new Map();
  const key = `${g.n}|${grid.width}x${grid.height}|${grid.bounds.minX},${grid.bounds.minY},${grid.bounds.maxX},${grid.bounds.maxY}`;
  if (r.geePixels.has(key)) return r.geePixels.get(key);
  const at = new Int32Array(g.n).fill(-1);
  for (let i = 0; i < g.n; i += 1) if (g.cells.data[i]) at[i] = pixelIndex(grid, g.cells.lat[i], g.cells.lon[i]);
  r.geePixels.set(key, at);
  return at;
}

/** A frame's rainfall at every model cell: the sum of its pieces, whichever source each came from. */
function rainMapFor(frame) {
  const r = state.rain; const g = state.ground;
  const out = new Float32Array(g.n);
  for (const p of frame.pieces) {
    if (p.kind === "gfs") {
      const acc = r.gfs.accumulateRange(p.lo, p.hi);
      const { idx, wt } = rainWeights();
      for (let i = 0; i < g.n; i += 1) {
        const o = i * 4;
        out[i] += wt[o] * acc[idx[o]] + wt[o + 1] * acc[idx[o + 1]] + wt[o + 2] * acc[idx[o + 2]] + wt[o + 3] * acc[idx[o + 3]];
      }
    } else if (p.kind === "gee") {
      const grid = r.gee.grids[p.grid];
      const at = geePixels(grid);
      for (let i = 0; i < g.n; i += 1) {
        const v = at[i] >= 0 ? grid.values[at[i]] : NaN;
        if (Number.isFinite(v)) out[i] += v;
      }
    }
  }
  for (let i = 0; i < g.n; i += 1) if (!g.cells.data[i]) out[i] = NaN;
  return out;
}

function modelFrame(k) {
  const r = state.rain; const g = state.ground;
  const rainMm = rainMapFor(r.frames[k]);
  const out = staticStep({ rainMm, windowH: r.windowH, cells: g.cells, topo: g.topo,
    infiltration: state.params.infiltration, lateral: state.params.lateral });
  return { ...out, rainMm };
}

const VIEW = {
  fos: { label: "Factor of safety", classes: FOS_CLASSES.map((c, i) => ({ ...c, lo: [0, 1, 1.1, 1.3, 1.5][i] })), classOf: fosClass },
  minfos: { label: "Lowest factor of safety over the window", classes: FOS_CLASSES.map((c, i) => ({ ...c, lo: [0, 1, 1.1, 1.3, 1.5][i] })), classOf: fosClass },
  wet: {
    label: "Saturation h / z_s",
    classes: [
      { max: 0.2, label: "under 0.2", colour: [237, 248, 251] }, { max: 0.4, label: "0.2–0.4", colour: [179, 205, 227] },
      { max: 0.6, label: "0.4–0.6", colour: [140, 150, 198] }, { max: 0.8, label: "0.6–0.8", colour: [136, 86, 167] },
      { max: 0.999, label: "0.8–1", colour: [129, 15, 124] }, { max: Infinity, label: "saturated", colour: [77, 0, 75] },
    ],
  },
  rain: {
    label: "GFS rainfall over the window (mm)",
    classes: [
      { max: 1, label: "under 1 mm", colour: [240, 240, 240] }, { max: 10, label: "1–10", colour: [198, 219, 239] },
      { max: 25, label: "10–25", colour: [107, 174, 214] }, { max: 50, label: "25–50", colour: [33, 113, 181] },
      { max: 100, label: "50–100", colour: [8, 48, 107] }, { max: 200, label: "100–200", colour: [106, 81, 163] },
      { max: Infinity, label: "200 and more", colour: [63, 0, 125] },
    ],
  },
  crit: {
    label: "Rainfall to fail (steady recharge, mm/day)",
    classes: [
      { max: 1e-9, label: "fails even dry", colour: [128, 0, 38] }, { max: 25, label: "under 25", colour: [215, 25, 28] },
      { max: 50, label: "25–50", colour: [253, 141, 60] }, { max: 100, label: "50–100", colour: [254, 217, 118] },
      { max: 200, label: "100–200", colour: [161, 218, 180] }, { max: 1e8, label: "200 and more", colour: [65, 182, 196] },
      { max: Infinity, label: "holds even saturated", colour: [44, 127, 184] },
    ],
  },
};
const classIn = (classes, v) => (Number.isFinite(v) ? classes.findIndex((k) => v < k.max) : -1);

const hex = (rgb) => rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

function paintView(frameOut) {
  const run = state.run; const g = state.ground;
  const view = VIEW[state.view] || VIEW.fos;
  const src = state.view === "fos" ? frameOut.fos : state.view === "wet" ? frameOut.W : state.view === "rain" ? frameOut.rainMm
    : state.view === "minfos" ? run.minFos : g.crit.map((v) => (v === Infinity ? 1e9 : v));
  const counts = new Array(view.classes.length).fill(0);
  // Every cell with ground under it is modelled and drawn, whatever its slope.
  const { sub } = g; const c_ = g.cells;
  for (let y = 0; y < sub.height; y += 1) {
    for (let x = 0; x < sub.width; x += 1) {
      const i = (y + sub.y0) * g.grid.width + (x + sub.x0);
      const v = c_.data[i] ? src[i] : NaN;
      run.band[y * sub.width + x] = v;
      const c = classIn(view.classes, v);
      if (c >= 0) counts[c] += 1;
    }
  }
  try { run.built.repaint?.((v) => { const c = classIn(view.classes, v); return c >= 0 ? view.classes[c].colour : null; }); } catch (e) { /* stands */ }
  const legend = {
    classed: true, categorical: true, field: state.view, label: view.label,
    palette: view.classes.map((k) => hex(k.colour)), labels: view.classes.map((k) => k.label), counts,
  };
  run.layer.legendInfo = legend;
  window.GeoIDLayerHierarchy?.render?.();
}

function showStep(k) {
  const run = state.run;
  if (!run) return;
  state.step = k;
  run.current = modelFrame(k);
  run.current.frame = k;
  paintView(run.current);
}

let running = false;

async function run({ keepStep = false } = {}) {
  const g = state.ground; const r = state.rain;
  if (!g || !r || running) return;
  running = true;
  const resume = keepStep ? state.step : -1;
  clear({ keepInputs: true });
  try {
    const frames = r.frames;
    say("run", `Running ${frames.length} static models over ${g.tally.model.toLocaleString()} cells…`);
    const minFos = new Float32Array(g.n).fill(NaN);
    const minAt = new Int16Array(g.n).fill(-1);
    const summary = [];
    for (let k = 0; k < frames.length; k += 1) {
      const out = modelFrame(k);
      let maxRain = 0;
      for (let i = 0; i < g.n; i += 1) {
        const v = out.fos[i];
        if (Number.isFinite(out.rainMm[i]) && out.rainMm[i] > maxRain && g.cells.model[i]) maxRain = out.rainMm[i];
        if (!Number.isFinite(v)) continue;
        if (!(minFos[i] <= v)) { minFos[i] = v; minAt[i] = k; }
      }
      summary.push({ failing: out.failing, applicable: out.applicable, meanW: out.meanW, maxRain });
      if (k % 8 === 7) { say("run", `Running static models… ${k + 1} of ${frames.length}`); await tick(); }
    }
    const band = new Float32Array(g.sub.width * g.sub.height).fill(NaN);
    const built = buildRasterLayer([band], g.sub.width, g.sub.height, g.sub.bounds, { name: LAYER_NAME, isDem: false, noData: NaN });
    if (!built) throw new Error("the layer could not be built");
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(LAYER_NAME, built, "fos");
    if (!layer) throw new Error("the globe is not ready");
    layer.raster = makeRaster(band, g.sub.width, g.sub.height, g.sub.bounds, NaN);
    window.GeoIDLayerHierarchy?.setOpacity?.(layer, 0.75);
    layer.info = {
      source: `${r.credit}; ${g.demLabel}; ${[g.maps.superficial, g.maps.bedrock, g.maps.soil].filter(Boolean).join("; ") || "no ground map"}; Pelletier et al. (2016) soil thickness; the rock-properties database`,
      summary: "A static, steady-state hydrogeological slope model (SHALSTAB/SINMAP family) run once per GFS rainfall map: recharge routed downslope builds a water table, and the infinite-slope factor of safety is read on the failure plane in the soil.",
      citation: "Montgomery & Dietrich (1994); Pack, Tarboton & Goodwin (1998); Quinn et al. (1991); Cosby et al. (1984)",
      maths: mathsFor("landslide-forecast"),
    };
    state.run = { layer, built, band, frames, summary, minFos, minAt, current: null };
    let worst = 0;
    summary.forEach((s, k) => { if (s.failing > summary[worst].failing || (s.failing === summary[worst].failing && s.meanW > summary[worst].meanW)) worst = k; });
    const startAt = resume >= 0 && resume < frames.length ? resume : worst;
    showStep(startAt);
    const epochs = frames.map((f, k) => ({ date: f.time, label: f.time.replace("T", " "), dataset: null, index: k }));
    state.playing = true;
    await startPlayer({
      bounds: { west: g.sub.bounds.minX, east: g.sub.bounds.maxX, south: g.sub.bounds.minY, north: g.sub.bounds.maxY },
      epochs, source: "none", interval: 400, startAt,
      noteFor: (e) => { const s = summary[e.index]; return `${s.failing.toLocaleString()} / ${s.applicable.toLocaleString()} failing · ${s.maxRain.toFixed(0)} mm`; },
      noteTitle: (e) => { const s = summary[e.index]; return `${r.sourceLabel(frames[e.index])} rain over the ${r.windowH} h to ${e.date}: up to ${s.maxRain.toFixed(0)} mm in the area; ${s.failing} of ${s.applicable} modelled cells below FoS 1; mean saturation ${s.meanW.toFixed(2)}.`; },
      onStatus: (m) => say("run", m),
      onShow: (index) => showStep(index),
      onStop: () => { state.playing = false; },
    });
    const w = summary[worst];
    const ever = [...minFos].filter((v) => Number.isFinite(v) && v < 1).length;
    say("run", `${frames.length} static models, one per rainfall map. Worst map ${frames[worst].time.replace("T", " ")}: ${w.failing.toLocaleString()} of ${w.applicable.toLocaleString()} cells below FoS 1 under up to ${w.maxRain.toFixed(0)} mm in ${r.windowH} h. `
      + `${ever.toLocaleString()} cells fall below 1 at some point in the window. Scrub the bar; change the view; click a cell for its numbers.`);
  } catch (error) {
    say("run", `The run failed: ${error.message}`, "error");
  } finally {
    running = false;
    markStates();
  }
}

function clear({ keepInputs = false } = {}) {
  if (state.playing) { try { stopPlayer(); } catch (e) { /* gone */ } state.playing = false; }
  const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === LAYER_NAME);
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  state.run = null; state.step = -1;
  if (!keepInputs) { state.rain = null; state.ground = null; state.bounds = null; ["area", "rain", "ground", "hydro", "run"].forEach((id) => say(id, "")); }
  markStates();
}

/* ── the card: one cell, at the map on screen ───────────────────────────── */

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export function probeAt(lat, lon) {
  const run = state.run; const g = state.ground;
  if (!run || !g || run.layer.visible === false) return false;
  const b = g.sub.bounds;
  if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) return false;
  const x = Math.min(g.grid.width - 1, Math.floor(((lon - g.eb.west) / (g.eb.east - g.eb.west)) * g.grid.width));
  const y = Math.min(g.grid.height - 1, Math.floor(((g.eb.north - lat) / (g.eb.north - g.eb.south)) * g.grid.height));
  const i = y * g.grid.width + x;
  if (!g.cells.data[i]) return false;
  const cur = run.current || modelFrame(Math.max(0, state.step));
  const frame = run.frames[Math.max(0, state.step)];
  const mat = g.table.list[g.cells.mat[i]];
  const slopeDeg = g.cells.slopeRad[i] * 180 / Math.PI;
  const fos = cur.fos[i];
  const crit = g.crit?.[i];
  const headline = `${fos >= FOS_CAP ? `${FOS_CAP}+` : fmt(fos)} — ${FOS_CLASSES[fosClass(fos)]?.label || "—"}`;
  // The factor of safety is the card's title; a first row saying it again is
  // the same number twice.
  const rows = [
    ["Rainfall map", state.rain.kind === "daily"
      ? `${fmt(cur.rainMm[i], 1)} mm of ${state.rain.sourceLabel(frame)} rain over the ${state.rain.windowH / 24} day${state.rain.windowH > 24 ? "s" : ""} to ${frame.time} (UTC days)`
      : `${fmt(cur.rainMm[i], 1)} mm of GFS rain in the ${state.rain.windowH} h to ${frame.time.replace("T", " ")} UTC`],
    ["Saturation", `h / z_s ${fmt(cur.W[i])}; water on the failure plane m ${fmt(planeWetness(cur.W[i], g.cells.zs[i], g.cells.zf[i]))}`],
    ["Upslope area", `${(g.cells.area[i] / 1e4).toFixed(2)} ha draining through this cell (a = ${(g.cells.area[i] / g.topo.contour).toFixed(0)} m)`],
    ["Lowest over the window", !Number.isFinite(run.minFos[i]) ? "—"
      : run.minFos[i] >= FOS_CAP ? `${FOS_CAP}+ throughout — too gentle to slide` : `${fmt(run.minFos[i])} at ${run.frames[run.minAt[i]].time.replace("T", " ")}`],
    ["Rainfall to fail", !Number.isFinite(crit) && crit !== Infinity ? "—" : crit === Infinity ? "holds even saturated" : crit === 0 ? "fails even dry" : `${crit.toFixed(0)} mm/day sustained over its catchment`],
    ["Slope", `${slopeDeg.toFixed(1)}° — from ${g.slopeFrom}`],
    ["Soil column", `${fmt(g.cells.zs[i], 1)} m to bedrock (${g.cells.thin[i] ? `Pelletier et al. 2016 reads 0 in whole metres — under 1 m, modelled as a ${fmt(g.cells.zs[i], 1)} m veneer` : g.cells.depthFrom[i] ? "Pelletier et al. 2016" : "a stated default"}); failure plane at ${fmt(g.cells.zf[i], 1)} m`],
    ["Material", `${mat.name} — ${mat.from}`],
    ["Strength", `c′ ${fmt(mat.cohesionKPa, 1)} kPa${mat.rootCohesionKPa ? ` (with ${mat.rootCohesionKPa} kPa of roots)` : ""}, φ′ ${fmt(mat.friction, 0)}° (${mat.strength}), γ ${fmt(mat.unitWeight, 1)} kN/m³`],
    ["Conductivity", `Ks ${mat.K.toExponential(1)} m/s — ${mat.kFrom}; lateral ${state.params.lateral} × Ks, T ${(mat.K * state.params.lateral * g.cells.zs[i] * 86400).toFixed(1)} m²/day`],
  ];
  window.GeoIDViewer?.showFeatureCard?.({
    // Named, so the card is claimed by this layer and goes when it does.
    source_layer: LAYER_NAME,
    soil: true, profile: false, type: "Forecast landslide risk", rock_type: headline, lithology: null, name: null,
    description: `${state.rain.credit} · ${state.rain.window.start} to ${state.rain.window.end}`, extra_rows: rows, origin: "GeoHUB forecast landslide pipeline",
    rows: [["Note", "A static steady-state screening model: the water table sustained recharge would build, routed downslope, and an infinite-slope failure parallel to the ground. Not a site investigation."]],
  }, lat, lon);
  return true;
}

export function init() {
  const host = document.getElementById("landslide-pipeline");
  if (!host) return;
  render(host);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.GeoIDLandslidePipeline = { init, render, probeAt, state, readiness, demGridFor, staticStep, LAYER_NAME, run, showStep };
}
