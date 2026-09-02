import { registerPage } from "../stages.js?v=20260902-84811cf";
import * as store from "../project-store.js?v=20260902-84811cf";
import * as sidecar from "../sidecar.js?v=20260902-84811cf";
import { parseTable } from "../table.js?v=20260902-84811cf";
import { linePlot, toPngBlob } from "../plot.js?v=20260902-84811cf";
import { needProject } from "./common.js?v=20260902-84811cf";

/**
 * Post Processing: degree-of-freedom time series at probe points, and the DOF
 * Wizard that specifies a new DOF for the solver.
 *
 * This is what closes the FEM loop. The FEM pages write a run spec; the solver
 * writes results back into the same folder; this page turns those results into
 * a time series at the points actually being asked about, and writes it into
 * post_processing/extracted_dofs/ as a CSV the Signal and Spectral pages can
 * read directly. Model output becomes a signal like any other.
 *
 * The extraction contract is the Qt app's (POST_PROCESS_INFO at app_qt.py:2825):
 * a long-format CSV with time, x, y, z, entity and a value column, probes given
 * as `name,x,y,z,entity`, and either nearest-node or inverse-distance
 * interpolation.
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

function input(value, placeholder = "") {
  const node = document.createElement("input");
  node.className = "input";
  node.value = value ?? "";
  if (placeholder) node.placeholder = placeholder;
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


// ── Extraction ───────────────────────────────────────────────────────────────

/** `name,x,y,z,entity` per line, as the Qt page documents. */
export function parseProbes(text) {
  const probes = [];
  String(text).split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const parts = trimmed.split(",").map((p) => p.trim());
    if (parts.length < 4) return;
    const [name, x, y, z] = parts;
    if (![x, y, z].every((v) => Number.isFinite(Number(v)))) return;
    probes.push({
      name, x: Number(x), y: Number(y), z: Number(z), entity: parts[4] || "",
    });
  });
  return probes;
}

/**
 * Inverse-distance interpolation over the eight nearest nodes, weight 1/d².
 * Ported from the Qt app's `_nearest_idw`, including its two behaviours worth
 * keeping: an exact coordinate hit short-circuits to that node's value rather
 * than averaging, and a probe with an entity id only sees nodes on that entity.
 */
export function idwSample(nodes, probe, { mode = "interpolated" } = {}) {
  const candidates = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (probe.entity && String(node.entity) !== String(probe.entity)) continue;
    const dx = node.x - probe.x;
    const dy = node.y - probe.y;
    const dz = node.z - probe.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 === 0) return node.value;
    candidates.push({ d2, value: node.value });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.d2 - b.d2);
  if (mode === "nearest") return candidates[0].value;
  const near = candidates.slice(0, Math.min(8, candidates.length));
  let wsum = 0;
  let vsum = 0;
  near.forEach(({ d2, value }) => {
    const w = 1 / Math.max(d2, 1e-14);
    wsum += w;
    vsum += w * value;
  });
  return wsum > 0 ? vsum / wsum : null;
}

/**
 * A long-format results table into one series per probe.
 * @returns {{times: number[], series: Array<{name: string, values: number[]}>}}
 */
export function extractSeries(table, probes, columns, { mode = "interpolated" } = {}) {
  const index = (name) => table.columns.indexOf(name);
  const ti = index(columns.time);
  const xi = index(columns.x);
  const yi = index(columns.y);
  const zi = index(columns.z);
  const ei = columns.entity ? index(columns.entity) : -1;
  const vi = index(columns.dof);
  if ([ti, xi, yi, zi, vi].some((i) => i < 0)) {
    throw new Error("One of the named columns is not in that file.");
  }

  // Grouped by timestep: each snapshot is interpolated on its own, which is
  // what makes the result a time series rather than a cloud.
  const byTime = new Map();
  table.rows.forEach((row) => {
    const t = Number(row[ti]);
    const value = Number(row[vi]);
    if (!Number.isFinite(t) || !Number.isFinite(value)) return;
    if (!byTime.has(t)) byTime.set(t, []);
    byTime.get(t).push({
      x: Number(row[xi]), y: Number(row[yi]), z: Number(row[zi]),
      entity: ei >= 0 ? row[ei] : "", value,
    });
  });

  const times = [...byTime.keys()].sort((a, b) => a - b);
  const series = probes.map((probe) => ({
    name: probe.name,
    values: times.map((t) => idwSample(byTime.get(t), probe, { mode })),
  }));
  return { times, series };
}

