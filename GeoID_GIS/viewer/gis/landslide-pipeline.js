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
 * AND THE WATER THE SLOPE MODEL CANNOT TAKE IN RUNS OFF, which is the other
 * hazard in the same storm. `flood-fos.js` routes that runoff down the same
 * topology as a WAVE — each cell a linear reservoir, so a catchment peaks
 * hours after the rain — and reads every GRWL river's factor of safety as the
 * discharge it can carry at its brim over the discharge arriving. One water
 * balance, two hazards, and the saturation the slope model reports is exactly
 * what turns the next hour of rain from recharge into flood.
 *
 * The physics is `slope-hydrology.js`, `rock-slope.js` and `flood-fos.js`, and
 * the rainfall is `gfs-rain.js`; this file only orchestrates them and says, on
 * every card, what it has read.
 */

import { refreshPolygonOptions, resolvePolygonExtent, promptDrawTool } from "./extent-picker.js?v=20260912-472df3d";
import { fetchWindow, fetchGfsNodes, rainfallFrames, interpolatorFor, dayHours, GFS_CREDIT, GFS_ARCHIVE_START } from "./gfs-rain.js?v=20260912-472df3d";
import {
  columnMaterial, soilColumn, steadyWetness, planeWetness, factorOfSafety, criticalRecharge,
  FOS_CLASSES, fosClass, SHALLOW_FAILURE_CAP_M, LATERAL_FACTOR, FOS_CAP, cellAnswer,
} from "./slope-hydrology.js?v=20260912-472df3d";
import { fillSinks, mfdTopology, routeFlux } from "./hydrology.js?v=20260912-472df3d";
import { makeRaster, slope as slopeOf } from "./raster-analysis.js?v=20260912-472df3d";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260912-472df3d";
import { loadRockProperties, parameterValue, resolveLithology } from "./rock-properties.js?v=20260912-472df3d";
import { GEE_RAIN_SOURCES, coversBox, daysBetween, geeRainDates, fetchGeeRainParts, pixelIndex, isoDay as dayOf } from "./gee-rain.js?v=20260912-472df3d";
import { mathsFor } from "./equations.js?v=20260912-472df3d";
import { startPlayer, stopPlayer, seekPlayer } from "./timelapse-player.js?v=20260912-472df3d";
import { upslopeWeights, stationStep, stationFlood, catchmentTopology, floodScratch, LANDSLIDE_PARAMS, LANDSLIDE_PLOTS, lowestCells } from "./landslide-stations.js?v=20260912-472df3d";
import {
  makeStation, parseStationsCsv, stationsFromFeatures, uniqueName, seriesCsv, seriesFileName, MAX_STATIONS, colourAt,
} from "./station-series.js?v=20260912-472df3d";
import { drawTimeSeries, yRangeOf } from "./time-series-plot.js?v=20260912-472df3d";
import { planSeries, rendersOf, stepText, rampMaxFor, STEP_CHOICES, NATIVE_STEP, HOUR } from "./rain-steps.js?v=20260912-472df3d";
import { mountStationMarkers } from "./station-markers.js?v=20260912-472df3d";
import { equivalentMohrCoulomb, culmann, culmannAt, rockCell, localRelief, rockfallReach, velocityOf, criticalHeight } from "./rock-slope.js?v=20260912-472df3d";
import {
  bankfullCapacity, partition, residenceTimes, waveStep, floodFos, riseFor,
  FLOOD_CLASSES, RUNOFF_CLASSES, DISCHARGE_CLASSES, BANKFULL_RATIO, HILLSLOPE_V,
} from "./flood-fos.js?v=20260912-472df3d";
import { inundate, sourceFields, DEPTH_CLASSES, DEFAULTS as FLOOD_DEFAULTS, meanFlowFromWidth } from "./inundation.js?v=20260912-472df3d";
import { burnRivers } from "./river-zones.js?v=20260912-472df3d";
import { waterFeatures, waterMasks } from "./water-mask.js?v=20260912-472df3d";

const search = new URL(import.meta.url).search;
export const LAYER_NAME = "Landslide risk — forecast (factor of safety)";
/** The stations' own layer: points on the globe named as the list names them. */
export const STATION_LAYER = "Landslide sampling stations";
/** The block the coarse datasets inform the fine grid on, in metres. */
export const INFORM_M = 100;

/* ── pure: the pieces the tests run ─────────────────────────────────────── */

/** The DEM as a raster over the bounds, sampled from a height reader. */
export function demGridFor(bounds, heightAt, { maxCells = 90000, minStepM = 10 } = {}) {
  const { west, south, east, north } = bounds;
  const midLat = (south + north) / 2;
  const widthM = (east - west) * 111320 * Math.cos(midLat * Math.PI / 180);
  const heightM = (north - south) * 110574;
  const step = Math.max(minStepM, Math.sqrt((widthM * heightM) / maxCells));
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

/** The static answer at one cell for one recharge flux — `slope-hydrology`'s, shared with the stations. */
export { cellAnswer };

/**
 * ONE STATIC MODEL for one rainfall map: recharge from the map (capped at the
 * ground's Ks where it infiltrates), routed down the MFD topology, then the
 * steady water table and the factor of safety at every modelled cell. Pure
 * given its arrays.
 */
export function staticStep({ rainMm, windowH, cells, topo, infiltration = true, lateral = LATERAL_FACTOR, scratch = null }) {
  const n = cells.data.length;
  // The ground's properties and the rain may be held per BLOCK of the
  // informing lattice (`cells.block`, `cells.props`) or per cell; either way a
  // cell reads them through its block index.
  const B = cells.block || null; const P = cells.props || cells;
  // One set of buffers reused map after map when the caller keeps them: at two
  // million cells a fresh set is 42 MB of garbage per rainfall map.
  const source = scratch?.source?.length === n ? scratch.source.fill(0) : new Float64Array(n);
  const perSecond = 1 / (1000 * windowH * 3600);
  for (let i = 0; i < n; i += 1) {
    if (!cells.data[i]) continue;
    const j = B ? B[i] : i;
    const rain = rainMm[j];
    if (!Number.isFinite(rain)) continue;
    let r = rain * perSecond;
    if (infiltration && r > P.K[j]) r = P.K[j];
    source[i] = r * topo.cellArea;
  }
  const q = routeFlux(topo, source, { inPlace: true });
  const fos = scratch?.fos?.length === n ? scratch.fos.fill(NaN) : new Float32Array(n).fill(NaN);
  const W = scratch?.W?.length === n ? scratch.W.fill(NaN) : new Float32Array(n).fill(NaN);
  let failing = 0; let applicable = 0; let wSum = 0; let wN = 0;
  const cell = { K: 0, zs: 0, zf: 0, slopeRad: 0, c: 0, phi: 0, gamma: 0 };
  for (let i = 0; i < n; i += 1) {
    if (!cells.data[i]) continue;
    const j = B ? B[i] : i;
    cell.K = P.K[j]; cell.zs = P.zs[j]; cell.zf = P.zf[j]; cell.slopeRad = cells.slopeRad[i];
    cell.c = P.c[j]; cell.phi = P.phi[j]; cell.gamma = P.gamma[j];
    const answer = cellAnswer({ q: q[i], contour: topo.contour, lateral, cell });
    W[i] = answer.W;
    if (!cells.model[i]) continue;
    if (Number.isFinite(answer.W)) { wSum += answer.W; wN += 1; }
    if (!Number.isFinite(answer.fos)) continue;
    fos[i] = answer.fos; applicable += 1;
    if (answer.fos < 1) failing += 1;
  }
  // The answer carries THE MAP IT WAS FED. `splitRain` reads the rain back off
  // it to work out what ran off, and a rain map attached only to the object the
  // caller builds afterwards is a rain map the flood half cannot see.
  return { rainMm, fos, W, q, failing, applicable, meanW: wN ? wSum / wN : 0 };
}

/**
 * WHICH SOURCE SERVES WHICH DAY. Earth Engine's archives are history, at the
 * highest resolution there is; GFS is the only thing with tomorrow in it. So
 * "auto" takes each day from the FIRST Earth Engine archive in `gees` that
 * holds it — CHIRPS (~5.5 km) where it reaches, then IMERG, which runs to
 * yesterday where CHIRPS stops six weeks back — and every later day from GFS,
 * and one date range reads from last spring into next week. A named archive
 * takes every day from itself and refuses the days it does not have rather
 * than quietly borrowing them.
 *
 * `gees` is `[{ key, first, last, covers }]` in order of preference; the older
 * single `gee` (with `covers`) still works and means one archive.
 */
export function planRain({ source, start, end, windowH = 24, today, gee = null, covers = true, gees = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "")) return { ok: false, message: "Give a start and an end date." };
  if (start > end) return { ok: false, message: "The start is after the end." };
  const list = gees || (gee ? [{ key: source === "auto" || source === "gfs" ? "chirps" : source, ...gee, covers }]
    : source !== "auto" && source !== "gfs" ? [{ key: source, first: null, last: null, covers }] : []);
  const windowDays = Math.max(1, Math.round(windowH / 24));
  const first = dayOf(Date.parse(`${start}T00:00:00Z`) - (windowDays - 1) * 86400000);
  const days = daysBetween(first, end);
  const lastForecast = dayOf(Date.parse(`${today}T00:00:00Z`) + 15 * 86400000);
  if (end > lastForecast) return { ok: false, message: `Nothing forecasts past ${lastForecast}; the window ends ${end}.` };
  const sourceOf = new Map();
  const usable = list.filter((g) => g.covers && g.first && g.last);
  const named = source !== "auto" && source !== "gfs";
  for (const d of days) {
    const holder = source === "gfs" ? null : usable.find((g) => d >= g.first && d <= g.last);
    if (named) {
      const g = list[0] || {};
      const s = GEE_RAIN_SOURCES[g.key] || {};
      if (!g.covers) return { ok: false, message: `${s.short || g.key} does not reach this area (it stops at ${s.maxLat}° of latitude).` };
      if (!g.first) return { ok: false, message: "Earth Engine did not say which dates it holds." };
      if (!holder) return { ok: false, message: `${s.short} holds ${g.first} to ${g.last}; the window needs ${d}. Choose Auto to let GFS take the days after.` };
      sourceOf.set(d, g.key);
    } else if (holder) sourceOf.set(d, holder.key);
    else {
      if (d < GFS_ARCHIVE_START) return { ok: false, message: `GFS begins ${GFS_ARCHIVE_START} and no Earth Engine archive here holds ${d}.` };
      sourceOf.set(d, "gfs");
    }
  }
  const geeDays = days.filter((d) => sourceOf.get(d) !== "gfs");
  const gfsDays = days.filter((d) => sourceOf.get(d) === "gfs");
  const bySource = {};
  geeDays.forEach((d) => { (bySource[sourceOf.get(d)] ||= []).push(d); });
  return { ok: true, days, windowDays, sourceOf, geeDays, gfsDays, bySource, start, end };
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
  bounds: null, rain: null, ground: null, run: null, step: -1, playing: false, view: "mode",
  params: { strength: "peak", root: 0, infiltration: true, lateral: LATERAL_FACTOR,
    // The rock model's controls: where bedrock counts as bare, where it sheds
    // blocks, how far they run, the window a slope's height is read over, and
    // how much worse than typical the rock mass is taken to be.
    exposedDeg: 40, sourceDeg: 45, reachDeg: 32, reliefM: 200, gsiAdj: 0,
    // The channel model's: how much of the mean flow a channel holds at its
    // brim, how fast a hillslope passes its water on, how far past the bank a
    // flood is carried, and whether what the DEM cannot see holds it back.
    bankfull: BANKFULL_RATIO, hillV: HILLSLOPE_V, reach: FLOOD_DEFAULTS.reach, defended: true },
  // Sampling stations outlive a run and an area: they are the reader's points,
  // and a run only fills them in.
  stations: [], record: null, plotHover: -1,
};

const STEPS = [
  { id: "area", n: 1, title: "Study area", blurb: "Where the model runs." },
  { id: "rain", n: 2, title: "Rainfall maps", blurb: "Earth Engine's historical archives and NOAA's GFS over the area, by date: each map the rain over the hours before it." },
  { id: "ground", n: 3, title: "Ground", blurb: "DEM, routing, soil thickness and material — built once." },
  { id: "hydro", n: 4, title: "Hydrogeology", blurb: "The steady water table each rainfall map would build." },
  { id: "fos", n: 5, title: "Failure models — slope, rock and channel", blurb: "Three models on one water balance: a shallow slide in the soil, failure of the bedrock, and the rivers overtopping on the runoff the slopes could not take in." },
  { id: "run", n: 6, title: "Run and play", blurb: "One static model per rainfall map, through the bar." },
  { id: "stations", n: 7, title: "Sampling stations", blurb: "Points on the ground where every map's answer is recorded — plotted through time, and exported." },
];

