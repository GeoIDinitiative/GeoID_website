/**
 * THE VOLCANIC RISK MAPS, PLAYED BY VEI — the cyclone tracks' bar with the
 * eruption size in place of the date.
 *
 * Eight grids, one per VEI 1–8, each "eruptions of that size per year
 * depositing at least 1 mm of ash at a point" on the shared return-period
 * scale, then the COLLECTIVE — the
 * catalogue layer itself, every size at once — as the terminal frame, which is
 * where the bar parks when the layer is ticked (the tracks' own rule: a tick
 * asks for the layer, not for the first frame of it).
 *
 * A FRAME IS ITS OWN GRID AND NOTHING ELSE: each is fetched when the bar first
 * reaches it, drawn once and kept, and the frame before it goes in its wake.
 * The collective layer and the frame plot are never both up, and neither are
 * their keys — one dataset draws one thing.
 */

import { dataUrl } from "./data-base.js?v=20260909-d5a5742";
import { rampColour } from "./symbology.js?v=20260909-d5a5742";
import { startPlayer } from "./timelapse-player.js?v=20260909-d5a5742";
import { riskEdges, RISK_LABELS, classOf, FRAME_VEIS, BANDS, RECORDS, riskLayer, NONE_COLOUR, NONE_LABEL } from "./volcanic-risk.js?v=20260909-d5a5742";

const search = new URL(import.meta.url).search;
let running = false;
let opening = false;

function say(message) {
  const node = document.getElementById("volcanic-status");
  if (node) node.textContent = message;
}

/**
 * THE SHARED PAINT, BUILT FROM THE SCALE AND NOT FROM THE FRAME. `buildSymbology`
 * drops the classes outside a file's own range, and a VEI 5 map lives entirely
 * below one in a thousand years -- its key would have opened on "rarer than 1
 * in 100,000" for a row that was really the fourth class. Every frame carries
 * all eight classes, counted, so a colour means the same thing in every one.
 */
export function framePaint(features, band) {
  const edges = riskEdges();
  const colours = RISK_LABELS.map((_, i) => rampColour("risk", i / Math.max(1, edges.length)));
  const counts = RISK_LABELS.map(() => 0);
  let none = 0;
  features.forEach((f) => {
    const c = classOf(Number(f?.properties?.p_yr), edges);
    if (c >= 0) counts[c] += 1; else none += 1;
  });
  const colourFor = (feature) => {
    const c = classOf(Number(feature?.properties?.p_yr), edges);
    // NOTHING ON RECORD IS A CLASS, not a missing value.
    if (c < 0) return `#${NONE_COLOUR}`;
    const [r, g, b] = colours[c];
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  };
  const legend = {
    classed: true, categorical: false, field: "p_yr", label: BANDS[band].label, unit: null,
    palette: [NONE_COLOUR, ...colours.map(([r, g, b]) => [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""))],
    labels: [NONE_LABEL, ...RISK_LABELS],
    bounds: [["0", "0"], ...RISK_LABELS.map((_, i) => [i === 0 ? "0" : edges[i - 1].toExponential(1),
      i < edges.length ? edges[i].toExponential(1) : "1"])],
    counts: [none, ...counts], min: 0, max: 1,
  };
  return { colourFor, legend };
}

export function epochsFor(total) {
  const epochs = FRAME_VEIS.map((v) => ({
    date: `vei${v}`, label: `VEI ${v}`, dataset: null, vei: v, band: `vei${v}`, count: null,
  }));
  epochs.push({ date: "all", label: "All", dataset: null, all: true, band: "any", count: total });
  return epochs;
}

/** Cells with a rate, for the collective's note: the rest of the globe is the none class. */
export function reachedIn(features) {
  return features.filter((f) => Number(f?.properties?.p_yr) > 0).length;
}


export function noteFor(epoch) {
  if (epoch.all) return `${(epoch.count || 0).toLocaleString()} cells reached, every size`;
  if (epoch.count === 0) return `VEI ${epoch.vei} · none in the Holocene record`;
  const n = epoch.count === null ? "…" : epoch.count.toLocaleString();
  return `VEI ${epoch.vei} · ${n} cells`;
}

export function noteTitle(epoch) {
  if (epoch.all) return "The collective: eruptions of any size per year depositing at least 1 mm of ash at each point";
  if (epoch.count === 0) {
    return `No eruption in the Smithsonian Holocene catalogue reached VEI ${epoch.vei}: `
      + "the last of that size on Earth (Toba, about 74,000 years ago) is Pleistocene";
  }
  return `Eruptions of VEI ${epoch.vei} per year depositing at least 1 mm of ash at each point, on the same scale as every other frame`;
}

