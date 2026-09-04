import {
  buildSurface, planGrid, surfaceStl, domainStl, stlStats,
  gmshScript, femSpec, makeLocalFrame, DEFAULT_MATERIALS,
  nativeStepM,
} from "./model-build.js?v=20260904-8512f2d";
import { ringsFromCollection } from "./extraction.js?v=20260904-8512f2d";

/**
 * The Model Builder tab: the GIS study area becomes a meshable domain.
 *
 * It is a PIPELINE rather than a panel of controls, and the tab reads as one —
 * six numbered steps, each unlocked by the one before it, each stating what it
 * produced. That shape is the point: packaging a study for a solver is a
 * sequence of decisions where every later one depends on an earlier
 * (a boundary condition needs surfaces, and surfaces need a domain, and a
 * domain needs ground), and a flat panel of eighteen controls hides that
 * order behind the reader's own guesswork.
 *
 * What each step contributes to the run, so the chain is legible:
 *
 *   1 Study area  → WHERE. The drawn shape or any polygon layer; the model is
 *                   the box over it.
 *   2 Layers      → WHAT. Every workspace layer takes a role — surface
 *                   elevation, initial condition, boundary condition, material
 *                   region, embedded points — plus the resolution.
 *   3 Surface     → the terrain, sampled at that resolution, written as an STL.
 *   4 Domain      → solid / fluid / gas / thermal, its depth and its materials.
 *   5 Conditions  → which named boundary each condition acts on, and the points
 *                   the mesh must pass through.
 *   6 Build       → the domain STL, the gmsh script and `fem_runs/<run>/spec.json`
 *                   the FEM pages and the sidecar's deck prepare already read.
 *
 * The arithmetic all lives in `model-build.js`, which is pure and tested against
 * closed forms; this module is the panel and the project writes.
 */

const byId = (id) => document.getElementById(id);

const STEPS = [
  { id: "area", n: 1, title: "Study area", blurb: "Where the model is." },
  { id: "layers", n: 2, title: "Layers and roles", blurb: "What goes into it." },
  { id: "surface", n: 3, title: "Surface", blurb: "The ground, as geometry." },
  { id: "domain", n: 4, title: "Domain", blurb: "What it is made of." },
  { id: "conditions", n: 5, title: "Conditions and points", blurb: "How it is driven." },
  { id: "build", n: 6, title: "Build", blurb: "Mesh and run specification." },
];

const ROLE_OPTIONS = [
  { id: "ignore", label: "Not in the model" },
  { id: "surface", label: "Surface elevation" },
  { id: "initial", label: "Initial condition" },
  { id: "boundary", label: "Boundary condition" },
  { id: "material", label: "Material region" },
  { id: "points", label: "Embedded points" },
];

const SURFACES = ["top", "base", "north", "south", "east", "west"];

const state = {
  bounds: null,
  roles: new Map(),
  pointDepth: new Map(),
  resolution: { mode: "native", stepM: 100 },
  nativeStepM: null,
  surface: null,
  domain: { type: "solid", depthM: 5000, materials: {} },
  conditions: [],
  outputs: null,
  open: "area",
};

/* ── The world underneath ────────────────────────────────────────────────── */

function viewer() {
  return window.GeoIDViewer || null;
}

function bodyRadiusKm() {
  return viewer()?.bodyRadiusKm || 6371.0088;
}

function loadedLayers() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((layer) => layer.status === "loaded");
}

/**
 * The elevation reader the surface is sampled through: a layer given the
 * "surface elevation" role, else this world's own DEM.
 *
 * The viewer's DEM is indexed 0-360 east, which is the trap every sampler in
 * this tree has to answer for.
 */
function elevationReader() {
  const chosen = loadedLayers().find((layer) =>
    state.roles.get(String(layer.id)) === "surface" && layer.sampler);
  if (chosen) {
    return {
      name: chosen.name,
      read: (lat, lon) => {
        const value = chosen.sampler(lat, lon);
        return Number.isFinite(value?.value) ? value.value
          : (Number.isFinite(value) ? value : NaN);
      },
    };
  }
  const v = viewer();
  if (!v?.sampleElevationMeters) return null;
  return {
    name: "this world's DEM",
    read: (lat, lon) => {
      const lon360 = ((lon % 360) + 360) % 360;
      const value = v.sampleElevationMeters(lat, lon360);
      return Number.isFinite(value) ? value : NaN;
    },
  };
}

