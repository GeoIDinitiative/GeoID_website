import { registerPage } from "../stages.js?v=20260810g";
import * as store from "../project-store.js?v=20260810g";
import * as bridge from "../bridge.js?v=20260810g";

/**
 * Dashboard: what is open, what it knows, and the ways across to the other
 * pages.
 *
 * This is where the wiring becomes visible. Every action here either reads
 * something the GIS or Model page produced, or sends the user to the page that
 * produces it -- nothing is reimplemented.
 */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function card(title) {
  const box = el("section", "research-card");
  box.appendChild(el("h2", "research-card-title", title));
  return box;
}

function stat(label, value) {
  const box = el("div", "research-stat");
  box.appendChild(el("span", "research-stat-label", label));
  box.appendChild(el("span", "research-stat-value", value));
  return box;
}

function button(label, onClick, { secondary = false } = {}) {
  const node = el("button", secondary ? "button secondary" : "button", label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

async function mount(host, ctx) {
  const status = el("p", "research-status");
  const say = (message, isError) => {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  };

  const info = bridge.summary();

  // ── The open project ────────────────────────────────────────────────────
  const overview = card("Project");
  if (!info.open) {
    overview.appendChild(el("p", "research-note",
      "No project open. Open or create one on the Projects page to start recording work."));
    const row = el("div", "gis-btn-row");
    row.appendChild(button("Go to Projects", () => ctx.setPage?.("Projects")));
    overview.appendChild(row);
  } else {
    const grid = el("div", "research-stats");
    grid.append(
      stat("Name", info.name),
      stat("Folder", info.dir),
      stat("Phase", info.phase),
      stat("Priority", info.priority),
      stat("Study area", info.hasStudyArea
        ? `${info.studyArea.min_lat}..${info.studyArea.max_lat}, `
          + `${info.studyArea.min_lon}..${info.studyArea.max_lon}`
        : "not set"),
    );
    overview.appendChild(grid);

    const data = await store.listData();
    const counts = data.reduce((acc, entry) => {
      acc[entry.kind] = (acc[entry.kind] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ");
    overview.appendChild(el("p", "research-note",
      data.length ? `Registered data: ${summary}.` : "Nothing registered against this project yet."));
  }

  // ── Across to the other pages ───────────────────────────────────────────
  const links = card("Work on this project");
  links.appendChild(el("p", "research-note",
    "The globe and the studio are the tools; this page is what they belong to. "
    + "Anything imported or exported over there is recorded here."));

  const gisRow = el("div", "gis-btn-row");
  gisRow.append(
    button("Open GIS page", () => bridge.goToPage("gis")),
    button("Open Meshing Studio", () => bridge.goToPage("model"), { secondary: true }),
  );
  links.appendChild(gisRow);

  const areaRow = el("div", "gis-btn-row");
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
  areaRow.append(capture, frame);
  links.appendChild(areaRow);
  links.appendChild(el("p", "research-note",
    "Draw with the Area tool on the GIS page, then capture it here to set the "
    + "project's bounds. The drawn ring is kept as metadata/study_area.geojson."));

  host.append(overview, links, status);
}

registerPage("Dashboard", { mount });
