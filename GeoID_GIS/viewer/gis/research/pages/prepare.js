import { registerPage } from "../stages.js?v=20260810s";
import * as store from "../project-store.js?v=20260810s";
import { column } from "../table.js?v=20260810s";
import { linePlot } from "../plot.js?v=20260810s";
import { detrend, bandpass, statistics } from "../dsp.js?v=20260810s";
import {
  el, card, field, input, selectOf, button, row, statGrid, statusLine,
  guard, crossPage, findTables, loadTable, inferSampling, saveTable,
} from "./common.js?v=20260810s";

/**
 * The Preprocessing stage.
 *
 * Two kinds of page here. Some do work the browser can genuinely do to a table
 * -- profiling it, resampling it, filtering it. Others name a tool that already
 * exists on the GIS or Model page, and hand over to it rather than growing a
 * second copy: the raster and vector toolboxes took a fortnight to get right
 * and re-implementing them here would be a way of getting them wrong.
 */

// ── QA / QC ──────────────────────────────────────────────────────────────────

const mountQaQc = guard("QA / QC", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Profile a table");
  box.appendChild(el("p", "research-note",
    "What is actually in a file before it is trusted: how much is missing, "
    + "whether the time base is regular, and whether rows repeat."));

  const files = await findTables();
  const fileSelect = selectOf(files.length ? files : ["(no tables)"]);
  const report = el("div", "research-report");
  box.append(field("File", fileSelect), row(button("Profile", async () => {
    try {
      const table = await loadTable(fileSelect.value);
      report.textContent = "";
      const problems = [];

      const summary = statGrid([
        ["Rows", table.rows.length],
        ["Columns", table.columns.length],
      ]);
      report.appendChild(summary);

      // Per column: how much is missing and what range it covers.
      const head = el("div", "research-table-row is-head");
      ["Column", "Type", "Missing", "Min", "Max"].forEach((h) =>
        head.appendChild(el("span", null, h)));
      const tableBox = el("div", "research-table");
      tableBox.appendChild(head);
      table.columns.forEach((name, i) => {
        const cells = table.rows.map((r) => r[i]);
        const missing = cells.filter((v) => v === undefined || String(v).trim() === "").length;
        const numeric = table.numeric[i];
        const values = numeric ? cells.map(Number).filter(Number.isFinite) : [];
        const line = el("div", "research-table-row");
        [name, numeric ? "numeric" : "text",
          `${missing} (${((100 * missing) / (table.rows.length || 1)).toFixed(1)}%)`,
          values.length ? Math.min(...values).toPrecision(5) : "—",
          values.length ? Math.max(...values).toPrecision(5) : "—"]
          .forEach((v) => line.appendChild(el("span", null, String(v))));
        tableBox.appendChild(line);
        if (missing) problems.push(`${name}: ${missing} missing value(s)`);
      });
      report.appendChild(tableBox);

      // A time base that is not regular breaks every frequency estimate
      // downstream, so it is checked here rather than discovered later.
      const { fs, timeColumn } = inferSampling(table);
      if (timeColumn) {
        const times = column(table, timeColumn).filter(Number.isFinite);
        const steps = [];
        for (let i = 1; i < times.length; i += 1) steps.push(times[i] - times[i - 1]);
        const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)];
        const irregular = steps.filter((s) => Math.abs(s - median) > median * 0.01).length;
        const backwards = steps.filter((s) => s <= 0).length;
        report.appendChild(statGrid([
          ["Time column", timeColumn],
          ["Sampling", fs ? `${fs.toFixed(4)} Hz` : "—"],
          ["Irregular steps", `${irregular} of ${steps.length}`],
          ["Non-increasing", backwards],
        ]));
        if (irregular) problems.push(`${irregular} irregular time step(s)`);
        if (backwards) problems.push(`${backwards} non-increasing time step(s)`);
      }

      // Duplicate rows, which usually mean a file was concatenated twice.
      const seen = new Set();
      let duplicates = 0;
      table.rows.forEach((r) => {
        const key = r.join("");
        if (seen.has(key)) duplicates += 1; else seen.add(key);
      });
      if (duplicates) problems.push(`${duplicates} duplicate row(s)`);

      const verdict = el("div", problems.length ? "research-flag is-warn" : "research-flag is-ok");
      verdict.textContent = problems.length
        ? `${problems.length} thing(s) to look at: ${problems.join("; ")}.`
        : "No missing values, regular time base, no duplicate rows.";
      report.appendChild(verdict);
      say(`Profiled ${fileSelect.value}.`);
    } catch (error) {
      say(error.message, true);
    }
  })));
  box.appendChild(report);
  host.append(box, status);
});

