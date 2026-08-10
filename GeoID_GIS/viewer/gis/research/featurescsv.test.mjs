/**
 * Features to CSV — the step that lets a live pull reach the analysis pages.
 *
 * A pull writes GeoJSON for the globe; every analysis page reads CSV. This is
 * the bridge, and it fails quietly when it is wrong (a dropped column, a comma
 * that splits a row), so the awkward cases are pinned here.
 *
 *   node GeoID_GIS/viewer/gis/research/featurescsv.test.mjs
 */

import { featuresToCsv } from "./qt-runtime.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const quake = (mag, place, extra = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [-121.5, 36.8, 4.2] },
  properties: { magnitude: mag, place, ...extra },
});

const csv = featuresToCsv([quake(4.2, "near Hollister"), quake(2.9, "off Eureka")]);
const lines = csv.split("\n");
check("has a header and a row per feature", lines.length === 3, `${lines.length} lines`);
check("coordinates lead, then the properties",
  lines[0] === "lon,lat,magnitude,place", lines[0]);
check("values land in the right columns",
  lines[1] === "-121.5,36.8,4.2,near Hollister", lines[1]);

// A comma inside a value must not split the row — the classic silent corruption.
const commas = featuresToCsv([quake(5, "10km N of Somewhere, CA")]);
check("a comma in a value is quoted",
  commas.split("\n")[1].includes('"10km N of Somewhere, CA"'),
  commas.split("\n")[1]);
const quotes = featuresToCsv([quake(5, 'the "big" one')]);
check("a quote in a value is escaped",
  quotes.split("\n")[1].includes('"the ""big"" one"'), quotes.split("\n")[1]);

// Feeds are not uniform: a key only some features carry must still get a column.
const ragged = featuresToCsv([quake(4, "a"), quake(3, "b", { depth_km: 9 })]);
const raggedLines = ragged.split("\n");
check("the column set is the union of every feature's keys",
  raggedLines[0] === "lon,lat,magnitude,place,depth_km", raggedLines[0]);
check("a feature missing that key gets an empty cell",
  raggedLines[1].endsWith(",a,"), raggedLines[1]);

// A polygon (an NWS alert) still has to be placeable.
const polygon = featuresToCsv([{
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[-120, 35], [-119, 35], [-119, 36]]] },
  properties: { event: "Flood Warning" },
}]);
check("a polygon is reduced to its first vertex",
  polygon.split("\n")[1].startsWith("-120,35,"), polygon.split("\n")[1]);

check("no features is an empty string, not a stray header",
  featuresToCsv([]) === "" && featuresToCsv(null) === "");

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
