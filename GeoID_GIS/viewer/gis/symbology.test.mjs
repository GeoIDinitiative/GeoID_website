/**
 * Classification, against distributions whose right answer is obvious.
 *
 * The methods differ most on skewed data, which is exactly what a
 * susceptibility surface is — so the tests are built on a distribution with a
 * long tail, where equal-interval and quantile must visibly disagree. A test
 * on uniform data would pass for every method and prove nothing.
 */

import {
  RAMPS, rampColour, hex, buildSymbology, classOf, colourOf, legendInfoFrom,
  equalIntervalBreaks, quantileBreaks, jenksBreaks, stdDevBreaks,
} from "./symbology.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`);
}
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} — expected ~${b}, got ${a}`);
}

// Ninety values in 0..10 and ten in 90..100: the shape of a hazard surface.
const SKEWED = [
  ...Array.from({ length: 90 }, (_, i) => (i / 89) * 10),
  ...Array.from({ length: 10 }, (_, i) => 90 + i),
];

check("a ramp runs from its first stop to its last", () => {
  eq(hex(rampColour("risk", 0)), hex(RAMPS.risk[0]), "start");
  eq(hex(rampColour("risk", 1)), hex(RAMPS.risk[RAMPS.risk.length - 1]), "end");
});

check("reversing a ramp swaps its ends", () => {
  eq(hex(rampColour("viridis", 0, { reverse: true })), hex(rampColour("viridis", 1)), "reversed start");
});

check("an unknown ramp falls back rather than throwing", () => {
  if (!Array.isArray(rampColour("no-such-ramp", 0.5))) throw new Error("no colour");
});

check("equal interval cuts the range, whatever the counts", () => {
  const breaks = equalIntervalBreaks([0, 100], 4);
  eq(breaks.length, 3, "interior cuts");
  eq(breaks[0], 25, "first"); eq(breaks[1], 50, "second"); eq(breaks[2], 75, "third");
});

check("quantile cuts the count, whatever the range", () => {
  const breaks = quantileBreaks(SKEWED, 4);
  eq(breaks.length, 3, "cuts");
  // Half the values are below 5, so the middle cut sits in the crowded end —
  // nowhere near the 50 that equal interval would choose.
  if (breaks[1] > 10) throw new Error(`the median cut escaped the crowd at ${breaks[1]}`);
});

check("the two methods disagree on skewed data, which is the point", () => {
  const equal = equalIntervalBreaks(SKEWED, 5);
  const quant = quantileBreaks(SKEWED, 5);
  if (Math.abs(equal[1] - quant[1]) < 10) {
    throw new Error("the methods agreed on data built to separate them");
  }
});

check("natural breaks land in the gap", () => {
  // Two tight clusters with a wide empty span between them: any sane Jenks
  // puts its cut inside that span.
  const values = [...Array.from({ length: 50 }, () => 1 + Math.random() * 0.001),
    ...Array.from({ length: 50 }, () => 100)];
  const breaks = jenksBreaks(values, 2);
  eq(breaks.length, 1, "one cut for two classes");
  if (!(breaks[0] > 1.1 && breaks[0] <= 100)) {
    throw new Error(`the cut landed at ${breaks[0]}, not in the gap`);
  }
});

check("standard deviation breaks sit around the mean", () => {
  const values = Array.from({ length: 100 }, (_, i) => i);
  const breaks = stdDevBreaks(values, 5);
  const mean = 49.5;
  if (!breaks.some((b) => Math.abs(b - mean) < 1)) throw new Error("no cut near the mean");
});

check("a symbology carries breaks, colours, counts and range together", () => {
  const sym = buildSymbology(SKEWED, { method: "quantile", classes: 5, ramp: "risk" });
  eq(sym.ok, true, "ok");
  eq(sym.rows.length, 5, "classes");
  eq(sym.palette.length, 5, "colours");
  // The fixture tops out at 99 (90 + 9), not 100 — the symbology reports the
  // data's own range, which is the point of reading it off the values.
  eq(sym.min, 0, "min"); eq(sym.max, 99, "max");
  eq(sym.rows.reduce((n, r) => n + r.count, 0), SKEWED.length, "every value counted once");
});

check("quantile classes hold roughly equal counts", () => {
  const sym = buildSymbology(SKEWED, { method: "quantile", classes: 5 });
  sym.rows.forEach((row) => {
    if (Math.abs(row.count - 20) > 6) throw new Error(`a quantile class holds ${row.count}`);
  });
});

check("equal-interval classes do not, and that is honest", () => {
  const sym = buildSymbology(SKEWED, { method: "equal", classes: 5 });
  if (sym.rows[0].count < 60) throw new Error("the crowded class was not crowded");
});

check("duplicate cuts collapse rather than making empty classes", () => {
  // Three distinct values cannot support five classes.
  const sym = buildSymbology([1, 1, 1, 2, 2, 3], { method: "quantile", classes: 5 });
  eq(sym.rows.length < 5, true, "fewer classes than asked for");
  sym.rows.forEach((r) => { if (r.count === 0) throw new Error("an empty class survived"); });
});

check("a continuous symbology is a ramp with no cuts", () => {
  const sym = buildSymbology(SKEWED, { continuous: true, ramp: "viridis" });
  eq(sym.continuous, true, "continuous");
  eq(sym.breaks.length, 0, "no breaks");
  eq(sym.palette.length, 24, "a smooth ramp");
});

check("an empty layer is refused with a reason", () => {
  eq(buildSymbology([]).ok, false, "ok");
});

check("a value lands in the class its breaks put it in", () => {
  const breaks = [10, 20, 30];
  eq(classOf(5, breaks), 0, "below the first cut");
  eq(classOf(10, breaks), 1, "on a cut goes up");
  eq(classOf(25, breaks), 2, "middle");
  eq(classOf(100, breaks), 3, "above the last cut");
  eq(classOf(NaN, breaks), -1, "not a number");
});

check("colourOf agrees with the legend rows", () => {
  const sym = buildSymbology(SKEWED, { method: "quantile", classes: 5, ramp: "risk" });
  eq(colourOf(sym.min, sym), sym.rows[0].colour, "lowest");
  eq(colourOf(sym.max, sym), sym.rows[sym.rows.length - 1].colour, "highest");
  eq(colourOf(NaN, sym), null, "no data has no colour");
});

check("the legend record carries the method and the real range", () => {
  const sym = buildSymbology(SKEWED, { method: "jenks", classes: 4, ramp: "risk" });
  const legend = legendInfoFrom(sym, { unit: "mm" });
  eq(legend.min, 0, "min"); eq(legend.max, 99, "max");
  eq(legend.unit, "mm", "unit");
  eq(legend.method, "jenks", "method");
  eq(legend.palette.length, sym.rows.length, "one colour per class");
  if (legend.palette[0].startsWith("#")) throw new Error("the dock wants bare hex");
});

check("jenks on a large layer samples rather than hanging", () => {
  const big = Array.from({ length: 200000 }, (_, i) => (i % 1000) + (i > 150000 ? 500 : 0));
  const started = Date.now();
  const breaks = jenksBreaks(big, 5);
  eq(breaks.length, 4, "cuts");
  if (Date.now() - started > 4000) throw new Error("jenks took over four seconds");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
