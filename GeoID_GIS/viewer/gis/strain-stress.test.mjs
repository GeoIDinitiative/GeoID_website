/** Strain and stress from displacement, against closed forms. */
import { derivedFields, DERIVED_COMPONENTS, lame, symmetricEigen, parseSolidProps, materialAt } from "./strain-stress.js";
import { parseGalesMesh } from "./gales-results.js";

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
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const idx = Object.fromEntries(DERIVED_COMPONENTS.map((c, i) => [c.key, i]));

// A cube of side 2, Kuhn-split, nodes at 0/2.
const coords = []; for (let i = 0; i < 8; i += 1) coords.push(2 * (i & 1), 2 * ((i >> 1) & 1), 2 * ((i >> 2) & 1));
const paths = [[1, 2, 4], [1, 4, 2], [2, 1, 4], [2, 4, 1], [4, 1, 2], [4, 2, 1]]; const cells = [];
for (const p of paths) cells.push(0, p[0], p[0] | p[1], 7);
const mesh = parseGalesMesh(["MESH! 3D", "nodes 8", "elements 6", "sides 0", "X 0 2", "Y 0 2", "Z 0 2",
  ...Array.from({ length: 8 }, (_, i) => `Node ${i} ${coords[i * 3]} ${coords[i * 3 + 1]} ${coords[i * 3 + 2]} 1`),
  ...Array.from({ length: 6 }, (_, c) => `Element ${c} 0 4 ${cells.slice(c * 4, c * 4 + 4).join(" ")} 0`)].join("\n"));

const field = (fn) => { const u = new Float64Array(24); for (let i = 0; i < 8; i += 1) u.set(fn(coords[i * 3], coords[i * 3 + 1], coords[i * 3 + 2]), i * 3); return u; };
const E = 30e9; const nu = 0.25;
const uniform = materialAt({ kind: "uniform", E, nu });
const { lambda, mu } = lame(E, nu);

// Uniaxial strain ε along z: u = (0, 0, ε z).
const eps = 1e-3;
const a = derivedFields(mesh, field((x, y, z) => [0, 0, eps * z]), 3, uniform);
const at = (res, key, node = 5) => res.values[node * res.nbDofs + idx[key]];
check("uniaxial strain: εzz exact at every node, the others zero", [...Array(8).keys()].every((i) => near(at(a, "ezz", i), eps) && Math.abs(at(a, "exx", i)) < 1e-15 && Math.abs(at(a, "exy", i)) < 1e-15));
check("uniaxial strain: σzz = (λ+2μ)ε and σxx = σyy = λε (Hooke)", near(at(a, "szz"), (lambda + 2 * mu) * eps) && near(at(a, "sxx"), lambda * eps) && near(at(a, "syy"), lambda * eps));
check("uniaxial strain: volumetric strain ε, principal σ₁ = σzz and σ₃ = σxx", near(at(a, "ev"), eps) && near(at(a, "s1"), (lambda + 2 * mu) * eps) && near(at(a, "s3"), lambda * eps));
check("uniaxial strain: von Mises = |σzz − σxx| = 2με", near(at(a, "vm"), 2 * mu * eps));

// Simple shear: u = (γ y, 0, 0) → εxy = γ/2, σxy = μγ, von Mises = √3 μγ.
const gamma = 2e-4;
const b = derivedFields(mesh, field((x, y) => [gamma * y, 0, 0]), 3, uniform);
check("simple shear: tensor εxy = γ/2, σxy = μγ, von Mises √3·μγ, no volume change", near(at(b, "exy"), gamma / 2) && near(at(b, "sxy"), mu * gamma) && near(at(b, "vm"), Math.sqrt(3) * mu * gamma) && Math.abs(at(b, "ev")) < 1e-15);
check("simple shear: principal stresses ±μγ", near(at(b, "s1"), mu * gamma) && near(at(b, "s3"), -mu * gamma));

// A rigid rotation strains nothing (small, linearised): u = ω × x about z.
const w = 1e-4;
const r = derivedFields(mesh, field((x, y) => [-w * y, w * x, 0]), 3, uniform);
check("rigid rotation: no strain, no stress", [0, 1, 2, 3, 4, 5, 12].every((j) => Math.abs(r.values[5 * r.nbDofs + j]) < 1e-6 * (j >= 6 ? E : 1) * 1e-6));

check("no material: strains still derived, stresses NaN", (() => { const s = derivedFields(mesh, field((x, y, z) => [0, 0, eps * z]), 3, null); return near(s.values[idx.ezz], eps) && Number.isNaN(s.values[idx.szz]) && s.stress === false; })());
check("a 2D mesh is refused by name", (() => { try { derivedFields({ dim: 2 }, new Float64Array(0), 2, null); return false; } catch (e) { return /2D/.test(e.message); } })());

check("eigen: a diagonal tensor sorts; a known symmetric one matches", JSON.stringify(symmetricEigen(1, 3, 2, 0, 0, 0)) === "[3,2,1]" && (() => { const e = symmetricEigen(2, 2, 2, 1, 0, 0); return near(e[0], 3) && near(e[1], 2) && near(e[2], 1); })());

