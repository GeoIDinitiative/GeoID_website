// Earth Flight's street lamps: placed along roads at their class's pitch,
// staggered side to side, none on unlit classes, and lit only where Black
// Marble says the place is lit.
//
//   node flight_sim/earth/tests/lamps.test.mjs

import { placeLamps, litPower, radianceAboveBackground, LAMP_CLASSES } from "../game/lamps.js";

let failed = 0, passed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (ok) passed++; else failed++;
};

// A 1,000 m tile of 1,000 units: one unit is one metre.
const straight = (cls) => [{ cls, pts: [[0, 500], [1000, 500]] }];
const minor = placeLamps(straight("minor"), 1000, 1000);
const nMinor = minor.length / 4;
check("a residential street gets a lamp about every 30 m", nMinor >= 30 && nMinor <= 36, String(nMinor));
const motorway = placeLamps(straight("motorway"), 1000, 1000);
check("a motorway's are further apart (~45 m)", motorway.length / 4 >= 20 && motorway.length / 4 <= 24, String(motorway.length / 4));
const sides = [];
for (let i = 0; i < minor.length; i += 4) sides.push(Math.sign(minor[i + 1] - 0.5));
check("lamps are staggered either side of the road", sides.every((s, i) => i === 0 || s === -sides[i - 1]));
check("set back from the centre line by the class's offset", Math.abs(Math.abs(minor[1] - 0.5) * 1000 - LAMP_CLASSES.minor.offset) < 0.01);
check("no lamps on tracks, paths or rail", placeLamps([...straight("track"), ...straight("path"), ...straight("rail")], 1000, 1000).length === 0);
check("a level can ask for main roads only", placeLamps(straight("minor"), 1000, 1000, ["motorway", "primary"]).length === 0);
const again = placeLamps(straight("minor"), 1000, 1000);
check("the same road gives the same lamps every time", again.every((v, i) => v === minor[i]));
check("pitch continues across a bend (no doubled lamp at the vertex)", (() => {
  const L = placeLamps([{ cls: "minor", pts: [[0, 500], [500, 500], [500, 0]] }], 1000, 1000);
  for (let i = 4; i < L.length; i += 4) if (Math.hypot(L[i] - L[i - 4], L[i + 1] - L[i - 3]) * 1000 < 10) return false;
  return true;
})());

check("Black Marble's dark background is no radiance", radianceAboveBackground(18, 20, 35) === 0);
check("a town centre is full radiance", radianceAboveBackground(255, 255, 255) === 1);
check("a motorway in dark country stays dark", litPower(LAMP_CLASSES.motorway.code, 0.01) === 0);
check("...but is lit through a faintly lit area", litPower(LAMP_CLASSES.motorway.code, 0.1) > 0);
check("a residential street needs a lit town round it", litPower(LAMP_CLASSES.minor.code, 0.1) === 0 && litPower(LAMP_CLASSES.minor.code, 0.4) > 0);
check("brighter places light their lamps more strongly", litPower(2, 0.9) > litPower(2, 0.2));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
