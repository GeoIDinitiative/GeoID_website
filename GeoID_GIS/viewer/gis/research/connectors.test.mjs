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
  bgsGeologyToGeoJSON, metRainfallToGeoJSON, CONNECTORS,
  boxSpanDeg, overpassRoadsQuery, overpassRoadsToGeoJSON, ROAD_TIERS,
  assembleRings, relationPolygon, placeNameKey, overpassOutlinesQuery,
  overpassOutlinesToGeoJSON, OUTLINE_MAX_SPAN,
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

// ── BGS geology 625k: URL building against the OGC API ────────────────────────
// The bbox is lon,lat order and falls back to the NI prototype's extent — a
// swapped axis order or a global default would pull the wrong country silently.
const bedrockUrl = CONNECTORS["bgs-geology-bedrock"].url({});
const bedrockParams = new URL(bedrockUrl).searchParams;
check("bgs bedrock hits its own collection",
  bedrockUrl.includes("/collections/bgsgeology625kbedrock/items"));
check("bgs superficial hits its own collection",
  CONNECTORS["bgs-geology-superficial"].url({})
    .includes("/collections/bgsgeology625ksuperficial/items"));
check("bgs falls back to the NI bbox with no study area",
  bedrockParams.get("bbox") === "-8.2,54.0,-5.4,55.4");
check("bgs asks for one full GeoJSON page by default",
  bedrockParams.get("limit") === "1000" && bedrockParams.get("f") === "json");
const bedrockScoped = new URL(CONNECTORS["bgs-geology-bedrock"].url({
  bbox: { minLat: 54.4, maxLat: 54.6, minLon: -6.4, maxLon: -6.1 }, limit: 50,
})).searchParams;
check("bgs takes a study bbox in lon,lat order and honours the limit",
  bedrockScoped.get("bbox") === "-6.4,54.4,-6.1,54.6"
  && bedrockScoped.get("limit") === "50");

// ── Met Office rainfall normals: the verified ArcGIS parameter set ───────────
// The exact set that returned 112 NI cells live (2026-08-15); a missing
// spatialRel or a wrong inSR degrades to zero features, not to an error.
const metParams = new URL(CONNECTORS["met-rainfall-normals"].url({})).searchParams;
check("met rainfall carries the verified ArcGIS parameter set",
  metParams.get("where") === "1=1"
  && metParams.get("geometryType") === "esriGeometryEnvelope"
  && metParams.get("inSR") === "4326"
  && metParams.get("spatialRel") === "esriSpatialRelIntersects"
  && metParams.get("outFields") === "*"
  && metParams.get("f") === "geojson");
check("met rainfall falls back to the NI bbox as its envelope",
  metParams.get("geometry") === "-8.2,54.0,-5.4,55.4");

// ── BGS/Met passthrough: already GeoJSON, but assert before trusting ─────────
// A service error page is JSON too (ArcGIS even returns errors as HTTP 200),
// so the passthrough must reject anything that is not a FeatureCollection
// rather than filing an error object into the project as a layer.
const geologyPayload = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", id: 13,
      properties: { lex: "HGUW", lex_d: "HIBERNIAN GREENSANDS FORMATION" },
      geometry: { type: "Polygon",
        coordinates: [[[-6.5, 54.5], [-6.4, 54.5], [-6.4, 54.6], [-6.5, 54.5]]] } },
  ],
};
const geology = bgsGeologyToGeoJSON(geologyPayload);
check("bgs passthrough keeps every feature and its geometry",
  geology.features.length === 1
  && geology.features[0].geometry.coordinates[0][0][0] === -6.5);
check("bgs passthrough keeps the source properties",
  geology.features[0].properties.lex === "HGUW");
check("bgs passthrough stamps the UKRI attribution on each feature",
  geology.features[0].properties.attribution
  === `Contains British Geological Survey materials © UKRI ${new Date().getFullYear()}`);
check("bgs passthrough does not mutate the source payload",
  geologyPayload.features[0].properties.attribution === undefined);
let bgsRejected = false;
try { bgsGeologyToGeoJSON({ error: { code: 400, message: "Invalid query" } }); }
catch { bgsRejected = true; }
check("bgs passthrough rejects a non-GeoJSON payload", bgsRejected);

const rain = metRainfallToGeoJSON({
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { GRID_ID: "V-64", pr: 1087.47 },
      geometry: { type: "Polygon",
        coordinates: [[[-6.2, 54.4], [-6.0, 54.4], [-6.0, 54.5], [-6.2, 54.4]]] } },
  ],
});
check("met passthrough keeps the pr field (mm/yr)",
  rain.features[0].properties.pr === 1087.47);
