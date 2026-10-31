/**
 * On foot in Earth Flight: moving over the ground, and the field readout.
 * Run: node GeoID_GIS/viewer/gis/flight-walk.test.mjs
 */
import { moved, slopeAt, compassPoint, reliefFromDepth } from "./flight-walk.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failed += 1;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const north = moved(54, -3, 0, 111.32, 0);
check("ahead on a north heading goes north", near(north.lat, 54.001) && near(north.lon, -3));
const east = moved(54, -3, 90, 100, 0);
check("ahead on an east heading goes east, by the latitude's cosine", east.lon > -3 && near(east.lat, 54)
  && near((east.lon + 3) * 111320 * Math.cos(54 * Math.PI / 180), 100, 1e-3), JSON.stringify(east));
const side = moved(54, -3, 0, 0, 100);
check("right of a north heading is east", side.lon > -3 && near(side.lat, 54));

const M = 111320;
// Ground falling to the east at 1 in 1: 45 degrees, dipping due east.
const eastward = (lat, lon) => -(lon * M * Math.cos(10 * Math.PI / 180));
const a = slopeAt(eastward, 10, 20);
check("a 1 in 1 slope reads 45 degrees", near(a.slopeDeg, 45, 0.05), String(a.slopeDeg));
check("falling east dips 090", near(a.dipDir, 90, 0.5), String(a.dipDir));
const b = slopeAt((lat) => lat * M * 0.1, 10, 20);
check("rising north dips due south", near(b.dipDir, 180, 0.5) && near(b.slopeDeg, Math.atan(0.1) * 180 / Math.PI, 0.05), JSON.stringify(b));
const flat = slopeAt(() => 100, 10, 20);
check("level ground has no dip direction", flat.slopeDeg === 0 && flat.dipDir === null);
check("unread ground says so", slopeAt(() => NaN, 10, 20).slopeDeg === null);
check("compass points", compassPoint(0) === "N" && compassPoint(135) === "SE" && compassPoint(355) === "N" && compassPoint(290) === "W");

// The probe sits 400 m over the elevation model and looks 1-800 m down.
check("depth at the model's own height is no relief", near(reliefFromDepth(399 / 799, 1, 800), 0, 1e-9));
check("a surface nearer the probe stands above the model", near(reliefFromDepth(392 / 799, 1, 800), 7, 1e-9));
check("and one further below it", near(reliefFromDepth(402 / 799, 1, 800), -3, 1e-9));
check("nothing under the probe is no answer", reliefFromDepth(1, 1, 800) === null);

process.exit(failed ? 1 : 0);
