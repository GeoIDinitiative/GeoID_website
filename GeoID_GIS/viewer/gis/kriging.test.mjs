/**
 * Kriging, against the two properties that define it.
 *
 * It is an EXACT interpolator: at a sample location it returns that sample's
 * value and zero variance. And the variance grows with distance from the data,
 * which is the whole reason to use it over IDW.
 */

import { empiricalVariogram, sphericalModel, fitVariogram, krigeAt, krigeGrid }
  from "./kriging.js";

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} — expected ~${b}, got ${a}`);
}

// A plane: value = 100 + 1000 × latitude offset, sampled on a grid.
const POINTS = [];
for (let i = 0; i < 5; i += 1) {
  for (let j = 0; j < 5; j += 1) {
    POINTS.push({ lat: 54 + i * 0.05, lon: -7 + j * 0.05, value: 100 + i * 50 });
  }
}

check("the spherical model rises from the nugget to the sill", () => {
  const model = sphericalModel({ nugget: 2, sill: 10, rangeKm: 20 });
  eq(model(0), 0, "zero distance is zero semivariance");
  near(model(20), 10, 1e-9, "at the range it reaches the sill");
  eq(model(50), 10, "beyond the range it stays there");
  if (!(model(5) > 2 && model(5) < 10)) throw new Error("no rise between");
});

check("the empirical variogram bins pairs by distance", () => {
  const v = empiricalVariogram(POINTS, { bins: 6 });
  if (v.length < 3) throw new Error("too few bins");
  eq(v.every((b) => b.pairs > 0), true, "no empty bin is reported");
  // On a plane the semivariance climbs with lag.
  if (!(v[v.length - 1].semivariance > v[0].semivariance)) {
    throw new Error("semivariance did not grow with distance");
  }
});

check("a fit reports nugget, sill and range", () => {
  const fit = fitVariogram(POINTS);
  eq(fit.ok, true, "ok");
  if (!(fit.rangeKm > 0)) throw new Error("no range");
  if (!(fit.sill >= fit.nugget)) throw new Error("sill below nugget");
});

check("too few points is refused rather than fitted to noise", () => {
  eq(fitVariogram([{ lat: 0, lon: 0, value: 1 }]).ok, false, "ok");
  eq(krigeGrid([{ lat: 0, lon: 0, value: 1 }], { minX: 0, minY: 0, maxX: 1, maxY: 1 }).ok, false, "grid");
});

check("kriging is exact at a sample and certain there", () => {
  const fit = fitVariogram(POINTS);
  const model = sphericalModel(fit);
  const target = POINTS[7];
  const out = krigeAt(POINTS, model, target.lat, target.lon);
  near(out.value, target.value, 1e-6, "value at the sample");
  near(out.variance, 0, 1e-6, "variance at the sample");
});

check("variance grows away from the data", () => {
  const fit = fitVariogram(POINTS);
  const model = sphericalModel(fit);
  const inside = krigeAt(POINTS, model, 54.1, -6.9);
  const outside = krigeAt(POINTS, model, 54.9, -6.1);       // far off the grid
  if (!(outside.variance > inside.variance)) {
    throw new Error(`variance did not grow: ${inside.variance} inside, ${outside.variance} outside`);
  }
});

check("a kriged grid comes back with a variance surface beside it", () => {
  const out = krigeGrid(POINTS, { minX: -7, minY: 54, maxX: -6.8, maxY: 54.2 },
    { cellSizeDeg: 0.05 });
  eq(out.ok, true, "ok");
  eq(out.values.length, out.width * out.height, "values");
  eq(out.variance.length, out.values.length, "variance");
  if (!out.message.includes("range")) throw new Error("the variogram was not reported");
});

check("too fine a grid is refused with the number", () => {
  const out = krigeGrid(POINTS, { minX: -7, minY: 54, maxX: -6, maxY: 55 },
    { cellSizeDeg: 0.0005 });
  eq(out.ok, false, "ok");
  if (!/cells/.test(out.message)) throw new Error("no explanation");
});

check("a long sample list is thinned across its span, not truncated", () => {
  const many = Array.from({ length: 600 }, (_, i) => ({
    lat: 54 + i * 0.001, lon: -7, value: i,
  }));
  const out = krigeGrid(many, { minX: -7.05, minY: 54, maxX: -6.95, maxY: 54.6 },
    { cellSizeDeg: 0.05, maxPoints: 50 });
  eq(out.ok, true, "ok");
  eq(out.samples, 50, "samples used");
  // Truncation would have kept only the first 50 (the southern end); thinning
  // keeps the span, so the estimate near the top is high rather than flat.
  const top = out.values[0];
  const bottom = out.values[out.values.length - 1];
  if (!(Math.abs(top - bottom) > 100)) throw new Error("the far end of the data was dropped");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
