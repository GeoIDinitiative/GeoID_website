/**
 * REAL ELEVATION, streamed the way the geology is.
 *
 * The globe's own elevation is one shipped texture, and its native sampling on
 * Earth measures **19.6 km** — so a 10 km study area is a fraction of one pixel
 * of it, and every product downstream (the terrain raster, the Model Builder's
 * surface, the extraction's elevation column, the cursor readout) inherits that
 * whether or not it says so. This module answers the same question from a
 * multiresolution pyramid instead, over the ground actually being asked about.
 *
 * THE SOURCE IS MAPZEN TERRAIN TILES on AWS Open Data — keyless, CORS-open,
 * and already used by this repo's Everest viewer, which is where the honest
 * ceiling below was measured rather than assumed.
 *
 * WHAT THIS IS NOT. It does not move the drawn globe. The sphere is displaced
 * from its own texture and everything that must agree with the DRAWN surface --
 * `surfacePoint`, the drapes, a vector layer's baked `aDisp` -- goes on reading
 * that texture. Answering "how high is this place" from one source and "where
 * is the ground drawn" from another is fine; answering them inconsistently in
 * the SAME calculation is what puts a pin under the terrain. So the seam this
 * feeds is `sampleElevationMeters`, never `sampleElevationNormalized`.
 */

import { tilesForBounds, tileCountForBounds, mercatorTile } from "./mvt.js?v=20260905-f8b2b19";

/**
 * Terrarium: height packed into RGB, EGM96 metres.
 *
 * `maxZoom` is where the SERVICE stops (measured: 200 through z15, 404 at
 * z16). `infoZoom` is where the DATA stops, which is a different number and
 * the one worth honouring -- see `chooseZoom`.
 */
export const TERRARIUM = {
  id: "terrarium",
  url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  size: 256,
  maxZoom: 15,
  infoZoom: 14,
  credit: "Elevation: Mapzen Terrain Tiles / AWS Open Data — SRTM, ASTER, GMTED, "
    + "ETOPO1 and national sources.",
  licence: "Public domain / CC-BY by source; attribution required.",
};

/** height = (R·256 + G + B/256) − 32768, metres above the EGM96 geoid. */
export function decodeTerrarium(r, g, b) {
  return (r * 256) + g + (b / 256) - 32768;
}

/**
 * A pyramid that SERVES a level does not have data at that level.
 *
 * Measured over High Mountain Asia by subtracting each level from a bilinear
 * upsample of its parent (everest/tools/dem_information.mjs), which leaves
 * whatever that level actually knows:
 *
 *     z11  67 m/px   30.07 m RMS   real detail
 *     z12  34 m/px   11.79 m       real detail
 *     z13  17 m/px    7.69 m       real detail
 *     z14  8.4 m/px   1.26 m       marginal
 *     z15  4.2 m/px   0.74 m       interpolation, nothing more
 *
 * The source is 30 m SRTM/ASTER over most of the world, so asking for z15 buys
 * a quarter of the tiles' worth of the publisher's own resampling. The cap is
 * z14 -- one past where the information runs out, because a slightly-too-fine
 * grid keeps a sampler smooth, and two past it is just bandwidth.
 */
export const INFO_ZOOM = TERRARIUM.infoZoom;

/**
 * A single corrupt scanline sits at exactly 28.0000°N, about 8,150 m below its
 * neighbours, and it is present in every tile along that parallel -- straight
 * through the Everest Base Camp approach, which is how it was found. Anything
 * further than this from the median of its vertical neighbours is that
 * artifact: 300 m is well above real terrain change across one post and far
 * below the 8,150 m the artifact moves.
 */
export const DESPIKE_M = 300;

