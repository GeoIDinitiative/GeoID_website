/**
 * The flood forest on the globe: the global 0.1° map, and a ~250 m run over
 * the ground you are looking at.
 *
 * RESOLUTION FOLLOWS ZOOM, the way the GFS and ECMWF layers fetch a coarser
 * field for a wider view. Two tiers rather than a continuum, because a forest
 * answers only for the scale it was trained at:
 *
 *   wider than 1.5°   the baked global map (bake-flood-global.py), one
 *                     0.1° GeoTIFF from the bucket
 *   1.5° or less      this module fetches the inputs for the view (or a drawn
 *                     area), builds the features with flood-ml.js -- the same
 *                     code the bake trained on -- and runs the exported fine
 *                     forest here, on today's Open-Meteo rain
 *
 * Both results go onto the globe through the import manager, as a GeoTIFF,
 * like a dropped file: clip, sample, chart and export work on them unchanged,
 * and the risk reader reads them as it reads any hazard grid.
 */

import {
  TIERS, FEATURES, makeGrid, tilesFor, decodeTile, demOnGrid, buildStack, landCoverUrl, soilOnGrid,
  latticeOnGrid, featureRows, decodeForest, predictForest, wettest3, TERRARIUM_URL,
} from "./flood-ml.js?v=20261024-b79e0cb";
import { dataUrl } from "./data-base.js?v=20261024-b79e0cb";

export const GLOBAL_NAME = "Flood susceptibility — global (random forest).tif";
export const AREA_NAME = "Flood susceptibility — here (random forest, 250 m).tif";
/** The widest box the fine tier runs over: 600 x 600 cells at 0.0025°. */
export const MAX_SPAN_DEG = 1.5;
const ASSETS = "/data/global/flood-ml/";

const cache = {};
const once = (key, make) => { cache[key] ||= make().catch((e) => { delete cache[key]; throw e; }); return cache[key]; };

export async function json(path) {
  const response = await fetch(await dataUrl(path));
  if (!response.ok) throw new Error(`${path.split("/").pop()}: HTTP ${response.status}`);
  return response.json();
}

const loadForest = () => once("forest", async () => {
  const doc = await json(`${ASSETS}forest-fine.json`);
  if (JSON.stringify(doc.features) !== JSON.stringify(FEATURES)) {
    throw new Error("the published forest was trained on a different feature list than this page computes");
  }
  return decodeForest(doc);
});

export const loadNormal = () => once("normal", async () => {
  const doc = await json(`${ASSETS}rain-normal-cpc.json`);
  return { field: Float32Array.from(doc.values, (v) => (v == null ? NaN : v)), lattice: doc.lattice };
});

/* ── the box ────────────────────────────────────────────────────────────── */

/**
 * The ground to run over: the last drawn study area if one is shown, else
 * the view. `{ box, label }`, or `{ error }` when there is no ground or it is
 * too wide for the fine tier.
 */
export async function chooseBox() {
  let box = null;
  let label = "the view";
  try {
    const reader = await import("./risk-reader.js?v=20261024-b79e0cb");
    const areas = reader.studyAreas?.() || [];
    if (areas.length) { box = areas[areas.length - 1].box; label = areas[areas.length - 1].name; }
  } catch { /* no reader: the view will do */ }
  if (!box) {
    const viewer = window.GeoIDViewer;
    const three = await import("../vendor/three.module.js");
    const { visibleBounds } = await import("./view-extent.js?v=20261024-b79e0cb");
    const v = viewer ? visibleBounds(viewer, three) : null;
    if (v && [v.minLon, v.maxLon, v.minLat, v.maxLat].every(Number.isFinite)) {
      box = { west: v.minLon, east: v.maxLon, south: v.minLat, north: v.maxLat };
    }
  }
  return checkBox(box, label);
}

/** Pure: is this box one the fine tier will run over? */
export function checkBox(box, label = "the view") {
  if (!box || ![box.west, box.east, box.south, box.north].every(Number.isFinite)) {
    return { error: "No ground to run over: look at the globe or draw a study area." };
  }
  const span = Math.max(box.east - box.west, box.north - box.south);
  if (span > MAX_SPAN_DEG) {
    return { error: `${label === "the view" ? "The view" : label} is ${span.toFixed(1)}° across; the 250 m model runs `
      + `over ${MAX_SPAN_DEG}° or less. Zoom in or draw a smaller area — the global layer covers wider views.` };
  }
  if (box.south < -60 || box.north > 84) return { error: "The model covers 60°S to 84°N (the soil and DEM inputs stop there)." };
  return { box, label };
}

/* ── inputs, fetched as the bake fetches them ───────────────────────────── */

