/**
 * THE COMMAND PALETTE: find anything on the Model page by name and go there.
 *
 * A page with four menus, thirteen tabs, twelve Results sections and fourteen
 * Analysis cards is a page where the control you want is always somewhere
 * else. Ctrl/⌘-K (or ⌕ in the ribbon) opens a box; typing "iso" offers
 * "Results ▸ Display ▸ Isosurfaces", "stream" the Stream tracer card, "gmsh"
 * the Export menu's Mesh with gmsh, "fit" the Fit button. Enter runs it.
 *
 * The list is GATHERED FROM THE PAGE WHEN THE BOX OPENS — the ribbon's own
 * buttons, the deck's tabs, the Results panel's sections, the Analysis
 * cards, the help's journey — so a control added anywhere is found without
 * being registered here, and nothing here can name a control that is not
 * there. Each entry knows how to open itself: a button is clicked, a section
 * or card is opened in its tab and scrolled to.
 */

const byId = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) { if (k === "class") node.className = v; else node.setAttribute(k, v === true ? "" : v); }
  children.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
};

const P = { node: null, input: null, list: null, items: [], hits: [], cursor: 0 };

const text = (n) => (n?.textContent || "").replace(/\s+/g, " ").trim();
const groupTitle = (g) => text(g.querySelector("summary .section-title-row > span:last-child") || g.querySelector("summary"));
const space = (g) => g.dataset.space === "analyse" ? "analyse" : g.dataset.space === "both" ? null : "build";

function openGroup(g) {
  const s = space(g);
  if (s) window.GeoIDStudioSpaces?.setSpace?.(s);
  window.GeoIDMeshStudio?.showGroup?.(g.dataset.group);
}

