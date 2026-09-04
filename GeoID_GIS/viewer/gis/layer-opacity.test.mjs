/**
 * What lands faded, and what must not.
 *
 * The interesting half of this rule is everything it REFUSES to call an area:
 * a drawn study area is polygons and is drawn as an edge, a drape is a
 * picture, and a tiled sheet's feature list is a snapshot that is routinely
 * empty at the moment it registers. Each of those, faded, is a worse map than
 * the one it replaced.
 *
 * Run: node GeoID_GIS/viewer/gis/layer-opacity.test.mjs
 */

import { defaultOpacityFor, drawsFilledAreas, paintOpacity, AREA_OPACITY, MARK_OPACITY }
  from "./layer-opacity.js";
import { readFileSync } from "node:fs";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: got ${a}, expected ${b}`); }
function ok(c, what) { if (!c) throw new Error(what); }

const fc = (...types) => ({
  type: "FeatureCollection",
  features: types.map((type) => ({ type: "Feature", geometry: { type }, properties: {} })),
});

check("a polygon layer opens at half", () => {
  eq(defaultOpacityFor({ collection: fc("Polygon", "Polygon") }), AREA_OPACITY, "polygons");
  eq(defaultOpacityFor({ features: fc("MultiPolygon").features }), AREA_OPACITY, "multipolygons");
});

check("points open solid", () =>
  eq(defaultOpacityFor({ collection: fc("Point", "Point", "Point") }), MARK_OPACITY, "points"));

check("lines open solid", () =>
  eq(defaultOpacityFor({ collection: fc("LineString", "MultiLineString") }), MARK_OPACITY, "lines"));

check("one polygon among marks still makes it an area", () =>
  eq(defaultOpacityFor({ collection: fc("Point", "LineString", "Polygon") }),
    AREA_OPACITY, "mixed"));

// A drawn study area is polygons and is drawn as an EDGE. Fading it makes the
// boundary harder to see and hides nothing, because an outline covers nothing.
check("an OUTLINED polygon layer is not an area", () =>
  eq(defaultOpacityFor({ collection: fc("Polygon"), getFillMode: () => "outline" }),
    MARK_OPACITY, "outline"));

check("and it is an area again once it is filled", () =>
  eq(defaultOpacityFor({ collection: fc("Polygon"), getFillMode: () => "solid" }),
    AREA_OPACITY, "solid"));

// Half a picture over a basemap is two maps averaged rather than one map read.
check("a raster is a picture, not an area", () =>
  eq(defaultOpacityFor({ raster: { width: 8, height: 8 }, collection: fc("Polygon") }),
    MARK_OPACITY, "raster"));

/**
 * The empty-snapshot case, which is the one that would fade at random. A tiled
 * layer registers with whatever was on screen, and over most ground that is
 * nothing at all -- measured, a GLiM layer reporting 0 features while its
 * tiles held half a million polygons.
 */
check("no features in hand is no opinion", () => {
  eq(defaultOpacityFor({ collection: { type: "FeatureCollection", features: [] } }),
    MARK_OPACITY, "empty");
  eq(defaultOpacityFor({}), MARK_OPACITY, "bare");
  eq(defaultOpacityFor(null), MARK_OPACITY, "null");
  ok(!drawsFilledAreas({ features: null }), "null features");
});

/**
 * THE RULE ONLY EVER FADES, and that is structural rather than a preference:
 * `setOpacity` scales what an element was drawn at, and the line buffer is
 * built at 0.9 while recording no `baseOpacity` -- so setting a layer to 1
 * promotes its lines to full. A default of exactly 1 is what stops the
 * caller ever making that call.
 */
check("the solid default is exactly 1, so a caller can skip it", () =>
  eq(MARK_OPACITY, 1, "MARK_OPACITY"));

check("only the fade is ever applied", () => {
  const src = readFileSync(new URL("./import-manager.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/defaultOpacityFor\(/.test(src), "the importer asks for the default");
  ok(/if \(!\(value < 1\)\) return;/.test(src),
    "and returns rather than setting a layer to 1, which would promote its lines");
  ok(/const stated = Number\.isFinite\(layer\.opacity\)/.test(src),
    "and reads a stated opacity in preference to guessing from the geometry");
});

/* ── wearing it: the two rules a second copy of this always gets wrong ───── */

const fakeLayer = (...mats) => ({
  traverse(fn) { fn({ material: mats.length === 1 ? mats[0] : mats }); },
});

check("blending is switched on when needed and never off again", () => {
  const m = { opacity: 1, transparent: false, userData: {} };
  paintOpacity(fakeLayer(m), 0.5);
  ok(m.transparent, "faded, so transparent");
  paintOpacity(fakeLayer(m), 1);
  // Taking a layer opaque moves it into the pass drawn BEFORE every
  // transparent one, with no renderOrder crossing between the two -- so a
  // sheet dragged up to full disappeared under the one beneath it, and a point
  // cloud drawn three metres above the ground stopped being drawn at all.
  ok(m.transparent, "and still transparent at full");
  eq(m.opacity, 1, "opacity");
});

check("an element's own weight is scaled, not replaced", () => {
  // The contact seal is drawn subtly on purpose. Overwriting it meant fading a
  // sheet to 40% PROMOTED its 55% contacts to 40% -- boundaries getting
  // heavier as the map faded.
  const seal = { opacity: 0.55, transparent: true, userData: { baseOpacity: 0.55 } };
  const fill = { opacity: 1, transparent: true, userData: {} };
  paintOpacity(fakeLayer(seal, fill), 0.5);
  eq(+seal.opacity.toFixed(3), 0.275, "seal");
  eq(fill.opacity, 0.5, "fill");
});

check("a vector layer puts its opacity back after a repaint", () => {
  const src = readFileSync(new URL("./vector-render.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const repaint = src.slice(src.indexOf("const repaintVector ="));
  ok(/paintOpacity\(object3D, liveOpacity\)/.test(repaint.slice(0, 1200)),
    "the repaint re-applies what the layer is wearing");
  ok(/applyOpacity:/.test(src), "and the layer is handed a way to set it");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