async function tileHeights(z, x, y) {
  const url = TERRARIUM_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`elevation tile ${z}/${x}/${y}: HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return decodeTile(ctx.getImageData(0, 0, 256, 256).data, 4);
}

export async function demMosaic(grid, zoom) {
  const plan = tilesFor(grid, zoom);
  const mw = plan.cols * 256;
  const mosaic = new Float32Array(mw * plan.rows * 256);
  const jobs = [];
  for (let ty = plan.y0; ty <= plan.y1; ty += 1) {
    for (let tx = plan.x0; tx <= plan.x1; tx += 1) {
      jobs.push(tileHeights(zoom, tx, ty).then((h) => {
        const ox = (tx - plan.x0) * 256; const oy = (ty - plan.y0) * 256;
        for (let r = 0; r < 256; r += 1) mosaic.set(h.subarray(r * 256, r * 256 + 256), (oy + r) * mw + ox);
      }));
    }
  }
  await Promise.all(jobs);
  return { mosaic, plan };
}

export async function landCoverClasses(grid, k) {
  const response = await fetch(landCoverUrl(grid, k));
  if (!response.ok) throw new Error(`land cover: HTTP ${response.status}`);
  const { loadGeoTiffLibrary } = await import("./geotiff-adapter.js?v=20261024-b79e0cb");
  const GeoTIFF = await loadGeoTiffLibrary();
  const tiff = await GeoTIFF.fromArrayBuffer(await response.arrayBuffer());
  const [band] = await (await tiff.getImage()).readRasters();
  return band instanceof Uint8Array ? band : Uint8Array.from(band);
}

export async function soil(grid) {
  const mod = await import("./soil-thickness.js?v=20261024-b79e0cb");
  const win = await mod.thicknessGridFor({ west: grid.west, east: grid.east, south: grid.south, north: grid.north });
  if (!win?.native) return new Float32Array(grid.width * grid.height).fill(NaN);
  return soilOnGrid(win, grid);
}

/**
 * Today's rain on CPC's 0.5° lattice (the lattice the forest's event rain was
 * read from), from Open-Meteo: the 30 days before today and the wettest 3 of
 * the next 7 -- the bake's definitions, `wettest3` and all.
 */
export async function liveRain(grid) {
  const i0 = Math.max(0, Math.floor((89.75 - grid.north) / 0.5) - 1);
  const i1 = Math.min(359, Math.ceil((89.75 - grid.south) / 0.5) + 1);
  const lonIdx = (lon) => (lon + 179.75) / 0.5;
  const j0 = Math.max(0, Math.floor(lonIdx(grid.west)) - 1);
  const j1 = Math.min(719, Math.ceil(lonIdx(grid.east)) + 1);
  const lats = []; const lons = [];
  for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) { lats.push(89.75 - 0.5 * i); lons.push(-179.75 + 0.5 * j); }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}`
    + "&daily=precipitation_sum&past_days=30&forecast_days=7&timezone=UTC";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo: HTTP ${response.status}`);
  const rows = await response.json();
  const list = Array.isArray(rows) ? rows : [rows];
  const today = new Date().toISOString().slice(0, 10);
  const r3 = new Float32Array(list.length); const a30 = new Float32Array(list.length);
  list.forEach((row, k) => {
    const t = row.daily.time; const p = row.daily.precipitation_sum;
    const past = []; const ahead = [];
    t.forEach((d, n) => (d < today ? past : ahead).push(p[n] == null ? NaN : p[n]));
    a30[k] = past.slice(-30).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
    r3[k] = wettest3(ahead);
  });
  const lattice = { nLat: i1 - i0 + 1, nLon: j1 - j0 + 1, lat0: 89.75 - 0.5 * i0, lon0: -179.75 + 0.5 * j0, dLat: -0.5, dLon: 0.5 };
  return { r3: latticeOnGrid(r3, lattice, grid), a30: latticeOnGrid(a30, lattice, grid),
    window: `${list[0].daily.time[0]}..${list[0].daily.time.at(-1)}` };
}

/* ── the runs ───────────────────────────────────────────────────────────── */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The fine tier over a box; resolves to GeoTIFF bytes and what was done. */
export async function runArea(box, { onProgress = () => {} } = {}) {
  const tier = TIERS.fine;
  const grid = makeGrid(box, tier.cell);
  if (grid.width * grid.height > tier.maxCells) throw new Error(`${grid.width} x ${grid.height} cells is over the ${tier.maxCells.toLocaleString()} the page runs`);
  onProgress(`Fetching elevation, land cover, soil and rain for ${grid.width} × ${grid.height} cells…`);
  const [forest, normal, dem, lc, soilGrid, rain] = await Promise.all([
    loadForest(), loadNormal(), demMosaic(grid, tier.zoom), landCoverClasses(grid, tier.lcPerCell), soil(grid), liveRain(grid),
  ]);
  onProgress("Building terrain features (fill, flow, HAND)…");
  await tick();
  const { stack, mask, land, fills } = buildStack({
    grid, dem: demOnGrid(dem.mosaic, dem.plan, grid), lcClasses: lc, lcK: tier.lcPerCell, soil: soilGrid,
    rainNormal: latticeOnGrid(normal.field, normal.lattice, grid), rain3: rain.r3, rain30: rain.a30,
  });
  if (!land) throw new Error("no land in this box");
  onProgress(`Running the forest on ${land.toLocaleString()} land cells…`);
  await tick();
  const cells = [];
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) cells.push(i);
  const { rows, cells: kept } = featureRows(stack, cells);
  const p = predictForest(forest, rows);
  const band = new Float32Array(grid.width * grid.height).fill(NaN);
  kept.forEach((i, k) => { band[i] = p[k]; });
  const { writeGeoTiff } = await import("./geotiff-writer.js?v=20261024-b79e0cb");
  const bytes = writeGeoTiff({ band, width: grid.width, height: grid.height, noData: NaN,
    bounds: { minX: grid.west, maxX: grid.east, minY: grid.south, maxY: grid.north } });
  let over = 0;
  p.forEach((v) => { if (v >= (forest.threshold ?? 0.5)) over += 1; });
  return { bytes, grid, land, fills, rainWindow: rain.window, share: kept.length ? over / kept.length : 0 };
}

export function manager() {
  const m = window.GeoIDImportManager;
  if (!m?.importFileList) throw new Error("the import manager is not ready");
  return m;
}

export function layerNamed(name) {
  return (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === name) || null;
}

export function replace(name) {
  const old = layerNamed(name);
  if (old) window.GeoIDImportManager.removeLayer?.(old.id);
}

/** Run over the chosen box and put the result on the globe. */
export async function showArea({ onProgress = () => {} } = {}) {
  const chosen = await chooseBox();
  if (chosen.error) throw new Error(chosen.error);
  const out = await runArea(chosen.box, { onProgress });
  replace(AREA_NAME);
  const file = new File([out.bytes], AREA_NAME, { type: "image/tiff" });
  file.note = `random forest on ${chosen.label}, rain ${out.rainWindow} (Open-Meteo); P(flooded), 0-1`;
  await manager().importFileList([file]);
  onProgress(`${chosen.label[0].toUpperCase()}${chosen.label.slice(1)}: ${out.land.toLocaleString()} cells at 250 m, `
    + `${(out.share * 100).toFixed(1)}% over the model's threshold on this week's rain. Validation by region is in the `
    + "Analysis Hub's Models tab.");
  return layerNamed(AREA_NAME);
}

/**
 * The global map: a byte per cell in the bucket (P x 250, 255 = no data), put
 * back to a probability here so the layer's values and legend read 0-1.
 */
export async function showGlobal({ onProgress = () => {} } = {}) {
  onProgress("Fetching the global flood susceptibility map…");
  const response = await fetch(await dataUrl(`${ASSETS}flood-susceptibility-0p1.hotlink-ok.tif`));
  if (!response.ok) throw new Error(`global map: HTTP ${response.status}`);
  const { loadGeoTiffLibrary } = await import("./geotiff-adapter.js?v=20261024-b79e0cb");
  const GeoTIFF = await loadGeoTiffLibrary();
  const image = await (await GeoTIFF.fromArrayBuffer(await response.arrayBuffer())).getImage();
  const [raw] = await image.readRasters();
  const [west, south, east, north] = image.getBoundingBox();
  const band = Float32Array.from(raw, (v) => (v === 255 ? NaN : v / 250));
  const { writeGeoTiff } = await import("./geotiff-writer.js?v=20261024-b79e0cb");
  const bytes = writeGeoTiff({ band, width: image.getWidth(), height: image.getHeight(), noData: NaN,
    bounds: { minX: west, maxX: east, minY: south, maxY: north } });
  replace(GLOBAL_NAME);
  const file = new File([bytes], GLOBAL_NAME, { type: "image/tiff" });
  file.note = "random forest trained on the Global Flood Database, 0.1°; P(flooded), 0-1";
  await manager().importFileList([file]);
  let asOf = "";
  try { asOf = (await json(`${ASSETS}current.json`)).as_of; } catch { /* the map stands without its date */ }
  onProgress(`Global flood susceptibility at 0.1°${asOf ? `, rain as of ${asOf}` : ""}. Zoom under ${MAX_SPAN_DEG}° `
    + "and use “Run here” for 250 m.");
  return layerNamed(GLOBAL_NAME);
}

if (typeof window !== "undefined") {
  window.GeoIDFloodML = { showGlobal, showArea, chooseBox, checkBox, runArea, MAX_SPAN_DEG };
}
