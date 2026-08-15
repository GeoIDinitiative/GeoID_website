/**
 * .prj sniffing, against WKT written the way the tools that produce it write it.
 *
 * Every snippet below is the real shape of a file this will meet: EPSG's own
 * WKT1 with its nested AUTHORITY chain, ESRI's flavour with no authority at
 * all and underscores for spaces, and WKT2 with its BASEGEOGCRS. The two
 * failures being pinned are the ones that produce a confident wrong answer
 * rather than an error:
 *
 *   - the nested-authority trap — a regex for "the EPSG code" in the British
 *     National Grid file finds the spheroid's 7001, the datum's 6277, the base
 *     geographic CRS's 4277 and the unit's 9001 before it finds 27700;
 *   - the name-order trap — `WGS_1984_Web_Mercator_Auxiliary_Sphere` contains
 *     "WGS 1984" and is not 4326, and `TM75 / Irish Grid` contains "Irish
 *     Grid" and is 29903 rather than 29902.
 *
 * A wrong CRS is not a visible failure: the layer draws, in the wrong place,
 * with no error anywhere. That is what makes these worth pinning.
 *
 * Run: node GeoID_GIS/viewer/gis/prj-detect.test.mjs
 */

import { detectCrs, crsLabel } from "./prj-detect.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const equal = (name, got, want) =>
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ── fixtures: real-shaped WKT ── */

// EPSG WKT1, as GDAL writes it. Five EPSG codes; only the last one is the file.
const BNG_WKT1 = `PROJCS["OSGB 1936 / British National Grid",
  GEOGCS["OSGB 1936",
    DATUM["OSGB_1936",
      SPHEROID["Airy 1830",6377563.396,299.3249646,AUTHORITY["EPSG","7001"]],
      AUTHORITY["EPSG","6277"]],
    PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],
    UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],
    AUTHORITY["EPSG","4277"]],
  PROJECTION["Transverse_Mercator"],
  PARAMETER["latitude_of_origin",49],
  PARAMETER["central_meridian",-2],
  PARAMETER["scale_factor",0.9996012717],
  PARAMETER["false_easting",400000],
  PARAMETER["false_northing",-100000],
  UNIT["metre",1,AUTHORITY["EPSG","9001"]],
  AXIS["Easting",EAST],
  AXIS["Northing",NORTH],
  AUTHORITY["EPSG","27700"]]`;

// ESRI writes this one — one line, underscores, no authority anywhere.
const BNG_ESRI = `PROJCS["British_National_Grid",GEOGCS["GCS_OSGB_1936",DATUM["D_OSGB_1936",`
  + `SPHEROID["Airy_1830",6377563.396,299.3249646]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],`
  + `PARAMETER["False_Easting",400000.0],PARAMETER["False_Northing",-100000.0],`
  + `PARAMETER["Central_Meridian",-2.0],PARAMETER["Scale_Factor",0.9996012717],`
  + `PARAMETER["Latitude_Of_Origin",49.0],UNIT["Meter",1.0]]`;

const WGS84_WKT1 = `GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,`
  + `AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,`
  + `AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],`
  + `AUTHORITY["EPSG","4326"]]`;

const WGS84_ESRI = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,`
  + `298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;

const WEB_MERCATOR_ESRI = `PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",`
  + `DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],`
  + `PARAMETER["False_Easting",0.0],PARAMETER["Central_Meridian",0.0],`
  + `PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]`;

const IRISH_GRID_WKT1 = `PROJCS["TM65 / Irish Grid",GEOGCS["TM65",DATUM["TM65",`
  + `SPHEROID["Airy Modified 1849",6377340.189,299.3249646,AUTHORITY["EPSG","7002"]],`
  + `AUTHORITY["EPSG","6299"]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],`
  + `AUTHORITY["EPSG","4299"]],PROJECTION["Transverse_Mercator"],`
  + `PARAMETER["latitude_of_origin",53.5],PARAMETER["central_meridian",-8],`
  + `UNIT["metre",1],AUTHORITY["EPSG","29902"]]`;

const IRISH_GRID_ESRI = `PROJCS["TM65_Irish_Grid",GEOGCS["GCS_TM65",DATUM["D_TM65",`
  + `SPHEROID["Airy_Modified",6377340.189,299.3249646]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],`
  + `PARAMETER["Scale_Factor",1.000035],UNIT["Meter",1.0]]`;

// The name contains "Irish Grid" and is NOT 29902.
const TM75_ESRI = `PROJCS["TM75_Irish_Grid",GEOGCS["GCS_TM75",DATUM["D_TM75",`
  + `SPHEROID["Airy_Modified",6377340.189,299.3249646]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],UNIT["Meter",1.0]]`;

const ITM_ESRI = `PROJCS["IRENET95_Irish_Transverse_Mercator",GEOGCS["GCS_IRENET95",`
  + `DATUM["D_IRENET95",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],`
  + `PARAMETER["False_Easting",600000.0],PARAMETER["Central_Meridian",-8.0],UNIT["Meter",1.0]]`;

