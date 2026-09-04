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

import * as dem from "./dem-tiles.js?v=20260904-f8b0917";
import { visibleBounds, viewChangedEnough, onViewSettled } from "./view-extent.js?v=20260904-f8b0917";

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

/**
 * STANDING IN, when the shipped elevation model cannot be read at all.
 *
 * The texture is in a bucket and three.js loads it with
 * `crossOrigin="anonymous"`, so on an origin the bucket does not answer for it
 * loads and cannot be read back: the cursor readout goes to "n/a", the terrain
 * slider disables itself and every height in the app is null. Measured on
 * `http://localhost:8123`, where four of the viewer's own assets come back with
 * status 0.
 *
 * Terrarium is on AWS and answers `Access-Control-Allow-Origin: *` to
 * everybody, so it can carry the READER on any origin. It cannot carry the
 * DISPLACEMENT — the shader needs a texture — so the globe stays flat and the
 * exaggeration stays disabled, which is honest: what comes back is the height
 * of a place, not the shape of the drawn ground.
 *
 * Standing in, the floor drops to zoom 3 (about 19 km posts, no worse than the
 * texture it is replacing) because ANY answer beats none, and the view centre
 * is used when `visibleBounds` cannot see the globe — which at the opening
 * view it cannot.
 */
const STANDIN_MIN_ZOOM = 3;

/** The pinned world cover: parity with the texture, everywhere. */
const WORLD_ZOOM = 3;

function standingIn() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.hasElevationModel) return false;
  return viewer.hasElevationModel() === false;
}

/**
 * A box around what the camera is looking at, for when the raycast cannot
 * answer. `visibleBounds` samples rays through the screen and hands back an
 * object full of nulls where fewer than three of them meet the globe, which is
 * the ordinary state at the opening view. The centre and the altitude are
 * always known.
 */
function viewCentreBox(viewer) {
  const centre = viewer.getViewCentreLatLon?.();
  if (!centre || !Number.isFinite(centre.lat)) return null;
  const metres = viewer.getZoomAltitudeMetres?.()?.metres;
  const km = Number.isFinite(metres) ? metres / 1000 : 8000;
  /**
   * Capped at 15°, which is about what a dozen tiles can carry at a useful
   * spacing. A reader hovering over a global view wants the ground under the
   * cursor, not a hemisphere at any price: past this the box resolves so
   * coarse that the answer is no better than the texture it is standing in
   * for, and it costs several megabytes to say so.
   */
  const half = Math.min(15, Math.max(0.05, km / 111));
  const lon = centre.lon > 180 ? centre.lon - 360 : centre.lon;
  /**
   * IN THE VIEWER'S OWN VOCABULARY, and that is not decoration.
   *
   * `viewChangedEnough` reads `minLon/maxLon/minLat/maxLat` and nothing else,
   * so handing it a `west/east` box makes every span NaN, every comparison
   * false, and the stand-in silently never fetches. The tile side takes any of
   * the three spellings; this side takes exactly one.
   */
  return {
    minLon: lon - half,
    maxLon: lon + half,
    minLat: Math.max(-85, centre.lat - half),
    maxLat: Math.min(85, centre.lat + half),
  };
}

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
  const standIn = standingIn();
  // Where the raycast cannot answer, the view centre still can -- and with no
  // elevation model at all that is the difference between a readout and "n/a".
  const box = finite ? bounds : (standIn ? viewCentreBox(viewer) : null);
  if (!box) return;
  if (!viewChangedEnough(lastView, box)) return;
  busy = true;
  try {
    const floor = standIn ? STANDIN_MIN_ZOOM : VIEW_MIN_ZOOM;
    const zoom = dem.chooseZoom(box, { maxTiles: VIEW_TILES });
    if (zoom === null || zoom < floor) return;
    lastView = box;
    await dem.ensure(box, { maxTiles: VIEW_TILES });
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
  /**
   * The stand-in has to arrive without being asked, or the first thing a
   * reader sees on a broken origin is still "n/a": the settle watcher only
   * fires when the camera MOVES, and a page that has just loaded has not
   * moved. One pass a beat after boot, once the viewer has had time to say
   * whether it has a model.
   */
  setTimeout(() => {
    if (!standingIn()) return;
    /**
     * COVER THE WHOLE WORLD FIRST, then follow the view.
     *
     * A reader that only holds the patch last looked at answers "n/a" the
     * moment the cursor moves off it, which is what a stand-in is least
     * allowed to do — reported as "not 100% coverage", and measured at 4 tiles
     * around the view centre with every other place on Earth null. The zoom-3
     * world is the same 19.6 km sampling as the texture it replaces, for about
     * 5.8 MB against that texture's 21, and it is PINNED so the view's own
     * tiles cannot evict it.
     *
     * The follow still runs on top and still refines wherever somebody looks;
     * this is the floor under it.
     */
    void dem.ensureWorld(WORLD_ZOOM).then(() => followView());
  }, 2500);
}

window.GeoIDDem = {
  heightAt: dem.heightAt,
  ensureWorld: dem.ensureWorld,
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
