/**
 * ICE COVER — its own subtab, and its own layer.
 *
 * The ice sheets were in the geological map because Macrostrat ships them in
 * the same tiles: polygons named "Phanerozoic ice" with no lithology at all,
 * 24.5% of the features over Antarctica. `ice-cover.js` is the predicate that
 * separates them; this is the row that turns the ice half on.
 *
 * The geology layer no longer draws them at all, so this subtab is the only way
 * to see them — which is the point. A reader who wants the bedrock under the
 * ice now gets it, and a reader who wants the ice gets a layer that says it is
 * ice rather than a hole in a geological map.
 */

import { loadDerivedGeologyMap, removeDerivedGeologyMap }
  from "./geology-panel.js?v=20260901-6ffcdfa";

const LAYER_ID = "ice-cover";

/**
 * One colour, because there is one thing here.
 *
 * A pale blue-white reads as ice at every zoom and against both the imagery
 * and the geology, and classing it further would be inventing a distinction
 * the source does not make: these polygons carry no lithology, no age beyond
 * "Phanerozoic" and no thickness.
 */
const ICE_COLOUR = "#cfe8f5";

let statusNode = null;

function say(message) {
  if (statusNode) statusNode.textContent = message || "";
}

function isOn() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .some((l) => l.geologyDataset === LAYER_ID);
}

function buildSection() {
  const node = document.createElement("details");
  node.className = "gis-tool-section";
  node.id = "ice-cover-section";
  const summary = document.createElement("summary");
  summary.textContent = "Ice cover";
  node.appendChild(summary);

  const body = document.createElement("div");
  body.className = "gis-tool-body";

  const copy = document.createElement("p");
  copy.className = "tool-copy";
  copy.textContent = "Macrostrat maps the ice sheets as polygons in the same "
    + "tiles as the bedrock — 24.5% of the features over Antarctica — so they "
    + "are separated out here and the geological map shows the ground beneath "
    + "them. Glacial DEPOSITS are geology and stay on that map: only the ice "
    + "itself is here.";
  body.appendChild(copy);

  const row = document.createElement("label");
  row.className = "gis-catalogue-row";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.checked = isOn();
  const name = document.createElement("span");
  name.className = "gis-catalogue-name";
  name.textContent = "Ice and permanent snow";
  row.title = "The ice-cover polygons from the Macrostrat compilation, as "
    + "their own layer. They carry no lithology, so a rock-property map reads "
    + "them through the ice entry in the property database.";

  tick.addEventListener("change", async () => {
    if (!tick.checked) {
      removeDerivedGeologyMap(LAYER_ID);
      say("Ice cover removed.");
      return;
    }
    tick.disabled = true;
    say("Ice cover: reading the same tiles…");
    try {
      const { isIceCover } = await import(
        `./ice-cover.js${new URL(import.meta.url).search}`);
      const layer = await loadDerivedGeologyMap({
        id: LAYER_ID,
        label: "Ice cover (Macrostrat)",
        featureFilter: isIceCover,
        colourFor: () => ICE_COLOUR,
        legendInfo: {
          palette: [ICE_COLOUR.replace("#", "")],
          labels: ["Ice and permanent snow"],
          values: ["Ice and permanent snow"],
          categorical: true, classed: true, field: "Ice cover",
        },
      });
      if (!layer) { say("Ice cover could not be added."); tick.checked = false; return; }
      const count = (layer.features || []).length;
      /**
       * The count is worth saying because it is usually ZERO. Ice cover exists
       * over Greenland, Antarctica and the high mountains and nowhere else, so
       * a reader who ticks this over Britain and sees nothing should be told
       * that is the answer rather than left wondering whether it failed.
       */
      say(count
        ? `Ice cover: ${count.toLocaleString()} polygons in view.`
        : "Ice cover: none in this view — the layer is on, and there is no ice "
          + "mapped here. Fly to Greenland, Antarctica or a high range.");
    } catch (error) {
      say("Ice cover could not be built.");
      tick.checked = false;
    } finally {
      tick.disabled = false;
    }
  });

  row.append(tick, name);
  body.appendChild(row);

  statusNode = document.createElement("p");
  statusNode.className = "tool-status";
  body.appendChild(statusNode);

  node.appendChild(body);
  return node;
}

/** Mount when the host exists — the pattern `earth-data-panel.js` documents. */
function whenHost(selector, place) {
  let tries = 0;
  const tick = () => {
    const host = document.querySelector(selector);
    if (host) { place(host); return; }
    if ((tries += 1) < 50) window.setTimeout(tick, 300);
  };
  tick();
}

export function init() {
  if (document.getElementById("ice-cover-section")) return;
  whenHost("#geology-section .section-body .control-stack", (host) => {
    if (document.getElementById("ice-cover-section")) return;
    host.appendChild(buildSection());
  });
}

if (typeof window !== "undefined") {
  window.GeoIDIceCoverPanel = { init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
