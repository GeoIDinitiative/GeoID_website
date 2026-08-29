import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic } from "./geo-utils.js?v=20260829-e9c2d82";
import { collectionBounds, geometryCoords, polygonsOf, linesOf } from "./geoprocessing.js?v=20260829-e9c2d82";
import { categoricalSymbology, suggestCategoryField } from "./symbology.js?v=20260829-e9c2d82";

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
 * Place the vertex at the CURRENT relief instead of the one it was built at.
 *
 * `lifted` hands the clearance to the shared line uniform above, so it follows
 * the camera down; everything else keeps the fixed clearance it was built with.
 */
export function followRelief(material, drape, {
  lifted = false, cullFarSide = false, hole = null,
} = {}) {
  // `true` means the silhouette itself; a number moves the cut inside it.
  const facingLimit = cullFarSide === true ? 0 : Number(cullFarSide) || 0;
  const base = baseRadius();
  const drapeUniform = lifted ? LINE_DRAPE_UNIFORM : { value: drape };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRelief = RELIEF_UNIFORM;
    shader.uniforms.uDrape = drapeUniform;
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
${cullFarSide ? "varying float vFacing;" : ""}
${hole ? "varying vec3 vDir;" : ""}
${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      `vec3 transformed = aDir * (${base.toFixed(4)} + aDisp * uRelief + uDrape);`
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
    `geoid-relief-${material.type}-${lifted ? "live" : drape}`
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

  fc.features.forEach((feature) => {
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
          pushSegment(seal.positions, coords[i], coords[i + 1], FILL_DRAPE);
        }
        for (let i = before; i < seal.positions.length; i += 3) {
          seal.colours.push(colour.r, colour.g, colour.b);
        }
      });
    }
    // A coloured polygon's rings went into the seal above, at the fill's own
    // height. What is left here is the outline-first pass -- a layer on the
    // globe before its symbology arrives -- and any LineString features, both
    // of which keep the lifted, depth-tested treatment lines have always had.
    [...(colour && !outlineOnly ? [] : rings), ...lines].forEach((coords) => {
      const before = linePositions.length;
      for (let i = 0; i + 1 < coords.length; i += 1) {
        pushSegment(linePositions, coords[i], coords[i + 1], drape);
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(seal.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(seal.colours, 3));
    attachReliefAttributes(geometry, FILL_DRAPE, builtRelief);
    const segments = new THREE.LineSegments(geometry, followRelief(new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1,
      depthTest: false, depthWrite: false,
    }), FILL_DRAPE, { cullFarSide: true, hole }));
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
    attachReliefAttributes(geometry, drape, builtRelief);
    const segments = new THREE.LineSegments(
      geometry, followRelief(new THREE.LineBasicMaterial(material), drape, { lifted: true }),
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

export function buildVectorLayerResult(fc, {
  name, fields = [], drape = 0.006, outlineOnly = false, pointStyle = "auto",
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
  const symbology = defaultSymbology(fc);
  // Outlines first, fills straight after — NOT both in one pass.
  //
  // Filling means triangulating every ring and lifting every triangle vertex
  // onto the displaced surface, and doing that inside the import blocked it:
  // measured on the BGS bedrock layer, the import did not complete in five
  // minutes where it used to take seconds. The geometry is the same either
  // way; what changes is that the layer is on the globe immediately and gains
  // its colours a moment later, instead of the user waiting for both.
  const { object3D, truncated } = renderFeatureCollection(fc, { name, drape, pointStyle });
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
      name, drape, colourFor, pointStyle, outlineOnly: fillMode === "outline",
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
    // The legend is derived from the symbology that was actually drawn, never
    // from a second guess about it.
    legendInfo: symbology?.rows?.length
      ? {
        palette: symbology.rows.map((r) => r.colour.replace("#", "")),
        labels: symbology.rows.map((r) => r.value),
        categorical: Boolean(symbology.categorical),
        field: symbology.field || null,
      }
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
