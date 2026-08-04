import * as THREE from "../vendor/three.module.js";
import { PRIMITIVES, buildSurface, buildInside, boundingBoxOf } from "./mesh-primitives.js?v=20260804a";
import {
  latticeTetMesh, tetBoundarySurface, qualityStats, elementCounts, toGmsh22,
} from "./mesh-volume.js?v=20260804a";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260804a";
import { downloadText } from "./extraction.js?v=20260804a";

// Meshing Studio, ported from atlas-ai/services/mesh/meshing_studio.
//
// The Qt app's structure is kept deliberately: the same toolbar actions in the
// same order, the same Add/Model/Label/History and Mesh/Structured/Refine/Log
// decks, the same field types. What differs is the engine underneath — Gmsh's
// OCC kernel and Delaunay mesher are replaced by parametric solids with exact
// inside-tests and a lattice tet mesher, because those can run in a browser.

const byId = (id) => document.getElementById(id);

const state = {
  solids: [],
  fields: [],
  history: [],
  selection: null,
  mesh: null,
  kind: "box",
  params: {},
  groups: [],
};

function log(line) {
  const host = byId("studio-log");
  if (host) {
    const stamp = new Date().toLocaleTimeString();
    host.textContent += `${host.textContent ? "\n" : ""}[${stamp}] ${line}`;
    host.scrollTop = host.scrollHeight;
  }
}

function status(text) {
  const node = byId("studio-status");
  if (node) node.textContent = text;
}

function record(op) {
  state.history.push({ op, at: Date.now() });
  renderHistory();
}

// ── Palette (Add tab) ───────────────────────────────────────────────────────

const TEMPLATES = {
  etna_chamber: {
    label: "Volcano + chamber",
    build: () => [
      { kind: "volcano_edifice", op: "union", params: {} },
      { kind: "ellipsoid", op: "difference", params: { z: -3, rx: 2, ry: 2, rz: 1.2 } },
    ],
  },
  layered_dike: {
    label: "Layered crust + dike",
    build: () => [
      { kind: "layered_halfspace", op: "union", params: { width: 12, depth: 12, thicknesses: "2,3,5" } },
      { kind: "dike", op: "difference", params: { length: 6, height: 5, thickness: 0.6, top_depth: 1, strike: 30, dip: 80 } },
    ],
  },
};

function renderPalette() {
  const host = byId("studio-palette");
  if (!host) return;
  host.innerHTML = "";
  Object.entries(PRIMITIVES).forEach(([id, spec]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = spec.label;
    button.dataset.kind = id;
    button.classList.toggle("is-on", id === state.kind);
    button.addEventListener("click", () => {
      state.kind = id;
      renderPalette();
      renderParams();
    });
    host.appendChild(button);
  });

  const templates = byId("studio-templates");
  if (templates) {
    templates.innerHTML = "";
    Object.entries(TEMPLATES).forEach(([id, tpl]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tpl.label;
      button.addEventListener("click", () => {
        tpl.build().forEach((entry) => addSolid(entry.kind, entry.op, entry.params));
        log(`template "${tpl.label}" expanded into ${tpl.build().length} ops`);
      });
      templates.appendChild(button);
    });
  }
}

function renderParams() {
  const host = byId("studio-params");
  const spec = PRIMITIVES[state.kind];
  if (!host || !spec) return;
  host.innerHTML = "";
  Object.entries(spec.params).forEach(([key, [label, value]]) => {
    const row = document.createElement("div");
    row.className = "studio-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const input = document.createElement("input");
    input.className = "studio-input";
    input.dataset.param = key;
    input.type = key === "thicknesses" ? "text" : "number";
    input.step = "any";
    input.value = String(value);
    row.appendChild(lab);
    row.appendChild(input);
    host.appendChild(row);
  });
}

function readParams() {
  const out = {};
  document.querySelectorAll("#studio-params [data-param]").forEach((input) => {
    out[input.dataset.param] = input.value;
  });
  return out;
}

// ── Scene ───────────────────────────────────────────────────────────────────

