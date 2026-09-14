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
  rangeOf, usedNodes, COLORMAPS, colormapTable, colourValues, niceTicks, formatValue,
  interpolateOnSlice, axisPlane, nodeByteRange, probeCsv, parseMesh, sliceTets,
} from "./gales-results.js?v=20260914-cfe1b52";
import { downloadText } from "./extraction.js?v=20260914-cfe1b52";

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
  opacity: 1,
  edges: false,
  probe: null,
  playing: false,
  busy: false,
  pending: false,
  statusText: "No results open.",
  statusError: false,
  clipOn: null,
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

// ── Opening ─────────────────────────────────────────────────────────────────

async function openSource(source) {
  stopPlay();
  S.source = source;
  cache.clear();
  const setup = source.entries.find((e) => /(^|\/)setup\.txt$/.test(e.path) && e.path.split("/").length <= 2);
  const setupText = setup ? await source.text(setup.path).catch(() => "") : "";
  S.plan = planSimulation(source.entries, setupText);
  if (!S.plan.fields.length) {
    status(`No results in ${source.label}: expected results/<field>/<time> files.`, true);
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
    S.probe = null;
    S.clipOn = null;
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
    const disp = S.fields.findIndex((f) => f.ok && (f.desc?.displacement || (!f.desc && /(^|\/)(solid\/u|elastostatic_dofs|fluid_mesh)$/.test(f.field))));
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
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const surface = new THREE.Mesh(geometry, material);
  surface.name = "gales-surface";
  surface.frustumCulled = false;
  // The clip plane is written in the mesh's own frame and carried to world
  // space every frame, so it follows the anchor wherever the studio puts it.
  surface.onBeforeRender = () => {
    if (!material.clippingPlanes?.length) return;
    scene.clip.copy(scene.clipLocal).applyMatrix4(frame.matrixWorld);
  };
  frame.add(surface);
  scene.surface = surface;

  const sliceGeometry = new THREE.BufferGeometry();
  const slice = new THREE.Mesh(sliceGeometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  slice.name = "gales-slice";
  slice.visible = false;
  slice.frustumCulled = false;
  frame.add(slice);
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
    frame.add(scene.outline);
  } else scene.outline = null;

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  marker.renderOrder = 10;
  marker.visible = false;
  marker.scale.setScalar(scene.radius * 0.008);
  frame.add(marker);
  scene.marker = marker;

  anchor.add(root);
  // The ground lattice cuts a hole under the results and the camera may go
  // below them, as it does under a buried solid.
  studio()?.setExternalBounds?.("gales-results", resultBounds());
  const viewer = window.GeoIDViewer;
  if (viewer?.renderer) viewer.renderer.localClippingEnabled = true;
}

// ── Refresh: field → colours, warp, slice, legend ───────────────────────────

function currentDesc() { return S.fields[S.field]?.desc || null; }

function scalarOf(values, desc) {
  const n = S.mesh.nodeCount;
  const nb = desc.nbDofs;
  if (S.component === "mag" && desc.vector) return magnitudeOf(values, n, nb, desc.vector.from, desc.blocked);
  const j = Number(S.component);
  return componentOf(values, n, nb, Number.isInteger(j) && j >= 0 && j < nb ? j : 0, desc.blocked);
}

function componentLabel(desc) {
  if (!desc) return "";
  if (S.component === "mag" && desc.vector) return `${desc.vector.label}${desc.vector.unit ? ` (${desc.vector.unit})` : ""}`;
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
      if (!S.component || (S.component === "mag" && !desc.vector) || (S.component !== "mag" && Number(S.component) >= desc.nbDofs)) {
        S.component = desc.vector ? "mag" : "0";
        renderControls();
      }
      scalar = scalarOf(values, desc);
    }

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

    const view = S.mesh.dim === 3 ? S.view : "surface";
    const sliced = await sliceFor(view);

    // Range over what is drawn.
    let sliceValues = null;
    if (sliced && scalar) sliceValues = interpolateOnSlice(sliced.slice, scalar);
    if (scalar && S.rangeMode === "step") {
      const parts = [];
      if (view !== "slice") parts.push(rangeOf(scalar, scene.surfNodes));
      if (sliceValues?.length) parts.push(rangeOf(sliceValues));
      const lo = Math.min(...parts.map((p) => p[0]));
      const hi = Math.max(...parts.map((p) => p[1]));
      S.range = Number.isFinite(lo) ? [lo, hi] : [0, 0];
    }
    const [lo, hi] = S.range;
    const table = colormapTable(S.colormap, { reverse: S.reverse });

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
    if (scalar) {
      const onSurface = new Float32Array(nodes.length);
      for (let k = 0; k < nodes.length; k += 1) onSurface[k] = scalar[nodes[k]];
      colourValues(onSurface, lo, hi, table, col, { bands: S.bands, log: S.log });
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
    scene.surface.visible = view !== "slice";
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
    if (scene.outline) scene.outline.visible = view !== "slice";

    // Slice.
    if (sliced) {
      const s = sliced.slice;
      const positions = interpolateOnSlice(s, S.mesh.coords, 3, new Float32Array(s.t.length * 3));
      if (disp) {
        const dOn = interpolateOnSlice(s, disp, 3);
        for (let k = 0; k < positions.length; k += 1) positions[k] += dOn[k];
      }
      const colours = new Float32Array(s.t.length * 3);
      if (sliceValues) colourValues(sliceValues, lo, hi, table, colours, { bands: S.bands, log: S.log });
      else colours.fill(0.72);
      const g = scene.slice.geometry;
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      scene.slice.visible = true;
    } else scene.slice.visible = false;

    updateProbeMarker(disp);
    renderLegend(desc, lo, hi, table);
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
  const targets = [scene.surface, scene.slice].filter((o) => o?.visible);
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
    const range = nb && !f.desc?.blocked ? nodeByteRange(node, S.mesh.nodeCount, nb) : null;
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

function renderLegend(desc, lo, hi, table) {
  const node = legendNode();
  if (!node) return;
  if (!desc || !scene.root?.visible) { node.hidden = true; return; }
  node.hidden = false;
  node.textContent = "";
  const f = S.fields[S.field];
  node.append(el("div", { class: "gales-legend-title" }, componentLabel(desc)));
  node.append(el("div", { class: "gales-legend-sub" }, `${f.field} · t = ${f.steps[S.step]?.name} · ${S.rangeMode === "step" ? "range of this step" : "fixed range"}${S.log ? " · log" : ""}`));
  const bar = el("canvas", { class: "gales-legend-bar", width: "220", height: "14" });
  const ctx = bar.getContext("2d");
  const steps = table.length / 3;
  for (let x = 0; x < 220; x += 1) {
    let u = x / 219;
    if (S.bands > 1) u = Math.min(S.bands - 1, Math.floor(u * S.bands)) / (S.bands - 1);
    const s = Math.round(u * (steps - 1)) * 3;
    ctx.fillStyle = `rgb(${table[s] * 255 | 0},${table[s + 1] * 255 | 0},${table[s + 2] * 255 | 0})`;
    ctx.fillRect(x, 0, 1, 14);
  }
  node.append(bar);
  const ticks = el("div", { class: "gales-legend-ticks" });
  const span = hi - lo;
  if (S.log && lo > 0) {
    [lo, Math.sqrt(lo * hi), hi].forEach((v, k) => ticks.append(el("span", { style: `left:${k * 50}%` }, formatValue(v, v))));
  } else {
    const values = span > 0 ? niceTicks(lo, hi, 5) : [lo];
    values.forEach((v) => ticks.append(el("span", { style: `left:${span > 0 ? ((v - lo) / span) * 100 : 50}%` }, formatValue(v, span || Math.abs(v) || 1))));
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

  // Field
  const fs = section("field", "Field and time");
  const fieldOptions = S.fields.map((f, k) => [k, `${f.field}${f.nbDofs ? ` · ${f.nbDofs} dof${f.nbDofs > 1 ? "s" : ""}` : ""} · ${f.steps.length} step${f.steps.length > 1 ? "s" : ""}${f.ok ? "" : " — other mesh"}`, !f.ok]);
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
    const comps = [...(desc.vector ? [["mag", desc.vector.label]] : []), ...desc.components.map((c, j) => [j, c.label])];
    fs.body.append(row("Component", select(comps, S.component, (v) => { S.component = v; refresh(); })));
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
    ds.body.append(row("View", select([["surface", "Surface"], ["slice", "Slice"], ["clip", "Clip at the slice"], ["both", "Translucent surface + slice"]], S.view, (v) => { S.view = v; renderControls(); refresh(); })));
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
    const top = el("button", { class: "studio-secondary", type: "button" }, "Plan view (2D)");
    top.addEventListener("click", () => studio()?.viewAxis?.("y", scene.surface));
    ds.body.append(top);
  }
  ds.body.append(check("Wireframe", S.edges, (v) => { S.edges = v; refresh(); }));
  const opacity = el("input", { class: "gales-range", type: "range", min: "0.1", max: "1", step: "0.05", value: String(S.opacity) });
  opacity.addEventListener("input", () => { S.opacity = Number(opacity.value); refresh(); });
  ds.body.append(row("Opacity", opacity));
  const fitBtn = el("button", { class: "studio-secondary", type: "button" }, "Fit the view");
  fitBtn.addEventListener("click", () => studio()?.fitObject?.(scene.surface));
  const hide = el("button", { class: "studio-secondary", type: "button" }, scene.root?.visible === false ? "Show results" : "Hide results");
  hide.addEventListener("click", () => {
    if (!scene.root) return;
    scene.root.visible = !scene.root.visible;
    studio()?.setExternalBounds?.("gales-results", scene.root.visible ? resultBounds() : null);
    renderControls();
    refresh();
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
  renderStepReadout();
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
.gales-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.15rem 0.6rem; font-size: 0.72rem; }
.gales-kv span { opacity: 0.72; }
.gales-kv b { font-weight: 600; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.gales-plot { width: 100%; height: auto; color: var(--skin-data, #52e4e8); background: rgba(0, 0, 0, 0.25); border-radius: 0.4rem; }
#gales-status.is-error { color: #ff8a80; }
#model-studio .gales-legend { position: absolute; right: 1rem; bottom: 4.4rem; z-index: 6; width: 15rem; padding: 0.55rem 0.7rem 0.5rem; border-radius: 0.6rem; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.34); background: rgb(16, 7, 36); background: var(--skin-card-ground, rgb(16, 7, 36)); color: var(--text, #e8eaf2); font-family: 'Exo 2', sans-serif; pointer-events: none; }
.gales-legend[hidden] { display: none !important; }
.gales-legend-title { font-size: 0.76rem; font-weight: 600; letter-spacing: 0.04em; }
.gales-legend-sub { font-size: 0.64rem; opacity: 0.7; margin: 0.1rem 0 0.35rem; overflow-wrap: anywhere; }
.gales-legend-bar { display: block; width: 100%; height: 0.8rem; border-radius: 0.2rem; }
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
  };
}
