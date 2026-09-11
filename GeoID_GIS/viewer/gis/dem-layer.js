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

import { buildRasterLayer } from "./geotiff-adapter.js?v=20260911-18f9802";
import { mathsFor } from "./equations.js?v=20260911-18f9802";
import { visibleBounds, viewChangedEnough, onViewSettled } from "./view-extent.js?v=20260911-18f9802";
import { makeRaster, slope as slopeOf, hillshade as hillshadeOf }
  from "./raster-analysis.js?v=20260911-18f9802";
import * as dem from "./dem-tiles.js?v=20260911-18f9802";
import { rampColour } from "./symbology.js?v=20260911-18f9802";
import * as climate from "./climate-normals.js?v=20260911-18f9802";
import { waterMasks, waterFeatures, floodFromSea, classAreas, FLOODED, EXPOSED, CUT_OFF, LAKE }
  from "./water-mask.js?v=20260911-18f9802";
import { burnRivers, riverZones, zoneAreas, ZONES } from "./river-zones.js?v=20260911-18f9802";

/**
 * Which corridor zones are drawn. State, like the sea level, so the drawer's
 * ticks can repaint the sheet without the builder knowing they exist.
 */
export const riverZoneState = { on: { 1: true, 2: true, 3: true }, masks: null, last: null };

/** The painter for the corridor zones as the ticks stand now. */
export function riverZonePaint() {
  return (v) => {
    const zone = ZONES.find((z) => z.id === v);
    return zone && riverZoneState.on[v] ? zone.colour : null;
  };
}

/** The key for the zones that are on: a classed legend, innermost first. */
export function riverZoneLegend() {
  const shown = ZONES.filter((z) => riverZoneState.on[z.id]);
  return {
    palette: shown.map((z) => z.colour.map((c) => c.toString(16).padStart(2, "0")).join("")),
    labels: shown.map((z) => `${z.label} — ${z.rule}`),
    values: shown.map((z) => z.label),
    categorical: true,
    classed: true,
    field: "River corridor zone (W = channel width at mean flow)",
  };
}

/**
 * The sea level the sea-level sheet is drawn at, in metres against today's.
 * State rather than a spec field so the control can move it and ask for a
 * rebuild without the builder knowing there is a control at all.
 */
export const seaLevel = { metres: 1, masks: null, last: null };

const WATER_CREDIT = "Coastline © OpenStreetMap contributors (ODbL 1.0) from "
  + "zoom 4 and Natural Earth below it; lakes from HydroLAKES v1.0 (Messager "
  + "et al. 2016), CC BY 4.0.";

const hexOf = (rgb) => rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
/** Sand to umber, for seabed standing above a fallen sea. */
const seabed = (t) => {
  const a = [238, 218, 168]; const b = [128, 84, 40];
  const u = Math.max(0, Math.min(1, t));
  return a.map((v, k) => Math.round(v + ((b[k] - v) * u)));
};
/** Pale to deep water, for land under a risen sea. Starts part-way along the
 * ramp so the shallowest flooding is still visibly water over the imagery. */
const flood = (t) => rampColour("blues", 0.3 + (0.7 * Math.max(0, Math.min(1, t))));
const km2 = (v) => Math.round(v).toLocaleString();

/**
 * THREE READINGS OF ONE SOURCE, not three sources.
 *
 * Slope and hillshade are arithmetic ON a DEM, and this app already owns that
 * arithmetic: `raster-analysis` exports the same `slope` and `hillshade` the
 * tool registry runs and the suite sweeps against closed-form fixtures. So a
 * row here derives its band from the SAME streamed grid rather than fetching
 * anything of its own — one pyramid, one cover, one set of lessons about chord
 * sag and depth, three ways to read the ground.
 *
 * The shipped GEBCO hillshade and slope stay where they are. They are global,
 * instant and free of any fetch; these are the LOCAL answer, which is a
 * different product rather than a better one — at a world view the streamed
 * cover is the same 19.6 km GEBCO already is.
 */
