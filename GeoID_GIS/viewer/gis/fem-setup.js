/**
 * THE MODEL DEFINITION: materials, physics, boundary and initial conditions,
 * and the study — everything between a meshed geometry and a solve.
 *
 * Pure: no DOM, no scene. The Model page's setup panel edits a `setup` object
 * and this module decides what it means for GALES, which is what makes the
 * definition REAL rather than a note in a spec. GALES does not read boundary
 * conditions from a file: each case compiles a `*_ic_bc.hpp` whose functions
 * answer, per node flag or side flag, whether a dof is prescribed and to what.
 * Materials are read from `props.txt`, either uniform or as layers by
 * position. So this module writes both, from the flags the geometry already
 * carries, and the sidecar puts them into the deck before it builds.
 *
 * The rules that keep it honest:
 *  - A boundary condition names a FLAG, never a surface name typed by hand.
 *  - A dirichlet condition is a NODE flag and a neumann one a SIDE flag —
 *    GALES's own distinction — and edges and corners take the lowest flag, so
 *    the order of flags decides which condition wins on a shared edge.
 *  - Per-domain materials reach GALES only as layers by position. Where the
 *    domains are not layers (a sphere inside a box) the solve would silently
 *    use one material; `materialsPlan` says so instead of hiding it.
 */

/* ── materials ──────────────────────────────────────────────────────────── */

/**
 * Typical values, not a site's. Each is a reasonable mid-range for the
 * material as commonly quoted (elastic moduli are dynamic-to-static midpoints
 * for intact rock; soils are drained secant moduli), and every one is editable
 * where it is assigned. Units: kg/m³, Pa, –, W/(m·K), J/(kg·K), Pa·s.
 */
// What GALES needs is stated once, in the contract; the checklist reads it.
import { familyFor } from "./gales-contract.js?v=20260919-2de9a83";

export const MATERIALS = [
  { id: "granite", name: "Granite", group: "Rock", rho: 2650, E: 50e9, nu: 0.25, k: 2.9, cp: 790 },
  { id: "basalt", name: "Basalt", group: "Rock", rho: 2900, E: 60e9, nu: 0.25, k: 1.7, cp: 840 },
  { id: "andesite", name: "Andesite", group: "Rock", rho: 2650, E: 40e9, nu: 0.26, k: 1.9, cp: 850 },
  { id: "limestone", name: "Limestone", group: "Rock", rho: 2600, E: 40e9, nu: 0.3, k: 2.5, cp: 810 },
  { id: "sandstone", name: "Sandstone", group: "Rock", rho: 2300, E: 15e9, nu: 0.25, k: 2.5, cp: 920 },
  { id: "shale", name: "Shale / mudstone", group: "Rock", rho: 2400, E: 20e9, nu: 0.3, k: 1.5, cp: 900 },
  { id: "tuff", name: "Tuff", group: "Rock", rho: 1900, E: 5e9, nu: 0.25, k: 0.8, cp: 900 },
  { id: "volcanic_crust", name: "Volcanic crust (Etna case)", group: "Rock", rho: 3000, E: 25e9, nu: 0.25, k: 2, cp: 1000 },
  { id: "upper_crust", name: "Upper crust (average)", group: "Rock", rho: 2700, E: 60e9, nu: 0.25, k: 2.5, cp: 850 },
  { id: "clay", name: "Clay (stiff)", group: "Soil", rho: 1900, E: 30e6, nu: 0.35, k: 1.3, cp: 1400 },
  { id: "sand", name: "Sand (dense)", group: "Soil", rho: 2000, E: 60e6, nu: 0.3, k: 2, cp: 1000 },
  { id: "ice", name: "Ice", group: "Other", rho: 917, E: 9e9, nu: 0.33, k: 2.2, cp: 2100 },
  { id: "concrete", name: "Concrete", group: "Engineering", rho: 2400, E: 30e9, nu: 0.2, k: 1.7, cp: 880 },
  { id: "steel", name: "Steel", group: "Engineering", rho: 7850, E: 200e9, nu: 0.3, k: 45, cp: 490 },
  // alpha (1/K) and beta (1/Pa): water's are handbook values (c = 1/√(ρβ) ≈
  // 1,490 m/s); air's are the ideal gas's at 15 °C and 1 atm; the melts take
  // typical silicate-melt values (β ~ 1e-10 gives c ~ 1.9 km/s).
  { id: "water", name: "Water (20 °C)", group: "Fluid", rho: 998, mu: 1.0e-3, k: 0.6, cp: 4182, alpha: 2.1e-4, beta: 4.5e-10 },
  { id: "air", name: "Air (15 °C)", group: "Fluid", rho: 1.225, mu: 1.81e-5, k: 0.025, cp: 1005, alpha: 3.47e-3, beta: 9.87e-6 },
  { id: "basaltic_magma", name: "Basaltic magma", group: "Fluid", rho: 2700, mu: 100, k: 1.5, cp: 1200, alpha: 5e-5, beta: 1e-10 },
  { id: "rhyolitic_magma", name: "Rhyolitic magma", group: "Fluid", rho: 2300, mu: 1e7, k: 1.3, cp: 1200, alpha: 5e-5, beta: 1e-10 },
];

