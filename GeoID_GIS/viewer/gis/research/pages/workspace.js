import { registerPage } from "../stages.js?v=20260904-200ef9b";
import * as store from "../project-store.js?v=20260904-200ef9b";
import * as bridge from "../bridge.js?v=20260904-200ef9b";
import { currentBody } from "../../bodies.js?v=20260904-200ef9b";
import { el } from "./common.js?v=20260904-200ef9b";

/**
 * The Workspace — the curated home of the analysis ecosystem.
 *
 * This replaces a page transliterated from the Qt app with one designed for the
 * web and for the way the work actually flows. The whole hub is 62 tools; a
 * person does not want 62 doors, they want the *path*: bring data in, prepare
 * it, model it, analyse the result, publish it. This page is that path, made
 * concrete against the one thing that ties GIS, Model and Research together —
 * the open project folder.
 *
 * Everything here reads and writes that one project, and every card is a way
 * *into* the stage it names, so the page is a map of the workflow, not a
 * dead-end dashboard. When no project is open it is a single clear prompt to
 * make one, because nothing downstream means anything until then.
 */

/** The five stages of the flow, each a door into its primary page. */
const FLOW = [
  { key: "import", name: "Import", stage: "Fetch Data", page: "Ingest Generic Import",
    cap: "#00c8ff", blurb: "Bring data into the project",
    icon: "M12 3v10m0 0 4-4m-4 4-4-4M4 17v3h16v-3" },
  { key: "prepare", name: "Prepare", stage: "Prepare", page: "Data Repository",
    cap: "#7d5cff", blurb: "Clean, transform, QA",
    icon: "M4 7h16M4 12h16M4 17h16M9 5v4m6 1v4" },
  { key: "model", name: "Model", stage: "FEM", page: "Setup",
    cap: "#c86bff", blurb: "Configure and run the simulation",
    icon: "M12 3 21 19H3Zm0 0v16" },
  { key: "analyse", name: "Analyse", stage: "Analysis", page: "Signal Processing",
    cap: "#5cf2ff", blurb: "Signal, spectral, statistics",
    icon: "M3 12c2-6 4 6 6 0s4-6 6 0 4 6 6 0" },
  { key: "publish", name: "Publish", stage: "Publish", page: "Figure Composer",
    cap: "#ffd166", blurb: "Figures, storyboard, export",
    icon: "M4 20h16M5 16.5 16 5.5l3 3L8 19.5l-4 1Z" },
];

const SVG = "http://www.w3.org/2000/svg";
function icon(path) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

/** How many things each stage has produced in the project, for the card badge. */
async function flowCounts() {
  const counts = { import: 0, prepare: 0, model: 0, analyse: 0, publish: 0 };
  try {
    const data = await store.listData();
    counts.import = data.length;
    counts.prepare = data.filter((d) => /processed|clean|transform/i.test(d.path || "")).length;
  } catch (error) { /* no registry yet */ }
  const dirCount = async (dir, filter) => {
    try {
      const entries = await store.listProjectDir(dir);
      return entries.filter(filter || (() => true)).length;
    } catch (error) { return 0; }
  };
  counts.model = await dirCount("fem_runs", (e) => e.kind === "directory");
  counts.analyse = await dirCount("analysis");
  const figs = await dirCount("figures");
  const exp = await dirCount("exports");
  counts.publish = figs + exp;
  return counts;
}

function goTo(page) { window.GeoIDResearch?.setPage?.(page); }

