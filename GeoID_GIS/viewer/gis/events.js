// Live natural-event feed from NASA EONET.
//
// EONET curates open natural events -- wildfires, storms, volcanic activity,
// icebergs and so on -- each with a category and a track of dated points. The
// feed is public, needs no key, and is served with permissive CORS, so it can
// be read straight from the browser.
//
// Events are their own mode rather than a layer: they are a live view of what is
// happening now, not something imported, and they come and go on their own
// schedule. When the mode is on they appear as a drop-down beside the legend and
// as markers on the globe; when it is off nothing is fetched and nothing drawn.

import {
  SOURCES, sourceById, usgsPoints, magnitudeSize, recencyOpacity, magnitudeColour,
  activeGroups, sourcesInGroup, groupState, defaultEnabled, restoreSources, sourcesOff,
  gdacsPoints, resolveColour,
  MARKER_LIFT_MAX, liftForAltitude, dotSizePx, isQuake, publisherOf, restoreActive,
  stormCategory, stormScale, stormLabel, STORM_BASE_CAP, markerHitGeometry, nearestHit,
} from "./event-sources.js?v=20260912-7310b6e";

const API = "https://eonet.gsfc.nasa.gov/api/v3/events";

/**
 * ONE request could not show the world, and this is why.
 *
 * `?status=open&limit=200` sounds global and is not. EONET returns events
 * newest first, and right now 7,014 of the 7,082 open events are wildfires
 * because United States incident reporting posts continuously — so the newest
 * two hundred were measured as **197 wildfires, 98% of them in North America**.
 * Every volcano, iceberg and storm on the planet was crowded out by the
 * truncation, which is exactly what was reported.
 *
 * Dropping the limit is not the answer either: the open wildfire list alone is
 * **4.74 MB** and the server sends it uncompressed.
 *
 * So the feed is asked in two ways at once:
 *
 * - **Per category**, so the rare ones are never crowded out by the common
 *   one. Volcanoes are 20 KB, sea and lake ice 130 KB — the whole set of
 *   twelve costs less than a tenth of the wildfire list.
 * - **Per region for the bulk category**, because a plain limit on wildfires
 *   returns the newest, and the newest are wherever it is fire season. Six
 *   boxes with a small limit each give a spread instead: measured, 25 from
 *   every continent rather than 200 from one.
 */
/**
 * The categories are no longer a list in this file — they are the EONET rows
 * that are ticked, in `event-sources.js`. Turning one off is one fewer
 * request, which is the point: somebody watching seismicity has no use for
 * twelve category requests and the six wildfire regions underneath them.
 */

/** The category that would otherwise drown the rest, sampled by region. */
const BULK_CATEGORY = "wildfires";

/** west, north, east, south — EONET's bbox order. */
const REGIONS = [
  [-170, 72, -50, 10],     // North America
  [-90, 13, -30, -56],     // South America
  [-25, 72, 45, 34],       // Europe
  [-20, 37, 52, -35],      // Africa
  [45, 78, 150, 5],        // Asia
  [110, 0, 180, -50],      // Oceania
];

const PER_CATEGORY = 40;
const PER_REGION = 25;

function feedUrls() {
  const urls = [];
  SOURCES.filter((src) => src.kind === "eonet" && enabled.has(src.id)).forEach((src) => {
    if (src.category === BULK_CATEGORY) {
      REGIONS.forEach(([w, n, e, s]) => {
        urls.push(`${API}?status=open&category=${BULK_CATEGORY}`
          + `&limit=${PER_REGION}&bbox=${w},${n},${e},${s}`);
      });
      return;
    }
    urls.push(`${API}?status=open&category=${src.category}&limit=${PER_CATEGORY}`);
  });
  return urls;
}
const REFRESH_MS = 5 * 60 * 1000;

/** What the layer box calls the feed. Stable, so a refresh re-adopts the row
    it already has rather than adding a second one. */
const LAYER_NAME = "Live events";
// How far above the surface the markers float, as a fraction of the globe's
// radius. The globe is not a bare sphere -- there are shells above it -- so a
// marker needs to clear those as well as the ground to survive the depth test.
// Clearance above the globe's own displaced surface, in scene units. The
// markers used to sit at 1.05x the base radius -- a flat shell 0.16 above the
// ground, about 320 km, which is why they read as floating. Measured, the
// relief spans 0.089 and reaches 0.099 above the base radius, so a flat lift
// that cleared the mountains had to stand off the plains by that much too.
// Following the terrain instead, the clearance only has to cover the
// difference between the sampler and the rendered mesh, and can be small
// enough to look like it is on the ground.
let markerLift = MARKER_LIFT_MAX;

/**
 * Where a marker sits: on the globe's own displaced surface, so it rides the
 * terrain and the relief slider the way the basemap does, rather than on a
 * sphere floating over it.
 */
function markerPoint(viewer, lat, lon) {
  return viewer.surfacePoint
    ? viewer.surfacePoint(lat, lon, markerLift)
    : viewer.latLonToVector3(lat, lon, viewer.GLOBE_RADIUS + markerLift);
}

/**
 * Markers are rebuilt when the exaggeration changes, not shaded.
 *
 * They are static geometry built from `surfacePoint`, which bakes in the
 * relief of the moment — and the moment is not stable: the slider moves, and
 * the relief tapers to nothing below ~300 km whenever there is close-range
 * imagery. Built low they sank into the mountains when the camera rose; built
 * high they floated when it flattened.
 *
 * The vector layers solve this in the shader, and that was tried here first:
 * `followRelief` on a `PointsMaterial` leaves the points submitted (the
 * renderer still counts them) and invisible. Two hundred markers are nothing
 * to recompute, so this watches the exaggeration instead and rewrites the
 * positions in place — no rebuild of the scene, no shader.
 */
let reliefWatch = null;
let lastRelief = null;

function watchRelief() {
  if (reliefWatch || typeof window === "undefined") return;
  reliefWatch = window.setInterval(() => {
    const viewer = window.GeoIDViewer;
    if (!viewer?.getEffectiveRelief || !markers) return;
    /**
     * RE-SAMPLED EVERY TICK, not only when the exaggeration moves.
     *
     * The gate here used to be "has the relief changed?", which misses the
     * thing that actually moves the ground under a marker: **the DEM refines
     * as you fly in.** New tiles arrive, the basemap's own drape is rebuilt
     * from the better elevations, and the markers keep the ones they were
     * placed with — neither the relief nor the clearance has changed, so
     * nothing rewrote them.
     *
     * Measured against the drape that is actually drawn, with markers 30 m
     * above `surfacePoint` the whole time: **−675 m to +1,219 m**, mean +489.
     * Some floated, some sank, and which was which depended on where the DEM
     * had been coarse when the feed loaded. That is the reported "wildfires
     * and the other event dots are NOT tight to the surface".
     *
     * So the gate is gone. Four hundred markers is four hundred sampler
     * lookups two and a half times a second, which is nothing next to being
     * wrong about where they are.
     */
    lastRelief = viewer.getEffectiveRelief();
    markerLift = liftForAltitude();
    markers.traverse((node) => {
      const list = node.userData?.events;
      const truth = node.userData?.truePositions;
      if (!list || !truth) return;
      // Into the TRUTH rather than into the geometry: what the geometry holds
      // is the truth minus whatever is round the back, and the cull rewrites
      // it from here on the next frame.
      list.forEach((event, i) => {
        const v = markerPoint(viewer, event.lat, event.lon);
        truth[i * 3] = v.x; truth[i * 3 + 1] = v.y; truth[i * 3 + 2] = v.z;
      });
    });
    /**
     * AND THE SELECTION RING, which is not one of them.
     *
     * The halo is its own object in the spin frame rather than a member of
     * `markers`, so this traversal never reached it and its position was the
     * one it was built with — the whole reason the clouds are re-sampled,
     * missed for the one marker somebody is actually looking at.
     *
     * It shows as the ring leaving the view on the way in, because the
     * exaggeration TAPERS as the camera lands: the ground and its dot come
     * down, the ring stays at the radius it was selected at. Measured at 3 km
     * altitude, the halo sat at 3.26561 against its own marker at 3.20003 —
     * **65 km above it**, long out of frame, while the dot sat on the ground
     * in front of you. Reported as the halo dropping from view at a certain
     * altitude, which is exactly what it does.
     */
    if (halo?.userData?.place) {
      const truth = halo.userData.truePositions;
      const v = markerPoint(viewer, halo.userData.place.lat, halo.userData.place.lon);
      truth[0] = v.x; truth[1] = v.y; truth[2] = v.z;
    }
  }, 400);
}

function stopWatchingRelief() {
  if (!reliefWatch) return;
  window.clearInterval(reliefWatch);
  reliefWatch = null;
  lastRelief = null;
}

/**
 * Symbology by EONET category. Colours follow the hazard sense the rest of the
 * viewer uses -- heat and fire warm, water cool, ground and ice neutral -- so a
 * glance at the globe reads the same way as a glance at the legend.
 */
/**
 * THE TROPICAL-CYCLONE SYMBOL, from `assets/cyclone_icon.png`.
 *
 * Every other category here is a font character, which is right when a shape
 * that means the category already exists in a typeface. A cyclone does not:
 * the one Unicode has is U+1F300, which browsers render as a COLOUR emoji, so
 * it would ignore the tint every other marker takes and read as a sticker
 * dropped on the map.
 *
 * The file is already what this needs — an opaque WHITE silhouette on
 * transparency with the eye punched out of the alpha — so it is drawn as it
 * comes: white is what the marker material tints, and the alpha is what a
 * legend row masks with. Nothing here recolours it.
 *
 * Resolved against `import.meta.url` rather than the document: the viewer is
 * two directories below the site root, so a document-relative path resolves
 * inside `GeoID_GIS/viewer/` and 404s. `crossOrigin` because the ink fit READS
 * the canvas back, and a tainted canvas throws on `getImageData` — which is
 * how a moved asset silently takes a working symbol out.
 */
const CYCLONE_ICON = new URL("../../../assets/cyclone_icon.png", import.meta.url).href;

const markImages = new Map();

/**
 * The image if it is here, null if it is not yet — with `whenReady` called
 * once it lands so a texture already built can be redrawn in place.
 *
 * A marker drawn before then falls back to the category's own CHARACTER
 * rather than to nothing: an empty sprite and a category that failed to load
 * look identical, and one of them is a bug.
 */
function markImage(url, whenReady) {
  const held = markImages.get(url);
  if (held) {
    if (whenReady && !held.ready) held.waiting.push(whenReady);
    return held.ready ? held.image : null;
  }
  const image = new Image();
  const entry = { image, ready: false, waiting: whenReady ? [whenReady] : [] };
  markImages.set(url, entry);
  image.crossOrigin = "anonymous";
  image.onload = () => {
    entry.ready = true;
    entry.waiting.splice(0).forEach((fn) => {
      try { fn(); } catch (error) { /* one redraw failing is not the others' */ }
    });
  };
  // No retry: the character stands in, which is a legible symbol rather than a
  // gap, and a feed that polls an asset it cannot have is worse than either.
  image.onerror = () => { entry.waiting.length = 0; };
  image.src = url;
  return null;
}

/**
 * THE SAME SYMBOL IN THE LIST AS ON THE MAP.
 *
 * A legend that disagrees with the markers is the fault this feed has already
 * been reported for — "none of the EONET live events have the symbologies
 * mapped as they should be as shown in the legend" — so the mark reaches the
 * rows too, and from the SAME file.
 *
 * As a MASK rather than an <img>, so it takes the row's own colour exactly as
 * a character does and nothing has to know which kind of symbol it is holding.
 */
function glyphSpan(symbol) {
  const tint = `style="color:${symbol.colour}"`;
  if (!symbol.mark) return `<span class="event-glyph" ${tint}>${symbol.glyph}</span>`;
  const mask = `url(${symbol.mark}) center/contain no-repeat`;
  return `<span class="event-glyph" ${tint}><span class="event-glyph-mark" style="`
    /**
     * Sized and aligned to the TEXT rows' own line box, measured rather than
     * guessed: at 0.9rem square on the baseline the mark stood 15.9 px against
     * a character row's 13 and pushed every storm row taller than its
     * neighbours. Of the alignments tried on the live list — baseline 15.5,
     * -0.1em 14.5, middle 13.7 — `text-bottom` is the one that lands on 13.
     */
    + "display:inline-block;width:0.78rem;height:0.78rem;vertical-align:text-bottom;"
    + `background:currentColor;-webkit-mask:${mask};mask:${mask}"></span></span>`;
}

const SYMBOLS = {
  wildfires: { colour: "#ff6b2c", glyph: "●", label: "Wildfires" },
  // Red rather than the skin's chrome, and it PULSES: an eruption reported now
  // is the one thing in this feed that is still happening while you look at it.
  volcanoes: { colour: "#ff2d2d", glyph: "▲", label: "Volcanoes", pulse: true },
  // WHITE, and the cyclone rather than a character: a tropical storm has a
  // shape everybody already reads, and no typeface here carries it. `glyph` is
  // kept as the fallback for anything that cannot draw a path.
  // WHITE, and the cyclone icon rather than a character: a tropical storm has
  // a shape everybody already reads, and no typeface here carries it. `glyph`
  // stays as what stands in until the file has landed.
  severeStorms: {
    colour: "#ffffff", glyph: "◉", mark: CYCLONE_ICON, label: "Severe storms",
  },
  seaLakeIce: { colour: "#bfe9ff", glyph: "◆", label: "Sea and lake ice" },
  // A dot, not a bar: a flood alert is a PLACE, and the bar read as a legend
  // swatch that had wandered onto the map. It shares the wildfires' glyph and
  // its own colour, which is what the panel shows too.
  floods: { colour: "#2f6bff", glyph: "●", label: "Floods" },
  drought: { colour: "#d8b26a", glyph: "▬", label: "Drought" },
  // The middle of the magnitude ramp, and concentric rings for the glyph, so
  // the legend and the list say the same thing as the markers do. The colour a
  // single earthquake wears is `magnitudeColour` — green through to red; this
  // is what the CATEGORY looks like where one swatch has to stand for all of
  // them, and the middle of a ramp is the only honest choice for that.
  earthquakes: { colour: "#ffbe28", glyph: "◎", label: "Earthquakes" },
  landslides: { colour: "#c98b5e", glyph: "▼", label: "Landslides" },
  snow: { colour: "#e8f4ff", glyph: "❄", label: "Snow" },
  dustHaze: { colour: "#c2a878", glyph: "▨", label: "Dust and haze" },
  manmade: { colour: "#9aa5b1", glyph: "■", label: "Manmade" },
  waterColor: { colour: "#4fd1a5", glyph: "◉", label: "Water colour" },
  tempExtremes: { colour: "#ff8a5c", glyph: "✳", label: "Temperature extremes" },
};
const FALLBACK = { colour: "#9aa5b1", glyph: "●", label: "Other" };

const symbolFor = (id) => {
  const key = String(id);
  if (key.startsWith("quake-")) return SYMBOLS.earthquakes;
  if (key.startsWith("storm-")) return SYMBOLS.severeStorms;
  return SYMBOLS[key] || FALLBACK;
};

