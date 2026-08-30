import { registerPage } from "../stages.js?v=20260830-97628ed";
import * as store from "../project-store.js?v=20260830-97628ed";
import { column } from "../table.js?v=20260830-97628ed";
import { linePlot } from "../plot.js?v=20260830-97628ed";
import * as dsp from "../dsp.js?v=20260830-97628ed";
import {
  el, card, field, input, textarea, selectOf, button, row, statGrid, statusLine,
  guard, crossPage, findTables, loadTable, inferSampling, seriesPicker,
  saveFigure, saveTable,
} from "./common.js?v=20260830-97628ed";

/**
 * The rest of the Postprocessing and Signal Analysis stage.
 *
 * Everything here reads series out of the project -- imported records, or DOF
 * series extracted from solver output -- so model and measurement are compared
 * with the same tools rather than two that disagree about conventions.
 */

// ── Multi-Station Viewer ─────────────────────────────────────────────────────

const mountStations = guard("Multi-Station Viewer", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Stations");
  box.appendChild(el("p", "research-note",
    "Several series on one time base, and the lag between any two of them. "
    + "Cross-correlation is how an arrival-time difference is measured, so it "
    + "is reported in samples and in seconds."));

  const files = await findTables();
  const fileSelect = selectOf(files.length ? files : ["(no tables)"]);
  const columnsBox = selectOf([]);
  columnsBox.multiple = true;
  columnsBox.size = 6;
  const figure = el("div", "research-figure");
  const lags = el("div", "research-stats");
  let table = null;
  let rate = 1;

  async function read() {
    if (!files.length) return;
    table = await loadTable(fileSelect.value);
    columnsBox.innerHTML = "";
    const { fs, timeColumn } = inferSampling(table);
    rate = fs || 1;
    table.columns.filter((_, i) => table.numeric[i])
      .filter((name) => name !== timeColumn)
      .forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name; opt.textContent = name;
        columnsBox.appendChild(opt);
      });
    [...columnsBox.options].slice(0, 3).forEach((o) => { o.selected = true; });
  }
  fileSelect.addEventListener("change", () => { void read(); });

  box.append(field("File", fileSelect), field("Stations (multi-select)", columnsBox),
    row(button("Plot and compare", () => {
      if (!table) { say("Load a file first.", true); return; }
      const names = [...columnsBox.options].filter((o) => o.selected).map((o) => o.value);
      if (names.length < 1) { say("Select at least one station.", true); return; }
      const series = names.map((name) => ({
        name, values: column(table, name).filter(Number.isFinite),
      }));
      const t = series[0].values.map((_, i) => i / rate);
      figure.textContent = "";
      figure.appendChild(linePlot(series.map((s) => ({ x: t, y: s.values, name: s.name })), {
        labels: { x: "time (s)", y: "value" }, title: fileSelect.value.split("/").pop(),
        height: 320,
      }));
      lags.textContent = "";
      // Every pair against the first, which is the usual reference-station
      // question rather than an all-pairs matrix nobody reads.
      for (let i = 1; i < series.length; i += 1) {
        const cc = dsp.crossCorrelation(series[0].values, series[i].values);
        const best = dsp.bestLag(cc, rate);
        lags.appendChild(el("div", "research-stat"));
        const node = lags.lastChild;
        node.append(
          el("span", "research-stat-label", `${series[0].name} → ${series[i].name}`),
          el("span", "research-stat-value",
            `${best.lagSamples} samples (${best.lagSeconds.toFixed(4)} s), r=${best.value.toFixed(3)}`),
        );
      }
      say(`${series.length} station(s) at ${rate.toFixed(3)} Hz.`);
    }), button("Save figure", async () => {
      const canvas = figure.querySelector("canvas");
      if (!canvas) { say("Plot first.", true); return; }
      const path = await saveFigure(canvas,
        `${fileSelect.value.split("/").pop().replace(/\.\w+$/, "")}-stations.png`,
        "Multi-Station Viewer");
      say(`Saved ${path}.`);
    }, { secondary: true })), lags, figure);
  host.append(box, status);
  await read();
});

