import { STAGES, getPage, stageOf } from "./stages.js?v=20260816-f61b5f5";
import { openDrawer, closeDrawer, currentDrawer } from "./drawers.js?v=20260816-f61b5f5";
import { PAGE_BLURBS } from "./page-blurbs.js?v=20260816-f61b5f5";
import * as sidecar from "./sidecar.js?v=20260816-f61b5f5";
import * as store from "./project-store.js?v=20260816-f61b5f5";

/**
 * The Research Hub shell, laid out as the Qt app lays it out.
 *
 * Qt structure being mirrored (app_qt.py): `AtlasRail` at :24831 — a 76px rail
 * of glyph-above-label buttons under the GeoID mark — and `WorkspaceShell` at
 * :3597, whose one row carries the page tabs on the left and, on the right, the
 * page filter, the magenta Atlas project chip and the five shell actions
 * (Jobs, Alerts, + New Note, Copilot, Data Shelf). The stage tab bar exists in
 * Qt but is hidden; the rail drives it. Here the rail simply *is* the stage
 * control, which is the same thing without the vestigial widget.
 *
 * The shell still knows nothing about any particular page: it reads STAGES for
 * the shape and the registry for the content.
 */

const STATE_KEY = "geoid-gis:research-page";

/**
 * The rail, as data.
 *
 * Design copied from the Atlas hub's Dock (`hub/frontend/src/components/
 * layout/Dock.tsx` and `.dock-item` / `.dock-band` in its global.css), not
 * from the Qt rail: a bordered card per stage carrying its own capability
 * colour, grouped into bands by a hairline and a quiet label, and an active
 * state that is a **solid fill of that colour** with dark ink.
 *
 * Note that solid fill contradicts the atlas-design-system skill, which says
 * active is a soft wash and "NEVER a solid fill with dark text". The shipped
 * Dock is the newer answer and it is what Owen asked for, so the Dock wins.
 *
 * `cap` reuses the hub's own values wherever a stage matches one of its
 * capabilities (mesh, metrics, earth, settings, briefing, files, agents), so
 * the two products colour the same idea the same way.
 *
 * `band` is presentation and lives here rather than in stages.js, which stays
 * a straight mirror of the Qt `base_stage_structure`. `icon` replaces the Qt
 * text glyphs (⌂ ▦ ⇣ …): those render differently in every font and looked
 * scrappy at 24px on a solid fill.
 *
 * Keyed by rail label, which is what STAGES carries.
 */
