/**
 * Pre-processing and Extraction & Analysis, as buttons on the tool rail.
 *
 * Both are *workbenches*: you open one, work in it, and close it. In the
 * sidebar they were two more collapsibles in a column of nine, so reaching
 * either meant scrolling past the rest, and having one open pushed everything
 * else out of view. The rail already holds the things you pick up and put down
 * — Distance, Draw, Profile — and these belong with those.
 *
 * The panel is the sidebar's own shell, not a lookalike: same border, ground,
 * rounding and scrolling body, and the `<details>` group is **moved** into it
 * rather than rebuilt, so every section, handler and id inside it is the one
 * that was already there. Nothing downstream can tell the difference, which is
 * what keeps `toolbox.js`'s MOVES (`gis-analysis-section` →
 * `analysis-tools-host`) working untouched.
 *
 * The stylesheet is injected from here rather than added to a CSS file. Earth
 * loads `viewer/styles.css` and the nine planet pages load their own plus
 * `gis/shell.css`, so anything written to one of those has to be written to the
 * other — which has been the cause of six separate defects in this codebase.
 * One source, every page.
 */

const PANELS = [
  {
    id: "preprocess",
    group: "gis-group-preprocess",
    label: "Pre-proc",
    title: "Pre-processing Toolbox",
    // A funnel: raw in, tidy out.
    icon: '<path d="M3.5 4.5h17l-6.5 7.6v6.4l-4 2.4v-8.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  },
  {
    id: "analysis",
    group: "gis-group-analysis",
    label: "Extract",
    title: "Extraction & Analysis",
    icon: '<path d="M2.6 12.6 5.4 8l2.3 2.6L10.2 5l3.2 5.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(3 3) scale(1.1)"/>',
  },
];

/**
 * Only what the sidebar cannot lend.
 *
 * The shell — border, ground, rounding, glow, type — is not written here at
 * all: it is READ off `#ui` at build time and applied to the panel, so these
 * are the sidebar, on the other side of the screen. That is what makes them
 * match on Earth, on a planet page, embedded or not, and through any future
 * reskin, without a second copy of those values existing anywhere.
 */
const STYLE = `
.tool-rail-panel-btn.is-open {
  border-color: rgba(var(--nav-accent-rgb), 0.9);
  background: rgba(var(--nav-accent-rgb), 0.18);
}

/* While a workbench is open the rest of the rail shrinks to its icons. The
   open one is untouched, so the rail still reads as a place you are. */
#tool-rail.has-open-panel .tool-rail-btn:not(.is-open) {
  width: 2.3rem;
  min-height: 2.3rem;
  padding: 0.3rem 0.18rem;
  transition: width 0.15s ease, min-height 0.15s ease;
}
#tool-rail.has-open-panel .tool-rail-btn:not(.is-open) span { display: none; }
#tool-rail.has-open-panel .tool-rail-btn:not(.is-open) svg { width: 1rem; height: 1rem; }

/* ESC is a word, not a glyph, so it needs the room the icon buttons do not. */
.gis-side-panel .brand-toprow-actions .info-btn {
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  padding: 0 0.35rem;
  min-width: 1.6rem;
}

.gis-side-panel {
  position: fixed;
  z-index: 12;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.gis-side-panel[hidden] { display: none; }

/* The sidebar's own header row, and its own buttons inside it. */
.gis-side-panel .brand-toprow {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem 0.35rem 0.75rem;
  border-bottom: 1px solid rgba(var(--nav-accent-rgb), 0.2);
}
.gis-side-panel-title {
  flex: 1;
  min-width: 0;
  font-size: 0.66rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--nav-accent-rgb, 120 200 255));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Scrolls exactly as #ui-scroll-body does. */
.gis-side-panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(151, 182, 194, 0.32) transparent;
  padding: 0.5rem 0.55rem 0.85rem;
}

/* Collapsed is a bar, exactly as #ui.is-collapsed is: the header stays, the
   body goes, and the panel keeps its place in the column. */
.gis-side-panel.is-collapsed .gis-side-panel-body { display: none; }

/* The group arrives as one collapsible of nine. On its own it IS the panel, so
   its shell is dropped -- the header above already names it, and a second
   title inside said everything twice. */
.gis-side-panel-body > .toolbox-group {
  border: 0;
  background: none;
  margin: 0;
  padding: 0;
}
.gis-side-panel-body > .toolbox-group > summary { display: none; }
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.dataset.gisSidePanels = "";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

const panels = new Map();

/** Only one workbench at a time: they would otherwise stack on one another. */
function setOpen(id, open) {
  let any = false;
  panels.forEach((entry, key) => {
    const on = key === id ? open : false;
    if (on) any = true;
    entry.panel.hidden = !on;
    entry.button.classList.toggle("is-open", on);
    entry.button.setAttribute("aria-expanded", on ? "true" : "false");
  });
  /**
   * With a workbench open the rail steps back: the tools you are not using
   * shrink to their icons. The one you opened keeps its label, so the rail
   * still says where you are, and the panel gets the width they gave up.
   */
  document.getElementById("tool-rail")?.classList.toggle("has-open-panel", any);
  place();
}

/**
 * Anchored under the rail, sharing its right edge.
 *
 * Measured from the rail rather than written as an offset, for the same reason
 * the zoom pill and the Atlas mark are: the rail's width changes with the
 * breakpoint and its top moves when the hub arms. The height stops short of the
 * scale bar, which owns the bottom of this side.
 */
function place() {
  const rail = document.getElementById("tool-rail");
  if (!rail) return;
  const box = rail.getBoundingClientRect();
  if (!box.width) return;
  // Left of the rail, sharing its gap.
  const right = Math.max(8, Math.round(window.innerWidth - box.left + 10));
  /**
   * From the top down, level with the sidebar.
   *
   * A workbench is the other half of the screen from the toolbox, so it starts
   * where the toolbox starts and grows downward — not hanging off the bottom of
   * the rail, which left it floating in the middle with the globe above it.
   */
  const sidebar = document.getElementById("ui");
  const top = Math.round(sidebar?.getBoundingClientRect().top ?? 16);
  panels.forEach(({ panel }) => {
    if (panel.hidden) return;
    panel.style.right = `${right}px`;
    panel.style.top = `${top}px`;
    // Clear of the scale bar and its readout at the foot of this column.
    panel.style.maxHeight = `${Math.max(180, window.innerHeight - top - 96)}px`;
  });
}

/**
 * The shell properties borrowed from `#ui`.
 *
 * Read rather than declared, so the panel is the sidebar and not a likeness of
 * it. Width is included: the two columns then balance, one each side.
 */
const SHELL_PROPS = [
  "width", "border", "borderRadius", "background", "backdropFilter",
  "boxShadow", "color", "fontFamily",
];

function adoptSidebarShell(panel) {
  const sidebar = document.getElementById("ui");
  if (!sidebar) return;
  const from = getComputedStyle(sidebar);
  SHELL_PROPS.forEach((prop) => { panel.style[prop] = from[prop]; });
}

function buildPanel(spec, group) {
  const panel = document.createElement("section");
  panel.className = "gis-side-panel";
  panel.id = `gis-side-panel-${spec.id}`;
  panel.hidden = true;
  panel.setAttribute("aria-label", spec.title);

  // The sidebar's header row, class for class, so it inherits whatever that
  // row is skinned with on this page.
  const head = document.createElement("div");
  head.className = "brand-toprow";
  const title = document.createElement("span");
  title.className = "gis-side-panel-title";
  title.textContent = spec.title;

  const actions = document.createElement("div");
  actions.className = "brand-toprow-actions";
  // `#nav-collapse-btn` carries no class -- the sidebar styles it by id -- so
  // the chevron borrows `.info-btn`, the other button in that row, which is
  // styled by class and therefore lends itself.
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.className = "info-btn";
  collapse.textContent = "‹";
  collapse.title = "Collapse";
  collapse.setAttribute("aria-label", `Collapse ${spec.title}`);
  collapse.setAttribute("aria-expanded", "true");
  collapse.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("is-collapsed");
    collapse.textContent = collapsed ? "›" : "‹";
    collapse.setAttribute("aria-expanded", collapsed ? "false" : "true");
    place();
  });
  // Esc closes the workbench outright, where the chevron only folds it away.
  const escape = document.createElement("button");
  escape.type = "button";
  escape.className = "info-btn";
  escape.textContent = "ESC";
  escape.title = "Close";
  escape.setAttribute("aria-label", `Close ${spec.title}`);
  escape.addEventListener("click", () => setOpen(spec.id, false));

  actions.append(collapse, escape);
  head.append(title, actions);

  const body = document.createElement("div");
  body.className = "gis-side-panel-body";
  // Moved, not copied: the sections inside are the ones the rest of the app
  // already holds references to.
  group.open = true;
  body.appendChild(group);

  panel.append(head, body);
  document.body.appendChild(panel);
  adoptSidebarShell(panel);
  return panel;
}

