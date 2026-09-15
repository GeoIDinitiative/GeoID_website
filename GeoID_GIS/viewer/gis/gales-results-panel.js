/**
 * GALES results in the Meshing Studio: open a simulation, colour its mesh by
 * any field it wrote, step through time, cut it, warp it, probe it.
 *
 * The studio builds meshes and hands them to GALES; this is the other half of
 * that loop, where the solver's binary output comes back as something to
 * look at — the ParaView pass, without leaving the page the model was made on.
 *
 * WHAT IS DRAWN, and why that much:
 *
 * - **The boundary**, coloured per node. A 3D result lives in 1.4 million
 *   tets and only its skin can be seen; the mesh file's own Side records are
 *   that skin, so nothing is derived on a mesh that has them.
 * - **A slice**, cut from the tets in a worker. The cut is stored as edge
 *   interpolants (node a, node b, t), so changing the field, the step or the
 *   warp re-colours the same slice rather than cutting it again.
 * - **A clip**: the boundary cut away on one side of the slice plane, with the
 *   slice as its cap — the view that shows what the inside of a volcano did.
 * - **A warp**: any displacement field at the same time step, scaled.
 *
 * The colour range is the range of what is drawn at this step unless it is
 * fixed, and the legend says which; a map whose colours silently rescale
 * every step says nothing about how the field changed between them.
 */
import * as THREE from "../vendor/three.module.js";
import {
  planSimulation, describeField, dofsPerNode, float64View, componentOf, magnitudeOf,
  rangeOf, usedNodes, COLORMAPS, colormapTable, colourValues, niceTicks, formatValue, tickLabel,
  interpolateOnSlice, axisPlane, nodeByteRange, probeCsv, parseMesh, sliceTets, isoTets, contourLevels, contourSegments,
  exposedFaces, thresholdKeep, keptTriangles,
  flagSummary, stationsForFlag, nodeLocator, specPoints, parsePointList, stationCsvFiles,
  groupResultFiles, timeOf, referencePlan, differenceOf, DERIVED_DOFS,
} from "./gales-results.js?v=20260915-032ad5f";
import { zipStore } from "./shapefile-writer.js?v=20260915-032ad5f";
import { fieldArrays, pvdText, vtkCells, vtuParts } from "./vtk-export.js?v=20260915-032ad5f";
import { parseSolidProps } from "./strain-stress.js?v=20260915-032ad5f";
import { PLATFORMS, DEFAULT_GEOMETRY, losVector, losDisplacement, wrapFringes, fringeCount, fringesPerEdge, FRINGE_MAP } from "./insar.js?v=20260915-032ad5f";
import { may, refusal } from "./membership.js?v=20260915-032ad5f";
import { downloadText } from "./extraction.js?v=20260915-032ad5f";

const VERSION = new URL(import.meta.url).search;
const MODEL_TO_SCENE = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const CACHE_STEPS = 4;
const byId = (id) => document.getElementById(id);

const S = {
  source: null,
  plan: null,
  mesh: null,
  meshPath: "",
  fields: [],
  field: -1,
  component: "",
  step: 0,
  colormap: "Cool to Warm",
  reverse: false,
  bands: 0,
  log: false,
  rangeMode: "step",
  range: [0, 1],
  view: "surface",
  sliceAxis: "x",
  slicePos: 0.5,
  clipFlip: false,
  slice: null,
  sliceKey: "",
  deform: { on: false, field: -1, scale: 1 },
  insar: loadInsar(),
  insarNote: "",
  losRaw: null,
  opacity: 1,
  edges: false,
  probe: null,
  playing: false,
  busy: false,
  pending: false,
  statusText: "No results open.",
  stations: [],
  extract: { fields: null, layout: "station", result: null, plotField: 0, plotComp: "mag", note: "" },
  statusError: false,
  vtkExport: { part: "volume", steps: "current", fields: null, busy: false, note: "" },
  // A second run on the same mesh whose fields are subtracted from this one's.
  reference: null,
  clipOn: null,
  // Contour lines on what is drawn, and isosurfaces through the volume.
  contours: { on: false, count: 10, colour: "dark" },
  iso: { on: false, levels: "", opacity: 0.55, key: "", data: null, used: [] },
  // Threshold: the cells in a value range and/or of chosen volume flags, as a closed skin.
  threshold: { lo: "", hi: "", flags: [], mode: "all", colourBy: "field", key: "", data: null },
  // Meshes opened by hand, and the field a numbered file picked on its own
  // belongs to (a bare "1" says nothing about which field it is).
  meshHints: [],
  looseField: "solid/u",
};

const cache = new Map();

// ── The reader: a worker, else the same code in this thread ─────────────────

let reader = null;
function getReader() {
  if (reader) return reader;
  const pending = new Map();
  let nextId = 1;
  let worker = null;
  try {
    worker = new Worker(new URL(`./gales-worker.js${VERSION}`, import.meta.url), { type: "module" });
    worker.addEventListener("message", (event) => {
      const msg = event.data || {};
      const job = pending.get(msg.id);
      if (!job) return;
      if (msg.type === "progress") { job.progress?.(msg.fraction); return; }
      pending.delete(msg.id);
      if (msg.ok) job.resolve(msg); else job.reject(new Error(msg.error));
    });
    worker.addEventListener("error", (event) => {
      pending.forEach((job) => job.reject(new Error(event.message || "The results reader stopped.")));
      pending.clear();
    });
  } catch (error) {
    worker = null;
  }
  let local = null;
  const call = (type, payload, transfer = [], progress) => {
    if (worker) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject, progress });
        worker.postMessage({ id, type, ...payload }, transfer);
      });
    }
    // A page with no module workers reads in this thread: slower, not broken.
    try {
      if (type === "parse") {
        local = parseMesh(new Uint8Array(payload.buffer), { onProgress: progress });
        return Promise.resolve({ ok: true, mesh: { ...local, tets: local.cellCount } });
      }
      if (type === "slice") return Promise.resolve({ ok: true, slice: sliceTets(local, payload.normal, payload.d) });
      if (type === "threshold") {
        const { keep, kept } = thresholdKeep(local, payload.scalar || null, payload);
        const got = local.dim === 3 ? exposedFaces(local, keep) : keptTriangles(local, keep);
        const flags = Int32Array.from(got.cells, (c) => (local.cellFlag ? local.cellFlag[c] : 0));
        return Promise.resolve({ ok: true, threshold: { triangles: got.triangles, flags, kept, of: local.cellCount } });
      }
      if (type === "iso") {
        const parts = payload.levels.map((L) => isoTets(local, payload.scalar, L));
        const n = parts.reduce((a, q) => a + q.t.length, 0);
        const iso = { a: new Int32Array(n), b: new Int32Array(n), t: new Float32Array(n), level: new Uint16Array(n) };
        let at = 0;
        parts.forEach((q, l) => { iso.a.set(q.a, at); iso.b.set(q.b, at); iso.t.set(q.t, at); iso.level.fill(l, at, at + q.t.length); at += q.t.length; });
        return Promise.resolve({ ok: true, iso });
      }
      if (type === "derive") return import(`./strain-stress.js${VERSION}`).then(async (ss) => {
        const t = await import(`./tomography.js${VERSION}`);
        const spec = payload.material;
        const grid = spec?.kind === "pointwise" && payload.gridText ? t.buildGrid(t.parseTable(payload.gridText), { dim: spec.dim }) : null;
        return { ok: true, derived: ss.derivedFields(local, new Float64Array(payload.u), payload.nbDofs, ss.materialAt(spec, grid?.ok ? grid : null, t.sampleGrid)) };
      });
      if (type === "locate") return import(`./gales-results.js${VERSION}`).then((g) => ({ ok: true, located: g.locatePoints(g.cellLocator(local), payload.points) }));
      if (type === "quality") return import(`./mesh-quality.js${VERSION}`).then((q) => ({ ok: true, analysis: local ? q.analyseMesh(local) : null }));
      if (type === "vtu") {
        const cells = vtkCells(local.cells, local.cellOffsets, local.dim);
        const flags = Int32Array.from(cells.source, (c) => local.cellFlag?.[c] ?? 0);
        const { parts, bytes } = vtuParts({ points: local.coords, cells, pointData: payload.pointData, cellData: [{ name: "volume_flag", components: 1, values: flags }], time: payload.time });
        return Promise.resolve({ ok: true, blob: new Blob(parts), bytes, cells: cells.count, part: "volume" });
      }
      return Promise.resolve({ ok: true });
    } catch (error) {
      return Promise.reject(error);
    }
  };
  reader = { call, threaded: Boolean(worker) };
  return reader;
}

// ── Sources: a folder chosen here, or a run in the open project ─────────────

async function asArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  if (data && typeof data.arrayBuffer === "function") return data.arrayBuffer();
  if (typeof data === "string") return new TextEncoder().encode(data).buffer;
  throw new Error("The file could not be read as bytes.");
}

/** A FileList from a folder picker: paths are the folder-relative ones. */
function folderSource(fileList) {
  const files = new Map();
  const entries = [];
  for (const file of fileList) {
    const path = file.webkitRelativePath || file.name;
    files.set(path, file);
    entries.push({ path, size: file.size });
  }
  const root = entries[0]?.path.split("/")[0] || "folder";
  return {
    label: root,
    entries,
    read: async (path) => files.get(path).arrayBuffer(),
    readRange: async (path, start, end) => files.get(path).slice(start, end).arrayBuffer(),
    text: async (path) => files.get(path).text(),
  };
}

/** A run folder in the open project, walked for input/, results/ and setup.txt. */
async function projectSource(runDir) {
  const store = window.GeoIDResearch?.store;
  if (!store?.listProjectDir) throw new Error("No project store on this page.");
  const entries = [];
  const walk = async (rel, depth) => {
    if (depth > 6) return;
    let list = [];
    try { list = await store.listProjectDir(rel); } catch (e) { return; }
    for (const item of list) {
      const path = `${rel}/${item.name}`;
      if (item.kind === "directory") {
        if (depth === 0 && !/^(input|results)$/.test(item.name)) continue;
        await walk(path, depth + 1);
      } else entries.push({ path, size: null });
    }
  };
  await walk(runDir, 0);
  let last = null;
  // `fresh` for a buffer that will be TRANSFERRED to the reader: a cached one
  // would be detached under the cache.
  const readWhole = async (path, { fresh = false } = {}) => {
    if (!fresh && last?.path === path) return last.buffer;
    const buffer = await asArrayBuffer(await store.readProjectFileBytes(path));
    if (!fresh) last = { path, buffer };
    return buffer;
  };
  return {
    label: runDir,
    entries,
    read: readWhole,
    readRange: async (path, start, end) => (await readWhole(path)).slice(start, end),
    text: async (path) => new TextDecoder().decode(await readWhole(path)),
  };
}

async function projectRuns() {
  const store = window.GeoIDResearch?.store;
  if (!store?.getActive?.() || !store.listProjectDir) return [];
  try {
    const runs = await store.listProjectDir("fem_runs");
    const out = [];
    for (const run of runs.filter((r) => r.kind === "directory")) {
      const inside = await store.listProjectDir(`fem_runs/${run.name}`).catch(() => []);
      if (inside.some((e) => e.name === "results")) out.push(`fem_runs/${run.name}`);
    }
    return out;
  } catch (e) {
    return [];
  }
}

/**
 * A source over files the reader handed over one door at a time, under the
 * paths a whole run would have had: a mesh at input/<name>, a step at
 * results/<field>/<time>. Planning and every read then work as they do for
 * a picked run folder.
 */
function filesSource(label, pairs) {
  const files = new Map(pairs);
  return {
    label,
    entries: [...files].map(([path, file]) => ({ path, size: file.size })),
    read: async (path) => files.get(path).arrayBuffer(),
    readRange: async (path, start, end) => files.get(path).slice(start, end).arrayBuffer(),
    text: async (path) => files.get(path).text(),
  };
}

/** A run with more files added to it: the added ones win where a path is in both. */
function composeSources(base, extra) {
  const mine = new Set(extra.entries.map((e) => e.path));
  const pick = (path) => (mine.has(path) ? extra : base);
  return {
    label: base.label,
    entries: [...base.entries.filter((e) => !mine.has(e.path)), ...extra.entries],
    read: (path, options) => pick(path).read(path, options),
    readRange: (path, start, end) => pick(path).readRange(path, start, end),
    text: (path) => pick(path).text(path),
  };
}

const relPath = (file) => file.webkitRelativePath || file.name;
const isStep = (file) => timeOf(file.name) !== null;
const isMeshFile = (file) => /\.msh$/i.test(file.name) || (/\.txt$/i.test(file.name) && !/^setup\.txt$/i.test(file.name));

/**
 * Files from any door into canonical pairs. `kind` is what the door was for:
 * "mesh" takes every file as a mesh, "results" every numbered file as a step,
 * "any" (a drop) sorts them by name.
 */
function canonicalPairs(fileList, kind) {
  const list = [...fileList];
  const pairs = [];
  const meshes = [];
  const meshFiles = kind === "results" ? [] : list.filter((f) => (kind === "mesh" ? true : isMeshFile(f)));
  for (const file of meshFiles) {
    const path = `input/${file.name}`;
    pairs.push([path, file]);
    meshes.push(path);
  }
  if (kind === "any") {
    const setup = list.find((f) => /^setup\.txt$/i.test(f.name));
    if (setup) pairs.push(["setup.txt", setup]);
  }
  const steps = kind === "mesh" ? [] : list.filter(isStep);
  const byPath = new Map(steps.map((f) => [relPath(f), f]));
  const fields = groupResultFiles(steps.map((f) => ({ path: relPath(f), size: f.size })), { looseField: S.looseField });
  let count = 0;
  for (const field of fields) {
    for (const step of field.steps) {
      pairs.push([`results/${field.field}/${step.name}`, byPath.get(step.path)]);
      count += 1;
    }
  }
  return { pairs, meshes, fields: fields.map((f) => f.field), steps: count, ignored: steps.length - count };
}

/**
 * Add files to the open run, or start one from them. A mesh opened by hand is
 * read at once; results added to a loaded mesh are classified against it
 * without reading the mesh again.
 */
async function addFiles(fileList, kind) {
  if (!fileList?.length) return;
  const got = canonicalPairs(fileList, kind);
  if (!got.pairs.length) {
    status(kind === "mesh"
      ? "Nothing to open as a mesh."
      : `No step files found: a step is a file named by its time (0, 1, 2.5…) inside a folder named for its field (solid/u, heat_eq/T…).${got.ignored ? ` ${got.ignored} numbered file(s) picked on their own need a field name first.` : ""}`, true);
    renderControls();
    return;
  }
  const extra = filesSource("added files", got.pairs);
  // A mesh opened onto a run that already has one is a different run: its
  // fields would only sit in the list as "another mesh". Results added, or a
  // mesh opened for results waiting without one, join what is open.
  const fresh = kind === "mesh" && Boolean(S.mesh);
  const source = S.source && !fresh ? composeSources(S.source, extra) : { ...extra, label: got.meshes[0]?.split("/").pop() || "added files" };
  stopPlay();
  if (fresh) cache.clear();
  S.source = source;
  S.material = undefined;
  S.meshHints = [...new Set([...got.meshes, ...(fresh ? [] : S.meshHints)])];
  const setup = source.entries.find((e) => /(^|\/)setup\.txt$/.test(e.path) && e.path.split("/").length <= 2);
  const setupText = setup ? await source.text(setup.path).catch(() => "") : "";
  S.plan = planSimulation(source.entries, setupText, { meshes: S.meshHints, looseField: S.looseField });
  const said = [
    got.meshes.length ? `${got.meshes.length} mesh${got.meshes.length > 1 ? "es" : ""}` : "",
    got.steps ? `${got.steps} step${got.steps > 1 ? "s" : ""} of ${got.fields.join(", ")}` : "",
  ].filter(Boolean).join(" and ");
  if (got.meshes.length) {
    await loadMesh(got.meshes[0]);
    if (!S.statusError) status(`${S.statusText} Added ${said}.`);
    return;
  }
  if (!S.mesh) {
    status(`Added ${said}. Open the mesh these belong to (Open mesh file…), or they cannot be placed on nodes.`, true);
    renderControls();
    return;
  }
  const keep = S.fields[S.field]?.field;
  classifyFields();
  const added = S.fields.findIndex((f) => f.ok && got.fields.includes(f.field));
  const kept = S.fields.findIndex((f) => f.field === keep);
  S.field = added >= 0 ? added : kept;
  const f = S.fields[S.field];
  S.step = f ? f.steps.length - 1 : 0;
  S.component = "";
  if (S.deform.field < 0) {
    S.deform.field = S.fields.findIndex((x) => x.ok && (x.desc?.displacement || (!x.desc && /(^|\/)(u|elastostatic_dofs|fluid_mesh)$/.test(x.field))));
  }
  const bad = S.fields.filter((x) => got.fields.includes(x.field) && !x.ok);
  status(`Added ${said}.${bad.length ? ` ${bad.map((x) => `${x.field}: ${x.reason}`).join(" ")}` : ""}`, Boolean(bad.length));
  openSection("field");
  renderControls();
  await refresh({ fit: false });
}

