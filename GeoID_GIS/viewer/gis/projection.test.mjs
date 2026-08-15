/**
 * The projection module, against references measured from PROJ.
 *
 * projection.js hand-rolls UTM and LAEA (proj4 is not vendored), and a wrong
 * series term produces numbers that look entirely plausible — so every
 * absolute value here is a MEASUREMENT taken by running pyproj 3.6.1 (PROJ),
 * with the exact command recorded beside it. Round trips alone cannot catch a
 * shared error between the forward and inverse series; absolute references
 * alone cannot catch the two failing to invert each other; this file has both.
 *
 * The case classes and why each exists:
 *  - ABSOLUTE forward/inverse references (Etna 33N, a zone-32 and a zone-34
 *    point, a southern 327xx point, LAEA both ways): pins agreement with PROJ
 *    itself, including the 10,000,000 m false northing on the S hemisphere.
 *  - ROUND TRIPS at several latitudes: forward and inverse are separate
 *    hand-written series whose truncation errors grow with latitude.
 *  - utmZoneForLon at zone boundaries and ±180: the modulo wrap is the easy
 *    thing to break, and 180°E must land in zone 1 (≡ −180°), not zone 61.
 *  - projectedToLatLon on epsg:32611, which is NOT in the CRS_OPTIONS
 *    dropdown: the /^epsg:32([67])(\d{2})$/ pattern-match is deliberately
 *    general — any WGS84 UTM zone works, not just the listed ones — and a
 *    tidy-minded rewrite to the dropdown list would silently narrow it.
 *  - transform() dispatch: identity, 4326 in, 4326 out, cross-CRS routing
 *    through WGS84, and the null paths are five separate branches.
 *
 * Tolerances, measured before being chosen:
 *  - ABS_M = 0.01 m for absolute projected coords. Measured worst
 *    disagreement with PROJ across all six forward references: 0.0004 m
 *    (32632 northing) — 1 cm is 25x headroom and far inside the sub-metre
 *    the module claims.
 *  - RT_M = 0.005 m for round trips. Measured worst drift: 6.3e-4 m at
 *    78.9°N.
 *  - ABS_DEG = 1e-7 degrees (~11 mm of latitude) for absolute lat/lon.
 *    Measured worst inverse disagreement: ~3e-10 degrees.
 *
 * Run: node GeoID_GIS/viewer/gis/projection.test.mjs
 */

import {
  utmToLatLon, latLonToUtm, utmZoneForLon,
  latLonToProjected, projectedToLatLon, transform, CRS_OPTIONS,
} from "./projection.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

const ABS_M = 0.01;
const RT_M = 0.005;
const ABS_DEG = 1e-7;

/* ── absolute forward references, measured from PROJ ── */

{
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:4326','EPSG:32633',always_xy=True).transform(14.99, 37.75))"
  // -> (499119.0546, 4178077.6382)
  const p = latLonToProjected(37.75, 14.99, "epsg:32633");
  near("Etna easting in EPSG:32633", p.x, 499119.0546, ABS_M);
  near("Etna northing in EPSG:32633", p.y, 4178077.6382, ABS_M);
  check("and it is flagged northern", p.north === true && p.zone === 33);
}
{
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:4326','EPSG:32632',always_xy=True).transform(11.5756, 48.1372))"
  // -> (691611.2155, 5334758.0528)
  const p = latLonToProjected(48.1372, 11.5756, "epsg:32632");
  near("Munich easting in EPSG:32632", p.x, 691611.2155, ABS_M);
  near("Munich northing in EPSG:32632", p.y, 5334758.0528, ABS_M);
}
{
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:4326','EPSG:32634',always_xy=True).transform(23.7275, 37.9838))"
  // -> (739542.0288, 4207528.0591)
  const p = latLonToProjected(37.9838, 23.7275, "epsg:32634");
  near("Athens easting in EPSG:32634", p.x, 739542.0288, ABS_M);
  near("Athens northing in EPSG:32634", p.y, 4207528.0591, ABS_M);
}
{
  // Southern hemisphere: the false northing must be added, not the latitude
  // negated into the wrong series.
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:4326','EPSG:32756',always_xy=True).transform(151.2093, -33.8688))"
  // -> (334368.6336, 6250948.3454)
  const p = latLonToProjected(-33.8688, 151.2093, "epsg:32756");
  near("Sydney easting in EPSG:32756", p.x, 334368.6336, ABS_M);
  near("Sydney northing carries the 10,000 km false northing", p.y, 6250948.3454, ABS_M);
  check("and it is flagged southern", p.north === false);
}
{
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:4326','EPSG:3035',always_xy=True).transform(12.4964, 41.9028))"
  // -> (4528866.7560, 2092277.1425)
  const p = latLonToProjected(41.9028, 12.4964, "epsg:3035");
  near("Rome easting in EPSG:3035 LAEA", p.x, 4528866.7560, ABS_M);
  near("Rome northing in EPSG:3035 LAEA", p.y, 2092277.1425, ABS_M);
}

