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

// A moon's °W comes from its OWN feature markers, fitted, not from a
// first-guess rule: those were up to 180° off on Mars, Pluto and Neptune.
for (const w of ["mars", "pluto", "jupiter", "saturn", "uranus", "neptune"]) {
  const text = readFileSync(join(ROOT, "planet_explorer", w, "viewer", `${w}-viewer.js`), "utf-8");
  ok(/function flightMoonLonRule\(c\)/.test(text) && /displayLon: flightMoonLonRule\(/.test(text),
    `${w} gives the sim a fitted longitude rule for its moon`);
}
// Moon mosaics have holes (Voyager 2 saw half of Triton). A JPEG fills them
// with the server's opaque white; the patch must be a transparent PNG.
ok(/format: row\[3\] === "colour" \? "image\/png&TRANSPARENT=TRUE"/.test(sim)
  && /FORMAT=" \+ \(d\.format \|\| "image\/jpeg"\)/.test(sim),
  "a moon's detail patch is a transparent PNG; a planet's stays JPEG");
ok(/Io:\s+\["jupiter\/io_simp_cyl", "SSI_VGR_color", [^\]]*"colour"\]/.test(sim),
  "Io's colour mosaic is fetched in full colour, not an 8-bit palette");
ok(/detailEastOf|d\.eastOf/.test(sim), "the patch is placed through the moon's own east-longitude rule");
ok(/Math\.min\(preflightMaxDist \?\? Infinity, GLOBE_R \* 4\.5\)/.test(sim),
  "pre-flight never loosens the moon viewer's own zoom cap");
// A moon's markers sit inside the planet group the moon frame SCALES; a
// pixel cap that ignores that scale draws them hundreds of times too big.
for (const w of ["jupiter", "saturn", "uranus", "neptune"]) {
  const text = readFileSync(join(ROOT, "planet_explorer", w, "viewer", `${w}-viewer.js`), "utf-8");
  ok((text.match(/marsGroup\.getWorldScale\(new THREE\.Vector3\(\)\)\.x \|\| 1/g) || []).length >= 2,
    `${w}'s moon marker and label caps read the frame's scale`);
}

process.on("exit", () => {
  if (failures.length) { console.log(`\n${failures.length} failed, ${pass} passed`); failures.forEach((f) => console.log(`   ${f}`)); process.exitCode = 1; }
  else console.log(`✓  flightsim-moons.test.mjs  —  ${pass} passed`);
});
