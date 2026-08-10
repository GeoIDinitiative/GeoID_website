import { wire, wirePattern } from "./spec-page.js?v=20260810-1bd286d";
import * as store from "./project-store.js?v=20260810-1bd286d";
import * as bridge from "./bridge.js?v=20260810-1bd286d";
import * as dsp from "./dsp.js?v=20260810-1bd286d";
import * as stats from "./stats.js?v=20260810-1bd286d";
import { linePlot } from "./plot.js?v=20260810-1bd286d";
import { parseTable, column } from "./table.js?v=20260810-1bd286d";
import { findTables, loadTable, saveTable, saveFigure } from "./pages/common.js?v=20260810-1bd286d";

/**
 * The rest of the spec's controls.
 *
 * Most of them are not analysis at all: they edit a list, write a file, or
 * record a decision the project needs to remember. Those are all things a
 * browser does perfectly well, and the reason they sat disabled was that nobody
 * had written them — not that they were impossible.
 *
 * Same rule as `wiring.js`: real behaviour or stay disabled. Where a control
 * drives a native process, it is in `CANNOT_WIRE` there, not faked here.
 */

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Read/modify/write a JSON list kept in the project. */
async function editList(path, key, change, say, describe) {
  const doc = await store.readJson(path, {});
  doc[key] = Array.isArray(doc[key]) ? doc[key] : [];
  const result = change(doc[key]);
  await store.writeJson(path, doc);
  say(describe(doc[key], result));
  return doc[key];
}

/** The first table in the project, parsed, with its numeric columns. */
async function firstTable() {
  const tables = await findTables();
  if (!tables.length) throw new Error("No tables in this project yet.");
  const table = await loadTable(tables[0]);
  return { path: tables[0], table };
}

/**
 * Which columns hold latitude and longitude.
 *
 * `y`/`x` are accepted, but only when there is no explicit lat/lon column:
 * putting them in one alternation meant a table of x,y,z,lat,lon matched `y` as
 * latitude, and Clip Points then filtered on the wrong pair and kept nothing.
 */
function coordinateColumns(table) {
  const cols = table.columns.map((c) => String(c).toLowerCase());
  const pick = (primary, fallback) => {
    const at = cols.findIndex((c) => primary.test(c));
    return at >= 0 ? at : cols.findIndex((c) => fallback.test(c));
  };
  return {
    latAt: pick(/^(lat|latitude)$/, /^y$/),
    lonAt: pick(/^(lon|long|longitude)$/, /^x$/),
  };
}

function numericOf(table) {
  const out = {};
  table.columns.forEach((name, i) => {
    if (!table.numeric[i]) return;
    const values = column(table, name).filter(Number.isFinite);
    if (values.length > 1) out[name] = values;
  });
  return out;
}

// ── Text-file editors: Properties, Setup, Inputs, Mesh scripts ───────────────

/** key=value blocks, which is what props.txt and setup.txt are. */
wire("Properties", {
  "Add Key": async ({ say }) => {
    const key = window.prompt("Key name:");
    if (!key) return;
    await editList("metadata/properties.json", "keys",
      (list) => list.push({ key, value: "" }), say,
      (list) => `${list.length} key(s) defined.`);
  },
  "Remove Key": async ({ say }) => editList("metadata/properties.json", "keys",
    (list) => list.pop(), say, (list) => `${list.length} key(s) left.`),
  "Add Block": async ({ say }) => {
    const name = window.prompt("Block name:");
    if (!name) return;
    await editList("metadata/properties.json", "blocks",
      (list) => list.push({ name, keys: [] }), say,
      (list) => `${list.length} block(s) defined.`);
  },
  "Remove Block": async ({ say }) => editList("metadata/properties.json", "blocks",
    (list) => list.pop(), say, (list) => `${list.length} block(s) left.`),
  "Save props.txt": async ({ say }) => {
    const doc = await store.readJson("metadata/properties.json", { keys: [], blocks: [] });
    const lines = [];
    (doc.blocks || []).forEach((b) => {
      lines.push(`[${b.name}]`);
      (b.keys || []).forEach((k) => lines.push(`  ${k.key} = ${k.value ?? ""}`));
    });
    (doc.keys || []).forEach((k) => lines.push(`${k.key} = ${k.value ?? ""}`));
    const path = "fem_runs/props.txt";
    await store.writeProjectFile(path, `${lines.join("\n")}\n`);
    say(`${lines.length} line(s) written to ${path}.`);
  },
  "Parse Raw -> Form": async ({ say }) => {
    let raw = "";
    try { raw = await store.readProjectFile("fem_runs/props.txt"); }
    catch (error) { throw new Error("No fem_runs/props.txt to parse yet."); }
    const keys = []; const blocks = []; let current = null;
    String(raw).split("\n").forEach((line) => {
      const block = line.match(/^\s*\[(.+)\]\s*$/);
      if (block) { current = { name: block[1], keys: [] }; blocks.push(current); return; }
      const pair = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/);
      if (!pair) return;
      (current ? current.keys : keys).push({ key: pair[1], value: pair[2].trim() });
    });
    await store.writeJson("metadata/properties.json", { keys, blocks });
    say(`Parsed ${keys.length} key(s) and ${blocks.length} block(s).`);
  },
});

wire("Setup", {
  "Add selected": async ({ say }) => {
    const tables = await findTables();
    if (!tables.length) throw new Error("Nothing in the project to add.");
    await editList("metadata/setup.json", "inputs",
      (list) => { if (!list.includes(tables[0])) list.push(tables[0]); }, say,
      (list) => `${list.length} input(s) in the setup.`);
  },
  "Add all missing": async ({ say }) => {
    const tables = await findTables();
    await editList("metadata/setup.json", "inputs",
      (list) => tables.forEach((t) => { if (!list.includes(t)) list.push(t); }), say,
      (list) => `${list.length} input(s) in the setup.`);
  },
  "Save setup.txt": async ({ values, say }) => {
    const doc = await store.readJson("metadata/setup.json", { inputs: [] });
    const fields = Object.entries(values())
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `${k} = ${v}`);
    const text = [...fields, "", "[inputs]", ...(doc.inputs || [])].join("\n");
    await store.writeProjectFile("fem_runs/setup.txt", `${text}\n`);
    say("Written to fem_runs/setup.txt.");
  },
});

wire("Inputs", {
  "New input file": async ({ say }) => {
    const name = window.prompt("Input file name:", "input.txt");
    if (!name) return;
    await store.writeProjectFile(`fem_runs/inputs/${name}`, "");
    say(`Created fem_runs/inputs/${name}.`);
  },
});

