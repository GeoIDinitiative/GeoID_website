/**
 * The water mask and the sea it floods: polygons burned exactly, the sea
 * reaching only what it can reach, lakes held at their own level.
 * Run with `node water-mask.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { burnPolygons, floodFromSea, classAreas, zoomForGrid, edgeSeeds, contextBox, WORLD_BOX,
  SEA, LAKE, FLOODED, EXPOSED, CUT_OFF, DRY } from "./water-mask.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

/* ── burning ──────────────────────────────────────────────────────────── */

// A 10 x 10 grid, one degree a cell, over 0..10 E, 0..10 N. Row 0 is the north.
const B = { west: 0, east: 10, south: 0, north: 10 };
const square = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const poly = (...rings) => ({ geometry: { type: "Polygon", coordinates: rings } });

const box = burnPolygons([poly(square(2, 2, 5, 6))], B, 10, 10, new Uint8Array(100));
const filled = box.reduce((a, v) => a + v, 0);
check("a 3 x 4 degree box fills exactly 12 one-degree cells", filled === 12, `${filled}`);
check("and row 0 is the NORTH edge", box[(4 * 10) + 2] === 1 && box[(3 * 10) + 2] === 0
  && box[(7 * 10) + 2] === 1 && box[(8 * 10) + 2] === 0);

const holed = burnPolygons([poly(square(1, 1, 9, 9), square(4, 4, 6, 6))], B, 10, 10,
  new Uint8Array(100));
check("a hole is a hole: 64 cells less the 4 in the middle",
  holed.reduce((a, v) => a + v, 0) === 60 && holed[(5 * 10) + 5] === 0);

const multi = burnPolygons([{ geometry: { type: "MultiPolygon", coordinates: [
  [square(0, 0, 2, 2)], [square(8, 8, 10, 10)]] } }], B, 10, 10, new Uint8Array(100));
check("each part of a multipolygon is filled", multi.reduce((a, v) => a + v, 0) === 8);

const valued = burnPolygons([{ geometry: poly(square(0, 0, 3, 3)).geometry,
  properties: { elevation_m: -29 } }], B, 10, 10, new Float32Array(100).fill(NaN),
(f) => f.properties.elevation_m);
check("a lake cell carries the lake's own surface elevation", valued[(9 * 10) + 0] === -29
  && Number.isNaN(valued[0]));

/* ── flooding ─────────────────────────────────────────────────────────── */

// A 7-wide strip: sea in column 0, then a coast at 1 m, a ridge at 5 m, a
// basin at −2 m behind the ridge, and high ground. Rows are identical.
const W = 7; const H = 3;
const profile = [0, 1, 2, 5, -2, -2, 8];
const heights = new Float32Array(W * H);
const ocean = new Uint8Array(W * H);
const noLakes = new Float32Array(W * H).fill(NaN);
for (let j = 0; j < H; j += 1) {
  for (let i = 0; i < W; i += 1) {
    heights[(j * W) + i] = profile[i];
    if (i === 0) ocean[(j * W) + i] = 1;
  }
}
const at = (res, i) => res.classes[(1 * W) + i];
const today = floodFromSea({ heights, ocean, lakeLevel: noLakes, width: W, height: H, level: 0 });
check("at TODAY's level the sea is exactly the ocean polygon", at(today, 0) === SEA
  && at(today, 1) === DRY);
check("a basin below sea level behind a ridge stays DRY — cut off, not flooded",
  at(today, 4) === CUT_OFF && at(today, 5) === CUT_OFF);

const plus3 = floodFromSea({ heights, ocean, lakeLevel: noLakes, width: W, height: H, level: 3 });
check("at +3 m the coast floods", at(plus3, 1) === FLOODED && at(plus3, 2) === FLOODED);
check("the ridge holds", at(plus3, 3) === DRY);
check("and the basin behind it is still cut off", at(plus3, 4) === CUT_OFF);
check("depth over flooded land is the level less the ground",
  plus3.depth[(1 * W) + 1] === 2 && plus3.depth[(1 * W) + 2] === 1);

