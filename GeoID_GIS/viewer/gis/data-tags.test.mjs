#!/usr/bin/env node
/**
 * The data-type classifier: every input filed AS IT ARRIVES, from what the
 * layer already says about itself. Every failure here is a wrong chip worn
 * silently — a GEE rainfall pull filed as "Other" tells the Model Builder
 * nothing, and worse, tells it confidently.
 *
 * Run: node GeoID_GIS/viewer/gis/data-tags.test.mjs
 */

import { inferType, DATA_TYPES } from "./data-tags.js";

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${got}, want ${want}`}`);
  if (!ok) failures += 1;
};

// What a thing IS outranks what its file was.
check("a drawn ring is a study area, whatever its ext",
  inferType({ ext: "drawn", name: "Study area 1" }), "study-area");
check("a drawn_at property alone is enough",
  inferType({ ext: "geojson", drawnAt: "2026-08-27" }), "study-area");
check("a tile drape is a basemap", inferType({ ext: "tiles", name: "OpenStreetMap" }), "basemap");

// GEE pulls file by their own catalogue home.
check("a GEE pull files by its home",
  inferType({ ext: "gee", geeHome: "atmosphere", name: "CHIRPS" }), "atmospheric");
check("a GEE hazard product is a hazard",
  inferType({ ext: "gee", geeHome: "geohazards", name: "Burned area" }), "hazard");
check("a homeless GEE pull is Earth observation",
  inferType({ ext: "gee", name: "Sentinel-2 SR" }), "observation");

// The live layers.
check("the satellite tracker is Earth observation",
  inferType({ name: "Live satellites (CelesTrak)" }), "observation");
check("the events feed is hazard", inferType({ name: "Live events" }), "hazard");

// Names beat extensions for subjects…
check("a fire perimeter shapefile is a hazard, not a shapefile",
  inferType({ ext: "shp", name: "WFIGS fire perimeters" }), "hazard");
check("a rivers geojson is hydrology",
  inferType({ ext: "geojson", name: "NI rivers (OpenStreetMap)" }), "hydrology");
check("a bedrock layer is geology",
  inferType({ ext: "geojson", name: "BGS bedrock 625k" }), "geology");
check("a temperature field is atmospheric",
  inferType({ ext: "geojson", name: "2 m temperature" }), "atmospheric");

// …and extensions decide the rest.
check("an anonymous .shp is a shapefile", inferType({ ext: "shp", name: "parcels" }), "shapefile");
check("an anonymous .geojson is a vector", inferType({ ext: "geojson", name: "sites" }), "vector");
check("a GeoTIFF is a raster", inferType({ ext: "tif", name: "dem_patch" }), "raster");
check("a raster flag counts without an extension",
  inferType({ name: "imported grid", raster: true }), "raster");
check("nothing known is Other, honestly", inferType({ ext: "", name: "" }), "other");

// The registry is closed: every inferred id must be a real type.
{
  const cases = [
    { ext: "drawn" }, { ext: "tiles" }, { ext: "gee" }, { ext: "shp" },
    { ext: "tif" }, { ext: "geojson" }, { name: "Live events" }, {},
  ];
  const allValid = cases.every((c) => DATA_TYPES[inferType(c)]);
  check("every guess names a registered type", allValid, true);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