export async function play(id = "volcanic-risk", { startAt = null } = {}) {
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
  const spec = RECORDS[id];
  const layer = riskLayer(id);
  if (!spec || !layer?.features?.length) {
    say("Tick a volcanic risk map on first — the animation plays the layer you have.");
    return null;
  }
  const render = await import(`./vector-render.js${search}`);
  const THREE = await import("../vendor/three.module.js");
  const group = new THREE.Group();
  group.name = `GeoID-VolcanicRiskFrames-${id}`;
  const epochs = epochsFor(reachedIn(layer.features));
  const ALL = epochs.length - 1;

  /** Fetched when the bar first reaches it, drawn once, kept. */
  const built = new Map();
  const loading = new Map();
  const nodeFor = async (index) => {
    if (built.has(index)) return built.get(index);
    if (!loading.has(index)) {
      loading.set(index, (async () => {
        const epoch = epochs[index];
        const url = await dataUrl(`${spec.path}-${epoch.band}.geojson`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const fc = await response.json();
        const paint = framePaint(fc.features, epoch.band);
        const made = fc.features.length
          ? render.renderFeatureCollection(fc, { colourFor: paint.colourFor, outlineOnly: false })
          : new THREE.Group();
        const node = made?.object3D || made;
        node.visible = false;
        group.add(node);
        // The count the note reports is cells WITH a rate; the "none" cells
        // are the rest of the globe.
        epoch.count = fc.features.filter((f) => Number(f?.properties?.p_yr) > 0).length;
        built.set(index, { node, features: fc.features, legend: paint.legend });
        return built.get(index);
      })());
    }
    return loading.get(index);
  };

  const wasVisible = layer.object3D ? layer.object3D.visible : true;
  /**
   * THE COLLECTIVE WEARS THE SAME PAINT AS THE FRAMES, none row included:
   * the catalogue's `paintByRange` leaves a zero uncoloured (the app's grey,
   * meaning not measured) and lists no row for it. Painted here, once, and
   * it keeps it after the bar closes.
   */
  const base = framePaint(layer.features, "any");
  layer.repaint?.(base.colourFor);
  layer.legendInfo = base.legend;
  layer.rangeSpec = null;
  const derived = window.GeoIDImportManager?.addDerivedLayer?.(
    `Volcanic risk by VEI — ${spec.full ? "full Holocene record" : "windowed record"}`, {
      object3D: group, georeferenced: true,
      bounds: { minX: -180, maxX: 180, minY: -90, maxY: 90 },
      features: [], collection: { type: "FeatureCollection", features: [] },
      legendInfo: framePaint([], "vei1").legend,
      home: "volcanic-hazards",
    }, "gvp");
  if (derived) { derived.volcanicRecord = id; derived.volcanicBand = "vei1"; derived.legendHidden = true; }
  const held = () => (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.id === derived?.id);
  window.GeoIDLayerHierarchy?.setOpacity?.(derived, Number.isFinite(layer.opacity) ? layer.opacity : 0.6);

  let shown = 0;
  running = true;
  await startPlayer({
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    epochs,
    source: "none",
    noteFor,
    noteTitle,
    onStatus: say,
    interval: 1600,
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
      say(`Loading VEI ${epochs[index].vei}…`);
      let frame;
      try {
        frame = await nodeFor(index);
      } catch (error) {
        say(`VEI ${epochs[index].vei} could not be read: ${error.message}`);
        return;
      }
      // A slower fetch must not paint over a newer frame.
      if (ticket !== shown || !running) return;
      built.forEach((b, i) => { b.node.visible = i === index; });
      const now = held();
      if (now) {
        if (now.object3D) now.object3D.visible = true;
        now.features = frame.features;
        now.collection = { type: "FeatureCollection", features: frame.features };
        now.legendInfo = frame.legend;
        now.volcanicBand = epochs[index].band;
        now.legendHidden = false;
      }
      say(epochs[index].count
        ? `VEI ${epochs[index].vei}: ${epochs[index].count.toLocaleString()} cells`
        : `VEI ${epochs[index].vei}: no eruption of this size in the Holocene record`);
      // The bar wrote its note before the frame was fetched, so the count
      // it now knows is written back into the note it is still showing.
      const note = document.querySelector("#geoid-timelapse .tl-note");
      if (note) { note.textContent = noteFor(epochs[index]); note.title = noteTitle(epochs[index]); }
      window.GeoIDLayerHierarchy?.render?.();
      window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed", { detail: { reason: "symbology" } }));
    },
    onStop: () => {
      running = false;
      const now = held();
      if (now) window.GeoIDImportManager?.removeLayer?.(now.id);
      group.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
      const back = riskLayer(id);
      if (back) { back.legendHidden = false; window.GeoIDLayerHierarchy?.setVisible?.(back, wasVisible); }
      say("");
    },
  });
  return { frames: FRAME_VEIS.length };
}

if (typeof window !== "undefined") {
  window.GeoIDVolcanicRiskFrames = { play, epochsFor, noteFor, noteTitle, framePaint };
}
