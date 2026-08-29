/**
 * A drape is painted ON the ground, and stays on it as the ground moves.
 *
 * Reported as "the mapping of the rasters looks like it's not tight to the
 * surface", and it measured out as two constants nobody had converted into
 * metres:
 *
 *   - the relief watcher's threshold was 0.0004 in RAW RELIEF UNITS, which is
 *     796 m of ground movement at a peak, so a drape was allowed to drift most
 *     of a kilometre from the terrain it paints. Measured live on four raster
 *     layers sitting still at 95 km: every one 142 m BELOW the surface.
 *   - the per-layer stack lift was 30 m, so the twelfth map sat 329 m up.
 *
 * Both are pinned here in the only terms that mean anything — METRES between a
 * drape's vertices and the ground under them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { latLonToVector3 } from "./geo-utils.js";

const ADAPTER_SOURCE = readFileSync(
  fileURLToPath(new URL("./geotiff-adapter.js", import.meta.url)), "utf8");

globalThis.window = globalThis;

const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, drawImage() {}, fillRect() {}, clearRect() {},
  save() {}, restore() {}, scale() {}, translate() {},
};
globalThis.document = {
  createElement: (tag) => (tag === "canvas"
    ? { width: 1, height: 1, getContext: () => ctx, style: {} }
    : { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }),
  head: { appendChild() {} }, body: { appendChild() {} },
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {},
};

const R_SCENE = 3.2;
const R_KM = 6371;
const toMetres = (sceneUnits) => (sceneUnits / R_SCENE) * R_KM * 1000;

/** A world whose terrain is a known function, so "the ground" is checkable. */
let relief = 0.11;
const normalised = (lat, lon) => 0.5 + 0.25 * Math.sin(lat * 3) + 0.25 * Math.cos(lon * 5);
window.GeoIDViewer = {
  getEffectiveRelief: () => relief,
  surfacePoint: (lat, lon, lift = 0) =>
    latLonToVector3(lat, lon, R_SCENE + relief * normalised(lat, lon) + lift),
};

const { buildRasterLayer } = await import("./geotiff-adapter.js");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function ok(cond, what) { if (!cond) throw new Error(what); }

const BOUNDS = { minX: 7.8, minY: 45.95, maxX: 7.9, maxY: 46.05 };
const W = 24;
const band = new Float32Array(W * W).map((_, k) => 1000 + (k % W) * 20);

function drape(name) {
  const result = buildRasterLayer([band], W, W, BOUNDS, { name, noData: null, isDem: false });
  let mesh = null;
  result.object3D.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position && !mesh) mesh = o; });
  return mesh;
}

/** Every vertex against the ground directly under it, in metres. */
function offsets(mesh) {
  const pos = mesh.geometry.attributes.position;
  const out = [];
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const r = Math.hypot(x, y, z);
    const lat = (Math.asin(y / r) * 180) / Math.PI;
    const lon = (Math.atan2(z, -x) * 180) / Math.PI;
    const g = window.GeoIDViewer.surfacePoint(lat, lon, 0);
    out.push(toMetres(r - Math.hypot(g.x, g.y, g.z)));
  }
  return out;
}
const worst = (list) => list.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);

check("a drape's vertices sit ON the ground, not above it", () => {
  const off = offsets(drape("first"));
  ok(Math.abs(worst(off)) < 0.5, `worst vertex is ${worst(off).toFixed(1)} m off the ground`);
});

check("the TWELFTH drape is on the ground too — the stack lift is gone", () => {
  // 30 m a layer put the twelfth map 329 m up. The draw order stacks them:
  // `depthTest: false` means the depth buffer is never consulted, so the
  // higher renderOrder wins outright and no height is needed to separate them.
  let mesh = null;
  for (let k = 0; k < 12; k += 1) mesh = drape(`stack_${k}`);
  const off = offsets(mesh);
  ok(Math.abs(worst(off)) < 0.5, `the twelfth drape is ${worst(off).toFixed(1)} m off the ground`);
});

check("a drape records the relief it was built at", () => {
  const mesh = drape("stamped");
  ok(typeof mesh.userData.builtRelief === "number", "no builtRelief recorded");
  ok(Math.abs(mesh.userData.builtRelief - relief) < 1e-12, "builtRelief is not the live relief");
});

check("when the ground moves, the drape moves back onto it", () => {
  const mesh = drape("moving");
  ok(Math.abs(worst(offsets(mesh))) < 0.5, "not on the ground to begin with");
  relief = 0.026;                                   // descending tapers the terrain away
  const drifted = worst(offsets(mesh));
  ok(Math.abs(drifted) > 100, `the fixture must actually move the ground (moved ${drifted.toFixed(1)} m)`);
  mesh.userData.rebuildDrape();
  const after = worst(offsets(mesh));
  ok(Math.abs(after) < 0.5, `still ${after.toFixed(1)} m off the ground after a rebuild`);
  ok(Math.abs(mesh.userData.builtRelief - relief) < 1e-12, "builtRelief was not updated by the rebuild");
  relief = 0.11;
});

check("the rebuild threshold is TEN METRES of ground, not eight hundred", () => {
  // The number that was wrong. 0.0004 relief units reads as a small tolerance
  // and is 796 m of ground; the threshold has to be stated in metres or the
  // next person converts it wrong too.
  const source = ADAPTER_SOURCE;
  const metres = /const REBUILD_METRES = (\d+)/.exec(source)?.[1];
  ok(metres, "REBUILD_METRES is not declared — the threshold is back in relief units");
  ok(Number(metres) <= 20, `the drape may drift ${metres} m before being re-laid`);
  ok(/RELIEF_PER_METRE/.test(source), "the metre-to-relief conversion is not stated");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
