import { registerPage } from "../stages.js?v=20260827-90bd2a2";
import * as store from "../project-store.js?v=20260827-90bd2a2";
import * as google from "../google-credentials.js?v=20260827-90bd2a2";
import { column } from "../table.js?v=20260827-90bd2a2";
import { linePlot } from "../plot.js?v=20260827-90bd2a2";
import * as dsp from "../dsp.js?v=20260827-90bd2a2";
import {
  el, card, field, input, textarea, selectOf, button, row, statGrid, statusLine,
  guard, findTables, loadTable, inferSampling, saveTable,
} from "./common.js?v=20260827-90bd2a2";

/**
 * AI trainer, the remaining FEM pages, Publish and Settings.
 *
 * The training pages are deliberately about *features and datasets* rather than
 * about fitting models in the browser. Preparing a labelled table, and knowing
 * exactly which rows and columns went into it, is the part that has to be right
 * and the part that is usually skipped; the fitting itself belongs where the
 * GPUs are.
 */

// ── Feature Engineering ──────────────────────────────────────────────────────

const mountFeatures = guard("Feature Engineering", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Build a feature table");
  box.appendChild(el("p", "research-note",
    "Rolling statistics over a series, written out as a table one row per "
    + "window. This is the shape a model expects, and doing it here means the "
    + "windowing is recorded rather than improvised in a notebook."));

  const files = await findTables();
  const fileSelect = selectOf(files.length ? files : ["(no tables)"]);
  const columnSelect = selectOf([]);
  const windowInput = input(64, "samples", "number");
  const hopInput = input(32, "samples", "number");
  const preview = el("div", "research-table");
  let table = null;
  let features = null;

  async function read() {
    if (!files.length) return;
    table = await loadTable(fileSelect.value);
    columnSelect.innerHTML = "";
    // The time column is the axis, not a signal: offering it as something to
    // take rolling statistics over produces a feature table about the clock.
    const { timeColumn } = inferSampling(table);
    table.columns
      .filter((_, i) => table.numeric[i])
      .filter((name) => name !== timeColumn)
      .forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name; opt.textContent = name;
        columnSelect.appendChild(opt);
      });
  }
  fileSelect.addEventListener("change", () => { void read(); });

  function build() {
    if (!table) { say("Load a file first.", true); return; }
    const values = column(table, columnSelect.value).filter(Number.isFinite);
    const win = Math.max(4, Number(windowInput.value) | 0);
    const hop = Math.max(1, Number(hopInput.value) | 0);
    const { fs } = inferSampling(table);
    const rate = fs || 1;
    const rows = [];
    for (let start = 0; start + win <= values.length; start += hop) {
      const slice = values.slice(start, start + win);
      const s = dsp.statistics(slice);
      const spectrum = dsp.amplitudeSpectrum(slice, rate);
      const peak = dsp.dominantPeak(spectrum, { signal: slice, fs: rate });
      rows.push([
        (start / rate).toFixed(6), s.mean.toPrecision(8), s.std.toPrecision(8),
        s.rms.toPrecision(8), s.min.toPrecision(8), s.max.toPrecision(8),
        s.peakToPeak.toPrecision(8), peak.frequency.toPrecision(6),
        peak.amplitude.toPrecision(6),
      ]);
    }
    features = {
      header: ["window_start_s", "mean", "std", "rms", "min", "max", "peak_to_peak",
        "dominant_hz", "dominant_amp"],
      rows,
    };
    preview.textContent = "";
    const head = el("div", "research-table-row is-head");
    features.header.forEach((h) => head.appendChild(el("span", null, h)));
    preview.appendChild(head);
    rows.slice(0, 12).forEach((r) => {
      const line = el("div", "research-table-row");
      r.forEach((v) => line.appendChild(el("span", null, String(v))));
      preview.appendChild(line);
    });
    say(`${rows.length} window(s) of ${win} samples, hop ${hop}.`);
  }

  const grid = el("div", "research-grid-2");
  grid.append(field("File", fileSelect), field("Column", columnSelect),
    field("Window (samples)", windowInput), field("Hop (samples)", hopInput));
  box.append(grid, row(button("Build", build), button("Save to analysis/", async () => {
    if (!features) { say("Build first.", true); return; }
    const name = `${fileSelect.value.split("/").pop().replace(/\.\w+$/, "")}`
      + `-${columnSelect.value}-features.csv`;
    await saveTable(`analysis/${name}`, features.header, features.rows,
      `Feature engineering (window ${windowInput.value}, hop ${hopInput.value})`, "features");
    say(`Saved analysis/${name}.`);
  }, { secondary: true })), preview);
  host.append(box, status);
  await read();
});

