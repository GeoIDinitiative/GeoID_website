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
 * coarse-under-fine paint guard; an ancestor fallback floor of target−4.
 *
 * **Retire-don't-abort, refined.** A shared request is still never cancelled by
 * ONE caller. It is cancelled when NO caller wants it any more -- interest is
 * counted per pass (`claimTile` / `releaseOwner`) -- because that is exactly
 * the request a pan leaves behind, and left alone it holds the budget the new
 * view's tiles are waiting for.
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

import { TILE_SOURCES, tileUrl } from "./tile-sources.js?v=20261024-9268a02";

/**
 * How many tile requests may be on the wire at once, across EVERY pass.
 *
 * Twelve, up from six. Six was the HTTP/1.1 per-host ceiling, and every tile
 * host this streams from (EOX, GIBS, OSM, Esri) answers over HTTP/2, where one
 * connection multiplexes as many streams as we care to open -- so six was a
 * self-imposed roof, and at ~150 ms a tile it held a 256-tile view to about
 * forty tiles a second. Twelve is still polite to a free service, and it is a
 * GLOBAL budget: superseded passes do not each get twelve of their own.
 */
export const MAX_INFLIGHT = 12;
/**
 * How far below the target a ring may fall back.
 *
 * Four levels is a sixteenth of the linear resolution, which still reads as
 * detail against a 9.8 km/px basemap, and it bounds the work: the coarsest ring
 * of a 256-tile target is a single tile.
 */
export const ANCESTOR_FLOOR = 4;
/**
 * Decoded images, not bytes -- the HTTP cache already has the bytes. A true
 * LRU: a hit moves the tile to the young end, so panning back and forth over
 * the same ground keeps it, and what is evicted is what nobody has looked at
 * for longest. 640 decoded 256 px tiles is ~170 MB at worst, about two full
 * passes plus their ancestors.
 */
export const CACHE_LIMIT = 640;

// ── The cache ────────────────────────────────────────────────────────────────

const cache = new Map();      // url -> image | null (null = known bad), LRU order
const inflight = new Map();   // url -> entry (see claimTile), shared between callers

