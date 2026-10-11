/**
 * Climate change from the Earth Engine archive: the pure half.
 *
 * A climate signal is a CHANGE against a normal, so the unit of this module is
 * not a picture but a STACK — one composite of the same window (a season, a
 * month or the whole year) for every year asked for, decoded from the
 * service's rendering back to the dataset's own numbers with the same palette
 * inversion every other GEE reader here uses (`gee-sample.js`). From the stack:
 *
 *   anomaly  a_y(p) = v_y(p) − mean_{baseline}(v(p))         per pixel, per year
 *   trend    Sen's slope, the median of (v_j − v_i)/(y_j − y_i) over every
 *            pair of years — robust to the odd wild year, which a least-squares
 *            line is not — reported per decade
 *   test     Mann–Kendall: S = Σ sgn(v_j − v_i), Var(S) = n(n−1)(2n+5)/18,
 *            Z = (S ∓ 1)/√Var, two-sided p from the normal; a pixel is
 *            significant at p < 0.05
 *   series   the area mean of each year, weighted by cos(latitude) so a high-
 *            latitude row does not count for more ground than it covers
 *
 * Nothing here fetches or draws; the panel does both.
 */

import { decodeRainPixels } from "./gee-rain.js";

/**
 * WHAT CAN BE ANIMATED is what the deployed service renders: the curated
 * collections, each with a first year it holds and the way a window of it
 * composites. `reducer: "sum"` means the window's TOTAL (rainfall), which is
 * why rain is read against a ramp that can saturate; the others are means.
 * The anomaly palettes run from the "worse" end through white, with the sign
 * convention stated, because blue meaning colder and blue meaning wetter are
 * two different statements.
 */