// props.txt, as the Model page writes it and as the Etna reference has it.
check("props: uniform", JSON.stringify(parseSolidProps("solid\n{\n   material        Hookes\n   rho             3000.0\n   E               25.e9\n   nu              0.25\n}\n")) === JSON.stringify({ kind: "uniform", E: 25e9, nu: 0.25 }));
const layers = parseSolidProps("solid\n{\n   E 6e10\n   nu 0.25\n   heterogeneous_layers z-wise\n   {\n     layer\n     {\n        bound           -10 -2\n        rho 2900\n        E               6e+10\n        nu              0.25\n     }\n     layer\n     {\n        bound           -2 0\n        E               5e+09\n        nu              0.3\n     }\n   }\n}\n");
check("props: z-wise layers, each with its bounds and moduli", layers.kind === "layers" && layers.layers.length === 2 && layers.layers[1].E === 5e9 && materialAt(layers)([0, 0, -1]).E === 5e9 && materialAt(layers)([0, 0, -5]).nu === 0.25 && materialAt(layers)([0, 0, -2]).E === 6e10);
check("props: pointwise names its grid file", JSON.stringify(parseSolidProps("solid\n{\n   material Hookes\n   heterogeneous_pointwise\n   {\n      input_file   3d   pointwise_elasticity_data.txt\n   }\n}\n")).includes('"file":"pointwise_elasticity_data.txt"'));
check("props: not a solid, no material", parseSolidProps("heat_equation\n{\n custom\n}\n") === null);

{
  // Tilt: u = (0, 0, a x + b y) over a Kuhn-split cube -- the vertical slope is (a, b) everywhere.
  const a = 3e-6; const b = -4e-6;
  const nodes = []; for (let k = 0; k < 8; k += 1) nodes.push([k & 1, (k >> 1) & 1, (k >> 2) & 1]);
  const tets = [[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]];
  const mesh = { dim: 3, nodeCount: 8, coords: new Float64Array(nodes.flat()), cells: new Int32Array(tets.flat()), cellOffsets: new Int32Array(tets.map((_, k) => k * 4).concat(24)) };
  const u = new Float64Array(24);
  nodes.forEach(([x, y], i) => { u[i * 3 + 2] = a * x + b * y; });
  const out = derivedFields(mesh, u, 3, null);
  const K = DERIVED_COMPONENTS.length;
  const key = (k) => DERIVED_COMPONENTS.findIndex((c) => c.key === k);
  const every = (k, want) => [...Array(8).keys()].every((i) => Math.abs(out.values[i * K + key(k)] - want) < 1e-15);
  check("tilt: ∂u_z/∂x and ∂u_z/∂y of a tilted plane are its slopes at every node, and the magnitude their length", K === 19 && every("tx", a) && every("ty", b) && every("tilt", 5e-6));
  const rigid = new Float64Array(24);
  nodes.forEach(([x, y, z], i) => { rigid[i * 3] = -1e-6 * z; rigid[i * 3 + 2] = 1e-6 * x; }); // a small rigid rotation about y
  const r = derivedFields(mesh, rigid, 3, null);
  check("tilt: a rigid rotation tilts the ground but strains nothing -- the two readings are independent", Math.abs(r.values[key("tx")] - 1e-6) < 1e-15 && Math.abs(r.values[key("exz")]) < 1e-15);
}

{
  // Two tets meeting at a node with opposite tilts: the node's tilt is their average, and its magnitude the length of THAT.
  const mesh = { dim: 3, nodeCount: 5, coords: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0]), cells: new Int32Array([0, 1, 2, 3, 0, 4, 2, 3]), cellOffsets: new Int32Array([0, 4, 8]) };
  const u = new Float64Array(15);
  u[1 * 3 + 2] = 1e-6; u[4 * 3 + 2] = 1e-6; // uz = |x| near node 0: +1e-6 east of it, −1e-6 west
  const out = derivedFields(mesh, u, 3, null);
  const K = DERIVED_COMPONENTS.length;
  check("tilt: the magnitude at a node is the length of its averaged components, not the average of lengths", Math.abs(out.values[16]) < 1e-18 && Math.abs(out.values[18] - Math.hypot(out.values[16], out.values[17])) < 1e-18 && out.values[18] < 1e-12);
}

{
  const { nodalGradient } = await import("./strain-stress.js");
  const s = new Float64Array(8);
  for (let i = 0; i < 8; i += 1) s[i] = 3 * coords[i * 3] - 2 * coords[i * 3 + 1] + 0.5 * coords[i * 3 + 2] + 7;
  const g = nodalGradient(mesh, s).values;
  check("gradient: a linear scalar's gradient is exact at every node, and its magnitude", [...Array(8).keys()].every((i) => near(g[i * 4], 3) && near(g[i * 4 + 1], -2) && near(g[i * 4 + 2], 0.5) && near(g[i * 4 + 3], Math.hypot(3, -2, 0.5))));
  const holed = Float64Array.from(s); holed[7] = NaN;
  const h = nodalGradient(mesh, holed);
  check("gradient: every cell touching a NaN node is left out (all six share node 7), so no node has a gradient", h.skipped === 6 && Number.isNaN(h.values[0]));
  const tri = parseGalesMesh(["MESH! 2D", "nodes 4", "elements 2", "sides 0", "X 0 1", "Y 0 1", "Node 0 0 0 0", "Node 1 1 0 0", "Node 2 1 1 0", "Node 3 0 1 0", "Element 0 0 3 0 1 2 0", "Element 1 0 3 0 2 3 0"].join("\n"));
  const t = nodalGradient(tri, Float64Array.from([0, 2, 2 + 5, 5])).values; // s = 2x + 5y
  check("gradient: in 2D the triangles give (∂x, ∂y) and ∂z is 0", [0, 1, 2, 3].every((i) => near(t[i * 4], 2) && near(t[i * 4 + 1], 5) && t[i * 4 + 2] === 0));
}
