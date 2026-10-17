/**
 * The verification ledger: what the hazard models said, against what happened.
 *
 * Every time the total-risk card answers for a place, each model's reading
 * becomes a RECORD — which hazard, where, the window it is about, its lead,
 * and its score (the demand over the hazard's own warning level, so 1 means
 * "act"). Once the window has passed, the record is VERIFIED against what was
 * observed:
 *
 *   * the weather hazards (rain, snow, gust, heat, cold, CAPE, fire weather)
 *     against the hourly weather actually recorded there — a NUMBER as well
 *     as a yes/no, so the error has a distribution and not just a sign;
 *   * the event hazards (cyclone, flood, landslide, eruption, ash, wildfire,
 *     aftershock) against NASA EONET's curated events and the USGS catalogue,
 *     within the hazard's own reach and window.
 *
 * From the verified records the ledger LEARNS, which is all "Atlas learns"
 * means here, stated so it can be checked:
 *
 *   * the contingency table (hits, misses, false alarms), POD, FAR, CSI, bias;
 *   * the Brier score of the score's own screening probability, and its
 *     skill against climatology (the ledger's own base rate);
 *   * a calibration — a logistic model of P(event) on the log score and the
 *     lead — fitted by IRLS with a small ridge, and judged by its
 *     CROSS-VALIDATED Brier score, never its fitted one, so the ledger cannot
 *     flatter itself;
 *   * for the weather, the error distribution (bias, MAE, RMSE, quantiles),
 *     the correlation of forecast with observed, and the linear correction
 *     observed ≈ a + b·forecast that would have minimised the squared error.
 *
 * Pure: no DOM, no network, no storage. The page half
 * (`atlas-ledger-page.js`) records, fetches the observations and keeps the
 * ledger.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * What each hazard is verified against. A key not here is not recorded: a
 * yearly chance (the background risk maps) cannot be verified by one window,
 * and waves and surge would need a marine archive this page cannot reach.
 */
export const VERIFY = {
  rain: { kind: "weather", vars: ["precipitation"], reduce: "sum24", level: 50, unit: "mm in 24 h" },
  snow: { kind: "weather", vars: ["snowfall"], reduce: "sum24", level: 10, unit: "cm in 24 h" },
  gust: { kind: "weather", vars: ["wind_gusts_10m"], reduce: "max", level: 24.5, unit: "m/s" },
  heat: { kind: "weather", vars: ["apparent_temperature"], reduce: "max", level: 39, unit: "°C" },
  cold: { kind: "weather", vars: ["apparent_temperature"], reduce: "min", level: -25, below: true, unit: "°C" },
  cape: { kind: "weather", vars: ["cape"], reduce: "max", level: 2500, unit: "J/kg" },
  fire: { kind: "weather", vars: ["relative_humidity_2m", "wind_speed_10m"], reduce: "fire", level: 1, unit: "× Red Flag" },
  cyclone: { kind: "event", categories: ["severeStorms"], reachKm: 300 },
  flood: { kind: "event", categories: ["floods"], reachKm: 50 },
  slope: { kind: "event", categories: ["landslides"], reachKm: 25 },
  eruption: { kind: "event", categories: ["volcanoes"], reachKm: 30 },
  ash: { kind: "event", categories: ["volcanoes"], reachKm: 150 },
  wildfire: { kind: "event", categories: ["wildfires"], reachKm: 25 },
  aftershock: { kind: "event", categories: ["earthquakes"], reachKm: 100, minMag: 5 },
};

export const LEDGER_CAP = 3000;
/** Forecasts of one hazard, one place, one window, issued this close together are one forecast. */
export const DEDUPE_HOURS = 3;

export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088;
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The window a reading is ABOUT. A reading with a time stands for 12 h either
 * side of it — the total-risk card's own hold — and one without stands for
 * the whole horizon it was asked over.
 */
export function windowOf(term, issuedMs, horizonHours = 72) {
  if (Number.isFinite(term?.atMs)) {
    return { fromMs: Math.max(issuedMs, term.atMs - 12 * HOUR), toMs: term.atMs + 12 * HOUR };
  }
  return { fromMs: issuedMs, toMs: issuedMs + horizonHours * HOUR };
}