/**
 * The DEM's own sample spacing, MEASURED rather than declared.
 *
 * The sampler interpolates bilinearly, so between two pixel centres the values
 * run exactly linearly and every kink in the second difference is a pixel
 * boundary. Walking a short line and taking the median spacing of those kinks
 * is therefore the raster's native resolution, and it needs no seam any viewer
 * would have to grow. Over flat ground there are no kinks to find and it says
 * so rather than inventing a number — "native" then falls back to the study's
 * own size, which is the honest default.
 */
/**
 * Moved into model-build.js, which is the pure half and is what the terrain
 * TOOL imports too — the Surface step and that tool must quote the same
 * number, and two copies of a measurement is how they stop doing so.
 */
function probeNativeStepM(read, lat, lon) {
  return nativeStepM({ read, lat, lon, radiusKm: bodyRadiusKm() });
}

/* ── Bounds ──────────────────────────────────────────────────────────────── */

function polygonLayers() {
  return loadedLayers().filter((layer) => (layer.collection?.features || [])
    .some((f) => f?.geometry?.type === "Polygon" || f?.geometry?.type === "MultiPolygon"));
}

function boundsOfRings(rings) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  rings.forEach((ring) => ring.vertices.forEach((v) => {
    const lon = v.lon > 180 ? v.lon - 360 : v.lon;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, v.lat);
    north = Math.max(north, v.lat);
  }));
  return { west, east, south, north };
}

function resolveBounds(value) {
  if (value && value.startsWith("layer:")) {
    const layer = loadedLayers().find((l) => String(l.id) === value.slice(6));
    if (!layer?.collection) return { error: "That layer is no longer loaded." };
    const rings = ringsFromCollection(layer.collection);
    if (!rings.length) return { error: "That layer holds no polygons." };
    return { label: layer.name, rings, bbox: boundsOfRings(rings), layerId: String(layer.id) };
  }
  const v = viewer();
  const geometry = v?.getExtractionGeometry?.("study") || v?.getExtractionGeometry?.("buffer");
  if (!geometry) {
    return { error: "Draw a study area on the globe, or pick a polygon layer." };
  }
  const rings = [{ vertices: geometry.vertices, holes: [], center: geometry.center }];
  return { label: "the drawn area", rings, bbox: boundsOfRings(rings), layerId: null };
}

/* ── Step readiness: the pipeline's own rule ─────────────────────────────── */