export function readiness(s = state) {
  return {
    area: s.bounds ? "done" : "ready",
    rain: s.rain ? "done" : s.bounds ? "ready" : "blocked",
    ground: s.ground ? "done" : s.bounds ? "ready" : "blocked",
    hydro: s.ground ? "done" : "ready",
    fos: "ready",
    run: s.run ? "done" : (s.rain && s.ground) ? "ready" : "blocked",
    stations: s.record?.stations?.some((st) => st.cell >= 0) ? "done" : "ready",
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
.lsp-sub { font: 600 0.7rem "Exo 2", sans-serif; letter-spacing: 0.05em; text-transform: uppercase; margin: 0.45rem 0 0.1rem; color: var(--skin-data, #52e4e8); }
.lsp-card .row { margin: 0.2rem 0; }
.lsp-maps { display: grid; gap: 0.2rem; margin: 0.25rem 0; font-size: 0.72rem; }
.lsp-map { display: flex; align-items: center; gap: 0.4rem; }
.lsp-map span { flex: 1 1 auto; min-width: 0; }
.lsp-map b { font-weight: 600; }
.lsp-map .button { flex: 0 0 auto; padding: 0.12rem 0.5rem; font-size: 0.66rem; }
.lsp-st-list { display: grid; gap: 0.2rem; margin: 0.25rem 0; max-height: 11rem; overflow-y: auto; }
.lsp-st-list:empty { display: none; }
.lsp-st { display: grid; grid-template-columns: 0.7rem minmax(0, 1fr) auto auto; align-items: center; gap: 0.35rem; font-size: 0.72rem; }
.lsp-st-sw { width: 0.7rem; height: 0.7rem; border-radius: 999px; box-shadow: 0 0 0 1px rgba(0,0,0,0.5); }
.lsp-st-name { min-width: 0; padding: 0.1rem 0.3rem !important; font-size: 0.72rem !important; height: auto !important; }
.lsp-st-val { font-variant-numeric: tabular-nums; opacity: 0.9; white-space: nowrap; }
.lsp-st-val[data-kind="fail"] { color: #ff7b7b; }
.lsp-st-val[data-kind="none"] { opacity: 0.55; }
.lsp-st-x { background: none; border: 0; color: inherit; opacity: 0.6; cursor: pointer; padding: 0 0.2rem; font-size: 0.8rem; }
.lsp-st-x:hover, .lsp-st-x:focus-visible { opacity: 1; }
.lsp-plots { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.45rem; margin: 0.35rem 0 0.2rem; }
.lsp-plots:empty { display: none; }
.lsp-plotbox { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.25rem; }
.lsp-plothead { display: flex; gap: 0.3rem; align-items: center; }
.lsp-plothead select { flex: 1 1 auto; min-width: 0; }
.lsp-pbtn { flex: 0 0 auto; background: none; border: 1px solid rgba(var(--nav-accent-rgb, 255,43,214), 0.4); border-radius: 0.3rem; color: inherit;
  width: 1.6rem; height: 1.6rem; display: grid; place-items: center; cursor: pointer; font-size: 0.8rem; line-height: 1; opacity: 0.85; }
.lsp-pbtn:hover, .lsp-pbtn:focus-visible { opacity: 1; border-color: var(--nav-accent, #ff2bd6); }
.lsp-plot { width: 100%; max-width: 100%; min-width: 0; height: 10rem; display: block; cursor: crosshair; border-radius: 0.35rem; background: rgba(0,0,0,0.22); }
.lsp-plotread { font-size: 0.68rem; margin: 0; min-height: 1em; opacity: 0.85; font-variant-numeric: tabular-nums; }
.lsp-plotbox.is-float { position: fixed; z-index: 20; width: min(34rem, calc(100vw - 2rem)); padding: 0.5rem 0.6rem; box-sizing: border-box;
  border: 1px solid rgba(var(--nav-accent-rgb, 255,43,214), 0.45); border-radius: 0.6rem;
  background: var(--skin-card-ground, rgb(24,13,47)); box-shadow: 0 10px 30px rgba(0,0,0,0.5); color: var(--text, #eef); }
.lsp-grip { display: none; flex: 0 0 auto; cursor: move; opacity: 0.7; font-size: 1rem; line-height: 1; padding: 0 0.1rem; user-select: none; }
.lsp-plotbox.is-float { cursor: move; }
.lsp-plotbox.is-float .lsp-grip { display: block; }
.lsp-plotbox.is-float select, .lsp-plotbox.is-float button { cursor: pointer; }
.lsp-plotbox.is-float canvas { cursor: crosshair; }
.lsp-plotbox.is-float .lsp-plot { height: 14rem; }
.lsp-plotbox.is-float.is-dragging { opacity: 0.9; }
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
        <option value="auto" selected>Auto — Earth Engine for the past (CHIRPS, then IMERG), GFS after</option>
        <option value="gfs">GFS (NOAA) — hourly, ~13 km, Mar 2021 to +15 days</option>
        <option value="chirps">Earth Engine CHIRPS — daily, ~5.5 km, 1981 to ~6 weeks ago, 50°S–50°N</option>
        <option value="imerg">Earth Engine GPM IMERG — half-hourly, ~11 km, to yesterday (needs the service redeployed)</option>
        <option value="gsmap">Earth Engine GSMaP — hourly, ~11 km, to hours ago (needs the service redeployed)</option>
        <option value="era5land">Earth Engine ERA5-Land — daily, ~9 km (needs the service redeployed)</option></select></div>
      <div class="row"><label for="lsp-rain-start">From</label><input id="lsp-rain-start" class="input" type="date" value="${isoDay(now - 7 * 86400000)}"></div>
      <div class="row"><label for="lsp-rain-end">To</label><input id="lsp-rain-end" class="input" type="date" value="${isoDay(now + 7 * 86400000)}"></div>
      <div class="gis-btn-row"><button type="button" class="button secondary" id="lsp-rain-around" title="The week that has happened and the week forecast, in one run: the record from Earth Engine where it holds the days, GFS's forecast after today.">7 days either side</button><button type="button" class="button secondary" id="lsp-rain-past">Past 7</button><button type="button" class="button secondary" id="lsp-rain-next">Next 7</button></div>
      <div class="row"><label for="lsp-rain-step" title="How often there is a map. Finest reads every stretch of days at its own source's step — GFS hourly, CHIRPS daily, IMERG half-hourly — so there is as much of the record as exists. A coarser step sums the finer data into it; a source is never read finer than it is.">Time step</label><select id="lsp-rain-step" class="input">
        ${STEP_CHOICES.map((c) => `<option value="${c.key}"${c.key === "native" ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
      <div class="row"><label for="lsp-rain-window" title="The rain each map sums, before its time. The slope model is a steady state, so this is the duration the recharge is assumed to be sustained over — a day is the usual choice; longer carries more of the antecedent wet. A map always sums at least its own step, so a monthly map is a month's rain whatever is set here.">Each map sums the last</label><select id="lsp-rain-window" class="input">
        <option value="step">its own time step</option><option value="1">1 h</option><option value="3">3 h</option><option value="6">6 h</option><option value="12">12 h</option><option value="24" selected>24 h</option><option value="48">48 h</option><option value="72">72 h</option><option value="168">1 week</option></select></div>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-rain-fetch">Fetch rainfall</button></div>`)}
    ${card(STEPS[2], `
      <div class="row"><label for="lsp-ground-cells" title="The factor of safety is mapped at the DEM's own post spacing; the other datasets inform it at their own resolutions. The budget only coarsens the map where the area is too big to hold at full resolution, and the status says so.">Resolution</label><select id="lsp-ground-cells" class="input"><option value="2000000" selected>Full resolution — the DEM's own posts (up to 2 M cells)</option><option value="1000000">1,000,000</option><option value="250000">250,000</option><option value="90000">90,000 — quick</option></select></div>
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
      <div class="lsp-sub">1 · Soil — a shallow translational slide</div>
      <div class="lsp-eq">FoS = [c′ + c_r + (γ − m·γw)·z_f·cos²β·tan φ′] / [γ·z_f·sin β·cos β]</div>
      <div class="row"><label for="lsp-strength" title="Peak for a first-time failure; residual where the ground has slid before and the shear surface is already polished.">Strength</label><select id="lsp-strength" class="input" data-always="1"><option value="peak" selected>Peak — first-time failure</option><option value="residual">Residual — reactivation</option></select></div>
      <div class="row"><label for="lsp-root" title="The extra cohesion roots give a soil: 0 bare, a few kPa grassland, 5–20 kPa forest.">Root cohesion (kPa)</label><input id="lsp-root" class="input" type="number" min="0" max="40" step="1" value="0" data-always="1"></div>
      <p class="compact-copy" style="margin:0;opacity:0.8">z_f is the soil column capped at ${SHALLOW_FAILURE_CAP_M} m. On gentle ground the factor of safety is large (capped at ${FOS_CAP}) and reads "stable". Where the bedrock is bare there is no soil to slide, and the rock model governs.</p>
      <div class="lsp-sub">2 · Bedrock — a rock slope, and rockfall</div>
      <div class="lsp-eq">Hoek–Brown (σci, mi, GSI) → c′, φ′ of the rock mass for a slope H high
FoS = 2c′·sin β / (γH·sin θ·sin(β−θ)) + (1 − r_u)·tan φ′·cot θ   Culmann, θ the critical plane
r_u = W·γw / 2γ     water in the joints, W from the routed recharge
rockfall: sources where rock is bare and β ≥ β_s; reached while under a line from the source at the reach angle; v = √(2g·h)</div>
      <div class="row"><label for="lsp-exposed" title="Where the soil model reads under a metre (Pelletier's 0) on ground at least this steep, the bedrock is taken as bare — there is no soil to slide, and the rock model governs. Ground steeper than 55° is taken as bare whatever the soil map says.">Bare rock: thin soil and slope ≥</label><select id="lsp-exposed" class="input" data-always="1"><option value="30">30°</option><option value="35">35°</option><option value="40" selected>40°</option><option value="45">45°</option></select></div>
      <div class="row"><label for="lsp-source" title="Bare rock at least this steep sheds blocks. A DEM smooths a cliff: at 30 m a vertical face reads 50–60°, so the threshold is set low of the true cliff angle.">Rockfall sources: bare rock ≥</label><select id="lsp-source" class="input" data-always="1"><option value="40">40°</option><option value="45" selected>45°</option><option value="50">50°</option><option value="55">55°</option><option value="60">60°</option></select></div>
      <div class="row"><label for="lsp-reach" title="The energy-line (Fahrböschung) angle: a falling block travels while it stays under a line dropping from its source at this angle. Around 32° is typical for rockfall reach; a lower angle reaches further (Evans &amp; Hungr 1993; Jaboyedoff &amp; Labiouse 2011).">Rockfall reach angle</label><select id="lsp-reach" class="input" data-always="1"><option value="28">28° — long runout</option><option value="30">30°</option><option value="32" selected>32°</option><option value="35">35°</option><option value="38">38° — short</option></select></div>
      <div class="row"><label for="lsp-relief" title="A rock slope's height H is each cell's height above the lowest ground within this distance. Rock slopes fail by height as much as by angle: H sets the stress range the rock mass is fitted over and the weight on the plane.">Slope height read over</label><select id="lsp-relief" class="input" data-always="1"><option value="100">100 m</option><option value="200" selected>200 m</option><option value="500">500 m</option><option value="1000">1 km</option></select></div>
      <div class="row"><label for="lsp-gsi" title="The Geological Strength Index the database gives is a TYPICAL field range for the rock; weathered, sheared or blasted ground is worse. This lowers every rock mass by that much.">Rock mass quality (GSI)</label><select id="lsp-gsi" class="input" data-always="1"><option value="0" selected>Typical for the rock</option><option value="-10">10 lower — weathered</option><option value="-20">20 lower — poor, sheared</option><option value="10">10 higher — massive</option></select></div>
      <div class="lsp-sub">3 · Channel — the water the slopes could not take in</div>
      <div class="lsp-eq">e = (P − min(P, Ks)) + min(P, Ks)·W    runoff: too fast to soak in, plus what a full column returns
S ← S + Q·Δt ;  Q_out = S·(1 − e^(−Δt/k))/Δt    a linear reservoir per cell — the wave
k = L / v,  v = 0.514·Q_bank^0.2 in a channel, k_v·√sin β on a hillslope
FoS = Q_bankfull / Q          the channel's, below 1 it is over the brim</div>
      <p class="compact-copy" style="margin:0 0 0.35rem;opacity:0.8">W is the slope model's own saturation, so the two hazards share one storm: as the hillsides fill, the same rain stops recharging and starts running off. A flood is a wave, so this model is marched through the series in order — it needs a full run, where the other two answer any map on their own.</p>
      <div class="row"><label for="lsp-bankfull" title="What a channel carries at its brim, as a multiple of the mean flow GRWL's width implies. The annual flood is bankfull by convention; the ratio varies by an order of magnitude between a chalk stream and a monsoon river.">Bankfull capacity (× mean flow)</label><select id="lsp-bankfull" class="input" data-always="1"><option value="3">3 — flashy, little storage</option><option value="5" selected>5 — the annual flood</option><option value="8">8</option><option value="12.5">12.5 — a big channel</option></select></div>
      <div class="row"><label for="lsp-hillv" title="How fast a hillslope passes its water on: v = k·√(sin β). Lower is a slow, vegetated, permeable catchment; higher is bare or urban ground that answers within the hour.">Hillslope response</label><select id="lsp-hillv" class="input" data-always="1"><option value="0.5">Slow — vegetated, rough</option><option value="1.5" selected>Typical</option><option value="3">Fast — bare or sealed</option></select></div>
      <div class="row"><label for="lsp-defended" title="Ground already below the river at mean flow is not flooded every day, so something the DEM cannot see is holding the water off it — a levee, a dyke, or a DEM wrong at the channel. Untick to flood it with the rest.">Unseen defences hold</label><span class="checkbox-wrap"><input id="lsp-defended" type="checkbox" checked data-always="1"></span></div>`)}
    ${card(STEPS[5], `
      <div class="row"><label for="lsp-view">Show</label><select id="lsp-view" class="input" data-always="1">
        <option value="mode" selected>Governing failure — soil, rock slope or rockfall — this map</option>
        <option value="fos">Soil slide — factor of safety — this map</option>
        <option value="rockfos">Rock slope — factor of safety — this map</option>
        <option value="rockfall">Rockfall — sources and reach (block velocity)</option>
        <option value="wet">Saturation h / z_s — this map</option>
        <option value="rain">GFS rainfall — this map</option>
        <option value="minfos">Lowest factor of safety over the window</option>
        <option value="crit">Rainfall to fail (static, mm/day)</option>
        <optgroup label="Channel — the flood">
        <option value="floodfos">Channel factor of safety — this map</option>
        <option value="flooddepth">Flood depth over the ground — this map</option>
        <option value="discharge">Discharge in the channel — this map</option>
        <option value="runoff">Runoff — the share of the rain that ran off</option>
        <option value="minfloodfos">Lowest channel factor of safety over the window</option>
        </optgroup></select></div>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-run">Run and play</button><button type="button" class="button secondary" id="lsp-clear">Clear</button></div>`)}
    ${card(STEPS[6], `
      <div class="lsp-st-list" id="lsp-st-list"></div>
      <div class="row"><label for="lsp-st-add">Add</label><select id="lsp-st-add" class="input" data-always="1">
        <option value="pick">Points clicked on the map</option>
        <option value="centre">The study area's centre</option>
        <option value="lowest">The 5 lowest factors of safety (after a run)</option>
        <option value="csv">A CSV of stations — name, lat, lon…</option>
        <optgroup label="Every point of a layer" id="lsp-st-layers"></optgroup></select></div>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-st-go" data-always="1">Add</button><button type="button" class="button secondary" id="lsp-st-clear" data-always="1">Remove all</button></div>
      <input type="file" id="lsp-st-file" accept=".csv,.txt,.tsv" hidden>
      <div class="lsp-plots" id="lsp-plots"></div>
      <div class="gis-btn-row"><button type="button" class="button secondary" id="lsp-plot-add" data-always="1" title="Another plot: any recorded variable, docked here or popped out over the map">+ Plot</button><button type="button" class="button" id="lsp-st-csv" data-always="1">Export CSV</button></div>`)}
  </div>`;
  wire();
  wireStations();
  drawMaps();
  markStates();
  renderStations();
  renderPlots();
}

function wire() {
  const extent = byId("lsp-extent");
  refreshPolygonOptions(extent, "drawn", { allLayers: true });
  window.addEventListener("geoid-gis:layers-changed", () => {
    try { refreshPolygonOptions(extent, extent.value || "drawn", { allLayers: true }); } catch (e) { /* redraw later */ }
    drawMaps();
  });
  window.GeoIDImportManager?.onChange?.(() => { drawMaps(); refreshLayerChoices(); });
  byId("lsp-draw").addEventListener("click", () => { promptDrawTool(); say("area", "Draw the area on the globe, press Done, then Use this extent."); });
  byId("lsp-use").addEventListener("click", () => {
    const b = resolvePolygonExtent(extent.value, { arm: false });
    if (!b || ![b.west, b.south, b.east, b.north].every(Number.isFinite)) { say("area", "No area yet — draw one, or pick a layer.", "error"); return; }
    clear({ keepInputs: true });
    removeRainLayer();
    state.bounds = b; state.rain = null; state.ground = null;
    const w = (b.east - b.west) * 111.32 * Math.cos(((b.south + b.north) / 2) * Math.PI / 180);
    const h = (b.north - b.south) * 110.574;
    say("area", `${w.toFixed(1)} × ${h.toFixed(1)} km — ${b.west.toFixed(3)} to ${b.east.toFixed(3)}°E, ${b.south.toFixed(3)} to ${b.north.toFixed(3)}°N`);
    ["rain", "ground", "hydro", "run"].forEach((id) => say(id, ""));
    markStates();
  });
  const setDates = (from, to) => { byId("lsp-rain-start").value = isoDay(from); byId("lsp-rain-end").value = isoDay(to); };
  byId("lsp-rain-around").addEventListener("click", () => setDates(Date.now() - 7 * 86400000, Date.now() + 7 * 86400000));
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
  // The rock controls change what the rock model is built from, not the ground read.
  for (const [id, key] of [["lsp-exposed", "exposedDeg"], ["lsp-source", "sourceDeg"], ["lsp-reach", "reachDeg"], ["lsp-relief", "reliefM"], ["lsp-gsi", "gsiAdj"]]) {
    byId(id).addEventListener("change", (e) => { state.params[key] = Number(e.target.value); buildRock(); rerun(); if (!state.run) markStates(); });
  }
  // The capacity and the response speed are properties of the ground, so they
  // rebuild the river half of it and then re-run; the defences only change how
  // the flood is SPREAD, so they cost a repaint of the frame on screen.
  for (const [id, key] of [["lsp-bankfull", "bankfull"], ["lsp-hillv", "hillV"]]) {
    byId(id).addEventListener("change", (e) => {
      state.params[key] = Number(e.target.value);
      if (state.ground) void buildFlood().then(() => { rerun(); if (!state.run) markStates(); });
    });
  }
  byId("lsp-defended").addEventListener("change", (e) => {
    state.params.defended = e.target.checked;
    if (state.run?.current?.flood) { state.run.current.flood.depth = null; showStep(Math.max(0, state.step)); }
  });
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

/** Earth Engine renders a series may spend before the page asks first: each one is a billed request. */
export const RENDER_BUDGET = 60;

async function fetchRain() {
  const b = state.bounds;
  if (!b) return;
  const source = byId("lsp-rain-source").value;
  const choice = byId("lsp-rain-step").value || "native";
  const w = byId("lsp-rain-window").value;
  const windowH = w === "step" ? null : Number(w) || 24;
  const start = byId("lsp-rain-start").value; const end = byId("lsp-rain-end").value;
  // The nodes and pictures must cover the MARGIN too: water falling there drains into the area.
  const cover = withMargin(b, marginKm());
  if (state.playing) { try { stopPlayer(); } catch (e) { /* gone */ } state.playing = false; }
  removeRainLayer();
  try {
    const got = await fetchSeries({ cover, source, start, end, windowH, choice });
    if (!got) return;   // waiting for the reader to agree to the renders
    state.rain = got;
    state.run = null;
    say("rain", state.rain.summary);
    // The maps go into the Workspace as they arrive, and the bar plays them.
    if (showRainLayer()) void playRain();
  } catch (error) {
    say("rain", `Rainfall could not be read: ${error.message}`, "error");
  }
  markStates();
}

/** The archives Auto reads the past from, best first: CHIRPS's resolution, then IMERG's reach to yesterday. */
export const AUTO_GEE_ORDER = ["chirps", "imerg"];

const shortOf = (key) => (key === "gfs" ? "GFS" : GEE_RAIN_SOURCES[key]?.short || key);
const isoZ = (t) => new Date(t).toISOString();

/**
 * THE SERIES, at the finest step each source has unless a coarser one is
 * asked for: which source holds each day, the plan of units and maps
 * (`rain-steps.js`), then GFS's hours and Earth Engine's composites for
 * exactly the units the maps read. A plan that would spend more than
 * RENDER_BUDGET billed renders is stated first and fetched on a second press.
 */
async function fetchSeries({ cover, source, start, end, windowH, choice }) {
  const today = dayOf(Date.now());
  const lastForecast = dayOf(Date.now() + 15 * 86400000);
  if (end > lastForecast) throw new Error(`Nothing forecasts past ${lastForecast}; the window ends ${end}.`);
  const keys = source === "auto" ? AUTO_GEE_ORDER : source === "gfs" ? [] : [source];
  if (keys.length) say("rain", `Asking Earth Engine which dates ${keys.map(shortOf).join(" and ")} hold…`);
  const gees = await Promise.all(keys.map(async (key) => {
    const covers = coversBox(key, cover);
    if (!covers) return { key, covers, problem: `stops at ${GEE_RAIN_SOURCES[key].maxLat}° of latitude` };
    try { return { key, covers, ...(await geeRainDates(key)) }; } catch (error) { return { key, covers, problem: error.message }; }
  }));
  const named = source !== "auto" && source !== "gfs";
  if (named && !gees[0].first) {
    const s = GEE_RAIN_SOURCES[source];
    throw new Error(gees[0].covers ? `Earth Engine ${s.short}: ${gees[0].problem}` : `${s.short} does not reach this area (it ${gees[0].problem}).`);
  }
  const usable = gees.filter((g) => g.covers && g.first && g.last);
  const sourceOf = (day) => {
    if (source === "gfs") return "gfs";
    if (named) return source;
    return usable.find((g) => day >= g.first && day <= g.last)?.key || "gfs";
  };
  const plan = planSeries({ start, end, choice, windowH, sourceOf });
  if (!plan.ok) throw new Error(plan.message);
  if (!plan.frames.length) throw new Error("No complete map fits between those dates at that step.");
  // Every day the plan reads has to exist where it is read from.
  for (const u of plan.units) {
    for (const p of u.parts) {
      const d0 = dayOf(p.from); const d1 = dayOf(p.to - 1);
      if (p.src === "gfs" && d0 < GFS_ARCHIVE_START) throw new Error(`GFS begins ${GFS_ARCHIVE_START} and no Earth Engine archive here holds ${d0}.`);
      if (named) {
        const g = gees[0];
        if (d0 < g.first || d1 > g.last) throw new Error(`${shortOf(source)} holds ${g.first} to ${g.last}; the series needs ${d0} to ${d1}. Choose Auto to let GFS take the days after.`);
      }
    }
  }
  const renders = rendersOf(plan);
  const signature = `${source}|${start}|${end}|${choice}|${windowH}|${cover.west.toFixed(3)},${cover.south.toFixed(3)}`;
  if (renders > RENDER_BUDGET && state.rainConfirm !== signature) {
    state.rainConfirm = signature;
    byId("lsp-rain-fetch").textContent = `Fetch — spend ${renders.toLocaleString()} renders`;
    say("rain", `This series is ${plan.frames.length.toLocaleString()} maps and needs ${renders.toLocaleString()} Earth Engine renders — one billed request each (${Object.entries(plan.steps).map(([k, st]) => `${shortOf(k)} every ${stepText(st)}`).join(", ")}). Press Fetch again to spend them, or choose a coarser time step.`, "error");
    return null;
  }
  state.rainConfirm = null;
  byId("lsp-rain-fetch").textContent = "Fetch rainfall";

  // GFS: every hour the plan reads, fetched once and summed here.
  let gfs = null;
  if (plan.gfsSpan) {
    say("rain", "Asking GFS…");
    const from = dayOf(plan.gfsSpan.from); const to = dayOf(plan.gfsSpan.to);
    const got = await fetchGfsNodes(cover, { from, to: to > lastForecast ? lastForecast : to }, {
      onProgress: (done, all) => say("rain", `Asking GFS… ${done} of ${all} points`),
    });
    const series = rainfallFrames(got.times, got.nodes, { start: from, windowH: 1, everyH: 1 });
    gfs = { ...got, ...series, hourIndex: new Map(got.times.map((t, k) => [t, k])) };
  }
  // Earth Engine: one composite per part, summed by the service over its window.
  let grids = new Map();
  if (plan.geeParts.length) {
    const parts = plan.geeParts.map((p) => ({ ...p, fromIso: isoZ(p.from), toIso: isoZ(p.to) }));
    grids = await fetchGeeRainParts(cover, parts, {
      rampMaxOf: (p) => (p.to - p.from > 86400000 * 1.01 ? rampMaxFor(p.to - p.from) : null),
      onProgress: (done, all) => say("rain", `Earth Engine: ${done} of ${all} renders…`),
    });
  }
  // The maps: each the units its window covers, GFS hours merged into runs.
  const hourKey = (t) => new Date(t).toISOString().slice(0, 16);
  let missingHours = 0;
  const frames = plan.frames.map((f) => {
    const pieces = [];
    for (const i of f.units) {
      for (const p of plan.units[i].parts) {
        if (p.src === "gfs") {
          const lo = gfs?.hourIndex.get(hourKey(p.from + HOUR)); const hi = gfs?.hourIndex.get(hourKey(p.to));
          if (lo === undefined || hi === undefined) { missingHours += Math.round((p.to - p.from) / HOUR); continue; }
          const last = pieces[pieces.length - 1];
          if (last?.kind === "gfs" && last.hi + 1 === lo) last.hi = hi; else pieces.push({ kind: "gfs", lo, hi });
        } else {
          pieces.push({ kind: "gee", key: p.key });
        }
      }
    }
    const hours = (Date.parse(`${f.time}Z`) - Date.parse(`${f.from}Z`)) / HOUR;
    const unit = plan.units[f.units[f.units.length - 1]];
    const span = unit.end - unit.start;
    const label = span >= 360 * 86400000 ? new Date(unit.start).toISOString().slice(0, 4)
      : span >= 27 * 86400000 ? new Date(unit.start).toISOString().slice(0, 7)
        : span === 86400000 ? new Date(unit.start).toISOString().slice(0, 10)
          : f.time.replace("T", " ");
    return { ...f, pieces, hours, label };
  });
  // What was capped at the top of a colour ramp reads as the top, not as what fell.
  let capped = 0; let cappedTop = 0;
  for (const g of grids.values()) if (g.capped) { capped += g.capped; cappedTop = g.top; }
  let maxRain = 0; let wettest = null;
  const label = (fr) => fr.sources.map(shortOf).join(" and ");
  const parts = Object.entries(plan.steps).map(([k, st]) => {
    const n = frames.filter((fr) => fr.sources.length === 1 && fr.sources[0] === k).length;
    return `${shortOf(k)} every ${stepText(st)}${n ? ` (${n.toLocaleString()} maps)` : ""}`;
  });
  const skipped = source === "auto" ? gees.filter((g) => !usable.includes(g) || !plan.units.some((u) => u.parts.some((p) => p.src === g.key)))
    .map((g) => (g.problem ? `${shortOf(g.key)}: ${g.problem}` : `${shortOf(g.key)} holds ${g.first} to ${g.last}`)) : [];
  const credits = [...new Set(plan.units.flatMap((u) => u.parts.map((p) => p.src)))].map((k) => (k === "gfs" ? GFS_CREDIT : GEE_RAIN_SOURCES[k].credit)).join("; ");
  const series = {
    kind: "series", frames, windowH, choice, window: { start, end }, cover, gfs, gee: { grids }, plan, credit: credits, sourceLabel: label,
    renders, stride: plan.stride, summary: "",
  };
  // The wettest map, from the nodes and pictures themselves.
  frames.forEach((fr) => {
    let m = 0;
    for (const p of fr.pieces) {
      if (p.kind === "gfs") { const acc = gfs.accumulateRange(p.lo, p.hi); for (const v of acc) if (v > m) m = v; }
      else { const g = grids.get(p.key); if (g) for (const v of g.values) if (v > m) m = v; }
    }
    if (m > maxRain) { maxRain = m; wettest = fr; }
  });
  const windows = [...new Set(frames.map((fr) => fr.hours))];
  series.summary = `${frames.length.toLocaleString()} rainfall maps — ${parts.join("; ")}${plan.stride > 1 ? `; every ${plan.stride}th kept, the run's limit` : ""}. `
    + `Each sums ${windowH ? `the ${windowH} h before it` : "its own step"}${windows.length > 1 ? ` (whole steps, so ${Math.min(...windows)}–${Math.max(...windows)} h)` : ""}. `
    + `${renders ? `${renders.toLocaleString()} Earth Engine render${renders > 1 ? "s" : ""}. ` : ""}`
    + `Wettest map ${wettest ? wettest.label : "—"}: ${maxRain.toFixed(0)} mm at a node or pixel.`
    + `${capped ? ` ${capped.toLocaleString()} pixels sat at the top of the ${cappedTop} mm colour ramp and read as ${cappedTop} mm — the deployed service does not raise the ramp for long windows yet.` : ""}`
    + `${missingHours ? ` ${missingHours} hours had no GFS value and count as dry.` : ""}`
    + `${skipped.length ? ` Not used: ${skipped.join("; ")}.` : ""} ${credits}.`;
  return series;
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

/**
 * THE BEDROCK UNDER EACH BLOCK, for the rock model: the bedrock map's
 * lithology (never the superficial deposit over it) read into the rock
 * properties the rock mass is built from — intact strength σci, Hoek–Brown mi,
 * the typical GSI, unit weight, mass conductivity. A bedrock that is
 * unconsolidated (GLiM's sediments, an alluvial fill) is not rock: the rock
 * model does not apply there and the soil model governs.
 */
function rockTable() {
  const cache = new Map();
  const list = [];
  return {
    list,
    indexOf(lith) {
      const key = lith || "";
      if (cache.has(key)) return cache.get(key);
      const text = lith ? groundText(lith) : null;
      const st = text ? stateOf(text) : null;
      const v = (k) => (text ? parameterValue(text, k) : null);
      const known = text && v("ucs") > 0 && v("hoek_brown_mi") > 0;
      const entry = st === "soil"
        ? { name: text, lith, rock: false, from: "the bedrock map — unconsolidated, so not rock" }
        : known
          ? { name: text, lith, rock: true, sci: v("ucs"), mi: v("hoek_brown_mi"), gsi: v("gsi_typical") ?? 50,
            gamma: ((v("dry_density") ?? 2600) * 9.81) / 1000, K: v("hydraulic_conductivity") ?? 1e-7, from: "the bedrock map, through the rock-properties database" }
          : { name: text ? `${text} (unresolved — a generic rock)` : "a generic rock", lith, rock: true, sci: 50, mi: 10, gsi: 50, gamma: 25, K: 1e-7,
            from: text ? "a stated default — the map's words did not resolve" : "a stated default — load a bedrock map (world geology or GLiM)" };
      list.push(entry); cache.set(key, list.length - 1);
      return list.length - 1;
    },
  };
}

async function readGround() {
  const b = state.bounds;
  if (!b) return;
  const maxCells = Number(byId("lsp-ground-cells").value) || 2000000;
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
    /**
     * THE MAP IS DRAWN AT THE DEM'S OWN POSTS. Every dataset informs the model
     * at its own resolution — the geology at 1:1,000,000, the soil map at
     * 1:5,000,000, the thickness at 1 km, the rain at 5–13 km — and the finest
     * of them, the DEM, sets the grid the factor of safety is mapped on. The
     * cell budget only coarsens it where the area is too big to hold, and then
     * says so.
     */
    const post = got?.ok && dem?.metresPerPixel ? dem.metresPerPixel(got.zoom, (b.south + b.north) / 2) : null;
    const grid = demGridFor(eb, heightAt, { maxCells, minStepM: post ? Math.max(5, post) : 10 });
    if (!grid.known) throw new Error("no elevation under the area");
    const native = Boolean(post) && grid.stepM <= post * 1.5;
    say("ground", "Reading the slope…");
    await tick();
    const grad = slopeOf(grid);
    let slopeFrom = native ? `Horn on the DEM's own ${Math.round(post)} m posts` : `the model's ${grid.stepM} m grid`;
    if (post && !native) {
      // One stencil at the centre is a POINT of the hillside and read as
      // speckle across a coarse cell; four, a quarter-cell each way, averaged
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
      if (replaced) slopeFrom = `the DEM's ${Math.round(post)} m posts, four stencils in each ${grid.stepM} m cell`;
    }
    say("ground", `Routing the water over ${(grid.width * grid.height).toLocaleString()} cells…`);
    await tick();
    const n = grid.width * grid.height;
    /**
     * THE WATER IS ROUTED DOWN THE RIVERS THAT ARE THERE, not down the ones a
     * DEM guesses. GRWL's centrelines are a survey; a flow network derived from
     * heights alone is an inference, and on a wide floodplain the two part
     * company — measured on the Rhône at Avignon before this, the 474 m river's
     * own burned cell had a contributing area of ONE CELL, because the DEM's
     * drainage line wandered a few posts to the side of it. The channel model
     * was then reading discharge at cells no water passes through: a peak of
     * 42 m³/s on a river that carries thousands.
     *
     * So the mapped rivers are BURNED INTO THE HEIGHTS before the topology is
     * built — the standard fix, and the reason the rivers are fetched here
     * rather than in `buildFlood`, which reuses what this read fetched. The
     * trench is a uniform drop, so the channel keeps its own downstream
     * gradient; it is deep enough that no floodplain relief can divert the
     * flow out of it, and `fillSinks` cannot fill it because it drains off the
     * grid. Nothing else reads the burned band: the slope comes from the DEM's
     * own posts and the flood depth from `grid.band`, so the trench is a fact
     * about where the water goes and about nothing else.
     */
    const rivers = await riverNetwork(eb, grid);
    const routeBand = rivers ? Float32Array.from(grid.band) : grid.band;
    if (rivers) {
      for (let i = 0; i < n; i += 1) if (rivers.riverWidth[i] > 0 && Number.isFinite(routeBand[i])) routeBand[i] -= RIVER_BURN_M;
    }
    const filled = fillSinks(makeRaster(routeBand, grid.width, grid.height, grid.bounds, NaN));
    const topo = mfdTopology(filled, { exponent: 1.1 });
    // The trench belongs to the ROUTING and to nothing else. Rockfall reads the
    // filled surface for its reach angle, and a hundred-metre canyon down every
    // river would hand a falling block a gorge to run into. The burn is a
    // uniform drop and `fillSinks` only ever raises, so putting it back at the
    // cells it was taken from restores the ground exactly.
    const fillBand = Float32Array.from(filled.band);
    if (rivers) {
      for (let i = 0; i < n; i += 1) if (rivers.riverWidth[i] > 0 && Number.isFinite(fillBand[i])) fillBand[i] += RIVER_BURN_M;
    }
    await tick();
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

    /**
     * THE INFORMING LATTICE. Material, thickness and rain are read on blocks of
     * about INFORM_M — finer than any of those sources resolves, so nothing is
     * lost — and every fine cell takes its block's. Reading a 1:5,000,000 soil
     * polygon at each of two million DEM cells is two million point-in-polygon
     * tests for an answer that cannot change inside a block.
     */
    const bk = Math.max(1, Math.round(INFORM_M / grid.stepM));
    const bw = Math.ceil(grid.width / bk); const bh = Math.ceil(grid.height / bk);
    const nb = bw * bh;
    const table = materialTable();
    const rocks = rockTable();
    const props = {
      rock: new Int32Array(nb).fill(-1),
      mat: new Int32Array(nb).fill(-1), K: new Float32Array(nb), zs: new Float32Array(nb), zf: new Float32Array(nb),
      c: new Float32Array(nb), phi: new Float32Array(nb), gamma: new Float32Array(nb), thin: new Uint8Array(nb),
      depthFrom: new Uint8Array(nb), lat: new Float32Array(nb), lon: new Float32Array(nb),
    };
    for (let by = 0; by < bh; by += 1) {
      const yc = Math.min(grid.height - 1, by * bk + (bk - 1) / 2);
      const lat = eb.north - ((yc + 0.5) / grid.height) * (eb.north - eb.south);
      for (let bx = 0; bx < bw; bx += 1) {
        const j = by * bw + bx;
        const xc = Math.min(grid.width - 1, bx * bk + (bk - 1) / 2);
        const lon = eb.west + ((xc + 0.5) / grid.width) * (eb.east - eb.west);
        props.lat[j] = lat; props.lon[j] = lon;
        const bedLith = bedAt ? bedAt(lat, lon) : null;
        const lith = (superAt && superAt(lat, lon)) || bedLith || null;
        props.rock[j] = rocks.indexOf(bedLith);
        const texture = texAt ? texAt(lat, lon) : null;
        const k = table.indexOf(lith, texture);
        const mat = table.list[k];
        props.mat[j] = k;
        const t = thickAt ? thickAt(lat, lon) : null;
        const col = soilColumn(t, 2);
        props.zs[j] = col.zs; props.zf[j] = col.zf; props.thin[j] = col.thin ? 1 : 0;
        props.depthFrom[j] = Number.isFinite(t) ? 1 : 0;
        props.K[j] = mat.K; props.c[j] = mat.cohesionKPa; props.phi[j] = mat.friction; props.gamma[j] = mat.unitWeight;
      }
      if (by % 64 === 63) await tick();
    }
    const cells = {
      data: new Uint8Array(n), model: new Uint8Array(n), block: new Int32Array(n).fill(-1),
      slopeRad: new Float32Array(n), area: new Float32Array(n), props,
      blocks: { k: bk, width: bw, height: bh, stepM: grid.stepM * bk },
    };
    const tally = { deposit: 0, texture: 0, regolith: 0, thick: 0, thin: 0, model: 0, cells: 0, gentle: 0 };
    let x0 = Infinity; let x1 = -1; let y0 = Infinity; let y1 = -1;
    for (let y = 0; y < grid.height; y += 1) {
      const lat = eb.north - ((y + 0.5) / grid.height) * (eb.north - eb.south);
      const inLat = lat >= b.south && lat <= b.north;
      for (let x = 0; x < grid.width; x += 1) {
        const i = y * grid.width + x;
        if (!Number.isFinite(grid.band[i])) continue;
        const j = Math.floor(y / bk) * bw + Math.floor(x / bk);
        cells.data[i] = 1; cells.block[i] = j;
        const deg = grad.band[i];
        cells.slopeRad[i] = Number.isFinite(deg) ? deg * Math.PI / 180 : 0;
        cells.area[i] = area[i];
        if (!inLat) continue;
        const lon = eb.west + ((x + 0.5) / grid.width) * (eb.east - eb.west);
        if (lon < b.west || lon > b.east) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        tally.cells += 1;
        const from = table.list[props.mat[j]].from;
        if (/mapped deposit/.test(from)) tally.deposit += 1;
        else if (/soil map/.test(from)) tally.texture += 1; else tally.regolith += 1;
        if (props.depthFrom[j]) tally.thick += 1;
        if (props.thin[j]) tally.thin += 1;
        if (!(deg >= 5)) tally.gentle += 1;
        cells.model[i] = 1; tally.model += 1;
      }
    }
    // The drawn sheet is the study area's own cells, bounded by their EDGES.
    const sub = { x0, x1, y0, y1, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    const cw = (eb.east - eb.west) / grid.width; const ch = (eb.north - eb.south) / grid.height;
    sub.bounds = { minX: eb.west + x0 * cw, maxX: eb.west + (x1 + 1) * cw, maxY: eb.north - y0 * ch, minY: eb.north - (y1 + 1) * ch };
    state.ground = { grid, eb, margin, topo, cells, sub, table, rocks, rivers, filled: fillBand, demLabel: label, slopeFrom, n, tally, native, post,
      maps: { soil: soil?.name || null, superficial: superficial?.name || null, bedrock: bedrock?.name || null } };
    if (state.rain) { state.rain.weights = null; state.rain.geePixels = null; }
    state.run = null;
    const kinds = [];
    if (tally.deposit) kinds.push(`${pct(tally.deposit, tally.cells)} a mapped deposit`);
    if (tally.texture) kinds.push(`${pct(tally.texture, tally.cells)} the soil map's texture`);
    if (tally.regolith) kinds.push(`${pct(tally.regolith, tally.cells)} regolith${bedrock || superficial ? " over the mapped rock" : ""}`);
    const res = native ? `mapped at the DEM's own ${grid.stepM} m posts` : `mapped at ${grid.stepM} m — the DEM has ${Math.round(post || grid.stepM)} m posts here, but the area is too big for the cell budget at that; draw a smaller one, or raise the budget`;
    say("ground", `${tally.cells.toLocaleString()} cells ${res} (${(grid.width * grid.height).toLocaleString()} with a ${margin.toFixed(1)} km upslope margin), from ${label}; slope from ${slopeFrom}. `
      + `Material, thickness and rain inform it on a ${Math.round(grid.stepM * bk)} m lattice — finer than any of those sources. `
      + `Material: ${kinds.join(", ")}.${soil ? "" : " Load the soil map for the topsoil texture — without it every column takes the database's regolith."} `
      + `Thickness from the model for ${pct(tally.thick, tally.cells)}${tally.thin ? ` (${pct(tally.thin, tally.cells)} under a metre, modelled as a veneer)` : ""}; ${pct(tally.gentle, tally.cells)} is gentle ground under 5°, modelled like the rest. `
      + `All ${tally.model.toLocaleString()} cells modelled.`, soil || bedrock || superficial ? "" : "error");
    describeStatic();
    buildRock();
    await buildFlood();
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
  const P = cells.props;
  for (let i = 0; i < n; i += 1) {
    if (!cells.model[i]) continue;
    const j = cells.block[i];
    const r = criticalRecharge({ slopeRad: cells.slopeRad[i], c: P.c[j], phi: P.phi[j], gamma: P.gamma[j],
      zs: P.zs[j], zf: P.zf[j], K: P.K[j], b: topo.contour, areaM2: cells.area[i], lateral: state.params.lateral });
    crit[i] = r;
    if (r === 0) dry += 1; else if (r === Infinity) never += 1; else if (Number.isFinite(r)) finite.push(r);
  }
  finite.sort((a, b) => a - b);
  const med = finite.length ? finite[Math.floor(finite.length / 2)] : NaN;
  const p10 = finite.length ? finite[Math.floor(finite.length / 10)] : NaN;
  g.crit = crit; g.critShown = null;
  const total = g.tally.model;
  say("hydro", `Rainfall to fail, as steady recharge over each cell's catchment: ${pct(dry, total)} fail even dry, ${pct(never, total)} hold even saturated; `
    + `for the rest the median is ${Number.isFinite(med) ? med.toFixed(0) : "—"} mm/day and the wettest-to-fail tenth ${Number.isFinite(p10) ? p10.toFixed(0) : "—"} mm/day or less.`);
}

/**
 * THE ROCK MODEL'S STATIC HALF, built once from the ground and rebuilt when a
 * rock control changes: each cell's slope height (local relief over the
 * chosen window), its rock mass's equivalent c′ and φ′ for a slope that high,
 * its dry critical plane, whether its bedrock is bare, whether it sheds
 * blocks, and how far and how fast blocks from every source run.
 */
function buildRock() {
  const g = state.ground;
  if (!g) return;
  const { grid, cells, n } = g; const P = cells.props;
  const pr = state.params;
  const r = Math.max(1, Math.round(pr.reliefM / grid.stepM));
  const H = localRelief(grid.band, grid.width, grid.height, r);
  const rc = new Float32Array(n).fill(NaN); const rphi = new Float32Array(n).fill(NaN);
  const theta = new Float32Array(n).fill(NaN); const dry = new Float32Array(n).fill(NaN);
  const exposed = new Uint8Array(n); const source = new Uint8Array(n);
  const expRad = pr.exposedDeg * Math.PI / 180; const srcRad = pr.sourceDeg * Math.PI / 180; const always = 55 * Math.PI / 180;
  // The rock mass's strength depends on H only through the stress range it is
  // fitted over, so it is kept per rock and per metre of height.
  const memo = new Map();
  let rockCells = 0; let bare = 0; let sourceCount = 0; let dryFail = 0;
  for (let i = 0; i < n; i += 1) {
    if (!cells.data[i]) continue;
    const j = cells.block[i];
    const rk = g.rocks.list[P.rock[j]];
    if (!rk?.rock) continue;
    const beta = cells.slopeRad[i];
    const h = Math.max(1, Math.round(H[i] || 0));
    const key = `${P.rock[j]}|${h}`;
    let m = memo.get(key);
    if (!m) {
      m = equivalentMohrCoulomb({ sci: rk.sci, gsi: Math.max(5, Math.min(100, rk.gsi + pr.gsiAdj)), mi: rk.mi, gamma: rk.gamma, H: h });
      memo.set(key, m);
    }
    rc[i] = m.c; rphi[i] = m.phi;
    const d = culmann({ H: H[i], betaRad: beta, c: m.c, phi: m.phi, gamma: rk.gamma });
    dry[i] = d.fos; theta[i] = d.theta * Math.PI / 180;
    const isBare = (P.thin[j] && beta >= expRad) || beta >= always;
    if (isBare) exposed[i] = 1;
    if (isBare && beta >= srcRad) source[i] = 1;
    if (cells.model[i]) { rockCells += 1; if (isBare) bare += 1; if (source[i]) sourceCount += 1; if (d.fos < 1) dryFail += 1; }
  }
  // `source` is the mask; passing the COUNT here seeded nothing and every
  // cell came back out of reach, with 44,373 sources sitting on the map.
  const energy = rockfallReach({ band: g.filled, width: grid.width, topo: g.topo, sources: source, reachDeg: pr.reachDeg, cellM: grid.stepM });
  let reached = 0; let vmax = 0;
  for (let i = 0; i < n; i += 1) {
    if (!cells.model[i] || !Number.isFinite(energy[i])) continue;
    reached += 1; const v = velocityOf(energy[i]); if (v > vmax) vmax = v;
  }
  g.rock = { H, rc, rphi, theta, dry, exposed, source, energy, reliefR: r, params: { ...pr } };
  const total = g.tally.model;
  const none = total - rockCells;
  say("fos", `Rock model: ${pct(rockCells, total)} of the area is rock${none ? ` (${pct(none, total)} is unconsolidated bedrock or unmapped — the soil model alone there)` : ""}; `
    + `${pct(bare, total)} is bare rock, ${sourceCount.toLocaleString()} cells shed blocks and ${reached.toLocaleString()} are within their reach (up to ${vmax.toFixed(0)} m/s). `
    + `Dry, ${dryFail.toLocaleString()} rock-slope cells stand below FoS 1; slope height read over ${pr.reliefM} m.`);
}

/**
 * THE CHANNEL HALF OF THE GROUND: the rivers, what they can carry, and how
 * fast the ground passes water to them.
 *
 * GRWL's centrelines are burned onto the model's own grid (`burnRivers`), so a
 * river cell is a cell the network crosses and its width is the widest reach
 * through it. The bankfull capacity comes from that width, the residence time
 * from the channel's own size where there is one and from the gradient where
 * there is not, and `sourceFields` records every cell's nearest river per band
 * of widths — geometry, computed once, so every rainfall map after this costs
 * arithmetic.
 *
 * The sea and the lakes come from the same masks the flood sheets use and are
 * never painted: they are water already.
 */
/**
 * WHOSE CATCHMENT IS WHOLE, and why a factor of safety is withheld where it is
 * not. The model routes only the rain that falls on the ground it mapped, so a
 * river entering the study area from upstream carries water the model never
 * saw — while its bankfull capacity is read from its WIDTH, which is the width
 * of a channel cut by its whole basin. Comparing the two puts the Rhône at
 * Avignon at 42 m³/s against a 20,100 m³/s brim and calls it stable under any
 * storm: an artefact of where the box was drawn rather than a forecast, and the
 * kind of confident wrong answer that is worse than no answer.
 *
 * A cell is OPEN when water can reach it from outside the mapped ground. The
 * flag is seeded on every data cell at the edge of the data region — the grid's
 * own border, or a cell next to ground the DEM has nothing for — and pushed
 * downslope over the same MFD topology the water takes, which is exact and
 * costs one pass. Where it is set the discharge is a LOWER BOUND and stands;
 * the factor of safety is not reported at all.
 */
/**
 * How deep the mapped rivers are cut into the heights before the flow network
 * is built. It is a ROUTING device rather than a depth: it only has to exceed
 * whatever relief could carry water out of the channel across a floodplain,
 * and nothing downstream reads the burned band.
 */
const RIVER_BURN_M = 100;

/**
 * The mapped river network on the model's own grid, or null where there is
 * none. Fetched once per ground read: the topology needs it before it can be
 * built, and `buildFlood` reads the same answer rather than asking twice.
 */
async function riverNetwork(eb, grid) {
  try {
    const rivers = await waterFeatures("rivers", eb, grid.width);
    if (!rivers?.features?.length) return null;
    const { riverWidth } = burnRivers(rivers.features, eb, grid.width, grid.height);
    let cells = 0;
    for (let i = 0; i < riverWidth.length; i += 1) if (riverWidth[i] > 0) cells += 1;
    return cells ? { features: rivers.features, zoom: rivers.zoom, riverWidth, cells } : null;
  } catch (error) {
    // A river service that will not answer must not stop the slope model: the
    // topology is then the DEM's own, which is what it always was.
    return null;
  }
}

/**
 * WHERE THE REACH'S WATER ACTUALLY IS. A wide river burned onto a grid is many
 * cells across — 474 m at 18 m posts is twenty-six — and the flow concentrates
 * in one line down the trench; the cells beside it drain only their own few
 * metres of bank. Read cell by cell, those side cells carry almost no water
 * against a whole basin's brim, which is the same false comfort the open flag
 * exists to withhold, and they read as CLOSED beside an open channel.
 *
 * So every river cell is snapped to its THALWEG: the river cell within half
 * the river's own width that the most ground drains through. A cell then
 * reports its reach's discharge and its reach's provenance rather than its own
 * bank's, which is what a reader means by "the river here".
 *
 * Spreading the flag along connected river cells instead was tried and is
 * wrong: a network is connected all the way to its trunk, so the Ardèche's own
 * headwaters — whose catchment really is inside the area — were made open by
 * joining the Rhône twenty kilometres downstream. Openness travels DOWNSTREAM
 * with the water, which `openCatchments` already has exactly right; what the
 * side cells needed was not spreading but snapping.
 */
export function thalwegOf({ riverWidth, acc, width, height, stepM, list }) {
  const thal = new Int32Array(list.length);
  const step = Math.max(1, stepM);
  for (let m = 0; m < list.length; m += 1) {
    const i = list[m];
    const x = i % width; const y = (i / width) | 0;
    const r = Math.max(1, Math.round((riverWidth[i] / 2) / step));
    let most = acc[i];
    for (let dy = -r; dy <= r; dy += 1) {
      const ny = y + dy; if (ny < 0 || ny >= height) continue;
      for (let dx = -r; dx <= r; dx += 1) {
        const nx = x + dx; if (nx < 0 || nx >= width) continue;
        const j = ny * width + nx;
        if (riverWidth[j] > 0 && acc[j] > most) most = acc[j];
      }
    }
    // THE NEAREST CELL THAT IS IN THE CHANNEL, not the biggest one in reach.
    // Accumulation grows downstream, so taking the window's maximum snaps every
    // cell to the far end of its own window and walks the whole reach's
    // discharge downstream by half a width. A bank cell carries a few cells'
    // worth against the channel's thousands, so half the window's maximum
    // separates the two by orders of magnitude and the tie is broken by
    // distance — which leaves a channel cell reporting itself.
    const bar = most / 2;
    let best = i; let bestD = acc[i] >= bar ? 0 : Infinity;
    for (let dy = -r; dy <= r && bestD; dy += 1) {
      const ny = y + dy; if (ny < 0 || ny >= height) continue;
      for (let dx = -r; dx <= r; dx += 1) {
        const nx = x + dx; if (nx < 0 || nx >= width) continue;
        const j = ny * width + nx;
        if (!(riverWidth[j] > 0) || acc[j] < bar) continue;
        const d = (dx * dx) + (dy * dy);
        if (d < bestD) { bestD = d; best = j; }
      }
    }
    thal[m] = best;
  }
  return thal;
}

export function openCatchments(g) {
  const { cells, n, topo, grid } = g;
  const open = new Uint8Array(n);
  const W = grid.width; const H = grid.height;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!cells.data[i]) continue;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) { open[i] = 1; continue; }
      for (let dy = -1; dy <= 1 && !open[i]; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) if (!cells.data[(y + dy) * W + (x + dx)]) { open[i] = 1; break; }
      }
    }
  }
  const { order, offsets, recv } = topo;
  for (let o = 0; o < order.length; o += 1) {
    const i = order[o];
    if (!open[i]) continue;
    for (let m = offsets[i], e = offsets[i + 1]; m < e; m += 1) open[recv[m]] = 1;
  }
  return open;
}

async function buildFlood() {
  const g = state.ground;
  if (!g) return;
  const { grid, eb, cells, n } = g;
  const pr = state.params;
  try {
    say("fos", "Reading the river network\u2026");
    // The network the topology was burned with, so the cells the water is
    // routed down and the cells the flood is read at are the same cells.
    const rivers = g.rivers || await riverNetwork(eb, grid);
    const water = await waterMasks(eb, grid.width, grid.height);
    const riverWidth = rivers ? rivers.riverWidth : new Float32Array(n);
    const wet = new Uint8Array(n);
    for (let c = 0; c < n; c += 1) wet[c] = (water.ocean[c] || !Number.isNaN(water.lakeLevel[c])) ? 1 : 0;
    const capacity = new Float32Array(n).fill(NaN);
    const list = [];
    let inArea = 0; let widest = 0; let capSum = 0;
    for (let i = 0; i < n; i += 1) {
      const w = riverWidth[i];
      if (!(w > 0) || !cells.data[i]) continue;
      capacity[i] = bankfullCapacity(w, pr.bankfull);
      list.push(i);
      if (cells.model[i]) { inArea += 1; if (w > widest) widest = w; capSum += capacity[i]; }
    }
    const k = residenceTimes({ n, slopeRad: cells.slopeRad, capacity, cellM: grid.stepM, hillV: pr.hillV });
    await tick();
    const drains = routeFlux(g.topo, Float64Array.from({ length: n }, (v, i) => (cells.data[i] ? 1 : 0)));
    const thalweg = thalwegOf({ riverWidth, acc: drains, width: grid.width, height: grid.height, stepM: grid.stepM, list });
    const cellOpen = openCatchments(g);
    // Read every reach's flag before writing any, or a snapped cell can be
    // read after it has been overwritten by its own neighbour's answer.
    const open = new Uint8Array(n);
    const reachAt = new Int32Array(n).fill(-1);
    for (let m = 0; m < list.length; m += 1) { open[list[m]] = cellOpen[thalweg[m]]; reachAt[list[m]] = thalweg[m]; }
    // THE GROUND THE MODEL ROUTES TO EACH REACH. A brim read from a satellite
    // width is the brim of a channel cut by its whole basin, and the only
    // honest way for a reader to weigh a factor of safety against it is to see
    // how much of that basin the model actually holds: measured near Montélimar,
    // GRWL calls one reach 393 m wide and the model drains 12.6 km² to it.
    const basin = new Float32Array(n).fill(NaN);
    const perCell = g.topo.cellArea / 1e6;
    for (let m = 0; m < list.length; m += 1) basin[list[m]] = drains[thalweg[m]] * perCell;
    let closed = 0;
    for (let m = 0; m < list.length; m += 1) if (cells.model[list[m]] && !open[list[m]]) closed += 1;
    const fields = list.length ? sourceFields(riverWidth, grid.width, grid.height, eb) : [];
    g.flood = { riverWidth, capacity, k, fields, water: wet, cells: Int32Array.from(list), open, closed, thalweg, reachAt, basin,
      zoom: rivers?.zoom ?? null, inArea, widest, params: { bankfull: pr.bankfull, hillV: pr.hillV } };
    if (!list.length) {
      say("fos", "No GRWL river reaches this area, so there is no channel to flood \u2014 the slope and rock models still run. "
        + "GRWL maps rivers 30 m wide and more; a headwater stream is not in it.", "");
      return;
    }
    // A sense of how long the catchment takes to answer: the residence time
    // along the longest flow path is the lag a reader should expect.
    const lag = travelToOutlet(g, k);
    say("fos", `Channel model: ${list.length.toLocaleString()} river cells on the grid `
      + `(${inArea.toLocaleString()} inside the study area), widest ${Math.round(widest).toLocaleString()} m, `
      + `carrying up to ${Math.round(Math.max(...list.map((i) => capacity[i]))).toLocaleString()} m\u00b3/s at the brim `
      + `(${pr.bankfull}\u00d7 the mean flow from GRWL's width). `
      + `Longest travel time to the outlet ${lag > 48 ? `${(lag / 24).toFixed(1)} days` : `${lag.toFixed(1)} h`} \u2014 `
      + "that is the lag between the rain and the peak. Rivers from GRWL v01.01 at zoom "
      + `${rivers?.zoom ?? "?"}; mean capacity ${Math.round(capSum / Math.max(1, inArea)).toLocaleString()} m\u00b3/s. `
      + (closed === inArea
        ? "Every river in the area has its whole catchment inside the mapped ground, so the discharge is the river's own."
        : `${closed.toLocaleString()} of ${inArea.toLocaleString()} river cells have their whole catchment inside the mapped ground`
          + (() => {
            // The widest reach the model will answer for, with the ground it
            // routes to it — the two numbers that say whether a factor of
            // safety here is worth anything.
            let wi = -1; let ww = 0;
            for (let m = 0; m < list.length; m += 1) {
              const i = list[m];
              if (cells.model[i] && !open[i] && riverWidth[i] > ww) { ww = riverWidth[i]; wi = i; }
            }
            return wi < 0 ? ". " : ` — the widest is ${Math.round(ww)} m, with ${basin[wi].toFixed(1)} km² draining to it. `;
          })()
          + "The rest are fed from upstream of the area, so the model sees only part of their water: their discharge is a LOWER BOUND "
          + "and they are given no factor of safety \u2014 a brim read from a river's width is the brim of a channel cut by its whole basin. "
          + "Draw an area that holds the catchment, or read those reaches as discharge alone."));
  } catch (error) {
    g.flood = null;
    say("fos", `The river network could not be read: ${error.message}. The slope and rock models still run.`, "error");
  }
}

/**
 * The longest travel time from any cell to where water leaves the grid, in
 * hours: each cell's own residence time plus the slowest of the cells it flows
 * into. The topology's order runs high to low, so walking it BACKWARDS meets
 * every receiver before its donors.
 */
export function travelToOutlet(g, k) {
  const { order, offsets, recv } = g.topo;
  const t = new Float32Array(g.n);
  let worst = 0;
  for (let o = order.length - 1; o >= 0; o -= 1) {
    const i = order[o];
    let down = 0;
    for (let m = offsets[i], e = offsets[i + 1]; m < e; m += 1) {
      const v = t[recv[m]];
      if (v > down) down = v;
    }
    t[i] = down + k[i];
    if (g.cells.model[i] && t[i] > worst) worst = t[i];
  }
  return worst / 3600;
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
  const P = g.cells.props;
  for (let j = 0; j < P.mat.length; j += 1) {
    const k = P.mat[j];
    if (k < 0) continue;
    P.c[j] = g.table.list[k].cohesionKPa; P.phi[j] = g.table.list[k].friction;
  }
  describeStatic();
  rerun();
}

function rerun() {
  if (state.run) void run({ keepStep: true });
}

/* ── step 6: every map through the static model, then the bar ───────────── */

/**
 * RECORD OR FORECAST, per map: a map whose window has ended is what the rain
 * DID (Earth Engine's archive, or GFS's own record of it); one whose window
 * reaches past now is a forecast. A run straddling today is both, and every
 * frame, the plot and the export say which it is.
 */
export function periodOf(time, now = Date.now()) {
  const t = Date.parse(/Z$/.test(time) ? time : `${time}${time.length <= 10 ? "T00:00" : ""}Z`);
  return Number.isFinite(t) && t > now ? "forecast" : "record";
}

/**
 * A frame's rainfall at a set of points — the model's informing blocks, or
 * the rain layer's display lattice — as the sum of its pieces, whichever
 * source each came from. One function for both, so the rain the model is fed
 * and the rain drawn on the globe cannot disagree. The interpolation weights
 * and pixel tables are cached on the points, per rainfall fetch.
 */
function rainAtPoints(frame, pts) {
  const r = state.rain; const n = pts.lat.length;
  if (!pts.rainCache || pts.rainCache.rain !== r) pts.rainCache = { rain: r, weights: null, gee: new Map() };
  const c = pts.rainCache;
  const out = new Float32Array(n);
  for (const p of frame.pieces) {
    if (p.kind === "gfs") {
      if (!c.weights) {
        const idx = new Int32Array(n * 4); const wt = new Float32Array(n * 4);
        for (let j = 0; j < n; j += 1) {
          const it = interpolatorFor(r.gfs.grid, r.gfs.nodes, pts.lat[j], pts.lon[j]);
          idx.set(it.idx, j * 4); wt.set(it.wt, j * 4);
        }
        c.weights = { idx, wt };
      }
      const acc = r.gfs.accumulateRange(p.lo, p.hi);
      const { idx, wt } = c.weights;
      for (let j = 0; j < n; j += 1) {
        const o = j * 4;
        out[j] += wt[o] * acc[idx[o]] + wt[o + 1] * acc[idx[o + 1]] + wt[o + 2] * acc[idx[o + 2]] + wt[o + 3] * acc[idx[o + 3]];
      }
    } else if (p.kind === "gee") {
      const grid = r.gee.grids.get(p.key);
      if (!grid) continue;
      const key = `${grid.width}x${grid.height}|${grid.bounds.minX},${grid.bounds.minY},${grid.bounds.maxX},${grid.bounds.maxY}`;
      let at = c.gee.get(key);
      if (!at) {
        at = new Int32Array(n).fill(-1);
        for (let j = 0; j < n; j += 1) at[j] = pixelIndex(grid, pts.lat[j], pts.lon[j]);
        c.gee.set(key, at);
      }
      for (let j = 0; j < n; j += 1) {
        const v = at[j] >= 0 ? grid.values[at[j]] : NaN;
        if (Number.isFinite(v)) out[j] += v;
      }
    }
  }
  return out;
}

/** A frame's rainfall on every block of the informing lattice. */
function rainMapFor(frame) {
  return rainAtPoints(frame, state.ground.cells.props);
}

/* ── the rainfall maps as a layer of their own ──────────────────────────── */

export const RAIN_LAYER = "Rainfall maps — landslide forecast (mm)";
/** Dry ground is left undrawn, so the maps sit over the imagery rather than greying it out. */
export const RAIN_CLASSES = [
  { max: 0.5, label: "under 0.5 mm — not drawn", colour: null },
  { max: 5, label: "0.5–5", colour: [198, 219, 239] }, { max: 10, label: "5–10", colour: [158, 202, 225] },
  { max: 25, label: "10–25", colour: [107, 174, 214] }, { max: 50, label: "25–50", colour: [33, 113, 181] },
  { max: 100, label: "50–100", colour: [8, 48, 107] }, { max: 200, label: "100–200", colour: [106, 81, 163] },
  { max: Infinity, label: "200 and more", colour: [63, 0, 125] },
];

/** The display lattice over the fetched area: about a kilometre a cell, at most 256 across. */
export function rainLattice(cover) {
  const midLat = (cover.south + cover.north) / 2;
  const wKm = (cover.east - cover.west) * 111.32 * Math.cos(midLat * Math.PI / 180);
  const hKm = (cover.north - cover.south) * 110.574;
  const cell = Math.max(0.5, Math.max(wKm, hKm) / 256);
  const width = Math.max(8, Math.min(256, Math.round(wKm / cell)));
  const height = Math.max(8, Math.min(256, Math.round(hKm / cell)));
  const lat = new Float32Array(width * height); const lon = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      lat[y * width + x] = cover.north - ((y + 0.5) / height) * (cover.north - cover.south);
      lon[y * width + x] = cover.west + ((x + 0.5) / width) * (cover.east - cover.west);
    }
  }
  return { width, height, lat, lon, bounds: { minX: cover.west, maxX: cover.east, minY: cover.south, maxY: cover.north }, cellKm: cell };
}

function removeRainLayer() {
  const im = window.GeoIDImportManager;
  (im?.getLayers?.() || []).filter((l) => l.name === RAIN_LAYER).forEach((l) => im.removeLayer?.(l.id));
  if (state.rainLayer) state.rainLayer = null;
}

/** Put the rainfall maps on the globe, under whatever the model draws, half transparent. */
function showRainLayer() {
  removeRainLayer();
  const r = state.rain;
  if (!r) return null;
  const pts = rainLattice(r.cover);
  const band = new Float32Array(pts.width * pts.height).fill(NaN);
  const built = buildRasterLayer([band], pts.width, pts.height, pts.bounds, { name: RAIN_LAYER, isDem: false, noData: NaN });
  if (!built) return null;
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(RAIN_LAYER, built, "rain");
  if (!layer) return null;
  window.GeoIDLayerHierarchy?.setOpacity?.(layer, 0.55);
  layer.info = {
    source: r.credit,
    summary: `The rainfall maps the landslide model is run on: each the rain over the ${r.windowH ? `${r.windowH} h` : "time step"} before its time, on a ${pts.cellKm.toFixed(1)} km lattice over the fetched area (the study area and its upslope margin). GFS is drawn as the model reads it — bilinear between its ~13 km nodes; an Earth Engine day as its own pixels.`,
  };
  state.rainLayer = { layer, built, band, pts, shown: -1 };
  return state.rainLayer;
}

/** Draw one frame of rain on the rain layer, with its key. */
function paintRain(k) {
  const rl = state.rainLayer; const r = state.rain;
  if (!rl || !r || !r.frames[k]) return;
  if (!(window.GeoIDImportManager?.getLayers?.() || []).includes(rl.layer)) { state.rainLayer = null; return; }
  rl.shown = k;
  const frame = r.frames[k];
  rl.band.set(rainAtPoints(frame, rl.pts));
  const counts = new Array(RAIN_CLASSES.length).fill(0);
  for (const v of rl.band) { const c = classIn(RAIN_CLASSES, v); if (c >= 0) counts[c] += 1; }
  try { rl.built.repaint?.((v) => { const c = classIn(RAIN_CLASSES, v); return c >= 0 ? RAIN_CLASSES[c].colour : null; }); } catch (e) { /* stands */ }
  rl.layer.legendInfo = {
    classed: true, categorical: true, field: "rain",
    label: `Rain over the ${frame.hours} h to ${frame.time.replace("T", " ")} UTC — ${r.sourceLabel(frame)}, ${periodOf(frame.time)} (mm)`,
    palette: RAIN_CLASSES.map((c) => (c.colour ? hex(c.colour) : "3a4152")), labels: RAIN_CLASSES.map((c) => c.label), counts,
  };
  window.GeoIDLayerHierarchy?.render?.();
}

/** The map to open on before a run: the wettest one. */
function wettestFrame() {
  const r = state.rain; const rl = state.rainLayer;
  if (!r || !rl) return 0;
  let best = 0; let bestMax = -1;
  r.frames.forEach((f, k) => {
    const v = rainAtPoints(f, rl.pts);
    let m = 0; for (let j = 0; j < v.length; j += 1) if (v[j] > m) m = v[j];
    if (m > bestMax) { bestMax = m; best = k; }
  });
  return best;
}

/**
 * Before any model has run, the bar plays the rain alone: fetching is the
 * moment somebody wants to SEE what was fetched, and a series only readable
 * after a model has been built on it is a series nobody checks first.
 */
async function playRain() {
  const r = state.rain;
  if (!r || !state.rainLayer || state.run) return;
  const startAt = wettestFrame();
  paintRain(startAt);
  const b = r.cover;
  state.playing = true;
  await startPlayer({
    bounds: { west: b.west, east: b.east, south: b.south, north: b.north },
    epochs: r.frames.map((f, k) => ({ date: f.time, label: `${f.label} · ${periodOf(f.time)}`, dataset: null, index: k })),
    source: "none", interval: 400, startAt,
    noteFor: (e) => { const v = state.rainLayer?.band; let m = 0; if (v) for (const x of v) if (x > m) m = x; return `rain · up to ${m.toFixed(0)} mm`; },
    noteTitle: (e) => `${r.sourceLabel(r.frames[e.index])} rain over the ${r.frames[e.index].hours} h to ${e.date} UTC. Read the ground and run the model to see what it does to the slopes.`,
    onStatus: (m) => say("rain", m),
    onShow: (index) => { paintRain(index); },
    onStop: () => { state.playing = false; },
  });
}

function modelFrame(k) {
  const r = state.rain; const g = state.ground;
  const rainMm = rainMapFor(r.frames[k]);
  if (!g.scratch || g.scratch.source.length !== g.n) {
    g.scratch = { source: new Float64Array(g.n), fos: new Float32Array(g.n), W: new Float32Array(g.n), rock: new Float32Array(g.n),
      excess: new Float64Array(g.n), runoff: new Float32Array(g.n) };
  }
  const out = staticStep({ rainMm, windowH: r.frames[k].hours, cells: g.cells, topo: g.topo,
    infiltration: state.params.infiltration, lateral: state.params.lateral, scratch: g.scratch });
  out.rockFos = rockFrame(out.q);
  splitRain(out, r.frames[k]);
  return out;
}

/**
 * The rock model under one map: each rock cell's joint water from the routed
 * recharge, and its rock slope's factor of safety on its dry critical plane
 * (`culmannAt` — within 0.44 % of re-minimising). NaN where there is no rock.
 */
function rockFrame(q) {
  const g = state.ground; const rk = g.rock;
  const out = g.scratch.rock.fill(NaN);
  if (!rk) return out;
  const { cells } = g; const P = cells.props; const list = g.rocks.list; const b = g.topo.contour;
  for (let i = 0; i < g.n; i += 1) {
    if (!Number.isFinite(rk.dry[i])) continue;
    const m = list[P.rock[cells.block[i]]];
    out[i] = rockCell({ q: q[i], contour: b, betaRad: cells.slopeRad[i], c: rk.rc[i], phi: rk.rphi[i], gamma: m.gamma, K: m.K, H: rk.H[i], thetaRad: rk.theta[i] }).fos;
  }
  return out;
}

/**
 * WHERE THE STORM GOES, at every cell, under one map: what soaks in (the slope
 * model's recharge, which `staticStep` has already routed) and what is left on
 * the surface. The saturation `staticStep` reports is what decides it — a
 * column already full returns what it cannot hold — so the two hazards share
 * one water balance rather than each taking the whole storm.
 *
 * `excess` is the flood model's supply in m³/s per cell; `runoff` the share of
 * the rain that ran off, which is the map that says WHY a catchment is
 * flashy on one day and not on another.
 */
function splitRain(out, frame) {
  const g = state.ground; const { cells, n, topo } = g;
  const B = cells.block; const P = cells.props;
  const per = 1 / (1000 * frame.hours * 3600);
  const excess = g.scratch.excess.fill(0);
  const coef = g.scratch.runoff.fill(NaN);
  const infiltration = state.params.infiltration;
  let rainSum = 0; let offSum = 0;
  for (let i = 0; i < n; i += 1) {
    if (!cells.data[i]) continue;
    const j = B[i];
    const rain = out.rainMm[j];
    if (!Number.isFinite(rain)) continue;
    const p = partition({ rainMs: rain * per, K: P.K[j], W: out.W[i], infiltration });
    excess[i] = p.runoff * topo.cellArea;
    coef[i] = p.coefficient;
    if (cells.model[i] && rain > 0) { rainSum += rain * per; offSum += p.runoff; }
  }
  out.excess = excess; out.runoff = coef;
  out.runoffShare = rainSum > 0 ? offSum / rainSum : 0;
  return out;
}

/** The seconds a frame stands for: the gap to the map before it, not its rainfall window. */
export function frameStepSeconds(frames, k) {
  const now = Date.parse(frames[k].time);
  const before = k > 0 ? Date.parse(frames[k - 1].time) : now - (frames[k].hours * 3600000);
  const dt = (now - before) / 1000;
  return Number.isFinite(dt) && dt > 60 ? dt : Math.max(60, (frames[k].hours || 1) * 3600);
}

/**
 * A WAVE HAS TO BE MARCHED IN ORDER, which is what makes the flood model
 * different in kind from the other two: each of those is a static answer to
 * one map and can be recomputed for any frame on demand, while this one
 * carries its water from map to map. So the run marches it once, front to
 * back, and keeps the discharge AT THE RIVER CELLS for every frame — a few
 * thousand cells rather than the whole grid, which is what makes scrubbing the
 * bar free afterwards. Off the channel there is no capacity and no flood to
 * report, so nothing is lost by not keeping it.
 */
function startWave(frames) {
  const g = state.ground; const fl = g.flood;
  if (!fl || !fl.cells.length) return null;
  const R = fl.cells.length;
  return {
    store: new Float64Array(g.n), inflow: new Float64Array(g.n), q: new Float32Array(g.n),
    series: new Float32Array(frames.length * R), peak: new Float32Array(R),
    minFos: new Float32Array(R).fill(Infinity), R,
  };
}

function waveFrame(wave, out, frames, k) {
  const g = state.ground; const fl = g.flood; const cells = g.cells;
  waveStep({ topo: g.topo, store: wave.store, source: out.excess, k: fl.k,
    dtS: frameStepSeconds(frames, k), out: wave.q, inflow: wave.inflow });
  const base = k * wave.R;
  let over = 0; let peakQ = 0; let worst = Infinity;
  for (let m = 0; m < wave.R; m += 1) {
    const i = fl.cells[m];
    // The reach's own water, not this cell's bank: a wide channel's flow is in
    // one line down the trench and every cell of the reach reports it.
    const q = wave.q[fl.thalweg[m]];
    wave.series[base + m] = q;
    if (q > wave.peak[m]) wave.peak[m] = q;
    if (!cells.model[i]) continue;
    // The discharge is real wherever the model routed it — a lower bound on an
    // open reach, the river's own where the catchment is closed — so the peak
    // is taken before the brim is. Only the FACTOR OF SAFETY is withheld.
    if (q > peakQ) peakQ = q;
    if (fl.open[i]) continue;
    const fos = floodFos(fl.capacity[i], q);
    if (fos < wave.minFos[m]) wave.minFos[m] = fos;
    if (fos < 1) over += 1;
    if (fos < worst) worst = fos;
  }
  return { over, peakQ, worstFos: Number.isFinite(worst) ? worst : NaN, runoffShare: out.runoffShare };
}

/**
 * One frame's flood, read back out of the marched wave: the discharge and the
 * factor of safety on every river cell, and the stage each reach stands at —
 * which is what `inundate` spreads over the ground when the depth view asks
 * for it. Buffers are kept on the run: a scrub would otherwise churn three
 * arrays the size of the grid per step.
 */
function floodFrame(k) {
  const g = state.ground; const run = state.run; const fl = g?.flood; const wave = run?.wave;
  if (!fl || !wave) return null;
  if (!run.floodScratch) {
    run.floodScratch = { q: new Float32Array(g.n), fos: new Float32Array(g.n), rise: new Float32Array(g.n) };
  }
  const { q, fos, rise } = run.floodScratch;
  q.fill(NaN); fos.fill(NaN); rise.fill(0);
  const base = k * wave.R; const ratio = state.params.bankfull;
  for (let m = 0; m < wave.R; m += 1) {
    const i = fl.cells[m];
    const v = wave.series[base + m];
    q[i] = v;
    if (fl.open[i]) continue;
    fos[i] = floodFos(fl.capacity[i], v);
    rise[i] = riseFor({ widthM: fl.riverWidth[i], q: v, capacity: fl.capacity[i], ratio });
  }
  return { q, fos, rise, depth: null };
}

/** The flood spread over the ground for the frame on screen — only when a view asks. */
function floodDepth(frame) {
  const g = state.ground; const fl = g.flood;
  if (!frame || frame.depth) return frame?.depth || null;
  const pr = state.params;
  const out = inundate({
    heights: g.grid.band, riverWidth: fl.riverWidth, water: fl.water, fields: fl.fields,
    width: g.grid.width, height: g.grid.height, riseAt: frame.rise,
    params: { ...FLOOD_DEFAULTS, reach: pr.reach, defended: pr.defended, connected: true },
  });
  frame.depth = out.depth; frame.cutOff = out.cutOff; frame.channel = out.channel;
  return frame.depth;
}

/** Which model speaks for a cell: bare rock is the rock model's; elsewhere the weaker of the two. */
function governingFos(i, soil, rock) {
  const rk = state.ground.rock;
  if (rk?.exposed[i]) return rock;
  if (!Number.isFinite(rock)) return soil;
  if (!Number.isFinite(soil)) return rock;
  return Math.min(soil, rock);
}

const FOS_VIEW_CLASSES = FOS_CLASSES.map((c, i) => ({ ...c, lo: [0, 1, 1.1, 1.3, 1.5][i] }));
/**
 * A reach fed from outside the mapped ground gets a class of its own rather
 * than a number: its discharge is a lower bound and its brim is its whole
 * basin's, so any ratio of the two is a statement about the study area's edge.
 * The sentinel is a value no factor of safety can take.
 */
const OPEN_REACH = -1;
const FLOOD_VIEW_CLASSES = [
  { max: Infinity, label: "fed from upstream — the model sees only part of its water", colour: [120, 122, 130] },
  ...FLOOD_CLASSES,
];
const openReach = (i) => {
  const fl = state.ground?.flood;
  return !!(fl && fl.open?.[i] && Number.isFinite(fl.capacity[i]));
};
const floodClassOf = (v) => {
  if (v === OPEN_REACH) return 0;
  if (!Number.isFinite(v)) return -1;
  const c = classIn(FLOOD_CLASSES, v);
  return c < 0 ? -1 : c + 1;
};
const classIn = (classes, v) => (Number.isFinite(v) ? classes.findIndex((k) => v < k.max) : -1);

/** Block velocity classes for rockfall reach, m/s. */
const ROCKFALL_CLASSES = [
  { max: 5, label: "reached — under 5 m/s", colour: [254, 217, 118] }, { max: 15, label: "5–15 m/s", colour: [253, 141, 60] },
  { max: 30, label: "15–30 m/s", colour: [240, 59, 32] }, { max: Infinity, label: "30 m/s and faster", colour: [189, 0, 38] },
];

/**
 * The governing failure mode, most urgent first: a cell that sheds blocks,
 * then a rock slope or a soil slide below FoS 1, then ground blocks run out
 * over, then either model marginal, then stable in both.
 */
export const MODE_CLASSES = [
  { key: "source", label: "Rockfall source — bare, steep rock", colour: [103, 0, 31] },
  { key: "rock", label: "Rock slope fails — FoS < 1", colour: [122, 1, 119] },
  { key: "soil", label: "Soil slide — FoS < 1", colour: [215, 25, 28] },
  { key: "runout", label: "Rockfall runout — within reach of a source", colour: [253, 141, 60] },
  { key: "rockm", label: "Rock slope marginal — FoS 1–1.3", colour: [197, 27, 138] },
  { key: "soilm", label: "Soil slide marginal — FoS 1–1.3", colour: [254, 217, 118] },
  { key: "stable", label: "Stable in both models — FoS ≥ 1.3", colour: [44, 127, 184] },
];

/** A cell's governing mode, as an index into MODE_CLASSES (pure, for the tests). */
export function modeOf({ source, reached, exposed, soil, rock }) {
  if (source) return 0;
  if (rock < 1) return 1;
  if (!exposed && soil < 1) return 2;
  if (reached) return 3;
  if (rock < 1.3) return 4;
  if (!exposed && soil < 1.3) return 5;
  return 6;
}

const VIEW = {
  mode: {
    label: "Governing failure — soil, rock slope or rockfall",
    classes: MODE_CLASSES,
    value: (i, fo, rk) => modeOf({ source: rk?.source[i], reached: Number.isFinite(rk?.energy[i]), exposed: rk?.exposed[i], soil: fo.fos[i], rock: fo.rockFos[i] }) + 0.5,
    classOf: (v) => (Number.isFinite(v) ? Math.floor(v) : -1),
  },
  fos: {
    label: "Soil slide — factor of safety",
    classes: [...FOS_VIEW_CLASSES, { max: Infinity, label: "bare rock — no soil to slide (the rock model governs)", colour: [96, 102, 116] }],
    value: (i, fo, rk) => (rk?.exposed[i] ? -1 : fo.fos[i]),
    classOf: (v) => (v < 0 ? FOS_VIEW_CLASSES.length : classIn(FOS_VIEW_CLASSES, v)),
  },
  rockfos: {
    label: "Rock slope — factor of safety (Culmann on the rock mass)",
    classes: [...FOS_VIEW_CLASSES, { max: Infinity, label: "not rock — unconsolidated bedrock (the soil model governs)", colour: [150, 138, 104] }],
    value: (i, fo) => (Number.isFinite(fo.rockFos[i]) ? fo.rockFos[i] : -1),
    classOf: (v) => (v < 0 ? FOS_VIEW_CLASSES.length : classIn(FOS_VIEW_CLASSES, v)),
  },
  rockfall: {
    label: "Rockfall — sources, and reach by block velocity",
    classes: [{ max: Infinity, label: "source — bare, steep rock", colour: [103, 0, 31] }, ...ROCKFALL_CLASSES],
    value: (i, fo, rk) => (rk?.source[i] ? -1 : velocityOf(rk?.energy[i])),
    classOf: (v) => (v < 0 ? 0 : Number.isFinite(v) ? 1 + classIn(ROCKFALL_CLASSES, v) : -1),
  },
  minfos: { label: "Lowest factor of safety over the window — whichever model governs", classes: FOS_VIEW_CLASSES, classOf: (v) => classIn(FOS_VIEW_CLASSES, v) },
  floodfos: {
    label: "Channel — factor of safety (what it carries at the brim / what is arriving)",
    classes: FLOOD_VIEW_CLASSES,
    value: (i, fo) => (openReach(i) ? OPEN_REACH : fo.flood ? fo.flood.fos[i] : NaN),
    classOf: floodClassOf,
  },
  flooddepth: {
    label: "Flood depth over the ground (m)",
    classes: DEPTH_CLASSES,
    value: (i, fo) => { const d = fo.flood?.depth; return d ? d[i] : NaN; },
    classOf: (v) => (v > 0 ? classIn(DEPTH_CLASSES, v) : -1),
  },
  discharge: {
    label: "Discharge in the channel (m³/s)",
    classes: DISCHARGE_CLASSES,
    value: (i, fo) => (fo.flood ? fo.flood.q[i] : NaN),
    classOf: (v) => (v > 0 ? classIn(DISCHARGE_CLASSES, v) : -1),
  },
  minfloodfos: {
    label: "Lowest channel factor of safety over the window",
    classes: FLOOD_VIEW_CLASSES,
    value: (i, fo, rk, run) => (openReach(i) ? OPEN_REACH : run.floodMin ? run.floodMin[i] : NaN),
    classOf: floodClassOf,
  },
  runoff: {
    label: "Runoff — the share of the rain that ran off",
    classes: RUNOFF_CLASSES,
    value: (i, fo) => fo.runoff[i],
    classOf: (v) => (Number.isFinite(v) ? classIn(RUNOFF_CLASSES, v) : -1),
  },
  wet: {
    label: "Saturation h / z_s",
    classes: [
      { max: 0.2, label: "under 0.2", colour: [237, 248, 251] }, { max: 0.4, label: "0.2–0.4", colour: [179, 205, 227] },
      { max: 0.6, label: "0.4–0.6", colour: [140, 150, 198] }, { max: 0.8, label: "0.6–0.8", colour: [136, 86, 167] },
      { max: 0.999, label: "0.8–1", colour: [129, 15, 124] }, { max: Infinity, label: "saturated", colour: [77, 0, 75] },
    ],
  },
  rain: {
    label: "Rainfall over the window (mm)",
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

const hex = (rgb) => rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

function paintView(frameOut) {
  const run = state.run; const g = state.ground; const rk = g.rock;
  const view = VIEW[state.view] || VIEW.mode;
  // The spread over the floodplain is the one expensive reading here, so it is
  // computed for the frame on screen and only when a view asks for it.
  if (state.view === "flooddepth" && frameOut.flood) floodDepth(frameOut.flood);
  const classOf = view.classOf || ((v) => classIn(view.classes, v));
  const src = view.value ? null : state.view === "wet" ? frameOut.W : state.view === "rain" ? frameOut.rainMm
    : state.view === "minfos" ? run.minFos : (g.critShown || (g.critShown = g.crit.map((v) => (v === Infinity ? 1e9 : v))));
  const counts = new Array(view.classes.length).fill(0);
  // Every cell with ground under it is modelled and drawn, whatever its slope.
  const { sub } = g; const c_ = g.cells;
  for (let y = 0; y < sub.height; y += 1) {
    for (let x = 0; x < sub.width; x += 1) {
      const i = (y + sub.y0) * g.grid.width + (x + sub.x0);
      const v = !c_.data[i] ? NaN : view.value ? view.value(i, frameOut, rk, run) : state.view === "rain" ? src[c_.block[i]] : src[i];
      run.band[y * sub.width + x] = v;
      const c = classOf(v);
      if (c >= 0) counts[c] += 1;
    }
  }
  try { run.built.repaint?.((v) => { const c = classOf(v); return c >= 0 ? view.classes[c].colour : null; }); } catch (e) { /* stands */ }
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
  run.current.flood = floodFrame(k);
  run.current.frame = k;
  paintView(run.current);
  paintRain(k);
  updateReadings();
  drawPlot();
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
    const exposed = g.rock?.exposed;
    // The wave is marched here, in order, and nowhere else: `showStep` reads
    // the discharge it recorded rather than re-running it.
    const wave = startWave(frames);
    for (let k = 0; k < frames.length; k += 1) {
      const out = modelFrame(k);
      const flood = wave ? waveFrame(wave, out, frames, k) : null;
      let maxRain = 0; let soilFail = 0; let rockFail = 0;
      for (let i = 0; i < g.n; i += 1) {
        if (!g.cells.model[i]) continue;
        const rr = out.rainMm[g.cells.block[i]]; if (rr > maxRain) maxRain = rr;
        const soil = exposed?.[i] ? NaN : out.fos[i];
        const rock = out.rockFos[i];
        if (soil < 1) soilFail += 1;
        if (rock < 1) rockFail += 1;
        const v = governingFos(i, out.fos[i], rock);
        if (!Number.isFinite(v)) continue;
        if (!(minFos[i] <= v)) { minFos[i] = v; minAt[i] = k; }
      }
      summary.push({ failing: soilFail + rockFail, soilFail, rockFail, applicable: out.applicable, meanW: out.meanW, maxRain,
        over: flood ? flood.over : 0, peakQ: flood ? flood.peakQ : 0, worstFos: flood ? flood.worstFos : NaN,
        runoffShare: out.runoffShare });
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
    // The lowest channel factor of safety over the whole window, as a map.
    let floodMin = null;
    if (wave) {
      floodMin = new Float32Array(g.n).fill(NaN);
      for (let m = 0; m < wave.R; m += 1) {
        const v = wave.minFos[m];
        if (Number.isFinite(v)) floodMin[g.flood.cells[m]] = v;
      }
    }
    state.run = { layer, built, band, frames, summary, minFos, minAt, current: null, wave, floodMin, floodScratch: null };
    let worst = 0;
    summary.forEach((s, k) => {
      const now = s.failing + s.over; const best = summary[worst].failing + summary[worst].over;
      if (now > best || (now === best && s.meanW > summary[worst].meanW)) worst = k;
    });
    const startAt = resume >= 0 && resume < frames.length ? resume : worst;
    showStep(startAt);
    const epochs = frames.map((f, k) => ({ date: f.time, label: `${f.label || f.time.replace("T", " ")} · ${periodOf(f.time)}`, dataset: null, index: k }));
    state.playing = true;
    await startPlayer({
      bounds: { west: g.sub.bounds.minX, east: g.sub.bounds.maxX, south: g.sub.bounds.minY, north: g.sub.bounds.maxY },
      epochs, source: "none", interval: 400, startAt,
      noteFor: (e) => { const s = summary[e.index]; return `soil ${s.soilFail.toLocaleString()} · rock ${s.rockFail.toLocaleString()}${wave ? ` · channel ${s.over.toLocaleString()}` : ""} · ${s.maxRain.toFixed(0)} mm`; },
      noteTitle: (e) => { const s = summary[e.index]; return `${periodOf(e.date) === "forecast" ? "Forecast" : "Record"}: ${r.sourceLabel(frames[e.index])} rain over the ${frames[e.index].hours} h to ${e.date}: up to ${s.maxRain.toFixed(0)} mm in the area; ${s.soilFail} cells below FoS 1 in the soil model and ${s.rockFail} in the rock-slope model, of ${s.applicable}; mean saturation ${s.meanW.toFixed(2)}; ${(100 * s.runoffShare).toFixed(0)}% of the rain running off`
        + `${wave ? `, ${s.over} river cells over their brim, peak discharge ${Math.round(s.peakQ).toLocaleString()} m³/s` : ""}.`; },
      onStatus: (m) => say("run", m),
      onShow: (index) => showStep(index),
      onStop: () => { state.playing = false; },
    });
    const w = summary[worst];
    const ever = [...minFos].filter((v) => Number.isFinite(v) && v < 1).length;
    say("run", `${frames.length} static models, one per rainfall map. Worst map ${frames[worst].time.replace("T", " ")}: ${w.soilFail.toLocaleString()} soil and ${w.rockFail.toLocaleString()} rock-slope cells below FoS 1 of ${w.applicable.toLocaleString()} under up to ${w.maxRain.toFixed(0)} mm in ${frames[worst].hours} h. `
      + `${ever.toLocaleString()} cells fall below 1 at some point in whichever model governs them. `
      + `${g.rock ? `Rockfall: ${[...g.rock.source].filter((v, i) => v && g.cells.model[i]).length.toLocaleString()} source cells, ${[...g.rock.energy].filter((v, i) => Number.isFinite(v) && g.cells.model[i]).length.toLocaleString()} within reach. ` : ""}`
      + floodReport(wave, summary, frames)
      + "Scrub the bar; change the view; click a cell for its numbers.");
    void recordStations();
  } catch (error) {
    say("run", `The run failed: ${error.message}`, "error");
  } finally {
    running = false;
    markStates();
  }
}

/**
 * WHAT THE CHANNEL DID, and the lag that is the point of routing a wave. The
 * worst channel frame is reported against the wettest one, because on any
 * catchment bigger than a hillside they are not the same map — and the gap
 * between them is the warning a forecast gives.
 */
function floodReport(wave, summary, frames) {
  if (!wave) return "";
  const g = state.ground;
  let worstK = 0; let wettest = 0;
  summary.forEach((s, k) => {
    if (s.over > summary[worstK].over || (s.over === summary[worstK].over && s.peakQ > summary[worstK].peakQ)) worstK = k;
    if (s.maxRain > summary[wettest].maxRain) wettest = k;
  });
  const w = summary[worstK];
  const ever = [...wave.minFos].filter((v) => Number.isFinite(v) && v < 1).length;
  const lagH = (Date.parse(frames[worstK].time) - Date.parse(frames[wettest].time)) / 3600000;
  const share = Math.max(...summary.map((s) => s.runoffShare));
  const closed = g.flood.closed ?? g.flood.inArea;
  if (!closed) {
    // Every reach in view is fed from upstream of the mapped ground, so there
    // is no factor of safety to report — only the water the model itself saw.
    return `Channel: no reach in the area has its whole catchment inside the mapped ground, so none is given a factor of safety. `
      + `The model's own peak discharge is ${Math.round(Math.max(...summary.map((x) => x.peakQ))).toLocaleString()} m³/s — a lower bound, the rain on this ground alone. `
      + `Up to ${(100 * share).toFixed(0)}% of the rain ran off. `;
  }
  return `Channel: ${w.over.toLocaleString()} of ${closed.toLocaleString()} river cells with a whole catchment over their brim at their worst map (${frames[worstK].time.replace("T", " ")}), `
    + `peak discharge ${Math.round(w.peakQ).toLocaleString()} m³/s; ${ever.toLocaleString()} go over at some point. `
    + `${lagH > 0 ? `The channel's worst map is ${lagH.toFixed(0)} h after the wettest one — that is the catchment's own lag. ` : lagH < 0 ? "" : "The channel peaks on the wettest map: the catchment answers within one step. "}`
    + `Up to ${(100 * share).toFixed(0)}% of the rain ran off. `;
}

function clear({ keepInputs = false } = {}) {
  if (state.playing) { try { stopPlayer(); } catch (e) { /* gone */ } state.playing = false; }
  const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === LAYER_NAME);
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  state.run = null; state.step = -1; state.record = null;
  renderStations(); drawPlot();
  if (state.ground) { state.ground.stationSub = null; }
  if (!keepInputs) { removeRainLayer(); state.rain = null; state.ground = null; state.bounds = null; ["area", "rain", "ground", "hydro", "run"].forEach((id) => say(id, "")); }
  markStates();
}

/* ── step 7: sampling stations ─────────────────────────────────────────── */

/** The model cell a coordinate falls in, or why there is none. */
function stationCell(lat, lon) {
  const g = state.ground;
  if (!g) return { cell: -1, note: "recorded when the ground is read and the model runs" };
  const b = g.sub.bounds;
  if (!(lon >= b.minX && lon <= b.maxX && lat >= b.minY && lat <= b.maxY)) return { cell: -1, note: "outside the study area" };
  const x = Math.min(g.grid.width - 1, Math.floor(((lon - g.eb.west) / (g.eb.east - g.eb.west)) * g.grid.width));
  const y = Math.min(g.grid.height - 1, Math.floor(((g.eb.north - lat) / (g.eb.north - g.eb.south)) * g.grid.height));
  const i = y * g.grid.width + x;
  if (!g.cells.data[i] || !g.cells.model[i]) return { cell: -1, note: "no ground under it in the DEM" };
  // A station put on a river reads THE RIVER: a click lands anywhere across a
  // wide channel's burned width, and a bank cell's catchment is its own bank.
  const reach = g.flood?.reachAt?.[i] ?? -1;
  if (reach >= 0 && reach !== i && g.cells.model[reach]) return { cell: reach, note: "" };
  return { cell: i, note: "" };
}

/**
 * EVERY MAP AT EVERY STATION, by the station's own catchment. The weights are
 * kept on the ground object, so a new station costs one pass over the flow
 * topology and a re-run (new strength, new lateral factor) costs none — the
 * topology did not change, only what flows down it.
 */
let recording = 0;
async function recordStations() {
  const ticket = ++recording;
  const g = state.ground; const r = state.rain;
  if (!g || !r || !state.run || !state.stations.length) {
    state.record = null; renderStations(); drawPlot(); markStates();
    void drawStationLayer();
    return;
  }
  const frames = r.frames;
  const at = state.stations.map((st) => ({ st, ...stationCell(st.lat, st.lon) }));
  g.stationWeights = g.stationWeights || new Map();
  const need = at.filter((a) => a.cell >= 0 && !g.stationWeights.has(a.cell));
  if (need.length) say("stations", `Tracing ${need.length} station catchment${need.length > 1 ? "s" : ""} up the flow network…`);
  const scratch = need.length ? new Float64Array(g.n) : null;
  const pos = need.length && g.flood ? new Int32Array(g.n).fill(-1) : null;
  g.stationSub = g.stationSub || new Map();
  for (const a of need) {
    const weights = upslopeWeights(g.topo, a.cell, scratch);
    g.stationWeights.set(a.cell, weights);
    // The flood is a WAVE, so the station marches its own catchment rather
    // than reading a weighted sum: the sub-topology is what it marches.
    if (pos) {
      const local = catchmentTopology(g.topo, weights.idx, pos);
      let at = -1;
      for (let m = 0; m < weights.idx.length; m += 1) if (weights.idx[m] === a.cell) { at = m; break; }
      const kRes = new Float32Array(weights.idx.length);
      for (let m = 0; m < weights.idx.length; m += 1) kRes[m] = g.flood.k[weights.idx[m]];
      g.stationSub.set(a.cell, { idx: weights.idx, local, at, kRes });
    }
    await tick();
    if (ticket !== recording) return;
  }
  const values = {}; const constants = {};
  const P = g.cells.props;
  at.forEach(({ st, cell }) => {
    values[st.id] = Object.fromEntries(LANDSLIDE_PARAMS.map((p) => [p.key, new Array(frames.length).fill(NaN)]));
    if (cell < 0) return;
    const j = g.cells.block[cell]; const mat = g.table.list[P.mat[j]];
    const crit = g.crit?.[cell];
    constants[st.id] = {
      cell_m: g.grid.stepM,
      slope_deg: +(g.cells.slopeRad[cell] * 180 / Math.PI).toFixed(2),
      upslope_area_m2: Math.round(g.cells.area[cell]),
      soil_column_m: +P.zs[j].toFixed(2), failure_plane_m: +P.zf[j].toFixed(2),
      material: mat?.name || "", cohesion_kpa: mat?.cohesionKPa, friction_deg: mat?.friction, unit_weight_kn_m3: mat?.unitWeight,
      ks_m_s: mat?.K, lateral_factor: state.params.lateral,
      rainfall_to_fail_mm_day: crit === Infinity ? "holds saturated" : crit === 0 ? "fails dry" : Number.isFinite(crit) ? +crit.toFixed(1) : "",
      ...(() => {
        const f = g.flood;
        if (!f) return {};
        const w = f.riverWidth[cell];
        return {
          on_a_river: w > 0 ? "yes" : "no",
          // A station below an inflow across the mapped ground's edge records a
          // discharge that is a lower bound, so its factor of safety is the
          // map's own — withheld — and the column says which it is.
          catchment_closed: f.open?.[cell] ? "no — fed from upstream of the mapped ground" : "yes",
          modelled_catchment_km2: w > 0 && Number.isFinite(f.basin?.[cell]) ? +f.basin[cell].toFixed(1) : "",
          river_width_m: w > 0 ? Math.round(w) : "",
          bankfull_capacity_m3_s: w > 0 ? +f.capacity[cell].toFixed(1) : "",
          mean_flow_m3_s: w > 0 ? +(f.capacity[cell] / state.params.bankfull).toFixed(1) : "",
          cell_residence_time_min: +(f.k[cell] / 60).toFixed(1),
        };
      })(),
      ...(() => {
        const rk = g.rock; const rm = g.rocks?.list[P.rock[j]];
        if (!rk) return {};
        return {
          bare_rock: rk.exposed[cell] ? "yes" : "no",
          bedrock: rm?.name || "", bedrock_is_rock: rm?.rock ? "yes" : "no",
          rock_ucs_mpa: rm?.sci, rock_mi: rm?.mi, rock_gsi: rm?.rock ? Math.max(5, Math.min(100, rm.gsi + state.params.gsiAdj)) : "",
          slope_height_m: Number.isFinite(rk.H[cell]) ? Math.round(rk.H[cell]) : "",
          rock_c_kpa: Number.isFinite(rk.rc[cell]) ? +rk.rc[cell].toFixed(0) : "", rock_phi_deg: Number.isFinite(rk.rphi[cell]) ? +rk.rphi[cell].toFixed(1) : "",
          rock_fos_dry: Number.isFinite(rk.dry[cell]) ? +rk.dry[cell].toFixed(3) : "",
          rockfall: rk.source[cell] ? "source" : Number.isFinite(rk.energy[cell]) ? "within reach" : "out of reach",
          rockfall_velocity_m_s: Number.isFinite(rk.energy[cell]) ? +velocityOf(rk.energy[cell]).toFixed(1) : "",
        };
      })(),
    };
  });
  const live = at.filter((a) => a.cell >= 0);
  const fl = g.flood;
  const stores = new Map();
  let fscratch = null;
  if (fl && live.length) {
    let widest = 0;
    live.forEach(({ cell }) => {
      const sub = g.stationSub.get(cell);
      if (!sub) return;
      stores.set(cell, new Float64Array(sub.idx.length));
      if (sub.idx.length > widest) widest = sub.idx.length;
    });
    if (widest) fscratch = floodScratch(widest);
  }
  for (let k = 0; k < frames.length; k += 1) {
    if (live.length) {
      const rainMm = rainMapFor(frames[k]);
      for (const { st, cell } of live) {
        const out = stationStep({ cell, weights: g.stationWeights.get(cell), rainMm, windowH: frames[k].hours, cells: g.cells, topo: g.topo,
          infiltration: state.params.infiltration, lateral: state.params.lateral, rock: rockAt(cell) });
        const sub = fscratch ? g.stationSub.get(cell) : null;
        if (sub) {
          Object.assign(out, stationFlood({
            sub, cells: g.cells, topo: g.topo, rainMm, windowH: frames[k].hours,
            infiltration: state.params.infiltration, lateral: state.params.lateral,
            store: stores.get(cell), kRes: sub.kRes, dtS: frameStepSeconds(frames, k), scratch: fscratch,
            // No brim where the catchment is open: the station's discharge is a
            // lower bound, so a ratio against a whole basin's capacity would be
            // the same false comfort the map withholds.
            capacity: fl.open?.[cell] ? NaN : fl.capacity[cell], widthM: fl.riverWidth[cell], ratio: state.params.bankfull,
          }));
        }
        for (const p of LANDSLIDE_PARAMS) values[st.id][p.key][k] = out[p.key];
      }
    }
    if (k % 16 === 15) { await tick(); if (ticket !== recording) return; }
  }
  state.record = {
    model: "landslide-forecast", credit: r.credit,
    times: frames.map((f) => f.time), periods: frames.map((f) => periodOf(f.time)),
    sources: frames.map((f) => r.sourceLabel(f)), params: LANDSLIDE_PARAMS,
    stations: at.map(({ st, cell, note }) => ({ ...st, cell, note })),
    values, constants,
  };
  const failing = live.filter(({ st }) => values[st.id].fos.some((v) => v < 1)).length;
  const off = at.length - live.length;
  say("stations", `${live.length} station${live.length === 1 ? "" : "s"} read at every one of ${frames.length} maps; ${failing} fall below FoS 1 at some point.`
    + `${off ? ` ${off} not read — ${[...new Set(at.filter((a) => a.cell < 0).map((a) => a.note))].join("; ")}.` : ""}`
    + " Click the plot to go to that map.");
  // For whatever reads station series next — the analysis hub.
  document.dispatchEvent(new CustomEvent("geoid-gis:station-series", { detail: { model: "landslide-forecast", series: state.record } }));
  renderStations(); drawPlot(); markStates();
  void drawStationLayer();
}

/** One sentence a station's card says: its lowest reading and when, or why it has none. */
function stationSummary(st) {
  const rec = state.record; const rs = rec?.stations.find((x) => x.id === st.id);
  if (!rec) return state.run ? "Being read." : "Recorded when the landslide model runs.";
  if (!rs || rs.cell < 0) return `Not read — ${rs?.note || "no model here"}.`;
  const f = rec.values[st.id].fos; let k = -1;
  f.forEach((v, i) => { if (Number.isFinite(v) && (k < 0 || v < f[k])) k = i; });
  return k < 0 ? "No reading." : `Lowest factor of safety ${shortFos(f[k])} at ${String(rec.times[k]).replace("T", " ")} UTC, of ${rec.times.length} rainfall maps. Plotted under Landslides › Sampling stations.`;
}

/** A cell's rock, as the rock model reads it: null where there is none. */
function rockAt(i) {
  const g = state.ground; const rk = g?.rock;
  if (!rk || !Number.isFinite(rk.dry[i])) return null;
  const m = g.rocks.list[g.cells.props.rock[g.cells.block[i]]];
  return { c: rk.rc[i], phi: rk.rphi[i], gamma: m.gamma, K: m.K, H: rk.H[i], thetaRad: rk.theta[i] };
}

/** The stations as a layer on the globe, in the colours the plot uses. */
async function drawStationLayer() {
  const im = window.GeoIDImportManager;
  if (!im?.addDerivedLayer) return;
  (im.getLayers?.() || []).filter((l) => l.name === STATION_LAYER).forEach((l) => im.removeLayer?.(l.id));
  if (!state.stations.length) return;
  const { buildVectorLayerResult } = await import(`./vector-render.js${search}`);
  const fc = {
    type: "FeatureCollection",
    features: state.stations.map((st) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [st.lon, st.lat] },
      // No label_rank: the names are the markers' own, centred over each ▼,
      // not the label engine's chips on leaders.
      properties: { name: st.name, station: true, lat: st.lat, lon: st.lon, kind: "Sampling station", summary: stationSummary(st) },
    })),
  };
  // The layer is the stations' row in the Workspace — eye, key, export — and
  // draws nothing itself: the ▼ markers are drawn over the globe by
  // `station-markers.js`, which follows this layer's eye. It is BUILT from the
  // features without their geometry, so there is nothing for any repaint to
  // bring back (hiding the dots after the build lost to the first repaint,
  // which replaces every child), and given the real points afterwards for the
  // table and the export.
  const drawn = { type: "FeatureCollection", features: fc.features.map((f) => ({ type: "Feature", geometry: null, properties: f.properties })) };
  const built = buildVectorLayerResult(drawn, { name: STATION_LAYER, style: { field: "name", categories: state.stations.map((st) => ({ value: st.name, colour: st.colour })) } });
  const layer = im.addDerivedLayer(STATION_LAYER, built, "derived");
  if (layer) {
    layer.collection = fc; layer.features = fc.features;
    layer.groundPick = false;
    layer.info = { source: "Placed by you in the forecast landslide pipeline", summary: "Sampling stations: the points where every rainfall map's static model is recorded." };
  }
  ensureMarkers()?.refresh();
}

