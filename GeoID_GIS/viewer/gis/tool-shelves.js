/**
 * Two shelves, and what decides which one a tool sits on is its OUTPUT.
 *
 * `Analyse · Prepare` and `Analyse · Tools & Results` had grown by accretion:
 * raster ops beside zonal statistics, a field calculator beside a signal
 * spectrum, four export buttons beside an Export group that already existed.
 * Nothing said which of two panels a tool would be in, so the answer was
 * "open both".
 *
 * The rule is the one this tree already applies to the 47-tool registry:
 * **a tool that produces a MAP LAYER is geoprocessing; a tool that produces a
 * TABLE, A STATISTIC OR A CHART is analysis.** Extraction appears on both
 * shelves on purpose and they are different questions — clipping layers to a
 * polygon is geospatial and lands on the globe; sampling values at points is
 * data and lands in a table.
 *
 * The blocks are moved AFTER render rather than rearranged in `panels.js`,
 * because that MARKUP is one string rendering all ten worlds and every id in
 * it is addressed by some other module. Moving the node keeps every id, every
 * handler and every world intact — the same reason `toolbox.js` moves whole
 * sections rather than rebuilding them.
 *
 * Each block is found by a CONTROL IT CONTAINS rather than by an id of its
 * own, because these blocks have no ids; the move stamps one on so anything
 * later can address it.
 */

const GEOPROCESS = "gis-group-preprocess";
const ANALYSIS = "gis-group-analysis";

/**
 * `anchor` is a control inside the block; the block is its closest `details`.
 * `to` is the shelf it belongs on, by the output rule above.
 */
const BLOCKS = [
  // ── produces a map layer ────────────────────────────────────────────────
  { anchor: "gis-geo-place", id: "gp-georeference", to: GEOPROCESS },
  { anchor: "ras-op-run", id: "gp-raster-ops", to: GEOPROCESS },
  // The block is titled "Geoprocessing", which is now the SHELF's name too —
  // a section repeating the heading above it says nothing about itself.
  { anchor: "vec-op-run", id: "gp-vector-ops", to: GEOPROCESS, title: "Vector operations" },
  /**
   * ONE block, not three. `attr-query-run`, `calc-run` and `attr-stats-run`
   * all sit inside the same "Attribute Table" section — a query, a calculator
   * and a field summary over one layer's table, which is one tool and not
   * three that happen to be adjacent. Listing them separately made each spec
   * move the SAME node, so the last one won and the block landed on whichever
   * shelf happened to be named last.
   *
   * Its acts end in a changed or new layer — a selection becomes a layer, the
   * calculator writes a column back — so it is geoprocessing, and the field
   * statistics it also offers ride along rather than dragging the whole table
   * onto the other shelf.
   */
  { anchor: "attr-query-run", id: "gp-attribute-table", to: GEOPROCESS },
  { anchor: "gis-batch-run", id: "gp-batch", to: GEOPROCESS },

  // ── produces a table, a statistic or a chart ────────────────────────────
  { anchor: "zonal-run", id: "an-zonal-stats", to: ANALYSIS },
  { anchor: "raster-sample", id: "an-sample-rasters", to: ANALYSIS },
  { anchor: "extract-run", id: "an-extract-points", to: ANALYSIS },
  { anchor: "signal-run", id: "an-signal", to: ANALYSIS },
];

/**
 * Blocks whose job is done better somewhere else. HIDDEN, never removed: this
 * tree's own rule, paid for by `geology-structures-toggle` and the basemap
 * `<select>` — other modules read these ids unguarded at boot, and deleting
 * the element throws on the first frame.
 */
const RETIRED = [
  // The Export group is the one export surface.
  { anchor: "export-geojson", why: "Export group" },
  // The symbology DIALOG replaced this accordion: revealing it mid-stack
  // pushed everything below it down, which is why the dialog exists.
  { id: "gis-symbology-host", why: "symbology dialog" },
  // Workspace's + Data is the one doorway for user data.
  { anchor: "open-wfs", why: "Workspace + Data", buttonOnly: true },
];

