import * as THREE from "../vendor/three.module.js";

// Fallback mirrors latLonToVector3 in earth-viewer.js. The viewer's own copy is
// preferred whenever the seam is up, so the longitude convention only ever has
// one authoritative definition.
const FALLBACK_GLOBE_RADIUS = 3.2;

function wrapLongitude(lonDegrees) {
  return ((((lonDegrees + 180) % 360) + 360) % 360) - 180;
}

export function getGlobeRadius() {
  return window.GeoIDViewer?.GLOBE_RADIUS ?? FALLBACK_GLOBE_RADIUS;
}

export function latLonToVector3(latDegrees, lonDegrees, radius = getGlobeRadius()) {
  const viewerFn = window.GeoIDViewer?.latLonToVector3;
  if (typeof viewerFn === "function") {
    return viewerFn(latDegrees, lonDegrees, radius);
  }
  const lat = THREE.MathUtils.degToRad(latDegrees);
  const lon = THREE.MathUtils.degToRad(wrapLongitude(lonDegrees));
  return new THREE.Vector3(
    -radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.sin(lon),
  );
}

// Small offset so draped vector layers do not z-fight with the globe surface.
export function drapedRadius(offset = 0.004) {
  return getGlobeRadius() + offset;
}

/**
 * Heuristic check that a coordinate pair looks like WGS84 degrees rather than
 * a projected CRS (UTM metres, State Plane feet, ...). Imported files without a
 * usable .prj are common, and silently treating metres as degrees would place
 * geometry in the wrong hemisphere instead of failing loudly.
 */
export function looksLikeGeographic(bounds) {
  if (!bounds) {
    return false;
  }
  const { minX, minY, maxX, maxY } = bounds;
  return (
    Number.isFinite(minX) && Number.isFinite(minY)
    && Number.isFinite(maxX) && Number.isFinite(maxY)
    && minX >= -180.5 && maxX <= 180.5
    && minY >= -90.5 && maxY <= 90.5
  );
}

export function computeBounds2D(coords) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i];
    const y = coords[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function boundsCenter(bounds) {
  return {
    lat: (bounds.minY + bounds.maxY) / 2,
    lon: (bounds.minX + bounds.maxX) / 2,
  };
}

// A model with no georeferencing has no natural home on a globe. In Model mode
// the globe is hidden, so the origin is correct. In GIS/GeoID mode the origin
// is the planet's core, which would bury the model inside the Earth, so it is
// shrunk and parked on the surface in front of the camera instead.
export const MODEL_MODE_RADIUS = 4;
const GIS_MODE_RADIUS = 0.35;

/**
 * Positions a non-georeferenced imported model appropriately for the mode.
 * Adapters normalise meshes to MODEL_MODE_RADIUS and record the scale that
 * achieved it in userData.baseScale.
 */
export function placeLocalModel(object3D, mode) {
  if (!object3D?.userData?.localModel) {
    return;
  }
  const baseScale = object3D.userData.baseScale || 1;
  if (mode === "model") {
    object3D.scale.setScalar(baseScale);
    object3D.position.set(0, 0, 0);
    object3D.quaternion.identity();
    return;
  }
  const viewer = window.GeoIDViewer;
  const shrink = GIS_MODE_RADIUS / MODEL_MODE_RADIUS;
  object3D.scale.setScalar(baseScale * shrink);

  // Sit the model on whichever part of the globe the camera currently faces so
  // it lands in view rather than behind the planet. The camera is in world
  // space while these models are parented to the globe group, so the direction
  // is taken back through that group's rotation first.
  const direction = viewer?.camera
    ? viewer.camera.position.clone().normalize()
    : new THREE.Vector3(0, 0, 1);
  const parent = object3D.parent;
  if (parent) {
    parent.updateMatrixWorld();
    const inverse = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    direction.transformDirection(inverse).normalize();
  }
  object3D.position.copy(direction.clone().multiplyScalar(getGlobeRadius() + GIS_MODE_RADIUS));
  object3D.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
}

const EARTH_RADIUS_M = 6371000;

/** Scene units per real-world metre, so georeferenced models keep true size. */
export function metresToSceneUnits(metres) {
  return (metres / EARTH_RADIUS_M) * getGlobeRadius();
}

/**
 * Places a model at real geographic coordinates on the globe.
 *
 * The model's local axes after the Z-up->Y-up conversion are X=east, Y=up,
 * Z=south, so the object is oriented into the local east/up/south frame at the
 * target point and scaled from metres into scene units. Callers must add the
 * object to the globe's group (not the scene) so it rotates with the planet.
 */
export function placeGeoreferencedModel(object3D, {
  lat,
  lon,
  metresPerSourceUnit = 1,
  sourceRadius = 1,
  altitudeM = 0,
  extraScale = 1,
  verticalExaggeration = 1,
  liftM = 0,
} = {}) {
  const radius = getGlobeRadius();
  const position = latLonToVector3(lat, lon, radius + metresToSceneUnits(altitudeM + liftM));

  const up = position.clone().normalize();
  // East is the derivative of position with respect to longitude.
  const east = latLonToVector3(lat, lon + 0.001, 1).sub(latLonToVector3(lat, lon - 0.001, 1)).normalize();
  const south = new THREE.Vector3().crossVectors(east, up).normalize();

  const basis = new THREE.Matrix4().makeBasis(east, up, south);
  object3D.quaternion.setFromRotationMatrix(basis);
  object3D.position.copy(position);

  // baseScale maps the raw geometry onto MODEL_MODE_RADIUS, so scaling by
  // (trueSceneRadius / MODEL_MODE_RADIUS) on top of it restores true size.
  const sceneRadius = metresToSceneUnits(sourceRadius * metresPerSourceUnit);
  const baseScale = object3D.userData.baseScale || 1;
  const uniform = baseScale * (sceneRadius / MODEL_MODE_RADIUS) * extraScale;
  // A true-scale subsurface model is essentially flush with a 6371km globe, so
  // vertical exaggeration (standard practice in GIS) stretches the local up
  // axis only, leaving the horizontal footprint geographically correct.
  object3D.scale.set(uniform, uniform * verticalExaggeration, uniform);
  return { position, sceneRadius };
}

/**
 * Frames the shared camera on a georeferenced bounding box by orbiting to its
 * centre and backing off far enough to see the whole extent.
 */
export function frameGlobeBounds(bounds, { paddingFactor = 2.2 } = {}) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera || !viewer?.controls) {
    return;
  }
  const center = boundsCenter(bounds);
  const radius = getGlobeRadius();
  const spanDeg = Math.max(bounds.maxY - bounds.minY, bounds.maxX - bounds.minX, 0.05);
  const spanFraction = Math.min(spanDeg / 180, 1);
  const distance = Math.max(radius * 1.06, radius * (1 + spanFraction * paddingFactor));
  // `latLonToVector3` answers in the BASELINE frame -- where the texture is laid
  // out, not where that place is now. Two transforms stand between it and world
  // space, and taking only one of them is the bug this fixes:
  //
  //   - `earthSceneGroup` carries the 23.44 degree axial tilt;
  //   - the imported-layers group carries the SPIN, which is the globe's own
  //     `rotation.y` off simulated UTC and therefore changes through the day.
  //
  // Only the tilt was applied, so a layer was framed at the coordinate it would
  // occupy at midnight and the camera missed by however far Earth had turned --
  // an offset that GROWS through the day, which is exactly the signature
  // CLAUDE.md records for this mistake.
  //
  // The layers are drawn as children of that group, so framing through ITS
  // world matrix asks where the geometry actually is rather than deriving the
  // angle a second time and hoping the two agree.
  const direction = latLonToVector3(center.lat, center.lon, 1);
  const group = viewer.scene?.getObjectByName("GeoID-ImportedGeoLayers")
    || viewer.earthSceneGroup;
  if (group) {
    group.updateMatrixWorld();
    direction.applyMatrix4(group.matrixWorld);
  }
  direction.normalize();
  viewer.controls.target.set(0, 0, 0);
  viewer.camera.position.copy(direction.multiplyScalar(distance));
  viewer.camera.updateProjectionMatrix();
  viewer.controls.update();
}