wire("Mesh", {
  "New .geo": async ({ say }) => {
    const name = window.prompt("Geometry script name:", "model.geo");
    if (!name) return;
    await store.writeProjectFile(`meshes/${name}`,
      "// gmsh geometry\nlc = 1.0;\nPoint(1) = {0, 0, 0, lc};\n");
    say(`Created meshes/${name}.`);
  },
  "New .py": async ({ say }) => {
    const name = window.prompt("Mesh script name:", "mesh.py");
    if (!name) return;
    await store.writeProjectFile(`meshes/${name}`,
      "import gmsh\ngmsh.initialize()\n# build the model here\ngmsh.finalize()\n");
    say(`Created meshes/${name}.`);
  },
  "Insert Embedded Point In Mesh Script": async ({ say }) => {
    const host = document.getElementById("research-page");
    const box = host.querySelector("textarea");
    if (!box) throw new Error("No script editor on this page.");
    const snippet = "\nPoint(100) = {0, 0, 0, lc};\nPoint{100} In Surface{1};\n";
    box.value += snippet;
    say("Embedded-point snippet appended.");
  },
});

// ── Feature engineering: real table maths ───────────────────────────────────

async function extendFeatures(build, say, label) {
  const { path, table } = await firstTable();
  const numeric = numericOf(table);
  const names = Object.keys(numeric);
  if (!names.length) throw new Error(`${path} has no numeric columns.`);
  const added = build(numeric, names);
  const header = [...table.columns, ...Object.keys(added)];
  const rows = table.rows.map((row, i) =>
    [...row, ...Object.keys(added).map((k) => added[k][i] ?? "")]);
  const out = `data/processed/features-${stamp()}.csv`;
  await saveTable(out, header, rows, `Feature Engineering — ${label}`, "table");
  say(`${Object.keys(added).length} column(s) added; written to ${out}.`);
}

wire("Feature Engineering", {
  "Add Lag Features": async ({ say }) => extendFeatures((numeric, names) => {
    const out = {};
    names.forEach((n) => {
      [1, 2, 3].forEach((lag) => {
        out[`${n}_lag${lag}`] = numeric[n].map((_, i) => (i >= lag ? numeric[n][i - lag] : ""));
      });
    });
    return out;
  }, say, "lags"),
  "Add Rolling Features": async ({ say }) => extendFeatures((numeric, names) => {
    const out = {};
    const w = 5;
    names.forEach((n) => {
      const v = numeric[n];
      out[`${n}_roll_mean`] = v.map((_, i) =>
        (i >= w - 1 ? stats.mean(v.slice(i - w + 1, i + 1)) : ""));
      out[`${n}_roll_std`] = v.map((_, i) =>
        (i >= w - 1 ? stats.stdev(v.slice(i - w + 1, i + 1)) : ""));
    });
    return out;
  }, say, "rolling window 5"),
  "Generate Polynomial Features": async ({ say }) => extendFeatures((numeric, names) => {
    const out = {};
    names.forEach((n) => { out[`${n}_sq`] = numeric[n].map((v) => v * v); });
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        out[`${names[i]}_x_${names[j]}`] =
          numeric[names[i]].map((v, k) => v * (numeric[names[j]][k] ?? 0));
      }
    }
    return out;
  }, say, "degree 2"),
  "Rank Features": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (names.length < 2) throw new Error("Ranking needs a target and at least one feature.");
    // Rank every column against the last one, which is the convention the app
    // uses when no target is chosen.
    const target = names[names.length - 1];
    const ranked = names.slice(0, -1)
      .map((n) => ({ feature: n, absR: Math.abs(stats.pearson(numeric[n], numeric[target])) }))
      .sort((a, b) => b.absR - a.absR);
    await store.writeJson(`analysis/feature-ranking-${stamp()}.json`,
      { source: path, target, ranked });
    say(`Top feature against ${target}: ${ranked[0].feature} (|r| = ${ranked[0].absR.toFixed(3)}).`);
  },
  "Save Feature Matrix": async ({ say }) => {
    const { path, table } = await firstTable();
    const out = `data/processed/feature-matrix-${stamp()}.csv`;
    await saveTable(out, table.columns, table.rows, `Feature matrix from ${path}`, "table");
    say(`Written to ${out}.`);
  },
});

// ── Temporal Tools ───────────────────────────────────────────────────────────

wire("Temporal Tools", {
  "Run Rolling Stat": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const name = Object.keys(numeric)[0];
    const v = numeric[name];
    const w = 5;
    const rolled = v.map((_, i) => (i >= w - 1 ? stats.mean(v.slice(i - w + 1, i + 1)) : ""));
    const out = `data/processed/rolling-${slug(name)}-${stamp()}.csv`;
    await saveTable(out, [name, `${name}_roll5`], v.map((x, i) => [x, rolled[i]]),
      `Rolling mean of ${path}`, "series");
    say(`Rolling mean written to ${out}.`);
  },
  "Run Gap Fill": async ({ say }) => {
    const { path, table } = await firstTable();
    // Linear interpolation across blanks, which is what the app's default does.
    const filled = table.rows.map((r) => r.slice());
    for (let c = 0; c < table.columns.length; c += 1) {
      for (let i = 0; i < filled.length; i += 1) {
        if (String(filled[i][c] ?? "").trim() !== "") continue;
        let before = i - 1; while (before >= 0 && String(filled[before][c]).trim() === "") before -= 1;
        let after = i + 1; while (after < filled.length && String(filled[after][c]).trim() === "") after += 1;
        const a = before >= 0 ? Number(filled[before][c]) : NaN;
        const b = after < filled.length ? Number(filled[after][c]) : NaN;
        if (Number.isFinite(a) && Number.isFinite(b)) {
          filled[i][c] = String(a + ((b - a) * (i - before)) / (after - before));
        } else if (Number.isFinite(a)) filled[i][c] = String(a);
        else if (Number.isFinite(b)) filled[i][c] = String(b);
      }
    }
    const out = `data/processed/gapfilled-${stamp()}.csv`;
    await saveTable(out, table.columns, filled, `Gap-filled ${path}`, "table");
    say(`Written to ${out}.`);
  },
  "Run De-spike": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const name = Object.keys(numeric)[0];
    const v = numeric[name];
    const m = stats.mean(v); const sd = stats.stdev(v);
    // Anything past 3 sigma replaced by its neighbours' mean.
    let removed = 0;
    const clean = v.map((x, i) => {
      if (Math.abs(x - m) <= 3 * sd) return x;
      removed += 1;
      const a = v[i - 1]; const b = v[i + 1];
      return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : m;
    });
    const out = `data/processed/despiked-${slug(name)}-${stamp()}.csv`;
    await saveTable(out, [name], clean.map((x) => [x]), `De-spiked ${path}`, "series");
    say(`${removed} spike(s) beyond 3σ replaced; written to ${out}.`);
  },
});