/**
 * Which point cloud an event is drawn in.
 *
 * The panel groups by CATEGORY, because that is how somebody reads a list. The
 * globe cannot: a PointsMaterial has one size for the whole cloud, so drawing
 * every earthquake together means drawing an M7 the same size as an M2.5 --
 * and the M7 released about thirty thousand times the energy. Splitting the
 * seismicity into magnitude bands gives each band its own material and its own
 * size without a custom shader, and costs a handful of extra draw calls.
 */
function markerKey(event) {
  /**
   * BANDED BY MAGNITUDE ONLY WHERE THERE IS A MAGNITUDE.
   *
   * This used to read "has a sourceId", which meant "did not come from EONET"
   * — and that was true of the seismicity and of nothing else, until the GDACS
   * flood feed arrived. A flood has a source id, no magnitude, and fell into
   * the `quake-3` band: drawn with the earthquake's concentric rings, coloured
   * from the middle of the magnitude ramp, and listed under the earthquake
   * symbol. Reported as the floods having the same symbol as the earthquakes,
   * which they did, exactly.
   *
   * The test is now the thing the banding is FOR: a magnitude to band by.
   */
  /**
   * The storms band the same way, on the scale published for them: a
   * PointsMaterial carries ONE size, so drawing every storm together means
   * drawing a Category 5 the same size as a tropical depression.
   */
  if (event.categoryId === "severeStorms") {
    const band = stormCategory(event.magnitudeValue);
    return band === null ? "severeStorms" : `storm-${band}`;
  }
  if (event.categoryId !== "earthquakes" || !Number.isFinite(event.magnitude)) {
    return event.categoryId || "other";
  }
  return `quake-${Math.max(1, Math.min(8, Math.round(event.magnitude)))}`;
}

/** The magnitude a band stands for, back out of its key. */
const bandMagnitude = (key) => Number(String(key).split("-")[1]);

/** How long ago still counts as "now" for the brightness fade. */
const RECENCY_WINDOW_MS = 7 * 24 * 3600 * 1000;

/**
 * Which feeds are on.
 *
 * The mode used to be one feed with no choice in it: enter, and you got every
 * open EONET event whether you came for wildfires or not. Global seismicity in
 * the last day is a different question, and a mode that answers both at once
 * answers neither -- so each feed is a row you tick, and what is drawn is the
 * union of the ones that are on.
 *
 * Remembered, because it is a preference rather than a state: somebody who
 * came for earthquakes wants earthquakes the next time too.
 */
/**
 * The OFF list. A new key rather than the old one reused, so a page served
 * from cache mid-deploy cannot read an off-list as an on-list and switch off
 * exactly the feeds it names.
 */
const STORE_KEY = "geoid-gis:event-sources-off";
/** What the on-list was stored under, read once and then retired. */
const LEGACY_STORE_KEY = "geoid-gis:event-sources";
let enabled = new Set(defaultEnabled());
try {
  // Through `restoreSources`, which knows what the ids used to be: a plain
  // filter drops anything renamed since, and dropping the id EONET used to be
  // stored under left returning users with the earthquakes and nothing else.
  const stored = window.localStorage.getItem(STORE_KEY);
  if (stored) {
    enabled = restoreSources({ off: JSON.parse(stored) });
  } else {
    // The on-list, read ONCE. `restoreSources` turns everything on for it —
    // in that format a missing id is "switched off" or "did not exist yet"
    // and nothing stored tells them apart. Retired on the way past so the
    // ambiguity is answered exactly once.
    enabled = restoreSources(JSON.parse(
      window.localStorage.getItem(LEGACY_STORE_KEY) || "null"));
    window.localStorage.removeItem(LEGACY_STORE_KEY);
  }
} catch (error) { /* no storage, keep the defaults */ }

function rememberSources() {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(sourcesOff(enabled)));
  } catch (error) { /* no storage, the choice is still live this session */ }
}

/**
 * Whether the mode itself is on, remembered apart from WHICH feeds are on.
 * They are different questions: somebody who wants only the earthquakes still
 * wants the mode, and somebody who has switched the whole thing off has not
 * said anything about their feed selection.
 */
const ACTIVE_KEY = "geoid-gis:events-active";

function rememberActive(on) {
  try {
    window.localStorage.setItem(ACTIVE_KEY, on ? "1" : "0");
  } catch (error) { /* no storage, the choice is still live this session */ }
}

/** The stored choice, or the default, which is ON. */
function wantedActive() {
  try {
    return restoreActive(window.localStorage.getItem(ACTIVE_KEY));
  } catch (error) {
    // A private window refuses to be read as readily as written. No choice can
    // have been stored, so this is the no-choice case: the default stands.
    return restoreActive(null);
  }
}

/**
 * One refetch for a burst of ticks.
 *
 * A group's master toggle turns five rows on, and each of those is a change:
 * fetching per change means five overlapping passes over the same feeds, the
 * last of which wins. The wait is short enough to be invisible to one click
 * and long enough to collect a programmatic run of them.
 */
let refetchTimer = null;
function refetchSoon() {
  if (refetchTimer) window.clearTimeout(refetchTimer);
  refetchTimer = window.setTimeout(() => {
    refetchTimer = null;
    void fetchEvents();
  }, 120);
}

export function setSourceEnabled(id, on) {
  const src = sourceById(id);
  if (!src) return;
  if (on) enabled.add(id); else enabled.delete(id);
  rememberSources();
  renderFeeds();
  // Ticking a feed is asking to see it, so it arms the mode rather than
  // filling a list nobody has opened.
  if (on && !active) { void setActive(true); return; }
  refetchSoon();
}

/** Every row in a subsection at once, with one fetch at the end of it. */
export function setGroupEnabled(groupId, on) {
  sourcesInGroup(groupId).forEach((src) => {
    if (on) enabled.add(src.id); else enabled.delete(src.id);
  });
  rememberSources();
  renderFeeds();
  if (on && !active) { void setActive(true); return; }
  refetchSoon();
}

export const isSourceEnabled = (id) => enabled.has(id);

let active = false;
let events = [];
let markers = null;
// The spin-carrying group everything pinned to a coordinate lives in.
let spun = null;
let timer = null;
let THREE = null;

const byId = (id) => document.getElementById(id);

/**
 * Said in both places, because the two are visible at different times.
 *
 * `events-status` is the head of the drop-down, which only exists while the
 * mode is on; `events-feeds-status` is in the sidebar section, which can be
 * open with the mode off — and that is exactly when somebody ticks the fault
 * layer and needs to be told it is being fetched.
 */
function status(message) {
  ["events-status", "events-feeds-status"].forEach((id) => {
    const node = byId(id);
    if (node) node.textContent = message || "";
  });
}

/** Latest dated point of an event's geometry -- where it is now, not where it began. */
function latestPoint(event) {
  const geometry = event.geometry || [];
  for (let i = geometry.length - 1; i >= 0; i -= 1) {
    const g = geometry[i];
    if (!g?.coordinates) continue;
    // Polygons carry a ring; take its first vertex as a representative point.
    const c = g.type === "Polygon" ? g.coordinates?.[0]?.[0] : g.coordinates;
    if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      /**
       * The MAGNITUDE travels with the point, and used to be dropped here.
       *
       * EONET publishes one per geometry — for a severe storm it is the wind
       * speed in knots, and measured on the live feed every open storm has
       * one. Without it a Category 5 hurricane and a tropical depression were
       * the same mark on the map, which is the one thing about a storm
       * everybody already knows how to read.
       */
      return {
        lon: c[0],
        lat: c[1],
        date: g.date,
        magnitudeValue: Number.isFinite(g.magnitudeValue) ? g.magnitudeValue : null,
        magnitudeUnit: g.magnitudeUnit || null,
      };
    }
  }
  return null;
}

/** How many of the feed's requests did not answer, for the status line. */
let missingFeeds = 0;

/** The USGS feeds that are switched on, fetched and converted. */
async function fetchQuakes() {
  const wanted = SOURCES.filter((src) => src.kind === "usgs" && enabled.has(src.id));
  const answers = await Promise.all(wanted.map(async (src) => {
    try {
      const response = await fetch(src.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return usgsPoints(await response.json(), src);
    } catch (error) {
      return null;
    }
  }));
  return {
    points: answers.filter(Boolean).flat(),
    asked: wanted.length,
    reached: answers.filter(Boolean).length,
  };
}

/** The GDACS flood rows that are on, fetched and converted. */
async function fetchGdacs() {
  const wanted = SOURCES.filter((src) => src.kind === "gdacs" && enabled.has(src.id));
  const answers = await Promise.all(wanted.map(async (src) => {
    try {
      const url = typeof src.url === "function" ? src.url() : src.url;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return gdacsPoints(await response.json(), src);
    } catch (error) {
      return null;
    }
  }));
  return {
    points: answers.filter(Boolean).flat(),
    asked: wanted.length,
    reached: answers.filter(Boolean).length,
  };
}

async function fetchEvents() {
  status("Fetching…");
  const quakes = await fetchQuakes();
  const gdacs = await fetchGdacs();
  missingFeeds = gdacs.asked - gdacs.reached;
  /**
   * The seismicity feeds overlap ON PURPOSE.
   *
   * Past-day M2.5, past-week M4.5 and significant-month are three windows on
   * one catalogue, so a big earthquake yesterday is in all three -- with the
   * same USGS id every time, which is what makes merging them safe. Drawing it
   * three times would put three markers on one epicentre and count it three
   * times in the panel.
   */
  const seismic = new Map();
  quakes.points.forEach((q) => seismic.set(q.id, q));

  if (!feedUrls().length) {
    events = [...gdacs.points, ...seismic.values()];
    missingFeeds += quakes.asked - quakes.reached;
    reportCounts(quakes);
    renderPanel();
    renderMarkers();
    publishLayer();
    return;
  }
  try {
    const urls = feedUrls();
    const answers = await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()).events || [];
      } catch (error) {
        // One category out is a gap in the map, not the end of it. The count
        // below says how many answered, so a partial feed is visible as one.
        return null;
      }
    }));
    const reached = answers.filter(Boolean).length;
    if (!reached) throw new Error("no part of the feed answered");
    // Merged by id: a storm can be in two boxes, and the regions overlap at
    // the edges by design rather than by accident.
    const merged = new Map();
    answers.filter(Boolean).flat().forEach((event) => {
      if (event?.id) merged.set(event.id, event);
    });
    const data = { events: [...merged.values()] };
    missingFeeds += urls.length - reached;
    events = (data.events || []).map((event) => {
      const point = latestPoint(event);
      const category = event.categories?.[0] || {};
      return point ? {
        id: event.id,
        title: event.title,
        link: event.link,
        categoryId: category.id,
        categoryTitle: category.title,
        ...point,
      } : null;
    }).filter(Boolean);
    events = [...events, ...gdacs.points, ...seismic.values()];
    missingFeeds += quakes.asked - quakes.reached;
    reportCounts(quakes);
  } catch (error) {
    // One feed being out is not all of them: whatever seismicity answered is
    // still worth drawing, and saying "nothing is being shown" over a map with
    // thirty earthquakes on it would be the report that is wrong.
    events = [...seismic.values()];
    status(events.length
      ? `EONET unavailable (${error.message}). Showing ${events.length} earthquake(s).`
      : `Feed unavailable (${error.message}). Nothing is being shown.`);
  }
  renderPanel();
  renderMarkers();
}

/**
 * What the status line says, now that there is more than one feed in it.
 *
 * It used to name EONET's categories, which was the whole story when EONET was
 * the whole feed. With seismicity on, the useful sentence separates the two --
 * "218 natural events, 31 earthquakes" -- because they answer different
 * questions and are counted from different catalogues.
 */
function reportCounts(quakes) {
  /**
   * COUNTED BY CATEGORY, not by which registry an id came from. Read off
   * `sourceId` a GDACS flood was counted as an earthquake AND left out of the
   * natural events it is one of — so the sentence overstated the seismicity
   * and understated the rest, with the category it belongs to missing from
   * the tally of categories.
   */
  const seismic = events.filter(isQuake).length;
  const natural = events.length - seismic;
  const categories = new Set(
    events.filter((e) => !isQuake(e)).map((e) => e.categoryTitle).filter(Boolean),
  );
  const parts = [];
  if (natural) parts.push(`${natural} natural event(s) in ${categories.size} categories`);
  if (seismic) parts.push(`${seismic} earthquake(s)`);
  if (!parts.length) parts.push("nothing from the feeds that are on");
  status(`${parts.join(" · ")} · ${new Date().toLocaleTimeString()}`
    + (missingFeeds ? ` · ${missingFeeds} feed(s) unreachable` : ""));
}

/**
 * Which subsections are folded open, kept in the module rather than on the
 * element: the list is rebuilt on every tick and every refresh, so state held
 * in the DOM springs shut under somebody working down it. Same reason the
 * catalogue dropdown keeps its own.
 */
const openGroups = new Map();

/**
 * The feeds, as ticked rows inside named subsections, at the top of the
 * drop-down.
 *
 * They go at the TOP rather than under the events: with every source off the
 * list below is empty, and a control that only appears once there is something
 * to see cannot be the control that brings something to see. That is the same
 * reason this block is rendered before the early return for an empty feed.
 *
 * Subsections rather than one column, because seventeen tick boxes is a list
 * to be read where seven named groups is a thing to be used — and each carries
 * a master toggle, so "show me seismicity" is one press rather than three.
 *
 * Each subsection is a `gis-tool-section`, which is the sidebar's own card:
 * every other tool in that column is one, so a feed group that invented its
 * own chrome read as something bolted on beside them.
 */
/**
 * ONE ROW TEMPLATE, wherever a feed is offered. The Live tab's list and a
 * proxy host elsewhere both draw from this, so a feed looks the same in both
 * places by construction -- glyph, type, tick -- rather than by a copy that
 * drifts the first time either is touched. `attr` is the only difference: a
 * row in the feed panel commits through `data-feed`, a proxy through
 * `data-feed-toggle`, and the delegated handler below tells them apart.
 */
function sourceRow(src, attr = "data-feed") {
  const symbol = symbolFor(src.category);
  return `<label class="event-source" title="${src.note} — ${src.licence}">
      <input type="checkbox" ${attr}="${src.id}"${isSourceEnabled(src.id) ? " checked" : ""}>
      ${glyphSpan(symbol)}
      <span class="event-source-name">${src.label}</span>
    </label>`;
}

function sourcesBlock() {
  return `<div class="event-sources">
    ${activeGroups().map((group) => {
    const state = groupState(group.id, isSourceEnabled);
    const rows = sourcesInGroup(group.id).map((src) => sourceRow(src)).join("");
    // Folded on arrival, all of them. Six open cards is a column of forty tick
    // boxes and the tab reads as a wall; folded it reads as six subjects, and
    // the master toggle beside each is enough to work with without opening one
    // at all. `openGroups` keeps whatever was opened by hand, because the list
    // is redrawn on every change.
    const open = openGroups.get(group.id) === true;
    return `<details class="gis-tool-section event-feed-group"${open ? " open" : ""}
        data-group="${group.id}">
        <summary title="${group.note}">
          <span class="event-feed-icon" aria-hidden="true"><svg viewBox="0 0 16 16">${group.icon || ""}</svg></span>
          <span class="event-feed-name">${group.label}</span>
          <input type="checkbox" class="event-feed-master" data-group-toggle="${group.id}"
            ${state.all ? "checked" : ""}
            aria-label="Turn ${group.label} on or off">
        </summary>
        <div class="gis-tool-body event-feed-rows">${rows}</div>
      </details>`;
  }).join("")}
  </div>`;
}