/** Mean Earth radius, matching the viewer's own constant. */
export const EARTH_MEAN_RADIUS_KM = 6371.0088;

/**
 * The area of a polygon on a sphere, in km².
 *
 * Uses the line-integral form — for each edge, the change in longitude times
 * the mean of the endpoint sines. It is exact for great-circle edges and, far
 * more importantly here, **stable under subdivision**: adding vertices along an
 * edge cannot change the answer.
 *
 * That is not a nicety. The previous implementation summed the interior angle
 * at every vertex and subtracted (n−2)π — algebraically correct, and hopeless
 * in practice, because subdividing drives every interior angle toward π and the
 * result becomes the difference of two large, nearly equal numbers. Measured on
 * one 300 km box: 89,806 km² at four vertices, then 58,939 / 96,124 / 113,026
 * at twelve, twenty-four and forty-four. It did not converge, it diverged with
 * vertex count, and on a 40°×40° box at 160 vertices it was 2.2× over. Every
 * hand-drawn area with more than a handful of points was affected, as was every
 * area the preset box produces, since that subdivides by design.
 *
 * `points` are `{lat, lon}` in degrees; longitude may be signed or 0–360, since
 * only differences are used and each is wrapped to the short way round.
 */
/**
 * The radius to measure on when a caller does not say: THIS body's, and
 * Earth's only where there is no viewer to ask (Node, the tests).
 *
 * The default used to be the Earth constant, and four callers took it —
 * drawn-layers' `area_km2`, the geology card's mapped area and both of
 * feature-popup's. So every area quoted on a planet was scaled by
 * (R_earth / R_body)^2: measured on Mars, a 4x3 degree box near Olympus Mons
 * recorded 140,689 km2 against a true 39,826, exactly the 3.533 that ratio
 * predicts; on the Moon it would be 13.4x. Fixing the callers one at a time
 * is what left three of them wrong after the first was found, so the DEFAULT
 * is the thing that had to change.
 */
function defaultRadiusKm() {
  const r = typeof window !== "undefined" ? window.GeoIDViewer?.bodyRadiusKm : null;
  return Number.isFinite(r) && r > 0 ? r : EARTH_MEAN_RADIUS_KM;
}

export function sphericalPolygonAreaKm2(points, radiusKm = defaultRadiusKm()) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const rad = (degrees) => (degrees * Math.PI) / 180;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    let dLon = rad(b.lon - a.lon);
    // The short way round, so a polygon spanning the antimeridian does not
    // sweep the long way and report most of the planet.
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    if (dLon < -Math.PI) dLon += 2 * Math.PI;
    sum += dLon * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
  }
  return Math.abs((sum * radiusKm * radiusKm) / 2);
}
