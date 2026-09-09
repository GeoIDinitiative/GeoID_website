/**
 * THE VOLCANIC RISK SCALE, and the grids it colours.
 *
 * A cell's value is ERUPTIONS OF ONE SIZE PER YEAR DEPOSITING AT LEAST 1 MM
 * OF ASH at a point. Each eruption counts at a point as the chance its ash
 * reaches that far — Pyle's exponential thinning solved for 1 mm gives a
 * reach per VEI (5 km at VEI 1 to 1,800 at VEI 7), log-normal about it — so
 * the extent IS the magnitude. Eight VEI grids and the collective play
 * through the time-lapse bar with the VEI in place of the date
 * (`volcanic-risk-frames.js`); this module is the scale they share, so no two
 * frames can disagree about where a class begins.
 *
 * A single 100 km kernel for every size was tried and rejected: on a per-VEI
 * frame every eruption shares a size, so a reach that is the eruption's own
 * is exactly right there, and the collective sums smooth curves rather than
 * nested rings.
 */

/** Return periods, years. The VEI 6 and 7 grids live at the top of this range. */
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

/**
 * THE "NONE ON RECORD" CLASS, drawn rather than left out. A cell no eruption's
 * ash reaches is an answer, and the app's no-value grey means NOT MEASURED --
 * so it has a colour of its own, named in every key, leading.
 */
export const NONE_COLOUR = "2f3b46";
export const NONE_LABEL = "no eruption's ash on record — not drawn";

/** Which class an annual chance falls in, 0..labels−1; −1 for nothing. */
export function classOf(p, edges = riskEdges()) {
  if (!(p > 0)) return -1;
  let band = 0;
  edges.forEach((edge, i) => { if (p >= edge) band = i + 1; });
  return band;
}

/**
 * The frames the bar steps through, and the collective that ends them. No
 * Holocene eruption reached VEI 8 (Toba, 74,000 years ago, is Pleistocene),
 * so that frame is the Quaternary background rate over the known vents.
 */
export const FRAME_VEIS = [1, 2, 3, 4, 5, 6, 7, 8];

export const BANDS = {
  any: { label: "Ashfall ≥ 1 mm from any eruption — per year", kicker: "Volcanic risk — any eruption" },
  ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((v) => [`vei${v}`, {
    label: `Ashfall ≥ 1 mm from VEI ${v} eruptions — per year`, kicker: `Volcanic risk — VEI ${v}`, vei: v,
  }])),
  // The Holocene has no VEI 8, so its map is a QUATERNARY BACKGROUND: one
  // global rate (Rougier et al. 2018, about one per 17,000 years) spread over
  // the known supereruption vents. Labelled as such everywhere it appears.
  vei8: {
    label: "Ashfall ≥ 1 mm from VEI 8 eruptions — per year (Quaternary background)",
    kicker: "Volcanic risk — VEI 8, Quaternary background", vei: 8, background: true,
  },
};

/** The two records, keyed by dataset id, and where each one's files live. */
export const RECORDS = {
  "volcanic-risk": { path: "/data/global/volcanic-risk", name: /volcanic risk \(windowed record/i, full: false },
  "volcanic-risk-holocene": { path: "/data/global/volcanic-risk-holocene", name: /volcanic risk \(full Holocene record/i, full: true },
};

/** The catalogue's paint for a grid: `p_yr` on the shared scale. */
export function colourRange(band = "any") {
  return { field: "p_yr", edges: riskEdges(), labels: RISK_LABELS, legendLabel: BANDS[band].label, ramp: "risk" };
}

/** The layer of one record, if it is on the globe. */
export function riskLayer(id, layers = null) {
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  const spec = RECORDS[id];
  return spec ? held.find((l) => l.name && spec.name.test(l.name)) || null : null;
}

/**
 * Which record and which band a clicked cell belongs to, by feature identity:
 * the collective's cells live on the catalogue layer, a frame's on the plot,
 * and the plot says which VEI it is showing.
 */
export function bandOf(props, layers = null) {
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  for (const layer of held) {
    if (!layer?.features?.some?.((f) => f?.properties === props)) continue;
    const id = Object.keys(RECORDS).find((k) => RECORDS[k].name.test(layer.name || ""))
      || layer.riskRecord || layer.volcanicRecord || "volcanic-risk";
    return { id, band: layer.riskBand || layer.volcanicBand || "any", full: Boolean(RECORDS[id]?.full) };
  }
  return { id: "volcanic-risk", band: "any", full: false };
}

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRisk = {
    RETURN_PERIODS_YEARS, riskEdges, RISK_LABELS, classOf, FRAME_VEIS, BANDS, RECORDS,
    colourRange, riskLayer, bandOf,
  };
}
