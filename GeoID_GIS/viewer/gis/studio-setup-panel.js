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
  icBcHeader, studySpec, studyTimes, setupSummary,
} from "./fem-setup.js?v=20260915-247ef13";

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

function card(key, title, open = false, badge = "") {
  const details = el("details", { class: "gis-tool-section studio-fold-section fem-card" });
  details.open = openCards.has(key) ? openCards.get(key) : open;
  const summary = el("summary", {}, title);
  summary.dataset.toolIcon = "1";
  if (badge) summary.append(el("span", { class: "fem-chip" }, badge));
  const body = el("div", { class: "gis-tool-body" });
  details.append(summary, body);
  details.addEventListener("toggle", () => openCards.set(key, details.open));
  return { details, body, summary };
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

function renderMaterials(host) {
  host.textContent = "";
  const P = PHYSICS[setup.physics];
  const solids = targets.domains.filter((d) => !d.void);
  if (!targets.domains.length) {
    host.append(el("p", { class: "studio-readout" }, "No domains yet. Build the geometry (Add), or bring a terrain from the GIS page — every volume becomes a domain to give a material."));
    return;
  }
  const plan = materialsPlan(targets.domains, setup.materials);
  const said = plan.mode === "uniform" ? "One material everywhere (uniform)." : plan.mode === "layers" ? `${plan.layers.length} horizontal layers, bottom first — GALES reads them z-wise.` : "No material yet.";
  host.append(el("p", { class: "studio-readout" }, `${P.label} needs ${P.props.map((k) => MATERIAL_PROPS[k].label.toLowerCase()).join(", ")}. ${said}`));
  (plan.issues || []).forEach((text) => host.append(el("p", { class: "studio-readout is-warning" }, text)));
  const actions = el("div", { class: "studio-actions" });
  const first = solids.find((d) => setup.materials[d.flag]?.id);
  const all = el("button", { class: "studio-secondary", type: "button", title: "Give every domain the material of the first one that has one" }, "Same material everywhere");
  all.disabled = !first;
  all.addEventListener("click", () => {
    solids.forEach((d) => { setup.materials[d.flag] = { id: setup.materials[first.flag].id, overrides: { ...(setup.materials[first.flag].overrides || {}) } }; });
    changed();
  });
  actions.append(all);
  host.append(actions);

  for (const d of targets.domains) {
    const a = setup.materials[d.flag];
    const name = a?.id ? MATERIALS.find((m) => m.id === a.id)?.name : "";
    const c = card(`mat:${d.flag}`, `${d.name}`, !a?.id && !d.void, d.void ? "cut" : `flag ${d.flag}`);
    c.summary.title = d.void ? "A cut: no material" : name ? `${name}` : "No material yet";
    if (d.void) {
      c.body.append(el("p", { class: "studio-readout" }, "A cut (void) — nothing is solved inside it, so it needs no material."));
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
      c.body.append(el("p", { class: "studio-readout" }, `z ${fmt(d.zMin)} to ${fmt(d.zMax)} m. Blank fields keep the library's typical value, not a site's.`));
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
  host.append(el("p", { class: "studio-readout" }, `Solves for ${P.fields}. A face with no condition is ${P.conditions.free.label.toLowerCase().replace(/ \(.*\)/, "")}.`));

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
    host.append(el("p", { class: "studio-readout" }, "No flagged faces yet. Every face of the geometry carries a flag (Model ▸ Domains); a condition is set on a flag."));
    return;
  }
  host.append(el("p", { class: "studio-group-title" }, "Boundary conditions"));
  for (const f of targets.faces) {
    const cond = setup.conditions[f.flag] || { type: "free", values: {} };
    const spec = P.conditions[cond.type] || P.conditions.free;
    const c = card(`bc:${f.flag}`, `Flag ${f.flag} — ${f.name}`, false, cond.type === "free" ? "" : spec.label.split(" —")[0].split(" (")[0]);
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
    c.body.append(el("p", { class: "studio-readout" }, `${f.names.length} face${f.names.length === 1 ? "" : "s"}: ${f.names.join(", ")}. Hover or open this card to light them on the model.`));
    host.append(c.details);
  }
}

/* ── Study ─────────────────────────────────────────────────────────────── */

const STEP_GROUP = { geometry: "add", materials: "materials", physics: "physics", study: "study" };

function runDir() {
  const project = store()?.getActive?.();
  return project ? `fem_runs/${setup.study.name}` : "";
}

function say(text, level = "") {
  job.text = text;
  job.level = level;
  const node = byId("fem-study-status");
  if (node) { node.textContent = text; node.className = `studio-readout${level ? ` is-${level}` : ""}`; }
}

async function listTargets() {
  if (!sidecar()?.isConnected?.()) return [];
  try { computeTargets = await sidecar().listCompute(); } catch (e) { computeTargets = null; }
  const list = computeTargets?.targets || [];
  return Array.isArray(list) ? list : Object.values(list);
}

function renderStudy(host) {
  host.textContent = "";
  const st = setup.study;
  const summary = setupSummary(setup, targets);
  const params = card("study:params", "Study", true);
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
      where.append(el("option", { value: n }, `${n}${t.host ? ` (${t.host})` : ""}`));
    }
    where.value = st.target || "local";
  });
  params.body.append(el("p", { class: "studio-readout" }, `${times.steps} step${times.steps === 1 ? "" : "s"}, Δt ${fmt(times.delta_t)}, to t = ${fmt(times.final_time)}. ${targets.dim}D, ${targets.domains.length} domain${targets.domains.length === 1 ? "" : "s"}, ${targets.faces.length} flagged face group${targets.faces.length === 1 ? "" : "s"}.`));
  host.append(params.details);

  const check = card("study:check", "Checklist", summary.study.errors > 0, summary.study.errors ? `${summary.study.errors} to fix` : summary.study.warnings ? `${summary.study.warnings} note${summary.study.warnings === 1 ? "" : "s"}` : "ready");
  if (!summary.issues.length) check.body.append(el("p", { class: "studio-readout is-ok" }, "Nothing stands between this model and a solve."));
  const list = el("ul", { class: "fem-checklist" });
  for (const issue of summary.issues) {
    const li = el("li", { class: `is-${issue.level}` }, issue.text);
    const group = STEP_GROUP[issue.step];
    if (group) { li.title = `Open ${group}`; li.addEventListener("click", () => studio()?.showGroup?.(group)); }
    list.append(li);
  }
  if (summary.issues.length) check.body.append(list);
  host.append(check.details);

  const files = card("study:files", "Generated files");
  const physics = PHYSICS[setup.physics];
  const plan = materialsPlan(targets.domains, setup.materials);
  let header = "";
  try { header = icBcHeader(setup.physics, setup); } catch (e) { header = String(e.message); }
  files.body.append(el("p", { class: "studio-readout" }, `GALES family ${physics.family}. These are written into the run and compiled into the solver by Prepare.`));
  files.body.append(el("p", { class: "studio-group-title" }, "props.txt"), el("pre", { class: "fem-pre" }, propsText(setup.physics, plan, { dim: targets.dim, options: setup.options })));
  files.body.append(el("p", { class: "studio-group-title" }, physics.header), el("pre", { class: "fem-pre" }, header));
  host.append(files.details);

  const pipe = card("study:pipeline", "Run the study", true);
  const blocked = summary.study.errors > 0;
  const connected = Boolean(sidecar()?.isConnected?.());
  const hasProject = Boolean(store()?.getActive?.());
  const step = (label, title, fn, disabled) => {
    const b = el("button", { class: "studio-secondary", type: "button", title }, label);
    b.disabled = Boolean(disabled) || Boolean(job.status === "running");
    b.addEventListener("click", fn);
    return b;
  };
  const steps = el("div", { class: "fem-steps" },
    step("1 · Write study", "spec.json and the gmsh script into fem_runs/<name> of the open project", writeStudy, blocked || !hasProject),
    step("2 · Mesh with gmsh", "The sidecar runs the model's gmsh script; the mesh is filed in the run", meshStudy, blocked || !hasProject || !connected),
    step("3 · Prepare deck", "Sidecar: setup.txt, props.txt, the generated header, the mesh for N ranks, and the build", prepareStudy, blocked || !hasProject || !connected),
    step("4 · Solve", "Run the solver here or on the chosen compute target", solveStudy, blocked || !hasProject || !connected),
    step("5 · Open results", "Open this run in the Results tab", openResults, !hasProject),
  );
  pipe.body.append(steps);
  const why = !hasProject ? "Open a project first (Research ▸ Projects): a study is a folder in it."
    : !connected ? "Writing the study works now. Meshing, preparing and solving run in the local sidecar — connect it in Settings ▸ Sidecar."
      : blocked ? "Fix the checklist first." : "";
  pipe.body.append(el("div", { id: "fem-study-status", class: `studio-readout${job.level ? ` is-${job.level}` : ""}` }, job.text || why || "Ready."));
  if (job.text && why) pipe.body.append(el("p", { class: "studio-readout" }, why));
  host.append(pipe.details);
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
    job.runDir = runDir();
    say(`Written: ${runDir()}/spec.json${script ? ` and input/${name}_gmsh.py` : ""}.${script ? "" : " A GIS terrain's gmsh script comes from the Model Builder's package (Build): put its .msh in the run's input/."}`, "ok");
  } catch (error) {
    say(`Could not write the study: ${error.message}`, "error");
  }
  return spec;
}

