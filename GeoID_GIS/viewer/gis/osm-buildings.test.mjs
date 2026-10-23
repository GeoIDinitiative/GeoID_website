// The globe's streamed 3D buildings and the Earth Flight entry: the parts that
// are pure arithmetic, checked against hand-worked answers.
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, tileDistanceM, wantedTiles,
  SHOW_BELOW_M, HIDE_ABOVE_M, SHADOW_BELOW_M,
} from "./osm-buildings.js?v=20261023-3c2cf02";
import { bearing, flightUrl } from "./earth-flight-entry.js?v=20261023-3c2cf02";

let failed = 0, passed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (ok) passed++; else failed++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Trafalgar Square sits in z14 tile 8186/5448 (checked against OpenFreeMap).
const london = { lat: 51.5080, lon: -0.1281 };
check("tile x of Trafalgar Square", Math.floor(lonToTileX(london.lon, 14)) === 8186);
check("tile y of Trafalgar Square", Math.floor(latToTileY(london.lat, 14)) === 5448);
check("tile maths round-trips", near(tileYToLat(latToTileY(london.lat, 14), 14), london.lat, 1e-9)
  && near(tileXToLon(lonToTileX(london.lon, 14), 14), london.lon, 1e-9));
check("inside a tile is distance 0", tileDistanceM(london.lat, london.lon, 8186, 5448) === 0);
// One tile east: the gap is from the point to that tile's west edge.
const eastEdge = tileXToLon(8187, 14);
const want = (eastEdge - london.lon) * 111320 * Math.cos(london.lat * Math.PI / 180);
check("distance to the next tile is to its edge", near(tileDistanceM(london.lat, london.lon, 8187, 5448), want, 0.5),
  `${tileDistanceM(london.lat, london.lon, 8187, 5448)} vs ${want}`);

const set = wantedTiles(london, null);
check("the eye's own tile comes first", set[0].x === 8186 && set[0].y === 5448 && set[0].d === 0);
check("capped at the tile budget", set.length <= 16, String(set.length));
check("nearest first", set.every((t, i) => i === 0 || set[i - 1].d <= t.d));
check("everything held is within the radius", set.every((t) => t.d <= 2500));
const ahead = { lat: london.lat + 0.03, lon: london.lon };     // ~3.3 km north
const withFocus = wantedTiles(london, ahead, { max: 40 });
check("a far view centre adds the tiles round it",
  withFocus.some((t) => tileDistanceM(ahead.lat, ahead.lon, t.x, t.y) === 0)
  && !set.some((t) => tileDistanceM(ahead.lat, ahead.lon, t.x, t.y) === 0));

check("thresholds: shadows < show < hide", SHADOW_BELOW_M < SHOW_BELOW_M && SHOW_BELOW_M < HIDE_ABOVE_M);

check("bearing north", near(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0, 1e-9));
check("bearing east", near(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 1e-9));
check("bearing south-west", near(bearing({ lat: 0, lon: 0 }, { lat: -1, lon: -1 }), 225, 0.01));
const url = new URL(flightUrl({ lat: 51.5, lon: -0.12, heading: 271.6, altitude: 12000 }), "https://x");
check("flight URL carries the view", url.pathname === "/flight_sim/earth/" && url.searchParams.get("lat") === "51.50000"
  && url.searchParams.get("hdg") === "272" && url.searchParams.get("from") === "geohub");
check("a high view starts at a flyable 3 km", url.searchParams.get("alt") === "3000");
check("a chosen height wins", new URL(flightUrl({ lat: 1, lon: 2, choice: "250" }), "https://x").searchParams.get("alt") === "250");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
