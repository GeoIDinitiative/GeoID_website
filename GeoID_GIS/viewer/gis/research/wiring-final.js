import { wire, wirePattern } from "./spec-page.js?v=20260810-596d640";
import * as store from "./project-store.js?v=20260810-596d640";
import * as stats from "./stats.js?v=20260810-596d640";
import * as dsp from "./dsp.js?v=20260810-596d640";
import { linePlot, heatmap } from "./plot.js?v=20260810-596d640";
import { column } from "./table.js?v=20260810-596d640";
import { findTables, loadTable, saveTable, saveFigure } from "./pages/common.js?v=20260810-596d640";
import { parseTable } from "./table.js?v=20260810-596d640";
import * as ec from "./event-correlation.js?v=20260810-596d640";

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
    const area = store.requireActive().meta.study_area || {};
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
    const projection = await import("../projection.js?v=20260810-596d640");
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
    const g = await import("../geoprocessing.js?v=20260810-596d640");
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
    const active = store.requireActive();
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
  "Run Full Suite": async ({ say }) => {
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
    const out = `analysis/event-suite-${stamp()}.json`;
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

/* ── Analysis pages that had been left disabled ───────────────────────────
 *
 * Compute, Detect Events and Fit sat unwired because the Qt page runs them
 * through numpy/scipy/matplotlib. Each is a short algorithm and `dsp.js` and
 * `stats.js` already hold the hard parts, so leaving them disabled was the
 * same mistake as the first pass at Heatmap and Reproject: written off without
 * being read.
 */

/** The table a page's path field points at, or the project's first. */
async function chosenTable(api) {
  const named = Object.entries(api.values())
    .find(([key, value]) => /path|file/i.test(key) && typeof value === "string"
      && value.trim() && /\.(csv|txt|tsv|json)$/i.test(value.trim()));
  if (named) {
    const path = named[1].trim();
    return { path, table: await loadTable(path) };
  }
  return firstTable();
}

/** A named column if the page chose one, else the first numeric column. */
function seriesFrom(table, chosen) {
  if (chosen && table.columns.includes(chosen)) {
    const values = column(table, chosen).filter(Number.isFinite);
    if (values.length > 1) return { name: chosen, values };
  }
  const numeric = numericOf(table);
  const first = Object.keys(numeric)[0];
  if (!first) throw new Error("No numeric column in that table.");
  return { name: first, values: numeric[first] };
}

wire("Spectral Analysis", {
  Compute: async (api) => {
    const { say, values } = api;
    const { path, table } = await chosenTable(api);
    const v = values();
    const signal = seriesFrom(table, v._signal_col);
    // The page's own sample rate wins; otherwise derive it from the time
    // column, which is what the spin box is pre-filled from.
    let fs = Number(v._fs_spin);
    if (!Number.isFinite(fs) || fs <= 0) {
      const times = v._time_col && table.columns.includes(v._time_col)
        ? column(table, v._time_col).filter(Number.isFinite) : [];
      const step = times.length > 2
        ? (times[times.length - 1] - times[0]) / (times.length - 1) : 0;
      fs = step > 0 ? 1 / step : 1;
    }
    const windowName = String(v._window_combo || "hann");
    const spectrum = dsp.amplitudeSpectrum(signal.values, fs, { window: windowName });
    // `dominantPeak` takes the spectrum object, and the field is `amps`.
    const peak = dsp.dominantPeak(spectrum);
    const welch = dsp.welch(signal.values, fs, { window: windowName });

    const canvas = linePlot([
      { name: `${signal.name} amplitude`, x: Array.from(spectrum.freqs),
        y: Array.from(spectrum.amps) },
    ], { width: 880, height: 340, title: `Spectrum — ${path.split("/").pop()}`,
         labels: { x: "Frequency (Hz)", y: "Amplitude" } });
    const figure = await saveFigure(canvas, `spectrum_${slug(signal.name)}_${stamp()}.png`,
                                    "Spectral Analysis");
    await saveTable(`analysis/spectrum-${slug(signal.name)}-${stamp()}.csv`,
      ["frequency_hz", "amplitude", "psd"],
      Array.from(spectrum.freqs).map((f, i) => [f, spectrum.amps[i],
        welch.psd[Math.min(i, welch.psd.length - 1)]]),
      "Spectral Analysis", "spectrum");
    say(`${signal.name} at ${fs.toPrecision(4)} Hz (${windowName}): peak `
      + `${peak.frequency.toPrecision(4)} Hz. Saved ${figure}.`);
  },
});

wire("Event Detection", {
  "Detect Events": async (api) => {
    const { say, values } = api;
    const { path, table } = await chosenTable(api);
    const v = values();
    const signal = seriesFrom(table, v._sig_col);
    const fs = Number(v._fs) > 0 ? Number(v._fs) : 1;

    // The four modes of the Threshold tab (app_qt.py:24205). Each turns the
    // page's number into an absolute level; detection itself is then the same.
    const detrended = dsp.detrend(signal.values, "constant");
    const n = Number(v._thresh_val) || 3;
    const mode = String(v._thresh_mode || "N × RMS");
    const rms = Math.sqrt(detrended.reduce((a, x) => a + x * x, 0) / detrended.length);
    const sd = stats.stdev(Array.from(detrended));
    const sorted = Array.from(detrended, Math.abs).sort((a, b) => a - b);
    const mad = sorted[Math.floor(sorted.length / 2)] || 0;
    const level = mode.startsWith("Absolute") ? n
      : mode.includes("RMS") ? n * rms
      : mode.includes("Std") ? n * sd
      : n * mad * 1.4826;   // MAD scaled to a standard deviation

    const minDur = Math.max(0, Number(v._thresh_min_dur) || 0) * fs;
    const minGap = Math.max(0, Number(v._thresh_gap) || 0) * fs;
    const events = [];
    let start = -1;
    for (let i = 0; i < detrended.length; i += 1) {
      const over = Math.abs(detrended[i]) >= level;
      if (over && start < 0) start = i;
      if (!over && start >= 0) { events.push([start, i - 1]); start = -1; }
    }
    if (start >= 0) events.push([start, detrended.length - 1]);

    // Merge events closer than the minimum gap, then drop the too-short ones --
    // in that order, because merging can only make an event longer.
    const merged = [];
    events.forEach((event) => {
      const last = merged[merged.length - 1];
      if (last && event[0] - last[1] <= minGap) last[1] = event[1];
      else merged.push(event.slice());
    });
    const kept = merged.filter(([a, b]) => (b - a + 1) >= minDur);

    const rows = kept.map(([a, b], i) => {
      const slice = Array.from(detrended.slice(a, b + 1), Math.abs);
      return [i + 1, a / fs, b / fs, (b - a + 1) / fs, Math.max(...slice)];
    });
    const out = `analysis/events-${slug(signal.name)}-${stamp()}.csv`;
    await saveTable(out, ["event", "start_s", "end_s", "duration_s", "peak_abs"],
                    rows, "Event Detection", "events");
    say(`${kept.length} event(s) in ${signal.name} at ${level.toPrecision(4)} `
      + `(${mode}) from ${path.split("/").pop()}. Saved ${out}.`);
  },
});

/**
 * Least squares by normal equations on a Vandermonde-style basis.
 *
 * Every model the page offers is linear in its parameters once the right
 * transform is applied, so one solver covers all of them: fit `y' = Σ pᵢ·bᵢ(x)`
 * and invert the transform for the report.
 */
function leastSquares(xs, ys, basis) {
  const k = basis.length;
  const A = Array.from({ length: k }, () => new Float64Array(k));
  const b = new Float64Array(k);
  for (let n = 0; n < xs.length; n += 1) {
    const row = basis.map((fn) => fn(xs[n]));
    for (let i = 0; i < k; i += 1) {
      b[i] += row[i] * ys[n];
      for (let j = 0; j < k; j += 1) A[i][j] += row[i] * row[j];
    }
  }
  // Gauss-Jordan with partial pivoting; k is at most a handful here.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < k; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < k; r += 1) if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) pivot = r;
    if (Math.abs(M[pivot][i]) < 1e-12) throw new Error("Model is singular for this data.");
    [M[i], M[pivot]] = [M[pivot], M[i]];
    const d = M[i][i];
    for (let c = i; c <= k; c += 1) M[i][c] /= d;
    for (let r = 0; r < k; r += 1) {
      if (r === i) continue;
      const f = M[r][i];
      for (let c = i; c <= k; c += 1) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((row) => row[k]);
}

wire("Model Fitting", {
  Fit: async (api) => {
    const { say, values } = api;
    const { path, table } = await chosenTable(api);
    const v = values();
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    const xName = table.columns.includes(v._x_col) ? v._x_col : names[0];
    const yName = table.columns.includes(v._y_col) ? v._y_col : (names[1] || names[0]);
    if (!xName || !yName) throw new Error("Need two numeric columns to fit.");

    const rawX = column(table, xName);
    const rawY = column(table, yName);
    const xs = [];
    const ys = [];
    for (let i = 0; i < Math.min(rawX.length, rawY.length); i += 1) {
      if (Number.isFinite(rawX[i]) && Number.isFinite(rawY[i])) { xs.push(rawX[i]); ys.push(rawY[i]); }
    }
    if (xs.length < 3) throw new Error("Not enough finite rows to fit.");

    const model = String(v._model_combo || "Linear (y=ax+b)");
    const degree = Math.max(1, Math.min(8, Number(v._poly_deg) || 2));
    let basis;
    let toY = (t) => t;
    let fromY = (t) => t;
    let form;

    if (model.startsWith("Polynomial")) {
      basis = Array.from({ length: degree + 1 }, (_, p) => (x) => x ** p);
      form = `y = Σ pᵢ·x^i (degree ${degree})`;
    } else if (model.startsWith("Exponential")) {
      // ln y = ln a + b x, so the fit is linear in log space and only defined
      // for positive y -- said plainly rather than returning NaNs.
      if (ys.some((y) => y <= 0)) throw new Error("Exponential fit needs y > 0.");
      basis = [() => 1, (x) => x];
      toY = Math.log; fromY = Math.exp;
      form = "y = a·e^(bx)";
    } else if (model.startsWith("Logarithmic")) {
      if (xs.some((x) => x <= 0)) throw new Error("Logarithmic fit needs x > 0.");
      basis = [() => 1, (x) => Math.log(x)];
      form = "y = a·ln(x) + b";
    } else if (model.startsWith("Power")) {
      if (xs.some((x) => x <= 0) || ys.some((y) => y <= 0)) {
        throw new Error("Power-law fit needs x > 0 and y > 0.");
      }
      basis = [() => 1, (x) => Math.log(x)];
      toY = Math.log; fromY = Math.exp;
      form = "y = a·x^b";
    } else if (model.startsWith("Sinusoidal")) {
      // A·sin(wx+φ)+C is linear in A·cos φ and A·sin φ once w is fixed, so w
      // comes from the spectrum and the rest is least squares.
      const spec = dsp.amplitudeSpectrum(ys, 1);
      const peak = dsp.dominantPeak(spec);
      const w = 2 * Math.PI * (peak.frequency || 1 / Math.max(1, xs.length));
      basis = [() => 1, (x) => Math.sin(w * x), (x) => Math.cos(w * x)];
      form = `y = A·sin(${w.toPrecision(4)}·x + φ) + C`;
    } else if (model.startsWith("Custom")) {
      throw new Error("A custom equation needs an evaluator; use the Notebook page.");
    } else {
      basis = [() => 1, (x) => x];
      form = "y = a·x + b";
    }

    const params = leastSquares(xs, ys.map(toY), basis);
    const predict = (x) => fromY(basis.reduce((sum, fn, i) => sum + params[i] * fn(x), 0));

    const fitted = xs.map(predict);
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const ssRes = ys.reduce((a, y, i) => a + (y - fitted[i]) ** 2, 0);
    const ssTot = ys.reduce((a, y) => a + (y - meanY) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    const rmse = Math.sqrt(ssRes / ys.length);

    const order = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b]);
    const canvas = linePlot([
      { name: `${yName} observed`, x: order.map((i) => xs[i]),
        y: order.map((i) => ys[i]), mode: "scatter" },
      { name: `${model} fit`, x: order.map((i) => xs[i]), y: order.map((i) => fitted[i]) },
    ], { width: 880, height: 360, title: `${model} — ${path.split("/").pop()}`,
         labels: { x: xName, y: yName } });
    const figure = await saveFigure(canvas, `fit_${slug(yName)}_${stamp()}.png`, "Model Fitting");
    const result = {
      source: path, model, form, x: xName, y: yName,
      parameters: params.map((p, i) => ({ name: `p${i}`, value: p })),
      r2, rmse, points: xs.length, figure,
    };
    await store.writeJson(`analysis/fit-${slug(yName)}-${stamp()}.json`, result);
    say(`${model}: R² ${r2.toFixed(4)}, RMSE ${rmse.toPrecision(4)} over `
      + `${xs.length} points. Saved ${figure}.`);
  },
});

/**
 * Browse, on the pages that analyse one table.
 *
 * The Qt pages open a file dialog and then fill their column combos from the
 * file's header, which is the step that makes Compute, Detect Events and Fit
 * controllable — the tree renders those combos empty, and without this they
 * silently fall back to the project's first table and its first numeric column.
 * That fallback still works, but choosing is the point.
 *
 * The generic Browse pattern imports a file into the project; here the table is
 * already in the project and the job is to select one.
 */
const ANALYSIS_PAGES = ["Spectral Analysis", "Event Detection", "Model Fitting"];

/** Column names, split by which role they can play. */
function classifyColumns(table) {
  const numeric = numericOf(table);
  const names = Object.keys(numeric);
  const timeLike = table.columns.find((c) =>
    /^(t|time|secs?|seconds|timestamp|date|x)$/i.test(String(c)));
  const value = names.find((n) => n !== timeLike) || names[0];
  return { all: table.columns, numeric: names, time: timeLike || names[0], value };
}

/** Offer the project's tables, inline — there is no file dialog to open. */
function chooseTable(paths) {
  return new Promise((resolve) => {
    const host = document.getElementById("research-page");
    const menu = document.createElement("div");
    menu.className = "qt-inline-menu is-floating";
    paths.forEach((path) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "qt-inline-item";
      item.textContent = path;
      item.addEventListener("click", () => { menu.remove(); resolve(path); });
      menu.appendChild(item);
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "qt-inline-item is-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { menu.remove(); resolve(null); });
    menu.appendChild(cancel);
    host.appendChild(menu);
  });
}

/** Fill a combo with the given options, keeping a sensible one selected. */
function fillCombo(node, options, preferred) {
  if (!node || node.tagName !== "SELECT") return;
  node.textContent = "";
  options.forEach((name) => node.appendChild(new Option(name, name)));
  if (preferred && options.includes(preferred)) node.value = preferred;
}

ANALYSIS_PAGES.forEach((pageId) => {
  wire(pageId, {
    Browse: async ({ say, controls }) => {
      const paths = await findTables();
      if (!paths.length) throw new Error("No tables in this project yet.");
      const path = paths.length === 1 ? paths[0] : await chooseTable(paths);
      if (!path) return;
      const table = await loadTable(path);
      const roles = classifyColumns(table);
      if (!roles.numeric.length) throw new Error(`${path} has no numeric column.`);

      const field = controls.get("_file_edit");
      if (field) field.value = path;

      fillCombo(controls.get("_time_col"), roles.all, roles.time);
      fillCombo(controls.get("_x_col"), roles.all, roles.time);
      fillCombo(controls.get("_signal_col"), roles.numeric, roles.value);
      fillCombo(controls.get("_sig_col"), roles.numeric, roles.value);
      fillCombo(controls.get("_y_col"), roles.numeric, roles.value);

      // The sample rate the time column implies, which is what the Qt page
      // pre-fills its spin box with.
      const times = column(table, roles.time).filter(Number.isFinite);
      if (times.length > 2) {
        const step = (times[times.length - 1] - times[0]) / (times.length - 1);
        if (step > 0) {
          const fs = 1 / step;
          ["_fs_spin", "_fs"].forEach((name) => {
            const node = controls.get(name);
            if (node) node.value = String(Number(fs.toPrecision(6)));
          });
        }
      }
      say(`${path}: ${table.rows.length} rows, ${roles.numeric.length} numeric `
        + `column(s). Using ${roles.time} / ${roles.value}.`);
    },
  });
});

/* ── The Event Correlation Toolkit, and the last of the odd ones ──────────
 *
 * `event-correlation.js` holds the algorithms, ported against
 * `scripts/thesis/comprehensive_signal_analysis_complete.py` rather than from
 * memory. This is the wiring: load the peaks once into a table the buttons
 * share, then each button is a call and a write.
 */

/** Every `*_peaks.csv` under a folder in the project. */
async function peakFiles(root) {
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = await store.listProjectDir(dir); } catch (error) { return; }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.kind === "directory") await walk(path, depth + 1);
      else if (/_peaks\.csv$/i.test(entry.name)) found.push(path);
    }
  };
  await walk(root.replace(/\/$/, ""), 0);
  return found;
}

