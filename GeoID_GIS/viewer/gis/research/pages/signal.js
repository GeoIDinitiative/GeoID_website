import { registerPage } from "../stages.js?v=20260826-b7d1a76";
import * as store from "../project-store.js?v=20260826-b7d1a76";
import { parseTable, column, indexSeries } from "../table.js?v=20260826-b7d1a76";
import { linePlot, heatmap, toPngBlob } from "../plot.js?v=20260826-b7d1a76";
import * as dsp from "../dsp.js?v=20260826-b7d1a76";
import { needProject } from "./common.js?v=20260826-b7d1a76";

/**
 * Signal Processing, Spectral Analysis and Statistics.
 *
 * Three pages over one loader, because they all begin the same way: pick a
 * series out of a table in the project. The estimators are in dsp.js, checked
 * against signals whose answers are known; this file is only the controls and
 * the figures.
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

function selectOf(values, selected) {
  const node = document.createElement("select");
  node.className = "input";
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = String(v);
    node.appendChild(opt);
  });
  if (selected != null) node.value = String(selected);
  return node;
}

function numberInput(value, step = "any") {
  const node = document.createElement("input");
  node.className = "input";
  node.type = "number";
  node.step = step;
  node.value = String(value);
  return node;
}

async function findTables() {
  const roots = ["signals", "post_processing/extracted_dofs", "data/raw",
    "data/processed", "data/external", "data/pulled", "exports"];
  const found = [];
  for (const dir of roots) {
    let entries = [];
    try { entries = await store.listProjectDir(dir); } catch (error) { continue; }
    entries
      .filter((e) => e.kind === "file" && /\.(csv|tsv|txt|dat)$/i.test(e.name))
      .forEach((e) => found.push(`${dir}/${e.name}`));
  }
  return found;
}


/**
 * The source picker every page here shares: a file, a column, and a sampling
 * rate — inferred from a time column when there is one, because getting fs
 * wrong makes every frequency downstream wrong by the same factor.
 */
async function sourceControls(onLoad) {
  const box = card("Signal");
  const files = await findTables();
  const fileSelect = selectOf(files);
  const columnSelect = selectOf([]);
  const fsInput = numberInput(1);
  const fsNote = el("p", "research-note", "");
  const loadBtn = el("button", "button", "Load");
  loadBtn.type = "button";

  const grid = el("div", "research-grid-2");
  grid.append(field("File", fileSelect), field("Column", columnSelect),
    field("Sampling rate (Hz)", fsInput));
  const row = el("div", "gis-btn-row");
  row.appendChild(loadBtn);
  box.append(grid, row, fsNote);

  if (!files.length) {
    box.appendChild(el("p", "research-note",
      "No time-series files in this project. Put CSVs in signals/ or data/raw."));
    loadBtn.disabled = true;
  }

  let table = null;

  async function readFile() {
    const path = fileSelect.value;
    if (!path) return;
    const text = await store.readProjectFile(path);
    table = parseTable(typeof text === "string" ? text : "");
    const numeric = table.columns.filter((_, i) => table.numeric[i]);
    columnSelect.innerHTML = "";
    numeric.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name;
      columnSelect.appendChild(opt);
    });
    // A time column gives the sampling rate for free; guessing it is the single
    // easiest way to get every frequency on the page wrong.
    const timeName = table.columns.find((c) => /^(t|time|secs?|seconds|timestamp)$/i.test(c));
    if (timeName) {
      const times = column(table, timeName);
      const steps = [];
      for (let i = 1; i < Math.min(times.length, 200); i += 1) steps.push(times[i] - times[i - 1]);
      steps.sort((a, b) => a - b);
      const dt = steps[Math.floor(steps.length / 2)];
      if (dt > 0) {
        fsInput.value = String(+(1 / dt).toFixed(6));
        fsNote.textContent = `Sampling rate ${fsInput.value} Hz inferred from "${timeName}".`;
      }
      // The time column itself is not a signal to analyse.
      const at = [...columnSelect.options].findIndex((o) => o.value === timeName);
      if (at >= 0) columnSelect.remove(at);
    } else {
      fsNote.textContent = "No time column found — set the sampling rate by hand.";
    }
  }

  fileSelect.addEventListener("change", () => { void readFile(); });
  loadBtn.addEventListener("click", async () => {
    if (!table) await readFile();
    const values = column(table, columnSelect.value).filter(Number.isFinite);
    onLoad({
      values,
      fs: Number(fsInput.value) || 1,
      name: `${fileSelect.value.split("/").pop()} · ${columnSelect.value}`,
      stem: `${fileSelect.value.split("/").pop().replace(/\.\w+$/, "")}-${columnSelect.value}`,
    });
  });

  if (files.length) await readFile();
  return box;
}

