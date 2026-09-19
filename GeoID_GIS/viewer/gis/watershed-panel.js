/**
 * Hazards ▸ Flood ▸ Watershed and runoff.
 *
 * Pick an outlet, and the catchment that drains to it is extracted from the
 * streamed DEM at the finest level the box allows, with its channel network,
 * its flow vectors and its statistics. Then a storm is run through it: the SCS
 * curve number decides how much of the rain runs off, every cell's travel time
 * to the outlet delays it, and the outlet hydrograph is drawn. The runoff is
 * also SHOWN as vectors: particles released where and when the rain runs off,
 * carried down the D8 paths at each cell's own velocity, arriving at the
 * outlet in step with the hydrograph's marker.
 *
 * THE BOX GROWS UNTIL THE BASIN IS WHOLE. A catchment that reaches the edge of
 * the DEM it was extracted from is a catchment cut at an arbitrary line, and
 * its area, its time of concentration and its hydrograph are all wrong in the
 * same direction. The box doubles and the extraction runs again until the
 * basin sits inside it or the search limit is reached — and then the panel
 * says the basin was clipped rather than presenting a part as the whole.
 *
 * The pure half is catchment.js, tested against closed forms.
 */

import {
  fill, d8, accumulate, snapOutlet, upstreamMask, touchesEdge, traceOutline, streamNetwork,
  velocities, travelToOutlet, excessSeries, timeAreaHydrograph, catchmentStats, cellMetres, cellOf,
  centreOf, downstream, OVERLAND_K, NEIGHBOURS,
} from "./catchment.js?v=20260919-b0ce896";
import { demGridFor } from "./landslide-pipeline.js?v=20260919-b0ce896";
import { waterMasks, waterFeatures } from "./water-mask.js?v=20260919-b0ce896";
import { burnRivers } from "./river-zones.js?v=20260919-b0ce896";

const search = new URL(import.meta.url).search;
const byId = (id) => document.getElementById(id);
const PREFIX = "Watershed";
const NAMES = {
  catchment: "Watershed — catchment",
  streams: "Watershed — stream network",
  vectors: "Watershed — flow vectors",
  particles: "Watershed — runoff (animated)",
};
const ORDER_COLOURS = ["#9ad9ff", "#52b6ff", "#2f7dff", "#2a52d9", "#3a2fb8", "#5a1f9e", "#7a1580", "#9e0e5f"];
/** How far a mapped river is cut into the DEM before routing, in metres. */
const RIVER_BURN_M = 20;
const TRAVEL_COLOURS = ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];

const state = {
  outlet: null,        // { lat, lon } as clicked
  result: null,        // the extraction
  runoff: null,        // the hydrograph
  sim: null,           // the particle simulation
  busy: false,
};

/* ── small DOM helpers in the sidebar's own idiom ────────────────────────── */

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c != null && node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}
const row = (label, control, title) => h("div", { class: "row", title }, h("label", { for: control.id, text: label }), control);
const num = (id, value, { min, max, step = "any", label } = {}) => h("input", { id, class: "input", type: "number", value, min, max, step, "aria-label": label });
const say = (id, message) => { const n = byId(id); if (n) n.textContent = message || ""; };
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "—");
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ── the outlet ─────────────────────────────────────────────────────────── */

let picking = false;
function armPick(button) {
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (!canvas) { say("ws-status", "The globe is not ready yet."); return; }
  if (picking) return;
  picking = true;
  const was = button.textContent;
  button.textContent = "Click the outlet on the map…";
  button.classList.remove("secondary");
  let down = null;
  const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
  const finish = () => {
    picking = false;
    button.textContent = was;
    button.classList.add("secondary");
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    document.removeEventListener("keydown", onKey, true);
  };
  // A pointerup with a drag gate, never stopPropagation: OrbitControls needs
  // to see the release or it stays latched in rotate.
  const onUp = (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const at = window.GeoIDViewer?.surfaceLatLonAt?.(e.clientX, e.clientY);
    if (!at) return;
    window.GeoIDFeaturePopup?.suppress?.(800);
    finish();
    setOutlet({ lat: at.lat, lon: at.lon > 180 ? at.lon - 360 : at.lon });
  };
  const onKey = (e) => { if (e.key === "Escape") finish(); };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  document.addEventListener("keydown", onKey, true);
}

function setOutlet(at) {
  state.outlet = at;
  say("ws-outlet", `Outlet clicked at ${at.lat.toFixed(4)}°, ${at.lon.toFixed(4)}°.`);
  const go = byId("ws-extract");
  if (go) go.disabled = false;
}

/* ── extraction ─────────────────────────────────────────────────────────── */

function boxAround({ lat, lon }, halfKm) {
  const dLat = halfKm / 110.574;
  const dLon = halfKm / (111.32 * Math.cos(lat * Math.PI / 180));
  return { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat };
}