/* ── absolute inverse references ── */

{
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:32633','EPSG:4326',always_xy=True).transform(499119.0546, 4178077.6382))"
  // -> (14.9900000003, 37.7500000003)
  const g = projectedToLatLon(499119.0546, 4178077.6382, "epsg:32633");
  near("Etna latitude back from EPSG:32633", g.lat, 37.75, ABS_DEG);
  near("Etna longitude back from EPSG:32633", g.lon, 14.99, ABS_DEG);
}
{
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:32756','EPSG:4326',always_xy=True).transform(334368.6336, 6250948.3454))"
  // -> (151.2092999995, -33.8687999999)
  const g = projectedToLatLon(334368.6336, 6250948.3454, "epsg:32756");
  near("Sydney latitude back from EPSG:32756 is southern", g.lat, -33.8688, ABS_DEG);
  near("Sydney longitude back from EPSG:32756", g.lon, 151.2093, ABS_DEG);
}
{
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:3035','EPSG:4326',always_xy=True).transform(4500000, 2100000))"
  // -> (12.1523469058, 41.9805775218)
  const g = projectedToLatLon(4500000, 2100000, "epsg:3035");
  near("EPSG:3035 grid point inverse latitude", g.lat, 41.9805775218, ABS_DEG);
  near("EPSG:3035 grid point inverse longitude", g.lon, 12.1523469058, ABS_DEG);
}

/* ── round trips: forward and inverse must invert each other ── */

{
  const M_PER_DEG = 111320; // metres per degree of latitude, near enough for an error metric
  const cases = [
    [0, 15.2],            // equator: the series' simplest regime
    [37.75, 14.99],       // Etna, the project's own grid
    [60.4, 10.1],         // high latitude, zone 32
    [-33.8688, 151.2093], // southern hemisphere through the false northing
    [78.9, 16.3],         // Svalbard: worst measured truncation error
    [-54.8, -68.3],       // Tierra del Fuego: deep south, western hemisphere
  ];
  cases.forEach(([lat, lon]) => {
    const p = latLonToUtm(lat, lon);
    const b = utmToLatLon(p.x, p.y, p.zone, p.north);
    const errM = Math.hypot(
      (b.lat - lat) * M_PER_DEG,
      (b.lon - lon) * M_PER_DEG * Math.cos(lat * Math.PI / 180),
    );
    near(`UTM round trip at ${lat}, ${lon} (zone ${p.zone})`, errM, 0, RT_M);
  });
}

/* ── utmZoneForLon: boundaries and the wrap at ±180 ── */

{
  check("zone 1 starts at −180", utmZoneForLon(-180) === 1);
  check("just inside zone 1", utmZoneForLon(-174.001) === 1);
  check("−174 begins zone 2", utmZoneForLon(-174) === 2);
  check("just west of Greenwich is zone 30", utmZoneForLon(-0.001) === 30);
  check("Greenwich begins zone 31", utmZoneForLon(0) === 31);
  check("just inside zone 31", utmZoneForLon(5.999) === 31);
  check("6°E begins zone 32", utmZoneForLon(6) === 32);
  check("12°E begins zone 33 (Etna's)", utmZoneForLon(12) === 33);
  check("just west of the antimeridian is zone 60", utmZoneForLon(179.999) === 60);
  check("180°E wraps to zone 1, not a zone 61", utmZoneForLon(180) === 1);
  check("a longitude past 180 wraps consistently",
    utmZoneForLon(186) === utmZoneForLon(-174));
  check("latLonToUtm defaults its zone from the longitude",
    latLonToUtm(37.75, 14.99).zone === 33);
}

