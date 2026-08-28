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
 * them. Fifteen tick boxes in one column is a list to be read; six named
 * subsections with a master toggle each is a thing to be used, and it is the
 * same shape the Geology tab uses for the same reason.
 *
 * Two kinds of source:
 *
 *   eonet   one EONET category, fetched per category (see `events.js` for why
 *           one request cannot show the world)
 *   usgs    a fixed USGS summary feed, converted by `usgsPoints`
 *
 * **Everything here is something that HAPPENED**, with a time and a place. The
 * faults and plate boundaries were briefly rows in this list, on the reasoning
 * that seismicity is read against them — true, and not a reason to file them
 * here. A fault is a permanent feature of the ground, so it is a vector layer
 * like a coastline is, and it already lives in `global-data.js` under
 * Tectonics, offered from Data · Vectors & Shapes with every other one. A
 * second doorway to the same dataset is a second thing to keep in step.
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
 * Seismicity first because it is the one most people come for.
 */
export const FEED_GROUPS = [
  // `icon` is 16x16 SVG inner markup in the sidebar's own stroke style, drawn
  // into each group's summary beside its name — the same glyph language every
  // other sub-tab carries.
  { id: "seismic", label: "Seismicity", note: "where the ground moved, and how hard",
    icon: '<circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.7"/>' },
  { id: "volcanic", label: "Volcanic activity", note: "eruptions and unrest reported now",
    icon: '<path d="M5.6 6.6 2.4 13.4h11.2L10.4 6.6Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 5.6V3.2M5.8 4.8 4.9 3M10.2 4.8l0.9-1.8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' },
  { id: "fire", label: "Wildfires", note: "open fire incidents worldwide",
    icon: '<path d="M8 2.6c0.6 2-2.8 3.4-2.8 6.4a2.8 2.8 0 0 0 5.6 0c0-1.1-0.5-1.9-1-2.7-0.4 0.7-0.7 1-1.3 1.2 0.5-1.6-0.1-3.4-0.5-4.9Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' },
  { id: "ice", label: "Ice and snow", note: "icebergs, sea and lake ice, snow events",
    icon: '<path d="M8 1.8v12.4M2.6 4.9l10.8 6.2M13.4 4.9 2.6 11.1M8 1.8 6.6 3.2M8 1.8l1.4 1.4M8 14.2l-1.4-1.4M8 14.2l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' },
  { id: "water", label: "Storms and water", note: "storms, floods and water quality",
    icon: '<path d="M4.6 9.4h7a2.6 2.6 0 0 0 0.5-5.1A3.7 3.7 0 0 0 5 3.7a3 3 0 0 0-0.4 5.7Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.6 11.4l-0.9 2M8.4 11.4l-0.9 2M11.2 11.4l-0.9 2" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' },
  { id: "land", label: "Land and climate", note: "landslides, drought, dust, heat",
    icon: '<path d="M12.8 3.2C7.4 3.2 3.8 6.4 3.4 12.6c5.8 0.6 9.4-2.8 9.4-9.4Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.6 11.4c2-3.2 4.4-5.2 7-6.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.8"/>' },
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
  /**
   * ── seismicity ───────────────────────────────────────────────────────────
   *
   * All three are on by default, and they overlap on purpose: they are three
   * WINDOWS on one catalogue, not three catalogues. The day feed alone is a
   * quiet map — a typical 24 hours is a few dozen small earthquakes and none
   * of the ones anybody remembers — so opening on it makes global seismicity
   * look like something that barely happens. Together they read as what they
   * are: today's tremors, the week's real events, and the month's significant
   * ones, merged by USGS id so nothing is drawn or counted twice.
   */
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
    defaultOn: true,
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
    defaultOn: true,
  },


  /**
   * ── GDACS floods ─────────────────────────────────────────────────────────
   *
   * Point-located flood events from the EC Joint Research Centre with
   * Green/Orange/Red alert levels — measured at 63 events for one month
   * against EONET's curated handful. It OVERLAPS the EONET floods row the
   * way the seismicity windows overlap each other: two views of the same
   * hazard, ids from different registries, both worth having.
   */
  {
    id: "gdacs-floods",
    kind: "gdacs",
    category: "floods",
    group: "water",
    label: "Floods — live (GDACS)",
    note: "point-located floods with EU JRC alert levels, last 14 days",
    licence: "GDACS — European Commission Joint Research Centre",
    url: gdacsUrl,
    defaultOn: true,
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
 * A remembered choice, read back against a list that has since changed shape.
 *
 * **This is a migration, and it shipped broken without one.** EONET used to be
 * ONE row (`"eonet"`) covering every category; splitting it into a row per
 * category renamed that id out of existence, and the restore was a plain
 * `filter(sourceById)` — so anybody who had used the mode before the split
 * came back to a stored set whose only surviving ids were the earthquakes.
 * Every EONET feed silently off, no error, the panel and the globe agreeing
 * with each other and both wrong: "activating the events tab only adds the
 * earthquakes", which is exactly how it was reported.
 *
 * Two recoveries, and the difference between them matters:
 *
 * - The legacy id is EXPANDED rather than dropped, because it is a positive
 *   record of an intent — "show me EONET" — and every category is what it
 *   meant.
 * - An empty result falls back to the defaults. A stored set that leaves
 *   nothing on is indistinguishable from a stale one, and a mode that draws
 *   nothing reads as broken rather than as switched off.
 *
 * Deliberately NOT recovered: a set that simply lacks EONET rows. That is what
 * somebody switching all of them off looks like, and second-guessing it would
 * put feeds back on that they took off by hand.
 */
const LEGACY_EONET_ID = "eonet";

export function restoreSources(saved) {
  if (!Array.isArray(saved)) return new Set(defaultEnabled());
  const ids = new Set(saved.filter((id) => sourceById(id)));
  if (saved.includes(LEGACY_EONET_ID)) {
    SOURCES.filter((src) => src.kind === "eonet").forEach((src) => ids.add(src.id));
  }
  return ids.size ? ids : new Set(defaultEnabled());
}

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
/**
 * The GDACS flood window: the last `days` of events with any alert level.
 * SEARCH is the endpoint that actually answers with parameters — MAP with
 * arguments returns 400 (measured), and this is somebody else's API.
 */
export function gdacsUrl(days = 14) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const day = (d) => d.toISOString().slice(0, 10);
  return "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    + `?fromDate=${day(from)}&toDate=${day(to)}`
    + "&alertlevel=Green;Orange;Red&eventlist=FL";
}

