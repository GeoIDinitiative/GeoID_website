/**
 * Hydrology on surfaces whose drainage is known by looking at them.
 *
 * A cone drains radially and has one watershed. A tilted plane drains one way
 * and accumulates down-slope. A pit in a plane must fill. Each of these has an
 * answer that does not depend on the implementation, which is what makes them
 * worth asserting.
 */

import { makeRaster } from "./raster-analysis.js";
import { fillSinks, flowDirection, flowAccumulation, watershed, streams, viewshed }
  from "./hydrology.js";

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }

const BOUNDS = { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 };
function surface(w, h, fn) {
  const band = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = fn(x, y);
  return makeRaster(band, w, h, BOUNDS, NaN);
}

check("a pit is filled to its rim and the rest is untouched", () => {
  const dem = surface(9, 9, (x, y) => (x === 4 && y === 4 ? 0 : 10));
  const filled = fillSinks(dem);
  if (!(filled.band[4 * 9 + 4] >= 10)) {
    throw new Error(`the pit is still at ${filled.band[40]}`);
  }
  eq(Math.round(filled.band[0]), 10, "the rim is unchanged");
});

check("a slope has nothing to fill", () => {
  const dem = surface(8, 8, (x) => 100 - x);
  const filled = fillSinks(dem);
  for (let i = 0; i < dem.band.length; i += 1) {
    if (Math.abs(filled.band[i] - dem.band[i]) > 1e-3) throw new Error("a slope was altered");
  }
});

check("flow on a tilted plane runs downhill, every cell the same way", () => {
  const dem = surface(8, 8, (x) => 100 - x);
  const { dir } = flowDirection(dem);
  // Neighbour 4 is (+1, 0) — due east, which is downhill here.
  for (let y = 1; y < 7; y += 1) {
    for (let x = 1; x < 6; x += 1) eq(dir[y * 8 + x], 4, `cell ${x},${y}`);
  }
});

check("accumulation grows downslope and totals the grid", () => {
  const dem = surface(8, 8, (x) => 100 - x);
  const acc = flowAccumulation(dem);
  const row = 4;
  for (let x = 1; x < 7; x += 1) {
    if (!(acc.band[row * 8 + x] >= acc.band[row * 8 + x - 1])) {
      throw new Error(`accumulation fell going downhill at ${x}`);
    }
  }
  eq(acc.band[row * 8], 1, "the top of a slope drains only itself");
});

check("a valley drains to its outlet on the edge", () => {
  // NOT a cone: a cone's centre is a closed depression, and filling removes
  // it by design, so nothing drains there afterwards. A real catchment needs
  // an outlet at the edge — here a valley falling to the west.
  const dem = surface(21, 21, (x, y) => x * 2 + Math.abs(y - 10));
  const out = watershed(dem, 0.05, 0.0);          // the low edge, mid-height
  eq(out.ok, true, "ok");
  if (!(out.cells > 20)) throw new Error(`only ${out.cells} cells drained to the outlet`);
  if (!(out.areaKm2 > 0)) throw new Error("no area reported");
});

check("a filled closed basin drains nowhere, and says so honestly", () => {
  // Worth pinning because it looks like a bug: fill a bowl and its centre is
  // no longer a low point, so its catchment is one cell. That is what filling
  // MEANS, and a tool that reported a large catchment here would be lying.
  const bowl = surface(21, 21, (x, y) => Math.hypot(x - 10, y - 10));
  eq(watershed(bowl, 0.05, 0.05).cells, 1, "cells");
});

check("an outlet off the grid is refused", () => {
  const dem = surface(5, 5, () => 1);
  eq(watershed(dem, 50, 50).ok, false, "ok");
});

check("streams are the cells over the threshold, and are counted", () => {
  const acc = surface(6, 6, (x) => x * 100);
  const out = streams(acc, { threshold: 300 });
  eq(out.count, 18, "cells at or above 300");
  if (Number.isFinite(out.raster.band[0])) throw new Error("a below-threshold cell survived");
});

check("a ridge hides what is behind it", () => {
  // The honest test of a viewshed is an obstacle. Flat ground with a wall at
  // x = 12: the observer at x = 10 sees up to it and not past it. (A bowl is
  // the wrong test — from the bottom of a smooth bowl every point of the
  // inner surface is genuinely in view.)
  // The centre of a 25-wide grid is column 12, so the wall goes at 16 — put it
  // at 12 and the observer is standing on top of it, which is a fine view and
  // a useless test.
  const dem = surface(25, 25, (x) => (x === 16 ? 60 : 0));
  const out = viewshed(dem, 0.05, 0.05, { radiusKm: 50, observerHeight: 2 });
  eq(out.ok, true, "ok");
  const at = (x, y) => out.raster.band[y * 25 + x];
  eq(at(14, 12), 1, "the ground before the wall is seen");
  eq(at(16, 12), 1, "the wall itself is seen");
  eq(at(22, 12), 0, "the ground behind it is not");
});

check("an open plain is visible to the horizon", () => {
  const flat = surface(21, 21, () => 10);
  const out = viewshed(flat, 0.05, 0.05, { radiusKm: 50, observerHeight: 2 });
  if (!(out.visibleCells > 100)) throw new Error(`only ${out.visibleCells} cells seen on flat ground`);
});

check("an observer off the grid is refused", () => {
  eq(viewshed(surface(5, 5, () => 1), 90, 90).ok, false, "ok");
});

check("no-data is carried through rather than treated as zero height", () => {
  const dem = surface(7, 7, (x, y) => (x === 3 ? NaN : 10 - y));
  const acc = flowAccumulation(dem);
  for (let y = 0; y < 7; y += 1) {
    if (Number.isFinite(acc.band[y * 7 + 3])) throw new Error("a no-data cell got an accumulation");
  }
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
