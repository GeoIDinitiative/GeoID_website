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
/**
 * The two shelf names, and the ONE place they are written.
 *
 * `tool-shelves.js` sorts the blocks onto these shelves and renames the
 * sections; this module names the rail button and the workbench header. They
 * are the same two shelves, so they read the same two strings — a constant
 * rather than an import, because side-panels loads before the shelf module on
 * some worlds and a name is not worth a load-order dependency.
 */
const SHELF_NAMES = { geoprocess: "Geoprocessing", analysis: "Analysis" };

const PANELS = [
  {
    id: "preprocess",
    group: "gis-group-preprocess",
    /**
     * The shelf's name lives in `tool-shelves.js` and is read from there.
     *
     * It used to be written out again here — "Process", tooltip
     * "Pre-processing toolbox" — so renaming the panel renamed the SECTION and
     * left the rail button and the workbench header still saying
     * pre-processing. Reported as exactly that: "why is it still being read as
     * preprocessing". One name in two places is the fault this file has now
     * paid for at every level of this column.
     *
     * `label` stays short on purpose and is NOT the shelf name: the rail is a
     * column of icons with a caption under each, and "Pre-proc" once wrapped
     * to two lines and made its button taller than the measure tools beside
     * it. The full name is the header and the tooltip, where there is room.
     */
    label: "GIS tools",
    title: SHELF_NAMES.geoprocess,
    hint: `${SHELF_NAMES.geoprocess} — tools that make a map layer`,
    // A funnel: raw in, tidy out.
    icon: '<path d="M3.5 4.5h17l-6.5 7.6v6.4l-4 2.4v-8.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  },
  {
    id: "analysis",
    group: "gis-group-analysis",
    label: "Analysis",
    title: SHELF_NAMES.analysis,
    hint: `${SHELF_NAMES.analysis} — tables, statistics and plots`,
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
 * There was a second class here, has-draw-card, for the Draw tool's preset
 * card asking the same favour. That card is gone — its shapes drag out on the
 * Draw bar now — so nothing sets it and its selectors went with it. */
#tool-rail.has-open-panel .tool-rail-btn {
  width: 2.3rem;
  min-height: 2.3rem;
  padding: 0.3rem 0.18rem;
  transition: width 0.15s ease, min-height 0.15s ease;
}
#tool-rail.has-open-panel .tool-rail-btn span { display: none; }
#tool-rail.has-open-panel .tool-rail-btn svg { width: 1rem; height: 1rem; }

/* The measure tools' Export CSV sits under its button and is not one, so it
   keeps its full width while everything above it halves -- which is the one
   thing that still made the shrunk rail ragged. It is not hidden: exporting the
   measurement is the point of having made one. */
#tool-rail.has-open-panel .measure-rail-actions { width: 2.3rem; }
#tool-rail.has-open-panel .tool-rail-action-btn {
  width: 100%;
  padding: 0.24rem 0.1rem;
  font-size: 0.45rem;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

/* ── Every SUB-tab speaks the Live Events groups' language ──────────────────
 *
 * The feed groups' look was liked: a LEFT chevron that turns down on open,
 * the card voice, an icon beside the name. So level-2 control-sections and
 * every gis-tool-section wear the same — the chevron on the left where the
 * feed groups carry theirs, the +/- gone from level-2 (level-1 tabs keep
 * theirs; a different tier speaks a different mark), and the level-2 heading
 * type matched to the tool-summary voice so the two kinds of sub-tab stop
 * reading as different apps. !important where the page stylesheets or the
 * skin set the same properties. Double backslash on the chevron entity —
 * a single one is an OCTAL escape inside this template literal. */
/* ── Level 1 folds the same way ─────────────────────────────────────────
 *
 * The tabs kept a +/- on the right while every sub-tab had moved to a left
 * chevron, so the column spoke two fold languages at once. One mark now,
 * at the same edge, turning the same way — the tier is already said by the
 * tab's own fill, size and icon, which is enough. */
.control-section.toolbox-group > .section-toggle::after { content: none !important; }
.control-section.toolbox-group > .section-toggle::before {
  content: "\\203A";
  flex: 0 0 auto;
  width: 0.7rem;
  text-align: center;
  font-size: 1.15rem;
  line-height: 1;
  color: rgba(var(--nav-accent-rgb), 0.9);
  transform: rotate(0deg);
  transition: transform 0.15s ease;
}
.control-section.toolbox-group[open] > .section-toggle::before {
  transform: rotate(90deg);
}
/* ONE GAP BETWEEN SUB-TABS, wherever they sit.
 *
 * A tab's body is a grid at 7.2 px, but Explorer's later sub-tabs live inside
 * a .controls wrapper with a 10.4 px gap of its own and a 12 px top margin,
 * and the first section carries a 10.4 px bottom margin nothing else has. So
 * the column measured 17.5, 19.2, then 10.4 nine times over — three different
 * spacings in one list, which is what "even spacing" was asking for.
 *
 * The wrapper's 10.4 wins because it is what most of the column already uses:
 * matching the body to it moves two gaps rather than nine. The margins are
 * zeroed rather than subtracted from, or the next section to be added would
 * inherit whichever of them it happened to sit next to.
 *
 * !important because the rules being overruled are an ID selector and another
 * !important: #geoid-controls-host sets the body gap, #flightsim-section its
 * own bottom margin, and a .section-body > .control-stack rule in styles.css
 * pins 0.6rem !important. Against another !important the winner is decided by
 * SPECIFICITY, which is why the ancestor here is spelled .control-section
 * .toolbox-group rather than just .toolbox-group.
 *
 * The containers are named individually because they are all there is: CSS
 * cannot select "the parent of a run of sections", so every wrapper the
 * column actually uses -- .controls, .control-stack, .event-sources, and the
 * body itself -- has to be listed. A new wrapper will need adding here, which
 * is the honest cost of the approach.
 *
 * #geoid-controls-host is in the list because Earth's own stylesheet pins
 * that one and its .controls child with an ID at !important, and no length of
 * class list outranks an id -- against an equal id the later sheet wins, and
 * this one is injected at runtime. Measured before: three values across the
 * app -- 8 px in the Live Events feed groups, 9.6 in Explorer, Geology and
 * Hazards, 10.4 on all nine planets. */
.control-section.toolbox-group > .section-body,
.control-section.toolbox-group .section-body .controls,
.control-section.toolbox-group .section-body .control-stack,
.control-section.toolbox-group .section-body .event-sources,
#geoid-controls-host,
#geoid-controls-host > .controls { row-gap: 0.65rem !important; }
.control-section.toolbox-group > .section-body > .controls { margin-top: 0 !important; }
.control-section.toolbox-group > .section-body > .control-section { margin-bottom: 0 !important; }

/* The chevron leads, then the icon, then the name — spaced like a sub-tab
   row so the two tiers read as one family. */
.control-section.toolbox-group > .section-toggle { gap: 0.55rem !important; }
.control-section.toolbox-group > .section-toggle .section-title-row { gap: 0.55rem !important; }
/* A BLOCK around an inline-flex row is the tier-1 half of a fault the level-2
   rule below already fixes: the row sits on the line box's BASELINE, and the
   strut's descender makes that box taller than the row (measured 23.5 px
   against 19.5), so the icon and the name rode 2 px above the chevron, which
   is a flex item of the toggle and therefore properly centred. Making the
   title a flex container collapses the box to its content and centres it. */
.control-section.toolbox-group > .section-toggle .section-title {
  display: flex;
  align-items: center;
}

.control-section:not(.toolbox-group) > .section-toggle::after { content: none !important; }
.control-section:not(.toolbox-group) > .section-toggle::before {
  content: "\\203A";
  flex: 0 0 auto;
  width: 0.6rem;
  text-align: center;
  font-size: 1rem;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 0.15s ease;
  opacity: 0.75;
}
.control-section:not(.toolbox-group)[open] > .section-toggle::before {
  transform: rotate(90deg);
}
/* The level-2 heading in the tool-summary voice. */
.control-section:not(.toolbox-group) > .section-toggle .section-title,
.control-section:not(.toolbox-group) > .section-toggle .section-heading {
  color: var(--text) !important;
  font-family: "Exo 2", "Segoe UI", sans-serif !important;
  font-weight: 600;
  font-size: 0.76rem !important;
  letter-spacing: 0.1em !important;
  text-shadow: none !important;
  filter: none;
}
.gis-tool-section:not(.event-feed-group) > summary { display: flex; align-items: center; gap: 0.55rem !important; }
.tool-section-icon { flex: none; display: inline-flex; width: 0.85rem; height: 0.85rem; }
.tool-section-icon svg { width: 0.85rem; height: 0.85rem; display: block; }
.gis-tool-section:not(.event-feed-group) > summary > * { min-width: 0; }
.gis-tool-section:not(.event-feed-group) > summary::before {
  content: "\\203A";
  flex: 0 0 auto;
  width: 0.6rem;
  text-align: center;
  transform: rotate(0deg);
  transition: transform 0.15s ease;
  opacity: 0.75;
}
.gis-tool-section:not(.event-feed-group)[open] > summary::before {
  transform: rotate(90deg);
}
/* The feed groups' own icons, in the same seat every other sub-tab gives
   theirs. */
/* The corner furniture clears an open workbench, the same way it clears the
   hazard readout. max() so whichever is wider wins and neither is lost. */
.map-legend {
  right: max(5.5rem, var(--workbench-w, 0px)) !important;
}
body[data-hub-armed="true"] .map-legend {
  right: max(var(--hazard-rail-w, 5.5rem), var(--workbench-w, 0px)) !important;
}

.event-feed-icon { flex: none; display: inline-flex; }
.event-feed-icon svg { width: 0.85rem; height: 0.85rem; display: block; }

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
.control-section.toolbox-group[open] > .section-toggle::before,
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

/* ── Level 2 IS the tool card, verbatim ─────────────────────────────────
 *
 * The Live Events feed groups are .gis-tool-section cards and were the look
 * that was liked; the level-2 control-sections (Tour Mode, Locations,
 * Atmosphere…) wore a taller toggle, a rounder frame and a deep-gradient
 * open state, and read as a different app one card away. So the tool
 * card's chrome is copied onto them value for value — border, radius,
 * ground, summary padding — and open is the same SOLID accent fill with
 * dark ink the tool sections say it with. !important where the skin pins
 * the same properties. */
/* ── One card colour, wherever the card sits ────────────────────────────
 *
 * The cards were translucent white (3%) over the panel — and the panel is a
 * VERTICAL GRADIENT, light at the top and dark at the foot. Measured: an
 * events card sits 275 px down the panel and renders about var(--skin-card-ground, rgb(24, 13, 47));
 * an Explorer card sits 698 px down, past the gradient's dark end, and
 * renders about rgb(17,9,32). Same rule, same computed style, visibly
 * different colour — which is why every property comparison said MATCHES
 * while the eye said otherwise. An OPAQUE fill (the events card's own
 * rendered colour) makes a sub-tab the same colour at the top of the
 * column and at the bottom. */
.gis-tool-section,
.control-section:not(.toolbox-group) {
  background: var(--skin-card-ground, rgb(24, 13, 47)) !important;
}
/* The BODY behind the cards is the same story: left transparent it shows
   the panel gradient at whatever depth the tab happens to sit — measured,
   the events body sits at -1% of the panel and Explorer's at 61%, so the
   two tabs had visibly different grounds. One opaque colour, a shade
   under the cards so they still read as raised. */
.toolbox-group > .section-body,
.section-body.toolbox-group-body,
/* The same ground for every panel that holds these cards: the Workspace
   tile's body and the rail workbenches (Process, Analysis, Export,
   Settings), which were left transparent and so rode the gradient too. */
.gis-side-panel-body,
.layer-dock-body {
  background: var(--skin-tab-ground, rgb(16, 7, 36)) !important;
}
.control-section:not(.toolbox-group) {
  border: 1px solid rgba(var(--nav-accent-rgb), 0.18) !important;
  /* No inset ring, no glow: the page sheets give a closed level-2 section a
     1px magenta inset ring and an outer bloom, which is what read as
     "interior outlines and purple glow" beside the events cards, whose
     shadow is none. Only the OPEN state earns a glow (below). */
  box-shadow: none !important;
  /* !important: the page sheets set a 0.6rem radius at higher specificity. */
  border-radius: 0.78rem !important;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}
/* Measured against a live feed group on the deployed site, property by
   property: the toggle stood 46 px to their 39, inherited 16 px type with
   no gap or letterspacing, drew a near-white border-bottom, and gave its
   icon 20 px to their 14. Styling the TITLE SPAN alone (the first attempt)
   never touched any of that — the toggle is the element that differs. */
.control-section:not(.toolbox-group) > .section-toggle {
  min-height: 0 !important;
  padding: 0.7rem 0.78rem !important;
  border-left: 0;
  background: none;
  gap: 0.55rem;
  font-size: 0.76rem !important;
  letter-spacing: 0.1em !important;
  font-family: "Exo 2", "Segoe UI", sans-serif !important;
  border-bottom: 1px solid rgba(var(--nav-accent-rgb), 0.08) !important;
}
/* Reported: the glyph sat too close to its words. One gap value for every
   sub-tab row, icon and text alike. */
.control-section:not(.toolbox-group) > .section-toggle .section-title-row {
  gap: 0.55rem !important;
  column-gap: 0.55rem !important;
  align-items: center;
}
.event-feed-group > summary { gap: 0.55rem !important; }
/* The WRAPPER, not just the glyph: .section-icon is a 20x20 flex box, so
   sizing the svg alone left a 20 px row stretching the header to 44 px
   against the feed groups' 39. NO BACKTICKS in here - this block is a
   template literal and one ends it, which is how this whole stylesheet
   silently stopped applying (module threw "icon is not defined"). */
.control-section:not(.toolbox-group) > .section-toggle .section-icon {
  width: 0.85rem;
  height: 0.85rem;
  min-height: 0;
  flex: none;
}
.control-section:not(.toolbox-group) > .section-toggle .section-icon svg {
  width: 0.85rem;
  height: 0.85rem;
}
/* Same padding (11.2 px both) but a 21 px content box against the feed
   groups' 16: the nested toggle-main / heading / title wrappers each add a
   line box of their own. Flattened to one line so the card stands 39 px
   like its template. */
.control-section:not(.toolbox-group) > .section-toggle .section-toggle-main,
.control-section:not(.toolbox-group) > .section-toggle .section-heading,
.control-section:not(.toolbox-group) > .section-toggle .section-title {
  /* NOTE: the gap: 0 below is for the toggle-main GRID only — see the
     title-row rule further down, which puts the icon-to-text gap back.
     Listing .section-title-row here as well is what zeroed that gap and
     jammed every glyph against its words. */
  /* 1rem flat, so the content box is the feed groups' 16 px and the card
     stands at their 39 px rather than 42: line-height normal on nested
     wrappers rounds up a little at each level. */
  line-height: 1rem;
  min-height: 0;
  align-items: center;
  /* section-toggle-main is a GRID whose row gap added 2.8 px on top of the
     text: 18.8 px against the feed groups' 16, which is the whole
     remaining height difference. */
  gap: 0;
  row-gap: 0;
}
/* The last 2.8 px: .section-title is a BLOCK wrapping an inline-flex row,
   so it takes an inline line box taller than the 16 px row inside it.
   Made a flex container, the wrapper is exactly its content. */
.control-section:not(.toolbox-group) > .section-toggle .section-title {
  display: flex;
  align-items: center;
}
/* A head that carries a control (Tour Mode's ENTER, the master ticks) sizes
   it to the row rather than letting it set the row: everything else in the
   column stands at the feed groups' height. */
.control-section:not(.toolbox-group) > .section-toggle .section-toggle-controls button {
  min-height: 0;
  padding: 0.16rem 0.5rem;
  font-size: 0.58rem;
  line-height: 1.1;
}
.control-section:not(.toolbox-group) > .section-toggle .section-sub { display: none; }
.control-section:not(.toolbox-group)[open] > .section-toggle {
  background: rgb(var(--nav-accent-rgb));
  border-bottom-color: rgba(0, 0, 0, 0.22) !important;
}
.control-section:not(.toolbox-group)[open] > .section-toggle .section-title,
.control-section:not(.toolbox-group)[open] > .section-toggle .section-heading,
.control-section:not(.toolbox-group)[open] > .section-toggle .section-icon,
.control-section:not(.toolbox-group)[open] > .section-toggle::before {
  color: var(--skin-chrome-ink, #2b0030) !important;
  text-shadow: none !important;
  filter: none;
}
.control-section:not(.toolbox-group)[open] > .section-toggle .section-toggle-controls button {
  color: var(--skin-chrome-ink, #2b0030) !important;
  background: rgba(255, 255, 255, 0.24) !important;
  border-color: rgba(0, 0, 0, 0.42) !important;
  box-shadow: none !important;
  text-shadow: none !important;
}
.control-section:not(.toolbox-group)[open] > .section-toggle .section-toggle-controls input {
  accent-color: var(--skin-chrome-ink, #2b0030);
}
.control-section:not(.toolbox-group)[open] {
  border-color: rgb(var(--nav-accent-rgb)) !important;
  box-shadow: 0 0 18px -6px rgba(var(--nav-accent-rgb), 0.55) !important;
}
.control-section:not(.toolbox-group)[open]:hover > .section-toggle {
  background: rgb(var(--nav-accent-rgb));
  filter: brightness(1.1);
}
/* The WRAPPER around Explorer's sub-tabs paints a magenta ring and a bloom
   of its own — reported as "a larger box enclosing Search, Locations and
   Core View". The events chain has no such wrapper, so it draws nothing. */
#geoid-controls-host > .controls,
.section-body > .controls {
  box-shadow: none !important;
  border: 0 !important;
  background: none !important;
}
/* An open card's BODY: the events cards leave it transparent over the
   panel; the page sheets fill a level-2 body solid black and hairline it
   in accent, which read as a different background entirely. */
.control-section:not(.toolbox-group)[open] > .section-body {
  background: none !important;
  border-top-color: rgba(var(--nav-accent-rgb), 0.08) !important;
  padding: 0.72rem 0.78rem 0.8rem !important;
}
/* The open header's INK. The events card writes dark ink on its accent
   fill; the page sheets kept near-white here, which is why the two solid
   pills did not read as the same colour. */
.control-section:not(.toolbox-group)[open] > .section-toggle {
  color: var(--skin-chrome-ink, #2b0030) !important;
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

/**
 * A glyph for every tool subsection, keyed by its own title.
 *
 * The level-2 sections carry icons in the markup and the Live Events groups
 * gained theirs; the ~35 gis-tool-section subsections had none, so a column
 * mixing the two read as two systems. Keyed by lower-case title rather than
 * by id: these summaries are plain text across ten markup files and a
 * shared template, and the title is the one thing they all have. Anything
 * unmatched takes a neutral bracket mark, so a NEW subsection still reads
 * as one of the family rather than as a gap.
 */
const TOOL_ICONS = {
  "geology": "<path d=\"M2.6 12.4 6 4.2l4 3.2 3.4-2v7Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
  "tectonics": "<path d=\"M1.8 6.2h5l1.6 3 1.8-4.4 1.4 2.2h2.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "volcanoes": "<path d=\"M5.6 6.6 2.4 13.4h11.2L10.4 6.6Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M8 5.6V3.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linecap=\"round\"/>",
  "imagery over time": "<rect x=\"2.4\" y=\"4\" width=\"11.2\" height=\"8\" rx=\"0.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><path d=\"M5.2 4v8M10.8 4v8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/>",
  "water bodies": "<path d=\"M8 2.4c2.4 3 3.8 5 3.8 6.8a3.8 3.8 0 0 1-7.6 0c0-1.8 1.4-3.8 3.8-6.8Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
  "ni prototype": "<path d=\"M3 12.6V7.4l3-2.2 3 2.2v5.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M9.6 12.6V9l3.4-1.6v5.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
  "inspect and pin": "<path d=\"M8 14s3.6-4 3.6-6.4A3.6 3.6 0 0 0 8 4a3.6 3.6 0 0 0-3.6 3.6C4.4 10 8 14 8 14Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><circle cx=\"8\" cy=\"7.4\" r=\"1.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\"/>",
  "study area": "<rect x=\"2.6\" y=\"3.6\" width=\"10.8\" height=\"8.8\" rx=\"0.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-dasharray=\"2.4 1.6\"/>",
  "route planner": "<path d=\"M3.4 12.6c3.4 0 1.6-4.8 5-4.8s1.6-4.4 4.2-4.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><circle cx=\"3.4\" cy=\"12.6\" r=\"1.3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/><circle cx=\"12.6\" cy=\"3.4\" r=\"1.3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/>",
  "base sites": "<path d=\"M8 2.6v10.8M8 4.2l4.4 1.8L8 7.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
  "structures": "<path d=\"M2.6 13.4V6l5.4-3.4L13.4 6v7.4Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M6.4 13.4V9.2h3.2v4.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/>",
  "buffered zones": "<circle cx=\"8\" cy=\"8\" r=\"2.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><circle cx=\"8\" cy=\"8\" r=\"5.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\" stroke-dasharray=\"2.2 1.6\"/>",
  "query and filter": "<path d=\"M2.6 3.6h10.8L9.4 8.4v4.2l-2.8 1.2V8.4Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
  "compare": "<rect x=\"2.4\" y=\"3.4\" width=\"4.8\" height=\"9.2\" rx=\"0.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><rect x=\"8.8\" y=\"3.4\" width=\"4.8\" height=\"9.2\" rx=\"0.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-dasharray=\"2 1.4\"/>",
  "saved views and export": "<path d=\"M4 2.8h8v10.4l-4-2.4-4 2.4Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
  "live weather maps": "<path d=\"M4.6 9.4h7a2.6 2.6 0 0 0 .5-5.1A3.7 3.7 0 0 0 5 3.7a3 3 0 0 0-.4 5.7Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M5.6 11.4l-.9 2M8.4 11.4l-.9 2M11.2 11.4l-.9 2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linecap=\"round\"/>",
  "atmospheric datasets (earth engine)": "<path d=\"M2 5.1h7.2a1.8 1.8 0 1 0-1.8-1.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><path d=\"M2 8.3h10.4a1.9 1.9 0 1 1-1.9 1.9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><path d=\"M2 11.5h5.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/>",
  "service": "<rect x=\"2.4\" y=\"3.2\" width=\"11.2\" height=\"3.6\" rx=\"0.7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/><rect x=\"2.4\" y=\"9.2\" width=\"11.2\" height=\"3.6\" rx=\"0.7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/><circle cx=\"4.8\" cy=\"5\" r=\"0.7\" fill=\"currentColor\"/><circle cx=\"4.8\" cy=\"11\" r=\"0.7\" fill=\"currentColor\"/>",
  "georeference an image": "<rect x=\"2.6\" y=\"3.6\" width=\"10.8\" height=\"8.8\" rx=\"0.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><path d=\"M2.6 8h10.8M8 3.6v8.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\" opacity=\"0.7\"/>",
  "surface analysis": "<path d=\"M2.4 11.6 6 6.8l2.8 2.6 4.8-6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "zonal statistics": "<path d=\"M3 13V8.4M6.6 13V4.6M10.2 13V7M13.8 13v-3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/>",
  "sample raster at point": "<rect x=\"2.6\" y=\"2.6\" width=\"10.8\" height=\"10.8\" rx=\"0.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/><circle cx=\"9.8\" cy=\"6.2\" r=\"1.4\" fill=\"currentColor\"/>",
  "geoprocessing": "<circle cx=\"8\" cy=\"8\" r=\"2.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><path d=\"M8 2.6v1.8M8 11.6v1.8M13.4 8h-1.8M4.4 8H2.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\" stroke-linecap=\"round\"/>",
  "explore & edit": "<path d=\"M3.2 12.8 4 9.6l6-6 2.4 2.4-6 6Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
  "attribute query": "<circle cx=\"7\" cy=\"7\" r=\"4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><path d=\"m10.2 10.2 3 3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/>",
  "query syntax": "<path d=\"M6 4.4 2.8 8 6 11.6M10 4.4 13.2 8 10 11.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "attribute table": "<rect x=\"2.4\" y=\"3.4\" width=\"11.2\" height=\"9.2\" rx=\"0.7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/><path d=\"M2.4 6.4h11.2M6.4 6.4v6.2M9.8 6.4v6.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\"/>",
  "symbology": "<circle cx=\"6.2\" cy=\"6.4\" r=\"3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><circle cx=\"9.9\" cy=\"9.6\" r=\"3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" opacity=\"0.7\"/>",
  "analysis tools": "<path d=\"M4.4 13.2h7.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><path d=\"M6.4 13.2V8.6M9.6 13.2V5.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/>",
  "point & pixel extraction": "<circle cx=\"8\" cy=\"8\" r=\"1.6\" fill=\"currentColor\"/><path d=\"M8 2.4v2.6M8 11v2.6M13.6 8H11M5 8H2.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\"/>",
  "signal analysis": "<path d=\"M1.8 8h2.2l1.6-4 2.4 8 2-6 1.4 2h2.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "batch runner": "<path d=\"M4 3.4 11.6 8 4 12.6Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
  "model builder": "<path d=\"M8 2.4 13.4 5.4v5.2L8 13.6 2.6 10.6V5.4Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M2.6 5.4 8 8.4l5.4-3M8 8.4v5.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\"/>",
  "export layers": "<path d=\"M8 10.4V2.8M5.2 5.6 8 2.8l2.8 2.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M3.2 13h9.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\"/>",
  "map view": "<path d=\"M2.6 4.2 6 2.8v9L2.6 13.2Zm3.4-1.4 4 1.4v9l-4-1.4Zm4 1.4 3.4-1.4v9L10 13.2Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/>",
  "layer provenance": "<path d=\"M8 2.6 13.4 5.6 8 8.6 2.6 5.6Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"m2.6 8.4 5.4 3 5.4-3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/>",
  "coordinate transformer": "<circle cx=\"8\" cy=\"8\" r=\"5.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><path d=\"M2.6 8h10.8M8 2.6c1.8 1.8 1.8 8.8 0 10.8-1.8-2-1.8-9 0-10.8Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\"/>",
  "flood": "<path d=\"M2 6.6h5.4l1.4-2.4 1.6 4.2 1.2-1.8H14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M1.8 10.2c1.2 0 1.2 1 2.4 1s1.2-1 2.4-1 1.2 1 2.4 1 1.2-1 2.4-1 1.2 1 2.4 1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linecap=\"round\"/><path d=\"M1.8 12.8c1.2 0 1.2 1 2.4 1s1.2-1 2.4-1 1.2 1 2.4 1 1.2-1 2.4-1 1.2 1 2.4 1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linecap=\"round\" opacity=\"0.7\"/>",
  "drought": "<circle cx=\"8\" cy=\"5.6\" r=\"2.6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><path d=\"M8 1.4v1M8 9.8v1M12.2 5.6h1M2.8 5.6h1M11 2.6l-.7.7M5.7 7.9l-.7.7M11 8.6l-.7-.7M5.7 3.3l-.7-.7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\" stroke-linecap=\"round\"/><path d=\"M2.2 12.4h3.2M7 12.4h2.4M11 12.4h2.8M3.4 14.2h3M8.6 14.2h4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linecap=\"round\" opacity=\"0.85\"/>",
  "landslides": "<path d=\"M1.8 12.6 7.4 4.2l3.2 4.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M1.8 13.6h12.4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\" stroke-linecap=\"round\"/><circle cx=\"11\" cy=\"10.6\" r=\"1\" fill=\"currentColor\"/><circle cx=\"13.4\" cy=\"12\" r=\"0.8\" fill=\"currentColor\"/><circle cx=\"9.2\" cy=\"12.2\" r=\"0.7\" fill=\"currentColor\"/>",
  "wildfires": "<path d=\"M8 2.6c0.6 2-2.8 3.4-2.8 6.4a2.8 2.8 0 0 0 5.6 0c0-1.1-0.5-1.9-1-2.7-0.4 0.7-0.7 1-1.3 1.2 0.5-1.6-0.1-3.4-0.5-4.9Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/>",
};

/**
 * Titles that take NO glyph. "NI prototype" is a named worked example
 * rather than a subject, and a mark invented for it says nothing — the
 * fallback bracket would be furniture.
 */
const NO_TOOL_ICON = new Set(["ni prototype"]);

const FALLBACK_TOOL_ICON = "<path d=\"M5.6 3.2H3.4v9.6h2.2M10.4 3.2h2.2v9.6h-2.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\"/>";

/**
 * Paint them, and keep painting as the panels rebuild (catalogues redraw,
 * workbenches move their groups, the hub arms). A marked summary is
 * skipped, so each pass is cheap.
 */
function paintToolIcons() {
  document.querySelectorAll(".gis-tool-section > summary").forEach((summary) => {
    if (summary.dataset.toolIcon || summary.closest(".event-feed-group")) return;
    summary.dataset.toolIcon = "1";
    const key = (summary.textContent || "").trim().toLowerCase();
    if (NO_TOOL_ICON.has(key)) return;
    const glyph = TOOL_ICONS[key] || FALLBACK_TOOL_ICON;
    const span = document.createElement("span");
    span.className = "section-icon tool-section-icon";
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = "<svg viewBox=\"0 0 16 16\">" + glyph + "</svg>";
    summary.insertBefore(span, summary.firstChild);
  });
}

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
/** The width an open workbench occupies — the sidebar's, which it adopts. */
function panelWidth() {
  const any = [...panels.values()].find((entry) => !entry.panel.hidden);
  return any ? Math.round(any.panel.getBoundingClientRect().width) : 0;
}

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
  /**
   * An open workbench takes the right of the screen, where the legend and
   * the events drop-down live — and they sat UNDER it. The hazard readout
   * already solved this shape: publish how far the corner furniture must
   * step left as a length, and let the stylesheet consume it. Measured from
   * the viewport edge to the panel's left edge, so it is right whatever
   * inset the panel takes at this breakpoint.
   */
  let openLeft = 0;
  panels.forEach(({ panel }) => { if (!panel.hidden) openLeft = Math.max(openLeft, right); });
  document.documentElement.style.setProperty(
    "--workbench-w", openLeft ? `${openLeft + panelWidth() + 8}px` : "0px");
  // The events drop-down positions itself from the legend's measured box, so
  // it follows once the legend has moved — but only if it is told to look.
  window.GeoIDEvents?.reflow?.();
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

  paintToolIcons();
  // The panels rebuild constantly, so this rides the same slow poll place uses.
  window.setInterval(paintToolIcons, 700);
  document.addEventListener("geoid-gis:layers-changed", paintToolIcons);
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