function blockedReason(stepId) {
  if (stepId === "area") return null;
  if (!state.bounds) return "Choose the study area first.";
  if (stepId === "layers") return null;
  if (stepId === "surface") return null;
  if (!state.surface) return "Build the surface first — the domain sits under it.";
  if (stepId === "domain") return null;
  if (stepId === "conditions") return null;
  return null;
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

function fmt(value, digits = 1) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(labelText, control) {
  const wrap = el("label", "row");
  wrap.appendChild(el("span", null, labelText));
  wrap.appendChild(control);
  return wrap;
}

function select(id, options, value) {
  const node = el("select", "input");
  node.id = id;
  options.forEach((option) => {
    const opt = el("option", null, option.label);
    opt.value = option.id;
    node.appendChild(opt);
  });
  if (value !== undefined && [...node.options].some((o) => o.value === value)) {
    node.value = value;
  }
  return node;
}

function number(id, value, step) {
  const node = el("input", "input");
  node.id = id;
  node.type = "number";
  node.value = String(value);
  if (step) node.step = String(step);
  return node;
}

function say(stepId, message) {
  const node = byId(`gis-mb-status-${stepId}`);
  if (node) node.textContent = message;
}

function stepDone(stepId) {
  if (stepId === "area") return Boolean(state.bounds);
  if (stepId === "layers") return Boolean(state.bounds);
  if (stepId === "surface") return Boolean(state.surface);
  if (stepId === "domain") return Boolean(state.surface);
  if (stepId === "conditions") return Boolean(state.surface);
  if (stepId === "build") return Boolean(state.outputs);
  return false;
}

function render() {
  const host = byId("gis-mesh-body");
  if (!host) return;
  let wrap = byId("gis-model-pipeline");
  if (!wrap) {
    wrap = el("div", null);
    wrap.id = "gis-model-pipeline";
    host.appendChild(wrap);
  }
  wrap.innerHTML = "";

  STEPS.forEach((step) => {
    const blocked = blockedReason(step.id);
    const section = el("details", "control-section gis-tool-section gis-mb-step");
    section.dataset.step = step.id;
    if (state.open === step.id && !blocked) section.open = true;
    if (blocked) section.classList.add("is-blocked");
    if (stepDone(step.id)) section.classList.add("is-done");

    const summary = el("summary", "section-toggle");
    // The step NUMBER is this card's mark, so claim the shared icon painter's
    // own opt-out rather than letting it add its fallback bracket beside it:
    // two glyphs for one heading, and the bracket says nothing the number does
    // not. (side-panels' paintToolIcons skips a summary already stamped.)
    summary.dataset.toolIcon = "1";
    const main = el("div", "section-toggle-main");
    const heading = el("div", "section-heading");
    const title = el("div", "section-title");
    const titleRow = el("span", "section-title-row");
    const chip = el("span", "gis-mb-num", stepDone(step.id) ? "✓" : String(step.n));
    titleRow.appendChild(chip);
    titleRow.appendChild(el("span", null, step.title));
    title.appendChild(titleRow);
    heading.appendChild(title);
    main.appendChild(heading);
    summary.appendChild(main);
    section.appendChild(summary);

    const body = el("div", "section-body gis-tool-body");
    body.appendChild(el("p", "tool-copy gis-mb-blurb", step.blurb));
    if (blocked) {
      body.appendChild(el("div", "gis-metric", blocked));
    } else {
      buildStep(step.id, body);
    }
    const status = el("div", "gis-metric");
    status.id = `gis-mb-status-${step.id}`;
    body.appendChild(status);
    section.appendChild(body);

    section.addEventListener("toggle", () => {
      if (section.open) state.open = step.id;
    });
    wrap.appendChild(section);
  });

  STEP_STATUS.forEach((message, id) => say(id, message));
}

// Status survives the redraw the way the Research Hub's does: the message is
// about what the step produced, and a rebuild is not a reason to forget it.
const STEP_STATUS = new Map();
function report(stepId, message) {
  STEP_STATUS.set(stepId, message);
  say(stepId, message);
}

/* ── The steps ───────────────────────────────────────────────────────────── */

function buildStep(stepId, body) {
  if (stepId === "area") return stepArea(body);
  if (stepId === "layers") return stepLayers(body);
  if (stepId === "surface") return stepSurface(body);
  if (stepId === "domain") return stepDomain(body);
  if (stepId === "conditions") return stepConditions(body);
  return stepBuild(body);
}

function stepArea(body) {
  const options = [{ id: "drawn", label: "Drawn / boxed study area" }];
  polygonLayers().forEach((layer) => {
    options.push({ id: `layer:${layer.id}`, label: `▱ ${layer.name}` });
  });
  const picker = select("gis-mb-area", options,
    state.bounds?.layerId ? `layer:${state.bounds.layerId}` : "drawn");
  body.appendChild(row("Study area", picker));

  const use = el("button", "tool-button", "Use this area");
  use.type = "button";
  use.addEventListener("click", () => {
    const resolved = resolveBounds(picker.value);
    if (resolved.error) {
      state.bounds = null;
      report("area", resolved.error);
      render();
      return;
    }
    state.bounds = resolved;
    state.surface = null;
    state.outputs = null;
    const plan = planGrid({
      bounds: resolved.bbox, stepM: 100, radiusKm: bodyRadiusKm(),
    });
    report("area", `${resolved.label} — model domain ${fmt(plan.widthM / 1000, 2)}`
      + ` × ${fmt(plan.heightM / 1000, 2)} km. The domain is the BOX over the shape:`
      + " a mesh that follows a hand-drawn outline inherits every jag as a sliver.");
    state.open = "layers";
    render();
  });
  body.appendChild(use);
}

function stepLayers(body) {
  const layers = loadedLayers();
  if (!layers.length) {
    body.appendChild(el("div", "gis-metric", "No layers loaded — add data in Workspace."));
  }
  layers.forEach((layer) => {
    const id = String(layer.id);
    if (!state.roles.has(id)) state.roles.set(id, defaultRole(layer));
    const picker = select(`gis-mb-role-${id}`, ROLE_OPTIONS, state.roles.get(id));
    picker.addEventListener("change", () => {
      state.roles.set(id, picker.value);
      state.surface = null;
      render();
    });
    body.appendChild(row(layer.name, picker));
    if (state.roles.get(id) === "points") {
      const depth = number(`gis-mb-depth-${id}`, state.pointDepth.get(id) ?? 0, 10);
      depth.addEventListener("input", () => {
        state.pointDepth.set(id, Number(depth.value) || 0);
      });
      body.appendChild(row("  ↳ metres below surface", depth));
    }
  });

  const reader = elevationReader();
  body.appendChild(el("div", "gis-metric", reader
    ? `Elevation from ${reader.name}.`
    : "No elevation source — this world exposes no DEM."));

  const modeOptions = [
    { id: "native", label: "Native (the source's own sampling)" },
    { id: "step", label: "Fixed step (metres)" },
  ];
  const mode = select("gis-mb-res-mode", modeOptions, state.resolution.mode);
  body.appendChild(row("Resolution", mode));
  const stepField = number("gis-mb-res-step", state.resolution.stepM, 10);
  const stepRow = row("Step (m)", stepField);
  stepRow.hidden = state.resolution.mode !== "step";
  body.appendChild(stepRow);
  mode.addEventListener("change", () => {
    state.resolution.mode = mode.value;
    stepRow.hidden = mode.value !== "step";
    state.surface = null;
  });
  stepField.addEventListener("input", () => {
    state.resolution.stepM = Number(stepField.value) || 100;
    state.surface = null;
  });

  const probe = el("button", "button secondary", "Measure native resolution");
  probe.type = "button";
  probe.addEventListener("click", () => {
    if (!reader || !state.bounds) {
      report("layers", "Choose a study area with an elevation source first.");
      return;
    }
    const centre = {
      lat: (state.bounds.bbox.south + state.bounds.bbox.north) / 2,
      lon: (state.bounds.bbox.west + state.bounds.bbox.east) / 2,
    };
    const measured = probeNativeStepM(reader.read, centre.lat, centre.lon);
    state.nativeStepM = measured;
    report("layers", measured
      ? `Native sampling is about ${fmt(measured)} m — measured from where the`
        + " source's own interpolation kinks, not declared."
      : "The elevation here is too flat to measure a native step; the study's"
        + " own size sets the resolution instead.");
    // The Surface step quotes this number, and it was built before the
    // measurement existed.
    render();
  });
  body.appendChild(probe);
}

function defaultRole(layer) {
  if (layer.source?.text || (layer.collection?.features || [])
    .every((f) => f?.geometry?.type === "Point")) {
    return (layer.collection?.features || []).length ? "points" : "ignore";
  }
  return "ignore";
}

/**
 * The step the surface is sampled at, and whether it is finer than the source.
 *
 * A global DEM has kilometre pixels; a 10 km study area is a fraction of one.
 * Sampling it at 80 m is legitimate — a mesh needs geometry, and interpolating
 * between DEM samples is how you get a smooth one — but it is NOT new detail,
 * and the step says so rather than letting a 121 x 121 grid imply the ground
 * was measured that finely. Same discipline as the imagery zoom ceiling: a
 * server answering is not the sensor having seen it.
 */
function resolutionPlan() {
  const plan = planGrid({ bounds: state.bounds.bbox, stepM: 1, radiusKm: bodyRadiusKm() });
  const span = Math.max(plan.widthM, plan.heightM);
  // A surface needs enough nodes to be a surface, whatever the source's own
  // sampling: eight cells across is the floor below which a "mesh" is a box.
  const meshFloor = span / 120;
  if (state.resolution.mode === "step") {
    const chosen = Math.max(state.resolution.stepM, 1);
    return { stepM: chosen, interpolated: state.nativeStepM ? chosen < state.nativeStepM : false };
  }
  if (state.nativeStepM) {
    if (state.nativeStepM <= span / 8) {
      return { stepM: state.nativeStepM, interpolated: false };
    }
    return { stepM: meshFloor, interpolated: true, coarserThanStudy: true };
  }
  return { stepM: meshFloor, interpolated: false, unmeasured: true };
}

function stepSurface(body) {
  const reader = elevationReader();
  const res = resolutionPlan();
  const plan = planGrid({ bounds: state.bounds.bbox, stepM: res.stepM, radiusKm: bodyRadiusKm() });
  body.appendChild(el("div", "gis-metric",
    `${plan.nx} × ${plan.ny} nodes at ${fmt(plan.stepXm)} × ${fmt(plan.stepYm)} m`
    + `${plan.capped ? " (coarsened to stay inside the node budget)" : ""}.`
    + (res.coarserThanStudy
      ? ` The source samples every ${fmt(state.nativeStepM / 1000, 2)} km — coarser than`
        + " this whole study area, so the surface is INTERPOLATED between DEM samples."
        + " That is a smooth mesh, not new ground detail."
      : res.interpolated
        ? ` Finer than the source's own ${fmt(state.nativeStepM)} m sampling: interpolated,`
          + " not new detail."
        : res.unmeasured
          ? " Measure the native resolution in step 2 to know whether this is detail"
            + " or interpolation."
          : " At the source's own sampling.")));

  const build = el("button", "tool-button", "Build surface");
  build.type = "button";
  build.addEventListener("click", () => {
    if (!reader) {
      report("surface", "No elevation source to sample.");
      return;
    }
    report("surface", "Sampling…");
    window.requestAnimationFrame(() => {
      // Read at PRESS time, never from the render that drew the button: the
      // native measurement in step 2 happens after this card is built, and a
      // closed-over step silently sampled at the pre-measurement resolution.
      const live = resolutionPlan();
      const grid = buildSurface({
        bounds: state.bounds.bbox,
        stepM: live.stepM,
        radiusKm: bodyRadiusKm(),
        sampleElevation: reader.read,
      });
      if (!grid.ok) {
        state.surface = null;
        report("surface", grid.message);
        render();
        return;
      }
      state.surface = grid;
      state.outputs = null;
      const skin = stlStats(surfaceStl(grid));
      report("surface", `${grid.nx} × ${grid.ny} nodes, ${fmt(grid.stepXm)} m spacing,`
        + ` elevation ${fmt(grid.zMin)} to ${fmt(grid.zMax)} m`
        + ` (relief ${fmt(grid.reliefM)} m) — ${skin.triangles.toLocaleString()} triangles`
        + `${grid.filledNodes ? `, ${grid.filledNodes} node(s) filled with the area mean` : ""}.`);
      state.open = "domain";
      render();
    });
  });
  body.appendChild(build);

  if (state.surface) {
    const download = el("button", "button secondary", "Download surface STL");
    download.type = "button";
    download.addEventListener("click", () => {
      downloadText(`${modelName()}_surface.stl`, surfaceStl(state.surface, modelName()));
    });
    body.appendChild(download);
  }
}

function stepDomain(body) {
  const kinds = [
    { id: "solid", label: "Solid (elastostatic — deformation)" },
    { id: "fluid", label: "Fluid (incompressible flow)" },
    { id: "gas", label: "Gas (compressible / atmospheric)" },
    { id: "thermal", label: "Thermal (heat conduction)" },
  ];
  const kind = select("gis-mb-domain", kinds, state.domain.type);
  body.appendChild(row("Domain", kind));

  const depth = number("gis-mb-depth", state.domain.depthM, 100);
  body.appendChild(row("Depth below the lowest ground (m)", depth));
  depth.addEventListener("input", () => {
    state.domain.depthM = Number(depth.value) || 1000;
    state.outputs = null;
  });

  const host = el("div", null);
  body.appendChild(host);
  const drawMaterials = () => {
    host.innerHTML = "";
    const type = state.domain.type;
    const base = DEFAULT_MATERIALS[type] || DEFAULT_MATERIALS.solid;
    const chosen = state.domain.materials[type] || { ...base };
    state.domain.materials[type] = chosen;
    Object.keys(base).forEach((key) => {
      const field = number(`gis-mb-mat-${key}`, chosen[key], "any");
      field.addEventListener("input", () => {
        chosen[key] = Number(field.value);
        state.outputs = null;
      });
      body.appendChild(row(MATERIAL_LABELS[key] || key, field));
      host.appendChild(field.parentElement);
    });
  };
  kind.addEventListener("change", () => {
    state.domain.type = kind.value;
    state.outputs = null;
    render();
  });
  drawMaterials();

  if (state.surface) {
    const baseZ = state.surface.zMin - Math.max(state.domain.depthM, 1);
    body.appendChild(el("div", "gis-metric",
      `The block runs from ${fmt(baseZ)} m at its base to ${fmt(state.surface.zMax)} m`
      + ` at the highest ground — ${fmt(state.surface.zMax - baseZ)} m thick.`));
  }
}

const MATERIAL_LABELS = {
  density: "Density (kg/m³)",
  young: "Young's modulus (Pa)",
  poisson: "Poisson's ratio",
  viscosity: "Dynamic viscosity (Pa·s)",
};

function stepConditions(body) {
  body.appendChild(el("p", "tool-copy",
    "A condition names one of the mesh's own boundary surfaces. The build script"
    + " creates them as physical groups, so these names are what the solver reads."));

  const list = el("div", null);
  body.appendChild(list);

  const drawList = () => {
    list.innerHTML = "";
    if (!state.conditions.length) {
      list.appendChild(el("div", "gis-metric", "No conditions yet."));
    }
    state.conditions.forEach((bc, index) => {
      const card = el("div", "gis-tool-grid");
      const surface = select(`gis-mb-bc-surface-${index}`,
        SURFACES.map((s) => ({ id: s, label: s })), bc.surface);
      surface.addEventListener("change", () => { bc.surface = surface.value; state.outputs = null; });
      const kind = select(`gis-mb-bc-kind-${index}`, [
        { id: "dirichlet", label: "Fixed value (Dirichlet)" },
        { id: "neumann", label: "Flux / traction (Neumann)" },
        { id: "initial", label: "Initial condition" },
      ], bc.type);
      kind.addEventListener("change", () => { bc.type = kind.value; state.outputs = null; });
      const field = el("input", "input");
      field.value = bc.field || "";
      field.placeholder = "quantity, e.g. displacement";
      field.addEventListener("input", () => { bc.field = field.value; state.outputs = null; });
      const value = el("input", "input");
      value.value = bc.value ?? "";
      value.placeholder = "value";
      value.addEventListener("input", () => { bc.value = value.value; state.outputs = null; });
      card.appendChild(row("Surface", surface));
      card.appendChild(row("Type", kind));
      card.appendChild(row("Quantity", field));
      card.appendChild(row("Value", value));
      const remove = el("button", "button secondary", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        state.conditions.splice(index, 1);
        state.outputs = null;
        drawList();
      });
      card.appendChild(remove);
      if (bc.source) card.appendChild(el("div", "gis-metric", `From ${bc.source}.`));
      list.appendChild(card);
    });
  };

  const add = el("button", "button secondary", "Add a condition");
  add.type = "button";
  add.addEventListener("click", () => {
    state.conditions.push({ surface: "base", type: "dirichlet", field: "", value: "" });
    state.outputs = null;
    drawList();
  });
  body.appendChild(add);

  // Layers given a condition role seed rows rather than being silently ignored:
  // step 2 is where somebody said this layer drives the model, and this is the
  // step where that has to become something the solver can read.
  const seeds = loadedLayers().filter((layer) =>
    ["initial", "boundary"].includes(state.roles.get(String(layer.id))));
  if (seeds.length) {
    const seed = el("button", "button secondary",
      `Seed from ${seeds.length} assigned layer${seeds.length === 1 ? "" : "s"}`);
    seed.type = "button";
    seed.addEventListener("click", () => {
      seeds.forEach((layer) => {
        const role = state.roles.get(String(layer.id));
        if (state.conditions.some((bc) => bc.source === layer.name)) return;
        state.conditions.push({
          surface: role === "initial" ? "top" : "base",
          type: role === "initial" ? "initial" : "dirichlet",
          field: "",
          value: "",
          source: layer.name,
        });
      });
      state.outputs = null;
      drawList();
    });
    body.appendChild(seed);
  }
  drawList();

  const points = embeddedPoints();
  body.appendChild(el("div", "gis-metric", points.length
    ? `${points.length} point${points.length === 1 ? "" : "s"} will be embedded in the`
      + " mesh — the solver gets a node exactly there."
    : "No embedded points. Give a point layer the \"Embedded points\" role in step 2."));
}