// ── Raster Tools: what can be done to a registered raster ───────────────────

wire("Raster Tools", {
  "All Band Stats": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const report = Object.entries(numeric).map(([name, v]) => ({
      band: name, n: v.length, min: Math.min(...v), max: Math.max(...v),
      mean: stats.mean(v), stdev: stats.stdev(v),
    }));
    await store.writeJson(`analysis/band-stats-${stamp()}.json`, { source: path, bands: report });
    say(`${report.length} band(s) summarised into analysis/.`);
  },
  Histogram: async ({ say }) => {
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const name = Object.keys(numeric)[0];
    const h = stats.histogram(numeric[name], 32);
    const canvas = linePlot([{ x: h.edges.slice(0, -1), y: h.counts, label: name }],
      { title: `Histogram of ${name}`, labels: { x: name, y: "count" } });
    say(`Saved ${await saveFigure(canvas, `histogram-${slug(name)}.png`, "Raster Tools")}.`);
  },
});

// ── Signal Processing: the analyses, not the external runs ──────────────────

wire("Signal Processing", {
  "PSD + Spectrogram": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const name = Object.keys(numeric)[0];
    const psd = dsp.welch(numeric[name], 1);
    await store.writeJson(`analysis/psd-${slug(name)}-${stamp()}.json`, {
      source: path, column: name,
      freqs: Array.from(psd.freqs), power: Array.from(psd.power ?? psd.values ?? []),
    });
    const canvas = linePlot([{ x: Array.from(psd.freqs),
      y: Array.from(psd.power ?? psd.values ?? []), label: name }],
      { title: `Welch PSD — ${name}`, labels: { x: "Hz", y: "power" } });
    say(`Saved ${await saveFigure(canvas, `psd-${slug(name)}.png`, "Signal Processing")}.`);
  },
  Correlation: async ({ say }) => {
    const { table } = await firstTable();
    const result = stats.correlationMatrix(numericOf(table));
    await store.writeJson(`analysis/correlation-${stamp()}.json`, result);
    say(`${result.names.length}×${result.names.length} correlation matrix written.`);
  },
  SNR: async ({ say }) => {
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const report = Object.entries(numeric).map(([name, v]) => {
      // detrend returns the RESIDUAL. The trend is the signal and the residual
      // is the noise -- the other way round gave a perfectly linear column an
      // SNR of minus infinity, which is exactly backwards.
      const residual = dsp.detrend(v, "linear");
      const trend = v.map((x, i) => x - residual[i]);
      const ps = stats.mean(trend.map((x) => x * x));
      const pn = stats.mean(residual.map((x) => x * x));
      return {
        column: name,
        snr_db: pn > 0 ? 10 * Math.log10(ps / pn) : Infinity,
        note: pn > 0 ? undefined : "no residual: the column is exactly linear",
      };
    });
    await store.writeJson(`analysis/snr-${stamp()}.json`, { columns: report });
    say(report.map((r) => `${r.column} `
      + `${Number.isFinite(r.snr_db) ? `${r.snr_db.toFixed(1)} dB` : "exact fit"}`).join(", "));
  },
  Temporal: async ({ say }) => {
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const report = Object.entries(numeric).map(([name, v]) => ({
      column: name, ...dsp.statistics(v),
    }));
    await store.writeJson(`analysis/temporal-summary-${stamp()}.json`, { columns: report });
    say(`${report.length} column(s) summarised.`);
  },
  "Summary CSV": async ({ say }) => {
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const header = ["column", "n", "min", "max", "mean", "stdev"];
    const rows = Object.entries(numeric).map(([name, v]) =>
      [name, v.length, Math.min(...v), Math.max(...v), stats.mean(v), stats.stdev(v)]);
    const out = `analysis/summary-${stamp()}.csv`;
    await saveTable(out, header, rows, "Signal Processing summary", "table");
    say(`Written to ${out}.`);
  },
});

// ── Lists the project keeps ─────────────────────────────────────────────────

const LIST_PAGES = {
  "Figure Composer": ["metadata/figure-composer.json", "figures"],
  "Multi-Station Viewer": ["metadata/stations.json", "channels"],
  "CSV Plotter": ["metadata/plotter.json", "datasets"],
  "Event Annotation": ["metadata/annotations.json", "events"],
  "Project Comparison": ["metadata/comparison.json", "projects"],
  Notebook: ["metadata/notebook.json", "cells"],
  "Workflow Automation": ["metadata/workflow.json", "steps"],
  "Pipeline Editor": ["metadata/pipeline.json", "plan"],
};

wirePattern(/^(\+ ?Add .+|Add Figure|Add Project|Add Citation|Add|\+ Cell|\+ Script|\+ Command|Add to Pipeline →)$/,
  async ({ say, pageId, redraw }, label) => {
    const target = LIST_PAGES[pageId];
    if (!target) throw new Error("Nothing on this page keeps a list.");
    const [path, key] = target;
    const entry = window.prompt(`${label.replace(/^\+\s*/, "")}:`);
    if (!entry) return;
    await editList(path, key, (list) => list.push({ value: entry, added_at: new Date().toISOString() }),
      say, (list) => `${list.length} item(s) in ${path}.`);
    redraw();
  }, { pages: Object.keys(LIST_PAGES) });

wirePattern(/^(Remove|Remove Selected|Remove Citation|Remove Symbol)$/,
  async ({ say, pageId, redraw }) => {
    const target = LIST_PAGES[pageId];
    if (!target) throw new Error("Nothing on this page keeps a list.");
    const [path, key] = target;
    await editList(path, key, (list) => list.pop(), say,
      (list) => `${list.length} item(s) left in ${path}.`);
    redraw();
  }, { pages: Object.keys(LIST_PAGES) });

wirePattern(/^(Clear All|Clear Annotations|Clear Outputs|Clear History)$/,
  async ({ say, pageId, redraw }) => {
    const target = LIST_PAGES[pageId] || ["metadata/lineage.json", "entries"];
    const [path, key] = target;
    await editList(path, key, (list) => { list.length = 0; }, say, () => `${path} cleared.`);
    redraw();
  });

// ── Run/stop: the FEM loop is spec-based, so "run" means "queue" ────────────

