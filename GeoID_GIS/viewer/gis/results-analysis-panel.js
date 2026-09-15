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
import { domainStatsCsv, lineSamples, sampleLocated, profileCsv, usedNodes, componentOf, colourValues, niceTicks, formatValue } from "./gales-results.js?v=20260915-611c4ec";
import { downloadText } from "./extraction.js?v=20260915-611c4ec";
import { modelReportHtml } from "./model-report.js?v=20260915-611c4ec";
import { PHYSICS, domainProperties } from "./fem-setup.js?v=20260915-611c4ec";
import { may, refusal } from "./membership.js?v=20260915-611c4ec";
import { parseObservations, fitScale, pairsOf, comparisonCsv } from "./observations.js?v=20260915-611c4ec";
import { losVector } from "./insar.js?v=20260915-611c4ec";
import { mogi, bestVolume, invertMogi, topSurfaceNodes, volumeFromPressure, shearModulus } from "./analytic-sources.js?v=20260915-611c4ec";

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

/* ── the model report ───────────────────────────────────────────────────── */

const sci = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : String(Number(v.toPrecision(6)))) : "—");

/** A figure drawn fresh at print size, off screen, as a PNG data URL. */
function figureOf(draw, data, size = { width: 720, height: 240 }) {
  const canvas = document.createElement("canvas");
  draw(canvas, data, size);
  return canvas.toDataURL("image/png");
}

/** The colour scale of the view, drawn for print: the page's legend is an overlay the snapshot does not hold. */
function colourBar(table, lo, hi, label) {
  const W = 720; const H = 52;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const steps = table.length / 3;
  const x0 = 10; const x1 = W - 10;
  for (let k = 0; k < steps; k += 1) {
    ctx.fillStyle = `rgb(${Math.round(table[k * 3] * 255)},${Math.round(table[k * 3 + 1] * 255)},${Math.round(table[k * 3 + 2] * 255)})`;
    ctx.fillRect(x0 + ((x1 - x0) * k) / steps, 18, (x1 - x0) / steps + 1, 14);
  }
  ctx.strokeStyle = "#666"; ctx.strokeRect(x0, 18, x1 - x0, 14);
  ctx.fillStyle = "#222"; ctx.font = "12px sans-serif";
  ctx.fillText(label, x0, 13);
  niceTicks(lo, hi, 6).forEach((v) => {
    const x = x0 + ((v - lo) / (hi - lo || 1)) * (x1 - x0);
    if (x < x0 - 0.5 || x > x1 + 0.5) return;
    const t = formatValue(v, hi - lo || 1);
    const w = ctx.measureText(t).width;
    ctx.fillRect(x, 32, 1, 4);
    ctx.fillText(t, Math.min(x1 - w, Math.max(x0, x - w / 2)), 48);
  });
  return c.toDataURL("image/png");
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
    if (/^derived\//.test(f.field)) {
      r.methods.push("Stress and strain are derived from the displacement: constant strain per linear tetrahedron ε = sym(∇u), σ = λ tr(ε) I + 2μ ε with the run's own props.txt material, element values averaged to nodes by volume.");
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

const reportSectionCount = (d) => ["setup", "mesh", "view", "profile", "stats", "observations", "source"].filter((k) => d[k]).length + 1;

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
  if (L.stats.open && L.stats.result && sig !== L.stats.sig && !L.stats.busy) computeStats();
  if (L.obs.result && obsSignature() !== L.obs.sig && !L.obs.busy) compareObservations();
  if (L.src.result && sig !== L.src.sig && !L.src.busy) compareSource();
  if (!L.line && R()?.frame?.()) drawLine();
}

function install() {
  if (!byId("studio-analysis-host")) { setTimeout(install, 500); return; }
  render();
  setInterval(follow, 700);
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  window.GeoIDResultsAnalysis = { plot, drawGlyphs, computeStats, compareObservations, compareSource, invertSource, buildModelReport, openModelReport, render, state: L };
}
