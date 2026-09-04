/**
 * The streamed DEM: the arithmetic, the ceiling, and the one rule that keeps
 * the drawn globe and the sampled height from disagreeing inside a single
 * calculation.
 *
 * Run: node GeoID_GIS/viewer/gis/dem-tiles.test.mjs
 */

import { decodeTerrarium, despike, sampleGrid, chooseZoom, groundMetresPerPixel,
  normaliseBounds, INFO_ZOOM, DESPIKE_M, TERRARIUM } from "./dem-tiles.js";
import { tilesForBounds, mercatorTile } from "./mvt.js";
import { readFileSync } from "node:fs";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: got ${a}, expected ${b}`); }
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: got ${a}, expected ${b} ±${tol}`);
}
function ok(c, what) { if (!c) throw new Error(what); }

/* ── the encoding ────────────────────────────────────────────────────────── */

check("terrarium decodes to metres about the geoid", () => {
  eq(decodeTerrarium(128, 0, 0), 0, "sea level");
  eq(decodeTerrarium(0, 0, 0), -32768, "the floor of the encoding");
  // Everest's tile measured 8751.0 m at its highest post; that is R=162 G=47.
  near(decodeTerrarium(162, 47, 0), 8751, 1, "Everest");
  // The blue channel is the fractional metre, which is why a DEM read this way
  // does not terrace the way an 8-bit height texture does.
  near(decodeTerrarium(128, 0, 128), 0.5, 1e-9, "half a metre");
});

/* ── the corrupt scanline ────────────────────────────────────────────────── */

check("the 28°N scanline artifact is repaired, and nothing else is", () => {
  const w = 8; const h = 5;
  const heights = new Float32Array(w * h).fill(5000);
  // One row 8,150 m below its neighbours -- the artifact as measured.
  for (let x = 0; x < w; x += 1) heights[(2 * w) + x] = 5000 - 8150;
  const repaired = despike(heights, w, h);
  eq(repaired, w, "one row repaired");
  eq(heights[(2 * w) + 3], 5000, "and put back on its neighbours");
});

check("a real cliff is not an artifact", () => {
  const w = 4; const h = 3;
  const heights = new Float32Array(w * h);
  // 250 m across one post is a very steep slope and still under the threshold.
  for (let x = 0; x < w; x += 1) { heights[x] = 0; heights[w + x] = 250; heights[2 * w + x] = 500; }
  const before = [...heights];
  eq(despike(heights, w, h), 0, "nothing repaired");
  ok(before.every((v, i) => v === heights[i]), "and nothing moved");
  ok(DESPIKE_M > 250, "the threshold sits above real terrain");
});

/* ── reading a tile ──────────────────────────────────────────────────────── */

check("a grid is read bilinearly", () => {
  const size = 4;
  const g = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) g[y * size + x] = x * 100;
  eq(sampleGrid(g, size, 1, 0), 100, "on a post");
  eq(sampleGrid(g, size, 1.5, 0), 150, "between two");
  eq(sampleGrid(g, size, 1.25, 2.5), 125, "and the ramp does not care about y");
});

check("a read outside the tile is clamped, never wrapped", () => {
  const size = 4;
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i += 1) g[i] = i;
  eq(sampleGrid(g, size, -3, -3), g[0], "before the first post");
  eq(sampleGrid(g, size, 99, 99), g[g.length - 1], "past the last");
});

/* ── the two limits, which are different kinds ───────────────────────────── */

check("the cap is where the DATA stops, not where the service does", () => {
  // Measured over High Mountain Asia: z15 carries 0.74 m RMS against its own
  // parent -- the publisher's resampling of 30 m source, at four times the
  // tiles. The service answers there; the pyramid knows nothing new.
  ok(INFO_ZOOM < TERRARIUM.maxZoom, "the information ceiling is below the service's");
  const tiny = { west: -6.201, east: -6.199, south: 54.699, north: 54.701 };
  eq(chooseZoom(tiny, { maxTiles: 64 }), INFO_ZOOM, "a tiny box stops at the cap");
});

check("a view over budget is given a shallower level, never a truncated one", () => {
  const wide = { west: -20, east: 20, south: 30, north: 60 };
  const z = chooseZoom(wide, { maxTiles: 24 });
  ok(tilesForBounds(wide, z).length <= 24, "the chosen level fits the budget");
  ok(tilesForBounds(wide, z + 1).length > 24, "and the next one would not");
});

