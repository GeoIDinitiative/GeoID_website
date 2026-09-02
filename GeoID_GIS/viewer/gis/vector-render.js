import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic, sphericalPolygonAreaKm2 }
  from "./geo-utils.js?v=20260902-792d638";
import { collectionBounds, geometryCoords, polygonsOf, linesOf } from "./geoprocessing.js?v=20260902-792d638";
import { pointInPolygon } from "./geometry.js?v=20260902-792d638";
import { categoricalSymbology, suggestCategoryField } from "./symbology.js?v=20260902-792d638";

// Single renderer for every vector source. Each parser produces a GeoJSON
// FeatureCollection and this turns it into draped globe geometry, so shapefile,
// GeoJSON, KML, GPX, WKT and any derived analysis layer look and behave alike.

const MAX_LINE_VERTICES = 6000000;

/**
 * A point on the globe's own displaced surface, plus clearance.
 *
 * Not radius + offset: the basemap is displaced by the relief, and at the
 * default setting its surface spans 3.2095 to 3.2989 while a flat 3.2 + 0.006
 * sits at 3.206 -- under the terrain everywhere, ocean included. Draped that
 * way a coastline was in the scene, visible, correctly georeferenced, and
 * drawing exactly nothing, because the planet was in front of it.
 */
/**
 * One build's memo of surface points, keyed by the coordinate itself.
 *
 * `surfacePoint` samples the elevation and does the trig, and the SAME
 * coordinate is asked for many times over: a vertex shared by six triangles is
 * transformed six times, and the seam asks for every ring vertex again.
 * Measured on a zoom-3 view of Europe, 23,793 features: 1.02 million lookups
 * for 261,000 distinct coordinates — three quarters of the work was repeats.
 *
 * The memo lives for one `renderFeatureCollection` call, so it cannot go stale
 * against a moving relief slider, and it is keyed by the string form of the
 * pair because the decoder already rounds coordinates to six decimals.
 */
let surfaceMemo = null;
let surfaceHits = 0;
let surfaceCalls = 0;

/**
 * One DISC for every marker layer, drawn twice per layer.
 *
 * A node — a filled dot inside a heavy ring — rather than the triangle this
 * used to draw. The triangle was chosen because a plain circle vanished into
 * the round terrain features on imagery basemaps, and that reasoning was
 * sound about a plain circle: what it lacked was a hard edge. A heavy outline
 * gives it one, and a ringed dot is what a node looks like on every network
 * map ever drawn — which is what these are, cable landings and gauges and
 * stations.
 *
 * The texture is white and the material multiplies it by the symbology
 * colour — which is also why the white OUTLINE cannot be drawn into this
 * texture: it would be tinted with the rest. So each marker layer draws two
 * Points from the same geometry — a plain-white underlay a few pixels larger,
 * and the tinted disc over it — and the outline is the underlay showing round
 * the edge. Two draw calls for the whole layer, not per point.
 */
let discTexture = null;
function markerDiscTexture() {
  if (discTexture) return discTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Short of the full 32 so the sprite's own edge is never the mark's edge:
  // a disc drawn to the corner of its quad aliases into a square at small
  // sizes, and `alphaTest` cuts it hard.
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  discTexture = new THREE.CanvasTexture(canvas);
  discTexture.needsUpdate = true;
  return discTexture;
}

/**
 * Marker size follows the camera down.
 *
 * A 7 px sprite is right from orbit and lost against a full-resolution
 * basemap on the ground — the report was "hard to see zoomed in", over Esri
 * imagery whose close-range texture is busier than the globe's. The size is
 * a material property, so one write per frame moves every marker; the hook
 * is the same altitude callback the line clearance already rides
 * (import-manager's onBeforeRender step).
 *
 * 7 px beyond ~1.2 units to the surface, easing to 12 px on the ground.
 */
const MARKER_MATERIALS = new Set();
/**
 * How much wider the white underlay is than the mark — the ring's weight.
 *
 * A disc needs a heavier ring than a triangle did. A triangle carries its own
 * silhouette and a hair of white was enough to separate it; a circle has no
 * silhouette to speak of, and a thin edge is exactly what let the earlier
 * attempt at circular markers vanish into round terrain features on imagery
 * basemaps. At 5.2 the ring reads as part of the symbol rather than as
 * anti-aliasing, which is what makes a node a node.
 */
const MARKER_OUTLINE_EXTRA = 5.2;
let markerSize = 7;

function registerMarkerMaterial(material, role) {
  // A null role means "leave my size alone": a dense catalogue picks its own
  // and must not be rewritten to the shared marker size on every camera move.
  if (!role) return material;
  material.userData.geoidMarkerRole = role;
  MARKER_MATERIALS.add(material);
  // Materials announce their own disposal; forgetting them here is what
  // keeps a session of repaints from growing the set without bound.
  material.addEventListener("dispose", () => MARKER_MATERIALS.delete(material));
  material.size = role === "outline" ? markerSize + MARKER_OUTLINE_EXTRA : markerSize;
  return material;
}

export function setMarkerSizeFromAltitude(surfaceDistanceUnits) {
  const d = Number(surfaceDistanceUnits);
  if (!Number.isFinite(d) || d <= 0) return;
  const t = Math.max(0, Math.min(1, 1 - d / 1.2));
  const next = 7 + 5 * t ** 1.2;
  if (Math.abs(next - markerSize) < 0.1) return;
  markerSize = next;
  MARKER_MATERIALS.forEach((m) => {
    m.size = m.userData.geoidMarkerRole === "outline" ? next + MARKER_OUTLINE_EXTRA : next;
  });
}

/**
 * The exaggeration geometry is BUILT at, whatever the globe is showing.
 *
 * `surfacePoint` bakes in the exaggeration of the moment, and that moment is
 * not stable: the relief tapers to nothing below about 300 km whenever there
 * is close-range imagery on the globe. A layer built down there came out flat,
 * `aDisp` was zero for every vertex — the shader has nothing to scale — and it
 * stayed flat when the camera rose and the terrain came back, so the map sank
 * into the ground it belongs to.
 *
 * Building at a fixed reference instead means the geometry always carries the
 * terrain, and the shader re-applies whatever exaggeration is live. The value
 * is the slider's own default, so nothing changes in the common case.
 */
const REFERENCE_RELIEF = 0.11;

function surfaceAt(lat, lon, drape) {
  surfaceCalls += 1;
  const key = surfaceMemo ? `${lat},${lon},${drape}` : null;
  if (key) {
    const hit = surfaceMemo.get(key);
    if (hit) {
      surfaceHits += 1;
      return hit.clone();
    }
  }
  const viewer = window.GeoIDViewer;
  let point;
  if (typeof viewer?.elevationNormalized === "function") {
    const displaced = viewer.elevationNormalized(lat, lon) * REFERENCE_RELIEF;
    point = latLonToVector3(lat, lon, drapedRadius(drape) + displaced);
  } else if (typeof viewer?.surfacePoint === "function") {
    point = viewer.surfacePoint(lat, lon, drape);
  } else {
    point = latLonToVector3(lat, lon, drapedRadius(drape));
  }
  if (key) surfaceMemo.set(key, point.clone());
  return point;
}

/**
 * A FILLED polygon sits on the surface, at no altitude at all.
 *
 * The clearance above was 0.006, and 0.006 of a 3.2 radius is **11.9 km** --
 * so flying in, you passed through the geology and left it above you while the
 * scale bar still read tens of kilometres, and the map you were descending
 * towards was the basemap alone. Obliquely it also parallaxed: a polygon drawn
 * 11.9 km up is painted to one side of the ground it describes, measured at up
 * to 14 km at the framed view.
 *
 * It buys nothing, because the fill material already refuses the depth test --
 * "a flat facet cannot win on depth against displaced terrain, so it does not
 * compete", exactly as the drapes do -- and it is single-sided, so the far
 * hemisphere is still culled by winding rather than by height. Sitting the fill
 * on the surface therefore costs no visibility and makes the layer something
 * you can descend to metres above and still be under.
 *
 * Outlines keep the old clearance: a line has no facing to cull it, so it is
 * depth-tested to hide the far side, and a depth-tested line at zero clearance
 * disappears into the relief between its vertices.
 */
const FILL_DRAPE = 0;

/* ── Following the relief ──────────────────────────────────────────────────
 *
 * A layer is built once, from the terrain exaggeration in force at the time.
 * The globe's is not fixed: it eases off as the camera comes in to land, so
 * the ground drops away while a static mesh stays where it was built — and the
 * geology hangs in the air above a planet that has shrunk under it. At the
 * slider's default the exaggeration is worth **219 km** of radius, so this is
 * not a subtle drift; it is the layer floating, and worse the closer you get.
 *
 * Rebuilding the geometry per frame is not an option — triangulating the BGS
 * sheets is seconds of work — so each vertex carries what it needs to be placed
 * again on the GPU: the direction it lies in, and its displacement as the
 * fraction of the exaggeration it was built with. One uniform then moves every
 * imported layer with the globe, for free, every frame.
 */
const RELIEF_UNIFORM = { value: 0 };

/** The relief every imported layer is drawn at. Set from the viewer's own. */
export function setRenderRelief(relief) {
  RELIEF_UNIFORM.value = Number.isFinite(relief) ? relief : 0;
}

/**
 * How high a LINE is drawn, which cannot be zero and must not be fixed.
 *
 * A filled polygon can sit on the ground because its material refuses the depth
 * test and its winding culls the far hemisphere. A line has no facing, so it
 * needs the depth test to hide the half of the planet behind it -- and a
 * depth-tested line at zero clearance disappears into the relief between its
 * vertices. It therefore has an altitude, and an altitude parallaxes: fixed at
 * 0.006 it is **11.9 km**, which reads as a fault system floating above the
 * country when you come in to look at it.
 *
 * So it is a fraction of the distance to the surface, capped at the old value
 * and floored at a few metres -- the same answer the measure marker arrived at.
 * The parallax is then a constant small angle at every scale: unchanged from
 * orbit, about 200 m at 10 km up, a couple of metres on the ground.
 */
