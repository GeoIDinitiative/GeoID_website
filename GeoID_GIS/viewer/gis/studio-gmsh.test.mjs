import { faceParts, partPositions, studioGmshScript, DEFAULT_FACE_FLAGS } from "./studio-gmsh.js";
import { buildSurface } from "./mesh-primitives.js";

let passes = 0; let failures = 0;
const check = (name, ok, detail = "") => { if (ok) passes += 1; else failures += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

const box = faceParts(buildSurface("box", { x: 0, y: 0, z: 0, dx: 2, dy: 3, dz: 4 }).positions);
check("a box is six faces named by the axis they face", box.length === 6 && ["top", "base", "north", "south", "east", "west"].every((k) => box.some((p) => p.face === k)), box.map((p) => p.face).join(","));
const top = box.find((p) => p.face === "top");
check("a face carries its centroid, normal, flag and its triangles", top && Math.abs(top.centroid[2] - 4) < 1e-9 && Math.abs(top.centroid[0] - 1) < 1e-9 && top.normal[2] > 0.99 && top.flag === DEFAULT_FACE_FLAGS.top && top.triangles.length === 2 && partPositions(buildSurface("box", { x: 0, y: 0, z: 0, dx: 2, dy: 3, dz: 4 }).positions, top).length === 18);
const cyl = faceParts(buildSurface("cylinder", { x: 0, y: 0, z: 0, h: 2, r: 1 }).positions);
check("a cylinder is a top, a base and one curved side", cyl.length === 3 && cyl.some((p) => p.face === "top") && cyl.some((p) => p.face === "base") && cyl.some((p) => p.face === "side" && p.curved), cyl.map((p) => p.face).join(","));
const sph = faceParts(buildSurface("sphere", { x: 0, y: 0, z: 0, r: 1 }).positions);
check("a sphere is one surface", sph.length === 1 && sph[0].face === "surface" && sph[0].curved);
const volc = faceParts(buildSurface("volcano_edifice", {}).positions);
check("a volcano edifice is the crust's six faces and the cone's side", volc.length === 7 && volc.filter((p) => p.curved).length === 1, volc.map((p) => p.face).join(","));

const solids = [
  { kind: "volcano_edifice", op: "union", params: { crust_width: 20, crust_depth: 10, height: 3, base_radius: 5, summit_radius: 0.5 }, flags: { volume: 10, faces: {} }, parts: volc.map((p) => ({ face: p.face, flag: p.face === "base" ? 2 : p.face === "top" ? 1 : 5, centroid: p.centroid, normal: p.normal })) },
  { kind: "ellipsoid", op: "difference", params: { x: 0, y: 0, z: -3, rx: 2, ry: 2, rz: 1.2 }, flags: { volume: 12, faces: {} }, parts: [{ face: "surface", flag: 30, centroid: [0, 0, -3], normal: null }] },
  { kind: "dike", op: "union", params: { x: 3, y: 0, length: 4, height: 3, thickness: 0.2, top_depth: 1, strike: 30, dip: 80 }, flags: { volume: 13, faces: {} }, parts: [] },
  { kind: "layered_halfspace", op: "union", params: { width: 12, depth: 12, thicknesses: "2,3,5" }, flags: { volume: 20, layers: [21, 22, 23] }, parts: [] },
];
const script = studioGmshScript({
  name: "t", solids, atmosphere: { on: true, heightM: 4, baseZ: 0, minX: -10, maxX: 10, minY: -10, maxY: 10, flags: { sky: 4, sides: 6 } },
  points: [{ name: "probe", x: 1, y: 1, z: -2, flag: 21, sizeM: 0.2 }],
  sizeFields: [{ type: "point", on: true, name: "at probe", x: 1, y: 1, z: -2, sizeM: 0.1, distMinM: 0.5, distMaxM: 3 }],
  meshOptions: { sizeMaxM: 2, combine: "min" },
});
const has = (re) => (re instanceof RegExp ? re.test(script) : script.includes(re));
check("every primitive is OCC: box+cone fused, an ellipsoid as a dilated sphere, a rotated dike, one box per layer", has("occ.addCone(0.0, 0.0, 0.0, 0.0, 0.0, 3.000000, 5.000000, 0.500000)") && has("occ.dilate([(3, tags[1][0])], 0.0, 0.0, 0.0, 2.000000, 2.000000, 1.200000)") && has("occ.rotate([(3, _d)], 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.174533)") && (script.match(/occ\.addBox\(-6\.000000, -6\.000000/g) || []).length === 3);
check("the booleans follow the studio's order and a cut tool is kept as a volume", has('ops = ["union","difference","union","union"]') && has("occ.cut(model, ents, removeObject=True, removeTool=void_tools[i])") && has("keep += ents"));
check("the atmosphere is a box over the ground cut by the model, then everything fragments", has("air = [(3, occ.addBox(-10.000000, -10.000000, 0.000000, 20.000000, 20.000000, 4.000000))]") && has("air, _ = occ.cut(air, model + keep, removeObject=True, removeTool=False)") && has("frag, _ = occ.fragment(everything[:1], everything[1:])"));
check("volumes are flagged by the entity that holds their centre, layers by depth", has('entity_volume_flags = [10,12,13,20]') && has("layer_flags = [None,None,None,[21,22,23]]") && has("void_tools = [False,False,False,False]") && has("def classify_volume(tag):"));
check("faces are matched by centroid and normal to the flags the page chose; the air's sky and sides by the box", has("face_table = [[0,") && has('[1,"surface",30,[0,0,-3],None]') && has("def face_flag(surf):") && has("return ('sky', air_flags['sky'])") && has("air_flags = {\"sky\":4,\"sides\":6}"));
check("edges and corners inherit the lowest face flag, and every group is added", has("Edges and corners inherit the LOWEST flag") && has("gmsh.model.addPhysicalGroup(dim, sorted(set(tags_)), flag, name=names.get((dim, flag), ''))"));
check("the embedded point lands in its volume with its flag and size", has('embedded = [[1,1,-2,0.2,"probe",21]]') && has("gmsh.model.mesh.embed(0, [tag], 3, v)"));
check("the size fields and options come through the shared emitter", has("# at probe:") && has('"Threshold", 2') && has("setAsBackgroundMesh") && has('MeshSizeMax", 2.0000') && has("gmsh.model.mesh.generate(3)"));
check("no atmosphere means no air box", !studioGmshScript({ solids: solids.slice(0, 1) }).includes("THE ATMOSPHERE") && studioGmshScript({ solids: solids.slice(0, 1) }).includes("air = []"));


/* ── Structural pins on the studio ── */
{
  const { readFileSync } = await import("node:fs");
  const studio = readFileSync(new URL("./model-studio.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  check("every primitive is attached as faces with flags, in a group", /function attachParts\(entry, positions, colour/.test(studio) && /const faces = faceParts\(positions\);/.test(studio) && /entry\.flags\.volume = state\.nextVolumeFlag; state\.nextVolumeFlag \+= 1;/.test(studio) && /attachParts\(entry, positions, op === "difference" \? 0xff7a6b : 0x9fd8ff\);/.test(studio));
  check("the Domains panel, the picker and the cards see every part on the page", /function allParts\(\)/.test(studio) && /const parts = allParts\(\);\n  if \(!parts\.length\) return null;/.test(studio) && /domains\.push\(\[`solid:\$\{e\.id\}`, label, e\.flags\?\.volume, e\]\);/.test(studio) && /if \(solid\) \{\n    solid\.flags\.volume = n;/.test(studio));
  check("the studio has its own atmosphere and embedded points, as cards", /function applyStudioAtmosphere\(\)/.test(studio) && /kind: "atmosphere", op: "union", enabled: true,/.test(studio) && /&& !modelInside\(q\)/.test(studio) && /function renderStudioPoints\(\)/.test(studio) && /if \(state\.placingPoint\) \{/.test(studio) && /id = "studio-air-card"/.test(studio) && /id = "studio-points-card"/.test(studio));
  check("the fields pane speaks the builder's vocabulary", /const FIELD_KEYS = \{/.test(studio) && /function studioDefaultField\(type\)/.test(studio) && /radiusM: Math\.max\(b\.maxX - b\.minX/.test(studio) && /active\.radiusM \?\? active\.radius/.test(studio));
  check("the script is the shared emitter, and the package is the builder's file set", /return studioGmshScript\(\{ \.\.\.studioModel\(\), meshFile: "geoid_studio\.msh" \}\);/.test(studio) && /async function exportPackage\(\)/.test(studio) && /if \(pipeline\?\.build\) \{ log\("A GIS terrain: the Model Builder writes its package\."\);/.test(studio) && /"export-package": \(\) => \{ void exportPackage\(\); \},/.test(studio) && /data-act="export-package"/.test(page));
  check("a saved project carries flags, air, points and fields", /solids: state\.solids\.filter\(\(s\) => s\.kind !== "atmosphere"\)\.map\(\(s\) => \(\{ kind: s\.kind, op: s\.op, params: s\.params, flags: s\.flags \}\)\)/.test(studio) && /state\.points = \(data\.points \|\| \[\]\)\.map/.test(studio));
}

process.on("exit", () => { console.log(`studio-gmsh: ${passes} passed, ${failures} failed`); if (failures) process.exitCode = 1; });
