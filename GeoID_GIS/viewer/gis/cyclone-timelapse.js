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
} from "./symbology.js?v=20260908-4034c94";
import { SAFFIR_SIMPSON_KTS } from "./event-sources.js?v=20260908-4034c94";
import { startPlayer, stopPlayer } from "./timelapse-player.js?v=20260908-4034c94";
import {
  showSeason, showClimatology, riskLayer,
} from "./cyclone-risk.js?v=20260908-4034c94";

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

export async function play({ from = MODERN, startAt = null } = {}) {
  if (running) { stopPlayer(); running = false; }
  const layer = tracksLayer();
  if (!layer?.features?.length) {
    say("Tick the cyclone tracks on first — the animation plays the layer you have.");
    return null;
  }
  const seasons = seasonsIn(layer.features, from);
  if (!seasons.length) { say("No seasons in that span."); return null; }

  const render = await import(`./vector-render.js${search}`);
  const THREE = await import("../vendor/three.module.js");
  const paint = colouring(seasons.flatMap(([, list]) => list));

  const group = new THREE.Group();
  group.name = "GeoID-CycloneTimelapse";

  /**
   * ONE EPOCH PER SEASON, AND A LAST ONE THAT IS THE WHOLE RECORD.
   *
   * The bar opens BECAUSE THE LAYER WAS TICKED, so it has to park somewhere
   * that leaves the layer saying what its own name says. The last season is
   * not that — 2026 alone is 75 storms of 13,513, so opening there would
   * answer a tick for "every storm on record" with 0.6% of it. The terminal
   * frame shows the layer itself, unchanged, and every step back from it is
   * pure gain.
   */
  // "run" only where the layer IS runs: the hurricane variant draws the
  // stretches at hurricane force, not the storms that made them.
  const noun = /hurricane tracks/i.test(layer.name || "") ? "run" : "storm";
  const total = layer.features.length;
  const epochs = seasons.map(([year, list]) => ({
    noun, total,
    // The player shows `label` and asks GIBS for `date`; with imagery off the
    // date is only ever read by the bar, so the year is both.
    date: String(year), label: String(year), dataset: null,
    from: `${year}-01-01`, to: `${year}-12-31`,
    year, count: list.length,
    named: list.filter((f) => f.properties?.name).length,
  }));
  epochs.push({
    noun, total,
    date: "all", label: "All", dataset: null, all: true,
    count: layer.features.length,
    named: layer.features.filter((f) => f.properties?.name).length,
  });
  const ALL = epochs.length - 1;

  /**
   * BUILT ON DEMAND, one season at a time.
   *
   * Building all 47 up front cost half a second and twice the geometry, which
   * is a bill nobody asked for when the bar opens on a tick rather than on a
   * press. A season is built the first time it is shown and kept; a reader who
   * never scrubs pays nothing at all.
   */
  const built = new Map();
  const nodeFor = (index) => {
    if (built.has(index)) return built.get(index);
    const made = render.renderFeatureCollection(
      { type: "FeatureCollection", features: seasons[index][1] },
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
    "Cyclone seasons — peak wind (kts)", {
      object3D: group,
      georeferenced: true,
      bounds: { minX: -180, maxX: 180, minY: -90, maxY: 90 },
      features: seasons[0][1],
      collection: { type: "FeatureCollection", features: seasons[0][1] },
      legendInfo: { ...legendInfoFrom(paint.sym, { label: FIELD, unit: "kts" }),
        field: FIELD, categorical: false },
    }, "ibtracs");

  const held = () => (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.id === derived?.id);

  running = true;
  await startPlayer({
    bounds: { west: -180, south: -90, east: 180, north: 90 },
    epochs,
    // The subject is the lines. A picture behind them costs a request per
    // frame and answers a question nobody asked of this layer.
    source: "none",
    noteFor,
    noteTitle,
    onStatus: say,
    startAt: startAt === null ? ALL : startAt,
    onShow: (index) => {
      const whole = index === ALL;
      /**
       * THE WHOLE-RECORD LAYER AND THE SEASON ARE NEVER BOTH UP. Left visible
       * together the archive draws every storm behind the one season being
       * shown, which is the web the animation exists to take apart — and on
       * the All frame the archive IS the answer, so the derived group stands
       * down instead.
       */
      window.GeoIDLayerHierarchy?.setVisible?.(layer, whole ? wasVisible : false);
      built.forEach((node) => { node.visible = false; });
      if (!whole) nodeFor(index).visible = true;
      const now = held();
      if (now) {
        if (now.object3D) now.object3D.visible = !whole;
        /**
         * THE FEATURE LIST FOLLOWS THE FRAME, the glacier driver's own lesson:
         * `featuresAt` walks `layer.features`, so a list left on the whole
         * span answers a click with a storm from a season that is not shown.
         */
        const list = whole ? [] : seasons[index][1];
        now.features = list;
        now.collection = { type: "FeatureCollection", features: list };
      }
      /**
       * AND THE RISK MAP FOLLOWS when it is on the globe. A season's cells are
       * a COUNT and the climatology's are a chance, so `showSeason` swaps the
       * legend with the map — see cyclone-risk.js. It is a REPAINT: the same
       * 91,156 cells however many years the bar steps through. On the All
       * frame it goes back to the long-run chance, which is what the layer is.
       */
      if (followRisk()) {
        if (whole) showClimatology();
        else void showSeason(seasons[index][0]);
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
  return { seasons: seasons.length, openedOn: "All" };
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
function followRisk() {
  return Boolean(riskLayer());
}

/**
 * NOTHING TO WIRE. The button that starts this lives on the catalogue row of
 * the layer it plays (`entry.play` in global-data.js), so the catalogue builds
 * and binds it -- and it exists only while that layer is on the globe, which
 * is what retired both the standing button and the sentence telling the reader
 * which box to tick first. The module is reached through its window seam.
 */

if (typeof window !== "undefined") {
  window.GeoIDCycloneTimelapse = { play, SATELLITE_ERA, MODERN };
}
