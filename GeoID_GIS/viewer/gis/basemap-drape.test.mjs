/**
 * The projection maths behind the study-area drape.
 *
 * These are the parts that fail *silently* if they are wrong. A bad zoom choice
 * only over-fetches; a Mercator slip puts the imagery a few hundred metres north
 * of where it belongs, which on a globe looks like plausible imagery in the
 * wrong place — the least detectable kind of error there is. So the round trip
 * and the tile arithmetic are pinned against values derived independently
 * rather than against the implementation's own output.
 *
 * Run: node GeoID_GIS/viewer/gis/basemap-drape.test.mjs
 */

import { readFileSync } from "node:fs";
import {
  clampLat, lonToPixelX, latToPixelY, pixelYToLat,
  chooseZoom, tileGrid, metresPerPixel, normaliseBbox, wholeGlobe, equirectRowToSourceY, MAX_LAT,
} from "./basemap-drape.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const close = (name, got, want, tol = 1e-9) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
function throws(name, fn, pattern) {
  try {
    fn();
    check(name, false, "did not throw");
  } catch (error) {
    check(name, pattern.test(error.message), `threw "${error.message}"`);
  }
}

// ── The projection ───────────────────────────────────────────────────────────
const world = 256 * 2 ** 10;

check("lon -180 is the left edge", lonToPixelX(-180, world) === 0);
close("lon 0 is the middle", lonToPixelX(0, world), world / 2);
close("lon 180 is the right edge", lonToPixelX(180, world), world);

close("the equator is the middle row", latToPixelY(0, world), world / 2);
check("north is above the middle", latToPixelY(60, world) < world / 2);
check("south is below the middle", latToPixelY(-60, world) > world / 2);
// Mercator is square: the cut latitude is exactly the top of the world.
close("the Mercator cut is the top edge", latToPixelY(MAX_LAT, world), 0, 1e-3);

// The round trip is what keeps imagery where it belongs.
for (const lat of [-84, -45.5, -0.001, 0, 12.34, 37.751, 60, 84]) {
  close(`lat ${lat} survives the round trip`, pixelYToLat(latToPixelY(lat, world), world), lat, 1e-9);
}

check("the north pole clamps to the Mercator cut", clampLat(90) === MAX_LAT);
check("the south pole clamps too", clampLat(-90) === -MAX_LAT);

// An independently worked fixture: (15.004 + 180) / 360 * 2^12 = 2218.7 -> 2218.
const etnaCol = Math.floor(lonToPixelX(15.004, 256 * 2 ** 12) / 256);
check("Etna sits in tile column 2218", etnaCol === 2218, `got ${etnaCol}`);

// ── The tile grid ────────────────────────────────────────────────────────────
const etna = { minLat: 37.6, maxLat: 37.9, minLon: 14.85, maxLon: 15.2 };
const grid = tileGrid(etna, 12);
const w12 = 256 * 2 ** 12;

check("the grid covers at least one tile", grid.tilesX >= 1 && grid.tilesY >= 1);
check("the tile range is not inverted", grid.x1 >= grid.x0 && grid.y1 >= grid.y0);
check("tile columns are in range", grid.x0 >= 0 && grid.x1 < 2 ** 12);
check("tile rows are in range", grid.y0 >= 0 && grid.y1 < 2 ** 12);

// The canvas is the BOX, not the tiles — that is what lets the mesh use the
// box's own bounds with no margin of somebody else's map hanging off the side.
close("the canvas is exactly as wide as the box",
  grid.width, lonToPixelX(15.2, w12) - lonToPixelX(14.85, w12), 1);
close("and exactly as tall",
  grid.height, latToPixelY(37.6, w12) - latToPixelY(37.9, w12), 1);
check("the box starts at or after its first tile column", grid.pxMin >= grid.x0 * 256);
check("and at or after its first tile row", grid.pyMin >= grid.y0 * 256);
check("the tiles reach past the far edge of the box",
  (grid.x1 + 1) * 256 >= grid.pxMin + grid.width
  && (grid.y1 + 1) * 256 >= grid.pyMin + grid.height);