const RAIL = {
  Dashboard:  { band: "Workspace", cap: "#ff2ec4", icon: "M3 11 12 4l9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" },
  Projects:   { band: "Workspace", cap: "#3dff8f", icon: "M3 7h6l2 2h10v10H3Zm0 0V5h6l2 2" },
  "Fetch Data": { band: "Data", cap: "#00c8ff", icon: "M12 3v10m0 0 4-4m-4 4-4-4M4 17v3h16v-3" },
  Train:      { band: "Data", cap: "#ff5cf0", icon: "M12 3l2.2 5.3L20 9.6l-4 3.9 1 5.5-5-2.8-5 2.8 1-5.5-4-3.9 5.8-1.3Z" },
  Prepare:    { band: "Data", cap: "#7d5cff", icon: "M4 7h16M4 12h16M4 17h16M9 5v4m6 1v4M7 15v4" },
  FEM:        { band: "Model", cap: "#c86bff", icon: "M12 3 21 19H3Zm0 0v16M3 19l9-8 9 8" },
  Analysis:   { band: "Model", cap: "#5cf2ff", icon: "M3 12c2-6 4 6 6 0s4-6 6 0 4 6 6 0" },
  // Hidden: the header's GIS button already goes to the globe, and the stage
  // held nothing but hand-offs to it. The stage stays in stages.js, which
  // mirrors the Qt structure -- Qt has no header switch, so it needs the rail
  // entry and we do not.
  GIS:        { band: "Platform", cap: "#35d49b", hidden: true, icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c3 3.5 3 14.5 0 18m0-18c-3 3.5-3 14.5 0 18M3.5 9h17M3.5 15h17" },
  Pipeline:   { band: "Platform", cap: "#ffb300", icon: "M3 7h11l-3-3m3 3-3 3M21 17H10l3-3m-3 3 3 3" },
  "Data Hub": { band: "Platform", cap: "#00e0d0", icon: "M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 10a4 4 0 0 1 0 8Z" },
  Publish:    { band: "Publish", cap: "#ffd166", icon: "M4 20h16M5 16.5 16 5.5l3 3L8 19.5l-4 1Z" },
  Settings:   { band: "System", cap: "#b8a8e8", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm7.4 3a7.4 7.4 0 0 0-.15-1.4l2-1.5-2-3.4-2.3 1a7.4 7.4 0 0 0-2.4-1.4L14.2 3H9.8l-.35 2.3a7.4 7.4 0 0 0-2.4 1.4l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.8l-2 1.5 2 3.4 2.3-1a7.4 7.4 0 0 0 2.4 1.4L9.8 21h4.4l.35-2.3a7.4 7.4 0 0 0 2.4-1.4l2.3 1 2-3.4-2-1.5c.1-.46.15-.93.15-1.4Z" },
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** 24px stroked glyph, the size and weight the Dock's icons use. */
function railIcon(path) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const node = document.createElementNS(SVG_NS, "path");
  node.setAttribute("d", path);
  svg.appendChild(node);
  return svg;
}

let activePage = null;
let mountedPage = null;
let ctx = {};
let filterText = "";

function byId(id) {
  return document.getElementById(id);
}

function stageForPage(pageId) {
  return stageOf(pageId) || STAGES[0][0];
}

function pagesOfStage(stageKey) {
  const found = STAGES.find(([key]) => key === stageKey);
  return found ? found[2] : [];
}

function renderRail() {
  const rail = byId("research-rail-buttons");
  if (!rail) return;
  rail.textContent = "";
  const activeStage = stageForPage(activePage);
  // A band header is emitted the first time its band appears, walking the
  // stages in order -- the order is the Qt pipeline's and is never re-sorted
  // to suit the grouping.
  const headed = new Set();

  STAGES.forEach(([key, label, pages]) => {
    const spec = RAIL[label] || {};
    if (spec.hidden) return;
    if (spec.band && !headed.has(spec.band)) {
      headed.add(spec.band);
      const head = document.createElement("div");
      head.className = "atlas-rail-band";
      if (headed.size === 1) head.classList.add("is-first");
      head.setAttribute("aria-hidden", "true");
      head.textContent = spec.band;
      rail.appendChild(head);
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atlas-rail-btn";
    btn.classList.toggle("is-active", key === activeStage);
    btn.dataset.stage = key;
    // The capability colour drives the border, the hover wash and the active
    // fill, exactly as --cap does in the Dock.
    if (spec.cap) btn.style.setProperty("--cap", spec.cap);
    btn.setAttribute("aria-pressed", key === activeStage ? "true" : "false");
    // The rail carries the short label; the full stage name is the title, so it
    // stays discoverable without widening the rail for it. Nothing about build
    // progress: that was scaffolding talk on a finished product.
    btn.title = key;

    if (spec.icon) btn.appendChild(railIcon(spec.icon));

    const name = document.createElement("span");
    name.className = "atlas-rail-name";
    name.textContent = label;
    btn.appendChild(name);

    btn.addEventListener("click", () => {
      // Landing on a stage lands on its first *built* page where there is one,
      // so clicking a stage that has work in it does not open a placeholder.
      const target = pages.find(([id]) => getPage(id)) || pages[0];
      if (target) setPage(target[0]);
    });
    rail.appendChild(btn);
  });
  markRailOverflow();
}

/**
 * Twelve banded stages are taller than most windows, and a rail that simply
 * stops at the fold reads as though that is all there is. Same answer the Dock
 * gives: fade the edge the content continues past.
 */
function markRailOverflow() {
  const rail = document.querySelector(".atlas-rail");
  if (!rail) return;
  const slack = rail.scrollHeight - rail.clientHeight;
  rail.classList.toggle("has-more-above", slack > 1 && rail.scrollTop > 1);
  rail.classList.toggle("has-more-below", slack > 1 && rail.scrollTop < slack - 1);
}

function renderTabs() {
  const strip = byId("research-tabs");
  if (!strip) return;
  strip.textContent = "";
  const needle = filterText.trim().toLowerCase();
  const pages = pagesOfStage(stageForPage(activePage));
  const shown = needle
    ? pages.filter(([id, label]) =>
        id.toLowerCase().includes(needle) || label.toLowerCase().includes(needle))
    : pages;
  shown.forEach(([id, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shell-tab";
    btn.classList.toggle("is-active", id === activePage);
    btn.classList.toggle("is-stub", !getPage(id));
    btn.textContent = label;
    btn.title = id;
    btn.addEventListener("click", () => setPage(id));
    strip.appendChild(btn);
  });
  if (needle && !shown.length) {
    const empty = document.createElement("span");
    empty.className = "shell-tab-empty";
    empty.textContent = `No page in ${stageForPage(activePage)} matches “${filterText}”.`;
    strip.appendChild(empty);
  }
}

/** What a page that has not been built yet looks like. Honest, not a mock-up. */
function renderStub(host, pageId) {
  const stage = stageForPage(pageId);
  host.innerHTML = "";
  const box = document.createElement("div");
  box.className = "research-stub";
  const title = document.createElement("h2");
  title.className = "research-stub-title";
  title.textContent = pageId;
  const note = document.createElement("p");
  note.className = "research-stub-note";
  note.textContent = `${stage} · this page is not built yet.`;
  box.append(title, note);
  host.appendChild(box);
}

/**
 * One mount at a time, and only the newest.
 *
 * `setPage`, the project watcher and `setContext` can all ask for a mount, and
 * a page that awaits anything (every page reads the project) leaves a window
 * where three of them interleave: each clears the host, then all three append.
 * Build New rendered its ten step cards three times over because of exactly
 * that. Queueing serialises them; the token drops any that were superseded
 * while they waited.
 */
let mountToken = 0;
let mountChain = Promise.resolve();

function mountPage(pageId) {
  const token = ++mountToken;
  mountChain = mountChain.then(() => (token === mountToken
    ? mountPageNow(pageId)
    : undefined));
  return mountChain;
}

async function mountPageNow(pageId) {
  const host = byId("research-page");
  if (!host) return;
  if (mountedPage?.unmount) {
    try { mountedPage.unmount(host); } catch (error) { /* page teardown, ignore */ }
  }
  mountedPage = null;
  const page = getPage(pageId);
  if (!page) {
    renderStub(host, pageId);
    return;
  }
  host.innerHTML = "";
  mountedPage = page;
  try {
    // Every Qt page opens with a title and a line on what it is for. Rendered
    // here so all sixty-four have one rather than each module remembering to;
    // a page that draws its own (it needs a status pill, or a title different
    // from its tab name) sets `ownHeader` and is left alone.
    if (!page.mount?.ownHeader && !page.ownHeader) {
      const header = document.createElement("header");
      header.className = "page-header";
      const main = document.createElement("div");
      main.className = "page-header-main";
      const title = document.createElement("h1");
      title.className = "page-title";
      title.textContent = pageId;
      main.appendChild(title);
      const blurb = PAGE_BLURBS[pageId];
      if (blurb) {
        const sub = document.createElement("p");
        sub.className = "page-subtitle";
        sub.textContent = blurb;
        main.appendChild(sub);
      }
      header.appendChild(main);
      host.appendChild(header);
    }
    await page.mount(host, ctx);
  } catch (error) {
    host.innerHTML = "";
    const box = document.createElement("div");
    box.className = "research-stub";
    box.innerHTML = `<h2 class="research-stub-title">${pageId}</h2>`;
    const note = document.createElement("p");
    note.className = "research-stub-note";
    // Shown rather than swallowed: a page that throws should say so in the
    // place it was meant to appear.
    note.textContent = `Failed to open: ${error.message}`;
    box.appendChild(note);
    host.appendChild(box);
  }
}

export function setPage(pageId) {
  if (!stageOf(pageId)) return;
  const stageChanged = stageForPage(pageId) !== stageForPage(activePage);
  activePage = pageId;
  // The filter scopes one stage's tabs, so it clears on leaving that stage --
  // otherwise the next stage opens looking half-empty for no visible reason.
  if (stageChanged) {
    filterText = "";
    const box = byId("research-filter");
    if (box) box.value = "";
  }
  try {
    window.localStorage.setItem(STATE_KEY, pageId);
  } catch (error) { /* storage unavailable, ignore */ }
  renderRail();
  renderTabs();
  // No stage caption in the row: Qt hides its own (`context_hint.hide()`,
  // app_qt.py:3690) because the lit rail button already says where you are,
  // and the row has more to carry here than it does there.
  void mountPage(pageId);
}

export function getPageId() {
  return activePage;
}

/** Re-draw the rail and tabs, for when pages register after first paint. */
export function refresh() {
  renderRail();
  renderTabs();
}

export function setContext(next) {
  ctx = { ...ctx, ...next };
  // A page already on screen should pick up a project change without the user
  // having to navigate away and back.
  if (activePage) void mountPage(activePage);
}

/**
 * The Atlas chip reports the open project on every stage, so it follows the
 * store rather than whichever page last happened to redraw it. Magenta pill,
 * per the Atlas grammar: this surface is bound to a project.
 */
function watchProject(store) {
  let shownDir = null;
  // The chip is the project spine's control everywhere in the hub: click it to
  // create, open or link a folder, the same dialog the GIS sidebar opens. It
  // used to be a dead label that told you to go and find the sidebar button —
  // the "can't link a folder from Research" gap.
  const chipBtn = byId("research-project");
  if (chipBtn && !chipBtn.dataset.wired) {
    chipBtn.dataset.wired = "1";
    chipBtn.style.cursor = "pointer";
    chipBtn.setAttribute("role", "button");
    chipBtn.setAttribute("tabindex", "0");
    const openDialog = () => window.GeoIDProject?.open?.(true);
    chipBtn.addEventListener("click", openDialog);
    chipBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDialog(); }
    });
  }
  const paint = (active) => {
    const chip = byId("research-project");
    if (chip) {
      chip.textContent = active ? `◈ ${active.name}` : "+ New / Open Project";
      chip.title = active
        ? `${active.meta?.body || "earth"} · ${active.dir} — click to switch or link a folder`
        : "Click to create, open or link a project folder.";
      chip.classList.toggle("is-open", Boolean(active));
    }
    // Re-mount when a *different* project is opened, so a page stops reporting
    // the one before it -- the chip used to update while the page behind it
    // still read "No project open".
    //
    // Keyed on the folder, not on every announcement: updateMetadata() also
    // announces, and it is called while someone is typing into a metadata
    // form. Re-mounting on that would take the form away mid-edit.
    const dir = active?.dir ?? null;
    if (dir !== shownDir) {
      shownDir = dir;
      if (activePage) void mountPage(activePage);
    }
  };
  store.onChange(paint);
  paint(store.getActive());
}

/** Jobs / Alerts / + New Note / Copilot / Data Shelf, as toggles. */
function wireActions() {
  const buttons = Array.from(document.querySelectorAll(".shell-action[data-drawer]"));
  const paint = () => {
    const open = currentDrawer();
    buttons.forEach((b) => {
      const on = b.dataset.drawer === open;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.drawer;
      if (currentDrawer() === name) closeDrawer();
      else await openDrawer(name, ctx);
      paint();
    });
  });
  document.addEventListener("geoid:drawer-changed", paint);
  paint();
}

export function init(context = {}) {
  ctx = { ...context, setPage, refresh };
  if (context.store) watchProject(context.store);
  const filter = byId("research-filter");
  if (filter) {
    filter.addEventListener("input", () => {
      filterText = filter.value;
      renderTabs();
    });
  }
  wireActions();
  // Reconnect to a sidecar configured last session, and make it the store when
  // it answers -- so the hub opens on the same folder the desktop app uses.
  if (sidecar.getConfig().url) {
    sidecar.probe().then((result) => {
      if (result.ok) {
        try { store.useAdapter(sidecar.sidecarAdapter()); } catch (error) { /* */ }
      }
    });
  }
  const rail = document.querySelector(".atlas-rail");
  if (rail) {
    rail.addEventListener("scroll", markRailOverflow, { passive: true });
    // The hub is hidden until Research mode, so it has no height to measure at
    // load; re-check whenever the rail's own box changes.
    if (window.ResizeObserver) new ResizeObserver(markRailOverflow).observe(rail);
  }
  let start = STAGES[0][2][0][0];
  try {
    const stored = window.localStorage.getItem(STATE_KEY);
    if (stored && stageOf(stored)) start = stored;
  } catch (error) { /* storage unavailable, ignore */ }
  setPage(start);
}
