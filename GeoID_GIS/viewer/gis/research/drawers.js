import * as store from "./project-store.js?v=20260830-f11b60e";
import { el, button, row, statusLine } from "./pages/common.js?v=20260830-f11b60e";
import * as sidecar from "./sidecar.js?v=20260830-f11b60e";

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
 * The Copilot is Atlas now.
 *
 * This drawer used to say plainly that no assistant could run in the browser,
 * which was true and is no longer: Atlas sits bottom-right on every page,
 * grounded in the real page registry and the open project. So the drawer's job
 * changed from explaining an absence to being the place you *configure* it —
 * the subscription it uses, and the watcher.
 *
 * Keys are managed here rather than only through a chat prompt because a field
 * you can see, mask and clear is the right shape for a credential. The value
 * goes straight to the sidecar; this page never stores it, and only ever gets
 * the mask back.
 */
function mountCopilot(node) {
  node.appendChild(head("Atlas", "The assistant, its model, and what it watches."));
  node.appendChild(el("p", "research-note",
    "Atlas is the ◆ button in the bottom-right corner of every page. It knows "
    + "this workspace and reads your open project, so it can find a tool, say "
    + "what the project is missing, and check the live feeds — no model needed "
    + "for any of that."));
  const openBtn = button("Ask Atlas", () => window.GeoIDAtlas?.open?.(true));
  node.appendChild(row(openBtn));

  const { node: status, say } = statusLine();
  const keysBox = el("div", "research-subsection");
  keysBox.appendChild(el("h3", "research-subtitle", "Model subscription"));
  keysBox.appendChild(el("p", "research-note",
    "Bring your own Claude, ChatGPT or Gemini for open-ended questions. The key "
    + "is held by the local sidecar at file mode 0600 — never by this page, "
    + "because a browser cannot keep a secret — and only a masked hint comes "
    + "back. Leave a field blank and save to remove that key."));
  const keyRows = el("div", "research-list");
  keysBox.append(keyRows, status);
  node.appendChild(keysBox);

  const PROVIDERS = [
    ["ANTHROPIC_API_KEY", "Claude (Anthropic)"],
    ["OPENAI_API_KEY", "ChatGPT (OpenAI)"],
    ["GEMINI_API_KEY", "Gemini (Google)"],
  ];

  async function drawKeys() {
    keyRows.textContent = "";
    if (!sidecar.isConnected()) {
      keyRows.appendChild(el("p", "research-note",
        "Connect the sidecar first (Settings ▸ Sidecar) — it is what holds the key."));
      return;
    }
    let info;
    try { info = await sidecar.atlasKeys(); }
    catch (error) { say(error.message, true); return; }
    PROVIDERS.forEach(([name, label]) => {
      const entry = info.keys?.[name] || {};
      const line = el("div", "research-list-row");
      line.appendChild(el("span", "research-list-name", label));
      const field = document.createElement("input");
      field.className = "input";
      field.type = "password";           // not shoulder-readable while typing
      field.autocomplete = "off";
      field.placeholder = entry.configured ? entry.hint : "paste a key to enable";
      line.appendChild(field);
      line.appendChild(button(entry.configured ? "Replace" : "Save", async () => {
        try {
          await sidecar.saveAtlasKey(name, field.value.trim());
          field.value = "";              // never leave a credential in the DOM
          say(`${label} updated.`);
          await drawKeys();
        } catch (error) { say(error.message, true); }
      }, { secondary: true }));
      keyRows.appendChild(line);
    });
    const active = info.providers || [];
    keyRows.appendChild(el("p", "research-note", active.length
      ? `Atlas will use ${active.join(" / ")} for anything it cannot answer from the app itself.`
      : "No key set — Atlas answers from the app and its project, and says so for anything else."));
  }

  const watchBox = el("div", "research-subsection");
  watchBox.appendChild(el("h3", "research-subtitle", "Watching the live feeds"));
  watchBox.appendChild(el("p", "research-note",
    "Earthquakes, weather alerts, volcanoes and wildfires, checked against the "
    + "open project's study area. Run by the sidecar, so it keeps watching with "
    + "every tab closed and tells you what it found when you come back."));
  const watchState = el("p", "research-note", "");
  const watchRow = row(
    button("Start watching", () => window.GeoIDAtlas?.ask?.("watch this area")),
    button("Status", () => window.GeoIDAtlas?.ask?.("watch status"), { secondary: true }),
    button("Stop", () => window.GeoIDAtlas?.ask?.("stop watching"), { secondary: true }));
  watchBox.append(watchState, watchRow);
  node.appendChild(watchBox);

  (async () => {
    await drawKeys();
    if (!sidecar.isConnected()) return;
    try {
      const st = await sidecar.watchStatus();
      watchState.textContent = st.running
        ? `Watching ${st.sources.length} feed(s) every ${st.config.intervalMin} min — `
          + `${st.known} event(s) known, ${st.alerts} alert(s) raised.`
        : "Not watching at the moment.";
    } catch (error) { /* the watcher is a bonus, not a blocker */ }
  })();
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
