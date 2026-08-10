/**
 * What the camera is looking at, and when it has stopped moving.
 *
 * Both answers are needed by anything that refines with zoom — tile basemaps and
 * Earth Engine imports alike — so they live here rather than in one of them.
 * The bounds logic was `viewBounds()` inside `gee.js`, which is now the second
 * caller rather than the owner.
 *
 * **Settled, not continuous.** Refinement is one composite per view, fired when
 * the camera comes to rest, never per frame. A globe at 60 fps that re-fetched
 * on movement would issue thousands of requests for a single drag and behave
 * exactly like the bulk downloader every tile policy forbids. Waiting for rest
 * also means the extent asked for is the one being looked at, rather than a
 * blur of everywhere the camera passed through.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Roughly what the camera has in shot, as a lat/lon box.
 *
 * Sampled by raycasting a grid through the view rather than projecting the
 * sphere exactly: the answer only has to be about right, and a box that is a
 * little generous costs one extra ring of tiles.
 *
 * Read back through the globe's own frame with the half turn the viewer bakes
 * in. Computed in the unrotated frame instead, the box sat east of the view by
 * however far the planet had spun — which is the bug that made Earth Engine
 * imagery cover the wrong half of the picture.
 */
export function visibleBounds(viewer, THREE, { steps = 8, padFraction = 0.05 } = {}) {
  const camera = viewer?.camera;
  if (!camera || !THREE) return null;
  const radius = viewer.GLOBE_RADIUS || 3.2;
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);
  const ray = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  viewer.globe?.updateMatrixWorld(true);
  const toGlobe = viewer.globe
    ? new THREE.Matrix4().copy(viewer.globe.matrixWorld).invert()
    : null;

  const lats = [];
  const lons = [];
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      ray.setFromCamera(new THREE.Vector2((i / steps) * 2 - 1, (j / steps) * 2 - 1), camera);
      if (!ray.ray.intersectSphere(sphere, hit)) continue;
      const local = toGlobe ? hit.clone().applyMatrix4(toGlobe) : hit.clone();
      local.set(-local.x, local.y, -local.z);
      const r = local.length() || 1;
      lats.push(Math.asin(Math.max(-1, Math.min(1, local.y / r))) * DEG);
      lons.push(Math.atan2(local.z, -local.x) * DEG);
    }
  }
  if (lats.length < 3) return null;

  let minX = Math.min(...lons);
  let maxX = Math.max(...lons);
  if (maxX - minX > 180) {
    // Spanning the antimeridian: the widest gap between samples is the part NOT
    // being looked at, so use it as the seam rather than asking for the world.
    const sorted = [...lons].sort((a, b) => a - b);
    let gap = 0;
    let at = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i] - sorted[i - 1] > gap) { gap = sorted[i] - sorted[i - 1]; at = i; }
    }
    if (gap > 60) { minX = sorted[at]; maxX = sorted[at - 1] + 360; }
  }
  const pad = Math.min(2, (maxX - minX) * padFraction);
  const box = {
    minLon: Math.max(-180, minX - pad),
    maxLon: Math.min(180, maxX + pad),
    minLat: Math.max(-85, Math.min(...lats) - pad),
    maxLat: Math.min(85, Math.max(...lats) + pad),
  };
  return clampToForeground(box, viewer, THREE, sphere, ray, hit);
}

/**
 * Cut the box back to what is actually being looked at.
 *
 * Sampling rays across the viewport is right from orbit and badly wrong low
 * down, because the rays near the top of the screen grazed the horizon: at
 * 2.8 km up, where the view is 2.3 km across, the sampled box came out **28 km
 * wide — twelve times too big**. Two consequences, and the second is the one
 * people notice:
 *
 *   * the zoom chosen for that box is far coarser than the view deserves —
 *     10 m/px where 0.8 m/px was available;
 *   * and the box is dominated by the horizon rather than by altitude, so
 *     zooming IN barely changes it. `viewChangedEnough` then says nothing
 *     happened and no tiles are fetched. Zooming out does change it, which is
 *     exactly the reported "I have to zoom out for new tiles".
 *
 * So the raycast box is intersected with the ground the camera can actually
 * see: the distance to the surface along the centre ray, times the field of
 * view. High up that span exceeds the planet and the clamp does nothing, which
 * is why the far-field behaviour is unchanged.
 */
