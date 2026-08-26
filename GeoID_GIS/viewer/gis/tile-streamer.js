/**
 * Multi-resolution tile streaming for the Earth globe.
 *
 * Ported from the design the Mars flight sim arrived at
 * (`flight_sim/mars/viewer/STREAMING-DESIGN.md`), which is worth reading before
 * changing anything here: it is a record of what was tried and what broke, and
 * its section 5 lists traps that have already been paid for once.
 *
 * **What is taken.** Coarse-to-fine rings painted into a canvas; one scheduler
 * with a single in-flight budget; an LRU cache with request coalescing; the
 * coarse-under-fine paint guard; retire-don't-abort; an ancestor fallback floor
 * of target−4.
 *
 * **What is deliberately not.** The flight sim anchors its rings to a ship with
 * a heading and a speed, and biases prefetch along the velocity vector. An orbit
 * camera has no heading and stops between moves, so that machinery would model
 * something this viewer does not have. Rings here are levels over one visible
 * extent, not a window dragged across the ground.
 *
 * **The trap that shaped it** (design doc §5, first line): a per-tile mesh
 * quadtree "drowned the old fork". So tiles are composited into a canvas and the
 * canvas is one texture on one mesh — the visual result of a quadtree at a
 * fraction of the cost. Do not reintroduce a mesh per tile.
 */

import { TILE_SOURCES, tileUrl } from "./tile-sources.js?v=20260826-8b90f9b";

/** Six at a time: HTTP/1.1 gives about that per host, and it is polite. */
const MAX_INFLIGHT = 6;
/**
 * How far below the target a ring may fall back.
 *
 * Four levels is a sixteenth of the linear resolution, which still reads as
 * detail against a 9.8 km/px basemap, and it bounds the work: the coarsest ring
 * of a 256-tile target is a single tile.
 */
export const ANCESTOR_FLOOR = 4;
/** Decoded images, not bytes. The HTTP cache already has the bytes. */
const CACHE_LIMIT = 768;

// ── The cache ────────────────────────────────────────────────────────────────

const cache = new Map();      // url -> HTMLImageElement | null (null = known bad)
const inflight = new Map();   // url -> Promise, shared between callers

/**
 * One request per URL, however many rings want it.
 *
 * **The shared promise is never cancellable by a caller** — design doc §5, "any
 * shared fetch cancellable by a single caller". Two rings routinely want the
 * same tile, and letting whichever one is retired first abort it strands the
 * other. Retirement stops *scheduling*; it never stops a request already made,
 * which then lands in the cache and makes the next pass instant.
 */
export function fetchTile(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (inflight.has(url)) return inflight.get(url);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    // A missing tile is a hole, not a failure. Remembered as null so a dead
    // rung is not asked for again on every pass.
    img.onerror = () => resolve(null);
    img.src = url;
  }).then((img) => {
    inflight.delete(url);
    if (cache.size >= CACHE_LIMIT) {
      // Map keeps insertion order, so the first key is the oldest.
      cache.delete(cache.keys().next().value);
    }
    cache.set(url, img);
    return img;
  });

  inflight.set(url, promise);
  return promise;
}

/** What is already decoded, for an instant repaint before anything is asked for. */
export function cachedTile(url) {
  return cache.get(url) || null;
}

export function cacheStats() {
  return { cached: cache.size, inflight: inflight.size, limit: CACHE_LIMIT };
}

export function clearTileCache() {
  cache.clear();
  inflight.clear();
}

// ── Rings ────────────────────────────────────────────────────────────────────

/**
 * The levels to paint, coarsest first.
 *
 * Coarsest first is the whole point: the target ring of a close view is 256
 * tiles and takes seconds, while target−4 is a handful and lands in a moment.
 * Painting that first means the ground is plausible almost immediately and
 * sharpens, rather than being blank and then perfect.
 */
export function ringLevels(targetZoom, { floor = ANCESTOR_FLOOR, min = 0 } = {}) {
  const levels = [];
  for (let z = Math.max(min, targetZoom - floor); z <= targetZoom; z += 1) levels.push(z);
  return levels;
}

/**
 * Work queued coarsest-first, and centre-out within a level.
 *
 * One queue rather than one per ring — design doc P1, "merge the surround drain
 * into the focus drain as priority classes". Separate queues competed for the
 * same six connections and neither could reason about the total.
 */
export function orderWork(items) {
  return items.slice().sort((a, b) => (a.level - b.level) || (a.distance - b.distance));
}

/**
 * Never paint a coarser tile over a finer one.
 *
 * Rings are requested coarse-first but they do not *land* in order — a cached
 * fine tile resolves immediately while a coarse one is still on the wire. The
 * doc calls this the coarse-under-fine paint guard; without it the picture
 * visibly degrades as a late coarse tile lands on sharp ground.
 *
 * Coverage is tracked on the target level's grid, so a tile at level L claims
 * the 4^(target-L) cells it spans. A tile is skipped outright if anything finer
 * already holds any of its cells: partial painting would need clipping, and
 * losing one coarse tile under detail costs nothing.
 */
