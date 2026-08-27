/**
 * Submarine cables: the grouping, the ranking, and where a line's name goes.
 *
 * Two things here fail silently. Ungrouped, a system mapped as several ways
 * writes its name on the map once per way and counts one cable as three —
 * measured on the real feed, 656 ways for 199 names, MAYA-1 alone appearing
 * three times. And a LINE handed to the label engine's point path reads
 * `coordinates[1]` as a latitude when it is a POSITION ARRAY, which puts every
 * label at NaN with no error anywhere.
 *
 * Run: node GeoID_GIS/viewer/gis/submarine-cables.test.mjs
 */

import {
  submarineCablesUrl, submarineCablesToGeoJSON,
} from "./research/connectors.js";
import { labelAnchor, featureToItem } from "./point-labels.js";

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

const way = (name, coords, tags = {}) => ({
  type: "way",
  tags: { communication: "line", submarine: "yes", ...(name ? { name } : {}), ...tags },
  geometry: coords.map(([lon, lat]) => ({ lon, lat })),
});

// ── The query ────────────────────────────────────────────────────────────
const url = submarineCablesUrl();
check("asks Overpass", url.startsWith("https://overpass-api.de/api/interpreter?data="), true);
const query = decodeURIComponent(url.split("data=")[1]);
check("asks for submarine communication lines",
  query.includes('["communication"="line"]') && query.includes('["submarine"="yes"]'), true);
check("asks for the geometry, not just ids", query.includes("out geom"), true);
/* Global on purpose: a cable is thousands of km long and clipping it to a
   study area cuts the very thing that makes it legible. No bbox in the query. */
check("is not clipped to a bounding box", /\(\s*-?\d/.test(query), false);

// ── Grouping ─────────────────────────────────────────────────────────────
const payload = {
  elements: [
    way("MAYA-1", [[-90, 20], [-85, 19], [-80, 18]], { operator: "Telxius" }),
    way("MAYA-1", [[-80, 18], [-79, 15]]),
    way("MAYA-1", [[-79, 15], [-78, 10]]),
    way("Seabras-1", [[-74, 40], [-40, 10], [-43, -23]]),
    way(null, [[10, 55], [11, 56]]),
    way("too-short", [[1, 1]]),
  ],
};
const fc = submarineCablesToGeoJSON(payload);
const byName = new Map(fc.features.map((f) => [f.properties.name, f]));

check("one feature per SYSTEM, not per way", fc.features.length, 3);
check("MAYA-1's three ways became one feature", byName.has("MAYA-1"), true);
check("and it kept all three as parts", byName.get("MAYA-1").properties.segments, 3);
check("grouped geometry is a MultiLineString",
  byName.get("MAYA-1").geometry.type, "MultiLineString");
check("the operator rides along", byName.get("MAYA-1").properties.operator, "Telxius");
check("a way with one node cannot be a line", byName.has("too-short"), false);

/* An unnamed way is real cable on the seabed — kept, so the map is not a lie
   about where cables run, but at rank 0 so it never competes for a name. */
const anon = fc.features.filter((f) => !f.properties.name);
check("an unnamed way is still drawn", anon.length, 1);
check("but never labelled", anon[0].properties.label_rank, 0);
check("an unnamed way stays a plain LineString", anon[0].geometry.type, "LineString");

// ── Rank is LENGTH, which the geometry itself supports ───────────────────
const seabras = byName.get("Seabras-1");
check("a transoceanic cable measures thousands of km",
  seabras.properties.length_km > 5000, true);
check("and ranks top", seabras.properties.label_rank, 5);
const maya = byName.get("MAYA-1");
check("a shorter system ranks lower", maya.properties.label_rank < 5, true);
check("every named system carries a length", Number.isFinite(maya.properties.length_km), true);
check("the kicker names what it is", maya.properties.kind, "Submarine cable");

// ── The label anchor ─────────────────────────────────────────────────────
check("a point anchors to itself",
  labelAnchor({ type: "Point", coordinates: [5, 50] }), [5, 50]);
/* The MIDDLE vertex, not an end: a name at a line's end reads as belonging to
   whatever else is at that coast. */
check("a line anchors to its middle vertex",
  labelAnchor({ type: "LineString", coordinates: [[0, 0], [10, 10], [20, 20]] }), [10, 10]);
/* The LONGEST part, because a system is often mapped as a trunk plus a stub
   and the stub must not claim the name. */
check("a multi-line anchors in its longest part",
  labelAnchor({
    type: "MultiLineString",
    coordinates: [[[0, 0], [1, 1]], [[10, 10], [11, 11], [12, 12], [13, 13], [14, 14]]],
  }), [12, 12]);
check("nonsense geometry has no anchor", labelAnchor({ type: "Polygon", coordinates: [] }), null);
check("a missing geometry has no anchor", labelAnchor(null), null);

/* The whole point of the anchor: a cable must reach the label engine with
   NUMBERS for lat/lon. Before it, `coordinates[1]` on a line was a position
   array and every label landed at NaN. */
const item = featureToItem(seabras);
check("a cable becomes a label item", Boolean(item), true);
check("its latitude is a number", Number.isFinite(item.lat), true);
check("its longitude is a number", Number.isFinite(item.lon), true);
check("it is named for the system", item.name, "Seabras-1");
check("and the card kicker says what it is", item.type, "Submarine cable");

// An unnamed cable must not produce a label item at all.
check("an unnamed cable yields no label", featureToItem(anon[0]), null);

// ── Nothing in, nothing out ──────────────────────────────────────────────
check("an empty payload is an empty collection",
  submarineCablesToGeoJSON({ elements: [] }).features.length, 0);
check("a missing payload does not throw",
  submarineCablesToGeoJSON(null).features.length, 0);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
