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

import { currentBody } from "./bodies.js?v=20260808-16f4ac6";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260808-16f4ac6";

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
  node.innerHTML = `
    <button class="layer-grip" type="button" title="Drag to reorder" aria-hidden="true">⋮⋮</button>
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
  stack.forEach((layer) => panel.appendChild(row(layer)));
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
  const host = document.getElementById("map-legend");
  const panel = document.getElementById("map-legend-panel");
  if (!host || !panel) return;
  host.hidden = stack.length === 0;
  // Announced on <body> so the events feed can sit beside the legend when it is
  // there and take its place when it is not, without either knowing about the
  // other's markup.
  document.body.dataset.legend = stack.length ? "true" : "false";
  if (!stack.length) {
    panel.hidden = true;
    document.getElementById("map-legend-toggle")?.setAttribute("aria-expanded", "false");
    return;
  }
  panel.innerHTML = stack.map((layer) => {
    const colour = layerColour(layer);
    const hidden = layer.visible === false ? " is-hidden" : "";
    const head = `<div class="legend-entry${hidden}">`
      + `<span class="legend-swatch" style="background:${colour}"></span>`
      + `<span class="legend-name" title="${layer.name || "layer"}">${layer.name || "layer"}</span>`
      + `<span class="legend-kind">${layer.type || ""}</span>`
      + `</div>`;
    // Continuous data carries its ramp and what the ends mean, not just a
    // name: a legend that cannot be read against the map is furniture.
    const info = layer.legendInfo;
    if (!info) return head;
    const ramp = Array.isArray(info.palette) && info.palette.length
      ? `linear-gradient(to right, ${info.palette.map((c) => `#${c}`).join(", ")})`
      : "linear-gradient(to right, #000, #fff)";
    const unit = info.unit ? ` ${info.unit}` : "";
    return head
      + `<div class="legend-ramp${hidden}">`
      + `<span class="legend-ramp-bar" style="background:${ramp}"></span>`
      + `<span class="legend-ramp-labels"><span>${info.min}${unit}</span>`
      + `<span>${info.label || ""}</span><span>${info.max}${unit}</span></span>`
      + `</div>`;
  }).join("");
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
  initDock();
  document.getElementById("metadata-copy")?.addEventListener("click", copyCitations);
  // The legend is an overlay on the scene, so it must hang off <body>: parsed
  // where it sits in the markup it can end up nested inside another control,
  // where fixed positioning and its own styling do not apply.
  const legend = document.getElementById("map-legend");
  if (legend && legend.parentElement !== document.body) {
    document.body.appendChild(legend);
  }
  const toggle = document.getElementById("map-legend-toggle");
  toggle?.addEventListener("click", () => {
    const panel = document.getElementById("map-legend-panel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
  });
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