function displayMesh(positions, name, color) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius || 1;
  const scale = radius > 0 ? MODEL_MODE_RADIUS / radius : 1;
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide, flatShading: true,
  }));
  mesh.name = name;
  mesh.scale.setScalar(scale);
  mesh.userData.localModel = true;
  mesh.userData.baseScale = scale;
  const boundingSphere = geometry.boundingSphere?.clone();
  if (boundingSphere) boundingSphere.radius *= scale;
  window.GeoIDImportManager?.addDerivedLayer(name, {
    object3D: mesh, boundingSphere, georeferenced: false,
    info: { triangleCount: positions.length / 9 },
  }, "mesh");
  return mesh;
}

// ── Model operations ────────────────────────────────────────────────────────

function addSolid(kind, op, paramOverrides) {
  const params = paramOverrides || readParams();
  const { positions, params: merged } = buildSurface(kind, params);
  const entry = {
    id: state.solids.length + 1,
    kind,
    op,
    enabled: true,
    params: merged,
    test: buildInside(kind, params),
    bounds: boundingBoxOf(kind, params),
    region: PRIMITIVES[kind].region ? PRIMITIVES[kind].region(merged) : null,
    object3D: null,
  };
  entry.object3D = displayMesh(positions,
    `${kind}_${entry.id}`, op === "difference" ? 0xff7a6b : 0x9fd8ff);
  state.solids.push(entry);
  record(`${op} ${kind}`);
  renderModelTree();
  status(`${state.solids.length} entities`);
  log(`${op}: ${PRIMITIVES[kind].label}`);
}

function combinedInside() {
  const active = state.solids.filter((s) => s.enabled);
  if (!active.length) return null;
  return (p) => {
    let value = false;
    active.forEach((entry) => {
      const hit = entry.test(p);
      if (entry.op === "difference") value = value && !hit;
      else if (entry.op === "intersect") value = value && hit;
      else value = value || hit;
    });
    return value;
  };
}

function combinedBounds() {
  const active = state.solids.filter((s) => s.enabled);
  if (!active.length) return null;
  const additive = active.filter((s) => s.op === "union");
  const source = additive.length ? additive : active;
  return source.reduce((acc, e) => ({
    minX: Math.min(acc.minX, e.bounds.minX), maxX: Math.max(acc.maxX, e.bounds.maxX),
    minY: Math.min(acc.minY, e.bounds.minY), maxY: Math.max(acc.maxY, e.bounds.maxY),
    minZ: Math.min(acc.minZ, e.bounds.minZ), maxZ: Math.max(acc.maxZ, e.bounds.maxZ),
  }), { ...source[0].bounds });
}

function renderModelTree() {
  const entities = byId("studio-entities");
  if (entities) {
    entities.innerHTML = "";
    state.solids.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "studio-item";
      row.classList.toggle("is-selected", state.selection === entry.id);
      row.innerHTML = `<span>Volume ${entry.id} · ${PRIMITIVES[entry.kind].label}</span>`
        + `<span>${entry.enabled ? entry.op : "muted"}</span>`;
      row.addEventListener("click", () => {
        state.selection = state.selection === entry.id ? null : entry.id;
        renderModelTree();
        renderSelection();
      });
      entities.appendChild(row);
    });
  }
  const info = byId("studio-info");
  if (info) {
    const b = combinedBounds();
    info.innerHTML = state.solids.length
      ? `${state.solids.length} entities, ${state.fields.length} fields<br>`
        + (b ? `extent ${(b.maxX - b.minX).toFixed(2)} × ${(b.maxY - b.minY).toFixed(2)} × ${(b.maxZ - b.minZ).toFixed(2)}` : "")
      : "Empty model.";
  }
  const groups = byId("studio-groups");
  if (groups) {
    groups.innerHTML = state.groups.length
      ? ""
      : '<div class="studio-item"><span>No physical groups</span></div>';
    state.groups.forEach((g) => {
      const row = document.createElement("div");
      row.className = "studio-item";
      row.innerHTML = `<span>${g.name}</span><span>${g.entities.length} entities</span>`;
      groups.appendChild(row);
    });
  }
}

function renderSelection() {
  const node = byId("studio-selection");
  if (!node) return;
  const entry = state.solids.find((s) => s.id === state.selection);
  node.textContent = entry
    ? `Selected: Volume ${entry.id} (${PRIMITIVES[entry.kind].label})`
    : "Nothing selected";
}

