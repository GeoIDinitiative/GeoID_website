import { STAGES, getPage, stageOf } from "./stages.js?v=20260809x";

/**
 * The Research Hub shell: a stage rail down the left, a page tab strip across
 * the top of the panel, and one mounted page.
 *
 * The shell knows nothing about any particular page. It reads STAGES for the
 * shape and the registry for the content, so filling in a stage later is a
 * matter of registering a module -- nothing here changes.
 */

const STATE_KEY = "geoid-gis:research-page";

let activePage = null;
let mountedPage = null;
let ctx = {};

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
  const rail = byId("research-rail");
  if (!rail) return;
  rail.textContent = "";
  const activeStage = stageForPage(activePage);
  STAGES.forEach(([key, label, pages]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "research-rail-btn";
    btn.classList.toggle("is-active", key === activeStage);
    btn.dataset.stage = key;
    // The rail carries the short label; the full stage key is the title, so the
    // Qt name is still discoverable without widening the rail for it.
    btn.title = key;

    const name = document.createElement("span");
    name.className = "research-rail-name";
    name.textContent = label;

    const count = document.createElement("span");
    count.className = "research-rail-count";
    const built = pages.filter(([id]) => getPage(id)).length;
    count.textContent = built ? `${built}/${pages.length}` : String(pages.length);
    count.title = built
      ? `${built} of ${pages.length} pages built`
      : `${pages.length} pages`;
    if (built) count.classList.add("is-built");

    btn.append(name, count);
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
  pagesOfStage(stageForPage(activePage)).forEach(([id, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "research-tab";
    btn.classList.toggle("is-active", id === activePage);
    btn.classList.toggle("is-stub", !getPage(id));
    btn.textContent = label;
    btn.title = id;
    btn.addEventListener("click", () => setPage(id));
    strip.appendChild(btn);
  });
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
  activePage = pageId;
  try {
    window.localStorage.setItem(STATE_KEY, pageId);
  } catch (error) { /* storage unavailable, ignore */ }
  renderRail();
  renderTabs();
  const crumb = byId("research-crumb");
  if (crumb) crumb.textContent = `${stageForPage(pageId)} › ${pageId}`;
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
 * The top bar reports the open project on every stage, so it follows the store
 * rather than whichever page last happened to redraw it.
 */
function watchProject(store) {
  const paint = (active) => {
    const badge = byId("research-project");
    if (!badge) return;
    badge.textContent = active ? active.name : "No project open";
    badge.classList.toggle("is-open", Boolean(active));
  };
  store.onChange(paint);
  paint(store.getActive());
}

export function init(context = {}) {
  ctx = { ...context, setPage, refresh };
  if (context.store) watchProject(context.store);
  let start = STAGES[0][2][0][0];
  try {
    const stored = window.localStorage.getItem(STATE_KEY);
    if (stored && stageOf(stored)) start = stored;
  } catch (error) { /* storage unavailable, ignore */ }
  setPage(start);
}