/* ── the ▼ markers, and the card a click on one opens ───────────────────── */

let markers = null;
function ensureMarkers() {
  if (markers || typeof document === "undefined") return markers;
  markers = mountStationMarkers({
    getStations: () => state.stations,
    isShown: () => {
      const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === STATION_LAYER);
      return Boolean(layer) && layer.visible !== false;
    },
    onPick: (st) => openStationCard(st),
  });
  return markers;
}

/** A station's card: what it reads on the map in view, every variable, and its lowest. */
function openStationCard(st) {
  const rec = state.record; const rs = rec?.stations.find((x) => x.id === st.id);
  const k = Math.max(0, state.step);
  const rows = [];
  let headline = st.name; let description = `${st.lat.toFixed(5)}°, ${st.lon.toFixed(5)}°`;
  if (rec && rs && rs.cell >= 0) {
    const v = rec.values[st.id];
    const f = v.fos; let low = -1;
    f.forEach((x, i) => { if (Number.isFinite(x) && (low < 0 || x < f[low])) low = i; });
    description = `FoS ${shortFos(f[k])} on ${String(rec.times[k]).replace("T", " ")} UTC (${rec.periods[k]}, ${rec.sources[k]}) · lowest ${low >= 0 ? `${shortFos(f[low])} on ${String(rec.times[low]).replace("T", " ")}` : "—"}`;
    for (const p of LANDSLIDE_PARAMS) rows.push([p.label, `${fmtParam(p.key, v[p.key][k])}${p.unit ? ` ${p.unit.replace("m2", "m²")}` : ""}`]);
    const c = rec.constants?.[st.id] || {};
    rows.push(["Ground", `${c.slope_deg}° slope, ${c.soil_column_m} m of ${c.material || "soil"}, failure plane at ${c.failure_plane_m} m; rainfall to fail ${c.rainfall_to_fail_mm_day}${Number.isFinite(c.rainfall_to_fail_mm_day) ? " mm/day" : ""}`]);
  } else {
    rows.push(["Readings", rs?.note || (state.run ? "being read" : "recorded when the landslide model runs")]);
  }
  window.GeoIDViewer?.showFeatureCard?.({
    source_layer: STATION_LAYER, soil: true, profile: false, type: "Sampling station", rock_type: headline, lithology: null, name: null,
    description, extra_rows: rows, origin: "GeoHUB forecast landslide pipeline — plotted under Sampling stations",
    rows: [["Note", "The same static answer the map draws at this cell, with every term of it kept."]],
  }, st.lat, st.lon);
}

