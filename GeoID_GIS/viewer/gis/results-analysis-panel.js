/**
 * ANALYSIS, beside Results: questions asked OF a solution rather than ways of
 * looking at one.
 *
 *   - Plot over line. The field, component and step shown in Results, sampled
 *     at evenly spaced points on a line through the mesh — read by locating
 *     each point in its element and weighting the element's nodal values, so
 *     it is the solution between nodes (exact for a first-order mesh), not the
 *     nearest node. A second step can be laid over the first. The profile is
 *     a figure and a CSV: the thing compared with a levelling line, GPS or an
 *     InSAR track.
 *   - Vector glyphs. Arrows of a vector field (displacement, velocity) on the
 *     model's surface nodes, sized and coloured by magnitude, following the
 *     step. Where the surface is warped by the same field, the arrows sit on
 *     the warped surface.
 *   - Compare with observations. A GNSS or InSAR LOS table read at its stations
 *     in the open displacement (observations.js parses and fits): the best
 *     source-strength scale, the misfit either side of it, a row per station,
 *     observed and modelled arrows, and a CSV.
 *
 * Everything is read through the Results panel's seam (GeoIDGalesResults):
 * the open field, its values at a step, the component chosen there, and the
 * reader worker that holds the cells and locates the points. Both follow the
 * Results selection by polling its signature, so changing the step re-plots
 * and re-draws without a press.
 */

import * as THREE from "../vendor/three.module.js";
import { domainStatsCsv, lineSamples, sampleLocated, profileCsv, usedNodes, componentOf, colourValues, niceTicks, streamSeeds, streamlinesCsv, selectInRect, selectionSummary, formatValue, describeField, float64View, timeOf, stepReading, powerLawSlope } from "./gales-results.js?v=20260916-dacf706";
import { downloadText } from "./extraction.js?v=20260916-dacf706";
import { modelReportHtml } from "./model-report.js?v=20260916-dacf706";
import { makeState, readState, stateFileName } from "./model-state.js?v=20260916-dacf706";
import { PHYSICS, domainProperties } from "./fem-setup.js?v=20260916-dacf706";
import { may, refusal } from "./membership.js?v=20260916-dacf706";
import { parseObservations, fitScale, pairsOf, comparisonCsv } from "./observations.js?v=20260916-dacf706";
import { losVector } from "./insar.js?v=20260916-dacf706";
import { mogi, bestVolume, invertMogi, topSurfaceNodes, volumeFromPressure, shearModulus } from "./analytic-sources.js?v=20260916-dacf706";

const byId = (id) => document.getElementById(id);
const R = () => window.GeoIDGalesResults;

const L = {
  a: [0, 0, 0], b: [1, 0, 0], samples: 256, compare: "none",
  located: null, locatedKey: "", profile: null, sig: "", busy: false, text: "", level: "",
  line: null,
  glyph: { on: false, field: -1, count: 2000, scale: 1, mesh: null, sig: "" },
  meshSig: "",
  stats: { open: false, result: null, sig: "", busy: false, text: "", label: "" },
  src: { open: false, x0: 0, y0: 0, depth: 5000, dV: 1e6, nu: 0.25, mode: "dV", dP: 1e7, radius: 1000, E: 30e9, fitDV: true, result: null, inversion: null, text: "", busy: false, sig: "", marker: null, surfaceZ: 0 },
  report: { open: false, title: "", text: "", busy: false },
  state: { open: false, text: "", busy: false },
  handoff: { counts: null, at: 0, busy: false, project: "" },
  sel: { open: false, mode: "surface", ids: null, armed: false, text: "", summary: null, over: null, busy: false, mesh: null, sig: "" },
  stream: { on: false, field: -1, seed: "line", count: 60, radius: 0.1, stepPer: 400, lengthPer: 1.5, direction: "both", lines: null, mesh: null, sig: "", text: "", busy: false },
  media: { open: false, kind: "steps", hold: 1, seconds: 8, width: 1280, busy: false, cancel: false, text: "" },
  sheet: { open: false, surfaceOnly: false, sort: 0, dir: 1, page: 0, size: 50, data: null, key: "", busy: false, text: "" },
  sweep: { open: false, manifests: null, path: "", field: "solid/u", component: "mag", where: "peak", node: "", result: null, text: "", busy: false },
  obs: { open: false, raw: "", unit: "mm", fit: true, arrows: true, text: "", result: null, sig: "", busy: false, pending: false, mesh: null },
};

const STAT_COLOURS = ["#52e4e8", "#ff2bd6", "#ffc857", "#7bd88f", "#b48cff", "#ff8a5b", "#e8eaf2", "#5aa9ff"];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v);
  }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}

const note = (text) => el("p", { class: "studio-readout" }, text);

function card(title, open = true) {
  const details = el("details", { class: "gis-tool-section studio-fold-section" });
  details.open = open;
  const summary = el("summary", {}, title);
  summary.dataset.toolIcon = "1";
  const body = el("div", { class: "gis-tool-body" });
  details.append(summary, body);
  return { details, body };
}

function row(label, control) {
  const id = control.id || `ra-${Math.random().toString(36).slice(2, 8)}`;
  if (!control.id) control.id = id;
  return el("div", { class: "studio-row" }, el("label", { for: control.id }, label), control);
}

function numberInput(value, onChange, step = "any") {
  const input = el("input", { class: "studio-input", type: "number", step });
  input.value = Number.isFinite(value) ? String(Number(value.toPrecision(8))) : "";
  input.addEventListener("keydown", (event) => event.stopPropagation());
  input.addEventListener("change", () => onChange(Number(input.value)));
  return input;
}

function xyzRow(label, vec) {
  const wrap = el("div", { class: "st-xyz" });
  ["x", "y", "z"].forEach((axis, i) => {
    const input = numberInput(vec[i], (v) => { vec[i] = Number.isFinite(v) ? v : 0; L.locatedKey = ""; drawLine(); });
    input.setAttribute("aria-label", `${label} ${axis}`);
    input.title = `${label} ${axis} (m, the mesh's own coordinates)`;
    wrap.append(input);
  });
  return el("div", { class: "studio-row st-row-wide" }, el("label", {}, label), wrap);
}

function button(text, cls, onClick, title = "") {
  const b = el("button", { class: cls, type: "button", title }, text);
  b.addEventListener("click", onClick);
  return b;
}

function say(text, level = "") {
  L.text = text; L.level = level;
  const node = byId("ra-status");
  if (node) { node.textContent = text; node.className = `studio-readout${level ? ` is-${level}` : ""}`; }
}

/* ── the line in the scene ──────────────────────────────────────────────── */

function disposeLine() {
  if (!L.line) return;
  L.line.parent?.remove(L.line);
  L.line.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  L.line = null;
}

function drawLine() {
  disposeLine();
  const frame = R()?.frame?.();
  if (!frame || !R()?.state?.mesh) return;
  const group = new THREE.Group();
  group.name = "results-analysis-line";
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...L.a), new THREE.Vector3(...L.b)]);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--nav-accent").trim() || "#ff2bd6";
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: accent, depthTest: false, transparent: true })));
  const ends = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...L.a), new THREE.Vector3(...L.b)]);
  ends.setAttribute("color", new THREE.Float32BufferAttribute([1, 0.17, 0.84, 0.32, 0.89, 0.91], 3));
  group.add(new THREE.Points(ends, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true })));
  group.children.forEach((c) => { c.renderOrder = 950; });
  frame.add(group);
  L.line = group;
}

/* ── plot over line ─────────────────────────────────────────────────────── */

async function locate() {
  const key = `${R().state.meshPath}|${L.a}|${L.b}|${L.samples}`;
  if (L.located && L.locatedKey === key) return L.located;
  const line = lineSamples(L.a, L.b, L.samples);
  const located = await R().locate(Float64Array.from(line.points));
  L.located = { ...located, line };
  L.locatedKey = key;
  return L.located;
}

export async function plot() {
  const results = R();
  const S = results?.state;
  if (!S?.mesh) { say("Open a run in Results first.", "warning"); return; }
  const desc = results.desc();
  const f = S.fields[S.field];
  if (!desc || !f?.ok) { say("Choose a field in Results first.", "warning"); return; }
  if (L.busy) return;
  L.busy = true;
  try {
    say("Sampling…");
    const loc = await locate();
    const series = [];
    // Sample what can be interpolated (a wrapped fringe cannot), then finish it.
    const sampleAt = async (step) => {
      const values = await results.values(S.field, step);
      const scalar = (results.samplingScalar || results.scalar)(values);
      const samples = sampleLocated(loc, scalar);
      return results.afterSampling ? results.afterSampling(samples) : samples;
    };
    const current = await sampleAt(S.step);
    series.push({ name: `t=${f.steps[S.step].name}`, values: current, time: f.steps[S.step].time });
    const other = L.compare === "first" ? 0 : L.compare === "previous" ? S.step - 1 : -1;
    if (other >= 0 && other !== S.step) {
      series.push({ name: `t=${f.steps[other].name}`, values: await sampleAt(other), time: f.steps[other].time });
    }
    L.profile = { distance: loc.line.distance, points: loc.line.points, series, label: results.componentLabel(), field: f.field, inside: loc.inside, length: loc.line.length };
    L.sig = signature();
    say(loc.inside ? "" : "The line does not pass through the mesh.", loc.inside ? "" : "warning");
    render();
  } catch (error) {
    say(`Could not sample: ${error.message}`, "error");
  } finally {
    L.busy = false;
  }
}

