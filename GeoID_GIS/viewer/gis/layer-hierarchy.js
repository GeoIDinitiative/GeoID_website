// Layer hierarchy: draw order, visibility and transparency in one place.
//
// The import panel already lists what has been loaded, but a list is not a
// hierarchy -- there was no way to say which layer sits on top of which, or to
// fade one back to see what is underneath. Both matter as soon as more than a
// couple of layers are in play, which is the normal case once a basemap, a DEM
// and a few vector overlays are loaded together.
//
// Order is expressed the way GIS software does it: the top row draws last, over
// everything below. That is the opposite of three.js renderOrder, so the two are
// inverted when applied.

import { bandOf } from "./draw-order.js?v=20260830-428b0e1";
import { currentBody } from "./bodies.js?v=20260830-428b0e1";
import { samplerToRaster } from "./raster-analysis.js?v=20260830-428b0e1";
import { buildRasterLayer } from "./geotiff-adapter.js?v=20260830-428b0e1";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260830-428b0e1";
import { openSymbologyDialog, geometrySummary } from "./symbology-dialog.js?v=20260830-428b0e1";
import { chipHtml, typeSelect, applyTag, descriptionOf, isUserInput } from "./data-tags.js?v=20260830-428b0e1";

/**
 * The row grew a column and gained a tile, and .layer-row is declared twice --
 * styles.css for Earth, shell.css for the nine planet pages -- so this is
 * injected rather than written to either, which would have been a rule for half
 * the GUI.
 */
const STYLE = `
/* The dock is not one of the tabs.
 *
 * It sits directly under the tab bar in the same column, in the same chrome,
 * with a head that is literally a .section-toggle -- so it read as an eleventh
 * group that had somehow escaped the box above. It is a different kind of
 * thing: the bar is where you go to do something, this is a standing readout of
 * what is currently drawn, and it is the one panel that stays put while the
 * tabs come and go.
 *
 * So it stops borrowing the tab language. No accent spine, no +/- marker, a
 * squarer frame and a quieter head in the body typeface rather than the
 * uppercase Exo 2 the groups use, with a caret of its own that turns when it
 * folds.
 */
#layer-dock {
  border-radius: 0.6rem;
  border-color: rgba(var(--nav-accent-rgb), 0.55);
  box-shadow:
    0 0 24px -6px rgba(var(--nav-accent-rgb), 0.45),
    0 12px 28px rgba(0, 0, 0, 0.42),
    inset 0 0 0 1px rgba(255, 255, 255, 0.02);
}
#layer-dock .layer-dock-head {
  min-height: 2.1rem;
  padding: 0.4rem 0.6rem;
  background: linear-gradient(180deg,
    rgba(var(--nav-accent-rgb), 0.20), rgba(var(--nav-accent-rgb), 0.05));
  border-left: 0;
  border-bottom: 1px solid rgba(var(--nav-accent-rgb), 0.4);
}
#layer-dock .layer-dock-head:hover {
  background: linear-gradient(180deg,
    rgba(var(--nav-accent-rgb), 0.3), rgba(var(--nav-accent-rgb), 0.08));
  box-shadow: none;
}
/* The tile folds like a tab, so it says so like a tab: the SAME left chevron,
   turning the same way. It wore a "▾" on the far right — a second fold
   language in a column that had settled on one, and on the wrong edge.
   Matched to the specificity of the pair in shell.css that draws a +/- here
   -- #layer-dock:not(.is-collapsed) > .layer-dock-head::after -- since a
   shorter selector loses to them and leaves the tab marker in place; the
   ::after is emptied at that same specificity rather than merely unstyled. */
#layer-dock:not(.is-collapsed) > .layer-dock-head::after,
#layer-dock.is-collapsed > .layer-dock-head::after {
  content: none;
}
#layer-dock > .layer-dock-head::before {
  content: "\\203A";
  flex: 0 0 auto;
  width: 0.7rem;
  margin-right: 0.15rem;
  text-align: center;
  font-size: 1.15rem;
  line-height: 1;
  color: rgba(var(--nav-accent-rgb), 0.9);
  transform: rotate(90deg);
  transition: transform 0.15s ease;
}
/* Collapsed is the CLOSED state here, which is the opposite polarity to a
   <details>: the tabs rotate on [open], this rotates back on .is-collapsed. */
#layer-dock.is-collapsed > .layer-dock-head::before { transform: rotate(0deg); }
#layer-dock .layer-dock-head .section-title {
  font-family: "Exo 2", "Segoe UI", sans-serif;
  font-weight: 600;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text) !important;
  text-shadow: none !important;
}
#layer-dock .layer-dock-head .section-icon { color: rgb(var(--nav-accent-rgb)) !important; }
/* Seven columns now: grip, disclosure, eye, name, kind, opacity, moves. */
.layer-stack .layer-row {
  grid-template-columns: auto auto auto 1fr auto 4.5rem auto;
}
.layer-grip { letter-spacing: -0.08em; }

/* The classification line: full width under the buttons, fields sharing it. */
.layer-options .data-tag-row {
  flex: 1 1 100%;
  min-width: 0;
}

.layer-disclose {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.3);
  border-radius: 0.3rem;
  background: transparent;
  color: var(--text);
  font-size: 0.6rem;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.layer-disclose:hover {
  border-color: rgb(var(--nav-accent-rgb));
  color: rgb(var(--nav-accent-rgb));
}
/* Open, it is filled and the caret has turned -- the same thing every other
   open control in this GUI says, so the tile below is clearly its doing. */
.layer-disclose[aria-expanded="true"] {
  background: rgb(var(--nav-accent-rgb));
  border-color: rgb(var(--nav-accent-rgb));
  color: var(--skin-chrome-ink, #2b0030);
}
.layer-disclose[aria-expanded="true"] span { display: block; transform: rotate(180deg); }

.layer-options {
  /* The detail and the actions share the first line; the ONLY thing allowed
     to wrap is the data-tag row below, which claims a full line of its own —
     jammed into the nowrap line, the note field was crushed to nothing. */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  /* FLUSH with the row it belongs to. The 1.35rem indent lined the drawer up
     with the row's TEXT, which reads as a drawer that has come untucked on one
     side -- and it was 22 px of the width the buttons needed. */
  margin: -0.15rem 0 0.15rem 0;
  padding: 0.45rem 0.35rem;
  box-sizing: border-box;
  max-width: 100%;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.45);
  border-top-color: transparent;
  border-radius: 0 0 0.45rem 0.45rem;
  background: #000;
  font-size: 0.66rem;
}
/* Centred and equal: these are alternatives to one another, so none of them
   leads -- and they WRAP, because there are eight of them now.

   nowrap plus flex 0 0 auto was written when there were three, and it makes
   this row a child that can neither wrap nor shrink: its min-content width
   becomes the drawer's min-content width, so the drawer grew to whatever the
   buttons happened to add up to and pushed straight through the Workspace
   tile it lives in. Measured with eight buttons: a 428 px drawer inside a
   382 px dock, 78 px of it past the right edge, with nothing overflowing in
   the row itself -- which is why it presents as the DROP-DOWN not fitting
   rather than as a row of buttons overflowing. A container cannot be sized
   by a child that refuses to give way. */
.layer-options-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  /* Sized to fit all eight on ONE line at the dock's own width: measured,
     337 px of buttons in 348 px of drawer. Wrapping stays as the fallback --
     the dock narrows to 20rem under the short-landscape rule, where one line
     is not arithmetically possible and two whole buttons beat eight clipped
     ones. */
  gap: 0.16rem;
  flex: 0 1 auto;
  min-width: 0;
}
.layer-props-inline {
  margin: -0.15rem 0 0.15rem 0;
  padding: 0.5rem 0.55rem 0.6rem;
  box-sizing: border-box;
  max-width: 100%;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.3);
  border-top: 0;
  border-radius: 0 0 0.45rem 0.45rem;
  background: #000;
  font-size: 0.66rem;
}
/* The tile above it stops rounding off where the two meet, so they read as one
   drawer rather than two boxes that happen to be touching. */
.layer-options:has(+ .layer-props-inline) {
  border-radius: 0;
  border-bottom: 0;
  margin-bottom: 0;
}
.layer-options-btn {
  flex: 0 0 auto;
  width: auto;
  padding: 0.18rem 0.24rem;
  border-radius: 0.35rem;
  font-size: 0.55rem;
  white-space: nowrap;
}
/* Removing a layer throws work away and cannot be undone, so it does not look
   like the two beside it that only change what you are looking at. */
.layer-options-btn.is-danger {
  border-color: rgba(255, 110, 110, 0.5) !important;
  color: rgba(255, 150, 150, 0.95) !important;
}
.layer-options-btn.is-danger:hover {
  border-color: rgba(255, 110, 110, 0.9) !important;
  background: rgba(220, 70, 70, 0.16) !important;
  color: #fff !important;
}

/* An EMPTY status line is not a line, and an empty list is not a list.
 *
 * The dock body carries three elements that must stay in the page because
 * polygons.js addresses them by id -- the hidden file input, the status
 * paragraph and the polygon list -- and for most of a session all three are
 * empty. They still cost height: the paragraph keeps its 4px top margin, and
 * the .control-stack around them is a GRID, which lays its 10.4px gap between
 * two zero-height rows exactly as it would between two full ones. Measured on
 * a dock holding two layers: 21.6px between the head and the first row, of
 * which 14.4px was scaffolding for content that was not there.
 *
 * Hiding them while empty collapses the grid to nothing and leaves the body's
 * own 7.2px padding as the only space -- and the moment polygons.js writes a
 * message the rule stops matching and the line comes back with its spacing
 * intact, which a blanket gap: 0 would not have done. */
#layer-dock-body #polygon-status:empty,
#layer-dock-body #polygon-list:empty { display: none; }

`;