/* ── the pattern-match is general: a zone NOT in the dropdown works ── */

{
  check("epsg:32611 is not a CRS_OPTIONS entry",
    !CRS_OPTIONS.some((o) => o.id === "epsg:32611"));
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:4326','EPSG:32611',always_xy=True).transform(-118.2437, 34.0522))"
  // -> (385213.9130, 3768641.4898)
  const p = latLonToProjected(34.0522, -118.2437, "epsg:32611");
  check("latLonToProjected still projects into it", p !== null);
  near("Los Angeles easting in EPSG:32611", p.x, 385213.9130, ABS_M);
  near("Los Angeles northing in EPSG:32611", p.y, 3768641.4898, ABS_M);
  const g = projectedToLatLon(385213.9130, 3768641.4898, "epsg:32611");
  near("and projectedToLatLon inverts it, latitude", g.lat, 34.0522, ABS_DEG);
  near("longitude", g.lon, -118.2437, ABS_DEG);
}

/* ── transform() dispatch: each branch is its own code path ── */

{
  const t = transform(499119.0546, 4178077.6382, "epsg:32633", "epsg:32633");
  check("identity transform returns the coordinates untouched",
    t.x === 499119.0546 && t.y === 4178077.6382);
  const n = transform(3.5, 7.25, "none", "none");
  check("identity wins even for a CRS with no geographic meaning",
    n !== null && n.x === 3.5 && n.y === 7.25);
  const g = transform(14.99, 37.75, "epsg:4326", "epsg:4326");
  check("epsg:4326 to itself is the identity too", g.x === 14.99 && g.y === 37.75);
}
{
  // 4326 in: (x, y) means (lon, lat) on the geographic side.
  const t = transform(14.99, 37.75, "epsg:4326", "epsg:32633");
  near("transform from epsg:4326 matches the Etna reference easting", t.x, 499119.0546, ABS_M);
  near("and northing", t.y, 4178077.6382, ABS_M);
}
{
  // 4326 out: the result comes back as (lon, lat).
  const t = transform(499119.0546, 4178077.6382, "epsg:32633", "epsg:4326");
  near("transform to epsg:4326 puts longitude in x", t.x, 14.99, ABS_DEG);
  near("and latitude in y", t.y, 37.75, ABS_DEG);
}
{
  // Cross-CRS routes through WGS84: UTM inverse then LAEA forward.
  // python3 -c "from pyproj import Transformer;
  //   print(Transformer.from_crs('EPSG:32633','EPSG:3035',always_xy=True).transform(499119.0546, 4178077.6382))"
  // -> (4763716.3093, 1644685.1711)
  const t = transform(499119.0546, 4178077.6382, "epsg:32633", "epsg:3035");
  near("Etna from UTM 33N into LAEA Europe, easting", t.x, 4763716.3093, ABS_M);
  near("and northing", t.y, 1644685.1711, ABS_M);
}
{
  check("an unsupported source CRS transforms to null",
    transform(0, 0, "epsg:9999", "epsg:32633") === null);
  check("an unsupported target CRS transforms to null",
    transform(499119, 4178077, "epsg:32633", "epsg:9999") === null);
  check("'none' as a source with a real target is null, not a guess",
    transform(1, 2, "none", "epsg:4326") === null);
}

/* ── the unsupported-id contract on the direct converters ── */

{
  check("latLonToProjected of 'none' is null", latLonToProjected(37.75, 14.99, "none") === null);
  check("latLonToProjected of an unknown id is null", latLonToProjected(37.75, 14.99, "epsg:9999") === null);
  check("projectedToLatLon of 'none' is null", projectedToLatLon(1, 2, "none") === null);
  check("projectedToLatLon of an unknown id is null", projectedToLatLon(1, 2, "epsg:9999") === null);
  const g = latLonToProjected(37.75, 14.99, "epsg:4326");
  check("epsg:4326 passthrough is (x, y) = (lon, lat)", g.x === 14.99 && g.y === 37.75);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
