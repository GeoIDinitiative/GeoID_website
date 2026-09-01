/**
 * The catalogue, drawn where each dataset belongs rather than all in one list.
 *
 * Data · Vectors & Shapes began as the one list of everything, which made it a
 * list sorted by FILE FORMAT: a plate boundary beside a coastline beside a
 * volcano, because all three arrive as GeoJSON. Nobody looks for the world's
 * faults under "Vectors & Shapes", or for its rivers under a heading that also
 * holds country borders.
 *
 * So a dataset names its home in `global-data.js` and this mounts one list per
 * home:
 *
 * | home | where it appears |
 * | --- | --- |
 * | `hydrology` | Hydrology · Water bodies — coastlines, rivers, lakes |
 * | `geology-tectonics` | Geology · Tectonics — plates, faults, stress |
 * | `geology-volcanoes` | Geology · Volcanoes — the Smithsonian GVP |
 *
 * Each is the same `renderCatalogue` rows from the same catalogue, so a layer
 * ticked here is an ordinary layer with its symbology, click card, legend entry
 * and export — and `polygons.js` draws only what has NO home, so every dataset
 * is on exactly one list. Two lists for one dataset is how a tick in one place
 * fails to explain the tick already showing in the other.
 *
 * This module replaced `tectonics-panel.js`, which was this for one home. The
 * second and third home would have been two more copies of the same forty
 * lines, and the copies are what drift.
 */

import {
  HOMES, grouped, addDataset, datasetById, layerForDataset,
} from "./global-data.js?v=20260901-6274bf4";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260901-6274bf4";

const byId = (id) => document.getElementById(id);

/** The status line under a list is the host's id with `-status` for `-catalogue`. */
const statusIdFor = (hostId) => hostId.replace(/-catalogue$/, "-status");

function say(hostId, message) {
  const node = byId(statusIdFor(hostId));
  if (node) node.textContent = message;
}

/** Which of this module's homes carries a share of the GEE catalogue. */
const GEE_SHARE = { hydrology: "hydrology" };

