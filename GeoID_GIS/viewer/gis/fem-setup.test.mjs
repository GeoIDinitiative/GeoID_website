/**
 * The model definition: materials, conditions and the study, against what
 * GALES reads.
 */
import {
  MATERIALS, materialById, PHYSICS, defaultSetup, domainProperties, materialsPlan, propsText,
  conditionCalls, icBcHeader, checkSetup, studyTimes, studySpec,
  sweepParameters, sweepValues, sweepSetups, sweepManifest,
} from "./fem-setup.js";

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

// ── materials ──
check("library: ids unique, every solid carries rho/E/nu and every fluid rho/mu, all with k and cp", new Set(MATERIALS.map((m) => m.id)).size === MATERIALS.length
  && MATERIALS.filter((m) => m.group !== "Fluid").every((m) => m.rho > 0 && m.E > 0 && m.nu >= 0 && m.nu < 0.5)
  && MATERIALS.filter((m) => m.group === "Fluid").every((m) => m.rho > 0 && m.mu > 0)
  && MATERIALS.every((m) => m.k > 0 && m.cp > 0));
check("a domain's properties are its material with edits on top", domainProperties({ id: "granite", overrides: { E: 12e9, nu: "" } }).E === 12e9 && domainProperties({ id: "granite", overrides: { nu: "" } }).nu === 0.25);

const box = (flag, name, zMin, zMax, extra = {}) => ({ flag, name, zMin, zMax, volume: (zMax - zMin) * 100, ...extra });
{
  const one = materialsPlan([box(10, "Crust", -10, 0)], { 10: { id: "basalt" } });
  check("plan: one domain is uniform", one.mode === "uniform" && one.props.E === 60e9 && !one.issues.length);
  const same = materialsPlan([box(10, "A", -10, 0), box(11, "B", 0, 5)], { 10: { id: "granite" }, 11: { id: "granite" } });
  check("plan: several domains of one material are uniform", same.mode === "uniform");
  const layers = materialsPlan([box(11, "Upper", -2, 0), box(10, "Lower", -10, -2)], { 10: { id: "basalt" }, 11: { id: "tuff" } });
  check("plan: stacked domains of different materials are z-wise layers, bottom first", layers.mode === "layers" && layers.layers[0].name === "Lower" && layers.layers[1].lo === -2 && layers.layers[1].props.E === 5e9);
  const nested = materialsPlan([box(10, "Crust", -10, 0), box(11, "Sill", -6, -4)], { 10: { id: "granite" }, 11: { id: "basalt" } });
  check("plan: overlapping domains cannot be said to GALES — uniform, and it says which material was dropped", nested.mode === "uniform" && nested.props.E === 50e9 && /Sill will not keep/.test(nested.issues.join(" ")));
  const cut = materialsPlan([box(10, "Crust", -10, 0), box(12, "Chamber", -6, -4, { void: true })], { 10: { id: "granite" } });
  check("plan: a cut (void) needs no material and does not stop uniform", cut.mode === "uniform" && !cut.issues.length);
  const none = materialsPlan([box(10, "Crust", -10, 0)], {});
  check("plan: nothing assigned says so", none.mode === "none");
}

