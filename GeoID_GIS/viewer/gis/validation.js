/**
 * Is the model any good?
 *
 * Every other tool here makes a map. These say whether the map is worth
 * believing, and until now the answer lived in a one-off script: the NI
 * prototype's AUC of 0.841 was computed outside the GUI, so a user could
 * produce a susceptibility surface and had no way at all to falsify it. A
 * hazard GIS without validation produces confident pictures.
 *
 * Four things, all standard and all pure:
 *
 * - **ROC / AUC** over labelled points — the model's ability to separate the
 *   places where something happened from the places where it did not.
 * - **Success-rate curve** over the raster itself — order every cell by score,
 *   and ask what fraction of the events fall in the top x% of the area. This is
 *   the one the landslide literature actually reports, and it needs no negative
 *   observations, which matters because an inventory records failures and never
 *   records the places that held.
 * - **Confusion matrix** at a threshold, with Cohen's kappa — accuracy alone is
 *   a liar when 97% of the map is "no", and kappa is what says so.
 * - **Sampling** — uniform and stratified — because a validation set has to
 *   come from somewhere, and drawing it by hand is how bias gets in.
 *
 * The arithmetic is deliberately explicit rather than clever: these numbers end
 * up in reports, and a trapezoid written out can be checked by eye against a
 * plot in a way an accumulating one-liner cannot.
 */

/* ── ROC and AUC ────────────────────────────────────────────────────────── */

/**
 * `pairs` is `[{ score, positive }]`. Returns the curve and its area.
 *
 * Ties are handled by grouping: every point with the same score moves the
 * curve once, diagonally. Stepping through tied scores one at a time inflates
 * the area — a model that outputs five classes would otherwise score as though
 * it had ranked within them.
 */
export function rocCurve(pairs) {
  const rows = (pairs || [])
    .filter((p) => Number.isFinite(p?.score))
    .map((p) => ({ score: p.score, positive: Boolean(p.positive) }))
    .sort((a, b) => b.score - a.score);
  const positives = rows.filter((r) => r.positive).length;
  const negatives = rows.length - positives;
  if (!positives || !negatives) {
    return {
      ok: false,
      message: positives
        ? "every observation is a positive — ROC needs both outcomes"
        : "no positive observations",
      points: [], auc: null, positives, negatives,
    };
  }

  const points = [{ fpr: 0, tpr: 0, score: Infinity }];
  let tp = 0;
  let fp = 0;
  let auc = 0;
  let prevFpr = 0;
  let prevTpr = 0;
  for (let i = 0; i < rows.length;) {
    const score = rows[i].score;
    while (i < rows.length && rows[i].score === score) {
      if (rows[i].positive) tp += 1; else fp += 1;
      i += 1;
    }
    const tpr = tp / positives;
    const fpr = fp / negatives;
    auc += ((fpr - prevFpr) * (tpr + prevTpr)) / 2;   // trapezoid
    points.push({ fpr: Number(fpr.toFixed(6)), tpr: Number(tpr.toFixed(6)), score });
    prevFpr = fpr;
    prevTpr = tpr;
  }
  return { ok: true, points, auc: Number(auc.toFixed(4)), positives, negatives };
}

/**
 * Success-rate curve: cells ranked by score, against the events that fall in
 * them. `cellScores` is every score in the raster; `eventScores` the scores at
 * the observed events.
 *
 * The x axis is the fraction of the AREA taken, the y axis the fraction of the
 * EVENTS captured, and the area under it says how much better than chance the
 * ranking is. A map where the top 20% of the area holds 70% of the slides is
 * useful; one where it holds 20% is a coin.
 */
