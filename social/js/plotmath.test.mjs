// node social/js/plotmath.test.mjs
import assert from "node:assert/strict";
import {
  niceTicks, niceDomain, timeTicks, nearestIndex, seriesByUnit, lineToXY, poleOf, planeCircle,
  measurementText, monthRange,
} from "./plotmath.js";

let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log(`ok  ${name}`); };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

ok("nice ticks are round and cover the range", () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(0.13, 0.91, 4), [0.2, 0.4, 0.6, 0.8]);
  assert.ok(niceTicks(5, 5).length >= 2, "a flat series still gets an axis");
  const [lo, hi] = niceDomain(3.2, 97.1, 5);
  assert.ok(lo <= 3.2 && hi >= 97.1);
});

ok("time ticks fall on calendar months", () => {
  const t0 = Date.UTC(2025, 0, 15) / 1000; const t1 = Date.UTC(2025, 11, 20) / 1000;
  const { ticks, unit } = timeTicks(t0, t1, 6);
  assert.equal(unit, "month");
  for (const t of ticks) assert.equal(new Date(t * 1000).getUTCDate(), 1);
  assert.ok(ticks.length >= 3 && ticks.length <= 7, String(ticks.length));
  assert.equal(timeTicks(0, 3 * 86400, 6).unit, "day");
});

ok("nearest index by binary search", () => {
  const xs = [1, 5, 9, 20];
  assert.equal(nearestIndex(xs, 0), 0);
  assert.equal(nearestIndex(xs, 6.9), 1);
  assert.equal(nearestIndex(xs, 7.1), 2);
  assert.equal(nearestIndex(xs, 99), 3);
  assert.equal(nearestIndex([], 1), -1);
});

ok("series group by unit and sort by time", () => {
  const g = seriesByUnit([{ label: "a", unit: "mm", points: [[2, 1], [1, 0]] }, { label: "b", unit: "mm", points: [[1, 2]] }, { label: "c", unit: "°C", points: [[1, 3]] }, { label: "empty", unit: "x", points: [] }]);
  assert.equal(g.length, 2);
  assert.equal(g[0].series.length, 2);
  assert.deepEqual(g[0].series[0].points, [[1, 0], [2, 1]]);
});

ok("stereonet: vertical line at the centre, horizontal on the primitive, north up", () => {
  const [x0, y0] = lineToXY(123, 90, 100);
  near(x0, 0, 1e-6); near(y0, 0, 1e-6);
  const [xn, yn] = lineToXY(0, 0, 100);
  near(xn, 0, 1e-6); near(yn, -100, 1e-6);
  const [xe] = lineToXY(90, 0, 100);
  near(xe, 100, 1e-6);
  // Equal area: a 45° plunge sits at R * sqrt(2) * sin(22.5°), not halfway.
  const [, y45] = lineToXY(180, 45, 1);
  near(y45, Math.SQRT2 * Math.sin(22.5 * Math.PI / 180), 1e-9);
});

ok("a plane's great circle passes through its dip line and its strike ends", () => {
  const pts = planeCircle(90, 30, 1, 48);
  const dipLine = lineToXY(90, 30, 1);
  assert.ok(pts.some(([x, y]) => Math.hypot(x - dipLine[0], y - dipLine[1]) < 1e-6), "the dip line is on the circle");
  near(Math.hypot(...pts[0]), 1, 1e-6);           // strike end on the primitive
  near(Math.hypot(...pts[pts.length - 1]), 1, 1e-6);
  const pole = poleOf(90, 30);
  assert.deepEqual(pole, { trend: 270, plunge: 60 });
  // A vertical plane is a straight diameter.
  for (const [x] of planeCircle(90, 90, 1, 12)) near(x, 0, 1e-6);
});

ok("measurements read as a geologist writes them", () => {
  assert.equal(measurementText({ type: "bedding", values: { strike: 120, dip: 35, dip_direction: 210 } }), "120/35 (dips 35° towards 210)");
  assert.equal(measurementText({ type: "lineation", values: { trend: 5, plunge: 8 } }), "08→005");
  assert.equal(measurementText({ type: "measurement", values: { value: 7.2, unit: "pH" } }), "7.2 pH");
});

ok("month range: oldest first, calendar months, ending this month", () => {
  const now = Date.UTC(2026, 9, 23) / 1000;
  const r = monthRange(now, 24);
  assert.equal(r.length, 24);
  assert.equal(r[23].key, "2026-10");
  assert.equal(r[0].key, "2024-11");
  for (let i = 1; i < r.length; i += 1) assert.equal(r[i].start, r[i - 1].end);
});

console.log(`\n${passed} passed`);