/** Everything under a dropped folder, with the paths it had inside it. */
async function droppedFiles(dataTransfer) {
  const out = [];
  const walk = async (entry, prefix) => {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      Object.defineProperty(file, "webkitRelativePath", { value: `${prefix}${file.name}` });
      out.push(file);
      return;
    }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  const entries = [...(dataTransfer.items || [])].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dataTransfer.files || [])];
  for (const entry of entries) await walk(entry, "");
  return out;
}

// ── Opening ─────────────────────────────────────────────────────────────────

async function openSource(source) {
  stopPlay();
  S.source = source;
  S.reference = null;
  S.meshHints = [];
  S.material = undefined;
  cache.clear();
  const setup = source.entries.find((e) => /(^|\/)setup\.txt$/.test(e.path) && e.path.split("/").length <= 2);
  const setupText = setup ? await source.text(setup.path).catch(() => "") : "";
  S.plan = planSimulation(source.entries, setupText, { looseField: S.looseField });
  if (!S.plan.fields.length) {
    status(`No results in ${source.label}: expected results/<field>/<time> files. Add them with Add results….`, true);
  }
  if (!S.plan.meshes.length) {
    status(`No mesh in ${source.label}: expected input/mesh_*.txt or a .msh.`, true);
    renderControls();
    return;
  }
  renderControls();
  await loadMesh(S.plan.meshes[0].path);
}

async function loadMesh(path) {
  const source = S.source;
  if (!source) return;
  const entry = source.entries.find((e) => e.path === path);
  S.busy = true;
  status(`Reading ${path}${entry?.size ? ` (${(entry.size / 1e6).toFixed(1)} MB)` : ""}…`);
  const started = performance.now();
  try {
    const buffer = await source.read(path, { fresh: true });
    const { mesh } = await getReader().call("parse", { buffer }, [buffer], (f) => status(`Reading ${path} — ${Math.round(f * 100)}%`));
    S.mesh = mesh;
    S.meshPath = path;
    S.slice = null;
    S.sliceKey = "";
    S.iso.key = "";
    S.iso.data = null;
    S.threshold.key = "";
    S.threshold.data = null;
    S.threshold.flags = [];
    S.probe = null;
    S.clipOn = null;
    S.stations = [];
    S.extract.fields = null;
    S.extract.result = null;
    locator = null;
    classifyFields();
    buildScene();
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    status(`${mesh.dim}D mesh: ${mesh.nodeCount.toLocaleString()} nodes, ${mesh.cellCount.toLocaleString()} elements, ${(mesh.surface.length / 3).toLocaleString()} boundary triangles${mesh.surfaceFrom === "derived" ? " (derived: the file has no sides)" : ""} — ${secs} s.`);
    openSection("field");
    const first = S.fields.findIndex((f) => f.ok);
    S.field = first;
    S.step = first >= 0 ? S.fields[first].steps.length - 1 : 0;
    S.component = "";
    // By name as well as by description: a project run's sizes are unknown
    // until a step is read, so its fields have no description yet.
    const disp = S.fields.findIndex((f) => f.ok && (f.desc?.displacement || (!f.desc && /(^|\/)(u|elastostatic_dofs|fluid_mesh)$/.test(f.field))));
    S.deform.field = disp;
    renderControls();
    await refresh({ fit: true });
  } catch (error) {
    status(`Could not read ${path}: ${error.message}`, true);
  } finally {
    S.busy = false;
  }
}

/** Which fields fit this mesh, from the sizes the listing already knows. */
function classifyFields() {
  const n = S.mesh?.nodeCount || 0;
  S.fields = (S.plan?.fields || []).map((f) => {
    const size = f.steps.find((s) => Number.isFinite(s.size))?.size;
    if (!Number.isFinite(size)) return { ...f, ok: true, desc: null, nbDofs: null, reason: "" };
    const fit = dofsPerNode(size, n);
    return fit.ok
      ? { ...f, ok: true, nbDofs: fit.nbDofs, desc: describeField(f.field, fit.nbDofs, S.mesh.dim), reason: "" }
      : { ...f, ok: false, nbDofs: null, desc: null, reason: fit.reason };
  });
  // STRESS AND STRAIN, derived from the displacement on demand: GALES's solid
  // writes u and nothing else. One derived field per displacement field, its
  // steps the displacement's, read through the reader worker.
  if (S.mesh?.dim === 3) {
    const u = S.fields.find((f) => f.ok && !f.derived && (f.desc ? f.desc.displacement && f.nbDofs >= 3 && !/fluid_mesh/.test(f.field) : /(^|\/)(solid\/u|u|elastostatic_dofs)$/.test(f.field)));
    if (u) {
      S.fields.push({
        field: "derived/stress", derived: true, from: u.field, ok: true, nbDofs: DERIVED_DOFS, reason: "",
        desc: describeField("derived/stress", DERIVED_DOFS, 3),
        steps: u.steps.map((st) => ({ ...st, path: `derived:${st.path}`, source: st.path, size: n * DERIVED_DOFS * 8 })),
      });
    }
  }
  // DIFFERENCES from a reference run: this run minus the reference, step by
  // step, as ordinary fields every view, analysis and export reads.
  if (S.reference) {
    for (const c of referencePlan(S.fields.filter((f) => f.ok), S.reference.fields)) {
      const base = S.fields.find((f) => f.field === c.from);
      S.fields.push({ ...c, ok: true, reason: "", nbDofs: base?.nbDofs ?? null, desc: base?.desc ? compareDesc(base.desc, c.field) : null });
    }
  }
}

/** The run's material, for the derived stresses: props.txt, and a pointwise grid file. */
async function runMaterial() {
  if (S.material !== undefined) return S.material;
  S.material = null;
  const src = S.source;
  const props = src?.entries.find((e) => /(^|\/)props\.txt$/.test(e.path) && !/(^|\/)(results|build)\//.test(e.path));
  if (!props) return null;
  try {
    const spec = parseSolidProps(await src.text(props.path));
    if (!spec) return null;
    let gridText = "";
    if (spec.kind === "pointwise") {
      const file = src.entries.find((e) => e.path.endsWith(`input/${spec.file}`));
      if (file) gridText = await src.text(file.path);
      else if (Number.isFinite(spec.fallback?.E) && Number.isFinite(spec.fallback?.nu)) S.material = { spec: { kind: "uniform", E: spec.fallback.E, nu: spec.fallback.nu }, gridText: "", note: `input/${spec.file} is not in this run: the uniform fallback is used` };
    }
    S.material = S.material || { spec, gridText, note: "" };
  } catch (e) {
    S.material = null;
  }
  return S.material;
}

async function valuesAt(fieldIndex, stepIndex) {
  const f = S.fields[fieldIndex];
  const step = f?.steps[stepIndex];
  if (!step) return null;
  if (cache.has(step.path)) {
    const hit = cache.get(step.path);
    cache.delete(step.path);
    cache.set(step.path, hit);
    return hit;
  }
  if (f.compare) {
    if (!S.reference) throw new Error("The reference run is no longer open.");
    const a = float64View(await S.source.read(step.base));
    const b = float64View(await S.reference.source.read(step.ref));
    const values = differenceOf(a, b);
    const nb = values.length / S.mesh.nodeCount;
    if (!Number.isInteger(nb)) throw new Error(`${f.field} @ ${step.name}: ${values.length} values do not divide ${S.mesh.nodeCount} nodes.`);
    if (!f.desc || f.nbDofs !== nb) {
      f.nbDofs = nb;
      f.desc = compareDesc(describeField(f.from, nb, S.mesh.dim), f.field);
    }
    cache.set(step.path, values);
    while (cache.size > CACHE_STEPS) cache.delete(cache.keys().next().value);
    return values;
  }
  if (f.derived) {
    const raw = float64View(await S.source.read(step.source));
    const base = S.fields.find((x) => x.field === f.from);
    const mat = await runMaterial();
    const u = Float64Array.from(raw);
    const { derived } = await getReader().call("derive", { u: u.buffer, nbDofs: raw.length / S.mesh.nodeCount, material: mat?.spec || null, gridText: mat?.gridText || "" }, [u.buffer]);
    f.stress = derived.stress;
    if (!derived.stress && !f.desc.label.includes("tilt only")) f.desc = { ...f.desc, label: "Stress, strain and tilt (strain and tilt only: no solid props.txt in this run)" };
    if (base && !base.desc) { base.nbDofs = raw.length / S.mesh.nodeCount; }
    cache.set(step.path, derived.values);
    while (cache.size > CACHE_STEPS) cache.delete(cache.keys().next().value);
    return derived.values;
  }
  const buffer = await S.source.read(step.path);
  const fit = dofsPerNode(buffer.byteLength, S.mesh.nodeCount);
  if (!fit.ok) {
    f.ok = false;
    f.reason = fit.reason;
    throw new Error(`${f.field} @ ${step.name}: ${fit.reason}`);
  }
  if (!f.desc || f.nbDofs !== fit.nbDofs) {
    f.nbDofs = fit.nbDofs;
    f.desc = describeField(f.field, fit.nbDofs, S.mesh.dim);
  }
  const values = float64View(buffer);
  cache.set(step.path, values);
  while (cache.size > CACHE_STEPS) cache.delete(cache.keys().next().value);
  return values;
}

/** The deformation field's step at (or nearest before) the shown time. */
function matchingStep(fieldIndex, time) {
  const steps = S.fields[fieldIndex]?.steps || [];
  let best = 0;
  for (let k = 0; k < steps.length; k += 1) if (steps[k].time <= time + 1e-12) best = k;
  return best;
}

// ── Scene ───────────────────────────────────────────────────────────────────

const scene = {
  root: null, frame: null, surface: null, slice: null, outline: null, marker: null,
  surfNodes: null, compact: null, base: null, centre: [0, 0, 0], radius: 1,
  parts: null, // what the studio's Visibility box switches: one group per part, so a refresh cannot undo it
  clip: new THREE.Plane(), clipLocal: new THREE.Plane(),
};

function studio() { return window.GeoIDMeshStudio; }

function disposeScene() {
  if (!scene.root) return;
  scene.root.parent?.remove(scene.root);
  studio()?.setExternalBounds?.("gales-results", null);
  scene.root.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
  });
  scene.root = null;
  scene.parts = null;
  scene.visKey = "";
  scene.listed = null;
  studio()?.refreshVisibility?.();
}

/**
 * The results' box in the studio's frame. A 2D mesh lies IN the ground plane,
 * so its box is given a hair of depth: the lattice then cuts its hole under
 * the mesh instead of z-fighting with it along every line.
 */
function resultBounds() {
  const { min, max } = S.mesh.bounds;
  const flat = S.mesh.dim === 2 || max[2] - min[2] === 0;
  return {
    minX: min[0] - scene.centre[0], maxX: max[0] - scene.centre[0],
    minY: min[1] - scene.centre[1], maxY: max[1] - scene.centre[1],
    minZ: flat ? Math.min(min[2], -Math.max(1, scene.radius * 1e-3)) : min[2], maxZ: max[2],
  };
}

function buildScene() {
  disposeScene();
  const mesh = S.mesh;
  const anchor = studio()?.ensureAnchor?.() || studio()?.getAnchor?.();
  if (!anchor || !mesh) {
    status("The studio's scene is not ready; open the Model page first.", true);
    return;
  }
  const { min, max } = mesh.bounds;
  // Centred in plan, kept at its own elevations: a mesh in survey metres sits
  // on the studio's origin rather than 50 km off it, and z still means height.
  scene.centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, mesh.dim === 3 ? 0 : 0];
  scene.radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const root = new THREE.Group();
  root.name = "gales-results";
  const frame = new THREE.Group();
  frame.matrixAutoUpdate = false;
  frame.matrix.copy(MODEL_TO_SCENE).multiply(new THREE.Matrix4().makeTranslation(-scene.centre[0], -scene.centre[1], -scene.centre[2]));
  root.add(frame);
  scene.root = root;
  scene.frame = frame;
  scene.stationGroup = null;
  /**
   * EACH PART IS ITS OWN GROUP. `refresh()` sets the surface, the slice and
   * the edges visible or not by the display choice on every step; a switch in
   * the Visibility box written onto those meshes would be undone by the next
   * one. A group above each holds the reader's choice and nothing else.
   */
  const part = (name) => { const g = new THREE.Group(); g.name = `gales-part-${name}`; frame.add(g); return g; };
  scene.parts = { surface: part("surface"), slice: part("slice"), edges: part("edges"), points: part("points"), contours: part("contours"), iso: part("iso"), threshold: part("threshold") };

  const nodes = usedNodes(mesh.surface, mesh.nodeCount);
  const compact = new Int32Array(mesh.nodeCount).fill(-1);
  nodes.forEach((node, k) => { compact[node] = k; });
  const index = new Uint32Array(mesh.surface.length);
  for (let k = 0; k < index.length; k += 1) index[k] = compact[mesh.surface[k]];
  const base = new Float32Array(nodes.length * 3);
  nodes.forEach((node, k) => {
    base[k * 3] = mesh.coords[node * 3];
    base[k * 3 + 1] = mesh.coords[node * 3 + 1];
    base[k * 3 + 2] = mesh.coords[node * 3 + 2];
  });
  scene.surfNodes = nodes;
  scene.compact = compact;
  scene.base = base;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(base.slice(), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(base.length).fill(0.7), 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // Pushed back a hair in depth, so contour lines drawn on it are not buried in it.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const surface = new THREE.Mesh(geometry, material);
  surface.name = "gales-surface";
  surface.frustumCulled = false;
  // The clip plane is written in the mesh's own frame and carried to world
  // space every frame, so it follows the anchor wherever the studio puts it.
  surface.onBeforeRender = () => {
    if (!material.clippingPlanes?.length) return;
    scene.clip.copy(scene.clipLocal).applyMatrix4(frame.matrixWorld);
  };
  scene.parts.surface.add(surface);
  scene.surface = surface;

  const sliceGeometry = new THREE.BufferGeometry();
  const slice = new THREE.Mesh(sliceGeometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  slice.name = "gales-slice";
  slice.visible = false;
  slice.frustumCulled = false;
  scene.parts.slice.add(slice);
  scene.slice = slice;

  if (mesh.edges?.length) {
    const pos = new Float32Array(mesh.edges.length * 3);
    for (let k = 0; k < mesh.edges.length; k += 1) {
      const node = mesh.edges[k];
      pos[k * 3] = mesh.coords[node * 3]; pos[k * 3 + 1] = mesh.coords[node * 3 + 1]; pos[k * 3 + 2] = mesh.coords[node * 3 + 2] + 1e-3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.outline = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x111111 }));
    scene.outline.frustumCulled = false;
    scene.parts.edges.add(scene.outline);
  } else scene.outline = null;

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  marker.renderOrder = 10;
  marker.visible = false;
  marker.scale.setScalar(scene.radius * 0.008);
  scene.parts.points.add(marker);
  scene.marker = marker;

  anchor.add(root);
  studio()?.refreshVisibility?.();
  // The ground lattice cuts a hole under the results and the camera may go
  // below them, as it does under a buried solid.
  studio()?.setExternalBounds?.("gales-results", resultBounds());
  const viewer = window.GeoIDViewer;
  if (viewer?.renderer) viewer.renderer.localClippingEnabled = true;
}

