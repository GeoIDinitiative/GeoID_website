/**
 * FORECAST LANDSLIDE RISK — a query pipeline, drawn as a flowchart.
 *
 * The NI prototype is a finished, static map. This is the same physics made
 * DYNAMIC and general: draw a study area, pull the rainfall that fell or is
 * forecast over it for a chosen window, read the ground under it (slope from
 * the streamed DEM, the material from whatever geological or soil map is on
 * the globe, the depth from the thickness model), size a hydrogeological
 * bucket for every cell from that material's porosity and hydraulic
 * conductivity, run the infinite-slope Factor of Safety through every time
 * step, and play the result through the bar.
 *
 * SIX STEPS, EACH SAYING WHAT IT HAS AND WHAT IT STILL NEEDS. A pipeline
 * somebody cannot see is a button that either works or does not; one drawn as
 * a chart says which input is missing and what it will cost to get. Every
 * step wraps a seam that already exists here (the extent picker, the
 * Open-Meteo readers, the DEM stream, the thickness sheet, the rock
 * properties, `fos.js`); nothing below is a second implementation of any of
 * them.
 *
 * THE HYDROGEOLOGY IS THE GROUND'S OWN. The FoS mode's bucket was a fixed
 * 120 mm capacity draining 12% a day for every cell; here the bucket is the
 * pore space of the failure column, n·z, and it drains by lateral throughflow
 * at the material's hydraulic conductivity down the slope, K·sin β — so a
 * fractured limestone dries in hours and a clay till stays wet for a week,
 * which is the difference that decides where a storm matters.
 */

import { refreshPolygonOptions, resolvePolygonExtent, promptDrawTool } from "./extent-picker.js?v=20260911-d583855";
import { weatherPoints, weatherUrl, parseWeatherGrid, rainAt, fosColour } from "./geoid-pipeline.js?v=20260911-d583855";
import { materialFor, failureDepth, wetnessSeries, factorOfSafety, stabilityBand } from "./fos.js?v=20260911-d583855";
import { makeRaster, slope as slopeOf } from "./raster-analysis.js?v=20260911-d583855";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260911-d583855";
import { loadRockProperties, parameterValue } from "./rock-properties.js?v=20260911-d583855";
import { isGroundLayer } from "./ground-profile.js?v=20260911-d583855";
import { startPlayer, stopPlayer } from "./timelapse-player.js?v=20260911-d583855";

const search = new URL(import.meta.url).search;
export const LAYER_NAME = "Landslide risk — forecast (factor of safety)";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

/* ── pure: the pieces the tests run ─────────────────────────────────────── */

/** ERA5 reanalysis through Open-Meteo's archive: the same shape the forecast answers in. */
export function archiveUrl(points, { start, end } = {}) {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    start_date: start, end_date: end, hourly: "precipitation", timezone: "UTC",
  });
  return `${ARCHIVE}?${q.toString()}`;
}

/** Defaults where the material has no published value; stated on the card. */
export const HYDRO_DEFAULTS = { porosity: 0.3, conductivity: 1e-6 };

/**
 * THE BUCKET, FROM THE GROUND. Capacity is the pore space of the failure
 * column (n·z, in mm of water); drainage is lateral throughflow down the slope
 * at the material's conductivity, K·sin β, as a fraction of that column per
 * day — clamped, because a gravel would otherwise empty a hundred times a day
 * and a clay never, and neither is what a bucket model can carry.
 */
export function bucketFor({ porosity, conductivity, depthM, slopeDeg }) {
  // A FRACTION here. The rock-property database publishes porosity in PERCENT
  // (a granite is 1, a sand 35), and read as a fraction a granite's column held
  // its whole depth in water; the caller converts, and the floor keeps a
  // near-zero porosity from making the bucket a thimble that drains a
  // thousand times a day.
  const n = Number.isFinite(porosity) && porosity > 0 ? Math.max(0.02, Math.min(0.6, porosity)) : HYDRO_DEFAULTS.porosity;
  const K = Number.isFinite(conductivity) && conductivity > 0 ? conductivity : HYDRO_DEFAULTS.conductivity;
  const z = Number.isFinite(depthM) && depthM > 0 ? depthM : 1.0;
  const beta = (Number(slopeDeg) || 0) * Math.PI / 180;
  const capacityMm = Math.max(20, n * z * 1000);
  const throughflow = K * 86400 * Math.max(Math.sin(beta), 0.05);   // m of water a day
  const drainPerDay = Math.max(0.02, Math.min(0.95, throughflow / (n * z)));
  return { capacityMm: Number(capacityMm.toFixed(1)), drainPerDay: Number(drainPerDay.toFixed(4)), n, K, z };
}

