/**
 * What the Earth Engine panel says about resolution.
 *
 * The panel used to report `scale` from the response — the DATASET's native
 * resolution, what the instrument records — as though it described the picture
 * that arrived. Measured across the shipped cache, every snapshot is 1024 px
 * covering the whole world, so the real ground sample is 39 km per pixel while
 * the panel said "at 30 m" for NASADEM. An over-claim of 1305×, and exactly the
 * kind that is never noticed, because 30 m is a true fact about NASADEM.
 *
 * The numbers below are worked from the geometry, not from the implementation.
 *
 * Run: node GeoID_GIS/viewer/gis/gee-resolution.test.mjs
 */

import { deliveredMetresPerPixel, formatResolution } from "./gee.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const close = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

const GLOBAL = { minX: -180, minY: -85, maxX: 180, maxY: 85 };

// The shipped cache, exactly: 1024 px across the full 360°.
// 40,075,017 m / 1024 = 39,135.8 m per pixel.
close("the shipped global snapshot is 39 km/px",
  deliveredMetresPerPixel(GLOBAL, { naturalWidth: 1024, naturalHeight: 484 }), 39135.8, 1);

// Which is the whole point: NASADEM is a 30 m product delivered at 39 km.
const delivered = deliveredMetresPerPixel(GLOBAL, { naturalWidth: 1024 });
check("NASADEM is delivered ~1300x coarser than its native 30 m",
  Math.round(delivered / 30) === 1305, `ratio ${Math.round(delivered / 30)}`);

// Latitude convergence: the same pixel count over a box at 60°N covers half the
// ground, so the sample is half the size. Same convention as the tile drape.
const equator = deliveredMetresPerPixel(
  { minX: 0, maxX: 1, minY: -0.5, maxY: 0.5 }, { naturalWidth: 100 });
const sixty = deliveredMetresPerPixel(
  { minX: 0, maxX: 1, minY: 59.5, maxY: 60.5 }, { naturalWidth: 100 });
close("60 degrees north halves the ground sample", sixty, equator / 2, 1e-6);

// A degree of longitude at the equator is 111.3 km; over 100 px that is 1113 m.
close("one degree over 100 px is 1113 m/px", equator, 1113.19, 1);

// More pixels, finer sample, linearly.
check("doubling the width halves the sample",
  Math.abs(deliveredMetresPerPixel(GLOBAL, { naturalWidth: 2048 }) * 2 - delivered) < 1e-6);

// `width` is accepted as well as `naturalWidth` — a canvas has one, an <img>
// the other, and the caller should not have to care which it was handed.
check("a canvas-style {width} is accepted",
  deliveredMetresPerPixel(GLOBAL, { width: 1024 }) === delivered);

// Nothing to measure must answer null rather than a confident wrong number.
check("no image is null", deliveredMetresPerPixel(GLOBAL, null) === null);
check("a zero-width image is null", deliveredMetresPerPixel(GLOBAL, { naturalWidth: 0 }) === null);
check("no bounds is null", deliveredMetresPerPixel(null, { naturalWidth: 1024 }) === null);
check("non-numeric bounds are null",
  deliveredMetresPerPixel({ minX: "a", maxX: "b", minY: 0, maxY: 1 }, { naturalWidth: 10 }) === null);

// ── Formatting ───────────────────────────────────────────────────────────────
check("39 km reads as km", formatResolution(39135.8) === "39 km/px", formatResolution(39135.8));
check("5 km keeps one decimal", formatResolution(5000) === "5.0 km/px", formatResolution(5000));
check("999 m stays in metres", formatResolution(999) === "999 m/px", formatResolution(999));
check("15 m stays in metres", formatResolution(15.1) === "15 m/px", formatResolution(15.1));
check("sub-10 m keeps a decimal", formatResolution(0.6) === "0.6 m/px", formatResolution(0.6));
check("nonsense is named, not printed", formatResolution(NaN) === "unknown resolution");
check("zero is named too", formatResolution(0) === "unknown resolution");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
