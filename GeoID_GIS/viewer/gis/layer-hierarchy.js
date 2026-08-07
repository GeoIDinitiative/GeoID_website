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

import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260807d";

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

function applyStack() {
  const stack = ordered();
  stack.forEach((layer, i) => {
    const object = layer.object3D;
    if (!object) return;
    // Top of the list draws last, so it wins where layers overlap.
    object.renderOrder = stack.length - i;
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
  node.draggable = true;
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

  node.addEventListener("dragstart", () => { dragId = layer.id; node.classList.add("is-dragging"); });
  node.addEventListener("dragend", () => { dragId = null; node.classList.remove("is-dragging"); });
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
  if (!stack.length) {
    panel.innerHTML = '<p class="gis-hint">No layers loaded.</p>';
  } else {
    stack.forEach((layer) => panel.appendChild(row(layer)));
  }
  applyStack();
  renderMetadata(stack);
  renderLegend(stack);
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
    return `<div class="legend-entry${hidden}">`
      + `<span class="legend-swatch" style="background:${colour}"></span>`
      + `<span class="legend-name" title="${layer.name || "layer"}">${layer.name || "layer"}</span>`
      + `<span class="legend-kind">${layer.type || ""}</span>`
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

function init() {
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
