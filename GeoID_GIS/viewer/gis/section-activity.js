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
} from "./global-data.js?v=20260826-2e5d2d6";
import { MAP_LAYERS, layerForMap } from "./map-layers.js?v=20260826-2e5d2d6";

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
  "satellites-section", "gis-group-events", "gis-group-polygons",
  "basemap-relief-section", "geology-section", "sea-level-section",
  "gis-group-modelled", "modelled-data-section",
];

const isOn = (layer) => layer && layer.visible !== false && layer.status !== "error";

function activeSections() {
  const active = new Set();
  const claimed = new Set();
  globalGrouped().forEach(({ entries }) => entries.forEach((entry) => {
    const layer = layerForDataset(entry.id);
    if (!layer) return;
    claimed.add(layer.id);
    if (isOn(layer)) active.add(HOME_SECTION[entry.home] || "gis-group-polygons");
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
  return active;
}

let last = "";
function refresh() {
  const active = activeSections();
  const key = [...active].sort().join("|");
  if (key === last) return;
  last = key;
  SECTIONS.forEach((id) => {
    document.getElementById(id)?.classList.toggle("has-active-data", active.has(id));
  });
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
    "details.control-section.has-active-data:not([open]) > .section-toggle .section-title,",
    "details.control-section.has-active-data:not([open]) > .section-toggle .section-icon {",
    "  color: var(--skin-chrome-ink, #2b0030) !important;",
    "  filter: none !important;",
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