// ── Model Fitting ────────────────────────────────────────────────────────────

const mountModelFit = guard("Model Fitting", async (host) => {
  const { node: status, say } = statusLine();
  let loaded = null;
  const box = card("Fit a model");
  box.appendChild(el("p", "research-note",
    "Least-squares fits, with residuals and R\u00b2 so the fit can be judged "
    + "rather than admired. Comparing a modelled DOF series against a measured "
    + "one is the same operation, which is why both are here."));

  const kind = selectOf(["linear", "quadratic", "exponential", "logarithmic", "power"]);
  const figure = el("div", "research-figure");
  const readout = el("div", "research-stats");
  let fit = null;

  /** Ordinary least squares on a design matrix, by normal equations. */
  function solveLeastSquares(rows, targets) {
    const k = rows[0].length;
    const ata = Array.from({ length: k }, () => new Float64Array(k));
    const atb = new Float64Array(k);
    rows.forEach((r, n) => {
      for (let a = 0; a < k; a += 1) {
        atb[a] += r[a] * targets[n];
        for (let b = 0; b < k; b += 1) ata[a][b] += r[a] * r[b];
      }
    });
    // Gauss-Jordan with partial pivoting; k is 2 or 3 here, so this is exact
    // enough and avoids pulling in a solver.
    const m = ata.map((r, i) => [...r, atb[i]]);
    for (let col = 0; col < k; col += 1) {
      let pivot = col;
      for (let r = col + 1; r < k; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
      if (Math.abs(m[pivot][col]) < 1e-12) return null;
      [m[col], m[pivot]] = [m[pivot], m[col]];
      const d = m[col][col];
      for (let c = col; c <= k; c += 1) m[col][c] /= d;
      for (let r = 0; r < k; r += 1) {
        if (r === col) continue;
        const f = m[r][col];
        for (let c = col; c <= k; c += 1) m[r][c] -= f * m[col][c];
      }
    }
    return m.map((r) => r[k]);
  }

  function run() {
    if (!loaded) { say("Load a series first.", true); return; }
    const y = Array.from(loaded.values);
    const t = y.map((_, i) => i / loaded.fs);
    const model = kind.value;

    // Non-linear forms are fitted in the space that makes them linear, which
    // is standard and worth naming: the residuals reported are then in that
    // space too, not in the original units.
    let rows; let targets; let predict; let form;
    const positive = (v) => v > 0;
    if (model === "linear") {
      rows = t.map((x) => [1, x]); targets = y;
      predict = (c, x) => c[0] + c[1] * x;
      form = (c) => `y = ${c[0].toPrecision(5)} + ${c[1].toPrecision(5)}·t`;
    } else if (model === "quadratic") {
      rows = t.map((x) => [1, x, x * x]); targets = y;
      predict = (c, x) => c[0] + c[1] * x + c[2] * x * x;
      form = (c) => `y = ${c[0].toPrecision(5)} + ${c[1].toPrecision(5)}·t + ${c[2].toPrecision(5)}·t²`;
    } else if (model === "exponential") {
      if (!y.every(positive)) { say("Exponential needs strictly positive values.", true); return; }
      rows = t.map((x) => [1, x]); targets = y.map(Math.log);
      predict = (c, x) => Math.exp(c[0] + c[1] * x);
      form = (c) => `y = ${Math.exp(c[0]).toPrecision(5)}·e^(${c[1].toPrecision(5)}·t)`;
    } else if (model === "logarithmic") {
      if (!t.slice(1).every(positive)) { say("Logarithmic needs t > 0.", true); return; }
      rows = t.map((x) => [1, Math.log(Math.max(x, 1e-12))]); targets = y;
      predict = (c, x) => c[0] + c[1] * Math.log(Math.max(x, 1e-12));
      form = (c) => `y = ${c[0].toPrecision(5)} + ${c[1].toPrecision(5)}·ln t`;
    } else {
      if (!y.every(positive)) { say("Power needs strictly positive values.", true); return; }
      rows = t.map((x) => [1, Math.log(Math.max(x, 1e-12))]); targets = y.map(Math.log);
      predict = (c, x) => Math.exp(c[0]) * Math.max(x, 1e-12) ** c[1];
      form = (c) => `y = ${Math.exp(c[0]).toPrecision(5)}·t^${c[1].toPrecision(5)}`;
    }

    const coefficients = solveLeastSquares(rows, targets);
    if (!coefficients) { say("That fit is singular for this series.", true); return; }
    const fitted = t.map((x) => predict(coefficients, x));
    const residuals = y.map((v, i) => v - fitted[i]);
    const mean = y.reduce((a, b) => a + b, 0) / y.length;
    const ssTot = y.reduce((a, v) => a + (v - mean) ** 2, 0);
    const ssRes = residuals.reduce((a, v) => a + v * v, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;
    const rmse = Math.sqrt(ssRes / y.length);
    fit = { model, coefficients, fitted, residuals, r2, rmse, form: form(coefficients) };

    figure.textContent = "";
    figure.appendChild(linePlot([
      { x: t, y, name: loaded.columnName },
      { x: t, y: fitted, name: `${model} fit` },
      { x: t, y: residuals, name: "residual" },
    ], { labels: { x: "time (s)", y: "value" }, title: fit.form, height: 320 }));
    readout.textContent = "";
    readout.append(...[["Model", model], ["R²", Number.isFinite(r2) ? r2.toFixed(5) : "—"],
      ["RMSE", rmse.toPrecision(5)], ["Form", fit.form]]
      .map(([label, value]) => {
        const node = el("div", "research-stat");
        node.append(el("span", "research-stat-label", label),
          el("span", "research-stat-value", String(value)));
        return node;
      }));
    say(`${model} fit, R² ${Number.isFinite(r2) ? r2.toFixed(4) : "n/a"}.`);
  }

  box.append(field("Model", kind), row(
    button("Fit", run),
    button("Save fit to analysis/", async () => {
      if (!fit) { say("Fit first.", true); return; }
      const name = `${loaded.stem}-${fit.model}-fit.csv`;
      await saveTable(`analysis/${name}`, ["time", "observed", "fitted", "residual"],
        fit.fitted.map((v, i) => [(i / loaded.fs).toFixed(6), loaded.values[i], v,
          fit.residuals[i]]),
        `Model fit: ${fit.form} (R2=${fit.r2.toFixed(5)})`, "fit");
      say(`Saved analysis/${name}.`);
    }, { secondary: true }),
  ), readout, figure);

  host.appendChild(await seriesPicker((l) => { loaded = l; }));
  host.append(box, status);
});

// ── Event Detection ──────────────────────────────────────────────────────────

const mountEventDetection = guard("Event Detection", async (host) => {
  const { node: status, say } = statusLine();
  let loaded = null;
  const box = card("Detect events");
  box.appendChild(el("p", "research-note",
    "Short-term over long-term average, the standard trigger in seismology: "
    + "an event is declared where recent energy rises above the running "
    + "background by the trigger ratio, and ends when it falls below the "
    + "detrigger."));

  const shortWin = input(0.5, "seconds", "number");
  const longWin = input(10, "seconds", "number");
  const onRatio = input(3, "", "number");
  const offRatio = input(1.5, "", "number");
  const figure = el("div", "research-figure");
  const found = el("div", "research-list");
  let events = [];

  function detect() {
    if (!loaded) { say("Load a series first.", true); return; }
    const { values, fs } = loaded;
    const ns = Math.max(2, Math.round(Number(shortWin.value) * fs));
    const nl = Math.max(ns + 1, Math.round(Number(longWin.value) * fs));
    if (values.length < nl + ns) { say("Series is shorter than the long window.", true); return; }
    const energy = dsp.detrend(values, "constant");
    // Running means of squared amplitude, computed by prefix sums so the whole
    // trace is one pass rather than a window per sample.
    const prefix = new Float64Array(energy.length + 1);
    for (let i = 0; i < energy.length; i += 1) prefix[i + 1] = prefix[i] + energy[i] * energy[i];
    const meanOver = (from, to) => (prefix[to] - prefix[from]) / Math.max(1, to - from);
    const ratio = new Array(values.length).fill(0);
    for (let i = nl; i < values.length; i += 1) {
      const sta = meanOver(i - ns, i);
      const lta = meanOver(i - nl, i);
      ratio[i] = lta > 0 ? sta / lta : 0;
    }
    const on = Number(onRatio.value);
    const off = Number(offRatio.value);
    events = [];
    let active = null;
    for (let i = nl; i < ratio.length; i += 1) {
      if (!active && ratio[i] >= on) active = { start: i, peak: ratio[i] };
      else if (active) {
        if (ratio[i] > active.peak) active.peak = ratio[i];
        if (ratio[i] <= off) { active.end = i; events.push(active); active = null; }
      }
    }
    if (active) { active.end = ratio.length - 1; events.push(active); }

    const t = values.map((_, i) => i / fs);
    figure.textContent = "";
    figure.appendChild(linePlot([
      { x: t, y: Array.from(values), name: loaded.columnName },
      { x: t, y: ratio, name: "STA/LTA" },
    ], { labels: { x: "time (s)", y: "value / ratio" }, title: loaded.name, height: 300 }));

    found.textContent = "";
    if (!events.length) {
      found.appendChild(el("p", "research-note", "No events above the trigger ratio."));
    }
    events.forEach((event, i) => {
      const line = el("div", "research-list-row");
      line.append(
        el("span", "research-list-name",
          `#${i + 1}  ${(event.start / fs).toFixed(3)} → ${(event.end / fs).toFixed(3)} s`),
        el("span", "research-list-tag", `peak ${event.peak.toFixed(2)}×`),
      );
      found.appendChild(line);
    });
    say(`${events.length} event(s) at STA ${ns} / LTA ${nl} samples.`);
  }

  const grid = el("div", "research-grid-2");
  grid.append(field("Short window (s)", shortWin), field("Long window (s)", longWin),
    field("Trigger ratio", onRatio), field("Detrigger ratio", offRatio));
  box.append(grid, row(
    button("Detect", detect),
    button("Save events CSV", async () => {
      if (!events.length) { say("Nothing detected.", true); return; }
      const name = `${loaded.stem}-events.csv`;
      await saveTable(`analysis/${name}`, ["index", "start_s", "end_s", "duration_s", "peak_ratio"],
        events.map((e, i) => [i + 1, (e.start / loaded.fs).toFixed(4),
          (e.end / loaded.fs).toFixed(4),
          ((e.end - e.start) / loaded.fs).toFixed(4), e.peak.toFixed(4)]),
        "Event detection (STA/LTA)", "events");
      say(`Saved analysis/${name}.`);
    }, { secondary: true }),
  ), found, figure);

  host.appendChild(await seriesPicker((l) => { loaded = l; detect(); }));
  host.append(box, status);
});

// ── EDA Report ───────────────────────────────────────────────────────────────

const mountEda = guard("EDA Report", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Exploratory report");
  box.appendChild(el("p", "research-note",
    "Every numeric column at a glance: distribution, spread, and how strongly "
    + "the columns move together. Written out as markdown so it can go into a "
    + "note or a storyboard."));

  const files = await findTables();
  const fileSelect = selectOf(files.length ? files : ["(no tables)"]);
  const report = el("div", "research-report");
  let markdown = "";

  box.append(field("File", fileSelect), row(
    button("Build report", async () => {
      try {
        const table = await loadTable(fileSelect.value);
        const numeric = table.columns.filter((_, i) => table.numeric[i]);
        report.textContent = "";
        const lines = [`# EDA — ${fileSelect.value}`, "",
          `${table.rows.length} rows, ${table.columns.length} columns`, "",
          "| column | mean | std | min | max | rms |", "|---|---|---|---|---|---|"];

        const head = el("div", "research-table-row is-head");
        ["Column", "Mean", "Std", "Min", "Max", "RMS"].forEach((h) =>
          head.appendChild(el("span", null, h)));
        const box2 = el("div", "research-table");
        box2.appendChild(head);
        const series = {};
        numeric.forEach((name) => {
          const values = column(table, name).filter(Number.isFinite);
          series[name] = values;
          const s = dsp.statistics(values);
          if (!s) return;
          const cells = [name, s.mean, s.std, s.min, s.max, s.rms];
          const line = el("div", "research-table-row");
          cells.forEach((v, i) => line.appendChild(
            el("span", null, i === 0 ? v : Number(v).toPrecision(5))));
          box2.appendChild(line);
          lines.push(`| ${name} | ${s.mean.toPrecision(5)} | ${s.std.toPrecision(5)} `
            + `| ${s.min.toPrecision(5)} | ${s.max.toPrecision(5)} | ${s.rms.toPrecision(5)} |`);
        });
        report.appendChild(box2);

        // Pearson correlation between every pair, which is what "do these move
        // together" actually asks.
        if (numeric.length > 1) {
          lines.push("", "## Correlation", "", `| | ${numeric.join(" | ")} |`,
            `|---|${numeric.map(() => "---").join("|")}|`);
          const corrHead = el("div", "research-table-row is-head");
          ["", ...numeric].forEach((h) => corrHead.appendChild(el("span", null, h)));
          const corrBox = el("div", "research-table");
          corrBox.appendChild(corrHead);
          numeric.forEach((a) => {
            const line = el("div", "research-table-row");
            line.appendChild(el("span", null, a));
            const cells = [];
            numeric.forEach((b) => {
              const r = pearson(series[a], series[b]);
              cells.push(Number.isFinite(r) ? r.toFixed(3) : "—");
              line.appendChild(el("span", null, Number.isFinite(r) ? r.toFixed(3) : "—"));
            });
            lines.push(`| ${a} | ${cells.join(" | ")} |`);
            corrBox.appendChild(line);
          });
          report.appendChild(corrBox);
        }
        markdown = lines.join("\n");
        say(`Report over ${numeric.length} numeric column(s).`);
      } catch (error) {
        say(error.message, true);
      }
    }),
    button("Save to plans/reports", async () => {
      if (!markdown) { say("Build the report first.", true); return; }
      const name = `${fileSelect.value.split("/").pop().replace(/\.\w+$/, "")}-eda.md`;
      await store.writeProjectFile(`plans/reports/${name}`, markdown);
      await store.registerData({
        name, kind: "report", path: `plans/reports/${name}`, source: "EDA Report",
      });
      say(`Saved plans/reports/${name}.`);
    }, { secondary: true }),
  ), report);
  host.append(box, status);
});

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let sa = 0; let sb = 0;
  for (let i = 0; i < n; i += 1) { sa += a[i]; sb += b[i]; }
  const ma = sa / n; const mb = sb / n;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma; const y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : NaN;
}

