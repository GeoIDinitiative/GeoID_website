/**
 * The validation metrics, checked by hand and checked against each other.
 *
 * The page validates a map with `viewer/gis/validation.js`; the bakes validate
 * the published maps with `services/hazard_metrics.py`. The Analysis Hub shows
 * the bakes' numbers beside a tool that computes the page's, so the two must be
 * ONE formula. This file holds both to hand-worked confusion matrices and then
 * runs the Python over the same fixtures as the JS, case by case.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rocCurve, confusionMatrix, bestThreshold } from "../viewer/gis/validation.js";

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); } catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}`); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`);
}

const P = (score, positive) => ({ score, positive });

// 10 observations, threshold 0.5. Worked on paper:
//   positives scoring >= 0.5: 0.9 0.8 0.6           tp = 3
//   positives below:          0.3                    fn = 1
//   negatives scoring >= 0.5: 0.7                    fp = 1
//   negatives below:          0.4 0.2 0.2 0.1 0.05   tn = 5
//   accuracy 8/10 = 0.8; precision 3/4 = 0.75; recall 3/4 = 0.75; F1 0.75
//   kappa: expected = (4·4 + 6·6)/100 = 0.52 → (0.8 − 0.52)/0.48 = 0.5833
//   AUC: of the 4×6 = 24 positive/negative pairs, how many the positive
//   outranks — 0.9 beats 6, 0.8 beats 6, 0.6 beats 5, 0.3 beats 4 →
//   21 / 24 = 0.875
const WORKED = [P(0.9, true), P(0.8, true), P(0.7, false), P(0.6, true), P(0.4, false),
  P(0.3, true), P(0.2, false), P(0.2, false), P(0.1, false), P(0.05, false)];

check("the worked confusion matrix: counts", () => {
  const m = confusionMatrix(WORKED, 0.5);
  eq(m.tp, 3, "tp"); eq(m.fp, 1, "fp"); eq(m.tn, 5, "tn"); eq(m.fn, 1, "fn");
});
check("the worked confusion matrix: accuracy, precision, recall, F1, kappa", () => {
  const m = confusionMatrix(WORKED, 0.5);
  eq(m.accuracy, 0.8, "accuracy"); eq(m.precision, 0.75, "precision");
  eq(m.recall, 0.75, "recall"); eq(m.f1, 0.75, "F1"); eq(m.kappa, 0.5833, "kappa");
});
check("the worked AUC is the pair count, 21 of 24", () => {
  eq(rocCurve(WORKED).auc, 0.875, "AUC");
});
check("F1 is the harmonic mean, not the arithmetic one", () => {
  // tp 1, fp 0, fn 3: precision 1, recall 0.25 → F1 = 2·0.25/1.25 = 0.4 (not 0.625)
  const m = confusionMatrix([P(1, true), P(0, true), P(0, true), P(0, true), P(0, false)], 0.5);
  eq(m.precision, 1, "precision"); eq(m.recall, 0.25, "recall"); eq(m.f1, 0.4, "F1");
});
check("precision is undefined, not zero, when nothing is predicted positive", () => {
  const m = confusionMatrix([P(0.1, true), P(0.2, false)], 0.5);
  eq(m.precision, null, "precision"); eq(m.f1, null, "F1"); eq(m.recall, 0, "recall");
});

// The cross-implementation fixtures: the worked case, heavy ties (a classified
// map), a rare positive class, and a reversed ranking.
const rng = (() => { let a = 7; return () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; }; })();
const RARE = Array.from({ length: 400 }, (_, i) => P(Math.round(rng() * 1000) / 1000, i % 37 === 0 || rng() < 0.02));
const CLASSES = Array.from({ length: 300 }, () => { const c = 1 + Math.floor(rng() * 5); return P(c, rng() < c / 7); });
const REVERSED = [P(1, false), P(2, false), P(3, true), P(4, true)].map((p) => ({ ...p, score: -p.score }));
const FIXTURES = [
  { name: "worked", pairs: WORKED, threshold: 0.5 },
  { name: "rare positives", pairs: RARE, threshold: 0.9 },
  { name: "five tied classes", pairs: CLASSES, threshold: 4 },
  { name: "reversed", pairs: REVERSED, threshold: -2.5 },
];

const py = spawnSync("python3", [join(HERE, "hazard_metrics.py")], {
  input: JSON.stringify(FIXTURES.map(({ pairs, threshold }) => ({ pairs, threshold }))),
  encoding: "utf8",
});
let pyOut = null;
check("the Python implementation runs", () => {
  if (py.status !== 0) throw new Error(py.stderr || `exit ${py.status}`);
  pyOut = JSON.parse(py.stdout);
});

FIXTURES.forEach((f, i) => {
  check(`Python and JS agree: ${f.name}`, () => {
    if (!pyOut) throw new Error("no Python answer");
    const js = confusionMatrix(f.pairs, f.threshold);
    const p = pyOut[i];
    eq(p.auc, rocCurve(f.pairs).auc, "AUC");
    for (const k of ["tp", "fp", "tn", "fn", "accuracy", "precision", "recall", "f1", "kappa", "specificity"]) {
      eq(p.confusion[k], js[k], k);
    }
    eq(p.youden, bestThreshold(f.pairs).threshold, "Youden threshold");
  });
});

check("tied classes move the ROC once each (6 points for 5 classes)", () => {
  eq(rocCurve(CLASSES).points.length, 6, "points");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
