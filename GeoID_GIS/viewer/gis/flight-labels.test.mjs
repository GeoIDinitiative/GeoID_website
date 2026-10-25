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
check("a click is matched on screen against what is drawn: name, skyline flag, triangle, dot",
  /function pickDrawn\(/.test(src) && /consider\(e, e\.sprite, 4, 0\)/.test(src) && /consider\(e, e\._fsHLabel, 3, 0\)/.test(src)
    && /consider\(e, e\._fsTri, 2, 18\)/.test(src) && /consider\(e, e\.marker, 1, 16\)/.test(src) && !/new THREE\.Raycaster/.test(src), true);
check("the places are cut by the controls before their windows",
  /const consider = \(item\) => \{\s*if \(!flightLabelAllowed\(item\)\) return;/.test(src), true);
check("only a hand's tick on a category counts, not the eye's cascade",
  /e\.isTrusted && t\.dataset\?\.placeCategory/.test(src), true);
check("the chips follow the Workspace's label-size slider",
  /chipPx = Math\.max\(22, [^;]*\)\s*\* \(window\.GeoIDViewer\?\.getLabelSizeScale\?\.\(\) \|\| 1\)/.test(src), true);
check("and their distance: near larger, far smaller, never under 22 px",
  /const near = 1 - smooth\(0, Math\.log\(NAME_KM\[tier\]\), Math\.log\(Math\.max\(km, 1\)\)\);/.test(src)
    && /Math\.max\(22, 30 \* \(TIER_SIZE\[tier\] \|\| 1\) \* \(0\.72 \+ 0\.58 \* near\)\)/.test(src), true);
check("listened to only while flying",
  /addEventListener\("change", onLabelControl\)/.test(src) && /removeEventListener\("change", onLabelControl\)/.test(src), true);

// The Workspace's Location labels eye sweeps the label boxes in Locations and
// nothing else: a tool card's own switch there (the GeoID Network's Community
// layer, the IAU outlines) is a layer, and the eye loaded it onto the globe.
{
  const lh = readFileSync(new URL("./layer-hierarchy.js", import.meta.url), "utf8");
  check("the Location labels eye leaves tool cards' switches (Community) alone",
    /const LOCATION_BOXES = [^;]*:not\(\.gis-tool-section input\)/.test(lh), true);
  const sb = readFileSync(new URL("./social-bridge.js", import.meta.url), "utf8");
  check("and the Community switch is inside such a card",
    /wrap\.className = "gis-tool-section";[\s\S]{0,1200}id="social-community-toggle"/.test(sb), true);
}

// The distance factor is used by the chip AND the dot: declared inside the
// chip's block, the dot threw a ReferenceError every frame and no label was
// ever placed over its dot (leaders slanting into the sky, Mars-sized dots).
check("the distance factor is in scope for the chip and the dot",
  /const near = 1 - smooth[^\n]*\n\s*if \(entry\.baseScale\) \{/.test(src), true);
check("dots are sized from the sphere's radius, 4-6 px",
  /const dotR = entry\.marker\.geometry\?\.parameters\?\.radius/.test(src)
    && /setScalar\(\(distCam \* anglePerPx \* dotPx\) \/ \(2 \* dotR\)\)/.test(src), true);

check("the small tiers are capped at 5 km in flight too (curated ones included)",
  /reachKm: lod >= 5 \? Math\.min\(reachKm, SMALL_REACH_KM\) : reachKm/.test(src), true);
check("skyline flags are held steady: quick up, slow down, reset when hidden",
  /eRaw > ePrev \? 0\.3 : 0\.04/.test(src) && /e\._fsSky = undefined;/.test(src), true);

// ONE SWITCH (owner, 2026-10-25: the Workspace row read off over a sky full of
// labels, and needed on -> off to switch them off).
{
  const lh = readFileSync(new URL("./layer-hierarchy.js", import.meta.url), "utf8");
  check("in flight the Workspace row shows the flight's labels, not the globe's boxes",
    /const on = fl \? fl\.isOn\(\) : boxes\.some\(\(box\) => box\.checked\);/.test(lh), true);
  check("...and its click sets them before it re-renders",
    /flyingLabels\(\)\?\.setOn\(e\.target\.checked\);[\s\S]{0,80}const all = locationBoxes\(\);/.test(lh), true);
  check("it re-renders on take-off, landing and every change of the flight's switch",
    /"flightsim:engaged", "flightsim:disengaged", "geoid:flight-labels-changed"/.test(lh), true);
  check("a flight starts with labels off only if GeoHUB's were switched off by hand",
    /control\.on = !window\.GeoIDLayerHierarchy\?\.labelsSwitchedOff\?\.\(\);\s*announce\(\);/.test(src), true);
  check("the switch is exposed for the row and announced when it moves",
    /window\.GeoIDFlightLabels = \{ isOn: \(\) => control\.on, setOn: setLabelsOn \};/.test(src)
      && /new CustomEvent\("geoid:flight-labels-changed"/.test(src), true);
  const ev = readFileSync(new URL("./events.js", import.meta.url), "utf8");
  check("Events: a stale stored 'off' from older builds no longer holds the feed off",
    /const ACTIVE_KEY = "geoid-gis:events-active-2";/.test(ev) && /removeItem\("geoid-gis:events-active"\)/.test(ev), true);
}

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
