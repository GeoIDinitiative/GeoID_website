/**
 * POPULATION, read straight out of a COG — WorldPop's 2020 global 1 km
 * mosaic, people per square kilometre, as its own layer.
 *
 * The EXPOSURE half of risk: every hazard map in this tab says how often
 * something happens at a point, and none of them says whether anybody is
 * there. This is who is there, from the one open global population surface
 * with a published method (a dasymetric model of census counts disaggregated
 * by settlement and land cover, Random Forest weights) — a MODEL, calibrated
 * to census totals, and the card says so.
 *
 * ONE COG, NO PYRAMID, the soil-thickness sheet's arrangement: 870 MB in the
 * bucket with internal overviews, the page reading the window and the level a
 * view deserves, and a click reading the full-resolution cell.
 *
 * DRAWN ON A LOG SCALE. Density runs from nobody to 100,000 a km² and a
 * linear ramp is a black map with three bright pixels; the classes are decades
 * of people per km² and the key reads in people, not in logarithms.
 */

import { buildRasterLayer, loadGeoTiffLibrary } from "./geotiff-adapter.js?v=20260912-e5b0314";
import { visibleBounds, viewChangedEnough, onViewSettled } from "./view-extent.js?v=20260912-e5b0314";
import { dataUrl } from "./data-base.js?v=20260912-e5b0314";
import { rampColour } from "./symbology.js?v=20260912-e5b0314";
import { mathsFor } from "./equations.js?v=20260912-e5b0314";

export const LAYER_NAME = "Population density (WorldPop 2020, 1 km)";
const META_PATH = "/data/global/worldpop/meta.json";
const MAX_SPAN = 1600;
const DEFAULT_OPACITY = 0.75;

/** Decades of people per km²; one more label than edges. */
export const DENSITY_EDGES = [1, 10, 100, 1000, 10000];
export const DENSITY_LABELS = [
  "under 1 person per km²",
  "1 – 10 per km²",
  "10 – 100 per km²",
  "100 – 1,000 per km²",
  "1,000 – 10,000 per km²",
  "over 10,000 per km²",
];
export const NONE_COLOUR = "2f3b46";

export function classOf(density) {
  if (!(density > 0)) return -1;
  let c = 0;
  DENSITY_EDGES.forEach((edge, i) => { if (density >= edge) c = i + 1; });
  return c;
}

