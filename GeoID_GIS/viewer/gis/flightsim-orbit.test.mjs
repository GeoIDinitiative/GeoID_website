// The chase camera orbits the craft when the view is dragged
// (scripts/flightsim.js: state.orbit, orbitQuat, wireOrbitCamera). The maths
// is run for real against three; the wiring is pinned on the source, because
// a drag that swallowed clicks, or an orbit fed into the damping, would not
// fail loudly.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "../../../everest/vendor/three.module.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const sim = readFileSync(join(ROOT, "scripts", "flightsim.js"), "utf-8");
let pass = 0; const failures = [];
const ok = (cond, name) => { if (cond) pass += 1; else failures.push(name); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// The helper exactly as shipped, lifted out of the sim.
const src = sim.match(/let _orbitAxis = null[\s\S]*?function orbitQuat\([\s\S]*?\n  \}/);
ok(Boolean(src), "orbitQuat is defined in flightsim.js");

// THREE IS NULL WHILE THE SCRIPT LOADS (`let THREE = null`, bound in
// adoptHooks). A three object built in the sim's top scope throws at boot and
// takes the whole flight sim with it -- which is how the first cut of this
// broke "Enter" in GeoHUB. Nothing at that indent may construct one.
const bootThree = sim.split("\n").filter((l) => /^  (const|let|var) [^=]+= new THREE\./.test(l));
ok(bootThree.length === 0, `no three object is built at load (${bootThree.join(" | ")})`);
const orbitQuat = src ? new Function("THREE", `${src[0]}; return orbitQuat;`)(THREE) : null;

if (orbitQuat) {
  // A craft flying along -Z with +Y up; the camera starts behind (+Z) and above.
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3(0, 0, -1);
  const behind = new THREE.Vector3(0, 0.9, 2.6);
  const at = (yaw, pitch) => behind.clone().applyQuaternion(orbitQuat(up, fwd, yaw, pitch));

  const id = at(0, 0);
  ok(near(id.x, 0) && near(id.y, 0.9) && near(id.z, 2.6), "no drag leaves the chase view exactly where it was");

  const front = at(Math.PI, 0);
  ok(near(front.z, -2.6) && near(front.y, 0.9), "half a turn puts the camera in front of the craft, same height");

  const side = at(Math.PI / 2, 0);
  ok(near(Math.hypot(side.x, side.z), 2.6) && near(side.y, 0.9), "a quarter turn swings it to the side, same distance");

  const full = at(2 * Math.PI, 0);
  ok(near(full.x, 0) && near(full.z, 2.6), "a full turn comes all the way round");

  const len = behind.length();
  for (const [y, p] of [[0.7, 0.4], [2.5, -0.9], [-4, 1]]) {
    ok(near(at(y, p).length(), len), `the orbit keeps the camera's distance (yaw ${y}, pitch ${p})`);
  }
  ok(at(0, 0.5).y > id.y, "positive pitch lifts the camera over the craft");
  ok(at(0, -0.5).y < id.y, "negative pitch drops it under");
}

// Wiring.
ok(/orbit: \{ yaw: 0, pitch: 0, dist: 1, tYaw: 0, tPitch: 0, tDist: 1 \}/.test(sim), "state carries the orbit");
ok(/recentreOrbit\(true\);\s*\/\/ every flight starts from behind the craft/.test(sim), "each flight starts recentred");
const damp = sim.indexOf("else s._camOff.lerp(desiredOff");
const orbitUse = sim.indexOf("const q = orbitQuat(shipUp, fwd, o.yaw, o.pitch);");
ok(damp > 0 && orbitUse > damp, "the orbit turns the damped offset, after the damping, not inside it");
ok(/if \(Math\.hypot\(dx, dy\) < DRAG_PX\) return;/.test(sim), "a press is not a drag until it moves");
ok(/if \(!swallowClick\) return;[\s\S]{0,80}e\.stopImmediatePropagation\(\);/.test(sim),
  "only the click that ends a real drag is swallowed");
ok(/window\.addEventListener\("wheel", \(e\) => \{\s*if \(!live\(\) \|\| e\.target !== view\(\)\) return;/.test(sim)
  && /\{ capture: true, passive: false \}/.test(sim),
  "the wheel is taken in capture, in flight only, so the globe's zoom never fights the sim");
ok(/const live = \(\) => fs\.active && !fs\.paused && state\.cam === "chase";/.test(sim),
  "orbiting is chase-view only, and only while flying");
ok(/P\.on\("r3", /.test(sim) && !/control: "r3", text: "Free look: this sim has no free-look camera", unused: true/.test(sim),
  "R3 recentres, and the controller map no longer says there is no free look");
ok(/pressed\(e, "KeyV"\) && state\.cam === "chase"/.test(sim), "V recentres");

process.on("exit", () => {
  if (failures.length) { console.log(`\n${failures.length} failed, ${pass} passed`); failures.forEach((f) => console.log(`   ${f}`)); process.exitCode = 1; }
  else console.log(`✓  flightsim-orbit.test.mjs  —  ${pass} passed`);
});
