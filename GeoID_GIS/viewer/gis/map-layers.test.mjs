/**
 * The map-overlay catalogue: the rasters that can be stacked over the basemap.
 *
 * Every entry here is somebody else's imagery, so the checks are mostly about
 * saying so — a layer that reaches the globe without a credit is a licence
 * breach waiting to be noticed by the person who owns the data.
 */

import {
  MAP_LAYERS, GROUPS, grouped, layerById, layerNameOf, pathOf,
} from "./map-layers.js";

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass += 1; console.log(`PASS ${name}`); } else {
    fail += 1;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}
const ok = (name, got) => check(name, Boolean(got), true);

/* ── the catalogue ────────────────────────────────────────────────────────── */

check("ids are unique", new Set(MAP_LAYERS.map((e) => e.id)).size, MAP_LAYERS.length);
check("every entry has a label, a summary and a licence",
  MAP_LAYERS.filter((e) => e.label && e.summary && e.licence).length, MAP_LAYERS.length);
// Every raster is somebody's work and every one of them says whose. A layer
// that reaches the globe without a credit is a licence breach waiting to be
// noticed by the person who owns the data.
check("every entry names where the image comes from",
  MAP_LAYERS.filter((e) => e.path || e.manifest).length, MAP_LAYERS.length);
check("every entry sits in a declared group",
  MAP_LAYERS.filter((e) => GROUPS.includes(e.group)).length, MAP_LAYERS.length);
check("no group is declared and left empty", grouped().length, GROUPS.length);
check("groups keep their declared order", grouped().map((g) => g.group), GROUPS);
check("layerById finds one", layerById("map-slope")?.group, "Terrain");
check("and refuses an unknown id", layerById("nope"), null);
check("the layer takes the entry's own name",
  layerNameOf(layerById("map-slope")), "GEBCO slope");

// THE DUPLICATION GUARD. Every entry here names a shipped texture by its
// manifest id, and three of those textures are also rows in the base picker —
// so hillshade, relief context and NASA's surface texture each appeared twice
// in one box under two slightly different spellings, which is what got them
// removed. The base picker won that argument (the sphere must wear something,
// and three modules read its select unguarded), leaving only the product with
// no base-texture twin. Re-adding one of these ids brings the duplicate row
// back, so the id is named rather than the count.
const OFFERED_AS_A_BASE_TEXTURE = ["derived-hillshade", "gebco-bathy-context",
  "earth-visible", "blue-marble", "elevation-dem"];
check("no overlay restates a base texture",
  MAP_LAYERS.filter((e) => OFFERED_AS_A_BASE_TEXTURE.includes(e.manifest)).length, 0);

// An overlay at full opacity is a replacement, not an overlay: the point of
// the tab is stacking them.
check("every overlay arrives partly transparent",
  MAP_LAYERS.filter((e) => e.opacity > 0 && e.opacity <= 0.9).length, MAP_LAYERS.length);
check("every path resolves", MAP_LAYERS.every((e) => e.path || e.manifest), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
