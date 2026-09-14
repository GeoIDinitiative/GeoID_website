/**
 * The GALES results reader against meshes whose answers are exact.
 *
 * The fixtures are written in the solver's own formats by hand: the text mesh
 * as custom_gales_mesh_reader.hpp reads it (2D nodes carry no z), gmsh 2.2 and
 * 4.1 with the node gid = tag − 1 rule gmsh_to_gales.py applies, and result
 * files as io.hpp writes them — float64, a node's dofs together.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ByteCursor, sniffMesh, parseGalesMesh, parseMsh, parseMesh, exposedTetFaces,
  timeOf, groupResultFiles, describeField, dofsPerNode, float64View, componentOf,
  magnitudeOf, nodeByteRange, rangeOf, usedNodes, colormapTable, colourValues,
  niceTicks, formatValue, sliceTets, interpolateOnSlice, axisPlane, nearestNode,
  probeCsv, planSimulation, COLORMAPS,
} from "./gales-results.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

// ── The tokenizer ───────────────────────────────────────────────────────────
{
  const c = new ByteCursor(new TextEncoder().encode(" -1.5e-3  3.299190151242673E+03\n1e-320 42 5.0 -7 nan inf word"));
  check("floats: exponent and sign", c.float() === -1.5e-3);
  check("floats: a C++ stream's capital E", c.float() === 3299.190151242673);
  check("floats: a subnormal does not underflow to zero", c.float() === 1e-320);
  check("ints: a plain integer", c.int() === 42);
  check("ints: a float where an int is expected is truncated, not misread", c.int() === 5);
  check("ints: negative", c.int() === -7);
  check("floats: nan", Number.isNaN(c.float()));
  check("floats: inf", c.float() === Infinity);
  check("words", c.word() === "word");
  check("end of input reads as empty / NaN", c.word() === "" && Number.isNaN(c.int()));
  const values = ["-166.1799926757812", "100000.0", "52085.80579602415", "0.1", "123456789.123456789", "-0.0000123"];
  const cur = new ByteCursor(new TextEncoder().encode(values.join(" ")));
  check("floats agree with parseFloat on survey-sized coordinates", values.every((v) => near(cur.float(), parseFloat(v), 1e-15)));
}

// ── Two tets sharing a face, in the GALES text format ───────────────────────
//
// Nodes 0..4: a unit tet (0,1,2,3) and a second tet on its x=0? no — on the
// face (1,2,3), apex (1,1,1). Six exposed faces; the shared one is hidden.
const TWO_TETS = `MESH! 3D
nodes 5
elements 2
sides 6
X 0 1
Y 0 1
Z 0 1
Node 0 0 0 0 1
Node 1 1 0 0 1
Node 2 0 1 0 1
Node 3 0 0 1 1
Node 4 1 1 1 2
Element 0 0 4 0 1 2 3 0
Element 1 1 4 1 2 3 4 0
Side 0 0 3 0 2 1 7
Side 1 0 3 0 1 3 7
Side 2 0 3 0 3 2 7
Side 3 1 3 1 2 4 8
Side 4 1 3 1 4 3 8
Side 5 1 3 2 3 4 8
`;
const faceKey = (tris) => {
  const out = [];
  for (let k = 0; k < tris.length; k += 3) out.push([tris[k], tris[k + 1], tris[k + 2]].sort((a, b) => a - b).join("-"));
  return out.sort().join(" ");
};
{
  const m = parseGalesMesh(TWO_TETS);
  check("gales: dimension, counts", m.dim === 3 && m.nodeCount === 5 && m.cellCount === 2 && m.sideCount === 6);
  check("gales: coordinates by gid", m.coords[4 * 3] === 1 && m.coords[4 * 3 + 1] === 1 && m.coords[4 * 3 + 2] === 1 && m.coords[3 * 3 + 2] === 1);
  check("gales: node flags", m.nodeFlag[4] === 2 && m.nodeFlag[0] === 1);
  check("gales: connectivity and offsets", [...m.cells].join() === "0,1,2,3,1,2,3,4" && [...m.cellOffsets].join() === "0,4,8");
  check("gales: the surface is the file's sides, with their flags", m.surfaceFrom === "sides" && m.surface.length === 18 && [...m.surfaceFlag].join() === "7,7,7,8,8,8");
  check("gales: bounds", m.bounds.min.join() === "0,0,0" && m.bounds.max.join() === "1,1,1");
  const derived = exposedTetFaces(m);
  check("derived boundary: every tet face seen once, the shared face hidden", derived.length === 18 && faceKey(derived) === faceKey(m.surface));
  const noSides = parseGalesMesh(TWO_TETS.replace(/^Side.*\n/gm, "").replace("sides 6", "sides 0"));
  check("a mesh without sides has its boundary derived, and says so", noSides.surfaceFrom === "derived" && faceKey(noSides.surface) === faceKey(m.surface));
  check("sniff: GALES", sniffMesh(TWO_TETS) === "gales" && parseMesh(TWO_TETS).cellCount === 2);
}

// ── The same mesh in gmsh 2.2 and 4.1 ───────────────────────────────────────
const MSH22 = `$MeshFormat
2.2 0 8
$EndMeshFormat
$Nodes
5
1 0 0 0
2 1 0 0
3 0 1 0
4 0 0 1
5 1 1 1
$EndNodes
$Elements
9
1 15 2 20 1 1
2 2 2 7 1 1 3 2
3 2 2 7 1 1 2 4
4 2 2 7 1 1 4 3
5 2 2 8 2 2 3 5
6 2 2 8 2 2 5 4
7 2 2 8 2 3 4 5
8 4 2 10 1 1 2 3 4
9 4 2 10 1 2 3 4 5
$EndElements
`;
const MSH41 = `$MeshFormat
4.1 0 8
$EndMeshFormat
$Entities
0 0 2 1
1 0 0 0 1 1 1 1 7 0
2 0 0 0 1 1 1 1 8 0
1 0 0 0 1 1 1 1 10 0
$EndEntities
$Nodes
1 5 1 5
3 1 0 5
1
2
3
4
5
0 0 0
1 0 0
0 1 0
0 0 1
1 1 1
$EndNodes
$Elements
3 8 1 8
2 1 2 3
1 1 3 2
2 1 2 4
3 1 4 3
2 2 2 3
4 2 3 5
5 2 5 4
6 3 4 5
3 1 4 2
7 1 2 3 4
8 2 3 4 5
$EndElements
`;
{
  const g = parseGalesMesh(TWO_TETS);
  const a = parseMsh(MSH22);
  check("msh 2.2: cells are the top dimension, sides the one below, point elements ignored", a.dim === 3 && a.cellCount === 2 && a.sideCount === 6);
  check("msh 2.2: node gid = tag − 1, so connectivity equals the GALES file's", [...a.cells].join() === [...g.cells].join());
  check("msh 2.2: coordinates equal", [...a.coords].join() === [...g.coords].join());
  check("msh 2.2: a side's flag is its physical tag", [...a.surfaceFlag].join() === "7,7,7,8,8,8" && faceKey(a.surface) === faceKey(g.surface));
  const b = parseMsh(MSH41);
  check("msh 4.1: the same mesh", b.dim === 3 && b.nodeCount === 5 && [...b.cells].join() === [...g.cells].join() && [...b.coords].join() === [...g.coords].join());
  check("msh 4.1: a side's flag is its ENTITY's physical group, not the entity tag", [...b.surfaceFlag].join() === "7,7,7,8,8,8");
  check("sniff: gmsh", sniffMesh(MSH41) === "msh" && parseMesh(MSH22).cellCount === 2);
  let refused = "";
  try { parseMsh("$MeshFormat\n4.1 1 8\n$EndMeshFormat\n"); } catch (e) { refused = e.message; }
  check("a binary .msh is refused with how to fix it", /binary/.test(refused) && /ASCII/.test(refused));
  let unknown = "";
  try { parseMesh("solid\nfacet"); } catch (e) { unknown = e.message; }
  check("an unknown file is refused by name", /GALES mesh/.test(unknown));
  // A gap in the node tags keeps its row rather than renumbering.
  const gap = parseMsh(MSH22.replace("5\n1 0 0 0", "5\n1 0 0 0").replace("5 1 1 1\n$EndNodes", "7 1 1 1\n$EndNodes").replace("9 4 2 10 1 2 3 4 5", "9 4 2 10 1 2 3 4 7").replace("5 2 2 8 2 2 3 5", "5 2 2 8 2 2 3 7").replace("6 2 2 8 2 2 5 4", "6 2 2 8 2 2 7 4").replace("7 2 2 8 2 3 4 5", "7 2 2 8 2 3 4 7"));
  check("msh: tags with a gap keep gid = tag − 1", gap.nodeCount === 7 && gap.coords[6 * 3] === 1 && gap.cells[7] === 6);
}

// ── 2D ─────────────────────────────────────────────────────────────────────
{
  const square = `MESH! 2D
nodes 4
elements 2
sides 4
X 0 2
Y 0 1
Node 0 0 0 1
Node 1 2 0 1
Node 2 2 1 1
Node 3 0 1 1
Element 0 0 3 0 1 2 0
Element 1 0 3 0 2 3 0
Side 0 0 2 0 1 5
Side 1 0 2 1 2 6
Side 2 0 2 2 3 5
Side 3 0 2 3 0 6
`;
  const m = parseGalesMesh(square);
  check("2D: a node line has no z column (gid x y flag), and the flag is read right", m.dim === 2 && m.coords[1 * 3] === 2 && m.coords[2 * 3 + 1] === 1 && m.nodeFlag[3] === 1 && m.coords.every((v, i) => i % 3 !== 2 || v === 0));
  check("2D: the drawn surface is the cells", m.surfaceFrom === "cells" && m.surface.length === 6);
  check("2D: the outline is the sides, as edges", m.edges.length === 8 && [...m.edges].join() === "0,1,1,2,2,3,3,0");
  const quad = parseGalesMesh(square.replace("elements 2", "elements 1").replace(/^Element 0.*\n^Element 1.*\n/m, "Element 0 0 4 0 1 2 3 0\n"));
  check("2D: a quad is drawn as two triangles", quad.cellCount === 1 && quad.surface.length === 6);
}

// ── Result files ───────────────────────────────────────────────────────────
{
  check("time names: integers, decimals, exponents", timeOf("results/solid/u/10") === 10 && timeOf("0.5") === 0.5 && timeOf("1e-3") === 0.001);
  check("time names: anything else is not a step", timeOf("u.txt") === null && timeOf("history") === null && timeOf("") === null);
  const groups = groupResultFiles([
    { path: "run/results/solid/u/2", size: 24 }, { path: "run/results/solid/u/10", size: 24 },
    { path: "run/results/solid/u/0", size: 24 }, "run/results/fluid_dofs/0.5",
    "run/results/sec_dofs/sigma/sigma11/1", "run/input/mesh_2core.txt", "run/results/solid/history",
  ]);
  check("fields: grouped by the directory under results/", groups.map((g) => g.field).join() === "fluid_dofs,sec_dofs/sigma/sigma11,solid/u");
  check("steps: numeric order, not string order (2 before 10)", groups[2].steps.map((s) => s.time).join() === "0,2,10" && groups[2].steps[2].size === 24);

  check("dofs: from the byte count", dofsPerNode(6027528, 251147).ok && dofsPerNode(6027528, 251147).nbDofs === 3);
  const other = dofsPerNode(8 * 10, 3);
  check("dofs: a field for another mesh is named, not read", !other.ok && /another mesh/.test(other.reason));
  check("dofs: a torn file is named", !dofsPerNode(81, 3).ok && /float64/.test(dofsPerNode(81, 3).reason));

  // Two nodes, three dofs, interleaved as io.hpp writes: node gid * nb + j.
  const raw = new Float64Array([1, 2, 2, -3, 4, 12]);
  const bytes = new Uint8Array(raw.buffer);
  const view = float64View(bytes);
  check("float64: little-endian view of an aligned buffer", view[3] === -3 && view.length === 6);
  const shifted = new Uint8Array(51);
  shifted.set(bytes, 3);
  check("float64: a misaligned slice is copied, not misread", float64View(shifted.subarray(3, 51))[5] === 12);
  check("component: interleaved", [...componentOf(raw, 2, 3, 1)].join() === "2,4");
  check("magnitude: |(1,2,2)| = 3, |(-3,4,12)| = 13", [...magnitudeOf(raw, 2, 3, [0, 1, 2])].join() === "3,13");
  // Blocked (write2): all x, then all y, then all z.
  const blocked = new Float64Array([1, -3, 2, 4, 2, 12]);
  check("component: blocked layout", [...componentOf(blocked, 2, 3, 1, true)].join() === "2,4");
  check("magnitude: blocked layout", [...magnitudeOf(blocked, 2, 3, [0, 1, 2], true)].join() === "3,13");
  check("a node's own byte range, interleaved only", nodeByteRange(1, 2, 3).join() === "24,48" && nodeByteRange(1, 2, 3, true) === null);
  check("range ignores NaN and can be restricted to drawn nodes", rangeOf(new Float32Array([NaN, 5, -1, 9]), [1, 2]).join() === "-1,5" && rangeOf(new Float32Array([NaN])).join() === "0,0");
  check("used nodes: each once, sorted", [...usedNodes(new Int32Array([4, 1, 4, 2]), 6)].join() === "1,2,4");
}

// ── What a field's numbers are ─────────────────────────────────────────────
{
  const u = describeField("solid/u", 3, 3);
  check("solid/u: displacement x, y, z in metres, a magnitude and a warp", u.components.map((c) => c.key).join() === "ux,uy,uz" && u.components[0].unit === "m" && u.vector.from.join() === "0,1,2" && u.displacement.join() === "0,1,2" && !u.blocked);
  const u2 = describeField("solid/u", 2, 2);
  check("solid/u in 2D: two components", u2.components.length === 2 && u2.displacement.join() === "0,1");
  const fl = describeField("fluid_dofs", 5, 3);
  check("fluid_dofs 3D: p, vx, vy, vz, T (fluid_sc, not isothermal)", fl.components.map((c) => c.key).join() === "p,vx,vy,vz,T" && fl.vector.from.join() === "1,2,3");
  check("fluid_dofs 3D isothermal: no T", describeField("fluid_dofs", 4, 3).components.map((c) => c.key).join() === "p,vx,vy,vz");
  check("fluid_dofs multicomponent: mass fractions after T", describeField("fluid_dofs", 7, 3).components.map((c) => c.key).join() === "p,vx,vy,vz,T,Y1,Y2");
  check("fluid_dot_dofs: rates, in rate units", /rate/.test(describeField("fluid_dot_dofs", 4, 2).components[0].label) && describeField("fluid_dot_dofs", 4, 2).components[0].unit === "Pa/s");
  check("fluid_mesh: blocked (write2), a displacement", describeField("fluid_mesh", 3, 3).blocked && describeField("fluid_mesh", 3, 3).displacement.join() === "0,1,2");
  check("heat_eq/T: one scalar in kelvin", describeField("heat_eq/T", 1, 3).components[0].unit === "K");
  check("a stress component: pascals, σ", describeField("sec_dofs/sigma/sigma11", 1, 3).components[0].unit === "Pa" && /σ11/.test(describeField("sec_dofs/sigma/sigma11", 1, 3).components[0].label));
  check("a field this table does not know still opens, numbered", describeField("mystery", 2, 3).components.map((c) => c.key).join() === "c0,c1" && describeField("mystery", 2, 3).vector === undefined);
  check("a count that does not fit the name falls back to numbered components", describeField("solid/u", 5, 3).components.map((c) => c.key).join() === "c0,c1,c2,c3,c4");
}

// ── Slices: exact on a cube of tets ────────────────────────────────────────
//
// The Kuhn subdivision: six tets filling the unit cube, every one sharing the
// diagonal (0,0,0)–(1,1,1). A slice of it at any height is the whole unit
// square, so its area is exactly 1; a linear field is interpolated exactly.
const cube = (() => {
  const coords = [];
  for (let i = 0; i < 8; i += 1) coords.push(i & 1, (i >> 1) & 1, (i >> 2) & 1);
  const paths = [[1, 2, 4], [1, 4, 2], [2, 1, 4], [2, 4, 1], [4, 1, 2], [4, 2, 1]];
  const cells = [];
  for (const p of paths) cells.push(0, p[0], p[0] | p[1], 7);
  const text = [
    "MESH! 3D", "nodes 8", "elements 6", "sides 0", "X 0 1", "Y 0 1", "Z 0 1",
    ...Array.from({ length: 8 }, (_, i) => `Node ${i} ${coords[i * 3]} ${coords[i * 3 + 1]} ${coords[i * 3 + 2]} 1`),
    ...Array.from({ length: 6 }, (_, c) => `Element ${c} 0 4 ${cells.slice(c * 4, c * 4 + 4).join(" ")} 0`),
  ].join("\n");
  return parseGalesMesh(text);
})();
const triangleArea = (p, k) => {
  const ax = p[k + 3] - p[k]; const ay = p[k + 4] - p[k + 1]; const az = p[k + 5] - p[k + 2];
  const bx = p[k + 6] - p[k]; const by = p[k + 7] - p[k + 1]; const bz = p[k + 8] - p[k + 2];
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
};
{
  check("the Kuhn cube's derived boundary is its 12 outer triangles", cube.surfaceFrom === "derived" && cube.surface.length === 36);
  for (const [axis, f] of [["z", 0.5], ["x", 0.3], ["y", 0.81]]) {
    const plane = axisPlane(cube.bounds, axis, f);
    const s = sliceTets(cube, plane.normal, plane.d);
    const pos = interpolateOnSlice(s, cube.coords, 3);
    let area = 0;
    for (let k = 0; k < pos.length; k += 9) area += triangleArea(pos, k);
    const k = { x: 0, y: 1, z: 2 }[axis];
    let onPlane = true;
    for (let v = 0; v < pos.length / 3; v += 1) if (!near(pos[v * 3 + k], f, 1e-6)) onPlane = false;
    check(`slice ${axis} = ${f}: every vertex on the plane, total area exactly 1`, onPlane && near(area, 1, 1e-6), `area ${area}`);
  }
  // A linear field: interpolation on the slice is exact.
  const field = new Float32Array(8);
  for (let i = 0; i < 8; i += 1) field[i] = cube.coords[i * 3] + 2 * cube.coords[i * 3 + 1] + 3 * cube.coords[i * 3 + 2];
  const s = sliceTets(cube, [1, 1, 1], 1.5);
  const pos = interpolateOnSlice(s, cube.coords, 3);
  const val = interpolateOnSlice(s, field);
  let worst = 0;
  for (let v = 0; v < val.length; v += 1) worst = Math.max(worst, Math.abs(val[v] - (pos[v * 3] + 2 * pos[v * 3 + 1] + 3 * pos[v * 3 + 2])));
  check("a linear field interpolated onto an oblique slice is exact", worst < 1e-5, `worst ${worst}`);
  let hexArea = 0;
  for (let k = 0; k < pos.length; k += 9) hexArea += triangleArea(pos, k);
  check("the oblique slice x+y+z = 1.5 is the regular hexagon, area 3√3/4", near(hexArea, (3 * Math.sqrt(3)) / 4, 1e-6), `area ${hexArea}`);
  const miss = sliceTets(cube, [0, 0, 1], 2);
  check("a plane that misses the mesh cuts nothing", miss.t.length === 0 && miss.cells.length === 0);
  check("the slice records which cell each triangle came from", s.cells.length === s.t.length / 3 && [...s.cells].every((c) => c >= 0 && c < 6));
  check("nearest node", nearestNode(cube.coords, [0, 7, 3], [0.9, 0.8, 0.95]) === 7);
}

// ── Colour ─────────────────────────────────────────────────────────────────
{
  const t = colormapTable("Viridis");
  const stops = COLORMAPS.Viridis;
  check("colour table: ends are the map's own ends", near(t[0], stops[0][0] / 255, 1e-6) && near(t[t.length - 1], stops.at(-1)[2] / 255, 1e-6));
  const r = colormapTable("Viridis", { reverse: true });
  check("colour table: reversed", near(r[0], t[t.length - 3], 1e-6));
  const out = new Float32Array(4 * 3);
  colourValues(new Float32Array([0, 10, NaN, 99]), 0, 10, t, out);
  check("colours: lo takes the first entry, hi the last, NaN grey, past hi clamps", near(out[0], t[0]) && near(out[3], t[t.length - 3]) && out[6] === 0.5 && near(out[9], t[t.length - 3]));
  const banded = new Float32Array(2 * 3);
  colourValues(new Float32Array([4.9, 5.1]), 0, 10, t, banded, { bands: 2 });
  check("bands: two classes split at the middle", near(banded[0], t[0]) && near(banded[3], t[t.length - 3]));
  const ticks = niceTicks(0, 85.41, 5);
  check("ticks: round numbers inside the range", ticks.join() === "0,20,40,60,80");
  check("ticks: across zero", niceTicks(-1.2, 3.4, 5).join() === "-1,0,1,2,3");
  check("format: exponent for the very large and very small, digits by the span", formatValue(6.3e9) === "6.300e+9" && formatValue(2e-5) === "2.000e-5" && formatValue(85.41, 85) === "85.4" && formatValue(1234.5, 5000) === "1235");
}

// ── A probe's CSV, and what a folder holds ─────────────────────────────────
{
  const desc = describeField("solid/u", 3, 3);
  const csv = probeCsv([{ time: 0, values: [0, 0, 0] }, { time: 1, values: [3, 4, 12] }], desc, { node: 9, x: 1, y: 2, z: 3 });
  const lines = csv.trim().split("\n");
  check("probe CSV: header names the node, a column per component with its unit, the magnitude", /node 9/.test(lines[0]) && lines[2] === "time,ux_m,uy_m,uz_m,displacement_magnitude" && lines[4] === "1,3,4,12,13");
  const plan = planSimulation([
    { path: "sim/input/mesh.msh", size: 1 }, { path: "sim/input/mesh_4core.txt", size: 2 },
    { path: "sim/input/other.msh", size: 3 }, { path: "sim/results/solid/u/0", size: 24 },
    { path: "sim/input/pointwise_elastic_parameters.txt", size: 4 },
  ], "solid_mesh_file       mesh_4core.txt\ndim 3\n");
  check("plan: the mesh setup.txt names comes first, parameter tables are not meshes", plan.meshes[0].name === "mesh_4core.txt" && plan.meshes.length === 3 && plan.fields[0].field === "solid/u");
}

// ── The real Etna run, when the GALES tree is beside the site ──────────────
{
  const root = fileURLToPath(new URL("../../gales/sim/solid_es/etna_3d_atlas/", import.meta.url));
  if (existsSync(`${root}input/mesh_4core.txt`) && existsSync(`${root}results/solid/u/1`)) {
    const m = parseMesh(readFileSync(`${root}input/mesh_4core.txt`));
    check("Etna: 251,147 nodes and 1,395,454 tets, as the header declares", m.nodeCount === 251147 && m.cellCount === 1395454 && m.declared.elements === 1395454);
    check("Etna: its 103,074 sides ARE the boundary (every tet face seen once)", m.sideCount === 103074 && exposedTetFaces(m).length / 3 === 103074);
    const buf = readFileSync(`${root}results/solid/u/1`);
    const fit = dofsPerNode(buf.byteLength, m.nodeCount);
    const values = float64View(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const mag = magnitudeOf(values, m.nodeCount, fit.nbDofs, [0, 1, 2]);
    check("Etna: u has 3 dofs a node, and its largest displacement is 85.41 m (numpy: 85.412219)", fit.nbDofs === 3 && near(rangeOf(mag)[1], 85.41221901847926, 1e-6));
  } else console.log("SKIP  Etna: the GALES tree is not beside the site");
}
