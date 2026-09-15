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
 *
 * Everything is read through the Results panel's seam (GeoIDGalesResults):
 * the open field, its values at a step, the component chosen there, and the
 * reader worker that holds the cells and locates the points. Both follow the
 * Results selection by polling its signature, so changing the step re-plots
 * and re-draws without a press.
 */

import * as THREE from "../vendor/three.module.js";
import { lineSamples, sampleLocated, profileCsv, usedNodes, componentOf, colourValues, niceTicks, formatValue } from "./gales-results.js?v=20260915-b1aefb2";
import { downloadText } from "./extraction.js?v=20260915-b1aefb2";

const byId = (id) => document.getElementById(id);
const R = () => window.GeoIDGalesResults;

const L = {
  a: [0, 0, 0], b: [1, 0, 0], samples: 256, compare: "none",
  located: null, locatedKey: "", profile: null, sig: "", busy: false, text: "", level: "",
  line: null,
  glyph: { on: false, field: -1, count: 2000, scale: 1, mesh: null, sig: "" },
  meshSig: "",
};

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
    const current = sampleLocated(loc, results.scalar(await results.values(S.field, S.step)));
    series.push({ name: `t=${f.steps[S.step].name}`, values: current, time: f.steps[S.step].time });
    const other = L.compare === "first" ? 0 : L.compare === "previous" ? S.step - 1 : -1;
    if (other >= 0 && other !== S.step) {
      series.push({ name: `t=${f.steps[other].name}`, values: sampleLocated(loc, results.scalar(await results.values(S.field, other))), time: f.steps[other].time });
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

function drawProfile(canvas, profile) {
  const ratio = window.devicePixelRatio || 1;
  const W = Math.max(220, canvas.clientWidth || 300);
  const H = 170;
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

/* ── the card ───────────────────────────────────────────────────────────── */

function signature() {
  const S = R()?.state;
  return S?.mesh ? `${S.meshPath}|${S.field}|${S.step}|${S.component}|${S.colormap}|${S.reverse}|${S.deform?.on}|${S.deform?.scale}` : "";
}

export function render() {
  const host = byId("studio-analysis-host");
  if (!host) return;
  if (host.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  host.textContent = "";
  const S = R()?.state;
  if (!S?.mesh) {
    host.append(note("Open a run in Results to plot a profile or draw vector arrows."));
    return;
  }

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
    const finite = [...p.series[0].values].filter(Number.isFinite);
    const dl = el("dl", { class: "st-facts" });
    const fact = (k, v) => dl.append(el("dt", {}, k), el("dd", {}, v));
    fact("Length", p.length >= 5000 ? `${formatValue(p.length / 1000, p.length / 1000)} km` : `${formatValue(p.length, p.length)} m`);
    fact("Inside the mesh", `${p.inside} of ${p.distance.length} samples`);
    // A break in the line is the mesh's own shape: above the ground, or a cavity.
    let gaps = 0;
    for (let k = 1; k < p.series[0].values.length; k += 1) if (Number.isFinite(p.series[0].values[k - 1]) && !Number.isFinite(p.series[0].values[k])) gaps += 1;
    if (gaps) fact("Breaks", `${gaps} — where the line leaves the mesh (above the ground, or through a cavity)`);
    if (finite.length) { fact("Min", formatValue(Math.min(...finite), Math.max(...finite) - Math.min(...finite))); fact("Max", formatValue(Math.max(...finite), Math.max(...finite) - Math.min(...finite))); }
    fact("Lines", p.series.map((s, n) => `${n ? "dashed" : "solid"} ${s.name}`).join(", "));
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
}

/* ── following Results ──────────────────────────────────────────────────── */

function follow() {
  const S = R()?.state;
  const meshSig = S?.mesh ? `${S.meshPath}|${S.mesh.nodeCount}` : "";
  if (meshSig !== L.meshSig) {
    L.meshSig = meshSig;
    L.profile = null; L.located = null; L.locatedKey = ""; L.text = "";
    disposeLine(); disposeGlyphs();
    if (S?.mesh) {
      const b = S.mesh.bounds;
      const c = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
      L.a = [b.min[0], c[1], c[2]]; L.b = [b.max[0], c[1], c[2]];
      drawLine();
    }
    render();
    return;
  }
  if (!S?.mesh) return;
  const sig = signature();
  if (L.profile && sig !== L.sig && !L.busy) plot();
  if (L.glyph.on && sig !== L.glyph.sig) drawGlyphs();
  if (!L.line && R()?.frame?.()) drawLine();
}

function install() {
  if (!byId("studio-analysis-host")) { setTimeout(install, 500); return; }
  render();
  setInterval(follow, 700);
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  window.GeoIDResultsAnalysis = { plot, drawGlyphs, render, state: L };
}
