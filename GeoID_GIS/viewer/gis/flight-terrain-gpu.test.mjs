// The overlays' terrain grids: boxes snap (so they do not crawl with the
// aircraft) and contain the aircraft, and the shared uniforms start off.
//
//   node GeoID_GIS/viewer/gis/flight-terrain-gpu.test.mjs

const G = await import("./flight-terrain-gpu.js");

let failed = 0, passed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (ok) passed++; else failed++;
};

const inside = (b, lat, lon) => lat > b.lat0 && lat < b.lat0 + b.dLat && lon > b.lon0 && lon < b.lon0 + b.dLon;
for (const L of G.LEVELS) {
  const b = G.boxFor(53.07, -4.08, L.halfKm);
  check(`${L.key}: the aircraft is inside its grid`, inside(b, 53.07, -4.08));
  const b2 = G.boxFor(53.07 + 0.001, -4.08 + 0.001, L.halfKm);
  check(`${L.key}: a small move keeps the same grid (snapped)`, b2.lat0 === b.lat0 && b2.lon0 === b.lon0);
  const km = b.dLat * 111.32 / 2;
  check(`${L.key}: spans its half-width`, Math.abs(km - L.halfKm) < 1e-6, String(km));
}
const U = G.flightGpuUniforms();
check("the shared uniforms start switched off", U.uFlightOn.value === 0 && U.uFlightNear.value === null);
check("one shared object for every module", G.flightGpuUniforms() === U);
check("no uniform starts null where three.js needs a value (a null vec4 stops the render loop)",
  ["Near", "Mid", "Far"].every((k) => Array.isArray(U[`uFlight${k}Box`].value) && U[`uFlight${k}Box`].value.length === 4));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
