/**
 * The statistics the Qt app's Statistics page offers, in plain JS.
 *
 * Qt hands these to SciPy and scikit-learn. Nothing of that size is going to be
 * vendored into a static page, but every one of these is a short, well-defined
 * algorithm and writing them is cheaper than shipping buttons that cannot run.
 *
 * Each returns plain numbers with the assumptions named, because a p-value with
 * an unstated test is worse than none. Checked in `stats.test.mjs` against
 * hand-worked answers.
 */

export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
}

export function variance(xs, { sample = true } = {}) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  return ss / (xs.length - (sample ? 1 : 0));
}

export const stdev = (xs, opts) => Math.sqrt(variance(xs, opts));

/** Pearson's r. */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Ranks, averaging ties — the basis of both Spearman and Mann-Whitney. */
export function ranks(xs) {
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

export function spearman(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  return pearson(ranks(xs.slice(0, n)), ranks(ys.slice(0, n)));
}

/** Kendall's tau-b. */
export function kendall(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  let concordant = 0; let discordant = 0; let tiesX = 0; let tiesY = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = Math.sign(xs[i] - xs[j]);
      const dy = Math.sign(ys[i] - ys[j]);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) { tiesX += 1; continue; }
      if (dy === 0) { tiesY += 1; continue; }
      if (dx === dy) concordant += 1; else discordant += 1;
    }
  }
  const denom = Math.sqrt((concordant + discordant + tiesX)
    * (concordant + discordant + tiesY));
  return denom ? (concordant - discordant) / denom : NaN;
}

export function correlationMatrix(columns, method = "pearson") {
  const fn = method === "spearman" ? spearman : method === "kendall" ? kendall : pearson;
  const names = Object.keys(columns);
  return {
    names,
    matrix: names.map((a) => names.map((b) => fn(columns[a], columns[b]))),
    method,
  };
}

// ── Distributions ────────────────────────────────────────────────────────────

/** Normal CDF via Abramowitz & Stegun 7.1.26; |error| < 7.5e-8. */
export function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function logGamma(x) {
  // Lanczos, g=7, n=9.
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Regularised incomplete beta I_x(a,b), by Lentz's continued fraction.
 *
 * The fraction only converges quickly on one side, so above the crossover the
 * identity I_x(a,b) = 1 - I_{1-x}(b,a) is used and the recursion lands on the
 * fast side. Getting that swap wrong silently returns a p-value that is right
 * for small x and badly wrong for large.
 */
function betaInc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x >= (a + 1) / (a + b + 2)) return 1 - betaInc(b, a, 1 - x);
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log1p(-x) * b - lbeta) / a;
  let f = 1; let c = 1; let d = 0;
  for (let i = 0; i <= 300; i += 1) {
    const m = Math.floor(i / 2);
    let numerator;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-12) break;
  }
  return front * (f - 1);
}

/** Two-tailed p for Student's t with `df` degrees of freedom. */
export function tDistPValue(t, df) {
  const x = df / (df + t * t);
  const p = betaInc(df / 2, 0.5, x);
  return Math.min(1, Math.max(0, p));
}

/** Welch's two-sample t-test — unequal variances, which is the safe default. */
export function tTest(a, b) {
  const na = a.length; const nb = b.length;
  const va = variance(a); const vb = variance(b);
  const t = (mean(a) - mean(b)) / Math.sqrt(va / na + vb / nb);
  const df = ((va / na + vb / nb) ** 2)
    / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  return { test: "Welch t-test", t, df, p: tDistPValue(t, df), n: [na, nb] };
}

/** Mann-Whitney U, normal approximation with a tie correction. */
export function mannWhitney(a, b) {
  const all = [...a, ...b];
  const r = ranks(all);
  const ra = r.slice(0, a.length).reduce((s, v) => s + v, 0);
  const na = a.length; const nb = b.length;
  const u1 = ra - (na * (na + 1)) / 2;
  const u = Math.min(u1, na * nb - u1);
  const mu = (na * nb) / 2;
  const counts = new Map();
  all.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  const tieTerm = [...counts.values()].reduce((s, t) => s + (t ** 3 - t), 0);
  const n = na + nb;
  const sigma = Math.sqrt((na * nb / 12) * ((n + 1) - tieTerm / (n * (n - 1))));
  const z = sigma ? (u - mu) / sigma : 0;
  return { test: "Mann-Whitney U", u, z, p: 2 * (1 - normalCdf(Math.abs(z))), n: [na, nb] };
}

/** Two-sample Kolmogorov-Smirnov. */
export function ksTest(a, b) {
  const xa = a.slice().sort((x, y) => x - y);
  const xb = b.slice().sort((x, y) => x - y);
  let i = 0; let j = 0; let d = 0;
  while (i < xa.length && j < xb.length) {
    const x = Math.min(xa[i], xb[j]);
    while (i < xa.length && xa[i] <= x) i += 1;
    while (j < xb.length && xb[j] <= x) j += 1;
    d = Math.max(d, Math.abs(i / xa.length - j / xb.length));
  }
  const ne = Math.sqrt((xa.length * xb.length) / (xa.length + xb.length));
  const lambda = (ne + 0.12 + 0.11 / ne) * d;
  let p = 0;
  for (let k = 1; k <= 100; k += 1) {
    p += 2 * ((-1) ** (k - 1)) * Math.exp(-2 * k * k * lambda * lambda);
  }
  return { test: "KS test", d, p: Math.min(1, Math.max(0, p)), n: [xa.length, xb.length] };
}

