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
import { decodeTile, tilesForBounds } from "./mvt.js?v=20260821-8123962";
import { renderFeatureCollection } from "./vector-render.js?v=20260821-8123962";

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
  let visible = new Set();
  let generation = 0;
  let inflight = null;

  const build = (tile) => {
    if (tile.node) return tile.node;
    const built = renderFeatureCollection(
      { type: "FeatureCollection", features: tile.features },
      { name: `${name} ${tile.z}/${tile.x}/${tile.y}`, colourFor: paint },
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

  /** Bounded, least-recently-needed. Visible tiles are never evicted. */
  const evict = () => {
    const built = [...tiles.values()].filter((t) => t.node && !visible.has(key(t.z, t.x, t.y)));
    if (tiles.size <= cacheTiles && built.length <= cacheTiles) return;
    built.sort((a, b) => a.used - b.used);
    while (built.length && tiles.size > cacheTiles) {
      const oldest = built.shift();
      dropNode(oldest);
      tiles.delete(key(oldest.z, oldest.x, oldest.y));
    }
  };

  /**
   * Make the tiles for one view ready, then show them all at once.
   *
   * Returns what happened, in the terms the panel reports: how many tiles the
   * view needed, how many were already in hand, and how many could not be had.
   */
  async function update({ bounds, zoom, onProgress = null, signal = null } = {}) {
    const z = Math.max(0, Math.min(maxZoom, Math.round(zoom)));
    const wanted = tilesForBounds(bounds, z).slice(0, maxTiles);
    const mine = ++generation;
    const needed = wanted.map((t) => key(t.z, t.x, t.y));
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
        onProgress?.(done + cached, wanted.length);
      }
    };
    inflight = Promise.all([0, 1, 2, 3].map(worker));
    await inflight;
    // A newer view asked while this one was loading: its tiles are in the cache
    // for whoever wants them, but it must not become the picture.
    if (mine !== generation) return null;

    needed.forEach((id) => {
      const tile = tiles.get(id);
      if (tile && tile.state === "ready" && tile.features.length) build(tile);
    });
    // The swap: everything the view wants on, everything else off, in one pass.
    const next = new Set(needed);
    tiles.forEach((tile, id) => {
      if (!tile.node) return;
      tile.node.visible = next.has(id);
    });
    visible = next;
    evict();

    return {
      zoom: z,
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

  function features() {
    const out = [];
    shownTiles().forEach((tile) => tile.features.forEach((f) => out.push(f)));
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
    const index = new Set(Object.keys(body.tiles || {}));
    return {
      base: url.replace(/\/manifest\.json.*$/, ""),
      maxZoom: body.max_zoom ?? 0,
      count: index.size,
      licence: body.licence || null,
      has: (path) => index.has(path),
    };
  } catch {
    return null;
  }
}