// ── Preprocessing Transforms ─────────────────────────────────────────────────

const mountTransforms = guard("Preprocessing Transforms", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Transform a column");
  box.appendChild(el("p", "research-note",
    "Detrend, filter, normalise or difference a series, and keep the result as "
    + "a new file. Inputs are never overwritten -- a transform that destroys "
    + "its own input cannot be reconsidered."));

  const files = await findTables();
  const fileSelect = selectOf(files.length ? files : ["(no tables)"]);
  const columnSelect = selectOf([]);
  const opSelect = selectOf([
    "detrend (constant)", "detrend (linear)", "normalise (z-score)",
    "normalise (0..1)", "difference", "cumulative sum",
    "low-pass", "high-pass", "absolute value",
  ]);
  const cutoff = input(1, "cutoff (Hz)", "number");
  const figure = el("div", "research-figure");
  let table = null;
  let result = null;

  async function read() {
    if (!files.length) return;
    table = await loadTable(fileSelect.value);
    columnSelect.innerHTML = "";
    table.columns.filter((_, i) => table.numeric[i]).forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name;
      columnSelect.appendChild(opt);
    });
  }
  fileSelect.addEventListener("change", () => { void read(); });

  function apply() {
    if (!table) { say("Load a file first.", true); return; }
    const values = column(table, columnSelect.value).filter(Number.isFinite);
    if (!values.length) { say("That column has no numbers.", true); return; }
    const { fs } = inferSampling(table);
    const rate = fs || 1;
    const op = opSelect.value;
    let out;
    if (op === "detrend (constant)") out = Array.from(detrend(values, "constant"));
    else if (op === "detrend (linear)") out = Array.from(detrend(values, "linear"));
    else if (op === "normalise (z-score)") {
      const s = statistics(values);
      out = values.map((v) => (s.std ? (v - s.mean) / s.std : 0));
    } else if (op === "normalise (0..1)") {
      const s = statistics(values);
      const span = s.max - s.min || 1;
      out = values.map((v) => (v - s.min) / span);
    } else if (op === "difference") {
      out = values.map((v, i) => (i === 0 ? 0 : v - values[i - 1]));
    } else if (op === "cumulative sum") {
      let total = 0;
      out = values.map((v) => { total += v; return total; });
    } else if (op === "low-pass") {
      out = Array.from(bandpass(values, rate, { low: 0, high: Number(cutoff.value) || rate / 4 }));
    } else if (op === "high-pass") {
      out = Array.from(bandpass(values, rate, { low: Number(cutoff.value) || 0, high: rate / 2 }));
    } else {
      out = values.map((v) => Math.abs(v));
    }
    result = { values: out, rate, op };
    const t = values.map((_, i) => i / rate);
    figure.textContent = "";
    figure.appendChild(linePlot([
      { x: t, y: values, name: "input" },
      { x: t, y: out, name: op },
    ], { labels: { x: "time (s)", y: columnSelect.value }, title: op, height: 280 }));
    say(`${op} applied to ${values.length} samples.`);
  }

  const grid = el("div", "research-grid-2");
  grid.append(field("File", fileSelect), field("Column", columnSelect),
    field("Operation", opSelect), field("Cutoff (Hz, filters only)", cutoff));
  box.append(grid, row(
    button("Apply", apply),
    button("Save to data/processed", async () => {
      if (!result) { say("Apply first.", true); return; }
      const name = `${fileSelect.value.split("/").pop().replace(/\.\w+$/, "")}`
        + `-${columnSelect.value}-${result.op.replace(/[^\w]+/g, "_")}.csv`;
      await saveTable(`data/processed/${name}`, ["time", columnSelect.value],
        result.values.map((v, i) => [(i / result.rate).toFixed(6), v]),
        `Transform: ${result.op}`);
      say(`Saved data/processed/${name}.`);
    }, { secondary: true }),
  ), figure);
  host.append(box, status);
  await read();
});

