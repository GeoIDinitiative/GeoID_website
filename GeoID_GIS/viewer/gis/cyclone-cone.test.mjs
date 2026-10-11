/**
 * The cyclone forecast cone against closed forms.
 * Run: node GeoID_GIS/viewer/gis/cyclone-cone.test.mjs
 */
import {
  coneRadiusKm, distanceKm, interpolateTrack, destination, bearing, conePolygon, inRing,
  threatTo, gdacsStorms, readGdacsGeometry, parseTime, saffirSimpson, gdacsCycloneListUrl,
} from "./cyclone-cone.js";

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass += 1;
  else { fail += 1; console.error("FAIL:", msg); }
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
