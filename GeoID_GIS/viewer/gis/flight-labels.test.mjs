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

/* Line of sight against the drawn terrain. Earth radius 3.2 units; a camera
   2 km up over (0, 0) looking at a place 20 km east; a 3 km ridge halfway. */
{
  const { terrainBlocks } = await import("./flight-labels.js");
  const U = 3.2 / 6371000, R = 3.2;
  const at = (lat, lon, hM) => {               // the label frame: lon = atan2(-z, x)
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180, r = R + hM * U;
    return { x: r * Math.cos(la) * Math.cos(lo), y: r * Math.sin(la), z: -r * Math.cos(la) * Math.sin(lo) };
  };
  const THREE = await import("../vendor/three.module.js");
  const C = new THREE.Vector3().copy(at(0, 0, 2000)), P = new THREE.Vector3().copy(at(0, 0.18, 0));
  const flat = () => 0;
  const ridge = (lat, lon) => (Math.abs(lon - 0.09) < 0.01 ? 3000 * U : 0);
  const low = (lat, lon) => (Math.abs(lon - 0.09) < 0.01 ? 200 * U : 0);
  check("flat ground hides nothing", terrainBlocks(C, P, R, false, flat), false);
  check("a 3 km ridge between hides the place", terrainBlocks(C, P, R, false, ridge), true);
  check("a 200 m rise under the sight line does not", terrainBlocks(C, P, R, false, low), false);
  // on a hillside: the ground rises to the place, which stands on it
  const Ph = new THREE.Vector3().copy(at(0, 0.18, 300));
  check("a place does not hide itself on its own slope",
    terrainBlocks(C, Ph, R, false, (lat, lon) => Math.max(0, (lon - 0.17) / 0.01) * 300 * U), false);
}

const src = readFileSync(new URL("./flight-labels.js", import.meta.url), "utf8");
check("in view, a place is hidden, named, iconified or dropped -- most significant first",
  /terrainBlocks\(camLocal, entry\.marker\.position, Rg, entry\._fsOcc\)/.test(src)
    && /showAs\(entry, "name"/.test(src) && /showAs\(entry, "icon"/.test(src), true);
check("a hidden place's leftover hit target opens no card",
  /const drawn = new Set\(labelLayer\.entries\.filter/.test(src), true);
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
