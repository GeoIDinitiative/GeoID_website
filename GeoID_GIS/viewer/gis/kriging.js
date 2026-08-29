/**
 * Ordinary kriging — the last tool that said "sidecar".
 *
 * IDW asserts that nearness is everything; kriging asks the data how far its
 * influence actually reaches, by fitting a variogram, and then weights the
 * samples so the prediction is unbiased with minimum variance. It also returns
 * the variance, which is the thing IDW cannot give and the reason people ask
 * for kriging at all: a map of how much to trust the map.
 *
 * Ordinary (not simple) kriging, because the mean is rarely known; a spherical
 * variogram, because it is the standard default and its parameters — nugget,
 * sill, range — are the ones a user recognises. The system is n×n over the
 * SAMPLES, not the cells, so a few hundred observations solve in milliseconds
 * and the cost is in the prediction loop.
 */

/* ── the variogram ──────────────────────────────────────────────────────── */

const EARTH_KM_LAT = 110.574;

function distanceKm(a, b) {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dy = (a.lat - b.lat) * EARTH_KM_LAT;
  const dx = (a.lon - b.lon) * 111.32 * Math.cos(midLat);
  return Math.hypot(dx, dy);
}

/** Empirical semivariance in distance bins — what the fit is fitted to. */
export function empiricalVariogram(points, { bins = 12, maxLagKm = null } = {}) {
  const pairs = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      pairs.push({ h: distanceKm(points[i], points[j]),
        g: 0.5 * (points[i].value - points[j].value) ** 2 });
    }
  }
  if (!pairs.length) return [];
  const limit = maxLagKm || Math.max(...pairs.map((p) => p.h)) / 2;
  const width = limit / bins;
  const out = [];
  for (let b = 0; b < bins; b += 1) {
    const from = b * width;
    const to = from + width;
    const inBin = pairs.filter((p) => p.h >= from && p.h < to);
    if (!inBin.length) continue;
    out.push({
      lagKm: Number(((from + to) / 2).toFixed(4)),
      semivariance: Number((inBin.reduce((s, p) => s + p.g, 0) / inBin.length).toFixed(6)),
      pairs: inBin.length,
    });
  }
  return out;
}

/** Spherical model: nugget at zero, rising to the sill at the range. */
export function sphericalModel({ nugget, sill, rangeKm }) {
  return (h) => {
    if (h <= 0) return 0;
    if (h >= rangeKm) return sill;
    const r = h / rangeKm;
    return nugget + (sill - nugget) * (1.5 * r - 0.5 * r ** 3);
  };
}

/**
 * Exponential model: approaches the sill asymptotically, so the "range" is the
 * PRACTICAL range -- the lag at which 95% of the sill is reached, which is the
 * convention every geostatistics text uses and the one that makes a fitted
 * exponential range comparable with a spherical one.
 *
 * The tool offered this family from the day it shipped and could not deliver
 * it: `krigeGrid` called `sphericalModel` unconditionally, so choosing
 * Exponential fitted and applied a spherical variogram and then REPORTED
 * "spherical variogram" in the message. A control that quietly does something
 * else is worse than one that does nothing.
 */
export function exponentialModel({ nugget, sill, rangeKm }) {
  return (h) => {
    if (h <= 0) return 0;
    return nugget + (sill - nugget) * (1 - Math.exp((-3 * h) / rangeKm));
  };
}

/** The two families, by the id the tool's own select carries. */
export const VARIOGRAM_MODELS = { spherical: sphericalModel, exponential: exponentialModel };

/**
 * Fit a variogram by grid search over range, with nugget and sill
 * read from the empirical curve. The FAMILY is fitted too, not only applied:
 * a range fitted under a spherical curve and then used exponentially is a
 * different model from the one the search chose.
 *
 * A grid search rather than Levenberg–Marquardt because there are three
 * parameters, two of them read directly off the data, and a search that cannot
 * diverge is worth more here than one that converges faster — a variogram fit
 * that wanders produces a smooth, confident, wrong surface.
 */
