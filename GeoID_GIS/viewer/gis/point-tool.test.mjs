#!/usr/bin/env node
/**
 * The Points tool's one pure seam: the GeoJSON the clicked set becomes.
 * The longitude conversion is the part that fails silently — the viewer
 * speaks 0–360 east and GeoJSON means signed, and unconverted a point off
 * Portugal files itself in central Asia.
 *
 * Run: node GeoID_GIS/viewer/gis/point-tool.test.mjs
 */

import { pointsToGeoJSON } from "./point-tool.js";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!ok) failures += 1;
};

const out = pointsToGeoJSON([
  { lat: 38.7, lon: 350.5 },   // off Portugal, in viewer 0–360
  { lat: -12.2, lon: 45.1 },
]);

check("a FeatureCollection of Points", out.type, "FeatureCollection");
check("one feature per click", out.features.length, 2);
check("viewer 0–360 becomes signed GeoJSON",
  out.features[0].geometry.coordinates, [-9.5, 38.7]);
check("an already-signed-range longitude passes through",
  out.features[1].geometry.coordinates, [45.1, -12.2]);
check("points are named in click order",
  out.features.map((f) => f.properties.name), ["Point 1", "Point 2"]);
check("the properties carry the signed longitude too",
  out.features[0].properties.lon, -9.5);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
