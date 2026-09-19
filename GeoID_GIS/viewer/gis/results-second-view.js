/**
 * A SECOND VIEW — ParaView's split view with linked cameras.
 *
 * One field at a time is what the Results panel draws; comparing two (the
 * displacement against the von Mises stress it causes, u_z against the tilt)
 * means looking at both on the same geometry from the same place. This is a
 * floating viewport on the Model page with its own renderer and its own
 * scene, whose meshes SHARE the main view's position, index and normal
 * buffers — so the warp, the slice and every step's geometry arrive with no
 * work — and carry colour buffers of their own, painted from the field and
 * component chosen here on the Results colour map, with a range of their own.
 * Its camera copies the main camera every frame.
 *
 * What is not in it: contours, isosurfaces, threshold skins and glyphs stay in
 * the main view; fringes are not offered (a wrap wants the satellite geometry
 * the panel owns).
 */

import * as THREE from "../vendor/three.module.js";
import { colourValues, colormapTable, interpolateOnSlice, rangeOf, formatValue } from "./gales-results.js?v=20260919-74e90b8";

const R = () => window.GeoIDGalesResults;
const V = { open: false, field: "", component: "", renderer: null, scene: null, group: null, surface: null, slice: null, camera: null, node: null, raf: 0, painting: false, again: false, range: [0, 1], label: "" };

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) { if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v); }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
};

function fieldOptions() {
  const S = R()?.state;
  return (S?.fields || []).map((f, i) => ({ f, i })).filter(({ f }) => f.ok && f.desc);
}

function componentOptions(desc) {
  if (!desc) return [];
  return [...(desc.vector ? [["mag", desc.vector.label]] : []), ...desc.components.map((c, j) => [String(j), c.label])];
}

function build() {
  const host = document.getElementById("model-studio") || document.body;
  const node = el("div", { class: "gales-view2", role: "dialog", "aria-label": "Second view" });
  const head = el("div", { class: "gales-view2-head" });
  const title = el("b", {}, "Second view");
  const fieldSel = el("select", { class: "studio-select" });
  const compSel = el("select", { class: "studio-select" });
  const close = el("button", { class: "studio-btn", type: "button", title: "Close the second view" }, "×");
  head.append(title, fieldSel, compSel, close);
  const canvas = el("canvas", { class: "gales-view2-canvas" });
  const legend = el("div", { class: "gales-view2-legend" });
  node.append(head, canvas, legend);
  host.append(node);
  V.node = node; V.fieldSel = fieldSel; V.compSel = compSel; V.canvas = canvas; V.legend = legend;
  for (const s of [fieldSel, compSel]) s.addEventListener("keydown", (e) => e.stopPropagation());
  fieldSel.addEventListener("change", () => { V.field = fieldSel.value; V.component = ""; fillSelects(); paint(); });
  compSel.addEventListener("change", () => { V.component = compSel.value; paint(); });
  close.addEventListener("click", () => closeView());
  // Drag by the head.
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target !== head && e.target !== title) return;
    const r = node.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    node.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx))}px`;
    node.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy))}px`;
    node.style.right = "auto";
  });
  head.addEventListener("pointerup", () => { drag = null; });

  V.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  V.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  V.renderer.setClearColor(0x0b0716, 1);
  V.scene = new THREE.Scene();
  V.camera = new THREE.PerspectiveCamera(45, 1, 1, 1e7);
  V.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(0, 0, 1);
  V.camera.add(sun);
  V.scene.add(V.camera);
  V.group = new THREE.Group();
  V.group.matrixAutoUpdate = false;
  V.scene.add(V.group);
  const material = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  V.surface = new THREE.Mesh(new THREE.BufferGeometry(), material());
  V.slice = new THREE.Mesh(new THREE.BufferGeometry(), material());
  for (const m of [V.surface, V.slice]) { m.frustumCulled = false; V.group.add(m); }
}