function clampToForeground(box, viewer, THREE, sphere, ray, hit) {
  const camera = viewer?.camera;
  if (!camera) return box;
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  if (!ray.ray.intersectSphere(sphere, hit)) return box;

  const distance = hit.distanceTo(camera.position);
  const radius = viewer.GLOBE_RADIUS || 3.2;
  const fov = ((camera.fov || 50) * Math.PI) / 180;
  // 1.6x the strict field of view: a ring of context around the view is worth
  // having, and it keeps a small pan from immediately needing new tiles.
  const spanScene = 2 * distance * Math.tan(fov / 2) * 1.6;
  const spanDeg = (spanScene / radius) * DEG;
  if (!Number.isFinite(spanDeg) || spanDeg <= 0) return box;

  const midLat = (box.minLat + box.maxLat) / 2;
  const midLon = (box.minLon + box.maxLon) / 2;
  const halfLat = spanDeg / 2;
  // A degree of longitude is shorter away from the equator, so the same ground
  // span covers more of them.
  const halfLon = halfLat / Math.max(0.05, Math.cos(midLat * RAD));

  return {
    minLat: Math.max(box.minLat, midLat - halfLat),
    maxLat: Math.min(box.maxLat, midLat + halfLat),
    minLon: Math.max(box.minLon, midLon - halfLon),
    maxLon: Math.min(box.maxLon, midLon + halfLon),
  };
}

/** Camera altitude above the surface, in globe units. */
export function altitudeUnits(viewer) {
  const radius = viewer?.GLOBE_RADIUS || 3.2;
  const length = viewer?.camera?.position?.length?.();
  return Number.isFinite(length) ? Math.max(0, length - radius) : Infinity;
}

/**
 * Has the view changed enough to be worth acting on?
 *
 * Pure, so the hysteresis can be tested without a camera. Two independent
 * reasons to refresh, because either alone lets a case through: the box can
 * shift sideways without changing size (panning at altitude), and it can shrink
 * without moving much (zooming into the centre).
 *
 * The thresholds are deliberately generous. A refresh costs a round of tiles, so
 * the failure to avoid is not "slightly stale" but "re-fetching the same view
 * because a pixel of drift crossed a tight threshold".
 */
export function viewChangedEnough(previous, next, { moveFraction = 0.35, zoomRatio = 1.6 } = {}) {
  if (!next) return false;
  if (!previous) return true;
  const spanOf = (b) => Math.max(1e-9, Math.max(b.maxLon - b.minLon, b.maxLat - b.minLat));
  const prevSpan = spanOf(previous);
  const nextSpan = spanOf(next);

  // Scale: a meaningful change in how much ground is in shot, either way.
  const ratio = prevSpan / nextSpan;
  if (ratio >= zoomRatio || ratio <= 1 / zoomRatio) return true;

  // Position: the centre has moved by a good part of the smaller view.
  const centre = (b) => [(b.minLon + b.maxLon) / 2, (b.minLat + b.maxLat) / 2];
  const [px, py] = centre(previous);
  const [nx, ny] = centre(next);
  const moved = Math.hypot(nx - px, ny - py);
  return moved > Math.min(prevSpan, nextSpan) * moveFraction;
}

/**
 * Call `fn` when the camera comes to rest, and not before.
 *
 * Polls the camera rather than listening to `controls`: the viewer's own render
 * loop moves the camera too — the surface barrier clamps it every frame — and a
 * control event would miss that while firing for movements that changed nothing.
 * Returns an unsubscribe.
 */
export function onViewSettled(viewer, fn, { settleMs = 500, pollMs = 150 } = {}) {
  let last = null;
  let stillSince = 0;
  let fired = true;
  let timer = null;

  const key = () => {
    const p = viewer?.camera?.position;
    return p ? `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}` : "";
  };

  const tick = () => {
    const now = key();
    if (now !== last) {
      last = now;
      stillSince = 0;
      fired = false;
      return;
    }
    if (fired) return;
    stillSince += pollMs;
    if (stillSince >= settleMs) {
      fired = true;
      try { fn(); } catch (error) { /* a bad listener must not stop the poll */ }
    }
  };

  timer = setInterval(tick, pollMs);
  return () => clearInterval(timer);
}
