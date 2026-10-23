/**
 * ECMWF IFS analysis on its own grid — the arithmetic, with no page in it.
 *
 * THE ARCHIVE. Beyond Weather's "ECMWF IFS Analysis N320" on the AWS Open Data
 * registry: ECMWF's operational analysis (class=od, stream=oper, type=an),
 * 6-hourly from 2011-01-01 00 UTC to 2026-09-30 18 UTC, 23,008 timesteps, as
 * an Icechunk (Zarr v3) repository in `s3://beyond-weather-ecmwf-ifs-analysis/
 * data.zarr`, us-east-2, anonymous, CORS open. CC BY 4.0 under ECMWF's terms.
 *
 * THE GRID is N320 reduced Gaussian: 640 rows of latitude, north to south, at
 * the roots of the Legendre polynomial of degree 640, each row a ring of
 * `pl[j]` equally spaced points starting at 0° E (18 at the poles, 1,280 at
 * the equator), 542,080 points in all, flattened row by row. The row lengths
 * ride in every array's `GRIB_pl` attribute; the latitudes are computed here
 * rather than downloaded (the /latitude array is 8 extra requests).
 *
 * ONE CHUNK IS ONE TIMESTEP OF ONE VARIABLE OVER THE WHOLE WORLD: (1, 542080)
 * for a surface field, ~0.2–0.36 MB compressed; (1, 18, 542080) for an upper-
 * air field, ~7 MB, since the 18 levels share the chunk. So the bytes do not
 * shrink with the area asked for. What the area decides is the lattice this
 * regrids onto: a degree over the world, the grid's own ~0.28° over a view or
 * a drawn area — the multi-resolution lives here, not in the download.
 *
 * Chunks are Blosc (Zstandard, byte shuffle). `decodeBlosc` is c-blosc 1.x's
 * frame read by hand with the zstd step passed in, so this file stays free of
 * imports and Node can test it.
 */

export const IFS_REPO = "https://beyond-weather-ecmwf-ifs-analysis.s3.us-east-2.amazonaws.com/data.zarr";
export const IFS_REGISTRY = "https://registry.opendata.aws/beyond-weather-ecmwf-ifs-analysis/";
export const IFS_CREDIT = "ECMWF IFS operational analysis, © 2011–2026 ECMWF, CC BY 4.0 — "
  + "via Beyond Weather's \"ECMWF IFS Analysis N320\" Icechunk Zarr on the Registry of Open Data on AWS. "
  + "This service is based on data and products of the European Centre for Medium-Range Weather "
  + "Forecasts (ECMWF).";

export const T0_MS = Date.UTC(2011, 0, 1, 0);
export const STEP_MS = 6 * 3600 * 1000;
export const STEPS = 23_008;
export const LAST_MS = T0_MS + (STEPS - 1) * STEP_MS;   // 2026-09-30 18 UTC
export const N = 320;
export const POINTS = 542_080;
/** The grid's spacing at the equator, degrees: 360 / 1280. */
export const NATIVE_DEG = 0.28125;
export const LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30, 10, 5, 2];
export const G = 9.80665;

/* ── time ──────────────────────────────────────────────────────────────── */

/**
 * The timestep nearest a moment: its index in the archive and its ISO time.
 * The time axis is exactly regular (checked: index 0 is 2011-01-01T00, index
 * 23,007 is 2026-09-30T18), so this is arithmetic, not a lookup. A moment
 * outside the archive clamps to its end and says so.
 */
export function timeIndex(when) {
  const ms = typeof when === "number" ? when : Date.parse(when);
  if (!Number.isFinite(ms)) return null;
  const raw = Math.round((ms - T0_MS) / STEP_MS);
  const index = Math.min(STEPS - 1, Math.max(0, raw));
  return {
    index,
    ms: T0_MS + index * STEP_MS,
    iso: new Date(T0_MS + index * STEP_MS).toISOString().slice(0, 13) + ":00Z",
    clamped: index !== raw,
  };
}

