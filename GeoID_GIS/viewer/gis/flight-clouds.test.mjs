// Earth Flight's clouds: GIBS's cloud-fraction palette decodes back to the
// per cent it encodes, no-data stays unknown, and the day asked for is
// yesterday's (today's is still being swept).
//
//   node GeoID_GIS/viewer/gis/flight-clouds.test.mjs

const C = await import("./flight-clouds.js");

let failed = 0, passed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (ok) passed++; else failed++;
};

check("clear sky (0 %) is 0", C.fractionOf(0x66, 0x00, 0x77, 255) === 0);
check("overcast (100 %) is 1", C.fractionOf(0xff, 0x00, 0x05, 255) === 1);
check("a middle class decodes to its per cent", C.fractionOf(0xff, 0xff, 0x02, 255) === 0.59, String(C.fractionOf(0xff, 0xff, 0x02, 255)));
check("no data (transparent fill) is unknown", C.fractionOf(192, 192, 192, 0) === null);
check("a colour not in the map is unknown", C.fractionOf(1, 2, 3, 255) === null);
check("yesterday, UTC", C.cloudDate(Date.UTC(2026, 9, 24, 0, 30)) === "2026-10-23");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
