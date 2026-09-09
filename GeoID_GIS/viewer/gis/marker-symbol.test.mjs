/**
 * MARKER SYMBOL AND CLEARANCE -- source pins; the renderer wants THREE and a document.
 * Run: node GeoID_GIS/viewer/gis/marker-symbol.test.mjs
 * IDIOM: check(name, fn) RUNS the callback; ok(cond, msg) throws.
 */
import { readFileSync } from "node:fs";
let pass = 0; const failures = [];
const check = (name, fn) => { try { fn(); pass += 1; console.log(`PASS ${name}`); } catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); } };
const ok = (c, what) => { if (!c) throw new Error(what); };
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const render = read("./vector-render.js"), im = read("./import-manager.js"), gd = read("./global-data.js");

check("a marker may be a triangle, drawn as the disc is and shared like it", () => {
  ok(/export function markerTriangleTexture\(\)/.test(render), "the texture exists");
  ok(/triangleTexture\.userData\.shared = true/.test(render), "and is shared, never disposed");
  ok(/const markerMap = pointSymbol === "triangle" \? markerTriangleTexture\(\) : markerDiscTexture\(\);/.test(render), "chosen by pointSymbol");
  ok((render.match(/map: markerMap/g) || []).length === 2, "for the fill AND the outline underlay");
});
check("a marker's clearance is a constant 30 m of ground, not 2% of the altitude", () => {
  const m = render.match(/const MARKER_DRAPE_UNIFORM = \{ value: (\d+) \/ (\d+) \};/);
  ok(m && Number(m[1]) === 30 && Number(m[2]) === 1991000, "30 m in scene units");
  ok((render.match(/\{ lifted: "marker", cullFarSide: true \}/g) || []).length === 2, "both marker draws take it");
  ok(/lifted === "marker" \? MARKER_DRAPE_UNIFORM/.test(render), "and followRelief honours it");
  ok(/lifted === "marker" \? "marker" : lifted \? "live" : drape/.test(render), "with its own program cache key");
});
check("the symbol rides from the catalogue entry to the renderer", () => {
  ok(/pointSymbol: entry\.pointSymbol \|\| "disc"/.test(gd), "addDataset passes it");
  ok(/pointSymbol: ctx\?\.pointSymbol \|\| "disc"/.test(im), "the geojson parser carries it");
  ok(/pointSymbol = "disc",\n  rankOf = null,/.test(render) && (render.match(/pointStyle, pointSymbol, rankOf/g) || []).length === 2, "and buildVectorLayerResult forwards it on both paint paths");
  ok(/id: "volcanoes",[\s\S]{0,2000}pointSymbol: "triangle"/.test(gd), "the volcanoes name it");
});

process.on("exit", () => {
  if (failures.length) { console.log(`\n${failures.length} failed, ${pass} passed`); failures.forEach((f) => console.log(`   ${f}`)); process.exitCode = 1; }
  else console.log(`✓  marker-symbol.test.mjs  —  ${pass} passed`);
});