function saveFigureButton(figureHost, nameFn, say) {
  const btn = el("button", "button secondary", "Save to figures/");
  btn.type = "button";
  btn.addEventListener("click", async () => {
    const canvas = figureHost.querySelector("canvas");
    if (!canvas) { say("Draw something first.", true); return; }
    try {
      const blob = await toPngBlob(canvas);
      const name = nameFn();
      await store.writeProjectFile(`figures/${name}`, blob);
      await store.registerData({ name, kind: "figure", path: `figures/${name}`, source: "Signal analysis" });
      say(`Saved figures/${name}.`);
    } catch (error) {
      say(error.message, true);
    }
  });
  return btn;
}

// ── Signal Processing: the trace itself, detrended and filtered ───────────────

async function mountSignal(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "Signal Processing"); return; }
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };
  let signal = null;

  const work = card("Processing");
  const detrendSelect = selectOf(["none", "constant", "linear"], "constant");
  const lowInput = numberInput(0);
  const highInput = numberInput(0);
  const grid = el("div", "research-grid-2");
  grid.append(field("Detrend", detrendSelect),
    field("Band-pass low (Hz, 0 = off)", lowInput),
    field("Band-pass high (Hz, 0 = off)", highInput));
  const figure = el("div", "research-figure");
  const actions = el("div", "gis-btn-row");
  work.append(grid, actions, figure);

  function draw() {
    if (!signal) { say("Load a signal first.", true); return; }
    const { values, fs, name } = signal;
    const t = indexSeries(values.length).map((i) => i / fs);
    let processed = dsp.detrend(values, detrendSelect.value);
    const low = Number(lowInput.value) || 0;
    const high = Number(highInput.value) || 0;
    if (low > 0 || high > 0) {
      processed = dsp.bandpass(processed, fs, {
        low: low > 0 ? low : 0,
        high: high > 0 ? high : fs / 2,
      });
    }
    figure.textContent = "";
    figure.appendChild(linePlot([
      { x: t, y: Array.from(values), name: "raw" },
      { x: t, y: Array.from(processed), name: "processed" },
    ], { labels: { x: "time (s)", y: "amplitude" }, title: name, height: 300 }));
    signal.processed = processed;
    say(`${values.length} samples at ${fs} Hz.`);
  }

  const drawBtn = el("button", "button", "Apply");
  drawBtn.type = "button";
  drawBtn.addEventListener("click", draw);
  actions.append(drawBtn, saveFigureButton(figure, () => `${signal.stem}-trace.png`, say));

  const saveSeries = el("button", "button secondary", "Save processed to signals/");
  saveSeries.type = "button";
  saveSeries.addEventListener("click", async () => {
    if (!signal?.processed) { say("Apply first.", true); return; }
    const rows = ["time,value"];
    signal.processed.forEach((v, i) => rows.push(`${(i / signal.fs).toFixed(6)},${v}`));
    const name = `${signal.stem}-processed.csv`;
    await store.writeProjectFile(`signals/${name}`, rows.join("\n"));
    await store.registerData({ name, kind: "series", path: `signals/${name}`, source: "Signal Processing" });
    say(`Saved signals/${name}.`);
  });
  actions.appendChild(saveSeries);

  host.appendChild(await sourceControls((loaded) => { signal = loaded; draw(); }));
  host.append(work, status);
}

// ── Spectral Analysis: spectrum, PSD, spectrogram ────────────────────────────