/**
 * The feed controls, drawn into the sidebar's Events section.
 *
 * They are drawn whether or not the mode is on, because ticking one is how
 * somebody turns it on: a control that only exists once the thing it controls
 * is running cannot be the way in.
 */
function renderFeeds() {
  // Before the early return: a proxy lives outside this host and must follow
  // the state on every world, including the ones with no feed panel at all.
  syncFeedProxies();
  const host = byId("events-feeds-host");
  if (!host) return;
  host.innerHTML = sourcesBlock();
  wireSources(host);
}

function wireSources(panel) {
  panel.querySelectorAll("[data-feed]").forEach((box) => {
    box.addEventListener("change", () => setSourceEnabled(box.dataset.feed, box.checked));
  });
  panel.querySelectorAll("[data-group-toggle]").forEach((box) => {
    const state = groupState(box.dataset.groupToggle, isSourceEnabled);
    // The third state: a group with two of five rows on is neither on nor off,
    // and a box showing "off" over it says something false about the map.
    box.indeterminate = state.indeterminate;
    // Inside a <summary>, a click on the box is also a click on the summary,
    // which folds the section. Toggling a group is not asking to close it.
    box.addEventListener("click", (event) => event.stopPropagation());
    box.addEventListener("change", () => {
      // Anything short of all-on turns the whole group on: that is the answer
      // that needs no second press.
      setGroupEnabled(box.dataset.groupToggle, !state.all);
    });
  });
  panel.querySelectorAll("details[data-group]").forEach((node) => {
    node.addEventListener("toggle", () => openGroups.set(node.dataset.group, node.open));
  });
}

/** How many rows a category shows before it offers the rest. */
const SHORT_LIST = 12;

/**
 * Browsing one category without losing the others.
 *
 * The list is grouped by category and each group showed twelve rows and then
 * "+138 more" — which named what it was withholding and gave no way to see it.
 * Showing everything instead is worse: one busy category (150 wildfires, 172
 * earthquakes) pushes every other group off the bottom of a panel that is
 * 60vh tall, and the thing this list is FOR is seeing what kinds of event are
 * happening at a glance.
 *
 * So one category at a time opens into a scrolling box of its own, and while
 * it is open the others stay on screen as their headers — still there, still
 * one press away, not scrolled off. The panel's own height does not change,
 * which is what keeps it usable rather than becoming a page.
 */
let expandedGroup = null;
/** Where somebody had got to in that list, kept across the 5-minute refresh. */
let expandedScroll = 0;
/**
 * Which PAGE the drop-down is showing: "categories" is the grouped view
 * above; "recent" is the live feed — every event in one list, newest
 * first, each row carrying its icon and how long ago it happened.
 */
let panelView = "categories";
let recentScroll = 0;

/**
 * "now", "12 min", "3 h", "2 d" — the resolution a live feed reads at.
 * EONET events carry an ISO `date`; USGS quakes carry epoch-ms `timeMs`.
 */
function eventWhenMs(event) {
  if (Number.isFinite(event.timeMs)) return event.timeMs;
  const parsed = Date.parse(event.date);
  return Number.isFinite(parsed) ? parsed : 0;
}

function agoText(ms) {
  if (!ms) return "";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return "";
  if (minutes < 1) return "now";
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function viewTabsHtml() {
  const tab = (id, label) => `<button type="button" class="event-view-tab`
    + `${panelView === id ? " is-active" : ""}" data-view="${id}">${label}</button>`;
  return `<div class="event-view-tabs">${tab("categories", "By category")}${tab("recent", "Live feed")}</div>`;
}

function renderRecent(panel) {
  const sorted = [...events].sort((a, b) => eventWhenMs(b) - eventWhenMs(a));
  panel.innerHTML = `${viewTabsHtml()}
    <div class="event-group is-open">
      <div class="event-group-scroll event-recent-scroll">${sorted.map((event) => {
        const symbol = symbolFor(event.categoryId || "other");
        return `<div class="event-row" data-id="${event.id}" title="${event.title}">
            ${glyphSpan(symbol)}
            <span class="event-name">${event.title}</span>
            <span class="event-when">${agoText(eventWhenMs(event))}</span>
          </div>`;
      }).join("")}</div>
    </div>`;
  const box = panel.querySelector(".event-recent-scroll");
  if (box) {
    box.scrollTop = recentScroll;
    box.addEventListener("scroll", () => { recentScroll = box.scrollTop; });
  }
}

function wireViewTabs(panel) {
  panel.querySelectorAll(".event-view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (panelView === tab.dataset.view) return;
      panelView = tab.dataset.view;
      renderPanel();
    });
  });
}

function wireRows(panel) {
  // A row and its marker are the same event, so clicking either does the same
  // thing: bring it into view, ring it, and open its description.
  panel.querySelectorAll(".event-row").forEach((row) => {
    row.addEventListener("click", () => {
      const event = events.find((e) => e.id === row.dataset.id);
      if (!event) return;
      selectEvent(event);
      panel.querySelectorAll(".event-row").forEach((r) => r.classList.remove("is-selected"));
      row.classList.add("is-selected");
    });
  });
}

function eventRowHtml(event, symbol) {
  return `<div class="event-row" data-id="${event.id}" title="${event.title}">
      ${glyphSpan(symbol)}
      <span class="event-name">${event.title}</span>
    </div>`;
}

