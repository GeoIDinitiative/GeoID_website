/**
 * The GIS panel styles, injected once from JavaScript.
 *
 * Earth reads `styles.css`; the nine planet pages read `gis/shell.css`. A rule
 * written to either is a rule for HALF the GUI — and that is exactly what
 * happened: every panel added recently was styled in shell.css alone, so on
 * the Earth page the tool catalogue, the symbology preview, the point table
 * and the batch list rendered as unstyled default buttons, light grey and
 * centre-aligned, with each tool's name and blurb run together.
 *
 * A module is the one place both halves share — the same reason
 * `planet-strip.js` injects its dock styling rather than writing it to either
 * stylesheet. Anything new that both sidebars show belongs HERE.
 */

const STYLE = `
/* ── "Open Control Centre": the edge tab that brings the panel back ────────
   It is the way back into everything, so it should be found at a glance --
   but it sits beside the globe all the time, so it must not tug at the eye.
   Frosted glass in the theme's panel colour, a hairline edge, and a thin
   accent rail along its outer side whose halo BREATHES: 3.6 s a cycle,
   opacity only, on pseudo-elements, so nothing moves and nothing repaints
   under the globe. Hover slides it out a touch and lights the rail fully.
   Every planet viewer has this tab and this module; the planets' own
   pulsing box-shadow animation is switched off in favour of this one. */
:root #nav-tab {
  overflow: visible;
  padding: 1.35rem 0.62rem 1.25rem;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-left: 0;
  border-radius: 0 calc(0.85rem * var(--skin-round, 1)) calc(0.85rem * var(--skin-round, 1)) 0;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.03), transparent 70%),
    rgba(var(--skin-panel, 22, 9, 51), 0.58);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  backdrop-filter: blur(14px) saturate(140%);
  box-shadow: 6px 0 22px rgba(0, 0, 0, 0.32);
  color: var(--skin-ink, #eef6ff);
  font-family: var(--skin-body, "Exo 2", "Segoe UI", sans-serif);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-shadow: 0 0 10px rgba(var(--nav-accent-rgb), 0.35);
  animation: none;
  translate: 0 0;
  transition: translate 220ms cubic-bezier(0.23, 1, 0.32, 1), color 150ms ease, background-color 150ms ease;
}
/* The rail: a 2px line of the accent down the tab's outer edge. */
:root #nav-tab::before {
  content: "";
  position: absolute;
  top: 0.7rem; bottom: 0.7rem; right: -1px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(180deg, transparent, rgb(var(--nav-accent-rgb)) 18%, rgb(var(--nav-accent-rgb)) 82%, transparent);
  box-shadow: 0 0 8px rgba(var(--nav-accent-rgb), 0.9);
  pointer-events: none;
}
/* The halo: the whole tab's outline glowing, fading in and out. */
:root #nav-tab::after {
  content: "";
  position: absolute;
  inset: -1px -1px -1px 0;
  border-radius: inherit;
  box-shadow: 0 0 0 1px rgba(var(--nav-accent-rgb), 0.55), 0 0 22px 2px rgba(var(--nav-accent-rgb), 0.38),
    inset 0 0 14px rgba(var(--nav-accent-rgb), 0.12);
  opacity: 0.25;
  pointer-events: none;
  animation: geoid-navtab-breathe 3.6s ease-in-out infinite alternate;
}
@keyframes geoid-navtab-breathe { to { opacity: 0.85; } }
@media (hover: hover) and (pointer: fine) {
  :root #nav-tab:hover {
    translate: 3px 0;
    color: #ffffff;
    background:
      linear-gradient(90deg, rgba(var(--nav-accent-rgb), 0.1), transparent 80%),
      rgba(var(--skin-panel, 22, 9, 51), 0.7);
    box-shadow: 6px 0 22px rgba(0, 0, 0, 0.32);
    border-color: rgba(255, 255, 255, 0.14);
  }
  :root #nav-tab:hover::after { animation: none; opacity: 1; }
}
:root #nav-tab:focus-visible { outline: 2px solid rgba(var(--nav-accent-rgb), 0.9); outline-offset: 2px; }
:root #nav-tab:active { translate: 1px 0; }
:root:not([data-skin]) #nav-tab, :root[data-skin="pixel"] #nav-tab, :root[data-skin="hud"] #nav-tab { border-radius: 0; }
:root[data-skin="beige"] #nav-tab { color: #ffffff; --nav-accent-rgb: 255, 255, 255; }
@media (prefers-reduced-motion: reduce) {
  :root #nav-tab::after { animation: none; opacity: 0.6; }
  :root #nav-tab, :root #nav-tab:hover { translate: 0 0; }
}
@media (prefers-reduced-transparency: reduce) {
  :root #nav-tab { background: rgb(var(--skin-panel, 22, 9, 51)); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
/* ── The clock and the LIVE pill: readouts ON the globe, not tiles ──────────
   They were two opaque boxes with accent outlines in the corner of the view
   (owner, 2026-10-23: "unbounded by the box, or a subtle outline"). Now there
   is no ground, only a hairline that is barely there until you point at it,
   and the digits glow the way an instrument's do. Every theme: this is the
   shape of the control, not a colour, so no theme restates it. */
:root #time-scrub-toggle, :root #time-rate-toggle {
  background: transparent !important;
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.07) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}
:root #time-scrub-toggle:hover, :root #time-rate-toggle:hover,
:root #time-scrub-toggle.is-active {
  transform: none;
  background: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.18) !important;
}
:root #time-rate-toggle.is-live, :root #time-rate-toggle.is-paused { border-color: rgba(255, 255, 255, 0.07) !important; }
#scrub-clock-canvas { filter: drop-shadow(0 0 5px rgba(var(--skin-data-rgb, 0, 229, 255), 0.5)); }
#time-scrub-toggle .scrub-date, #time-scrub-toggle .scrub-utc { text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); }
/* Settings rows: a label, a field, its actions, and what it is for. */
.gis-setting-row { margin-bottom: 0.6rem; }
.gis-setting-row > label { display: block; font-size: 0.7rem; margin-bottom: 0.15rem; }
.gis-setting-row .input { width: 100%; box-sizing: border-box; }
.gis-setting-hint { display: block; font-size: 0.62rem; opacity: 0.62; line-height: 1.3; }

/* Project contents, at the head of the provenance list. */
.gis-project-contents { border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 0.4rem;
  margin-bottom: 0.4rem; }
.gis-project-contents > b { color: var(--nav-accent, var(--skin-chrome)); }
.gis-project-contents .gis-tool-item { margin-top: 0.15rem; }

.layer-options-note { margin-top: 0.25rem; overflow-wrap: anywhere; }

/* Project panel: the map's view of the pipeline it feeds. */
.gis-project-name { font-weight: 600; font-size: 0.82rem; margin-bottom: 0.2rem;
  color: var(--nav-accent, var(--skin-chrome)); overflow-wrap: anywhere; }
.gis-project-recent { display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.4rem; }
#gis-project-body .button { margin: 0.3rem 0; }

/* Point extraction: a coordinate list and the table it produces. */
.row-stack { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.4rem; }
.row-stack > span { font-size: 0.66rem; opacity: 0.75; line-height: 1.3; }
#extract-points { width: 100%; min-width: 0; font-family: ui-monospace, monospace;
  font-size: 0.7rem; resize: vertical; }
.gis-point-table-host { max-height: 200px; overflow: auto; margin: 0.4rem 0; }
.gis-point-table { border-collapse: collapse; font-size: 0.66rem; width: max-content; min-width: 100%; }
.gis-point-table th { text-align: left; font-weight: 500; opacity: 0.65; padding: 0.12rem 0.35rem;
  position: sticky; top: 0; background: rgba(8, 4, 16, 0.94); white-space: nowrap; }
.gis-point-table td { padding: 0.12rem 0.35rem; white-space: nowrap;
  border-top: 1px solid rgba(255,255,255,0.07); }
/* Buttons in these rows hold words, not glyphs, so they wrap rather than
   pushing the row wider than the panel. */
.gis-btn-row { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.4rem; }
.gis-btn-row .button { flex: 1 1 auto; min-width: 0; white-space: normal; line-height: 1.2; }

/* ── GeoID mode: the datetime pill replaces the planet bar ─────────────────
   Both live at bottom centre, so one has to stand down for the other to be
   readable. Armed, the question is when — the globe's clock paces the
   sixteen-day loop the Forecast tab plots — and the way out to the other nine
   worlds is not what that mode is for. */
body[data-hub-armed="true"] #gis-planet-dock,
body[data-hub-armed="true"] .gis-planet-dock {
  display: none !important;
}
/* GIS mode hides the clock (it paces the guided tour there). Armed, it IS the
   instrument, so the hiding rule must not reach it. */
body[data-view-mode="gis"][data-hub-armed="true"] #gmt-clock {
  display: block !important;
  bottom: 0.6rem;
  font-size: 0.82rem;
  padding: 0.34rem 0.8rem;
  border-color: rgba(var(--nav-accent-rgb, 255, 60, 172), 0.5);
  box-shadow: 0 0 18px rgba(var(--nav-accent-rgb, 255, 60, 172), 0.18);
}
body.is-embedded[data-hub-armed="true"] #gmt-clock {
  bottom: 0.5rem !important;
  font-size: 0.62rem !important;
  padding: 0.24rem 0.6rem !important;
}

/* Symbology preview: the classes as they will paint. */
.gis-sym-bar { display: flex; height: 14px; border-radius: 0.2rem; overflow: hidden;
  margin: 0.35rem 0 0.3rem; border: 1px solid rgba(255,255,255,0.16); }
.gis-sym-bar > span { flex: 1 1 auto; }
.gis-sym-rows { display: flex; flex-direction: column; gap: 0.1rem; font-size: 0.64rem; }
.gis-sym-rows > div { display: flex; gap: 0.35rem; align-items: center; }
.gis-sym-swatch { width: 0.7rem; height: 0.7rem; border-radius: 0.15rem; flex: 0 0 auto; }
/* The brace above was MISSING, and CSS error recovery ate everything from
   here to its next stray close: the whole ramp gallery below parsed to
   nothing, so the chips fell back to the platform's white ButtonFace while
   the rules that should have painted them sat in the same tag, unread.
   Diagnosed by comparing sheet.cssRules (40) against the selectors in the
   tag's own text (51) and finding where the two diverge -- a stylesheet
   that half-parses looks exactly like a theme half-implemented. */

/* ── Workbench normalisation: one font, one control scale ──────────────────
   An audit of every visible element's computed font and colour found the
   leaks a theme pass by eye cannot: five .input fields at the page's 16 px
   beside eight themed ones (they sit OUTSIDE any .row, which the form voice
   below keys on), .button at 16 px against the tools window's 0.72rem, the
   ramp chips' BUTTON element in the UA's Arial-on-ButtonFace while its
   children were styled, four bare inputs likewise, two textareas whose
   monospace stacks disagreed, and the panel close glyph in Arial. Controls
   inherit the app face by rule, not by luck. */
.gis-side-panel button,
.gis-side-panel input,
.gis-side-panel select,
.gis-side-panel textarea {
  font-family: inherit;
  color: inherit;
}
.gis-side-panel-body .button { font-size: 0.72rem; line-height: 1.25; }
.gis-side-panel-body input.input,
.gis-side-panel-body select.input,
.gis-side-panel-body select.mini-select {
  font-size: 0.74rem;
}
/* Every monospace surface on ONE stack: two textareas said ui-monospace and
   the rest fell to Courier New, which renders wider and lighter. */
.gis-side-panel-body textarea.input,
.gis-side-panel-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  /* 0.7rem to agree with #extract-points' own declaration above -- two
     monospace sizes one rule apart is the mismatch this block exists to end. */
  font-size: 0.7rem;
}
.gis-sym-ramp-option { font: inherit; color: inherit; }
.gis-side-panel-close { font-family: 'Exo 2', sans-serif; }

/* ── The workbench form voice, matching the tools window ───────────────────
   The generic .row is a two-column grid with 16 px sentence-case captions --
   the cookie-cutter look. Stacked rows, the instrument caption (Exo 2 600
   uppercase letterspaced, data cyan) above a full-width field on the
   workbench ground: one voice across every workbench panel and the tools
   window alike. Checkbox rows stay inline -- a lone tick under a full-width
   caption reads as a missing field.

   TWO row shapes exist and both are covered, because the first pass covered
   one and the Extract box promptly showed the other still in the old voice:
   the panels.js sections write label.row with a span caption, while the
   Extract box and several tool bodies write div.row holding a separate
   child label. And the rows are scoped to the WORKBENCH COLUMN
   (.gis-side-panel-body) as well as .gis-tool-body, because the Extract
   box's rows sit in neither a label nor a tool body. The nav bar's own
   sections in #ui are deliberately untouched. */
.gis-tool-body label.row,
.gis-tool-body div.row,
.gis-side-panel-body label.row,
.gis-side-panel-body div.row,
.gis-draw-box div.row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.18rem;
  margin: 0.45rem 0 0;
}
.gis-tool-body .row > span,
.gis-side-panel-body .row > span,
.gis-draw-box .row > span,
.gis-tool-body div.row > label,
.gis-side-panel-body div.row > label,
.gis-draw-box div.row > label {
  font: 600 0.6rem/1.35 'Exo 2', sans-serif;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--skin-data, var(--skin-data));
  opacity: 0.85;
}
.gis-tool-body .row > .input,
.gis-side-panel-body .row > .input,
.gis-draw-box .row > .input,
.gis-tool-body .row > select,
.gis-side-panel-body .row > select,
.gis-draw-box .row > select,
.gis-tool-body .row > input:not([type="checkbox"]),
.gis-side-panel-body .row > input:not([type="checkbox"]),
.gis-draw-box .row > input:not([type="checkbox"]) {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0.38rem 0.5rem;
  border-radius: 0.45rem;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.28);
  background: var(--skin-tab-ground, rgb(16, 7, 36));
  color: var(--text);
  font: 500 0.74rem/1.3 'Exo 2', sans-serif;
  color-scheme: dark;
}
.gis-tool-body .row:has(> input[type="checkbox"]),
.gis-side-panel-body .row:has(> input[type="checkbox"]),
.gis-draw-box .row:has(> input[type="checkbox"]) {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.gis-tool-body .row > input[type="checkbox"] { flex: 0 0 auto; }
.gis-side-panel-body option, .gis-tool-body option,
.gis-side-panel-body optgroup, .gis-tool-body optgroup { background-color: var(--skin-tab-ground, rgb(16, 7, 36)); }

/* ── Symbology: ramps you can see, classes you can edit ────────────────────
 *
 * NEVER a backtick in here -- this whole block is a template literal and one
 * ends it. module-css.test.mjs is what catches that; a browser does not.
 *
 * The gallery draws each ramp as the gradient it is, because a dropdown reading
 * "viridis, magma, blues" asks the reader to remember what each looks like. */
#gis-sym-ramp-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.2rem, 1fr));
  gap: 0.25rem;
  margin: 0.35rem 0;
}
.gis-sym-ramp-option {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.2rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 0.3rem;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
}
.gis-sym-ramp-option:hover { border-color: rgba(var(--nav-accent-rgb), 0.7); }
.gis-sym-ramp-option.is-active {
  border-color: rgb(var(--nav-accent-rgb));
  box-shadow: inset 0 0 0 1px rgb(var(--nav-accent-rgb));
}
.gis-sym-ramp-bar { display: block; height: 0.62rem; border-radius: 0.12rem; }
.gis-sym-ramp-name {
  font: 500 0.56rem/1 'Exo 2', sans-serif;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
}

/* An editable class row: swatch, threshold, upper bound, count. The swatch is a
   real colour input, so the ramp is a starting point rather than the answer. */
.gis-sym-rows.is-editable .gis-sym-row {
  display: grid;
  grid-template-columns: 1.3rem minmax(3.4rem, 1fr) auto auto;
  gap: 0.3rem;
  align-items: center;
}
.gis-sym-swatch-input {
  width: 1.25rem;
  height: 1.05rem;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 0.15rem;
  background: none;
  cursor: pointer;
}
.gis-sym-swatch-input::-webkit-color-swatch-wrapper { padding: 1px; }
.gis-sym-swatch-input::-webkit-color-swatch { border: none; border-radius: 0.1rem; }
input.gis-sym-edge {
  width: 100%;
  min-width: 0;
  padding: 0.05rem 0.2rem;
  font: 400 0.62rem/1.3 'Exo 2', sans-serif;
  color: var(--skin-data, var(--skin-data));
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 0.15rem;
}
span.gis-sym-edge.is-fixed { opacity: 0.6; font-size: 0.62rem; }
.gis-sym-to, .gis-sym-count { font-size: 0.62rem; opacity: 0.8; white-space: nowrap; }
.gis-sym-count { opacity: 0.55; }
.gis-sym-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gis-sym-reset { margin-top: 0.4rem; font-size: 0.6rem; }

/* The name sits on its own line under the numbers: at sidebar width a fifth
   column left four characters for it, which is not a name. */
.gis-sym-rows.is-editable .gis-sym-namerow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.3rem;
  align-items: center;
  margin: 0 0 0.3rem 1.6rem;
}
input.gis-sym-name {
  width: 100%;
  min-width: 0;
  padding: 0.08rem 0.25rem;
  font: 400 0.63rem/1.35 'Exo 2', sans-serif;
  color: var(--text, var(--skin-ink));
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.15rem;
}
input.gis-sym-name::placeholder { opacity: 0.4; font-style: italic; }
input.gis-sym-name:focus {
  outline: none;
  border-color: rgba(var(--nav-accent-rgb), 0.8);
}

/* A classed legend in the layer card: one row per class, its name beside its
   colour, rather than a gradient that cannot say where a class ends. */
.legend-classes { display: flex; flex-direction: column; gap: 0.12rem; margin-top: 0.3rem; }
.legend-class { display: flex; align-items: center; gap: 0.35rem; }
.legend-class-swatch {
  flex: 0 0 auto;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 0.12rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
}
/* The layer name is a rename affordance, so it says so on hover. The row sets
   cursor:grab for drag-to-reorder and that wins on a bare class, so the name
   states its own cursor with the row in the selector. NEVER a backtick here --
   this block is a template literal and one ends it. */
.layer-stack .layer-row .layer-name, .layer-name {
  cursor: text;
  border-radius: 0.15rem;
}
.layer-stack .layer-row .layer-name:hover, .layer-name:hover {
  background: rgba(var(--nav-accent-rgb), 0.14);
}
input.layer-name-input {
  width: 100%;
  min-width: 0;
  padding: 0 0.2rem;
  font: inherit;
  color: var(--text, var(--skin-ink));
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(var(--nav-accent-rgb), 0.8);
  border-radius: 0.15rem;
}
.legend-class-label {
  font-size: 0.62rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* An orphaned "border: ...; }" fragment sat here -- a property with no
   selector, left by some earlier edit. Harmless-looking, and it was the
   RECOVERY POINT that let the unclosed .gis-sym-swatch brace above swallow
   the ramp gallery in silence: the two faults cancelled into a sheet that
   parsed without error and simply lacked eleven rules. */

/* Batch: the layer list is a checklist, not a select — you pick several. */
.gis-batch-list { max-height: 120px; overflow-y: auto; margin: 0.4rem 0;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 0.25rem; padding: 0.25rem; }
.gis-batch-row { display: flex; gap: 0.35rem; align-items: center; font-size: 0.68rem;
  padding: 0.1rem 0.15rem; overflow-wrap: anywhere; }

.gis-geo-report { white-space: pre-wrap; font-size: 0.62rem; margin-top: 0.35rem;
  max-height: 110px; overflow-y: auto; }

/* Tool catalogue: a list of names, each with one line about it. Compact
   enough that a category reads at a glance, which a column of bordered
   buttons and full-width paragraphs never did. */
.gis-tool-catalogue-body { display: flex; flex-direction: column; gap: 0.15rem; }
.gis-tool-item {
  display: block; width: 100%; text-align: left; cursor: pointer;
  padding: 0.3rem 0.45rem; border-radius: 0.25rem;
  border: 1px solid transparent; background: rgba(255, 255, 255, 0.03);
  color: inherit; font: inherit;
}
.gis-tool-item:hover, .gis-tool-item:focus-visible {
  background: rgba(var(--nav-accent-rgb, 255, 60, 172), 0.14);
  border-color: rgba(var(--nav-accent-rgb, 255, 60, 172), 0.45);
}
.gis-tool-item b {
  display: block; font-size: 0.74rem; font-weight: 600; letter-spacing: 0.01em;
  line-height: 1.2; text-transform: none;
}
.gis-tool-item span {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  font-size: 0.62rem; opacity: 0.62; line-height: 1.25; margin-top: 0.08rem;
  overflow: hidden;
  /* WRAPPED to two lines, not "nowrap" with an ellipsis.
     An ellipsis needs a definite width to elide against; a nowrap line inside
     ancestors whose min-width computes to "auto" cannot shrink below its own
     text, so it pushed the whole nested section — summary bars and all — wider
     than the sidebar and the right-hand end was simply cut off. Wrapping text
     can shrink to any width, so nothing in this panel demands one. */
}

/* And the chain that let it push: a flex or grid item floors at its content
   width unless told otherwise. Every container between the panel and the text
   has to allow shrinking, or fixing the leaf alone just moves the problem. */
#gis-tool-catalogue,
#gis-tool-catalogue details,
#gis-tool-catalogue summary,
.gis-tool-catalogue-body,
.gis-tool-item {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
#gis-tool-catalogue { overflow-x: hidden; }
.gis-tool-item { overflow: hidden; }
.gis-tool-item b { overflow-wrap: anywhere; }

/* EVERY TICK SITS ON THE RIGHT. The catalogue rows, the section headers'
   master toggles and the .row checkbox-wraps already put theirs at the row's
   right edge; the feed rows, rock properties, satellite categories, export
   checks, extraction sources, studio checks and the demo rows put theirs on
   the left, so a column of ticks zig-zagged down the sidebar. Reordered here,
   in the one sheet both sidebars share, rather than in each builder's markup:
   "order" moves only the box, so ids, label-for and listeners are untouched.
   The margin is !important because studio-ui.css zeroes the studio checks'
   margin from an id selector. Each row class here is a flex row except .row,
   a two-column grid, where order puts the box in the second column and
   justify-self takes it to the edge. */
:is(.gis-catalogue-row, .event-source, .gis-extract-source, .studio-check,
    .compact-copy, .gee-tick, .gis-batch-row, .gis-checks > label, .row)
  > input[type="checkbox"] {
  order: 99;
  margin-left: auto !important;
  margin-right: 0;
  justify-self: end;
}
/* The Workspace rows' eye is the same switch, so it takes the same side: the
   grid templates in layer-hierarchy.js list it last for that reason. The
   studio's floating visibility box keeps its own five-column tree layout. */
.layer-stack .layer-row:not(.studio-vis-row):not(.studio-vis-part) > .layer-eye {
  order: 99;
  justify-self: end;
}

/* THE SUB-TABS' CONTROLS WEAR THE NAV BAR'S CHROME, NOT A CYAN BOX.
   viewer-skin.css paints every .button, .input, .mini-select, .tool-button
   and .info-btn with a cyan hairline AND cyan ink (both !important), so
   inside the sub-tabs every field, select and secondary button was a
   cyan-outlined, cyan-lettered box -- a stock look beside sections and
   sub-tab cards framed in the accent with light ink. The skin's own rule is
   magenta for chrome and cyan for DATA; a control's frame is chrome. Here
   they take the sub-tab card's values: an accent hairline, the panel ink, and
   the card's accent bloom on hover. Scoped with :where() to the sidebar, the
   side panels, the Workspace dock and the Earth Engine catalogue strip the
   Earth Observation sub-tab opens, so each selector stays at the skin's
   own specificity: loaded after it, this wins over the skin and still loses
   to every deliberate two-class override (primaries, the amber Custom button,
   locked tabs, active states). */
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .input,
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .mini-select,
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .button:where(.secondary),
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .tool-button,
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .info-btn {
  border-color: rgba(var(--nav-accent-rgb), 0.45) !important;
  color: var(--text, var(--skin-ink)) !important;
  text-shadow: none;
}
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .tool-button {
  background: var(--skin-tab-ground, rgb(16, 7, 36));
}
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .button:where(.secondary):hover,
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .tool-button:hover,
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .info-btn:hover {
  border-color: rgb(var(--nav-accent-rgb)) !important;
  color: #ffffff !important;
  background: rgba(var(--nav-accent-rgb), 0.14);
  box-shadow: 0 0 18px -6px rgba(var(--nav-accent-rgb), 0.55) !important;
}
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .input:focus,
:where(#ui, .gis-side-panel, #layer-dock, #gee-add-card) .mini-select:focus {
  border-color: rgb(var(--nav-accent-rgb)) !important;
}
/* The list rows: a Workspace layer and a vector overlay are cards in the
   sub-tab's own frame, not readings. */
:where(.layer-stack) .layer-row:where(:not(.studio-vis-row):not(.studio-vis-part)),
:where(.polygon-list) .polygon-row {
  border-color: rgba(var(--nav-accent-rgb), 0.22);
}
`;

if (typeof document !== "undefined" && !document.getElementById("gis-panel-styles")) {
  const node = document.createElement("style");
  node.id = "gis-panel-styles";
  node.textContent = STYLE;
  document.head.appendChild(node);
}