/**
 * The points the mesh must pass through, in the model's own metric frame.
 *
 * A site, a borehole or a probe is only useful if the mesh has a node AT it —
 * otherwise every reading downstream is an interpolation nobody asked for.
 * Depth is measured from the ground the surface step sampled, so "50 m below
 * the surface" means below the terrain rather than below sea level.
 */
function embeddedPoints() {
  if (!state.surface) return [];
  const grid = state.surface;
  const frame = makeLocalFrame({
    lat: grid.origin.lat, lon: grid.origin.lon, radiusKm: bodyRadiusKm(),
  });
  const groundAt = (lat, lon) => {
    const i = Math.round(((lon - grid.lons[0]) / (grid.lons[grid.nx - 1] - grid.lons[0]))
      * (grid.nx - 1));
    const j = Math.round(((lat - grid.lats[0]) / (grid.lats[grid.ny - 1] - grid.lats[0]))
      * (grid.ny - 1));
    if (!(i >= 0 && i < grid.nx && j >= 0 && j < grid.ny)) return null;
    return grid.z[j * grid.nx + i];
  };
  const out = [];
  loadedLayers().forEach((layer) => {
    if (state.roles.get(String(layer.id)) !== "points") return;
    const depth = state.pointDepth.get(String(layer.id)) || 0;
    (layer.collection?.features || []).forEach((f, index) => {
      if (f?.geometry?.type !== "Point") return;
      const [lon, lat] = f.geometry.coordinates;
      const ground = groundAt(lat, lon);
      if (ground === null) return;
      const local = frame.toLocal(lat, lon);
      out.push({
        x: local.x,
        y: local.y,
        z: ground - depth,
        // Strictly inside: a point ON the top surface is not in the volume, and
        // gmsh refuses to embed it there.
        sizeM: Math.max(grid.stepXm / 3, 1),
        name: String(f.properties?.name || f.properties?.site || `${layer.name}_${index + 1}`),
        layer: layer.name,
        lat,
        lon,
        depthM: depth,
      });
    });
  });
  return out;
}

