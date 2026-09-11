/**
 * THE EARTHQUAKE RECORD, PLAYED A YEAR AT A TIME — the cyclone tracks' bar
 * over USGS ComCat's M >= 5 catalogue since 1900. A frame is one year's
 * earthquakes and nothing else (the year before goes in its wake); the whole
 * catalogue is the terminal All frame, where the bar parks on a tick.
 *
 * ONE PALETTE ACROSS EVERY FRAME: magnitude on fixed unit edges (5, 6, 7, 8),
 * so a M 7 is the same colour in a quiet year and a busy one.
 */

import { colourOf, legendInfoFrom } from "./symbology.js?v=20260911-b4bfa93";
import { startPlayer } from "./timelapse-player.js?v=20260911-b4bfa93";
/**
 * The bands live in their own module because the PANEL needs them too, and
 * `catalogue-panels.js` must not drag the player in behind them. What is
 * re-exported here is what this module's own callers have always read.
 */
import { MAG_EDGES, MAG_LABELS, MAG_FLOORS, magOf, bandSymbology }
  from "./seismic-magnitude.js?v=20260911-b4bfa93";

export { MAG_EDGES, MAG_LABELS, MAG_FLOORS, magOf };

const search = new URL(import.meta.url).search;
export const SPANS = {
  1008: "1008 to now — the whole record, historical included",
  1900: "1900 to now — the instrumental record",
  1964: "1964 to now — the global network",
  2000: "2000 to now",
};

let running = false;
let opening = false;

function say(message) {
  const node = document.getElementById("seismic-play-status");
  if (node) node.textContent = message;
}

/**
 * The record's layer, ASKED FOR BY DATASET rather than matched by name.
 *
 * It was `/earthquakes \(USGS ComCat/i`, which stopped matching the day the
 * record became three catalogues and the layer was renamed with them — and it
 * fails as "tick the catalogue on first", the same sentence a layer that is
 * genuinely absent produces, over a layer sitting on the globe with 312,500
 * features in it. `layerForDataset` follows the entry's own name by
 * construction, so a rename cannot break it again; the pattern survives only
 * as a fallback for a page where the catalogue module has not loaded.
 */