// ── Event Annotation ─────────────────────────────────────────────────────────

const mountAnnotation = guard("Event Annotation", async (host) => {
  const { node: status, say } = statusLine();
  const PATH = "analysis/event_annotations.json";
  const box = card("Annotations");
  box.appendChild(el("p", "research-note",
    "Marks on the record with a note attached, kept with the project so an "
    + "interpretation survives the session it was made in."));

  const when = input("", "time (s)", "number");
  const label = input("", "label");
  const note = input("", "note");
  const list = el("div", "research-list");
  let annotations = await store.readJson(PATH, { events: [] });
  annotations.events = Array.isArray(annotations.events) ? annotations.events : [];

  async function draw() {
    list.textContent = "";
    if (!annotations.events.length) {
      list.appendChild(el("p", "research-note", "No annotations yet."));
    }
    annotations.events
      .slice()
      .sort((a, b) => a.time - b.time)
      .forEach((event, index) => {
        const line = el("div", "research-list-row");
        line.append(
          el("span", "research-list-name",
            `${Number(event.time).toFixed(3)} s — ${event.label}${event.note ? `: ${event.note}` : ""}`),
          button("Remove", async () => {
            annotations.events.splice(index, 1);
            await store.writeJson(PATH, annotations);
            await draw();
          }, { secondary: true }),
        );
        list.appendChild(line);
      });
  }

  box.append(el("div", "research-grid-2"));
  box.lastChild.append(field("Time (s)", when), field("Label", label), field("Note", note));
  box.append(row(button("Add", async () => {
    if (!Number.isFinite(Number(when.value))) { say("Give a time in seconds.", true); return; }
    if (!label.value.trim()) { say("Give the annotation a label.", true); return; }
    annotations.events.push({
      time: Number(when.value), label: label.value.trim(), note: note.value.trim(),
      at: new Date().toISOString(),
    });
    await store.writeJson(PATH, annotations);
    when.value = ""; label.value = ""; note.value = "";
    say("Added.");
    await draw();
  }), button("Export CSV", async () => {
    if (!annotations.events.length) { say("Nothing to export.", true); return; }
    await saveTable("exports/event-annotations.csv", ["time_s", "label", "note", "added_at"],
      annotations.events.map((e) => [e.time, `"${e.label}"`, `"${e.note || ""}"`, e.at]),
      "Event Annotation", "events");
    say("Saved exports/event-annotations.csv.");
  }, { secondary: true })), list);
  host.append(box, status);
  await draw();
});