function fillSelects() {
  const S = R()?.state;
  const opts = fieldOptions();
  if (!opts.some(({ f }) => f.field === V.field)) {
    // Something other than what the main view shows, where there is one.
    const shown = S?.fields?.[S.field]?.field;
    V.field = (opts.find(({ f }) => f.field !== shown) || opts[0])?.f.field || "";
    V.component = "";
  }
  V.fieldSel.textContent = "";
  for (const { f } of opts) V.fieldSel.append(new Option(f.desc.label && f.desc.label !== f.field ? `${f.desc.label} (${f.field})` : f.field, f.field, false, f.field === V.field));
  const f = opts.find(({ f: x }) => x.field === V.field)?.f;
  const comps = componentOptions(f?.desc);
  if (!comps.some(([v]) => v === V.component)) V.component = f?.desc?.derived ? (f.desc.defaultComponent || "12") : comps[0]?.[0] || "0";
  V.compSel.textContent = "";
  for (const [v, label] of comps) V.compSel.append(new Option(label, v, false, v === V.component));
}

/** Share the main view's buffers: re-linked whenever the main view replaced one. */
function link() {
  const p = R()?.parts?.();
  if (!p?.surface) return false;
  const src = p.surface.geometry; const dst = V.surface.geometry;
  for (const key of ["position", "normal"]) if (src.attributes[key] && dst.attributes[key] !== src.attributes[key]) dst.setAttribute(key, src.attributes[key]);
  if (src.index && dst.index !== src.index) dst.setIndex(src.index);
  const n = src.attributes.position.count;
  if (!dst.attributes.color || dst.attributes.color.count !== n) dst.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.72), 3));
  const ss = p.slice?.geometry; const sd = V.slice.geometry;
  if (ss?.attributes.position) {
    for (const key of ["position", "normal"]) if (ss.attributes[key] && sd.attributes[key] !== ss.attributes[key]) sd.setAttribute(key, ss.attributes[key]);
    const m = ss.attributes.position.count;
    if (!sd.attributes.color || sd.attributes.color.count !== m) sd.setAttribute("color", new THREE.BufferAttribute(new Float32Array(m * 3).fill(0.72), 3));
  }
  return true;
}

/** The chosen field at the main view's time, painted on the shared geometry. */
async function paint() {
  if (!V.open) return;
  if (V.painting) { V.again = true; return; }
  V.painting = true;
  try {
    const results = R(); const S = results?.state;
    if (!S?.mesh || !link()) { V.legend.textContent = "Open a run in Results."; return; }
    const fi = S.fields.findIndex((f) => f.field === V.field);
    const f = S.fields[fi];
    if (!f?.ok) { V.legend.textContent = "Choose a field."; return; }
    const p = results.parts();
    const time = p.time ?? f.steps.at(-1).time;
    let step = f.steps.length - 1;
    for (let k = 0; k < f.steps.length; k += 1) if (f.steps[k].time <= time) step = k;
    const values = await results.values(fi, step);
    const desc = S.fields[fi].desc;
    const scalar = results.scalarFor(values, desc, V.component);
    const nodes = p.surfNodes;
    const onSurface = new Float32Array(nodes.length);
    for (let k = 0; k < nodes.length; k += 1) onSurface[k] = scalar[nodes[k]];
    let sliceValues = null;
    if (p.slice?.visible && p.sliceData) sliceValues = interpolateOnSlice(p.sliceData, scalar);
    const parts = [];
    if (p.surface.visible) parts.push(rangeOf(scalar, nodes));
    if (sliceValues?.length) parts.push(rangeOf(sliceValues));
    const lo = Math.min(...parts.map((r) => r[0])); const hi = Math.max(...parts.map((r) => r[1]));
    V.range = Number.isFinite(lo) ? [lo, hi] : [0, 0];
    const table = results.colormap?.() || colormapTable("Cool to Warm");
    const col = V.surface.geometry.attributes.color;
    colourValues(onSurface, V.range[0], V.range[1], table, col.array);
    col.needsUpdate = true;
    if (sliceValues && V.slice.geometry.attributes.color) {
      colourValues(sliceValues, V.range[0], V.range[1], table, V.slice.geometry.attributes.color.array);
      V.slice.geometry.attributes.color.needsUpdate = true;
    }
    const comp = componentOptions(desc).find(([v]) => v === V.component)?.[1] || "";
    V.label = `${comp} · t=${f.steps[step].name}`;
    drawLegend(table);
  } catch (error) {
    V.legend.textContent = `Could not draw: ${error.message}`;
  } finally {
    V.painting = false;
    if (V.again) { V.again = false; paint(); }
  }
}