async function mountSpectral(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "Spectral Analysis"); return; }
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };
  let signal = null;

  const work = card("Spectrum");
  const methodSelect = selectOf(["FFT amplitude spectrum", "Welch PSD", "STFT spectrogram"]);
  const windowSelect = selectOf(["hann", "hamming", "blackman", "rect"], "hann");
  const segmentSelect = selectOf([128, 256, 512, 1024, 2048], 256);
  // Linear by default: instrumental drift is a ramp, and left in place it wins
  // the "dominant frequency" contest against whatever is being looked for.
  const detrendSelect = selectOf(["none", "constant", "linear"], "linear");
  const grid = el("div", "research-grid-2");
  grid.append(field("Method", methodSelect), field("Window", windowSelect),
    field("Segment length", segmentSelect), field("Detrend", detrendSelect));
  const readout = el("div", "research-stats");
  const figure = el("div", "research-figure");
  const actions = el("div", "gis-btn-row");
  work.append(grid, actions, readout, figure);

  function draw() {
    if (!signal) { say("Load a signal first.", true); return; }
    const { values, fs, name } = signal;
    const windowName = windowSelect.value;
    const segment = Number(segmentSelect.value);
    figure.textContent = "";
    readout.textContent = "";

    if (methodSelect.value === "Welch PSD") {
      const { freqs, psd } = dsp.welch(values, fs,
        { segment, window: windowName, detrendKind: detrendSelect.value });
      if (!freqs.length) { say("Signal is shorter than one segment.", true); return; }
      figure.appendChild(linePlot([{ x: Array.from(freqs), y: Array.from(psd), name: "PSD" }],
        { labels: { x: "frequency (Hz)", y: "power / Hz" }, title: `${name} — Welch PSD` }));
      say(`PSD over ${freqs.length} bins to ${(fs / 2).toFixed(2)} Hz.`);
    } else if (methodSelect.value === "STFT spectrogram") {
      const sg = dsp.spectrogram(values, fs, { segment, window: windowName });
      if (!sg.grid.length) { say("Signal is shorter than one segment.", true); return; }
      figure.appendChild(heatmap(sg.grid, {
        xRange: [sg.times[0], sg.times[sg.times.length - 1]],
        yRange: [sg.freqs[0], sg.freqs[sg.freqs.length - 1]],
        labels: { x: "time (s)", y: "frequency (Hz)" },
        title: `${name} — spectrogram (dB re peak)`,
      }));
      say(`${sg.grid.length} frames × ${sg.freqs.length} bins.`);
    } else {
      const spectrum = dsp.amplitudeSpectrum(values, fs,
        { window: windowName, detrendKind: detrendSelect.value });
      figure.appendChild(linePlot([{
        x: Array.from(spectrum.freqs), y: Array.from(spectrum.amps), name: "amplitude",
      }], { labels: { x: "frequency (Hz)", y: "amplitude" }, title: `${name} — spectrum` }));
      const peak = dsp.dominantPeak(spectrum, { signal: values, fs });
      const box = (label, value) => {
        const b = el("div", "research-stat");
        b.append(el("span", "research-stat-label", label), el("span", "research-stat-value", value));
        return b;
      };
      // Interpolated, because a tone rarely lands on a bin centre and the
      // tallest bin alone under-reads it.
      readout.append(
        box("Dominant frequency", `${peak.frequency.toFixed(4)} Hz`),
        box("Amplitude", peak.amplitude.toFixed(4)),
        box("Resolution", `${(fs / dsp.nextPowerOfTwo(values.length)).toFixed(4)} Hz`),
      );
      say(`Dominant component at ${peak.frequency.toFixed(3)} Hz.`);
    }
  }

  const drawBtn = el("button", "button", "Compute");
  drawBtn.type = "button";
  drawBtn.addEventListener("click", draw);
  actions.append(drawBtn, saveFigureButton(figure,
    () => `${signal.stem}-${methodSelect.value.split(" ")[0].toLowerCase()}.png`, say));

  host.appendChild(await sourceControls((loaded) => { signal = loaded; draw(); }));
  host.append(work, status);
}

// ── Statistics ───────────────────────────────────────────────────────────────

async function mountStatistics(host, ctx) {
  if (!store.getActive()) { needProject(host, ctx, "Statistics"); return; }
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

  const box = card("Descriptive statistics");
  const grid = el("div", "research-stats");
  box.appendChild(grid);

  host.appendChild(await sourceControls((loaded) => {
    const stats = dsp.statistics(loaded.values);
    grid.textContent = "";
    if (!stats) { say("That column has no numeric values.", true); return; }
    const rows = [
      ["Samples", stats.count], ["Duration", `${(stats.count / loaded.fs).toFixed(3)} s`],
      ["Mean", stats.mean.toPrecision(6)], ["Std dev", stats.std.toPrecision(6)],
      ["RMS", stats.rms.toPrecision(6)], ["Min", stats.min.toPrecision(6)],
      ["Max", stats.max.toPrecision(6)], ["Peak to peak", stats.peakToPeak.toPrecision(6)],
    ];
    rows.forEach(([label, value]) => {
      const b = el("div", "research-stat");
      b.append(el("span", "research-stat-label", label),
        el("span", "research-stat-value", String(value)));
      grid.appendChild(b);
    });
    say(`${loaded.name}: ${stats.count} samples.`);
  }));
  host.append(box, status);
}

registerPage("Signal Processing", { mount: mountSignal });
registerPage("Spectral Analysis", { mount: mountSpectral });
registerPage("Statistics", { mount: mountStatistics });