/** The peaks table each toolkit button works from, loaded once per project. */
const peakCache = new Map();

async function loadPeaks(api, { reload = false } = {}) {
  const project = store.getActive()?.folder || "project";
  if (!reload && peakCache.has(project)) return peakCache.get(project);
  const root = (api.values().event_peaks_root || "").trim() || "data/raw";
  let files = await peakFiles(root);
  if (!files.length && root !== "data/raw") files = await peakFiles("data/raw");
  if (!files.length) {
    throw new Error(`No *_peaks.csv under ${root}. Set the Peaks root and try again.`);
  }
  const peaks = [];
  for (const path of files) {
    try { peaks.push(...ec.peaksFromCsv(await store.readProjectFile(path), path)); }
    catch (error) { /* one unreadable file must not stop the load */ }
  }
  if (!peaks.length) throw new Error("Peak files held no readable rows.");
  const loaded = { peaks, files: files.length };
  peakCache.set(project, loaded);
  return loaded;
}

/**
 * Any table this project holds, peaks tree included.
 *
 * `findTables()` lists the known data folders but does not walk into them, and
 * a peaks tree is `data/raw/<dataset>/<station>/<sim>/…` — three levels down,
 * so the toolkit's plotting buttons reported an empty project while its loading
 * buttons were reading the same files happily.
 */
