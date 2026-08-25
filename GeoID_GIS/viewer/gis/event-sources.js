/**
 * What the Events mode can show, as a list you tick.
 *
 * Events began as one feed — NASA EONET — and the mode was built around it:
 * enter, and you get whatever EONET has. That is the wrong shape the moment
 * there is more than one feed worth watching, because the question people
 * actually arrive with is narrower than "everything happening": global
 * seismicity in the last day is a different question from open wildfires, and
 * a mode that answers both at once answers neither well.
 *
 * So a source is a row you switch on. Each one declares where it fetches from,
 * how to turn the answer into the marker shape the mode already draws, and
 * what colour it is. Adding a feed is an entry here and nothing else.
 *
 * `pointsFrom` is pure and tested: the conversions are where a feed's own
 * conventions bite — USGS puts depth in the third coordinate and magnitude in
 * a property, EONET nests the position inside a geometry array whose LAST
 * entry is the current one — and neither is visible from the marker on screen.
 */

/** USGS ships fixed summary feeds; they are cached and far faster than a query. */
const USGS_SUMMARY = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary";

export const SOURCES = [
  {
    id: "eonet",
    label: "Natural events (NASA EONET)",
    note: "wildfires, storms, volcanoes, ice — open events, all categories",
    colour: "#ff6b2c",
    licence: "NASA EONET — public domain",
    kind: "eonet",
    defaultOn: true,
  },
  {
    id: "quakes-day",
    label: "Earthquakes — past 24 hours",
    note: "every M2.5+ worldwide, updated every minute by the USGS",
    colour: "#ffd166",
    licence: "USGS — public domain",
    kind: "usgs",
    url: `${USGS_SUMMARY}/2.5_day.geojson`,
    defaultOn: true,
  },
  {
    id: "quakes-week",
    label: "Earthquakes — past 7 days",
    note: "M4.5+ worldwide, the week at a glance",
    colour: "#f0803c",
    licence: "USGS — public domain",
    kind: "usgs",
    url: `${USGS_SUMMARY}/4.5_week.geojson`,
  },
  {
    id: "quakes-significant",
    label: "Significant earthquakes — past month",
    note: "the ones that mattered, by the USGS's own significance score",
    colour: "#ff2bd6",
    licence: "USGS — public domain",
    kind: "usgs",
    url: `${USGS_SUMMARY}/significant_month.geojson`,
  },
];

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;

/**
 * A USGS summary feed to the marker shape the mode draws.
 *
 * Three things this has to get right, none of them visible afterwards:
 *
 * - **Coordinates are [lon, lat, DEPTH_KM]**, and the depth is the third
 *   element rather than a property. Reading `coordinates[2]` as an elevation,
 *   or ignoring it, loses the one number that separates a shallow destructive
 *   event from a deep harmless one at the same magnitude.
 * - **`properties.time` is epoch MILLISECONDS**, not seconds. Off by a factor
 *   of a thousand puts every earthquake in 1970, and a list sorted by it looks
 *   fine because they are all wrong together.
 * - **A feed carries events with a null magnitude.** Those are real records
 *   with an undetermined size, and printing "M null" is worse than saying so.
 */
export function usgsPoints(payload, source) {
  return (payload?.features || []).map((f) => {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    const p = f.properties || {};
    const mag = Number.isFinite(p.mag) ? p.mag : null;
    const depth = Number.isFinite(c[2]) ? c[2] : null;
    return {
      id: f.id || `${source.id}:${p.time}:${c[0]},${c[1]}`,
      title: p.title || p.place || "Earthquake",
      link: p.url || null,
      sourceId: source.id,
      categoryId: "earthquakes",
      categoryTitle: "Earthquakes",
      lat: c[1],
      lon: c[0],
      magnitude: mag,
      depthKm: depth,
      timeMs: Number.isFinite(p.time) ? p.time : null,
      place: p.place || null,
      felt: Number.isFinite(p.felt) ? p.felt : null,
      tsunami: p.tsunami === 1,
      detail: [
        mag != null ? `M ${mag.toFixed(1)}` : "magnitude undetermined",
        depth != null ? `${depth.toFixed(0)} km deep` : null,
        p.place || null,
      ].filter(Boolean).join(" · "),
    };
  }).filter(Boolean);
}

/**
 * How big a marker an earthquake earns.
 *
 * Magnitude is logarithmic and the marker is not, so plotting the number
 * directly makes an M7 look barely larger than an M4 while releasing about
 * 30,000 times the energy. Scaled so the size roughly tracks the felt effect
 * rather than the number, floored so an M2 is still clickable and capped so an
 * M9 does not cover the country it happened in.
 */
export function magnitudeSize(magnitude, base = 6) {
  if (!Number.isFinite(magnitude)) return base;
  return Math.max(base, Math.min(base * 4, base * (0.55 + 0.22 * magnitude)));
}

/**
 * Recent is brighter.
 *
 * A day of earthquakes drawn identically is a map of where faults are, which
 * is a fact you already have from the fault layer. What the feed adds is WHEN,
 * so the last few hours read at full strength and the rest fade back — the
 * difference between a catalogue and a live view.
 */
export function recencyOpacity(timeMs, nowMs = Date.now(), windowMs = 24 * 3600 * 1000) {
  if (!Number.isFinite(timeMs)) return 0.75;
  const age = Math.max(0, nowMs - timeMs);
  if (age >= windowMs) return 0.4;
  return 0.4 + 0.6 * (1 - age / windowMs);
}
