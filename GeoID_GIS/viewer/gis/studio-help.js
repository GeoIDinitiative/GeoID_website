/**
 * HELP FOR THE MODEL PAGE: a ? in the ribbon opening one overlay that walks
 * the page as it is — the workflow from the GIS page to the Research hub with
 * a "show me" for every step, what each workspace tab holds, the mouse and the
 * keys, and where things are filed. It reads the page's own seams for the
 * doors, so a step it names is a step it can open; nothing here is a picture
 * of a previous version of the app.
 */

const byId = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) { if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v); }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
};

const go = {
  gis: () => window.GeoIDModeManager?.setMode?.("gis"),
  research: () => window.GeoIDModeManager?.setMode?.("research"),
  group: (space, name) => { window.GeoIDStudioSpaces?.setSpace?.(space); window.GeoIDMeshStudio?.showGroup?.(name); },
  start: () => window.GeoIDStudioLaunchpad?.show?.(),
};

export const WORKFLOW = [
  ["GIS page", "Draw a study area, load the layers a model needs (geology, soils, points), and open the Model Builder tab: it samples the DEM into a surface, extends it below and above, embeds points and writes the package.", () => go.gis()],
  ["Geometry", "The model's solids: a terrain adopted from the GIS page, or a prebuilt scenario (a volcano with a chamber, a layered block) or your own primitives, with booleans between them.", () => go.group("build", "add")],
  ["Domains and faces", "Every volume and face the geometry became, its physical flag, and the atmosphere and embedded points; click a face in the view for its card.", () => go.group("build", "model")],
  ["Materials", "A material per domain from the library, or a tomography grid that stands in for them.", () => go.group("build", "materials")],
  ["Physics", "Solid, heat or fluid, and a condition per flagged face — fixed, pressure, temperature, flow.", () => go.group("build", "physics")],
  ["Mesh", "The lattice preview, the size fields (points, boundaries, boxes, slopes), gmsh through the sidecar, and the solver mesh with its flags checked.", () => go.group("build", "mesh")],
  ["Study and solve", "The checklist, the run written into the project, prepare and solve (locally after asking, or on a compute target), and parameter sweeps.", () => go.group("both", "study")],
  ["Results", "A solve read back: fields over time, slices and clips, contours, isosurfaces, thresholds, the warp, the probe, points and their time series, derived stress and strain, InSAR fringes, VTK in and out.", () => go.group("analyse", "results")],
  ["Analysis", "Profiles, vector arrows, stream lines, selections, statistics by domain, observations and the Mogi source, the spreadsheet, screenshots and animation, saved states and the report.", () => go.group("analyse", "analysis")],
  ["Research hub", "Series, tables and figures filed from here are read by the Signal, Spectral, Statistics, Plotter and Figure pages.", () => go.research()],
];

export const KEYS = [
  ["Drag", "orbit · shift-drag pans · wheel zooms"],
  ["Click", "pick a face, a point, a probe node on a result"],
  ["Delete", "remove the selected solids"],
  ["Escape", "clear the selection, cancel a placement or a box drag"],
  [". or →", "next time step"],
  [", or ←", "previous time step"],
  ["Home / End", "first / last step"],
  ["Space", "play through the steps"],
  ["?", "this help"],
];

let overlay = null;

function build() {
  overlay = el("div", { id: "studio-help", class: "studio-help", role: "dialog", "aria-modal": "true", "aria-label": "Model page help", hidden: true });
  const card = el("div", { class: "studio-help-card" });
  const close = el("button", { class: "studio-btn studio-help-close", type: "button", title: "Close (Escape)" }, "×");
  close.addEventListener("click", hide);
  card.append(el("header", { class: "studio-help-head" }, el("h2", {}, "How the Model page works"), close));
  card.append(el("p", { class: "studio-help-lead" }, "The bridge between the GIS page and the Research hub: ground packaged there becomes a numerical model here, and what a solve writes is read here before its series and figures go on to the hub. Build on the left, Analyse on the right; the strip under them is the whole journey."));
  const steps = el("ol", { class: "studio-help-steps" });
  WORKFLOW.forEach(([title, blurb, fn]) => {
    const b = el("button", { class: "studio-btn", type: "button" }, "show me");
    b.addEventListener("click", () => { hide(); fn(); });
    steps.append(el("li", {}, el("div", {}, el("b", {}, title), el("span", {}, blurb)), b));
  });
  card.append(el("h3", {}, "The journey"), steps);
  const keys = el("dl", { class: "studio-help-keys" });
  KEYS.forEach(([k, what]) => keys.append(el("dt", {}, k), el("dd", {}, what)));
  card.append(el("h3", {}, "Mouse and keys"), keys);
  card.append(el("h3", {}, "Where things are filed"), el("p", { class: "studio-help-lead" }, "With a project open: studies in fem_runs/, meshes in meshes/, every CSV in exports/, point series in post_processing/extracted_dofs/, screenshots in figures/, saved states in post_processing/. The Hand-off card at the top of Analysis counts them and opens the Research page that reads each."));
  const foot = el("div", { class: "studio-actions" });
  const start = el("button", { class: "studio-primary", type: "button" }, "Show the start page");
  start.addEventListener("click", () => { hide(); go.start(); });
  foot.append(start);
  card.append(foot);
  overlay.append(card);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) hide(); });
  (byId("model-studio") || document.body).append(overlay);
}

export function show() { if (!overlay) build(); overlay.hidden = false; overlay.querySelector(".studio-help-close")?.focus(); }
export function hide() { if (overlay) overlay.hidden = true; }
export function toggle() { if (overlay && !overlay.hidden) hide(); else show(); }

function install() {
  const ribbon = byId("studio-ribbon");
  const fold = ribbon?.querySelector(".studio-ribbon-fold");
  if (!ribbon || !fold) { setTimeout(install, 500); return; }
  const btn = el("button", { id: "studio-help-btn", class: "studio-btn studio-help-btn", type: "button", title: "How the Model page works (?)", "aria-label": "Help" }, "?");
  btn.addEventListener("click", toggle);
  fold.before(btn);
  window.addEventListener("keydown", (e) => {
    if (window.GeoIDModeManager?.getMode?.() !== "model") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    if (e.key === "?" ) { e.preventDefault(); toggle(); }
    else if (e.key === "Escape" && overlay && !overlay.hidden) { e.preventDefault(); hide(); }
  });
  window.GeoIDStudioHelp = { show, hide, toggle, WORKFLOW, KEYS };
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
}