async function anyTable() {
  const flat = await findTables();
  if (flat.length) return flat;
  return peakFiles("data/raw");
}

/**
 * The longest numeric series in the project, for the transforms.
 *
 * Taking the first table found meant taking whichever analysis CSV had just
 * been written — a spectrogram of an 11-row candidate ranking, saved as a
 * figure with zero frames in it. A transform wants the longest *signal*, and
 * results the toolkit itself produced are not signals.
 */
async function longestSeries() {
  const paths = (await anyTable()).filter((p) => !p.startsWith("analysis/"));
  let best = null;
  for (const path of paths.slice(0, 24)) {
    let table;
    try { table = await loadTable(path); } catch (error) { continue; }
    const numeric = numericOf(table);
    for (const [name, values] of Object.entries(numeric)) {
      // A time or index column is a ramp; transforming it says nothing about
      // the record. It is only a candidate if the file holds nothing else.
      const isAxis = /^(t|time|secs?|seconds|timestamp|date|index|n|sample|rank|bin)$/i
        .test(String(name));
      const better = !best
        || (best.isAxis && !isAxis)
        || (best.isAxis === isAxis && values.length > best.values.length);
      if (better) best = { path, name, values, isAxis };
    }
  }
  if (!best) throw new Error("No numeric series in this project yet.");
  return best;
}