/** The DEM as a raster over the bounds, sampled from a height reader. */
export function demGridFor(bounds, heightAt, { maxCells = 40000, radiusKm = 6371.0088 } = {}) {
  const { west, south, east, north } = bounds;
  const midLat = (south + north) / 2;
  const widthM = (east - west) * 111320 * Math.cos(midLat * Math.PI / 180);
  const heightM = (north - south) * 110574;
  const step = Math.max(30, Math.sqrt((widthM * heightM) / maxCells));
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

/** A point-in-polygon sampler over a layer's GeoJSON features (bbox first). */
export function samplerOver(features, pick = (p) => p) {
  const list = (features || []).map((f) => {
    const polys = polygonsOf(f.geometry);
    if (!polys.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    polys.forEach((rings) => rings[0].forEach(([x, y]) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }));
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
  return props.lith || props.rcs_d || props.lex_rcs_d || props.lex_d || props.RCS_D || props.name
    || props.unit_label || props.class || props.soil || null;
}

/**
 * THE RUN: every cell through every step. Pure given the readers, which is
 * what lets the test plant a storm and watch a slope fail.
 */
export function runSteps({ cells, dates, stepHours = 1, rainFor, bucketOf }) {
  const wet = cells.map((cell, j) => {
    const rain = dates.map((_, s) => rainFor(cell, s));
    const b = bucketOf(cell);
    return wetnessSeries(rain, { capacityMm: b.capacityMm, drainPerDay: b.drainPerDay, stepHours, initial: 0.2 });
  });
  const steps = dates.map((date, s) => {
    const values = new Float32Array(cells.length).fill(NaN);
    let failing = 0; let applicable = 0; let wetSum = 0;
    cells.forEach((cell, j) => {
      const m = wet[j][s];
      wetSum += m;
      const v = factorOfSafety({
        slopeDeg: cell.slopeDeg, cohesion: cell.material.cohesion, friction: cell.material.friction,
        unitWeight: cell.material.unitWeight, depth: cell.material.depth, wetFraction: m,
      });
      if (!Number.isFinite(v)) return;
      values[j] = v; applicable += 1; if (v < 1) failing += 1;
    });
    return { date, values, applicable, failing, wetFraction: cells.length ? wetSum / cells.length : 0, failingFraction: applicable ? failing / applicable : 0 };
  });
  return { steps, wet };
}

/* ── the state and the flowchart ────────────────────────────────────────── */

const state = {
  bounds: null, area: null, rain: null, ground: null, hydro: { model: "ground", porosity: 0.3, conductivity: 1e-6 },
  run: null, step: -1, playing: false,
};

const STEPS = [
  { id: "area", n: 1, title: "Study area", blurb: "Where the model runs." },
  { id: "rain", n: 2, title: "Rainfall", blurb: "What fell, or will, by extent and date." },
  { id: "ground", n: 3, title: "Ground", blurb: "Slope, material and depth." },
  { id: "hydro", n: 4, title: "Hydrogeology", blurb: "How the column fills and drains." },
  { id: "fos", n: 5, title: "Factor of safety", blurb: "Infinite slope, every cell, every step." },
  { id: "run", n: 6, title: "Run and play", blurb: "The risk layer, through time." },
];

export function readiness(s = state) {
  return {
    area: s.bounds ? "done" : "ready",
    rain: s.rain ? "done" : s.bounds ? "ready" : "blocked",
    ground: s.ground ? "done" : s.bounds ? "ready" : "blocked",
    hydro: "ready",
    fos: "ready",
    run: s.run ? "done" : (s.rain && s.ground) ? "ready" : "blocked",
  };
}

const byId = (id) => document.getElementById(id);
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
    card.querySelectorAll("button, select, input").forEach((el) => { el.disabled = r[s.id] === "blocked"; });
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
.lsp-card[data-state="done"] .lsp-pill { border-color: #52e4e8; color: #52e4e8; }
.lsp-card[data-state="blocked"] { opacity: 0.55; }
.lsp-card[data-state="blocked"] .lsp-pill { color: #f5a742; border-color: #f5a742; }
.lsp-blurb { font-size: 0.72rem; opacity: 0.75; margin: 0 0 0.35rem; }
.lsp-status { font-size: 0.72rem; margin: 0.35rem 0 0; min-height: 1em; white-space: pre-line; }
.lsp-status[data-kind="error"] { color: #ff7b7b; }
.lsp-eq { font: 0.72rem/1.4 ui-monospace, Menlo, monospace; opacity: 0.85; margin: 0.25rem 0; white-space: pre-line; }
.lsp-card .row { margin: 0.2rem 0; }
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

export function render(host) {
  ensureStyle();
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);
  host.innerHTML = `<div class="lsp-chart">
    ${card(STEPS[0], `
      <div class="row"><label for="lsp-extent">Extent</label><select id="lsp-extent" class="input"><option value="drawn">Drawn / boxed area</option></select></div>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-draw">Draw an area</button><button type="button" class="button" id="lsp-use">Use this extent</button></div>`)}
    ${card(STEPS[1], `
      <div class="row"><label for="lsp-rain-source">Source</label><select id="lsp-rain-source" class="input">
        <option value="forecast">Forecast — GFS/ICON hourly, next days (Open-Meteo)</option>
        <option value="archive">Past — ERA5 reanalysis hourly, by date (Open-Meteo)</option>
      </select></div>
      <div class="row" id="lsp-rain-days-row"><label for="lsp-rain-days">Days ahead</label><input id="lsp-rain-days" class="input" type="number" min="1" max="16" value="7"></div>
      <div class="row" id="lsp-rain-start-row" hidden><label for="lsp-rain-start">From</label><input id="lsp-rain-start" class="input" type="date" value="${iso(monthAgo)}"></div>
      <div class="row" id="lsp-rain-end-row" hidden><label for="lsp-rain-end">To</label><input id="lsp-rain-end" class="input" type="date" value="${iso(today)}"></div>
      <div class="row"><label for="lsp-rain-across" title="How many rainfall points across the area. GFS is a ~25 km model; more points than that is inventing detail the forecast does not have.">Points across</label><select id="lsp-rain-across" class="input"><option value="4">4 × 4</option><option value="6" selected>6 × 6</option><option value="8">8 × 8</option></select></div>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-rain-fetch">Fetch rainfall</button></div>`)}
    ${card(STEPS[2], `
      <div class="row"><label for="lsp-ground-cells" title="The model's own grid over the area. The DEM is read at the level the area deserves; the material comes from whichever geological or soil map is on the globe; depth from the soil-thickness model.">Cells (max)</label><select id="lsp-ground-cells" class="input"><option value="10000">10,000</option><option value="40000" selected>40,000</option><option value="90000">90,000</option></select></div>
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-ground-read">Read the ground</button></div>`)}
    ${card(STEPS[3], `
      <div class="row"><label for="lsp-hydro-model">Model</label><select id="lsp-hydro-model" class="input">
        <option value="ground" selected>Bucket from the ground — n·z capacity, K·sin β drainage</option>
        <option value="fixed">Fixed bucket — 120 mm, 12% a day (the FoS mode's)</option>
      </select></div>
      <div class="row"><label for="lsp-hydro-n" title="Where the material has no published porosity">Default porosity</label><input id="lsp-hydro-n" class="input" type="number" step="0.05" min="0.01" max="0.9" value="0.3"></div>
      <div class="row"><label for="lsp-hydro-k" title="Where the material has no published hydraulic conductivity, m/s">Default K (m/s)</label><input id="lsp-hydro-k" class="input" type="text" value="1e-6"></div>
      <div class="lsp-eq">capacity = n · z   (mm of water the failure column can hold)
drain/day = K · 86400 · sin β / (n · z)   (lateral throughflow, clamped 2–95 %)
m(t+1) = min(1, m(t) + rain/capacity) − drain</div>`)}
    ${card(STEPS[4], `
      <div class="lsp-eq">FoS = [ c′ + (γ − m·γw) · z · cos²β · tan φ′ ] / [ γ · z · sin β · cos β ]</div>
      <p class="compact-copy" style="margin:0;opacity:0.8">c′, φ′ and γ from the material each cell's map names (the FoS mode's screening table); z the modelled thickness capped at 3 m, else the class default; slopes under 5° are not modelled. Classes: failure &lt; 1, marginal &lt; 1.1, low margin &lt; 1.3, adequate &lt; 1.5, stable.</p>`)}
    ${card(STEPS[5], `
      <div class="gis-btn-row"><button type="button" class="button" id="lsp-run">Run and play</button><button type="button" class="button" id="lsp-clear">Clear</button></div>`)}
  </div>`;
  wire(host);
  markStates();
}

function wire(host) {
  const extent = byId("lsp-extent");
  refreshPolygonOptions(extent, "drawn", { allLayers: true });
  window.addEventListener("geoid-gis:layers-changed", () => { try { refreshPolygonOptions(extent, extent.value || "drawn", { allLayers: true }); } catch (e) { /* redraw later */ } });
  byId("lsp-draw").addEventListener("click", () => { promptDrawTool(); say("area", "Draw the area on the globe, press Done, then Use this extent."); });
  byId("lsp-use").addEventListener("click", () => {
    const b = resolvePolygonExtent(extent.value, { arm: false });
    if (!b || ![b.west, b.south, b.east, b.north].every(Number.isFinite)) { say("area", "No area yet — draw one, or pick a layer.", "error"); return; }
    state.bounds = b; state.rain = null; state.ground = null; state.run = null;
    const w = (b.east - b.west) * 111.32 * Math.cos(((b.south + b.north) / 2) * Math.PI / 180);
    const h = (b.north - b.south) * 110.574;
    say("area", `${w.toFixed(1)} × ${h.toFixed(1)} km — ${b.west.toFixed(3)} to ${b.east.toFixed(3)}°E, ${b.south.toFixed(3)} to ${b.north.toFixed(3)}°N`);
    ["rain", "ground", "run"].forEach((id) => say(id, ""));
    markStates();
  });
  const source = byId("lsp-rain-source");
  source.addEventListener("change", () => {
    const archive = source.value === "archive";
    byId("lsp-rain-days-row").hidden = archive;
    byId("lsp-rain-start-row").hidden = !archive;
    byId("lsp-rain-end-row").hidden = !archive;
  });
  byId("lsp-rain-fetch").addEventListener("click", () => void fetchRain());
  byId("lsp-ground-read").addEventListener("click", () => void readGround());
  byId("lsp-hydro-model").addEventListener("change", () => { state.hydro.model = byId("lsp-hydro-model").value; });
  byId("lsp-hydro-n").addEventListener("change", () => { state.hydro.porosity = Number(byId("lsp-hydro-n").value) || 0.3; });
  byId("lsp-hydro-k").addEventListener("change", () => { state.hydro.conductivity = Number(byId("lsp-hydro-k").value) || 1e-6; });
  byId("lsp-run").addEventListener("click", () => void run());
  byId("lsp-clear").addEventListener("click", () => clear());
}

/* ── step 2: rainfall by extent and date ────────────────────────────────── */

async function fetchRain() {
  const b = state.bounds;
  if (!b) return;
  const across = Number(byId("lsp-rain-across").value) || 6;
  const points = weatherPoints({ minX: b.west, maxX: b.east, minY: b.south, maxY: b.north }, { across });
  const archive = byId("lsp-rain-source").value === "archive";
  const start = byId("lsp-rain-start").value; const end = byId("lsp-rain-end").value;
  const days = Math.max(1, Math.min(16, Number(byId("lsp-rain-days").value) || 7));
  if (archive && (!start || !end || start > end)) { say("rain", "Give a start and an end date, in order.", "error"); return; }
  const url = archive ? archiveUrl(points, { start, end }) : weatherUrl(points, { days });
  say("rain", `Fetching ${points.length} points…`);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
    const parsed = parseWeatherGrid(await response.json(), points);
    if (!parsed.ok) throw new Error(parsed.message);
    const totals = parsed.series.map((s) => s.rain.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0));
    state.rain = { ...parsed, points, source: archive ? "ERA5 reanalysis (Open-Meteo archive)" : "GFS/ICON forecast (Open-Meteo)", window: archive ? `${start} to ${end}` : `next ${days} days` };
    state.run = null;
    say("rain", `${parsed.dates.length} steps of ${parsed.stepHours} h over ${points.length} points, ${state.rain.window} — totals ${Math.min(...totals).toFixed(0)} to ${Math.max(...totals).toFixed(0)} mm. ${state.rain.source}, CC BY 4.0.`);
  } catch (error) {
    say("rain", `Rainfall could not be read: ${error.message}`, "error");
  }
  markStates();
}

/* ── step 3: the ground ─────────────────────────────────────────────────── */

function groundLayer() {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  return layers.find((l) => l.status === "loaded" && l.features?.length && (isGroundLayer(l) || /geolog|lithology|soil|superficial|bedrock/i.test(l.name || ""))) || null;
}

async function readGround() {
  const b = state.bounds;
  if (!b) return;
  const maxCells = Number(byId("lsp-ground-cells").value) || 40000;
  say("ground", "Reading the elevation…");
  try {
    const dem = window.GeoIDDem;
    let label = "the viewer's elevation model";
    if (dem?.ensure) {
      const got = await dem.ensure(b, { maxTiles: 256 });
      if (got?.ok) label = `streamed DEM at zoom ${got.zoom} (${Math.round(dem.metresPerPixel(got.zoom, (b.south + b.north) / 2))} m posts)`;
    }
    const heightAt = (lat, lon) => {
      const h = dem?.heightAt?.(lat, lon);
      return Number.isFinite(h) ? h : window.GeoIDViewer?.sampleElevationMeters?.(lat, lon);
    };
    const grid = demGridFor(b, heightAt, { maxCells });
    if (!grid.known) throw new Error("no elevation under the area");
    const grad = slopeOf(grid);
    // the material: whichever ground map is on the globe
    const geol = groundLayer();
    let lithAt = null;
    if (geol) {
      if (geol.featuresIn) { try { await geol.featuresIn({ minX: b.west, maxX: b.east, minY: b.south, maxY: b.north }); } catch (e) { /* the snapshot serves */ } }
      lithAt = samplerOver(geol.features, lithologyOf);
    }
    say("ground", "Reading the soil thickness…");
    let thickAt = null;
    try {
      const mod = await import(`./soil-thickness.js${search}`);
      const tg = await mod.thicknessGridFor(b);
      if (tg) thickAt = (lat, lon) => mod.metresIn(tg, lat, lon);
    } catch (e) { /* depth falls back to the class default */ }
    await loadRockProperties().catch(() => null);
    const cells = [];
    let withLith = 0; let withDepth = 0;
    for (let y = 0; y < grid.height; y += 1) {
      const lat = b.north - ((y + 0.5) / grid.height) * (b.north - b.south);
      for (let x = 0; x < grid.width; x += 1) {
        const lon = b.west + ((x + 0.5) / grid.width) * (b.east - b.west);
        const slopeDeg = grad.band[y * grid.width + x];
        if (!Number.isFinite(slopeDeg)) continue;
        const lith = lithAt ? lithAt(lat, lon) : null;
        if (lith) withLith += 1;
        const material = materialFor(lith);
        const thickness = thickAt ? thickAt(lat, lon) : null;
        if (Number.isFinite(thickness)) withDepth += 1;
        const z = failureDepth(thickness, material.depth);
        cells.push({
          x, y, lat, lon, slopeDeg, lith, material: { ...material, depth: z.depth }, depthFrom: z.from,
          // percent in the database, a fraction in the bucket
          porosity: lith && Number.isFinite(parameterValue(lith, "porosity")) ? parameterValue(lith, "porosity") / 100 : null,
          conductivity: lith ? parameterValue(lith, "hydraulic_conductivity") : null,
        });
      }
    }
    state.ground = { grid, cells, cols: grid.width, rows: grid.height, demLabel: label, geolName: geol?.name || null, withLith, withDepth };
    state.run = null;
    say("ground", `${cells.length.toLocaleString()} cells at ${grid.stepM} m from ${label}; material from ${geol ? `"${geol.name}" for ${Math.round((100 * withLith) / Math.max(1, cells.length))}% of cells` : "NO map — tick World geology, GLiM or the soil map for a material; every cell takes the default"}; depth from the thickness model for ${Math.round((100 * withDepth) / Math.max(1, cells.length))}%.`, geol ? "" : "error");
  } catch (error) {
    say("ground", `The ground could not be read: ${error.message}`, "error");
  }
  markStates();
}

/* ── step 6: run, draw, play ────────────────────────────────────────────── */

function bucketOfCell(cell) {
  if (state.hydro.model === "fixed") return { capacityMm: 120, drainPerDay: 0.12 };
  return bucketFor({
    porosity: Number.isFinite(cell.porosity) ? cell.porosity : state.hydro.porosity,
    conductivity: Number.isFinite(cell.conductivity) ? cell.conductivity : state.hydro.conductivity,
    depthM: cell.material.depth, slopeDeg: cell.slopeDeg,
  });
}

const CLASS_COLOUR = (v) => fosColour(v);

async function run() {
  const g = state.ground; const r = state.rain;
  if (!g || !r) return;
  clear({ keepInputs: true });
  say("run", `Computing ${r.dates.length} steps over ${g.cells.length.toLocaleString()} cells…`);
  await new Promise((res) => setTimeout(res, 20));
  const rainFor = (cell, s) => rainAt(r.series, cell.lat, cell.lon, s);
  const { steps } = runSteps({ cells: g.cells, dates: r.dates, stepHours: r.stepHours, rainFor, bucketOf: bucketOfCell });
  const band = new Float32Array(g.cols * g.rows).fill(NaN);
  const put = (s) => { band.fill(NaN); g.cells.forEach((c, j) => { band[c.y * g.cols + c.x] = steps[s].values[j]; }); };
  // open on the worst step: the map somebody ran a forecast for is the day it matters
  let worst = 0; steps.forEach((s, i) => { if (s.failingFraction > steps[worst].failingFraction) worst = i; });
  put(worst);
  const built = buildRasterLayer([band], g.cols, g.rows, g.grid.bounds, { name: LAYER_NAME, isDem: false, noData: NaN });
  if (!built) { say("run", "The layer could not be built.", "error"); return; }
  built.repaint?.((v) => CLASS_COLOUR(v));
  built.legendInfo = {
    classed: true, categorical: true, field: "fos", label: "Factor of safety",
    palette: ["d7191c", "fd8d3c", "fed976", "a1dab4", "2c7fb8"], labels: ["failure (< 1)", "marginal (< 1.1)", "low margin (< 1.3)", "adequate (< 1.5)", "stable"],
    bounds: [["0", "1"], ["1", "1.1"], ["1.1", "1.3"], ["1.3", "1.5"], ["1.5", "∞"]], counts: [0, 0, 0, 0, 0],
  };
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(LAYER_NAME, built, "fos");
  if (!layer) { say("run", "The globe is not ready.", "error"); return; }
  layer.legendInfo = built.legendInfo;
  layer.raster = makeRaster(band, g.cols, g.rows, g.grid.bounds, NaN);
  window.GeoIDLayerHierarchy?.setOpacity?.(layer, 0.75);
  layer.info = {
    source: `${r.source}; ${g.demLabel}; ${g.geolName || "no material map"}; Pelletier thickness`,
    summary: "Infinite-slope factor of safety through time, the bucket sized per cell from the material's porosity and conductivity.",
    citation: "GeoHUB forecast landslide pipeline",
  };
  state.run = { layer, built, steps, band, put };
  const epochs = steps.map((s, i) => ({ date: s.date, label: String(s.date).replace("T", " "), dataset: null, index: i, tick: i % Math.max(1, Math.round(steps.length / 8)) === 0 }));
  state.playing = true;
  await startPlayer({
    bounds: g.grid.bounds ? { west: g.grid.bounds.minX, east: g.grid.bounds.maxX, south: g.grid.bounds.minY, north: g.grid.bounds.maxY } : null,
    epochs, source: "none",
    noteFor: (e) => { const s = steps[e.index]; return `${s.failing.toLocaleString()} / ${s.applicable.toLocaleString()} failing · wetness ${s.wetFraction.toFixed(2)}`; },
    noteTitle: (e) => { const s = steps[e.index]; return `${s.failing} of ${s.applicable} modelled cells below FoS 1 at ${e.date}; mean wet fraction ${s.wetFraction.toFixed(2)}`; },
    onStatus: (m) => say("run", m), interval: 250, startAt: worst,
    onShow: (index) => {
      put(index); state.step = index;
      try { built.repaint?.((v) => CLASS_COLOUR(v)); } catch (e) { /* stands */ }
      const counts = [0, 0, 0, 0, 0];
      for (const v of steps[index].values) { const b = stabilityBand(v); if (b) counts[["failure", "marginal", "low margin", "adequate", "stable"].indexOf(b)] += 1; }
      layer.legendInfo = { ...built.legendInfo, counts };
      window.GeoIDLayerHierarchy?.render?.();
    },
    onStop: () => { state.playing = false; },
  });
  say("run", `${steps.length} steps of ${r.stepHours} h; worst step ${steps[worst].date}: ${steps[worst].failing.toLocaleString()} of ${steps[worst].applicable.toLocaleString()} cells below FoS 1. Scrub the bar; click a cell for its numbers.`);
  markStates();
}

function clear({ keepInputs = false } = {}) {
  if (state.playing) { try { stopPlayer(); } catch (e) { /* gone */ } }
  const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === LAYER_NAME);
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  state.run = null; state.step = -1;
  if (!keepInputs) { state.rain = null; state.ground = null; state.bounds = null; ["area", "rain", "ground", "run"].forEach((id) => say(id, "")); }
  markStates();
}

/** A click on the risk layer: this cell at the step on screen. */
export function probeAt(lat, lon) {
  const run = state.run; const g = state.ground;
  if (!run || !g || run.layer.visible === false) return false;
  const b = g.grid.bounds;
  if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) return false;
  const x = Math.min(g.cols - 1, Math.floor(((lon - b.minX) / (b.maxX - b.minX)) * g.cols));
  const y = Math.min(g.rows - 1, Math.floor(((b.maxY - lat) / (b.maxY - b.minY)) * g.rows));
  const j = g.cells.findIndex((c) => c.x === x && c.y === y);
  if (j < 0) return false;
  const cell = g.cells[j];
  const s = Math.max(0, state.step);
  const v = run.steps[s].values[j];
  const bucket = bucketOfCell(cell);
  const rows = [
    ["Factor of safety", Number.isFinite(v) ? `${v.toFixed(2)} — ${stabilityBand(v)}` : "not modelled (slope under 5°)"],
    ["Step", String(run.steps[s].date)],
    ["Slope", `${cell.slopeDeg.toFixed(1)}°`],
    ["Material", `${cell.lith || "default class"} → c′ ${cell.material.cohesion} kPa, φ′ ${cell.material.friction}°, γ ${cell.material.unitWeight} kN/m³`],
    ["Depth", `${cell.material.depth} m (${cell.depthFrom})`],
    ["Bucket", `${bucket.capacityMm} mm capacity, ${(bucket.drainPerDay * 100).toFixed(0)}% a day drainage (n ${bucket.n ?? "—"}, K ${Number.isFinite(bucket.K) ? bucket.K.toExponential(1) : "—"} m/s)`],
  ];
  window.GeoIDViewer?.showFeatureCard?.({
    // Named, so the card is claimed by this layer and goes when it does.
    source_layer: LAYER_NAME,
    soil: true, type: "Forecast landslide risk", rock_type: rows[0][1], lithology: null, name: null,
    description: `${state.rain?.source || ""} · ${state.rain?.window || ""}`, extra_rows: rows, origin: "GeoHUB forecast landslide pipeline",
    rows: [["Note", "Infinite-slope screening: a plane failure parallel to the ground, the column wetted by a bucket sized from the material's own porosity and drained at its conductivity down the slope. Not a site investigation."]],
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
if (typeof window !== "undefined") {
  window.GeoIDLandslidePipeline = { init, render, probeAt, state, readiness, bucketFor, demGridFor, runSteps, archiveUrl, LAYER_NAME };
}