function modelName() {
  const label = state.bounds?.label || "model";
  return `geoid_${String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`.slice(0, 48);
}

function stepBuild(body) {
  const runField = el("input", "input");
  runField.id = "gis-mb-run";
  runField.value = state.runName || `${modelName()}_run`;
  runField.addEventListener("input", () => { state.runName = runField.value; });
  body.appendChild(row("Run name", runField));

  const sizeField = number("gis-mb-meshsize", state.meshSizeM
    || Math.round((state.surface?.stepXm || 100) * 2), 10);
  body.appendChild(row("Mesh element size (m)", sizeField));
  sizeField.addEventListener("input", () => { state.meshSizeM = Number(sizeField.value); });

  const build = el("button", "tool-button", "Build model package");
  build.type = "button";
  build.addEventListener("click", () => { void writePackage(); });
  body.appendChild(build);

  if (state.outputs) {
    const files = el("div", "gis-metric",
      `Wrote ${state.outputs.files.join(", ")}.`);
    body.appendChild(files);

    const mesh = el("button", "button secondary", "Mesh now in the sidecar");
    mesh.type = "button";
    mesh.addEventListener("click", () => { void meshInSidecar(); });
    body.appendChild(mesh);

    const dl = el("button", "button secondary", "Download the gmsh script");
    dl.type = "button";
    dl.addEventListener("click", () => {
      downloadText(`${modelName()}_gmsh.py`, state.outputs.script, "text/x-python");
    });
    body.appendChild(dl);
  }
}