// ── The studio's Visibility box ─────────────────────────────────────────────

const PART_ROWS = [
  ["surface", "Boundary surface", 0x8fb8de],
  ["slice", "Slice / clip cut", 0xe0a458],
  ["edges", "Mesh edges", 0x444444],
  ["points", "Points and probes", 0xffd166],
  ["contours", "Contour lines", 0x222222],
  ["iso", "Isosurfaces", 0x9ad9dd],
  ["threshold", "Threshold", 0xff9bcd],
];

function anyPartShown() {
  return Boolean(scene.parts) && Object.values(scene.parts).some((g) => g.visible !== false);
}

/** The results' parts changed visibility: the lattice hole, the legend and the panel follow. */
function partsChanged() {
  studio()?.setExternalBounds?.("gales-results", anyPartShown() ? resultBounds() : null);
  renderControls();
  refresh();
}

function setAllParts(on) {
  if (!scene.parts) return;
  Object.values(scene.parts).forEach((g) => { g.visible = on; });
  partsChanged();
  studio()?.refreshVisibility?.();
}

/**
 * The results as a group of the Visibility box, one row per part that has
 * something in it: the slice only once a slice is shown, the edges only where
 * the mesh has them, the points only once there are some.
 */
function visibilityGroup() {
  if (!scene.root || !scene.parts) return null;
  const has = {
    surface: Boolean(scene.surface),
    slice: S.view !== "surface",
    edges: Boolean(scene.outline),
    points: Boolean(S.stations?.length || S.probe),
    contours: Boolean(S.contours.on),
    iso: Boolean(S.iso.on && S.mesh?.dim === 3),
    threshold: S.view === "threshold",
  };
  // A part that has just come to be (a slice shown, a first point placed)
  // arrives visible: a "Hide results" pressed before it existed was not about it.
  const listed = scene.listed || (scene.listed = new Set());
  for (const key of Object.keys(has)) {
    if (has[key] && !listed.has(key)) { listed.add(key); if (anyPartShown()) scene.parts[key].visible = true; }
    else if (!has[key]) listed.delete(key);
  }
  const desc = currentDesc();
  const name = S.fields[S.field]?.field || "";
  const parts = PART_ROWS.filter(([key]) => has[key]).map(([key, label, colour]) => ({
    id: `gales-${key}`, name: key === "surface" && name ? `${label} — ${name}` : label, face: label,
    kind: "results", mesh: scene.parts[key], colour,
    onVisible: () => { partsChanged(); },
  }));
  return { id: "gales-results", title: desc ? `FEM results — ${name}` : "FEM results", parts };
}

if (typeof window !== "undefined") {
  let tries = 0;
  const hook = () => {
    const st = window.GeoIDMeshStudio;
    if (st?.registerVisibility) st.registerVisibility("gales-results", visibilityGroup);
    else if (tries++ < 120) setTimeout(hook, 500);
  };
  hook();
}

// ── Refresh: field → colours, warp, slice, legend ───────────────────────────

// ── Satellite line of sight ─────────────────────────────────────────────────

const INSAR_KEY = "geoid-studio:insar";
function loadInsar() {
  try { return { ...DEFAULT_GEOMETRY, ...JSON.parse(localStorage.getItem(INSAR_KEY) || "{}") }; } catch (e) { return { ...DEFAULT_GEOMETRY }; }
}
function saveInsar() { try { localStorage.setItem(INSAR_KEY, JSON.stringify(S.insar)); } catch (e) { /* kept for the session */ } }
/** A satellite view needs a displacement with at least its two horizontal components, read from the solver rather than blocked. */
function canLos(desc) { return Boolean(desc?.displacement?.length >= 2 && !desc.blocked); }
function isSatellite() { return S.component === "los" || S.component === "fringe"; }
function platformLabel() {
  const p = PLATFORMS.find((q) => q.id === S.insar.platform);
  return p ? p.label : `heading ${S.insar.heading}°, incidence ${S.insar.incidence}°`;
}

/** Fringe count and whether the mesh can draw them: more than one fringe across an edge is aliased. */
function satelliteNote(los) {
  const nodes = scene.surfNodes;
  const idx = scene.surface?.geometry?.index?.array;
  if (!nodes || !idx) return "";
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < nodes.length; k += 1) { const v = los[nodes[k]]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const [e, n, u] = losVector(S.insar);
  const vec = `LOS (east, north, up) = ${e.toFixed(3)}, ${n.toFixed(3)}, ${u.toFixed(3)}.`;
  if (!(hi >= lo)) return vec;
  const count = fringeCount(lo, hi, S.insar.wavelength);
  const edges = new Uint32Array(idx.length * 2);
  for (let t = 0; t < idx.length; t += 3) {
    for (let c = 0; c < 3; c += 1) { edges[t * 2 + c * 2] = nodes[idx[t + c]]; edges[t * 2 + c * 2 + 1] = nodes[idx[t + (c + 1) % 3]]; }
  }
  const per = fringesPerEdge(los, edges, S.insar.wavelength);
  const range = `LOS ${formatValue(lo, hi - lo || 1)} to ${formatValue(hi, hi - lo || 1)} m on the surface — ${count < 10 ? `${count.toFixed(1)} fringe${count.toFixed(1) === "1.0" ? "" : "s"}` : count < 10000 ? `${Math.round(count).toLocaleString()} fringes` : `${count.toExponential(1)} fringes`}.`;
  const alias = per > 0.5 ? ` Up to ${per < 100 ? per.toFixed(2) : Math.round(per).toLocaleString()} fringes across one surface edge (more than half a fringe cannot be resolved): the pattern is ALIASED (a picture of the mesh, not the deformation). Use a longer wavelength or a smaller displacement.` : "";
  return `${vec} ${range}${alias}`;
}

function currentDesc() { return S.fields[S.field]?.desc || null; }

function scalarOf(values, desc) {
  const n = S.mesh.nodeCount;
  const nb = desc.nbDofs;
  if (S.component === "mag" && desc.vector) return magnitudeOf(values, n, nb, desc.vector.from, desc.blocked);
  if (isSatellite() && canLos(desc)) {
    const los = losDisplacement(values, n, nb, desc.displacement, S.insar);
    const k = Number(S.insar.scale) || 1;
    if (k !== 1) for (let i = 0; i < los.length; i += 1) los[i] *= k;
    S.losRaw = los;
    return S.component === "fringe" ? wrapFringes(los, S.insar.wavelength) : los;
  }
  const j = Number(S.component);
  return componentOf(values, n, nb, Number.isInteger(j) && j >= 0 && j < nb ? j : 0, desc.blocked);
}

function componentLabel(desc) {
  if (!desc) return "";
  if (S.component === "mag" && desc.vector) return `${desc.vector.label}${desc.vector.unit ? ` (${desc.vector.unit})` : ""}`;
  if (S.component === "los" && canLos(desc)) return `LOS displacement (m, + toward the satellite)${(Number(S.insar.scale) || 1) !== 1 ? ` · solution ×${S.insar.scale}` : ""}`;
  if (S.component === "fringe" && canLos(desc)) return `Interferogram fringes — one cycle per ${formatValue(S.insar.wavelength * 50, 1)} cm of range`;
  const c = desc.components[Number(S.component)] || desc.components[0];
  return `${c.label}${c.unit ? ` (${c.unit})` : ""}`;
}

async function sliceFor(view) {
  if (S.mesh.dim !== 3 || !(view === "slice" || view === "clip" || view === "both")) return null;
  const plane = axisPlane(S.mesh.bounds, S.sliceAxis, S.slicePos);
  const key = `${S.meshPath}|${S.sliceAxis}|${S.slicePos}`;
  if (S.sliceKey !== key || !S.slice) {
    const { slice } = await getReader().call("slice", { normal: plane.normal, d: plane.d });
    S.slice = slice;
    S.sliceKey = key;
  }
  return { plane, slice: S.slice };
}

async function refresh({ fit = false } = {}) {
  if (!S.mesh || !scene.root) return;
  if (S.busy && !fit) { S.pending = true; return; }
  S.busy = true;
  try {
    const f = S.fields[S.field];
    const hasField = Boolean(f?.ok);
    let scalar = null;
    let desc = null;
    if (hasField) {
      const values = await valuesAt(S.field, S.step);
      desc = f.desc;
      if (!S.component || (S.component === "mag" && !desc.vector) || (isSatellite() && !canLos(desc)) || (S.component !== "mag" && !isSatellite() && Number(S.component) >= desc.nbDofs)) {
        S.component = desc.vector ? "mag" : desc.defaultComponent || "0";
        renderControls();
      }
      scalar = scalarOf(values, desc);
    }
    // The analysis tab reads the scalar too, between this refresh's awaits:
    // keep this step's LOS rather than whatever it last left in S.losRaw.
    const losHere = S.losRaw;

    // Warp: a displacement field at the same time, if one is chosen.
    let disp = null;
    const df = S.fields[S.deform.field];
    if (S.deform.on && df?.ok) {
      const time = f?.steps[S.step]?.time ?? 0;
      const dv = await valuesAt(S.deform.field, matchingStep(S.deform.field, time));
      const dd = df.desc;
      if (dd?.displacement) {
        disp = new Float32Array(S.mesh.nodeCount * 3);
        const comps = dd.displacement;
        for (let a = 0; a < comps.length; a += 1) {
          const col = componentOf(dv, S.mesh.nodeCount, dd.nbDofs, comps[a], dd.blocked);
          for (let i = 0; i < S.mesh.nodeCount; i += 1) disp[i * 3 + a] = col[i] * S.deform.scale;
        }
      }
    }

    const view = S.mesh.dim === 3 ? S.view : S.view === "threshold" ? "threshold" : "surface";
    const sliced = await sliceFor(view);

    // Range over what is drawn.
    let sliceValues = null;
    const fringe = S.component === "fringe" && canLos(desc);
    // Fringes are wrapped: interpolate the LOS first and wrap after, or a cut
    // through a wrap reads a whole rainbow between two neighbouring nodes.
    if (sliced && scalar) sliceValues = fringe ? wrapFringes(interpolateOnSlice(sliced.slice, losHere), S.insar.wavelength) : interpolateOnSlice(sliced.slice, scalar);
    if (scalar && S.rangeMode === "step") {
      const parts = [];
      if (view !== "slice") parts.push(rangeOf(scalar, scene.surfNodes));
      if (sliceValues?.length) parts.push(rangeOf(sliceValues));
      const lo = Math.min(...parts.map((p) => p[0]));
      const hi = Math.max(...parts.map((p) => p[1]));
      S.range = Number.isFinite(lo) ? [lo, hi] : [0, 0];
    }
    const [lo, hi] = fringe ? [0, 1] : S.range;
    const table = fringe ? colormapTable(null, { stops: FRINGE_MAP }) : colormapTable(S.colormap, { reverse: S.reverse });
    const paint = fringe ? { bands: 0, log: false } : { bands: S.bands, log: S.log };
    S.insarNote = isSatellite() && losHere ? satelliteNote(losHere) : "";

    // Surface.
    const geometry = scene.surface.geometry;
    const pos = geometry.attributes.position.array;
    const col = geometry.attributes.color.array;
    const nodes = scene.surfNodes;
    if (disp) for (let k = 0; k < nodes.length; k += 1) {
      const i = nodes[k];
      pos[k * 3] = scene.base[k * 3] + disp[i * 3];
      pos[k * 3 + 1] = scene.base[k * 3 + 1] + disp[i * 3 + 1];
      pos[k * 3 + 2] = scene.base[k * 3 + 2] + disp[i * 3 + 2];
    } else pos.set(scene.base);
    let onSurface = null;
    if (scalar) {
      onSurface = new Float32Array(nodes.length);
      for (let k = 0; k < nodes.length; k += 1) onSurface[k] = scalar[nodes[k]];
      colourValues(onSurface, lo, hi, table, col, paint);
    } else col.fill(0.72);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = scene.surface.material;
    const clipOn = view === "clip";
    // A change of clip state recompiles the program; the same state does not,
    // or every step of a play would pay for it.
    if (S.clipOn !== clipOn) {
      material.clippingPlanes = clipOn ? [scene.clip] : null;
      material.needsUpdate = true;
      S.clipOn = clipOn;
    }
    const translucent = S.opacity < 1 || view === "both";
    material.transparent = translucent;
    material.opacity = view === "both" ? Math.min(S.opacity, 0.25) : S.opacity;
    material.depthWrite = !translucent;
    if (material.wireframe !== S.edges) { material.wireframe = S.edges; material.needsUpdate = true; }
    scene.surface.visible = view !== "slice" && view !== "threshold";
    if (sliced) {
      const n = sliced.plane.normal;
      // THE CUT FACE TURNS TOWARD THE STUDIO'S OWN VIEW. Fit and Iso look from
      // +x and from model −y (scene +z is south) and from above, so the half
      // kept is x ≤ d, y ≥ d and z ≤ d; kept the other way the cut faces
      // away and the clip reads as the whole model. Flip keeps the other half.
      const keepAbove = (S.sliceAxis === "y") !== S.clipFlip;
      const sign = keepAbove ? 1 : -1;
      scene.clipLocal.set(new THREE.Vector3(sign * n[0], sign * n[1], sign * n[2]), -sign * sliced.plane.d);
    }
    if (scene.outline) scene.outline.visible = view !== "slice" && view !== "threshold";

    // Slice.
    let slicePositions = null;
    if (sliced) {
      const s = sliced.slice;
      const positions = interpolateOnSlice(s, S.mesh.coords, 3, new Float32Array(s.t.length * 3));
      slicePositions = positions;
      if (disp) {
        const dOn = interpolateOnSlice(s, disp, 3);
        for (let k = 0; k < positions.length; k += 1) positions[k] += dOn[k];
      }
      const colours = new Float32Array(s.t.length * 3);
      if (sliceValues) colourValues(sliceValues, lo, hi, table, colours, paint);
      else colours.fill(0.72);
      const g = scene.slice.geometry;
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      scene.slice.visible = true;
    } else scene.slice.visible = false;

    drawContours({ scalar: !fringe && scalar, onSurface: !fringe && onSurface, pos, index: geometry.index?.array, view, slicePositions, sliceValues: !fringe && sliceValues, lo, hi, table });
    await drawIsosurfaces({ scalar: fringe ? null : scalar, f, disp, lo, hi, table });
    await drawThreshold({ view, scalar: fringe ? (losHere || scalar) : scalar, colourScalar: scalar, f, disp, lo, hi, table, paint });
    updateProbeMarker(disp);
    updateStationMarkers(disp);
    // The box names the field and lists the slice once there is one: redraw it
    // when that changes, never on every step of a play.
    const g = visibilityGroup();
    const visKey = g ? `${g.title}|${g.parts.map((p) => p.id).join(",")}` : "";
    if (visKey !== scene.visKey) { scene.visKey = visKey; studio()?.refreshVisibility?.(); }
    if (view === "threshold" && S.threshold.colourBy === "flag") renderFlagLegend();
    else renderLegend(desc, lo, hi, table, paint);
    const noteNode = byId("gales-insar-note");
    if (noteNode) { noteNode.textContent = S.insarNote; noteNode.classList.toggle("is-warning", /ALIASED/.test(S.insarNote)); }
    renderStepReadout();
    if (fit) studio()?.fitObject?.(scene.surface);
    if (S.probe) renderProbe();
  } catch (error) {
    status(error.message, true);
  } finally {
    S.busy = false;
    if (S.pending) { S.pending = false; refresh(); }
  }
}