// ── AI Trainer ───────────────────────────────────────────────────────────────

const mountTrainer = guard("AI Trainer", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const SPEC = "analysis/training_spec.json";
  const box = card("Training specification");
  box.appendChild(el("p", "research-note",
    "What to train, on what, against which target. The browser does not fit "
    + "the model -- that belongs where the compute is -- but the dataset, the "
    + "split and the target are decisions that must be recorded, and they are "
    + "written here for a trainer to pick up."));

  const existing = await store.readJson(SPEC, null);
  const files = await findTables();
  const datasetSelect = selectOf(files.length ? files : ["(no tables)"], existing?.dataset);
  const targetSelect = selectOf([]);
  const taskSelect = selectOf(["regression", "classification", "forecasting"],
    existing?.task || "regression");
  const modelSelect = selectOf(["random forest", "gradient boosting", "linear",
    "MLP", "1D CNN"], existing?.model || "random forest");
  const splitInput = input(existing?.test_fraction ?? 0.2, "0..1", "number");
  const seedInput = input(existing?.seed ?? 42, "", "number");
  const featureBox = selectOf([]);
  featureBox.multiple = true;
  featureBox.size = 8;

  async function read() {
    if (!files.length) return;
    const table = await loadTable(datasetSelect.value);
    const { timeColumn } = inferSampling(table);
    // Same reason: predicting the timestamp from the timestamp is not a model.
    const numeric = table.columns
      .filter((_, i) => table.numeric[i])
      .filter((name) => name !== timeColumn);
    [targetSelect, featureBox].forEach((node) => { node.innerHTML = ""; });
    numeric.forEach((name) => {
      [targetSelect, featureBox].forEach((node) => {
        const opt = document.createElement("option");
        opt.value = name; opt.textContent = name;
        node.appendChild(opt);
      });
    });
    if (existing?.target) targetSelect.value = existing.target;
    const chosen = new Set(existing?.features || []);
    [...featureBox.options].forEach((o) => {
      o.selected = chosen.size ? chosen.has(o.value) : o.value !== targetSelect.value;
    });
  }
  datasetSelect.addEventListener("change", () => { void read(); });

  const grid = el("div", "research-grid-2");
  grid.append(field("Dataset", datasetSelect), field("Target", targetSelect),
    field("Task", taskSelect), field("Model", modelSelect),
    field("Test fraction", splitInput), field("Random seed", seedInput));
  box.append(grid, field("Features (multi-select)", featureBox), row(
    button("Write training spec", async () => {
      const features = [...featureBox.options].filter((o) => o.selected).map((o) => o.value);
      if (!features.length) { say("Choose at least one feature.", true); return; }
      if (features.includes(targetSelect.value)) {
        // Leaking the target into the features is the classic way to get a
        // model that scores perfectly and predicts nothing.
        say("The target is also selected as a feature; remove it.", true);
        return;
      }
      const spec = {
        dataset: datasetSelect.value, target: targetSelect.value,
        features, task: taskSelect.value, model: modelSelect.value,
        test_fraction: Number(splitInput.value), seed: Number(seedInput.value),
        written_at: new Date().toISOString(),
        written_by: "GeoID Research Hub (browser)",
      };
      await store.writeJson(SPEC, spec);
      await store.registerData({
        name: "training_spec.json", kind: "training-spec", path: SPEC, source: "AI Trainer",
      });
      say(`Wrote ${SPEC} — ${features.length} feature(s) against ${spec.target}.`);
    }),
    button("Build features first", () => ctx.setPage?.("Feature Engineering"), { secondary: true }),
  ));
  host.append(box, status);
  await read();
});

// ── Workflow Automation ──────────────────────────────────────────────────────

