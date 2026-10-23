/**
 * A sentence read into a model to build and mesh, with its numbers honoured.
 *
 *   node GeoID_GIS/viewer/gis/atlas-mesh-spec.test.mjs
 */

import { readMeshRequest, isMeshRequest, readMesher } from "./atlas-mesh-spec.js";
import { shapesToSolids } from "./studio-blender.js";

let pass = 0; let fail = 0;
function ok(cond, msg, detail = "") {
  if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

const v = readMeshRequest("build a stratovolcano 3 km high with a magma chamber at 5 km depth");
ok(v?.template === "volcano", "a volcano with a chamber is read");
ok(v.params.height === 3000 && v.params.chamber_depth === 5000, "3 km high and 5 km depth are honoured, in metres", JSON.stringify(v.params));
ok(v.said.includes("height") && v.said.includes("chamber depth"), "and said to be from the words");
ok(v.shapes[0].height === 3000 && v.shapes[1].z === -5000 && v.shapes[1].op === "difference", "the edifice is 3 km and the chamber is cut at -5 km");
ok(v.params.crust_depth > v.params.chamber_depth + v.params.chamber_radius, "the crust reaches below the chamber");
ok(v.sizeM === Math.round(Math.max(v.params.crust_width, v.params.crust_depth + 3000) / 12) && v.curvature === 12, "a coarse size with curvature refinement");
ok(shapesToSolids(v.shapes).ok, "the shapes pass the studio's own checks");
ok(v.mesher === null, "no mesher named is the model's own");

const l = readMeshRequest("build a layered crust block with a dipping dike");
ok(l?.template === "layered_dike", "a layered crust with a dike is read");
ok(l.params.dip === 60 && l.said.length === 0, "“dipping” alone is 60°, and nothing claims to be from the words");
ok(shapesToSolids(l.shapes).ok, "its shapes pass too");

const l2 = readMeshRequest("build a crust 20 km wide with three layers 2 km thick and a 300 m thick dyke dipping 45 degrees");
ok(l2.params.width === 20000 && l2.params.thicknesses.join() === "2000,2000,2000", "width and layers from the words", JSON.stringify(l2.params));
ok(l2.params.dip === 45 && l2.params.dike_thickness === 300, "dip and dike thickness from the words");
const l3 = readMeshRequest("make a layered halfspace with layers 1, 2 and 4 km thick and a dike");
ok(l3.params.thicknesses.join() === "1000,2000,4000", "a listed set of thicknesses", JSON.stringify(l3.params.thicknesses));

const v2 = readMeshRequest("Atlas, make a volcano 1500 m tall with a 2 km wide chamber 4 km deep and mesh it in Blender");
ok(v2.params.height === 1500 && v2.params.chamber_depth === 4000 && v2.params.chamber_radius === 1000, "metres, depth and a chamber's width", JSON.stringify(v2.params));
ok(v2.mesher === "blender", "Blender named is Blender");
ok(readMeshRequest("build a volcano 2 km high with 500 m elements").sizeM === 500, "an element size from the words");

ok(!isMeshRequest("simulate inflation of the magma chamber under Campi Flegrei"), "a deformation study is not a build");
ok(!isMeshRequest("what is a dike"), "a question is not a build");
ok(isMeshRequest("mesh it in blender") && readMeshRequest("mesh it in blender") === null, "“mesh it” is a mesh request with no model in it");
ok(readMesher("with gmsh please") === "gmsh" && readMesher("a volcano") === null, "the mesher is read only when named");