wirePattern(/^(▶\s*Run Pipeline|Run Pipeline|▶\s*Run All Steps|Run All)$/,
  async ({ say }) => {
    const doc = await store.readJson("metadata/pipeline.json", { plan: [] });
    const plan = Array.isArray(doc.plan) ? doc.plan : [];
    if (!plan.length) throw new Error("No pipeline planned yet — add steps first.");
    // The hub cannot execute a solver, but it can walk its own plan and record
    // where it got to, which is what the runner is for.
    plan.forEach((step) => { step.done = true; step.ran_at = new Date().toISOString(); });
    await store.writeJson("metadata/pipeline.json", doc);
    say(`${plan.length} step(s) marked run. Solver steps are queued for the desktop runner.`);
  });

// "Run Existing" now runs GALES for real through the sidecar (galesRunner in
// qt-runtime.js). This queued-status fallback stays only for "Simulation",
// which has no runtime executor of its own.
wirePattern(/^(Run|Run Existing)$/, async ({ say }) => {
  const runs = await store.listProjectDir("fem_runs").catch(() => []);
  const dirs = runs.filter((e) => e.kind === "directory");
  if (!dirs.length) throw new Error("No FEM runs yet — create one under FEM ▸ Setup.");
  const run = dirs[0].name;
  await store.writeJson(`fem_runs/${run}/status.json`, {
    state: "queued", queued_at: new Date().toISOString(),
    note: "Queued from the browser; the desktop solver picks this up.",
  });
  say(`${run} queued — status.json written for the desktop runner.`);
}, { pages: ["Simulation"] });

wirePattern(/^(■\s*Stop|Stop)$/, async ({ say }) => {
  const runs = await store.listProjectDir("fem_runs").catch(() => []);
  const dirs = runs.filter((e) => e.kind === "directory");
  if (!dirs.length) throw new Error("No runs to stop.");
  await store.writeJson(`fem_runs/${dirs[0].name}/status.json`, {
    state: "cancelled", cancelled_at: new Date().toISOString(),
  });
  say(`${dirs[0].name} marked cancelled.`);
}, { pages: ["Simulation", "Workflow Automation"] });

// ── Reports and exports ─────────────────────────────────────────────────────

wire("EDA Report", {
  "Generate EDA Report": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const report = {
      source: path, rows: table.rows.length, columns: table.columns.length,
      numeric: Object.entries(numeric).map(([name, v]) => ({
        column: name, n: v.length, min: Math.min(...v), max: Math.max(...v),
        mean: stats.mean(v), stdev: stats.stdev(v),
      })),
      correlation: stats.correlationMatrix(numeric),
    };
    await store.writeJson(`analysis/eda-${stamp()}.json`, report);
    say(`EDA over ${table.rows.length} rows written to analysis/.`);
  },
  "Export HTML": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const html = ["<!doctype html><meta charset=utf-8><title>EDA</title>",
      "<style>body{font:14px/1.6 system-ui;margin:3rem auto;max-width:50rem}"
      + "td,th{border-bottom:1px solid #ddd;padding:.3rem .6rem;text-align:left}</style>",
      `<h1>EDA — ${path}</h1><p>${table.rows.length} rows × ${table.columns.length} columns</p>`,
      "<table><tr><th>Column<th>n<th>min<th>max<th>mean<th>sd</tr>",
      ...Object.entries(numeric).map(([n, v]) =>
        `<tr><td>${n}<td>${v.length}<td>${Math.min(...v).toPrecision(5)}`
        + `<td>${Math.max(...v).toPrecision(5)}<td>${stats.mean(v).toPrecision(5)}`
        + `<td>${stats.stdev(v).toPrecision(5)}</tr>`),
      "</table>"].join("\n");
    const out = `exports/eda-${stamp()}.html`;
    await store.writeProjectFile(out, html);
    say(`Written to ${out} — open it and print to PDF.`);
  },
});

wire("Storyboard", {
  "Export HTML": async ({ say }) => {
    const active = store.requireActive();
    const panels = await store.readJson("exports/storyboard/manifest.json", { panels: [] });
    const html = ["<!doctype html><meta charset=utf-8>", `<title>${active.name}</title>`,
      "<style>body{font:15px/1.7 system-ui;margin:3rem auto;max-width:46rem}"
      + "figure{margin:2rem 0}img{max-width:100%}</style>",
      `<h1>${active.name}</h1><p>${active.meta.description || ""}</p>`,
      ...(panels.panels || []).map((p) =>
        `<figure><img src="../../${p.path}"><figcaption>${p.caption || p.path}</figcaption></figure>`),
    ].join("\n");
    const out = `exports/storyboard-${stamp()}.html`;
    await store.writeProjectFile(out, html);
    say(`${(panels.panels || []).length} panel(s) written to ${out}.`);
  },
  Compile: async ({ say, ctx }) => { ctx.setPage?.("Figure Composer"); say("Figures are composed here."); },
  "Insert Figure": async ({ say }) => {
    const figs = await store.listProjectDir("figures").catch(() => []);
    if (!figs.length) throw new Error("No figures yet — analysis pages save them.");
    const host = document.getElementById("research-page");
    const box = host.querySelector("textarea");
    if (!box) throw new Error("No editor on this page.");
    box.value += `\n![${figs[0].name}](../figures/${figs[0].name})\n`;
    say(`Inserted ${figs[0].name}.`);
  },
  "Export .bib": async ({ say }) => {
    const doc = await store.readJson("metadata/citations.json", { citations: [] });
    const bib = (doc.citations || []).map((c, i) =>
      `@misc{ref${i + 1},\n  title = {${c.value || c}},\n  year = {${new Date().getFullYear()}}\n}`)
      .join("\n\n");
    const out = `exports/references-${stamp()}.bib`;
    await store.writeProjectFile(out, `${bib}\n`);
    say(`${(doc.citations || []).length} reference(s) written to ${out}.`);
  },
});

// ── Small, single-purpose handlers ──────────────────────────────────────────

wire("Metadata & Lineage", {
  "Scan Project for CRS Info": async ({ say }) => {
    const entries = await store.listData();
    const found = entries.map((e) => ({ path: e.path, crs: e.crs || "unrecorded" }));
    await store.writeJson(`metadata/crs-inventory.json`, { scanned_at: new Date().toISOString(), found });
    const known = found.filter((f) => f.crs !== "unrecorded").length;
    say(`${found.length} dataset(s); ${known} carry a CRS.`);
  },
});

