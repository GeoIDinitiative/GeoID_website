import { directoryAdapter, memoryAdapter, indexedDbAdapter } from "./fs-adapter.js?v=20260826-2e5d2d6";
import { currentBodyId } from "../bodies.js?v=20260826-2e5d2d6";
import { saveRootHandle, loadRootHandle, clearRootHandle } from "./handles.js?v=20260826-2e5d2d6";

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

/**
 * Projects are filed by world: geoid_projects/<body>/<name>/.
 *
 * With ten worlds in play a flat root becomes a list of unrelated projects with
 * no way to tell a Moon study from a Mars one until each is opened. The body
 * folder is the obvious index, and it matches how anyone would organise this by
 * hand.
 *
 * Note for the desktop app: it writes geoid_projects/<name>/ flat, so point it
 * at geoid_projects/earth/ (or the relevant world) rather than at the root, or
 * it will list the world folders as though they were projects.
 */
export function bodyFolder(body = currentBodyId()) {
  return String(body || "earth").toLowerCase();
}
export const METADATA_PATH = "metadata/project.json";
export const REGISTRY_PATH = "metadata/data_registry.json";

export const PHASES = [
  "Scoping", "Data Assembly", "Preprocessing", "Modeling",
  "Validation", "Interpretation", "Publication",
];
export const PRIORITIES = ["Critical", "High", "Medium", "Low"];

/** The Qt defaults, field for field (app_qt.py:723). */
export function defaultMetadata(name, body = currentBodyId()) {
  const now = new Date().toISOString();
  return {
    name,
    // Which world this project is about. Defaulted rather than required, so a
    // project written by the desktop app -- which predates the idea -- still
    // opens here and is read as Earth.
    body,
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
  // An older project has no body; it was made before other worlds existed.
  if (!merged.body) merged.body = "earth";
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

/**
 * Why the folder picker is unavailable, when it is — so the page can say the
 * true thing instead of blaming the browser.
 *
 * The trap that cost real time: `showDirectoryPicker` needs a **secure
 * context**, and `http://0.0.0.0:8125` is not one while `http://localhost:8125`
 * — the same server, the same files — is. On the insecure origin the API is
 * simply absent, so every project-scoped page sat empty with no way to fix it.
 */
export function folderSupport() {
  if (typeof window === "undefined") return { ok: false, reason: "no-window" };
  if (typeof window.showDirectoryPicker === "function") return { ok: true };
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: "insecure-origin",
      origin: window.location?.origin || "",
      hint: window.location?.origin?.replace(/\/\/0\.0\.0\.0/, "//localhost")
        || "http://localhost",
    };
  }
  return { ok: false, reason: "unsupported-browser" };
}

