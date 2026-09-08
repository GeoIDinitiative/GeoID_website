/**
 * HOW OFTEN A CYCLONE PASSES — the climatology, and one season at a time.
 *
 * The tracks layer says where every storm went. This says how often that
 * happens to a given patch of ground, which is the question a reader actually
 * has in front of a map of thirteen thousand tracks, and it is not one a pile
 * of lines can answer.
 *
 * THE NUMBER, because a hazard map that does not say is not one. For a point
 * on the grid: the number of DISTINCT STORMS whose track passed within 200 km
 * of it, per year, over the complete seasons since 1980. The probability of at
 * least one in a given year is 1 - exp(-rate), the Poisson form. The bake's
 * `_source` block carries all of it and the layer's own ⓘ prints it.
 *
 * WHY THE CELLS ARE DIFFERENT SIZES, and why that is safe. The grid is a
 * SAMPLING LATTICE: a cell is one place the field was measured, and its size
 * is how finely the field is drawn there — coarse where the field is flat,
 * quarter-degree where it varies. That only works because the value is
 * measured at a POINT within a FIXED radius. "Storms in this cell" would not
 * be comparable at all: an eight-degree cell catches more storms by being big,
 * so the map would be a picture of its own resolution.
 *
 * AND A SINGLE SEASON IS NOT A PROBABILITY. A cell either had a storm in 1992
 * or it did not; there is no frequency in one year to take. So the per-season
 * file holds COUNTS, this module labels them as counts, and the legend changes
 * when the map does — the climatology's classes are return periods and a
 * season's are numbers of storms, and drawing one under the other's key is the
 * whole failure this file exists to avoid.
 */

import {
  buildSymbology, colourOf, legendInfoFrom,
} from "./symbology.js?v=20260908-1357e7f";
import { dataUrl } from "./data-base.js?v=20260908-1357e7f";

const YEARS_PATH = "/data/global/cyclone-risk-years.json";

/**
 * THE CLASSES ARE RETURN PERIODS, not quantiles of this file.
 *
 * The same argument the tracks layer makes for Saffir-Simpson. A quantile cuts
 * the column where its own values happen to fall, so the same ground changes
 * class when the window changes and two of these maps cannot be read against
 * each other. "Once a decade" and "once a year" are boundaries that mean
 * something before anybody looks at the data, and they are what a reader is
 * actually asking about.
 *
 * Each is converted to the annual probability the map carries, so the edges
 * and the field are the same quantity: P = 1 - exp(-1/T).
 */
export const RETURN_PERIODS_YEARS = [10, 5, 2, 1, 0.5];

export function riskEdges(periods = RETURN_PERIODS_YEARS) {
  return periods.map((t) => 1 - Math.exp(-1 / t));
}

/**
 * What each class means in words, since "0.181 to 0.393" is the arithmetic and
 * not the reading. The bands run one MORE than the edges, as classes do.
 */
export const RISK_LABELS = [
  "rarer than 1 in 10 years",
  "about 1 in 10 years",
  "about 1 in 5 years",
  "about 1 in 2 years",
  "about 1 a year",
  "more than 2 a year",
];

/**
 * A season's classes are COUNTS, and the edges say so: half-integers, because
 * a cell's value is the mean over the sub-cells it was coarsened from and is
 * therefore not always a whole number. 0.5 separates "none" from "one".
 */
export const COUNT_EDGES = [0.5, 1.5, 2.5, 3.5];

let years = null;
let loading = null;

/** The per-season counts, fetched once. */
export async function loadYears(fetcher = fetch) {
  if (years) return years;
  if (!loading) {
    // `dataUrl` is ASYNC — it reads the published fingerprints before it can
    // say where a file lives. Passing the promise straight to fetch asks for
    // "[object Promise]", which 404s under a name that looks like a typo.
    loading = (async () => {
      const response = await fetcher(await dataUrl(YEARS_PATH));
      years = response.ok ? await response.json() : null;
      return years;
    })().catch(() => { loading = null; return null; });
  }
  return loading;
}