export function fitVariogram(points, options = {}) {
  const family = VARIOGRAM_MODELS[options.model] ? options.model : "spherical";
  const makeModel = VARIOGRAM_MODELS[family];
  const empirical = empiricalVariogram(points, options);
  if (empirical.length < 3) {
    return { ok: false, message: "too few point pairs to fit a variogram" };
  }
  const sill = Math.max(...empirical.map((e) => e.semivariance));
  const nugget = Math.max(0, Math.min(empirical[0].semivariance, sill * 0.9));
  const maxLag = empirical[empirical.length - 1].lagKm;
  let best = null;
  for (let s = 1; s <= 40; s += 1) {
    const rangeKm = (s / 40) * maxLag * 1.5;
    const model = makeModel({ nugget, sill, rangeKm });
    const sse = empirical.reduce((acc, e) =>
      acc + e.pairs * (model(e.lagKm) - e.semivariance) ** 2, 0);
    if (!best || sse < best.sse) best = { rangeKm, sse };
  }
  return {
    ok: true,
    model: family,
    nugget: Number(nugget.toFixed(6)),
    sill: Number(sill.toFixed(6)),
    rangeKm: Number(best.rangeKm.toFixed(4)),
    empirical,
  };
}

/* ── the solve ──────────────────────────────────────────────────────────── */

/**
 * LU with partial pivoting, computed ONCE.
 *
 * The kriging matrix depends only on the sample points and the variogram --
 * never on the cell being estimated -- and it was being rebuilt and fully
 * eliminated for EVERY CELL. At the tool's own default of 256 cells across
 * that is 65,536 eliminations of a matrix as wide as the sample count, which
 * is not slow so much as unfinishable: the browser sat there. Factorising
 * once and substituting per cell is the same arithmetic and the same answer
 * at a fraction of the cost -- O(n^3) once plus O(n^2) a cell, rather than
 * O(n^3) a cell.
 */
function factorise(A) {
  const n = A.length;
  const M = A.map((row) => Float64Array.from(row));
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i += 1) piv[i] = i;
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    if (p !== c) {
      const row = M[c]; M[c] = M[p]; M[p] = row;
      const q = piv[c]; piv[c] = piv[p]; piv[p] = q;
    }
    const pivot = M[c][c];
    for (let r = c + 1; r < n; r += 1) {
      const f = M[r][c] / pivot;
      M[r][c] = f;
      for (let k = c + 1; k < n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return { M, piv, n };
}

/** Forward then back substitution against an existing factorisation. */
function luSolve({ M, piv, n }, b) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = b[piv[i]];
    for (let k = 0; k < i; k += 1) sum -= M[i][k] * y[k];
    y[i] = sum;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = y[i];
    for (let k = i + 1; k < n; k += 1) sum -= M[i][k] * x[k];
    x[i] = sum / M[i][i];
  }
  return x;
}

/**
 * Build the ordinary-kriging system for a fixed set of samples and return a
 * function that estimates any location against it.
 *
 * The extra row and column are the unbiasedness constraint -- the weights must
 * sum to one -- and the Lagrange multiplier that enforces it. Dropping them
 * gives simple kriging against an assumed mean of zero, which on elevation or
 * rainfall is wrong by the mean.
 */
export function krigeSolver(points, model) {
  const n = points.length;
  const A = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) A[i][j] = model(distanceKm(points[i], points[j]));
    A[i][n] = 1;
    A[n][i] = 1;
  }
  A[n][n] = 0;
  const factored = factorise(A);
  const b = new Float64Array(n + 1);
  return (lat, lon) => {
    if (!factored) return { value: null, variance: null };
    for (let i = 0; i < n; i += 1) b[i] = model(distanceKm(points[i], { lat, lon }));
    b[n] = 1;
    const weights = luSolve(factored, b);
    let value = 0;
    for (let i = 0; i < n; i += 1) value += weights[i] * points[i].value;
    let variance = weights[n];                       // the Lagrange multiplier
    for (let i = 0; i < n; i += 1) variance += weights[i] * b[i];
    return { value, variance };
  };
}

/**
 * Ordinary kriging at one location. Returns the estimate and its variance.
 *
 * The extra row and column are the unbiasedness constraint — the weights must
 * sum to one — and the Lagrange multiplier that enforces it. Dropping them
 * gives simple kriging against an assumed mean of zero, which on elevation or
 * rainfall is wrong by the mean.
 */
