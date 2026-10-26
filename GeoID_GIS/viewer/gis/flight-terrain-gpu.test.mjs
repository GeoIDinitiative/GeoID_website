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
check("the drape uniforms start off, and the fill cover discards nothing",
  U.uDrapeOn.value === 0 && U.uFlightCoverCos.value > 1 && U.uFlightDrapePass.value === 0
  && ["Near", "Mid", "Far"].every((k) => Array.isArray(U[`uDrape${k}Box`].value) && U[`uDrape${k}Box`].value.length === 4)
  && Array.isArray(U.uFlightShipDir.value) && Array.isArray(U.uFlightDrapeBox.value));

// The overlays' direction convention: lon = atan(z, -x), lat = asin(y).
for (const [lat, lon] of [[39.6, -105.2], [-33.9, 151.2], [64.1, -21.9]]) {
  const [x, y, z] = G.dirFor(lat, lon);
  const lo = Math.atan2(z, -x) * 180 / Math.PI, la = Math.asin(y) * 180 / Math.PI;
  check(`dirFor round-trips ${lat}, ${lon}`, Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9, `${la}, ${lo}`);
}

// The drape stands in for fills only where it is drawn AND painted.
check("no drape yet: nothing stands in", G.drapeCoverM(0, 150000) === 0);
check("the drape's own box limits it (a quarter span off centre)", G.drapeCoverM(400, 1e9) === 300000);
check("the flight tiles' reach limits it", G.drapeCoverM(400, 100000) === 95000);
for (const D of G.DRAPES) {
  const b = G.boxFor(39.6, -105.2, D.halfKm), b2 = G.boxFor(39.6 + D.halfKm / 111.32 * 0.24, -105.2, D.halfKm);
  check(`${D.key} drape: a box snapped round the aircraft still covers 0.75 of its half-span`,
    (b2.lat0 + b2.dLat) - (39.6 + D.halfKm / 111.32 * 0.24) >= 0.75 * D.halfKm / 111.32 - 1e-9);
}

/* ── Hazard maps on the flight ground, and played in time ───────────────── */
{
  const { readFileSync } = await import("node:fs");
  const gpu = readFileSync(new URL("./flight-terrain-gpu.js", import.meta.url), "utf8");
  check("a changed layer redraws the drapes next, not on their timers (moved > dirty > stale)",
    typeof G.markDrapesDirty === "function"
      && /const pick = moved >= 0 \? moved : dirty >= 0 \? dirty : stale;/.test(gpu));
  const vr = readFileSync(new URL("./vector-render.js", import.meta.url), "utf8");
  check("raster hazard maps drape in their own colour (a lit material is black with no lights)",
    /if \(uFlightDrapePass > 0\.5\) gl_FragColor = vec4\(diffuseColor\.rgb, diffuseColor\.a\);/.test(vr));
  check("globe-frame drapes are turned back to the import frame",
    /flightGlobeFrame = Boolean\(globeFrame\)/.test(vr) && /normalize\(aDir \* uFlightFrame\)/.test(vr)
      && /geoidFlightHeight\(aDir \* uFlightFrame\)/.test(vr));
  const tl = readFileSync(new URL("./timelapse-player.js", import.meta.url), "utf8");
  check("the time bar refreshes the flight drapes on every frame it shows",
    (tl.match(/GeoIDFlightTerrainGpu\?\.markDrapesDirty\?\.\(\)/g) || []).length >= 2);
  check("in flight the time bar keeps the clock (the daytime switch) and sits in view",
    /if \(id === "time-scrub-toggle" && window\.__flightSim\?\.active\) continue;/.test(tl)
      && /body\.fs-flying \.geoid-timelapse \{/.test(tl));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