// ── Contours and isosurfaces ───────────────────────────────────────────────
//
// Lines of equal value on what is drawn (the surface, the slice), and surfaces
// of equal value through the volume. Both are drawn at levels in the field's
// own units, and follow the step, the component and the warp. Not for wrapped
// fringes: a fringe already IS a contour of range, and contouring a wrap
// draws every jump as a line.

function disposeGroup(group) {
  if (!group) return;
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  }
}

function drawContours({ scalar, onSurface, pos, index, view, slicePositions, sliceValues, lo, hi, table }) {
  const group = scene.parts?.contours;
  disposeGroup(group);
  S.contours.levels = [];
  if (!group || !S.contours.on || !scalar) return;
  const levels = contourLevels(lo, hi, S.contours.count);
  S.contours.levels = levels;
  if (!levels.length) return;
  const pieces = [];
  if (view !== "slice" && onSurface && index) pieces.push(contourSegments(pos, onSurface, index, levels));
  if (slicePositions && sliceValues) pieces.push(contourSegments(slicePositions, sliceValues, null, levels));
  const n = pieces.reduce((a, p) => a + p.positions.length, 0);
  if (!n) return;
  const positions = new Float32Array(n);
  const colours = new Float32Array(n);
  let at = 0;
  const levelColour = levels.map((L) => {
    const c = new Float32Array(3);
    colourValues(new Float32Array([L]), lo, hi, table, c, { bands: 0, log: false });
    return c;
  });
  const fixed = S.contours.colour === "light" ? [0.95, 0.95, 0.95] : [0.07, 0.07, 0.09];
  for (const p of pieces) {
    positions.set(p.positions, at);
    for (let v = 0; v < p.level.length; v += 1) {
      const c = S.contours.colour === "value" ? levelColour[p.level[v]] : fixed;
      colours[at + v * 3] = c[0]; colours[at + v * 3 + 1] = c[1]; colours[at + v * 3 + 2] = c[2];
    }
    at += p.positions.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  // In clip view they are cut where the surface is: a line drawn on the half
  // taken away floats over nothing.
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, clippingPlanes: view === "clip" ? [scene.clip] : null }));
  lines.name = "gales-contours";
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  group.add(lines);
}

// ── Threshold ───────────────────────────────────────────────────────────────

const FLAG_COLOURS = ["#52e4e8", "#ff2bd6", "#ffc857", "#7bd88f", "#b48cff", "#ff8a5b", "#e8eaf2", "#5aa9ff", "#f2e85c", "#6ee7b7"];
const flagColour = (flag) => {
  const list = (S.mesh?.volumeFlags || []).map((f) => f.flag);
  const k = Math.max(0, list.indexOf(flag));
  return FLAG_COLOURS[k % FLAG_COLOURS.length];
};

/** The threshold's bounds as numbers: a blank end is open. */
function thresholdRange() {
  const T = S.threshold;
  const num = (v, open) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? open : Number(v));
  return { lo: num(T.lo, -Infinity), hi: num(T.hi, Infinity) };
}

async function drawThreshold({ view, scalar, colourScalar, f, disp, lo, hi, table, paint }) {
  const group = scene.parts?.threshold;
  disposeGroup(group);
  if (!group || view !== "threshold") return;
  const T = S.threshold;
  const { lo: tlo, hi: thi } = thresholdRange();
  const bounded = Number.isFinite(tlo) || Number.isFinite(thi);
  const key = `${S.meshPath}|${bounded ? `${f?.field}|${S.step}|${S.component}|${tlo}|${thi}|${T.mode}` : "flags"}|${T.flags.join(",")}|${S.reference?.label || ""}`;
  if (T.key !== key || !T.data) {
    const copy = bounded && scalar ? Float32Array.from(scalar) : null;
    T.data = (await getReader().call("threshold", { scalar: copy, lo: tlo, hi: thi, flags: T.flags, mode: T.mode }, copy ? [copy.buffer] : [])).threshold;
    T.key = key;
  }
  const d = T.data;
  const tris = d.triangles;
  const nv = tris.length;
  if (!nv) return;
  const positions = new Float32Array(nv * 3);
  const colours = new Float32Array(nv * 3);
  const c = S.mesh.coords;
  const values = colourScalar && T.colourBy !== "flag" ? new Float32Array(nv) : null;
  for (let v = 0; v < nv; v += 1) {
    const i = tris[v];
    positions[v * 3] = c[i * 3] + (disp ? disp[i * 3] : 0);
    positions[v * 3 + 1] = c[i * 3 + 1] + (disp ? disp[i * 3 + 1] : 0);
    positions[v * 3 + 2] = c[i * 3 + 2] + (disp ? disp[i * 3 + 2] : 0);
    if (values) values[v] = colourScalar[i];
  }
  if (values) colourValues(values, lo, hi, table, colours, paint);
  else if (T.colourBy === "flag") {
    const rgb = new Map();
    for (let face = 0; face < d.flags.length; face += 1) {
      const flag = d.flags[face];
      if (!rgb.has(flag)) { const col = new THREE.Color(flagColour(flag)); rgb.set(flag, [col.r, col.g, col.b]); }
      const [r, g, b] = rgb.get(flag);
      for (let k = 0; k < 3; k += 1) { colours[(face * 3 + k) * 3] = r; colours[(face * 3 + k) * 3 + 1] = g; colours[(face * 3 + k) * 3 + 2] = b; }
    }
  } else colours.fill(0.72);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, wireframe: S.edges, transparent: S.opacity < 1, opacity: S.opacity, depthWrite: S.opacity >= 1 }));
  mesh.name = "gales-threshold";
  mesh.frustumCulled = false;
  group.add(mesh);
}

function renderFlagLegend() {
  const node = legendNode();
  if (!node) return;
  const d = S.threshold.data;
  if (!d || !scene.root?.visible || !anyPartShown()) { node.hidden = true; return; }
  node.hidden = false;
  node.textContent = "";
  node.append(el("div", { class: "gales-legend-title" }, "Volume flag"));
  node.append(el("div", { class: "gales-legend-sub" }, `${d.kept.toLocaleString()} of ${d.of.toLocaleString()} elements kept`));
  const shown = new Set(d.flags);
  const list = el("div", { class: "gales-legend-flags" });
  for (const { flag, count } of S.mesh.volumeFlags || []) {
    if (!shown.has(flag)) continue;
    list.append(el("span", {}, el("i", { style: `background:${flagColour(flag)}` }), `${flag} · ${count.toLocaleString()}`));
  }
  node.append(list);
}

/** Levels typed as numbers, else three through the middle of the range. */
export function isoLevelsFor(text, lo, hi) {
  const typed = String(text || "").split(/[,;\s]+/).map(Number).filter(Number.isFinite);
  if (typed.length) return typed.slice(0, 8);
  if (!(hi > lo)) return [];
  return [0.25, 0.5, 0.75].map((f) => Number((lo + (hi - lo) * f).toPrecision(3)));
}

async function drawIsosurfaces({ scalar, f, disp, lo, hi, table }) {
  const group = scene.parts?.iso;
  disposeGroup(group);
  const I = S.iso;
  I.used = [];
  if (!group || !I.on || !scalar || S.mesh.dim !== 3) return;
  const levels = isoLevelsFor(I.levels, lo, hi);
  I.used = levels;
  if (!levels.length) return;
  const key = `${S.meshPath}|${f?.field}|${S.step}|${S.component}|${levels.join(",")}|${S.reference?.label || ""}`;
  if (I.key !== key || !I.data) {
    const copy = Float32Array.from(scalar);
    I.data = (await getReader().call("iso", { scalar: copy, levels }, [copy.buffer])).iso;
    I.key = key;
  }
  const iso = I.data;
  if (!iso.t.length) return;
  const positions = interpolateOnSlice(iso, S.mesh.coords, 3, new Float32Array(iso.t.length * 3));
  if (disp) {
    const dOn = interpolateOnSlice(iso, disp, 3);
    for (let k = 0; k < positions.length; k += 1) positions[k] += dOn[k];
  }
  const colours = new Float32Array(iso.t.length * 3);
  const levelColour = levels.map((L) => {
    const c = new Float32Array(3);
    colourValues(new Float32Array([L]), lo, hi, table, c, { bands: 0, log: false });
    return c;
  });
  for (let v = 0; v < iso.level.length; v += 1) colours.set(levelColour[iso.level[v]], v * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  g.computeVertexNormals();
  const translucent = I.opacity < 1;
  const clip = (S.mesh.dim === 3 ? S.view : "surface") === "clip" ? [scene.clip] : null;
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: translucent, opacity: I.opacity, depthWrite: !translucent, clippingPlanes: clip }));
  mesh.name = "gales-isosurfaces";
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  group.add(mesh);
}

// ── Probe ───────────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
let pressed = null;

function installProbe() {
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (!canvas || canvas.dataset.galesProbe) return Boolean(canvas);
  canvas.dataset.galesProbe = "1";
  canvas.addEventListener("pointerdown", (e) => { pressed = { x: e.clientX, y: e.clientY }; });
  // No stopPropagation: OrbitControls needs the release, and the studio's own
  // picker finds nothing of ours to select.
  canvas.addEventListener("pointerup", (e) => {
    if (!pressed || window.GeoIDModeManager?.getMode?.() !== "model" || !scene.root) return;
    const moved = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y);
    pressed = null;
    if (moved > 6 || e.button !== 0) return;
    probeAt(e.clientX, e.clientY, canvas);
  });
  return true;
}

function probeAt(clientX, clientY, canvas) {
  const viewer = window.GeoIDViewer;
  // A part switched off in the Visibility box is not there to probe.
  const targets = [scene.surface, scene.slice].filter((o) => o?.visible && o.parent?.visible !== false);
  if (!targets.length || !viewer?.camera) return;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, viewer.camera);
  let hits = raycaster.intersectObjects(targets, false);
  // A clipped-away part of the surface is still geometry to a raycaster.
  if (S.view === "clip") hits = hits.filter((h) => h.object !== scene.surface || scene.clip.distanceToPoint(h.point) >= 0);
  const hit = hits[0];
  if (!hit) return;
  let candidates;
  if (hit.object === scene.surface) {
    const idx = scene.surface.geometry.index.array;
    const f = hit.faceIndex * 3;
    candidates = [idx[f], idx[f + 1], idx[f + 2]].map((k) => scene.surfNodes[k]);
  } else {
    const s = S.slice;
    const v = hit.faceIndex * 3;
    candidates = [s.a[v], s.b[v], s.a[v + 1], s.b[v + 1], s.a[v + 2], s.b[v + 2]];
  }
  const local = scene.frame.worldToLocal(hit.point.clone());
  let best = candidates[0];
  let bestD = Infinity;
  for (const node of candidates) {
    const d = (S.mesh.coords[node * 3] - local.x) ** 2 + (S.mesh.coords[node * 3 + 1] - local.y) ** 2 + (S.mesh.coords[node * 3 + 2] - local.z) ** 2;
    if (d < bestD) { bestD = d; best = node; }
  }
  S.probe = { node: best, series: null, seriesField: -1 };
  openSection("probe");
  refresh();
}

function updateProbeMarker(disp) {
  const m = scene.marker;
  if (!m) return;
  if (!S.probe) { m.visible = false; return; }
  const i = S.probe.node;
  const c = S.mesh.coords;
  m.position.set(c[i * 3] + (disp ? disp[i * 3] : 0), c[i * 3 + 1] + (disp ? disp[i * 3 + 1] : 0), c[i * 3 + 2] + (disp ? disp[i * 3 + 2] : 0));
  m.visible = true;
}

async function renderProbe() {
  const host = byId("gales-probe");
  if (!host) return;
  host.textContent = "";
  if (!S.probe || !S.mesh) {
    host.append(el("div", { class: "studio-readout" }, "Click the model to read the field at the nearest node."));
    return;
  }
  const i = S.probe.node;
  const c = S.mesh.coords;
  const f = S.fields[S.field];
  const rows = [["Node", String(i)], ["x, y, z (m)", `${formatValue(c[i * 3], 1e3)}, ${formatValue(c[i * 3 + 1], 1e3)}, ${formatValue(c[i * 3 + 2], 1e3)}`]];
  if (f?.ok && f.desc) {
    const values = await valuesAt(S.field, S.step).catch(() => null);
    if (values) {
      const d = f.desc;
      rows.push(["Time", String(f.steps[S.step].name)]);
      d.components.forEach((comp, j) => {
        const v = d.blocked ? values[j * S.mesh.nodeCount + i] : values[i * d.nbDofs + j];
        rows.push([`${comp.label}${comp.unit ? ` (${comp.unit})` : ""}`, formatValue(v, Math.abs(v) || 1)]);
      });
      if (d.vector) {
        const mag = Math.hypot(...d.vector.from.map((j) => (d.blocked ? values[j * S.mesh.nodeCount + i] : values[i * d.nbDofs + j])));
        rows.push([`${d.vector.label}${d.vector.unit ? ` (${d.vector.unit})` : ""}`, formatValue(mag, mag || 1)]);
      }
    }
  }
  const table = el("div", { class: "gales-kv" });
  rows.forEach(([k, v]) => table.append(el("span", {}, k), el("b", {}, v)));
  host.append(table);
  const actions = el("div", { class: "studio-actions" });
  const plot = el("button", { class: "studio-secondary", type: "button" }, "Plot over time");
  const csv = el("button", { class: "studio-secondary", type: "button" }, "CSV");
  const clear = el("button", { class: "studio-secondary", type: "button" }, "Clear");
  plot.disabled = !f?.ok || f.steps.length < 2;
  csv.disabled = !f?.ok;
  actions.append(plot, csv, clear);
  host.append(actions);
  const canvas = el("canvas", { class: "gales-plot", width: "300", height: "140" });
  host.append(canvas);
  canvas.hidden = !(S.probe.series && S.probe.seriesField === S.field);
  if (!canvas.hidden) drawSeries(canvas, S.probe.series, f.desc);
  plot.addEventListener("click", async () => {
    await probeSeries();
    renderProbe();
  });
  csv.addEventListener("click", async () => {
    if (!(S.probe.series && S.probe.seriesField === S.field)) await probeSeries();
    const node = S.probe.node;
    const text = probeCsv(S.probe.series, f.desc, { node, x: c[node * 3], y: c[node * 3 + 1], z: c[node * 3 + 2] });
    downloadText(`gales_${f.field.replace(/\W+/g, "_")}_node${node}.csv`, text, "text/csv");
  });
  clear.addEventListener("click", () => { S.probe = null; scene.marker && (scene.marker.visible = false); renderProbe(); });
  const keep = el("button", { class: "studio-secondary", type: "button" }, "Add as a point");
  keep.title = "Keep this node in Points and time series";
  keep.addEventListener("click", () => {
    const i = S.probe.node;
    addStations([{ name: `node${i}`, node: i, x: c[i * 3], y: c[i * 3 + 1], z: c[i * 3 + 2], flag: S.mesh.nodeFlag?.[i] || null, distance: 0, source: "probe" }]);
    openSection("points");
  });
  actions.append(keep);
}

