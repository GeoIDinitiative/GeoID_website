/**
 * THE CYCLONE ARCHIVE, PLAYED A SEASON AT A TIME.
 *
 * The tracks layer holds 13,513 storms at once, which is the whole record and
 * therefore a web: every basin's traffic since 1842 drawn on top of itself.
 * Played by season it becomes what it actually is — a year of storms, then the
 * next — and the shape of a season (the Atlantic's late summer, the western
 * Pacific's year-round work) is visible for the first time.
 *
 * A THIRD DRIVER FOR THE ONE PLAYER. `timelapse-player.js` owns the bar, the
 * slider, the play loop, the world-clock hold and the spin hold; the glacier
 * and imagery animators are the other two. What a driver supplies is a box, an
 * ordered list of epochs and optionally one scene node per epoch — this one
 * supplies a node per SEASON and asks for no imagery at all, because the
 * subject is the lines.
 *
 * WHAT THE DATES ARE. Every storm carries `season`, `start` and `end` from the
 * bake. Per-FIX times are not in the file, so this steps SEASONS rather than
 * drawing each track as it happened — a storm appears whole in its own year.
 * Animating a track fix by fix would need the 726,506 observation times, which
 * is a re-bake and a larger file; it is worth doing, and it is not this.
 */

import {
  buildSymbology, colourOf, legendInfoFrom,
} from "./symbology.js?v=20260908-274b8f3";
import { SAFFIR_SIMPSON_KTS } from "./event-sources.js?v=20260908-274b8f3";
import { startPlayer, stopPlayer } from "./timelapse-player.js?v=20260908-274b8f3";
import {
  showSeason, showClimatology, riskLayer,
} from "./cyclone-risk.js?v=20260908-274b8f3";

const search = new URL(import.meta.url).search;

const FIELD = "peak_wind_kts";
const RAMP = "risk";

/**
 * WHERE THE RECORD BECOMES COMPARABLE WITH ITSELF.
 *
 * IBTrACS is a best-track archive, not a census: before the satellites a storm
 * was recorded where ships and coasts were, so the archive's own storm count
 * rises through the twentieth century for reasons that are mostly
 * OBSERVATIONAL. Played from 1842 that reads as a world getting steadily
 * stormier, which is a claim this data cannot make and nobody here is making.
 *
 * So the default span is the satellite era, and the whole archive is offered
 * beside it rather than instead of it — with every pre-satellite frame saying
 * what it is, because the honest answer to "why are there so few" is on the
 * frame rather than in a footnote.
 */
export const SATELLITE_ERA = 1966;
export const MODERN = 1980;

let running = false;
let opening = false;

const byId = (id) => document.getElementById(id);

/**
 * THE LAYER THE CATALOGUE ENTRY IS LOADED AS — asked, not matched by name.
 *
 * This matched `/cyclone tracks/i`, which was the layer's name until the entry
 * grew a second variant: switched to hurricane force it is "Hurricane tracks",
 * the pattern missed it, and the sequence reported "tick the cyclone tracks on
 * first" over a ticked layer. Silent, because a driver that cannot find its
 * layer says exactly what one that has none says.
 *
 * `layerForDataset` is the catalogue's own answer and follows the variant by
 * construction. The name match survives only for a page where the seam has not
 * loaded yet, and only for the default variant, which is all it was ever right
 * about.
 */
function tracksLayer() {
  const byEntry = window.GeoIDGlobalData?.layerForDataset?.("cyclone-tracks");
  if (byEntry) return byEntry;
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.name && /cyclone tracks/i.test(l.name)) || null;
}

function say(message) {
  const node = byId("cyclone-play-status");
  if (node) node.textContent = message;
}

/**
 * The seasons present in the data, not a range counted off from a start year:
 * the archive has gaps, and an epoch for a season with nothing in it is a
 * frame that draws nothing and reads as the player having broken.
 */