const LINE_DRAPE_UNIFORM = { value: 0.006 };
const LINE_DRAPE_MAX = 0.006;
const LINE_DRAPE_MIN = 0.0000015;          // about 3 m

export function setLineDrapeFromAltitude(surfaceDistanceUnits) {
  const d = Number(surfaceDistanceUnits);
  if (!Number.isFinite(d) || d <= 0) return;
  LINE_DRAPE_UNIFORM.value = Math.min(LINE_DRAPE_MAX, Math.max(LINE_DRAPE_MIN, d * 0.02));
}

/**
 * HOW WIDE THE SEAL IS, IN GROUND, AND WHY IT CANNOT BE A LINE.
 *
 * Neighbouring units do not share their boundary: each survey, and then each
 * tile generalisation, simplifies its polygons independently, so the line two
 * units are meant to share becomes two lines a little apart. Measured on an
 * inland Scotland box at 86 m sampling, the widest gap by level: **4,800 m at
 * zoom 3, 1,714 at 4, 600 at 5, 343 at 7, 86 at 8** — and 46 m at zoom 13 over
 * Inishowen. They are not data gaps: Macrostrat returns a unit at their
 * coordinates and we hold those very polygons.
 *
 * A one-device-pixel line cannot close them, because WebGL draws a line one
 * pixel wide whatever the ground beneath it measures — the seam is wider than
 * the stroke at every level. Filling from the coarser tiles underneath was
 * tried and is recorded above as a thing not to re-try: it paints continental
 * geology over sea the fine tiles correctly leave blank.
 *
 * So the seal is a RIBBON with a width in ground units, scaled to the distance
 * to the surface so it covers about a pixel and a half at any altitude. That
 * is the only width that works at every zoom: the gaps shrink with the level
 * and so does this. Each polygon lays half a ribbon either side of its own
 * boundary, in its own colour, so two neighbours between them cover a gap up
 * to a full ribbon wide and neither invents ground the other does not claim.
 */
const SEAL_RIBBON_UNIFORM = { value: 0.00002 };
const SEAL_RIBBON_MAX = 0.004;             // 8 km, at a whole-planet view
const SEAL_RIBBON_MIN = 0.0000002;         // about 0.4 m, on the ground

/**
 * A pixel and a half of ground, from the distance to the surface.
 *
 * At a 45 degree field of view one pixel is about `d * 0.83 / height` of
 * ground; on a canvas around 850 px that is `d * 0.00097`. Three quarters of
 * that is the HALF width, so the ribbon spans about 1.5 px whatever the
 * altitude. Clamped at both ends: a planet-wide view must not smear the map,
 * and on the ground the seal must not outgrow the polygons it is sealing.
 */
export function setSealWidthFromAltitude(surfaceDistanceUnits) {
  const d = Number(surfaceDistanceUnits);
  if (!Number.isFinite(d) || d <= 0) return;
  SEAL_RIBBON_UNIFORM.value = Math.min(SEAL_RIBBON_MAX,
    Math.max(SEAL_RIBBON_MIN, d * 0.0007));
}

/** The seal's current half width, in scene units. Read by the tests, and by
    anything that needs to know how much ground the seam is covering. */
export function sealWidth() {
  return SEAL_RIBBON_UNIFORM.value;
}

function baseRadius() {
  return window.GeoIDViewer?.GLOBE_RADIUS ?? 3.2;
}

/**
 * Give a built geometry the two attributes the shader below needs.
 *
 * `aDisp` is recovered from the radius rather than sampled a second time: the
 * vertex is already at `base + displacement * relief + drape`, so dividing out
 * the relief it was built with gives back the displacement exactly, and a
 * second sampling path could disagree with the first.
 */
export function attachReliefAttributes(geometry, drape, builtRelief) {
  const position = geometry.attributes.position;
  const base = baseRadius();
  const dir = new Float32Array(position.count * 3);
  const disp = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, y, z) || 1;
    dir[i * 3] = x / r;
    dir[i * 3 + 1] = y / r;
    dir[i * 3 + 2] = z / r;
    disp[i] = builtRelief > 1e-9 ? (r - base - drape) / builtRelief : 0;
  }
  geometry.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
  geometry.setAttribute("aDisp", new THREE.BufferAttribute(disp, 1));
}

/**
 * Turn the seal's segment pairs into a RIBBON: a quad per segment, laid flat
 * in the tangent plane, widened on the GPU.
 *
 * The positions stay exactly where the boundary is -- the width is added in
 * the shader from `aPerp` and `aSide`, so one geometry serves every altitude
 * and nothing is rebuilt when the camera moves. `aPerp` is the segment's
 * direction crossed with the outward radial, which is the tangent
 * perpendicular: widening along it can never lift a vertex off the surface.
 *
 * Indexed, four vertices to a quad rather than six, because a world layer's
 * seal runs to hundreds of thousands of segments and this is already twice
 * the vertices the line version needed.
 *
 * A segment whose ends coincide has no direction to be perpendicular to and
 * is dropped: `pushSegment` splits long spans and a split can land twice on
 * the same point, and a zero-length cross product would come out as NaN and
 * take the whole draw call with it.
 */
function ribbonFromSegments(positions, colours) {
  const pos = [];
  const col = [];
  const perp = [];
  const side = [];
  const index = [];
  const segments = Math.floor(positions.length / 6);
  for (let s = 0; s < segments; s += 1) {
    const o = s * 6;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const dLen = Math.hypot(dx, dy, dz);
    if (!(dLen > 1e-12)) continue;
    dx /= dLen; dy /= dLen; dz /= dLen;
    // The outward normal at the segment's middle: on a sphere that is the
    // point's own direction.
    let rx = (ax + bx) / 2, ry = (ay + by) / 2, rz = (az + bz) / 2;
    const rLen = Math.hypot(rx, ry, rz);
    if (!(rLen > 1e-12)) continue;
    rx /= rLen; ry /= rLen; rz /= rLen;
    let px = dy * rz - dz * ry;
    let py = dz * rx - dx * rz;
    let pz = dx * ry - dy * rx;
    const pLen = Math.hypot(px, py, pz);
    if (!(pLen > 1e-12)) continue;          // segment parallel to the radial
    px /= pLen; py /= pLen; pz /= pLen;
    const base = pos.length / 3;
    pos.push(ax, ay, az, ax, ay, az, bx, by, bz, bx, by, bz);
    perp.push(px, py, pz, px, py, pz, px, py, pz, px, py, pz);
    side.push(-1, 1, -1, 1);
    const ar = colours[o], ag = colours[o + 1], ab = colours[o + 2];
    const br = colours[o + 3], bg = colours[o + 4], bb = colours[o + 5];
    col.push(ar, ag, ab, ar, ag, ab, br, bg, bb, br, bg, bb);
    index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  return { pos, col, perp, side, index };
}

/**
 * Place the vertex at the CURRENT relief instead of the one it was built at.
 *
 * `lifted` hands the clearance to the shared line uniform above, so it follows
 * the camera down; everything else keeps the fixed clearance it was built with.
 */
export function followRelief(material, drape, {
  lifted = false, cullFarSide = false, hole = null, ribbon = false,
} = {}) {
  // `true` means the silhouette itself; a number moves the cut inside it.
  const facingLimit = cullFarSide === true ? 0 : Number(cullFarSide) || 0;
  const base = baseRadius();
  const drapeUniform = lifted ? LINE_DRAPE_UNIFORM : { value: drape };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRelief = RELIEF_UNIFORM;
    shader.uniforms.uDrape = drapeUniform;
    if (ribbon) shader.uniforms.uRibbon = SEAL_RIBBON_UNIFORM;
    if (hole) {
      shader.uniforms.uHoleOn = hole.on;
      shader.uniforms.uHoleY = hole.y;
      shader.uniforms.uHoleW = hole.west;
      shader.uniforms.uHoleE = hole.east;
    }
    shader.vertexShader = `attribute vec3 aDir;
attribute float aDisp;
uniform float uRelief;
uniform float uDrape;
${ribbon ? "attribute vec3 aPerp;\nattribute float aSide;\nuniform float uRibbon;" : ""}
${cullFarSide ? "varying float vFacing;" : ""}
${hole ? "varying vec3 vDir;" : ""}
${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      `vec3 transformed = aDir * (${base.toFixed(4)} + aDisp * uRelief + uDrape);`
      // The ribbon is laid in the TANGENT plane, so widening it never lifts a
      // vertex off the surface however wide the view makes it.
      + (ribbon ? "\n  transformed += aPerp * (aSide * uRibbon);" : "")
      + (hole ? "\n  vDir = normalize(aDir);" : "")
      + (cullFarSide
        ? `
  {
    vec4 geoidView = modelViewMatrix * vec4(transformed, 1.0);
    vec3 geoidNormal = normalize(normalMatrix * aDir);
    vFacing = dot(geoidNormal, normalize(-geoidView.xyz));
  }`
        : ""),
    );
    /**
     * BACKFACE CULLING, FOR SOMETHING THAT HAS NO FACES.
     *
     * A fill can skip the depth test because `side: FrontSide` culls the far
     * hemisphere for it. A LINE has no facing, so nothing culls it, and the
     * same trick drew Australia's outline across the Atlantic — reported as
     * "some lines fail the depth test". Lifting it and depth-testing it works
     * from orbit and fails up close: the lift is 0.02 of the altitude (600 m
     * at 30 km up), and at a grazing angle a line 600 m above its own polygon
     * slides off the hairline it was drawn to cover.
     *
     * So the seam hugs the fill exactly and this discards the half of it
     * facing away from the camera. On a sphere every vertex's outward normal
     * IS its own direction, which the geometry already carries as `aDir`.
     */
    /**
     * A WINDOW cut in the backdrop, exactly where the view's own map paints.
     *
     * Hiding whole backdrop tiles cannot work: a zoom-2 tile is a thousand
     * times the area of the view that would replace it, so hiding one leaves a
     * rectangular hole in the world map and keeping it double-draws the moment
     * the layer is translucent. Both were reported, in that order.
     *
     * So the cut is per fragment and the window is passed as geometry rather
     * than as longitudes: two latitudes as a range on the direction's y, and
     * two meridians as plane normals computed on the CPU with the viewer's own
     * `latLonToVector3`. No angle is reconstructed in the shader, so there is
     * no convention to get wrong, and moving the window is four uniform
     * writes — which is why it can follow the camera.
     */
    if (hole) {
      shader.fragmentShader = `varying vec3 vDir;
uniform float uHoleOn;
uniform vec2 uHoleY;
uniform vec3 uHoleW;
uniform vec3 uHoleE;
${shader.fragmentShader}`.replace(
        "#include <clipping_planes_fragment>",
        `if (uHoleOn > 0.5 && vDir.y > uHoleY.x && vDir.y < uHoleY.y
    && dot(vDir, uHoleW) > 0.0 && dot(vDir, uHoleE) < 0.0) discard;
  #include <clipping_planes_fragment>`,
      );
    }
    if (cullFarSide) {
      shader.fragmentShader = `varying float vFacing;
${shader.fragmentShader}`.replace(
        "#include <clipping_planes_fragment>",
        // A hair inside the silhouette rather than exactly on it: at the limb
        // the normal is perpendicular to the view, the sign is decided by
        // rounding, and a few fragments of the far side get through. Measured
        // over the Pacific: 53 stray pixels, all of them within a couple of
        // degrees of the horizon, where the seam is edge-on and invisible
        // anyway.
        `if (vFacing <= ${facingLimit.toFixed(3)}) discard;
  #include <clipping_planes_fragment>`,
      );
    }
  };
  // A material drawing at a fixed clearance and one following the camera must
  // not share a compiled program, or the second silently takes the first's.
  //
  // The MATERIAL TYPE is part of the key, and it was not: a PointsMaterial
  // handed `geoid-relief-live` took the LineBasicMaterial program compiled
  // under the same name, and every marker dot on the globe rendered nothing —
  // no error, no warning, a program that simply is not a points program.
  // Found by bisection: the same injection inlined with a unique key drew
  // perfectly.
  material.customProgramCacheKey = () =>
    `geoid-relief-${material.type}-${lifted ? "live" : drape}-${ribbon ? "ribbon" : "flat"}`
    + `${cullFarSide ? `-cull${facingLimit}` : ""}${hole ? "-hole" : ""}`;
  return material;
}