/** The probe's node through every step, reading only its own bytes where it can. */
async function probeSeries() {
  const f = S.fields[S.field];
  if (!f?.ok || !S.probe) return;
  const node = S.probe.node;
  const series = [];
  for (let k = 0; k < f.steps.length; k += 1) {
    const step = f.steps[k];
    status(`Reading node ${node} through ${f.field}: ${k + 1} / ${f.steps.length}`);
    let values;
    const nb = f.nbDofs;
    // A derived field has no bytes of its own on disk: it is computed per step.
    const range = nb && !f.desc?.blocked && !f.derived && !f.compare ? nodeByteRange(node, S.mesh.nodeCount, nb) : null;
    if (range) {
      const part = float64View(await S.source.readRange(step.path, range[0], range[1]));
      values = [...part];
    } else {
      const all = await valuesAt(S.field, k);
      const d = f.desc;
      values = d.components.map((_, j) => (d.blocked ? all[j * S.mesh.nodeCount + node] : all[node * d.nbDofs + j]));
    }
    series.push({ time: step.time, values });
  }
  S.probe.series = series;
  S.probe.seriesField = S.field;
  status(`Node ${node}: ${series.length} steps of ${f.field}.`);
}

function drawSeries(canvas, series, desc) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const comp = S.component === "mag" && desc.vector ? null : Number(S.component) || 0;
  const ys = series.map((r) => (comp === null ? Math.hypot(...desc.vector.from.map((j) => r.values[j])) : r.values[comp]));
  const ts = series.map((r) => r.time);
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const L = 46; const R = 8; const T = 8; const B = 20;
  const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const ink = getComputedStyle(canvas).color || "#cfe";
  ctx.strokeStyle = "rgba(160,170,190,0.35)";
  ctx.fillStyle = ink;
  ctx.font = "10px 'Exo 2', sans-serif";
  ctx.lineWidth = 1;
  niceTicks(y0, y1, 4).forEach((v) => {
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke();
    ctx.fillText(formatValue(v, y1 - y0), 2, Y(v) + 3);
  });
  ctx.fillText(formatValue(t0, t1 - t0 || 1), L, H - 5);
  const tl = formatValue(t1, t1 - t0 || 1);
  ctx.fillText(tl, W - R - ctx.measureText(tl).width, H - 5);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--nav-accent").trim() || "#ff2bd6";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ys.forEach((v, k) => (k ? ctx.lineTo(X(ts[k]), Y(v)) : ctx.moveTo(X(ts[k]), Y(v))));
  ctx.stroke();
  const cur = S.fields[S.field]?.steps[S.step]?.time;
  if (Number.isFinite(cur)) {
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath(); ctx.moveTo(X(cur), T); ctx.lineTo(X(cur), H - B); ctx.stroke();
  }
}

// ── Satellite controls ──────────────────────────────────────────────────────

function satelliteControls() {
  const box = el("div", { class: "gales-satellite" });
  const set = (patch, { custom = true } = {}) => {
    S.insar = { ...S.insar, ...patch, ...(custom ? { platform: "custom" } : {}) };
    saveInsar();
    renderControls();
    refresh();
  };
  box.append(row("Satellite", select([...PLATFORMS.map((p) => [p.id, p.label]), ["custom", "Custom geometry"]], S.insar.platform, (v) => {
    const p = PLATFORMS.find((q) => q.id === v);
    set(p ? { heading: p.heading, incidence: p.incidence, wavelength: p.wavelength, look: "right", platform: p.id } : {}, { custom: !p });
  })));
  const num = (label, key, title, stepv = "any") => {
    const input = el("input", { class: "studio-input", type: "number", step: stepv, value: String(S.insar[key]), title });
    // The scale is not a geometry: changing it keeps the named satellite.
    input.addEventListener("change", () => { const v = Number(input.value); if (Number.isFinite(v)) set({ [key]: v }, { custom: key !== "scale" }); });
    return row(label, input);
  };
  box.append(num("Heading (°)", "heading", "The satellite's flight direction, clockwise from north (ascending ≈ −12°, descending ≈ −168°)"));
  box.append(num("Incidence (°)", "incidence", "The angle at the ground between the vertical and the line of sight"));
  box.append(num("Wavelength (m)", "wavelength", "C-band 0.0555, L-band 0.2424, X-band 0.0312"));
  box.append(num("Scale the solution ×", "scale", "A linear elastic solution scales with its source: ×0.001 turns a 1 MPa chamber into 1 kPa. Scaling here changes what the satellite sees, never the field shown elsewhere"));
  box.append(row("Looks", select([["right", "Right of track"], ["left", "Left of track"]], S.insar.look, (v) => set({ look: v }))));
  box.append(el("div", { class: "studio-readout" }, "The mesh is read as x east, y north, z up. Positive LOS is toward the satellite, so uplift is positive from either pass."));
  box.append(el("div", { id: "gales-insar-note", class: `studio-readout${/ALIASED/.test(S.insarNote) ? " is-warning" : ""}` }, S.insarNote));
  return box;
}

// ── Legend ──────────────────────────────────────────────────────────────────

function legendNode() {
  let node = byId("gales-legend");
  if (node) return node;
  const host = byId("model-studio");
  if (!host) return null;
  node = el("div", { id: "gales-legend", class: "gales-legend", hidden: "" });
  host.append(node);
  return node;
}

function renderLegend(desc, lo, hi, table, paint = { bands: S.bands, log: S.log }) {
  const node = legendNode();
  if (!node) return;
  if (!desc || !scene.root?.visible || !anyPartShown()) { node.hidden = true; return; }
  node.hidden = false;
  node.textContent = "";
  const f = S.fields[S.field];
  node.append(el("div", { class: "gales-legend-title" }, componentLabel(desc)));
  node.append(el("div", { class: "gales-legend-sub" }, `${f.field} · t = ${f.steps[S.step]?.name} · ${isSatellite() ? platformLabel() : S.rangeMode === "step" ? "range of this step" : "fixed range"}${paint.log ? " · log" : ""}`));
  const bar = el("canvas", { class: "gales-legend-bar", width: "220", height: "14" });
  const ctx = bar.getContext("2d");
  const steps = table.length / 3;
  for (let x = 0; x < 220; x += 1) {
    let u = x / 219;
    if (paint.bands > 1) u = Math.min(paint.bands - 1, Math.floor(u * paint.bands)) / (paint.bands - 1);
    const s = Math.round(u * (steps - 1)) * 3;
    ctx.fillStyle = `rgb(${table[s] * 255 | 0},${table[s + 1] * 255 | 0},${table[s + 2] * 255 | 0})`;
    ctx.fillRect(x, 0, 1, 14);
  }
  node.append(bar);
  const ticks = el("div", { class: "gales-legend-ticks" });
  const span = hi - lo;
  if (S.component === "fringe") {
    // A cycle is half a wavelength of range change; say it in centimetres.
    const half = S.insar.wavelength / 2;
    [0, 0.5, 1].forEach((v, k) => ticks.append(el("span", { style: `left:${k * 50}%` }, `${formatValue(v * half * 100, 1)} cm`)));
    node.append(ticks);
    node.append(el("div", { class: "gales-legend-ends" }, "range change, away from the satellite"));
    return;
  }
  if (paint.log && lo > 0) {
    [lo, Math.sqrt(lo * hi), hi].forEach((v, k) => ticks.append(el("span", { style: `left:${k * 50}%` }, tickLabel(v, v))));
  } else {
    const values = span > 0 ? niceTicks(lo, hi, 5) : [lo];
    values.forEach((v) => ticks.append(el("span", { style: `left:${span > 0 ? ((v - lo) / span) * 100 : 50}%` }, tickLabel(v, span || Math.abs(v) || 1))));
  }
  node.append(ticks);
  node.append(el("div", { class: "gales-legend-ends" }, `min ${formatValue(lo, span || 1)}   max ${formatValue(hi, span || 1)}`));
}

// ── Panel ───────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : v);
  });
  children.flat().forEach((c) => node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}

function status(text, error = false) {
  S.statusText = text;
  S.statusError = Boolean(error);
  const node = byId("gales-status");
  if (node) {
    node.textContent = text;
    node.classList.toggle("is-error", Boolean(error));
  }
  if (error) studio()?.log?.(`Results: ${text}`);
}

const sections = new Map();
function section(key, title, open = false) {
  const details = el("details", { class: "gis-tool-section studio-fold-section gales-section" });
  details.open = sections.has(key) ? sections.get(key) : open;
  details.dataset.galesSection = key;
  const summary = el("summary", {}, title);
  summary.dataset.toolIcon = "1";
  const body = el("div", { class: "gis-tool-body" });
  details.append(summary, body);
  details.addEventListener("toggle", () => sections.set(key, details.open));
  return { details, body };
}

function openSection(key) {
  sections.set(key, true);
  const node = document.querySelector(`[data-gales-section="${key}"]`);
  if (node) node.open = true;
}

