import { describeCollection } from "./vector-render.js?v=20260822-59e7558";
import { addDataset, grouped, datasetById } from "./global-data.js?v=20260822-59e7558";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260822-59e7558";

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
 * Vector layers only. A shapefile of coastlines belongs here; a GeoTIFF of
 * rainfall does not, even though both arrived through the same importer.
 */
function overlays() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((layer) => layer.status === "loaded" && layer.collection?.features?.length);
}

/** "412 polygons", "1 line", "8 polygons, 2 lines" -- what is actually in it. */
function summarise(layer) {
  const counts = describeCollection(layer.collection);
  const parts = [];
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  if (counts.polygon) parts.push(plural(counts.polygon, "polygon"));
  if (counts.line) parts.push(plural(counts.line, "line"));
  if (counts.point) parts.push(plural(counts.point, "point"));
  return parts.join(", ") || "no features";
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

/** The layer a catalogue entry is currently loaded as, or null. */
function layerForEntry(id) {
  const entry = datasetById(id);
  if (!entry) return null;
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((layer) => layer.name === entry.name && layer.status === "loaded") || null;
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
  const entries = grouped().flatMap(({ group, entries: list }) => list.map((entry) => ({
    id: entry.id,
    group,
    label: entry.label,
    title: `${entry.summary} — ${entry.licence}`,
  })));
  renderCatalogue(host, entries, {
    layerFor: layerForEntry,
    add: (id) => addDataset(id, say),
    remove: (id) => {
      const layer = layerForEntry(id);
      if (!layer) return;
      window.GeoIDImportManager?.removeLayer?.(layer.id);
      say(`${datasetById(id)?.label || "Dataset"} taken off the globe.`);
    },
    symbology: (layer) => {
      if (!openSymbologyFor(layer)) say("The symbology panel is not on this page.");
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
