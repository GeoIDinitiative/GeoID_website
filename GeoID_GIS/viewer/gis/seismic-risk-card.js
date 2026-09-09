/**
 * A SEISMIC RISK CELL, IN WORDS: how often each magnitude shakes here.
 * The collective's cells carry every band's rate; a frame's carry their own.
 */
import { BANDS } from "./seismic-bands.js";
import { returnPeriod, asPercent } from "./volcanic-risk-card.js";

export function isSeismicRiskFeature(props = {}) {
  return Number.isFinite(Number(props?.p_yr))
    && Number.isFinite(Number(props?.rate_yr))
    && Number.isFinite(Number(props?.deg))
    && Number.isFinite(Number(props?.mag_max));
}

const NEVER = "not once on record";

export function seismicRiskCard(props = {}, { band = "any" } = {}) {
  const spec = BANDS[band] || BANDS.any;
  const rate = Number(props.rate_yr);
  const period = returnPeriod(rate);
  const pct = asPercent(props.p_yr);
  const title = period ? `${period}${pct ? ` · ${pct} a year` : ""}`
    : (Number(props.none) === 1 ? "No earthquake's shaking on record here" : "Not once on record");
  const rows = [];
  rows.push([spec.lo ? `M ${spec.lo}${spec.lo === 8 ? "+" : `–${spec.lo}.9`}, shaking ≈ MMI VI` : "Any earthquake M ≥ 5, shaking ≈ MMI VI", period || NEVER]);
  for (const b of ["m8", "m7", "m6", "m5"]) {
    const r = returnPeriod(props[b]);
    if (r) rows.push([b === "m8" ? "M 8+" : `M ${b[1]}–${b[1]}.9`, r]);
  }
  const mm = Number(props.mag_max);
  if (Number.isFinite(mm) && mm > 0) rows.push(["Largest on record shaking here", `M ${mm.toFixed(1)}`]);
  if (Number(props.quakes) > 0) rows.push(["Earthquakes within reach", Number(props.quakes).toLocaleString()]);
  const deg = Number(props.deg);
  if (Number.isFinite(deg)) rows.push(["Cell", `${deg}° — about ${Math.round(deg * 111)} km`]);
  return {
    kicker: spec.kicker + " (USGS ComCat, M ≥ 5 since 1900)",
    title,
    meta: "the chance of damaging shaking (about MMI VI) here, each size counted over the years it is recorded",
    headline: rows,
    note: "Every M ≥ 5 earthquake in USGS ComCat since 1900 — M5 counted since 1964, M6 since 1930, "
      + "M7 and M8 since 1900, the years each is recorded globally. Each event counts at a point as "
      + "the chance its damaging radius reaches that far: log₁₀(R km) = 0.5 M − 1.7 (about 20 km at "
      + "M5, 200 at M7, 630 at M8), log-normal about it (σ 0.4). Isotropic and depth-blind: attenuation "
      + "differs by region and depth, and a proper hazard map (GEM, PSHA) uses site ground-motion "
      + "models and fault sources. The chance is 1 − exp(−rate). A cell is a sampling point — its size "
      + "is how finely the map is drawn there.",
    source: "U.S. Geological Survey, ANSS Comprehensive Earthquake Catalog (ComCat) — doi:10.5066/F7MS3QZH",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDSeismicRiskCard = { isSeismicRiskFeature, seismicRiskCard };
}
