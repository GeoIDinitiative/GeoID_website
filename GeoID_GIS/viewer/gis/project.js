import * as store from "./research/project-store.js?v=20260826-02b987e";
import { currentBodyId, currentBody } from "./bodies.js?v=20260826-02b987e";
import { ready as shellReady } from "./shell.js?v=20260826-02b987e";

/**
 * The folder button in the sidebar header.
 *
 * It used to keep its own projects in localStorage, which meant the GIS page
 * and the Research Hub each had a private idea of what a project was: you could
 * "open" one here and the Research pages would still say none was open. There
 * is one store now -- the folder tree the Research Hub writes -- and this is a
 * quick way in and out of it.
 *
 * Deliberately small. Anything beyond choosing a folder, making a project and
 * opening one belongs on the Projects page, which has the room for it.
 */

function byId(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function status(message, isError) {
  const node = byId("project-status");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(isError));
}

/** What the GIS page has loaded, recorded alongside the project. */
function layerManifest() {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  return layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    type: layer.type,
    format: layer.format || layer.metadata?.format || null,
    source: layer.metadata?.source || layer.fileName || null,
    crs: layer.metadata?.crs || layer.crs || null,
    visible: layer.visible !== false,
    opacity: Number.isFinite(layer.opacity) ? layer.opacity : 1,
    stackIndex: layer.stackIndex ?? null,
  }));
}

// ── The dialog ────────────────────────────────────────────────────────────────

/** Off by default: on Mars you almost always want Mars's projects. */
let showAllWorlds = false;

async function render() {
  const body = byId("project-dialog-body");
  if (!body) return;
  body.textContent = "";

  const root = store.getRoot();
  const active = store.getActive();

  // Where projects live. The picker needs a secure context, so name the real
  // obstacle when it is missing rather than blaming the browser -- the usual
  // cause is the origin (0.0.0.0 rather than localhost), not Chrome.
  const support = store.folderSupport();
  const folder = el("div", "project-block");
  folder.appendChild(el("h3", "project-block-title", "Projects folder"));
  folder.appendChild(el("p", "research-note", root
    ? (root.kind === "indexeddb"
      ? "Kept in this browser — the desktop app cannot see these."
      : `Using "${root.name}".`)
    : "Choose where geoid_projects should live. Projects are real folders, "
      + "readable by the desktop app."));
  const chooseRow = el("div", "gis-btn-row");
  const choose = el("button", "button", root ? "Change folder…" : "Choose folder…");
  choose.type = "button";
  choose.disabled = !support.ok;
  choose.addEventListener("click", async () => {
    try {
      await store.chooseRoot();
      await render();
      status("Projects folder set.");
    } catch (error) {
      if (error.name !== "AbortError") status(error.message, true);
    }
  });
  chooseRow.appendChild(choose);
  if (!root && typeof indexedDB !== "undefined") {
    const inBrowser = el("button", "button secondary", "Keep in this browser");
    inBrowser.type = "button";
    inBrowser.addEventListener("click", async () => {
      try {
        await store.useBrowserStorage();
        await render();
        status("Projects are kept in this browser.");
      } catch (error) {
        status(error.message, true);
      }
    });
    chooseRow.appendChild(inBrowser);
  }
  folder.appendChild(chooseRow);
  if (!support.ok) {
    folder.appendChild(el("p", "research-note is-error",
      support.reason === "insecure-origin"
        ? `The picker needs a secure origin, and this page is served from `
          + `${support.origin}. Open it at ${support.hint} instead.`
        : "This browser has no folder picker — Chrome and Edge only."));
  }
  body.appendChild(folder);

  if (!root) return;

  // New project.
  const world = currentBody();
  const worldName = world?.name || "Earth";

  const make = el("div", "project-block");
  make.appendChild(el("h3", "project-block-title", `New ${worldName} project`));
  // Said plainly, because it decides where the folder is written and the answer
  // comes from which viewer you happen to be in -- not from anything on screen.
  make.appendChild(el("p", "research-note",
    `Filed under geoid_projects/${currentBodyId()}/, so ${worldName} work stays `
    + `together and is not mixed in with the other worlds.`));
  const nameInput = document.createElement("input");
  nameInput.className = "input";
  nameInput.id = "project-name";
  nameInput.placeholder = "Project name";
  const makeRow = el("div", "gis-btn-row");
  const create = el("button", "button", "Create");
  create.type = "button";
  create.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) { status("Give the project a name first.", true); return; }
    try {
      // Stamped with the world it was made on, so a Mars project is not
      // mistaken for an Earth one later.
      const project = await store.createProject(name, { body: currentBodyId() });
      await store.writeJson("metadata/layers.json", { layers: layerManifest() });
      nameInput.value = "";
      await render();
      refreshHeaderLabel();
      status(`Created "${project.dir}" with the full project tree.`);
    } catch (error) {
      status(error.message, true);
    }
  });
  makeRow.append(nameInput, create);
  make.appendChild(makeRow);
  body.appendChild(make);

  // Open one.
  const list = el("div", "project-block");
  const head = el("div", "project-block-head");
  head.appendChild(el("h3", "project-block-title",
    showAllWorlds ? "Open — all worlds" : `Open — ${worldName}`));
  const swap = el("button", "button secondary small",
    showAllWorlds ? `Only ${worldName}` : "All worlds");
  swap.type = "button";
  swap.addEventListener("click", () => { showAllWorlds = !showAllWorlds; void render(); });
  head.appendChild(swap);
  list.appendChild(head);

  const names = await store.listProjects(showAllWorlds ? null : currentBodyId());
  if (!names.length) {
    list.appendChild(el("p", "research-note", showAllWorlds
      ? "No projects in this folder yet."
      : `No ${worldName} projects yet.`));
  }
  const rows = el("div", "research-list");
  names.forEach((dir) => {
    const parts = dir.split("/");
    const leaf = parts[parts.length - 1];
    const home = parts.length > 1 ? parts[0] : null;
    const row = el("button", "research-list-row");
    row.type = "button";
    row.classList.toggle("is-active", active?.dir === dir);
    row.appendChild(el("span", "research-list-name", leaf));
    // The world is only worth showing when the list spans more than one.
    if (showAllWorlds && home) row.appendChild(el("span", "research-list-tag", home));
    if (active?.dir === dir) row.appendChild(el("span", "research-list-tag", "open"));
    row.addEventListener("click", async () => {
      try {
        await store.openProject(dir);
        await render();
        refreshHeaderLabel();
        status(`Opened "${leaf}".`);
      } catch (error) {
        status(error.message, true);
      }
    });
    rows.appendChild(row);
  });
  list.appendChild(rows);
  body.appendChild(list);

  // The rest of a project's life is the Research Hub's job, so point at it
  // rather than growing a second, smaller version of that page here.
  const more = el("div", "gis-btn-row");
  const go = el("button", "button secondary", "Open in Research Hub");
  go.type = "button";
  go.addEventListener("click", () => {
    setDialogOpen(false);
    window.GeoIDModeManager?.setMode?.("research");
    window.GeoIDResearch?.setPage?.("Projects");
  });
  more.appendChild(go);
  body.appendChild(more);

  const statusLine = el("p", "research-status");
  statusLine.id = "project-status";
  body.appendChild(statusLine);
}

