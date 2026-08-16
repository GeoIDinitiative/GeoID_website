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
/* Project contents, at the head of the provenance list. */
.gis-project-contents { border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 0.4rem;
  margin-bottom: 0.4rem; }
.gis-project-contents > b { color: var(--nav-accent, #ff3cac); }
.gis-project-contents .gis-tool-item { margin-top: 0.15rem; }

.layer-options-note { margin-top: 0.25rem; overflow-wrap: anywhere; }

/* Project panel: the map's view of the pipeline it feeds. */
.gis-project-name { font-weight: 600; font-size: 0.82rem; margin-bottom: 0.2rem;
  color: var(--nav-accent, #ff3cac); overflow-wrap: anywhere; }
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
.gis-sym-swatch { width: 0.7rem; height: 0.7rem; border-radius: 0.15rem; flex: 0 0 auto;
  border: 1px solid rgba(255,255,255,0.2); }

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
`;

if (typeof document !== "undefined" && !document.getElementById("gis-panel-styles")) {
  const node = document.createElement("style");
  node.id = "gis-panel-styles";
  node.textContent = STYLE;
  document.head.appendChild(node);
}
