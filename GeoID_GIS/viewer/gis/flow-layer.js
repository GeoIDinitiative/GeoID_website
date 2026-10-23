/**
 * Live wind and ocean currents as moving streamlines on the globe — the
 * nullschool picture, built from this app's own parts.
 *
 * Two layers, one engine:
 *
 * - **Wind** (Earth Observation ▸ Atmosphere): NOAA GFS through Open-Meteo,
 *   at 10 m or on a pressure level (850, 500, 250 hPa — the boundary layer, the
 *   mid troposphere, the jet stream), now or up to three days ahead.
 * - **Ocean currents** (Earth Observation ▸ Hydrology ▸ Ocean): Open-Meteo's
 *   marine model (Météo-France SMOC, ~8 km) with the sea surface temperature
 *   alongside, so the shading can show either the speed or the temperature.
 *
 * WHAT IS DRAWN. A few thousand particles are dropped at random in the view
 * (uniform by AREA, or the poles look busiest), carried along the field one
 * small step a frame and drawn with a fading tail, so the eye reads the flow
 * the way it reads iron filings. Under them, optionally, the speed itself as a
 * smoothly shaded sheet. Both follow the relief exactly as every other layer
 * on this globe does (`followRelief`), sit a constant 30 m clear of the ground
 * the way the event markers do, and cull the far hemisphere by facing.
 *
 * THE FIELD is fetched twice: a coarse lattice over the whole world when the
 * layer is ticked, and a finer one over the view whenever it settles on less
 * than about a hemisphere. Inside the view's box the fine field answers —
 * including where it says "coast", so a particle cannot be blended onto land
 * by the coarse field behind it. Both are cached for the hour, so panning back
 * costs nothing.
 *
 * Open-Meteo is keyless and answers CORS; the points ride in the URL, a few
 * hundred to a request. It is a free service with a fair-use limit, which is
 * why the world lattice is coarse and only the view is refined.
 */

import * as THREE from "../vendor/three.module.js";
import { followRelief } from "./vector-render.js?v=20261023-c5add11";
import { visibleBounds } from "./view-extent.js?v=20261023-c5add11";
import {
  WORLD, RAMPS, OPEN_METEO, OPEN_METEO_MARINE, planGrid, gridPoints, chunkPoints,
  requestUrl, readHourly, buildField, sampleStack, sampleScalar, advect, randomPoint,
  rampAt, rampPalette, headingOf, compassPoint, beaufort, wrapLon, RAD,
  aggregateHourly, countFinite, createCallBudget,
} from "./flow-field.js?v=20261023-c5add11";

/* ── the two sources ───────────────────────────────────────────────────── */

const SOURCES = {
  wind: {
    id: "wind",
    layerName: "Wind — live streamlines (GFS)",
    home: "weather",
    base: OPEN_METEO,
    convention: "from",
    extra: { wind_speed_unit: "ms", models: "gfs_seamless" },
    levels: {
      "10m": { label: "10 m above the ground", speed: "wind_speed_10m", dir: "wind_direction_10m" },
      "850hPa": { label: "850 hPa — about 1.5 km", speed: "wind_speed_850hPa", dir: "wind_direction_850hPa" },
      "500hPa": { label: "500 hPa — about 5.5 km", speed: "wind_speed_500hPa", dir: "wind_direction_500hPa" },
      "250hPa": { label: "250 hPa — the jet stream, about 10 km", speed: "wind_speed_250hPa", dir: "wind_direction_250hPa" },
    },
    ramp: RAMPS.wind,
    // A 10 m/s wind crosses about a 150th of the view a frame.
    stepPerMs: 1 / 1500,
    // GFS's own grid is 0.25°, the seamless blend's finest about 0.11°.
    nativeDeg: 0.12,
    // INSIDE ONE MINUTE OF OPEN-METEO (see CALLS_PER_MINUTE): about a 12°
    // lattice over the world, and the view's own finer one when zoomed in,
    // which waits for the minute to turn rather than being refused.
    worldBudget: 450,
    viewBudget: 400,
    unit: "m/s",
    credit: "NOAA GFS via Open-Meteo (open-meteo.com), CC BY 4.0",
    statusId: "wind-flow-status",
  },
  hazards: {
    id: "hazards",
    kind: "scalar",
    layerName: "Forecast hazards (GFS)",
    home: "weather",
    base: OPEN_METEO,
    extra: { wind_speed_unit: "ms", models: "gfs_seamless" },
    levels: {},
    nativeDeg: 0.12,
    worldBudget: 450,
    viewBudget: 400,
    credit: "NOAA GFS via Open-Meteo (open-meteo.com), CC BY 4.0",
    statusId: "hazard-field-status",
  },
  currents: {
    id: "currents",
    layerName: "Ocean currents — live streamlines",
    home: "hydrology",
    base: OPEN_METEO_MARINE,
    convention: "to",
    extra: {},
    levels: {
      surface: { label: "Sea surface", speed: "ocean_current_velocity", dir: "ocean_current_direction" },
    },
    scalars: { sst: "sea_surface_temperature" },
    ramp: RAMPS.current,
    // A current is a fiftieth of a wind's speed, and is drawn as briskly.
    stepPerMs: 1 / 70,
    // SMOC is a twelfth of a degree.
    nativeDeg: 0.083,
    worldBudget: 450,
    viewBudget: 400,
    unit: "m/s",
    credit: "Open-Meteo Marine (open-meteo.com), CC BY 4.0 — Météo-France SMOC ocean currents, "
      + "sea surface temperature from the same model",
    statusId: "current-flow-status",
  },
};

/**
 * FORECAST HAZARDS: what GFS says the next one to three days hold, as one
 * number per place over the window — the rain that will fall, the strongest
 * gust, the peak instability, the hottest and coldest it will feel, the snow.
 * Each carries the thresholds its own discipline warns at, so the card can say
 * what a number means and the key is in those terms rather than in bare
 * quantiles. Thresholds: rain from the common 50/100 mm-a-day heavy and
 * extreme warnings; gusts on the Beaufort scale; CAPE from the standard
 * forecaster's bands; heat on the US NWS heat-index categories (applied to
 * the apparent temperature, which is what Open-Meteo provides); cold on wind
 * chill frostbite times.
 */