/**
 * THE STEPS THE RECORD CAN BE PLOTTED IN, coarsest last.
 *
 * Every track carries `start` as a date, so the archive can be walked by the
 * storm, by the month it began in, or by its season. Which of the three is
 * useful depends entirely on how much record is in the span: 4,982 storms
 * since 1980 is 47 seasons, 564 months, or 4,982 individual arrivals.
 */
export const STEPS = {
  storm: { label: "Each storm", key: (p) => String(p.start || ""), interval: 90 },
  month: { label: "By month", key: (p) => String(p.start || "").slice(0, 7), interval: 200 },
  season: { label: "By season", key: (p) => String(p.season || ""), interval: 900 },
};

/**
 * At most this many frames on one slider, whatever the step.
 *
 * 4,982 frames is a slider whose every pixel is nine storms and a play that
 * takes seven minutes at the fastest rate offered. Past the cap the step is
 * STRIDED -- several storms to a frame -- and the stride is REPORTED, the same
 * rule the imagery animator follows: a sequence that quietly steps thirteen at
 * a time under a control saying "each storm" is the silent cap this tree keeps
 * paying for.
 */
export const MAX_FRAMES = 360;

/**
 * The record in time order, grouped into the frames one step gives.
 *
 * PLOTTED, NOT REPLACED: frame N holds the storms that ARRIVE in it, and the
 * player shows every frame up to N, so the archive draws itself in. That is
 * what "plot the tracks one after another" means, and it is why the counter on
 * the bar reads a running total rather than one frame's own count.
 *
 * Sorted by the DATE, never by the order the file holds: the bake sorts by
 * season and then by storm id, so playing it unsorted steps through a season's
 * storms in an order that is nobody's -- least of all time's.
 */
export function framesFor(features, { from = MODERN, step = "season" } = {}) {
  const spec = STEPS[step] || STEPS.season;
  const kept = features
    .filter((f) => {
      const year = Number(f?.properties?.season);
      return Number.isFinite(year) && year >= from && f?.properties?.start;
    })
    .sort((a, b) => String(a.properties.start).localeCompare(String(b.properties.start)));
  if (!kept.length) return { groups: [], stride: 1, step, spec };

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
    groups.push({
      label: keys[0],
      keys,
      features: keys.flatMap((key) => byKey.get(key)),
    });
  }
  return { groups, stride, step, spec, total: kept.length };
}

/**
 * The seasons present in the data, not a range counted off from a start year:
 * the archive has gaps, and an epoch for a season with nothing in it is a
 * frame that draws nothing and reads as the player having broken.
 */
