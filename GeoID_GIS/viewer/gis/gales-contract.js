/**
 * WHAT GALES NEEDS, STATED ONCE.
 *
 * GALES is the finite-element engine behind every solve this page runs, and
 * its requirements were scattered: the family table in the sidecar, the
 * reserved side flag in the checklist, the fluid's beta in the material
 * library, the mesh partition rule in the Study tab's prose, the results
 * layout in the reader. Each was learned by a solve failing. This module is
 * the one place they are written down, in the shape the rest of the pipeline
 * reads: the checklist takes its reserved flags and required properties from
 * here, the Study tab draws "What GALES needs" from here, the sidecar's
 * family table is pinned against it, and the test checks it against the GALES
 * tree itself whenever the tree is beside the site.
 *
 * The per-solver facts (dofs, boundary-condition markers, setup keys, mesh
 * keys) are Atlas AI's own solver index (`GeoID_Research/metadata/
 * solver_index.json`, scanned from `src/solvers`), carried here verbatim so
 * the two apps describe one engine. What Atlas cannot know — which flag is
 * reserved, which property must not be zero, how the time step is bounded —
 * is what this page measured, and each such line says what was measured.
 */

/** Rules that hold for every family. Each is a sentence a reader can act on. */
export const GENERAL = [
  { id: "executable", text: "A GALES simulation is a compiled executable, not a deck file: the reference sim is cloned, its main.cpp and *_ic_bc.hpp are compiled against the engine, and `mpirun -n N ./executable` reads setup.txt and props.txt from the run folder." },
  { id: "build-where-it-runs", text: "The executable is bound to the MPI and Trilinos it was linked against, so it is built on the machine that runs it. A container or ssh target builds from the sources the run carries; nothing built here is shipped." },
  { id: "mesh-partition", text: "The mesh is converted per rank count: gales_mesh.py N writes input/<mesh>_Ncore.txt and setup.txt names that file. A stale rank count partitions the mesh for the wrong number of processes." },
  { id: "flags", text: "A boundary condition is compiled, not read: dirichlet_<dof>(node) is keyed on the NODE flag, neumann_<fn>(sides, side_flag) on the SIDE flag. gmsh_to_gales.py takes each entity's physical TAG from $Entities — a name is not a flag — and refuses a $PhysicalNames block." },
  { id: "flag-inheritance", text: "A physical group on a face does not reach its curves and points; every face, edge, corner and embedded point needs a tag, and the lowest flag owns a shared edge." },
  { id: "results", text: "Results are results/<field>/<time>: raw little-endian float64, nodes × dofs per node, a node's dofs together. GALES removes none of them, so a shorter re-run leaves the earlier steps beside the new; this page moves the previous results aside before a solve." },
  { id: "props-defaults", text: "The properties reader defaults any key it does not find to 0. A missing property is not an error; it is a wrong number." },
];

/**
 * The families. `id` is the physics the setup page names; `solver` the
 * directory under src/solvers; `reference` the sim cloned per dimension;
 * `meshKeys` the setup.txt keys that name the mesh. `dofs`, `bc` and
 * `setupKeys` are Atlas's scan. `props` are the keys props.txt must carry
 * for this family and `fatalIfZero` those where the reader's 0 default is a
 * NaN. `reservedSideFlags` name what the solver treats as a coupling
 * interface. `offered` says whether the setup page can write it today, and
 * `why` where it cannot.
 */