export const HAZARD_VARS = {
  precip: {
    label: "Rainfall total", variable: "precipitation", op: "sum", unit: "mm", floor: 0.5,
    ramp: [[0, 230, 240, 250], [5, 150, 200, 235], [20, 60, 140, 210], [50, 40, 70, 180],
      [100, 150, 50, 170], [200, 230, 40, 90]],
    bands: [[100, "extreme — flash flooding likely"], [50, "heavy — flooding possible"],
      [20, "wet — surface water on poor drainage"], [1, "rain"], [0, "dry"]],
  },
  gusts: {
    label: "Strongest gust", variable: "wind_gusts_10m", op: "max", unit: "m/s", convert: "speed", floor: 10.8,
    ramp: RAMPS.wind,
    bands: [[32.7, "hurricane force"], [24.5, "storm — structural damage"], [17.2, "gale — trees down"],
      [10.8, "strong"], [0, "light to moderate"]],
  },
  cape: {
    label: "Peak instability (CAPE)", variable: "cape", op: "max", unit: "J/kg", floor: 300,
    ramp: [[0, 40, 60, 90], [500, 60, 140, 120], [1000, 200, 210, 70], [2500, 240, 130, 40],
      [3500, 220, 40, 60], [5000, 240, 120, 240]],
    bands: [[3500, "extreme — severe storms possible"], [2500, "strong — thunderstorms likely if triggered"],
      [1000, "moderate"], [300, "marginal"], [0, "stable"]],
  },
  heat: {
    label: "Hottest it will feel", variable: "apparent_temperature", op: "max", unit: "°C", floor: 27,
    ramp: [[-10, 60, 90, 180], [10, 120, 200, 210], [20, 200, 220, 120], [27, 245, 200, 70],
      [32, 240, 130, 50], [39, 220, 50, 50], [51, 140, 20, 120]],
    bands: [[51, "extreme danger — heat stroke imminent"], [39, "danger — heat exhaustion likely"],
      [32, "extreme caution"], [27, "caution"], [-100, "no heat stress"]],
  },
  cold: {
    label: "Coldest it will feel", variable: "apparent_temperature", op: "min", unit: "°C", floor: 0,
    ramp: [[-45, 230, 230, 255], [-35, 160, 120, 230], [-25, 90, 90, 210], [-10, 60, 140, 220],
      [0, 120, 200, 230], [15, 200, 230, 200]],
    bands: [[-35, "frostbite in 10 minutes"], [-25, "frostbite in 30 minutes"],
      [-10, "cold stress"], [0, "frost"], [100, "no cold stress"]],
    below: true,
  },
  snow: {
    label: "Snowfall total", variable: "snowfall", op: "sum", unit: "cm", floor: 0.2,
    ramp: [[0, 230, 240, 250], [2, 180, 210, 240], [10, 110, 160, 230], [30, 120, 90, 210],
      [60, 200, 60, 180]],
    bands: [[30, "heavy — roads impassable"], [10, "significant"], [2, "light"], [0.01, "a dusting"], [0, "none"]],
  },
};

/** What each layer is set to; changed from the drawer under its row. */
const settings = {
  hazards: { variable: "precip", windowHours: 24, shading: "value" },
  wind: { level: "10m", hoursAhead: 0, shading: true, particles: 4000, speed: 1 },
  currents: { level: "surface", hoursAhead: 0, shading: "speed", colourBy: "speed", particles: 4500, speed: 1 },
};

const TRAIL = 10;
const WHITE = [1, 1, 1];          // history points a particle draws
const VIEW_REFINE_MAX = 110; // a view wider than this (degrees of latitude) is the world
const CONCURRENCY = 4;

const byId = (id) => document.getElementById(id);
const viewer = () => window.GeoIDViewer;
const manager = () => window.GeoIDImportManager;

/** Live state per source: its layer, its fields, its particles. */
const live = {};

function say(source, message) {
  const node = byId(SOURCES[source].statusId);
  if (node) node.textContent = message || "";
}

/* ── fetching ──────────────────────────────────────────────────────────── */

const cache = new Map();

function hourKey() {
  return new Date().toISOString().slice(0, 13);
}

function cacheKey(source, box, nx, ny) {
  const s = settings[source];
  return [source, s.level, s.hoursAhead, s.variable, s.windowHours, hourKey(), box.west.toFixed(1), box.east.toFixed(1),
    box.south.toFixed(1), box.north.toFixed(1), nx, ny].join("|");
}

/** Every Open-Meteo point this page's flow layers ask for, a minute at a time. */
const calls = createCallBudget();

/** Spend `n` points from the minute's budget, saying so if it means a wait. */
async function spend(n, source, signal) {
  const ms = calls.waitFor(n);
  if (ms > 1500 && source) {
    const secs = Math.ceil(ms / 1000);
    // Already drawing the world's field: this wait is only the view's finer
    // one, so the line keeps saying what is shown and adds when detail lands.
    say(source, live[source]?.world
      ? `${describe(source)} Finer detail for this view in about ${secs} s.`
      : `Waiting ${secs} s — Open-Meteo allows ${calls.limit} points a minute…`);
  }
  await calls.take(n, signal);
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
});

/**
 * One request of `n` points, paid for from the minute's budget. A 429 means
 * something else on this address spent the minute (another tab, the weather
 * cards), so it waits the minute out once and asks again. One retry under a
 * plainer window if a service refuses the hour window.
 */
async function fetchChunk(url, signal, n = 1, source = null) {
  await spend(n, source, signal);
  let res = await fetch(url, { signal });
  if (res.status === 429) {
    if (source) say(source, "Open-Meteo's minute is used up on this connection — asking again in a minute…");
    await sleep(61_000, signal);
    res = await fetch(url, { signal });
  }
  if (res.status === 400) {
    const plain = url.replace(/&past_hours=\d+/, "").replace(/&forecast_hours=(\d+)/,
      (_, h) => `&forecast_days=${Math.max(1, Math.ceil(Number(h) / 24))}`);
    res = await fetch(plain, { signal });
  }
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try { reason = (await res.json())?.reason || reason; } catch { /* the status will do */ }
    throw new Error(reason);
  }
  return res.json();
}

/** Run at most `limit` promises at once. */
async function pool(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next; next += 1;
      out[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

/**
 * KEPT FOR THE HOUR IN THIS BROWSER, not only in memory: the model changes
 * hourly, and a reload or a second tab would otherwise spend the whole minute's
 * budget again on numbers it already has. Only the raw lattice is stored;
 * the field is rebuilt from it. Anything from another hour is dropped.
 */
const STORE = "geoid-flow:";

function storeGet(key) {
  try {
    const raw = localStorage.getItem(STORE + key);
    if (!raw) return null;
    const back = (a) => Float64Array.from(a, (x) => (x === null ? NaN : x));
    const d = JSON.parse(raw);
    return { speed: back(d.speed), dir: back(d.dir), time: d.time,
      scalars: Object.fromEntries(Object.entries(d.scalars || {}).map(([k, v]) => [k, back(v)])) };
  } catch { return null; }
}

function storePut(key, { speed, dir, scalars, time }) {
  try {
    const hour = `|${hourKey()}|`;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORE) && !k.includes(hour)) localStorage.removeItem(k);
    }
    const out = (a) => Array.from(a, (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null));
    localStorage.setItem(STORE + key, JSON.stringify({ speed: out(speed), dir: out(dir), time,
      scalars: Object.fromEntries(Object.entries(scalars || {}).map(([k, v]) => [k, out(v)])) }));
  } catch { /* storage full or blocked: the memory cache still holds it */ }
}

/**
 * The field over a box, fetched point lattice by point lattice and cached for
 * the hour. Answers a field, or throws with the service's own reason.
 */
