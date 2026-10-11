/**
 * The pure half of the wind and current flow layers, against closed forms.
 * Run: node GeoID_GIS/viewer/gis/flow-field.test.mjs
 */
import {
  wrapLon, isGlobal, planGrid, gridPoints, uvFromSpeedDir, headingOf, compassPoint,
  toMetresPerSecond, chunkPoints, requestUrl, pickHour, readHourly, buildField,
  interpolate, sampleStack, sampleScalar, advect, randomPoint, rampAt, rampPalette,
  beaufort, WORLD, RAMPS, OPEN_METEO,
} from "./flow-field.js";

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) pass += 1;
  else { fail += 1; failures.push(msg); console.error("FAIL:", msg); }
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
// The verdict is the exit hook's, so a check appended anywhere still counts.
process.on("exit", () => {
  console.log(`flow-field: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

/* wrap and boxes */
ok(wrapLon(190) === -170 && wrapLon(-190) === 170 && wrapLon(180) === -180, "longitude wraps into [-180, 180)");
ok(wrapLon(0) === 0 && !Object.is(wrapLon(-360), -0), "no negative zero from the wrap");
ok(isGlobal(WORLD) && !isGlobal({ west: -10, east: 10, south: 0, north: 5 }), "a world box is global, a regional one is not");

/* the lattice */
{
  const { nx, ny } = planGrid({ west: 0, east: 40, south: 0, north: 10 }, 400);
  ok(nx > ny * 2.5, `a wide shallow box gets more columns than rows (${nx}×${ny})`);
  ok(nx * ny <= 520, `the plan stays near its budget (${nx * ny})`);
  // At 60°N a degree of longitude is half a degree of latitude on the ground.
  const high = planGrid({ west: 0, east: 20, south: 59, north: 61 }, 200);
  const low = planGrid({ west: 0, east: 20, south: -1, north: 1 }, 200);
  ok(high.nx < low.nx, "the same longitude span is fewer columns where it is less ground");
}
{
  const g = gridPoints(WORLD, 72, 33);
  ok(g.lats.length === 72 * 33, "a lattice has nx × ny points");
  ok(near(g.dLon, 5) && g.lons[71] === 175 && g.lons[0] === -180, "a global lattice does not repeat its seam");
  ok(g.lats[0] === -80 && near(g.lats[g.lats.length - 1], 80), "rows run south to north, ends included");
  const r = gridPoints({ west: 10, east: 20, south: 40, north: 50 }, 11, 11);
  ok(r.lons[10] === 20 && r.lats[120] === 50, "a regional lattice includes both edges");
}

/* conventions */
{
  const [u, v] = uvFromSpeedDir(10, 270, "from"); // a westerly: FROM the west
  ok(near(u, 10, 1e-9) && near(v, 0, 1e-9), "a wind from the west blows east");
  const [u2, v2] = uvFromSpeedDir(10, 0, "from"); // a northerly
  ok(near(u2, 0, 1e-9) && near(v2, -10, 1e-9), "a wind from the north blows south");
  const [u3, v3] = uvFromSpeedDir(2, 90, "to"); // a current flowing east
  ok(near(u3, 2, 1e-9) && near(v3, 0, 1e-9), "a current's direction is where it flows TO");
  ok(near(headingOf(1, 0), 90) && near(headingOf(0, -1), 180), "a heading is where the flow goes");
  ok(compassPoint(0) === "N" && compassPoint(225) === "SW" && compassPoint(350) === "N", "sixteen compass points");
}

/* units */
ok(near(toMetresPerSecond(36, "km/h"), 10), "36 km/h is 10 m/s");
ok(near(toMetresPerSecond(10, "kn"), 5.14444), "ten knots");
ok(near(toMetresPerSecond(5, "m/s"), 5) && Number.isNaN(toMetresPerSecond(null, "km/h")), "m/s passes; null is NaN");

/* requests */
{
  const lats = Array.from({ length: 600 }, (_, i) => i / 10);
  const lons = lats.map((x) => -x);
  const chunks = chunkPoints(lats, lons, 250);
  ok(chunks.length === 3 && chunks[2].start === 500 && chunks[2].lats.length === 100, "points split into request-sized chunks");
  const url = requestUrl(OPEN_METEO, { lats: [1.234, 2], lons: [3, 4.5678], variables: ["wind_speed_10m", "wind_direction_10m"], extra: { wind_speed_unit: "ms" }, hoursAhead: 24 });
  ok(url.includes("latitude=1.23%2C2") && url.includes("longitude=3%2C4.57"), "coordinates go to two decimals, comma-separated");
  ok(url.includes("forecast_hours=26") && url.includes("wind_speed_unit=ms") && url.includes("timezone=GMT"), "the window reaches the hour asked for");
}

/* reading an answer */
{
  const now = Date.parse("2026-10-11T14:20:00Z");
  const times = ["2026-10-11T13:00", "2026-10-11T14:00", "2026-10-11T15:00"];
  ok(pickHour(times, now, 0) === 1, "the hour nearest now");
  ok(pickHour(times, now, 1) === 2, "the hour nearest now plus one");
  const answer = [
    { hourly: { time: times, ocean_current_velocity: [1, 3.6, 7.2], ocean_current_direction: [0, 90, 180] }, hourly_units: { ocean_current_velocity: "km/h" } },
    { hourly: { time: times, ocean_current_velocity: [null, null, null], ocean_current_direction: [null, null, null] }, hourly_units: { ocean_current_velocity: "km/h" } },
  ];
  const { values, time } = readHourly(answer, ["ocean_current_velocity", "ocean_current_direction"], { nowMs: now, convert: { ocean_current_velocity: "speed" } });
  ok(near(values.ocean_current_velocity[0], 1) && values.ocean_current_direction[0] === 90, "a speed is converted from the unit it came in");
  ok(Number.isNaN(values.ocean_current_velocity[1]), "a null (land) is NaN, not zero");
  ok(time === "2026-10-11T14:00", "the hour read is reported");
  const single = readHourly({ hourly: { time: times, x: [1, 2, 3] } }, ["x"], { nowMs: now });
  ok(single.values.x.length === 1 && single.values.x[0] === 2, "a single location's object reads like a list of one");
}

/* the field and interpolation */
{
  // A linear field over a regional box: bilinear must reproduce it exactly.
  const box = { west: 0, east: 10, south: 0, north: 10 };
  const nx = 11, ny = 11;
  const { lats, lons } = gridPoints(box, nx, ny);
  const speed = new Float64Array(nx * ny);
  const dir = new Float64Array(nx * ny).fill(90);
  for (let k = 0; k < speed.length; k += 1) speed[k] = 1 + 0.1 * lons[k] + 0.2 * lats[k];
  const f = buildField(box, nx, ny, speed, dir, { convention: "to" });
  ok(near(interpolate(f, f.u, 3.3, 4.7), 1 + 0.47 + 0.66, 1e-5), "bilinear reproduces a linear field");
  ok(Number.isNaN(interpolate(f, f.u, 11, 5)), "outside the box is NaN");
  ok(f.valid === 121 && near(f.max, 1 + 1 + 2, 1e-5), "the field counts its values and its fastest");
}
{
  // A coast: one NaN corner ends a particle rather than blending onto land.
  const box = { west: 0, east: 2, south: 0, north: 2 };
  const speed = [1, 1, 1, 1, NaN, 1, 1, 1, 1];
  const f = buildField(box, 3, 3, speed, new Array(9).fill(0), { convention: "to" });
  ok(Number.isNaN(interpolate(f, f.v, 0.5, 0.5)) && Number.isFinite(interpolate(f, f.v, 1.5, 0.1) ) === false, "a cell touching land answers NaN");
  ok(near(interpolate(f, f.v, 0, 0), 1), "a node away from land answers its own value");
}
{
  // A global field wraps: a point at 179.9 blends the last column with the first.
  const nx = 4, ny = 3;
  const box = WORLD;
  const speed = [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4];
  const f = buildField(box, nx, ny, speed, new Array(12).fill(90), { convention: "to" });
  // Columns at -180, -90, 0, 90. Half way from 90 to the seam is 135: (4 + 1) / 2.
  ok(near(interpolate(f, f.u, 0, 135), 2.5, 1e-5), "a global field wraps across the seam");
  ok(near(interpolate(f, f.u, 0, -135), 1.5, 1e-5), "and on the other side of it");
}
{
  // A stack: the fine field answers inside its box, even with NaN.
  const coarse = buildField(WORLD, 4, 3, new Array(12).fill(5), new Array(12).fill(90), { convention: "to" });
  const fine = buildField({ west: 0, east: 10, south: 0, north: 10 }, 2, 2, [NaN, 1, 1, 1], [90, 90, 90, 90], { convention: "to", scalars: { sst: [20, 21, 22, 23] } });
  const inside = sampleStack([fine, coarse], 5, 5);
  ok(inside.field === fine && Number.isNaN(inside.u), "the fine field's coast is not overruled by the coarse one");
  const outside = sampleStack([fine, coarse], 30, 30);
  ok(outside.field === coarse && near(outside.u, 5, 1e-6), "outside the fine box the coarse one answers");
  ok(near(sampleScalar([fine, coarse], "sst", 10, 10), 23, 1e-5), "a scalar rides on the field");
}

/* moving */
{
  const [lat, lon] = advect(0, 0, 10, 0, 0.01);
  ok(near(lat, 0) && near(lon, 0.1), "a step east at the equator");
  const [lat2, lon2] = advect(60, 0, 10, 0, 0.01);
  ok(near(lon2, 0.2, 1e-9) && near(lat2, 60), "the same step at 60°N is twice the longitude");
  const [, lon3] = advect(0, 179.95, 10, 0, 0.01);
  ok(near(lon3, -179.95, 1e-9), "a step across the antimeridian wraps");
}
{
  // Uniform by area: half the points of a global box fall within 30° of the equator.
  let s = 1;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  let low = 0;
  const N = 20000;
  for (let i = 0; i < N; i += 1) if (Math.abs(randomPoint({ west: -180, east: 180, south: -90, north: 90 }, rand)[0]) < 30) low += 1;
  ok(Math.abs(low / N - 0.5) < 0.02, `area-uniform: ${(100 * low / N).toFixed(1)}% within 30° of the equator`);
  const [plat, plon] = randomPoint({ west: 170, east: 190, south: 0, north: 1 }, () => 0.75);
  ok(plon === -175 && plat > 0.5 && plat < 1, "a box across the seam answers a wrapped longitude");
}

/* colour */
{
  const calm = rampAt(RAMPS.wind, 0);
  ok(near(calm[0], 36 / 255), "the bottom of the ramp");
  const mid = rampAt(RAMPS.wind, (3.4 + 7) / 2);
  ok(near(mid[1], ((170 + 200) / 2) / 255, 1e-9), "half way between two stops");
  ok(rampAt(RAMPS.wind, NaN)[0] === 0.55, "no value is grey");
  const pal = rampPalette(RAMPS.current, 5);
  ok(pal.length === 5 && /^[0-9a-f]{6}$/.test(pal[0]), "a palette is hex without a hash");
}
ok(beaufort(0.2).name === "Calm" && beaufort(18).number === 8 && beaufort(40).name === "Hurricane force", "Beaufort");

/* forecast windows */
{
  const { aggregateHourly, countFinite } = await import("./flow-field.js");
  const now = Date.parse("2026-10-11T12:00:00Z");
  const times = Array.from({ length: 30 }, (_, h) => new Date(now + (h - 1) * 3600e3).toISOString().slice(0, 16));
  const rain = times.map((_, h) => (h === 5 ? null : 1));
  const gust = times.map((_, h) => h * 3.6);
  const json = [{ hourly: { time: times, precipitation: rain, wind_gusts_10m: gust }, hourly_units: { wind_gusts_10m: "km/h" } }];
  const sum = aggregateHourly(json, "precipitation", { nowMs: now, toHours: 24 });
  // Hours ending in (12:00, 12:00 next day]: 24 of them, one missing.
  ok(sum.values[0] === 23 && sum.hours[0] === 23, `a 24 h sum over the hours it has (${sum.values[0]})`);
  const max = aggregateHourly(json, "wind_gusts_10m", { nowMs: now, toHours: 24, op: "max", convert: "speed" });
  ok(near(max.values[0], 25, 1e-9), "the strongest gust, converted to m/s");
  const none = aggregateHourly([{ hourly: { time: times, precipitation: times.map(() => null) } }], "precipitation", { nowMs: now });
  ok(Number.isNaN(none.values[0]), "no value in the window is NaN, not zero");
  ok(countFinite([1, NaN, 2]) === 2, "count finite");
}
