/**
 * A RISK CELL IS NOT A ROCK, AND THE NUMBER IS THE HEADLINE.
 *
 * Clicked, one of these opened the ordinary geology card: kicked off with
 * "OCEANIC" — `crustalSetting` answering from the elevation about a cell that
 * is not crust at all — titled "Mapped area", and with the one thing anybody
 * clicked for, the chance itself, four rows down among `p_yr` and `rate_yr`
 * and `i`. Column names, in a card, under a heading about the sea floor.
 *
 * So the three lines are written here: what it is, the chance in words, and
 * the ground it covers. The same shape `ice-card.js` and `soil-card.js` take,
 * and for the same reason each of those exists.
 *
 * THE NUMBER IS SAID TWICE ON PURPOSE, as a return period and as a percentage.
 * "1 in 13 years" is how a hazard is quoted and how anybody weighs it; "7.3% a
 * year" is what the map is actually coloured by, and the two are the same fact
 * — a reader who has one and not the other cannot check the map against the
 * key.
 */

const KM2 = " km²";

/** A cell from the cyclone risk grid, which nothing else on the globe has. */
export function isRiskFeature(props = {}) {
  return Number.isFinite(Number(props?.p_yr))
    && Number.isFinite(Number(props?.rate_yr))
    && Number.isFinite(Number(props?.deg));
}

/** "1 in 13 years", or "3 a year" once it happens more often than annually. */
export function returnPeriod(ratePerYear) {
  const rate = Number(ratePerYear);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (rate >= 2) return `${rate.toFixed(1)} a year`;
  const years = 1 / rate;
  if (years < 1.5) return "about one a year";
  return `1 in ${years < 10 ? years.toFixed(1) : Math.round(years)} years`;
}

/** The chance as a percentage, at a precision the number can carry. */
export function asPercent(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = n * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

export function riskCard(props = {}, { view = "storms" } = {}) {
  const hurricane = view === "hurricanes";
  const rate = Number(hurricane ? props.rate_hur_yr : props.rate_yr);
  const chance = Number(hurricane ? props.p_hur_yr : props.p_yr);
  const period = returnPeriod(rate);
  const pct = asPercent(chance);

  /**
   * GROUND WHERE IT HAS NEVER HAPPENED SAYS SO, rather than showing a zero.
   * "0.0" is a measurement; "not once in the record" is what the file holds,
   * and the difference matters most on exactly the cells a reader is checking
   * because they were surprised.
   */
  const never = !(rate > 0);
  const kicker = hurricane ? "Hurricane risk" : "Tropical cyclone risk";
  const title = never
    ? "Not once on record"
    : `${period}${pct ? ` · ${pct} a year` : ""}`;

  const rows = [];
  rows.push([hurricane ? "Hurricane-force passage" : "A cyclone passes",
    never ? "not once in the record" : `${rate.toFixed(2)} a year on average`]);
  // BOTH readings, whichever is being shown: the cell carries them, and the
  // one not on screen is the obvious next question.
  const other = hurricane
    ? ["Any tropical cyclone", returnPeriod(props.rate_yr) || "not once in the record"]
    : ["At hurricane force", returnPeriod(props.rate_hur_yr) || "not once in the record"];
  rows.push(other);
  // The cell's SIZE, because the grid is variable and a reader comparing two
  // cells is entitled to know they are not the same patch of ground.
  const deg = Number(props.deg);
  if (Number.isFinite(deg)) {
    rows.push(["Cell", `${deg}° — about ${Math.round(deg * 111)} km`]);
  }

  return {
    kicker,
    title,
    // WHAT THE NUMBER IS, in one line, because a chance with no radius and no
    // window is not a chance. 200 km and the window are the definition.
    meta: "within 200 km, over the complete seasons 1980–2025",
    headline: rows,
    note: "Counted once per storm per cell from IBTrACS; the chance is "
      + "1 − exp(−rate), the Poisson form. A cell is a sampling "
      + "point — its size is how finely the map is drawn there, not what "
      + "was measured.",
    source: "IBTrACS v04r01, NOAA NCEI — Knapp et al. (2010)",
  };
}

if (typeof window !== "undefined") {
  window.GeoIDCycloneRiskCard = { isRiskFeature, riskCard, returnPeriod, asPercent };
}