function remember(url, img) {
  if (cache.has(url)) cache.delete(url);
  cache.set(url, img);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

/** What is already decoded, for an instant repaint before anything is asked for. */
export function cachedTile(url) {
  if (!cache.has(url)) return null;
  const img = cache.get(url);
  // Touch: an LRU, not a FIFO -- ground being looked at again stays warm.
  cache.delete(url);
  cache.set(url, img);
  return img;
}

export function cacheStats() {
  return { cached: cache.size, inflight: inflight.size, active, limit: CACHE_LIMIT };
}

export function clearTileCache() {
  cache.clear();
  inflight.clear();
  active = 0;
}

// ── One scheduler, one budget, interest counted per request ─────────────────

/**
 * A REQUEST IS CANCELLED ONLY WHEN NOBODY WANTS IT -- never by one caller.
 *
 * Design doc section 5: "any shared fetch cancellable by a single caller"
 * strands every other ring that wanted the same tile. That rule stands. What
 * it never forbade is cancelling a request NO caller wants any more, and that
 * is the request that matters when somebody pans: the previous view's 200
 * target tiles, still queued or on the wire, for ground that has left the
 * screen. Left alone they hold the whole budget for seconds while the new
 * view's tiles wait behind them -- which presents as "I have to zoom out and
 * back in to see the new place".
 *
 * So each pass is an OWNER holding interest in the tiles it asked for. A tile's
 * request lives while any owner holds it; when the last owner releases it, a
 * queued request is dropped and an in-flight one aborted. A new pass claims
 * its tiles BEFORE the old pass is released, so ground the two share is never
 * dropped and re-requested.
 *
 * Priority: the newest owner first (the view on screen now), then that owner's
 * own order -- coarsest ring first, centre-out within a ring.
 */
let active = 0;
let generation = 0;

/** A new owner, ranked above every owner made before it. */
export function newOwner() {
  generation += 1;
  return { gen: generation, live: true };
}

function priorityOf(entry) {
  let gen = -Infinity;
  let rank = Infinity;
  for (const [owner, r] of entry.owners) {
    if (owner.gen > gen || (owner.gen === gen && r < rank)) { gen = owner.gen; rank = r; }
  }
  return { gen, rank };
}

/** Pure: of the waiting entries, the one to start next. Exported for tests. */
export function pickNext(entries) {
  let best = null;
  let bestP = null;
  for (const entry of entries) {
    if (entry.started) continue;
    const p = priorityOf(entry);
    if (!best || p.gen > bestP.gen || (p.gen === bestP.gen && p.rank < bestP.rank)) {
      best = entry;
      bestP = p;
    }
  }
  return best;
}

function pump() {
  while (active < MAX_INFLIGHT) {
    const entry = pickNext(inflight.values());
    if (!entry) return;
    start(entry);
  }
}

function settle(entry, img, { keep }) {
  if (entry.done) return;
  entry.done = true;
  if (entry.started) active = Math.max(0, active - 1);
  if (inflight.get(entry.url) === entry) inflight.delete(entry.url);
  // A cancelled request says nothing about the tile; only a real answer is
  // remembered (a 404 as known-bad, so a dead rung is not asked again).
  if (keep) remember(entry.url, img);
  entry.resolve(img);
  pump();
}

const canFetchBitmaps = () => typeof fetch === "function"
  && typeof createImageBitmap === "function"
  && typeof AbortController === "function";

function start(entry) {
  entry.started = true;
  active += 1;
  if (canFetchBitmaps()) {
    // fetch + createImageBitmap: cancellable on the wire, and decoded OFF the
    // main thread -- an <img> decodes on the first drawImage, in the frame.
    const controller = new AbortController();
    entry.cancel = () => controller.abort();
    fetch(entry.url, { mode: "cors", credentials: "omit", signal: controller.signal })
      .then((response) => {
        if (!response.ok) return { missing: true };
        return response.blob().then((blob) => createImageBitmap(blob)).then((img) => ({ img }));
      })
      .then(
        (result) => settle(entry, result.img || null, { keep: true }),
        () => settle(entry, null, { keep: false }),   // network error or abort: not "known bad"
      );
    return;
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  entry.cancel = () => { img.onload = img.onerror = null; img.src = ""; };
  img.onload = () => settle(entry, img, { keep: true });
  // A missing tile is a hole, not a failure. Remembered as null so a dead
  // rung is not asked for again on every pass.
  img.onerror = () => settle(entry, null, { keep: true });
  img.src = entry.url;
}

/**
 * Register `owner`'s interest in a tile and get its promise. `rank` orders the
 * owner's own requests (lower first). Resolves to the image, or null for a
 * missing tile or one nobody wanted any more.
 */
export function claimTile(url, owner, rank = 0) {
  if (cache.has(url)) return Promise.resolve(cachedTile(url));
  let entry = inflight.get(url);
  if (!entry) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    entry = { url, promise, resolve, owners: new Map(), started: false, done: false, cancel: null };
    inflight.set(url, entry);
  }
  const had = entry.owners.get(owner);
  entry.owners.set(owner, had === undefined ? rank : Math.min(had, rank));
  pump();
  return entry.promise;
}

/**
 * The owner is finished or superseded. Every request it alone was holding is
 * dropped if still queued, or aborted if on the wire; requests another owner
 * still wants carry on untouched.
 */
export function releaseOwner(owner) {
  if (!owner) return 0;
  owner.live = false;
  let dropped = 0;
  for (const entry of [...inflight.values()]) {
    if (!entry.owners.delete(owner) || entry.owners.size) continue;
    dropped += 1;
    if (entry.started) entry.cancel?.();
    settle(entry, null, { keep: false });
  }
  return dropped;
}

/** Requests held for the life of the page -- what a plain fetchTile asks for. */
const PERMANENT = { gen: 0, live: true };

/**
 * One request per URL, however many rings want it -- the plain form, for a
 * caller that does not track ownership. Such a request is never dropped.
 */
export function fetchTile(url) {
  return claimTile(url, PERMANENT, Number.MAX_SAFE_INTEGER);
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
 * Where a lon/lat falls in a level's tile grid, in fractional tile units --
 * the same Web Mercator every tile scheme here uses.
 */
export function tileCoord(lon, lat, level) {
  const n = 2 ** level;
  const clamped = Math.max(-85.0511287798, Math.min(85.0511287798, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/**
 * The work list for a pass: every tile of every ring, ranked. Pure, so the
 * order can be tested without a canvas or a network.
 *
 * Centre-out is measured from `focus` -- the point the camera is looking at --
 * when one is given, else from the middle of the box. The box carries a ring
 * of context and, on an oblique view, more of it on the far side, so its
 * middle is not where anybody is looking.
 */
export function planWork(bbox, targetZoom, tileGridAt, { focus = null, min = 1 } = {}) {
  const work = [];
  for (const level of ringLevels(targetZoom, { min })) {
    const g = tileGridAt(bbox, level);
    let cx = (g.x0 + g.x1 + 1) / 2;
    let cy = (g.y0 + g.y1 + 1) / 2;
    if (focus && Number.isFinite(focus.lon) && Number.isFinite(focus.lat)) {
      const f = tileCoord(focus.lon, focus.lat, level);
      cx = f.x;
      cy = f.y;
    }
    const span = 2 ** level;
    for (let ty = g.y0; ty <= g.y1; ty += 1) {
      if (ty < 0 || ty >= span) continue;
      for (let tx = g.x0; tx <= g.x1; tx += 1) {
        // Distance from the tile's own centre to the focus, in that level's
        // tiles: what someone is looking at should sharpen first.
        work.push({ level, tx, ty, g, distance: Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) });
      }
    }
  }
  return orderWork(work);
}

/**
 * Paint every ring for `bbox` into `canvas`, coarsest first.
 *
 * The canvas is the box exactly, as `tileGrid` builds it, so a tile at any level
 * lands at `tilePixel * 2^(target-level) - origin` scaled by the same factor —
 * one formula for every ring, which is what keeps the seams integer-aligned.
 *
 * Every tile the pass needs is CLAIMED up front, synchronously, before this
 * function first awaits -- so a caller that starts a new pass and then
 * releases the old one never drops ground the two share. The pass ends (and
 * releases what it still holds) when `shouldContinue()` turns false or when
 * the returned `cancel` / an aborted `signal` says so; requests another pass
 * still wants are untouched.
 */
export function streamRings(canvas, bbox, sourceName, {
  targetZoom,
  grid,                       // tileGrid(bbox, targetZoom) from basemap-drape
  tileGridAt,                 // (bbox, z) => grid, injected to avoid a cycle
  onPaint,
  shouldContinue = () => true,
  focus = null,               // { lon, lat } the camera is looking at
  owner = newOwner(),
} = {}) {
  const source = TILE_SOURCES[sourceName];
  if (!source || !canvas || !grid) {
    return Object.assign(Promise.resolve({ painted: 0, requested: 0, fromCache: 0, levels: [], queued: 0 }),
      { cancel: () => {}, owner });
  }
  const ctx = canvas.getContext("2d");
  const guard = makePaintGuard(targetZoom);
  const queue = planWork(bbox, targetZoom, tileGridAt, { focus });
  const levels = [...new Set(queue.map((j) => j.level))];
  let painted = 0;
  let requested = 0;
  let fromCache = 0;
  let cancelled = false;

  const alive = () => {
    if (cancelled || !owner.live) return false;
    if (!shouldContinue()) { cancelled = true; releaseOwner(owner); return false; }
    return true;
  };

  const paint = (job, img) => {
    if (!img) return;
    if (!guard.claim(job.level, job.tx, job.ty)) return;
    // Every level is expressed in the target grid's pixels, so the scale factor
    // is the only thing that changes between rings.
    const scale = 2 ** (targetZoom - job.level);
    const size = TILE_PX * scale;
    try {
      ctx.drawImage(img, job.tx * size - grid.pxMin, job.ty * size - grid.pyMin, size, size);
    } catch (error) {
      return;   // a bitmap released under us is one missing tile, not a failed pass
    }
    painted += 1;
    onPaint?.(painted, queue.length, canvas, job.level);
  };

  // Instant repaint from cache before a single request is made, so returning to
  // ground already seen is immediate rather than merely fast -- and the coarse
  // rings, which are what a pan at one zoom keeps needing, are almost always
  // here, so there is no blank ground while the fine ring is fetched.
  const pending = [];
  queue.forEach((job, rank) => {
    const url = tileUrl(sourceName, job.level, wrap(job.tx, job.level), job.ty);
    const hit = cachedTile(url);
    if (hit) { paint(job, hit); fromCache += 1; return; }
    if (cacheHasBad(url)) return;
    requested += 1;
    pending.push(claimTile(url, owner, rank).then((img) => { if (alive()) paint(job, img); }));
  });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    releaseOwner(owner);
  };

  const done = Promise.all(pending).then(() => {
    releaseOwner(owner);   // nothing left to hold; a no-op unless cancelled mid-way
    return { painted, requested, fromCache, levels, queued: queue.length, cancelled };
  });
  return Object.assign(done, { cancel, owner });
}

function cacheHasBad(url) {
  return cache.has(url) && cache.get(url) === null;
}

/** Longitude wraps; a tile column outside the world is the same one round. */
function wrap(x, level) {
  const span = 2 ** level;
  return ((x % span) + span) % span;
}