function row(label, control) {
  const id = control.id || `gales-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return el("div", { class: "studio-row" }, el("label", { for: id }, label), control);
}

function select(options, value, onChange, extra = {}) {
  const node = el("select", { class: "studio-select wide", ...extra });
  options.forEach(([v, label, disabled]) => {
    const o = el("option", { value: String(v) }, label);
    if (disabled) o.disabled = true;
    if (String(v) === String(value)) o.selected = true;
    node.append(o);
  });
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

function renderStepReadout() {
  const f = S.fields[S.field];
  const node = byId("gales-step-readout");
  if (node) node.textContent = f?.steps.length ? `t = ${f.steps[S.step]?.name}  (${S.step + 1} / ${f.steps.length})` : "No steps";
  const slider = byId("gales-step");
  if (slider && Number(slider.value) !== S.step) slider.value = String(S.step);
}

function renderControls() {
  const host = byId("studio-results-host");
  if (!host) return;
  host.textContent = "";

  // Open
  // Every card arrives COLLAPSED, the tab column's own rule, except the one a
  // reader cannot do anything without; a load opens the field card itself.
  const open = section("open", "Open a simulation", !S.mesh);
  const folderInput = el("input", { type: "file", hidden: true });
  folderInput.setAttribute("webkitdirectory", "");
  folderInput.setAttribute("directory", "");
  folderInput.multiple = true;
  folderInput.addEventListener("change", () => {
    if (folderInput.files?.length) openSource(folderSource(folderInput.files));
  });
  const folderBtn = el("button", { class: "studio-primary", type: "button" }, "Open simulation folder…");
  folderBtn.title = "A GALES run folder: input/ with the mesh, results/ with the binary fields, setup.txt";
  folderBtn.addEventListener("click", () => folderInput.click());
  open.body.append(folderBtn, folderInput);

  // The same run a piece at a time: a mesh on its own, then its results as a
  // folder (results/, results/solid, or just u) or as step files.
  const picker = (attrs, kind) => {
    const input = el("input", { type: "file", hidden: true, ...attrs });
    input.multiple = true;
    input.addEventListener("change", () => { const files = [...(input.files || [])]; input.value = ""; addFiles(files, kind); });
    return input;
  };
  const meshInput = picker({ accept: ".txt,.msh" }, "mesh");
  const resultsDir = picker({ webkitdirectory: true, directory: true }, "results");
  const resultsFiles = picker({}, "results");
  const door = (label, title, input) => {
    const b = el("button", { class: "studio-btn", type: "button", title }, label);
    b.addEventListener("click", () => input.click());
    return b;
  };
  const doors = el("div", { class: "studio-actions gales-doors" },
    door("Open mesh file…", "A GALES text mesh (mesh_*core.txt) or a gmsh .msh, on its own", meshInput),
    door("Add results folder…", "Binary dof steps: a results/ folder, results/solid, or one field's folder such as u", resultsDir),
    door("Add result files…", "Step files picked one by one (0, 1, 2…): they are the field named below", resultsFiles),
  );
  open.body.append(doors, meshInput, resultsDir, resultsFiles);
  const loose = el("input", { class: "studio-input", type: "text", value: S.looseField, spellcheck: "false" });
  loose.title = "The field a step file picked on its own belongs to: solid/u, solid/v, heat_eq/T, fluid_dofs…";
  loose.addEventListener("keydown", (event) => event.stopPropagation());
  loose.addEventListener("change", () => { S.looseField = loose.value.trim() || "solid/u"; loose.value = S.looseField; });
  open.body.append(row("Loose steps are", loose));
  const drop = el("div", { class: "gales-drop" }, "…or drop a run folder, a mesh, or result files here");
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", async (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    const files = await droppedFiles(event.dataTransfer).catch(() => [...(event.dataTransfer.files || [])]);
    const roots = new Set(files.map((f) => relPath(f).split("/")[0]));
    const wholeRun = roots.size === 1 && files.some((f) => /(^|\/)results\//.test(relPath(f))) && files.some(isMeshFile);
    if (wholeRun && !S.source) openSource(folderSource(files));
    else addFiles(files, "any");
  });
  open.body.append(drop);
  const runsHost = el("div", { class: "gales-runs" });
  open.body.append(runsHost);
  projectRuns().then((runs) => {
    if (!runs.length) return;
    const pick = select([["", "— a run in this project —"], ...runs.map((r) => [r, r])], "", (v) => {
      if (!v) return;
      status(`Listing ${v}…`);
      projectSource(v).then(openSource).catch((e) => status(e.message, true));
    });
    runsHost.append(row("Project run", pick));
  });
  if (S.plan?.meshes.length > 1) {
    open.body.append(row("Mesh", select(S.plan.meshes.map((m) => [m.path, m.path]), S.meshPath, (v) => loadMesh(v))));
  }
  const said = el("div", { id: "gales-status", class: `studio-readout${S.statusError ? " is-error" : ""}` }, S.statusText);
  open.body.append(said);
  host.append(open.details);
  if (!S.mesh) return;

  // Compare with another run
  const cmp = section("compare", "Compare with another run", Boolean(S.reference));
  const refInput = el("input", { type: "file", hidden: true });
  refInput.setAttribute("webkitdirectory", "");
  refInput.setAttribute("directory", "");
  refInput.multiple = true;
  refInput.addEventListener("change", () => { const files = [...(refInput.files || [])]; refInput.value = ""; setReference(files); });
  cmp.body.append(el("p", { class: "studio-readout" }, "A second run on this mesh — with and without topography, two chamber pressures. Its fields are subtracted from this run's step by step, as Difference fields every view and analysis reads."));
  const refBtn = el("button", { class: "studio-btn", type: "button", title: "The reference run's folder (or its results/ folder)" }, S.reference ? "Change reference…" : "Choose reference run…");
  refBtn.addEventListener("click", () => refInput.click());
  const actions = el("div", { class: "studio-actions" }, refBtn, refInput);
  if (S.reference) {
    const clear = el("button", { class: "studio-btn", type: "button" }, "Clear");
    clear.addEventListener("click", () => clearReference());
    actions.append(clear);
  }
  cmp.body.append(actions);
  if (S.reference) cmp.body.append(el("p", { class: `studio-readout${S.reference.warning ? " is-warning" : ""}` }, S.reference.note));
  host.append(cmp.details);

  // Field
  const fs = section("field", "Field and time");
  const fieldOptions = S.fields.map((f, k) => [k, f.compare ? `Difference · ${f.from} − reference (${S.reference?.label}) · ${f.steps.length} step${f.steps.length > 1 ? "s" : ""}` : f.derived ? `Stress, strain and tilt · derived from ${f.from} · ${f.steps.length} step${f.steps.length > 1 ? "s" : ""}` : `${f.field}${f.nbDofs ? ` · ${f.nbDofs} dof${f.nbDofs > 1 ? "s" : ""}` : ""} · ${f.steps.length} step${f.steps.length > 1 ? "s" : ""}${f.ok ? "" : " — other mesh"}`, !f.ok]);
  fs.body.append(row("Field", select([[-1, "— geometry only —"], ...fieldOptions], S.field, (v) => {
    S.field = Number(v);
    const f = S.fields[S.field];
    S.step = f ? f.steps.length - 1 : 0;
    S.component = "";
    renderControls();
    refresh();
  })));
  const desc = currentDesc();
  if (desc) {
    const comps = [...(desc.vector ? [["mag", desc.vector.label]] : []), ...desc.components.map((c, j) => [j, c.label]), ...(canLos(desc) ? [["los", "Satellite line of sight (InSAR)"], ["fringe", "Interferogram fringes (wrapped)"]] : [])];
    fs.body.append(row("Component", select(comps, S.component, (v) => { S.component = v; renderControls(); refresh(); })));
    if (isSatellite() && canLos(desc)) fs.body.append(satelliteControls());
  }
  const f = S.fields[S.field];
  if (f?.steps.length) {
    const slider = el("input", { id: "gales-step", class: "gales-range", type: "range", min: "0", max: String(f.steps.length - 1), step: "1", value: String(S.step) });
    slider.addEventListener("input", () => { S.step = Number(slider.value); renderStepReadout(); refresh(); });
    fs.body.append(row("Step", slider));
    const transport = el("div", { class: "studio-actions" });
    const btn = (label, title, fn) => { const b = el("button", { class: "studio-secondary", type: "button", title }, label); b.addEventListener("click", fn); transport.append(b); return b; };
    btn("|◀", "First step", () => { S.step = 0; refresh(); });
    btn("◀", "The step before", () => { S.step = Math.max(0, S.step - 1); refresh(); });
    const play = btn(S.playing ? "❚❚" : "▶", "Play through the steps", () => (S.playing ? stopPlay() : startPlay()));
    play.id = "gales-play";
    btn("▶", "The step after", () => { S.step = Math.min(f.steps.length - 1, S.step + 1); refresh(); });
    btn("▶|", "Last step", () => { S.step = f.steps.length - 1; refresh(); });
    fs.body.append(transport, el("div", { id: "gales-step-readout", class: "studio-readout" }));
  }
  host.append(fs.details);

  // Colour
  const cs = section("colour", "Colour map and range");
  cs.body.append(row("Map", select(Object.keys(COLORMAPS).map((k) => [k, k]), S.colormap, (v) => { S.colormap = v; refresh(); })));
  cs.body.append(row("Classes", select([[0, "Smooth"], [5, "5 bands"], [8, "8 bands"], [10, "10 bands"], [16, "16 bands"]], S.bands, (v) => { S.bands = Number(v); refresh(); })));
  const check = (label, value, fn, title = "") => {
    const input = el("input", { type: "checkbox" });
    input.checked = value;
    input.addEventListener("change", () => fn(input.checked));
    const lab = el("label", { class: "studio-check", title }, input, ` ${label}`);
    return lab;
  };
  cs.body.append(check("Reverse", S.reverse, (v) => { S.reverse = v; refresh(); }));
  cs.body.append(check("Log scale", S.log, (v) => { S.log = v; refresh(); }, "For a field spanning orders of magnitude; values ≤ 0 take the bottom colour."));
  cs.body.append(row("Range", select([["step", "This step (auto)"], ["fixed", "Fixed"]], S.rangeMode, (v) => { S.rangeMode = v; renderControls(); refresh(); })));
  if (S.rangeMode === "fixed") {
    const lo = el("input", { class: "studio-input", type: "number", step: "any", value: String(S.range[0]) });
    const hi = el("input", { class: "studio-input", type: "number", step: "any", value: String(S.range[1]) });
    const apply = () => { S.range = [Number(lo.value), Number(hi.value)]; refresh(); };
    lo.addEventListener("change", apply);
    hi.addEventListener("change", apply);
    cs.body.append(row("Min", lo), row("Max", hi));
    const all = el("button", { class: "studio-secondary", type: "button" }, "Fit to every step");
    all.title = "Reads every step of this field once and fixes the range to span them all";
    all.addEventListener("click", fitAllSteps);
    cs.body.append(all);
  }
  host.append(cs.details);

  // Display
  const ds = section("display", "Display");
  if (S.mesh.dim === 3) {
    ds.body.append(row("View", select([["surface", "Surface"], ["slice", "Slice"], ["clip", "Clip at the slice"], ["both", "Translucent surface + slice"], ["threshold", "Threshold — a range, or domains"]], S.view, (v) => { S.view = v; renderControls(); refresh(); })));
    if (S.view !== "surface") {
      ds.body.append(row("Slice normal", select([["x", "X"], ["y", "Y"], ["z", "Z (horizontal)"]], S.sliceAxis, (v) => { S.sliceAxis = v; refresh(); })));
      const pos = el("input", { class: "gales-range", type: "range", min: "0", max: "1000", step: "1", value: String(Math.round(S.slicePos * 1000)) });
      const readout = el("div", { class: "studio-readout" });
      const say = () => {
        const p = axisPlane(S.mesh.bounds, S.sliceAxis, S.slicePos);
        readout.textContent = `${S.sliceAxis} = ${formatValue(p.d, 1e3)} m`;
      };
      say();
      pos.addEventListener("input", () => { S.slicePos = Number(pos.value) / 1000; say(); });
      pos.addEventListener("change", () => refresh());
      ds.body.append(row("Position", pos), readout);
      if (S.view === "clip") ds.body.append(check("Keep the other half", S.clipFlip, (v) => { S.clipFlip = v; refresh(); }));
      const face = el("button", { class: "studio-secondary", type: "button" }, "Look at the slice (2D)");
      face.addEventListener("click", () => studio()?.viewAxis?.({ x: "x", y: "z", z: "y" }[S.sliceAxis], scene.surface));
      ds.body.append(face);
    }
  } else {
    ds.body.append(row("View", select([["surface", "Surface"], ["threshold", "Threshold — a range, or domains"]], S.view === "threshold" ? "threshold" : "surface", (v) => { S.view = v; renderControls(); refresh(); })));
    const top = el("button", { class: "studio-secondary", type: "button" }, "Plan view (2D)");
    top.addEventListener("click", () => studio()?.viewAxis?.("y", scene.surface));
    ds.body.append(top);
  }
  if (S.view === "threshold") {
    const T = S.threshold;
    const num = (key, placeholder) => {
      const input = el("input", { class: "studio-input", type: "number", step: "any", placeholder });
      input.value = T[key];
      input.addEventListener("keydown", (event) => event.stopPropagation());
      input.addEventListener("change", () => { T[key] = input.value; refresh(); });
      return input;
    };
    ds.body.append(row("Keep from", num("lo", "no lower bound")), row("to", num("hi", "no upper bound")));
    ds.body.append(row("A cell is kept when", select([["all", "every node is in range"], ["any", "any node is in range"], ["mean", "its mean is in range"]], T.mode, (v) => { T.mode = v; refresh(); })));
    const fromRange = el("button", { class: "studio-secondary", type: "button", title: "The colour range shown now" }, "Use the colour range");
    fromRange.addEventListener("click", () => { T.lo = String(Number(S.range[0].toPrecision(6))); T.hi = String(Number(S.range[1].toPrecision(6))); renderControls(); refresh(); });
    const clearRange = el("button", { class: "studio-secondary", type: "button" }, "Open range");
    clearRange.addEventListener("click", () => { T.lo = ""; T.hi = ""; renderControls(); refresh(); });
    ds.body.append(el("div", { class: "studio-actions" }, fromRange, clearRange));
    const flags = S.mesh.volumeFlags || [];
    if (flags.length > 1) {
      ds.body.append(el("p", { class: "gales-subhead" }, "Domains (volume flags) — none ticked keeps all"));
      const box = el("div", { class: "gales-flag-list" });
      for (const { flag, count } of flags) {
        const tick = el("input", { type: "checkbox" });
        tick.checked = T.flags.includes(flag);
        tick.addEventListener("change", () => { T.flags = tick.checked ? [...new Set([...T.flags, flag])].sort((a, b) => a - b) : T.flags.filter((x) => x !== flag); refresh(); });
        box.append(el("label", { class: "studio-check" }, tick, el("i", { class: "gales-flag-swatch", style: `background:${flagColour(flag)}` }), `${flag} · ${count.toLocaleString()} elements`));
      }
      ds.body.append(box);
    }
    ds.body.append(row("Colour by", select([["field", "The field"], ["flag", "Volume flag"]], T.colourBy, (v) => { T.colourBy = v; refresh(); })));
    if (T.data) ds.body.append(el("p", { class: "studio-readout" }, `${T.data.kept.toLocaleString()} of ${T.data.of.toLocaleString()} elements kept · ${(T.data.triangles.length / 3).toLocaleString()} faces drawn.`));
  }
  ds.body.append(check("Wireframe", S.edges, (v) => { S.edges = v; refresh(); }));
  ds.body.append(check("Contour lines", S.contours.on, (v) => { S.contours.on = v; renderControls(); refresh(); }, "Lines of equal value on the surface and the slice, at round levels in the field's units"));
  if (S.contours.on) {
    ds.body.append(row("Contour levels", select([[5, "About 5"], [10, "About 10"], [20, "About 20"], [40, "About 40"]], S.contours.count, (v) => { S.contours.count = Number(v); refresh(); })));
    ds.body.append(row("Contour colour", select([["dark", "Dark"], ["light", "Light"], ["value", "By value"]], S.contours.colour, (v) => { S.contours.colour = v; refresh(); })));
  }
  if (S.mesh.dim === 3) {
    ds.body.append(check("Isosurfaces", S.iso.on, (v) => { S.iso.on = v; renderControls(); refresh(); }, "Surfaces of equal value through the volume"));
    if (S.iso.on) {
      const lv = el("input", { class: "studio-input", type: "text", value: S.iso.levels, placeholder: "e.g. 10, 40 — blank: a quarter, half, three quarters", spellcheck: "false" });
      lv.addEventListener("keydown", (event) => event.stopPropagation());
      lv.addEventListener("change", () => { S.iso.levels = lv.value; refresh(); });
      ds.body.append(row("Iso levels", lv));
      const io = el("input", { class: "gales-range", type: "range", min: "0.15", max: "1", step: "0.05", value: String(S.iso.opacity) });
      io.addEventListener("change", () => { S.iso.opacity = Number(io.value); refresh(); });
      ds.body.append(row("Iso opacity", io));
      if (S.iso.used?.length) ds.body.append(el("p", { class: "studio-readout" }, `At ${S.iso.used.map((L) => formatValue(L, Math.abs(L) || 1)).join(", ")} in the field's units.`));
    }
  }
  const opacity = el("input", { class: "gales-range", type: "range", min: "0.1", max: "1", step: "0.05", value: String(S.opacity) });
  opacity.addEventListener("input", () => { S.opacity = Number(opacity.value); refresh(); });
  ds.body.append(row("Opacity", opacity));
  const fitBtn = el("button", { class: "studio-secondary", type: "button" }, "Fit the view");
  fitBtn.addEventListener("click", () => studio()?.fitObject?.(scene.surface));
  const hide = el("button", { class: "studio-secondary", type: "button" }, anyPartShown() ? "Hide results" : "Show results");
  hide.addEventListener("click", () => {
    if (!scene.root) return;
    setAllParts(!anyPartShown());
  });
  ds.body.append(el("div", { class: "studio-actions" }, fitBtn, hide));
  host.append(ds.details);

  // Warp
  const disps = S.fields.map((fl, k) => [fl, k]).filter(([fl]) => fl.ok && (fl.desc?.displacement || /solid\/u$|fluid_mesh$|elastostatic_dofs$/.test(fl.field)));
  const ws = section("warp", "Deformed shape");
  if (disps.length) {
    ws.body.append(check("Warp by displacement", S.deform.on, (v) => { S.deform.on = v; refresh(); }));
    ws.body.append(row("Displacement", select(disps.map(([fl, k]) => [k, fl.field]), S.deform.field, (v) => { S.deform.field = Number(v); refresh(); })));
    const scale = el("input", { class: "studio-input", type: "number", step: "any", min: "0", value: String(S.deform.scale) });
    scale.addEventListener("change", () => { S.deform.scale = Math.max(0, Number(scale.value) || 0); refresh(); });
    ws.body.append(row("Scale ×", scale));
    const auto = el("button", { class: "studio-secondary", type: "button" }, "Auto scale");
    auto.title = "The largest displacement drawn as 5% of the model's size";
    auto.addEventListener("click", async () => {
      const df = S.fields[S.deform.field];
      if (!df?.ok) return;
      const time = S.fields[S.field]?.steps[S.step]?.time ?? 0;
      const values = await valuesAt(S.deform.field, matchingStep(S.deform.field, time));
      if (!df.desc?.displacement) return;
      const mag = magnitudeOf(values, S.mesh.nodeCount, df.desc.nbDofs, df.desc.displacement, df.desc.blocked);
      const max = rangeOf(mag)[1];
      S.deform.scale = max > 0 ? Number(((scene.radius * 2 * 0.05) / max).toPrecision(3)) : 1;
      S.deform.on = true;
      renderControls();
      refresh();
    });
    ws.body.append(auto, el("div", { class: "studio-readout" }, "Exaggerated: a scale of 1 is the true displacement."));
  } else ws.body.append(el("div", { class: "studio-readout" }, "No displacement field in this run (solid/u, elastostatic_dofs or fluid_mesh)."));
  host.append(ws.details);

  // Probe
  const ps = section("probe", "Probe");
  ps.body.append(el("div", { id: "gales-probe" }));
  host.append(ps.details);
  renderProbe();

  // Points and time series
  const pts = section("points", "Points and time series");
  pts.body.append(el("div", { id: "gales-points" }));
  host.append(pts.details);
  renderPoints();

  // Export for ParaView
  const vx = section("vtk", "Export for ParaView");
  vx.body.append(el("div", { id: "gales-vtk" }));
  host.append(vx.details);
  renderVtkExport();
  renderStepReadout();
}

// ── Compare with another run ───────────────────────────────────────────────

/** A field's description as a difference: every label says so, or a legend reads "Displacement" over a subtraction. */
function compareDesc(d, field) {
  return {
    ...d, field, label: `${d.label} — this run − reference`,
    components: d.components.map((c) => ({ ...c, label: `Δ ${c.label}` })),
    vector: d.vector ? { ...d.vector, label: `Δ ${d.vector.label}` } : d.vector,
  };
}

const meshEntry = (entries) => entries.filter((e) => /\.msh$/i.test(e.path) || /(^|\/)input\/[^/]*mesh[^/]*\.txt$/i.test(e.path));

