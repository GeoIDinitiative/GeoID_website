import { wire, wirePattern } from "./spec-page.js?v=20260808-2648929";
import * as store from "./project-store.js?v=20260808-2648929";
import * as stats from "./stats.js?v=20260808-2648929";
import * as dsp from "./dsp.js?v=20260808-2648929";
import { linePlot, heatmap } from "./plot.js?v=20260808-2648929";
import { column } from "./table.js?v=20260808-2648929";
import { findTables, loadTable, saveTable, saveFigure } from "./pages/common.js?v=20260808-2648929";

/**
 * The last of the spec's controls.
 *
 * Most of what was left had been written off too quickly. `plot.heatmap`,
 * `geoprocessing.spatialJoin`, `projection.transform` and `msh-adapter` were
 * already in the tree, so Heatmap, Run Join, Reproject and Convert were a call
 * away rather than impossible. Re-reading the list beat trusting the earlier
 * judgement about it.
 *
 * What is genuinely left over needs a Python interpreter or an external
 * process, and stays disabled. Those are in `CANNOT_WIRE`.
 */

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function firstTable() {
  const tables = await findTables();
  if (!tables.length) throw new Error("No tables in this project yet.");
  return { path: tables[0], table: await loadTable(tables[0]) };
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

/** Latitude/longitude columns, explicit names winning over y/x. */
function coordinateColumns(table) {
  const cols = table.columns.map((c) => String(c).toLowerCase());
  const pick = (primary, fallback) => {
    const at = cols.findIndex((c) => primary.test(c));
    return at >= 0 ? at : cols.findIndex((c) => fallback.test(c));
  };
  return { latAt: pick(/^(lat|latitude)$/, /^y$/), lonAt: pick(/^(lon|long|longitude)$/, /^x$/) };
}

// ── Raster Tools ─────────────────────────────────────────────────────────────

wire("Raster Tools", {
  Heatmap: async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (!names.length) throw new Error(`${path} has no numeric columns.`);
    // A table becomes a grid by laying its numeric columns out as rows: every
    // column is a band, every row a sample. That is what "heatmap" means for
    // tabular data, and it is the shape plot.heatmap wants.
    const rows = Math.min(120, numeric[names[0]].length);
    const grid = Array.from({ length: names.length }, (_, b) =>
      Array.from({ length: rows }, (_, i) => numeric[names[b]][i] ?? 0));
    const canvas = heatmap(grid, {
      title: `${path} — ${names.length} band(s)`,
      labels: { x: "sample", y: "band" },
    });
    say(`Saved ${await saveFigure(canvas, `heatmap-${stamp()}.png`, "Raster Tools")}.`);
  },
  "Run Band Math": async ({ values, say }) => {
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (names.length < 2) throw new Error("Band math needs at least two bands.");
    const expr = Object.values(values()).find((v) => typeof v === "string" && /[a-z]/i.test(v))
      || "(b2 - b1) / (b2 + b1)";
    // Bands bound as b1..bn, which is the convention every raster calculator
    // uses; the default expression is a normalised difference.
    const args = names.map((_, i) => `b${i + 1}`);
    const fn = new Function(...args, "Math", `return (${expr});`);
    const n = Math.min(...names.map((k) => numeric[k].length));
    const result = Array.from({ length: n }, (_, i) =>
      fn(...names.map((k) => numeric[k][i]), Math));
    const out = `data/processed/bandmath-${stamp()}.csv`;
    await saveTable(out, [...names, "result"],
      Array.from({ length: n }, (_, i) => [...names.map((k) => numeric[k][i]), result[i]]),
      `Band math: ${expr}`, "table");
    say(`${expr} over ${names.length} band(s); written to ${out}.`);
  },
  "Clip to BBox": async ({ say }) => {
    const { path, table } = await firstTable();
    const area = store.getActive().meta.study_area || {};
    const b = ["min_lat", "max_lat", "min_lon", "max_lon"].map((k) => Number(area[k]));
    if (!b.every(Number.isFinite)) throw new Error("Set the project's study area first.");
    const { latAt, lonAt } = coordinateColumns(table);
    if (latAt < 0 || lonAt < 0) throw new Error("No coordinate columns to clip on.");
    const kept = table.rows.filter((r) => {
      const lat = Number(r[latAt]); const lon = Number(r[lonAt]);
      return lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3];
    });
    const out = `data/processed/clipped-raster-${stamp()}.csv`;
    await saveTable(out, table.columns, kept, `Clipped ${path}`, "table");
    say(`${kept.length} of ${table.rows.length} cells inside the study area.`);
  },
  "Reproject Only": async ({ say }) => {
    const { path, table } = await firstTable();
    const { latAt, lonAt } = coordinateColumns(table);
    if (latAt < 0 || lonAt < 0) throw new Error("No coordinate columns to reproject.");
    const projection = await import("../projection.js?v=20260808-2648929");
    const rows = table.rows.map((r) => {
      const lat = Number(r[latAt]); const lon = Number(r[lonAt]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [...r, "", "", ""];
      const utm = projection.latLonToUtm(lat, lon);
      return [...r, utm.x.toFixed(2), utm.y.toFixed(2), utm.zone];
    });
    const out = `data/processed/reprojected-${stamp()}.csv`;
    await saveTable(out, [...table.columns, "easting", "northing", "utm_zone"], rows,
      `Reprojected ${path}`, "table");
    say(`Written to ${out}.`);
  },
});