function addStations(list, source) {
  const room = MAX_STATIONS - state.stations.length;
  if (room <= 0) { say("stations", `${MAX_STATIONS} stations is the most a plot can keep legible.`, "error"); return 0; }
  const taken = state.stations.map((st) => st.name);
  const added = list.slice(0, room).map((s, k) => {
    const st = makeStation({ ...s, source }, state.stations.length + k);
    st.name = uniqueName(st.name, taken); taken.push(st.name);
    return st;
  });
  state.stations.push(...added);
  onStationsChanged();
  return added.length;
}

function onStationsChanged() {
  state.stations.forEach((st, k) => { st.colour = colourAt(k); });
  renderStations();
  // With a run the recording redraws the layer when it lands, with readings.
  if (state.run) void recordStations(); else { state.record = null; void drawStationLayer(); drawPlot(); markStates(); }
}

function pointLayers() {
  return (window.GeoIDImportManager?.getLayers?.() || []).filter((l) => l.status === "loaded" && l.name !== STATION_LAYER
    && (l.features || l.collection?.features || []).some((f) => /Point$/.test(f?.geometry?.type || "")));
}

const shortFos = (v) => (!Number.isFinite(v) ? "—" : v >= FOS_CAP ? `${FOS_CAP}+` : v.toFixed(2));