function injectStyle() {
  if (document.getElementById("geoid-layer-row-style")) return;
  const tag = document.createElement("style");
  tag.id = "geoid-layer-row-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

const HOST_ID = "layers-tools-host";
const METADATA_ID = "metadata-list";

let dragId = null;

function layers() {
  return window.GeoIDImportManager?.getLayers?.() || [];
}

/**
 * Draw order, top row first. The import manager keeps layers in load order, so
 * an explicit index is stored on each one the first time it is seen and used
 * from then on.
 */
/**
 * Geology is a BASE, so it sorts under everything else that was imported.
 *
 * A geological map is the ground a study is about; a shapefile somebody added,
 * an area they drew, a pulled event feed are all things they put ON that
 * ground. Ordering them by arrival alone meant the world geology - which
 * arrives with the tab and covers the planet - painted over a river network or
 * a set of epicentres somebody had just loaded, and the only way to see them
 * again was to reorder by hand. Within each band the hand order still holds,
 * so dragging a layer up or down does what it always did.
 */
/**
 * Three bands, bottom to top: IMAGERY, GEOLOGY, everything else.
 *
 * A picture of the ground (a tile drape, an Earth Engine snapshot) is a
 * basemap however it arrived, so the geological map goes over it. The geology
 * is in turn the ground a study is about, so a shapefile, a drawn area or a
 * pulled event feed goes over that. Within a band the hand order still holds,
 * so dragging a layer up or down does what it always did.
 */

function ordered() {
  const list = layers();
  list.forEach((layer, i) => {
    if (!Number.isFinite(layer.stackIndex)) layer.stackIndex = i;
  });
  // The list is TOP FIRST -- `applyStack` gives index 0 the highest draw order
  // -- so the higher band has to sort first, not last.
  return [...list].sort((a, b) => (bandOf(b) - bandOf(a)) || (b.stackIndex - a.stackIndex));
}

// Imported layers draw above everything the viewer ships -- its basemap shells
// end at 7 and its streamed tiles at 40 -- and below the pins, labels and
// selection rings it puts on top at 199 and up. Without the offset the stack
// numbered from 1, which put a fetched overlay underneath the very basemaps it
// was meant to annotate.
const IMPORTED_BASE = 50;

function applyStack() {
  const stack = ordered();
  stack.forEach((layer, i) => {
    const object = layer.object3D;
    if (!object) return;
    // Top of the list draws last, so it wins where layers overlap. Held inside
    // the band so a long stack cannot climb into the marker orders.
    object.renderOrder = IMPORTED_BASE + Math.min(stack.length - i, 140);
    /**
     * EVERY node, not only the ones with a material — and this is the whole
     * reason "always on top" never worked for the event markers.
     *
     * three.js sorts the transparent pass with `reversePainterSortStable`,
     * which compares **groupOrder before renderOrder**; and `projectObject`
     * takes groupOrder from the nearest ancestor that `isGroup`, using that
     * Group's own renderOrder. A `THREE.Group` has no material, so stamping
     * only material-bearing nodes left every intermediate group at 0 — and a
     * layer whose geometry hangs under an inner group was therefore sorted at
     * groupOrder 0 whatever its meshes said.
     *
     * That is exactly what happened to the events: their point clouds sit in a
     * `markers` group inside the spin frame, so they sorted at 0 while the
     * geology tiles — whose own builder stamps all children, groups included —
     * sorted at 51 and painted straight over them. Measured at the markers'
     * own projected pixels: **19 of 93 visible over a geological map, 93 of 93
     * over the basemap**. Raising the points to renderOrder 230 could not fix
     * it and never did; groupOrder is decided before renderOrder is read.
     */
    object.traverse?.((node) => {
      /**
       * A node may OPT OUT: the satellite layer's dot/ring/tag groups are
       * nested bands (198/199/206) that must beat the tile drapes and meet
       * the label band, and this stamp was silently flattening them back
       * into the data band on every hierarchy change. The flag is for
       * deliberate nested bands only — a layer's ordinary geometry must
       * keep taking the stack's order or dragging rows stops working.
       */
      if (node.userData?.keepRenderOrder) return;
      /**
       * A node may also keep a fractional LIFT within the layer's own band.
       *
       * The tiled geology draws the view's sharp tiles half a step above the
       * coarse backdrop they replace — that half step is how the fine map wins
       * where both cover the same ground — and this stamp was flattening it to
       * the band value on every hierarchy change, leaving both at 51 with the
       * winner decided by traversal order. It went unnoticed only because the
       * backdrop used to be CUT AWAY under the sharp tiles, so the two never
       * overlapped; the moment the window was kept for opaque layers, the
       * flattened lift became the coarse map drawing over the fine one.
       *
       * `keepRenderOrder` is the wrong tool here: these nodes must still track
       * the stack, so the layer can be dragged. They keep their offset FROM
       * it instead.
       */
      const lift = Number(node.userData?.renderLift) || 0;
      node.renderOrder = object.renderOrder + lift;
    });
  });
}

function setOpacity(layer, value) {
  layer.opacity = value;
  const object = layer.object3D;
  if (!object) return;
  object.traverse?.((node) => {
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      /**
       * Opacity may never move a layer between render passes.
       *
       * This used to switch blending off at full opacity -- "transparent
       * materials are sorted separately and cost more to draw", which is true
       * and was the bug. **Separately** is the word: the renderer draws every
       * opaque object first and every transparent one afterwards, and no
       * `renderOrder` crosses between the two lists. So taking a layer back to
       * 100% made it opaque, which drew it BEFORE every layer still at 99% or
       * less -- including the sheet underneath it, which then painted straight
       * over the top. Dragging the slider up made the layer disappear.
       *
       * Blending stays on. It may be switched on when it is needed and never
       * off again, so a layer's place in the stack is decided by the stack.
       * `depthWrite` is left exactly as the layer was built: these fills draw
       * without a depth test on purpose, and writing depth at full opacity let
       * them occlude whatever was drawn after them.
       */
      if (value < 0.999) material.transparent = true;
      /**
       * A layer's opacity SCALES what an element was drawn at; it does not
       * replace it.
       *
       * The contact stroke is drawn at its own subtle weight, and overwriting
       * it meant dragging a sheet down to 40% PROMOTED its 25% contacts to
       * 40% — the boundaries getting heavier as the map faded, which is how
       * they came to be visible only at low opacity in the first place.
       * Anything with no weight of its own is unaffected: `baseOpacity`
       * defaults to 1 and 1 x value is value.
       */
      const base = Number.isFinite(material.userData?.baseOpacity)
        ? material.userData.baseOpacity : 1;
      material.opacity = value * base;
      material.needsUpdate = true;
    });
  });
}

