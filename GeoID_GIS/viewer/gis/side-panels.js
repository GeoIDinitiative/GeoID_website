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
    // A bar chart on a baseline: values pulled out of layers. Not a zigzag --
    // the Profile tool one button up already wears that line.
    icon: '<path d="M4.4 19.6h15.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
      + '<path d="M7.4 19.6v-6.6M12 19.6V5.8M16.6 19.6v-9.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  },
  {
    // The old Export sidebar tab, repackaged twice: first a rail workbench,
    // now opened from the WORKSPACE box's own row (add-data.js builds the
    // button) — exporting is an act on the working set, so its door sits
    // beside + Data. `rail: false` keeps the workbench panel without a rail
    // button of its own.
    id: "export",
    rail: false,
    group: "gis-group-export",
    label: "Export",
    title: "Export",
    hint: "Export layers, maps and views",
    // The sidebar tab's own glyph at rail scale: up and out of a tray.
    icon: '<path d="M12 15.4V4.8M7.8 9 12 4.8 16.2 9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M4.8 19.2h14.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  },
  {
    // The old Settings sidebar tab (the gear), same move: configuration is
    // opened, changed and closed, and it was the tab pinned under nine
    // others that nobody scrolled to.
    id: "settings",
    // The gear lives in the Workspace tile's header on EVERY world
    // (add-data.js builds it there); no rail button anywhere.
    rail: false,
    group: "gis-group-settings",
    label: "Settings",
    title: "Settings",
    hint: "Settings",
    // The gear, matching the sidebar tab it replaces.
    icon: '<circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/>'
      + '<path d="M12 3v2.6M12 18.4V21M21 12h-2.6M5.6 12H3M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9M18.4 18.4l-1.9-1.9M7.5 7.5 5.6 5.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  },
  {
    // Not a panel: the palette is already the one door to all 46 tools, and it
    // was reachable only by knowing to press "/". A rail button under the
    // Atlas mark, built by the same function as Process and Analysis, is the
    // affordance that was missing — the feature existed, the way in did not.
    id: "search",
    label: "Search",
    title: "Search",
    hint: "Search every tool and function  (/)",
    icon: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/>'
      + '<path d="m15.2 15.2 4.3 4.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    action: () => window.GeoIDToolSearch?.open?.(""),
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
   only made the column ragged.
 *
 * NEVER a backtick in here -- this whole block is a template literal and one
 * ends it, which module-css.test.mjs catches and a browser does not.
 *
 * has-draw-card is the Draw tool (draw-panel.js) asking for the same thing. It
 * is a second class rather than a share of this one because setOpen below
 * recomputes has-open-panel from ITS panels alone -- one class between them and
 * each would switch the other off. */
#tool-rail.has-open-panel .tool-rail-btn,
#tool-rail.has-draw-card .tool-rail-btn {
  width: 2.3rem;
  min-height: 2.3rem;
  padding: 0.3rem 0.18rem;
  transition: width 0.15s ease, min-height 0.15s ease;
}
#tool-rail.has-open-panel .tool-rail-btn span,
#tool-rail.has-draw-card .tool-rail-btn span { display: none; }
#tool-rail.has-open-panel .tool-rail-btn svg,
#tool-rail.has-draw-card .tool-rail-btn svg { width: 1rem; height: 1rem; }

/* The measure tools' Export CSV sits under its button and is not one, so it
   keeps its full width while everything above it halves -- which is the one
   thing that still made the shrunk rail ragged. It is not hidden: exporting the
   measurement is the point of having made one. */
#tool-rail.has-open-panel .measure-rail-actions,
#tool-rail.has-draw-card .measure-rail-actions { width: 2.3rem; }
#tool-rail.has-open-panel .tool-rail-action-btn,
#tool-rail.has-draw-card .tool-rail-action-btn {
  width: 100%;
  padding: 0.24rem 0.1rem;
  font-size: 0.45rem;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

/* The header controls wear the Workspace header's icon-button treatment:
   small bordered squares pinned right, glyph inside — one language for
   every boxed header in the GUI. */
.gis-side-panel .brand-toprow-actions { display: flex; gap: 0.28rem; align-items: center; }
.gis-side-panel .brand-toprow-actions .info-btn,
.gis-side-panel-close {
  width: 1.55rem;
  height: 1.55rem;
  min-height: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.45);
  border-radius: 0.38rem;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 0.78rem;
  line-height: 1;
  opacity: 0.85;
}
.gis-side-panel .brand-toprow-actions .info-btn:hover,
.gis-side-panel-close:hover {
  opacity: 1;
  border-color: rgb(var(--nav-accent-rgb));
  color: rgb(var(--nav-accent-rgb));
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

/* Every .gis-tool-section head reads as a heading, wherever it is.
 *
 * This was scoped to the workbench panels on the argument that a tool section
 * is only one row among many inside a nav-bar group and could keep its pink
 * Courier there. Metadata shows why that does not hold: opened in the bar, its
 * Layer Provenance head sits alone under a heading in Exo 2 white and reads as
 * a different kind of thing than the sub-tab heads either side of it. One
 * voice for section heads across the GUI, which is the sidebar's own.
 */
.gis-tool-section > summary {
  color: var(--text);
  font-family: "Exo 2", "Segoe UI", sans-serif;
  font-weight: 600;
  font-size: 0.76rem;
  letter-spacing: 0.1em;
}

/* An open one is filled, everywhere in the GUI.
 *
 * A .gis-tool-section is the nested tab that opens a self-contained tile, and
 * open is a state -- the same state the rail buttons already say with a solid
 * accent. Saying it the same way here means one rule to read across the whole
 * interface: filled is open, and the fill runs along the head of the tile it
 * opened, so which header belongs to which body is never in question when
 * several are stacked.
 *
 * The head is a bar, not a button, so it keeps its square shoulders where they
 * meet the body and rounds only into the tile's own corners.
 */
.gis-tool-section[open] > summary {
  background: rgb(var(--nav-accent-rgb));
  color: var(--skin-chrome-ink, #2b0030);
  border-bottom-color: rgba(0, 0, 0, 0.22);
}
.gis-tool-section[open] > summary * { color: inherit; }
.gis-tool-section[open] {
  border-color: rgb(var(--nav-accent-rgb));
  box-shadow: 0 0 18px -6px rgba(var(--nav-accent-rgb), 0.55);
}

/* Two tiers of open in the main tab bar, and which one gets the loud accent.
 *
 * The main bar is the other half of the GUI and a different element from the
 * workbench tiles above: .control-section with a .section-toggle head, not a
 * .gis-tool-section with a summary. Open there used to mean a 12% wash and a
 * hairline spine, which beside a shut neighbour is very nearly nothing.
 *
 * Both tiers cannot take the same fill -- two bars in the same bright accent
 * and the eye stops being able to say which one contains the other -- so the
 * accent runs at two depths. The tab you picked in the bar is the full-strength
 * one; whatever is open inside it is the accent mixed down into the panel, a
 * deep magenta that still carries white heading ink. Loud parent, quiet child:
 * the pick stays the thing you see first, and the sub-tab reads as belonging to
 * it rather than competing with it.
 *
 * This lives in an injected stylesheet rather than in styles.css because Earth
 * loads styles.css and the nine planet pages do not -- a rule written there
 * would be an Earth-only rule.
 */

/* ── Level 1: the picked tab ──────────────────────────────────────────── */
.control-section.toolbox-group[open] > .section-toggle {
  background: rgb(var(--nav-accent-rgb));
  border-left: 3px solid rgb(var(--nav-accent-rgb));
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.22);
}
/* !important, which is not decoration here: viewer-skin.css:127 paints every
   heading "color: var(--skin-ink) !important" with a glow behind it. That is
   right for pale ink on a dark panel and wrong on a filled one -- it left the
   title white-on-pink and haloed. An !important at higher specificity is the
   only thing that reaches it, and the glow goes with it. */
.control-section.toolbox-group[open] > .section-toggle .section-title,
.control-section.toolbox-group[open] > .section-toggle .section-heading,
.control-section.toolbox-group[open] > .section-toggle .section-icon,
.control-section.toolbox-group[open] > .section-toggle .section-sub,
.control-section.toolbox-group[open] > .section-toggle::after {
  color: var(--skin-chrome-ink, #2b0030) !important;
  text-shadow: none !important;
  filter: none;
}
/* Some heads carry a control -- GeoID Mode and Events an Enter button, others a
   master checkbox -- drawn to sit on a dark panel: accent border, accent glow,
   pale ink. Every one of those is the fill's own colour once the head is
   filled, so the button read as pale text on pink with no edge at all. */
.control-section.toolbox-group[open] > .section-toggle .section-toggle-controls button {
  color: var(--skin-chrome-ink, #2b0030) !important;
  background: rgba(255, 255, 255, 0.24) !important;
  border-color: rgba(0, 0, 0, 0.42) !important;
  box-shadow: none !important;
  text-shadow: none !important;
}
.control-section.toolbox-group[open] > .section-toggle .section-toggle-controls input {
  accent-color: var(--skin-chrome-ink, #2b0030);
}
/* The frame, so an open group reads as one lit object down its whole height
   rather than a header that happens to differ. A hairline at 72% was doing
   that job at the very edge of visibility; 2px at full accent draws the
   selected tab as a box you can see the extent of at a glance. */
.control-section.toolbox-group[open] {
  border: 2px solid rgb(var(--nav-accent-rgb));
  /* The skin pins every .control-section border-color at 34% !important, which
     is why the frame came out 2px of the same faint pink the shut ones wear --
     the width landed and the colour did not. */
  border-color: rgb(var(--nav-accent-rgb)) !important;
  box-shadow:
    0 0 26px -10px rgba(var(--nav-accent-rgb), 0.85),
    inset 0 0 0 1px rgba(var(--nav-accent-rgb), 0.18);
}
/* Hover still has to register on one already open, so it brightens rather than
   repainting -- the fill is the state and must not blink off under the
   pointer. */
.control-section.toolbox-group[open]:hover > .section-toggle {
  background: rgb(var(--nav-accent-rgb));
  filter: brightness(1.1);
}

/* ── Level 2: what is open inside it ──────────────────────────────────── */
.control-section:not(.toolbox-group)[open] > .section-toggle {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, rgb(var(--nav-accent-rgb)) 46%, #17021b),
    color-mix(in srgb, rgb(var(--nav-accent-rgb)) 28%, #17021b)
  );
  border-left-color: rgba(var(--nav-accent-rgb), 0.9);
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.3);
}
/* On the deep bar the marker and icon were accent-on-accent. White reads, and
   the title keeps the pale ink the skin gives it -- the bar is dark enough. */
.control-section:not(.toolbox-group)[open] > .section-toggle .section-icon,
.control-section:not(.toolbox-group)[open] > .section-toggle::after {
  color: rgba(255, 255, 255, 0.92) !important;
  filter: none;
}
.control-section:not(.toolbox-group)[open]:hover > .section-toggle {
  filter: brightness(1.12);
}
/* The primary button: an accent fill with ink dark enough to sit on it.
 *
 * viewer-skin.css:134 sweeps .button in with .tool-button, .input, .hub-link
 * and the rest of the outlined controls and paints them all one cyan ink with
 * !important. For every other member that is right -- they are transparent over
 * a dark panel. .button is the one with an opaque light fill, so it came out
 * cyan text on a pale cyan slab: a contrast ratio of 1.18, which is close to
 * invisible, and it overrode the "color: #041116" styles.css had already given
 * it. Add shapefile, Go, Export, Compose map view, Copy citations and Request
 * basemap were all wearing it.
 *
 * .secondary is excluded on purpose: it shares the class but is transparent, so
 * it is one of the members the skin rule is right about.
 */
.button:not(.secondary) {
  background: rgb(var(--nav-accent-rgb)) !important;
  color: var(--skin-chrome-ink, #2b0030) !important;
  border-color: rgba(0, 0, 0, 0.32) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
/* The skin's hover turns every control's ink white, which on the accent fill
   undoes exactly what the rule above is for. */
.button:not(.secondary):hover {
  color: var(--skin-chrome-ink, #2b0030) !important;
  border-color: rgba(0, 0, 0, 0.45) !important;
  filter: brightness(1.08);
}

/* The tile that drops out of it is solid black rather than the translucent
   white the panel gives every other surface. Two reasons it earns the
   exception: it is the only place in the bar where you read and set values, and
   black is the one fill in this palette that no accent sits on top of, so the
   deep bar above it reads as the lid of a well instead of one more tinted
   layer. The seam keeps a trace of accent so the pair stays one object. */
.control-section:not(.toolbox-group)[open] > .section-body {
  background: #000;
  border-top-color: rgba(var(--nav-accent-rgb), 0.32);
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
    entry.button?.classList.toggle("is-open", on);
    entry.button?.setAttribute("aria-expanded", on ? "true" : "false");
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
    if (spec.action) { spec.action(); return; }
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
  // An action entry has no group to move, so it is never the reason the rail
  // decides there is nothing to build.
  const groups = PANELS.map((spec) => (spec.action ? true : document.getElementById(spec.group)));
  // Nothing to move means nothing to open. A body whose registry drops one of
  // these tabs simply does not get its button.
  if (!groups.some(Boolean)) return false;

  injectStyle();
  PANELS.forEach((spec, index) => {
    const group = groups[index];
    if (!group) return;
    let button = null;
    if (spec.rail !== false) {
      const built = buildRailItem(spec);
      rail.appendChild(built.item);
      button = built.button;
    }
    if (spec.action) return;                    // a button, not a workbench
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