function buildRailItem(spec) {
  const item = document.createElement("div");
  item.className = "tool-rail-item";
  item.dataset.panelItem = spec.id;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-rail-btn tool-rail-panel-btn";
  button.id = `tool-rail-${spec.id}`;
  button.title = spec.title;
  button.setAttribute("aria-label", spec.title);
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${spec.icon}</svg>`
    + `<span>${spec.label}</span>`;
  button.addEventListener("click", () => {
    setOpen(spec.id, panels.get(spec.id)?.panel.hidden !== false);
  });

  item.appendChild(button);
  return { item, button };
}

export function init() {
  const rail = document.getElementById("tool-rail");
  if (!rail || panels.size) return false;
  const groups = PANELS.map((spec) => document.getElementById(spec.group));
  // Nothing to move means nothing to open. A body whose registry drops one of
  // these tabs simply does not get its button.
  if (!groups.some(Boolean)) return false;

  injectStyle();
  PANELS.forEach((spec, index) => {
    const group = groups[index];
    if (!group) return;
    const { item, button } = buildRailItem(spec);
    rail.appendChild(item);
    panels.set(spec.id, { panel: buildPanel(spec, group), button });
  });

  window.addEventListener("resize", place);
  // The rail moves without a resize -- arming the hub pushes it down, and the
  // Atlas mark above it settles a moment after load.
  setInterval(place, 500);
  place();
  return true;
}

if (typeof document !== "undefined") {
  // The groups arrive with the shell on a planet page and with the markup on
  // Earth's, and toolbox.js reorders the sidebar around them, so this retries
  // until they exist rather than assuming a moment.
  let tries = 0;
  const attempt = () => {
    if (init() || (tries += 1) > 60) return;
    setTimeout(attempt, 400);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attempt);
  } else {
    attempt();
  }
}
