/**
 * THE REAL MESH, on the model page: what gmsh wrote, drawn on the model and
 * read for its flags.
 *
 * The studio's Mesh 3D is a lattice PREVIEW — stair-stepped, capped, blind to
 * booleans. The mesh a solve uses is gmsh's, and until now it went into the
 * project's meshes/ and was never looked at: its element count, its flags,
 * whether a face the setup holds still exists in it. This card brings it back:
 *
 *   - Mesh with gmsh runs the model's own script in the sidecar and opens the
 *     .msh it wrote; Open mesh reads any .msh or GALES text mesh from disk.
 *   - The boundary is drawn one colour per face flag, each flag its own row
 *     in the Visibility box, with the element edges on request.
 *   - The report counts elements by kind, cells by volume flag, sides by face
 *     flag and the flags that live only on nodes (embedded points).
 *   - mesh-flags.js checks the Physics and Materials setup against the flags
 *     the mesh actually carries (the Study checklist shows it too), and the
 *     Quality card can read the mesh.
 *
 * Drawn in the studio's own frame: model coordinates, z up, under the model
 * anchor turned by the same MODEL_TO_SCENE the studio's solids use.
 */

import * as THREE from "../vendor/three.module.js";
import { parseMesh } from "./gales-results.js?v=20260919-6aa21d5";
import { meshFlagReport } from "./mesh-flags.js?v=20260919-6aa21d5";

const MODEL_TO_SCENE = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const ASK_ABOVE_BYTES = 60e6;
const byId = (id) => document.getElementById(id);
const studio = () => window.GeoIDMeshStudio;
const sidecar = () => window.GeoIDResearch?.sidecar;
const store = () => window.GeoIDResearch?.store;

const R = { mesh: null, report: null, name: "", group: null, parts: new Map(), edges: null, showEdges: false, busy: false, text: "", level: "" };

/** A colour per flag that stays the same between loads. */
export function flagColour(flag) {
  const hue = ((Number(flag) * 137.508) % 360) / 360;
  return new THREE.Color().setHSL(hue, 0.55, 0.58).getHex();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v);
  }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}

function say(text, level = "") {
  R.text = text; R.level = level;
  const node = byId("realmesh-status");
  if (node) { node.textContent = text; node.className = `studio-readout${level ? ` is-${level}` : ""}`; }
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

function dispose() {
  if (!R.group) return;
  R.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  R.group.parent?.remove(R.group);
  R.group = null;
  R.parts.clear();
  R.edges = null;
}

function build() {
  dispose();
  const m = R.mesh;
  const anchor = studio()?.ensureAnchor?.() || studio()?.getAnchor?.();
  if (!m || !anchor) return;
  const group = new THREE.Group();
  group.name = "studio-real-mesh";
  const byFlag = new Map();
  for (let t = 0; t < m.surfaceFlag.length; t += 1) {
    const flag = m.surfaceFlag[t];
    if (!byFlag.has(flag)) byFlag.set(flag, []);
    byFlag.get(flag).push(t);
  }
  const c = m.coords;
  for (const [flag, tris] of [...byFlag].sort((a, b) => a[0] - b[0])) {
    const pos = new Float32Array(tris.length * 9);
    tris.forEach((t, k) => {
      for (let v = 0; v < 3; v += 1) {
        const n = m.surface[t * 3 + v];
        pos[k * 9 + v * 3] = c[n * 3]; pos[k * 9 + v * 3 + 1] = c[n * 3 + 1]; pos[k * 9 + v * 3 + 2] = c[n * 3 + 2];
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.applyMatrix4(MODEL_TO_SCENE);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: flagColour(flag), roughness: 0.8, metalness: 0, flatShading: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    mesh.name = `studio-real-mesh-flag-${flag}`;
    mesh.userData.flag = flag;
    group.add(mesh);
    R.parts.set(flag, { mesh, triangles: tris.length });
  }
  // Every boundary triangle's edges, once each.
  const seen = new Set();
  const lines = [];
  for (let t = 0; t < m.surface.length / 3; t += 1) {
    for (let e = 0; e < 3; e += 1) {
      const a = m.surface[t * 3 + e]; const b = m.surface[t * 3 + ((e + 1) % 3)];
      const key = a < b ? a * m.nodeCount + b : b * m.nodeCount + a;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(c[a * 3], c[a * 3 + 1], c[a * 3 + 2], c[b * 3], c[b * 3 + 1], c[b * 3 + 2]);
    }
  }
  const eg = new THREE.BufferGeometry();
  eg.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(lines), 3));
  eg.applyMatrix4(MODEL_TO_SCENE);
  R.edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x0b0f17, transparent: true, opacity: 0.55 }));
  R.edges.name = "studio-real-mesh-edges";
  R.edges.visible = R.showEdges;
  group.add(R.edges);
  anchor.add(group);
  R.group = group;
  studio()?.refreshVisibility?.();
}