export const SHEETS = {
  elevation: {
    id: "dem-elevation",
    label: "Elevation (streamed DEM)",
    unit: "m",
    isDem: true,
    opacity: 0.7,
    summary: "Heights as a sheet on the ground, from streamed tiles.",
    derive: (raster) => [raster.band],
  },
  slope: {
    id: "dem-slope",
    label: "Slope (from streamed DEM)",
    unit: "°",
    isDem: false,
    opacity: 0.75,
    summary: "Steepness in degrees, computed from the streamed heights — the "
      + "layer a Factor-of-Safety pass actually wants, at the view's own scale.",
    derive: (raster) => [slopeOf(raster, { degrees: true }).band],
  },
  hillshade: {
    id: "dem-hillshade",
    label: "Hillshade (from streamed DEM)",
    unit: null,
    isDem: false,
    opacity: 0.85,
    summary: "Shaded relief from the streamed heights, lit from the north-west.",
    /**
     * THREE IDENTICAL BANDS, because that is how this builder draws grey.
     *
     * `buildTexture` treats three bands as RGB and one band as a value to run
     * through a colour ramp — and a hillshade through a colour ramp is not a
     * hillshade. Handing it the same greys three times is the whole trick.
     */
    derive: (raster) => {
      const shade = hillshadeOf(raster, {
        azimuth: readLight("hillshade-azimuth", 315),
        altitude: readLight("hillshade-altitude", 45),
      }).band;
      return [shade, shade, shade];
    },
  },
  /**
   * THE MEAN CLIMATE, AS A MAP — and the SAME function the cursor readout
   * uses, over this grid. MERRA-2's 2001-2020 means are carried from each
   * 0.5° cell's own height to the streamed ground by a lapse rate and the
   * hypsometric equation (`climate-normals.js`), so a valley reads warmer than
   * the ridge above it and the colour under the cursor is the number beside
   * it. Over the sea the surface is the sea, not the seabed the DEM reports.
   *
   * A FIXED SCALE, never the view's own range: a stretch to what is in view
   * would paint London and Lagos the same colour on two different evenings.
   */
  temperature: {
    id: "climate-temperature",
    label: "Mean temperature 2001–2020 (MERRA-2, on the streamed DEM)",
    unit: "°C",
    isDem: false,
    opacity: 0.7,
    summary: "The 2001–2020 annual mean of 2 m air temperature from NASA's "
      + "MERRA-2 reanalysis, carried from its 55 km grid to the streamed ground "
      + "by the standard lapse rate.",
    credit: climate.CITATION,
    prepare: () => climate.load(),
    derive: (raster) => [climate.climateGrid(climate.normalsNow(), raster.band,
      raster.width, raster.height, raster.bounds, raster.noData, "tempC")],
    scale: { ramp: "spectral", reverse: true, min: -40, max: 35 },
  },
  pressure: {
    id: "climate-pressure",
    label: "Mean surface pressure 2001–2020 (MERRA-2, on the streamed DEM)",
    unit: "Pa",
    isDem: false,
    opacity: 0.7,
    summary: "The 2001–2020 annual mean surface air pressure from NASA's "
      + "MERRA-2 reanalysis, carried from its 55 km grid to the streamed ground "
      + "by the hypsometric equation.",
    credit: climate.CITATION,
    prepare: () => climate.load(),
    derive: (raster) => [climate.climateGrid(climate.normalsNow(), raster.band,
      raster.width, raster.height, raster.bounds, raster.noData, "pressurePa")],
    scale: { ramp: "viridis", reverse: false, min: 50000, max: 103000 },
  },
  /**
   * RIVER CORRIDOR ZONES round every GRWL river, sized by the river's own
   * width and the floodplain cut by the terrain (`river-zones.js`). The
   * streamed heights are what "within 5 m of the channel" is measured on; the
   * sea and lakes from the coastline polygons are never painted.
   */
  riverzones: {
    id: "river-zones",
    label: "River corridor zones (GRWL on the streamed DEM)",
    unit: null,
    isDem: false,
    opacity: 0.6,
    summary: "Incremental zones round every river at least 30 m wide, each "
      + "measured from the mean-flow water edge in multiples of the channel's "
      + "own width: the seasonal margin, the migration belt, and the floodplain "
      + "where the ground stands within 5 m of the channel.",
    credit: "Rivers: GRWL v01.01 (Allen & Pavelsky 2018), CC BY 4.0. Coastline © "
      + "OpenStreetMap contributors (ODbL 1.0), Natural Earth; lakes HydroLAKES "
      + "(Messager et al. 2016), CC BY 4.0.",
    prepare: async (bounds, width, height) => {
      const key = JSON.stringify([bounds.west, bounds.south, bounds.east, bounds.north,
        width, height]);
      if (riverZoneState.masks?.key !== key) {
        const [rivers, water] = await Promise.all([
          waterFeatures("rivers", bounds, width), waterMasks(bounds, width, height),
        ]);
        const burned = burnRivers(rivers.features, bounds, width, height);
        const wet = new Uint8Array(width * height);
        for (let c = 0; c < wet.length; c += 1) {
          wet[c] = water.ocean[c] || !Number.isNaN(water.lakeLevel[c]) ? 1 : 0;
        }
        riverZoneState.masks = { key, ...burned, water: wet, zoom: rivers.zoom };
      }
      return riverZoneState.masks;
    },
    derive: (raster, ctx) => {
      const heights = new Float32Array(raster.band.length);
      for (let c = 0; c < heights.length; c += 1) {
        const h = raster.band[c];
        heights[c] = h === raster.noData ? NaN : h;
      }
      const classes = riverZones({
        heights, riverWidth: ctx.riverWidth, canal: ctx.canal, water: ctx.water,
        width: raster.width, height: raster.height, bounds: ctx.bounds,
      });
      const cellM = ((ctx.bounds.east - ctx.bounds.west) / raster.width) * 111320
        * Math.cos((((ctx.bounds.north + ctx.bounds.south) / 2) * Math.PI) / 180);
      riverZoneState.last = { areas: zoneAreas(classes, raster.width, raster.height, ctx.bounds),
        cellM, world: ctx.world };
      const out = new Float32Array(classes.length);
      for (let c = 0; c < out.length; c += 1) {
        out[c] = ZONES.some((z) => z.id === classes[c]) ? classes[c] : NO_DATA;
      }
      return [out];
    },
    paint: (result) => {
      result.repaint(riverZonePaint());
      result.legendInfo = riverZoneLegend();
    },
    status: () => {
      const last = riverZoneState.last;
      if (!last) return "";
      const km = (id) => Math.round(last.areas[id] || 0).toLocaleString();
      const parts = ZONES.filter((z) => riverZoneState.on[z.id])
        .map((z) => `${z.label.toLowerCase()} ${km(z.id)} km²`);
      const cell = Math.round(last.cellM);
      return `River corridor zones ${last.world ? "worldwide" : "in this view"}: `
        + `${parts.join(", ") || "all zones switched off"}. Cells here are about `
        + `${cell.toLocaleString()} m, so a zone narrower than that is not drawn — `
        + "fly in to see the seasonal margin of a small river. GRWL maps rivers "
        + "30 m wide and more.";
    },
  },
  /**
   * THE SEA AT A CHOSEN LEVEL, on the streamed heights and the real coastline.
   *
   * The ocean polygons decide where the sea is TODAY, so at 0 m this is the
   * coastline exactly; from there the sea spreads through ground below the
   * chosen level and nowhere else, and each lake stands at its own surveyed
   * surface (`water-mask.js`). What is drawn is only what CHANGES — land a
   * risen sea covers, coloured by how deep, or seabed a fallen sea leaves
   * standing, coloured by how high — because today's sea is already on the
   * imagery underneath.
   */
  sealevel: {
    id: "sea-level",
    label: "Sea level (streamed DEM and coastline)",
    unit: "m",
    isDem: false,
    opacity: 0.85,
    summary: "Where the sea stands at a chosen level against today's, spread "
      + "from the real coastline through the streamed heights, with every lake "
      + "held at its own surface.",
    credit: WATER_CREDIT,
    prepare: async (bounds, width, height) => {
      const key = JSON.stringify([bounds.west, bounds.south, bounds.east, bounds.north,
        width, height]);
      if (seaLevel.masks?.key !== key) {
        seaLevel.masks = { key, ...(await waterMasks(bounds, width, height)) };
      }
      return seaLevel.masks;
    },
    derive: (raster, ctx) => {
      const heights = new Float32Array(raster.band.length);
      for (let c = 0; c < heights.length; c += 1) {
        const h = raster.band[c];
        heights[c] = h === raster.noData ? NaN : h;
      }
      const level = seaLevel.metres;
      const { classes, depth } = floodFromSea({
        heights, ocean: ctx.ocean, lakeLevel: ctx.lakeLevel,
        width: raster.width, height: raster.height, level, wrap: ctx.world,
      });
      seaLevel.last = { level, areas: classAreas(classes, raster.width, raster.height, ctx.bounds),
        world: ctx.world, lakesReached: 0 };
      // Lakes the risen sea has run into, for the status line.
      if (level >= 0) {
        for (let c = 0; c < classes.length; c += 1) {
          if (classes[c] === LAKE && Number.isFinite(ctx.lakeLevel[c])
            && ctx.lakeLevel[c] < level) seaLevel.last.lakesReached += 1;
        }
      }
      const out = new Float32Array(depth.length);
      for (let c = 0; c < out.length; c += 1) {
        out[c] = (classes[c] === FLOODED || classes[c] === EXPOSED) ? depth[c] : NO_DATA;
      }
      return [out];
    },
    /** Water over land in blue by depth; seabed above the sea in sand by height. */
    paint: (result) => {
      const level = seaLevel.metres;
      const rising = level >= 0;
      const top = Math.max(1, Math.abs(level));
      const colour = rising ? flood : seabed;
      result.repaint((v) => (!Number.isFinite(v) || v === NO_DATA ? null : colour(v / top)));
      result.legendInfo = {
        palette: [0, 0.25, 0.5, 0.75, 1].map((t) => hexOf(colour(t))),
        min: 0,
        max: Math.round(top * 10) / 10,
        label: rising ? "Depth of sea over land that is dry today"
          : "Height of seabed above the sea",
        unit: "m",
      };
    },
    status: () => {
      const last = seaLevel.last;
      if (!last) return "";
      const sign = last.level > 0 ? "+" : "";
      const where = last.world ? "worldwide" : "in this view";
      if (last.level < 0) {
        return `At ${sign}${last.level} m: ${km2(last.areas[EXPOSED])} km² of seabed ${where} `
          + "stands above the sea. Lakes keep their own level. Coastline from "
          + "OpenStreetMap and Natural Earth, heights streamed.";
      }
      const cut = last.areas[CUT_OFF];
      /**
       * AT TODAY'S LEVEL THE MODEL STILL FINDS LAND "BELOW THE SEA", and says
       * what it is rather than hiding it. Measured over Bangladesh: 2,512 km²
       * the heights put below 0 m and joined to the sea -- river channels,
       * polders behind defences, and the heights' own error, which on a flat
       * vegetated coast is metres (SRTM-era heights read high under canopy and
       * noisy near zero). The coastline itself is exactly today's.
       */
      if (last.level === 0) {
        return `At today's level the sea is the coastline polygons. ${km2(last.areas[FLOODED])} km² `
          + `of land ${where} is below 0 m in the heights and joined to the sea — river `
          + "channels, polders behind defences, and the heights' own error near sea level.";
      }
      const withinError = last.level > 0 && last.level < 5
        ? " A rise this small is within the heights' own error on a flat coast, which is "
          + "metres: read it as where to look, not as a flood line." : "";
      return [
        `At ${sign}${last.level} m: ${km2(last.areas[FLOODED])} km² of land ${where} lies below `,
        "the sea and is connected to it.",
        cut > 0.5 ? ` ${km2(cut)} km² more is lower than that but cut off from the sea, and is `
          + "left dry." : "",
        last.lakesReached ? " The sea runs into lakes whose surface is below it." : "",
        last.world ? "" : " Only ground in view is considered: the sea has to reach it "
          + "through what the view can see.",
        withinError,
      ].join("");
    },
  },
};

