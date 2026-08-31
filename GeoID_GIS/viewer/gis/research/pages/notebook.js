import { registerPage } from "../stages.js?v=20260831-3fb0f7c";
import * as store from "../project-store.js?v=20260831-3fb0f7c";
import * as stats from "../stats.js?v=20260831-3fb0f7c";
import * as dsp from "../dsp.js?v=20260831-3fb0f7c";
import { column } from "../table.js?v=20260831-3fb0f7c";
import { linePlot } from "../plot.js?v=20260831-3fb0f7c";
import {
  el, button, row, statusLine, guard, pageHeader, toolbar, console_,
  findTables, loadTable, saveFigure,
} from "./common.js?v=20260831-3fb0f7c";

/**
 * Notebook — cells with live output, from `NotebookPage` (app_qt.py:20234).
 *
 * **It runs JavaScript, not Python.** The desktop notebook executes Python in
 * the app's own interpreter; a browser tab has no interpreter to lend it, and a
 * cell that accepted Python and silently did nothing would be worse than no
 * notebook. So the language is the one the page actually has, the header says
 * so, and `Load .py` brings a Python file in as text for reading and editing —
 * clearly marked as not executed here.
 *
 * What a cell gets is the project: `tables` (every table already parsed),
 * `stats`, `dsp`, `plot`, `store` and `project`. That is the part that made the
 * Qt notebook worth having, and it ports exactly.
 */

const NOTEBOOK = "metadata/notebook.json";

const emptyCell = () => ({ code: "", output: "", ok: null, ran_at: "" });

/** Everything the project holds, parsed once and handed to every cell. */
async function projectTables() {
  const paths = await findTables();
  const out = {};
  for (const path of paths) {
    try {
      const table = await loadTable(path);
      // Keyed by filename as well as full path: `tables["probes.csv"]` is what
      // anyone actually types.
      const short = path.split("/").pop();
      const view = {
        path, columns: table.columns, rows: table.rows,
        col: (name) => column(table, name).filter(Number.isFinite),
      };
      out[path] = view;
      if (!(short in out)) out[short] = view;
    } catch (error) { /* unreadable table, skip */ }
  }
  return out;
}