async function extract() {
  if (state.busy || !state.outlet) return;
  state.busy = true;
  stopSim();
  const btn = byId("ws-extract");
  if (btn) btn.disabled = true;
  try {
    const snapM = Math.max(0, Number(byId("ws-snap").value) || 0);
    const channelKm2 = Math.max(0.01, Number(byId("ws-channel").value) || 0.5);
    const maxHalf = Math.max(1, Number(byId("ws-search").value) || 30) / 2;
    const maxCells = 700000;
    const dem = window.GeoIDDem;
    const heightAt = (la, lo) => {
      const v = dem?.heightAt?.(la, lo);
      return Number.isFinite(v) ? v : window.GeoIDViewer?.sampleElevationMeters?.(la, lo);
    };
    let halfKm = Math.min(maxHalf, 2.5);
    let pass = 0;
    let out = null;
    for (;;) {
      pass += 1;
      const box = boxAround(state.outlet, halfKm);
      say("ws-status", `Pass ${pass}: reading the DEM over ${fmt(halfKm * 2, 1)} km…`);
      let label = "the viewer's elevation model";
      let post = null;
      if (dem?.ensure) {
        const got = await dem.ensure(box, { maxTiles: 256 });
        if (got?.ok) {
          post = dem.metresPerPixel(got.zoom, state.outlet.lat);
          label = `streamed DEM, zoom ${got.zoom} (${Math.round(post)} m posts)`;
        }
      }
      await tick();
      const grid = demGridFor(box, heightAt, { maxCells, minStepM: post ? Math.max(5, post) : 20 });
      const heights = Float32Array.from(grid.band);
      if (!grid.known) throw new Error("There is no elevation under that outlet.");
      /**
       * THE SEA IS NOT GROUND. A coastal outlet at −1 m otherwise takes the flat
       * sea surface as land, fills it, routes it into the outlet and returns a
       * catchment several times too big that runs off the edge of every box
       * (measured on the Shimna at Newcastle: 160 km², clipped, against ~50).
       * Ocean cells become no-data, so the coast is where water leaves. The
       * mapped rivers (GRWL) are burned in, so a floodplain's drainage follows
       * the channel that is really there rather than the DEM's guess beside it.
       */
      let seaCells = 0; let burned = 0;
      try {
        say("ws-status", `Pass ${pass}: masking the sea and burning in the mapped rivers…`);
        const [water, rivers] = await Promise.all([
          waterMasks(box, grid.width, grid.height),
          waterFeatures("rivers", box, grid.width).catch(() => null),
        ]);
        for (let i = 0; i < grid.band.length; i += 1) if (water.ocean[i]) { grid.band[i] = NaN; seaCells += 1; }
        if (rivers?.features?.length) {
          const { riverWidth } = burnRivers(rivers.features, box, grid.width, grid.height);
          for (let i = 0; i < grid.band.length; i += 1) {
            if (riverWidth[i] > 0 && Number.isFinite(grid.band[i])) { grid.band[i] -= RIVER_BURN_M; burned += 1; }
          }
        }
      } catch (error) { /* no water service: the DEM's own drainage stands */ }
      say("ws-status", `Pass ${pass}: routing the flow on a ${grid.width} × ${grid.height} grid at ${grid.stepM} m…`);
      await tick();
      const cm = cellMetres(grid);
      const filled = fill(grid);
      const flow = d8(filled, grid.width, grid.height, cm);
      const acc = accumulate(flow, grid.width, grid.height);
      const c = cellOf(grid, state.outlet.lat, state.outlet.lon);
      if (!c) throw new Error("The outlet is outside the DEM.");
      const radius = snapM / Math.min(cm.x, cm.y);
      const outlet = snapOutlet(acc, grid.width, grid.height, c.x, c.y, radius);
      const { mask, cells } = upstreamMask(flow, grid.width, grid.height, outlet);
      const edge = touchesEdge(mask, grid.width, grid.height);
      out = { grid, heights, cm, filled, flow, acc, outlet, mask, cells, edge, halfKm, label, post, seaCells, burned };
      if (edge && halfKm < maxHalf) { halfKm = Math.min(maxHalf, halfKm * 2); continue; }
      break;
    }
    const { grid, cm, flow, acc, outlet, mask } = out;
    const thresholdCells = Math.max(4, Math.round((channelKm2 * 1e6) / (cm.x * cm.y)));
    const net = streamNetwork(flow, acc, mask, grid, thresholdCells);
    const vel = velocities(flow, net.isStream, { overlandK: overlandK(), channelV: channelV() });
    const travel = travelToOutlet(flow, mask, grid.width, outlet, vel);
    // Relief and the path's drop are read on the heights as surveyed, not on
    // the surface with the rivers cut into it.
    const stats = catchmentStats({ ...grid, band: out.heights }, out.filled, flow, mask, outlet, travel);
    const snapped = centreOf(grid, outlet);
    state.result = { ...out, net, vel, travel, stats, snapped, thresholdCells };
    state.runoff = null;
    await drawLayers();
    renderResult();
    // A click a little off the channel snaps to whatever drains most within
    // the radius, which may be a scrap of hillside. Say so rather than present
    // a tenth of a square kilometre as the river's catchment.
    const tiny = stats.areaKm2 < Math.max(1, channelKm2 * 2);
    say("ws-status", out.edge
      ? `The basin reaches the edge of the ${fmt(out.halfKm * 2, 0)} km search box, so it is CLIPPED — raise “Search up to” for the whole catchment.`
      : tiny
        ? `Only ${fmt(stats.areaKm2, 2)} km² drains here — no channel lies within ${fmt(snapM, 0)} m of the click. Click nearer the river, or raise the snap radius.`
        : `Extracted in ${pass} pass${pass === 1 ? "" : "es"} from the ${out.label}${out.seaCells ? "; the sea masked" : ""}${out.burned ? "; mapped rivers burned in" : ""}.`);
    const run = byId("ws-run");
    if (run) run.disabled = false;
  } catch (error) {
    say("ws-status", `Could not extract the watershed: ${error.message}`);
  } finally {
    state.busy = false;
    if (btn) btn.disabled = !state.outlet;
  }
}

