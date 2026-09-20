/**
 * MESH QUALITY, on the model page: the ribbon's Quality toggle and the card it
 * opens. The arithmetic is mesh-quality.js; this file only reads a mesh off
 * the page, draws the answer, and shows where the poor elements are.
 *
 * Two meshes can be on the page and either can be asked about: the studio's
 * own tetrahedra (GeoIDMeshStudio.state.mesh) and a GALES mesh opened in
 * Results (GeoIDGalesResults.state.mesh). A card that silently picked one
 * would be answering a question the reader may not have asked, so it says
 * which it read and offers the other when both are there.
 *
 * WHERE THE POOR ELEMENTS ARE is the half a histogram cannot say. They are
 * drawn as their own faces with the depth test off, because the elements a
 * mesher gets wrong are usually inside the volume, behind the surface the
 * reader is looking at. Drawn in each mesh's own frame: the studio mesh under
 * the model anchor turned by the same MODEL_TO_SCENE the studio uses, a GALES
 * mesh inside the results frame, which already carries its centring.
 *
 * THE STUDIO MESH IS ANALYSED HERE, A GALES MESH IN ITS READER. The results
 * panel keeps a GALES mesh's cells in its worker and hands the page only the
 * coordinates and the boundary, so its quality is asked of the worker
 * (GeoIDGalesResults.quality()) and only the answer crosses back. The studio's
 * lattice mesh is on this thread already. Past a size either way the analysis
 * waits for a press: seconds of a frozen page, or a large transfer, should be
 * asked for rather than imposed.
 */

import * as THREE from "../vendor/three.module.js";
import { METRICS, analyseMesh, summarise, verdict, elementFaces, elementCentroid } from "./mesh-quality.js?v=20260920-4149ca7";

const AUTO_LIMIT = { studio: 250000, real: 250000, gales: 1500000 };
const DRAW_LIMIT = 20000;
const MODEL_TO_SCENE = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const POOR = 0xff4d5e;
const FOCUS = 0xffd166;

const Q = {
  open: false,
  source: "",
  mesh: null,
  analysis: null,
  metric: "gamma",
  thresholds: {},
  showPoor: true,
  overlay: null,
  focus: null,
  poll: 0,
};

const byId = (id) => document.getElementById(id);
const studio = () => window.GeoIDMeshStudio;
const results = () => window.GeoIDGalesResults;

const STYLE = `
.mq-card {
  position: fixed; z-index: 30; right: 1rem;
  top: calc(var(--studio-chrome-h, 5rem) + 1.4rem);
  width: min(21rem, calc(100vw - 2rem));
  max-height: calc(100vh - var(--studio-chrome-h, 5rem) - 4.6rem);
  overflow-y: auto; box-sizing: border-box;
  padding: 0.6rem 0.75rem 0.7rem;
  border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.45);
  border-radius: 0.78rem;
  background: var(--skin-tab-ground, rgb(16, 7, 36));
  color: var(--soft-light, #e8e6f0);
  font: 0.74rem/1.35 "Exo 2", sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.mq-card[hidden] { display: none !important; }
.mq-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.45rem; }
.mq-title { flex: 1; font-weight: 600; font-size: 0.76rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--nav-accent, #ff2bd6); }
.mq-row { display: grid; grid-template-columns: fit-content(6.5rem) minmax(0, 1fr); gap: 0.3rem 0.6rem; align-items: center; margin: 0.3rem 0; }
.mq-row label { color: var(--skin-data, #52e4e8); text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.62rem; }
.mq-row select, .mq-row input { width: 100%; box-sizing: border-box; min-width: 0; }
.mq-says { margin: 0.25rem 0 0.4rem; opacity: 0.78; font-size: 0.68rem; }
.mq-canvas { display: block; width: 100%; height: 92px; margin: 0.35rem 0; }
.mq-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.1rem 0.7rem; margin: 0.3rem 0; font-variant-numeric: tabular-nums; }
.mq-stats span:nth-child(odd) { color: var(--skin-data, #52e4e8); font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; }
.mq-verdict { margin: 0.35rem 0; padding: 0; list-style: none; display: grid; gap: 0.2rem; }
.mq-verdict li { padding-left: 0.55rem; border-left: 3px solid currentColor; }
.mq-verdict .is-error { color: #ff6b7a; }
.mq-verdict .is-warning { color: #ffb454; }
.mq-verdict .is-note { color: #9fb3c8; }
.mq-verdict .is-ok { color: #7ee2a8; }
.mq-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.4rem 0; }
.mq-actions .studio-btn { flex: 1 1 auto; }
.mq-worst { display: grid; gap: 0.1rem; margin-top: 0.3rem; font-variant-numeric: tabular-nums; }
.mq-worst button { display: flex; justify-content: space-between; gap: 0.5rem; width: 100%; text-align: left; }
.mq-status { margin-top: 0.35rem; opacity: 0.75; font-size: 0.66rem; }
`;