// ── Equation Workbench ───────────────────────────────────────────────────────

const mountEquations = guard("Equation Workbench", async (host) => {
  const { node: status, say } = statusLine();
  let loaded = null;
  const box = card("Derive a column");
  box.appendChild(el("p", "research-note",
    "An expression over the loaded series. `x` is the value, `t` the time in "
    + "seconds, `i` the sample index; Math is available. Evaluated with the "
    + "Function constructor over those names only, so an expression cannot "
    + "reach the page around it."));

  const expression = input("x * 2", "e.g. x*1000 or Math.log10(Math.abs(x)+1)");
  const figure = el("div", "research-figure");
  let derived = null;

  function run() {
    if (!loaded) { say("Load a series first.", true); return; }
    let fn;
    try {
      // Only the three names are in scope; nothing else is passed in.
      fn = new Function("x", "t", "i", "Math", `"use strict"; return (${expression.value});`);
    } catch (error) {
      say(`That expression will not parse: ${error.message}`, true);
      return;
    }
    const out = [];
    for (let i = 0; i < loaded.values.length; i += 1) {
      const v = fn(loaded.values[i], i / loaded.fs, i, Math);
      out.push(Number.isFinite(v) ? v : NaN);
    }
    const bad = out.filter((v) => !Number.isFinite(v)).length;
    derived = out;
    const t = out.map((_, i) => i / loaded.fs);
    figure.textContent = "";
    figure.appendChild(linePlot([
      { x: t, y: Array.from(loaded.values), name: loaded.columnName },
      { x: t, y: out, name: expression.value },
    ], { labels: { x: "time (s)", y: "value" }, height: 300 }));
    say(bad ? `${out.length} samples, ${bad} not finite.` : `${out.length} samples.`);
  }

  box.append(field("Expression", expression), row(
    button("Evaluate", run),
    button("Save to analysis/", async () => {
      if (!derived) { say("Evaluate first.", true); return; }
      const name = `${loaded.stem}-derived.csv`;
      await saveTable(`analysis/${name}`, ["time", "value"],
        derived.map((v, i) => [(i / loaded.fs).toFixed(6), v]),
        `Equation: ${expression.value}`);
      say(`Saved analysis/${name}.`);
    }, { secondary: true }),
  ), figure);

  host.appendChild(await seriesPicker((l) => { loaded = l; }));
  host.append(box, status);
});

