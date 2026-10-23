/**
 * The cyclone forecast cone against closed forms.
 * Run: node GeoID_GIS/viewer/gis/cyclone-cone.test.mjs
 */
import {
  coneRadiusKm, distanceKm, interpolateTrack, destination, bearing, conePolygon, inRing,
  threatTo, gdacsStorms, readGdacsGeometry, parseTime, saffirSimpson, gdacsCycloneListUrl,
  parseLabelTime, CATEGORY_KT, CATEGORY_RANGE_KT, easeCategoryWinds,
} from "./cyclone-cone.js";

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = "") {
  if (cond) pass += 1;
  else { fail += 1; console.error("FAIL:", msg, detail); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
process.on("exit", () => {
  console.log(`cyclone-cone: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

ok(coneRadiusKm(0) === 0 && near(coneRadiusKm(24), 39 * 1.852, 1e-9), "the radius at the table's rows");
ok(near(coneRadiusKm(30), (39 + 53) / 2 * 1.852, 1e-9), "between rows, linear");
ok(coneRadiusKm(144) > coneRadiusKm(120), "past the table it keeps growing");

ok(near(distanceKm(0, 0, 0, 1), 111.195, 0.01), "a degree on the equator");
{
  const [lat, lon] = destination(10, 20, 90, 300);
  ok(near(distanceKm(10, 20, lat, lon), 300, 1e-6), "a destination is its distance away");
  ok(near(bearing(10, 20, lat, lon), 90, 0.5), "and on its bearing");
}

const H = 3_600_000;
const t0 = Date.parse("2026-10-11T12:00:00Z");
{
  const track = interpolateTrack([
    { lat: 20, lon: -60, time: t0 }, { lat: 25, lon: -70, time: t0 + 24 * H },
  ], 3);
  ok(track.length === 9 && track[4].lead === 12, `samples every 3 h (${track.length})`);
  ok(near(track[4].lat, 22.5, 1e-9) && near(track[4].lon, -65, 1e-9), "linear between fixes");
  const across = interpolateTrack([{ lat: 10, lon: 178, time: t0 }, { lat: 12, lon: -178, time: t0 + 12 * H }], 6);
  ok(near(across[1].lon, 180, 1e-9), "across the antimeridian the short way round");
}
{
  // A straight westward track: the cone holds every forecast centre, and its
  // half-width at a sample is that sample's radius.
  const fixes = [0, 24, 48, 72].map((h, i) => ({ lat: 20, lon: -50 - 5 * i, time: t0 + h * H }));
  const track = interpolateTrack(fixes, 3);
  const cone = conePolygon(track);
  ok(cone && cone[0][0] === cone.at(-1)[0], "the ring is closed");
  ok(track.every((p) => inRing(p.lat, p.lon, cone)), "every forecast centre is inside the cone");
  const at48 = track.find((p) => p.lead === 48);
  const r = coneRadiusKm(48);
  const [inLat, inLon] = destination(at48.lat, at48.lon, 0, r * 0.9);
  const [outLat, outLon] = destination(at48.lat, at48.lon, 0, r * 1.15);
  ok(inRing(inLat, inLon, cone) && !inRing(outLat, outLon, cone), "at 48 h the cone is the 48 h radius wide");
  const th = threatTo(inLat, inLon, track, cone);
  ok(th.inCone && near(th.lead, 48, 3) && th.km < r, "a place in the cone is told when the centre passes");
  const far = threatTo(40, 0, track, cone);
  ok(!far.inCone && far.km > 2000, "a far place is not threatened");
}
{
  // A hairpin: no side point lands inside an earlier circle.
  const fixes = [{ lat: 20, lon: -60, time: t0 }, { lat: 25, lon: -60, time: t0 + 24 * H }, { lat: 20, lon: -59, time: t0 + 48 * H }];
  const cone = conePolygon(interpolateTrack(fixes, 3));
  ok(cone && cone.length > 20, "a recurving track still makes a ring");
}

ok(parseTime("12/10/2026 06:00") === Date.parse("2026-10-12T06:00:00Z"), "dd/mm/yyyy is read day first");
ok(parseTime("2026-10-12 06:00") === Date.parse("2026-10-12T06:00:00Z"), "a bare ISO time is UTC");
ok(Number.isNaN(parseTime(null)), "no time is NaN");
ok(saffirSimpson(100) === 3 && saffirSimpson(40) === 0 && saffirSimpson(20) === -1, "Saffir–Simpson");
ok(gdacsCycloneListUrl(10, t0).includes("eventlist=TC"), "the list asks for cyclones");

{
  const list = gdacsStorms({ features: [
    { geometry: { coordinates: [-70, 25] }, properties: { eventid: 1001, episodeid: 7, name: "MARIA", alertlevel: "Red", url: { geometry: "https://example/geom" } } },
    { properties: {} },
  ] });
  ok(list.length === 1 && list[0].geometryUrl === "https://example/geom" && list[0].alert === "Red", "storms are read from the list");
  const now = t0;
  const fc = { features: [
    { geometry: { type: "Point", coordinates: [-60, 20] }, properties: { trackdate: "11/10/2026 06:00", windspeed: 185 } },
    { geometry: { type: "Point", coordinates: [-62, 21] }, properties: { trackdate: "11/10/2026 12:00", windspeed: 195 } },
    { geometry: { type: "Point", coordinates: [-66, 23] }, properties: { trackdate: "12/10/2026 12:00", windspeed: 210 } },
    { geometry: { type: "Point", coordinates: [-70, 26] }, properties: { trackdate: "13/10/2026 12:00", forecast: "true" } },
    { geometry: { type: "LineString", coordinates: [[-60, 20], [-70, 26]] }, properties: { Class: "Line_Line_0" } },
  ] };
  const read = readGdacsGeometry(fc, now + 60 * 1000);
  ok(read.past.length === 2 && read.forecast.length === 2, "fixes split into observed and forecast");
  ok(read.track.length === 3 && read.track[0].lon === -62, "the forecast starts at the latest observed fix");
  ok(near(read.past[1].wind, 195 / 1.852, 1e-9), "winds from km/h to knots");
  const withCone = readGdacsGeometry({ features: [{ geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { Class: "Poly_Cones" } }] });
  ok(withCone.cone?.length === 4, "a published cone is taken as published");
}

// The layer's wiring.
{
  const { readFileSync } = await import("node:fs");
  const here = new URL(".", import.meta.url);
  const panels = readFileSync(new URL("catalogue-panels.js", here), "utf8");
  const layer = readFileSync(new URL("cyclone-forecast.js", here), "utf8");
  const page = readFileSync(new URL("../index.html", here), "utf8");
  ok(panels.includes('id: "cyclone-forecast"') && /GeoIDCycloneForecast\.add\(\)/.test(panels), "active cyclones are a Hazards row");
  ok(/gis\/cyclone-forecast\.js\?v=/.test(page), "the page loads the module");
  ok(/threatAt/.test(layer), "the score can ask what a storm means for a place");
  const mod = await import("./cyclone-forecast.js");
  const fx = mod.stormFeatures({ name: "X", cone: [[179, 0], [181, 1], [182, 0], [179, 0]], coneSource: "built",
    track: [{ lat: 0, lon: 180, time: 0 }, { lat: 1, lon: 182, time: 3600e3 }], past: [], forecast: [{ lat: 1, lon: 182, time: 3600e3, wind: 70 }] });
  ok(fx.find((f) => f.properties.part === "cone") === undefined, "a cone across the antimeridian is not drawn wrapped wrong");
  ok(fx.find((f) => f.properties.part === "fix").properties.strength === "Category 1", "a fix says its strength");
  ok(fx.find((f) => f.properties.part === "forecast").geometry.coordinates[1][0] === -178, "longitudes are wrapped for the globe");
}

// GDACS's current shape (October 2026): each fix a small circle dated only in
// its label, its strength only on the segment leaving it.
{
  const circle = (lon, lat, r = 0.03) => [Array.from({ length: 33 }, (_, k) => {
    const a = (2 * Math.PI * (k % 32)) / 32;
    return [lon + r * Math.cos(a), lat + r * Math.sin(a)];
  })];
  const fixAt = (lon, lat, label) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: circle(lon, lat) },
    properties: { Class: `Point_Polygon_Point_${label}`, featuretype: "PointRadii", polygondate: "2026-10-22T21:00:00", polygonlabel: label } });
  const seg = (a, b, cat, fc) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [a, b] },
    properties: { Class: "Line_Line_x", polygonlabel: cat, forecast: fc } });
  const fc = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [-65.8, 40] }, properties: { Class: "Point_Centroid", todate: "2026-10-22T21:00:00",
      severitydata: { severity: 120.37, severityunit: "km/h" } } },
    fixAt(-67.3, 39.2, "22/10 15:00 UTC"),
    fixAt(-65.8, 40.0, "22/10 21:00 UTC"),
    { ...fixAt(-62.7, 41.3, "23/10 06:00 UTC"), properties: { ...fixAt(-62.7, 41.3, "23/10 06:00 UTC").properties, severitydata: { severity: 296, severityunit: "km/h" } } },
    fixAt(-58.6, 42.9, "23/10 18:00 UTC"),
    seg([-67.3, 39.2], [-65.8, 40.0], "TS", false),
    seg([-65.8, 40.0], [-62.7, 41.3], "HU", true),
    seg([-62.7, 41.3], [-58.6, 42.9], "TS", true),
    { type: "Feature", geometry: { type: "Polygon", coordinates: circle(-60, 42, 3) }, properties: { Class: "Poly_Red", polygondate: "2026-10-25T06:00:00", polygonlabel: "25/10 06:00" } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: circle(-60, 42, 4) }, properties: { Class: "Poly_Cones", polygondate: "2026-10-22T21:00:00", polygonlabel: "Uncertainty Cones" } },
  ] };
  const g = readGdacsGeometry(fc, Date.UTC(2026, 9, 23, 19));
  ok(g.issued === Date.UTC(2026, 9, 22, 21), "the advisory time is the fixes' date, not the wind polygons'");
  ok(g.past.length === 2 && g.forecast.length === 2, "observed up to the advisory, forecast after it (the centroid not counted twice)");
  ok(near(g.track[0].lat, 40, 1e-9) && near(g.track[0].lon, -65.8, 1e-9), "a circle's centre is the fix");
  ok(g.track[0].time === Date.UTC(2026, 9, 22, 21) && g.track.at(-1).time === Date.UTC(2026, 9, 23, 18), "label times, the year from the advisory");
  ok(near(g.track[0].wind, 120.37 / 1.852, 1e-9) && !g.track[0].windFrom, "now: the reported severity wins over the class");
  // Ahead: the class from the segment leaving the fix, the number eased from
  // the measured 65 kt toward the TS mid-point at the track's end (9 h of 21).
  const eased = 120.37 / 1.852 + (CATEGORY_KT.TS - 120.37 / 1.852) * (9 / 21);
  ok(g.track[1].cls === "TS" && g.track[1].windFrom === "eased" && near(g.track[1].wind, eased, 1e-9), "ahead: the class read, the strength eased from the measurement", g.track[1].wind);
  ok(g.past[0].wind === CATEGORY_KT.TS, "observed fixes too");
  ok(Math.abs(g.forecast[0].wind - 296 / 1.852) > 50 && g.forecast[0].wind <= CATEGORY_RANGE_KT.TS[1], "the event's severity on a fix is not that fix's wind");
  ok(g.track.at(-1).wind === CATEGORY_KT.TS, "the last fix from the segment arriving");
  ok(Array.isArray(g.cone) && g.cone.length === 33, "the agency's cone");
  ok(parseLabelTime("02/01 06:00 UTC", Date.UTC(2026, 11, 31, 18)) === Date.UTC(2027, 0, 2, 6), "a January fix of a December advisory is next year");
  ok(Number.isNaN(parseLabelTime("Uncertainty Cones", Date.now())), "a label that is not a time");
}

// The centroid is the storm NOW. It carries fromdate (when the storm formed)
// and todate (the advisory); read by fromdate, a 160 kt super typhoon's
// measured wind was filed under the day it formed and the track ran on class
// mid-points — "HU", 80 kt (Champi, 2026-10-23).
{
  const ring = (lon, lat) => [Array.from({ length: 9 }, (_, k) => [lon + 0.03 * Math.cos(k * Math.PI / 4), lat + 0.03 * Math.sin(k * Math.PI / 4)])];
  const fix = (lon, lat, label) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: ring(lon, lat) },
    properties: { Class: "Point_Polygon_Point_x", featuretype: "PointRadii", polygondate: "2026-10-23T00:00:00", polygonlabel: label } });
  const seg = (a, b, cat) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [a, b] }, properties: { Class: "Line_Line_x", polygonlabel: cat } });
  const fc = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [123.8, 22.7] }, properties: { Class: "Point_Centroid",
      fromdate: "2026-10-14T12:00:00", todate: "2026-10-23T00:00:00", severitydata: { severity: 296.2944, severityunit: "km/h" } } },
    fix(124.3, 21.9, "22/10 18:00 UTC"), fix(123.8, 22.7, "23/10 00:00 UTC"), fix(122.9, 24.2, "23/10 12:00 UTC"),
    fix(122.7, 25.5, "24/10 00:00 UTC"), fix(123.4, 27.3, "24/10 12:00 UTC"),
    seg([124.3, 21.9], [123.8, 22.7], "HU"), seg([123.8, 22.7], [122.9, 24.2], "HU"), seg([122.9, 24.2], [122.7, 25.5], "HU"),
    seg([122.7, 25.5], [123.4, 27.3], "HU"), seg([123.4, 27.3], [124.3, 29.0], "TS"),
  ] };
  const g = readGdacsGeometry(fc, Date.UTC(2026, 9, 23, 21));
  const kt = 296.2944 / 1.852;
  ok(g.track[0].time === Date.UTC(2026, 9, 23, 0) && near(g.track[0].wind, kt, 1e-9), "the centroid is dated by its todate and keeps its measured wind", g.track[0].wind);
  ok(!g.past.some((f) => f.time === Date.UTC(2026, 9, 14, 12)), "and is not filed under the day the storm formed");
  // HU at 12 h and 24 h, then TS (50) at 36 h: eased linearly from 160 kt.
  ok(near(g.track[1].wind, kt + (50 - kt) * (12 / 36), 1e-9) && near(g.track[2].wind, kt + (50 - kt) * (24 / 36), 1e-9), "HU fixes ease from the measurement toward the next class");
  ok(g.track[3].wind <= 63 && g.track[3].wind >= 34, "a TS fix stays inside the TS range");
  ok(g.past[0].wind === CATEGORY_KT.HU && g.past[0].windFrom === "category", "fixes before the measurement keep their class mid-points");
  // Without a measurement nothing is eased.
  const bare = easeCategoryWinds([{ time: 0, wind: 80, windFrom: "category", cls: "HU" }, { time: 1, wind: 50, windFrom: "category", cls: "TS" }]);
  ok(bare[0].wind === 80 && bare[1].wind === 50, "no measured wind: class mid-points stand");
}
