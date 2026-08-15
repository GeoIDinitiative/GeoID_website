/**
 * The chart maths, against distributions whose answers are known before the
 * code runs.
 *
 * Only the PURE half of chart-core.js is tested here — binData, boxStats,
 * niceTicks, quantile, extent — because those are the half that can be wrong
 * without looking wrong. A histogram drawn from bad bins is still a picture of
 * bars; a quartile off by one convention still lands inside the box. Nothing
 * about the drawing is checked, and nothing about it needs a browser to be
 * imported: the module has no top-level DOM.
 *
 * The quartile expectations are MEASUREMENTS, not recollections. Every one was
 * produced by numpy on the same array and pasted in:
 *
 *   python3 -c "import numpy as np; print(np.percentile(np.arange(1,10),[25,50,75]))"
 *     -> [3. 5. 7.]
 *   ... np.percentile(np.array(list(range(1,10))+[100]),[25,50,75])
 *     -> [3.25 5.5  7.75]
 *   ... np.percentile(np.array([2,4,4,4,5,5,7,9]),[25,50,75])
 *     -> [4.  4.5 5.5]
 *   ... np.percentile(np.array([1.,2.,3.,4.]),[25,50,75])
 *     -> [1.75 2.5  3.25]
 *   ... np.histogram(np.arange(100), bins=10)[0]
 *     -> [10 10 10 10 10 10 10 10 10 10]
 *
 * That is the point of picking R type 7 / numpy's default in the first place:
 * a quartile quoted in this panel is the quartile every other tool in the
 * stack would quote, and this file is what says so.
 *
 * Run: node GeoID_GIS/viewer/gis/chart-core.test.mjs
 */

import {
  binData, boxStats, niceTicks, quantile, extent, formatNumber, toNumber,
} from "./chart-core.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);
const same = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ── toNumber ───────────────────────────────────────────────────────────── */

{
  // The bug this exists to prevent: an empty attribute is not the number zero,
  // but Number() says it is — for null, "", [] and false alike. A missing
  // column would then draw as a spike of zeros with the domain dragged down to
  // meet it, which looks like data.
  check("null is not zero", Number.isNaN(toNumber(null)));
  check("an empty string is not zero", Number.isNaN(toNumber("")));
  check("whitespace is not zero", Number.isNaN(toNumber("   ")));
  check("an empty array is not zero", Number.isNaN(toNumber([])));
  check("false is not zero", Number.isNaN(toNumber(false)));
  check("undefined is not a number", Number.isNaN(toNumber(undefined)));
  check("a numeric string is its number", toNumber(" 12.5 ") === 12.5);
  check("a real number passes through", toNumber(-3) === -3);
  check("Infinity is not a plottable number", Number.isNaN(toNumber(Infinity)));
}

/* ── niceTicks ──────────────────────────────────────────────────────────── */

