/**
 * The map-overlay catalogue, mounted in Basemap and Relief.
 *
 * Deliberately thin: `renderCatalogue` is the same list the Vectors & Shapes
 * and Locations tabs draw, so a tick means the same thing in all three and a
 * layer added here arrives in the layer box beside everything else. What this
 * file knows is only which catalogue to draw and where to put it.
 */

import { grouped, addMapLayer, removeMapLayer, layerForMap, layerById } from "./map-layers.js?v=20260830-dd0c570";
import { renderCatalogue } from "./catalogue-list.js?v=20260830-dd0c570";
import { TILE_SOURCES } from "./tile-sources.js?v=20260830-dd0c570";

const byId = (id) => document.getElementById(id);

function say(message) {
  const node = byId("basemap-catalogue-status");
  if (node) node.textContent = message || "";
}

/**
 * The base textures, read from the dropdown they used to live in.
 *
 * Not from the manifest: the list grows at runtime — `basemap-drape.js`
 * registers OpenStreetMap and Esri as `tiles-*` entries the first time the
 * panel is built — and a catalogue built from the manifest would quietly be
 * missing exactly the layers somebody went looking for.
 *
 * `BASE_PREFIX` keeps their ids apart from the overlays', so one namespace can
 * carry both and `add` knows which kind it was handed.
 */
const BASE_PREFIX = "base:";
const BASE_GROUP = "Base texture (one at a time)";

function baseSelect() {
  return byId("base-layer-select");
}

/**
 * Every base texture explains itself through the same ⓘ the overlay rows
 * carry. Tile services answer from their OWN records in TILE_SOURCES
 * (credit + licence — the same pair the source line under the catalogue
 * shows), matched by the id slug basemap-drape registers them under; the
 * shipped textures carry their provenance here, since nothing else records
 * it. A texture in neither table still gets a row, just without the ⓘ —
 * a button opening an empty card would be worse than none.
 */
const tileSlug = (name) => `tiles-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const SHIPPED_BASE_INFO = {
  "blue-marble": {
    summary: "NASA's Blue Marble composite — the texture the globe ships with, on the sphere before any network call.",
    citation: "NASA Earth Observatory (Blue Marble). Public domain.",
  },
  "earth-visible": {
    summary: "NASA's Earth surface texture: cloud-free land and ocean colour.",
    citation: "NASA Earth Observatory. Public domain.",
  },
  "derived-hillshade": {
    summary: "Hillshade derived from the GEBCO 2025 global bathymetry and topography grid (~450 m).",
    citation: "GEBCO Compilation Group (2025). Public domain, attribution requested.",
  },
  "gebco-bathy-context": {
    summary: "Bathymetric and topographic relief context derived from the GEBCO 2025 global grid.",
    citation: "GEBCO Compilation Group (2025). Public domain, attribution requested.",
  },
  "elevation-dem": {
    summary: "The GEBCO 2025 elevation grid drawn directly as a colour-mapped DEM, Mariana Trench to Everest.",
    citation: "GEBCO Compilation Group (2025). Public domain, attribution requested.",
  },
};
function baseInfoFor(value) {
  if (SHIPPED_BASE_INFO[value]) return SHIPPED_BASE_INFO[value];
  const match = Object.entries(TILE_SOURCES)
    .find(([name]) => tileSlug(name) === value);
  if (!match) return null;
  const [, source] = match;
  return { summary: source.credit || "", citation: source.licence || "" };
}

function baseEntries() {
  const select = baseSelect();
  return [...(select?.options || [])].map((option) => ({
    id: `${BASE_PREFIX}${option.value}`,
    group: BASE_GROUP,
    label: option.textContent.trim(),
    title: option.title || "The sphere's own texture — one at a time.",
    info: baseInfoFor(option.value),
  }));
}

/**
 * Is this the texture the sphere is wearing?
 *
 * Single-select falls out of this rather than being enforced: only one id can
 * match the select's value, so ticking another one unticks the last on the
 * redraw, which is what a radio group does.
 */
function baseIsOn(id) {
  const select = baseSelect();
  return select && `${BASE_PREFIX}${select.value}` === id ? { id } : null;
}

function setBase(id) {
  const select = baseSelect();
  if (!select) return;
  select.value = id.slice(BASE_PREFIX.length);
  // Dispatched, because setting `.value` in code fires nothing and the viewer
  // learns about a basemap change from the event, not from the property.
  select.dispatchEvent(new Event("change", { bubbles: true }));
  say(`Base texture: ${select.selectedOptions[0]?.textContent.trim() || "changed"}.`);
}

function draw() {
  const host = byId("basemap-catalogue");
  if (!host) return;
  /**
   * ONE list, Earth Engine included. This tab's share of the GEE catalogue
   * (imagery, both DEMs) merges in as its own group rather than standing
   * as a second "Earth Engine" dropdown beneath this one — the rows cite
   * the service in their tooltip, and the hooks route any id the seam owns
   * back to gee.js, which is the one request path.
   */
  const gee = window.GeoIDGeeCatalogue;
  const geeEntries = gee?.entriesFor("basemap") || [];
  const entries = [
    ...baseEntries(),
    ...grouped().flatMap(({ group, entries: list }) => list.map((entry) => ({
      id: entry.id,
      group,
      label: entry.label,
      title: `${entry.summary} — ${entry.licence}`,
      info: { summary: entry.summary, citation: entry.licence },
    }))),
    ...geeEntries,
  ];
  renderCatalogue(host, entries, {
    // A lid, because five overlays and their group headings would push the
    // relief slider — which people reach for constantly — off the bottom of
    // the tab.
    title: "Basemaps",
    layerFor: (id) => {
      if (gee?.owns(id)) return gee.layerFor(id);
      return id.startsWith(BASE_PREFIX) ? baseIsOn(id) : layerForMap(id);
    },
    add: (id) => {
      if (gee?.owns(id)) return gee.add(id);
      return id.startsWith(BASE_PREFIX) ? setBase(id) : addMapLayer(id, say);
    },
    remove: (id) => {
      if (gee?.owns(id)) return gee.remove(id);
      // A sphere always has a texture, so unticking the base is not an
      // instruction anybody can carry out — the tick comes back on the redraw
      // and this says why rather than leaving it looking broken.
      if (id.startsWith(BASE_PREFIX)) {
        say("The globe always wears one base texture — tick another to change it.");
        return;
      }
      if (removeMapLayer(id)) say(`${layerById(id)?.label || "Overlay"} taken off the globe.`);
      return undefined;
    },
  });
}

function init() {
  if (!byId("basemap-catalogue")) return;
  draw();
  // Whoever took it off — this list or the layer box — the tick follows,
  // because the list asks the import manager rather than remembering.
  window.GeoIDImportManager?.onChange?.(draw);
  // And whoever changed the base texture: the tile services register
  // themselves into that dropdown after the panel is first built, so the list
  // has to be redrawn when its own source grows.
  baseSelect()?.addEventListener("change", draw);
  // The GEE share of this list grows when the live service answers.
  document.addEventListener("geoid-gee:catalogue", draw);
  window.setTimeout(draw, 1500);
  window.setTimeout(draw, 4000);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

export { draw, init };