function renderPanel() {
  const panel = byId("events-panel-body");
  if (!panel) return;
  if (!events.length) {
    // The feeds themselves are switched on in the sidebar's Events section, so
    // this says where to go rather than being a second set of the same
    // controls -- two places to turn a feed on is two answers to one question.
    panel.innerHTML = '<p class="gis-hint">Nothing from the feeds that are on. '
      + 'Switch more on under <strong>Events</strong> in the sidebar.</p>';
    return;
  }
  if (panelView === "recent") {
    renderRecent(panel);
    wireViewTabs(panel);
    wireRows(panel);
    return;
  }
  const groups = new Map();
  events.forEach((event) => {
    const key = event.categoryId || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  // A category that has gone quiet since it was opened -- the feed refreshes
  // itself -- must not leave the panel stuck on a group that no longer exists.
  const open = groups.has(expandedGroup) ? expandedGroup : null;
  expandedGroup = open;

  panel.innerHTML = viewTabsHtml() + ordered.map(([key, list]) => {
    const symbol = symbolFor(key);
    const label = symbol.label !== FALLBACK.label ? symbol.label : (list[0].categoryTitle || "Other");
    const glyph = glyphSpan(symbol);

    // Another category, while one is open: its header only, and pressing it
    // moves the open list here rather than adding a second one.
    if (open && key !== open) {
      return `<div class="event-group is-folded">
          <button type="button" class="event-group-head" data-expand="${key}"
            title="Browse the ${list.length} ${label.toLowerCase()}">
            ${glyph}<span>${label}</span><span class="event-count">${list.length}</span>
          </button>
        </div>`;
    }

    // The open one: all of it, in a box that scrolls on its own.
    if (open) {
      return `<div class="event-group is-open">
          <div class="event-group-head">
            ${glyph}<span>${label}</span><span class="event-count">${list.length}</span>
          </div>
          <div class="event-group-scroll">${list.map((e) => eventRowHtml(e, symbol)).join("")}</div>
          <button type="button" class="event-group-more" data-collapse>Show less</button>
        </div>`;
    }

    // Nothing open: the short list, and a way into the rest.
    const rows = list.slice(0, SHORT_LIST).map((e) => eventRowHtml(e, symbol)).join("");
    const more = list.length > SHORT_LIST
      ? `<button type="button" class="event-group-more" data-expand="${key}">`
        + `Show all ${list.length}</button>`
      : "";
    return `<div class="event-group">
        <div class="event-group-head">
          ${glyph}<span>${label}</span><span class="event-count">${list.length}</span>
        </div>${rows}${more}</div>`;
  }).join("");

  panel.querySelectorAll("[data-expand]").forEach((node) => {
    node.addEventListener("click", () => {
      expandedGroup = node.dataset.expand;
      expandedScroll = 0;
      renderPanel();
    });
  });
  panel.querySelector("[data-collapse]")?.addEventListener("click", () => {
    expandedGroup = null;
    renderPanel();
  });

  // The feed refreshes every five minutes and rebuilds this list; without
  // carrying the scroll over, anybody halfway down a hundred and fifty
  // wildfires is thrown back to the top by a refresh they did not ask for.
  const box = panel.querySelector(".event-group-scroll");
  if (box) {
    box.scrollTop = expandedScroll;
    box.addEventListener("scroll", () => { expandedScroll = box.scrollTop; });
  }

  wireViewTabs(panel);
  wireRows(panel);
}

/**
 * Everything that happens when an event is chosen, from either the list or the
 * globe. Kept in one place so the two cannot drift into doing different things.
 */
function selectEvent(event, at) {
  if (!event) return;
  focusOn(event.lat, event.lon);
  /**
   * The card goes BESIDE ITS DOT, whichever way the event was chosen.
   *
   * A row used to open it at a fixed spot left of the feed -- which is the
   * legend's corner, so every card picked from the list landed on the same
   * patch of screen, nowhere near the event it described, while a click on a
   * dot put it at the pointer. The card now follows the event's own marker
   * (`trackPopup`, run from the selection ring's frame loop), so a row and a
   * dot open the same card in the same place, and it rides the fly-in the
   * row starts rather than being left behind by it.
   */
  showPopup(event, at?.x, at?.y);
}

function focusOn(lat, lon) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.latLonToVector3 || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  // Same frame the markers are placed in, so the view lands on the marker
  // rather than on where its coordinates would sit at midnight.
  const group = spinFrame() || viewer.earthSceneGroup;
  const local = viewer.latLonToVector3(lat, lon, viewer.GLOBE_RADIUS);
  if (group) {
    group.updateMatrixWorld(true);
    local.applyMatrix4(group.matrixWorld);
  }
  // Selecting an event is a request to look at it, so the view closes in as
  // well as coming round -- staying at whatever distance it happened to be at
  // left the event a speck in the middle of the screen.
  const close = viewer.GLOBE_RADIUS * 1.55;
  const from = viewer.camera.position.clone();
  const to = local.clone().setLength(Math.min(from.length(), close));
  const started = performance.now();
  const duration = 650;
  if (flyFrame) window.cancelAnimationFrame(flyFrame);
  const step = (now) => {
    const t = Math.min((now - started) / duration, 1);
    // Ease out, so it arrives gently rather than stopping dead.
    const e = 1 - ((1 - t) ** 3);
    // Interpolated as a direction and a distance rather than straight across,
    // which would cut a chord through the planet on a long move.
    const dir = from.clone().normalize().lerp(to.clone().normalize(), e).normalize();
    const dist = from.length() + (to.length() - from.length()) * e;
    viewer.camera.position.copy(dir).setLength(dist);
    viewer.controls?.target.set(0, 0, 0);
    viewer.controls?.update();
    flyFrame = t < 1 ? window.requestAnimationFrame(step) : null;
  };
  flyFrame = window.requestAnimationFrame(step);
}

/**
 * The globe's apparent radius in pixels. Both the dots and the selection ring
 * are sized from this, so they keep the same relationship to the planet at any
 * zoom: a fixed pixel size made the dots swallow the globe when pulled right
 * out, and a fixed world size made the ring balloon on the way in.
 */
function globeRadiusPx() {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  const height = viewer?.renderer?.domElement?.clientHeight || 0;
  if (!camera || !height) return 0;
  const distance = Math.max(camera.position.length(), 1e-6);
  const fov = (camera.fov || 45) * Math.PI / 180;
  return (viewer.GLOBE_RADIUS / distance) * (height / (2 * Math.tan(fov / 2)));
}

/**
 * How much larger an earthquake's rings run than a plain category dot, and how
 * hard they breathe.
 *
 * Three rings inside eight pixels is a smudge; the symbol only means anything
 * at a size it can be resolved at. The pulse is deliberately shallow -- enough
 * to catch the eye as movement, not enough to make the map refuse to sit still
 * while somebody reads it -- and it is slow, at a little under one cycle a
 * second, because a fast pulse reads as an alarm.
 */
const QUAKE_SYMBOL_SCALE = 1.9;
/**
 * The dot size an earthquake's own scaling is applied to, capped.
 *
 * `dotSizePx` tops out at 16 px, which is right for a dot -- it is one marker
 * at one size, and 16 px close in is as much as anything should cover. An
 * earthquake then multiplies that by up to four for magnitude and 1.9 for the
 * symbol, so the same cap put a close-range M8 at 103 px, a ring wider than
 * the island it happened on. Capping the BASE rather than the result keeps the
 * magnitude ratios exact at every zoom: what stops growing on the way in is
 * the whole family together, not the big ones catching the small ones up.
 * Above the cap the far field is unaffected -- at a global view the dot is
 * 5.7 px, well under it.
 */
const QUAKE_BASE_CAP = 8;
/** A foot-anchored glyph occupies half its quad; this buys the half back. */
const GLYPH_FOOT_SCALE = 2;
const PULSE_PERIOD_MS = 1600;
const PULSE_SIZE = 0.16;
const PULSE_OPACITY = 0.3;

/**
 * Dot size in pixels: a fixed fraction of the globe, floored so a distant event
 * stays clickable and capped so a close one does not cover what it marks.
 */
/* ── naming what is on the screen ────────────────────────────────────────── */

/**
 * ANNOTATION, AND THE RULE THAT KEEPS IT FROM BECOMING A MESS.
 *
 * Bigger symbols answer half of "they become less distinct as we zoom in" — a
 * ▲ at 34 px is unmistakably a ▲. The other half is that a symbol says the
 * CATEGORY and never which event, and close in that is the question: standing
 * over Vanuatu you want to know it is Ambae, not that something volcanic is
 * somewhere near.
 *
 * The risk is the obvious one, and it is why this is deliberately timid rather
 * than clever. Events cluster — a fire complex is thirty markers inside a
 * county — and thirty chips over thirty markers is worse than none, so three
 * rules together decide what gets a name:
 *
 *   * **Only close in.** Above 150 km a label is smaller than the ground it
 *     would cover and there are too many markers on screen for any of them to
 *     be worth naming.
 *   * **Only a few.** Eight at most, taken nearest the middle of the view,
 *     because the middle is what somebody is looking at.
 *   * **Never overlapping.** A chip is placed only if its box clears every
 *     chip already placed, and the ones that cannot be placed are simply not
 *     drawn. Dropping a label is always better than stacking two.
 *
 * Screen space, not the 3D label engine: that one hangs a sphere marker beside
 * every chip, which over a marker that IS the symbol would draw the event
 * twice.
 */
const LABEL_ALTITUDE_M = 150000;
const LABEL_MAX = 8;
const LABEL_GAP_PX = 4;

let labelHost = null;
let labelPool = [];

function labelLayerHost() {
  if (labelHost && labelHost.isConnected) return labelHost;
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  const parent = canvas?.parentElement;
  if (!parent) return null;
  labelHost = document.createElement("div");
  labelHost.id = "events-labels";
  labelHost.setAttribute("aria-hidden", "true");
  // Never in the way of a click on the globe: the marker under it is the
  // thing you press, and the chip is only there to say what it is.
  labelHost.style.cssText = "position:absolute;inset:0;pointer-events:none;"
    + "overflow:hidden;z-index:5";
  parent.appendChild(labelHost);
  return labelHost;
}

function hideLabels() {
  labelPool.forEach((chip) => { chip.style.display = "none"; });
}

/** The chip for slot `i`, made once and reused: labels churn every frame. */
function labelChip(index) {
  if (labelPool[index]) return labelPool[index];
  const chip = document.createElement("div");
  chip.className = "event-label-chip";
  chip.style.cssText = "position:absolute;transform:translate(-50%,0);"
    + "white-space:nowrap;font:600 0.62rem/1.35 'Exo 2',system-ui,sans-serif;"
    + "letter-spacing:0.02em;padding:0.12rem 0.36rem;border-radius:0.28rem;"
    + "background:rgba(6,10,24,0.78);border:1px solid rgba(255,255,255,0.16);"
    + "color:#eaf3ff;text-shadow:0 1px 2px rgba(0,0,0,0.9);display:none";
  labelLayerHost()?.appendChild(chip);
  labelPool[index] = chip;
  return chip;
}

/** How much an event deserves the one label going spare. */
function labelRank(event) {
  if (Number.isFinite(event.magnitude)) return 100 + event.magnitude;
  return Number.isFinite(event.timeMs) ? event.timeMs / 1e12 : 0;
}

function drawLabels(camera, altitudeMetres, dotPx) {
  const host = labelLayerHost();
  if (!host || !THREE || !camera) return 0;
  if (!markers || !Number.isFinite(altitudeMetres) || altitudeMetres > LABEL_ALTITUDE_M) {
    hideLabels();
    return 0;
  }
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  const width = canvas?.clientWidth || 0;
  const height = canvas?.clientHeight || 0;
  if (!width || !height) { hideLabels(); return 0; }

  const candidates = [];
  const world = new THREE.Vector3();
  markers.children.forEach((points) => {
    const list = points.userData?.events;
    const truth = points.userData?.truePositions;
    if (!list || !truth) return;
    list.forEach((event, i) => {
      world.set(truth[i * 3], truth[i * 3 + 1], truth[i * 3 + 2]);
      points.localToWorld(world);
      // Behind the globe: the same test the markers themselves are culled by,
      // and a label for something over the horizon is a label pointing at
      // nothing.
      if (world.dot(camera.position) <= 0) return;
      const projected = world.clone().project(camera);
      if (projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return;
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      candidates.push({
        event,
        x,
        y,
        // Nearest the middle first, then by what the event is worth.
        d: Math.hypot(x - width / 2, y - height / 2) - labelRank(event) * 4,
      });
    });
  });
  candidates.sort((a, b) => a.d - b.d);

  const placed = [];
  let used = 0;
  for (const candidate of candidates) {
    if (used >= LABEL_MAX) break;
    const chip = labelChip(used);
    chip.textContent = candidate.event.title || candidate.event.categoryTitle || "Event";
    chip.style.display = "block";
    chip.style.left = `${Math.round(candidate.x)}px`;
    chip.style.top = `${Math.round(candidate.y + dotPx * 0.6)}px`;
    const box = chip.getBoundingClientRect();
    const rect = {
      left: candidate.x - box.width / 2 - LABEL_GAP_PX,
      right: candidate.x + box.width / 2 + LABEL_GAP_PX,
      top: candidate.y + dotPx * 0.6 - LABEL_GAP_PX,
      bottom: candidate.y + dotPx * 0.6 + box.height + LABEL_GAP_PX,
    };
    const clashes = placed.some((r) => !(rect.right < r.left || rect.left > r.right
      || rect.bottom < r.top || rect.top > r.bottom));
    if (clashes) { chip.style.display = "none"; continue; }
    placed.push(rect);
    used += 1;
  }
  for (let i = used; i < labelPool.length; i += 1) labelPool[i].style.display = "none";
  return used;
}

let sizeFrame = null;

/** Keeps marker size in step with the view. */
/**
 * The frame a coordinate actually lives in.
 *
 * latLonToVector3 answers in the globe's baseline frame -- the one the texture
 * is laid out in -- while the globe itself spins with simulated UTC. Placing a
 * marker at that raw answer leaves it however far the globe has turned since
 * midnight, which is why the offset grew through the day rather than being a
 * fixed amount that could be dialled out. Parenting to the globe mesh is not
 * the fix either: it carries a half-turn of its own on top of the spin.
 *
 * So: one group inside the scene frame, carrying the spin and nothing else.
 * Everything pinned to a coordinate goes in here and stays over its ground.
 */
function spinFrame() {
  const viewer = window.GeoIDViewer;
  const parent = viewer?.earthSceneGroup || viewer?.scene;
  if (!parent || !THREE) return null;
  if (!spun || spun.parent !== parent) {
    spun = new THREE.Group();
    spun.name = "eonet-spin-frame";
    parent.add(spun);
  }
  syncSpin();
  return spun;
}

function syncSpin() {
  const delta = window.GeoIDViewer?.getSpinDeltaRadians?.();
  if (spun && Number.isFinite(delta)) spun.rotation.y = delta;
}

function trackScale() {
  if (sizeFrame) return;
  const step = () => {
    // The chips are DOM and outlive the frame loop unless taken down with it.
    if (!active) { sizeFrame = null; hideLabels(); return; }
    // Held every frame, not set once: the globe keeps turning while the feed
    // is open, and a marker placed correctly at fetch time would walk off its
    // ground within the minute.
    syncSpin();
    // Before the sizing, and not inside its `px > 0` guard: what is round the
    // back must be hidden in every frame the markers are drawn in, including
    // the ones where the globe's projected size cannot be measured.
    const camera = window.GeoIDViewer?.camera;
    if (markers && camera) markers.children.forEach((p) => cullBehindGlobe(p, camera));
    const px = globeRadiusPx();
    if (px > 0 && markers) {
      const altitude = window.GeoIDViewer?.getZoomAltitudeMetres?.()?.metres;
      const size = dotSizePx(px, altitude);
      drawLabels(camera, altitude, size);
      // One phase for every marker, so a field of earthquakes pulses together
      // rather than shimmering: per-marker phases read as noise on the screen.
      const phase = (Math.sin((performance.now() / PULSE_PERIOD_MS) * Math.PI * 2) + 1) / 2;
      markers.children.forEach((points) => {
        const pulsing = points.userData.pulse;
        /**
         * THE CAP BELONGS TO THE MULTIPLIER, NOT TO THE PULSE.
         *
         * It read `pulsing ? …` because for a long time the only thing that
         * breathed was the seismicity, and the seismicity is the only thing
         * that multiplies this base — by 2.1 to 6.8 for magnitude and symbol.
         * The cap is what stops a close-range M8 reaching 103 px; it was never
         * about breathing. Giving the volcanoes a pulse therefore capped them
         * at eight pixels with nothing to multiply it back: measured at 20 km,
         * every other category was 34 px and the volcanoes **8.9**, which is
         * the reported "at zoomed views the location dots are far too small".
         */
        const cap = points.userData.baseCap;
        const from = cap ? Math.min(size, cap) : size;
        const want = from * (points.userData.sizeScale || 1)
          * (pulsing ? 1 + PULSE_SIZE * phase : 1);
        if (points.material.size !== want) points.material.size = want;
        if (pulsing) {
          // The glow, which is the bloom baked into the symbol coming up and
          // down with it. Opacity rather than emissive anything: a
          // PointsMaterial has no lighting to make brighter.
          points.material.opacity = 0.95 - PULSE_OPACITY + PULSE_OPACITY * phase;
        }
      });
    }
    sizeFrame = window.requestAnimationFrame(step);
  };
  sizeFrame = window.requestAnimationFrame(step);
}

/**
 * ONE TEXTURE PER GLYPH, so the globe draws what the legend promises.
 *
 * Reported as "aside from the earthquakes, none of the EONET live events have
 * the symbologies mapped as they should be". They did not: the earthquakes
 * had their own texture — three concentric rings, the ◎ the panel shows — and
 * every other category shared `markerTexture()`, one soft round blob. So a
 * legend offering ▲ for a volcano, ◉ for a storm, ◆ for ice, ▬ for a flood,
 * ▼ for a landslide, ❄ for snow and ■ for something manmade drew seven
 * identical dots, and the only thing separating them on the globe was hue.
 *
 * PAINTED WHITE and tinted by the material, exactly as the earthquake rings
 * are: one canvas per glyph rather than one per category, so the wildfires and
 * the volcanoes — both ▲ — share a texture and differ by colour, which is what
 * the legend says too.
 *
 * The stroke is not decoration. These are drawn over imagery at eight screen
 * pixels; a thin white glyph on a pale coast is invisible, and a dark outline
 * is what keeps ▲ readable against snow as well as against ocean.
 */
const glyphSprites = new Map();

/**
 * A SPRITE IS CENTRED ON ITS POINT, WHICH IS HALF A SYMBOL OF FLOAT.
 *
 * `THREE.Points` draws a screen-aligned quad centred on the coordinate, so
 * half the symbol is always above the ground it marks. That is invisible while
 * the symbol is small and glaring once it is not: at 8.9 px the volcanoes were
 * reported as fine, and at 34 px — the size asked for so they would stay
 * distinct close in — every category was reported as floating. Seventeen
 * pixels at 20 km altitude is about **750 m** of apparent height.
 *
 * So a category symbol STANDS ON its point: the ink is drawn in the upper half
 * of a canvas twice the height, which puts its base at the quad's centre and
 * therefore on the coordinate. The size is doubled to match, so the ink keeps
 * the pixels it was given rather than shrinking to half of them.
 *
 * The earthquake rings keep their centre. Concentric rings mean energy
 * radiating FROM a point, and standing them on the epicentre would say
 * something else — the one symbol here whose meaning is that it is centred.
 */
function glyphTexture(symbol) {
  if (!THREE) return null;
  /**
   * Keyed by what is DRAWN, not by the character: a symbol with a mark has a
   * `glyph` too — its stand-in — and keying on that would hand the cyclone
   * whatever texture the stand-in character had already built, and hand every
   * other category the cyclone if it happened to be built first.
   */
  const key = symbol?.mark ? `mark:${symbol.mark}` : String(symbol?.glyph || FALLBACK.glyph);
  if (glyphSprites.has(key)) return glyphSprites.get(key);
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  // SQUARE, because a `THREE.Points` quad is square and a 1:2 texture would be
  // squashed into it. The ink lives in the upper half instead, and the sprite
  // is asked for at twice the size so that half is the size it was meant to be.
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const font = (px) => `${Math.round(px)}px "Exo 2", system-ui, sans-serif`;
  /**
   * A PAINTER, so the ink fit below serves both kinds of symbol.
   *
   * Everything after this point — the probe pass, the bounding box, the
   * rescale and the offset that stands the ink on its point — is about where
   * the ink LANDED, and does not care whether it was typed or drawn. A drawn
   * symbol that skipped it would be the one marker in the feed not standing on
   * its own coordinate.
   */
  const character = (px, dx, dy) => {
    ctx.font = font(px);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.lineWidth = Math.max(2, px * 0.08);
    ctx.strokeText(symbol?.glyph || FALLBACK.glyph, size / 2 + dx, size / 2 + dy);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(symbol?.glyph || FALLBACK.glyph, size / 2 + dx, size / 2 + dy);
  };
  /**
   * The mark, drawn to the same box a character would fill, with a dark halo
   * for the reason the characters are stroked: a white symbol loses its edge
   * over bright imagery. `shadowBlur` rather than a stroke because the shape
   * comes as pixels and has no path to stroke.
   */
  const image = (img, px, dx, dy) => {
    const scale = px / Math.max(img.width, img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
    ctx.shadowBlur = Math.max(2, px * 0.06);
    // Twice, because one pass of shadow under a white shape is faint against
    // bright ground and the shadow is what keeps the edge.
    ctx.drawImage(img, size / 2 + dx - w / 2, size / 2 + dy - h / 2, w, h);
    ctx.drawImage(img, size / 2 + dx - w / 2, size / 2 + dy - h / 2, w, h);
    ctx.restore();
  };
  const paint = (px, dx, dy) => {
    const img = symbol?.mark ? markImage(symbol.mark, () => rebuild()) : null;
    if (img) image(img, px, dx, dy);
    else character(px, dx, dy);
  };

  /**
   * FITTED TO ITS OWN INK, because `textBaseline: "middle"` centres the EM BOX
   * and a geometric glyph does not fill it the way a letter does.
   *
   * Measured on the first cut: the wildfire dot ● came out 6 px of ink near the
   * top of the canvas and NOTHING in the lower half, and the flood bar ▬ sat
   * entirely below the middle. Both were centred exactly as asked — the em box
   * was — and both drew as a smudge in the corner of an 8-pixel sprite, which
   * at globe scale is a marker in the wrong place.
   *
   * So it is drawn once to find where the ink actually lands, then again scaled
   * to a common height and moved so that ink is in the middle. One pass costs a
   * canvas read per GLYPH, once, and it is what makes ● and ▲ and ▬ read as
   * the same weight of symbol rather than three accidents of font metrics.
   */
  /**
   * Wrapped, because the mark arrives LATE. The image is a fetch, so the first
   * build paints the stand-in character and this runs again the moment the
   * file lands — same canvas, same texture, `needsUpdate` and nothing else
   * rebuilt. Without it the markers keep whichever symbol happened to be
   * available in the frame they were created in.
   */
  function rebuild() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paint(size * 0.7, 0, 0);
  const probe = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let maxX = -1;
  let minY = canvas.height;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (probe[(y * canvas.width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (maxX >= minX && maxY >= minY) {
    const inkW = maxX - minX + 1;
    const inkH = maxY - minY + 1;
    /**
     * Fitted to the canvas' width as before, and to HALF its height — the ink
     * has only the upper half to live in now, because its base sits on the
     * middle. The stroke grows with the font, so neither fit reaches the very
     * edge or the outline is lost to the texture's border.
     */
    const scale = Math.min(3, (size * 0.62) / Math.max(inkW, inkH),
      (size * 0.46) / inkH);
    /**
     * `paint` anchors at (size / 2, size / 2) and the text is centred on that,
     * so the ink lands wherever its own bearings put it relative to the
     * anchor. Both offsets undo that: horizontally to bring the ink's centre
     * to the middle, vertically to bring its BASE to the canvas' own centre —
     * which is where the quad sits on the coordinate.
     */
    const offX = (size / 2 - (minX + maxX + 1) / 2) * scale;
    const centreY = (minY + maxY + 1) / 2;
    const offY = -(inkH * scale) / 2 - (centreY - size / 2) * scale;
    paint(size * 0.7 * scale, offX, offY);
  } else {
    paint(size * 0.7, 0, -size / 4);
  }
  if (built) built.needsUpdate = true;
  }

  let built = null;
  rebuild();
  built = new THREE.CanvasTexture(canvas);
  built.minFilter = THREE.LinearFilter;
  glyphSprites.set(key, built);
  return built;
}

let quakeSprite = null;

/**
 * The earthquake symbol: three concentric rings, drawn white.
 *
 * A dot says "something is here", which is what every other category needs. An
 * earthquake is a point source with energy radiating from it, and three rings
 * say that in the shorthand every seismicity map has used for a century — and,
 * unlike a dot, it stays legible when a dozen of them overlap along a
 * subduction zone, because you can see through it to the ones behind.
 *
 * Painted WHITE and tinted per point by the vertex colour, so one texture
 * serves the whole magnitude ramp rather than one canvas per band.
 *
 * The soft outer bloom is part of the texture rather than a second cloud: it
 * is what makes the pulse read as a glow rather than as a marker changing
 * size, and one texture is one draw call.
 */
function quakeTexture() {
  if (quakeSprite || !THREE) return quakeSprite;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size / 2;

  // The bloom first, so the rings sit on top of it.
  const glow = ctx.createRadialGradient(c, c, size * 0.16, c, c, c);
  glow.addColorStop(0, "rgba(255,255,255,0.22)");
  glow.addColorStop(0.6, "rgba(255,255,255,0.10)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineCap = "round";
  // Inner rings are drawn heavier: at a marker's real size on screen the outer
  // ring is a couple of pixels, and an even weight loses the centre entirely
  // -- which is the part that says where the earthquake was.
  [[0.17, 0.085], [0.31, 0.062], [0.45, 0.045]].forEach(([r, w]) => {
    ctx.lineWidth = size * w;
    ctx.beginPath();
    ctx.arc(c, c, size * r, 0, Math.PI * 2);
    ctx.stroke();
  });

  quakeSprite = new THREE.CanvasTexture(canvas);
  return quakeSprite;
}

/** Is this cloud one of the magnitude bands? */
const isQuakeBand = (key) => String(key).startsWith("quake-");
const isStormBand = (key) => String(key).startsWith("storm-");
/** The band a key stands for, back out of it. */
const bandNumber = (key) => Number(String(key).split("-")[1]);

/**
 * Somewhere no camera will look, for a marker that is round the back.
 *
 * A point whose clip position is this far out is discarded by the frustum, and
 * that is the whole mechanism: there is no per-point size or alpha on a
 * `PointsMaterial`, so hiding one means moving it.
 */
const OVER_THE_HORIZON = 1e9;

/**
 * The planet stops occluding the markers, so this does it instead.
 *
 * A point sprite is a screen-space quad and every fragment of it carries the
 * CENTRE's depth, so a depth-tested marker is cut wherever the ground in front
 * of it is nearer the camera than its own centre — which, on a sphere seen
 * obliquely, is most of the ground around it. That is why the rings came out
 * sliced along the curve: nothing was wrong with the symbol, the terrain was
 * simply winning the depth test across half the quad. A dot got away with it
 * because five pixels of quad is five pixels of ground; a thirty-pixel ring
 * does not.
 *
 * Lifting the markers higher would trade the cut for parallax — a marker
 * standing tens of kilometres off its own epicentre at close range — so the
 * depth test comes off and the horizon is worked out here instead: a point at
 * `p` is in front of the limb when `p · camera ≥ R²`, the tangent-plane
 * condition for a sphere, and that is exact rather than a fudge.
 *
 * The same fix serves the selection halo, which is one point drawn the same
 * way and was cut the same way.
 */
function cullBehindGlobe(points, camera) {
  const truth = points.userData?.truePositions;
  const attr = points.geometry?.getAttribute("position");
  if (!truth || !attr) return;
  points.updateMatrixWorld();
  // The camera in the marker's own frame: the clouds hang in the spin frame,
  // which is turning, so a world-space comparison drifts through the day.
  const cam = points.worldToLocal(camera.position.clone());
  const radius = window.GeoIDViewer?.GLOBE_RADIUS || 3.2;
  const horizon = radius * radius;
  const out = attr.array;
  let changed = false;
  for (let i = 0; i < truth.length; i += 3) {
    const visible = truth[i] * cam.x + truth[i + 1] * cam.y + truth[i + 2] * cam.z >= horizon;
    const x = visible ? truth[i] : OVER_THE_HORIZON;
    const y = visible ? truth[i + 1] : OVER_THE_HORIZON;
    const z = visible ? truth[i + 2] : OVER_THE_HORIZON;
    // All three compared, not just the first: the relief watcher rewrites the
    // truth as the exaggeration changes, and a marker can move in one axis
    // alone.
    if (out[i] === x && out[i + 1] === y && out[i + 2] === z) continue;
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
    changed = true;
  }
  // The upload is the cost here, so it happens only when something moved --
  // which, with the camera still, is nothing at all.
  if (changed) attr.needsUpdate = true;
}

function renderMarkers() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.scene || !THREE) return;
  if (markers) {
    markers.parent?.remove(markers);
    markers.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
    markers = null;
  }
  /**
   * AND A CARD FOR AN EVENT THAT IS NO LONGER DRAWN GOES WITH ITS MARKER.
   *
   * The layer can stay on while one event leaves it -- its feed unticked, or a
   * refresh that no longer lists it -- and the card would then describe a dot
   * that is not there, ring and all.
   */
  const card = byId("event-popup");
  if (card && !card.hidden && (!active || !events.some((e) => e.id === card.dataset.eventId))) {
    hidePopup();
  }
  if (!active || !events.length) {
    // Nothing drawn is not a layer, so the row goes with the markers.
    publishLayer();
    return;
  }

  // One point cloud per category, so each carries its own colour and the whole
  // feed costs a handful of draw calls rather than one per event.
  markers = new THREE.Group();
  markers.name = "eonet-events";
  const groups = new Map();
  events.forEach((event) => {
    const key = markerKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  const now = Date.now();
  groups.forEach((list, key) => {
    const positions = new Float32Array(list.length * 3);
    // The index of a hit point is all a raycast returns, so the events behind
    // each cloud are kept in the same order to look the hit back up.
    list.forEach((event, i) => {
      const v = markerPoint(viewer, event.lat, event.lon);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    /**
     * Recent is brighter, and it is a COLOUR rather than an opacity.
     *
     * Per-point alpha needs a vertex colour with four components, which not
     * every renderer path here honours; a dimmed hue does the same job in the
     * one channel that is certain to arrive. A week of earthquakes drawn
     * identically is a map of where faults are, which the fault layer already
     * says -- what the feed adds is when.
     */
    // Magnitude decides the colour, not the category: one hue for every
    // earthquake wastes the only channel that carries magnitude at a glance,
    // and green-through-red is the reading a hazard map does not have to
    // explain.
    const base = new THREE.Color(resolveColour(
      isQuakeBand(key) ? magnitudeColour(bandMagnitude(key)) : symbolFor(key).colour,
    ));
    if (list.some((e) => Number.isFinite(e.timeMs))) {
      const colours = new Float32Array(list.length * 3);
      list.forEach((event, i) => {
        const k = recencyOpacity(event.timeMs, now, RECENCY_WINDOW_MS);
        colours[i * 3] = base.r * k;
        colours[i * 3 + 1] = base.g * k;
        colours[i * 3 + 2] = base.b * k;
      });
      geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    }
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: geometry.attributes.color ? new THREE.Color(0xffffff) : base,
      vertexColors: Boolean(geometry.attributes.color),
      // The legend's own glyph, not a dot for everything that is not a quake.
      map: isQuakeBand(key) ? quakeTexture() : glyphTexture(symbolFor(key)),
      // Sized in screen pixels rather than world units: at globe scale a
      // world-sized point is a speck, and it should stay legible at any zoom.
      size: 8,
      sizeAttenuation: false,
      depthWrite: false,
      // NOT depth tested: see `cullBehindGlobe`. Every fragment of a point
      // sprite carries the centre's depth, so the ground in front of a marker
      // cuts the quad in half rather than occluding the marker. The far side
      // is hidden by the horizon test instead, which is what the depth test
      // was really being asked for.
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    }));
    /**
     * In front of everything anybody can load — until somebody says otherwise.
     *
     * The imported band runs 50 to 190 and its fills do not depth-test, so
     * whatever draws last wins there: an event has to be above all of it or a
     * geological map drawn afterwards paints over the thing being read. 230 is
     * the marker band in the draw-order table.
     *
     * It is the value the markers carry between being built and the layer
     * stack being applied. Once the feed is adopted as a layer, `applyStack`
     * owns this number — which is what makes the row draggable at all — and
     * gives it the top of the imported band by default. Both say the same
     * thing; only one of them can be argued with.
     */
    points.renderOrder = 230;
    points.name = `eonet-${key}`;
    points.userData.events = list;
    // The positions as built. What the geometry holds is these with whatever is
    // round the back moved out of the frustum, rewritten every frame.
    points.userData.truePositions = Float32Array.from(positions);
    // Points leave the frustum on purpose here, so the cloud must not be
    // culled for the bounding sphere that follows them out.
    points.frustumCulled = false;
    // The size the view gives every marker, times what this band earns. Held
    // here rather than written into `size`, because the per-frame scaler owns
    // that number and would otherwise flatten every band back to one size.
    // Earthquakes run larger than the flat 1x a category marker takes: three
    // rings inside eight pixels is a smudge, and the symbol is the point.
    /**
     * A foot-anchored glyph uses half its quad, so it is asked for at twice
     * the size — the ink then keeps the pixels the view meant it to have.
     * The rings are centred and need no such doubling.
     */
    /**
     * A STORM IS DRAWN AT ITS OWN STRENGTH, like an earthquake.
     *
     * And bigger than a category dot whatever its strength: the cyclone is a
     * SPIRAL, so it needs area to be a shape at all — a filled dot reads at
     * five pixels and this reads at nothing like it, which is the reported
     * "far too small to be seen".
     */
    points.userData.sizeScale = isQuakeBand(key)
      ? magnitudeSize(bandMagnitude(key), 1) * QUAKE_SYMBOL_SCALE
      : isStormBand(key) ? stormScale(bandNumber(key))
        : GLYPH_FOOT_SCALE;
    /**
     * Only what is about to be MULTIPLIED has its base capped: see the frame
     * step. A category dot has a scale of one and wants the size it was given,
     * while letting the zoom's own growth through as well would put a
     * close-range Category 5 past the size a driver will draw a sprite at.
     * Each band caps at its own value — a storm's symbol carries more detail
     * than a ring and goes small sooner.
     */
    points.userData.baseCap = isQuakeBand(key) ? QUAKE_BASE_CAP
      : isStormBand(key) ? STORM_BASE_CAP : null;
    /**
     * WHAT BREATHES, AND WHY NOT EVERYTHING.
     *
     * A pulse on every category is a map that will not sit still to be read.
     * It belongs on the markers that are reporting something still happening
     * while you look at them: the live seismicity catalogue, and now the
     * volcanoes, whose whole feed is "unrest reported now". The symbol table
     * says which — `pulse: true` beside the colour — so the choice sits with
     * the symbology rather than in a condition here.
     */
    points.userData.pulse = isQuakeBand(key) || Boolean(symbolFor(key).pulse);
    markers.add(points);
  });
  (spinFrame() || viewer.earthSceneGroup || viewer.scene).add(markers);
  trackScale();
  publishLayer();
}

/** Who the picture on the globe came from — every feed that is on, credited. */
/** The feeds that are ON, by name — "NASA EONET · USGS earthquakes". */
function sourceNames() {
  // Through `publisherOf`, so the provenance row and the card's "open the
  // record" link name the same organisation. Written out twice they drifted:
  // the link said USGS over a GDACS flood.
  const names = [...new Set(
    SOURCES.filter((src) => enabled.has(src.id)).map(publisherOf),
  )];
  return names.join(" · ") || "no feed selected";
}

function sourceCredits() {
  // Deduplicated: three USGS feeds are one credit, and a row reading
  // "USGS — public domain · USGS — public domain" says nothing twice.
  const credits = [...new Set(
    SOURCES.filter((src) => enabled.has(src.id)).map((src) => src.licence),
  )];
  return credits.join(" · ") || "no feed selected";
}

/** What the layer row says it is: "218 events in 4 categories". */
function layerSummary() {
  const kinds = new Set(events.map((event) => event.categoryId || "other"));
  const n = events.length;
  return `${n.toLocaleString()} event${n === 1 ? "" : "s"} in `
    + `${kinds.size} categor${kinds.size === 1 ? "y" : "ies"}`;
}

/**
 * The feed as a row in the layer box.
 *
 * It had none, which made it the one thing on the globe with no entry in the
 * list of what is on the globe: no eye to switch it off, no opacity, and no
 * place in the draw order anybody could see or change. The markers were held
 * above everything by a hard-coded renderOrder, which is the right DEFAULT and
 * the wrong rule — "always on top" is a decision the layer box exists to let
 * somebody take.
 *
 * Adopted rather than added: the markers hang in `eonet-spin-frame`, which
 * carries the spin its own way, so they must not be reparented into the
 * imported group. The whole frame is handed over — markers and the selection
 * ring — so switching the row off switches the feed's picture off entirely
 * while the feed itself keeps running.
 */
function publishLayer() {
  const manager = window.GeoIDImportManager;
  if (!manager?.adoptLayer) return;
  if (!active || !events.length || !spun) {
    manager.releaseLayer?.(LAYER_NAME);
    return;
  }
  const layer = manager.adoptLayer(LAYER_NAME, spun, {
    ext: "events",
    role: "events",
    info: { source: sourceNames(), citation: sourceCredits(), crs: "EPSG:4326", events: events.length },
    onRemove: () => setActive(false),
  });
  if (layer) {
    // Explained in its own drop-down, so not in the legend as well: that panel
    // already lists every category being drawn, with the same glyph and the
    // same colour, above the events themselves. `legendInfo` stays because the
    // layer box's own swatch and anything else reading the layer still want
    // it; only the legend card is suppressed.
    layer.legendHidden = true;
    layer.legendInfo = {
      palette: [...new Set(events.map((e) => e.categoryId || "other"))]
        .map((key) => String(resolveColour(symbolFor(key).colour)).replace("#", "")),
      labels: [...new Set(events.map((e) => e.categoryId || "other"))]
        .map((key) => symbolFor(key).label || key),
      categorical: true,
      classed: true,
      field: "category",
    };
    layer.info = {
      source: sourceNames(), citation: sourceCredits(), crs: "EPSG:4326",
      summary: layerSummary(),
    };
    /**
     * And on `metadata`, which is the surface the project registry and the
     * Metadata tab read. A live feed has a provenance as real as an
     * import's — which feeds are on, under what licence, in what CRS — and
     * it changes as feeds are ticked, so it is restated on every refresh.
     */
    layer.metadata = {
      ...(layer.metadata || {}),
      source: sourceNames(),
      citation: sourceCredits(),
      crs: "EPSG:4326",
      format: "live GeoJSON feed",
      featureCount: events.length,
      importedAt: new Date().toISOString(),
    };
  }
  // The stack has to be re-applied: a refresh builds new point clouds inside a
  // group whose renderOrder was stamped on the children that existed then, and
  // a child added afterwards starts at zero -- under the basemap.
  window.GeoIDLayerHierarchy?.render?.();
}

/**
 * @param on        whether the feed is running
 * @param remember  whether this is a CHOICE worth carrying to the next launch.
 *                  True for every gesture — the tick box, ticking a feed,
 *                  removing the layer — and false for the app's own moves:
 *                  leaving GIS puts the feed away because there is no globe to
 *                  pin events to, and persisting that would turn the feed off
 *                  for good the first time somebody opened the Model page.
 * @param launch    whether this is the automatic arming at boot, which takes
 *                  the feed and none of the furniture. See `armOnLaunch`.
 */
async function setActive(on, { remember = true, launch = false } = {}) {
  active = Boolean(on);
  if (remember) rememberActive(active);
  document.body.dataset.events = active ? "true" : "false";
  const row = byId("gis-group-events");
  if (row) row.classList.toggle("is-armed", active);
  // The control is a tick box, and it is set rather than read here: the mode
  // is also entered by ticking a feed, by leaving GIS, and by removing the
  // layer, and the box has to say what is true after any of those.
  const box = byId("events-mode-toggle");
  if (box) box.checked = active;
  // Entering opens the section, so the feeds that were just switched on are in
  // front of you instead of behind a fold. Leaving does NOT close it: putting
  // the controls away the moment somebody switches the view off is the app
  // deciding they are finished with them.
  //
  // A LAUNCH IS NOT AN ENTERING. Unfolding a sidebar section nobody opened is
  // the app deciding what you came to read, and the reasoning above only holds
  // for a gesture: "the feeds that were JUST SWITCHED ON" is a sentence about
  // somebody having switched them on.
  if (active && row && !launch) row.open = true;
  const host = byId("events-overlay");
  const panel = byId("events-panel");
  const toggle = byId("events-panel-toggle");
  if (host) {
    host.hidden = !active;
    // Entering the mode is a request to see the feed, so it opens on the list
    // rather than on a closed tab that has to be found and clicked.
    //
    // ON A LAUNCH TOO, and it has to CLAIM the slot to stay. The corner holds
    // one drop-down shared with the legend, and the legend opens itself when a
    // layer arrives — which at boot is the launch defaults, a second or two
    // after this. Opened without a claim the feed was simply overwritten by
    // whichever fetch landed last, which is why it used to arm shut. The claim
    // is a default and the reader's first press of either toggle ends it.
    if (active && panel) {
      panel.hidden = false;
      toggle?.setAttribute("aria-expanded", "true");
      if (launch) window.GeoIDOverlayStack?.claim?.("events-overlay");
      else window.GeoIDOverlayStack?.showOnly?.("events-overlay");
    }
    placeOverlay();
    if (!active && panel) {
      panel.hidden = true;
      toggle?.setAttribute("aria-expanded", "false");
    }
  }

  // Reading a feed against the globe means finding places on it, which a
  // turning planet makes needlessly hard. The spin stops while the mode is on
  // and is left off afterwards rather than forced back -- Space is the control
  // for it, and it should not be overridden behind the user.
  //
  // AND A LAUNCH LEAVES THE GLOBE ALONE. Stopping the spin is the right answer
  // to somebody arming the mode to go and look at something; as the opening
  // state of the app it is a decision about the whole page that nobody made
  // here, and it would arrive looking like a globe that had failed to start.
  if (!launch) {
    window.GeoIDModeManager?.setSpin?.(!active && window.GeoIDModeManager?.isSpinning?.());
  }

  window.clearInterval(timer);
  timer = null;
  if (!active) {
    events = [];
    hidePopup();
    renderMarkers();
    stopWatchingRelief();
    return;
  }
  if (!THREE) THREE = await import("../vendor/three.module.js");
  installPicking();
  watchRelief();
  await fetchEvents();
  timer = window.setInterval(fetchEvents, REFRESH_MS);
}

/**
 * Sits the feed immediately left of the legend, or in the legend's own slot when
 * there is no legend, so the two buttons read as one row.
 */
function placeOverlay() {
  const host = byId("events-overlay");
  const legend = byId("map-legend");
  if (!host) return;
  // The rail's own right offset, which steps left of the hazard readout when
  // the hub is armed. Read rather than recomputed, so the feed and the legend
  // cannot disagree about where the rail starts.
  const root = getComputedStyle(document.documentElement);
  const rem = parseFloat(root.fontSize || "16");
  const rail = parseFloat(root.getPropertyValue("--hazard-rail-w")) || 0;
  // Left of the readout when the hub is armed; in the tool rail's own slot
  // otherwise, which is what the 5.5rem clears.
  /**
   * AND LEFT OF AN OPEN WORKBENCH, by the same rule the legend's stylesheet
   * uses (`max(5.5rem, var(--workbench-w))`, in side-panels.js). This read the
   * rail and nothing else, so opening Settings stepped the legend left across
   * the screen and left this button where it was -- and the shared drop-down,
   * placed off both buttons, stayed over the workbench. Measured: legend
   * 901 → 534 px, events button 793 px before and after.
   */
  const bench = parseFloat(root.getPropertyValue("--workbench-w")) || 0;
  const base = Math.max(rail > 0 ? rail : 5.5 * rem, bench);
  /**
   * Written with `!important`, and that is a measurement rather than a habit.
   *
   * A plain inline `right` on this element is IGNORED: measured, writing
   * `right: 500px` inline left the box exactly where it was (right edge 1306
   * of a 1394 viewport, i.e. the stylesheet's own 5.5rem), while the same
   * value written `!important` put it at 894 to the pixel. So every offset
   * this function computed was correct, was written, was readable back off
   * `style.right` -- and never reached layout. That is why the feed sat on
   * top of the legend with both open: 102px of overlap, and the arithmetic
   * here innocent the whole time.
   *
   * The overriding declaration does not surface through enumeration -- not in
   * document.styleSheets (no rule sets right or inset with priority), not in
   * adoptedStyleSheets, not an animation -- so the honest fix is the one the
   * A/B supports rather than a guess at which sheet is at fault. If it is ever
   * found, this can go back to a plain write.
   */
  const setRight = (px) => host.style.setProperty("right", `${px}px`, "important");
  /**
   * MEASURE THE LEGEND'S TOGGLE, NEVER ITS CARD.
   *
   * The two sit side by side, so the feed's offset is the legend's own width —
   * and the legend's CARD is as wide as whatever is open inside it, so taking
   * that number made the events button move whenever the legend was opened and
   * again whenever a layer arrived. That is what the shuffle was for, and it
   * cost more than it fixed: a rotated, shrunken card behind the active one.
   *
   * The toggle is a fixed-width button and the panel hangs BELOW it, so
   * measuring the button keeps the two in one row whatever either panel is
   * doing. With no legend on screen the feed takes the legend's own slot.
   */
  const toggle = byId("map-legend-toggle");
  const shown = legend && !legend.hidden && toggle;
  const width = shown ? toggle.getBoundingClientRect().width : 0;
  setRight(base + (width ? width + 0.45 * rem : 0));
  // The drop-down's slot is measured off the two buttons, so it has to be
  // re-seated now that this one has moved, not on the next resize or click.
  window.GeoIDOverlayStack?.reseat?.();
}

/**
 * THE EVENT UNDER A SCREEN POINT, or null -- the one hit test, used by this
 * feed's own click AND published as `GeoIDEvents.markerAt`, so the other
 * pickers can ask before answering. Markers draw above every layer, so a
 * click on one belongs to it; without the question one click raised the
 * marker's card AND the card of whatever lay under it (a geology unit, a
 * volcano), and closing either left the other's highlight lit.
 *
 * IN SCREEN PIXELS, ON THE SYMBOL AS DRAWN (`markerHitGeometry`). It was a
 * raycaster whose threshold was the camera's distance to the planet's CENTRE
 * over the canvas height — about 3.2 units close in however near the ground,
 * so at 10 km up a marker claimed some 100 km of ground round it, and it took
 * the first hit along the ray rather than the marker nearest the cursor. Every
 * visible marker is projected instead, its hit circle put on its ink at its
 * drawn size, and the nearest wins. A few hundred projections a click.
 */
const pick = { v: null, cam: null };

function markerAt(clientX, clientY) {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!active || !markers || !canvas || !THREE) return null;
  // A hidden layer's markers are not there to be clicked.
  if (markers.visible === false) return null;
  if (!pick.v) { pick.v = new THREE.Vector3(); pick.cam = new THREE.Vector3(); }
  const { v, cam } = pick;
  const camera = viewer.camera;
  camera.getWorldPosition(cam);
  const rect = canvas.getBoundingClientRect();
  const candidates = [];
  for (const cloud of markers.children) {
    if (!cloud.isPoints || cloud.visible === false) continue;
    const truth = cloud.userData?.truePositions;
    const list = cloud.userData?.events;
    if (!truth || !list) continue;
    const key = String(cloud.name || "").replace(/^eonet-/, "");
    const { lift, radius } = markerHitGeometry(cloud.material?.size, isQuakeBand(key));
    cloud.updateWorldMatrix(true, false);
    for (let i = 0; i < list.length; i += 1) {
      v.set(truth[i * 3], truth[(i * 3) + 1], truth[(i * 3) + 2]).applyMatrix4(cloud.matrixWorld);
      // Round the back of the planet is not on screen, whatever the
      // projection says: the tangent-plane test `cullBehindGlobe` uses.
      if (v.dot(cam) < v.lengthSq()) continue;
      v.project(camera);
      if (v.z > 1) continue;
      candidates.push({
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height - lift,
        radius,
        item: list[i],
      });
    }
  }
  return nearestHit(candidates, clientX, clientY);
}

function installPicking() {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || !THREE || canvas.dataset.eonetPicking) return;
  canvas.dataset.eonetPicking = "true";
  let downAt = null;

  canvas.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerup", (e) => {
    // A drag is navigation, not a pick.
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    if (!active || !markers) return;
    // The Draw tool and the measure modes own the click while they are armed.
    if (viewer.isMeasuring?.()) return;
    const event = markerAt(e.clientX, e.clientY);
    if (event) {
      showPopup(event, e.clientX, e.clientY);
      setSelection(event);
      markRow(event.id);
      return;
    }
    hidePopup();
  });
}

let halo = null;
let haloFrame = null;
let flyFrame = null;

/**
 * A pulsing ring on the selected event, so the popup and the globe agree on
 * which one is being read. Parented to the globe like the markers, so it stays
 * on its event however the planet is turned.
 */
/**
 * Holds the ring on the dot's circumference. dotSizePx is a width and the ring's
 * scale is a radius, so it takes half the dot's width plus a little clearance.
 */
/**
 * THE SIZE THE MARKER IS ACTUALLY DRAWN AT, read off its own cloud.
 *
 * The ring used to be computed from the DOT and two fixed constants, which
 * assumed every marker is drawn at `dot * GLYPH_FOOT_SCALE`. That stopped
 * being true the moment a category got a size of its own: measured on
 * Hurricane Marie, a ring of 40.2 px around a 50.3 px symbol — inside the
 * thing it is meant to encircle — and 40.2 around the Category 3's 70.4.
 *
 * So it asks the cloud. That number is the truth by construction, it is
 * already updated every frame by the size step, and a band added later needs
 * nothing done here.
 */
function markerSpriteFor(key) {
  if (!markers || !key) return 0;
  let found = 0;
  markers.traverse((node) => {
    if (node.isPoints && node.name === `eonet-${key}`) found = node.material?.size || 0;
  });
  return found;
}


function applyHaloScale() {
  if (!halo) return;
  const marker = markerSpriteFor(halo.userData.markerKey);
  if (marker > 0) {
    halo.material.size = marker
      * (halo.userData.foot ? HALO_OVER_MARKER_FOOT : HALO_OVER_MARKER_CENTRED);
    return;
  }
  /**
   * Only where the cloud cannot be found — the markers are rebuilt on every
   * refresh, so a selection can outlive its own cloud for a frame. The old
   * arithmetic, which is right for a category drawn at the ordinary scale.
   */
  const px = globeRadiusPx();
  // The same altitude the dots are sized by, or the ring stops growing with
  // the dot it is meant to surround and ends up inside it close in.
  const altitude = window.GeoIDViewer?.getZoomAltitudeMetres?.()?.metres;
  // The floor is on the DOT rather than on the ring, so the ring's geometry
  // against the symbol is the same at every size -- applied to the result it
  // would break the proportion exactly where the sprite is smallest.
  const dot = Math.max(9, px > 0 ? dotSizePx(px, altitude) : 8);
  halo.material.size = dot * (halo.userData.foot ? HALO_FOOT_SCALE : 2.0);
}

/**
 * THE RING IS ANCHORED THE WAY THE SYMBOL IT CIRCLES IS.
 *
 * A category glyph STANDS ON its point: its ink lives in the upper half of its
 * canvas with the base on the coordinate, so half a symbol of it sits above
 * the ground. The earthquake rings stay centred, because concentric rings mean
 * energy radiating FROM a point and standing them on the epicentre would say
 * something else.
 *
 * A ring centred on the coordinate therefore circles the right PLACE and the
 * wrong PICTURE: reported on a flood, and the screenshot is a ring with the
 * dot sitting on its top edge. So there are two, and which one is used follows
 * the same `isQuakeBand` test the marker's own texture does -- the ring cannot
 * disagree with the symbol about where the symbol is.
 */
const GLYPH_INK = 0.46;                          // glyphTexture's own height fit
const INK_HEIGHT = GLYPH_INK * GLYPH_FOOT_SCALE; // 0.92 of a dot width, drawn
const RING_DIAMETER = INK_HEIGHT * 1.43;         // 1.32, the centred ring's own
/**
 * A ring standing clear of a symbol that already stands on its point needs
 * more room above the coordinate than below it, and a sprite is square -- so
 * the foot variant is asked for HALF AGAIN as large and the ring drawn small
 * inside it. At the centred scale the ring's top runs off the canvas.
 */
const HALO_FOOT_SCALE = 3;

/**
 * DECLARED HERE, BELOW WHAT THEY ARE DERIVED FROM, and read by a function
 * above them. `applyHaloScale` is a hoisted declaration and only reads these
 * when it is CALLED, so the order is fine — but a `const` evaluated before
 * `HALO_FOOT_SCALE` exists is a temporal dead zone error at module load, and
 * that takes the whole feed out. `node --check` parses and does not evaluate,
 * so it passes either way; the browser is what says which.
 */
/**
 * How much bigger the RING's sprite is than the marker's, so the ring lands
 * just outside the symbol.
 *
 * Both are derived rather than chosen, from the ring's own radius within its
 * texture and how much of a sprite each kind of symbol fills:
 *
 * - FOOT-ANCHORED. The ink is `GLYPH_INK` of the marker sprite and the ring is
 *   `1.43` times the ink, so the ring's drawn diameter wants to be 0.658 of
 *   the marker. The foot texture draws its ring at `0.22` of its own sprite,
 *   so the sprite must be 0.658 / (2 x 0.22) = 1.5 times the marker's — which
 *   is exactly `HALO_FOOT_SCALE / GLYPH_FOOT_SCALE`, the ratio the texture's
 *   geometry was derived at. The measured ring-on-ink of -0.07 px holds for
 *   any marker size on this rule, which is why it generalises.
 * - CENTRED. The earthquake rings fill their quad, so the ring wants to be a
 *   little OUTSIDE it — 1.04 — and the centred texture draws at 0.33 of its
 *   sprite: 1.04 / (2 x 0.33) = 1.58.
 */
const HALO_OVER_MARKER_FOOT = HALO_FOOT_SCALE / GLYPH_FOOT_SCALE;
const HALO_OVER_MARKER_CENTRED = 1.58;

const ringSprites = new Map();

/** A thin cyan annulus, sized to sit just outside the symbol it encircles. */
function ringTexture(foot) {
  const cached = ringSprites.get(foot);
  if (cached || !THREE) return cached || null;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Centred: a third of the sprite, so it lands close around the dot in the
  // middle of it. Foot-anchored: the same DRAWN diameter in a sprite that is
  // half again as big, with its centre lifted to where the ink's centre is --
  // half the ink's height above the coordinate, which the quad puts at the
  // canvas' own middle.
  const radius = foot ? (size * RING_DIAMETER) / 2 / HALO_FOOT_SCALE : size * 0.33;
  const cy = foot
    ? size * (0.5 - INK_HEIGHT / 2 / HALO_FOOT_SCALE)
    : size / 2;
  // A soft wide glow under a hard bright ring: the glow carries at a distance,
  // the ring keeps a definite edge close up.
  const weight = foot ? 2 / 3 : 1;
  ctx.lineWidth = size * 0.20 * weight;
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.arc(size / 2, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.085 * weight;
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.beginPath();
  ctx.arc(size / 2, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  ringSprites.set(foot, texture);
  return texture;
}

function setSelection(event) {
  const viewer = window.GeoIDViewer;
  if (halo) {
    halo.parent?.remove(halo);
    halo.geometry?.dispose?.();
    halo.material?.dispose?.();
    halo = null;
  }
  if (haloFrame) { window.cancelAnimationFrame(haloFrame); haloFrame = null; }
  if (!event || !(viewer?.earthSceneGroup || viewer?.scene) || !THREE) return;

  const position = markerPoint(viewer, event.lat, event.lon);
  // Drawn as a point sprite, exactly as the dots are. A world-space ring had to
  // be converted into pixels to match them and never quite did; sharing their
  // sizing path means it cannot be out by construction.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(
    new Float32Array([position.x, position.y, position.z]), 3,
  ));
  // The same test the marker's own texture is chosen by, so the two cannot
  // disagree about whether this symbol stands on its point or is centred on it.
  const foot = !isQuakeBand(markerKey(event));
  halo = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x52e4e8,
    map: ringTexture(foot),
    sizeAttenuation: false,
    depthWrite: false,
    // Not depth tested, and hidden past the limb by `cullBehindGlobe` instead:
    // it is the widest sprite the feed draws, so it was the most obviously cut
    // of all of them.
    depthTest: false,
    transparent: true,
    // Added rather than blended, so it lifts off whatever it is over instead of
    // washing into it -- the ring was legible against the sea and lost over
    // bright ground.
    blending: THREE.AdditiveBlending,
  }));
  halo.name = "eonet-selection";
  halo.userData.foot = foot;
  // Where it is, so the relief watcher can put it back there. A position is
  // not enough: the ground moves under it, and only the coordinate is stable.
  halo.userData.place = { lat: event.lat, lon: event.lon };
  // And WHICH CLOUD it belongs to, so the ring can be sized from the marker
  // rather than from an assumption about how big that marker is.
  halo.userData.markerKey = markerKey(event);
  halo.renderOrder = 231;
  halo.userData.truePositions = Float32Array.from([position.x, position.y, position.z]);
  halo.frustumCulled = false;
  // Sized before it is added, not on the first animation frame: left at unit
  // scale the ring is the radius of the globe, which showed as a huge flash.
  applyHaloScale();
  (spinFrame() || viewer.earthSceneGroup || viewer.scene).add(halo);

  const started = performance.now();
  const pulse = (now) => {
    if (!halo) return;
    // Size is held on the dot every frame, so it tracks a zoom as it happens.
    applyHaloScale();
    // And it goes round the back with the marker it is drawn around.
    const camera = window.GeoIDViewer?.camera;
    if (camera) cullBehindGlobe(halo, camera);
    /**
     * The ring follows the dots it is drawn around, half a step above them.
     *
     * It used to hold a fixed 231, which was right while the markers held a
     * fixed 230 and wrong the moment the feed became a layer somebody can drag
     * down the stack: a selection ring floating over a geological map that has
     * been deliberately put on top of the events is the ring lying about what
     * is in front. renderOrder is a float, so half a step is enough to keep it
     * off its own dots without leaving the layer's place in the stack.
     */
    const dots = markers?.children?.[0];
    if (dots) halo.renderOrder = (dots.renderOrder || 230) + 0.5;
    // And the card rides with the dot it describes.
    trackPopup();
    // The pulse is in brightness alone. Pulsing the size was what took the ring
    // off the dot it is meant to sit on: it can only stay on the circumference
    // if it stays that size.
    const t = ((now - started) % 1400) / 1400;
    halo.material.opacity = 0.6 + 0.4 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2));
    haloFrame = window.requestAnimationFrame(pulse);
  };
  haloFrame = window.requestAnimationFrame(pulse);
}

