/**
 * Checks for project-store.js -- the spine of the user side.
 *
 *     node GeoID_GIS/viewer/gis/research/project-store.test.mjs
 *
 * What is pinned here is FILING BY WORLD: a project made while looking at Mars
 * belongs under `geoid_projects/mars/`, and one made on Earth under
 * `geoid_projects/earth/`, so the same name can exist on two worlds and a list
 * of "my projects" can mean one world or all of them. That layout is also the
 * interchange with the desktop Qt app (`app_qt.py`, `geoid_project_structure`
 * at :692 and the metadata schema at :723), which is why the directory list and
 * the metadata fields are checked field for field rather than loosely.
 *
 * Everything runs on `memoryAdapter()`, which is the same code path the folder
 * picker takes -- `showDirectoryPicker` needs a native dialog and a secure
 * context, neither of which exists in node, and that is exactly what the
 * adapter seam is for.
 */
// The store reads `window.localStorage` when it remembers the open project and
// `window.GeoIDViewer` / `document.body.dataset` when it asks which world this
// is. Neither exists in node, and neither is what is under test.
const storage = new Map();
/**
 * Saving is behind membership, and these checks are about the STORE.
 *
 * Gates are locked by default, so `createProject` and `chooseRoot` refuse
 * without one -- which is right, and is pinned in membership.test.mjs. Unlocked
 * through STORAGE rather than by calling `disable()`: project-store imports
 * `membership.js?v=<stamp>` and a test importing it bare gets a SECOND module
 * instance with its own flags, so the call would turn the gate off in a copy
 * nothing reads. Storage is the one thing both instances agree about, and it is
 * the same development key a browser uses.
 */
storage.set("geoid:unlock", "test");

globalThis.window = {
  location: { pathname: "/GeoID_GIS/viewer/" },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
};
globalThis.document = { body: { dataset: {} } };

import { readFileSync } from "node:fs";
import * as store from "./project-store.js";
import { memoryAdapter } from "./fs-adapter.js";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

/** Which world the page says it is. `bodies.js` reads this first of all. */
const onWorld = (id) => { globalThis.window.GeoIDViewer = { bodyId: id }; };

const fresh = () => {
  store.useAdapter(memoryAdapter("test"));
  onWorld("earth");
};

// ── 1. The folder is the world, and the world comes from the viewer ──────────

onWorld("earth");
eq("bodyFolder defaults to the world the page is on", store.bodyFolder(), "earth");
onWorld("mars");
eq("bodyFolder follows the viewer", store.bodyFolder(), "mars");
eq("bodyFolder takes an explicit world", store.bodyFolder("moon"), "moon");
// Lower-cased because the folder is compared against `list()`'s own names, and
// "Mars" and "mars" would be two worlds on a case-sensitive filesystem.
eq("bodyFolder lower-cases", store.bodyFolder("Mars"), "mars");
eq("bodyFolder falls back to earth", store.bodyFolder(""), "earth");
onWorld("earth");

check("the root is geoid_projects", store.PROJECTS_ROOT_DIR === "geoid_projects",
  store.PROJECTS_ROOT_DIR);

// ── 2. A project is created under its world, and stamps it ──────────────────

await (async () => {
  fresh();
  const earth = await store.createProject("Rhone flood study");
  eq("created on Earth, filed under earth/", earth.dir, "earth/Rhone_flood_study");
  eq("the active project knows its world", earth.body, "earth");
  eq("the metadata stamps the world", earth.meta.body, "earth");

  onWorld("mars");
  const mars = await store.createProject("Olympus Mons scarp");
  eq("created on Mars, filed under mars/", mars.dir, "mars/Olympus_Mons_scarp");
  eq("Mars metadata stamps mars", mars.meta.body, "mars");

  // The overriding form is what the Projects page uses when somebody picks a
  // world by hand rather than by being on it.
  const moon = await store.createProject("Copernicus rim", { body: "moon" });
  eq("an explicit body wins over the page", moon.dir, "moon/Copernicus_rim");
  eq("...and is what the metadata records", moon.meta.body, "moon");
  onWorld("earth");
})();

// ── 3. Listing is per world, and `null` is every world ──────────────────────