/** Write a result and say where it went, which every one of these does. */
async function publish(say, name, headers, rows, note) {
  const path = `analysis/${name}-${stamp()}.csv`;
  await saveTable(path, headers, rows, "Event Correlation Toolkit", "analysis");
  say(`${note} Saved ${path}.`);
  return path;
}

const toolkit = {
  "Load Event Inputs": async (api) => {
    const { peaks, files } = await loadPeaks(api, { reload: true });
    const stations = new Set(peaks.map((p) => p.station)).size;
    const datasets = new Set(peaks.map((p) => p.dataset)).size;
    api.say(`Loaded ${peaks.length.toLocaleString()} peaks from ${files} file(s): `
      + `${datasets} dataset(s), ${stations} station(s).`);
  },

  "Sync Events": async (api) => {
    const { peaks } = await loadPeaks(api);
    const quality = peaks.filter((p) => p.peak_corr >= ec.MIN_CORRELATION
      && p.snr_linear >= ec.MIN_SNR_LINEAR);
    const found = ec.findSynchronousEvents(quality);
    if (!found.count) { api.say("No synchronous events at the current tolerance."); return; }
    await publish(api.say, "sync-events",
      ["event_id", "peak_time", "dataset", "station", "sim", "template", "peak_corr", "snr_linear"],
      found.peaks.map((p) => [p.event_id, p.peak_time_dt, p.dataset, p.station,
                             p.sim, p.template, p.peak_corr, p.snr_linear]),
      `${found.count} synchronous event(s) across ${found.peaks.length} peaks `
      + `(±${ec.SYNC_TOLERANCE_SEC}s, ≥${ec.MIN_STATIONS} stations).`);
  },

  "Best Candidates": async (api) => {
    const { peaks } = await loadPeaks(api);
    const quality = peaks.filter((p) => p.peak_corr >= ec.MIN_CORRELATION
      && p.snr_linear >= ec.MIN_SNR_LINEAR);
    const sync = ec.findSynchronousEvents(quality);
    const count = Number(api.values().event_candidate_count) || 20;
    const result = ec.bestCandidates(peaks, sync.peaks, { count });
    if (!result.candidates.length) { api.say("No peaks passed the quality filter."); return; }
    await publish(api.say, "best-candidates",
      ["rank", "peak_time", "dataset", "station", "sim", "template",
       "peak_corr", "snr_linear", "num_sync_stations",
       "score_ulp", "score_sync", "score_balanced"],
      result.candidates.map((p, i) => [i + 1, p.peak_time_dt, p.dataset, p.station,
        p.sim, p.template, p.peak_corr, p.snr_linear, p.num_sync_stations,
        p.score_ulp.toFixed(4), p.score_sync.toFixed(4), p.score_balanced.toFixed(4)]),
      `Top ${result.candidates.length} of ${result.quality} high-quality peaks.`);
  },

  Cumulative: async (api) => {
    const { peaks } = await loadPeaks(api);
    const result = ec.cumulativeMetrics(peaks);
    if (!result) { api.say("Not enough peaks in any one group."); return; }
    const canvas = linePlot([
      { name: "cumulative |corr|", x: result.series.map((r) => r.n),
        y: result.series.map((r) => r.cumulative_corr) },
    ], { width: 880, height: 320, title: `Cumulative metrics — ${result.group}`,
         labels: { x: "Peak number", y: "Cumulative correlation" } });
    const figure = await saveFigure(canvas, `cumulative_${stamp()}.png`,
                                    "Event Correlation Toolkit");
    await publish(api.say, "cumulative-metrics",
      ["n", "cumulative_corr", "cumulative_snr_db"],
      result.series.map((r) => [r.n, r.cumulative_corr, r.cumulative_snr_db]),
      `${result.series.length} peaks in ${result.group}. Figure ${figure}.`);
  },

  "Dataset Compare": async (api) => {
    const { peaks } = await loadPeaks(api);
    const rows = ec.datasetCompare(peaks);
    await publish(api.say, "dataset-compare",
      ["dataset", "peaks", "stations", "templates", "corr_mean", "corr_max", "snr_mean", "snr_max"],
      rows.map((r) => [r.dataset, r.peaks, r.stations, r.templates,
        r.corr_mean.toFixed(4), r.corr_max.toFixed(4), r.snr_mean.toFixed(3), r.snr_max.toFixed(3)]),
      `${rows.length} dataset(s) compared.`);
  },

  "P-wave Summaries": async (api) => {
    const { peaks } = await loadPeaks(api);
    const rows = ec.stationSummaries(peaks);
    await publish(api.say, "station-summaries",
      ["dataset", "station", "peaks", "high_quality", "corr_mean", "corr_max", "snr_mean", "snr_max"],
      rows.map((r) => [r.dataset, r.station, r.peaks, r.high_quality,
        r.corr_mean.toFixed(4), r.corr_max.toFixed(4), r.snr_mean.toFixed(3), r.snr_max.toFixed(3)]),
      `${rows.length} station summary row(s).`);
  },

  Contamination: async (api) => {
    // The impact table is a separate product of the upstream pipeline.
    const files = [];
    for (const dir of ["data/raw", "data/processed", "analysis"]) {
      try {
        (await store.listProjectDir(dir))
          .filter((f) => /pwave_impact_comparison\.csv$/i.test(f.name))
          .forEach((f) => files.push(`${dir}/${f.name}`));
      } catch (error) { /* absent */ }
    }
    if (!files.length) {
      throw new Error("Contamination needs a *_pwave_impact_comparison.csv "
        + "with corr_mean_clean and corr_mean_contaminated columns.");
    }
    const rows = [];
    for (const path of files) {
      rows.push(...ec.rowObjects(parseTable(await store.readProjectFile(path))));
    }
    const result = ec.contamination(rows);
    if (!result) throw new Error("No rows with both clean and contaminated correlation means.");
    await publish(api.say, "contamination",
      ["station", "corr_mean_clean", "corr_mean_contaminated", "corr_improvement_pct"],
      result.rows.map((r) => [r.station ?? "", r.corr_mean_clean, r.corr_mean_contaminated,
                              r.corr_improvement_pct.toFixed(2)]),
      `Clean beats contaminated on ${result.contaminated_worse} of ${result.total} `
      + `rows; median improvement ${result.median_improvement_pct.toFixed(1)}%.`);
  },

  Spectrograms: async (api) => {
    const { path, name, values } = await longestSeries();
    // A spectrogram needs several windows to be a spectrogram at all; below
    // that it silently produced an empty figure.
    if (values.length < 64) {
      throw new Error(`Longest series is ${values.length} points — a `
        + "spectrogram needs at least 64.");
    }
    const spec = ec.candidateSpectrogram(values, 1);
    if (!spec.grid.length) throw new Error("Series too short for a spectrogram.");
    const canvas = heatmap(spec.grid, { width: 880, height: 340,
      title: `Spectrogram — ${path.split("/").pop()}:${name}`,
      labels: { x: "Time", y: "Frequency" } });
    const figure = await saveFigure(canvas, `spectrogram_${slug(name)}_${stamp()}.png`,
                                    "Event Correlation Toolkit");
    api.say(`Spectrogram of ${name} (${spec.grid.length} frames). Saved ${figure}.`);
  },

  Morlet: async (api) => {
    const { path, name, values } = await longestSeries();
    if (values.length < 32) {
      throw new Error(`Longest series is ${values.length} points — a wavelet `
        + "transform needs at least 32.");
    }
    // The script's band is ultra-low-frequency; scaled to this series' length
    // so the wavelets actually fit inside it.
    const cwt = ec.morletCwt(values, { fs: 1, freqMin: 2 / values.length, freqMax: 0.4, count: 36 });
    if (!cwt) throw new Error("Series too short for a wavelet transform.");
    const canvas = heatmap(cwt.grid, { width: 880, height: 340,
      title: `Morlet CWT — ${path.split("/").pop()}:${name}`,
      labels: { x: "Sample", y: "Frequency" } });
    const figure = await saveFigure(canvas, `morlet_${slug(name)}_${stamp()}.png`,
                                    "Event Correlation Toolkit");
    api.say(`Morlet CWT of ${name} over ${cwt.freqs.length} scales. Saved ${figure}.`);
  },

  "Load Peak CSVs": async (api) => toolkit["Load Event Inputs"](api),

  "Load Headers": async (api) => {
    const paths = await anyTable();
    if (!paths.length) throw new Error("No tables in this project yet.");
    const path = paths.length === 1 ? paths[0] : await chooseTable(paths);
    if (!path) return;
    const table = await loadTable(path);
    api.say(`${path}: ${table.columns.join(", ")}`);
  },

  /** Dispatch whatever the catalogue has selected to the button that does it. */
  "Run Selected Module": async (api) => {
    const host = document.getElementById("research-page");
    const selected = host.querySelector(".qt-datatable .is-selected, .qt-listwidget .is-selected");
    const label = (selected?.textContent || "").trim();
    const match = Object.keys(toolkit).find((key) =>
      label && key.toLowerCase().includes(label.toLowerCase().split(" ")[0]));
    if (!match) {
      throw new Error("Select a module in the catalogue first — or press its "
        + "button directly, which runs the same analysis.");
    }
    await toolkit[match](api);
  },
};