check("met passthrough stamps the OGL attribution",
  rain.features[0].properties.attribution
  === "Contains Met Office data licensed under the Open Government Licence v3.0; HadUK-Grid © Crown copyright");
let metRejected = false;
try { metRainfallToGeoJSON({ features: [] }); }   // no type → not a FeatureCollection
catch { metRejected = true; }
check("met passthrough rejects a payload without the FeatureCollection type", metRejected);

// ── Filename slugs: stable names, since data/pulled/<slug>/ paths key on them ─
check("new connector filenames are stable slugs",
  CONNECTORS["bgs-geology-bedrock"].filename({}) === "bgs_geology_625k_bedrock.geojson"
  && CONNECTORS["bgs-geology-superficial"].filename({}) === "bgs_geology_625k_superficial.geojson"
  && CONNECTORS["met-rainfall-normals"].filename({}) === "rainfall_normals_haduk_12km.geojson");

// ── OSM roads: the tier follows the box, the geometry is [lon, lat] ───────────
const box = (w, s2, e, n) => ({ minLon: w, minLat: s2, maxLon: e, maxLat: n });
check("box span shrinks longitude by cos(latitude)",
  Math.abs(boxSpanDeg(box(0, 59.9, 2, 60.1)) - 2 * Math.cos(60 * Math.PI / 180)) < 1e-3);
const fine = overpassRoadsQuery(box(-3.25, 55.9, -3.15, 55.97));
check("a street-scale box asks for every street", fine.tier.classes.includes("residential"),
  fine.tier.says);
check("the query names the box south, west, north, east",
  fine.query.includes("(55.9,-3.25,55.97,-3.15)"));
check("_link roads ride with their class", fine.query.includes("(_link)?$"));
const regional = overpassRoadsQuery(box(-4, 55.5, -2.5, 56.5));
check("a regional box stops at secondary roads",
  regional.tier.classes.includes("secondary") && !regional.tier.classes.includes("tertiary"));
const national = overpassRoadsQuery(box(-6, 52, 0, 56));
check("a national box asks for the main network only",
  national.tier.classes.join() === "motorway,trunk,primary");
let tooBig = "";
try { overpassRoadsQuery(box(-20, 30, 20, 60)); } catch (e) { tooBig = e.message; }
check("a continent is refused, and the refusal names the way round it",
  /too large/.test(tooBig) && /Natural Earth/.test(tooBig), tooBig);
let noBox = "";
try { overpassRoadsQuery(null); } catch (e) { noBox = e.message; }
check("no area is refused in words", /draw one/.test(noBox));
check("the tiers run from finest to coarsest",
  ROAD_TIERS.every((t, i) => i === 0 || t.maxSpan > ROAD_TIERS[i - 1].maxSpan));

const roads = overpassRoadsToGeoJSON({ elements: [
  { type: "way", id: 7, tags: { highway: "primary_link", name: "A1", ref: "A1", lanes: "2",
    bridge: "yes" }, geometry: [{ lat: 55.95, lon: -3.2 }, { lat: 55.96, lon: -3.19 }] },
  { type: "way", id: 8, tags: { highway: "motorway", lanes: "" },
    geometry: [{ lat: 55.9, lon: -3.3 }] },
  { type: "node", id: 9, lat: 55, lon: -3, tags: { highway: "traffic_signals" } },
] });
check("roads keep ways with a line and drop the rest", roads.features.length === 1);
const road = roads.features[0];
check("road geometry is [lon, lat]", road.geometry.coordinates[0][0] === -3.2
  && road.geometry.coordinates[0][1] === 55.95);
check("a _link is filed under its class and flagged",
  road.properties.class === "primary" && road.properties.link === true
  && road.properties.rank === 3);
check("lanes is a number; a bridge is a boolean",
  road.properties.lanes === 2 && road.properties.bridge === true);
check("the road keeps its OSM id", road.properties.osm_id === "way/7");

// ── Settlement outlines: rings joined, the place's own boundary chosen ────────
const sq = (x0, y0, d) => [[x0, y0], [x0 + d, y0], [x0 + d, y0 + d], [x0, y0 + d], [x0, y0]];
const joined = assembleRings([
  [[1, 0], [1, 1]],                 // east side
  [[0, 0], [1, 0]],                 // south side
  [[0, 0], [0, 1], [1, 1]].reverse(), // west + north, backwards
]);
check("pieces in any order and direction join into one closed ring",
  joined.rings.length === 1 && joined.open === 0 && joined.rings[0].length === 5,
  JSON.stringify(joined));
