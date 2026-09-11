/**
 * HISTORICAL RAINFALL FROM EARTH ENGINE, as daily maps in millimetres.
 *
 * The GEE service renders pictures, not numbers: each request is one billed
 * composite through a palette. The rainfall datasets are rendered on one known
 * ramp (0–300 mm through four stops, the service's own CHIRPS entry), so a
 * pixel's place along the ramp IS its value — `gee-sample.js` already inverts
 * drapes this way, measured to within about 1.2 mm on CHIRPS, and the same
 * `paletteRamp` / `valueFromColour` do it here rather than a second copy.
 *
 * ONE DAY PER REQUEST. A map over a window is then any sum of days, done here,
 * so a 24 h and a 72 h window cost the same renders, and a day already fetched
 * is never asked for again (a module cache keyed by dataset, box and day).
 *
 * Three archives, and which of them the DEPLOYED service renders is a fact
 * measured against it, not assumed: CHIRPS answers; IMERG and ERA5-Land answer
 * "Unknown or unsupported dataset" until services/gee-tiles is redeployed with
 * the entries this commit adds. The reader says which, rather than failing
 * silently.
 *
 *   CHIRPS v2   0.05° (~5.5 km), daily, 1981 → ~6 weeks ago, land, 50°S–50°N
 *   IMERG V07   0.1°, half-hourly summed to days, 1998 → yesterday, 60°S–60°N
 *   GSMaP v8    0.1°, hourly summed to days, 1998 → hours ago, 60°S–60°N
 *   ERA5-Land   0.1°, daily aggregate, 1950 → ~a week ago, land, global
 */

import { paletteRamp, valueFromColour } from "./gee-sample.js?v=20260911-e80ef43";

const search = new URL(import.meta.url).search;

export const GEE_RAIN_SOURCES = {
  chirps: {
    dataset: "UCSB-CHG/CHIRPS/DAILY", label: "CHIRPS (Earth Engine)", short: "CHIRPS",
    res: "~5.5 km", maxLat: 50, credit: "UCSB Climate Hazards Center CHIRPS v2, via Google Earth Engine",
  },
  imerg: {
    dataset: "NASA/GPM_L3/IMERG_V07", label: "GPM IMERG (Earth Engine)", short: "IMERG",
    res: "~11 km", maxLat: 60, credit: "NASA GPM IMERG V07, via Google Earth Engine",
  },
  gsmap: {
    dataset: "JAXA/GPM_L3/GSMaP/v8/operational", label: "GSMaP (Earth Engine)", short: "GSMaP",
    res: "~11 km", maxLat: 60, credit: "JAXA GSMaP v8 operational, via Google Earth Engine",
  },
  era5land: {
    dataset: "ECMWF/ERA5_LAND/DAILY_AGGR", label: "ERA5-Land (Earth Engine)", short: "ERA5-Land",
    res: "~9 km", maxLat: 90, credit: "Copernicus C3S ERA5-Land, via Google Earth Engine",
  },
};

const DAY_MS = 86400000;
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const nextDay = (day) => isoDay(Date.parse(`${day}T00:00:00Z`) + DAY_MS);

/** Every day from `from` to `to` inclusive. */
export function daysBetween(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) out.push(isoDay(t));
  return out;
}

/** Whether a source covers a box at all: CHIRPS stops at 50° either side. */
export function coversBox(source, bounds) {
  const s = GEE_RAIN_SOURCES[source];
  return Boolean(s) && bounds.north <= s.maxLat && bounds.south >= -s.maxLat;
}

/**
 * A rendered picture back to millimetres, one pixel at a time. Few colours
 * appear in a rainfall render (CHIRPS over a study area is tens of distinct
 * pixels scaled up), so each colour is inverted once and remembered. A
 * transparent pixel (outside the data — the sea, for CHIRPS) is NaN.
 */
export function decodeRainPixels(data, width, height, { palette, legend }) {
  const ramp = paletteRamp(palette);
  const seen = new Map();
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4]; const g = data[i * 4 + 1]; const b = data[i * 4 + 2]; const a = data[i * 4 + 3];
    if (a < 24) { out[i] = NaN; continue; }
    const key = (r << 16) | (g << 8) | b;
    let v = seen.get(key);
    if (v === undefined) {
      v = valueFromColour({ r, g, b, a }, ramp, legend);
      v = v === null ? NaN : v;
      seen.set(key, v);
    }
    out[i] = v;
  }
  return out;
}

/** The pixel a coordinate falls in, or -1 outside the picture. */
export function pixelIndex(grid, lat, lon) {
  const { minX, minY, maxX, maxY } = grid.bounds;
  const lonE = (((lon + 540) % 360) - 180);
  if (lat < minY || lat > maxY || lonE < minX || lonE > maxX) return -1;
  const px = Math.min(grid.width - 1, Math.floor(((lonE - minX) / (maxX - minX)) * grid.width));
  const py = Math.min(grid.height - 1, Math.floor(((maxY - lat) / (maxY - minY)) * grid.height));
  return py * grid.width + px;
}

/** The service's refusal of a dataset it has no entry for, said as what it means. */
function notDeployed(s, error) {
  return /unknown or unsupported/i.test(error?.message || "")
    ? new Error(`the deployed Earth Engine service does not render ${s.short} yet — redeploy services/gee-tiles to add it`)
    : error;
}

const cache = new Map();
const datesCache = new Map();

/** The first and last day the service holds for a source. */
export async function geeRainDates(source) {
  const s = GEE_RAIN_SOURCES[source];
  if (datesCache.has(s.dataset)) return datesCache.get(s.dataset);
  const { fetchDates } = await import(`./gee.js${search}`);
  let got;
  try { got = await fetchDates(s.dataset); } catch (error) { throw notDeployed(s, error); }
  datesCache.set(s.dataset, got);
  return got;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the rendered image could not be read"));
    image.src = url;
  });
}

/** One day's rainfall over a box, as a decoded grid: `{ day, values, width, height, bounds }`. */
export async function fetchGeeRainDay(source, bounds, day) {
  const s = GEE_RAIN_SOURCES[source];
  const key = `${s.dataset}|${[bounds.west, bounds.south, bounds.east, bounds.north].map((v) => v.toFixed(4)).join(",")}|${day}`;
  if (cache.has(key)) return cache.get(key);
  const { fetchScene } = await import(`./gee.js${search}`);
  let scene;
  try {
    scene = await fetchScene({ dataset: s.dataset, bounds, from: day, to: nextDay(day), dimensions: 1024 });
  } catch (error) {
    throw notDeployed(s, error);
  }
  if (!scene?.imageUrl) throw new Error(`Earth Engine returned no ${s.short} picture for ${day}`);
  const image = await loadImage(scene.imageUrl);
  const width = image.naturalWidth; const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  const values = decodeRainPixels(data, width, height, { palette: scene.palette, legend: scene.legend });
  const grid = { day, values, width, height, bounds: scene.bounds, source };
  cache.set(key, grid);
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  return grid;
}

/** Every day in a list, a few at a time, reporting as it goes. */
export async function fetchGeeRainDays(source, bounds, days, { onProgress = () => {}, parallel = 3 } = {}) {
  const out = new Array(days.length);
  let next = 0; let done = 0;
  const worker = async () => {
    while (next < days.length) {
      const k = next; next += 1;
      // eslint-disable-next-line no-await-in-loop
      out[k] = await fetchGeeRainDay(source, bounds, days[k]);
      done += 1; onProgress(done, days.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, days.length) }, worker));
  return out;
}