/**
 * Where the selected dot is on screen, or null where it cannot be seen.
 *
 * Read off the SELECTION RING rather than re-derived: the ring is already
 * re-placed on the ground as the relief moves and turned with the spin frame,
 * so its position is the marker's by construction. Hidden past the limb by the
 * same `p . camera >= R^2` test `cullBehindGlobe` uses, because a point on the
 * far hemisphere still projects to a plausible pixel -- a card placed there
 * would describe a dot on the other side of the planet.
 */
function dotOnScreen() {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  const canvas = viewer?.renderer?.domElement;
  const truth = halo?.userData?.truePositions;
  if (!camera || !canvas || !truth || !THREE) return null;
  halo.updateMatrixWorld();
  const local = new THREE.Vector3(truth[0], truth[1], truth[2]);
  const cam = halo.worldToLocal(camera.position.clone());
  const radius = viewer.GLOBE_RADIUS || 3.2;
  if (local.dot(cam) < radius * radius) return null;
  const ndc = halo.localToWorld(local.clone()).project(camera);
  if (ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + ((ndc.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    // Half the ring, in screen pixels: the card clears the ring, not only the
    // point at its centre.
    reach: (Number(halo.material?.size) || 20) / 2,
  };
}

/**
 * Put the open card beside its dot: to the right of the ring, or to the left
 * where the right would run off the window. Returns whether it could.
 *
 * `visibility`, never `hidden`: a card whose dot has gone round the back is
 * still OPEN -- its seismogram may be arriving -- and the trace loader treats
 * `node.hidden` as the card having moved on.
 */
function trackPopup() {
  const node = byId("event-popup");
  if (!node || node.hidden || node.dataset.tracking !== "1") return false;
  const at = dotOnScreen();
  if (!at) { node.style.visibility = "hidden"; return false; }
  node.style.visibility = "";
  const gap = 10;
  const rect = node.getBoundingClientRect();
  let left = at.x + at.reach + gap;
  if (left + rect.width > window.innerWidth - 12) left = at.x - at.reach - gap - rect.width;
  const top = Math.min(Math.max(12, at.y - rect.height / 3), window.innerHeight - rect.height - 12);
  node.style.left = `${Math.max(12, left)}px`;
  node.style.top = `${top}px`;
  return true;
}

/** Keeps the feed's highlight in step with whatever is selected. */
function markRow(id) {
  byId("events-panel-body")?.querySelectorAll(".event-row").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.id === id);
  });
}

