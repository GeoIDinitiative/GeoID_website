/**
 * Risk assessment: the people under a hazard, broken down the way a risk
 * assessment is read — the pure half.
 *
 * `exposure.js` integrates people against a hazard. This module decides what
 * the answer is SAID as, and keeps three distinctions a report must not blur:
 *
 * - **A risk LEVEL is a scheme, stated.** "High" means FoS 1–1.2 on a slope,
 *   1–2 m of water in a flood and a 1-in-2-to-10-year chance on a probability
 *   map. Every class carries both its level and its own threshold in its own
 *   units, and the report prints the table of thresholds, because a level
 *   without its definition is an adjective.
 * - **An unknown direction is not a risk level.** A raster this module does
 *   not recognise is cut into value bands and labelled by value; calling its
 *   top band "Very high" would claim that more of it is worse.
 * - **People with no reading are counted apart**, never as the lowest class:
 *   ground the hazard map does not cover is not safe ground.
 *
 * Statistics are PEOPLE-WEIGHTED (the depth the median exposed person stands
 * in, not the median cell), because the question is what happens to people.
 */

import { cellKm2, insideAny, boxOf } from "./exposure.js?v=20260919-9a38a72";

export const LEVELS = ["Very high", "High", "Moderate", "Low", "Very low"];
export const LEVEL_COLOURS = {
  "Very high": "#7f0000", High: "#d7301f", Moderate: "#fc8d59", Low: "#fdcc8a", "Very low": "#fef0d9",
};

const between = (lo, hi) => (v) => v >= lo && v < hi;

/**
 * The schemes. Each class: level (or null for a value band), label, the
 * threshold said in the hazard's own units, and a test.
 */
export const SCHEMES = {
  landslide: {
    id: "landslide", hazard: "Landslide", measure: "Factor of safety", unit: "", lowerIsWorse: true,
    definition: "Infinite-slope factor of safety: resisting over driving stress on the failure plane. Below 1 the slope is predicted to fail.",
    classes: [
      { level: "Very high", label: "Failing", threshold: "FoS < 1", test: (v) => v < 1 },
      { level: "High", label: "Marginal", threshold: "1 ≤ FoS < 1.2", test: between(1, 1.2) },
      { level: "Moderate", label: "Low margin", threshold: "1.2 ≤ FoS < 1.5", test: between(1.2, 1.5) },
      { level: "Low", label: "Stable", threshold: "1.5 ≤ FoS < 2", test: between(1.5, 2) },
      { level: "Very low", label: "Very stable", threshold: "FoS ≥ 2", test: (v) => v >= 2 },
    ],
  },
  flood: {
    id: "flood", hazard: "Flood", measure: "Water depth", unit: "m",
    definition: "Depth of water above the ground. Depth alone understates the danger of fast water; 0.5 m of moving water can knock an adult over.",
    classes: [
      { level: "Very high", label: "Over 2 m of water", threshold: "depth ≥ 2 m", test: (v) => v >= 2 },
      { level: "High", label: "1–2 m", threshold: "1 ≤ depth < 2 m", test: between(1, 2) },
      { level: "Moderate", label: "0.5–1 m", threshold: "0.5 ≤ depth < 1 m", test: between(0.5, 1) },
      { level: "Low", label: "0.15–0.5 m", threshold: "0.15 ≤ depth < 0.5 m", test: between(0.15, 0.5) },
      { level: "Very low", label: "Under 0.15 m", threshold: "0 < depth < 0.15 m", test: (v) => v > 0 && v < 0.15 },
    ],
    notExposed: (v) => !(v > 0),
  },
  /**
   * SEA LEVEL is land lost to the sea, not a passing flood: anyone living where
   * the sea would stand at the chosen level has to move, whatever the depth.
   * The depth still grades it -- deep water is certain, a few centimetres is
   * within the heights' own error on a flat coast -- so the classes are the
   * flood's depths under a sea-level definition.
   */
  sealevel: {
    id: "sealevel", hazard: "Sea level rise", measure: "Depth of sea over land that is dry today", unit: "m",
    definition: "Where the sea would stand at the chosen level, spread from the real coastline through the streamed heights. Land under it is lost to the sea; shallow depths on a flat coast are within the heights' own error.",
    classes: [
      { level: "Very high", label: "Over 2 m of sea", threshold: "depth ≥ 2 m", test: (v) => v >= 2 },
      { level: "High", label: "1–2 m", threshold: "1 ≤ depth < 2 m", test: between(1, 2) },
      { level: "Moderate", label: "0.5–1 m", threshold: "0.5 ≤ depth < 1 m", test: between(0.5, 1) },
      { level: "Low", label: "0.15–0.5 m", threshold: "0.15 ≤ depth < 0.5 m", test: between(0.15, 0.5) },
      { level: "Very low", label: "Under 0.15 m", threshold: "0 < depth < 0.15 m", test: (v) => v > 0 && v < 0.15 },
    ],
    notExposed: (v) => !(v > 0),
  },
  annualChance: {
    id: "annualChance", hazard: "Hazard", measure: "Annual chance", unit: "per year", probability: true,
    definition: "The chance of the hazard reaching a place in any one year, from its rate on record: p = 1 − exp(−rate).",
    classes: [
      { level: "Very high", label: "More often than 1 in 2 years", threshold: "p ≥ 0.5", test: (v) => v >= 0.5 },
      { level: "High", label: "1 in 2 to 1 in 10 years", threshold: "0.1 ≤ p < 0.5", test: between(0.1, 0.5) },
      { level: "Moderate", label: "1 in 10 to 1 in 100 years", threshold: "0.01 ≤ p < 0.1", test: between(0.01, 0.1) },
      { level: "Low", label: "1 in 100 to 1 in 1,000 years", threshold: "0.001 ≤ p < 0.01", test: between(0.001, 0.01) },
      { level: "Very low", label: "Rarer than 1 in 1,000 years", threshold: "0 < p < 0.001", test: (v) => v > 0 && v < 0.001 },
    ],
    notExposed: (v) => !(v > 0),
  },
  wind: {
    id: "wind", hazard: "Tropical cyclone", measure: "Strongest storm within 200 km", unit: "kt",
    definition: "Each storm's lifetime peak one-minute sustained wind (IBTrACS), for the strongest storm whose track passed within 200 km. The peak may have been reached elsewhere on the track.",
    classes: [
      { level: "Very high", label: "Category 4–5", threshold: "≥ 113 kt (≥ 209 km/h)", test: (v) => v >= 113 },
      { level: "High", label: "Category 3", threshold: "96–112 kt (178–208 km/h)", test: between(96, 113) },
      { level: "Moderate", label: "Category 1–2", threshold: "64–95 kt (119–177 km/h)", test: between(64, 96) },
      { level: "Low", label: "Tropical storm", threshold: "34–63 kt (63–118 km/h)", test: between(34, 64) },
      { level: "Very low", label: "Tropical depression", threshold: "< 34 kt", test: (v) => v > 0 && v < 34 },
    ],
    notExposed: (v) => !(v > 0),
  },
  magnitude: {
    id: "magnitude", hazard: "Earthquake", measure: "Largest earthquake within reach", unit: "M",
    definition: "The largest magnitude on record whose damaging reach covers the cell (the seismic risk grid's mag_max).",
    classes: [
      { level: "Very high", label: "M 8 and above", threshold: "M ≥ 8", test: (v) => v >= 8 },
      { level: "High", label: "M 7–8", threshold: "7 ≤ M < 8", test: between(7, 8) },
      { level: "Moderate", label: "M 6–7", threshold: "6 ≤ M < 7", test: between(6, 7) },
      { level: "Low", label: "M 5–6", threshold: "5 ≤ M < 6", test: between(5, 6) },
      { level: "Very low", label: "Below M 5", threshold: "M < 5", test: (v) => v > 0 && v < 5 },
    ],
    notExposed: (v) => !(v > 0),
  },
  vei: {
    id: "vei", hazard: "Volcanic", measure: "Largest eruption within reach", unit: "VEI",
    definition: "The largest Volcanic Explosivity Index on record whose ashfall reach covers the cell (the volcanic risk grid's vei_max).",
    classes: [
      { level: "Very high", label: "VEI 6 and above", threshold: "VEI ≥ 6", test: (v) => v >= 6 },
      { level: "High", label: "VEI 4–5", threshold: "4 ≤ VEI ≤ 5", test: between(4, 6) },
      { level: "Moderate", label: "VEI 3", threshold: "VEI = 3", test: between(3, 4) },
      { level: "Low", label: "VEI 2", threshold: "VEI = 2", test: between(2, 3) },
      { level: "Very low", label: "VEI 0–1", threshold: "VEI ≤ 1", test: (v) => v >= 0 && v < 2 },
    ],
    // A cell no eruption's ash reaches carries vei_max 0; the reader hands it
    // over as −1 so VEI 0 on record and nothing on record stay apart.
    notExposed: (v) => v < 0,
  },
};

