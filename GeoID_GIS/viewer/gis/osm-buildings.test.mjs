// The globe's streamed 3D buildings and the Earth Flight entry: the parts that
// are pure arithmetic, checked against hand-worked answers.
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, tileDistanceM, wantedTiles,
  SHOW_BELOW_M, HIDE_ABOVE_M, SHADOW_BELOW_M,
} from "./osm-buildings.js?v=20261023-3c2cf02";
import { parseFlightLink } from "./earth-flight-entry.js?v=20261024-1786912";
import { nearFieldBounds } from "./view-extent.js?v=20261024-1786912";

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

check("flight link with a place", JSON.stringify(parseFlightLink("?flight=earth&lat=51.5&lon=-0.12")) === JSON.stringify({ lat: 51.5, lon: -0.12 }));
check("flight link without a place opens pre-flight where the globe is", parseFlightLink("?flight=earth")?.lat === null);
check("no flight link, no flight", parseFlightLink("?world=mars") === null && parseFlightLink("") === null);
check("an out-of-range place is not trusted", parseFlightLink("?flight=earth&lat=95&lon=0")?.lat === null);

// In flight, the "visible" box every refiner reads is the near field.
const ship = { lat: 51.5, lon: -0.12 };
const low = nearFieldBounds(ship, 0.5);                       // 500 m up: horizon ~80 km
check("near field at 500 m reaches past the ~80 km horizon", near((low.maxLat - low.minLat) / 2 * 111.32, 1.5 * Math.sqrt(2 * 6371 * 0.5), 0.01));
check("never under 25 km", near((nearFieldBounds(ship, 0).maxLat - nearFieldBounds(ship, 0).minLat) / 2 * 111.32, 25, 0.01));
const high = nearFieldBounds(ship, 400);
check("near field is capped at 600 km", near((high.maxLat - high.minLat) / 2 * 111.32, 600, 0.01));
const horizon = { minLat: 50, maxLat: 60, minLon: -3, maxLon: 3 };   // a frustum box out to the horizon
const cut = nearFieldBounds(ship, 0.5, horizon);
check("the horizon box is clipped to the near field", cut.maxLat < 52.6 && cut.minLat >= 50 && cut.minLon > -2);
check("no overlap falls back to the ship's square",
  JSON.stringify(nearFieldBounds(ship, 0.5, { minLat: 10, maxLat: 11, minLon: 10, maxLon: 11 })) === JSON.stringify(nearFieldBounds(ship, 0.5)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
