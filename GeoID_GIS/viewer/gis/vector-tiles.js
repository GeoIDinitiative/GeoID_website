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
import { decodeTile, tilesForBounds } from "./mvt.js?v=20260821-521ca21";
import { renderFeatureCollection } from "./vector-render.js?v=20260821-521ca21";

const key = (z, x, y) => `${z}/${x}/${y}`;

/** Fetch one tile, local copy first. */
async function loadTile(sources, z, x, y, signal) {
  const path = `${z}/${x}/${y}`;
  const local = sources.local && sources.has?.(path)
    ? `${sources.local}/${path}.mvt`
    : null;
  const urls = local ? [local] : [];
  if (sources.remote) {
    urls.push(`${sources.remote}/${path}.mvt`);
    // A URL the CDN has not cached, for the objects it cached without their
    // CORS header — see the note in macrostrat.js. One retry, never a loop.
    urls.push(`${sources.remote}/${path}.mvt?cors=1`);
  }
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
export function createTiledVectorLayer({
  name = "vector tiles",
  kind = "units",
  sources,
  colourFor = null,
  cacheTiles = 64,
  maxTiles = 16,
  maxZoom = 13,
} = {}) {
  // Unversioned, exactly as every other module imports it: a second copy of
  // three.js on the page breaks class identity and nothing is a Mesh any more.
  const group = new THREE.Group();
  group.name = name;

  /** key -> { z, x, y, features, node, used, state } */
  const tiles = new Map();
  let paint = colourFor;
  let opacity = 1;
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
      { type: "FeatureCollection", features: tile.features },
      {
        name: `${name} ${tile.z}/${tile.x}/${tile.y}`,
        colourFor: paint,
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
    const fromManifest = (level) => {
      if (!sources.size) return null;
      let bytes = 0;
      const want = tilesForBounds(bounds, level);
      for (const t of want) {
        const known = sources.size(`${t.z}/${t.x}/${t.y}`);
        if (known === null) return null;           // past the bake: cannot say
        bytes += known;
      }
      return (bytes / 1024) * FEATURES_PER_KB;
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
      tile.node.traverse((child) => { child.renderOrder = group.renderOrder + lift; });
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
      tile.node.traverse((child) => { child.renderOrder = group.renderOrder + 0.5; });
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
      tile.features.forEach((f) => out.push(f));
    });
    return out;
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
    features,
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