function renderHistory() {
  const host = byId("studio-history");
  if (!host) return;
  host.innerHTML = "";
  state.history.forEach((h, i) => {
    const row = document.createElement("div");
    row.className = "studio-item";
    row.innerHTML = `<span>${i + 1}. ${h.op}</span>`;
    host.appendChild(row);
  });
}

function renderFields() {
  const host = byId("studio-fields");
  if (!host) return;
  host.innerHTML = state.fields.length ? "" : '<div class="studio-item"><span>No fields</span></div>';
  state.fields.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "studio-item";
    row.classList.toggle("is-selected", f.selected);
    row.innerHTML = `<span>${i + 1}. ${f.type}</span><span>r ${f.radius}</span>`;
    row.addEventListener("click", () => {
      state.fields.forEach((o) => { o.selected = false; });
      f.selected = true;
      renderFields();
    });
    host.appendChild(row);
  });
}

// ── Meshing ─────────────────────────────────────────────────────────────────

function meshModel(dim) {
  const inside = combinedInside();
  const bounds = combinedBounds();
  if (!inside || !bounds) {
    status("nothing to mesh");
    log("Mesh aborted: model is empty");
    return;
  }
  const sizeMax = Number(byId("studio-size-hi")?.value) || 1;
  const sizeMin = Number(byId("studio-size-lo")?.value) || sizeMax;
  const active = state.fields.find((f) => f.type === "ball") || null;
  const refine = active ? { x: active.x, y: active.y, z: active.z, radius: active.radius } : null;
  const regionSource = state.solids.find((s) => s.enabled && s.region);

  status("meshing…");
  log(`Mesh ${dim}D: size ${sizeMin}–${sizeMax}${refine ? ", ball refine" : ""}`);
  window.requestAnimationFrame(() => {
    const t0 = performance.now();
    const result = latticeTetMesh(inside, bounds, {
      cellSize: Math.max(sizeMin, 1e-6),
      refine,
      regionFn: regionSource ? regionSource.region : null,
    });
    if (!result.ok) {
      status("mesh failed");
      log(result.message);
      byId("studio-mesh-info").textContent = result.message;
      return;
    }
    const surface = tetBoundarySurface(result.nodes, result.tets);
    state.mesh = { ...result, surface };
    const counts = elementCounts(result.nodes, result.tets, surface);
    // 1D/2D requests still mesh the volume (the lattice is inherently 3D) but
    // only the boundary is shown, matching what those buttons display.
    displayMesh(surface, `mesh_${dim}d_${counts.tetrahedra}`, 0xc9b79c);
    byId("studio-mesh-info").innerHTML =
      `<strong>${counts.tetrahedra.toLocaleString()}</strong> tets · `
      + `${counts.nodes.toLocaleString()} nodes · ${counts.boundaryTriangles.toLocaleString()} tris`;
    status(`${counts.tetrahedra.toLocaleString()} elements`);
    log(`Meshed in ${Math.round(performance.now() - t0)} ms`);
    showQuality();
    ["studio-exp-msh", "studio-exp-stl", "studio-exp-obj", "studio-exp-ply"]
      .forEach((id) => { const b = byId(id); if (b) b.disabled = false; });
    record(`mesh ${dim}D`);
  });
}

function showQuality() {
  if (!state.mesh) return;
  const q = qualityStats(state.mesh.nodes, state.mesh.tets);
  if (!q) return;
  const canvas = byId("studio-quality");
  if (!canvas) return;
  canvas.hidden = false;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const peak = Math.max(...q.histogram, 1);
  const w = canvas.width / q.histogram.length;
  q.histogram.forEach((count, i) => {
    const h = (count / peak) * (canvas.height - 14);
    ctx.fillStyle = i < 2 ? "#ff7a6b" : "#8ef6c4";
    ctx.fillRect(i * w + 1, canvas.height - h, w - 2, h);
  });
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "9px monospace";
  ctx.fillText(`min ${q.min.toFixed(2)}  mean ${q.mean.toFixed(2)}  inv ${q.invertedElements}`, 3, 10);
  log(`Quality: min ${q.min.toFixed(3)}, mean ${q.mean.toFixed(3)}, volume ${q.volume.toFixed(3)}`);
}

// ── Export ──────────────────────────────────────────────────────────────────

