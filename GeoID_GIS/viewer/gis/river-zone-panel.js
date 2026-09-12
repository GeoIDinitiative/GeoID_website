/**
 * The corridor zones' switches. A tick RECOLOURS the sheet already on the
 * globe — the classes do not change when a zone is hidden, only which of them
 * are painted — so it is instant, and the key follows it: a legend listing a
 * zone that is switched off describes a map that is not on screen.
 */

import { riverZoneState, riverZonePaint, riverZoneLegend, sheetLayer, SHEETS }
  from "./dem-layer.js?v=20260912-136b2bf";

function apply() {
  const layer = sheetLayer("riverzones");
  if (!layer) return;
  layer.repaint?.(riverZonePaint());
  layer.legendInfo = riverZoneLegend();
  window.GeoIDLayerHierarchy?.render?.();
  const status = document.getElementById("hydrology-status");
  if (status) status.textContent = SHEETS.riverzones.status();
}

function init() {
  const host = document.getElementById("river-zone-controls");
  if (!host) return;
  host.querySelectorAll("[data-river-zone]").forEach((box) => {
    box.checked = Boolean(riverZoneState.on[box.dataset.riverZone]);
    box.addEventListener("change", () => {
      riverZoneState.on[box.dataset.riverZone] = box.checked;
      apply();
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