/**
 * GDACS GeoJSON to this feed's own event shape. Pure and tested. The
 * category is EONET's "floods" so the markers wear the flood colour the
 * legend already explains; the alert level rides in the title, because
 * Green/Orange/Red is the one fact GDACS adds over EONET.
 */
export function gdacsPoints(payload, source) {
  return (payload?.features || []).map((f) => {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
    const p = f.properties || {};
    const level = p.alertlevel || "";
    return {
      id: `gdacs:${p.eventid ?? `${c[0]},${c[1]}`}`,
      title: `${p.name || p.eventname || "Flood"}${level ? ` — ${level} alert` : ""}`,
      link: p.url?.report || p.url?.details || null,
      sourceId: source.id,
      categoryId: "floods",
      categoryTitle: "Floods",
      lat: c[1],
      lon: c[0],
      date: p.todate || p.fromdate || null,
      alertLevel: level || null,
    };
  }).filter(Boolean);
}

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
 * Magnitude is a LOGARITHMIC scale, so the only even way to draw it is
 * geometrically: a fixed ratio per magnitude unit, never a fixed number of
 * pixels. A linear mapping — the first version here — spends most of its range
 * on the difference between an M2.5 and an M4, which is nothing anybody needs
 * to see, and then has almost nothing left for the difference between an M6
 * and an M8, which is the difference between a news item and a catastrophe.
 *
 * The physics cannot be drawn at true scale, and it is worth saying why rather
 * than pretending otherwise: seismic moment goes as 10^1.5M, so rupture length
 * goes as about 10^0.5M — a factor of 3.2 per magnitude unit, and 560 across
 * the range this draws. No screen holds that. So the compression is a choice
 * and it is stated: **the marker doubles in width every three magnitude
 * units**, which is a thousandfold in energy. The range is pinned at both ends
 * — an M2.5, the smallest the day feed publishes, is the base size; an M8.5 is
 * four times it; nothing grows past that.
 */