wire("Preprocessing Transforms", {
  "Resample Raster": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (!names.length) throw new Error(`${path} has no numeric columns.`);
    // Halve the sampling by averaging adjacent pairs -- the 1-D case of the
    // block-mean every raster resampler does, and the one that fits a table.
    const factor = 2;
    const out = {};
    names.forEach((n) => {
      const v = numeric[n];
      const kept = [];
      for (let i = 0; i + factor <= v.length; i += factor) {
        kept.push(stats.mean(v.slice(i, i + factor)));
      }
      out[n] = kept;
    });
    const rows = out[names[0]].map((_, i) => names.map((n) => out[n][i]));
    const target = `data/processed/resampled-${stamp()}.csv`;
    await saveTable(target, names, rows, `Resampled ${path} by ${factor}`, "table");
    say(`${table.rows.length} rows to ${rows.length} by block mean; written to ${target}.`);
  },
});

// ── Vector Tools ─────────────────────────────────────────────────────────────

wire("Vector Tools", {
  "Run Join": async ({ say }) => {
    const collections = [];
    for (const dir of ["data/raw", "data/processed", "data/external"]) {
      let entries = [];
      try { entries = await store.listProjectDir(dir); } catch (error) { continue; }
      for (const e of entries.filter((x) => /\.(geojson|json)$/i.test(x.name))) {
        try {
          const parsed = JSON.parse(await store.readProjectFile(`${dir}/${e.name}`));
          if (parsed?.features) collections.push({ path: `${dir}/${e.name}`, fc: parsed });
        } catch (error) { /* not GeoJSON */ }
      }
    }
    if (collections.length < 2) {
      throw new Error("A spatial join needs two GeoJSON layers in the project.");
    }
    const g = await import("../geoprocessing.js?v=20260808-2648929");
    const joined = g.spatialJoin(collections[0].fc, collections[1].fc);
    const out = `data/processed/joined-${stamp()}.geojson`;
    await store.writeProjectFile(out, JSON.stringify(joined));
    await store.registerData({ name: out.split("/").pop(), kind: "vector", path: out,
      source: "Vector Tools join" });
    say(`${collections[0].path} joined to ${collections[1].path}; written to ${out}.`);
  },
});

// ── Meshes: what can be converted without gmsh ──────────────────────────────

wirePattern(/^(Convert|Convert Mesh)$/, async ({ say }) => {
  const meshes = (await store.listProjectDir("meshes").catch(() => []))
    .filter((e) => /\.msh$/i.test(e.name));
  if (!meshes.length) throw new Error("No .msh file in meshes/ to convert.");
  const name = meshes[0].name;
  const text = await store.readProjectFile(`meshes/${name}`);
  // Read $Nodes out of the gmsh ASCII format and write an OBJ point set. Full
  // element conversion is gmsh's job; the vertices are not, and they are what
  // the Studio and the point-cloud pages can use.
  const lines = String(text).split("\n");
  const at = lines.findIndex((l) => l.trim() === "$Nodes");
  if (at < 0) throw new Error(`${name} has no $Nodes block — is it ASCII gmsh?`);
  const points = [];
  for (let i = at + 2; i < lines.length && lines[i].trim() !== "$EndNodes"; i += 1) {
    const parts = lines[i].trim().split(/\s+/).map(Number);
    if (parts.length >= 4 && parts.slice(1, 4).every(Number.isFinite)) {
      points.push(parts.slice(1, 4));
    } else if (parts.length === 3 && parts.every(Number.isFinite)) {
      points.push(parts);
    }
  }
  if (!points.length) throw new Error(`No node coordinates found in ${name}.`);
  const obj = ["# converted from " + name,
    ...points.map((p) => `v ${p[0]} ${p[1]} ${p[2]}`)].join("\n");
  const out = `meshes/${name.replace(/\.msh$/i, "")}-nodes.obj`;
  await store.writeProjectFile(out, `${obj}\n`);
  await store.registerData({ name: out.split("/").pop(), kind: "mesh", path: out,
    source: "Mesh convert" });
  say(`${points.length} node(s) written to ${out}. Elements need gmsh; vertices did not.`);
}, { pages: ["Mesh", "Simulation"] });

