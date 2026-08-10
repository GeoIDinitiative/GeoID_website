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

/**
 * One word each, because the rail is a column of icons with a caption under
 * them: "Pre-proc" wrapped to two lines and made its button taller than the
 * measure tools beside it, so the rail read as two kinds of thing. The longer
 * name survives as the tooltip, where there is room for it.
 */
const PANELS = [
  {
    id: "preprocess",
    group: "gis-group-preprocess",
    label: "Process",
    title: "Process",
    hint: "Pre-processing toolbox",
    // A funnel: raw in, tidy out.
    icon: '<path d="M3.5 4.5h17l-6.5 7.6v6.4l-4 2.4v-8.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  },
  {
    id: "analysis",
    group: "gis-group-analysis",
    label: "Analysis",
    title: "Analysis",
    hint: "Extraction and analysis",
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
/* ── The active state, once, for the whole GUI ───────────────────────────────
 *
 * Active is a SOLID fill of the accent with dark ink -- the Atlas hub Dock's
 * answer, already recorded in CLAUDE.md as the one this project follows. A
 * tinted wash reads as hover; at a glance you could not tell an armed tool from
 * one the pointer happened to be over.
 *
 * It lives here because this stylesheet is injected from a module and therefore
 * reaches Earth and the nine planet pages from one place. The rail's own rules
 * are duplicated across ten stylesheets, and every attempt to change something
 * in one of them has so far reached exactly one page.
 */
.tool-rail-btn.is-active,
.tool-rail-panel-btn.is-open,
.view-mode-btn.is-active {
  background: rgb(var(--nav-accent-rgb)) !important;
  border-color: rgb(var(--nav-accent-rgb)) !important;
  color: var(--skin-chrome-ink, #2b0030) !important;
  box-shadow: 0 0 18px -4px rgba(var(--nav-accent-rgb), 0.7) !important;
}
/* The glyph and label ride the same ink, or the icon stays pale on the fill. */
.tool-rail-btn.is-active svg,
.tool-rail-panel-btn.is-open svg,
.tool-rail-btn.is-active span,
.tool-rail-panel-btn.is-open span {
  color: var(--skin-chrome-ink, #2b0030);
  stroke: currentColor;
}

/* While a workbench is open the whole rail shrinks to its icons -- the open one
   included. Its solid fill already says which it is, so keeping a label on it
   only made the column ragged. */
#tool-rail.has-open-panel .tool-rail-btn {
  width: 2.3rem;
  min-height: 2.3rem;
  padding: 0.3rem 0.18rem;
  transition: width 0.15s ease, min-height 0.15s ease;
}
#tool-rail.has-open-panel .tool-rail-btn span { display: none; }
#tool-rail.has-open-panel .tool-rail-btn svg { width: 1rem; height: 1rem; }

/* The close mark, matching the Atlas panel's .atlas-close: no border, no
   fill, quiet until hovered. It is a dismissal, not an action. */
.gis-side-panel-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 2px 4px;
  color: inherit;
  opacity: 0.6;
}
.gis-side-panel-close:hover { opacity: 1; }

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
/* Titled as the sidebar titles its groups -- .section-title, copied value for
   value: white ink in Exo 2, not the accent. The accent is for state (armed,
   open, selected); using it for a heading as well left nothing to tell the two
   apart. */
.gis-side-panel-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--text);
  font-size: 0.76rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: "Exo 2", "Segoe UI", sans-serif;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* And the sections inside it read as the sidebar's headings do.
 *
 * A .gis-tool-section summary is pink Courier everywhere else, which is right
 * when it is one row among many inside a group. In a workbench those rows ARE
 * the panel, so they take the group heading's voice instead -- the same white
 * Exo 2 the nav bar uses for Add / Import Data and Shapefiles.
 */
.gis-side-panel-body .gis-tool-section > summary {
  color: var(--text);
  font-family: "Exo 2", "Segoe UI", sans-serif;
  font-weight: 600;
  font-size: 0.76rem;
  letter-spacing: 0.1em;
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
  // Closes the workbench outright, where the chevron only folds it away. The
  // Atlas panel's own close (`.atlas-close`) is the house style for this, so it
  // is that mark and that weight: a bare glyph, quiet until hovered, rather
  // than another bordered button competing with the chevron beside it.
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "gis-side-panel-close";
  dismiss.textContent = "✕";
  dismiss.title = "Close";
  dismiss.setAttribute("aria-label", `Close ${spec.title}`);
  dismiss.addEventListener("click", () => setOpen(spec.id, false));

  actions.append(collapse, dismiss);
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
  button.title = spec.hint || spec.title;
  button.setAttribute("aria-label", spec.hint || spec.title);
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${spec.icon}</svg>`
    + `<span>${spec.label}</span>`;
  button.addEventListener("click", () => {
    setOpen(spec.id, panels.get(spec.id)?.panel.hidden !== false);
  });

  item.appendChild(button);
  return { item, button };
}

/** So another module can raise a workbench without knowing how it is built. */
window.GeoIDSidePanels = {
  open: (id) => setOpen(id, true),
  close: (id) => setOpen(id, false),
  isOpen: (id) => panels.get(id)?.panel.hidden === false,
};

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