/** What the list says a station reads on the map in view, and how. */
function readingOf(st) {
  const rec = state.record;
  const rs = rec?.stations.find((x) => x.id === st.id);
  if (!rec) return { text: state.run ? "reading…" : "awaiting a run", kind: "none" };
  if (!rs || rs.cell < 0) return { text: rs?.note || "not read", kind: "none" };
  const fos = rec.values[st.id].fos;
  const now = state.step >= 0 ? fos[state.step] : NaN;
  const low = fos.reduce((a, v) => (Number.isFinite(v) && v < a ? v : a), Infinity);
  return { text: `FoS ${shortFos(now)} · min ${shortFos(low)}`, kind: now < 1 ? "fail" : "" };
}

/** The list: a swatch, an editable name, the reading on the map in view, a remove. */
function renderStations() {
  const host = byId("lsp-st-list");
  if (!host) return;
  host.innerHTML = state.stations.map((st) => {
    const { text, kind } = readingOf(st);
    return `<div class="lsp-st" data-id="${esc(st.id)}" title="${esc(st.name)} — ${st.lat.toFixed(5)}°, ${st.lon.toFixed(5)}° (${esc(st.source)})">
      <span class="lsp-st-sw" style="background:${esc(st.colour)}"></span>
      <input class="input lsp-st-name" value="${esc(st.name)}" aria-label="Station name" maxlength="40">
      <span class="lsp-st-val" data-kind="${kind}">${esc(text)}</span>
      <button type="button" class="lsp-st-x" title="Remove ${esc(st.name)}" aria-label="Remove ${esc(st.name)}">✕</button></div>`;
  }).join("");
  refreshLayerChoices();
  markers?.refresh();
}

