/** ParaView's formats read back as VTK wrote them: every encoding, a time series, cells reduced to tets. */
import { readFileSync } from "node:fs";
import { readVtu, vtuHead, parsePvd, isVtkXml, vtkCellsToRawMesh, vtkFieldName, flagArrayOf } from "./vtk-read.js";
import { vtuParts } from "./vtk-export.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass += 1; else failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/vtk/${name}`, import.meta.url)));
// The fixtures were written by python vtk 9.2 from a 4 x 3 x 3 grid of hexes at 10 x 10 x 5 m:
// displacement = (0.01 x, 0, -0.02 z), temperature = 300 + z, material 1 below z = 5, 2 above.
const expectPoint = (g, i) => {
  const x = g.points[i * 3]; const z = g.points[i * 3 + 2];
  const d = g.pointData.find((a) => a.name === "displacement").values;
  const t = g.pointData.find((a) => a.name === "temperature").values;
  return Math.abs(d[i * 3] - 0.01 * x) < 1e-12 && d[i * 3 + 1] === 0 && Math.abs(d[i * 3 + 2] + 0.02 * z) < 1e-12 && Math.abs(t[i] - (300 + z)) < 1e-12;
};
for (const name of ["ascii.vtu", "binary.vtu", "binary_z.vtu", "appended_raw.vtu", "appended_b64_z.vtu", "appended_raw_z64.vtu"]) {
  const g = await readVtu(fixture(name), { pointData: true });
  const allPoints = [...Array(36).keys()].every((i) => expectPoint(g, i));
  const mat = g.cellData.find((a) => a.name === "material");
  check(`vtu ${name}: 36 points, 12 hexes, every point's displacement and temperature, and the material`,
    g.points.length === 108 && g.types.length === 12 && [...g.types].every((t) => t === 12) && g.offsets[11] === 96 && allPoints && mat && [...mat.values].join() === "1,1,1,1,1,1,2,2,2,2,2,2",
    `${g.points.length} ${g.types.length} ${allPoints}`);
}
check("vtu: the head names the arrays, their components and the compressor without decoding", (() => {
  const h = vtuHead(fixture("appended_raw_z64.vtu"));
  return h.points === 36 && h.cells === 12 && h.headerBytes === 8 && h.compressed && h.pointData.map((a) => `${a.name}:${a.components}`).join() === "displacement:3,temperature:1";
})());

// Our own writer reads back through the general reader too.
const own = (() => {
  const { parts } = vtuParts({
    points: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
    cells: { connectivity: Int32Array.from([0, 1, 2, 3]), offsets: Int32Array.from([4]), types: Uint8Array.from([10]) },
    pointData: [{ name: "solid_u", components: 3, values: Float64Array.from([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) }],
    cellData: [{ name: "volume_flag", components: 1, values: Int32Array.from([7]) }],
  });
  const chunks = parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : new Uint8Array(p.buffer ? p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength) : p)));
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
})();
const g = await readVtu(own, { pointData: true });
check("vtu: the Model page's own export reads back (appended raw, UInt64 headers)", isVtkXml(own) && g.pointData[0].values[11] === 9 && g.cellData[0].values[0] === 7 && flagArrayOf(g.cellData).name === "volume_flag");

const hexGrid = await readVtu(fixture("binary_z.vtu"), {});
const { raw, counts, flagArray } = vtkCellsToRawMesh(hexGrid);
let vol = 0;
for (let c = 0; c + 1 < raw.cellOffsets.length; c += 1) {
  const n = [...raw.cells.subarray(raw.cellOffsets[c], raw.cellOffsets[c + 1])];
  const P = (i) => [raw.coords[i * 3], raw.coords[i * 3 + 1], raw.coords[i * 3 + 2]];
  const [a, b, cc, d] = n.map(P);
  const u = b.map((v, k) => v - a[k]); const v = cc.map((x, k) => x - a[k]); const w = d.map((x, k) => x - a[k]);
  vol += Math.abs(u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0])) / 6;
}
check("cells: 12 hexes become 72 tets filling the 30 x 20 x 10 m block exactly, each carrying its material flag",
  raw.dim === 3 && counts.hex === 12 && raw.cellFlag.length === 72 && Math.abs(vol - 6000) < 1e-9 && flagArray === "material" && raw.cellFlag[0] === 1 && raw.cellFlag[71] === 2, `vol ${vol}`);