// A straight line between two points on a sphere is a chord, and a chord sags
// below the surface. Across 12 degrees of arc -- ordinary for a coarse boundary
// polygon -- it sags 0.0175, nearly three times the clearance the geometry is
// lifted by, so the segment dives through the planet and is hidden for most of
// its length. Splitting long spans keeps the sag far under the clearance: at
// one degree it is 0.0001 against 0.006.
//
// The split is linear in longitude and latitude, which is also what a shapefile
// edge means -- straight in the coordinate space it was authored in, not a
// great circle -- so densifying draws the geometry more correctly, not less.
const MAX_SEGMENT_DEG = 1;
const MAX_SEGMENT_SPLITS = 512;

function pushSegment(target, a, b, drape) {
  const steps = Math.min(
    MAX_SEGMENT_SPLITS,
    Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / MAX_SEGMENT_DEG)),
  );
  let previous = surfaceAt(a[1], a[0], drape);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const next = surfaceAt(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t, drape);
    target.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
    previous = next;
  }
}

/**
 * Triangulate one polygon (outer ring plus holes) in lon/lat, then lift each
 * vertex to the globe.
 *
 * three.js's own `ShapeUtils.triangulateShape` handles holes, which matters
 * for geology more than anywhere: a formation with an inlier of something else
 * is a ring with a ring inside it, and filling the outer one alone paints over
 * the unit that is actually there.
 */
/** Even-odd crossing test, for deciding whether a hole belongs to a ring. */
function pointInsideRing(point, ring) {
  if (!point || !ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function fillTriangles(polygon, drape, out, colour) {
  const outer = polygon[0];
  if (!outer || outer.length < 4) return;
  const toV2 = (ring) => ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y));
  const contour = toV2(outer);
  /**
   * A hole that is not inside this ring is not this ring's hole.
   *
   * Ear clipping joins each hole to the outer ring with a bridge, and if the
   * hole lies somewhere else the bridge is a triangle stretching all the way
   * to it — the bright slivers shooting across the ocean. `mvt.js` now groups
   * tile rings by containment so they arrive correctly, and this is the same
   * guarantee for every other source: a GeoJSON whose rings were written in
   * the wrong order cannot make a bridge either.
   */
  const holes = polygon.slice(1).map(toV2)
    .filter((h) => h.length >= 3 && pointInsideRing(h[0], contour));
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  } catch (error) {
    return;                          // a self-touching ring is not worth a crash
  }
  const all = [...contour, ...holes.flat()];
  faces.forEach((face) => {
    const points = face.map((index) => {
      const v = all[index];
      return v ? surfaceAt(v.y, v.x, drape) : null;
    });
    if (points.length !== 3 || points.some((p) => !p)) return;
    const [a, b, c] = points;
    /**
     * Every triangle is turned to face OUTWARD, and this is not tidiness.
     *
     * The fill is `side: FrontSide` so the far hemisphere is culled, which is
     * what lets it skip the depth test. Winding decides which side is front —
     * and `triangulateShape` inherits its winding from the ring it was given,
     * while a source's rings are wound however that survey wound them. A
     * triangle that comes out facing into the globe is therefore not drawn,
     * and what is left is a hole in the map exactly its own shape.
     *
     * Ear clipping makes slivers, so those holes are thin curved scratches
     * lying along the triangulation — which reads as torn geometry rather
     * than as backface culling, and is exactly what was reported: "the black
     * scores". Measured over Britain: 1,087 of 228,990 triangles faced inward,
     * 0.47% by count and 0.53% by area, every one of them invisible.
     *
     * The outward direction on a sphere is the position itself, so the test is
     * one cross product and a dot: negative means inward, and swapping two
     * vertices turns it round.
     */
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const ordered = (nx * a.x + ny * a.y + nz * a.z) >= 0 ? [a, b, c] : [a, c, b];
    ordered.forEach((p) => {
      out.positions.push(p.x, p.y, p.z);
      out.colours.push(colour.r, colour.g, colour.b);
    });
  });
}

