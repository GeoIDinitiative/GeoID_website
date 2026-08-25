/**
 * Tectonics: plate boundaries, active faults and stress measurements, under
 * the Geology tab where they belong.
 *
 * They were in Data · Vectors & Shapes beside the coastlines and the country
 * borders, which is a statement about their FILE FORMAT rather than about what
 * they are. A plate boundary is not a shape somebody drew round a landmass; it
 * is the thing the geology tab exists to talk about, and looking for the world's
 * faults under "Vectors & Shapes" means already knowing they were filed by
 * geometry type.
 *
 * So this is the same three rows, drawn by the same `renderCatalogue` from the
 * same `global-data.js` catalogue, in the tab somebody would look in first —
 * and they are drawn HERE AND NOWHERE ELSE. `polygons.js` filters the group
 * out: two lists for one dataset is how a tick in one place fails to explain
 * the tick already showing in the other, which the volcanoes did until anybody
 * noticed both.
 *
 * Folded by default. A nested group that opens itself takes the space of the
 * panel it is nested in, and the mapped-geology controls above it are what the
 * tab is mostly for.
 */

import { grouped, addDataset, datasetById, layerForDataset } from "./global-data.js?v=20260826-65b6ce2";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260826-65b6ce2";

/**
 * The one group this panel is a window on.
 *
 * Named here rather than passed in, and `polygons.js` imports it rather than
 * repeating the string: the whole point is that exactly one list holds this
 * group, and two spellings of "Tectonics" is how that stops being true.
 */
export const TECTONICS_GROUP = "Tectonics";

const byId = (id) => document.getElementById(id);

function say(message) {
  const node = byId("tectonics-status");
  if (node) node.textContent = message;
}

function draw() {
  const host = byId("tectonics-catalogue");
  if (!host) return;
  const entries = grouped()
    .filter(({ group }) => group === TECTONICS_GROUP)
    .flatMap(({ group, entries: list }) => list.map((entry) => ({
      id: entry.id,
      group,
      label: entry.label,
      title: `${entry.summary} — ${entry.licence}`,
    })));
  if (!entries.length) return;
  renderCatalogue(host, entries, {
    // No dropdown: three rows inside a subsection that is already folded away.
    // A lid on a lid is one press too many.
    layerFor: layerForDataset,
    add: (id) => addDataset(id, say),
    remove: (id) => {
      const layer = layerForDataset(id);
      if (!layer) return;
      window.GeoIDImportManager?.removeLayer?.(layer.id);
      say(`${datasetById(id)?.label || "Dataset"} taken off the globe.`);
    },
    symbology: (layer) => {
      if (!openSymbologyFor(layer)) say("This layer cannot be recoloured.");
    },
  });
}

function init() {
  if (!byId("tectonics-catalogue")) return;
  draw();
  // Whoever took it off — this list or the layer box — the tick follows,
  // because the list asks the catalogue rather than remembering.
  window.GeoIDImportManager?.onChange?.(draw);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