function overlandK() { return OVERLAND_K[byId("ws-surface")?.value] ?? OVERLAND_K.unpaved; }
function channelV() { return Math.max(0.1, Number(byId("ws-channel-v")?.value) || 1.5); }

function renderResult() {
  const r = state.result;
  const host = byId("ws-result");
  if (!host || !r) return;
  const s = r.stats;
  const tcModelMin = r.stats && Number.isFinite(r.travel.time[s.sourceCell]) ? r.travel.time[s.sourceCell] / 60 : NaN;
  host.replaceChildren(
    h("p", { class: "compact-copy", style: "margin:0.35rem 0 0.2rem;" },
      `Outlet snapped to ${r.snapped.lat.toFixed(4)}°, ${r.snapped.lon.toFixed(4)}° — draining ${fmt(s.areaKm2, 2)} km².`),
    h("dl", { class: "ws-stats", style: "display:grid;grid-template-columns:max-content minmax(0,1fr);gap:0.15rem 0.6rem;margin:0.2rem 0 0;font-size:0.78rem;" },
      h("dt", { text: "Relief" }), h("dd", { text: `${fmt(s.reliefM, 0)} m (${fmt(s.minM, 0)}–${fmt(s.maxM, 0)} m)` }),
      h("dt", { text: "Mean slope" }), h("dd", { text: `${fmt(s.meanSlopeDeg, 1)}°` }),
      h("dt", { text: "Longest flow path" }), h("dd", { text: `${fmt(s.longestPathM / 1000, 2)} km at ${fmt(s.longestPathSlope * 100, 1)}%` }),
      h("dt", { text: "Channels" }), h("dd", { text: `${r.net.features.length} reaches, Strahler order ${r.net.maxOrder}` }),
      h("dt", { text: "Time of concentration" }), h("dd", { text: `${fmt(tcModelMin, 0)} min on these velocities · Kirpich ${fmt(s.kirpichMin, 0)} min` }),
      h("dt", { text: "DEM" }), h("dd", { text: `${r.grid.stepM} m grid, ${r.label}` }),
    ),
  );
}

/* ── layers ─────────────────────────────────────────────────────────────── */

function removeOwnLayers() {
  const im = window.GeoIDImportManager;
  (im?.getLayers?.() || []).filter((l) => String(l.name).startsWith(`${PREFIX} — `)).forEach((l) => im.removeLayer?.(l.id));
}

