/**
 * GeoID mode, wired: run the pipeline and put it on the globe.
 *
 * `geoid-pipeline.js` is the pure half — weather grid, cell table, colours,
 * clock. This is the half that touches the world: it fetches, samples the
 * layers already loaded, builds ONE draped raster, locks the view over the
 * study area and lets the simulated clock choose which step is drawn.
 *
 * One layer, not sixteen. The values are swapped in place and the texture
 * repainted, so scrubbing costs a canvas rather than sixteen meshes competing
 * for depth over the same ground.
 */

import {
  weatherPoints, weatherUrl, parseWeatherGrid, rainAt, buildCells,
  fosColour, stepForClock,
} from "./geoid-pipeline.js?v=20260830-642607c";
import { wetnessSeries, fosSeries } from "./fos.js?v=20260830-642607c";
import * as EE from "./gee-live.js?v=20260830-642607c";
import { makeRaster } from "./raster-analysis.js?v=20260830-642607c";
// The adapter is a module, not a window seam — reading it off `window` was
// a guess, and a wrong one: nothing hangs `GeoIDGeoTiff` there.
import { buildRasterLayer, loadGeoTiffFromArrayBuffer } from "./geotiff-adapter.js?v=20260830-642607c";
import { pointInPolygon, boundsOf } from "./geometry.js?v=20260830-642607c";

const STAMP = "20260816-6ce8ecd";

const state = {
  run: null,        // { dates, steps, cells, grid, layer, band }
  step: -1,
  watching: false,
};

/** The clock watcher's interval, so `stop()` can end it. */
let clockTimer = null;

// The bar is a switch, the same size as Events beside it, and it grows a body
// only while there is a run to report on. So the text and the panel that holds
// it are set together -- an empty status pane is 24px of padding and a rule
// saying nothing, and it was showing before the mode had ever been entered.
function say(text) {
  const node = document.getElementById("geoid-fos-status");
  if (node) node.textContent = text;
  const body = document.getElementById("geoid-fos-body");
  if (body) body.hidden = !text;
}

function layers() {
  return window.GeoIDImportManager?.getLayers?.() || [];
}

/** The DEM and the geology the pipeline needs, from what is already loaded. */
export function inputsFromLayers() {
  const loaded = layers().filter((l) => l.status === "loaded");
  const dem = loaded.find((l) => l.isDem && l.raster)
    || loaded.find((l) => l.raster && /dem|elevation|terrain/i.test(l.name));
  const geology = loaded.find((l) => l.features?.length && /geolog|bedrock|superficial/i.test(l.name))
    || loaded.find((l) => l.features?.length && l.sampler);
  return { dem, geology };
}

/** A description for `materialFor`, from whichever geology layer is loaded. */
function geologyReader(geology) {
  if (!geology?.sampler) return null;
  return (lat, lon) => {
    const props = geology.sampler(lat, lon);
    if (!props || typeof props !== "object") return null;
    return props.rcs_d || props.lex_rcs_d || props.lex_d || props.RCS_D || props.name || null;
  };
}

/** Values for one step, written into the layer's own band, then repainted. */
/**
 * A ramp over the RUN's own FoS range, not fixed stability bands.
 *
 * Banding was why the map looked frozen. Between two steps a cell might go
 * from 1.62 to 1.44 — a real change, a fifth of its margin — and both are
 * "stable", so the pixel never moved. The bands are the right way to READ a
 * single map and the wrong way to WATCH a sequence, and a time series has to
 * be coloured by where a value sits in the range the series actually covers.
 */
function rampColour(value, lo, hi) {
  if (!Number.isFinite(value)) return null;
  const t = hi === lo ? 0.5 : Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  // Red at the low (least safe) end through amber to blue at the safe end.
  const stops = [[215, 25, 28], [253, 141, 60], [254, 217, 118], [161, 218, 180], [44, 127, 184]];
  const at = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  const f = at - i;
  return [0, 1, 2].map((c) => Math.round(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f));
}