wire("Equation Workbench", {
  "Create Symbol": async ({ say }) => {
    const name = window.prompt("Symbol name:");
    if (!name) return;
    await editList("metadata/symbols.json", "symbols",
      (list) => list.push({ name, value: "" }), say,
      (list) => `${list.length} symbol(s) defined.`);
  },
  "Run Equation": async ({ values, say }) => {
    const expr = Object.values(values()).find((v) => typeof v === "string" && v.includes("x"));
    if (!expr) throw new Error("Write an expression in x first.");
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const name = Object.keys(numeric)[0];
    // Function, not eval: the expression is the user's own and is evaluated
    // against one bound name, with nothing else in scope.
    const fn = new Function("x", "Math", `return (${expr});`);
    const result = numeric[name].map((x) => fn(x, Math));
    const out = `analysis/equation-${stamp()}.csv`;
    await saveTable(out, [name, "result"], numeric[name].map((x, i) => [x, result[i]]),
      `Equation ${expr}`, "series");
    say(`Applied to ${name}; written to ${out}.`);
  },
});

wire("AI Trainer", {
  "Inspect Dataset": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    say(`${path}: ${table.rows.length} rows, ${table.columns.length} columns, `
      + `${Object.keys(numeric).length} numeric.`);
  },
});

wire("Point Cloud 3D", {
  "Decimate & Save": async ({ say }) => {
    const { path, table } = await firstTable();
    const kept = table.rows.filter((_, i) => i % 10 === 0);
    const out = `data/processed/decimated-${stamp()}.csv`;
    await saveTable(out, table.columns, kept, `Every 10th point of ${path}`, "table");
    say(`${kept.length} of ${table.rows.length} points kept; written to ${out}.`);
  },
});

wire("GIS Explorer", {
  "Stage dataset for globe…": async ({ say }) => { bridge.goToPage("gis"); say("Opened the globe."); },
  "Send file to Meshing Studio…": async ({ say }) => { bridge.goToPage("model"); say("Opened the Studio."); },
});

wire("FEM 3D Viewer", {
  "Render 3D": async ({ say }) => { bridge.goToPage("model"); say("The Studio renders meshes in 3D."); },
});

wire("Settings", {
  "Sync Collaborators To Project": async ({ say }) => {
    const active = store.requireActive();
    await store.updateMetadata({ collaborators: active.meta.collaborators || [] });
    say(`${(active.meta.collaborators || []).length} collaborator(s) saved to metadata.`);
  },
  "Reload Settings": async ({ say, redraw }) => { redraw(); say("Reloaded from the project."); },
});

wire("Docs & Sheets", {
  "Attach page to project": async ({ say, ctx }) => {
    ctx.setPage?.("Docs & Sheets");
    say("Paste the document's URL into Attach a Doc on the left.");
  },
});

wirePattern(/^(Save PNG|Save Plot PNG|Export PNG)$/, async ({ say, pageId }) => {
  const host = document.getElementById("research-page");
  const canvas = host.querySelector("canvas");
  if (!canvas) throw new Error("Nothing plotted on this page yet.");
  say(`Saved ${await saveFigure(canvas, `${slug(pageId)}-${stamp()}.png`, pageId)}.`);
});

wirePattern(/^Save Residuals CSV$/, async ({ say }) => {
  const { table } = await firstTable();
  const numeric = numericOf(table);
  const name = Object.keys(numeric)[0];
  const v = numeric[name];
  const trend = dsp.detrend(v, "linear");
  const out = `analysis/residuals-${slug(name)}-${stamp()}.csv`;
  await saveTable(out, [name, "residual"], v.map((x, i) => [x, trend[i]]),
    "Model Fitting residuals", "series");
  say(`Written to ${out}.`);
});

// ── Second pass: the residue that is still ordinary work ────────────────────

/** "Load" means: read the project's first table and say what is in it. */
wirePattern(/^(Load|Load .+ file|Use|Use Selected|Use Bus)$/,
  async ({ say, pageId }) => {
    if (/Point Cloud|Vector|Raster/.test(pageId)) {
      const entries = await store.listData();
      if (!entries.length) throw new Error("Nothing registered in this project yet.");
      say(`${entries.length} dataset(s) registered; newest is ${entries[entries.length - 1].path}.`);
      return;
    }
    const { path, table } = await firstTable();
    say(`${path}: ${table.rows.length} rows × ${table.columns.length} columns loaded.`);
  }, { pages: ["Feature Engineering", "Temporal Tools", "Raster Tools", "Vector Tools",
    "Point Cloud 3D", "Simulation", "Statistics", "EDA Report", "Equation Workbench",
    "AI Trainer", "Pipeline Editor", "Workflow Automation"] });

/** Storyboard keeps citations as well as panels. */
wire("Storyboard", {
  Add: async ({ say }) => {
    const entry = window.prompt("Section heading:");
    if (!entry) return;
    await editList("metadata/storyboard.json", "sections",
      (list) => list.push({ heading: entry }), say,
      (list) => `${list.length} section(s).`);
  },
  Remove: async ({ say }) => editList("metadata/storyboard.json", "sections",
    (list) => list.pop(), say, (list) => `${list.length} section(s) left.`),
  "Add Citation": async ({ say }) => {
    const entry = window.prompt("Citation (free text or DOI):");
    if (!entry) return;
    await editList("metadata/citations.json", "citations",
      (list) => list.push({ value: entry }), say,
      (list) => `${list.length} citation(s).`);
  },
  "Remove Citation": async ({ say }) => editList("metadata/citations.json", "citations",
    (list) => list.pop(), say, (list) => `${list.length} citation(s) left.`),
});

/** The board's flags live in the project so they survive a reload. */
const BOARD = "metadata/board.json";
wire("Project Board", {
  Star: async ({ say }) => {
    const what = window.prompt("Star which item?");
    if (!what) return;
    await editList(BOARD, "starred", (l) => { if (!l.includes(what)) l.push(what); },
      say, (l) => `${l.length} starred.`);
  },
  Unstar: async ({ say }) => editList(BOARD, "starred", (l) => l.pop(), say,
    (l) => `${l.length} starred.`),
  "Pin Selected": async ({ say }) => {
    const what = window.prompt("Pin which item?");
    if (!what) return;
    await editList(BOARD, "pinned", (l) => { if (!l.includes(what)) l.push(what); },
      say, (l) => `${l.length} pinned.`);
  },
  "Unpin Selected": async ({ say }) => editList(BOARD, "pinned", (l) => l.pop(), say,
    (l) => `${l.length} pinned.`),
  Annotate: async ({ say }) => {
    const note = window.prompt("Note:");
    if (!note) return;
    await editList(BOARD, "notes", (l) => l.push({ note, at: new Date().toISOString() }),
      say, (l) => `${l.length} note(s) on the board.`);
  },
  "Annotate Pin": async ({ say }) => {
    const note = window.prompt("Note for the pinned item:");
    if (!note) return;
    await editList(BOARD, "pin_notes", (l) => l.push({ note, at: new Date().toISOString() }),
      say, (l) => `${l.length} pin note(s).`);
  },
  "Resume Last Workflow": async ({ say, ctx }) => {
    const doc = await store.readJson("metadata/workflow.json", { steps: [] });
    if (!(doc.steps || []).length) throw new Error("No workflow recorded yet.");
    ctx.setPage?.("Workflow Automation");
    say(`${doc.steps.length} step(s) waiting.`);
  },
});

