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
const { attachReliefAttributes, attachExactReliefAttributes, followRelief, getRenderRelief }
  = await import("./vector-render.js");
globalThis.__exact = attachExactReliefAttributes;

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

/**
 * THE PUMP IS PART OF FOLLOWING, NOT PART OF IMPORTING.
 *
 * Everything above is the arithmetic of the follow, and all of it was right
 * while the basemap still drew a second Earth. The uniform that carries the
 * relief was fed from the IMPORT MANAGER's frame step, installed when the
 * first imported layer creates its group -- so in a page whose only follower
 * is the basemap drape, nothing ever drove it and `uRelief` kept the zero it
 * was declared with. Measured live at the slider's maximum, the imagery drew
 * **180 to 276 km below the terrain**, and the event markers, which take
 * their height from the globe's own surface and were on it to within 50 m,
 * appeared to float above it.
 *
 * A follower that nothing drives is the bug. These pin that following is what
 * installs the drive.
 */
const frame = (scene) => scene.onBeforeRender();

check("following the relief installs the frame step that drives it", () => {
  const scene = {};
  window.GeoIDViewer.scene = scene;
  window.GeoIDViewer.getEffectiveRelief = () => 0.3;
  followRelief({}, 0);
  ok(typeof scene.onBeforeRender === "function", "a step was installed");
  frame(scene);
  near(getRenderRelief(), 0.3, 1e-9, "the uniform carries the viewer's relief");
});

check("and carries the relief of the frame being drawn, not the one it was built at", () => {
  const scene = window.GeoIDViewer.scene;
  let relief = 0.3;
  window.GeoIDViewer.getEffectiveRelief = () => relief;
  relief = 0.113; frame(scene);
  near(getRenderRelief(), 0.113, 1e-9, "eased off as the camera lands");
  relief = 0; frame(scene);
  near(getRenderRelief(), 0, 1e-9, "and flat when the slider is");
});

check("a second follower does not install a second step", () => {
  const scene = window.GeoIDViewer.scene;
  const installed = scene.onBeforeRender;
  followRelief({}, 0);
  followRelief({}, 0.006, { lifted: true });
  ok(scene.onBeforeRender === installed, "the same step, chained once");
});

/**
 * The import manager installs its own step -- the geo group's spin, the line
 * clearance, the marker size -- and it is installed on the same scene. The
 * relief step is CHAINED onto whatever is there, so a page with imported
 * layers keeps everything it had.
 */
check("an existing step keeps running, exactly once", () => {
  let ran = 0;
  const scene = { onBeforeRender() { ran += 1; } };
  window.GeoIDViewer.scene = scene;
  window.GeoIDViewer.getEffectiveRelief = () => 0.21;
  followRelief({}, 0);
  frame(scene);
  ok(ran === 1, `the existing step ran ${ran} times, not once`);
  near(getRenderRelief(), 0.21, 1e-9, "and the relief was fed alongside it");
});

check("so the drape is driven without an imported layer in the page", () => {
  const src = readFileSync(new URL("./vector-render.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/export function followRelief\([\s\S]{0,240}?ensureReliefSync\(\);/.test(src),
    "followRelief installs the pump itself");
  const drape = readFileSync(new URL("./basemap-drape.js", import.meta.url), "utf8");
  ok(/followRelief\(new THREE\.MeshBasicMaterial/.test(drape),
    "and the basemap drape is a follower");
});


/**
 * THE DIVIDED-OUT DISPLACEMENT IS ONLY EXACT AT THE RELIEF IT WAS BUILT AT.
 * Built close in (relief 1.5e-5, measured 2 km up) a Float32 position cannot
 * hold the height to better than its rounding, and the rounding is multiplied
 * by the ratio of the reliefs when the camera rises: a weather overlay built
 * there stood up to 2.4 km off the ground from 1,500 km. The exact form
 * carries the height itself and is right at any relief.
 */
check("a drape built close in is wrong from orbit by the divided-out form, and exact by the other", () => {
  const { attachExactReliefAttributes } = { attachExactReliefAttributes: globalThis.__exact };
  const built = 1.5e-5; const later = 0.11;
  const geometry = patchAt(built, 0, HEIGHTS);
  attachReliefAttributes(geometry, 0, built);
  const worstDivided = Math.max(...HEIGHTS.map((h, i) => Math.abs(geometry.attributes.aDisp.getX(i) * later - h * later)));
  ok(worstDivided * METRES > 100, `the divided-out form should be off by more than 100 m, was ${(worstDivided * METRES).toFixed(1)} m`);
  const heights = [0.001, 0.004, 0.0125, 0];
  window.GeoIDViewer.latLonToVector3 = (lat, lon, r) => ({ x: Math.cos(lat) * r, y: Math.sin(lat) * r, z: Math.sin(lon) * r * 0 + 0.1 * r });
  window.GeoIDViewer.elevationNormalized = (lat) => heights[Math.round(lat)];
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  ok(attachExactReliefAttributes(g2, [0, 1, 2, 3], [0, 0, 0, 0], { globeFrame: true }), "the viewer publishes both functions");
  heights.forEach((h, i) => near(g2.attributes.aDisp.getX(i) * later, h * later, 1e-9, `exact vertex ${i}`));
  const d = window.GeoIDViewer.latLonToVector3(0, 0, 1); const len = Math.hypot(d.x, d.y, d.z);
  near(g2.attributes.aDir.getX(0), -d.x / len, 1e-6, "globe frame negates x");
  near(g2.attributes.aDir.getZ(0), -d.z / len, 1e-6, "and z");
  near(g2.attributes.aDir.getY(0), d.y / len, 1e-6, "but not y");
});

check("every drape() overlay — weather maps, Earth Engine, map overlays — takes the exact form", () => {
  const src = readFileSync(new URL("./gee.js", import.meta.url), "utf8");
  ok(/attachExactReliefAttributes\(geometry, lats, lons, \{ globeFrame: true \}\)/.test(src), "drape() carries the height itself");
  ok(/if \(!exact\) attachReliefAttributes\(/.test(src), "and falls back only where the viewer cannot say");
  const weather = readFileSync(new URL("./weather-maps.js", import.meta.url), "utf8");
  ok(/await drape\(/.test(weather), "the weather card drapes through drape()");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`${pass} passed`);