{
  // 0–10 asked for 5: the step rounds to 2, which gives six ticks. The count
  // is a target and the roundness is the requirement, so six is correct and
  // an exact five would mean steps of 2.5.
  same("0–10 at 5 ticks lands on the twos", niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  same("3–7 at 4 ticks lands on the integers", niceTicks(3, 7, 4), [3, 4, 5, 6, 7]);
  same("0–100 at 5 ticks lands on the twenties",
    niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);

  // 0.2 × 3 is 0.6000000000000001 in binary floating point. A tick carrying
  // that dust prints as a twelve-character label nobody asked for.
  const unit = niceTicks(0, 1, 5);
  check("a fractional step carries no floating-point dust",
    unit.every((t) => String(t).length <= 3), JSON.stringify(unit));
  check("and 0.6 is exactly 0.6", unit.includes(0.6), JSON.stringify(unit));

  const straddle = niceTicks(-5, 5, 5);
  check("a range straddling zero puts a tick on zero", straddle.includes(0),
    JSON.stringify(straddle));

  same("the arguments may arrive either way round",
    niceTicks(10, 0, 5), niceTicks(0, 10, 5));

  same("a degenerate range is one tick, not none", niceTicks(4, 4, 5), [4]);
  same("a non-finite range is no ticks at all", niceTicks(0, NaN, 5), []);

  // The sweep: the two properties that make ticks "nice" at all, across
  // ranges spanning fourteen orders of magnitude.
  let uniform = true;
  let inside = true;
  let sane = true;
  const cases = [
    [0, 1], [0, 3], [0, 7], [-1, 1], [-273.15, 100], [0.001, 0.009],
    [1e5, 1e6], [-1e-6, 1e-6], [12.5, 87.5], [999, 1001], [0, 1e9],
  ];
  cases.forEach(([lo, hi]) => {
    const ticks = niceTicks(lo, hi, 5);
    if (ticks.length < 2) { sane = false; return; }
    const step = ticks[1] - ticks[0];
    for (let i = 1; i < ticks.length; i += 1) {
      if (Math.abs((ticks[i] - ticks[i - 1]) - step) > Math.abs(step) * 1e-6) uniform = false;
      // Every tick a whole multiple of the step is what "round number" means.
      const k = ticks[i] / step;
      if (Math.abs(k - Math.round(k)) > 1e-6) uniform = false;
    }
    const pad = Math.abs(hi - lo) * 1e-9;
    if (ticks[0] < lo - pad || ticks[ticks.length - 1] > hi + pad) inside = false;
    if (ticks.length < 3 || ticks.length > 12) sane = false;
  });
  check("ticks are evenly spaced on whole multiples of the step", uniform);
  check("no tick falls outside the range it describes", inside);
  check("the count stays near the target across 14 orders of magnitude", sane);
}

/* ── quantile ───────────────────────────────────────────────────────────── */

{
  const four = [1, 2, 3, 4];
  near("quantile is numpy's linear interpolation (q1 of 1..4)",
    quantile(four, 0.25), 1.75, 1e-12);
  near("… and its median", quantile(four, 0.5), 2.5, 1e-12);
  near("… and its q3", quantile(four, 0.75), 3.25, 1e-12);
  near("p=0 is the minimum", quantile(four, 0), 1, 1e-12);
  near("p=1 is the maximum", quantile(four, 1), 4, 1e-12);
}

/* ── binData ────────────────────────────────────────────────────────────── */

{
  const planted = binData([1, 1, 2, 2, 3, 3], { bins: 2 });
  same("a planted two-bin split counts 2 then 4", planted.counts, [2, 4]);
  check("the edges are one longer than the counts",
    planted.edges.length === planted.counts.length + 1,
    `${planted.edges.length} vs ${planted.counts.length}`);
  check("the first edge is the minimum and the last is the maximum",
    planted.edges[0] === 1 && planted.edges[2] === 3, JSON.stringify(planted.edges));
  check("a value on an internal edge belongs to the bin above it",
    planted.counts[1] === 4, "the three 2s and 3s, not the 1s");

  // numpy: np.histogram(np.arange(100), bins=10)[0] is ten tens.
  const uniform = binData(Array.from({ length: 100 }, (_, i) => i), { bins: 10 });
  same("100 evenly spaced values in 10 bins is ten tens",
    uniform.counts, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  near("the bin width is the span over the count", uniform.width, 9.9, 1e-9);
  check("every value was placed", uniform.total === 100, `got ${uniform.total}`);

  const dirty = binData([1, NaN, 2, null, 3, undefined, Infinity], { bins: 2 });
  check("non-numbers are ignored rather than counted as zero",
    dirty.total === 3, `got ${dirty.total}`);
  check("… and they do not drag the domain to zero",
    dirty.min === 1 && dirty.max === 3, `${dirty.min}–${dirty.max}`);

  const flat = binData([7, 7, 7, 7], { bins: 4 });
  check("an all-equal column still has width, so nothing divides by zero",
    flat.width > 0, `width ${flat.width}`);
  check("… and all four values are counted once",
    flat.counts.reduce((a, b) => a + b, 0) === 4, JSON.stringify(flat.counts));

  const fixed = binData([0, 5, 10, 50], { bins: 2, min: 0, max: 10 });
  check("a fixed domain drops what falls outside it rather than clamping",
    fixed.total === 3, `got ${fixed.total}`);
  same("… and bins only what is left", fixed.counts, [1, 2]);

  const strings = binData(["1", "2", "3", "x"], { bins: 1 });
  check("numeric strings count, because attribute tables carry them",
    strings.total === 3, `got ${strings.total}`);
}

/* ── boxStats ───────────────────────────────────────────────────────────── */

{
  // numpy on 1..9: [3, 5, 7].
  const nine = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  near("q1 of 1..9", nine.q1, 3, 1e-12);
  near("median of 1..9", nine.median, 5, 1e-12);
  near("q3 of 1..9", nine.q3, 7, 1e-12);
  check("no outliers in a flat run", nine.outliers.length === 0);
  check("the whiskers are the extremes when nothing is out",
    nine.min === 1 && nine.max === 9, `${nine.min}–${nine.max}`);
  near("the IQR is q3 minus q1", nine.iqr, nine.q3 - nine.q1, 1e-12);

  // numpy on 1..9 with a 100 appended: [3.25, 5.5, 7.75].
  // Fences are then 3.25 − 6.75 = −3.5 and 7.75 + 6.75 = 14.5, so 100 is out
  // and the upper whisker retreats to 9.
  const skewed = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  near("q1 with an outlier present", skewed.q1, 3.25, 1e-12);
  near("median with an outlier present", skewed.median, 5.5, 1e-12);
  near("q3 with an outlier present", skewed.q3, 7.75, 1e-12);
  same("the outlier is reported as one", skewed.outliers, [100]);
  check("the whisker stops at the last value inside the fence, not at the outlier",
    skewed.max === 9, `got ${skewed.max}`);
  check("the true extreme is still available as highest",
    skewed.highest === 100, `got ${skewed.highest}`);
  check("and the lower whisker is untouched",
    skewed.min === 1 && skewed.lowest === 1);

  // numpy on the textbook set [2,4,4,4,5,5,7,9]: [4, 4.5, 5.5].
  const textbook = boxStats([2, 4, 4, 4, 5, 5, 7, 9]);
  near("q1 of the textbook set", textbook.q1, 4, 1e-12);
  near("median of the textbook set", textbook.median, 4.5, 1e-12);
  near("q3 of the textbook set", textbook.q3, 5.5, 1e-12);
  // IQR 1.5 -> fences 1.75 and 7.75, so the 9 is out and the 2 is not.
  same("its 9 is an outlier and its 2 is not", textbook.outliers, [9]);

  const one = boxStats([42]);
  check("a single value collapses the box onto itself",
    one.q1 === 42 && one.median === 42 && one.q3 === 42 && one.min === 42 && one.max === 42);
  check("… with nothing called an outlier", one.outliers.length === 0);

  const none = boxStats([]);
  check("an empty column reports a count of zero rather than throwing",
    none.count === 0 && Number.isNaN(none.median));

  const constant = boxStats([5, 5, 5, 5]);
  check("a constant column has a zero IQR and no outliers",
    constant.iqr === 0 && constant.outliers.length === 0);

  // A planted symmetric distribution: the median must land on the centre and
  // the quartiles must be equidistant from it.
  const symmetric = [];
  for (let i = -50; i <= 50; i += 1) symmetric.push(i);
  const sym = boxStats(symmetric);
  near("a symmetric distribution has its median at the centre", sym.median, 0, 1e-12);
  near("… and quartiles equidistant from it", sym.q3 + sym.q1, 0, 1e-12);
  check("the count is every finite value, outliers included",
    sym.count === 101, `got ${sym.count}`);
}

/* ── extent and formatting ──────────────────────────────────────────────── */

{
  const [lo, hi] = extent([0, 10], 0.1);
  check("extent pads outward by the requested fraction of the span",
    lo === -1 && hi === 11, `${lo}–${hi}`);
  const [dlo, dhi] = extent([3, 3]);
  check("a degenerate extent is widened, never returned as zero-width",
    dhi > dlo, `${dlo}–${dhi}`);
  const [elo, ehi] = extent([NaN, undefined]);
  check("an extent of nothing is a usable unit range", elo === 0 && ehi === 1);

  check("a tiny number formats in exponent form", formatNumber(1e-9) === "1.0e-9",
    formatNumber(1e-9));
  check("an ordinary number formats plainly", formatNumber(12.3456) === "12.346",
    formatNumber(12.3456));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
