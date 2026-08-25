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

import {
  envelope, meanOf, dbColour, DB_RAMP, displayBand,
  arrivalTimes, detectOnset, detectSecondary, VELOCITY, MAX_MODEL_KM,
  SP_KM_PER_SECOND, distanceFromSP, expectedSP,
} from "./seismogram-plot.js";

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

/* ── predicted arrivals ───────────────────────────────────────────────────── */

const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 120 km away, no depth, window opening exactly at the origin: P at 120/6 = 20 s,
// S at 120/(6/√3) = 34.6 s.
const local = arrivalTimes({
  distanceKm: 120, depthKm: 0, originMs: 1_000_000, startMs: 1_000_000,
  sampleRate: 100, sampleCount: 30000,
});
check("P from the direct crustal speed", near(local.p, 20, 0.01), true);
check("S from P over root three", near(local.s, 20 * Math.sqrt(3), 0.01), true);
check("S always follows P", local.s > local.p, true);
check("both inside a 300 s window", [local.inWindow, local.sInWindow], [true, true]);

// Past the crossover the first arrival is Pn through the mantle, which is why
// one constant will not do: at 400 km, 6 km/s would be 25 s late.
const regional = arrivalTimes({
  distanceKm: 400, originMs: 0, startMs: 0, sampleRate: 100, sampleCount: 60000,
});
check("beyond the crossover it is the mantle speed",
  near(regional.p, 400 / VELOCITY.pnKmS, 0.01), true);
check("which is earlier than the crustal one would give",
  regional.p < 400 / VELOCITY.pgKmS, true);

/**
 * Depth is HYPOCENTRAL, and this is the case that catches it: an earthquake
 * 600 km down under a station 100 km away is 608 km of rock, not 100.
 */
const deep = arrivalTimes({
  distanceKm: 100, depthKm: 600, originMs: 0, startMs: 0, sampleRate: 100, sampleCount: 60000,
});
check("the path is the hypocentral distance", near(deep.path, Math.hypot(100, 600), 0.01), true);
check("so a deep event is not marked as a near one", deep.p > 60, true);

// A window that opens a minute before the origin puts the arrivals a minute
// later in the picture.
const late = arrivalTimes({
  distanceKm: 120, originMs: 60_000, startMs: 0, sampleRate: 100, sampleCount: 30000,
});
check("the window's own start is the zero of the axis", near(late.p, 80, 0.01), true);

// Outside the fetched window there is nothing to mark, and a line pinned to
// the edge would say the wave arrived exactly there.
const short = arrivalTimes({
  distanceKm: 120, originMs: 0, startMs: 0, sampleRate: 100, sampleCount: 500,
});
check("an arrival past the end of the trace is flagged, not clamped",
  [short.inWindow, short.sInWindow], [false, false]);

// A teleseism's ray turns deep into the mantle where the speed rises with
// depth: a straight-line divide is nonsense and the honest answer is to refuse.
check("it refuses a distance the model cannot describe",
  arrivalTimes({ distanceKm: MAX_MODEL_KM + 1, originMs: 0, startMs: 0 }).tooFar, true);
check("and refuses to guess with nothing to go on",
  arrivalTimes({ distanceKm: null, originMs: 0, startMs: 0 }), null);
check("or with no origin time", arrivalTimes({ distanceKm: 100, startMs: 0 }), null);

/* ── the detected onset ───────────────────────────────────────────────────── */

/** Deterministic pseudo-noise: a test that uses Math.random is a test that
    passes most of the time. */
function noise(n, amplitude, seed = 7) {
  const out = new Float64Array(n);
  let x = seed;
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out[i] = ((x / 2147483648) - 0.5) * 2 * amplitude;
  }
  return out;
}

const fs = 100;
const quietThenBurst = noise(fs * 40, 1);
// An arrival at 20 s: fifty times the noise amplitude, decaying like a coda.
for (let i = 0; i < fs * 10; i += 1) {
  const at = fs * 20 + i;
  quietThenBurst[at] += 50 * Math.sin((2 * Math.PI * 5 * i) / fs) * Math.exp(-i / (fs * 3));
}
const onset = detectOnset(quietThenBurst, fs);
ok("an arrival is found", onset !== null);
check("and it is found where it was planted", near(onset, 20, 0.6), true);

/**
 * A crossing is not enough on its own, and this case is why.
 *
 * Measured on a real trace -- GE.MATE over an M4.4 in Albania -- the ratio
 * crossed a hundred seconds before the earthquake, on a tick in the station's
 * own noise: STA/LTA is RELATIVE, so a small glitch in a very quiet minute is a
 * large ratio. What separates a tick from an arrival is DURATION, and this
 * plants exactly that tick to prove the rule catches it.
 */