wire("Signal Processing", toolkit);

/* ── The last of the odd ones out ─────────────────────────────────────────
 * One-offs whose labels no pattern was ever going to catch.
 */

/** Choose a folder inside the project, in place of a directory dialog. */
async function chooseFolder(prompt = "Choose a folder") {
  const roots = ["data/raw", "data/processed", "data/pulled", "data/external",
                 "signals", "exports", "analysis", "figures", "fem_runs",
                 "post_processing/extracted_dofs"];
  const present = [];
  for (const dir of roots) {
    try { await store.listProjectDir(dir); present.push(dir); }
    catch (error) { /* not in this project */ }
  }
  if (!present.length) throw new Error("This project has no data folders yet.");
  return present.length === 1 ? present[0] : chooseTable(present);
}

// `…` is a directory chooser sitting beside a path field (app_qt.py:5616).
wirePattern(/^…$/, async ({ say, controls }) => {
  const folder = await chooseFolder();
  if (!folder) return;
  const target = Array.from(controls.entries()).find(([name, node]) =>
    node.tagName === "INPUT" && node.type === "text"
    && /(dir|folder|out|watch|root|path)/i.test(name));
  if (target) target[1].value = folder;
  say(target ? `Folder set to ${folder}.` : `Chose ${folder}.`);
});