// ── Runs: queue what the desktop executes ───────────────────────────────────

wirePattern(/^(Build|Run Full Pipeline)$/, async ({ say }) => {
  const runs = (await store.listProjectDir("fem_runs").catch(() => []))
    .filter((e) => e.kind === "directory");
  if (!runs.length) throw new Error("No runs yet — Build New creates one.");
  for (const run of runs) {
    await store.writeJson(`fem_runs/${run.name}/status.json`, {
      state: "queued", queued_at: new Date().toISOString(),
      stage: "full pipeline",
      note: "Queued from the browser; the desktop runner executes it.",
    });
  }
  say(`${runs.length} run(s) queued for the desktop runner.`);
}, { pages: ["Simulation"] });

// ── Small ones that were only ever a few lines ──────────────────────────────

wire("Equation Workbench", {
  "Remove Symbol": async ({ say }) => {
    const doc = await store.readJson("metadata/symbols.json", { symbols: [] });
    doc.symbols = Array.isArray(doc.symbols) ? doc.symbols : [];
    doc.symbols.pop();
    await store.writeJson("metadata/symbols.json", doc);
    say(`${doc.symbols.length} symbol(s) left.`);
  },
});

wire("Temporal Tools", {
  "Save Result": async ({ say }) => {
    const files = (await store.listProjectDir("data/processed").catch(() => []))
      .filter((e) => e.kind === "file");
    if (!files.length) throw new Error("Run a transform first — there is nothing to save.");
    const latest = files[files.length - 1];
    await store.registerData({ name: latest.name, kind: "series",
      path: `data/processed/${latest.name}`, source: "Temporal Tools" });
    say(`${latest.name} registered against the project.`);
  },
});

wire("Multi-Station Viewer", {
  Redraw: async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric).slice(0, 6);
    if (!names.length) throw new Error(`${path} has no numeric columns.`);
    const series = names.map((n) => ({
      x: numeric[n].map((_, i) => i), y: numeric[n], label: n,
    }));
    const canvas = linePlot(series, { title: path, labels: { x: "sample", y: "value" } });
    say(`Saved ${await saveFigure(canvas, `stations-${stamp()}.png`, "Multi-Station Viewer")}.`);
  },
});

wire("Event Annotation", {
  "Load & Plot": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const name = Object.keys(numeric)[0];
    if (!name) throw new Error(`${path} has no numeric columns.`);
    const canvas = linePlot([{ x: numeric[name].map((_, i) => i), y: numeric[name], label: name }],
      { title: `${path} — mark events on this`, labels: { x: "sample", y: name } });
    say(`Saved ${await saveFigure(canvas, `annotate-${slug(name)}.png`, "Event Annotation")}.`);
  },
  "Export Annotations": async ({ say }) => {
    const doc = await store.readJson("metadata/annotations.json", { events: [] });
    const rows = (doc.events || []).map((e) => [e.value ?? e.time ?? "", e.label ?? "", e.note ?? ""]);
    const out = `exports/annotations-${stamp()}.csv`;
    await saveTable(out, ["time", "label", "note"], rows, "Event Annotation", "table");
    say(`${rows.length} annotation(s) written to ${out}.`);
  },
});

wire("Point Cloud 3D", {
  Export: async ({ say }) => {
    const { path, table } = await firstTable();
    const cols = table.columns.map((c) => String(c).toLowerCase());
    const [xi, yi, zi] = ["x", "y", "z"].map((c) => cols.indexOf(c));
    if (xi < 0 || yi < 0 || zi < 0) throw new Error(`${path} needs x, y and z columns.`);
    const xyz = table.rows.map((r) => `${r[xi]} ${r[yi]} ${r[zi]}`).join("\n");
    const out = `exports/points-${stamp()}.xyz`;
    await store.writeProjectFile(out, `${xyz}\n`);
    say(`${table.rows.length} point(s) written to ${out}. LAS needs laspy; XYZ and CSV do not.`);
  },
});