/**
 * The ONE place a layer's visibility is written.
 *
 * There are three controls for it -- the layer row's eye, the geology tab's,
 * and the Hide/Show action in a row's options -- and three surfaces that have
 * to agree afterwards: the rows, the legend over the scene, and the geology
 * tab's own list. Each control used to do its own writing and refresh whatever
 * it happened to own, so the other two went stale: switching a sheet off in the
 * layer list left the geology tab still ticked and its polygons still answering
 * clicks, and switching it off in the geology tab left it in the key.
 *
 * So every control routes here, this writes the state once, redraws what it
 * owns, and then says so. Anything else that shows visibility listens for that
 * announcement rather than being called by name -- which is what keeps a fourth
 * surface from having to be wired into all three.
 */
function setVisible(layer, visible) {
  layer.visible = visible;
  if (layer.object3D) layer.object3D.visible = visible;
  render();
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", {
    detail: { layer, visible, reason: "visibility" },
  }));
}

function move(id, delta) {
  const stack = ordered();
  const from = stack.findIndex((l) => l.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= stack.length) return;
  // The band of the row it is taking the place of, read BEFORE the splice:
  // a layer dropped among geology is geology's neighbour now, whatever its
  // kind would have said. See `bandOf`.
  const displaced = stack[to];
  const moved = stack.splice(from, 1)[0];
  stack.splice(to, 0, moved);
  moved.bandOverride = bandOf(displaced);
  // Rewrite the indices so the array order becomes the stored order.
  stack.forEach((layer, i) => { layer.stackIndex = stack.length - 1 - i; });
  render();
}

function reorderTo(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const stack = ordered();
  const from = stack.findIndex((l) => l.id === sourceId);
  const to = stack.findIndex((l) => l.id === targetId);
  if (from < 0 || to < 0) return;
  const displaced = stack[to];
  const moved = stack.splice(from, 1)[0];
  stack.splice(to, 0, moved);
  moved.bandOverride = bandOf(displaced);
  stack.forEach((layer, i) => { layer.stackIndex = stack.length - 1 - i; });
  render();
}

function row(layer) {
  const node = document.createElement("div");
  node.className = "layer-row";
  // Draggable only while held by the grip. With the whole row draggable, using
  // the opacity slider started a row drag instead of moving the slider.
  node.draggable = false;
  node.dataset.layerId = layer.id;
  const opacity = Number.isFinite(layer.opacity) ? layer.opacity : 1;
  const visible = layer.visible !== false;
  // Two dot columns used to sit at the head of the row and both meant the same
  // thing: grab here. One says it, and the space the other took becomes the way
  // into this layer's own options.
  node.innerHTML = `
    <button class="layer-grip" type="button" title="Drag to reorder" aria-hidden="true">⋮</button>
    <button class="layer-disclose" type="button" data-role="disclose"
      title="Layer options" aria-label="Layer options"
      aria-expanded="${layer.optionsOpen ? "true" : "false"}"><span aria-hidden="true">▾</span></button>
    <label class="layer-eye" title="Visible">
      <input type="checkbox" ${visible ? "checked" : ""} data-role="visible">
    </label>
    <span class="layer-name" title="Click to rename" tabindex="0" role="button">${layer.name || "layer"}</span>
    ${chipHtml(layer)}
    <input class="layer-opacity" type="range" min="0" max="1" step="0.05"
      value="${opacity}" data-role="opacity" title="Transparency">
    <span class="layer-moves">
      <button type="button" data-role="up" title="Move up">▲</button>
      <button type="button" data-role="down" title="Move down">▼</button>
    </span>`;

  /**
   * The name is the field people most want to change and the one place the list
   * offered no way to. Click it and it becomes an input in place -- Enter or
   * blur commits, Escape puts the old one back.
   *
   * `renameLayer` on the import manager does the actual work, because a name
   * lives in three places (the record, the GeoJSON feature, the object3D) and a
   * rename that touches one of them looks right until the layer is exported.
   */
  const nameNode = node.querySelector(".layer-name");
  nameNode?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (nameNode.querySelector("input")) return;
    const before = layer.name || "layer";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "layer-name-input";
    input.value = before;
    input.setAttribute("aria-label", "Layer name");
    nameNode.textContent = "";
    nameNode.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (keep) => {
      if (done) return;
      done = true;
      const wanted = input.value.trim();
      if (keep && wanted && wanted !== before) {
        window.GeoIDImportManager?.renameLayer?.(layer, wanted);
      }
      // render() rebuilds the row either way, so the input never lingers.
      render();
    };
    input.addEventListener("keydown", (e) => {
      // The viewer eats the space bar document-wide; a text input must keep it.
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
    input.addEventListener("click", (e) => e.stopPropagation());
  });
  nameNode?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nameNode.click(); }
  });

  node.querySelector('[data-role="visible"]').addEventListener("change", (e) => {
    setVisible(layer, e.target.checked);
  });
  node.querySelector('[data-role="opacity"]').addEventListener("input", (e) => {
    setOpacity(layer, Number(e.target.value));
  });
  node.querySelector('[data-role="up"]').addEventListener("click", () => move(layer.id, -1));
  node.querySelector('[data-role="down"]').addEventListener("click", () => move(layer.id, 1));
  node.querySelector('[data-role="disclose"]').addEventListener("click", () => {
    layer.optionsOpen = !layer.optionsOpen;
    render();
  });

  const grip = node.querySelector(".layer-grip");
  grip.addEventListener("pointerdown", () => { node.draggable = true; });
  window.addEventListener("pointerup", () => { node.draggable = false; });
  node.addEventListener("dragstart", () => { dragId = layer.id; node.classList.add("is-dragging"); });
  node.addEventListener("dragend", () => {
    dragId = null;
    node.classList.remove("is-dragging");
    node.draggable = false;
  });
  node.addEventListener("dragover", (e) => { e.preventDefault(); node.classList.add("is-drop"); });
  node.addEventListener("dragleave", () => node.classList.remove("is-drop"));
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    node.classList.remove("is-drop");
    reorderTo(dragId, layer.id);
  });
  return node;
}

/**
 * One layer's options, under its own row.
 *
 * These used to be a strip of buttons in a second list further down the dock,
 * which meant the same layer appeared twice and the buttons were a walk away
 * from the row they acted on -- with several layers loaded, which strip
 * belonged to which row was a guess. Attached to the row and opened from it,
 * there is nothing to match up.
 *
 * Style is gone. It opened a properties panel that duplicated the row's own
 * visibility and opacity, so it was a second way to the controls already an
 * inch above it.
 */
