// Earth Flight's labels follow the GeoHUB's own label controls (flight-labels.js,
// "THE GEOHUB'S OWN LABEL CONTROLS STEER THE FLIGHT'S LABELS").
//   node GeoID_GIS/viewer/gis/flight-labels.test.mjs
import { readFileSync } from "node:fs";
import { flightLabelAllowed } from "./flight-labels.js";

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`}`);
}

const city = { name: "Belfast", category: "place-city" };
const museum = { name: "Ulster Museum", category: "place-culture" };

check("on by default: a flight label shows whatever the globe's categories say",
  flightLabelAllowed(city, { on: true, off: new Set() }), true);
check("the eye or the master switch off hides every flight label",
  [flightLabelAllowed(city, { on: false, off: new Set() }), flightLabelAllowed(museum, { on: false, off: new Set() })], [false, false]);
check("a category unticked by hand hides that category only",
  [flightLabelAllowed(city, { on: true, off: new Set(["place-city"]) }), flightLabelAllowed(museum, { on: true, off: new Set(["place-city"]) })], [false, true]);

const src = readFileSync(new URL("./flight-labels.js", import.meta.url), "utf8");
check("the places are cut by the controls before their windows",
  /const consider = \(item\) => \{\s*if \(!flightLabelAllowed\(item\)\) return;/.test(src), true);
check("only a hand's tick on a category counts, not the eye's cascade",
  /e\.isTrusted && t\.dataset\?\.placeCategory/.test(src), true);
check("the chips follow the Workspace's label-size slider",
  /chipPx = Math\.max\(24, 30 \* \(TIER_SIZE\[tier\] \|\| 1\)\) \* \(window\.GeoIDViewer\?\.getLabelSizeScale\?\.\(\) \|\| 1\)/.test(src), true);
check("listened to only while flying",
  /addEventListener\("change", onLabelControl\)/.test(src) && /removeEventListener\("change", onLabelControl\)/.test(src), true);

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