// ── props.txt ──
{
  const plan = materialsPlan([box(11, "Upper", -2, 0), box(10, "Lower", -10, -2)], { 10: { id: "basalt" }, 11: { id: "tuff" } });
  const text = propsText("solid", plan, { dim: 3 });
  check("props: a solid block with Hookes, rho/E/nu, and z-wise layers with bounds in the reader's format", /^solid\n\{\n   material        Hookes/.test(text) && /   E               6e\+10/.test(text) && /heterogeneous_layers z-wise\n   \{\n     layer\n     \{\n        bound           -10 -2/.test(text) && text.trim().endsWith("}"));
  check("props: braces balance", (text.match(/\{/g) || []).length === (text.match(/\}/g) || []).length);
  check("props: 2D solid is plane strain", /plane_strain    T/.test(propsText("solid", { mode: "uniform", props: { rho: 1, E: 1, nu: 0.2 } }, { dim: 2 })));
  check("props: heat writes rho, cp and kappa", /heat_equation\n\{\n   custom\n   \{\n     rho             2650\n     cp              790\n     kappa           2.9/.test(propsText("heat", { props: domainProperties({ id: "granite" }) })));
  check("props: fluid writes the isothermal temperature and rho/mu", /Isothermal_T    300/.test(propsText("fluid", { props: domainProperties({ id: "water" }) }, { options: { temperature: 300 } })) && /mu             0\.001/.test(propsText("fluid", { props: domainProperties({ id: "water" }) })));
}

// ── conditions ──
{
  const calls = conditionCalls("solid", { 5: { type: "fixed" }, 2: { type: "roller", values: { axis: "z" } }, 7: { type: "pressure", values: { p: 5e7 } }, 3: { type: "displacement", values: { ux: 0.1, uy: "" } }, 8: { type: "free" } });
  check("solid: fixed holds all three, roller one axis, displacement only the components given", calls.dirichlet.ux.map((x) => x[0]).join() === "3,5" && calls.dirichlet.uz.map((x) => x[0]).join() === "2,5" && calls.dirichlet.uy.map((x) => x[0]).join() === "5" && calls.dirichlet.ux[0][1] === 0.1);
  check("solid: pressure is a neumann side-flag call; free writes nothing", calls.neumann.pressure[0].join() === "7,50000000" && !JSON.stringify(calls).includes("[8,"));
  const heat = conditionCalls("heat", { 2: { type: "temperature", values: { T: 20 } }, 4: { type: "flux", values: { q3: -0.08 } } });
  check("heat: temperature and a flux component", heat.dirichlet.T[0].join() === "2,20" && heat.neumann.q3[0].join() === "4,-0.08" && !heat.neumann.q1);
  const fluid = conditionCalls("fluid", { 1: { type: "wall" }, 6: { type: "inlet", values: { vx: 2 } }, 7: { type: "pressure", values: { p: 0 } } });
  check("fluid: wall zeros velocity, inlet sets each component, outlet sets p", fluid.dirichlet.vx.map((x) => x.join(":")).join() === "1:0,6:2" && fluid.dirichlet.p[0].join() === "7,0");
}

// ── the header ──
{
  const setup = { ...defaultSetup(), conditions: { 5: { type: "fixed" }, 4: { type: "pressure", values: { p: 5e7 } } }, options: { gravity: true } };
  const h = icBcHeader("solid", setup);
  check("header: the class GALES's solid main includes, with the engine through GALES_SRC", /class solid_ic_bc : public base_ic_bc<dim>/.test(h) && /#include "GALES_SRC\/src\/fem\/fem\.hpp"/.test(h) && /#ifndef SOLID_IC_BC_HPP/.test(h));
  check("header: every function the reference defines, dirichlet by node flag and neumann by side flag", ["initial_ux", "initial_uz", "dirichlet_ux", "dirichlet_uy", "dirichlet_uz", "neumann_tau11", "neumann_tau23", "neumann_pressure"].every((f) => h.includes(` ${f}(`)) && /if\(nd\.flag\(\) == 5\) return std::make_pair\(true, 0\.0\);/.test(h) && /if\(side_flag == 4\) return std::make_pair\(true, 50000000\.0\);/.test(h));
  check("header: gravity is a body force", /gravity\[gravity\.size\(\)-1\] = -9\.81;/.test(h));
  check("header: braces balance", (h.match(/\{/g) || []).length === (h.match(/\}/g) || []).length);
  check("header: heat and fluid have their own classes", /class heat_eq_ic_bc/.test(icBcHeader("heat", defaultSetup())) && /class fluid_ic_bc/.test(icBcHeader("fluid", defaultSetup())) && /dirichlet_vz/.test(icBcHeader("fluid", defaultSetup())));
}

// ── the checklist ──
{
  const targets = { domains: [box(10, "Crust", -10, 0)], faces: [{ flag: 1, name: "top" }, { flag: 2, name: "base" }, { flag: 5, name: "sides" }] };
  const blank = checkSetup(defaultSetup(), targets);
  check("check: a blank solid setup asks for a material and for the model to be held", blank.some((i) => i.level === "error" && i.step === "materials") && blank.some((i) => i.level === "error" && /rigid body/.test(i.text)));
  const good = { ...defaultSetup(), materials: { 10: { id: "granite" } }, conditions: { 2: { type: "fixed" } } };
  check("check: a material and a fixed base leaves no error", !checkSetup(good, targets).some((i) => i.level === "error"));
  const roller = { ...good, conditions: { 2: { type: "roller", values: { axis: "z" } } } };
  check("check: a roller alone leaves x and y free, named", checkSetup(roller, targets).some((i) => /x, y/.test(i.text)));
  const ghost = { ...good, conditions: { 2: { type: "fixed" }, 99: { type: "fixed" } } };
  check("check: a condition on a flag no face carries is named", checkSetup(ghost, targets).some((i) => /flag 99/.test(i.text)));
  const badName = { ...good, study: { ...good.study, name: "my run/1" } };
  check("check: a study name must be a folder name", checkSetup(badName, targets).some((i) => i.step === "study"));
  const badTime = { ...good, study: { ...good.study, kind: "transient", step: 0 } };
  check("check: a transient study needs a positive step", checkSetup(badTime, targets).some((i) => /time step/.test(i.text)));
}

// ── the study ──
{
  check("study: stationary is one unit step", JSON.stringify(studyTimes({ kind: "stationary" })) === JSON.stringify({ delta_t: 1, final_time: 1, print_freq: 1, steps: 1 }));
  check("study: transient counts its steps", studyTimes({ kind: "transient", step: 0.5, end: 10, printEvery: 2 }).steps === 20 && studyTimes({ kind: "transient", step: 0.5, end: 10, printEvery: 2 }).print_freq === 2);
  const setup = { ...defaultSetup(), materials: { 10: { id: "granite" } }, conditions: { 2: { type: "fixed" } } };
  const spec = studySpec(setup, { domains: [box(10, "Crust", -10, 0)], faces: [{ flag: 2, name: "base" }] }, { mesh: "m.msh" });
  check("spec: the sidecar's shape, with the generated header and props and the setup values", spec.physics === "solid" && spec.gales.family === "solid_es" && spec.gales.files["solid_ic_bc.hpp"].includes("class solid_ic_bc") && spec.gales.files["props.txt"].includes("E               5e+10") && spec.gales.setup.final_time === 1);
  check("spec: boundary entries carry the flag and the face's name", spec.boundary[0].flag === 2 && spec.boundary[0].surface === "base" && spec.boundary[0].type === "fixed");
  check("spec: heat maps to the sidecar's thermal family", studySpec({ ...setup, physics: "heat" }, { domains: [box(10, "Crust", -10, 0)], faces: [] }).physics === "thermal");
}

// ── the tree's badges ──
{
  const { setupSummary } = await import("./fem-setup.js");
  const targets = { domains: [box(10, "Crust", -10, 0), box(12, "Chamber", -6, -4, { void: true })], faces: [{ flag: 1, name: "top" }, { flag: 2, name: "base" }] };
  const blank = setupSummary(defaultSetup(), targets);
  check("summary: a void domain is not counted as needing a material, and a blank setup is an error", blank.materials.of === 1 && blank.materials.assigned === 0 && blank.materials.level === "error" && blank.study.level === "error");
  const good = setupSummary({ ...defaultSetup(), materials: { 10: { id: "granite" } }, conditions: { 2: { type: "fixed" }, 1: { type: "free" }, 99: { type: "fixed" } } }, targets);
  check("summary: only a real condition on a face the model carries counts, and a solvable setup has no errors", good.physics.set === 1 && good.physics.of === 2 && good.materials.level === "ok" && good.study.errors === 0 && good.study.warnings >= 1);
}

// ── the page half, pinned on the source ──
{
  const { readFileSync } = await import("node:fs");
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const index = read("../index.html");
  const shell = read("./shell.html");
  const panel = read("./studio-setup-panel.js");
  const block = (s) => s.slice(s.indexOf('data-group="materials"'), s.indexOf('data-group="mesh"'));
  check("tree: Materials, Physics and Study sit between the build tabs and Mesh, identical on both pages", block(index).length > 200 && block(index) === block(shell) && ["materials", "physics", "study"].every((g) => block(index).includes(`id="studio-${g}-host"`)));
  check("tree: the three share one band, and the studio restores it", /data-group="study" data-deck="left" data-band="physics"/.test(index) && /\["build", "physics", "mesh"(, "[a-z]+")*\]\.forEach/.test(read("./model-studio.js")));
  check("loaded on the Earth page and the planets", /mesh-quality-panel\.js\?v=[^"]+"><\/script>\n<script type="module" src="gis\/studio-setup-panel\.js/.test(index) && /"\.\/studio-setup-panel\.js",/.test(read("./boot.js")));
  check("the study's mesh is the model's own gmsh script, named for the study", /gmshScriptFor: \(name\) =>/.test(read("./model-studio.js")) && /gmshScriptFor\?\.\(name\)/.test(panel));
  check("a local solve asks first; a compute target does not", /if \(!target && !window\.confirm\(/.test(panel));
  check("style: the tree's look comes from studio-ui.css, not a style block of its own", !panel.includes("const STYLE = `"));
}

// ── a tomography grid in place of the domains' materials ──
{
  const { propsText: pt, checkSetup: cs, studySpec: ss } = await import("./fem-setup.js");
  const pointwise = { file: "pointwise_elasticity_data.txt", dim: 3, bounds: { min: [0, 0, -25000], max: [48000, 48000, 2000] } };
  const text = pt("solid", { mode: "none" }, { dim: 3, pointwise });
  check("props: a grid writes GALES's heterogeneous_pointwise block, as the Etna DTGEO deck has it", /heterogeneous_pointwise\n   \{\n      input_file   3d   pointwise_elasticity_data\.txt\n   \}/.test(text) && (text.match(/\{/g) || []).length === (text.match(/\}/g) || []).length);
  const targets = { dim: 3, domains: [box(10, "Crust", -30000, 3000)], faces: [{ flag: 2, name: "base" }] };
  const withGrid = { ...defaultSetup(), pointwise, conditions: { 2: { type: "fixed" } } };
  const issues = cs(withGrid, targets);
  check("check: a grid stands in for a material, and a model reaching past the grid is said", !issues.some((i) => i.level === "error") && issues.some((i) => /beyond the grid/.test(i.text)));
  check("check: a grid under heat or fluid physics is an error", cs({ ...withGrid, physics: "heat" }, targets).some((i) => i.level === "error" && /only the solid/.test(i.text)));
  check("check: a 2D grid on a 3D model is an error", cs({ ...withGrid, pointwise: { ...pointwise, dim: 2 } }, targets).some((i) => i.level === "error" && /2D/.test(i.text)));
  const spec = ss(withGrid, targets, { mesh: "m.msh" });
  check("spec: the plan says pointwise and props.txt carries the block", spec.materials.plan === "pointwise" && spec.materials.pointwise.file === pointwise.file && /heterogeneous_pointwise/.test(spec.gales.files["props.txt"]));
}

{
  const setup = { ...defaultSetup(), materials: { 10: { id: "basalt" } }, conditions: { 2: { type: "fixed", values: {} }, 4: { type: "pressure", values: { p: 1e7 } } } };
  const targets = { dim: 3, domains: [{ flag: 10, name: "Crust" }, { flag: 11, name: "Chamber", void: true }], faces: [{ flag: 2, name: "base" }, { flag: 4, name: "chamber wall" }] };
  const params = sweepParameters(setup, targets);
  check("sweep: a material's properties and a set condition's numbers are the parameters, not a void or a fixed face", params.map((p) => p.key).join() === "mat:10:rho,mat:10:E,mat:10:nu,bc:4:p" && params.find((p) => p.key === "bc:4:p").base === 1e7 && params.find((p) => p.key === "mat:10:E").base === 60e9);
  check("sweep values: linear ends exactly on its ends", sweepValues({ from: 5e6, to: 2e7, count: 4 }).values.join() === "5000000,10000000,15000000,20000000");
  check("sweep values: log by equal ratios", sweepValues({ from: 1e9, to: 1e11, count: 3, scale: "log" }).values.join() === "1000000000,10000000000,100000000000");
  check("sweep values: a typed list, and refusals said in words", sweepValues({ mode: "list", text: "1, 2.5;4" }).values.join() === "1,2.5,4" && /numbers/.test(sweepValues({ mode: "list", text: "1, x" }).error) && /above zero/.test(sweepValues({ from: 0, to: 1, scale: "log" }).error) && /2 and 50/.test(sweepValues({ from: 0, to: 1, count: 1 }).error));
  const runs = sweepSetups(setup, "bc:4:p", [5e6, 2e7], "etna");
  check("sweep setups: each run is a copy with one value set and its own name", runs.map((r) => r.name).join() === "etna_sweep_0,etna_sweep_1" && runs[1].setup.conditions[4].values.p === 2e7 && runs[1].setup.study.name === "etna_sweep_1" && setup.conditions[4].values.p === 1e7);
  const mat = sweepSetups(setup, "mat:10:E", [3e10, 4e10]);
  check("sweep setups: a material value is an override, and it reaches the generated props", mat[0].setup.materials[10].overrides.E === 3e10 && domainProperties(mat[0].setup.materials[10]).E === 3e10 && /E\s+3\.?0*e\+?10|30000000000/.test(studySpec(mat[0].setup, targets, { mesh: "m.msh" }).gales.files["props.txt"]));
  const m = sweepManifest({ base: "etna", parameter: "bc:4:p", label: "chamber wall — pressure", values: [5e6, 2e7], runs, written_at: "t" });
  check("sweep manifest: the parameter, the values and each run's folder", m.kind === "geoid-sweep" && m.runs[1].dir === "fem_runs/etna_sweep_1" && m.values.length === 2);
}