// ── Temporal Tools ───────────────────────────────────────────────────────────

const mountTemporal = guard("Temporal Tools", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Resample and window");
  box.appendChild(el("p", "research-note",
    "Put a series on a regular time base, or cut it to a window. Irregular "
    + "sampling is the usual reason a spectrum comes out wrong, and QA / QC "
    + "will have said so."));

  const files = await findTables();
  const fileSelect = selectOf(files.length ? files : ["(no tables)"]);
  const columnSelect = selectOf([]);
  const targetRate = input(1, "Hz", "number");
  const fromTime = input("", "start (s)", "number");
  const toTime = input("", "end (s)", "number");
  const figure = el("div", "research-figure");
  let table = null;
  let result = null;

  async function read() {
    if (!files.length) return;
    table = await loadTable(fileSelect.value);
    columnSelect.innerHTML = "";
    table.columns.filter((_, i) => table.numeric[i]).forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name;
      columnSelect.appendChild(opt);
    });
    const { fs, timeColumn } = inferSampling(table);
    if (fs) targetRate.value = String(+fs.toFixed(6));
    if (timeColumn) {
      const at = [...columnSelect.options].findIndex((o) => o.value === timeColumn);
      if (at >= 0) columnSelect.remove(at);
    }
  }
  fileSelect.addEventListener("change", () => { void read(); });

  box.append(el("div", "research-grid-2"));
  const grid = box.lastChild;
  grid.append(field("File", fileSelect), field("Column", columnSelect),
    field("Target rate (Hz)", targetRate),
    field("Window start (s)", fromTime), field("Window end (s)", toTime));

  box.append(row(button("Resample", () => {
    if (!table) { say("Load a file first.", true); return; }
    const { timeColumn } = inferSampling(table);
    if (!timeColumn) { say("This file has no time column to resample against.", true); return; }
    const times = column(table, timeColumn);
    const values = column(table, columnSelect.value);
    const pairs = times.map((t, i) => [t, values[i]])
      .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
      .sort((a, b) => a[0] - b[0]);
    if (pairs.length < 2) { say("Not enough usable rows.", true); return; }
    const start = Number.isFinite(Number(fromTime.value)) && fromTime.value !== ""
      ? Number(fromTime.value) : pairs[0][0];
    const end = Number.isFinite(Number(toTime.value)) && toTime.value !== ""
      ? Number(toTime.value) : pairs[pairs.length - 1][0];
    const rate = Number(targetRate.value) || 1;
    const step = 1 / rate;
    const outT = [];
    const outV = [];
    // Linear interpolation between the bracketing samples: honest about being
    // an estimate between measurements, and cheap enough to stay responsive.
    let k = 0;
    for (let t = start; t <= end + 1e-12; t += step) {
      while (k < pairs.length - 2 && pairs[k + 1][0] < t) k += 1;
      const [t0, v0] = pairs[k];
      const [t1, v1] = pairs[Math.min(k + 1, pairs.length - 1)];
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      outT.push(t);
      outV.push(v0 + (v1 - v0) * f);
    }
    result = { times: outT, values: outV, rate };
    figure.textContent = "";
    figure.appendChild(linePlot([
      { x: pairs.map((p) => p[0]), y: pairs.map((p) => p[1]), name: "original", mode: "scatter" },
      { x: outT, y: outV, name: `resampled ${rate} Hz` },
    ], { labels: { x: "time (s)", y: columnSelect.value }, height: 280 }));
    say(`${outT.length} samples from ${start.toFixed(3)} to ${end.toFixed(3)} s.`);
  }), button("Save to data/processed", async () => {
    if (!result) { say("Resample first.", true); return; }
    const name = `${fileSelect.value.split("/").pop().replace(/\.\w+$/, "")}`
      + `-${columnSelect.value}-${result.rate}Hz.csv`;
    await saveTable(`data/processed/${name}`, ["time", columnSelect.value],
      result.times.map((t, i) => [t.toFixed(6), result.values[i]]), "Temporal resample");
    say(`Saved data/processed/${name}.`);
  }, { secondary: true })), figure);
  host.append(box, status);
  await read();
});

