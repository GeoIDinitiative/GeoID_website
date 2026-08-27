/**
 * Active fire detections: two tiles, two sensors, one vocabulary.
 *
 * Every failure here is silent. EPSG:4326 is TWO tiles wide at zoom zero, so
 * fetching one returns the western hemisphere and calls it global — a map
 * missing half the world with nothing to say so. MODIS and VIIRS name the same
 * measurements differently (BRIGHTNESS vs BRIGHT_TI4, 0–100 vs l/n/h), so a
 * converter written against one gives the other a column of nulls and a legend
 * that cannot be shared. And a detection on the antimeridian is carried by both
 * tiles, which double-counts it.
 *
 * Run: node GeoID_GIS/viewer/gis/fire-detections.test.mjs
 */

import {
  fireTileUrls, firesToGeoJSON, confidenceBand, fireSensorIds, fireSensor, fireDate,
} from "./research/connectors.js";

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

// ── The sensors ──────────────────────────────────────────────────────────
check("both sensor families are offered",
  fireSensorIds().sort(), ["modis", "viirs-noaa20", "viirs-snpp"]);
check("MODIS is 1 km", fireSensor("modis").resolution, "1 km");
check("VIIRS is 375 m", fireSensor("viirs-snpp").resolution, "375 m");
/* The matrix set is the 4326 endpoint's own, NOT the GoogleMapsCompatible_*
   names the 3857 capabilities list — asking for 1km on a VIIRS layer is a 400. */
check("MODIS asks the 1km matrix set", fireSensor("modis").matrixSet, "1km");
check("VIIRS asks the 500m matrix set", fireSensor("viirs-snpp").matrixSet, "500m");

// ── The two tiles that are the world ─────────────────────────────────────
const urls = fireTileUrls("modis", "2026-08-27");
check("the world is TWO tiles, not one", urls.length, 2);
check("west half is column 0", urls[0].endsWith("/1km/0/0/0.mvt"), true);
check("east half is column 1", urls[1].endsWith("/1km/0/0/1.mvt"), true);
check("asks the 4326 endpoint", urls[0].includes("/wmts/epsg4326/best/"), true);
check("asks for vector tiles", urls[0].endsWith(".mvt"), true);
check("carries the date", urls[0].includes("/2026-08-27/"), true);
check("VIIRS asks its own layer and matrix set",
  fireTileUrls("viirs-snpp", "2026-08-27")[0]
    .includes("VIIRS_SNPP_Thermal_Anomalies_375m_All/default/2026-08-27/500m/"), true);
let threw = false;
try { fireTileUrls("nope"); } catch { threw = true; }
check("an unknown sensor is refused loudly", threw, true);

check("the date is an ISO day", /^\d{4}-\d{2}-\d{2}$/.test(fireDate(new Date("2026-08-27T09:00:00Z"))), true);
check("and it is UTC", fireDate(new Date("2026-08-27T23:30:00Z")), "2026-08-27");

// ── One confidence vocabulary across two sensors ─────────────────────────
/* VIIRS says l/n/h; MODIS says 0–100. Colouring by the raw column gives one
   layer three classes and the other a hundred, and no shared legend. */
check("VIIRS high", confidenceBand("h"), "high");
check("VIIRS nominal", confidenceBand("n"), "nominal");
check("VIIRS low", confidenceBand("l"), "low");
check("MODIS 100 is high", confidenceBand(100), "high");
check("MODIS 80 is high", confidenceBand(80), "high");
check("MODIS 79 is nominal", confidenceBand(79), "nominal");
check("MODIS 30 is nominal", confidenceBand(30), "nominal");
check("MODIS 29 is low", confidenceBand(29), "low");
check("MODIS 0 is low", confidenceBand(0), "low");
check("a missing confidence is not invented", confidenceBand(null), "unknown");
check("nor is a blank one", confidenceBand(""), "unknown");
check("nor is nonsense", confidenceBand("banana"), "unknown");