const plus6 = floodFromSea({ heights, ocean, lakeLevel: noLakes, width: W, height: H, level: 6 });
check("over the ridge the sea reaches the basin", at(plus6, 4) === FLOODED
  && plus6.depth[(1 * W) + 4] === 8);
check("high ground stays dry", at(plus6, 6) === DRY);

const minus1 = floodFromSea({ heights, ocean, lakeLevel: noLakes, width: W, height: H,
  level: -1 });
check("a FALLEN sea exposes the seabed standing above it", at(minus1, 0) === EXPOSED
  && minus1.depth[(1 * W) + 0] === 1);

// A lake whose SURFACE is at 4 m, in the basin, although its bed reads −2 m.
const lake = new Float32Array(W * H).fill(NaN);
for (let j = 0; j < H; j += 1) { lake[(j * W) + 4] = 4; lake[(j * W) + 5] = 4; }
const lakeAt3 = floodFromSea({ heights, ocean, lakeLevel: lake, width: W, height: H, level: 3 });
check("a lake keeps its own level and is not painted as flooded", at(lakeAt3, 4) === LAKE
  && Number.isNaN(lakeAt3.depth[(1 * W) + 4]));
{
  // No ridge this time: coast, then a lake whose BED reads −2 m but whose
  // SURFACE is 4 m, then low ground at 3.5 m reachable only across the lake.
  const flat = new Float32Array(W * H);
  const lk = new Float32Array(W * H).fill(NaN);
  const prof = [0, 1, 2, 3, -2, -2, 3.5];
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) flat[(j * W) + i] = prof[i];
    lk[(j * W) + 4] = 4; lk[(j * W) + 5] = 4;
  }
  const r38 = floodFromSea({ heights: flat, ocean, lakeLevel: lk, width: W, height: H, level: 3.8 });
  check("the lake's BED is not the lake: at +3.8 m a lake standing at 4 m is not crossed",
    r38.classes[(1 * W) + 6] === CUT_OFF && r38.classes[(1 * W) + 3] === FLOODED);
  const r45 = floodFromSea({ heights: flat, ocean, lakeLevel: lk, width: W, height: H, level: 4.5 });
  check("and above its surface the sea crosses it to the ground beyond",
    r45.classes[(1 * W) + 6] === FLOODED && r45.classes[(1 * W) + 4] === LAKE);
}
check("a lake with no published surface takes the DEM under it", (() => {
  const unknown = new Float32Array(W * H).fill(NaN);
  for (let j = 0; j < H; j += 1) unknown[(j * W) + 1] = -Infinity;
  const r = floodFromSea({ heights, ocean, lakeLevel: unknown, width: W, height: H, level: 1.5 });
  return r.classes[(1 * W) + 1] === LAKE && r.classes[(1 * W) + 2] === DRY;
})());

// The world wraps: ocean in the last column, low land in the first.
const wrapH = new Float32Array([1, 9, 9, 0, 1, 9, 9, 0]);
const wrapO = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1]);
const wrapped = floodFromSea({ heights: wrapH, ocean: wrapO,
  lakeLevel: new Float32Array(8).fill(NaN), width: 4, height: 2, level: 2, wrap: true });
check("round the whole planet the sea crosses the antimeridian", wrapped.classes[0] === FLOODED);
const unwrapped = floodFromSea({ heights: wrapH, ocean: wrapO,
  lakeLevel: new Float32Array(8).fill(NaN), width: 4, height: 2, level: 2, wrap: false });
check("and a view that is not the whole planet does not", unwrapped.classes[0] === CUT_OFF);

/* ── the sea comes in from outside the view ───────────────────────────── */

