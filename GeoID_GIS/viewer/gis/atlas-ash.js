/**
 * Atlas's ash model on the page: find the volcano, fetch the wind over it for
 * the hours asked about, run `ash-plume.js`, and put the answer on the globe —
 * the deposit as it builds, hour by hour, through the one time-lapse bar — and,
 * on request, the ash in the air as a 3D model in the Model page's Results.
 *
 * Everything that decides a NUMBER lives in the pure modules (`ash-plume.js`,
 * `ash-wind.js`, `atlas-intent.js`) and is tested there; this file fetches,
 * draws and reports.
 */

import {
  simulate, depositGrid, depositExtent, concentrationGrid, ERUPTION_SIZES,
  eruptionDuration, massEruptionRate, DEPOSIT_CLASSES, depositClass, aviationClass,
  AVIATION_CLASSES, grainClasses,
} from "./ash-plume.js?v=20261024-c6848ce";
import { windRequest, profilesFrom, windSummary, compass } from "./ash-wind.js?v=20261024-c6848ce";
import { matchVolcano } from "./atlas-intent.js?v=20261024-c6848ce";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20261024-c6848ce";
import { startPlayer, stopPlayer } from "./timelapse-player.js?v=20261024-c6848ce";
import { dataUrl } from "./data-base.js?v=20261024-c6848ce";
import { vtuParts, pvdText } from "./vtk-export.js?v=20261024-c6848ce";

const LAYER = "Ash deposit — Atlas model";
const R = 6371008.8;
const RAD = Math.PI / 180;
/** The drawn height of the 3D air, ×; the true height rides along as height_m. */
export const AIR_EXAGGERATION = 10;

let volcanoList = null;
const state = { last: null, layer: null, built: null, band: null, frames: new Map() };

/** The Smithsonian catalogue as [{name, lat, lon, elevation, type, country}]. */
export async function volcanoes() {
  if (volcanoList) return volcanoList;
  try {
    const response = await fetch(await dataUrl("/data/global/volcanoes.geojson"));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const fc = await response.json();
    volcanoList = (fc.features || []).map((f) => ({
      name: f.properties?.name,
      lat: f.geometry?.coordinates?.[1],
      lon: f.geometry?.coordinates?.[0],
      elevation: Number(f.properties?.elevation_m),
      type: f.properties?.type || f.properties?.primary_type || "",
      country: f.properties?.country || "",
      lastEruption: f.properties?.last_eruption || f.properties?.Last_Eruption_Year || "",
    })).filter((v) => v.name && Number.isFinite(v.lat) && Number.isFinite(v.lon));
  } catch (error) {
    // The curated labels carry the best-known volcanoes; better a short list
    // than no list when the catalogue cannot be reached.
    const curated = window.GeoIDViewer?.curatedPlaces?.() || [];
    volcanoList = curated
      .filter((p) => /volcan/i.test(`${p.category} ${p.type || ""}`))
      .map((p) => ({ name: p.name, lat: p.lat, lon: p.lon > 180 ? p.lon - 360 : p.lon, elevation: NaN }));
  }
  return volcanoList;
}

export async function findVolcano(phrase) {
  if (!phrase) return null;
  return matchVolcano(phrase, await volcanoes());
}

function frameOf(lat0, lon0) {
  const kx = R * RAD * Math.cos(lat0 * RAD);
  const ky = R * RAD;
  return {
    toLatLon: (x, y) => [lat0 + y / ky, lon0 + x / kx],
    toXY: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
  };
}

/** Ground under a local point, from the viewer's own DEM, cached on a 2 km lattice. */
function groundSampler(frame) {
  const cache = new Map();
  const v = window.GeoIDViewer;
  return (x, y) => {
    const key = `${Math.round(x / 2000)},${Math.round(y / 2000)}`;
    let h = cache.get(key);
    if (h === undefined) {
      const [lat, lon] = frame.toLatLon(Math.round(x / 2000) * 2000, Math.round(y / 2000) * 2000);
      const got = v?.sampleElevationMeters?.(lat, ((lon % 360) + 360) % 360);
      h = Number.isFinite(got) ? Math.max(0, got) : 0;
      cache.set(key, h);
    }
    return h;
  };
}

