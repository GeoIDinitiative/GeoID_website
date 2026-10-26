/**
 * The streamed DEM: the arithmetic, the ceiling, and the one rule that keeps
 * the drawn globe and the sampled height from disagreeing inside a single
 * calculation.
 *
 * Run: node GeoID_GIS/viewer/gis/dem-tiles.test.mjs
 */

import { decodeTerrarium, despike, despikePoints, POINT_SPIKE_M, sampleGrid, chooseZoom, groundMetresPerPixel,
  normaliseBounds, INFO_ZOOM, DESPIKE_M, TERRARIUM, coverFor, COVER_CEILING, planCover
} from "./dem-tiles.js";
import { tilesForBounds, mercatorTile } from "./mvt.js";
import { readFileSync } from "node:fs";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: got ${a}, expected ${b}`); }
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: got ${a}, expected ${b} ±${tol}`);
}
function ok(c, what) { if (!c) throw new Error(what); }

/* ── the encoding ────────────────────────────────────────────────────────── */

check("terrarium decodes to metres about the geoid", () => {
  eq(decodeTerrarium(128, 0, 0), 0, "sea level");
  eq(decodeTerrarium(0, 0, 0), -32768, "the floor of the encoding");
  // Everest's tile measured 8751.0 m at its highest post; that is R=162 G=47.
  near(decodeTerrarium(162, 47, 0), 8751, 1, "Everest");
  // The blue channel is the fractional metre, which is why a DEM read this way
  // does not terrace the way an 8-bit height texture does.
  near(decodeTerrarium(128, 0, 128), 0.5, 1e-9, "half a metre");
});

/* ── the corrupt scanline ────────────────────────────────────────────────── */

check("the 28°N scanline artifact is repaired, and nothing else is", () => {
  const w = 8; const h = 5;
  const heights = new Float32Array(w * h).fill(5000);
  // One row 8,150 m below its neighbours -- the artifact as measured.
  for (let x = 0; x < w; x += 1) heights[(2 * w) + x] = 5000 - 8150;
  const repaired = despike(heights, w, h);
  eq(repaired, w, "one row repaired");
  eq(heights[(2 * w) + 3], 5000, "and put back on its neighbours");
});

check("a real cliff is not an artifact", () => {
  const w = 4; const h = 3;
  const heights = new Float32Array(w * h);
  // 250 m across one post is a very steep slope and still under the threshold.
  for (let x = 0; x < w; x += 1) { heights[x] = 0; heights[w + x] = 250; heights[2 * w + x] = 500; }
  const before = [...heights];
  eq(despike(heights, w, h), 0, "nothing repaired");
  ok(before.every((v, i) => v === heights[i]), "and nothing moved");
  ok(DESPIKE_M > 250, "the threshold sits above real terrain");
});

/* ── reading a tile ──────────────────────────────────────────────────────── */

check("a grid is read bilinearly", () => {
  const size = 4;
  const g = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) g[y * size + x] = x * 100;
  eq(sampleGrid(g, size, 1, 0), 100, "on a post");
  eq(sampleGrid(g, size, 1.5, 0), 150, "between two");
  eq(sampleGrid(g, size, 1.25, 2.5), 125, "and the ramp does not care about y");
});

check("a read outside the tile is clamped, never wrapped", () => {
  const size = 4;
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i += 1) g[i] = i;
  eq(sampleGrid(g, size, -3, -3), g[0], "before the first post");
  eq(sampleGrid(g, size, 99, 99), g[g.length - 1], "past the last");
});

/* ── the two limits, which are different kinds ───────────────────────────── */

check("the cap is where the DATA stops, not where the service does", () => {
  // Measured over High Mountain Asia: z15 carries 0.74 m RMS against its own
  // parent -- the publisher's resampling of 30 m source, at four times the
  // tiles. The service answers there; the pyramid knows nothing new.
  ok(INFO_ZOOM < TERRARIUM.maxZoom, "the information ceiling is below the service's");
  const tiny = { west: -6.201, east: -6.199, south: 54.699, north: 54.701 };
  eq(chooseZoom(tiny, { maxTiles: 64 }), INFO_ZOOM, "a tiny box stops at the cap");
});

