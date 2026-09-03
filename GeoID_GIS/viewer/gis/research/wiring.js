import { wirePattern, wire } from "./spec-page.js?v=20260903-9b68b94";
import * as store from "./project-store.js?v=20260903-9b68b94";
import * as bridge from "./bridge.js?v=20260903-9b68b94";
import * as stats from "./stats.js?v=20260903-9b68b94";
import * as dsp from "./dsp.js?v=20260903-9b68b94";
import { linePlot } from "./plot.js?v=20260903-9b68b94";
import { column } from "./table.js?v=20260903-9b68b94";
import { findTables, loadTable, saveFigure } from "./pages/common.js?v=20260903-9b68b94";

/**
 * Behaviour for the controls the spec brings across.
 *
 * Three hundred-odd disabled controls are not three hundred behaviours. The
 * app reuses the same verbs everywhere — Refresh, Browse, Export CSV, Open in
 * Meshing Studio — so they are wired once by label and a page only needs its
 * own handler where it genuinely differs.
 *
 * The rule kept throughout: **wire it or leave it disabled.** A handler that
 * pops a message and does nothing would turn an honest disabled button into a
 * dishonest live one. Where the desktop app shells out to a native binary
 * (Gmsh, laspy, a system file manager) the control stays disabled, because
 * that is the truth about a browser.
 */

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/** Ask for files and put them in the project, registered. */
async function importFiles({ say, redraw }, { dest = "data/raw", accept = "" } = {}) {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  if (accept) picker.accept = accept;
  const chosen = await new Promise((resolve) => {
    picker.addEventListener("change", () => resolve(Array.from(picker.files || [])));
    // A cancelled picker fires nothing at all, so nothing resolves and nothing
    // happens -- which is the correct outcome, not an error.
    picker.click();
  });
  if (!chosen.length) return;
  let added = 0;
  for (const file of chosen) {
    const path = `${dest}/${file.name}`;
    const isText = /\.(csv|tsv|txt|dat|json|geojson|md|xyz|asc|obj|ply|msh|geo|vtk)$/i
      .test(file.name);
    await store.writeProjectFile(path, isText ? await file.text() : await file.arrayBuffer());
    await store.registerData({
      name: file.name, kind: "file", path, source: "Import",
      extra: { bytes: file.size },
    });
    added += 1;
  }
  say(`Imported ${added} file(s) into ${dest}.`);
  redraw();
}

