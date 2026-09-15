/** Tomography grids into the file GALES's pointwise solid reads. */
import { existsSync, readFileSync } from "node:fs";
import { parseTable, guessColumns, buildGrid, pointwiseText, orderCheck, sampleGrid, brocherDensity, brocherVs, elasticFromVelocity } from "./tomography.js";

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
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// A 3 × 2 × 2 grid written z-DESCENDING, x-outer: the wrong order for GALES.
const rows = [];
for (const z of [0, -1000]) for (const x of [0, 10, 20]) for (const y of [5, 15]) rows.push([x, y, z, 2000 - z / 10, 1e10 * (1 - z / 1000), 0.25 + z / 1e5]);
const text = `${rows.length}\n${rows.map((r) => r.join(" ")).join("\n")}\n`;
const table = parseTable(text);
check("parse: GALES's count line is dropped, six numeric columns kept", table.rows.length === 12 && table.width === 6 && !table.header);
const cols = guessColumns(table);
check("columns: x y z rho E nu recognised from the values", cols.kind === "elastic" && cols.x === 0 && cols.rho === 3 && cols.E === 4 && cols.nu === 5);
check("order: the file as written is not the order GALES indexes", orderCheck(table).ok === false);
const grid = buildGrid(table);
check("grid: 3 × 2 × 2, every node present", grid.ok && grid.counts.nx === 3 && grid.counts.ny === 2 && grid.counts.nz === 2);
const out = pointwiseText(grid);
const back = parseTable(out);
check("written: a count line, then rows in exactly the reader's order", out.startsWith("12\n") && orderCheck(back).ok && back.rows[0][2] === -1000 && back.rows.at(-1)[2] === 0);
check("written: every row keeps its own values", back.rows.every((r) => { const src = rows.find((s) => s[0] === r[0] && s[1] === r[1] && s[2] === r[2]); return near(src[3], r[3]) && near(src[4], r[4]) && near(src[5], r[5]); }));
const s = sampleGrid(grid, 5, 10, -500);
check("sample: GALES's trilinear interpolation (midway in z between 1e10 and 2e10)", near(s.E, 1.5e10) && near(s.rho, 2050));
const holey = parseTable(rows.slice(1).map((r) => r.join(" ")).join("\n"));
check("a grid with a missing node is refused, not shifted", buildGrid(holey).ok === false && /no row/.test(buildGrid(holey).message));
check("depth positive down becomes elevation, and km coordinates become metres", (() => { const g = buildGrid(parseTable("x y depth rho E nu\n" + rows.map((r) => [r[0], r[1], -r[2] / 1000, r[3], r[4], r[5]].join(" ")).join("\n")), { coordScale: 1000 }); return g.ok && g.z[0] === -1000 && g.z[1] === 0 && g.x[2] === 20000; })());
check("a header names the columns in any order", (() => { const t = parseTable("E rho nu z y x\n" + rows.map((r) => [r[4], r[3], r[5], r[2], r[1], r[0]].join(" ")).join("\n")); const c = guessColumns(t); return c.E === 0 && c.rho === 1 && c.x === 5 && buildGrid(t).ok; })());

// Velocities: Brocher (2005) and the dynamic moduli.
check("Brocher: Vp 6 km/s → ρ 2.717 g/cm³ and Vs 3.549 km/s", near(brocherDensity(6), 2.7167, 1e-4) && near(brocherVs(6), 3.5494, 1e-4));
const m = elasticFromVelocity(6000, 6000 / Math.sqrt(3), 2700);
check("moduli: a Poisson solid (Vp/Vs = √3) has ν 0.25 and E = 2.5 ρ Vs²", near(m.nu, 0.25) && near(m.E, 2.5 * 2700 * 12e6));
const vel = parseTable("x y z vp\n" + [0, 1].flatMap((z) => [0, 1].flatMap((y) => [0, 1].map((x) => `${x} ${y} ${z} ${6 - z}`))).join("\n"));
const vg = buildGrid(vel, { staticRatio: 0.5 });
check("velocity grid: density from Vp, Vs from Brocher when absent, E scaled by the static ratio", vg.ok && vg.kind === "velocity" && near(vg.rho[0], 2716.7, 1e-3) && near(vg.E[0], 0.5 * elasticFromVelocity(6000, brocherVs(6) * 1000, brocherDensity(6) * 1000).E, 1e-9));

// The real Etna grids, where they are on disk.
const dtgeo = new URL("../../gales/sim/solid_es/etna_3D_DTGEO/input/pointwise_elasticity_data.txt", import.meta.url);
const atlas = new URL("../../gales/sim/solid_es/etna_3d_atlas/input/pointwise_elastic_parameters.txt", import.meta.url);
if (existsSync(dtgeo) && existsSync(atlas)) {
  const d = parseTable(readFileSync(dtgeo, "utf8"));
  const a = parseTable(readFileSync(atlas, "utf8"));
  check("Etna DTGEO grid (the one a run reads) is already in GALES's order, 21 × 21 × 14", orderCheck(d).ok && buildGrid(d).counts.total === 6174);
  check("the etna_3d_atlas copy is z-DESCENDING: GALES would read it upside down", orderCheck(a).ok === false);
  const g = buildGrid(a);
  check("rebuilt, the atlas copy is in order with the stiff mantle at the bottom", orderCheck(parseTable(pointwiseText(g))).ok && g.byDepth[0].E > g.byDepth.at(-1).E && near(g.byDepth[0].z, -25000));
} else {
  check("(Etna grids not on disk: skipped)", true);
}