export function eventsLayer(layers = null) {
  const byId = window.GeoIDGlobalData?.layerForDataset?.("earthquakes");
  if (byId) return byId;
  const held = layers || window.GeoIDImportManager?.getLayers?.() || [];
  return held.find((l) => l.name && /earthquakes \(/i.test(l.name)) || null;
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
  /**
   * The KEY groups and the SHOW reads. An event's key has to be unique, so it
   * is the full instant; a raw epoch millisecond on the date pill is not a
   * date to anybody, so what is shown is the minute it happened in.
   */
  event: { label: "Each earthquake", key: (p) => isoOf(p), show: (k) => k.slice(0, 16).replace("T", " "), interval: 90 },
  month: { label: "By month", key: (p) => isoOf(p).slice(0, 7), show: (k) => k, interval: 200 },
  year: { label: "By year", key: (p) => String(p.year ?? isoOf(p).slice(0, 4)), show: (k) => k, interval: 700 },
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
  /**
   * SORTED ON A NUMBER, and the key computed ONCE per event.
   *
   * `.sort((a, b) => isoOf(a).localeCompare(isoOf(b)))` calls the key builder
   * twice per COMPARISON — for 312,500 events that is roughly twelve million
   * `Date` objects and their ISO strings, which is both slow enough to look
   * like a control that does nothing and exactly the kind of allocation this
   * bake has already been asked to stop making. The instant is a number
   * already; a historical event with no `time` sorts by its year.
   */
  const kept = [];
  features.forEach((f) => {
    const year = Number(f?.properties?.year);
    if (!Number.isFinite(year) || year < from) return;
    const t = Number(f?.properties?.time);
    kept.push([Number.isFinite(t) ? t : Date.UTC(year, 0, 1), f]);
  });
  kept.sort((a, b) => a[0] - b[0]);
  if (!kept.length) return { groups: [], stride: 1, step, spec, total: 0 };

  const order = [];
  const byKey = new Map();
  kept.forEach(([, f]) => {
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
    groups.push({
      label: keys[0], show: spec.show ? spec.show(String(keys[0])) : String(keys[0]),
      keys, features: keys.flatMap((key) => byKey.get(key)),
    });
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

/**
 * The frames' paint, on the PINNED five classes.
 *
 * It used to classify the frame's own values, which drops a class that falls
 * outside their range AND spreads the ramp across what is left — so a span
 * with no M 8 in it handed M 7–7.9 the top colour, and a magnitude band
 * switched off in the panel recoloured every band still on screen. The rows
 * and their colours are fixed now and only the counts are the data's, which
 * is also what makes one palette hold across every frame.
 */
export function colouring(features) {
  const sym = bandSymbology(features.map((f) => magOf(f?.properties)));
  return {
    sym,
    colourFor: (feature) => {
      const n = magOf(feature?.properties);
      return Number.isFinite(n) ? colourOf(n, sym) : null;
    },
    legend: {
      ...legendInfoFrom(sym, { label: "Magnitude (Mw where ISC-GEM reaches)" }),
      field: "mag_best", categorical: false,
    },
  };
}

export function noteFor(epoch) {
  /**
   * "M ≥ 4.5" IS A CLAIM ABOUT WHAT IS PLOTTED, and a magnitude band switched
   * off in the panel makes it false — the count fell to what was left and the
   * sentence beside it went on naming the record's own floor. When bands are
   * hidden the note says the ratio instead, which is true whichever of them
   * are off and needs no list; the panel beside it names them.
   */
  if (epoch.all) {
    return epoch.held && epoch.held !== epoch.total
      ? `${(epoch.total || 0).toLocaleString()} of ${epoch.held.toLocaleString()} earthquakes`
      : `${(epoch.total || 0).toLocaleString()} earthquakes M ≥ 4.5`;
  }
  const big = epoch.largest ? ` · largest M ${epoch.largest.toFixed(1)}` : "";
  return `${(epoch.count || 0).toLocaleString()} / ${(epoch.total || 0).toLocaleString()}${big}`;
}

/**
 * What a frame is standing on, said on the frame rather than in a footnote.
 *
 * The record reaches back to 1008 and its completeness changes twice on the
 * way: GEM's historical catalogue is the large events somebody knows about,
 * ISC-GEM homogenises everything from 1904, and the global network of 1964 is
 * where M 5 becomes complete. A frame that does not say which of those it sits
 * in is a count read as a rate.
 */
export function noteTitle(epoch) {
  if (epoch.all) {
    const record = "The merged record: USGS ComCat M ≥ 4.5 since 1900, ISC-GEM's homogenised Mw"
      + " for 1904–2021, and GEM's historical catalogue back to 1008";
    return epoch.held && epoch.held !== epoch.total
      ? `${record} — magnitude bands are switched off in the panel, so this plots ${(epoch.total || 0).toLocaleString()} of them`
      : record;
  }
  let pre = "";
  if (epoch.year && epoch.year < 1904) {
    pre = " — pre-instrumental: GEM's historical catalogue holds the large events (about M ≥ 7)"
      + " that are known about, not a complete record of the period";
  } else if (epoch.year && epoch.year < 1964) {
    pre = " — before the global network of 1964 the catalogue is complete only above about M 6";
  }
  const each = epoch.stride > 1 ? ` (one frame per ${epoch.stride} ${epoch.stepLabel || "groups"})` : "";
  return `${(epoch.count || 0).toLocaleString()} earthquakes in ${epoch.label}${pre}${each}`;
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
    /**
     * Two different silences, and one sentence for each. A layer that is not
     * there wants ticking on; a layer whose every magnitude band is switched
     * off is a decision the reader has just made, and telling them to load
     * what they are already holding reads as the control being broken.
     */
    say(layer?._allFeatures?.length
      ? "Every magnitude is switched off — turn a band back on to plot the record."
      : "Tick the earthquake catalogue on first — the animation plays the layer you have.");
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
      date: String(g.label), label: String(g.show ?? g.label), dataset: null, year,
      count: g.features.length, total, stride: plan.stride, stepLabel: plan.spec.label,
      largest: Math.max(...g.features.map((f) => magOf(f.properties) || 0)),
      tick: i === 0 || (plan.step === "year"
        ? Number.isFinite(year) && year % 10 === 0
        : year !== prev),
      tickLabel: String(year ?? ""),
    };
  });
  const heldTotal = layer._allFeatures?.length || total;
  epochs.push({ date: "all", label: "All", dataset: null, all: true, total, count: total, held: heldTotal });
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
  /**
   * SAID AFTER THE SWAP, NOT BEFORE IT.
   *
   * `startPlayer` stops whatever sequence is running, and that teardown calls
   * `say("")` — so a status written before it is wiped by the sequence being
   * replaced, and every rebuild left the line blank. Measured: the step select
   * changed the frames and cleared the sentence describing them.
   */
  const strideNote = plan.stride > 1 ? ` — one frame per ${plan.stride}` : "";
  const summary = `${plan.groups.length} frames, ${plan.spec.label.toLowerCase()}, ${from} to now${strideNote}`;

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
  say(summary);
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
    /**
     * The MAGNITUDE ticks rebuild too, and they must.
     *
     * A frame is built from `layer.features`, which the panel has already
     * filtered by the time this runs — the tick's own handler is bound to the
     * tick and fires at the target, this one listens on the document and
     * fires after it. Without the rebuild the bar goes on showing frames cut
     * from a set the layer no longer holds, which is a sequence quietly
     * describing data that is not on the globe.
     */
    const isBand = typeof id === "string" && id.startsWith("seismic-mag-");
    if (!isBand && id !== "seismic-timelapse-span" && id !== "seismic-timelapse-step") return;
    if (!document.getElementById("geoid-timelapse") || !running) return;
    const work = () => build(chosenSpan(), null, chosenStep());
    const hold = window.GeoIDAnimatedLayers?.hold;
    void (hold ? hold(work, "earthquakes") : work());
  });
}

if (typeof window !== "undefined") {
  window.GeoIDSeismicTimelapse = { play, yearsIn, framesFor, STEPS, magOf, SPANS, colouring, noteFor, noteTitle, MAG_EDGES, MAG_LABELS, eventsLayer };
}