export function makePaintGuard(targetZoom) {
  const held = new Map();                       // "x,y" at target level -> level
  return {
    claim(level, x, y) {
      const scale = 2 ** (targetZoom - level);
      const x0 = x * scale;
      const y0 = y * scale;
      for (let dx = 0; dx < scale; dx += 1) {
        for (let dy = 0; dy < scale; dy += 1) {
          if ((held.get(`${x0 + dx},${y0 + dy}`) ?? -1) > level) return false;
        }
      }
      for (let dx = 0; dx < scale; dx += 1) {
        for (let dy = 0; dy < scale; dy += 1) {
          held.set(`${x0 + dx},${y0 + dy}`, level);
        }
      }
      return true;
    },
    get size() { return held.size; },
  };
}

// ── The pass ─────────────────────────────────────────────────────────────────

const TILE_PX = 256;

/**
 * Paint every ring for `bbox` into `canvas`, coarsest first.
 *
 * The canvas is the box exactly, as `tileGrid` builds it, so a tile at any level
 * lands at `tilePixel * 2^(target-level) - origin` scaled by the same factor —
 * one formula for every ring, which is what keeps the seams integer-aligned.
 *
 * `shouldContinue` is the retire hook. It is consulted before **scheduling**,
 * never to cancel: a request already made runs to completion and lands in the
 * cache, so the next pass over that ground starts from it. Aborting instead
 * would throw away work already paid for and strand any other ring sharing it.
 */
export async function streamRings(canvas, bbox, sourceName, {
  targetZoom,
  grid,                       // tileGrid(bbox, targetZoom) from basemap-drape
  tileGridAt,                 // (bbox, z) => grid, injected to avoid a cycle
  onPaint,
  shouldContinue = () => true,
  maxInflight = MAX_INFLIGHT,
} = {}) {
  const source = TILE_SOURCES[sourceName];
  if (!source || !canvas || !grid) return { painted: 0, requested: 0, fromCache: 0 };
  const ctx = canvas.getContext("2d");
  const guard = makePaintGuard(targetZoom);
  const levels = ringLevels(targetZoom, { min: 1 });

  // Build the whole work list up front so one queue can order it.
  const work = [];
  for (const level of levels) {
    const g = tileGridAt(bbox, level);
    const cx = (g.x0 + g.x1) / 2;
    const cy = (g.y0 + g.y1) / 2;
    const span = 2 ** level;
    for (let ty = g.y0; ty <= g.y1; ty += 1) {
      if (ty < 0 || ty >= span) continue;
      for (let tx = g.x0; tx <= g.x1; tx += 1) {
        work.push({
          level, tx, ty, g,
          // Centre-out: what someone is looking at should sharpen first.
          distance: Math.hypot(tx - cx, ty - cy),
        });
      }
    }
  }

  const queue = orderWork(work);
  let painted = 0;
  let requested = 0;
  let fromCache = 0;

  const paint = (job, img) => {
    if (!img) return;
    if (!guard.claim(job.level, job.tx, job.ty)) return;
    // Every level is expressed in the target grid's pixels, so the scale factor
    // is the only thing that changes between rings.
    const scale = 2 ** (targetZoom - job.level);
    const size = TILE_PX * scale;
    ctx.drawImage(
      img,
      job.tx * size - grid.pxMin,
      job.ty * size - grid.pyMin,
      size, size,
    );
    painted += 1;
    onPaint?.(painted, queue.length, canvas, job.level);
  };

  // Instant repaint from cache before a single request is made, so returning to
  // ground already seen is immediate rather than merely fast.
  for (const job of queue) {
    const hit = cachedTile(tileUrl(sourceName, job.level, wrap(job.tx, job.level), job.ty));
    if (hit) { paint(job, hit); fromCache += 1; }
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(maxInflight, queue.length) }, async () => {
    while (next < queue.length) {
      if (!shouldContinue()) return;            // retire: stop scheduling, abort nothing
      const job = queue[next++];
      const url = tileUrl(sourceName, job.level, wrap(job.tx, job.level), job.ty);
      if (cachedTile(url)) continue;            // already painted above
      requested += 1;
      const img = await fetchTile(url);
      if (!shouldContinue()) return;
      paint(job, img);
    }
  });
  await Promise.all(workers);
  return { painted, requested, fromCache, levels, queued: queue.length };
}

/** Longitude wraps; a tile column outside the world is the same one round. */
function wrap(x, level) {
  const span = 2 ** level;
  return ((x % span) + span) % span;
}
