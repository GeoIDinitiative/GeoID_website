/**
 * NOAA GFS straight from AWS Open Data — the arithmetic, with no page in it.
 *
 * The wind's world field came through Open-Meteo, whose per-minute limit
 * allows a lattice of about 12° over the world: enough for the trade winds,
 * nothing like enough for a jet stream or a storm's spiral (owner: "the wind
 * vectors on the geoHUB Earth map is very poorly executed"). NOAA publishes
 * every run on `noaa-gfs-bdp-pds`, anonymous and CORS open for range reads,
 * with an index (`.idx`) giving each field's byte offset. A 1° field is about
 * 80 KB, so the whole world costs two small range requests and no rate limit.
 *
 * pgrb2.1p00 is a regular 360 x 181 lat/lon grid, packed by GRIB2 data
 * template 5.3: complex packing with second-order spatial differencing. That
 * read is written here (WMO FM 92 GRIB2, as NCEP's g2c `comunpack` does it)
 * so this file stays free of imports and Node can test it.
 */

export const GFS_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
export const GFS_CREDIT = "NOAA GFS, 1° analysis and forecast, via the NOAA Open Data Dissemination Program on AWS";
export const GFS_DEG = 1;
/** This app's levels, as the .idx names them. */
export const GFS_LEVELS = {
  "10m": "10 m above ground", "850hPa": "850 mb", "500hPa": "500 mb", "250hPa": "250 mb",
};
const CYCLE_MS = 6 * 3600 * 1000;
const STEP_MS = 3 * 3600 * 1000;

const pad = (n) => String(n).padStart(2, "0");

/**
 * The runs to try, newest first, for the moment `hoursAhead` from now: each a
 * file URL and how far into that run the moment falls (a 3-hourly step, 0 at
 * the analysis). A run appears about four hours after its nominal time, so
 * the newest usually answers 404 and the next one is the answer.
 */
export function runsFor(nowMs, hoursAhead = 0, count = 4) {
  const target = nowMs + hoursAhead * 3600 * 1000;
  const latest = Math.floor(nowMs / CYCLE_MS) * CYCLE_MS;
  const runs = [];
  for (let k = 0; k < count; k += 1) {
    const run = new Date(latest - k * CYCLE_MS);
    const day = `${run.getUTCFullYear()}${pad(run.getUTCMonth() + 1)}${pad(run.getUTCDate())}`;
    const hh = pad(run.getUTCHours());
    const step = Math.max(0, Math.round((target - run.getTime()) / STEP_MS) * 3);
    const url = `${GFS_BASE}/gfs.${day}/${hh}/atmos/gfs.t${hh}z.pgrb2.1p00.f${String(step).padStart(3, "0")}`;
    runs.push({ url, step, time: new Date(run.getTime() + step * 3600 * 1000).toISOString().slice(0, 16) });
  }
  return runs;
}

/** The byte range of one field in a `.idx`: { start, end } (end exclusive), or null. */
export function idxRange(text, variable, level) {
  const lines = String(text).trim().split("\n");
  for (let i = 0; i < lines.length - 1; i += 1) {
    const f = lines[i].split(":");
    if (f[3] === variable && f[4] === level) {
      return { start: Number(f[1]), end: Number(lines[i + 1].split(":")[1]) };
    }
  }
  return null;
}

/** Big-endian bits off a byte array; up to 32 at a time, past 2^31 safely. */
class Bits {
  constructor(bytes, at = 0) { this.b = bytes; this.p = at * 8; }
  read(n) {
    let v = 0;
    let left = n;
    while (left > 0) {
      const byte = this.b[this.p >> 3];
      const have = 8 - (this.p & 7);
      const take = Math.min(have, left);
      v = v * 2 ** take + ((byte >> (have - take)) & ((1 << take) - 1));
      this.p += take;
      left -= take;
    }
    return v;
  }
  align() { this.p = Math.ceil(this.p / 8) * 8; }
}

/**
 * One GRIB2 message on a regular lat/lon grid (template 3.0) packed by 5.3.
 * Answers { ni, nj, values } with values row by row from the first grid point
 * as the file holds them: for GFS, 90 N to 90 S, each row from 0° E.
 */