export function seasonsIn(features, from) {
  const byYear = new Map();
  features.forEach((f) => {
    const year = Number(f?.properties?.season);
    if (!Number.isFinite(year) || year < from) return;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(f);
  });
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * ONE PALETTE ACROSS EVERY FRAME, and it is the layer's own.
 *
 * A symbology rebuilt per frame would classify each season against its own
 * spread, so the same 90-knot storm is a different colour in a quiet year and
 * a busy one — the map becomes about the frame rather than about the storms.
 * Built once from every value in the span, on the SAME Saffir-Simpson edges
 * the static layer and the live markers use.
 */
function colouring(features) {
  const values = features
    .map((f) => Number(f?.properties?.[FIELD]))
    .filter((n) => Number.isFinite(n));
  const sym = buildSymbology(values, { edges: SAFFIR_SIMPSON_KTS, ramp: RAMP });
  return {
    sym,
    colourFor: (feature) => {
      const raw = feature?.properties?.[FIELD];
      const n = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
      // A storm with no measured peak keeps no colour rather than the bottom
      // class: "not measured" and "weak" are different things, and most of the
      // early record is the first.
      return Number.isFinite(n) ? colourOf(n, sym) : null;
    },
  };
}

/**
 * What the bar says under the year: A COUNTER AGAINST THE TOTAL.
 *
 * It used to read "13513 storms, 5733 named", of which the reader saw
 * "13513 storms, 5733..." — the field is 104px of a 130px sentence, and the
 * half that got cut was the half that needed the other half to mean anything.
 * A running count against the archive is shorter AND says more: how much of
 * the record this frame is, which is the question a sequence invites.
 *
 * THE NOUN COMES FROM THE FRAME, because the entry has two readings and only
 * one of them draws storms. The hurricane runs are 3,700 stretches over 2,929
 * storms, so calling them storms would overstate the count by a quarter.
 */
export function noteFor(epoch) {
  const noun = epoch.noun || "storm";
  const n = Number(epoch.count) || 0;
  const total = Number(epoch.total) || 0;
  const counter = total ? `${n.toLocaleString()} / ${total.toLocaleString()}` : `${n}`;
  // The noun rides on the ALL frame, where there is room and where a bare
  // "13,513 / 13,513" would say nothing a reader could not already see.
  const said = epoch.all ? `${total.toLocaleString()} ${noun}s` : counter;
  if (Number.isFinite(epoch.year) && epoch.year < SATELLITE_ERA) {
    // Kept, and kept SHORT: the claim matters more than the sentence, and a
    // long one is the thing that gets cut. The full wording is on the title.
    return `${said} — pre-satellite`;
  }
  return said;
}

/** The sentence too long for the bar, carried on its tooltip. */
export function noteTitle(epoch) {
  const noun = epoch.noun || "storm";
  const named = epoch.named ? `, ${epoch.named.toLocaleString()} named` : "";
  // "13,513 of 13,513" is a fraction of itself. On the All frame the count IS
  // the archive, and saying so twice reads as a number that failed to update.
  const of = epoch.total && Number(epoch.count) !== Number(epoch.total)
    ? ` of ${Number(epoch.total).toLocaleString()} in the archive` : "";
  const said = `${Number(epoch.count).toLocaleString()} ${noun}s${of}${named}`;
  if (Number.isFinite(epoch.year) && epoch.year < SATELLITE_ERA) {
    return `${said} — before the satellites a storm was recorded where ships `
      + "and coasts were, so the count is a record of observation as much as "
      + "of weather.";
  }
  return said;
}

export async function play({ from = MODERN, startAt = null, step = null } = {}) {
  // Same window as the raster's: building the epochs and the derived layer
  // takes long enough for a second caller to arrive before `running` is set,
  // and the second one's teardown runs the first one's `onStop`.
  if (opening) return null;
  if (running && document.getElementById("geoid-timelapse")) return null;
  if (running) { stopPlayer(); running = false; }
  opening = true;
  try {
    return await build({ from, startAt, step: step || chosenStep() });
  } finally {
    opening = false;
  }
}

async function build({ from, startAt, step }) {
  const layer = tracksLayer();
  if (!layer?.features?.length) {
    say("Tick the cyclone tracks on first — the animation plays the layer you have.");
    return null;
  }
  const plan = framesFor(layer.features, { from, step });
  if (!plan.groups.length) { say("No storms in that span."); return null; }

  const render = await import(`./vector-render.js${search}`);
  const THREE = await import("../vendor/three.module.js");
  const paint = colouring(plan.groups.flatMap((g) => g.features));

  const group = new THREE.Group();
  group.name = "GeoID-CycloneTimelapse";
  const noun = /hurricane tracks/i.test(layer.name || "") ? "run" : "storm";
  const total = layer.features.length;

  /**
   * ONE EPOCH PER GROUP, AND A LAST ONE THAT IS THE WHOLE LAYER.
   *
   * The cumulative frames only ever reach the span being played — 4,982 storms
   * since 1980, against 13,513 in the archive — so the terminal frame is what
   * lets the bar be opened on a tick without the layer losing two thirds of
   * itself. Every step back from it is pure gain.
   */
  let running_total = 0;
  const epochs = plan.groups.map((g, i) => {
    running_total += g.features.length;
    const label = String(g.label);
    const year = Number(label.slice(0, 4));
    const prev = i ? String(plan.groups[i - 1].label).slice(0, 4) : null;
    return {
      date: label, label, dataset: null, noun, total,
      count: running_total,
      // A TICK WHERE THE YEAR TURNS. On a 354-frame slider the marks are what
      // say where in the record the handle is; per frame they would be a solid
      // bar, and the season step is one frame a year already.
      tick: plan.step === "season"
        ? Number.isFinite(year) && year % 10 === 0
        : String(year) !== prev,
      tickLabel: String(year),
      year: Number.isFinite(year) ? year : null,
      group: i,
    };
  });
  epochs.push({
    noun, total, date: "all", label: "All", dataset: null, all: true,
    count: total, named: layer.features.filter((f) => f.properties?.name).length,
  });
  const ALL = epochs.length - 1;

  /**
   * BUILT ON DEMAND and kept, because the frames ACCUMULATE: stepping forward
   * reveals one more group over the ones already drawn, so nothing is rebuilt
   * and a reader who never scrubs pays for nothing.
   */
  const built = new Map();
  const nodeFor = (index) => {
    if (built.has(index)) return built.get(index);
    const made = render.renderFeatureCollection(
      { type: "FeatureCollection", features: plan.groups[index].features },
      { colourFor: paint.colourFor, outlineOnly: false },
    );
    const node = made?.object3D || made;
    node.visible = false;
    group.add(node);
    built.set(index, node);
    return node;
  };

  const wasVisible = layer.object3D ? layer.object3D.visible : true;

  const derived = window.GeoIDImportManager?.addDerivedLayer?.(
    `Cyclone tracks plotted — ${plan.spec.label.toLowerCase()}`, {
      object3D: group,
      georeferenced: true,
      bounds: { minX: -180, maxX: 180, minY: -90, maxY: 90 },
      features: plan.groups[0].features,
      collection: { type: "FeatureCollection", features: plan.groups[0].features },
      legendInfo: { ...legendInfoFrom(paint.sym, { label: FIELD, unit: "kts" }),
        field: FIELD, categorical: false },
      // It stands in for the tracks layer, so it lights the tracks' own tab.
      home: "hazards",
    }, "ibtracs");

  const held = () => (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.id === derived?.id);

  // The stride is REPORTED, never silent: a sequence stepping twelve storms a
  // frame under a control saying "each storm" is the cap this tree keeps
  // paying for.
  const strided = plan.stride > 1
    ? ` — one frame per ${plan.stride} ${plan.step === "season" ? "seasons"
      : plan.step === "month" ? "months" : `${noun}s`}` : "";
  say(`${plan.groups.length} frames, ${plan.spec.label.toLowerCase()}${strided}`);

  running = true;
  await startPlayer({
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    epochs,
    source: "none",
    noteFor,
    noteTitle,
    onStatus: say,
    interval: plan.spec.interval,
    startAt: startAt === null ? ALL : startAt,
    onShow: (index) => {
      const whole = index === ALL;
      /**
       * THE WHOLE-RECORD LAYER AND THE PLOT ARE NEVER BOTH UP. Left visible
       * together the archive draws every storm behind the ones being plotted,
       * which is the web the animation exists to take apart — and on the All
       * frame the archive IS the answer, so the plot stands down instead.
       */
      /**
       * AND NEITHER ARE THEIR KEYS. One dataset draws one thing, so it gets
       * one card — the risk map's own rule, met here from the other side.
       * Measured on the All frame: the plot was invisible and its card was
       * still listed, so the corner carried two keys for one layer and the
       * one describing what was drawn was the second of them.
       */
      const plot = held();
      if (plot) plot.legendHidden = whole;
      window.GeoIDLayerHierarchy?.setVisible?.(layer, whole ? wasVisible : false);
      if (whole) {
        built.forEach((node) => { node.visible = false; });
      } else {
        // CUMULATIVE: every group up to here, so the record draws itself in.
        for (let i = 0; i <= index; i += 1) nodeFor(i).visible = true;
        built.forEach((node, i) => { if (i > index) node.visible = false; });
      }
      const now = plot;
      if (now) {
        if (now.object3D) now.object3D.visible = !whole;
        /**
         * THE FEATURE LIST FOLLOWS THE FRAME, the glacier driver's own lesson:
         * `featuresAt` walks `layer.features`, so a list left on the whole
         * span answers a click with a storm that is not on screen.
         */
        const shown = whole ? [] : plan.groups.slice(0, index + 1)
          .flatMap((g) => g.features);
        now.features = shown;
        now.collection = { type: "FeatureCollection", features: shown };
      }
      if (followRisk()) {
        if (whole) showClimatology();
        else if (epochs[index].year) void showSeason(epochs[index].year);
      }
    },
    onStop: () => {
      running = false;
      const now = held();
      if (now) window.GeoIDImportManager?.removeLayer?.(now.id);
      group.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
      const back = tracksLayer();
      if (back) window.GeoIDLayerHierarchy?.setVisible?.(back, wasVisible);
      if (riskLayer()) showClimatology();
      say("");
    },
  });
  return { frames: plan.groups.length, stride: plan.stride, step: plan.step };
}

/**
 * THE RISK MAP FOLLOWS BECAUSE IT IS THERE, not because a box was ticked.
 *
 * There was a tick, and it was a second switch for one decision: putting the
 * risk map on the globe and then pressing play on the seasons beside it says
 * what you want, and a control that toggles what the tick already implies is
 * the volcano Names button's own fault -- removed from `catalogue-list.js` for
 * exactly this, with the reasoning still written there.
 *
 * Safe to make automatic because it is REVERSIBLE and says so: the key changes
 * with the map (a season's classes are counts, the climatology's are return
 * periods), and closing the bar puts the climatology back. Nothing is left in
 * a state somebody has to find their way out of.
 */
/**
 * Which step the panel is asking for. Read at the press, not closed over: the
 * subtab redraws whenever the catalogue does.
 */
function chosenStep() {
  const value = byId("cyclone-timelapse-step")?.value;
  return STEPS[value] ? value : "season";
}

/** How far back to play, read the same way and for the same reason. */
function chosenSpan() {
  const value = Number(byId("cyclone-timelapse-span")?.value);
  return Number.isFinite(value) && value > 0 ? value : MODERN;
}

/**
 * THE TWO SELECTS ARE THE ONLY CONTROLS NOW, so they have to act.
 *
 * There was a "Play seasons" button and it read both of them at the press, so
 * neither needed a listener -- which is what the note at the foot of this file
 * used to say. With the bar opening on the tick instead there is no press, and
 * both were measured INERT: the step could be moved to "Each storm" and the
 * bar went on reading "47 frames, by season". A control that changes nothing
 * is worse than one that is not there.
 *
 * Only while the bar is up: with no sequence there is nothing to rebuild, and
 * the value is read at the next build anyway. And the rebuild is HELD, because
 * taking the bar down and putting it back is exactly what a ✕ looks like from
 * `animated-layers` -- without that it marks the entry dismissed mid-rebuild
 * and the sequence that finishes building is never allowed to reopen.
 */
async function replay() {
  if (!running || !byId("geoid-timelapse")) return null;
  const work = async () => {
    stopPlayer();
    running = false;
    return build({ from: chosenSpan(), startAt: null, step: chosenStep() });
  };
  const gate = window.GeoIDAnimatedLayers?.hold;
  return gate ? gate(work) : work();
}

function followRisk() {
  return Boolean(riskLayer());
}

/**
 * NOTHING STARTS THIS FROM THE PANEL. The bar opens because the layer is on
 * the globe (`entry.animation` in global-data.js, opened by `animated-layers`)
 * -- which is what retired the play button and the sentence telling the reader
 * which box to tick first. What the panel still owns is HOW the record is
 * plotted, and those two selects are wired below.
 *
 * Delegated on the document rather than bound to the elements: the subtab is
 * redrawn whenever the catalogue is, so a handler on the node goes stale the
 * first time a row is ticked.
 */
const STEP_CONTROLS = ["cyclone-timelapse-step", "cyclone-timelapse-span"];

if (typeof window !== "undefined") {
  window.GeoIDCycloneTimelapse = { play, replay, SATELLITE_ERA, MODERN };
  document.addEventListener("change", (event) => {
    if (STEP_CONTROLS.includes(event.target?.id)) void replay();
  });
}