async function fetchField(source, box, budget, signal) {
  const def = SOURCES[source];
  const s = settings[source];
  const level = def.levels[s.level] || Object.values(def.levels)[0];
  // Never finer than the model itself: a lattice at a tenth of its grid is
  // ten times the requests for the same numbers, interpolated by the service.
  const shrink = Math.max(0.2, Math.cos(((box.south + box.north) / 2) * Math.PI / 180));
  const areaDeg2 = (box.east - box.west) * shrink * (box.north - box.south);
  const nativeCap = Math.max(16, Math.ceil(areaDeg2 / (def.nativeDeg * def.nativeDeg)));
  const { nx, ny } = planGrid(box, Math.min(budget, nativeCap));
  const key = cacheKey(source, box, nx, ny);
  if (cache.has(key)) return cache.get(key);
  const { lats, lons } = gridPoints(box, nx, ny);
  if (def.kind === "scalar") return fetchScalar(source, box, nx, ny, lats, lons, key, signal);
  const stored = storeGet(key);
  if (stored) {
    const field = buildField(box, nx, ny, stored.speed, stored.dir,
      { convention: def.convention, scalars: stored.scalars, time: stored.time });
    if (field.valid) { cache.set(key, field); return field; }
  }
  const scalarVars = Object.values(def.scalars || {});
  const variables = [level.speed, level.dir, ...scalarVars];
  const chunks = chunkPoints(lats, lons);
  const speed = new Float64Array(lats.length).fill(NaN);
  const dir = new Float64Array(lats.length).fill(NaN);
  const scalars = Object.fromEntries(Object.keys(def.scalars || {})
    .map((name) => [name, new Float64Array(lats.length).fill(NaN)]));
  let time = null;
  const nowMs = Date.now();
  await pool(chunks.map((chunk) => async () => {
    const url = requestUrl(def.base, {
      lats: chunk.lats, lons: chunk.lons, variables, extra: def.extra, hoursAhead: s.hoursAhead,
    });
    const json = await fetchChunk(url, signal, chunk.lats.length, source);
    const read = readHourly(json, variables, {
      nowMs, hoursAhead: s.hoursAhead, convert: { [level.speed]: "speed" },
    });
    time ??= read.time;
    for (let k = 0; k < chunk.lats.length; k += 1) {
      speed[chunk.start + k] = read.values[level.speed][k];
      dir[chunk.start + k] = read.values[level.dir][k];
      for (const [name, variable] of Object.entries(def.scalars || {})) {
        scalars[name][chunk.start + k] = read.values[variable][k];
      }
    }
  }), CONCURRENCY);
  const field = buildField(box, nx, ny, speed, dir, { convention: def.convention, scalars, time });
  if (field.valid) { cache.set(key, field); storePut(key, { speed, dir, scalars, time }); }
  // Keep the cache to the last couple of dozen fields.
  while (cache.size > 24) cache.delete(cache.keys().next().value);
  return field;
}

/** A forecast hazard: one aggregated number per point over the window. */
async function fetchScalar(source, box, nx, ny, lats, lons, key, signal) {
  const def = SOURCES[source];
  const s = settings[source];
  const hv = HAZARD_VARS[s.variable];
  const values = new Float64Array(lats.length).fill(NaN);
  let from = null;
  let to = null;
  const nowMs = Date.now();
  await pool(chunkPoints(lats, lons).map((chunk) => async () => {
    const url = requestUrl(def.base, {
      lats: chunk.lats, lons: chunk.lons, variables: [hv.variable], extra: def.extra,
      hoursAhead: s.windowHours,
    });
    const json = await fetchChunk(url, signal, chunk.lats.length, source);
    const read = aggregateHourly(json, hv.variable, {
      nowMs, toHours: s.windowHours, op: hv.op, convert: hv.convert || null,
    });
    from ??= read.from; to ??= read.to;
    for (let k = 0; k < chunk.lats.length; k += 1) values[chunk.start + k] = read.values[k];
  }), CONCURRENCY);
  const nan = new Float64Array(lats.length).fill(NaN);
  const field = buildField(box, nx, ny, nan, nan, { scalars: { value: values }, time: from });
  field.until = to;
  field.valid = countFinite(values);
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of values) if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  field.min = lo; field.max = hi;
  if (field.valid) cache.set(key, field);
  while (cache.size > 24) cache.delete(cache.keys().next().value);
  return field;
}

/** The band a hazard value falls in, in its own discipline's words. */
export function hazardBand(variable, value) {
  const hv = HAZARD_VARS[variable];
  if (!hv || !Number.isFinite(value)) return null;
  for (const [edge, label] of hv.bands) {
    if (hv.below ? value <= edge : value >= edge) return label;
  }
  return hv.bands.at(-1)[1];
}

/* ── geometry on the globe ─────────────────────────────────────────────── */

/**
 * A unit direction for a latitude and longitude, in the frame the imported
 * layers are drawn in. The viewer's own `latLonToVector3` is the authority;
 * its formula is checked once against it and written out here so a frame
 * of four thousand particles does not allocate four thousand vectors.
 */
let dirFormulaOk = null;
function directionInto(out, o, lat, lon) {
  if (dirFormulaOk === null) {
    const fn = viewer()?.latLonToVector3;
    dirFormulaOk = true;
    if (typeof fn === "function") {
      for (const [a, b] of [[10, 20], [-35, 140], [60, -100]]) {
        const v = fn(a, b, 1);
        const len = Math.hypot(v.x, v.y, v.z) || 1;
        const la = a * RAD, lo = b * RAD;
        const x = -Math.cos(la) * Math.cos(lo), y = Math.sin(la), z = Math.cos(la) * Math.sin(lo);
        if (Math.abs(v.x / len - x) + Math.abs(v.y / len - y) + Math.abs(v.z / len - z) > 1e-6) {
          dirFormulaOk = false;
        }
      }
    }
  }
  if (dirFormulaOk) {
    const la = lat * RAD, lo = lon * RAD;
    const c = Math.cos(la);
    out[o] = -c * Math.cos(lo);
    out[o + 1] = Math.sin(la);
    out[o + 2] = c * Math.sin(lo);
    return;
  }
  const v = viewer().latLonToVector3(lat, lon, 1);
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  out[o] = v.x / len; out[o + 1] = v.y / len; out[o + 2] = v.z / len;
}

function heightAt(lat, lon) {
  const h = Number(viewer()?.elevationNormalized?.(lat, lon));
  return Number.isFinite(h) ? h : 0;
}

/**
 * The particles: a ring of TRAIL points each, drawn as line segments whose
 * alpha rises toward the head. Positions are placed on the GPU from a unit
 * direction and a normalised height, so they follow the live relief.
 */
class Particles {
  constructor(count) {
    this.resize(count);
  }