function removeLayer() {
  const im = window.GeoIDImportManager;
  (im?.getLayers?.() || []).filter((l) => l.name === LAYER).forEach((l) => im.removeLayer?.(l.id));
  state.layer = null; state.built = null;
}

/**
 * Run an eruption.
 *
 *   volcano      {name, lat, lon, elevation}
 *   vei          1–5 (ERUPTION_SIZES)
 *   startMs      when it begins
 *   followHours  how long to follow the ash (default: the eruption plus 12 h, at most 48)
 */
export async function runAshfall({ volcano, vei = 2, startMs = Date.now(), followHours = null, onStatus = () => {} } = {}) {
  const size = ERUPTION_SIZES[Math.max(1, Math.min(5, vei))];
  const durationS = eruptionDuration(size.massKg, size.heightKm);
  const follow = Math.max(3, Math.min(72, followHours ?? Math.min(48, durationS / 3600 + 12)));
  const ventM = Number.isFinite(volcano.elevation) ? volcano.elevation : 0;
  onStatus(`Fetching the GFS wind over ${volcano.name}…`);
  const req = windRequest(volcano.lat, volcano.lon, startMs, startMs + follow * 3600e3);
  const response = await fetch(req.url);
  if (!response.ok) throw new Error(`Open-Meteo answered HTTP ${response.status}`);
  const profiles = profilesFrom(await response.json(), startMs);
  if (profiles.length < 2) throw new Error("GFS returned no usable wind profile for that time");

  onStatus(`Running the ash model (${size.label}, VEI ${size.vei})…`);
  await new Promise((r) => setTimeout(r, 0));
  const frame = frameOf(volcano.lat, volcano.lon);
  const snapshots = [];
  for (let h = 1; h <= follow; h += 1) snapshots.push(h * 3600);
  const t0 = performance.now();
  const result = simulate({
    ventM, heightKm: size.heightKm, massKg: size.massKg, profiles,
    grains: grainClasses(), snapshots, horizonS: follow * 3600,
    groundAt: groundSampler(frame),
  });
  const ms = performance.now() - t0;

  const extent = depositExtent(result, 240);
  const top = windSummary(profiles, ventM + size.heightKm * 1000 * 0.8);
  const run = {
    volcano, vei: size.vei, size, startMs, follow, profiles, result, extent, frame,
    wind: top, credit: req.historical ? "GFS archived runs via Open-Meteo" : "GFS forecast via Open-Meteo",
    computeMs: ms, mer: massEruptionRate(size.heightKm), durationS,
  };
  state.last = run;
  state.frames.clear();
  if (extent) {
    run.stats = depositStats(run, depositAt(run, Infinity));
    run.towns = await townsUnder(run, depositAt(run, Infinity));
    drawDeposit(run);
    await play(run, onStatus);
  }
  return run;
}

function depositAt(run, untilS) {
  const key = Number.isFinite(untilS) ? untilS : "all";
  if (!state.frames.has(key)) state.frames.set(key, depositGrid(run.result, run.extent, untilS));
  return state.frames.get(key);
}

/** Areas over thresholds, the deepest point, and how far the 1 mm line reaches. */
function depositStats(run, grid) {
  const { extent } = run;
  const cellKm2 = (extent.dx * extent.dy) / 1e6;
  let max = 0; let a1 = 0; let a10 = 0; let a100 = 0; let far = 0; let farBearing = 0;
  for (let j = 0; j < extent.ny; j += 1) {
    for (let i = 0; i < extent.nx; i += 1) {
      const mm = grid[j * extent.nx + i];
      if (mm > max) max = mm;
      if (mm >= 1) {
        a1 += cellKm2;
        const x = extent.x0 + (i + 0.5) * extent.dx; const y = extent.y0 + (j + 0.5) * extent.dy;
        const d = Math.hypot(x, y);
        if (d > far) { far = d; farBearing = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360; }
      }
      if (mm >= 10) a10 += cellKm2;
      if (mm >= 100) a100 += cellKm2;
    }
  }
  return { maxMm: max, km2Over1: a1, km2Over10: a10, km2Over100: a100, reach1mmKm: far / 1000, reachBearing: farBearing };
}