wire("Figure Composer", {
  "Compose & Preview": async ({ say }) => {
    const figs = (await store.listProjectDir("figures").catch(() => []))
      .filter((e) => /\.(png|jpe?g)$/i.test(e.name));
    if (!figs.length) throw new Error("No figures yet — analysis pages save them.");
    // Lay the project's figures out on one canvas, which is what composing is.
    const chosen = figs.slice(0, 4);
    const images = await Promise.all(chosen.map(async (entry) => {
      const blob = await store.readProjectFile(`figures/${entry.name}`);
      const url = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob]));
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve; img.onerror = reject; img.src = url;
      });
      return img;
    }));
    const cols = images.length > 1 ? 2 : 1;
    const rows = Math.ceil(images.length / cols);
    const cell = { w: 640, h: 320 };
    const canvas = document.createElement("canvas");
    canvas.width = cols * cell.w;
    canvas.height = rows * cell.h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0d0221";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((img, i) => {
      ctx.drawImage(img, (i % cols) * cell.w, Math.floor(i / cols) * cell.h, cell.w, cell.h);
      URL.revokeObjectURL(img.src);
    });
    say(`Saved ${await saveFigure(canvas, `composed-${stamp()}.png`, "Figure Composer")} `
      + `from ${images.length} figure(s).`);
  },
});

wire("Data Hub", {
  "Plot Metric Comparison": async ({ say }) => {
    let runs = [];
    try {
      const raw = await store.readProjectFile("metadata/experiments.jsonl");
      runs = String(raw).split("\n").filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter(Boolean);
    } catch (error) { /* none */ }
    if (!runs.length) throw new Error("No runs in metadata/experiments.jsonl yet.");
    const keys = [...new Set(runs.flatMap((r) => Object.keys(r.metrics || {})))];
    if (!keys.length) throw new Error("No metrics recorded on those runs.");
    const series = keys.map((k) => ({
      x: runs.map((_, i) => i),
      y: runs.map((r) => Number((r.metrics || {})[k]) || 0),
      label: k,
    }));
    const canvas = linePlot(series,
      { title: "Metrics by run", labels: { x: "run", y: "value" } });
    say(`Saved ${await saveFigure(canvas, `metrics-${stamp()}.png`, "Data Hub")} `
      + `over ${runs.length} run(s).`);
  },
});