async function drawLayers() {
  const im = window.GeoIDImportManager;
  const r = state.result;
  if (!im?.addDerivedLayer || !r) return;
  removeOwnLayers();
  const { buildVectorLayerResult } = await import(`./vector-render.js${search}`);
  const { grid, stats, net, travel, vel, flow, mask } = r;

  // The catchment: an outline, so the ground it holds stays readable.
  const rings = traceOutline(mask, grid.width, grid.height, grid.bounds);
  const props = {
    kind: "Catchment", area_km2: Number(stats.areaKm2.toFixed(3)), relief_m: Math.round(stats.reliefM),
    mean_slope_deg: Number(stats.meanSlopeDeg.toFixed(1)), longest_path_km: Number((stats.longestPathM / 1000).toFixed(3)),
    kirpich_min: Math.round(stats.kirpichMin), outlet_lat: Number(r.snapped.lat.toFixed(5)), outlet_lon: Number(r.snapped.lon.toFixed(5)),
    dem_step_m: grid.stepM, clipped: r.edge ? "yes" : "no",
  };
  const catchment = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: rings }, properties: props }] };
  addLayer(buildVectorLayerResult(catchment, { name: NAMES.catchment, outlineOnly: true,
    style: { field: "kind", categories: [{ value: "Catchment", colour: "#52e4e8" }] } }), NAMES.catchment, catchment,
  "The area that drains to the outlet, extracted by D8 routing on the sink-filled streamed DEM.");

  // The channels, by Strahler order.
  if (net.features.length) {
    const streams = { type: "FeatureCollection", features: net.features };
    const orders = [...new Set(net.features.map((f) => f.properties.order))].sort((a, b) => a - b);
    addLayer(buildVectorLayerResult(streams, { name: NAMES.streams,
      style: { field: "order", categories: orders.map((o) => ({ value: o, colour: ORDER_COLOURS[Math.min(o - 1, ORDER_COLOURS.length - 1)] })) } }),
    NAMES.streams, streams, `Channels where the contributing area passes ${fmt((r.thresholdCells * r.cm.x * r.cm.y) / 1e6, 2)} km², coloured by Strahler order.`);
  }

  // Flow vectors: an arrow per sampled cell, along its D8 direction, as long as
  // its velocity allows, coloured by travel time to the outlet.
  const vectors = flowVectors(r);
  const classes = travelClasses(r);
  addLayer(buildVectorLayerResult(vectors, { name: NAMES.vectors,
    style: { field: "travel_class", categories: classes.map((c, k) => ({ value: c.label, colour: TRAVEL_COLOURS[k] })) } }),
  NAMES.vectors, vectors, "Flow vectors: the D8 direction of each sampled cell, scaled by velocity, coloured by travel time to the outlet.");
  void flow; void vel; void travel;
  window.GeoIDViewer?.setSpinPaused?.(true);
}

function addLayer(built, name, fc, summary) {
  const im = window.GeoIDImportManager;
  built.home = "flood";
  const layer = im.addDerivedLayer(name, built, "derived");
  if (!layer) return null;
  layer.collection = fc; layer.features = fc.features;
  layer.home = "flood";
  layer.info = { source: "GeoID watershed extractor on the streamed DEM (Mapzen Terrain Tiles, AWS Open Data)", summary };
  return layer;
}

function travelClasses(r) {
  const tc = Math.max(60, r.travel.time[r.stats.sourceCell] || 60);
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001].map((f) => f * tc);
  return edges.slice(0, -1).map((lo, k) => ({ lo, hi: edges[k + 1], label: `${Math.round(lo / 60)}–${Math.round(edges[k + 1] / 60)} min` }));
}