export async function setReference(fileList) {
  if (!S.mesh) { status("Open a run first: the reference is compared with it.", true); return null; }
  const source = folderSource(fileList);
  const fields = groupResultFiles(source.entries, { looseField: S.looseField });
  if (!fields.length) { status(`No result steps in ${source.label}: expected results/<field>/<time>.`, true); renderControls(); return null; }
  const plan = referencePlan(S.fields.filter((f) => f.ok && !f.derived && !f.compare), fields);
  if (!plan.length) {
    status(`Nothing in ${source.label} matches this run's fields (${fields.map((f) => f.field).join(", ")} against ${S.fields.filter((f) => f.ok && !f.derived && !f.compare).map((f) => f.field).join(", ")}).`, true);
    renderControls();
    return null;
  }
  // Only the node count can be checked from sizes, and a different mesh with
  // the same count would subtract unrelated nodes: say what was checked.
  const mine = S.source?.entries.find((e) => e.path === S.meshPath);
  const theirs = meshEntry(source.entries);
  const same = theirs.find((e) => e.path.split("/").pop() === mine?.path.split("/").pop());
  let note;
  let warning = false;
  if (!theirs.length) note = "The reference carries no mesh: it is assumed to be on this run's mesh, node for node.";
  else if (same && mine?.size && same.size === mine.size) note = `The reference's ${same.path.split("/").pop()} is the same size as this run's: the same mesh, as far as sizes can tell.`;
  else { note = `The reference's mesh (${theirs[0].path.split("/").pop()}, ${theirs[0].size?.toLocaleString() ?? "?"} bytes) is not the same file as this run's — the difference is only meaningful node for node on one mesh.`; warning = true; }
  for (const key of [...cache.keys()]) if (String(key).startsWith("compare:")) cache.delete(key);
  S.reference = { source, label: source.label, fields, note: `${source.label}: ${plan.map((c) => `${c.from} (${c.steps.length} step${c.steps.length > 1 ? "s" : ""})`).join(", ")}. ${note}`, warning };
  const keep = S.fields[S.field]?.field;
  classifyFields();
  const pick = S.fields.findIndex((f) => f.field === `compare/${keep}`);
  if (pick >= 0) {
    const time = S.fields[S.field]?.steps[S.step]?.time;
    S.field = pick;
    const steps = S.fields[pick].steps;
    S.step = Math.max(0, steps.findIndex((st) => st.time === time));
    S.component = "";
  }
  status(`Comparing with ${source.label}.`, warning);
  openSection("compare");
  renderControls();
  await refresh({ fit: false });
  return S.reference;
}

function clearReference() {
  const keep = S.fields[S.field]?.compare ? S.fields[S.field].from : S.fields[S.field]?.field;
  S.reference = null;
  for (const key of [...cache.keys()]) if (String(key).startsWith("compare:")) cache.delete(key);
  classifyFields();
  S.field = Math.max(0, S.fields.findIndex((f) => f.field === keep));
  S.component = "";
  S.step = Math.min(S.step, (S.fields[S.field]?.steps.length || 1) - 1);
  status("Reference cleared.");
  renderControls();
  refresh({ fit: false });
}

// ── Export for ParaView ────────────────────────────────────────────────────
//
// The reader answers most questions here; ParaView answers the rest. A step
// leaves as a .vtu (appended raw binary, vtk-export.js) built in the worker
// that holds the cells; several steps leave as a zip with a .pvd that opens
// them as one time series.

const vtkBase = () => `gales_${(S.fields[S.field]?.field || "run").replace(/[^A-Za-z0-9]+/g, "_")}`;

/** The step of another field at (not after) a time, as the glyphs match steps. */
function stepAtTime(fieldIndex, time) {
  const f = S.fields[fieldIndex];
  let step = 0;
  for (let k = 0; k < f.steps.length; k += 1) if (f.steps[k].time <= time) step = k;
  return step;
}

/**
 * The VTK files for a selection, without downloading them: [{ name, blob, time }].
 * `fields` are field indices (default: the chosen ones, else the one shown);
 * `steps` is "current", "all", or an array of the shown field's step indices.
 */
export async function buildVtkFiles({ part = S.vtkExport.part, steps = S.vtkExport.steps, fields = null, onProgress } = {}) {
  if (!S.mesh) throw new Error("Open a run first.");
  const lead = S.fields[S.field];
  if (!lead?.ok) throw new Error("Choose a field that fits this mesh.");
  const chosen = (fields || [...(S.vtkExport.fields || [S.field])]).filter((i) => S.fields[i]?.ok);
  if (!chosen.length) chosen.push(S.field);
  const stepList = Array.isArray(steps) ? steps : steps === "all" ? lead.steps.map((_, k) => k) : [S.step];
  const files = [];
  const pad = String(Math.max(...stepList)).length;
  for (const [n, k] of stepList.entries()) {
    const time = lead.steps[k].time;
    const pointData = [];
    for (const fi of chosen) {
      const values = await valuesAt(fi, fi === S.field ? k : stepAtTime(fi, time));
      if (!values) continue;
      pointData.push(...fieldArrays(S.fields[fi].desc, values, S.mesh.nodeCount, S.mesh.dim));
    }
    onProgress?.(n, stepList.length);
    const out = await getReader().call("vtu", { part, pointData, time }, pointData.map((d) => d.values.buffer));
    files.push({ name: `${vtkBase()}_${part}_${String(k).padStart(pad, "0")}.vtu`, blob: out.blob, bytes: out.bytes, cells: out.cells, time, part: out.part });
  }
  return files;
}

function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportVtk(options = {}) {
  const X = S.vtkExport;
  if (!may("save")) { X.note = refusal("save"); renderVtkExport(); return null; }
  if (X.busy) return null;
  X.busy = true;
  X.note = "Writing…";
  renderVtkExport();
  try {
    const files = await buildVtkFiles({ ...options, onProgress: (n, total) => { X.note = `Writing step ${n + 1} of ${total}…`; const node = byId("gales-vtk-note"); if (node) node.textContent = X.note; } });
    const bytes = files.reduce((a, f) => a + f.bytes, 0);
    const mb = (bytes / 1048576).toFixed(1);
    if (files.length === 1) {
      saveBlob(files[0].name, files[0].blob);
      X.note = `${files[0].name} — ${mb} MB, ${files[0].cells.toLocaleString()} cells. ParaView: File ▸ Open.`;
    } else {
      // A stored zip holds its entries in one buffer, with 32-bit offsets.
      if (bytes > 1.5 * 1073741824) throw new Error(`${mb} MB is more than a browser zip can hold; export fewer steps, or the surface.`);
      const pvdName = `${vtkBase()}_${files[0].part}.pvd`;
      const entries = [{ name: pvdName, data: new TextEncoder().encode(pvdText(files.map((f) => ({ time: f.time, file: f.name })))) }];
      for (const f of files) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
      saveBlob(`${vtkBase()}_${files[0].part}_vtk.zip`, new Blob([zipStore(entries)], { type: "application/zip" }));
      X.note = `${files.length} steps, ${mb} MB, with ${pvdName} — unzip and open the .pvd in ParaView as one time series.`;
    }
    return files;
  } catch (error) {
    X.note = `Could not export: ${error.message}`;
    return null;
  } finally {
    X.busy = false;
    renderVtkExport();
  }
}

function renderVtkExport() {
  const box = byId("gales-vtk");
  if (!box) return;
  box.textContent = "";
  const X = S.vtkExport;
  if (!S.mesh || !S.fields[S.field]?.ok) { box.append(el("p", { class: "studio-readout" }, "Open a run to export it.")); return; }
  const ok = S.fields.map((f, i) => ({ f, i })).filter(({ f }) => f.ok);
  // Until a field is ticked by hand, the export follows the one shown.
  if (X.fields?.some((i) => !S.fields[i]?.ok)) X.fields = null;
  const chosen = X.fields || [S.field];
  const part = el("select", { class: "studio-select" });
  [["volume", "Volume — every element"], ["surface", "Surface — the boundary only"]].forEach(([v, t]) => part.append(new Option(t, v, false, v === X.part)));
  part.disabled = S.mesh.dim !== 3;
  part.addEventListener("change", () => { X.part = part.value; });
  box.append(row("Part", part));
  const steps = el("select", { class: "studio-select" });
  const lead = S.fields[S.field];
  [["current", `This step (t=${lead.steps[S.step]?.name})`], ["all", `All ${lead.steps.length} steps, as a time series`]].forEach(([v, t]) => steps.append(new Option(t, v, false, v === X.steps)));
  steps.addEventListener("change", () => { X.steps = steps.value; });
  box.append(row("Steps", steps));
  const list = el("div", { class: "gales-vtk-fields" });
  for (const { f, i } of ok) {
    const tick = el("input", { type: "checkbox" });
    tick.checked = chosen.includes(i);
    tick.addEventListener("change", () => {
      const now = X.fields || [S.field];
      X.fields = tick.checked ? [...new Set([...now, i])] : now.filter((j) => j !== i);
    });
    list.append(el("label", { class: "studio-check", title: f.field }, tick, f.desc?.label ? `${f.desc.label} (${f.field})` : f.field));
  }
  box.append(el("p", { class: "studio-group-title" }, "Fields"), list);
  const go = el("button", { class: "studio-primary", type: "button" }, X.busy ? "Writing…" : "Export VTK");
  go.disabled = X.busy;
  go.addEventListener("click", () => exportVtk());
  box.append(el("div", { class: "studio-actions" }, go));
  box.append(el("p", { id: "gales-vtk-note", class: "studio-readout" }, X.note || "Node and volume flags travel as data arrays; a displacement is one vector ParaView can warp by."));
}

// ── Points and time series ─────────────────────────────────────────────────
//
// A FEM run is read at points: a borehole, a tiltmeter, a GNSS site. The Model
// Builder embeds them as mesh nodes and gmsh_to_gales.py writes each one's
// physical flag on its node, so a flag names them; any other point is taken
// to its nearest node, and the distance is written beside it.

let locator = null;
const STATION_COLOURS = ["#ff2bd6", "#52e4e8", "#ffd166", "#06d6a0", "#ef476f", "#118ab2", "#f78c6b", "#a78bfa", "#bef264", "#fca5a5"];

function nearest(p) {
  if (!locator) locator = nodeLocator(S.mesh);
  return locator.nearest(p);
}

/** Points into the list: taken to their nearest node, never twice at one node. */
function addStations(list) {
  const seen = new Set(S.stations.map((st) => st.node));
  let added = 0;
  for (const st of list) {
    const at = Number.isInteger(st.node) ? { node: st.node, distance: st.distance || 0 } : nearest([st.x, st.y, st.z ?? 0]);
    if (at.node < 0 || seen.has(at.node)) continue;
    seen.add(at.node);
    const i = at.node;
    const c = S.mesh.coords;
    S.stations.push({
      name: st.name || `node${i}`, node: i, x: c[i * 3], y: c[i * 3 + 1], z: c[i * 3 + 2],
      asked: Number.isInteger(st.node) ? null : [st.x, st.y, st.z ?? 0],
      flag: S.mesh.nodeFlag?.[i] || st.flag || null, distance: at.distance, source: st.source || "",
    });
    added += 1;
  }
  S.extract.result = null;
  renderPoints();
  updateStationMarkers(null);
  refresh();
  return added;
}

async function readSpec() {
  const entry = S.source?.entries.find((e) => /(^|\/)spec\.json$/.test(e.path) && e.path.split("/").length <= 2);
  if (!entry) return null;
  try { return JSON.parse(await S.source.text(entry.path)); } catch (e) { return null; }
}

function updateStationMarkers(disp) {
  if (!scene.frame) return;
  if (!scene.stationGroup) {
    scene.stationGroup = new THREE.Group();
    scene.stationGroup.name = "gales-stations";
    (scene.parts?.points || scene.frame).add(scene.stationGroup);
  }
  const group = scene.stationGroup;
  while (group.children.length > S.stations.length) {
    const child = group.children.pop();
    child.geometry.dispose(); child.material.dispose();
  }
  S.stations.forEach((st, k) => {
    let m = group.children[k];
    if (!m) {
      m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ depthTest: false }));
      m.renderOrder = 11;
      group.add(m);
    }
    m.material.color.set(STATION_COLOURS[k % STATION_COLOURS.length]);
    m.scale.setScalar(scene.radius * 0.012);
    const i = st.node;
    m.position.set(st.x + (disp ? disp[i * 3] : 0), st.y + (disp ? disp[i * 3 + 1] : 0), st.z + (disp ? disp[i * 3 + 2] : 0));
  });
}

function renderPoints() {
  const host = byId("gales-points");
  if (!host || !S.mesh) return;
  host.textContent = "";
  const add = el("div", { class: "gales-subhead" }, "Add points");
  host.append(add);

  const flags = flagSummary(S.mesh.nodeFlag);
  if (flags.length) {
    const pick = select(flags.map((f) => [f.flag, `flag ${f.flag} — ${f.count.toLocaleString()} node${f.count === 1 ? "" : "s"}`]), flags[0].flag, () => {});
    pick.title = "An embedded point's flag is a small group: the Model Builder gives points flag 20 unless told otherwise.";
    const go = el("button", { class: "studio-secondary", type: "button" }, "Add the flagged nodes");
    go.addEventListener("click", () => {
      const got = stationsForFlag(S.mesh, Number(pick.value), { cap: 200 });
      const added = addStations(got.stations);
      status(`Flag ${pick.value}: ${got.found.toLocaleString()} node(s)${got.capped ? ", the first 200 taken" : ""}; ${added} added.`);
    });
    host.append(row("Flag", pick), go);
  } else host.append(el("div", { class: "studio-readout" }, "This mesh carries no node flags."));

  const buttons = el("div", { class: "studio-actions" });
  const fromSpec = el("button", { class: "studio-secondary", type: "button" }, "Model Builder's points");
  fromSpec.title = "The embedded points in this run's spec.json";
  fromSpec.addEventListener("click", async () => {
    const spec = await readSpec();
    const list = specPoints(spec);
    if (!list.length) { status("No spec.json with embedded points in this folder.", true); return; }
    const added = addStations(list);
    status(`${added} of ${list.length} embedded point(s) added from spec.json, each at its nearest node.`);
  });
  const studioPts = studio()?.state?.points || [];
  const fromStudio = el("button", { class: "studio-secondary", type: "button" }, "Studio's points");
  fromStudio.title = "The embedded points placed in this studio";
  fromStudio.disabled = !studioPts.length;
  fromStudio.addEventListener("click", () => {
    const added = addStations(studioPts.map((q) => ({ name: q.name, x: q.x, y: q.y, z: q.z, flag: q.flag, source: "studio" })));
    status(`${added} studio point(s) added.`);
  });
  buttons.append(fromSpec, fromStudio);
  host.append(buttons);

  const typed = el("textarea", { class: "studio-input gales-typed", rows: "3", placeholder: "name, x, y, z  (metres, the mesh's frame)" });
  const addTyped = el("button", { class: "studio-secondary", type: "button" }, "Add typed points");
  addTyped.addEventListener("click", () => {
    const list = parsePointList(typed.value);
    if (!list.length) { status("No points read: one per line as name, x, y, z.", true); return; }
    const added = addStations(list);
    status(`${added} typed point(s) added.`);
  });
  host.append(typed, addTyped);

  // The list
  host.append(el("div", { class: "gales-subhead" }, `Points · ${S.stations.length}`));
  if (S.stations.length) {
    const list = el("div", { class: "gales-stations" });
    S.stations.forEach((st, k) => {
      const sw = el("span", { class: "gales-sw" });
      sw.style.background = STATION_COLOURS[k % STATION_COLOURS.length];
      const name = el("input", { class: "studio-input", value: st.name, "aria-label": "Point name" });
      name.addEventListener("keydown", (e) => e.stopPropagation());
      name.addEventListener("change", () => { st.name = name.value.trim() || st.name; });
      const info = el("span", { class: "gales-station-info" }, `node ${st.node}${st.flag ? ` · flag ${st.flag}` : ""}${st.distance > 0 ? ` · ${formatValue(st.distance, st.distance)} m off` : ""}`);
      info.title = `x ${st.x}, y ${st.y}, z ${st.z}${st.asked ? ` — asked for ${st.asked.join(", ")}` : ""}`;
      const drop = el("button", { class: "studio-secondary gales-x", type: "button", title: "Remove this point" }, "✕");
      drop.addEventListener("click", () => { S.stations.splice(k, 1); S.extract.result = null; renderPoints(); updateStationMarkers(null); refresh(); });
      list.append(el("div", { class: "gales-station" }, sw, name, info, drop));
    });
    const clearAll = el("button", { class: "studio-secondary", type: "button" }, "Remove all");
    clearAll.addEventListener("click", () => { S.stations = []; S.extract.result = null; renderPoints(); updateStationMarkers(null); refresh(); });
    host.append(list, clearAll);
  }

  // What to extract
  host.append(el("div", { class: "gales-subhead" }, "Extract"));
  const okFields = S.fields.map((f, k) => [f, k]).filter(([f]) => f.ok);
  if (!S.extract.fields) S.extract.fields = new Set(okFields.map(([, k]) => k));
  okFields.forEach(([f, k]) => {
    const box = el("input", { type: "checkbox" });
    box.checked = S.extract.fields.has(k);
    box.addEventListener("change", () => { if (box.checked) S.extract.fields.add(k); else S.extract.fields.delete(k); });
    host.append(el("label", { class: "studio-check" }, box, ` ${f.field} · ${f.steps.length} step${f.steps.length === 1 ? "" : "s"}`));
  });
  host.append(row("Files", select([["station", "One CSV per point (time series)"], ["step", "One CSV per time step (every point)"], ["tidy", "One CSV (every point, every step)"]], S.extract.layout, (v) => { S.extract.layout = v; })));
  const run = el("button", { class: "studio-primary", type: "button" }, "Extract to CSV");
  run.disabled = !S.stations.length || !okFields.length;
  run.addEventListener("click", () => extractStations().catch((e) => status(e.message, true)));
  host.append(run);
  if (S.extract.note) host.append(el("div", { class: "studio-readout" }, S.extract.note));

  // The plot of what was extracted
  const r = S.extract.result;
  if (r) {
    const fieldPick = select(r.fields.map((f, k) => [k, f.desc.field]), S.extract.plotField, (v) => { S.extract.plotField = Number(v); S.extract.plotComp = r.fields[Number(v)].desc.vector ? "mag" : "0"; renderPoints(); });
    const fd = r.fields[S.extract.plotField] || r.fields[0];
    const comps = [...(fd.desc.vector ? [["mag", fd.desc.vector.label]] : []), ...fd.desc.components.map((c, j) => [j, c.label])];
    const compPick = select(comps, S.extract.plotComp, (v) => { S.extract.plotComp = v; renderPoints(); });
    host.append(row("Plot", fieldPick), row("Component", compPick));
    const canvas = el("canvas", { class: "gales-plot", width: "600", height: "260" });
    host.append(canvas);
    drawStationSeries(canvas, fd, r.stations, S.extract.plotComp);
    const again = el("button", { class: "studio-secondary", type: "button" }, "Download again");
    again.addEventListener("click", () => deliver(r.files, r.prefix));
    host.append(again);
  }
}

