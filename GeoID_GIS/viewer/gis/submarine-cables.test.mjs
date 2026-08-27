/**
 * Submarine cables and their landing stations, and where a line's name goes.
 *
 * The failures here are silent ones. A stated distance of zero read as a
 * length gives a cable of length nought and a rank to match. A LINE handed to
 * the label engine's point path reads `coordinates[1]` as a latitude when it
 * is a POSITION ARRAY — every label at NaN, no error anywhere. And a landing
 * station ranked level with a cable buries the cable names under a chip at
 * every landfall.
 *
 * Run: node GeoID_GIS/viewer/gis/submarine-cables.test.mjs
 */

import {
  submarineCablesUrl, submarineCablesToGeoJSON,
  cableLandingsUrl, cableLandingsToGeoJSON,
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

// ── The query ────────────────────────────────────────────────────────────
/* Greg's Cable Map through an ArcGIS FeatureServer, not submarinecablemap.com:
   TeleGeography sends no CORS header (so a browser cannot read it at all) and
   licenses the geocoded data annually. This one is GPL and answers CORS *. */
const url = submarineCablesUrl();
check("asks the cable FeatureServer", url.includes("Global_Submarine_Cable_Map/FeatureServer/1/query"), true);
check("asks for GeoJSON directly", url.includes("f=geojson"), true);
check("pins WGS84", url.includes("outSR=4326"), true);
check("asks for every attribute", url.includes("outFields=*"), true);
check("the landings are the OTHER layer of the same service",
  cableLandingsUrl().includes("FeatureServer/0/query"), true);

// ── Cables ───────────────────────────────────────────────────────────────
const cablePayload = {
  features: [
    {
      properties: {
        Name: "SEACOM", Capacity_G: 1280, Distance_K: 15000, InService: 2009,
        NotLive: 0, URL1: "http://www.seacom.mu/", URL2: "http://en.wikipedia.org/wiki/SEACOM",
        Notes: " ",
      },
      geometry: { type: "MultiLineString", coordinates: [[[30, -30], [40, -20]], [[40, -20], [50, 0]]] },
    },
    {
      properties: { Name: "Short hop", Distance_K: 0, NotLive: 1, InService: 2020 },
      geometry: { type: "LineString", coordinates: [[10, 50], [10.5, 50.2]] },
    },
    { properties: { Name: "no geometry" }, geometry: null },
  ],
};
const fc = submarineCablesToGeoJSON(cablePayload);
const byName = new Map(fc.features.map((f) => [f.properties.name, f]));

check("a feature per cable", fc.features.length, 2);
check("a cable with no geometry is dropped", byName.has("no geometry"), false);
check("a LineString is normalised to MultiLineString",
  byName.get("Short hop").geometry.type, "MultiLineString");

const seacom = byName.get("SEACOM");
/* The SURVEY's own distance wins over the drawn polyline's: that is the
   operator's figure for the cable, where the geometry is a generalisation. */
check("the stated distance is preferred", seacom.properties.length_km, 15000);
check("and it ranks top", seacom.properties.label_rank, 5);
check("capacity is carried", seacom.properties.capacity_gbps, 1280);
check("as is the service year", seacom.properties.in_service, 2009);
check("links are carried for the card", seacom.properties.wikipedia.includes("wikipedia"), true);
check("blank notes do not become whitespace", seacom.properties.notes, "");
check("the kicker names what it is", seacom.properties.kind, "Submarine cable");

/* A zero/absent Distance_K must fall back to measuring the line, not record a
   cable of length nought. */
const hop = byName.get("Short hop");
check("a missing distance is measured from the geometry", hop.properties.length_km > 0, true);
check("a short cable ranks low", hop.properties.label_rank, 1);
/* NotLive is carried, never filtered: a retired or planned cable is a true
   fact about the seabed and the card should say which. */
check("a dead cable is kept", Boolean(hop), true);
check("and says so", hop.properties.status, "Not in service");
check("a live one says so too", seacom.properties.status, "In service");

// ── Landing stations ─────────────────────────────────────────────────────
const landings = cableLandingsToGeoJSON({
  features: [
    { properties: { Name: "Mombasa", Country: "Kenya", Owner: "SEACOM", ExactLocat: "1" },
      geometry: { type: "Point", coordinates: [39.66, -4.05] } },
    { properties: { Name: "broken" }, geometry: { type: "Point", coordinates: [null, 5] } },
  ],
});
check("a landing station becomes a point", landings.features.length, 1);
check("it keeps its country", landings.features[0].properties.country, "Kenya");
check("and its owner", landings.features[0].properties.owner, "SEACOM");
check("its kicker is its own", landings.features[0].properties.kind, "Cable landing station");
/* Ranked BELOW the cables: with both layers on, a name at every landfall
   would bury the cable names, and the cable is what the map is about. */
check("a landing ranks below a cable", landings.features[0].properties.label_rank, 1);
check("a point with no usable coordinates is dropped",
  landings.features.some((f) => f.properties.name === "broken"), false);

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
const item = featureToItem(seacom);
check("a cable becomes a label item", Boolean(item), true);
check("its latitude is a number", Number.isFinite(item.lat), true);
check("its longitude is a number", Number.isFinite(item.lon), true);
check("it is named for the system", item.name, "SEACOM");
check("and the card kicker says what it is", item.type, "Submarine cable");

// A feature with no name must not produce a label item at all.
check("a nameless feature yields no label",
  featureToItem({ properties: { label_rank: 3 }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }), null);

// ── Nothing in, nothing out ──────────────────────────────────────────────
check("an empty payload is an empty collection",
  submarineCablesToGeoJSON({ features: [] }).features.length, 0);
check("a missing payload does not throw",
  submarineCablesToGeoJSON(null).features.length, 0);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
