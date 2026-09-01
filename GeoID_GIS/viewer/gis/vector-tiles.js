/**
 * A vector layer made of TILES, kept between views.
 *
 * The layer this replaces refetched, re-decoded and re-triangulated its whole
 * self every time the view settled. Even with the camera pinned that is not a
 * map, it is a slideshow: the polygons change shape at every zoom, the key
 * rewrites itself, the main thread stops, and moving one degree costs
 * everything again. Measured before this existed: a settle rebuilt 7,929
 * polygons from four tiles to show you two of them.
 *
 * So the model here is the one the imagery already uses
 * (`gis/tile-streamer.js`, ported from the Mars fork): a tile is fetched once,
 * decoded once, built into geometry once, and then KEPT. Panning asks for the
 * two tiles that came into view. Zooming back out shows tiles that are already
 * in memory, instantly and with no request at all. Nothing is ever rebuilt
 * because the camera moved.
 *
 * Three rules make that stable rather than merely cached:
 *
 * 1. **The swap is atomic.** The tiles for the new view are all made ready
 *    before any of them is shown, and the previous set is hidden in the same
 *    frame. These fills are opaque and do not depth-test, so a half-swapped
 *    view would draw a coarse tile over a fine one in an order nobody controls
 *    — which is exactly the flicker this is meant to end. The old map stays up
 *    meanwhile, so there is no gap either.
 * 2. **Cached tiles are free.** Both the decode and the geometry are kept, so
 *    a view you have seen returns in one frame. The cache is bounded and
 *    evicts by least-recently-needed, disposing the GPU buffers it drops.
 * 3. **Failure costs a tile, never the map.** One tile that will not load
 *    leaves a hole and says so; the rest of the view is unaffected.
 *
 * The layer stays ONE object3D and one layer record for its whole life, which
 * is what keeps the symbology somebody chose, the opacity they set and the
 * place in the stack — all of which a rebuild used to throw away.
 */

import * as THREE from "../vendor/three.module.js";
import { decodeTile, tilesForBounds, zoomForBounds } from "./mvt.js?v=20260901-daafb14";
import { renderFeatureCollection } from "./vector-render.js?v=20260901-daafb14";
import * as GP from "./geoprocessing.js?v=20260901-daafb14";

const key = (z, x, y) => `${z}/${x}/${y}`;

/** Fetch one tile, local copy first. */
async function loadTile(sources, z, x, y, signal) {
  const path = `${z}/${x}/${y}`;
  /**
   * The local tile carries the BAKE'S OWN VERSION, because `?v=` versions
   * modules and a tile is just a file. Re-baked finer, the page went on
   * drawing the coarse tiles it already had — a bake that appeared to do
   * nothing. The remote never gets it: that is somebody else's cache key.
   */
  const local = sources.local && sources.has?.(path)
    ? `${sources.local}/${path}.mvt${sources.version ? `?v=${sources.version}` : ""}`
    : null;
  const urls = local ? [local] : [];
  if (sources.remote) {
    urls.push(`${sources.remote}/${path}.mvt`);
    // A URL the CDN has not cached, for the objects it cached without their
    // CORS header — see the note in macrostrat.js. One retry, never a loop.
    urls.push(`${sources.remote}/${path}.mvt?cors=1`);
  }
  /**
   * A TILE THAT WAS NEVER BAKED, ON A PYRAMID WITH NO REMOTE, IS EMPTY — not
   * a failure.
   *
   * The geology falls through to Macrostrat for anything the bake skipped, so
   * "not on disk" there means "ask the source". The glacier pyramid has no
   * source behind it and is SPARSE by nature: ice covers a fraction of the
   * planet, so most tiles of any view genuinely hold nothing, and counting
   * each one as a failed fetch would report a working map as a broken one.
   * An empty buffer decodes to no layers, which is the truth about that
   * ground.
   */
  if (!urls.length) return { buffer: new ArrayBuffer(0), from: "absent" };
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { buffer: await response.arrayBuffer(), from: url === local ? "disk" : "network" };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("no source");
}

/**
 * @param {object} options
 * @param {string} options.name       layer name, used for the group
 * @param {string} options.kind       which MVT layer to read ("units", "lines")
 * @param {object} options.sources    { local, remote, has(path) }
 * @param {function} options.colourFor  feature -> CSS colour, or null
 * @param {number} options.cacheTiles   built tiles kept in memory
 */
/**
 * How many tiles a PROBE may fetch, by named level.
 *
 * Not the same question as `maxTiles`, which bounds what is DRAWN so a refine
 * cannot stutter the flight it was meant to serve. A probe draws nothing: what
 * bounds it is politeness to somebody else's tile server and the patience of
 * whoever pressed the button.
 *
 * Measured over Northern Ireland — tiles a level needs, EPSG:4326 being 2x1 at
 * zoom 0 so a tile spans 360/2^(z+1) degrees:
 *
 *   box            z8    z9    z10   z11   z12
 *   2.8 x 1.3 deg   9    20    63    238   891
 *   0.6 x 0.45 deg  2     6    12    30     90
 *
 * and the compilation's own detail peaks at **zoom 11**, going THINNER past it
 * (measured: 151 features at 11, 123 at 12, 38 at 13, the unit count collapsing
 * 22 to 15 to 8). So `balanced` reaches the peak for an ordinary study area and
 * `full` reaches it for a large one; `fast` is the old drawing budget, kept as
 * the way to ask for a quick answer on purpose rather than by accident.
 */
export const TILE_BUDGETS = { fast: 16, balanced: 96, full: 320, maximum: 1200 };
const AUTO_TILE_BUDGET = TILE_BUDGETS.balanced;

/**
 * How much coverage a deeper level may lose before it is refused: three
 * percentage points, which is generalisation wobble along a coast rather than
 * a source dataset disappearing.
 */
const COVERAGE_TOLERANCE = 0.03;

/**
 * How many levels BELOW the one a box's size deserves the sweep still looks at.
 *
 * Enough to reach the levels where a composited source keeps its other
 * surveys: measured on Macrostrat, the offshore survey lives at zooms 5 and 6
 * and is gone by 7, while a 34 km study area starts its climb at 10. Four
 * levels down covers that and costs one or two tiles a level.
 */
const SHALLOW_LOOKBACK = 5;

/**
 * Which SURVEY a feature came from. Macrostrat names it `source_id`; anything
 * without one is treated as a single unnamed survey, which makes the merge a
 * no-op rather than a wrong answer on a source that does not composite.
 */
export const sourceKey = (f) => String(f?.properties?.source_id ?? "");

