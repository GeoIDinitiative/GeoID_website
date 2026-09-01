import * as store from "../project-store.js?v=20260901-75f8089";
import { parseTable, column } from "../table.js?v=20260901-75f8089";
import { currentBody, currentBodyId } from "../../bodies.js?v=20260901-75f8089";

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

/**
 * A status line that survives `redraw()`.
 *
 * `redraw()` empties the host and mounts again, which builds a *brand new*
 * status node — so a handler's `say()` was writing to the detached old one and
 * the user saw nothing at all. Both orderings were broken, which is why every
 * Refresh, every Import Files and every Add appeared to do nothing while
 * quietly succeeding:
 *
 *   redraw(); say(msg)   — the message went to the node redraw had just orphaned
 *   say(msg); redraw()   — the message was written, then wiped by the remount
 *
 * So the message is written to whichever status node is *currently* on the page
 * and parked on the host as well. `host.textContent = ""` removes children but
 * not attributes, so the remount can restore it; keying it by page id stops one
 * page inheriting the previous page's last word.
 *
 * Lives here because all three mount paths need it — `qt-render`'s tree pages
 * are the majority, and fixing only `spec-page` left every one of them silent.
 */
export function persistentStatus(host, pageId) {
  const { node } = statusLine();
  const say = (message, isError) => {
    host.dataset.statusPage = pageId;
    host.dataset.statusText = message == null ? "" : String(message);
    host.dataset.statusError = isError ? "1" : "";
    // After a redraw the captured node is detached; the live one is the remount's.
    const live = node.isConnected
      ? node
      : ([...host.querySelectorAll(".research-status")].pop() || node);
    live.textContent = message;
    live.classList.toggle("is-error", Boolean(isError));
    // A hand-written page builds its own status node during its remount, which
    // is async and so does not exist yet at this point — the message would be
    // parked and never shown. Re-apply once that has settled, and only into a
    // node that is still empty, so a page's own message is never overwritten.
    if (!node.isConnected && message) {
      setTimeout(() => {
        if (host.dataset.statusPage !== pageId) return;
        const latest = [...host.querySelectorAll(".research-status")].pop();
        if (!latest || latest.textContent.trim()) return;
        latest.textContent = host.dataset.statusText;
        latest.classList.toggle("is-error", host.dataset.statusError === "1");
      }, 300);
    }
  };
  if (host.dataset.statusPage === pageId && host.dataset.statusText) {
    node.textContent = host.dataset.statusText;
    node.classList.toggle("is-error", host.dataset.statusError === "1");
  }
  return { node, say };
}

/**
 * What twenty-nine of the pages show when nothing is open.
 *
 * It used to say "No project open." and offer one button, which was true and
 * useless. Worse, when the folder picker was missing it blamed the browser --
 * and the usual cause is not the browser at all but the *origin*:
 * `showDirectoryPicker` needs a secure context, so `http://0.0.0.0:8125` has no
 * picker while `http://localhost:8125` does. Serving the same files from the
 * wrong host made every project-scoped page look broken with no way out.
 *
 * So this panel does three things instead of one: names the real obstacle,
 * offers browser storage as a way through it, and lets a project be *created*
 * here rather than sending you to another page to do it.
 */
export function needProject(host, ctx, title) {
  const box = card(title);
  const { node: status, say } = statusLine();
  const redraw = () => { host.textContent = ""; needProject(host, ctx, title); };

  if (store.getRoot()) {
    renderOpenOrCreate(box, ctx, say, redraw);
  } else {
    renderChooseStore(box, ctx, say, redraw);
  }
  box.appendChild(status);
  host.appendChild(box);
}

