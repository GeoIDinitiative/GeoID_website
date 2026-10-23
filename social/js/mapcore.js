/**
 * A light 2D equirectangular map on a canvas, drawn in the style of the old
 * Earth Explorer hero tile: a near-black sea, land as a faint blue wash with a
 * thin coast, a barely-there graticule and a dashed equator. Dark and
 * simplified on purpose -- the map's job is to show where PEOPLE are, and a
 * photographic basemap competed with every marker drawn on it.
 *
 * The coast is social/assets/coastline.json (175 KB), baked from Natural
 * Earth 1:10m by GeoID_GIS/services/bake-social-coastline.py: closed rings,
 * filled as land. If it fails to load, the graticule alone still locates.
 *
 * The view is a centre (lon, lat) and a zoom (1 = whole world fits the width).
 * Drag to pan, wheel or +/- to zoom, arrow keys to pan when focused.
 */
const COAST_URL = "/social/assets/coastline.json";
let coast = null;
let coastReady = null;

/** The hero tile's palette (page_backups/2026-08-14/earth_explorer). */
export const MAP_STYLE = {
  sea: "rgb(4, 8, 22)",
  land: "rgba(70, 120, 175, 0.14)",
  coast: "rgba(60, 110, 190, 0.55)",
  grid: "rgba(100, 120, 180, 0.08)",
  equator: "rgba(60, 200, 130, 0.22)",
  vignette: "rgba(4, 8, 18, 0.55)",
};

function loadCoast() {
  if (coastReady) return coastReady;
  coastReady = fetch(COAST_URL).then((r) => (r.ok ? r.json() : null)).then((lines) => {
    coast = Array.isArray(lines) ? lines : null;
    return coast;
  }).catch(() => null);
  return coastReady;
}

export function createMap(canvas, { onView, onClick, onDraw, minZoom = 1, maxZoom = 64 } = {}) {
  const ctx = canvas.getContext("2d");
  const view = { lon: 0, lat: 15, zoom: 1 };
  let w = 0; let hgt = 0; let dpr = 1;

  const scale = () => (w / 360) * view.zoom; // px per degree
  const project = (lon, lat) => [w / 2 + (lon - view.lon) * scale(), hgt / 2 - (lat - view.lat) * scale()];
  const unproject = (x, y) => [view.lon + (x - w / 2) / scale(), view.lat - (y - hgt / 2) / scale()];
  const clampView = () => {
    view.zoom = Math.max(minZoom, Math.min(maxZoom, view.zoom));
    const halfH = hgt / 2 / scale();
    const halfW = w / 2 / scale();
    view.lat = halfH >= 90 ? 0 : Math.max(-90 + halfH, Math.min(90 - halfH, view.lat));
    view.lon = halfW >= 180 ? 0 : Math.max(-180 + halfW, Math.min(180 - halfW, view.lon));
  };

  function bbox() {
    const [west, north] = unproject(0, 0);
    const [east, south] = unproject(w, hgt);
    return [Math.max(-180, west), Math.max(-90, south), Math.min(180, east), Math.min(90, north)];
  }

  function draw() {
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MAP_STYLE.sea;
    ctx.fillRect(0, 0, w, hgt);
    const [x0, y0] = project(-180, 90);
    const [x1, y1] = project(180, -90);
    // Graticule: every 30 deg, finer when zoomed; the equator dashed, as on the hero.
    const step = view.zoom >= 8 ? 5 : view.zoom >= 3 ? 10 : 30;
    ctx.strokeStyle = MAP_STYLE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += step) { const [x] = project(lon, 0); ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let lat = -90; lat <= 90; lat += step) { if (lat === 0) continue; const [, y] = project(0, lat); ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    if (coast) {
      // One path for all land: a single fill and a single stroke per frame.
      const land = new Path2D();
      for (const line of coast) {
        let [px, py] = project(line[0], line[1]);
        land.moveTo(px, py);
        for (let i = 2; i < line.length; i += 2) {
          [px, py] = project(line[i], line[i + 1]);
          land.lineTo(px, py);
        }
        land.closePath();
      }
      ctx.fillStyle = MAP_STYLE.land;
      ctx.fill(land, "evenodd");
      ctx.strokeStyle = MAP_STYLE.coast;
      ctx.lineWidth = view.zoom >= 4 ? 0.9 : 0.6;
      ctx.lineJoin = "round";
      ctx.stroke(land);
    }
    const [, ey] = project(0, 0);
    ctx.strokeStyle = MAP_STYLE.equator;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(x0, ey); ctx.lineTo(x1, ey); ctx.stroke();
    ctx.setLineDash([]);
    onDraw?.(ctx, { project, unproject, view, w, h: hgt });
    // Edge fades, as the hero tile had: the map dissolves into the panel.
    const fadeY = ctx.createLinearGradient(0, 0, 0, hgt);
    fadeY.addColorStop(0, MAP_STYLE.vignette); fadeY.addColorStop(0.12, "rgba(4,8,18,0)");
    fadeY.addColorStop(0.85, "rgba(4,8,18,0)"); fadeY.addColorStop(1, MAP_STYLE.vignette);
    ctx.fillStyle = fadeY; ctx.fillRect(0, 0, w, hgt);
    const fadeX = ctx.createLinearGradient(0, 0, w, 0);
    fadeX.addColorStop(0, "rgba(4,8,18,0.35)"); fadeX.addColorStop(0.08, "rgba(4,8,18,0)");
    fadeX.addColorStop(0.92, "rgba(4,8,18,0)"); fadeX.addColorStop(1, "rgba(4,8,18,0.35)");
    ctx.fillStyle = fadeX; ctx.fillRect(0, 0, w, hgt);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, rect.width); hgt = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
    clampView(); draw();
  }

  let viewTimer = null;
  const changed = () => {
    clampView(); draw();
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => onView?.({ ...view, bbox: bbox() }), 250);
  };

  // Pointer: drag pans, a click without a drag is a click.
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, lon: view.lon, lat: view.lat, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    view.lon = drag.lon - dx / scale(); view.lat = drag.lat + dy / scale();
    changed();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (drag && !drag.moved) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left; const y = e.clientY - rect.top;
      const [lon, lat] = unproject(x, y);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) onClick?.({ lon, lat, x, y });
    }
    drag = null;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const [lon, lat] = unproject(e.clientX - rect.left, e.clientY - rect.top);
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    view.zoom *= factor;
    clampView();
    // keep the point under the cursor fixed
    const [nx, ny] = project(lon, lat);
    view.lon += (nx - (e.clientX - rect.left)) / scale();
    view.lat -= (ny - (e.clientY - rect.top)) / scale();
    changed();
  }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const stepDeg = 40 / view.zoom;
    const keys = { ArrowLeft: [-stepDeg, 0], ArrowRight: [stepDeg, 0], ArrowUp: [0, stepDeg], ArrowDown: [0, -stepDeg] };
    if (keys[e.key]) { view.lon += keys[e.key][0]; view.lat += keys[e.key][1]; changed(); e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") { view.zoom *= 1.5; changed(); e.preventDefault(); }
    else if (e.key === "-" || e.key === "_") { view.zoom /= 1.5; changed(); e.preventDefault(); }
  });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  loadCoast().then(() => draw());
  resize();

  return {
    view, draw, project, unproject, bbox,
    zoomBy(f) { view.zoom *= f; changed(); },
    setView(lon, lat, zoom) { view.lon = lon; view.lat = lat; if (zoom) view.zoom = zoom; changed(); },
    destroy() { ro.disconnect(); clearTimeout(viewTimer); },
  };
}