const classColours = DENSITY_LABELS.map((_, i) => rampColour("risk", i / DENSITY_EDGES.length));
const hex = ([r, g, b]) => [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** The paint the raster is repainted with: a class per decade, nobody transparent-dark. */
/** Nodata is a Float32 sentinel (-3.4e38) that never compares equal to the JSON's double. */
export const isNoData = (value, noData) => !Number.isFinite(value) || value <= -1e30 || value === noData || value < 0;

export function colourOf(value, noData) {
  if (isNoData(value, noData)) return null;
  const c = classOf(value);
  return c < 0 ? [0x2f, 0x3b, 0x46] : classColours[c];
}

export function legendFor(counts = null) {
  return {
    classed: true, categorical: false, field: "density", label: "People per km² (WorldPop 2020)", unit: null,
    palette: [NONE_COLOUR, ...classColours.map(hex)],
    labels: ["nobody", ...DENSITY_LABELS],
    bounds: [["0", "0"], ...DENSITY_LABELS.map((_, i) => [i === 0 ? "0" : String(DENSITY_EDGES[i - 1]), i < DENSITY_EDGES.length ? String(DENSITY_EDGES[i]) : "∞"])],
    counts: counts || DENSITY_LABELS.map(() => 0).concat([0]).slice(0, DENSITY_LABELS.length + 1),
    min: 0, max: 100000,
  };
}

let three = null;
let meta = null;
let image = null;
let tiffFile = null;
let levels = null;
let watchStop = null;
let lastBuilt = null;
let busy = false;

export function populationLayer() {
  return (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === LAYER_NAME) || null;
}

async function loadMeta() {
  if (meta) return meta;
  meta = await (await fetch(`${META_PATH}${new URL(import.meta.url).search}`)).json();
  return meta;
}

async function open() {
  if (image) return image;
  const info = await loadMeta();
  const GeoTIFF = await loadGeoTiffLibrary();
  tiffFile = await GeoTIFF.fromUrl(await dataUrl(`/data/global/${info.file}`));
  image = await tiffFile.getImage();
  return image;
}

/**
 * THE OVERVIEW WHOSE RESOLUTION MATCHES THE REQUEST, not the base image.
 * `readRasters` on the base image reads the full-resolution window BEFORE
 * resampling to the width asked for: a world window of Float32 is 43,200 x
 * 18,720 x 4 bytes = 3.2 GB, and it died with "Array buffer allocation
 * failed". (The soil-thickness sheet survives the same call only because its
 * bytes are a quarter the size.) The COG carries average overviews; the
 * coarsest one that still has a pixel per requested pixel is read instead.
 */
async function levelFor(spanPx, needPx) {
  if (!levels) {
    const n = await tiffFile.getImageCount();
    levels = [];
    for (let i = 0; i < n; i += 1) {
      const img = await tiffFile.getImage(i);
      levels.push({ img, scale: image.getWidth() / img.getWidth() });
    }
    levels.sort((a, b) => a.scale - b.scale);
  }
  let pick = levels[0];
  for (const level of levels) {
    if (spanPx / level.scale >= needPx) pick = level; else break;
  }
  return pick;
}

function targetBounds(info) {
  const viewer = window.GeoIDViewer;
  const box = viewer && three ? visibleBounds(viewer, three) : null;
  const world = { west: info.bounds.west, east: info.bounds.east, south: info.bounds.south, north: info.bounds.north };
  const finite = box && [box.minLon, box.minLat, box.maxLon, box.maxLat].every((v) => Number.isFinite(v));
  if (!finite || box.maxLon - box.minLon > 90 || box.maxLon >= 179.9 || box.minLon <= -179.9) return world;
  return {
    west: Math.max(world.west, box.minLon), east: Math.min(world.east, box.maxLon),
    south: Math.max(world.south, box.minLat), north: Math.min(world.north, box.maxLat),
  };
}

function pixelOf(info) {
  const [gw, gh] = info.grid;
  return {
    px: (lon) => ((lon - info.bounds.west) / (info.bounds.east - info.bounds.west)) * gw,
    py: (lat) => ((info.bounds.north - lat) / (info.bounds.north - info.bounds.south)) * gh,
    lon: (x) => info.bounds.west + (x / gw) * (info.bounds.east - info.bounds.west),
    lat: (y) => info.bounds.north - (y / gh) * (info.bounds.north - info.bounds.south),
    gw, gh,
  };
}

async function readWindow(bounds) {
  const img = await open();
  const info = meta;
  const { px, py, lon, lat, gw, gh } = pixelOf(info);
  const x0 = Math.max(0, Math.floor(px(bounds.west)));
  const x1 = Math.min(gw, Math.ceil(px(bounds.east)));
  const y0 = Math.max(0, Math.floor(py(bounds.north)));
  const y1 = Math.min(gh, Math.ceil(py(bounds.south)));
  if (x1 <= x0 || y1 <= y0) return null;
  const width = Math.max(64, Math.min(MAX_SPAN, x1 - x0));
  const height = Math.max(32, Math.round(width * ((y1 - y0) / (x1 - x0))));
  const level = await levelFor(x1 - x0, width);
  const s = level.scale;
  const [band] = await level.img.readRasters({
    window: [Math.floor(x0 / s), Math.floor(y0 / s), Math.ceil(x1 / s), Math.ceil(y1 / s)],
    width, height, fillValue: info.noData,
  });
  // The bounds of the PIXELS READ, not of the request: the read snaps out to
  // whole source pixels, and labelling the image with the request slides it
  // by up to a cell -- the thickness sheet's own coastline lesson.
  return { band, width, height, bounds: { west: lon(x0), east: lon(x1), north: lat(y0), south: lat(y1) } };
}

/* ── the click ──────────────────────────────────────────────────────────── */

export function cellAt(lat, lon, info) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < info.bounds.south || lat > info.bounds.north) return { outside: true };
  const { px, py, gw, gh } = pixelOf(info);
  const x = Math.min(gw - 1, Math.max(0, Math.floor(px(lon))));
  const y = Math.min(gh - 1, Math.max(0, Math.floor(py(lat))));
  return { x, y, lat, lon };
}

/** The cell's ground, km²: 30 arcsec by 30 arcsec at this latitude. */
export function cellAreaKm2(lat, arcsec = 30) {
  const deg = arcsec / 3600;
  return (deg * 111.32) * (deg * 111.32 * Math.cos((lat * Math.PI) / 180));
}