function hidePopup() {
  window.GeoIDCardOwner?.release?.("event");
  const node = byId("event-popup");
  if (node) { node.dataset.tracking = ""; node.style.visibility = ""; }
  node?.setAttribute("hidden", "");
  setSelection(null);
  markRow(null);
}

/**
 * Placed at the click, then nudged back inside the window if it would spill.
 *
 * Kept as a function because the card CHANGES SIZE after it is placed: the
 * seismogram arrives seconds later and roughly doubles its height, so a card
 * opened low down would hang off the bottom of the window with the spectrogram
 * — the part that was asked for — below the fold.
 */
function placePopup(node, x, y) {
  // A card that follows its dot is placed by the frame loop, which re-reads
  // its size every frame -- the late seismogram included.
  if (node.dataset.tracking === "1" && halo) { trackPopup(); return; }
  if (Number.isFinite(x)) node.dataset.anchorX = String(x);
  if (Number.isFinite(y)) node.dataset.anchorY = String(y);
  const atX = Number(node.dataset.anchorX) || 0;
  const atY = Number(node.dataset.anchorY) || 0;
  const rect = node.getBoundingClientRect();
  const left = Math.min(atX + 12, window.innerWidth - rect.width - 12);
  const top = Math.min(atY + 12, window.innerHeight - rect.height - 12);
  node.style.left = `${Math.max(12, left)}px`;
  node.style.top = `${Math.max(12, top)}px`;
}

