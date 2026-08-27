import * as dsp from "./dsp.js?v=20260827-a703d7f";
import { parseTable, column } from "./table.js?v=20260827-a703d7f";

/**
 * The Event Correlation Toolkit's analyses, written out.
 *
 * The desktop app runs these through
 * `scripts/thesis/comprehensive_signal_analysis_complete.py`, importing the
 * module and calling into pandas, numpy and pywt. A browser tab has no
 * interpreter to lend it, and the alternative was eleven disabled buttons.
 *
 * They are not hard: a peaks table, a time-window clustering, some group-by
 * arithmetic and a wavelet transform. So they are ported here — **against the
 * script, not from memory**. Every constant below is that file's:
 *
 *   SYNC_TOLERANCE_SEC = 300      MIN_STATIONS   = 2
 *   MIN_CORRELATION    = 0.2      MIN_SNR_LINEAR = 3.16
 *
 * and so are the three scoring weightings (`identify_best_candidates`, :1246).
 * If that script changes, these must change with it or the two apps will
 * disagree about which candidate is best, which is worse than not having it.
 */

export const SYNC_TOLERANCE_SEC = 300;
export const MIN_STATIONS = 2;
export const MIN_CORRELATION = 0.2;
export const MIN_SNR_LINEAR = 3.16;

/**
 * A parsed table's rows as objects keyed by column name.
 *
 * `parseTable` returns rows as **arrays**, not objects — every field read as
 * `row.peak_corr` came back undefined and the whole toolkit reported "peak
 * files held no readable rows".
 */
export function rowObjects(table) {
  return table.rows.map((row) =>
    Object.fromEntries(table.columns.map((name, i) => [name, row[i]])));
}

/** A peaks CSV as row objects, with the facets the tree layout implies. */
export function peaksFromCsv(text, path) {
  const table = parseTable(text);
  // `load_all_peaks` (:124) walks peaks_root/<dataset>/<station>/<sim>/ and
  // takes the template from the "<...>_<template>_peaks.csv" filename. The web
  // store keeps the same shape, so the path still carries the facets -- but a
  // column already in the file always wins.
  const parts = path.split("/");
  const file = parts[parts.length - 1] || "";
  const stem = file.replace(/\.[^.]+$/, "");
  const bits = stem.split("_");
  const fromPath = {
    template: bits.length >= 2 && bits[bits.length - 1] === "peaks"
      ? bits[bits.length - 2] : "",
    sim: parts[parts.length - 2] || "",
    station: parts[parts.length - 3] || "",
    dataset: parts[parts.length - 4] || "",
  };
  return rowObjects(table).map((row) => {
    const out = { ...row };
    Object.entries(fromPath).forEach(([key, value]) => {
      if (out[key] === undefined || out[key] === "") out[key] = value;
    });
    out._t = Date.parse(out.peak_time_dt);
    out.peak_corr = Number(out.peak_corr);
    out.snr_linear = Number(out.snr_linear);
    if (out.cumulative_snr_linear !== undefined) {
      out.cumulative_snr_linear = Number(out.cumulative_snr_linear);
    }
    return out;
  }).filter((r) => Number.isFinite(r._t));
}

/**
 * `find_synchronous_events` (:1091), the same greedy clustering.
 *
 * Sort by time; take the earliest unassigned peak; every unassigned peak within
 * the tolerance joins it; the cluster is an event only if it spans at least
 * `minStations` distinct stations, and is discarded otherwise. Peaks in a
 * discarded window are *consumed*, not returned to the pool — that is what the
 * -999 marker does in the original, and rewriting it as "skip and retry" would
 * produce different events.
 */
export function findSynchronousEvents(peaks, {
  toleranceSec = SYNC_TOLERANCE_SEC, minStations = MIN_STATIONS,
} = {}) {
  const sorted = peaks.slice().sort((a, b) => a._t - b._t);
  const taken = new Array(sorted.length).fill(false);
  const tolerance = toleranceSec * 1000;
  const events = [];
  let id = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (taken[i]) continue;
    const reference = sorted[i]._t;
    const window = [];
    for (let j = i; j < sorted.length; j += 1) {
      if (taken[j]) continue;
      if (sorted[j]._t - reference > tolerance) break;
      window.push(j);
    }
    // The original takes an absolute difference, so peaks *before* the
    // reference count too; sorted order means only later ones can be unassigned.
    const stations = new Set(window.map((j) => sorted[j].station));
    window.forEach((j) => { taken[j] = true; });
    if (stations.size >= minStations) {
      const members = window.map((j) => ({ ...sorted[j], event_id: id }));
      events.push(...members);
      id += 1;
    }
  }
  return { peaks: events, count: id };
}

const finite = (xs) => xs.filter(Number.isFinite);
const minOf = (xs) => xs.reduce((a, b) => Math.min(a, b), Infinity);
const maxOf = (xs) => xs.reduce((a, b) => Math.max(a, b), -Infinity);