/** Everything the project has registered, as a CSV in exports/. */
async function exportRegistryCsv({ say, pageId }) {
  const rows = await store.listData();
  const header = ["name", "kind", "path", "source", "crs", "added_at"];
  const csv = [header.join(",")]
    .concat(rows.map((r) => header
      .map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")))
    .join("\n");
  const path = `exports/${pageId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${nowStamp()}.csv`;
  await store.writeProjectFile(path, csv);
  say(`${rows.length} row(s) written to ${path}.`);
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// Redraw. The page rebuilds from the project, which is what refresh means here.
wirePattern(/^(Refresh|Refresh .+|Rescan .*|Reload)$/i, async ({ say, redraw }) => {
  redraw();
  say("Refreshed from the project.");
});

// Bring files in. Destination follows the page: ingest pages stage into
// data/pulled, everything else into data/raw.
wirePattern(/^(Browse|Browse .+|Import .*Files?|Import Dataset|Add Dataset|Load Preset File|Import Service Export)$/i,
  async (api) => {
    const pulled = /^Ingest /.test(api.pageId);
    await importFiles(api, { dest: pulled ? "data/pulled" : "data/raw" });
  });

// Hand off to the other two pages of the workspace.
wirePattern(/^(Open in Earth viewer|Open in Globe|To Explorer|Open Study Area Map)$/i,
  async ({ say }) => { bridge.goToPage("gis"); say("Opened the globe."); });
wirePattern(/^(Open in Meshing Studio|Send file to Studio…?|Open Gmsh Studio)$/i,
  async ({ say }) => { bridge.goToPage("model"); say("Opened the Meshing Studio."); });

// Navigate inside the hub. The label names its destination, which is the whole
// reason this can be generic.
const DESTINATIONS = {
  "open pipeline runner": "Pipeline Runner",
  "open storyboard": "Storyboard",
  "open setup": "Setup",
  "go to fem setup": "Setup",
  "open projects": "Projects",
  "open data hub": "Data Hub",
  "open figure composer": "Figure Composer",
  "open notes": "Research Notes",
  "create note": "Research Notes",
  "open latest figure": "Figure Composer",
  "open selected": "Data Repository",
  "import dataset": "Data Repository",
};
wirePattern(/^(Open |Go to |Create Note)/i, async ({ say, ctx, pageId }, label) => {
  const target = DESTINATIONS[String(label || "").toLowerCase().trim()];
  if (!target || target === pageId) throw new Error("Nothing to open for that.");
  ctx.setPage?.(target);
});

// Export. Anything asking for a CSV of what the project holds gets one.
wirePattern(/^(Export CSV|Export .*CSV|Export lineage CSV|Export Summary|Export Briefing|Export Weekly)$/i,
  exportRegistryCsv);

wirePattern(/^(Save Notes?|Save narrative|Save)$/i, async ({ values, say, pageId }) => {
  const text = Object.values(values()).filter((v) => typeof v === "string" && v.length > 40)[0];
  if (!text) throw new Error("Nothing on this page to save yet.");
  const path = `notes/${pageId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
  await store.writeProjectFile(path, text);
  say(`Saved to ${path}.`);
});

// A reproducibility snapshot: the metadata, the registry, and what produced it.
wirePattern(/^(Export Repro Snapshot|Create Repro Bundle|Export Project Brief)$/i,
  async ({ say }) => {
    const active = store.requireActive();
    const path = `exports/snapshot-${nowStamp()}.json`;
    await store.writeJson(path, {
      created_at: new Date().toISOString(),
      project: { name: active.name, dir: active.dir, body: active.meta.body },
      metadata: active.meta,
      data_registry: await store.listData(),
    });
    say(`Written to ${path}.`);
  });

// ── Pages whose verbs are their own ──────────────────────────────────────────

wire("Project Comparison", {
  "Add Current Project": async ({ say }) => {
    const active = store.requireActive();
    const list = await store.readJson("metadata/comparison.json", { projects: [] });
    list.projects = Array.isArray(list.projects) ? list.projects : [];
    if (!list.projects.includes(active.dir)) list.projects.push(active.dir);
    await store.writeJson("metadata/comparison.json", list);
    say(`${active.name} added to the comparison set.`);
  },
});

wire("Pipeline Runner", {
  "Reset Status": async ({ say }) => {
    const plan = await store.readJson("metadata/pipeline.json", { plan: [] });
    (plan.plan || []).forEach((step) => { step.done = false; });
    await store.writeJson("metadata/pipeline.json", plan);
    say("Every step marked not done.");
  },
});

// Research Notes' formatting buttons are the shared markdown pattern below.
// A page-specific handler always beats a pattern, so the stub that used to sit
// here -- "Select text in the editor first.", which inserted nothing -- was
// quietly shadowing the working one for H1 alone, on the one page whose whole
// toolbar is those buttons.

/**
 * Controls that stay disabled, and why.
 *
 * Listed rather than silently skipped so the reason is on the record: each one
 * needs a process a browser tab does not have. Wiring them would mean shipping
 * a button that cannot do what it says.
 */
export const CANNOT_WIRE = {
  // The Event Correlation Toolkit's analyses are native now (see
  // event-correlation.js). The external script runner (Run Script Main, Run
  // Function, Stop External Run) and AI Trainer's Run Training Script are now
  // real too, *when the sidecar is connected* — they start a subprocess on it
  // and stream the log (qt-runtime.js). Without the sidecar they say so rather
  // than pretend. What genuinely cannot be done in a browser at all stays here.
  "Run Selected Module": "Executes a Python module in the desktop app's interpreter.",
  "Run Script Main": "Executes Python; a browser tab has no interpreter.",
  "Run Function": "Executes Python; a browser tab has no interpreter.",
  "Stop External Run": "There is no external process to stop from a browser tab.",
  // "Convert Binary To CSV", "Extract Station Timeseries" and "Find Station
  // Nodes" used to live here — GALES binary output did need the solver's own
  // reader. The sidecar has one now (verified against a real run), so they are
  // wired in wiring-pages.js rather than disabled.
  // "AI Outline" used to live here — it needs a model, and a browser has none.
  // It can have one now: the user's own Claude/ChatGPT/Gemini key, held by the
  // sidecar. Wired in wiring-pages.js, and honest about needing a key.
};

/**
 * Things that WERE on this list and are not any more, because re-reading beat
 * trusting the first judgement about them:
 *
 * PCA, k-means and the hypothesis tests -- short algorithms, written out in
 * `stats.js`. Heatmap, Run Join, Reproject and Convert -- `plot.heatmap`,
 * `geoprocessing.spatialJoin`, `projection.latLonToUtm` and the gmsh node
 * parser were already in the tree. Run Test, Install and Uninstall -- the
 * hub's modules are JavaScript, so they genuinely load and run. Start Watch --
 * a browser cannot be told when a folder changes, but it can look.
 *
 * Where a control does less here than in the desktop app it says so on the
 * page: Convert writes vertices and not elements, Export writes XYZ and not
 * LAS, Run Training Script fits a baseline and still hands over to the real
 * trainer through training_spec.json.
 */


// ── Analysis: the maths pages ────────────────────────────────────────────────


/** Every numeric column of the first table in the project, as {name: values}. */
async function numericColumns() {
  const tables = await findTables();
  if (!tables.length) throw new Error("No tables in this project yet.");
  const table = await loadTable(tables[0]);
  const out = {};
  table.columns.forEach((name, i) => {
    if (!table.numeric[i]) return;
    const values = column(table, name).filter(Number.isFinite);
    if (values.length > 1) out[name] = values;
  });
  if (!Object.keys(out).length) throw new Error(`${tables[0]} has no numeric columns.`);
  return { path: tables[0], columns: out };
}

/** Write a result where the analysis pages already look for one. */
async function saveAnalysis(name, payload, say) {
  const path = `analysis/${name}-${nowStamp()}.json`;
  await store.writeJson(path, payload);
  say(`Written to ${path}.`);
  return path;
}

wire("Statistics", {
  "Compute Correlation Matrix": async ({ say }) => {
    const { path, columns } = await numericColumns();
    const result = stats.correlationMatrix(columns, "pearson");
    await saveAnalysis("correlation", { source: path, ...result }, say);
  },
  "Run PCA": async ({ say }) => {
    const { path, columns } = await numericColumns();
    if (Object.keys(columns).length < 2) throw new Error("PCA needs two or more numeric columns.");
    const result = stats.pca(columns, { components: 3 });
    const first = result.components[0];
    await saveAnalysis("pca", { source: path, ...result }, say);
    say(`PC1 explains ${(first.explained * 100).toFixed(1)}% — written to analysis/.`);
  },
  Cluster: async ({ say }) => {
    const { path, columns } = await numericColumns();
    const result = stats.kmeans(columns, { k: 3 });
    await saveAnalysis("kmeans", { source: path, ...result }, say);
    const sizes = [0, 1, 2].map((c) => result.labels.filter((l) => l === c).length);
    say(`k=3 clusters of ${sizes.join(", ")} points — written to analysis/.`);
  },
  "Run Test": async ({ say }) => {
    const { columns } = await numericColumns();
    const names = Object.keys(columns);
    if (names.length < 2) throw new Error("A two-sample test needs two numeric columns.");
    const [a, b] = [columns[names[0]], columns[names[1]]];
    const t = stats.tTest(a, b);
    const mw = stats.mannWhitney(a, b);
    const ks = stats.ksTest(a, b);
    await saveAnalysis("hypothesis-tests",
      { columns: names.slice(0, 2), tTest: t, mannWhitney: mw, ks }, say);
    say(`${names[0]} vs ${names[1]}: Welch p=${t.p.toExponential(2)}, `
      + `Mann-Whitney p=${mw.p.toExponential(2)}, KS p=${ks.p.toExponential(2)}.`);
  },
  "Plot Distribution": async ({ say }) => {
    const { columns } = await numericColumns();
    const name = Object.keys(columns)[0];
    const h = stats.histogram(columns[name], 24);
    // linePlot takes an array of {x, y} series, and saveFigure wants the
    // filename with its extension -- both checked against plot.js rather than
    // assumed, after the first draft guessed and threw.
    const canvas = linePlot(
      [{ x: h.edges.slice(0, -1), y: h.counts, label: name }],
      { title: `Distribution of ${name}`, labels: { x: name, y: "count" } });
    const path = await saveFigure(canvas, `distribution-${name}.png`, "Statistics");
    say(`Histogram of ${name} saved to ${path}.`);
  },
});

wire("Multi-Station Viewer", {
  "Compute Cross-Correlation": async ({ say }) => {
    const { columns } = await numericColumns();
    const names = Object.keys(columns);
    if (names.length < 2) throw new Error("Cross-correlation needs two columns.");
    const n = Math.min(columns[names[0]].length, columns[names[1]].length);
    const correlation = dsp.crossCorrelation(
      columns[names[0]].slice(0, n), columns[names[1]].slice(0, n));
    const best = dsp.bestLag(correlation, 1);
    await saveAnalysis("cross-correlation", {
      columns: names.slice(0, 2),
      bestLagSamples: best.lagSamples,
      peak: best.value,
      lags: Array.from(correlation.lags),
      values: Array.from(correlation.values),
    }, say);
    say(`Best lag ${best.lagSamples} samples, r=${best.value.toFixed(3)}.`);
  },
  "Compute Coherence": async ({ say }) => {
    const { columns } = await numericColumns();
    const names = Object.keys(columns);
    if (names.length < 2) throw new Error("Coherence needs two columns.");
    const n = Math.min(columns[names[0]].length, columns[names[1]].length);
    const result = dsp.coherence(
      columns[names[0]].slice(0, n), columns[names[1]].slice(0, n), 1);
    const values = Array.from(result.values).filter(Number.isFinite);
    const mean = stats.mean(values);
    await saveAnalysis("coherence", {
      columns: names.slice(0, 2),
      segments: result.segments,
      meanCoherence: mean,
      freqs: Array.from(result.freqs),
      values,
    }, say);
    say(`Mean coherence ${mean.toFixed(3)} over ${result.segments} segment(s).`);
  },
});

// ── Vector Tools: the geoprocessing already in the GIS layer ─────────────────

/** The project's first GeoJSON, parsed. */
async function firstCollection() {
  for (const dir of ["data/raw", "data/processed", "data/external", "exports"]) {
    let entries = [];
    try { entries = await store.listProjectDir(dir); } catch (error) { continue; }
    const hit = entries.find((e) => /\.(geojson|json)$/i.test(e.name));
    if (!hit) continue;
    try {
      const parsed = JSON.parse(await store.readProjectFile(`${dir}/${hit.name}`));
      if (parsed && (parsed.type === "FeatureCollection" || parsed.features)) {
        return { path: `${dir}/${hit.name}`, collection: parsed };
      }
    } catch (error) { /* not GeoJSON after all */ }
  }
  throw new Error("No GeoJSON in this project yet — import one first.");
}

async function writeCollection(name, collection, say) {
  const path = `data/processed/${name}-${nowStamp()}.geojson`;
  await store.writeProjectFile(path, JSON.stringify(collection));
  await store.registerData({
    name: path.split("/").pop(), kind: "vector", path, source: "Vector Tools",
  });
  say(`${(collection.features || []).length} feature(s) written to ${path}.`);
}

const geo = () => import(`../geoprocessing.js?v=20260903-9b68b94`);

wire("Vector Tools", {
  Buffer: async ({ say }) => {
    const { path, collection } = await firstCollection();
    const g = await geo();
    await writeCollection("buffer", g.buffer(collection, 1000), say);
  },
  Simplify: async ({ say }) => {
    const { collection } = await firstCollection();
    const g = await geo();
    await writeCollection("simplify", g.simplifyCollection(collection, 0.001), say);
  },
  "Dissolve by Field": async ({ say }) => {
    const { collection } = await firstCollection();
    const g = await geo();
    await writeCollection("dissolve", g.dissolve(collection), say);
  },
  Reproject: async ({ say }) => {
    const { collection } = await firstCollection();
    const g = await geo();
    await writeCollection("reprojected", g.reproject(collection, "EPSG:4326"), say);
  },
  "Calculate Field": async ({ say }) => {
    const { collection } = await firstCollection();
    const g = await geo();
    await writeCollection("calculated",
      g.fieldCalculator(collection, "area_m2", "featureAreaM"), say);
  },
});

// ── Text: the formatting buttons on Storyboard and Notes ────────────────────

/**
 * The insert each formatting button makes.
 *
 * Keyed by the label the app actually puts on the button. Half of these were
 * written from a guess -- "Time Stamp", "Code", "Bullets" -- while Research
 * Notes' toolbar says "Timestamp", "</>" and "•"; the mismatch only surfaced
 * once the extractor started following the loop that builds that toolbar, and
 * until then those four buttons rendered disabled beside four identical ones
 * that worked.
 */
const MARKDOWN = {
  H1: "# ", H2: "## ", H3: "### ",
  B: "**bold**", I: "_italic_", U: "<u>underline</u>",
  Bullets: "- ", "•": "- ", Numbers: "1. ", Quote: "> ",
  Code: "```\n\n```", "</>": "`code`",
  Divider: "\n---\n", "Insert [cite]": "[cite]",
};

/**
 * Insert into whichever editor the page has.
 *
 * The app's formatting buttons act on the focused editor; here the page's own
 * textarea is the editor, so the insert goes at its caret.
 */
wirePattern(/^(H1|H2|H3|B|I|U|Bullets|•|Numbers|Quote|Code|<\/>|Divider|Time ?[Ss]tamp|Insert \[cite\])$/,
  async ({ say }, label) => {
    const host = document.getElementById("research-page");
    const box = host.querySelector("textarea:focus")
      || host.querySelector("textarea.research-editor")
      || host.querySelector("textarea");
    if (!box) throw new Error("No editor on this page to insert into.");
    const text = /^Time ?[Ss]tamp$/.test(label)
      ? new Date().toISOString().slice(0, 16).replace("T", " ")
      : MARKDOWN[label] || "";
    const at = box.selectionStart ?? box.value.length;
    box.value = `${box.value.slice(0, at)}${text}${box.value.slice(at)}`;
    box.focus();
    box.selectionStart = box.selectionEnd = at + text.length;
    // Name what landed in the editor, not the button that put it there —
    // echoing the label gave "Inserted Insert [cite].", which reads like a bug
    // in a feature that is working correctly.
    // JSON.stringify already escapes the newlines in a fenced code block;
    // escaping them first as well printed "```\\n\\n```".
    say(`Inserted ${JSON.stringify(text)} at the caret.`);
  });
