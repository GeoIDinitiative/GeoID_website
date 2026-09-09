/**
 * THE VOLCANIC RISK SHEETS — two Cloud-Optimised GeoTIFFs, one band per VEI,
 * draped whole and recoloured by whichever band a reader asks for.
 *
 * WHY A RASTER. The first versions were a variable-resolution quadtree, the
 * cyclone map's own — right for a SPARSE field and reported as a mess once the
 * kernel made this one smooth and global. A smooth field wants a lattice: the
 * bake writes the 0.25° lattice itself, 1440 × 720 × 12 bands of Float32,
 * deflated to 6–7 MB, and this reads it whole and paints it. A view is a
 * repaint of a texture over one mesh, the cyclone estimate's own arrangement.
 *
 * TWO SHEETS, ONE MODULE: the windowed record and the full Holocene record are
 * two files from one bake, each with its own state here, found by its own
 * dataset id so a view set on one cannot repaint the other.
 *
 * A CLICK READS THE BANDS, NOT THE PICTURE. `probeAt` is the seam
 * `feature-popup.js` offers a click to when nothing vector was hit (the
 * thickness sheet's own); it answers synchronously from the arrays in memory
 * and raises the viewer's card with every VEI's rate at the point.
 */

import { loadGeoTiffLibrary } from "./geotiff-adapter.js?v=20260909-02b5091";
import { dataUrl } from "./data-base.js?v=20260909-02b5091";
import { rampColour } from "./symbology.js?v=20260909-02b5091";
import { mathsFor } from "./equations.js?v=20260909-02b5091";
import {
  riskEdges, RISK_LABELS, classOf, VEI_COLOURS, VIEWS, VIEW_ORDER,
} from "./volcanic-risk.js?v=20260909-02b5091";
import { volcanicRiskCard } from "./volcanic-risk-card.js?v=20260909-02b5091";

const WORLD = { west: -180, south: -90, east: 180, north: 90 };
const DEFAULT_OPACITY = 0.7;
const CREDIT = "Global Volcanism Program, Smithsonian Institution — Volcanoes of the World v5.2 (2024), CC BY 4.0";

export const SHEETS = {
  "volcanic-risk": {
    file: "/data/global/volcanic-risk.hotlink-ok.tif",
    name: "Volcanic risk — eruptions per year by VEI (windowed record)",
    full: false,
    summary: "How often an eruption of each VEI happens near a point, per year, "
      + "each size counted over the years it is recorded: VEI ≤ 3 since 1950, "
      + "VEI 4 since 1900, VEI 5–6 since 1550, VEI 7+ the whole Holocene.",
  },
  "volcanic-risk-holocene": {
    file: "/data/global/volcanic-risk-holocene.hotlink-ok.tif",
    name: "Volcanic risk — eruptions per year by VEI (full Holocene record)",
    full: true,
    summary: "The same, from every dated eruption back to 9700 BCE with no "
      + "completeness windows, each volcano's rate over its own record span.",
  },
};

const state = {};
let three = null;

function stateFor(id) {
  if (!state[id]) state[id] = { image: null, bands: {}, width: 0, height: 0, mesh: null, layer: null, view: "any" };
  return state[id];
}

/** The sheet's layer, if it is on the globe. */
export function sheetLayer(id) {
  const s = state[id];
  const held = window.GeoIDImportManager?.getLayers?.() || [];
  return held.find((l) => l.name === SHEETS[id]?.name) || (s?.layer || null);
}

async function open(id) {
  const s = stateFor(id);
  if (s.image) return s;
  const GeoTIFF = await loadGeoTiffLibrary();
  const tiff = await GeoTIFF.fromUrl(await dataUrl(SHEETS[id].file));
  s.image = await tiff.getImage();
  s.width = s.image.getWidth();
  s.height = s.image.getHeight();
  // Band names are the file's own descriptions, written by the bake.
  s.names = [];
  const count = s.image.getSamplesPerPixel();
  for (let b = 0; b < count; b += 1) {
    const own = s.image.getGDALMetadata ? s.image.getGDALMetadata(b) : null;
    s.names.push(own?.DESCRIPTION || `band${b}`);
  }
  return s;
}

/** One band, read once and kept: 1440 × 720 floats is 4 MB. */
export async function band(id, name) {
  const s = await open(id);
  if (s.bands[name]) return s.bands[name];
  const i = s.names.indexOf(name);
  if (i < 0) throw new Error(`${SHEETS[id].name}: no band ${name}`);
  const [data] = await s.image.readRasters({ samples: [i] });
  s.bands[name] = data;
  return data;
}