function optionsTile(layer) {
  const tile = document.createElement("div");
  tile.className = "layer-options";
  tile.dataset.layerId = layer.id;

  const manager = window.GeoIDImportManager;
  const what = manager?.describeLayer?.(layer);
  // No format badge. The row above already carries the layer's kind in its own
  // column, so the tile was repeating it directly underneath -- and the format
  // is not something you act on, which is what this tile is for -- and NOR IS
  // THE FEATURE COUNT, which is why it has gone the same way as the badge. It
  // claimed the whole first line of the drawer ("1 features", centred, above
  // the buttons) to restate something the layer's own row and its legend entry
  // both already carry, and it was the reason the drawer needed two lines at
  // all. A drawer is the things you can DO to a layer.

  /**
   * The tag, editable forever — but ONLY on the user's own inputs. A
   * prebuilt dataset (catalogue tick, GEE pull, live feed, tile basemap)
   * is classified by where it came from, and re-filing it by hand would
   * put the chip and the catalogue in disagreement; its row chip states
   * the class and the drawer offers nothing to change. Committed on
   * change — a classification is not something to press Apply for.
   */
  const editableTag = isUserInput(layer);
  const tagRow = document.createElement("div");
  tagRow.className = "data-tag-row";
  tagRow.style.cssText = "display:flex;gap:0.35rem;align-items:center;margin:0.15rem 0 0.3rem;";
  const tagSelect = typeSelect(layer);
  tagSelect.style.flex = "0 0 8.5rem";
  tagSelect.addEventListener("change", () => applyTag(layer, { type: tagSelect.value }));
  const tagNote = document.createElement("input");
  tagNote.className = "input";
  tagNote.type = "text";
  tagNote.placeholder = "Note — what is this input for?";
  tagNote.value = descriptionOf(layer);
  tagNote.style.cssText = "flex:1;min-width:0;";
  tagNote.addEventListener("change", () => applyTag(layer, { description: tagNote.value.trim() }));
  tagRow.append(tagSelect, tagNote);

  const actions = document.createElement("div");
  actions.className = "layer-options-actions";

  // Whatever the last action on this layer had to say. Written into the drawer
  // rather than a global status line, because it is about this layer and the
  // drawer is where the user is looking when they press its buttons.
  const note = () => {
    if (!layer.saveNote) return;
    const line = document.createElement("div");
    line.className = "gis-metric layer-options-note";
    line.textContent = layer.saveNote;
    actions.parentElement?.appendChild(line);
  };

  const visible = layer.visible !== false && layer.object3D?.visible !== false;
  const act = (label, onClick, danger = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button secondary layer-options-btn${danger ? " is-danger" : ""}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    actions.appendChild(button);
  };

  act(visible ? "Hide" : "Show", () => { setVisible(layer, !visible); render(); });
  // Framing needs the loader's camera maths, which knows how to fit a layer's
  // bounds; only offered once there is something in the scene to frame.
  if (layer.object3D && manager?.frameLayer) act("Focus", () => manager.frameLayer(layer));
  /**
   * Recolouring, from the layer itself.
   *
   * This is the drawer that means "this layer's controls", and the one control
   * that was not in it was the one that decides what the layer LOOKS like --
   * which lived in a panel elsewhere with its own dropdown to find the layer in
   * again. Offered wherever there is something to recolour: a layer that can
   * repaint and has either cells or attributes to classify.
   */
  if (typeof layer.repaint === "function" && (layer.raster || layer.features?.length)) {
    act("Symbology", () => openSymbologyDialog(layer));
  }
  /**
   * The attribute table, for the layers that HAVE one.
   *
   * A CSV of sample sites becomes points on the globe and then becomes
   * unreachable: its values are in the click card one feature at a time, and
   * correcting a typo meant fixing the file outside the app and importing it
   * again. `isEditable` is the gate — features with attributes, and not a
   * raster or a tile service somebody else re-fetches.
   */
  if (window.GeoIDTableEditor?.isEditable?.(layer)) {
    act("Table", () => window.GeoIDTableEditor.open(layer));
  }
  act("Export", () => window.GeoIDLayerExport?.open?.(layer));
  /**
   * A drawn polygon is a MODEL EXTENT waiting to be used: one action hands
   * its bounds to the Meshing Studio through the same sendToStudio the
   * Research Hub's own button uses — the pipeline connection, from the
   * layer that IS the shape.
   */
  const drawnRing = (layer.ext === "drawn"
    || layer.collection?.features?.[0]?.properties?.drawn_at)
    ? layer.collection?.features?.[0]?.geometry?.coordinates?.[0] : null;
  if (drawnRing?.length) {
    act("To Model", async () => {
      try {
        const bridge = await import(`./research/bridge.js${new URL(import.meta.url).search}`);
        const lons = drawnRing.map((c) => c[0]);
        const lats = drawnRing.map((c) => c[1]);
        await bridge.sendToStudio({
          min_lat: Math.min(...lats), max_lat: Math.max(...lats),
          min_lon: Math.min(...lons), max_lon: Math.max(...lons),
        });
      } catch (error) {
        window.alert?.(`Could not open the studio: ${error.message}`);
      }
    });
  }

  /**
   * The last mile of the one output rule: tool results, drawn areas and
   * georeferenced images record themselves, and imports register on arrival —
   * but a layer that arrived before a project was opened had no way in
   * afterwards, so the project's record depended on the order someone happened
   * to do things in.
   *
   * The bytes are produced by the SAME encoder the Export dialog uses, so what
   * lands in the project is byte-for-byte what a download would have been.
   */
  act("To project", async () => {
    const exporter = window.GeoIDLayerExport;
    const bridge = window.GeoIDResearch?.bridge;
    if (!exporter?.renderExport || !bridge?.saveProcessed) {
      layer.saveNote = "The project bridge is not loaded.";
      render();
      return;
    }
    try {
      const format = exporter.suggestedFormat?.(layer);
      const out = exporter.renderExport(layer, format?.id || format);
      if (!out) throw new Error("this layer has nothing to write");
      await bridge.saveProcessed(out.filename, out.bytes || out.text, {
        mime: out.mime,
        provenance: { tool: "layer", inputs: [layer.name], kind: layer.ext || "layer" },
      });
      layer.saveNote = `Saved as ${out.filename}.`;
    } catch (error) {
      // Never silent: a project that is closed, full or unwritable is the
      // commonest reason this does nothing, and the user cannot guess it.
      layer.saveNote = `Not saved: ${error?.message || error}`;
    }
    render();
  });

  /**
   * A sampled layer becomes a real raster on request.
   *
   * A GEE drape is a picture with a sampler — a palette read — and no band, so
   * the raster tools cannot touch it: slope, reclassify, the calculator and
   * zonal statistics all want cells. This grids the sampler over the layer's
   * own bounds into a first-class raster layer, which also makes it exportable
   * as a GeoTIFF. Offered only where the sampler yields NUMBERS: a colour-only
   * sampler (no legend to invert) would grid colours pretending to be values,
   * and the source list already tells that layer's user why.
   */
  if (layer.sampler && layer.bounds && !layer.raster
    && layer.info?.valueKind !== "colour") {
    act("To raster", () => {
      const raster = samplerToRaster(layer.sampler, layer.bounds);
      if (!raster) {
        window.alert("Nothing numeric could be sampled from this layer.");
        return;
      }
      const column = layer.info?.column || layer.name;
      const result = buildRasterLayer([raster.band], raster.width, raster.height,
        raster.bounds, { name: `${column}_raster`, noData: NaN, isDem: false });
      const made = window.GeoIDImportManager?.addDerivedLayer?.(
        `${column}_raster`, result, "derived");
      if (made) {
        // The reading came off a rendered palette, so the provenance says so —
        // the number must never pass as the archive band.
        made.metadata = {
          source: `Materialised from ${layer.name} (palette read)`,
          format: `${raster.width}x${raster.height} grid`,
          importedAt: new Date().toISOString(),
        };
      }
    });
  }

  /**
   * Remove asks first.
   *
   * It disposes the geometry and there is no undo -- an imported layer would
   * have to be found and loaded again, and a derived one recomputed. It also
   * now sits an inch from Hide, which is the button people reach for when they
   * mean "get this off my screen", so a misfire is likely rather than exotic.
   * A second click inside the tile rather than a modal: the weight should match
   * losing one layer, not losing the project.
   */
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button secondary layer-options-btn is-danger";
  remove.textContent = layer.confirmRemove ? "Sure?" : "Remove";
  remove.title = layer.confirmRemove
    ? "Click again to remove this layer for good"
    : "Remove this layer";
  remove.addEventListener("click", () => {
    if (layer.confirmRemove) { manager?.removeLayer?.(layer.id); return; }
    layer.confirmRemove = true;
    render();
    // It stands down on its own, so an armed button is never left lying under
    // the pointer for the next person to press.
    window.setTimeout(() => {
      if (!layer.confirmRemove) return;
      layer.confirmRemove = false;
      render();
    }, 4000);
  });
  actions.appendChild(remove);

  tile.appendChild(actions);
  // The tag row LAST, on its own full-width line (the CSS wraps it) — and
  // only for user inputs; see the note where it is built.
  if (editableTag) tile.appendChild(tagRow);
  note();
  return tile;
}

