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

import { buildRasterLayer } from "./geotiff-adapter.js?v=20260904-f8b0917";
import { visibleBounds, viewChangedEnough, onViewSettled } from "./view-extent.js?v=20260904-f8b0917";
import * as dem from "./dem-tiles.js?v=20260904-f8b0917";

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

/**
 * The ground this sheet should cover: what is in view, else the world.
 *
 * Pure, and separated from the viewer for exactly one reason — the rules below
 * are about a BOX and a centre, and both of the ways this went wrong are
 * expressible without a camera.
 */
export function sheetBoundsFor(box, centreLon, { wideDegrees = 20, altitudeKm = null } = {}) {
  const finite = box && [box.minLon, box.minLat, box.maxLon, box.maxLat]
    .every((v) => Number.isFinite(v));
  if (!finite) return WORLD;
  /**
   * THE WORLD SHEET IS FOR THE FAR FIELD ONLY, and this is the rule that stops
   * it tearing.
   *
   * The patch is one mesh capped at 192 x 192, so a world sheet is 1.9° a quad
   * -- about 200 km -- and a chord that wide sags roughly 900 m BELOW the
   * sphere between its corners. That is nothing from orbit and ruinous at a
   * grazing view: the sheet and the terrain interleave along the rows, which
   * is the horizontal banding reported as "gaps that fail the depth test", and
   * near the limb the sagging chords project outside the silhouette, which is
   * what reads as seeing it through the planet.
   *
   * 900 m is under a pixel above about 3,000 km (a pixel is roughly a
   * thousandth of the altitude at this field of view), so that is where the
   * world sheet is honest. Below it the sheet follows the VIEW, where the same
   * 192 x 192 is metres a quad and the sag is nothing.
   */
  const farField = !Number.isFinite(altitudeKm) || altitudeKm > 3000;
  if (!farField) {
    const width = box.maxLon - box.minLon;
    // A close view that is somehow still enormous is not a view worth
    // believing; the world is the honest answer there as well.
    if (width > 90) return WORLD;
  } else if (box.maxLon - box.minLon > wideDegrees) {
    return WORLD;
  }
  /**
   * AND A VIEW ACROSS THE ANTIMERIDIAN IS NOT THE BOX IT REPORTS.
   *
   * `visibleBounds` answers in min/max longitude with no wrap, so a view over
   * the Pacific comes back as a strip pinned to 180 — measured, 164.2 to 180
   * on a camera looking at the middle of the ocean. The sheet was then built,
   * correctly, over a sliver of ground nobody was looking at and drawn as a
   * bright stripe down the limb: reported as "the stream of the DEM tiles is
   * well off", and it was exactly that far off.
   *
   * The tell is the view CENTRE, which is always known and never wrapped
   * wrongly: a box that does not contain the point the camera is aimed at is a
   * box that has been cut at the seam.
   */
  const touchesSeam = box.maxLon >= 179.9 || box.minLon <= -179.9;
  const lon = Number.isFinite(centreLon)
    ? (centreLon > 180 ? centreLon - 360 : centreLon) : null;
  const holdsCentre = lon === null
    || (lon >= box.minLon - 1 && lon <= box.maxLon + 1);
  if (touchesSeam || !holdsCentre) return WORLD;
  return { west: box.minLon, east: box.maxLon, south: box.minLat, north: box.maxLat };
}

function targetBounds() {
  const viewer = window.GeoIDViewer;
  const box = viewer && three ? visibleBounds(viewer, three) : null;
  const metres = viewer?.getZoomAltitudeMetres?.()?.metres;
  return sheetBoundsFor(box, viewer?.getViewCentreLatLon?.()?.lon, {
    altitudeKm: Number.isFinite(metres) ? metres / 1000 : null,
  });
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
    /**
     * IN THE RASTER VOCABULARY, and this is what made the sheet float.
     *
     * `buildRasterLayer` and the patch builder under it read
     * `minX/minY/maxX/maxY`; this module works in `west/south/east/north`.
     * Handed the wrong one, every lat and lon in the patch loop came out NaN
     * and `surfacePoint(NaN, NaN)` answers with finite GARBAGE rather than
     * refusing — so the mesh was built at radii of 0.45, 1.85 and 4.05 against
     * a globe of 3.2, which is a sheet scattered up to 1,700 km off the ground.
     * Reported as "it floats well above the surface", and it did.
     *
     * The drape's own note warns about exactly this from the other side, where
     * the same mistake painted nothing at all. Fourth spelling of a box in one
     * tree, and the only defence is converting at the boundary rather than
     * hoping.
     */
    const rasterBounds = {
      minX: bounds.west, maxX: bounds.east, minY: bounds.south, maxY: bounds.north,
    };
    const result = buildRasterLayer([band], GRID_W, GRID_H, rasterBounds, {
      name: DEM_LAYER_NAME,
      noData: NO_DATA,
      // Declared, never inferred: a height field with few distinct values in a
      // small view would otherwise be read as a classified raster and lose the
      // elevation ramp.
      isDem: true,
      unit: "m",
    });
    /**
     * IT MUST NOT STAMP DEPTH IT NEVER TESTS AGAINST.
     *
     * The patch draws with `depthTest: false` on purpose -- a tessellated sheet
     * cannot win on depth against relief with detail below any grid -- and it
     * was still WRITING depth, so it filled the buffer with values from a
     * surface that had ignored the buffer, and everything drawn afterwards
     * that does test was occluded by it. A layer that opts out of the depth
     * test opts out of both halves.
     */
    result.object3D?.traverse?.((node) => {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => { if (m && m.depthTest === false) m.depthWrite = false; });
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
