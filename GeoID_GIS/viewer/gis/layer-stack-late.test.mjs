/**
 * GEOMETRY ADDED AFTER THE STACK WAS STAMPED TAKES THE STAMP TOO.
 *
 * The earthquake time-lapse registers an empty group and builds each frame's
 * points the first time that frame is shown -- after `applyStack` last ran. The
 * frame node kept a THREE.Group's default renderOrder 0, so its points sorted at
 * groupOrder 0 (three takes groupOrder from the nearest Group ancestor) and the
 * streamed Sentinel-2 refine patch -- groupOrder 0, renderOrder 40, no depth
 * test -- painted straight over every plotted earthquake.
 *
 * This runs the real `watchLateChildren` out of layer-hierarchy.js (the module
 * itself wants a page) against real three.js objects.
 *
 * Run: node GeoID_GIS/viewer/gis/layer-stack-late.test.mjs
 */

import { readFileSync } from "node:fs";
import * as THREE from "../vendor/three.module.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function ok(c, what) { if (!c) throw new Error(what); }

const src = readFileSync(new URL("./layer-hierarchy.js", import.meta.url), "utf8");

function extract(name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name} not found`);
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`${name} unterminated`);
}
const watchLateChildren = new Function(`${extract("watchLateChildren")}; return watchLateChildren;`)();

check("applyStack watches every node it stamps", () => {
  const body = extract("applyStack");
  ok(/watchLateChildren\(node, object\)/.test(body), "applyStack installs the watcher");
});

check("a frame added after the stamp takes the layer's order", () => {
  const root = new THREE.Group();
  root.renderOrder = 52;
  watchLateChildren(root, root);
  const frame = new THREE.Group();               // what renderFeatureCollection hands back
  const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
  points.renderOrder = 4;
  frame.add(points);
  root.add(frame);
  ok(frame.renderOrder === 52, `the inner group is ${frame.renderOrder}, so its points' groupOrder would be that`);
  ok(points.renderOrder === 52, `the points are ${points.renderOrder}`);
});

check("and so does anything added later still, deeper down", () => {
  const root = new THREE.Group();
  root.renderOrder = 55;
  watchLateChildren(root, root);
  const frame = new THREE.Group();
  root.add(frame);
  const late = new THREE.Mesh();
  frame.add(late);
  ok(late.renderOrder === 55, `${late.renderOrder}`);
});

check("a node's own lift and a deliberate nested band are honoured", () => {
  const root = new THREE.Group();
  root.renderOrder = 51;
  watchLateChildren(root, root);
  const sharp = new THREE.Mesh();
  sharp.userData.renderLift = 0.5;
  const band = new THREE.Group();
  band.renderOrder = 206;
  band.userData.keepRenderOrder = true;
  root.add(sharp);
  root.add(band);
  ok(sharp.renderOrder === 51.5, `lift kept: ${sharp.renderOrder}`);
  ok(band.renderOrder === 206, `nested band kept: ${band.renderOrder}`);
});

check("the stamp follows the layer when it is dragged", () => {
  const root = new THREE.Group();
  root.renderOrder = 51;
  watchLateChildren(root, root);
  root.renderOrder = 58;                          // applyStack after a drag
  const late = new THREE.Mesh();
  root.add(late);
  ok(late.renderOrder === 58, `${late.renderOrder}`);
});

check("installed once per node", () => {
  const root = new THREE.Group();
  watchLateChildren(root, root);
  watchLateChildren(root, root);
  ok((root._listeners?.childadded || []).length === 1, `${(root._listeners?.childadded || []).length} listeners`);
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