const HEADINGS = {
  [GEOPROCESS]: "Geoprocessing",
  [ANALYSIS]: "Analysis",
};

const bodyOf = (groupId) => document.getElementById(groupId)
  ?.querySelector(":scope > .section-body");

/**
 * An existing element by id first, else the block holding the anchor control.
 *
 * `id` means two things and that cost a whole verify loop: on a RETIRED spec
 * it names an element that already exists, and on a BLOCK it names the id to
 * STAMP. Checking id first and returning early therefore found nothing on the
 * first pass — nothing had been stamped yet — so no block ever moved, while
 * the headings and the retirements either side of that loop worked perfectly
 * and made it look as though the module had run correctly.
 *
 * Falling through is what makes one function serve both: the anchor finds the
 * block the first time, the stamped id finds it every time after.
 */
function blockFor(spec) {
  const known = spec.id ? document.getElementById(spec.id) : null;
  if (known) return known;
  const anchor = spec.anchor ? document.getElementById(spec.anchor) : null;
  return anchor ? anchor.closest("details") : null;
}

function applyOnce() {
  const shelves = { [GEOPROCESS]: bodyOf(GEOPROCESS), [ANALYSIS]: bodyOf(ANALYSIS) };
  if (!shelves[GEOPROCESS] || !shelves[ANALYSIS]) return false;

  let moved = 0;
  // Two specs resolving to ONE block is the fault that put the attribute table
  // on the wrong shelf: each moved the same node and the last one won. Claimed
  // once per pass, and a second claim is refused rather than obeyed.
  const claimed = new Set();
  BLOCKS.forEach((spec) => {
    const block = blockFor(spec);
    const shelf = shelves[spec.to];
    if (!block || !shelf) return;
    if (claimed.has(block)) return;
    claimed.add(block);
    if (!block.id) block.id = spec.id;
    if (spec.title) {
      const summary = block.querySelector(":scope > summary .section-title-row > span:last-child")
        || block.querySelector(":scope > summary span:last-child");
      if (summary && summary.textContent !== spec.title) summary.textContent = spec.title;
    }
    // Already on the right shelf: nothing to do, and re-appending would
    // reorder the column on every pass.
    if (block.parentElement === shelf) return;
    shelf.appendChild(block);
    moved += 1;
  });

  RETIRED.forEach((spec) => {
    if (spec.buttonOnly) {
      const button = document.getElementById(spec.anchor);
      if (button) button.hidden = true;
      return;
    }
    const block = blockFor(spec);
    if (block) block.hidden = true;
  });

  Object.entries(HEADINGS).forEach(([groupId, title]) => {
    // The heading is the span the icon painter also writes into, so the text
    // node is replaced rather than the element rebuilt.
    const span = document.getElementById(groupId)
      ?.querySelector(":scope > summary .section-title-row > span:last-child");
    if (span && span.textContent !== title) span.textContent = title;
  });

  return moved > 0 || BLOCKS.every((spec) => blockFor(spec));
}

/**
 * The panels are rebuilt on every mode change, so this runs on a poll rather
 * than once — the same reason the tool-section icon painter does. Cheap,
 * because a pass where everything is already on its shelf moves nothing.
 */
export function installToolShelves({ everyMs = 700 } = {}) {
  if (typeof document === "undefined") return () => {};
  applyOnce();
  const timer = setInterval(applyOnce, everyMs);
  return () => clearInterval(timer);
}

export const __BLOCKS = BLOCKS;
export const __RETIRED = RETIRED;
export const __HEADINGS = HEADINGS;

/**
 * Self-installing, like every other panel module: `boot.js` imports the list
 * and each one wires itself. Waiting for DOMContentLoaded because the panels
 * are rendered into the page by `panels.js` on load.
 */
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => installToolShelves());
  } else {
    installToolShelves();
  }
}