function draw(home, hostId) {
  const host = byId(hostId);
  if (!host) return;
  // Earth Engine's share of this subject merges into the SAME list — one
  // catalogue per tab, the service cited in the row's tooltip and in the
  // layer's metadata, never a second list of its own.
  const gee = GEE_SHARE[home] ? window.GeoIDGeeCatalogue : null;
  const geeEntries = gee?.entriesFor(GEE_SHARE[home]) || [];
  const entries = [
    ...grouped().flatMap(({ group, entries: list }) => list
      .filter((entry) => entry.home === home)
      .map((entry) => ({
        id: entry.id,
        group,
        label: entry.label,
        title: `${entry.summary} — ${entry.licence}`,
        info: { summary: entry.summary, citation: entry.licence },
        // Same reason as polygons.js: the row's label-detail slider captions
        // itself from the dataset's own words, and a projection that drops
        // this falls back to wording written for another catalogue.
        detailCopy: entry.detailCopy,
      }))),
    ...geeEntries,
  ];
  if (!entries.length) return;
  renderCatalogue(host, entries, {
    // No dropdown: each list is a handful of rows inside a subsection that is
    // already folded away. A lid on a lid is one press too many.
    layerFor: (id) => (gee?.owns(id) ? gee.layerFor(id) : layerForDataset(id)),
    add: (id) => (gee?.owns(id) ? gee.add(id)
      : addDataset(id, (message) => say(hostId, message))),
    remove: (id) => {
      if (gee?.owns(id)) return gee.remove(id);
      const layer = layerForDataset(id);
      if (!layer) return undefined;
      window.GeoIDImportManager?.removeLayer?.(layer.id);
      say(hostId, `${datasetById(id)?.label || "Dataset"} taken off the globe.`);
      return undefined;
    },
    symbology: (layer) => {
      if (!openSymbologyFor(layer)) say(hostId, "This layer cannot be recoloured.");
    },
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("geoid-gee:catalogue", () => drawAll());
}

function drawAll() {
  Object.entries(HOMES).forEach(([home, hostId]) => draw(home, hostId));
  drawMacrostratLines();
  drawVolcanoTypes();
}

/**
 * Per-type toggles for the volcano layer — the satellite categories'
 * pattern applied to an ordinary vector layer.
 *
 * The toggle FILTERS `layer.features` (and the collection the renderer
 * reads) against a kept master list, so the dots, the click pick, and the
 * labels all answer from the same filtered set — a type switched off
 * cannot be clicked and cannot keep a label. Colours must NOT be re-derived
 * on repaint: `categoricalSymbology` assigns by frequency, and filtering
 * changes the frequencies, so the lookup is taken once from the legend the
 * layer already wears and the legend itself is left untouched — the
 * swatches beside these ticks stay meaningful while a class is hidden.
 */
const volcanoTypesOff = new Set();

function volcanoLayerBits() {
  const layer = layerForDataset("volcanoes");
  const legend = layer?.legendInfo;
  if (!layer || legend?.field !== "type_group") return null;
  return { layer, legend };
}

function applyVolcanoTypes() {
  const bits = volcanoLayerBits();
  if (!bits) return;
  const { layer, legend } = bits;
  if (!layer._allFeatures) layer._allFeatures = layer.features;
  const filtered = volcanoTypesOff.size
    ? layer._allFeatures.filter((f) => !volcanoTypesOff.has(String(f?.properties?.type_group)))
    : layer._allFeatures;
  layer.features = filtered;
  if (layer.collection) layer.collection.features = filtered;
  const lookup = new Map(legend.values.map((value, i) => [value, `#${legend.palette[i]}`]));
  layer.repaint?.((feature) =>
    lookup.get(String(feature?.properties?.type_group)) || "#8a8a8a");
  // The labels rebuild from the filtered features; off-then-on keeps the
  // chosen detail level because point-labels remembers it by layer name.
  const labels = window.GeoIDPointLabels;
  if (labels?.isLabelled?.(layer)) {
    void labels.setLabels(layer, false);
    void labels.setLabels(layer, true);
  }
}

function drawVolcanoTypes() {
  const host = byId("volcano-types");
  if (!host) return;
  const bits = volcanoLayerBits();
  host.replaceChildren();
  if (!bits) return;
  const { legend } = bits;
  legend.values.forEach((value, i) => {
    const row = document.createElement("div");
    row.className = "gis-catalogue-row";
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = !volcanoTypesOff.has(value);
    tick.id = `volcano-type-${value.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const swatch = document.createElement("span");
    swatch.style.cssText = `flex:0 0 auto;width:0.55rem;height:0.55rem;`
      + `border-radius:0.12rem;background:#${legend.palette[i]};`;
    const name = document.createElement("label");
    name.className = "gis-catalogue-name";
    name.htmlFor = tick.id;
    name.textContent = value;
    tick.addEventListener("change", () => {
      if (tick.checked) volcanoTypesOff.delete(value);
      else volcanoTypesOff.add(value);
      applyVolcanoTypes();
    });
    row.append(tick, swatch, name);
    host.appendChild(row);
  });
}

/**
 * The Macrostrat contacts-and-faults layer, as a row in Tectonics.
 *
 * It lived in the Geology dropdown, which is gone — a fault trace belongs
 * beside the plate boundaries and the GEM faults, not behind a picker on
 * another subsection. It cannot be a `global-data.js` entry because it is not
 * a file: it is the tile service's line layer, loaded and refreshed by
 * `geology-panel.js`'s own machinery, so the row talks to that module and is
 * appended after `renderCatalogue` has drawn the ordinary rows (which
 * replaces the host's children, so this runs on every redraw).
 */
const MACROSTRAT_LINES = "macrostrat-lines";

function drawMacrostratLines() {
  const host = byId("tectonics-catalogue");
  const geo = window.GeoIDGeology;
  if (!host || !geo?.load) return;
  // By dataset id AND by name: `geologyDataset` is stamped a beat after the
  // layer registers, and the layer-change event that redraws this row fires
  // in between — matched by id alone, the fresh row read "not loaded" for a
  // layer that was, and the tick unchecked itself while the lines drew.
  const layerOf = () => (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.geologyDataset === MACROSTRAT_LINES
      || l.name === "World contacts and faults (Macrostrat)");
  const row = document.createElement("div");
  row.className = "gis-catalogue-row";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.id = "gis-cat-macrostrat-lines";
  tick.checked = Boolean(layerOf());
  const name = document.createElement("label");
  name.className = "gis-catalogue-name";
  name.htmlFor = tick.id;
  name.textContent = "World contacts and faults (Macrostrat)";
  name.title = "The lines the source maps draw between units — contacts, thrusts, "
    + "normal faults — from the Macrostrat Burwell compilation, CC BY 4.0. "
    + "Tiled: follows the view like the world geology does.";
  tick.addEventListener("change", async () => {
    if (tick.checked) {
      say("tectonics-catalogue", "Loading contacts and faults…");
      await geo.load(MACROSTRAT_LINES);
      say("tectonics-catalogue", "World contacts and faults added. Macrostrat, CC BY 4.0.");
    } else {
      const layer = layerOf();
      // A tiled layer holds GPU buffers for every tile it has built, and
      // removing the record does not free them.
      layer?.tiled?.dispose?.();
      if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
      say("tectonics-catalogue", "Contacts and faults taken off the globe.");
    }
  });
  row.append(tick, name);
  host.appendChild(row);
}

/**
 * The Volcanoes subsection's own control: how deep the labels go.
 *
 * The slider is per-DATASET rather than a global label density, because it is
 * a question about this catalogue: `label_rank` is eruption recency, and the
 * positions read as its bands ("Erupted since 1900") rather than as abstract
 * levels. It talks to `point-labels.js`, which rebuilds the label set on the
 * slider's `change`. The labels themselves are automatic — they arrive with
 * the layer, at the default level — so this slider is the one control.
 */
function wireVolcanoDetail() {
  const slider = byId("volcano-detail");
  const copy = byId("volcano-detail-copy");
  if (!slider || slider.dataset.wired) return;
  slider.dataset.wired = "1";
  const labels = window.GeoIDPointLabels;
  const caption = () => {
    if (copy) copy.textContent = labels?.DETAIL_COPY?.[Number(slider.value)] || "";
  };
  caption();
  // The caption tracks the drag; the rebuild waits for the release.
  slider.addEventListener("input", caption);
  slider.addEventListener("change", () => {
    const layer = layerForDataset("volcanoes");
    if (!layer) { say("volcanoes-catalogue", "Level saved — the labels follow when the layer is ticked on."); return; }
    labels?.setDetailLevel?.(layer, Number(slider.value));
  });
}

function init() {
  // A page with none of the hosts — a planet shell — mounts nothing rather
  // than listening for changes it will never draw.
  if (!Object.values(HOMES).some((hostId) => byId(hostId))) return;
  drawAll();
  wireVolcanoDetail();
  // Whoever took a layer off — one of these lists or the layer box — the tick
  // follows, because the list asks the catalogue rather than remembering.
  window.GeoIDImportManager?.onChange?.(drawAll);
  // The volcano type list is built FROM the legend, and the legend lands a
  // beat after the layer registers — the symbology announces itself on this
  // event, which is the moment the swatches exist to draw.
  window.addEventListener("geoid-gis:layers-changed", (event) => {
    if (event.detail?.reason === "symbology") drawVolcanoTypes();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