/** The same scheme for a named hazard: a probability scheme retitled. */
export function chanceScheme(hazard, measure, definition) {
  return { ...SCHEMES.annualChance, id: `chance:${measure}`, hazard, measure, definition: definition || SCHEMES.annualChance.definition };
}

/**
 * Value bands for a raster whose direction is unknown: equal intervals over
 * the values in the area, labelled by value, with NO risk level.
 */
export function bandScheme(min, max, { bands = 5, measure = "Value", unit = "", hazard = "Layer" } = {}) {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) && max > lo ? max : lo + 1;
  const step = (hi - lo) / bands;
  const f = (v) => formatNumber(v, hi - lo);
  const classes = [];
  for (let k = bands - 1; k >= 0; k -= 1) {
    const a = lo + k * step;
    const b = k === bands - 1 ? Infinity : lo + (k + 1) * step;
    classes.push({ level: null, label: `${f(a)}–${f(k === bands - 1 ? hi : b)}${unit ? ` ${unit}` : ""}`, threshold: `${f(a)} ≤ v${k === bands - 1 ? "" : ` < ${f(b)}`}`, test: (v) => v >= a && v < b });
  }
  return { id: "bands", hazard, measure, unit, definition: `Equal value bands over the layer's values inside the area. This layer's direction is not known, so no band is called high or low risk.`, classes, bands: true };
}

/** Which scheme a hazard layer's primary values are read with, from its name. */
export function schemeForLayerName(name) {
  const n = String(name || "");
  if (/landslide risk|factor of safety|\bfos\b/i.test(n)) return SCHEMES.landslide;
  if (/flood|inundation|discharge|water depth/i.test(n)) return SCHEMES.flood;
  if (/^sea level/i.test(n)) return SCHEMES.sealevel;
  return null;
}

/** Which hazard a probability map is, and its secondary readings. */
export function riskLayerKind(name, sampleProps = {}) {
  const n = String(name || "");
  if (/cyclone|hurricane|typhoon/i.test(n) || "p_hur_yr" in sampleProps) return "cyclone";
  if (/seismic|earthquake/i.test(n) || "mag_max" in sampleProps) return "seismic";
  if (/volcan|ash/i.test(n) || "vei_max" in sampleProps) return "volcanic";
  return "risk";
}

/** A class index for a value, −1 for no reading or not exposed. */
export function classIndex(scheme, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return -1;
  if (scheme.notExposed?.(v)) return -2;
  return scheme.classes.findIndex((c) => c.test(v));
}

/** Weighted quantile of (value, weight) pairs. */
export function weightedQuantile(pairs, q) {
  const list = pairs.filter(([v, w]) => Number.isFinite(v) && w > 0).sort((a, b) => a[0] - b[0]);
  const total = list.reduce((s, [, w]) => s + w, 0);
  if (!total) return NaN;
  const target = q * total;
  let run = 0;
  for (const [v, w] of list) {
    run += w;
    if (run >= target) return v;
  }
  return list[list.length - 1][0];
}