function drawStep(index) {
  const run = state.run;
  if (!run || index === state.step) return;
  const step = run.steps[index];
  if (!step) return;
  run.band.set(step.values);
  state.step = index;
  try {
    run.layer.repaint?.((value) => rampColour(value, run.lo, run.hi));
  } catch (error) {
    /* the layer stands with its previous colours */
  }
  const pct = (step.failingFraction * 100).toFixed(1);
  const run2 = state.run;
  say(`${step.date}: ${step.failing.toLocaleString()} of ${step.applicable.toLocaleString()} `
    + `cells below FoS 1 (${pct}%), wetness ${step.wetFraction.toFixed(2)}. `
    + `FoS here spans ${run2.lo.toFixed(2)}–${run2.hi.toFixed(2)} across `
    + `${run2.steps.length} steps of ${run2.stepHours}h on ${run2.rainTotal.toFixed(0)} mm of GFS rain.`);
  // The Hub charts the same numbers rather than computing its own.
  if (window.self !== window.top) {
    try {
      window.parent.postMessage({
        type: "geoid:fos",
        dates: run.dates,
        failing: run.steps.map((s) => s.failingFraction),
        wetness: run.steps.map((s) => s.wetFraction),
        step: index,
      }, "*");
    } catch (error) { /* a cross-origin parent cannot be told */ }
  }
}

/**
 * Advance the map through the forecast.
 *
 * This is what made the map static, and it was self-inflicted: entering GeoID
 * mode PAUSES the globe's spin — `mode-manager` does it, and `lockView` did it
 * again to hold the study area — while the simulated clock that chose the step
 * is derived from that spin. Frozen view, frozen clock, frozen map, with 384
 * steps of real GFS sitting behind it unused.
 *
 * So the mode plays its own clock when the globe's is stopped, and follows the
 * globe's when it is running. The view stays locked either way; time does not
 * have to stop for the camera to hold still.
 */
const PLAY_MS_PER_STEP = 250;      // 384 hourly steps ≈ 96 s for the fortnight

function watchClock() {
  if (state.watching) return;
  state.watching = true;
  let lastSimMs = null;
  let playFrom = Date.now();
  // Held, because leaving the mode has to be able to stop it. Without a handle
  // this timer outlived the mode: measured after pressing Exit, it was still
  // scrubbing the layer -- the step had walked from 9 to 2 with the mode off.
  clockTimer = window.setInterval(() => {
    const run = state.run;
    if (!run) return;
    const ms = window.GeoIDViewer?.getSimulatedUtcMs?.();
    const moving = Number.isFinite(ms) && ms !== lastSimMs;
    lastSimMs = ms;
    if (moving) {
      // The globe is turning: the pill and the map agree by construction.
      playFrom = Date.now() - stepForClock(ms, run.dates) * PLAY_MS_PER_STEP;
      drawStep(stepForClock(ms, run.dates));
      return;
    }
    // The globe is held for the study area, so the forecast plays itself and
    // loops — sixteen days of GFS is a sequence to watch, not a still.
    const elapsed = Date.now() - playFrom;
    drawStep(Math.floor(elapsed / PLAY_MS_PER_STEP) % run.steps.length);
  }, 200);
}

/**
 * Leaving the mode takes the run with it.
 *
 * This used to stop nothing, on the reasoning that coming back would then be
 * instant. What it actually meant was that Exit exited nothing: measured after
 * a press, `state.run` was still live, the clock timer was still scrubbing the
 * layer, the status panel still carried the last step's line, and the draped
 * FoS raster was still on the globe and in the layer box. The button said
 * Enter again and that was the only thing that had changed.
 *
 * A run is not a document. It is one frame of a 384-step forecast being played
 * by the simulated clock, so outside the mode it is a stale still of something
 * that was moving -- there is nothing to keep. What it LOADED to get there (the
 * DEM, the geology) are ordinary layers and are left alone; somebody may be
 * working with them.
 */
export function stop() {
  if (clockTimer) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
  state.watching = false;
  const layer = state.run?.layer;
  state.run = null;
  state.step = -1;
  if (layer) {
    try {
      window.GeoIDImportManager?.removeLayer?.(layer.id);
    } catch (error) {
      console.warn("[GeoID] the FoS layer could not be removed:", error.message);
    }
  }
  // Empty text folds the panel away -- see `say`. A status line describing a
  // run that no longer exists is the part that read as "it did not exit".
  say("");
}