/**
 * A layer's own settings, under its actions.
 *
 * These were behind the Style button, which went because it duplicated the
 * visibility and opacity already on the row. What it also held did not
 * duplicate anything: placing an ungeoreferenced model on the globe by
 * latitude and longitude, its scale and rotation, drape offset, colour and
 * wireframe. Removing the button took those with it.
 *
 * So they come back attached to the layer rather than behind a second one --
 * no extra button, since the disclosure already means "this layer's controls",
 * and only where the layer actually has something to set.
 */
function propertiesPanel(layer) {
  if (!layer.object3D || layer.status !== "loaded") return null;
  const build = window.GeoIDLayerProperties?.build;
  if (!build) return null;
  const panel = build(layer);
  if (!panel) return null;
  panel.classList.add("layer-props-inline");
  return panel;
}

/**
 * Has a render ever actually landed?
 *
 * `render()` gives up when its host is not on the page yet, and the toolbox
 * moves these panels about during boot -- so the first call routinely finds
 * nothing. The poll below used to retry only when the layer COUNT changed,
 * which with no layers loaded is never: the list and the legend stayed empty,
 * and the basemap card that should always be in the key was missing until an
 * import happened to arrive.
 */
let mounted = false;

export function render() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  mounted = true;
  let panel = host.querySelector(".layer-stack");
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "layer-stack";
    host.prepend(panel);
  }
  panel.textContent = "";
  const stack = ordered();
  // No empty-state text: the basemap row below already shows the dock is alive,
  // and two lines saying nothing is loaded said it twice.
  stack.forEach((layer) => {
    panel.appendChild(row(layer));
    // The tile belongs to the row above it, so it is a sibling rather than a
    // child: the row is a grid whose columns are the controls, and a panel
    // inside it would have had to be a seventh column of full width.
    if (layer.optionsOpen) {
      panel.appendChild(optionsTile(layer));
      const props = propertiesPanel(layer);
      if (props) panel.appendChild(props);
    }
  });
  // The default basemap accounted for alongside everything drawn over it. It
  // is the floor of the stack rather than a movable member, so it carries a
  // visibility eye but no drag and no opacity -- the globe is shader-drawn,
  // and a material opacity would claim an effect it does not have.
  panel.appendChild(basemapRow());
  applyStack();
  renderMetadata(stack);
  renderLegend(stack);
}

/**
 * Which basemap is actually on the globe, and what to say about it.
 *
 * The row used to read "<Body> basemap / default" whatever was selected, which
 * is only true until someone changes it -- pick Esri satellite or OpenStreetMap
 * and the stack still claimed the default was drawn. The dropdown IS the state
 * (the viewer's `getBaseLayerId` reads it), so the name comes from the option
 * that is selected and the credit from whichever registry knows that id: the
 * tile sources for a streamed basemap, the manifest for a shipped texture.
 */
function activeBasemap() {
  const viewer = window.GeoIDViewer;
  const id = viewer?.getBaseLayerId?.() || "";
  const select = document.getElementById("base-layer-select");
  const option = select ? [...select.options].find((o) => o.value === id) : null;
  const label = option?.textContent?.trim();
  const tiles = window.GeoIDBasemapDrape;
  const source = tiles?.tileBasemapSource?.();
  const tileEntry = source && tiles?.TILE_SOURCES ? tiles.TILE_SOURCES[source] : null;
  const manifestEntry = (viewer?.manifest?.layers || []).find((l) => l.id === id);
  return {
    id,
    label: label || `${currentBody()?.name || "Earth"} basemap`,
    credit: tileEntry?.licence || tileEntry?.attribution || manifestEntry?.description || "",
    streamed: Boolean(tileEntry),
  };
}

/**
 * The globe's own imagery, as the floor of the layer stack.
 *
 * Named from the body registry rather than fixed at Earth: this box appears on
 * every world now, and a Mars page listing an "Earth basemap" is telling the
 * user the wrong thing about what they are looking at.
 */
function basemapRow() {
  const viewer = window.GeoIDViewer;
  const node = document.createElement("div");
  node.className = "layer-row layer-row-basemap";
  const visible = viewer?.globe?.visible !== false;
  const base = activeBasemap();
  node.innerHTML = `
    <span class="layer-grip" aria-hidden="true"></span>
    <label class="layer-eye" title="Visible">
      <input type="checkbox" ${visible ? "checked" : ""} data-role="visible">
    </label>
    <span class="layer-name" title="${base.credit || base.label}">${base.label}</span>
    <span class="layer-kind">${base.streamed ? "tiles" : "basemap"}</span>`;
  node.querySelector('[data-role="visible"]').addEventListener("change", (e) => {
    // The imported imagery hangs off the globe so it turns with it, which means
    // hiding the globe object would hide the imagery too -- the opposite of
    // what switching a basemap off is for. Only the globe's own surfaces are
    // silenced, and anything tagged as an imported layer keeps drawing.
    //
    // Silenced by dropping their colour, not by skipping them: a mesh that is
    // not drawn writes no depth, and the planet stops being solid. With the
    // basemap off that is exactly what happened -- the moon's orbit line and
    // the event markers on the far side passed the depth test and showed
    // through the globe. Painting nothing while still occupying its depth
    // keeps the planet opaque to everything behind it, which is what "switch
    // the basemap off" should mean.
    const globe = viewer?.globe;
    if (!globe) return;
    globe.traverse((o) => {
      if (!o.isMesh || o.userData.geoidLayer) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m) m.colorWrite = e.target.checked; });
    });
  });
  return node;
}

/**
 * Legend over the scene. Offered only when there is something to describe --
 * an empty legend is just furniture.
 *
 * A layer that is switched off is REMOVED, not dimmed. Dimming was the earlier
 * answer, on the reasoning that a key should not lose an entry the moment you
 * glance away from it -- but a legend describes what is on the screen, and a
 * greyed card describes something that is not: the reader is left working out
 * which of two Northern Irish sheets they are actually looking at. Switching a
 * layer back on brings its card back, so nothing is lost by leaving.
 */