// ── Choosing the zoom ────────────────────────────────────────────────────────
const tiny = { minLat: 37.750, maxLat: 37.752, minLon: 15.003, maxLon: 15.005 };
check("a small box goes to full zoom", chooseZoom(tiny, { maxZoom: 19 }) === 19);

const whole = { minLat: -MAX_LAT, maxLat: MAX_LAT, minLon: -180, maxLon: 180 };
const wholeZ = chooseZoom(whole, { maxZoom: 19 });
check("a global box backs off to a low zoom", wholeZ <= 4, `got ${wholeZ}`);

// The property the function exists for: whatever it picks, the budget holds.
for (const box of [tiny, etna, whole,
  { minLat: 10, maxLat: 50, minLon: -20, maxLon: 40 },
  { minLat: 80, maxLat: 84, minLon: -10, maxLon: 10 }]) {
  const z = chooseZoom(box, { maxZoom: 19 });
  const g = tileGrid(box, z);
  check(`zoom ${z} keeps the canvas within 4096`, g.width <= 4096 && g.height <= 4096,
    `${g.width}x${g.height}`);
  check(`zoom ${z} keeps the tile count within budget`, g.tilesX * g.tilesY <= 256,
    `${g.tilesX * g.tilesY} tiles`);
}

// And it does not leave resolution unused.
const z = chooseZoom(etna, { maxZoom: 19 });
const deeper = tileGrid(etna, z + 1);
check("the chosen zoom is the deepest one that fits",
  deeper.width > 4096 || deeper.height > 4096 || deeper.tilesX * deeper.tilesY > 256);

// ── Resolution ───────────────────────────────────────────────────────────────
close("zoom 0 is 156.5 km/px at the equator",
  metresPerPixel({ minLat: 0, maxLat: 0 }, 0), 156543.03392, 1e-3);
close("each zoom halves the ground sample",
  metresPerPixel({ minLat: 0, maxLat: 0 }, 1),
  metresPerPixel({ minLat: 0, maxLat: 0 }, 0) / 2, 1e-6);
close("60 degrees north halves the ground sample",
  metresPerPixel({ minLat: 60, maxLat: 60 }, 5),
  metresPerPixel({ minLat: 0, maxLat: 0 }, 5) / 2, 1e-6);

// ── The study area, as the project stores it ─────────────────────────────────
const area = normaliseBbox({ min_lat: 37.9, max_lat: 37.6, min_lon: 15.2, max_lon: 14.85 });
check("a reversed latitude pair is put in order", area.minLat === 37.6 && area.maxLat === 37.9);
check("and so is longitude", area.minLon === 14.85 && area.maxLon === 15.2);
check("a pole-to-pole area is clamped to what Mercator can express",
  normaliseBbox({ min_lat: -90, max_lat: 90, min_lon: -180, max_lon: 180 }).maxLat === MAX_LAT);

throws("no study area is refused by name, not by a null crash",
  () => normaliseBbox(null), /no study area/i);
throws("an empty study area is refused too",
  () => normaliseBbox({ min_lat: "", max_lat: "", min_lon: "", max_lon: "" }), /no study area/i);
throws("a point is refused — there would be nothing to drape",
  () => normaliseBbox({ min_lat: 37.7, max_lat: 37.7, min_lon: 15, max_lon: 15 }), /no area/i);

// ── The whole-globe extent, as a basemap ─────────────────────────────────────
// This has to be good enough to stand beside the shipped Blue Marble, or the
// "whole globe" option is a worse basemap wearing the name.
const g = wholeGlobe();
check("the globe extent spans all longitudes", g.minLon === -180 && g.maxLon === 180);
check("and is cut at the Mercator limit", g.maxLat === MAX_LAT && g.minLat === -MAX_LAT);

const gz = chooseZoom(g, { maxZoom: 19 });
const gGrid = tileGrid(g, gz);
check("a global composite fits in one 4096 px texture",
  gGrid.width <= 4096 && gGrid.height <= 4096, `${gGrid.width}x${gGrid.height}`);
check("and within the tile budget", gGrid.tilesX * gGrid.tilesY <= 256,
  `${gGrid.tilesX * gGrid.tilesY} tiles`);
