/**
 * The map-overlay catalogue, mounted in Basemap and Relief.
 *
 * Deliberately thin: `renderCatalogue` is the same list the Vectors & Shapes
 * and Locations tabs draw, so a tick means the same thing in all three and a
 * layer added here arrives in the layer box beside everything else. What this
 * file knows is only which catalogue to draw and where to put it.
 */

import { grouped, addMapLayer, removeMapLayer, layerForMap, layerById } from "./map-layers.js?v=20260825-01dbcd7";
import { renderCatalogue } from "./catalogue-list.js?v=20260825-01dbcd7";

const byId = (id) => document.getElementById(id);

function say(message) {
  const node = byId("basemap-catalogue-status");
  if (node) node.textContent = message || "";
}

function draw() {
  const host = byId("basemap-catalogue");
  if (!host) return;
  const entries = grouped().flatMap(({ group, entries: list }) => list.map((entry) => ({
    id: entry.id,
    group,
    label: entry.label,
    title: `${entry.summary} — ${entry.licence}`,
  })));
  renderCatalogue(host, entries, {
    // A lid, because five overlays and their group headings would push the
    // relief slider — which people reach for constantly — off the bottom of
    // the tab.
    title: "Map overlays",
    layerFor: layerForMap,
    add: (id) => addMapLayer(id, say),
    remove: (id) => {
      if (removeMapLayer(id)) say(`${layerById(id)?.label || "Overlay"} taken off the globe.`);
    },
  });
}

function init() {
  if (!byId("basemap-catalogue")) return;
  draw();
  // Whoever took it off — this list or the layer box — the tick follows,
  // because the list asks the import manager rather than remembering.
  window.GeoIDImportManager?.onChange?.(draw);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

export { draw, init };