export const CLIMATE_VARS = {
  lst: {
    label: "Land surface temperature (MODIS, 8-day, 1 km)",
    short: "Land surface temperature",
    dataset: "MODIS/061/MOD11A2",
    unit: "°C",
    firstYear: 2001,
    reducer: "mean",
    defaultWindow: "jja",
    anomalyPalette: ["053061", "4393c3", "f7f7f7", "d6604d", "67001f"],
    paletteSays: "blue colder, red warmer than the baseline",
  },
  rain: {
    label: "Rainfall (CHIRPS, daily, 5 km)",
    short: "Rainfall",
    dataset: "UCSB-CHG/CHIRPS/DAILY",
    unit: "mm",
    firstYear: 1981,
    reducer: "sum",
    defaultWindow: "m07",
    maxLat: 50,
    anomalyPalette: ["8c510a", "d8b365", "f7f7f7", "5ab4ac", "01665e"],
    paletteSays: "brown drier, teal wetter than the baseline",
  },
  ndvi: {
    label: "Vegetation (MODIS NDVI, 16-day, 1 km)",
    short: "Vegetation (NDVI)",
    dataset: "MODIS/061/MOD13A2",
    unit: "",
    firstYear: 2001,
    reducer: "mean",
    defaultWindow: "jja",
    anomalyPalette: ["8c510a", "d8b365", "f7f7f7", "7fbf7b", "1b7837"],
    paletteSays: "brown less green, green greener than the baseline",
  },
  smap: {
    label: "Soil moisture (SMAP L4, 9 km)",
    short: "Soil moisture",
    dataset: "NASA/SMAP/SPL4SMGP/007",
    unit: "m³/m³",
    firstYear: 2016,
    reducer: "mean",
    defaultWindow: "jja",
    anomalyPalette: ["8c510a", "d8b365", "f7f7f7", "5ab4ac", "01665e"],
    paletteSays: "brown drier, teal wetter than the baseline",
  },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The windows a year can be read over. DJF is the winter that ENDS in the
 * year named, so "DJF 2020" is Dec 2019 – Feb 2020 — the convention every
 * seasonal climate product uses, stated so it is not mistaken for the other.
 */
export const WINDOWS = [
  { id: "year", label: "Whole year" },
  { id: "djf", label: "Dec–Feb (winter ending in the year)" },
  { id: "mam", label: "Mar–May" },
  { id: "jja", label: "Jun–Aug" },
  { id: "son", label: "Sep–Nov" },
  ...MONTHS.map((m, i) => ({ id: `m${String(i + 1).padStart(2, "0")}`, label: m })),
];

const pad = (n) => String(n).padStart(2, "0");

/** The window of one year as ISO dates, the end exclusive: `{ from, to, days }`. */
export function windowOf(year, id) {
  const y = Number(year);
  let from; let to;
  if (id === "year") { from = `${y}-01-01`; to = `${y + 1}-01-01`; }
  else if (id === "djf") { from = `${y - 1}-12-01`; to = `${y}-03-01`; }
  else if (id === "mam") { from = `${y}-03-01`; to = `${y}-06-01`; }
  else if (id === "jja") { from = `${y}-06-01`; to = `${y}-09-01`; }
  else if (id === "son") { from = `${y}-09-01`; to = `${y}-12-01`; }
  else if (/^m(0[1-9]|1[0-2])$/.test(id)) {
    const m = Number(id.slice(1));
    from = `${y}-${pad(m)}-01`;
    to = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  } else {
    throw new Error(`No such window: ${id}`);
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  return { from, to, days };
}

/**
 * The years a request can honestly ask for: inside what the dataset holds,
 * and never a window that has not finished — a summer still under way is a
 * partial composite, and its "anomaly" is the part of the summer missing.
 */
export function yearsFor(variable, fromYear, toYear, windowId, nowMs = Date.now()) {
  const spec = CLIMATE_VARS[variable];
  if (!spec) throw new Error(`No such variable: ${variable}`);
  const lo = Math.max(spec.firstYear + (windowId === "djf" ? 1 : 0), Math.round(Number(fromYear)));
  const hi = Math.round(Number(toYear));
  const years = [];
  for (let y = lo; y <= hi; y += 1) {
    const w = windowOf(y, windowId);
    if (Date.parse(`${w.to}T00:00:00Z`) <= nowMs) years.push(y);
  }
  return years;
}

/**
 * The top of a summed rainfall composite's ramp for a window that long, the
 * same steps the landslide pipeline asks the service for. A deployment that
 * does not know `max` ignores it; the decoder then counts the pixels sitting
 * at the old top, which is what `capped` reports.
 */
export function rampMaxForDays(days) {
  if (days <= 1.01) return 300;
  if (days <= 8) return 800;
  if (days <= 32) return 2000;
  if (days <= 100) return 4000;
  return 10000;
}

/** A rendered picture back to numbers; transparent and off-ramp pixels are NaN. */
export function decodeScene(data, width, height, { palette, legend }) {
  return decodeRainPixels(data, width, height, { palette, legend });
}

/**
 * Bring a grid to a common size by nearest neighbour. The service answers the
 * same dimensions for the same box, so this is normally the identity; it is
 * here because a stack that silently mixes two pixel sizes would compare
 * different ground pixel by pixel.
 */
export function alignGrid(values, width, height, toWidth, toHeight) {
  if (width === toWidth && height === toHeight) return values;
  const out = new Float32Array(toWidth * toHeight);
  for (let j = 0; j < toHeight; j += 1) {
    const sj = Math.min(height - 1, Math.floor(((j + 0.5) / toHeight) * height));
    for (let i = 0; i < toWidth; i += 1) {
      const si = Math.min(width - 1, Math.floor(((i + 0.5) / toWidth) * width));
      out[j * toWidth + i] = values[sj * width + si];
    }
  }
  return out;
}

/** The per-pixel mean over the frames at `indices`, NaN where none has a value. */
export function baselineMean(frames, indices) {
  const n = frames[0].length;
  const out = new Float32Array(n);
  for (let p = 0; p < n; p += 1) {
    let sum = 0; let count = 0;
    for (const k of indices) {
      const v = frames[k][p];
      if (Number.isFinite(v)) { sum += v; count += 1; }
    }
    out[p] = count ? sum / count : NaN;
  }
  return out;
}

/** Every frame less the baseline, NaN where either is missing. */
export function anomalies(frames, base) {
  return frames.map((f) => {
    const out = new Float32Array(f.length);
    for (let p = 0; p < f.length; p += 1) out[p] = f[p] - base[p];
    return out;
  });
}

/**
 * A SYMMETRIC range about zero from the anomalies' own spread — the 98th
 * percentile of |a| over every frame — so one wild pixel does not wash the
 * whole sequence to white, and zero stays the colour of "as normal" in every
 * frame. Fixed across the sequence: a range recomputed per frame makes the
 * map about the frame rather than about the change.
 */
export function symmetricRange(stack, q = 0.98) {
  const sample = [];
  const step = Math.max(1, Math.floor((stack.length * stack[0].length) / 200000));
  let i = 0;
  for (const f of stack) {
    for (let p = 0; p < f.length; p += 1) {
      if ((i += 1) % step) continue;
      const v = f[p];
      if (Number.isFinite(v)) sample.push(Math.abs(v));
    }
  }
  if (!sample.length) return 1;
  sample.sort((a, b) => a - b);
  const r = sample[Math.min(sample.length - 1, Math.floor(q * (sample.length - 1)))];
  return r > 0 ? r : (sample[sample.length - 1] || 1);
}

/** Standard normal two-sided p for a z-score (Abramowitz & Stegun 7.1.26). */
export function twoSidedP(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - erf));
}