/**
 * THE FILE HOLDS A COUNT PER CELL, NOT A DENSITY. "ppp" is people per pixel,
 * and a 30-arcsecond pixel is 0.86 km² at the equator and 0.53 km² at
 * London — so the count under-reads the density by up to a factor of two
 * poleward. The density is the count over the cell's true ground.
 */
export async function sampleAt(lat, lon) {
  const info = await loadMeta();
  const cell = cellAt(lat, lon, info);
  if (!cell) return null;
  if (cell.outside) return { ...cell, count: null, density: null };
  const img = await open();
  const [band] = await img.readRasters({ window: [cell.x, cell.y, cell.x + 1, cell.y + 1] });
  const raw = band?.[0];
  const known = !isNoData(raw, info.noData);
  const count = known ? Number(raw) : null;
  return { ...cell, count, density: known ? count / cellAreaKm2(lat) : null };
}

export function populationCard(sample = {}, info = {}) {
  const d = sample.density;
  const area = cellAreaKm2(sample.lat ?? 0);
  const people = Number.isFinite(sample.count) ? sample.count : (Number.isFinite(d) ? d * area : null);
  const title = sample.outside ? "Outside the modelled area"
    : d === null ? "No population modelled here"
      : d < 1 ? "Fewer than 1 person per km²" : `${Math.round(d).toLocaleString()} people per km²`;
  const rows = [];
  if (Number.isFinite(people)) rows.push(["In this cell", `about ${Math.round(people).toLocaleString()} people over ${area.toFixed(2)} km²`]);
  rows.push(["Cell", `30 arcseconds — about ${(Math.sqrt(area)).toFixed(2)} km across here`]);
  return {
    kicker: "Population density (WorldPop 2020)",
    title,
    meta: "a modelled surface — census counts disaggregated to 1 km by settlement and land cover",
    headline: rows,
    note: "WorldPop's top-down constrained method: national census totals for 2020 disaggregated "
      + "onto a 1 km grid by a Random Forest weighting of settlement extent, land cover, night "
      + "lights and roads. It is a model calibrated to census totals, not a count: a cell's "
      + "people are where the model puts them, and the totals are right at the country level.",
    source: info.credit || "WorldPop (www.worldpop.org), University of Southampton — CC BY 4.0",
  };
}

let probeTicket = 0;

function showCard(card, lat, lon) {
  window.GeoIDViewer?.showFeatureCard?.({
    // Named, so the card is claimed by this layer and goes when it does.
    source_layer: LAYER_NAME,
    soil: true, type: card.kicker, rock_type: card.title, lithology: null, name: null,
    description: card.meta, extra_rows: card.headline, origin: card.source,
    rows: [["Note", card.note]],
  }, lat, lon);
}

export function probeAt(lat, lon) {
  const layer = populationLayer();
  if (!layer || layer.visible === false) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const ticket = (probeTicket += 1);
  let answered = false;
  setTimeout(() => {
    if (answered || ticket !== probeTicket) return;
    showCard({ kicker: "Population density (WorldPop 2020)", title: "Reading…", meta: "", headline: [], note: "", source: meta?.credit }, lat, lon);
  }, 250);
  void (async () => {
    try {
      const sample = await sampleAt(lat, lon);
      answered = true;
      if (!sample || ticket !== probeTicket) return;
      showCard(populationCard(sample, meta || {}), lat, lon);
    } catch (error) {
      answered = true;
      console.warn("population could not be sampled:", error.message);
    }
  })();
  return true;
}

/* ── the sheet ──────────────────────────────────────────────────────────── */