function drawLegend(table) {
  const [lo, hi] = V.range;
  const stops = [];
  const n = table.length / 3;
  for (let k = 0; k <= 8; k += 1) {
    const i = Math.min(n - 1, Math.round((k / 8) * (n - 1)));
    stops.push(`rgb(${Math.round(table[i * 3] * 255)},${Math.round(table[i * 3 + 1] * 255)},${Math.round(table[i * 3 + 2] * 255)}) ${k * 12.5}%`);
  }
  V.legend.textContent = "";
  V.legend.append(
    el("div", { class: "gales-view2-label" }, V.label),
    el("div", { class: "gales-view2-bar", style: `background: linear-gradient(90deg, ${stops.join(", ")})` }),
    el("div", { class: "gales-view2-ticks" }, el("span", {}, formatValue(lo, hi - lo || 1)), el("span", {}, formatValue(hi, hi - lo || 1))),
  );
}

function frame() {
  if (!V.open) return;
  V.raf = requestAnimationFrame(frame);
  const results = R(); const main = window.GeoIDViewer?.camera;
  const p = results?.parts?.();
  if (!p?.frame || !main) return;
  link();
  p.frame.updateWorldMatrix(true, false);
  V.group.matrix.copy(p.frame.matrixWorld);
  V.group.matrixWorldNeedsUpdate = true;
  V.surface.visible = p.surface.visible && p.surface.parent?.visible !== false;
  V.slice.visible = Boolean(p.slice?.visible && p.slice.parent?.visible !== false && V.slice.geometry.attributes.position);
  V.surface.material.wireframe = p.surface.material.wireframe;
  // The camera, linked.
  V.camera.position.copy(main.position);
  V.camera.quaternion.copy(main.quaternion);
  V.camera.fov = main.fov; V.camera.near = main.near; V.camera.far = main.far;
  const w = V.canvas.clientWidth; const h = V.canvas.clientHeight;
  if (w && h) {
    if (V.renderer.domElement.width !== Math.round(w * V.renderer.getPixelRatio()) || V.renderer.domElement.height !== Math.round(h * V.renderer.getPixelRatio())) V.renderer.setSize(w, h, false);
    V.camera.aspect = w / h;
  }
  V.camera.updateProjectionMatrix();
  V.renderer.render(V.scene, V.camera);
}

export function openView() {
  if (V.open) return;
  if (!V.node) build();
  V.node.hidden = false;
  V.open = true;
  fillSelects();
  paint();
  frame();
}

export function closeView() {
  V.open = false;
  cancelAnimationFrame(V.raf);
  if (V.node) V.node.hidden = true;
}

function install() {
  window.addEventListener("geoid-gales:refreshed", () => { if (V.open) { fillSelects(); paint(); } });
  window.GeoIDSecondView = {
    open: openView, close: closeView,
    toggle: () => (V.open ? closeView() : openView()),
    isOpen: () => V.open,
    set: async ({ field, component } = {}) => { if (field) V.field = field; if (component !== undefined) V.component = String(component); if (V.open) { fillSelects(); await paint(); } },
    state: V,
  };
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") install();