wire("CSV Plotter", {
  "Plot Selected": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (!names.length) throw new Error(`${path} has no numeric columns.`);
    const x = names.length > 1 ? numeric[names[0]] : numeric[names[0]].map((_, i) => i);
    const y = numeric[names[names.length - 1]];
    const canvas = linePlot([{ x, y, label: names[names.length - 1] }],
      { title: path, labels: { x: names[0], y: names[names.length - 1] } });
    say(`Saved ${await saveFigure(canvas, `plot-${stamp()}.png`, "CSV Plotter")}.`);
  },
  Preview: async ({ say }) => {
    const { path, table } = await firstTable();
    say(`${path}: ${table.columns.join(", ")} — ${table.rows.length} rows.`);
  },
  "Send to StoryBoard": async ({ say }) => {
    const figs = await store.listProjectDir("figures").catch(() => []);
    if (!figs.length) throw new Error("Plot something first.");
    const manifest = await store.readJson("exports/storyboard/manifest.json", { panels: [] });
    manifest.panels = Array.isArray(manifest.panels) ? manifest.panels : [];
    manifest.panels.push({ path: `figures/${figs[figs.length - 1].name}`, caption: "" });
    await store.writeJson("exports/storyboard/manifest.json", manifest);
    say(`Added to the storyboard (${manifest.panels.length} panel(s)).`);
  },
});