/** Cities and towns from the gazetteer that the deposit reaches, deepest first. */
async function townsUnder(run, grid) {
  const places = await window.GeoIDEarthPlaces?.places?.().catch(() => null);
  if (!places?.length) return [];
  const { extent, frame } = run;
  const out = [];
  for (const p of places) {
    if (p.category !== "city") continue;
    const [x, y] = frame.toXY(p.lat, p.lon > 180 ? p.lon - 360 : p.lon);
    const i = Math.floor((x - extent.x0) / extent.dx); const j = Math.floor((y - extent.y0) / extent.dy);
    if (i < 0 || j < 0 || i >= extent.nx || j >= extent.ny) continue;
    const mm = grid[j * extent.nx + i];
    if (mm >= 0.1) out.push({ name: p.name, mm, km: Math.hypot(x, y) / 1000 });
  }
  return out.sort((a, b) => b.mm - a.mm).slice(0, 8);
}

function bandFrom(run, grid) {
  const { extent } = run;
  const band = new Float32Array(extent.nx * extent.ny);
  // The deposit grid runs south to north; a raster runs north to south.
  for (let j = 0; j < extent.ny; j += 1) {
    const row = extent.ny - 1 - j;
    for (let i = 0; i < extent.nx; i += 1) {
      const mm = grid[j * extent.nx + i];
      band[row * extent.nx + i] = mm >= 0.1 ? mm : NaN;
    }
  }
  return band;
}

function boundsOf(run) {
  const { extent, frame } = run;
  const [south, west] = frame.toLatLon(extent.x0, extent.y0);
  const [north, east] = frame.toLatLon(extent.x0 + extent.nx * extent.dx, extent.y0 + extent.ny * extent.dy);
  return { minX: west, maxX: east, minY: south, maxY: north };
}

const hex = (rgb) => rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

function drawDeposit(run) {
  removeLayer();
  const { extent } = run;
  const band = bandFrom(run, depositAt(run, Infinity));
  const built = buildRasterLayer([band], extent.nx, extent.ny, boundsOf(run), { name: LAYER, isDem: false, noData: NaN });
  if (!built) return;
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(LAYER, built, "ash");
  if (!layer) return;
  window.GeoIDLayerHierarchy?.setOpacity?.(layer, 0.7);
  layer.info = {
    source: `Atlas ash model (Tephra2-type advection–diffusion) on ${run.credit}`,
    summary: `${run.volcano.name}, ${run.size.label} eruption (VEI ${run.vei}): a ${run.size.heightKm} km column, `
      + `${(run.size.massKg / 1e9).toFixed(1)} million tonnes of tephra over ${(run.durationS / 3600).toFixed(1)} h, `
      + `carried by the GFS wind over the vent. A screening model — one wind column, no aggregation — `
      + "placed downwind correctly to an order of magnitude, not a forecast.",
  };
  state.layer = layer; state.built = built; state.band = band;
  paint(run, Infinity, "after the whole run");
  // Asked for in words, so it is looked at: the import manager's own framing.
  window.GeoIDImportManager?.frameLayer?.({ georeferenced: true, bounds: boundsOf(run) });
}

function paint(run, untilS, label) {
  if (!state.built || !state.layer) return;
  const grid = depositAt(run, untilS);
  const band = bandFrom(run, grid);
  state.band.set(band);
  const counts = new Array(DEPOSIT_CLASSES.length).fill(0);
  for (const v of band) { const c = depositClass(v); if (c >= 0) counts[c] += 1; }
  try { state.built.repaint?.((v) => { const c = depositClass(v); return c >= 0 ? DEPOSIT_CLASSES[c].colour : null; }); } catch (e) { /* stands */ }
  state.layer.legendInfo = {
    classed: true, categorical: true, field: "ash_mm",
    label: `Ash on the ground, ${label} (mm, at 1,000 kg/m³)`,
    palette: DEPOSIT_CLASSES.map((c) => hex(c.colour)), labels: DEPOSIT_CLASSES.map((c) => c.label), counts,
  };
  window.GeoIDLayerHierarchy?.render?.();
}