await (async () => {
  fresh();
  await store.createProject("Rhone flood study");
  await store.createProject("Olympus Mons scarp", { body: "mars" });
  await store.createProject("Copernicus rim", { body: "moon" });

  eq("listProjects('earth') is Earth's alone",
    await store.listProjects("earth"), ["earth/Rhone_flood_study"]);
  eq("listProjects('mars') is Mars's alone",
    await store.listProjects("mars"), ["mars/Olympus_Mons_scarp"]);
  eq("listProjects(null) is every world",
    (await store.listProjects(null)).sort(),
    ["earth/Rhone_flood_study", "moon/Copernicus_rim", "mars/Olympus_Mons_scarp"].sort());

  onWorld("mars");
  eq("the default list is the world the page is on",
    await store.listProjects(), ["mars/Olympus_Mons_scarp"]);
  onWorld("earth");

  // A world nobody has worked on has no folder at all, and `list()` throws on
  // a missing directory -- which must read as "none yet", not as an error.
  eq("a world with no projects lists nothing", await store.listProjects("venus"), []);
})();

// ── 4. The same name on two worlds, refused twice on one ───────────────────

await (async () => {
  fresh();
  await store.createProject("Olympus Mons scarp", { body: "mars" });

  let refused = null;
  try {
    await store.createProject("Olympus Mons scarp", { body: "mars" });
  } catch (error) { refused = error.message; }
  check("the same name twice on one world is refused",
    !!refused && /already exists under mars/.test(refused), refused || "it was allowed");

  const venus = await store.createProject("Olympus Mons scarp", { body: "venus" });
  eq("the same name on another world is a different project",
    venus.dir, "venus/Olympus_Mons_scarp");
  eq("...and both are on disk",
    (await store.listProjects(null)).sort(),
    ["mars/Olympus_Mons_scarp", "venus/Olympus_Mons_scarp"]);
})();

// ── 5. Opening restores the world ──────────────────────────────────────────

await (async () => {
  fresh();
  await store.createProject("Olympus Mons scarp", { body: "mars" });
  store.closeProject();

  // Opened from an EARTH page: the project is still a Mars project, and every
  // body-specific reader downstream (`bodies.js`, the Model Builder's radius,
  // the area formula) asks the open project rather than the page.
  onWorld("earth");
  const back = await store.openProject("mars/Olympus_Mons_scarp");
  eq("openProject restores the world from the metadata", back.body, "mars");
  eq("...and the metadata agrees", back.meta.body, "mars");
  eq("the name survives the round trip", back.name, "Olympus Mons scarp");
  eq("the folder leaf is the sanitised name", back.folder, "Olympus_Mons_scarp");
})();

// ── 6. A project written before `body` existed is read from its FOLDER ──────

await (async () => {
  fresh();
  // What the desktop app writes: the Qt schema, with no `body` field. Pointed
  // at `geoid_projects/mars/` it makes exactly this.
  const adapter = memoryAdapter("legacy");
  store.useAdapter(adapter);
  await adapter.ensureDir("mars/Hellas_basin/metadata");
  await adapter.writeFile("mars/Hellas_basin/metadata/project.json",
    JSON.stringify({ name: "Hellas basin", phase: "Scoping" }));

  onWorld("earth");
  const opened = await store.openProject("mars/Hellas_basin");
  // The DIRECTORY is the filing, so it is the truth about which world this is.
  // Reading the page's world instead would open a Mars study as an Earth one
  // whenever somebody happened to be looking at Earth.
  eq("a project with no stamped world takes its folder's", opened.body, "mars");

  // And one genuinely at the root of a flat, pre-worlds layout has no folder to
  // read, so Earth is the only answer available.
  await adapter.ensureDir("Old_study/metadata");
  await adapter.writeFile("Old_study/metadata/project.json",
    JSON.stringify({ name: "Old study" }));
  onWorld("mars");
  const flat = await store.openProject("Old_study");
  eq("a flat pre-worlds project reads as Earth", flat.body, "earth");
  onWorld("earth");
})();

// ── 7. The tree and the schema are the Qt app's, field for field ────────────