check("a view over budget is given a shallower level, never a truncated one", () => {
  const wide = { west: -20, east: 20, south: 30, north: 60 };
  const z = chooseZoom(wide, { maxTiles: 24 });
  ok(tilesForBounds(wide, z).length <= 24, "the chosen level fits the budget");
  ok(tilesForBounds(wide, z + 1).length > 24, "and the next one would not");
});

/**
 * The budget has to bind at the BOTTOM too. A floor of 4 was not a floor, it
 * was a hole: a hemisphere fits nothing at zoom 4 and got zoom 4 regardless —
 * measured on the stand-in's opening view, 54 tiles fetched against a budget
 * of twelve.
 */
check("and a box that fits nothing still respects the budget", () => {
  const hemisphere = { west: -60, east: 60, south: -40, north: 80 };
  const z = chooseZoom(hemisphere, { maxTiles: 12 });
  ok(tilesForBounds(hemisphere, z).length <= 12,
    `${tilesForBounds(hemisphere, z).length} tiles at z${z}`);
});

check("no bounds is no zoom", () => eq(chooseZoom(null), null, "null"));

/* ── what a level is worth on the ground ─────────────────────────────────── */

check("posts are quoted in ground metres, which depend on latitude", () => {
  near(groundMetresPerPixel(0, 0), 156543 / 1, 2, "z0 at the equator");
  // The everest notes quote 17 m at z13 for 28°N and 8.4 m at z14.
  near(groundMetresPerPixel(13, 28), 16.9, 0.4, "z13 at 28°N");
  near(groundMetresPerPixel(14, 28), 8.4, 0.2, "z14 at 28°N");
  ok(groundMetresPerPixel(13, 60) < groundMetresPerPixel(13, 0), "and shrink toward the pole");
});

/* ── the tiling scheme is the tiler's own ────────────────────────────────── */

check("the fractional tile and the whole tile agree", () => {
  const lat = 27.98806; const lon = 86.92528; const z = 13;
  const { x, y } = mercatorTile(lat, lon, z);
  const [tile] = tilesForBounds({ west: lon, east: lon, south: lat, north: lat }, z);
  eq(Math.floor(x), tile.x, "x");
  eq(Math.floor(y), tile.y, "y");
  // Everest's own tile, measured against the live pyramid.
  eq(`${z}/${tile.x}/${tile.y}`, "13/6074/3432", "Everest sits where the service put it");
});

/* ── the rule that keeps two answers from meeting in one sum ─────────────── */

/**
 * The globe is DISPLACED from its own texture. A height read from a 30 m
 * pyramid and a surface drawn from a 19.6 km one are both fine on their own
 * and ruinous mixed inside one calculation -- a pin placed from the first
 * against ground drawn from the second sits under the terrain. So the streamed
 * DEM answers `sampleElevationMeters` (how high is this place) and must never
 * reach `sampleElevationNormalized` (where is the ground drawn).
 */
check("the viewer asks the DEM for heights and never for the drawn surface", () => {
  const src = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
  const meters = src.slice(src.indexOf("function sampleElevationMeters("));
  ok(/GeoIDDem/.test(meters.slice(0, 2600)), "the metres seam consults the streamed DEM");
  const normalized = src.slice(src.indexOf("function sampleElevationNormalized("),
    src.indexOf("function sampleElevationMeters("));
  ok(!/GeoIDDem/.test(normalized), "and the normalized one does not");
});

/* ── three spellings of one box ──────────────────────────────────────────── */

/**
 * This tree says a bounding box three ways, and handing the wrong one to tile
 * maths does not throw: every field reads undefined, the arithmetic goes to
 * NaN, and the cover comes back empty — which reads as a source with no data
 * here. The view follow was doing exactly that until the refusal fired.
 */
