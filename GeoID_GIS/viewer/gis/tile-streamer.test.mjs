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
  claimTile, releaseOwner, newOwner, pickNext, planWork, tileCoord, streamRings,
  MAX_INFLIGHT, CACHE_LIMIT,
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


// ── Interest is counted: only a request NOBODY wants is dropped ─────────────
{
  clearTileCache();
  const stale = newOwner();
  const fresh = newOwner();
  // The old view queues more than the budget holds.
  const staleUrls = Array.from({ length: MAX_INFLIGHT + 6 }, (_, i) => `https://example.test/stale-${i}.png`);
  const stalePromises = staleUrls.map((u, i) => claimTile(u, stale, i));
  check("the budget is global: no more than MAX_INFLIGHT on the wire",
    cacheStats().active === MAX_INFLIGHT, `${cacheStats().active}`);
  // The new view wants one tile the old one also wanted, and some of its own.
  const shared = staleUrls[MAX_INFLIGHT + 2];         // queued, not yet started
  const own = ["https://example.test/fresh-a.png", "https://example.test/fresh-b.png"];
  const sharedP = claimTile(shared, fresh, 0);
  const ownP = own.map((u, i) => claimTile(u, fresh, i + 1));
  check("a second owner of a queued tile shares its one request", sharedP === stalePromises[MAX_INFLIGHT + 2]);
  // The old view leaves.
  const dropped = releaseOwner(stale);
  check("releasing an owner drops what only it wanted",
    dropped === staleUrls.length - 1, `${dropped} of ${staleUrls.length - 1}`);
  const stillWanted = [...stalePromises.keys()].filter((i) => i !== MAX_INFLIGHT + 2);
  const results = await Promise.all(stillWanted.map((i) => stalePromises[i]));
  check("a dropped request resolves to null rather than hanging", results.every((r) => r === null));
  check("and is NOT remembered as a bad tile", cachedTile(staleUrls[0]) === null && cacheStats().cached === 0);
  const sharedImg = await sharedP;
  check("the shared tile survives the old owner leaving", sharedImg && typeof sharedImg === "object");
  const ownImgs = await Promise.all(ownP);
  check("and the new owner's own tiles arrive", ownImgs.every((img) => img && typeof img === "object"));
  check("nothing is left in flight or counted active", cacheStats().inflight === 0 && cacheStats().active === 0);
}

// ── The newest view goes first ──────────────────────────────────────────────
{
  const older = { gen: 1 };
  const newer = { gen: 2 };
  const e = (url, owners) => ({ url, started: false, owners: new Map(owners) });
  const next = pickNext([
    e("a", [[older, 0]]),
    e("b", [[newer, 5]]),
    e("c", [[newer, 2]]),
  ]);
  check("a newer owner's request starts before an older owner's", next.url === "c", next?.url);
  const shared = pickNext([e("x", [[older, 0], [newer, 9]]), e("y", [[newer, 3]])]);
  check("a request is ranked by its most urgent owner", shared.url === "y", shared?.url);
  check("started requests are never picked again",
    pickNext([{ url: "s", started: true, owners: new Map([[newer, 0]]) }]) === null);
}

// ── The cache is an LRU ──────────────────────────────────────────────────────
{
  clearTileCache();
  const urls = Array.from({ length: CACHE_LIMIT }, (_, i) => `https://example.test/lru-${i}.png`);
  await Promise.all(urls.map((u) => fetchTile(u)));
  check("the cache fills to its limit", cacheStats().cached === CACHE_LIMIT);
  cachedTile(urls[0]);                                   // looked at again: now the youngest
  await fetchTile("https://example.test/lru-extra.png"); // one more evicts the oldest
  check("a tile looked at again is kept", cachedTile(urls[0]) !== null);
  check("the least recently used tile is the one evicted", cachedTile(urls[1]) === null);
  check("and the cache stays bounded", cacheStats().cached === CACHE_LIMIT);
}

// ── The work list: coarse first, then out from where the camera looks ────────
{
  // A synthetic grid: the box spans tiles 0..7 at every level (enough to test order).
  const gridAt = (_box, level) => ({ x0: 0, x1: 7, y0: 0, y1: 7 });
  const box = { minLon: -180, maxLon: 180, minLat: -85, maxLat: 85 };
  const focusTile = tileCoord(-125, 60, 3);             // up and to the left at level 3
  const plan = planWork(box, 3, gridAt, { focus: { lon: -125, lat: 60 } });
  check("every ring is coarser-first", plan[0].level === 1 && plan[plan.length - 1].level === 3);
  const level3 = plan.filter((j) => j.level === 3);
  const first = level3[0];
  check("within the target ring the tile under the focus comes first",
    first.tx === Math.floor(focusTile.x) && first.ty === Math.floor(focusTile.y),
    `${first.tx},${first.ty} vs ${focusTile.x.toFixed(2)},${focusTile.y.toFixed(2)}`);
  const centred = planWork(box, 3, gridAt).filter((j) => j.level === 3)[0];
  check("without a focus the middle of the box comes first",
    centred.tx >= 3 && centred.tx <= 4 && centred.ty >= 3 && centred.ty <= 4, `${centred.tx},${centred.ty}`);
  const tc = tileCoord(0, 0, 1);
  check("tileCoord is Web Mercator", Math.abs(tc.x - 1) < 1e-9 && Math.abs(tc.y - 1) < 1e-9);
}

// ── A pass claims everything before it first awaits ──────────────────────────
{
  clearTileCache();
  const canvas = { getContext: () => ({ drawImage() {} }) };
  const gridAt = (_box, level) => ({ x0: 0, x1: 1, y0: 0, y1: 1 });
  const box = { minLon: -10, maxLon: 10, minLat: -10, maxLat: 10 };
  const sourceName = Object.keys((await import("./tile-sources.js")).TILE_SOURCES)[0];
  const run = streamRings(canvas, box, sourceName, {
    targetZoom: 3, grid: { pxMin: 0, pyMin: 0 }, tileGridAt: gridAt,
  });
  check("the pass has registered every tile synchronously", cacheStats().inflight > 0, `${cacheStats().inflight}`);
  check("and can be cancelled", typeof run.cancel === "function");
  run.cancel();
  const out = await run;
  check("a cancelled pass resolves, releasing what it held",
    out.cancelled === true && cacheStats().inflight === 0, JSON.stringify({ c: out.cancelled, i: cacheStats().inflight }));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