/**
 * Lock the view over the study area.
 *
 * The globe turns with simulated time, so a fixed camera does not hold a fixed
 * PLACE — the area walks out of frame. Pausing the spin is what makes "fixed
 * view over the study area" mean what it says, and the frame call already
 * accounts for the rotation that has accumulated.
 */
export function lockView(bounds) {
  const viewer = window.GeoIDViewer;
  if (!viewer || !bounds) return false;
  viewer.setSpinPaused?.(true);
  const lat = (bounds.minY + bounds.maxY) / 2;
  const lon = (bounds.minX + bounds.maxX) / 2;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  try {
    viewer.flyTo?.({ lat, lon, spanDeg: span * 1.4 })
      || viewer.frameArea?.(bounds)
      || window.GeoIDResearch?.bridge?.frameStudyArea?.();
  } catch (error) { /* the run is still worth having without the camera move */ }
  return true;
}

/* ── the run ────────────────────────────────────────────────────────────── */

/**
 * The inputs, loaded if they are not already there.
 *
 * "Load a DEM first" was a dead end: the prototype's DEM and geology SHIP WITH
 * THE APP, at `/ni-prototype/data/`, and demanding that the user find two tick
 * boxes before the mode does anything is asking them to assemble the thing the
 * mode exists to run. GeoID mode loads its own base and says it is doing so.
 *
 * Anything already loaded wins — a user who has brought their own DEM for
 * somewhere else is not overridden by Northern Ireland.
 */
/** The prototype's own files, read straight from the site. */
const BASE = {
  dem: "/ni-prototype/data/ni_dem_100m.tif",
  geology: "/ni-prototype/data/ni_bedrock.geojson",
};

/** A lightweight geology reader: bbox test, then point-in-polygon. */
function samplerFromFeatures(features) {
  const index = (features || []).map((f) => {
    const geometry = f?.geometry;
    const polys = geometry?.type === "Polygon" ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    if (!polys.length) return null;
    const bbox = boundsOf(polys.flat().flat());
    return bbox ? { polys, bbox, properties: f.properties || {} } : null;
  }).filter(Boolean);
  return (lat, lon) => {
    for (const entry of index) {
      const b = entry.bbox;
      if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) continue;
      if (entry.polys.some((poly) => pointInPolygon([lon, lat], poly))) return entry.properties;
    }
    return null;
  };
}

/**
 * The inputs, WITHOUT waiting for the import path.
 *
 * "Load a DEM first" was a dead end, and loading the base through the layer
 * importer only moved it: that path decodes the GeoTIFF, resamples it, builds a
 * draped mesh and a texture, which is minutes of work for data the pipeline
 * needs only as NUMBERS. So the base is fetched and decoded directly — the
 * files ship with the app — and the only thing drawn is the FoS surface at the
 * end. Layers the user already has still win, and still cost nothing.
 */
async function ensureInputs(fetchImpl) {
  const found = inputsFromLayers();
  const out = { dem: null, geology: null, geologyAt: null };
  if (found.dem?.raster) out.dem = found.dem.raster;
  if (found.geology) out.geologyAt = geologyReader(found.geology);

  const f = fetchImpl || fetch;
  if (!out.dem) {
    say("Reading the Northern Ireland elevation…");
    try {
      const response = await f(BASE.dem);
      if (!response.ok) throw new Error(`${BASE.dem} answered ${response.status}`);
      const decoded = await loadGeoTiffFromArrayBuffer(await response.arrayBuffer(),
        { name: "NI elevation" });
      out.dem = decoded?.raster || null;
      if (!out.dem) throw new Error(`${BASE.dem} decoded to no raster`);
    } catch (error) {
      say(`Could not read the base elevation — ${error.message}`);
      return out;
    }
  }
  if (!out.geologyAt) {
    say("Reading the bedrock geology…");
    try {
      const response = await f(BASE.geology);
      const fc = await response.json();
      const at = samplerFromFeatures(fc.features);
      out.geologyAt = (lat, lon) => {
        const props = at(lat, lon);
        return props ? (props.rcs_d || props.lex_rcs_d || props.lex_d || null) : null;
      };
    } catch (error) {
      // Slope alone is a weaker model, not no model — say so and continue.
      say("No geology: every cell will use the default material.");
    }
  }
  return out;
}

