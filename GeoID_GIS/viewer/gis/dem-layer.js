/**
 * THE STREAMED DEM, AS A LAYER YOU CAN SEE.
 *
 * It was a sampler and nothing else: it answered the cursor readout, the
 * terrain tool and the Model Builder, and it had no row in the list of what is
 * on the globe — no eye, no opacity, no place in the draw order, no legend, no
 * credit anybody could read. Asked "where is the streamed DEM, I cannot see it
 * in Basemaps", and the honest answer was that there was nothing to see.
 *
 * That is the fault the events feed was already fixed for, in the same words:
 * a thing on this globe that nobody can point at is a thing nobody can turn
 * off, fade, reorder or interrogate.
 *
 * So ticking the row builds an ORDINARY RASTER LAYER through
 * `buildRasterLayer` — the same function a dropped GeoTIFF goes through — and
 * everything downstream comes with it: the elevation ramp, the legend with its
 * own min and max in metres, the layer row, the symbology dialog, the drape on
 * the displaced surface, and the raster every terrain tool wants as an input.
 */

import { buildRasterLayer } from "./geotiff-adapter.js?v=20260904-e8726a8";
import { visibleBounds, viewChangedEnough, onViewSettled } from "./view-extent.js?v=20260904-e8726a8";
import * as dem from "./dem-tiles.js?v=20260904-e8726a8";

export const DEM_LAYER_NAME = "Elevation (streamed DEM)";

/** Nothing measured is ever this low, so it reads as "no answer here". */
const NO_DATA = -32768;

/**
 * The sheet's own grid. 1,024 x 512 over the world is about 39 km a cell —
 * coarser than the zoom-3 tiles behind it on purpose, because this is a
 * PICTURE of the heights and the sampler is what answers questions. Over a
 * small view the same grid is metres.
 */
const GRID_W = 1024;
const GRID_H = 512;

const WORLD = { west: -180, east: 180, south: -85, north: 85 };

/** The catalogue row's own figure, so the two cannot disagree. */
const DEFAULT_OPACITY = 0.7;

let three = null;
let watchStop = null;
let lastBuilt = null;
let busy = false;

export function demLayer() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((layer) => layer.name === DEM_LAYER_NAME) || null;
}

/**
 * Sample the streamed tiles onto an equirectangular grid.
 *
 * By LAT/LON, one cell at a time, rather than by copying tile pixels — which
 * is what keeps the Mercator trap out of this module entirely. The sphere's
 * UVs are linear in latitude and the tiles are not, and a pixel copy slides
 * every coastline poleward; asking the sampler where a place is cannot.
 */
function sampleGridOver(bounds, width, height) {
  const band = new Float32Array(width * height);
  let seen = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < height; j += 1) {
    // Top row is north: a raster band runs top-down.
    const lat = bounds.north - ((j + 0.5) / height) * (bounds.north - bounds.south);
    for (let i = 0; i < width; i += 1) {
      const lon = bounds.west + ((i + 0.5) / width) * (bounds.east - bounds.west);
      const v = dem.heightAt(lat, lon);
      if (Number.isFinite(v)) {
        band[(j * width) + i] = v;
        seen += 1;
        if (v < min) min = v;
        if (v > max) max = v;
      } else {
        band[(j * width) + i] = NO_DATA;
      }
    }
  }
  return { band, seen, min, max };
}

/** The ground this sheet should cover: what is in view, else the world. */
function targetBounds() {
  const viewer = window.GeoIDViewer;
  const box = viewer && three ? visibleBounds(viewer, three) : null;
  const finite = box && [box.minLon, box.minLat, box.maxLon, box.maxLat]
    .every((v) => Number.isFinite(v));
  return finite
    ? { west: box.minLon, east: box.maxLon, south: box.minLat, north: box.maxLat }
    : WORLD;
}

/**
 * Build (or rebuild) the sheet.
 *
 * The WORLD cover is fetched first and always: a global elevation layer with
 * holes in it is not a layer, it is a report of where somebody has been
 * looking. 64 tiles at zoom 3 is about 5.8 MB — a quarter of what the shipped
 * elevation texture costs — and it is asked for only because somebody ticked
 * this row, which is what makes the bill fair.
 */