// ── Post Processing page ─────────────────────────────────────────────────────

async function findResults() {
  const found = [];
  const roots = ["fem_runs", "data/processed", "data/raw", "analysis"];
  for (const root of roots) {
    let entries = [];
    try { entries = await store.listProjectDir(root); } catch (error) { continue; }
    for (const entry of entries) {
      if (entry.kind === "file" && /\.(csv|tsv|dat)$/i.test(entry.name)) {
        found.push(`${root}/${entry.name}`);
      } else if (entry.kind === "directory" && root === "fem_runs") {
        // A run's own folder is where the solver writes back.
        let inner = [];
        try { inner = await store.listProjectDir(`${root}/${entry.name}`); } catch (e) { continue; }
        inner.filter((f) => f.kind === "file" && /\.(csv|tsv|dat)$/i.test(f.name))
          .forEach((f) => found.push(`${root}/${entry.name}/${f.name}`));
      }
    }
  }
  return found;
}

async function mountPostProcess(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "Post Processing"); return; }
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

  let table = null;
  let currentPath = "";
  let extracted = null;

  const sourceCard = card("FEM output");
  sourceCard.appendChild(el("p", "research-note",
    "A long-format CSV: one row per node per timestep, with time, coordinates, "
    + "an optional Gmsh entity id, and the value column to extract."));
  const files = await findResults();
  const fileSelect = selectOf(files.length ? files : ["(no result tables found)"]);
  const loadBtn = el("button", "button", "Load");
  loadBtn.type = "button";
  loadBtn.disabled = !files.length;
  const sourceRow = el("div", "gis-btn-row");
  sourceRow.append(fileSelect, loadBtn);
  sourceCard.appendChild(sourceRow);
  const columnsGrid = el("div", "research-grid-2");
  sourceCard.appendChild(columnsGrid);

  const colInputs = {};
  ["time", "x", "y", "z", "entity", "dof"].forEach((key) => {
    colInputs[key] = input(key === "dof" ? "" : key, key === "entity" ? "optional" : "");
    columnsGrid.appendChild(field(`${key} column`, colInputs[key]));
  });

  const probeCard = card("Probes");
  probeCard.appendChild(el("p", "research-note",
    "One per line: name,x,y,z,entity — the entity id is optional and restricts "
    + "the probe to nodes on that Gmsh entity."));
  const probeBox = document.createElement("textarea");
  probeBox.className = "input research-editor";
  probeBox.rows = 4;
  probeBox.placeholder = "P1,0.25,0.25,0.0,1\nP2,0.75,0.50,0.0,1";
  const modeSelect = selectOf(["interpolated", "nearest"], "interpolated");
  probeCard.append(probeBox, field("Extraction mode", modeSelect));

  const resultCard = card("Extracted series");
  const figure = el("div", "research-figure");
  const actions = el("div", "gis-btn-row");
  resultCard.append(actions, figure);

  loadBtn.addEventListener("click", async () => {
    currentPath = fileSelect.value;
    try {
      const text = await store.readProjectFile(currentPath);
      table = parseTable(typeof text === "string" ? text : "");
      // Offer the file's own column names rather than making them be typed.
      const guess = (candidates) => table.columns.find((c) =>
        candidates.some((k) => c.toLowerCase() === k)) || "";
      colInputs.time.value = guess(["time", "t"]) || colInputs.time.value;
      colInputs.x.value = guess(["x"]) || colInputs.x.value;
      colInputs.y.value = guess(["y"]) || colInputs.y.value;
      colInputs.z.value = guess(["z"]) || colInputs.z.value;
      colInputs.entity.value = guess(["entity", "entity_id", "tag"]);
      if (!colInputs.dof.value) {
        const used = new Set([colInputs.time.value, colInputs.x.value,
          colInputs.y.value, colInputs.z.value, colInputs.entity.value]);
        colInputs.dof.value = table.columns.find((c) => !used.has(c)) || "";
      }
      say(`${currentPath}: ${table.rows.length} rows, columns ${table.columns.join(", ")}.`);
    } catch (error) {
      say(error.message, true);
    }
  });

  const extractBtn = el("button", "button", "Extract");
  extractBtn.type = "button";
  extractBtn.addEventListener("click", () => {
    if (!table) { say("Load a results file first.", true); return; }
    const probes = parseProbes(probeBox.value);
    if (!probes.length) { say("Define at least one probe.", true); return; }
    try {
      extracted = extractSeries(table, probes, {
        time: colInputs.time.value, x: colInputs.x.value, y: colInputs.y.value,
        z: colInputs.z.value, entity: colInputs.entity.value, dof: colInputs.dof.value,
      }, { mode: modeSelect.value });
      figure.textContent = "";
      figure.appendChild(linePlot(extracted.series.map((s) => ({
        x: extracted.times, y: s.values, name: s.name,
      })), {
        labels: { x: "time (s)", y: colInputs.dof.value },
        title: `${currentPath.split("/").pop()} — ${modeSelect.value}`,
      }));
      const missing = extracted.series.filter((s) => s.values.every((v) => v === null));
      say(`${extracted.series.length} probe(s) over ${extracted.times.length} timesteps`
        + (missing.length ? `; ${missing.length} found no matching nodes.` : "."));
    } catch (error) {
      say(error.message, true);
    }
  });

  const saveBtn = el("button", "button secondary", "Save to extracted_dofs/");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => {
    if (!extracted) { say("Extract first.", true); return; }
    // Written wide -- time plus one column per probe -- so the Signal and
    // Spectral pages can read it straight back as a time series.
    const header = ["time", ...extracted.series.map((s) => s.name)].join(",");
    const rows = [header];
    extracted.times.forEach((t, i) => {
      rows.push([t, ...extracted.series.map((s) =>
        (s.values[i] == null ? "" : s.values[i]))].join(","));
    });
    const name = `${currentPath.split("/").pop().replace(/\.\w+$/, "")}`
      + `-${colInputs.dof.value}-probes.csv`;
    await store.writeProjectFile(`post_processing/extracted_dofs/${name}`, rows.join("\n"));
    await store.registerData({
      name, kind: "series", path: `post_processing/extracted_dofs/${name}`,
      source: `DOF extraction (${modeSelect.value}) from ${currentPath}`,
    });
    say(`Saved post_processing/extracted_dofs/${name}.`);
  });

  const figBtn = el("button", "button secondary", "Save figure");
  figBtn.type = "button";
  figBtn.addEventListener("click", async () => {
    const canvas = figure.querySelector("canvas");
    if (!canvas) { say("Extract first.", true); return; }
    const blob = await toPngBlob(canvas);
    const name = `${currentPath.split("/").pop().replace(/\.\w+$/, "")}-probes.png`;
    await store.writeProjectFile(`figures/${name}`, blob);
    await store.registerData({ name, kind: "figure", path: `figures/${name}`, source: "Post Processing" });
    say(`Saved figures/${name}.`);
  });

  actions.append(extractBtn, saveBtn, figBtn);

  // ── GALES binary results → extracted_dofs, via the sidecar ──────────────────
  // A solved GALES run writes binary displacement fields, not a long-format CSV,
  // so the client extraction above cannot read them. The sidecar can: it finds
  // the nearest mesh node to each probe and writes the series straight into
  // post_processing/extracted_dofs/, where Signal Processing reads it.
  const galesCard = card("Extract from a GALES run");
  galesCard.appendChild(el("p", "research-note",
    "A solved GALES run writes binary displacement fields. This reads them "
    + "directly — for each probe above it takes the nearest mesh node and writes "
    + "its time series (t, ux, uy, uz, magnitude) to "
    + "post_processing/extracted_dofs/, ready for Signal Processing. Probe "
    + "coordinates are the mesh's own (metres). Needs the sidecar."));
  const galesRuns = (await store.listProjectDir("fem_runs").catch(() => []))
    .filter((e) => e.kind === "directory").map((e) => e.name);
  const runSelect = selectOf(galesRuns.length ? galesRuns : ["(no FEM runs)"]);
  const galesBtn = el("button", "button", "Extract from GALES results");
  galesBtn.type = "button";
  const galesLog = el("pre", "qt-console is-placeholder");
  galesLog.textContent = "No extraction run yet.";
  galesBtn.addEventListener("click", () => {
    if (!sidecar.isConnected()) {
      say("Connect the sidecar first (Settings ▸ Sidecar).", true); return;
    }
    if (!galesRuns.length) { say("No FEM runs — solve one first.", true); return; }
    const probes = parseProbes(probeBox.value)
      .map((p) => ({ name: p.name, x: p.x, y: p.y, z: p.z }));
    if (!probes.length) { say("Define at least one probe above (name,x,y,z).", true); return; }
    const dir = `${store.getActive().dir}/fem_runs/${runSelect.value}`;
    galesLog.classList.remove("is-placeholder");
    galesLog.textContent = "";
    galesBtn.disabled = true;
    (async () => {
      let jobId;
      try { jobId = await sidecar.postprocessGales({ dir, stations: probes }); }
      catch (error) { say(error.message, true); galesBtn.disabled = false; return; }
      sidecar.streamJob(jobId, {
        onLine: (line) => {
          galesLog.textContent += `${line}\n`;
          galesLog.scrollTop = galesLog.scrollHeight;
        },
        onStatus: (st) => {
          galesBtn.disabled = false;
          say(st === "done"
            ? "Extracted — the series are in post_processing/extracted_dofs/. Open Signal Processing."
            : `Extraction ${st}.`, st === "failed");
        },
      });
    })();
  });
  const galesRow = el("div", "gis-btn-row");
  galesRow.append(runSelect, galesBtn);
  galesCard.append(galesRow, galesLog);

  // The Qt page's own GALES Toolkit buttons — "Convert Binary To CSV", "Extract
  // Station Timeseries", "Find Station Nodes" — are appended by the spec
  // completion, so they need a way into this page's probe list and run picker.
  // Exposed rather than re-implemented, so every route runs the one verified
  // extraction (wiring-pages.js binds the buttons to this).
  window.__geoidPostProcess = {
    runs: () => galesRuns,
    run: () => runSelect.value,
    probes: () => parseProbes(probeBox.value).map((p) => ({
      name: p.name, x: p.x, y: p.y, z: p.z,
    })),
    extract: () => galesBtn.click(),
  };

  host.append(sourceCard, probeCard, galesCard, resultCard, status);
}