/** The page's own light controls, which had no job until now. */
function readLight(id, fallback) {
  const value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}

export const DEM_LAYER_NAME = SHEETS.elevation.label;

/** Nothing measured is ever this low, so it reads as "no answer here". */
const NO_DATA = -32768;

/**
 * The sheet's own grid, and the number is a frame-time decision.
 *
 * Everything downstream scales with it: the sampling, the slope or hillshade
 * arithmetic, the texture upload. At 1,024 x 512 a rebuild cost one 199 ms
 * hitch on an otherwise 60 fps loop; at 768 x 384 it is 0.56 of the work for a
 * texture that is still finer than the screen shows it (1.5 km a cell over a
 * 12° view against about 1 km a screen pixel), and the mesh under it is 192
 * either way.
 *
 * Over the WORLD the same grid is about 52 km a cell — coarser than the
 * zoom-3 tiles behind it on purpose, because this is a PICTURE of the heights
 * and the sampler is what answers questions.
 */
const GRID_W = 768;
const GRID_H = 384;

const WORLD = { west: -180, east: 180, south: -85, north: 85 };

/** The catalogue row's own figure, so the two cannot disagree. */
const DEFAULT_OPACITY = 0.7;

let three = null;
let watchStop = null;
let lastBuilt = null;
let busy = false;

