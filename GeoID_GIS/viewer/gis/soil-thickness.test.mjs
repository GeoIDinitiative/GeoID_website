/**
 * Reading a window out of the soil-thickness COG.
 *
 * The arithmetic is pinned because the way it goes wrong is a fixed offset on
 * the ground rather than an error: the layer draws, its legend is right, and
 * it sits beside the coastline instead of on it.
 *
 * Run: node GeoID_GIS/viewer/gis/soil-thickness.test.mjs
 */

import { readFileSync } from "node:fs";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function ok(c, what) { if (!c) throw new Error(what); }
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: ${a} vs ${b}`);
}

const meta = JSON.parse(readFileSync(
  new URL("../../../data/global/soil-thickness/meta.json", import.meta.url), "utf8"));

/* ── the grid the file declares ──────────────────────────────────────────── */

check("the sidecar describes the grid the bake produced", () => {
  ok(meta.grid[0] === 43200 && meta.grid[1] === 18000, `grid ${meta.grid}`);
  ok(meta.bounds.north === 90 && meta.bounds.south === -60, "clipped at 60S");
  ok(meta.noData === 255, `nodata ${meta.noData}`);
  ok(meta.range[0] === 0 && meta.range[1] === 50, `range ${meta.range}`);
});

check("a pixel is 30 arcseconds on both axes", () => {
  const [gw, gh] = meta.grid;
  near((meta.bounds.east - meta.bounds.west) / gw, 1 / 120, 1e-9, "lon");
  near((meta.bounds.north - meta.bounds.south) / gh, 1 / 120, 1e-9, "lat");
});

/* ── the window, and the bounds it is labelled with ──────────────────────── */

/**
 * The window is snapped OUT to whole source pixels, so the image covers up to
 * one pixel more than the request on every side. Labelling it with the REQUEST
 * stretches it onto the wrong ground by up to 30 arcseconds -- 930 m at the
 * equator, which is invisible from orbit and the whole story at a fjord.
 */
check("the read window is reported by the pixels it actually covers", () => {
  const [gw, gh] = meta.grid;
  const px = (lon) => ((lon - meta.bounds.west) / (meta.bounds.east - meta.bounds.west)) * gw;
  const py = (lat) => ((meta.bounds.north - lat) / (meta.bounds.north - meta.bounds.south)) * gh;
  // A request that lands mid-pixel on every side, which is the ordinary case.
  const want = { west: 8.0041, east: 8.5041, north: 46.5041, south: 46.0041 };
  const x0 = Math.floor(px(want.west));
  const x1 = Math.ceil(px(want.east));
  const y0 = Math.floor(py(want.north));
  const y1 = Math.ceil(py(want.south));
  const lon = (x) => meta.bounds.west + (x / gw) * (meta.bounds.east - meta.bounds.west);
  const lat = (y) => meta.bounds.north - (y / gh) * (meta.bounds.north - meta.bounds.south);
  const got = { west: lon(x0), east: lon(x1), north: lat(y0), south: lat(y1) };
  ok(got.west <= want.west && got.east >= want.east, "the read covers the request");
  const offsetDeg = Math.max(Math.abs(got.west - want.west), Math.abs(got.north - want.north));
  ok(offsetDeg > 0, "and differs from it, which is the whole point");
  ok(offsetDeg <= 1 / 120 + 1e-9, `by at most one pixel, not ${offsetDeg}`);
});

check("the module labels the layer with the READ bounds", () => {
  const src = readFileSync(new URL("./soil-thickness.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/minX: read\.bounds\.west/.test(src), "buildRasterLayer is given read.bounds");
  ok(!/minX: bounds\.west/.test(src), "and never the requested bounds");
});

/* ── what a zero means ───────────────────────────────────────────────────── */

/**
 * 0 and nodata are DIFFERENT ANSWERS and the file is careful about it: the sea
 * is -1 (stored 255) and bare rock is 0. Measured over a 3x2 degree window on
 * New Zealand: 47,151 valid cells, of which 16.4% are exactly 0 -- the
 * Southern Alps, which is precisely the ground a landslide study is about.
 * Turning 0 into nodata would throw that distinction away in the data as well
 * as in the picture.
 */
check("nodata is the file's own, and zero is not it", () => {
  ok(meta.noData === 255 && meta.range[0] === 0, "0 is inside the valid range");
  ok(/-1 in the source is nodata/.test(meta.note), "the sidecar says what -1 was");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
