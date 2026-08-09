/**
 * Connector converters against recorded payloads.
 *
 * The fetch is impure and the network is not here, but the shape conversion is
 * where the bugs live — a moved field, a [lat,lon] vs [lon,lat] swap, an event
 * with a polygon where a point was assumed. These check the converters against
 * payloads shaped exactly like the real services return, so a change to a
 * connector that breaks its output fails here rather than in the browser.
 *
 *   node GeoID_GIS/viewer/gis/research/connectors.test.mjs
 */

import { usgsToGeoJSON, eonetToGeoJSON, studyBbox } from "./connectors.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// ── USGS: already GeoJSON, slimmed ────────────────────────────────────────────
const usgsPayload = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { mag: 4.2, place: "10km N of Somewhere", time: 1786200000000,
        title: "M 4.2 - 10km N of Somewhere", url: "https://earthquake.usgs.gov/x" },
      geometry: { type: "Point", coordinates: [15.0, 37.5, 8.3] },
    },
    { type: "Feature", properties: { mag: 1.1 }, geometry: null },  // no geometry → dropped
  ],
};
const usgs = usgsToGeoJSON(usgsPayload);
check("usgs drops features with no geometry", usgs.features.length === 1,
  `${usgs.features.length} kept`);
check("usgs keeps [lon,lat] order", usgs.features[0].geometry.coordinates[0] === 15.0
  && usgs.features[0].geometry.coordinates[1] === 37.5);
check("usgs carries magnitude and depth", usgs.features[0].properties.magnitude === 4.2
  && usgs.features[0].properties.depth_km === 8.3);
check("usgs normalises time to ISO",
  usgs.features[0].properties.time === new Date(1786200000000).toISOString());

// ── EONET: events with dated geometries → latest point per event ──────────────
const eonetPayload = {
  events: [
    {
      id: "EONET_1", title: "Volcano A",
      categories: [{ title: "Volcanoes" }],
      sources: [{ url: "https://x/1" }],
      geometry: [
        { date: "2026-07-01T00:00:00Z", type: "Point", coordinates: [14.9, 37.7] },
        { date: "2026-08-01T00:00:00Z", type: "Point", coordinates: [15.0, 37.75] },
      ],
    },
    {
      id: "EONET_2", title: "Fire B",
      categories: [{ title: "Wildfires" }],
      geometry: [
        { date: "2026-08-02T00:00:00Z", type: "Polygon",
          coordinates: [[[10.0, 40.0], [10.1, 40.0], [10.1, 40.1], [10.0, 40.0]]] },
      ],
    },
    { id: "EONET_3", title: "No geometry", geometry: [] },  // dropped
  ],
};
const eonet = eonetToGeoJSON(eonetPayload);
check("eonet drops events with no geometry", eonet.features.length === 2,
  `${eonet.features.length} kept`);
check("eonet takes the most recent point of a track",
  eonet.features[0].geometry.coordinates[0] === 15.0
  && eonet.features[0].geometry.coordinates[1] === 37.75);
check("eonet reduces a polygon to a placeable point",
  eonet.features[1].geometry.type === "Point"
  && eonet.features[1].geometry.coordinates[0] === 10.0);
check("eonet carries category and title",
  eonet.features[0].properties.category === "Volcanoes"
  && eonet.features[1].properties.title === "Fire B");

// ── studyBbox: the signed extent, or null for the zero default ────────────────
check("studyBbox reads a real extent",
  JSON.stringify(studyBbox({ min_lat: 37, max_lat: 39, min_lon: 12, max_lon: 15 }))
  === JSON.stringify({ minLat: 37, maxLat: 39, minLon: 12, maxLon: 15 }));
check("studyBbox rejects the zero default",
  studyBbox({ min_lat: 0, max_lat: 0, min_lon: 0, max_lon: 0 }) === null);
check("studyBbox rejects empty strings",
  studyBbox({ min_lat: "", max_lat: "", min_lon: "", max_lon: "" }) === null);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