check("no bounds is no zoom", () => eq(chooseZoom(null), null, "null"));

/* ── what a level is worth on the ground ─────────────────────────────────── */

check("posts are quoted in ground metres, which depend on latitude", () => {
  near(groundMetresPerPixel(0, 0), 156543 / 1, 2, "z0 at the equator");
  // The everest notes quote 17 m at z13 for 28°N and 8.4 m at z14.
  near(groundMetresPerPixel(13, 28), 16.9, 0.4, "z13 at 28°N");
  near(groundMetresPerPixel(14, 28), 8.4, 0.2, "z14 at 28°N");
  ok(groundMetresPerPixel(13, 60) < groundMetresPerPixel(13, 0), "and shrink toward the pole");
});

/* ── the tiling scheme is the tiler's own ────────────────────────────────── */

check("the fractional tile and the whole tile agree", () => {
  const lat = 27.98806; const lon = 86.92528; const z = 13;
  const { x, y } = mercatorTile(lat, lon, z);
  const [tile] = tilesForBounds({ west: lon, east: lon, south: lat, north: lat }, z);
  eq(Math.floor(x), tile.x, "x");
  eq(Math.floor(y), tile.y, "y");
  // Everest's own tile, measured against the live pyramid.
  eq(`${z}/${tile.x}/${tile.y}`, "13/6074/3432", "Everest sits where the service put it");
});

/* ── the rule that keeps two answers from meeting in one sum ─────────────── */

/**
 * The globe is DISPLACED from its own texture. A height read from a 30 m
 * pyramid and a surface drawn from a 19.6 km one are both fine on their own
 * and ruinous mixed inside one calculation -- a pin placed from the first
 * against ground drawn from the second sits under the terrain. So the streamed
 * DEM answers `sampleElevationMeters` (how high is this place) and must never
 * reach `sampleElevationNormalized` (where is the ground drawn).
 */
check("the viewer asks the DEM for heights and never for the drawn surface", () => {
  const src = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
  const meters = src.slice(src.indexOf("function sampleElevationMeters("));
  ok(/GeoIDDem/.test(meters.slice(0, 2600)), "the metres seam consults the streamed DEM");
  const normalized = src.slice(src.indexOf("function sampleElevationNormalized("),
    src.indexOf("function sampleElevationMeters("));
  ok(!/GeoIDDem/.test(normalized), "and the normalized one does not");
});

/* ── three spellings of one box ──────────────────────────────────────────── */

/**
 * This tree says a bounding box three ways, and handing the wrong one to tile
 * maths does not throw: every field reads undefined, the arithmetic goes to
 * NaN, and the cover comes back empty — which reads as a source with no data
 * here. The view follow was doing exactly that until the refusal fired.
 */
check("a box is taken in any of the three vocabularies this tree speaks", () => {
  const want = { west: -6, south: 54, east: -5, north: 55 };
  const same = (got) => JSON.stringify(got) === JSON.stringify(want);
  ok(same(normaliseBounds(want)), "the tilers'");
  ok(same(normaliseBounds({ minX: -6, minY: 54, maxX: -5, maxY: 55 })), "a layer's bounds");
  ok(same(normaliseBounds({ minLon: -6, minLat: 54, maxLon: -5, maxLat: 55 })), "the viewer's");
  eq(normaliseBounds(null), null, "and nothing is nothing");
});

check("anything else is refused loudly, never computed into NaN", () => {
  let threw = "";
  try { normaliseBounds({ left: 1, right: 2 }); } catch (error) { threw = error.message; }
  ok(/minLon/.test(threw), `named the spellings it takes: ${threw}`);
});

/**
 * The shape `visibleBounds` hands back when it cannot answer: an object full
 * of nulls rather than a null. The driver has to see through that, or every
 * settle throws into a callback nobody awaits.
 */
check("a view full of nulls is refused, not read as zero", () => {
  let threw = false;
  try { normaliseBounds({ minLon: null, minLat: null, maxLon: null, maxLat: null }); }
  catch (error) { threw = true; }
  ok(threw, "refused");
  const src = readFileSync(new URL("./dem-stream.js", import.meta.url), "utf8");
  ok(/Number\.isFinite/.test(src), "and the view follow checks for finite fields");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
