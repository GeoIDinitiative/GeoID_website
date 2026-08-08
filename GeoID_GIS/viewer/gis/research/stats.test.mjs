/**
 * Checks for stats.js against answers computed elsewhere.
 *
 *   node GeoID_GIS/viewer/gis/research/stats.test.mjs
 *
 * The reference values come from SciPy on the same inputs, which is what the
 * desktop app uses — so this is checking the browser agrees with the app, not
 * merely that it is self-consistent. A p-value that is quietly wrong is worse
 * than a missing one, which is the whole reason these have tests at all.
 */

import {
  mean, variance, stdev, pearson, spearman, kendall, ranks,
  normalCdf, tDistPValue, tTest, mannWhitney, ksTest, anova,
  pca, kmeans, histogram, correlationMatrix,
} from "./stats.js";

let failures = 0;
function check(name, got, want, tol = 1e-6) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — got ${Number(got).toPrecision(8)}, want ${want}`);
}
function assert(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// ── Descriptives ─────────────────────────────────────────────────────────────
const xs = [2, 4, 4, 4, 5, 5, 7, 9];
check("mean", mean(xs), 5);
check("sample variance", variance(xs), 4.571428571428571, 1e-9);
check("population stdev", stdev(xs, { sample: false }), 2, 1e-9);

// ── Correlation ──────────────────────────────────────────────────────────────
const a = [1, 2, 3, 4, 5];
const b = [2, 4, 5, 4, 5];
check("pearson r", pearson(a, b), 0.7745966692414834, 1e-9);
check("perfect positive r", pearson(a, a), 1, 1e-12);
check("perfect negative r", pearson(a, a.slice().reverse()), -1, 1e-12);
// Monotone but non-linear: Spearman sees the order, Pearson does not.
const cubic = a.map((x) => x ** 3);
check("spearman on a monotone curve is 1", spearman(a, cubic), 1, 1e-12);
assert("pearson on the same curve is below 1", pearson(a, cubic) < 0.99,
  `r = ${pearson(a, cubic).toFixed(4)}`);
check("kendall tau on identical ranks", kendall(a, a), 1, 1e-12);

// Ties must be averaged, or every rank statistic downstream is wrong.
const tied = ranks([10, 20, 20, 30]);
assert("ties share the mean rank", tied[1] === 2.5 && tied[2] === 2.5, `[${tied}]`);

// ── Distributions ────────────────────────────────────────────────────────────
check("normal CDF at 0", normalCdf(0), 0.5, 1e-9);
check("normal CDF at 1.96", normalCdf(1.96), 0.9750021048517795, 1e-6);
check("normal CDF at -1", normalCdf(-1), 0.15865525393145707, 1e-6);

// Student's t: the two-tailed p at t=2.228, df=10 is the classic 0.05.
check("t p-value (t=2.228, df=10)", tDistPValue(2.228, 10), 0.05, 5e-4);
check("t p-value at t=0 is 1", tDistPValue(0, 10), 1, 1e-9);
// The branch that was broken: large t, small p, where the continued fraction
// needs the symmetry swap.
check("t p-value (t=8, df=10)", tDistPValue(8, 10), 1.1774943e-5, 1e-9);

// ── Hypothesis tests ─────────────────────────────────────────────────────────
// scipy.stats.ttest_ind(g1, g2, equal_var=False) -> t=-3.3505953820301406,
// p=0.004242273126228007. Values taken from an actual SciPy run, not from
// memory: the first draft of this file guessed them and the guesses were what
// failed, while the implementation was already exact.
const g1 = [12.9, 13.5, 12.8, 15.6, 17.2, 19.2, 12.6, 15.3, 14.4, 11.3];
const g2 = [16.2, 16.6, 17.1, 18.2, 19.5, 20.1, 15.4, 18.6, 17.2, 16.1];
const t = tTest(g1, g2);
check("Welch t statistic", t.t, -3.3505953820301406, 1e-9);
check("Welch t p-value", t.p, 0.004242273126228007, 1e-6);

// Identical samples: no difference to find.
const same = tTest(g1, g1.slice());
check("t on identical samples", same.p, 1, 1e-9);

// scipy.stats.mannwhitneyu(g1, g2, alternative="two-sided") -> U=14.5,
// p=0.00812702465291022. U matches exactly. The p differs in the third decimal
// because SciPy uses the exact distribution at this sample size while this uses
// the normal approximation with a tie correction — fine for a screening test,
// and stated rather than hidden.
const mw = mannWhitney(g1, g2);
check("Mann-Whitney U", mw.u, 14.5, 1e-9);
check("Mann-Whitney p (normal approximation)", mw.p, 0.00812702465291022, 2e-3);

// KS on two clearly separated samples.
const ks = ksTest([1, 2, 3, 4, 5], [11, 12, 13, 14, 15]);
check("KS D for disjoint samples", ks.d, 1, 1e-9);
assert("KS p for disjoint samples is small", ks.p < 0.01, `p = ${ks.p.toFixed(5)}`);
const ksSame = ksTest([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
check("KS D for identical samples", ksSame.d, 0, 1e-9);

// scipy.stats.f_oneway(A, B, C) -> F=9.264705882352942,
// p=0.0023987773293929083.
const A = [6, 8, 4, 5, 3, 4];
const B = [8, 12, 9, 11, 6, 8];
const C = [13, 9, 11, 8, 7, 12];
const av = anova([A, B, C]);
check("ANOVA F", av.f, 9.264705882352942, 1e-9);
check("ANOVA p", av.p, 0.0023987773293929083, 1e-6);
// Three copies of one group: nothing between them.
const flat = anova([A, A.slice(), A.slice()]);
check("ANOVA F on identical groups", flat.f, 0, 1e-9);

// ── Multivariate ─────────────────────────────────────────────────────────────
// Two columns that are the same line: one component takes all the variance.
const line = { x: [1, 2, 3, 4, 5, 6], y: [2, 4, 6, 8, 10, 12] };
const p = pca(line, { components: 2 });
check("PCA first component explains everything", p.components[0].explained, 1, 1e-3);
assert("PCA loads both columns equally",
  Math.abs(Math.abs(p.components[0].loadings.x) - Math.abs(p.components[0].loadings.y)) < 1e-3,
  JSON.stringify(p.components[0].loadings));

// Two well-separated clouds must come out as two clusters.
const clustered = {
  x: [0, 0.1, -0.1, 0.2, 10, 10.1, 9.9, 10.2],
  y: [0, -0.1, 0.1, 0, 10, 9.9, 10.1, 10],
};
const km = kmeans(clustered, { k: 2 });
const left = new Set(km.labels.slice(0, 4));
const right = new Set(km.labels.slice(4));
assert("k-means separates two clouds",
  left.size === 1 && right.size === 1 && [...left][0] !== [...right][0],
  `labels ${km.labels}`);
assert("k-means is deterministic",
  JSON.stringify(kmeans(clustered, { k: 2 }).labels) === JSON.stringify(km.labels));

// ── Histogram ────────────────────────────────────────────────────────────────
const h = histogram([1, 1, 2, 2, 2, 3], 3);
check("histogram counts sum to n", h.counts.reduce((s, c) => s + c, 0), 6, 1e-9);
assert("histogram has one more edge than bin", h.edges.length === h.counts.length + 1);

// ── Correlation matrix ───────────────────────────────────────────────────────
const cm = correlationMatrix({ a, b });
check("correlation matrix diagonal is 1", cm.matrix[0][0], 1, 1e-12);
check("correlation matrix is symmetric", cm.matrix[0][1] - cm.matrix[1][0], 0, 1e-12);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