/* ── Writing the package ─────────────────────────────────────────────────── */

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function writePackage() {
  const grid = state.surface;
  if (!grid) {
    report("build", "Build the surface first.");
    return;
  }
  const name = modelName();
  const run = state.runName || `${name}_run`;
  const meshSizeM = Number(state.meshSizeM) || Math.round(grid.stepXm * 2);
  const domain = domainStl(grid, { depthM: state.domain.depthM, name });
  const stats = stlStats(domain.text);
  const points = embeddedPoints();
  const script = gmshScript({
    name,
    stlFile: `${name}_domain.stl`,
    meshFile: `${name}.msh`,
    meshSizeM,
    minSizeM: Math.max(meshSizeM / 8, 1),
    embedPoints: points,
  });

  const spec = femSpec({
    run,
    mesh: `${name}.msh`,
    domain: state.domain.type,
    dim: 3,
    time: {},
    materials: {
      solid: state.domain.materials.solid,
      fluid: state.domain.materials.fluid || state.domain.materials.gas,
    },
    initial: {},
    boundary: state.conditions,
    provenance: {
      study_area: state.bounds.label,
      body: viewer()?.bodyName || undefined,
      body_radius_km: bodyRadiusKm(),
      bounds_deg: state.bounds.bbox,
      origin: grid.origin,
      extent_m: { width: grid.widthM, height: grid.heightM },
      resolution_m: { x: grid.stepXm, y: grid.stepYm, requested: grid.requestedStepM },
      elevation_m: { min: grid.zMin, max: grid.zMax, relief: grid.reliefM },
      base_z_m: domain.baseZ,
      nodes: grid.nodes,
      filled_nodes: grid.filledNodes,
      surface_triangles: stats.triangles,
      watertight: stats.closed,
      embedded_points: points.map((p) => ({
        name: p.name, layer: p.layer, lat: p.lat, lon: p.lon,
        x: p.x, y: p.y, z: p.z, depth_below_surface_m: p.depthM,
      })),
      layers: loadedLayers().map((l) => ({
        name: l.name, role: state.roles.get(String(l.id)) || "ignore",
      })).filter((l) => l.role !== "ignore"),
      built_at: new Date().toISOString(),
    },
  });

  state.outputs = { script, spec, domainText: domain.text, files: [] };

  const store = window.GeoIDResearch?.store;
  const project = store?.getActive?.();
  if (!project) {
    downloadText(`${name}_domain.stl`, domain.text);
    downloadText(`${name}_gmsh.py`, script, "text/x-python");
    downloadText(`${run}_spec.json`, JSON.stringify(spec, null, 2), "application/json");
    state.outputs.files = ["downloads (no project open)"];
    report("build", "No project open — the package was downloaded instead. Open a"
      + " project and press again to file it where the FEM pages read.");
    render();
    return;
  }

  try {
    // meshes/ is where the sidecar's gmsh job runs and where FEM Setup and the
    // GALES deck prepare already look for a .msh; the input that will make the
    // mesh belongs beside it.
    await store.writeProjectFile(`meshes/${name}_surface.stl`, surfaceStl(grid, name));
    await store.writeProjectFile(`meshes/${name}_domain.stl`, domain.text);
    await store.writeProjectFile(`meshes/${name}_gmsh.py`, script);
    await store.writeProjectFile(`fem_runs/${run}/spec.json`, JSON.stringify(spec, null, 2));
    state.outputs.files = [
      `meshes/${name}_surface.stl`,
      `meshes/${name}_domain.stl`,
      `meshes/${name}_gmsh.py`,
      `fem_runs/${run}/spec.json`,
    ];
    report("build", `${stats.triangles.toLocaleString()} triangles,`
      + ` ${stats.closed ? "watertight" : `${stats.openEdges} OPEN EDGES — gmsh will refuse this`}.`
      + ` ${points.length} embedded point(s). Written into ${project.name}.`);
  } catch (error) {
    report("build", `Could not write into the project: ${error.message}`);
  }
  render();
}