export const FAMILIES = {
  solid: {
    id: "solid", label: "Solid mechanics — linear elastic, static", solver: "solid_es",
    // mogi_test_2d holds an ic_bc.txt and no main.cpp: it cannot be cloned. A
    // 2D solid study clones the 3D reference and is patched to dim 2; the
    // page's own header and props.txt (plane strain) replace the reference's.
    reference: { 2: "solid_es/mogi_test_3d", 3: "solid_es/mogi_test_3d" },
    meshKeys: ["solid_mesh_file"],
    dofs: ["ux", "uy", "uz"],
    bc: { initial: ["ux", "uy", "uz"], dirichlet: ["ux", "uy", "uz"], neumann: ["pressure", "tau11", "tau12", "tau13", "tau22", "tau23", "tau33"] },
    setupKeys: ["delta_t", "dim", "end_time", "precision", "print_freq", "print_rho_E_nu", "restart", "restart_time", "solid_mesh_file"],
    results: ["results/solid/u"],
    headers: ["solid_ic_bc.hpp"],
    props: ["rho", "E", "nu"], fatalIfZero: ["E"],
    reservedSideFlags: [{ flag: 1, why: "the interface to a coupled fluid: get_fluid_tr is asked for a traction there, and with no fluid the solver segfaults at its first step (measured)" }],
    time: "Pseudo-time: a static solve is one step of length one. A transient study runs the same static solve per step.",
    stability: [],
    offered: true,
  },
  heat: {
    id: "heat", label: "Heat conduction", solver: "heat_conduction",
    reference: { 2: "heat_equation/test_3d", 3: "heat_equation/test_3d" },
    meshKeys: ["heat_eq_mesh_file"],
    dofs: ["T"],
    bc: { initial: ["T"], dirichlet: ["T"], neumann: ["q1", "q2", "q3"] },
    setupKeys: ["Gen_alpha", "N", "adaptive_time_step", "delta_t", "dim", "end_time", "heat_eq_mesh_file", "n_max_it", "precision", "print_freq", "restart", "restart_time"],
    results: ["results/heat_eq/T"],
    headers: ["heat_eq_ic_bc.hpp"],
    props: ["rho", "cp", "kappa"], fatalIfZero: ["rho", "cp", "kappa"],
    reservedSideFlags: [{ flag: 1, why: "the interface to a coupled fluid: get_fluid_heat_flux is asked for a heat flux there, and with no fluid the solver stops as the solid's does" }],
    time: "BDF1 in time. The first step is implicit Euler's own error at that Δt and decays (measured 2–3 °C high on a 20,000 s step against the analytic slab).",
    stability: ["The reference sim under sim/heat_equation includes src/solvers/heat_equation, which is heat_conduction now; prepare maps the include onto the directory that exists."],
    offered: true,
  },
  fluid: {
    id: "fluid", label: "Laminar flow — weakly compressible, isothermal", solver: "fluid_sc",
    reference: { 2: "fluid_sc/fixed_cylinder_2d", 3: "fluid_sc/pipe_flow_3d" },
    meshKeys: ["fluid_mesh_file"],
    dofs: ["p", "vx", "vy", "vz"],
    bc: { initial: ["T", "p", "vx", "vy", "vz"], dirichlet: ["T", "p", "vx", "vy", "vz"], neumann: ["q1", "q2", "q3", "tau11", "tau12", "tau13", "tau22", "tau23", "tau33"] },
    setupKeys: ["Gen_alpha", "N", "adaptive_time_step", "delta_t", "dim", "end_time", "fluid_mesh_file", "isothermal", "n_max_it", "pp_delta_t", "pp_final_time", "pp_start_time", "precision", "print_freq", "restart", "restart_time"],
    results: ["results/fluid_dofs"],
    headers: ["fluid_ic_bc.hpp"],
    props: ["rho", "mu", "cp", "kappa", "alpha", "beta"], fatalIfZero: ["rho", "beta"],
    reservedSideFlags: [],
    time: "Weakly compressible: the sound speed is c = 1/√(ρβ), and the time step is bounded by the acoustics, not the flow. Measured: 75 sound transits of the model per step ran; 75,000 diverged by the sixth step.",
    stability: [
      "beta = 0 (the reader's default) is an infinite sound speed and a NaN at the first solve: every fluid material must carry alpha and beta.",
      "steady_state T drops the time term from the stabilisation; a transient study is prepared with F.",
      "The 2D reference (fixed_cylinder_2d) defines the 2D stresses and preconditions with MueLu; the 3D reference (pipe_flow_3d) is the one a 3D spec clones.",
    ],
    offered: true,
  },
  thermoelastic: {
    id: "thermoelastic", label: "Thermoelasticity — solid stressed by its temperature field", solver: "thermoelasticity",
    reference: { 2: "thermoelasticity/beam_clamped_cubic", 3: "thermoelasticity/suddenly_heated_sphere" },
    meshKeys: ["solid_mesh_file", "heat_eq_mesh_file"],
    dofs: ["ux", "uy", "uz", "T"],
    bc: { initial: ["T", "ux", "uy", "uz"], dirichlet: ["T", "ux", "uy", "uz"], neumann: ["pressure", "q1", "q2", "q3", "tau11", "tau12", "tau13", "tau22", "tau23", "tau33"] },
    setupKeys: ["Gen_alpha", "delta_t", "dim", "end_time", "heat_eq_mesh_file", "n_max_it", "pp_delta_t", "pp_final_time", "pp_start_time", "precision", "print_freq", "print_rho_E_nu", "restart", "restart_time", "solid_mesh_file"],
    results: ["results/solid/u", "results/heat_eq/T"],
    headers: ["solid_ic_bc.hpp", "heat_eq_ic_bc.hpp"],
    props: ["rho", "E", "nu", "alpha", "T_ref", "cp", "kappa"], fatalIfZero: ["E", "cp", "kappa"],
    reservedSideFlags: [{ flag: 1, why: "the same coupled-fluid interface as the solid's" }],
    time: "One mesh, two solvers per step: the temperature field, then the solid with the thermal strain α(T − T_ref).",
    stability: ["Two headers, one per component; a face carries a mechanical condition AND a thermal one."],
    offered: false,
    why: "The setup page gives a face one condition; thermoelasticity needs two per face (a displacement and a temperature). Its deck is otherwise the solid's and the heat's side by side, and the contract above is what the setup page will write against.",
  },
  solid_dynamic: {
    id: "solid_dynamic", label: "Solid dynamics — elastodynamic, generalised-α", solver: "solid_ed",
    reference: { 2: "solid_ed/uniaxial_bar", 3: "solid_ed/plate_under_gravity_3d" },
    meshKeys: ["solid_mesh_file"],
    dofs: ["ux", "uy", "uz", "vx", "vy", "vz"],
    bc: { initial: ["ux", "uy", "uz", "vx", "vy", "vz"], dirichlet: ["ux", "uy", "uz"], neumann: ["pressure", "tau11", "tau12", "tau13", "tau21", "tau22", "tau23", "tau31", "tau32", "tau33"] },
    setupKeys: ["N", "adaptive_time_step", "delta_t", "dim", "end_time", "n_max_it", "precision", "print_freq", "restart", "restart_time", "solid_mesh_file"],
    results: ["results/solid/u", "results/solid/v", "results/solid/a"],
    headers: ["solid_ic_bc.hpp"],
    props: ["rho", "E", "nu", "a_damping", "b_damping"], fatalIfZero: ["rho", "E"],
    reservedSideFlags: [],
    time: "Generalised-α (rho_inf in setup.txt); writes displacement, velocity and acceleration per step.",
    stability: ["The time step is bounded by the elastic wave speed √(E/ρ) over the element size."],
    offered: false,
    why: "Not written by the setup page yet: it needs rho_inf, constant_v and zero_a in setup.txt and the damping pair in props.txt, none of which the page asks for.",
  },
  fsi: {
    id: "fsi", label: "Fluid–structure interaction", solver: "fsi/sc_ed",
    reference: { 2: "fsi/fsi", 3: null },
    meshKeys: ["fluid_mesh_file", "solid_mesh_file"],
    dofs: [],
    bc: { initial: [], dirichlet: [], neumann: [] },
    setupKeys: ["Gen_alpha", "delta_t", "dim", "end_time", "n_max_it", "precision", "print_freq", "restart", "restart_time"],
    results: ["results/fluid_dofs", "results/fluid_mesh", "results/solid/u"],
    headers: ["fluid_ic_bc.hpp", "solid_ic_bc.hpp"],
    props: [], fatalIfZero: [],
    reservedSideFlags: [{ flag: 1, why: "IS the interface: the fluid and the solid meet on the sides both meshes flag 1" }],
    time: "Two meshes advanced together; the fluid mesh moves (results/fluid_mesh is written by component).",
    stability: [],
    offered: false,
    why: "Two meshes sharing an interface, which neither the studio nor the Model Builder writes; a spec asking for it is prepared as a solid deck and says so.",
  },
};

