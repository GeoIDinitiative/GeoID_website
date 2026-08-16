/**
 * Validation, against answers that are known before the code runs.
 *
 * A perfect ranking has AUC 1. A ranking uncorrelated with the outcome has
 * AUC 0.5. A reversed ranking has 0. Those three are the whole test of an ROC
 * implementation, and every subtler bug — tie handling, trapezoid direction,
 * a positives/negatives swap — shows up as a departure from one of them.
 */

import {
  rocCurve, successRate, confusionMatrix, bestThreshold,
  randomPoints, stratifiedPoints, makeRandom, rasterValues, pairsFromFeatures,
} from "./validation.js";

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

check("a perfect ranking scores 1", () => {
  const pairs = [
    { score: 9, positive: true }, { score: 8, positive: true },
    { score: 2, positive: false }, { score: 1, positive: false },
  ];
  eq(rocCurve(pairs).auc, 1, "auc");
});

check("a reversed ranking scores 0", () => {
  const pairs = [
    { score: 1, positive: true }, { score: 2, positive: true },
    { score: 8, positive: false }, { score: 9, positive: false },
  ];
  eq(rocCurve(pairs).auc, 0, "auc");
});

check("AUC is the probability a positive outranks a negative", () => {
  // Interleaved 2v2 is 0.75, not 0.5: of the four positive-negative pairings,
  // three are ordered correctly. Writing 0.5 here would have been a wrong
  // expectation dressed as a failing implementation.
  eq(rocCurve([
    { score: 4, positive: true }, { score: 3, positive: false },
    { score: 2, positive: true }, { score: 1, positive: false },
  ]).auc, 0.75, "interleaved");
  // Two of four concordant is the coin: positives at the top and the bottom.
  eq(rocCurve([
    { score: 4, positive: true }, { score: 3, positive: false },
    { score: 2, positive: false }, { score: 1, positive: true },
  ]).auc, 0.5, "no information");
});

check("ties move the curve once, diagonally", () => {
  // Two positives and two negatives all on the same score is no information:
  // 0.5, not the 0.75 that stepping through tied rows one at a time gives.
  const pairs = [
    { score: 5, positive: true }, { score: 5, positive: true },
    { score: 5, positive: false }, { score: 5, positive: false },
  ];
  eq(rocCurve(pairs).auc, 0.5, "auc");
  eq(rocCurve(pairs).points.length, 2, "one step plus the origin");
});

check("one-class input is refused rather than scored", () => {
  const out = rocCurve([{ score: 1, positive: true }, { score: 2, positive: true }]);
  eq(out.ok, false, "ok");
  eq(out.auc, null, "auc");
});

check("the success-rate curve reads area against events", () => {
  // 100 cells scored 100..1; the ten events sit on the ten highest. The top
  // 10% of the area then holds 100% of the events.
  const cells = Array.from({ length: 100 }, (_, i) => 100 - i);
  const events = Array.from({ length: 10 }, (_, i) => 100 - i);
  const out = successRate(cells, events, 100);
  eq(out.ok, true, "ok");
  const at10 = out.points.find((p) => p.areaFraction === 0.1);
  eq(at10.eventFraction, 1, "all events in the top tenth");
  if (!(out.auc > 0.94)) throw new Error(`expected a near-perfect area, got ${out.auc}`);
});

check("events spread evenly over the area give a half", () => {
  const cells = Array.from({ length: 100 }, (_, i) => 100 - i);
  const events = Array.from({ length: 10 }, (_, i) => 100 - i * 10);
  const out = successRate(cells, events, 100);
  near(out.auc, 0.5, 0.08, "auc");
});

check("no events on the raster is a refusal, not a zero", () => {
  eq(successRate([1, 2, 3], []).ok, false, "ok");
});

check("the confusion matrix counts the four cells", () => {
  const pairs = [
    { score: 9, positive: true }, { score: 8, positive: false },
    { score: 2, positive: true }, { score: 1, positive: false },
  ];
  const m = confusionMatrix(pairs, 5);
  eq(m.tp, 1, "tp"); eq(m.fp, 1, "fp"); eq(m.fn, 1, "fn"); eq(m.tn, 1, "tn");
  eq(m.accuracy, 0.5, "accuracy");
  eq(m.kappa, 0, "kappa on a coin flip");
});

