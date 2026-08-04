import * as THREE from "../vendor/three.module.js";
import { PRIMITIVES, defaultParams, buildSurface, buildInside, boundingBoxOf } from "./mesh-primitives.js?v=20260804a";
import {
  latticeTetMesh, tetBoundarySurface, qualityStats, elementCounts, toGmsh22,
} from "./mesh-volume.js?v=20260804a";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260804a";
import { downloadText } from "./extraction.js?v=20260804a";

// Model mode's meshing environment: the Meshing Studio's workflow rebuilt
// natively so it lives inside this GUI rather than a separate Qt window.
// Geometry is described by parametric solids, combined with CSG, meshed into
// tetrahedra, inspected for quality and exported.

const byId = (id) => document.getElementById(id);

function setText(id, text) {
  const node = byId(id);
  if (node) node.textContent = text;
}

// The CSG stack: each entry contributes its inside-test to the combined solid.
const solids = [];
let lastMesh = null;

function combinedInside() {
  const active = solids.filter((s) => s.enabled);
  if (!active.length) {
    return null;
  }
  return (p) => {
    let value = false;
    active.forEach((entry) => {
      const hit = entry.test(p);
      if (entry.op === "difference") {
        value = value && !hit;
      } else if (entry.op === "intersect") {
        value = value && hit;
      } else {
        value = value || hit;
      }
    });
    return value;
  };
}

function combinedBounds() {
  const active = solids.filter((s) => s.enabled);
  if (!active.length) return null;
  // Difference and intersection never grow the result, so the union of the
  // additive solids bounds the whole tree.
  const additive = active.filter((s) => s.op === "union");
  const source = additive.length ? additive : active;
  return source.reduce((acc, entry) => ({
    minX: Math.min(acc.minX, entry.bounds.minX), maxX: Math.max(acc.maxX, entry.bounds.maxX),
    minY: Math.min(acc.minY, entry.bounds.minY), maxY: Math.max(acc.maxY, entry.bounds.maxY),
    minZ: Math.min(acc.minZ, entry.bounds.minZ), maxZ: Math.max(acc.maxZ, entry.bounds.maxZ),
  }), { ...source[0].bounds });
}

// ── Parameter form ──────────────────────────────────────────────────────────

function renderParamForm() {
  const host = byId("prim-params");
  const kind = byId("prim-kind")?.value;
  if (!host || !PRIMITIVES[kind]) return;
  host.innerHTML = "";
  Object.entries(PRIMITIVES[kind].params).forEach(([key, [label, value]]) => {
    const row = document.createElement("div");
    row.className = "row";
    const lab = document.createElement("label");
    lab.textContent = label;
    lab.htmlFor = `prim-p-${key}`;
    const input = document.createElement("input");
    input.className = "input";
    input.id = `prim-p-${key}`;
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
  document.querySelectorAll("#prim-params [data-param]").forEach((input) => {
    out[input.dataset.param] = input.value;
  });
  return out;
}

// ── Scene helpers ───────────────────────────────────────────────────────────

/**
 * Model-mode geometry is authored in its own units, so it is normalised to the
 * viewer's working scale the same way imported meshes are.
 */
function meshFromPositions(positions, name, color) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius || 1;
  const scale = radius > 0 ? MODEL_MODE_RADIUS / radius : 1;
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide, flatShading: true,
  }));
  mesh.name = name;
  mesh.scale.setScalar(scale);
  mesh.userData.localModel = true;
  mesh.userData.baseScale = scale;
  const boundingSphere = geometry.boundingSphere?.clone() || null;
  if (boundingSphere) boundingSphere.radius *= scale;
  return { mesh, boundingSphere };
}

function publish(positions, name, color, info) {
  const { mesh, boundingSphere } = meshFromPositions(positions, name, color);
  window.GeoIDImportManager?.addDerivedLayer(name, {
    object3D: mesh, boundingSphere, georeferenced: false, info,
  }, "mesh");
  return mesh;
}

// ── Actions ─────────────────────────────────────────────────────────────────