/**
 * How much of the box actually HAS geology at this level.
 *
 * Detail and coverage are different questions, and the climb only asked one.
 * Macrostrat's carto layer composites SEVERAL source maps and switches
 * between them by scale — so a deeper level is not a finer drawing of the
 * same ground, it can be a different, PARTIAL survey. Measured over a box
 * straddling the Northern Ireland border:
 *
 *   zoom   tiles   coverage   units   source datasets   vertices in box
 *     5      1       99.6%      14           1                428
 *     6      1       99.6%      32           2              3,091
 *     8      4       99.9%      33           2              5,872
 *     9      9       56.1%      24           1              6,551
 *    10     30       56.1%      24           1              8,026
 *
 * Past zoom 8 the Republic's survey is simply not in the tiles: **1,579 of
 * 3,600 sample points lose their geology, 44% of the ground** — while the
 * vertex count RISES, because the one surviving survey is drawn more finely.
 * So the ruler said "better" about a level that had thrown half the map
 * away, and the climb went there.
 *
 * A level that covers materially LESS ground is refused, whatever its
 * detail. Asked for a clip, "all the geology that exists within these
 * bounds" is the requirement, and a 44% loss is not a refinement of it.
 *
 * Sampled on a coarse grid with a bounds reject first: a few hundred points
 * against polygons that mostly fail on their box is nothing beside the tile
 * fetch it is deciding about.
 */