const mountAutomation = guard("Workflow Automation", async (host) => {
  const { node: status, say } = statusLine();
  const PATH = "plans/automation.json";
  const box = card("Recorded workflows");
  box.appendChild(el("p", "research-note",
    "A named sequence of steps with the settings each one used, so a piece of "
    + "work can be repeated exactly rather than approximately. Written as JSON "
    + "for a runner to execute."));

  const state = await store.readJson(PATH, { workflows: [] });
  state.workflows = Array.isArray(state.workflows) ? state.workflows : [];
  const name = input("", "workflow name");
  const steps = textarea("", 8,
    "One step per line, e.g.\nqa_qc: data/raw/tilt.csv\ntransform: detrend linear\nspectral: welch 1024");
  const list = el("div", "research-list");

  async function draw() {
    list.textContent = "";
    if (!state.workflows.length) list.appendChild(el("p", "research-note", "None recorded."));
    state.workflows.forEach((wf, index) => {
      const line = el("div", "research-list-row");
      line.append(el("span", "research-list-name", `${wf.name} (${wf.steps.length} steps)`),
        button("×", async () => {
          state.workflows.splice(index, 1);
          await store.writeJson(PATH, state); await draw();
        }, { secondary: true }));
      list.appendChild(line);
    });
    say(`${state.workflows.length} workflow(s).`);
  }

  box.append(field("Name", name), field("Steps", steps), row(button("Record", async () => {
    if (!name.value.trim()) { say("Name the workflow.", true); return; }
    const lines = steps.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { say("Give it at least one step.", true); return; }
    state.workflows.push({ name: name.value.trim(), steps: lines, at: new Date().toISOString() });
    await store.writeJson(PATH, state);
    name.value = ""; steps.value = "";
    await draw();
  })), list);
  host.append(box, status);
  await draw();
});

// ── Notebook ─────────────────────────────────────────────────────────────────


// ── FEM: Import / Clone, Build New, Simulation ───────────────────────────────

const mountImportClone = guard("Import / Clone", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const box = card("Start from an existing run");
  box.appendChild(el("p", "research-note",
    "Copy a configured run's spec into a new one. Most runs are a variation of "
    + "the last, and retyping a spec is how a variation becomes an accident."));
  let runs = [];
  try {
    runs = (await store.listProjectDir("fem_runs")).filter((e) => e.kind === "directory")
      .map((e) => e.name);
  } catch (error) { /* none */ }
  const from = selectOf(runs.length ? runs : ["(no runs)"]);
  const to = input("", "new run name");
  box.append(field("Clone from", from), row(to, button("Clone", async () => {
    if (!runs.length) { say("There is nothing to clone yet.", true); return; }
    const safe = to.value.trim().replace(/[^\w\-.]+/g, "_");
    if (!safe) { say("Name the new run.", true); return; }
    const spec = await store.readJson(`fem_runs/${from.value}/spec.json`, null);
    if (!spec) { say(`${from.value} has no spec.json.`, true); return; }
    await store.writeJson(`fem_runs/${safe}/spec.json`, {
      ...spec, run: safe, cloned_from: from.value, updated_at: new Date().toISOString(),
    });
    say(`Cloned ${from.value} into fem_runs/${safe}/.`);
  }), button("Open Setup", () => ctx.setPage?.("Setup"), { secondary: true })));
  host.append(box, status);
});


const mountSimulation = guard("Simulation", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const box = card("Run status");
  box.appendChild(el("p", "research-note",
    "What each run is configured to do and whether anything has come back. A "
    + "browser cannot start a native solver; this is the handover point."));
  const list = el("div", "research-list");
  box.appendChild(list);
  let runs = [];
  try {
    runs = (await store.listProjectDir("fem_runs")).filter((e) => e.kind === "directory");
  } catch (error) { /* none */ }
  if (!runs.length) {
    list.appendChild(el("p", "research-note", "No runs configured."));
    box.appendChild(row(button("Build one", () => ctx.setPage?.("Build New"))));
  }
  for (const run of runs) {
    const spec = await store.readJson(`fem_runs/${run.name}/spec.json`, null);
    let outputs = [];
    try {
      outputs = (await store.listProjectDir(`fem_runs/${run.name}`))
        .filter((e) => e.name !== "spec.json" && e.name !== "DOF_GUIDE.md"
          && e.name !== "dof_spec.json");
    } catch (error) { /* none */ }
    const line = el("div", "research-list-row");
    line.append(
      el("span", "research-list-name",
        `${run.name} — ${spec ? `${spec.physics}, ${spec.time?.start ?? 0}–${spec.time?.end ?? "?"} s` : "no spec"}`),
      el("span", "research-list-tag", outputs.length ? `${outputs.length} output(s)` : "awaiting solver"),
      button("Post-process", () => ctx.setPage?.("Post Processing"), { secondary: true }),
    );
    list.appendChild(line);
  }
  say(`${runs.length} run(s).`);
  host.append(box, status);
});