/** Whether a project can be made at all, by any means. */
export function canStoreProjects() {
  return isSupported() || typeof indexedDB !== "undefined";
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

/**
 * Keep projects in the browser instead of on disk.
 *
 * For everyone the folder picker cannot serve: an insecure origin, Firefox,
 * Safari. Real and persistent, but invisible to the desktop app and thrown away
 * with the site data, so whatever offers this must say so rather than let it
 * look like the folder.
 */
export async function useBrowserStorage() {
  const adapter = await indexedDbAdapter();
  rootAdapter = adapter;
  active = null;
  try { window.localStorage.setItem(BROWSER_STORE_KEY, "1"); } catch (error) { /* fine */ }
  announce();
  return adapter;
}

const BROWSER_STORE_KEY = "geoid-gis:browser-store";

/** Was the browser store in use last session? */
export function usingBrowserStorage() {
  return rootAdapter?.kind === "indexeddb";
}

// ── Choosing and restoring the projects folder ────────────────────────────────

/**
 * Ask for the folder that holds projects. The picked folder becomes the
 * `geoid_projects` root itself if it is already named that, otherwise a
 * `geoid_projects` child is created inside it — the same either way as
 * pointing the Qt app at its own GUI directory.
 */
export async function chooseRoot() {
  const support = folderSupport();
  if (!support.ok) {
    throw new Error(support.reason === "insecure-origin"
      ? `Folders need a secure origin, and this page is served from `
        + `${support.origin}. Open it at ${support.hint} instead — same server, `
        + `same files — or keep projects in the browser.`
      : "This browser cannot open folders. Use Chrome or Edge, or keep "
        + "projects in the browser.");
  }
  const picked = await window.showDirectoryPicker({ id: "geoid-projects", mode: "readwrite" });
  const handle = picked.name === PROJECTS_ROOT_DIR
    ? picked
    : await picked.getDirectoryHandle(PROJECTS_ROOT_DIR, { create: true });
  await saveRootHandle(handle);
  rootAdapter = directoryAdapter(handle);
  try { window.localStorage.removeItem(BROWSER_STORE_KEY); } catch (error) { /* fine */ }
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

/**
 * Which project was open last, so a reload comes back to the work rather than
 * to an empty hub. Only the path is remembered -- the project itself is read
 * back off disk, so nothing here can go stale against the folder.
 */
const LAST_PROJECT_KEY = "geoid-gis:last-project";

function rememberProject(dir) {
  try {
    if (dir) window.localStorage.setItem(LAST_PROJECT_KEY, dir);
    else window.localStorage.removeItem(LAST_PROJECT_KEY);
  } catch (error) { /* storage unavailable, the session simply will not resume */ }
}

/**
 * Reopen last session's folder *and* the project that was open in it.
 *
 * Returns the active project, or null when there is nothing to resume -- no
 * stored folder, lapsed permission, or a project that has since been moved.
 * Every one of those is ordinary, so none of them throws: the caller shows the
 * pick-a-folder panel and the user carries on.
 */
export async function restoreSession({ prompt = false } = {}) {
  let root = await restoreRoot({ prompt });
  if (!root) {
    // No folder to resume. If last session used the browser store, come back
    // to it -- otherwise the work would look lost when it is merely elsewhere.
    let wanted = null;
    try { wanted = window.localStorage.getItem(BROWSER_STORE_KEY); } catch (error) { /* none */ }
    if (wanted && typeof indexedDB !== "undefined") {
      try { root = await useBrowserStorage(); } catch (error) { return null; }
    }
  }
  if (!root) return null;
  let dir = null;
  try { dir = window.localStorage.getItem(LAST_PROJECT_KEY); } catch (error) { /* none */ }
  if (!dir) return null;
  try {
    return await openProject(dir);
  } catch (error) {
    // Renamed, deleted, or opened from a different folder. Forget it rather
    // than offering it again every load.
    rememberProject(null);
    return null;
  }
}

export async function forgetRoot() {
  await clearRootHandle();
  rootAdapter = null;
  active = null;
  rememberProject(null);
  announce();
}

// ── Projects ──────────────────────────────────────────────────────────────────

/**
 * The projects for one world, as paths relative to the root.
 * Pass `null` to list every world's.
 */
export async function listProjects(body = currentBodyId()) {
  if (!rootAdapter) return [];
  const worlds = body === null
    ? (await rootAdapter.list("")).filter((e) => e.kind === "directory").map((e) => e.name)
    : [bodyFolder(body)];
  const out = [];
  for (const world of worlds) {
    let entries = [];
    try { entries = await rootAdapter.list(world); } catch (error) { continue; }
    entries.filter((e) => e.kind === "directory")
      .forEach((e) => out.push(`${world}/${e.name}`));
  }
  return out;
}

/** Creates the full tree and writes metadata. Returns the active project. */
export async function createProject(name, overrides = {}) {
  if (!rootAdapter) throw new Error("No projects folder chosen yet.");
  const body = overrides.body || currentBodyId();
  const leaf = safeName(name);
  const dir = `${bodyFolder(body)}/${leaf}`;
  if (await rootAdapter.exists(dir)) {
    throw new Error(`"${leaf}" already exists under ${bodyFolder(body)}.`);
  }
  for (const rel of PROJECT_DIRS) {
    await rootAdapter.ensureDir(`${dir}/${rel}`);
  }
  const meta = { ...defaultMetadata(name.trim() || leaf, body), ...overrides };
  await rootAdapter.writeFile(`${dir}/${METADATA_PATH}`, JSON.stringify(meta, null, 2));
  await rootAdapter.writeFile(`${dir}/${REGISTRY_PATH}`, JSON.stringify({ entries: [] }, null, 2));
  active = { name: meta.name, dir, folder: leaf, body, meta };
  rememberProject(dir);
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
  const parts = String(dir).split("/").filter(Boolean);
  const leaf = parts[parts.length - 1];
  const meta = mergeMetadata(leaf, payload);
  active = { name: meta.name, dir, folder: leaf, body: meta.body, meta };
  rememberProject(dir);
  announce();
  return active;
}

export function closeProject() {
  active = null;
  rememberProject(null);
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

/**
 * The open project, or a readable refusal.
 *
 * Exported because the wiring needs it too: a handler that went straight for
 * `.dir` or `.meta` off `getActive()` showed the user "Cannot read properties
 * of null (reading 'dir')" where the handler beside it said "No project open."
 */
export function requireActive() {
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

/**
 * A project file as bytes, for anything binary — a GeoTIFF sent back to the
 * globe cannot survive `readFile`'s `.text()`. Returns whatever the adapter
 * holds (a Blob, ArrayBuffer, or string); the caller normalises. Adapters
 * without a bytes path fall back to their text read.
 */
export async function readProjectFileBytes(relPath) {
  const { dir } = requireActive();
  const full = `${dir}/${relPath}`;
  return rootAdapter.readFileBytes
    ? rootAdapter.readFileBytes(full)
    : rootAdapter.readFile(full);
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
  if (at >= 0) {
    // An empty field must not erase a filled one. Showing a *pulled* layer on
    // the globe re-registers it through the import path, which knows nothing
    // about the fetch — and blanked "USGS earthquakes — live" back to "",
    // losing where the data came from at the moment it became most useful.
    const kept = { ...record };
    Object.keys(kept).forEach((key) => {
      if ((kept[key] === "" || kept[key] === null) && entries[at][key]) delete kept[key];
    });
    entries[at] = { ...entries[at], ...kept };
  }
  else entries.push(record);
  await writeJson(REGISTRY_PATH, { entries });
  return record;
}

export async function listData() {
  const registry = await readJson(REGISTRY_PATH, { entries: [] });
  return Array.isArray(registry.entries) ? registry.entries : [];
}
