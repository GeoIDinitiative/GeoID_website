/**
 * Earth's coordinate readout: −180..180 east or west, north or south, and
 * kept current when the view moves rather than only when the mouse does.
 *
 *   node GeoID_GIS/viewer/gis/coord-format.test.mjs
 */
import { readFileSync } from "node:fs";
import { signedLon, formatLat, formatLon, formatLatLon } from "./coord-format.js";

let pass = 0; let fail = 0;
const eq = (msg, got, want) => {
  if (got === want) { pass += 1; console.log(`PASS  ${msg}`); } else { fail += 1; console.log(`FAIL  ${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
process.on("exit", () => { console.log(`${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });

// The two readings that were wrong on 2026-10-24.
eq("Pittsburgh, read east-positive 280, is 80°W", formatLatLon(40.45, 280.0), "40.45°N, 80.00°W");
eq("Frankfurt is east", formatLatLon(50.1, 8.66), "50.10°N, 8.66°E");

eq("a signed west longitude reads the same", formatLon(-80), "80.00°W");
eq("Sydney: south and east", formatLatLon(-33.87, 151.21), "33.87°S, 151.21°E");
eq("Rio: south and west, from 0–360", formatLatLon(-22.91, 316.83), "22.91°S, 43.17°W");
eq("Greenwich is neither east nor west", formatLon(0), "0.00°");
eq("nor is 360", formatLon(360), "0.00°");
eq("a hair west of Greenwich rounds to no side", formatLon(359.999), "0.00°");
eq("the antimeridian is neither", formatLon(180), "180.00°");
eq("nor from the west", formatLon(-180), "180.00°");
eq("just short of it is east", formatLon(179.99), "179.99°E");
eq("and just past it west", formatLon(180.01), "179.99°W");
eq("the equator has no hemisphere", formatLat(0), "0.00°");
eq("a pole is north", formatLat(90), "90.00°N");
eq("digits are honoured", formatLatLon(51.4779, -0.0015, 4), "51.4779°N, 0.0015°W");
eq("a non-number is blank", formatLon(NaN), "");
eq("signedLon keeps 180 as 180", signedLon(180), 180);
eq("signedLon wraps 270 to −90", signedLon(270), -90);
eq("signedLon leaves a signed value alone", signedLon(-45.5), -45.5);

// The viewer uses it, and keeps the moon's own °W.
const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
eq("the pointer readout formats Earth through it", /: formatLatLon\(latLon\.lat, latLon\.lon\)/.test(viewer), true);
eq("the moon branch keeps west-positive °W", /context\?\.kind === "moon"\s*\?\s*`\$\{latLon\.lat\.toFixed\(2\)\}°, \$\{latLon\.lon\.toFixed\(2\)\}°W`/.test(viewer), true);
eq("renderCursorReadout formats through it", /cursorReadout\.innerHTML = `\$\{formatLatLon\(lat, lon\)\} `/.test(viewer), true);
eq("no raw °E readout is left", /cursorReadout\.innerHTML = `\$\{[^`]*toFixed\(2\)\}°E/.test(viewer), false);
eq("the render loop re-reads it when the view moves", /if \(_rs\.moving \|\| Math\.abs\(globe\.rotation\.y - readoutSpin\) > 1e-6\) readoutDirty = true;/.test(viewer)
  && /refreshReadoutForView\(\)/.test(viewer), true);
eq("with no pointer it reads the view's centre", /readoutPointer \|\| \{ x: rect\.left \+ rect\.width \/ 2, y: rect\.top \+ rect\.height \/ 2 \}/.test(viewer), true);