function surfaceToStl(p) {
  const out = ["solid geoid"];
  for (let i = 0; i < p.length; i += 9) {
    out.push("facet normal 0 0 0", "  outer loop");
    for (let v = 0; v < 3; v += 1) out.push(`    vertex ${p[i + v * 3]} ${p[i + v * 3 + 1]} ${p[i + v * 3 + 2]}`);
    out.push("  endloop", "endfacet");
  }
  out.push("endsolid geoid");
  return out.join("\n");
}

function surfaceToObj(p) {
  const out = [];
  for (let i = 0; i < p.length; i += 3) out.push(`v ${p[i]} ${p[i + 1]} ${p[i + 2]}`);
  for (let f = 0; f < p.length / 9; f += 1) out.push(`f ${f * 3 + 1} ${f * 3 + 2} ${f * 3 + 3}`);
  return out.join("\n");
}

function surfaceToPly(p) {
  const n = p.length / 3;
  const out = ["ply", "format ascii 1.0", `element vertex ${n}`,
    "property float x", "property float y", "property float z",
    `element face ${n / 3}`, "property list uchar int vertex_index", "end_header"];
  for (let i = 0; i < p.length; i += 3) out.push(`${p[i]} ${p[i + 1]} ${p[i + 2]}`);
  for (let f = 0; f < n / 3; f += 1) out.push(`3 ${f * 3} ${f * 3 + 1} ${f * 3 + 2}`);
  return out.join("\n");
}

/** Emits the model as a runnable gmsh script, matching the studio's action. */
function exportScript() {
  const lines = ["import gmsh", "gmsh.initialize()", 'gmsh.model.add("geoid")',
    "occ = gmsh.model.occ", ""];
  state.solids.forEach((entry) => {
    const p = entry.params;
    const f = (v) => Number(v).toFixed(6);
    if (entry.kind === "box") {
      lines.push(`occ.addBox(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.dx)}, ${f(p.dy)}, ${f(p.dz)})  # ${entry.op}`);
    } else if (entry.kind === "sphere") {
      lines.push(`occ.addSphere(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.r)})  # ${entry.op}`);
    } else if (entry.kind === "cylinder") {
      lines.push(`occ.addCylinder(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, 0, 0, ${f(p.h)}, ${f(p.r)})  # ${entry.op}`);
    } else if (entry.kind === "cone") {
      lines.push(`occ.addCone(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, 0, 0, ${f(p.h)}, ${f(p.r1)}, ${f(p.r2)})  # ${entry.op}`);
    } else if (entry.kind === "torus") {
      lines.push(`occ.addTorus(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.r1)}, ${f(p.r2)})  # ${entry.op}`);
    } else if (entry.kind === "volcano_edifice") {
      lines.push(`_crust = (3, occ.addBox(${f(-p.crust_width / 2)}, ${f(-p.crust_width / 2)}, ${f(-p.crust_depth)}, ${f(p.crust_width)}, ${f(p.crust_width)}, ${f(p.crust_depth)}))`);
      lines.push(`_cone = (3, occ.addCone(0, 0, 0, 0, 0, ${f(p.height)}, ${f(p.base_radius)}, ${f(p.summit_radius)}))`);
      lines.push("occ.fuse([_crust], [_cone])");
    } else if (entry.kind === "layered_halfspace") {
      lines.push(`# layered halfspace ${p.width} x ${p.depth}, thicknesses ${p.thicknesses}`);
    } else if (entry.kind === "dike") {
      lines.push(`# dike L=${f(p.length)} H=${f(p.height)} T=${f(p.thickness)} strike=${f(p.strike)} dip=${f(p.dip)}`);
    } else {
      lines.push(`# ${entry.kind} ${JSON.stringify(p)}`);
    }
  });
  lines.push("", "occ.synchronize()",
    `gmsh.option.setNumber("Mesh.MeshSizeMax", ${Number(byId("studio-size-hi")?.value) || 1})`,
    "gmsh.model.mesh.generate(3)", 'gmsh.write("geoid.msh")', "gmsh.finalize()");
  downloadText("geoid_model.py", lines.join("\n"), "text/x-python");
  log("Exported gmsh script");
}