const mount = guard("Notebook", async (host, ctx) => {
  const { node: status, say } = statusLine();
  const doc = await store.readJson(NOTEBOOK, { cells: [] });
  doc.cells = Array.isArray(doc.cells) && doc.cells.length
    ? doc.cells
    : [{ ...emptyCell(), code: "// Every table in this project:\nObject.keys(tables)" }];
  const save = () => store.writeJson(NOTEBOOK, doc);
  const redraw = () => { host.textContent = ""; void mount(host, ctx); };

  const tables = await projectTables();
  const project = store.getActive();

  /**
   * Run one cell.
   *
   * `AsyncFunction` rather than eval: the cell's code is the user's own, and
   * this gives it exactly the bindings below and a real `await`, without
   * reaching into this module's scope. The last expression is the result, as in
   * the Qt notebook, so a bare expression prints.
   */
  async function runCell(cell) {
    const code = String(cell.code || "").trim();
    if (!code) { cell.output = ""; cell.ok = null; return; }
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    // A trailing expression is returned; a body with statements is not, so try
    // the expression form first and fall back.
    const bindings = ["tables", "stats", "dsp", "plot", "store", "project", "Math", "console"];
    const values = [tables, stats, dsp, { linePlot, saveFigure }, store, project, Math, console];
    // The Qt notebook prints the last expression. A cell with statements in it
    // cannot be wrapped whole in `return (...)`, so split the final line off
    // and return that -- "(no value)" for a cell that plainly computed
    // something was the first thing this got wrong.
    let fn;
    const build = (body) => new AsyncFunction(...bindings, body);
    const lines = code.split("\n");
    let lastAt = lines.length - 1;
    while (lastAt >= 0 && !lines[lastAt].trim()) lastAt -= 1;
    const last = (lines[lastAt] || "").trim();
    const isStatement = /^(const |let |var |function |class |return |if\b|for\b|while\b|await [a-z]+\.|throw |import |export |\/\/)/.test(last)
      || last.endsWith("{") || last.endsWith("}") || last.endsWith(";");
    try {
      fn = isStatement
        ? build(code)
        : build(`${lines.slice(0, lastAt).join("\n")}\nreturn (\n${last}\n);`);
    } catch (error) {
      try { fn = build(code); } catch (inner) {
        cell.ok = false;
        cell.output = `SyntaxError: ${inner.message}`;
        return;
      }
    }
    try {
      const result = await fn(...values);
      cell.ok = true;
      cell.output = result === undefined ? "(no value)"
        : typeof result === "string" ? result
        : JSON.stringify(result, (k, v) =>
          (ArrayBuffer.isView(v) ? Array.from(v).slice(0, 40) : v), 2)?.slice(0, 4000)
          ?? String(result);
    } catch (error) {
      cell.ok = false;
      cell.output = `${error.name}: ${error.message}`;
    }
    cell.ran_at = new Date().toISOString();
  }

  host.appendChild(pageHeader("Notebook",
    "Interactive cells with live output. This one runs JavaScript — the "
    + "desktop notebook runs Python in the app's interpreter, and a browser tab "
    + "has none to lend it.",
    `${doc.cells.length} cell(s)`));

  host.appendChild(toolbar(
    button("+ Cell", async () => { doc.cells.push(emptyCell()); await save(); redraw(); }),
    button("Run All", async () => {
      for (const cell of doc.cells) await runCell(cell);
      await save();
      const failed = doc.cells.filter((c) => c.ok === false).length;
      say(failed ? `${failed} of ${doc.cells.length} cell(s) failed.`
        : `${doc.cells.length} cell(s) ran.`);
      redraw();
    }, { secondary: true }),
    button("Clear Outputs", async () => {
      doc.cells.forEach((c) => { c.output = ""; c.ok = null; });
      await save(); redraw();
    }, { secondary: true }),
    button("Save", async () => {
      await save();
      say(`${doc.cells.length} cell(s) saved to ${NOTEBOOK}.`);
    }, { secondary: true }),
    button("Load .py", async () => {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = ".py,.js,.txt";
      const file = await new Promise((resolve) => {
        picker.addEventListener("change", () => resolve(picker.files?.[0] || null));
        picker.click();
      });
      if (!file) return;
      const text = await file.text();
      const python = /\.py$/i.test(file.name);
      doc.cells.push({
        ...emptyCell(),
        code: python
          ? `/* ${file.name} — Python, kept for reference. This notebook runs\n`
            + `   JavaScript, so this is not executed here; the desktop app's\n`
            + `   notebook will run it. */\n/*\n${text.slice(0, 4000)}\n*/`
          : text,
      });
      await save();
      say(python
        ? `${file.name} loaded as a comment — Python does not run here.`
        : `${file.name} loaded into a new cell.`);
      redraw();
    }, { secondary: true }),
  ));

  host.appendChild(el("p", "research-note",
    "In scope: tables (every table in the project, parsed — try "
    + "Object.keys(tables)), stats, dsp, plot.linePlot, store, project. The "
    + "last expression is the cell's result."));

  doc.cells.forEach((cell, index) => {
    const box = el("div", "nb-cell");
    const head = el("div", "nb-cell-head");
    head.appendChild(el("span", "nb-cell-index", `[${index + 1}]`));
    const runOne = button("▶ Run", async () => {
      cell.code = editor.value;
      await runCell(cell);
      await save();
      redraw();
    });
    runOne.classList.add("small");
    const drop = button("Remove", async () => {
      doc.cells.splice(index, 1);
      if (!doc.cells.length) doc.cells.push(emptyCell());
      await save(); redraw();
    }, { secondary: true });
    drop.classList.add("small");
    head.append(runOne, drop);
    box.appendChild(head);

    const editor = document.createElement("textarea");
    editor.className = "input research-editor nb-editor";
    editor.rows = Math.min(14, Math.max(3, String(cell.code || "").split("\n").length + 1));
    editor.value = cell.code || "";
    editor.spellcheck = false;
    editor.addEventListener("input", () => { cell.code = editor.value; });
    // Ctrl/Cmd+Enter runs the cell, which is the one shortcut every notebook has.
    editor.addEventListener("keydown", async (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        cell.code = editor.value;
        await runCell(cell);
        await save();
        redraw();
      }
    });
    box.appendChild(editor);

    if (cell.output) {
      const out = console_(cell.output);
      out.classList.add("nb-output");
      out.classList.toggle("is-error", cell.ok === false);
      box.appendChild(out);
    }
    host.appendChild(box);
  });

  host.appendChild(status);
});

mount.ownHeader = true;
mount.specComplete = true;
registerPage("Notebook", { mount });