check("a box is taken in any of the three vocabularies this tree speaks", () => {
  const want = { west: -6, south: 54, east: -5, north: 55 };
  const same = (got) => JSON.stringify(got) === JSON.stringify(want);
  ok(same(normaliseBounds(want)), "the tilers'");
  ok(same(normaliseBounds({ minX: -6, minY: 54, maxX: -5, maxY: 55 })), "a layer's bounds");
  ok(same(normaliseBounds({ minLon: -6, minLat: 54, maxLon: -5, maxLat: 55 })), "the viewer's");
  eq(normaliseBounds(null), null, "and nothing is nothing");
});

check("anything else is refused loudly, never computed into NaN", () => {
  let threw = "";
  try { normaliseBounds({ left: 1, right: 2 }); } catch (error) { threw = error.message; }
  ok(/minLon/.test(threw), `named the spellings it takes: ${threw}`);
});

/**
 * The shape `visibleBounds` hands back when it cannot answer: an object full
 * of nulls rather than a null. The driver has to see through that, or every
 * settle throws into a callback nobody awaits.
 */
check("a view full of nulls is refused, not read as zero", () => {
  let threw = false;
  try { normaliseBounds({ minLon: null, minLat: null, maxLon: null, maxLat: null }); }
  catch (error) { threw = true; }
  ok(threw, "refused");
  const src = readFileSync(new URL("./dem-stream.js", import.meta.url), "utf8");
  ok(/Number\.isFinite/.test(src), "and the view follow checks for finite fields");
});

/**
 * The driver hands its own box to `viewChangedEnough`, which reads
 * `minLon/maxLon/minLat/maxLat` and NOTHING else — a `west/east` box makes
 * every span NaN, every comparison false, and the stand-in silently never
 * fetches. The tile side takes all three spellings; this side takes one.
 */
check("the view follow speaks the viewer's box vocabulary", () => {
  const src = readFileSync(new URL("./dem-stream.js", import.meta.url), "utf8");
  const box = src.slice(src.indexOf("function viewCentreBox"), src.indexOf("function start"));
  ok(/minLon:/.test(box) && /maxLat:/.test(box), "the centre box is minLon/maxLat");
  ok(!/\bwest:/.test(box), "and not west/east, which viewChangedEnough cannot read");
});

/* ── the world is pinned, or a reader hovers over holes ──────────────────── */

/**
 * Reported as "not mapped correctly, not 100% coverage": the stand-in held the
 * four tiles around the view centre and answered null for every other place on
 * Earth. A reader is the one consumer that cannot live on the view's own
 * tiles — the cursor moves off them constantly.
 */
check("the stand-in covers the world at the texture's own sampling", () => {
  // 64 tiles at zoom 3, and about 19.6 km between posts at the equator: the
  // shipped elevation texture measures 19.6 km, so this is parity everywhere.
  eq(4 ** 3, 64, "a zoom-3 world is 64 tiles");
  near(groundMetresPerPixel(3, 0), 19568, 50, "zoom 3 posts at the equator");
  const src = readFileSync(new URL("./dem-stream.js", import.meta.url), "utf8");
  ok(/ensureWorld\(WORLD_ZOOM\)/.test(src), "and the stand-in asks for it");
  ok(/standingIn\(\)/.test(src.slice(src.indexOf("setTimeout(() => {"))),
    "only where the shipped model cannot be read");
});

check("a pinned tile is never evicted by the view's own", () => {
  const src = readFileSync(new URL("./dem-tiles.js", import.meta.url), "utf8");
  const remember = src.slice(src.indexOf("function remember("), src.indexOf("function held("));
  ok(/if \(pin\)/.test(remember), "the pin short-circuits before the LRU");
  ok(!/MAX_TILES/.test(remember.split("if (pin)")[1].split("\n")[0]),
    "and the eviction loop never sees it");
});

