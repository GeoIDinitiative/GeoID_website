/**
 * THE EARTHQUAKE RECORD, PLAYED A YEAR AT A TIME — the cyclone tracks' bar
 * over USGS ComCat's M >= 5 catalogue since 1900. A frame is one year's
 * earthquakes and nothing else (the year before goes in its wake); the whole
 * catalogue is the terminal All frame, where the bar parks on a tick.
 *
 * ONE PALETTE ACROSS EVERY FRAME: magnitude on fixed unit edges (5, 6, 7, 8),
 * so a M 7 is the same colour in a quiet year and a busy one.
 */

import { buildSymbology, colourOf, legendInfoFrom } from "./symbology.js?v=20260910-e1d61fb";
import { startPlayer } from "./timelapse-player.js?v=20260910-e1d61fb";

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

/**
 * THE STEPS THE RECORD CAN BE PLOTTED IN, coarsest last — the cyclone tracks'
 * own three, with the earthquake in place of the storm.
 *
 * Every event carries `time` as epoch milliseconds, so the catalogue can be
 * walked one earthquake at a time, by the month it happened in, or by its
 * year. Which is useful depends entirely on the span: a century of M >= 5 is
 * 126 years, about 1,500 months, or a hundred thousand individual arrivals.
 */
export const STEPS = {
  event: { label: "Each earthquake", key: (p) => String(p.time ?? ""), interval: 90 },
  month: { label: "By month", key: (p) => isoOf(p).slice(0, 7), interval: 200 },
  year: { label: "By year", key: (p) => String(p.year ?? isoOf(p).slice(0, 4)), interval: 700 },
};

/** The step's own default, and what the panel opens on. */
export const DEFAULT_STEP = "year";

/**
 * At most this many frames on one slider, whatever the step.
 *
 * A hundred thousand frames is a slider whose every pixel is three hundred
 * earthquakes. Past the cap the step is STRIDED — several groups to a frame —
 * and the stride is REPORTED, the rule this tree keeps paying for: a sequence
 * that quietly steps forty at a time under a control saying "each earthquake"
 * is a control telling a lie about what is being shown.
 */
export const MAX_FRAMES = 360;

/** The event's own moment, from whichever of the two the bake carried. */
function isoOf(props) {
  const t = Number(props?.time);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  const year = Number(props?.year);
  return Number.isFinite(year) ? `${year}-01-01T00:00:00.000Z` : "";
}

/**
 * The record in TIME order, grouped into the frames one step gives.
 *
 * Sorted by the moment, never by the order the file holds: the bake walks the
 * catalogue a year at a time and the service answers each year however it
 * likes, so an unsorted play steps through a year's earthquakes in an order
 * that is nobody's — least of all time's.
 */
export function framesFor(features, { from = 1900, step = DEFAULT_STEP } = {}) {
  const spec = STEPS[step] || STEPS[DEFAULT_STEP];
  const kept = features
    .filter((f) => {
      const year = Number(f?.properties?.year);
      return Number.isFinite(year) && year >= from;
    })
    .sort((a, b) => isoOf(a.properties).localeCompare(isoOf(b.properties)));
  if (!kept.length) return { groups: [], stride: 1, step, spec, total: 0 };

  const order = [];
  const byKey = new Map();
  kept.forEach((f) => {
    const key = spec.key(f.properties);
    if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
    byKey.get(key).push(f);
  });

  // Strided, never truncated: the far end of the record is what a plot is
  // building towards, and cutting it off changes which record is being shown.
  const stride = Math.max(1, Math.ceil(order.length / MAX_FRAMES));
  const groups = [];
  for (let i = 0; i < order.length; i += stride) {
    const keys = order.slice(i, i + stride);
    groups.push({ label: keys[0], keys, features: keys.flatMap((key) => byKey.get(key)) });
  }
  return { groups, stride, step, spec, total: kept.length };
}

/** The year a frame's label starts with, whatever the step wrote into it. */
export function yearOfLabel(label) {
  const iso = String(label || "");
  if (/^\d{4}/.test(iso)) return Number(iso.slice(0, 4));
  const t = Number(iso);
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
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
  const pre = epoch.year && epoch.year < 1964
    ? " — before the global network of 1964 the catalogue is complete only above about M 6" : "";
  const each = epoch.stride > 1 ? ` (one frame per ${epoch.stride} ${epoch.stepLabel || "groups"})` : "";
  return `${(epoch.count || 0).toLocaleString()} earthquakes of M ≥ 5 in ${epoch.label}${pre}${each}`;
}

export const chosenSpan = () => Number(document.getElementById("seismic-timelapse-span")?.value) || 1900;
export const chosenStep = () => document.getElementById("seismic-timelapse-step")?.value || DEFAULT_STEP;

