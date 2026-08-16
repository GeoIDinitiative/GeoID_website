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
} from "./geoid-pipeline.js?v=20260816-6ce8ecd";
import { wetnessSeries, fosSeries } from "./fos.js?v=20260816-6ce8ecd";
import { makeRaster } from "./raster-analysis.js?v=20260816-6ce8ecd";
// The adapter is a module, not a window seam — reading it off `window` was
// a guess, and a wrong one: nothing hangs `GeoIDGeoTiff` there.
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260816-6ce8ecd";

const state = {
  run: null,        // { dates, steps, cells, grid, layer, band }
  step: -1,
  watching: false,
};

function say(text) {
  const node = document.getElementById("geoid-fos-status");
  if (node) node.textContent = text;
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
function drawStep(index) {
  const run = state.run;
  if (!run || index === state.step) return;
  const step = run.steps[index];
  if (!step) return;
  run.band.set(step.values);
  state.step = index;
  try {
    run.layer.repaint?.((value) => fosColour(value));
  } catch (error) {
    /* the layer stands with its previous colours */
  }
  const pct = (step.failingFraction * 100).toFixed(1);
  say(`${step.date}: ${step.failing.toLocaleString()} of ${step.applicable.toLocaleString()} `
    + `cells below FoS 1 (${pct}%), wetness ${step.wetFraction.toFixed(2)}.`);
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

/** Follow the simulated clock: the pill scrubs the map by construction. */
function watchClock() {
  if (state.watching) return;
  state.watching = true;
  setInterval(() => {
    if (!state.run) return;
    const ms = window.GeoIDViewer?.getSimulatedUtcMs?.();
    if (!Number.isFinite(ms)) return;
    drawStep(stepForClock(ms, state.run.dates));
  }, 700);
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

export async function run({ fetchImpl = null, maxCells = 40000 } = {}) {
  const { dem, geology } = inputsFromLayers();
  if (!dem?.raster) {
    say("Load a DEM for the study area first — GeoID mode takes its slopes from it.");
    return { ok: false };
  }
  const viewer = window.GeoIDViewer;
  const area = viewer?.getExtractionGeometry?.("study")
    ? boundsOfGeometry(viewer.getExtractionGeometry("study"))
    : dem.bounds;

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

  say("Reading slope and geology…");
  const table = buildCells(dem.raster, area, { maxCells, geologyAt: geologyReader(geology) });
  if (!table.ok) { say(table.message); return { ok: false }; }

  say(`Computing ${weather.dates.length} steps over ${table.cells.length.toLocaleString()} cells…`);
  // Each cell carries its own rainfall history, so the wet fraction is a
  // surface too — a single catchment-wide series would make the map a
  // recolouring of the slope raster rather than a risk model.
  const series = table.cells.map((cell) => wetnessSeries(
    weather.dates.map((_, s) => rainAt(weather.series, cell.lat, cell.lon, s)),
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

  const band = new Float32Array(table.cells.length).fill(NaN);
  const raster = makeRaster(band, table.cols, table.rows, table.bounds, NaN);
  const built = buildRasterLayer(
    [band], table.cols, table.rows, table.bounds, { name: "GeoID FoS", isDem: false },
  );
  const layer = built
    ? window.GeoIDImportManager?.addDerivedLayer?.("GeoID FoS", built, "fos")
    : null;
  if (!layer) { say("The FoS layer could not be drawn."); return { ok: false }; }
  layer.raster = raster;

  state.run = { dates: weather.dates, steps, cells: table.cells, layer, band };
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

export function init() {
  document.getElementById("geoid-fos-run")?.addEventListener("click", () => { void run(); });
}

if (typeof window !== "undefined") {
  window.GeoIDMode = { run, init, inputsFromLayers, lockView, current: () => state };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
