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

import {
  usgsToGeoJSON, eonetToGeoJSON, studyBbox,
  nwsToGeoJSON, usgsWaterToGeoJSON, overpassToGeoJSON,
} from "./connectors.js";

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

// ── NWS: already GeoJSON, drop alerts with no geometry ────────────────────────
const nws = nwsToGeoJSON({
  features: [
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-90, 30], [-89, 30], [-89, 31], [-90, 30]]] },
      properties: { event: "Flood Warning", severity: "Severe", areaDesc: "Somewhere County", headline: "H" } },
    { type: "Feature", geometry: null, properties: { event: "Zone-only alert" } },  // dropped
  ],
});
check("nws drops geometry-less alerts", nws.features.length === 1, `${nws.features.length} kept`);
check("nws carries event and severity",
  nws.features[0].properties.event === "Flood Warning"
  && nws.features[0].properties.severity === "Severe");

// ── USGS Water: timeSeries → gauge points with latest discharge ───────────────
const water = usgsWaterToGeoJSON({
  value: { timeSeries: [
    {
      sourceInfo: { siteName: "Creek nr Town", siteCode: [{ value: "01234567" }],
        geoLocation: { geogLocation: { latitude: "38.5", longitude: "-121.4" } } },
      values: [{ value: [{ value: "12.0", dateTime: "2026-08-09T00:00" }, { value: "13.5", dateTime: "2026-08-09T00:15" }] }],
    },
    { sourceInfo: { geoLocation: {} }, values: [] },   // no coords → dropped
  ] },
});
check("usgs-water drops sites with no coordinates", water.features.length === 1,
  `${water.features.length} kept`);
check("usgs-water takes the latest reading",
  water.features[0].properties.discharge_cfs === 13.5);
check("usgs-water keeps [lon,lat] and the site id",
  water.features[0].geometry.coordinates[0] === -121.4
  && water.features[0].properties.site === "01234567");

// ── Overpass: nodes → place points ────────────────────────────────────────────
const osm = overpassToGeoJSON({
  elements: [
    { type: "node", lat: 37.5, lon: 15.0, tags: { name: "Catania", place: "city", population: "311000" } },
    { type: "way", id: 9 },   // not a node → dropped
  ],
});
check("overpass keeps only located nodes", osm.features.length === 1, `${osm.features.length} kept`);
check("overpass parses population to a number",
  osm.features[0].properties.population === 311000
  && osm.features[0].properties.name === "Catania");
check("overpass keeps [lon,lat] order",
  osm.features[0].geometry.coordinates[0] === 15.0
  && osm.features[0].geometry.coordinates[1] === 37.5);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