async function waitFor(id, label) {
  job.id = id; job.status = "running"; job.step = label;
  rerender("study");
  say(`${label}: running (job ${id})…`);
  const snap = await sidecar().awaitJob(id, { timeoutMs: 6 * 3600 * 1000, everyMs: 1000 });
  job.status = snap.status;
  const ok = snap.status === "done" && !snap.exit_code;
  const tail = String(snap.output || snap.log || "").trim().split("\n").slice(-3).join(" · ");
  say(`${label}: ${ok ? "done" : `${snap.status}${snap.exit_code != null ? ` (exit ${snap.exit_code})` : ""}`}.${tail ? ` ${tail}` : ""}${ok ? "" : " The Jobs drawer has the whole log."}`, ok ? "ok" : "error");
  rerender("study");
  return ok;
}

async function meshStudy() {
  const project = store()?.getActive?.();
  const name = setup.study.name;
  const script = studio()?.gmshScriptFor?.(name);
  if (!script) { say("This model's gmsh script comes from the Model Builder (a GIS terrain). Build its package there, then Prepare.", "warning"); return; }
  try {
    const id = await sidecar().runGmsh({ project: project.dir, script, name, dim: targets.dim });
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

function badges() {
  const s = setupSummary(setup, targets);
  const put = (group, text, level) => {
    const row = document.querySelector(`#model-studio .studio-group[data-group="${group}"] .section-title-row`);
    if (!row) return;
    let chip = row.querySelector(".fem-chip");
    if (!chip) { chip = el("span", { class: "fem-chip" }); row.append(chip); }
    chip.textContent = text;
    chip.dataset.level = level;
  };
  put("materials", s.materials.of ? `${s.materials.assigned}/${s.materials.of}` : "—", s.materials.level);
  put("physics", `${s.physics.set}/${s.physics.of}`, s.physics.level);
  put("study", s.study.errors ? `${s.study.errors} to fix` : "ready", s.study.level);
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

const STYLE = `
.fem-chip { margin-left: 0.45rem; padding: 0.02rem 0.4rem; border-radius: 999px; font-size: 0.6rem; letter-spacing: 0.04em; border: 1px solid currentColor; opacity: 0.85; white-space: nowrap; }
.fem-chip[data-level="error"] { color: #ff6b7a; }
.fem-chip[data-level="warning"] { color: #ffb454; }
.fem-chip[data-level="ok"] { color: #7ee2a8; }
.fem-card .gis-tool-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.35rem; }
.fem-checklist { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.25rem; font-size: 0.7rem; }
.fem-checklist li { padding-left: 0.5rem; border-left: 3px solid currentColor; cursor: pointer; }
.fem-checklist .is-error { color: #ff6b7a; }
.fem-checklist .is-warning { color: #ffb454; }
.studio-readout.is-error { color: #ff6b7a; }
.studio-readout.is-warning { color: #ffb454; }
.studio-readout.is-ok { color: #7ee2a8; }
.fem-pre { margin: 0; max-height: 14rem; overflow: auto; padding: 0.4rem; border-radius: 0.4rem; background: rgba(0, 0, 0, 0.35); font: 0.62rem/1.35 ui-monospace, monospace; white-space: pre; }
.fem-steps { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.3rem; }
.fem-steps button { text-align: left; }
`;

function install() {
  if (!byId("studio-materials-host")) { setTimeout(install, 500); return; }
  if (!byId("fem-setup-style")) {
    const tag = el("style", { id: "fem-setup-style" });
    tag.textContent = STYLE;
    document.head.append(tag);
  }
  poll();
  Object.keys(RENDER).forEach((w) => rerender(w));
  badges();
  setInterval(poll, 1500);
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
  window.GeoIDFemSetup = {
    get setup() { return setup; },
    set: (next) => { setup = { ...defaultSetup(), ...next }; changed(true); },
    targets: () => targets,
    summary: () => setupSummary(setup, targets),
    writeStudy, meshStudy, prepareStudy, openResults,
  };
}