export async function run({ fetchImpl = null, maxCells = 40000 } = {}) {
  const base = await ensureInputs(fetchImpl);
  const dem = base.dem;
  if (!dem?.band) {
    say("No elevation data — myGeoID mode takes its slopes from a DEM.");
    return { ok: false };
  }
  const viewer = window.GeoIDViewer;
  const area = viewer?.getExtractionGeometry?.("study")
    ? boundsOfGeometry(viewer.getExtractionGeometry("study"))
    : dem.bounds;

  /**
   * Earth Engine first, when it is configured.
   *
   * Same GFS, taken from the source the project asked for, over the study
   * area as a GRID rather than a handful of points. If Earth Engine is not
   * set up, or the sign-in is declined, or a request fails, the Open-Meteo
   * path still runs — a forecast the user did not have to configure beats a
   * blank map, and the status line says which one produced the numbers.
   */
  const ee = EE.settings();
  if (ee.clientId && ee.project) {
    say("Signing in to Earth Engine…");
    try {
      const eeFrames = EE.frames(new Date().toISOString(), { hours: 384, stepHours: 3 });
      const grids = [];
      for (let i = 0; i < eeFrames.length; i += 1) {
        say(`Earth Engine: GFS step ${i + 1} of ${eeFrames.length}…`);
        // eslint-disable-next-line no-await-in-loop
        grids.push(await EE.fetchStepGrid(eeFrames[i], area));
      }
      const weatherEE = {
        ok: true,
        dates: eeFrames.map((f) => f.from),
        stepHours: 3,
        series: null,
        grids,
        area,
      };
      return await computeAndDraw({ weather: weatherEE, dem, base, area, maxCells });
    } catch (error) {
      say(`Earth Engine: ${error.message} — falling back to the open GFS feed.`);
    }
  }

  say("Asking GFS for the study area…");
  const points = weatherPoints(area, { across: 4 });
  let weather;
  try {
    const f = fetchImpl || fetch;
    const response = await f(weatherUrl(points));
    if (!response.ok) throw new Error(`the forecast answered ${response.status}`);
    weather = parseWeatherGrid(await response.json(), points);
    if (!weather.ok) throw new Error(weather.message);
  } catch (error) {
    say(`No forecast: ${error.message}`);
    return { ok: false };
  }

  return computeAndDraw({ weather, dem, base, area, maxCells });
}