const mixed = vtkCellsToRawMesh({
  points: new Float64Array(3 * 8), connectivity: Float64Array.from([0, 1, 2, 3, 4, 0, 1, 2, 3, 5, 6, 7, 5, 6]),
  offsets: Float64Array.from([5, 9, 12, 14]), types: Uint8Array.from([14, 9, 5, 3]), cellData: [],
});
check("cells: a pyramid is 2 tets, a quad in a 3D grid 2 flagged sides, a triangle a side, a line skipped", mixed.counts.pyramid === 1 && mixed.raw.cellFlag.length === 2 && mixed.raw.sideFlag.length === 3 && mixed.counts.skipped === 1);
const flat = vtkCellsToRawMesh({ points: new Float64Array(12), connectivity: Float64Array.from([0, 1, 2, 3]), offsets: Float64Array.from([4]), types: Uint8Array.from([9]), cellData: [] });
check("cells: a grid of only quads is a 2D mesh of triangles", flat.raw.dim === 2 && flat.raw.cellFlag.length === 2);

const pvd = parsePvd(new TextDecoder().decode(fixture("series.pvd")));
check("pvd: datasets in time order with their files", pvd.length === 2 && pvd[0].file === "s_0.vtu" && pvd[1].time === 2.5);
const s1 = await readVtu(fixture("s_1.vtu"), { pointData: ["displacement"] });
check("pvd: the second step's displacement is twice the first's, and only the arrays asked for are decoded", s1.pointData.length === 1 && Math.abs(s1.pointData[0].values[17 * 3] - 0.2) < 1e-12);
check("names: displacement-like arrays read as u, velocity as v, others path-safe", vtkFieldName("displacement", 3) === "displacement/u" && vtkFieldName("U", 3) === "U/u" && vtkFieldName("velocity", 3) === "velocity/v" && vtkFieldName("von Mises (Pa)", 1) === "von_Mises_Pa" && vtkFieldName("displacement", 1) === "displacement");
let refused = "";
try { vtuHead(new TextEncoder().encode('<?xml version="1.0"?><VTKFile type="PolyData"><PolyData/></VTKFile>')); } catch (e) { refused = e.message; }
check("refusals say what to do: a PolyData is not an unstructured grid", /not an unstructured grid/.test(refused));

{
  const worker = readFileSync(new URL("./gales-worker.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./gales-results-panel.js", import.meta.url), "utf8");
  const results = readFileSync(new URL("./gales-results.js", import.meta.url), "utf8");
  check("wiring: the reader worker reads a VTK grid as a mesh, the plan counts a .vtu as a mesh, and every door opens VTK",
    /if \(isVtkFile\(bytes\)\)/.test(worker) && /meshFromRaw\(made\.raw\)/.test(worker) && /\\\.\(txt\|msh\|vtu\|vtk\)\$/.test(results) &&
    /openFolder: \(files\) => \(\[\.\.\.files\]\.some\(isVtkFile\)/.test(panel) && /accept: "\.txt,\.msh,\.vtu,\.vtk,\.pvd"/.test(panel) && /files\.some\(isVtkFile\)\) \{ openVtk/.test(panel));
}

{
  const { readLegacyVtk, readVtkGrid, isVtkFile } = await import("./vtk-read.js");
  for (const name of ["legacy_ascii.vtk", "legacy_binary.vtk", "legacy_ascii_42.vtk"]) {
    const bytes = fixture(name);
    const g = await readVtkGrid(bytes, { pointData: true });
    const d = g.pointData.find((a) => a.name === "displacement")?.values;
    const t = g.pointData.find((a) => a.name === "temperature")?.values;
    const mat = g.cellData.find((a) => a.name === "material");
    const ok = isVtkFile(bytes) && g.points.length === 108 && g.types.length === 12 && g.offsets.length === 12 && g.offsets[11] === 96 && g.connectivity.length === 96 &&
      [...Array(36).keys()].every((i) => Math.abs(d[i * 3] - 0.02 * g.points[i * 3]) < 1e-12 && Math.abs(d[i * 3 + 2] + 0.04 * g.points[i * 3 + 2]) < 1e-12 && Math.abs(t[i] - (300 + g.points[i * 3 + 2])) < 1e-12) &&
      mat && [...mat.values].join() === "1,1,1,1,1,1,2,2,2,2,2,2";
    check(`legacy ${name}: points, 12 hexes, the doubled displacement, temperature and material`, ok);
  }
  const g = await readVtkGrid(fixture("legacy_binary.vtk"), {});
  const xml = await readVtkGrid(fixture("s_1.vtu"), {});
  check("legacy: the binary file's cells are the XML file's cells, node for node", [...g.connectivity].join() === [...xml.connectivity].join() && [...g.offsets].join() === [...xml.offsets].join());
  let refused = "";
  try { readLegacyVtk(new TextEncoder().encode("# vtk DataFile Version 3.0\nt\nASCII\nDATASET STRUCTURED_POINTS\n")); } catch (e) { refused = e.message; }
  check("legacy: a structured dataset is refused by name", /STRUCTURED_POINTS is not an unstructured grid/.test(refused));
}