function visibility() {
  if (!R.group) return null;
  const parts = [...R.parts].map(([flag, p]) => ({
    id: `real-mesh-${flag}`, name: flag ? `Face flag ${flag} — ${p.triangles.toLocaleString()} triangles` : `Unflagged — ${p.triangles.toLocaleString()} triangles`,
    face: `flag ${flag}`, kind: "mesh", mesh: p.mesh, colour: flagColour(flag), onVisible: () => render(),
  }));
  if (R.edges) parts.push({ id: "real-mesh-edges", name: "Element edges", face: "edges", kind: "mesh", mesh: R.edges, colour: 0x0b0f17, onVisible: () => { R.showEdges = R.edges.visible; render(); } });
  return { id: "real-mesh", title: `Mesh — ${R.name}`, parts };
}

/* ── loading ─────────────────────────────────────────────────────────────── */

export async function loadMeshBuffer(buffer, name) {
  const t0 = performance.now();
  R.busy = true;
  render();
  say(`Reading ${name}…`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  try {
    const mesh = parseMesh(new Uint8Array(buffer));
    R.mesh = mesh;
    R.report = meshFlagReport(mesh);
    R.name = name;
    build();
    const r = R.report;
    say(`${name}: ${r.nodes.toLocaleString()} nodes, ${r.cells.toLocaleString()} elements, read in ${Math.round(performance.now() - t0)} ms.`, "ok");
    document.dispatchEvent(new Event("geoid-studio:mesh-changed"));
  } catch (error) {
    say(`Could not read ${name}: ${error.message}`, "error");
  } finally {
    R.busy = false;
    render();
  }
}

async function openFile(file) {
  if (!file) return;
  if (file.size > ASK_ABOVE_BYTES && !window.confirm(`${file.name} is ${(file.size / 1e6).toFixed(0)} MB. Reading it holds the page for a while and draws its whole boundary. Continue?`)) return;
  await loadMeshBuffer(await file.arrayBuffer(), file.name);
}

async function meshWithGmsh() {
  const project = store()?.getActive?.();
  if (!sidecar()?.isConnected?.()) { say("Gmsh runs in the local sidecar — connect it in Settings ▸ Sidecar, or run the gmsh script (Export ▸ gmsh script) and Open the .msh it writes.", "warning"); return; }
  if (!project) { say("Open a project first: gmsh writes into its meshes/ folder.", "warning"); return; }
  const name = (byId("realmesh-name")?.value || "geoid_studio").trim().replace(/[^A-Za-z0-9_-]/g, "_") || "geoid_studio";
  const script = studio()?.gmshScriptFor?.(name);
  if (!script) { say("Nothing to mesh here: add a solid, or build a GIS terrain's package in the Model Builder.", "warning"); return; }
  R.busy = true;
  render();
  try {
    say(`gmsh: meshing ${name}…`);
    const id = await sidecar().runGmsh({ project: project.dir, script, name, dim: 3 });
    const snap = await sidecar().awaitJob(id, { timeoutMs: 3600 * 1000, everyMs: 800 });
    if (snap.status !== "done" || snap.exit_code) {
      say(`gmsh failed (${snap.status}${snap.exit_code != null ? `, exit ${snap.exit_code}` : ""}). The Jobs drawer has the log.`, "error");
      return;
    }
    const bytes = await store().readProjectFileBytes(`meshes/${name}.msh`);
    const buffer = bytes instanceof ArrayBuffer ? bytes : bytes instanceof Blob ? await bytes.arrayBuffer() : new TextEncoder().encode(String(bytes)).buffer;
    R.busy = false;
    await loadMeshBuffer(buffer, `meshes/${name}.msh`);
  } catch (error) {
    say(`gmsh could not run: ${error.message}`, "error");
  } finally {
    R.busy = false;
    render();
  }
}

export function clearMesh() {
  dispose();
  R.mesh = null; R.report = null; R.name = "";
  studio()?.refreshVisibility?.();
  say("");
  document.dispatchEvent(new Event("geoid-studio:mesh-changed"));
  render();
}

/* ── the card ────────────────────────────────────────────────────────────── */

function flagList(title, rows, unit, host) {
  if (!rows.length) return;
  host.append(el("p", { class: "studio-group-title" }, title));
  const list = el("div", { class: "realmesh-flags" });
  for (const r of rows) {
    const part = R.parts.get(r.flag);
    const chip = el("button", { class: `realmesh-flag${part && !part.mesh.visible ? " is-off" : ""}`, type: "button", title: part ? "Show or hide these faces" : "" },
      el("span", { class: "realmesh-swatch", style: `background:#${flagColour(r.flag).toString(16).padStart(6, "0")}` }),
      `${r.flag}`, el("span", { class: "realmesh-count" }, `${r.count.toLocaleString()}${unit ? ` ${unit}` : ""}`));
    if (part) chip.addEventListener("click", () => { part.mesh.visible = !part.mesh.visible; studio()?.refreshVisibility?.(); render(); });
    else chip.disabled = true;
    list.append(chip);
  }
  host.append(list);
}

export function render() {
  const host = byId("studio-realmesh-host");
  if (!host) return;
  host.textContent = "";
  const connected = Boolean(sidecar()?.isConnected?.());
  host.append(el("p", { class: "studio-readout" }, "Mesh 3D above is a preview. A solve uses gmsh's mesh: make or open it here to see its elements and flags."));
  const name = el("input", { id: "realmesh-name", class: "studio-input", type: "text", value: byId("realmesh-name")?.value || "geoid_studio", spellcheck: "false" });
  name.addEventListener("keydown", (event) => event.stopPropagation());
  host.append(el("div", { class: "studio-row" }, el("label", { for: "realmesh-name" }, "Mesh name"), name));
  const picker = el("input", { type: "file", accept: ".msh,.txt", hidden: true });
  picker.addEventListener("change", () => { const f = picker.files?.[0]; picker.value = ""; openFile(f); });
  const gmsh = el("button", { class: "studio-primary", type: "button", title: connected ? "Run the model's gmsh script in the sidecar and open the mesh" : "Needs the local sidecar (Settings ▸ Sidecar)" }, "Mesh with gmsh");
  gmsh.disabled = R.busy;
  gmsh.addEventListener("click", meshWithGmsh);
  const open = el("button", { class: "studio-secondary", type: "button", title: "A gmsh .msh or a GALES text mesh" }, "Open mesh…");
  open.disabled = R.busy;
  open.addEventListener("click", () => picker.click());
  host.append(el("div", { class: "studio-actions" }, gmsh, open), picker);

  host.append(el("div", { id: "realmesh-status", class: `studio-readout${R.level ? ` is-${R.level}` : ""}` }, R.text));
  const r = R.report;
  if (!r) return;
  const dl = el("dl", { class: "st-facts" });
  const fact = (k, v) => dl.append(el("dt", {}, k), el("dd", {}, v));
  fact("Mesh", R.name);
  fact("Nodes", r.nodes.toLocaleString());
  r.kinds.forEach((k) => fact(k.name.replace(/^\w/, (c) => c.toUpperCase()), k.count.toLocaleString()));
  if (r.sides) fact(`Boundary ${r.dim === 3 ? "faces" : "edges"}`, r.sides.toLocaleString());
  host.append(dl);
  flagList(r.dim === 3 ? "Volume flags" : "Surface flags", r.volumes, "", host);
  flagList("Face flags", r.faces, "", host);
  flagList("Point flags", r.points, "", host);
  if (r.unflaggedSides || r.unflaggedCells) host.append(el("p", { class: "studio-readout is-warning" }, `${r.unflaggedCells ? `${r.unflaggedCells.toLocaleString()} elements` : ""}${r.unflaggedCells && r.unflaggedSides ? " and " : ""}${r.unflaggedSides ? `${r.unflaggedSides.toLocaleString()} boundary faces` : ""} carry no flag.`));
  const edges = el("input", { type: "checkbox" });
  edges.checked = R.showEdges;
  edges.addEventListener("change", () => { R.showEdges = edges.checked; if (R.edges) R.edges.visible = edges.checked; studio()?.refreshVisibility?.(); });
  const fit = el("button", { class: "studio-secondary", type: "button" }, "Fit view");
  fit.addEventListener("click", () => { const first = [...R.parts.values()][0]; if (first) studio()?.fitObject?.(first.mesh); });
  const clear = el("button", { class: "studio-secondary", type: "button" }, "Clear");
  clear.addEventListener("click", clearMesh);
  host.append(el("label", { class: "studio-check" }, edges, " Element edges"), el("div", { class: "studio-actions" }, fit, clear));
}

function install() {
  if (!byId("studio-realmesh-host") || !studio()?.registerVisibility) { setTimeout(install, 500); return; }
  studio().registerVisibility("real-mesh", visibility);
  render();
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  window.GeoIDRealMesh = {
    get mesh() { return R.mesh; },
    get report() { return R.report; },
    get name() { return R.name; },
    load: loadMeshBuffer, clear: clearMesh, render,
  };
}