export const materialById = (id) => MATERIALS.find((m) => m.id === id) || null;

/** The properties a physics needs from a material, with units and bounds. */
export const MATERIAL_PROPS = {
  rho: { label: "Density", unit: "kg/m³", min: 1e-6 },
  E: { label: "Young's modulus", unit: "Pa", min: 1 },
  nu: { label: "Poisson's ratio", unit: "", min: 0, max: 0.4999 },
  k: { label: "Thermal conductivity", unit: "W/(m·K)", min: 1e-9 },
  cp: { label: "Specific heat", unit: "J/(kg·K)", min: 1e-9 },
  mu: { label: "Dynamic viscosity", unit: "Pa·s", min: 1e-12 },
  // GALES's fluid is weakly compressible: its sound speed is 1/√(ρβ) and its
  // energy terms carry α. Written as zero (the reader's default when a props
  // file omits them) the sound speed is infinite and the first solve is NaN
  // — measured on the first fluid run, a duct at Re 10.
  alpha: { label: "Thermal expansion", unit: "1/K", min: 0 },
  beta: { label: "Isothermal compressibility", unit: "1/Pa", min: 1e-15 },
};

/* ── physics ────────────────────────────────────────────────────────────── */

/**
 * The GALES families the sidecar can prepare, and what each one asks. `dofs`
 * are GALES's own names; a condition writes values onto them.
 */
export const PHYSICS = {
  solid: {
    label: "Solid mechanics (linear elastic, static)",
    family: "solid_es", header: "solid_ic_bc.hpp", guard: "SOLID_IC_BC_HPP", cls: "solid_ic_bc",
    props: ["rho", "E", "nu"],
    fields: "displacement u (m)",
    conditions: {
      free: { label: "Free (no condition)", values: [] },
      fixed: { label: "Fixed — all displacement zero", values: [] },
      roller: { label: "Roller — no motion along one axis", values: [{ key: "axis", label: "Held axis", choices: ["x", "y", "z"], def: "z" }] },
      displacement: { label: "Prescribed displacement", values: [{ key: "ux", label: "uₓ (m)", optional: true }, { key: "uy", label: "u_y (m)", optional: true }, { key: "uz", label: "u_z (m)", optional: true }] },
      pressure: { label: "Pressure on the face", values: [{ key: "p", label: "Pressure (Pa)", def: 1e6 }] },
      traction: { label: "Traction (stress components)", values: ["tau11", "tau22", "tau33", "tau12", "tau13", "tau23"].map((key) => ({ key, label: `${key.replace("tau", "σ")} (Pa)`, optional: true })) },
    },
    initial: [],
    options: [{ key: "gravity", label: "Gravity (self-weight, −z)", kind: "bool", def: false }],
  },
  heat: {
    label: "Heat transfer (conduction)",
    family: "heat_equation", header: "heat_eq_ic_bc.hpp", guard: "HEAT_EQ_IC_BC_HPP", cls: "heat_eq_ic_bc",
    props: ["rho", "cp", "k"],
    fields: "temperature T",
    conditions: {
      free: { label: "Insulated (no condition)", values: [] },
      temperature: { label: "Fixed temperature", values: [{ key: "T", label: "T", def: 20 }] },
      flux: { label: "Heat flux (components)", values: [{ key: "q1", label: "q_x (W/m²)", optional: true }, { key: "q2", label: "q_y (W/m²)", optional: true }, { key: "q3", label: "q_z (W/m²)", optional: true }] },
    },
    initial: [{ key: "T", label: "Initial temperature", def: 0 }],
    options: [],
  },
  fluid: {
    label: "Laminar flow (isothermal)",
    family: "fluid_sc", header: "fluid_ic_bc.hpp", guard: "FLUID_IC_BC_HPP", cls: "fluid_ic_bc",
    props: ["rho", "mu", "cp", "k", "alpha", "beta"],
    fields: "pressure p, velocity v",
    conditions: {
      free: { label: "Open (traction free)", values: [] },
      wall: { label: "No-slip wall — velocity zero", values: [] },
      slip: { label: "Slip wall — no flow across one axis", values: [{ key: "axis", label: "Normal axis", choices: ["x", "y", "z"], def: "z" }] },
      inlet: { label: "Velocity inlet", values: [{ key: "vx", label: "vₓ (m/s)", def: 1 }, { key: "vy", label: "v_y (m/s)", def: 0 }, { key: "vz", label: "v_z (m/s)", def: 0 }] },
      pressure: { label: "Pressure outlet", values: [{ key: "p", label: "p (Pa)", def: 0 }] },
    },
    initial: [{ key: "p", label: "Initial pressure (Pa)", def: 0 }, { key: "vx", label: "Initial vₓ (m/s)", def: 0 }, { key: "vy", label: "Initial v_y (m/s)", def: 0 }, { key: "vz", label: "Initial v_z (m/s)", def: 0 }],
    options: [{ key: "temperature", label: "Isothermal temperature (K)", kind: "number", def: 293.15 }],
  },
};