export function successRate(cellScores, eventScores, steps = 100) {
  const cells = (cellScores || []).filter(Number.isFinite).slice().sort((a, b) => b - a);
  const events = (eventScores || []).filter(Number.isFinite);
  if (!cells.length) return { ok: false, message: "the raster has no values", points: [], auc: null };
  if (!events.length) return { ok: false, message: "no events fell on the raster", points: [], auc: null };

  const points = [{ areaFraction: 0, eventFraction: 0, threshold: cells[0] }];
  let auc = 0;
  let prevArea = 0;
  let prevEvents = 0;
  for (let s = 1; s <= steps; s += 1) {
    const areaFraction = s / steps;
    // The threshold that keeps exactly this fraction of the area: the score of
    // the cell at that rank. Taking a fixed score step instead would make the
    // x axis a function of the histogram's shape rather than of area.
    const index = Math.min(cells.length - 1, Math.ceil(areaFraction * cells.length) - 1);
    const threshold = cells[index];
    const captured = events.filter((v) => v >= threshold).length / events.length;
    auc += ((areaFraction - prevArea) * (captured + prevEvents)) / 2;
    points.push({
      areaFraction: Number(areaFraction.toFixed(4)),
      eventFraction: Number(captured.toFixed(4)),
      threshold,
    });
    prevArea = areaFraction;
    prevEvents = captured;
  }
  return { ok: true, points, auc: Number(auc.toFixed(4)), cells: cells.length, events: events.length };
}

/* ── confusion matrix ───────────────────────────────────────────────────── */

/** Counts, rates, and Cohen's kappa at one threshold. */
export function confusionMatrix(pairs, threshold) {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  (pairs || []).forEach((p) => {
    if (!Number.isFinite(p?.score)) return;
    const predicted = p.score >= threshold;
    if (p.positive && predicted) tp += 1;
    else if (p.positive && !predicted) fn += 1;
    else if (!p.positive && predicted) fp += 1;
    else tn += 1;
  });
  const n = tp + fp + tn + fn;
  if (!n) return { ok: false, message: "no comparable observations" };
  const accuracy = (tp + tn) / n;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall
    ? (2 * precision * recall) / (precision + recall) : null;
  // Kappa: how much of the agreement is more than chance would give. With a
  // rare positive class, accuracy runs to 0.97 for a model that says "no" to
  // everything, and only this number reports that.
  const expected = (((tp + fn) * (tp + fp)) + ((tn + fp) * (tn + fn))) / (n * n);
  const kappa = expected === 1 ? null : (accuracy - expected) / (1 - expected);
  const round = (v) => (v == null ? null : Number(v.toFixed(4)));
  return {
    ok: true, threshold, n, tp, fp, tn, fn,
    accuracy: round(accuracy), precision: round(precision), recall: round(recall),
    f1: round(f1), kappa: round(kappa),
    specificity: round(tn + fp ? tn / (tn + fp) : null),
  };
}

/** The threshold with the best Youden's J — the corner of the ROC. */
export function bestThreshold(pairs) {
  const roc = rocCurve(pairs);
  if (!roc.ok) return roc;
  let best = null;
  roc.points.forEach((p) => {
    if (!Number.isFinite(p.score)) return;
    const j = p.tpr - p.fpr;
    if (!best || j > best.j) best = { j: Number(j.toFixed(4)), threshold: p.score, tpr: p.tpr, fpr: p.fpr };
  });
  return { ok: true, ...best, auc: roc.auc };
}

/* ── sampling ───────────────────────────────────────────────────────────── */

/**
 * A small deterministic generator, so a validation set can be REPRODUCED.
 * `Math.random()` would make every run a different sample and every reported
 * AUC unrepeatable — which is precisely the property a validation set must not
 * have. Mulberry32: short, well-distributed, and seeded by an integer anyone
 * can write in a report.
 */
export function makeRandom(seed = 1) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Uniform points in a bounds box, on the SPHERE rather than in the rectangle:
 * sampling latitude uniformly crowds the poles, and over a country-sized box
 * that is a few per cent of bias in every statistic drawn from it.
 */
