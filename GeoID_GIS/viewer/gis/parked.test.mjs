/**
 * Parked features stay hidden everywhere they have a door.
 *
 *   node GeoID_GIS/viewer/gis/parked.test.mjs
 */

import { readFileSync } from "node:fs";
import { PARKED, isParked } from "./parked.js";

let pass = 0; let fail = 0;
function ok(cond, msg) { if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}`); } }
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

const here = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

ok(PARKED instanceof Set && isParked("wind-flow") && !isParked("hydro-rivers"), "isParked reads the set");
for (const id of PARKED) {
  ok(typeof id === "string" && id.length > 0, `a parked id is a name: ${id}`);
}
ok(/!isParked\(entry\.id\) && entry\.ready\(\)/.test(here("./catalogue-panels.js")),
  "a parked catalogue row is never drawn");
ok(/if \(isParked\(spec\.id\)\) return;/.test(here("./side-panels.js")),
  "a parked rail button is never built");
ok(/isParked\("traffic-air"\)[\s\S]{0,200}traffic-air-card[\s\S]{0,80}hidden = true/.test(here("./traffic.js")),
  "the aircraft card is hidden while parked, and its feeds are never polled");
for (const id of ["wind-flow", "current-flow"]) {
  ok(new RegExp(`id: "${id}"`).test(here("./catalogue-panels.js")), `${id} is still a real row to un-park`);
}
