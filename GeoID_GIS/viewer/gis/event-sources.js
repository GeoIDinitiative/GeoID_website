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
 * So a source is a row you switch on, and the rows are **grouped by subject**
 * — seismicity, fire, ice, storms — because that is how somebody arrives at
 * them. Seventeen tick boxes in one column is a list to be read; six named
 * subsections with a master toggle each is a thing to be used, and it is the
 * same shape the Geology tab uses for the same reason.
 *
 * Three kinds of source, and the difference matters downstream:
 *
 *   eonet   one EONET category, fetched per category (see `events.js` for why
 *           one request cannot show the world)
 *   usgs    a fixed USGS summary feed, converted by `usgsPoints`
 *   layer   NOT an event at all — a catalogue layer from `global-data.js`.
 *           Faults are here because seismicity is read against them: a week of
 *           earthquakes is a scatter until the faults are underneath it. It is
 *           an ordinary layer with its own row in the layer box, so its tick
 *           follows the globe rather than a stored preference.
 *
 * `usgsPoints` is pure and tested: the conversions are where a feed's own
 * conventions bite — USGS puts depth in the third coordinate and magnitude in
 * a property, EONET nests the position inside a geometry array whose LAST
 * entry is the current one — and neither is visible from the marker on screen.
 */

/** USGS ships fixed summary feeds; they are cached and far faster than a query. */
const USGS_SUMMARY = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary";

/**
 * The subsections, in the order they are drawn.
 *
 * Seismicity first because it is the one most people come for, and structure
 * last because it is context for everything above it rather than a subject of
 * its own.
 */
export const FEED_GROUPS = [
  { id: "seismic", label: "Seismicity", note: "where the ground moved, and how hard" },
  { id: "structure", label: "Tectonic structure", note: "the faults and plate edges it moved on" },
  { id: "volcanic", label: "Volcanic activity", note: "eruptions and unrest reported now" },
  { id: "fire", label: "Wildfires", note: "open fire incidents worldwide" },
  { id: "ice", label: "Ice and snow", note: "icebergs, sea and lake ice, snow events" },
  { id: "water", label: "Storms and water", note: "storms, floods and water quality" },
  { id: "land", label: "Land and climate", note: "landslides, drought, dust, heat" },
];

/** An EONET category as a source row. */
const eonet = (category, group, label, note, defaultOn = true) => ({
  id: `eonet-${category}`,
  kind: "eonet",
  category,
  group,
  label,
  note,
  licence: "NASA EONET — public domain",
  defaultOn,
});

export const SOURCES = [
  /* ── seismicity ───────────────────────────────────────────────────────── */
  {
    id: "quakes-day",
    kind: "usgs",
    category: "earthquakes",
    group: "seismic",
    label: "Earthquakes — past 24 hours",
    note: "every M2.5+ worldwide, updated every minute by the USGS",
    licence: "USGS — public domain",
    url: `${USGS_SUMMARY}/2.5_day.geojson`,
    defaultOn: true,
  },
  {
    id: "quakes-week",
    kind: "usgs",
    category: "earthquakes",
    group: "seismic",
    label: "Earthquakes — past 7 days",
    note: "M4.5+ worldwide, the week at a glance",
    licence: "USGS — public domain",
    url: `${USGS_SUMMARY}/4.5_week.geojson`,
  },
  {
    id: "quakes-significant",
    kind: "usgs",
    category: "earthquakes",
    group: "seismic",
    label: "Significant earthquakes — past month",
    note: "the ones that mattered, by the USGS's own significance score",
    licence: "USGS — public domain",
    url: `${USGS_SUMMARY}/significant_month.geojson`,
  },

  /* ── structure ────────────────────────────────────────────────────────── */
  {
    id: "faults",
    kind: "layer",
    dataset: "active-faults",
    group: "structure",
    label: "Active faults — global (GEM)",
    note: "13,696 faults with slip type, rate and dip where known — the lines "
      + "the earthquakes above are on",
    licence: "GEM Global Active Faults — CC BY-SA 4.0",
    colour: "#ff8a5c",
  },
  {
    id: "plates",
    kind: "layer",
    dataset: "plate-boundaries",
    group: "structure",
    label: "Plate boundaries (Bird 2003)",
    note: "241 boundary segments, named by the two plates they separate",
    licence: "Bird (2003), PB2002 — cite the paper",
    colour: "#52e4e8",
  },

  /* ── the EONET categories ─────────────────────────────────────────────── */
  eonet("volcanoes", "volcanic", "Volcanic activity (EONET)",
    "eruptions and unrest currently reported open"),
  eonet("wildfires", "fire", "Wildfires (EONET)",
    "sampled by region — the open list is 98% North American without it"),
  eonet("seaLakeIce", "ice", "Sea and lake ice (EONET)",
    "icebergs and ice extent events"),
  eonet("snow", "ice", "Snow (EONET)", "heavy snow and blizzard events"),
  eonet("severeStorms", "water", "Severe storms (EONET)",
    "named cyclones, hurricanes and typhoons, with their tracks"),
  eonet("floods", "water", "Floods (EONET)", "flooding currently reported open"),
  eonet("waterColor", "water", "Water colour (EONET)",
    "algal blooms and sediment plumes"),
  eonet("landslides", "land", "Landslides (EONET)", "slope failures reported open"),
  eonet("drought", "land", "Drought (EONET)", "drought areas currently declared"),
  eonet("dustHaze", "land", "Dust and haze (EONET)", "dust storms and haze events"),
  eonet("tempExtremes", "land", "Temperature extremes (EONET)",
    "heat and cold events"),
  eonet("manmade", "land", "Manmade (EONET)", "spills, explosions and other incidents"),
];

/**
 * EONET's `earthquakes` category is deliberately NOT here.
 *
 * It exists and it is nearly always empty, because EONET curates events by
 * hand while the USGS publishes every located earthquake within the minute.
 * Offering both would put two rows under Seismicity, one of which almost never
 * draws anything and the other of which is the actual catalogue — and where it
 * did draw, it would double the same earthquake under a different id.
 */

export const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;

/** The rows in one subsection, in the order they were declared. */
export const sourcesInGroup = (groupId) => SOURCES.filter((s) => s.group === groupId);

/** Only the groups that have rows — a group defined and never filled is a bug. */
export const activeGroups = () => FEED_GROUPS.filter((g) => sourcesInGroup(g.id).length);

/**
 * A subsection's master toggle, which has THREE states rather than two.
 *
 * All on and all off are the obvious pair; the third is the one that matters,
 * because a checkbox showing "off" over a group with two of five rows on is
 * saying something false about the map. `indeterminate` is what a browser
 * checkbox already has for exactly this, and `on` decides what pressing it
 * does: anything short of all-on turns the group on, which is the answer that
 * needs no second press.
 */
export function groupState(groupId, isOn) {
  const rows = sourcesInGroup(groupId);
  const live = rows.filter((s) => isOn(s.id)).length;
  return {
    total: rows.length,
    on: live,
    all: rows.length > 0 && live === rows.length,
    none: live === 0,
    indeterminate: live > 0 && live < rows.length,
  };
}

/** The ids that are on by default, for a first visit. */
export const defaultEnabled = () => SOURCES.filter((s) => s.defaultOn).map((s) => s.id);

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