// ── DOF Wizard ───────────────────────────────────────────────────────────────

/**
 * The Qt wizard clones a GALES solver directory and injects TODO markers into
 * its C++ sources. The browser cannot do either, so it writes the same
 * `dof_spec.json` the wizard writes, plus the guide, and the desktop tool does
 * the copying and the source edits from it -- the FEM pages' arrangement again.
 */
async function mountDofWizard(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "DOF Wizard"); return; }
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

  const box = card("New degree of freedom");
  box.appendChild(el("p", "research-note",
    "Specifies a DOF for a solver variant. The browser cannot clone a solver "
    + "tree or edit its C++, so this writes the spec and the guide that the "
    + "desktop wizard reads to do both."));

  const name = input("", "e.g. temperature");
  const type = selectOf(["scalar", "vector", "tensor"], "scalar");
  const domain = selectOf(["fluid", "solid", "interface", "all"], "fluid");
  const equation = input("", "governing equation or reference");
  const template = input("", "template solver, e.g. fluid_mc/sim3");
  const target = input("", "new variant name");

  const form = el("div", "research-form");
  form.append(field("DOF name", name), field("Type", type), field("Domain", domain),
    field("Equation", equation), field("Template solver", template),
    field("New variant", target));
  box.appendChild(form);

  const list = el("div", "research-list");
  const listCard = card("Specified DOFs");
  listCard.appendChild(list);

  async function refresh() {
    list.textContent = "";
    let entries = [];
    try {
      entries = (await store.listProjectDir("fem_runs"))
        .filter((e) => e.kind === "directory");
    } catch (error) { /* none yet */ }
    const found = [];
    for (const entry of entries) {
      const spec = await store.readJson(`fem_runs/${entry.name}/dof_spec.json`, null);
      if (spec) found.push({ run: entry.name, spec });
    }
    if (!found.length) {
      list.appendChild(el("p", "research-note", "No DOF specs written yet."));
      return;
    }
    found.forEach(({ run, spec }) => {
      const row = el("div", "research-list-row");
      row.appendChild(el("span", "research-list-name",
        `${run}: ${spec.name} (${spec.type}, ${spec.domain})`));
      row.appendChild(el("span", "research-list-tag", spec.target || "—"));
      list.appendChild(row);
    });
  }

  const runSelect = selectOf(
    (await (async () => {
      try {
        return (await store.listProjectDir("fem_runs"))
          .filter((e) => e.kind === "directory").map((e) => e.name);
      } catch (error) { return []; }
    })()) || [],
  );
  box.appendChild(field("Write into run", runSelect));

  const write = el("button", "button", "Write DOF spec");
  write.type = "button";
  write.addEventListener("click", async () => {
    if (!name.value.trim()) { say("Name the DOF first.", true); return; }
    if (!runSelect.value) { say("Create a run on the FEM pages first.", true); return; }
    // Field for field as dof_wizard.py writes it, so the desktop tool needs no
    // translation layer to consume this.
    const spec = {
      name: name.value.trim(),
      type: type.value,
      domain: domain.value,
      equation: equation.value,
      template: template.value,
      target: target.value || name.value.trim(),
    };
    const run = runSelect.value;
    await store.writeJson(`fem_runs/${run}/dof_spec.json`, spec);
    const guide = `# DOF Integration Guide\n\n`
      + `This solver variant was specified with DOF metadata.\n`
      + `Use the JSON below to wire the DOF into constructors, IC/BC mapping, and assembly.\n\n`
      + `## DOF Spec\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`
      + `## Steps\n\n`
      + `1. Update DOF count and mesh allocation (constructors).\n`
      + `2. Extend IC/BC mapping for "${spec.name}".\n`
      + `3. Add assembly terms for the ${spec.domain} domain.\n`
      + `4. Extend post-processing output to write "${spec.name}".\n`;
    await store.writeProjectFile(`fem_runs/${run}/DOF_GUIDE.md`, guide);
    await store.registerData({
      name: `${run}/dof_spec.json`, kind: "dof-spec",
      path: `fem_runs/${run}/dof_spec.json`, source: "DOF Wizard",
    });
    say(`Wrote fem_runs/${run}/dof_spec.json and DOF_GUIDE.md.`);
    await refresh();
  });
  const row = el("div", "gis-btn-row");
  row.appendChild(write);

  host.append(box, row, listCard, status);
  await refresh();
}

registerPage("Post Processing", { mount: mountPostProcess });
registerPage("DOF Wizard", { mount: mountDofWizard });
