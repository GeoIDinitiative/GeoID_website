/**
 * The studio's Blender mesher, the pure half: the bpy script it emits, the
 * shape lists an AI may hand it, and the sentence that says what to install.
 *
 *   node GeoID_GIS/viewer/gis/studio-blender.test.mjs
 */

import { studioBlenderScript, shapesToSolids, normMesher, blenderUnavailable, MESHERS, BLENDER_KINDS, MAX_SHAPES } from "./studio-blender.js";
import { PRIMITIVES } from "./mesh-primitives.js";

let pass = 0; let fail = 0;
function ok(cond, msg, detail = "") {
  if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

// The two names a GeoID Network model post carries (social-worker/posts.js).
ok(MESHERS.join() === "gmsh,blender", "the meshers are gmsh and blender, gmsh first");
ok(normMesher("Blender") === "blender" && normMesher("") === "gmsh" && normMesher("netgen") === "gmsh", "an unknown mesher is gmsh");
ok(BLENDER_KINDS.every((k) => PRIMITIVES[k]), "every Blender kind is a studio primitive");

// A box with a spherical chamber cut from it -- the volcano case in miniature.
const model = {
  name: "chamber test",
  solids: [
    { kind: "box", op: "union", params: { x: -5, y: -5, z: -10, dx: 10, dy: 10, dz: 10 } },
    { kind: "sphere", op: "difference", params: { x: 0, y: 0, z: -5, r: 2 } },
    { kind: "cone", op: "union", enabled: false, params: { x: 0, y: 0, z: 0, h: 1, r1: 1, r2: 0 } },
    { kind: "atmosphere", op: "union", params: {} },
  ],
};
const { script, notes } = studioBlenderScript(model);
ok(/^import bpy, bmesh, json, math, sys$/m.test(script), "the script imports bpy and bmesh");
ok(script.includes("objs[0] = [box((-5.000000, -5.000000, -10.000000), (10.000000, 10.000000, 10.000000))]"), "the box is built from its corner and size");
ok(script.includes("objs[1] = [ellipsoid((0.000000, 0.000000, -5.000000), (2.000000, 2.000000, 2.000000))]"), "a sphere is an ellipsoid of equal radii");
ok(!script.includes("cone((0.000000"), "a disabled solid is left out");
ok(!/atmosphere/.test(script.split("# THE PRIMITIVES")[1]), "the atmosphere is not Blender's to build");
ok(script.includes('OPS = ["union","difference"]'), "the booleans keep the studio's order");
ok(/mod\.solver = 'EXACT'/.test(script), "booleans use Blender's exact solver");
ok(script.includes('NAME = "chamber_test"'), "the model's name is reduced to a safe file name");
ok(/globals\(\)\.get\('GEOID_OUT'\)/.test(script) && /sys\.argv\.index\('--'\)/.test(script), "the output path comes from GEOID_OUT (MCP) or after -- (headless)");
ok(!/SystemExit/.test(script.replace(/# RuntimeError, not SystemExit.*$/m, "")), "nothing in it can close a live Blender");
ok(/new_from_object/.test(script) && !/bpy\.ops\./.test(script), "no operator needs a UI context");
ok(notes.some((n) => /own volume/.test(n)), "a kept cut is said to be its own volume");
ok(!/REMESH/.test(script), "no remesh unless asked");
ok(/rm\.voxel_size = 0\.500000/.test(studioBlenderScript({ ...model, remeshM: 0.5 }).script), "a remesh size becomes the voxel size");

const voided = studioBlenderScript({ solids: [model.solids[0], { ...model.solids[1], flags: { void: true } }] });
ok(!voided.notes.some((n) => /own volume/.test(n)), "a void cut is not called a volume");
const layered = studioBlenderScript({ solids: [{ kind: "layered_halfspace", op: "union", params: { width: 10, depth: 8, thicknesses: "1,2,3" } }] });
ok(layered.script.includes("box((-5.000000, -4.000000, -6.000000), (10.000000, 8.000000, 6.000000))"), "a layered halfspace is one block of the total thickness");
ok(layered.notes.some((n) => /need gmsh/.test(n)), "and the note says its layers need gmsh");
const dike = studioBlenderScript({ solids: [{ kind: "dike", op: "union", params: { x: 1, y: 2, length: 4, height: 3, thickness: 0.2, top_depth: 1, strike: 90, dip: 60 } }] });
ok(dike.script.includes("rot_y=0.523599, rot_z=-1.570796, move=(1.000000, 2.000000, -2.500000)"), "a dike tilts by 90 - dip, turns by -strike, sits below its top depth");

// Shapes from an AI: numbers only, against the primitives' own specs.
const good = shapesToSolids([
  { kind: "box", x: -50, y: -50, z: -40, dx: 100, dy: 100, dz: 40 },
  { kind: "sphere", op: "difference", x: 0, y: 0, z: -20, r: "8" },
  { kind: "cylinder", op: "union", r: 3 },
]);
ok(good.ok && good.solids.length === 3, "a good shape list reads", good.problems.join("; "));
ok(good.solids[1].params.r === 8, "a numeric string is a number");
ok(good.solids[2].params.h === 1 && good.solids[2].params.x === 0, "missing parameters take the primitive's defaults");
ok(good.solids[0].op === "union", "the first shape is the object");
ok(!shapesToSolids([{ kind: "teapot" }]).ok, "an unknown kind is refused");
ok(/op must be/.test(shapesToSolids([{ kind: "box" }, { kind: "box", op: "explode" }]).problems.join()), "an unknown op is refused");
ok(/must be a number/.test(shapesToSolids([{ kind: "box", dx: "__import__('os')" }]).problems.join()), "text where a number belongs is refused");
ok(/greater than 0/.test(shapesToSolids([{ kind: "sphere", r: -1 }]).problems.join()), "a negative radius is refused");
ok(!shapesToSolids([]).ok && !shapesToSolids("box").ok, "no shapes is not a model");
ok(/at most/.test(shapesToSolids(Array(MAX_SHAPES + 1).fill({ kind: "box" })).problems.join()), "too many shapes is refused");
ok(shapesToSolids([{ kind: "box" }, { kind: "sphere", op: "difference", void: true }]).solids[1].flags.void === true, "void is carried to the cut");
const injected = studioBlenderScript({ name: "x'); import os; os.system('rm -rf ~') #", solids: shapesToSolids([{ kind: "box" }]).solids });
ok(!injected.script.includes("import os") && /^NAME = "[A-Za-z0-9_.-]+"$/m.test(injected.script), "a name cannot carry code into the script");

// What to install, said rather than failed.
ok(/not connected/.test(blenderUnavailable(null)), "no sidecar is said");
ok(/not installed/.test(blenderUnavailable({ blender: { binary: false, mcp: false, gmsh: true } })), "no Blender is said");
ok(/blender-mcp/.test(blenderUnavailable({ blender: { binary: false, mcp: false } })), "the MCP addon is offered as the other way");
ok(/pip install gmsh/.test(blenderUnavailable({ blender: { binary: true, mcp: false, gmsh: false } })), "no gmsh module is said");
ok(blenderUnavailable({ blender: { binary: false, mcp: true, gmsh: true } }) === null, "a live Blender over MCP is enough");
