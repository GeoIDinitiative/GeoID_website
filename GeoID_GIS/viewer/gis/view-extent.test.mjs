/**
 * The decision to spend a round of tiles.
 *
 * `viewChangedEnough` is the whole cost control for zoom refinement, and both
 * ways of getting it wrong are expensive rather than merely wrong: too eager and
 * a globe re-fetches the view it is already showing every time it settles; too
 * lax and flying in does nothing, which is the bug this feature exists to fix.
 *
 * It is pure for exactly this reason — the hysteresis can be pinned without a
 * camera, a network or a clock.
 *
 * Run: node GeoID_GIS/viewer/gis/view-extent.test.mjs
 */

import { viewChangedEnough } from "./view-extent.js";
import { readFileSync } from "node:fs";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const box = (minLon, minLat, maxLon, maxLat) => ({ minLon, minLat, maxLon, maxLat });

// A 10° view over Sicily, and the same view again.
const view = box(10, 33, 20, 43);

check("the first view always counts as a change", viewChangedEnough(null, view));
check("no previous and no next is not a change", !viewChangedEnough(null, null));
check("an identical view is not a change", !viewChangedEnough(view, view));

// ── Zooming ──────────────────────────────────────────────────────────────────
// Halving the span is a real zoom step and must refresh.
check("zooming in by 2x refreshes", viewChangedEnough(view, box(12.5, 35.5, 17.5, 40.5)));
// Doubling out must too — the patch no longer covers what is on screen.
check("zooming out by 2x refreshes", viewChangedEnough(view, box(5, 28, 25, 48)));
// A nudge is not a zoom step. This is what stops a settle-refetch loop.
check("a 10% zoom is ignored", !viewChangedEnough(view, box(10.5, 33.5, 19.5, 42.5)));
// Right at the threshold either side, so the boundary is deliberate.
check("1.5x is below the zoom threshold",
  !viewChangedEnough(view, box(11.67, 34.67, 18.33, 41.33)));
// 10 / 1.7 = 5.88 degrees, centred: 15 +/- 2.94 and 38 +/- 2.94.
check("1.7x is above it", viewChangedEnough(view, box(12.06, 35.06, 17.94, 40.94)));

// ── Panning ──────────────────────────────────────────────────────────────────
// Same size, moved a long way: the patch is looking at somewhere else entirely.
check("panning a whole view refreshes", viewChangedEnough(view, box(20, 33, 30, 43)));
// Half a view across is still well past the 35% threshold.
check("panning half a view refreshes", viewChangedEnough(view, box(15, 33, 25, 43)));
// A small drift is not worth a round of tiles.
check("a 10% pan is ignored", !viewChangedEnough(view, box(11, 33, 21, 43)));
// Diagonal movement counts on the hypotenuse, not per axis: 3° east and 3°
// north is 4.24° of movement against a 3.5° threshold.
check("a diagonal pan is measured on the hypotenuse",
  viewChangedEnough(view, box(13, 36, 23, 46)));

// ── The property that matters ────────────────────────────────────────────────
// Whatever it decides, deciding twice about the same pair must agree — a
// non-deterministic answer here would show up as random refetching.
let stable = true;
for (const next of [view, box(12.5, 35.5, 17.5, 40.5), box(20, 33, 30, 43)]) {
  if (viewChangedEnough(view, next) !== viewChangedEnough(view, next)) stable = false;
}
check("the decision is deterministic", stable);

// A degenerate box must not divide by zero into a NaN comparison, which would
// silently answer false forever and switch refinement off with no error.
const degenerate = box(15, 38, 15, 38);
check("a zero-size view is handled", typeof viewChangedEnough(view, degenerate) === "boolean");
check("and from a zero-size view too",
  typeof viewChangedEnough(degenerate, view) === "boolean");

// Custom thresholds are honoured, so a caller can be stricter or looser.
check("a stricter zoom threshold catches a smaller change",
  viewChangedEnough(view, box(10.5, 33.5, 19.5, 42.5), { zoomRatio: 1.05 }));
check("a looser one ignores a bigger one",
  !viewChangedEnough(view, box(12.5, 35.5, 17.5, 40.5), { zoomRatio: 4, moveFraction: 4 }));

/* ── the box has to cover the WINDOW, not a square about its centre ─────── */

/**
 * `camera.fov` is the VERTICAL field of view and a screen is wider than it is
 * tall, so clamping longitude with the vertical span cut the box to about nine
 * tenths of the strict horizontal view before any context was added. Measured
 * at 498 km over the Alps with a 1.79 aspect: a box 8.6° wide against a screen
 * covering 10.3°, six of eight sampled screen points outside it, and their
 * incidence a perfectly ordinary 0.72 -- which is the coarse imagery flanking
 * the streamed patch.
 *
 * The source is checked rather than the behaviour: the clamp needs a camera
 * and a sphere, and what matters is that the aspect is in the longitude half
 * span at all.
 */
{
  const src = readFileSync(new URL("./view-extent.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("longitude is clamped with the HORIZONTAL field of view",
    /const halfLon = \(halfLat \* aspect\)/.test(src));
  check("and the aspect is read off the camera rather than assumed",
    /camera\.aspect/.test(src));
  check("a grazing ray is dropped at the source, where it is still a ray",
    /< GRAZING\) continue;/.test(src));
  check("and the grazing threshold is named rather than inlined",
    /const GRAZING = /.test(src));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
