/**
 * The tab headers say what is ON.
 *
 * A dataset activated inside a tab was invisible the moment the tab folded:
 * nothing on the header said the globe was carrying its layers. This watches
 * the import manager and marks every main section that owns an active layer
 * with `has-active-data` — a cyan title and dot on the collapsed header —
 * so the sidebar reads as a status board, not just a menu.
 *
 * The mapping mirrors where each thing is OFFERED: catalogue datasets by
 * their `home`, map overlays to Basemap and Relief, GEE layers by the same
 * `GEE_HOMES` filing the catalogue merge uses (via the seam), the live
 * satellite and event layers to their own tabs, and anything unclaimed —
 * a dropped shapefile — to Vector & Shapefiles.
 */

import {
  grouped as globalGrouped, layerForDataset,
} from "./global-data.js?v=20260830-0af4d12";
import { MAP_LAYERS, layerForMap } from "./map-layers.js?v=20260830-0af4d12";

const HOME_SECTION = {
  hydrology: "sea-level-section",
  "geology-tectonics": "geology-section",
  "geology-volcanoes": "geology-section",
};
const GEE_SECTION = {
  atmosphere: "gis-group-modelled",
  basemap: "basemap-relief-section",
  geohazards: "modelled-data-section",
  hydrology: "sea-level-section",
  geology: "geology-section",
};
const SECTIONS = [
  "geoid-controls-group",
  "satellites-section", "gis-group-events", "gis-group-polygons",
  "basemap-relief-section", "geology-section", "sea-level-section",
  "gis-group-modelled", "modelled-data-section",
];

// The Locations label layers are the viewer's own, not import-manager
// layers, so Explorer's state is read straight from their tick boxes.
// The Moons row is not one of them: it is on by default, and counting it
// would light Explorer on every fresh page.
const LABEL_TOGGLES = [
  "locations-master-toggle", "labels-toggle", "volcanic-labels-toggle",
  "landing-labels-toggle", "habitation-labels-toggle",
];

const isOn = (layer) => layer && layer.visible !== false && layer.status !== "error";

function activeSections() {
  const active = new Set();
  const claimed = new Set();
  globalGrouped().forEach(({ entries }) => entries.forEach((entry) => {
    const layer = layerForDataset(entry.id);
    if (!layer) return;
    claimed.add(layer.id);
    // The homeless catalogue (graticule, borders, countries, cables) is
    // offered from the Basemaps tab now, so its ticks light that header.
    if (isOn(layer)) active.add(HOME_SECTION[entry.home] || "basemap-relief-section");
  }));
  MAP_LAYERS.forEach((entry) => {
    const layer = layerForMap(entry.id);
    if (!layer) return;
    claimed.add(layer.id);
    if (isOn(layer)) active.add("basemap-relief-section");
  });
  (window.GeoIDImportManager?.getLayers?.() || []).forEach((layer) => {
    if (claimed.has(layer.id) || !isOn(layer)) return;
    const name = layer.name || "";
    if (name.startsWith("Live satellites")) { active.add("satellites-section"); return; }
    if (name === "Live events") { active.add("gis-group-events"); return; }
    if (layer.ext === "gee") {
      const home = window.GeoIDGeeCatalogue?.homeOfLayerName?.(name);
      active.add(GEE_SECTION[home] || "gis-group-modelled");
      return;
    }
    // Tile drapes and basemap refine patches are Basemap and Relief's.
    if (layer.ext === "tiles") { active.add("basemap-relief-section"); return; }
    if (layer.geologyDataset || /geolog|macrostrat|contacts and faults/i.test(name)) {
      active.add("geology-section");
      return;
    }
    // The NI prototype's finished maps live in Geohazards.
    if (/susceptibility|flood/i.test(name)) { active.add("modelled-data-section"); return; }
    active.add("gis-group-polygons");
  });
  if (LABEL_TOGGLES.some((id) => document.getElementById(id)?.checked)) {
    active.add("geoid-controls-group");
  }
  /**
   * A NESTED section's state must reach the tab that folds over it —
   * Satellites lives inside Live now and Hydrology inside Earth System, so
   * an active satellite layer has to light the Live header the user can
   * actually see. Read from the DOM rather than from a table: the nesting
   * is per-body (Mars keeps Hydrology as its own tab) and the DOM is the
   * one place that already knows which shape this world got.
   */
  [...active].forEach((id) => {
    const parent = document.getElementById(id)?.closest("details.toolbox-group");
    if (parent?.id && parent.id !== id) active.add(parent.id);
  });
  return active;
}

/**
 * The same solid fill, one tier down: a SUB-tab whose own controls have
 * something switched on.
 *
 * Level-1 tabs are marked from the import manager, by mapping each active
 * layer to the tab that OFFERS it. A sub-tab cannot be found that way —
 * the mapping is per subject, not per section — so this reads the controls
 * themselves: a ticked catalogue row, a ticked feed master, a ticked label
 * toggle. Those boxes ARE the layer's state (the catalogue redraws them
 * from the import manager on every change), so this says the same thing
 * the tab headers say, about a smaller box.
 *
 * The base-texture rows are excluded: a sphere always wears one, so a rule
 * that counted them would light Basemaps' first sub-tab permanently and
 * say nothing. Nested sub-tabs inherit by descent — a parent holding an
 * active child lights too, which is what makes a folded column readable.
 */
/**
 * Only controls that mean "a dataset is ON" count. Listed rather than
 * inferred: a first pass took every ticked box and lit Geoprocessing, Map
 * View and Extract From Layers — whose ticks are OPTIONS (keep attributes,
 * show grid), not data. A tool with its defaults set is not a tool with
 * something loaded, and a highlight that cannot tell the two apart is
 * worse than none.
 */