// Notebook and Build New used to live here as one-card stubs. They are real
// pages now -- pages/notebook.js runs cells, pages/builder.js is the ten-step
// wizard -- and two registrations for one page id means whichever module
// imports last silently wins, which is exactly what happened.

// ── Publish: Docs & Sheets, Figure Composer ──────────────────────────────────


const mountFigures = guard("Figure Composer", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Figures");
  box.appendChild(el("p", "research-note",
    "Every figure saved from an analysis page, with its caption. Captions are "
    + "kept beside the images so a storyboard can use them."));
  const CAPTIONS = "figures/_captions.json";
  const captions = await store.readJson(CAPTIONS, {});
  const gallery = el("div", "research-gallery");
  box.appendChild(gallery);

  let entries = [];
  try {
    entries = (await store.listProjectDir("figures"))
      .filter((e) => e.kind === "file" && /\.(png|jpe?g|svg)$/i.test(e.name));
  } catch (error) { /* none */ }
  if (!entries.length) {
    gallery.appendChild(el("p", "research-note",
      "No figures yet. Analysis pages save them into figures/."));
  }
  for (const entry of entries) {
    const item = el("div", "research-gallery-item");
    try {
      const blob = await store.readProjectFile(`figures/${entry.name}`);
      if (typeof blob !== "string") {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(blob);
        img.alt = entry.name;
        item.appendChild(img);
      }
    } catch (error) { /* unreadable, still listed */ }
    item.appendChild(el("span", "research-gallery-name", entry.name));
    const caption = input(captions[entry.name] || "", "caption");
    caption.addEventListener("change", async () => {
      captions[entry.name] = caption.value;
      await store.writeJson(CAPTIONS, captions);
      say(`Caption saved for ${entry.name}.`);
    });
    item.appendChild(caption);
    gallery.appendChild(item);
  }
  say(`${entries.length} figure(s).`);
  host.append(box, status);
});

// ── Settings ─────────────────────────────────────────────────────────────────

const mountSettings = guard("Settings", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const project = store.getActive();
  const box = card("Project settings");
  box.appendChild(statGrid([
    ["Project", project.name],
    ["Folder", project.dir],
    ["Storage", store.getRoot()?.kind === "disk" ? "on disk" : store.getRoot()?.kind],
    ["Created", (project.meta.created_at || "").slice(0, 10)],
    ["Updated", (project.meta.updated_at || "").slice(0, 10)],
  ]));

  const crs = input(project.meta.study_area?.crs || "EPSG:4326");
  box.append(field("Default CRS", crs), row(
    button("Save", async () => {
      await store.updateMetadata({
        study_area: { ...project.meta.study_area, crs: crs.value.trim() || "EPSG:4326" },
      });
      say("Saved.");
    }),
    button("Close project", () => { store.closeProject(); ctx.setPage?.("Projects"); },
      { secondary: true }),
  ));

  // ── Google ────────────────────────────────────────────────────────────────
  // Kept per browser rather than in the project: a project is meant to be
  // moved, shared and opened by the desktop app, and a credential is the
  // person, not the study.
  const creds = google.load();
  const gbox = card("Google credentials");
  gbox.appendChild(el("p", "research-note",
    "Lets the hub create and file Docs and Sheets through the Drive API. The "
    + "document window on Docs & Sheets works without this — it uses whatever "
    + "Google session this browser already has."));

  const clientId = input(creds.clientId, "…….apps.googleusercontent.com");
  const apiKey = input(creds.apiKey, "Optional — for public read-only calls");
  gbox.append(field("OAuth Client ID", clientId), field("API key", apiKey));

  gbox.appendChild(el("p", "research-note is-error",
    "Client ID only. An OAuth client secret must never be stored in a page "
    + "served to a browser — anyone who loads the site can read it, and the "
    + "browser token flow does not use one. A secret pasted here is refused, "
    + "not saved."));

  const gstate = el("p", "research-status");
  const paintGoogle = () => {
    const now = google.load();
    gstate.classList.remove("is-error");
    gstate.textContent = now.clientId
      ? `Client ID set${now.updatedAt ? ` (${now.updatedAt.slice(0, 10)})` : ""}.`
      : "No Client ID set.";
  };
  paintGoogle();

  gbox.appendChild(row(
    button("Save", () => {
      try {
        google.save({ clientId: clientId.value, apiKey: apiKey.value });
        paintGoogle();
        say("Google credentials saved for this browser.");
      } catch (error) {
        gstate.textContent = error.message;
        gstate.classList.add("is-error");
      }
    }),
    button("Forget", () => {
      google.clear();
      clientId.value = ""; apiKey.value = "";
      paintGoogle();
      say("Google credentials cleared.");
    }, { secondary: true }),
  ));
  gbox.appendChild(gstate);

  const layout = card("Project layout");
  layout.appendChild(el("p", "research-note",
    "The directories this project was created with. They match the desktop "
    + "app's layout exactly, which is what lets a project open in both."));
  // Twenty short paths read as a list, not as twenty stacked rows -- that card
  // was 778px tall on its own and was most of why this page scrolled.
  const grid = el("div", "project-dirs");
  store.PROJECT_DIRS.forEach((dir) => grid.appendChild(el("span", null, dir)));
  layout.appendChild(grid);

  host.append(box, gbox, layout, status);
});

