import { directoryAdapter, memoryAdapter } from "./fs-adapter.js?v=20260810a";
import { saveRootHandle, loadRootHandle, clearRootHandle } from "./handles.js?v=20260810a";

/**
 * Projects, on disk, in the layout the Qt Research app uses.
 *
 * The directory list and the metadata schema below are ported from
 * `app_qt.py` (`geoid_project_structure`, `geoid_load_project_metadata`) rather
 * than invented, so a project created here opens in the desktop app and one
 * created there opens here. That interchange is the point: it is what makes the
 * browser page and the desktop app one workspace instead of two that happen to
 * share a logo.
 */

// Ported verbatim from app_qt.py:692. Order is theirs.
export const PROJECT_DIRS = [
  "data/raw",
  "data/processed",
  "data/external",
  "data/pulled",
  "data/staged",
  "analysis",
  "analysis/external_runs",
  "plans",
  "plans/reports",
  "plans/stage_notes",
  "figures",
  "notes",
  "fem_runs",
  "meshes",
  "exports",
  "exports/storyboard/assets",
  "exports/hub",
  "post_processing/extracted_dofs",
  "signals",
  "metadata",
];

export const PROJECTS_ROOT_DIR = "geoid_projects";
export const METADATA_PATH = "metadata/project.json";
export const REGISTRY_PATH = "metadata/data_registry.json";

export const PHASES = [
  "Scoping", "Data Assembly", "Preprocessing", "Modeling",
  "Validation", "Interpretation", "Publication",
];
export const PRIORITIES = ["Critical", "High", "Medium", "Low"];

/** The Qt defaults, field for field (app_qt.py:723). */
export function defaultMetadata(name) {
  const now = new Date().toISOString();
  return {
    name,
    description: "",
    collaborators: [],
    phase: "Scoping",
    priority: "High",
    progress_pct: 5,
    tags: [],
    focus_question: "",
    next_actions: [],
    risks: [],
    decisions: [],
    milestones: [],
    pinned_resources: [],
    starred_workflows: [],
    study_area: { min_lat: "", max_lat: "", min_lon: "", max_lon: "", crs: "EPSG:4326" },
    default_import_paths: { raw: "", processed: "", external: "", pulled: "" },
    pipeline_config: {},
    remote_profiles: [],
    created_at: now,
    updated_at: now,
  };
}

/** Merge like the Qt loader does: defaults underneath, file on top. */
function mergeMetadata(name, payload) {
  const defaults = defaultMetadata(name);
  if (!payload || typeof payload !== "object") return defaults;
  const merged = { ...defaults, ...payload };
  merged.study_area = { ...defaults.study_area, ...(payload.study_area || {}) };
  merged.default_import_paths = {
    ...defaults.default_import_paths,
    ...(payload.default_import_paths || {}),
  };
  if (!merged.pipeline_config || typeof merged.pipeline_config !== "object") {
    merged.pipeline_config = {};
  }
  return merged;
}

/** Names that are safe as a directory, matching the Qt app's own sanitising. */
export function safeName(name) {
  return String(name || "").trim().replace(/[^\w\-. ]+/g, "_").replace(/\s+/g, "_") || "project";
}

// ── State ─────────────────────────────────────────────────────────────────────

let rootAdapter = null;     // the geoid_projects folder
let active = null;          // { name, dir, meta }
const listeners = [];

export function onChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function announce() {
  listeners.forEach((fn) => {
    try { fn(active); } catch (error) { /* one bad listener must not stop the rest */ }
  });
}

export function getActive() {
  return active;
}

export function getRoot() {
  return rootAdapter;
}

export function isSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Swap in a different filesystem — used by the tests, and by nothing else. */
export function useAdapter(adapter) {
  rootAdapter = adapter;
  active = null;
  announce();
  return rootAdapter;
}

export function useMemoryAdapter(name) {
  return useAdapter(memoryAdapter(name));
}

// ── Choosing and restoring the projects folder ────────────────────────────────

/**
 * Ask for the folder that holds projects. The picked folder becomes the
 * `geoid_projects` root itself if it is already named that, otherwise a
 * `geoid_projects` child is created inside it — the same either way as
 * pointing the Qt app at its own GUI directory.
 */
export async function chooseRoot() {
  if (!isSupported()) {
    throw new Error("This browser cannot open folders. Use Chrome or Edge, or import a project bundle.");
  }
  const picked = await window.showDirectoryPicker({ id: "geoid-projects", mode: "readwrite" });
  const handle = picked.name === PROJECTS_ROOT_DIR
    ? picked
    : await picked.getDirectoryHandle(PROJECTS_ROOT_DIR, { create: true });
  await saveRootHandle(handle);
  rootAdapter = directoryAdapter(handle);
  announce();
  return rootAdapter;
}

/**
 * Reopen last session's folder without another dialog. Returns null when there
 * is nothing stored or permission has lapsed — the caller offers the picker.
 */