/** A reading as a ledger record, or null for a hazard the ledger cannot verify. */
export function recordFrom(term, place, { issuedMs = Date.now(), horizonHours = 72 } = {}) {
  const spec = VERIFY[term?.key];
  if (!spec || !place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;
  const score = Number.isFinite(term.raw) ? term.raw : term.h;
  if (!Number.isFinite(score) || score < 0) return null;
  const { fromMs, toMs } = windowOf(term, issuedMs, horizonHours);
  const lat = Math.round(place.lat * 1000) / 1000;
  const lon = Math.round(place.lon * 1000) / 1000;
  const bucket = Math.floor(issuedMs / (DEDUPE_HOURS * HOUR));
  return {
    id: `${term.key}@${lat.toFixed(2)},${lon.toFixed(2)}@${Math.round(fromMs / HOUR)}@${bucket}`,
    key: term.key,
    model: term.model || term.key,
    source: term.source || "",
    lat, lon,
    issuedMs, fromMs, toMs,
    lead: Math.max(0, (fromMs - issuedMs) / HOUR),
    score: Math.round(score * 1e4) / 1e4,
    value: Number.isFinite(term.value) ? term.value : null,
    unit: term.unit || spec.unit || "",
    outcome: null,
  };
}

/**
 * The ledger with new records in. A record with an id already present
 * REPLACES it (the same forecast asked again, a few minutes later, is the
 * same forecast); past the cap the oldest go first.
 */
export function addRecords(ledger, records) {
  const byId = new Map((ledger || []).map((r) => [r.id, r]));
  for (const r of records || []) {
    if (!r) continue;
    const old = byId.get(r.id);
    // An outcome already earned is kept — re-asking cannot un-happen it.
    byId.set(r.id, old?.outcome ? { ...r, outcome: old.outcome, verifiedMs: old.verifiedMs } : r);
  }
  const all = [...byId.values()].sort((a, b) => a.issuedMs - b.issuedMs);
  return all.length > LEDGER_CAP ? all.slice(all.length - LEDGER_CAP) : all;
}

/**
 * The records ready to verify: their window has ended, they have no outcome
 * yet (or only a provisional one the archive can now replace).
 */
export function dueRecords(ledger, nowMs = Date.now(), { archiveLagMs = 6 * DAY } = {}) {
  return (ledger || []).filter((r) => {
    if (r.toMs > nowMs) return false;
    if (!r.outcome) return true;
    return r.outcome.provisional === true && r.toMs + archiveLagMs <= nowMs;
  });
}

/* ── verifying ──────────────────────────────────────────────────────────── */

/**
 * An event that bears on a record: of one of its hazard's categories, inside
 * its reach and its window. Events are normalised:
 *   { id, category, lat, lon, timeMs, mag?, title }
 * Answers the nearest, or null.
 */
export function matchEvent(record, events) {
  const spec = VERIFY[record?.key];
  if (!spec || spec.kind !== "event") return null;
  let best = null;
  for (const e of events || []) {
    if (!spec.categories.includes(e.category)) continue;
    if (!(e.timeMs >= record.fromMs && e.timeMs <= record.toMs)) continue;
    if (spec.minMag != null && !(e.mag >= spec.minMag)) continue;
    const km = distanceKm(record.lat, record.lon, e.lat, e.lon);
    if (km > spec.reachKm) continue;
    if (!best || km < best.km) best = { event: e, km };
  }
  return best;
}

/** The outcome of an event record against what the catalogues hold. */
export function verifyEvent(record, events, { nowMs = Date.now(), source = "" } = {}) {
  const hit = matchEvent(record, events);
  return {
    observed: Boolean(hit),
    how: "event",
    source,
    km: hit ? Math.round(hit.km * 10) / 10 : null,
    event: hit ? { id: hit.event.id, title: hit.event.title || "", timeMs: hit.event.timeMs } : null,
    atMs: nowMs,
  };
}

/** Hourly values inside [from, to] from an Open-Meteo `hourly` block. */
function hoursIn(hourly, name, fromMs, toMs) {
  const times = (hourly?.time || []).map((t) => Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`));
  const vals = hourly?.[name] || [];
  const out = [];
  times.forEach((ms, i) => {
    const v = vals[i];
    if (ms >= fromMs && ms <= toMs && v != null && Number.isFinite(Number(v))) out.push({ ms, v: Number(v) });
  });
  return out;
}

/**
 * The OBSERVED value of a weather hazard over a window, reduced the way its
 * forecast was: the wettest 24 h, the strongest gust, the hottest or coldest
 * hour, the Red Flag multiple. NaN when the record holds nothing.
 */
export function reduceWeather(key, hourly, fromMs, toMs) {
  const spec = VERIFY[key];
  if (!spec || spec.kind !== "weather") return NaN;
  if (spec.reduce === "fire") {
    const rh = hoursIn(hourly, "relative_humidity_2m", fromMs, toMs);
    const ws = new Map(hoursIn(hourly, "wind_speed_10m", fromMs, toMs).map((p) => [p.ms, p.v]));
    let best = NaN;
    for (const p of rh) {
      const w = ws.get(p.ms);
      if (!Number.isFinite(w)) continue;
      const h = Math.min(2, 15 / Math.max(p.v, 1)) * Math.min(2, w / 11.2);
      if (!(best >= h)) best = h;
    }
    return best;
  }
  const pts = hoursIn(hourly, spec.vars[0], fromMs, toMs);
  if (!pts.length) return NaN;
  if (spec.reduce === "max") return Math.max(...pts.map((p) => p.v));
  if (spec.reduce === "min") return Math.min(...pts.map((p) => p.v));
  // The wettest 24 h inside the window.
  let best = -Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    let s = 0;
    for (let j = i; j < pts.length && pts[j].ms < pts[i].ms + DAY; j += 1) s += pts[j].v;
    if (s > best) best = s;
  }
  return best;
}

/** Was a weather hazard's warning level reached? */
export function reached(key, value) {
  const spec = VERIFY[key];
  if (!spec || !Number.isFinite(value)) return null;
  return spec.below ? value <= spec.level : value >= spec.level;
}

/** The outcome of a weather record against the hourly observations there. */
export function verifyWeather(record, hourly, { nowMs = Date.now(), source = "", provisional = false } = {}) {
  const value = reduceWeather(record.key, hourly, record.fromMs, record.toMs);
  if (!Number.isFinite(value)) return null;
  return {
    observed: reached(record.key, value),
    how: "weather",
    value: Math.round(value * 100) / 100,
    error: Number.isFinite(record.value) ? Math.round((record.value - value) * 100) / 100 : null,
    source,
    provisional,
    atMs: nowMs,
  };
}

/* ── learning ───────────────────────────────────────────────────────────── */

/** The score's own screening probability: 1 − e^(−score), so a score of 1 is 0.63. */
export function naiveProbability(score) {
  return Number.isFinite(score) && score > 0 ? 1 - Math.exp(-score) : 0;
}

/** A record's features for the calibration: intercept, log score, lead in days. */
export function features(r) {
  return [1, Math.log(Math.max(r.score, 0) + 0.05), (r.lead || 0) / 24];
}

const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Solve A x = b for a small symmetric positive-definite A (Gaussian elimination). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Logistic regression by iteratively re-weighted least squares, with a small
 * ridge (never on the intercept) so a separable ledger does not run its
 * coefficients to infinity.
 */
export function fitLogistic(X, y, { ridge = 1e-2, iters = 60 } = {}) {
  const p = X[0]?.length || 0;
  let beta = new Array(p).fill(0);
  for (let it = 0; it < iters; it += 1) {
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    const g = new Array(p).fill(0);
    for (let i = 0; i < X.length; i += 1) {
      const x = X[i];
      const mu = sigmoid(x.reduce((s, v, k) => s + v * beta[k], 0));
      const w = Math.max(mu * (1 - mu), 1e-9);
      for (let a = 0; a < p; a += 1) {
        g[a] += (y[i] - mu) * x[a];
        for (let b = 0; b < p; b += 1) H[a][b] += w * x[a] * x[b];
      }
    }
    for (let a = 1; a < p; a += 1) { H[a][a] += ridge; g[a] -= ridge * beta[a]; }
    const step = solve(H, g);
    if (!step) break;
    beta = beta.map((b, k) => b + step[k]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return beta;
}

export function predict(beta, r) {
  return sigmoid(features(r).reduce((s, v, k) => s + v * (beta[k] || 0), 0));
}

const brier = (ps, ys) => (ys.length ? ys.reduce((s, y, i) => s + (ps[i] - y) ** 2, 0) / ys.length : NaN);

/** Records with a yes/no outcome. */
export function verified(records) {
  return (records || []).filter((r) => r.outcome && (r.outcome.observed === true || r.outcome.observed === false));
}

/**
 * The calibration Atlas learns: P(event | log score, lead), judged by its
 * k-fold CROSS-VALIDATED Brier score against the naive probability's. Needs
 * both outcomes and at least `min` records; otherwise says why not.
 */
export function calibrate(records, { min = 20, folds = 5 } = {}) {
  const v = verified(records);
  const ys = v.map((r) => (r.outcome.observed ? 1 : 0));
  const pos = ys.reduce((s, y) => s + y, 0);
  if (v.length < min) return { ok: false, n: v.length, why: `${v.length} verified forecast${v.length === 1 ? "" : "s"} — needs ${min}` };
  if (pos === 0 || pos === v.length) {
    return { ok: false, n: v.length, why: pos === 0 ? "no event has been observed yet" : "every forecast was followed by an event" };
  }
  const X = v.map(features);
  const beta = fitLogistic(X, ys);
  // Interleaved folds, so a ledger ordered in time is not split into "early" and "late".
  const cv = new Array(v.length);
  for (let f = 0; f < folds; f += 1) {
    const trainX = []; const trainY = [];
    v.forEach((_, i) => { if (i % folds !== f) { trainX.push(X[i]); trainY.push(ys[i]); } });
    const b = fitLogistic(trainX, trainY);
    v.forEach((r, i) => { if (i % folds === f) cv[i] = predict(b, r); });
  }
  const naive = v.map((r) => naiveProbability(r.score));
  const base = pos / v.length;
  return {
    ok: true,
    n: v.length,
    beta,
    cvBrier: brier(cv, ys),
    naiveBrier: brier(naive, ys),
    climBrier: brier(ys.map(() => base), ys),
    base,
  };
}

/** Reliability: forecasts binned by probability, against how often the event followed. */
export function reliability(ps, ys, bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, sumP: 0, sumY: 0 }));
  ps.forEach((p, i) => {
    const b = out[Math.min(bins - 1, Math.max(0, Math.floor(p * bins)))];
    b.n += 1; b.sumP += p; b.sumY += ys[i];
  });
  return out.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.n ? b.sumP / b.n : null, freq: b.n ? b.sumY / b.n : null }));
}

function pearson(a, b) {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0; let saa = 0; let sbb = 0;
  for (let i = 0; i < n; i += 1) {
    sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const x = q * (sorted.length - 1);
  const lo = Math.floor(x); const hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

/**
 * Everything the ledger can say about a set of records: the contingency table
 * and its scores (a forecast is "yes" at a score of 1 or more — the hazard's
 * own warning level), the Brier score of the naive probability and its skill
 * against climatology, reliability, the calibration, the correlation of the
 * features with the outcome, and — for the weather — the error distribution
 * and the linear correction that minimises it.
 */
export function skill(records) {
  const all = records || [];
  const v = verified(all);
  const ys = v.map((r) => (r.outcome.observed ? 1 : 0));
  const yes = v.map((r) => r.score >= 1);
  let hits = 0; let misses = 0; let falseAlarms = 0; let correctNegatives = 0;
  v.forEach((r, i) => {
    if (yes[i] && ys[i]) hits += 1;
    else if (!yes[i] && ys[i]) misses += 1;
    else if (yes[i] && !ys[i]) falseAlarms += 1;
    else correctNegatives += 1;
  });
  const ratio = (a, b) => (b > 0 ? a / b : null);
  const naive = v.map((r) => naiveProbability(r.score));
  const base = ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : null;
  const bNaive = brier(naive, ys);
  const bClim = base == null ? NaN : brier(ys.map(() => base), ys);

  // The weather: forecast against observed as NUMBERS.
  const pairs = v.filter((r) => r.outcome.how === "weather" && Number.isFinite(r.value) && Number.isFinite(r.outcome.value));
  let continuous = null;
  if (pairs.length) {
    const f = pairs.map((r) => r.value);
    const o = pairs.map((r) => r.outcome.value);
    const e = pairs.map((r, i) => f[i] - o[i]).sort((a, b) => a - b);
    const n = e.length;
    const mf = f.reduce((s, x) => s + x, 0) / n;
    const mo = o.reduce((s, x) => s + x, 0) / n;
    let sff = 0; let sfo = 0;
    for (let i = 0; i < n; i += 1) { sff += (f[i] - mf) ** 2; sfo += (f[i] - mf) * (o[i] - mo); }
    const b = sff > 0 ? sfo / sff : null;
    continuous = {
      n,
      bias: e.reduce((s, x) => s + x, 0) / n,
      mae: e.reduce((s, x) => s + Math.abs(x), 0) / n,
      rmse: Math.sqrt(e.reduce((s, x) => s + x * x, 0) / n),
      r: pearson(f, o),
      q10: quantile(e, 0.1), q50: quantile(e, 0.5), q90: quantile(e, 0.9),
      correction: b == null ? null : { a: mo - b * mf, b },
      unit: pairs[0].unit,
    };
  }

  const featureNames = ["log score", "lead (days)"];
  const correlations = v.length >= 3
    ? featureNames.map((name, k) => ({ name, r: pearson(v.map((r) => features(r)[k + 1]), ys) }))
    : [];

  return {
    recorded: all.length,
    pending: all.filter((r) => !r.outcome).length,
    n: v.length,
    hits, misses, falseAlarms, correctNegatives,
    pod: ratio(hits, hits + misses),
    far: ratio(falseAlarms, hits + falseAlarms),
    csi: ratio(hits, hits + misses + falseAlarms),
    bias: ratio(hits + falseAlarms, hits + misses),
    base,
    brier: Number.isFinite(bNaive) ? bNaive : null,
    bss: Number.isFinite(bNaive) && bClim > 0 ? 1 - bNaive / bClim : null,
    reliability: reliability(naive, ys),
    calibration: calibrate(v),
    correlations,
    continuous,
  };
}

/** One skill block per hazard, plus every hazard together. */
export function summarise(ledger, { key = null } = {}) {
  const records = (ledger || []).filter((r) => !key || r.key === key);
  const keys = [...new Set(records.map((r) => r.key))].sort();
  return { all: skill(records), byKey: Object.fromEntries(keys.map((k) => [k, skill(records.filter((r) => r.key === k))])) };
}

const pct = (x) => (x == null || !Number.isFinite(x) ? "—" : `${Math.round(x * 100)}%`);
const num = (x, d = 3) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));

/** The ledger in words — what the Atlas verification tool answers with. */
export function reportText(summary, { key = null } = {}) {
  const a = summary.all;
  if (!a.recorded) {
    return "The verification ledger is empty. It fills each time the total-risk card answers for a place "
      + "(Hazards ▸ myGeoID ▸ Total risk here), and verifies each reading once its window has passed.";
  }
  const lines = [];
  lines.push(`**Verification ledger${key ? ` — ${key}` : ""}**: ${a.recorded} forecast${a.recorded === 1 ? "" : "s"} recorded, `
    + `${a.n} verified, ${a.pending} waiting for their window to pass.`);
  if (a.n) {
    lines.push(`Warnings (score ≥ 1): ${a.hits} hit, ${a.misses} missed, ${a.falseAlarms} false alarm${a.falseAlarms === 1 ? "" : "s"}, `
      + `${a.correctNegatives} correct quiet. POD ${pct(a.pod)}, FAR ${pct(a.far)}, CSI ${pct(a.csi)}, frequency bias ${num(a.bias, 2)}.`);
    lines.push(`Brier score ${num(a.brier)} (climatology ${pct(a.base)} of windows had the event)`
      + `${a.bss != null ? `; skill against climatology ${num(a.bss, 2)}` : ""}.`);
    const c = a.calibration;
    lines.push(c.ok
      ? `Learnt calibration (logistic on log score and lead, n ${c.n}): cross-validated Brier ${num(c.cvBrier)} against `
        + `${num(c.naiveBrier)} for the score's own probability and ${num(c.climBrier)} for climatology.`
      : `No calibration yet: ${c.why}.`);
  }
  for (const [k, s] of Object.entries(summary.byKey)) {
    if (!s.n) continue;
    let line = `· ${k}: ${s.n} verified, POD ${pct(s.pod)}, FAR ${pct(s.far)}`;
    if (s.continuous) {
      const c = s.continuous;
      line += `; error (forecast − observed) bias ${num(c.bias, 1)} ${c.unit}, MAE ${num(c.mae, 1)}, r ${num(c.r, 2)}`;
      if (c.correction) line += `; best correction observed ≈ ${num(c.correction.a, 1)} + ${num(c.correction.b, 2)}×forecast`;
    }
    lines.push(line);
  }
  lines.push("Events are checked against NASA EONET (curated, so an absence is a weak negative) and the USGS catalogue; "
    + "the weather against Open-Meteo's ERA5 archive, provisionally against its recent model analysis until the archive covers the window.");
  return lines.join("\n");
}

