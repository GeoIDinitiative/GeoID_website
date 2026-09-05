/**
 * SOIL AND SEDIMENT THICKNESS, read straight out of a COG.
 *
 * Pelletier et al. (2016): the modelled thickness of the permeable layers
 * above bedrock — soil, regolith and sedimentary deposits — on a 30-arcsecond
 * grid, 0 to 50 m, clipped at 60°S. The one number a Factor-of-Safety pass
 * wants for "how much is there to move", and the companion to the slope map
 * beside it.
 *
 * NO BAKE, AND NO PYRAMID. Everything else global in this tree is cut into
 * tiles because it arrives as vectors, or as something a browser cannot
 * window. This arrives as ONE Cloud-Optimised GeoTIFF with seven internal
 * overviews, the bucket answers byte ranges, and the vendored geotiff.js reads
 * a window at the overview level a view deserves — so the work a bake would
 * have done is already in the file, done by the people who published it.
 * Measured: 99 MB in the bucket, of which a view reads a few hundred kB.
 *
 * WHAT IT IS NOT is a measurement of any particular hillside. It is a model,
 * calibrated against soil thickness in the US and Europe and against
 * depth-to-bedrock from US groundwater wells, and the file drawn here is a
 * weighted mosaic of the hillslope and valley-bottom grids — weighted by area
 * AND topographic wetness index, because all the water leaves through the
 * valley bottoms whatever fraction of the ground they are. The card says so.
 */

import { buildRasterLayer, loadGeoTiffLibrary } from "./geotiff-adapter.js?v=20260905-e7d5e68";
import { visibleBounds, viewChangedEnough, onViewSettled } from "./view-extent.js?v=20260905-e7d5e68";
import { dataUrl } from "./data-base.js?v=20260905-e7d5e68";
import { cellAt, thicknessCard, waitingCard } from "./thickness-probe.js?v=20260905-e7d5e68";
import { mathsFor } from "./equations.js?v=20260905-e7d5e68";

export const LAYER_NAME = "Soil and sediment thickness (Pelletier)";

/** The tracked sidecar: the credit and the range, read before any fetch. */
const META_PATH = "/data/global/soil-thickness/meta.json";

/** One read is one texture; past this the picture is finer than the screen. */
const MAX_SPAN = 1600;

/** It draws under the data and over the imagery, like every context sheet. */
const DEFAULT_OPACITY = 0.75;

let three = null;
let meta = null;
let image = null;
let watchStop = null;
let lastBuilt = null;
let busy = false;

export function thicknessLayer() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((layer) => layer.name === LAYER_NAME) || null;
}

async function loadMeta() {
  if (meta) return meta;
  const stamp = new URL(import.meta.url).search;
  meta = await (await fetch(`${META_PATH}${stamp}`)).json();
  return meta;
}

/**
 * The file, opened once.
 *
 * `fromUrl` reads the header and the overview directory and nothing else —
 * about sixteen kilobytes — so opening it costs nothing until a window is
 * asked for. The URL goes through `dataUrl`, which appends the content
 * fingerprint: the bucket serves this immutable for a year, and a re-bake at a
 * bare URL would be invisible for all of it.
 */
async function open() {
  if (image) return image;
  const info = await loadMeta();
  // Through the adapter's own loader: the vendored build is a UMD bundle that
  // attaches to `window.GeoTIFF` and exports nothing as a module.
  const GeoTIFF = await loadGeoTiffLibrary();
  const tiff = await GeoTIFF.fromUrl(await dataUrl(`/data/global/${info.file}`));
  image = await tiff.getImage();
  return image;
}

