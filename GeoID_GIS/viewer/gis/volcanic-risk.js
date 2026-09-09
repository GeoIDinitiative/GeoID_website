/**
 * THE VOLCANIC RISK SCALE — classes and colours for eruptions-per-year, one
 * VEI at a time. Pure: the raster module (`volcanic-risk-raster.js`) draws
 * with it and the card reads with it, so the sheet and its key cannot
 * disagree about where a class begins.
 *
 * THE VALUE IS A RATE OF ONE SIZE OF ERUPTION. The first two versions of this
 * map carried a VEI-scaled reach and a tephra-volume proxy, and both were
 * reported as a mess — a pile of radii with a symbology nobody could read. So
 * a band is "eruptions of VEI n per year near this point", every eruption
 * counted with one kernel scale, and the scale is a RETURN PERIOD on that one
 * quantity. Nothing is derived.
 */

/** Return periods, years. A VEI 7 band lives at the top of this range. */
export const RETURN_PERIODS_YEARS = [100000, 10000, 1000, 250, 100, 25, 5];

/** P = 1 − exp(−1/T): the annual chance the classes are cut on. */
export function riskEdges(periods = RETURN_PERIODS_YEARS) {
  return periods.map((t) => 1 - Math.exp(-1 / t));
}

/** One more than the edges, as classes are. */
export const RISK_LABELS = [
  "rarer than 1 in 100,000 years",
  "about 1 in 100,000 years",
  "about 1 in 10,000 years",
  "about 1 in 1,000 years",
  "about 1 in 250 years",
  "about 1 in 100 years",
  "about 1 in 25 years",
  "more often than 1 in 5 years",
];

/** Which class an annual chance falls in, 0..labels−1; −1 for nothing. */
export function classOf(p, edges = riskEdges()) {
  if (!(p > 0)) return -1;
  let band = 0;
  edges.forEach((edge, i) => { if (p >= edge) band = i + 1; });
  return band;
}

/**
 * The VEI palette, fixed across every map that draws it: a magnitude is an
 * ORDINAL class, so it is painted as a category in order, never ranked by how
 * common it is.
 */
export const VEI_COLOURS = {
  0: "c7d6b4", 1: "a6c48a", 2: "e4d64f", 3: "f5a742", 4: "ee6d2b",
  5: "d63b1f", 6: "9e1a2b", 7: "5c0b3c", 8: "23041f",
};

/** The readings a sheet offers: every VEI number, all of them, and the largest. */
export const VIEWS = {
  any: { band: "any", label: "Any eruption — per year", kicker: "Volcanic risk — any eruption" },
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((v) => [`vei${v}`, {
    band: `vei${v}`, label: `VEI ${v} eruptions — per year`, kicker: `Volcanic risk — VEI ${v}`, vei: v,
  }])),
  vei_max: { band: "vei_max", label: "Largest eruption on record reaching here (VEI)", kicker: "Largest eruption reaching here", categorical: true },
};

export const VIEW_ORDER = ["any", "vei2", "vei3", "vei4", "vei5", "vei6", "vei7", "vei1", "vei0", "vei_max"];

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRiskScale = { RETURN_PERIODS_YEARS, riskEdges, RISK_LABELS, classOf, VEI_COLOURS, VIEWS, VIEW_ORDER };
}