async function build({ onStatus = () => {} } = {}) {
  if (busy) return { ok: false, message: "already building" };
  busy = true;
  try {
    onStatus("Reading population…");
    const info = await loadMeta();
    const bounds = targetBounds(info);
    const read = await readWindow(bounds);
    if (!read) return { ok: false, message: "No population data over this view." };
    const values = Float32Array.from(read.band);
    // Count per cell -> people per km², row by row: the cell's ground shrinks
    // with the cosine of its latitude, and the window read here is resampled
    // so the count is per SOURCE cell whatever this picture's pixel is.
    const rowLat = (y) => read.bounds.north - ((y + 0.5) / read.height) * (read.bounds.north - read.bounds.south);
    for (let y = 0; y < read.height; y += 1) {
      const per = 1 / cellAreaKm2(rowLat(y), info.resolutionArcsec || 30);
      for (let x = 0; x < read.width; x += 1) {
        const i = y * read.width + x;
        if (!isNoData(values[i], info.noData)) values[i] *= per;
      }
    }
    const counts = DENSITY_LABELS.map(() => 0); let none = 0; let seen = 0; let total = 0;
    for (const v of values) {
      if (isNoData(v, info.noData)) continue;
      seen += 1;
      const c = classOf(v);
      if (c < 0) none += 1; else counts[c] += 1;
      total += v;
    }
    if (!seen) return { ok: false, message: "Nothing is modelled over this view." };
    const result = buildRasterLayer([values], read.width, read.height, {
      minX: read.bounds.west, maxX: read.bounds.east, minY: read.bounds.south, maxY: read.bounds.north,
    }, { name: LAYER_NAME, noData: info.noData, isDem: true, unit: "people/km²" });
    // The log classes, painted through the raster's own repaint seam.
    result.repaint?.((v) => colourOf(v, info.noData));
    result.legendInfo = legendFor([none, ...counts]);
    result.object3D?.traverse?.((node) => {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => { if (m && m.depthTest === false) m.depthWrite = false; });
    });
    const previous = populationLayer();
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(LAYER_NAME, result, "tiles");
    if (!layer) return { ok: false, message: "the layer could not be registered" };
    layer.legendInfo = result.legendInfo;
    const opening = previous && Number.isFinite(previous.opacity) ? previous.opacity : DEFAULT_OPACITY;
    window.GeoIDLayerHierarchy?.setOpacity?.(layer, opening);
    if (previous) {
      if (previous.visible === false) window.GeoIDLayerHierarchy?.setVisible?.(layer, false);
      window.GeoIDImportManager?.removeLayer?.(previous.id);
    }
    layer.info = { source: info.credit, summary: info.summary, citation: `${info.credit} ${info.doi ? `doi:${info.doi}` : ""}`.trim(), maths: mathsFor("worldpop") };
    layer.metadata = { ...(layer.metadata || {}), source: info.credit, citation: info.source, crs: "EPSG:4326" };
    window.GeoIDLayerHierarchy?.render?.();
    lastBuilt = bounds;
    const message = `${LAYER_NAME}: ${Math.round(total / Math.max(1, seen)).toLocaleString()} people per km² on average over this view, from the 1 km grid. ${info.credit}`;
    onStatus(message);
    return { ok: true, layer, message };
  } catch (error) {
    return { ok: false, message: `Population could not be read: ${error.message}` };
  } finally {
    busy = false;
  }
}

function watch() {
  if (watchStop) return;
  const viewer = window.GeoIDViewer;
  if (!viewer) return;
  watchStop = onViewSettled(viewer, () => {
    if (!populationLayer() || !meta) return;
    const next = targetBounds(meta);
    const asView = (b) => ({ minLon: b.west, maxLon: b.east, minLat: b.south, maxLat: b.north });
    if (lastBuilt && !viewChangedEnough(asView(lastBuilt), asView(next))) return;
    void build();
  }, { settleMs: 900, pollMs: 150 });
}

export async function addPopulation(onStatus = () => {}) {
  if (populationLayer()) return { ok: true, message: `${LAYER_NAME} is already on the globe.` };
  if (!three) three = await import("../vendor/three.module.js");
  const out = await build({ onStatus });
  if (out.ok) {
    watch();
    const centre = window.GeoIDViewer?.getViewCentreLatLon?.();
    if (Number.isFinite(centre?.lat) && Number.isFinite(centre?.lon)) void sampleAt(centre.lat, centre.lon).catch(() => {});
  }
  return out;
}

export function removePopulation() {
  const layer = populationLayer();
  watchStop?.(); watchStop = null; lastBuilt = null;
  if (!layer) return false;
  window.GeoIDImportManager?.removeLayer?.(layer.id);
  return true;
}

if (typeof window !== "undefined") {
  window.GeoIDWorldPop = {
    LAYER_NAME, populationLayer, sampleAt, probeAt, addPopulation, removePopulation,
    classOf, colourOf, legendFor, populationCard, cellAreaKm2, DENSITY_EDGES, DENSITY_LABELS,
  };
}