export async function restoreRoot({ prompt = false } = {}) {
  const handle = await loadRootHandle();
  if (!handle) return null;
  const opts = { mode: "readwrite" };
  let state = await handle.queryPermission?.(opts);
  if (state !== "granted" && prompt) {
    state = await handle.requestPermission?.(opts);
  }
  if (state !== "granted") return null;
  rootAdapter = directoryAdapter(handle);
  announce();
  return rootAdapter;
}

export async function forgetRoot() {
  await clearRootHandle();
  rootAdapter = null;
  active = null;
  announce();
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects() {
  if (!rootAdapter) return [];
  const entries = await rootAdapter.list("");
  return entries.filter((e) => e.kind === "directory").map((e) => e.name);
}

/** Creates the full tree and writes metadata. Returns the active project. */
export async function createProject(name, overrides = {}) {
  if (!rootAdapter) throw new Error("No projects folder chosen yet.");
  const dir = safeName(name);
  if (await rootAdapter.exists(dir)) {
    throw new Error(`"${dir}" already exists in this folder.`);
  }
  for (const rel of PROJECT_DIRS) {
    await rootAdapter.ensureDir(`${dir}/${rel}`);
  }
  const meta = { ...defaultMetadata(name.trim() || dir), ...overrides };
  await rootAdapter.writeFile(`${dir}/${METADATA_PATH}`, JSON.stringify(meta, null, 2));
  await rootAdapter.writeFile(`${dir}/${REGISTRY_PATH}`, JSON.stringify({ entries: [] }, null, 2));
  active = { name: meta.name, dir, meta };
  announce();
  return active;
}

export async function openProject(dir) {
  if (!rootAdapter) throw new Error("No projects folder chosen yet.");
  let payload = null;
  try {
    payload = JSON.parse(await rootAdapter.readFile(`${dir}/${METADATA_PATH}`));
  } catch (error) {
    // A folder without metadata is still a project the Qt app would open; it
    // just has not been given any yet. Treat it as defaults rather than refuse.
    payload = null;
  }
  // An older project may predate directories added since; top them up quietly.
  for (const rel of PROJECT_DIRS) {
    await rootAdapter.ensureDir(`${dir}/${rel}`);
  }
  const meta = mergeMetadata(dir, payload);
  active = { name: meta.name, dir, meta };
  announce();
  return active;
}

export function closeProject() {
  active = null;
  announce();
}

/** Patch and persist the active project's metadata. */
export async function updateMetadata(patch) {
  if (!active) throw new Error("No project open.");
  const meta = { ...active.meta, ...patch, updated_at: new Date().toISOString() };
  if (patch.study_area) meta.study_area = { ...active.meta.study_area, ...patch.study_area };
  await rootAdapter.writeFile(
    `${active.dir}/${METADATA_PATH}`,
    JSON.stringify(meta, null, 2),
  );
  active = { ...active, name: meta.name, meta };
  announce();
  return meta;
}

// ── Files inside the active project ───────────────────────────────────────────

function requireActive() {
  if (!active || !rootAdapter) throw new Error("No project open.");
  return active;
}

export async function writeProjectFile(relPath, contents) {
  const { dir } = requireActive();
  await rootAdapter.writeFile(`${dir}/${relPath}`, contents);
}

export async function readProjectFile(relPath) {
  const { dir } = requireActive();
  return rootAdapter.readFile(`${dir}/${relPath}`);
}

export async function listProjectDir(relPath = "") {
  const { dir } = requireActive();
  return rootAdapter.list(relPath ? `${dir}/${relPath}` : dir);
}

export async function projectFileExists(relPath) {
  const { dir } = requireActive();
  return rootAdapter.exists(`${dir}/${relPath}`);
}

export async function readJson(relPath, fallback = null) {
  try {
    return JSON.parse(await readProjectFile(relPath));
  } catch (error) {
    return fallback;
  }
}

export async function writeJson(relPath, value) {
  await writeProjectFile(relPath, JSON.stringify(value, null, 2));
}

// ── Data registry ─────────────────────────────────────────────────────────────

/**
 * What the project knows it has. Imported layers, pulled datasets and derived
 * outputs all land here so the repository page and the Qt app see the same list.
 */
export async function registerData(entry) {
  const registry = await readJson(REGISTRY_PATH, { entries: [] });
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const record = {
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: entry.name,
    kind: entry.kind || "unknown",
    path: entry.path || "",
    source: entry.source || "",
    crs: entry.crs || "",
    bounds: entry.bounds || null,
    added_at: new Date().toISOString(),
    ...entry.extra,
  };
  // Re-importing the same file updates its record rather than stacking copies.
  const at = entries.findIndex((e) => e.name === record.name && e.kind === record.kind);
  if (at >= 0) entries[at] = { ...entries[at], ...record };
  else entries.push(record);
  await writeJson(REGISTRY_PATH, { entries });
  return record;
}

export async function listData() {
  const registry = await readJson(REGISTRY_PATH, { entries: [] });
  return Array.isArray(registry.entries) ? registry.entries : [];
}