const broken = assembleRings([[[0, 0], [1, 0]], [[1, 0], [1, 1]]]);
check("a ring that cannot close is counted, not drawn",
  broken.rings.length === 0 && broken.open === 1);

const asMembers = (ring, role = "outer") => ({ type: "way", role,
  geometry: ring.map(([lon, lat]) => ({ lat, lon })) });
const holed = relationPolygon({ members: [asMembers(sq(0, 0, 4)), asMembers(sq(1, 1, 1), "inner")] });
check("an inner ring becomes a hole in its outer",
  holed.geometry.type === "Polygon" && holed.geometry.coordinates.length === 2);
const twoPart = relationPolygon({ members: [asMembers(sq(0, 0, 1)), asMembers(sq(5, 5, 1))] });
check("two outer rings are a MultiPolygon", twoPart.geometry.type === "MultiPolygon"
  && twoPart.geometry.coordinates.length === 2);

check("'City of Edinburgh' compares as 'edinburgh'",
  placeNameKey("City of Edinburgh") === "edinburgh");
check("'Landeshauptstadt München' compares as 'munchen'",
  placeNameKey("Landeshauptstadt München") === placeNameKey("München"));
check("a name in another script survives", placeNameKey("札幌市") === "札幌市");

const rel = (id, name, level, ring, extra = {}) => ({ type: "relation", id,
  tags: { boundary: "administrative", admin_level: String(level), name, ...extra },
  members: [asMembers(ring)] });
const outlines = overpassOutlinesToGeoJSON({ elements: [
  { type: "node", id: 1, lat: 0.5, lon: 0.5, tags: { place: "city", name: "Edinburgh",
    population: "506520" } },
  { type: "node", id: 2, lat: 3.5, lon: 3.5, tags: { place: "town", name: "Nowhere" } },
  rel(10, "Lothian", 6, sq(-1, -1, 6)),
  rel(11, "City of Edinburgh", 8, sq(0, 0, 1)),
  rel(12, "Edinburgh", 10, sq(0.4, 0.4, 0.2)), // a ward that does not contain the node
  { type: "way", id: 20, tags: { place: "village", name: "Cramond" },
    geometry: sq(4, 0, 0.1).map(([lon, lat]) => ({ lat, lon })) },
] });
const edinburgh = outlines.features.find((f) => f.properties.name === "Edinburgh");
check("a city takes the boundary that contains it AND carries its name",
  edinburgh?.properties.osm_id === "relation/11" && edinburgh.properties.admin_level === 8,
  JSON.stringify(edinburgh?.properties));
check("a town with no boundary of its own name gets none (not the county's)",
  outlines.unmatched === 1 && !outlines.features.some((f) => f.properties.name === "Nowhere"));
check("a settlement mapped as an area stands on its own",
  outlines.features.some((f) => f.properties.name === "Cramond"
    && /own area/.test(f.properties.outline)));
check("the county is never drawn", !outlines.features.some((f) => f.properties.osm_id === "relation/10"));
const preferArea = overpassOutlinesToGeoJSON({ elements: [
  { type: "node", id: 1, lat: 0.5, lon: 0.5, tags: { place: "town", name: "Ayr" } },
  rel(30, "Ayr", 8, sq(0, 0, 1)),
  { type: "way", id: 31, tags: { place: "town", name: "Ayr" },
    geometry: sq(0.2, 0.2, 0.6).map(([lon, lat]) => ({ lat, lon })) },
] });
check("an area mapped AS the place outranks an admin boundary of the same name",
  preferArea.features.length === 1 && preferArea.features[0].properties.osm_id === "way/31");
let outlineBig = "";
try { overpassOutlinesQuery(box(-10, 50, 0, 58)); } catch (e) { outlineBig = e.message; }
check("outlines refuse a box wider than their limit", outlineBig.includes(`${OUTLINE_MAX_SPAN}°`));
check("the outline query starts from the places and asks which boundaries contain them",
  /is_in/.test(overpassOutlinesQuery(box(-3.3, 55.9, -3.1, 56)).query));
check("the OSM connectors have stable filenames",
  CONNECTORS["osm-roads"].filename({}) === "osm_roads.geojson"
  && CONNECTORS["osm-city-outlines"].filename({}) === "osm_city_outlines.geojson");

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
