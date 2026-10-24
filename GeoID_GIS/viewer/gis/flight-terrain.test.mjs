// Earth Flight's terrain: heights from the streamed DEM, the sea at zero, the
// Vertical scale applied, and nothing at all outside flight.
//
//   node GeoID_GIS/viewer/gis/flight-terrain.test.mjs

const heights = { "51.5,-0.1": 35, "53.07,-4.08": 1085, "50,-10": -4200 };
globalThis.window = {
  __flightSim: { active: false },
  GeoIDDem: { heightAt: (lat, lon) => heights[`${+lat.toFixed(2)},${+lon.toFixed(2)}`] ?? null },
  dispatchEvent() {},
};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const T = await import("./flight-terrain.js");

let failed = 0, passed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (ok) passed++; else failed++;
};
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const U = 3.2 / 6371000;

check("off outside flight: no terrain lift", !T.active() && T.heightUnits(53.07, -4.08) === 0);
window.__flightSim.active = true;
check("on in flight with a DEM", T.active());
check("ground metres come from the DEM", T.groundMetres(53.07, -4.08) === 1085);
check("the sea is held at zero (no bathymetry under the aircraft)", T.groundMetres(50, -10) === 0);
check("unknown ground is null, and lifts nothing", T.groundMetres(10, 10) === null && T.heightUnits(10, 10) === 0);
check("true scale by default", near(T.heightUnits(53.07, -4.08), 1085 * U));
const v0 = T.getVersion();
T.setVex(3);
check("the Vertical scale multiplies the drawn height", near(T.heightUnits(53.07, -4.08), 3 * 1085 * U));
check("...but not the true ground metres (the readout)", T.groundMetres(53.07, -4.08) === 1085);
check("changing the scale moves the version, so the terrain rebuilds", T.getVersion() > v0);
T.setVex(99);
check("the scale is clamped to the slider's 1-10", T.getVex() === 10);
check("longitudes wrap (east-positive 0-360 reads the same ground)", T.groundMetres(51.5, 359.9) === 35);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
