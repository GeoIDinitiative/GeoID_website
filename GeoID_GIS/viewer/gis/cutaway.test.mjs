/**
 * The cutaway pass, and the four places a material can reach the globe.
 *
 * The behaviour half runs the real functions against fake scene nodes -- a
 * material here is any object with a `clippingPlanes` slot, which is all the
 * pass touches. The structural half pins the WIRING, because every fault this
 * module exists for was a material nobody had remembered to add to a list:
 * the viewer's toggle, a tile built after the pass, a repaint that rebuilds
 * every material, and the nine planet viewers.
 */
import { readFileSync } from "node:fs";
import { applyCutaway, cutawayPlanes, CUTAWAY_EVENT } from "./cutaway.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass += 1;
  else failures.push(`${name}\n     got  ${g}\n     want ${w}`);
};
const ok = (name, cond) => check(name, Boolean(cond), true);

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf-8");
/** Comments quote the very strings these pins look for; prose is not a call. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const mat = () => ({ clippingPlanes: null, needsUpdate: false });
const node = (material, children = [], userData = {}) => ({ material, children, userData });
const PLANE = { normal: "x", constant: 0 };

/* ── the pass ─────────────────────────────────────────────────────────── */

{
  const a = mat(), b = mat();
  const tree = node(null, [node(a), node(null, [node(b)])]);
  check("every material in the subtree is cut", applyCutaway(tree, [PLANE]), 2);
  check("the plane is the viewer's own object", a.clippingPlanes[0] === PLANE, true);
  check("a nested material is reached too", b.clippingPlanes.length, 1);
  ok("the material is marked for recompile", a.needsUpdate);
}

{
  // The count is what decides a recompile, so a second pass with the same
  // planes must touch nothing -- on a 312,500-point cloud that is the
  // difference between a no-op and a stutter on every hierarchy change.
  const a = mat();
  const tree = node(null, [node(a)]);
  applyCutaway(tree, [PLANE]);
  a.needsUpdate = false;
  check("an unchanged material is left alone", applyCutaway(tree, [PLANE]), 0);
  check("and is not marked for recompile", a.needsUpdate, false);
}

{
  const a = mat();
  const tree = node(null, [node(a)]);
  applyCutaway(tree, [PLANE]);
  check("clearing reports the change", applyCutaway(tree, []), 1);
  // `null`, not `[]`: null is what an untouched material carries, so a layer
  // that has met the cutaway and left it is byte-identical to one that never did.
  check("and clears to null rather than an empty array", a.clippingPlanes, null);
}

{
  // A subtree opts out WHOLE. The satellites orbit at up to three Earth radii
  // and are not part of the ground being cut; clipping them at the plane would
  // take half of every orbit off a shell that was never on the surface.
  const inner = mat();
  const kept = mat();
  const tree = node(null, [
    node(null, [node(inner)], { keepUnclipped: true }),
    node(kept),
  ]);
  check("keepUnclipped excludes the whole subtree", applyCutaway(tree, [PLANE]), 1);
  check("the opted-out descendant is untouched", inner.clippingPlanes, null);
  check("its sibling is still cut", kept.clippingPlanes.length, 1);
}

{
  const one = mat(), two = mat();
  check("a multi-material mesh is cut on every slot",
    applyCutaway(node([one, two]), [PLANE]), 2);
}

check("a missing object3D is not an error", applyCutaway(null, [PLANE]), 0);

{
  // Under Node there is no window at all; the module must read through
  // `globalThis` rather than a bare `window`, which would be a ReferenceError.
  check("no viewer means nothing is cut", cutawayPlanes(), []);
  globalThis.window = { GeoIDViewer: { getCutawayPlanes: () => [PLANE] } };
  check("the planes come from the viewer, live", cutawayPlanes().length, 1);
  globalThis.window = { GeoIDViewer: { getCutawayPlanes: () => [] } };
  check("core view off answers empty", cutawayPlanes(), []);
  delete globalThis.window;
}

/* ── the wiring, which is where every one of these faults lived ───────── */

