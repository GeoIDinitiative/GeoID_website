import { registerPage } from "../stages.js?v=20260820-5c0ad6f";
import * as store from "../project-store.js?v=20260820-5c0ad6f";
import { parseTable, columnPair, indexSeries } from "../table.js?v=20260820-5c0ad6f";
import { linePlot, toPngBlob } from "../plot.js?v=20260820-5c0ad6f";
import { needProject } from "./common.js?v=20260820-5c0ad6f";

/**
 * CSV Plotter: pick a file from the project, pick columns, plot, keep the
 * figure.
 *
 * Reads from the project rather than from an upload box, because by this point
 * the data is already in data/raw -- imported on the GIS page, pulled by the
 * Qt app, or copied in on the Repository page.
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

function selectOf(values, { includeIndex = false } = {}) {
  const node = document.createElement("select");
  node.className = "input";
  if (includeIndex) {
    const opt = document.createElement("option");
    opt.value = "__index__";
    opt.textContent = "(sample index)";
    node.appendChild(opt);
  }
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    node.appendChild(opt);
  });
  return node;
}

/** Every readable table in the project, wherever it happens to sit. */
async function findTables() {
  const roots = ["data/raw", "data/processed", "data/external", "data/pulled",
    "signals", "post_processing/extracted_dofs", "exports"];
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

async function mount(host, ctx) {
  const status = el("p", "research-status");
  const say = (m, bad) => { status.textContent = m; status.classList.toggle("is-error", !!bad); };

  if (!store.getActive()) { needProject(host, ctx, "CSV Plotter"); return; }

  let table = null;
  let currentPath = "";

  const sourceCard = card("Source");
  const files = await findTables();
  const fileSelect = selectOf(files);
  const loadBtn = el("button", "button", "Load");
  loadBtn.type = "button";
  const sourceRow = el("div", "gis-btn-row");
  sourceRow.append(fileSelect, loadBtn);
  sourceCard.appendChild(sourceRow);
  if (!files.length) {
    sourceCard.appendChild(el("p", "research-note",
      "No CSV-like files in this project yet. Import some on the Repository page "
      + "or export from the GIS page."));
    loadBtn.disabled = true;
  }

  const plotCard = card("Plot");
  const controls = el("div", "research-grid-2");
  const figure = el("div", "research-figure");
  const actions = el("div", "gis-btn-row");
  plotCard.append(controls, actions, figure);

  function drawPlot() {
    if (!table) return;
    const xName = controls.querySelector("[data-role=x]").value;
    const yNames = [...controls.querySelectorAll("[data-role=y] option")]
      .filter((o) => o.selected).map((o) => o.value);
    if (!yNames.length) { say("Pick at least one Y column.", true); return; }
    const series = yNames.map((yName) => {
      if (xName === "__index__") {
        const values = table.rows.map((r) => Number(r[table.columns.indexOf(yName)]));
        return { x: indexSeries(values.length), y: values, name: yName };
      }
      const { x, y } = columnPair(table, xName, yName);
      return { x, y, name: yName };
    });
    figure.textContent = "";
    figure.appendChild(linePlot(series, {
      labels: { x: xName === "__index__" ? "sample" : xName, y: yNames.join(", ") },
      title: currentPath.split("/").pop(),
    }));
    say(`Plotted ${series.reduce((n, s) => n + s.x.length, 0)} points.`);
  }

  function rebuildControls() {
    controls.textContent = "";
    actions.textContent = "";
    if (!table) return;
    const numericCols = table.columns.filter((_, i) => table.numeric[i]);
    const xSelect = selectOf(table.columns, { includeIndex: true });
    xSelect.dataset.role = "x";
    const ySelect = selectOf(numericCols.length ? numericCols : table.columns);
    ySelect.dataset.role = "y";
    ySelect.multiple = true;
    ySelect.size = Math.min(6, Math.max(3, numericCols.length));
    // A sensible first plot without any clicking: an index-or-time column on X,
    // and the first numeric column that is not already the X -- otherwise the
    // default plot is time against time, a diagonal line that says nothing.
    const timeLike = table.columns.find((c) => /time|date|sec|sample|index|t$/i.test(c));
    xSelect.value = timeLike || "__index__";
    // Cleared first: the select was built single before `multiple` was set, so
    // the browser had already selected option zero -- which is how "time" ended
    // up plotted against itself alongside the intended column.
    [...ySelect.options].forEach((o) => { o.selected = false; });
    const firstY = [...ySelect.options].find((o) => o.value !== xSelect.value)
      || ySelect.options[0];
    if (firstY) firstY.selected = true;

    controls.append(field("X", xSelect), field("Y (multi-select)", ySelect));

    const drawBtn = el("button", "button", "Plot");
    drawBtn.type = "button";
    drawBtn.addEventListener("click", drawPlot);
    const saveBtn = el("button", "button secondary", "Save to figures/");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", async () => {
      const canvas = figure.querySelector("canvas");
      if (!canvas) { say("Draw a plot first.", true); return; }
      try {
        const blob = await toPngBlob(canvas);
        const name = `${currentPath.split("/").pop().replace(/\.\w+$/, "")}-plot.png`;
        await store.writeProjectFile(`figures/${name}`, blob);
        await store.registerData({ name, kind: "figure", path: `figures/${name}`, source: "CSV Plotter" });
        say(`Saved figures/${name}.`);
      } catch (error) {
        say(error.message, true);
      }
    });
    actions.append(drawBtn, saveBtn);
  }

  loadBtn.addEventListener("click", async () => {
    currentPath = fileSelect.value;
    if (!currentPath) return;
    say(`Reading ${currentPath}…`);
    try {
      const text = await store.readProjectFile(currentPath);
      table = parseTable(typeof text === "string" ? text : "");
      if (!table.columns.length) { say("That file has no readable rows.", true); return; }
      rebuildControls();
      drawPlot();
      say(`${currentPath}: ${table.rows.length} rows, ${table.columns.length} columns.`);
    } catch (error) {
      say(error.message, true);
    }
  });

  host.append(sourceCard, plotCard, status);
}

registerPage("CSV Plotter", { mount });