/** The family for a setup page physics id, or null. */
export function familyFor(physics) {
  return FAMILIES[physics] || null;
}

/** The families the setup page can write today. */
export function offeredFamilies() {
  return Object.values(FAMILIES).filter((f) => f.offered);
}

/** The side flags this family reserves, as numbers. */
export function reservedFlags(physics) {
  return (familyFor(physics)?.reservedSideFlags || []).map((r) => r.flag);
}

/**
 * The family's requirements as lines for the Study tab: what the sidecar will
 * clone, what the mesh must carry, what the material must carry, what is
 * reserved, and what bounds the time step. Pure, so the card and the test
 * read one text.
 */
export function requirementLines(physics, dim = 3) {
  const f = familyFor(physics);
  if (!f) return [];
  const ref = f.reference[dim] || f.reference[3] || f.reference[2];
  const lines = [
    { head: "Solver", text: `src/solvers/${f.solver}, cloned from sim/${ref || "—"}${f.reference[2] && f.reference[3] && f.reference[2] !== f.reference[3] ? ` (${dim}D; the ${dim === 3 ? "2D" : "3D"} reference is ${f.reference[dim === 3 ? 2 : 3]})` : ""}.` },
    { head: "Mesh", text: `${f.meshKeys.join(" and ")} in setup.txt name <mesh>_<ranks>core.txt, written by gales_mesh.py from the run's .msh; every face, edge, corner and embedded point carries a physical tag.` },
    { head: "Unknowns", text: `${f.dofs.join(", ")}; written to ${f.results.join(", ")} as raw float64 per node.` },
    { head: "Conditions", text: `Dirichlet on the node flag for ${f.bc.dirichlet.join(", ")}; Neumann on the side flag for ${f.bc.neumann.join(", ")} — each compiled into ${f.headers.join(" and ")}.` },
    { head: "Material", text: `props.txt must carry ${f.props.join(", ")}${f.fatalIfZero.length ? `; the reader defaults a missing key to 0, and ${f.fatalIfZero.join(", ")} at 0 is a NaN` : ""}.` },
  ];
  for (const r of f.reservedSideFlags) lines.push({ head: `Side flag ${r.flag}`, text: `Reserved: ${r.why}. No face of a study may carry it.` });
  lines.push({ head: "Time", text: f.time });
  for (const s of f.stability) lines.push({ head: "Note", text: s });
  if (!f.offered) lines.push({ head: "Not offered yet", text: f.why });
  return lines;
}
