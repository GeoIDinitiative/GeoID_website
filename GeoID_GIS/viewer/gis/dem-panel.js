/**
 * The streamed DEM's own control, in the Elevation sub-tab.
 *
 * It was a row in the Basemaps catalogue for an afternoon and that was the
 * wrong shelf: that list is PICTURES to dress the sphere with, and this is the
 * shape of the ground — the same subject as the vertical exaggeration and the
 * contour interval it now sits with.
 *
 * One tick, one status line, and the tick is read back off the LAYER rather
 * than remembered here: a tick that says yes over a layer that failed to load
 * is the fault the GLiM row already cost.
 */

import { addDemLayer, removeDemLayer, demLayer, DEM_LAYER_NAME }
  from "./dem-layer.js?v=20260904-11cd741";
import { TERRARIUM } from "./dem-tiles.js?v=20260904-11cd741";

const HOST_ID = "dem-panel-host";

let statusNode = null;

function say(message) {
  if (statusNode) statusNode.textContent = message || "";
}

function syncTick(tick) {
  if (tick) tick.checked = Boolean(demLayer());
}

function build(host) {
  host.textContent = "";

  const row = document.createElement("div");
  row.className = "gis-catalogue-row";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.id = "gis-dem-streamed";
  tick.className = "checkbox";
  const label = document.createElement("label");
  label.className = "gis-catalogue-name";
  label.setAttribute("for", tick.id);
  label.textContent = "Streamed elevation (Mapzen)";
  label.title = `${TERRARIUM.credit} ${TERRARIUM.licence}`;
  row.append(tick, label);

  const blurb = document.createElement("p");
  blurb.className = "gis-setting-hint";
  blurb.textContent = "Real heights as a sheet on the ground — about 19.6 km "
    + "posts worldwide, sharpening where you fly in. The cursor readout and the "
    + "terrain tools read the same source whether or not this is drawn.";

  statusNode = document.createElement("p");
  statusNode.className = "gis-metric";

  tick.addEventListener("change", async () => {
    if (!tick.checked) {
      removeDemLayer();
      say("");
      syncTick(tick);
      return;
    }
    tick.disabled = true;
    try {
      const out = await addDemLayer(say);
      // The layer is the truth about whether it loaded, never the press.
      if (!out?.ok) say(out?.message || `${DEM_LAYER_NAME} could not be drawn.`);
    } finally {
      tick.disabled = false;
      syncTick(tick);
    }
  });

  host.append(row, blurb, statusNode);
  // A layer removed from the layer box has to take the tick with it.
  document.addEventListener("geoid-gis:layers-changed", () => syncTick(tick));
  syncTick(tick);
}

function init() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  build(host);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