await (async () => {
  const adapter = memoryAdapter("tree");
  store.useAdapter(adapter);
  onWorld("earth");
  const p = await store.createProject("Tree check");
  const missing = [];
  for (const rel of store.PROJECT_DIRS) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await adapter.exists(`${p.dir}/${rel}`))) missing.push(rel);
  }
  check(`the Qt tree is made whole under the world folder (${store.PROJECT_DIRS.length} dirs)`,
    missing.length === 0, missing.join(", "));
  check("the metadata and the registry are written",
    (await adapter.exists(`${p.dir}/${store.METADATA_PATH}`))
      && (await adapter.exists(`${p.dir}/${store.REGISTRY_PATH}`)));
})();

const meta = store.defaultMetadata("Schema", "mars");
eq("defaultMetadata stamps the world it was given", meta.body, "mars");
check("defaultMetadata carries the Qt schema",
  ["name", "body", "description", "collaborators", "phase", "priority",
   "progress_pct", "tags", "focus_question", "next_actions", "risks",
   "decisions", "milestones", "pinned_resources", "starred_workflows",
   "study_area", "default_import_paths", "pipeline_config", "remote_profiles",
   "created_at", "updated_at"].every((k) => k in meta),
  Object.keys(meta).join(", "));
eq("the study area is EPSG:4326", meta.study_area.crs, "EPSG:4326");

// ── 8. A directory name is safe, and a world folder cannot be escaped ───────

eq("safeName keeps words, dashes and dots", store.safeName("Rhone-flood v1.2"),
  "Rhone-flood_v1.2");
eq("safeName has no slashes to escape a world with",
  store.safeName("../../etc/passwd"), ".._.._etc_passwd");
eq("safeName never answers empty", store.safeName("///"), "_");

// ── the adapter names itself, and the hub does not swap in the one it has ──
// useAdapter closes the open project (a project is a folder on the OLD
// filesystem). The hub re-probes the sidecar whenever it installs and used to
// swap the sidecar adapter in unconditionally — which closed the project the
// Model page had just filed its series into, the moment the hand-off reached
// Research. Measured: the Signal page listed nothing a second after
// post_processing/extracted_dofs/ gained two CSVs.
{
  store.useAdapter({ ...memoryAdapter("k"), kind: "sidecar" });
  eq("adapterKind reports the adapter's own kind", store.adapterKind(), "sidecar");
  store.useAdapter(memoryAdapter("k2"));
  const hub = readFileSync(new URL("./hub.js", import.meta.url), "utf8").replace(/\/\/[^\n]*/g, "");
  const probe = hub.slice(hub.indexOf("sidecar.probe().then"));
  check("the hub's reprobe leaves a store already on the sidecar alone", /adapterKind\?\.\(\) === "sidecar"\) return;/.test(probe));
  check("the hub reopens the project it had when it does switch", /openProject\?\.\(open\)/.test(probe));
}

// ── bytes are bytes whichever adapter answers ────────────────────────────────
// The sidecar adapter answers a Blob, the disk a buffer, memory a Uint8Array;
// the sweep reader handed a Blob to a float64 view and read "[object Blob]".
await (async () => {
  const base = memoryAdapter("bytes");
  const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  let shape = "blob";
  const adapter = { ...base, readFileBytes: async () => (shape === "blob" ? new Blob([raw]) : shape === "buffer" ? raw.buffer.slice(0) : shape === "string" ? "abc" : raw) };
  store.useAdapter(adapter);
  onWorld("earth");
  await store.createProject("Bytes");
  for (const s of ["blob", "buffer", "string", "view"]) {
    shape = s;
    const got = await store.readProjectFileBytes("any");
    const want = s === "string" ? [97, 98, 99] : [...raw];
    check(`readProjectFileBytes answers a Uint8Array from a ${s}`, ArrayBuffer.isView(got) && got.constructor.name === "Uint8Array" && [...got].join() === want.join(), `${Object.prototype.toString.call(got)} ${[...(got || [])].join()}`);
  }
  const dv = new DataView(raw.buffer, 2, 4);
  check("toBytes keeps a view's own window", [...(await store.toBytes(dv))].join() === "3,4,5,6");
  check("toBytes reads a foreign-realm-shaped buffer by tag, never instanceof", [...(await store.toBytes({ arrayBuffer: async () => raw.buffer.slice(0, 2) }))].join() === "1,2");
})();

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