/** The ledger as CSV, one row per record. */
export function toCsv(ledger) {
  const head = ["id", "key", "model", "lat", "lon", "issued", "from", "to", "lead_h", "score", "forecast_value", "unit",
    "observed", "observed_value", "error", "how", "provisional", "event", "event_km", "source"];
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : "");
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = (ledger || []).map((r) => [
    r.id, r.key, r.model, r.lat, r.lon, iso(r.issuedMs), iso(r.fromMs), iso(r.toMs), Math.round(r.lead * 10) / 10,
    r.score, r.value, r.unit,
    r.outcome ? (r.outcome.observed == null ? "" : r.outcome.observed ? 1 : 0) : "",
    r.outcome?.value ?? "", r.outcome?.error ?? "", r.outcome?.how ?? "", r.outcome?.provisional ? 1 : "",
    r.outcome?.event?.title ?? "", r.outcome?.km ?? "", r.outcome?.source ?? r.source,
  ].map(cell).join(","));
  return [head.join(","), ...rows].join("\n");
}

/* ── normalising what the catalogues answer ────────────────────────────── */

/** EONET v3 `events` JSON → normalised events, one per dated geometry. */
export function eonetEvents(json) {
  const out = [];
  for (const ev of json?.events || []) {
    const category = ev.categories?.[0]?.id;
    for (const g of ev.geometry || []) {
      const ms = Date.parse(g.date);
      let c = g.coordinates;
      if (g.type === "Polygon") c = c?.[0]?.[0];
      if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || !Number.isFinite(ms)) continue;
      out.push({ id: ev.id, category, title: ev.title, lat: c[1], lon: c[0], timeMs: ms, mag: g.magnitudeValue ?? null });
    }
  }
  return out;
}

/** USGS FDSN GeoJSON → normalised earthquakes. */
export function usgsEvents(json) {
  return (json?.features || []).map((f) => ({
    id: f.id, category: "earthquakes", title: f.properties?.title || f.properties?.place || "",
    lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0],
    timeMs: f.properties?.time, mag: f.properties?.mag,
  })).filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon) && Number.isFinite(e.timeMs));
}

/** The hourly variables a set of weather records needs. */
export function weatherVars(records) {
  return [...new Set((records || []).flatMap((r) => VERIFY[r.key]?.kind === "weather" ? VERIFY[r.key].vars : []))];
}
