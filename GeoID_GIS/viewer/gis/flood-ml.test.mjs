/**
 * The flood forest's features and evaluator, against answers known first.
 *
 * Every feature the forest reads is computed by flood-ml.js, in the bake and
 * in the page, so this file is the one place their arithmetic is pinned:
 * water drains down a valley to its outlet, HAND is zero on the channel and
 * grows up the sides, the distance transform agrees with brute force, a
 * lattice field linear in lon/lat comes back exactly, and the forest walker
 * gives the hand-worked answer -- and, when the bake has exported a forest
 * locally, scikit-learn's own predict_proba on its check rows.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeGrid, priorityFlood, d8Receivers, terrain, distanceTransform, landCover, latticeOnGrid,
  wettest3, fillNearest, buildStack, featureRows, decodeForest, predictForest, FEATURES, CHANNEL_CELLS,
  demOnGrid, tilesFor, soilOnGrid,
} from "./flood-ml.js";

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); } catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}`); }
}
function ok(c, what) { if (!c) throw new Error(what); }
function near(a, b, tol, what) { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: expected ~${b}, got ${a}`); }

// A V-shaped valley 21 cells wide draining south: z = 2|c-10| + (h-1-r)*0.5.
const grid = makeGrid({ west: 0, east: 0.021, south: 0, north: 0.06 }, 0.001);
const W = grid.width; const H = grid.height;
const dem = new Float32Array(W * H);
for (let r = 0; r < H; r += 1) for (let c = 0; c < W; c += 1) dem[r * W + c] = 2 * Math.abs(c - 10) + (H - 1 - r) * 0.5;
const all = new Uint8Array(W * H).fill(1);

check("the grid snaps to its cell and counts cells", () => {
  ok(W === 21 && H === 60, `${W} x ${H}`);
  const g = makeGrid({ west: 0.00049, east: 0.0101, south: -0.0001, north: 0.0049 }, 0.001);
  ok(g.west === 0 && Math.abs(g.east - 0.011) < 1e-12 && g.width === 11, JSON.stringify(g));
});

check("priority flood settles every land cell once, and fills a pit to its spill point", () => {
  const pit = dem.slice();
  pit[30 * W + 10] = -50;
  const { filled, order } = priorityFlood(pit, all, grid);
  ok(order.length === W * H, `settled ${order.length}`);
  ok(filled[30 * W + 10] > Math.min(pit[31 * W + 10], pit[29 * W + 10]), `pit not filled: ${filled[30 * W + 10]}`);
});

check("D8 sends the valley floor south, and the sides toward the floor", () => {
  const { filled } = priorityFlood(dem, all, grid);
  const recv = d8Receivers(filled, all, grid);
  ok(recv[30 * W + 10] === 31 * W + 10, "floor cell does not drain south");
  ok(recv[30 * W + 3] % W > 3, "west side does not drain toward the floor");
  ok(recv[30 * W + 17] % W < 17, "east side does not drain toward the floor");
});

check("upstream area grows down the floor; HAND is 0 on the channel and rises up the sides", () => {
  const t = terrain(dem, all, grid);
  const up = (r) => t.log10_upstream_km2[r * W + 10];
  ok(up(55) > up(20) && up(20) > up(5), "accumulation does not grow downstream");
  const cell = (r, c) => r * W + c;
  const acc = 10 ** t.log10_upstream_km2[cell(55, 10)] / ((grid.mx * grid.my) / 1e6);
  ok(acc >= CHANNEL_CELLS, `floor near the outlet drains only ${acc} cells`);
  near(t.hand_m[cell(55, 10)], 0, 1e-6, "HAND on the channel");
  ok(t.hand_m[cell(55, 4)] > t.hand_m[cell(55, 8)] && t.hand_m[cell(55, 8)] > 0, "HAND does not rise up the side");
  ok(t.channel_distance_m[cell(55, 10)] === 0 && t.channel_distance_m[cell(55, 4)] > 0, "channel distance");
});

check("slope is the DEM's gradient: 2 m per cell across, 0.5 m down", () => {
  const t = terrain(dem, all, grid);
  const i = 30 * W + 5;
  const expect = (Math.atan(Math.hypot(2 / grid.mx, 0.5 / grid.my)) * 180) / Math.PI;
  near(t.slope_deg[i], expect, 1e-4, "slope");
  ok(t.curvature[30 * W + 10] > 0, "the valley floor is a hollow (positive Laplacian)");
});

check("the distance transform agrees with brute force", () => {
  const g = makeGrid({ west: 0, east: 0.013, south: 0, north: 0.009 }, 0.001);
  const src = new Uint8Array(g.width * g.height);
  [[2, 3], [7, 11], [8, 0]].forEach(([r, c]) => { src[r * g.width + c] = 1; });
  const d = distanceTransform(src, g);
  for (let r = 0; r < g.height; r += 1) {
    for (let c = 0; c < g.width; c += 1) {
      let best = Infinity;
      for (let rr = 0; rr < g.height; rr += 1) for (let cc = 0; cc < g.width; cc += 1) {
        if (src[rr * g.width + cc]) best = Math.min(best, Math.hypot((r - rr) * g.my, (c - cc) * g.mx));
      }
      near(d[r * g.width + c], best, 1e-3 * best + 1e-3, `cell ${r},${c}`);
    }
  }
});

check("land cover fractions count classes per cell and leave all-no-data cells NaN", () => {
  const g = makeGrid({ west: 0, east: 0.002, south: 0, north: 0.001 }, 0.001);   // 2 x 1 cells
  const k = 2;
  const classes = new Uint8Array([7, 7, 0, 0, 1, 2, 0, 0]);   // 4 x 2 pixels
  const { fractions, valid } = landCover(classes, g, k);
  near(fractions.built_frac[0], 0.5, 1e-9, "built");
  near(fractions.water_frac[0], 0.25, 1e-9, "water");
  ok(valid[1] === 0 && Number.isNaN(fractions.built_frac[1]), "no-data cell");
});

check("a field linear in lon and lat comes off the lattice exactly", () => {
  const lattice = { nLat: 5, nLon: 6, lat0: 2, lon0: -1, dLat: -0.5, dLon: 0.5 };
  const field = new Float32Array(30);
  for (let y = 0; y < 5; y += 1) for (let x = 0; x < 6; x += 1) {
    const lat = 2 - 0.5 * y; const lon = -1 + 0.5 * x;
    field[y * 6 + x] = 3 * lon - 2 * lat + 10;
  }
  const g = makeGrid({ west: -0.9, east: 1.3, south: 0.1, north: 1.9 }, 0.1);
  const out = latticeOnGrid(field, lattice, g);
  for (let i = 0; i < out.length; i += 37) {
    const r = Math.floor(i / g.width); const c = i % g.width;
    const lon = g.west + (c + 0.5) * g.cell; const lat = g.north - (r + 0.5) * g.cell;
    near(out[i], 3 * lon - 2 * lat + 10, 1e-4, `cell ${i}`);
  }
  field[2 * 6 + 2] = NaN;
  ok(Number.isFinite(latticeOnGrid(field, lattice, g)[5]), "one NaN gauge blanks the cells beside it");
});

check("the wettest 3 days", () => {
  ok(wettest3([1, 0, 5, 6, 2, 0, 9]) === 13, String(wettest3([1, 0, 5, 6, 2, 0, 9])));
  ok(wettest3([4]) === 4 && wettest3([NaN, 2, 3]) === 5, "short or NaN series");
});

check("nearest fill counts only gaps inside the mask", () => {
  const g = makeGrid({ west: 0, east: 0.004, south: 0, north: 0.001 }, 0.001);
  const a = new Float32Array([1, NaN, NaN, 4]);
  const n = fillNearest(a, new Uint8Array([1, 1, 0, 1]), g);
  ok(n === 1 && a[1] === 1 && Number.isFinite(a[2]), `filled ${n}: ${a}`);
});

check("the stack masks sea and bathymetry and keeps every feature finite on land", () => {
  const g = makeGrid({ west: 0, east: 0.02, south: 0, north: 0.02 }, 0.001);
  const n = g.width * g.height;
  const d = new Float32Array(n).map((_, i) => (i % g.width < 3 ? -40 : 5 + (i % g.width)));
  const k = 2;
  const lc = new Uint8Array(n * k * k).fill(11);
  const zeros = () => new Float32Array(n).fill(3);
  const { stack, mask, land } = buildStack({ grid: g, dem: d, lcClasses: lc, lcK: k, soil: zeros(),
    rainNormal: zeros(), rain3: zeros(), rain30: zeros() });
  ok(land === n - 3 * g.height, `land ${land}`);
  ok(!mask[0] && mask[5], "mask");
  const { rows, cells, dropped } = featureRows(stack, [...Array(n).keys()].filter((i) => mask[i]));
  ok(dropped === 0 && cells.length === land && rows.length === land * FEATURES.length, `dropped ${dropped}`);
});

check("soil is read at the native cell under each centre", () => {
  const g = makeGrid({ west: 0, east: 0.02, south: 0, north: 0.01 }, 0.01);
  const win = { band: new Uint8Array([10, 20, 30, 255]), width: 2, height: 2, origin: { x: 21600, y: 10800 - 2 },
    degrees: 1 / 120, world: { west: -180, north: 90 }, noData: 255 };
  const s = soilOnGrid(win, g);
  ok(s[0] === 30 && Number.isNaN(s[1]), `soil ${s}`);
});

check("the DEM resamples a constant mosaic to the constant", () => {
  const g = makeGrid({ west: 1, east: 1.2, south: 1, north: 1.2 }, 0.05);
  const plan = tilesFor(g, 8);
  const mosaic = new Float32Array(plan.cols * 256 * plan.rows * 256).fill(123.5);
  const out = demOnGrid(mosaic, plan, g);
  ok(out.every((v) => Math.abs(v - 123.5) < 1e-4), "not constant");
});

const b64 = (T, a) => Buffer.from(new T(a).buffer).toString("base64");
check("the forest walker: x <= threshold goes left, leaves averaged over trees", () => {
  const tree = (f, t, lv, rv) => ({ feature: b64(Int16Array, [f, -2, -2]), threshold: b64(Float64Array, [t, -2, -2]),
    left: b64(Int32Array, [1, -1, -1]), right: b64(Int32Array, [2, -1, -1]), value: b64(Float32Array, [0.5, lv, rv]) });
  const forest = decodeForest({ trees: [tree(0, 1.5, 0.1, 0.9), tree(1, 0, 0.2, 0.6)] });
  const p = predictForest(forest, new Float32Array([1.5, 0, 2, 1]), 2);
  near(p[0], (0.1 + 0.2) / 2, 1e-7, "row 0 (ties go left)");
  near(p[1], (0.9 + 0.6) / 2, 1e-7, "row 1");
});

const { checkBox, MAX_SPAN_DEG } = await import("./flood-ml-run.js");
check("resolution follows zoom: the 250 m tier refuses a view wider than its span", () => {
  ok(checkBox({ west: 0, east: MAX_SPAN_DEG + 0.1, south: 0, north: 1 }).error.includes("global layer"), "wide view not refused");
  ok(checkBox({ west: 10, east: 11, south: 45, north: 46 }).box, "a 1° view refused");
  ok(checkBox({ west: 0, east: 1, south: 84.5, north: 85 }).error, "beyond 84°N not refused");
  ok(checkBox(null).error && checkBox({ west: NaN }).error, "no ground not refused");
});

for (const tier of ["fine", "coarse"]) {
  const path = join(HERE, `../../../data/global/flood-ml/forest-${tier}.json`);
  const main = join("/home/owen/GeoID_webpage_v1/data/global/flood-ml", `forest-${tier}.json`);
  const file = existsSync(path) ? path : existsSync(main) ? main : null;
  check(`the ${tier} forest gives scikit-learn's own answers${file ? "" : " (not baked here; skipped)"}`, () => {
    if (!file) return;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    ok(JSON.stringify(doc.features) === JSON.stringify(FEATURES), "feature order differs from flood-ml.js");
    const forest = decodeForest(doc);
    const rows = new Float32Array(doc.check.rows.flat());
    const p = predictForest(forest, rows);
    doc.check.proba.forEach((q, i) => near(p[i], q, 1e-5, `row ${i}`));
  });
}

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