function mount(host, ctx) {
  const body = el("div", "workspace-home");
  const active = store.getActive();

  // ── No project: one clear door in ──────────────────────────────────────────
  if (!active) {
    const hero = el("div", "ws-hero");
    hero.appendChild(icon("M3 7h6l2 2h10v10H3Z"));
    hero.appendChild(el("h2", "ws-hero-title", "Start a project"));
    hero.appendChild(el("p", "ws-hero-sub",
      "Every tool in the workspace reads and writes one project folder — the "
      + "same folder the GIS globe and the desktop app use. Create or open one "
      + "to begin."));
    const cta = el("button", "button is-primary ws-hero-cta", "+ New / Open Project");
    cta.type = "button";
    cta.addEventListener("click", () => window.GeoIDProject?.open?.(true));
    hero.appendChild(cta);
    hero.appendChild(el("p", "ws-hero-note",
      "On disk it is a real folder the desktop app can open; without a folder "
      + "picker it is kept in this browser instead — the dialog explains which."));
    body.appendChild(hero);
    host.appendChild(body);
    return;
  }

  // ── Header: the active project and where it lives ───────────────────────────
  const world = currentBody();
  const head = el("div", "ws-head");
  const left = el("div", "ws-head-left");
  left.appendChild(el("h1", "ws-title", active.name));
  left.appendChild(el("p", "ws-sub",
    `${world?.name || active.meta?.body || "Earth"} · ${active.dir}`));
  head.appendChild(left);
  const switchBtn = el("button", "button secondary", "Switch / link folder");
  switchBtn.type = "button";
  switchBtn.addEventListener("click", () => window.GeoIDProject?.open?.(true));
  head.appendChild(switchBtn);
  body.appendChild(head);

  // ── Study area: the GIS ↔ Research bond ─────────────────────────────────────
  const area = active.meta?.study_area;
  // A real extent has finite bounds *and* a non-zero span — an all-zero record
  // is the schema's default, not a place, and showing "0,0 → 0,0" reads as
  // broken. Treat it as unset so the panel invites drawing one instead.
  const hasArea = area
    && ["min_lat", "max_lat", "min_lon", "max_lon"].every((k) => Number.isFinite(Number(area[k])))
    && (Number(area.max_lat) - Number(area.min_lat) !== 0
        || Number(area.max_lon) - Number(area.min_lon) !== 0);
  const saCard = el("div", "ws-card ws-studyarea");
  saCard.appendChild(el("h3", "ws-card-title", "Study area"));
  if (hasArea) {
    const extent = `${(+area.min_lat).toFixed(2)}, ${(+area.min_lon).toFixed(2)}  →  `
      + `${(+area.max_lat).toFixed(2)}, ${(+area.max_lon).toFixed(2)}`;
    saCard.appendChild(el("p", "ws-studyarea-extent", extent));
    const acts = el("div", "ws-actions");
    const frame = el("button", "button", "Frame on globe");
    frame.type = "button";
    frame.addEventListener("click", () => {
      window.GeoIDModeManager?.setMode?.("gis");
      setTimeout(() => bridge.frameStudyArea(), 400);
    });
    const edit = el("button", "button secondary", "Edit on globe");
    edit.type = "button";
    edit.addEventListener("click", () => bridge.goToPage("gis"));
    acts.append(frame, edit);
    saCard.appendChild(acts);
  } else {
    saCard.appendChild(el("p", "ws-muted",
      "No study area yet. Draw one with the Area tool, or click a point on the "
      + "globe to set a box around it — every stage below reads it."));
    const acts = el("div", "ws-actions");
    const draw = el("button", "button", "Draw on the globe");
    draw.type = "button";
    draw.addEventListener("click", () => bridge.goToPage("gis"));
    const pick = el("button", "button secondary", "◎ Pick a point");
    pick.type = "button";
    pick.addEventListener("click", () => pickStudyArea(pick));
    acts.append(draw, pick);
    saCard.appendChild(acts);
  }

  /** Click the globe → a small study-area box around that point. */
  async function pickStudyArea(btn) {
    btn.disabled = true;
    const restore = btn.textContent;
    btn.textContent = "Click the globe…";
    try {
      const { lat, lonSigned } = await bridge.pickOnGlobe();
      const half = 0.5;   // a ~1° box, a sensible default the user can refine
      await store.updateMetadata({ study_area: {
        min_lat: (lat - half).toFixed(6), max_lat: (lat + half).toFixed(6),
        min_lon: (lonSigned - half).toFixed(6), max_lon: (lonSigned + half).toFixed(6),
        crs: "EPSG:4326",
      } });
      window.GeoIDResearch?.setPage?.("Dashboard");   // re-mount with the new area
    } catch (error) {
      btn.disabled = false;
      btn.textContent = restore;
    }
  }

  // ── The workflow: five stages, each a door with a live count ────────────────
  const flowWrap = el("div", "ws-flow");
  flowWrap.appendChild(el("h3", "ws-card-title", "Workflow"));
  const strip = el("div", "ws-flow-strip");
  const cards = FLOW.map((s) => {
    const cardEl = el("button", "ws-stage");
    cardEl.type = "button";
    cardEl.style.setProperty("--cap", s.cap);
    cardEl.appendChild(icon(s.icon));
    cardEl.appendChild(el("span", "ws-stage-name", s.name));
    cardEl.appendChild(el("span", "ws-stage-blurb", s.blurb));
    const badge = el("span", "ws-stage-badge", "—");
    cardEl.appendChild(badge);
    cardEl.addEventListener("click", () => goTo(s.page));
    strip.appendChild(cardEl);
    return { s, badge, cardEl };
  });
  flowWrap.appendChild(strip);

  // A row of the two panels: study area + a recent-activity feed.
  const cols = el("div", "ws-cols");
  cols.appendChild(saCard);
  const activity = el("div", "ws-card ws-activity");
  activity.appendChild(el("h3", "ws-card-title", "Recent in this project"));
  const feed = el("div", "ws-feed");
  feed.appendChild(el("p", "ws-muted", "Loading…"));
  activity.appendChild(feed);
  cols.appendChild(activity);

  body.append(flowWrap, cols);
  host.appendChild(body);

  // ── Fill the live numbers and the feed, after the frame is on screen ───────
  (async () => {
    const counts = await flowCounts();
    cards.forEach(({ s, badge, cardEl }) => {
      const n = counts[s.key] || 0;
      badge.textContent = String(n);
      cardEl.classList.toggle("has-content", n > 0);
    });
    let data = [];
    try { data = await store.listData(); } catch (error) { /* none */ }
    feed.textContent = "";
    if (!data.length) {
      feed.appendChild(el("p", "ws-muted",
        "Nothing yet — import a dataset or capture a study area to begin."));
    } else {
      data.slice(-8).reverse().forEach((d) => {
        const rowEl = el("div", "ws-feed-row");
        rowEl.appendChild(el("span", "ws-feed-name", d.name || (d.path || "").split("/").pop()));
        if (d.source || d.source_stage) {
          rowEl.appendChild(el("span", "ws-feed-src", d.source || d.source_stage));
        }
        if (d.tag) rowEl.appendChild(el("span", "ws-feed-tag", d.tag));
        // A spatial result can go back onto the globe it came from — the return
        // path that stops analysis dead-ending in a folder.
        if (bridge.isGeoFile(d.path)) {
          const show = el("button", "button secondary ws-feed-globe", "◉ Globe");
          show.type = "button";
          show.title = "Show on the globe";
          show.addEventListener("click", async () => {
            show.disabled = true;
            try { await bridge.sendToGlobe(d); }
            catch (error) { show.disabled = false; show.textContent = "✕"; show.title = error.message; }
          });
          rowEl.appendChild(show);
        }
        feed.appendChild(rowEl);
      });
    }
  })();
}

mount.ownHeader = true;
mount.specComplete = true;
registerPage("Dashboard", { mount });
