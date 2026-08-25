/**
 * Mapped locations: the catalogues of PLACES, ticked on under Explorer.
 *
 * The Locations section already held the viewer's own label layers — general
 * names, volcanic features, mission sites — which are labels drawn by the
 * globe, not data you can interrogate. This adds the other kind beside them: a
 * dataset of real records with coordinates and attributes, which arrives as an
 * ordinary imported layer and therefore comes with everything one has.
 *
 * That distinction is the whole reason this is a second list rather than four
 * more checkboxes in the first. A label is a word on a sphere. A location
 * dataset can be recoloured by any of its columns, read by clicking a point,
 * counted in the legend, clipped to a study area, sampled into an extraction
 * table and exported as a shapefile — and none of that is true of a label.
 *
 * It draws the same `renderCatalogue` rows the Vectors & Shapes tab uses, from
 * the same `global-data.js` catalogue, filtered to the groups that are about
 * places. One catalogue, two windows on it: a volcano ticked here is the same
 * layer, with the same tick, as one ticked there.
 */

import { grouped, addDataset, datasetById, layerForDataset } from "./global-data.js?v=20260825-db3d262";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260825-db3d262";

/**
 * Which catalogue groups are "locations".
 *
 * Hazards is here because a volcano IS a location — a named place with a type,
 * an elevation and a history — and somebody looking for the world's volcanoes
 * looks under Locations before they look under anything else. The group name
 * says where the data comes from; this says what it is.
 */
const GROUPS = new Set(["Hazards"]);

const byId = (id) => document.getElementById(id);

function say(message) {
  const node = byId("locations-datasets-status");
  if (node) node.textContent = message;
}

function draw() {
  const host = byId("locations-catalogue");
  if (!host) return;
  const entries = grouped()
    .filter(({ group }) => GROUPS.has(group))
    .flatMap(({ group, entries: list }) => list.map((entry) => ({
      id: entry.id,
      group,
      label: entry.label,
      title: `${entry.summary} — ${entry.licence}`,
    })));
  if (!entries.length) return;
  renderCatalogue(host, entries, {
    // No dropdown here: this list is short and it sits inside a section that
    // is already folded away. A lid on a lid is one press too many.
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
  if (!byId("locations-catalogue")) return;
  draw();
  // Whoever took it off — this list, the Vectors tab, the layer box — the tick
  // follows, because both lists ask the catalogue rather than remembering.
  window.GeoIDImportManager?.onChange?.(draw);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

export { draw, init };
