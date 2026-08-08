import * as store from "../project-store.js?v=20260810s";
import { parseTable, column } from "../table.js?v=20260810s";

/**
 * The furniture every Research page uses.
 *
 * Extracted once the sixth page had its own copy of `el` and `card`. Nothing
 * here is clever; it exists so a page module is about its subject rather than
 * about building a form.
 */

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function card(title) {
  const box = el("section", "research-card");
  if (title) box.appendChild(el("h2", "research-card-title", title));
  return box;
}

export function field(label, node) {
  const row = el("label", "research-field");
  row.appendChild(el("span", "research-field-label", label));
  row.appendChild(node);
  return row;
}

export function input(value, placeholder = "", type = "text") {
  const node = document.createElement("input");
  node.className = "input";
  node.type = type;
  if (type === "number") node.step = "any";
  node.value = value ?? "";
  if (placeholder) node.placeholder = placeholder;
  return node;
}

export function textarea(value, rows = 10, placeholder = "") {
  const node = document.createElement("textarea");
  node.className = "input research-editor";
  node.rows = rows;
  node.value = value ?? "";
  if (placeholder) node.placeholder = placeholder;
  return node;
}

export function selectOf(values, selected) {
  const node = document.createElement("select");
  node.className = "input";
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = String(v); opt.textContent = String(v);
    node.appendChild(opt);
  });
  if (selected != null) node.value = String(selected);
  return node;
}

export function button(label, onClick, { secondary = false } = {}) {
  const node = el("button", secondary ? "button secondary" : "button", label);
  node.type = "button";
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

export function row(...nodes) {
  const box = el("div", "gis-btn-row");
  nodes.forEach((n) => box.appendChild(n));
  return box;
}

export function stat(label, value) {
  const box = el("div", "research-stat");
  box.append(el("span", "research-stat-label", label),
    el("span", "research-stat-value", String(value)));
  return box;
}

export function statGrid(pairs) {
  const grid = el("div", "research-stats");
  pairs.forEach(([label, value]) => grid.appendChild(stat(label, value)));
  return grid;
}

/** A status line plus the function that writes to it. */
export function statusLine() {
  const node = el("p", "research-status");
  const say = (message, isError) => {
    node.textContent = message;
    node.classList.toggle("is-error", Boolean(isError));
  };
  return { node, say };
}

/** Every page needs a project; this is the same refusal in one place. */
export function needProject(host, ctx, title) {
  const box = card(title);
  box.appendChild(el("p", "research-note", "No project open."));
  box.appendChild(row(button("Go to Projects", () => ctx.setPage?.("Projects"))));
  host.appendChild(box);
}

export function guard(title, mount) {
  return async function guarded(host, ctx) {
    if (!store.getActive()) { needProject(host, ctx, title); return; }
    await mount(host, ctx);
  };
}

/** A page that is really an entry point to a tool that already exists. */
export function crossPage(title, { blurb, mode, note, section }) {
  return async function mount(host, ctx) {
    const box = card(title);
    box.appendChild(el("p", "research-note", blurb));
    if (note) box.appendChild(el("p", "research-note", note));
    box.appendChild(row(button(
      mode === "model" ? "Open the Meshing Studio" : "Open the GIS page",
      () => ctx.bridge?.goToPage?.(mode, section ? { openSection: section } : {}),
    )));
    host.appendChild(box);
  };
}

// ── Shared data helpers ──────────────────────────────────────────────────────

/** Tables anywhere in the project that a page might want to read. */
export async function findTables(roots = [
  "signals", "post_processing/extracted_dofs", "data/raw", "data/processed",
  "data/external", "data/pulled", "exports", "analysis",
]) {
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

export async function loadTable(path) {
  const text = await store.readProjectFile(path);
  return parseTable(typeof text === "string" ? text : "");
}

/** The sampling rate a table implies, from whichever column looks like time. */
export function inferSampling(table) {
  const name = table.columns.find((c) => /^(t|time|secs?|seconds|timestamp)$/i.test(c));
  if (!name) return { fs: null, timeColumn: null };
  const times = column(table, name).filter(Number.isFinite);
  const steps = [];
  for (let i = 1; i < Math.min(times.length, 400); i += 1) steps.push(times[i] - times[i - 1]);
  steps.sort((a, b) => a - b);
  const dt = steps[Math.floor(steps.length / 2)];
  return { fs: dt > 0 ? 1 / dt : null, timeColumn: name };
}

/** A file/column picker over the project, used by most analysis pages. */
export async function seriesPicker(onLoad, { label = "Load" } = {}) {
  const box = card("Series");
  const files = await findTables();
  const fileSelect = selectOf(files.length ? files : ["(no tables in this project)"]);
  const columnSelect = selectOf([]);
  const fsInput = input(1, "", "number");
  const note = el("p", "research-note", "");
  let table = null;

  async function read() {
    if (!files.length) return;
    table = await loadTable(fileSelect.value);
    const numeric = table.columns.filter((_, i) => table.numeric[i]);
    columnSelect.innerHTML = "";
    numeric.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name;
      columnSelect.appendChild(opt);
    });
    const { fs, timeColumn } = inferSampling(table);
    if (fs) {
      fsInput.value = String(+fs.toFixed(6));
      note.textContent = `${fs.toFixed(4)} Hz inferred from "${timeColumn}".`;
      const at = [...columnSelect.options].findIndex((o) => o.value === timeColumn);
      if (at >= 0) columnSelect.remove(at);
    } else {
      note.textContent = "No time column — set the sampling rate by hand.";
    }
  }

  fileSelect.addEventListener("change", () => { void read(); });
  const load = button(label, async () => {
    if (!table) await read();
    if (!table) return;
    onLoad({
      table,
      values: column(table, columnSelect.value).filter(Number.isFinite),
      fs: Number(fsInput.value) || 1,
      path: fileSelect.value,
      columnName: columnSelect.value,
      name: `${fileSelect.value.split("/").pop()} · ${columnSelect.value}`,
      stem: `${fileSelect.value.split("/").pop().replace(/\.\w+$/, "")}-${columnSelect.value}`,
    });
  });

  const grid = el("div", "research-grid-2");
  grid.append(field("File", fileSelect), field("Column", columnSelect),
    field("Sampling rate (Hz)", fsInput));
  box.append(grid, row(load), note);
  if (!files.length) {
    box.appendChild(el("p", "research-note",
      "Nothing to read yet — import data, or extract a DOF series on the Post "
      + "Processing page."));
    load.disabled = true;
  } else {
    await read();
  }
  return box;
}

/** Save a canvas into figures/ and register it. */
export async function saveFigure(canvas, name, source) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  await store.writeProjectFile(`figures/${name}`, blob);
  await store.registerData({ name, kind: "figure", path: `figures/${name}`, source });
  return `figures/${name}`;
}

/** Write a table into the project and register it. */
export async function saveTable(relPath, header, rows, source, kind = "series") {
  const text = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
  await store.writeProjectFile(relPath, text);
  const name = relPath.split("/").pop();
  await store.registerData({ name, kind, path: relPath, source });
  return relPath;
}