/** A tally that every integration fills the same way. */
export function newTally(scheme) {
  return {
    scheme,
    total: 0, areaKm2: 0, exposed: 0, exposedAreaKm2: 0, noReading: 0, noReadingAreaKm2: 0, notExposed: 0,
    expectedPerYear: 0, edge: 0,
    byClass: scheme.classes.map((c) => ({ level: c.level, label: c.label, threshold: c.threshold, people: 0, areaKm2: 0, cells: 0 })),
    pairs: [],
    max: -Infinity, min: Infinity,
  };
}

/** One cell (people, its ground, its hazard value) into a tally. */
export function addCell(t, people, areaKm2, value, { edge = false } = {}) {
  t.total += people;
  t.areaKm2 += areaKm2;
  if (edge) t.edge += people;
  const k = classIndex(t.scheme, value);
  if (k === -1) { t.noReading += people; t.noReadingAreaKm2 += areaKm2; return; }
  if (value < t.min) t.min = value;
  if (value > t.max) t.max = value;
  if (people > 0) t.pairs.push([value, people]);
  if (t.scheme.probability) t.expectedPerYear += people * value;
  if (k === -2) { t.notExposed += people; return; }
  const c = t.byClass[k];
  c.people += people; c.areaKm2 += areaKm2; c.cells += 1;
  t.exposed += people; t.exposedAreaKm2 += areaKm2;
}

/** A finished tally: shares, densities and people-weighted statistics. */
export function finishTally(t) {
  const covered = t.total - t.noReading;
  const out = {
    scheme: { id: t.scheme.id, hazard: t.scheme.hazard, measure: t.scheme.measure, unit: t.scheme.unit, definition: t.scheme.definition, probability: Boolean(t.scheme.probability), bands: Boolean(t.scheme.bands) },
    total: t.total, areaKm2: t.areaKm2, density: t.areaKm2 > 0 ? t.total / t.areaKm2 : 0,
    exposed: t.exposed, exposedAreaKm2: t.exposedAreaKm2, exposedShare: t.total > 0 ? t.exposed / t.total : 0,
    noReading: t.noReading, noReadingAreaKm2: t.noReadingAreaKm2, notExposed: t.notExposed, covered,
    expectedPerYear: t.scheme.probability ? t.expectedPerYear : null,
    edgeShare: t.total > 0 ? t.edge / t.total : 0,
    byClass: t.byClass.map((c) => ({
      ...c,
      shareOfArea: t.total > 0 ? c.people / t.total : 0,
      shareOfExposed: t.exposed > 0 ? c.people / t.exposed : 0,
      density: c.areaKm2 > 0 ? c.people / c.areaKm2 : 0,
    })),
    stats: {
      min: Number.isFinite(t.min) ? t.min : null,
      max: Number.isFinite(t.max) ? t.max : null,
      mean: null, median: null, p10: null, p90: null,
    },
  };
  const w = t.pairs.reduce((s, [, p]) => s + p, 0);
  if (w > 0) {
    out.stats.mean = t.pairs.reduce((s, [v, p]) => s + v * p, 0) / w;
    out.stats.median = weightedQuantile(t.pairs, 0.5);
    out.stats.p10 = weightedQuantile(t.pairs, 0.1);
    out.stats.p90 = weightedQuantile(t.pairs, 0.9);
  }
  // Worst-first sums a summary leads with.
  out.veryHighHigh = out.byClass.filter((c) => c.level === "Very high" || c.level === "High").reduce((s, c) => s + c.people, 0);
  return out;
}

/**
 * A hazard GRID against people already on its cells (peopleOnGrid), inside a
 * mask: one tally. `bounds` is the grid's, for each row's cell area.
 */
export function assessGrid({ people, values, mask, width, height, bounds, scheme, noData = null, outside = null }) {
  const t = newTally(scheme);
  // People inside the polygon but off the hazard grid: no reading, counted.
  if (outside && (outside.people > 0 || outside.areaKm2 > 0)) addCell(t, outside.people || 0, outside.areaKm2 || 0, null);
  const b = boxOf(bounds);
  const dx = (b.east - b.west) / width;
  const dy = (b.north - b.south) / height;
  for (let y = 0; y < height; y += 1) {
    const km2 = cellKm2(dx, dy, b.north - (y + 0.5) * dy);
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (mask && !mask[i]) continue;
      let v = values[i];
      if (!Number.isFinite(v) || (noData !== null && v === noData) || v <= -1e30) v = null;
      const edge = mask ? (x === 0 || x === width - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]) : false;
      addCell(t, people[i] || 0, km2, v, { edge });
    }
  }
  return finishTally(t);
}

/**
 * Population cells inside the polygons, each looking its hazard value up at
 * its centre (`valueAt(lon, lat)` → number or null): one tally per scheme.
 */
export function assessPopulation({ pop, polys, schemes }) {
  const pb = boxOf(pop.bounds);
  const tallies = schemes.map((s) => newTally(s.scheme));
  if (!pb || !polys.length) return tallies.map(finishTally);
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const p of polys) { w = Math.min(w, p.box.west); e = Math.max(e, p.box.east); s = Math.min(s, p.box.south); n = Math.max(n, p.box.north); }
  const dx = (pb.east - pb.west) / pop.width;
  const dy = (pb.north - pb.south) / pop.height;
  for (let r = 0; r < pop.height; r += 1) {
    const lat = pb.north - (r + 0.5) * dy;
    if (lat < s || lat > n) continue;
    const km2 = cellKm2(dx, dy, lat);
    for (let c = 0; c < pop.width; c += 1) {
      const lon = pb.west + (c + 0.5) * dx;
      if (lon < w || lon > e || !insideAny(lon, lat, polys)) continue;
      const v = pop.band[r * pop.width + c];
      const people = Number.isFinite(v) && v > 0 && v < 1e30 ? v : 0;
      // An EDGE cell has a neighbour whose centre is outside: the integral's error bar.
      const edge = people > 0 && (!insideAny(lon - dx, lat, polys) || !insideAny(lon + dx, lat, polys) || !insideAny(lon, lat - dy, polys) || !insideAny(lon, lat + dy, polys));
      schemes.forEach((sc, k) => addCell(tallies[k], people, km2, sc.valueAt(lon, lat), { edge }));
    }
  }
  return tallies.map(finishTally);
}

