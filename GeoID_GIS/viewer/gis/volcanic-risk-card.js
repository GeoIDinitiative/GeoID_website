/**
 * A VOLCANIC RISK POINT, IN WORDS: how often each size of eruption happens
 * near here. Pure; the raster module raises it in the viewer's own card.
 *
 * The number is said twice, as a return period and a percentage: a reader
 * with one and not the other cannot check the map against the key.
 */
import { VIEWS } from "./volcanic-risk.js";

/** "1 in 476 years", "about one a year", or "3.0 a year". */
export function returnPeriod(ratePerYear) {
  const rate = Number(ratePerYear);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (rate >= 2) return `${rate.toFixed(1)} a year`;
  const years = 1 / rate;
  if (years < 1.5) return "about one a year";
  return `1 in ${years < 10 ? years.toFixed(1) : Math.round(years).toLocaleString()} years`;
}

/** The chance as a percentage, at a precision the number can carry. */
export function asPercent(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = (1 - Math.exp(-n)) * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  return `${pct.toPrecision(2)}%`;
}

const NEVER = "not once on record";

/**
 * `sample` is one point's bands: { any, vei0..vei7, vei_max, vents, prior_only }.
 * `view` is the reading on screen; `full` says which record the sheet is.
 */
export function volcanicRiskCard(sample = {}, { view = "any", full = false } = {}) {
  const spec = VIEWS[view] || VIEWS.any;
  const kicker = spec.kicker + (full ? " (full Holocene record)" : " (windowed record)");
  const vmax = Number(sample.vei_max);
  let title;
  if (spec.categorical) {
    title = vmax > 0 || Number(sample.any) > 0 ? `VEI ${vmax} on record` : "No eruption on record";
  } else {
    const rate = Number(sample[spec.band]);
    const period = returnPeriod(rate);
    const pct = asPercent(rate);
    title = period ? `${period}${pct ? ` · ${pct} a year` : ""}` : "Not once on record";
  }
  const rows = [];
  rows.push(["Any eruption", returnPeriod(sample.any) || NEVER]);
  // EVERY SIZE, each on its own line: this is the map's whole content and a
  // reader comparing two points wants the profile, not one number.
  for (let v = 7; v >= 0; v -= 1) {
    const r = returnPeriod(sample[`vei${v}`]);
    if (r) rows.push([`VEI ${v}`, r]);
  }
  if (vmax > 0 || Number(sample.any) > 0) rows.push(["Largest on record reaching here", `VEI ${vmax}`]);
  if (Number(sample.prior_only) === 1) {
    rows.push(["Basis", "floor prior only — no dated eruption from any volcano within reach; "
      + "the rate is the least a volcano that demonstrably erupted can be given"]);
  }
  if (Number(sample.vents) > 0) rows.push(["Volcanoes within reach", String(Math.round(Number(sample.vents)))]);
  return {
    kicker,
    title,
    meta: full
      ? "every dated eruption back to 9700 BCE, each volcano over its own record span; within about 100 km, thinning to 400"
      : "each eruption counted over the years its size is recorded; within about 100 km, thinning to 400",
    headline: rows,
    note: (full
      ? "Every dated eruption in the Smithsonian Holocene catalogue, active or "
        + "not, with no completeness windows: a volcano's rate is its eruptions "
        + "over the span from its first recorded eruption to 2025, which "
        + "overstates one with a short written record against one known from "
        + "tephra alone. "
      : "Eruptions counted over the window in which their size is recorded: "
        + "VEI ≤ 3 since 1950, VEI 4 since 1900, VEI 5–6 since 1550, VEI 7+ the "
        + "whole Holocene. ")
      + "Every eruption counts exp(−d/100 km) of itself at distance d, dropped "
      + "past 400 km, whatever its size — size is which band it falls in, not "
      + "how far it reaches. Uncertain eruptions count at half weight; every "
      + "catalogue volcano is in, those with no dated eruption at a stated "
      + "floor. The chance is 1 − exp(−rate).",
    source: "Global Volcanism Program, Smithsonian Institution — Volcanoes of the World v5.2 (2024), CC BY 4.0",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRiskCard = { volcanicRiskCard, returnPeriod, asPercent };
}