/**
 * The counts for one season, as a Map from a cell's index to its count.
 *
 * The file is SPARSE — a season touches a small part of the map, so only the
 * cells it reached are listed — and a cell that is absent had no storm that
 * year. That is a real zero and not a gap, which is why this answers with a
 * Map and the caller distinguishes "not listed" from "not loaded".
 */
export function countsFor(payload, season) {
  const rows = payload?.years?.[String(season)];
  if (!rows) return null;
  const out = new Map();
  Object.keys(rows).forEach((k) => {
    const n = Number(rows[k]);
    if (Number.isFinite(n) && n > 0) out.set(Number(k), n);
  });
  return out;
}

/** Every season the file holds, in order. */
export function seasonsIn(payload) {
  return Object.keys(payload?.years || {})
    .map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * The climatology paint: annual probability, on the return-period edges.
 *
 * A cell with no rate is not drawn at all by the bake, so anything here has a
 * number — but the guard stays, because a feature with no value must never
 * take the bottom class. "Never measured" and "rarest class" are different
 * statements and only one of them is true of an empty cell.
 */
export function climatologyPaint(features, { field = "p_yr" } = {}) {
  const values = features
    .map((f) => Number(f?.properties?.[field]))
    .filter((n) => Number.isFinite(n));
  const sym = buildSymbology(values, { edges: riskEdges(), ramp: "risk" });
  if (!sym.ok) return null;
  sym.rows.forEach((row, i) => {
    if (RISK_LABELS[i]) row.label = RISK_LABELS[i];
  });
  return {
    sym,
    colourFor: (feature) => {
      const n = Number(feature?.properties?.[field]);
      return Number.isFinite(n) ? colourOf(n, sym) : null;
    },
    legend: {
      ...legendInfoFrom(sym, { label: "Chance of a storm passing within 200 km" }),
      field, categorical: false,
    },
  };
}

/**
 * What a class of a season map means in words. A count is a count, and
 * "0.5 – 1.5" is the arithmetic rather than the reading.
 *
 * The first band exists because a COARSENED cell's value is a mean: an
 * eight-degree cell one storm clipped the corner of averages under one. It is
 * labelled for what it is rather than rounded down to "none", which would be
 * the map losing a storm it recorded.
 */
export const COUNT_LABELS = [
  "1 storm across part of the cell",
  "about 1 storm",
  "about 2",
  "about 3",
  "4 or more",
];

/**
 * WHAT AN UNREACHED CELL IS PAINTED, and why it needs a row of its own.
 *
 * A cell that returns no colour is drawn in the app's no-value grey — and
 * everywhere else in this app that grey means NOT MEASURED. Here it means
 * measured, and zero: every cell in this file was reached by some storm at
 * some point, or the bake would not have drawn it, so a grey cell is ground
 * the record covers and this particular season did not. Measured on 2005, that
 * is 43,039 of 91,156 cells — half the map in a colour meaning one thing under
 * a key that does not mention it. So the key mentions it.
 */
const NONE_COLOUR = "8a8a8a";
const NONE_LABEL = "no storm that season";

/**
 * One season's paint: counts, keyed by the cell's own index.
 *
 * A cell the season never reached keeps NO colour rather than the bottom
 * class. The bottom class is a storm, and the whole point of a season map is
 * which ground had none — painting an empty cell as though a storm crossed it
 * is the one error this map cannot absorb.
 */
export function seasonPaint(counts, season, cells = 0) {
  const values = [...counts.values()];
  if (!values.length) return null;
  const sym = buildSymbology(values, { edges: COUNT_EDGES, ramp: "risk" });
  if (!sym.ok) return null;
  sym.rows.forEach((row, i) => { if (COUNT_LABELS[i]) row.label = COUNT_LABELS[i]; });
  const legend = legendInfoFrom(sym, { label: `Storms within 200 km in ${season}` });
  // The "none" row LEADS the key, where a zero belongs, and carries the count
  // of cells in it so the row is a reading rather than a caveat.
  const none = Math.max(0, cells - counts.size);
  legend.palette = [NONE_COLOUR, ...legend.palette];
  legend.labels = [NONE_LABEL, ...legend.labels];
  legend.bounds = [["0", "0"], ...legend.bounds];
  legend.counts = [none, ...legend.counts];
  return {
    sym,
    colourFor: (feature) => {
      const n = counts.get(Number(feature?.properties?.i));
      return Number.isFinite(n) && n > 0 ? colourOf(n, sym) : null;
    },
    legend: { ...legend, field: "season_storms", categorical: false },
  };
}

/**
 * What the bar says under the year, and it says COUNT rather than chance.
 *
 * The number of cells reached is the honest headline for one season: it is a
 * measure of how much of the world a year's storms touched, which is a real
 * quantity, where any per-year "probability" is not.
 */
export function seasonNote(season, counts, drawn, partial) {
  const reached = counts ? counts.size : 0;
  const share = drawn ? Math.round((reached / drawn) * 100) : 0;
  const tail = season === partial ? " — season still in progress" : "";
  return `${season}: storms within 200 km of ${reached.toLocaleString()} of `
    + `${drawn.toLocaleString()} cells (${share}%)${tail}`;
}

if (typeof window !== "undefined") {
  window.GeoIDCycloneRisk = {
    loadYears, countsFor, seasonsIn, climatologyPaint, seasonPaint, seasonNote,
    riskEdges, RETURN_PERIODS_YEARS,
  };
}

/* ── driving the layer on the globe ─────────────────────────────────────── */

/**
 * The risk layer, if somebody has ticked it on.
 *
 * Everything below is a NO-OP without it, and deliberately: the season
 * animation is worth watching on its own, and a driver that loaded a
 * 23 MB map because the play button was pressed would be the app deciding
 * what somebody came for.
 */
export function riskLayer(layers) {
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  return held.find((l) => l.name && /cyclone risk/i.test(l.name)) || null;
}

function announce() {
  window.GeoIDLayerHierarchy?.render?.();
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", {
    detail: { reason: "symbology" },
  }));
}

