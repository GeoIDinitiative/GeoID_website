/**
 * RISK MAPS PLAYED BY SIZE — the cyclone tracks' bar with the size class in
 * place of the date, for any record that bakes one grid per class.
 *
 * A SPEC describes a record: where its grids live, how its layer is named, the
 * frames the bar steps through (one grid each), the scale every frame shares,
 * and the words for a frame. The volcanic maps register two (windowed and
 * full Holocene, one frame per VEI); the seismic map registers one (a frame
 * per magnitude unit). One driver, so the bar, the fetch-on-demand, the
 * one-key rule and the collective-as-terminal-frame cannot drift between
 * hazards -- "built the same way" is a mechanism here, not a resemblance.
 *
 * A FRAME IS ITS OWN GRID AND NOTHING ELSE: fetched when the bar first reaches
 * it, drawn once and kept, the frame before it going in its wake. The
 * collective layer and the frame plot are never both up, and neither are
 * their keys.
 */

import { dataUrl } from "./data-base.js?v=20260912-d4224ad";
import { rampColour } from "./symbology.js?v=20260912-d4224ad";
import { startPlayer } from "./timelapse-player.js?v=20260912-d4224ad";

const search = new URL(import.meta.url).search;
/**
 * ONE REGISTRY ACROSS MODULE INSTANCES. A stamped import (`?v=`) and an
 * unstamped one are two modules with two registries -- the tests import this
 * file bare while the hazards import it stamped, and a spec registered in one
 * was invisible to the other. The registry lives on the global object.
 */
const SPECS = (globalThis.__geoidRiskSpecs = globalThis.__geoidRiskSpecs || {});
let running = false;
let opening = false;

/** A hazard registers its records here; `play(id)` looks them up. */
export function registerSpec(id, spec) {
  SPECS[id] = spec;
  return spec;
}

export const specFor = (id) => SPECS[id] || null;

