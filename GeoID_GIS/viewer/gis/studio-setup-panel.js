/**
 * THE MODEL TREE'S MIDDLE: Materials, Physics and Study, between building the
 * geometry and meshing it — the order a finite-element model is defined in,
 * and the order COMSOL's model builder reads.
 *
 * Everything that decides what a solve IS lives in fem-setup.js, which is
 * pure and tested: the material library, the conditions each physics offers,
 * the checklist, and the files GALES reads (props.txt, the compiled
 * *_ic_bc.hpp, spec.json). This file draws those decisions and carries them
 * through the pipeline the sidecar already runs:
 *
 *   write the study  → fem_runs/<name>/spec.json and its gmsh script
 *   mesh with gmsh   → the sidecar's /jobs/gmsh, then input/<name>.msh in the run
 *   prepare the deck → /jobs/gales/prepare (setup, props, header, mesh, build)
 *   solve            → /jobs/gales, here or on a compute target
 *   open results     → the Results tab, on the run just solved
 *
 * The targets — which domains need a material, which faces can carry a
 * condition — are READ OFF THE MODEL (GeoIDMeshStudio.setupTargets), never
 * kept here, so adding a solid or changing a flag in the Domains panel is
 * seen here within a beat.
 *
 * A SOLVE IS NOT STARTED WITHOUT A PRESS AND, ON THIS MACHINE, A SECOND ONE.
 * A real-size GALES run on a laptop can take the machine down; a compute
 * target is where one belongs, and the Solve button says so before it runs
 * locally.
 */

import {
  MATERIALS, MATERIAL_PROPS, PHYSICS, defaultSetup, domainProperties, materialsPlan, propsText,
  icBcHeader, studySpec, studyTimes, setupSummary, sweepParameters, sweepValues, sweepSetups, sweepManifest,
} from "./fem-setup.js?v=20260919-84293b8";
import { flagCheck } from "./mesh-flags.js?v=20260919-84293b8";
import { requirementLines, GENERAL } from "./gales-contract.js?v=20260919-84293b8";
import { parseTable, guessColumns, buildGrid, pointwiseText, orderCheck } from "./tomography.js?v=20260919-84293b8";
import * as THREE from "../vendor/three.module.js";

const STORE_KEY = "geoid-studio:fem-setup";
const byId = (id) => document.getElementById(id);
const studio = () => window.GeoIDMeshStudio;
const sidecar = () => window.GeoIDResearch?.sidecar;
const store = () => window.GeoIDResearch?.store;

let setup = loadSetup();
let targets = { dim: 3, source: "studio", domains: [], faces: [] };
let fingerprint = "";
let saveTimer = 0;
const openCards = new Map();
const job = { step: "", id: "", status: "", text: "", runDir: "" };
// A parameter sweep: one study per value, and the manifest that says so.
const sweep = { key: "", mode: "range", from: "", to: "", count: 5, scale: "linear", text: "", running: false };
let computeTargets = null;

function loadSetup() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (stored && PHYSICS[stored.physics]) return { ...defaultSetup(), ...stored, study: { ...defaultSetup().study, ...(stored.study || {}) } };
  } catch (e) { /* storage refused: start blank */ }
  return defaultSetup();
}

function saveSetup() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(setup)); } catch (e) { /* not kept, still used */ }
  }, 300);
}

/* ── small DOM helpers ─────────────────────────────────────────────────── */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}

let uid = 0;
function row(label, control, title) {
  if (!control.id) control.id = `fem-${(uid += 1)}`;
  const r = el("div", { class: "studio-row" }, el("label", { for: control.id, title }, label), control);
  return r;
}

