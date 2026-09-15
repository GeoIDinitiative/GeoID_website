/**
 * TWO WORKSPACES ON ONE PAGE: Build and Analyse.
 *
 * The Model page does two different jobs for two different moments. BUILD
 * turns ground from the GIS page into a solvable model: geometry, materials,
 * physics, the mesh and the study. ANALYSE reads what a solve wrote: fields
 * over time, points and their time series, which go on to the Research hub's
 * signal and statistics pages. In one column of twelve tabs the two blur, and
 * the tab a reader wants is always among the ones they do not.
 *
 * So the deck carries a switch, and a PIPELINE STRIP under it that is the
 * whole journey in one line — GIS ▸ Geometry ▸ Materials ▸ Physics ▸ Mesh ▸
 * Study ▸ Results ▸ Research — each step with a dot for where it stands and a
 * press that goes there. The ends leave the page: back to the GIS page the
 * ground came from, on to the Research hub the series go to.
 *
 * Nothing is moved or rebuilt: every tab keeps its markup, ids and handlers.
 * A tab says which workspace it belongs to and the other workspace's tabs are
 * hidden. Study belongs to both, because it is where one hands over to the
 * other. A tab opened from anywhere (a checklist line, "Open results") brings
 * its own workspace forward, so no press can open something that stays hidden.
 */

const SPACE_KEY = "geoid-studio:space";
const SPACE_OF = {
  add: "build", model: "build", label: "build", history: "build",
  materials: "build", physics: "build", mesh: "build", structured: "build", refine: "build",
  study: "both", results: "analyse", log: "both",
};

const STEPS = [
  { id: "gis", label: "GIS", title: "Back to the GIS page, where the study area, DEM and layers come from", leave: "gis", space: "build" },
  { id: "geometry", label: "Geometry", group: "add", space: "build" },
  { id: "materials", label: "Materials", group: "materials", space: "build" },
  { id: "physics", label: "Physics", group: "physics", space: "build" },
  { id: "mesh", label: "Mesh", group: "mesh", space: "build" },
  { id: "study", label: "Study", group: "study", space: "both" },
  { id: "results", label: "Results", group: "results", space: "analyse" },
  { id: "research", label: "Research", title: "On to the Research hub: extracted time series are in the project's post_processing/extracted_dofs for its signal pages", leave: "research", space: "analyse" },
];

const byId = (id) => document.getElementById(id);
const root = () => byId("model-studio");
let space = "build";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v);
  }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}

/** Where each step stands: "ok", "warning", "error", or "" for not begun. */
export function stepStates({ targets, summary, realMesh, latticeMesh, results } = {}) {
  const domains = targets?.domains?.filter((d) => !d.void).length || 0;
  const levelOf = (l) => (l === "ok" ? "ok" : l || "");
  return {
    gis: targets?.source === "gis" ? "ok" : "",
    geometry: domains ? "ok" : "error",
    materials: domains ? levelOf(summary?.materials?.level) : "",
    physics: domains ? levelOf(summary?.physics?.level) : "",
    mesh: realMesh ? (realMesh.unflaggedCells ? "error" : realMesh.unflaggedSides ? "warning" : "ok") : latticeMesh ? "warning" : "",
    study: domains ? (summary?.study?.errors ? "error" : "ok") : "",
    results: results ? "ok" : "",
    research: "",
  };
}

function setSpace(next, { remember = true } = {}) {
  space = next === "analyse" ? "analyse" : "build";
  const r = root();
  if (r) r.dataset.space = space;
  document.querySelectorAll(".studio-space-tab").forEach((b) => {
    const on = b.dataset.space === space;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", String(on));
  });
  if (remember) { try { localStorage.setItem(SPACE_KEY, space); } catch (e) { /* not kept */ } }
  refresh();
}

function goStep(step) {
  if (step.leave) { window.GeoIDModeManager?.setMode?.(step.leave); return; }
  if (step.space !== "both" && step.space !== space) setSpace(step.space);
  window.GeoIDMeshStudio?.showGroup?.(step.group);
  document.querySelector(`#model-studio .studio-group[data-group="${step.group}"]`)?.scrollIntoView({ block: "nearest" });
}

function openGroup() {
  return document.querySelector(`#model-studio .studio-group[open][data-space="${space}"], #model-studio .studio-group[open][data-space="both"]`)?.dataset.group || "";
}

export function refresh() {
  const strip = byId("studio-pipeline");
  if (!strip) return;
  const fem = window.GeoIDFemSetup;
  const states = stepStates({
    targets: fem?.targets?.(),
    summary: fem?.summary?.(),
    realMesh: window.GeoIDRealMesh?.report,
    latticeMesh: window.GeoIDMeshStudio?.state?.mesh,
    results: window.GeoIDGalesResults?.state?.mesh,
  });
  const open = openGroup();
  strip.querySelectorAll(".studio-step").forEach((b) => {
    const step = STEPS.find((s) => s.id === b.dataset.step);
    b.dataset.state = states[step.id] || "";
    b.classList.toggle("is-current", Boolean(step.group) && step.group === open);
    b.classList.toggle("is-other-space", step.space !== "both" && step.space !== space);
  });
}