/** Only the readings, as the bar steps: the name fields are left alone so a rename survives playing. */
function updateReadings() {
  document.querySelectorAll("#lsp-st-list .lsp-st").forEach((row) => {
    const st = state.stations.find((x) => x.id === row.dataset.id);
    const val = row.querySelector(".lsp-st-val");
    if (!st || !val) return;
    const { text, kind } = readingOf(st);
    val.textContent = text; val.dataset.kind = kind;
  });
}

function refreshLayerChoices() {
  const group = byId("lsp-st-layers");
  if (!group) return;
  const layers = pointLayers();
  const html = layers.length ? layers.map((l) => `<option value="layer:${esc(l.id)}">${esc(l.name)}</option>`).join("")
    : '<option value="" disabled>No point layer on the globe</option>';
  if (group.innerHTML !== html) group.innerHTML = html;
}

/* ── the plots: interchangeable panels, docked or popped out ───────────── */

let plotSeq = 0;
const newPlot = (plot) => ({ id: `pl-${(plotSeq += 1)}`, plot, floating: false, pos: null });
state.plots = [newPlot("fos"), newPlot("rain")];
export const MAX_PLOTS = 6;

const unitText = (u) => (u ? ` (${u.replace("m2", "m²")})` : "");
function plotOptions(selected) {
  const groups = [...new Set(LANDSLIDE_PLOTS.map((p) => p.group))];
  return groups.map((g) => `<optgroup label="${esc(g)}">${LANDSLIDE_PLOTS.filter((p) => p.group === g)
    .map((p) => `<option value="${p.key}"${p.key === selected ? " selected" : ""}>${esc(p.label)}${esc(unitText(p.unit))}</option>`).join("")}</optgroup>`).join("");
}