function installStyle() {
  if (byId("mesh-quality-style")) return;
  const tag = document.createElement("style");
  tag.id = "mesh-quality-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/** The meshes on the page that can be asked about, best first. */
export function availableMeshes() {
  const out = [];
  const s = studio()?.state?.mesh;
  if (s?.tets?.length && s?.nodes?.length) out.push({ id: "studio", label: "Studio mesh", noun: "studio mesh", mesh: s });
  const real = window.GeoIDRealMesh?.mesh;
  if (real?.cellOffsets?.length > 1) out.push({ id: "real", label: "Solver mesh (gmsh)", noun: "solver mesh", mesh: real });
  const g = results()?.state?.mesh;
  if (g?.coords?.length && g.cellCount > 0 && results()?.quality) out.push({ id: "gales", label: "FEM results mesh", noun: "FEM results mesh", mesh: g });
  return out;
}

function toggleButton() { return document.querySelector('[data-toggle="quality"]'); }

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function card() {
  let node = byId("studio-quality-card");
  if (node) return node;
  installStyle();
  node = el("section", "mq-card");
  node.id = "studio-quality-card";
  node.hidden = true;
  node.setAttribute("aria-label", "Mesh quality");
  (byId("model-studio") || document.body).appendChild(node);
  return node;
}

function fmt(v, unit = "") {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a !== 0 && (a < 0.01 || a >= 1e5) ? v.toExponential(2) : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(3);
  return `${s}${unit}`;
}

function removeOverlay() {
  for (const key of ["overlay", "focus"]) {
    const mesh = Q[key];
    if (!mesh) continue;
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    Q[key] = null;
  }
}

/** The group a mesh's own coordinates are drawn in, with any turn it needs. */
function parentFor(sourceId) {
  if (sourceId === "gales") {
    const frame = results()?.frame?.();
    return frame ? { parent: frame, matrix: null } : null;
  }
  const anchor = studio()?.ensureAnchor?.() || studio()?.getAnchor?.();
  return anchor ? { parent: anchor, matrix: MODEL_TO_SCENE } : null;
}

function faceMesh(positions, colour, opacity, order) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  }));
  mesh.renderOrder = order;
  mesh.name = "studio-quality-overlay";
  mesh.userData.keepRenderOrder = true;
  return mesh;
}

function place(mesh) {
  const where = parentFor(Q.source);
  if (!where) return false;
  if (where.matrix) mesh.geometry.applyMatrix4(where.matrix);
  mesh.geometry.computeBoundingSphere();
  where.parent.add(mesh);
  return true;
}

function drawPoor(summary) {
  removeOverlay();
  if (!Q.showPoor || !Q.analysis || !summary.poor) return 0;
  const bad = [];
  for (let e = 0; e < Q.analysis.count && bad.length < DRAW_LIMIT; e += 1) {
    if (summary.past(Q.analysis.metrics[Q.metric][e])) bad.push(e);
  }
  const mesh = faceMesh(elementFaces(Q.analysis.elements, bad), POOR, 0.55, 900);
  if (!place(mesh)) { mesh.geometry.dispose(); mesh.material.dispose(); return 0; }
  Q.overlay = mesh;
  return bad.length;
}

