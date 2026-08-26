import {
  addDataset, grouped, datasetById, layerForDataset, isCatalogueLayer,
} from "./global-data.js?v=20260826-9a6f617";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260826-9a6f617";
import { geometrySummary } from "./symbology-dialog.js?v=20260826-9a6f617";

/**
 * Polygons: the register of vector overlays -- coastlines, boundaries, basins,
 * anything that draws an outline over the globe rather than covering it.
 *
 * It is a view of the layer stack, not a second copy of it. An overlay added
 * here is an ordinary imported layer: it appears in the layer box, takes part
 * in extraction and export, and carries its own opacity and draw order. What
 * this tab adds is a place to keep them together and switch them on and off
 * without unloading them, which the layer box cannot express -- there, removing
 * is the only way to get something out of the way for good.
 */

const ACCEPT = ".shp,.dbf,.shx,.prj,.cpg,.zip,.geojson,.json,.kml,.gpx,.wkt";

function byId(id) {
  return document.getElementById(id);
}

/**
 * Vector layers this tab is the ONLY home for — the ones somebody brought.
 *
 * It used to list every loaded vector layer, catalogue ones included, so a
 * ticked dataset appeared twice on the same panel: once as its catalogue row
 * with a Symbology button, and again in a card below the status line with a
 * second tick, a second Symbology button, and a different name. Two controls
 * for one layer, disagreeing about what to call it.
 *
 * The catalogue row is the better of the two — it is where the layer was turned
 * on and where its tick means "on the globe" — so a catalogue layer is drawn
 * there and nowhere else. A shapefile somebody dropped has no row up there and
 * keeps its card here. A GeoTIFF of rainfall belongs in neither, even though it
 * arrived through the same importer.
 */
function overlays() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((layer) => layer.status === "loaded" && layer.collection?.features?.length)
    .filter((layer) => !isCatalogueLayer(layer));
}

/** "412 polygons", "1 line", "8 polygons, 2 lines" -- what is actually in it. */
function summarise(layer) {
  return geometrySummary(layer.collection?.features || layer.features) || "no features";
}

function row(layer) {
  const node = document.createElement("label");
  node.className = "polygon-row";

  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = layer.visible !== false;
  // Through the hierarchy rather than straight onto the object, so the layer
  // box and this tab always agree about what is showing.
  check.addEventListener("change", () => {
    window.GeoIDLayerHierarchy?.setVisible?.(layer, check.checked);
    window.GeoIDLayerHierarchy?.render?.();
  });

  const name = document.createElement("span");
  name.className = "polygon-name";
  name.textContent = layer.name;
  name.title = layer.name;

  const count = document.createElement("span");
  count.className = "polygon-count";
  count.textContent = summarise(layer);

  node.append(check, name, count);

  // A shapefile somebody dragged in gets the same window as one off the
  // catalogue — the button was only ever on the catalogue rows, which meant
  // your own data was the one kind you could not recolour from here.
  if (typeof layer.repaint === "function" && layer.features?.length) {
    const sym = document.createElement("button");
    sym.type = "button";
    sym.className = "gis-catalogue-sym";
    sym.textContent = "Symbology…";
    sym.title = `Colour ${layer.name} by one of its own columns`;
    // The row is a <label>: a click inside it would otherwise toggle the box.
    sym.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!openSymbologyFor(layer)) say("This layer cannot be recoloured.");
    });
    node.appendChild(sym);
  }
  return node;
}

function render() {
  const host = byId("polygon-list");
  if (!host) return;
  host.textContent = "";
  overlays().forEach((layer) => host.appendChild(row(layer)));
}

function say(message) {
  const node = byId("polygon-status");
  if (node) node.textContent = message;
}

/**
 * The catalogue as tick boxes: several datasets at once, on and off.
 *
 * It was a dropdown, which says "choose one" — and choosing one was most of
 * what it could do: no sight of what was already on, and no way to take one
 * off again without going to the layer box. Coastlines under rivers under
 * borders is the ordinary case, so the ordinary control is a list of toggles.
 */
function drawCatalogue() {
  const host = byId("polygon-catalogue");
  if (!host) return;
  /**
   * Only the datasets with NO home of their own.
   *
   * The tectonics layers are under Geology, the water bodies under Hydrology
   * and the volcanoes under Geology · Volcanoes, because filing a plate
   * boundary next to a coastline is a statement about its file format rather
   * than about what it is. What is left here is the shapes that really are
   * just shapes — the graticule, the borders, the country polygons — beside
   * whatever somebody imports, which is what this tab is for.
   *
   * Drawn there and NOT also here: two lists for one dataset is how a tick in
   * one place fails to explain the tick already showing in the other.
   */
  const entries = grouped()
    .flatMap(({ group, entries: list }) => list
      .filter((entry) => !entry.home)
      .map((entry) => ({
        id: entry.id,
        group,
        label: entry.label,
        title: `${entry.summary} — ${entry.licence}`,
      })));
  renderCatalogue(host, entries, {
    // A lid over the list: nine datasets with their group headings filled the
    // panel, and the layers already on the globe — the part you work with —
    // were pushed off the bottom of it.
    title: "Global catalogue",
    // The catalogue owns this lookup: it knows a dataset is loaded under the
    // tidied name once the rename lands, and under the file name before it.
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
  const input = byId("polygon-file");
  const browse = byId("polygon-browse");
  if (input) input.setAttribute("accept", ACCEPT);

  drawCatalogue();

  browse?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", async () => {
    if (!input.files?.length) return;
    // The same importer the Add / Import Data tab uses, so a shapefile's
    // sidecars, its projection and its attributes are all handled once.
    await window.GeoIDImportManager?.importFileList?.(input.files);
    input.value = "";
  });

  document.getElementById("polygon-capture-drawn")?.addEventListener("click", () => {
    const out = window.GeoIDDrawnLayers?.captureDrawn?.();
    const host = document.getElementById("polygon-list");
    if (host && out && !out.ok) {
      const note = document.createElement("div");
      note.className = "gis-metric";
      note.textContent = out.message;
      host.prepend(note);
    }
  });
  window.GeoIDImportManager?.onChange?.(() => {
    render();
    // Whoever took it off — this list, the layer box, a tab — the tick follows.
    drawCatalogue();
  });
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