// The watcher `Start` sets up, cleared by name rather than by toggling.
wirePattern(/^Stop$/, async ({ say, pageId }) => {
  if (!watchers.has(pageId)) { say("Not watching."); return; }
  clearInterval(watchers.get(pageId));
  watchers.delete(pageId);
  say("Stopped watching.");
});

wire("Equation Workbench", {
  "Load Dataset": async ({ say, controls }) => {
    const paths = await findTables();
    if (!paths.length) throw new Error("No tables in this project yet.");
    const path = paths.length === 1 ? paths[0] : await chooseTable(paths);
    if (!path) return;
    const table = await loadTable(path);
    const names = Object.keys(numericOf(table));
    const field = Array.from(controls.values()).find((n) =>
      n.tagName === "INPUT" && n.type === "text");
    if (field) field.value = path;
    say(`${path}: ${table.rows.length} rows. Variables available: ${names.join(", ") || "none"}.`);
  },
});

wire("Event Annotation", {
  "Add Annotation": async ({ say, values }) => {
    const v = values();
    const text = Object.entries(v)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key, value]) => [key, value.trim()]);
    if (!text.length) throw new Error("Fill in the annotation first.");
    const doc = await store.readJson("metadata/annotations.json", { annotations: [] });
    doc.annotations = doc.annotations || [];
    doc.annotations.push({
      id: `ann_${Date.now().toString(36)}`,
      created_at: new Date().toISOString(),
      ...Object.fromEntries(text),
    });
    await store.writeJson("metadata/annotations.json", doc);
    say(`Annotation ${doc.annotations.length} saved to metadata/annotations.json.`);
  },
});