function drawProfile(canvas, profile, size = {}) {
  const ratio = window.devicePixelRatio || 1;
  const W = size.width || Math.max(220, canvas.clientWidth || 300);
  const H = size.height || 170;
  canvas.width = W * ratio; canvas.height = H * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const all = profile.series.flatMap((s) => [...s.values].filter(Number.isFinite));
  if (!all.length) return;
  let [y0, y1] = [Math.min(...all), Math.max(...all)];
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const x1 = profile.length || 1;
  const Lp = 48; const Rp = 8; const T = 10; const B = 22;
  const X = (d) => Lp + (d / x1) * (W - Lp - Rp);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const muted = "rgba(232,230,240,0.55)";
  ctx.font = "10px 'Exo 2', sans-serif";
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.fillStyle = muted;
  niceTicks(y0, y1, 4).forEach((v) => { ctx.beginPath(); ctx.moveTo(Lp, Y(v)); ctx.lineTo(W - Rp, Y(v)); ctx.stroke(); ctx.fillText(formatValue(v, y1 - y0), 2, Y(v) + 3); });
  // Distance ticks in m or km, each label kept inside the plot.
  const km = x1 >= 5000;
  niceTicks(0, x1, 4).forEach((d) => {
    const text = `${formatValue(km ? d / 1000 : d, km ? x1 / 1000 : x1)}${d === 0 ? (km ? " km" : " m") : ""}`;
    const w = ctx.measureText(text).width;
    ctx.fillText(text, Math.min(W - Rp - w, Math.max(Lp, X(d) - w / 2)), H - 6);
  });
  const colours = [getComputedStyle(document.documentElement).getPropertyValue("--nav-accent").trim() || "#ff2bd6", "rgba(82,228,232,0.9)"];
  profile.series.forEach((s, n) => {
    ctx.strokeStyle = colours[n % colours.length];
    ctx.lineWidth = n ? 1.2 : 1.8;
    ctx.setLineDash(n ? [4, 3] : []);
    ctx.beginPath();
    let pen = false;
    for (let k = 0; k < s.values.length; k += 1) {
      const v = s.values[k];
      if (!Number.isFinite(v)) { pen = false; continue; }
      if (pen) ctx.lineTo(X(profile.distance[k]), Y(v)); else ctx.moveTo(X(profile.distance[k]), Y(v));
      pen = true;
    }
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

function presets(kind) {
  const b = R()?.state?.mesh?.bounds;
  if (!b) return;
  const c = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
  const top = b.max[2];
  if (kind === "x") { L.a = [b.min[0], c[1], c[2]]; L.b = [b.max[0], c[1], c[2]]; }
  if (kind === "y") { L.a = [c[0], b.min[1], c[2]]; L.b = [c[0], b.max[1], c[2]]; }
  if (kind === "z") { L.a = [c[0], c[1], top]; L.b = [c[0], c[1], b.min[2]]; }
  L.locatedKey = "";
  drawLine();
  render();
  plot();
}

function fromProbe(which) {
  const S = R()?.state;
  const node = S?.probe?.node;
  if (!Number.isInteger(node)) { say("Click the model in Results ▸ Probe first; the probed node becomes the end.", "warning"); return; }
  const p = [0, 1, 2].map((a) => S.mesh.coords[node * 3 + a]);
  if (which === "a") L.a = p; else L.b = p;
  L.locatedKey = "";
  drawLine();
  render();
}

function exportCsv() {
  const p = L.profile;
  if (!p) return;
  const text = profileCsv({ distance: p.distance, points: p.points, series: p.series, header: [`${p.field} — ${p.label}`, `line from (${L.a.join(", ")}) to (${L.b.join(", ")}) m, ${p.distance.length} samples`, "values interpolated in each element from its nodes; blank where the line is outside the mesh"] });
  downloadText(`profile_${p.field.replace(/[^A-Za-z0-9]+/g, "_")}_${p.series[0].name.replace(/[^A-Za-z0-9.]+/g, "")}.csv`, text, "text/csv");
}

/* ── glyphs ─────────────────────────────────────────────────────────────── */

/** A unit arrow along +y from the origin: a thin shaft and a head, one geometry. */
function arrowGeometry() {
  const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.68, 6).translate(0, 0.34, 0).toNonIndexed();
  const head = new THREE.ConeGeometry(0.15, 0.32, 10).translate(0, 0.84, 0).toNonIndexed();
  const merged = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const a = shaft.getAttribute(name).array; const b = head.getAttribute(name).array;
    const out = new Float32Array(a.length + b.length);
    out.set(a); out.set(b, a.length);
    merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  shaft.dispose(); head.dispose();
  return merged;
}

function disposeGlyphs() {
  const mesh = L.glyph.mesh;
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry.dispose(); mesh.material.dispose();
  L.glyph.mesh = null;
}

function vectorFields() {
  const S = R()?.state;
  return (S?.fields || []).map((f, i) => ({ f, i })).filter(({ f }) => f.ok && f.desc?.vector);
}

export async function drawGlyphs() {
  const results = R();
  const S = results?.state;
  disposeGlyphs();
  if (!L.glyph.on || !S?.mesh) return;
  const fields = vectorFields();
  if (!fields.length) { say("No vector field is open (displacement, velocity).", "warning"); return; }
  if (!fields.some((x) => x.i === L.glyph.field)) L.glyph.field = fields.some((x) => x.i === S.field) ? S.field : fields[0].i;
  const f = S.fields[L.glyph.field];
  const time = S.fields[S.field]?.steps[S.step]?.time ?? f.steps.at(-1).time;
  let step = f.steps.length - 1;
  for (let k = 0; k < f.steps.length; k += 1) if (f.steps[k].time <= time) step = k;
  const values = await results.values(L.glyph.field, step);
  const desc = f.desc;
  const n = S.mesh.nodeCount;
  const comps = desc.vector.from.map((j) => componentOf(values, n, desc.nbDofs, j, desc.blocked));
  const nodes = usedNodes(S.mesh.surface, n);
  const stride = Math.max(1, Math.ceil(nodes.length / L.glyph.count));
  const picked = [];
  for (let k = 0; k < nodes.length; k += stride) picked.push(nodes[k]);
  const mags = new Float32Array(picked.length);
  let max = 0;
  picked.forEach((node, k) => {
    const m = Math.hypot(...comps.map((c) => c[node]));
    mags[k] = m; if (m > max) max = m;
  });
  if (!(max > 0)) { say(`${f.field} is zero at step ${f.steps[step].name}: nothing to draw.`, "warning"); return; }
  const b = S.mesh.bounds;
  const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const unit = (0.08 * diag * (L.glyph.scale || 1)) / max;
  const warp = S.deform?.on && S.deform.field === L.glyph.field ? S.deform.scale : 0;
  const geometry = arrowGeometry();
  const material = new THREE.MeshBasicMaterial({ vertexColors: false, depthTest: true, transparent: false });
  const mesh = new THREE.InstancedMesh(geometry, material, picked.length);
  const table = results.colormap();
  const colours = colourValues(mags, 0, max, table, new Float32Array(picked.length * 3));
  const up = new THREE.Vector3(0, 1, 0); const dir = new THREE.Vector3(); const q = new THREE.Quaternion();
  const m4 = new THREE.Matrix4(); const pos = new THREE.Vector3(); const scale = new THREE.Vector3(); const colour = new THREE.Color();
  picked.forEach((node, k) => {
    const v = [0, 1, 2].map((a) => comps[a]?.[node] ?? 0);
    dir.set(v[0], v[1], v[2]).normalize();
    q.setFromUnitVectors(up, dir);
    pos.set(...[0, 1, 2].map((a) => S.mesh.coords[node * 3 + a] + warp * v[a]));
    const len = Math.max(mags[k] * unit, 0);
    scale.set(len, len, len);
    m4.compose(pos, q, scale);
    mesh.setMatrixAt(k, m4);
    mesh.setColorAt(k, colour.setRGB(colours[k * 3], colours[k * 3 + 1], colours[k * 3 + 2]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = "results-analysis-glyphs";
  mesh.frustumCulled = false;
  results.frame().add(mesh);
  L.glyph.mesh = mesh;
  L.glyph.sig = signature();
  L.glyph.said = `${picked.length.toLocaleString()} arrows of ${f.field} at t=${f.steps[step].name}, longest ${formatValue(max, max)}${desc.vector.unit ? ` ${desc.vector.unit}` : ""}${warp ? ", on the warped surface" : ""}.`;
  const said = byId("ra-glyph-status");
  if (said) said.textContent = L.glyph.said;
}

/* ── selection ──────────────────────────────────────────────────────────── */

function saySel(text) {
  L.sel.text = text;
  const node = byId("ra-sel-status");
  if (node) node.textContent = text;
}

function disposeSelection() {
  const mesh = L.sel.mesh;
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry.dispose(); mesh.material.dispose();
  L.sel.mesh = null;
}

/** Arm a rectangle drag on the view; the release selects. Escape stands it down. */
export function armSelection() {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  const S = R()?.state;
  if (!canvas || !S?.mesh) { saySel("Open a run in Results first."); return; }
  if (L.sel.armed) return;
  L.sel.armed = true;
  saySel("Drag a box over the view to select nodes. Escape cancels.");
  const box = document.createElement("div");
  box.className = "ra-select-box";
  box.hidden = true;
  (byId("model-studio") || document.body).append(box);
  let start = null;
  const controls = viewer.controls;
  const wasEnabled = controls ? controls.enabled : true;
  if (controls) controls.enabled = false;
  const finish = () => {
    L.sel.armed = false;
    box.remove();
    canvas.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("keydown", key, true);
    if (controls) controls.enabled = wasEnabled;
    // The studio picks on a click; the release that ends a box is not one.
    window.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
    setTimeout(() => render(), 0);
  };
  const down = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    start = { x: e.clientX, y: e.clientY };
    Object.assign(box.style, { left: `${e.clientX}px`, top: `${e.clientY}px`, width: "0px", height: "0px" });
    box.hidden = false;
  };
  const move = (e) => {
    if (!start) return;
    Object.assign(box.style, { left: `${Math.min(start.x, e.clientX)}px`, top: `${Math.min(start.y, e.clientY)}px`, width: `${Math.abs(e.clientX - start.x)}px`, height: `${Math.abs(e.clientY - start.y)}px` });
  };
  const up = (e) => {
    if (!start) return;
    e.stopPropagation();
    const a = start; start = null;
    finish();
    if (Math.hypot(e.clientX - a.x, e.clientY - a.y) < 4) { saySel("A box has to be dragged out; nothing was selected."); return; }
    const rect = canvas.getBoundingClientRect();
    const ndc = (x, y) => [((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1];
    const [x0, y0] = ndc(a.x, a.y); const [x1, y1] = ndc(e.clientX, e.clientY);
    selectRect({ x0, x1, y0, y1 });
  };
  const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); start = null; finish(); saySel("Selection cancelled."); } };
  canvas.addEventListener("pointerdown", down, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("keydown", key, true);
}

/** Select the nodes whose drawn position falls in an NDC rectangle. */
export async function selectRect(rect) {
  const results = R();
  const S = results?.state;
  const viewer = window.GeoIDViewer;
  if (!S?.mesh || !viewer?.camera) return null;
  const frame = results.frame();
  frame.updateWorldMatrix(true, false);
  viewer.camera.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(viewer.camera.projectionMatrix, viewer.camera.matrixWorldInverse);
  const candidates = L.sel.mode === "surface" ? usedNodes(S.mesh.surface, S.mesh.nodeCount) : null;
  const t0 = performance.now();
  const ids = selectInRect(S.mesh.coords, { disp: results.disp?.() || null, matrix: frame.matrixWorld.elements, viewProjection: vp.elements, rect, candidates });
  L.sel.ids = ids;
  L.sel.over = null;
  L.sel.open = true;
  await summariseSelection();
  saySel(`${ids.length.toLocaleString()} ${L.sel.mode === "surface" ? "surface " : ""}nodes selected in ${Math.round(performance.now() - t0)} ms.`);
  render();
  return ids;
}

async function summariseSelection() {
  const results = R();
  const S = results?.state;
  const Z = L.sel;
  disposeSelection();
  if (!Z.ids?.length || !S?.mesh) { Z.summary = null; return; }
  const f = S.fields[S.field];
  if (f?.ok) {
    const values = await results.values(S.field, S.step);
    const scalar = results.samplingScalar(values);
    Z.summary = { ...selectionSummary(scalar, Z.ids), label: results.statsLabel?.() || f.field, field: f.field, stepName: f.steps[S.step]?.name };
  } else Z.summary = null;
  const disp = results.disp?.() || null;
  const pos = new Float32Array(Z.ids.length * 3);
  Z.ids.forEach((i, k) => { for (let a = 0; a < 3; a += 1) pos[k * 3 + a] = S.mesh.coords[i * 3 + a] + (disp ? disp[i * 3 + a] : 0); });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xff2bd6, size: 2, sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.45 }));
  mesh.name = "results-analysis-selection";
  mesh.renderOrder = 31;
  mesh.frustumCulled = false;
  results.frame().add(mesh);
  Z.mesh = mesh;
  Z.sig = signature();
}

/** The mean, min and max of the shown scalar over the selection, at every step of the field. */
export async function selectionOverTime() {
  const results = R();
  const S = results?.state;
  const Z = L.sel;
  const f = S?.fields?.[S.field];
  if (!Z.ids?.length || !f?.ok) { saySel("Select nodes and show a field first."); return null; }
  Z.busy = true;
  try {
    const rows = [];
    for (let k = 0; k < f.steps.length; k += 1) {
      const sum = selectionSummary(results.samplingScalar(await results.values(S.field, k)), Z.ids);
      rows.push({ time: timeOf(f.steps[k]), name: f.steps[k].name, ...sum });
    }
    Z.over = { rows, field: f.field, label: results.statsLabel?.() || f.field };
    saySel(`${Z.ids.length.toLocaleString()} nodes over ${rows.length} step${rows.length > 1 ? "s" : ""} of ${f.field}.`);
    return Z.over;
  } finally {
    Z.busy = false;
    render();
  }
}

function exportSelection() {
  const results = R();
  const S = results?.state;
  const Z = L.sel;
  if (!Z.ids?.length) { saySel("Nothing is selected."); return; }
  const f = S.fields[S.field];
  (async () => {
    const lines = [`# ${Z.ids.length} selected nodes${f?.ok ? ` · ${f.field} at t=${f.steps[S.step]?.name}` : ""}`];
    if (Z.over) {
      lines.push("# selection over time", "time,step,min,max,mean,finite");
      Z.over.rows.forEach((r) => lines.push([r.time, r.name, r.min, r.max, r.mean, r.finite].join(",")));
      lines.push("");
    }
    if (f?.ok) {
      const values = await results.values(S.field, S.step);
      const desc = f.desc; const n = S.mesh.nodeCount; const nb = desc.nbDofs || values.length / n;
      lines.push(["node", "x", "y", "z", ...desc.components.map((c) => c.key)].join(","));
      for (const i of Z.ids) lines.push([i, S.mesh.coords[i * 3], S.mesh.coords[i * 3 + 1], S.mesh.coords[i * 3 + 2], ...desc.components.map((_, j) => (desc.blocked ? values[j * n + i] : values[i * nb + j]))].join(","));
    } else {
      lines.push("node,x,y,z");
      for (const i of Z.ids) lines.push([i, S.mesh.coords[i * 3], S.mesh.coords[i * 3 + 1], S.mesh.coords[i * 3 + 2]].join(","));
    }
    downloadText(`selection_${Z.ids.length}_nodes${f?.ok ? `_${f.field.replace(/[^A-Za-z0-9]+/g, "_")}` : ""}.csv`, `${lines.join("\n")}\n`, "text/csv");
  })();
}

function drawSelectionPlot(canvas, over) {
  const w = canvas.clientWidth || 320; const h = 150;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const rows = over.rows.filter((r) => Number.isFinite(r.mean));
  if (!rows.length) return;
  const tx = rows.map((r) => r.time); const lo = Math.min(...rows.map((r) => r.min)); const hi = Math.max(...rows.map((r) => r.max));
  const t0 = Math.min(...tx); const t1 = Math.max(...tx);
  const pad = { l: 46, r: 8, t: 8, b: 22 };
  const X = (t) => pad.l + (t1 > t0 ? (t - t0) / (t1 - t0) : 0.5) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (h - pad.t - pad.b);
  g.strokeStyle = "rgba(200,210,230,0.25)"; g.beginPath(); g.moveTo(pad.l, pad.t); g.lineTo(pad.l, h - pad.b); g.lineTo(w - pad.r, h - pad.b); g.stroke();
  g.fillStyle = "rgba(82,228,232,0.18)"; g.beginPath();
  rows.forEach((r, k) => (k ? g.lineTo(X(r.time), Y(r.max)) : g.moveTo(X(r.time), Y(r.max))));
  [...rows].reverse().forEach((r) => g.lineTo(X(r.time), Y(r.min)));
  g.closePath(); g.fill();
  g.strokeStyle = "#52e4e8"; g.lineWidth = 1.6; g.beginPath();
  rows.forEach((r, k) => (k ? g.lineTo(X(r.time), Y(r.mean)) : g.moveTo(X(r.time), Y(r.mean))));
  g.stroke();
  rows.forEach((r) => { g.fillStyle = "#52e4e8"; g.beginPath(); g.arc(X(r.time), Y(r.mean), 2.5, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = "rgba(220,225,240,0.8)"; g.font = "10px system-ui, sans-serif";
  g.fillText(formatValue(hi, hi - lo || 1), 2, pad.t + 8); g.fillText(formatValue(lo, hi - lo || 1), 2, h - pad.b);
  g.fillText(`t=${rows[0].name}`, pad.l, h - 6); const last = `t=${rows.at(-1).name}`; g.fillText(last, w - pad.r - g.measureText(last).width, h - 6);
}

/* ── stream tracer ──────────────────────────────────────────────────────── */

function disposeStream() {
  const mesh = L.stream.mesh;
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry.dispose(); mesh.material.dispose();
  L.stream.mesh = null;
}

function sayStream(text) {
  L.stream.text = text;
  const node = byId("ra-stream-status");
  if (node) node.textContent = text;
}

/** Stream lines of a vector field, traced in the reader from seeds on the profile line or in a sphere. */
export async function traceStream() {
  const results = R();
  const S = results?.state;
  const Z = L.stream;
  if (!S?.mesh) return null;
  if (S.mesh.dim !== 3) { sayStream("Stream lines are traced through a 3D mesh."); return null; }
  const fields = vectorFields();
  if (!fields.length) { sayStream("No vector field is open (displacement, velocity)."); return null; }
  if (!fields.some((x) => x.i === Z.field)) Z.field = fields.some((x) => x.i === S.field) ? S.field : fields[0].i;
  if (Z.busy) { Z.again = true; return null; }
  Z.busy = true;
  try {
    const f = S.fields[Z.field];
    const time = S.fields[S.field]?.steps[S.step]?.time ?? f.steps.at(-1).time;
    let step = f.steps.length - 1;
    for (let k = 0; k < f.steps.length; k += 1) if (f.steps[k].time <= time) step = k;
    sayStream("Tracing…");
    const values = await results.values(Z.field, step);
    const desc = f.desc;
    const n = S.mesh.nodeCount;
    const comps = desc.vector.from.map((j) => componentOf(values, n, desc.nbDofs, j, desc.blocked));
    const vec = new Float64Array(n * 3);
    for (let i = 0; i < n; i += 1) for (let a = 0; a < 3; a += 1) vec[i * 3 + a] = comps[a]?.[i] ?? 0;
    const b = S.mesh.bounds;
    const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    let seeds;
    let seedSaid;
    if (Z.seed === "sphere") {
      const probe = S.probe?.node;
      const centre = Number.isInteger(probe) ? [0, 1, 2].map((a) => S.mesh.coords[probe * 3 + a]) : [0, 1, 2].map((a) => (b.min[a] + b.max[a]) / 2);
      seeds = streamSeeds("sphere", { centre, radius: Z.radius * diag, count: Z.count });
      seedSaid = `${Z.count} seeds in a ${formatValue(Z.radius * diag, Z.radius * diag)} m sphere about ${Number.isInteger(probe) ? `node ${probe}` : "the centre"}`;
    } else {
      seeds = streamSeeds("line", { a: L.a, b: L.b, count: Z.count });
      seedSaid = `${Z.count} seeds along the profile line`;
    }
    const lines = await results.streamlines(vec, seeds, { step: diag / Z.stepPer, maxLength: diag * Z.lengthPer, maxSteps: Math.ceil(Z.stepPer * Z.lengthPer) + 1, direction: Z.direction });
    if (!lines) return null;
    disposeStream();
    Z.lines = { ...lines, field: f.field, stepName: f.steps[step].name, unit: desc.vector.unit || "" };
    if (!lines.traced) {
      const why = [...new Set(lines.reasons)].join(", ");
      sayStream(`None of the ${lines.seeded} seeds gave a line (${why}). Seeds outside the mesh, or in a cavity, trace nothing.`);
      return Z.lines;
    }
    let segs = 0;
    for (const c of lines.counts) segs += c - 1;
    const pos = new Float32Array(segs * 6); const col = new Float32Array(segs * 6);
    const colours = colourValues(lines.values, 0, lines.vmax || 1, results.colormap(), new Float32Array(lines.values.length * 3));
    let at = 0;
    for (let l = 0; l < lines.starts.length; l += 1) {
      for (let k = 0; k + 1 < lines.counts[l]; k += 1) {
        for (const i of [lines.starts[l] + k, lines.starts[l] + k + 1]) {
          pos[at * 3] = lines.points[i * 3]; pos[at * 3 + 1] = lines.points[i * 3 + 1]; pos[at * 3 + 2] = lines.points[i * 3 + 2];
          col[at * 3] = colours[i * 3]; col[at * 3 + 1] = colours[i * 3 + 1]; col[at * 3 + 2] = colours[i * 3 + 2];
          at += 1;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }));
    mesh.name = "results-analysis-streamlines";
    mesh.renderOrder = 30;
    mesh.frustumCulled = false;
    results.frame().add(mesh);
    Z.mesh = mesh;
    Z.sig = signature() + streamSignature();
    const reasons = {};
    lines.reasons.forEach((r) => r.split("/").forEach((x) => { if (x) reasons[x] = (reasons[x] || 0) + 1; }));
    const ends = Object.entries(reasons).map(([k, v]) => `${v} ${{ outside: "left the mesh", stalled: "reached still ground", length: "reached the length", steps: "ran out of steps" }[k] || k}`).join(", ");
    sayStream(`${lines.traced} of ${lines.seeded} lines of ${f.field} at t=${f.steps[step].name} from ${seedSaid}; longest |v| ${formatValue(lines.vmax, lines.vmax)}${Z.lines.unit ? ` ${Z.lines.unit}` : ""}. Ends: ${ends}. Drawn through the undeformed mesh.`);
    return Z.lines;
  } catch (error) {
    sayStream(`Could not trace: ${error.message}`);
    return null;
  } finally {
    Z.busy = false;
    if (Z.again) { Z.again = false; if (Z.on) traceStream(); }
  }
}

const streamSignature = () => { const Z = L.stream; return `|${Z.field}|${Z.seed}|${Z.count}|${Z.radius}|${Z.stepPer}|${Z.lengthPer}|${Z.direction}|${L.a}|${L.b}|${R()?.state?.probe?.node ?? ""}`; };

function exportStream() {
  const Z = L.stream.lines;
  if (!Z?.traced) { sayStream("Trace some lines first."); return; }
  const text = streamlinesCsv(Z, { unit: Z.unit, header: [`Stream lines of ${Z.field} at t=${Z.stepName}`, "RK4 on the unit field, interpolated in each element (GeoID Model page)"] });
  downloadText(`streamlines_${Z.field.replace(/[^A-Za-z0-9]+/g, "_")}_t${String(Z.stepName).replace(/[^A-Za-z0-9.]+/g, "")}.csv`, text, "text/csv");
}

/* ── statistics by domain ───────────────────────────────────────────────── */

const unitOf = (label) => (/\(([^()]+)\)\s*$/.exec(label || "") || [])[1]?.split(",")[0].trim() || "";

export async function computeStats() {
  const results = R();
  const S = results?.state;
  const f = S?.fields?.[S.field];
  const T = L.stats;
  if (!S?.mesh || !f?.ok || !results.domainStats) { T.text = "Choose a field in Results first."; T.result = null; render(); return; }
  // A press during a run is not dropped: the run in hand may be reading a
  // selection that has since changed, so one more follows it.
  if (T.busy) { T.pending = true; return; }
  T.busy = true;
  T.text = "Summarising…";
  sayStats();
  try {
    const values = await results.values(S.field, S.step);
    const scalar = (results.samplingScalar || results.scalar)(values);
    const t0 = performance.now();
    const stats = await results.domainStats(scalar, 24);
    T.result = stats;
    T.label = results.statsLabel ? results.statsLabel() : results.componentLabel();
    T.field = f.field;
    T.stepName = f.steps[S.step]?.name;
    T.sig = signature();
    const secs = ((performance.now() - t0) / 1000).toFixed(2);
    const extra = [stats.skipped ? `${stats.skipped.toLocaleString()} non-simplex elements left out` : "", stats.nanCells ? `${stats.nanCells.toLocaleString()} elements touching no value left out` : ""].filter(Boolean).join("; ");
    T.text = stats.domains.length ? `${stats.domains.length} domain${stats.domains.length > 1 ? "s" : ""} by volume flag, t=${T.stepName}, ${secs} s${extra ? ` — ${extra}` : ""}.` : "No elements to summarise.";
  } catch (error) {
    T.text = `Could not summarise: ${error.message}`;
  } finally {
    T.busy = false;
  }
  render();
  if (T.pending) { T.pending = false; computeStats(); }
}

function sayStats() {
  const node = byId("ra-stats-status");
  if (node) node.textContent = L.stats.text;
}

function formatMeasure(m, dim) {
  if (dim === 3) return m >= 1e9 ? `${formatValue(m / 1e9, m / 1e9)} km³` : `${formatValue(m, m)} m³`;
  return m >= 1e6 ? `${formatValue(m / 1e6, m / 1e6)} km²` : `${formatValue(m, m)} m²`;
}

function drawStatsHistogram(canvas, stats, size = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = size.width || canvas.clientWidth || 280;
  const H = size.height || canvas.clientHeight || 150;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const pad = { l: 8, r: 8, t: 8, b: 20 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  // Each domain as the share of ITS OWN volume per bin, so a small chamber is
  // not flattened against a crust a thousand times its size.
  const shares = stats.domains.map((d) => [...d.hist].map((v) => (d.measure > 0 ? v / d.measure : 0)));
  // On a square-root axis: a field's tail is most of what distinguishes two
  // domains, and a linear axis gives the whole height to one spike near zero.
  const top = Math.sqrt(Math.max(1e-12, ...shares.flat()));
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l, pad.t + h + 0.5); ctx.lineTo(pad.l + w, pad.t + h + 0.5); ctx.stroke();
  shares.forEach((row, n) => {
    ctx.strokeStyle = STAT_COLOURS[n % STAT_COLOURS.length]; ctx.lineWidth = 1.5;
    ctx.beginPath();
    row.forEach((v, k) => {
      const x0 = pad.l + (k / stats.bins) * w;
      const x1 = pad.l + ((k + 1) / stats.bins) * w;
      const y = pad.t + h - (Math.sqrt(v) / top) * h;
      if (k === 0) ctx.moveTo(x0, y); else ctx.lineTo(x0, y);
      ctx.lineTo(x1, y);
    });
    ctx.stroke();
  });
  ctx.fillStyle = "rgba(232,234,242,0.7)"; ctx.font = "10px 'Exo 2', sans-serif";
  ctx.textAlign = "left"; ctx.fillText(formatValue(stats.lo, stats.hi - stats.lo || 1), pad.l, H - 5);
  ctx.textAlign = "right"; ctx.fillText(formatValue(stats.hi, stats.hi - stats.lo || 1), pad.l + w, H - 5);
}

function exportStats() {
  const T = L.stats;
  if (!T.result) return;
  const label = T.label.replace(/\s*\([^()]*\)\s*$/, "");
  const text = domainStatsCsv(T.result, { label, unit: unitOf(T.label) });
  downloadText(`domain_stats_${(T.field || "field").replace(/[^A-Za-z0-9]+/g, "_")}_t${String(T.stepName).replace(/[^A-Za-z0-9.]+/g, "")}.csv`, text, "text/csv");
}

/* ── compare with observations ──────────────────────────────────────────── */

const UNIT_SCALE = { mm: 1000, cm: 100, m: 1 };
const OBS_COLOUR = "#52e4e8";
const MODEL_COLOUR = "#ff2bd6";

/** The displacement the comparison reads: the one shown, else the first open. */
function displacementField() {
  const S = R()?.state;
  const ok = (f) => Boolean(f?.ok && f.desc?.displacement?.length >= 2 && !f.desc.blocked);
  if (ok(S?.fields?.[S.field])) return S.field;
  return (S?.fields || []).findIndex(ok);
}

/** The step of another field nearest (not after) the time shown in Results. */
function stepMatching(fieldIndex) {
  const S = R().state;
  if (fieldIndex === S.field) return S.step;
  const f = S.fields[fieldIndex];
  const time = S.fields[S.field]?.steps[S.step]?.time ?? f.steps.at(-1).time;
  let step = f.steps.length - 1;
  for (let k = 0; k < f.steps.length; k += 1) if (f.steps[k].time <= time) step = k;
  return step;
}

const diagonalOf = (b) => Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);

/**
 * The ground under (x, y): the highest surface node among those horizontally
 * nearest. A domain's surface is its sides and base as well as its top, so the
 * nearest node alone can be on the base 50 km below the station.
 */
function groundBelow(x, y) {
  const O = L.obs;
  const S = R().state;
  const c = S.mesh.coords;
  if (O.surf?.sig !== L.meshSig) {
    const nodes = usedNodes(S.mesh.surface, S.mesh.nodeCount);
    O.surf = { sig: L.meshSig, nodes, d2: new Float64Array(nodes.length) };
  }
  const { nodes, d2 } = O.surf;
  let dmin = Infinity;
  for (let k = 0; k < nodes.length; k += 1) {
    const i = nodes[k];
    const d = (c[i * 3] - x) ** 2 + (c[i * 3 + 1] - y) ** 2;
    d2[k] = d;
    if (d < dmin) dmin = d;
  }
  // Twice the nearest distance reaches the neighbouring nodes a station between
  // nodes sits among, and no further: a slack in model units would pass over a
  // station standing exactly on a node to a higher neighbour hundreds of metres off.
  const reach = (Math.sqrt(dmin) * 2 + 1e-6 * diagonalOf(S.mesh.bounds)) ** 2;
  let best = -1;
  let bestZ = -Infinity;
  for (let k = 0; k < nodes.length; k += 1) {
    if (d2[k] <= reach && c[nodes[k] * 3 + 2] > bestZ) { bestZ = c[nodes[k] * 3 + 2]; best = nodes[k]; }
  }
  return best;
}

/**
 * Where each station reads the model. A station with a height is located in
 * its element and interpolated, like a profile sample; one without a height,
 * or with a height the mesh does not contain (an antenna above a coarse
 * topography), reads the ground surface below it. A station beyond the mesh's
 * horizontal extent is not placed at all rather than given a distant node.
 */
async function placeStations(stations) {
  const results = R();
  const mesh = results.state.mesh;
  const b = mesh.bounds;
  const pad = 0.01 * diagonalOf(b);
  const inPlan = (s) => s.x >= b.min[0] - pad && s.x <= b.max[0] + pad && s.y >= b.min[1] - pad && s.y <= b.max[1] + pad;
  const withZ = [];
  stations.forEach((s, i) => { if (s.z !== null && inPlan(s)) withZ.push(i); });
  let located = null;
  if (withZ.length) {
    const pts = new Float64Array(withZ.length * 3);
    withZ.forEach((i, k) => { pts[k * 3] = stations[i].x; pts[k * 3 + 1] = stations[i].y; pts[k * 3 + 2] = stations[i].z; });
    located = await results.locate(pts);
  }
  const slotOf = new Map(withZ.map((i, k) => [i, k]));
  const at = stations.map((s, i) => {
    if (!inPlan(s)) { s.placed = "outside the model"; return null; }
    const slot = slotOf.get(i);
    if (slot !== undefined && located && located.nodes[slot * 4] >= 0) {
      s.px = s.x; s.py = s.y; s.pz = s.z;
      s.placed = "inside the mesh";
      return { slot, node: -1 };
    }
    const node = groundBelow(s.x, s.y);
    if (node < 0) { s.placed = "outside the model"; return null; }
    const c = mesh.coords;
    s.px = c[node * 3]; s.py = c[node * 3 + 1]; s.pz = c[node * 3 + 2];
    s.placed = s.z === null ? "on the surface (nearest node)" : "on the surface (its height is outside the mesh)";
    return { slot: -1, node };
  });
  return { at, located };
}

function obsSignature() {
  const S = R()?.state;
  const O = L.obs;
  return `${signature()}|${O.fit}|${O.unit}|${S?.insar?.heading}|${S?.insar?.incidence}|${S?.insar?.look}`;
}

/**
 * Read the open displacement at every station and compare. Answers the result
 * (also kept on the state and drawn), or null with the reason in the status.
 */
export async function compareObservations(text, options = {}) {
  const O = L.obs;
  if (typeof text === "string") O.raw = text;
  for (const key of ["unit", "fit", "arrows"]) if (options[key] !== undefined) O[key] = options[key];
  const results = R();
  const S = results?.state;
  const refuse = (message) => { O.text = message; O.result = null; disposeObsArrows(); render(); return null; };
  if (!S?.mesh) return refuse("Open a run in Results first.");
  if (S.mesh.dim === 2) return refuse("Observations are compared on a 3D mesh: a 2D model does not say whether its plane is a map or a section.");
  if (O.busy) { O.pending = true; return null; }
  const parsed = parseObservations(O.raw, { scale: UNIT_SCALE[O.unit] || 1 });
  if (!parsed.kind || !parsed.stations.length) return refuse(parsed.warnings.join(" ") || "Paste or load a table of stations first.");
  const fieldIndex = displacementField();
  if (fieldIndex < 0) return refuse("No displacement field is open: open results/solid/u in Results.");
  O.busy = true;
  O.text = "Reading the model at the stations…";
  sayObs();
  try {
    const f = S.fields[fieldIndex];
    const step = stepMatching(fieldIndex);
    const desc = f.desc;
    const n = S.mesh.nodeCount;
    const values = await results.values(fieldIndex, step);
    const comps = desc.displacement.slice(0, 3).map((j) => componentOf(values, n, desc.nbDofs, j, false));
    const { at, located } = await placeStations(parsed.stations);
    const sampled = located ? comps.map((c) => sampleLocated(located, c)) : null;
    const los = losVector(S.insar);
    const vectors = [];
    const model = parsed.stations.map((s, i) => {
      const p = at[i];
      if (!p) { vectors.push(null); return null; }
      const v = [0, 1, 2].map((a) => (comps[a] ? (p.slot >= 0 ? sampled[a][p.slot] : comps[a][p.node]) : 0));
      if (!v.every(Number.isFinite)) { s.placed = "outside the model"; vectors.push(null); return null; }
      vectors.push(v);
      return parsed.kind === "gnss" ? v : [v[0] * los[0] + v[1] * los[1] + v[2] * los[2]];
    });
    const fit = fitScale(pairsOf(parsed.stations, model));
    const k = O.fit && Number.isFinite(fit.scale) ? fit.scale : 1;
    const counts = {};
    parsed.stations.forEach((s) => { counts[s.placed] = (counts[s.placed] || 0) + 1; });
    O.result = {
      kind: parsed.kind, stations: parsed.stations, model, vectors, fit, k, los,
      field: f.field, fieldIndex, stepName: f.steps[step]?.name, counts, warnings: parsed.warnings,
      geometry: { ...S.insar },
    };
    O.sig = obsSignature();
    const placed = model.filter(Boolean).length;
    O.text = placed ? `${placed} of ${parsed.stations.length} station${parsed.stations.length > 1 ? "s" : ""} read from ${f.field} at t=${f.steps[step]?.name}.${parsed.warnings.length ? ` ${parsed.warnings.join(" ")}` : ""}` : "No station falls on the model.";
    drawObsArrows();
    return O.result;
  } catch (error) {
    O.text = `Could not compare: ${error.message}`;
    O.result = null;
    return null;
  } finally {
    O.busy = false;
    render();
    if (O.pending) { O.pending = false; compareObservations(); }
  }
}

function sayObs() {
  const node = byId("ra-obs-status");
  if (node) node.textContent = L.obs.text;
}

function disposeObsArrows() {
  const O = L.obs;
  if (!O.mesh) return;
  O.mesh.parent?.remove(O.mesh);
  O.mesh.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  O.mesh = null;
}

/** Observed (cyan) and modelled (magenta, at the fitted scale) arrows at the stations. */
function drawObsArrows() {
  const O = L.obs;
  disposeObsArrows();
  const res = O.result;
  const S = R()?.state;
  const frame = R()?.frame?.();
  if (!O.arrows || !res || !S?.mesh || !frame) return;
  const vec = (i, which) => {
    const s = res.stations[i];
    if (which === "obs") {
      if (res.kind === "gnss") return s.obs.map((v) => (Number.isFinite(v) ? v : 0));
      return res.los.map((a) => a * s.obs[0]);
    }
    const m = res.model[i];
    if (res.kind === "gnss") return m.map((v) => res.k * v);
    return res.los.map((a) => a * res.k * m[0]);
  };
  const rows = res.stations.map((s, i) => i).filter((i) => res.model[i]);
  let max = 0;
  rows.forEach((i) => { max = Math.max(max, Math.hypot(...vec(i, "obs")), Math.hypot(...vec(i, "model"))); });
  if (!rows.length || !(max > 0)) return;
  const unit = (0.08 * diagonalOf(S.mesh.bounds)) / max;
  const warp = S.deform?.on && S.deform.field === res.fieldIndex ? S.deform.scale : 0;
  const group = new THREE.Group();
  group.name = "results-analysis-observations";
  const up = new THREE.Vector3(0, 1, 0); const dir = new THREE.Vector3(); const q = new THREE.Quaternion();
  const m4 = new THREE.Matrix4(); const pos = new THREE.Vector3(); const scale = new THREE.Vector3();
  for (const [which, colour] of [["obs", OBS_COLOUR], ["model", MODEL_COLOUR]]) {
    const material = new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.95 });
    const mesh = new THREE.InstancedMesh(arrowGeometry(), material, rows.length);
    rows.forEach((i, k) => {
      const v = vec(i, which);
      const len = Math.hypot(...v) * unit;
      const s = res.stations[i];
      const raw = res.vectors[i] || [0, 0, 0];
      pos.set(s.px + warp * raw[0], s.py + warp * raw[1], s.pz + warp * raw[2]);
      if (len > 0) { dir.set(v[0], v[1], v[2]).normalize(); q.setFromUnitVectors(up, dir); } else q.identity();
      scale.set(len, len, len);
      m4.compose(pos, q, scale);
      mesh.setMatrixAt(k, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = which === "obs" ? 955 : 956;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  frame.add(group);
  O.mesh = group;
}

function exportComparison() {
  const O = L.obs;
  const res = O.result;
  if (!res) return;
  const g = res.geometry;
  const header = [
    `observations against ${res.field} at t=${res.stepName}`,
    res.kind === "los" ? `line of sight: heading ${g.heading} deg, incidence ${g.incidence} deg, ${g.look}-looking; + toward the satellite` : "GNSS: east, north, up in the mesh frame",
    `model scaled by ${Number(res.k.toPrecision(6))}${O.fit ? " (least-squares source strength)" : " (not fitted)"}; residual = observed - scaled model`,
  ];
  const text = comparisonCsv(res.kind, res.stations, res.model, { k: res.k, unit: O.unit, toUnit: UNIT_SCALE[O.unit] || 1, header });
  downloadText(`observations_vs_${res.field.replace(/[^A-Za-z0-9]+/g, "_")}_t${String(res.stepName).replace(/[^A-Za-z0-9.]+/g, "")}.csv`, text, "text/csv");
}

/* ── analytical source (Mogi) ───────────────────────────────────────────── */

const fmtVol = (v) => {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}${formatValue(a / 1e9, a / 1e9)} km³`;
  if (a >= 1e6) return `${sign}${formatValue(a / 1e6, a / 1e6)} × 10⁶ m³`;
  return `${sign}${formatValue(a, a || 1)} m³`;
};
const fmtKm = (m) => `${formatValue(m / 1000, Math.abs(m) / 1000 || 1)} km`;

/** The source's ΔV as the card defines it: typed, or from ΔP in a sphere of radius a. */
function sourceVolume() {
  const P = L.src;
  return P.mode === "dP" ? volumeFromPressure(P.dP, P.radius, shearModulus(P.E, P.nu)) : P.dV;
}

/** The model's free surface, sampled: highest surface nodes away from the walls, with their u. */
async function modelSurface() {
  const results = R();
  const S = results.state;
  const fieldIndex = displacementField();
  if (fieldIndex < 0) throw new Error("No displacement field is open: open results/solid/u in Results.");
  const f = S.fields[fieldIndex];
  const step = stepMatching(fieldIndex);
  const values = await results.values(fieldIndex, step);
  const desc = f.desc;
  const n = S.mesh.nodeCount;
  const c = S.mesh.coords;
  const nodes = topSurfaceNodes(c, usedNodes(S.mesh.surface, n), S.mesh.bounds);
  const zs = nodes.map((i) => c[i * 3 + 2]).sort((a, b) => a - b);
  const surfaceZ = zs.length ? zs[Math.floor(zs.length / 2)] : S.mesh.bounds.max[2];
  const j = desc.displacement;
  const stations = nodes.map((i) => ({
    node: i, x: c[i * 3], y: c[i * 3 + 1], z: c[i * 3 + 2],
    obs: [values[i * desc.nbDofs + j[0]], values[i * desc.nbDofs + j[1]], j[2] !== undefined ? values[i * desc.nbDofs + j[2]] : 0],
    sigma: null,
  }));
  return { stations, surfaceZ, field: f.field, stepName: f.steps[step]?.name, fieldIndex };
}

/** Mogi against the model's own surface: the benchmark. */
export async function compareSource(patch = {}) {
  const P = L.src;
  Object.assign(P, patch);
  const S = R()?.state;
  if (!S?.mesh) { P.text = "Open a run in Results first."; render(); return null; }
  if (S.mesh.dim !== 3) { P.text = "The Mogi source is a 3D half-space solution."; render(); return null; }
  if (P.busy) return null;
  P.busy = true;
  P.text = "Reading the model surface…";
  saySource();
  try {
    const surf = await modelSurface();
    P.surfaceZ = surf.surfaceZ;
    const geometry = { x0: P.x0, y0: P.y0, depth: P.depth, nu: P.nu };
    let dV = sourceVolume();
    if (P.fitDV) dV = bestVolume(surf.stations, geometry).dV;
    const src = { ...geometry, dV };
    let sse = 0; let ssm = 0; let peakModel = 0; let peakMogi = 0;
    const points = surf.stations.map((s) => {
      const m = mogi(src, s.x, s.y);
      const dx = s.x - P.x0; const dy = s.y - P.y0;
      const r = Math.hypot(dx, dy) || 1e-9;
      for (let a = 0; a < 3; a += 1) { sse += (s.obs[a] - m[a]) ** 2; ssm += s.obs[a] ** 2; }
      peakModel = Math.max(peakModel, Math.hypot(...s.obs));
      peakMogi = Math.max(peakMogi, Math.hypot(...m));
      return { r: Math.hypot(dx, dy), uz: s.obs[2], ur: (s.obs[0] * dx + s.obs[1] * dy) / r, mz: m[2], mr: (m[0] * dx + m[1] * dy) / r };
    });
    P.result = {
      points, dV, fitted: P.fitDV, n: points.length, field: surf.field, stepName: surf.stepName,
      rms: Math.sqrt(sse / Math.max(1, 3 * points.length)), explained: ssm > 0 ? 1 - sse / ssm : NaN, peakModel, peakMogi,
    };
    if (P.fitDV) P.dV = dV;
    P.sig = signature();
    P.text = `${points.length.toLocaleString()} surface nodes of ${surf.field} at t=${surf.stepName}; the free surface taken at z = ${formatValue(surf.surfaceZ, 1000)} m.`;
    drawSourceMarker();
    return P.result;
  } catch (error) {
    P.text = `Could not compare: ${error.message}`;
    P.result = null;
    return null;
  } finally {
    P.busy = false;
    render();
  }
}

/**
 * Invert for a Mogi source: the model's own surface ("model"), or the
 * observations compared above ("observations"). The answer becomes the card's
 * source, and the benchmark is re-drawn against it.
 */
export async function invertSource(what = "model") {
  const P = L.src;
  const S = R()?.state;
  if (!S?.mesh) { P.text = "Open a run in Results first."; render(); return null; }
  if (P.busy) return null;
  const b = S.mesh.bounds;
  const box = { minX: b.min[0], maxX: b.max[0], minY: b.min[1], maxY: b.max[1] };
  let stations; let los = null; let label; let surfaceZ;
  try {
    P.busy = true;
    P.text = what === "model" ? "Searching position and depth against the model surface…" : "Searching position and depth against the observations…";
    saySource();
    await new Promise((r) => setTimeout(r, 0));
    if (what === "observations") {
      const res = L.obs.result;
      if (!res) throw new Error("Compare observations first: the inversion reads the stations placed there.");
      stations = res.stations.filter((s, i) => res.model[i]).map((s) => ({ x: s.x, y: s.y, obs: s.obs, sigma: s.sigma }));
      if (res.kind === "los") los = res.los;
      label = `${stations.length} observed stations${los ? " (line of sight)" : ""}`;
      surfaceZ = (await modelSurface()).surfaceZ;
    } else {
      const surf = await modelSurface();
      stations = surf.stations;
      surfaceZ = surf.surfaceZ;
      label = `${stations.length.toLocaleString()} model surface nodes`;
    }
    const inv = invertMogi(stations, { bounds: box, depthRange: [Math.max(100, 0.002 * (b.max[2] - b.min[2])), Math.max(1000, surfaceZ - b.min[2])], nu: P.nu, los });
    if (!inv) throw new Error("At least two stations are needed.");
    Object.assign(P, { x0: inv.x0, y0: inv.y0, depth: inv.depth, dV: inv.dV, mode: "dV", surfaceZ });
    P.inversion = { ...inv, what, label };
    P.busy = false;
    const keep = P.fitDV;
    await compareSource({ fitDV: false });
    P.fitDV = keep;
    const edge = [inv.atEdge.depth ? "depth" : "", inv.atEdge.position ? "position" : ""].filter(Boolean).join(" and ");
    P.text = `Best Mogi source for ${label}: ${fmtVol(inv.dV)} at ${fmtKm(inv.depth)} below z = ${formatValue(surfaceZ, 1000)} m, ${(inv.explained * 100).toFixed(1)}% explained.${edge ? ` Its ${edge} sit${inv.atEdge.depth && inv.atEdge.position ? "" : "s"} on the edge of the search: that is where it stopped looking, not a minimum — a point source does not explain this surface.` : ""}`;
    render();
    return P.inversion;
  } catch (error) {
    P.text = `Could not invert: ${error.message}`;
    return null;
  } finally {
    P.busy = false;
    render();
  }
}

function saySource() {
  const node = byId("ra-src-status");
  if (node) node.textContent = L.src.text;
}

function disposeSourceMarker() {
  const P = L.src;
  if (!P.marker) return;
  P.marker.parent?.remove(P.marker);
  P.marker.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  P.marker = null;
}

/** The source in the model: a sphere at its depth, its radius if it has one, and a line up to the surface. */
function drawSourceMarker() {
  disposeSourceMarker();
  const P = L.src;
  const S = R()?.state;
  const frame = R()?.frame?.();
  if (!S?.mesh || !frame || !P.result) return;
  const diag = diagonalOf(S.mesh.bounds);
  const z = P.surfaceZ - P.depth;
  const radius = P.mode === "dP" ? P.radius : 0.012 * diag;
  const group = new THREE.Group();
  group.name = "results-analysis-source";
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), new THREE.MeshBasicMaterial({ color: "#ffd166", wireframe: true, depthTest: false, transparent: true, opacity: 0.9 }));
  sphere.position.set(P.x0, P.y0, z);
  const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(P.x0, P.y0, z), new THREE.Vector3(P.x0, P.y0, P.surfaceZ)]), new THREE.LineDashedMaterial({ color: "#ffd166", dashSize: diag * 0.01, gapSize: diag * 0.008, depthTest: false, transparent: true }));
  stem.computeLineDistances();
  [sphere, stem].forEach((o) => { o.renderOrder = 958; o.frustumCulled = false; group.add(o); });
  frame.add(group);
  P.marker = group;
}

function drawSourcePlot(canvas, res, size = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = size.width || canvas.clientWidth || 280;
  const H = size.height || 180;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const pts = res.points;
  if (!pts.length) return;
  const rMax = Math.max(...pts.map((p) => p.r)) || 1;
  const vals = pts.flatMap((p) => [p.uz, p.ur, p.mz, p.mr]).filter(Number.isFinite);
  let lo = Math.min(0, ...vals); let hi = Math.max(0, ...vals);
  if (hi === lo) hi = lo + 1;
  const Lp = 44; const Rp = 8; const T = 10; const B = 22;
  const X = (r) => Lp + (r / rMax) * (W - Lp - Rp);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  ctx.font = "10px 'Exo 2', sans-serif";
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.fillStyle = "rgba(232,230,240,0.55)";
  niceTicks(lo, hi, 4).forEach((v) => { ctx.beginPath(); ctx.moveTo(Lp, Y(v)); ctx.lineTo(W - Rp, Y(v)); ctx.stroke(); ctx.fillText(formatValue(v, hi - lo), 2, Y(v) + 3); });
  niceTicks(0, rMax / 1000, 4).forEach((km) => { const t = `${formatValue(km, rMax / 1000)}${km === 0 ? " km" : ""}`; const w = ctx.measureText(t).width; ctx.fillText(t, Math.min(W - Rp - w, Math.max(Lp, X(km * 1000) - w / 2)), H - 6); });
  const dot = (colour, key) => { ctx.fillStyle = colour; pts.forEach((p) => { if (Number.isFinite(p[key])) ctx.fillRect(X(p.r) - 1, Y(p[key]) - 1, 2, 2); }); };
  dot("rgba(82,228,232,0.55)", "uz");
  dot("rgba(180,190,210,0.45)", "ur");
  const sorted = [...pts].sort((a, b) => a.r - b.r);
  const line = (colour, key, dash) => {
    ctx.strokeStyle = colour; ctx.lineWidth = 1.6; ctx.setLineDash(dash);
    ctx.beginPath();
    sorted.forEach((p, k) => (k ? ctx.lineTo(X(p.r), Y(p[key])) : ctx.moveTo(X(p.r), Y(p[key]))));
    ctx.stroke();
  };
  line("#ff2bd6", "mz", []);
  line("#ff2bd6", "mr", [4, 3]);
  ctx.setLineDash([]);
}

function drawDepthCurve(canvas, inv, size = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = size.width || canvas.clientWidth || 280;
  const H = size.height || 110;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const c = inv.curve;
  const lx = c.map((p) => Math.log10(p.depth));
  const m = c.map((p) => p.misfit);
  const x0 = Math.min(...lx); const x1 = Math.max(...lx);
  const lo = Math.min(...m); const hi = Math.max(...m) || 1;
  const Lp = 8; const Rp = 8; const T = 8; const B = 20;
  const X = (v) => Lp + ((v - x0) / (x1 - x0 || 1)) * (W - Lp - Rp);
  const Y = (v) => T + (1 - Math.sqrt((v - lo) / (hi - lo || 1))) * (H - T - B);
  ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  c.forEach((p, k) => (k ? ctx.lineTo(X(lx[k]), Y(m[k])) : ctx.moveTo(X(lx[k]), Y(m[k]))));
  ctx.stroke();
  ctx.fillStyle = "rgba(232,230,240,0.7)"; ctx.font = "10px 'Exo 2', sans-serif";
  ctx.fillText(fmtKm(c[0].depth), Lp, H - 5);
  const right = fmtKm(c.at(-1).depth);
  ctx.fillText(right, W - Rp - ctx.measureText(right).width, H - 5);
  const bx = X(Math.log10(inv.depth));
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(bx, T); ctx.lineTo(bx, H - B); ctx.stroke(); ctx.setLineDash([]);
}

/* ── facts shared by the cards and the report ──────────────────────────── */
function profileFacts(p) {
  const finite = [...p.series[0].values].filter(Number.isFinite);
  const out = [
    ["Length", p.length >= 5000 ? `${formatValue(p.length / 1000, p.length / 1000)} km` : `${formatValue(p.length, p.length)} m`],
    ["Inside the mesh", `${p.inside} of ${p.distance.length} samples`],
  ];
  // A break in the line is the mesh's own shape: above the ground, or a cavity.
  let gaps = 0;
  for (let k = 1; k < p.series[0].values.length; k += 1) if (Number.isFinite(p.series[0].values[k - 1]) && !Number.isFinite(p.series[0].values[k])) gaps += 1;
  if (gaps) out.push(["Breaks", `${gaps} — where the line leaves the mesh (above the ground, or through a cavity)`]);
  if (finite.length) {
    const lo = Math.min(...finite); const hi = Math.max(...finite);
    out.push(["Min", formatValue(lo, hi - lo)], ["Max", formatValue(hi, hi - lo)]);
  }
  out.push(["Lines", p.series.map((s, n) => `${n ? "dashed" : "solid"} ${s.name}`).join(", ")]);
  return out;
}

function statsTable(T) {
  const res = T.result;
  const unit = unitOf(T.label);
  const span = res.hi - res.lo || 1;
  const fmt = (v) => `${formatValue(v, span)}${unit ? ` ${unit}` : ""}`;
  return {
    heads: ["Flag", res.dim === 3 ? "Volume" : "Area", "Mean", "Std", "Min", "Max"],
    rows: res.domains.map((d) => [String(d.flag), formatMeasure(d.measure, res.dim), fmt(d.mean), fmt(d.std), fmt(d.min), fmt(d.max)]),
  };
}


function obsFacts(res) {
  const O = L.obs;
  const toUnit = UNIT_SCALE[O.unit] || 1;
  const mm = (v) => (Number.isFinite(v) ? `${formatValue(v * toUnit, Math.abs(v * toUnit) || 1)} ${O.unit}` : "—");
  const f = res.fit;
  const out = [
    ["Kind", res.kind === "gnss" ? "GNSS (east, north, up)" : `InSAR line of sight — heading ${res.geometry.heading}°, incidence ${res.geometry.incidence}°`],
    ["Stations", Object.entries(res.counts).map(([k, v]) => `${v} ${k}`).join(", ")],
    ["Components", `${f.n}${f.weighted ? ", weighted by their sigmas" : f.mixed ? " — some without a sigma, so none weighted" : ", unweighted"}`],
  ];
  if (O.fit) {
    out.push(["Best source scale", Number.isFinite(f.scale) ? `× ${Number(f.scale.toPrecision(4))}` : "— (the model is zero at every station)"]);
    out.push(["RMS misfit", `${mm(f.rms)} as solved → ${mm(f.rmsScaled)} scaled`]);
    if (f.weighted) out.push(["Reduced χ²", Number.isFinite(f.reducedChi2Scaled) ? Number(f.reducedChi2Scaled.toPrecision(3)).toString() : "—"]);
    if (Number.isFinite(f.explained)) out.push(["Explained", `${(f.explained * 100).toFixed(1)}% of the data${f.weighted ? " (weighted)" : ""}`]);
  } else out.push(["RMS misfit", `${mm(f.rms)} (as solved, not fitted)`]);
  return out;
}

/** The observation table: heads, and a row of cells per station (at most `cap`). */
function obsTable(res, cap = 200) {
  const O = L.obs;
  const toUnit = UNIT_SCALE[O.unit] || 1;
  const mm = (v) => (Number.isFinite(v) ? `${formatValue(v * toUnit, Math.abs(v * toUnit) || 1)} ${O.unit}` : "—");
  const heads = res.kind === "gnss" ? ["Station", "|obs|", "|model|", "|resid|", "up resid"] : ["Station", "obs", "model", "resid"];
  const shown = res.stations.slice(0, cap);
  const rows = shown.map((s, index) => {
    const m = res.model[index];
    if (!m) return { index, cells: [s.name, s.placed] };
    if (res.kind === "gnss") {
      const d = s.obs.map((v) => (Number.isFinite(v) ? v : 0));
      const r = s.obs.map((v, j) => (Number.isFinite(v) ? v - res.k * m[j] : 0));
      return { index, cells: [s.name, mm(Math.hypot(...d)), mm(Math.hypot(...m) * Math.abs(res.k)), mm(Math.hypot(...r)), Number.isFinite(s.obs[2]) ? mm(r[2]) : "—"] };
    }
    return { index, cells: [s.name, mm(s.obs[0]), mm(res.k * m[0]), mm(s.obs[0] - res.k * m[0])] };
  });
  return { heads, rows, shown };
}

function sourceFacts(res) {
  const out = [
    ["ΔV", `${fmtVol(res.dV)}${res.fitted ? " (fitted)" : ""}`],
    ["Peak |u|", `model ${formatValue(res.peakModel, res.peakModel || 1)} m · Mogi ${formatValue(res.peakMogi, res.peakMogi || 1)} m`],
    ["RMS difference", `${formatValue(res.rms, res.rms || 1)} m per component`],
  ];
  if (Number.isFinite(res.explained)) out.push(["Explained", res.explained > 0.0005 ? `${(res.explained * 100).toFixed(1)}% of the model surface` : "none — no better than no deformation at all"]);
  return out;
}

function inversionFacts(inv) {
  const out = [
    ["Inverted", inv.label],
    ["Source", `(${formatValue(inv.x0, 1000)}, ${formatValue(inv.y0, 1000)}) m, ${fmtKm(inv.depth)} deep`],
    ["ΔV", fmtVol(inv.dV)],
    [inv.weighted ? "√(χ²/n)" : "RMS", inv.weighted ? `${formatValue(inv.rms, inv.rms || 1)} — about 1 when the fit is as good as the sigmas allow` : `${formatValue(inv.rms, inv.rms || 1)} m per component`],
  ];
  if (inv.atEdge.depth || inv.atEdge.position) out.push(["Caution", `on the edge of the search (${[inv.atEdge.depth ? "depth" : "", inv.atEdge.position ? "position" : ""].filter(Boolean).join(", ")})`]);
  return out;
}

/* ── spreadsheet ────────────────────────────────────────────────────────── */

/**
 * The field shown in Results as a table of nodes, as ParaView's spreadsheet
 * view has it: node, coordinates, node flag, every component (and the
 * vector's length), sortable by any column, a page at a time. The numbers
 * are the solver's own at the nodes, not interpolated.
 */
export async function buildSheet() {
  const results = R();
  const S = results?.state;
  const G = L.sheet;
  const f = S?.fields?.[S.field];
  if (!S?.mesh || !f?.ok) { G.data = null; G.text = "Choose a field in Results first."; render(); return null; }
  if (G.busy) return null;
  G.busy = true;
  try {
    const values = await results.values(S.field, S.step);
    const desc = f.desc;
    const n = S.mesh.nodeCount;
    const nb = desc.nbDofs || values.length / n;
    const at = (i, j) => (desc.blocked ? values[j * n + i] : values[i * nb + j]);
    let rows = G.surfaceOnly ? usedNodes(S.mesh.surface, n) : Int32Array.from({ length: n }, (_, i) => i);
    if (G.selectionOnly && L.sel.ids?.length) { const keep = new Uint8Array(n); L.sel.ids.forEach((i) => { keep[i] = 1; }); rows = rows.filter((i) => keep[i]); }
    const cols = [
      { name: "node", get: (i) => i, int: true },
      { name: "x", get: (i) => S.mesh.coords[i * 3] },
      { name: "y", get: (i) => S.mesh.coords[i * 3 + 1] },
      { name: "z", get: (i) => S.mesh.coords[i * 3 + 2] },
      ...(S.mesh.nodeFlag ? [{ name: "flag", get: (i) => S.mesh.nodeFlag[i], int: true }] : []),
      ...desc.components.map((c, j) => ({ name: c.key, title: `${c.label}${c.unit ? ` (${c.unit})` : ""}`, get: (i) => at(i, j) })),
      ...(desc.vector ? [{ name: `|${desc.vector.label.split(" ")[0].toLowerCase()}|`, title: desc.vector.label, get: (i) => Math.hypot(...desc.vector.from.map((j) => at(i, j))) }] : []),
    ];
    G.data = { cols, rows, order: null, field: f.field, stepName: f.steps[S.step]?.name };
    G.key = signature();
    sortSheet();
    G.text = `${rows.length.toLocaleString()} ${G.selectionOnly && L.sel.ids?.length ? "selected " : ""}${G.surfaceOnly ? "surface " : ""}nodes of ${f.field} at t=${G.data.stepName}.`;
    return G.data;
  } catch (error) {
    G.data = null;
    G.text = `Could not build the table: ${error.message}`;
    return null;
  } finally {
    G.busy = false;
    render();
  }
}

/** Order the rows by a column; NaN always last, whichever way. */
function sortSheet() {
  const G = L.sheet;
  const d = G.data;
  if (!d) return;
  const col = d.cols[Math.min(G.sort, d.cols.length - 1)];
  const keys = new Float64Array(d.rows.length);
  for (let k = 0; k < d.rows.length; k += 1) keys[k] = col.get(d.rows[k]);
  const idx = Uint32Array.from({ length: d.rows.length }, (_, k) => k);
  const dir = G.dir;
  idx.sort((a, b) => {
    const x = keys[a]; const y = keys[b];
    if (x !== x) return y !== y ? 0 : 1;
    if (y !== y) return -1;
    return (x - y) * dir || a - b;
  });
  d.order = idx;
  G.page = 0;
}

function exportSheet() {
  const d = L.sheet.data;
  if (!d) return;
  const lines = [d.cols.map((c) => c.name).join(",")];
  for (let k = 0; k < d.order.length; k += 1) {
    const i = d.rows[d.order[k]];
    lines.push(d.cols.map((c) => { const v = c.get(i); return Number.isFinite(v) ? String(v) : ""; }).join(","));
  }
  downloadText(`nodes_${d.field.replace(/[^A-Za-z0-9]+/g, "_")}_t${String(d.stepName).replace(/[^A-Za-z0-9.]+/g, "")}.csv`, `${lines.join("\n")}\n`, "text/csv");
}

/* ── sweep response ─────────────────────────────────────────────────────── */

const projectStore = () => window.GeoIDResearch?.store;

/** The sweep manifests in the open project's fem_runs/. */
async function listSweeps() {
  const store = projectStore();
  if (!store?.getActive?.()) return [];
  try {
    const entries = await store.listProjectDir("fem_runs");
    return entries.filter((e) => e.kind !== "directory" && /_sweep\.json$/.test(e.name)).map((e) => `fem_runs/${e.name}`);
  } catch (error) {
    return [];
  }
}

/**
 * Read each run of a sweep at its last written step and reduce it to one
 * number: the peak over the mesh, or the value at a node. The node count comes
 * from the run open in Results -- a sweep shares one mesh, and a step file's
 * size alone cannot say how many dofs a node carries.
 */
export async function readSweep(path = L.sweep.path) {
  const W = L.sweep;
  const store = projectStore();
  const S = R()?.state;
  if (!store?.getActive?.()) { W.text = "Open the project the sweep was written into."; render(); return null; }
  if (!S?.mesh) { W.text = "Open one of the sweep's runs (or the base run) in Results first: its mesh gives the node count."; render(); return null; }
  if (W.busy) return null;
  W.busy = true;
  W.text = "Reading the runs…";
  render();
  try {
    const manifest = JSON.parse(await store.readProjectFile(path));
    if (manifest.kind !== "geoid-sweep") throw new Error(`${path} is not a sweep manifest.`);
    const n = S.mesh.nodeCount;
    const node = W.where === "probe" ? S.probe?.node : W.where === "node" ? Math.round(Number(W.node)) : null;
    if (W.where !== "peak" && !Number.isInteger(node)) throw new Error(W.where === "probe" ? "Probe a node in Results first." : "Type a node number.");
    const rows = [];
    let desc = null;
    for (const run of manifest.runs) {
      const folder = `${run.dir}/results/${W.field}`;
      let listing = [];
      try { listing = await store.listProjectDir(folder); } catch (error) { listing = []; }
      const steps = listing.map((e) => ({ name: e.name, time: timeOf(e.name) })).filter((e) => e.time !== null).sort((a, b) => a.time - b.time);
      if (!steps.length) { rows.push({ name: run.name, value: run.value, reading: null, note: "not solved" }); continue; }
      const last = steps.at(-1);
      const bytes = await store.readProjectFileBytes(`${folder}/${last.name}`);
      const values = float64View(bytes);
      const nb = values.length / n;
      if (!Number.isInteger(nb)) { rows.push({ name: run.name, value: run.value, reading: null, note: `${values.length} values: not this mesh` }); continue; }
      desc = desc || describeField(W.field, nb, S.mesh.dim);
      rows.push({ name: run.name, value: run.value, reading: stepReading(values, n, desc, { component: W.component, node }), step: last.name, note: "" });
    }
    const got = rows.filter((r) => Number.isFinite(r.reading));
    const fit = powerLawSlope(got.map((r) => r.value), got.map((r) => r.reading));
    const compLabel = W.component === "mag" ? (desc?.vector?.label || "magnitude") : (desc?.components?.[Number(W.component)]?.label || `component ${W.component}`);
    const unit = W.component === "mag" ? desc?.vector?.unit : desc?.components?.[Number(W.component)]?.unit;
    W.result = {
      path, manifest, rows, fit, node,
      reading: `${W.where === "peak" ? "Peak" : `At node ${node}`} · ${compLabel}${unit ? ` (${unit})` : ""} · ${W.field}`,
    };
    W.text = `${got.length} of ${rows.length} runs read${got.length < rows.length ? ` — ${rows.length - got.length} not solved or not on this mesh` : ""}.`;
    return W.result;
  } catch (error) {
    W.text = `Could not read the sweep: ${error.message}`;
    W.result = null;
    return null;
  } finally {
    W.busy = false;
    render();
  }
}

function drawSweep(canvas, res, size = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = size.width || canvas.clientWidth || 280;
  const H = size.height || 180;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const pts = res.rows.filter((r) => Number.isFinite(r.reading));
  if (!pts.length) return;
  const xs = pts.map((p) => p.value);
  const logX = xs.every((x) => x > 0) && Math.max(...xs) / Math.min(...xs) >= 10;
  const fx = (x) => (logX ? Math.log10(x) : x);
  let x0 = Math.min(...xs.map(fx)); let x1 = Math.max(...xs.map(fx));
  if (x1 === x0) { x0 -= 1; x1 += 1; }
  const ys = pts.map((p) => p.reading);
  let y0 = Math.min(0, ...ys); let y1 = Math.max(0, ...ys);
  if (y1 === y0) y1 = y0 + 1;
  const Lp = 48; const Rp = 10; const T = 10; const B = 24;
  const X = (x) => Lp + ((fx(x) - x0) / (x1 - x0)) * (W - Lp - Rp);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  ctx.font = "10px 'Exo 2', sans-serif";
  ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.fillStyle = "rgba(232,230,240,0.6)";
  niceTicks(y0, y1, 4).forEach((v) => { ctx.beginPath(); ctx.moveTo(Lp, Y(v)); ctx.lineTo(W - Rp, Y(v)); ctx.stroke(); ctx.fillText(formatValue(v, y1 - y0), 2, Y(v) + 3); });
  pts.forEach((p, k) => {
    const t = formatValue(p.value, Math.abs(p.value) || 1);
    const w = ctx.measureText(t).width;
    if (k === 0 || k === pts.length - 1 || pts.length <= 6) ctx.fillText(t, Math.min(W - Rp - w, Math.max(Lp, X(p.value) - w / 2)), H - 6);
  });
  ctx.strokeStyle = "#ff2bd6"; ctx.lineWidth = 1.6;
  ctx.beginPath();
  pts.forEach((p, k) => (k ? ctx.lineTo(X(p.value), Y(p.reading)) : ctx.moveTo(X(p.value), Y(p.reading))));
  ctx.stroke();
  ctx.fillStyle = "#52e4e8";
  pts.forEach((p) => { ctx.beginPath(); ctx.arc(X(p.value), Y(p.reading), 3, 0, Math.PI * 2); ctx.fill(); });
}

function sweepFacts(res) {
  const f = res.fit;
  return [
    ["Varied", `${res.manifest.label} (${res.manifest.parameter})`],
    ["Reading", res.reading],
    ["Runs", `${res.rows.filter((r) => Number.isFinite(r.reading)).length} of ${res.rows.length} solved`],
    ["Sensitivity", Number.isFinite(f.slope) ? `response ∝ parameter^${Number(f.slope.toPrecision(3))} (R² ${Number(f.r2.toPrecision(3))}, ${f.n} runs)` : "— (needs two solved runs with a positive parameter)"],
  ];
}

function exportSweep() {
  const res = L.sweep.result;
  if (!res) return;
  const lines = [`# ${res.manifest.label} (${res.manifest.parameter})`, `# ${res.reading}`, "run,value,reading,step,note"];
  res.rows.forEach((r) => lines.push([r.name, r.value, Number.isFinite(r.reading) ? r.reading : "", r.step || "", `"${r.note || ""}"`].join(",")));
  downloadText(`sweep_${res.manifest.base}_${L.sweep.field.replace(/[^A-Za-z0-9]+/g, "_")}.csv`, `${lines.join("\n")}\n`, "text/csv");
}

/* ── saved state ────────────────────────────────────────────────────────── */

function analysisState() {
  const S = R()?.state;
  const fieldName = (i) => S?.fields?.[i]?.field || null;
  return {
    line: { a: L.a, b: L.b, samples: L.samples, compare: L.compare, plotted: Boolean(L.profile) },
    glyph: { on: L.glyph.on, field: fieldName(L.glyph.field), count: L.glyph.count, scale: L.glyph.scale },
    stats: { open: L.stats.open, computed: Boolean(L.stats.result) },
    obs: { open: L.obs.open, raw: L.obs.raw, unit: L.obs.unit, fit: L.obs.fit, arrows: L.obs.arrows, compared: Boolean(L.obs.result) },
    src: { open: L.src.open, x0: L.src.x0, y0: L.src.y0, depth: L.src.depth, dV: L.src.dV, nu: L.src.nu, mode: L.src.mode, dP: L.src.dP, radius: L.src.radius, E: L.src.E, fitDV: L.src.fitDV, compared: Boolean(L.src.result), inverted: L.src.inversion?.what || null },
    sheet: { open: L.sheet.open, surfaceOnly: L.sheet.surfaceOnly, sort: L.sheet.sort, dir: L.sheet.dir, size: L.sheet.size },
    sweep: { open: L.sweep.open, path: L.sweep.path, field: L.sweep.field, component: L.sweep.component, where: L.sweep.where, node: L.sweep.node, read: Boolean(L.sweep.result) },
    secondView: window.GeoIDSecondView?.isOpen?.() ? { field: window.GeoIDSecondView.state.field, component: window.GeoIDSecondView.state.component } : null,
    stream: { on: L.stream.on, field: fieldName(L.stream.field), seed: L.stream.seed, count: L.stream.count, radius: L.stream.radius, stepPer: L.stream.stepPer, lengthPer: L.stream.lengthPer, direction: L.stream.direction },
    media: { kind: L.media.kind, hold: L.media.hold, seconds: L.media.seconds, width: L.media.width },
    report: { title: L.report.title },
  };
}

function cameraState() {
  const v = window.GeoIDViewer;
  if (!v?.camera) return null;
  return { position: v.camera.position.toArray(), target: v.controls?.target ? v.controls.target.toArray() : [0, 0, 0] };
}

/** The whole page's state: the Results display, the camera and the analyses. */
export function currentState(note = "") {
  return makeState({ results: R()?.getState?.() || null, analysis: analysisState(), camera: cameraState(), note });
}

export async function saveState({ download = true, project = true } = {}) {
  const Z = L.state;
  if (!may("save")) { Z.text = refusal("save"); render(); return null; }
  const state = currentState();
  if (!state.results) { Z.text = "Open a run in Results first: a state is applied to a run."; render(); return null; }
  const text = JSON.stringify(state, null, 2);
  const name = stateFileName(state);
  const said = [];
  const store = window.GeoIDResearch?.store;
  if (project && store?.getActive?.()) {
    try { await store.writeProjectFile(`post_processing/${name}`, text); said.push(`post_processing/${name} in the project`); } catch (error) { said.push(`not filed in the project (${error.message})`); }
  }
  if (download) { downloadText(name, text, "application/json", { project: false }); said.push("downloaded"); }
  Z.text = `Saved: ${said.join(", ")}.`;
  render();
  return { state, text, name };
}

async function listProjectStates() {
  const Z = L.state;
  const store = window.GeoIDResearch?.store;
  if (!store?.getActive?.()) { Z.text = "Open a project first: states are filed in its post_processing/."; render(); return; }
  try {
    const entries = await store.listProjectDir("post_processing");
    Z.saved = entries.map((e) => (typeof e === "string" ? e : e.name)).filter((n) => /^model_state_.*\.json$/.test(n)).sort().reverse();
    Z.text = Z.saved.length ? `${Z.saved.length} saved state${Z.saved.length > 1 ? "s" : ""} in this project.` : "No saved states in this project yet.";
  } catch (error) { Z.text = `Could not list the project's states: ${error.message}`; }
  render();
}

/** Apply a saved state to the run open now: Results first, then the camera, then each analysis that had a result. */
export async function loadState(input) {
  const Z = L.state;
  const got = readState(input);
  if (got.error) { Z.text = got.error; render(); return null; }
  const st = got.state;
  const results = R();
  if (!results?.state?.mesh) { Z.text = "Open the run the state belongs to first, then load the state."; render(); return null; }
  Z.busy = true;
  Z.text = "Applying the state…";
  render();
  const notes = [];
  try {
    if (st.results) {
      const applied = await results.applyState(st.results);
      notes.push(...(applied?.notes || []));
      if (st.results.run && results.state.source?.label && st.results.run !== results.state.source.label) notes.push(`Saved on ${st.results.run}; applied to ${results.state.source.label}.`);
    }
    const v = window.GeoIDViewer;
    if (st.camera && v?.camera) {
      v.camera.position.fromArray(st.camera.position);
      if (v.controls?.target) { v.controls.target.fromArray(st.camera.target); v.controls.update?.(); }
      v.camera.lookAt(...st.camera.target);
    }
    const a = st.analysis || {};
    const S = results.state;
    if (a.line) { L.a = a.line.a; L.b = a.line.b; L.samples = a.line.samples; L.compare = a.line.compare; L.locatedKey = ""; drawLine(); }
    if (a.glyph) { const gi = a.glyph.field ? S.fields.findIndex((f) => f.field === a.glyph.field) : -1; Object.assign(L.glyph, { on: a.glyph.on, field: gi, count: a.glyph.count, scale: a.glyph.scale }); }
    if (a.obs) Object.assign(L.obs, { open: a.obs.open, raw: a.obs.raw || "", unit: a.obs.unit, fit: a.obs.fit, arrows: a.obs.arrows });
    if (a.src) Object.assign(L.src, { open: a.src.open, x0: a.src.x0, y0: a.src.y0, depth: a.src.depth, dV: a.src.dV, nu: a.src.nu, mode: a.src.mode, dP: a.src.dP, radius: a.src.radius, E: a.src.E, fitDV: a.src.fitDV });
    if (a.sheet) Object.assign(L.sheet, { open: a.sheet.open, surfaceOnly: a.sheet.surfaceOnly, sort: a.sheet.sort, dir: a.sheet.dir, size: a.sheet.size });
    if (a.sweep) Object.assign(L.sweep, { open: a.sweep.open, path: a.sweep.path, field: a.sweep.field, component: a.sweep.component, where: a.sweep.where, node: a.sweep.node });
    if (a.media) Object.assign(L.media, a.media);
    if (a.stream) { const si = a.stream.field ? S.fields.findIndex((f) => f.field === a.stream.field) : -1; Object.assign(L.stream, { ...a.stream, field: si }); }
    if (a.report) L.report.title = a.report.title || "";
    if (a.stats) L.stats.open = a.stats.open;
    // Re-run what had a result, in the order the page makes them.
    if (a.line?.plotted) await plot();
    if (L.glyph.on) await drawGlyphs();
    if (L.stream.on) await traceStream();
    if (a.secondView && window.GeoIDSecondView) { window.GeoIDSecondView.open(); await window.GeoIDSecondView.set(a.secondView); } else if (a.secondView === null) window.GeoIDSecondView?.close?.();
    if (a.stats?.computed) await computeStats();
    if (a.obs?.compared) await compareObservations();
    if (a.src?.inverted) await invertSource(a.src.inverted);
    else if (a.src?.compared) await compareSource();
    if (a.sheet?.open) await buildSheet();
    if (a.sweep?.read && a.sweep.path) await readSweep(a.sweep.path);
    Z.text = `State applied (saved ${st.saved_at}).${notes.length ? ` ${notes.join(" ")}` : ""}`;
    return { state: st, notes };
  } catch (error) {
    Z.text = `Could not apply the state: ${error.message}`;
    return null;
  } finally {
    Z.busy = false;
    render();
  }
}

/* ── the hand-off to the Research hub ───────────────────────────────────── */

/**
 * WHAT THIS PAGE HAS FILED FOR THE RESEARCH HUB, counted from the project:
 * series in post_processing/extracted_dofs/ (the Signal and Spectral pages
 * list them), tables in exports/ (every CSV a card writes), figures/ (the
 * screenshots) and the saved page states. The counts are the bridge made
 * visible: a reader can see that the profile they exported is a table the
 * Statistics page will offer, and go there in one press.
 */
const HANDOFF_PAGES = [
  ["Signal Processing", "Signal", "time series: filters, spectra, event detection"],
  ["Spectral Analysis", "Spectral", "spectrograms and wavelets of a series"],
  ["Statistics", "Statistics", "tests, PCA and clustering over a table"],
  ["CSV Plotter", "Plotter", "plot any exported table"],
  ["Figure Composer", "Figures", "compose the filed screenshots into figures"],
];

export async function handoffCounts({ force = false } = {}) {
  const H = L.handoff;
  const store = window.GeoIDResearch?.store;
  const active = store?.getActive?.();
  H.project = active?.meta?.name || active?.name || "";
  if (!active || !store.listProjectDir) { H.counts = null; return null; }
  if (!force && H.counts && Date.now() - H.at < 5000) return H.counts;
  if (H.busy) return H.counts;
  H.busy = true;
  try {
    const count = async (dir, test = () => true) => { try { return (await store.listProjectDir(dir)).filter((e) => e.kind !== "directory" && test(e.name)).length; } catch (e) { return 0; } };
    H.counts = {
      series: await count("post_processing/extracted_dofs", (n) => /\.(csv|tsv|txt)$/i.test(n)),
      tables: await count("exports", (n) => /\.(csv|tsv|txt)$/i.test(n)),
      figures: await count("figures", (n) => /\.(png|jpe?g|webp|svg)$/i.test(n)),
      reports: await count("exports", (n) => /\.html?$/i.test(n)),
      states: await count("post_processing", (n) => /^model_state_.*\.json$/.test(n)),
    };
    H.at = Date.now();
    return H.counts;
  } finally { H.busy = false; }
}

/** Filed anything at all: the pipeline strip's Research step lights on it. */
export function handoffFiled() {
  const c = L.handoff.counts;
  return c ? c.series + c.tables + c.figures + c.reports : 0;
}

export function goResearch(pageId = "") {
  window.GeoIDModeManager?.setMode?.("research");
  if (pageId) setTimeout(() => window.GeoIDResearch?.setPage?.(pageId), 350);
}

function renderHandoff(host) {
  const H = L.handoff;
  const cardH = card("Hand-off to Research", true);
  cardH.details.classList.add("ra-handoff");
  const c = H.counts;
  if (!H.project) {
    cardH.body.append(note("No project is open, so what this page writes goes to the downloads folder only. Open a project on the Research hub's Projects page and every CSV, series, figure and report from here is filed into it, where the Research pages read."));
  } else {
    cardH.body.append(note(`Filed in ${H.project} from this page and the GIS page — what the Research pages will offer.`));
    const facts = el("div", { class: "ra-handoff-counts" });
    const items = [["series", "time series", "post_processing/extracted_dofs/ — points over time"], ["tables", "tables", "exports/ — profiles, statistics, selections, sweeps"], ["figures", "figures", "figures/ — screenshots and plots"], ["reports", "reports", "exports/ — the model report"], ["states", "saved states", "post_processing/ — the page as it stood"]];
    for (const [key, label, title] of items) facts.append(el("div", { class: "ra-handoff-count", title }, el("b", {}, c ? String(c[key]) : "…"), el("span", {}, label)));
    cardH.body.append(facts);
  }
  const doors = el("div", { class: "ra-handoff-doors" });
  for (const [id, label, blurb] of HANDOFF_PAGES) {
    const b = el("button", { class: "studio-secondary", type: "button", title: `${id}: ${blurb}` }, `${label} →`);
    b.addEventListener("click", () => goResearch(id));
    doors.append(b);
  }
  cardH.body.append(doors);
  host.append(cardH.details);
  handoffCounts().then((counts) => { if (counts !== c) render(); });
}

/* ── the model report ───────────────────────────────────────────────────── */

const sci = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : String(Number(v.toPrecision(6)))) : "—");

/** A figure drawn fresh at print size, off screen, as a PNG data URL. */
function figureOf(draw, data, size = { width: 720, height: 240 }) {
  const canvas = document.createElement("canvas");
  draw(canvas, data, size);
  return canvas.toDataURL("image/png");
}

/** The colour scale of the view, drawn for print: the page's legend is an overlay the snapshot does not hold. */
/** A colour bar drawn into a context: the scale, its label and round ticks, in the ink given. */
function drawColourBar(ctx, { x0, x1, y, table, lo, hi, label, ink = "#222", line = "#666" }) {
  const steps = table.length / 3;
  for (let k = 0; k < steps; k += 1) {
    ctx.fillStyle = `rgb(${Math.round(table[k * 3] * 255)},${Math.round(table[k * 3 + 1] * 255)},${Math.round(table[k * 3 + 2] * 255)})`;
    ctx.fillRect(x0 + ((x1 - x0) * k) / steps, y + 18, (x1 - x0) / steps + 1, 14);
  }
  ctx.strokeStyle = line; ctx.strokeRect(x0, y + 18, x1 - x0, 14);
  ctx.fillStyle = ink; ctx.font = "12px sans-serif";
  ctx.fillText(label, x0, y + 13);
  niceTicks(lo, hi, 6).forEach((v) => {
    const x = x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0);
    if (x < x0 - 0.5 || x > x1 + 0.5) return;
    const t = formatValue(v, hi - lo || 1);
    const w = ctx.measureText(t).width;
    ctx.fillRect(x, y + 32, 1, 4);
    ctx.fillText(t, Math.min(x1 - w, Math.max(x0, x - w / 2)), y + 48);
  });
}

/** The colour scale of the view, drawn for print: the page's legend is an overlay the snapshot does not hold. */
function colourBar(table, lo, hi, label) {
  const W = 720; const H = 52;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  drawColourBar(ctx, { x0: 10, x1: W - 10, y: 0, table, lo, hi, label });
  return c.toDataURL("image/png");
}

/* ── screenshot and animation ───────────────────────────────────────────── */

/**
 * One frame of the view with a footer carrying what a screen legend would:
 * the field, the time and the colour scale. Drawn into `canvas` (sized here),
 * straight after a render, since the WebGL buffer is not kept between frames.
 */
function composeFrame(canvas, { width = 0, footer = 64 } = {}) {
  const viewer = window.GeoIDViewer;
  const results = R();
  const S = results?.state;
  if (!viewer?.renderer || !S?.mesh) return false;
  viewer.renderer.render(viewer.scene, viewer.camera);
  const src = viewer.renderer.domElement;
  const scale = width ? width / src.width : 1;
  const W = Math.round(src.width * scale) & ~1; // even, as a video encoder wants
  const viewH = Math.round(src.height * scale) & ~1;
  if (canvas.width !== W || canvas.height !== viewH + footer) { canvas.width = W; canvas.height = viewH + footer; }
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0d0a1c"; ctx.fillRect(0, 0, W, viewH + footer);
  ctx.drawImage(src, 0, 0, W, viewH);
  const f = S.fields[S.field];
  const label = f?.ok ? results.componentLabel() : "geometry";
  ctx.fillStyle = "#e8e6f0"; ctx.font = "600 14px sans-serif";
  const title = f?.ok ? `${f.field} · t = ${f.steps[S.step]?.name}` : S.meshPath;
  ctx.fillText(title, 12, viewH + 22);
  if (f?.ok) {
    const [lo, hi] = S.range;
    drawColourBar(ctx, { x0: Math.max(W * 0.45, ctx.measureText(title).width + 30), x1: W - 14, y: viewH + 8, table: results.colormap(), lo, hi, label, ink: "#e8e6f0", line: "#888" });
  }
  return true;
}

export async function screenshot({ width = 0, download = true } = {}) {
  const P = L.media;
  if (download && !may("save")) { P.text = refusal("save"); render(); return null; }
  const canvas = document.createElement("canvas");
  if (!composeFrame(canvas, { width })) { P.text = "Open a run in Results first."; render(); return null; }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const S = R().state;
  const f = S.fields[S.field];
  const name = `results_${(f?.field || "mesh").replace(/[^A-Za-z0-9]+/g, "_")}_t${String(f?.steps[S.step]?.name ?? "").replace(/[^A-Za-z0-9.]+/g, "")}.png`;
  if (download) saveBlob(name, blob);
  // A figure belongs to the project's figures/, where the Storyboard and the
  // Figure Composer read, not only to the downloads folder.
  const filed = download ? await fileFigure(name, blob, `Model page — ${f?.field || "mesh"} at t=${f?.steps[S.step]?.name ?? ""}`) : null;
  P.text = `${name} — ${canvas.width} × ${canvas.height}${filed ? `, filed as ${filed}` : ""}.`;
  render();
  return { blob, width: canvas.width, height: canvas.height, name };
}

async function fileFigure(name, blob, source) {
  const store = window.GeoIDResearch?.store;
  if (!store?.getActive?.()) return null;
  try {
    await store.writeProjectFile(`figures/${name}`, blob);
    await store.registerData?.({ name, kind: "figure", path: `figures/${name}`, source });
    L.handoff.at = 0;
    return `figures/${name}`;
  } catch (error) { return null; }
}

function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Record the view as a WebM: every step of the field shown, each held for
 * `hold` seconds ("steps"), or one turn round the model over `seconds`
 * ("turntable"). Frames are pushed by hand (captureStream(0) + requestFrame)
 * after each render, so a slow step read does not drop frames or stretch the
 * clip: what is recorded is exactly the frames drawn.
 */
export async function recordAnimation({ kind = L.media.kind, hold = L.media.hold, seconds = L.media.seconds, fps = 24, width = L.media.width, download = true } = {}) {
  const P = L.media;
  const results = R();
  const S = results?.state;
  const viewer = window.GeoIDViewer;
  if (!S?.mesh || !viewer?.renderer) { P.text = "Open a run in Results first."; render(); return null; }
  if (download && !may("save")) { P.text = refusal("save"); render(); return null; }
  if (typeof MediaRecorder === "undefined") { P.text = "This browser cannot record video (no MediaRecorder)."; render(); return null; }
  if (P.busy) return null;
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) { P.text = "This browser records no WebM."; render(); return null; }
  P.busy = true; P.cancel = false;
  const canvas = document.createElement("canvas");
  composeFrame(canvas, { width });
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6e6 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start();
  const frame = async () => { composeFrame(canvas, { width }); track.requestFrame?.(); await wait(1000 / fps); };
  const keepStep = S.step;
  const cam = viewer.camera.position.clone();
  const target = viewer.controls?.target?.clone();
  let frames = 0;
  try {
    const f = S.fields[S.field];
    if (kind === "steps" && f?.ok) {
      for (let k = 0; k < f.steps.length && !P.cancel; k += 1) {
        S.step = k;
        await results.refresh();
        P.text = `Recording step ${k + 1} of ${f.steps.length}…`; sayMedia();
        for (let h = 0; h < Math.max(1, Math.round(hold * fps)) && !P.cancel; h += 1) { await frame(); frames += 1; }
      }
    } else {
      const centre = target || new THREE.Vector3();
      const rel = cam.clone().sub(centre);
      const total = Math.max(2, Math.round(seconds * fps));
      for (let k = 0; k <= total && !P.cancel; k += 1) {
        const a = (2 * Math.PI * k) / total;
        viewer.camera.position.set(centre.x + rel.x * Math.cos(a) - rel.z * Math.sin(a), centre.y + rel.y, centre.z + rel.x * Math.sin(a) + rel.z * Math.cos(a));
        viewer.camera.lookAt(centre);
        if (k % fps === 0) { P.text = `Recording the turn: ${Math.round((k / total) * 100)}%…`; sayMedia(); }
        await frame(); frames += 1;
      }
    }
  } finally {
    recorder.stop();
    await done;
    track.stop();
    viewer.camera.position.copy(cam);
    if (target) { viewer.controls.target.copy(target); viewer.camera.lookAt(target); viewer.controls.update?.(); }
    if (S.step !== keepStep) { S.step = keepStep; await results.refresh(); }
    P.busy = false;
  }
  const blob = new Blob(chunks, { type: "video/webm" });
  const f = S.fields[S.field];
  const name = `results_${(f?.field || "mesh").replace(/[^A-Za-z0-9]+/g, "_")}_${kind}.webm`;
  if (download && blob.size) saveBlob(name, blob);
  P.text = P.cancel ? `Stopped: ${frames} frames kept in ${name}.` : `${name} — ${frames} frames at ${fps} fps, ${(blob.size / 1048576).toFixed(1)} MB, ${canvas.width} × ${canvas.height}.`;
  render();
  return { blob, frames, fps, width: canvas.width, height: canvas.height, name, mime };
}

function sayMedia() {
  const node = byId("ra-media-status");
  if (node) node.textContent = L.media.text;
}

/** The 3D view as it stands, downscaled to print width. */
function viewSnapshot() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.renderer) return null;
  try {
    viewer.renderer.render(viewer.scene, viewer.camera);
    const src = viewer.renderer.domElement;
    const scale = Math.min(1, 1400 / src.width);
    const out = document.createElement("canvas");
    out.width = Math.round(src.width * scale); out.height = Math.round(src.height * scale);
    out.getContext("2d").drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.9);
  } catch (error) {
    return null;
  }
}