export function krigeAt(points, model, lat, lon) {
  return krigeSolver(points, model)(lat, lon);
}

/**
 * A kriged surface over a grid, plus the variance surface beside it.
 *
 * Points are capped because the solve is O(n³) per prediction if rebuilt each
 * time; the matrix is built ONCE and reused, so the cap is about the solve
 * rather than the loop — 200 samples is a 201×201 system, which is instant,
 * and beyond about 400 the wait stops being worth it in a browser tab.
 */
export function krigeGrid(points, bounds, {
  cellSizeDeg = 0.01, maxPoints = 200, variogram = null, model: family = "spherical",
} = {}) {
  const clean = (points || []).filter((p) =>
    Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Number.isFinite(p?.value));
  if (clean.length < 4) return { ok: false, message: "kriging needs at least four samples" };
  // Thinned evenly rather than truncated: taking the first 200 of a list
  // sorted by import order can sample one corner of the study area.
  const used = clean.length <= maxPoints ? clean
    : Array.from({ length: maxPoints }, (_, i) =>
      clean[Math.round((i / (maxPoints - 1)) * (clean.length - 1))]);

  /**
   * A field with NO variance is degenerate, not an error: every semivariance
   * is zero, so the kriging system is singular, every weight comes back null
   * and the grid is entirely NaN -- returned, until this guard, as ok:true
   * with an EMPTY raster. That is the watershed fault wearing a different
   * hat. The kriging estimate of a constant field is that constant, so it is
   * answered directly rather than solved for.
   */
  const first = used[0].value;
  if (used.every((q) => q.value === first)) {
    const w = Math.max(1, Math.round((bounds.maxX - bounds.minX) / cellSizeDeg));
    const h = Math.max(1, Math.round((bounds.maxY - bounds.minY) / cellSizeDeg));
    return {
      ok: true, width: w, height: h, bounds,
      values: new Float32Array(w * h).fill(first),
      variance: new Float32Array(w * h).fill(0),
      variogram: null, samples: used.length,
      message: `${used.length} samples all read ${first} — a field with no variance `
        + "is returned as itself; there is nothing for a variogram to fit.",
    };
  }
  const fit = variogram || fitVariogram(used, { model: family });
  if (!fit.ok) return { ok: false, message: fit.message };
  const model = (VARIOGRAM_MODELS[fit.model] || sphericalModel)(fit);

  const width = Math.max(1, Math.round((bounds.maxX - bounds.minX) / cellSizeDeg));
  const height = Math.max(1, Math.round((bounds.maxY - bounds.minY) / cellSizeDeg));
  if (width * height > 250000) {
    return { ok: false, message: `that cell size needs ${width * height} cells — use a coarser one` };
  }
  const values = new Float32Array(width * height).fill(NaN);
  const variance = new Float32Array(width * height).fill(NaN);
  const estimate = krigeSolver(used, model);
  for (let y = 0; y < height; y += 1) {
    const lat = bounds.maxY - ((y + 0.5) / height) * (bounds.maxY - bounds.minY);
    for (let x = 0; x < width; x += 1) {
      const lon = bounds.minX + ((x + 0.5) / width) * (bounds.maxX - bounds.minX);
      const out = estimate(lat, lon);
      if (out.value != null) {
        values[y * width + x] = out.value;
        variance[y * width + x] = out.variance;
      }
    }
  }
  // Nothing estimated is a REFUSAL. An all-NaN grid handed back as success is
  // how an empty map reaches somebody's screen looking like an answer.
  if (!values.some((v) => Number.isFinite(v))) {
    return { ok: false, message: "the kriging system was singular at every cell — "
      + "the samples may be collinear or duplicated" };
  }
  return {
    ok: true, width, height, bounds, values, variance,
    variogram: fit, samples: used.length,
    message: `${used.length} samples, ${fit.model || "spherical"} variogram: nugget ${fit.nugget}, `
      + `sill ${fit.sill}, range ${fit.rangeKm} km.`,
  };
}

if (typeof window !== "undefined") {
  window.GeoIDKriging = { empiricalVariogram, sphericalModel, exponentialModel, krigeSolver,
    VARIOGRAM_MODELS, fitVariogram, krigeAt, krigeGrid };
}