function numberInput(value, onChange, { placeholder = "", step = "any" } = {}) {
  const input = el("input", { class: "studio-input", type: "number", step, placeholder });
  input.value = value === undefined || value === null || Number.isNaN(value) ? "" : String(value);
  input.addEventListener("keydown", (event) => event.stopPropagation());
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

function selectOf(options, value, onChange) {
  const node = el("select", { class: "studio-select wide" });
  for (const opt of options) {
    if (opt.group) {
      const g = el("optgroup", { label: opt.group });
      opt.options.forEach(([v, label]) => g.append(el("option", { value: v }, label)));
      node.append(g);
    } else node.append(el("option", { value: opt[0] }, opt[1]));
  }
  node.value = value ?? "";
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

function card(key, title, open = false, badge = "", level = "") {
  const details = el("details", { class: "gis-tool-section studio-fold-section fem-card" });
  details.open = openCards.has(key) ? openCards.get(key) : open;
  const summary = el("summary", {}, title);
  summary.dataset.toolIcon = "1";
  if (badge) summary.append(el("span", { class: "fem-chip", "data-level": level || null }, badge));
  const body = el("div", { class: "gis-tool-body" });
  details.append(summary, body);
  details.addEventListener("toggle", () => openCards.set(key, details.open));
  return { details, body, summary };
}

/** A short muted sentence. Prose is a note, never a box. */
const note = (text) => el("p", { class: "studio-readout" }, text);

/** Aligned facts: [[term, value], …]. */
function facts(pairs) {
  const dl = el("dl", { class: "st-facts" });
  pairs.filter(Boolean).forEach(([k, v]) => dl.append(el("dt", {}, k), el("dd", {}, v)));
  return dl;
}

const fmt = (v) => {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(3).replace(/\.?0+e/, "e") : String(Number(v.toPrecision(6)));
};

/* ── Materials ─────────────────────────────────────────────────────────── */

function materialOptions(physics) {
  const needs = PHYSICS[physics].props;
  const groups = new Map();
  for (const m of MATERIALS) {
    if (!needs.every((k) => Number.isFinite(m[k]))) continue;
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push([m.id, m.name]);
  }
  return [["", "— no material —"], ...[...groups].map(([group, options]) => ({ group, options }))];
}

/* ── Tomography: the material at depth from a grid ───────────────────────── */

const GRID_KEY = "geoid-studio:fem-tomography";
const MODEL_TO_SCENE = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const tomo = { table: null, name: "", grid: null, options: { coordScale: 1, zIsDepth: false, offset: [0, 0, 0], unitsKm: true, staticRatio: 1 }, message: "", level: "", cloud: null, reordered: false };

/** The grid as written last time, rebuilt from its own GALES text. */
function restoreGrid() {
  if (!setup.pointwise?.file) return;
  try {
    const text = localStorage.getItem(GRID_KEY);
    if (!text) return;
    const grid = buildGrid(parseTable(text), { dim: setup.pointwise.dim });
    if (grid.ok) { tomo.grid = grid; tomo.name = setup.pointwise.source || "restored grid"; drawCloud(); }
  } catch (e) { /* kept only for this session */ }
}

function applyGrid() {
  if (!tomo.table) return;
  const columns = guessColumns(tomo.table);
  const dim = targets.dim === 2 ? 2 : 3;
  const grid = buildGrid(tomo.table, { ...tomo.options, columns, dim });
  if (!grid.counts || !grid.ok && !grid.rho) { tomo.grid = null; tomo.message = grid.message; tomo.level = "error"; return; }
  tomo.reordered = !orderCheck(tomo.table, columns, dim).ok;
  tomo.grid = grid;
  tomo.message = grid.ok ? "" : grid.message;
  tomo.level = grid.ok ? "" : "error";
  if (!grid.ok) return;
  setup.pointwise = {
    file: "pointwise_elasticity_data.txt", dim, source: tomo.name, kind: grid.kind,
    counts: grid.counts, bounds: grid.bounds, ranges: grid.ranges,
  };
  try { localStorage.setItem(GRID_KEY, pointwiseText(grid)); } catch (e) { /* too large to keep: this session only */ }
  drawCloud();
}

function removeCloud() {
  if (!tomo.cloud) return;
  tomo.cloud.parent?.remove(tomo.cloud);
  tomo.cloud.geometry.dispose(); tomo.cloud.material.dispose();
  tomo.cloud = null;
  studio()?.refreshVisibility?.();
}

/** Every grid node on the model, coloured by E on a log scale. */
function drawCloud() {
  const visible = tomo.cloud ? tomo.cloud.visible : false;
  removeCloud();
  const g = tomo.grid;
  const anchor = studio()?.ensureAnchor?.() || studio()?.getAnchor?.();
  if (!g?.ok || !anchor) return;
  const { nx, ny, nz } = g.counts;
  const pos = new Float32Array(nx * ny * nz * 3); const col = new Float32Array(nx * ny * nz * 3);
  const [lo, hi] = g.ranges.E.map((v) => Math.log10(v));
  const colour = new THREE.Color();
  for (let k = 0, n = 0; k < nz; k += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1, n += 1) {
    pos[n * 3] = g.x[i]; pos[n * 3 + 1] = g.y[j]; pos[n * 3 + 2] = g.dim === 3 ? g.z[k] : 0;
    const t = hi > lo ? (Math.log10(g.E[n]) - lo) / (hi - lo) : 0.5;
    colour.setHSL(0.7 - 0.7 * t, 0.85, 0.55);
    col[n * 3] = colour.r; col[n * 3 + 1] = colour.g; col[n * 3 + 2] = colour.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geometry.applyMatrix4(MODEL_TO_SCENE);
  geometry.computeBoundingSphere();
  tomo.cloud = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
  tomo.cloud.name = "studio-tomography-grid";
  tomo.cloud.renderOrder = 880;
  tomo.cloud.visible = visible;
  anchor.add(tomo.cloud);
  studio()?.refreshVisibility?.();
}

function drawProfile(canvas, g) {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(200, canvas.clientWidth || 260); const h = 150;
  canvas.width = w * ratio; canvas.height = h * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const prof = g.byDepth;
  const zLo = prof[0].z; const zHi = prof.at(-1).z;
  const pad = { l: 38, r: 38, t: 8, b: 18 };
  const yOf = (z) => pad.t + (1 - (z - zLo) / Math.max(1e-9, zHi - zLo)) * (h - pad.t - pad.b);
  const series = [["E", "#ff6b9d", (v) => v / 1e9, "GPa"], ["rho", "#52e4e8", (v) => v, "kg/m³"]];
  ctx.font = "10px 'Exo 2', sans-serif";
  series.forEach(([key, colour, f, unit], s) => {
    const vals = prof.map((p) => f(p[key]));
    const lo = Math.min(...vals); const hi = Math.max(...vals);
    const xOf = (v) => pad.l + ((v - lo) / Math.max(1e-9, hi - lo)) * (w - pad.l - pad.r);
    ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.beginPath();
    prof.forEach((p, i) => { const x = xOf(f(p[key])); const y = yOf(p.z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.textAlign = s ? "right" : "left";
    ctx.fillText(`${key === "E" ? "E" : "ρ"} ${Number(lo.toPrecision(3))}–${Number(hi.toPrecision(3))} ${unit}`, s ? w - 2 : 2, h - 4);
  });
  ctx.fillStyle = "rgba(232,230,240,0.7)"; ctx.textAlign = "left";
  ctx.fillText(`${Math.round(zHi)} m`, 2, pad.t + 8);
  ctx.fillText(`${Math.round(zLo)} m`, 2, h - pad.b - 2);
}

function tomographyCard(host) {
  const pw = setup.pointwise;
  const c = card("mat:tomography", "Tomography grid", false, pw?.file ? `${pw.counts.nx}×${pw.counts.ny}${pw.dim === 3 ? `×${pw.counts.nz}` : ""}` : "", pw?.file ? "ok" : "");
  c.body.append(note("A rectangular grid of x y z rho E nu, or x y z Vp [Vs] (Brocher 2005). It sets the material everywhere, interpolated at depth."));
  const picker = el("input", { type: "file", accept: ".txt,.csv,.dat,.xyz,.tsv", hidden: true });
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0]; picker.value = "";
    if (!file) return;
    tomo.table = parseTable(await file.text());
    tomo.name = file.name;
    applyGrid();
    changed(true);
  });
  const load = el("button", { class: pw?.file ? "studio-secondary" : "studio-primary", type: "button" }, pw?.file ? "Replace grid…" : "Load grid…");
  load.addEventListener("click", () => picker.click());
  const actions = el("div", { class: "studio-actions" }, load);
  if (pw?.file) {
    const remove = el("button", { class: "studio-secondary", type: "button", title: "Back to the domains' own materials" }, "Remove");
    remove.addEventListener("click", () => { setup.pointwise = null; tomo.grid = null; tomo.table = null; removeCloud(); try { localStorage.removeItem(GRID_KEY); } catch (e) { /* ignore */ } changed(true); });
    actions.append(remove);
  }
  c.body.append(actions, picker);
  if (tomo.table) {
    const cols = guessColumns(tomo.table);
    const o = tomo.options;
    const redo = () => { applyGrid(); changed(true); };
    c.body.append(row("Coordinates in", selectOf([["1", "metres"], ["1000", "kilometres"]], String(o.coordScale), (v) => { o.coordScale = Number(v); redo(); })));
    if (targets.dim !== 2) c.body.append(row("z column is", selectOf([["up", "elevation (up +)"], ["down", "depth (down +)"]], o.zIsDepth ?? cols.zIsDepth ? "down" : "up", (v) => { o.zIsDepth = v === "down"; redo(); })));
    ["x", "y", "z"].slice(0, targets.dim === 2 ? 2 : 3).forEach((axis, i) => {
      c.body.append(row(`Subtract from ${axis} (m)`, numberInput(o.offset[i], (v) => { o.offset[i] = Number(v) || 0; redo(); }), "Moves the grid into the model's frame, e.g. a UTM origin"));
    });
    if (cols.kind === "velocity") {
      c.body.append(row("Velocities in", selectOf([["km", "km/s"], ["m", "m/s"]], o.unitsKm ? "km" : "m", (v) => { o.unitsKm = v === "km"; redo(); })));
      c.body.append(row("Static / dynamic E", numberInput(o.staticRatio, (v) => { o.staticRatio = Number(v) || 1; redo(); }), "Tomography gives dynamic moduli; rock mass is often 0.3–1 of them statically"));
    }
  }
  if (tomo.message) c.body.append(el("p", { class: `studio-readout is-${tomo.level || "warning"}` }, tomo.message));
  const g = tomo.grid;
  if (g?.ok && pw?.file) {
    const fmtR = ([a, b], f = (v) => v) => `${Number(f(a).toPrecision(3))}–${Number(f(b).toPrecision(3))}`;
    const span = (i) => `${Math.round(g.bounds.min[i]).toLocaleString()} to ${Math.round(g.bounds.max[i]).toLocaleString()} m`;
    c.body.append(facts([
      ["File", tomo.name],
      ["Nodes", `${g.counts.nx} × ${g.counts.ny}${g.dim === 3 ? ` × ${g.counts.nz}` : ""}${g.kind === "velocity" ? " (from velocities)" : ""}`],
      ["Density", `${fmtR(g.ranges.rho)} kg/m³`],
      ["Young's modulus", `${fmtR(g.ranges.E, (v) => v / 1e9)} GPa`],
      ["Poisson's ratio", fmtR(g.ranges.nu)],
      ["x", span(0)], ["y", span(1)], g.dim === 3 ? ["z", span(2)] : null,
    ]));
    if (tomo.reordered) c.body.append(el("p", { class: "studio-readout is-warning", title: "GALES indexes rows z, then y, then x, each ascending, and does not check" }, "Rows were out of GALES's order — rewritten in order."));
    if (g.counts.duplicates || g.counts.clamped) c.body.append(note(`${g.counts.duplicates ? `${g.counts.duplicates} duplicate rows (last kept). ` : ""}${g.counts.clamped ? `${g.counts.clamped} velocities outside Brocher's 1.5–8.5 km/s.` : ""}`));
    const canvas = el("canvas", { class: "fem-profile" });
    c.body.append(el("p", { class: "studio-group-title" }, "Mean with depth"), canvas);
    setTimeout(() => drawProfile(canvas, g), 0);
    const show = el("input", { type: "checkbox" });
    show.checked = Boolean(tomo.cloud?.visible);
    show.addEventListener("change", () => { if (!tomo.cloud) drawCloud(); if (tomo.cloud) { tomo.cloud.visible = show.checked; studio()?.refreshVisibility?.(); } });
    c.body.append(el("label", { class: "studio-check" }, show, "Show nodes on the model"));
  }
  host.append(c.details);
}

function renderMaterials(host) {
  host.textContent = "";
  if (setup.physics === "solid") tomographyCard(host);
  const P = PHYSICS[setup.physics];
  const solids = targets.domains.filter((d) => !d.void);
  if (!targets.domains.length) {
    host.append(note("No domains yet. Add geometry, or bring a terrain from the GIS page."));
    return;
  }
  const plan = materialsPlan(targets.domains, setup.materials);
  const said = setup.pointwise?.file ? "The tomography grid above sets the material everywhere; a domain's own material below is written only as the fallback." : plan.mode === "uniform" ? "One material everywhere (uniform)." : plan.mode === "layers" ? `${plan.layers.length} horizontal layers, bottom first — GALES reads them z-wise.` : "No material yet.";
  host.append(note(`${P.label.split(" (")[0]} needs ${P.props.map((k) => MATERIAL_PROPS[k].label.toLowerCase()).join(", ")}.`));
  if (setup.pointwise?.file) host.append(el("p", { class: "studio-readout is-ok" }, "Set by the tomography grid; domain materials are the fallback."));
  else if (plan.mode === "uniform" || plan.mode === "layers") host.append(el("p", { class: "studio-readout is-ok" }, plan.mode === "uniform" ? "Uniform material." : `${plan.layers.length} z-wise layers.`));
  if (!setup.pointwise?.file && plan.mode !== "none") (plan.issues || []).forEach((text) => host.append(el("p", { class: "studio-readout is-warning" }, text)));
  const actions = el("div", { class: "studio-actions" });
  const first = solids.find((d) => setup.materials[d.flag]?.id);
  const all = el("button", { class: "studio-secondary", type: "button", title: "Give every domain the material of the first one that has one" }, "Copy to all domains");
  all.disabled = !first;
  all.addEventListener("click", () => {
    solids.forEach((d) => { setup.materials[d.flag] = { id: setup.materials[first.flag].id, overrides: { ...(setup.materials[first.flag].overrides || {}) } }; });
    changed();
  });
  actions.append(all);
  if (solids.length > 1) host.append(actions);

  for (const d of targets.domains) {
    const a = setup.materials[d.flag];
    const name = a?.id ? MATERIALS.find((m) => m.id === a.id)?.name : "";
    const c = card(`mat:${d.flag}`, `${d.name}`, !a?.id && !d.void, d.void ? "cut" : name || "no material", d.void ? "" : name ? "ok" : setup.pointwise?.file ? "" : "error");
    c.summary.title = d.void ? "A cut: no material" : name ? `${name}` : "No material yet";
    if (d.void) {
      c.body.append(note("A cut: nothing is solved inside it."));
      host.append(c.details);
      continue;
    }
    c.body.append(row("Material", selectOf(materialOptions(setup.physics), a?.id || "", (v) => {
      if (!v) delete setup.materials[d.flag];
      else setup.materials[d.flag] = { id: v, overrides: {} };
      changed();
    })));
    if (a?.id) {
      const base = MATERIALS.find((m) => m.id === a.id) || {};
      const props = domainProperties(a);
      for (const key of P.props) {
        const spec = MATERIAL_PROPS[key];
        const edited = a.overrides?.[key];
        const input = numberInput(edited ?? "", (v) => {
          a.overrides = a.overrides || {};
          if (v === "") delete a.overrides[key]; else a.overrides[key] = Number(v);
          changed();
        }, { placeholder: fmt(base[key]) });
        c.body.append(row(`${spec.label}${spec.unit ? ` (${spec.unit})` : ""}`, input, `Library value ${fmt(base[key])}; blank keeps it. In use: ${fmt(props[key])}`));
      }
      c.body.append(note(`Flag ${d.flag} · z ${fmt(d.zMin)} to ${fmt(d.zMax)} m. Blank keeps the library value.`));
    }
    host.append(c.details);
  }
}

/* ── Physics ───────────────────────────────────────────────────────────── */

function renderPhysics(host) {
  host.textContent = "";
  const P = PHYSICS[setup.physics];
  host.append(row("Physics", selectOf(Object.entries(PHYSICS).map(([k, p]) => [k, p.label]), setup.physics, (v) => {
    setup.physics = v;
    setup.conditions = {};
    setup.initial = {};
    setup.options = {};
    changed(true);
  })));
  host.append(note(`Solves for ${P.fields}. Faces with no condition are ${P.conditions.free.label.toLowerCase().replace(/ \(.*\)/, "")}.`));

  if (P.options.length || P.initial.length) {
    const c = card("phys:options", "Options and initial values");
    for (const o of P.options) {
      if (o.kind === "bool") {
        const box = el("input", { type: "checkbox" });
        box.checked = Boolean(setup.options[o.key] ?? o.def);
        box.addEventListener("change", () => { setup.options[o.key] = box.checked; changed(); });
        c.body.append(el("label", { class: "studio-check" }, box, ` ${o.label}`));
      } else {
        c.body.append(row(o.label, numberInput(setup.options[o.key] ?? o.def, (v) => { setup.options[o.key] = v === "" ? undefined : Number(v); changed(); })));
      }
    }
    for (const i of P.initial) {
      c.body.append(row(i.label, numberInput(setup.initial[i.key] ?? "", (v) => { if (v === "") delete setup.initial[i.key]; else setup.initial[i.key] = Number(v); changed(); }, { placeholder: String(i.def) })));
    }
    host.append(c.details);
  }

  if (!targets.faces.length) {
    host.append(note("No flagged faces yet. Faces carry flags in Model ▸ Domains."));
    return;
  }
  host.append(el("p", { class: "studio-group-title" }, "Boundary conditions"));
  for (const f of targets.faces) {
    const cond = setup.conditions[f.flag] || { type: "free", values: {} };
    const spec = P.conditions[cond.type] || P.conditions.free;
    const c = card(`bc:${f.flag}`, `${f.flag} · ${f.name}`, false, cond.type === "free" ? "free" : spec.label.split(" —")[0].split(" (")[0], cond.type === "free" ? "" : "ok");
    c.summary.title = "Hover or open to light these faces on the model";
    c.details.addEventListener("toggle", () => studio()?.highlightFlag?.(c.details.open ? f.flag : null));
    c.summary.addEventListener("mouseenter", () => studio()?.highlightFlag?.(f.flag));
    c.summary.addEventListener("mouseleave", () => studio()?.highlightFlag?.(c.details.open ? f.flag : null));
    c.body.append(row("Condition", selectOf(Object.entries(P.conditions).map(([k, x]) => [k, x.label]), cond.type, (v) => {
      if (v === "free") delete setup.conditions[f.flag];
      else {
        const values = {};
        (P.conditions[v].values || []).forEach((x) => { if (x.def !== undefined) values[x.key] = x.def; });
        setup.conditions[f.flag] = { type: v, values };
      }
      openCards.set(`bc:${f.flag}`, true);
      changed();
    })));
    for (const x of spec.values || []) {
      const current = cond.values?.[x.key];
      if (x.choices) {
        c.body.append(row(x.label, selectOf(x.choices.map((ch) => [ch, ch]), current ?? x.def, (v) => { cond.values[x.key] = v; setup.conditions[f.flag] = cond; changed(); })));
      } else {
        c.body.append(row(x.label, numberInput(current ?? "", (v) => {
          if (v === "") delete cond.values[x.key]; else cond.values[x.key] = Number(v);
          setup.conditions[f.flag] = cond;
          changed();
        }, { placeholder: x.optional ? "not set" : String(x.def ?? 0) })));
      }
    }
    c.body.append(note(`Faces: ${f.names.join(", ")}.`));
    host.append(c.details);
  }
}

/* ── Study ─────────────────────────────────────────────────────────────── */

const STEP_GROUP = { geometry: "add", materials: "materials", physics: "physics", study: "study", mesh: "mesh" };

function runDir() {
  const project = store()?.getActive?.();
  return project ? `fem_runs/${setup.study.name}` : "";
}

function say(text, level = "") {
  job.text = text;
  job.level = level;
  const node = byId("fem-study-status");
  if (node) { node.textContent = text; node.className = `studio-readout${level ? ` is-${level}` : ""}`; }
  try { document.dispatchEvent(new CustomEvent("geoid-studio:notice", { detail: { text, level: level === "ok" ? "" : level, source: "study" } })); } catch (e) { /* no toast */ }
}

async function listTargets() {
  if (!sidecar()?.isConnected?.()) return [];
  try { computeTargets = await sidecar().listCompute(); } catch (e) { computeTargets = null; }
  const list = computeTargets?.targets || [];
  // The sidecar answers a map keyed by NAME; the name is the key, not a field,
  // so `Object.values` alone offered "[object Object]" as a target.
  return Array.isArray(list) ? list : Object.entries(list).map(([name, t]) => ({ name, ...(t || {}) }));
}

function renderStudy(host) {
  host.textContent = "";
  const st = setup.study;
  const summary = setupSummary(setup, targets);
  const params = card("study:params", "Parameters", true);
  const name = el("input", { class: "studio-input", type: "text", spellcheck: "false" });
  name.value = st.name;
  name.addEventListener("keydown", (event) => event.stopPropagation());
  name.addEventListener("change", () => { st.name = name.value.trim(); changed(); });
  params.body.append(row("Name", name, "A folder name: fem_runs/<name> in the open project"));
  params.body.append(row("Kind", selectOf([["stationary", "Stationary"], ["transient", "Time dependent"]], st.kind, (v) => { st.kind = v; changed(); })));
  if (st.kind === "transient") {
    params.body.append(row("Time step", numberInput(st.step, (v) => { st.step = Number(v); changed(); })));
    params.body.append(row("End time", numberInput(st.end, (v) => { st.end = Number(v); changed(); })));
    params.body.append(row("Write every", numberInput(st.printEvery, (v) => { st.printEvery = Number(v); changed(); }, { step: "1" }), "Steps between written results"));
  }
  const times = studyTimes(st);
  params.body.append(row("MPI ranks", numberInput(st.ranks, (v) => { st.ranks = Math.max(1, Math.round(Number(v) || 1)); changed(); }, { step: "1" }), "The mesh is partitioned for this many ranks"));
  const where = selectOf([["local", "This machine (mpirun)"]], st.target || "local", (v) => { st.target = v; changed(); });
  params.body.append(row("Runs on", where, "A compute target from the FEM Run page, or this machine"));
  listTargets().then((list) => {
    for (const t of list) {
      const n = t.name || t;
      if ([...where.options].some((o) => o.value === n)) continue;
      where.append(el("option", { value: n }, `${n}${t.host ? ` (${t.host})` : t.image ? ` (container ${t.image})` : ""}`));
    }
    where.value = st.target || "local";
  });
  params.body.append(note(`${times.steps} step${times.steps === 1 ? "" : "s"} to t = ${fmt(times.final_time)} · ${targets.dim}D · ${targets.domains.length} domain${targets.domains.length === 1 ? "" : "s"} · ${targets.faces.length} face flag${targets.faces.length === 1 ? "" : "s"}`));
  host.append(params.details);

  // Against the solver mesh as well, once one is open: a condition on a flag
  // gmsh did not write reaches nothing, and nothing says so at solve time.
  const real = window.GeoIDRealMesh;
  const meshIssues = real?.report ? flagCheck(setup, real.report) : [];
  const issues = [...summary.issues, ...meshIssues];
  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.length - errors;
  const check = card("study:check", "Checklist", errors > 0, errors ? `${errors} to fix` : warnings ? `${warnings} note${warnings === 1 ? "" : "s"}` : "ready", errors ? "error" : warnings ? "warning" : "ok");
  if (!issues.length) check.body.append(el("p", { class: "studio-readout is-ok" }, "Ready to solve."));
  const list = el("ul", { class: "fem-checklist" });
  for (const issue of issues) {
    const li = el("li", { class: `is-${issue.level}` }, issue.text);
    const group = STEP_GROUP[issue.step];
    if (group) { li.title = `Open ${group}`; li.addEventListener("click", () => studio()?.showGroup?.(group)); }
    list.append(li);
  }
  if (issues.length) check.body.append(list);
  check.body.append(note(real?.report ? `Checked against the solver mesh ${real.name}.` : "Open the solver mesh (Mesh tab) to check flags against it."));
  host.append(check.details);

  const files = card("study:files", "Generated files");
  const physics = PHYSICS[setup.physics];
  const plan = materialsPlan(targets.domains, setup.materials);
  let header = "";
  try { header = icBcHeader(setup.physics, setup); } catch (e) { header = String(e.message); }
  files.body.append(note(`GALES ${physics.family}. Written into the run; Prepare compiles them.`));
  files.body.append(el("p", { class: "studio-group-title" }, "props.txt"), el("pre", { class: "fem-pre" }, propsText(setup.physics, plan, { dim: targets.dim, options: setup.options })));
  files.body.append(el("p", { class: "studio-group-title" }, physics.header), el("pre", { class: "fem-pre" }, header));
  host.append(files.details);

  // WHAT GALES NEEDS, from the contract: the solver and reference the sidecar
  // will clone, what the mesh and the material must carry, what is reserved,
  // and what bounds the time step — so a study is written against
  // requirements that are on the page rather than in somebody's memory.
  const needs = card("study:needs", "What GALES needs", false, physics.family);
  const dl = el("dl", { class: "st-facts" });
  for (const line of requirementLines(setup.physics, targets.dim)) dl.append(el("dt", {}, line.head), el("dd", {}, line.text));
  needs.body.append(dl);
  const rules = el("details", { class: "studio-fold" }, el("summary", {}, "Every family"));
  const ul = el("ul", { class: "studio-readout" });
  GENERAL.forEach((g) => ul.append(el("li", {}, g.text)));
  rules.append(ul);
  needs.body.append(rules);
  host.append(needs.details);

  const pipe = card("study:pipeline", "Run", true);
  const blocked = errors > 0;
  const connected = Boolean(sidecar()?.isConnected?.());
  const hasProject = Boolean(store()?.getActive?.());
  const step = (label, title, fn, disabled) => {
    const b = el("button", { class: "studio-secondary", type: "button", title }, label);
    b.disabled = Boolean(disabled) || Boolean(job.status === "running");
    b.addEventListener("click", fn);
    return b;
  };
  const steps = el("div", { class: "fem-steps" },
    step("Write study", "spec.json and the gmsh script into fem_runs/<name> of the open project", writeStudy, blocked || !hasProject),
    step("Mesh with gmsh", "The sidecar runs the model's gmsh script; the mesh is filed in the run", meshStudy, blocked || !hasProject || !connected),
    step("Prepare deck", "Sidecar: setup.txt, props.txt, the generated header, the mesh for N ranks, and the build", prepareStudy, blocked || !hasProject || !connected),
    step("Solve", "Run the solver here or on the chosen compute target", solveStudy, blocked || !hasProject || !connected),
    step("Open results", "Open this run in the Results tab", openResults, !hasProject),
  );
  pipe.body.append(steps);
  const why = !hasProject ? "Open a project (Research ▸ Projects) to write a study."
    : !connected ? "Meshing, preparing and solving need the sidecar (Settings ▸ Sidecar)."
      : blocked ? "Fix the checklist first." : "";
  pipe.body.append(el("div", { id: "fem-study-status", class: `studio-readout${job.level ? ` is-${job.level}` : ""}` }, job.text));
  if (why) pipe.body.append(note(why));
  host.append(pipe.details);

  const params2 = sweepParameters(setup, targets);
  const sw = card("study:sweep", "Parameter sweep", false, sweep.running ? "running" : "");
  if (!params2.length) {
    sw.body.append(note("Give a domain a material or set a condition first: a sweep varies one of their numbers."));
  } else {
    if (!params2.some((p) => p.key === sweep.key)) {
      sweep.key = params2[0].key;
      const b = params2[0].base;
      sweep.from = Number.isFinite(b) ? b * 0.5 : ""; sweep.to = Number.isFinite(b) ? b * 1.5 : "";
    }
    sw.body.append(note("One study per value of one parameter, everything else as set: how sensitive the answer is to what is least known. Each run is written into fem_runs/, with a manifest the Analysis tab reads back as a response curve."));
    sw.body.append(row("Vary", selectOf(params2.map((p) => [p.key, p.label]), sweep.key, (v) => {
      sweep.key = v;
      const b = params2.find((p) => p.key === v)?.base;
      sweep.from = Number.isFinite(b) ? b * 0.5 : ""; sweep.to = Number.isFinite(b) ? b * 1.5 : "";
      rerender("study");
    })));
    const current = params2.find((p) => p.key === sweep.key);
    sw.body.append(note(`As set now: ${Number.isFinite(current?.base) ? fmt(current.base) : "—"}.`));
    sw.body.append(row("Values", selectOf([["range", "A range"], ["list", "A typed list"]], sweep.mode, (v) => { sweep.mode = v; rerender("study"); })));
    if (sweep.mode === "list") {
      const t = el("input", { class: "studio-input", type: "text", spellcheck: "false", placeholder: "e.g. 5e6, 1e7, 2e7" });
      t.value = sweep.text;
      t.addEventListener("keydown", (event) => event.stopPropagation());
      t.addEventListener("change", () => { sweep.text = t.value; rerender("study"); });
      sw.body.append(row("List", t));
    } else {
      sw.body.append(row("From", numberInput(sweep.from, (v) => { sweep.from = v; rerender("study"); })));
      sw.body.append(row("To", numberInput(sweep.to, (v) => { sweep.to = v; rerender("study"); })));
      sw.body.append(row("Runs", numberInput(sweep.count, (v) => { sweep.count = v; rerender("study"); }, { step: "1" })));
      sw.body.append(row("Spacing", selectOf([["linear", "Linear"], ["log", "Logarithmic"]], sweep.scale, (v) => { sweep.scale = v; rerender("study"); })));
    }
    const got = sweepValues(sweep);
    if (got.error) sw.body.append(el("p", { class: "studio-readout is-warning" }, got.error));
    else sw.body.append(note(`${got.values.length} runs: ${got.values.map(fmt).join(", ")} → ${sweep.base || setup.study.name}_sweep_0 … ${got.values.length - 1}.`));
    const b1 = el("button", { class: "studio-secondary", type: "button", title: "Every run's spec, gmsh script and props into fem_runs/, and the manifest" }, "Write sweep");
    b1.disabled = Boolean(got.error) || blocked || !hasProject || sweep.running;
    b1.addEventListener("click", () => writeSweep());
    const b2 = el("button", { class: "studio-secondary", type: "button", title: "Mesh once, then prepare and solve every run on the chosen compute target" }, "Mesh, prepare and solve all");
    b2.disabled = Boolean(got.error) || blocked || !hasProject || !connected || sweep.running;
    b2.addEventListener("click", () => solveSweep());
    sw.body.append(el("div", { class: "studio-actions" }, b1, b2));
  }
  host.append(sw.details);
}

async function writeStudy() {
  const project = store()?.getActive?.();
  if (!project) { say("Open a project first.", "error"); return; }
  const S = studio();
  const name = setup.study.name;
  const script = S?.gmshScriptFor?.(name);
  const spec = studySpec(setup, targets, {
    mesh: `${name}.msh`, dim: targets.dim,
    provenance: { kind: targets.source === "gis" ? "GIS terrain model" : "studio model", written_at: new Date().toISOString(), domains: targets.domains.map((d) => ({ flag: d.flag, name: d.name, void: d.void })), faces: targets.faces.map((f) => ({ flag: f.flag, name: f.name })) },
  });
  try {
    await store().writeProjectFile(`${runDir()}/spec.json`, JSON.stringify(spec, null, 2));
    if (script) await store().writeProjectFile(`${runDir()}/input/${name}_gmsh.py`, script);
    // GALES reads the tomography from input/, in the order it indexes.
    if (setup.pointwise?.file && tomo.grid?.ok) await store().writeProjectFile(`${runDir()}/input/${setup.pointwise.file}`, pointwiseText(tomo.grid));
    else if (setup.pointwise?.file) { say("The tomography grid is not loaded in this session: load it again (Materials) before writing the study.", "error"); return spec; }
    job.runDir = runDir();
    say(`Written: ${runDir()}/spec.json${script ? ` and input/${name}_gmsh.py` : ""}.${script ? "" : " A GIS terrain's gmsh script comes from the Model Builder's package (Build): put its .msh in the run's input/."}`, "ok");
  } catch (error) {
    say(`Could not write the study: ${error.message}`, "error");
  }
  return spec;
}

/** Run `fn` with the page's setup swapped for a sweep run's, and put it back whatever happens. */
async function withSetup(next, fn) {
  const keep = setup;
  setup = next;
  try { return await fn(); } finally { setup = keep; }
}

export async function writeSweep() {
  const project = store()?.getActive?.();
  if (!project) { say("Open a project first.", "error"); return null; }
  const got = sweepValues(sweep);
  if (got.error) { say(got.error, "error"); return null; }
  const param = sweepParameters(setup, targets).find((p) => p.key === sweep.key);
  if (!param) { say("Choose what to vary.", "error"); return null; }
  const runs = sweepSetups(setup, sweep.key, got.values);
  // The page's setup is swapped for each run's while it is written, and a
  // `say` mid-write re-renders this card against the run's name; the base
  // is kept so the preview reads the study's name throughout.
  sweep.base = setup.study.name;
  sweep.running = true;
  try {
    for (const [k, run] of runs.entries()) {
      say(`Writing ${run.name} (${k + 1} of ${runs.length})…`);
      await withSetup(run.setup, writeStudy);
    }
    const manifest = sweepManifest({ base: setup.study.name, parameter: sweep.key, label: param.label, values: got.values, runs });
    const path = `fem_runs/${setup.study.name}_sweep.json`;
    await store().writeProjectFile(path, JSON.stringify(manifest, null, 2));
    say(`Written: ${runs.length} runs (${runs[0].name} … ${runs.at(-1).name}) and ${path}.`, "ok");
    return { manifest, path };
  } catch (error) {
    say(`Could not write the sweep: ${error.message}`, "error");
    return null;
  } finally {
    sweep.running = false;
    sweep.base = "";
    rerender("study");
  }
}

async function solveSweep() {
  const project = store()?.getActive?.();
  const target = setup.study.target && setup.study.target !== "local" ? setup.study.target : "";
  const written = await writeSweep();
  if (!written) return;
  const runs = sweepSetups(setup, sweep.key, written.manifest.values);
  if (!target && !window.confirm(`Solve ${runs.length} runs one after another on THIS machine with ${setup.study.ranks} MPI rank(s) each?\n\nA real-size model can use all of this computer's memory and stop it responding. A compute target (Runs on) is where sweeps belong. Only continue for a small test mesh.`)) {
    say("Written, not solved: choose a compute target, or confirm a small local test.", "warning");
    return;
  }
  sweep.running = true;
  try {
    // The geometry is the same for every run: mesh once, file it in each.
    await withSetup(runs[0].setup, meshStudy);
    const text = await store().readProjectFile(`meshes/${runs[0].name}.msh`);
    for (const run of runs.slice(1)) await store().writeProjectFile(`fem_runs/${run.name}/input/${run.name}.msh`, text);
    for (const [k, run] of runs.entries()) {
      say(`Run ${k + 1} of ${runs.length}: ${run.name} (${fmt(run.value)})…`);
      const ok = await withSetup(run.setup, async () => {
        const dir = `${project.dir}/fem_runs/${run.name}`;
        const prep = await sidecar().prepareGales({ dir, cores: run.setup.study.ranks });
        if (!(await waitFor(prep, `Prepare ${run.name}`))) return false;
        const id = await sidecar().runGales(target ? { dir, target, cores: run.setup.study.ranks } : { dir, cores: run.setup.study.ranks });
        return waitFor(id, `Solve ${run.name}`);
      });
      if (!ok) { say(`The sweep stopped at ${run.name}; the runs before it are solved.`, "error"); return; }
    }
    say(`All ${runs.length} runs solved. Analysis ▸ Sweep response reads ${written.path}.`, "ok");
  } catch (error) {
    say(`The sweep could not continue: ${error.message}`, "error");
  } finally {
    sweep.running = false;
    rerender("study");
  }
}

async function waitFor(id, label) {
  job.id = id; job.status = "running"; job.step = label;
  rerender("study");
  say(`${label}: running (job ${id})…`);
  const snap = await sidecar().awaitJob(id, { timeoutMs: 6 * 3600 * 1000, everyMs: 1000 });
  job.status = snap.status;
  const ok = snap.status === "done" && !snap.exit_code;
  // The snapshot carries no log; its `tail` is the last few lines, which is
  // where a prepare says its build failed without failing.
  const tail = (Array.isArray(snap.tail) ? snap.tail : String(snap.output || snap.log || "").split("\n")).map((s) => String(s).trim()).filter(Boolean).slice(-3).join(" · ");
  say(`${label}: ${ok ? "done" : `${snap.status}${snap.exit_code != null ? ` (exit ${snap.exit_code})` : ""}`}.${tail ? ` ${tail}` : ""}${ok ? "" : " The Jobs drawer has the whole log."}`, ok ? "ok" : "error");
  rerender("study");
  return ok;
}

async function meshStudy() {
  const project = store()?.getActive?.();
  const name = setup.study.name;
  const script = studio()?.gmshScriptFor?.(name);
  // A GIS terrain's script is the Model Builder's package, already filed in
  // the project's meshes/ beside the STLs it merges: it is run BY PATH there
  // (the gmsh job's cwd is meshes/, so the relative merges resolve) and the
  // mesh it writes is pointed at <study>.msh like any other. A section's
  // package is <name>_section_gmsh.py.
  const terrain = !script ? studio()?.terrainName?.() : null;
  const scriptPath = terrain ? `${project?.dir}/meshes/${terrain}${targets.dim === 2 ? "_section" : ""}_gmsh.py` : "";
  if (!script && !terrain) { say("Nothing to mesh: add geometry, or open a terrain from the Model Builder.", "warning"); return; }
  if (terrain) {
    const rel = `meshes/${terrain}${targets.dim === 2 ? "_section" : ""}_gmsh.py`;
    let filed = false;
    try { filed = Boolean(await store().readProjectFile(rel)); } catch (error) { filed = false; }
    if (!filed) { say(`The terrain's package is not in this project: build it in the Model Builder (Build ▸ step 6) so ${rel} and its STLs are filed here.`, "error"); return; }
  }
  try {
    const id = await sidecar().runGmsh(script ? { project: project.dir, script, name, dim: targets.dim } : { project: project.dir, scriptPath, name, dim: targets.dim });
    if (!(await waitFor(id, "Mesh"))) return;
    const text = await store().readProjectFile(`meshes/${name}.msh`);
    await store().writeProjectFile(`${runDir()}/input/${name}.msh`, text);
    say(`Mesh: meshes/${name}.msh, copied to ${runDir()}/input/ — the Quality toggle reads it once opened in Results.`, "ok");
  } catch (error) {
    job.status = "";
    say(`Gmsh could not run: ${error.message}`, "error");
    rerender("study");
  }
}

async function prepareStudy() {
  const project = store()?.getActive?.();
  try {
    await writeStudy();
    const id = await sidecar().prepareGales({ dir: `${project.dir}/${runDir()}`, cores: setup.study.ranks });
    await waitFor(id, "Prepare");
  } catch (error) {
    job.status = "";
    say(`Prepare could not start: ${error.message}`, "error");
    rerender("study");
  }
}

async function solveStudy() {
  const project = store()?.getActive?.();
  const target = setup.study.target && setup.study.target !== "local" ? setup.study.target : "";
  if (!target && !window.confirm(`Solve "${setup.study.name}" on THIS machine with ${setup.study.ranks} MPI rank(s)?\n\nA real-size model can use all of this computer's memory and stop it responding. A compute target (Runs on) is where large solves belong. Only continue for a small test mesh.`)) {
    say("Not solved: choose a compute target, or confirm a small local test.", "warning");
    return;
  }
  try {
    const dir = `${project.dir}/${runDir()}`;
    const id = await sidecar().runGales(target ? { dir, target, cores: setup.study.ranks } : { dir, cores: setup.study.ranks });
    if (await waitFor(id, "Solve")) openResults();
  } catch (error) {
    job.status = "";
    say(`The solve could not start: ${error.message}`, "error");
    rerender("study");
  }
}

async function openResults() {
  const results = window.GeoIDGalesResults;
  if (!results?.openProjectRun) { say("The Results tab is not loaded on this page.", "error"); return; }
  studio()?.showGroup?.("results");
  try { await results.openProjectRun(runDir()); } catch (error) { say(`Could not open the results: ${error.message}`, "error"); }
}

/* ── the tree ──────────────────────────────────────────────────────────── */

const RENDER = { materials: renderMaterials, physics: renderPhysics, study: renderStudy };

function fullSummary() {
  const s = setupSummary(setup, targets);
  const extra = window.GeoIDRealMesh?.report ? flagCheck(setup, window.GeoIDRealMesh.report) : [];
  if (!extra.length) return s;
  const issues = [...s.issues, ...extra];
  const errors = issues.filter((i) => i.level === "error").length;
  const lift = (level, step) => (extra.some((i) => i.step === step && i.level === "error") ? "error" : extra.some((i) => i.step === step) && level === "ok" ? "warning" : level);
  return {
    ...s, issues,
    materials: { ...s.materials, level: lift(s.materials.level, "materials") },
    physics: { ...s.physics, level: lift(s.physics.level, "physics") },
    study: { errors, warnings: issues.length - errors, level: errors ? "error" : issues.length ? "warning" : "ok" },
  };
}

function rerender(which) {
  const host = byId(`studio-${which}-host`);
  if (!host) return;
  // A field being typed in is not redrawn under the cursor.
  if (host.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const scroll = host.closest(".studio-dock-body, .section-body")?.scrollTop;
  RENDER[which](host);
  const scroller = host.closest(".studio-dock-body, .section-body");
  if (scroller && scroll != null) scroller.scrollTop = scroll;
}

/**
 * NO COUNT BESIDE A TAB'S NAME. The Materials, Physics and Study headings
 * carried "–", "0/0" and "3 to fix" chips, which were read as clutter rather
 * than as state; the checklist inside Study and the pipeline strip already say
 * what is missing. Any chip a previous build drew is taken off.
 */
function badges() {
  for (const group of ["materials", "physics", "study"]) {
    document.querySelector(`#model-studio .studio-group[data-group="${group}"] .section-title-row .fem-chip`)?.remove();
  }
}

function changed(all = false) {
  saveSetup();
  badges();
  (all ? Object.keys(RENDER) : Object.keys(RENDER)).forEach((w) => rerender(w));
}

let context = "";

function poll() {
  // The project and the sidecar are loaded by other modules, sometimes after
  // this one: a subscription made at install can be made to nothing, so the
  // Study tab follows them by looking.
  const ctx = `${store()?.getActive?.()?.dir || ""}|${Boolean(sidecar()?.isConnected?.())}`;
  if (ctx !== context) { context = ctx; rerender("study"); }
  const t = studio()?.setupTargets?.();
  if (!t) return;
  const next = JSON.stringify([t.dim, t.domains.map((d) => [d.flag, d.name, d.void, d.zMin, d.zMax]), t.faces.map((f) => [f.flag, f.name])]);
  targets = t;
  if (next === fingerprint) return;
  fingerprint = next;
  badges();
  Object.keys(RENDER).forEach((w) => rerender(w));
}

function install() {
  if (!byId("studio-materials-host")) { setTimeout(install, 500); return; }
  poll();
  restoreGrid();
  studio()?.registerVisibility?.("tomography", () => (tomo.cloud ? { id: "tomography", title: "Tomography grid", parts: [{ id: "tomography-nodes", name: `${tomo.name} — ${tomo.grid?.counts.total.toLocaleString()} nodes`, face: "grid", kind: "mesh", mesh: tomo.cloud, colour: 0xff6b9d }] } : null));
  Object.keys(RENDER).forEach((w) => rerender(w));
  badges();
  setInterval(poll, 1500);
  document.addEventListener("geoid-studio:mesh-changed", () => rerender("study"));
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
  window.GeoIDFemSetup = {
    get setup() { return setup; },
    set: (next) => { setup = { ...defaultSetup(), ...next }; changed(true); },
    targets: () => targets,
    // With the solver mesh's own check folded in, so the pipeline strip and
    // the Study checklist can never disagree about whether a study is ready.
    summary: () => fullSummary(),
    writeStudy, meshStudy, prepareStudy, openResults, writeSweep,
    sweep,
  };
}