/** The ground a sheet should cover: the view, or the whole grid. */
function targetBounds(info) {
  const viewer = window.GeoIDViewer;
  const box = viewer && three ? visibleBounds(viewer, three) : null;
  const world = {
    west: info.bounds.west, east: info.bounds.east,
    south: info.bounds.south, north: info.bounds.north,
  };
  const finite = box && [box.minLon, box.minLat, box.maxLon, box.maxLat]
    .every((v) => Number.isFinite(v));
  if (!finite) return world;
  /**
   * Wide, cut at the seam, or aimed somewhere the box does not contain: the
   * whole grid. The same three refusals `dem-layer` makes, for the same
   * reasons — a view across the antimeridian comes back as a strip pinned to
   * 180, which draws a stripe on ground nobody is looking at.
   */
  if (box.maxLon - box.minLon > 90) return world;
  if (box.maxLon >= 179.9 || box.minLon <= -179.9) return world;
  return {
    west: Math.max(world.west, box.minLon),
    east: Math.min(world.east, box.maxLon),
    south: Math.max(world.south, box.minLat),
    north: Math.min(world.north, box.maxLat),
  };
}

/**
 * Read the window, at a size the screen can actually show.
 *
 * `readRasters` takes the window in FULL-RESOLUTION pixels and the size it
 * should come back at; geotiff.js then picks the overview itself and reads
 * only the byte ranges that window covers. Asking for more than the screen can
 * show is bytes nobody sees.
 */
async function readWindow(bounds) {
  const img = await open();
  const info = meta;
  const [gw, gh] = info.grid;
  const px = (lon) => ((lon - info.bounds.west) / (info.bounds.east - info.bounds.west)) * gw;
  const py = (lat) => ((info.bounds.north - lat) / (info.bounds.north - info.bounds.south)) * gh;
  const x0 = Math.max(0, Math.floor(px(bounds.west)));
  const x1 = Math.min(gw, Math.ceil(px(bounds.east)));
  const y0 = Math.max(0, Math.floor(py(bounds.north)));
  const y1 = Math.min(gh, Math.ceil(py(bounds.south)));
  if (x1 <= x0 || y1 <= y0) return null;
  const width = Math.max(64, Math.min(MAX_SPAN, x1 - x0));
  const height = Math.max(32, Math.round(width * ((y1 - y0) / (x1 - x0))));
  const [band] = await img.readRasters({
    window: [x0, y0, x1, y1], width, height, fillValue: info.noData,
  });
  /**
   * THE BOUNDS OF THE PIXELS ACTUALLY READ, not the bounds that were asked
   * for. This is what put the layer off the coast.
   *
   * The window is snapped OUT to whole source pixels — `floor` on the west and
   * north, `ceil` on the east and south — so the image that comes back covers
   * up to one source pixel more than the request on every side. Labelling it
   * with the request stretches that image onto slightly the wrong ground: a
   * fixed error of up to 30 arcseconds, which is **930 m at the equator**.
   * Invisible from orbit and the whole story at a fjord, where it reads as the
   * map sliding off the shoreline as you come down.
   */
  const lon = (x) => info.bounds.west + (x / gw) * (info.bounds.east - info.bounds.west);
  const lat = (y) => info.bounds.north - (y / gh) * (info.bounds.north - info.bounds.south);
  return {
    band,
    width,
    height,
    bounds: { west: lon(x0), east: lon(x1), north: lat(y0), south: lat(y1) },
  };
}

/* ── the click ──────────────────────────────────────────────────────────── */

/**
 * The value at a point, from the FILE.
 *
 * A one-pixel window at full resolution. It costs one byte range — the COG is
 * tiled, so the read touches the single tile that pixel is in, and geotiff.js
 * keeps it, which is what makes clicking around a hillside free after the
 * first click.
 *
 * Deliberately NOT read out of the drawn sheet. That image is resampled to at
 * most 1,600 px across the view: at a wide view one of its pixels is dozens of
 * source cells and its colour is their blend, so the picture cannot answer a
 * question about a point without inventing a value for it.
 */
export async function sampleAt(lat, lon) {
  const info = await loadMeta();
  const cell = cellAt(lat, lon, info);
  if (!cell) return null;
  if (cell.outside) return { ...cell, metres: null };
  const img = await open();
  const [band] = await img.readRasters({
    window: [cell.x, cell.y, cell.x + 1, cell.y + 1],
  });
  const raw = band?.[0];
  const modelled = Number.isFinite(raw) && raw !== info.noData;
  return { ...cell, metres: modelled ? Number(raw) : null };
}

