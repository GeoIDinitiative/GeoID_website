import * as store from "./project-store.js?v=20260809-95d7b49";
import { el, button, row, statusLine } from "./pages/common.js?v=20260809-95d7b49";
import * as sidecar from "./sidecar.js?v=20260809-95d7b49";

/**
 * The five shell actions from the Qt Research Hub's WorkspaceShell row
 * (app_qt.py:3717 onward): Jobs, Alerts, + New Note, Copilot, Data Shelf.
 *
 * In Qt each is a checkable button toggling a panel below the page. Same here,
 * except one drawer is open at a time -- the panel is a strip at the foot of a
 * page that is already dense, and two of them stacked left nothing to read.
 *
 * They report the project's own files rather than a separate in-memory idea of
 * what is happening, so what a drawer says survives a reload and matches what
 * the desktop app would see in the same folder.
 */

let open = null;

export function currentDrawer() {
  return open;
}

function host() {
  return document.getElementById("research-drawer");
}

function announce() {
  document.dispatchEvent(new CustomEvent("geoid:drawer-changed", { detail: open }));
}

export function closeDrawer() {
  const node = host();
  if (node) { node.hidden = true; node.textContent = ""; }
  open = null;
  announce();
}

function head(title, blurb) {
  const wrap = el("div", "shell-drawer-head");
  wrap.appendChild(el("h3", "shell-drawer-title", title));
  if (blurb) wrap.appendChild(el("p", "research-note", blurb));
  const close = button("Close", closeDrawer, { secondary: true });
  close.classList.add("small");
  wrap.appendChild(close);
  return wrap;
}

