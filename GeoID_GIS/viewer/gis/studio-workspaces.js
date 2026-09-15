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
 * whole journey in one line — Geometry ▸ Materials ▸ Physics ▸ Mesh ▸
 * Study ▸ Results — each step with a dot for where it stands and a press that
 * goes there. The switch sits in the deck's head, where its name was; the
 * page's own mode bar is the way to the GIS page and the Research hub.
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
  study: "both", results: "analyse", analysis: "analyse", log: "both",
};

const STEPS = [
  { id: "gis", label: "GIS", space: "both", go: () => window.GeoIDModeManager?.setMode?.("gis") },
  { id: "geometry", label: "Geometry", group: "add", space: "build" },
  { id: "materials", label: "Materials", group: "materials", space: "build" },
  { id: "physics", label: "Physics", group: "physics", space: "build" },
  { id: "mesh", label: "Mesh", group: "mesh", space: "build" },
  { id: "study", label: "Study", group: "study", space: "both" },
  { id: "results", label: "Results", group: "results", space: "analyse" },
  { id: "research", label: "Research", space: "both", go: () => window.GeoIDResultsAnalysis?.goResearch?.() || window.GeoIDModeManager?.setMode?.("research") },
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
export function stepStates({ targets, summary, realMesh, latticeMesh, results, filed = 0 } = {}) {
  const domains = targets?.domains?.filter((d) => !d.void).length || 0;
  const levelOf = (l) => (l === "ok" ? "ok" : l || "");
  return {
    gis: targets?.source === "gis" ? "ok" : "",
    // No geometry is the thing to fix in a Build — unless the page holds only a
    // run somebody opened to read, where a red Geometry dot is noise.
    geometry: domains ? "ok" : results ? "" : "error",
    materials: domains ? levelOf(summary?.materials?.level) : "",
    physics: domains ? levelOf(summary?.physics?.level) : "",
    mesh: realMesh ? (realMesh.unflaggedCells ? "error" : realMesh.unflaggedSides ? "warning" : "ok") : latticeMesh ? "warning" : "",
    study: domains ? (summary?.study?.errors ? "error" : "ok") : "",
    results: results ? "ok" : "",
    research: filed ? "ok" : "",
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
  if (step.go) { step.go(); return; }
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
    filed: window.GeoIDResultsAnalysis?.handoffFiled?.() || 0,
  });
  const open = openGroup();
  strip.querySelectorAll(".studio-step").forEach((b) => {
    const step = STEPS.find((s) => s.id === b.dataset.step);
    if (!step) return;
    b.dataset.state = states[step.id] || "";
    b.classList.toggle("is-current", Boolean(step.group) && step.group === open);
    b.classList.toggle("is-other-space", step.space !== "both" && step.space !== space);
  });
}

function build() {
  const head = document.querySelector("#model-studio .studio-dock-left .studio-deck-head");
  if (!head || byId("studio-spaces")) return Boolean(byId("studio-spaces"));
  document.querySelectorAll("#model-studio .studio-group[data-group]").forEach((g) => { g.dataset.space = SPACE_OF[g.dataset.group] || "both"; });
  // The switch IS the deck's head: it takes the row the deck's name had, beside
  // the fold. The page's own mode bar already leads to GIS and Research.
  const tabs = el("div", { id: "studio-spaces", class: "studio-spaces", role: "tablist", "aria-label": "Workspace" },
    el("button", { class: "studio-space-tab", type: "button", role: "tab", "data-space": "build", title: "Build: geometry, materials, physics, mesh and study" }, "Build"),
    el("button", { class: "studio-space-tab", type: "button", role: "tab", "data-space": "analyse", title: "Analyse: what a solve wrote — fields, points and time series" }, "Analyse"),
  );
  tabs.querySelectorAll(".studio-space-tab").forEach((b) => b.addEventListener("click", () => setSpace(b.dataset.space)));
  const strip = el("div", { id: "studio-pipeline", class: "studio-pipeline", "aria-label": "Model pipeline" });
  STEPS.forEach((step) => {
    const b = el("button", { class: `studio-step${step.go ? " is-door" : ""}`, type: "button", "data-step": step.id, title: step.go ? `Go to the ${step.label} page` : `Go to ${step.label}` },
      el("span", { class: "studio-step-dot", "aria-hidden": "true" }), el("span", { class: "studio-step-label" }, step.label));
    b.addEventListener("click", () => goStep(step));
    strip.append(b);
  });
  head.prepend(tabs);
  head.after(strip);
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

/**
 * The Model page's panels share one stylesheet (studio-ui.css), loaded last
 * so it settles what older, layered rules left inconsistent. Loaded here
 * because this module runs on both the Earth page and the planets, and under
 * this module's own stamp so a change to the sheet is never served stale.
 */
function loadStylesheet() {
  if (byId("studio-ui-css")) return;
  const link = el("link", { id: "studio-ui-css", rel: "stylesheet", href: new URL(`./studio-ui.css${new URL(import.meta.url).search}`, import.meta.url).href });
  document.head.append(link);
}

function install() {
  if (!build()) { setTimeout(install, 400); return; }
  loadStylesheet();
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