/**
 * Pure: repair the scanline artifact in a decoded tile, in place.
 *
 * A post is the artifact only when it differs from the row above AND the row
 * below, past the threshold, IN THE SAME DIRECTION. Comparing against the
 * midpoint of the two instead — the obvious version — flattens the artifact's
 * NEIGHBOURS as well: a good row sitting between real ground and an 8,150 m
 * hole is 4,075 m from their midpoint, so the repair spreads to three rows and
 * takes real terrain with it. Measured on a planted spike: 24 posts rewritten
 * where 8 were wrong.
 *
 * Read from a snapshot, so a repair cannot become the evidence for the next
 * one, and a two-sided test keeps a cliff — where the differences have
 * opposite signs — exactly as the source drew it.
 */
export function despike(heights, width, height, threshold = DESPIKE_M) {
  const source = Float32Array.from(heights);
  let repaired = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width) + x;
      const above = source[i - width];
      const below = source[i + width];
      const dAbove = source[i] - above;
      const dBelow = source[i] - below;
      const outlier = Math.abs(dAbove) > threshold && Math.abs(dBelow) > threshold
        && Math.sign(dAbove) === Math.sign(dBelow);
      if (outlier) {
        heights[i] = (above + below) / 2;
        repaired += 1;
      }
    }
  }
  return repaired;
}