/**
 * Paint the risk layer as one season's COUNTS.
 *
 * The legend changes with the map, which is the whole point: the climatology's
 * classes are return periods and a season's are numbers of storms, and drawing
 * one under the other's key would be the map telling a reader that a count is
 * a probability. `layer.legendSummary` says it in words as well, because a key
 * headed "Storms within 200 km in 1992" is still read at a glance by somebody
 * who has just been looking at chances.
 */
export async function showSeason(season, { layers = null } = {}) {
  const layer = riskLayer(layers);
  if (!layer?.features?.length) return null;
  const payload = await loadYears();
  const counts = countsFor(payload, season);
  if (!counts) return null;
  const paint = seasonPaint(counts, season, layer.features.length);
  if (!paint) return null;
  layer.repaint?.(paint.colourFor);
  layer.legendInfo = paint.legend;
  layer.legendSummary = seasonNote(
    season, counts, layer.features.length, payload?._source?.partial);
  // The dialog must not reopen proposing to undo this, and it must not claim
  // the layer is wearing a classing of `p_yr` while it is showing a season.
  layer.rangeSpec = null;
  layer.symbologySingle = null;
  announce();
  return { season, reached: counts.size, cells: layer.features.length };
}

/**
 * Back to the climatology, which is what the layer IS when nothing is playing.
 *
 * Restored rather than remembered: a season paint is a temporary reading of a
 * layer whose own subject is the long-run rate, so closing the bar must leave
 * the map saying what its own name says.
 */
export function showClimatology({ layers = null } = {}) {
  const layer = riskLayer(layers);
  if (!layer?.features?.length) return null;
  const paint = climatologyPaint(layer.features);
  if (!paint) return null;
  layer.repaint?.(paint.colourFor);
  layer.legendInfo = paint.legend;
  layer.legendSummary = null;
  announce();
  return { cells: layer.features.length };
}

if (typeof window !== "undefined") {
  Object.assign(window.GeoIDCycloneRisk, { riskLayer, showSeason, showClimatology });
}
