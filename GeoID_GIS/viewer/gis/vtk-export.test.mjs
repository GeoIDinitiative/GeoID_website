/**
 * VTK export against a mesh whose every number is known: two tets sharing a
 * face, a displacement per node, and a volume flag per cell, written and read
 * back byte for byte.
 */
import { vtkCellType, vtkCells, vtuParts, pvdText, fieldArrays, readVtu } from "./vtk-export.js";
import { describeField } from "./gales-results.js";

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

const join = (parts) => {
  const size = parts.reduce((a, p) => a + p.byteLength, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
};

check("cell types: a tet is 10 in 3D and a quad is 9 in 2D, and a boundary triangle in 3D is no cell", vtkCellType(4, 3) === 10 && vtkCellType(4, 2) === 9 && vtkCellType(3, 3) === 0 && vtkCellType(8, 3) === 12 && vtkCellType(3, 2) === 5);

// Two tets and one boundary triangle mixed into the cell list, as a 3D GALES mesh can carry.
const coords = new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]);
const cells = new Int32Array([0, 1, 2, 3, 1, 2, 3, 4, 0, 1, 2]);
const cellOffsets = new Int32Array([0, 4, 8, 11]);
const vc = vtkCells(cells, cellOffsets, 3);
check("cells: only the mesh's own dimension, with END offsets and their source cells", vc.count === 2 && vc.offsets.join() === "4,8" && vc.types.join() === "10,10" && vc.source.join() === "0,1" && vc.connectivity.join() === "0,1,2,3,1,2,3,4");

const desc = describeField("solid/u", 3, 3);
const u = new Float64Array(15);
for (let i = 0; i < 5; i += 1) { u[i * 3] = i; u[i * 3 + 1] = -i; u[i * 3 + 2] = 10 * i; }
const arrays = fieldArrays(desc, u, 5, 3);
check("field arrays: a displacement is ONE three-component array named solid_u", arrays.length === 1 && arrays[0].name === "solid_u" && arrays[0].components === 3 && arrays[0].values[4 * 3 + 2] === 40 && arrays[0].values instanceof Float64Array);

const blocked = describeField("fluid_mesh", 2, 2);
const b = new Float64Array([0, 1, 2, 10, 11, 12]); // all x, then all y
const ba = fieldArrays({ ...blocked, nbDofs: 2 }, b, 3, 2);
check("field arrays: a field written by component is re-interleaved", ba[0].components === 3 && Array.from(ba[0].values).join() === "0,10,0,1,11,0,2,12,0");

const fluid = describeField("fluid_dofs", 5, 3);
const fa = fieldArrays(fluid, new Float64Array(5 * 2).map((_, k) => k), 2, 3);
check("field arrays: fluid velocity is a vector beside scalar pressure and temperature", fa.map((a) => `${a.name}:${a.components}`).join() === "fluid_dofs_v:3,fluid_dofs_p:1,fluid_dofs_T:1");

const { parts, bytes } = vtuParts({
  points: coords, cells: vc, time: 2.5,
  pointData: arrays,
  cellData: [{ name: "volume_flag", components: 1, values: new Int32Array([10, 20]) }],
});
const file = join(parts);
check("vtu: the bytes promised are the bytes written", file.byteLength === bytes);
const back = readVtu(file);
check("vtu: points and cells counted in the piece", back.points === 5 && back.cells === 2);
check("vtu: coordinates, connectivity, offsets and types read back exactly", Array.from(back.arrays.Points.values).join() === Array.from(coords).join() && Array.from(back.arrays.connectivity.values).join() === "0,1,2,3,1,2,3,4" && Array.from(back.arrays.offsets.values).join() === "4,8" && Array.from(back.arrays.types.values).join() === "10,10");
check("vtu: point and cell data read back, and the time", back.arrays.solid_u.components === 3 && back.arrays.solid_u.values[14] === 40 && Array.from(back.arrays.volume_flag.values).join() === "10,20" && back.arrays.TimeValue.values[0] === 2.5);
check("vtu: raw appended binary with UInt64 headers, which ParaView reads without decoding", /header_type="UInt64"/.test(back.xml) && /<AppendedData encoding="raw">/.test(back.xml));

let threw = false;
try { vtuParts({ points: coords, cells: vc, pointData: [{ name: "bad", components: 3, values: new Float32Array(4) }] }); } catch (e) { threw = /bad/.test(e.message); }
check("vtu: an array of the wrong length is refused, not written misaligned", threw);

const pvd = pvdText([{ time: 0, file: "run_0.vtu" }, { time: 1.5, file: "run_1.vtu" }]);
check("pvd: a collection naming each step's file and time", /<DataSet timestep="1.5" group="" part="0" file="run_1.vtu"\/>/.test(pvd) && /type="Collection"/.test(pvd));