export function sheetLayer(kind) {
  const spec = SHEETS[kind];
  if (!spec) return null;
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((layer) => layer.name === spec.label) || null;
}

/** The elevation sheet, for the callers that only ever meant that one. */
export function demLayer() {
  return sheetLayer("elevation");
}

/** Every sheet currently on the globe. The watcher rebuilds all of them. */
function liveKinds() {
  return Object.keys(SHEETS).filter((kind) => sheetLayer(kind));
}

/**
 * Sample the streamed tiles onto an equirectangular grid.
 *
 * By LAT/LON, one cell at a time, rather than by copying tile pixels — which
 * is what keeps the Mercator trap out of this module entirely. The sphere's
 * UVs are linear in latitude and the tiles are not, and a pixel copy slides
 * every coastline poleward; asking the sampler where a place is cannot.
 */
/**
 * Sampled in SLICES, with a breath between them.
 *
 * Half a million samples is a fifth of a second even after the tile lookup was
 * made cheap, and a fifth of a second of blocked main thread on every settle is
 * a camera that stops dead each time you stop moving it — reported as fighting
 * all the way down, and with three sheets ticked it was three times that. The
 * work is the same; what changes is that the render loop gets frames while it
 * happens, so the zoom easing and the controls keep running.
 */
const ROWS_PER_SLICE = 48;
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