function noProject(node, what) {
  node.appendChild(el("p", "research-note",
    `No project open, so there is no ${what} to show. Open one from the folder `
    + "button in the sidebar."));
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

/**
 * The browser cannot run a solver, so a "job" here is an FEM run folder: a spec
 * waiting to be executed, or one with results beside it. That is the real state
 * of the work, and it is the same state the desktop solver reads.
 */
async function mountJobs(node) {
  node.appendChild(head("Jobs",
    "Live processes on the sidecar, and FEM runs in this project. A spec is "
    + "written here; the solver runs on the sidecar and writes results back."));

  // Live jobs first, when the sidecar is connected -- these are real running
  // processes, newest at the top, each following its own log if opened.
  if (sidecar.isConnected()) {
    const live = el("div", "research-list");
    let jobs = [];
    try { jobs = await sidecar.listJobs(); } catch (error) { /* sidecar dropped */ }
    jobs.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
    if (!jobs.length) {
      live.appendChild(el("p", "research-note", "No sidecar jobs yet."));
    }
    jobs.slice(0, 12).forEach((job) => {
      const line = el("div", "research-list-row");
      line.appendChild(el("span", "research-list-name", job.label || job.kind));
      const tag = el("span", `research-list-tag is-${job.status}`, job.status);
      line.appendChild(tag);
      if (job.status === "running" || job.status === "starting") {
        const stop = button("Stop", async () => {
          await sidecar.stopJob(job.id).catch(() => {});
          tag.textContent = "stopping";
        }, { secondary: true });
        stop.classList.add("small");
        line.appendChild(stop);
      }
      live.appendChild(line);
    });
    node.appendChild(el("h4", "shelf-col-title", "Sidecar jobs"));
    node.appendChild(live);
  }

  if (!store.getActive()) return;
  node.appendChild(el("h4", "shelf-col-title", "FEM runs"));

  const list = el("div", "research-list");
  let runs = [];
  try { runs = await store.listProjectDir("fem_runs"); } catch (error) { /* none */ }
  const dirs = runs.filter((e) => e.kind === "directory");
  if (!dirs.length) {
    list.appendChild(el("p", "research-note",
      "No runs yet. FEM ▸ Setup creates one."));
  }
  for (const entry of dirs) {
    const line = el("div", "research-list-row");
    line.appendChild(el("span", "research-list-name", entry.name));
    const spec = await store.readJson(`fem_runs/${entry.name}/spec.json`, null);
    let files = [];
    try { files = await store.listProjectDir(`fem_runs/${entry.name}`); } catch (e) { /* none */ }
    const hasResults = files.some((f) => f.name !== "spec.json");
    line.appendChild(el("span", "research-list-tag",
      !spec ? "no spec" : hasResults ? "results" : "queued"));
    list.appendChild(line);
  }
  node.appendChild(list);
  return;
}

// ── Alerts ───────────────────────────────────────────────────────────────────

/**
 * What has changed in the project lately, read from the data registry rather
 * than from a notification queue -- a queue would be empty on every reload and
 * would tell you nothing about work done in the desktop app.
 */
async function mountAlerts(node) {
  node.appendChild(head("Alerts",
    "Recent activity in this project, newest first, from the data registry "
    + "every import and export writes to."));
  if (!store.getActive()) return noProject(node, "activity");

  const entries = (await store.listData()) || [];
  const recent = entries.slice().reverse().slice(0, 20);
  const list = el("div", "research-list");
  if (!recent.length) {
    list.appendChild(el("p", "research-note", "Nothing recorded yet."));
  }
  recent.forEach((entry) => {
    const line = el("div", "research-list-row");
    line.appendChild(el("span", "research-list-name",
      `${entry.source || "import"} — ${entry.path || entry.name || "?"}`));
    line.appendChild(el("span", "research-list-tag",
      (entry.added_at || entry.at || "").slice(0, 16).replace("T", " ")));
    list.appendChild(line);
  });
  node.appendChild(list);
}

// ── + New Note ───────────────────────────────────────────────────────────────

/**
 * Deliberately a scratch box rather than the Notes page in miniature: this is
 * for the thought you have while looking at a plot, and it appends to one dated
 * file so it never interrupts what is on screen.
 */
async function mountNotes(node) {
  node.appendChild(head("New note",
    "Appended to notes/journal-<today>.md, so a thought had mid-analysis lands "
    + "somewhere the Notes page can find it."));
  if (!store.getActive()) return noProject(node, "notebook");

  const { node: status, say } = statusLine();
  const box = document.createElement("textarea");
  box.className = "input";
  box.rows = 3;
  box.placeholder = "What just happened, and what it means…";
  const file = `notes/journal-${new Date().toISOString().slice(0, 10)}.md`;
  node.append(box, row(button("Save note", async () => {
    const text = box.value.trim();
    if (!text) { say("Nothing to save.", true); return; }
    let existing = "";
    try { existing = await store.readProjectFile(file); } catch (error) { /* new */ }
    const stamp = new Date().toISOString().slice(11, 16);
    const header = existing ? "" : `# Journal ${file.slice(14, 24)}\n\n`;
    await store.writeProjectFile(file, `${existing}${header}## ${stamp}\n\n${text}\n\n`);
    box.value = "";
    say(`Appended to ${file}.`);
  })), status);
}

// ── Copilot ──────────────────────────────────────────────────────────────────

/**
 * Stated plainly rather than mocked up. The Qt Copilot talks to the Atlas hub
 * over HTTP; a static page served from geoidinitiative.com has no hub to talk
 * to, and a chat box that cannot answer is worse than an absent one.
 */
function mountCopilot(node) {
  node.appendChild(head("Copilot", null));
  node.appendChild(el("p", "research-note",
    "The Copilot runs in the Atlas hub, not in the browser: it needs a service "
    + "that can read the project folder and call a model. This page has no hub "
    + "to reach, so it is not wired here — use the Copilot in the desktop app, "
    + "which reads the same project folder."));
}

// ── Data Shelf ───────────────────────────────────────────────────────────────

/** Everything the project holds, gathered from the folders that hold it. */
async function mountShelf(node) {
  node.appendChild(head("Data Shelf",
    "What this project holds on disk. Registered imports first, then the "
    + "folders the pipeline writes to."));
  if (!store.getActive()) return noProject(node, "shelf");

  const registered = (await store.listData()) || [];
  const grid = el("div", "shelf-grid");

  const reg = el("div", "shelf-col");
  reg.appendChild(el("h4", "shelf-col-title", `Registered (${registered.length})`));
  if (!registered.length) {
    reg.appendChild(el("p", "research-note", "Nothing registered yet."));
  }
  registered.slice(-12).reverse().forEach((entry) => {
    reg.appendChild(el("div", "shelf-item", entry.path || entry.name || "?"));
  });
  grid.appendChild(reg);

  const FOLDERS = [
    ["data/raw", "as imported"],
    ["data/processed", "after transforms"],
    ["meshes", "geometry and meshes"],
    ["fem_runs", "run specs and results"],
    ["post_processing/extracted_dofs", "probe time series"],
    ["exports", "what has left the project"],
  ];
  for (const [path, blurb] of FOLDERS) {
    let entries = [];
    try { entries = await store.listProjectDir(path); } catch (error) { /* absent */ }
    const col = el("div", "shelf-col");
    col.appendChild(el("h4", "shelf-col-title", `${path} (${entries.length})`));
    col.appendChild(el("p", "research-note", blurb));
    entries.slice(0, 8).forEach((entry) => {
      col.appendChild(el("div", "shelf-item", entry.name));
    });
    if (entries.length > 8) {
      col.appendChild(el("div", "shelf-item is-more", `+${entries.length - 8} more`));
    }
    grid.appendChild(col);
  }
  node.appendChild(grid);
}

const DRAWERS = {
  jobs: mountJobs,
  alerts: mountAlerts,
  notes: mountNotes,
  copilot: mountCopilot,
  shelf: mountShelf,
};

export async function openDrawer(name, ctx = {}) {
  const node = host();
  const mount = DRAWERS[name];
  if (!node || !mount) return;
  node.textContent = "";
  node.hidden = false;
  node.dataset.drawer = name;
  open = name;
  announce();
  try {
    await mount(node, ctx);
  } catch (error) {
    // A drawer is an aside; it says why it is empty rather than throwing into
    // the page the user is actually working in.
    node.appendChild(el("p", "research-note is-error", `Could not open: ${error.message}`));
  }
}
