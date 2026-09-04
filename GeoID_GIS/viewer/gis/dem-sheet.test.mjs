/**
 * Which ground the elevation sheet is drawn over.
 *
 * Both cases here were reported from a screenshot rather than caught by a
 * check: a bright stripe down the limb of a globe whose camera was pointed at
 * the middle of the Pacific. The sheet was built correctly — over a box that
 * was a lie.
 *
 * Run: node GeoID_GIS/viewer/gis/dem-sheet.test.mjs
 */

import { sheetBoundsFor } from "./dem-layer.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function ok(c, what) { if (!c) throw new Error(what); }
const isWorld = (b) => b.west === -180 && b.east === 180;

const view = (minLon, maxLon, minLat = 30, maxLat = 40) => ({ minLon, maxLon, minLat, maxLat });

check("a small view is drawn over the view", () => {
  const b = sheetBoundsFor(view(13.7, 16.3, 37, 38.6), 15);
  ok(!isWorld(b), "not the world");
  ok(b.west === 13.7 && b.east === 16.3, `${b.west}..${b.east}`);
});

/**
 * `visibleBounds` answers in min/max longitude with no wrap, so a camera over
 * the Pacific comes back as a strip pinned to 180 -- measured, 164.2 to 180 --
 * and the sheet is then a bright stripe on ground nobody is looking at.
 */
check("a view cut at the antimeridian falls back to the world", () => {
  ok(isWorld(sheetBoundsFor(view(164.2, 180), 179)), "clipped at +180");
  ok(isWorld(sheetBoundsFor(view(-180, -166), -175)), "clipped at -180");
});

check("and so does a box that does not contain what the camera is aimed at", () => {
  // The centre is the one longitude that is always known and never wrapped
  // wrongly, so a box without it in has been cut.
  ok(isWorld(sheetBoundsFor(view(10, 20), 175)), "centre outside the box");
});

check("a wide view is drawn over the world", () => {
  ok(isWorld(sheetBoundsFor(view(-60, 60), 0)), "120 degrees");
  ok(!isWorld(sheetBoundsFor(view(-5, 10), 2)), "15 degrees is not wide");
});

check("no box at all is the world", () => {
  ok(isWorld(sheetBoundsFor(null, 0)), "null");
  ok(isWorld(sheetBoundsFor({ minLon: null, maxLon: null, minLat: null, maxLat: null }, 0)),
    "the shape visibleBounds returns when it cannot see the globe");
});

check("a centre the viewer reports in 0-360 is understood", () => {
  // The viewer carries east-positive 0-360; the box is signed.
  const b = sheetBoundsFor(view(-10, -5, 50, 55), 352.5);
  ok(!isWorld(b), "352.5 east is -7.5, which is inside the box");
});

/* ── the world sheet is for the far field only ───────────────────────────── */

/**
 * The patch is one mesh capped at 192 x 192, so a WORLD sheet is 1.9 degrees a
 * quad -- about 200 km -- and a chord that wide sags roughly 900 m below the
 * sphere between its corners. Nothing from orbit; at a grazing view the sheet
 * and the terrain interleave along the rows, which is the horizontal banding
 * reported as "gaps that fail the depth test".
 */
check("close in, the sheet follows the view rather than the world", () => {
  const wideish = view(-30, 30, 20, 50);   // 60 degrees, too wide for the far-field rule
  ok(isWorld(sheetBoundsFor(wideish, 0, { altitudeKm: 9000 })), "from orbit, the world");
  ok(!isWorld(sheetBoundsFor(wideish, 0, { altitudeKm: 400 })),
    "close in, the view -- where 192 squares is metres a quad, not 200 km");
});

check("but a close view that is somehow global is still the world", () =>
  ok(isWorld(sheetBoundsFor(view(-120, 120, -60, 60), 0, { altitudeKm: 400 })), "120 degrees"));

check("an unknown altitude is treated as the far field", () =>
  ok(isWorld(sheetBoundsFor(view(-30, 30), 0, { altitudeKm: null })), "no altitude"));

check("the seam rules still win at any altitude", () => {
  ok(isWorld(sheetBoundsFor(view(164.2, 180), 179, { altitudeKm: 400 })), "cut at the seam");
  ok(isWorld(sheetBoundsFor(view(10, 20), 175, { altitudeKm: 400 })), "centre outside");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
