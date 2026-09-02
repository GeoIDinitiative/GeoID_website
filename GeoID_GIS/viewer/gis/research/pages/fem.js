import { registerPage } from "../stages.js?v=20260902-84c403f";
import * as store from "../project-store.js?v=20260902-84c403f";
import { needProject } from "./common.js?v=20260902-84c403f";

/**
 * FEM: Setup, Properties and IC/BC.
 *
 * The browser cannot run GALES -- it is a native solver -- so these pages do
 * not pretend to. They write a run specification into fem_runs/<run>/spec.json
 * for the desktop app or a scheduler to pick up and execute, and read results
 * back out of the same folder. Configuration here, execution there, one folder
 * between them.
 *
 * The spec is deliberately plain JSON with no browser-specific fields, so
 * anything can consume it.
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function card(title) {
  const box = el("section", "research-card");
  box.appendChild(el("h2", "research-card-title", title));
  return box;
}

function field(label, node) {
  const row = el("label", "research-field");
  row.appendChild(el("span", "research-field-label", label));
  row.appendChild(node);
  return row;
}

function input(value, type = "text") {
  const node = document.createElement("input");
  node.className = "input";
  node.type = type;
  if (type === "number") node.step = "any";
  node.value = value ?? "";
  return node;
}

function selectOf(values, selected) {
  const node = document.createElement("select");
  node.className = "input";
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = String(v); opt.textContent = String(v);
    node.appendChild(opt);
  });
  if (selected != null) node.value = String(selected);
  return node;
}


const SPEC_DEFAULT = {
  solver: "gales",
  physics: "fsi",
  run: "",
  mesh: "",
  time: { scheme: "bdf2", start: 0, end: 10, step: 0.01 },
  properties: {
    fluid: { density: 1000, viscosity: 1e-3 },
    solid: { density: 2700, young: 5e10, poisson: 0.25 },
  },
  initial: { velocity: [0, 0, 0], pressure: 0, temperature: 293.15 },
  boundary: [],
  created_by: "GeoID Research Hub (browser)",
};

async function loadSpec(runName) {
  const spec = await store.readJson(`fem_runs/${runName}/spec.json`, null);
  return spec ? { ...SPEC_DEFAULT, ...spec } : { ...SPEC_DEFAULT, run: runName };
}

async function listRuns() {
  try {
    const entries = await store.listProjectDir("fem_runs");
    return entries.filter((e) => e.kind === "directory").map((e) => e.name);
  } catch (error) {
    return [];
  }
}

async function listMeshes() {
  try {
    const entries = await store.listProjectDir("meshes");
    return entries.filter((e) => e.kind === "file").map((e) => e.name);
  } catch (error) {
    return [];
  }
}

/** One page per FEM section, all editing the same spec file. */
function makeFemPage(title, render) {
  return async function mount(host, ctx) {
    if (!store.getActive()) { needProject(host, ctx, title); return; }
    const status = el("p", "research-status");
    const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

    const runs = await listRuns();
    const runCard = card("Run");
    const runSelect = selectOf(runs.length ? runs : ["(none yet)"]);
    const newName = input("", "text");
    newName.placeholder = "New run name";
    const newBtn = el("button", "button", "Create run");
    newBtn.type = "button";
    const runRow = el("div", "gis-btn-row");
    runRow.append(newName, newBtn);
    runCard.append(field("Existing runs", runSelect), runRow);

    const body = card(title);
    const bodyForm = el("div", "research-form");
    body.appendChild(bodyForm);

    let spec = null;

    async function open(runName) {
      spec = await loadSpec(runName);
      bodyForm.textContent = "";
      const save = el("button", "button", "Save spec");
      save.type = "button";
      save.addEventListener("click", async () => {
        try {
          spec.run = runName;
          spec.updated_at = new Date().toISOString();
          await store.writeJson(`fem_runs/${runName}/spec.json`, spec);
          await store.registerData({
            name: `${runName}/spec.json`, kind: "fem-spec",
            path: `fem_runs/${runName}/spec.json`, source: "FEM setup",
          });
          say(`Saved fem_runs/${runName}/spec.json.`);
        } catch (error) {
          say(error.message, true);
        }
      });
      await render(bodyForm, spec, { say });
      const row = el("div", "gis-btn-row");
      row.appendChild(save);
      bodyForm.appendChild(row);
    }

    newBtn.addEventListener("click", async () => {
      const name = newName.value.trim().replace(/[^\w\-.]+/g, "_");
      if (!name) { say("Name the run first.", true); return; }
      await store.writeJson(`fem_runs/${name}/spec.json`, { ...SPEC_DEFAULT, run: name });
      newName.value = "";
      say(`Created fem_runs/${name}/.`);
      ctx.setPage?.(title);
    });
    runSelect.addEventListener("change", () => { void open(runSelect.value); });

    host.append(runCard, body, status);
    if (runs.length) {
      await open(runSelect.value);
    } else {
      bodyForm.appendChild(el("p", "research-note",
        "No runs yet. Create one above; it becomes a folder under fem_runs/ "
        + "with a spec.json the solver reads."));
    }
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

const mountSetup = makeFemPage("Setup", async (form, spec) => {
  const meshes = await listMeshes();
  const physics = selectOf(["fsi", "fluid", "solid", "thermal", "fsi-nonisothermal"], spec.physics);
  const mesh = selectOf(meshes.length ? meshes : ["(no meshes in project)"], spec.mesh);
  const scheme = selectOf(["bdf1", "bdf2", "generalised-alpha"], spec.time.scheme);
  const start = input(spec.time.start, "number");
  const end = input(spec.time.end, "number");
  const step = input(spec.time.step, "number");

  physics.addEventListener("change", () => { spec.physics = physics.value; });
  mesh.addEventListener("change", () => { spec.mesh = mesh.value; });
  scheme.addEventListener("change", () => { spec.time.scheme = scheme.value; });
  [["start", start], ["end", end], ["step", step]].forEach(([key, node]) => {
    node.addEventListener("input", () => { spec.time[key] = Number(node.value); });
  });

  form.append(field("Physics", physics), field("Mesh (from meshes/)", mesh),
    field("Time scheme", scheme));
  const grid = el("div", "research-grid-2");
  grid.append(field("Start time", start), field("End time", end), field("Time step", step));
  form.appendChild(grid);
  if (!meshes.length) {
    form.appendChild(el("p", "research-note",
      "No meshes in this project yet — build or import one in the Meshing Studio."));
  }
});

// ── Properties ───────────────────────────────────────────────────────────────

const mountProperties = makeFemPage("Properties", async (form, spec) => {
  const f = spec.properties.fluid;
  const s = spec.properties.solid;
  const density = input(f.density, "number");
  const viscosity = input(f.viscosity, "number");
  const sDensity = input(s.density, "number");
  const young = input(s.young, "number");
  const poisson = input(s.poisson, "number");

  density.addEventListener("input", () => { f.density = Number(density.value); });
  viscosity.addEventListener("input", () => { f.viscosity = Number(viscosity.value); });
  sDensity.addEventListener("input", () => { s.density = Number(sDensity.value); });
  young.addEventListener("input", () => { s.young = Number(young.value); });
  poisson.addEventListener("input", () => { s.poisson = Number(poisson.value); });

  const fluidBox = el("div", "research-subsection");
  fluidBox.appendChild(el("h3", "research-subtitle", "Fluid"));
  const fluidGrid = el("div", "research-grid-2");
  fluidGrid.append(field("Density (kg/m³)", density), field("Viscosity (Pa·s)", viscosity));
  fluidBox.appendChild(fluidGrid);

  const solidBox = el("div", "research-subsection");
  solidBox.appendChild(el("h3", "research-subtitle", "Solid"));
  const solidGrid = el("div", "research-grid-2");
  solidGrid.append(field("Density (kg/m³)", sDensity),
    field("Young's modulus (Pa)", young), field("Poisson ratio", poisson));
  solidBox.appendChild(solidGrid);

  form.append(fluidBox, solidBox);
});

// ── IC / BC ──────────────────────────────────────────────────────────────────

const mountIcBc = makeFemPage("IC/BC", async (form, spec, { say }) => {
  const ic = spec.initial;
  const vx = input(ic.velocity[0], "number");
  const vy = input(ic.velocity[1], "number");
  const vz = input(ic.velocity[2], "number");
  const pressure = input(ic.pressure, "number");
  const temperature = input(ic.temperature, "number");
  [vx, vy, vz].forEach((node, i) => node.addEventListener("input", () => {
    ic.velocity[i] = Number(node.value);
  }));
  pressure.addEventListener("input", () => { ic.pressure = Number(pressure.value); });
  temperature.addEventListener("input", () => { ic.temperature = Number(temperature.value); });

  const icBox = el("div", "research-subsection");
  icBox.appendChild(el("h3", "research-subtitle", "Initial conditions"));
  const icGrid = el("div", "research-grid-2");
  icGrid.append(field("Velocity x", vx), field("Velocity y", vy), field("Velocity z", vz),
    field("Pressure (Pa)", pressure), field("Temperature (K)", temperature));
  icBox.appendChild(icGrid);

  const bcBox = el("div", "research-subsection");
  bcBox.appendChild(el("h3", "research-subtitle", "Boundary conditions"));
  const list = el("div", "research-list");
  function drawList() {
    list.textContent = "";
    if (!spec.boundary.length) {
      list.appendChild(el("p", "research-note", "No boundary conditions yet."));
    }
    spec.boundary.forEach((bc, index) => {
      const row = el("div", "research-list-row");
      row.appendChild(el("span", "research-list-name", `${bc.surface}: ${bc.type} = ${bc.value}`));
      const remove = el("button", "button secondary", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => { spec.boundary.splice(index, 1); drawList(); });
      row.appendChild(remove);
      list.appendChild(row);
    });
  }
  const surface = input("", "text");
  surface.placeholder = "Surface / physical group";
  const type = selectOf(["dirichlet", "neumann", "traction", "no-slip", "outflow"]);
  const value = input("0", "text");
  const add = el("button", "button", "Add");
  add.type = "button";
  add.addEventListener("click", () => {
    if (!surface.value.trim()) { say("Name the surface first.", true); return; }
    spec.boundary.push({ surface: surface.value.trim(), type: type.value, value: value.value });
    surface.value = "";
    drawList();
  });
  const addGrid = el("div", "research-grid-2");
  addGrid.append(field("Surface", surface), field("Type", type), field("Value", value));
  const addRow = el("div", "gis-btn-row");
  addRow.appendChild(add);
  bcBox.append(list, addGrid, addRow);
  drawList();

  form.append(icBox, bcBox);
});

// ── Run Existing: what the solver left behind ────────────────────────────────

async function mountRun(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "Run Existing"); return; }
  const status = el("p", "research-status");
  const box = card("Runs");
  box.appendChild(el("p", "research-note",
    "The browser cannot execute a solver. These are the specs written here and "
    + "whatever the solver has written back into the same folders."));
  const list = el("div", "research-list");
  box.appendChild(list);

  const runs = await listRuns();
  if (!runs.length) {
    list.appendChild(el("p", "research-note", "No runs in this project."));
  }
  for (const run of runs) {
    const spec = await store.readJson(`fem_runs/${run}/spec.json`, null);
    let outputs = [];
    try {
      outputs = (await store.listProjectDir(`fem_runs/${run}`))
        .filter((e) => e.name !== "spec.json");
    } catch (error) { /* nothing written back yet */ }
    const row = el("div", "research-list-row");
    row.appendChild(el("span", "research-list-name",
      `${run} — ${spec ? `${spec.physics}, ${spec.time?.end ?? "?"} s` : "no spec"}`));
    row.appendChild(el("span", "research-list-tag",
      outputs.length ? `${outputs.length} output(s)` : "not run"));
    list.appendChild(row);
  }
  host.append(box, status);
}

registerPage("Setup", { mount: mountSetup });
registerPage("Properties", { mount: mountProperties });
registerPage("IC/BC", { mount: mountIcBc });
registerPage("Run Existing", { mount: mountRun });