function exportMesh(kind) {
  if (!state.mesh) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const map = {
    msh: () => [toGmsh22(state.mesh.nodes, state.mesh.tets, state.mesh.regions), "msh", "text/plain"],
    stl: () => [surfaceToStl(state.mesh.surface), "stl", "model/stl"],
    obj: () => [surfaceToObj(state.mesh.surface), "obj", "text/plain"],
    ply: () => [surfaceToPly(state.mesh.surface), "ply", "text/plain"],
  };
  const [text, ext, mime] = map[kind]();
  downloadText(`geoid_mesh_${stamp}.${ext}`, text, mime);
  log(`Exported ${ext.toUpperCase()}`);
}

// ── Viewport controls ───────────────────────────────────────────────────────

function eachModelMaterial(fn) {
  (window.GeoIDImportManager?.getLayers?.() || []).forEach((layer) => {
    layer.object3D?.traverse?.((child) => {
      if (child.material) fn(child.material, child);
    });
  });
}

function viewAxis(axis) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera) return;
  const d = viewer.camera.position.length() || 10;
  const map = {
    x: [d, 0, 0], y: [0, d, 0], z: [0, 0, d],
    iso: [d * 0.577, d * 0.577, d * 0.577],
  };
  const p = map[axis] || map.iso;
  viewer.camera.position.set(p[0], p[1], p[2]);
  viewer.controls.target.set(0, 0, 0);
  viewer.controls.update();
}

function fitView() {
  const viewer = window.GeoIDViewer;
  const layers = (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((l) => l.object3D?.visible);
  if (!viewer?.camera || !layers.length) return;
  const box = new THREE.Box3();
  layers.forEach((l) => box.expandByObject(l.object3D));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const d = Math.max(sphere.radius * 2.6, 0.01);
  viewer.camera.position.set(d * 0.6, d * 0.5, d * 0.6);
  viewer.camera.near = Math.max(d / 1000, 0.0001);
  viewer.camera.far = d * 40;
  viewer.camera.updateProjectionMatrix();
  viewer.controls.target.copy(sphere.center);
  viewer.controls.update();
}

let clipPlane = null;

function applyClip() {
  const viewer = window.GeoIDViewer;
  const on = byId('[data-toggle="clip"]') || document.querySelector('[data-toggle="clip"]');
  const enabled = on?.classList.contains("is-on");
  const axis = byId("studio-clip-axis")?.value || "x";
  const t = Number(byId("studio-clip")?.value ?? 50) / 100;
  if (!viewer?.renderer) return;
  if (!enabled) {
    viewer.renderer.clippingPlanes = [];
    clipPlane = null;
    return;
  }
  const normal = axis === "x" ? new THREE.Vector3(-1, 0, 0)
    : axis === "y" ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1);
  const box = new THREE.Box3();
  (window.GeoIDImportManager?.getLayers?.() || []).forEach((l) => {
    if (l.object3D?.visible) box.expandByObject(l.object3D);
  });
  if (box.isEmpty()) return;
  const lo = axis === "x" ? box.min.x : axis === "y" ? box.min.y : box.min.z;
  const hi = axis === "x" ? box.max.x : axis === "y" ? box.max.y : box.max.z;
  clipPlane = new THREE.Plane(normal, lo + (hi - lo) * t);
  viewer.renderer.localClippingEnabled = true;
  viewer.renderer.clippingPlanes = [clipPlane];
}

// ── Wiring ──────────────────────────────────────────────────────────────────