/**
 * The earthquake, as it was recorded.
 *
 * A magnitude and a depth are what an earthquake is filed as; a seismogram is
 * what it IS — ground moving, over about a minute, at frequencies that say how
 * far away it happened. That record was three panels and a form away, so
 * almost nobody saw it. This puts it under the numbers that describe it.
 *
 * Two pictures, because neither answers the other's question. The waveform is
 * WHEN and HOW HARD: the P arrival, the S arrival, the coda dying away. The
 * spectrogram is AT WHAT FREQUENCIES, which is what separates a local event
 * from a teleseism — distance is a low-pass filter, so a far earthquake
 * arrives with its high frequencies stripped off however large it was.
 */
let tracePass = 0;

/**
 * What each archive answered, kept per event.
 *
 * Re-opening a card, or clicking the same earthquake in the list and then on
 * the globe, must not send a second pair of requests to somebody else's
 * archive for a trace already in hand. Bounded, because a session that browses
 * two hundred earthquakes should not hold two hundred traces: each is tens of
 * thousands of samples.
 */
const traceCache = new Map();
const TRACE_CACHE_MAX = 8;

function rememberTrace(id, out) {
  traceCache.set(id, out);
  while (traceCache.size > TRACE_CACHE_MAX) traceCache.delete(traceCache.keys().next().value);
}

/**
 * The arrivals: measured from the trace where they can be, predicted where
 * they cannot, and never the two looking alike.
 *
 * The predicted times were what the card drew first, and they were reported as
 * wrong because they ARE: a crustal velocity and a straight line take no
 * account of the ray's path down through the crust and back, so at 240 km the
 * model ran fourteen seconds early against a pick anybody could see. The trace
 * knows better than the model, so the trace is asked first — a solid mark is
 * something read off this record, a dashed one is where a rule of thumb says
 * it should have been.
 */
function arrivalMarks(event, out, plot) {
  const trace = out.trace;
  const values = trace.values;
  const fs = trace.sampleRate;
  const stationKm = Number(out.station?.km);
  const expectedGap = plot.expectedSP(stationKm);
  const predicted = plot.arrivalTimes({
    distanceKm: out.station?.km,
    depthKm: event.depthKm,
    originMs: event.timeMs,
    startMs: out.startMs,
    sampleRate: fs,
    sampleCount: values.length,
  });

  const p = plot.detectOnset(values, fs);
  const sPicked = p == null ? null : plot.detectSecondary(values, fs, {
    afterSeconds: p, expectedGapSeconds: expectedGap,
  });

  const marks = [];
  const span = values.length / fs;
  const inWindow = (t) => t != null && t >= 0 && t <= span;

  let pAt = null;
  if (p != null) {
    pAt = p;
    marks.push({ t: p, label: "P", colour: "var(--skin-data)", dashed: false });
  } else if (predicted?.inWindow) {
    pAt = predicted.p;
    marks.push({ t: predicted.p, label: "P", colour: "var(--skin-data)" });
  }

  let sAt = null;
  let sMeasured = false;
  if (sPicked != null) {
    sAt = sPicked;
    sMeasured = true;
    marks.push({ t: sPicked, label: "S", colour: "var(--skin-chrome)", dashed: false });
  } else if (pAt != null && expectedGap && inWindow(pAt + expectedGap)) {
    // Anchored to the P that was actually read, not to the model's own P:
    // relative timing survives everything absolute timing gets wrong.
    sAt = pAt + expectedGap;
    marks.push({ t: sAt, label: "S", colour: "var(--skin-chrome)" });
  } else if (predicted?.sInWindow) {
    sAt = predicted.s;
    marks.push({ t: predicted.s, label: "S", colour: "var(--skin-chrome)" });
  }

  const sp = p != null && sMeasured ? sAt - pAt : null;
  return {
    marks,
    predicted,
    pMeasured: p != null,
    sMeasured,
    sp,
    spKm: plot.distanceFromSP(sp),
    stationKm: Number.isFinite(stationKm) ? stationKm : null,
    expectedGap,
    kmPerSecond: plot.SP_KM_PER_SECOND,
  };
}

/** The S−P readout: the oldest distance measurement there is, and its check. */
function spReadout(a) {
  if (a.sp == null) return "";
  const check = a.stationKm != null
    ? `<span>station ${Math.round(a.stationKm)} km away</span>` : "<span></span>";
  return `<div class="event-trace-axis is-measure">
      <span><strong>S−P ${a.sp.toFixed(1)} s</strong> → about `
    + `${Math.round(a.spKm)} km</span>${check}</div>`;
}

/** What the marks mean, said once under the picture rather than guessed at. */
function arrivalCaption(a) {
  const parts = [];
  if (a.sp != null) {
    parts.push(`P and S read from the trace: one second of S−P is about `
      + `${a.kmPerSecond.toFixed(1)} km, which is a single station's own way of `
      + "saying how far away the earthquake was");
  } else if (a.pMeasured) {
    parts.push("P read from the trace; S was not picked, so the dashed S is where "
      + "the crustal model puts it after that P");
  } else if (a.predicted?.tooFar) {
    parts.push("Too far for a crustal model to place the arrivals — the ray turns "
      + "through the mantle at that distance");
  } else if (a.predicted) {
    parts.push(`No arrival stood out of the noise, so both marks are the model's: `
      + `${a.predicted.model} over ${a.predicted.path.toFixed(0)} km`);
  }
  return parts.length ? `${parts.join("")}.` : "";
}

/**
 * The earthquake, as it was recorded.
 *
 * A magnitude and a depth are what an earthquake is filed as; a seismogram is
 * what it IS — ground moving, over about a minute, at frequencies that say how
 * far away it happened. That record was three panels and a form away, so
 * almost nobody saw it. This puts it under the numbers that describe it.
 *
 * Two pictures, because neither answers the other's question. The waveform is
 * WHEN and HOW HARD: the P arrival, the S arrival, the coda dying away. The
 * spectrogram is AT WHAT FREQUENCIES, which is what separates a local event
 * from a teleseism — distance is a low-pass filter, so a far earthquake
 * arrives with its high frequencies stripped off however large it was.
 */