function addPrimitive() {
  const kind = byId("prim-kind")?.value;
  const op = byId("prim-op")?.value || "union";
  if (!PRIMITIVES[kind]) return;
  const params = readParams();
  try {
    const { positions, params: merged } = buildSurface(kind, params);
    const entry = {
      kind,
      op,
      enabled: true,
      params: merged,
      test: buildInside(kind, params),
      bounds: boundingBoxOf(kind, params),
      region: PRIMITIVES[kind].region ? PRIMITIVES[kind].region(merged) : null,
    };
    solids.push(entry);
    publish(positions, `${PRIMITIVES[kind].label.toLowerCase().replace(/\s+/g, "_")}_${solids.length}`,
      op === "difference" ? 0xff7a6b : 0x9fd8ff,
      { primitive: kind, csgOp: op, triangles: positions.length / 9 });
    renderSolidList();
    setText("prim-status", `${PRIMITIVES[kind].label} added as ${op}. ${solids.length} solids in the model.`);
  } catch (error) {
    setText("prim-status", `Failed: ${error.message}`);
  }
}

function renderSolidList() {
  const host = byId("solid-list");
  if (!host) return;
  host.innerHTML = "";
  if (!solids.length) {
    host.innerHTML = '<p class="tool-copy import-empty-note">No solids yet.</p>';
    return;
  }
  solids.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "import-layer-item";
    const info = document.createElement("div");
    info.className = "import-layer-info";
    const name = document.createElement("span");
    name.className = "import-layer-name";
    name.textContent = `${index + 1}. ${PRIMITIVES[entry.kind].label}`;
    const badge = document.createElement("span");
    badge.className = "import-layer-badge";
    badge.textContent = entry.op;
    info.appendChild(name);
    info.appendChild(badge);
    const actions = document.createElement("div");
    actions.className = "import-layer-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "button secondary import-layer-btn";
    toggle.textContent = entry.enabled ? "Mute" : "Use";
    toggle.addEventListener("click", () => { entry.enabled = !entry.enabled; renderSolidList(); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button secondary import-layer-btn";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => { solids.splice(index, 1); renderSolidList(); });
    actions.appendChild(toggle);
    actions.appendChild(remove);
    row.appendChild(info);
    row.appendChild(actions);
    host.appendChild(row);
  });
}

function generateMesh() {
  const inside = combinedInside();
  const bounds = combinedBounds();
  if (!inside || !bounds) {
    setText("mesh-status", "Add at least one solid first.");
    return;
  }
  const cellSize = Number(byId("mesh-cell")?.value) || 1;
  const refineRadius = Number(byId("mesh-refine-r")?.value) || 0;
  const refine = refineRadius > 0 ? {
    x: Number(byId("mesh-refine-x")?.value) || 0,
    y: Number(byId("mesh-refine-y")?.value) || 0,
    z: Number(byId("mesh-refine-z")?.value) || 0,
    radius: refineRadius,
  } : null;
  const regionSource = solids.find((s) => s.enabled && s.region);

  setText("mesh-status", "Meshing...");
  window.requestAnimationFrame(() => {
    const started = performance.now();
    const result = latticeTetMesh(inside, bounds, {
      cellSize, refine, regionFn: regionSource ? regionSource.region : null,
    });
    if (!result.ok) {
      setText("mesh-status", result.message);
      return;
    }
    const surface = tetBoundarySurface(result.nodes, result.tets);
    lastMesh = { ...result, surface };
    const counts = elementCounts(result.nodes, result.tets, surface);
    publish(surface, `volume_mesh_${counts.tetrahedra}`, 0xc9b79c, {
      tetrahedra: counts.tetrahedra, nodes: counts.nodes, triangleCount: counts.boundaryTriangles,
    });
    setText("mesh-status",
      `${counts.tetrahedra.toLocaleString()} tets, ${counts.nodes.toLocaleString()} nodes, `
      + `${counts.boundaryTriangles.toLocaleString()} boundary triangles in ${Math.round(performance.now() - started)} ms.`);
    ["mesh-export-msh", "mesh-export-stl", "mesh-export-obj", "mesh-export-ply", "mesh-quality"]
      .forEach((id) => { const b = byId(id); if (b) b.disabled = false; });
  });
}

