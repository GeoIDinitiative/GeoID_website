import { registerPage } from "../stages.js?v=20260903-52d53dc";
import * as store from "../project-store.js?v=20260903-52d53dc";
import {
  el, field, input, textarea, selectOf, button, row, statusLine, guard,
  pageHeader, toolbar, editorCard, fieldGrid, dataTable, console_,
} from "./common.js?v=20260903-52d53dc";

/**
 * Build New — the guided simulation builder, from `GuidedBuildPage`
 * (app_qt.py:14331).
 *
 * Ten steps grouped into three phases, exactly as the app has them, with the
 * draft kept in `metadata/build_draft.json` so a half-finished build survives a
 * reload. "Create Simulation Now" writes `fem_runs/<run>/spec.json`, which is
 * the same file every other FEM page reads and the desktop solver executes —
 * the wizard is a nicer way to fill in that spec, not a second mechanism.
 *
 * The two buttons that stay disabled need a model to answer: Generate
 * Suggestions and AI Populate Draft. Everything else here is a decision the
 * wizard can record.
 */

const DRAFT = "metadata/build_draft.json";

/** app_qt.py:14368 — the ten steps and the three phases over them. */
const STEPS = [
  "Start", "Sim Type", "Physics Config", "Material Model", "DOFs",
  "Solver", "Mesh/Flags", "Setup", "IC/BC", "Review",
];
const PHASES = [["Define", 0, 3], ["Configure", 4, 8], ["Finalize", 9, 9]];

const SIM_TYPES = ["Fluid", "Solid", "Heat", "Advection-diffusion", "FSI"];
const SOLVERS = ["GALES", "direct", "iterative (GMRES)", "iterative (CG)"];
const MATERIALS = ["Newtonian fluid", "Linear elastic", "Neo-Hookean",
  "Thermal conductor", "Custom"];

/**
 * What a sim type implies, which is what "Apply Recommended Presets" applies.
 * Held as data because the recommendation is a table in the app too, not logic.
 */
const RECOMMENDED = {
  Fluid: { dofs: ["u", "v", "p"], solver: "iterative (GMRES)",
    material: "Newtonian fluid", timestep: "0.001", scheme: "implicit" },
  Solid: { dofs: ["ux", "uy", "uz"], solver: "direct",
    material: "Linear elastic", timestep: "0.01", scheme: "implicit" },
  Heat: { dofs: ["T"], solver: "iterative (CG)",
    material: "Thermal conductor", timestep: "0.05", scheme: "implicit" },
  "Advection-diffusion": { dofs: ["c"], solver: "iterative (GMRES)",
    material: "Custom", timestep: "0.005", scheme: "semi-implicit" },
  FSI: { dofs: ["u", "v", "p", "ux", "uy"], solver: "GALES",
    material: "Neo-Hookean", timestep: "0.001", scheme: "partitioned" },
};

/** The governing equations, for "Show Equations". */
const EQUATIONS = {
  Fluid: ["ρ(∂u/∂t + u·∇u) = −∇p + μ∇²u + f", "∇·u = 0"],
  Solid: ["ρ ∂²d/∂t² = ∇·σ + f", "σ = C : ε(d)"],
  Heat: ["ρc ∂T/∂t = ∇·(k∇T) + q"],
  "Advection-diffusion": ["∂c/∂t + u·∇c = ∇·(D∇c) + s"],
  FSI: ["fluid: ρ(∂u/∂t + (u−ŵ)·∇u) = −∇p + μ∇²u",
    "solid: ρ ∂²d/∂t² = ∇·σ", "interface: u = ∂d/∂t,  σ_f·n = σ_s·n"],
};

const emptyDraft = () => ({
  step: 0,
  run: "",
  sim_type: "",
  physics: {},
  material: "",
  dofs: [],
  solver: "",
  mesh: "",
  flags: [],
  setup: { timestep: "", end_time: "", scheme: "" },
  bcs: [],
  notes: "",
});