/** One-way ANOVA across any number of groups. */
export function anova(groups) {
  const all = groups.flat();
  const grand = mean(all);
  const k = groups.length;
  const n = all.length;
  const ssBetween = groups.reduce((s, g) => s + g.length * (mean(g) - grand) ** 2, 0);
  const ssWithin = groups.reduce(
    (s, g) => s + g.reduce((t, x) => t + (x - mean(g)) ** 2, 0), 0);
  const dfB = k - 1; const dfW = n - k;
  const f = (ssBetween / dfB) / (ssWithin / dfW);
  // F(dfB, dfW) tail via the incomplete beta.
  const p = betaInc(dfW / 2, dfB / 2, dfW / (dfW + dfB * f));
  return { test: "One-way ANOVA", f, dfB, dfW, p: Math.min(1, Math.max(0, p)) };
}

// ── Multivariate ─────────────────────────────────────────────────────────────

/**
 * PCA by power iteration on the covariance matrix.
 *
 * Enough for the two or three leading components a research page actually
 * plots; it is not a general eigensolver and does not claim to be.
 */
export function pca(columns, { components = 2, iterations = 300 } = {}) {
  const names = Object.keys(columns);
  const n = Math.min(...names.map((k) => columns[k].length));
  const means = names.map((k) => mean(columns[k].slice(0, n)));
  const sds = names.map((k, i) => stdev(columns[k].slice(0, n)) || 1);
  // Standardised, so a column in metres does not dominate one in millimetres.
  const z = names.map((k, i) =>
    columns[k].slice(0, n).map((v) => (v - means[i]) / sds[i]));
  const p = names.length;
  const cov = Array.from({ length: p }, (_, a) =>
    Array.from({ length: p }, (_, b) => {
      let s = 0;
      for (let i = 0; i < n; i += 1) s += z[a][i] * z[b][i];
      return s / (n - 1);
    }));

  const comps = [];
  const work = cov.map((r) => r.slice());
  for (let c = 0; c < Math.min(components, p); c += 1) {
    let v = new Array(p).fill(0).map((_, i) => (i === c ? 1 : 0.1));
    let lambda = 0;
    for (let it = 0; it < iterations; it += 1) {
      const next = work.map((rowv) => rowv.reduce((s, x, i) => s + x * v[i], 0));
      const norm = Math.hypot(...next) || 1;
      v = next.map((x) => x / norm);
      lambda = norm;
    }
    comps.push({ eigenvalue: lambda, loadings: Object.fromEntries(names.map((k, i) => [k, v[i]])) });
    // Deflate so the next iteration finds the next component.
    for (let a = 0; a < p; a += 1) {
      for (let b = 0; b < p; b += 1) work[a][b] -= lambda * v[a] * v[b];
    }
  }
  const totalVar = cov.reduce((s, rowv, i) => s + rowv[i], 0);
  return {
    names,
    components: comps.map((c) => ({
      ...c, explained: totalVar ? c.eigenvalue / totalVar : 0,
    })),
  };
}

/** k-means, Lloyd's algorithm with deterministic seeding. */
export function kmeans(columns, { k = 3, iterations = 60 } = {}) {
  const names = Object.keys(columns);
  const n = Math.min(...names.map((key) => columns[key].length));
  const points = Array.from({ length: n }, (_, i) => names.map((key) => columns[key][i]));
  // Deterministic seeding: evenly spaced points of the sorted-by-first-column
  // set. Random seeds would make the same data cluster differently each run,
  // which is not what a research page should do.
  const order = points.map((p, i) => [p[0], i]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  let centres = Array.from({ length: k }, (_, c) =>
    points[order[Math.floor((c + 0.5) * n / k)]].slice());
  let labels = new Array(n).fill(0);
  for (let it = 0; it < iterations; it += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      let best = 0; let bestD = Infinity;
      for (let c = 0; c < k; c += 1) {
        let d = 0;
        for (let f = 0; f < names.length; f += 1) d += (points[i][f] - centres[c][f]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (labels[i] !== best) { labels[i] = best; moved = true; }
    }
    centres = centres.map((_, c) => {
      const members = points.filter((_, i) => labels[i] === c);
      if (!members.length) return centres[c];
      return names.map((_, f) => mean(members.map((m) => m[f])));
    });
    if (!moved) break;
  }
  const inertia = points.reduce((s, p, i) =>
    s + names.reduce((t, _, f) => t + (p[f] - centres[labels[i]][f]) ** 2, 0), 0);
  return { k, labels, centres, names, inertia };
}

/** Counts per bin, for a histogram. */
export function histogram(xs, bins = 20) {
  const clean = xs.filter(Number.isFinite);
  if (!clean.length) return { edges: [], counts: [] };
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const width = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  clean.forEach((x) => {
    const at = Math.min(bins - 1, Math.floor((x - lo) / width));
    counts[at] += 1;
  });
  return {
    edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * width),
    counts,
  };
}