async function computeAndDraw({ weather, dem, base, area, maxCells }) {
  say("Reading slope and geology…");
  const table = buildCells(dem, area, { maxCells, geologyAt: base.geologyAt });
  if (!table.ok) { say(table.message); return { ok: false }; }

  say(`Computing ${weather.dates.length} steps over ${table.cells.length.toLocaleString()} cells…`);
  // Each cell carries its own rainfall history, so the wet fraction is a
  // surface too — a single catchment-wide series would make the map a
  // recolouring of the slope raster rather than a risk model.
  const stepHours = weather.stepHours || 24;
  // One reader for both sources: a grid per step from Earth Engine, or the
  // coarse point set interpolated. The pipeline below cannot tell them apart,
  // which is what makes swapping the source a one-line change rather than a
  // second pipeline.
  const rainFor = weather.grids
    ? (cell, s) => EE.sampleGrid(weather.grids[s], weather.area, cell.lat, cell.lon)
    : (cell, s) => rainAt(weather.series, cell.lat, cell.lon, s);
  const series = table.cells.map((cell) => wetnessSeries(
    weather.dates.map((_, s) => rainFor(cell, s)),
    { stepHours },
  ));
  const steps = weather.dates.map((date, s) => {
    const values = new Float32Array(table.cells.length).fill(NaN);
    let failing = 0;
    let applicable = 0;
    table.cells.forEach((cell, j) => {
      const one = fosSeries([cell], [series[j][s]], [date]);
      const v = one.ok ? one.steps[0].values[0] : NaN;
      if (!Number.isFinite(v)) return;
      values[j] = v;
      applicable += 1;
      if (v < 1) failing += 1;
    });
    return {
      date, values, applicable, failing,
      wetFraction: series.length ? series[0][s] : 0,
      failingFraction: applicable ? failing / applicable : 0,
    };
  });

  // Seed the band with the FIRST step before the layer is built.
  //
  // Built from an all-NaN band, the adapter resamples nothing, the drape gets
  // no valid vertices and the mesh is empty — a layer that exists, reports a
  // name, accepts repaints and draws NOTHING. Every later repaint then
  // recoloured geometry that was never there, which is exactly what "the map
  // is static" looks like from the outside: the old layers, unchanged, with an
  // invisible one on top.
  const band = new Float32Array(table.cells.length).fill(NaN);
  if (steps[0]?.values) band.set(steps[0].values);
  const raster = makeRaster(band, table.cols, table.rows, table.bounds, NaN);
  // The globe has to exist before a layer can join it: `addDerivedLayer`
  // returns null when the scene is not up, and the run is fast enough now to
  // finish before the viewer has booted — which read as "the FoS layer could
  // not be drawn" when in fact the arithmetic was already done.
  for (let i = 0; i < 120 && !Number.isFinite(
    window.GeoIDViewer?.getViewCentreLatLon?.()?.lat); i += 1) {
    say("Waiting for the globe…");
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const built = buildRasterLayer(
    [band], table.cols, table.rows, table.bounds, { name: "GeoID FoS", isDem: false },
  );
  const layer = built
    ? window.GeoIDImportManager?.addDerivedLayer?.("GeoID FoS", built, "fos")
    : null;
  if (!layer) { say("The FoS layer could not be drawn."); return { ok: false }; }
  layer.raster = raster;

  let lo = Infinity;
  let hi = -Infinity;
  steps.forEach((st) => st.values.forEach((v) => {
    if (!Number.isFinite(v)) return;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }));
  // A percentile rather than the extremes: one improbable cell at FoS 40 would
  // otherwise compress every real value into the first pixel of the ramp.
  const sorted = steps[0].values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length > 20) {
    lo = Math.min(lo, sorted[Math.floor(sorted.length * 0.02)]);
    hi = sorted[Math.floor(sorted.length * 0.98)];
  }
  const spread = steps.map((st) => st.failingFraction);
  const moved = Math.max(...spread) - Math.min(...spread);
  const rainTotal = weather.series.reduce((sum, ser) =>
    sum + ser.rain.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0), 0) / weather.series.length;
  state.run = {
    dates: weather.dates, steps, cells: table.cells, layer, band, moved, rainTotal, lo, hi,
    stepHours: weather.stepHours || 24,
  };
  state.step = -1;
  lockView(table.bounds);
  watchClock();
  drawStep(stepForClock(window.GeoIDViewer?.getSimulatedUtcMs?.() || Date.now(), weather.dates));
  return { ok: true, steps: steps.length, cells: table.cells.length };
}

function boundsOfGeometry(geometry) {
  const vs = geometry?.vertices || [];
  if (!vs.length) return null;
  const lons = vs.map((v) => (v.lon > 180 ? v.lon - 360 : v.lon));
  const lats = vs.map((v) => v.lat);
  return {
    minX: Math.min(...lons), maxX: Math.max(...lons),
    minY: Math.min(...lats), maxY: Math.max(...lats),
  };
}

/**
 * Entering myGeoID mode runs the pipeline; leaving it puts the run away.
 *
 * There was a Run button, which made the mode a thing you enter and then have
 * to remember to start — two steps for one intention, and a mode that does
 * nothing on its own is not a mode. Arming is the trigger. Disarming is the
 * other half of that bargain and used to be missing: see `stop`.
 */
export function init() {
  const armed = () => document.body.dataset.hubArmed === "true";
  let was = armed();
  let running = false;
  setInterval(() => {
    const now = armed();
    if (now && !was && !running && !state.run) {
      running = true;
      void run().finally(() => { running = false; });
    }
    if (!now && was) stop();
    was = now;
  }, 400);
  // Already in the mode when this module loads — the same intention.
  if (armed() && !state.run) void run();
}

if (typeof window !== "undefined") {
  window.GeoIDMode = { run, stop, init, inputsFromLayers, lockView, current: () => state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
