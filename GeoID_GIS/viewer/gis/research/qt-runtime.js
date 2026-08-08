import * as store from "./project-store.js?v=20260808-c6293c4";
import * as stats from "./stats.js?v=20260808-c6293c4";
import * as dsp from "./dsp.js?v=20260808-c6293c4";
import { parseTable, column } from "./table.js?v=20260808-c6293c4";
import { linePlot, heatmap } from "./plot.js?v=20260808-c6293c4";
import { el, findTables, saveFigure } from "./pages/common.js?v=20260808-c6293c4";

/**
 * The parts of a page the app builds while it runs.
 *
 * `qt-layout.py` recovers what `__init__` lays out, which is most of a page but
 * not all of it: CSV Plotter's dataset cards, MapPage's per-layer rows and
 * Signal Processing's series boxes are all built on demand, from a method, in
 * response to a click. A static layout tree cannot contain them — there is
 * nothing in the source to read until the click happens.
 *
 * So they are written here instead, against the same controls the tree already
 * rendered. `install(pageId, host, api)` runs after the tree is on the page and
 * wires the buttons that create things.
 *
 * The rule these follow: build the same widgets, in the same order, into the
 * same container the Qt method uses, and write to the same files. A row that
 * looks right but registers its dataset somewhere else is worse than no row.
 */

/** The Qt page's log pane, which every one of these reports into. */
function logger(api) {
  return (line) => {
    const log = api.controls.get("log");
    if (log) log.value = log.value ? `${log.value}\n${line}` : line;
    api.say(line);
  };
}

function selectOf(items, value) {
  const node = document.createElement("select");
  node.className = "input qt-select";
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = String(item);
    option.textContent = String(item);
    node.appendChild(option);
  });
  if (value !== undefined) node.value = String(value);
  return node;
}

function textInput(placeholder) {
  const node = document.createElement("input");
  node.className = "input qt-input";
  node.type = "text";
  node.placeholder = placeholder || "";
  return node;
}

