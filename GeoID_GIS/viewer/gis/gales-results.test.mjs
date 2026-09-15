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
  niceTicks, formatValue, tickLabel, sliceTets, domainStats, domainStatsCsv, interpolateOnSlice, axisPlane, nearestNode,
  probeCsv, planSimulation, COLORMAPS, flagSummary, stationsForFlag, nodeLocator, specPoints,
  parsePointList, stationCsvFiles,
  referencePlan, differenceOf, cutTets, isoTets, contourLevels, contourSegments, stepReading, powerLawSlope, exposedFaces, thresholdKeep, keptTriangles,
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

// ── plot over line: locating points and reading the solution between nodes ──
{
  const { cellLocator, lineSamples, locatePoints, sampleLocated, profileCsv } = await import("./gales-results.js");
  const loc = cellLocator(cube);
  check("locator: the Kuhn cube's six tets are indexed", loc.cells === 6);
  const hit = loc.locate([0.3, 0.6, 0.2]);
  check("locator: a point inside finds a tet whose weights sum to one and rebuild the point", hit && Math.abs(hit.weights.reduce((a, b) => a + b, 0) - 1) < 1e-12 && [0, 1, 2].every((a) => Math.abs(hit.nodes.reduce((s, node, j) => s + hit.weights[j] * cube.coords[node * 3 + a], 0) - [0.3, 0.6, 0.2][a]) < 1e-12));
  check("locator: a point outside the mesh is null", loc.locate([1.2, 0.5, 0.5]) === null);
  const line = lineSamples([-0.5, 0.25, 0.5], [1.5, 0.75, 0.5], 41);
  const located = locatePoints(loc, line.points);
  // A linear field is reproduced exactly inside, and NaN outside.
  const f = new Float64Array(8).map((_, i) => 2 * cube.coords[i * 3] - 3 * cube.coords[i * 3 + 1] + 5 * cube.coords[i * 3 + 2] + 1);
  const v = sampleLocated(located, f);
  let exact = true; let outsideNaN = true;
  for (let k = 0; k < 41; k += 1) {
    const [x, y, z] = [line.points[k * 3], line.points[k * 3 + 1], line.points[k * 3 + 2]];
    const inside = x >= 0 && x <= 1;
    if (inside && Math.abs(v[k] - (2 * x - 3 * y + 5 * z + 1)) > 1e-9) exact = false;
    if (!inside && x < -1e-9 && !Number.isNaN(v[k])) outsideNaN = false;
  }
  check("sample: a linear field is exact along a line through the volume, and NaN where the line leaves it", exact && outsideNaN && located.inside >= 20);
  check("line: distances run 0 to the length", line.distance[0] === 0 && Math.abs(line.distance[40] - line.length) < 1e-12 && Math.abs(line.length - Math.hypot(2, 0.5)) < 1e-12);
  const csv = profileCsv({ distance: line.distance, points: line.points, series: [{ name: "f", values: v }], header: ["field f"] });
  check("csv: header comment, columns, a blank cell outside the mesh", csv.startsWith("# field f\ndistance_m,x,y,z,f\n") && /\n0,-0\.5,0\.25,0\.5,\n/.test(csv));
  const tri = { dim: 2, nodeCount: 3, coords: Float64Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0]), cells: Uint32Array.from([0, 1, 2]), cellOffsets: Uint32Array.from([0, 3]), bounds: { min: [0, 0, 0], max: [2, 2, 0] } };
  const t = cellLocator(tri).locate([0.5, 0.5, 0]);
  check("2D: a triangle in the xy plane, its weights exact", t && Math.abs(t.weights[1] - 0.25) < 1e-12 && Math.abs(t.weights[2] - 0.25) < 1e-12);
}
{
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const analysis = readFileSync(new URL("./results-analysis-panel.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const shellHtml = readFileSync(new URL("./shell.html", import.meta.url), "utf8");
  check("analysis: the worker locates points in the cells it holds, and the results seam exposes values, the scalar and locate", /type === "locate"/.test(worker) && /locate: async \(points\) =>/.test(panel) && /values: \(fieldIndex = S\.field, stepIndex = S\.step\) => valuesAt/.test(panel) && /scalar: \(values, desc = currentDesc\(\)\) => scalarOf/.test(panel));
  check("analysis: an Analysis tab in the Analyse workspace on both pages, loaded on both", index.includes('data-group="analysis"') && shellHtml.includes('id="studio-analysis-host"') && /src="gis\/results-analysis-panel\.js\?v=/.test(index) && /"\.\/results-analysis-panel\.js",/.test(readFileSync(new URL("./boot.js", import.meta.url), "utf8")));
  check("analysis: the profile is sampled through the located weights, not the nearest node, and follows the Results selection", /sampleLocated\(loc, scalar\)/.test(analysis) && /if \(L\.profile && sig !== L\.sig && !L\.busy\) plot\(\)/.test(analysis));
  check("analysis: no style block of its own", !analysis.includes("const STYLE = `"));
}
{
  // Derived stress and strain: the worker computes them from u, the panel
  // offers them as a field of their own, and the legend can read a Pa scale.
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("derived: the worker answers a derive request through strain-stress.js and transfers the values", /type === "derive"/.test(worker) && /derivedFields\(mesh,/.test(worker) && /\[out\.values\.buffer\]/.test(worker));
  check("derived: a 3D displacement field adds one stress-strain-tilt field whose steps read the displacement's files", /field: "derived\/stress", derived: true/.test(panel) && /source: st\.path/.test(panel) && /nbDofs: DERIVED_DOFS,/.test(panel));
  check("derived: valuesAt computes a derived step rather than reading bytes, and says when there is no props.txt", /if \(f\.derived\) \{/.test(panel) && /call\("derive"/.test(panel) && /strain and tilt only: no solid props\.txt/.test(panel));
  check("derived: the probe series never byte-reads a derived field", /!f\.derived(?: && !f\.\w+)* \? nodeByteRange/.test(panel));
  const d = describeField("derived/stress", 16, 3);
  check("derived: describeField names the stress field and defaults to von Mises", d && d.defaultComponent === "12" && /stress/i.test(d.label || ""), JSON.stringify(d && { label: d.label, def: d.defaultComponent }));
  check("tickLabel: an exponent keeps only its digits", tickLabel(5e7, 2.5e8) === "5e7" && tickLabel(1.5e8, 2.5e8) === "1.5e8" && tickLabel(2.5, 85) === "2.5");
  check("tickLabel: the legend ticks use it, the ends line keeps formatValue", /tickLabel\(v, span \|\| Math\.abs\(v\) \|\| 1\)/.test(panel) && /min \$\{formatValue\(lo/.test(panel));
}
{
  // The satellite view: LOS and fringes are components of a displacement field.
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("insar: a displacement offers LOS and wrapped fringes as components", /\["los", "Satellite line of sight \(InSAR\)"\]/.test(panel) && /\["fringe", "Interferogram fringes \(wrapped\)"\]/.test(panel) && /canLos\(desc\)/.test(panel));
  check("insar: a slice interpolates the LOS and wraps after, never interpolates wrapped values", /wrapFringes\(interpolateOnSlice\(sliced\.slice, losHere\)/.test(panel));
  check("insar: fringes paint on the cyclic map over [0, 1] with no bands or log", /fringe \? \[0, 1\] : S\.range/.test(panel) && /stops: FRINGE_MAP/.test(panel) && /fringe \? \{ bands: 0, log: false \}/.test(panel));
  check("insar: aliasing is measured per surface edge and said", /fringesPerEdge\(los, edges/.test(panel) && /ALIASED/.test(panel));
  check("insar: the scale changes what the satellite sees and keeps the named satellite", /los\[i\] \*= k/.test(panel) && /custom: key !== "scale"/.test(panel));
}
{
  // Statistics by domain: a linear field over a cube cut into six tets, whose
  // volume-weighted mean is exactly the field at the centre.
  const corner = (i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1];
  const coords = Float64Array.from([...Array(8).keys()].flatMap(corner));
  const kuhn = [[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]];
  const cells = Uint32Array.from(kuhn.flat());
  const offsets = Uint32Array.from([0, 4, 8, 12, 16, 20, 24]);
  const flags = Int32Array.from([10, 10, 10, 20, 20, 20]);
  const f = Float32Array.from([...Array(8).keys()].map((i) => { const [x, y, z] = corner(i); return x + 2 * y + 3 * z; }));
  const all = domainStats({ dim: 3, coords, cells, cellOffsets: offsets, cellFlag: new Int32Array(6) }, f);
  check("domain stats: the six tets fill the unit cube", near(all.domains[0].measure, 1, 1e-12));
  check("domain stats: a linear field's volume-weighted mean is its value at the centre", near(all.domains[0].mean, 3, 1e-12), String(all.domains[0].mean));
  check("domain stats: min and max are the nodes' own range", all.domains[0].min === 0 && all.domains[0].max === 6);
  check("domain stats: the histogram carries the whole volume", near(all.domains[0].hist.reduce((a, b) => a + b, 0), 1, 1e-12));
  const split = domainStats({ dim: 3, coords, cells, cellOffsets: offsets, cellFlag: flags }, f, { bins: 8 });
  check("domain stats: one row per flag, in flag order, volumes summing to the cube", split.domains.map((d) => d.flag).join() === "10,20" && near(split.domains[0].measure + split.domains[1].measure, 1, 1e-12));
  check("domain stats: both domains share one set of bins", split.domains.every((d) => d.hist.length === 8) && split.lo === all.lo && split.hi === all.hi);
  const withNan = Float32Array.from(f); withNan[7] = NaN;
  check("domain stats: an element touching NaN is counted and left out", domainStats({ dim: 3, coords, cells, cellOffsets: offsets }, withNan).nanCells === 6);
  const hex = domainStats({ dim: 3, coords, cells: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7]), cellOffsets: Uint32Array.from([0, 8]) }, f);
  check("domain stats: a non-simplex element is skipped, not guessed at", hex.skipped === 1 && hex.domains.length === 0);
  const tri = domainStats({ dim: 2, coords: Float64Array.from([0, 0, 0, 2, 0, 0, 0, 2, 0]), cells: Uint32Array.from([0, 1, 2]), cellOffsets: Uint32Array.from([0, 3]) }, Float32Array.from([0, 3, 3]));
  check("domain stats: 2D weights by area", near(tri.domains[0].measure, 2, 1e-12) && near(tri.domains[0].mean, 2, 1e-12));
  const csv = domainStatsCsv(split, { label: "Displacement", unit: "m" });
  check("domain stats CSV: a row per flag, then the bins", csv.startsWith("flag,elements,volume_m3,mean Displacement (m)") && csv.split("\n").filter((l) => /^(10|20),/.test(l)).length === 2 && /bin_from \(m\),flag 10 volume_m3,flag 20 volume_m3/.test(csv));
}
{
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const analysis = readFileSync(new URL("./results-analysis-panel.js", import.meta.url), "utf8");
  check("stats: the worker summarises by domain where the cells are, transferring the histograms", /type === "stats"/.test(worker) && /domainStats\(mesh, event\.data\.scalar/.test(worker));
  check("stats: the seam copies the scalar before transferring it, so a cached field is never detached", /const copy = Float32Array\.from\(scalar\);/.test(panel) && /\[copy\.buffer\]/.test(panel));
  check("analysis: profiles and stats read the sampling scalar (LOS, not wrapped fringes) and wrap after", /results\.samplingScalar \|\| results\.scalar/.test(analysis) && /results\.afterSampling \? results\.afterSampling\(samples\)/.test(analysis) && /afterSampling: \(samples/.test(panel));
  check("analysis: a satellite geometry change is part of the selection it follows", /S\.insar\?\.heading/.test(analysis));
  check("analysis: a Statistics by domain card, recomputed when the selection changes, a press during a run queued", /card\("Statistics by domain"/.test(analysis) && /L\.stats\.open && L\.stats\.result && sig !== L\.stats\.sig/.test(analysis) && /T\.pending = true/.test(analysis));
  check("observations: a Compare card that parses and fits with observations.js, and follows the selection", /card\("Compare with observations"/.test(analysis) && /import \{ parseObservations, fitScale, pairsOf, comparisonCsv \} from "\.\/observations\.js\?v=/.test(analysis) && /L\.obs\.result && obsSignature\(\) !== L\.obs\.sig/.test(analysis));
  check("observations: a station is interpolated in its element, else read at the ground below it, never at the base", /located\.nodes\[slot \* 4\] >= 0/.test(analysis) && /function groundBelow/.test(analysis) && /bestZ/.test(analysis));
  check("observations: LOS is modelled with the Results satellite geometry", /losVector\(S\.insar\)/.test(analysis));
  check("observations: a 2D mesh is refused rather than read as a map", /S\.mesh\.dim === 2\) return refuse/.test(analysis));
  check("vtk: the worker writes the .vtu where the cells are, as a Blob, and the panel zips steps with a .pvd", /type === "vtu"/.test(worker) && /new Blob\(parts/.test(worker) && /pvdText\(files\.map/.test(panel) && /section\("vtk", "Export for ParaView"\)/.test(panel));
  check("vtk: exporting is gated like every save", /async function exportVtk[\s\S]{0,200}may\("save"\)/.test(panel));
  check("mogi: a card that benchmarks the model surface and inverts it or the observations, marking the source", /card\("Analytical source \(Mogi\)"/.test(analysis) && /invertSource\("model"\)/.test(analysis) && /invertSource\("observations"\)/.test(analysis) && /function drawSourceMarker/.test(analysis) && /topSurfaceNodes\(/.test(analysis));
  check("mogi: an inversion on the edge of its search says it is not a minimum", /atEdge\.depth/.test(analysis));
  check("report: a Report card building one printable page from the analyses' own facts, gated like every save", /card\("Report"/.test(analysis) && /modelReportHtml\(data\)/.test(analysis) && /async function openModelReport[\s\S]{0,160}may\("save"\)/.test(analysis) && /obsFacts\(res\)\.forEach/.test(analysis) && /\.\.\.obsFacts\(res\)/.test(analysis));
  check("refresh keeps its own LOS against the analysis reading the scalar between its awaits", /const losHere = S\.losRaw;/.test(panel) && /interpolateOnSlice\(sliced\.slice, losHere\)/.test(panel));
}

{
  const base = [
    { field: "solid/u", steps: [{ name: "0", time: 0, path: "a/results/solid/u/0" }, { name: "1", time: 1, path: "a/results/solid/u/1" }, { name: "2", time: 2, path: "a/results/solid/u/2" }] },
    { field: "derived/stress", derived: true, steps: [{ name: "1", time: 1, path: "derived:x" }] },
    { field: "heat_eq/T", steps: [{ name: "1", time: 1, path: "a/results/heat_eq/T/1" }] },
  ];
  const ref = [{ field: "u", steps: [{ name: "0", time: 0, path: "b/u/0" }, { name: "1.5", time: 1.5, path: "b/u/1.5" }] }];
  const plan = referencePlan(base, ref);
  check("compare: a field matched by its unique leaf, derived fields and unmatched ones left out", plan.length === 1 && plan[0].field === "compare/solid/u" && plan[0].from === "solid/u" && plan[0].refField === "u");
  check("compare: each step pairs with the reference's latest step at or before its time", plan[0].steps.map((s) => `${s.name}<${s.refName}`).join() === "0<0,1<0,2<1.5" && plan[0].steps[2].path === "compare:a/results/solid/u/2|b/u/1.5");
  const exact = referencePlan([{ field: "solid/u", steps: [{ name: "1", time: 1, path: "p" }] }], [{ field: "x/u", steps: [{ name: "1", time: 1, path: "q1" }] }, { field: "solid/u", steps: [{ name: "1", time: 1, path: "q2" }] }]);
  check("compare: an exact name beats a leaf, and an ambiguous leaf matches nothing", exact[0].steps[0].ref === "q2" && referencePlan([{ field: "solid/u", steps: [{ name: "1", time: 1, path: "p" }] }], [{ field: "x/u", steps: [{ name: "1", time: 1, path: "q1" }] }, { field: "y/u", steps: [{ name: "1", time: 1, path: "q2" }] }]).length === 0);
  const later = referencePlan(base.slice(0, 1), [{ field: "solid/u", steps: [{ name: "5", time: 5, path: "late" }] }]);
  check("compare: a reference that starts later than this run gives no steps before it", later.length === 0);
  check("compare: the difference is value for value, and a different mesh is refused", differenceOf(new Float64Array([3, 5]), new Float64Array([1, 7])).join() === "2,-2" && (() => { try { differenceOf(new Float64Array(3), new Float64Array(4)); return false; } catch (e) { return /not the same mesh/.test(e.message); } })());
}
{
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("compare: difference fields join the reader as ordinary fields, read value for value, labelled as differences", /referencePlan\(S\.fields\.filter\(\(f\) => f\.ok\), S\.reference\.fields\)/.test(panel) && /if \(f\.compare\) \{[\s\S]{0,300}differenceOf\(a, b\)/.test(panel) && /label: `Δ \$\{c\.label\}`/.test(panel));
  check("compare: a byte-range read is never used for a difference, which has no bytes of its own", /!f\.derived && !f\.compare(?: && !f\.\w+)* \? nodeByteRange/.test(panel));
  check("compare: opening a new run drops the reference", /S\.source = source;\n  S\.reference = null;/.test(panel));
}

{
  // A unit tet split into a cube's worth is too much; one tet with a linear field says it all.
  const tet = { nodeCount: 4, coords: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), cells: new Int32Array([0, 1, 2, 3]), cellOffsets: new Int32Array([0, 4]), cellCount: 1 };
  const x = new Float64Array([0, 1, 0, 0]); // the field is x
  const iso = isoTets(tet, x, 0.5);
  const at = interpolateOnSlice(iso, tet.coords, 3);
  check("iso: the isosurface x = 0.5 of a linear field is a triangle at x = 0.5 exactly", iso.t.length === 3 && [0, 3, 6].every((k) => Math.abs(at[k] - 0.5) < 1e-7));
  check("iso: a level outside the field's range cuts nothing", isoTets(tet, x, 2).t.length === 0);
  check("iso: a tet touching a NaN is left out", isoTets(tet, new Float64Array([0, 1, NaN, 0]), 0.5).t.length === 0);
  const z = new Float64Array([0, 0, 0, 1]);
  const mid = interpolateOnSlice(isoTets(tet, z, 0.5), tet.coords, 3);
  check("iso: a level that splits the tet two-and-two gives a quad (two triangles) on the level", mid.length === 9 && [2, 5, 8].every((k) => Math.abs(mid[k] - 0.5) < 1e-7) && isoTets(tet, new Float64Array([0, 1, 0, 1]), 0.5).t.length === 6);
  check("slice: still the same cut as before, with its plane", sliceTets(tet, [1, 0, 0], 0.5).t.length === 3 && sliceTets(tet, [2, 0, 0], 1).d === 0.5);

  check("contour levels: round numbers strictly inside the range", contourLevels(0, 85.4, 8).join() === "10,20,30,40,50,60,70,80" && contourLevels(3, 3).length === 0);

  // Two triangles over the unit square, the field is x + y.
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const val = new Float32Array([0, 1, 2, 1]);
  const seg = contourSegments(pos, val, new Uint32Array([0, 1, 2, 0, 2, 3]), [0.5, 1.5]);
  const onLine = [...Array(seg.positions.length / 3).keys()].every((k) => Math.abs(seg.positions[k * 3] + seg.positions[k * 3 + 1] - [0.5, 1.5][seg.level[k]]) < 1e-6);
  check("contours: every endpoint lies on its level (x + y = level)", seg.positions.length === 4 * 2 * 3 && onLine);
  const edge = contourSegments(pos, val, new Uint32Array([0, 1, 2, 0, 2, 3]), [1]);
  check("contours: a level through shared vertices is drawn once per triangle, not twice along an edge", edge.positions.length / 6 === 2);
  const unindexed = contourSegments(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), new Float32Array([0, 1, 2]), null, [0.5]);
  check("contours: unindexed triangles (a slice) contour too", unindexed.positions.length === 6);
}
{
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  check("contours/iso: isosurfaces cut in the worker, contours on the page, both parts in the Visibility box, never on fringes", /type === "iso"/.test(worker) && /function drawContours/.test(panel) && /\["iso", "Isosurfaces"/.test(panel) && /drawContours\(\{ scalar: !fringe && scalar/.test(panel));
  check("contours/iso: cut where the surface is in clip view", /clippingPlanes: view === "clip" \? \[scene\.clip\] : null/.test(panel) && /const clip = \(S\.mesh\.dim === 3 \? S\.view : "surface"\) === "clip"/.test(panel));
}
{
  const desc = describeField("solid/u", 3, 3);
  const v = new Float64Array([0, 0, 1, 3, 4, 0, 0, 0, -7]);
  check("reading: the peak is the largest absolute value, signed, over every node", stepReading(v, 3, desc, { component: "2" }) === -7 && stepReading(v, 3, desc) === 7);
  check("reading: at a node, the vector's length or one component", stepReading(v, 3, desc, { node: 1 }) === 5 && stepReading(v, 3, desc, { node: 1, component: "0" }) === 3);
  const p = [5e6, 1e7, 2e7];
  check("slope: displacement proportional to pressure is slope 1, to 1/E slope −1, exactly", Math.abs(powerLawSlope(p, p.map((x) => 3e-6 * x)).slope - 1) < 1e-12 && Math.abs(powerLawSlope([3e10, 6e10], [2, 1]).slope + 1) < 1e-12 && powerLawSlope([1, 2], [0, 0]).n === 0);
}
{
  const { runInNewContext } = await import("node:vm");
  const foreign = runInNewContext("new Float64Array([1.5, -2]).buffer");
  const foreignView = runInNewContext("new Uint8Array(new Float64Array([3, 4]).buffer)");
  check("bytes from another realm are read as bytes, not as the text of their name", float64View(foreign).join() === "1.5,-2" && float64View(foreignView).join() === "3,4" && !(foreign instanceof ArrayBuffer));
}
{
  const analysis = readFileSync(new URL("./results-analysis-panel.js", import.meta.url), "utf8");
  const setupPanel = readFileSync(new URL("./studio-setup-panel.js", import.meta.url), "utf8");
  check("sweep: the Study tab writes a run per value with the page's setup swapped back afterwards, and a manifest", /async function withSetup\(next, fn\)[\s\S]{0,120}finally \{ setup = keep; \}/.test(setupPanel) && /sweepManifest\(\{/.test(setupPanel) && /_sweep\.json/.test(setupPanel));
  check("sweep: a local sweep solve asks first, and the geometry is meshed once for every run", /Solve \$\{runs\.length\} runs one after another on THIS machine/.test(setupPanel) && /withSetup\(runs\[0\]\.setup, meshStudy\)/.test(setupPanel));
  check("sweep: the Analysis tab reads each run's last step to one number and fits the sensitivity", /card\("Sweep response"/.test(analysis) && /stepReading\(values, n, desc/.test(analysis) && /powerLawSlope\(/.test(analysis));
}
{
  const m = parseGalesMesh(TWO_TETS);
  m.cellFlag = new Int32Array([10, 20]);
  const all = exposedFaces(m, null);
  check("threshold: all cells kept is the whole boundary, each face owned by its cell", all.triangles.length === 18 && faceKey(all.triangles) === faceKey(exposedTetFaces(m)) && all.cells.length === 6);
  const byFlag = thresholdKeep(m, null, { flags: [20] });
  const skin = exposedFaces(m, byFlag.keep);
  check("threshold: one volume flag keeps its cell, and its skin closes over the face it shared", byFlag.kept === 1 && skin.triangles.length === 12 && [...skin.cells].every((c) => c === 1));
  const x = new Float64Array([0, 1, 0, 0, 1]); // node 4 at x = 1
  check("threshold: every node in range, any node, or the mean", thresholdKeep(m, x, { lo: 0, hi: 0.5, mode: "all" }).kept === 0 && thresholdKeep(m, x, { lo: 0, hi: 0.5, mode: "any" }).kept === 2 && thresholdKeep(m, x, { lo: 0.4, hi: 1, mode: "mean" }).kept === 1);
  check("threshold: a NaN node does not fail a cell whose other nodes are in range when any is enough", thresholdKeep(m, new Float64Array([NaN, 0, 0, 0, 0]), { lo: -1, hi: 1, mode: "any" }).kept === 2);
  const square = { cells: new Int32Array([0, 1, 2, 3, 2, 3, 4]), cellOffsets: new Int32Array([0, 4, 7]), cellCount: 2 };
  const tris = keptTriangles(square, new Uint8Array([1, 0]));
  check("threshold 2D: a kept quad is two triangles, a dropped cell nothing", tris.triangles.length === 6 && [...tris.cells].join() === "0,0");
}
{
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  check("threshold: a view whose skin the worker builds from the kept cells, colourable by volume flag, with the flags counted at parse", /\["threshold", "Threshold — a range, or domains"\]/.test(panel) && /type === "threshold"/.test(worker) && /volumeFlags: volumeFlagCounts\(parsed\)/.test(worker) && /renderFlagLegend\(\)/.test(panel));
}
{
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("calculator: calculated fields join the reader, computed from the fields they name at the matching step, never byte-read", /function appendCalcFields\(\)/.test(panel) && /if \(f\.calc\) \{[\s\S]{0,120}calcValues\(fieldIndex, step\)/.test(panel) && /!f\.compare && !f\.calc(?: && !f\.\w+)* \? nodeByteRange/.test(panel) && !/\beval\(|new Function\(/.test(panel));
}
{
  const analysis = readFileSync(new URL("./results-analysis-panel.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("spreadsheet: node values sortable with NaN last, paged, a row probes its node", /card\("Spreadsheet"/.test(analysis) && /if \(x !== x\) return y !== y \? 0 : 1;/.test(analysis) && /R\(\)\?\.probeNode\?\.\(i\)/.test(analysis) && /probeNode: \(node\) =>/.test(panel));
  check("media: screenshot and WebM composed with a legend footer, frames pushed by hand, the camera and step put back", /captureStream\(0\)/.test(analysis) && /track\.requestFrame\?\.\(\)/.test(analysis) && /viewer\.camera\.position\.copy\(cam\)/.test(analysis) && /function composeFrame/.test(analysis) && /async function screenshot[\s\S]{0,200}may\("save"\)/.test(analysis));
  check("threshold: the probe picks the threshold skin too", /candidates = \[t\[f\], t\[f \+ 1\], t\[f \+ 2\]\]/.test(panel));
}

{
  // Stream tracer on the Kuhn cube: a linear field is interpolated exactly, so
  // a uniform field traces a straight line and a rotation a circle.
  const { cellLocator: CL, streamlines, streamSeeds, streamlinesCsv } = await import("./gales-results.js");
  const kube = (() => {
    const coords = [];
    for (let z = 0; z < 2; z += 1) for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) coords.push(x, y, z);
    const id = (x, y, z) => x + 2 * y + 4 * z;
    const tets = [[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]].map((t) => t.map((k) => id(k & 1, (k >> 1) & 1, (k >> 2) & 1)));
    const cells = Int32Array.from(tets.flat()); const cellOffsets = Int32Array.from([0, 4, 8, 12, 16, 20, 24]);
    return { dim: 3, coords: Float64Array.from(coords), cells, cellOffsets, nodeCount: 8, cellCount: 6, bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
  })();
  const loc = CL(kube);
  const uniform = new Float64Array(24); for (let i = 0; i < 8; i += 1) uniform[i * 3] = 2;
  const lineA = streamlines(loc, uniform, Float64Array.from([0.3, 0.4, 0.6]), { step: 0.01, direction: "both" });
  const P = lineA.points; const last = lineA.counts[0] - 1;
  check("stream: a uniform field traces straight across the cube, both ways from the seed, y and z held",
    lineA.traced === 1 && P[0] < 0.011 && P[last * 3] > 0.989 && [...Array(lineA.counts[0]).keys()].every((k) => Math.abs(P[k * 3 + 1] - 0.4) < 1e-12 && Math.abs(P[k * 3 + 2] - 0.6) < 1e-12) && lineA.values.every((v) => Math.abs(v - 2) < 1e-12),
    `x ${P[0]}..${P[last * 3]}`);
  const rot = new Float64Array(24);
  for (let i = 0; i < 8; i += 1) { const x = kube.coords[i * 3] - 0.5; const y = kube.coords[i * 3 + 1] - 0.5; rot[i * 3] = -y; rot[i * 3 + 1] = x; }
  const circ = streamlines(loc, rot, Float64Array.from([0.8, 0.5, 0.5]), { step: 0.005, direction: "forward", maxLength: 2 * Math.PI * 0.3 });
  let worst = 0;
  for (let k = 0; k < circ.counts[0]; k += 1) worst = Math.max(worst, Math.abs(Math.hypot(circ.points[k * 3] - 0.5, circ.points[k * 3 + 1] - 0.5) - 0.3));
  check("stream: a rotation traces its circle (RK4 on the unit field), stopping at the length asked", circ.traced === 1 && worst < 1e-8 && /length/.test(circ.reasons[0]), `radius error ${worst}`);
  const out = streamlines(loc, uniform, Float64Array.from([2, 2, 2, 0.5, 0.5, 0.5]), { step: 0.01, direction: "forward" });
  check("stream: a seed outside the mesh is counted and not drawn; forward alone ends at the wall", out.seeded === 2 && out.traced === 1 && out.reasons[0] === "outside" && out.points[(out.counts[0] - 1) * 3] > 0.989);
  const still = streamlines(loc, new Float64Array(24), Float64Array.from([0.5, 0.5, 0.5]), { step: 0.01 });
  check("stream: a zero field stalls rather than looping", still.traced === 0 && /stalled/.test(still.reasons[0]));
  const seedsL = streamSeeds("line", { a: [0, 0, 0], b: [1, 2, 3], count: 3 });
  const seedsS = streamSeeds("sphere", { centre: [1, 1, 1], radius: 2, count: 200 });
  let outside = 0; for (let k = 0; k < 200; k += 1) if (Math.hypot(seedsS[k * 3] - 1, seedsS[k * 3 + 1] - 1, seedsS[k * 3 + 2] - 1) > 2 + 1e-12) outside += 1;
  check("stream: seeds lie on the line end to end, and inside the sphere", [...seedsL].join() === "0,0,0,0.5,1,1.5,1,2,3" && outside === 0);
  const csv = streamlinesCsv(lineA, { unit: "m/s" });
  check("stream: CSV carries line, point, arc length and magnitude", /^line,point,s_m,x,y,z,magnitude_ms$/m.test(csv) && csv.trim().split("\n").length === lineA.counts[0] + 1);
}

{
  // The stream tracer runs where the cells are, and the page keeps it with the rest of its state.
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./results-analysis-panel.js", import.meta.url), "utf8");
  check("stream: traced in the reader worker (it holds the cells), re-traced when Results moves, and saved in a state",
    /type === "stream"/.test(worker) && /streamlines\(locator, event\.data\.vec/.test(worker) &&
    /L\.stream\.on && sig \+ streamSignature\(\) !== L\.stream\.sig/.test(panel) && /stream: \{ on: L\.stream\.on/.test(panel) && /if \(L\.stream\.on\) await traceStream\(\)/.test(panel));
}

{
  const { temporalAccumulator } = await import("./gales-results.js");
  const acc = temporalAccumulator(3);
  acc.add(Float64Array.from([1, 5, NaN]), 0);
  acc.add(Float64Array.from([3, -1, NaN]), 10);
  acc.add(Float64Array.from([2, 2, NaN]), 20);
  const r = acc.result();
  check("temporal: min, max, mean and std over the steps, with the time of each extreme; an all-NaN node stays NaN",
    r[0] === 1 && r[1] === 3 && r[2] === 2 && Math.abs(r[3] - Math.sqrt(2 / 3)) < 1e-12 && r[4] === 0 && r[5] === 10 &&
    r[6] === -1 && r[7] === 5 && r[8] === 2 && r[10] === 10 && r[11] === 0 && Number.isNaN(r[12]) && Number.isNaN(r[17]) && acc.steps === 3);
  const panelSrc = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("temporal: a summary is never byte-read by the probe, never fed to the calculator, and saved in a state",
    /!f\.calc && !f\.temporal(?: && !f\.\w+)* \? nodeByteRange/.test(panelSrc) && /f\.desc && !f\.temporal && !\(f\.calc/.test(panelSrc) && /temporals: S\.temporals\.map/.test(panelSrc));
}

{
  const { selectInRect, selectionSummary } = await import("./gales-results.js");
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const coords = Float64Array.from([0, 0, 0, 0.5, 0.5, 0, -0.9, 0.2, 0, 0.3, 0.3, 2, 0.1, -0.1, 0]);
  const ids = selectInRect(coords, { matrix: I, viewProjection: I, rect: { x0: 0.6, x1: -0.2, y0: -0.5, y1: 0.6 } });
  check("selection: nodes inside the rectangle (either corner order), a node past the far plane left out", [...ids].join() === "0,1,4", [...ids].join());
  const moved = selectInRect(coords, { matrix: I, viewProjection: I, rect: { x0: -1, x1: -0.5, y0: -1, y1: 1 }, disp: Float64Array.from([-0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) });
  check("selection: the warp moves a node into the box; candidates limit the test", [...moved].join() === "0,2" && [...selectInRect(coords, { matrix: I, viewProjection: I, rect: { x0: -1, x1: 1, y0: -1, y1: 1 }, candidates: Int32Array.from([1, 4]) })].join() === "1,4");
  const P = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0]; // w = -z: behind the camera where z > 0
  check("selection: a node behind the camera is never selected", [...selectInRect(Float64Array.from([0, 0, -1, 0, 0, 1]), { matrix: I, viewProjection: P, rect: { x0: -1, x1: 1, y0: -1, y1: 1 } })].join() === "0");
  const sum = selectionSummary(Float64Array.from([1, NaN, 5, 3]), Int32Array.from([0, 1, 2]));
  check("selection: summary over the finite values of the selected nodes", sum.count === 3 && sum.finite === 2 && sum.min === 1 && sum.max === 5 && sum.mean === 3);
}

{
  const analysis = readFileSync(new URL("./results-analysis-panel.js", import.meta.url), "utf8");
  check("selection: a box drag with the orbit disabled and restored, the ending click swallowed, the spreadsheet able to keep only the selection",
    /controls\.enabled = false/.test(analysis) && /controls\.enabled = wasEnabled/.test(analysis) && /addEventListener\("click", \(e\) => \{ e\.stopPropagation\(\); e\.preventDefault\(\); \}, \{ capture: true, once: true \}\)/.test(analysis) &&
    /G\.selectionOnly && L\.sel\.ids\?\.length/.test(analysis) && /disp: results\.disp\?\.\(\)/.test(analysis));
}

{
  const panelSrc = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  check("gradient: computed in the reader worker, a vector every glyph and stream line can use, never byte-read, saved in a state",
    /type === "gradient"/.test(worker) && /nodalGradient\(mesh, new Float64Array\(event\.data\.scalar\)\)/.test(worker) &&
    /vector: \{ label: `\|∇\| of \$\{name\}`, unit, from: \[0, 1, 2\] \}/.test(panelSrc) && /!f\.temporal && !f\.gradient \? nodeByteRange/.test(panelSrc) && /gradients: S\.gradients\.map/.test(panelSrc));
}

{
  const panelSrc = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("warp by scalar: a 2D result lifted by the field shown along z, added to any displacement warp, kept in a state",
    /if \(S\.mesh\.dim === 2 && S\.warpScalar\.on && scalar\)/.test(panelSrc) && /disp\[i \* 3 \+ 2\] \+= Number\.isFinite\(v\) \? v \* k : 0/.test(panelSrc) && /warpScalar: \{ \.\.\.S\.warpScalar \}/.test(panelSrc));
}

{
  const { reflectionMatrices, reflectedBounds } = await import("./gales-results.js");
  const b = { min: [0, -5, -10], max: [4, 5, 0] };
  const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  const half = reflectionMatrices(b, { x: "min" });
  const quarter = reflectionMatrices(b, { x: "max", y: "zero" });
  check("reflect: a half model mirrors once about its plane, a quarter three times, every point the image of itself",
    half.length === 1 && apply(half[0].matrix, [3, 2, -1]).join() === "-3,2,-1" &&
    quarter.length === 3 && quarter.map((q) => q.axes).join() === "x,y,xy" && apply(quarter[2].matrix, [1, 2, -1]).join() === "7,-2,-1");
  const rb = reflectedBounds(b, { x: "max", z: "max" });
  check("reflect: the box grows to hold the copies", rb.min.join() === "0,-5,-10" && rb.max.join() === "8,5,10" && reflectionMatrices(b, {}).length === 0);
}

{
  const panelSrc = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  check("reflect: linked copies share geometry and material, read their visibility from the part they copy, are rebuilt each refresh, and the box grows with them",
    /new THREE\.Mesh\(src\.geometry, src\.material\)/.test(panelSrc) && /Object\.defineProperty\(copy, "visible", \{ get: \(\) => src\.visible/.test(panelSrc) &&
    /updateStationMarkers\(disp\);\n\s*buildMirrors\(\);/.test(panelSrc) && /reflectedBounds\(S\.mesh\.bounds, S\.mirror\)/.test(panelSrc) && /mirror: \{ \.\.\.S\.mirror \}/.test(panelSrc));
}