// ── Live Monitor ─────────────────────────────────────────────────────────────

const mountMonitor = guard("Live Monitor", async (host) => {
  const { node: status, say } = statusLine();
  const box = card("Watch a run");
  box.appendChild(el("p", "research-note",
    "Polls a run's folder and reports what the solver has written. The browser "
    + "cannot attach to the process, so this watches its output instead -- "
    + "which is also what tells you whether it is still moving."));

  let runs = [];
  try {
    runs = (await store.listProjectDir("fem_runs")).filter((e) => e.kind === "directory")
      .map((e) => e.name);
  } catch (error) { /* none */ }
  const runSelect = selectOf(runs.length ? runs : ["(no runs)"]);
  const readout = el("div", "research-stats");
  const list = el("div", "research-list");
  let timer = null;

  async function poll() {
    if (!runs.length) return;
    const run = runSelect.value;
    let entries = [];
    try { entries = await store.listProjectDir(`fem_runs/${run}`); } catch (error) { /* gone */ }
    const outputs = entries.filter((e) => e.kind === "file" && e.name !== "spec.json");
    readout.textContent = "";
    readout.append(
      el("div", "research-stat"), el("div", "research-stat"),
    );
    readout.children[0].append(el("span", "research-stat-label", "Run"),
      el("span", "research-stat-value", run));
    readout.children[1].append(el("span", "research-stat-label", "Output files"),
      el("span", "research-stat-value", String(outputs.length)));
    list.textContent = "";
    outputs.forEach((entry) => {
      const line = el("div", "research-list-row");
      line.appendChild(el("span", "research-list-name", entry.name));
      list.appendChild(line);
    });
    if (!outputs.length) {
      list.appendChild(el("p", "research-note",
        "Nothing written yet. A configured run that never produces output has "
        + "not been picked up by a solver."));
    }
  }

  box.append(field("Run", runSelect), row(
    button("Refresh", () => { void poll(); }),
    button("Watch every 5 s", (event) => {
      if (timer) {
        window.clearInterval(timer); timer = null;
        event.target.textContent = "Watch every 5 s";
        say("Stopped watching.");
      } else {
        timer = window.setInterval(() => { void poll(); }, 5000);
        event.target.textContent = "Stop watching";
        say("Watching.");
      }
    }, { secondary: true }),
  ), readout, list);
  // The interval must not outlive the page, or it polls a project that has
  // since been closed.
  host.append(box, status);
  await poll();
  // Handed to the page's unmount below rather than returned: the hub tears a
  // page down through `unmount`, and an interval left running would keep
  // polling a project the user has navigated away from.
  monitorCleanup = () => { if (timer) { window.clearInterval(timer); timer = null; } };
});

let monitorCleanup = null;

registerPage("Multi-Station Viewer", { mount: mountStations });
registerPage("Model Fitting", { mount: mountModelFit });
registerPage("Event Detection", { mount: mountEventDetection });
registerPage("EDA Report", { mount: mountEda });
registerPage("Event Annotation", { mount: mountAnnotation });
registerPage("Equation Workbench", { mount: mountEquations });
registerPage("Live Monitor", {
  mount: mountMonitor,
  unmount: () => { monitorCleanup?.(); monitorCleanup = null; },
});

registerPage("Point Cloud 3D", {
  mount: crossPage("Point Cloud 3D", {
    blurb: "Inspect a point cloud in three dimensions.",
    note: "XYZ and CSV point clouds import on the GIS page and render in the "
      + "Meshing Studio, where they can be rotated, scaled and triangulated.",
    mode: "model",
  }),
});

registerPage("FEM 3D Viewer", {
  mount: crossPage("FEM 3D Viewer", {
    blurb: "Look at a mesh and its results in three dimensions.",
    note: "Meshes in this project's meshes/ open in the Meshing Studio. Result "
      + "fields are read as series on the Post Processing page.",
    mode: "model",
  }),
});
