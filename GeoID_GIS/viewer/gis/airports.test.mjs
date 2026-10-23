/**
 * The airport table and the phrase lookup.
 * Run: node GeoID_GIS/viewer/gis/airports.test.mjs
 */
import { AIRPORTS, findAirport, airportLabel } from "./airports.js";

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass += 1;
  else { fail += 1; console.error("FAIL:", msg); }
}
process.on("exit", () => {
  console.log(`airports: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

ok(AIRPORTS.length > 150, "the table is there");
ok(new Set(AIRPORTS.map((a) => a.iata)).size === AIRPORTS.length, "IATA codes are unique");
ok(AIRPORTS.every((a) => /^[A-Z]{3}$/.test(a.iata) && /^[A-Z]{4}$/.test(a.icao)), "every code is well formed");
ok(AIRPORTS.every((a) => Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180), "every position is on the globe");
// Each ICAO's first letter is its region: K the contiguous US, E/L Europe, R/Z/V east and south Asia…
ok(AIRPORTS.filter((a) => a.country === "US" && a.icao[0] === "K").every((a) => a.lon < -65 && a.lat > 24), "US K-codes are in the contiguous US");
ok(AIRPORTS.filter((a) => a.country === "AU").every((a) => a.lat < -10 && a.lon > 110), "Australia is where it is");

const iata = (q) => findAirport(q)?.airport?.iata ?? null;
ok(iata("LHR") === "LHR" && iata("lhr") === "LHR", "IATA, any case");
ok(iata("KJFK") === "JFK", "ICAO");
ok(iata("London") === "LHR" && iata("New York") === "JFK" && iata("Tokyo") === "NRT", "a city is its main airport");
ok(iata("Heathrow") === "LHR" && iata("Gatwick") === "LGW", "an airport's own name");
ok(iata("Sao Paulo") === "GRU" && iata("Zurich") === "ZRH" && iata("Bogota") === "BOG", "accents do not matter");
ok(iata("London Gatwick airport") === "LGW", "city, name and 'airport'");
ok(iata("Tokio") === "NRT", "a near spelling");
ok(iata("Narnia") === null && iata("") === null, "no guess past a near spelling");
ok(airportLabel(findAirport("MIA").airport) === "Miami MIA", "the label");
