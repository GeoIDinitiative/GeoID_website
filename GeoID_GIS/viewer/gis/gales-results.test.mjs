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
  probeCsv, planSimulation, COLORMAPS, flagSummary, stationsForFlag, nodeLocator, specPoints,
  parsePointList, stationCsvFiles,
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

{
  check("format: rounding noise against the range reads as zero", formatValue(1.2e-17, 2) === "0" && formatValue(0.5, 2) === "0.50");
}

// ── The panel's wiring, pinned on the source ───────────────────────────────
{
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  const studio = readFileSync(new URL("./model-studio.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const shell = readFileSync(new URL("./shell.html", import.meta.url), "utf8");
  const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
  check("the worker is loaded under the panel's own stamp, as a module", /new Worker\(new URL\(`\.\/gales-worker\.js\$\{VERSION\}`, import\.meta\.url\), \{ type: "module" \}\)/.test(panel));
  check("the worker only listens inside a worker", /typeof window === "undefined"/.test(worker) && /self\.addEventListener\("message", handle\)/.test(worker));
  check("a transferred mesh buffer is read fresh, never out of a cache", /source\.read\(path, \{ fresh: true \}\)/.test(panel) && /if \(!fresh\) last = \{ path, buffer \};/.test(panel));
  check("the probe never stops the release OrbitControls needs", /canvas\.addEventListener\("pointerup"/.test(panel) && !/addEventListener\("pointerup"[^;]*?\{[\s\S]{0,500}?(stopPropagation|stopImmediatePropagation)/.test(panel.replace(/\/\/.*$/gm, "")));
  check("the results reach the ground's hole and the camera floor, not the mesher's bounds", /function sceneBounds\(\)/.test(studio) && /const b = below \? sceneBounds\(\) : null;/.test(studio) && /setExternalBounds,/.test(studio) && /setExternalBounds\?\.\("gales-results", resultBounds\(\)\)/.test(panel));
  check("a Results tab in the mesh band, on Earth and on the planets", /data-group="results" data-deck="left" data-band="mesh"/.test(page) && /data-group="results" data-deck="left" data-band="mesh"/.test(shell) && /id="studio-results-host"/.test(page));
  check("the panel loads on Earth and on every planet", /gis\/gales-results-panel\.js\?v=/.test(page) && /"\.\/gales-results-panel\.js",/.test(boot));
  check("points: files go to the project's post_processing/extracted_dofs, where the Signal pages list series", /post_processing\/extracted_dofs\/\$\{f\.name\}/.test(panel) && /stationCsvFiles\(\{ stations, fields: out, layout: S\.extract\.layout, prefix, header \}\)/.test(panel));
  check("points: several files arrive as one zip, gated like every save", /zipStore\(files\.map/.test(panel) && /if \(!may\("save"\)\)/.test(panel));
  check("points: the worker hands the node flags over, so a flag can name a point", /nodeFlag \? \[nodeFlag\.buffer\] : \[\]/.test(worker));
  check("the Model Builder writes each embedded point's flag into spec.json", /lat: p\.lat, lon: p\.lon, flag: p\.flag,/.test(readFileSync(new URL("./model-pipeline.js", import.meta.url), "utf8")));
  check("a clip keeps the half whose cut faces the studio's own view", /const keepAbove = \(S\.sliceAxis === "y"\) !== S\.clipFlip;/.test(panel));
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

// ── Points and their time series ───────────────────────────────────────────
{
  const g = parseGalesMesh(TWO_TETS);
  check("flags: fewest nodes first, zero is no flag", flagSummary(g.nodeFlag).map((f) => `${f.flag}:${f.count}`).join() === "2:1,1:4");
  const st = stationsForFlag(g, 2);
  check("stations for a flag: the node, its coordinates, the flag", st.found === 1 && st.stations[0].node === 4 && st.stations[0].x === 1 && st.stations[0].flag === 2);
  check("stations for a flag are capped and say so", stationsForFlag(g, 1, { cap: 2 }).capped && stationsForFlag(g, 1, { cap: 2 }).stations.length === 2);
  const withPoint = parseMsh(MSH22.replace("1 15 2 20 1 1", "1 15 2 20 1 5"));
  check("msh: an embedded point's node carries its physical flag, set last (points over faces)", withPoint.nodeFlag[4] === 20 && withPoint.nodeFlag[0] === 7);
  // The locator against brute force on the Kuhn cube and a scatter of queries.
  const loc = nodeLocator(cube);
  let agree = true;
  for (let k = 0; k < 200; k += 1) {
    const q = [Math.sin(k * 1.3) * 1.5 + 0.5, Math.cos(k * 0.7) * 1.5 + 0.5, Math.sin(k * 0.37) * 1.5 + 0.5];
    const brute = nearestNode(cube.coords, [...Array(8).keys()], q);
    const got = loc.nearest(q);
    const d = (i) => Math.hypot(cube.coords[i * 3] - q[0], cube.coords[i * 3 + 1] - q[1], cube.coords[i * 3 + 2] - q[2]);
    if (Math.abs(d(got.node) - d(brute)) > 1e-12) agree = false;
  }
  check("node locator: the nearest node, inside and outside the mesh's box, as brute force finds", agree);
  const spec = { geoid_model: { embedded_points: [{ name: "BH1", x: 10, y: 20, z: -5, flag: 21 }, { name: "S1", s: 300, z: 40 }, { name: "bad" }] } };
  const sp = specPoints(spec);
  check("spec points: x, y, z as given; a section's (s, z) as the 2D mesh's (x, y)", sp.length === 2 && sp[0].flag === 21 && sp[0].z === -5 && sp[1].x === 300 && sp[1].y === 40 && sp[1].z === 0);
  const typed = parsePointList("name,x,y,z\nBH 1, 1.5, 2, -3\n# a note\n4 5 6\nwell;7;8;9");
  check("a typed list: a header skipped, names with spaces, bare coordinates numbered, any delimiter", typed.length === 3 && typed[0].name === "BH 1" && typed[0].z === -3 && typed[1].name === "point_2" && typed[1].z === 6 && typed[2].name === "well");

  const stations = [{ name: "A", node: 3, x: 0, y: 0, z: 1, flag: 20, distance: 0 }, { name: "B, deep", node: 4, x: 1, y: 1, z: 1, flag: null, distance: 0.25 }];
  const u = { desc: describeField("solid/u", 3, 3), times: [0, 1], values: new Float64Array([0, 0, 0, 0, 0, 0, 3, 4, 12, 1, 2, 2]) };
  const T = { desc: describeField("heat_eq/T", 1, 3), times: [1, 2], values: new Float64Array([300, 301, 310, 311]) };
  const per = stationCsvFiles({ stations, fields: [u, T], layout: "station", prefix: "etna", header: ["GALES etna"] });
  check("per point: a file each, named for the point", per.files.map((f) => f.name).join() === "etna_A.csv,etna_B_deep.csv");
  const aLines = per.files[0].text.trim().split("\n");
  check("per point: columns with units, the magnitude after its components, times the union of the fields", aLines[2] === "time,solid_u_ux_m,solid_u_uy_m,solid_u_uz_m,solid_u_magnitude_m,heat_eq_T_T_K" && aLines[4] === "1,3,4,12,13,300" && aLines[3] === "0,0,0,0,0," && aLines[5] === "2,,,,,310");
  check("per point: the header names the node, the flag and how far the node is from the point", /node 3 · x=0 y=0 z=1 · flag 20/.test(per.files[0].text) && /0\.250 m from the point asked for/.test(per.files[1].text));
  const step = stationCsvFiles({ stations, fields: [u, T], layout: "step", prefix: "etna" });
  check("per step: a file per time, a row per point, a name with a comma quoted", step.files.length === 3 && step.files[1].name === "etna_t1.csv" && step.files[1].text.trim().split("\n")[3] === '"B, deep",4,1,1,1,,0.25,1,2,2,3,301');
  const tidy = stationCsvFiles({ stations, fields: [u], layout: "tidy" });
  check("tidy: one file, a row per point per time", tidy.files.length === 1 && tidy.files[0].text.trim().split("\n").length === 1 + 4);
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

// ── The results are in the studio's Visibility box ─────────────────────────
{
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const studioSrc = readFileSync(new URL("./model-studio.js", import.meta.url), "utf8");
  check("visibility: the studio takes providers, lists their groups, and publishes the seam", /const visibilityProviders = new Map\(\);/.test(studioSrc) && /groups\.push\(\{ \.\.\.group, id: group\.id \|\| id, external: true \}\)/.test(studioSrc) && /registerVisibility,/.test(studioSrc) && /refreshVisibility: \(\) => renderVisibilityBox\(\)/.test(studioSrc));
  check("visibility: a part's switch tells its owner", /typeof part\.onVisible === "function"/.test(studioSrc));
  check("visibility: the results register a group and hold each part in its own group, so refresh cannot undo a switch", /registerVisibility\("gales-results", visibilityGroup\)/.test(panel) && /scene\.parts\.surface\.add\(surface\)/.test(panel) && /scene\.parts\.slice\.add\(slice\)/.test(panel) && /scene\.parts\.edges\.add\(scene\.outline\)/.test(panel));
  check("visibility: the box is redrawn when the results are built or disposed, and when its rows change, not on every step", /anchor\.add\(root\);\s*studio\(\)\?\.refreshVisibility\?\.\(\);/.test(panel) && /if \(visKey !== scene\.visKey\)/.test(panel));
  check("visibility: a part switched off cannot be probed", /o\?\.visible && o\.parent\?\.visible !== false/.test(panel));
  check("visibility: a Workspace layer is switched by its object, not its id", /GeoIDLayerHierarchy\.setVisible\(layer, on\)/.test(studioSrc));
}

// ── a run opened a piece at a time ──
{
  const fields = (entries, options) => groupResultFiles(entries, options).map((f) => `${f.field}:${f.steps.map((s) => s.name).join(",")}`).join(" ");
  check("a whole run still groups under results/, and build or input files are never fields", fields(["run/results/solid/u/0", "run/results/solid/u/1", "run/input/mesh_4core.txt", "run/build/2"]) === "solid/u:0,1");
  check("a pick below results/ keeps its fields: the solid folder, or the u folder on its own", fields(["solid/u/0", "solid/u/1"]) === "solid/u:0,1" && fields(["u/1", "u/0"]) === "u:0,1");
  check("a build tree picked without results/ is not a field", fields(["sim/build/CMakeFiles/3"]) === "");
  check("step files picked one by one belong to the loose field, and to nothing without one", fields(["0", "1"], { looseField: "solid/u" }) === "solid/u:0,1" && fields(["0", "1"]) === "");
  const u = describeField("u", 3, 3);
  check("a bare u (or u under any folder) is displacement, with a magnitude and a warp", u.label === "Displacement" && u.vector && u.displacement?.length === 3 && describeField("mine/solid/u", 3, 3).label === "Displacement");
  check("the GALES name still reads as before", describeField("solid/u", 3, 3).label === "Displacement" && describeField("solid/v", 3, 3).label === "Velocity");
  const plan = planSimulation([{ path: "input/etna.txt" }, { path: "input/mesh_1core.txt" }, { path: "results/solid/u/1" }], "", { meshes: ["input/etna.txt"] });
  check("a mesh opened by hand is planned, whatever its name, and comes first", plan.meshes[0].path === "input/etna.txt" && plan.meshes.length === 2);
  const panelSrc = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("doors: a mesh file, a results folder, result files, and a drop zone", /Open mesh file…/.test(panelSrc) && /Add results folder…/.test(panelSrc) && /Add result files…/.test(panelSrc) && /webkitGetAsEntry/.test(panelSrc) && /composeSources\(S\.source, extra\)/.test(panelSrc));
}
check("a mesh opened onto a loaded run starts a new run; results join the open one", /const fresh = kind === "mesh" && Boolean\(S\.mesh\);/.test(readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8")));