// ── Inputs: what a run has, and what it is missing ───────────────────────────

const mountInputs = guard("Inputs", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const box = card("Run inputs");
  box.appendChild(el("p", "research-note",
    "What each configured run points at, and whether those files are actually "
    + "in the project. A run that names a mesh it has not got fails at the "
    + "solver, which is a slower way to find out."));
  const list = el("div", "research-list");
  box.appendChild(list);

  let runs = [];
  try {
    runs = (await store.listProjectDir("fem_runs")).filter((e) => e.kind === "directory");
  } catch (error) { /* none */ }

  let meshes = [];
  try {
    meshes = (await store.listProjectDir("meshes")).filter((e) => e.kind === "file")
      .map((e) => e.name);
  } catch (error) { /* none */ }

  if (!runs.length) {
    list.appendChild(el("p", "research-note", "No runs configured yet."));
    box.appendChild(row(button("Go to FEM Setup", () => ctx.setPage?.("Setup"))));
  }
  for (const run of runs) {
    const spec = await store.readJson(`fem_runs/${run.name}/spec.json`, null);
    const line = el("div", "research-list-row");
    const missing = [];
    if (!spec) missing.push("no spec.json");
    else {
      if (!spec.mesh || spec.mesh.startsWith("(")) missing.push("no mesh chosen");
      else if (!meshes.includes(spec.mesh)) missing.push(`mesh "${spec.mesh}" not in meshes/`);
      if (!(spec.boundary || []).length) missing.push("no boundary conditions");
    }
    line.appendChild(el("span", "research-list-name",
      `${run.name}${spec?.mesh ? ` — ${spec.mesh}` : ""}`));
    const tag = el("span", "research-list-tag", missing.length ? missing.join("; ") : "ready");
    if (!missing.length) tag.style.color = "var(--nav-accent)";
    line.appendChild(tag);
    list.appendChild(line);
  }
  say(`${runs.length} run(s), ${meshes.length} mesh(es) in the project.`);
  host.append(box, status);
});

// ── Hand-offs ────────────────────────────────────────────────────────────────

registerPage("QA / QC", { mount: mountQaQc });
registerPage("Preprocessing Transforms", { mount: mountTransforms });
registerPage("Temporal Tools", { mount: mountTemporal });
registerPage("Inputs", { mount: mountInputs });

registerPage("Raster Tools", {
  mount: crossPage("Raster Tools", {
    blurb: "Slope, aspect, hillshade, contours, reclassify, raster calculator, "
      + "zonal statistics and clipping.",
    note: "These run on the GIS page's Pre-processing Toolbox, against the "
      + "layers loaded there. Results register against this project.",
    mode: "gis",
    section: "gis-group-preprocess",
  }),
});

registerPage("Vector Tools", {
  mount: crossPage("Vector Tools", {
    blurb: "Buffer, clip, difference, intersect, dissolve, hull, centroids, "
      + "simplify, spatial join and reprojection.",
    note: "These run on the GIS page's Pre-processing Toolbox. Imports there "
      + "are recorded against this project automatically.",
    mode: "gis",
    section: "gis-group-preprocess",
  }),
});

registerPage("Mesh", {
  mount: crossPage("Mesh", {
    blurb: "Build, inspect and georeference meshes.",
    note: "The Meshing Studio is the Model page. Meshes saved there land in "
      + "this project's meshes/ and become selectable on FEM Setup.",
    mode: "model",
  }),
});

registerPage("XYZ to STL", {
  mount: crossPage("XYZ to STL", {
    blurb: "Turn a point cloud into a surface mesh.",
    note: "Point clouds import on the GIS page and triangulate in the Meshing "
      + "Studio, which is where the result can be inspected before it is kept.",
    mode: "model",
  }),
});