function smallButton(label, onClick) {
  const node = el("button", "button secondary qt-button small", label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

/** Read a table out of the project, or off disk if it was picked locally. */
async function readTable(row) {
  if (row.file) return parseTable(await row.file.text());
  const text = await store.readProjectFile(row.path.value.trim());
  return parseTable(typeof text === "string" ? text : "");
}

/* ── CSV Plotter ──────────────────────────────────────────────────────────
 *
 * `GeoIDPlotPage._build_dataset_card` (app_qt.py:7597) and `plot_csv` (:7750).
 * One card per dataset, each with its own plot type and column mapping, and
 * one figure drawn from every card that is ticked.
 */

const PLOT_TYPES = ["line", "scatter", "bar", "hist", "spectrogram", "power-density"];

function csvPlotter(host, api) {
  const say = logger(api);
  const scroll = host.querySelector(".qt-scroll");
  if (!scroll) return;
  // The tree renders the scroll area's rows_widget with its trailing stretch;
  // cards go before it, exactly as `add_dataset_row` does. Find the stretch
  // first and take *its* parent -- the rows widget nests a level below the
  // scroll area's own layout, so the first `.qt-v` is the wrong box and
  // insertBefore threw on a node that was not its child.
  const stretch = scroll.querySelector(".qt-stretch");
  const container = stretch ? stretch.parentElement
    : (scroll.querySelector(".qt-v") || scroll);
  const rows = [];
  let lastFigure = null;

  function addRow() {
    const card = el("div", "qt-card-row");
    const select = document.createElement("input");
    select.type = "checkbox";
    select.checked = true;
    const path = textInput("Dataset path (csv/txt/json/tif...)");
    path.style.flex = "2 1 auto";
    const plotType = selectOf(PLOT_TYPES, "line");
    const xCol = selectOf([]);
    const yCol = selectOf([]);
    const zCol = selectOf(["(optional)"]);
    const tag = selectOf(["test", "queued", "main"], "test");
    const row = { card, select, path, plotType, xCol, yCol, zCol, tag, file: null };

    const browse = smallButton("Browse", async () => {
      // A project file if there is a project, a local file otherwise -- the Qt
      // page opens a file dialog, and this is the nearest honest equivalent.
      const tables = store.getActive() ? await findTables() : [];
      if (tables.length) {
        const pick = await chooseFrom(card, tables);
        if (pick) { path.value = pick; row.file = null; }
        return;
      }
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = ".csv,.txt,.tsv,.json";
      const file = await new Promise((resolve) => {
        picker.addEventListener("change", () => resolve(picker.files?.[0] || null));
        picker.click();
      });
      if (file) { row.file = file; path.value = file.name; }
    });

    const loadCols = smallButton("Load Columns", async () => {
      let table;
      try { table = await readTable(row); }
      catch (error) { say(`[plot] file not found: ${path.value}`); return; }
      const cols = table.columns || [];
      [xCol, yCol].forEach((c) => { c.textContent = ""; });
      zCol.textContent = "";
      zCol.appendChild(new Option("(optional)", "(optional)"));
      if (!cols.length) { say(`[plot] no columns detected for ${path.value}`); return; }
      cols.forEach((name) => {
        xCol.appendChild(new Option(name, name));
        yCol.appendChild(new Option(name, name));
        zCol.appendChild(new Option(name, name));
      });
      // Qt selects the second column for Y, which is what a two-column series
      // almost always wants.
      if (cols.length > 1) yCol.selectedIndex = 1;
      // The tag the registry already holds for this file wins over the default.
      try {
        const entry = (await store.listData())
          .find((item) => item.path === path.value.trim());
        if (entry && ["test", "queued", "main"].includes(entry.tag)) tag.value = entry.tag;
      } catch (error) { /* no registry yet */ }
      say(`[plot] loaded columns for ${path.value}: ${cols.join(", ")}`);
    });

    const remove = smallButton("Remove", () => {
      const at = rows.indexOf(row);
      if (at >= 0) rows.splice(at, 1);
      card.remove();
    });

    card.append(select, path, browse,
      el("span", "qt-label", "Plot"), plotType,
      el("span", "qt-label", "X"), xCol,
      el("span", "qt-label", "Y"), yCol,
      el("span", "qt-label", "Z"), zCol,
      el("span", "qt-label", "Tag"), tag,
      loadCols, remove);
    if (stretch) container.insertBefore(card, stretch);
    else container.appendChild(card);
    rows.push(row);
    return row;
  }

  /** Pick one of the project's tables, inline rather than in a dialog. */
  function chooseFrom(anchor, options) {
    return new Promise((resolve) => {
      const menu = el("div", "qt-inline-menu");
      options.forEach((option) => {
        const item = el("button", "qt-inline-item", option);
        item.type = "button";
        item.addEventListener("click", () => { menu.remove(); resolve(option); });
        menu.appendChild(item);
      });
      const cancel = el("button", "qt-inline-item is-cancel", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", () => { menu.remove(); resolve(null); });
      menu.appendChild(cancel);
      anchor.appendChild(menu);
    });
  }

  /**
   * The sampling rate the x column implies.
   *
   * Qt passes `Fs=1.0` because it has no idea what the x axis is; here the x
   * column was chosen deliberately, so an evenly-spaced one gives a real rate
   * and the frequency axis means something. Falls back to 1 when it does not.
   */
  function samplingOf(table, xName) {
    const xs = column(table, xName).filter(Number.isFinite);
    if (xs.length < 3) return 1;
    const step = (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
    return step > 0 ? 1 / step : 1;
  }

  /** The x/y pair a row asks for, numeric rows only, as `_extract_xy` does. */
  function pairOf(table, xName, yName) {
    const xs = column(table, xName);
    const ys = column(table, yName);
    const outX = [];
    const outY = [];
    for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
        outX.push(xs[i]); outY.push(ys[i]);
      }
    }
    return [outX, outY];
  }

  async function plotSelected() {
    const active = rows.filter((r) => r.select.checked);
    if (!active.length) { say("[plot] select at least one dataset row."); return; }
    const series = [];
    let spectro = null;
    for (const row of active) {
      const xName = row.xCol.value;
      const yName = row.yCol.value;
      if (!xName || !yName) continue;
      let table;
      try { table = await readTable(row); } catch (error) { continue; }
      const [xs, ys] = pairOf(table, xName, yName);
      if (!xs.length) continue;
      const name = `${row.path.value.split("/").pop()}:${yName}`;
      const mode = row.plotType.value;

      if (mode === "hist") {
        // A distribution, so the x axis stops being the x column. `histogram`
        // returns bin edges; a bar is drawn at the centre of its bin.
        const h = stats.histogram(ys, 40);
        const centres = h.counts.map((_, i) => (h.edges[i] + h.edges[i + 1]) / 2);
        series.push({ name: `${name} (hist)`, x: centres, y: h.counts, mode: "bar" });
      } else if (mode === "power-density") {
        // fs is positional, and the density comes back as `psd`.
        const spec = dsp.welch(ys, samplingOf(table, xName), { segment: 256 });
        series.push({ name: `${name}:psd`, x: Array.from(spec.freqs),
                      y: Array.from(spec.psd) });
      } else if (mode === "spectrogram") {
        spectro = { spec: dsp.spectrogram(ys, samplingOf(table, xName)), name };
      } else {
        series.push({ name, x: xs, y: ys, mode: mode === "scatter" ? "scatter" : "line" });
      }

      if (store.getActive() && !row.file) {
        try {
          await store.registerData({
            path: row.path.value.trim(), tag: row.tag.value,
            source_stage: "Preprocessing Plotter",
          });
        } catch (error) { /* annotating must never fail the plot */ }
      }
    }

    if (!series.length && !spectro) { say("[plot] no numeric data plotted."); return; }
    const title = (api.controls.get("plot_title")?.value || "").trim();
    const canvas = spectro
      ? heatmap(spectro.spec.grid, {
          width: 880, height: 380,
          title: title || `Spectrogram: ${spectro.name}`,
          xRange: [spectro.spec.times[0] || 0,
                   spectro.spec.times[spectro.spec.times.length - 1] || 1],
          yRange: [spectro.spec.freqs[0] || 0,
                   spectro.spec.freqs[spectro.spec.freqs.length - 1] || 1],
          labels: { x: "Time", y: "Frequency" },
        })
      : linePlot(series, { width: 880, height: 380, title });

    let figure = host.querySelector(".qt-figure");
    if (!figure) {
      figure = el("div", "qt-figure");
      (host.querySelector(".qt-scroll") || host).insertAdjacentElement("afterend", figure);
    }
    figure.textContent = "";
    figure.appendChild(canvas);

    if (store.getActive()) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
      try {
        lastFigure = await saveFigure(canvas, `preprocessing_plot_${stamp}.png`,
                                      "Preprocessing Plotter export");
        say(`[plot] saved: ${lastFigure}`);
      } catch (error) { say(`[plot] could not save: ${error.message}`); }
    } else {
      say("[plot] drawn. Open a project to save it into figures/.");
    }
  }

  async function preview() {
    const row = rows.find((r) => r.select.checked);
    if (!row) { say("[plot] no selected row."); return; }
    let table;
    try { table = await readTable(row); }
    catch (error) { say("[plot] file not found."); return; }
    const lines = [
      `path: ${row.path.value}`,
      `columns: ${(table.columns || []).join(", ") || "-"}`,
      "sample:",
      ...table.rows.slice(0, 12).map((r) => JSON.stringify(r).slice(0, 400)),
    ];
    say(lines.join("\n"));
  }

  async function sendToStoryboard() {
    if (!lastFigure) { say("[plot] no exported figure available yet."); return; }
    try {
      const board = await store.readJson("metadata/storyboard.json", { assets: [] });
      board.assets = board.assets || [];
      board.assets.push({ path: lastFigure, title: lastFigure.split("/").pop(),
                          added_at: new Date().toISOString() });
      await store.writeJson("metadata/storyboard.json", board);
      say(`[plot] sent to StoryBoard: ${lastFigure}`);
    } catch (error) { say(`[plot] could not reach the StoryBoard: ${error.message}`); }
  }

  bind(host, "+ Add Dataset", addRow);
  bind(host, "Plot Selected", plotSelected);
  bind(host, "Preview", preview);
  bind(host, "Send to StoryBoard", sendToStoryboard);
  addRow();   // the Qt page opens with one row
}

/** Give a tree-rendered button a handler, replacing whatever it had. */
function bind(host, label, handler) {
  Array.from(host.querySelectorAll("button")).forEach((node) => {
    if ((node.textContent || "").trim() !== label) return;
    const fresh = node.cloneNode(true);
    fresh.disabled = false;
    fresh.classList.remove("is-unwired");
    fresh.removeAttribute("title");
    fresh.addEventListener("click", async () => {
      try { await handler(); } catch (error) { console.error(error); }
    });
    node.replaceWith(fresh);
  });
}

export const RUNTIME = {
  "CSV Plotter": csvPlotter,
};

export function install(pageId, host, api) {
  const fn = RUNTIME[pageId];
  if (!fn) return;
  try { fn(host, api); }
  catch (error) {
    console.error(`runtime for "${pageId}" failed`, error);
  }
}