/** A value as a plot or a card writes it: the unit's own precision. */
function fmtParam(key, v) {
  if (!Number.isFinite(v)) return "—";
  if (key === "fos" || key === "rockFos") return shortFos(v);
  if (["rain", "catchRain", "recharge", "qb", "pore", "effective", "strength", "stress"].includes(key)) return v.toFixed(1);
  return v.toFixed(2);
}

function panelNode(pl) {
  return document.querySelector(`.lsp-plotbox[data-plot="${pl.id}"]`);
}

/** Build the docked panels (a floating one stays where it was put). */
function renderPlots() {
  const host = byId("lsp-plots");
  if (!host) return;
  host.querySelectorAll(".lsp-plotbox").forEach((n) => { if (!state.plots.some((pl) => pl.id === n.dataset.plot)) n.remove(); });
  document.querySelectorAll("body > .lsp-plotbox.is-float").forEach((n) => { if (!state.plots.some((pl) => pl.id === n.dataset.plot && pl.floating)) n.remove(); });
  for (const pl of state.plots) {
    let node = panelNode(pl);
    if (!node) {
      node = document.createElement("div");
      node.className = "lsp-plotbox"; node.dataset.plot = pl.id;
      node.innerHTML = `<div class="lsp-plothead"><span class="lsp-grip" title="Drag to move" aria-hidden="true">⠿</span><select class="input" data-always="1" aria-label="What this plot shows">${plotOptions(pl.plot)}</select>
        <button type="button" class="lsp-pbtn" data-act="float" data-always="1" title="Pop out over the map">⧉</button>
        <button type="button" class="lsp-pbtn" data-act="close" data-always="1" title="Remove this plot" aria-label="Remove this plot">✕</button></div>
        <canvas class="lsp-plot" aria-label="Time series at the sampling stations"></canvas><p class="lsp-plotread"></p>`;
      wirePanel(node, pl);
    }
    const want = pl.floating ? document.body : host;
    if (node.parentElement !== want) want.appendChild(node);
    node.classList.toggle("is-float", pl.floating);
    node.querySelector('[data-act="float"]').textContent = pl.floating ? "⇲" : "⧉";
    node.querySelector('[data-act="float"]').title = pl.floating ? "Dock back in the card" : "Pop out over the map";
    if (pl.floating) placeFloat(node, pl);
  }
  // Docked panels in the order of the list.
  state.plots.filter((pl) => !pl.floating).forEach((pl) => host.appendChild(panelNode(pl)));
  const add = byId("lsp-plot-add"); if (add) add.disabled = state.plots.length >= MAX_PLOTS;
  drawPlot();
}

/** Where a popped-out panel goes: right of the sidebar, above the bar, staggered. */
function placeFloat(node, pl) {
  if (!pl.pos) {
    const k = state.plots.filter((x) => x.floating).indexOf(pl);
    const side = document.getElementById("ui")?.getBoundingClientRect?.();
    const bar = document.getElementById("geoid-timelapse");
    const floor = bar && !bar.hidden
      ? Math.min(...[bar, ...bar.querySelectorAll("*")].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top))
      : window.innerHeight - 16;
    const h = node.offsetHeight || 300;
    pl.pos = { left: (side ? side.right : 16) + 24 + 28 * k, top: Math.max(72, floor - h - 12 - 28 * k) };
  }
  const w = node.offsetWidth || 400; const h = node.offsetHeight || 300;
  pl.pos.left = Math.max(8, Math.min(window.innerWidth - w - 8, pl.pos.left));
  pl.pos.top = Math.max(8, Math.min(window.innerHeight - h - 8, pl.pos.top));
  node.style.left = `${pl.pos.left}px`; node.style.top = `${pl.pos.top}px`;
}