async function build({ onStatus = () => {} } = {}) {
  if (busy) return { ok: false, message: "already building" };
  busy = true;
  try {
    onStatus("Streaming elevation…");
    const world = await dem.ensureWorld(3);
    if (!world.ok) {
      return { ok: false, message: "The elevation tiles could not be reached." };
    }
    const bounds = targetBounds();
    // Finer tiles where the view is looking, on top of the world cover.
    if (bounds !== WORLD) await dem.ensure(bounds, { maxTiles: 24 });
    const { band, seen, min, max } = sampleGridOver(bounds, GRID_W, GRID_H);
    if (!seen) return { ok: false, message: "No elevation was streamed for this view." };
    const result = buildRasterLayer([band], GRID_W, GRID_H, bounds, {
      name: DEM_LAYER_NAME,
      noData: NO_DATA,
      // Declared, never inferred: a height field with few distinct values in a
      // small view would otherwise be read as a classified raster and lose the
      // elevation ramp.
      isDem: true,
      unit: "m",
    });
    const previous = demLayer();
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(DEM_LAYER_NAME, result, "tiles");
    if (!layer) return { ok: false, message: "the layer could not be registered" };
    // A rebuild is a new layer object, so what the reader chose is carried
    // across -- the rule the tiled geology already documents.
    /**
     * IT OPENS PART-WAY, like every other overlay in that catalogue.
     *
     * The opening-opacity rule reads geometry and a raster is not an area, so
     * nothing fades this one automatically — and a solid elevation sheet over
     * the imagery is a second basemap rather than something to read the first
     * one against. A rebuild carries whatever the reader set instead: this
     * layer replaces itself whenever the view settles, and a default reapplied
     * on every settle would undo the slider a few seconds after it moved.
     */
    const opening = previous && Number.isFinite(previous.opacity)
      ? previous.opacity : DEFAULT_OPACITY;
    window.GeoIDLayerHierarchy?.setOpacity?.(layer, opening);
    if (previous) {
      if (previous.visible === false) window.GeoIDLayerHierarchy?.setVisible?.(layer, false);
      window.GeoIDImportManager?.removeLayer?.(previous.id);
    }
    layer.mapEntryId = "map-dem-streamed";
    layer.info = {
      source: dem.TERRARIUM.credit,
      summary: "Heights streamed as tiles and sampled onto this grid; the cursor "
        + "readout and the terrain tools read the same source.",
    };
    layer.metadata = {
      ...(layer.metadata || {}),
      source: dem.TERRARIUM.credit,
      citation: dem.TERRARIUM.credit,
      crs: "EPSG:4326",
    };
    const posts = Math.round(dem.groundMetresPerPixel(
      world.zoom, (bounds.north + bounds.south) / 2,
    ));
    window.GeoIDLayerHierarchy?.render?.();
    lastBuilt = bounds;
    const message = [
      DEM_LAYER_NAME, ": ", Math.round(min), " to ", Math.round(max), " m, about ",
      posts, " m posts where nothing finer has streamed. ", dem.TERRARIUM.credit,
    ].join("");
    onStatus(message);
    return { ok: true, layer, message };
  } catch (error) {
    return { ok: false, message: `The elevation sheet could not be drawn: ${error.message}` };
  } finally {
    busy = false;
  }
}

/**
 * Refine on REST, like every other self-rebuilding sheet here.
 *
 * Rebuilding re-samples half a million cells; doing that while the camera
 * moves would stutter the flight it is meant to serve.
 */
function watch() {
  if (watchStop) return;
  const viewer = window.GeoIDViewer;
  if (!viewer) return;
  watchStop = onViewSettled(viewer, () => {
    if (!demLayer()) return;
    const next = targetBounds();
    const asView = (b) => ({ minLon: b.west, maxLon: b.east, minLat: b.south, maxLat: b.north });
    if (lastBuilt && !viewChangedEnough(asView(lastBuilt), asView(next))) return;
    void build();
  }, { settleMs: 700, pollMs: 150 });
}

export async function addDemLayer(onStatus = () => {}) {
  if (demLayer()) return { ok: true, message: `${DEM_LAYER_NAME} is already on the globe.` };
  if (!three) three = await import("../vendor/three.module.js");
  const out = await build({ onStatus });
  if (out.ok) watch();
  return out;
}

export function removeDemLayer() {
  const layer = demLayer();
  watchStop?.();
  watchStop = null;
  lastBuilt = null;
  if (!layer) return false;
  window.GeoIDImportManager?.removeLayer?.(layer.id);
  return true;
}
