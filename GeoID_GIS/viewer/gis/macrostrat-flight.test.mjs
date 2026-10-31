/**
 * Earth Flight: tiled layers follow the aircraft, at a zoom fit for low flight.
 * Run: node GeoID_GIS/viewer/gis/macrostrat-flight.test.mjs
 */
import { flightBounds, zoomForBounds } from "./macrostrat.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failed += 1;
};

const lakes = { lat: 54.45, lon: -3.25 };
const low = flightBounds(lakes, 300);
check("centred on the aircraft", Math.abs((low.west + low.east) / 2 - lakes.lon) < 1e-9
  && Math.abs((low.south + low.north) / 2 - lakes.lat) < 1e-9);
check("24 km each way low down", Math.abs((low.north - low.south) * 111.32 - 48) < 0.01, JSON.stringify(low));
check("wider in longitude by the latitude's cosine", (low.east - low.west) > (low.north - low.south) * 1.6);
check("low flight is zoom 10, not the camera's zoom 7", zoomForBounds(low) === 10, String(zoomForBounds(low)));
const iceland = flightBounds({ lat: 64.3, lon: -16 }, 300);
check("zoom 10 fits the tile cap in Iceland too", zoomForBounds(iceland) === 10, String(zoomForBounds(iceland)));
check("widens with height", flightBounds(lakes, 10000).north - flightBounds(lakes, 10000).south > (low.north - low.south) * 3);
check("and stops at 250 km", Math.abs((flightBounds(lakes, 400000).north - lakes.lat) * 111.32 - 250) < 0.01);
const edge = flightBounds({ lat: 84.9, lon: 179.9 }, 300);
check("stays on the map at the edges", edge.north <= 85 && edge.east <= 180);

process.exit(failed ? 1 : 0);
