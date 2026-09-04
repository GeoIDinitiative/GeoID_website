/**
 * The streamed DEM, driven: it follows the view, and any run that names a
 * patch of ground can ask for that ground first.
 *
 * `dem-tiles.js` is the source and the arithmetic; this is the policy — when
 * to fetch, how much, and what the rest of the app is allowed to ask for. The
 * seam it publishes is deliberately small:
 *
 *   heightAt(lat, lon)   metres, or null where nothing has been fetched
 *   ensure(bounds, opts) fetch what covers this ground, and say what it cost
 *   plan(bounds, opts)   what that WOULD cost, touching no network
 *
 * `heightAt` answering null is the whole contract with the viewer: a place
 * nobody has streamed behaves exactly as it did before this existed, on the
 * globe's own texture.
 */

import * as dem from "./dem-tiles.js?v=20260904-198b771";
import { visibleBounds, viewChangedEnough, onViewSettled } from "./view-extent.js?v=20260904-198b771";

let THREE = null;
let watchStop = null;
let lastView = null;
let busy = false;

/**
 * Below this the streamed answer is no better than the one already on the
 * globe, so the view does not pay for it.
 *
 * The shipped elevation texture measures **19.6 km** of native sampling on
 * Earth, so the bar is low: a zoom-6 post is about 2.4 km at 54°N, still eight
 * times finer than what is already there. Set at 8 it was effectively dead —
 * the camera cannot get below about 995 km without a drape, and a 995 km view
 * resolves to zoom 5 or 6 under a twelve-tile budget, so the follow would have
 * fired only in sessions that had already streamed a tile basemap.
 *
 * The tools have their own floor and their own budget, because they are asking
 * about a study area rather than about a view.
 */
const VIEW_MIN_ZOOM = 6;

/** A view is a glance, not a study: a dozen tiles, and only while still. */
const VIEW_TILES = 12;

/** A run over a study area is worth more, and is asked for once. */
const RUN_TILES = 48;

/**
 * Follow the view.
 *
 * On REST, never per frame — the same rule the geology refine and the imagery
 * patch already answer to. A drag issues one round of tiles at the end rather
 * than thousands on the way, and `viewChangedEnough` keeps a settle that moved
 * nowhere from re-fetching what is already held.
 */
async function followView() {
  if (busy) return;
  const viewer = window.GeoIDViewer;
  if (!viewer) return;
  if (!THREE) THREE = await import("../vendor/three.module.js");
  const bounds = visibleBounds(viewer, THREE);
  /**
   * A VIEW THAT CANNOT BE ANSWERED IS AN OBJECT FULL OF NULLS, not a null.
   *
   * `visibleBounds` raycasts a grid through the screen and, where fewer than
   * three rays meet the globe, hands back `{minLon: null, ...}` — measured, at
   * a view where the planet subtends almost nothing. A truthiness check passes
   * that straight through, and the box normaliser then refuses it by throwing
   * into a settle callback nobody is awaiting: one silent unhandled rejection
   * per settle, for the life of the page.
   */
  const finite = bounds && [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat]
    .every((v) => Number.isFinite(v));
  if (!finite) return;
  if (!viewChangedEnough(lastView, bounds)) return;
  busy = true;
  try {
    const zoom = dem.chooseZoom(bounds, { maxTiles: VIEW_TILES });
    if (zoom === null || zoom < VIEW_MIN_ZOOM) return;
    lastView = bounds;
    await dem.ensure(bounds, { maxTiles: VIEW_TILES });
  } catch (error) {
    // A view the sampler cannot use is not a reason to stop following the
    // camera, and there is nothing on screen waiting for this.
  } finally {
    busy = false;
  }
}

/**
 * Ask for a patch of ground and WAIT for it.
 *
 * This is the call a tool makes before it samples. It is bounded by
 * `RUN_TILES` rather than by the view's budget: a study area is the thing
 * being asked about, so it is worth 48 tiles where a glance is worth 12.
 */
async function ensureFor(bounds, options = {}) {
  return dem.ensure(bounds, { maxTiles: RUN_TILES, ...options });
}

function start() {
  if (watchStop) return;
  const viewer = window.GeoIDViewer;
  if (!viewer) { setTimeout(start, 400); return; }
  // 700 ms, matching the geology's own settle: a DEM fetch is cheap but it is
  // still somebody else's bucket, and nothing on screen is waiting for it.
  watchStop = onViewSettled(viewer, () => { void followView(); },
    { settleMs: 700, pollMs: 150 });
  void followView();
}

window.GeoIDDem = {
  heightAt: dem.heightAt,
  postMetresAt: dem.postMetresAt,
  ensure: ensureFor,
  plan: (bounds, options = {}) => dem.planCover(bounds, { maxTiles: RUN_TILES, ...options }),
  state: dem.state,
  metresPerPixel: dem.groundMetresPerPixel,
  credit: dem.TERRARIUM.credit,
  source: dem.TERRARIUM,
  stop: () => { watchStop?.(); watchStop = null; },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
