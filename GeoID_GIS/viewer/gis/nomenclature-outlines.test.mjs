/**
 * Run: node GeoID_GIS/viewer/gis/nomenclature-outlines.test.mjs
 * The IAU outline layer: what each world is given, the west-positive flip,
 * and -- where the bake is on disk -- that every file will be taken by the
 * importer as georeferenced (every longitude inside ±180, every latitude
 * inside ±90) and carries the columns the card reads.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
let passed = 0; const failures = [];
const ok = (cond, msg) => { if (cond) passed += 1; else failures.push(msg); };
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`${passed} passed${failures.length ? `, ${failures.length} failed` : ""}`);
  if (failures.length) process.exitCode = 1;
});

const m = await import("./nomenclature-outlines.js");
ok(Object.keys(m.OUTLINE_BODIES).sort().join() === "mercury,moon,pluto,venus", "the four surfaced worlds the gazetteer outlines");
ok(!m.OUTLINE_BODIES.mars, "no Mars: the gazetteer publishes no outlines for it");
ok(m.isWestPositive("mercury") && !m.isWestPositive("moon") && !m.isWestPositive("venus") && !m.isWestPositive("pluto"),
  "only Mercury's viewer reads longitude west-positive");
const fc = { type: "FeatureCollection", features: [
  { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[10, 1], [-20, 2], [0, 3], [10, 1]]] } },
  { type: "Feature", properties: {}, geometry: null }] };
const w = m.toWestPositive(fc);
ok(JSON.stringify(w.features[0].geometry.coordinates) === "[[[-10,1],[20,2],[0,3],[-10,1]]]", "the flip negates longitude and keeps latitude");
ok(fc.features[0].geometry.coordinates[0][0][0] === 10, "and does not touch the file it was given");
ok(w.features[1].geometry === null, "a feature with no geometry passes through");

const src = readFileSync(join(HERE, "nomenclature-outlines.js"), "utf8");
ok(/frame: false, hold: false/.test(src), "loading does not throw the camera or stop the globe");
ok(/<input id="nomenclature-outlines-toggle" type="checkbox"\n/.test(src) && !/nomenclature-outlines-toggle" type="checkbox" checked/.test(src), "the tick opens OFF");
ok(/<summary[^>]*>[\s\S]*nomenclature-outlines-toggle[\s\S]*<\/summary>/.test(src), "the tick is on the card header, visible while folded");
ok(/importFileList/.test(src), "it goes in through the importer, so it is an ordinary Workspace layer");
ok(/"\.\/nomenclature-outlines\.js"/.test(readFileSync(join(HERE, "boot.js"), "utf8")), "the planet pages load it");

for (const body of Object.keys(m.OUTLINE_BODIES)) {
  const p = join(ROOT, "data", "global", "nomenclature", `${body}.geojson`);
  if (!existsSync(p)) { console.log(`   (${body}.geojson not on disk -- bake-nomenclature.py; file checks skipped)`); continue; }
  const d = JSON.parse(readFileSync(p, "utf8"));
  let lonBad = 0, latBad = 0;
  const walk = (c) => { if (typeof c[0] === "number") { if (Math.abs(c[0]) > 180) lonBad++; if (Math.abs(c[1]) > 90) latBad++; } else c.forEach(walk); };
  d.features.forEach((f) => walk(f.geometry.coordinates));
  ok(lonBad === 0 && latBad === 0, `${body}: every coordinate is signed east inside ±180/±90 (${lonBad}, ${latBad})`);
  ok(d.features.length > 50 && d.features.every((f) => f.properties.name && f.properties.type), `${body}: named and typed features (${d.features.length})`);
  ok(!d.features.some((f) => /Ã/.test(f.properties.name)), `${body}: names decoded as UTF-8`);
}