check("kappa exposes the all-negative model that accuracy praises", () => {
  // 97 negatives, 3 positives, and a model that says no to everything.
  const pairs = [
    ...Array.from({ length: 97 }, () => ({ score: 0, positive: false })),
    ...Array.from({ length: 3 }, () => ({ score: 0, positive: true })),
  ];
  const m = confusionMatrix(pairs, 0.5);
  eq(m.accuracy, 0.97, "accuracy looks excellent");
  eq(m.kappa, 0, "kappa says it knows nothing");
});

check("the best threshold is the corner of the curve", () => {
  const pairs = [
    { score: 9, positive: true }, { score: 8, positive: true },
    { score: 3, positive: false }, { score: 1, positive: false },
  ];
  const best = bestThreshold(pairs);
  eq(best.threshold, 8, "threshold");
  eq(best.tpr, 1, "tpr"); eq(best.fpr, 0, "fpr");
});

check("the generator is deterministic, so a sample can be repeated", () => {
  const a = makeRandom(42);
  const b = makeRandom(42);
  for (let i = 0; i < 5; i += 1) eq(a(), b(), `draw ${i}`);
  if (makeRandom(43)() === makeRandom(42)()) throw new Error("different seeds agree");
});

check("random points land inside the box and repeat with the seed", () => {
  const bounds = { minX: -8, minY: 54, maxX: -5, maxY: 55.5 };
  const first = randomPoints(bounds, 50, { seed: 7 });
  const again = randomPoints(bounds, 50, { seed: 7 });
  eq(first.length, 50, "count");
  eq(first[0].lat, again[0].lat, "reproducible");
  first.forEach((p) => {
    if (p.lon < bounds.minX || p.lon > bounds.maxX) throw new Error("longitude escaped");
    if (p.lat < bounds.minY || p.lat > bounds.maxY) throw new Error("latitude escaped");
  });
});

check("latitude is drawn on the sphere, not down the rectangle", () => {
  // Over 0..80°N, uniform-in-latitude puts half the points above 40°. On the
  // sphere far fewer belong there, because those rows hold less ground.
  const points = randomPoints({ minX: 0, minY: 0, maxX: 1, maxY: 80 }, 2000, { seed: 3 });
  const above = points.filter((p) => p.lat > 40).length / points.length;
  if (above > 0.45) throw new Error(`${(above * 100).toFixed(0)}% above 40° — latitude is uniform`);
});

check("a sampler rejects points outside the data", () => {
  const points = randomPoints({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 30,
    { seed: 5, sampler: (lat, lon) => (lon < 5 ? 1 : NaN) });
  eq(points.length, 30, "count");
  points.forEach((p) => { if (p.lon >= 5) throw new Error("a point outside the data was kept"); });
});

check("stratified sampling fills every class, including the rare one", () => {
  // Class 5 covers a twentieth of the box; uniform sampling would barely see it.
  const sampler = (lat) => (lat > 9.5 ? 5 : lat > 5 ? 3 : 1);
  const points = stratifiedPoints({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, sampler,
    { perClass: 10, seed: 11, classes: [1, 3, 5] });
  [1, 3, 5].forEach((c) => {
    const n = points.filter((p) => p.class === String(c)).length;
    eq(n, 10, `class ${c}`);
  });
});

check("raster values skip nodata and non-numbers", () => {
  const values = rasterValues({ band: [1, NaN, -9999, 3], noData: -9999 });
  eq(values.length, 2, "kept");
  eq(values[1], 3, "second");
});

check("pairs come from point features and a field", () => {
  const features = [
    { geometry: { type: "Point", coordinates: [1, 2] }, properties: { slide: 1 } },
    { geometry: { type: "Point", coordinates: [3, 4] }, properties: { slide: 0 } },
    { geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: {} },
  ];
  const pairs = pairsFromFeatures(features, (lat, lon) => lat + lon, { field: "slide" });
  eq(pairs.length, 2, "lines are not points");
  eq(pairs[0].positive, true, "first outcome");
  eq(pairs[1].positive, false, "second outcome");
  eq(pairs[0].score, 3, "sampled score");
});

check("with no field every feature is an occurrence", () => {
  // An inventory records what happened and nothing else — that is the normal
  // case, and it must not be read as "all negatives".
  const features = [{ geometry: { type: "Point", coordinates: [1, 2] }, properties: {} }];
  eq(pairsFromFeatures(features, () => 5)[0].positive, true, "positive");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