async function play(run, onStatus) {
  const b = boundsOf(run);
  const snaps = run.result.snapshots;
  await startPlayer({
    bounds: { west: b.minX, east: b.maxX, south: b.minY, north: b.maxY },
    epochs: snaps.map((s, k) => ({
      date: new Date(run.startMs + s * 1000).toISOString().slice(0, 16),
      label: `+${Math.round(s / 3600)} h`, dataset: null, index: k,
    })),
    source: "none", interval: 700, startAt: snaps.length - 1,
    noteFor: (e) => `${run.volcano.name} · ${e.label}`,
    noteTitle: (e) => `Ash on the ground ${e.label} after the eruption began (${run.volcano.name}, VEI ${run.vei}).`,
    onStatus,
    onShow: (index) => paint(run, snaps[index], `${Math.round(snaps[index] / 3600)} h after it began`),
    onStop: () => {},
  });
}

/**
 * The ash in the air as a 3D model, one step an hour, opened in the Model
 * page's Results — the atmosphere model's road (a .pvd and its .vtu files).
 */
export async function openAsh3D({ maxSteps = 24, nx = 48, ny = 48, nz = 20 } = {}) {
  const run = state.last;
  if (!run) throw new Error("Run an eruption first.");
  const res = run.result;
  const nSnap = res.snapshots.length;
  const stride = Math.max(1, Math.ceil(nSnap / maxSteps));
  const steps = [];
  for (let k = stride - 1; k < nSnap; k += stride) steps.push(k);
  // One lattice for every step, over everywhere the airborne ash goes.
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity; let maxZ = 0;
  for (let p = 0; p < res.puffs.length; p += 1) {
    for (const k of steps) {
      const o = (p * nSnap + k) * 5;
      const x = res.snap[o];
      if (!Number.isFinite(x)) continue;
      const s = 2 * res.snap[o + 3];
      minX = Math.min(minX, x - s); maxX = Math.max(maxX, x + s);
      minY = Math.min(minY, res.snap[o + 1] - s); maxY = Math.max(maxY, res.snap[o + 1] + s);
      maxZ = Math.max(maxZ, res.snap[o + 2] + 2 * res.snap[o + 4]);
    }
  }
  if (!Number.isFinite(minX)) throw new Error("No ash is in the air at any of those hours.");
  const lattice = {
    x0: minX, y0: minY, z0: 0,
    dx: (maxX - minX) / (nx - 1), dy: (maxY - minY) / (ny - 1), dz: maxZ / (nz - 1), nx, ny, nz,
  };
  const nPts = nx * ny * nz;
  const points = new Float32Array(nPts * 3);
  const height = new Float32Array(nPts);
  for (let l = 0; l < nz; l += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
    const n = (l * ny + j) * nx + i;
    points[n * 3] = lattice.x0 + i * lattice.dx;
    points[n * 3 + 1] = lattice.y0 + j * lattice.dy;
    points[n * 3 + 2] = (lattice.z0 + l * lattice.dz) * AIR_EXAGGERATION;
    height[n] = lattice.z0 + l * lattice.dz;
  }
  const cells = hexCells(nx, ny, nz);
  const files = [];
  const entries = [];
  const base = `ash_${run.volcano.name.replace(/[^A-Za-z0-9]+/g, "_")}_vei${run.vei}`;
  let peak = 0;
  for (const k of steps) {
    const c = concentrationGrid(res, k, lattice);
    const cls = new Float32Array(nPts);
    for (let n = 0; n < nPts; n += 1) { cls[n] = aviationClass(c[n]); if (c[n] > peak) peak = c[n]; }
    const material = new Int32Array(cells.types.length);
    for (let e = 0; e < material.length; e += 1) {
      let m = 0;
      for (let q = 0; q < 8; q += 1) m = Math.max(m, cls[cells.connectivity[e * 8 + q]]);
      material[e] = m;
    }
    const hours = res.snapshots[k] / 3600;
    const { parts } = vtuParts({
      points, cells,
      pointData: [
        { name: "ash_mgm3", components: 1, values: c },
        { name: "aviation_class", components: 1, values: cls },
        { name: "height_m", components: 1, values: height },
      ],
      cellData: [{ name: "material", components: 1, values: material }],
      time: hours,
    });
    const name = `${base}_${String(Math.round(hours)).padStart(3, "0")}h.vtu`;
    files.push(new File(parts, name, { type: "application/xml" }));
    entries.push({ time: hours, file: name });
  }
  const pvd = new File([pvdText(entries)], `${base}.pvd`, { type: "application/xml" });
  const results = window.GeoIDGalesResults;
  if (!results?.openFolder) throw new Error("the Model page's Results reader is not loaded");
  window.GeoIDModeManager?.setMode?.("model");
  await results.openFolder([pvd, ...files]);
  return { steps: steps.length, peakMgM3: peak, lattice, classes: AVIATION_CLASSES };
}

