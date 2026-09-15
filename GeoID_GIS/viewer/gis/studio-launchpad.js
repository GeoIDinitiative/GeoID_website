/**
 * THE LAUNCHPAD: what the Model page shows while it holds nothing.
 *
 * An empty studio was a ruled grid and a column of eleven tabs named for
 * their modules — nothing said which of them a newcomer starts with, or that
 * the page is the bridge between the GIS page (where ground is packaged
 * into a model) and the Research hub (where a solve's series are analysed).
 * ParaView and COMSOL both open on a way in; this is ours.
 *
 * It is a card over the viewport, and every door on it is a door that exists
 * elsewhere on the page — it opens the tab, the picker or the mode the door
 * leads to and never re-implements one. It lives only while the studio holds
 * no solid and Results no run: the moment either arrives it goes, and a ✕
 * stands it down for the session. Nothing is fetched to draw it except the
 * open project's runs and saved states, which say what there is to resume.
 */

const byId = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) { if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v); }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
};

const DISMISS_KEY = "geoid-studio:launchpad-dismissed";
const L = { node: null, dismissed: false, runs: [], states: [], project: "", example: null, timer: 0 };

const studio = () => window.GeoIDMeshStudio;
const results = () => window.GeoIDGalesResults;

/** True while there is nothing on the page to work with. */
export function studioIsEmpty() {
  const solids = studio()?.state?.solids?.length || 0;
  const run = Boolean(results()?.state?.mesh);
  return !solids && !run;
}

/** Whether the GIS page holds a drawn study area to build from. */
function studyAreaDrawn() {
  const v = window.GeoIDViewer;
  const g = v?.getExtractionGeometry?.("study") || v?.getExtractionGeometry?.("buffer");
  return Boolean(g && (g.vertices?.length >= 3 || g.length >= 3));
}

async function readProject() {
  const store = window.GeoIDResearch?.store;
  const active = store?.getActive?.();
  L.project = active?.meta?.name || active?.name || "";
  L.runs = []; L.states = [];
  if (!active || !store.listProjectDir) return;
  try {
    const runs = await store.listProjectDir("fem_runs");
    for (const run of runs.filter((r) => r.kind === "directory").slice(0, 12)) {
      const inside = await store.listProjectDir(`fem_runs/${run.name}`).catch(() => []);
      L.runs.push({ name: run.name, solved: inside.some((e) => e.name === "results") });
    }
  } catch (e) { /* no runs to list */ }
  try {
    const post = await store.listProjectDir("post_processing");
    L.states = post.map((e) => e.name).filter((n) => /^model_state_.*\.json$/.test(n)).sort().reverse().slice(0, 6);
  } catch (e) { /* none */ }
}

/** The Etna run ships with the GALES tree, which is not deployed: offer it only where it answers. */
async function probeExample() {
  if (L.example !== null) return L.example;
  try {
    const r = await fetch("/GeoID_GIS/gales/sim/solid_es/etna_3d_atlas/results/solid/u/1", { method: "HEAD" });
    L.example = r.ok;
  } catch (e) { L.example = false; }
  return L.example;
}

async function openExample() {
  const base = "/GeoID_GIS/gales/sim/solid_es/etna_3d_atlas/";
  const paths = ["input/mesh_4core.txt", "results/solid/u/0", "results/solid/u/1", "props.txt"];
  const files = [];
  for (const p of paths) {
    const blob = await (await fetch(base + p)).blob();
    const file = new File([blob], p.split("/").pop());
    Object.defineProperty(file, "webkitRelativePath", { value: `etna/${p}` });
    files.push(file);
  }
  window.GeoIDStudioSpaces?.setSpace?.("analyse");
  studio()?.showGroup?.("results");
  results()?.openFolder?.(files);
}

function goGis() {
  window.GeoIDModeManager?.setMode?.("gis");
  setTimeout(() => {
    const tab = byId("gis-group-mesh");
    if (tab) { tab.open = true; tab.scrollIntoView({ block: "start", behavior: "smooth" }); }
  }, 250);
}

function goBuild() {
  window.GeoIDStudioSpaces?.setSpace?.("build");
  studio()?.showGroup?.("add");
  hide();
}

function goResults() {
  window.GeoIDStudioSpaces?.setSpace?.("analyse");
  studio()?.showGroup?.("results");
}

function goResearch() {
  window.GeoIDModeManager?.setMode?.("research");
}

function picker({ directory = false, accept = "" } = {}, onFiles) {
  const input = el("input", { type: "file", hidden: true, accept: accept || null });
  input.multiple = true;
  if (directory) { input.setAttribute("webkitdirectory", ""); input.setAttribute("directory", ""); }
  input.addEventListener("change", () => { const files = [...(input.files || [])]; input.value = ""; if (files.length) onFiles(files); });
  return input;
}

function door(icon, title, blurb, onClick, { primary = false, badge = "" } = {}) {
  const b = el("button", { class: `studio-launch-door${primary ? " is-primary" : ""}`, type: "button" },
    el("span", { class: "studio-launch-icon", "aria-hidden": "true" }, icon),
    el("span", { class: "studio-launch-text" }, el("b", {}, title), el("span", {}, blurb)),
    badge ? el("span", { class: "studio-launch-badge" }, badge) : null,
  );
  b.addEventListener("click", onClick);
  return b;
}