/* ── the grid ──────────────────────────────────────────────────────────── */

/**
 * Gaussian latitudes, degrees, north to south: asin of the roots of the
 * Legendre polynomial P_{2n}, by Newton from the usual cosine guess. Matches
 * the archive's own /latitude to 1e-9 (89.78487690721863° first).
 */
export function gaussianLatitudes(n = N) {
  const m = 2 * n;
  const out = new Float64Array(m);
  for (let i = 0; i < n; i += 1) {
    let x = Math.cos(Math.PI * (i + 0.75) / (m + 0.5));
    for (let iter = 0; iter < 100; iter += 1) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= m; k += 1) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1; p1 = p2;
      }
      const dp = (m * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    const lat = Math.asin(x) * 180 / Math.PI;
    out[i] = lat;
    out[m - 1 - i] = -lat;
  }
  return out;
}

/** The reduced grid from its row lengths: where each row starts in the flat array. */
export function reducedGrid(pl, lats = gaussianLatitudes(pl.length / 2)) {
  if (lats.length !== pl.length) throw new Error(`${pl.length} rows but ${lats.length} latitudes`);
  const start = new Int32Array(pl.length + 1);
  for (let j = 0; j < pl.length; j += 1) start[j + 1] = start[j] + pl[j];
  return { pl: Int32Array.from(pl), lats, start, points: start[pl.length] };
}

/** A row's value at a longitude, linear between its two neighbouring points. */
function rowValue(grid, values, j, lon) {
  const n = grid.pl[j];
  const x = ((((lon % 360) + 360) % 360) * n) / 360;
  const i0 = Math.floor(x) % n;
  const i1 = (i0 + 1) % n;
  const f = x - Math.floor(x);
  const a = values[grid.start[j] + i0];
  const b = values[grid.start[j] + i1];
  if (f === 0) return a;
  return a + (b - a) * f;
}

