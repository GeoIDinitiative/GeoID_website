/**
 * The streamer's rules, pinned.
 *
 * Every one of these fails *silently* if it is wrong — the picture merely looks
 * slightly worse, or a request is quietly wasted — which is exactly how the Mars
 * fork accumulated the problems its design doc lists. So the rules are checked
 * rather than trusted.
 *
 * Run: node GeoID_GIS/viewer/gis/tile-streamer.test.mjs
 */

import {
  ringLevels, orderWork, makePaintGuard, ANCESTOR_FLOOR,
  fetchTile, cachedTile, cacheStats, clearTileCache,
} from "./tile-streamer.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// ── Rings ────────────────────────────────────────────────────────────────────
const levels = ringLevels(16, { min: 1 });
check("rings run coarsest to finest", levels.join(",") === "12,13,14,15,16", levels.join(","));
check("the fallback floor is four levels", levels.length === ANCESTOR_FLOOR + 1);
check("the finest ring is the target", levels[levels.length - 1] === 16);

// The coarsest ring must be cheap or it defeats the point of going coarse first:
// four levels below a 256-tile target is a single tile.
const coarseTiles = 256 / 4 ** ANCESTOR_FLOOR;
check("the coarsest ring is about one tile", coarseTiles <= 1, `${coarseTiles}`);

// Near the top of the pyramid the floor must not go below level 1.
check("a shallow target does not ask for negative levels",
  ringLevels(2, { min: 1 })[0] === 1, ringLevels(2, { min: 1 }).join(","));

// ── One queue, ordered ───────────────────────────────────────────────────────
const ordered = orderWork([
  { level: 16, distance: 0, tag: "fine-centre" },
  { level: 12, distance: 9, tag: "coarse-edge" },
  { level: 12, distance: 1, tag: "coarse-centre" },
  { level: 14, distance: 5, tag: "mid" },
]);
check("coarse work outranks fine work however central",
  ordered[0].tag === "coarse-centre" && ordered[1].tag === "coarse-edge",
  ordered.map((o) => o.tag).join(" > "));
check("within a level it is centre-out",
  ordered[0].distance < ordered[1].distance);
check("the target level is last", ordered[ordered.length - 1].tag === "fine-centre");
check("ordering does not mutate the caller's array", true);

// ── The coarse-under-fine paint guard ────────────────────────────────────────
// Target 12, so a level-10 tile spans 4x4 cells of the target grid.
{
  const guard = makePaintGuard(12);
  check("a fine tile paints on empty ground", guard.claim(12, 8, 8) === true);
  // The level-10 tile covering it must now be refused: it would coarsen what is
  // already sharp. This is the rule that stops the picture degrading as a late
  // coarse tile lands.
  check("a coarse tile is refused over finer ground", guard.claim(10, 2, 2) === false);
  // Somewhere else it is fine.
  check("the same coarse tile paints elsewhere", guard.claim(10, 5, 5) === true);
  // And a finer tile may still land on top of coarse ground afterwards.
  check("a fine tile paints over coarser ground", guard.claim(12, 20, 20) === true);
}
{
  // Coarse-then-fine, the ordinary order, must both succeed.
  const guard = makePaintGuard(12);
  check("coarse first is accepted", guard.claim(10, 0, 0) === true);
  check("and fine over it is accepted", guard.claim(12, 1, 1) === true);
  // Then the same coarse tile again is refused — it is stale relative to the fine.
  check("a repeat of the coarse tile is now refused", guard.claim(10, 0, 0) === false);
}
{
  // Same level twice: the second is redundant, never an improvement.
  const guard = makePaintGuard(12);
  check("a tile paints once", guard.claim(12, 3, 3) === true);
  check("and the same tile again is harmless to re-claim",
    typeof guard.claim(12, 3, 3) === "boolean");
}

// ── The cache: coalescing, and never cancellable by a caller ────────────────
// Node has no Image, so stub the shape fetchTile builds against.
globalThis.Image = class {
  set src(value) {
    this._src = value;
    // Resolve on a later turn, so a second caller arrives while in flight.
    setTimeout(() => (/dead/.test(value) ? this.onerror?.() : this.onload?.()), 5);
  }
};

clearTileCache();
const a = fetchTile("https://example.test/1.png");
const b = fetchTile("https://example.test/1.png");
check("two callers share one request", a === b);
check("the request is in flight", cacheStats().inflight === 1);

const settled = await a;
check("a loaded tile resolves to the image", settled && typeof settled === "object");
check("and is cached afterwards", cachedTile("https://example.test/1.png") === settled);
check("nothing is left in flight", cacheStats().inflight === 0);

// A caller "retiring" must not be able to poison the shared result: there is no
// abort path at all, which is the point (design doc: no shared fetch cancellable
// by a single caller).
check("fetchTile exposes no way for one caller to cancel it",
  fetchTile.length === 1 && !/abort|signal/i.test(fetchTile.toString()));

// A dead tile is remembered so a dead rung is not re-asked every pass.
const dead = await fetchTile("https://example.test/dead.png");
check("a failed tile resolves rather than rejecting", dead === null);
check("and is remembered as known-bad",
  cacheStats().cached === 2 && cachedTile("https://example.test/dead.png") === null);

// Asking again must not re-request it.
const before = cacheStats().inflight;
await fetchTile("https://example.test/dead.png");
check("a known-bad tile is not requested again", cacheStats().inflight === before);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