// ── The converter, per sensor ────────────────────────────────────────────
const modisTile = {
  MODIS_Combined_Thermal_Anomalies_All_v61_NRT: [
    {
      properties: {
        LATITUDE: 68.088, LONGITUDE: 108.45, BRIGHTNESS: 344.64, FRP: 57.41,
        CONFIDENCE: 100, ACQ_DATE: "2026-08-27", ACQ_TIME: "12:19",
        SATELLITE: "T", DAYNIGHT: "D", UID: 4727,
      },
    },
    // Same detection, carried by the OTHER world tile at the seam.
    {
      properties: {
        LATITUDE: 68.088, LONGITUDE: 108.45, BRIGHTNESS: 344.64, FRP: 57.41,
        CONFIDENCE: 100, ACQ_DATE: "2026-08-27", ACQ_TIME: "12:19",
        SATELLITE: "T", DAYNIGHT: "D", UID: 4727,
      },
    },
    { properties: { LATITUDE: "nope", LONGITUDE: 5 } },
  ],
};
const fc = firesToGeoJSON([modisTile], "modis");
check("the seam duplicate is dropped", fc.features.length, 1);
const f = fc.features[0];
check("a detection is a Point", f.geometry.type, "Point");
/* Geometry is rebuilt from the LAT/LON PROPERTIES, not from the tile's own
   projected coordinates — exact, and it sidesteps the 4326 tile transform. */
check("coordinates come from the properties", f.geometry.coordinates, [108.45, 68.088]);
check("brightness is read from MODIS's column", f.properties.brightness_k, 344.64);
check("and named in kelvin", "brightness_k" in f.properties, true);
check("fire radiative power is carried", f.properties.frp_mw, 57.41);
check("confidence is banded", f.properties.confidence, "high");
check("the raw value is kept too", f.properties.confidence_raw, 100);
check("acquisition time is one string", f.properties.acquired, "2026-08-27 12:19");
check("day/night is spelled out", f.properties.daynight, "Day");
check("the sensor family is named", f.properties.sensor, "MODIS");
check("as is its resolution", f.properties.resolution, "1 km");
check("the kicker says what it is", f.properties.kind, "Active fire detection");
/* Ninety-eight thousand names is a white planet, and a thermal anomaly has no
   name to write — but the COLUMN must exist so the card contract still holds. */
check("never labelled", f.properties.label_rank, 0);
check("a detection with no usable latitude is dropped",
  fc.features.some((x) => x.geometry.coordinates[1] === "nope"), false);

const viirsTile = {
  VIIRS_SNPP_Thermal_Anomalies_375m_All: [{
    properties: {
      LATITUDE: -3.1, LONGITUDE: 22.4, BRIGHT_TI4: 331.2, FRP: 12.8,
      CONFIDENCE: "n", ACQ_DATE: "2026-08-27", ACQ_TIME: "01:05",
      SATELLITE: "N", DAYNIGHT: "N", UID: 91,
    },
  }],
};
const vfc = firesToGeoJSON([viirsTile], "viirs-snpp");
const v = vfc.features[0];
/* The whole reason `brightnessKey` exists: read BRIGHTNESS off a VIIRS
   detection and every value is null under a correct-looking legend. */
check("VIIRS brightness is read from ITS column", v.properties.brightness_k, 331.2);
check("VIIRS confidence bands the same way", v.properties.confidence, "nominal");
check("VIIRS is named as VIIRS", v.properties.sensor, "VIIRS");
check("at its own resolution", v.properties.resolution, "375 m");
check("night is spelled out", v.properties.daynight, "Night");

// Two tiles of DIFFERENT detections both survive.
const both = firesToGeoJSON([modisTile, {
  x: [{ properties: { LATITUDE: 1, LONGITUDE: 2, BRIGHTNESS: 300, CONFIDENCE: 50, UID: 9 } }],
}], "modis");
check("both hemispheres are kept", both.features.length, 2);

check("no tiles is an empty collection", firesToGeoJSON([], "modis").features.length, 0);
check("a null payload does not throw", firesToGeoJSON(null, "modis").features.length, 0);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