/** Polygons grouped by the feature they came from, each group with a name. */
export function groupByFeature(polys, { max = 50 } = {}) {
  const groups = new Map();
  for (const p of polys) {
    const key = p.feature || p;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const out = [...groups.entries()].map(([feature, list], k) => ({ name: featureName(feature?.properties, k), polys: list }));
  return { groups: out.slice(0, max), truncated: Math.max(0, out.length - max) };
}

export function featureName(props, k) {
  const p = props || {};
  const key = Object.keys(p).find((name) => /^(name|NAME|Name|title|label|district|region|ward|id|ID)$/.test(name) && p[name] !== null && p[name] !== "");
  return key ? String(p[key]) : `Polygon ${k + 1}`;
}

// ── Saying it ───────────────────────────────────────────────────────────────

export function formatNumber(v, span = Math.abs(v)) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e7 || a < 1e-3)) return v.toExponential(2);
  const digits = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
  return v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCount(n) {
  if (!Number.isFinite(n)) return "—";
  if (n > 0 && n < 1) return "<1";
  return Math.round(n).toLocaleString("en-GB");
}

export function formatShare(x) {
  return Number.isFinite(x) ? `${(100 * x).toFixed(x > 0 && x < 0.001 ? 2 : 1)}%` : "—";
}

/** A probability as a return period, the way it is quoted. */
export function returnPeriod(p) {
  if (!(p > 0)) return "never on record";
  if (p >= 1) return "every year";
  const rate = -Math.log(1 - p);
  const years = 1 / rate;
  return years < 1.5 ? `about ${formatNumber(1 / years, 10)} a year` : `1 in ${Math.round(years).toLocaleString("en-GB")} years`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const csvCell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A horizontal stacked bar of people by level, as SVG. */
export function stackedBarSvg(breakdown, { width = 520, height = 26 } = {}) {
  const total = breakdown.total || 0;
  let x = 0;
  const parts = [];
  const rows = [...breakdown.byClass];
  const colour = (c, k) => (c.level ? LEVEL_COLOURS[c.level] : bandColour(k, rows.length));
  rows.forEach((c, k) => {
    const w = total > 0 ? (c.people / total) * width : 0;
    if (w > 0) parts.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="${colour(c, k)}"><title>${esc(c.label)}: ${formatCount(c.people)}</title></rect>`);
    x += w;
  });
  const rest = [["Not exposed", breakdown.notExposed, "#c9d3dd"], ["No reading", breakdown.noReading, "#8a8a8a"]];
  rest.forEach(([label, people, fill]) => {
    const w = total > 0 ? (people / total) * width : 0;
    if (w > 0) parts.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="${fill}"><title>${label}: ${formatCount(people)}</title></rect>`);
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="People by risk level">${parts.join("")}<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#333" stroke-width="0.6"/></svg>`;
}

/** Bars of people per class, as SVG. */
export function classBarsSvg(breakdown, { width = 520, rowH = 22 } = {}) {
  const rows = breakdown.byClass;
  const max = Math.max(1, ...rows.map((c) => c.people));
  const label = 270;
  const barW = width - label - 80;
  const h = rows.length * rowH + 4;
  const parts = rows.map((c, k) => {
    const y = k * rowH + 2;
    const w = (c.people / max) * barW;
    const fill = c.level ? LEVEL_COLOURS[c.level] : bandColour(k, rows.length);
    const text = c.level ? `${c.level} — ${c.label}` : c.label;
    return `<text x="0" y="${y + rowH * 0.68}" font-size="11" fill="#222">${esc(text.length > 44 ? `${text.slice(0, 43)}…` : text)}</text>`
      + `<rect x="${label}" y="${y + 3}" width="${Math.max(0, w).toFixed(2)}" height="${rowH - 7}" fill="${fill}" stroke="#555" stroke-width="0.4"/>`
      + `<text x="${label + Math.max(0, w) + 5}" y="${y + rowH * 0.68}" font-size="11" fill="#222">${formatCount(c.people)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="100%" role="img" aria-label="People per class">${parts.join("")}</svg>`;
}

export function bandColour(k, n) {
  const stops = [[127, 0, 0], [215, 48, 31], [252, 141, 89], [253, 204, 138], [254, 240, 217]];
  const t = n > 1 ? k / (n - 1) : 0;
  const at = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(at));
  const f = at - i;
  const c = stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * f));
  return `rgb(${c.join(",")})`;
}

/**
 * The whole assessment as CSV: sections separated by a blank line and a
 * `#` heading, so a spreadsheet opens it and a script can split it.
 */
export function assessmentCsv(a) {
  const lines = [];
  lines.push(`# GeoID risk assessment`);
  lines.push(`# study_area,${csvCell(a.area)}`);
  lines.push(`# hazard_layer,${csvCell(a.layer)}`);
  lines.push(`# generated,${a.generated}`);
  lines.push(`# population,WorldPop 2020 constrained 1 km counts`);
  if (a.source) lines.push(`# hazard_source,${csvCell(a.source)}`);
  lines.push("");
  lines.push("section,metric,value,unit");
  const summary = a.breakdowns[0];
  const put = (metric, value, unit = "") => lines.push(["summary", metric, value, unit].map(csvCell).join(","));
  put("people_in_area", Math.round(summary.total), "people");
  put("area", summary.areaKm2.toFixed(3), "km2");
  put("population_density", summary.density.toFixed(2), "people/km2");
  put("people_exposed", Math.round(summary.exposed), "people");
  put("share_exposed", (summary.exposedShare * 100).toFixed(2), "%");
  put("people_very_high_or_high", Math.round(summary.veryHighHigh), "people");
  put("people_no_reading", Math.round(summary.noReading), "people");
  if (summary.expectedPerYear !== null) put("expected_people_reached_per_year", summary.expectedPerYear.toFixed(2), "people/yr");
  put("edge_share", (summary.edgeShare * 100).toFixed(1), "%");
  for (const b of a.breakdowns) {
    lines.push("");
    lines.push(`# breakdown: ${b.scheme.hazard} — ${b.scheme.measure}${b.scheme.unit ? ` (${b.scheme.unit})` : ""}`);
    lines.push("breakdown,level,class,threshold,people,share_of_area_pct,share_of_exposed_pct,area_km2,density_people_km2");
    for (const c of b.byClass) {
      lines.push([b.scheme.measure, c.level || "", c.label, c.threshold, Math.round(c.people), (c.shareOfArea * 100).toFixed(2), (c.shareOfExposed * 100).toFixed(2), c.areaKm2.toFixed(3), c.density.toFixed(2)].map(csvCell).join(","));
    }
    lines.push([b.scheme.measure, "", "Not exposed", "", Math.round(b.notExposed), b.total ? (100 * b.notExposed / b.total).toFixed(2) : "0", "", "", ""].map(csvCell).join(","));
    lines.push([b.scheme.measure, "", "No reading", "", Math.round(b.noReading), b.total ? (100 * b.noReading / b.total).toFixed(2) : "0", "", b.noReadingAreaKm2.toFixed(3), ""].map(csvCell).join(","));
    lines.push("");
    lines.push("statistic,value");
    for (const [k, v] of Object.entries(b.stats)) lines.push([`${b.scheme.measure} ${k} (people-weighted)`, v === null ? "" : v].map(csvCell).join(","));
  }
  if (a.byPolygon?.length > 1) {
    lines.push("");
    lines.push("# by polygon");
    const levels = a.breakdowns[0].byClass.map((c) => c.level || c.label);
    lines.push(["polygon", "people", "area_km2", "density", "exposed", "share_exposed_pct", ...levels.map((l) => `people_${l}`), ...(a.breakdowns[0].expectedPerYear !== null ? ["expected_per_year"] : [])].map(csvCell).join(","));
    for (const row of a.byPolygon) {
      const b = row.breakdown;
      lines.push([row.name, Math.round(b.total), b.areaKm2.toFixed(3), b.density.toFixed(2), Math.round(b.exposed), (b.exposedShare * 100).toFixed(2), ...b.byClass.map((c) => Math.round(c.people)), ...(b.expectedPerYear !== null ? [b.expectedPerYear.toFixed(2)] : [])].map(csvCell).join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The report: one self-contained HTML document, A4, print-ready, so the
 * browser's own "Save as PDF" is the PDF writer and nothing is vendored. The
 * sign-off fields are editable in the page before it is printed.
 */
export function reportHtml(a, { mapImage = null } = {}) {
  const b0 = a.breakdowns[0];
  const card = (value, label) => `<div class="card"><div class="v">${value}</div><div class="l">${esc(label)}</div></div>`;
  const cards = [
    card(formatCount(b0.total), "people in the study area"),
    card(formatCount(b0.exposed), `people exposed (${formatShare(b0.exposedShare)})`),
    card(formatCount(b0.veryHighHigh), b0.scheme.bands ? "people in the top two bands" : "people at very high or high risk"),
    b0.expectedPerYear !== null
      ? card(formatNumber(b0.expectedPerYear, b0.expectedPerYear), "people reached in an average year")
      : card(`${formatNumber(b0.areaKm2, b0.areaKm2)} km²`, "area assessed"),
  ].join("");
  const table = (b) => `
    <table>
      <thead><tr><th>${b.scheme.bands ? "Band" : "Risk level"}</th><th>Class</th><th>Threshold</th><th class="n">People</th><th class="n">% of area</th><th class="n">% of exposed</th><th class="n">Area km²</th><th class="n">People / km²</th></tr></thead>
      <tbody>
        ${b.byClass.map((c, k) => `<tr><td><span class="sw" style="background:${c.level ? LEVEL_COLOURS[c.level] : bandColour(k, b.byClass.length)}"></span>${esc(c.level || `Band ${k + 1}`)}</td><td>${esc(c.label)}</td><td>${esc(c.threshold)}</td><td class="n">${formatCount(c.people)}</td><td class="n">${formatShare(c.shareOfArea)}</td><td class="n">${formatShare(c.shareOfExposed)}</td><td class="n">${formatNumber(c.areaKm2, 100)}</td><td class="n">${formatNumber(c.density, 100)}</td></tr>`).join("")}
        <tr class="quiet"><td>—</td><td>Not exposed</td><td></td><td class="n">${formatCount(b.notExposed)}</td><td class="n">${formatShare(b.total ? b.notExposed / b.total : 0)}</td><td></td><td></td><td></td></tr>
        <tr class="quiet"><td>—</td><td>No reading (outside the hazard map)</td><td></td><td class="n">${formatCount(b.noReading)}</td><td class="n">${formatShare(b.total ? b.noReading / b.total : 0)}</td><td></td><td class="n">${formatNumber(b.noReadingAreaKm2, 100)}</td><td></td></tr>
      </tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="n">${formatCount(b.total)}</td><td class="n">100%</td><td></td><td class="n">${formatNumber(b.areaKm2, 100)}</td><td class="n">${formatNumber(b.density, 100)}</td></tr></tfoot>
    </table>`;
  const stats = (b) => {
    const s = b.stats;
    const u = b.scheme.unit ? ` ${esc(b.scheme.unit)}` : "";
    const f = (v) => (v === null ? "—" : b.scheme.probability ? `p = ${formatNumber(v, 1)} (${returnPeriod(v)})` : `${formatNumber(v, Math.abs((s.max ?? 0) - (s.min ?? 0)) || Math.abs(v) || 1)}${u}`);
    return `<table class="stats"><tbody>
      <tr><th>People-weighted mean ${esc(b.scheme.measure.toLowerCase())}</th><td>${f(s.mean)}</td><th>Median</th><td>${f(s.median)}</td></tr>
      <tr><th>10th percentile</th><td>${f(s.p10)}</td><th>90th percentile</th><td>${f(s.p90)}</td></tr>
      <tr><th>Lowest reading in area</th><td>${f(s.min)}</td><th>Highest reading in area</th><td>${f(s.max)}</td></tr>
      ${b.expectedPerYear !== null ? `<tr><th>Expected people reached a year</th><td>${formatNumber(b.expectedPerYear, b.expectedPerYear)}</td><th>Population-weighted chance</th><td>${s.mean === null ? "—" : returnPeriod(s.mean)}</td></tr>` : ""}
    </tbody></table>`;
  };
  const definitions = (b) => `<p class="def">${esc(b.scheme.definition)}</p>`;
  const sections = a.breakdowns.map((b, k) => `
    <section class="${k ? "page" : ""}">
      <h2>${k === 0 ? "3" : `3.${k}`}. ${esc(b.scheme.hazard)} — ${esc(b.scheme.measure)}</h2>
      ${definitions(b)}
      <div class="bar">${stackedBarSvg(b)}</div>
      ${classBarsSvg(b)}
      ${table(b)}
      <h3>Statistics</h3>
      ${stats(b)}
    </section>`).join("");
  const polygons = a.byPolygon?.length > 1 ? `
    <section class="page">
      <h2>4. By polygon</h2>
      <p>${a.byPolygon.length} polygons of the study area, each assessed on its own.${a.polygonsTruncated ? ` ${a.polygonsTruncated} more were not assessed (the report holds 50).` : ""}</p>
      <table>
        <thead><tr><th>Polygon</th><th class="n">People</th><th class="n">Area km²</th><th class="n">Exposed</th><th class="n">% exposed</th>${a.breakdowns[0].byClass.map((c) => `<th class="n">${esc(c.level || c.label)}</th>`).join("")}${a.breakdowns[0].expectedPerYear !== null ? '<th class="n">Per year</th>' : ""}</tr></thead>
        <tbody>${[...a.byPolygon].sort((x, y) => y.breakdown.veryHighHigh - x.breakdown.veryHighHigh || y.breakdown.exposed - x.breakdown.exposed).map((row) => {
          const b = row.breakdown;
          return `<tr><td>${esc(row.name)}</td><td class="n">${formatCount(b.total)}</td><td class="n">${formatNumber(b.areaKm2, 100)}</td><td class="n">${formatCount(b.exposed)}</td><td class="n">${formatShare(b.exposedShare)}</td>${b.byClass.map((c) => `<td class="n">${formatCount(c.people)}</td>`).join("")}${b.expectedPerYear !== null ? `<td class="n">${formatNumber(b.expectedPerYear, b.expectedPerYear)}</td>` : ""}</tr>`;
        }).join("")}</tbody>
      </table>
      <p class="quiet">Sorted by people at very high or high risk, then by people exposed.</p>
    </section>` : "";
  const edge = formatShare(b0.edgeShare);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Risk assessment — ${esc(a.hazard)} — ${esc(a.area)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif; color: #1b1b1f; margin: 0; background: #e9e9ee; font-size: 10.5pt; line-height: 1.45; }
  .sheet { background: #fff; max-width: 190mm; margin: 12px auto; padding: 14mm 12mm; box-shadow: 0 1px 6px rgba(0,0,0,0.15); }
  header.top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #b0127e; padding-bottom: 6px; margin-bottom: 10px; }
  header.top .brand { font-weight: 700; letter-spacing: 0.08em; color: #b0127e; font-size: 9pt; text-transform: uppercase; }
  h1 { font-size: 19pt; margin: 2px 0 0; }
  h2 { font-size: 13pt; margin: 18px 0 6px; color: #3a0f45; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  h3 { font-size: 10.5pt; margin: 12px 0 4px; }
  .meta { color: #555; font-size: 9pt; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
  .card { border: 1px solid #ddd; border-left: 4px solid #b0127e; padding: 6px 8px; border-radius: 3px; }
  .card .v { font-size: 15pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  .card .l { font-size: 8.5pt; color: #555; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9pt; }
  th, td { border-bottom: 1px solid #e3e3e3; padding: 3px 5px; text-align: left; vertical-align: top; }
  thead th { background: #f3eef5; font-weight: 600; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #999; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.quiet td, p.quiet { color: #666; }
  table.stats th { width: 30%; background: #fafafa; font-weight: 600; }
  .sw { display: inline-block; width: 10px; height: 10px; border: 1px solid #777; margin-right: 5px; vertical-align: -1px; }
  .bar { margin: 6px 0 4px; }
  .def { background: #f7f7fa; border-left: 3px solid #999; padding: 4px 8px; margin: 4px 0 6px; font-size: 9pt; }
  .map img, .map svg { width: 100%; border: 1px solid #ccc; display: block; margin-bottom: 6px; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; margin-top: 6px; }
  .field { border-bottom: 1px solid #999; min-height: 22px; padding: 2px 4px; }
  .field label { display: block; font-size: 8pt; color: #666; }
  [contenteditable] { outline: none; }
  [contenteditable]:hover, [contenteditable]:focus { background: #fff8d6; }
  ul { margin: 4px 0; padding-left: 18px; }
  .toolbar { position: sticky; top: 0; background: #3a0f45; color: #fff; padding: 6px 12px; display: flex; gap: 8px; align-items: center; font-size: 10pt; z-index: 2; }
  .toolbar button { background: #b0127e; color: #fff; border: 0; padding: 5px 12px; border-radius: 3px; cursor: pointer; font: inherit; }
  @media print {
    body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .toolbar { display: none; }
    section.page { break-before: page; }
    table, .card, .map { break-inside: avoid; }
    [contenteditable]:hover { background: none; }
  }
</style></head>
<body>
<script>if (location.hash === "#print") addEventListener("load", () => setTimeout(() => print(), 400));</script>
<div class="toolbar"><button type="button" onclick="window.print()">Print / Save as PDF</button><span>Fields shaded on hover can be edited before printing.</span></div>
<div class="sheet">
  <header class="top">
    <div><div class="brand">GeoID Initiative · Risk assessment</div>
      <h1 contenteditable="true">${esc(a.hazard)} risk to people — ${esc(a.area)}</h1>
      <div class="meta">Generated ${esc(a.generatedHuman)} · Hazard layer: ${esc(a.layer)} · Reference <span contenteditable="true">${esc(a.reference)}</span></div></div>
  </header>

  <section>
    <h2>1. Summary</h2>
    <div class="cards">${cards}</div>
    <p contenteditable="true">${esc(a.summaryText)}</p>
  </section>

  <section>
    <h2>2. Study area and hazard</h2>
    ${a.mapGroups?.length ? `<div class="map">${polygonMapSvg(a.mapGroups, { bands: b0.scheme.bands })}</div>` : ""}
    ${mapImage ? `<div class="map"><img src="${mapImage}" alt="The study area on the globe"></div>` : ""}
    <table class="stats"><tbody>
      <tr><th>Study area</th><td>${esc(a.area)}</td></tr>
      <tr><th>Area assessed</th><td>${formatNumber(b0.areaKm2, 100)} km² · ${a.polygonCount} polygon${a.polygonCount === 1 ? "" : "s"}</td></tr>
      <tr><th>Population</th><td>${formatCount(b0.total)} people · ${formatNumber(b0.density, 100)} per km²</td></tr>
      <tr><th>Hazard layer</th><td>${esc(a.layer)}</td></tr>
      ${a.source ? `<tr><th>Hazard source</th><td>${esc(a.source)}</td></tr>` : ""}
      ${a.hazardNote ? `<tr><th>Hazard note</th><td>${esc(a.hazardNote)}</td></tr>` : ""}
      <tr><th>Population data</th><td>WorldPop 2020 constrained counts, 1 km (CC BY 4.0), shared among the hazard's cells by area</td></tr>
    </tbody></table>
  </section>
  ${sections}
  ${polygons}
  <section class="page">
    <h2>${polygons ? "5" : "4"}. Method, assumptions and limitations</h2>
    <ul>
      <li><b>People are conserved, not resampled.</b> WorldPop's count per 1 km cell is shared among the hazard's cells by area where the hazard grid is finer, and summed where it is coarser; a probability map is looked up at each population cell's centre.</li>
      <li><b>The polygon is tested at cell centres.</b> ${edge} of the area's people sit in cells on its edge — the integral's error bar.</li>
      <li><b>No reading is not safe.</b> ${formatCount(b0.noReading)} people live where the hazard layer has no value; they are reported apart and in no risk level.</li>
      ${b0.expectedPerYear !== null ? "<li><b>A chance is not a headcount.</b> The expected figure is a long-run average; in most years it is nobody, and in a bad year it is many more.</li>" : ""}
      ${a.breakdowns.some((b) => b.scheme.bands) ? "<li><b>Value bands are not risk levels.</b> A layer whose direction is not known is banded by value only.</li>" : ""}
      <li><b>Exposure is not vulnerability.</b> This counts where people live against the hazard; it does not model building type, warning time, evacuation or daytime population.</li>
      <li>Every class boundary is printed beside its level. Change the scheme and the numbers change: the levels are a convention, the thresholds are the statement.</li>
    </ul>
    <h3>Notes</h3>
    <div class="field" contenteditable="true" style="min-height:60px">&nbsp;</div>
    <h3>Sign-off</h3>
    <div class="fields">
      <div class="field"><label>Prepared by</label><span contenteditable="true">&nbsp;</span></div>
      <div class="field"><label>Date</label><span contenteditable="true">${esc(a.generatedDate)}</span></div>
      <div class="field"><label>Reviewed by</label><span contenteditable="true">&nbsp;</span></div>
      <div class="field"><label>Version</label><span contenteditable="true">1.0</span></div>
    </div>
    <p class="quiet" style="margin-top:14px">Produced with GeoID GeoHUB. Hazard models are screening tools and not a substitute for site investigation.</p>
  </section>
</div>
</body></html>`;
}

/**
 * The study area as a map: every polygon drawn to scale (equirectangular at
 * the area's own latitude), filled by the share of its people at very high or
 * high risk — or by the share exposed where the scheme has no levels — with a
 * key, a scale bar and a north arrow. Vector, so it prints sharp.
 */
export function polygonMapSvg(groups, { width = 640, height = 360, bands = false } = {}) {
  const rings = groups.flatMap((g) => g.rings);
  if (!rings.length) return "";
  let w = Infinity; let e = -Infinity; let s = Infinity; let n = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const pad = 26;
  const legendH = 44;
  const spanX = Math.max((e - w) * k, 1e-9);
  const spanY = Math.max(n - s, 1e-9);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad - legendH) / spanY);
  const ox = (width - spanX * scale) / 2;
  const oy = pad;
  const X = (x) => ox + (x - w) * k * scale;
  const Y = (y) => oy + (n - y) * scale;
  const fillFor = (v) => (Number.isFinite(v) ? bandColour(Math.round((1 - Math.max(0, Math.min(1, v))) * 4), 5) : "#dddddd");
  const paths = groups.map((g) => {
    const d = g.rings.map((ring) => `M${ring.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("L")}Z`).join("");
    return `<path d="${d}" fill="${fillFor(g.value)}" fill-rule="evenodd" stroke="#333" stroke-width="0.8"><title>${esc(g.name)}: ${formatShare(g.value)}</title></path>`;
  }).join("");
  const labels = groups.length > 1 ? groups.map((g) => {
    let gw = Infinity; let ge = -Infinity; let gs = Infinity; let gn = -Infinity;
    for (const ring of g.rings) for (const [x, y] of ring) { if (x < gw) gw = x; if (x > ge) ge = x; if (y < gs) gs = y; if (y > gn) gn = y; }
    return `<text x="${X((gw + ge) / 2).toFixed(1)}" y="${Y((gs + gn) / 2).toFixed(1)}" font-size="10" text-anchor="middle" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke">${esc(g.name.length > 28 ? `${g.name.slice(0, 27)}…` : g.name)}</text>`;
  }).join("") : "";
  // A scale bar of a round number of kilometres, about a quarter of the width.
  const kmPerPx = (1 / (k * scale)) * 111.32 * k;
  const target = (width / 4) * kmPerPx;
  const mag = 10 ** Math.floor(Math.log10(target));
  const km = [1, 2, 5, 10].map((m) => m * mag).filter((v) => v <= target).pop() || mag;
  const barPx = km / kmPerPx;
  const by = height - legendH + 8;
  const legend = [0, 1, 2, 3, 4].map((i) => `<rect x="${pad + i * 34}" y="${by + 14}" width="34" height="10" fill="${bandColour(4 - i, 5)}" stroke="#555" stroke-width="0.4"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="The study area">
<rect x="0" y="0" width="${width}" height="${height}" fill="#f6f7f9"/>${paths}${labels}
<g font-size="9" fill="#333"><text x="${pad}" y="${by + 8}">${bands ? "Share of people in the top two bands" : "Share of people at very high or high risk"}</text>${legend}<text x="${pad}" y="${by + 36}">0%</text><text x="${pad + 170}" y="${by + 36}" text-anchor="end">100%</text></g>
<g transform="translate(${width - pad - barPx},${by + 14})"><rect x="0" y="0" width="${barPx.toFixed(1)}" height="5" fill="#333"/><text x="${(barPx / 2).toFixed(1)}" y="18" font-size="9" text-anchor="middle" fill="#333">${km.toLocaleString("en-GB")} km</text></g>
<g transform="translate(${width - 18},${pad + 6})"><path d="M0,-12 L6,6 L0,2 L-6,6 Z" fill="#333"/><text x="0" y="18" font-size="9" text-anchor="middle" fill="#333">N</text></g>
</svg>`;
}

/** The sentence a summary opens with, from the first breakdown. */
export function summarySentence(a) {
  const b = a.breakdowns[0];
  const parts = [`${formatCount(b.total)} people live in ${a.area} (${formatNumber(b.areaKm2, 100)} km²).`];
  if (b.scheme.bands) parts.push(`${formatCount(b.exposed)} of them are on ground covered by ${a.layer}, banded by value.`);
  else {
    parts.push(`${formatCount(b.exposed)} (${formatShare(b.exposedShare)}) are exposed to ${a.hazard.toLowerCase()} hazard on ${a.layer}, ${formatCount(b.veryHighHigh)} of them at very high or high risk.`);
    const top = b.byClass.find((c) => c.people >= 0.5);
    if (top) parts.push(`The most severe class with people in it is ${top.level.toLowerCase()} (${top.label.toLowerCase()}, ${top.threshold}): ${formatCount(top.people)} people.`);
  }
  if (b.expectedPerYear !== null) parts.push(`In an average year about ${formatNumber(b.expectedPerYear, b.expectedPerYear)} people are reached.`);
  if (b.noReading >= 0.5) parts.push(`${formatCount(b.noReading)} live where the layer has no reading.`);
  return parts.join(" ");
}

/**
 * The strongest storm within `reachKm` of each point, from track features
 * carrying `peak_wind_kts`. Segments are bucketed by degree and each bucket
 * sorted strongest first, so a query stops at the first track in reach.
 */
export function windLookup(features, box, { reachKm = 200, field = "peak_wind_kts" } = {}) {
  const padLat = reachKm / 110.574;
  const midLat = ((box.south + box.north) / 2) * (Math.PI / 180);
  const padLon = reachKm / (111.32 * Math.max(0.1, Math.cos(midLat)));
  const w = box.west - padLon; const e = box.east + padLon; const s = box.south - padLat; const n = box.north + padLat;
  const buckets = new Map();
  const key = (x, y) => `${x},${y}`;
  let segments = 0;
  for (const f of features || []) {
    const kts = Number(f?.properties?.[field]);
    if (!(kts > 0)) continue;
    const g = f.geometry;
    const lines = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
    for (const line of lines) {
      for (let k = 1; k < line.length; k += 1) {
        const [x0, y0] = line[k - 1]; const [x1, y1] = line[k];
        if (Math.abs(x1 - x0) > 180) continue;
        if (Math.max(x0, x1) < w || Math.min(x0, x1) > e || Math.max(y0, y1) < s || Math.min(y0, y1) > n) continue;
        segments += 1;
        const seg = [x0, y0, x1, y1, kts];
        const bx0 = Math.floor(Math.min(x0, x1) - padLon); const bx1 = Math.floor(Math.max(x0, x1) + padLon);
        const by0 = Math.floor(Math.min(y0, y1) - padLat); const by1 = Math.floor(Math.max(y0, y1) + padLat);
        for (let by = by0; by <= by1; by += 1) for (let bx = bx0; bx <= bx1; bx += 1) {
          const kk = key(bx, by);
          const list = buckets.get(kk);
          if (list) list.push(seg); else buckets.set(kk, [seg]);
        }
      }
    }
  }
  buckets.forEach((list) => list.sort((a, b) => b[4] - a[4]));
  const reach2 = reachKm * reachKm;
  const at = (lon, lat) => {
    const list = buckets.get(key(Math.floor(lon), Math.floor(lat)));
    if (!list) return 0;
    const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
    const ky = 110.574;
    for (const [x0, y0, x1, y1, kts] of list) {
      const ax = (x0 - lon) * kx; const ay = (y0 - lat) * ky;
      const bx = (x1 - lon) * kx; const by = (y1 - lat) * ky;
      const dx = bx - ax; const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const px = ax + t * dx; const py = ay + t * dy;
      if (px * px + py * py <= reach2) return kts;
    }
    return 0;
  };
  return { at, segments };
}