/** Pure: bilinear read of a square grid at fractional pixel coordinates. */
export function sampleGrid(heights, size, px, py) {
  const x = Math.max(0, Math.min(size - 1, px));
  const y = Math.max(0, Math.min(size - 1, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const at = (sx, sy) => heights[(sy * size) + sx];
  return (
    at(x0, y0) * (1 - tx) * (1 - ty)
    + at(x1, y0) * tx * (1 - ty)
    + at(x0, y1) * (1 - tx) * ty
    + at(x1, y1) * tx * ty
  );
}

/**
 * A BOX, in either vocabulary this tree speaks.
 *
 * The tilers say `west/south/east/north`, everything descended from a layer's
 * `bounds` says `minX/minY/maxX/maxY`, and the VIEWER says
 * `minLon/minLat/maxLon/maxLat`. Handed the wrong one nothing
 * throws: every field reads `undefined`, the tile maths goes to NaN, and the
 * cover comes back empty — which reads as a source with no data here. Taken at
 * this one door, and anything else refused loudly, the way `drape()` learned
 * to after a whole verify loop was spent on it.
 */
export function normaliseBounds(box) {
  if (!box) return null;
  /**
   * `Number(null)` IS 0, and so is `Number("")`.
   *
   * This tree has been to 0°N 0°E before, on a station list whose blank
   * latitudes came back as real stations. `visibleBounds` answers with an
   * object full of NULLS when it cannot see the globe, so a coercing read
   * turns "I do not know where you are looking" into a study of the Gulf of
   * Guinea — silently, and at the right number of tiles. An absent field is
   * NaN here, which the check below refuses.
   */
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const read = () => {
    if (Number.isFinite(num(box.north))) {
      return { west: num(box.west), south: num(box.south), east: num(box.east), north: num(box.north) };
    }
    if (Number.isFinite(num(box.maxX))) {
      return { west: num(box.minX), south: num(box.minY), east: num(box.maxX), north: num(box.maxY) };
    }
    // The viewer's own, which `visibleBounds` answers in. Three spellings of
    // one box in one tree, and this one was found by the refusal below firing
    // on the view follow -- which had been handing it straight through and
    // would have computed NaN tiles in silence.
    return { west: num(box.minLon), south: num(box.minLat), east: num(box.maxLon), north: num(box.maxLat) };
  };
  const n = read();
  const finite = Object.values(n).every((v) => Number.isFinite(v));
  if (!finite) {
    throw new Error("A bounds needs west/south/east/north, minX/minY/maxX/maxY or minLon/minLat/maxLon/maxLat.");
  }
  return n;
}

/**
 * How deep to go for this ground, weighed BEFORE anything is fetched.
 *
 * Two limits, and they are not the same kind: `cap` is where the data stops
 * telling you anything new, and `maxTiles` is what the answer costs. A view
 * over budget is given a shallower level rather than a truncated one -- the
 * tiler's own lesson, where slicing the list painted part of the view sharply
 * and abandoned the rest.
 */
export function chooseZoom(box, { maxTiles = 24, cap = INFO_ZOOM, min = 1 } = {}) {
  const bounds = normaliseBounds(box);
  if (!bounds) return null;
  for (let z = cap; z >= min; z -= 1) {
    // COUNTED, not listed: this walks down from the cap, and a wide box at a
    // deep zoom is millions of tiles to build and throw away.
    if (tileCountForBounds(bounds, z) <= maxTiles) return z;
  }
  /**
   * The floor was 4, which is not a floor but a HOLE in the budget: a box
   * nothing fits gets zoom 4 anyway, and a hemisphere at zoom 4 is 36 tiles
   * against a budget of 12 — measured on the stand-in's opening view, 54 tiles
   * fetched where a dozen were allowed. Going all the way down to 1 means the
   * budget always binds, and a box that wants less than one tile of the world
   * is not a box worth arguing about.
   */
  return min;
}

/** What a level would cost over this ground, said before the press. */
export function planCover(box, options = {}) {
  const bounds = normaliseBounds(box);
  const zoom = chooseZoom(bounds, options);
  if (zoom === null) return { ok: false, error: "No ground given." };
  const tiles = tilesForBounds(bounds, zoom);
  const have = tiles.filter((t) => held(keyOf(t))).length;
  const metres = groundMetresPerPixel(zoom, (bounds.north + bounds.south) / 2);
  return {
    ok: true,
    zoom,
    tiles: tiles.length,
    cached: have,
    fetches: tiles.length - have,
    metresPerPixel: metres,
    summary: tiles.length - have === 0
      ? `zoom ${zoom}, about ${Math.round(metres)} m posts, already held`
      : `zoom ${zoom}, about ${Math.round(metres)} m posts, ${tiles.length - have} tiles to fetch`,
  };
}

/** Ground metres per DEM post at a zoom and latitude. */
export function groundMetresPerPixel(zoom, latDegrees = 0) {
  const equator = 40075016.686;
  return (equator * Math.cos((latDegrees * Math.PI) / 180)) / (2 ** zoom) / TERRARIUM.size;
}

/* ── the cache, and the fetch ────────────────────────────────────────────── */

const keyOf = ({ z, x, y }) => `${z}/${x}/${y}`;

/**
 * Decoded tiles, newest-used last. A 256-square Float32Array is 262 kB, so the
 * cap is memory rather than politeness: 128 tiles is about 34 MB, which holds
 * two study areas at working zoom plus whatever the view has pulled. Measured
 * at 96 it was too small for the job — a 0.24 x 0.18 degree box is 36 tiles,
 * so a second area evicted the first and every height in it went quietly back
 * to the shipped texture.
 */
const CACHE = new Map();
/**
 * THE WORLD IS PINNED, or the globe has holes in it.
 *
 * The same rule the geology tiler already lives by: a layer that only holds
 * what the view asked for has nothing anywhere else, and for a READER that is
 * the difference between a height and "n/a" every time the cursor moves off
 * the patch last fetched. Reported exactly that way — "not 100% coverage".
 *
 * Pinned tiles are never evicted, so the view's own tiles cannot push the
 * world out and leave a reader hovering over a hole.
 */
const PINNED = new Map();
/**
 * WHICH ZOOMS ARE HELD, kept because `heightAt` is called half a million times
 * a rebuild and the loop below it was walking sixteen levels to find two.
 *
 * Measured before this existed: 2.14 microseconds a sample, so a 1,024 x 512
 * grid cost **1,120 ms of main thread** -- per sheet, on every settle, which
 * is a camera that fights you all the way down. Fourteen of those sixteen
 * iterations built a `z/x/y` string and missed two Maps with it.
 */
const HELD_ZOOMS = new Set();
let zoomsDeep = [];

function noteZoom(z) {
  if (HELD_ZOOMS.has(z)) return;
  HELD_ZOOMS.add(z);
  zoomsDeep = [...HELD_ZOOMS].sort((a, b) => b - a);
}

const INFLIGHT = new Map();
const MAX_TILES = 128;

let blocked = false;

function remember(key, tile, pin = false) {
  noteZoom(tile.z);
  if (pin) { PINNED.set(key, tile); return; }
  CACHE.delete(key);
  CACHE.set(key, tile);
  while (CACHE.size > MAX_TILES) CACHE.delete(CACHE.keys().next().value);
}

/** Held either way: the view's tiles and the pinned world are one lookup. */
function held(key) {
  return CACHE.get(key) || PINNED.get(key) || null;
}

function urlFor({ z, x, y }) {
  return TERRARIUM.url.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

/**
 * One tile, decoded to heights.
 *
 * `crossOrigin = "anonymous"` is what makes the pixels READABLE: without it
 * the image loads, taints the canvas, and `getImageData` throws — the same
 * wall the Mars textures hit from the other side when they moved to a bucket.
 * The bucket answers `Access-Control-Allow-Origin: *`, measured, so an
 * anonymous request is all it needs.
 */
function loadTile(tile, pin = false) {
  const key = keyOf(tile);
  const already = held(key);
  if (already) return Promise.resolve(already);
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const pending = new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = TERRARIUM.size;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        const heights = new Float32Array(size * size);
        for (let i = 0; i < heights.length; i += 1) {
          heights[i] = decodeTerrarium(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        }
        despike(heights, size, size);
        const record = { ...tile, size, heights };
        remember(key, record, pin);
        resolve(record);
      } catch (error) {
        // A tainted canvas or a decode failure is a MISS, never a wrong height.
        resolve(null);
      }
    };
    // A 404 past the pyramid's edge is an ordinary answer, not a fault.
    image.onerror = () => resolve(null);
    image.src = urlFor(tile);
  }).finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, pending);
  return pending;
}