async function meshInSidecar() {
  const sidecar = window.GeoIDResearch?.sidecar;
  const store = window.GeoIDResearch?.store;
  const project = store?.getActive?.();
  if (!sidecar?.isConnected?.()) {
    report("build", "gmsh runs in the local sidecar — connect it in Settings, or"
      + " download the script and run it yourself.");
    return;
  }
  if (!project) {
    report("build", "Open a project first — the mesh is written into its meshes/.");
    return;
  }
  try {
    report("build", "Meshing in gmsh…");
    const jobId = await sidecar.runGmsh({
      project: project.folder || project.name,
      script: state.outputs.script,
      name: modelName(),
      dim: 3,
    });
    const snap = await sidecar.awaitJob(jobId);
    report("build", snap?.exit === 0
      ? `Meshed. ${modelName()}.msh is in meshes/ — FEM Setup and the GALES deck`
        + " prepare will find it."
      : `gmsh exited ${snap?.exit}. Its log is in the Jobs drawer.`);
  } catch (error) {
    report("build", `gmsh job failed: ${error.message}`);
  }
}

/* ── Style ───────────────────────────────────────────────────────────────── */

const STYLE = [
  "#gis-model-pipeline { display: grid; gap: 0.65rem; }",
  ".gis-mb-num {",
  "  display: inline-flex; align-items: center; justify-content: center;",
  "  width: 1.15rem; height: 1.15rem; border-radius: 999px; flex: 0 0 auto;",
  "  font: 700 0.62rem 'Exo 2','Segoe UI',sans-serif;",
  "  border: 1px solid rgba(var(--nav-accent-rgb, 255,43,214), 0.55);",
  "  color: var(--skin-data, var(--skin-data));",
  "}",
  ".gis-mb-step.is-done > summary .gis-mb-num {",
  "  background: rgba(var(--skin-data-rgb), 0.22); color: var(--skin-data, var(--skin-data));",
  "}",
  ".gis-mb-step.is-blocked > summary { opacity: 0.55; }",
  ".gis-mb-blurb { margin: 0 0 0.3rem; opacity: 0.75; }",
].join("\n");

/* ── Boot ────────────────────────────────────────────────────────────────── */

function init() {
  if (!byId("gis-model-pipeline-style")) {
    const style = document.createElement("style");
    style.id = "gis-model-pipeline-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  // The tab is built by add-data.js, which may not have run yet; the panels
  // rebuild constantly, so this polls for its host the way the icon painter and
  // the Earth-data cards do rather than racing one event.
  let tries = 0;
  const tick = () => {
    tries += 1;
    if (byId("gis-mesh-body")) {
      if (!byId("gis-model-pipeline")) render();
      return;
    }
    if (tries < 200) setTimeout(tick, 250);
  };
  tick();
  window.GeoIDImportManager?.onChange?.(() => {
    if (byId("gis-model-pipeline")) render();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDModelPipeline = {
  getState: () => state,
  render,
  build: writePackage,
  embeddedPoints,
};
