/**
 * One scheduler over one in-flight budget for every tile the game streams.
 * Shape taken from the Everest game's tiles.js (itself the Mars flight sim's):
 * one budget, coalesced requests, retire instead of abort.
 *
 * Tiles come from the site's own static pyramid, so there is no cross-origin
 * question: an <img> decode and a canvas read-back.
 */
import { TILE_BUDGET } from "./config.js?v=6d37c9c-9b39e129";

const inflight = new Map();   // url -> Promise<HTMLImageElement>
const queue = [];             // {url, priority, seq, resolve, reject, retired}
let active = 0, seq = 0;

export const stats = { loaded: 0, failed: 0, requested: 0 };

function startOne() {
  while (active < TILE_BUDGET && queue.length) {
    let bi = -1, best = null;
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      if (q.retired()) { queue.splice(i--, 1); inflight.delete(q.url); q.reject(new Error("retired")); continue; }
      if (!best || q.priority < best.priority || (q.priority === best.priority && q.seq < best.seq)) { best = q; bi = i; }
    }
    if (!best) return;
    queue.splice(bi, 1);
    active++;
    const job = best;
    const img = new Image();
    img.decoding = "async";
    const done = (ok) => {
      active--;
      inflight.delete(job.url);
      if (ok) { stats.loaded++; job.resolve(img); } else { stats.failed++; job.reject(new Error("tile failed: " + job.url)); }
      startOne();
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = job.url;
  }
}

/** Fetch one tile image. Lower priority number = sooner. */
export function fetchTile(url, priority = 5, isRetired = () => false) {
  const pending = inflight.get(url);
  if (pending) return pending;
  stats.requested++;
  const p = new Promise((resolve, reject) => {
    queue.push({ url, priority, seq: seq++, resolve, reject, retired: isRetired });
  });
  inflight.set(url, p);
  startOne();
  return p;
}

/** Outstanding work: the loading screen's progress and the test's "settled" come from this. */
export function pending() { return queue.length + active; }

let scratch = null;
/** RGBA bytes of an image. One shared canvas: callers must copy what they keep. */
export function pixels(img, size) {
  if (!scratch || scratch.width !== size) {
    scratch = document.createElement("canvas");
    scratch.width = scratch.height = size;
    scratch.ctx = scratch.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  }
  const ctx = scratch.ctx;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}