/** Every chosen field at every point through every step. */
async function extractStations() {
  const stations = S.stations.map((st) => ({ ...st }));
  const chosen = [...S.extract.fields].map((k) => [S.fields[k], k]).filter(([f]) => f?.ok);
  if (!stations.length || !chosen.length) return;
  const N = stations.length;
  const n = S.mesh.nodeCount;
  const out = [];
  const started = performance.now();
  for (const [f, fi] of chosen) {
    if (!f.desc) await valuesAt(fi, 0);
    const d = f.desc;
    const nb = d.nbDofs;
    const values = new Float64Array(f.steps.length * N * nb);
    for (let k = 0; k < f.steps.length; k += 1) {
      const step = f.steps[k];
      status(`Extracting ${f.field}: step ${k + 1} of ${f.steps.length} at ${N} point(s)…`);
      // A few points read their own bytes; many read the step once.
      if (!d.blocked && !f.derived && !f.compare && N <= 24) {
        for (let si = 0; si < N; si += 1) {
          const [a, b] = nodeByteRange(stations[si].node, n, nb);
          const part = float64View(await S.source.readRange(step.path, a, b));
          for (let j = 0; j < nb; j += 1) values[(k * N + si) * nb + j] = part[j];
        }
      } else {
        const whole = f.derived || f.compare ? await valuesAt(fi, k) : cache.get(step.path) || float64View(await S.source.read(step.path));
        for (let si = 0; si < N; si += 1) {
          const node = stations[si].node;
          for (let j = 0; j < nb; j += 1) values[(k * N + si) * nb + j] = d.blocked ? whole[j * n + node] : whole[node * nb + j];
        }
      }
      if (k % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    out.push({ desc: d, times: f.steps.map((s) => s.time), values });
  }
  const sim = (S.source?.label || "gales").split("/").pop();
  const prefix = `${sim.replace(/[^\w.-]+/g, "_")}`;
  const header = [
    `GALES results extracted by GeoID GeoHUB, ${new Date().toISOString()}`,
    `simulation ${S.source?.label || ""} · mesh ${S.meshPath}`,
    "Values at mesh nodes; a point that was not a node is taken to its nearest node (distance_m).",
  ];
  const { files, times } = stationCsvFiles({ stations, fields: out, layout: S.extract.layout, prefix, header });
  S.extract.result = { fields: out, stations, files, prefix };
  S.extract.plotField = 0;
  S.extract.plotComp = out[0].desc.vector ? "mag" : "0";
  const filed = await fileIntoProject(files);
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  S.extract.note = `${N} point(s) × ${times.length} time(s) × ${out.length} field(s) in ${secs} s → ${files.length} CSV file(s)${filed ? `, filed in the project's post_processing/extracted_dofs/ (the Signal pages list them)` : ""}.`;
  status(S.extract.note);
  deliver(files, prefix);
  renderPoints();
}

/** Into the open project, where the analysis pages look for series. */
async function fileIntoProject(files) {
  const store = window.GeoIDResearch?.store;
  if (!store?.getActive?.() || !store.writeProjectFile) return false;
  try {
    for (const f of files) await store.writeProjectFile(`post_processing/extracted_dofs/${f.name}`, f.text);
    return true;
  } catch (e) {
    return false;
  }
}

/** One file downloads as itself; several arrive as one zip. */
function deliver(files, prefix) {
  if (!files.length) return;
  if (files.length === 1) { downloadText(files[0].name, files[0].text, "text/csv", { project: false }); return; }
  if (!may("save")) { status(refusal("save"), true); return; }
  const enc = new TextEncoder();
  const zip = zipStore(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}_timeseries.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function drawStationSeries(canvas, field, stations, comp) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width; const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const d = field.desc;
  const nb = d.nbDofs;
  const N = stations.length;
  const ts = field.times;
  const at = (k, si, j) => field.values[(k * N + si) * nb + j];
  const valueOf = (k, si) => (comp === "mag" && d.vector ? Math.hypot(...d.vector.from.map((j) => at(k, si, j))) : at(k, si, Number(comp) || 0));
  const shown = stations.slice(0, STATION_COLOURS.length);
  let y0 = Infinity; let y1 = -Infinity;
  shown.forEach((_, si) => ts.forEach((__, k) => { const v = valueOf(k, si); if (Number.isFinite(v)) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); } }));
  if (!Number.isFinite(y0)) { y0 = 0; y1 = 1; }
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const t0 = Math.min(...ts); const t1 = Math.max(...ts);
  const L = 70; const R = 12; const T = 12; const B = 38;
  const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  ctx.font = "18px 'Exo 2', sans-serif";
  ctx.fillStyle = getComputedStyle(canvas).color || "#cfe";
  ctx.strokeStyle = "rgba(160,170,190,0.3)";
  niceTicks(y0, y1, 5).forEach((v) => { ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.fillText(formatValue(v, y1 - y0), 4, Y(v) + 6); });
  ctx.fillText(`t ${formatValue(t0, t1 - t0 || 1)}`, L, H - 10);
  const end = `t ${formatValue(t1, t1 - t0 || 1)}`;
  ctx.fillText(end, W - R - ctx.measureText(end).width, H - 10);
  shown.forEach((st, si) => {
    ctx.strokeStyle = STATION_COLOURS[si];
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ts.forEach((t, k) => { const v = valueOf(k, si); if (!Number.isFinite(v)) return; if (k) ctx.lineTo(X(t), Y(v)); else ctx.moveTo(X(t), Y(v)); });
    ctx.stroke();
    if (ts.length === 1) { ctx.fillStyle = STATION_COLOURS[si]; ctx.fillRect(X(ts[0]) - 4, Y(valueOf(0, si)) - 4, 8, 8); }
  });
  if (stations.length > shown.length) { ctx.fillStyle = "rgba(200,200,210,0.8)"; ctx.fillText(`first ${shown.length} of ${stations.length} points`, L + 6, T + 18); }
}

async function fitAllSteps() {
  const f = S.fields[S.field];
  const desc = f?.desc;
  if (!f?.ok || !desc) return;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < f.steps.length; k += 1) {
    status(`Range over ${f.field}: ${k + 1} / ${f.steps.length}`);
    const values = await valuesAt(S.field, k);
    const [a, b] = rangeOf(scalarOf(values, desc), S.view === "slice" ? null : scene.surfNodes);
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  S.range = [lo, hi];
  status(`Range fixed to ${formatValue(lo, hi - lo)} … ${formatValue(hi, hi - lo)} over ${f.steps.length} steps.`);
  renderControls();
  refresh();
}

let playTimer = null;
function startPlay() {
  const f = S.fields[S.field];
  if (!f?.steps.length) return;
  S.playing = true;
  const button = byId("gales-play");
  if (button) button.textContent = "❚❚";
  const tick = async () => {
    if (!S.playing) return;
    S.step = (S.step + 1) % f.steps.length;
    const started = performance.now();
    await refresh();
    playTimer = setTimeout(tick, Math.max(0, 350 - (performance.now() - started)));
  };
  tick();
}

function stopPlay() {
  S.playing = false;
  clearTimeout(playTimer);
  const button = byId("gales-play");
  if (button) button.textContent = "▶";
}

const STYLE = `
.gales-section .gis-tool-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.45rem; }
.gales-range { width: 100%; accent-color: var(--nav-accent, #ff2bd6); }
.gales-doors { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.gales-doors .studio-btn { flex: 1 1 auto; }
.gales-drop { padding: 0.55rem; border: 1px dashed rgba(var(--nav-accent-rgb, 255, 43, 214), 0.45); border-radius: 0.5rem; text-align: center; font-size: 0.68rem; opacity: 0.8; }
.gales-drop.is-over { background: rgba(var(--nav-accent-rgb, 255, 43, 214), 0.14); opacity: 1; }
.gales-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.15rem 0.6rem; font-size: 0.72rem; }
.gales-kv span { opacity: 0.72; }
.gales-kv b { font-weight: 600; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.gales-subhead { font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.75; margin-top: 0.3rem; }
.gales-typed { width: 100%; min-height: 3.6rem; resize: vertical; font-family: inherit; }
.gales-stations { display: grid; gap: 0.25rem; max-height: 14rem; overflow-y: auto; }
.gales-station { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 0.3rem; align-items: center; }
.gales-station .studio-input { min-width: 0; width: 100%; }
.gales-station-info { font-size: 0.62rem; opacity: 0.72; white-space: nowrap; }
.gales-sw { width: 0.6rem; height: 0.6rem; border-radius: 2px; }
.gales-x { padding: 0 0.4rem; }
.gales-plot { width: 100%; height: auto; color: var(--skin-data, #52e4e8); background: rgba(0, 0, 0, 0.25); border-radius: 0.4rem; }
#gales-status.is-error { color: #ff8a80; }
#model-studio .gales-legend { position: absolute; right: 1rem; bottom: 4.4rem; z-index: 6; width: 15rem; padding: 0.55rem 0.7rem 0.5rem; border-radius: 0.6rem; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.34); background: rgb(16, 7, 36); background: var(--skin-card-ground, rgb(16, 7, 36)); color: var(--text, #e8eaf2); font-family: 'Exo 2', sans-serif; pointer-events: none; }
.gales-legend[hidden] { display: none !important; }
.gales-legend-title { font-size: 0.76rem; font-weight: 600; letter-spacing: 0.04em; }
.gales-legend-sub { font-size: 0.64rem; opacity: 0.7; margin: 0.1rem 0 0.35rem; overflow-wrap: anywhere; }
.gales-legend-bar { display: block; width: 100%; height: 0.8rem; border-radius: 0.2rem; }
.gales-legend-flags { display: flex; flex-wrap: wrap; gap: 0.2rem 0.6rem; font-size: 0.66rem; font-variant-numeric: tabular-nums; margin-top: 0.25rem; }
.gales-legend-flags i, .gales-flag-swatch { display: inline-block; width: 0.62rem; height: 0.62rem; border-radius: 2px; margin-right: 0.3rem; vertical-align: -0.05rem; }
.gales-flag-list { display: grid; gap: 0.2rem; max-height: 10rem; overflow-y: auto; }
.gales-legend-ticks { position: relative; height: 1rem; font-size: 0.62rem; font-variant-numeric: tabular-nums; }
.gales-legend-ticks span { position: absolute; top: 0.15rem; transform: translateX(-50%); white-space: nowrap; }
.gales-legend-ticks span:first-child { transform: none; }
.gales-legend-ticks span:last-child { transform: translateX(-100%); }
.gales-legend-ends { font-size: 0.6rem; opacity: 0.65; font-variant-numeric: tabular-nums; }
`;

function install() {
  if (!byId("gales-results-style")) {
    const tag = document.createElement("style");
    tag.id = "gales-results-style";
    tag.textContent = STYLE;
    document.head.append(tag);
  }
  renderControls();
  const wait = () => {
    if (!installProbe()) setTimeout(wait, 500);
  };
  wait();
}

if (typeof document !== "undefined" && typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const start = () => {
    if (byId("studio-results-host")) install();
    else setTimeout(start, 400);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.GeoIDGalesResults = {
    openFolder: (files) => openSource(folderSource(files)),
    openProjectRun: async (dir) => openSource(await projectSource(dir)),
    state: S,
    refresh,
    // The results frame, for anything drawn in the mesh's own coordinates
    // (the mesh-quality overlay).
    frame: () => scene.frame,
    // Element quality of the open mesh, computed in the reader that holds its
    // cells (mesh-quality.js's analysis, arrays by transfer).
    quality: async () => (S.mesh ? (await getReader().call("quality", {})).analysis : null),
    // For the Analysis tab: the open field's numbers, and where points fall.
    values: (fieldIndex = S.field, stepIndex = S.step) => valuesAt(fieldIndex, stepIndex),
    desc: () => currentDesc(),
    scalar: (values, desc = currentDesc()) => scalarOf(values, desc),
    // Anything that interpolates or averages must not work on wrapped fringes:
    // it takes the LOS and wraps afterwards (afterSampling), as the slice does.
    samplingScalar: (values, desc = currentDesc()) => {
      const out = scalarOf(values, desc);
      return S.component === "fringe" && canLos(desc) ? S.losRaw : out;
    },
    afterSampling: (samples, desc = currentDesc()) => (S.component === "fringe" && canLos(desc) ? wrapFringes(samples, S.insar.wavelength) : samples),
    statsLabel: (desc = currentDesc()) => (S.component === "fringe" && canLos(desc) ? "LOS displacement (m, + toward the satellite)" : componentLabel(desc)),
    domainStats: async (scalar, bins = 24) => {
      if (!S.mesh) return null;
      const copy = Float32Array.from(scalar);
      return (await getReader().call("stats", { scalar: copy, bins }, [copy.buffer])).stats;
    },
    componentLabel: () => componentLabel(currentDesc()),
    locate: async (points) => (S.mesh ? (await getReader().call("locate", { points }, [points.buffer])).located : null),
    colormap: () => colormapTable(S.colormap, { reverse: S.reverse }),
    // ParaView: the .vtu files for a selection, and the download.
    // Contour levels and isosurface levels as drawn (for a report, and for tests).
    display: () => ({ contours: S.contours.on ? S.contours.levels : [], iso: S.iso.on ? S.iso.used : [] }),
    setReference: (files) => setReference(files),
    clearReference: () => clearReference(),
    vtkFiles: (options) => buildVtkFiles(options),
    exportVtk: (options) => exportVtk(options),
  };
}
