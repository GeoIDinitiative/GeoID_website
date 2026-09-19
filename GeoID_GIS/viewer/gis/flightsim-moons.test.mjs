// Flight over a moon is the planet's flight code answering for another body
// (scripts/flightsim.js: bodyHooks / moonHooks / the moon frame). These pin
// the separation rules on the source, because none of them fails loudly.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sim = readFileSync(join(ROOT, "scripts", "flightsim.js"), "utf-8");
let pass = 0; const failures = [];
const ok = (cond, name) => { if (cond) pass += 1; else failures.push(name); };

ok(/flightMoon = baseHooks\.getFlightMoon\?\.\(\) \|\| null;/.test(sim),
  "the flight is BOUND to the moon in view at engage");
ok(/liveName !== \(flightMoon \? flightMoon\.name : null\)\) \{ disengage\(\); return; \}/.test(sim),
  "opening, closing or switching a moon viewer mid-flight ends the flight");
ok(/child\.isLight \|\| moonFrame\.simOwned\.has\(child\)/.test(sim),
  "lights and the sim's own objects stay out of the moon frame");
ok(/terrainScale: null,\s*baseLayerSelect: null,/.test(sim),
  "a moon flight never touches the planet's relief or basemap");
ok(/getSpinDelta: \(\) => 0,/.test(sim), "a moon's rotation is its mesh's, not the planet's spin");
ok(/body\.fs-moon-flight #scale-readout/.test(readFileSync(join(ROOT, "styles", "flightsim.css"), "utf-8")),
  "the planet-unit scale bar stands down over a moon");
for (const w of ["mars", "pluto", "jupiter", "saturn", "uranus", "neptune"]) {
  const text = readFileSync(join(ROOT, "planet_explorer", w, "viewer", `${w}-viewer.js`), "utf-8");
  ok(text.includes("getFlightMoon: () => {"), `${w} says which moon is open`);
}

process.on("exit", () => {
  if (failures.length) { console.log(`\n${failures.length} failed, ${pass} passed`); failures.forEach((f) => console.log(`   ${f}`)); process.exitCode = 1; }
  else console.log(`✓  flightsim-moons.test.mjs  —  ${pass} passed`);
});