{
  const viewer = code("../earth-viewer.js");
  ok("the viewer publishes what it is cutting by",
    /getCutawayPlanes:\s*\(\)\s*=>/.test(viewer));
  ok("and reads the toggle rather than a remembered flag",
    /getCutawayPlanes:.*coreToggle.*checked.*cutawayClipPlane/.test(viewer));
  ok("and announces the toggle",
    viewer.includes('dispatchEvent(new Event("geoid-gis:cutaway-changed"))'));
  // On `document`: a plain Event does not bubble, so a window-only dispatch is
  // heard by nothing -- this tree has already paid a round for that.
  ok("on document, which is this viewer's own convention",
    /document\.dispatchEvent\(new Event\("geoid-gis:cutaway-changed"\)\)/.test(viewer));
}

check("the module's event name is the one the viewer fires",
  CUTAWAY_EVENT, "geoid-gis:cutaway-changed");

{
  const mod = code("./cutaway.js");
  ok("the pass watches the layer list, so a NEW layer arrives cut",
    /onChange\(applyAll\)/.test(mod));
  ok("and listens on both document and window",
    /\[globalThis\.document, globalThis\.window\]/.test(mod));
  /**
   * GUARD ON THE LISTENER, NOT ON `window`. Three suites here stub
   * `window = globalThis`, which has no `addEventListener`, so a
   * `typeof window !== "undefined"` guard passes and the call throws at
   * IMPORT -- taking down every suite that imports anything importing this.
   * Measured: drape-registration, feature-popup and tool-runner all went to
   * 0 passed on one line. Pinned so it cannot come back.
   */
  ok("and never guards on the existence of window alone",
    !/typeof window !== .undefined./.test(mod));
  ok("guarding instead on the capability it uses",
    /typeof target\?\.addEventListener === .function./.test(mod));
}

{
  const tiles = code("./vector-tiles.js");
  // A tile is a new child of a layer that has not CHANGED, so between passes
  // it is the one thing on the globe still drawing across the removed half.
  ok("a tile built after the pass is cut as it is added",
    /applyCutaway\(tile\.node\)/.test(tiles));
  ok("beside the renderOrder it already copies",
    tiles.indexOf("applyCutaway(tile.node)") > tiles.indexOf("child.renderOrder = group.renderOrder"));
}

{
  const render = code("./vector-render.js");
  ok("a repaint re-applies the cutaway", /applyCutaway\(object3D\)/.test(render));
  ok("in repaintVector, beside the opacity it already puts back",
    /paintOpacity\(object3D, liveOpacity\);\s*applyCutaway\(object3D\);/.test(render));
}

{
  ok("Earth loads the module", read("../index.html").includes("gis/cutaway.js"));
  ok("and so do the nine planets", code("./boot.js").includes('"./cutaway.js"'));
}

{
  // All ten worlds have a core toggle, so all ten need both halves.
  const worlds = ["mars", "mercury", "moon", "venus", "pluto",
    "jupiter", "saturn", "uranus", "neptune"];
  const missing = worlds.filter((w) => {
    const src = read(`../../../planet_explorer/${w}/viewer/${w}-viewer.js`);
    return !src.includes("getCutawayPlanes:")
      || !src.includes('document.dispatchEvent(new Event("geoid-gis:cutaway-changed"))');
  });
  check("every planet viewer carries the seam and the announcement", missing, []);
  const porter = read("../../services/port-viewer-seam.py");
  ok("and they are generated rather than hand-edited",
    porter.includes("getCutawayPlanes") && porter.includes("apply_cutaway"));
}

/**
 * The verdict is an EXIT HOOK, so a check appended anywhere by anyone still
 * counts. This tree has lost checks twice to a summary that stopped being the
 * last statement, both times found by an A/B rather than by reading.
 */
process.on("exit", () => {
  if (failures.length) {
    console.log(`\n  ${failures.length} FAILED:`);
    failures.forEach((f) => console.log(`   ✗ ${f}`));
  }
  console.log(`\n  ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