export function coverageWithin(features, bounds) {
  const N = 24;
  const boxed = [];
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    const parts = g.type === "MultiPolygon" ? g.coordinates
      : g.type === "Polygon" ? [g.coordinates] : null;
    if (!parts) continue;
    for (const rings of parts) {
      let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
      for (const [x, y] of rings[0]) {
        if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
      }
      boxed.push({ rings, bb: [w, s, e, n] });
    }
  }
  if (!boxed.length) return 0;
  const inRing = (lo, la, r) => {
    let hit = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if ((yi > la) !== (yj > la) && lo < ((xj - xi) * (la - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  let hits = 0;
  for (let j = 0; j < N; j += 1) {
    const la = bounds.south + ((bounds.north - bounds.south) * (j + 0.5)) / N;
    for (let i = 0; i < N; i += 1) {
      const lo = bounds.west + ((bounds.east - bounds.west) * (i + 0.5)) / N;
      for (const p of boxed) {
        const b = p.bb;
        if (lo < b[0] || lo > b[2] || la < b[1] || la > b[3]) continue;
        if (!inRing(lo, la, p.rings[0])) continue;
        let hole = false;
        for (let k = 1; k < p.rings.length; k += 1) {
          if (inRing(lo, la, p.rings[k])) { hole = true; break; }
        }
        if (!hole) { hits += 1; break; }
      }
    }
  }
  return hits / (N * N);
}

export function createTiledVectorLayer({
  name = "vector tiles",
  kind = "units",
  sources,
  colourFor = null,
  cacheTiles = 64,
  maxTiles = 16,
  maxZoom = 13,
  contacts = null,
  /**
   * Stream only what falls inside this mask.
   *
   * A clipped geology layer used to be a SNAPSHOT: the features that happened
   * to be in hand when the tool ran, triangulated once and never touched
   * again. The world layer beside it refines on every settle, so zooming in
   * left the two disagreeing — the source sharpening while the clip of it
   * stayed at whatever level it was born at.
   *
   * Giving the clip its own controller with a mask is what makes the two the
   * SAME machinery rather than two implementations of streaming. Everything
   * below — the tile cache, the zoom choice, the refine, the contacts, the
   * seam handling — is then shared by construction, which is the lesson the
   * imitated label engine and the polygon-area formula both cost.
   */
  clipTo = null,
  /**
   * Stream only the features this says yes to.
   *
   * `clipTo` cuts by GROUND; this selects by ATTRIBUTE, and the two are not
   * interchangeable. Ice cover is the case that needed it: Macrostrat's global
   * compilation maps ice sheets as ordinary polygons named "Phanerozoic ice"
   * sitting in the same tiles as the bedrock — 24.5% of the features over
   * Antarctica — so a geological map of that ground is mostly a map of what is
   * on top of it. One predicate, applied at BUILD, gives the geology every
   * feature that is not ice and the ice layer every feature that is, off one
   * set of tiles and one cache.
   *
   * At build rather than after, because a tiled layer builds more tiles
   * whenever the view settles and anything applied afterwards reaches only the
   * ones that existed when it ran.
   */
  featureFilter = null,
} = {}) {
  // Unversioned, exactly as every other module imports it: a second copy of
  // three.js on the page breaks class identity and nothing is a Mesh any more.
  const group = new THREE.Group();
  group.name = name;

  /** key -> { z, x, y, features, node, used, state } */
  const tiles = new Map();
  let paint = colourFor;
  let contactStyle = contacts;
  let opacity = 1;
  let clipMask = clipTo;
  /**
   * The clip is per TILE and cached on the tile, because a tile is fetched
   * once and may be built, rebuilt and asked about many times. Keyed on the
   * mask so changing the study area invalidates it rather than silently
   * serving the old ground.
   */
  const clipped = (tile) => {
    // The attribute filter runs first and is cheap; clipping is the expensive
    // half, so there is no sense cutting geometry that is about to be dropped.
    const selected = featureFilter
      ? tile.features.filter((f) => { try { return featureFilter(f); } catch (e) { return true; } })
      : tile.features;
    if (!clipMask) return selected;
    if (tile.clipFor === clipMask) return tile.clipFeatures;
    tile.clipFor = clipMask;
    try {
      tile.clipFeatures = GP.clip(
        { type: "FeatureCollection", features: selected }, clipMask,
      ).features;
    } catch (error) {
      // A mask this tile cannot be cut by leaves the tile whole rather than
      // empty: showing too much is recoverable, showing nothing looks broken.
      tile.clipFeatures = selected;
    }
    return tile.clipFeatures;
  };
  /**
   * The BACKDROP: the whole world at a coarse zoom, pinned on for good.
   *
   * Without it the layer showed only what the last view asked for — and a view
   * is a hemisphere at best, so the far half of the planet simply had no
   * geology on it until you turned the globe, waited for it to settle, and let
   * it fetch. That is the "two halves with a huge latency between them": not
   * slow loading, but a map that had been narrowed to the view and then had to
   * be fetched back.
   *
   * So the world stays underneath at zoom 1 (four tiles, ~1 MB, already on
   * disk) and the view's tiles are drawn on top of it. Turning the globe now
   * shows geology immediately, everywhere, and it sharpens where you look.
   */
  const pinned = new Set();
  /** What the last set actually cost, so the next choice can be predicted. */
  let seen = null;
  /** Which of the visible tiles are the view's own, rather than the backdrop. */
  let sharpSet = new Set();
  /** The zoom the backdrop was loaded at, which the density estimate is in. */
  let baseZoom = null;
  /**
   * The window cut in the backdrop, shared by every backdrop tile's material.
   * Two latitudes as a range on the direction's y, two meridians as plane
   * normals; moving it is four uniform writes and no rebuild.
   */
  const hole = {
    on: { value: 0 },
    y: { value: new THREE.Vector2(-1, 1) },
    west: { value: new THREE.Vector3(1, 0, 0) },
    east: { value: new THREE.Vector3(1, 0, 0) },
  };
  let visible = new Set();
  let generation = 0;
  let inflight = null;

  const build = (tile) => {
    if (tile.node) return tile.node;
    const built = renderFeatureCollection(
      { type: "FeatureCollection", features: clipped(tile) },
      {
        name: `${name} ${tile.z}/${tile.x}/${tile.y}`,
        colourFor: paint,
        // Read from the live variable, never captured: a tile built after the
        // contacts were changed must match the ones already on screen, which
        // is the same rule the opacity already follows.
        contacts: contactStyle,
        // Its own square, so the seal can tell the tile's CUT from a contact.
        edgeBounds: tileBounds(tile.z, tile.x, tile.y),
        // Only the backdrop carries the window: the view's own tiles are what
        // the window exists to show.
        hole: pinned.has(key(tile.z, tile.x, tile.y)) ? hole : null,
      },
    );
    tile.node = built.object3D;
    tile.node.visible = false;
    /**
     * A tile built AFTER the stack was applied has no draw order of its own.
     *
     * `applyStack` walks each layer's object3D once and stamps its renderOrder
     * onto every child; a tile that arrives later is a new child, and a new
     * child starts at zero — which is under the basemap, under the streamed
     * imagery, under everything. Measured: the map came back and the geology
     * did not, because the tiles it had just built were painted first and then
     * covered. The group's own order is the layer's, so it is the answer.
     */
    tile.node.traverse((child) => { child.renderOrder = group.renderOrder; });
    // Opacity is a layer-wide setting applied the same way, so a new tile
    // inherits it from whatever is already on screen rather than arriving at
    // full strength beside a faded neighbour.
    if (opacity < 1) {
      tile.node.traverse((child) => {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((m) => {
          if (!m) return;
          m.transparent = true;
          m.opacity = opacity;
          m.needsUpdate = true;
        });
      });
    }
    group.add(tile.node);
    return tile.node;
  };

  const dropNode = (tile) => {
    if (!tile.node) return;
    tile.node.traverse?.((child) => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((m) => m?.dispose?.());
    });
    group.remove(tile.node);
    tile.node = null;
  };


/**
 * How deep to go, bounded by what it will cost to BUILD.
 *
 * Detail is not limited by bandwidth here — a baked tile is 20-250 KB off disk
 * — it is limited by triangulating what is in it. Measured on this machine:
 * about **60-85 ms per thousand features**, so a view holding 70,000 features
 * is five seconds of frozen main thread, and that is what taking the deepest
 * zoom the tile budget allowed actually bought.
 *
 * Feature count roughly quadruples per zoom level, so the last set that was
 * built is a good predictor of the next one: scale it by the change in view
 * area and by 4^(levels deeper), and step back while that is over budget. It
 * self-corrects, because every update replaces the estimate with what really
 * arrived.
 */
  function chooseZoom(bounds, asked, budget, floorZoom) {
    const areaOf = (b) => Math.max(1e-6, Math.abs(b.east - b.west) * Math.abs(b.north - b.south));
    let z = Math.max(floorZoom, Math.min(maxZoom, Math.round(asked)));

    /**
     * Density is LOCAL, so the estimate has to be too.
     *
     * The first version scaled the whole world's feature count, and the world
     * is mostly ocean: over Europe it predicted a few thousand and 49,150
     * arrived — twenty seconds of building. The backdrop tiles the view sits
     * on are a far better ruler, because they are the same ground at a known
     * zoom. Counting only the ones the view overlaps turns "features per
     * square degree here" into a number, and feature count roughly quadruples
     * per level from there.
     */
    let localFeatures = 0;
    let localArea = 0;
    pinned.forEach((id) => {
      const tile = tiles.get(id);
      if (!tile || tile.state !== "ready") return;
      const b = tileBounds(tile.z, tile.x, tile.y);
      const overlaps = b.east > bounds.west && b.west < bounds.east
        && b.north > bounds.south && b.south < bounds.north;
      if (!overlaps) return;
      localFeatures += tile.features.length;
      localArea += areaOf(b);
    });

    /**
     * The manifest knows what every baked tile WEIGHS, and weight predicts
     * feature count almost exactly.
     *
     * Measured across five zooms, from the world tile to a valley: 6.5, 7.4,
     * 7.5, 6.9 and 8.0 features per kilobyte. So for any zoom inside the bake
     * the cost of a view can be summed before a byte is fetched — which beats
     * every scaling rule, and beats them most where the rules were worst: the
     * jump from zoom 2 to zoom 3 is nine times the data, not four, because
     * that is where the compilation stops generalising and starts including.
     */
    const FEATURES_PER_KB = 7.2;
    /**
     * Past the bake there is no manifest to read, so the deepest baked level
     * is weighed instead and scaled. Measured from the bake's own totals and a
     * live zoom-6 sample: the world is 18.2 MB baked at zoom 5 and about
     * 150 MB at zoom 6, so roughly eight times the data for that step - which
     * is where the compilation stops generalising altogether.
     */
    const BEYOND_BAKE_GROWTH = 8;
    // The same measurement with the tile multiplication taken out: four times
    // the tiles carrying twice the content each is where the 8 comes from.
    const PER_TILE_GROWTH = BEYOND_BAKE_GROWTH / 4;
    const baked = Number.isFinite(sources.maxZoom) ? sources.maxZoom : null;
    const weigh = (level) => {
      if (baked === null || level > baked) return null;
      let bytes = 0;
      for (const t of tilesForBounds(bounds, level)) {
        // A tile the bake skipped is EMPTY, not unknown — ocean, ice, ground
        // nobody has mapped. Reading it as unknown threw the whole estimate
        // away for any view with a coastline in it, which is most of them, and
        // the fallback let a zoom-6 view through at 69,761 features.
        bytes += sources.size(`${t.z}/${t.x}/${t.y}`) ?? 0;
      }
      return (bytes / 1024) * FEATURES_PER_KB;
    };
    /**
     * Past the bake the growth is PER TILE, and the difference is a whole
     * level of detail.
     *
     * `BEYOND_BAKE_GROWTH` is 8, measured from the WORLD's own totals — the
     * world is 18.2 MB baked at zoom 5 and about 150 MB at zoom 6. But that 8
     * is two things multiplied: four times as many tiles, each carrying twice
     * the content. A view SMALLER THAN ONE TILE gets none of the first half —
     * `tilesForBounds` returns one tile at zoom 5, one at 6, one at 7 — so
     * charging it 8x a level over-predicts by four times a level and the map
     * is refused detail that costs nothing.
     *
     * Measured on a 0.5 degree study area over Northern Ireland: the view
     * deserves zoom 11 by `zoomForBounds` and the budget pinned it at SIX,
     * while the features actually touching that box go 11 at zoom 5, 81 at
     * zoom 6, 88 at zoom 7 — and the boundary detail with them, 283 vertices
     * to 1,314 to 1,853. Past zoom 7 the compilation has nothing more to give
     * (88 features and ~1,800 vertices at 8 and 9 alike), so the map was
     * exactly one level short of everything the source holds.
     *
     * Scaling per tile and multiplying by the tiles this view actually needs
     * keeps both halves honest: a wide view still pays the tile count, a
     * small one pays only for the content.
     */
    const tilesAt = (level) => tilesForBounds(bounds, level).length;
    const fromManifest = (level) => {
      if (!sources.size) return null;
      const direct = weigh(level);
      if (direct !== null) return direct;
      const deepest = weigh(baked);
      if (deepest === null) return null;
      const perTile = deepest / Math.max(1, tilesAt(baked));
      return perTile * tilesAt(level) * (PER_TILE_GROWTH ** (level - baked));
    };

    const fromBackdrop = localArea > 0 && baseZoom !== null
      ? (level) => (localFeatures / localArea) * areaOf(bounds) * (4 ** (level - baseZoom))
      : null;
    const fromLast = seen
      ? (level) => seen.features * (areaOf(bounds) / areaOf(seen.bounds))
        * (4 ** (level - seen.zoom))
      : null;
    // The higher of the two: under-guessing costs a frozen second, and the
    // last view is the better ruler only when it was over this same ground.
    const predict = (level) => {
      const weighed = fromManifest(level);
      if (weighed !== null) return weighed;
      return Math.max(fromBackdrop?.(level) ?? 0, fromLast?.(level) ?? 0);
    };
    /**
     * A level the view cannot be COVERED at is not a level, whatever it costs.
     *
     * `update` fetches `tilesForBounds(bounds, z).slice(0, maxTiles)` — a
     * TRUNCATION, not a refusal — so a zoom needing more tiles than the cap
     * paints part of the view sharply and leaves the rest to the backdrop.
     * That is a coarse slab across half the screen with the fine map beside
     * it, and it appeared the moment the feature budget stopped being the
     * binding constraint: the deeper levels the per-tile fix unlocked are
     * exactly the ones that need more tiles than the cap allows.
     *
     * Feature budget and tile cap are different limits — one is how long the
     * triangulation takes, the other is whether the picture is whole — and
     * only the second can make the map wrong rather than merely slow.
     */
    while (z > floorZoom && tilesForBounds(bounds, z).length > maxTiles) z -= 1;
    if (!sources.size && !fromBackdrop && !fromLast) return z;
    while (z > floorZoom && predict(z) > budget) z -= 1;
    return z;
  }

  /** Fetch and decode whatever of these tiles is not already in hand. */
  async function fetchInto(wanted, onProgress, signal, onTile = null) {
    let cached = 0;
    let failed = 0;
    let bytes = 0;
    const queue = wanted.filter((t) => {
      const existing = tiles.get(key(t.z, t.x, t.y));
      if (existing && existing.state !== "failed") {
        cached += 1;
        existing.used = generation;
        return false;
      }
      return true;
    });
    let done = 0;
    const worker = async () => {
      for (;;) {
        const tile = queue.shift();
        if (!tile) return;
        const id = key(tile.z, tile.x, tile.y);
        try {
          const { buffer } = await loadTile(sources, tile.z, tile.x, tile.y, signal);
          bytes += buffer.byteLength;
          const decoded = decodeTile(buffer, { ...tile, only: [kind] });
          tiles.set(id, {
            ...tile, features: decoded[kind] || [], node: null,
            used: generation, state: "ready",
          });
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          failed += 1;
          tiles.set(id, { ...tile, features: [], node: null, used: generation, state: "failed" });
        }
        done += 1;
        onTile?.(id);
        onProgress?.(done + cached, wanted.length);
      }
    };
    // Six rather than four: the baked tiles come off disk, where the round trip
    // is short enough that the queue, not the network, was the wait.
    inflight = Promise.all([0, 1, 2, 3, 4, 5].map(worker));
    await inflight;
    return { cached, failed, bytes };
  }

  /**
   * Show exactly this set, in one pass, with the view's tiles ON TOP.
   *
   * `renderOrder` is a float, and that is what makes the two sets stack
   * without a second layer: `applyStack` gives the layer a whole number and
   * the view's tiles take half a step above it, which is above the backdrop
   * and still below whatever layer comes next.
   */
  /**
   * Hide the backdrop where the screen is already showing the view's own map.
   *
   * A coarse generalisation under a fine one is invisible while the layer is
   * opaque and WRONG the moment it is not: turn the opacity down and the big
   * angular shapes of the world map show through the detail, belonging to no
   * unit on screen.
   *
   * It has to follow the camera, not the last refine. Deciding this once per
   * settle meant a backdrop tile hidden for a small view stayed hidden when
   * the camera pulled back — a rectangular hole in the world map the size of a
   * zoom-2 tile, which is precisely the fault it was meant to cure. So this is
   * cheap on purpose: a handful of bounds tests and a `visible` flag, no
   * geometry, safe to call several times a second.
   */
  function maskBackdrop() {
    const toDir = window.GeoIDViewer?.latLonToVector3;
    /**
     * The window is the ground the VIEW'S TILES cover — not the camera's box.
     *
     * Cutting the camera's box left the backdrop missing wherever the view was
     * bigger than the tiles that had been fetched for it: a dark wedge across
     * the planet, the first fault in a new shape. The sharp tiles' own union
     * is exactly the ground that has a better map on it, so it is exactly what
     * should be cut away underneath — and it only changes when the view is
     * refined, not as the camera drifts.
     */
    if (!sharpSet.size || !toDir) {
      hole.on.value = 0;
      return;
    }
    /**
     * THE BACKDROP IS ALWAYS CUT AWAY UNDER THE VIEW'S TILES, and an attempt
     * to keep it there for opaque layers is recorded here because it looked
     * right and was badly wrong.
     *
     * The idea was to close the hairline seams: neighbouring units do not
     * share their boundary (44.9% of edges on the live tiles are used by two
     * polygons), and the seal that covers the strays is a LINE, which WebGL
     * draws one device pixel wide whatever `linewidth` says — about 20 m of
     * ground at a 35 km view and less as you descend. Leaving the coarse map
     * underneath fills those seams with the same geology one generalisation
     * up instead of with black, and at 45 and 120 km it did exactly that.
     *
     * What it also does is paint the coarse map over every place the fine
     * tiles deliberately leave BLANK. Measured at a 500 m scale bar off the
     * Antrim coast: a continental-scale generalised unit painted green across
     * half the screen, over SEA at −37 m, where the zoom-9 tile correctly has
     * no polygon at all — and unclickable, because the pickers read the finest
     * zoom's features and the backdrop's are not among them. A hairline seam
     * traded for geology over water is not a trade.
     *
     * The seams are the smaller fault and they stay until the seal is a
     * ground-width RIBBON rather than a line, which is the only fix that
     * scales. Do not re-try this one.
     */
    let west = 180;
    let east = -180;
    let south = 90;
    let north = -90;
    sharpSet.forEach((id) => {
      const tile = tiles.get(id);
      if (!tile) return;
      const b = tileBounds(tile.z, tile.x, tile.y);
      west = Math.min(west, b.west);
      east = Math.max(east, b.east);
      south = Math.min(south, b.south);
      north = Math.max(north, b.north);
    });
    const span = east - west;
    // A window wider than a hemisphere is not a window: at that size the view
    // IS the backdrop's own zoom and there is nothing underneath to hide.
    if (!(span > 0) || span >= 180) {
      hole.on.value = 0;
      return;
    }
    const rad = Math.PI / 180;
    hole.y.value.set(Math.sin(south * rad), Math.sin(north * rad));
    // The normal of the meridian plane at L is the direction at (0, L + 90):
    // everything east of L has a positive dot with it. Taken from the viewer's
    // own transform, so no convention is being guessed at.
    hole.west.value.copy(toDir(0, west + 90, 1)).normalize();
    hole.east.value.copy(toDir(0, east + 90, 1)).normalize();
    hole.on.value = 1;
  }

  /** The lon/lat box a tile covers, for deciding whether the view hides it. */
  function tileBounds(z, x, y) {
    const n = 2 ** z;
    const lat = (yy) => {
      const t = Math.PI * (1 - (2 * yy) / n);
      return (Math.atan(Math.sinh(t)) * 180) / Math.PI;
    };
    return {
      west: (x / n) * 360 - 180,
      east: ((x + 1) / n) * 360 - 180,
      north: lat(y),
      south: lat(y + 1),
    };
  }

  /**
   * Show exactly this set, with the view's tiles on top — and the backdrop
   * only where the view is not.
   *
   * The world underneath exists so the far side of the planet is mapped. Where
   * the view's own tiles cover the same ground it is not just redundant, it is
   * WRONG the moment the layer is not opaque: a coarse generalisation showing
   * through a fine one reads as "fragmented polygons not linked to the real
   * geology" — big angular shapes that belong to no unit on screen. So a
   * backdrop tile that the view overlaps is switched off; spin the globe and
   * it comes back for the ground the view has left behind.
   */
  function showTiles(next, sharp = null) {
    next.forEach((id) => {
      const tile = tiles.get(id);
      if (tile && tile.state === "ready" && tile.features.length) build(tile);
    });
    tiles.forEach((tile, id) => {
      if (!tile.node) return;
      tile.node.visible = next.has(id);
      const lift = sharp && sharp.has(id) ? 0.5 : 0;
      // Recorded on the node as well as applied: `applyStack` re-stamps every
      // node on each hierarchy change and would otherwise flatten this half
      // step, which is the only thing keeping the fine map above the coarse
      // one now that the backdrop is no longer cut away beneath it.
      tile.node.traverse((child) => {
        child.userData.renderLift = lift;
        child.renderOrder = group.renderOrder + lift;
      });
    });
    visible = next;
    sharpSet = sharp ? new Set(sharp) : new Set();
    maskBackdrop();
  }

  /** Bounded, least-recently-needed — and the backdrop is never a candidate. */
  function evict() {
    const built = [...tiles.values()].filter((t) => t.node
      && !visible.has(key(t.z, t.x, t.y)) && !pinned.has(key(t.z, t.x, t.y)));
    if (tiles.size <= cacheTiles) return;
    built.sort((a, b) => a.used - b.used);
    while (built.length && tiles.size > cacheTiles) {
      const oldest = built.shift();
      dropNode(oldest);
      tiles.delete(key(oldest.z, oldest.x, oldest.y));
    }
  }

  /**
   * Load the backdrop set and keep it. Called once, before the first update.
   */
  async function pin({ bounds, zoom, onProgress = null, signal = null } = {}) {
    const z = Math.max(0, Math.min(maxZoom, Math.round(zoom)));
    const wanted = tilesForBounds(bounds, z);
    await fetchInto(wanted, onProgress, signal);
    baseZoom = z;
    wanted.forEach((t) => pinned.add(key(t.z, t.x, t.y)));
    showTiles(new Set([...pinned]));
    // The first view has no history to predict from, and without this it took
    // whatever the tile budget allowed: measured, 49,150 features and fifty
    // seconds. The backdrop is a fair starting point - the whole world at a
    // known zoom, with a known count.
    seen = { zoom: z, bounds, features: featureCount() };
    return { zoom: z, tiles: wanted.length, features: featureCount() };
  }

  /**
   * Make the tiles for one view ready, then show them all at once.
   *
   * Returns what happened, in the terms the panel reports: how many tiles the
   * view needed, how many were already in hand, and how many could not be had.
   */
  async function update({
    bounds, zoom, onProgress = null, signal = null,
    featureBudget = 24000, minZoom = 0,
  } = {}) {
    const z = chooseZoom(bounds, zoom, featureBudget, minZoom);
    const wanted = tilesForBounds(bounds, z).slice(0, maxTiles);
    const mine = ++generation;
    const needed = wanted.map((t) => key(t.z, t.x, t.y));
    let cached = 0;
    let failed = 0;
    let bytes = 0;

    /**
     * Each tile goes up the moment it lands, rather than the view waiting for
     * its slowest tile.
     *
     * The atomic swap existed because a half-drawn view meant coarse tiles
     * fighting fine ones in an order nobody controls. The pinned backdrop
     * settled that: it is always underneath, the view's tiles always draw
     * above it, and two tiles at the same zoom never overlap — so there is
     * nothing left for an early tile to fight with. Measured over Europe: the
     * first detail lands in about a second instead of after all sixteen.
     */
    const early = (id) => {
      if (mine !== generation) return;
      const tile = tiles.get(id);
      if (!tile || tile.state !== "ready" || !tile.features.length) return;
      if (!needed.includes(id)) return;
      build(tile);
      tile.node.visible = true;
      tile.node.traverse((child) => {
        child.userData.renderLift = 0.5;
        child.renderOrder = group.renderOrder + 0.5;
      });
      visible.add(id);
    };
    const result = await fetchInto(wanted, onProgress, signal, early);
    cached = result.cached;
    failed = result.failed;
    bytes = result.bytes;
    // A newer view asked while this one was loading: its tiles are in the cache
    // for whoever wants them, but it must not become the picture.
    if (mine !== generation) return null;

    // Then the tidy-up pass: everything the view wants on, everything else off.
    showTiles(new Set([...pinned, ...needed]), new Set(needed));
    evict();
    /**
     * What the VIEW cost — not the backdrop.
     *
     * `featureCount()` counts everything on screen, and the world underneath is
     * most of that at a wide view. Feeding it back as the prediction's base
     * made every next choice look ruinous and the zoom collapsed to the
     * backdrop's own level: measured, zoom 2 at every altitude from 15,000 km
     * down to 1,000.
     */
    seen = {
      zoom: z,
      bounds,
      features: needed.reduce((n, id) => n + (tiles.get(id)?.features?.length || 0), 0),
    };

    return {
      zoom: z,
      asked: Math.round(zoom),
      tiles: wanted.length,
      cached,
      fetched: wanted.length - cached - failed,
      failed,
      bytes,
      features: featureCount(),
      bounds,
    };
  }

  function shownTiles() {
    return [...visible].map((id) => tiles.get(id)).filter((t) => t && t.state === "ready");
  }

  /**
   * What the layer HAS, for the click card, clipping, sampling and export.
   *
   * The finest zoom on screen wins: the backdrop and the view's tiles cover
   * the same ground twice, and handing both to an extraction would count that
   * ground twice at two different generalisations.
   */
  function features() {
    const shown = shownTiles();
    if (!shown.length) return [];
    const finest = Math.max(...shown.map((t) => t.z));
    const out = [];
    shown.filter((t) => t.z === finest).forEach((tile) => {
      clipped(tile).forEach((f) => out.push(f));
    });
    return out;
  }

  /**
   * The features covering a BOX — fetched if they are not already held.
   *
   * `features()` answers "what is on screen", which is right for the click
   * card and catastrophic for an extraction: a study area is drawn, the camera
   * is somewhere else or mid-refine, and the polygon comes back with NOTHING
   * in it. Measured exactly that way — a square over Northern Ireland with the
   * geological map plainly drawn on the globe, and the panel reporting
   * "1 vector layer: 0 of 0 features within" while its own tick list said
   * 9,137 features. The list counted the screen; the clip read the same
   * screen a moment later, after a rebuild had emptied `visible`.
   *
   * An extraction asks about GROUND, so this asks the tiler about ground. It
   * chooses the zoom the box deserves under a budget, fetches whatever is
   * missing (the cache means a second extraction over the same area costs
   * nothing), and returns those tiles' features — WITHOUT touching `visible`,
   * `generation` or the scene, so extracting never changes the picture.
   */
  /** Vertices of the features that actually touch this box — the honest
   *  measure of how much boundary detail a level is giving you. Feature COUNT
   *  is not: a deeper tile can hold fewer, larger pieces of the same ground. */
  /**
   * How much boundary detail a level carries OVER THIS GROUND.
   *
   * Counted as vertices lying INSIDE the box, and the distinction is the whole
   * value of the function. It used to count every vertex of any feature that
   * merely TOUCHED the box — so a coarse level, where one unit sprawls across
   * several degrees, contributed that whole polygon's thousands of vertices
   * for the sake of one corner overlapping, while a fine level, where the same
   * ground arrives as tile-clipped pieces, contributed only what is actually
   * there. Coarse therefore SCORED HIGHER, the climb picked it, and two barren
   * levels later it stopped.
   *
   * Measured on a 1.2 x 0.5 degree box over the north coast: every budget --
   * balanced, full and maximum alike -- returned **zoom 8 with 2 tiles**, when
   * zoom 9 needs six and nothing was anywhere near a budget. The climb was not
   * being stopped by cost; it was being told that coarser was better.
   *
   * That is what "the polygons might exist underneath the grey" was: not
   * anything hidden, but one generalised unit standing in for ground that
   * finer levels resolve into several.
   */
  function detailWithin(features, bounds) {
    let verts = 0;
    for (const f of features) {
      const g = f?.geometry;
      if (!g) continue;
      const parts = g.type === "MultiPolygon" ? g.coordinates
        : g.type === "Polygon" ? [g.coordinates] : null;
      if (!parts) continue;
      for (const rings of parts) {
        for (const r of rings) {
          for (const [x, y] of r) {
            if (x >= bounds.west && x <= bounds.east
              && y >= bounds.south && y <= bounds.north) verts += 1;
          }
        }
      }
    }
    return verts;
  }

  /** One level, fetched into the cache and read back. Draws nothing. */
  /**
   * A level that cannot be COVERED is REFUSED, never truncated.
   *
   * This used to be `tilesForBounds(bounds, z).slice(0, maxTiles)` with
   * `maxTiles` at SIXTEEN — a silent truncation, and the same fault
   * `chooseZoom` documents for the display path, left standing on the path
   * every extraction and clip takes. The damage is worse here, because the
   * climb in `featuresIn` reads a truncated level as the SOURCE RUNNING OUT:
   * fewer tiles fetched, fewer vertices counted, `detail` falls, the level is
   * called barren and the climb stops.
   *
   * Measured live over Northern Ireland, before this: a 2.8 x 1.3 degree study
   * area shipped at **zoom 8** because zoom 9 needs 20 tiles, and a 0.6 x 0.45
   * degree one at **zoom 10** because zoom 11 needs 30. Both stopped at exactly
   * the last level fitting under 16 — not at the source's own ceiling, which is
   * zoom 11. Three levels of generalisation, and it is generalisation that
   * opens the gaps at contacts: at zoom 4 this file measured 280 dark holes and
   * at zoom 9 zero, because at native scale the polygons still share their
   * boundaries.
   *
   * `maxTiles` still bounds what is DRAWN, which is what it was written for.
   * A probe draws nothing and gets its own budget.
   */
  async function levelFeatures(bounds, z, signal, cap = maxTiles) {
    const needed = tilesForBounds(bounds, z);
    if (!needed.length) return { features: [], zoom: z, tiles: 0, needed: 0 };
    if (needed.length > cap) {
      return { features: [], zoom: z, tiles: 0, needed: needed.length, refused: true };
    }
    await fetchInto(needed, null, signal, null);
    const out = [];
    needed.forEach((t) => {
      const tile = tiles.get(key(t.z, t.x, t.y));
      if (tile?.state === "ready") clipped(tile).forEach((f) => out.push(f));
    });
    return { features: out, zoom: z, tiles: needed.length, needed: needed.length };
  }

  async function featuresIn(bounds, { zoom = null, featureBudget = 60000, signal = null,
    tileBudget = AUTO_TILE_BUDGET, maxProbeTiles = null } = {}) {
    // `maxProbeTiles` was the old name and some callers may still pass it.
    const budget = Math.max(1, Number(maxProbeTiles ?? tileBudget) || AUTO_TILE_BUDGET);
    if (!bounds || !Number.isFinite(bounds.west)) return { features: [], zoom: null, tiles: 0 };
    /**
     * The zoom a BOX deserves, because there is no camera to ask.
     *
     * `chooseZoom` refines from a starting level and starts at
     * `Math.round(asked)` — and `Math.round(null)` is ZERO, so passing no zoom
     * silently asked for the single world tile. That tile holds 5,792 units
     * for the whole planet, generalised so hard that this file already records
     * point-in-polygon finding nothing under Northern Ireland; measured, a
     * study area there clipped 3 features out of it and they were units like
     * "Precambrian-Phanerozoic crystalline metamorphic rocks". A silent zero
     * from a null is exactly the NaN-compares-false shape.
     *
     * EPSG:4326 is 2x1 at zoom 0, so a tile spans 360/2^(z+1) degrees: the
     * level where the box covers about two tiles across is log2(720/W) - 1.
     * chooseZoom then still applies its own budget from there, so this only
     * sets an honest starting point.
     */
    if (zoom != null) {
      // An explicit level is honoured exactly — the caller has said what it
      // wants and the display path depends on that. It is still walked DOWN to
      // something coverable rather than truncated, and says so, because a
      // half-covered answer read as a whole one is the fault this whole path
      // was built around.
      let z = chooseZoom(bounds, zoom, featureBudget, 0);
      let got = await levelFeatures(bounds, z, signal, budget);
      while (got.refused && z > 0) {
        z -= 1;
        got = await levelFeatures(bounds, z, signal, budget);
      }
      return { ...got, asked: zoom, walkedDown: z < chooseZoom(bounds, zoom, featureBudget, 0) };
    }

    /**
     * CLIMB TO THE BEST LEVEL, because an extraction wants the data, not the
     * picture.
     *
     * The display's zoom is chosen under a FEATURE BUDGET whose whole purpose
     * is to protect the frame rate — irrelevant here, where nothing is drawn.
     * Clipping at the screen's level took what the screen happened to be
     * showing: measured on a 0.5 degree study area over Northern Ireland, the
     * clip captured 81 features and 1,314 vertices where 151 and 2,543 were
     * there to be had.
     *
     * Nor is "as deep as possible" the answer. Macrostrat's tiles have their
     * own ceiling and go THINNER past it, not finer — measured on the same
     * box: 88 features at zoom 7, 106 at 10, 151 at 11, then 123 at 12 and 38
     * at 13, with the unit count collapsing 22 to 15 to 8. Asking for the
     * deepest level available would have returned a fifth of the map.
     *
     * So it climbs while the ground gets MORE detailed and stops at the first
     * level that gives less, which needs no ceiling written down anywhere and
     * follows each source's own limit. Detail is counted in VERTICES of the
     * features touching the box, never in feature count: a deeper tile can
     * hold fewer, larger pieces of the same ground.
     */
    const start = Math.max(0, zoomForBounds(bounds, { maxZoom }) - 2);
    /**
     * LOOK SHALLOWER FIRST, or a small box never meets the other surveys.
     *
     * The climb starts near the level a box's SIZE deserves and only goes
     * deeper. That is right for choosing detail and wrong for finding
     * datasets: this source composites several surveys and switches between
     * them by scale, so a survey that lives at zoom 5-6 is invisible to a box
     * whose climb starts at 10. Measured — a 34 km study area on the north
     * coast starts at zoom 10 and never sees the offshore survey at all, while
     * a degree-wide box starts at 5 and finds it immediately. The merge could
     * only ever fill from levels it had actually looked at.
     *
     * So the sweep begins below the start and walks up. The shallow levels are
     * one or two tiles each — this costs almost nothing, and it is the only
     * way `deepestFor` can know a survey exists at all.
     */
    const floor = Math.max(0, start - SHALLOW_LOOKBACK);
    let best = null;
    let barren = 0;
    // The fullest-covering level seen, kept so a deeper, partial level can be
    // filled from it rather than refused outright.
    let fallback = null;
    // Each SURVEY at the deepest level that carries it, so a dataset that
    // disappears from the deep tiles is filled from its own best level rather
    // than from whichever single level happened to cover the most ground.
    const deepestFor = new Map();
    // What each level would have cost, so a caller can OFFER the levels this
    // source actually supports over this ground rather than guessing at them.
    const levels = [];
    let stoppedFor = null;
    for (let z = floor; z <= maxZoom + 3; z += 1) {
      const needed = tilesForBounds(bounds, z).length;
      // A probe costing more tiles than the budget allows ends the climb — and
      // it is recorded as a BUDGET stop, not as the source running out, so the
      // difference is visible to whoever is deciding what to ship.
      if (needed > budget) {
        levels.push({ zoom: z, tiles: needed, overBudget: true });
        if (best) { stoppedFor = "budget"; break; }
        // Nothing in hand yet: the box is huge, so take the coarsest level
        // that does fit rather than returning nothing at all.
        continue;
      }
      const got = await levelFeatures(bounds, z, signal, budget);
      let features = got.features;
      let coverage = coverageWithin(features, bounds);
      /**
       * What this level covers ON ITS OWN, before anything is filled in.
       *
       * `coverage` below is measured AFTER the merge, so every level reads
       * near-100% and is useless for choosing between them. A caller that
       * wants to know which single level to DRAW — the streaming clip picks a
       * pinned floor this way — needs the level's own reach, and picking on
       * the merged figure chose a level covering 42.9% while believing it had
       * everything.
       */
      const ownCoverage = coverage;

      // The fullest-covering level seen so far is what gaps are filled FROM.
      if (!fallback || coverage > fallback.coverage + COVERAGE_TOLERANCE) {
        fallback = { features: got.features, coverage, zoom: z };
      }
      /**
       * Every SURVEY, remembered at the deepest level that still carries it.
       *
       * Filling from one fallback level drops any survey that level does not
       * have either. Measured over a box across the North Channel: source 7
       * appears at zoom 5 and 6 and is GONE by 7, while the deepest reachable
       * level is 8 — so the fill, which read zoom 8, never saw it and the
       * dataset vanished from the clip entirely. Reported as failing to pull
       * the bathymetry and the Irish geology.
       *
       * A later level overwrites an earlier one for the same key, so each
       * survey ends up held at its own best level rather than at whichever
       * level happened to cover the most ground.
       */
      const here = new Map();
      for (const f of got.features) {
        const k = sourceKey(f);
        const list = here.get(k) || here.set(k, []).get(k);
        list.push(f);
      }
      for (const [k, list] of here) deepestFor.set(k, { zoom: z, features: list });

      /**
       * MERGE THE LEVELS: the finer survey where it exists, the fuller one
       * where it does not.
       *
       * A deeper level here is not a finer drawing of the same ground — it can
       * be a different, PARTIAL survey, because this source composites several
       * and switches between them by scale. Refusing the deeper level keeps the
       * map whole but throws away real detail where the finer survey DOES
       * reach. Taking it whole loses 44% of the ground. Neither is "all the
       * geology that exists within these bounds".
       *
       * The fill is BY SOURCE DATASET, which is exact rather than geometric
       * because the surveys MOSAIC: measured over a cross-border box, of 4,900
       * sample points **one** was covered by more than one source. So the
       * ground a deep level is missing is precisely the ground belonging to
       * the surveys it does not carry — measured, **2,155 of the 2,158 points
       * (99.86%)** the deep level missed. Filling those in costs no boolean
       * geometry and cannot double-cover.
       *
       * The last 0.14% is a survey the deep level DOES carry that generalises
       * differently at the coast. It stays uncovered rather than being papered
       * over with a coarser copy of ground the finer map has already spoken
       * for, which would double-count it in an extraction.
       */
      let filled = 0;
      const carried = new Set(features.map(sourceKey));
      const missing = [];
      for (const [k, rec] of deepestFor) {
        if (!carried.has(k)) missing.push(...rec.features);
      }
      if (missing.length) {
        features = features.concat(missing);
        filled = missing.length;
        coverage = coverageWithin(features, bounds);
      }

      const detail = detailWithin(features, bounds);
      levels.push({
        zoom: z, tiles: got.tiles, features: features.length, detail, coverage,
        ownCoverage, filled,
      });

      /**
       * COVERAGE FIRST, and only once the merge has had its chance. A level
       * still short of the ground after filling has lost something the fill
       * cannot replace, and is not a better level however finely it draws
       * what is left.
       */
      if (fallback && coverage < fallback.coverage - COVERAGE_TOLERANCE) {
        stoppedFor = "coverage";
        break;
      }
      got.features = features;
      if (!best || detail > best.detail) {
        best = { ...got, detail, coverage };
        barren = 0;
        continue;
      }
      /**
       * The curve DIPS before it peaks, so one bad level is not the ceiling.
       * Measured over Northern Ireland: 1,853 vertices at zoom 7, 1,856 at 8,
       * then 1,793 at 9 — and 2,177 at 10 and 2,543 at 11. Stopping at the
       * first level that gave less would have returned zoom 8 and thrown away
       * the best of the map two levels further on. Two barren levels in a row
       * is the source having actually run out.
       */
      /**
       * The barren counter only runs once the sweep has reached the level the
       * box actually deserves. Below that it is walking UP to the interesting
       * levels, and a shallow level giving less detail than the one below it
       * is the ordinary shape of a pyramid, not the source running out.
       */
      if (z < start) continue;
      barren += 1;
      if (barren >= 2) { stoppedFor = "source"; break; }
    }
    /**
     * WHICH SURVEY IS THE FINE ONE, answered by the source rather than guessed.
     *
     * `deepestFor` already knows: this source composites several surveys and
     * switches between them BY SCALE, so the deepest level a survey survives
     * to is its own scale, stated by the publisher. A regional map stops being
     * served around zoom 6 and a national one runs to 13.
     *
     * It was thrown away here, and everything downstream that needed to know
     * which survey outranks which had to infer it from the geometry. Vertices
     * per unit area is the obvious proxy and it is WRONG: measured over
     * Inishowen it scored Macrostrat's source 154 above source 147 (1,157 to
     * 797) because 147's units came back from the API as smooth verbatim
     * shapes while 154 arrived as ragged tile pieces. The coarser map then
     * outranked the finer one and cut it away, and the study area filled with
     * a regional blanket over ground a better survey had already mapped.
     */
    const sourceZooms = {};
    for (const [key, rec] of deepestFor) sourceZooms[key] = rec.zoom;
    return best
      ? { ...best, levels, sourceZooms, stoppedFor: stoppedFor || "source", budget }
      : { features: [], zoom: start, tiles: 0, levels, sourceZooms, stoppedFor, budget };
  }

  function featureCount() {
    return shownTiles().reduce((n, tile) => n + tile.features.length, 0);
  }

  /**
   * Recolour every tile in view.
   *
   * A tile's colours live in its geometry, so this rebuilds the visible tiles
   * and drops the rest — they will be rebuilt with the new colours if the view
   * comes back to them. Only ever called when somebody changes the symbology,
   * never because the camera moved.
   */
  function repaint(colourFn) {
    paint = colourFn || null;
    const shown = shownTiles();
    tiles.forEach((tile) => { if (!visible.has(key(tile.z, tile.x, tile.y))) dropNode(tile); });
    shown.forEach((tile) => {
      dropNode(tile);
      build(tile).visible = true;
    });
    return shown.length > 0;
  }

  /** The layer's opacity, remembered so tiles built later match the rest. */
  function setOpacity(value) {
    opacity = Number.isFinite(value) ? value : 1;
  }

  /**
   * Change how contacts are drawn, rebuilding what is on screen.
   *
   * A rebuild rather than a material tweak because the ink is baked into the
   * seal's per-vertex COLOUR — which is what lets each contact carry its own
   * unit's hue. Same shape as `repaint`, and it reuses it: the tiles are
   * already in hand, so this re-triangulates but fetches nothing.
   */
  function setContacts(style) {
    contactStyle = style || null;
    return repaint(paint);
  }

  function dispose() {
    tiles.forEach((tile) => dropNode(tile));
    tiles.clear();
    visible = new Set();
  }

  return {
    group,
    update,
    pin,
    maskBackdrop,
    setOpacity,
    setContacts,
    // Published so a CLIP can wear the same contacts as the map it came from.
    // Without it `controller.getContacts?.()` was silently undefined and every
    // clipped layer fell back to the invisible "match" seal, so the source drew
    // its unit boundaries and the clip of it did not.
    getContacts: () => contactStyle,
    // Published so a CLIPPED layer can be built on the same tile service its
    // source streams from, rather than being told about it a second time.
    sources,
    setClip: (mask) => { clipMask = mask || null; return repaint(paint); },
    getClip: () => clipMask,
    features,
    featuresIn,
    featureCount,
    repaint,
    dispose,
    stats: () => ({
      cached: tiles.size,
      built: [...tiles.values()].filter((t) => t.node).length,
      visible: visible.size,
      features: featureCount(),
    }),
  };
}

/**
 * The tile index of a baked copy, if the site is carrying one.
 *
 * A manifest rather than a probe: asking the server for a tile that is not
 * there costs a round trip and a 404 in the console for every empty ocean
 * tile, and there are thousands of those.
 */
export async function loadManifest(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const index = body.tiles || {};
    return {
      base: url.replace(/\/manifest\.json.*$/, ""),
      version: body.version || null,
      maxZoom: body.max_zoom ?? 0,
      count: Object.keys(index).length,
      licence: body.licence || null,
      has: (path) => Object.prototype.hasOwnProperty.call(index, path),
      // The bytes of a baked tile, which is how the cost of a view is known
      // before any of it is fetched. `null` means "not baked, cannot say".
      size: (path) => (Object.prototype.hasOwnProperty.call(index, path) ? index[path] : null),
    };
  } catch {
    return null;
  }
}
