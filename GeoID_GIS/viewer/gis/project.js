// GIS projects: a named, saved workspace.
//
// A project is the unit of work a researcher hands on -- what was loaded, where
// it came from, who made it and under what licence -- not a map projection.
// Coordinate systems are handled in the import section, and deliberately kept
// out of here to stop the two senses of "projection" colliding.
//
// Projects live in localStorage for the working session and export as a single
// .geoidproj file, which is plain JSON. Layer *data* is not embedded: rasters
// and meshes are far too large for either store. What is recorded is the
// description of each layer -- name, format, source, CRS, styling, stack order
// and visibility -- so a project reopens as a manifest of what to reload.

const STORE_KEY = "geoid-gis:projects";
const CURRENT_KEY = "geoid-gis:project-current";
const FORMAT = "geoid-project/1";

const byId = (id) => document.getElementById(id);

function readStore() {
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function writeStore(store) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (error) {
    status("Could not save: browser storage is full or unavailable.");
  }
}

function status(message) {
  const node = byId("project-status");
  if (node) node.textContent = message || "";
}

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

function readForm() {
  return {
    format: FORMAT,
    name: byId("project-name")?.value.trim() || "Untitled project",
    author: byId("project-author")?.value.trim() || "",
    description: byId("project-description")?.value.trim() || "",
    keywords: (byId("project-keywords")?.value || "")
      .split(",").map((k) => k.trim()).filter(Boolean),
    licence: byId("project-licence")?.value || "",
    savedAt: new Date().toISOString(),
    layers: layerManifest(),
  };
}

function writeForm(project) {
  if (!project) return;
  const set = (id, value) => { const n = byId(id); if (n) n.value = value ?? ""; };
  set("project-name", project.name);
  set("project-author", project.author);
  set("project-description", project.description);
  set("project-keywords", (project.keywords || []).join(", "));
  set("project-licence", project.licence);
  const saved = byId("project-saved-at");
  if (saved) {
    saved.textContent = project.savedAt
      ? `Saved ${new Date(project.savedAt).toLocaleString()}`
      + ` · ${(project.layers || []).length} layer(s) recorded`
      : "Not saved yet.";
  }
}

function refreshSavedList(selectName) {
  const select = byId("project-saved-list");
  if (!select) return;
  const store = readStore();
  const names = Object.keys(store).sort();
  select.innerHTML = names.length
    ? names.map((n) => `<option value="${n}">${n}</option>`).join("")
    : '<option value="">No saved projects</option>';
  if (selectName && names.includes(selectName)) select.value = selectName;
}

function save() {
  const project = readForm();
  const store = readStore();
  store[project.name] = project;
  writeStore(store);
  try {
    window.localStorage.setItem(CURRENT_KEY, project.name);
  } catch (error) { /* ignore */ }
  writeForm(project);
  refreshSavedList(project.name);
  refreshHeaderLabel();
  status(`Saved "${project.name}".`);
}

function open() {
  const name = byId("project-saved-list")?.value;
  const project = readStore()[name];
  if (!project) {
    status("Nothing to open.");
    return;
  }
  writeForm(project);
  try {
    window.localStorage.setItem(CURRENT_KEY, name);
  } catch (error) { /* ignore */ }
  // Layer data is not stored, so reopening restores the description of the
  // project and lists what it expects rather than silently loading nothing.
  const missing = (project.layers || []).length;
  status(missing
    ? `Opened "${name}". ${missing} layer(s) recorded — reload their files to restore them.`
    : `Opened "${name}".`);
  window.dispatchEvent(new CustomEvent("geoid-gis:project-open", { detail: { project } }));
}

function remove() {
  const name = byId("project-saved-list")?.value;
  if (!name) return;
  const store = readStore();
  delete store[name];
  writeStore(store);
  refreshSavedList();
  status(`Deleted "${name}".`);
}

function reset() {
  writeForm({ name: "", author: "", description: "", keywords: [], licence: "" });
  const saved = byId("project-saved-at");
  if (saved) saved.textContent = "Not saved yet.";
  status("New project.");
}

function exportFile() {
  const project = readForm();
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.name.replace(/[^\w.-]+/g, "_")}.geoidproj`;
  a.click();
  URL.revokeObjectURL(url);
  status(`Exported "${project.name}".`);
}

async function importFile(file) {
  if (!file) return;
  try {
    const project = JSON.parse(await file.text());
    if (project.format !== FORMAT) {
      status("That file is not a GeoID project.");
      return;
    }
    writeForm(project);
    status(`Imported "${project.name}". Save it to keep it.`);
  } catch (error) {
    status(`Could not read that file: ${error.message}`);
  }
}

/**
 * The project controls live in a dialog, but their markup is authored in the
 * sidebar section so it stays with the rest of the toolbox. It is moved across
 * once, rather than duplicated, so there is only ever one set of fields and no
 * chance of the two drifting apart.
 */
function mountDialog() {
  const body = byId("project-dialog-body");
  const source = byId("gis-group-project");
  if (!body || !source || body.childElementCount) return;
  source.querySelectorAll(".gis-tool-section").forEach((section) => {
    section.open = true;
    body.appendChild(section);
  });
}

function setDialogOpen(open) {
  const dialog = byId("project-dialog");
  if (!dialog) return;
  dialog.hidden = !open;
  byId("project-open-modal")?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) byId("project-name")?.focus();
}

/**
 * The header button is an icon, so the current project's name goes to its
 * tooltip and accessible name rather than onto its face -- the name still
 * reaches anyone who needs it without the button growing to fit it.
 */
function refreshHeaderLabel() {
  const button = byId("project-open-modal");
  if (!button) return;
  const name = byId("project-name")?.value.trim();
  const label = name ? `Project: ${name}` : "Projects";
  button.title = label;
  button.setAttribute("aria-label", label);
}

function init() {
  mountDialog();
  byId("project-open-modal")?.addEventListener("click", () => setDialogOpen(true));
  byId("project-dialog-close")?.addEventListener("click", () => setDialogOpen(false));
  byId("project-dialog")?.addEventListener("click", (event) => {
    // Clicking the backdrop dismisses; clicking the panel must not.
    if (event.target === byId("project-dialog")) setDialogOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("project-dialog")?.hidden) setDialogOpen(false);
  });
  byId("project-name")?.addEventListener("input", refreshHeaderLabel);

  byId("project-new")?.addEventListener("click", reset);
  byId("project-save")?.addEventListener("click", save);
  byId("project-open")?.addEventListener("click", open);
  byId("project-delete")?.addEventListener("click", remove);
  byId("project-export")?.addEventListener("click", exportFile);
  byId("project-import")?.addEventListener("click", () => byId("project-import-file")?.click());
  byId("project-import-file")?.addEventListener("change", (e) => {
    importFile(e.target.files?.[0]);
    e.target.value = "";
  });
  refreshSavedList();
  try {
    const current = window.localStorage.getItem(CURRENT_KEY);
    if (current) writeForm(readStore()[current]);
    refreshSavedList(current);
  } catch (error) { /* ignore */ }
  refreshHeaderLabel();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDProject = { save, open, exportFile, readForm };
