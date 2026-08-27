import { registerPage } from "../stages.js?v=20260827-54182f4";
import * as store from "../project-store.js?v=20260827-54182f4";
import * as bridge from "../bridge.js?v=20260827-54182f4";
import { currentBody } from "../../bodies.js?v=20260827-54182f4";
import { el, card, stat, button, statusLine, row } from "./common.js?v=20260827-54182f4";

/**
 * Dashboard, laid out as the Qt app lays it out (app_qt.py:4160): two columns,
 * each a set of sub-tabs. Left is context -- the Atlas Ecosystem cockpit, the
 * overview and the navigation guide. Right is the project itself.
 *
 * The Atlas Ecosystem panel is the point of the page: Research is one facet of
 * the ecosystem, and this makes the wiring visible and usable rather than
 * implied. The Qt version hands off to other *processes* over the Atlas hub;
 * here the facets are other modes of the same page, so the handoffs are direct.
 */

/** A small tabbed box, which is what both columns of the Qt dashboard are. */
function tabbed(panels) {
  const box = el("section", "research-card");
  const strip = el("div", "dash-tabs");
  const body = el("div", "dash-tab-body");
  const entries = Object.entries(panels);
  const show = (name) => {
    body.textContent = "";
    Array.from(strip.children).forEach((b) =>
      b.classList.toggle("is-active", b.textContent === name));
    const build = panels[name];
    const made = build();
    if (made) body.appendChild(made);
  };
  entries.forEach(([name]) => {
    const btn = el("button", "shell-tab", name);
    btn.type = "button";
    btn.addEventListener("click", () => show(name));
    strip.appendChild(btn);
  });
  box.append(strip, body);
  if (entries.length) show(entries[0][0]);
  return box;
}

/** app_qt.py:4189 — facet_card. Title, what the facet is for, one way in. */
function facetCard(title, desc, btnText, onClick) {
  const box = el("div", "eco-card");
  box.appendChild(el("h3", "eco-card-title", title));
  box.appendChild(el("p", "eco-card-desc", desc));
  if (btnText) box.appendChild(button(btnText, onClick, { secondary: true }));
  return box;
}

function ecosystemPanel(ctx, info) {
  const wrap = el("div");

  // Qt polls the Atlas hub for the current project; here the store *is* that
  // state, so it is reported directly rather than pretended at.
  const world = currentBody();
  const state = el("div", "eco-status");
  state.textContent = info.open
    ? `Bound to “${info.name}” on ${world?.name || "Earth"} — `
      + `${info.dir}. Every facet below reads and writes this project.`
    : "No project bound. The facets below still work; nothing they produce "
      + "will be recorded until a project is open.";
  wrap.appendChild(state);

  wrap.appendChild(el("div", "eco-loop",
    "DATA  ▸  GEOMETRY  ▸  MESH  ▸  SIMULATION  ▸  RESULTS  ▸  DOCS"));

  const grid = el("div", "eco-grid");
  grid.append(
    facetCard("▲ Meshing Studio",
      "DEMs and geometry become meshes in the Model page — extracted from the "
      + "globe, meshed, and written back into the project's meshes/ folder.",
      "Open the Studio", () => bridge.goToPage("model")),
    facetCard(`◍ ${world?.name || "Earth"} Globe`,
      "Datasets, GEE products and meshed surfaces load onto the globe. What "
      + "you import there is registered here; what you draw there becomes the "
      + "study area.",
      "Open the globe", () => bridge.goToPage("gis")),
    facetCard("≋ FEM Simulation",
      "Runs are configured here and executed by the desktop solver: the FEM "
      + "pages write fem_runs/<run>/spec.json and read results back from the "
      + "same folder.",
      "Configure a run", () => ctx.setPage?.("Setup")),
    facetCard("✎ Docs & Sheets",
      "Results become figures become papers. The Publish stage collects "
      + "exports, figures and the storyboard into the project's docs/.",
      "Open the storyboard", () => ctx.setPage?.("Storyboard")),
  );
  wrap.appendChild(grid);

  wrap.appendChild(el("p", "research-note",
    "Everything here follows the project bound above — the folder button in "
    + "the sidebar switches it, and new projects are filed under the world "
    + "you are looking at."));
  return wrap;
}