/**
 * Sen's slope and Mann–Kendall for one series. `values[k]` at `years[k]`;
 * NaNs are skipped, and fewer than four finite years is not a trend.
 * Returns `{ slope (per year), s, z, p, n }`.
 */
export function senMannKendall(values, years) {
  const xs = []; const ys = [];
  for (let k = 0; k < values.length; k += 1) {
    if (Number.isFinite(values[k])) { xs.push(years[k]); ys.push(values[k]); }
  }
  const n = xs.length;
  if (n < 4) return { slope: NaN, s: 0, z: 0, p: 1, n };
  const slopes = [];
  let s = 0;
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dy = ys[j] - ys[i];
      s += dy > 0 ? 1 : dy < 0 ? -1 : 0;
      if (xs[j] !== xs[i]) slopes.push(dy / (xs[j] - xs[i]));
    }
  }
  slopes.sort((a, b) => a - b);
  const m = slopes.length;
  const slope = m ? (m % 2 ? slopes[(m - 1) >> 1] : (slopes[m / 2 - 1] + slopes[m / 2]) / 2) : NaN;
  const variance = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0;
  return { slope, s, z, p: twoSidedP(z), n };
}

/**
 * The trend at every pixel: `{ slope (per DECADE), p, n }` arrays. Quadratic
 * in the number of years per pixel; at forty years and a 512 x 256 grid that
 * is about a hundred million comparisons, which the caller runs in slices so
 * the page keeps drawing.
 */
export function pixelTrends(frames, years, { from = 0, to = null, out = null } = {}) {
  const n = frames[0].length;
  const end = to == null ? n : Math.min(n, to);
  const slope = out?.slope || new Float32Array(n).fill(NaN);
  const p = out?.p || new Float32Array(n).fill(NaN);
  const count = out?.n || new Uint8Array(n);
  const series = new Float64Array(frames.length);
  for (let q = from; q < end; q += 1) {
    for (let k = 0; k < frames.length; k += 1) series[k] = frames[k][q];
    const t = senMannKendall(series, years);
    slope[q] = t.slope * 10;
    p[q] = t.p;
    count[q] = t.n;
  }
  return { slope, p, n: count };
}

/** cos(latitude) of each row's centre over a box, for area weighting. */
export function rowWeights(height, north, south) {
  const w = new Float64Array(height);
  for (let j = 0; j < height; j += 1) {
    const lat = north - ((j + 0.5) / height) * (north - south);
    w[j] = Math.max(0, Math.cos((lat * Math.PI) / 180));
  }
  return w;
}