export function randomPoints(bounds, count, { seed = 1, sampler = null } = {}) {
  const random = makeRandom(seed);
  const { minX, minY, maxX, maxY } = bounds || {};
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [];
  const sinMin = Math.sin((minY * Math.PI) / 180);
  const sinMax = Math.sin((maxY * Math.PI) / 180);
  const out = [];
  let guard = 0;
  while (out.length < count && guard < count * 200) {
    guard += 1;
    const lon = minX + random() * (maxX - minX);
    const lat = (Math.asin(sinMin + random() * (sinMax - sinMin)) * 180) / Math.PI;
    if (sampler) {
      const value = sampler(lat, lon);
      if (!Number.isFinite(value)) continue;      // outside the data, not a sample
      out.push({ lat, lon, value });
    } else {
      out.push({ lat, lon });
    }
  }
  return out;
}

/**
 * Equal numbers from each class of a classified raster.
 *
 * Uniform sampling of a susceptibility map gives almost nothing from the
 * highest class, because the highest class is the smallest — and that is the
 * class the whole model exists to get right.
 */
export function stratifiedPoints(bounds, sampler, { perClass = 20, seed = 1, classes = null } = {}) {
  const random = makeRandom(seed);
  const { minX, minY, maxX, maxY } = bounds || {};
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || typeof sampler !== "function") return [];
  const sinMin = Math.sin((minY * Math.PI) / 180);
  const sinMax = Math.sin((maxY * Math.PI) / 180);
  const buckets = new Map();
  const wanted = classes ? new Set(classes.map((c) => String(c))) : null;
  const target = wanted ? wanted.size * perClass : Infinity;
  let guard = 0;
  const limit = Math.max(20000, perClass * 4000);
  while (guard < limit) {
    guard += 1;
    const lon = minX + random() * (maxX - minX);
    const lat = (Math.asin(sinMin + random() * (sinMax - sinMin)) * 180) / Math.PI;
    const value = sampler(lat, lon);
    if (!Number.isFinite(value)) continue;
    const key = String(Math.round(value));
    if (wanted && !wanted.has(key)) continue;
    const bucket = buckets.get(key) || [];
    if (bucket.length >= perClass) {
      // Every wanted class full — stop rather than spinning to the guard.
      if (wanted && [...buckets.values()].every((b) => b.length >= perClass)
        && buckets.size === wanted.size) break;
      continue;
    }
    bucket.push({ lat, lon, class: key, value });
    buckets.set(key, bucket);
    if (!wanted && buckets.size && [...buckets.values()]
      .reduce((n, b) => n + b.length, 0) >= target) break;
  }
  return [...buckets.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .flatMap(([, points]) => points);
}

/* ── glue for the tool layer ────────────────────────────────────────────── */

/** Read a raster's values as a flat array of finite numbers. */
export function rasterValues(raster) {
  const out = [];
  // The grid's cells live on `band` — `values` is what every other library
  // calls it and reading that gives an empty array with no error at all.
  const values = raster?.band || raster?.values;
  if (!values) return out;
  const noData = raster.noData;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (noData != null && Number.isFinite(noData) && v === noData) continue;
    out.push(v);
  }
  return out;
}

/** Pair each feature with the raster value under it and its observed outcome. */
export function pairsFromFeatures(features, sampleAt, { field = null, positiveValue = null } = {}) {
  const pairs = [];
  (features || []).forEach((feature) => {
    const geometry = feature?.geometry;
    if (!geometry) return;
    const point = geometry.type === "Point" ? geometry.coordinates
      : geometry.type === "MultiPoint" ? geometry.coordinates[0] : null;
    if (!point) return;
    const score = sampleAt(point[1], point[0]);
    if (!Number.isFinite(score)) return;
    let positive = true;
    if (field) {
      const raw = feature.properties?.[field];
      positive = positiveValue != null
        ? String(raw) === String(positiveValue)
        : Boolean(raw) && String(raw) !== "0" && String(raw).toLowerCase() !== "false";
    }
    pairs.push({ score, positive });
  });
  return pairs;
}

if (typeof window !== "undefined") {
  window.GeoIDValidation = {
    rocCurve, successRate, confusionMatrix, bestThreshold,
    randomPoints, stratifiedPoints, makeRandom, rasterValues, pairsFromFeatures,
  };
}