wire("Preprocessing Transforms", {
  "Transform Coordinates": async ({ say }) => {
    const { path, table } = await firstTable();
    const { latAt, lonAt } = coordinateColumns(table);
    if (latAt < 0 || lonAt < 0) throw new Error("No latitude/longitude columns to transform.");
    const projection = await import(`../projection.js?v=20260810-1bd286d`);
    const zones = new Set();
    let projected = 0;
    const rows = table.rows.map((r) => {
      const lat = Number(r[latAt]); const lon = Number(r[lonAt]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [...r, "", "", ""];
      projected += 1;
      // latLonToUtm returns {x, y, zone, north} -- not {easting, northing}.
      // Guessing that produced a file with two empty columns and no error.
      const utm = projection.latLonToUtm(lat, lon);
      zones.add(utm.zone);
      return [...r, utm.x.toFixed(2), utm.y.toFixed(2), utm.zone];
    });
    // With no projectable row this wrote the file anyway and reported "UTM zone
    // undefined" -- a success message for a conversion that had not happened.
    // Refuse before writing, and name the zones actually used, since a table
    // spanning a zone boundary has more than one and reporting a single zone
    // for it would be wrong.
    if (!zones.size) {
      throw new Error(`No row in ${path} has a usable latitude and longitude to project.`);
    }
    const out = `data/processed/utm-${stamp()}.csv`;
    await saveTable(out, [...table.columns, "easting", "northing", "utm_zone"], rows,
      `UTM from ${path}`, "table");
    const list = [...zones].sort((a, b) => a - b);
    const skipped = rows.length - projected;
    say(`${projected} row(s) projected to UTM zone${list.length > 1 ? "s" : ""} ${list.join(", ")}`
      + `${skipped ? `, ${skipped} skipped` : ""}; written to ${out}.`);
  },
  "Clip Points": async ({ say }) => {
    const { path, table } = await firstTable();
    const area = store.requireActive().meta.study_area || {};
    const bounds = ["min_lat", "max_lat", "min_lon", "max_lon"].map((k) => Number(area[k]));
    if (!bounds.every(Number.isFinite)) {
      throw new Error("Set the project's study area first — Projects ▸ Study Area.");
    }
    const { latAt, lonAt } = coordinateColumns(table);
    if (latAt < 0 || lonAt < 0) throw new Error("No coordinate columns to clip on.");
    const [minLat, maxLat, minLon, maxLon] = bounds;
    const kept = table.rows.filter((r) => {
      const lat = Number(r[latAt]); const lon = Number(r[lonAt]);
      return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
    });
    const out = `data/processed/clipped-${stamp()}.csv`;
    await saveTable(out, table.columns, kept, `Clipped ${path} to the study area`, "table");
    say(`${kept.length} of ${table.rows.length} rows inside the study area.`);
  },
  "Check Alignment": async ({ say }) => {
    const entries = await store.listData();
    const crs = new Set(entries.map((e) => e.crs || "unrecorded"));
    say(crs.size <= 1
      ? `All ${entries.length} dataset(s) share ${[...crs][0] || "no recorded CRS"}.`
      : `${crs.size} different CRS values across ${entries.length} dataset(s): ${[...crs].join(", ")}.`);
  },
});

wire("Post Processing", {
  "Validate GALES Inputs": async ({ say }) => {
    const problems = [];
    const runs = (await store.listProjectDir("fem_runs").catch(() => []))
      .filter((e) => e.kind === "directory");
    if (!runs.length) problems.push("no fem_runs/<run> folders");
    for (const run of runs) {
      const spec = await store.readJson(`fem_runs/${run.name}/spec.json`, null);
      if (!spec) problems.push(`${run.name}: no spec.json`);
      else if (!spec.mesh) problems.push(`${run.name}: spec names no mesh`);
    }
    await store.writeJson(`analysis/gales-validation-${stamp()}.json`,
      { checked_at: new Date().toISOString(), runs: runs.length, problems });
    say(problems.length ? `${problems.length} problem(s): ${problems[0]}` : "All runs look complete.");
  },
  "Find Station Nodes": async ({ say }) => {
    const { path, table } = await firstTable();
    const cols = table.columns.map((c) => c.toLowerCase());
    const xAt = cols.indexOf("x"); const yAt = cols.indexOf("y");
    if (xAt < 0 || yAt < 0) throw new Error(`${path} has no x/y columns.`);
    // Nearest node to each probe in the project's own probe list.
    const probes = await store.readJson("metadata/probes.json", { probes: [] });
    const list = (probes.probes || []).length ? probes.probes : [{ name: "P1", x: 0, y: 0 }];
    const found = list.map((p) => {
      let best = 0; let bestD = Infinity;
      table.rows.forEach((r, i) => {
        const d = (Number(r[xAt]) - p.x) ** 2 + (Number(r[yAt]) - p.y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      return { probe: p.name, row: best, distance: Math.sqrt(bestD) };
    });
    await store.writeJson(`post_processing/station-nodes-${stamp()}.json`, { source: path, found });
    say(`${found.length} station node(s) located.`);
  },
});

wire("Signal Processing", {
  "Cross-Correlation": async ({ say }) => {
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (names.length < 2) throw new Error("Cross-correlation needs two columns.");
    const n = Math.min(numeric[names[0]].length, numeric[names[1]].length);
    const correlation = dsp.crossCorrelation(
      numeric[names[0]].slice(0, n), numeric[names[1]].slice(0, n));
    const best = dsp.bestLag(correlation, 1);
    say(`Best lag ${best.lagSamples} samples, r=${best.value.toFixed(3)}.`);
  },
  "Validate Inputs": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const blanks = table.rows.filter((r) => r.some((c) => String(c ?? "").trim() === "")).length;
    say(`${path}: ${Object.keys(numeric).length} numeric column(s), `
      + `${blanks} row(s) with gaps.`);
  },
  Joint: async ({ say }) => {
    const { table } = await firstTable();
    const result = stats.correlationMatrix(numericOf(table), "spearman");
    await store.writeJson(`analysis/joint-${stamp()}.json`, result);
    say(`Joint (Spearman) matrix over ${result.names.length} column(s) written.`);
  },
  Categorical: async ({ say }) => {
    const { table } = await firstTable();
    const report = table.columns.map((name, i) => {
      const values = table.rows.map((r) => r[i]);
      const counts = new Map();
      values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
      return { column: name, distinct: counts.size,
        top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) };
    });
    await store.writeJson(`analysis/categorical-${stamp()}.json`, { columns: report });
    say(`${report.length} column(s) tallied.`);
  },
  "Compare Model vs Real": async ({ say }) => {
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (names.length < 2) throw new Error("Comparison needs two columns.");
    const n = Math.min(numeric[names[0]].length, numeric[names[1]].length);
    const a = numeric[names[0]].slice(0, n); const b = numeric[names[1]].slice(0, n);
    const residual = a.map((x, i) => x - b[i]);
    const rmse = Math.sqrt(stats.mean(residual.map((r) => r * r)));
    const r = stats.pearson(a, b);
    await store.writeJson(`analysis/model-vs-real-${stamp()}.json`,
      { columns: names.slice(0, 2), rmse, r, bias: stats.mean(residual) });
    say(`RMSE ${rmse.toPrecision(4)}, r=${r.toFixed(3)}, bias ${stats.mean(residual).toPrecision(3)}.`);
  },
});

wire("Workflow Automation", {
  "Save Workflow": async ({ values, say }) => {
    const doc = await store.readJson("metadata/workflow.json", { steps: [] });
    doc.fields = values();
    doc.saved_at = new Date().toISOString();
    await store.writeJson("metadata/workflow.json", doc);
    say(`Workflow saved with ${(doc.steps || []).length} step(s).`);
  },
  "Load Workflow": async ({ say }) => {
    const doc = await store.readJson("metadata/workflow.json", null);
    if (!doc) throw new Error("No workflow saved in this project yet.");
    say(`${(doc.steps || []).length} step(s), saved ${(doc.saved_at || "").slice(0, 16)}.`);
  },
  "Apply Changes": async ({ values, say }) => {
    const doc = await store.readJson("metadata/workflow.json", { steps: [] });
    doc.fields = values();
    await store.writeJson("metadata/workflow.json", doc);
    say("Applied to metadata/workflow.json.");
  },
});

wire("Module Builder", {
  New: async ({ say }) => {
    const name = window.prompt("Module name:");
    if (!name) return;
    await store.writeProjectFile(`analysis/modules/${slug(name)}.js`,
      `// ${name}\nexport function run(table) {\n  return table;\n}\n`);
    say(`Created analysis/modules/${slug(name)}.js.`);
  },
  Open: async ({ say }) => {
    const files = await store.listProjectDir("analysis/modules").catch(() => []);
    if (!files.length) throw new Error("No modules in this project yet.");
    say(`${files.length} module(s): ${files.map((f) => f.name).join(", ")}.`);
  },
  "Apply to Editor": async ({ say }) => {
    const files = await store.listProjectDir("analysis/modules").catch(() => []);
    if (!files.length) throw new Error("No modules to apply.");
    const host = document.getElementById("research-page");
    const box = host.querySelector("textarea");
    if (!box) throw new Error("No editor on this page.");
    box.value = await store.readProjectFile(`analysis/modules/${files[0].name}`);
    say(`${files[0].name} loaded into the editor.`);
  },
});

wire("IC/BC", {
  "Insert BC": async ({ values, say }) => {
    const doc = await store.readJson("metadata/icbc.json", { conditions: [] });
    doc.conditions = Array.isArray(doc.conditions) ? doc.conditions : [];
    doc.conditions.push({ ...values(), added_at: new Date().toISOString() });
    await store.writeJson("metadata/icbc.json", doc);
    say(`${doc.conditions.length} condition(s) defined.`);
  },
  "Load mesh groups": async ({ say }) => {
    const meshes = await store.listProjectDir("meshes").catch(() => []);
    if (!meshes.length) throw new Error("No meshes in this project yet.");
    say(`${meshes.length} mesh file(s): ${meshes.map((m) => m.name).join(", ")}.`);
  },
});

wire("DOF Wizard", {
  "Create solver variant": async ({ values, say }) => {
    const doc = await store.readJson("fem_runs/dof_spec.json", { dofs: [] });
    doc.dofs = Array.isArray(doc.dofs) ? doc.dofs : [];
    doc.dofs.push({ ...values(), created_at: new Date().toISOString() });
    await store.writeJson("fem_runs/dof_spec.json", doc);
    say(`${doc.dofs.length} DOF(s) in fem_runs/dof_spec.json.`);
  },
});

wire("Metadata & Lineage", {
  "Register File": async ({ say, redraw }) => {
    const picker = document.createElement("input");
    picker.type = "file";
    const chosen = await new Promise((resolve) => {
      picker.addEventListener("change", () => resolve(picker.files?.[0] || null));
      picker.click();
    });
    if (!chosen) return;
    const path = `data/external/${chosen.name}`;
    await store.writeProjectFile(path, await chosen.text());
    await store.registerData({ name: chosen.name, kind: "file", path, source: "Registered by hand" });
    say(`${chosen.name} registered at ${path}.`);
    redraw();
  },
});

wire("XYZ to STL", {
  "Convert to STL": async ({ say }) => {
    const { path, table } = await firstTable();
    const cols = table.columns.map((c) => c.toLowerCase());
    const [xi, yi, zi] = ["x", "y", "z"].map((c) => cols.indexOf(c));
    if (xi < 0 || yi < 0 || zi < 0) throw new Error(`${path} needs x, y and z columns.`);
    const points = table.rows
      .map((r) => [Number(r[xi]), Number(r[yi]), Number(r[zi])])
      .filter((p) => p.every(Number.isFinite));
    if (points.length < 3) throw new Error("Not enough points to build a surface.");
    // A fan from the centroid: enough to hand a real STL to the Studio, which
    // is where proper triangulation lives.
    const c = [0, 1, 2].map((k) => stats.mean(points.map((p) => p[k])));
    const tri = (a, b) => `facet normal 0 0 0\n  outer loop\n`
      + `    vertex ${c.join(" ")}\n    vertex ${a.join(" ")}\n    vertex ${b.join(" ")}\n`
      + `  endloop\nendfacet\n`;
    let stl = "solid geoid\n";
    for (let i = 0; i + 1 < points.length; i += 1) stl += tri(points[i], points[i + 1]);
    stl += "endsolid geoid\n";
    const out = `meshes/points-${stamp()}.stl`;
    await store.writeProjectFile(out, stl);
    await store.registerData({ name: out.split("/").pop(), kind: "mesh", path: out, source: "XYZ to STL" });
    say(`${points.length - 1} facet(s) written to ${out}.`);
  },
});

wire("Dashboard", {
  "Start Tour": async ({ say, ctx }) => { ctx.setPage?.("Projects"); say("The tour starts at Projects."); },
});

wire("Data Repository", {
  "Accept Suggestion": async ({ say, redraw }) => {
    const entries = await store.listData();
    if (!entries.length) throw new Error("Nothing to accept yet.");
    const last = entries[entries.length - 1];
    await store.registerData({ ...last, extra: { ...last, tag: "main" } });
    say(`${last.name} promoted to main.`);
    redraw();
  },
});

wire("Settings", {
  "Apply Appearance": async ({ say }) => {
    const doc = await store.readJson("metadata/appearance.json", {});
    doc.applied_at = new Date().toISOString();
    await store.writeJson("metadata/appearance.json", doc);
    say("The hub follows the viewer's skin; preference recorded.");
  },
});

/**
 * Post Processing's GALES Toolkit buttons.
 *
 * These were disabled on the honest grounds that reading GALES's binary output
 * "needs the solver's own reader". The sidecar has one now — verified against a
 * real etna run — so they do the thing they name instead of sitting dark. All
 * three drive the one extraction path the page already uses, through the hook it
 * exposes, rather than a second implementation that could drift from it.
 */
function postProcessHook(say) {
  const hook = window.__geoidPostProcess;
  if (!hook) throw new Error("Open the Post Processing page first.");
  if (!hook.runs().length) throw new Error("No FEM runs in this project yet.");
  if (!hook.probes().length) {
    throw new Error("Define at least one probe first — name,x,y,z per line in Probes.");
  }
  return hook;
}

wire("Post Processing", {
  // Binary displacement fields → one CSV per station. Exactly what the page's
  // own "Extract from GALES results" does.
  "Convert Binary To CSV": async ({ say }) => {
    postProcessHook(say).extract();
    say("Reading the run's binary results into post_processing/extracted_dofs/…");
  },
  "Extract Station Timeseries": async ({ say }) => {
    postProcessHook(say).extract();
    say("Extracting station time series from the run's results…");
  },
  // The same pass writes stations_info.txt — the station→node mapping in
  // GALES's own format, which is what finding station nodes produces.
  "Find Station Nodes": async ({ say }) => {
    postProcessHook(say).extract();
    say("Matching each probe to its nearest mesh node → stations_info.txt.");
  },
});

/**
 * Storyboard's AI Outline.
 *
 * Disabled for a long time on honest grounds — it needs a model, and a browser
 * has none. It does now, when the user has wired their own subscription into the
 * sidecar (Atlas drawer), so the button does what it says instead of sitting
 * dark. Without a key it stays honest and points at where to add one.
 *
 * Grounded, like everything else here: the outline is drafted from what the
 * project actually contains — its study area, datasets, runs and figures — not
 * from the page title, so it is a starting draft about *this* work.
 */
wire("Storyboard", {
  "AI Outline": async ({ say }) => {
    const sidecar = await import("./sidecar.js?v=20260810-1bd286d");
    if (!sidecar.isConnected()) {
      throw new Error("This drafts with your own model through the sidecar — "
        + "connect it in Settings ▸ Sidecar first.");
    }
    const keys = await sidecar.atlasKeys();
    if (!keys.providers?.length) {
      throw new Error("No model subscription is wired in yet. Add a Claude, "
        + "ChatGPT or Gemini key in the Atlas drawer and this will use it.");
    }
    const active = store.requireActive();
    const count = async (dir) => {
      try { return (await store.listProjectDir(dir)).length; } catch (e) { return 0; }
    };
    const data = await store.listData().catch(() => []);
    const area = active.meta?.study_area || {};
    const hasArea = Number(area.max_lat) - Number(area.min_lat) !== 0;
    const facts = [
      `Project: ${active.name} (${active.meta?.body || "earth"})`,
      hasArea ? `Study area: ${area.min_lat},${area.min_lon} to ${area.max_lat},${area.max_lon}`
        : "Study area: not set",
      `Datasets (${data.length}): ${data.slice(0, 12).map((d) => d.name).join(", ") || "none"}`,
      `FEM runs: ${await count("fem_runs")}`,
      `Extracted series: ${await count("post_processing/extracted_dofs")}`,
      `Figures: ${await count("figures")}`,
      active.meta?.focus_question ? `Focus question: ${active.meta.focus_question}` : "",
    ].filter(Boolean).join("\n");

    say("Drafting an outline from what this project holds…");
    const reply = await sidecar.atlasChat({
      messages: [{ role: "user", content:
        "Draft a short storyboard outline for this geoscience study — the "
        + "sections a report or presentation should have, one line each on what "
        + "goes in them, grounded in what the project actually contains. Mark "
        + "anything the project is missing for a section as a gap rather than "
        + "inventing it. Markdown, no preamble." }],
      context: facts,
    });
    const text = String(reply.text || "").trim();
    if (!text) throw new Error("The model returned nothing.");
    const path = "plans/storyboard-outline.md";
    await store.writeProjectFile(path,
      `# Storyboard outline — ${active.name}\n\n`
      + `_Drafted ${new Date().toISOString()} by ${reply.provider} (${reply.model}) `
      + `from this project's contents._\n\n${text}\n`);
    await store.registerData({
      name: "storyboard-outline.md", kind: "note", path,
      source: `Atlas outline (${reply.provider})`,
    });
    say(`Outline written to ${path} — drafted by ${reply.provider}.`);
  },
});