function build() {
  const head = document.querySelector("#model-studio .studio-dock-left .studio-deck-head");
  if (!head || byId("studio-spaces")) return Boolean(byId("studio-spaces"));
  document.querySelectorAll("#model-studio .studio-group[data-group]").forEach((g) => { g.dataset.space = SPACE_OF[g.dataset.group] || "both"; });
  const tabs = el("div", { id: "studio-spaces", class: "studio-spaces", role: "tablist", "aria-label": "Workspace" },
    el("button", { class: "studio-space-tab", type: "button", role: "tab", "data-space": "build", title: "Geometry, materials, physics, mesh and study — the model, from the ground the GIS page gave it" },
      el("span", { class: "studio-space-name" }, "Build"), el("span", { class: "studio-space-sub" }, "model & mesh · from GIS")),
    el("button", { class: "studio-space-tab", type: "button", role: "tab", "data-space": "analyse", title: "What a solve wrote: fields, points and time series — on to the Research hub" },
      el("span", { class: "studio-space-name" }, "Analyse"), el("span", { class: "studio-space-sub" }, "results & dofs · to Research")),
  );
  tabs.querySelectorAll(".studio-space-tab").forEach((b) => b.addEventListener("click", () => setSpace(b.dataset.space)));
  const strip = el("div", { id: "studio-pipeline", class: "studio-pipeline", "aria-label": "Model pipeline" });
  STEPS.forEach((step, i) => {
    if (i) strip.append(el("span", { class: "studio-step-arrow", "aria-hidden": "true" }, "›"));
    const b = el("button", { class: `studio-step${step.leave ? " is-exit" : ""}`, type: "button", "data-step": step.id, title: step.title || `Go to ${step.label}` },
      el("span", { class: "studio-step-dot", "aria-hidden": "true" }), step.label);
    b.addEventListener("click", () => goStep(step));
    strip.append(b);
  });
  head.after(tabs, strip);
  // A tab opened by any door brings its own workspace forward.
  new MutationObserver((records) => {
    for (const r of records) {
      const g = r.target;
      if (r.attributeName !== "open" || !g.open) continue;
      const own = g.dataset.space;
      if (own && own !== "both" && own !== space) setSpace(own);
    }
    refresh();
  }).observe(document.querySelector("#model-studio .studio-deck-body") || root(), { attributes: true, attributeFilter: ["open"], subtree: true });
  return true;
}

const STYLE = `
#model-studio[data-space="build"] .studio-group[data-space="analyse"],
#model-studio[data-space="analyse"] .studio-group[data-space="build"] { display: none !important; }
.studio-spaces { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; margin: 0.35rem 0 0.3rem; }
.studio-space-tab { display: grid; gap: 0.05rem; padding: 0.4rem 0.5rem; text-align: left; border-radius: 0.6rem; border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.35); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.studio-space-tab:hover { background: rgba(var(--nav-accent-rgb, 255, 43, 214), 0.1); }
.studio-space-tab.is-active { background: var(--nav-accent, #ff2bd6); border-color: var(--nav-accent, #ff2bd6); color: #1a0b1f; }
.studio-space-name { font-family: "Exo 2", sans-serif; font-weight: 700; font-size: 0.76rem; letter-spacing: 0.12em; text-transform: uppercase; }
.studio-space-sub { font-size: 0.6rem; opacity: 0.8; }
.studio-pipeline { display: flex; flex-wrap: wrap; align-items: center; gap: 0.1rem 0.12rem; margin: 0 0 0.45rem; padding: 0.3rem 0.35rem; border-radius: 0.55rem; background: rgba(0, 0, 0, 0.22); font-size: 0.62rem; }
.studio-step { display: inline-flex; align-items: center; gap: 0.22rem; padding: 0.1rem 0.3rem; border-radius: 999px; border: 1px solid transparent; background: transparent; color: inherit; font: inherit; letter-spacing: 0.04em; cursor: pointer; }
.studio-step:hover { border-color: rgba(var(--nav-accent-rgb, 255, 43, 214), 0.5); }
.studio-step.is-current { border-color: var(--nav-accent, #ff2bd6); color: var(--nav-accent, #ff2bd6); }
.studio-step.is-other-space { opacity: 0.5; }
.studio-step.is-exit { font-style: italic; }
.studio-step-dot { width: 0.42rem; height: 0.42rem; border-radius: 50%; border: 1px solid rgba(232, 230, 240, 0.55); }
.studio-step[data-state="ok"] .studio-step-dot { background: #7ee2a8; border-color: #7ee2a8; }
.studio-step[data-state="warning"] .studio-step-dot { background: #ffb454; border-color: #ffb454; }
.studio-step[data-state="error"] .studio-step-dot { background: #ff6b7a; border-color: #ff6b7a; }
.studio-step.is-exit .studio-step-dot { border-style: dashed; }
.studio-step-arrow { opacity: 0.45; }
`;

function install() {
  if (!build()) { setTimeout(install, 400); return; }
  if (!byId("studio-spaces-style")) {
    const tag = el("style", { id: "studio-spaces-style" });
    tag.textContent = STYLE;
    document.head.append(tag);
  }
  let stored = "build";
  try { stored = localStorage.getItem(SPACE_KEY) || "build"; } catch (e) { /* default */ }
  setSpace(stored, { remember: false });
  setInterval(refresh, 1500);
  document.addEventListener("geoid-studio:mesh-changed", refresh);
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  window.GeoIDStudioSpaces = { setSpace, get space() { return space; }, refresh };
}