const mountPlugins = guard("Plugin Manager", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Pages in this hub");
  box.appendChild(el("p", "research-note",
    "Which pages have been built and which are still to come. A page registers "
    + "itself with the stage list; nothing here is configuration, it is what is "
    + "actually loaded."));
  const { STAGES: stages, getPage: get } = await import("../stages.js?v=20260827-90bd2a2");
  const table = el("div", "research-table");
  const head = el("div", "research-table-row is-head");
  ["Stage", "Pages", "Built", "Remaining"].forEach((h) => head.appendChild(el("span", null, h)));
  table.appendChild(head);
  let built = 0;
  let total = 0;
  stages.forEach(([key, , pages]) => {
    const done = pages.filter(([id]) => get(id)).length;
    built += done; total += pages.length;
    const line = el("div", "research-table-row");
    [key, String(pages.length), String(done),
      pages.filter(([id]) => !get(id)).map(([id]) => id).join(", ") || "—"]
      .forEach((v) => line.appendChild(el("span", null, v)));
    table.appendChild(line);
  });
  box.appendChild(table);
  say(`${built} of ${total} pages built.`);
  host.append(box, status);
});

const mountModuleBuilder = guard("Module Builder", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Scaffold a page");
  box.appendChild(el("p", "research-note",
    "Generates the module for a new Research page: registration, the project "
    + "guard and the furniture. Saved into the project, since the browser "
    + "cannot write into the app's own source."));
  const pageId = input("", "page id, exactly as it appears in stages.js");
  const out = textarea("", 16, "");
  box.append(field("Page", pageId), row(button("Generate", () => {
    const id = pageId.value.trim();
    if (!id) { say("Give the page id.", true); return; }
    const slug = id.toLowerCase().replace(/[^\w]+/g, "-");
    out.value = `import { registerPage } from "../stages.js";
import * as store from "../project-store.js";
import { el, card, row, button, statusLine, guard } from "./common.js";

const mount = guard("${id}", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const box = card("${id}");
  box.appendChild(el("p", "research-note", "…"));
  host.append(box, status);
});

registerPage("${id}", { mount });
`;
    say(`Scaffold for "${id}" ready — save it as pages/${slug}.js in the viewer.`);
  }), button("Save to analysis/", async () => {
    if (!out.value) { say("Generate first.", true); return; }
    const slug = pageId.value.trim().toLowerCase().replace(/[^\w]+/g, "-");
    await store.writeProjectFile(`analysis/${slug}-page.js.txt`, out.value);
    say(`Saved analysis/${slug}-page.js.txt.`);
  }, { secondary: true })), out);
  host.append(box, status);
});

registerPage("Feature Engineering", { mount: mountFeatures });
registerPage("AI Trainer", { mount: mountTrainer });
registerPage("Workflow Automation", { mount: mountAutomation });
registerPage("Import / Clone", { mount: mountImportClone });
registerPage("Simulation", { mount: mountSimulation });
registerPage("Figure Composer", { mount: mountFigures });
registerPage("Settings", { mount: mountSettings });
registerPage("Plugin Manager", { mount: mountPlugins });
registerPage("Module Builder", { mount: mountModuleBuilder });
