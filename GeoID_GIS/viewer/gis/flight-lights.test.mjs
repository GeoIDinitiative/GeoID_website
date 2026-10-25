// Earth Flight's street lamps stand still (flight-lights.js, "THE LAMPS STAND
// STILL"), and the locator map carries no zoom-level readout (flight-map.js).
//   node GeoID_GIS/viewer/gis/flight-lights.test.mjs
import { readFileSync } from "node:fs";

let failures = 0;
const check = (name, ok) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };

const lights = readFileSync(new URL("./flight-lights.js", import.meta.url), "utf8");
// Position through modelViewMatrix (built on the CPU in double precision);
// viewMatrix * (modelMatrix * position) on the GPU rounds the globe-scale
// translation to ~0.4 m and the lamps shook as the planet turned.
check("lamps are projected through modelViewMatrix",
  /vec4 mv = modelViewMatrix \* vec4\(position, 1\.0\);/.test(lights));
check("pools are projected through modelViewMatrix",
  /gl_Position = projectionMatrix \* modelViewMatrix \* instanceMatrix \* vec4\(position, 1\.0\);/.test(lights));
check("nothing is projected from a world position computed on the GPU",
  !/viewMatrix \* wp/.test(lights));

const map = readFileSync(new URL("./flight-map.js", import.meta.url), "utf8");
check("the locator map shows no zoom level (Z9)", !/fs-map-zoom/.test(map) && !/`Z\$\{/.test(map));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
