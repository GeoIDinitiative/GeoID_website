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

const STYLE = `
/* The rail item, matching .tool-rail-item exactly -- these sit in the same
   column as Distance/Draw/Profile and must not read as a different kind of
   control. Only the active state differs: a measure tool is "armed", a
   workbench is "open". */
.tool-rail-panel-btn.is-open {
  border-color: rgba(var(--nav-accent-rgb), 0.9);
  background: rgba(var(--nav-accent-rgb), 0.18);
}

/* The panel: the sidebar's shell, on the other side of the screen. */
.gis-side-panel {
  position: fixed;
  z-index: 12;
  display: flex;
  flex-direction: column;
  width: min(23rem, calc(100vw - 2rem));
  border: 1px solid rgba(82, 228, 232, 0.38);
  border-radius: 0.85rem;
  background:
    radial-gradient(ellipse at top, rgba(57, 127, 214, 0.2), transparent 45%),
    linear-gradient(165deg, rgba(9, 20, 30, 0.97) 0%, rgba(5, 12, 19, 0.96) 100%);
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5), 0 0 22px -8px rgba(82, 228, 232, 0.35);
  overflow: hidden;
  font-family: "Exo 2", "Trebuchet MS", "Segoe UI", sans-serif;
}
.gis-side-panel[hidden] { display: none; }

.gis-side-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem 0.5rem 0.8rem;
  border-bottom: 1px solid rgba(82, 228, 232, 0.22);
  font-size: 0.66rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--nav-accent-rgb, 120 200 255));
}
.gis-side-panel-close {
  background: none;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.35);
  border-radius: 0.4rem;
  color: inherit;
  font: inherit;
  line-height: 1;
  padding: 0.2rem 0.45rem;
  cursor: pointer;
}
.gis-side-panel-close:hover {
  border-color: rgb(var(--nav-accent-rgb));
  background: rgba(var(--nav-accent-rgb), 0.16);
}

/* Scrolls like #ui-scroll-body does, so a long toolbox behaves the same here. */
.gis-side-panel-body {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0.55rem;
  min-height: 0;
}

/* The group arrives as a collapsible that was one of nine. On its own it is the
   whole panel, so its shell is dropped: the panel's header already names it,
   and a second title inside said everything twice. */
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
  panels.forEach((entry, key) => {
    const on = key === id ? open : false;
    entry.panel.hidden = !on;
    entry.button.classList.toggle("is-open", on);
    entry.button.setAttribute("aria-expanded", on ? "true" : "false");
  });
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
  const right = Math.max(8, Math.round(window.innerWidth - box.right));
  const top = Math.round(Math.min(box.bottom + 10, window.innerHeight * 0.5));
  panels.forEach(({ panel }) => {
    if (panel.hidden) return;
    panel.style.right = `${right}px`;
    panel.style.top = `${top}px`;
    // Clear of the scale bar and its readout at the foot of this column.
    panel.style.maxHeight = `${Math.max(180, window.innerHeight - top - 96)}px`;
  });
}

function buildPanel(spec, group) {
  const panel = document.createElement("section");
  panel.className = "gis-side-panel";
  panel.id = `gis-side-panel-${spec.id}`;
  panel.hidden = true;
  panel.setAttribute("aria-label", spec.title);

  const head = document.createElement("header");
  head.className = "gis-side-panel-head";
  const title = document.createElement("span");
  title.textContent = spec.title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gis-side-panel-close";
  close.textContent = "✕";
  close.title = "Close";
  close.setAttribute("aria-label", `Close ${spec.title}`);
  close.addEventListener("click", () => setOpen(spec.id, false));
  head.append(title, close);

  const body = document.createElement("div");
  body.className = "gis-side-panel-body";
  // Moved, not copied: the sections inside are the ones the rest of the app
  // already holds references to.
  group.open = true;
  body.appendChild(group);

  panel.append(head, body);
  document.body.appendChild(panel);
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