/** A blank setup: the page fills in its domains and faces. */
export function defaultSetup() {
  return {
    physics: "solid",
    materials: {}, // volume flag → { id, overrides: { rho, E, … } }
    conditions: {}, // face flag → { type, values }
    initial: {},
    options: {},
    study: { name: "study_1", kind: "stationary", end: 1, step: 1, ranks: 4, target: "local", printEvery: 1 },
  };
}

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

/** The properties a domain resolves to: its library material plus what was edited on it. */
export function domainProperties(assignment) {
  const base = materialById(assignment?.id) || {};
  const out = {};
  for (const key of Object.keys(MATERIAL_PROPS)) {
    const edited = num(assignment?.overrides?.[key]);
    out[key] = Number.isFinite(edited) ? edited : base[key];
  }
  return out;
}

/* ── materials into GALES ───────────────────────────────────────────────── */

/**
 * HOW THE DOMAINS' MATERIALS REACH GALES. GALES assigns properties by
 * POSITION — uniform, or layers along one axis — never by element region. So:
 *  - one material over every solid domain → uniform;
 *  - domains whose z ranges do not overlap → z-wise layers;
 *  - anything else cannot be said to GALES, and the plan picks the largest
 *    domain's material and names the ones it had to drop.
 * `domains`: [{ flag, name, zMin, zMax, volume, void }].
 */
export function materialsPlan(domains, materials) {
  const solid = domains.filter((d) => !d.void);
  if (!solid.length) return { mode: "none", issues: ["There is no domain to give a material."] };
  const missing = solid.filter((d) => !materials[d.flag]?.id);
  const assigned = solid.filter((d) => materials[d.flag]?.id).map((d) => ({ ...d, props: domainProperties(materials[d.flag]), material: materials[d.flag].id }));
  if (!assigned.length) return { mode: "none", missing, issues: ["No domain has a material yet."] };
  const issues = missing.length ? [`${missing.length} domain${missing.length === 1 ? "" : "s"} without a material take the first assigned one: ${missing.map((d) => d.name).join(", ")}.`] : [];
  const key = (a) => JSON.stringify(a.props);
  if (new Set(assigned.map(key)).size === 1) return { mode: "uniform", props: assigned[0].props, issues };
  const byZ = [...assigned].filter((d) => Number.isFinite(d.zMin) && Number.isFinite(d.zMax)).sort((a, b) => a.zMin - b.zMin);
  const span = byZ.length ? byZ.at(-1).zMax - byZ[0].zMin : 0;
  const tol = Math.max(1e-6, span * 1e-6);
  const layered = byZ.length === assigned.length && byZ.every((d, i) => i === 0 || d.zMin >= byZ[i - 1].zMax - tol);
  if (layered) {
    return { mode: "layers", axis: "z", layers: byZ.map((d) => ({ lo: d.zMin, hi: d.zMax, props: d.props, name: d.name })), props: byZ[0].props, issues };
  }
  const largest = [...assigned].sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
  const dropped = assigned.filter((d) => key(d) !== key(largest)).map((d) => d.name);
  return {
    mode: "uniform", props: largest.props,
    issues: [...issues, `GALES assigns materials by position (uniform or layers), and these domains are not horizontal layers — the solve uses ${largest.name}'s material everywhere, so ${dropped.join(", ")} will not keep theirs.`],
  };
}

const g = (v) => (Number.isFinite(v) ? Number(v).toPrecision(8).replace(/\.?0+(e|$)/, "$1") : "0");