/** The report's data: everything formatted as the cards format it. Answers the object modelReportHtml lays out. */
export async function buildModelReport({ title } = {}) {
  const results = R();
  const S = results?.state;
  if (!S?.mesh) throw new Error("Open a run in Results first.");
  const f = S.fields[S.field];
  const mesh = S.mesh;
  const b = mesh.bounds;
  const span = (a) => fmtKm(b.max[a] - b.min[a]);
  const runName = S.meshPath || "run";
  const r = {
    title: title || L.report.title || `${runName.split("/").slice(-3, -2)[0] || runName} — ${f?.desc?.label || f?.field || "results"}`,
    generated: new Date().toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }),
    run: `${runName}${f ? ` · ${f.field} · t=${f.steps[S.step]?.name}` : ""}`,
    methods: [], citations: [],
  };
  r.cards = [
    [mesh.nodeCount.toLocaleString(), "nodes"],
    [(mesh.cellCount ?? mesh.tets ?? 0).toLocaleString(), "elements"],
  ];

  // Setup: only where the Model page carries one, and said to be the page's.
  const FS = window.GeoIDFemSetup;
  const setup = FS?.setup;
  const targets = FS?.targets?.();
  if (setup && (Object.keys(setup.materials || {}).length || Object.keys(setup.conditions || {}).length)) {
    const P = PHYSICS[setup.physics];
    const summary = FS.summary?.();
    const materials = (targets?.domains || []).filter((d) => !d.void).map((d) => {
      const a = setup.materials?.[d.flag];
      const props = domainProperties(a);
      return [String(d.flag), a?.id ? `${d.name} — ${a.id}` : `${d.name} — no material`, sci(props.rho), sci(props.E), sci(props.nu)];
    });
    const conditions = Object.entries(setup.conditions || {}).filter(([, c]) => c?.type && c.type !== "free").map(([flag, c]) => {
      const face = (targets?.faces || []).find((x) => Number(x.flag) === Number(flag));
      const values = Object.entries(c.values || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined).map(([k, v]) => `${k} = ${v}`).join(", ");
      return [String(flag), `${P?.conditions?.[c.type]?.label || c.type}${face ? ` (${face.name})` : ""}`, values];
    });
    r.setup = {
      physics: P?.label || setup.physics,
      study: [["Study", `${setup.study?.name || ""} · ${setup.study?.kind || ""}, end ${setup.study?.end}, step ${setup.study?.step}`], ["Note", "The setup on the Model page when this report was made; confirm it is the one the run was written from."]],
      materials, conditions,
      pointwise: setup.pointwise?.file ? `Material read pointwise from ${setup.pointwise.file} (heterogeneous_pointwise).` : "",
      issues: (summary?.issues || []).map((i) => ({ level: i.level, text: i.text })),
    };
  }

  r.mesh = {
    facts: [
      ["Format", `${mesh.format || "—"}, ${mesh.dim}D`],
      ["Nodes", mesh.nodeCount.toLocaleString()],
      ["Elements", `${(mesh.cellCount ?? 0).toLocaleString()}${mesh.tets ? ` (${mesh.tets.toLocaleString()} tetrahedra)` : ""}`],
      ["Boundary sides", (mesh.sideCount ?? 0).toLocaleString()],
      ["Extent", `${span(0)} × ${span(1)} × ${span(2)}`],
      ["Bounds (m)", `x ${formatValue(b.min[0], 1000)}…${formatValue(b.max[0], 1000)}, y ${formatValue(b.min[1], 1000)}…${formatValue(b.max[1], 1000)}, z ${formatValue(b.min[2], 1000)}…${formatValue(b.max[2], 1000)}`],
    ],
    domains: L.stats.result ? L.stats.result.domains.map((d) => [String(d.flag), d.cells.toLocaleString(), formatMeasure(d.measure, L.stats.result.dim)]) : null,
  };

  if (f?.ok) {
    const values = await results.values(S.field, S.step);
    const scalar = (results.samplingScalar || results.scalar)(values);
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < scalar.length; i += 1) { const v = scalar[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const label = results.componentLabel();
    r.cards.push([`${formatValue(lo, hi - lo || 1)} … ${formatValue(hi, hi - lo || 1)}`, label], [String(f.steps[S.step]?.name), `step of ${f.steps.length}`]);
    r.view = {
      facts: [
        ["Field", `${f.desc?.label || f.field} (${f.field})`],
        ...(f.compare && S.reference ? [["Reference run", S.reference.note]] : []),
        ...(() => {
          const d = results.display?.() || {};
          return [
            ...(d.contours?.length ? [["Contour lines", d.contours.map((v) => formatValue(v, Math.abs(v) || 1)).join(", ")]] : []),
            ...(d.iso?.length ? [["Isosurfaces", d.iso.map((v) => formatValue(v, Math.abs(v) || 1)).join(", ")]] : []),
          ];
        })(),
        ["Shown", label],
        ["Step", `t=${f.steps[S.step]?.name} (${S.step + 1} of ${f.steps.length})`],
        ["Range at this step", `${formatValue(lo, hi - lo || 1)} to ${formatValue(hi, hi - lo || 1)}`],
        ["Colour map", `${S.colormap}${S.reverse ? ", reversed" : ""}`],
        ...(S.deform?.on ? [["Deformed", `× ${formatValue(S.deform.scale, S.deform.scale)} by ${S.fields[S.deform.field]?.field}`]] : []),
        ...(S.component === "los" || S.component === "fringe" ? [["Satellite", `heading ${S.insar.heading}°, incidence ${S.insar.incidence}°, λ ${S.insar.wavelength} m, ${S.insar.look}-looking`]] : []),
      ],
      image: viewSnapshot(),
      bar: colourBar(results.colormap(), lo, hi, label),
      caption: `${label}, t=${f.steps[S.step]?.name}, as drawn on the Model page`,
    };
    r.methods.push("Results are the solver's own binary output (little-endian float64, one value per dof per node), read against the mesh GALES was run on; nothing is re-solved on the page.");
    if (f.compare) {
      r.methods.push("The field shown is a DIFFERENCE: this run's step minus the reference run's step at the same time (the latest at or before it), node for node. It is meaningful only when both runs share one mesh and its node numbering.");
    }
    if (/^derived\//.test(f.field)) {
      r.methods.push("Stress, strain and tilt are derived from the displacement: the gradient ∇u is constant in each linear tetrahedron; strain ε = sym(∇u), stress σ = λ tr(ε) I + 2μ ε with the run's own props.txt material, and ground tilt (∂u_z/∂x, ∂u_z/∂y) in radians; element values are averaged to nodes by volume.");
    }
    if (S.component === "los" || S.component === "fringe") {
      r.methods.push("Line of sight is u · ê with ê the unit vector from the ground to the satellite, (sin i sin a, sin i cos a, cos i), a = heading − 90° for a right-looking radar; positive toward the satellite. A fringe is λ/2 of range change, wrapped after interpolation.");
    }
  }

  if (L.profile) {
    r.profile = {
      facts: [["Line", `(${L.a.map((v) => formatValue(v, 1000)).join(", ")}) → (${L.b.map((v) => formatValue(v, 1000)).join(", ")}) m`], ...profileFacts(L.profile)],
      image: figureOf(drawProfile, L.profile),
      caption: `${L.profile.label || L.profile.field} along the line`,
    };
    r.methods.push("Plot over line: each sample is located in its element and the element's nodal values weighted barycentrically, exact for a first-order mesh; samples outside the mesh are left blank.");
  }
  if (L.stats.result?.domains.length) {
    const st = statsTable(L.stats);
    r.stats = { label: `${L.stats.label} · ${L.stats.field} · t=${L.stats.stepName}`, heads: st.heads, rows: st.rows, image: figureOf(drawStatsHistogram, L.stats.result, { width: 720, height: 200 }) };
    r.methods.push("Statistics by domain: each element takes the mean of its nodes (exact for a linear element's integral), weighted by its volume; min and max are over the domain's nodes.");
  }
  if (L.obs.result) {
    const res = L.obs.result;
    const { heads, rows } = obsTable(res, 60);
    r.observations = {
      facts: [["Compared against", `${res.field} at t=${res.stepName}`], ...obsFacts(res)],
      heads, rows: rows.map((row) => (row.cells.length === 2 && !res.model[row.index] ? [row.cells[0], row.cells[1], ...Array(heads.length - 2).fill("")] : row.cells)),
      more: res.stations.length > 60 ? `The first 60 of ${res.stations.length} stations; the CSV export holds them all.` : "",
    };
    r.methods.push("Observations: a station with a height is interpolated in its element; one without, or outside the mesh vertically, reads the highest surface node among those horizontally nearest; one beyond the mesh's plan extent is not placed. The source-strength scale is k = Σ w d m / Σ w m², w = 1/σ² when every component carries a sigma.");
  }
  if (L.sweep.result) {
    const res = L.sweep.result;
    r.sweep = {
      facts: sweepFacts(res),
      image: figureOf(drawSweep, res),
      heads: ["Run", "Value", "Reading", "Step"],
      rows: res.rows.map((x) => [x.name, formatValue(x.value, Math.abs(x.value) || 1), Number.isFinite(x.reading) ? formatValue(x.reading, Math.abs(x.reading) || 1) : x.note, x.step || "—"]),
    };
    r.methods.push("Parameter sweep: one study per value of the varied parameter, everything else as set; each run's last written step is reduced to one number (the largest absolute value over the mesh, or the value at a node), and the sensitivity is the least-squares slope of log|reading| on log(value).");
  }
  if (L.src.result) {
    r.source = {
      facts: [["Source", `(${formatValue(L.src.x0, 1000)}, ${formatValue(L.src.y0, 1000)}) m, ${fmtKm(L.src.depth)} below z = ${formatValue(L.src.surfaceZ, 1000)} m, ν = ${L.src.nu}`], ...sourceFacts(L.src.result)],
      image: figureOf(drawSourcePlot, L.src.result),
      inversion: L.src.inversion ? inversionFacts(L.src.inversion) : null,
      curveImage: L.src.inversion ? figureOf(drawDepthCurve, L.src.inversion, { width: 720, height: 160 }) : null,
    };
    r.methods.push("Mogi source: surface displacement of a point pressure source in a uniform elastic half-space, u = (1 − ν) ΔV / π · (dx, dy, d) / R³; ΔV = π a³ ΔP / G for a sphere. Inversion by grid search over position and log-spaced depth, refined five times, with ΔV solved by least squares at every trial.");
    r.citations.push("Mogi, K. (1958). Relations between the eruptions of various volcanoes and the deformations of the ground surfaces around them. Bulletin of the Earthquake Research Institute, 36, 99–134.");
    r.citations.push("Segall, P. (2010). Earthquake and Volcano Deformation. Princeton University Press.");
  }
  return r;
}

