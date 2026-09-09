/**
 * A VOLCANIC RISK CELL, IN WORDS: how often eruptions of a size happen near
 * here. The collective's cells carry every VEI's rate; a frame's cells carry
 * their own band's alone, and the card says which it is reading.
 *
 * The number is said twice, as a return period and a percentage: a reader
 * with one and not the other cannot check the map against the key.
 */
import { BANDS } from "./volcanic-risk.js";

export function isVolcanicRiskFeature(props = {}) {
  return Number.isFinite(Number(props?.p_yr))
    && Number.isFinite(Number(props?.rate_yr))
    && Number.isFinite(Number(props?.deg))
    && Number.isFinite(Number(props?.vei_max));
}

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
export function asPercent(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = n * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  return `${pct.toPrecision(2)}%`;
}

const NEVER = "not once on record";

export function volcanicRiskCard(props = {}, { band = "any", full = false } = {}) {
  const spec = BANDS[band] || BANDS.any;
  const kicker = spec.kicker + (full ? " (full Holocene record)" : " (windowed record)");
  const rate = Number(props.rate_yr);
  const period = returnPeriod(rate);
  const pct = asPercent(props.p_yr);
  const title = period ? `${period}${pct ? ` · ${pct} a year` : ""}` : "Not once on record";
  const rows = [];
  rows.push([spec.vei !== undefined ? `VEI ${spec.vei}, ≥ 1 mm of ash` : "Any eruption, ≥ 1 mm of ash", period || NEVER]);
  // THE COLLECTIVE LISTS EVERY SIZE, largest first: a reader comparing two
  // points wants the profile, not one number.
  for (let v = 8; v >= 0; v -= 1) {
    const r = returnPeriod(props[`vei${v}`]);
    if (r) rows.push([`VEI ${v}`, r]);
  }
  const vmax = Number(props.vei_max);
  if (Number.isFinite(vmax) && (vmax > 0 || rate > 0)) rows.push(["Largest on record reaching here", `VEI ${vmax}`]);
  if (Number(props.prior_only) === 1) {
    rows.push(["Basis", "floor prior only — no dated eruption from any volcano within reach; "
      + "the rate is the least a volcano that demonstrably erupted can be given"]);
  }
  if (Number(props.vents) > 0) rows.push(["Volcanoes within reach", String(Math.round(Number(props.vents)))]);
  const deg = Number(props.deg);
  if (Number.isFinite(deg)) rows.push(["Cell", `${deg}° — about ${Math.round(deg * 111)} km`]);
  return {
    kicker,
    title,
    meta: (full
      ? "every dated eruption back to 9700 BCE, each volcano over its own record span"
      : "each eruption counted over the years its size is recorded")
      + " — the chance of at least 1 mm of ash here",
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
      + "Each eruption counts at a point as the chance its ash reaches that "
      + "far at 1 mm: tephra thins exponentially with distance (Pyle 1989), "
      + "which solved for 1 mm gives a reach per VEI — 5 km at VEI 1, 15 at 2, "
      + "50 at 3, 150 at 4, 350 at 5, 800 at 6, 1,800 at 7 — log-normal about "
      + "it (σ 0.5). Isotropic: a real plume goes downwind. Uncertain eruptions "
      + "count at half weight; every "
      + "catalogue volcano is in, those with no dated eruption at a stated "
      + "floor. The chance is 1 − exp(−rate). A cell is a sampling point — its "
      + "size is how finely the map is drawn there.",
    source: "Global Volcanism Program, Smithsonian Institution — Volcanoes of the World v5.2 (2024), CC BY 4.0",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRiskCard = { isVolcanicRiskFeature, volcanicRiskCard, returnPeriod, asPercent };
}
