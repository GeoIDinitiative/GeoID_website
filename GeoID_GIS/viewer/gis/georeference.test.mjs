/**
 * The affine solve, against transforms planted before the code runs.
 *
 * A georeference that reports success without residuals is the failure mode
 * worth guarding: an exact fit through three points is ALWAYS exact, so the
 * number that matters is what the fourth point does.
 */

import {
  solveAffine, pixelToLatLon, boundsFromTransform, transformFromBounds, drapeWarning,
} from "./georeference.js";

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} — expected ~${b}, got ${a}`);
}

// A planted transform: 0.001° per pixel east, -0.001 per pixel south, origin
// at 54.7N 7.0W — a 1000x1000 image over one degree of Northern Ireland.
const T = { a: 0.001, b: 0, c: -7, d: 0, e: -0.001, f: 54.7 };
const at = (x, y) => ({ x, y, ...pixelToLatLon(T, x, y) });

check("three exact points recover the transform", () => {
  const fit = solveAffine([at(0, 0), at(1000, 0), at(0, 1000)]);
  eq(fit.ok, true, "ok");
  near(fit.coefficients.a, T.a, 1e-9, "x scale");
  near(fit.coefficients.e, T.e, 1e-9, "y scale");
  near(fit.coefficients.c, T.c, 1e-9, "x shift");
  near(fit.coefficients.f, T.f, 1e-9, "y shift");
  near(fit.rmsMetres, 0, 0.01, "residual");
});

check("fewer than three points is refused", () => {
  eq(solveAffine([at(0, 0), at(10, 10)]).ok, false, "ok");
});

check("collinear points are refused rather than solved wrongly", () => {
  const out = solveAffine([at(0, 0), at(10, 10), at(20, 20), at(30, 30)]);
  eq(out.ok, false, "ok");
  if (!/collinear/.test(out.message)) throw new Error(`unhelpful message: ${out.message}`);
});

check("a bad fourth point shows up in the residuals, not the message", () => {
  const good = [at(0, 0), at(1000, 0), at(0, 1000)];
  const wrong = { ...at(1000, 1000) };
  wrong.lat += 0.01;                                  // about 1.1 km out
  const fit = solveAffine([...good, wrong]);
  eq(fit.ok, true, "still solvable");
  if (!(fit.rmsMetres > 100)) throw new Error(`a 1 km error gave rms ${fit.rmsMetres}`);
  const worst = fit.residuals.reduce((a, b) => (a.errorM > b.errorM ? a : b));
  near(worst.x, 1000, 1, "the worst point is identified");
});

check("rotation and skew are measured", () => {
  const rot = { a: 0.001, b: -0.0005, c: 0, d: 0.0005, e: -0.001, f: 0 };
  const p = [[0, 0], [1000, 0], [0, 1000], [1000, 1000]]
    .map(([x, y]) => ({ x, y, ...pixelToLatLon(rot, x, y) }));
  const fit = solveAffine(p);
  if (Math.abs(fit.rotationDeg) < 10) throw new Error(`rotation read as ${fit.rotationDeg}`);
});

check("a rotated image is warned about rather than drawn wrongly", () => {
  const straight = solveAffine([at(0, 0), at(1000, 0), at(0, 1000)]);
  eq(drapeWarning(straight), null, "north-up needs no warning");
  const rot = { a: 0.001, b: -0.0005, c: 0, d: 0.0005, e: -0.001, f: 0 };
  const fit = solveAffine([[0, 0], [1000, 0], [0, 1000]]
    .map(([x, y]) => ({ x, y, ...pixelToLatLon(rot, x, y) })));
  const warning = drapeWarning(fit);
  if (!warning || !/rotated/.test(warning)) throw new Error("no warning for a rotated image");
});

check("bounds come from all four corners", () => {
  const b = boundsFromTransform(T, 1000, 1000);
  near(b.minX, -7, 1e-9, "west"); near(b.maxX, -6, 1e-9, "east");
  near(b.maxY, 54.7, 1e-9, "north"); near(b.minY, 53.7, 1e-9, "south");
});

check("naming the corners round-trips to the same transform", () => {
  const bounds = { minX: -7, minY: 53.7, maxX: -6, maxY: 54.7 };
  const t = transformFromBounds(bounds, 1000, 1000);
  const topLeft = pixelToLatLon(t, 0, 0);
  const bottomRight = pixelToLatLon(t, 1000, 1000);
  near(topLeft.lon, -7, 1e-9, "top-left longitude");
  near(topLeft.lat, 54.7, 1e-9, "top-left latitude — an image's y grows downward");
  near(bottomRight.lon, -6, 1e-9, "bottom-right longitude");
  near(bottomRight.lat, 53.7, 1e-9, "bottom-right latitude");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