export async function openModelReport({ print = false, download = false } = {}) {
  const Q = L.report;
  if (!may("save")) { Q.text = refusal("save"); render(); return null; }
  Q.busy = true;
  Q.text = "Gathering the report…";
  sayReport();
  try {
    const data = await buildModelReport();
    const html = modelReportHtml(data);
    const name = `model_report_${(data.title || "run").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 60)}.html`;
    if (download) {
      downloadText(name, html, "text/html");
      Q.text = `${name} downloaded — open it in a browser to print.`;
    } else {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const w = window.open(`${url}${print ? "#print" : ""}`, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      try { window.GeoIDResearch?.bridge?.saveExport?.(name, html); } catch (error) { /* no project open */ }
      Q.text = w ? `Opened: ${reportSectionCount(data)} sections. Print or save as PDF from its toolbar.` : "The browser blocked the report window: allow pop-ups for this site, or download the HTML.";
    }
    return { data, html };
  } catch (error) {
    Q.text = `Could not make the report: ${error.message}`;
    return null;
  } finally {
    Q.busy = false;
    render();
  }
}

const reportSectionCount = (d) => ["setup", "mesh", "view", "profile", "stats", "observations", "sweep", "source"].filter((k) => d[k]).length + 1;

function sayReport() {
  const node = byId("ra-report-status");
  if (node) node.textContent = L.report.text;
}

/* ── the card ───────────────────────────────────────────────────────────── */

function signature() {
  const S = R()?.state;
  // The satellite geometry changes what LOS and fringes ARE, so it is part of the selection.
  const sat = S?.component === "los" || S?.component === "fringe" ? `|${S.insar?.heading}|${S.insar?.incidence}|${S.insar?.wavelength}|${S.insar?.look}|${S.insar?.scale}` : "";
  return S?.mesh ? `${S.meshPath}|${S.field}|${S.step}|${S.component}|${S.colormap}|${S.reverse}|${S.deform?.on}|${S.deform?.scale}${sat}` : "";
}

export function render() {
  const host = byId("studio-analysis-host");
  if (!host) return;
  if (host.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  host.textContent = "";
  const S = R()?.state;
  if (!S?.mesh) {
    host.append(note("Open a run in Results to plot a profile or draw vector arrows."));
    return;
  }

  renderHandoff(host);

  const line = card("Plot over line");
  line.body.append(note("The field shown in Results, read along a line through the volume — interpolated in each element, not the nearest node."));
  line.body.append(xyzRow("From", L.a), xyzRow("To", L.b));
  line.body.append(el("div", { class: "studio-actions" },
    button("Along x", "studio-secondary", () => presets("x"), "Through the mesh's centre, end to end in x"),
    button("Along y", "studio-secondary", () => presets("y"), "Through the mesh's centre, end to end in y"),
    button("Vertical", "studio-secondary", () => presets("z"), "Down through the mesh's centre, top to bottom"),
  ));
  line.body.append(el("div", { class: "studio-actions" },
    button("From = probe", "studio-secondary", () => fromProbe("a"), "The node picked in Results ▸ Probe"),
    button("To = probe", "studio-secondary", () => fromProbe("b"), "The node picked in Results ▸ Probe"),
  ));
  const samples = numberInput(L.samples, (v) => { L.samples = Math.max(2, Math.min(5000, Math.round(v) || 256)); L.locatedKey = ""; }, "1");
  line.body.append(row("Samples", samples));
  const compare = el("select", { class: "studio-select" });
  [["none", "Nothing"], ["first", "First step"], ["previous", "Previous step"]].forEach(([v, t]) => compare.append(new Option(t, v, false, v === L.compare)));
  compare.addEventListener("change", () => { L.compare = compare.value; plot(); });
  line.body.append(row("Compare with", compare));
  line.body.append(el("div", { class: "studio-actions" },
    button("Plot", "studio-primary", () => plot()),
    button("Export CSV", "studio-secondary", exportCsv, "Distance, x, y, z and each plotted step"),
  ));
  line.body.append(el("div", { id: "ra-status", class: `studio-readout${L.level ? ` is-${L.level}` : ""}` }, L.text));
  const p = L.profile;
  if (p) {
    const canvas = el("canvas", { class: "fem-profile ra-plot" });
    line.body.append(el("p", { class: "studio-group-title" }, p.label || p.field), canvas);
    const dl = el("dl", { class: "st-facts" });
    profileFacts(p).forEach(([k, v]) => dl.append(el("dt", {}, k), el("dd", {}, v)));
    line.body.append(dl);
    setTimeout(() => drawProfile(canvas, p), 0);
  }
  host.append(line.details);

  const glyph = card("Vector glyphs", L.glyph.on);
  const fields = vectorFields();
  if (!fields.length) {
    glyph.body.append(note("No vector field in this run."));
  } else {
    const on = el("input", { type: "checkbox" });
    on.checked = L.glyph.on;
    on.addEventListener("change", () => { L.glyph.on = on.checked; if (on.checked) drawGlyphs(); else disposeGlyphs(); render(); });
    glyph.body.append(el("label", { class: "studio-check" }, on, "Show arrows on the surface"));
    const fieldSel = el("select", { class: "studio-select" });
    fields.forEach(({ f, i }) => fieldSel.append(new Option(f.desc.label ? `${f.desc.label} (${f.field})` : f.field, String(i), false, i === L.glyph.field)));
    fieldSel.addEventListener("change", () => { L.glyph.field = Number(fieldSel.value); drawGlyphs(); });
    glyph.body.append(row("Field", fieldSel));
    const count = el("select", { class: "studio-select" });
    [500, 2000, 8000].forEach((c) => count.append(new Option(`${c.toLocaleString()} at most`, String(c), false, c === L.glyph.count)));
    count.addEventListener("change", () => { L.glyph.count = Number(count.value); drawGlyphs(); });
    glyph.body.append(row("Arrows", count));
    glyph.body.append(row("Size ×", numberInput(L.glyph.scale, (v) => { L.glyph.scale = v > 0 ? v : 1; drawGlyphs(); })));
    glyph.body.append(el("div", { id: "ra-glyph-status", class: "studio-readout" }, L.glyph.on ? L.glyph.said || "" : "Coloured by magnitude on the Results colour map; the longest arrow is 8% of the model."));
  }
  host.append(glyph.details);

  const ZL = L.sel;
  const selCard = card("Selection", ZL.open);
  selCard.details.addEventListener("toggle", () => { ZL.open = selCard.details.open; });
  selCard.body.append(note("Drag a box over the view to select nodes — on the surface, or every node through the volume behind the box — then read the field over them, plot them over time, or keep only them in the spreadsheet."));
  const modeSel = el("select", { class: "studio-select" });
  [["surface", "Surface nodes in the box, front and back"], ["through", "Every node through the volume"]].forEach(([v, t]) => modeSel.append(new Option(t, v, false, v === ZL.mode)));
  modeSel.addEventListener("change", () => { ZL.mode = modeSel.value; });
  selCard.body.append(row("Select", modeSel));
  selCard.body.append(el("div", { class: "studio-actions" },
    button(ZL.armed ? "Drag a box…" : "Select in a box", "studio-primary", () => armSelection()),
    button("Over time", "studio-secondary", () => selectionOverTime(), "Mean, min and max of the field shown over the selection at every step"),
    button("Export CSV", "studio-secondary", exportSelection, "The selected nodes' values at this step, and the selection over time if plotted"),
    button("Clear", "studio-secondary", () => { ZL.ids = null; ZL.summary = null; ZL.over = null; disposeSelection(); saySel("Selection cleared."); render(); }),
  ));
  selCard.body.append(el("div", { id: "ra-sel-status", class: "studio-readout" }, ZL.text));
  if (ZL.summary) {
    const u = ZL.summary;
    const span = u.max - u.min || Math.abs(u.max) || 1;
    selCard.body.append(el("dl", { class: "st-facts" },
      el("dt", {}, "Nodes"), el("dd", {}, `${u.count.toLocaleString()}${u.finite < u.count ? ` (${u.finite.toLocaleString()} with a value)` : ""}`),
      el("dt", {}, "Field"), el("dd", {}, `${u.label} · t=${u.stepName}`),
      el("dt", {}, "Min"), el("dd", {}, formatValue(u.min, span)),
      el("dt", {}, "Max"), el("dd", {}, formatValue(u.max, span)),
      el("dt", {}, "Mean"), el("dd", {}, formatValue(u.mean, span)),
    ));
  }
  if (ZL.over) {
    const plotCanvas = el("canvas", { class: "fem-profile ra-plot", title: "Mean (line) and range (band) over the selection, by time" });
    selCard.body.append(plotCanvas);
    requestAnimationFrame(() => drawSelectionPlot(plotCanvas, ZL.over));
  }
  host.append(selCard.details);

  const ZS = L.stream;
  const stream = card("Stream tracer", ZS.on);
  const vf = vectorFields();
  if (!vf.length || S.mesh.dim !== 3) {
    stream.body.append(note(S.mesh.dim !== 3 ? "Stream lines are traced through a 3D mesh." : "No vector field in this run."));
  } else {
    stream.body.append(note("Curves everywhere tangent to a vector field, traced element to element from seeds (RK4 on the field's direction, so a step is a length in space)."));
    const on = el("input", { type: "checkbox" });
    on.checked = ZS.on;
    on.addEventListener("change", () => { ZS.on = on.checked; if (on.checked) traceStream(); else disposeStream(); render(); });
    stream.body.append(el("label", { class: "studio-check" }, on, "Show stream lines"));
    const fieldSel = el("select", { class: "studio-select" });
    vf.forEach(({ f, i }) => fieldSel.append(new Option(f.desc.label ? `${f.desc.label} (${f.field})` : f.field, String(i), false, i === ZS.field)));
    fieldSel.addEventListener("change", () => { ZS.field = Number(fieldSel.value); if (ZS.on) traceStream(); });
    stream.body.append(row("Field", fieldSel));
    const seedSel = el("select", { class: "studio-select" });
    [["line", "Along the profile line"], ["sphere", "In a sphere (probed node, else centre)"]].forEach(([v, t]) => seedSel.append(new Option(t, v, false, v === ZS.seed)));
    seedSel.addEventListener("change", () => { ZS.seed = seedSel.value; if (ZS.on) traceStream(); render(); });
    stream.body.append(row("Seeds", seedSel));
    stream.body.append(row("Seed count", numberInput(ZS.count, (v) => { ZS.count = Math.max(1, Math.min(2000, Math.round(v) || 60)); if (ZS.on) traceStream(); }, "1")));
    if (ZS.seed === "sphere") stream.body.append(row("Radius (× diagonal)", numberInput(ZS.radius, (v) => { ZS.radius = v > 0 ? v : 0.1; if (ZS.on) traceStream(); })));
    const dirSel = el("select", { class: "studio-select" });
    [["both", "Both ways"], ["forward", "Forward"], ["backward", "Backward"]].forEach(([v, t]) => dirSel.append(new Option(t, v, false, v === ZS.direction)));
    dirSel.addEventListener("change", () => { ZS.direction = dirSel.value; if (ZS.on) traceStream(); });
    stream.body.append(row("Direction", dirSel));
    stream.body.append(row("Steps per diagonal", numberInput(ZS.stepPer, (v) => { ZS.stepPer = Math.max(20, Math.min(5000, Math.round(v) || 400)); if (ZS.on) traceStream(); }, "1")));
    stream.body.append(row("Max length (× diagonal)", numberInput(ZS.lengthPer, (v) => { ZS.lengthPer = v > 0 ? v : 1.5; if (ZS.on) traceStream(); })));
    stream.body.append(el("div", { class: "studio-actions" },
      button("Trace", "studio-primary", () => { ZS.on = true; traceStream().then(() => render()); }),
      button("Export CSV", "studio-secondary", exportStream, "Line, point, arc length, x, y, z and magnitude"),
    ));
    stream.body.append(el("div", { id: "ra-stream-status", class: "studio-readout" }, ZS.text || "Coloured by magnitude on the Results colour map."));
  }
  host.append(stream.details);

  const T = L.stats;
  const stats = card("Statistics by domain", T.open);
  stats.details.addEventListener("toggle", () => { T.open = stats.details.open; if (T.open && !T.result && !T.busy) computeStats(); });
  stats.body.append(note("The field shown in Results summarised over each volume flag: means weighted by element volume, so a finely meshed chamber wall does not outvote the crust."));
  stats.body.append(el("div", { class: "studio-actions" },
    button("Summarise", "studio-primary", () => computeStats()),
    button("Export CSV", "studio-secondary", exportStats, "A row per domain, then a volume histogram on shared bins"),
  ));
  stats.body.append(el("div", { id: "ra-stats-status", class: "studio-readout" }, T.text));
  if (T.result?.domains.length) {
    const res = T.result;
    stats.body.append(el("p", { class: "studio-group-title" }, `${T.label} · ${T.field} · t=${T.stepName}`));
    const table = el("table", { class: "ra-stats" });
    const st = statsTable(T);
    table.append(el("thead", {}, el("tr", {}, ...st.heads.map((h) => el("th", {}, h)))));
    const tbody = el("tbody");
    st.rows.forEach((cells, n) => tbody.append(el("tr", {},
      el("td", {}, el("span", { class: "ra-stats-swatch", style: `background:${STAT_COLOURS[n % STAT_COLOURS.length]}` }), cells[0]),
      ...cells.slice(1).map((c) => el("td", {}, c)))));
    table.append(tbody);
    stats.body.append(el("div", { class: "ra-stats-wrap" }, table));
    const hist = el("canvas", { class: "fem-profile ra-plot", title: "Share of each domain's volume in each bin, on a square-root axis" });
    stats.body.append(hist);
    setTimeout(() => drawStatsHistogram(hist, res), 0);
  }
  host.append(stats.details);

  const O = L.obs;
  const cmp = card("Compare with observations", O.open);
  cmp.details.addEventListener("toggle", () => { O.open = cmp.details.open; });
  cmp.body.append(note("GNSS displacements or InSAR line-of-sight points, read at their stations in the displacement shown and compared. Coordinates are metres in the mesh's frame (x east, y north, z up); a station without z reads the ground below it."));
  const area = el("textarea", { class: "studio-input ra-obs-text", rows: "5", spellcheck: "false", placeholder: "name, x, y, ue, un, uu, se, sn, su\nor  name, x, y, z, los, sigma" });
  area.value = O.raw;
  area.addEventListener("keydown", (event) => event.stopPropagation());
  area.addEventListener("input", () => { O.raw = area.value; });
  cmp.body.append(area);
  const file = el("input", { type: "file", accept: ".csv,.txt,.tsv,.dat", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    O.raw = await f.text();
    O.text = `${f.name} loaded — press Compare.`;
    render();
  });
  cmp.body.append(file);
  const unit = el("select", { class: "studio-select" });
  [["mm", "millimetres"], ["cm", "centimetres"], ["m", "metres"]].forEach(([v, t]) => unit.append(new Option(t, v, false, v === O.unit)));
  unit.addEventListener("change", () => { O.unit = unit.value; if (O.result) compareObservations(); });
  cmp.body.append(row("Displacements in", unit));
  const fit = el("input", { type: "checkbox" });
  fit.checked = O.fit;
  fit.addEventListener("change", () => { O.fit = fit.checked; if (O.result) compareObservations(); });
  cmp.body.append(el("label", { class: "studio-check", title: "For a linear elastic model every displacement scales with the source's strength, so one least-squares number fits the size and leaves the shape to be judged." }, fit, "Fit the source strength"));
  const arrows = el("input", { type: "checkbox" });
  arrows.checked = O.arrows;
  arrows.addEventListener("change", () => { O.arrows = arrows.checked; drawObsArrows(); });
  cmp.body.append(el("label", { class: "studio-check" }, arrows, "Draw observed and modelled arrows"));
  cmp.body.append(el("div", { class: "studio-actions" },
    button("Compare", "studio-primary", () => compareObservations()),
    button("Load file…", "studio-secondary", () => file.click(), "A CSV, TSV or space-separated table"),
    button("Export CSV", "studio-secondary", exportComparison, "Observed, modelled and residual per station"),
  ));
  cmp.body.append(el("div", { id: "ra-obs-status", class: "studio-readout" }, O.text));
  const res = O.result;
  if (res) {
    const dl = el("dl", { class: "st-facts" });
    obsFacts(res).forEach(([k, v]) => dl.append(el("dt", {}, k), el("dd", {}, v)));
    cmp.body.append(dl);
    const legend = el("p", { class: "studio-readout" },
      el("span", { class: "ra-stats-swatch", style: `background:${OBS_COLOUR}` }), "observed  ",
      el("span", { class: "ra-stats-swatch", style: `background:${MODEL_COLOUR}` }), res.k === 1 ? "modelled" : "modelled × scale");
    cmp.body.append(legend);
    const { heads, rows, shown } = obsTable(res);
    const table = el("table", { class: "ra-stats" });
    table.append(el("thead", {}, el("tr", {}, ...heads.map((h) => el("th", {}, h)))));
    const tbody = el("tbody");
    rows.forEach((r) => {
      const s = res.stations[r.index];
      const title = `${s.name} — ${s.placed}`;
      tbody.append(r.cells.length === 2 && !res.model[r.index]
        ? el("tr", { title }, el("td", {}, r.cells[0]), el("td", { colspan: String(heads.length - 1) }, r.cells[1]))
        : el("tr", { title }, ...r.cells.map((c) => el("td", {}, c))));
    });
    table.append(tbody);
    cmp.body.append(el("div", { class: "ra-stats-wrap" }, table));
    if (res.stations.length > shown.length) cmp.body.append(note(`The first ${shown.length} of ${res.stations.length} stations are listed; the CSV holds them all.`));
  }
  host.append(cmp.details);

  const P = L.src;
  const srcCard = card("Analytical source (Mogi)", P.open);
  srcCard.details.addEventListener("toggle", () => { P.open = srcCard.details.open; });
  const sb = srcCard.body;
  sb.append(note("A point pressure source in an elastic half-space. Compare it with the model's surface to benchmark the mesh, its walls and its material; or invert for the source that best explains the model or the observations."));
  const num = (key, step = "any", onChange) => numberInput(P[key], (v) => { if (Number.isFinite(v)) P[key] = v; onChange?.(); }, step);
  const xy = el("div", { class: "st-xyz" });
  [["x0", "x"], ["y0", "y"]].forEach(([k, a]) => { const i = num(k); i.setAttribute("aria-label", `source ${a}`); i.title = `Source ${a} (m, the mesh's frame)`; xy.append(i); });
  sb.append(el("div", { class: "studio-row st-row-wide" }, el("label", {}, "Position"), xy));
  sb.append(row("Depth (m)", num("depth")));
  const mode = el("select", { class: "studio-select" });
  [["dV", "Volume change ΔV"], ["dP", "Pressure in a sphere"]].forEach(([v, t]) => mode.append(new Option(t, v, false, v === P.mode)));
  mode.addEventListener("change", () => { P.mode = mode.value; render(); });
  sb.append(row("Strength as", mode));
  if (P.mode === "dP") {
    sb.append(row("ΔP (Pa)", num("dP")), row("Radius (m)", num("radius")), row("E (Pa)", num("E")));
    sb.append(note(`ΔV = π a³ ΔP / G = ${fmtVol(sourceVolume())} — the point-source limit, fair while the radius is well under the depth.`));
  } else sb.append(row("ΔV (m³)", num("dV")));
  sb.append(row("Poisson's ratio", num("nu")));
  const fitDV = el("input", { type: "checkbox" });
  fitDV.checked = P.fitDV;
  fitDV.addEventListener("change", () => { P.fitDV = fitDV.checked; });
  sb.append(el("label", { class: "studio-check", title: "The model's displacement is linear in the source's strength, so the ΔV that best matches its surface is one least-squares number." }, fitDV, "Fit ΔV to the model surface"));
  const fromProbe = button("Position = probe", "studio-secondary", () => {
    const S = R()?.state;
    const node = S?.probe?.node;
    if (!Number.isInteger(node)) { P.text = "Probe a node in Results first."; saySource(); return; }
    P.x0 = S.mesh.coords[node * 3]; P.y0 = S.mesh.coords[node * 3 + 1];
    render();
  }, "The probed node's x and y");
  sb.append(el("div", { class: "studio-actions" },
    button("Compare with model", "studio-primary", () => compareSource()),
    fromProbe,
  ));
  sb.append(el("div", { class: "studio-actions" },
    button("Invert model surface", "studio-secondary", () => invertSource("model"), "The Mogi source that best explains the model's own surface: its effective depth"),
    button("Invert observations", "studio-secondary", () => invertSource("observations"), "The Mogi source that best explains the stations compared above"),
  ));
  sb.append(el("div", { id: "ra-src-status", class: "studio-readout" }, P.text));
  if (P.result) {
    const res = P.result;
    const dl = el("dl", { class: "st-facts" });
    sourceFacts(res).forEach(([k, v]) => dl.append(el("dt", {}, k), el("dd", {}, v)));
    sb.append(el("p", { class: "studio-group-title" }, `Against the model surface · ${res.field} · t=${res.stepName}`), dl);
    const canvas = el("canvas", { class: "fem-profile ra-plot", title: "Against distance from the source: dots are the model, lines Mogi" });
    sb.append(el("p", { class: "studio-readout" },
      el("span", { class: "ra-stats-swatch", style: "background:rgba(82,228,232,0.9)" }), "model u_z  ",
      el("span", { class: "ra-stats-swatch", style: "background:rgba(180,190,210,0.9)" }), "model u_r  ",
      el("span", { class: "ra-stats-swatch", style: "background:#ff2bd6" }), "Mogi (dashed: u_r)"), canvas);
    setTimeout(() => drawSourcePlot(canvas, res), 0);
  }
  if (P.inversion) {
    const inv = P.inversion;
    const dl = el("dl", { class: "st-facts" });
    inversionFacts(inv).forEach(([k, v]) => dl.append(el("dt", {}, k), el("dd", {}, v)));
    sb.append(el("p", { class: "studio-group-title" }, "Inversion"), dl);
    const curve = el("canvas", { class: "fem-profile ra-plot", title: "Misfit against depth at the best position: a narrow dip is a well-determined depth" });
    sb.append(curve, note("Misfit along depth at the best position. A broad trough is the depth–volume trade-off: the data do not pin the depth down."));
    setTimeout(() => drawDepthCurve(curve, inv), 0);
  }
  host.append(srcCard.details);

  const G = L.sheet;
  const sheet = card("Spreadsheet", G.open);
  sheet.details.addEventListener("toggle", () => { G.open = sheet.details.open; if (G.open && !G.data && !G.busy) buildSheet(); });
  const surfaceOnly = el("input", { type: "checkbox" });
  surfaceOnly.checked = G.surfaceOnly;
  surfaceOnly.addEventListener("change", () => { G.surfaceOnly = surfaceOnly.checked; buildSheet(); });
  sheet.body.append(el("label", { class: "studio-check" }, surfaceOnly, "Surface nodes only"));
  if (L.sel.ids?.length) {
    const selOnly = el("input", { type: "checkbox" });
    selOnly.checked = Boolean(G.selectionOnly);
    selOnly.addEventListener("change", () => { G.selectionOnly = selOnly.checked; buildSheet(); });
    sheet.body.append(el("label", { class: "studio-check" }, selOnly, `Only the ${L.sel.ids.length.toLocaleString()} selected nodes`));
  }
  sheet.body.append(el("div", { class: "studio-actions" },
    button("Refresh", "studio-secondary", () => buildSheet()),
    button("Export CSV", "studio-secondary", exportSheet, "Every row, in the order shown"),
  ));
  sheet.body.append(el("div", { class: "studio-readout" }, G.text));
  if (G.data?.order) {
    const d = G.data;
    const pages = Math.max(1, Math.ceil(d.order.length / G.size));
    G.page = Math.min(G.page, pages - 1);
    const table = el("table", { class: "ra-stats ra-sheet" });
    const head = el("tr");
    d.cols.forEach((c, k) => {
      const th = el("th", { title: `${c.title || c.name} — click to sort` }, `${c.name}${G.sort === k ? (G.dir > 0 ? " ▲" : " ▼") : ""}`);
      th.addEventListener("click", () => { if (G.sort === k) G.dir = -G.dir; else { G.sort = k; G.dir = k === 0 ? 1 : -1; } sortSheet(); render(); });
      head.append(th);
    });
    table.append(el("thead", {}, head));
    const tbody = el("tbody");
    const start = G.page * G.size;
    for (let k = start; k < Math.min(d.order.length, start + G.size); k += 1) {
      const i = d.rows[d.order[k]];
      const tr = el("tr", { title: `Probe node ${i}` }, ...d.cols.map((c) => { const v = c.get(i); return el("td", {}, c.int ? String(v) : Number.isFinite(v) ? Number(v.toPrecision(6)).toString() : "—"); }));
      tr.addEventListener("click", () => R()?.probeNode?.(i));
      tbody.append(tr);
    }
    table.append(tbody);
    sheet.body.append(el("div", { class: "ra-stats-wrap" }, table));
    const size = el("select", { class: "studio-select" });
    [25, 50, 100, 200].forEach((v) => size.append(new Option(`${v} rows`, String(v), false, v === G.size)));
    size.addEventListener("change", () => { G.size = Number(size.value); G.page = 0; render(); });
    const go = (p) => () => { G.page = Math.max(0, Math.min(pages - 1, p)); render(); };
    sheet.body.append(el("div", { class: "studio-actions ra-pager" },
      button("«", "studio-secondary", go(0)), button("‹", "studio-secondary", go(G.page - 1)),
      el("span", { class: "studio-readout" }, `${(start + 1).toLocaleString()}–${Math.min(d.order.length, start + G.size).toLocaleString()} of ${d.order.length.toLocaleString()}`),
      button("›", "studio-secondary", go(G.page + 1)), button("»", "studio-secondary", go(pages - 1)), size,
    ));
  }
  host.append(sheet.details);

  const WS = L.sweep;
  const swc = card("Sweep response", WS.open);
  swc.details.addEventListener("toggle", () => {
    WS.open = swc.details.open;
    if (WS.open && WS.manifests === null) listSweeps().then((list) => { WS.manifests = list; if (!WS.path && list.length) WS.path = list[0]; render(); });
  });
  swc.body.append(note("A parameter sweep read back: each run's last step reduced to one number, against the value varied. The slope of log response on log parameter is the sensitivity — 1 where displacement scales with pressure, −1 where it scales with 1/E."));
  const sweeps = WS.manifests || [];
  if (!sweeps.length) swc.body.append(note(WS.manifests === null ? "Looking for sweeps in the open project…" : "No sweep in this project's fem_runs/: write one from Study ▸ Parameter sweep."));
  else {
    const pick = el("select", { class: "studio-select" });
    sweeps.forEach((path) => pick.append(new Option(path.replace(/^fem_runs\//, ""), path, false, path === WS.path)));
    pick.addEventListener("change", () => { WS.path = pick.value; });
    swc.body.append(row("Sweep", pick));
    const fieldIn = el("input", { class: "studio-input", type: "text", value: WS.field, spellcheck: "false", title: "The results folder read in each run: solid/u, heat_eq/T…" });
    fieldIn.addEventListener("keydown", (event) => event.stopPropagation());
    fieldIn.addEventListener("change", () => { WS.field = fieldIn.value.trim() || "solid/u"; });
    swc.body.append(row("Field", fieldIn));
    const comp = el("select", { class: "studio-select" });
    [["mag", "Magnitude"], ["0", "Component x"], ["1", "Component y"], ["2", "Component z"]].forEach(([v, t]) => comp.append(new Option(t, v, false, v === WS.component)));
    comp.addEventListener("change", () => { WS.component = comp.value; });
    swc.body.append(row("Component", comp));
    const where = el("select", { class: "studio-select" });
    [["peak", "Peak over the mesh"], ["probe", "At the probed node"], ["node", "At a node number"]].forEach(([v, t]) => where.append(new Option(t, v, false, v === WS.where)));
    where.addEventListener("change", () => { WS.where = where.value; render(); });
    swc.body.append(row("Where", where));
    if (WS.where === "node") swc.body.append(row("Node", numberInput(Number(WS.node), (v) => { WS.node = v; }, "1")));
  }
  swc.body.append(el("div", { class: "studio-actions" },
    button("Read responses", "studio-primary", () => readSweep()),
    button("Refresh list", "studio-secondary", () => listSweeps().then((list) => { WS.manifests = list; if (!list.includes(WS.path)) WS.path = list[0] || ""; render(); })),
    button("Export CSV", "studio-secondary", exportSweep),
  ));
  swc.body.append(el("div", { class: "studio-readout" }, WS.text));
  if (WS.result) {
    const dl = el("dl", { class: "st-facts" });
    sweepFacts(WS.result).forEach(([k, v]) => dl.append(el("dt", {}, k), el("dd", {}, v)));
    swc.body.append(dl);
    const canvas = el("canvas", { class: "fem-profile ra-plot", title: "Response against the parameter; log axis where the values span a decade" });
    swc.body.append(canvas);
    setTimeout(() => drawSweep(canvas, WS.result), 0);
    const table = el("table", { class: "ra-stats" });
    table.append(el("thead", {}, el("tr", {}, ...["Run", "Value", "Reading", "Step"].map((h) => el("th", {}, h)))));
    const tbody = el("tbody");
    WS.result.rows.forEach((r) => tbody.append(el("tr", {}, el("td", {}, r.name), el("td", {}, formatValue(r.value, Math.abs(r.value) || 1)), el("td", {}, Number.isFinite(r.reading) ? formatValue(r.reading, Math.abs(r.reading) || 1) : r.note), el("td", {}, r.step || "—"))));
    table.append(tbody);
    swc.body.append(el("div", { class: "ra-stats-wrap" }, table));
  }
  host.append(swc.details);

  const MD = L.media;
  const media = card("Screenshot and animation", MD.open);
  media.details.addEventListener("toggle", () => { MD.open = media.details.open; });
  media.body.append(note("The view with a footer carrying the field, the time and the colour scale — as a PNG, or as a WebM stepping through time or turning round the model."));
  const widthSel = el("select", { class: "studio-select" });
  [[0, "As on screen"], [1280, "1280 wide"], [1920, "1920 wide"], [3840, "3840 wide (PNG)"]].forEach(([v, t]) => widthSel.append(new Option(t, String(v), false, v === MD.width)));
  widthSel.addEventListener("change", () => { MD.width = Number(widthSel.value); });
  media.body.append(row("Width", widthSel));
  const kindSel = el("select", { class: "studio-select" });
  [["steps", "Every step of the field"], ["turntable", "One turn round the model"]].forEach(([v, t]) => kindSel.append(new Option(t, v, false, v === MD.kind)));
  kindSel.addEventListener("change", () => { MD.kind = kindSel.value; render(); });
  media.body.append(row("Animate", kindSel));
  if (MD.kind === "steps") media.body.append(row("Seconds a step", numberInput(MD.hold, (v) => { MD.hold = v > 0 ? v : 1; })));
  else media.body.append(row("Seconds a turn", numberInput(MD.seconds, (v) => { MD.seconds = v > 0 ? v : 8; })));
  media.body.append(el("div", { class: "studio-actions" },
    button("Screenshot (PNG)", "studio-primary", () => screenshot({ width: MD.width })),
    button(MD.busy ? "Stop" : "Record (WebM)", "studio-secondary", () => { if (MD.busy) { MD.cancel = true; return; } recordAnimation({ width: Math.min(MD.width || 1920, 1920) }); }),
  ));
  media.body.append(el("div", { id: "ra-media-status", class: "studio-readout" }, MD.text));
  host.append(media.details);

  const Z = L.state;
  const stateCard = card("State", Z.open);
  stateCard.details.addEventListener("toggle", () => { Z.open = stateCard.details.open; });
  stateCard.body.append(note("Save the page as it stands — field, step, colours, slice, contours, isosurfaces, threshold, calculated fields, probe and points, the camera, and every analysis — to apply to the run again later. The data is not in it: open the run, then load the state."));
  const stateFile = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  stateFile.addEventListener("change", async () => { const file = stateFile.files?.[0]; stateFile.value = ""; if (file) loadState(await file.text()); });
  stateCard.body.append(stateFile, el("div", { class: "studio-actions" },
    button("Save state", "studio-primary", () => saveState(), "Downloaded, and filed in the project's post_processing/ when one is open"),
    button("Load state…", "studio-secondary", () => stateFile.click()),
    button("From project", "studio-secondary", () => listProjectStates(), "States saved in this project's post_processing/"),
  ));
  if (Z.saved?.length) {
    const pick = el("select", { class: "input" }, el("option", { value: "" }, "Choose a saved state…"), ...Z.saved.map((name) => el("option", { value: name }, name)));
    pick.addEventListener("change", async () => {
      if (!pick.value) return;
      try { loadState(await window.GeoIDResearch.store.readProjectFile(`post_processing/${pick.value}`)); } catch (error) { Z.text = `Could not read ${pick.value}: ${error.message}`; render(); }
    });
    stateCard.body.append(row("Saved states", pick));
  }
  stateCard.body.append(el("div", { class: "studio-readout" }, Z.text));
  host.append(stateCard.details);

  const Q = L.report;
  const rep = card("Report", Q.open);
  rep.details.addEventListener("toggle", () => { Q.open = rep.details.open; });
  rep.body.append(note("One printable page: the setup, the mesh, the view as it stands, and every analysis above that has a result — with its figure, its numbers and how each was computed."));
  const titleInput = el("input", { class: "studio-input", type: "text", placeholder: "Title (defaults to the run and field)" });
  titleInput.value = Q.title;
  titleInput.addEventListener("keydown", (event) => event.stopPropagation());
  titleInput.addEventListener("input", () => { Q.title = titleInput.value; });
  rep.body.append(row("Title", titleInput));
  const have = [L.profile && "profile", L.stats.result && "domain statistics", L.obs.result && "observations", L.src.result && "Mogi source"].filter(Boolean);
  rep.body.append(note(have.length ? `Includes: view and mesh, ${have.join(", ")}.` : "Includes the view and the mesh; run an analysis above to add it."));
  rep.body.append(el("div", { class: "studio-actions" },
    button("Open report", "studio-primary", () => openModelReport()),
    button("Download HTML", "studio-secondary", () => openModelReport({ download: true })),
  ));
  rep.body.append(el("div", { id: "ra-report-status", class: "studio-readout" }, Q.text));
  host.append(rep.details);
}

/* ── following Results ──────────────────────────────────────────────────── */

function follow() {
  const S = R()?.state;
  const meshSig = S?.mesh ? `${S.meshPath}|${S.mesh.nodeCount}` : "";
  if (meshSig !== L.meshSig) {
    L.meshSig = meshSig;
    L.profile = null; L.located = null; L.locatedKey = ""; L.text = "";
    L.stats.result = null; L.stats.text = ""; L.stats.sig = "";
    L.sheet.data = null; L.sheet.text = ""; L.sheet.key = "";
    L.obs.result = null; L.obs.text = ""; L.obs.sig = "";
    L.src.result = null; L.src.inversion = null; L.src.text = ""; L.src.sig = "";
    disposeLine(); disposeGlyphs(); disposeObsArrows(); disposeSourceMarker();
    if (S?.mesh) {
      const b = S.mesh.bounds;
      const c = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
      L.a = [b.min[0], c[1], c[2]]; L.b = [b.max[0], c[1], c[2]];
      L.src.x0 = c[0]; L.src.y0 = c[1];
      L.src.depth = Math.round(Math.max(500, 0.1 * (b.max[2] - b.min[2])) / 100) * 100;
      drawLine();
    }
    render();
    return;
  }
  if (!S?.mesh) return;
  const sig = signature();
  if (L.profile && sig !== L.sig && !L.busy) plot();
  if (L.glyph.on && sig !== L.glyph.sig) drawGlyphs();
  if (L.sel.ids?.length && sig !== L.sel.sig && !L.sel.busy) { L.sel.sig = sig; summariseSelection().then(() => render()); }
  if (L.stream.on && sig + streamSignature() !== L.stream.sig && !L.stream.busy) traceStream();
  if (L.stats.open && L.stats.result && sig !== L.stats.sig && !L.stats.busy) computeStats();
  if (L.obs.result && obsSignature() !== L.obs.sig && !L.obs.busy) compareObservations();
  if (L.sheet.open && L.sheet.data && sig !== L.sheet.key && !L.sheet.busy) buildSheet();
  if (L.src.result && sig !== L.src.sig && !L.src.busy) compareSource();
  if (!L.line && R()?.frame?.()) drawLine();
}

/**
 * THE VISIBILITY BOX LISTS THE ANALYSIS OVERLAYS TOO — arrows, stream lines,
 * the selection, the second view — each with an eye and a gear that opens its
 * card, so the box is the page's pipeline browser: everything drawn, in one
 * list, with the controls that made it one press away.
 */
function overlayGroup() {
  const S = R()?.state;
  if (!S?.mesh) return null;
  const goto = (open) => () => { window.GeoIDStudioSpaces?.setSpace?.("analyse"); window.GeoIDMeshStudio?.showGroup?.("analysis"); open(); render(); setTimeout(() => byId("studio-analysis-host")?.querySelector("details[open]")?.scrollIntoView?.({ block: "nearest" }), 0); };
  const parts = [];
  if (L.glyph.mesh) parts.push({ id: "ra-glyphs", name: "Vector arrows", face: "Vector arrows", kind: "overlay", mesh: L.glyph.mesh, colour: 0xff8a5b, onSettings: goto(() => {}), settingsTitle: "Open Vector glyphs" });
  if (L.stream.mesh) parts.push({ id: "ra-stream", name: "Stream lines", face: "Stream lines", kind: "overlay", mesh: L.stream.mesh, colour: 0x52e4e8, onSettings: goto(() => { L.stream.on = true; }), settingsTitle: "Open Stream tracer" });
  if (L.sel.mesh) parts.push({ id: "ra-selection", name: `Selection (${L.sel.ids?.length?.toLocaleString() || 0} nodes)`, face: "Selection", kind: "overlay", mesh: L.sel.mesh, colour: 0xff2bd6, onSettings: goto(() => { L.sel.open = true; }), settingsTitle: "Open Selection" });
  const view2 = window.GeoIDSecondView;
  if (view2?.isOpen?.()) {
    const proxy = { get visible() { return !view2.state.node?.hidden; }, set visible(v) { if (v) view2.open(); else view2.close(); } };
    parts.push({ id: "ra-view2", name: `Second view — ${view2.state.field || ""}`, face: "Second view", kind: "overlay", mesh: proxy, colour: 0x8fb8de, onSettings: () => { const s = view2.state.node?.querySelector("select"); s?.focus(); }, settingsTitle: "Choose the second view's field" });
  }
  if (!parts.length) return null;
  return { id: "ra-overlays", title: "Analysis overlays", parts, onSettings: goto(() => {}), settingsTitle: "Open Analysis" };
}

function install() {
  if (!byId("studio-analysis-host")) { setTimeout(install, 500); return; }
  render();
  setInterval(follow, 700);
  let tries = 0;
  const hook = () => {
    const st = window.GeoIDMeshStudio;
    if (st?.registerVisibility) { st.registerVisibility("ra-overlays", overlayGroup); overlayWatch(); } else if (tries++ < 120) setTimeout(hook, 500);
  };
  hook();
}

/** The box is redrawn when an overlay comes or goes, never on every frame. */
function overlayWatch() {
  let key = "";
  setInterval(() => {
    const next = [Boolean(L.glyph.mesh), Boolean(L.stream.mesh), L.sel.ids?.length || 0, window.GeoIDSecondView?.isOpen?.() ? window.GeoIDSecondView.state.field : ""].join("|");
    if (next !== key) { key = next; window.GeoIDMeshStudio?.refreshVisibility?.(); }
  }, 800);
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  window.GeoIDResultsAnalysis = { handoffCounts, handoffFiled, goResearch, plot, drawGlyphs, traceStream, armSelection, selectRect, selectionOverTime, computeStats, compareObservations, compareSource, invertSource, readSweep, listSweeps, buildSheet, screenshot, recordAnimation, currentState, saveState, loadState, buildModelReport, openModelReport, render, state: L };
}
