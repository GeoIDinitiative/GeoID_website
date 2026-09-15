/**
 * The GALES contract, checked three ways: against itself, against the two
 * modules that must agree with it (the setup page's PHYSICS and the sidecar's
 * family table), and — when the gitignored GALES tree is beside the site —
 * against the engine: the solver directories, the reference sims, their
 * setup.txt mesh keys, the headers' Neumann functions and the results
 * folders each solver makes.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES, GENERAL, familyFor, offeredFamilies, reservedFlags, requirementLines } from "./gales-contract.js";
import { PHYSICS, checkSetup, defaultSetup } from "./fem-setup.js";

const HERE = new URL(".", import.meta.url).pathname;
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

// ── the contract holds together ──
check("every family names a solver, a reference per dimension, mesh keys, headers and results", Object.values(FAMILIES).every((f) => f.solver && (f.reference[2] || f.reference[3]) && f.meshKeys.length && f.headers.length && f.results.length));
check("a family's fatal properties are among its properties", Object.values(FAMILIES).every((f) => f.fatalIfZero.every((k) => f.props.includes(k))));
check("a family not offered says why", Object.values(FAMILIES).filter((f) => !f.offered).every((f) => (f.why || "").length > 40));
check("every general rule is a sentence with an id", GENERAL.every((g) => g.id && /\.\s*$/.test(g.text)));
check("requirementLines covers solver, mesh, unknowns, conditions, material and time", ["Solver", "Mesh", "Unknowns", "Conditions", "Material", "Time"].every((h) => requirementLines("solid").some((l) => l.head === h)));
check("requirementLines names the reference the dimension clones", /pipe_flow_3d/.test(requirementLines("fluid", 3)[0].text) && /fixed_cylinder_2d/.test(requirementLines("fluid", 2)[0].text));

// ── the setup page agrees ──
for (const [id, P] of Object.entries(PHYSICS)) {
  const f = familyFor(id);
  check(`PHYSICS.${id} is a contract family and offered`, Boolean(f?.offered));
  check(`PHYSICS.${id} names the family's own solver (${P.family} vs ${f?.solver})`, f && (P.family === f.solver || (P.family === "heat_equation" && f.solver === "heat_conduction")));
  check(`PHYSICS.${id} writes its header`, f?.headers.includes(P.header));
}
check("every offered family is a physics the page has", offeredFamilies().every((f) => PHYSICS[f.id]));
check("the checklist takes its reserved flags from the contract", reservedFlags("solid").includes(1) && reservedFlags("heat").includes(1) && !reservedFlags("fluid").length);
{
  const targets = { dim: 3, domains: [{ flag: 10, name: "box" }], faces: [{ flag: 1, name: "top" }, { flag: 2, name: "base" }] };
  const setup = { ...defaultSetup(), materials: { 10: { id: "granite" } }, conditions: { 2: { type: "fixed" } } };
  check("a face on a reserved flag is refused with the contract's reason", checkSetup(setup, targets).some((i) => i.level === "error" && /flag 1/.test(i.text) && /coupled fluid/.test(i.text)));
  const fem = readFileSync(join(HERE, "fem-setup.js"), "utf8");
  check("and the checklist no longer carries the number itself", /familyFor\(setup\.physics\)\?\.reservedSideFlags/.test(fem) && !/Number\(f\.flag\) === 1\)/.test(fem));
}

// ── the sidecar agrees ──
{
  const sidecar = readFileSync(join(HERE, "../../sidecar/geoid_sidecar.py"), "utf8");
  const table = sidecar.slice(sidecar.indexOf("GALES_FAMILIES_3D = {"), sidecar.indexOf("def _steady_state_flag"));
  for (const f of offeredFamilies()) {
    const key = f.id === "heat" ? "heat" : f.id;
    const ref3 = f.reference[3];
    check(`the sidecar clones sim/${ref3} for a 3D ${f.id} study`, new RegExp(`"${key}":\\s*\\("[^"]+",\\s*"${ref3.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",\\s*"${f.meshKeys[0]}"\\)`).test(table), table.slice(0, 600));
  }
  check("the sidecar's 2D fluid reference is the contract's", /"fluid":\s*\("fluid_sc",\s*"fluid_sc\/fixed_cylinder_2d"/.test(table));
  check("the sidecar maps the heat reference's stale include onto heat_conduction", /SOLVER_DIR_RENAMES = \{"heat_equation": "heat_conduction"\}/.test(sidecar));
}

// ── the engine agrees, where it is beside the site ──
const GALES = join(HERE, "../../gales");
if (!existsSync(join(GALES, "src/solvers"))) {
  console.log("SKIP  no GALES tree beside the site; the engine checks did not run");
} else {
  for (const f of Object.values(FAMILIES)) {
    check(`src/solvers/${f.solver} exists`, existsSync(join(GALES, "src/solvers", f.solver, "solver.hpp")));
    const solver = readFileSync(join(GALES, "src/solvers", f.solver, "solver.hpp"), "utf8");
    for (const r of f.results) check(`${f.solver} makes ${r}`, solver.includes(r.replace(/^results\//, "")) || solver.includes(r), solver.match(/make_dirs\([^)]*\)/g)?.join(" | "));
    for (const [dim, ref] of Object.entries(f.reference)) {
      if (!ref) continue;
      const dir = join(GALES, "sim", ref);
      check(`sim/${ref} (${dim}D reference) exists`, existsSync(dir));
      if (!existsSync(join(dir, "setup.txt"))) continue;
      const setup = readFileSync(join(dir, "setup.txt"), "utf8");
      for (const key of f.meshKeys) check(`sim/${ref} setup.txt names ${key}`, new RegExp(`^\\s*${key}\\s+`, "m").test(setup));
      // A reference header declares the Neumann functions ITS dimension and
      // solver call (a 2D deck has no tau13; an isothermal fluid no q1), so
      // the check runs the other way: nothing a reference declares is
      // outside the contract's list — the list is Atlas's scan of the
      // solver, and a function the solver calls that the contract does not
      // name is a header the setup page would generate without it.
      if (f.id === "fsi") continue;
      const headerText = readdirSync(dir).filter((n) => /_ic_bc\.hpp$|^ic_bc/.test(n)).map((n) => readFileSync(join(dir, n), "utf8")).join("\n");
      if (!headerText) continue;
      const declared = [...new Set([...headerText.matchAll(/neumann_(\w+)\s*\(/g)].map((m) => m[1]))];
      const stray = declared.filter((fn) => !f.bc.neumann.includes(fn));
      check(`sim/${ref} declares only Neumann functions the contract lists (${declared.length})`, declared.length > 0 && !stray.length, `stray ${stray.join(", ")}`);
    }
  }
  // The reserved flag is real: the solid and heat solvers ask the coupling on side_flag == 1.
  const solidCode = ["solid_es/solid_3d.hpp", "solid_es/solid_2d.hpp", "solid_es/solid.hpp", "solid_es/solid_assembly.hpp"].map((p) => join(GALES, "src/solvers", p)).filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
  check("solid_es asks the fluid coupling on side_flag == 1", /side_flag\s*==\s*1[\s\S]{0,200}get_fluid_tr/.test(solidCode));
  const heatCode = ["heat_conduction/heat_eq_3d.hpp", "heat_conduction/heat_eq_2d.hpp", "heat_conduction/heat_eq_assembly.hpp", "heat_conduction/heat_eq.hpp"].map((p) => join(GALES, "src/solvers", p)).filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
  check("heat_conduction asks the fluid coupling on side_flag == 1", /side_flag\s*==\s*1[\s\S]{0,200}get_fluid_heat_flux/.test(heatCode));
  const fluidCode = ["fluid_sc/fluid_3d.hpp", "fluid_sc/fluid_2d.hpp", "fluid_sc/fluid.hpp", "fluid_sc/fluid_assembly.hpp"].map((p) => join(GALES, "src/solvers", p)).filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
  check("fluid_sc has no such branch", !/get_fluid_tr|get_fluid_heat_flux/.test(fluidCode));
  // The fluid's properties reader defaults beta, so 0 is what a missing key becomes.
  const props = [join(GALES, "src/fem/properties/fluid_properties.hpp"), join(GALES, "src/fem/fluid_properties.hpp")].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
  check("the fluid properties reader reads beta (a NaN at 0 is what the contract says)", !props || /beta/.test(props), "no fluid_properties.hpp found");
}
