/**
 * The elevation catalogue: three readings of the streamed DEM.
 *
 * One row was a tick with a status line; three want the shared catalogue
 * renderer, so a tick here means what a tick means in the geology, hydrology
 * and basemap lists — same row, same ⓘ, same behaviour when it fails.
 *
 * They are three READINGS rather than three sources: slope and hillshade are
 * arithmetic on the same streamed grid, through the same `raster-analysis`
 * functions the tool registry runs, so ticking all three costs one tile fetch.
 *
 * The shipped GEBCO hillshade and slope stay in Basemaps. Those are global and
 * instant; these are the local answer, at the view's own scale.
 */

import { renderCatalogue } from "./catalogue-list.js?v=20260905-f8b2b19";
import { SHEETS, addSheet, removeSheet, sheetLayer } from "./dem-layer.js?v=20260905-f8b2b19";
import { TERRARIUM } from "./dem-tiles.js?v=20260905-f8b2b19";

const HOST_ID = "dem-panel-host";
const STATUS_ID = "dem-panel-status";

function say(message) {
  const node = document.getElementById(STATUS_ID);
  if (node) node.textContent = message || "";
}

const ORDER = ["elevation", "slope", "hillshade"];

function entries() {
  return ORDER.map((kind) => {
    const spec = SHEETS[kind];
    return {
      id: spec.id,
      group: "Streamed elevation",
      label: spec.label,
      title: `${spec.summary} — ${TERRARIUM.licence}`,
      info: { summary: spec.summary, citation: TERRARIUM.credit },
    };
  });
}

const kindOf = (id) => ORDER.find((kind) => SHEETS[kind].id === id) || null;

function draw() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  renderCatalogue(host, entries(), {
    // No lid: three rows do not need a dropdown, and the sub-tab is already
    // one fold deep.
    layerFor: (id) => sheetLayer(kindOf(id)),
    add: async (id) => {
      const out = await addSheet(kindOf(id), say);
      // The layer is the truth about whether it loaded, never the press.
      if (!out?.ok) say(out?.message || "That sheet could not be drawn.");
      return out;
    },
    remove: (id) => { removeSheet(kindOf(id)); say(""); return true; },
    onStatus: say,
  });
}

function init() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  const status = document.createElement("p");
  status.id = STATUS_ID;
  status.className = "gis-metric";
  host.after(status);
  draw();
  // A sheet removed from the layer box has to take its tick with it.
  document.addEventListener("geoid-gis:layers-changed", draw);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