function hexCells(nx, ny, nz) {
  const pidx = (i, j, k) => (k * ny + j) * nx + i;
  const nCells = (nx - 1) * (ny - 1) * (nz - 1);
  const connectivity = new Int32Array(nCells * 8);
  const offsets = new Int32Array(nCells);
  const types = new Uint8Array(nCells).fill(12);
  let cell = 0;
  for (let k = 0; k < nz - 1; k += 1) for (let j = 0; j < ny - 1; j += 1) for (let i = 0; i < nx - 1; i += 1) {
    connectivity.set([pidx(i, j, k), pidx(i + 1, j, k), pidx(i + 1, j + 1, k), pidx(i, j + 1, k),
      pidx(i, j, k + 1), pidx(i + 1, j, k + 1), pidx(i + 1, j + 1, k + 1), pidx(i, j + 1, k + 1)], cell * 8);
    offsets[cell] = (cell + 1) * 8;
    cell += 1;
  }
  return { connectivity, offsets, types };
}

/** The run in words — what Atlas says back. */
export function describeRun(run) {
  if (!run) return "";
  const s = run.stats;
  const w = run.wind;
  const when = new Date(run.startMs);
  const lines = [
    `**${run.volcano.name}, ${run.size.label} eruption (VEI ${run.vei})** from ${when.toUTCString().replace(/:00 GMT$/, " UTC")}: `
      + `a ${run.size.heightKm} km column above the vent, ${(run.size.massKg / 1e9).toFixed(1)} million tonnes of tephra `
      + `over ${(run.durationS / 3600).toFixed(1)} h (${Math.round(run.mer).toLocaleString()} kg/s, Mastin et al. 2009).`,
  ];
  if (w) lines.push(`Wind near the column top: ${w.speed.toFixed(0)} m/s toward the ${compass(w.toward)} (${run.credit}).`);
  if (s) {
    lines.push(s.km2Over1 > 0
      ? `≥ 1 mm of ash over ${Math.round(s.km2Over1).toLocaleString()} km², reaching ${s.reach1mmKm.toFixed(0)} km to the ${compass(s.reachBearing)}; `
        + `≥ 10 mm over ${Math.round(s.km2Over10).toLocaleString()} km²; thickest ${s.maxMm.toFixed(s.maxMm < 10 ? 1 : 0)} mm.`
      : `The deposit stays under 1 mm everywhere (thickest ${s.maxMm.toFixed(2)} mm).`);
  }
  if (run.towns?.length) {
    lines.push(`Under the ash: ${run.towns.slice(0, 5).map((t) => `${t.name} ${t.mm.toFixed(t.mm < 10 ? 1 : 0)} mm`).join(", ")}.`);
  }
  const air = run.result.mass;
  lines.push(`${(100 * air.airborne / air.released).toFixed(0)}% of the mass is still in the air after ${run.follow} h — the fine ash, carried far.`);
  lines.push("A screening model: one wind column over the vent, a given column height, no aggregation. Right to an order of magnitude and placed correctly downwind; not a forecast.");
  return lines.join("\n");
}

if (typeof window !== "undefined") {
  window.GeoIDAtlasAsh = {
    run: runAshfall, findVolcano, volcanoes, open3D: openAsh3D, describe: describeRun,
    last: () => state.last, stop: () => { stopPlayer(); },
  };
}