const ACTIONS = {
  new: () => {
    state.solids.forEach((s) => s.object3D?.parent?.remove(s.object3D));
    state.solids.length = 0;
    state.fields.length = 0;
    state.history.length = 0;
    state.mesh = null;
    renderModelTree(); renderFields(); renderHistory(); renderSelection();
    status("new model"); log("New model");
  },
  open: () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".msproj.json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        ACTIONS.new();
        (data.solids || []).forEach((s) => addSolid(s.kind, s.op, s.params));
        log(`Opened project with ${(data.solids || []).length} ops`);
      } catch (error) {
        log(`Open failed: ${error.message}`);
      }
    });
    input.click();
  },
  save: () => {
    downloadText("model.msproj.json", JSON.stringify({
      solids: state.solids.map((s) => ({ kind: s.kind, op: s.op, params: s.params })),
      fields: state.fields,
      history: state.history,
    }, null, 2), "application/json");
    log("Project saved");
  },
  undo: () => {
    const entry = state.solids.pop();
    if (!entry) return;
    entry.object3D?.parent?.remove(entry.object3D);
    record("undo");
    renderModelTree();
    log("Undo");
  },
  redo: () => log("Redo: nothing to reapply"),
  "import-cad": () => document.getElementById("import-file-input")?.click(),
  "import-xyz": () => document.getElementById("import-file-input")?.click(),
  fuse: () => setOpOnSelection("union"),
  cut: () => setOpOnSelection("difference"),
  intersect: () => setOpOnSelection("intersect"),
  fragment: () => {
    log("Fragment: lattice meshing already conforms across shared interfaces");
    status("fragment is implicit");
  },
  transform: () => log("Transform: use the layer Style panel for scale and rotation"),
  delete: () => {
    const idx = state.solids.findIndex((s) => s.id === state.selection);
    if (idx === -1) { log("Delete: nothing selected"); return; }
    const [entry] = state.solids.splice(idx, 1);
    entry.object3D?.parent?.remove(entry.object3D);
    state.selection = null;
    record("delete"); renderModelTree(); renderSelection();
  },
  "export-script": exportScript,
  "to-gales": () => exportMesh("msh"),
  "to-explorer": () => {
    exportMesh("stl");
    log("Exported STL for the Earth viewer; import it in GIS mode to place it");
  },
  "save-template": () => {
    downloadText("template.json", JSON.stringify(
      state.solids.map((s) => ({ kind: s.kind, op: s.op, params: s.params })), null, 2,
    ), "application/json");
    log("Template saved");
  },
  snapshot: () => {
    const viewer = window.GeoIDViewer;
    if (!viewer?.renderer) return;
    viewer.renderer.render(viewer.scene, viewer.camera);
    const url = viewer.renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "studio_snapshot.png";
    a.click();
    log("Snapshot saved");
  },
};

function setOpOnSelection(op) {
  const entry = state.solids.find((s) => s.id === state.selection);
  if (!entry) { log(`${op}: select an entity first`); return; }
  entry.op = op;
  record(`${op} on ${entry.id}`);
  renderModelTree();
  log(`${op} applied to Volume ${entry.id}`);
}