function renderLegend(stack) {
  // The drop-down is shared now -- imported layers are one source in it beside
  // the viewer's overlays and the interior cutaway -- so this hands over cards
  // instead of owning the panel. Whether it is shown, and whether it opens, is
  // the dock's to decide once it knows about every source.
  const dock = window.GeoIDLegendDock;
  if (!dock) return;
  /**
   * A layer that describes itself somewhere else is not described twice.
   *
   * `legendHidden` is the seam for that, and the live events feed is what
   * needed it: its own drop-down lists every category it is drawing, with the
   * same glyph and the same colour, above the events themselves — so the
   * legend card beside it was the same key a second time, in a second place,
   * for a reader to keep in step by eye.
   *
   * It is deliberately NOT the same as being invisible: the layer keeps its
   * row in the layer box, its eye, its opacity and its place in the draw
   * order. This says only that the legend is not the place it is explained.
   */
  const visible = stack.filter((layer) => layer.visible !== false && !layer.legendHidden);
  /**
   * Every shape SOMEBODY DREW is one entry, not one entry each.
   *
   * A card per drawn shape is the legend describing the reader's own working
   * set back to them a line at a time: ten study areas took ten headed cards,
   * each with a full-width ramp bar under it, and pushed the datasets the map
   * is actually about off the bottom of the panel. They are all the same KIND
   * of thing, which is exactly what a legend groups.
   *
   * So they collapse into one card built like the geology key -- a swatch and
   * a name per row -- and it sits where the first of them sat, so the legend
   * still reads in draw order rather than hoisting the user's shapes above the
   * map.
   */
  const drawn = visible.filter(isDrawnLayer);
  const cards = [];
  let placedDrawn = false;
  visible.forEach((layer) => {
    if (isDrawnLayer(layer)) {
      // At the position of the FIRST drawn layer, once.
      if (!placedDrawn) {
        placedDrawn = true;
        cards.push(drawnAreasCard(drawn));
      }
      return;
    }
    cards.push(buildLayerCard(layer));
  });
  dock.publish("layers", cards);
  // Its own source rather than the tail of this one, so it sits below every
  // other source the dock collects -- the overlays and the interior cutaway
  // included -- rather than merely below the imported layers.
  dock.publish("basemap", [basemapCard()].filter(Boolean));
}

/**
 * The basemap as a legend card.
 *
 * It is the one thing on the globe that had no entry: every imported layer was
 * described and the imagery under all of them was not, so a reader could not
 * tell whether they were looking at Blue Marble, a hillshade or live Esri
 * satellite -- and for the streamed sources the licence line, which they are
 * free only on condition of, appeared nowhere at all. Not offered when the
 * globe's imagery is switched off, since then it is not what you are looking at.
 */
function basemapCard() {
  const viewer = window.GeoIDViewer;
  if (viewer?.globe?.visible === false) return null;
  const base = activeBasemap();
  if (!base.id && !base.label) return null;
  const card = document.createElement("section");
  card.className = "legend-entry";
  card.dataset.legendKey = base.label;
  /**
   * Present, folded, and never a reason to open the drop-down.
   *
   * There is always a basemap, so its card is always in the key -- but it is
   * the thing you are least often asking about, and two sheets of geology
   * should not be pushed down the panel by it. Folded, it is one line naming
   * what the globe is wearing, and its licence is one click away.
   *
   * And switching basemap makes this a different card -- a new key, which the
   * auto-open rule reads as an arrival and springs the panel open for. Choosing
   * a basemap is deliberate and its effect is on the globe in front of you; it
   * does not need the legend thrown open as well.
   */
  card.dataset.legendFold = "collapsed";
  card.dataset.legendAutoOpen = "never";

  const badge = document.createElement("p");
  badge.className = "layer-type-badge";
  badge.textContent = base.label;
  card.appendChild(badge);

  const list = document.createElement("div");
  list.className = "legend-symbol-list";
  const row = document.createElement("div");
  row.className = "legend-symbol-row";
  const swatch = document.createElement("span");
  swatch.className = "legend-swatch";
  // A basemap is a picture rather than a colour, so the swatch says so instead
  // of claiming one of its colours stands for the whole thing.
  swatch.style.background =
    "linear-gradient(135deg, #1b3b5a 0%, #2f6d4f 45%, #b7a06a 75%, #f2f2f2 100%)";
  const copy = document.createElement("div");
  copy.className = "legend-symbol-copy";
  const label = document.createElement("div");
  label.className = "legend-symbol-label";
  label.textContent = base.streamed ? "streamed tiles" : "basemap";
  copy.appendChild(label);
  if (base.credit) {
    const detail = document.createElement("div");
    detail.className = "legend-symbol-detail";
    detail.textContent = base.credit;
    copy.appendChild(detail);
  }
  row.append(swatch, copy);
  list.appendChild(row);
  card.appendChild(list);
  return card;
}

/**
 * One imported layer as a legend card, in the same shape the viewer's overlay
 * legend emits, so the two read as one list rather than two conventions
 * stacked. Only drawn layers reach here -- see renderLegend.
 */
/**
 * What the swatch is a swatch OF — and it has to differ between layers.
 *
 * The dock dedupes cards by the labels they carry, because two sources can
 * publish the same legend and it should appear once. Every unclassified layer
 * said the same word — "layer" — so coastlines, rivers and a raster all keyed
 * as `symbols:layer` and collapsed into ONE card: three datasets on the globe,
 * one line in the legend, and no way to tell which one it was. Measured: four
 * layers loaded, two legend entries.
 *
 * So the label says what the row actually shows: what the layer is made of,
 * and failing that its own name, which is at least unique.
 */
function symbolLabel(layer) {
  if (layer.type) return layer.type;
  const summary = geometrySummary(layer.collection?.features || layer.features);
  if (summary) return summary;
  if (layer.raster && layer.info?.width && layer.info?.height) {
    return `${layer.info.width} x ${layer.info.height} raster`;
  }
  return layer.name || "layer";
}

/** A shape somebody drew on the globe, rather than a dataset they loaded. */
const isDrawnLayer = (layer) => layer?.ext === "drawn";

/** Rows shown before the list scrolls instead of growing the panel. */
const DRAWN_LEGEND_ROWS = 10;

/**
 * One card for every drawn shape, in the classed legend's own shape.
 *
 * Two details are load-bearing:
 *
 * - **The key is fixed** (`legendKey`), so drawing a shape is not an ARRIVAL.
 *   The dock springs the panel open when a key it has not seen appears, and a
 *   title carrying the count would be a new key on every capture -- the legend
 *   thrown open each time somebody drew a box, which is the annoyance the
 *   basemap card already documents. The first drawn shape still opens it,
 *   because that entry genuinely is new.
 * - **Past ten rows it scrolls** rather than growing. A drawn set has no upper
 *   bound and the panel does: without the cap, twenty shapes push the basemap
 *   and every dataset out of reach.
 */
function drawnAreasCard(layers) {
  const card = document.createElement("section");
  card.className = "legend-entry";
  card.dataset.legendKey = "Drawn areas";

  const badge = document.createElement("p");
  badge.className = "layer-type-badge";
  badge.textContent = layers.length === 1
    ? "Drawn area" : `Drawn areas (${layers.length})`;
  card.appendChild(badge);

  const block = document.createElement("div");
  block.className = "legend-classes";
  if (layers.length > DRAWN_LEGEND_ROWS) block.classList.add("is-scrolling");
  layers.forEach((layer) => {
    const line = document.createElement("div");
    line.className = "legend-class";
    const swatch = document.createElement("span");
    swatch.className = "legend-class-swatch";
    swatch.style.background = layerColour(layer);
    const text = document.createElement("span");
    text.className = "legend-class-label";
    text.textContent = layer.name || "drawn area";
    line.append(swatch, text);
    block.appendChild(line);
  });
  card.appendChild(block);
  return card;
}