/**
 * Answer a click, in the card the geology units already use.
 *
 * Synchronous TRUE means "this click is mine" — the caller has to know that
 * before the read finishes, or it dismisses the card a moment before this
 * raises one. The read then runs on its own; a TICKET is what stops a slow
 * answer from overwriting a newer click's card, which is the ordinary
 * behaviour of clicking twice quickly on a fresh tile.
 */
let probeTicket = 0;

/**
 * The card, raised the same way for the placeholder and for the answer -- the
 * second call replaces the first in place, because it is pinned to the same
 * ground.
 *
 * `soil: true` is the flag that stops the card re-deriving its own heading --
 * without it `crustalSetting` reads the elevation and heads a thickness
 * reading "Continental", and the rock-property fold prints sixteen
 * rock-mechanics parameters about a metre of till. The lesson is
 * `soil-card.js`'s; the flag is the same one.
 */
function showThicknessCard(card, lat, lon) {
  window.GeoIDViewer?.showFeatureCard?.({
    soil: true,
    type: card.kicker,
    rock_type: card.title,
    lithology: null,
    name: null,
    description: card.meta || null,
    extra_rows: card.headline || null,
    origin: card.source,
    rows: card.note ? [...card.rows, ["Reference", card.note]] : card.rows,
  }, lat, lon);
}

export function probeAt(lat, lon) {
  const layer = thicknessLayer();
  if (!layer || layer.visible === false) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const ticket = (probeTicket += 1);
  /**
   * A CLICK THAT IS STILL READING SAYS SO, but only if it is slow enough to
   * notice. The steady state is 55-165 ms and a card that flashed "Reading"
   * for a twentieth of a second would be a flicker; the first click of a
   * session is 2.3 seconds even warmed, and a card that appears two seconds
   * after the click has already been read as a map that does not answer.
   *
   * So the placeholder is on a fuse: if the value is not back in a quarter of
   * a second, the card opens at the point saying what it is doing, and the
   * value replaces it in place when it lands.
   */
  let answered = false;
  setTimeout(() => {
    if (answered || ticket !== probeTicket) return;
    showThicknessCard(waitingCard(lat, lon, meta || {}), lat, lon);
  }, 250);
  void (async () => {
    try {
      const sample = await sampleAt(lat, lon);
      answered = true;
      if (!sample || ticket !== probeTicket) return;
      const card = thicknessCard(sample, meta || {});
      /**
       * `soil: true` is the flag that stops the card re-deriving its own
       * heading — without it `crustalSetting` reads the elevation and heads a
       * thickness reading "Continental", and the rock-property fold prints
       * sixteen rock-mechanics parameters about a metre of till. The lesson is
       * `soil-card.js`'s; the flag is the same one.
       */
      showThicknessCard(card, lat, lon);
    } catch (error) {
      answered = true;
      console.warn("soil thickness could not be sampled:", error.message);
    }
  })();
  return true;
}