/** The row at or north of a latitude (rows run north to south), by bisection. */
export function rowAbove(lats, lat) {
  let lo = 0;
  let hi = lats.length - 1;
  if (lat >= lats[0]) return 0;
  if (lat <= lats[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lats[mid] >= lat) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Bilinear on a reduced grid: linear along each of the two rows that bracket
 * the latitude, then linear between them. North of the first row or south of
 * the last the nearest row answers alone (the cap is 0.2° wide). NaN at any
 * neighbour with weight answers NaN — sea surface temperature is NaN over
 * land, and a coastline blended toward NaN should end, not smear.
 */
export function sampleReduced(grid, values, lat, lon) {
  const { lats } = grid;
  const last = lats.length - 1;
  if (lat >= lats[0]) return rowValue(grid, values, 0, lon);
  if (lat <= lats[last]) return rowValue(grid, values, last, lon);
  const j = rowAbove(lats, lat);
  const t = (lats[j] - lat) / (lats[j] - lats[j + 1]);
  const a = rowValue(grid, values, j, lon);
  const b = rowValue(grid, values, j + 1, lon);
  if (t === 0) return a;
  if (t === 1) return b;
  return a + (b - a) * t;
}

/**
 * The lattice for a box: a degree over the world, never finer than the grid
 * itself over a part of it, and at most `maxCells` nodes either way.
 *
 * Laid out as `flow-field.js`'s `gridPoints` lays a lattice: row j from the
 * south, column i from the west; a global box has `nx` columns 360/nx apart
 * with no repeated seam, a regional one `nx` columns edge to edge.
 */
export function latticeFor(box, { worldDeg = 1, nativeDeg = NATIVE_DEG, maxCells = 160_000 } = {}) {
  const global = box.east - box.west >= 359.999;
  const w = box.east - box.west;
  const h = box.north - box.south;
  let deg = global ? worldDeg : nativeDeg;
  if ((w / deg) * (h / deg) > maxCells) deg = Math.sqrt((w * h) / maxCells);
  const nx = global ? Math.round(360 / deg) : Math.max(2, Math.round(w / deg) + 1);
  const ny = Math.max(2, Math.round(h / deg) + 1);
  return { nx, ny, deg, global };
}

/**
 * Regrid a reduced-grid field onto a box's lattice, optionally through a unit
 * conversion. Answers a Float32Array, row j from the south.
 */
export function regrid(grid, values, box, nx, ny, convert = null) {
  const global = box.east - box.west >= 359.999;
  const dLon = (box.east - box.west) / (global ? nx : Math.max(1, nx - 1));
  const dLat = (box.north - box.south) / Math.max(1, ny - 1);
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    const lat = box.south + j * dLat;
    for (let i = 0; i < nx; i += 1) {
      const v = sampleReduced(grid, values, lat, box.west + i * dLon);
      out[j * nx + i] = convert && Number.isFinite(v) ? convert(v) : v;
    }
  }
  return out;
}

/** The smallest and largest finite values, and how many there were. */
export function rangeOf(arr) {
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (const x of arr) {
    if (!Number.isFinite(x)) continue;
    n += 1;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return { min: lo, max: hi, valid: n };
}

/* ── the chunk codec ───────────────────────────────────────────────────── */

/**
 * c-blosc 1.x frame to bytes. Header: version, versionlz, flags, typesize,
 * then nbytes, blocksize, cbytes as little-endian uint32. Flags: 0x1 byte
 * shuffle, 0x2 stored raw (memcpyed), 0x4 bit shuffle, 0x10 blocks not split
 * by byte, bits 5–7 the codec (4 = zstd). Then one int32 start offset per
 * block; each block holds one stream (or `typesize` streams when split), each
 * prefixed by its compressed length — a length equal to the stream's size
 * means it was stored raw. `zstd(bytes, size)` decompresses one stream.
 */
export function decodeBlosc(buf, { zstd } = {}) {
  const src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const flags = src[2];
  const typesize = src[3];
  const nbytes = dv.getUint32(4, true);
  const blocksize = dv.getUint32(8, true);
  const out = new Uint8Array(nbytes);
  if (flags & 0x2) {
    out.set(src.subarray(16, 16 + nbytes));
    return out;
  }
  if (flags & 0x4) throw new Error("blosc bit-shuffle is not supported");
  const codec = flags >> 5;
  if (codec !== 4 && !zstd) throw new Error(`blosc codec ${codec} needs a decoder`);
  if (codec !== 4) throw new Error(`blosc codec ${codec} is not supported (only zstd)`);
  const nblocks = Math.ceil(nbytes / blocksize);
  const leftover = nbytes % blocksize;
  const dontSplit = (flags & 0x10) !== 0;
  const shuffle = (flags & 0x1) !== 0 && typesize > 1;
  const tmp = new Uint8Array(blocksize);
  for (let b = 0; b < nblocks; b += 1) {
    const isLeftover = b === nblocks - 1 && leftover > 0;
    const bsize = isLeftover ? leftover : blocksize;
    const nsplits = !dontSplit && !isLeftover ? typesize : 1;
    const neblock = bsize / nsplits;
    let p = dv.getInt32(16 + 4 * b, true);
    let o = 0;
    const dest = shuffle ? tmp : out.subarray(b * blocksize, b * blocksize + bsize);
    for (let s = 0; s < nsplits; s += 1) {
      const cbytes = dv.getInt32(p, true);
      p += 4;
      if (cbytes === neblock) {
        dest.set(src.subarray(p, p + cbytes), o);
      } else {
        const got = zstd(src.subarray(p, p + cbytes), neblock);
        if (got.length !== neblock) throw new Error(`blosc stream gave ${got.length} bytes, expected ${neblock}`);
        dest.set(got, o);
      }
      p += cbytes;
      o += neblock;
    }
    if (shuffle) unshuffle(tmp, out, b * blocksize, bsize, typesize);
  }
  return out;
}

/** Undo a byte shuffle of one block: byte j of every element sat together. */
export function unshuffle(src, out, at, size, typesize) {
  const count = Math.floor(size / typesize);
  for (let j = 0; j < typesize; j += 1) {
    const base = j * count;
    for (let i = 0; i < count; i += 1) out[at + i * typesize + j] = src[base + i];
  }
  // The tail that is not a whole element was stored as it was.
  const done = count * typesize;
  for (let k = done; k < size; k += 1) out[at + k] = src[k];
}

/** Decoded chunk bytes as little-endian float32 (every platform this runs on is). */
export function asFloat32(bytes) {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/* ── what can be drawn ─────────────────────────────────────────────────── */

const K = (v) => v - 273.15;

/**
 * The fields offered, each in the units a reader expects. `arrays` are the
 * archive's names; a two-array entry is a wind (speed from its components);
 * `level` picks one of the 18 pressure levels out of an upper-air chunk.
 * `mb` is the compressed size of one timestep, for the limits line.
 */
export const IFS_VARIABLES = {
  t2m: {
    label: "2 m temperature", arrays: ["2m_temperature"], convert: K, unit: "°C", mb: 0.36,
    ramp: [[-40, 120, 60, 170], [-20, 60, 90, 200], [-5, 80, 170, 225], [5, 150, 220, 210],
      [15, 240, 230, 130], [25, 245, 160, 60], [35, 215, 50, 50], [45, 120, 20, 40]],
  },
  d2m: {
    label: "2 m dewpoint", arrays: ["2m_dewpoint_temperature"], convert: K, unit: "°C", mb: 0.36,
    ramp: [[-40, 140, 110, 80], [-10, 200, 180, 120], [5, 170, 220, 160], [15, 70, 190, 150],
      [22, 40, 120, 200], [28, 80, 40, 160]],
  },
  msl: {
    label: "Mean sea-level pressure", arrays: ["mean_sea_level_pressure"], convert: (v) => v / 100,
    unit: "hPa", mb: 0.23,
    ramp: [[960, 120, 30, 120], [985, 60, 80, 200], [1000, 90, 170, 220], [1013, 235, 235, 235],
      [1025, 245, 190, 90], [1040, 220, 80, 50]],
  },
  wind10: {
    label: "10 m wind", arrays: ["10m_u_component_of_wind", "10m_v_component_of_wind"], unit: "m/s", mb: 0.5,
    ramp: [[0, 36, 104, 180], [3.4, 24, 170, 192], [7, 70, 200, 120], [10.8, 196, 220, 60],
      [17.2, 250, 170, 40], [24.5, 236, 70, 54], [32.7, 220, 40, 160], [45, 250, 220, 255]],
  },
  wind100: {
    label: "100 m wind (turbine height)", arrays: ["100m_u_component_of_wind", "100m_v_component_of_wind"],
    unit: "m/s", mb: 0.55,
    ramp: [[0, 36, 104, 180], [3.4, 24, 170, 192], [7, 70, 200, 120], [10.8, 196, 220, 60],
      [17.2, 250, 170, 40], [24.5, 236, 70, 54], [32.7, 220, 40, 160], [45, 250, 220, 255]],
  },
  tcwv: {
    label: "Total column water vapour", arrays: ["total_column_water_vapour"], unit: "mm", mb: 0.2,
    ramp: [[0, 245, 240, 220], [10, 190, 220, 200], [25, 100, 190, 210], [40, 50, 110, 200],
      [55, 90, 40, 170], [70, 200, 40, 150]],
  },
  tcc: {
    label: "Total cloud cover", arrays: ["total_cloud_cover"], convert: (v) => v * 100, unit: "%", mb: 0.2,
    ramp: [[0, 20, 40, 80], [30, 90, 110, 140], [70, 190, 195, 205], [100, 250, 250, 252]],
  },
  sst: {
    label: "Sea surface temperature", arrays: ["sea_surface_temperature"], convert: K, unit: "°C", mb: 0.19,
    ramp: [[-2, 60, 40, 140], [5, 40, 100, 200], [12, 40, 180, 200], [18, 120, 210, 140],
      [24, 245, 210, 90], [28, 240, 120, 60], [32, 200, 40, 70]],
  },
  ci: {
    label: "Sea-ice cover", arrays: ["sea_ice_cover"], convert: (v) => v * 100, unit: "%", mb: 0.05,
    ramp: [[0, 20, 50, 110], [15, 90, 140, 200], [50, 180, 210, 235], [100, 250, 252, 255]],
  },
  sd: {
    label: "Snow depth (water equivalent)", arrays: ["snow_depth"], convert: (v) => v * 1000, unit: "mm w.e.",
    mb: 0.1, ramp: [[0, 120, 110, 100], [10, 170, 190, 220], [50, 210, 225, 245], [200, 250, 250, 255]],
  },
  swvl1: {
    label: "Soil moisture, top 7 cm", arrays: ["volumetric_soil_water_layer_1"], unit: "m³/m³", mb: 0.25,
    ramp: [[0, 170, 120, 60], [0.1, 220, 190, 110], [0.2, 170, 210, 140], [0.3, 70, 170, 170],
      [0.45, 40, 80, 170]],
  },
  t850: {
    label: "Temperature at 850 hPa (~1.5 km)", arrays: ["temperature"], level: 850, convert: K, unit: "°C", mb: 7.1,
    ramp: [[-40, 120, 60, 170], [-20, 60, 90, 200], [-5, 80, 170, 225], [5, 150, 220, 210],
      [15, 240, 230, 130], [25, 245, 160, 60], [35, 215, 50, 50]],
  },
  z500: {
    label: "500 hPa height", arrays: ["geopotential"], level: 500, convert: (v) => v / G / 10, unit: "dam", mb: 7.1,
    ramp: [[480, 90, 40, 150], [520, 60, 120, 210], [550, 120, 200, 200], [570, 240, 220, 120],
      [590, 220, 90, 50]],
  },
};

/** Where a level's slice starts inside an upper-air chunk. */
export function levelOffset(hPa) {
  const k = LEVELS.indexOf(hPa);
  if (k < 0) throw new Error(`no ${hPa} hPa level in the archive`);
  return k * POINTS;
}

/** Wind speed and the compass direction it blows FROM, from u and v. */
export function windFrom(u, v) {
  const speed = Math.hypot(u, v);
  const from = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
  return { speed, from };
}

/* ── feathering the finer patch into the world sheet ───────────────────── */

/** The width, degrees, over which a patch fades in: a tenth of its span, at least 2.5°. */
export function featherWidth(box) {
  return Math.max(2.5, 0.1 * Math.min(box.east - box.west, box.north - box.south));
}

/**
 * How much of a patch shows at a point: 0 at and beyond its edge, 1 a feather
 * width inside it, smoothstep between.
 */
export function featherWeight(box, lat, lon, width = featherWidth(box)) {
  let x = ((((lon - box.west) % 360) + 360) % 360);
  if (x > box.east - box.west) return 0;
  const d = Math.min(x, box.east - box.west - x, lat - box.south, box.north - lat);
  if (d <= 0) return 0;
  const t = Math.min(1, d / width);
  return t * t * (3 - 2 * t);
}

/**
 * THE SEAM. Two translucent sheets over one place composite to more than
 * either: a patch at alpha A over a world sheet at A reads A(2 − A), the pale
 * band at the patch's edge. So the world sheet under a patch of weight w takes
 * the alpha that makes the pair composite to exactly A:
 *   wA + a(1 − wA) = A  →  a = A(1 − w) / (1 − wA).
 */
export function underAlpha(alpha, w) {
  if (w <= 0) return alpha;
  if (w >= 1) return 0;
  return (alpha * (1 - w)) / (1 - w * alpha);
}