export async function play({ from = chosenSpan(), step = chosenStep(), startAt = null } = {}) {
  if (opening) return { already: true };
  if (running && document.getElementById("geoid-timelapse")) return { already: true };
  opening = true;
  try {
    return await build(from, startAt, step);
  } finally {
    opening = false;
  }
}

async function build(from, startAt, step = DEFAULT_STEP) {
  const layer = eventsLayer();
  if (!layer?.features?.length) {
    say("Tick the earthquake catalogue on first — the animation plays the layer you have.");
    return null;
  }
  const plan = framesFor(layer.features, { from, step });
  if (!plan.groups.length) { say("No earthquakes in that span."); return null; }
  const render = await import(`./vector-render.js${search}`);
  const THREE = await import("../vendor/three.module.js");
  const paint = colouring(layer.features);
  const group = new THREE.Group();
  group.name = "GeoID-SeismicTimelapse";
  const total = layer.features.length;
  /**
   * A TICK WHERE THE YEAR TURNS, and always on the first frame.
   *
   * On a 360-frame slider the marks are what say where in the record the
   * handle is; one per frame is a solid bar. The year step is already one
   * frame a year, so there it is every decade instead — and the FIRST frame
   * is marked whatever the step, because a scale with no origin is not a
   * scale.
   */
  const epochs = plan.groups.map((g, i) => {
    const year = yearOfLabel(g.label);
    const prev = i ? yearOfLabel(plan.groups[i - 1].label) : null;
    return {
      date: String(g.label), label: String(g.label), dataset: null, year,
      count: g.features.length, total, stride: plan.stride, stepLabel: plan.spec.label,
      largest: Math.max(...g.features.map((f) => Number(f.properties.mag) || 0)),
      tick: i === 0 || (plan.step === "year"
        ? Number.isFinite(year) && year % 10 === 0
        : year !== prev),
      tickLabel: String(year ?? ""),
    };
  });
  epochs.push({ date: "all", label: "All", dataset: null, all: true, total, count: total });
  const ALL = epochs.length - 1;

  const built = new Map();
  const nodeFor = (index) => {
    if (built.has(index)) return built.get(index);
    const made = render.renderFeatureCollection(
      { type: "FeatureCollection", features: plan.groups[index].features },
      { colourFor: paint.colourFor, pointStyle: "places" },
    );
    const node = made?.object3D || made;
    node.visible = false;
    group.add(node);
    built.set(index, node);
    return node;
  };

  const wasVisible = layer.object3D ? layer.object3D.visible : true;
  const derived = window.GeoIDImportManager?.addDerivedLayer?.(`Earthquakes plotted — ${plan.spec.label.toLowerCase()}`, {
    object3D: group, georeferenced: true,
    bounds: { minX: -180, maxX: 180, minY: -90, maxY: 90 },
    features: [], collection: { type: "FeatureCollection", features: [] },
    legendInfo: paint.legend, home: "seismic",
  }, "usgs");
  const held = () => (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.id === derived?.id);
  const strideNote = plan.stride > 1 ? ` — one frame per ${plan.stride}` : "";
  say(`${plan.groups.length} frames, ${plan.spec.label.toLowerCase()}, ${from} to now${strideNote}`);

  running = true;
  await startPlayer({
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    epochs, source: "none", noteFor, noteTitle, onStatus: say, interval: plan.spec.interval,
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
        const shown = whole ? [] : plan.groups[index].features;
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
  return { frames: plan.groups.length, step: plan.step, stride: plan.stride };
}

/**
 * The span and the step both rebuild the sequence, under a hold.
 *
 * DELEGATED on the document, because the subtab is redrawn whenever the
 * catalogue is and a handler bound to the node goes stale on the first tick.
 * The hold is what stops the rebuild reading as a ✕: taking the bar down and
 * putting it back is, from outside, indistinguishable from the reader closing
 * it, and without it changing the step marked the layer dismissed and the bar
 * never came back.
 */
if (typeof document !== "undefined") {
  document.addEventListener("change", (event) => {
    const id = event.target?.id;
    if (id !== "seismic-timelapse-span" && id !== "seismic-timelapse-step") return;
    if (!document.getElementById("geoid-timelapse") || !running) return;
    const work = () => build(chosenSpan(), null, chosenStep());
    const hold = window.GeoIDAnimatedLayers?.hold;
    void (hold ? hold(work, "earthquakes") : work());
  });
}

if (typeof window !== "undefined") {
  window.GeoIDSeismicTimelapse = { play, yearsIn, framesFor, STEPS, colouring, noteFor, noteTitle, MAG_EDGES, MAG_LABELS, eventsLayer };
}