wire("Import / Clone", {
  "Clone simulation": async ({ say }) => {
    let runs = [];
    try {
      runs = (await store.listProjectDir("fem_runs"))
        .filter((f) => f.kind === "directory").map((f) => f.name);
    } catch (error) { /* none yet */ }
    if (!runs.length) throw new Error("No runs in fem_runs/ to clone.");
    const source = runs.length === 1 ? runs[0] : await chooseTable(runs);
    if (!source) return;
    const target = `${source}-copy-${stamp().slice(0, 10)}`;
    // A run is its spec plus whatever sits beside it; the spec is what makes
    // the clone a run rather than a folder.
    const spec = await store.readJson(`fem_runs/${source}/spec.json`, null);
    if (!spec) throw new Error(`${source} has no spec.json to clone.`);
    await store.writeJson(`fem_runs/${target}/spec.json`,
      { ...spec, name: target, cloned_from: source, created_at: new Date().toISOString() });
    say(`Cloned ${source} → fem_runs/${target}.`);
  },
});

wire("Model Fitting", {
  "Save Fit Parameters JSON": async ({ say }) => {
    // Fit already writes one; this saves the most recent again under a name of
    // its own, which is what the button does in the app.
    let fits = [];
    try {
      fits = (await store.listProjectDir("analysis"))
        .filter((f) => f.name.startsWith("fit-")).map((f) => f.name).sort();
    } catch (error) { /* none */ }
    if (!fits.length) throw new Error("Run Fit first — there is no result to save.");
    const latest = fits[fits.length - 1];
    const result = JSON.parse(await store.readProjectFile(`analysis/${latest}`));
    const path = `exports/fit-parameters-${stamp()}.json`;
    await store.writeProjectFile(path, JSON.stringify(result, null, 2));
    await store.registerData({ name: path.split("/").pop(), kind: "parameters",
                               path, source: "Model Fitting" });
    say(`${result.model}: ${result.parameters.length} parameter(s), R² `
      + `${result.r2.toFixed(4)}. Saved ${path}.`);
  },
});

wire("Module Builder", {
  "↺": async ({ say, redraw }) => { redraw(); say("Reset."); },
});

/** Move the selected pipeline step, which is what ▲ and ▼ do. */
async function movePipelineStep(direction, say) {
  const plan = await store.readJson("metadata/pipeline.json", { plan: [] });
  const steps = plan.plan || [];
  if (steps.length < 2) throw new Error("The pipeline has nothing to reorder.");
  const host = document.getElementById("research-page");
  const rows = Array.from(host.querySelectorAll(".qt-listwidget > *, .qt-datatable > *"));
  const at = rows.findIndex((n) => n.classList?.contains("is-selected"));
  const index = at >= 0 ? at : (direction < 0 ? steps.length - 1 : 0);
  const to = index + direction;
  if (to < 0 || to >= steps.length) { say("Already at the end."); return; }
  [steps[index], steps[to]] = [steps[to], steps[index]];
  plan.plan = steps;
  await store.writeJson("metadata/pipeline.json", plan);
  say(`Moved "${steps[to].name || `step ${index + 1}`}" ${direction < 0 ? "up" : "down"}.`);
}

wire("Pipeline Editor", {
  "▲": async ({ say }) => movePipelineStep(-1, say),
  "▼": async ({ say }) => movePipelineStep(1, say),
});

wire("Settings", {
  "Save Settings": async ({ say, values }) => {
    const settings = Object.fromEntries(Object.entries(values())
      .filter(([, value]) => value !== "" && value !== undefined));
    // Settings belong to the person, not the study, so they go to localStorage
    // as the Google client id does -- and to the project too when one is open,
    // because the desktop app reads them from there.
    localStorage.setItem("geoid-gis:research-settings", JSON.stringify(settings));
    if (store.getActive()) await store.writeJson("metadata/settings.json", settings);
    say(`${Object.keys(settings).length} setting(s) saved`
      + `${store.getActive() ? " to metadata/settings.json and this browser." : " in this browser."}`);
  },
});

wire("Temporal Tools", {
  "Run Resample": async (api) => {
    const { say, values } = api;
    const { path, table } = await chosenTable(api);
    const numeric = numericOf(table);
    const names = Object.keys(numeric);
    if (!names.length) throw new Error("No numeric column to resample.");
    const v = values();
    // The interval the page asks for, in samples. A resample to a coarser grid
    // is a block mean, which is the honest answer for irregular data too.
    const factor = Math.max(2, Math.round(Number(
      Object.entries(v).find(([k]) => /interval|factor|step|window/i.test(k))?.[1]) || 10));
    const header = ["bin", ...names];
    const source = numeric[names[0]];
    const bins = Math.floor(source.length / factor);
    if (bins < 1) throw new Error(`Series is shorter than one ${factor}-sample bin.`);
    const rows = [];
    for (let b = 0; b < bins; b += 1) {
      const row = [b];
      names.forEach((name) => {
        const slice = numeric[name].slice(b * factor, (b + 1) * factor);
        row.push(slice.reduce((a, x) => a + x, 0) / slice.length);
      });
      rows.push(row);
    }
    const out = `analysis/resampled-${stamp()}.csv`;
    await saveTable(out, header, rows, "Temporal Tools", "series");
    say(`${path.split("/").pop()}: ${source.length} → ${bins} rows `
      + `(mean of ${factor}). Saved ${out}.`);
  },
});