function buildLayerCard(layer) {
  const name = layer.name || "layer";
  const card = document.createElement("section");
  card.className = "legend-entry";
  card.dataset.legendKey = name;

  const badge = document.createElement("p");
  badge.className = "layer-type-badge";
  // The file extension is how the layer arrived, not what it is. A key that
  // shouts ".TIF" tells the reader about plumbing while they are trying to
  // read a map.
  badge.textContent = name.replace(/\.(tif|tiff|geojson|json|shp|asc|kml|gpx|csv|wkt)$/i, "");
  card.appendChild(badge);

  /**
   * A layer that HAS a legend does not also get the stand-in row.
   *
   * The stand-in exists for a layer with no symbology at all — one swatch and
   * whatever the layer is made of, so the dock can still say something. The
   * moment a palette exists the classes below carry their own swatches and
   * their own names, and the stand-in becomes a row that says "8,101 lines"
   * beside a colour it does not describe. Reported as exactly that: the count
   * listed as a legend entry.
   *
   * It used to be suppressed only past two palette entries, on the reasoning
   * that a continuous ramp contradicts a single swatch — true, and it is just
   * as true of one class as of three.
   */
  const graded = Array.isArray(layer.legendInfo?.palette) && layer.legendInfo.palette.length > 0;
  const list = document.createElement("div");
  list.className = "legend-symbol-list";
  const row = document.createElement("div");
  row.className = "legend-symbol-row";
  const swatch = document.createElement("span");
  swatch.className = "legend-swatch";
  swatch.style.background = layerColour(layer);
  row.appendChild(swatch);
  const copyWrap = document.createElement("div");
  copyWrap.className = "legend-symbol-copy";
  const label = document.createElement("div");
  label.className = "legend-symbol-label";
  label.textContent = symbolLabel(layer);
  copyWrap.appendChild(label);
  row.appendChild(copyWrap);
  list.appendChild(row);
  if (!graded) card.appendChild(list);

  // Continuous data carries its ramp and what the ends mean, not just a name:
  // a legend that cannot be read against the map is furniture.
  const info = layer.legendInfo;
  /**
   * A classed legend is a list, not a gradient.
   *
   * The dock drew every legend as a ramp with its two ends labelled, which is
   * right for continuous data and wrong the moment the layer has classes: five
   * named bands rendered as a smooth bar say nothing about where one ends and
   * the next begins, and a class called "Moderate" had nowhere to appear at all.
   */
  if (info?.classed && Array.isArray(info.palette) && info.palette.length) {
    const block = document.createElement("div");
    block.className = "legend-classes";
    const unitText = info.unit ? ` ${info.unit}` : "";
    info.palette.forEach((colour, i) => {
      const line = document.createElement("div");
      line.className = "legend-class";
      const swatch = document.createElement("span");
      swatch.className = "legend-class-swatch";
      swatch.style.background = `#${String(colour).replace("#", "")}`;
      const text = document.createElement("span");
      text.className = "legend-class-label";
      const label = info.labels?.[i];
      text.textContent = (label === undefined || label === "" ? `Class ${i + 1}` : String(label))
        + (info.categorical ? "" : unitText);
      // The numeric range stays reachable even once the class has a name, so a
      // legend entry can still be checked against the data behind it.
      const bounds = info.bounds?.[i];
      const count = info.counts?.[i];
      text.title = [bounds ? `${bounds[0]} to ${bounds[1]}` : null,
        count != null ? `${Number(count).toLocaleString()} cells` : null]
        .filter(Boolean).join(" · ") || text.textContent;
      line.append(swatch, text);
      block.appendChild(line);
    });
    card.appendChild(block);
    return card;
  }
  if (info) {
    const ramp = Array.isArray(info.palette) && info.palette.length
      ? `linear-gradient(to right, ${info.palette.map((c) => `#${c}`).join(", ")})`
      : "linear-gradient(to right, #000, #fff)";
    const unit = info.unit ? ` ${info.unit}` : "";
    // The ends are pixel values, so they are read as numbers: 0.0000381 and
    // 3.75e-5 are the same measurement and only one of them can be compared
    // against the map at a glance.
    const num = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return String(v ?? "");
      const abs = Math.abs(n);
      if (n === 0) return "0";
      if (abs >= 1000 || abs < 0.01) return n.toPrecision(3);
      return String(Number(n.toPrecision(4)));
    };
    const block = document.createElement("div");
    block.className = "legend-ramp";
    const bar = document.createElement("span");
    bar.className = "legend-ramp-bar";
    bar.style.background = ramp;
    block.appendChild(bar);
    const labels = document.createElement("span");
    labels.className = "legend-ramp-labels";
    for (const text of [`${num(info.min)}${unit}`, info.label || "", `${num(info.max)}${unit}`]) {
      const span = document.createElement("span");
      span.textContent = text;
      labels.appendChild(span);
    }
    block.appendChild(labels);
    card.appendChild(block);
  }
  return card;
}

/** Whatever the layer is actually drawn in, so the key matches the map. */
/**
 * Linear light to sRGB, because that is what a vertex colour is stored as.
 *
 * `THREE.Color.set` converts on the way IN under colour management, so reading
 * the attribute back gives linear values and formatting them as hex reports
 * something far more saturated than what is drawn -- sRGB #ffbe28 reads back
 * as #ff8005. The events feed's colour probe already paid for this once.
 */
function linearToSrgbByte(value) {
  const c = Math.min(Math.max(Number(value) || 0, 0), 1);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * (c ** (1 / 2.4)) - 0.055;
  return Math.round(s * 255);
}

function hexOf(r, g, b) {
  return `#${[r, g, b].map((v) => linearToSrgbByte(v).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The colour a layer is actually DRAWN in.
 *
 * Read the GEOMETRY, not the material. `renderFeatureCollection` draws with
 * `vertexColors: true`, and a vertex-coloured material's own colour is WHITE --
 * it is the multiplier, not the paint. Reading it gave every drawn shape a
 * white swatch, so four study areas in the legend were four identical blank
 * boxes: the swatch column present, and carrying no information at all. This
 * file's own notes record the rule ("read the geometry, not the material") for
 * checking a paint; the legend was not following it.
 */
function layerColour(layer) {
  if (layer.colour || layer.color) return layer.colour || layer.color;
  let fromVertex = null;
  let fromMaterial = null;
  layer.object3D?.traverse?.((node) => {
    if (fromVertex) return;
    const attr = node.geometry?.attributes?.color;
    if (attr && attr.count > 0) {
      fromVertex = hexOf(attr.getX(0), attr.getY(0), attr.getZ(0));
      return;
    }
    if (fromMaterial) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    // A vertex-coloured material's white is a multiplier and not a colour, so
    // it is never the answer while a geometry further down may hold the paint.
    if (material?.color && !material.vertexColors) {
      fromMaterial = `#${material.color.getHexString()}`;
    }
  });
  return fromVertex || fromMaterial || "#52e4e8";
}

/**
 * Provenance for every active layer. Sources are whatever the adapter recorded
 * at import -- filename, format, CRS, feature or cell counts -- so a figure can
 * be traced back to what produced it.
 */
/**
 * What the PROJECT holds, above what this session holds.
 *
 * Provenance answered "where did this layer come from" and stopped there, so
 * from the map there was no way to see that the last tool wrote a file, that a
 * mesh exists, or that eleven datasets are already recorded — all of which the
 * Research Hub could see and the GIS could not.
 *
 * It goes HERE, in the group already called Project · Provenance, rather than
 * into a group of its own: the nav header names the open project, this panel
 * says what is in it, and one more top-level tab would have said neither
 * better.
 */
