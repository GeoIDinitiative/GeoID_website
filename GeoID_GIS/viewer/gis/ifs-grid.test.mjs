/**
 * The ECMWF IFS analysis maths: the archive's time axis, the N320 reduced
 * Gaussian grid, the regrid onto a lat/lon lattice, the lattice that follows
 * the zoom, and the Blosc-zstd chunk codec — against closed forms and one
 * real chunk from the archive.
 * Run: node GeoID_GIS/viewer/gis/ifs-grid.test.mjs
 */
import {
  T0_MS, STEP_MS, STEPS, LAST_MS, POINTS, NATIVE_DEG, LEVELS, IFS_VARIABLES,
  timeIndex, gaussianLatitudes, reducedGrid, rowAbove, sampleReduced, latticeFor, regrid,
  rangeOf, decodeBlosc, unshuffle, asFloat32, levelOffset, windFrom,
} from "./ifs-grid.js";
import { zstdDecompress } from "../vendor/icechunk.js";
import { interpolate } from "./flow-field.js";

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass += 1;
  else { fail += 1; console.error("FAIL:", msg); }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
process.on("exit", () => {
  console.log(`ifs-grid: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

/* ── time ── */
ok(STEPS === 23008, "23,008 timesteps");
ok(new Date(LAST_MS).toISOString() === "2026-09-30T18:00:00.000Z", "the archive ends 2026-09-30 18 UTC");
ok(timeIndex("2011-01-01T00:00Z").index === 0, "first step is index 0");
// Measured against the archive's own /time array.
ok(timeIndex(Date.UTC(2024, 6, 15, 12)).index === 19778, "2024-07-15 12 UTC is index 19778");
ok(timeIndex(Date.UTC(2024, 6, 15, 14)).iso === "2024-07-15T12:00Z", "14 UTC rounds to 12 UTC");
ok(timeIndex(Date.UTC(2024, 6, 15, 16)).iso === "2024-07-15T18:00Z", "16 UTC rounds to 18 UTC");
{
  const before = timeIndex(Date.UTC(2005, 0, 1));
  ok(before.index === 0 && before.clamped, "a date before 2011 clamps to the first step and says so");
  const after = timeIndex(Date.UTC(2030, 0, 1));
  ok(after.index === STEPS - 1 && after.clamped, "a date after the archive clamps to the last step");
  ok(timeIndex("not a date") === null, "a bad date is null");
}

/* ── the Gaussian latitudes ── */
const lats = gaussianLatitudes(320);
ok(lats.length === 640, "N320 has 640 rows");
ok(near(lats[0], 89.78487690721863, 1e-11), "first row at the archive's 89.78487690721863°");
ok(near(lats[1], 89.50620273820637, 1e-11), "second row at the archive's 89.50620273820637°");
ok(near(lats[639], -lats[0], 1e-12), "symmetric about the equator");
{
  let monotone = true;
  for (let j = 1; j < 640; j += 1) if (!(lats[j] < lats[j - 1])) monotone = false;
  ok(monotone, "rows run strictly north to south");
  // Gaussian latitudes are nearly but not exactly equally spaced.
  ok(near(lats[319] - lats[320], 180 / 640, 0.002), "spacing near the equator is ~0.28°");
}
{
  // The roots of P_2 are ±1/sqrt(3): N1 is asin of those.
  const n1 = gaussianLatitudes(1);
  ok(near(n1[0], Math.asin(1 / Math.sqrt(3)) * 180 / Math.PI, 1e-12), "N1 latitudes are the roots of P2");
}

/* ── the reduced grid ── */
{
  // A tiny reduced grid: 4 rows (N2) with 4, 8, 8, 4 points a row.
  const g = reducedGrid([4, 8, 8, 4]);
  ok(g.points === 24 && g.start[2] === 12, "row starts accumulate");
  ok(rowAbove(g.lats, 0) === 1, "the equator sits below row 1");
  ok(rowAbove(g.lats, 89) === 0 && rowAbove(g.lats, -89) === 3, "beyond the caps answers the cap row");
  // A field equal to longitude/10 within each row is linear along the ring,
  // so it must come back exactly between points.
  const vals = new Float32Array(24);
  for (let j = 0; j < 4; j += 1) for (let i = 0; i < g.pl[j]; i += 1) vals[g.start[j] + i] = (i * 360) / g.pl[j] / 10;
  ok(near(sampleReduced(g, vals, g.lats[1], 22.5), 2.25, 1e-6), "linear along a row");
  ok(near(sampleReduced(g, vals, g.lats[1], 45), 4.5, 1e-6), "exact at a grid point");
  ok(near(sampleReduced(g, vals, g.lats[1], -315), 4.5, 1e-6), "longitudes wrap");
  // Wrap segment: between the last point (315°) and 0°, 360° reads as the first.
  ok(near(sampleReduced(g, vals, g.lats[1], 337.5), 15.75, 1e-6), "the seam blends the last point toward the first");
  // A field equal to the row's latitude: linear in latitude between rows.
  const byLat = new Float32Array(24);
  for (let j = 0; j < 4; j += 1) for (let i = 0; i < g.pl[j]; i += 1) byLat[g.start[j] + i] = g.lats[j];
  const mid = (g.lats[0] + g.lats[1]) / 2;
  ok(near(sampleReduced(g, byLat, mid, 100), mid, 1e-5), "linear between rows");
  ok(near(sampleReduced(g, byLat, 90, 0), g.lats[0], 1e-5), "the north cap takes the first row");
  // NaN anywhere it is weighed answers NaN (sea surface over land).
  const holed = Float32Array.from(vals);
  holed[g.start[1] + 1] = NaN;
  ok(Number.isNaN(sampleReduced(g, holed, g.lats[1], 50)), "a NaN neighbour answers NaN");
  ok(Number.isFinite(sampleReduced(g, holed, g.lats[1], 180)), "a NaN elsewhere does not");
}
{
  // The full N320 grid from the real row lengths: 542,080 points.
  // A synthetic symmetric table at full size (the real GRIB_pl rides in the
  // archive's metadata and is checked live, not here).
  const pl = [];
  const half = Array.from({ length: 320 }, (_, j) => Math.round(18 + (1262 * j) / 319));
  pl.push(...half, ...half.slice().reverse());
  const g = reducedGrid(pl, lats);
  ok(g.points === pl.reduce((a, b) => a + b, 0), "point count is the sum of the rows");
  ok(POINTS === 542080, "N320 is 542,080 points");
  ok(near(sampleReduced(g, Float32Array.from({ length: g.points }, () => 7), 12.3, 45.6), 7, 1e-6), "a constant field samples constant");
}

/* ── regrid and the lattice that follows the zoom ── */
{
  const world = latticeFor({ west: -180, east: 180, south: -90, north: 90 });
  ok(world.global && world.nx === 360 && world.ny === 181 && world.deg === 1, "the world is a 1° lattice");
  const view = latticeFor({ west: 0, east: 10, south: 40, north: 50 });
  ok(view.deg === NATIVE_DEG, "a view gets the grid's own spacing");
  ok(view.nx === Math.round(10 / NATIVE_DEG) + 1 && view.ny === view.nx, "edge to edge over the box");
  const wide = latticeFor({ west: -170, east: 170, south: -70, north: 70 });
  ok(wide.nx * wide.ny <= 160_000 * 1.01 && wide.deg > NATIVE_DEG, "a wide view is capped in cells, coarser than native");
  const tiny = latticeFor({ west: 0, east: 0.1, south: 0, north: 0.1 });
  ok(tiny.nx >= 2 && tiny.ny >= 2, "a tiny area still has a lattice");
}
{
  // A field that is a plane in lon and lat on every row regrids to that plane.
  const pl = [8, 16, 24, 32, 32, 24, 16, 8];
  const g = reducedGrid(pl);
  const vals = new Float32Array(g.points);
  const f = (lat, lon) => 2 * lat + Math.cos((lon * Math.PI) / 180);
  for (let j = 0; j < pl.length; j += 1) {
    for (let i = 0; i < pl[j]; i += 1) vals[g.start[j] + i] = f(g.lats[j], (i * 360) / pl[j]);
  }
  const box = { west: -30, east: 30, south: -20, north: 20 };
  const out = regrid(g, vals, box, 7, 5);
  ok(out.length === 35, "lattice size nx*ny");
  // Linear in latitude and cos(lon) linear between ring points: close to the plane.
  ok(near(out[2 * 7 + 3], f(0, 0), 0.05), "the regrid reproduces a smooth field at the box centre");
  const r = rangeOf(out);
  ok(r.valid === 35 && r.min < r.max, "rangeOf counts and spans");
  // Converted on the way.
  const k = regrid(g, vals, box, 7, 5, (v) => v * 10);
  ok(near(k[12], out[12] * 10, 1e-4), "a unit conversion is applied after sampling");
  // flow-field's interpolate reads the regridded lattice back at its own nodes.
  const field = { ...box, nx: 7, ny: 5, global: false };
  ok(near(interpolate(field, out, 0, 0), out[2 * 7 + 3], 1e-6), "the lattice is laid out as flow-field reads it");
  // A global lattice wraps without a repeated seam.
  const gbox = { west: -180, east: 180, south: -90, north: 90 };
  const gout = regrid(g, vals, gbox, 36, 19);
  const gfield = { ...gbox, nx: 36, ny: 19, global: true };
  ok(near(interpolate(gfield, gout, 0, 175), interpolate(gfield, gout, 0, -185), 1e-6), "global lattice wraps");
}
{
  // Upper-air chunks hold 18 levels one after another.
  ok(LEVELS.length === 18 && levelOffset(1000) === 0, "1000 hPa first");
  ok(levelOffset(850) === 2 * POINTS && levelOffset(500) === 5 * POINTS, "levels slice by POINTS");
  let threw = false;
  try { levelOffset(875); } catch { threw = true; }
  ok(threw, "a level the archive lacks throws");
}
{
  const w = windFrom(0, -10);   // blowing toward the south
  ok(near(w.speed, 10) && near(w.from, 0), "a northerly comes from 0°");
  ok(near(windFrom(10, 0).from, 270), "a westerly comes from 270°");
}
{
  const t = IFS_VARIABLES.t2m.convert(273.15);
  ok(near(t, 0), "kelvin to celsius");
  ok(near(IFS_VARIABLES.msl.convert(101325), 1013.25), "pascal to hectopascal");
  ok(near(IFS_VARIABLES.z500.convert(9.80665 * 5600), 560), "geopotential to decametres");
  for (const [k, def] of Object.entries(IFS_VARIABLES)) {
    ok(def.ramp.length >= 2 && def.ramp.every((s, i) => i === 0 || s[0] > def.ramp[i - 1][0]), `${k} ramp ascends`);
    ok(def.arrays.length === 1 || def.arrays.length === 2, `${k} has one array or a wind pair`);
  }
  ok(!Object.values(IFS_VARIABLES).some((d) => /precip/i.test(d.arrays.join())), "no precipitation is claimed");
}

/* ── the chunk codec ── */
{
  // Unshuffle: byte j of each element was stored contiguously.
  const src = Uint8Array.from([1, 2, 3, 10, 20, 30, 99]);   // 3 elements of 2 bytes, 1 tail byte
  const out = new Uint8Array(7);
  unshuffle(src, out, 0, 7, 2);
  ok(out.join() === "1,10,2,20,3,30,99", "unshuffle interleaves and keeps the tail");
}
/** A blosc frame of raw (stored) streams, built by hand. */
function frame(data, { typesize = 4, blocksize = 16, shuffle = true, split = false } = {}) {
  const nblocks = Math.ceil(data.length / blocksize);
  const parts = [];
  for (let b = 0; b < nblocks; b += 1) {
    const block = data.subarray(b * blocksize, Math.min(data.length, (b + 1) * blocksize));
    let body = block;
    if (shuffle) {
      const count = Math.floor(block.length / typesize);
      body = new Uint8Array(block.length);
      for (let j = 0; j < typesize; j += 1) for (let i = 0; i < count; i += 1) body[j * count + i] = block[i * typesize + j];
      body.set(block.subarray(count * typesize), count * typesize);
    }
    const leftover = block.length < blocksize;
    const nsplits = split && !leftover ? typesize : 1;
    const ne = body.length / nsplits;
    const streams = [];
    for (let s = 0; s < nsplits; s += 1) {
      const head = new Uint8Array(4);
      new DataView(head.buffer).setInt32(0, ne, true);
      streams.push(head, body.subarray(s * ne, (s + 1) * ne));
    }
    parts.push(streams);
  }
  const head = new Uint8Array(16 + 4 * nblocks);
  const dv = new DataView(head.buffer);
  head[0] = 2; head[1] = 1;
  head[2] = (shuffle ? 1 : 0) | (split ? 0 : 0x10) | (4 << 5);
  head[3] = typesize;
  dv.setUint32(4, data.length, true);
  dv.setUint32(8, blocksize, true);
  let at = head.length;
  parts.forEach((streams, b) => {
    dv.setInt32(16 + 4 * b, at, true);
    at += streams.reduce((n, s) => n + s.length, 0);
  });
  const outBuf = new Uint8Array(at);
  outBuf.set(head);
  let p = head.length;
  for (const streams of parts) for (const s of streams) { outBuf.set(s, p); p += s.length; }
  dv.setUint32(12, at, true);
  outBuf.set(head.subarray(0, 16));
  return outBuf;
}
{
  const floats = Float32Array.from({ length: 11 }, (_, i) => i * 1.5 - 3);
  const bytes = new Uint8Array(floats.buffer);
  const noZstd = () => { throw new Error("raw streams must not reach zstd"); };
  for (const opts of [{}, { split: true }, { shuffle: false }, { blocksize: 64 }, { blocksize: 8, split: true }]) {
    const got = asFloat32(decodeBlosc(frame(bytes, opts), { zstd: noZstd }));
    ok(got.length === 11 && got.every((v, i) => v === floats[i]), `raw blosc round trip ${JSON.stringify(opts)}`);
  }
  // Stored whole (memcpyed).
  const flat = new Uint8Array(16 + bytes.length);
  flat[2] = 0x2; flat[3] = 4;
  new DataView(flat.buffer).setUint32(4, bytes.length, true);
  flat.set(bytes, 16);
  ok(asFloat32(decodeBlosc(flat)).every((v, i) => v === floats[i]), "memcpyed frame copies through");
}
{
  // ONE REAL CHUNK: the archive's /time/c/0 (20,456 int64 seconds, Blosc-zstd,
  // shuffle, typesize 8), 1,710 bytes. Every value is 2011-01-01 plus 6 h steps.
  const real = Uint8Array.from(Buffer.from("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", "base64"));
  const zstd = (s, n) => zstdDecompress(s, new Uint8Array(n));
  const bytes = decodeBlosc(real, { zstd });
  ok(bytes.length === 20456 * 8, "the time chunk decodes to 20,456 int64s");
  const t = new BigInt64Array(bytes.buffer, bytes.byteOffset, 20456);
  let regular = true;
  for (let k = 0; k < t.length; k += 1) if (Number(t[k]) * 1000 !== T0_MS + k * STEP_MS) regular = false;
  ok(regular, "the archive's time axis is exactly T0 + 6 h steps (so timeIndex is arithmetic)");
}

/* ── the feathered seam ── */
{
  const { featherWidth, featherWeight, underAlpha } = await import("./ifs-grid.js");
  const box = { west: 0, east: 40, south: 10, north: 40 };
  ok(featherWidth(box) === 3, "feather is a tenth of the shorter span");
  ok(featherWidth({ west: 0, east: 5, south: 0, north: 5 }) === 2.5, "and at least 2.5°");
  ok(featherWeight(box, 25, 20) === 1, "full weight deep inside");
  ok(featherWeight(box, 10, 20) === 0 && featherWeight(box, 25, 41) === 0, "zero at and beyond the edge");
  ok(near(featherWeight(box, 11.5, 20), 0.5), "half way through the feather is one half");
  ok(featherWeight({ west: 170, east: 190, south: 0, north: 20 }, 10, -180) === 1, "longitudes wrap into the box");
  for (const A of [0.3, 0.55, 0.9]) {
    for (const w of [0, 0.25, 0.5, 0.75, 1]) {
      const a = underAlpha(A, w);
      ok(near(w * A + a * (1 - w * A), A, 1e-12), `patch over world composites to A=${A} at w=${w}`);
    }
  }
}
