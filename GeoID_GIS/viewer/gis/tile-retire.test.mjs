/**
 * WHAT COMES DOWN, and when.
 *
 * A streamer has two ways to say "nothing to do": the view has not changed, in
 * which case leaving the picture alone is right; and the view has changed into
 * one this picture does not describe, in which case leaving it alone is a
 * close-in patch still drawn over a globe seen from orbit. Reported as the
 * Sentinel-2 tiles failing to disappear on the way back out.
 *
 * These are source checks rather than behaviour checks, because the refiners
 * need a globe, a camera and a network. What they pin is the DISTINCTION —
 * every decline that follows a change of ground must retire, and the one that
 * follows an unchanged view must not.
 *
 * Run: node GeoID_GIS/viewer/gis/tile-retire.test.mjs
 */

import { readFileSync } from "node:fs";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function ok(c, what) { if (!c) throw new Error(what); }

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const drape = read("basemap-drape.js");

check("the imagery patch is TAKEN DOWN above the refine ceiling", () =>
  ok(/altitudeUnits\(viewer\) > MIN_REFINE_ALTITUDE\) return retireRefine/.test(drape),
    "the altitude ceiling retires rather than declining"));

check("and when the view deserves no more than the base composite", () =>
  ok(/zoom <= BASE_GLOBE_ZOOM\) return retireRefine/.test(drape),
    "the zoom floor retires"));

check("and when the basemap stops being a tile service", () =>
  ok(/if \(!source\) return retireRefine/.test(drape), "no source, no patch"));

/**
 * The one decline that must NOT retire: the camera has not moved, so the patch
 * on screen is still the right picture. Retiring here would drop the detail
 * every time somebody stopped.
 */
check("an unchanged view still leaves the patch alone", () =>
  ok(/!viewChangedEnough\(refineState\?\.bbox, bbox\)\) return null/.test(drape),
    "unchanged view declines without retiring"));

check("a change of SOURCE counts as a change", () =>
  ok(/const sameSource = refineState\?\.source === source/.test(drape)
    && /sameSource && !viewChangedEnough/.test(drape),
    "switching services while still is a rebuild, not a decline"));

check("retiring clears the box, so coming back down refines at once", () => {
  const body = drape.slice(drape.indexOf("function retireRefine"));
  ok(/refineState\.bbox = null/.test(body.slice(0, 400)), "the box goes with the mesh");
  ok(/disposeMesh\(refineState\.mesh\)/.test(body.slice(0, 400)), "and the mesh is disposed");
});

/**
 * The vector tiler was audited alongside and is clean: it ends every update by
 * turning on exactly what the view wants and everything else off, then
 * evicting. That is the shape the imagery patch was missing.
 */
check("the vector tiler already shows only what the view wants", () => {
  const tiler = read("vector-tiles.js");
  ok(/showTiles\(new Set\(\[\.\.\.pinned, \.\.\.needed\]\), new Set\(needed\)\)/.test(tiler),
    "the tidy-up pass names both sets");
  ok(/\bevict\(\);/.test(tiler), "and evicts");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