/**
 * The picture for one view: a class per pixel on the shared scale, nothing
 * drawn where nothing reaches, and ground only a floor prior reaches drawn
 * fainter so the prior is visible AS a prior.
 */
export async function frameCanvas(id, view) {
  const spec = VIEWS[view] || VIEWS.any;
  const s = await open(id);
  const data = await band(id, spec.band);
  const prior = await band(id, "prior_only");
  const edges = riskEdges();
  const canvas = document.createElement("canvas");
  canvas.width = s.width; canvas.height = s.height;
  const ctx = canvas.getContext("2d");
  const px = ctx.createImageData(s.width, s.height);
  const classColours = RISK_LABELS.map((_, i) => rampColour("risk", i / Math.max(1, edges.length)));
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    let rgb = null;
    if (spec.categorical) {
      const hex = VEI_COLOURS[Math.round(v)];
      if (v > 0 && hex) rgb = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    } else {
      const c = classOf(1 - Math.exp(-v), edges);
      if (c >= 0) rgb = classColours[c];
    }
    if (!rgb) continue;
    px.data[i * 4] = rgb[0]; px.data[i * 4 + 1] = rgb[1]; px.data[i * 4 + 2] = rgb[2];
    px.data[i * 4 + 3] = prior[i] > 0 ? 110 : 235;
  }
  ctx.putImageData(px, 0, 0);
  return canvas;
}

/** The key for a view, on the shared scale. */
export function legendFor(view, { counts = null } = {}) {
  const spec = VIEWS[view] || VIEWS.any;
  if (spec.categorical) {
    const veis = counts ? Object.keys(counts).map(Number).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6, 7];
    return {
      classed: true, categorical: true, field: "vei_max", label: spec.label,
      palette: veis.map((v) => VEI_COLOURS[v]), labels: veis.map((v) => `VEI ${v}`),
      bounds: veis.map((v) => [String(v), String(v)]), counts: veis.map((v) => counts?.[v] ?? 0),
      min: veis[0], max: veis[veis.length - 1],
    };
  }
  const edges = riskEdges();
  return {
    classed: true, categorical: false, field: spec.band, label: spec.label, unit: null,
    palette: RISK_LABELS.map((_, i) => rampColour("risk", i / Math.max(1, edges.length))
      .map((c) => c.toString(16).padStart(2, "0")).join("")),
    labels: [...RISK_LABELS],
    bounds: RISK_LABELS.map((_, i) => [i === 0 ? "0" : edges[i - 1].toExponential(1), i < edges.length ? edges[i].toExponential(1) : "1"]),
    counts: counts ? RISK_LABELS.map((_, i) => counts[i] ?? 0) : RISK_LABELS.map(() => 0),
    min: 0, max: 1,
  };
}

async function countsFor(id, view) {
  const spec = VIEWS[view] || VIEWS.any;
  const data = await band(id, spec.band);
  const counts = {};
  const edges = riskEdges();
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    const c = spec.categorical ? (v > 0 ? Math.round(v) : -1) : classOf(1 - Math.exp(-v), edges);
    if (c >= 0) counts[c] = (counts[c] || 0) + 1;
  }
  return counts;
}

function announce() {
  window.GeoIDLayerHierarchy?.render?.();
  window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", { detail: { reason: "symbology" } }));
}

/** Repaint the sheet as one of its readings, and re-key it. */
export async function setView(id, view = "any") {
  const s = stateFor(id);
  const layer = sheetLayer(id);
  if (!layer || !s.mesh) return null;
  const wanted = VIEWS[view] ? view : "any";
  if (!three) three = await import("../vendor/three.module.js");
  const canvas = await frameCanvas(id, wanted);
  const next = new three.CanvasTexture(canvas);
  next.colorSpace = three.SRGBColorSpace;
  s.mesh.traverse?.((n) => {
    if (!n.material || !("map" in n.material)) return;
    n.material.map?.dispose?.();
    n.material.map = next;
    n.material.needsUpdate = true;
  });
  s.view = wanted;
  layer.legendInfo = legendFor(wanted, { counts: await countsFor(id, wanted) });
  layer.legendSummary = null;
  announce();
  return { id, view: wanted };
}

export function currentView(id) {
  return state[id]?.view || "any";
}