/** The `props.txt` a family reads, from the plan. */
export function propsText(physics, plan, { dim = 3, options = {}, pointwise = null } = {}) {
  const p = plan?.props || {};
  if (physics === "heat") {
    return `heat_equation\n{\n   custom\n   {\n     rho             ${g(p.rho)}\n     cp              ${g(p.cp)}\n     kappa           ${g(p.k)}\n   }\n}\n`;
  }
  if (physics === "fluid") {
    const T = Number.isFinite(num(options.temperature)) ? num(options.temperature) : 293.15;
    // cp and kappa for the energy terms, alpha and beta for the weakly
    // compressible ones: the reader's default for any of them is 0, and
    // beta 0 is an infinite sound speed (NaN at the first solve).
    return `fluid\n{\n    Isothermal_T    ${g(T)}\n\n    ch\n    {\n       custom\n       rho            ${g(p.rho)}\n       mu             ${g(p.mu)}\n       cp             ${g(p.cp)}\n       kappa          ${g(p.k)}\n       alpha          ${g(p.alpha)}\n       beta           ${g(p.beta)}\n    }\n}\n`;
  }
  const lines = ["solid", "{", "   material        Hookes", "",
    `   plane_strain    ${dim === 2 ? "T" : "F"}`, "   plane_stress    F", "   axisymmetric    F", "",
    `   rho             ${g(p.rho)}`, `   E               ${g(p.E)}`, `   nu              ${g(p.nu)}`];
  if (pointwise?.file) {
    // A tomography grid: GALES interpolates rho, E and nu from input/<file> at
    // every quadrature point, in place of the uniform values above (which
    // stay as the fallback its reader prints).
    lines.push("", "   heterogeneous_pointwise", "   {", `      input_file   ${pointwise.dim === 2 ? "2d" : "3d"}   ${pointwise.file}`, "   }");
  } else if (plan?.mode === "layers") {
    lines.push("", `   heterogeneous_layers ${plan.axis}-wise`, "   {");
    plan.layers.forEach((layer) => {
      lines.push("     layer", "     {", `        bound           ${g(layer.lo)} ${g(layer.hi)}`,
        `        rho             ${g(layer.props.rho)}`, `        E               ${g(layer.props.E)}`, `        nu              ${g(layer.props.nu)}`, "     }");
    });
    lines.push("   }");
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/* ── conditions into GALES ──────────────────────────────────────────────── */

/**
 * WHAT EACH CONDITION PRESCRIBES, as GALES calls: { dirichlet: { dof: [[flag,
 * value]] }, neumann: { fn: [[flag, value]] } }. Flags are visited lowest
 * first, so the generated `if` chain reads in the order GALES resolves a
 * shared edge.
 */
export function conditionCalls(physics, conditions) {
  const dirichlet = {};
  const neumann = {};
  const put = (table, name, flag, value) => { (table[name] = table[name] || []).push([flag, value]); };
  const flags = Object.keys(conditions).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  for (const flag of flags) {
    const { type, values = {} } = conditions[flag] || {};
    const v = (key, def = 0) => (Number.isFinite(num(values[key])) ? num(values[key]) : def);
    const opt = (key) => (Number.isFinite(num(values[key])) ? num(values[key]) : null);
    if (physics === "solid") {
      if (type === "fixed") ["ux", "uy", "uz"].forEach((d) => put(dirichlet, d, flag, 0));
      else if (type === "roller") put(dirichlet, `u${values.axis || "z"}`, flag, 0);
      else if (type === "displacement") ["ux", "uy", "uz"].forEach((d) => { if (opt(d) !== null) put(dirichlet, d, flag, opt(d)); });
      else if (type === "pressure") put(neumann, "pressure", flag, v("p"));
      else if (type === "traction") ["tau11", "tau22", "tau33", "tau12", "tau13", "tau23"].forEach((t) => { if (opt(t) !== null) put(neumann, t, flag, opt(t)); });
    } else if (physics === "heat") {
      if (type === "temperature") put(dirichlet, "T", flag, v("T"));
      else if (type === "flux") ["q1", "q2", "q3"].forEach((q) => { if (opt(q) !== null) put(neumann, q, flag, opt(q)); });
    } else if (physics === "fluid") {
      if (type === "wall") ["vx", "vy", "vz"].forEach((d) => put(dirichlet, d, flag, 0));
      else if (type === "slip") put(dirichlet, `v${values.axis || "z"}`, flag, 0);
      else if (type === "inlet") ["vx", "vy", "vz"].forEach((d) => put(dirichlet, d, flag, v(d)));
      else if (type === "pressure") put(dirichlet, "p", flag, v("p"));
    }
  }
  return { dirichlet, neumann };
}

const cpp = (v) => {
  const s = Number(v).toPrecision(10).replace(/\.?0+(e|$)/, "$1");
  return /[.e]/.test(s) ? s : `${s}.0`;
};

/** The dofs and neumann functions a family's header must define. */
const HEADER_FUNCTIONS = {
  solid: { initial: ["ux", "uy", "uz"], dirichlet: ["ux", "uy", "uz"], neumann: ["tau11", "tau22", "tau33", "tau12", "tau13", "tau23", "pressure"] },
  heat: { initial: ["T"], dirichlet: ["T"], neumann: ["q1", "q2", "q3"] },
  fluid: { initial: ["p", "vx", "vy", "vz", "T"], dirichlet: ["p", "vx", "vy", "vz", "T"], neumann: ["tau11", "tau12", "tau13", "tau22", "tau23", "tau33", "q1", "q2", "q3"] },
};

/**
 * THE GENERATED `*_ic_bc.hpp`. It defines every function its family's
 * reference header defines, so nothing falls through to a base default the
 * solver was not written to expect, and each one is an `if` per flag.
 */
export function icBcHeader(physics, setup, { title = "GeoID Model page" } = {}) {
  const P = PHYSICS[physics];
  const F = HEADER_FUNCTIONS[physics];
  if (!P || !F) throw new Error(`No GALES header for physics "${physics}".`);
  const { dirichlet, neumann } = conditionCalls(physics, setup.conditions || {});
  const init = setup.initial || {};
  const body = [];
  body.push(`    // Written by ${title}. Edit the model and solve again rather than this file.`);
  if (physics === "solid" && setup.options?.gravity) {
    body.push("", "    void body_force(vec& gravity)", "    {", "      gravity[gravity.size()-1] = -9.81;", "    }");
  }
  body.push("", "    //---------------------   IC  ------------------------------------------");
  F.initial.forEach((d) => body.push(`    double initial_${d}(const nd_type &nd) const { return ${cpp(Number.isFinite(num(init[d])) ? num(init[d]) : 0)}; }`));
  body.push("", "    //------------ dirichlet (node flag) ---------------------------------");
  F.dirichlet.forEach((d) => {
    body.push(`    auto dirichlet_${d}(const nd_type &nd) const`, "    {");
    (dirichlet[d] || []).forEach(([flag, value]) => body.push(`      if(nd.flag() == ${flag}) return std::make_pair(true, ${cpp(value)});`));
    body.push("      return std::make_pair(false, 0.0);", "    }");
  });
  body.push("", "    //------------ neumann (side flag) ----------------------------------");
  // BOTH OVERLOADS, every time. GALES's base ic_bc declares each Neumann
  // function twice — over the side's node ids (`std::vector<int>`, what the
  // solid solvers pass) and over its node pointers (what heat_conduction
  // passes now) — and a derived class that declares only one HIDES the
  // other, so the solver's call no longer compiles ("cannot convert
  // vector<shared_ptr<node>> to const vector<int>&", measured on the first
  // transient). The reference sim's own header is the stale one.
  F.neumann.forEach((n) => {
    for (const arg of ["const std::vector<int>& bd_nodes", "const std::vector<std::shared_ptr<nd_type>>& bd_nodes"]) {
      body.push(`    auto neumann_${n}(${arg}, int side_flag) const`, "    {");
      (neumann[n] || []).forEach(([flag, value]) => body.push(`      if(side_flag == ${flag}) return std::make_pair(true, ${cpp(value)});`));
      body.push("      return std::make_pair(false, 0.0);", "    }");
    }
  });
  const extra = physics === "fluid" ? "    using point_type = point<dim>;\n" : "";
  return `#ifndef ${P.guard}
#define ${P.guard}

#include "GALES_SRC/src/fem/fem.hpp"

namespace GALES{

  template<int dim>
  class ${P.cls} : public base_ic_bc<dim>
  {
    using nd_type = node<dim>;
${extra}    using vec = boost::numeric::ublas::vector<double>;

    public :
${body.join("\n")}
  };

}

#endif
`;
}

/* ── the checklist ──────────────────────────────────────────────────────── */

/**
 * WHAT STANDS BETWEEN THIS MODEL AND A SOLVE, in the reader's words. `level`
 * "error" blocks the solve; "warning" is said and does not.
 * `targets`: { domains: [{flag,name,void}], faces: [{flag,name}], meshed }.
 */
export function checkSetup(setup, targets) {
  const out = [];
  const P = PHYSICS[setup.physics];
  if (!P) return [{ level: "error", step: "physics", text: "Choose a physics." }];
  const solids = (targets.domains || []).filter((d) => !d.void);
  if (!solids.length) out.push({ level: "error", step: "geometry", text: "Add geometry: there is no domain to solve on." });
  const plan = materialsPlan(targets.domains || [], setup.materials || {});
  const pointwise = setup.pointwise?.file ? setup.pointwise : null;
  if (pointwise && setup.physics !== "solid") out.push({ level: "error", step: "materials", text: "A tomography grid sets rho, E and nu, which only the solid mechanics physics reads. Remove it or switch physics." });
  if (pointwise && setup.physics === "solid") {
    if (plan.mode !== "none") out.push({ level: "warning", step: "materials", text: "The tomography grid sets the material everywhere: the domains' own materials are written as the fallback only." });
    if (pointwise.dim !== (targets.dim || 3)) out.push({ level: "error", step: "materials", text: `The tomography grid is ${pointwise.dim}D and the model is ${targets.dim || 3}D.` });
    if (pointwise.bounds && targets.domains?.length) {
      const zLo = Math.min(...targets.domains.map((d) => d.zMin)); const zHi = Math.max(...targets.domains.map((d) => d.zMax));
      const [gLo, gHi] = [pointwise.bounds.min[2], pointwise.bounds.max[2]];
      if (pointwise.dim === 3 && (zLo < gLo - 1e-6 || zHi > gHi + 1e-6)) out.push({ level: "warning", step: "materials", text: `The model spans z ${Math.round(zLo)} to ${Math.round(zHi)} m and the grid ${Math.round(gLo)} to ${Math.round(gHi)} m: GALES holds the edge values beyond the grid (and its reader sets a fixed mantle below z = −25 km).` });
    }
  } else if (plan.mode === "none") out.push({ level: "error", step: "materials", text: "Give at least one domain a material." });
  // With no material at all, the error above says it; the plan's own "none yet" would say it twice.
  if (!pointwise && plan.mode !== "none") plan.issues?.forEach((text) => out.push({ level: "warning", step: "materials", text }));
  if (plan.props && !pointwise) {
    for (const key of P.props) {
      const spec = MATERIAL_PROPS[key];
      const value = plan.props[key];
      if (!Number.isFinite(value)) out.push({ level: "error", step: "materials", text: `The material has no ${spec.label.toLowerCase()}, which ${P.label.toLowerCase()} needs.` });
      else if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) out.push({ level: "error", step: "materials", text: `${spec.label} ${value} is out of range.` });
    }
  }
  const { dirichlet } = conditionCalls(setup.physics, setup.conditions || {});
  const faceFlags = new Set((targets.faces || []).map((f) => Number(f.flag)));
  const unknown = Object.keys(setup.conditions || {}).map(Number).filter((f) => (setup.conditions[f]?.type || "free") !== "free" && !faceFlags.has(f));
  if (unknown.length) out.push({ level: "warning", step: "physics", text: `Conditions on flag${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}, which no face of the model carries now.` });
  // Which side flags a family reserves is the GALES contract's to say
  // (gales-contract.js): the solid and heat solvers treat SIDE FLAG 1 as the
  // interface to a coupled fluid and segfault at the first step without one
  // (measured on the first solve this page ran); the fluid solver has no such
  // branch. The checklist reads the contract rather than knowing the number.
  for (const r of familyFor(setup.physics)?.reservedSideFlags || []) {
    const reserved = (targets.faces || []).filter((f) => Number(f.flag) === r.flag);
    if (reserved.length) out.push({ level: "error", step: "physics", text: `${reserved.map((f) => f.name).join(", ")} ${reserved.length === 1 ? "carries" : "carry"} flag ${r.flag}, which GALES's ${P.family} solver reserves — ${r.why}. Give the face another number in Domains and faces.` });
  }
  if (setup.physics === "solid") {
    const held = ["ux", "uy", "uz"].filter((d) => dirichlet[d]?.length);
    if (held.length < 3) out.push({ level: "error", step: "physics", text: `Nothing holds the model in ${["x", "y", "z"].filter((a) => !held.includes(`u${a}`)).join(", ")}: a static solid needs displacement fixed in every direction somewhere, or it moves as a rigid body.` });
  }
  if (setup.physics === "heat" && !dirichlet.T?.length) out.push({ level: "warning", step: "physics", text: "No face has a fixed temperature: the temperature is set only by the initial value and the fluxes." });
  if (setup.physics === "fluid") {
    if (!dirichlet.p?.length) out.push({ level: "warning", step: "physics", text: "No pressure outlet: pressure has no reference level." });
    if (!dirichlet.vx?.length && !dirichlet.vy?.length && !dirichlet.vz?.length) out.push({ level: "warning", step: "physics", text: "No inlet or wall: nothing drives or holds the flow." });
    const acoustic = acousticTransits(setup, plan, targets);
    if (acoustic && acoustic.transits > ACOUSTIC_TRANSITS_WARN) out.push({ level: "warning", step: "study", text: `A time step of ${acoustic.step} s is about ${Math.round(acoustic.transits).toLocaleString()} sound transits of the model per step (c = ${Math.round(acoustic.c)} m/s over ${fmtLength(acoustic.length)}). GALES's fluid is weakly compressible and its time step is bounded by the acoustics, not the flow: the reference sims run near ${ACOUSTIC_TRANSITS_REFERENCE} transits, and a duct solve at ${Math.round(ACOUSTIC_TRANSITS_DIVERGED / 1000).toLocaleString()},000 diverged by its sixth step. Try a step under ${acoustic.suggested} s.` });
  }
  const st = setup.study || {};
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(st.name || "")) out.push({ level: "error", step: "study", text: "Name the study with letters, digits, _ or - (it is a folder name)." });
  if (st.kind === "transient") {
    if (!(num(st.step) > 0)) out.push({ level: "error", step: "study", text: "The time step must be above zero." });
    if (!(num(st.end) >= num(st.step))) out.push({ level: "error", step: "study", text: "The end time must be at least one step." });
    else if (num(st.end) / num(st.step) > 100000) out.push({ level: "warning", step: "study", text: `${Math.round(num(st.end) / num(st.step)).toLocaleString()} steps is a long run.` });
  }
  if (!(num(st.ranks) >= 1)) out.push({ level: "error", step: "study", text: "At least one MPI rank." });
  return out;
}