// ── Six buttons that were enabled and did nothing ────────────────────────────
//
// Found by clicking every control on all sixty-four pages and watching for a
// status message, a DOM change or a file picker. Nearly every "silent" button
// turned out to be a tab, a file dialog or a message the redraw was eating —
// these six were the real thing: live-looking controls with no behaviour, which
// this project treats as worse than an honest disabled one.

/** The registered dataset that a page's list is currently showing. */
async function registerExisting(say, dest) {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  const chosen = await new Promise((resolve) => {
    picker.addEventListener("change", () => resolve(Array.from(picker.files || [])));
    picker.click();
  });
  if (!chosen.length) return;                       // cancelled: correctly nothing
  for (const file of chosen) {
    const path = `${dest}/${file.name}`;
    const isText = /\.(csv|tsv|txt|dat|json|geojson|md|xyz|asc|obj|ply|msh|geo|vtk)$/i
      .test(file.name);
    await store.writeProjectFile(path, isText ? await file.text() : await file.arrayBuffer());
    await store.registerData({
      name: file.name, kind: "file", path, source: "Registered by hand",
      extra: { bytes: file.size },
    });
  }
  say(`${chosen.length} file(s) registered into ${dest}.`);
}

wire("Data Repository", {
  "+ Add Dataset": async ({ say, redraw }) => {
    await registerExisting(say, "data/raw");
    redraw();
  },
  // The Qt page suggests a promotion when a file sits in data/raw with a
  // processed twin. There was no suggestion engine here at all, so the button
  // sat live and inert; this states what it would act on rather than pretending.
  "Accept Suggestion": async ({ say }) => {
    const rows = await store.listData();
    const raw = rows.filter((r) => String(r.path || "").startsWith("data/raw/"));
    if (!raw.length) throw new Error("Nothing in data/raw to promote.");
    const target = raw[raw.length - 1];
    const to = String(target.path).replace("data/raw/", "data/processed/");
    const body = await store.readProjectFile(target.path);
    await store.writeProjectFile(to, body);
    await store.registerData({
      name: target.name, kind: target.kind || "file", path: to,
      source: "Promoted from data/raw",
    });
    say(`${target.name} promoted to ${to}.`);
  },
});

wire("Metadata & Lineage", {
  "Register File": async ({ say, redraw }) => {
    await registerExisting(say, "data/raw");
    redraw();
  },
});

wire("Post Processing", {
  // Both of these read the run picker the hand-built page exposes on
  // window.__geoidPostProcess, so there is one list of runs, not two.
  "Refresh GALES Results": async ({ say, redraw }) => {
    // listProjectDir answers {name, kind} entries, not strings -- the same
    // filter the page itself uses two files away (pages/postprocess.js:322).
    const runs = (await store.listProjectDir("fem_runs").catch(() => []))
      .filter((e) => e.kind === "directory").map((e) => e.name);
    let solved = 0;
    for (const run of runs) {
      const inside = await store.listProjectDir(`fem_runs/${run}/results`).catch(() => []);
      if (inside.length) solved += 1;
    }
    redraw();
    say(`${runs.length} run(s) in fem_runs, ${solved} with results.`);
  },
  // Named "Open …", which the navigation pattern claims first and answers with
  // "Nothing to open for that." A page-specific handler beats a pattern, which
  // is what makes this fixable at all.
  "Open Selected GALES Result": async ({ say }) => {
    const api = window.__geoidPostProcess;
    const run = api?.run?.();
    if (!run || run.startsWith("(")) throw new Error("No FEM run selected.");
    const files = (await store.listProjectDir(`fem_runs/${run}/results`).catch(() => []))
      .map((e) => e.name);
    if (!files.length) {
      throw new Error(`${run} has no results/ yet — solve it first.`);
    }
    say(`${run}/results: ${files.slice(0, 6).join(", ")}`
      + `${files.length > 6 ? ` … ${files.length} fields` : ""}.`);
  },
});

wire("Signal Processing", {
  /**
   * Signal-to-noise, as the Event Correlation toolkit defines it.
   *
   * Peak amplitude over the standard deviation of the quiet part, taking the
   * quietest fifth of the record as noise — the same shape as the toolkit's
   * MIN_SNR_LINEAR test, so the two agree about what a strong signal is.
   */
  SNR: async ({ say }) => {
    const { path, table } = await firstTable();
    const numeric = numericOf(table);
    const name = Object.keys(numeric).find((n) => !/^(t|time|index|rank)$/i.test(n));
    if (!name) throw new Error("No signal column to measure.");
    const v = numeric[name];
    if (v.length < 32) throw new Error(`${name} has ${v.length} points; needs 32.`);
    const mean = stats.mean(v);
    const centred = v.map((x) => x - mean);
    const sorted = centred.map(Math.abs).slice().sort((a, b) => a - b);
    const quiet = sorted.slice(0, Math.max(8, Math.floor(sorted.length / 5)));
    const noise = Math.sqrt(stats.mean(quiet.map((x) => x * x)));
    const peak = sorted[sorted.length - 1];
    if (!(noise > 0)) throw new Error(`${name} has no variation to measure against.`);
    const ratio = peak / noise;
    say(`${name} in ${path.split("/").pop()}: SNR ${ratio.toPrecision(3)} `
      + `(${(20 * Math.log10(ratio)).toFixed(1)} dB), peak ${peak.toPrecision(3)}.`);
  },
});
