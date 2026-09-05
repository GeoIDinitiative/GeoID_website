/**
 * A DRAPE FOLLOWS THE GROUND EVERY FRAME, NOT FOUR TIMES A SECOND.
 *
 * The globe's terrain exaggeration eases off continuously as the camera
 * descends, so the surface is at a different height in every frame of a zoom.
 * A raster patch is laid on that surface once and was corrected by a 250 ms
 * poll: measured on the soil-thickness sheet over a three-second zoom from
 * 145 km to 20 km, the relief its vertices were laid at differed from the one
 * the globe was drawn with by a MEAN OF 4.1 KM, worst 20 km, and the trace
 * sawtoothed as the patch fell behind and was snapped back. Reported twice,
 * as the map floating and then as the map moving as we zoom.
 *
 * The vector layers had already solved it: each vertex carries its direction
 * and its displacement as a FRACTION of the relief it was built with, and one
 * uniform places them on the GPU. This pins the arithmetic that makes that
 * work -- and the one case where it cannot.
 *
 * Run: node GeoID_GIS/viewer/gis/drape-relief.test.mjs
 */

import { readFileSync } from "node:fs";
import * as THREE from "../vendor/three.module.js";

let pass = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); pass += 1; console.log(`PASS ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };
const near = (a, b, tol, what) => {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: ${a} vs ${b}`);
};

globalThis.window = { GeoIDViewer: { GLOBE_RADIUS: 3.2, elevationNormalized: () => 0.5 } };
const { attachReliefAttributes } = await import("./vector-render.js");

const BASE = 3.2;
const METRES = 6371000 / 3.2;      // one relief unit, in metres of ground

/**
 * The viewer's own surface, as the drape assumes it: a point's radius is the
 * globe's plus its own elevation TIMES the exaggeration, plus whatever the
 * layer is lifted by. The whole follow rests on that being LINEAR in the
 * relief -- if it were not, a patch laid at one exaggeration could not be
 * replaced at another by scaling.
 */
const surfaceRadius = (height, relief, drape) => BASE + height * relief + drape;

/** A patch of four vertices at four different ground heights. */
function patchAt(relief, drape, heights) {
  const geometry = new THREE.BufferGeometry();
  const xyz = new Float32Array(heights.length * 3);
  heights.forEach((h, i) => {
    // Four directions that are not the same, so aDir has something to say.
    const theta = (i / heights.length) * Math.PI * 2;
    const dir = [Math.cos(theta), 0.3, Math.sin(theta)];
    const len = Math.hypot(...dir);
    const r = surfaceRadius(h, relief, drape);
    for (let k = 0; k < 3; k += 1) xyz[i * 3 + k] = (dir[k] / len) * r;
  });
  geometry.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
  return geometry;
}

const HEIGHTS = [0, 0.001, 0.004, 0.0125];   // sea level to about 25 km at relief 1

check("the displacement is recovered as a fraction of the relief it was built at", () => {
  const relief = 0.11;
  const geometry = patchAt(relief, 0, HEIGHTS);
  attachReliefAttributes(geometry, 0, relief);
  const disp = geometry.attributes.aDisp;
  HEIGHTS.forEach((h, i) => near(disp.getX(i), h, 1e-6, `vertex ${i}`));
});

/**
 * THE PROPERTY THE WHOLE THING RESTS ON. A patch built at one exaggeration is
 * drawn at another by scaling its displacement, and must land exactly where
 * the surface itself has moved to.
 */
check("a patch drawn at another relief lands on the surface at that relief", () => {
  const built = 0.0014, live = 0.0387;        // measured: 74 km of ground movement
  ok(Math.abs(live - built) * METRES > 70000, "the two reliefs are a long way apart");
  const geometry = patchAt(built, 0, HEIGHTS);
  attachReliefAttributes(geometry, 0, built);
  const dir = geometry.attributes.aDir, disp = geometry.attributes.aDisp;
  HEIGHTS.forEach((h, i) => {
    // What the vertex shader computes: aDir * (base + aDisp * uRelief + uDrape).
    const drawn = BASE + disp.getX(i) * live;
    /**
     * TEN METRES, and the floor is float32 rather than the arithmetic.
     * Positions and displacements are stored as 32-bit floats, and one ulp at
     * a radius of 3.2 units is 4.8e-7 -- **0.95 m of ground**. A couple of
     * roundings put a few metres between the two paths and nothing can remove
     * them short of a double-precision attribute. Measured on the globe
     * against `surfacePoint` itself over a 74 km swing in relief: mean 3.1 m,
     * worst 7.1 m, which is this and not a modelling error.
     */
    near((drawn - surfaceRadius(h, live, 0)) * METRES, 0, 10,
      `vertex ${i} is on the ground, in metres`);
    near(Math.hypot(dir.getX(i), dir.getY(i), dir.getZ(i)), 1, 1e-6, `aDir ${i} is a unit vector`);
  });
});

check("the lift a layer is drawn at is divided out, not scaled with the terrain", () => {
  const relief = 0.11, drape = 0.0005;
  const geometry = patchAt(relief, drape, HEIGHTS);
  attachReliefAttributes(geometry, drape, relief);
  const disp = geometry.attributes.aDisp;
  // The lift is a fixed clearance, so it must not appear in the displacement:
  // scaled with the relief it would grow and shrink with the exaggeration.
  HEIGHTS.forEach((h, i) => near(disp.getX(i), h, 1e-6, `vertex ${i}`));
});

/**
 * ZERO RELIEF IS THE CASE THAT CANNOT BE FOLLOWED, and it must fail loudly
 * rather than quietly: dividing it out gives every vertex a displacement of
 * zero, which pins the patch to the bare sphere while the terrain rises away
 * from it -- 219 km of it at the slider's default.
 */
check("a patch built at zero relief cannot recover its displacement", () => {
  const geometry = patchAt(0, 0, HEIGHTS);
  attachReliefAttributes(geometry, 0, 0);
  const disp = geometry.attributes.aDisp;
  HEIGHTS.forEach((_, i) => near(disp.getX(i), 0, 1e-9, `vertex ${i} is flat`));
});

check("so the adapter refuses to follow one, and polls it instead", () => {
  const src = readFileSync(new URL("./geotiff-adapter.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/if \(!\(Number\.isFinite\(relief\) && Math\.abs\(relief\) > 1e-9\)\) return false;/.test(src),
    "followTheRelief refuses a zero relief");
  ok(/if \(!followTheRelief\([^)]*\)\) registerDrape\(mesh\);/.test(src),
    "the poll is the fallback, taken only when the follow is refused");
  ok(/drapes\.delete\(mesh\)/.test(src),
    "and a polled patch stops being polled once it can follow");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`${pass} passed`);
