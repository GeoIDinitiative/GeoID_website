/**
 * The zoom bar's scale.
 *
 * The mapping is the whole control: get it wrong and the slider still slides,
 * still looks fine, and simply lies about where you are — the failure is
 * invisible without arithmetic, so here is the arithmetic.
 *
 * Run: node GeoID_GIS/viewer/gis/zoom-bar.test.mjs
 */

import {
  ZOOM_BANDS, bandFor, altitudeToFraction, fractionToAltitude, formatAltitude,
} from "./zoom-bar.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const close = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

const MIN = 1.8e3;          // the floor with imagery, ~1.8 km
const MAX = 152_000e3;      // max zoom-out

// ── Bands ────────────────────────────────────────────────────────────────────
check("a street-level view is Site", bandFor(2e3) === "Site", bandFor(2e3));
check("50 km up is Local", bandFor(50e3) === "Local", bandFor(50e3));
check("400 km up is Regional", bandFor(400e3) === "Regional", bandFor(400e3));
check("3000 km up is Continental", bandFor(3000e3) === "Continental", bandFor(3000e3));
check("orbit is Global", bandFor(20000e3) === "Global", bandFor(20000e3));
check("the bands are ordered and cover everything",
  ZOOM_BANDS[ZOOM_BANDS.length - 1].upTo === Infinity
  && ZOOM_BANDS.every((b, i) => i === 0 || b.upTo > ZOOM_BANDS[i - 1].upTo));
// A boundary belongs to the band above it, so no altitude falls between two.
check("a boundary belongs upward", bandFor(10e3) === "Local", bandFor(10e3));

// ── The track ────────────────────────────────────────────────────────────────
close("the floor is the left end", altitudeToFraction(MIN, MIN, MAX), 0, 1e-9);
close("the ceiling is the right end", altitudeToFraction(MAX, MIN, MAX), 1, 1e-9);
check("below the floor clamps", altitudeToFraction(1, MIN, MAX) === 0);
check("above the ceiling clamps", altitudeToFraction(1e12, MIN, MAX) === 1);

// The round trip has to hold or the thumb drifts as you drag.
for (const m of [MIN, 5e3, 50e3, 500e3, 5000e3, 50_000e3, MAX]) {
  close(`${formatAltitude(m)} survives the round trip`,
    fractionToAltitude(altitudeToFraction(m, MIN, MAX), MIN, MAX), m, m * 1e-9);
}

// Logarithmic, and this is the point of it: equal decades get equal track.
// 1.8 km -> 18 km and 1800 km -> 18,000 km must occupy the same width.
const decadeLow = altitudeToFraction(18e3, MIN, MAX) - altitudeToFraction(1.8e3, MIN, MAX);
const decadeHigh = altitudeToFraction(18000e3, MIN, MAX) - altitudeToFraction(1800e3, MIN, MAX);
close("a decade near the ground is as wide as a decade near orbit",
  decadeLow, decadeHigh, 1e-9);

// And the sanity check that a linear scale would fail: the useful close range
// must not be crushed into the last sliver of the track.
const closeRangeShare = altitudeToFraction(100e3, MIN, MAX);
check("Site+Local occupy a usable share of the track",
  closeRangeShare > 0.3, `${(closeRangeShare * 100).toFixed(0)}%`);
// Linear would give this, for contrast:
check("a linear scale would have crushed them", (100e3 - MIN) / (MAX - MIN) < 0.001,
  `${(((100e3 - MIN) / (MAX - MIN)) * 100).toFixed(4)}%`);

// Midpoint of the track is the geometric mean, not the arithmetic one.
close("the middle of the track is the geometric middle",
  fractionToAltitude(0.5, MIN, MAX), Math.sqrt(MIN * MAX), Math.sqrt(MIN * MAX) * 1e-9);

// ── Reading it ───────────────────────────────────────────────────────────────
check("metres below a kilometre", formatAltitude(850) === "850 m", formatAltitude(850));
check("one decimal in the low kilometres", formatAltitude(2400) === "2.4 km", formatAltitude(2400));
check("whole kilometres above ten", formatAltitude(45_000) === "45 km", formatAltitude(45_000));
check("thousands separated at orbit", formatAltitude(16_694_000) === "16,694 km",
  formatAltitude(16_694_000));
check("nonsense is not printed as a number", formatAltitude(NaN) === "—");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