async function renderProjectContents(host) {
  let store = window.GeoIDResearch?.store;
  if (!store) return;
  const active = store.getActive?.();
  if (!active) return;
  let records = [];
  try {
    records = await store.listData();
  } catch (error) {
    return;
  }
  const counts = new Map();
  records.forEach((r) => {
    const kind = r?.kind || "other";
    counts.set(kind, (counts.get(kind) || 0) + 1);
  });
  const wrap = document.createElement("div");
  wrap.className = "meta-entry gis-project-contents";
  const title = document.createElement("b");
  title.textContent = active.meta?.name || active.folder || "project";
  wrap.appendChild(title);
  const line = document.createElement("span");
  line.innerHTML = `<i>Holds</i> ${counts.size
    ? [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(" · ")
    : "nothing recorded yet"}`;
  wrap.appendChild(line);
  // The newest few, each a way back onto the globe — the return path exists
  // and had no entry point from this side.
  records.slice()
    .sort((a, b) => String(b.registered_at || "").localeCompare(String(a.registered_at || "")))
    .slice(0, 4)
    .forEach((r) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "gis-tool-item";
      const name = document.createElement("b");
      name.textContent = r.name || r.path;
      const kind = document.createElement("span");
      kind.textContent = `${r.kind || "file"}${r.tool ? ` · ${r.tool}` : ""} — show on globe`;
      row.append(name, kind);
      row.addEventListener("click", () => window.GeoIDResearch?.bridge?.sendToGlobe?.(r));
      wrap.appendChild(row);
    });
  host.prepend(wrap);
}

function renderMetadata(stack) {
  const host = document.getElementById(METADATA_ID);
  if (!host) return;
  if (!stack.length) {
    host.textContent = "No layers loaded.";
    void renderProjectContents(host);
    return;
  }
  host.innerHTML = stack.map((layer) => {
    const meta = layer.metadata || {};
    /**
     * An ADOPTED layer states its provenance on `info` — that is the seam
     * `adoptLayer` takes and what the live feeds (events, satellites) fill
     * in. Reading only `metadata` meant the credits existed, were correct,
     * and were never shown: the Live events row said "Source: user import,
     * CRS: unstated" over a NASA feed. Both surfaces are read, metadata
     * first, so an import that states both is unchanged.
     */
    const info = layer.info || {};
    const bits = [
      ["Format", layer.format || meta.format || info.format || layer.type],
      ["Source", meta.source || info.source || layer.source || layer.fileName || "user import"],
      ["CRS", meta.crs || info.crs || layer.crs || "unstated"],
      ["Features", meta.featureCount ?? layer.featureCount],
      ["Cells", meta.cellCount ?? layer.cellCount],
      ["Imported", meta.importedAt || layer.importedAt],
      ["Citation", meta.citation || info.citation],
    ].filter(([, v]) => v !== undefined && v !== null && v !== "");
    return `<div class="meta-entry"><b>${layer.name || "layer"}</b>`
      + bits.map(([k, v]) => `<span><i>${k}</i> ${v}</span>`).join("")
      + `</div>`;
  }).join("");
  void renderProjectContents(host);
}

function copyCitations() {
  const text = ordered().map((layer) => {
    const meta = layer.metadata || {};
    const info = layer.info || {};
    return meta.citation || info.citation
      || `${layer.name || "layer"} — ${meta.source || info.source || layer.fileName || "user import"}`
        + `${meta.crs || info.crs ? ` (${meta.crs || info.crs})` : ""}`;
  }).join("\n");
  navigator.clipboard?.writeText(text);
}

function initDock() {
  const box = document.getElementById("layer-dock");
  // Its own box at the foot of the panel's column, not a section inside the
  // panel. Nothing to reparent -- but the panel has to be told how much room
  // it takes, or it would run underneath it. Published as a length on :root so
  // the panel's max-height is plain CSS; remeasured whenever the box changes
  // size, which is every load, removal and collapse.
  const panel = document.getElementById("ui");
  if (box && panel) {
    const measure = () => {
      const space = box.hidden || box.classList.contains("is-away")
        ? 0
        : box.getBoundingClientRect().height + 16; // the 1rem gap between them
      document.documentElement.style.setProperty("--layer-dock-space", `${space}px`);
    };
    new ResizeObserver(measure).observe(box);
    // ResizeObserver does not fire for a box going display:none and back, so
    // the attribute and class that hide it are watched too.
    new MutationObserver(measure).observe(box, {
      attributes: true,
      attributeFilter: ["hidden", "class"],
    });
    measure();
  }
  // The whole header toggles, the way a tab's summary does. The +/- marker is
  // drawn by the shared .section-toggle style, so there is no button to keep
  // in sync -- only the class and the state it announces.
  const head = box?.querySelector(".layer-dock-head");
  const flip = () => {
    const collapsed = box.classList.toggle("is-collapsed");
    head?.setAttribute("aria-expanded", collapsed ? "false" : "true");
  };
  head?.addEventListener("click", flip);
  head?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    flip();
  });
  // The dock follows the main panel: collapsing the tab bar to see the globe
  // should not leave a second box sitting over it. Carried on a class rather
  // than an inline style, so showing it again is the class going away and
  // cannot fight whatever else sets display.
  if (panel && box) {
    const sync = () => box.classList.toggle("is-away", panel.classList.contains("is-collapsed"));
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ["class"] });
    sync();
  }
}

function init() {
  injectStyle();
  initDock();
  document.getElementById("metadata-copy")?.addEventListener("click", copyCitations);
  // Reparenting the legend to <body> and opening it on click both moved to
  // legend-dock.js, which owns that drop-down now. Binding a second click
  // handler here would have toggled it twice per press -- open then shut in the
  // same event -- and it would have looked like the button had stopped working.
  // The import manager announces changes; fall back to a light poll so layers
  // added by other paths (the studio, extraction results) still show up.
  window.addEventListener("geoid-gis:layers-changed", render);
  // Choosing a different basemap changes the row's name and the legend's card,
  // so the list follows the dropdown as it follows everything else. The
  // viewer's own listener is registered first and swaps the texture; this only
  // redraws the description of what it did.
  // A timeout, not requestAnimationFrame: the viewer's own change listener runs
  // first and swaps the texture, and this only has to land after it. rAF would
  // do that too until the tab stops compositing, at which point the row silently
  // stops following the dropdown -- which is exactly how it was caught.
  document.getElementById("base-layer-select")?.addEventListener("change", () => {
    setTimeout(render, 0);
  });
  // Watched: how many layers there are, which basemap is drawn, and whether a
  // render has managed to land at all. The basemap is in there because the
  // viewer boots after this module and its first answer arrives without any
  // event -- the row would otherwise sit on the fallback name until something
  // else happened to redraw it.
  let lastSignature = null;
  const poll = () => {
    /**
     * The count is not enough: a layer appears in the list the moment the
     * import starts and gains its `object3D` a second or two later, and
     * `applyStack` skips a layer that has no object. So the stack was applied
     * while the new layer was still an empty row, the count never changed
     * again, and the layer kept `renderOrder` 0 — under the basemap, under
     * everything. Measured on a freshly added shapefile: geology 51, the
     * shapefile 0, and it only sorted itself out if something else happened to
     * redraw. Counting the layers that are actually DRAWABLE catches that
     * moment.
     */
    const built = layers().filter((layer) => layer.object3D).length;
    const signature = `${layers().length}|${built}|${window.GeoIDViewer?.getBaseLayerId?.() || ""}`;
    if (signature !== lastSignature || !mounted) { lastSignature = signature; render(); }
    window.setTimeout(poll, 700);
  };
  poll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDLayerHierarchy = { render, setOpacity, setVisible };
