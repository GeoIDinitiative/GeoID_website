/**
 * The parts of the seismogram plot that can be wrong without looking wrong.
 *
 * A canvas cannot be checked here and does not need to be — what matters is
 * that the decimation keeps the earthquake, and that the colour ramp maps
 * quiet to dark and loud to bright monotonically. Both fail silently: a
 * subsampled trace draws a perfectly convincing flat line where the P arrival
 * was, and a ramp that dips in brightness reads as structure that is not in
 * the data.
 */

import { envelope, meanOf, dbColour, DB_RAMP, displayBand } from "./seismogram-plot.js";

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass += 1; console.log(`PASS ${name}`); } else {
    fail += 1;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}
const ok = (name, got) => check(name, Boolean(got), true);

/* ── the envelope ─────────────────────────────────────────────────────────── */

check("an empty trace draws nothing", envelope([], 10), []);
check("one sample per column is the samples themselves",
  envelope([1, -2, 3], 3), [[1, 1], [-2, -2], [3, 3]]);
check("never more columns than samples", envelope([1, 2], 50).length, 2);
check("each column is [min, max]", envelope([0, 4, -4, 0], 2), [[0, 4], [-4, 0]]);

/**
 * The reason this function exists.
 *
 * A P arrival is a few samples wide. Sampling every hundredth sample -- the
 * obvious way to fit 30,000 samples into 300 pixels -- draws a flat line
 * exactly where the earthquake is, and the picture looks fine.
 */
const quiet = new Array(10000).fill(0);
const withSpike = quiet.slice();
withSpike[5000] = 900;
withSpike[5001] = -750;

const naive = [];
for (let i = 0; i < withSpike.length; i += Math.floor(withSpike.length / 300)) naive.push(withSpike[i]);
check("subsampling loses the arrival entirely", Math.max(...naive), 0);

const bars = envelope(withSpike, 300);
check("the envelope keeps the peak", Math.max(...bars.map(([, hi]) => hi)), 900);
check("and the trough", Math.min(...bars.map(([lo]) => lo)), -750);
check("both land in the same column",
  bars.findIndex(([, hi]) => hi === 900), bars.findIndex(([lo]) => lo === -750));

// The last column must reach the end, or a trace that ends on its peak is
// drawn as though it ended quietly.
const risesAtTheEnd = [0, 0, 0, 0, 0, 0, 0, 0, 0, 99];
check("the last column runs to the last sample",
  envelope(risesAtTheEnd, 3).at(-1)[1], 99);

check("the mean is what a trace is centred on", meanOf([1, 2, 3, 4]), 2.5);
check("an empty trace has no mean to speak of", meanOf([]), 0);

/* ── the decibel ramp ─────────────────────────────────────────────────────── */

check("the ramp is ordered", DB_RAMP.every((s, i) => i === 0 || s.t > DB_RAMP[i - 1].t), true);
check("the loudest cell is the top of the ramp", dbColour(0, -60), DB_RAMP.at(-1).rgb);
check("the floor is the bottom of it", dbColour(-60, -60), DB_RAMP[0].rgb);
check("below the floor stays there", dbColour(-200, -60), DB_RAMP[0].rgb);
// dB is relative to the picture's own peak, so nothing should exceed 0 -- but
// a rounding error above it must not wrap round to black.
check("above the peak is clamped, not wrapped", dbColour(3, -60), DB_RAMP.at(-1).rgb);

// Monotone in brightness: a dip reads as a band of structure that is not in
// the data, which is the classic failure of a hand-picked ramp.
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
let rising = true;
let previous = -1;
for (let db = -60; db <= 0; db += 1) {
  const l = luma(dbColour(db, -60));
  if (l < previous - 0.5) rising = false;
  previous = l;
}
check("brightness never falls as power rises", rising, true);
ok("and the two ends are far apart",
  luma(dbColour(0, -60)) - luma(dbColour(-60, -60)) > 180);

/* ── the band shown ───────────────────────────────────────────────────────── */

// Nyquist when that is the lower of the two: a 20 Hz channel has nothing above
// 10 Hz, and claiming an axis to 25 would be drawing an empty strip and
// labelling it.
check("a slow channel shows to its own Nyquist", displayBand(20), 10);
check("a fast one stops at the cap", displayBand(100), 25);
check("exactly at the cap", displayBand(50), 25);
check("a nonsense rate shows nothing rather than NaN", displayBand(undefined), 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