// Blue Marble is 5400 px across the world = 7.4 km/px. Anything within about a
// factor of two of that is a credible alternative basemap.
const globalMpp = 40075017 / gGrid.width;
check("a global drape is comparable to Blue Marble's 7.4 km/px",
  globalMpp < 15000, `${Math.round(globalMpp)} m/px at zoom ${gz}`);

// ── Reprojection, for the basemap path ──────────────────────────────────────
// The drape dodges this; a basemap cannot, because it becomes the sphere's own
// texture and the sphere's UVs are linear in latitude. Get it wrong and every
// coastline slides polewards, which looks like a plausible map of nowhere.
const SRC_H = 4096;                       // a global Mercator composite is square
const OUT_H = 2048;                       // the equirectangular texture

// The equator is the middle row of both, so it must map to the middle.
close("the equator maps to the middle of the source",
  equirectRowToSourceY(OUT_H / 2, OUT_H, g, SRC_H), SRC_H / 2, 2);

// Rows must run monotonically down the source as they run down the output.
let monotonic = true;
let prev = -1;
for (let j = 0; j < OUT_H; j += 8) {
  const y = equirectRowToSourceY(j, OUT_H, g, SRC_H);
  if (y < prev - 1e-9) monotonic = false;
  prev = y;
}
check("source rows advance monotonically", monotonic);

// Every row lands inside the source image — this is what stops drawImage
// silently sampling nothing and leaving bands of blank texture.
let inRange = true;
for (let j = 0; j < OUT_H; j += 1) {
  const y = equirectRowToSourceY(j, OUT_H, g, SRC_H);
  if (!(y >= 0 && y <= SRC_H - 1)) inRange = false;
}
check("every output row samples inside the source", inRange);

// Beyond the Mercator cut there is no data, so those rows repeat the edge.
check("the north cap clamps to the first source row",
  equirectRowToSourceY(0, OUT_H, g, SRC_H) === 0);
check("the south cap clamps to the last",
  equirectRowToSourceY(OUT_H - 1, OUT_H, g, SRC_H) === SRC_H - 1);

// The distortion is real and in the right direction: at 60°N, Mercator has
// already stretched, so that latitude sits nearer the middle of the source than
// its equirectangular row does. Row for 60N = (90-60)/180 * 2048 = 341.
const row60 = Math.round(((90 - 60) / 180) * OUT_H);
const src60 = equirectRowToSourceY(row60, OUT_H, g, SRC_H);
check("60 N is pulled toward the equator by the reprojection",
  src60 > (row60 / OUT_H) * SRC_H,
  `output row ${row60} reads source row ${Math.round(src60)}`);

/* ── the opening basemap ─────────────────────────────────────────────────── */
/**
 * The swap to Sentinel-2 fires only when it finds the shipped default still
 * selected, so the two constants have to name the SAME layer — and it has to
 * be one that ships with the site. Naming a bucket fetch there made the
 * opening read as two changes: bare, then a downloaded texture, then the
 * mosaic that replaces it.
 */
{
  const drape = readFileSync(new URL("./basemap-drape.js", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
  const shipped = drape.match(/const SHIPPED_DEFAULT_ID = "([^"]+)"/)?.[1];
  const fallback = viewer.match(/const FALLBACK_NAVIGATE_BASE_LAYER_ID = "([^"]+)"/)?.[1];
  check("the viewer and the drape agree on the shipped default",
    shipped === fallback, `${shipped} vs ${fallback}`);
  /**
   * And it has to be an option the select actually HAS. Blue Marble is not in
   * `ALLOWED_BASEMAP_IDS`, so naming it here leaves the globe on the shipped
   * texture for good -- measured, the selection never moved off it.
   */
  const allowed = viewer.match(/ALLOWED_BASEMAP_IDS = new Set\(\[([^\]]+)\]/)?.[1] || "";
  check("and the select actually offers it",
    allowed.includes(`"${shipped}"`), `${shipped} not in ${allowed}`);
  check("the default the globe settles on is the streamed one",
    /const DEFAULT_TILE_SOURCE = "Sentinel-2 Cloudless"/.test(drape));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
