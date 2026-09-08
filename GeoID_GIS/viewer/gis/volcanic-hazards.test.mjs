/**
 * VOLCANIC HAZARD BUFFERS -- the pure halves, and the source of the merge.
 * Run: node GeoID_GIS/viewer/gis/volcanic-hazards.test.mjs
 *
 * IDIOM: `check(name, fn)` RUNS the callback; `ok(cond, msg)` throws.
 */
import { readFileSync } from "node:fs";

let pass = 0; const failures = [];
const check = (name, fn) => {
  try { fn(); pass += 1; console.log(`PASS ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };

const vh = await import("./volcanic-hazards.js");
const R = 6371;
const hav = (a, b) => { // km between [lon,lat] pairs
  const d = Math.PI / 180;
  const dLat = (b[1] - a[1]) * d, dLon = (b[0] - a[0]) * d;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * d) * Math.cos(b[1] * d) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

check("a ring is a circle on the sphere, at every latitude", () => {
  for (const [lat, lon] of [[0, 0], [37.75, 15.0], [64, -17], [-41, 174], [80, 30]]) {
    const ring = vh.circleRing(lat, lon, 50, R, 64);
    ring.forEach((p) => ok(Math.abs(hav([lon, lat], p) - 50) < 0.05, `${lat},${lon}: ${hav([lon, lat], p)}`));
  }
});
check("and is closed", () => {
  const ring = vh.circleRing(10, 20, 5, R, 32);
  ok(ring.length === 33 && ring[0][0] === ring[32][0], "first point repeated");
});
check("a ring across the antimeridian is split into two parts within +-180", () => {
  const ring = vh.circleRing(52, 179.8, 50, R, 64);
  ok(Math.max(...ring.map((p) => p[0])) > 180, "the raw ring crosses the seam");
  const parts = vh.splitAtSeam(ring);
  ok(parts.length === 2, `${parts.length} parts`);
  parts.forEach((r) => r.forEach((p) => ok(p[0] <= 180 && p[0] >= -180, `within: ${p[0]}`)));
});
check("a ring that stays inside is left as one", () => {
  ok(vh.splitAtSeam(vh.circleRing(37, 15, 50, R, 64)).length === 1, "one");
});

const volcano = (name, rank, lon = 15, lat = 37.75) => ({
  type: "Feature", properties: { name, label_rank: rank }, geometry: { type: "Point", coordinates: [lon, lat] },
});
check("which volcanoes get buffers is the catalogue's own rank", () => {
  const fs = [volcano("A", 5), volcano("B", 4), volcano("C", 3), volcano("D", 1), volcano("P", 0)];
  ok(vh.zonesFor(fs, 4).volcanoes === 2, "since 1900: ranks 5 and 4");
  ok(vh.zonesFor(fs, 1).volcanoes === 4, "every Holocene: ranks 1..5");
  ok(vh.zonesFor(fs, 1).features.every((f) => f.properties.volcano !== "P"), "never Pleistocene");
});
check("five zones per volcano, as annuli with a hole and a disc for the first", () => {
  const { features } = vh.zonesFor([volcano("Etna", 5)], 4);
  ok(features.length === vh.ZONES.length, `${features.length}`);
  ok(features[0].geometry.coordinates.length === 1, "zone 0 is a disc");
  ok(features[1].geometry.coordinates.length === 2, "zone 1 has a hole");
  ok(features[4].properties.outer_km === 50 && features[4].properties.inner_km === 35, "the last is 35-50");
});
check("the zones are Etna Explorer's, verbatim", () => {
  const etna = readFileSync(new URL("../../../earth_explorer/etna/viewer/etna-viewer.js", import.meta.url), "utf8");
  vh.ZONES.forEach((z) => {
    ok(etna.includes(`rInner: ${z.inner}, rOuter: ${z.outer}`), `${z.inner}-${z.outer} km is an Etna band`);
    ok(etna.includes(`colorHex: '${z.colour}'`), `${z.colour} is its colour`);
  });
});

/* ── the merge, on the source ─────────────────────────────────────────────── */
{
  const src = readFileSync(new URL("./volcanic-hazards.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
  check("overlaps merge by the stencil: one paint per pixel, innermost zone first", () => {
    ok(/stencilWrite = true/.test(code) && /stencilRef = 1/.test(code), "writes 1");
    ok(/stencilFunc = three\.NotEqualStencilFunc/.test(code), "refused where already 1");
    ok(/stencilZPass = three\.ReplaceStencilOp/.test(code), "claims the pixel");
    ok(/renderLift = zoneIndex \* 0\.01/.test(code), "zone order is draw order");
  });
  check("and the renderer has a stencil buffer to do it with", () => {
    ok((viewer.match(/stencil: true/g) || []).length === 3, "on every renderer attempt");
  });
  check("the seal is off, or every disc edge doubles at 50%", () => {
    ok(/geoidSeam\) \{ n\.visible = false;/.test(code), "seams hidden");
  });
  check("half strength, filed under the hazards subtab, and a model by its tag", () => {
    ok(/opacity: 0\.5,/.test(code), "0.5");
    ok(/home: "volcanic-hazards"/.test(code), "home");
    ok(/dataType: "model"/.test(code), "model");
  });
  check("the buffers follow the volcanoes off the globe, through the manager's own seam", () => {
    ok(/if \(current && !volcanoLayer\(\)\) remove\(\);/.test(code), "removed with them");
    // A catalogue removal never dispatches the DOM event; `onChange` is the
    // list every catalogue subscribes to, and it was measured to be the one
    // that fires.
    ok(/im\.onChange\(follow\)/.test(code), "subscribed to onChange");
  });
}

process.on("exit", () => {
  if (failures.length) {
    console.log(`\n${failures.length} failed, ${pass} passed`);
    failures.forEach((f) => console.log(`   ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`✓  volcanic-hazards.test.mjs  —  ${pass} passed`);
  }
});
