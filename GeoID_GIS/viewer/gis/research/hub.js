import { STAGES, getPage, stageOf } from "./stages.js?v=20260810n";
import { openDrawer, closeDrawer, currentDrawer } from "./drawers.js?v=20260810n";

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

/** app_qt.py:24838 — AtlasRail._GLYPHS, by rail label. */
const GLYPHS = {
  Dashboard: "⌂", Projects: "▦", "Fetch Data": "⇣",
  Train: "✦", Prepare: "≡", FEM: "△",
  Analysis: "∿", GIS: "◍", Pipeline: "⇶", "Data Hub": "☁",
  Publish: "✎", Settings: "⚙",
};

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
  STAGES.forEach(([key, label, pages]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atlas-rail-btn";
    btn.classList.toggle("is-active", key === activeStage);
    btn.dataset.stage = key;
    // The rail carries the short label; the full Qt stage key is the title, so
    // it stays discoverable without widening the rail for it.
    const built = pages.filter(([id]) => getPage(id)).length;
    btn.title = `${key} — ${built} of ${pages.length} pages built`;

    const glyph = document.createElement("span");
    glyph.className = "atlas-rail-glyph";
    glyph.textContent = GLYPHS[label] || "●";
    glyph.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "atlas-rail-name";
    name.textContent = label;

    btn.append(glyph, name);
    btn.addEventListener("click", () => {
      // Landing on a stage lands on its first *built* page where there is one,
      // so clicking a stage that has work in it does not open a placeholder.
      const target = pages.find(([id]) => getPage(id)) || pages[0];
      if (target) setPage(target[0]);
    });
    rail.appendChild(btn);
  });
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

async function mountPage(pageId) {
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
  const paint = (active) => {
    const chip = byId("research-project");
    if (!chip) return;
    chip.textContent = active ? `◈ ${active.name}` : "No project open";
    chip.title = active
      ? `${active.meta?.body || "earth"} · ${active.dir}`
      : "No project open — the folder button in the sidebar opens one.";
    chip.classList.toggle("is-open", Boolean(active));
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
  let start = STAGES[0][2][0][0];
  try {
    const stored = window.localStorage.getItem(STATE_KEY);
    if (stored && stageOf(stored)) start = stored;
  } catch (error) { /* storage unavailable, ignore */ }
  setPage(start);
}
