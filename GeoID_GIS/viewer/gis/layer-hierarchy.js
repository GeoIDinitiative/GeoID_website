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

import { currentBody } from "./bodies.js?v=20260815-0887cf5";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260815-0887cf5";

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
  border-radius: 0.55rem;
  border-color: rgba(var(--nav-accent-rgb), 0.28);
}
#layer-dock .layer-dock-head {
  min-height: 2.1rem;
  padding: 0.4rem 0.6rem;
  background: rgba(255, 255, 255, 0.025);
  border-left: 0;
  border-bottom: 1px solid rgba(var(--nav-accent-rgb), 0.18);
}
#layer-dock .layer-dock-head:hover {
  background: rgba(var(--nav-accent-rgb), 0.08);
  box-shadow: none;
}
/* The groups above draw a +/- through .section-toggle::after. This has its own
   caret, on the other side of the head, so the two are not mistaken for the
   same control. */
/* Matched to the specificity of the pair in shell.css that draws the +/- here
   -- #layer-dock:not(.is-collapsed) > .layer-dock-head::after -- since a
   shorter selector loses to them and leaves the tab marker in place. */
#layer-dock:not(.is-collapsed) > .layer-dock-head::after,
#layer-dock.is-collapsed > .layer-dock-head::after {
  content: "▾";
  margin-left: auto;
  color: rgba(var(--nav-accent-rgb), 0.75);
  font-size: 0.62rem;
  transition: transform 0.2s ease;
}
#layer-dock.is-collapsed > .layer-dock-head::after { transform: rotate(-90deg); }
#layer-dock .layer-dock-head .section-title {
  font-family: inherit;
  font-weight: 500;
  font-size: 0.68rem;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--muted) !important;
  text-shadow: none !important;
}
#layer-dock .layer-dock-head .section-icon { color: rgba(var(--nav-accent-rgb), 0.7) !important; }
/* Seven columns now: grip, disclosure, eye, name, kind, opacity, moves. */
.layer-stack .layer-row {
  grid-template-columns: auto auto auto 1fr auto 4.5rem auto;
}
.layer-grip { letter-spacing: -0.08em; }

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
  /* One line: the detail, then the actions. A wrapped tile pushed the rows
     below it down every time one was opened, which made a list of layers jump
     about while you were reading it. */
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin: -0.15rem 0 0.15rem 1.35rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.45);
  border-top-color: transparent;
  border-radius: 0 0 0.45rem 0.45rem;
  background: #000;
  font-size: 0.66rem;
}
/* The one thing that may be shortened: the buttons must stay whole and
   readable, and the detail repeats what the layer's own row already says. */
.layer-options-detail {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 0.6rem;
}
/* Centred, and equal: the three are alternatives to one another, so none of
   them leads. */
.layer-options-actions {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  gap: 0.25rem;
  flex: 0 0 auto;
}
.layer-props-inline {
  margin: -0.15rem 0 0.15rem 1.35rem;
  padding: 0.5rem 0.55rem 0.6rem;
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
  padding: 0.18rem 0.4rem;
  border-radius: 0.35rem;
  font-size: 0.6rem;
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
function ordered() {
  const list = layers();
  list.forEach((layer, i) => {
    if (!Number.isFinite(layer.stackIndex)) layer.stackIndex = i;
  });
  return [...list].sort((a, b) => b.stackIndex - a.stackIndex);
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
    object.traverse?.((node) => {
      if (node.material) node.renderOrder = object.renderOrder;
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
      // Only switch on blending when it is actually needed: transparent
      // materials are sorted separately and cost more to draw.
      material.transparent = value < 0.999;
      material.opacity = value;
      material.depthWrite = value >= 0.999;
      material.needsUpdate = true;
    });
  });
}

function setVisible(layer, visible) {
  layer.visible = visible;
  if (layer.object3D) layer.object3D.visible = visible;
}