  resize(count) {
    this.n = Math.max(100, Math.round(count));
    const n = this.n;
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    this.age = new Int32Array(n).fill(1e6);   // everybody respawns on the first step
    this.maxAge = new Int32Array(n);
    this.filled = new Int32Array(n);          // how many ring points are valid
    this.head = new Int32Array(n);
    this.hDir = new Float32Array(n * TRAIL * 3);
    this.hDisp = new Float32Array(n * TRAIL);
    this.hVal = new Float32Array(n * TRAIL);  // the value the colour is read from
    const segs = n * (TRAIL - 1);
    const verts = segs * 2;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    const dir = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const disp = new THREE.BufferAttribute(new Float32Array(verts), 1).setUsage(THREE.DynamicDrawUsage);
    const colour = new THREE.BufferAttribute(new Float32Array(verts * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aDir", dir);
    geometry.setAttribute("aDisp", disp);
    geometry.setAttribute("color", colour);
    if (this.geometry) this.geometry.dispose();
    this.geometry = geometry;
    if (this.mesh) this.mesh.geometry = geometry;
  }

  makeMesh() {
    const material = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthTest: false, depthWrite: false,
    });
    followRelief(material, 0, { lifted: "marker", cullFarSide: true });
    this.mesh = new THREE.LineSegments(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = "flow-particles";
    // Above the shading in the same layer, whatever band the stack gives it.
    this.mesh.userData.renderLift = 0.5;
    return this.mesh;
  }

  /** Drop particle i somewhere in the box the field answers. */
  respawn(i, stack, box, valueOf) {
    for (let tries = 0; tries < 10; tries += 1) {
      const [lat, lon] = randomPoint(box);
      const { u, v } = sampleStack(stack, lat, lon);
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
      this.lat[i] = lat; this.lon[i] = lon;
      this.age[i] = 0;
      this.maxAge[i] = 40 + Math.floor(Math.random() * 70);
      this.head[i] = 0;
      this.filled[i] = 1;
      directionInto(this.hDir, i * TRAIL * 3, lat, lon);
      this.hDisp[i * TRAIL] = heightAt(lat, lon);
      this.hVal[i * TRAIL] = valueOf(lat, lon, u, v);
      return true;
    }
    this.filled[i] = 0;
    this.age[i] = 1e6;
    return false;
  }

  step(stack, box, stepDeg, valueOf) {
    for (let i = 0; i < this.n; i += 1) {
      if (this.age[i] >= this.maxAge[i] || this.filled[i] === 0) {
        this.respawn(i, stack, box, valueOf);
        continue;
      }
      const { u, v } = sampleStack(stack, this.lat[i], this.lon[i]);
      if (!Number.isFinite(u) || !Number.isFinite(v)) { this.age[i] = 1e6; continue; }
      const [lat, lon] = advect(this.lat[i], this.lon[i], u, v, stepDeg);
      if (lat > 85 || lat < -85) { this.age[i] = 1e6; continue; }
      this.lat[i] = lat; this.lon[i] = lon;
      this.age[i] += 1;
      const h = (this.head[i] + 1) % TRAIL;
      this.head[i] = h;
      this.filled[i] = Math.min(TRAIL, this.filled[i] + 1);
      directionInto(this.hDir, (i * TRAIL + h) * 3, lat, lon);
      this.hDisp[i * TRAIL + h] = heightAt(lat, lon);
      this.hVal[i * TRAIL + h] = valueOf(lat, lon, u, v);
    }
  }

  /**
   * Write the segments, oldest to newest, alpha rising toward the head.
   *
   * Over a shaded sheet the lines are WHITE: the sheet already says the speed
   * in colour, and a coloured line on a sheet of nearly the same colour is the
   * one thing nobody can see (measured: the first cut read as a faint hatch).
   * With the shading off they carry the ramp themselves.
   */
  write(ramp, { white = false } = {}) {
    const dir = this.geometry.attributes.aDir.array;
    const disp = this.geometry.attributes.aDisp.array;
    const col = this.geometry.attributes.color.array;
    let vtx = 0;
    for (let i = 0; i < this.n; i += 1) {
      const filled = this.filled[i];
      const head = this.head[i];
      const life = Math.min(1, this.age[i] / 6, Math.max(0, this.maxAge[i] - this.age[i]) / 8);
      for (let s = 0; s < TRAIL - 1; s += 1) {
        // Segment s joins the points (TRAIL-1-s) and (TRAIL-2-s) steps back
        // from the head, and is drawn only when BOTH are from this life: the
        // older slots of a respawned particle still hold its previous life,
        // and joining them drew straight streaks across the map.
        const visible = s >= TRAIL - filled;
        for (let e = 0; e < 2; e += 1) {
          const back = (TRAIL - 1) - (s + e);          // steps back from the head
          const k = ((head - back) % TRAIL + TRAIL) % TRAIL;
          const src = i * TRAIL + (visible ? k : head);
          dir[vtx * 3] = this.hDir[src * 3];
          dir[vtx * 3 + 1] = this.hDir[src * 3 + 1];
          dir[vtx * 3 + 2] = this.hDir[src * 3 + 2];
          disp[vtx] = this.hDisp[src];
          const [r, g, b] = white ? WHITE : rampAt(ramp, this.hVal[src]);
          const along = (s + e) / (TRAIL - 1);
          col[vtx * 4] = r; col[vtx * 4 + 1] = g; col[vtx * 4 + 2] = b;
          col[vtx * 4 + 3] = visible ? Math.pow(along, 1.3) * life * 0.95 : 0;
          vtx += 1;
        }
      }
    }
    this.geometry.attributes.aDir.needsUpdate = true;
    this.geometry.attributes.aDisp.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}

/**
 * The speed (or another scalar) as a smoothly shaded sheet over a box. Vertex
 * colours on a lat/lon lattice fine enough that its chords do not sag (a
 * degree and a quarter of arc over the world), NaN left transparent.
 */
function shadingMesh(box, valueAt, ramp, alpha = 0.4) {
  const global = box.east - box.west >= 359.999;
  const cols = Math.min(320, Math.max(24, Math.round((box.east - box.west) / (global ? 1.25 : 0.25)))) + 1;
  const rows = Math.min(180, Math.max(16, Math.round((box.north - box.south) / (global ? 1.25 : 0.25)))) + 1;
  const n = cols * rows;
  const pos = new Float32Array(n * 3);
  const dir = new Float32Array(n * 3);
  const disp = new Float32Array(n);
  const col = new Float32Array(n * 4);
  for (let j = 0; j < rows; j += 1) {
    const lat = box.south + ((box.north - box.south) * j) / (rows - 1);
    for (let i = 0; i < cols; i += 1) {
      const lon = wrapLon(box.west + ((box.east - box.west) * i) / (cols - 1));
      const k = j * cols + i;
      directionInto(dir, k * 3, lat, lon);
      disp[k] = heightAt(lat, lon);
      const value = valueAt(lat, lon);
      const [r, g, b] = rampAt(ramp, value);
      col[k * 4] = r; col[k * 4 + 1] = g; col[k * 4 + 2] = b;
      col[k * 4 + 3] = Number.isFinite(value) ? alpha : 0;
    }
  }
  const index = [];
  for (let j = 0; j < rows - 1; j += 1) {
    for (let i = 0; i < cols - 1; i += 1) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
  geometry.setAttribute("aDisp", new THREE.BufferAttribute(disp, 1));
  geometry.setAttribute("color", new THREE.BufferAttribute(col, 4));
  geometry.setIndex(index);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  followRelief(material, 0, { cullFarSide: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = "flow-shading";
  return mesh;
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry?.dispose?.();
  mesh.material?.dispose?.();
}

/* ── what a source draws in, and how it is coloured ────────────────────── */

function colouring(source) {
  const def = SOURCES[source];
  const s = settings[source];
  if (source === "currents" && s.colourBy === "sst") {
    return {
      ramp: RAMPS.sst,
      valueOf: (lat, lon) => sampleScalar(live[source].stack, "sst", lat, lon),
      label: "Sea surface temperature", unit: "°C", min: RAMPS.sst[0][0], max: RAMPS.sst.at(-1)[0],
    };
  }
  return {
    ramp: def.ramp,
    valueOf: (lat, lon, u, v) => Math.hypot(u, v),
    label: source === "wind" ? `Wind speed — ${(def.levels[s.level] || {}).label || ""}` : "Current speed",
    unit: "m/s", min: def.ramp[0][0], max: def.ramp.at(-1)[0],
  };
}

function shadingChoice(source) {
  const s = settings[source];
  if (source === "hazards") return "value";
  if (source === "wind") return s.shading ? "speed" : "off";
  return s.shading;
}

function shadingValue(source, choice) {
  const state = live[source];
  /**
   * A HAZARD SHEET SHOWS THE HAZARD. Painted everywhere, a dry day is a pale
   * wash over the whole planet that hides the imagery it was meant to be read
   * against; below the first threshold its discipline warns at (`floor`, the
   * card still answers there) the sheet is left clear.
   */
  if (choice === "value") {
    const hv = HAZARD_VARS[settings.hazards.variable];
    return (lat, lon) => {
      const v = sampleScalar(state.stack, "value", lat, lon);
      if (!Number.isFinite(v) || !Number.isFinite(hv.floor)) return v;
      return (hv.below ? v > hv.floor : v < hv.floor) ? NaN : v;
    };
  }
  if (choice === "sst") return (lat, lon) => sampleScalar(state.stack, "sst", lat, lon);
  return (lat, lon) => {
    const { u, v } = sampleStack(state.stack, lat, lon);
    return Math.hypot(u, v);
  };
}

function legendFor(source) {
  if (source === "hazards") {
    const hv = HAZARD_VARS[settings.hazards.variable];
    return {
      label: `${hv.label} — next ${settings.hazards.windowHours} h (GFS)`,
      min: hv.ramp[0][0], max: hv.ramp.at(-1)[0], unit: hv.unit, palette: rampPalette(hv.ramp),
    };
  }
  const choice = shadingChoice(source);
  const c = colouring(source);
  if (choice === "sst" || (choice === "off" && c.ramp === RAMPS.sst)) {
    return { label: "Sea surface temperature", min: -2, max: 32, unit: "°C", palette: rampPalette(RAMPS.sst) };
  }
  const def = SOURCES[source];
  return {
    label: c.label, min: def.ramp[0][0], max: def.ramp.at(-1)[0], unit: "m/s",
    palette: rampPalette(def.ramp),
  };
}

function rebuildShading(source) {
  const state = live[source];
  if (!state?.group) return;
  disposeMesh(state.worldShade);
  disposeMesh(state.viewShade);
  state.worldShade = null;
  state.viewShade = null;
  const choice = shadingChoice(source);
  if (choice !== "off") {
    const ramp = choice === "sst" ? RAMPS.sst
      : choice === "value" ? HAZARD_VARS[settings.hazards.variable].ramp : SOURCES[source].ramp;
    const valueAt = shadingValue(source, choice);
    if (state.world) {
      state.worldShade = shadingMesh(WORLD, valueAt, ramp);
      state.worldShade.userData.renderLift = 0;
      state.group.add(state.worldShade);
    }
    if (state.view) {
      state.viewShade = shadingMesh(state.view, valueAt, ramp);
      state.viewShade.userData.renderLift = 0.25;
      state.group.add(state.viewShade);
    }
  }
  if (state.layer) {
    state.layer.legendInfo = legendFor(source);
    window.GeoIDLayerHierarchy?.render?.();
  }
  // A new mesh joins the stack at the layer's band.
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", { detail: { reason: "flow" } }));
}

/* ── the loop ──────────────────────────────────────────────────────────── */

function layerShown(layer) {
  let node = layer?.object3D;
  if (!node) return false;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

function spawnBox(source) {
  const state = live[source];
  const box = state.viewBox;
  if (box) return box;
  return WORLD;
}

/** Degrees of arc a 1 m/s flow moves in one frame, scaled to the view. */
function stepFor(source) {
  const box = spawnBox(source);
  const span = Math.max(0.5, Math.min(120, box.north - box.south));
  return span * SOURCES[source].stepPerMs * settings[source].speed;
}

function startLoop(source) {
  const state = live[source];
  if (!state || state.raf) return;
  const frame = () => {
    state.raf = requestAnimationFrame(frame);
    const layers = manager()?.getLayers?.() || [];
    if (!layers.includes(state.layer)) { stopSource(source, { keepLayer: true }); return; }
    if (document.hidden || !layerShown(state.layer) || !state.stack.length) return;
    state.frames = (state.frames || 0) + 1;
    if (state.frames % 30 === 1) trackView(source);
    if (!state.particles) return;   // a forecast hazard is a sheet, with nothing moving on it
    const c = colouring(source);
    state.particles.step(state.stack, spawnBox(source), stepFor(source), c.valueOf);
    // Lines over a sheet coloured by the SAME quantity are white; lines
    // coloured by something the sheet is not showing keep their colour.
    const sheet = shadingChoice(source);
    const lineQuantity = source === "currents" ? settings.currents.colourBy : "speed";
    state.particles.write(c.ramp, { white: sheet !== "off" && sheet === lineQuantity });
  };
  state.raf = requestAnimationFrame(frame);
}

/* ── the view ──────────────────────────────────────────────────────────── */

/**
 * The view's own box, or null for "the world". A box cut by the antimeridian
 * (the raycast answers min and max longitude with no wrap) or one that does
 * not contain the camera's own centre is no view box at all — the elevation
 * sheets learnt this from a stripe pinned to the seam.
 */
function currentViewBox() {
  const v = viewer();
  const box = v ? visibleBounds(v, THREE) : null;
  if (!box) return null;
  const vals = [box.minLon, box.maxLon, box.minLat, box.maxLat];
  if (!vals.every(Number.isFinite)) return null;
  if (box.maxLat - box.minLat > VIEW_REFINE_MAX) return null;
  if (box.minLon <= -179.5 || box.maxLon >= 179.5) return null;
  const centre = v.getViewCentreLatLon?.();
  if (centre && Number.isFinite(centre.lon)) {
    const lon = wrapLon(centre.lon);
    if (lon < box.minLon || lon > box.maxLon) return null;
  }
  return {
    west: Math.max(-180, box.minLon), east: Math.min(180, box.maxLon),
    south: Math.max(-80, box.minLat), north: Math.min(80, box.maxLat),
  };
}

/**
 * Follow the camera from the animation's own loop: where the particles are
 * dropped is the view NOW (cheap — a handful of rays every half second), and
 * the finer field is fetched once the view has stopped changing.
 *
 * A settle poll on the camera's position was tried first and missed moves:
 * the viewer eases its zoom for seconds after a flight, so "still" can be a
 * long time coming, and meanwhile the particles were being dropped over a box
 * the camera had left — the screen held a handful of them.
 */
function trackView(source) {
  const state = live[source];
  if (!state) return;
  const box = currentViewBox();
  const was = state.viewBox;
  state.viewBox = box;
  const moved = !boxesClose(was, box);
  if (!moved) return;
  // Particles left outside the new view are dropped back into it at once: at
  // a few frames a second their natural lifetimes take half a minute, and the
  // screen would hold only the ones that happened to be there already.
  const p = state.particles;
  if (p) {
    const inBox = box || WORLD;
    for (let i = 0; i < p.n; i += 1) {
      const lat = p.lat[i];
      const lon = wrapLon(p.lon[i]);
      const inside = lat >= inBox.south && lat <= inBox.north
        && (inBox.east - inBox.west >= 359.9 || (lon >= inBox.west && lon <= inBox.east));
      if (!inside) p.age[i] = 1e6;
    }
  }
  clearTimeout(state.refineTimer);
  state.refineTimer = setTimeout(() => { void refineView(source, box); }, 900);
}

function boxesClose(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const span = (x) => Math.max(1e-6, x.north - x.south);
  const ratio = span(a) / span(b);
  if (ratio > 1.25 || ratio < 0.8) return false;
  const dLat = Math.abs((a.north + a.south) / 2 - (b.north + b.south) / 2);
  const dLon = Math.abs(wrapLon((a.east + a.west) / 2 - (b.east + b.west) / 2));
  return dLat < span(a) * 0.15 && dLon < (a.east - a.west) * 0.15;
}

async function refineView(source, box = currentViewBox()) {
  const state = live[source];
  if (!state) return;
  if (!box) {
    if (state.view) {
      state.view = null;
      state.stack = [state.world].filter(Boolean);
      rebuildShading(source);
    }
    return;
  }
  const ticket = (state.viewTicket = (state.viewTicket || 0) + 1);
  state.viewAbort?.abort();
  const abort = new AbortController();
  state.viewAbort = abort;
  try {
    const field = await fetchField(source, box, SOURCES[source].viewBudget, abort.signal);
    if (ticket !== state.viewTicket || !live[source]) return;
    state.view = field.valid ? field : null;
    state.stack = [state.view, state.world].filter(Boolean);
    rebuildShading(source);
    say(source, describe(source));
  } catch (error) {
    if (error?.name === "AbortError") return;
    say(source, `The view's own field did not arrive (${error.message}); drawing the world's.`);
  }
}

/* ── adding and removing ───────────────────────────────────────────────── */

function describe(source) {
  const state = live[source];
  const def = SOURCES[source];
  const s = settings[source];
  if (!state?.world) return "";
  const field = state.view || state.world;
  const when = field.time ? `${field.time.replace("T", " ")} UTC` : "now";
  const spacing = (f) => {
    const dLat = (f.north - f.south) / Math.max(1, f.ny - 1);
    return `${(dLat * 111).toFixed(0)} km`;
  };
  if (source === "hazards") {
    const hv = HAZARD_VARS[s.variable];
    const span = field.time && field.until
      ? `${field.time.replace("T", " ")} to ${field.until.replace("T", " ")} UTC` : `the next ${s.windowHours} h`;
    return `${hv.label}, ${span} · samples every ~${spacing(field)}`
      + `${state.view ? " over the view" : " over the world"} · ${field.min.toFixed(1)} to `
      + `${field.max.toFixed(1)} ${hv.unit}.`;
  }
  const level = def.levels[s.level]?.label;
  const ahead = s.hoursAhead ? ` (+${s.hoursAhead} h)` : "";
  return `${level ? `${level} · ` : ""}valid ${when}${ahead} · samples every ~${spacing(field)}`
    + `${state.view ? " over the view" : " over the world"} · fastest ${field.max.toFixed(1)} m/s.`;
}

/**
 * Put a source on the globe. Answers the layer, or throws with a sentence a
 * reader can act on — the catalogue writes it beside the row.
 */
export async function addSource(source) {
  const def = SOURCES[source];
  if (!def) throw new Error(`no such flow source: ${source}`);
  if (live[source]?.layer) return live[source].layer;
  if (!manager()?.addDerivedLayer) throw new Error("the globe is not ready yet");
  say(source, source === "wind" ? "Fetching the wind over the world…"
    : source === "hazards" ? `Fetching the GFS forecast over the world…`
      : "Fetching the ocean currents over the world…");
  const abort = new AbortController();
  live[source] = { stack: [], abort };
  let world;
  try {
    world = await fetchField(source, WORLD, def.worldBudget, abort.signal);
  } catch (error) {
    delete live[source];
    if (error?.name === "AbortError") throw new Error("cancelled");
    throw new Error(`Open-Meteo did not answer (${error.message}) — check the connection and try again`);
  }
  if (!live[source]) throw new Error("cancelled");
  if (!world.valid) {
    delete live[source];
    throw new Error("the service answered with no values");
  }
  const state = live[source];
  state.world = world;
  state.stack = [world];
  const group = new THREE.Group();
  group.name = def.layerName;
  if (def.kind !== "scalar") {
    state.particles = new Particles(settings[source].particles);
    group.add(state.particles.makeMesh());
  }
  state.group = group;
  const layer = manager().addDerivedLayer(def.layerName, {
    object3D: group,
    georeferenced: true,
    bounds: { minX: -180, maxX: 180, minY: -80, maxY: 80 },
    home: def.home,
    legendInfo: legendFor(source),
    info: {
      source: def.credit,
      summary: source === "hazards"
        ? "What NOAA's GFS forecast holds over the next one to three days, one number per place: "
          + "the rain total, the strongest gust, the peak instability, the hottest and coldest it "
          + "will feel, the snow. A model's forecast on its own grid, read through Open-Meteo."
        : source === "wind"
        ? "Wind from NOAA's GFS model, read through Open-Meteo on a lattice over the world and "
          + "refined over the view. The moving lines are particles carried by the wind; the "
          + "shading is the speed. A model's forecast, not an observation."
        : "Surface currents from Météo-France's SMOC ocean model, read through Open-Meteo. The "
          + "moving lines are particles carried by the current; the shading is the speed or the "
          + "sea surface temperature. A model, not an observation.",
    },
  }, "flow");
  if (!layer) {
    delete live[source];
    throw new Error("the globe would not take the layer");
  }
  layer.metadata = {
    ...(layer.metadata || {}),
    source: def.credit,
    format: "live field (Open-Meteo JSON)",
    crs: "EPSG:4326",
  };
  layer.groundPick = false;
  state.layer = layer;
  rebuildShading(source);
  startLoop(source);
  say(source, describe(source));
  trackView(source);
  return layer;
}

function stopSource(source, { keepLayer = false } = {}) {
  const state = live[source];
  if (!state) return;
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  state.abort?.abort();
  state.viewAbort?.abort();
  clearTimeout(state.refineTimer);
  if (!keepLayer && state.layer) manager()?.removeLayer?.(state.layer.id);
  disposeMesh(state.worldShade);
  disposeMesh(state.viewShade);
  if (state.particles?.mesh) disposeMesh(state.particles.mesh);
  delete live[source];
}

export function removeSource(source) {
  stopSource(source);
  say(source, "");
}

export function layerOf(source) {
  const layer = live[source]?.layer || null;
  if (!layer) return null;
  const layers = manager()?.getLayers?.() || [];
  return layers.includes(layer) ? layer : null;
}

/** Fetch again with the current settings (a new level or hour). */
async function reload(source) {
  if (!live[source]) return;
  const state = live[source];
  say(source, "Fetching…");
  try {
    const world = await fetchField(source, WORLD, SOURCES[source].worldBudget, state.abort.signal);
    if (!live[source]) return;
    state.world = world;
    state.view = null;
    state.stack = [world];
    state.particles?.age.fill(1e6);
    rebuildShading(source);
    if (state.layer) state.layer.legendInfo = legendFor(source);
    say(source, describe(source));
    void refineView(source);
  } catch (error) {
    if (error?.name !== "AbortError") say(source, `Open-Meteo did not answer (${error.message}).`);
  }
}

/* ── the click card ────────────────────────────────────────────────────── */

/**
 * A click over a flow layer reads the field at the point — speed, direction,
 * and what that means — the way nullschool's cursor does. Claimed only where
 * the field has a value, so a click on land with the currents on still
 * reaches whatever is under it.
 */
export function probeAt(lat, lon) {
  const hz = live.hazards;
  if (hz?.layer && layerShown(hz.layer)) {
    const value = sampleScalar(hz.stack, "value", lat, lon);
    if (Number.isFinite(value)) {
      const s = settings.hazards;
      const hv = HAZARD_VARS[s.variable];
      const field = hz.view && sampleStack([hz.view], lat, lon).field ? hz.view : hz.world;
      const rows = [[hv.label, `${value.toFixed(hv.unit === "J/kg" ? 0 : 1)} ${hv.unit}`],
        ["What it means", hazardBand(s.variable, value)],
        ["Window", field?.time && field?.until
          ? `${field.time.replace("T", " ")} to ${field.until.replace("T", " ")} UTC`
          : `the next ${s.windowHours} h`],
        ["How", `${hv.op === "sum" ? "summed" : hv.op === "max" ? "the highest" : "the lowest"} over the `
          + "window's hourly forecast steps, bilinear between the lattice's nodes"]];
      window.GeoIDViewer?.showFeatureCard?.({
        source_layer: SOURCES.hazards.layerName,
        soil: true,
        type: "Forecast hazard (GFS)",
        rock_type: `${hv.label}: ${value.toFixed(hv.unit === "J/kg" ? 0 : 1)} ${hv.unit}`,
        lithology: null, name: null,
        description: hazardBand(s.variable, value),
        extra_rows: rows,
        origin: SOURCES.hazards.credit,
        rows: [["Note", "A global model's forecast on its own ~13 km grid. Convective rain and "
          + "gusts are smoothed over a grid cell, so a local downpour can be several times the "
          + "number shown; use national warnings for decisions."]],
      }, lat, wrapLon(lon));
      return true;
    }
  }
  for (const source of ["currents", "wind"]) {
    const state = live[source];
    if (!state?.layer || !layerShown(state.layer)) continue;
    const { u, v, field } = sampleStack(state.stack, lat, lon);
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    const def = SOURCES[source];
    const s = settings[source];
    const speed = Math.hypot(u, v);
    const towards = headingOf(u, v);
    const rows = [
      ["Speed", `${speed.toFixed(2)} m/s · ${(speed * 3.6).toFixed(1)} km/h · ${(speed / 0.514444).toFixed(1)} kn`],
    ];
    let title;
    if (source === "wind") {
      const from = (towards + 180) % 360;
      title = `${speed.toFixed(1)} m/s from the ${compassPoint(from)}`;
      rows.push(["Direction", `from ${from.toFixed(0)}° (${compassPoint(from)}), blowing toward ${compassPoint(towards)}`]);
      const b = beaufort(speed);
      if (b && s.level === "10m") rows.push(["Beaufort", `force ${b.number} — ${b.name}`]);
      rows.push(["Level", def.levels[s.level]?.label || s.level]);
    } else {
      title = `${speed.toFixed(2)} m/s toward the ${compassPoint(towards)}`;
      rows.push(["Direction", `toward ${towards.toFixed(0)}° (${compassPoint(towards)})`]);
      const sst = sampleScalar(state.stack, "sst", lat, lon);
      if (Number.isFinite(sst)) rows.push(["Sea surface temperature", `${sst.toFixed(1)} °C`]);
    }
    if (field?.time) rows.push(["Valid", `${field.time.replace("T", " ")} UTC${s.hoursAhead ? ` (+${s.hoursAhead} h forecast)` : ""}`]);
    rows.push(["Sampled", `${field === state.view ? "the view's own lattice" : "the world lattice"}, bilinear between nodes`]);
    window.GeoIDViewer?.showFeatureCard?.({
      source_layer: def.layerName,
      soil: true,
      type: source === "wind" ? "Wind" : "Ocean current",
      rock_type: title,
      lithology: null, name: null,
      description: source === "wind" ? "a model forecast (NOAA GFS)" : "a model (Météo-France SMOC)",
      extra_rows: rows,
      origin: def.credit,
      rows: [["Note", source === "wind"
        ? "Interpolated from the model's lattice at the time shown. A model's wind, not a "
          + "station's: gusts, sea breezes and valley winds below its resolution are not in it."
        : "Interpolated from the model's lattice at the time shown. Surface currents only — "
          + "tides near the coast and currents at depth are not in it."]],
    }, lat, wrapLon(lon));
    return true;
  }
  return false;
}

/**
 * One line for the cursor: what the field under the pointer says, without a
 * click. The hazard sheet first (it is drawn over the flow), then the
 * currents, then the wind. Null where nothing shown answers.
 */
export function readAt(lat, lon) {
  const hz = live.hazards;
  if (hz?.layer && layerShown(hz.layer)) {
    const value = sampleScalar(hz.stack, "value", lat, lon);
    if (Number.isFinite(value)) {
      const hv = HAZARD_VARS[settings.hazards.variable];
      return `${hv.label}: ${value.toFixed(hv.unit === "J/kg" ? 0 : 1)} ${hv.unit} — ${hazardBand(settings.hazards.variable, value)}`;
    }
  }
  const lines = [];
  for (const source of ["currents", "wind"]) {
    const state = live[source];
    if (!state?.layer || !layerShown(state.layer)) continue;
    const { u, v } = sampleStack(state.stack, lat, lon);
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    const speed = Math.hypot(u, v);
    const towards = headingOf(u, v);
    if (source === "wind") {
      const from = (towards + 180) % 360;
      lines.push(`Wind ${speed.toFixed(1)} m/s (${(speed * 3.6).toFixed(0)} km/h) from ${compassPoint(from)}`);
    } else {
      const sst = sampleScalar(state.stack, "sst", lat, lon);
      lines.push(`Current ${speed.toFixed(2)} m/s toward ${compassPoint(towards)}${Number.isFinite(sst) ? ` · sea ${sst.toFixed(1)} °C` : ""}`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}

/**
 * The hover readout, nullschool's cursor: a small tag beside the pointer
 * reading the field under it. Throttled, and silent while a button is down
 * (a drag is rotating the globe, not asking a question) or when nothing is
 * shown.
 */
function installHoverReadout() {
  const canvas = window.GeoIDViewer && document.querySelector("#app > canvas");
  if (!canvas || canvas.dataset.flowHover) return Boolean(canvas);
  canvas.dataset.flowHover = "1";
  const tag = document.createElement("div");
  tag.id = "flow-hover-readout";
  tag.setAttribute("role", "status");
  tag.style.cssText = "position:fixed;z-index:14;pointer-events:none;white-space:pre;"
    + "font:600 11px/1.35 'Exo 2',system-ui,sans-serif;color:#eaf6ff;"
    + "background:rgba(10,14,30,.82);border:1px solid rgba(82,228,232,.45);"
    + "border-radius:6px;padding:3px 7px;display:none";
  document.body.appendChild(tag);
  let last = 0;
  let timer = null;
  const hide = () => { tag.style.display = "none"; };
  canvas.addEventListener("pointerleave", hide);
  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons) { hide(); return; }
    if (!live.wind?.layer && !live.currents?.layer && !live.hazards?.layer) { hide(); return; }
    const run = () => {
      last = performance.now();
      const at = window.GeoIDViewer?.surfaceLatLonAt?.(event.clientX, event.clientY);
      const text = at ? readAt(at.lat, at.lon) : null;
      if (!text) { hide(); return; }
      tag.textContent = text;
      tag.style.display = "block";
      tag.style.left = `${Math.min(window.innerWidth - tag.offsetWidth - 8, event.clientX + 16)}px`;
      tag.style.top = `${Math.max(8, event.clientY - tag.offsetHeight - 10)}px`;
    };
    clearTimeout(timer);
    if (performance.now() - last > 80) run();
    else timer = setTimeout(run, 80);
  });
  return true;
}

/* ── the drawers under the rows ────────────────────────────────────────── */

const HOURS = [0, 3, 6, 12, 24, 48, 72];

function option(value, label, selected) {
  const o = document.createElement("option");
  o.value = String(value);
  o.textContent = label;
  if (selected) o.selected = true;
  return o;
}

function row(label, control) {
  const r = document.createElement("label");
  r.className = "row";
  const span = document.createElement("span");
  span.textContent = label;
  r.append(span, control);
  return r;
}

function buildHazardDrawer() {
  const id = "hazard-field-controls";
  if (byId(id)) return;
  const s = settings.hazards;
  const host = document.createElement("div");
  host.id = id;
  host.hidden = true;
  host.className = "control-stack flow-controls";
  const what = document.createElement("select");
  what.className = "input";
  Object.entries(HAZARD_VARS).forEach(([k, hv]) => what.appendChild(option(k, hv.label, k === s.variable)));
  what.addEventListener("change", () => { s.variable = what.value; void reload("hazards"); });
  host.appendChild(row("Hazard", what));
  const win = document.createElement("select");
  win.className = "input";
  [24, 48, 72].forEach((h) => win.appendChild(option(h, `Next ${h} h`, h === s.windowHours)));
  win.addEventListener("change", () => { s.windowHours = Number(win.value); void reload("hazards"); });
  host.appendChild(row("Window", win));
  const status = document.createElement("p");
  status.id = SOURCES.hazards.statusId;
  status.className = "compact-copy";
  host.appendChild(status);
  document.body.appendChild(host);
}

function buildDrawer(source) {
  const id = source === "wind" ? "wind-flow-controls" : "current-flow-controls";
  if (byId(id)) return;
  const def = SOURCES[source];
  const s = settings[source];
  const host = document.createElement("div");
  host.id = id;
  host.hidden = true;
  host.className = "control-stack flow-controls";

  if (Object.keys(def.levels).length > 1) {
    const level = document.createElement("select");
    level.className = "input";
    Object.entries(def.levels).forEach(([key, l]) => level.appendChild(option(key, l.label, key === s.level)));
    level.addEventListener("change", () => { s.level = level.value; void reload(source); });
    host.appendChild(row("Level", level));
  }
  const when = document.createElement("select");
  when.className = "input";
  HOURS.forEach((h) => when.appendChild(option(h, h ? `+${h} h forecast` : "Now", h === s.hoursAhead)));
  when.addEventListener("change", () => { s.hoursAhead = Number(when.value); void reload(source); });
  host.appendChild(row("Time", when));

  if (source === "wind") {
    const shade = document.createElement("input");
    shade.type = "checkbox";
    shade.checked = s.shading;
    shade.addEventListener("change", () => { s.shading = shade.checked; rebuildShading(source); });
    host.appendChild(row("Shade by speed", shade));
  } else {
    const shade = document.createElement("select");
    shade.className = "input";
    [["speed", "Speed"], ["sst", "Sea surface temperature"], ["off", "Off"]]
      .forEach(([k, l]) => shade.appendChild(option(k, l, k === s.shading)));
    shade.addEventListener("change", () => { s.shading = shade.value; rebuildShading(source); });
    host.appendChild(row("Shading", shade));
    const colourBy = document.createElement("select");
    colourBy.className = "input";
    [["speed", "Speed"], ["sst", "Sea surface temperature"]]
      .forEach(([k, l]) => colourBy.appendChild(option(k, l, k === s.colourBy)));
    colourBy.addEventListener("change", () => {
      s.colourBy = colourBy.value;
      if (live[source]) live[source].particles.age.fill(1e6);
    });
    host.appendChild(row("Lines coloured by", colourBy));
  }

  const count = document.createElement("input");
  count.type = "range"; count.min = "1000"; count.max = "9000"; count.step = "500";
  count.value = String(s.particles);
  count.setAttribute("aria-label", "Number of particles");
  count.addEventListener("change", () => {
    s.particles = Number(count.value);
    const state = live[source];
    if (state?.particles) state.particles.resize(s.particles);
  });
  host.appendChild(row("Particles", count));

  const pace = document.createElement("input");
  pace.type = "range"; pace.min = "0.25"; pace.max = "3"; pace.step = "0.25";
  pace.value = String(s.speed);
  pace.setAttribute("aria-label", "Animation speed");
  pace.addEventListener("input", () => { s.speed = Number(pace.value); });
  host.appendChild(row("Pace", pace));

  const status = document.createElement("p");
  status.id = def.statusId;
  status.className = "compact-copy";
  host.appendChild(status);
  document.body.appendChild(host);
}

/* ── install ───────────────────────────────────────────────────────────── */

function install() {
  if (typeof document === "undefined") return;
  buildDrawer("wind");
  buildDrawer("currents");
  buildHazardDrawer();
  {
    let tries = 0;
    const hover = () => { if (!installHoverReadout() && (tries += 1) < 80) setTimeout(hover, 500); };
    hover();
  }
  window.GeoIDFlow = {
    readAt,
    add: addSource,
    remove: removeSource,
    layerOf,
    probeAt,
    settings,
    // For a test or a console: what each source is holding.
    state: (source) => live[source] || null,
  };
  window.dispatchEvent(new CustomEvent("geoid-gis:catalogue-changed"));
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
}
