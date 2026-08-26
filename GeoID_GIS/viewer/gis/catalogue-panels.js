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
} from "./global-data.js?v=20260826-148456a";
import { renderCatalogue, openSymbologyFor } from "./catalogue-list.js?v=20260826-148456a";

const byId = (id) => document.getElementById(id);

/** The status line under a list is the host's id with `-status` for `-catalogue`. */
const statusIdFor = (hostId) => hostId.replace(/-catalogue$/, "-status");

function say(hostId, message) {
  const node = byId(statusIdFor(hostId));
  if (node) node.textContent = message;
}

function draw(home, hostId) {
  const host = byId(hostId);
  if (!host) return;
  const entries = grouped().flatMap(({ group, entries: list }) => list
    .filter((entry) => entry.home === home)
    .map((entry) => ({
      id: entry.id,
      group,
      label: entry.label,
      title: `${entry.summary} — ${entry.licence}`,
    })));
  if (!entries.length) return;
  renderCatalogue(host, entries, {
    // No dropdown: each list is a handful of rows inside a subsection that is
    // already folded away. A lid on a lid is one press too many.
    layerFor: layerForDataset,
    add: (id) => addDataset(id, (message) => say(hostId, message)),
    remove: (id) => {
      const layer = layerForDataset(id);
      if (!layer) return;
      window.GeoIDImportManager?.removeLayer?.(layer.id);
      say(hostId, `${datasetById(id)?.label || "Dataset"} taken off the globe.`);
    },
    symbology: (layer) => {
      if (!openSymbologyFor(layer)) say(hostId, "This layer cannot be recoloured.");
    },
  });
}

function drawAll() {
  Object.entries(HOMES).forEach(([home, hostId]) => draw(home, hostId));
}

/**
 * The Volcanoes subsection's own control: how deep the labels go.
 *
 * The slider is per-DATASET rather than a global label density, because it is
 * a question about this catalogue: `label_rank` is eruption recency, and the
 * positions read as its bands ("Erupted since 1900") rather than as abstract
 * levels. It talks to `point-labels.js`, which rebuilds the label set on the
 * slider's `change` — moving it before the Names button only records the
 * choice, so a slider drag does not switch the names on uninvited.
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
    if (!layer) { say("volcanoes-catalogue", "Tick the catalogue first — the labels need the layer."); return; }
    const applied = labels?.setDetailLevel?.(layer, Number(slider.value));
    if (!applied && !labels?.isLabelled?.(layer)) {
      say("volcanoes-catalogue", "Level saved — press Names to put the labels up.");
    }
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
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
