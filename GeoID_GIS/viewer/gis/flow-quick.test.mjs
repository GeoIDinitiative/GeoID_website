/**
 * The rail's Flow button is a second DOOR to the live wind and currents, never
 * a second implementation of them.
 *
 *   node GeoID_GIS/viewer/gis/flow-quick.test.mjs
 */

import { readFileSync } from "node:fs";

let pass = 0; let fail = 0;
function ok(cond, msg) { if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}`); } }
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

const here = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const quick = strip(here("./flow-quick.js"));
const panels = strip(here("./side-panels.js"));
const page = here("../index.html");

ok(/id: "flow"/.test(panels) && /GeoIDFlowQuick\?\.toggle/.test(panels), "the rail carries a Flow action");
ok(/when: \(\) => Boolean\(window\.GeoIDFlow\?\.add\)/.test(panels), "built only where a flow layer is loaded");
ok(/if \(spec\.when && !spec\.when\(\)\) return;/.test(panels), "side-panels honours `when`");
ok(/F\.add\(spec\.source\)/.test(quick) && /F\.remove\(spec\.source\)/.test(quick),
  "switches through GeoIDFlow, the catalogue row's own add/remove");
ok(/layerOf\?\.\(source\)/.test(quick), "reads its ticks back off the layers");
ok(/wind-flow-controls"\)\?\.querySelector\("select"\)/.test(quick) && /dispatchEvent\(new Event\("change"/.test(quick),
  "a level change presses the drawer's own select");
ok(/geoid-gis:catalogue-changed/.test(quick), "tells the catalogue rows to redraw their ticks");
ok(!/fetch\(/.test(quick), "fetches nothing of its own");
ok(/gis\/flow-quick\.js\?v=/.test(page) && page.indexOf("gis/flow-quick.js") > page.indexOf("gis/flow-layer.js"),
  "loaded on Earth's page, after the flow layer");
const style = here("./flow-quick.js").match(/const STYLE = `([\s\S]*?)`;/);
ok(style && !style[1].includes("`"), "the STYLE literal holds no backtick");
