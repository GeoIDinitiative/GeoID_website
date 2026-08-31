/**
 * Filled polygon, or just its edge.
 *
 * A silently-ignored option is the failure mode here: pass `outlineOnly` to a
 * renderer that does not read it and the layer draws exactly as before, the
 * control in the dialog appears to do nothing, and there is no error anywhere
 * to say why. So this asserts on the GEOMETRY the renderer actually produced —
 * a fill is triangles in a Mesh — rather than on the option having been
 * accepted.
 *
 * The SEAL is a mesh too now: it used to be a one-pixel LineSegments and is a
 * ground-width ribbon of triangles, so "is it a Mesh" no longer separates a
 * fill from an edge. It carries `userData.geoidSeam`, which does, and which is
 * why that flag exists.
 *
 * Run: node GeoID_GIS/viewer/gis/vector-fill-mode.test.mjs
 */

/* The renderer lifts every vertex onto the globe's displaced surface through
   `window.GeoIDViewer`. There is no globe here and none is needed — this is
   about which BUFFERS get built, not where the vertices land — so the seam is
   stubbed with a sphere of constant radius. Absent entirely it throws inside
   `fillTriangles`, which would fail the test for a reason unrelated to it. */
globalThis.window = {
  GeoIDViewer: {
    elevationNormalized: () => 0.5,
    surfacePoint: null,
  },
};

const { renderFeatureCollection, buildVectorLayerResult } = await import("./vector-render.js");

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

const square = (name = "Study area 1") => ({
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: { name, kind: "drawn", vertices: 4, area_km2: 1234 },
    geometry: {
      type: "Polygon",
      coordinates: [[[10, 40], [14, 40], [14, 44], [10, 44], [10, 40]]],
    },
  }],
});

/** What was drawn, by three.js type — the honest read of "filled or not". */
function shapeOf(object3D) {
  const kinds = { meshes: 0, seams: 0, lineSegments: 0, points: 0 };
  object3D.traverse((child) => {
    // The seam ribbon is counted as an EDGE however it is drawn.
    if (child.userData?.geoidSeam) kinds.seams += 1;
    else if (child.isMesh) kinds.meshes += 1;
    else if (child.isLineSegments) kinds.lineSegments += 1;
    else if (child.isPoints) kinds.points += 1;
  });
  return kinds;
}

/** Boundary drawn at all, as a ribbon or as bare lines. */
const edges = (object3D) => {
  const k = shapeOf(object3D);
  return k.seams + k.lineSegments;
};

const paint = () => "#4fd1a5";

// ── The renderer honours the option ──────────────────────────────────────
const filled = renderFeatureCollection(square(), { name: "filled", colourFor: paint });
const outlined = renderFeatureCollection(square(), {
  name: "outlined", colourFor: paint, outlineOnly: true,
});

check("a coloured polygon is FILLED by default", shapeOf(filled.object3D).meshes >= 1, true);
check("outlineOnly draws no fill mesh", shapeOf(outlined.object3D).meshes, 0);
check("outlineOnly still draws the boundary", edges(outlined.object3D) >= 1, true);

/* The colour must survive the switch. An outline in the renderer's default
   mint while the legend shows the layer's own colour is the "legend is not
   evidence the map was painted" trap, one geometry down. */
function firstColour(object3D) {
  let rgb = null;
  object3D.traverse((child) => {
    if (rgb) return;
    const attr = child.geometry?.getAttribute?.("color");
    if (attr && attr.count) rgb = [attr.array[0], attr.array[1], attr.array[2]];
  });
  return rgb;
}
const outlineColour = firstColour(outlined.object3D);
check("the outline carries a per-feature colour", Array.isArray(outlineColour), true);
check("and it is not left black", outlineColour?.some((c) => c > 0.01), true);

// ── The mode rides with the LAYER, across repaints ───────────────────────
const layer = buildVectorLayerResult(square(), { name: "drawn", outlineOnly: true });
check("a layer built outlineOnly reports it", layer.getFillMode(), "outline");
check("it exposes a switch", typeof layer.setFillMode, "function");

layer.repaint(paint);
check("painting an outline layer does not fill it",
  shapeOf(layer.object3D).meshes, 0);
check("and the mode is unchanged by a repaint", layer.getFillMode(), "outline");

check("switching to solid reports solid", layer.setFillMode("solid"), "solid");
check("switching to solid FILLS it", shapeOf(layer.object3D).meshes >= 1, true);
/* Re-running the last paint rather than asking for the colours again is what
   makes the fill mode and the palette independent; if it dropped them the
   polygon would come back in the renderer's default, not the layer's. */
check("the colour survived the switch",
  firstColour(layer.object3D)?.some((c) => c > 0.01), true);

check("switching back returns to the outline", layer.setFillMode("outline"), "outline");
check("and the fill is gone again", shapeOf(layer.object3D).meshes, 0);
check("setting the mode it already has is a no-op", layer.setFillMode("outline"), "outline");
check("anything not 'outline' means solid", layer.setFillMode("nonsense"), "solid");

// ── The default for an ordinary import is unchanged ──────────────────────
const ordinary = buildVectorLayerResult(square(), { name: "imported" });
check("an ordinary vector layer is still solid", ordinary.getFillMode(), "solid");

// A layer built with no paint yet is bare outlines already, so flipping the
// mode has nothing to redraw and must not throw reaching for a colourFor.
const unpainted = buildVectorLayerResult(square(), { name: "unpainted" });
let threw = false;
try { unpainted.setFillMode("outline"); } catch { threw = true; }
check("switching before any paint does not throw", threw, false);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
