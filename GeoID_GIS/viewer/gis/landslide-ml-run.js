/**
 * The landslide forest on the globe: the baked 0.1° world (a FREE PREVIEW, not
 * part of membership, until NASA's catalogue terms are confirmed). The ~250 m
 * run below is HIDDEN -- no row, button or Atlas path reaches it -- and kept
 * for when its skill earns a place. Originally: a ~250 m run
 * over the view -- flood-ml-run.js's two tiers, with landslide-ml.js's
 * features (relief and GLiM lithology on top of the flood stack) and no
 * storm rain, because susceptibility here is where ground fails, not when.
 *
 * The fetchers are flood-ml-run.js's own, so the elevation tiles, land cover,
 * soil and rain climate reach both forests by one path.
 */

import { TIERS, makeGrid, demOnGrid, latticeOnGrid, decodeForest, predictForest }
  from "./flood-ml.js?v=20261024-82d530c";
import { buildLandslideStack, landslideRows, LS_FEATURES } from "./landslide-ml.js?v=20261024-82d530c";
import { json, loadNormal, demMosaic, landCoverClasses, soil, chooseBox, checkBox, layerNamed, replace, manager,
  MAX_SPAN_DEG } from "./flood-ml-run.js?v=20261024-82d530c";
import { dataUrl } from "./data-base.js?v=20261024-82d530c";

export const GLOBAL_NAME = "Landslide susceptibility — global (random forest).tif";
export const AREA_NAME = "Landslide susceptibility — here (random forest, 250 m).tif";
const ASSETS = "/data/global/landslide-ml/";
export { checkBox, layerNamed, MAX_SPAN_DEG };

const cache = {};
const once = (key, make) => { cache[key] ||= make().catch((e) => { delete cache[key]; throw e; }); return cache[key]; };

const loadForest = () => once("forest", async () => {
  const doc = await json(`${ASSETS}forest-fine.json`);
  if (JSON.stringify(doc.features) !== JSON.stringify(LS_FEATURES)) {
    throw new Error("the published landslide forest was trained on a different feature list than this page computes");
  }
  return decodeForest(doc);
});
const loadGlim = () => once("glim", () => json(`${ASSETS}glim-0p5.json`));

/** The fine tier over a box; resolves to GeoTIFF bytes and what was done. */
export async function runArea(box, { onProgress = () => {} } = {}) {
  const tier = TIERS.fine;
  const grid = makeGrid(box, tier.cell);
  if (grid.width * grid.height > tier.maxCells) throw new Error(`${grid.width} x ${grid.height} cells is over the page's limit`);
  onProgress(`Fetching elevation, land cover, soil and lithology for ${grid.width} × ${grid.height} cells…`);
  const [forest, normal, glim, dem, lc, soilGrid] = await Promise.all([
    loadForest(), loadNormal(), loadGlim(), demMosaic(grid, tier.zoom), landCoverClasses(grid, tier.lcPerCell), soil(grid),
  ]);
  onProgress("Building terrain features (slope, relief, HAND)…");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const { stack, mask, land, fills } = buildLandslideStack({
    grid, dem: demOnGrid(dem.mosaic, dem.plan, grid), lcClasses: lc, lcK: tier.lcPerCell, soil: soilGrid,
    rainNormal: latticeOnGrid(normal.field, normal.lattice, grid), glim,
  });
  if (!land) throw new Error("no land in this box");
  onProgress(`Running the forest on ${land.toLocaleString()} land cells…`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cells = [];
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) cells.push(i);
  const { rows, cells: kept } = landslideRows(stack, cells);
  const p = predictForest(forest, rows, LS_FEATURES.length);
  const band = new Float32Array(grid.width * grid.height).fill(NaN);
  kept.forEach((i, k) => { band[i] = p[k]; });
  const { writeGeoTiff } = await import("./geotiff-writer.js?v=20261024-82d530c");
  const bytes = writeGeoTiff({ band, width: grid.width, height: grid.height, noData: NaN,
    bounds: { minX: grid.west, maxX: grid.east, minY: grid.south, maxY: grid.north } });
  let over = 0;
  p.forEach((v) => { if (v >= (forest.threshold ?? 0.5)) over += 1; });
  return { bytes, grid, land, fills, share: kept.length ? over / kept.length : 0 };
}

export async function showArea({ onProgress = () => {} } = {}) {
  const chosen = await chooseBox();
  if (chosen.error) throw new Error(chosen.error);
  const out = await runArea(chosen.box, { onProgress });
  replace(AREA_NAME);
  const file = new File([out.bytes], AREA_NAME, { type: "image/tiff" });
  file.note = `random forest on ${chosen.label}; P(landslide), 0-1, relative`;
  await manager().importFileList([file]);
  onProgress(`${chosen.label[0].toUpperCase()}${chosen.label.slice(1)}: ${out.land.toLocaleString()} cells at 250 m, `
    + `${(out.share * 100).toFixed(1)}% over the model's threshold. Validated only where the inventories are dense `
    + "(Great Britain, North America) — see the Analysis Hub's Models tab.");
  return layerNamed(AREA_NAME);
}

export async function showGlobal({ onProgress = () => {} } = {}) {
  onProgress("Fetching the global landslide susceptibility map…");
  const response = await fetch(await dataUrl(`${ASSETS}landslide-susceptibility-0p1.hotlink-ok.tif`));
  if (!response.ok) throw new Error(`global map: HTTP ${response.status}`);
  const { loadGeoTiffLibrary } = await import("./geotiff-adapter.js?v=20261024-82d530c");
  const GeoTIFF = await loadGeoTiffLibrary();
  const image = await (await GeoTIFF.fromArrayBuffer(await response.arrayBuffer())).getImage();
  const [raw] = await image.readRasters();
  const [west, south, east, north] = image.getBoundingBox();
  const band = Float32Array.from(raw, (v) => (v === 255 ? NaN : v / 250));
  const { writeGeoTiff } = await import("./geotiff-writer.js?v=20261024-82d530c");
  const bytes = writeGeoTiff({ band, width: image.getWidth(), height: image.getHeight(), noData: NaN,
    bounds: { minX: west, maxX: east, minY: south, maxY: north } });
  replace(GLOBAL_NAME);
  const file = new File([bytes], GLOBAL_NAME, { type: "image/tiff" });
  file.note = "random forest on BGS + NASA landslide inventories, 0.1°; P(landslide), 0-1, relative";
  await manager().importFileList([file]);
  onProgress(`Global landslide susceptibility at 0.1°. Zoom under ${MAX_SPAN_DEG}° and use “Run here” for 250 m.`);
  return layerNamed(GLOBAL_NAME);
}

if (typeof window !== "undefined") {
  // Only the global map is reachable: the 250 m tier is hidden by the owner's
  // call, so runArea/showArea stay in the module and on no surface.
  window.GeoIDLandslideML = { showGlobal };
}