const DATA_CONTROLS = [
  ".gis-catalogue-row input[type=checkbox]",   // a catalogue dataset
  ".event-feed-master",                        // a whole feed group
  ".event-feed-row input[type=checkbox]",      // one live feed
  "[data-feed-toggle]",                        // a feed proxy (Hazards)
  "[data-demo]",                               // a shipped demo layer
  ".section-master-toggle",                    // a section's own master
].join(",");

/**
 * Ticks that are NOT "a dataset is on":
 *  - a base texture (a sphere always wears one),
 *  - the satellite CATEGORY filters and the orbit-paths option, which say
 *    what the tracker draws once it is running, not that it is.
 */
function countsAsData(box) {
  if (!box.checked) return false;
  if (box.closest("#satellites-categories") || box.id === "satellites-orbits") return false;
  const row = box.closest(".gis-catalogue-row");
  return !(row && String(row.dataset.entry || "").startsWith("base:"));
}

function markSubsections(active) {
  document.querySelectorAll(".gis-tool-section, .control-section:not(.toolbox-group)")
    .forEach((sub) => {
      // A section the LAYER pass owns keeps its answer: that pass knows the
      // tracker is running, which no tick inside the section can say.
      const fromLayers = sub.id && active.has(sub.id);
      const on = fromLayers || [...sub.querySelectorAll(DATA_CONTROLS)].some(countsAsData);
      sub.classList.toggle("has-active-data", on);
    });
}

let last = "";
function refresh() {
  const active = activeSections();
  const key = [...active].sort().join("|");
  // The sub-tab pass runs even when the TAB set is unchanged: ticking a
  // second dataset inside one tab changes nothing at level 1 and everything
  // one tier down.
  if (key === last) { markSubsections(active); return; }
  last = key;
  SECTIONS.forEach((id) => {
    document.getElementById(id)?.classList.toggle("has-active-data", active.has(id));
  });
  markSubsections(active);
}

/**
 * The active header wears a SOLID accent fill — the strongest thing a
 * collapsed header can do, chosen over a quiet tint because the point is
 * to read across a folded sidebar at a glance. Injected here rather than
 * written into styles.css, because that file is Earth's alone and the
 * planet shells load their own; this module runs on all ten worlds and
 * carries its skin with it. !important throughout: the skin paints
 * section chrome with !important of its own.
 */
function installStyle() {
  if (document.getElementById("geoid-section-activity-style")) return;
  const tag = document.createElement("style");
  tag.id = "geoid-section-activity-style";
  tag.textContent = [
    "details.control-section.has-active-data:not([open]) > .section-toggle {",
    "  background: rgb(var(--nav-accent-rgb, 255, 43, 214)) !important;",
    "  border-left-color: rgb(var(--nav-accent-rgb, 255, 43, 214)) !important;",
    "  color: var(--skin-chrome-ink, #2b0030) !important;",
    "}",
    "details.gis-tool-section.has-active-data:not([open]) > summary {",
    "  background: rgb(var(--nav-accent-rgb, 255, 43, 214)) !important;",
    "  color: var(--skin-chrome-ink, #2b0030) !important;",
    "}",
    "details.gis-tool-section.has-active-data:not([open]) > summary * {",
    "  color: var(--skin-chrome-ink, #2b0030) !important;",
    "  text-shadow: none !important;",
    "}",
    "details.control-section.has-active-data:not([open]) > .section-toggle .section-title,",
    "details.control-section.has-active-data:not([open]) > .section-toggle .section-icon {",
    "  color: var(--skin-chrome-ink, #2b0030) !important;",
    "  filter: none !important;",
    "  text-shadow: none !important;",
    "}",
    /**
     * THE CHEVRON TOO — it is a pseudo-element, so `> summary *` never
     * reached it.
     *
     * A tier-1 chevron sets its own colour (the accent at 0.9) rather than
     * inheriting, and this fill IS the accent: measured, chevron
     * rgba(255,43,214,0.9) on a rgb(255,43,214) header, which is the same
     * colour and therefore no chevron at all. The title and icon were already
     * on the dark-ink list and looked right, which is what made the arrow
     * read as "lost" rather than as the whole header being wrong.
     *
     * The sub-tabs never had it: their chevron sets no colour and inherits
     * the dark ink from the summary (measured rgb(43,0,48)). This is the
     * same magenta-on-magenta the armed Events header once had.
     */
    "details.control-section.has-active-data:not([open]) > .section-toggle::before,",
    "details.control-section.has-active-data:not([open]) > .section-toggle::after,",
    "details.gis-tool-section.has-active-data:not([open]) > summary::before,",
    "details.gis-tool-section.has-active-data:not([open]) > summary::after {",
    "  color: var(--skin-chrome-ink, #2b0030) !important;",
    "  opacity: 1 !important;",
    "  text-shadow: none !important;",
    "}",
  ].join("\n");
  document.head.appendChild(tag);
}

function init() {
  if (!SECTIONS.some((id) => document.getElementById(id))) return;
  installStyle();
  window.GeoIDImportManager?.onChange?.(refresh);
  document.addEventListener("geoid-gee:catalogue", refresh);
  document.addEventListener("geoid-gis:layers-changed", refresh);
  // Label tick boxes announce nothing a layer listener hears. The bubbled
  // change lands here AFTER the viewer's own element listener has synced
  // the sibling boxes, so the read below sees the settled state.
  document.addEventListener("change", (event) => {
    if (LABEL_TOGGLES.includes(event.target?.id)) refresh();
  });
  // A visibility eye or an adopted layer can change without an announcement
  // this module hears; a slow poll keeps the headers honest. Cheap: the set
  // is compared before anything touches the DOM.
  window.setInterval(refresh, 4000);
  refresh();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else window.setTimeout(init, 1200);
}