export function renderFeatureCollection(fc, {
  name = "vector",
  lineColor = 0x8ef6c4,
  pointColor = 0xffd166,
  drape = 0.006,
  pointSize = 0.018,
  // A function of the feature returning a CSS colour. With one, every feature
  // is drawn in its own colour and polygons are filled — which is the whole
  // difference between "there are polygons here" and a geological map.
  colourFor = null,
  /**
   * OPAQUE by default, where this used to be 0.55.
   *
   * Two geology sheets at 55% do not read as one over the other: they read as a
   * blend that matches neither legend, so the map shows a colour that is in
   * nobody's key and the polygon you think you are clicking is a mixture of two.
   * Measured by reading the rendered pixel back and matching it against each
   * layer's own palette: 10 of 19 points over Northern Ireland attributed to the
   * sheet that was NOT the one the card named, purely because the colour under
   * the cursor was half of each.
   *
   * Opaque, the top sheet hides the one below, its colours are the legend's
   * exactly, and the card names what is drawn. Seeing through it is what the
   * per-layer opacity slider is for -- and that slider already read 1 while the
   * fill was 0.55, so this also makes it tell the truth.
   */
  fillOpacity = 1,
  /**
   * Draw polygons as their OUTLINE, in their own colour, with no fill.
   *
   * A filled polygon states what the ground is — that is a geological map.
   * An outlined one states where a boundary is and leaves the ground
   * visible, which is what a study area, an extent or anything somebody drew
   * to look INSIDE of needs. Filling those hides the very thing they were
   * drawn around.
   *
   * The rings then take the same lifted, depth-tested treatment a LineString
   * gets rather than the fill-height `seal`, because with no fill beneath
   * them there is nothing for the seal's coplanar trick to seal against.
   */
  outlineOnly = false,
  /**
   * CONTACTS: whether a polygon's boundary is DRAWN, and in what.
   *
   * The `seal` below already strokes every filled polygon's own outline, at
   * the fill's own height, at whatever detail the source was streamed at. It
   * was built to cover a hairline and is painted the polygon's OWN colour, so
   * it is invisible by construction — the geometry of a full contact network
   * is on the GPU and nothing can see it.
   *
   * That is what the opacity slider was revealing, and it is worth writing
   * down because it looks like a feature: at alpha < 1 a contact is stroked
   * TWICE, once by each neighbour, so it accumulates more alpha than either
   * interior and reads as an outline. Turn the layer opaque and it vanishes
   * again. Reported as "intricate polygons revealed when we decrease the
   * opacity" — an accumulation artefact that happens to look like the
   * cartography anybody would want.
   *
   *   "match"  the polygon's own colour — invisible, and the historic default
   *            for every non-geological vector layer
   *   "shade"  its own colour DARKENED, so a contact reads as that unit's own
   *            edge and the map still says what it said
   *   "ink"    one colour for every contact, the way a printed sheet draws them
   *
   * `opacity` is the stroke's own, kept on the material as `baseOpacity` and
   * MULTIPLIED by the layer slider rather than replaced by it — a layer at 40%
   * should fade its contacts to 40% OF THEIR OWN weight, not promote them to
   * 40% when they were meant to be 25%.
   *
   * Subtle on purpose: WebGL draws every line one device pixel wide whatever
   * `linewidth` says, so at a global view 9,000 polygons' boundaries are 9,000
   * hairlines and a strong ink turns the map into a net.
   */
  contacts = null,
  /**
   * The tile's own bounds, when this collection IS one tile.
   *
   * Clipping a ring to its tile rect (mvt.js) removes the doubly-drawn buffer
   * band, and it necessarily leaves the ring running ALONG the tile edge. That
   * cut is an artefact of tiling, not a geological contact — stroke it and the
   * bright grid the clip just removed comes back as a dark one.
   *
   * So a segment whose two ends both lie on the SAME edge of this rect is
   * skipped by the seal. Both ends, and the same edge: a real boundary that
   * merely touches the seam at one vertex still gets its stroke.
   */
  edgeBounds = null,
  /**
   * WHERE TWO SURVEYS COVER THE SAME GROUND, THE FINER ONE IS THE MAP.
   *
   * Macrostrat's tiles never show this: `carto` picks ONE survey per scale, so
   * a tile carries one survey's polygons for any given ground. Fetching whole
   * units from the API brings all of them back — measured on a 45 km clip,
   * **80% of it is covered by more than one survey** and 2,888 of 4,900 sample
   * points by all three. Drawn flat, a regional survey's boundaries are ruled
   * straight across a detailed survey's geology.
   *
   * `rankOf` answers how finely a feature's source maps the ground. Higher
   * wins: its fill is drawn last, and a coarser feature's contact is not inked
   * where a finer one covers it. The coarse survey still shows wherever the
   * fine one does not reach, which is what keeps the offshore geology.
   */
  rankOf = null,
  /**
   * Is this layer a set of PLACES or a point CLOUD?
   *
   * The count decides by default, and the rule is sound: under 20,000 a layer
   * is a set of places and is sized in screen pixels; above it, world space,
   * because a fixed pixel size paints the globe solid at a distance. That is
   * right for a LiDAR return or an XYZ surface, where the points ARE the
   * ground.
   *
   * It is wrong for a large CATALOGUE. Ninety thousand fire detections are
   * ninety thousand places, and world-space sizing drew them at 0.018 units —
   * sub-pixel specks, invisible at every altitude anyone would look from. A
   * layer that knows it is a catalogue says so, and gets screen-pixel dots at
   * any count; the size comes down with the count so the planet does not fill
   * in.
   */
  pointStyle = "auto",
  // Uniforms for the backdrop's window; null for an ordinary layer.
  hole = null,
} = {}) {
  surfaceMemo = new Map();
  surfaceHits = 0;
  surfaceCalls = 0;
  const linePositions = [];
  const lineColours = [];
  const pointPositions = [];
  const pointColours = [];
  const fill = { positions: [], colours: [] };
  const seal = { positions: [], colours: [] };
  /**
   * The seal: every filled polygon's own boundary, drawn in its own colour,
   * in the LINE buffer — which is depth tested, and that is the whole point.
   *
   * Neighbouring units do not share their boundary exactly. Each survey — and
   * then each tile generalisation — simplifies a polygon on its own, so the
   * line two units are supposed to share becomes two lines a few tens of
   * metres apart. Measured on the tiles over Britain: only 32% of edges at
   * zoom 4 are used by two polygons, and the strays sit within about 30 m.
   *
   * Thirty metres is a fraction of a pixel, which is exactly why this looks
   * like a rendering bug rather than a data one: with no multisampling a
   * sub-pixel gap still leaves whole pixels with nothing drawn in them, so the
   * seam appears as a broken 1px black line following the boundary — reported,
   * fairly, as "the polygons are not mapped perfectly, see the black scores".
   * Measured with every unit painted one flat colour, which is what proves it
   * is a hole rather than a seam between two colours.
   *
   * Stroking each polygon's own outline in its own fill colour covers that
   * hairline without changing what the map says: the line is the polygon's
   * own edge, in the polygon's own colour.
   *
   * It goes in the line buffer rather than beside the fill, because a LINE HAS
   * NO FACING. The fills can skip the depth test because `side: FrontSide`
   * culls the far hemisphere for them; nothing culls a line, so a seam drawn
   * that way showed straight through the planet — Australia's outline over the
   * Atlantic. Lines therefore keep the depth test and the altitude-scaled
   * clearance that lets them pass it (`LINE_DRAPE`, 12 km from orbit down to
   * about 3 m at the ground), which is the arrangement the line path already
   * had and the reason it never had this fault.
   */

  const scratch = new THREE.Color();
  let truncated = false;

  /**
   * What colour a contact is stroked in, resolved ONCE rather than per vertex.
   *
   * `shade` multiplies the unit's own colour, which keeps every contact
   * attributable to the unit it bounds: a dark green edge belongs to the green
   * unit, and the map still reads as its own legend. A flat `ink` is the
   * printed-sheet look and says nothing about which side is which.
   */
  /**
   * Does this segment run along the tile's own cut? 1e-6 degrees is the
   * rounding mvt.js applies when it projects, about 0.1 m, so the tolerance is
   * a shade above it and far below any real boundary.
   */
  const EDGE_EPS = 3e-6;
  const onTileEdge = edgeBounds
    ? (a, b) => (
      (Math.abs(a[0] - edgeBounds.west) < EDGE_EPS && Math.abs(b[0] - edgeBounds.west) < EDGE_EPS)
      || (Math.abs(a[0] - edgeBounds.east) < EDGE_EPS && Math.abs(b[0] - edgeBounds.east) < EDGE_EPS)
      || (Math.abs(a[1] - edgeBounds.south) < EDGE_EPS && Math.abs(b[1] - edgeBounds.south) < EDGE_EPS)
      || (Math.abs(a[1] - edgeBounds.north) < EDGE_EPS && Math.abs(b[1] - edgeBounds.north) < EDGE_EPS))
    : () => false;

  const contactMode = contacts?.mode || "match";
  const contactShade = Number.isFinite(contacts?.shade) ? contacts.shade : 0.45;
  const flatInk = contactMode === "ink"
    ? new THREE.Color(contacts?.colour ?? 0x1a1420) : null;
  const sealInk = contactMode === "ink"
    ? { r: () => flatInk.r, g: () => flatInk.g, b: () => flatInk.b }
    : contactMode === "shade"
      ? { r: (c) => c.r * contactShade, g: (c) => c.g * contactShade, b: (c) => c.b * contactShade }
      : { r: (c) => c.r, g: (c) => c.g, b: (c) => c.b };

  /**
   * A CONTACT SEPARATES TWO DIFFERENT UNITS — and "different" means a
   * different UNIT, never merely a different colour.
   *
   * Every polygon inks its own rings, so where two polygons abut, their shared
   * edge is drawn twice, and where a unit has been cut into pieces — by a tile
   * boundary, or by arriving as several parts — that doubled ink rules a line
   * through ground with no boundary in it.
   *
   * KEYED ON THE UNIT, NOT THE COLOUR. Keying on colour cost real contacts:
   * this source paints many different units alike, so "same colour" deleted
   * boundaries that genuinely separate two formations, and the world map lost
   * outline detail it had always drawn. Identity is `map_id`, else `legend_id`,
   * else the name — and only when two pieces agree on it is their shared edge
   * left uninked. A boundary between two different units always survives, even
   * when the map paints both of them the same.
   *
   * The pass is O(vertices), with rounding matched to `mvt.js`'s own 1e-6
   * projection so coincident edges actually meet.
   */
  const SEG_ROUND = 1e6;
  const segKey = (a, b) => {
    const ka = `${Math.round(a[0] * SEG_ROUND)},${Math.round(a[1] * SEG_ROUND)}`;
    const kb = `${Math.round(b[0] * SEG_ROUND)},${Math.round(b[1] * SEG_ROUND)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const sharedSameUnit = new Set();
  /** What makes two polygons pieces of ONE unit rather than two. */
  const unitKey = (f) => {
    const p = f?.properties || {};
    const id = p.map_id ?? p.legend_id ?? p.name;
    return id === undefined || id === null ? null : String(id);
  };
  // NOT gated on `contacts`. The seal inks polygon rings whenever the layer is
  // coloured, whatever the contact style is — a clip built through the tool
  // carries no contact style at all, and that is exactly the layer the phantom
  // lines were reported on. Guarding this pass on `contacts` left it switched
  // off precisely where it was needed.
  {
    const seen = new Map();
    (rankOf ? [...fc.features] : fc.features).forEach((feature) => {
      const geometry = feature?.geometry;
      if (!geometry) return;
      // No identity means nothing can be proved the same: draw it.
      const unit = unitKey(feature);
      if (unit === null) return;
      polygonsOf(geometry).flat().forEach((ring) => {
        for (let i = 0; i + 1 < ring.length; i += 1) {
          const key = segKey(ring[i], ring[i + 1]);
          const had = seen.get(key);
          if (had === undefined) seen.set(key, unit);
          else if (had === unit) sharedSameUnit.add(key);
          else sharedSameUnit.delete(key);
        }
      });
    });
  }
  /** Drawn once, however many polygons claim it: shared ink doubles up. */
  const inked = new Set();

  const ordered = rankOf
    ? [...fc.features].sort((a, b) => (rankOf(a) || 0) - (rankOf(b) || 0))
    : fc.features;
  /** The finer-covering features, for the contact test. Bboxes reject early. */
  const finer = rankOf
    ? ordered.map((f) => {
      const polys = polygonsOf(f.geometry || {});
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      polys.flat().forEach((ring) => ring.forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }));
      return { rank: rankOf(f) || 0, polys, minX, minY, maxX, maxY };
    }).filter((e) => e.polys.length)
    : [];
  const coveredByFiner = (x, y, rank) => finer.some((e) => e.rank > rank
    && x >= e.minX && x <= e.maxX && y >= e.minY && y <= e.maxY
    && e.polys.some((poly) => pointInPolygon([x, y], poly)));

  ordered.forEach((feature) => {
    if (linePositions.length >= MAX_LINE_VERTICES) {
      truncated = true;
      return;
    }
    const geometry = feature.geometry;
    if (!geometry) {
      return;
    }
    if (geometry.type === "Point" || geometry.type === "MultiPoint") {
      /**
       * Points carry a colour per feature, like everything else.
       *
       * They did not, and nothing said so: `colourFor` was consulted for fills
       * and for lines and skipped entirely here, so a point layer took one
       * flat `pointColor` whatever it was symbolised by. Measured on the
       * Smithsonian volcano catalogue -- 2,666 points, a nine-class legend
       * with correct counts beside them, and **zero** colour attributes on the
       * geometry. The legend is not evidence that the map was painted; this is
       * the third place in this renderer where that has been true.
       */
      let dot = null;
      if (colourFor) {
        scratch.set(colourFor(feature) || "#8a8a8a");
        dot = { r: scratch.r, g: scratch.g, b: scratch.b };
      }
      geometryCoords(geometry).forEach((c) => {
        const v = surfaceAt(c[1], c[0], drape);
        pointPositions.push(v.x, v.y, v.z);
        if (dot) pointColours.push(dot.r, dot.g, dot.b);
      });
      return;
    }
    // Polygon rings are drawn as closed boundaries; lines as-is.
    const polygons = polygonsOf(geometry);
    const rings = polygons.flat();
    const lines = linesOf(geometry);
    let colour = null;
    if (colourFor) {
      // A feature with no value in the chosen field still gets a colour — the
      // neutral grey the legend shows for it. Leaving it out desynchronised
      // the colour array from the position array by exactly that feature's
      // vertices, the lengths stopped matching, and the whole layer silently
      // fell back to one colour for its outlines while the fills were right.
      const css = colourFor(feature) || "#8a8a8a";
      scratch.set(css);
      colour = { r: scratch.r, g: scratch.g, b: scratch.b };
    }
    if (colour && !outlineOnly) {
      polygons.forEach((polygon) => fillTriangles(polygon, FILL_DRAPE, fill, colour));
      // The seam, at the fill's own height. See the note on `seal` above.
      rings.forEach((coords) => {
        const before = seal.positions.length;
        for (let i = 0; i + 1 < coords.length; i += 1) {
          if (onTileEdge(coords[i], coords[i + 1])) continue;
          const key = segKey(coords[i], coords[i + 1]);
          // No boundary between two pieces of ONE unit, and no second helping
          // of ink on a boundary that is really there.
          if (sharedSameUnit.has(key) || inked.has(key)) continue;
          // Nor a coarser survey's boundary ruled across finer geology.
          if (rankOf && coveredByFiner(
            (coords[i][0] + coords[i + 1][0]) / 2,
            (coords[i][1] + coords[i + 1][1]) / 2,
            rankOf(feature) || 0,
          )) continue;
          inked.add(key);
          pushSegment(seal.positions, coords[i], coords[i + 1], FILL_DRAPE);
        }
        for (let i = before; i < seal.positions.length; i += 3) {
          seal.colours.push(sealInk.r(colour), sealInk.g(colour), sealInk.b(colour));
        }
      });
    }
    /**
     * AN OUTLINED POLYGON HUGS THE GROUND, like the seal — it does not take
     * the lifted, depth-tested treatment a LineString gets.
     *
     * The note that used to be here said the rings could not use the seal
     * "because with no fill beneath them there is nothing for the seal's
     * coplanar trick to seal against". That reads the seal backwards: what
     * makes it hug is `depthTest: false` plus culling the far side BY FACING,
     * and neither of those needs a fill underneath. Coplanarity was never the
     * mechanism.
     *
     * The cost of getting it wrong is measured, on a drawn study area over
     * Northern Ireland: the ground there stands at **123.66 km** above the base
     * globe under the default exaggeration, and the outline sat at **76–102
     * km** — twenty to forty-seven kilometres UNDER the terrain, and depth
     * tested, so the hills ate it. Reported as the outline not being tight to
     * the surface, which is exactly what it was.
     *
     * A LineString still takes the lifted path: a river or a fault is a line
     * in its own right, not the edge of something, and it has always been
     * drawn that way.
     */
    if (colour && outlineOnly) {
      rings.forEach((coords) => {
        const before = seal.positions.length;
        for (let i = 0; i + 1 < coords.length; i += 1) {
          if (onTileEdge(coords[i], coords[i + 1])) continue;
          pushSegment(seal.positions, coords[i], coords[i + 1], FILL_DRAPE);
        }
        for (let i = before; i < seal.positions.length; i += 3) {
          seal.colours.push(colour.r, colour.g, colour.b);
        }
      });
    }
    [...(colour ? [] : rings), ...lines].forEach((coords) => {
      const before = linePositions.length;
      for (let i = 0; i + 1 < coords.length; i += 1) {
        /**
         * BAKED ON THE SURFACE, and lifted by the shader instead.
         *
         * These vertices used to be baked at the layer's own `drape` while
         * `attachReliefAttributes` below recovered their displacement as if
         * the drape were zero — so the clearance was welded into `aDisp` and
         * the shader could never take it back out. At the default 0.006 that
         * is **11.9 km**, and measured on a drawn study area over Inishowen
         * the outline stood 9.68 to 12.83 km above the ground it was tracing.
         * Seen obliquely it is painted to one side of its own map: reported
         * as the drawn polygon floating clear of the surface.
         *
         * Baking at nought makes `aDisp` honest, and the line material below
         * takes the LIFTED uniform — a fraction of the distance to the
         * surface, about 3 m on the ground and the old 11.9 km only from
         * orbit, where nothing can tell. That is the arrangement `LINE_DRAPE`
         * was written for and the comment above already claims.
         */
        pushSegment(linePositions, coords[i], coords[i + 1], FILL_DRAPE);
      }
      if (colour) {
        // One colour entry per position, added after the fact because
        // pushSegment splits long spans and only it knows how many it made.
        for (let i = before; i < linePositions.length; i += 3) {
          lineColours.push(colour.r, colour.g, colour.b);
        }
      }
    });
  });

  const group = new THREE.Group();
  group.name = name;

  // The exaggeration these vertices were built with, so the shader can undo it
  // and re-apply whatever the globe is drawn at now.
  // The reference the vertices above were built at -- NOT the live value, which
  // may be zero and would throw the terrain away.
  const builtRelief = typeof window.GeoIDViewer?.elevationNormalized === "function"
    ? REFERENCE_RELIEF
    : Number(window.GeoIDViewer?.getEffectiveRelief?.() ?? 0);
  if (fill.positions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(fill.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(fill.colours, 3));
    attachReliefAttributes(geometry, FILL_DRAPE, builtRelief);
    geometry.computeBoundingSphere();
    /**
     * DOUBLE-SIDED, and culled by WHERE a fragment is rather than by winding.
     *
     * The fill cannot depth-test — a flat facet never wins against displaced
     * terrain — so something else has to hide the far hemisphere, and using
     * `side: FrontSide` for that made the map hostage to ring winding. A
     * triangle wound the wrong way was then invisible from the near side (a
     * hole in the map, showing the dark ocean through it) and visible from the
     * far side (a coloured sliver drawn straight through the planet), which is
     * exactly how it was reported: "black when near side, coloured on the far
     * side".
     *
     * Turning every triangle outward at build time fixed the instances; this
     * fixes the class. The shader discards fragments whose own outward normal
     * faces away from the camera, so a triangle's winding decides nothing at
     * all, and no source — however its rings are wound — can punch a hole or
     * bleed through the globe.
     */
    const mesh = new THREE.Mesh(geometry, followRelief(new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: fillOpacity,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }), FILL_DRAPE, { cullFarSide: true, hole }));
    mesh.renderOrder = 1;
    // The vertices move on the GPU, so the bounding sphere computed above is
    // the one they had at build time and culling from it would drop the layer
    // exactly when the relief has moved it most.
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  if (seal.positions.length) {
    const ribbon = ribbonFromSegments(seal.positions, seal.colours);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(ribbon.pos, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(ribbon.col, 3));
    geometry.setAttribute("aPerp", new THREE.Float32BufferAttribute(ribbon.perp, 3));
    geometry.setAttribute("aSide", new THREE.Float32BufferAttribute(ribbon.side, 1));
    geometry.setIndex(ribbon.index);
    attachReliefAttributes(geometry, FILL_DRAPE, builtRelief);
    const sealOpacity = Number.isFinite(contacts?.opacity) ? contacts.opacity : 1;
    /**
     * A MESH now, not a line, and therefore double-sided and depth-free for
     * the FILL's reasons rather than the line's.
     *
     * As a line this had to keep the depth test, because a line has no facing
     * and would otherwise draw through the planet. A ribbon is triangles: the
     * shader discards fragments whose outward normal faces away, exactly as
     * the fill does, so the far hemisphere is culled without a depth test that
     * a facet coplanar with the fill could never win anyway.
     */
    const sealMaterial = followRelief(new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: sealOpacity,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }), FILL_DRAPE, { cullFarSide: true, hole, ribbon: true });
    // The stroke's OWN weight. `setOpacity` multiplies by this instead of
    // overwriting it, or the layer slider would promote a 25% contact to 40%
    // on its way to fading the sheet.
    sealMaterial.userData.baseOpacity = sealOpacity;
    const segments = new THREE.Mesh(geometry, sealMaterial);
    // Named, because `applyStack` rewrites renderOrder on every child and a
    // test that looks for this mesh by draw order finds nothing.
    segments.userData.geoidSeam = true;
    segments.renderOrder = 2;
    segments.frustumCulled = false;
    group.add(segments);
  }
  if (linePositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    const material = { transparent: true, opacity: 0.9, depthWrite: false };
    if (lineColours.length === linePositions.length) {
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColours, 3));
      material.vertexColors = true;
    } else {
      material.color = lineColor;
    }
    /**
     * LINES HUG THE GROUND TOO, by the seal's rule rather than by a lift.
     *
     * A line was drawn LIFTED and depth-tested — `drape` is 0.006 scene units,
     * and the globe is 3.2 units to 6,371 km, so that is **11.9 km above the
     * terrain**. Straight down it costs nothing; obliquely and close in the
     * line stands visibly off the coast it is tracing, which is what "the
     * outlines are still not tight to the surface" is.
     *
     * The lift existed because a line has no facing, so nothing culls the far
     * hemisphere for it and a ground-hugging line showed through the planet —
     * this file's own note about Australia's outline over the Atlantic. That
     * is solved by CULLING BY FACING, which is what the seal does and what
     * `followRelief(..., { cullFarSide: true })` is for. With the far side
     * discarded the depth test is not needed either, so the line can sit on
     * the ground where it belongs.
     */
    attachReliefAttributes(geometry, FILL_DRAPE, builtRelief);
    material.depthTest = false;
    const segments = new THREE.LineSegments(
      geometry,
      followRelief(new THREE.LineBasicMaterial(material), FILL_DRAPE,
        // A line has no facing to cull it, so it keeps the depth test to hide
        // the far hemisphere -- and a depth-tested line at zero clearance
        // sinks into the relief between its vertices. `lifted` gives it the
        // altitude-scaled clearance rather than a fixed kilometres-high one.
        { lifted: true, cullFarSide: true, hole }),
    );
    segments.renderOrder = 3;
    segments.frustumCulled = false;
    group.add(segments);
  }
  if (pointPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pointPositions, 3));
    /**
     * A CATALOGUE of places is sized in screen pixels; a point CLOUD is not.
     *
     * `sizeAttenuation: true` scales a point with distance, which is right for
     * an XYZ survey where the points ARE a surface and wrong for a set of
     * markers: 2,666 volcanoes at 0.018 scene units are sub-pixel from orbit,
     * so the layer loaded, the legend filled in with nine classes, and the
     * globe showed almost nothing. Measured before this: visible only as a
     * faint speckle along the Mediterranean.
     *
     * The discriminator is density, and it is a threshold rather than a rule,
     * so it is named. Under 20,000 points a layer is a set of places somebody
     * wants to see and click, and screen-space sizing keeps every one of them
     * legible at any zoom. Above it, a fixed pixel size would paint the globe
     * solid at a distance, so the points stay in world space and read as the
     * surface they sample.
     */
    const pointCount = pointPositions.length / 3;
    const asMarkers = pointStyle === "cloud" ? false
      : (pointStyle === "places" || pointCount <= 20000);
    /**
     * A big catalogue gets a smaller dot, and no ring.
     *
     * The white underlay is what separates a coloured mark from coloured
     * ground, and it is worth two draw calls at a few thousand points. At
     * ninety thousand it doubles the fill for a ring there is no room to see:
     * below about six pixels the disc and its outline are the same three
     * pixels of screen. So past the threshold the mark shrinks and stands
     * alone.
     */
    const denseCatalogue = asMarkers && pointCount > 20000;
    /**
     * A marker is a NODE: a disc in the symbology colour inside a heavy
     * white ring.
     *
     * The ring because a coloured mark on a coloured ground needs a neutral
     * separator, and it cannot live in the texture — the material multiplies
     * the texture by the vertex colour, so anything white in it would be
     * tinted with the fill (see markerDiscTexture). It is HEAVY on purpose:
     * a thin edge is what let the earlier circle disappear into round terrain
     * features on imagery, and a heavier one is the whole reason a circle can
     * be used at all. `alphaTest` cuts the sprite's square without opening
     * the depth sorting that `transparent` alone would.
     */
    /**
     * NO DEPTH TEST — a point sprite is cut by the ground, not by the sphere.
     *
     * Every fragment of a point sprite carries the CENTRE's depth, so a
     * depth-tested marker is sliced wherever the terrain in front of it is
     * nearer the camera than its own centre — which on a sphere seen
     * obliquely is most of the ground around it. A small dot got away with it
     * because a few pixels of quad is a few pixels of ground; a ringed node is
     * wide enough that the curve takes bites out of it, which is exactly what
     * the event markers already record and fixed the same way.
     *
     * Lifting the marker higher would trade the cut for parallax — a mark
     * standing off its own coordinate at close range — so the depth test comes
     * off and the far hemisphere is culled by FACING instead (`cullFarSide`
     * below), which on a sphere is exact: every vertex's outward normal is its
     * own direction, and the geometry already carries it as `aDir`.
     */
    const material = asMarkers
      ? {
        sizeAttenuation: false, depthWrite: false, depthTest: false,
        map: markerDiscTexture(), alphaTest: 0.35, transparent: true,
        // A ringed node at a few thousand; a plain dot at ninety thousand,
        // small enough that the planet does not fill in at a distance.
        ...(denseCatalogue ? { size: 3.4 } : {}),
      }
      : { size: pointSize, sizeAttenuation: true, depthWrite: false };
    if (pointColours.length === pointPositions.length) {
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(pointColours, 3));
      material.vertexColors = true;
    } else {
      material.color = pointColor;
    }
    /**
     * Points follow the relief the same way the lines above do — they did
     * not, and it went unseen for exactly as long as nobody flew in.
     *
     * `surfaceAt` bakes the REFERENCE exaggeration into the vertex, and the
     * elevation is normalised over the full GEBCO range, so sea level is
     * ~0.6 of it: every coastal point carried ~130 km of baked altitude
     * (measured: Vesuvius's dot at local radius 3.2691 against a 3.2 globe).
     * From orbit that is nothing; at 14 km up the whole layer is overhead and
     * behind the projection, and the volcanoes vanish exactly when you go to
     * look at one. The shader that re-applies the LIVE relief — and the
     * altitude-scaled clearance that keeps a marker metres above the ground
     * instead of kilometres — existed one paragraph up, for lines.
     */
    attachReliefAttributes(geometry, drape, builtRelief);
    if (asMarkers) {
      // The ring first, the tinted disc over it. Same geometry, same relief
      // shader; the underlay ignores the colour attribute and stays white.
      // Skipped entirely for a dense catalogue -- see `denseCatalogue`.
      const outline = denseCatalogue ? null : new THREE.Points(geometry, followRelief(
        registerMarkerMaterial(new THREE.PointsMaterial({
          sizeAttenuation: false, depthWrite: false, depthTest: false,
          map: markerDiscTexture(), alphaTest: 0.35, transparent: true, color: 0xffffff,
        }), "outline"),
        drape, { lifted: true, cullFarSide: true },
      ));
      if (outline) {
        outline.renderOrder = 4;
        outline.frustumCulled = false;
        group.add(outline);
      }
      const fill = new THREE.Points(geometry, followRelief(
        registerMarkerMaterial(
          new THREE.PointsMaterial(material),
          // A dense catalogue is sized on its own scale, so it must not be
          // rewritten by the shared marker size as the camera moves.
          denseCatalogue ? null : "fill",
        ),
        drape, { lifted: true, cullFarSide: true },
      ));
      fill.renderOrder = 4.1;
      fill.frustumCulled = false;
      group.add(fill);
    } else {
      /**
       * Only a MARKER is registered as one, and this cost 52 fps.
       *
       * `registerMarkerMaterial` writes the shared marker size — 7, in SCREEN
       * pixels, which is what it means for `sizeAttenuation: false`. Applied
       * to the >20,000-point path, which attenuates and sizes in WORLD units,
       * it made every point seven units across on a globe of radius 3.2: each
       * one more than twice the planet. Measured on a 90,987-point VIIRS fire
       * layer, 60 fps to 6, and the diagnosis is fill rate rather than vertex
       * count — a tenth of the points at that size ran at 50 fps, all of them
       * at a twentieth of the size ran at 61.
       */
      const pointMaterial = asMarkers
        ? registerMarkerMaterial(new THREE.PointsMaterial(material), "mark")
        : new THREE.PointsMaterial(material);
      const points = new THREE.Points(
        geometry,
        followRelief(pointMaterial, drape, {
          lifted: true,
          // Culled by facing only where the depth test is off — which is the
          // marker path. A world-space cloud keeps its depth test and needs no
          // help from the shader.
          cullFarSide: asMarkers,
        }),
      );
      points.renderOrder = 4;
      points.frustumCulled = false;
      group.add(points);
    }
  }

  const memo = { calls: surfaceCalls, distinct: surfaceMemo.size, hits: surfaceHits };
  surfaceMemo = null;
  return { object3D: group, truncated, memo };
}

/** Counts geometry kinds, for the layer list summary. */
export function describeCollection(fc) {
  const counts = { point: 0, line: 0, polygon: 0 };
  fc.features.forEach((f) => {
    const type = f.geometry?.type || "";
    if (type.includes("Point")) counts.point += 1;
    else if (type.includes("LineString")) counts.line += 1;
    else if (type.includes("Polygon")) counts.polygon += 1;
  });
  return counts;
}

/**
 * Wraps a FeatureCollection into the shape the import manager expects,
 * including an attribute sampler so it can take part in extraction.
 */
/**
 * A polygon layer is DRAWN as polygons, from the moment it lands.
 *
 * Rendering boundaries and nothing else made every vector layer look the same:
 * geology, catchments and a coastline were all the same green outline, and the
 * only way to see a geological map was to find the symbology panel and apply a
 * classification by hand. A map that requires a second step before it is a map
 * is not one.
 *
 * So the default symbology is computed at import — the rock-type column if the
 * layer has one, otherwise the best category field, otherwise a single wash —
 * and can be changed afterwards exactly as before. The legend is built from
 * the same object, so it agrees from the first frame.
 */
function defaultSymbology(fc) {
  const features = fc?.features || [];
  const hasPolygons = features.some((f) => polygonsOf(f.geometry).length);
  // Points earn a default too, for the same reason polygons do: a catalogue of
  // 2,666 volcanoes drawn in one flat yellow is a scatter plot of "somewhere",
  // and finding the Symbology button is not a step anybody should have to take
  // to see what kind of thing each dot is. `suggestCategoryField` already
  // refuses a column with a value per feature, so an XYZ point cloud with an
  // id column still lands as one colour rather than as noise.
  const hasPoints = features.some((f) => /Point$/.test(f?.geometry?.type || ""));
  if (!hasPolygons && !hasPoints) return null;
  const field = suggestCategoryField(features);
  if (field) {
    // No ramp named: the default is the qualitative set, which is what a list
    // of named units wants. Asking for "spectral" here used to be ignored and
    // now would not be -- thirteen units along one ramp is four shades of red.
    const sym = categoricalSymbology(features, field);
    if (sym.ok) return sym;
  }
  // No attribute worth classifying: one colour, still filled, so the extent of
  // the thing is visible rather than only its edge.
  return {
    ok: true, categorical: false, field: null,
    rows: [{ value: "features", count: features.length, colour: "#4fd1a5" }],
    colourOf: () => "#4fd1a5",
  };
}

/**
 * Colour columns a dataset publishes about ITSELF, in the spellings the
 * formats actually use. Shapefile DBF names come back upper case, GeoJSON
 * keeps whatever the writer chose, so both cases are listed rather than
 * lower-cased at the lookup -- a property bag is not case-insensitive and
 * pretending otherwise would match a "Color" that is a rock's colour
 * description rather than a fill.
 */
/**
 * A column NAMED for colour is the map's colouring however patchy it is; a
 * column that merely might be one has to prove itself.
 *
 * `color` holding hex values is not ambiguous -- a survey leaving some units
 * uncoloured does not make the rest less its own. `fill` and `hex` are guesses
 * at intent, and a vestigial one on a handful of rows would grey out the
 * others, so those must cover the great majority before they are believed.
 */
const NAMED_COLOUR_COLUMNS = ["color", "colour", "COLOR", "COLOUR"];
const GUESSED_COLOUR_COLUMNS = ["fill", "FILL", "hex", "HEX"];
const PUBLISHED_COLOUR_COLUMNS = [...NAMED_COLOUR_COLUMNS, ...GUESSED_COLOUR_COLUMNS];

const HEX_COLOUR = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const asHex = (value) => {
  const text = String(value ?? "").trim();
  return text.startsWith("#") ? text : `#${text}`;
};

/**
 * The column this collection is ALREADY painted in, if it has one.
 *
 * A geological map arrives with its colours in the file: Macrostrat writes a
 * `color` per unit, and so does everything exported from this viewer. Ignoring
 * that and classifying by feature count instead is how a re-imported clip came
 * back in twelve arbitrary ramp colours -- the same 97 polygons, none of them
 * the colour the survey published, which reads as a different map and, where
 * the invented colour is pale, as missing ground.
 *
 * MOST of the features must carry a valid hex -- not all of them, which is
 * what this demanded at first and was wrong. A survey leaves the odd unit
 * uncoloured, and requiring every one threw away the other ninety-five:
 * measured, blanking ONE colour of 96 turned the whole layer back to this
 * app's twelve-class ramp with an "(other)" bucket, which is a different map
 * from the one the file describes. Reported as the import failing to assign
 * polygons and falling back on "(other)".
 *
 * So the column is used when it covers the great majority, and the few
 * features it does not cover are drawn in a neutral grey and SAID so in the
 * key. Painting most of the map as its survey painted it and admitting the
 * remainder beats inventing colours for all of it. Below the threshold the
 * column is not the map's colouring at all -- a stray `fill` on a tenth of the
 * rows would otherwise grey out the other nine tenths.
 */
/**
 * How much of a column has to be a colour before it is the map's colouring.
 *
 * A NAMED column needs only enough to be more than vestigial: measured, a clip
 * whose colour column covered less than four fifths fell back to this app's
 * twelve-class ramp with an "(other)" bucket, which is a different map from
 * the one the file describes -- and it is the second time this threshold has
 * been the fault. A GUESSED column keeps the strict bar.
 */
const NAMED_COLOUR_COVERAGE = 0.2;
const GUESSED_COLOUR_COVERAGE = 0.8;

export function publishedColourField(fc) {
  const features = fc?.features || [];
  if (!features.length) return null;
  for (const key of PUBLISHED_COLOUR_COLUMNS) {
    let valid = 0;
    for (const feature of features) {
      if (HEX_COLOUR.test(String(feature?.properties?.[key] ?? "").trim())) valid += 1;
    }
    if (!valid) continue;
    const needed = NAMED_COLOUR_COLUMNS.includes(key)
      ? NAMED_COLOUR_COVERAGE : GUESSED_COLOUR_COVERAGE;
    if (valid / features.length >= needed) return key;
  }
  return null;
}

/** What a feature with no published colour is drawn in, and called in the key. */
const UNPUBLISHED_COLOUR = "#8a8a8a";
const UNPUBLISHED_LABEL = "No colour published";

/**
 * A symbology in the file's own colours, shaped like `categoricalSymbology`
 * so every path downstream -- the scheduled paint, the legend, the symbology
 * panel -- treats it as the ordinary classified layer it is.
 *
 * Rows are keyed by LABEL AND COLOUR together. Two units can share a colour
 * (Macrostrat gives every Proterozoic quartzite the same pink) and one name
 * can appear in two colours across merged surveys; collapsing on either alone
 * loses a row that is really there.
 */
/** A feature's ground in km2: outer rings less their holes. */
function featureGroundKm2(feature) {
  let km2 = 0;
  for (const rings of polygonsOf(feature?.geometry)) {
    rings.forEach((ring, i) => {
      const area = sphericalPolygonAreaKm2(ring.map(([lon, lat]) => ({ lat, lon })));
      km2 += (i === 0 ? 1 : -1) * Math.abs(area);
    });
  }
  return km2;
}

/**
 * The symbology a file declared, turned into the object every path here reads.
 *
 * Categories are matched on the value of the style's own field -- which is the
 * DBF column, so the features carry it under exactly that name. A feature
 * whose value is in no category keeps the neutral rather than being dropped
 * into an invented class.
 */
function styleSymbology(fc, style) {
  const field = style?.field;
  const categories = Array.isArray(style?.categories) ? style.categories : [];
  if (!field || !categories.length) return null;
  const features = fc?.features || [];
  const colourFor = new Map(categories.map((c) => [String(c.value), asHex(c.colour)]));
  const counts = new Map();
  let unmatched = 0;
  for (const feature of features) {
    const value = String(feature?.properties?.[field] ?? "");
    if (!colourFor.has(value)) { unmatched += 1; continue; }
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  // Only the categories this file actually uses: a style may describe more
  // than a clip of it contains, and a key naming units that are not here is
  // furniture.
  const rows = categories
    .filter((c) => counts.has(String(c.value)))
    .map((c) => ({ value: c.label || c.value, count: counts.get(String(c.value)),
      colour: asHex(c.colour) }));
  if (!rows.length) return null;
  const listed = rows.slice(0, 12);
  if (unmatched) {
    listed.push({ value: UNPUBLISHED_LABEL, count: unmatched, colour: UNPUBLISHED_COLOUR });
  }
  return {
    ok: true,
    categorical: true,
    field,
    rows: listed,
    total: rows.length,
    colourOf: (feature) =>
      colourFor.get(String(feature?.properties?.[field] ?? "")) || UNPUBLISHED_COLOUR,
  };
}

function publishedSymbology(fc, key) {
  const features = fc?.features || [];
  const field = suggestCategoryField(features);
  const published = (feature) => {
    const raw = String(feature?.properties?.[key] ?? "").trim();
    return HEX_COLOUR.test(raw) ? asHex(raw) : null;
  };
  const rows = new Map();
  let unpublished = 0;
  for (const feature of features) {
    const colour = published(feature);
    if (!colour) { unpublished += 1; continue; }
    const label = field ? String(feature?.properties?.[field] ?? "").trim() : "";
    const id = `${label}\u0000${colour}`;
    const row = rows.get(id) || { value: label || colour, count: 0, km2: 0, colour };
    row.count += 1;
    row.km2 += featureGroundKm2(feature);
    rows.set(id, row);
  }
  /**
   * RANKED BY GROUND, not by how many pieces a unit arrived in -- the same
   * rule `legendFrom` follows for the clip's own key, and for the same reason:
   * a unit broken into nine slivers outranks one solid mass, and the mass is
   * what a reader is looking at. Measured there, ranking by count sent 572 km2
   * of mapped ground into the unlisted remainder.
   */
  const ranked = [...rows.values()]
    .sort((a, b) => (b.km2 - a.km2) || (b.count - a.count));
  const listed = ranked.slice(0, 12);
  // The grey is a row of its own, last, and only when something is actually
  // drawn in it -- a key that lists a colour nothing wears is furniture.
  if (unpublished) {
    listed.push({ value: UNPUBLISHED_LABEL, count: unpublished, colour: UNPUBLISHED_COLOUR });
  }
  return {
    ok: true,
    categorical: true,
    field: field || null,
    rows: listed,
    /**
     * How many units there ARE, so the key can admit to being a summary.
     * Without this a named unit outside the top twelve simply is not in the
     * legend and nothing says why -- reported as a polygon whose name the
     * legend calls "(other)".
     */
    total: ranked.length,
    colourOf: (feature) => published(feature) || UNPUBLISHED_COLOUR,
  };
}

export function buildVectorLayerResult(fc, {
  name, fields = [], drape = 0.006, outlineOnly = false, pointStyle = "auto",
  rankOf = null,
  /**
   * How this layer's contacts are stroked — the same object the tiled geology
   * layers take. Held on the LAYER rather than passed per paint, for the
   * reason `fillMode` is: every recolour goes back through `repaintVector`,
   * and a style the caller must re-supply on each one is a style lost the
   * first time anything else repaints.
   *
   * Default null, which `renderFeatureCollection` reads as "match" — the
   * polygon's own colour, an outline nobody can see. Right for a catchment or
   * a coastline; wrong for a geological map, where the contact IS the
   * information.
   */
  contacts = null,
  /**
   * A style that CAME WITH THE FILE -- `{ field, categories: [{value, colour}] }`,
   * read from the `.qml` this app writes beside every shapefile it exports.
   *
   * It outranks everything inferred here. The attribute table can only be
   * asked what colour a feature is; the style says what the MAP is, including
   * for a column that is patchy or absent, which is exactly the case where
   * inference falls back to a ramp and loses the map the file describes.
   */
  style = null,
} = {}) {
  /**
   * The fill mode rides with the LAYER, not with a paint call.
   *
   * `repaint` is called by every symbology path — the default paint on load,
   * the dialog's Apply, a catalogue's palette — and none of them knows or
   * should know whether this layer is drawn filled. Holding it here means
   * choosing "outline only" once survives every later recolour, instead of
   * the next Apply quietly filling the polygon back in.
   */
  let fillMode = outlineOnly ? "outline" : "solid";
  const bounds = collectionBounds(fc);
  const georeferenced = looksLikeGeographic(bounds);
  // A style that came with the file outranks the file's colours, which outrank
  // a classification invented here.
  const declared = styleSymbology(fc, style);
  /**
   * THE COLUMN IS REPORTED EVEN WHEN A DECLARED STYLE DOES THE PAINTING.
   *
   * This read `declared ? null : publishedColourField(fc)` — reasonable, since
   * a style that paints needs nothing inferred. But `publishedColourField` is
   * not only how the layer gets painted: it is how the layer SAYS what it is
   * coloured by, and two things downstream ask.
   *
   * `import-manager` sets `sourceColourField` from it and `geologyField` with
   * it, so with it null the Symbology dialog cannot see the layer's own
   * colouring and opens on a PROPOSAL instead — measured on a re-imported
   * clip, "By attribute / LITH — 20 values / qualitative", twelve classes and
   * an `(other)` bucket holding ten features. Nothing on the map is in that
   * bucket; the layer is wearing the survey's own colours. Pressing Apply on
   * what the dialog opened with would have replaced every one of them.
   *
   * And `inheritedColouring` in the tool runner reads the same field, so a
   * clip of a re-imported map fell back to the ramp — the exact round trip
   * this style file was added to close, closed at one end and open at the
   * other.
   */
  const published = publishedColourField(fc);
  const symbology = declared
    || (published ? publishedSymbology(fc, published) : defaultSymbology(fc));
  // Outlines first, fills straight after — NOT both in one pass.
  //
  // Filling means triangulating every ring and lifting every triangle vertex
  // onto the displaced surface, and doing that inside the import blocked it:
  // measured on the BGS bedrock layer, the import did not complete in five
  // minutes where it used to take seconds. The geometry is the same either
  // way; what changes is that the layer is on the globe immediately and gains
  // its colours a moment later, instead of the user waiting for both.
  let contactStyle = contacts || null;
  /**
   * AN OUTLINE IS PAINTED IN THE FIRST PASS, because it has no fill to defer.
   *
   * The two-pass build exists so a heavy layer reaches the globe before it is
   * triangulated. An outline-only layer has nothing to triangulate, and going
   * through the first pass uncoloured cost it its height: rings reach the SEAL
   * only when a colour is available, so without one they fall to the lifted
   * line buffer instead -- measured, a drawn study area was 467 m above the
   * ground at a 23 km view and 11.9 km from orbit, until the scheduled paint
   * landed a tick later and put it on the surface. Reported as the drawn
   * outlines floating above the geology while the world layer's sat on it --
   * the world layer's tiles have always passed a colour.
   *
   * Worse than the flash: a layer whose default paint never runs stays up
   * there for good.
   */
  const firstPaint = outlineOnly && symbology ? (f) => symbology.colourOf(f) : null;
  const { object3D, truncated } = renderFeatureCollection(fc, {
    name, drape, pointStyle, rankOf, contacts: contactStyle,
    outlineOnly, colourFor: firstPaint,
  });
  let lastColourFor = null;

  /**
   * Redraw this layer with a colour per feature.
   *
   * The children are replaced inside the SAME group, so the layer keeps its
   * place in the scene, its parent's spin frame and its entry in the stack —
   * re-rendering into a new group would drop it out of the globe's frame and
   * leave it a fixed distance from a turning planet.
   */
  const repaintVector = (colourFor) => {
    lastColourFor = colourFor;
    const next = renderFeatureCollection(fc, {
      // `rankOf` rides through every repaint: a recolour must not undo the
      // survey precedence, or the coarse boundaries come back on the next
      // symbology change.
      name, drape, colourFor, pointStyle, rankOf, outlineOnly: fillMode === "outline",
      // Rides through every repaint for `rankOf`'s reason: a recolour must not
      // quietly return the contacts to invisible.
      contacts: contactStyle,
    });
    [...object3D.children].forEach((child) => {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      object3D.remove(child);
    });
    [...next.object3D.children].forEach((child) => object3D.add(child));
    return object3D.children.length > 0;
  };
  const counts = describeCollection(fc);

  const polygonIndex = fc.features
    .map((f) => ({ polygons: polygonsOf(f.geometry), properties: f.properties }))
    .filter((entry) => entry.polygons.length)
    .map((entry) => {
      const coords = entry.polygons.flat().flat();
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      coords.forEach(([x, y]) => {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      });
      return { ...entry, bbox: { minX, minY, maxX, maxY } };
    });

  // Scheduled rather than awaited: `addDerivedLayer` puts `object3D` into the
  // scene as soon as this returns, and repaint replaces the children of that
  // same group, so the fills land in a layer that is already visible.
  if (symbology) {
    setTimeout(() => {
      try { repaintVector((f) => symbology.colourOf(f)); } catch (error) { /* outlines stand */ }
    }, 0);
  }

  return {
    object3D,
    repaint: repaintVector,
    // Named so a layer built from published colours can say so, and a tool
    // run on it can inherit the column rather than re-detect it.
    publishedColourField: published,
    /**
     * PUT THE MAP BACK IN THE COLOURS IT ARRIVED IN.
     *
     * The symbology dialog can class a layer by any column, and until now
     * that was a one-way door: a geological map painted in its survey's own
     * colours, explored by lithology and then changed back, came back in the
     * twelve-class ramp because the ramp was the only "categories" the dialog
     * knew how to apply. The colours the file published are neither a ramp nor
     * one flat colour, so they need their own way home.
     *
     * It is the same closure that painted the layer at build time, so this
     * cannot drift from what the layer originally wore -- there is no second
     * derivation to keep in step.
     */
    sourceSymbology: symbology && (declared || published)
      ? {
        field: symbology.field || null,
        declared: Boolean(declared),
        rows: symbology.rows,
        apply: () => { repaintVector((f) => symbology.colourOf(f)); },
      }
      : null,
    /**
     * Switch between a filled polygon and its outline.
     *
     * Re-runs the LAST paint rather than asking the caller for the colours
     * again: the fill mode and the palette are separate choices, and making
     * a caller re-supply one to change the other is how the two drift.
     */
    setFillMode: (mode) => {
      const next = mode === "outline" ? "outline" : "solid";
      if (next === fillMode) return fillMode;
      fillMode = next;
      // With no paint yet the layer is already drawn as bare outlines, so
      // there is nothing to redraw until its colours arrive.
      if (lastColourFor) repaintVector(lastColourFor);
      return fillMode;
    },
    getFillMode: () => fillMode,
    /**
     * Restroke the contacts, so ONE control means one thing.
     *
     * The geology panel's contact selector walks every layer that can answer
     * this. Without it, changing the style moved the tiled layers and left
     * every clip of them drawn the old way — two maps of the same ground
     * disagreeing about their own boundaries.
     */
    setContacts: (style) => {
      contactStyle = style || null;
      if (lastColourFor) repaintVector(lastColourFor);
      return contactStyle;
    },
    getContacts: () => contactStyle,
    // The legend is derived from the symbology that was actually drawn, never
    // from a second guess about it.
    legendInfo: symbology?.rows?.length
      ? {
        palette: symbology.rows.map((r) => r.colour.replace("#", "")),
        labels: symbology.rows.map((r) => r.value),
        categorical: Boolean(symbology.categorical),
        /**
         * A CLASS LIST, and the dock has to be told so.
         *
         * Without this flag the legend card falls through to its continuous
         * branch and draws these rows as a smooth left-to-right gradient with
         * the two ends labelled -- so twenty-two named geological units became
         * one rainbow bar naming none of them, and every other classified
         * import with it. Every other legend producer here says `classed`
         * (macrostrat.js, symbology.js, the symbology dialog); this one was
         * the only classification that never did, which is why its rows had
         * nowhere to appear.
         *
         * Always true: these rows are a set of named classes even when there
         * is one of them, and one class as a gradient is no more readable
         * than twenty-two.
         */
        classed: true,
        field: symbology.field || null,
      }
      : null,
    /**
     * "12 of 18 units", when the key lists fewer than the layer holds. The
     * clip's own legend has said this since it was written; an imported copy
     * of the same map said nothing, so a unit outside the top twelve looked
     * missing rather than unlisted.
     */
    legendSummary: symbology?.total && symbology.total > (symbology.rows?.length || 0)
      ? `${symbology.rows.length} of ${symbology.total} units`
      : null,
    georeferenced,
    bounds: georeferenced ? bounds : null,
    collection: fc,
    features: fc.features,
    sampler: polygonIndex.length
      ? (lat, lon) => {
        const x = lon > 180 ? lon - 360 : lon;
        for (let i = 0; i < polygonIndex.length; i += 1) {
          const entry = polygonIndex[i];
          const b = entry.bbox;
          if (x < b.minX || x > b.maxX || lat < b.minY || lat > b.maxY) continue;
          const inside = entry.polygons.some((polygon) => {
            const ring = polygon[0];
            let hit = false;
            for (let a = 0, c = ring.length - 1; a < ring.length; c = a, a += 1) {
              const [xi, yi] = ring[a];
              const [xj, yj] = ring[c];
              if (((yi > lat) !== (yj > lat))
                && (x < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-15) + xi)) {
                hit = !hit;
              }
            }
            return hit;
          });
          if (inside) return entry.properties;
        }
        return null;
      }
      : null,
    info: {
      featureCount: fc.features.length,
      points: counts.point,
      lines: counts.line,
      polygons: counts.polygon,
      fields: fields.length
        ? fields
        : [...new Set(fc.features.flatMap((f) => Object.keys(f.properties || {})))],
      sampleable: polygonIndex.length > 0,
      valueKind: "attributes",
      truncated,
    },
  };
}
