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
  activeGroups, sourcesInGroup, groupState, defaultEnabled, restoreSources, gdacsPoints } from "./event-sources.js?v=20260901-c5e9dd8";

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
const MARKER_LIFT = 0.006;

/**
 * Where a marker sits: on the globe's own displaced surface, so it rides the
 * terrain and the relief slider the way the basemap does, rather than on a
 * sphere floating over it.
 */
function markerPoint(viewer, lat, lon) {
  return viewer.surfacePoint
    ? viewer.surfacePoint(lat, lon, MARKER_LIFT)
    : viewer.latLonToVector3(lat, lon, viewer.GLOBE_RADIUS + MARKER_LIFT);
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
    const relief = viewer.getEffectiveRelief();
    if (lastRelief !== null && Math.abs(relief - lastRelief) < 1e-4) return;
    lastRelief = relief;
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
const SYMBOLS = {
  wildfires: { colour: "#ff6b2c", glyph: "▲", label: "Wildfires" },
  volcanoes: { colour: "#ff2bd6", glyph: "▲", label: "Volcanoes" },
  severeStorms: { colour: "#52e4e8", glyph: "◉", label: "Severe storms" },
  seaLakeIce: { colour: "#bfe9ff", glyph: "◆", label: "Sea and lake ice" },
  floods: { colour: "#2f6bff", glyph: "▬", label: "Floods" },
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

const symbolFor = (id) => (
  String(id).startsWith("quake-") ? SYMBOLS.earthquakes : (SYMBOLS[id] || FALLBACK)
);

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
  if (!event.sourceId) return event.categoryId || "other";
  const m = Number.isFinite(event.magnitude) ? event.magnitude : 3;
  return `quake-${Math.max(1, Math.min(8, Math.round(m)))}`;
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
const STORE_KEY = "geoid-gis:event-sources";
let enabled = new Set(defaultEnabled());
try {
  // Through `restoreSources`, which knows what the ids used to be: a plain
  // filter drops anything renamed since, and dropping the id EONET used to be
  // stored under left returning users with the earthquakes and nothing else.
  enabled = restoreSources(JSON.parse(window.localStorage.getItem(STORE_KEY) || "null"));
} catch (error) { /* no storage, keep the defaults */ }

function rememberSources() {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify([...enabled]));
  } catch (error) { /* no storage, the choice is still live this session */ }
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
  syncFeedProxies();
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
      return { lon: c[0], lat: c[1], date: g.date };
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
  const seismic = events.filter((e) => e.sourceId).length;
  const natural = events.length - seismic;
  const categories = new Set(
    events.filter((e) => !e.sourceId).map((e) => e.categoryTitle).filter(Boolean),
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
function sourcesBlock() {
  return `<div class="event-sources">
    ${activeGroups().map((group) => {
    const state = groupState(group.id, isSourceEnabled);
    const rows = sourcesInGroup(group.id).map((src) => {
      const symbol = symbolFor(src.category);
      return `<label class="event-source" title="${src.note} — ${src.licence}">
          <input type="checkbox" data-feed="${src.id}"${isSourceEnabled(src.id) ? " checked" : ""}>
          <span class="event-glyph" style="color:${symbol.colour}">●</span>
          <span class="event-source-name">${src.label}</span>
        </label>`;
    }).join("");
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
            <span class="event-glyph" style="color:${symbol.colour}">${symbol.glyph}</span>
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
      <span class="event-glyph" style="color:${symbol.colour}">${symbol.glyph}</span>
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
    const glyph = `<span class="event-glyph" style="color:${symbol.colour}">${symbol.glyph}</span>`;

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
  // The popup is placed at the pointer when a marker is picked, and beside the
  // feed when a row is, so it never lands on top of what was clicked.
  const point = at || feedAnchor();
  showPopup(event, point.x, point.y);
}

/** A spot just left of the feed, for popups opened from the list. */
function feedAnchor() {
  const overlay = byId("events-overlay");
  if (!overlay) return { x: 80, y: 120 };
  const rect = overlay.getBoundingClientRect();
  return { x: Math.max(20, rect.left - 300), y: rect.top + 40 };
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
const PULSE_PERIOD_MS = 1600;
const PULSE_SIZE = 0.16;
const PULSE_OPACITY = 0.3;

/**
 * Dot size in pixels: a fixed fraction of the globe, floored so a distant event
 * stays clickable and capped so a close one does not cover what it marks.
 */
function dotSizePx(globePx) {
  return Math.max(4, Math.min(16, globePx * 0.022));
}

let markerSprite = null;
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
    if (!active) { sizeFrame = null; return; }
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
      const size = dotSizePx(px);
      // One phase for every marker, so a field of earthquakes pulses together
      // rather than shimmering: per-marker phases read as noise on the screen.
      const phase = (Math.sin((performance.now() / PULSE_PERIOD_MS) * Math.PI * 2) + 1) / 2;
      markers.children.forEach((points) => {
        const pulsing = points.userData.pulse;
        const from = pulsing ? Math.min(size, QUAKE_BASE_CAP) : size;
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

/** A soft round dot, so markers read as points rather than square pixels. */
function markerTexture() {
  if (markerSprite || !THREE) return markerSprite;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.75, "rgba(255,255,255,0.35)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  markerSprite = new THREE.CanvasTexture(canvas);
  return markerSprite;
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
    const base = new THREE.Color(
      isQuakeBand(key) ? magnitudeColour(bandMagnitude(key)) : symbolFor(key).colour,
    );
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
      map: isQuakeBand(key) ? quakeTexture() : markerTexture(),
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
    points.userData.sizeScale = isQuakeBand(key)
      ? magnitudeSize(bandMagnitude(key), 1) * QUAKE_SYMBOL_SCALE
      : 1;
    // Only the earthquakes breathe. A pulse on everything is a map that will
    // not sit still to be read; on the seismicity alone it says which markers
    // are the live catalogue.
    points.userData.pulse = isQuakeBand(key);
    markers.add(points);
  });
  (spinFrame() || viewer.earthSceneGroup || viewer.scene).add(markers);
  trackScale();
  publishLayer();
}

/** Who the picture on the globe came from — every feed that is on, credited. */
/** The feeds that are ON, by name — "NASA EONET · USGS earthquakes". */
function sourceNames() {
  const names = [...new Set(
    SOURCES.filter((src) => enabled.has(src.id))
      .map((src) => (src.kind === "eonet" ? "NASA EONET"
        : src.kind === "gdacs" ? "GDACS (EC JRC)"
          : src.kind === "usgs" ? "USGS earthquake catalogue"
            : src.provider || src.label)),
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
        .map((key) => String(symbolFor(key).colour).replace("#", "")),
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

async function setActive(on) {
  active = Boolean(on);
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
  if (active && row) row.open = true;
  const host = byId("events-overlay");
  const panel = byId("events-panel");
  const toggle = byId("events-panel-toggle");
  if (host) {
    host.hidden = !active;
    // Entering the mode is a request to see the feed, so it opens on the list
    // rather than on a closed tab that has to be found and clicked.
    if (active && panel) {
      panel.hidden = false;
      toggle?.setAttribute("aria-expanded", "true");
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
  window.GeoIDModeManager?.setSpin?.(!active && window.GeoIDModeManager?.isSpinning?.());

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
 * there is no legend. Measured rather than assumed: the legend's width changes
 * as its panel opens and closes, and a fixed offset left an obvious gap
 * whenever it was shut.
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
  const base = rail > 0 ? rail : 5.5 * rem;
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
  if (!legend || legend.hidden) {
    setRight(base);
    return;
  }
  const gap = 8;
  setRight(window.innerWidth - legend.getBoundingClientRect().left + gap);
}

/**
 * Picking. Points are drawn at a fixed pixel size, so the raycaster's threshold
 * is set from that rather than left at its world-unit default -- otherwise the
 * hit area has nothing to do with what is on screen.
 */
function installPicking() {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || !THREE || canvas.dataset.eonetPicking) return;
  canvas.dataset.eonetPicking = "true";
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;

  canvas.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerup", (e) => {
    // A drag is navigation, not a pick.
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    if (!active || !markers) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, viewer.camera);
    const scale = viewer.camera.position.length() / Math.max(rect.height, 1);
    raycaster.params.Points.threshold = scale * 12;
    const hits = raycaster.intersectObjects(markers.children, false);
    // Nearest first, and only on the side of the globe facing the camera.
    const hit = hits.find((h) => h.point.clone().normalize()
      .dot(viewer.camera.position.clone().normalize()) > 0);
    if (hit) {
      const event = hit.object.userData.events?.[hit.index];
      if (event) {
        showPopup(event, e.clientX, e.clientY);
        setSelection(event);
        markRow(event.id);
        return;
      }
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
function applyHaloScale() {
  if (!halo) return;
  const px = globeRadiusPx();
  // The same pixel size the dots use, with just enough over it to read as a
  // ring around one rather than a circle near one.
  halo.material.size = Math.max(18, (px > 0 ? dotSizePx(px) : 8) * 2.0);
}

let ringSprite = null;

/** A thin cyan annulus, sized to sit just outside the dot it encircles. */
function ringTexture() {
  if (ringSprite || !THREE) return ringSprite;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const radius = size * 0.33;
  // A soft wide glow under a hard bright ring: the glow carries at a distance,
  // the ring keeps a definite edge close up. Drawn at a third of the sprite, so
  // it still lands close around the dot in the middle of it.
  ctx.lineWidth = size * 0.20;
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.085;
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.stroke();
  ringSprite = new THREE.CanvasTexture(canvas);
  return ringSprite;
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
  halo = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x52e4e8,
    map: ringTexture(),
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
    // The pulse is in brightness alone. Pulsing the size was what took the ring
    // off the dot it is meant to sit on: it can only stay on the circumference
    // if it stays that size.
    const t = ((now - started) % 1400) / 1400;
    halo.material.opacity = 0.6 + 0.4 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2));
    haloFrame = window.requestAnimationFrame(pulse);
  };
  haloFrame = window.requestAnimationFrame(pulse);
}

/** Keeps the feed's highlight in step with whatever is selected. */
function markRow(id) {
  byId("events-panel-body")?.querySelectorAll(".event-row").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.id === id);
  });
}

function hidePopup() {
  byId("event-popup")?.setAttribute("hidden", "");
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
    marks.push({ t: p, label: "P", colour: "#52e4e8", dashed: false });
  } else if (predicted?.inWindow) {
    pAt = predicted.p;
    marks.push({ t: predicted.p, label: "P", colour: "#52e4e8" });
  }

  let sAt = null;
  let sMeasured = false;
  if (sPicked != null) {
    sAt = sPicked;
    sMeasured = true;
    marks.push({ t: sPicked, label: "S", colour: "#ff2bd6", dashed: false });
  } else if (pAt != null && expectedGap && inWindow(pAt + expectedGap)) {
    // Anchored to the P that was actually read, not to the model's own P:
    // relative timing survives everything absolute timing gets wrong.
    sAt = pAt + expectedGap;
    marks.push({ t: sAt, label: "S", colour: "#ff2bd6" });
  } else if (predicted?.sInWindow) {
    sAt = predicted.s;
    marks.push({ t: predicted.s, label: "S", colour: "#ff2bd6" });
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
    import("./seismogram-plot.js?v=20260901-c5e9dd8"),
    import("./research/dsp.js?v=20260901-c5e9dd8"),
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
  const seismic = event.sourceId ? `
      <dt>Magnitude</dt><dd>${Number.isFinite(event.magnitude)
        ? `M ${event.magnitude.toFixed(1)}` : "undetermined"}</dd>
      <dt>Depth</dt><dd>${Number.isFinite(event.depthKm)
        ? `${event.depthKm.toFixed(1)} km` : "not reported"}</dd>
      ${event.tsunami ? "<dt>Tsunami</dt><dd>flagged by the USGS</dd>" : ""}` : "";
  node.dataset.eventId = event.id;
  node.classList.remove("has-trace");
  node.innerHTML = `
    <button type="button" class="event-popup-close" aria-label="Close">×</button>
    <div class="event-popup-head">
      <span class="event-glyph" style="color:${symbol.colour}">${symbol.glyph}</span>
      <span>${event.categoryTitle || symbol.label}</span>
    </div>
    <h3>${event.title}</h3>
    <dl>${seismic}
      <dt>Position</dt><dd>${event.lat.toFixed(3)}°, ${event.lon.toFixed(3)}°</dd>
      <dt>Last report</dt><dd>${when}</dd>
      <dt>Source</dt><dd>${source ? source.licence.split(" — ")[0] : "NASA EONET"} · ${event.id}</dd>
    </dl>
    ${event.link ? `<a href="${event.link}" target="_blank" rel="noopener">Open the ${source ? "USGS" : "EONET"} record</a>` : ""}
    <div class="event-popup-actions">
      <button type="button" class="button secondary" data-role="fly">Bring into view</button>
    </div>
    <div class="event-trace" hidden></div>`;
  node.removeAttribute("hidden");
  setSelection(event);
  placePopup(node, x, y);
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
   */
  if (event.sourceId && window.GeoIDEarthData?.seismogramNear) void showTrace(event);
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
  // Leaving GIS puts the feed away: there is no globe to pin events to.
  window.addEventListener("geoid-gis:mode-change", (event) => {
    if (event.detail?.mode !== "gis" && active) setActive(false);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/**
 * Feed tick boxes OUTSIDE this tab.
 *
 * A hazard subtab (Hazards ▸ Flood, ▸ Drought) offers the live feed for its
 * own subject, so somebody reading about flood susceptibility can switch the
 * flood events on where they are rather than hunting the Live Events tab for
 * the row. It is the SAME source and the same state — `data-feed-toggle`
 * carries the source id, the box mirrors `enabled`, and ticking it goes
 * through `setSourceEnabled`, which arms the mode exactly as the tab's own
 * row does. One feed, one state, two places to reach it.
 */
function syncFeedProxies() {
  document.querySelectorAll("[data-feed-toggle]").forEach((box) => {
    const id = box.dataset.feedToggle;
    if (!box.dataset.feedWired) {
      box.dataset.feedWired = "1";
      box.addEventListener("change", () => setSourceEnabled(id, box.checked));
    }
    box.checked = enabled.has(id);
  });
}
if (typeof document !== "undefined") {
  document.addEventListener("geoid-gis:layers-changed", syncFeedProxies);
  window.setInterval(syncFeedProxies, 900);
}

window.GeoIDEvents = {
  setActive, isActive: () => active, getEvents: () => events, SYMBOLS,
  setSourceEnabled, isSourceEnabled: (id) => enabled.has(id),
  // Re-seat the feed when the rail moves under it -- arming the hub
  // shifts the whole rail left of the hazard readout.
  reflow: placeOverlay,
};
