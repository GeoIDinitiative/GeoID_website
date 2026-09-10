/**
 * AN EARTHQUAKE, IN WORDS: the magnitude and the year, first.
 *
 * The fifth card in this tree to write its own lines, and it exists for the
 * reason the other four do. The record is an ordinary vector point layer, so a
 * click on it opened the generic card: headed **CONTINENTAL** -- the crust
 * classifier answering from the ELEVATION about a hypocentre -- and titled
 * **Mapped point**, which is the geometry noun and true of every point on the
 * globe. The one thing anybody clicks an earthquake for was folded away under
 * Attributes as `mag_best`.
 *
 * So: the magnitude and the year are the TITLE, the place is the line under
 * it, and everything else is a row. Nothing here is derived -- every value is
 * one the bake carried -- which is why this file is a formatter and holds no
 * arithmetic worth testing beyond the shapes it refuses.
 */

/**
 * Recognised by `mag_best`, which only this bake writes.
 *
 * Deliberately not `mag`: the live USGS feed carries that too, and its events
 * have their own card with a seismogram on it. The risk CELLS carry `mag_max`
 * and none of these, so the two cannot be confused either.
 */
export function isEarthquakeFeature(props = {}) {
  return Number.isFinite(Number(props?.mag_best))
    && (props?.id != null || Number.isFinite(Number(props?.time)) || Number.isFinite(Number(props?.year)));
}

const UTC_DATE = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };
const UTC_TIME = { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", hour12: false };

/** The year, from whichever of the two the record carried. */
export function yearOf(props = {}) {
  const y = Number(props?.year);
  if (Number.isFinite(y)) return y;
  const t = Number(props?.time);
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
}

/** "M 7.9", at the precision the number is worth — one decimal, never two. */
export function magnitudeText(props = {}) {
  const m = Number(props?.mag_best);
  return Number.isFinite(m) ? `M ${m.toFixed(1)}` : null;
}

export function earthquakeCard(props = {}) {
  const year = yearOf(props);
  const mag = magnitudeText(props);
  const historical = Number(props.historical) === 1;
  const t = Number(props.time);
  const when = Number.isFinite(t) ? new Date(t) : null;

  const rows = [];
  /**
   * THE DATE, AND NO CLOCK ON A HISTORICAL ONE. GEM's catalogue gives a year
   * and often a month and day; where its source gave neither, the bake wrote
   * the first of January, so printing "00:00:00" against a 1008 event would be
   * a time nobody recorded dressed as a reading.
   */
  if (when) {
    rows.push(["When", historical
      ? `${when.toLocaleDateString("en-GB", UTC_DATE)} — as the historical record gives it`
      : `${when.toLocaleDateString("en-GB", UTC_DATE)}, ${when.toLocaleTimeString("en-GB", UTC_TIME)} UTC`]);
  } else if (year != null) {
    rows.push(["When", String(year)]);
  }

  /**
   * WHICH MAGNITUDE IS BEING SHOWN, and both where they differ.
   *
   * About 82% of modern ComCat at this threshold is body-wave mb, which
   * saturates near 6 and reads low against Mw — so the map is drawn on
   * ISC-GEM's homogenised Mw wherever that catalogue reaches. A card that
   * showed one number without saying which scale it is on would be hiding the
   * single most consequential thing about this record.
   */
  const mw = Number(props.mw);
  const preferred = Number(props.mag);
  const type = String(props.magType || "").trim();
  if (Number.isFinite(mw)) {
    rows.push(["Magnitude", `Mw ${mw.toFixed(2)} — ISC-GEM, recomputed from the original station bulletins`]);
    if (Number.isFinite(preferred) && Math.abs(preferred - mw) >= 0.05) {
      rows.push(["ComCat's own", `${preferred.toFixed(1)}${type ? ` ${type}` : ""}`]);
    }
  } else if (Number.isFinite(preferred)) {
    rows.push(["Magnitude", `${preferred.toFixed(1)}${type ? ` ${type}` : ""}${
      /^mb/i.test(type) ? " — a body-wave magnitude, which saturates near 6 and reads low against Mw" : ""}`]);
  }

  const depth = Number(props.depth_km);
  if (Number.isFinite(depth)) {
    rows.push(["Depth", `${depth.toFixed(1)} km${depth <= 70 ? " — shallow" : depth < 300 ? " — intermediate" : " — deep"}`]);
  }

  rows.push(["Catalogue", historical
    ? "GEM Global Historical Earthquake Catalogue v1.0 (1008–1903)"
    : Number.isFinite(mw)
      ? "USGS ComCat, with ISC-GEM's homogenised magnitude joined on"
      : "USGS ComCat (ANSS Comprehensive Earthquake Catalog)"]);
  if (props.id) rows.push(["Event id", String(props.id)]);

  return {
    kicker: historical ? "HISTORICAL EARTHQUAKE" : "EARTHQUAKE",
    // The magnitude and the year, which is what the click was for.
    title: [mag, year != null ? String(year) : null].filter(Boolean).join(" — ") || "Earthquake",
    meta: String(props.place || "").trim() || null,
    headline: rows,
    note: historical
      ? "From GEM's historical catalogue: the large events (about M ≥ 7) that are known about across "
        + "nine centuries, not a complete record of the period, and its magnitudes are not "
        + "homogenised — Mw, Ms and Mjma sit in one column. It plays in the timeline and is held out "
        + "of the hazard rates, which need a complete window."
      : "From the merged record: every M ≥ 4.5 in USGS ComCat since 1900, with ISC-GEM's homogenised "
        + "Mw joined on for 1904–2021 by ComCat's own contributing ids. The map is drawn on that Mw "
        + "wherever it reaches.",
    source: historical
      ? "GEM Foundation (2013), GEM Global Historical Earthquake Catalogue v1.0, "
        + "doi:10.13127/ghea/ghec.1.0 — CC BY-SA 3.0"
      : "U.S. Geological Survey, ANSS Comprehensive Earthquake Catalog (ComCat), "
        + "doi:10.5066/F7MS3QZH — public domain"
        + (Number.isFinite(mw)
          ? " · International Seismological Centre (2025), ISC-GEM Earthquake Catalogue, "
            + "doi:10.31905/d808b825 — CC BY-SA 3.0"
          : ""),
  };
}

if (typeof window !== "undefined") {
  window.GeoIDEarthquakeCard = { isEarthquakeFeature, earthquakeCard, yearOf, magnitudeText };
}
