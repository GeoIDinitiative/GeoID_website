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
} from "./symbology.js?v=20260908-1650e1b";
import { SAFFIR_SIMPSON_KTS } from "./event-sources.js?v=20260908-1650e1b";
import { startPlayer, stopPlayer } from "./timelapse-player.js?v=20260908-1650e1b";
import {
  showSeason, showClimatology, riskLayer,
} from "./cyclone-risk.js?v=20260908-1650e1b";

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

function tracksLayer() {
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

/** What the bar says under the year. */
export function noteFor(epoch) {
  const storms = epoch.count;
  const named = epoch.named;
  const tail = named ? `, ${named} named` : "";
  if (epoch.year < SATELLITE_ERA) {
    return `${storms} storm(s)${tail} — pre-satellite: recorded where ships and coasts were`;
  }
  return `${storms} storm(s)${tail}`;
}

export async function play({ from = MODERN } = {}) {
  if (running) { stopPlayer(); running = false; }
  const layer = tracksLayer();
  if (!layer?.features?.length) {
    say("Tick the cyclone tracks on first — the animation plays the layer you have.");
    return null;
  }
  const seasons = seasonsIn(layer.features, from);
  if (!seasons.length) { say("No seasons in that span."); return null; }

  say(`Building ${seasons.length} seasons…`);
  const render = await import(`./vector-render.js${search}`);
  const THREE = await import("../vendor/three.module.js");

  const spanFeatures = seasons.flatMap(([, list]) => list);
  const paint = colouring(spanFeatures);

  const group = new THREE.Group();
  group.name = "GeoID-CycloneTimelapse";
  const epochs = [];
  const frames = seasons.map(([year, list]) => {
    const built = render.renderFeatureCollection(
      { type: "FeatureCollection", features: list },
      { colourFor: paint.colourFor, outlineOnly: false },
    );
    const node = built?.object3D || built;
    node.visible = false;
    group.add(node);
    epochs.push({
      // The player shows `label` and asks GIBS for `date`; with imagery off
      // the date is only ever read by the bar, so the year is both.
      date: String(year), label: String(year), dataset: null,
      from: `${year}-01-01`, to: `${year}-12-31`,
      year,
      count: list.length,
      named: list.filter((f) => f.properties?.name).length,
    });
    return node;
  });

  /**
   * The whole-record layer stands down while a season is on screen, and comes
   * back when the bar closes. Left visible it draws every storm behind the one
   * season being shown, which is the web the animation exists to take apart.
   */
  const wasVisible = layer.object3D ? layer.object3D.visible : true;
  window.GeoIDLayerHierarchy?.setVisible?.(layer, false);

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
    frames,
    noteFor,
    onStatus: say,
    /**
     * THE FEATURE LIST FOLLOWS THE FRAME, the glacier driver's own lesson:
     * `featuresAt` walks `layer.features`, so a list left on the whole span
     * answers a click with a storm from a season that is not on screen.
     */
    onShow: (index) => {
      const now = held();
      if (now) {
        now.features = seasons[index][1];
        now.collection = { type: "FeatureCollection", features: seasons[index][1] };
      }
      /**
       * AND THE RISK MAP FOLLOWS, when it is on the globe and the box is
       * ticked. A season's cells are a COUNT and the climatology's are a
       * chance, so `showSeason` swaps the legend with the map -- see
       * cyclone-risk.js. It is a REPAINT: the geometry is the same 91,156
       * cells however many years the bar steps through.
       *
       * Silent when the risk layer is not loaded, because it usually is not:
       * the animation is worth watching on its own, and fetching a 23 MB map
       * because somebody pressed play is the app deciding what they came for.
       */
      if (followRisk()) void showSeason(seasons[index][0]);
    },
    onStop: () => {
      running = false;
      // The risk layer's own subject is the long-run rate, so closing the bar
      // must leave it saying what its name says rather than holding whichever
      // season the bar happened to stop on.
      if (riskLayer()) showClimatology();
      const now = held();
      if (now) window.GeoIDImportManager?.removeLayer?.(now.id);
      group.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
      const back = tracksLayer();
      if (back) window.GeoIDLayerHierarchy?.setVisible?.(back, wasVisible);
      say("");
    },
  });
  return { seasons: seasons.length };
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