/**
 * The sheet is drawn by `buildRasterLayer`, which reads minX/minY/maxX/maxY.
 * Handed this module's own west/south/east/north, every lat and lon in the
 * patch loop is NaN and `surfacePoint(NaN, NaN)` answers with finite garbage
 * rather than refusing — measured, a mesh at radii 0.45 to 4.05 against a
 * globe of 3.2, which is a sheet up to 1,700 km off the ground.
 */
check("the sheet hands the raster builder the raster's own box shape", () => {
  const src = readFileSync(new URL("./dem-layer.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/minX: bounds\.west/.test(src), "converted at the boundary");
  ok(/buildRasterLayer\(bands, GRID_W, GRID_H, rasterBounds/.test(src),
    "and the converted box is what is passed");
});

/**
 * A cover the cache cannot HOLD is a cover it quietly loses. The Model Builder
 * asked for 256 tiles against a 128-tile cache: over Northern Ireland that
 * planned zoom 11 at ~238 tiles, fetched them all, and evicted the first ~110
 * as the rest arrived -- the western 47% of the island answered null and was
 * filled with the area mean. This is that exact box.
 */
const NI = { west: -8.181141, east: -5.428859, south: 54.017488, north: 55.312512 };
check("the builder's budget, uncapped, is more than the cache can hold", () => {
  const p = planCover(NI, { maxTiles: 256 });
  ok(p.tiles > COVER_CEILING, `the reproduction: ${p.tiles} tiles at zoom ${p.zoom}`);
});
check("a cover is planned against what the cache can hold", () => {
  const { plan, tiles } = coverFor(NI, { maxTiles: 256 });
  ok(tiles.length <= COVER_CEILING, `${tiles.length} tiles > ${COVER_CEILING}`);
  ok(plan.zoom === 10, `zoom ${plan.zoom}, want 10 for this box`);
});
check("with headroom for the view's own settle", () => {
  const src = readFileSync(new URL("./dem-tiles.js", import.meta.url), "utf-8");
  const max = Number(src.match(/const MAX_TILES = (\d+)/)[1]);
  ok(COVER_CEILING <= max - 12, `ceiling ${COVER_CEILING} leaves no room in ${max} for the view's 12`);
});
check("the ceiling is checked on the PADDED list", () => {
  // Pick a box that fits the ceiling unpadded at some zoom and let the pad
  // tip it: whatever comes back must still fit.
  for (const span of [0.5, 1, 2, 3, 5]) {
    const box = { west: -7, east: -7 + span, south: 54, north: 54 + span * 0.6 };
    const { tiles } = coverFor(box, { maxTiles: 999 });
    ok(tiles.length <= COVER_CEILING, `span ${span}: ${tiles.length}`);
  }
});
check("ensure reports what is still HELD, not only what arrived", () => {
  const src = readFileSync(new URL("./dem-tiles.js", import.meta.url), "utf-8");
  ok(/held: kept/.test(src) && /coverFor\(bounds, options\)/.test(src), "ensure must go through coverFor and count held tiles");
});


/* ── despikePoints: the fast version answers exactly as the sorting one ──── */
check("despikePoints (fast) is identical to the sorting version, and faster", () => {
  // The previous implementation, kept here as the reference.
  const reference = (heights, width, height, floor = POINT_SPIKE_M) => {
    let repaired = 0, filled = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      const src = Float32Array.from(heights);
      const nb = [];
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const i = (y * width) + x;
        nb.length = 0;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const v = src[(yy * width) + xx];
          if (v >= -12000) nb.push(v);
        }
        if (nb.length < 3) continue;
        nb.sort((a, b) => a - b);
        const mid = nb.length >> 1;
        const median = nb.length % 2 ? nb[mid] : (nb[mid - 1] + nb[mid]) / 2;
        const v = src[i];
        if (!(v >= -12000)) { heights[i] = median; filled += 1; continue; }
        if (pass) continue;
        const spread = nb[nb.length - 1] - nb[0];
        if (Math.abs(v - median) > Math.max(floor, 3 * spread)) { heights[i] = median; repaired += 1; }
      }
    }
    return { repaired, filled };
  };
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let same = true, cases = 0, tFast = 0, tRef = 0;
  for (let c = 0; c < 12; c += 1) {
    const N = c < 10 ? 64 : 256;
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
      h[y * N + x] = 400 * Math.sin(x / (7 + c)) * Math.cos(y / (9 + c)) + (x > N * 0.6 ? 900 : 0) + rnd() * 20 * (c % 4);
    }
    for (let k = 0; k < N * N / 200 * (1 + c % 3); k += 1) {
      const i = Math.floor(rnd() * N * N), r = rnd();
      h[i] = r < 0.4 ? h[i] + (rnd() - 0.5) * 3000 : r < 0.7 ? -32768 : h[i] + (rnd() - 0.5) * 200;
    }
    const a = Float32Array.from(h), b = Float32Array.from(h);
    let t = performance.now(); const ra = despikePoints(a, N, N); tFast += performance.now() - t;
    t = performance.now(); const rb = reference(b, N, N); tRef += performance.now() - t;
    if (ra.repaired !== rb.repaired || ra.filled !== rb.filled || a.some((v, i) => v !== b[i])) same = false;
    cases += 1;
  }
  eq(same, true, `fast despikePoints is identical to the sorting version on ${cases} spiky, voided grids`);
  eq(tFast < tRef, true, `...and faster (${tFast.toFixed(0)} ms against ${tRef.toFixed(0)} ms)`);
  console.log(`     fast ${tFast.toFixed(0)} ms, sorting ${tRef.toFixed(0)} ms over ${cases} grids`);
});