const withGlitch = Float64Array.from(quietThenBurst);
for (let i = 0; i < 8; i += 1) withGlitch[fs * 12 + i] += 8;
check("a tick in the noise is not an arrival",
  near(detectOnset(withGlitch, fs), 20, 0.6), true);
// And the tick IS a large enough ratio to fool a detector that only looks at
// the crossing -- otherwise the test above proves nothing about the rule.
check("though its ratio alone would have passed",
  near(detectOnset(withGlitch, fs, { holdSeconds: 0 }), 12, 0.6), true);

// All noise and no arrival: the honest answer is nothing, not a mark on the
// loudest piece of nothing.
check("pure noise gives no onset", detectOnset(noise(fs * 40, 1, 99), fs), null);
check("a trace shorter than the long window gives none",
  detectOnset(noise(200, 1), fs), null);
check("nonsense in, null out", detectOnset([], fs), null);
check("and a nonsense rate too", detectOnset(quietThenBurst, 0), null);

/**
 * A digitiser's offset is not energy. Forty thousand counts of DC with the same
 * arrival on top must be detected in the same place, or every real trace --
 * which all carry an offset -- fails.
 */
const offset = Float64Array.from(quietThenBurst, (v) => v + 40000);
check("a DC offset changes nothing", near(detectOnset(offset, fs), onset, 1e-9), true);

/* ── S−P, and the distance it gives ──────────────────────────────────────── */

// One second of S−P is about eight kilometres: the oldest measurement in
// seismology, and the reason a single station can say anything about distance.
check("the rule is about eight kilometres a second",
  near(SP_KM_PER_SECOND, 8.2, 0.1), true);
check("it is derived from the crustal pair, not typed in",
  near(SP_KM_PER_SECOND, 1 / (VELOCITY.vpOverVs / VELOCITY.pgKmS - 1 / VELOCITY.pgKmS), 1e-9),
  true);
check("ten seconds is about eighty kilometres", Math.round(distanceFromSP(10)), 82);
check("the two directions agree", near(distanceFromSP(expectedSP(239)), 239, 0.001), true);
check("no interval, no distance", distanceFromSP(null), null);
check("and a negative one is not a distance", distanceFromSP(-4), null);
check("nor is a distance of nothing", expectedSP(0), null);

/* ── picking S ────────────────────────────────────────────────────────────── */

/**
 * S is not "louder than the noise", it is louder than the CODA already running.
 *
 * This is the case that killed the first attempt: pointing the P detector at
 * the seconds after P triggers instantly, because everything after P clears a
 * bar set by the quiet before it. Measured on a real trace, that gave an S
 * three seconds after the P and twenty-six before the real one.
 */
const twoArrivals = noise(fs * 120, 1);
for (let i = 0; i < fs * 60; i += 1) {
  // P at 20 s, decaying; S at 50 s, four times the size.
  const t = i / fs;
  const p = 20 * Math.sin((2 * Math.PI * 6 * i) / fs) * Math.exp(-t / 25);
  twoArrivals[fs * 20 + i] += p;
  if (i < fs * 40) {
    twoArrivals[fs * 50 + i] += 80 * Math.sin((2 * Math.PI * 3 * i) / fs) * Math.exp(-t / 20);
  }
}
const pPick = detectOnset(twoArrivals, fs);
check("the P is where it was planted", near(pPick, 20, 0.6), true);
const sPick = detectSecondary(twoArrivals, fs, {
  afterSeconds: pPick, expectedGapSeconds: 30,
});
ok("an S is found", sPick !== null);
check("and it is the second arrival, not the first coda",
  near(sPick, 50, 2), true);
check("so S−P comes out near the true gap", near(sPick - pPick, 30, 2), true);

// One arrival and nothing after it: no step, no S, and no invented one.
const onlyP = noise(fs * 120, 1);
for (let i = 0; i < fs * 60; i += 1) {
  onlyP[fs * 20 + i] += 20 * Math.sin((2 * Math.PI * 6 * i) / fs) * Math.exp(-i / (fs * 25));
}
check("a coda with no second arrival gives no S",
  detectSecondary(onlyP, fs, { afterSeconds: 20, expectedGapSeconds: 30 }), null);
check("and nonsense in gives null", detectSecondary([], fs, { afterSeconds: 1 }), null);
check("as does no P to search after",
  detectSecondary(twoArrivals, fs, { afterSeconds: NaN }), null);

// The search is BOUNDED by the model rather than answered by it: an S three
// times further out than the distance predicts is not this earthquake's S.
check("it does not look past three times the expected gap",
  detectSecondary(twoArrivals, fs, { afterSeconds: pPick, expectedGapSeconds: 5 }), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
