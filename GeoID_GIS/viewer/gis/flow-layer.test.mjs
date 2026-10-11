/**
 * Structural pins for the flow layers (wind, ocean currents). The arithmetic
 * is pinned in flow-field.test.mjs; these hold the wiring that a page needs
 * and a unit test of the field cannot see.
 * Run: node GeoID_GIS/viewer/gis/flow-layer.test.mjs
 */
import { readFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const read = (name) => readFileSync(new URL(name, here), "utf8");
let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass += 1;
  else { fail += 1; console.error("FAIL:", msg); }
}
process.on("exit", () => {
  console.log(`flow-layer: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

const layer = read("flow-layer.js");
const panels = read("catalogue-panels.js");
const popup = read("feature-popup.js");
const page = readFileSync(new URL("../index.html", here), "utf8");

// A trail segment is drawn only when both its ends are from this life: the
// first cut joined a respawned particle's head to its previous life and drew
// straight streaks across the map.
ok(/const visible = s >= TRAIL - filled;/.test(layer), "a segment joins two points of the same life");
ok(/white \? WHITE : rampAt/.test(layer), "lines over a sheet of the same quantity are white");
ok(!/onViewSettled/.test(layer), "the view is tracked from the loop, not a settle poll that misses eased moves");
ok(/nativeDeg/.test(layer), "a lattice is never finer than the model it reads");
ok(/convention: "from"/.test(layer) && /convention: "to"/.test(layer), "wind is FROM, a current is TO");

// The rows, their drawers, and the click.
for (const [id, source, drawer] of [["wind-flow", "wind", "wind-flow-controls"], ["current-flow", "currents", "current-flow-controls"]]) {
  ok(panels.includes(`id: "${id}"`), `${id} is a catalogue row`);
  ok(panels.includes(`settings: "${drawer}"`) && layer.includes(`"${drawer}"`), `${id}'s drawer is the one the layer builds`);
  ok(panels.includes(`GeoIDFlow.add("${source}")`) && panels.includes(`GeoIDFlow?.layerOf?.("${source}")`), `${id} loads and reads back its own source`);
}
ok(/geoid-gis:catalogue-changed/.test(panels) && /geoid-gis:catalogue-changed/.test(layer), "rows appear when the module is up, not at the next redraw");
ok(/GeoIDFlow\?\.probeAt\?\.\(at\.lat, at\.lon\)/.test(popup), "a click reads the flow at the point");
ok(/gis\/flow-layer\.js\?v=/.test(page), "the Earth page loads the module, stamped");

// Forecast hazards: a third row, a sheet with nothing moving on it, keyed in
// each discipline's own thresholds and clear below the first of them.
ok(panels.includes('id: "forecast-hazards"') && panels.includes('settings: "hazard-field-controls"'), "forecast hazards are a row with a drawer");
ok(/if \(!state\.particles\) return;/.test(layer), "a scalar sheet runs no particles");
ok(/hv\.below \? v > hv\.floor : v < hv\.floor/.test(layer), "below its first threshold a hazard sheet is clear");
{
  const mod = await import("./flow-layer.js");
  ok(mod.hazardBand("precip", 120) === "extreme — flash flooding likely", "120 mm is extreme rain");
  ok(mod.hazardBand("gusts", 26) === "storm — structural damage", "26 m/s is storm force");
  ok(mod.hazardBand("cold", -30) === "frostbite in 30 minutes", "cold bands read downwards");
  ok(Object.values(mod.HAZARD_VARS).every((hv) => Number.isFinite(hv.floor)), "every hazard has a floor");
}