function showQuality() {
  if (!lastMesh) return;
  const q = qualityStats(lastMesh.nodes, lastMesh.tets);
  if (!q) return;
  setText("mesh-quality-out",
    `min ${q.min.toFixed(3)} | mean ${q.mean.toFixed(3)} | median ${q.median.toFixed(3)} `
    + `| max ${q.max.toFixed(3)} | inverted ${q.invertedElements} | volume ${q.volume.toFixed(4)}`);
  const canvas = byId("mesh-quality-hist");
  if (!canvas) return;
  canvas.hidden = false;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const peak = Math.max(...q.histogram, 1);
  const w = canvas.width / q.histogram.length;
  q.histogram.forEach((count, i) => {
    const h = (count / peak) * (canvas.height - 12);
    // Poor elements (low quality) are drawn warm so problems stand out.
    ctx.fillStyle = i < 2 ? "#ff7a6b" : "#8ef6c4";
    ctx.fillRect(i * w + 1, canvas.height - h, w - 2, h);
  });
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px sans-serif";
  ctx.fillText("0", 2, canvas.height - 2);
  ctx.fillText("1", canvas.width - 8, canvas.height - 2);
}

// ── Export ──────────────────────────────────────────────────────────────────

function surfaceToStl(positions) {
  const lines = ["solid geoid"];
  for (let i = 0; i < positions.length; i += 9) {
    lines.push("facet normal 0 0 0", "  outer loop");
    for (let v = 0; v < 3; v += 1) {
      lines.push(`    vertex ${positions[i + v * 3]} ${positions[i + v * 3 + 1]} ${positions[i + v * 3 + 2]}`);
    }
    lines.push("  endloop", "endfacet");
  }
  lines.push("endsolid geoid");
  return lines.join("\n");
}

function surfaceToObj(positions) {
  const lines = [];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
  }
  for (let f = 0; f < positions.length / 9; f += 1) {
    lines.push(`f ${f * 3 + 1} ${f * 3 + 2} ${f * 3 + 3}`);
  }
  return lines.join("\n");
}

function surfaceToPly(positions) {
  const count = positions.length / 3;
  const faces = count / 3;
  const lines = [
    "ply", "format ascii 1.0", `element vertex ${count}`,
    "property float x", "property float y", "property float z",
    `element face ${faces}`, "property list uchar int vertex_index", "end_header",
  ];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
  }
  for (let f = 0; f < faces; f += 1) {
    lines.push(`3 ${f * 3} ${f * 3 + 1} ${f * 3 + 2}`);
  }
  return lines.join("\n");
}

function exportMesh(kind) {
  if (!lastMesh) return;
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === "msh") {
    downloadText(`geoid_mesh_${stamp}.msh`, toGmsh22(lastMesh.nodes, lastMesh.tets, lastMesh.regions), "text/plain");
  } else if (kind === "stl") {
    downloadText(`geoid_mesh_${stamp}.stl`, surfaceToStl(lastMesh.surface), "model/stl");
  } else if (kind === "obj") {
    downloadText(`geoid_mesh_${stamp}.obj`, surfaceToObj(lastMesh.surface), "text/plain");
  } else {
    downloadText(`geoid_mesh_${stamp}.ply`, surfaceToPly(lastMesh.surface), "text/plain");
  }
}

function init() {
  const kindSelect = byId("prim-kind");
  if (kindSelect) {
    // Grouped the way the studio groups them: basic solids, then geological.
    const groups = {};
    Object.entries(PRIMITIVES).forEach(([id, spec]) => {
      (groups[spec.group] ||= []).push([id, spec]);
    });
    Object.entries(groups).forEach(([group, items]) => {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group;
      items.forEach(([id, spec]) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = spec.label;
        optgroup.appendChild(opt);
      });
      kindSelect.appendChild(optgroup);
    });
    kindSelect.addEventListener("change", renderParamForm);
  }
  renderParamForm();
  renderSolidList();

  byId("prim-add")?.addEventListener("click", addPrimitive);
  byId("prim-reset")?.addEventListener("click", () => {
    solids.length = 0;
    lastMesh = null;
    renderSolidList();
    setText("prim-status", "Model cleared.");
  });
  byId("mesh-generate")?.addEventListener("click", generateMesh);
  byId("mesh-quality")?.addEventListener("click", showQuality);
  ["msh", "stl", "obj", "ply"].forEach((fmt) => {
    byId(`mesh-export-${fmt}`)?.addEventListener("click", () => exportMesh(fmt));
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDModelToolbox = {
  addPrimitive, generateMesh, showQuality, exportMesh,
  getSolids: () => solids,
  getMesh: () => lastMesh,
  PRIMITIVES,
};