const mount = guard("Build New", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const draft = { ...emptyDraft(), ...(await store.readJson(DRAFT, {})) };
  const save = () => store.writeJson(DRAFT, draft);
  const redraw = () => { host.textContent = ""; void mount(host, ctx); };

  const phaseOf = (i) => PHASES.findIndex(([, a, b]) => i >= a && i <= b);

  host.appendChild(pageHeader("Build Simulation",
    "Ten steps to a run specification. The draft is kept in the project, so a "
    + "half-finished build survives a reload.",
    `Step ${draft.step + 1} of ${STEPS.length}`));

  // ── Phase strip and step cards (app_qt.py:14374) ──────────────────────────
  const phaseStrip = el("div", "qt-tabs");
  PHASES.forEach(([name], i) => {
    const btn = el("button", "qt-tab", name);
    btn.type = "button";
    btn.classList.toggle("is-active", i === phaseOf(draft.step));
    btn.addEventListener("click", async () => {
      draft.step = PHASES[i][1];
      await save(); redraw();
    });
    phaseStrip.appendChild(btn);
  });
  host.appendChild(phaseStrip);

  const stepBar = el("div", "build-steps");
  STEPS.forEach((name, i) => {
    const card = el("button", "build-step", `${i + 1}. ${name}`);
    card.type = "button";
    card.classList.toggle("is-active", i === draft.step);
    card.classList.toggle("is-done", i < draft.step);
    card.addEventListener("click", async () => { draft.step = i; await save(); redraw(); });
    stepBar.appendChild(card);
  });
  host.appendChild(stepBar);

  // ── The current step ──────────────────────────────────────────────────────
  const panel = editorCard(STEPS[draft.step]);

  const bind = (node, get, set) => {
    node.addEventListener("change", async () => { set(node.value); await save(); });
    node.addEventListener("input", () => set(node.value));
    return node;
  };

  if (draft.step === 0) {
    panel.appendChild(el("p", "research-note",
      "Name the run. Everything the wizard collects is written to "
      + "fem_runs/<run>/spec.json, which the FEM pages and the desktop solver "
      + "both read."));
    const name = input(draft.run, "e.g. etna-chamber-01");
    bind(name, () => draft.run, (v) => { draft.run = v; });
    panel.appendChild(field("Run name", name));
    panel.appendChild(row(button("Apply Roadmap Template", async () => {
      // The roadmap template is the project's own phase and focus question --
      // the wizard should not ask again for something the project already knows.
      const meta = store.getActive().meta;
      draft.run = draft.run || `${(meta.name || "run").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-01`;
      draft.notes = meta.focus_question || "";
      await save();
      say("Run named from the project, and its focus question carried in.");
      redraw();
    }, { secondary: true })));
  }

  if (draft.step === 1) {
    const pick = selectOf(["", ...SIM_TYPES], draft.sim_type);
    bind(pick, () => draft.sim_type, (v) => { draft.sim_type = v; });
    panel.appendChild(field("Simulation type", pick));
    panel.appendChild(row(
      button("Apply Recommended Presets", async () => {
        const preset = RECOMMENDED[draft.sim_type];
        if (!preset) throw new Error("Choose a simulation type first.");
        draft.dofs = preset.dofs.slice();
        draft.solver = preset.solver;
        draft.material = preset.material;
        draft.setup = { ...draft.setup, timestep: preset.timestep, scheme: preset.scheme };
        await save();
        say(`${draft.sim_type}: ${preset.dofs.join(", ")} on ${preset.solver}.`);
        redraw();
      }),
      button("Show Equations", () => {
        const eqs = EQUATIONS[draft.sim_type];
        if (!eqs) { say("Choose a simulation type first.", true); return; }
        panel.appendChild(console_(eqs.join("\n")));
      }, { secondary: true }),
    ));
  }

  if (draft.step === 2) {
    const notes = textarea(draft.notes, 5, "What this simulation is meant to show");
    bind(notes, () => draft.notes, (v) => { draft.notes = v; });
    panel.appendChild(field("Physics configuration", notes));
    panel.appendChild(row(button("Apply Example Defaults", async () => {
      draft.physics = { gravity: "9.81", reference_density: "1000",
        reference_viscosity: "1.0e-3", reference_temperature: "293.15" };
      await save();
      say("Reference values filled in; change any that do not apply.");
      redraw();
    }, { secondary: true })));
    if (Object.keys(draft.physics).length) {
      panel.appendChild(dataTable(["Property", "Value"], Object.entries(draft.physics)));
    }
  }

  if (draft.step === 3) {
    const pick = selectOf(["", ...MATERIALS], draft.material);
    bind(pick, () => draft.material, (v) => { draft.material = v; });
    panel.appendChild(field("Material model", pick));
  }

  if (draft.step === 4) {
    const dofs = input(draft.dofs.join(", "), "u, v, p");
    bind(dofs, () => draft.dofs, (v) => {
      draft.dofs = v.split(",").map((s) => s.trim()).filter(Boolean);
    });
    panel.appendChild(field("Degrees of freedom", dofs));
    panel.appendChild(el("p", "research-note",
      "The DOF Wizard writes the same list into fem_runs/dof_spec.json if you "
      + "would rather define them one at a time."));
  }

  if (draft.step === 5) {
    const pick = selectOf(["", ...SOLVERS], draft.solver);
    bind(pick, () => draft.solver, (v) => { draft.solver = v; });
    panel.appendChild(field("Solver", pick));
  }

  if (draft.step === 6) {
    const meshes = (await store.listProjectDir("meshes").catch(() => []))
      .filter((e) => e.kind === "file");
    const pick = selectOf(["", ...meshes.map((m) => m.name)], draft.mesh);
    bind(pick, () => draft.mesh, (v) => { draft.mesh = v; });
    panel.appendChild(field("Mesh", pick));
    panel.appendChild(row(button("Auto-detect Physical Groups", async () => {
      if (!draft.mesh) throw new Error("Choose a mesh first.");
      const text = await store.readProjectFile(`meshes/${draft.mesh}`);
      // Gmsh names its groups in $PhysicalNames; that is all this needs to
      // read, and it is plain text.
      const found = [];
      const lines = String(text).split("\n");
      const at = lines.findIndex((l) => l.trim() === "$PhysicalNames");
      if (at >= 0) {
        const count = Number(lines[at + 1]) || 0;
        for (let i = 0; i < count; i += 1) {
          const parts = (lines[at + 2 + i] || "").trim().split(/\s+/);
          const name = parts.slice(2).join(" ").replace(/"/g, "");
          if (name) found.push(name);
        }
      }
      draft.flags = found;
      await save();
      say(found.length
        ? `${found.length} physical group(s): ${found.join(", ")}.`
        : "No $PhysicalNames block in that mesh.");
      redraw();
    }, { secondary: true })));
    if (draft.flags.length) {
      panel.appendChild(dataTable(["Physical group"], draft.flags.map((f) => [f])));
    }
  }

  if (draft.step === 7) {
    const dt = input(draft.setup.timestep, "0.001");
    const end = input(draft.setup.end_time, "10");
    const scheme = selectOf(["", "implicit", "explicit", "semi-implicit", "partitioned"],
      draft.setup.scheme);
    [dt, end, scheme].forEach((node, i) => {
      const key = ["timestep", "end_time", "scheme"][i];
      node.addEventListener("input", () => { draft.setup[key] = node.value; });
      node.addEventListener("change", async () => { draft.setup[key] = node.value; await save(); });
    });
    panel.appendChild(fieldGrid(3,
      field("Timestep", dt), field("End time", end), field("Scheme", scheme)));
  }

  if (draft.step === 8) {
    panel.appendChild(el("p", "research-note",
      "One boundary condition per line: group, variable, type, value."));
    const bcs = textarea(draft.bcs.join("\n"), 6, "inlet, u, Dirichlet, 1.0");
    bind(bcs, () => draft.bcs, (v) => {
      draft.bcs = v.split("\n").map((s) => s.trim()).filter(Boolean);
    });
    panel.appendChild(field("Boundary conditions", bcs));
    panel.appendChild(row(button("Auto-fill BC Placeholders", async () => {
      if (!draft.flags.length) throw new Error("Detect the mesh's physical groups first.");
      const vars = draft.dofs.length ? draft.dofs : ["u"];
      draft.bcs = draft.flags.flatMap((g) => vars.map((v) => `${g}, ${v}, Dirichlet, 0.0`));
      await save();
      say(`${draft.bcs.length} placeholder condition(s) written — set the values.`);
      redraw();
    }, { secondary: true })));
  }

  if (draft.step === 9) {
    panel.appendChild(console_(JSON.stringify({
      run: draft.run, sim_type: draft.sim_type, material: draft.material,
      dofs: draft.dofs, solver: draft.solver, mesh: draft.mesh,
      physical_groups: draft.flags, setup: draft.setup, bcs: draft.bcs,
    }, null, 2)));
    const missing = [
      !draft.run && "a run name", !draft.sim_type && "a simulation type",
      !draft.solver && "a solver", !draft.mesh && "a mesh",
      !draft.dofs.length && "at least one DOF",
    ].filter(Boolean);
    if (missing.length) {
      panel.appendChild(el("p", "research-note is-error",
        `Still needed: ${missing.join(", ")}.`));
    }
    panel.appendChild(row(
      button("Create Simulation Now", async () => {
        if (missing.length) throw new Error(`Still needed: ${missing.join(", ")}.`);
        const spec = {
          run: draft.run, created_at: new Date().toISOString(),
          sim_type: draft.sim_type, material: draft.material, dofs: draft.dofs,
          solver: draft.solver, mesh: `meshes/${draft.mesh}`,
          physical_groups: draft.flags, physics: draft.physics,
          setup: draft.setup, bcs: draft.bcs, notes: draft.notes,
          source: "Build New wizard",
        };
        await store.writeJson(`fem_runs/${draft.run}/spec.json`, spec);
        say(`Written to fem_runs/${draft.run}/spec.json — the FEM pages and the `
          + "desktop solver both read it from there.");
      }),
      button("Export Run Script", async () => {
        if (!draft.run) throw new Error("Name the run first.");
        // A shell script the desktop side can run as-is. It does not execute
        // here, and does not pretend to -- it is the handover.
        const script = [
          "#!/usr/bin/env bash",
          "# Generated by the GeoID Build New wizard.",
          "set -euo pipefail",
          `RUN="${draft.run}"`,
          'SPEC="fem_runs/$RUN/spec.json"',
          '[ -f "$SPEC" ] || { echo "no $SPEC" >&2; exit 1; }',
          `echo "solver:  ${draft.solver}"`,
          `echo "mesh:    meshes/${draft.mesh}"`,
          `echo "dofs:    ${draft.dofs.join(" ")}"`,
          "# Replace the line below with the solver invocation for this machine.",
          'echo "gales --spec $SPEC"',
        ].join("\n");
        await store.writeProjectFile(`fem_runs/${draft.run}/run.sh`, `${script}\n`);
        say(`Written to fem_runs/${draft.run}/run.sh.`);
      }, { secondary: true }),
    ));
  }

  host.appendChild(panel);

  // ── Navigation ────────────────────────────────────────────────────────────
  const back = button("Back", async () => {
    draft.step = Math.max(0, draft.step - 1); await save(); redraw();
  }, { secondary: true });
  back.disabled = draft.step === 0;
  const next = button("Next", async () => {
    draft.step = Math.min(STEPS.length - 1, draft.step + 1); await save(); redraw();
  });
  next.disabled = draft.step === STEPS.length - 1;

  host.appendChild(toolbar(back, next,
    button("Save Draft", async () => {
      await save();
      say(`Draft saved at step ${draft.step + 1} of ${STEPS.length}.`);
    }, { secondary: true }),
    button("Exit Builder", async () => {
      await save();
      ctx.setPage?.("Setup");
      say("Draft saved; Setup edits the same spec.");
    }, { secondary: true }),
  ));

  host.appendChild(status);
});

mount.ownHeader = true;
// Ten steps, one visible at a time: the completion cannot see the other nine.
mount.specComplete = true;
registerPage("Build New", { mount });