export function decodeGrib2(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== "GRIB" || b[7] !== 2) throw new Error("not a GRIB2 message");
  // GRIB's signed integers are sign-and-magnitude, not two's complement.
  const s16 = (o) => { const v = dv.getUint16(o); return v & 0x8000 ? -(v & 0x7fff) : v; };
  let at = 16;
  let ni = 0; let nj = 0; let n = 0;
  let sec5 = -1; let sec7 = -1; let bitmap = 255;
  while (at < b.length - 4 && !(b[at] === 0x37 && b[at + 1] === 0x37)) {
    const len = dv.getUint32(at);
    const id = b[at + 4];
    if (id === 3) {
      if (dv.getUint16(at + 12) !== 0) throw new Error("not a regular lat/lon grid");
      ni = dv.getUint32(at + 30); nj = dv.getUint32(at + 34);
    } else if (id === 5) { sec5 = at; n = dv.getUint32(at + 5); } else if (id === 6) bitmap = b[at + 5];
    else if (id === 7) sec7 = at;
    at += len;
  }
  if (sec5 < 0 || sec7 < 0) throw new Error("incomplete GRIB2 message");
  if (dv.getUint16(sec5 + 9) !== 3) throw new Error(`data template 5.${dv.getUint16(sec5 + 9)} is not read here`);
  if (bitmap !== 255) throw new Error("a bitmap is not read here");
  const R = dv.getFloat32(sec5 + 11);
  const E = s16(sec5 + 15);
  const D = s16(sec5 + 17);
  const nBits = b[sec5 + 19];
  if (b[sec5 + 22] !== 0) throw new Error("missing-value management is not read here");
  const NG = dv.getUint32(sec5 + 31);
  const widthRef = b[sec5 + 35];
  const widthBits = b[sec5 + 36];
  const lenRef = dv.getUint32(sec5 + 37);
  const lenInc = b[sec5 + 41];
  const lenLast = dv.getUint32(sec5 + 42);
  const lenBits = b[sec5 + 46];
  const order = b[sec5 + 47];
  const extra = b[sec5 + 48];

  const bits = new Bits(b, sec7 + 5);
  const signed = () => {
    const v = bits.read(extra * 8);
    const top = 2 ** (extra * 8 - 1);
    return v >= top ? -(v - top) : v;
  };
  const first = [];
  for (let k = 0; k < order; k += 1) first.push(signed());
  const gmin = order ? signed() : 0;
  bits.align();
  const refs = new Float64Array(NG);
  for (let g = 0; g < NG; g += 1) refs[g] = bits.read(nBits);
  bits.align();
  const widths = new Uint8Array(NG);
  for (let g = 0; g < NG; g += 1) widths[g] = widthRef + bits.read(widthBits);
  bits.align();
  const lengths = new Uint32Array(NG);
  for (let g = 0; g < NG; g += 1) lengths[g] = lenRef + bits.read(lenBits) * lenInc;
  lengths[NG - 1] = lenLast;
  bits.align();

  const x = new Float64Array(n);
  let k = 0;
  for (let g = 0; g < NG; g += 1) {
    const w = widths[g];
    for (let i = 0; i < lengths[g]; i += 1) { x[k] = w ? refs[g] + bits.read(w) : refs[g]; k += 1; }
  }
  // Undo the spatial differencing: the file holds differences of differences.
  if (order === 1) {
    x[0] = first[0];
    for (let i = 1; i < n; i += 1) x[i] = x[i] + gmin + x[i - 1];
  } else if (order === 2) {
    x[0] = first[0]; x[1] = first[1];
    for (let i = 2; i < n; i += 1) x[i] = x[i] + gmin + 2 * x[i - 1] - x[i - 2];
  }
  const scale = 2 ** E;
  const ten = 10 ** -D;
  const values = new Float32Array(n);
  for (let i = 0; i < n; i += 1) values[i] = (R + x[i] * scale) * ten;
  return { ni, nj, values };
}

/**
 * U and V as a field in flow-field.js's shape: rows south to north, columns
 * from 180° W. `speed` is the wind speed, for the shading and the legend.
 */
export function windField(u, v, time = null) {
  const { ni: nx, nj: ny } = u;
  const uOut = new Float32Array(nx * ny);
  const vOut = new Float32Array(nx * ny);
  const half = Math.floor(nx / 2);
  let max = 0;
  for (let j = 0; j < ny; j += 1) {
    const from = (ny - 1 - j) * nx;
    for (let i = 0; i < nx; i += 1) {
      const src = from + ((i + half) % nx);
      const a = u.values[src];
      const b = v.values[src];
      uOut[j * nx + i] = a; vOut[j * nx + i] = b;
      max = Math.max(max, Math.hypot(a, b));
    }
  }
  return {
    west: -180, east: 180, south: -90, north: 90, nx, ny, u: uOut, v: vOut,
    scalars: {}, global: true, max, valid: nx * ny, time, gridDeg: 360 / nx,
  };
}