function overviewPanel() {
  const wrap = el("div");
  wrap.appendChild(el("p", "research-note",
    "GeoID is one workspace over three views of the same data. The globe is "
    + "where data is found and drawn; the Studio is where it becomes geometry "
    + "and a mesh; this hub is where it becomes a result."));
  const loop = [
    ["Data", "Import a raster, vector or point cloud on the globe, or pull one "
      + "from a catalogue in Fetch Data. Everything lands in data/raw/ and is "
      + "registered."],
    ["Geometry", "Draw the study area on the globe and capture it. Extraction "
      + "turns the enclosed terrain into a surface."],
    ["Mesh", "The Studio meshes that surface and writes it to meshes/."],
    ["Simulation", "FEM pages write a run spec; the desktop solver executes it "
      + "and writes results back beside the spec."],
    ["Results", "Post Processing extracts probe series; Signal and Spectral "
      + "pages analyse them."],
    ["Docs", "Publish collects figures and text into a storyboard."],
  ];
  const list = el("div", "research-list");
  loop.forEach(([name, what]) => {
    const line = el("div", "dash-loop-row");
    line.appendChild(el("span", "research-field-label", name));
    line.appendChild(el("span", "research-note", what));
    list.appendChild(line);
  });
  wrap.appendChild(list);
  return wrap;
}

function guidePanel(ctx) {
  const wrap = el("div");
  wrap.appendChild(el("p", "research-note",
    "The rail on the left is the pipeline, read top to bottom. Each stage's "
    + "pages appear in the strip above; the filter narrows them."));
  const jumps = [
    ["Projects", "Open, create and compare projects."],
    ["Data Repository", "What this project holds, and where it came from."],
    ["CSV Plotter", "The quickest look at any table in the project."],
    ["Post Processing", "Turn FEM results into probe time series."],
    ["Signal Processing", "Filter, detrend and resample a series."],
    ["Spectral Analysis", "Its frequency content."],
  ];
  const list = el("div", "research-list");
  jumps.forEach(([page, what]) => {
    const line = el("button", "research-list-row");
    line.type = "button";
    line.appendChild(el("span", "research-list-name", `${page} — ${what}`));
    line.addEventListener("click", () => ctx.setPage?.(page));
    list.appendChild(line);
  });
  wrap.appendChild(list);
  return wrap;
}

async function mount(host, ctx) {
  const { node: status, say } = statusLine();
  const info = bridge.summary();
  const data = info.open ? await store.listData() : [];

  const left = tabbed({
    "Atlas Ecosystem": () => ecosystemPanel(ctx, info),
    "GeoID Overview": () => overviewPanel(),
    "Navigation Guide": () => guidePanel(ctx),
  });

  // ── Right: the project itself ─────────────────────────────────────────────
  const overview = card("Project");
  if (!info.open) {
    overview.appendChild(el("p", "research-note",
      "No project open. Open or create one on the Projects page, or from the "
      + "folder button in the sidebar, to start recording work."));
    overview.appendChild(row(button("Go to Projects", () => ctx.setPage?.("Projects"))));
  } else {
    const grid = el("div", "research-stats");
    grid.append(
      stat("Name", info.name),
      stat("World", info.meta?.body || currentBody()?.id || "earth"),
      stat("Folder", info.dir),
      stat("Phase", info.phase),
      stat("Priority", info.priority),
      stat("Study area", info.hasStudyArea
        ? `${info.studyArea.min_lat}..${info.studyArea.max_lat}, `
          + `${info.studyArea.min_lon}..${info.studyArea.max_lon}`
        : "not set"),
    );
    overview.appendChild(grid);

    const counts = data.reduce((acc, entry) => {
      acc[entry.kind] = (acc[entry.kind] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ");
    overview.appendChild(el("p", "research-note",
      data.length
        ? `Registered data: ${summary}.`
        : "Nothing registered against this project yet."));
  }

  const links = card("Study area");
  links.appendChild(el("p", "research-note",
    "Draw with the Area tool on the globe, then capture it here to set the "
    + "project's bounds. The drawn ring is kept as metadata/study_area.geojson."));
  const capture = button("Capture drawn area", async () => {
    try {
      const bounds = await bridge.captureStudyArea();
      say(`Study area set to ${bounds.min_lat}..${bounds.max_lat}, ${bounds.min_lon}..${bounds.max_lon}.`);
      void mount(host, ctx);
    } catch (error) {
      say(error.message, true);
    }
  });
  const frame = button("Frame study area", () => {
    if (bridge.frameStudyArea()) {
      bridge.goToPage("gis");
      say("Globe framed on the study area.");
    } else {
      say("This project has no study area bounds yet.", true);
    }
  }, { secondary: true });
  capture.disabled = !info.open;
  frame.disabled = !info.open || !info.hasStudyArea;
  links.appendChild(row(capture, frame));

  const right = el("div", "dash-col");
  right.append(overview, links, status);

  const columns = el("div", "research-grid-2");
  columns.append(left, right);
  host.appendChild(columns);
}

registerPage("Dashboard", { mount });