const UTM29N_ESRI = `PROJCS["WGS_1984_UTM_Zone_29N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",`
  + `SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],`
  + `PARAMETER["False_Easting",500000.0],PARAMETER["Central_Meridian",-9.0],`
  + `PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;

const UTM33S_ESRI = UTM29N_ESRI
  .replace("WGS_1984_UTM_Zone_29N", "WGS_1984_UTM_Zone_33S")
  .replace(`PARAMETER["Central_Meridian",-9.0]`, `PARAMETER["Central_Meridian",15.0]`);

// Same zone, different datum: 32632 would be wrong (ETRS89 UTM 32N is 25832).
const UTM32N_ETRS89_ESRI = `PROJCS["ETRS_1989_UTM_Zone_32N",GEOGCS["GCS_ETRS_1989",`
  + `DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],`
  + `PARAMETER["Central_Meridian",9.0],UNIT["Meter",1.0]]`;

// WKT2. The BASEGEOGCRS carries ID["EPSG",4258]; the file is 3035.
const LAEA_WKT2 = `PROJCRS["ETRS89-extended / LAEA Europe",
  BASEGEOGCRS["ETRS89",
    DATUM["European Terrestrial Reference System 1989",
      ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]],
    PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],
    ID["EPSG",4258]],
  CONVERSION["Europe Equal Area 2001",
    METHOD["Lambert Azimuthal Equal Area",ID["EPSG",9820]],
    PARAMETER["Latitude of natural origin",52,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8801]],
    PARAMETER["Longitude of natural origin",10,ANGLEUNIT["degree",0.0174532925199433],ID["EPSG",8802]]],
  CS[Cartesian,2],
    AXIS["northing (Y)",north,ORDER[1],LENGTHUNIT["metre",1]],
    AXIS["easting (X)",east,ORDER[2],LENGTHUNIT["metre",1]],
  ID["EPSG",3035]]`;

const LAEA_ESRI = `PROJCS["ETRS_1989_LAEA_Europe",GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",`
  + `SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Azimuthal_Equal_Area"],`
  + `PARAMETER["False_Easting",4321000.0],UNIT["Meter",1.0]]`;

const WGS84_WKT2 = `GEOGCRS["WGS 84",
  DATUM["World Geodetic System 1984",
    ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]]],
  PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],
  CS[ellipsoidal,2],
    AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],
    AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],
  ID["EPSG",4326]]`;

const UNKNOWN_LOCAL = `PROJCS["Ballykelly_Site_Grid_1978",GEOGCS["GCS_Unknown",`
  + `DATUM["D_Unknown",SPHEROID["Airy_1830",6377563.396,299.3249646]],PRIMEM["Greenwich",0.0],`
  + `UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],UNIT["Meter",1.0]]`;

/* ── an authority code beats every nested one ── */

{
  const crs = detectCrs(BNG_WKT1);
  equal("BNG WKT1: the CRS's own EPSG code, not a nested one", crs.epsg, 27700);
  check("BNG WKT1: the base geographic CRS's 4277 does not win", crs.epsg !== 4277);
  check("BNG WKT1: the unit's 9001 does not win", crs.epsg !== 9001);
  check("BNG WKT1: the spheroid's 7001 does not win", crs.epsg !== 7001);
  equal("BNG WKT1: name", crs.name, "OSGB 1936 / British National Grid");
  equal("BNG WKT1: projected, not geographic", crs.isGeographic, false);
  equal("BNG WKT1: metres", crs.unit, "metre");
  equal("BNG WKT1: read from the file, not guessed", crs.source, "authority");
}

{
  const crs = detectCrs(WGS84_WKT1);
  equal("WGS 84 WKT1: 4326", crs.epsg, 4326);
  equal("WGS 84 WKT1: geographic", crs.isGeographic, true);
  equal("WGS 84 WKT1: degrees", crs.unit, "degree");
}

{
  const crs = detectCrs(LAEA_WKT2);
  equal("WKT2 LAEA: the projected code, not the BASEGEOGCRS's 4258", crs.epsg, 3035);
  equal("WKT2 LAEA: metres, from the AXIS length unit", crs.unit, "metre");
  equal("WKT2 LAEA: projected", crs.isGeographic, false);
}

{
  const crs = detectCrs(WGS84_WKT2);
  equal("WKT2 GEOGCRS: 4326", crs.epsg, 4326);
  equal("WKT2 GEOGCRS: geographic", crs.isGeographic, true);
  equal("WKT2 GEOGCRS: degrees, from the AXIS angle unit", crs.unit, "degree");
}

/* ── the name fallback, where ESRI leaves nothing else ── */

{
  const crs = detectCrs(BNG_ESRI);
  equal("ESRI BNG: recognised by name", crs.epsg, 27700);
  equal("ESRI BNG: the answer says it was a guess", crs.source, "name");
  equal("ESRI BNG: Meter normalises to metre", crs.unit, "metre");
  equal("ESRI BNG: the file's own name is kept", crs.name, "British_National_Grid");
}

equal("ESRI GCS_WGS_1984: 4326", detectCrs(WGS84_ESRI).epsg, 4326);
equal("ESRI GCS_WGS_1984: Degree normalises to degree", detectCrs(WGS84_ESRI).unit, "degree");

// The order trap: this name contains "WGS 1984" and must not be 4326.
{
  const crs = detectCrs(WEB_MERCATOR_ESRI);
  equal("ESRI Web Mercator: 3857", crs.epsg, 3857);
  check("ESRI Web Mercator: not mistaken for its datum's 4326", crs.epsg !== 4326);
}

equal("Irish Grid WKT1: 29902 from the authority", detectCrs(IRISH_GRID_WKT1).epsg, 29902);
equal("ESRI TM65 Irish Grid: 29902 by name", detectCrs(IRISH_GRID_ESRI).epsg, 29902);

// The second order trap: "TM75 / Irish Grid" is 29903, not 29902.
{
  const crs = detectCrs(TM75_ESRI);
  equal("ESRI TM75 Irish Grid: 29903", crs.epsg, 29903);
  check("ESRI TM75: the generic Irish Grid rule does not swallow it", crs.epsg !== 29902);
}

{
  const crs = detectCrs(ITM_ESRI);
  equal("ESRI Irish Transverse Mercator: 2157", crs.epsg, 2157);
  check("ITM: not taken for the Irish Grid", crs.epsg !== 29902 && crs.epsg !== 29903);
}

equal("ESRI UTM zone 29N: 32629", detectCrs(UTM29N_ESRI).epsg, 32629);
equal("ESRI UTM zone 33S: 32733", detectCrs(UTM33S_ESRI).epsg, 32733);

// The datum guard: same zone and hemisphere, a datum the table cannot answer for.
{
  const crs = detectCrs(UTM32N_ETRS89_ESRI);
  equal("ETRS89 UTM 32N: refused rather than answered as WGS 84's 32632", crs.epsg, null);
  equal("ETRS89 UTM 32N: the name is still reported", crs.name, "ETRS_1989_UTM_Zone_32N");
}

equal("ESRI ETRS89 LAEA: 3035 by name", detectCrs(LAEA_ESRI).epsg, 3035);

/* ── an authority always beats a name, even a contradictory one ── */

{
  // The same ESRI British National Grid text, with an authority appended: a
  // real case when a file has been round-tripped through another tool, and the
  // declaration is the one to believe.
  const contradictory = `${BNG_ESRI.slice(0, -1)},AUTHORITY["EPSG","2157"]]`;
  const crs = detectCrs(contradictory);
  equal("AUTHORITY beats the name guess", crs.epsg, 2157);
  equal("AUTHORITY beats the name guess: source says so", crs.source, "authority");
  check("AUTHORITY beats the name guess: the name rule would have said 27700",
    detectCrs(BNG_ESRI).epsg === 27700);
}

/* ── what a file we cannot place returns ── */

{
  const crs = detectCrs(UNKNOWN_LOCAL);
  equal("unknown CRS: no code invented", crs.epsg, null);
  equal("unknown CRS: the first quoted token is returned as the name",
    crs.name, "Ballykelly_Site_Grid_1978");
  equal("unknown CRS: source records that nothing was matched", crs.source, null);
  equal("unknown CRS: the unit is still readable", crs.unit, "metre");
}

/* ── input the file system actually hands over ── */

equal("empty text: no code", detectCrs("").epsg, null);
equal("empty text: empty name", detectCrs("").name, "");
equal("null: no code", detectCrs(null).epsg, null);
equal("prose that is not WKT: no code", detectCrs("this is not a projection file").epsg, null);

// Some tools write the code alone, or a proj4 string. Both are declarations.
equal("a bare EPSG:27700 line is a declaration", detectCrs("EPSG:27700").epsg, 27700);
equal("a bare EPSG line is named from the table",
  detectCrs("EPSG:27700").name, "OSGB36 / British National Grid");
equal("proj4 +init=epsg:4326", detectCrs("+init=epsg:4326 +proj=longlat +no_defs").epsg, 4326);
equal("proj4 with no code stays unknown", detectCrs("+proj=longlat +datum=WGS84 +no_defs").epsg, null);

// A .prj written on Windows often opens with a byte-order mark, which is
// invisible and makes the first keyword unmatchable.
equal("a leading byte-order mark is stripped", detectCrs(`﻿${BNG_WKT1}`).epsg, 27700);
equal("leading and trailing whitespace are tolerated",
  detectCrs(`\n  ${WGS84_WKT1}  \n`).epsg, 4326);

/* ── labels ── */

equal("crsLabel: a table entry", crsLabel(27700), "OSGB36 / British National Grid");
equal("crsLabel: a UTM north zone is formulaic", crsLabel(32629), "WGS 84 / UTM zone 29N");
equal("crsLabel: a UTM south zone", crsLabel(32733), "WGS 84 / UTM zone 33S");
equal("crsLabel: anything else states the code", crsLabel(25832), "EPSG:25832");
equal("crsLabel: nothing to label", crsLabel(null), "");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