function init() {
  if (!byId("model-studio")) return;
  renderPalette();
  renderParams();
  renderModelTree();
  renderFields();
  renderSelection();

  document.querySelectorAll(".studio-tabs").forEach((deck) => {
    deck.addEventListener("click", (event) => {
      const tab = event.target.closest(".studio-tab");
      if (!tab) return;
      const dock = deck.parentElement;
      dock.querySelectorAll(".studio-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      dock.querySelectorAll(".studio-pane").forEach((p) => {
        p.classList.toggle("is-active", p.dataset.pane === tab.dataset.tab);
      });
    });
  });

  document.querySelectorAll("#studio-toolbar-main [data-act]").forEach((button) => {
    button.addEventListener("click", () => {
      const fn = ACTIONS[button.dataset.act];
      if (fn) fn();
    });
  });

  document.querySelectorAll("[data-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.toggle("is-on");
      const on = button.classList.contains("is-on");
      const which = button.dataset.toggle;
      if (which === "wireframe") {
        eachModelMaterial((m) => { m.wireframe = on; m.needsUpdate = true; });
      } else if (which === "edges") {
        eachModelMaterial((m) => { m.flatShading = on; m.needsUpdate = true; });
      } else if (which === "clip") {
        applyClip();
      } else if (which === "gizmo") {
        log(`Gizmo ${on ? "on" : "off"} — drag handles are not implemented yet`);
      }
    });
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const which = button.dataset.view;
      if (which === "fit") fitView(); else viewAxis(which);
    });
  });

  byId("studio-clip")?.addEventListener("input", applyClip);
  byId("studio-clip-axis")?.addEventListener("change", applyClip);

  byId("studio-add")?.addEventListener("click", () => addSolid(state.kind, "union"));
  byId("studio-mesh1d")?.addEventListener("click", () => meshModel(1));
  byId("studio-mesh2d")?.addEventListener("click", () => meshModel(2));
  byId("studio-mesh3d")?.addEventListener("click", () => meshModel(3));
  byId("studio-clear-mesh")?.addEventListener("click", () => {
    state.mesh = null;
    byId("studio-mesh-info").textContent = "No mesh.";
    byId("studio-quality").hidden = true;
    log("Mesh cleared");
  });
  byId("studio-suggest")?.addEventListener("click", () => {
    const b = combinedBounds();
    if (!b) { log("Suggest: empty model"); return; }
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
    const suggested = Number((span / 20).toPrecision(2));
    byId("studio-size-lo").value = String(suggested);
    byId("studio-size-hi").value = String(suggested * 2);
    log(`Suggested size ${suggested} from a ${span.toFixed(2)} extent`);
  });

  byId("studio-field-add")?.addEventListener("click", () => {
    state.fields.push({
      type: byId("studio-field-type").value,
      x: Number(byId("studio-field-x").value) || 0,
      y: Number(byId("studio-field-y").value) || 0,
      z: Number(byId("studio-field-z").value) || 0,
      radius: Number(byId("studio-field-r").value) || 1,
      distMin: Number(byId("studio-field-dmin").value) || 0,
      distMax: Number(byId("studio-field-dmax").value) || 1,
      selected: false,
    });
    renderFields();
    log(`Added ${state.fields[state.fields.length - 1].type} field`);
  });
  byId("studio-field-remove")?.addEventListener("click", () => {
    const idx = state.fields.findIndex((f) => f.selected);
    if (idx >= 0) { state.fields.splice(idx, 1); renderFields(); log("Field removed"); }
  });

  byId("studio-label-apply")?.addEventListener("click", () => {
    const name = byId("studio-label-name").value.trim();
    if (!name || state.selection === null) { log("Label: name and selection needed"); return; }
    state.groups.push({ name, entities: [state.selection] });
    renderModelTree();
    log(`Labelled Volume ${state.selection} as "${name}"`);
  });
  byId("studio-refine-sel")?.addEventListener("click", () => {
    const entry = state.solids.find((s) => s.id === state.selection);
    if (!entry) { log("Refine: select an entity"); return; }
    const b = entry.bounds;
    state.fields.push({
      type: "ball",
      x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2,
      radius: Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2,
      distMin: Number(byId("studio-size-min").value) || 0,
      distMax: Number(byId("studio-size-max").value) || 1,
      selected: false,
    });
    renderFields();
    log(`Refinement field added around Volume ${entry.id}`);
  });

  byId("studio-tf-auto")?.addEventListener("click", () => {
    const nodes = Number(byId("studio-tf-nodes").value) || 10;
    const b = combinedBounds();
    if (!b) { log("Transfinite: empty model"); return; }
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
    byId("studio-size-lo").value = String(Number((span / nodes).toPrecision(3)));
    byId("studio-structured-info").textContent =
      `Lattice set to ${nodes} nodes across the longest extent.`;
    log(`Auto transfinite: ${nodes} nodes across ${span.toFixed(2)}`);
  });
  ["studio-tf-surfaces", "studio-tf-volumes", "studio-recombine-sel"].forEach((id) => {
    byId(id)?.addEventListener("click", () => log(
      `${id.replace("studio-", "")}: the lattice mesher is structured by construction`,
    ));
  });

  ["msh", "stl", "obj", "ply"].forEach((fmt) => {
    byId(`studio-exp-${fmt}`)?.addEventListener("click", () => exportMesh(fmt));
  });

  byId("studio-ai")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const text = event.target.value.trim();
    if (!text) return;
    // The Qt studio plans these with a local Ollama model, which is not
    // reachable from a web page; the phrasing is matched directly instead.
    const lower = text.toLowerCase();
    if (lower.includes("volcano")) {
      TEMPLATES.etna_chamber.build().forEach((e) => addSolid(e.kind, e.op, e.params));
      log(`AI: built a volcano with a chamber from "${text}"`);
    } else if (lower.includes("dike") || lower.includes("layer")) {
      TEMPLATES.layered_dike.build().forEach((e) => addSolid(e.kind, e.op, e.params));
      log(`AI: built a layered crust with a dike from "${text}"`);
    } else {
      log(`AI: no local planner available in the browser — try "volcano" or "dike"`);
    }
    event.target.value = "";
  });

  log("Meshing Studio ready");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDMeshStudio = { state, addSolid, meshModel, ACTIONS, fitView, viewAxis };