function wirePanel(node, pl) {
  const select = node.querySelector("select");
  select.addEventListener("change", () => { pl.plot = select.value; drawPlot(); });
  select.addEventListener("keydown", (e) => e.stopPropagation());
  node.querySelector('[data-act="close"]').addEventListener("click", () => {
    state.plots = state.plots.filter((x) => x !== pl);
    node.remove(); renderPlots();
  });
  node.querySelector('[data-act="float"]').addEventListener("click", () => {
    pl.floating = !pl.floating; if (!pl.floating) { node.style.left = ""; node.style.top = ""; }
    renderPlots();
  });
  const canvas = node.querySelector("canvas");
  canvas.addEventListener("mousemove", (e) => {
    const k = node._layout?.indexAt?.(e.offsetX) ?? -1;
    if (k !== state.plotHover) { state.plotHover = k; drawPlot(); }
  });
  canvas.addEventListener("mouseleave", () => { state.plotHover = -1; drawPlot(); });
  canvas.addEventListener("click", (e) => {
    const k = node._layout?.indexAt?.(e.offsetX) ?? -1;
    if (k < 0 || !state.run) return;
    if (!seekPlayer(k)) showStep(k);
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => drawOne(node, pl)).observe(canvas);
  // A popped-out panel is dragged by its grip, its frame or its readout —
  // anything but the controls and the plot, which a click on reads a map.
  node.addEventListener("pointerdown", (e) => {
    if (!pl.floating || e.target.closest("select, button, canvas")) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, left: pl.pos.left, top: pl.pos.top };
    node.classList.add("is-dragging");
    const move = (ev) => { pl.pos.left = start.left + ev.clientX - start.x; pl.pos.top = start.top + ev.clientY - start.y; placeFloat(node, pl); };
    const up = () => { node.classList.remove("is-dragging"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  });
}

/** One panel: its plot's lines, one per station (two for a pair), the frame marked. */
function drawOne(node, pl) {
  const canvas = node.querySelector("canvas");
  if (!canvas?.isConnected) return;
  const rec = state.record;
  const def = LANDSLIDE_PLOTS.find((x) => x.key === pl.plot) || LANDSLIDE_PLOTS[0];
  const live = rec ? rec.stations.filter((st) => st.cell >= 0) : [];
  const lines = live.flatMap((st) => def.series.map((sr) => ({ label: st.name, colour: st.colour, dash: sr.dash, values: rec.values[st.id][sr.key] })));
  const fosLike = def.key === "fos" || def.key === "rockFos";
  const wetLike = def.key === "W" || def.key === "m";
  const range = !lines.length ? null
    : fosLike ? yRangeOf(lines, { floor: 0, clip: 3, max: 1.2 })
      : wetLike ? [0, 1.05] : yRangeOf(lines, { floor: 0 });
  node._layout = drawTimeSeries(canvas, {
    times: rec?.times || [], lines, range,
    yLabel: `${def.series.length > 1 ? "Stress" : def.label.replace(/ \(.*\)$/, "").replace(/ —.*$/, "")}${unitText(def.unit)}`,
    refs: fosLike ? [{ value: 1, label: "FoS 1", colour: "#ff7b7b" }] : wetLike ? [{ value: 1, label: "saturated", colour: "#8ab6ff" }] : [],
    marker: state.step, hover: state.plotHover, now: Date.now(),
    empty: !state.stations.length ? "Add a station to record it here." : !state.run ? "Run the model to fill the stations in." : "Reading the stations…",
  });
  const read = node.querySelector(".lsp-plotread");
  const k = state.plotHover >= 0 ? state.plotHover : state.step;
  read.textContent = rec && k >= 0 && live.length
    ? `${String(rec.times[k]).replace("T", " ")} ${rec.periods?.[k] || ""} (${rec.sources?.[k] || ""}) — ${live.map((st) => `${st.name} ${def.series.map((sr) => fmtParam(sr.key, rec.values[st.id][sr.key][k])).join(" / ")}`).join(" · ")}${fosLike ? " · above 3 on the top edge" : ""}`
    : "";
}

function drawPlot() {
  for (const pl of state.plots || []) { const node = panelNode(pl); if (node) drawOne(node, pl); }
}

let pickHandle = null;
let swallowUntil = 0;
/**
 * Each click on the globe adds a station until the button is pressed again or
 * Escape. A pointerup with a drag gate, never a stopPropagation — the orbit
 * controls need to see the press end — and the cards told to stand down so a
 * placing click does not also open one.
 */
function armStationPick(button) {
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (!canvas) { say("stations", "The globe is not ready.", "error"); return; }
  if (pickHandle) { pickHandle(); return; }
  const was = button.textContent;
  button.textContent = "Stop adding"; button.classList.add("is-on");
  let down = null;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const at = window.GeoIDViewer?.surfaceLatLonAt?.(e.clientX, e.clientY);
    if (!at) return;
    swallowUntil = Date.now() + 800;
    window.GeoIDFeaturePopup?.suppress?.(800);
    addStations([{ name: `S${state.stations.length + 1}`, lat: at.lat, lon: at.lon }], "clicked on the map");
    say("stations", `${state.stations.length} station${state.stations.length === 1 ? "" : "s"} — click to add another; Escape or Stop adding when done.`);
  };
  const onKey = (e) => { if (e.key === "Escape") finish(); };
  const finish = () => {
    pickHandle = null;
    button.textContent = was; button.classList.remove("is-on");
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    document.removeEventListener("keydown", onKey, true);
  };
  pickHandle = finish;
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  document.addEventListener("keydown", onKey, true);
  say("stations", "Click points on the globe to place stations; Escape or Stop adding when done.");
}

function addFrom(choice, button) {
  if (choice === "pick") { armStationPick(button); return; }
  if (pickHandle) pickHandle();
  if (choice === "centre") {
    const b = state.bounds;
    if (!b) { say("stations", "Choose the study area first.", "error"); return; }
    addStations([{ name: "Centre", lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 }], "the study area's centre");
    return;
  }
  if (choice === "lowest") {
    const g = state.ground; const run = state.run;
    if (!run || !g) { say("stations", "Run the model first — these are the cells it finds weakest.", "error"); return; }
    const spacing = Math.max(3, Math.round(300 / g.grid.stepM));
    const taken = state.stations.map((st) => stationCell(st.lat, st.lon).cell).filter((c) => c >= 0);
    const cells = lowestCells({ minFos: run.minFos, model: g.cells.model, width: g.grid.width, count: 5, spacing, taken });
    const already = state.stations.filter((st) => /^Weakest \d+$/.test(st.name)).length;
    const list = cells.map((i, k) => {
      const x = i % g.grid.width; const y = (i - x) / g.grid.width;
      return { name: `Weakest ${already + k + 1}`, lat: g.eb.north - ((y + 0.5) / g.grid.height) * (g.eb.north - g.eb.south), lon: g.eb.west + ((x + 0.5) / g.grid.width) * (g.eb.east - g.eb.west) };
    });
    if (!list.length) { say("stations", "No modelled cell to choose.", "error"); return; }
    addStations(list, "lowest factor of safety over the window");
    return;
  }
  if (choice === "csv") { byId("lsp-st-file")?.click(); return; }
  if (choice.startsWith("layer:")) {
    const layer = pointLayers().find((l) => String(l.id) === choice.slice(6));
    if (!layer) { say("stations", "That layer has gone.", "error"); return; }
    const list = stationsFromFeatures(layer.features || layer.collection?.features || [], { prefix: "P" });
    const n = addStations(list, `points of ${layer.name}`);
    say("stations", `${n} station${n === 1 ? "" : "s"} from ${layer.name}${list.length > n ? ` (the first ${n} of ${list.length})` : ""}.`);
  }
}

function wireStations() {
  const add = byId("lsp-st-add"); const go = byId("lsp-st-go");
  if (!add || !go) return;
  go.addEventListener("click", () => addFrom(add.value, go));
  add.addEventListener("change", () => { if (pickHandle && add.value !== "pick") pickHandle(); });
  byId("lsp-st-clear").addEventListener("click", () => {
    if (pickHandle) pickHandle();
    state.stations = []; state.record = null;
    onStationsChanged(); say("stations", "");
  });
  byId("lsp-st-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const got = parseStationsCsv(await file.text());
    if (!got.ok) { say("stations", got.message, "error"); return; }
    const n = addStations(got.stations, file.name);
    say("stations", `${n} station${n === 1 ? "" : "s"} from ${file.name}${got.dropped ? `; ${got.dropped} row${got.dropped === 1 ? "" : "s"} had no usable coordinate` : ""}.`);
  });
  const list = byId("lsp-st-list");
  list.addEventListener("click", (e) => {
    const x = e.target.closest(".lsp-st-x");
    if (!x) return;
    const id = x.closest(".lsp-st")?.dataset.id;
    state.stations = state.stations.filter((st) => st.id !== id);
    onStationsChanged();
  });
  list.addEventListener("keydown", (e) => { if (e.target.matches(".lsp-st-name")) { e.stopPropagation(); if (e.key === "Enter") e.target.blur(); } });
  list.addEventListener("change", (e) => {
    if (!e.target.matches(".lsp-st-name")) return;
    const st = state.stations.find((x) => x.id === e.target.closest(".lsp-st")?.dataset.id);
    if (!st) return;
    const name = e.target.value.trim().slice(0, 40);
    if (!name) { e.target.value = st.name; return; }
    st.name = uniqueName(name, state.stations.filter((x) => x !== st).map((x) => x.name));
    const rs = state.record?.stations.find((x) => x.id === st.id);
    if (rs) rs.name = st.name;
    renderStations(); drawPlot(); void drawStationLayer();
  });
  byId("lsp-plot-add").addEventListener("click", () => {
    if (state.plots.length >= MAX_PLOTS) return;
    // The next thing worth looking at that no panel shows yet.
    const shown = new Set(state.plots.map((pl) => pl.plot));
    const next = ["rockFos", "W", "m", "strength-vs-stress", "ru", "catchRain", "depth", "pore", "recharge"].find((k) => !shown.has(k)) || "fos";
    state.plots.push(newPlot(next)); renderPlots();
  });
  window.addEventListener("resize", () => { for (const pl of state.plots) if (pl.floating) { const n = panelNode(pl); if (n) placeFloat(n, pl); } });
  byId("lsp-st-csv").addEventListener("click", async () => {
    const rec = state.record;
    if (!rec) { say("stations", state.stations.length ? "Run the model first — the stations are filled in by the run." : "Add a station first.", "error"); return; }
    const { downloadText } = await import(`./extraction.js${search}`);
    const name = seriesFileName(rec, "landslide-stations");
    downloadText(name, seriesCsv(rec), "text/csv");
    say("stations", `${name}: ${rec.stations.length} stations × ${rec.times.length} maps, one row each, ${rec.params.length} parameters and the stations' ground.`);
  });
}

/* ── the card: one cell, at the map on screen ───────────────────────────── */

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export function probeAt(lat, lon) {
  // A click that has just placed a station is not a question about the cell.
  if (Date.now() < swallowUntil) return true;
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
  const j = g.cells.block[i]; const P = g.cells.props;
  const mat = g.table.list[P.mat[j]];
  const slopeDeg = g.cells.slopeRad[i] * 180 / Math.PI;
  const fos = cur.fos[i];
  const crit = g.crit?.[i];
  const rk = g.rock; const rockM = g.rocks?.list[P.rock[j]];
  const rockFos = cur.rockFos?.[i];
  const bare = Boolean(rk?.exposed[i]);
  const mode = MODE_CLASSES[modeOf({ source: rk?.source[i], reached: Number.isFinite(rk?.energy[i]), exposed: bare, soil: fos, rock: rockFos })];
  const governing = governingFos(i, fos, rockFos);
  const headline = `${governing >= FOS_CAP ? `${FOS_CAP}+` : fmt(governing)} — ${mode.label}`;
  // The governing answer is the card's title; each model then says its own.
  const joint = rk && Number.isFinite(rk.dry[i])
    ? rockCell({ q: cur.q[i], contour: g.topo.contour, betaRad: g.cells.slopeRad[i], c: rk.rc[i], phi: rk.rphi[i], gamma: rockM.gamma, K: rockM.K, H: rk.H[i], thetaRad: rk.theta[i] })
    : null;
  const rows = [
    ["Soil model", bare ? "no soil to slide — bare rock (thin soil on steep ground); the rock model governs" : `FoS ${fos >= FOS_CAP ? `${FOS_CAP}+` : fmt(fos)} — ${FOS_CLASSES[fosClass(fos)]?.label || "—"}`],
    ["Rock-slope model", !joint ? `not rock — ${rockM?.from || "no bedrock here"}; the soil model governs`
      : `FoS ${rockFos >= FOS_CAP ? `${FOS_CAP}+` : fmt(rockFos)} on a plane at ${fmt(rk.theta[i] * 180 / Math.PI, 0)}° through a ${Math.round(rk.H[i])} m slope; joint water r_u ${fmt(joint.ru)}; dry ${rk.dry[i] >= FOS_CAP ? `${FOS_CAP}+` : fmt(rk.dry[i])}; critical height at this angle ${(() => { const hc = criticalHeight({ betaRad: g.cells.slopeRad[i], c: rk.rc[i], phi: rk.rphi[i], gamma: rockM.gamma }); return Number.isFinite(hc) ? `${Math.round(hc)} m` : "unlimited"; })()}`],
    ...(joint ? [["Rock mass", `${rockM.name} — σci ${fmt(rockM.sci, 0)} MPa, mi ${fmt(rockM.mi, 0)}, GSI ${Math.max(5, Math.min(100, rockM.gsi + state.params.gsiAdj))}, γ ${fmt(rockM.gamma, 1)} kN/m³ → c′ ${fmt(rk.rc[i], 0)} kPa, φ′ ${fmt(rk.rphi[i], 1)}° for this slope height (Hoek–Brown 2002); ${rockM.from}`]] : []),
    ["Rockfall", rk?.source[i] ? `a source — bare rock at ${fmt(g.cells.slopeRad[i] * 180 / Math.PI, 0)}°, steeper than ${state.params.sourceDeg}°`
      : Number.isFinite(rk?.energy[i]) ? `within reach — the energy line is ${fmt(rk.energy[i], 0)} m above the ground here: blocks at about ${fmt(velocityOf(rk.energy[i]), 0)} m/s (reach angle ${state.params.reachDeg}°)`
        : "out of reach of any source"],
    ...(() => {
      const f = g.flood; const wdt = f?.riverWidth[i];
      if (!f || !(wdt > 0)) return [];
      const q = cur.flood?.q[i];
      const basinKm2 = f.basin[i];
      const mean = f.capacity[i] / state.params.bankfull;
      const answer = f.open[i]
        ? "no factor of safety here — the reach is fed from upstream of the mapped ground, so this discharge is a LOWER BOUND"
        : `FoS ${shortFos(cur.flood?.fos[i])} against a ${Math.round(f.capacity[i]).toLocaleString()} m³/s brim (${state.params.bankfull}× a ${Math.round(mean).toLocaleString()} m³/s mean flow from the width)`;
      return [["Channel", `${Math.round(wdt)} m wide (GRWL); ${Number.isFinite(q) ? `${fmt(q, 1)} m³/s` : "—"} arriving from the ${Number.isFinite(basinKm2) ? `${basinKm2.toFixed(1)} km²` : "—"} the model routes to this reach. ${answer}`]];
    })(),
    ["Rainfall map", `${fmt(cur.rainMm[j], 1)} mm of ${state.rain.sourceLabel(frame)} rain in the ${frame.hours} h to ${frame.time.replace("T", " ")} UTC (${periodOf(frame.time)})`],
    ["Saturation", `h / z_s ${fmt(cur.W[i])}; water on the failure plane m ${fmt(planeWetness(cur.W[i], P.zs[j], P.zf[j]))}`],
    ["Upslope area", `${(g.cells.area[i] / 1e4).toFixed(2)} ha draining through this cell (a = ${(g.cells.area[i] / g.topo.contour).toFixed(0)} m)`],
    ["Lowest over the window", !Number.isFinite(run.minFos[i]) ? "—"
      : run.minFos[i] >= FOS_CAP ? `${FOS_CAP}+ throughout — too gentle to slide` : `${fmt(run.minFos[i])} at ${run.frames[run.minAt[i]].time.replace("T", " ")}`],
    ["Rainfall to fail", !Number.isFinite(crit) && crit !== Infinity ? "—" : crit === Infinity ? "holds even saturated" : crit === 0 ? "fails even dry" : `${crit.toFixed(0)} mm/day sustained over its catchment`],
    ["Slope", `${slopeDeg.toFixed(1)}° — from ${g.slopeFrom}; this cell is ${g.grid.stepM} m`],
    ["Soil column", `${fmt(P.zs[j], 1)} m to bedrock (${P.thin[j] ? `Pelletier et al. 2016 reads 0 in whole metres — under 1 m, modelled as a ${fmt(P.zs[j], 1)} m veneer` : P.depthFrom[j] ? "Pelletier et al. 2016" : "a stated default"}); failure plane at ${fmt(P.zf[j], 1)} m`],
    ["Material", `${mat.name} — ${mat.from}`],
    ["Strength", `c′ ${fmt(mat.cohesionKPa, 1)} kPa${mat.rootCohesionKPa ? ` (with ${mat.rootCohesionKPa} kPa of roots)` : ""}, φ′ ${fmt(mat.friction, 0)}° (${mat.strength}), γ ${fmt(mat.unitWeight, 1)} kN/m³`],
    ["Conductivity", `Ks ${mat.K.toExponential(1)} m/s — ${mat.kFrom}; lateral ${state.params.lateral} × Ks, T ${(mat.K * state.params.lateral * P.zs[j] * 86400).toFixed(1)} m²/day`],
  ];
  // A station on this cell says so, with what it recorded.
  const here = state.record?.stations.find((st) => st.cell === i);
  if (here) {
    const f = state.record.values[here.id].fos;
    const low = f.reduce((a, v) => (Number.isFinite(v) && v < a ? v : a), Infinity);
    rows.unshift(["Station", `${here.name} — lowest FoS ${shortFos(low)} over the window; plotted in step 7`]);
  }
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
  window.GeoIDLandslidePipeline = {
    init, render, probeAt, state, readiness, demGridFor, staticStep, LAYER_NAME, run, showStep,
    // The stations' seam, for whatever samples models at points next.
    stations: () => state.stations, series: () => state.record, addStations: (list, source = "added") => addStations(list, source), recordStations,
  };
}
