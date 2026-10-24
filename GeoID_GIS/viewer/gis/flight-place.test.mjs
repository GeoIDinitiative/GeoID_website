// Earth Flight's "where am I": the country under the aircraft, the sea when
// there is none, and the nearest town.
//
//   node GeoID_GIS/viewer/gis/flight-place.test.mjs

const P = await import("./flight-place.js");

let failed = 0, passed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (ok) passed++; else failed++;
};

const square = (name, w, s, e, n) => ({ type: "Feature", properties: { name }, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
const index = P.indexCountries({ features: [square("Testland", -5, 50, 0, 55), square("Otherland", 0, 50, 5, 55)] });
const places = [
  { name: "Bangor", lat: 53.23, lon: -4.13, category: "place-city" },
  { name: "Irish Sea", lat: 53.5, lon: -5.5, category: "place-marine" },
  { name: "Snowdon (Yr Wyddfa)", lat: 53.07, lon: -4.08, category: "place-mountain" },
];

check("the country holding the point", P.countryAt(index, 53, -4) === "Testland");
check("its neighbour across the border", P.countryAt(index, 53, 1) === "Otherland");
check("no country at sea", P.countryAt(index, 53, -6) === null);
const nearBangor = P.describe(index, places, 53.1, -4.0);
check("title is the country", nearBangor.title === "Testland", nearBangor.title);
check("region names the nearest town", nearBangor.region === "NEAR BANGOR", nearBangor.region);
check("over the town within 4 km", P.describe(index, places, 53.23, -4.13).region === "OVER BANGOR");
const sea = P.describe(index, places, 53.5, -6.2);
check("over water: the nearest sea", sea.title === "Irish Sea", sea.title);
check("far from anything: open sea", P.describe(index, places, 30, -40).title === "Open sea");
check("distances are great-circle km", Math.abs(P.distKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111.19) < 0.1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