async function build({ onStatus = () => {} } = {}) {
  if (busy) return { ok: false, message: "already building" };
  busy = true;
  try {
    onStatus("Reading soil thickness…");
    const info = await loadMeta();
    const bounds = targetBounds(info);
    const read = await readWindow(bounds);
    if (!read) return { ok: false, message: "No soil thickness over this view." };
    /**
     * The nodata is KEPT rather than zeroed. A zero would read as "no soil
     * here", and over the ocean — or south of 60°S, where this model stops —
     * that is a different claim from "not modelled".
     */
    const values = Float32Array.from(read.band);
    let seen = 0; let min = Infinity; let max = -Infinity;
    for (const v of values) {
      if (v === info.noData) continue;
      seen += 1;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!seen) return { ok: false, message: "Nothing is modelled over this view." };
    const result = buildRasterLayer([values], read.width, read.height, {
      minX: read.bounds.west, maxX: read.bounds.east,
      minY: read.bounds.south, maxY: read.bounds.north,
    }, { name: LAYER_NAME, noData: info.noData, isDem: false, unit: info.unit });
    // It draws ON the ground and does not test depth, so it must not write it
    // either -- the fault the elevation sheets already record.
    result.object3D?.traverse?.((node) => {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => { if (m && m.depthTest === false) m.depthWrite = false; });
    });
    const previous = thicknessLayer();
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(LAYER_NAME, result, "tiles");
    if (!layer) return { ok: false, message: "the layer could not be registered" };
    const opening = previous && Number.isFinite(previous.opacity)
      ? previous.opacity : DEFAULT_OPACITY;
    window.GeoIDLayerHierarchy?.setOpacity?.(layer, opening);
    if (previous) {
      if (previous.visible === false) window.GeoIDLayerHierarchy?.setVisible?.(layer, false);
      window.GeoIDImportManager?.removeLayer?.(previous.id);
    }
    layer.info = {
      source: info.credit,
      summary: info.summary,
      citation: `${info.credit} doi:${info.doi}`,
      // Whose model it is, and what our bake did to its numbers.
      maths: mathsFor("soil-thickness"),
    };
    layer.metadata = {
      ...(layer.metadata || {}),
      source: info.credit,
      citation: `${info.credit} doi:${info.doi}`,
      crs: "EPSG:4326",
    };
    window.GeoIDLayerHierarchy?.render?.();
    lastBuilt = bounds;
    const message = `${LAYER_NAME}: ${Math.round(min)} to ${Math.round(max)} m over this view, `
      + `from the 1 km grid. ${info.credit}`;
    onStatus(message);
    return { ok: true, layer, message };
  } catch (error) {
    return { ok: false, message: `Soil thickness could not be read: ${error.message}` };
  } finally {
    busy = false;
  }
}

/** Refine on REST, like every other sheet here. */
function watch() {
  if (watchStop) return;
  const viewer = window.GeoIDViewer;
  if (!viewer) return;
  watchStop = onViewSettled(viewer, () => {
    if (!thicknessLayer() || !meta) return;
    const next = targetBounds(meta);
    const asView = (b) => ({ minLon: b.west, maxLon: b.east, minLat: b.south, maxLat: b.north });
    if (lastBuilt && !viewChangedEnough(asView(lastBuilt), asView(next))) return;
    void build();
  }, { settleMs: 900, pollMs: 150 });
}

export async function addThickness(onStatus = () => {}) {
  if (thicknessLayer()) return { ok: true, message: `${LAYER_NAME} is already on the globe.` };
  if (!three) three = await import("../vendor/three.module.js");
  const out = await build({ onStatus });
  if (out.ok) {
    watch();
    /**
     * WARM THE CLICK, because the first one is otherwise seconds long.
     *
     * The sheet is drawn from an OVERVIEW and a click reads FULL RESOLUTION,
     * so the two share the open file and nothing else: measured on a fresh
     * page, the first click waited **3 to 7 seconds** for level 0's tile
     * directory while every click after it came back in 35-60 ms. A reader
     * clicking a map and getting nothing for five seconds has been told the
     * map is not clickable, and they do not click it again.
     *
     * One throwaway read at the view centre pays that off while they are
     * still looking at the sheet appearing. It costs one tile.
     */
    const centre = window.GeoIDViewer?.getViewCentreLatLon?.();
    if (Number.isFinite(centre?.lat) && Number.isFinite(centre?.lon)) {
      void sampleAt(centre.lat, centre.lon).catch(() => {});
    }
  }
  return out;
}

export function removeThickness() {
  const layer = thicknessLayer();
  watchStop?.();
  watchStop = null;
  lastBuilt = null;
  if (!layer) return false;
  window.GeoIDImportManager?.removeLayer?.(layer.id);
  return true;
}

/**
 * The seam `gis/feature-popup.js` offers a click to when nothing vector was
 * hit. Published on import, which is when the catalogue row loads this — so a
 * click can only be claimed by a sheet that is actually on the globe.
 */
if (typeof window !== "undefined") {
  window.GeoIDSoilThickness = {
    LAYER_NAME, thicknessLayer, sampleAt, probeAt, addThickness, removeThickness,
  };
}