/** No store at all yet: on disk, or in the browser. */
function renderChooseStore(box, ctx, say, redraw) {
  const support = store.folderSupport();

  box.appendChild(el("p", "research-note",
    "Every Research page writes into a project. On disk that is a real folder "
    + "in the layout the desktop app reads, so work moves between them."));

  const actions = row();
  const choose = button("Choose projects folder…", async () => {
    try {
      await store.chooseRoot();
      redraw();
    } catch (error) {
      if (error.name !== "AbortError") say(error.message, true);
    }
  });
  choose.disabled = !support.ok;
  actions.appendChild(choose);

  // Browser storage is the way through when the folder cannot be had. Offered
  // second and described honestly -- it is not the folder.
  if (typeof indexedDB !== "undefined") {
    actions.appendChild(button("Keep projects in this browser", async () => {
      try {
        await store.useBrowserStorage();
        redraw();
      } catch (error) {
        say(error.message, true);
      }
    }, { secondary: support.ok }));
  }
  box.appendChild(actions);

  if (support.reason === "insecure-origin") {
    // The actionable one. Naming both origins matters: they differ by four
    // characters and the difference is the whole problem.
    box.appendChild(el("p", "research-note is-error",
      `The folder picker needs a secure origin, and this page is served from `
      + `${support.origin}. Open it at ${support.hint} instead — same server, `
      + `same files — or use browser storage below.`));
  } else if (support.reason === "unsupported-browser") {
    box.appendChild(el("p", "research-note is-error",
      "This browser has no folder picker — that is Chrome and Edge only. "
      + "Browser storage works everywhere."));
  }

  box.appendChild(el("p", "research-note",
    "Browser storage is real and survives a reload, but it lives in this "
    + "browser: the desktop app cannot see it, and clearing site data throws "
    + "it away. Export from the Projects page to move it onto disk."));
}

/** A store exists; open something in it or make something new. */
function renderOpenOrCreate(box, ctx, say, redraw) {
  const root = store.getRoot();
  box.appendChild(el("p", "research-note",
    `This page records into a project and none is open yet. Using `
    + `${root.kind === "indexeddb" ? "browser storage" : `"${root.name}"`}.`));

  const name = input("", `New ${currentBody()?.name || "Earth"} project`);
  const create = button("Create", async () => {
    if (!name.value.trim()) { say("Give the project a name first.", true); return; }
    try {
      // Stamped with the world in view, so it is filed under it.
      await store.createProject(name.value.trim(), { body: currentBodyId() });
      // The hub re-mounts the page when a project opens, so there is nothing
      // to redraw here -- this panel is about to be replaced by the page.
    } catch (error) {
      say(error.message, true);
    }
  });
  box.appendChild(row(name, create));

  const actions = row(button("Open an existing project",
    () => ctx.setPage?.("Projects"), { secondary: true }));
  if (root.kind === "indexeddb" && store.folderSupport().ok) {
    actions.appendChild(button("Switch to a folder on disk…", async () => {
      try { await store.chooseRoot(); redraw(); } catch (error) {
        if (error.name !== "AbortError") say(error.message, true);
      }
    }, { secondary: true }));
  }
  box.appendChild(actions);
}

export function guard(title, mount) {
  return async function guarded(host, ctx) {
    if (!store.getActive()) { needProject(host, ctx, title); return; }
    await mount(host, ctx);
  };
}

/** A page that is really an entry point to a tool that already exists. */
export function crossPage(title, { blurb, mode, note, section }) {
  mount.ownHeader = true;   // the hub must not add a second one
  async function mount(host, ctx) {
    // Carries the same header as a page that does its own work, so a hand-off
    // reads as a deliberate route to a tool rather than a page that failed to
    // load. The tool it names is the real one; there is no second copy here.
    host.appendChild(pageHeader(title, blurb));
    const box = card(mode === "model" ? "In the Meshing Studio" : "On the GIS page");
    if (note) box.appendChild(el("p", "research-note", note));
    box.appendChild(row(button(
      mode === "model" ? "Open the Meshing Studio" : "Open the GIS page",
      () => ctx.bridge?.goToPage?.(mode, section ? { openSection: section } : {}),
    )));
    host.appendChild(box);
  }
  return mount;
}

// ── Shared data helpers ──────────────────────────────────────────────────────