function viewsFor(id) {
  return {
    label: "Show",
    options: VIEW_ORDER.map((v) => ({ id: v, label: VIEWS[v].label })),
    current: () => currentView(id),
    apply: (view) => setView(id, view),
  };
}

export async function add(id, onStatus = () => {}) {
  const spec = SHEETS[id];
  if (!spec) throw new Error(`no volcanic risk sheet ${id}`);
  const existing = sheetLayer(id);
  if (existing) return { ok: true, layer: existing };
  const s = stateFor(id);
  onStatus(`${spec.name}: opening the record…`);
  await open(id);
  if (!three) three = await import("../vendor/three.module.js");
  const gee = await import(`./gee.js${new URL(import.meta.url).search}`);
  const canvas = await frameCanvas(id, s.view);
  const mesh = await gee.drape(canvas.toDataURL(), WORLD);
  if (!mesh) return { ok: false, message: "the globe is not ready yet" };
  // A sheet that skips the depth test must not write depth either.
  mesh.traverse?.((node) => {
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((m) => { if (m && m.depthTest === false) m.depthWrite = false; });
  });
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(spec.name, {
    object3D: mesh, bounds: WORLD, georeferenced: true,
    legendInfo: legendFor(s.view, { counts: await countsFor(id, s.view) }),
    home: "volcanic-hazards",
  }, "tiles");
  if (!layer) return { ok: false, message: "the layer could not be registered" };
  /**
   * REGISTERED, THEN PARENTED TO THE GLOBE: `drape` builds in the globe's
   * frame and bakes the half-turn in, while `addDerivedLayer` reparents into
   * the geo group, which carries the spin differently — the cyclone estimate's
   * own pair, for the same reason.
   */
  mesh.userData.geoidLayer = true;
  window.GeoIDViewer?.globe?.add?.(mesh);
  s.mesh = mesh; s.layer = layer;
  layer.info = { source: CREDIT, summary: spec.summary, citation: CREDIT, maths: mathsFor(id) };
  layer.metadata = { ...(layer.metadata || {}), source: CREDIT, citation: CREDIT, crs: "EPSG:4326" };
  layer.symbologyViews = viewsFor(id);
  window.GeoIDLayerHierarchy?.setOpacity?.(layer, DEFAULT_OPACITY);
  window.GeoIDLayerHierarchy?.render?.();
  const reached = (await band(id, "any")).reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
  const message = `${spec.name}: ${reached.toLocaleString()} of ${(s.width * s.height).toLocaleString()} `
    + `cells within reach of an eruption. ${CREDIT}`;
  onStatus(message);
  return { ok: true, layer, message };
}

export function remove(id) {
  const s = state[id];
  const layer = sheetLayer(id);
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  if (s?.mesh) {
    s.mesh.parent?.remove(s.mesh);
    s.mesh.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.map?.dispose?.(); n.material?.dispose?.(); });
  }
  if (s) { s.mesh = null; s.layer = null; }
  return Boolean(layer);
}

/** The bands at one point, from the arrays in memory. */
export function sampleAt(id, lat, lon) {
  const s = state[id];
  if (!s?.image) return null;
  const x = Math.min(s.width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * s.width)));
  const y = Math.min(s.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * s.height)));
  const i = y * s.width + x;
  const out = {};
  Object.keys(s.bands).forEach((name) => { out[name] = s.bands[name][i]; });
  return out;
}

async function allBands(id) {
  const s = await open(id);
  await Promise.all(s.names.map((n) => band(id, n)));
}

/**
 * Answer a click. Synchronous TRUE claims it; the card follows. Only a sheet
 * on the globe and visible answers, and the topmost such sheet wins.
 */
export function probeAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const id = Object.keys(SHEETS).find((k) => {
    const l = sheetLayer(k);
    return l && l.visible !== false && state[k]?.mesh;
  });
  if (!id) return false;
  void (async () => {
    await allBands(id);
    const sample = sampleAt(id, lat, lon);
    if (!sample) return;
    const card = volcanicRiskCard(sample, { view: currentView(id), full: SHEETS[id].full });
    window.GeoIDViewer?.showFeatureCard?.({
      soil: true,
      type: card.kicker,
      rock_type: card.title,
      lithology: null,
      name: null,
      description: card.meta,
      extra_rows: card.headline,
      origin: card.source,
      rows: [["Note", card.note]],
    }, lat, lon);
  })();
  return true;
}

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRiskRaster = {
    SHEETS, add, remove, setView, currentView, sheetLayer, sampleAt, probeAt, frameCanvas, legendFor,
  };
}