const REF_MAGNITUDE = 2.5;
const MAGNITUDES_PER_DOUBLING = 3;
const MAX_MAGNITUDE_STEPS = 6;

export function magnitudeSize(magnitude, base = 6) {
  if (!Number.isFinite(magnitude)) return base;
  const steps = Math.max(0, Math.min(MAX_MAGNITUDE_STEPS, magnitude - REF_MAGNITUDE));
  return base * (2 ** (steps / MAGNITUDES_PER_DOUBLING));
}

/**
 * Magnitude as a colour, along a green-to-red ramp.
 *
 * One hue for every earthquake wastes the only channel that can carry
 * magnitude at a glance, and size alone does not survive being looked at from
 * orbit: an M4 and an M6 differ by a few pixels there, and by three orders of
 * magnitude in released energy. Green through yellow and orange into red is
 * the reading every hazard map has trained people in, so the ramp needs no
 * legend to be understood — a green ring is something the ground does all day,
 * a red one is not.
 *
 * Two rules the stops are chosen against, both learnt the hard way:
 *
 * - **It moves in HUE, not in brightness.** An earlier ramp ended at a deep
 *   crimson (#820f2e), which is the obvious way to say "more" on paper and the
 *   wrong way on a black globe: multiplied by the recency fade, an older M8
 *   came out #170003 — the largest earthquake on the map, drawn nearly
 *   invisible. Every stop here stays luminous.
 * - **It passes through yellow rather than through mud.** Interpolating green
 *   straight to red crosses a dark olive at the midpoint, which is exactly
 *   where the M5s are, so the middle of the ramp would be its least legible
 *   part.
 *
 * Interpolated in plain sRGB, which is not perceptually uniform and does not
 * need to be: the stops are close enough together that the shortcut costs
 * nothing a reader could see.
 */
export const MAGNITUDE_RAMP = [
  { m: 2.0, rgb: [46, 220, 120] },
  { m: 3.5, rgb: [170, 210, 45] },
  { m: 5.0, rgb: [255, 190, 40] },
  { m: 6.5, rgb: [255, 120, 30] },
  { m: 8.0, rgb: [255, 40, 45] },
];

const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export function magnitudeColour(magnitude) {
  // An undetermined magnitude takes the low end rather than the middle: it is
  // usually a small event nobody has reviewed, and painting it as an M5 states
  // something the record does not.
  if (!Number.isFinite(magnitude)) return hex(MAGNITUDE_RAMP[0].rgb);
  const stops = MAGNITUDE_RAMP;
  if (magnitude <= stops[0].m) return hex(stops[0].rgb);
  if (magnitude >= stops[stops.length - 1].m) return hex(stops[stops.length - 1].rgb);
  for (let i = 1; i < stops.length; i += 1) {
    if (magnitude > stops[i].m) continue;
    const a = stops[i - 1];
    const b = stops[i];
    const t = (magnitude - a.m) / (b.m - a.m);
    return hex(a.rgb.map((v, k) => v + (b.rgb[k] - v) * t));
  }
  return hex(stops[stops.length - 1].rgb);
}

/**
 * Recent is brighter.
 *
 * A day of earthquakes drawn identically is a map of where faults are, which
 * is a fact you already have from the fault layer. What the feed adds is WHEN,
 * so the last few hours read at full strength and the rest fade back — the
 * difference between a catalogue and a live view.
 *
 * **The floor is high on purpose.** It began at 0.4, which was right when the
 * only feed was the past 24 hours: everything on the map was recent and the
 * fade separated this morning from last night. With the week and the month
 * feeds on, most of what is drawn sits at the floor — including every
 * significant earthquake, which are the ones worth seeing — so 0.4 of a colour
 * on a black globe was dimming the map's whole subject. Old is quieter, not
 * absent.
 */
const FADE_FLOOR = 0.65;
export function recencyOpacity(timeMs, nowMs = Date.now(), windowMs = 24 * 3600 * 1000) {
  if (!Number.isFinite(timeMs)) return 0.82;
  const age = Math.max(0, nowMs - timeMs);
  if (age >= windowMs) return FADE_FLOOR;
  return FADE_FLOOR + (1 - FADE_FLOOR) * (1 - age / windowMs);
}