/**
 * Fetch what covers this ground, and say what it cost.
 *
 * A MARGIN OF A FEW POSTS is taken, not of a tile.
 *
 * The margin exists because a slope is read from four samples a few metres
 * apart: a stencil straddling the edge of the covered area with only one side
 * streamed would mix a 30 m height with a 19.6 km one and call the difference
 * a gradient. Padding by a whole tile in every direction answers that and
 * costs far more than the fault is worth — measured on a 0.24 x 0.18 degree
 * box, 36 tiles became 64. Padding the BOUNDS by a few posts adds a row only
 * where the box genuinely sits near an edge, and the stencil is a few metres
 * wide, not a few kilometres.
 */
export async function ensure(box, options = {}) {
  const bounds = box ? normaliseBounds(box) : null;
  if (blocked || !bounds) return { ok: false, reason: blocked ? "unreachable" : "no bounds" };
  const plan = planCover(bounds, options);
  if (!plan.ok) return plan;
  const padDegrees = (4 * 360) / (2 ** plan.zoom) / TERRARIUM.size;
  const tiles = tilesForBounds({
    west: bounds.west - padDegrees,
    east: bounds.east + padDegrees,
    south: Math.max(-85.0511, bounds.south - padDegrees),
    north: Math.min(85.0511, bounds.north + padDegrees),
  }, plan.zoom);
  const results = await Promise.all(tiles.map((t) => loadTile(t)));
  const got = results.filter(Boolean).length;
  // Nothing at all came back for a whole cover: the source is unreachable
  // (offline, or an origin the bucket will not answer). Say so once and stop
  // asking, rather than failing every sample silently for the rest of the
  // session.
  if (!got && tiles.length) blocked = true;
  return { ...plan, ok: got > 0, requested: tiles.length, got, blocked };
}

/**
 * How high is this place, in metres, or null if nothing streamed covers it.
 *
 * Null is the important half of the contract: the caller falls back to the
 * globe's own texture, so a place nobody has fetched behaves exactly as it did
 * before this module existed.
 *
 * The FINEST cached tile wins, which is what makes a study area fetched at z14
 * answer at 8 m while the view around it answers at whatever the settle pulled.
 */