const hex = ([r, g, b]) => [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** Which class an annual chance falls in on a spec's scale; -1 for nothing. */
export function classOf(p, edges) {
  if (!(p > 0)) return -1;
  let band = 0;
  edges.forEach((edge, i) => { if (p >= edge) band = i + 1; });
  return band;
}

/**
 * THE SHARED PAINT, BUILT FROM THE SCALE AND NOT FROM THE FRAME. `buildSymbology`
 * drops the classes outside a file's own range, and a VEI 5 map lives entirely
 * below one in a thousand years -- its key would have opened on "rarer than 1
 * in 100,000" for a row that was really the fourth class. Every frame carries
 * every class, counted, so a colour means the same thing in every one; and a
 * cell nothing reaches is listed in the key and drawn nowhere ("transparent"
 * is the renderer's skip, where null would be the not-measured grey).
 */
export function framePaint(features, spec, band) {
  const { edges, labels, noneColour, noneLabel, ramp = "risk" } = spec.scale;
  const colours = labels.map((_, i) => rampColour(ramp, i / Math.max(1, edges.length)));
  const counts = labels.map(() => 0);
  let none = 0;
  features.forEach((f) => {
    const c = classOf(Number(f?.properties?.p_yr), edges);
    if (c >= 0) counts[c] += 1; else none += 1;
  });
  const colourFor = (feature) => {
    const c = classOf(Number(feature?.properties?.p_yr), edges);
    if (c < 0) return "transparent";
    return `#${hex(colours[c])}`;
  };
  const legend = {
    classed: true, categorical: false, field: "p_yr", label: spec.bandLabel(band), unit: null,
    palette: [noneColour, ...colours.map(hex)],
    labels: [noneLabel, ...labels],
    bounds: [["0", "0"], ...labels.map((_, i) => [i === 0 ? "0" : edges[i - 1].toExponential(1),
      i < edges.length ? edges[i].toExponential(1) : "1"])],
    counts: [none, ...counts], min: 0, max: 1,
  };
  return { colourFor, legend };
}

/** The frames a spec steps through, then the collective as the terminal frame. */
export function epochsFor(spec, total) {
  const epochs = spec.frames.map((frame) => ({
    date: frame.band, label: frame.label, dataset: null, band: frame.band, count: null, ...frame,
  }));
  epochs.push({ date: "all", label: "All", dataset: null, all: true, band: "any", count: total });
  return epochs;
}

/** Cells with a rate: the rest of the globe is the none class. */
export function reachedIn(features) {
  return features.filter((f) => Number(f?.properties?.p_yr) > 0).length;
}

export function riskLayerFor(spec, layers = null) {
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  return held.find((l) => l.name && spec.name.test(l.name)) || null;
}

export async function play(id, { startAt = null } = {}) {
  if (opening) return { already: true };
  if (running && document.getElementById("geoid-timelapse")) return { already: true };
  opening = true;
  try {
    return await build(id, startAt);
  } finally {
    opening = false;
  }
}

async function build(id, startAt) {
  const spec = SPECS[id];
  const say = (message) => {
    const node = document.getElementById(spec?.statusId || "");
    if (node) node.textContent = message;
  };
  const layer = spec ? riskLayerFor(spec) : null;
  if (!spec || !layer?.features?.length) {
    say(`Tick ${spec?.noun || "the risk map"} on first — the animation plays the layer you have.`);
    return null;
  }
  const render = await import(`./vector-render.js${search}`);
  const THREE = await import("../vendor/three.module.js");
  const group = new THREE.Group();
  group.name = `GeoID-RiskFrames-${id}`;
  const epochs = epochsFor(spec, reachedIn(layer.features));
  const ALL = epochs.length - 1;

  const built = new Map();
  const loading = new Map();
  const nodeFor = async (index) => {
    if (built.has(index)) return built.get(index);
    if (!loading.has(index)) {
      loading.set(index, (async () => {
        const epoch = epochs[index];
        const response = await fetch(await dataUrl(`${spec.path}-${epoch.band}.geojson`));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const fc = await response.json();
        const paint = framePaint(fc.features, spec, epoch.band);
        const made = fc.features.length
          ? render.renderFeatureCollection(fc, { colourFor: paint.colourFor, outlineOnly: false })
          : new THREE.Group();
        const node = made?.object3D || made;
        node.visible = false;
        group.add(node);
        epoch.count = fc.features.filter((f) => Number(f?.properties?.p_yr) > 0).length;
        built.set(index, { node, features: fc.features, legend: paint.legend });
        return built.get(index);
      })());
    }
    return loading.get(index);
  };

  const wasVisible = layer.object3D ? layer.object3D.visible : true;
  /**
   * THE COLLECTIVE WEARS THE SAME PAINT AS THE FRAMES, none row included: the
   * catalogue's `paintByRange` leaves a zero uncoloured and lists no row for
   * it. Painted here, once, and kept after the bar closes.
   */
  const base = framePaint(layer.features, spec, "any");
  layer.repaint?.(base.colourFor);
  layer.legendInfo = base.legend;
  layer.rangeSpec = null;
  const derived = window.GeoIDImportManager?.addDerivedLayer?.(spec.plotName, {
    object3D: group, georeferenced: true,
    bounds: { minX: -180, maxX: 180, minY: -90, maxY: 90 },
    features: [], collection: { type: "FeatureCollection", features: [] },
    legendInfo: framePaint([], spec, spec.frames[0].band).legend,
    home: spec.home,
  }, spec.ext || "grid");
  if (derived) { derived.riskRecord = id; derived.riskBand = spec.frames[0].band; derived.legendHidden = true; }
  const held = () => (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.id === derived?.id);
  window.GeoIDLayerHierarchy?.setOpacity?.(derived, Number.isFinite(layer.opacity) ? layer.opacity : 0.6);

  let shown = 0;
  running = true;
  await startPlayer({
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    epochs,
    source: "none",
    noteFor: spec.noteFor,
    noteTitle: spec.noteTitle,
    onStatus: say,
    interval: spec.interval || 1600,
    startAt: startAt === null ? ALL : startAt,
    onShow: async (index) => {
      const ticket = (shown += 1);
      const whole = index === ALL;
      const plot = held();
      if (plot) plot.legendHidden = whole;
      // ONE DATASET, ONE KEY: a hidden layer keeps its card, so the
      // collective's key is withheld while a frame is up and restored on All.
      layer.legendHidden = !whole;
      window.GeoIDLayerHierarchy?.setVisible?.(layer, whole ? wasVisible : false);
      built.forEach((b) => { b.node.visible = false; });
      if (whole) {
        if (plot?.object3D) plot.object3D.visible = false;
        if (plot) { plot.features = []; plot.collection = { type: "FeatureCollection", features: [] }; }
        window.GeoIDLayerHierarchy?.render?.();
        return;
      }
      say(`Loading ${epochs[index].label}…`);
      let frame;
      try {
        frame = await nodeFor(index);
      } catch (error) {
        say(`${epochs[index].label} could not be read: ${error.message}`);
        return;
      }
      if (ticket !== shown || !running) return;
      built.forEach((b, i) => { b.node.visible = i === index; });
      const now = held();
      if (now) {
        if (now.object3D) now.object3D.visible = true;
        now.features = frame.features;
        now.collection = { type: "FeatureCollection", features: frame.features };
        now.legendInfo = frame.legend;
        now.riskBand = epochs[index].band;
        now.legendHidden = false;
      }
      say(epochs[index].count
        ? `${epochs[index].label}: ${epochs[index].count.toLocaleString()} cells`
        : `${epochs[index].label}: nothing of this size on record`);
      // The bar wrote its note before the frame was fetched; the count it now
      // knows is written back into the note it is still showing.
      const note = document.querySelector("#geoid-timelapse .tl-note");
      if (note) { note.textContent = spec.noteFor(epochs[index]); note.title = spec.noteTitle(epochs[index]); }
      window.GeoIDLayerHierarchy?.render?.();
      window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", { detail: { reason: "symbology" } }));
    },
    onStop: () => {
      running = false;
      const now = held();
      if (now) window.GeoIDImportManager?.removeLayer?.(now.id);
      group.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
      const back = riskLayerFor(spec);
      if (back) { back.legendHidden = false; window.GeoIDLayerHierarchy?.setVisible?.(back, wasVisible); }
      say("");
    },
  });
  return { frames: spec.frames.length };
}

/**
 * Which record and which band a clicked cell belongs to, by feature identity:
 * the collective's cells live on the catalogue layer, a frame's on the plot,
 * and the plot says which band it is showing.
 */
export function bandOf(props, layers = null) {
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  for (const layer of held) {
    if (!layer?.features?.some?.((f) => f?.properties === props)) continue;
    const id = layer.riskRecord
      || Object.keys(SPECS).find((k) => SPECS[k].name.test(layer.name || ""))
      || null;
    return { id, band: layer.riskBand || "any", spec: id ? SPECS[id] : null };
  }
  return { id: null, band: "any", spec: null };
}

if (typeof window !== "undefined") {
  window.GeoIDRiskFrames = { registerSpec, specFor, play, framePaint, epochsFor, reachedIn, riskLayerFor, bandOf, classOf };
}