export function flowVectors(r) {
  const { grid, flow, mask, vel, travel } = r;
  const { width, height } = grid;
  // About nine hundred arrows: enough to read the drainage pattern, few enough
  // that each is still an arrow at the scale a catchment is looked at.
  const target = 900;
  const stride = Math.max(1, Math.round(Math.sqrt(r.cells / target)));
  const classes = travelClasses(r);
  let vMax = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i] && vel[i] > vMax) vMax = vel[i];
  const degX = (grid.bounds.maxX - grid.bounds.minX) / width;
  const degY = (grid.bounds.maxY - grid.bounds.minY) / height;
  const features = [];
  for (let y = Math.floor(stride / 2); y < height; y += stride) {
    for (let x = Math.floor(stride / 2); x < width; x += stride) {
      const i = y * width + x;
      const q = flow.dir[i];
      if (!mask[i] || q < 0) continue;
      const c = centreOf(grid, i);
      const [dx, dy] = NEIGHBOURS[q];
      const len = Math.hypot(dx, dy);
      const scale = stride * (0.35 + 0.55 * Math.sqrt((vel[i] || 0) / (vMax || 1)));
      const ux = (dx / len) * scale * degX; const uy = (-dy / len) * scale * degY;
      const tip = [c.lon + ux / 2, c.lat + uy / 2];
      const tail = [c.lon - ux / 2, c.lat - uy / 2];
      // Arrowhead: two barbs at ±150° from the shaft, a third of its length.
      const barb = (a) => {
        const cos = Math.cos(a); const sin = Math.sin(a);
        const bx = (ux * cos - (uy / degY) * degX * sin) * 0.33;
        const by = ((ux / degX) * degY * sin + uy * cos) * 0.33;
        return [tip[0] + bx, tip[1] + by];
      };
      const t = travel.time[i];
      const cls = classes.find((k) => t >= k.lo && t < k.hi) || classes[classes.length - 1];
      features.push({
        type: "Feature",
        geometry: { type: "MultiLineString", coordinates: [[tail, tip], [barb(Math.PI * 5 / 6), tip, barb(-Math.PI * 5 / 6)]] },
        properties: { velocity_ms: Number((vel[i] || 0).toFixed(3)), travel_min: Number((t / 60).toFixed(1)), travel_class: cls.label, slope_pct: Number((flow.tan[i] * 100).toFixed(1)) },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/* ── runoff ─────────────────────────────────────────────────────────────── */

function runRunoff() {
  const r = state.result;
  if (!r) return;
  // Velocities may have changed since extraction; travel times follow them.
  r.vel = velocities(r.flow, r.net.isStream, { overlandK: overlandK(), channelV: channelV() });
  r.travel = travelToOutlet(r.flow, r.mask, r.grid.width, r.outlet, r.vel);
  const depth = Math.max(0, Number(byId("ws-rain").value) || 0);
  const hours = Math.max(0.1, Number(byId("ws-hours").value) || 1);
  const cn = Math.min(100, Math.max(30, Number(byId("ws-cn").value) || 75));
  const tc = Math.max(60, r.travel.time[r.stats.sourceCell] || 60);
  const dtS = Math.max(30, Math.min(900, Math.round(Math.min(tc, hours * 3600) / 60 / 10) * 60 || 60));
  const excess = excessSeries(depth, hours, cn, dtS);
  const hydro = timeAreaHydrograph(r.travel.time, r.mask, r.cm.x * r.cm.y, excess, dtS);
  const runoffMm = excess.reduce((a, b) => a + b, 0);
  state.runoff = { depth, hours, cn, dtS, excess, hydro, runoffMm };
  drawHydrograph(-1);
  say("ws-runoff", `${fmt(runoffMm, 1)} mm of ${fmt(depth, 0)} mm runs off (CN ${cn}). Peak ${fmt(hydro.peak, hydro.peak < 10 ? 2 : 0)} m³/s at ${fmt(hydro.peakAt / 3600, 2)} h; `
    + `${fmt(hydro.volume / 1e3, 1)} thousand m³. Unrouted time–area hydrograph: storage in the channels would lower and delay the peak.`);
  const play = byId("ws-play");
  if (play) play.disabled = false;
  const csv = byId("ws-csv");
  if (csv) csv.disabled = false;
  if (r.vectorsStale !== false) void drawLayers();
}

function drawHydrograph(markerS) {
  const canvas = byId("ws-hydrograph");
  const ro = state.runoff;
  if (!canvas || !ro) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300; const hgt = canvas.clientHeight || 150;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  const box = { l: 40, r: w - 8, t: 10, b: hgt - 22 };
  const { times, q, peak } = ro.hydro;
  const tEnd = times[times.length - 1] || 1;
  const yMax = peak > 0 ? peak * 1.12 : 1;
  const X = (t) => box.l + (t / tEnd) * (box.r - box.l);
  const Y = (v) => box.b - (v / yMax) * (box.b - box.t);
  const ink = getComputedStyle(canvas).color || "#cfd8e3";
  ctx.font = "10.5px 'Exo 2', system-ui, sans-serif";
  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.fillStyle = ink; ctx.lineWidth = 1;
  // Rain excess as bars along the top, scaled to their own maximum.
  const exMax = Math.max(...ro.excess, 1e-9);
  ctx.fillStyle = "rgba(82,160,255,0.35)";
  ro.excess.forEach((e, k) => {
    const x0 = X(k * ro.dtS); const x1 = X((k + 1) * ro.dtS);
    ctx.fillRect(x0, box.t, Math.max(1, x1 - x0 - 0.5), (e / exMax) * (box.b - box.t) * 0.28);
  });
  // Axes.
  ctx.fillStyle = ink;
  for (let k = 0; k <= 4; k += 1) {
    const v = (yMax * k) / 4; const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(box.l, y); ctx.lineTo(box.r, y); ctx.stroke();
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(v < 10 ? v.toFixed(1) : v.toFixed(0), box.l - 4, y);
  }
  const hStep = tEnd / 3600 > 12 ? 6 : tEnd / 3600 > 4 ? 2 : tEnd / 3600 > 1.5 ? 0.5 : 0.25;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let t = 0; t <= tEnd + 1; t += hStep * 3600) ctx.fillText(`${+(t / 3600).toFixed(2)} h`, X(t), box.b + 5);
  ctx.save(); ctx.translate(10, (box.t + box.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("m³/s", 0, 0); ctx.restore();
  // The hydrograph.
  ctx.strokeStyle = "#52e4e8"; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  times.forEach((t, k) => ctx.lineTo(X(t), Y(q[k])));
  ctx.stroke();
  if (markerS >= 0) {
    const x = X(Math.min(tEnd, markerS));
    ctx.strokeStyle = "#ff3ec8"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, box.t); ctx.lineTo(x, box.b); ctx.stroke();
  }
}

function exportCsv() {
  const ro = state.runoff; const r = state.result;
  if (!ro || !r) return;
  const lines = ["time_h,discharge_m3s,rain_excess_mm"];
  ro.hydro.times.forEach((t, k) => lines.push(`${(t / 3600).toFixed(4)},${ro.hydro.q[k].toFixed(4)},${(ro.excess[k] || 0).toFixed(4)}`));
  const text = `# GeoID watershed runoff — outlet ${r.snapped.lat.toFixed(5)}, ${r.snapped.lon.toFixed(5)}; area ${r.stats.areaKm2.toFixed(3)} km2; `
    + `rain ${ro.depth} mm over ${ro.hours} h; CN ${ro.cn}; time-area hydrograph (unrouted)\n${lines.join("\n")}\n`;
  // Every export in this app goes through downloadText, which also files it
  // into the open project and asks membership whether saving is allowed.
  void import(`./extraction.js${search}`).then(({ downloadText }) => downloadText("geoid_watershed_hydrograph.csv", text, "text/csv"));
}

/* ── the animated runoff: particles down the D8 paths ────────────────────── */

const MAX_PARTICLES = 3000;

async function startSim() {
  const r = state.result; const ro = state.runoff;
  const viewer = window.GeoIDViewer;
  if (!r || !ro || !viewer?.scene) return;
  stopSim();
  const THREE = await import("../vendor/three.module.js");
  const { followRelief, markerDiscTexture } = await import(`./vector-render.js${search}`);
  const group = viewer.scene.getObjectByName("GeoID-ImportedGeoLayers");
  if (!group) { say("ws-sim", "Draw the watershed first."); return; }

  // Release: a particle per slice of the storm's runoff, at a random catchment
  // cell, at a time drawn from the excess — so particles leave where and when
  // the rain actually runs off.
  const cells = [];
  for (let i = 0; i < r.mask.length; i += 1) if (r.mask[i]) cells.push(i);
  const cum = []; let total = 0;
  ro.excess.forEach((e) => { total += e; cum.push(total); });
  const count = Math.min(MAX_PARTICLES, Math.max(200, Math.round(cells.length / 3)));
  const spawnT = new Float32Array(count);
  const cell = new Int32Array(count);
  const frac = new Float32Array(count);
  const state8 = new Uint8Array(count);  // 0 waiting, 1 flowing, 2 arrived
  for (let p = 0; p < count; p += 1) {
    const u = Math.random() * (total || 1);
    let k = cum.findIndex((c) => c >= u); if (k < 0) k = 0;
    spawnT[p] = (k + Math.random()) * ro.dtS * (total ? 1 : 0) + (total ? 0 : Math.random() * ro.hours * 3600);
    cell[p] = cells[Math.floor(Math.random() * cells.length)];
  }
  const geometry = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const dirA = new Float32Array(count * 3);
  const disp = new Float32Array(count);
  const colour = new Float32Array(count * 3);
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aDir", new THREE.BufferAttribute(dirA, 3));
  geometry.setAttribute("aDisp", new THREE.BufferAttribute(disp, 1));
  geometry.setAttribute("color", new THREE.BufferAttribute(colour, 3));
  const material = new THREE.PointsMaterial({
    size: 6, sizeAttenuation: false, vertexColors: true, transparent: true,
    depthTest: false, depthWrite: false, map: markerDiscTexture(), alphaTest: 0.2,
  });
  followRelief(material, 0, { lifted: "marker", cullFarSide: true });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 232;
  points.userData.keepRenderOrder = true;
  group.add(points);
  const layer = window.GeoIDImportManager?.adoptLayer?.(NAMES.particles, points, {
    ext: "derived", info: { source: "GeoID watershed runoff simulation", summary: "Rain excess released across the catchment and carried down the D8 flow paths at each cell's velocity." },
    onRemove: () => stopSim(),
  });
  if (layer) layer.home = "flood";

  const vMax = Math.max(...Array.from(r.vel).filter((v, i) => r.mask[i]), 0.1);
  const tc = Math.max(60, r.travel.time[r.stats.sourceCell] || 60);
  const tEnd = ro.hydro.times[ro.hydro.times.length - 1] || ro.hours * 3600 + tc;
  const playSeconds = Number(byId("ws-speed")?.value) || 20;
  const rate = tEnd / playSeconds;   // simulated seconds per real second
  const { width } = r.grid;
  const heightOf = viewer.elevationNormalized;
  const toDir = viewer.latLonToVector3;
  const sim = { points, geometry, material, T: 0, last: performance.now(), running: true, raf: 0, layer };
  state.sim = sim;
  // A waiting or arrived particle is sent past the far plane rather than to a
  // zero direction: with the depth test off, the planet's centre is DRAWN.
  const hide = (p) => { dirA[p * 3] = 0; dirA[p * 3 + 1] = 1e5; dirA[p * 3 + 2] = 0; disp[p] = 0; };
  const step = (now) => {
    if (!sim.running) return;
    const realDt = Math.min(0.1, (now - sim.last) / 1000);
    sim.last = now;
    if (points.visible === false) { sim.raf = requestAnimationFrame(step); return; }
    const simDt = realDt * rate;
    sim.T += simDt;
    if (sim.T > tEnd) {  // loop the storm
      sim.T = 0;
      for (let p = 0; p < count; p += 1) { state8[p] = 0; frac[p] = 0; cell[p] = cells[Math.floor(Math.random() * cells.length)]; }
    }
    let arrived = 0; let flowing = 0;
    for (let p = 0; p < count; p += 1) {
      if (state8[p] === 0 && spawnT[p] <= sim.T) { state8[p] = 1; frac[p] = 0; }
      if (state8[p] !== 1) { if (state8[p] === 2) arrived += 1; hide(p); continue; }
      let remaining = Math.min(simDt, sim.T - spawnT[p]);
      let guard = 0;
      while (remaining > 0 && guard < 400) {
        guard += 1;
        const i = cell[p];
        if (i === r.outlet) { state8[p] = 2; break; }
        const q = r.flow.dir[i];
        const j = downstream(i, q, width);
        if (j < 0 || !r.mask[j]) { state8[p] = 2; break; }
        const seg = r.flow.runs[q];
        const v = Math.max(1e-3, r.vel[i]);
        const exit = (seg * (1 - frac[p])) / v;
        if (remaining >= exit) { remaining -= exit; cell[p] = j; frac[p] = 0; } else { frac[p] += (remaining * v) / seg; remaining = 0; }
      }
      if (state8[p] !== 1) { hide(p); arrived += state8[p] === 2 ? 1 : 0; continue; }
      flowing += 1;
      const i = cell[p];
      const j = downstream(i, r.flow.dir[i], width);
      const a = centreOf(r.grid, i); const b = j >= 0 ? centreOf(r.grid, j) : a;
      const lat = a.lat + (b.lat - a.lat) * frac[p];
      const lon = a.lon + (b.lon - a.lon) * frac[p];
      const d = toDir(lat, lon, 1);
      const len = Math.hypot(d.x, d.y, d.z) || 1;
      dirA[p * 3] = d.x / len; dirA[p * 3 + 1] = d.y / len; dirA[p * 3 + 2] = d.z / len;
      disp[p] = Number(heightOf(lat, lon)) || 0;
      // Colour by velocity: slow deep blue to fast white-cyan.
      const s = Math.sqrt(Math.min(1, r.vel[i] / vMax));
      colour[p * 3] = 0.15 + 0.85 * s; colour[p * 3 + 1] = 0.45 + 0.55 * s; colour[p * 3 + 2] = 1;
    }
    geometry.attributes.aDir.needsUpdate = true;
    geometry.attributes.aDisp.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    if (!sim.lastPlot || now - sim.lastPlot > 150) {
      sim.lastPlot = now;
      drawHydrograph(sim.T);
      say("ws-sim", `t = ${(sim.T / 3600).toFixed(2)} h · ${flowing} particles flowing, ${arrived} at the outlet.`);
    }
    sim.raf = requestAnimationFrame(step);
  };
  sim.raf = requestAnimationFrame(step);
  const play = byId("ws-play");
  if (play) play.textContent = "■ Stop";
}

function stopSim() {
  const sim = state.sim;
  if (!sim) return;
  sim.running = false;
  cancelAnimationFrame(sim.raf);
  state.sim = null;
  const im = window.GeoIDImportManager;
  (im?.getLayers?.() || []).filter((l) => l.name === NAMES.particles).forEach((l) => { l.onRemove = null; im.removeLayer?.(l.id); });
  sim.points.parent?.remove(sim.points);
  sim.geometry.dispose();
  sim.material.dispose();
  const play = byId("ws-play");
  if (play) play.textContent = "▶ Play the runoff";
  if (state.runoff) drawHydrograph(-1);
}

/* ── the panel ──────────────────────────────────────────────────────────── */

function build(host) {
  const pick = h("button", { type: "button", class: "button secondary", id: "ws-pick",
    title: "Click a point on a river or valley floor. The outlet snaps to the largest flow within the snap radius.",
    onclick: (e) => armPick(e.currentTarget) }, "Pick an outlet on the map");
  const extractBtn = h("button", { type: "button", class: "button", id: "ws-extract", disabled: true, onclick: () => void extract() }, "Extract the watershed");
  const surface = h("select", { id: "ws-surface", class: "input", "aria-label": "Hillslope surface" },
    h("option", { value: "unpaved", text: "Unpaved (TR-55, K 4.9)" }),
    h("option", { value: "grassed", text: "Grassed waterway (K 2.3)" }),
    h("option", { value: "forest", text: "Forest litter (K 1.2)" }),
    h("option", { value: "paved", text: "Paved (TR-55, K 6.2)" }));
  const speed = h("select", { id: "ws-speed", class: "input", "aria-label": "Playback length" },
    h("option", { value: "10", text: "10 s" }), h("option", { value: "20", text: "20 s", selected: true }), h("option", { value: "40", text: "40 s" }));
  host.replaceChildren(
    h("p", { class: "compact-copy", style: "margin:0 0 0.35rem;" },
      "Pick an outlet, extract the catchment that drains to it from the streamed DEM, then run a storm through it."),
    h("div", { class: "gis-btn-row" }, pick),
    h("p", { id: "ws-outlet", class: "compact-copy", style: "margin:0.25rem 0;opacity:0.8;" }, "No outlet picked yet."),
    row("Snap radius (m)", num("ws-snap", 300, { min: 0, step: 10, label: "Snap radius in metres" }), "The outlet moves to the largest flow accumulation within this distance of the click."),
    row("Channel from (km²)", num("ws-channel", 0.5, { min: 0.01, step: 0.05, label: "Contributing area that starts a channel" }), "Where the contributing area passes this, the cell is a channel: it takes the channel velocity and joins the stream network."),
    row("Search up to (km)", num("ws-search", 30, { min: 2, max: 200, step: 1, label: "Largest search box in kilometres" }), "The DEM box doubles until the basin no longer reaches its edge, up to this width."),
    h("div", { class: "gis-btn-row" }, extractBtn),
    h("p", { id: "ws-status", class: "compact-copy", "aria-live": "polite", style: "margin:0.25rem 0;opacity:0.8;" }),
    h("div", { id: "ws-result" }),
    h("p", { class: "compact-copy", style: "margin:0.6rem 0 0.2rem;opacity:0.75;" }, "Storm"),
    row("Rain (mm)", num("ws-rain", 50, { min: 0, step: 1, label: "Rain depth in millimetres" })),
    row("Over (hours)", num("ws-hours", 3, { min: 0.1, step: 0.5, label: "Storm duration in hours" })),
    row("Curve number", num("ws-cn", 75, { min: 30, max: 100, step: 1, label: "SCS curve number" }), "SCS curve number: how little of the rain the ground takes. 30–50 sandy woodland, 60–75 pasture and mixed land, 80–90 clay and suburbs, 98 paved."),
    row("Hillslope surface", surface, "Shallow concentrated flow velocity v = K·√S (NRCS TR-55)."),
    row("Channel velocity (m/s)", num("ws-channel-v", 1.5, { min: 0.1, step: 0.1, label: "Channel velocity in metres a second" })),
    h("div", { class: "gis-btn-row" },
      h("button", { type: "button", class: "button", id: "ws-run", disabled: true, onclick: () => runRunoff() }, "Run the storm")),
    h("canvas", { id: "ws-hydrograph", class: "ws-hydrograph", role: "img", "aria-label": "Outlet hydrograph",
      style: "display:block;width:100%;height:150px;margin:0.35rem 0 0;border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:rgba(226,232,240,0.8);" }),
    h("p", { id: "ws-runoff", class: "compact-copy", "aria-live": "polite", style: "margin:0.25rem 0;" }),
    row("Play over", speed),
    h("div", { class: "gis-btn-row" },
      h("button", { type: "button", class: "button secondary", id: "ws-play", disabled: true, onclick: () => (state.sim ? stopSim() : void startSim()) }, "▶ Play the runoff"),
      h("button", { type: "button", class: "button secondary", id: "ws-csv", disabled: true, onclick: exportCsv }, "Hydrograph CSV")),
    h("p", { id: "ws-sim", class: "compact-copy", style: "margin:0.25rem 0;opacity:0.8;" }),
  );
}

function install() {
  const host = byId("watershed-runoff");
  if (!host || host.dataset.built) return false;
  host.dataset.built = "1";
  build(host);
  window.GeoIDWatershed = {
    setOutlet, extract, runRunoff, startSim, stopSim,
    state: () => ({ outlet: state.outlet, stats: state.result?.stats || null, peak: state.runoff?.hydro.peak ?? null, simulating: Boolean(state.sim) }),
  };
  return true;
}

if (typeof document !== "undefined") {
  let tries = 0;
  const attempt = () => { if (!install() && tries++ < 40) setTimeout(attempt, 250); };
  attempt();
}