/**
 * HOW MANY SOUND TRANSITS A FLUID TIME STEP IS. GALES's fluid is weakly
 * compressible (c = 1/√(ρβ)); measured on the first duct solve this page ran,
 * Δt = 0.05 s (about 75 transits of the 1 m box, the order the reference
 * sims run at) was stable and Δt = 50 s (75,000) grew 92 → 14,511 → 5×10¹²
 * and was NaN by the sixth step. The length is the shortest vertical extent
 * among the solid domains — the model's size, not the element's, so this is
 * an order-of-magnitude warning and says so. Null where the study is not a
 * transient or the material has no beta (the checklist already refuses that).
 */
export const ACOUSTIC_TRANSITS_WARN = 1000;
export const ACOUSTIC_TRANSITS_REFERENCE = 75;
export const ACOUSTIC_TRANSITS_DIVERGED = 75000;

export function acousticTransits(setup, plan, targets) {
  const st = setup.study || {};
  if (st.kind !== "transient") return null;
  const step = num(st.step);
  const rho = plan?.props?.rho;
  const beta = plan?.props?.beta;
  if (!(step > 0) || !(rho > 0) || !(beta > 0)) return null;
  const solids = (targets.domains || []).filter((d) => !d.void && Number.isFinite(d.zMin) && Number.isFinite(d.zMax) && d.zMax > d.zMin);
  if (!solids.length) return null;
  const length = Math.min(...solids.map((d) => d.zMax - d.zMin));
  const c = 1 / Math.sqrt(rho * beta);
  const transits = c * step / length;
  const suggested = Number((ACOUSTIC_TRANSITS_REFERENCE * length / c).toPrecision(2));
  return { step, c, length, transits, suggested };
}

