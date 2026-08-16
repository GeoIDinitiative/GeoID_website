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
 * Fit a spherical variogram by grid search over range, with nugget and sill
 * read from the empirical curve.
 *
 * A grid search rather than Levenberg–Marquardt because there are three
 * parameters, two of them read directly off the data, and a search that cannot
 * diverge is worth more here than one that converges faster — a variogram fit
 * that wanders produces a smooth, confident, wrong surface.
 */
export function fitVariogram(points, options = {}) {
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
    const model = sphericalModel({ nugget, sill, rangeKm });
    const sse = empirical.reduce((acc, e) =>
      acc + e.pairs * (model(e.lagKm) - e.semivariance) ** 2, 0);
    if (!best || sse < best.sse) best = { rangeKm, sse };
  }
  return {
    ok: true,
    nugget: Number(nugget.toFixed(6)),
    sill: Number(sill.toFixed(6)),
    rangeKm: Number(best.rangeKm.toFixed(4)),
    empirical,
  };
}

/* ── the solve ──────────────────────────────────────────────────────────── */

function solveSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (Math.abs(M[pivot][c]) < 1e-12) return null;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
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
  const n = points.length;
  const A = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) A[i][j] = model(distanceKm(points[i], points[j]));
    A[i][n] = 1;
    A[n][i] = 1;
  }
  A[n][n] = 0;
  const b = points.map((p) => model(distanceKm(p, { lat, lon })));
  b.push(1);
  const weights = solveSystem(A, b);
  if (!weights) return { value: null, variance: null };
  let value = 0;
  for (let i = 0; i < n; i += 1) value += weights[i] * points[i].value;
  let variance = weights[n];                       // the Lagrange multiplier
  for (let i = 0; i < n; i += 1) variance += weights[i] * b[i];
  return { value, variance: Math.max(0, variance) };
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
  cellSizeDeg = 0.01, maxPoints = 200, variogram = null,
} = {}) {
  const clean = (points || []).filter((p) =>
    Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Number.isFinite(p?.value));
  if (clean.length < 4) return { ok: false, message: "kriging needs at least four samples" };
  // Thinned evenly rather than truncated: taking the first 200 of a list
  // sorted by import order can sample one corner of the study area.
  const used = clean.length <= maxPoints ? clean
    : Array.from({ length: maxPoints }, (_, i) =>
      clean[Math.round((i / (maxPoints - 1)) * (clean.length - 1))]);

  const fit = variogram || fitVariogram(used);
  if (!fit.ok) return { ok: false, message: fit.message };
  const model = sphericalModel(fit);

  const width = Math.max(1, Math.round((bounds.maxX - bounds.minX) / cellSizeDeg));
  const height = Math.max(1, Math.round((bounds.maxY - bounds.minY) / cellSizeDeg));
  if (width * height > 250000) {
    return { ok: false, message: `that cell size needs ${width * height} cells — use a coarser one` };
  }
  const values = new Float32Array(width * height).fill(NaN);
  const variance = new Float32Array(width * height).fill(NaN);
  for (let y = 0; y < height; y += 1) {
    const lat = bounds.maxY - ((y + 0.5) / height) * (bounds.maxY - bounds.minY);
    for (let x = 0; x < width; x += 1) {
      const lon = bounds.minX + ((x + 0.5) / width) * (bounds.maxX - bounds.minX);
      const out = krigeAt(used, model, lat, lon);
      if (out.value != null) {
        values[y * width + x] = out.value;
        variance[y * width + x] = out.variance;
      }
    }
  }
  return {
    ok: true, width, height, bounds, values, variance,
    variogram: fit, samples: used.length,
    message: `${used.length} samples, spherical variogram: nugget ${fit.nugget}, `
      + `sill ${fit.sill}, range ${fit.rangeKm} km.`,
  };
}

if (typeof window !== "undefined") {
  window.GeoIDKriging = { empiricalVariogram, sphericalModel, fitVariogram, krigeAt, krigeGrid };
}
