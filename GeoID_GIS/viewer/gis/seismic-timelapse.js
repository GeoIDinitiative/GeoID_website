/**
 * THE EARTHQUAKE RECORD, PLAYED A YEAR AT A TIME — the cyclone tracks' bar
 * over USGS ComCat's M >= 5 catalogue since 1900. A frame is one year's
 * earthquakes and nothing else (the year before goes in its wake); the whole
 * catalogue is the terminal All frame, where the bar parks on a tick.
 *
 * ONE PALETTE ACROSS EVERY FRAME: magnitude on fixed unit edges (5, 6, 7, 8),
 * so a M 7 is the same colour in a quiet year and a busy one.
 */

import { buildSymbology, colourOf, legendInfoFrom } from "./symbology.js?v=20260909-efbf340";
import { startPlayer } from "./timelapse-player.js?v=20260909-efbf340";

const search = new URL(import.meta.url).search;
export const MAG_EDGES = [6, 7, 8];
export const MAG_LABELS = ["M 5–5.9", "M 6–6.9", "M 7–7.9", "M 8+"];
export const SPANS = { 1900: "1900 to now — the whole catalogue", 1964: "1964 to now — the global network", 2000: "2000 to now" };
let running = false;
let opening = false;

function say(message) {
  const node = document.getElementById("seismic-play-status");
  if (node) node.textContent = message;
}

export function eventsLayer(layers = null) {
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  return held.find((l) => l.name && /earthquakes \(USGS ComCat/i.test(l.name)) || null;
}

/** The years present, each with its earthquakes, from a start year. */
export function yearsIn(features, from = 1900) {
  const byYear = new Map();
  features.forEach((f) => {
    const year = Number(f?.properties?.year);
    if (!Number.isFinite(year) || year < from) return;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(f);
  });
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]);
}

export function colouring(features) {
  const values = features.map((f) => Number(f?.properties?.mag)).filter(Number.isFinite);
  const sym = buildSymbology(values.length ? values : [5, 6, 7, 8], { edges: MAG_EDGES, ramp: "risk" });
  sym.rows.forEach((row, i) => { if (MAG_LABELS[i]) row.label = MAG_LABELS[i]; });
  return {
    sym,
    colourFor: (feature) => {
      const n = Number(feature?.properties?.mag);
      return Number.isFinite(n) ? colourOf(n, sym) : null;
    },
    legend: { ...legendInfoFrom(sym, { label: "Magnitude" }), field: "mag", categorical: false },
  };
}

export function noteFor(epoch) {
  if (epoch.all) return `${(epoch.total || 0).toLocaleString()} earthquakes M ≥ 5`;
  const big = epoch.largest ? ` · largest M ${epoch.largest.toFixed(1)}` : "";
  return `${(epoch.count || 0).toLocaleString()} / ${(epoch.total || 0).toLocaleString()}${big}`;
}

export function noteTitle(epoch) {
  if (epoch.all) return "Every earthquake of M ≥ 5 in USGS ComCat since 1900";
  const pre = epoch.year < 1964 ? " — before the global network of 1964 the catalogue is complete only above about M 6" : "";
  return `${(epoch.count || 0).toLocaleString()} earthquakes of M ≥ 5 in ${epoch.year}${pre}`;
}

export const chosenSpan = () => Number(document.getElementById("seismic-timelapse-span")?.value) || 1900;

export async function play({ from = chosenSpan(), startAt = null } = {}) {
  if (opening) return { already: true };
  if (running && document.getElementById("geoid-timelapse")) return { already: true };
  opening = true;
  try {
    return await build(from, startAt);
  } finally {
    opening = false;
  }
}

async function build(from, startAt) {
  const layer = eventsLayer();
  if (!layer?.features?.length) {
    say("Tick the earthquake catalogue on first — the animation plays the layer you have.");
    return null;
  }
  const years = yearsIn(layer.features, from);
  if (!years.length) { say("No earthquakes in that span."); return null; }
  const render = await import(`./vector-render.js${search}`);
  const THREE = await import("../vendor/three.module.js");
  const paint = colouring(layer.features);
  const group = new THREE.Group();
  group.name = "GeoID-SeismicTimelapse";
  const total = layer.features.length;
  const epochs = years.map(([year, feats]) => ({
    date: String(year), label: String(year), dataset: null, year, count: feats.length, total,
    largest: Math.max(...feats.map((f) => Number(f.properties.mag) || 0)),
    // a tick at every decade, and always at the first frame
    tick: year % 10 === 0,
  }));
  epochs[0].tick = true;
  epochs.push({ date: "all", label: "All", dataset: null, all: true, total, count: total });
  const ALL = epochs.length - 1;

  const built = new Map();
  const nodeFor = (index) => {
    if (built.has(index)) return built.get(index);
    const made = render.renderFeatureCollection(
      { type: "FeatureCollection", features: years[index][1] },
      { colourFor: paint.colourFor, pointStyle: "places" },
    );
    const node = made?.object3D || made;
    node.visible = false;
    group.add(node);
    built.set(index, node);
    return node;
  };

  const wasVisible = layer.object3D ? layer.object3D.visible : true;
  const derived = window.GeoIDImportManager?.addDerivedLayer?.("Earthquakes plotted — by year", {
    object3D: group, georeferenced: true,
    bounds: { minX: -180, maxX: 180, minY: -90, maxY: 90 },
    features: [], collection: { type: "FeatureCollection", features: [] },
    legendInfo: paint.legend, home: "seismic",
  }, "usgs");
  const held = () => (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.id === derived?.id);
  say(`${years.length} years, ${from} to now`);

  running = true;
  await startPlayer({
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    epochs, source: "none", noteFor, noteTitle, onStatus: say, interval: 700,
    startAt: startAt === null ? ALL : startAt,
    onShow: (index) => {
      const whole = index === ALL;
      const plot = held();
      if (plot) plot.legendHidden = whole;
      window.GeoIDLayerHierarchy?.setVisible?.(layer, whole ? wasVisible : false);
      built.forEach((node, i) => { node.visible = !whole && i === index; });
      if (!whole) nodeFor(index).visible = true;
      if (plot) {
        if (plot.object3D) plot.object3D.visible = !whole;
        const shown = whole ? [] : years[index][1];
        plot.features = shown;
        plot.collection = { type: "FeatureCollection", features: shown };
      }
    },
    onStop: () => {
      running = false;
      const now = held();
      if (now) window.GeoIDImportManager?.removeLayer?.(now.id);
      group.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
      const back = eventsLayer();
      if (back) window.GeoIDLayerHierarchy?.setVisible?.(back, wasVisible);
      say("");
    },
  });
  return { frames: years.length };
}

/** The span select rebuilds the sequence, under a hold so the watcher does not read it as a ✕. */
if (typeof document !== "undefined") {
  document.addEventListener("change", (event) => {
    if (event.target?.id !== "seismic-timelapse-span") return;
    if (!document.getElementById("geoid-timelapse") || !running) return;
    const work = () => build(chosenSpan(), null);
    const hold = window.GeoIDAnimatedLayers?.hold;
    void (hold ? hold(work, "earthquakes") : work());
  });
}

if (typeof window !== "undefined") {
  window.GeoIDSeismicTimelapse = { play, yearsIn, colouring, noteFor, noteTitle, MAG_EDGES, MAG_LABELS, eventsLayer };
}
