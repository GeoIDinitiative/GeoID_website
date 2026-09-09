/**
 * A VOLCANIC RISK CELL, IN WORDS: the chance, the size, and who is behind it.
 *
 * The cyclone risk card exists because a cell opened the geology card headed
 * "OCEANIC" with its number four rows down as `p_yr`. This grid carries the
 * same three columns and would have opened the same card -- or, worse, the
 * CYCLONE card, which recognises its cells by exactly those columns and would
 * have called a volcano's ashfall a tropical cyclone. So this one is checked
 * first, on the column only this grid has (`vei_max`), and says what a
 * volcanic risk is made of: how often, how big, and from where.
 *
 * THE NUMBER IS SAID TWICE, as a return period and a percentage, for the
 * cyclone card's reason: a reader with one and not the other cannot check the
 * map against the key.
 */

/** A cell from the volcanic risk grid: the risk columns AND the magnitude. */
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
  return `${pct.toFixed(2)}%`;
}

const NEVER = "not once on record";

/** "83 million m³ a year", at three figures. */
export function asVolume(m3) {
  const n = Number(m3);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return `${(n / 1e9).toPrecision(3).replace(/\.?0+$/, "")} billion m³ a year`;
  if (n >= 1e6) return `${(n / 1e6).toPrecision(3).replace(/\.?0+$/, "")} million m³ a year`;
  return `${Math.round(n).toLocaleString()} m³ a year`;
}

export function volcanicRiskCard(props = {}, { view = "ashfall", full = false } = {}) {
  const large = view === "large";
  const tephra = view === "tephra";
  const volume = asVolume(props.tephra_m3_yr);
  const rate = Number(large ? props.rate_large_yr : props.rate_yr);
  const chance = Number(large ? props.p_large_yr : props.p_yr);
  const period = returnPeriod(rate);
  const pct = asPercent(chance);
  const vei = Number(props.vei_max);
  const never = !(rate > 0);

  const kicker = (view === "magnitude" ? "Largest eruption reaching here"
    : tephra ? "Volcanic risk — magnitude × frequency"
      : large ? "Volcanic risk — large eruptions" : "Volcanic ashfall risk")
    + (full ? " (full Holocene record)" : "");
  const title = view === "magnitude"
    ? (Number.isFinite(vei) ? `VEI ${vei} on record` : "No eruption on record")
    : tephra ? (volume || "No tephra on record")
      : never ? "Not once on record" : `${period}${pct ? ` · ${pct} a year` : ""}`;

  const rows = [];
  if (volume && !tephra) rows.push(["Tephra reaching here", volume]);
  rows.push(["Ash from any eruption",
    returnPeriod(props.rate_yr) || NEVER]);
  rows.push(["From a large eruption (VEI 4+)",
    returnPeriod(props.rate_large_yr) || NEVER]);
  if (Number.isFinite(vei)) rows.push(["Largest on record reaching here", `VEI ${vei}`]);
  if (Number.isFinite(Number(props.vei_mean)) && Number(props.vei_mean) > 0) {
    rows.push(["Typical eruption reaching here", `VEI ${Number(props.vei_mean).toFixed(1)} (rate-weighted mean)`]);
  }
  /**
   * WHO IS BEHIND IT. A rate at a point is the sum over every volcano whose
   * reach covers it; the one contributing most is the one a reader will look
   * for on the map, and its own count is how the rate was made.
   */
  if (props.top_volcano) {
    const bits = [];
    if (Number.isFinite(Number(props.top_eruptions))) {
      bits.push(`${Number(props.top_eruptions).toLocaleString()} counted eruption${Number(props.top_eruptions) === 1 ? "" : "s"}`);
    }
    if (Number.isFinite(Number(props.top_vei_max))) bits.push(`up to VEI ${props.top_vei_max}`);
    const tr = returnPeriod(props.top_rate_yr);
    if (tr) bits.push(tr);
    rows.push(["Contributing most", `${props.top_volcano}${bits.length ? ` — ${bits.join(", ")}` : ""}`]);
  }
  if (Number.isFinite(Number(props.vents)) && Number(props.vents) > 0) {
    rows.push(["Volcanoes reaching here", String(props.vents)]);
  }
  const deg = Number(props.deg);
  if (Number.isFinite(deg)) rows.push(["Cell", `${deg}° — about ${Math.round(deg * 111)} km`]);

  return {
    kicker,
    title,
    meta: full
      ? "every confirmed eruption back to 9700 BCE, each volcano's frequency over its own record span"
      : "ash reaching this point, each eruption counted over the years its size is recorded",
    headline: rows,
    note: (full
      ? "Every confirmed, dated eruption in the Smithsonian Holocene catalogue, "
        + "active or not, with no completeness windows: each volcano's rate is "
        + "its eruptions over the span from its first recorded eruption to 2025. "
        + "A volcano with a short written record is measured as if it began "
        + "when somebody started writing, which overstates it against one known "
        + "from tephra alone. Tephra is a decade per VEI step (VEI 2 ≈ 3 million "
        + "m³), summed at each eruption's rate — magnitude × frequency. "
      : "Confirmed, dated eruptions from the Smithsonian catalogue, counted "
        + "over the window in which eruptions of their size are recorded: VEI "
        + "≤ 3 since 1950, VEI 4 since 1900, VEI 5–6 since 1550, VEI 7+ the "
        + "whole Holocene. ")
      + "Each eruption is given a schematic, isotropic reach by VEI (5 km at "
      + "VEI 0–1 to 1,000 km at VEI 7); ash falls in a wind-driven plume, not "
      + "a circle. The chance is 1 − exp(−rate). A cell is a sampling point — "
      + "its size is how finely the map is drawn there.",
    source: "Global Volcanism Program, Smithsonian Institution — Volcanoes of the World v5",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRiskCard = { isVolcanicRiskFeature, volcanicRiskCard, returnPeriod, asPercent, asVolume };
}