async function showTrace(event) {
  const node = byId("event-popup");
  const host = node?.querySelector(".event-trace");
  if (!host) return;
  // Every request carries a ticket. A trace takes seconds to arrive over two
  // archives, and in that time somebody can close the card or click another
  // earthquake -- and an answer drawn into a popup that has moved on is worse
  // than no answer, because it is a picture of the wrong event under the right
  // title.
  tracePass += 1;
  const pass = tracePass;
  const stale = () => pass !== tracePass || node.hidden || node.dataset.eventId !== event.id;

  host.hidden = false;
  node.classList.add("has-trace");

  let out = traceCache.get(event.id);
  if (!out) {
    host.innerHTML = '<p class="event-trace-note">Looking for a station that recorded it…</p>';
    placePopup(node);
    try {
      out = await window.GeoIDEarthData?.seismogramNear?.(
        event.lat, event.lon, event.timeMs, { focusPanel: false },
      );
    } catch (error) {
      out = { ok: false, message: error.message };
    }
    if (out) rememberTrace(event.id, out);
    if (stale()) return;
  }
  if (!out?.ok) {
    host.innerHTML = `<p class="event-trace-note">${out?.message || "No trace available."}</p>`;
    placePopup(node);
    return;
  }

  const [plot, { spectrogram }] = await Promise.all([
    import("./seismogram-plot.js?v=20260912-7310b6e"),
    import("./research/dsp.js?v=20260912-7310b6e"),
  ]);
  if (stale()) return;

  const { trace } = out;
  const arrivals = arrivalMarks(event, out, plot);
  const band = plot.displayBand(trace.sampleRate);
  const seconds = trace.values.length / trace.sampleRate;
  host.innerHTML = `
    <div class="event-trace-head">
      <strong>${trace.id}</strong>
      <span>${out.station?.km ? `${Math.round(out.station.km)} km · ` : ""}`
        + `${trace.sampleRate} Hz · ${trace.durationS.toFixed(0)} s</span>
    </div>
    <canvas class="event-trace-wave"></canvas>
    <div class="event-trace-axis"><span>ground motion, counts</span><span>time →</span></div>
    ${spReadout(arrivals)}
    <canvas class="event-trace-spec"></canvas>
    <div class="event-trace-axis"><span>0–${band.toFixed(0)} Hz</span><span>quiet → loud</span></div>
    ${arrivalCaption(arrivals)
    ? `<p class="event-trace-note">${arrivalCaption(arrivals)}</p>` : ""}
    ${out.problems?.length
    ? `<p class="event-trace-note">${out.problems.length} record(s) failed their `
      + "integrity check and were dropped.</p>"
    : ""}
    ${out.saved ? '<p class="event-trace-note">Saved to the project — the Signal '
      + "pages will list it.</p>" : ""}`;

  const values = trace.values;
  drawWave(plot, host, values, trace, event, arrivals.marks);
  /**
   * The window is a compromise this had better state.
   *
   * 256 samples is 2.56 s at 100 Hz: fine enough in time to see the P and S
   * arrivals as separate columns, coarse enough in frequency (0.4 Hz bins) to
   * be useless below about half a hertz. That is the wrong trade for a
   * teleseism and the right one for everything else at this size, and a popup
   * is not the place to offer the choice -- the Signal pages are, and the
   * trace is already saved there.
   */
  plot.drawSpectrogram(
    host.querySelector(".event-trace-spec"),
    spectrogram(Array.from(values), trace.sampleRate, { segment: 256, dB: true }),
    { sampleRate: trace.sampleRate, marks: arrivals.marks, seconds },
  );
  // The card is a good deal taller than it was when it was placed.
  placePopup(node);
}

function drawWave(plot, host, values, trace, event, marks) {
  plot.drawWaveform(host.querySelector(".event-trace-wave"), values, {
    // The trace wears its own earthquake's colour, so a card and its marker
    // are obviously the same event.
    colour: magnitudeColour(event.magnitude),
    sampleRate: trace.sampleRate,
    marks,
  });
}

function showPopup(event, x, y) {
  const node = byId("event-popup");
  if (!node) return;
  const symbol = symbolFor(event.categoryId);
  const source = event.sourceId ? sourceById(event.sourceId) : null;
  const when = event.date
    ? new Date(event.date).toLocaleString()
    : (Number.isFinite(event.timeMs) ? new Date(event.timeMs).toLocaleString() : "date not given");
  // An earthquake's own numbers, which are the reason to click on one: the
  // magnitude and how deep it was. A category and a title do not separate a
  // destructive shallow M6 from a harmless M6 six hundred kilometres down.
  // Asked by CATEGORY: a GDACS flood has a source id and no magnitude, and
  // read off `sourceId` these rows said "undetermined" and "not reported"
  // about a flood, which is an earthquake's answer to an earthquake's question.
  const seismic = isQuake(event) ? `
      <dt>Magnitude</dt><dd>${Number.isFinite(event.magnitude)
        ? `M ${event.magnitude.toFixed(1)}` : "undetermined"}</dd>
      <dt>Depth</dt><dd>${Number.isFinite(event.depthKm)
        ? `${event.depthKm.toFixed(1)} km` : "not reported"}</dd>
      ${event.tsunami ? "<dt>Tsunami</dt><dd>flagged by the USGS</dd>" : ""}` : "";
  /**
   * A storm's own number, which is now what decides how big its marker is.
   * A card that says nothing about the strength the map is drawn at leaves
   * the reader to infer it from the size of a symbol.
   */
  const storm = event.categoryId === "severeStorms"
    && Number.isFinite(event.magnitudeValue)
    ? `<dt>Strength</dt><dd>${stormLabel(stormCategory(event.magnitudeValue),
      event.magnitudeValue)}</dd>` : "";
  node.dataset.eventId = event.id;
  node.classList.remove("has-trace");
  node.innerHTML = `
    <button type="button" class="event-popup-close" aria-label="Close">×</button>
    <div class="event-popup-head">
      ${glyphSpan(symbol)}
      <span>${event.categoryTitle || symbol.label}</span>
    </div>
    <h3>${event.title}</h3>
    <dl>${seismic}${storm}
      <dt>Position</dt><dd>${event.lat.toFixed(3)}°, ${event.lon.toFixed(3)}°</dd>
      <dt>Last report</dt><dd>${when}</dd>
      <dt>Source</dt><dd>${source ? source.licence.split(" — ")[0] : "NASA EONET"} · ${event.id}</dd>
    </dl>
    ${event.link ? `<a href="${event.link}" target="_blank" rel="noopener">Open the ${publisherOf(source, { short: true })} record</a>` : ""}
    <div class="event-popup-actions">
      <button type="button" class="button secondary" data-role="fly">Bring into view</button>
    </div>
    <div class="event-trace" hidden></div>`;
  node.removeAttribute("hidden");
  node.style.visibility = "";
  setSelection(event);
  node.dataset.tracking = halo ? "1" : "";
  // The card goes when the feed's layer does: hidden with its eye in
  // Workspace, removed, or the mode switched off -- see card-owner.js.
  window.GeoIDCardOwner?.own?.("event", LAYER_NAME, hidePopup);
  // Beside the dot at once where it is on screen; at the pointer for the one
  // frame before the loop takes over if it is not (a dot click is always on
  // screen, so that is a row whose event is round the back -- the fly brings
  // it into view and the card appears beside it when it arrives).
  if (!trackPopup()) placePopup(node, x, y);
  node.querySelector(".event-popup-close")?.addEventListener("click", hidePopup);
  node.querySelector('[data-role="fly"]')?.addEventListener("click", () => {
    focusOn(event.lat, event.lon);
  });
  /**
   * An earthquake's card fetches its own seismogram, rather than offering to.
   *
   * "Seismogram near here" was a button in front of the only thing on the card
   * that is not already in the title: the magnitude, the depth and the place
   * are all in the two lines above it, and the record is what somebody opened
   * an earthquake to see. A button in front of the answer is a button asking
   * whether you meant it.
   *
   * It is polite about the archives all the same: one click is one trace, the
   * result is cached per event, and nothing is fetched for a card nobody
   * opened.
   *
   * AND ONLY AN EARTHQUAKE'S. Gated on `sourceId` this fired for the GDACS
   * floods too, and `seismogramNear` always finds SOMETHING: measured on a
   * flood in China, a trace from a station 687 km away, drawn with its
   * spectrogram and annotated "P read from the trace". Nothing in that picture
   * is about the flood, and every part of it says otherwise. A card that
   * cannot say what a seismogram would mean does not fetch one.
   */
  if (isQuake(event) && window.GeoIDEarthData?.seismogramNear) void showTrace(event);
}

function init() {
  // The tick sits inside the section's <summary>, so a click on it is also a
  // click on the summary: without this, arming the mode folds away the panel
  // of feeds it just switched on.
  const modeBox = byId("events-mode-toggle");
  modeBox?.addEventListener("click", (event) => event.stopPropagation());
  modeBox?.addEventListener("change", () => { void setActive(modeBox.checked); });
  // The feeds are drawn before anything is fetched: ticking one is the way in.
  renderFeeds();
  const toggle = byId("events-panel-toggle");
  toggle?.addEventListener("click", () => {
    const panel = byId("events-panel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
  });
  // The legend's width drives where this sits, so follow anything that changes
  // it: layers appearing or going, its panel opening, and the window resizing.
  document.getElementById("map-legend-toggle")?.addEventListener("click", () => {
    window.requestAnimationFrame(placeOverlay);
  });
  window.addEventListener("geoid-gis:layers-changed", () => {
    window.requestAnimationFrame(placeOverlay);
  });
  // The legend now opens itself when a layer arrives, so its width can change
  // without anyone having clicked the toggle this listens to above.
  window.addEventListener("geoid:legend-changed", () => {
    window.requestAnimationFrame(placeOverlay);
  });
  window.addEventListener("resize", placeOverlay);
  // Escape drops the selection, the way it dismisses the other overlays.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("event-popup")?.hidden) hidePopup();
  });
  window.setInterval(placeOverlay, 1000);
  // The overlay sits over the scene, so it hangs off <body> like the legend.
  const overlay = byId("events-overlay");
  if (overlay && overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }
  // Leaving GIS puts the feed away: there is no globe to pin events to. NOT
  // remembered -- that is the app moving, not a choice about the feed, and
  // storing it would switch the feed off for good the first time somebody
  // opened the Model page.
  window.addEventListener("geoid-gis:mode-change", (event) => {
    if (event.detail?.mode !== "gis" && active) {
      setActive(false, { remember: false });
      return;
    }
    // And coming back to the globe brings it with you, on the same terms.
    if (event.detail?.mode === "gis" && !active) armOnLaunch();
  });
  armOnLaunch();
}

/**
 * THE FEED IS ON WHEN THE PAGE OPENS.
 *
 * It takes the feed and its own drop-down, and none of the rest of the
 * furniture — no unfolded sidebar section, no stopped globe — each of which is
 * argued at the branch that skips it. Those belong to somebody arming the mode
 * to go and look at something; at boot they are the app deciding what you came
 * for. The drop-down is the exception because it IS the feed: a list of what
 * is happening on the globe right now, beside the markers that say where.
 *
 * It waits for the viewer rather than assuming one: the markers hang off the
 * globe's own spin frame, so armed too early the fetch lands with nowhere to
 * draw. Bounded, and it gives up quietly — a page with no viewer after twelve
 * seconds has a bigger problem than the feed, and a poll that runs for the
 * life of the tab to arm something is worse than an unarmed feature.
 */
let armTries = 0;
function armOnLaunch() {
  if (active || !wantedActive()) return;
  // Only over a globe. The page restores whatever mode it was left in, and
  // arming a globe overlay while the Model studio is up puts markers on
  // nothing and fetches sixteen feeds for a page that cannot show them.
  const mode = window.GeoIDModeManager?.getMode?.();
  if (mode && mode !== "gis") return;
  if (!window.GeoIDViewer) {
    if (armTries >= 40) return;
    armTries += 1;
    window.setTimeout(armOnLaunch, 300);
    return;
  }
  void setActive(true, { remember: false, launch: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/**
 * A SECOND DOOR TO A FEED IS NOT A SECOND FEED.
 *
 * `data-feed-toggle` on any box in the page makes it a proxy for the source it
 * names: it READS its state back off `enabled` and COMMITS through
 * `setSourceEnabled`, so there is one state and two places to reach it, and
 * neither can drift from the other. The Tropical cyclones subtab carries one
 * for the severe-storm feed, beside the archive of the same phenomenon.
 *
 * The tabs still divide the way they did — Live holds what HAPPENED, Hazards
 * what COULD — and a blanket proxy on every hazard subtab is what was removed
 * for putting one dataset in two tabs. What makes this one worth its
 * duplication is that the reader of a cyclone archive is the likeliest person
 * in the app to want to know what is on the ocean this morning; a row that
 * only tells them to go to another tab is a trip, not an answer.
 *
 * NO POLL. The old version ran a 900 ms interval hunting for boxes. Every
 * change of this state already goes through `renderFeeds`, so the sync is one
 * call at the top of it — including the restore at boot, which is where a
 * proxy would otherwise open unticked over a feed that is running.
 */
function syncFeedProxies() {
  // A host names the feed it wants and is FILLED with Live's own row template,
  // once: rebuilding it on every sync would drop the reader's hover mid-press.
  document.querySelectorAll("[data-feed-proxy]").forEach((host) => {
    if (host.querySelector("[data-feed-toggle]")) return;
    const src = sourceById(host.dataset.feedProxy);
    host.innerHTML = src ? sourceRow(src, "data-feed-toggle")
      : `<span class="compact-copy">No feed is registered as "${host.dataset.feedProxy}".</span>`;
  });
  document.querySelectorAll("[data-feed-toggle]").forEach((box) => {
    const id = box.dataset.feedToggle;
    // A box naming a source that no longer exists is a stale id, not a feed
    // that is off — the trap the EONET rename cost. It is left alone and
    // reported, rather than being drawn as an honest empty tick.
    if (!sourceById(id)) {
      box.disabled = true;
      box.title = `No feed is registered as "${id}".`;
      return;
    }
    const on = isSourceEnabled(id);
    if (box.checked !== on) box.checked = on;
  });
}

if (typeof document !== "undefined") {
  // Delegated: these boxes live in tab markup that is redrawn around them, and
  // a handler bound to the node goes stale the first time that happens.
  document.addEventListener("change", (event) => {
    const box = event.target?.closest?.("[data-feed-toggle]");
    if (!box || box.disabled) return;
    setSourceEnabled(box.dataset.feedToggle, box.checked);
  });
}

window.GeoIDEvents = {
  setActive, isActive: () => active, getEvents: () => events, SYMBOLS,
  setSourceEnabled, isSourceEnabled: (id) => enabled.has(id),
  // Asked by the other pickers before they answer a click: see `markerAt`.
  markerAt,
  // Re-seat the feed when the rail moves under it -- arming the hub
  // shifts the whole rail left of the hazard readout.
  reflow: placeOverlay,
};