wire("Post Processing", {
  "Find Station Elements": async ({ say }) => {
    const { path, table } = await firstTable();
    const cols = table.columns.map((c) => String(c).toLowerCase());
    const entityAt = cols.findIndex((c) => /^(entity|element|elem)$/.test(c));
    if (entityAt < 0) throw new Error(`${path} has no entity/element column.`);
    const counts = new Map();
    table.rows.forEach((r) => {
      const id = r[entityAt];
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    const found = [...counts.entries()].map(([element, nodes]) => ({ element, nodes }));
    await store.writeJson(`post_processing/station-elements-${stamp()}.json`,
      { source: path, elements: found });
    say(`${found.length} distinct element(s) across ${table.rows.length} rows.`);
  },
});

wire("DOF Wizard", {
  "Rebuild solver index": async ({ say }) => {
    // The index is over the project's own run specs, which is the part of the
    // desktop index a browser can see.
    const runs = (await store.listProjectDir("fem_runs").catch(() => []))
      .filter((e) => e.kind === "directory");
    const index = [];
    for (const run of runs) {
      const spec = await store.readJson(`fem_runs/${run.name}/spec.json`, null);
      if (spec) index.push({ run: run.name, solver: spec.solver, dofs: spec.dofs, mesh: spec.mesh });
    }
    await store.writeJson("fem_runs/solver_index.json",
      { rebuilt_at: new Date().toISOString(), runs: index });
    say(`${index.length} run(s) indexed into fem_runs/solver_index.json.`);
  },
});

wire("Storyboard", {
  Share: async ({ say }) => {
    // No service to publish to, so "share" is a single self-contained file --
    // which is the shareable artefact, just moved by hand.
    const active = store.getActive();
    const manifest = await store.readJson("exports/storyboard/manifest.json", { panels: [] });
    const parts = ["<!doctype html><meta charset=utf-8>", `<title>${active.name}</title>`,
      "<style>body{font:15px/1.7 system-ui;margin:3rem auto;max-width:46rem}"
      + "img{max-width:100%}</style>", `<h1>${active.name}</h1>`];
    for (const panel of manifest.panels || []) {
      try {
        const blob = await store.readProjectFile(panel.path);
        if (blob instanceof Blob) {
          const data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          parts.push(`<figure><img src="${data}"><figcaption>${panel.caption || panel.path}</figcaption></figure>`);
        }
      } catch (error) { /* skip a missing panel */ }
    }
    const out = `exports/share-${stamp()}.html`;
    await store.writeProjectFile(out, parts.join("\n"));
    say(`Self-contained page written to ${out} — images embedded, send the file.`);
  },
});

// ── Modules, which are JavaScript here and so can actually run ──────────────

wire("Module Builder", {
  "Run Test": async ({ say }) => {
    const files = (await store.listProjectDir("analysis/modules").catch(() => []))
      .filter((e) => /\.js$/i.test(e.name));
    if (!files.length) throw new Error("No modules to test.");
    const source = await store.readProjectFile(`analysis/modules/${files[0].name}`);
    const { table } = await firstTable();
    // The module is JavaScript here, so it can genuinely be loaded and run
    // against a project table -- unlike the desktop app's Python plugins.
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
      const mod = await import(/* @vite-ignore */ url);
      if (typeof mod.run !== "function") throw new Error("The module exports no run().");
      const result = mod.run({ columns: table.columns, rows: table.rows });
      say(`${files[0].name}: run() returned ${Array.isArray(result?.rows)
        ? `${result.rows.length} row(s)` : typeof result}.`);
    } finally { URL.revokeObjectURL(url); }
  },
  "Install & Reload": async ({ say }) => {
    const files = (await store.listProjectDir("analysis/modules").catch(() => []))
      .filter((e) => /\.js$/i.test(e.name));
    if (!files.length) throw new Error("No modules to install.");
    const doc = await store.readJson("metadata/modules.json", { installed: [] });
    doc.installed = Array.isArray(doc.installed) ? doc.installed : [];
    files.forEach((f) => {
      if (!doc.installed.includes(f.name)) doc.installed.push(f.name);
    });
    await store.writeJson("metadata/modules.json", doc);
    say(`${doc.installed.length} module(s) installed for this project.`);
  },
  Uninstall: async ({ say }) => {
    const doc = await store.readJson("metadata/modules.json", { installed: [] });
    doc.installed = Array.isArray(doc.installed) ? doc.installed : [];
    const gone = doc.installed.pop();
    await store.writeJson("metadata/modules.json", doc);
    say(gone ? `${gone} uninstalled.` : "Nothing installed.");
  },
});

// ── Watchers: polling, which is the browser's version of watching ──────────

const watchers = new Map();

wirePattern(/^Start(\s+Watch)?$/, async ({ say, pageId }) => {
  if (watchers.has(pageId)) {
    clearInterval(watchers.get(pageId));
    watchers.delete(pageId);
    say("Stopped watching.");
    return;
  }
  // A browser cannot be told when a folder changes, but it can look. Ten
  // seconds is often enough for a run that takes minutes, and the interval is
  // cleared when the page is left.
  let lastCount = (await store.listData()).length;
  const id = setInterval(async () => {
    try {
      const now = (await store.listData()).length;
      if (now !== lastCount) {
        say(`${now - lastCount > 0 ? "+" : ""}${now - lastCount} dataset(s) — ${now} total.`);
        lastCount = now;
      }
    } catch (error) { /* project closed under us */ }
  }, 10000);
  watchers.set(pageId, id);
  say("Watching the project every 10 s. Press again to stop.");
}, { pages: ["Live Monitor", "Data Repository"] });

// ── Signal Processing: the suites ───────────────────────────────────────────

wire("Signal Processing", {
  "Compare Model vs Other Model": async ({ say }) => {
    const { table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (names.length < 3) throw new Error("Comparing two models against a reference needs three columns.");
    const [ref, a, b] = names;
    const n = Math.min(numeric[ref].length, numeric[a].length, numeric[b].length);
    const score = (candidate) => {
      const residual = numeric[candidate].slice(0, n).map((x, i) => x - numeric[ref][i]);
      return {
        model: candidate,
        rmse: Math.sqrt(stats.mean(residual.map((r) => r * r))),
        r: stats.pearson(numeric[candidate].slice(0, n), numeric[ref].slice(0, n)),
      };
    };
    const result = { reference: ref, models: [score(a), score(b)] };
    await store.writeJson(`analysis/model-comparison-${stamp()}.json`, result);
    const best = result.models.slice().sort((x, y) => x.rmse - y.rmse)[0];
    say(`${best.model} fits ${ref} best (RMSE ${best.rmse.toPrecision(4)}).`);
  },
  "Run Wavelet Suite": async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const name = Object.keys(numeric)[0];
    const v = numeric[name];
    // Morlet continuous wavelet transform, written out because it is a short
    // convolution and the alternative was a disabled button.
    const scales = Array.from({ length: 24 }, (_, i) => 2 * (1.25 ** i));
    const power = scales.map((scale) => {
      const width = Math.min(v.length, Math.ceil(scale * 6));
      let sumRe = 0; let sumIm = 0; let total = 0;
      for (let i = 0; i < v.length; i += 1) {
        const t = (i - v.length / 2) / scale;
        if (Math.abs(t) > 3) continue;
        const envelope = Math.exp(-0.5 * t * t);
        sumRe += v[i] * envelope * Math.cos(5 * t);
        sumIm += v[i] * envelope * Math.sin(5 * t);
        total += envelope;
      }
      const norm = total || 1;
      return ((sumRe / norm) ** 2 + (sumIm / norm) ** 2) / Math.sqrt(scale);
    });
    await store.writeJson(`analysis/wavelet-${slug(name)}-${stamp()}.json`,
      { source: path, column: name, scales, power });
    const canvas = linePlot([{ x: scales, y: power, label: name }],
      { title: `Wavelet power — ${name}`, labels: { x: "scale", y: "power" } });
    say(`Saved ${await saveFigure(canvas, `wavelet-${slug(name)}.png`, "Signal Processing")}.`);
  },
  "Run Thesis Suite": async ({ say }) => {
    // Every analysis this page can do, in one pass, written as one report --
    // which is what the desktop suite produces too.
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (!names.length) throw new Error(`${path} has no numeric columns.`);
    const report = {
      source: path, generated_at: new Date().toISOString(),
      descriptive: names.map((n) => ({ column: n, ...dsp.statistics(numeric[n]) })),
      correlation: stats.correlationMatrix(numeric),
      spectra: names.map((n) => {
        const spectrum = dsp.amplitudeSpectrum(numeric[n], 1);
        const peak = dsp.dominantPeak(spectrum);
        return { column: n, peak_frequency: peak.frequency, peak_amplitude: peak.amplitude };
      }),
    };
    const out = `analysis/thesis-suite-${stamp()}.json`;
    await store.writeJson(out, report);
    say(`${names.length} column(s) profiled, correlated and spectrally analysed into ${out}.`);
  },
});

wire("AI Trainer", {
  "Run Training Script": async ({ say }) => {
    // The desktop script trains through scikit-learn. What runs here is an
    // honest baseline -- ordinary least squares -- and the spec is still
    // written for the real trainer. Said plainly rather than implied.
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (names.length < 2) throw new Error("Training needs a feature and a target.");
    const target = names[names.length - 1];
    const feature = names[0];
    const n = Math.min(numeric[feature].length, numeric[target].length);
    const x = numeric[feature].slice(0, n);
    const y = numeric[target].slice(0, n);
    const mx = stats.mean(x); const my = stats.mean(y);
    let sxy = 0; let sxx = 0;
    for (let i = 0; i < n; i += 1) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const slope = sxx ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    const predicted = x.map((v) => slope * v + intercept);
    const ssRes = y.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
    const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
    const result = {
      source: path, model: "ordinary least squares (browser baseline)",
      feature, target, slope, intercept,
      r2: ssTot ? 1 - ssRes / ssTot : 0,
      rmse: Math.sqrt(ssRes / n),
      note: "A baseline fitted here. training_spec.json remains the handover to "
        + "the desktop trainer, which has scikit-learn.",
    };
    await store.writeJson(`analysis/baseline-${stamp()}.json`, result);
    say(`Baseline ${feature} → ${target}: R² ${result.r2.toFixed(4)}, `
      + `RMSE ${result.rmse.toPrecision(4)}.`);
  },
});