function focusElement(e) {
  if (!Q.analysis) return;
  if (Q.focus) { Q.focus.parent?.remove(Q.focus); Q.focus.geometry.dispose(); Q.focus.material.dispose(); Q.focus = null; }
  const mesh = faceMesh(elementFaces(Q.analysis.elements, [e]), FOCUS, 0.9, 901);
  if (!place(mesh)) return;
  Q.focus = mesh;
  studio()?.fitObject?.(mesh);
  const c = elementCentroid(Q.analysis.elements, e);
  const value = Q.analysis.metrics[Q.metric][e];
  status(`Element ${e.toLocaleString()} — ${METRICS[Q.metric].label.toLowerCase()} ${fmt(value, METRICS[Q.metric].unit || "")}, at ${c.map((v) => fmt(v)).join(", ")}.`);
}

function status(text) {
  const node = card().querySelector(".mq-status");
  if (node) node.textContent = text;
}

function drawHistogram(canvas, summary) {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(160, Math.round(canvas.clientWidth || 300));
  const h = 92;
  canvas.width = w * ratio; canvas.height = h * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bins = summary.histogram;
  const peak = Math.max(1, ...bins);
  const top = 6; const base = h - 16;
  const bw = w / bins.length;
  const { lo, hi, log } = summary.axis;
  const valueAt = (i) => (log ? Math.exp(Math.log(lo) + ((i + 0.5) / bins.length) * (Math.log(hi) - Math.log(lo))) : lo + ((i + 0.5) / bins.length) * (hi - lo));
  bins.forEach((count, i) => {
    if (!count) return;
    const bh = Math.max(1, (Math.log1p(count) / Math.log1p(peak)) * (base - top));
    ctx.fillStyle = summary.past(valueAt(i)) ? "#ff4d5e" : "#52e4e8";
    ctx.fillRect(i * bw + 0.5, base - bh, Math.max(1, bw - 1), bh);
  });
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ctx.moveTo(0, base + 0.5); ctx.lineTo(w, base + 0.5); ctx.stroke();
  if (Number.isFinite(summary.threshold)) {
    const t = log ? (Math.log(summary.threshold) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (summary.threshold - lo) / (hi - lo);
    const x = Math.max(0, Math.min(1, t)) * w;
    ctx.strokeStyle = "#ffd166"; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, base); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = "rgba(232,230,240,0.7)";
  ctx.font = "10px 'Exo 2', sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left"; ctx.fillText(fmt(lo), 1, base + 3);
  ctx.textAlign = "right"; ctx.fillText(fmt(hi), w - 1, base + 3);
  ctx.textAlign = "center"; ctx.fillText(log ? "log scale · bar height log(count)" : "bar height log(count)", w / 2, base + 3);
}

function render() {
  const node = card();
  node.textContent = "";
  const head = el("div", "mq-head");
  head.append(el("span", "mq-title", "Mesh quality"));
  const close = el("button", "studio-mini", "✕");
  close.type = "button";
  close.title = "Close mesh quality";
  close.addEventListener("click", () => setOpen(false));
  head.append(close);
  node.append(head);

  const meshes = availableMeshes();
  if (!meshes.length) {
    node.append(el("p", "mq-says", "No mesh to read. Mesh the model (Mesh tab), or open a GALES run in Results."));
    node.append(el("div", "mq-status", ""));
    return;
  }
  if (!meshes.some((m) => m.id === Q.source)) Q.source = meshes[0].id;
  const chosen = meshes.find((m) => m.id === Q.source);

  if (meshes.length > 1) {
    const row = el("div", "mq-row");
    const label = el("label", "", "Mesh");
    const select = el("select", "input");
    select.id = "mq-source";
    label.htmlFor = select.id;
    for (const m of meshes) select.append(new Option(m.label, m.id, false, m.id === Q.source));
    select.addEventListener("change", () => { Q.source = select.value; Q.mesh = null; analyse(); });
    row.append(label, select);
    node.append(row);
  } else {
    node.append(el("p", "mq-says", `Reading the ${chosen.noun}.`));
  }

  if (!Q.analysis || Q.mesh !== chosen.mesh) {
    const count = elementCount(chosen.mesh);
    node.append(el("p", "mq-says", `${count.toLocaleString()} elements. A mesh past ${AUTO_LIMIT[chosen.id].toLocaleString()} is analysed only when asked.`));
    const actions = el("div", "mq-actions");
    const go = el("button", "studio-btn is-on", "Analyse");
    go.type = "button";
    go.addEventListener("click", () => analyse(true));
    actions.append(go);
    node.append(actions, el("div", "mq-status", ""));
    return;
  }

  const A = Q.analysis;
  const metrics = Object.entries(METRICS).filter(([, m]) => m.dims.includes(A.dim));
  if (!metrics.some(([k]) => k === Q.metric)) Q.metric = metrics[0][0];
  const spec = METRICS[Q.metric];

  const mRow = el("div", "mq-row");
  const mLabel = el("label", "", "Metric");
  const mSelect = el("select", "input");
  mSelect.id = "mq-metric";
  mLabel.htmlFor = mSelect.id;
  for (const [k, m] of metrics) mSelect.append(new Option(m.label, k, false, k === Q.metric));
  mSelect.addEventListener("change", () => { Q.metric = mSelect.value; render(); });
  mRow.append(mLabel, mSelect);
  node.append(mRow);

  const tRow = el("div", "mq-row");
  const tLabel = el("label", "", spec.worse === "low" ? "Poor below" : "Poor above");
  const tInput = el("input", "input");
  tInput.id = "mq-threshold";
  tLabel.htmlFor = tInput.id;
  tInput.type = "number";
  tInput.step = "any";
  const threshold = Q.thresholds[Q.metric] ?? spec.poor;
  tInput.value = Number.isFinite(threshold) ? String(threshold) : "";
  tInput.placeholder = spec.poor == null ? "no threshold" : String(spec.poor);
  tInput.disabled = spec.poor == null;
  tInput.addEventListener("keydown", (event) => event.stopPropagation());
  tInput.addEventListener("change", () => {
    const v = Number(tInput.value);
    if (tInput.value.trim() === "" || !Number.isFinite(v)) delete Q.thresholds[Q.metric];
    else Q.thresholds[Q.metric] = v;
    render();
  });
  tRow.append(tLabel, tInput);
  node.append(tRow);

  const summary = summarise(A, Q.metric, { threshold: Q.thresholds[Q.metric] ?? spec.poor });
  node.append(el("p", "mq-says", spec.says));

  const canvas = el("canvas", "mq-canvas");
  node.append(canvas);

  const stats = el("div", "mq-stats");
  const unit = spec.unit || "";
  const rows = [
    ["Elements", A.count.toLocaleString()], ["Type", `${A.per === 4 ? "tetrahedra" : "triangles"}, ${A.dim}D`],
    ["Min", fmt(summary.min, unit)], ["Max", fmt(summary.max, unit)],
    ["Mean", fmt(summary.mean, unit)], ["Median", fmt(summary.median, unit)],
    ["5th pct", fmt(summary.p5, unit)], ["95th pct", fmt(summary.p95, unit)],
    ["Past threshold", Number.isFinite(summary.threshold) ? summary.poor.toLocaleString() : "—"],
    ["Ideal", spec.ideal == null ? "—" : fmt(spec.ideal, unit)],
    ["Inverted", A.inverted.toLocaleString()], ["Zero volume", A.degenerate.toLocaleString()],
  ];
  for (const [k, v] of rows) stats.append(el("span", "", k), el("span", "", v));
  node.append(stats);

  const others = metrics.filter(([k]) => k !== Q.metric).map(([k]) => summarise(A, k, { threshold: Q.thresholds[k] ?? METRICS[k].poor, worst: 0 }));
  const list = el("ul", "mq-verdict");
  for (const line of verdict(A, [summary, ...others])) list.append(el("li", `is-${line.level}`, line.text));
  node.append(list);

  const actions = el("div", "mq-actions");
  const show = el("button", `studio-btn is-toggle${Q.showPoor ? " is-on" : ""}`, "Show poor elements");
  show.type = "button";
  show.disabled = !summary.poor;
  show.title = "Draw the elements past the threshold through the model";
  show.addEventListener("click", () => { Q.showPoor = !Q.showPoor; render(); });
  const worst = el("button", "studio-btn", "Zoom to worst");
  worst.type = "button";
  worst.disabled = !summary.worst.length;
  worst.addEventListener("click", () => focusElement(summary.worst[0]));
  actions.append(show, worst);
  node.append(actions);

  if (summary.worst.length) {
    const box = el("div", "mq-worst");
    for (const e of summary.worst.slice(0, 8)) {
      const b = el("button", "studio-btn");
      b.type = "button";
      b.append(el("span", "", `#${e.toLocaleString()}`), el("span", "", fmt(A.metrics[Q.metric][e], unit)));
      b.title = "Zoom to this element";
      b.addEventListener("click", () => focusElement(e));
      box.append(b);
    }
    node.append(el("p", "mq-says", summary.poor ? "Worst elements:" : "Worst elements (none past the threshold):"), box);
  }

  node.append(el("div", "mq-status", ""));
  drawHistogram(canvas, summary);
  const drawn = drawPoor(summary);
  if (Q.showPoor && summary.poor) {
    status(drawn < summary.poor
      ? `Drawing the first ${drawn.toLocaleString()} of ${summary.poor.toLocaleString()} poor elements.`
      : `${drawn.toLocaleString()} poor element${drawn === 1 ? "" : "s"} drawn through the model.`);
  }
}

function elementCount(mesh) {
  if (mesh?.tets?.length) return mesh.tets.length / 4;
  // A GALES mesh as the results panel holds it: a count of its tetrahedra,
  // and of all its cells for a 2D mesh, whose elements are triangles.
  if (mesh?.dim === 3 && Number.isFinite(mesh.tets)) return mesh.tets;
  return mesh?.cellCount || 0;
}

function analyse(force = false) {
  removeOverlay();
  const chosen = availableMeshes().find((m) => m.id === Q.source) || availableMeshes()[0];
  if (!chosen) { Q.analysis = null; Q.mesh = null; render(); return; }
  Q.source = chosen.id;
  if (!force && elementCount(chosen.mesh) > AUTO_LIMIT[chosen.id]) { Q.analysis = null; Q.mesh = null; render(); return; }
  status("Analysing…");
  const ticket = (Q.ticket = (Q.ticket || 0) + 1);
  const t0 = performance.now();
  const done = (analysis) => {
    if (ticket !== Q.ticket) return;
    Q.analysis = analysis;
    Q.mesh = chosen.mesh;
    render();
    if (!analysis) status("This mesh has no elements to analyse.");
    else if (!(Q.showPoor && Q.overlay)) status(`Analysed ${analysis.count.toLocaleString()} elements in ${Math.round(performance.now() - t0)} ms${chosen.id === "gales" ? ", in the results reader" : ""}.`);
  };
  if (chosen.id === "gales") {
    results().quality().then(done, (error) => { if (ticket === Q.ticket) status(`Could not analyse: ${error.message}`); });
    return;
  }
  // One frame so "Analysing…" is painted before the page is held.
  window.requestAnimationFrame(() => setTimeout(() => done(analyseMesh(chosen.mesh)), 0));
}

/** Follow the page: a re-mesh, a cleared mesh, a results run opened or closed. */
function watch() {
  const meshes = availableMeshes();
  const chosen = meshes.find((m) => m.id === Q.source);
  if (!chosen && (Q.analysis || meshes.length)) { Q.source = ""; analyse(); return; }
  if (chosen && Q.mesh && chosen.mesh !== Q.mesh) analyse();
  if (!meshes.length && Q.analysis) { Q.analysis = null; Q.mesh = null; render(); }
}

export function setOpen(open) {
  Q.open = Boolean(open);
  const button = toggleButton();
  if (button) button.classList.toggle("is-on", Q.open);
  const node = card();
  node.hidden = !Q.open;
  clearInterval(Q.poll);
  if (!Q.open) { removeOverlay(); return; }
  Q.poll = setInterval(watch, 1000);
  if (Q.analysis && availableMeshes().some((m) => m.mesh === Q.mesh)) render();
  else analyse();
}

function install() {
  // Bubble phase on the document, so the studio's own handler on the button
  // has already flipped is-on: the button's class is the state being asked for.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.('[data-toggle="quality"]');
    if (!button) return;
    setOpen(button.classList.contains("is-on"));
  });
  document.addEventListener("geoid-studio:mesh-changed", () => { if (Q.open) analyse(); });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  install();
  window.GeoIDMeshQuality = { setOpen, availableMeshes, state: Q };
}