{
  // A 20 x 3 strip of low ground with no ocean in it, and a dyke across it.
  const W = 20; const H = 3;
  const heights = new Float32Array(W * H).fill(0.5);
  for (let j = 0; j < H; j += 1) heights[(j * W) + 12] = 5;
  const none = new Float32Array(W * H).fill(NaN);
  const alone = floodFromSea({ heights, ocean: new Uint8Array(W * H), lakeLevel: none,
    width: W, height: H, level: 1 });
  check("a view with no coast in it floods nothing on its own",
    alone.classes.every((k) => k !== FLOODED) && alone.classes[W + 3] === CUT_OFF);

  // The same strip inside a parent whose flood reaches the western half of it.
  const bounds = { west: 0, east: 20, south: 0, north: 3 };
  const parent = { reached: new Uint8Array([1, 1, 1, 0]), width: 4, height: 1,
    bounds: { west: -20, east: 20, south: 0, north: 3 } };
  const seeds = edgeSeeds(parent, bounds, W, H);
  const at = (i, j) => seeds[(j * W) + i];
  check("the parent's sea seeds the view's edge where it reaches it, and nowhere inside",
    at(0, 1) === 1 && at(5, 0) === 1 && at(5, 2) === 1 && at(5, 1) === 0
    && at(15, 0) === 0 && at(19, 1) === 0, `${[...seeds]}`);
  const joined = floodFromSea({ heights, ocean: new Uint8Array(W * H), lakeLevel: none,
    width: W, height: H, level: 1, seeds });
  const cls = (i, j) => joined.classes[(j * W) + i];
  check("seeded, the sea comes in and floods the low ground behind the edge",
    cls(0, 1) === FLOODED && cls(11, 1) === FLOODED);
  check("but a dyke inside the view is still a dyke",
    cls(13, 1) === CUT_OFF && cls(19, 1) === CUT_OFF && cls(15, 0) === CUT_OFF);
  const high = new Float32Array(W * H).fill(3);
  const dry = floodFromSea({ heights: high, ocean: new Uint8Array(W * H), lakeLevel: none,
    width: W, height: H, level: 1, seeds });
  check("a seed is where the sea COULD enter: ground above the level stays dry",
    dry.classes.every((k) => k === DRY));
  check("the flood says what it reached, for the next grid down",
    joined.reached[W] === 1 && joined.reached[W + 13] === 0);
}

{
  const view = { west: 4.6, east: 4.7, south: 43.4, north: 43.47 };
  const ctx = contextBox(view);
  const holds = (outer, inner) => outer.west <= inner.west && outer.east >= inner.east
    && outer.south <= inner.south && outer.north >= inner.north;
  check("a view's context holds it, eight times its size rounded up to a power of two",
    holds(ctx, view) && ctx.east - ctx.west === 1, JSON.stringify(ctx));
  const nudged = contextBox({ west: 4.61, east: 4.71, south: 43.4, north: 43.47 });
  check("and a view a little along shares it, so the chain is kept rather than redone",
    JSON.stringify(nudged) === JSON.stringify(ctx));
  let box = view; let depth = 0;
  while (box && box !== WORLD_BOX && depth < 10) { box = contextBox(box); depth += 1; }
  check("the chain climbs to the world in a few steps", box === WORLD_BOX && depth <= 4, `${depth}`);
  check("and the world is the top", contextBox(WORLD_BOX) === null);
  check("a context that would cross the antimeridian is the world, not a box cut at the seam",
    contextBox({ west: 179, east: 179.9, south: 0, north: 1 }) === WORLD_BOX);
}

/* ── areas and zoom ───────────────────────────────────────────────────── */

const areas = classAreas(new Uint8Array(100).fill(SEA), 10, 10, B);
const cap = 6371.0088 ** 2 * (10 * Math.PI / 180)
  * (Math.sin(10 * Math.PI / 180) - Math.sin(0));
check("class areas sum to the box's own area on the sphere (within 0.1%)",
  Math.abs(areas[SEA] - cap) / cap < 0.001, `${areas[SEA]} vs ${cap}`);
check("a grid over the world asks for a coarse zoom",
  zoomForGrid({ west: -180, east: 180, south: -85, north: 85 }, 768, 6) <= 2);
check("a 12-degree view asks for the pyramid's finest",
  zoomForGrid({ west: 0, east: 12, south: 40, north: 46 }, 768, 6) === 6);

/* ── wired in ─────────────────────────────────────────────────────────── */

const sheets = readFileSync(new URL("./dem-layer.js", import.meta.url), "utf8");
check("the sea-level reading is a sheet of the streamed DEM", /sealevel:\s*\{/.test(sheets)
  && /floodFromSea\(/.test(sheets) && /waterMasks\(/.test(sheets));