/* ── isolated spikes and voids (despikePoints) ───────────────────────────── */

// Real relief: El Capitan, 1,284 to 2,296 m across a 64-post crop, with
// post-to-post steps up to 213 m -- steeper than the 150 m floor, so it is the
// neighbours' own spread that must keep it.
const elcap = JSON.parse(readFileSync(new URL("./dem-tiles.fixture-elcap.json", import.meta.url), "utf8"));
check("a real granite face survives untouched", () => {
  const h = Float32Array.from(elcap.heights);
  const r = despikePoints(h, elcap.size, elcap.size);
  eq(r.repaired, 0, "posts repaired on El Capitan");
  ok(h.every((v, i) => v === elcap.heights[i]), "a real height changed");
});
check("a single spike planted on the same ground is removed, and only it", () => {
  const h = Float32Array.from(elcap.heights);
  const i = (20 * elcap.size) + 30;
  const truth = h[i];
  h[i] += 512;                                   // two red-byte steps of 256 m
  const r = despikePoints(h, elcap.size, elcap.size);
  eq(r.repaired, 1, "posts repaired");
  near(h[i], truth, 60, "the spike post back near the ground");
  ok(h.every((v, k) => k === i || v === elcap.heights[k]), "a neighbour was changed");
});
check("a pit is removed the same way", () => {
  const h = Float32Array.from(elcap.heights);
  const i = (40 * elcap.size) + 12;
  h[i] -= 400;
  eq(despikePoints(h, elcap.size, elcap.size).repaired, 1, "posts repaired");
});
check("a summit a few tens of metres above its shoulders is kept", () => {
  const h = new Float32Array(25).fill(1000);
  h[12] = 1000 + POINT_SPIKE_M - 10;
  eq(despikePoints(h, 5, 5).repaired, 0, "summit repaired");
});
check("a synthetic 900 m cliff keeps every post", () => {
  const w = 16, h = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) h[y * w + x] = x < 8 ? 100 : 1000;
  eq(despikePoints(h, w, w).repaired, 0, "cliff posts repaired");
});
check("no-data posts are filled from their neighbours", () => {
  const h = Float32Array.from(elcap.heights);
  const i = (10 * elcap.size) + 10, j = i + 1;
  h[i] = h[j] = -32768;
  const r = despikePoints(h, elcap.size, elcap.size);
  ok(r.filled >= 2, `filled ${r.filled}`);
  ok(h[i] > 1000 && h[j] > 1000, "hole still deep");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
