/**
 * GeoID mode: the risk pipeline, running on the globe.
 *
 * Not a pin with panels. The prototype's static inputs — slope from the DEM,
 * strength from the geology — plus a weather surface that MOVES, giving a
 * Factor of Safety for every cell at every step. The globe shows the step the
 * clock is on; the pill scrubs it; the Hub charts the same numbers.
 *
 * Six pieces, in the order the data flows:
 *
 *   1. a rainfall SURFACE for the study area, per day, from GFS
 *   2. one cell table: slope and material on a common grid
 *   3. fosSeries over it — sixteen grids
 *   4. one draped layer whose values change with the step
 *   5. the view locked over the area, spin compensated
 *   6. the step chosen by the simulated clock, and posted to the Hub
 *
 * Everything above `run()` is pure and tested; `run()` is the impure spine that
 * fetches, samples and draws.
 */

import { fosSeries, wetnessSeries, materialFor, stabilityBand } from "./fos.js?v=20260816-471dc39";
import { makeRaster, slope as slopeOf } from "./raster-analysis.js?v=20260816-471dc39";
import { SOURCE as WEATHER_SOURCE } from "./forecast.js?v=20260816-471dc39";

/* ── 1. the weather SURFACE ─────────────────────────────────────────────── */

/**
 * A coarse lat/lon grid over the study area — the points GFS is asked about.
 *
 * Coarse on purpose: GFS is a ~25 km model, so asking for a point every cell
 * would be inventing detail the forecast does not have, and Open-Meteo takes
 * a list of coordinates in one request, which keeps this to a single call.
 */
export function weatherPoints(bounds, { across = 4 } = {}) {
  const { minX, minY, maxX, maxY } = bounds || {};
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [];
  const n = Math.max(2, Math.min(8, Math.round(across)));
  const out = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      out.push({
        lat: minY + ((j + 0.5) / n) * (maxY - minY),
        lon: minX + ((i + 0.5) / n) * (maxX - minX),
      });
    }
  }
  return out;
}

export function weatherUrl(points, { days = 16 } = {}) {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    daily: "precipitation_sum",
    forecast_days: String(Math.max(1, Math.min(16, days))),
    models: "gfs_seamless",
    timezone: "UTC",
  });
  return `${WEATHER_SOURCE.endpoint}?${q}`;
}

/**
 * The response for many points is an ARRAY of per-point objects; for one point
 * it is a single object. Handling only the array shape works until someone
 * draws a small area, which is the case most likely to be tried first.
 */
export function parseWeatherGrid(json, points) {
  const list = Array.isArray(json) ? json : [json];
  const series = list.map((entry, i) => ({
    lat: Number.isFinite(entry?.latitude) ? entry.latitude : points[i]?.lat,
    lon: Number.isFinite(entry?.longitude) ? entry.longitude : points[i]?.lon,
    dates: entry?.daily?.time || [],
    rain: (entry?.daily?.precipitation_sum || []).map((v) => (Number.isFinite(v) ? v : null)),
  })).filter((s) => s.rain.length);
  if (!series.length) return { ok: false, message: "the forecast returned no daily rainfall" };
  const dates = series[0].dates;
  if (series.some((s) => s.rain.every((v) => v == null))) {
    return { ok: false, message: "the forecast returned nulls — the model has no data here" };
  }
  return { ok: true, dates, series };
}

/** Inverse-distance rainfall at a cell for one day, from the coarse points. */
export function rainAt(series, lat, lon, step) {
  let num = 0;
  let den = 0;
  for (const s of series) {
    const v = s.rain[step];
    if (!Number.isFinite(v)) continue;
    const d2 = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
    if (d2 < 1e-10) return v;                       // on the point
    const w = 1 / d2;
    num += w * v;
    den += w;
  }
  return den ? num / den : null;
}

/* ── 2. the cell table ──────────────────────────────────────────────────── */

/**
 * Slope and material for every cell of a grid over the study area.
 *
 * The grid is the DEM's own, clipped to the area and thinned to a cell budget:
 * a 100 m DEM over a country is 2.6 million cells and sixteen steps of that is
 * forty million numbers, which is not a browser's work. Thinning is stated in
 * the result rather than hidden, because the FoS map's resolution is a fact
 * about the answer.
 */
export function buildCells(demRaster, bounds, {
  maxCells = 40000, geologyAt = null,
} = {}) {
  if (!demRaster?.band) return { ok: false, message: "no DEM to take slope from" };
  const grad = slopeOf(demRaster);
  const { width, height } = demRaster;
  const b = demRaster.bounds;
  const area = bounds || b;
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxCells)));
  const cells = [];
  const lats = [];
  const lons = [];
  for (let y = 0; y < height; y += stride) {
    const lat = b.maxY - ((y + 0.5) / height) * (b.maxY - b.minY);
    if (lat < area.minY || lat > area.maxY) continue;
    for (let x = 0; x < width; x += stride) {
      const lon = b.minX + ((x + 0.5) / width) * (b.maxX - b.minX);
      if (lon < area.minX || lon > area.maxX) continue;
      const slopeDeg = grad.band[y * width + x];
      if (!Number.isFinite(slopeDeg)) continue;
      const description = geologyAt ? geologyAt(lat, lon) : null;
      cells.push({ slopeDeg, material: materialFor(description), lat, lon });
      lats.push(lat);
      lons.push(lon);
    }
  }
  if (!cells.length) return { ok: false, message: "no DEM cells fall inside the study area" };
  const cols = new Set(lons).size;
  const rows = new Set(lats).size;
  return {
    ok: true, cells, stride, cols, rows,
    bounds: {
      minX: Math.min(...lons), maxX: Math.max(...lons),
      minY: Math.min(...lats), maxY: Math.max(...lats),
    },
    message: `${cells.length.toLocaleString()} cells at ${stride}x the DEM's spacing`,
  };
}

/* ── 4/6. colours and the step the clock is on ──────────────────────────── */

const BAND_COLOUR = {
  failure: [215, 25, 28],
  marginal: [253, 141, 60],
  "low margin": [254, 217, 118],
  adequate: [161, 218, 180],
  stable: [44, 127, 184],
};

export function fosColour(value) {
  const band = stabilityBand(value);
  return band ? BAND_COLOUR[band] : null;
}

/** Which step a simulated clock is showing, given the run's own dates. */
export function stepForClock(utcMs, dates) {
  if (!dates?.length) return 0;
  const day = new Date(utcMs);
  if (Number.isNaN(day.getTime())) return 0;
  const iso = day.toISOString().slice(0, 10);
  const exact = dates.indexOf(iso);
  if (exact >= 0) return exact;
  // Outside the forecast — clamp rather than wrap, so a clock that has run
  // past the horizon holds the last step instead of jumping back to day one
  // and implying the weather repeated.
  return iso < dates[0] ? 0 : dates.length - 1;
}

if (typeof window !== "undefined") {
  window.GeoIDPipeline = {
    weatherPoints, weatherUrl, parseWeatherGrid, rainAt,
    buildCells, fosColour, stepForClock, wetnessSeries, fosSeries,
  };
}
