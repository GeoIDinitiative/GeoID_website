import { registerPage } from "../stages.js?v=20260825-877d84e";
import * as store from "../project-store.js?v=20260825-877d84e";
import { column } from "../table.js?v=20260825-877d84e";
import { linePlot } from "../plot.js?v=20260825-877d84e";
import { detrend, bandpass, statistics } from "../dsp.js?v=20260825-877d84e";
import {
  el, card, field, input, selectOf, button, row, statGrid, statusLine,
  guard, crossPage, findTables, loadTable, inferSampling, saveTable,
  pageHeader, toolbar, inlineLabel, collapsible, dataTable, console_,
  tabbedPanel,
} from "./common.js?v=20260825-877d84e";

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

/**
 * QA / QC, as `QAQCPage` lays it out (app_qt.py:18358): a header, a file
 * selector, then File / Spatial / Temporal / Fix & Export tabs over one loaded
 * table, and a log underneath.
 *
 * The checks are the Qt checks. Where pandas does the work there, this does it
 * over the parsed table -- same questions, same answers, no solver required.
 */

const NULLISH = (v) => v === "" || v == null || v === "NaN";

const mountQaQc = guard("QA / QC", async (host) => {
  const { node: status, say } = statusLine();
  const logLines = [];
  const log = console_("", "Nothing run yet.");
  const note = (line) => {
    logLines.push(`${new Date().toTimeString().slice(0, 8)}  ${line}`);
    log.classList.remove("is-placeholder");
    log.textContent = logLines.slice(-8).join("\n");
  };

  const files = await findTables();
  const fileSelect = selectOf(files.length ? files : ["(no tables in this project)"]);
  let table = null;
  let loadedPath = "";

  const header = pageHeader("QA / QC",
    "Schema, integrity, spatial and temporal quality audits before promoting "
    + "datasets downstream.");

  // Every tab reads `table`, so they are rebuilt when a new file is audited.
  let panel = null;
  const panelHost = el("div");

  function fileTab() {
    const wrap = el("div");
    if (!table) {
      wrap.appendChild(el("p", "research-note", "No file loaded."));
      return wrap;
    }
    wrap.appendChild(el("h3", "research-card-title",
      `${loadedPath} — ${table.rows.length} rows × ${table.columns.length} columns`));

    const rows = table.columns.map((name, i) => {
      const values = table.rows.map((r) => r[i]);
      const blank = values.filter(NULLISH).length;
      const filled = values.filter((v) => !NULLISH(v));
      const numeric = filled.filter((v) => Number.isFinite(Number(v))).length;
      return [
        name,
        filled.length && numeric === filled.length ? "numeric" : "text",
        `${((blank / (values.length || 1)) * 100).toFixed(1)}%`,
        String(new Set(filled).size),
        String(filled[0] ?? "—").slice(0, 24),
      ];
    });
    wrap.appendChild(el("h4", "editor-card-title", "Column schema"));
    wrap.appendChild(dataTable(["Column", "Type", "Null %", "Unique", "Sample"], rows));

    const seen = new Set();
    let dupes = 0;
    table.rows.forEach((r) => {
      const key = r.join("\u0001");
      if (seen.has(key)) dupes += 1; else seen.add(key);
    });
    wrap.appendChild(el("p", "research-note", `Duplicate rows: ${dupes}`));
    return wrap;
  }

  function spatialTab() {
    const wrap = el("div");
    if (!table) {
      wrap.appendChild(el("p", "research-note",
        "Load a table with coordinate columns to run spatial QA."));
      return wrap;
    }
    // Qt reads a GeoJSON or shapefile through geopandas. Here the table is
    // already parsed, so the question is whether it carries usable coordinates.
    const findCol = (re) => table.columns.findIndex((c) => re.test(c));
    const latAt = findCol(/^(lat|latitude|y)$/i);
    const lonAt = findCol(/^(lon|long|longitude|x)$/i);
    if (latAt < 0 || lonAt < 0) {
      wrap.appendChild(el("p", "research-note",
        "No latitude/longitude columns found — spatial QA needs a lat and lon "
        + "column (or y and x)."));
      return wrap;
    }
    const lats = table.rows.map((r) => Number(r[latAt]));
    const lons = table.rows.map((r) => Number(r[lonAt]));
    const bad = lats.filter((v) => !Number.isFinite(v) || Math.abs(v) > 90).length;
    const badLon = lons.filter((v) => !Number.isFinite(v) || Math.abs(v) > 180).length;
    const finiteLat = lats.filter(Number.isFinite);
    const finiteLon = lons.filter(Number.isFinite);
    const nullIsland = lats.filter((v, i) => v === 0 && lons[i] === 0).length;

    wrap.appendChild(console_([
      `latitude column   ${table.columns[latAt]}`,
      `longitude column  ${table.columns[lonAt]}`,
      "",
      `bounds  ${Math.min(...finiteLat).toFixed(4)} .. ${Math.max(...finiteLat).toFixed(4)} lat`,
      `        ${Math.min(...finiteLon).toFixed(4)} .. ${Math.max(...finiteLon).toFixed(4)} lon`,
      "",
      `out-of-range latitudes   ${bad}`,
      `out-of-range longitudes  ${badLon}`,
      `points at exactly 0,0    ${nullIsland}${nullIsland ? "  (usually a missing value, not the Gulf of Guinea)" : ""}`,
    ].join("\n")));
    return wrap;
  }

  function temporalTab() {
    const wrap = el("div");
    if (!table) {
      wrap.appendChild(el("p", "research-note", "Load a file first."));
      return wrap;
    }
    const pick = selectOf(table.columns);
    const guess = table.columns.find((c) => /^(t|time|date|datetime|timestamp)$/i.test(c));
    if (guess) pick.value = guess;
    const out = console_("", "Select a datetime column and run the check.");
    wrap.append(row(inlineLabel("Datetime column:"), pick,
      button("Run Temporal Check", () => {
        const at = table.columns.indexOf(pick.value);
        const raw = table.rows.map((r) => r[at]);
        // Accept both a numeric time base and parseable dates -- research
        // tables carry either, and refusing one of them is refusing half the
        // project's data.
        const nums = raw.map((v) => (Number.isFinite(Number(v))
          ? Number(v) : Date.parse(v)));
        const good = nums.filter(Number.isFinite);
        if (good.length < 2) {
          out.classList.remove("is-placeholder");
          out.textContent = `"${pick.value}" does not parse as time.`;
          return;
        }
        const steps = [];
        for (let i = 1; i < good.length; i += 1) steps.push(good[i] - good[i - 1]);
        const sorted = steps.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const gaps = steps.filter((d) => d > median * 1.5).length;
        const backwards = steps.filter((d) => d < 0).length;
        const duplicates = steps.filter((d) => d === 0).length;
        out.classList.remove("is-placeholder");
        out.textContent = [
          `column        ${pick.value}`,
          `parsed        ${good.length} of ${raw.length}`,
          `median step   ${median}`,
          `gaps (>1.5×)  ${gaps}`,
          `out of order  ${backwards}`,
          `repeated      ${duplicates}`,
          "",
          gaps || backwards || duplicates
            ? "Not a regular time base — resample on Temporal Tools before any "
              + "spectral work."
            : "Regular time base.",
        ].join("\n");
        note(`temporal check on ${pick.value}: ${gaps} gap(s)`);
      }, { secondary: true })));
    wrap.appendChild(out);
    return wrap;
  }

  function fixTab() {
    const wrap = el("div");
    if (!table) {
      wrap.appendChild(el("p", "research-note", "Load a file first."));
      return wrap;
    }
    const dropDup = document.createElement("input");
    dropDup.type = "checkbox"; dropDup.checked = true;
    const fillNulls = document.createElement("input");
    fillNulls.type = "checkbox";
    const fillMethod = selectOf([
      "forward fill", "backward fill", "interpolate (linear)",
      "fill with 0", "drop rows with nulls",
    ]);
    const trim = document.createElement("input");
    trim.type = "checkbox"; trim.checked = true;
    const out = input("", "Output path (blank = auto-name in data/processed/)");

    const check = (box, label) => {
      const line = el("label", "research-check research-field");
      line.append(box, el("span", null, label));
      return line;
    };
    wrap.append(
      check(dropDup, "Drop duplicate rows"),
      check(fillNulls, "Fill null values with method:"),
      fillMethod,
      check(trim, "Trim string whitespace"),
      field("Output", out),
    );

    wrap.appendChild(row(button("Apply Fixes & Export", async () => {
      let rows = table.rows.map((r) => r.slice());
      if (trim.checked) rows = rows.map((r) => r.map((c) => String(c ?? "").trim()));
      if (dropDup.checked) {
        const seen = new Set();
        rows = rows.filter((r) => {
          const key = r.join("\u0001");
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
      }
      if (fillNulls.checked) {
        const method = fillMethod.value;
        if (method === "drop rows with nulls") {
          rows = rows.filter((r) => !r.some(NULLISH));
        } else {
          for (let c = 0; c < table.columns.length; c += 1) {
            if (method === "forward fill") {
              let last = "";
              rows.forEach((r) => { if (NULLISH(r[c])) r[c] = last; else last = r[c]; });
            } else if (method === "backward fill") {
              let next = "";
              for (let i = rows.length - 1; i >= 0; i -= 1) {
                if (NULLISH(rows[i][c])) rows[i][c] = next; else next = rows[i][c];
              }
            } else if (method === "fill with 0") {
              rows.forEach((r) => { if (NULLISH(r[c])) r[c] = "0"; });
            } else {
              // Linear interpolation between the nearest filled neighbours;
              // runs at either end fall back to the value that exists.
              for (let i = 0; i < rows.length; i += 1) {
                if (!NULLISH(rows[i][c])) continue;
                let before = i - 1;
                while (before >= 0 && NULLISH(rows[before][c])) before -= 1;
                let after = i + 1;
                while (after < rows.length && NULLISH(rows[after][c])) after += 1;
                const a = before >= 0 ? Number(rows[before][c]) : NaN;
                const b = after < rows.length ? Number(rows[after][c]) : NaN;
                if (Number.isFinite(a) && Number.isFinite(b)) {
                  rows[i][c] = String(a + ((b - a) * (i - before)) / (after - before));
                } else if (Number.isFinite(a)) rows[i][c] = String(a);
                else if (Number.isFinite(b)) rows[i][c] = String(b);
              }
            }
          }
        }
      }
      const target = out.value.trim()
        || `data/processed/${loadedPath.split("/").pop().replace(/(\.[^.]+)?$/, "-qc.csv")}`;
      try {
        await saveTable(target, table.columns, rows, `QA/QC of ${loadedPath}`, "table");
        say(`${rows.length} row(s) written to ${target}.`);
        note(`fixed ${loadedPath} -> ${target} (${table.rows.length - rows.length} row(s) removed)`);
      } catch (error) { say(error.message, true); }
    })));
    return wrap;
  }

  function rebuild() {
    panelHost.textContent = "";
    panel = tabbedPanel("Audit", {
      "File QA": fileTab,
      "Spatial QA": spatialTab,
      "Temporal QA": temporalTab,
      "Fix & Export": fixTab,
    });
    panel.classList.add("is-wide");   // four tabs over one loaded table
    panelHost.appendChild(panel);
  }

  const loadBtn = button("Load & Audit", async () => {
    if (!files.length) { say("No tables in this project yet.", true); return; }
    try {
      table = await loadTable(fileSelect.value);
      loadedPath = fileSelect.value;
      note(`loaded ${loadedPath}: ${table.rows.length} rows, ${table.columns.length} columns`);
      say(`Audited ${loadedPath}.`);
      rebuild();
    } catch (error) { say(error.message, true); }
  });
  loadBtn.classList.add("accent");

  rebuild();
  host.append(header, toolbar(fileSelect, loadBtn), panelHost,
    collapsibleLog(log), status);
});

/** The Qt log strip under the tabs. Folded, because it matters after a run. */
function collapsibleLog(log) {
  const box = collapsible("Log", { open: true });
  box.body.appendChild(log);
  return box;
}

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

mountQaQc.ownHeader = true;
// Its tabs only fill in once a file is audited.
mountQaQc.specComplete = true;
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
