/**
 * A flat Web Mercator tile map on a canvas.
 *
 * The Map Composer page (`MapPage`, app_qt.py:21296) is a Leaflet map in the
 * desktop app. This is a canvas instead of a vendored Leaflet, for one decisive
 * reason: **Export PNG is the point of the page** — a figure-quality flat map
 * that goes to the Storyboard — and a canvas exports itself, while exporting a
 * Leaflet map means rasterising a tree of DOM tiles with a second library.
 * Leaflet is also UMD with its own CSS and image sprites, which does not fit a
 * tree of hand-vendored ES modules.
 *
 * What it owes Leaflet is only the tile scheme, which is a standard: Web
 * Mercator, 256px tiles, `{z}/{x}/{y}`.
 *
 * The globe is not a substitute for this. A GIS-page drape is the right way to
 * see where something is; a flat map is the right way to lay one out for print.
 */

import { BASEMAPS, ATTRIBUTION } from "../tile-sources.js?v=20260827-5faa79d";

// Re-exported because the Map Composer page imports the list from here; the
// list itself is shared with the globe drape so the two cannot drift.
export { BASEMAPS };

const TILE = 256;
const MAX_LAT = 85.0511287798;

export const lonToX = (lon) => (lon + 180) / 360;
export function latToY(lat) {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}
export const xToLon = (x) => x * 360 - 180;
export function yToLat(y) {
  const n = Math.PI * (1 - 2 * y);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function createMap(host, { basemap = "OpenStreetMap" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "map2d-canvas";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const state = {
    // Centre in normalised Mercator (0..1), and zoom as a tile level.
    cx: 0.5, cy: 0.5, zoom: 2,
    basemap, layers: [], tiles: new Map(), pending: new Set(),
  };

  function size() {
    const rect = host.getBoundingClientRect();
    const width = Math.max(64, Math.round(rect.width));
    const height = Math.max(64, Math.round(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height };
  }

  /** World size in pixels at the current zoom. */
  const scale = () => TILE * 2 ** state.zoom;

  function project(lon, lat) {
    const { width, height } = size();
    const s = scale();
    return [
      (lonToX(lon) - state.cx) * s + width / 2,
      (latToY(lat) - state.cy) * s + height / 2,
    ];
  }

  function unproject(px, py) {
    const { width, height } = size();
    const s = scale();
    return [
      xToLon((px - width / 2) / s + state.cx),
      yToLat((py - height / 2) / s + state.cy),
    ];
  }

  /**
   * Fetch a tile.
   *
   * `crossOrigin = "anonymous"` matters more than it looks: without it the
   * canvas is tainted the moment a tile is drawn and `toBlob` throws a
   * SecurityError — which would take Export PNG, the reason this page exists,
   * with it.
   */
  function tile(url) {
    if (state.tiles.has(url)) return state.tiles.get(url);
    if (state.pending.has(url)) return null;
    state.pending.add(url);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.addEventListener("load", () => {
      state.pending.delete(url);
      state.tiles.set(url, image);
      if (state.tiles.size > 600) {
        // Oldest first; a long pan should not grow without bound.
        const oldest = state.tiles.keys().next().value;
        state.tiles.delete(oldest);
      }
      draw();
    });
    image.addEventListener("error", () => {
      state.pending.delete(url);
      state.tiles.set(url, null);   // remembered, so it is not retried forever
    });
    image.src = url;
    return null;
  }

  function tileUrl(template, z, x, y) {
    return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  }

  function drawTiles(template, opacity = 1) {
    if (!template) return;
    const { width, height } = size();
    const z = Math.round(state.zoom);
    const count = 2 ** z;
    const s = TILE * count;
    const originX = state.cx * s - width / 2;
    const originY = state.cy * s - height / 2;
    const first = Math.floor(originX / TILE);
    const last = Math.floor((originX + width) / TILE);
    const top = Math.floor(originY / TILE);
    const bottom = Math.floor((originY + height) / TILE);
    // The canvas is drawn at the rounded zoom and then scaled, so a fractional
    // zoom stays smooth instead of snapping.
    const zoomScale = 2 ** (state.zoom - z);

    ctx.save();
    ctx.globalAlpha = opacity;
    for (let x = first; x <= last; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        if (y < 0 || y >= count) continue;
        const wrapped = ((x % count) + count) % count;
        const image = tile(tileUrl(template, z, wrapped, y));
        if (!image) continue;
        const px = (x * TILE - originX) * zoomScale + (width / 2) * (1 - zoomScale);
        const py = (y * TILE - originY) * zoomScale + (height / 2) * (1 - zoomScale);
        ctx.drawImage(image, px, py, TILE * zoomScale + 1, TILE * zoomScale + 1);
      }
    }
    ctx.restore();
  }

  function drawLayer(layer) {
    if (!layer.visible) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.strokeStyle = layer.colour;
    ctx.fillStyle = layer.colour;
    ctx.lineWidth = 1.6;

    if (layer.type === "wms") {
      ctx.restore();
      drawTiles(layer.template, layer.opacity ?? 1);
      return;
    }

    if (layer.type === "points" || layer.type === "marker") {
      (layer.points || []).forEach(([lon, lat]) => {
        const [px, py] = project(lon, lat);
        ctx.beginPath();
        ctx.arc(px, py, layer.type === "marker" ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (layer.type === "bbox") {
      const [x0, y0] = project(layer.bbox[0], layer.bbox[3]);
      const [x1, y1] = project(layer.bbox[2], layer.bbox[1]);
      ctx.globalAlpha = (layer.opacity ?? 1) * 0.22;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = layer.opacity ?? 1;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }

    if (layer.type === "geojson") {
      (layer.shapes || []).forEach((shape) => {
        if (shape.kind === "point") {
          const [px, py] = project(shape.coords[0], shape.coords[1]);
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        (shape.rings || []).forEach((ring) => {
          ctx.beginPath();
          ring.forEach(([lon, lat], i) => {
            const [px, py] = project(lon, lat);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          if (shape.kind === "polygon") {
            ctx.closePath();
            ctx.globalAlpha = (layer.opacity ?? 1) * 0.25;
            ctx.fill();
            ctx.globalAlpha = layer.opacity ?? 1;
          }
          ctx.stroke();
        });
      });
    }
    ctx.restore();
  }

  let frame = null;
  function draw() {
    frame = null;
    const { width, height } = size();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0b0d1a";
    ctx.fillRect(0, 0, width, height);
    drawTiles(BASEMAPS[state.basemap]);
    // Bottom of the list draws first, so the top entry is the top layer --
    // which is what a layer panel means by "up".
    for (let i = state.layers.length - 1; i >= 0; i -= 1) drawLayer(state.layers[i]);
    ctx.fillStyle = "rgba(220,230,255,0.55)";
    ctx.font = "10px 'Exo 2', system-ui, sans-serif";
    ctx.textAlign = "right";
    // The credit has to be readable in full to count as attribution, and the
    // topo line names fifteen agencies -- one line ran off the left edge of the
    // canvas and off the exported PNG with it. So wrap instead of truncating.
    const lines = wrapToWidth(attribution(), width - 16);
    lines.forEach((line, i) => {
      ctx.fillText(line, width - 8, height - 7 - (lines.length - 1 - i) * 11);
    });
  }

  /** Greedy word wrap against the measured width of the current font. */
  function wrapToWidth(text, maxWidth) {
    const words = String(text).split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function attribution() {
    return ATTRIBUTION[state.basemap] || "© OpenStreetMap contributors";
  }

  function schedule() {
    if (frame === null) frame = requestAnimationFrame(draw);
  }

  // ── Interaction ───────────────────────────────────────────────────────────
  let dragging = null;
  canvas.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const s = scale();
    state.cx -= (event.clientX - dragging.x) / s;
    state.cy -= (event.clientY - dragging.y) / s;
    state.cy = Math.max(0, Math.min(1, state.cy));
    dragging = { x: event.clientX, y: event.clientY };
    schedule();
  });
  const endDrag = () => { dragging = null; };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    // Zoom about the cursor, so the point under it stays put.
    const rect = canvas.getBoundingClientRect();
    const [lon, lat] = unproject(event.clientX - rect.left, event.clientY - rect.top);
    const before = { x: lonToX(lon), y: latToY(lat) };
    state.zoom = Math.max(1, Math.min(19, state.zoom - Math.sign(event.deltaY) * 0.4));
    const { width, height } = size();
    const s = scale();
    state.cx = before.x - ((event.clientX - rect.left) - width / 2) / s;
    state.cy = before.y - ((event.clientY - rect.top) - height / 2) / s;
    schedule();
  }, { passive: false });

  const observer = new ResizeObserver(schedule);
  observer.observe(host);
  schedule();

  return {
    canvas,
    state,
    redraw: schedule,
    setBasemap(name) { state.basemap = name; schedule(); },
    setLayers(layers) { state.layers = layers; schedule(); },
    onClick(fn) {
      canvas.addEventListener("click", (event) => {
        const rect = canvas.getBoundingClientRect();
        fn(unproject(event.clientX - rect.left, event.clientY - rect.top));
      });
    },
    /** Fit the view to a bounding box, as Leaflet's fitBounds does. */
    fit([west, south, east, north]) {
      const x0 = lonToX(west);
      const x1 = lonToX(east);
      const y0 = latToY(north);
      const y1 = latToY(south);
      state.cx = (x0 + x1) / 2;
      state.cy = (y0 + y1) / 2;
      const { width, height } = size();
      const spanX = Math.max(1e-6, x1 - x0);
      const spanY = Math.max(1e-6, y1 - y0);
      state.zoom = Math.max(1, Math.min(19,
        Math.log2(Math.min(width / (TILE * spanX), height / (TILE * spanY))) - 0.2));
      schedule();
    },
    /** Every tile that is still loading, so an export can wait for them. */
    settled() {
      return new Promise((resolve) => {
        const check = () => {
          if (!state.pending.size) { draw(); resolve(); return; }
          setTimeout(check, 120);
        };
        check();
      });
    },
    destroy() { observer.disconnect(); },
  };
}