function setDialogOpen(open) {
  const dialog = byId("project-dialog");
  if (!dialog) return;
  dialog.hidden = !open;
  byId("project-open-modal")?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) void render();
}

/**
 * The header button is an icon, so the open project's name goes to its tooltip
 * and accessible name rather than onto its face -- the name still reaches
 * anyone who needs it without the button growing to fit it.
 */
function refreshHeaderLabel() {
  const button = byId("project-open-modal");
  if (!button) return;
  const active = store.getActive();
  const label = active ? `Project: ${active.name}` : "Projects";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.classList.toggle("is-open", Boolean(active));
}

/**
 * Re-drape a project's layers when it becomes active.
 *
 * The return path that makes a reload feel like resuming rather than starting
 * over: `restoreSession` reopens the project, and this puts its overlays back on
 * the globe. Keyed on the project folder so it fires once per switch, not on
 * every metadata change; waits for the viewer, since on a cold load the project
 * resolves before the globe is ready; and never lets a failed restore stop the
 * project opening.
 */
let lastLayerRestoreDir = null;
async function maybeRestoreLayers(active) {
  const dir = active?.dir || null;
  if (!dir) { lastLayerRestoreDir = null; return; }
  if (dir === lastLayerRestoreDir) return;
  lastLayerRestoreDir = dir;
  for (let i = 0; i < 50 && !window.GeoIDViewer; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    const n = await window.GeoIDResearch?.bridge?.restoreLayers?.();
    if (n) status(`Restored ${n} layer${n === 1 ? "" : "s"} onto the globe.`);
  } catch (error) { /* opening a project must never fail on its layer restore */ }
}

function init() {
  byId("project-open-modal")?.addEventListener("click", () => setDialogOpen(true));
  byId("project-dialog-close")?.addEventListener("click", () => setDialogOpen(false));
  byId("project-dialog")?.addEventListener("click", (event) => {
    // Clicking the backdrop dismisses; clicking the panel must not.
    if (event.target === byId("project-dialog")) setDialogOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("project-dialog")?.hidden) setDialogOpen(false);
  });
  // The button follows the store, so opening a project on the Projects page
  // updates it too -- there is only the one project now.
  store.onChange(refreshHeaderLabel);
  store.onChange(maybeRestoreLayers);
  refreshHeaderLabel();
  // A project restored on load fires onChange before this listener is attached,
  // so catch up on whatever is already open.
  maybeRestoreLayers(store.getActive());
}

// On a planet page the button and dialog arrive with the shell, after
// DOMContentLoaded -- binding on DOM ready alone would find nothing to bind to.
shellReady.then(init).catch(init);

window.GeoIDProject = { open: setDialogOpen, layerManifest };