/** Every reachable thing, freshly read off the page. */
export function gather(root = document) {
  const items = [];
  const push = (label, path, run, keywords = "") => items.push({ label, path, run, key: `${label} ${path} ${keywords}`.toLowerCase() });
  // The ribbon: menus and their actions, the view and toggle buttons.
  root.querySelectorAll("#studio-ribbon .studio-menu").forEach((menu) => {
    const name = text(menu.querySelector(".studio-menu-btn"));
    menu.querySelectorAll(".studio-menu-pop button").forEach((b) => push(text(b), `${name} menu`, () => b.click(), b.title));
  });
  root.querySelectorAll("#studio-ribbon > .studio-btn[data-view], #studio-ribbon > .studio-btn[data-toggle]").forEach((b) => {
    push(b.dataset.view ? `View: ${text(b)}` : `Toggle ${text(b)}`, "Ribbon", () => b.click(), b.title);
  });
  // The deck's tabs.
  root.querySelectorAll("#model-studio .studio-group[data-group]").forEach((g) => push(groupTitle(g), "Tab", () => openGroup(g)));
  // Results sections and the analysis cards, under their tabs.
  const resultsTab = root.querySelector('#model-studio .studio-group[data-group="results"]');
  root.querySelectorAll("#studio-results-host details[data-gales-section]").forEach((d) => {
    push(text(d.querySelector("summary")), "Results", () => { if (resultsTab) openGroup(resultsTab); d.open = true; d.scrollIntoView({ block: "nearest" }); });
  });
  const analysisTab = root.querySelector('#model-studio .studio-group[data-group="analysis"]');
  root.querySelectorAll("#studio-analysis-host > details").forEach((d) => {
    push(text(d.querySelector("summary")), "Analysis", () => { if (analysisTab) openGroup(analysisTab); d.open = true; d.scrollIntoView({ block: "nearest" }); });
  });
  // Results display views and the analysis' own verbs, by seam.
  const R = window.GeoIDGalesResults;
  if (R?.state?.mesh) {
    for (const [view, label] of [["surface", "Surface"], ["slice", "Slice"], ["clip", "Clip at the slice"], ["both", "Translucent surface + slice"], ["threshold", "Threshold"]]) {
      push(`Show ${label}`, "Results ▸ Display ▸ View", () => { R.state.view = view; R.renderControls?.(); R.refresh(); }, "view display");
    }
    // The display's own switches, the fields and the colour maps: what a
    // reader reaches for by name a dozen times a session.
    const S = R.state;
    const flip = (label, get, set, keywords = "") => push(`${label}: ${get() ? "off" : "on"}`, "Results ▸ Display", () => { set(!get()); R.renderControls?.(); R.refresh(); }, keywords);
    flip("Contour lines", () => S.contours.on, (v) => { S.contours.on = v; }, "isolines");
    if (S.mesh.dim === 3) flip("Isosurfaces", () => S.iso.on, (v) => { S.iso.on = v; }, "iso levels");
    flip("Warp by displacement", () => S.deform.on, (v) => { S.deform.on = v; }, "deform exaggerate");
    flip("Mesh edges", () => S.edges, (v) => { S.edges = v; }, "wireframe");
    S.fields.forEach((f, k) => { if (f.ok) push(`Field: ${f.desc?.label && f.desc.label !== f.field ? `${f.desc.label} (${f.field})` : f.field}`, "Results ▸ Field", () => { S.field = k; S.step = f.steps.length - 1; S.component = ""; R.renderControls?.(); R.refresh(); }, "show field"); });
    for (const name of Object.keys(R.colormaps?.() || {})) push(`Colour map: ${name}`, "Results ▸ Colour", () => { S.colormap = name; R.renderControls?.(); R.refresh(); }, "colormap palette");
    push("Play through the steps", "Results ▸ time", () => R.play?.(), "animate time step");
    push("Stop playing", "Results ▸ time", () => R.stop?.());
    push("Summarise over all steps", "Results ▸ Temporal statistics", () => R.addTemporal?.(), "temporal min max mean");
    push("Gradient of the field shown", "Results ▸ Gradient", () => R.addGradient?.(), "derivative");
  }
  const A = window.GeoIDResultsAnalysis;
  if (A && R?.state?.mesh) {
    push("Plot over line", "Analysis", () => A.plot?.(), "profile");
    push("Draw vector arrows", "Analysis ▸ Vector glyphs", () => { A.state.glyph.on = true; A.drawGlyphs?.(); A.render?.(); }, "glyph");
    push("Trace stream lines", "Analysis ▸ Stream tracer", () => { A.state.stream.on = true; A.traceStream?.(); A.render?.(); }, "streamline");
    push("Select nodes in a box", "Analysis ▸ Selection", () => A.armSelection?.(), "frustum select");
    push("Statistics by domain", "Analysis", () => A.computeStats?.());
    push("Screenshot", "Analysis ▸ Screenshot and animation", () => A.screenshot?.(), "png capture");
    push("Save the page state", "Analysis ▸ State", () => A.saveState?.(), "pvsm session");
    push("Open the model report", "Analysis ▸ Report", () => A.openModelReport?.(), "pdf print");
    push("Open a second view", "Results ▸ Display", () => window.GeoIDSecondView?.open?.(), "split linked camera");
  }
  // The other pages, the help and the start page.
  push("GIS page", "Go", () => window.GeoIDModeManager?.setMode?.("gis"), "globe map");
  push("Research hub", "Go", () => window.GeoIDModeManager?.setMode?.("research"), "signal statistics plots");
  push("Help: how the Model page works", "Go", () => window.GeoIDStudioHelp?.show?.(), "keys shortcuts");
  push("Start page", "Go", () => window.GeoIDStudioLaunchpad?.show?.(), "launchpad open example");
  // Deduplicate by label + path (a tab and a section can share a name).
  const seen = new Set();
  return items.filter((it) => { const k = `${it.label}|${it.path}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Ranked matches: every word of the query in the key, label hits first, then shorter labels. */
export function search(items, query) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.slice(0, 40);
  const scored = [];
  for (const it of items) {
    if (!words.every((w) => it.key.includes(w))) continue;
    const label = it.label.toLowerCase();
    let score = 0;
    for (const w of words) { if (label.startsWith(w)) score += 3; else if (label.includes(w)) score += 2; else score += 1; }
    scored.push({ it, score, len: it.label.length });
  }
  return scored.sort((a, b) => b.score - a.score || a.len - b.len).map((s) => s.it).slice(0, 40);
}

function renderList() {
  const list = P.list;
  list.textContent = "";
  P.hits = search(P.items, P.input.value);
  P.cursor = Math.min(P.cursor, Math.max(0, P.hits.length - 1));
  if (!P.hits.length) { list.append(el("div", { class: "studio-finder-empty" }, "Nothing on the page matches.")); return; }
  P.hits.forEach((it, k) => {
    const row = el("button", { class: `studio-finder-item${k === P.cursor ? " is-active" : ""}`, type: "button", role: "option", "aria-selected": String(k === P.cursor) },
      el("span", { class: "studio-finder-label" }, it.label), el("span", { class: "studio-finder-path" }, it.path));
    row.addEventListener("mouseenter", () => { P.cursor = k; renderList(); });
    row.addEventListener("click", () => run(it));
    list.append(row);
  });
  list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
}

function run(item) {
  hide();
  try { item.run(); } catch (error) { console.warn("[palette]", item.label, error); }
}

function build() {
  P.node = el("div", { id: "studio-finder", class: "studio-finder", role: "dialog", "aria-label": "Find a control", hidden: true });
  const card = el("div", { class: "studio-finder-card" });
  P.input = el("input", { class: "studio-input studio-finder-input", type: "text", placeholder: "Find a control, a tab, an analysis… (Esc to close)", spellcheck: "false", role: "combobox", "aria-expanded": "true" });
  P.list = el("div", { class: "studio-finder-list", role: "listbox" });
  card.append(P.input, P.list);
  P.node.append(card);
  P.node.addEventListener("click", (e) => { if (e.target === P.node) hide(); });
  P.input.addEventListener("input", () => { P.cursor = 0; renderList(); });
  P.input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") { e.preventDefault(); P.cursor = Math.min(P.hits.length - 1, P.cursor + 1); renderList(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); P.cursor = Math.max(0, P.cursor - 1); renderList(); }
    else if (e.key === "Enter") { e.preventDefault(); if (P.hits[P.cursor]) run(P.hits[P.cursor]); }
    else if (e.key === "Escape") { e.preventDefault(); hide(); }
  });
  (byId("model-studio") || document.body).append(P.node);
}

export function show() {
  if (!P.node) build();
  P.items = gather();
  P.node.hidden = false;
  P.input.value = "";
  P.cursor = 0;
  renderList();
  P.input.focus();
}
export function hide() { if (P.node) P.node.hidden = true; }
export function toggle() { if (P.node && !P.node.hidden) hide(); else show(); }

function install() {
  const ribbon = byId("studio-ribbon");
  const help = byId("studio-help-btn");
  if (!ribbon || !help) { setTimeout(install, 500); return; }
  const btn = el("button", { id: "studio-finder-btn", class: "studio-btn studio-help-btn", type: "button", title: "Find a control (Ctrl-K)", "aria-label": "Find a control" }, "⌕");
  btn.addEventListener("click", toggle);
  help.before(btn);
  window.addEventListener("keydown", (e) => {
    if (window.GeoIDModeManager?.getMode?.() !== "model") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggle(); }
  });
  window.GeoIDStudioPalette = { show, hide, toggle, gather, search };
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
}
