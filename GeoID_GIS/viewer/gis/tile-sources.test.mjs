/**
 * The tile registry, and the credits that make it legal to draw.
 *
 * Every service in this list is free to use *on condition* — attribution for
 * all of them, and for some a limit on who may use it for what. Those
 * conditions live in plain strings that nothing else reads, which makes them
 * exactly the kind of thing that rots: a source added without a credit, or a
 * `maxZoom` copied from what a server will answer rather than what its sensor
 * saw, breaks nothing visible and is wrong the moment somebody exports a
 * figure.
 *
 * So this pins the discipline rather than the values: every source is
 * attributed, every constrained source explains its constraint, and the two
 * derived maps stay in step with the registry both consumers read.
 *
 * Run: node GeoID_GIS/viewer/gis/tile-sources.test.mjs
 */

import {
  TILE_SOURCES, BASEMAPS, ATTRIBUTION, DEFAULT_SOURCE, GIBS_DATE, tileUrl,
} from "./tile-sources.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const names = Object.keys(TILE_SOURCES);
check("the registry is not empty", names.length > 0, `${names.length} sources`);

for (const [name, source] of Object.entries(TILE_SOURCES)) {
  // A credit is the condition of use, not decoration — an exported figure
  // carries it into print.
  check(`${name} is attributed`,
    typeof source.credit === "string" && source.credit.trim().length > 0);
  // Every template must be fillable, and `tileUrl` only substitutes these three.
  for (const token of ["{z}", "{x}", "{y}"]) {
    check(`${name}'s template carries ${token}`, source.url.includes(token));
  }
  check(`${name} declares a maxZoom`,
    Number.isInteger(source.maxZoom) && source.maxZoom > 0 && source.maxZoom <= 22,
    String(source.maxZoom));
  check(`${name} says what kind of map it is`,
    source.kind === "map" || source.kind === "imagery", source.kind);
  // A source flagged as not-freely-streamable MUST say why, or the warning
  // beside the credit is a shrug rather than information.
  if (source.freeToStream === false) {
    check(`${name} explains the condition on its licence`,
      typeof source.licence === "string" && source.licence.length > 40);
  }
  // Nothing may leave an unfilled placeholder in a live URL.
  const filled = tileUrl(name, 6, 34, 24);
  check(`${name} fills its template completely`,
    !/\{[a-zA-Z]+\}/.test(filled), filled);
  check(`${name} is served over TLS`, filled.startsWith("https://"));
}

// The two derived shapes are what `map2d.js` reads. A source added to the
// registry but missing from these is the drift the module header warns about.
check("BASEMAPS covers every source",
  Object.keys(BASEMAPS).length === names.length);
check("ATTRIBUTION covers every source",
  Object.keys(ATTRIBUTION).length === names.length);
check("every ATTRIBUTION entry is non-empty",
  Object.values(ATTRIBUTION).every((c) => typeof c === "string" && c.length > 0));

// This module's own default must be one nobody needs permission for. (The
// globe carries a separate default in basemap-drape.js — deliberately, and
// it is a product decision rather than this file's to make.)
check("the registry's default is a source with no licence condition",
  TILE_SOURCES[DEFAULT_SOURCE]?.freeToStream === true, DEFAULT_SOURCE);

// At least one imagery option must be usable by anyone, or "alternatives to
// Esri" is a list of things with the same problem.
const openImagery = Object.entries(TILE_SOURCES)
  .filter(([, s]) => s.kind === "imagery" && s.freeToStream === true);
check("at least one imagery source is unconditionally free",
  openImagery.length >= 1, openImagery.map(([n]) => n).join(", ") || "none");

/* NASA GIBS dates its daily layers and today's is not processed yet —
   measured, 2026-08-27 returned 404 while 2026-08-26 returned a JPEG. A
   date that drifts forward serves a blank globe, which is why this is
   pinned rather than trusted. */
check("GIBS_DATE is an ISO calendar date", /^\d{4}-\d{2}-\d{2}$/.test(GIBS_DATE), GIBS_DATE);
const todayUtc = new Date().toISOString().slice(0, 10);
check("GIBS_DATE is never today or later", GIBS_DATE < todayUtc, `${GIBS_DATE} < ${todayUtc}`);
const ageDays = Math.round((Date.parse(`${todayUtc}T00:00:00Z`) - Date.parse(`${GIBS_DATE}T00:00:00Z`)) / 86400000);
check("GIBS_DATE is yesterday, not a stale hard-coded day", ageDays === 1, `${ageDays} day(s) back`);

/* Sentinel-2 is a 10 m sensor. EOX serves the mosaic to zoom 18 and zoom 14
   over Etna is already 7.55 m/px, so anything past 14 is interpolation
   wearing the clothes of detail. Quote what was delivered. */
const s2 = TILE_SOURCES["Sentinel-2 Cloudless"];
if (s2) {
  check("Sentinel-2 stops at its sensor's resolution, not the server's",
    s2.maxZoom === 14, String(s2.maxZoom));
  check("Sentinel-2's NonCommercial condition is stated",
    /non-?commercial/i.test(s2.licence || ""), s2.licence?.slice(0, 60));
  check("Sentinel-2 credits Copernicus as EOX requires",
    /Copernicus/.test(s2.credit) && /EOX/.test(s2.credit));
}

const viirs = TILE_SOURCES["NASA VIIRS (yesterday)"];
if (viirs) {
  check("VIIRS carries the date it is showing", viirs.credit.includes(GIBS_DATE));
  check("VIIRS asks for the date GIBS actually has", viirs.url.includes(GIBS_DATE));
  check("VIIRS stops at the GIBS matrix set's own ceiling", viirs.maxZoom === 9);
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