/** Min-max normalisation, flat where the range is zero. */
function normalise(values) {
  const lo = minOf(values);
  const hi = maxOf(values);
  const span = hi - lo;
  return values.map((v) => (span > 0 ? (v - lo) / span : 0));
}

/**
 * `identify_best_candidates` (:1246) — three rankings from one quality filter.
 *
 * The weights are the script's: ULP is quality alone, sync leans on
 * multi-station coherence, balanced sits between them. All three are returned
 * because the desktop app writes all three, and the page's "Top candidates"
 * count decides how many of each.
 */
export function bestCandidates(peaks, syncPeaks, { count = 20 } = {}) {
  const quality = peaks.filter((p) => p.peak_corr >= MIN_CORRELATION
    && p.snr_linear >= MIN_SNR_LINEAR);
  if (!quality.length) return { candidates: [], quality: 0, rankings: {} };

  const corrNorm = normalise(quality.map((p) => p.peak_corr));
  const snrNorm = normalise(quality.map((p) => p.snr_linear));

  // How many stations the sync event around each peak spans, within 10 s and
  // matching dataset/sim/template — the original's `count_sync_stations`.
  const byKey = new Map();
  (syncPeaks || []).forEach((s) => {
    const key = `${s.dataset}|${s.sim}|${s.template}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
  });
  const stationCounts = quality.map((p) => {
    const near = (byKey.get(`${p.dataset}|${p.sim}|${p.template}`) || [])
      .filter((s) => Math.abs(s._t - p._t) < 10_000);
    return near.length ? new Set(near.map((s) => s.station)).size : 0;
  });
  const maxStations = maxOf(stationCounts);
  const syncNorm = stationCounts.map((n) => (maxStations > 0 ? n / maxStations : 0));

  const scored = quality.map((p, i) => ({
    ...p,
    corr_norm: corrNorm[i], snr_norm: snrNorm[i],
    num_sync_stations: stationCounts[i], sync_stations_norm: syncNorm[i],
    is_sync: stationCounts[i] > 0,
    score_ulp: 0.50 * corrNorm[i] + 0.50 * snrNorm[i],
    score_sync: 0.25 * corrNorm[i] + 0.25 * snrNorm[i] + 0.50 * syncNorm[i],
    score_balanced: 0.35 * corrNorm[i] + 0.35 * snrNorm[i] + 0.30 * syncNorm[i],
  }));
  const top = (key) => scored.slice().sort((a, b) => b[key] - a[key]).slice(0, count);
  return {
    quality: scored.length,
    candidates: top("score_ulp"),        // the script's primary ranking
    rankings: { ulp: top("score_ulp"), sync: top("score_sync"),
                balanced: top("score_balanced") },
  };
}

/**
 * `explain_cumulative_metrics_behavior` (:608).
 *
 * Cumulative correlation is linear in the number of peaks; cumulative SNR is
 * not, because it is reported in dB — `20·log10(Σ + 1e-10)`. Run on the largest
 * dataset/station/sim/template group, as the script does.
 */
export function cumulativeMetrics(peaks) {
  const groups = new Map();
  peaks.forEach((p) => {
    const key = `${p.dataset}|${p.station}|${p.sim}|${p.template}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  let best = null;
  groups.forEach((rows, key) => {
    if (!best || rows.length > best.rows.length) best = { key, rows };
  });
  if (!best || best.rows.length < 2) return null;
  const rows = best.rows.slice().sort((a, b) => a._t - b._t);
  let corrSum = 0;
  let snrSum = 0;
  const series = rows.map((p, i) => {
    corrSum += Math.abs(p.peak_corr) || 0;
    const raw = Number.isFinite(p.cumulative_snr_linear)
      ? p.cumulative_snr_linear : (snrSum += p.snr_linear || 0);
    return { n: i + 1, cumulative_corr: corrSum,
             cumulative_snr_db: 20 * Math.log10(Math.max(raw, 0) + 1e-10) };
  });
  return { group: best.key, series };
}

/**
 * `compare_ingv_vs_experiment` (:814), generalised to whatever datasets are
 * present — the script names two because that study had two.
 */
export function datasetCompare(peaks) {
  const groups = new Map();
  peaks.forEach((p) => {
    if (!groups.has(p.dataset)) groups.set(p.dataset, []);
    groups.get(p.dataset).push(p);
  });
  const summary = [];
  groups.forEach((rows, dataset) => {
    const corr = finite(rows.map((r) => r.peak_corr));
    const snr = finite(rows.map((r) => r.snr_linear));
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    summary.push({
      dataset, peaks: rows.length,
      stations: new Set(rows.map((r) => r.station)).size,
      templates: new Set(rows.map((r) => r.template)).size,
      corr_mean: avg(corr), corr_max: corr.length ? maxOf(corr) : 0,
      snr_mean: avg(snr), snr_max: snr.length ? maxOf(snr) : 0,
    });
  });
  return summary.sort((a, b) => b.peaks - a.peaks);
}

/** Per-station summary, the shape `create_station_pwave_impact_summaries` writes. */
export function stationSummaries(peaks) {
  const groups = new Map();
  peaks.forEach((p) => {
    const key = `${p.dataset}|${p.station}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  const rows = [];
  groups.forEach((items, key) => {
    const [dataset, station] = key.split("|");
    const corr = finite(items.map((r) => r.peak_corr));
    const snr = finite(items.map((r) => r.snr_linear));
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    rows.push({
      dataset, station, peaks: items.length,
      corr_mean: avg(corr), corr_max: corr.length ? maxOf(corr) : 0,
      snr_mean: avg(snr), snr_max: snr.length ? maxOf(snr) : 0,
      high_quality: items.filter((r) => r.peak_corr >= MIN_CORRELATION
        && r.snr_linear >= MIN_SNR_LINEAR).length,
    });
  });
  return rows.sort((a, b) => b.peaks - a.peaks);
}

/**
 * `analyze_p_wave_contamination_probability` (:403).
 *
 * The impact table pairs a clean and a contaminated correlation mean per
 * station; the script's headline number is the percentage improvement of clean
 * over contaminated, which is what this returns per row and in aggregate.
 */
export function contamination(impactRows) {
  const rows = impactRows.map((row) => {
    const clean = Number(row.corr_mean_clean);
    const dirty = Number(row.corr_mean_contaminated);
    const improvement = Number.isFinite(clean) && Number.isFinite(dirty) && dirty !== 0
      ? ((clean - dirty) / dirty) * 100 : NaN;
    return { ...row, corr_improvement_pct: improvement };
  }).filter((r) => Number.isFinite(r.corr_improvement_pct));
  if (!rows.length) return null;
  const values = rows.map((r) => r.corr_improvement_pct).sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    rows, mean_improvement_pct: mean,
    median_improvement_pct: values[Math.floor(values.length / 2)],
    contaminated_worse: rows.filter((r) => r.corr_improvement_pct > 0).length,
    total: rows.length,
  };
}

/**
 * Morlet continuous wavelet transform — `compute_cwt` (:367).
 *
 * pywt is not here, so the transform is done directly: a complex Morlet
 * convolved at log-spaced scales, `scale = centre_frequency · fs / f`, and the
 * power is |coefficient|². The centre frequency of pywt's `morl` is 0.8125,
 * which is why that number appears rather than a derivation.
 */
export function morletCwt(signal, {
  fs = 1, freqMin = 1e-4, freqMax = 1e-2, count = 40,
} = {}) {
  const values = Array.from(signal).filter(Number.isFinite);
  if (values.length < 8) return null;
  const centreFrequency = 0.8125;
  const freqs = Array.from({ length: count }, (_, i) =>
    10 ** (Math.log10(freqMin) + (i * (Math.log10(freqMax) - Math.log10(freqMin))) / (count - 1)));
  const grid = [];
  freqs.forEach((f) => {
    const scale = (centreFrequency * fs) / f;
    const half = Math.min(values.length, Math.ceil(4 * scale));
    // The Morlet kernel, sampled once per scale rather than per position.
    const kernelRe = [];
    const kernelIm = [];
    for (let k = -half; k <= half; k += 1) {
      const t = k / scale;
      const envelope = Math.exp(-(t * t) / 2) / Math.sqrt(scale);
      kernelRe.push(envelope * Math.cos(2 * Math.PI * centreFrequency * t));
      kernelIm.push(envelope * Math.sin(2 * Math.PI * centreFrequency * t));
    }
    const row = new Array(values.length).fill(0);
    for (let n = 0; n < values.length; n += 1) {
      let re = 0;
      let im = 0;
      for (let k = 0; k < kernelRe.length; k += 1) {
        const at = n + k - half;
        if (at < 0 || at >= values.length) continue;
        re += values[at] * kernelRe[k];
        im -= values[at] * kernelIm[k];
      }
      row[n] = re * re + im * im;
    }
    grid.push(row);
  });
  // grid[freq][time]; transposed to grid[time][freq] for plot.heatmap.
  const out = Array.from({ length: values.length }, (_, t) =>
    grid.map((row) => row[t]));
  return { freqs, grid: out };
}

/** A spectrogram per candidate series — `create_candidate_spectrograms` (:1587). */
export function candidateSpectrogram(values, fs = 1) {
  return dsp.spectrogram(values, fs, { segment: 128 });
}

/** Every numeric column of a table, for the pages that take a raw series. */
export function numericColumns(text) {
  const table = parseTable(text);
  const out = {};
  table.columns.forEach((name, i) => {
    if (!table.numeric[i]) return;
    const values = column(table, name).filter(Number.isFinite);
    if (values.length > 2) out[name] = values;
  });
  return out;
}
