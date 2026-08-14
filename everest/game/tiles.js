/**
 * One scheduler over one budget, for both tile services.
 *
 * The architecture is the Mars flight sim's, arrived at there over several
 * rewrites (`flight_sim/mars/viewer/STREAMING-DESIGN.md`) and ported here as
 * shape rather than as code. The parts that matter, and why:
 *
 *  - **One in-flight budget.** HTTP/1.1 gives ~6 connections per host. Issuing
 *    more does not make them go faster, it queues them inside the browser
 *    where they cannot be reordered or retired, which is worse than queueing
 *    them here where they can.
 *
 *  - **Request coalescing, and a shared fetch is never cancellable by one
 *    caller.** Two tiers routinely want the same tile. If the second caller
 *    to arrive could abort it, the first caller's image vanishes for reasons
 *    it can never see.
 *
 *  - **Retire, don't abort.** When a window moves, its outstanding tiles stop
 *    being *scheduled*; anything already on the wire is allowed to land and
 *    goes into the cache. The next window over the same ground gets it free.
 *
 *  - **The cache holds decoded images, not bytes.** Decoding is the expensive
 *    half on a revisit.
 */

import { TILE_BUDGET, TILE_CACHE } from "./config.js?v=0296a0c-f9529789";

const cache = new Map();      // url -> HTMLImageElement (insertion order = LRU)
const inflight = new Map();   // url -> Promise<Image>
const queue = [];             // {url, priority, seq, resolve, reject, retired}
let active = 0;
let seq = 0;

export const stats = { requested: 0, fromCache: 0, failed: 0, bytesish: 0 };

function touch(url) {
  const img = cache.get(url);
  if (img) { cache.delete(url); cache.set(url, img); }
  return img;
}

function evict() {
  while (cache.size > TILE_CACHE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function startOne() {
  if (active >= TILE_BUDGET) return;
  // Highest priority first (lower number = sooner), then insertion order, so
  // a round completes centre-out instead of in whatever order the sort felt.
  let bestIdx = -1, best = null;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    if (q.retired()) { queue.splice(i--, 1); q.reject(new Error("retired")); continue; }
    if (!best || q.priority < best.priority
        || (q.priority === best.priority && q.seq < best.seq)) { best = q; bestIdx = i; }
  }
  if (!best) return;
  queue.splice(bestIdx, 1);
  active++;

  const img = new Image();
  img.crossOrigin = "anonymous";      // both services send ACAO:* — checked,
  img.decoding = "async";             // not assumed. Without this the canvas
                                      // taints and the DEM cannot be read back.
  const done = (ok) => {
    active--;
    if (ok) {
      cache.set(best.url, img); evict();
      stats.requested++;
      best.resolve(img);
    } else {
      stats.failed++;
      best.reject(new Error("tile failed: " + best.url));
    }
    inflight.delete(best.url);
    startOne();
  };
  img.onload = () => done(true);
  img.onerror = () => done(false);
  img.src = best.url;
}

/**
 * Fetch a tile. `isRetired` is polled rather than an AbortSignal precisely
 * because the fetch may be shared: retiring stops *scheduling*, it does not
 * cancel anything already on the wire.
 */
export function fetchTile(url, priority = 5, isRetired = () => false) {
  const hit = touch(url);
  if (hit) { stats.fromCache++; return Promise.resolve(hit); }
  const pending = inflight.get(url);
  if (pending) return pending;

  const p = new Promise((resolve, reject) => {
    queue.push({ url, priority, seq: seq++, resolve, reject, retired: isRetired });
    startOne();
  });
  inflight.set(url, p);
  return p;
}

/** Already decoded and in memory? Lets a caller paint from cache instantly
 *  before it schedules anything, which is what turns a revisit into one
 *  frame instead of a second. */
export function peek(url) { return cache.get(url) || null; }

/**
 * Fill a tile template.
 *
 * **The template carries the axis order; the caller must not also swap.**
 * Esri's path is `{z}/{y}/{x}` and AWS's is `{z}/{x}/{y}`, and both are
 * written that way in config — so this always substitutes x for {x} and y for
 * {y}. An earlier version took an "order" argument and transposed the pair
 * for Esri, which applied the swap twice: every imagery request went to the
 * tile mirrored across the diagonal. The elevation was right, the picture on
 * it came from the middle of the Atlantic, and the symptom was a mountain
 * correctly shaped and uniformly ocean-blue.
 */
export function templateUrl(template, z, x, y) {
  return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

/** How much is outstanding — the loading screen's progress comes from this. */
export function pending() { return queue.length + active; }

/**
 * Fetch every tile of a window, centre-out, painting each as it lands.
 *
 * Centre-out matters more than it sounds: the middle of the window is where
 * the player is, so the first tiles to arrive are the ones under their feet.
 * `onTile` is called per tile rather than once at the end because on a fresh
 * region the last tile can be a second behind the first, and a second of
 * nothing followed by a pop is much worse than a fill.
 */
export async function fetchWindow(win, template, onTile, isRetired = () => false) {
  const cx = (win.x0 + win.x1 - 1) / 2, cy = (win.y0 + win.y1 - 1) / 2;
  const list = [];
  for (let ty = win.y0; ty < win.y1; ty++)
    for (let tx = win.x0; tx < win.x1; tx++)
      list.push({ tx, ty, d: Math.hypot(tx - cx, ty - cy) });
  list.sort((a, b) => a.d - b.d);

  // Anything already decoded is painted before a single request goes out.
  const toFetch = [];
  for (const t of list) {
    const url = templateUrl(template, win.zoom, t.tx, t.ty);
    const hit = peek(url);
    if (hit) onTile(hit, t.tx - win.x0, t.ty - win.y0);
    else toFetch.push({ ...t, url });
  }

  let landed = 0;
  await Promise.all(toFetch.map((t, i) =>
    fetchTile(t.url, i, isRetired)
      .then((img) => { if (!isRetired()) { onTile(img, t.tx - win.x0, t.ty - win.y0); landed++; } })
      .catch(() => { /* one dead tile is a hole, not a failure */ })));
  return landed;
}