/**
 * The area-weighted mean of each frame over the pixels valid in EVERY frame —
 * so the series compares the same ground year to year, rather than a mean
 * that moves because cloud took a different corner each summer. Where fewer
 * than a tenth of the pixels are valid throughout, each frame is averaged
 * over its own valid pixels and `common` is false, which the panel says.
 */
export function areaSeries(frames, width, height, bounds) {
  const w = rowWeights(height, bounds.north, bounds.south);
  const n = width * height;
  const mask = new Uint8Array(n).fill(1);
  for (const f of frames) for (let p = 0; p < n; p += 1) if (!Number.isFinite(f[p])) mask[p] = 0;
  let valid = 0;
  for (let p = 0; p < n; p += 1) valid += mask[p];
  const common = valid >= n * 0.1;
  const means = frames.map((f) => {
    let sum = 0; let wt = 0;
    for (let p = 0; p < n; p += 1) {
      if (common ? !mask[p] : !Number.isFinite(f[p])) continue;
      const k = w[Math.floor(p / width)];
      sum += f[p] * k; wt += k;
    }
    return wt ? sum / wt : NaN;
  });
  return { means, common, validShare: valid / n };
}

/** Hex "rrggbb" to [r, g, b]. */
function rgb(hex) {
  return [0, 2, 4].map((i) => parseInt(String(hex).slice(i, i + 2), 16));
}

/** The palette's colour at t in 0..1, linear between stops. */
export function paletteAt(palette, t) {
  const stops = palette.map(rgb);
  const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5)) * (stops.length - 1);
  const k = Math.min(stops.length - 2, Math.floor(u));
  const f = u - k;
  return stops[k].map((c, i) => Math.round(c + (stops[k + 1][i] - c) * f));
}

/**
 * A frame as RGBA on a diverging palette over [-range, +range]. NaN is fully
 * transparent (no data is not "as normal"); `fade` dims chosen pixels to a
 * third of the alpha — the trend map uses it for a slope that is not
 * significant, so it is still there to read and does not claim the eye.
 */
export function frameRGBA(values, palette, range, { alpha = 235, fade = null } = {}) {
  const out = new Uint8ClampedArray(values.length * 4);
  for (let p = 0; p < values.length; p += 1) {
    const v = values[p];
    if (!Number.isFinite(v)) continue;
    const [r, g, b] = paletteAt(palette, 0.5 + v / (2 * range));
    out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b;
    out[p * 4 + 3] = fade && fade[p] ? Math.round(alpha / 3) : alpha;
  }
  return out;
}

/** "+1.2 °C", "−34 mm", "+0.03": signed, to a sensible precision for its size. */
export function signed(v, unit = "") {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 3 : 4;
  const text = `${v < 0 ? "−" : "+"}${a.toFixed(digits)}`;
  return unit ? `${text} ${unit}` : text;
}

/** The pixel a coordinate falls in over a box, or -1. Longitudes signed. */
export function pixelOf(lat, lon, bounds, width, height) {
  const lonE = (((lon + 540) % 360) - 180);
  if (lat < bounds.south || lat > bounds.north || lonE < bounds.west || lonE > bounds.east) return -1;
  const i = Math.min(width - 1, Math.floor(((lonE - bounds.west) / (bounds.east - bounds.west)) * width));
  const j = Math.min(height - 1, Math.floor(((bounds.north - lat) / (bounds.north - bounds.south)) * height));
  return j * width + i;
}

/** A tidy CSV of the area series: year, mean, anomaly. */
export function seriesCsv(years, means, baseMean, unit, variableLabel) {
  const u = unit ? ` (${unit})` : "";
  const rows = [`year,mean${u},anomaly${u}`];
  years.forEach((y, k) => {
    const m = means[k];
    rows.push(`${y},${Number.isFinite(m) ? m.toFixed(5) : ""},${Number.isFinite(m) && Number.isFinite(baseMean) ? (m - baseMean).toFixed(5) : ""}`);
  });
  return `# ${variableLabel}\n${rows.join("\n")}\n`;
}