function fmtLength(m) {
  return m >= 1000 ? `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : `${m.toLocaleString(undefined, { maximumFractionDigits: 2 })} m`;
}

/* ── the study ──────────────────────────────────────────────────────────── */

/** `setup.txt` values for the study: a stationary solve is one step of length one. */
export function studyTimes(study) {
  if (study?.kind === "transient") {
    const step = num(study.step);
    const end = num(study.end);
    return { delta_t: step, final_time: end, print_freq: Math.max(1, Math.round(num(study.printEvery) || 1)), steps: Math.round(end / step) };
  }
  return { delta_t: 1, final_time: 1, print_freq: 1, steps: 1 };
}

/**
 * The spec.json a solve writes: the shape FEM pages and the sidecar already
 * read, plus `gales`, the files this module generated and the setup.txt
 * values, which the sidecar writes into the deck in place of its reference's.
 */
export function studySpec(setup, targets, { mesh, dim = 3, provenance = {} } = {}) {
  const P = PHYSICS[setup.physics];
  const plan = materialsPlan(targets.domains || [], setup.materials || {});
  const times = studyTimes(setup.study);
  const props = plan.props || {};
  return {
    solver: "gales",
    physics: setup.physics === "heat" ? "thermal" : setup.physics,
    run: setup.study.name,
    mesh: mesh || "",
    dim,
    time: { scheme: "bdf1", start: 0, end: times.final_time, step: times.delta_t },
    properties: {
      solid: { density: props.rho, young: props.E, poisson: props.nu },
      fluid: { density: props.rho, viscosity: props.mu },
      thermal: { density: props.rho, cp: props.cp, conductivity: props.k },
    },
    initial: { ...(setup.initial || {}) },
    boundary: Object.entries(setup.conditions || {})
      .filter(([, c]) => c?.type && c.type !== "free")
      .map(([flag, c]) => ({ flag: Number(flag), surface: targets.faces?.find((f) => Number(f.flag) === Number(flag))?.name || `flag ${flag}`, type: c.type, value: c.values || {} })),
    materials: { plan: setup.pointwise?.file ? "pointwise" : plan.mode, pointwise: setup.pointwise?.file ? { file: setup.pointwise.file, dim: setup.pointwise.dim, source: setup.pointwise.source, counts: setup.pointwise.counts, bounds: setup.pointwise.bounds } : null, domains: Object.fromEntries(Object.entries(setup.materials || {}).map(([flag, a]) => [flag, { material: a.id, properties: domainProperties(a) }])) },
    gales: {
      family: P.family,
      files: {
        [P.header]: icBcHeader(setup.physics, setup),
        "props.txt": propsText(setup.physics, plan, { dim, options: setup.options, pointwise: setup.pointwise?.file ? setup.pointwise : null }),
      },
      setup: { delta_t: times.delta_t, final_time: times.final_time, print_freq: times.print_freq },
    },
    created_by: "GeoID Model page",
    geoid_model: provenance,
  };
}

/* ── the model tree's badges ────────────────────────────────────────────── */

/**
 * WHAT EACH STEP OF THE TREE STANDS AT, for the badge beside its name: how
 * many solid domains have a material, how many faces carry a condition, and
 * how many errors and warnings stand between the model and a solve. A tree
 * that only lists steps makes the reader open each one to find the gap.
 */
export function setupSummary(setup, targets) {
  const solids = (targets?.domains || []).filter((d) => !d.void);
  const faceFlags = new Set((targets?.faces || []).map((f) => Number(f.flag)));
  const conditions = Object.entries(setup?.conditions || {}).filter(([flag, c]) => c?.type && c.type !== "free" && faceFlags.has(Number(flag)));
  const issues = checkSetup(setup, targets || {});
  const by = (step) => issues.filter((i) => i.step === step);
  const level = (list) => (list.some((i) => i.level === "error") ? "error" : list.length ? "warning" : "ok");
  return {
    materials: { assigned: solids.filter((d) => setup?.materials?.[d.flag]?.id).length, of: solids.length, pointwise: Boolean(setup?.pointwise?.file), level: level(by("materials")) },
    physics: { set: conditions.length, of: faceFlags.size, level: level(by("physics")) },
    study: { errors: issues.filter((i) => i.level === "error").length, warnings: issues.filter((i) => i.level === "warning").length, level: level(issues) },
    issues,
  };
}

/* ── parameter sweeps ──────────────────────────────────────────────────── */

/**
 * What a study can be swept over: every property of a domain that has a
 * material, and every numeric value of a condition that is set. A sweep is
 * how a model is asked "how sensitive is the answer to this", which one run
 * cannot say.
 */
export function sweepParameters(setup, targets) {
  const P = PHYSICS[setup?.physics];
  if (!P) return [];
  const out = [];
  for (const d of (targets?.domains || []).filter((x) => !x.void)) {
    const a = setup.materials?.[d.flag];
    if (!a?.id) continue;
    const props = domainProperties(a);
    for (const key of P.props) {
      const meta = MATERIAL_PROPS[key];
      out.push({ key: `mat:${d.flag}:${key}`, label: `${d.name} — ${meta.label}${meta.unit ? ` (${meta.unit})` : ""}`, base: props[key], min: meta.min, max: meta.max });
    }
  }
  for (const [flag, c] of Object.entries(setup.conditions || {})) {
    const def = P.conditions[c?.type];
    if (!def) continue;
    const face = (targets?.faces || []).find((f) => Number(f.flag) === Number(flag));
    for (const v of def.values) {
      if (v.choices) continue;
      const base = Number(c.values?.[v.key] ?? v.def);
      // A condition with one value named as the condition is ("Pressure on
      // the face" / "Pressure (Pa)") is named once; measured on the Study
      // tab as "Pressure on the face Pressure (Pa)".
      const kind = def.label.split(" — ")[0];
      const same = kind.toLowerCase().split(/\s+/)[0] === v.label.toLowerCase().split(/[\s(]+/)[0];
      out.push({ key: `bc:${flag}:${v.key}`, label: `${face?.name || `flag ${flag}`} — ${same ? v.label : `${kind}: ${v.label}`}`, base: Number.isFinite(base) ? base : NaN });
    }
  }
  return out;
}

/**
 * The values of a sweep: a typed list, or `count` values from `from` to `to`
 * evenly (linear) or by equal ratios (log, both ends positive). Answers
 * { values, error }.
 */
export function sweepValues({ mode = "range", from, to, count = 5, scale = "linear", text = "" } = {}) {
  if (mode === "list") {
    const values = String(text).split(/[,;\s]+/).filter(Boolean).map(Number);
    if (!values.length || values.some((v) => !Number.isFinite(v))) return { values: [], error: "Type the values as numbers, separated by commas." };
    return { values, error: "" };
  }
  const a = Number(from); const b = Number(to); const n = Math.round(Number(count));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { values: [], error: "Give both ends of the range." };
  if (!(n >= 2 && n <= 50)) return { values: [], error: "Between 2 and 50 runs." };
  if (scale === "log") {
    if (!(a > 0 && b > 0)) return { values: [], error: "A log range needs both ends above zero." };
    return { values: Array.from({ length: n }, (_, k) => Number((a * (b / a) ** (k / (n - 1))).toPrecision(6))), error: "" };
  }
  return { values: Array.from({ length: n }, (_, k) => Number((a + ((b - a) * k) / (n - 1)).toPrecision(10))), error: "" };
}

/** A copy of the setup with one parameter set; the run's name is the study's plus its index. */
export function sweepSetups(setup, key, values, base = setup?.study?.name || "study") {
  const [kind, flag, prop] = String(key).split(":");
  const width = String(values.length - 1).length;
  return values.map((value, k) => {
    const next = JSON.parse(JSON.stringify(setup));
    const name = `${base}_sweep_${String(k).padStart(width, "0")}`;
    next.study = { ...next.study, name };
    if (kind === "mat") {
      const a = next.materials[flag] || (next.materials[flag] = {});
      a.overrides = { ...(a.overrides || {}), [prop]: value };
    } else if (kind === "bc") {
      const c = next.conditions[flag];
      if (c) c.values = { ...(c.values || {}), [prop]: value };
    }
    return { name, value, setup: next };
  });
}

/** The sweep's own record, beside its runs: what was varied, over what, and where each run is. */
export function sweepManifest({ base, parameter, label, values, runs, written_at = new Date().toISOString() }) {
  return {
    kind: "geoid-sweep", version: 1, base, parameter, label, values,
    runs: runs.map((r) => ({ name: r.name, value: r.value, dir: `fem_runs/${r.name}` })),
    written_at,
  };
}