function move(id, delta) {
  const stack = ordered();
  const from = stack.findIndex((l) => l.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= stack.length) return;
  const moved = stack.splice(from, 1)[0];
  stack.splice(to, 0, moved);
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
  const moved = stack.splice(from, 1)[0];
  stack.splice(to, 0, moved);
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
    <span class="layer-name" title="${layer.name || "layer"}">${layer.name || "layer"}</span>
    <span class="layer-kind">${layer.type || ""}</span>
    <input class="layer-opacity" type="range" min="0" max="1" step="0.05"
      value="${opacity}" data-role="opacity" title="Transparency">
    <span class="layer-moves">
      <button type="button" data-role="up" title="Move up">▲</button>
      <button type="button" data-role="down" title="Move down">▼</button>
    </span>`;

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
  // is not something you act on, which is what this tile is for.
  if (what) {
    const detail = document.createElement("span");
    detail.className = "layer-options-detail";
    detail.textContent = what;
    tile.appendChild(detail);
  }

  const actions = document.createElement("div");
  actions.className = "layer-options-actions";

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
  act("Export", () => window.GeoIDLayerExport?.open?.(layer));

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

export function render() {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
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
  node.innerHTML = `
    <span class="layer-grip" aria-hidden="true"></span>
    <label class="layer-eye" title="Visible">
      <input type="checkbox" ${visible ? "checked" : ""} data-role="visible">
    </label>
    <span class="layer-name">${currentBody()?.name || "Earth"} basemap</span>
    <span class="layer-kind">default</span>`;
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
 * an empty legend is just furniture -- and it keeps hidden layers listed but
 * dimmed, so turning one off does not make it vanish from the key as well.
 */
function renderLegend(stack) {
  // The drop-down is shared now -- imported layers are one source in it beside
  // the viewer's overlays and the interior cutaway -- so this hands over cards
  // instead of owning the panel. Whether it is shown, and whether it opens, is
  // the dock's to decide once it knows about every source.
  const dock = window.GeoIDLegendDock;
  if (!dock) return;
  dock.publish("layers", stack.map((layer) => buildLayerCard(layer)));
}

/**
 * One imported layer as a legend card, in the same shape the viewer's overlay
 * legend emits, so the two read as one list rather than two conventions
 * stacked. Hidden layers stay listed but dimmed: switching a layer off should
 * not also delete it from the key.
 */
function buildLayerCard(layer) {
  const name = layer.name || "layer";
  const card = document.createElement("section");
  card.className = `legend-entry${layer.visible === false ? " is-hidden" : ""}`;
  card.dataset.legendKey = name;

  const badge = document.createElement("p");
  badge.className = "layer-type-badge";
  badge.textContent = name;
  card.appendChild(badge);

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
  label.textContent = layer.type || "layer";
  copyWrap.appendChild(label);
  if (layer.visible === false) {
    const detail = document.createElement("div");
    detail.className = "legend-symbol-detail";
    detail.textContent = "hidden";
    copyWrap.appendChild(detail);
  }
  row.appendChild(copyWrap);
  list.appendChild(row);
  card.appendChild(list);

  // Continuous data carries its ramp and what the ends mean, not just a name:
  // a legend that cannot be read against the map is furniture.
  const info = layer.legendInfo;
  if (info) {
    const ramp = Array.isArray(info.palette) && info.palette.length
      ? `linear-gradient(to right, ${info.palette.map((c) => `#${c}`).join(", ")})`
      : "linear-gradient(to right, #000, #fff)";
    const unit = info.unit ? ` ${info.unit}` : "";
    const block = document.createElement("div");
    block.className = "legend-ramp";
    const bar = document.createElement("span");
    bar.className = "legend-ramp-bar";
    bar.style.background = ramp;
    block.appendChild(bar);
    const labels = document.createElement("span");
    labels.className = "legend-ramp-labels";
    for (const text of [`${info.min}${unit}`, info.label || "", `${info.max}${unit}`]) {
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
function layerColour(layer) {
  if (layer.colour || layer.color) return layer.colour || layer.color;
  let found = null;
  layer.object3D?.traverse?.((node) => {
    if (found) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    if (material?.color) found = `#${material.color.getHexString()}`;
  });
  return found || "#52e4e8";
}

/**
 * Provenance for every active layer. Sources are whatever the adapter recorded
 * at import -- filename, format, CRS, feature or cell counts -- so a figure can
 * be traced back to what produced it.
 */
function renderMetadata(stack) {
  const host = document.getElementById(METADATA_ID);
  if (!host) return;
  if (!stack.length) {
    host.textContent = "No layers loaded.";
    return;
  }
  host.innerHTML = stack.map((layer) => {
    const meta = layer.metadata || {};
    const bits = [
      ["Format", layer.format || meta.format || layer.type],
      ["Source", meta.source || layer.source || layer.fileName || "user import"],
      ["CRS", meta.crs || layer.crs || "unstated"],
      ["Features", meta.featureCount ?? layer.featureCount],
      ["Cells", meta.cellCount ?? layer.cellCount],
      ["Imported", meta.importedAt || layer.importedAt],
      ["Citation", meta.citation],
    ].filter(([, v]) => v !== undefined && v !== null && v !== "");
    return `<div class="meta-entry"><b>${layer.name || "layer"}</b>`
      + bits.map(([k, v]) => `<span><i>${k}</i> ${v}</span>`).join("")
      + `</div>`;
  }).join("");
}

function copyCitations() {
  const text = ordered().map((layer) => {
    const meta = layer.metadata || {};
    return meta.citation
      || `${layer.name || "layer"} — ${meta.source || layer.fileName || "user import"}`
        + `${meta.crs ? ` (${meta.crs})` : ""}`;
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
  let lastCount = -1;
  const poll = () => {
    const n = layers().length;
    if (n !== lastCount) { lastCount = n; render(); }
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