export function heightAt(lat, lon) {
  if ((!CACHE.size && !PINNED.size) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const wrapped = (((Number(lon) + 180) % 360) + 360) % 360 - 180;
  // Deepest first, and only the levels something is actually held at.
  for (const z of zoomsDeep) {
    const { x, y } = mercatorTile(lat, wrapped, z);
    const tile = held(keyOf({ z, x: Math.floor(x), y: Math.floor(y) }));
    if (!tile) continue;
    const px = (x - Math.floor(x)) * tile.size;
    const py = (y - Math.floor(y)) * tile.size;
    return sampleGrid(tile.heights, tile.size, px, py);
  }
  return null;
}

/**
 * The post spacing of the finest tile HELD over this point, in ground metres,
 * or null where nothing is held.
 *
 * This is a fact about the pyramid rather than an inference from the shape of
 * the field. The probe that answers the same question for the shipped texture
 * looks for curvature kinks in what the sampler returns — right when the only
 * way to know is to interrogate a black box, and easily fooled by rough
 * ground: over the Mournes at 11 m posts it reported 1,306 m. When the streamed
 * DEM is what answered, the spacing is simply known.
 */
export function postMetresAt(lat, lon) {
  if ((!CACHE.size && !PINNED.size) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const wrapped = (((Number(lon) + 180) % 360) + 360) % 360 - 180;
  for (const z of zoomsDeep) {
    const { x, y } = mercatorTile(lat, wrapped, z);
    if (held(keyOf({ z, x: Math.floor(x), y: Math.floor(y) }))) {
      return groundMetresPerPixel(z, lat);
    }
  }
  return null;
}

/** What the sampler is currently holding, for a status line or a test. */
export function state() {
  const zooms = {};
  const count = (tile) => { zooms[tile.z] = (zooms[tile.z] || 0) + 1; };
  CACHE.forEach(count);
  PINNED.forEach(count);
  return {
    tiles: CACHE.size + PINNED.size, pinned: PINNED.size, zooms, blocked,
    credit: TERRARIUM.credit,
  };
}

/** Forget everything held. Only a test or a source change should need this. */
export function reset() {
  CACHE.clear();
  PINNED.clear();
  HELD_ZOOMS.clear();
  zoomsDeep = [];
  INFLIGHT.clear();
  blocked = false;
}

/**
 * Cover the WHOLE world once, at a level a reader can live on.
 *
 * Measured against the texture this stands in for: `earth_elevation_sampler.png`
 * is 21 MB for 19.6 km sampling, and a zoom-3 world is 64 tiles and about
 * 5.8 MB for the same 19.6 km — parity, at a quarter of the bytes, on any
 * origin. Zoom 4 would double the resolution and cost 256 tiles and 21 MB,
 * which is the texture's own price and more RAM than the cache should hold;
 * the view follow buys that detail where somebody is actually looking instead.
 *
 * Fetched a few at a time. Sixty-four requests in one breath at somebody
 * else's bucket is not how this tree asks for tiles.
 */
export async function ensureWorld(zoom = 3, { concurrency = 6 } = {}) {
  if (blocked) return { ok: false, reason: "unreachable" };
  const scale = 2 ** zoom;
  const tiles = [];
  for (let x = 0; x < scale; x += 1) for (let y = 0; y < scale; y += 1) tiles.push({ z: zoom, x, y });
  const queue = tiles.filter((t) => !held(keyOf(t)));
  let got = PINNED.size;
  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency);
    // eslint-disable-next-line no-await-in-loop
    const done = await Promise.all(batch.map((t) => loadTile(t, true)));
    got += done.filter(Boolean).length;
  }
  if (!got && tiles.length) blocked = true;
  return {
    ok: got > 0,
    zoom,
    tiles: tiles.length,
    got,
    metresPerPixel: groundMetresPerPixel(zoom, 0),
  };
}