async function sampleGridOver(bounds, width, height) {
  const band = new Float32Array(width * height);
  let seen = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < height; j += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (j && j % ROWS_PER_SLICE === 0) await breathe();
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
async function build(kind, { onStatus = () => {} } = {}) {
  const spec = SHEETS[kind];
  if (!spec) return { ok: false, message: "No such elevation sheet." };
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
    // What this reading needs besides the heights -- the climatology, the
    // water polygons for this box -- fetched before the grid is sampled.
    const ctx = spec.prepare ? await spec.prepare(bounds, GRID_W, GRID_H) : null;
    const { band, seen, min, max } = await sampleGridOver(bounds, GRID_W, GRID_H);
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
    /**
     * The reading this row asks for, derived from the SAME grid. `makeRaster`
     * is what the analysis functions take, and it carries the bounds so slope
     * knows its cell size in metres -- a slope computed on degrees would be
     * wrong by the cosine of the latitude and look plausible everywhere.
     */
    const bands = spec.derive(makeRaster(band, GRID_W, GRID_H, rasterBounds, NO_DATA),
      { ...(ctx || {}), bounds, world: bounds === WORLD });
    const result = buildRasterLayer(bands, GRID_W, GRID_H, rasterBounds, {
      name: spec.label,
      noData: NO_DATA,
      // Declared, never inferred: a height field with few distinct values in a
      // small view would otherwise be read as a classified raster and lose the
      // elevation ramp -- and slope and hillshade must NOT borrow it.
      isDem: spec.isDem,
      unit: spec.unit,
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
    /**
     * A reading with its own FIXED SCALE is repainted onto it and keyed by it.
     * The builder's own ramp is the elevation one, stretched to the band's own
     * range — right for heights, and wrong for a temperature, whose colour has
     * to mean the same number in every view.
     */
    if (spec.scale) {
      const { ramp, reverse, min, max } = spec.scale;
      result.repaint((v) => {
        if (!Number.isFinite(v) || v === NO_DATA) return null;
        return rampColour(ramp, (v - min) / (max - min), { reverse });
      });
      result.legendInfo = {
        palette: [0, 0.25, 0.5, 0.75, 1].map((t) => rampColour(ramp, t, { reverse })
          .map((c) => c.toString(16).padStart(2, "0")).join("")),
        min, max, label: "", unit: spec.unit,
      };
    }
    spec.paint?.(result, bands, ctx);
    const previous = sheetLayer(kind);
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(spec.label, result, "tiles");
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
      ? previous.opacity : spec.opacity;
    window.GeoIDLayerHierarchy?.setOpacity?.(layer, opening);
    if (previous) {
      if (previous.visible === false) window.GeoIDLayerHierarchy?.setVisible?.(layer, false);
      window.GeoIDImportManager?.removeLayer?.(previous.id);
    }
    layer.mapEntryId = spec.id;
    /**
     * A HILLSHADE HAS NO KEY. Its values are shade, not a measurement, so a
     * legend card reading "82 to 248" beside a colour bar is furniture that
     * says nothing — and the bar is a lie twice over, since the layer draws
     * grey. `legendHidden` is the events feed's own seam: the layer keeps its
     * row, its eye, its opacity and its place in the draw order, and only the
     * card goes.
     */
    if (!spec.unit) layer.legendHidden = true;
    const credit = spec.credit ? `${spec.credit} Heights: ${dem.TERRARIUM.credit}`
      : dem.TERRARIUM.credit;
    layer.info = {
      source: credit,
      summary: `${spec.summary} Streamed as tiles and sampled onto this grid; the `
        + "cursor readout and the terrain tools read the same source.",
      // Slope and hillshade are arithmetic, not readings. The Workspace row
      // draws an ⓘ for this, so the working travels with the layer.
      maths: mathsFor(spec.id),
      citation: credit,
    };
    layer.metadata = {
      ...(layer.metadata || {}),
      source: credit,
      citation: credit,
      crs: "EPSG:4326",
    };
    const posts = Math.round(dem.groundMetresPerPixel(
      world.zoom, (bounds.north + bounds.south) / 2,
    ));
    window.GeoIDLayerHierarchy?.render?.();
    lastBuilt = bounds;
    /**
     * The range of what this row DRAWS, not of the heights it came from.
     *
     * Quoting the elevation range under a slope map is a number about a
     * different raster; a hillshade has no range worth quoting at all, its
     * values being shade rather than a measurement.
     */
    let range = "";
    if (spec.unit) {
      let lo = Infinity; let hi = -Infinity;
      for (const v of bands[0]) {
        if (!Number.isFinite(v) || v === NO_DATA) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (Number.isFinite(lo)) range = `${Math.round(lo)} to ${Math.round(hi)}${spec.unit}, `;
    }
    const message = spec.status?.(bands, bounds, ctx)
      || [spec.label, ": ", range, "about ", posts,
        " m posts where nothing finer has streamed. ", dem.TERRARIUM.credit].join("");
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
    const kinds = liveKinds();
    if (!kinds.length) return;
    const next = targetBounds();
    const asView = (b) => ({ minLon: b.west, maxLon: b.east, minLat: b.south, maxLat: b.north });
    if (lastBuilt && !viewChangedEnough(asView(lastBuilt), asView(next))) return;
    // Every sheet that is on, one after another: they share the cover and the
    // grid, so the second and third cost arithmetic rather than tiles.
    void kinds.reduce((chain, kind) => chain.then(() => build(kind)), Promise.resolve());
    /**
     * 900 ms rather than the 700 the tilers use. A descent is a run of
     * settles, and each one here costs a rebuild per ticked sheet; a longer
     * pause before starting is the cheapest way to stop a slow zoom becoming
     * a queue of them.
     */
  }, { settleMs: 900, pollMs: 150 });
}

export async function addSheet(kind, onStatus = () => {}) {
  const spec = SHEETS[kind];
  if (!spec) return { ok: false, message: "No such elevation sheet." };
  if (sheetLayer(kind)) return { ok: true, message: `${spec.label} is already on the globe.` };
  if (!three) three = await import("../vendor/three.module.js");
  const out = await build(kind, { onStatus });
  if (out.ok) watch();
  return out;
}

export function removeSheet(kind) {
  const layer = sheetLayer(kind);
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  // The watcher stands down only when the LAST sheet goes: it rebuilds all of
  // them together, and stopping it while one is still drawn would leave that
  // one frozen at the view it was built for.
  if (!liveKinds().length) {
    watchStop?.();
    watchStop = null;
    lastBuilt = null;
  }
  return Boolean(layer);
}

/** The elevation sheet's own doors, kept for the callers that named it. */
export const addDemLayer = (onStatus) => addSheet("elevation", onStatus);
export const removeDemLayer = () => removeSheet("elevation");

/**
 * Rebuild a sheet that is on the globe, now — for a reading whose inputs moved
 * without the view moving (the sea-level control). Waits out a build already
 * running rather than dropping the request, or the last slider position is the
 * one that never gets drawn.
 */
export async function rebuildSheet(kind, onStatus = () => {}) {
  if (!sheetLayer(kind)) return { ok: false, message: "not on the globe" };
  while (busy) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return build(kind, { onStatus });
}

// The catalogue's TILED rows drive these through a seam, as they do every
// other self-loading layer.
if (typeof window !== "undefined") {
  window.GeoIDDemSheets = { addSheet, removeSheet, rebuildSheet, sheetLayer, SHEETS,
    riverZoneState, riverZonePaint, riverZoneLegend };
}