function render() {
  const root = byId("model-studio");
  if (!root) return;
  if (!L.node) {
    L.node = el("section", { id: "studio-launchpad", class: "studio-launchpad", role: "region", "aria-label": "Start" });
    root.append(L.node);
  }
  const node = L.node;
  node.textContent = "";
  const close = el("button", { class: "studio-btn studio-launch-close", type: "button", title: "Put this away for the session" }, "×");
  close.addEventListener("click", () => { L.dismissed = true; try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch (e) { /* not kept */ } hide(); });
  node.append(
    el("header", { class: "studio-launch-head" },
      el("div", {}, el("h2", {}, "Model page"), el("p", {}, "Where ground packaged on the GIS page becomes a numerical model, and where a solve's results are read before they go to the Research hub.")),
      close),
  );
  const drawn = studyAreaDrawn();
  const doors = el("div", { class: "studio-launch-grid" });
  const gisIn = picker({ directory: true }, (files) => { goResults(); results()?.openFolder?.(files); });
  const vtkIn = picker({ accept: ".vtu,.vtk,.pvd,.txt,.msh" }, (files) => { goResults(); results()?.openFolder?.(files); });
  node.append(gisIn, vtkIn);
  doors.append(
    door("⌖", drawn ? "Build from the study area" : "Start from the GIS page", drawn ? "A study area is drawn: sample the DEM and package it as a domain in the Model Builder." : "Draw a study area on the globe and package its ground — DEM, soils, points — as a model domain.", goGis, { primary: drawn, badge: drawn ? "area drawn" : "" }),
    door("◧", "Build a shape", "Prebuilt scenarios (a volcano with a chamber, a layered block) or your own primitives, then materials, physics, mesh and study.", goBuild),
    door("▤", "Open a results folder", "A GALES run (input/, results/), or ParaView's .vtu, .vtk and .pvd from any solver.", () => gisIn.click()),
    door("▥", "Open result files", "A mesh on its own, then its steps; or VTK files picked one by one.", () => vtkIn.click()),
  );
  if (L.example) doors.append(door("▲", "Try the Etna example", "The Etna deformation run: 251,147 nodes, a pressurised chamber, two steps of displacement.", openExample));
  node.append(doors);

  if (L.project && (L.runs.length || L.states.length)) {
    const resume = el("div", { class: "studio-launch-resume" }, el("h3", {}, `In ${L.project}`));
    const list = el("div", { class: "studio-launch-list" });
    for (const run of L.runs) {
      const b = el("button", { class: "studio-btn", type: "button", title: run.solved ? "Open this run's results" : "This run has no results yet: open Study to prepare and solve it" }, run.solved ? "▶ " : "○ ", run.name);
      b.addEventListener("click", () => { if (run.solved) { goResults(); results()?.openProjectRun?.(`fem_runs/${run.name}`); } else { window.GeoIDStudioSpaces?.setSpace?.("build"); studio()?.showGroup?.("study"); hide(); } });
      list.append(b);
    }
    for (const st of L.states) {
      const b = el("button", { class: "studio-btn", type: "button", title: "A saved page state: open its run, then load it from Analysis ▸ State" }, "⧉ ", st.replace(/^model_state_/, "").replace(/\.json$/, ""));
      b.addEventListener("click", () => { goResults(); });
      list.append(b);
    }
    resume.append(list);
    node.append(resume);
  } else if (!L.project) {
    node.append(el("p", { class: "studio-launch-note" }, "No project is open. Anything written here — a study, a mesh, extracted series, a report — is filed into the open project; open one on the Research hub's Projects page."));
  }

  const map = el("div", { class: "studio-launch-map" });
  const stepBtn = (label, blurb, fn) => { const b = el("button", { class: "studio-launch-step", type: "button" }, el("b", {}, label), el("span", {}, blurb)); b.addEventListener("click", fn); return b; };
  map.append(
    stepBtn("GIS", "ground, layers, study area", goGis), el("span", { class: "studio-launch-arrow", "aria-hidden": "true" }, "→"),
    stepBtn("Model", "geometry · materials · physics · mesh · study · results", goBuild), el("span", { class: "studio-launch-arrow", "aria-hidden": "true" }, "→"),
    stepBtn("Research", "series, statistics, plots, the report", goResearch),
  );
  node.append(map);
  node.hidden = false;
}

function hide() { if (L.node) L.node.hidden = true; }

async function sync() {
  const root = byId("model-studio");
  if (!root || root.hidden || window.GeoIDModeManager?.getMode?.() !== "model") { hide(); return; }
  if (L.dismissed || !studioIsEmpty()) { hide(); return; }
  await readProject();
  await probeExample();
  if (L.dismissed || !studioIsEmpty()) { hide(); return; }
  render();
}

function install() {
  if (!byId("model-studio") || !studio()) { setTimeout(install, 500); return; }
  try { L.dismissed = sessionStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { /* default */ }
  let ticking = false;
  const tick = async () => { if (ticking) return; ticking = true; try { await sync(); } finally { ticking = false; } };
  tick();
  L.timer = setInterval(tick, 1500);
  window.addEventListener("geoid-gales:refreshed", () => { if (!studioIsEmpty()) hide(); });
  document.addEventListener("geoid-studio:mesh-changed", tick);
  window.GeoIDStudioLaunchpad = { show: () => { L.dismissed = false; try { sessionStorage.removeItem(DISMISS_KEY); } catch (e) { /* fine */ } return tick(); }, hide, isShown: () => Boolean(L.node && !L.node.hidden), studioIsEmpty };
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
}