/** Tables anywhere in the project that a page might want to read. */
export async function findTables(roots = [
  "signals", "post_processing/extracted_dofs", "data/raw", "data/processed",
  "data/external", "data/pulled", "exports", "analysis",
]) {
  const found = [];
  // Walks into subfolders, which it used not to do — and that was a real dead
  // end twice over: a peaks tree is `data/raw/<dataset>/<station>/…`, and a live
  // pull writes `data/pulled/<domain>/…`, so a project could hold exactly the
  // table an analysis wanted and every page would call itself empty. Depth is
  // capped because these trees can be deep and a file picker listing hundreds of
  // paths is its own kind of useless.
  const MAX_DEPTH = 3;
  async function walk(dir, depth) {
    let entries = [];
    try { entries = await store.listProjectDir(dir); } catch (error) { return; }
    for (const entry of entries) {
      if (entry.kind === "file") {
        if (/\.(csv|tsv|txt|dat)$/i.test(entry.name)) found.push(`${dir}/${entry.name}`);
      } else if (entry.kind === "directory" && depth < MAX_DEPTH) {
        await walk(`${dir}/${entry.name}`, depth + 1);
      }
    }
  }
  for (const dir of roots) await walk(dir, 1);
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

// ── Qt page furniture ────────────────────────────────────────────────────────
//
// The Qt pages share one shape: a page title, a horizontal splitter, and inside
// each half a "Card" holding a secondary tab bar. Reproduced here as primitives
// rather than per page, so a page module is about its subject and every page
// comes out the same shape -- which is the whole point of matching the app.

/** app_qt.py — `title.setObjectName("PageTitle")`, top of every page. */
export function pageTitle(text) {
  return el("h1", "page-title", text);
}

/**
 * The Qt QSplitter. Stretch factors are the app's own (1 : 2), and the panes
 * stack on a narrow window rather than being squeezed to nothing.
 */
export function splitPanes(leftNode, rightNode, ratio = "1fr 2fr") {
  const box = el("div", "page-split");
  box.style.gridTemplateColumns = ratio;
  box.append(leftNode, rightNode);
  return box;
}

/**
 * Which tab each panel was last on, by heading.
 *
 * Pages re-mount for all sorts of reasons -- a project opens, a link is filed,
 * a value is captured -- and every one of those used to throw you back to the
 * first tab. Attaching a Sheet on the Sheets tab redrew the page on Docs, so
 * the thing you had just added was not on screen.
 */
const lastTab = new Map();

/** A `Card` with a heading and a secondary tab bar, which is what both halves
 *  of a Qt page are. `panels` maps tab label to a builder. */
export function tabbedPanel(heading, panels) {
  const box = el("section", "qt-card");
  box.appendChild(el("h2", "qt-card-heading", heading));
  const strip = el("div", "qt-tabs");
  const body = el("div", "qt-tab-body");
  // Every panel is built and kept in the DOM; the inactive ones are hidden.
  //
  // Rebuilding on each switch meant anything wanting to know what a page
  // contains had to CLICK through the tabs, and a tab whose handler does more
  // than switch views -- the Build New wizard's phase strip navigates -- then
  // fired that side effect. It rendered the wizard three times over. Nothing
  // needs to click now.
  const built = new Map();
  const show = (name) => {
    lastTab.set(heading, name);
    Array.from(strip.children).forEach((b) =>
      b.classList.toggle("is-active", b.dataset.tab === name));
    if (!built.has(name)) {
      const wrap = el("div", "qt-tab-panel");
      const made = panels[name]();
      if (made) wrap.appendChild(made);
      built.set(name, wrap);
      body.appendChild(wrap);
    }
    built.forEach((node, key) => { node.hidden = key !== name; });
  };
  Object.keys(panels).forEach((name) => {
    const btn = el("button", "qt-tab", name);
    btn.type = "button";
    btn.dataset.tab = name;
    btn.addEventListener("click", () => show(name));
    strip.appendChild(btn);
  });
  box.append(strip, body);
  const names = Object.keys(panels);
  const remembered = lastTab.get(heading);
  const start = names.includes(remembered) ? remembered : names[0];
  // Build them all, then reveal the one that should be showing.
  names.forEach(show);
  if (start) show(start);
  // Exposed so a caller can jump to a tab -- "Open Study Area Map" and friends
  // move between them.
  box.showTab = show;
  return box;
}

/** app_qt.py `_card(title)` — EditorCard: a titled section inside a tab. */
export function editorCard(title) {
  const box = el("div", "editor-card");
  if (title) box.appendChild(el("h3", "editor-card-title", title));
  return box;
}

/** The magenta hero block at the top of the Profile tab (EditorHero). */
export function editorHero() {
  return el("div", "editor-hero");
}

/** A grid of fields, `cols` across. The Qt forms are all 2- or 4-column grids. */
export function fieldGrid(cols, ...fields) {
  const box = el("div", "field-grid");
  box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  fields.forEach((f) => box.appendChild(f));
  return box;
}

/** A slider with its own percentage readout, as the Qt progress row has. */
export function slider(value, onInput) {
  const wrap = el("div", "slider-row");
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0"; input.max = "100";
  input.value = String(value ?? 0);
  input.className = "input slider-input";
  const readout = el("span", "slider-value", `${input.value}%`);
  input.addEventListener("input", () => {
    readout.textContent = `${input.value}%`;
    onInput?.(Number(input.value));
  });
  wrap.append(input, readout);
  wrap.input = input;
  return wrap;
}

/** An editable table with a header row, as the Milestones and Pipeline
 *  tables are. Returns the node plus a redraw bound to `rows`. */
export function editTable(headers, rows, render) {
  const table = el("div", "qt-table");
  table.style.gridTemplateColumns = `repeat(${headers.length}, minmax(0, 1fr))`;
  const draw = () => {
    table.textContent = "";
    headers.forEach((h) => table.appendChild(el("span", "qt-table-head", h)));
    rows.forEach((row, index) => render(table, row, index, draw));
  };
  draw();
  return { node: table, draw };
}

/**
 * `PageHeader(title, subtitle)` — the Qt header on most pages: what the page
 * is, and one line on what it is for. Optionally a right-aligned status pill
 * (`PillLabel`), which is where the app puts "No project".
 */
export function pageHeader(title, subtitle, pillText) {
  const box = el("header", "page-header");
  const left = el("div", "page-header-main");
  left.appendChild(el("h1", "page-title", title));
  if (subtitle) left.appendChild(el("p", "page-subtitle", subtitle));
  box.appendChild(left);
  if (pillText != null) {
    const chip = el("span", "page-pill", pillText);
    box.appendChild(chip);
    box.pill = chip;
  }
  return box;
}

/** A horizontal action bar under the header, as most Qt pages have. */
export function toolbar(...nodes) {
  const box = el("div", "page-toolbar");
  nodes.forEach((n) => n && box.appendChild(n));
  return box;
}

/** A small inline label inside a toolbar ("Tag:"). */
export function inlineLabel(text) {
  return el("span", "toolbar-label", text);
}

/**
 * `CollapsibleSection` — the Qt disclosure box. The app opens the section you
 * need and keeps the rest folded, which is what makes its dense pages readable;
 * reproducing the sections but not the folding would just be a long page.
 */
export function collapsible(title, { open = false } = {}) {
  const box = document.createElement("details");
  box.className = "qt-section";
  box.open = open;
  const head = document.createElement("summary");
  head.className = "qt-section-head";
  head.textContent = title;
  box.appendChild(head);
  const body = el("div", "qt-section-body");
  box.appendChild(body);
  box.body = body;
  return box;
}

/** A read-only table: headers plus rows of strings. */
export function dataTable(headers, rows) {
  const table = el("div", "qt-table is-readonly");
  table.style.gridTemplateColumns = `repeat(${headers.length}, minmax(0, 1fr))`;
  headers.forEach((h) => table.appendChild(el("span", "qt-table-head", h)));
  rows.forEach((cells) => cells.forEach((cell) => {
    const node = el("span", null, String(cell ?? ""));
    node.title = String(cell ?? "");
    table.appendChild(node);
  }));
  if (!rows.length) {
    // An empty table is its column headings, nothing more. The extra
    // "Nothing to show." row said the same thing the emptiness already does,
    // and two of them were most of why Post Processing did not fit.
    table.classList.add("is-empty");
  }
  return table;
}

/** A read-only console block, for previews and reports. */
export function console_(text, placeholder = "") {
  const box = el("pre", "qt-console", text || "");
  if (!text && placeholder) {
    box.classList.add("is-placeholder");
    box.textContent = placeholder;
  }
  return box;
}
