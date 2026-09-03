/**
 * IMAGERY OVER TIME — the picture alone, played.
 *
 * The glacier time-lapse answers a question about ice and carries outlines
 * with it. This one is devoted to the GROUND: a box, a range of dates, and one
 * satellite composite per step, with nothing drawn on top. Anything a reader
 * wants over it — glacier outlines, a geological map, a drawn study area — is
 * an ordinary Workspace layer and draws above the film by construction, since
 * a frame sits at renderOrder 45 and the imported band starts at 50.
 *
 * Two things are this file's own; everything else is `timelapse-player.js`,
 * shared with the glacier animator:
 *
 * - **WHICH DATES.** The archive picks the glacier animator's frames for it;
 *   here there is no archive, so a range is cut into steps — yearly, monthly
 *   or daily — and each step becomes a WINDOW the service composites over.
 *   A window rather than an instant on purpose: a single day is one overpass
 *   and mostly cloud, and Earth Engine's own answer to a range is the
 *   cloud-masked composite anybody would otherwise build by hand.
 * - **WHICH COLLECTION.** "Best for each year" walks the sensors down as the
 *   years go back, which is right for a long run and wrong for a comparison:
 *   a change that is really a change of SENSOR is the easiest false reading a
 *   time-lapse can produce. So a collection can be pinned, and the panel says
 *   how many frames fall outside the years it flew.
 *
 * NOTHING IS INVENTED BETWEEN FRAMES. Each one is a composite of real scenes
 * inside its own window; a step the sensor never saw is left blank and says so
 * rather than being interpolated from its neighbours.
 */

import { startPlayer, stopPlayer, datasetForYear, seasonFor }
  from "./timelapse-player.js?v=20260903-7b5a1e0";

export { stopPlayer as stopImageryTimelapse };

/**
 * THE COLLECTIONS OFFERED, with the years they actually flew.
 *
 * `since`/`until` are not decoration: they are what lets the panel say "9 of
 * these 30 frames are before Sentinel-2 began" BEFORE anybody spends thirty
 * requests finding out. Landsat 5's `until` is its 2012 retirement.
 */
export const COLLECTIONS = {
  auto: { label: "Best for each year", auto: true },
  s2: { id: "COPERNICUS/S2_SR_HARMONIZED", label: "Sentinel-2", metres: 10, since: 2015 },
  l9: { id: "LANDSAT/LC09/C02/T1_L2", label: "Landsat 9", metres: 30, since: 2021 },
  l8: { id: "LANDSAT/LC08/C02/T1_L2", label: "Landsat 8", metres: 30, since: 2013 },
  l7: { id: "LANDSAT/LE07/C02/T1_L2", label: "Landsat 7", metres: 30, since: 1999 },
  l5: { id: "LANDSAT/LT05/C02/T1_L2", label: "Landsat 5", metres: 30, since: 1984, until: 2012 },
  gibs: { label: "NASA GIBS — MODIS / VIIRS, 250 m", gibs: true, since: 2000 },
};

/** At most this many frames on one slider. Past it the range is STRIDED. */
export const MAX_FRAMES = 40;

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const at = (text) => Date.parse(`${text}T00:00:00Z`);

/** The middle of a window — what the bar shows, and what GIBS is asked for. */
function midpoint(from, to) {
  return iso(at(from) + Math.floor((at(to) - at(from)) / 2));
}

/** The last day of a month, without a calendar table. */
function monthEnd(year, month) {
  return iso(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) - DAY);
}

/**
 * The windows a range is cut into, before anything is capped.
 *
 * A yearly step may take the WHOLE year or that year's melt season — the same
 * hemisphere-aware window the glacier animator uses, because over ice a
 * whole-year composite is mostly the winter snow that hides the thing being
 * watched. Monthly and daily steps are their own window and ignore it.
 */
function windowsFor(from, to, step, season, lat) {
  const out = [];
  const fy = Number(from.slice(0, 4));
  const ty = Number(to.slice(0, 4));
  if (step === "year") {
    for (let y = fy; y <= ty; y += 1) {
      const w = season === "melt"
        ? seasonFor(`${y}-07-01`, lat)
        : { from: `${y}-01-01`, to: `${y}-12-31` };
      out.push({ label: String(y), from: w.from, to: w.to });
    }
  } else if (step === "month") {
    for (let y = fy; y <= ty; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const pad = String(m).padStart(2, "0");
        out.push({ label: `${y}-${pad}`, from: `${y}-${pad}-01`, to: monthEnd(y, m) });
      }
    }
  } else {
    for (let ms = at(from); ms <= at(to); ms += DAY) {
      out.push({ label: iso(ms), from: iso(ms), to: iso(ms) });
    }
  }
  /**
   * CLIPPED TO WHAT WAS ASKED FOR, and a window with nothing left of it is
   * dropped. Without this a range of 2016-06-01 to 2016-08-31 stepped yearly
   * composites the whole of 2016 and calls it the summer.
   */
  return out
    .map((w) => ({
      ...w,
      from: w.from < from ? from : w.from,
      to: w.to > to ? to : w.to,
    }))
    .filter((w) => at(w.from) <= at(w.to));
}

/**
 * The frames for a range — the whole of this module's arithmetic, kept pure so
 * it can be checked against dates whose answers are known.
 *
 * A SLIDER HAS A USEFUL LENGTH, so past `max` the sequence is STRIDED rather
 * than truncated: a time-lapse is about a span, and cutting it off at frame 40
 * would silently change which span it is. The stride is returned, because a
 * sequence stepping five years at a time while its control says "yearly" is
 * exactly the kind of quiet cap this tree keeps paying for.
 */
export function framesFor({ from, to, step = "year", season = "full", lat = 0,
  collection = "auto", max = MAX_FRAMES } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
    return { epochs: [], error: "Give a From and a To date." };
  }
  if (at(from) > at(to)) {
    return { epochs: [], error: "The From date has to come before the To date." };
  }
  const chosen = COLLECTIONS[collection] || COLLECTIONS.auto;
  const all = windowsFor(from, to, step, season, lat);
  if (!all.length) return { epochs: [], error: "That range holds no frames." };

  const stride = Math.max(1, Math.ceil(all.length / max));
  const kept = all.filter((_, i) => i % stride === 0);
  // The far end is what a reader is comparing against, so a stride that would
  // stop short of it keeps it anyway.
  if (kept[kept.length - 1] !== all[all.length - 1]) kept.push(all[all.length - 1]);

  let blind = 0;
  const epochs = kept.map((w) => {
    const year = Number(w.label.slice(0, 4));
    const dataset = chosen.auto ? datasetForYear(year) : (chosen.id ? chosen : null);
    const flew = year >= (chosen.since || 0) && year <= (chosen.until || 9999);
    if (!chosen.auto && !flew) blind += 1;
    if (chosen.auto && !dataset) blind += 1;
    return {
      date: midpoint(w.from, w.to), label: w.label,
      from: w.from, to: w.to, dataset,
    };
  });
  return { epochs, stride, dropped: all.length - kept.length, blind, collection: chosen };
}

/** Which of the player's three imagery routes a chosen collection means. */
export function sourceFor(collection) {
  const chosen = COLLECTIONS[collection];
  if (!chosen || chosen.auto) return "auto";
  if (chosen.gibs) return "gibs";
  // An explicit collection REFUSES rather than substituting: quietly serving
  // 250 m MODIS where 10 m Sentinel-2 was asked for is the sensor change the
  // choice exists to prevent.
  return "gee";
}

/**
 * What the bar says under the date: the window this frame composites over.
 *
 * Earth Engine answers with the window it ACTUALLY used, so where that matches
 * the one asked for the bar would carry the same pair of dates twice in a
 * field that ellipsises at 15rem. The prefix is therefore added only when the
 * source has not already said it — and it is added when the service narrowed
 * the window, which is exactly when a reader needs to see both.
 */
function frameNote(epoch, tail) {
  if (String(tail).includes(epoch.from)) return tail;
  return `${epoch.from} to ${epoch.to} · ${tail}`;
}

/**
 * Put an imagery sequence on the globe. No polygons, by design — whatever a
 * reader wants over it is a Workspace layer and already draws on top.
 */
export async function startImageryTimelapse({ bounds, from, to, step = "year",
  season = "full", collection = "auto", datasetId = "", onStatus = () => {} }) {
  const lat = (Number(bounds.north) + Number(bounds.south)) / 2;
  const built = framesFor({ from, to, step, season, lat, collection });
  if (built.error) { onStatus(built.error); return { frames: 0 }; }
  if (built.epochs.length < 2) {
    onStatus("That range holds one frame — widen it, or step more finely.");
    return { frames: 0 };
  }

  /**
   * A TYPED DATASET ID WINS, because the Earth Engine catalogue is a thousand
   * published collections and this dropdown is seven of them. The service
   * renders anything in Google's own catalogue with that publisher's default
   * visualisation, so night lights, NDVI or burned area play here exactly as
   * true colour does.
   */
  const typed = String(datasetId || "").trim();
  let source = sourceFor(collection);
  if (typed) {
    source = "gee";
    for (const epoch of built.epochs) epoch.dataset = { id: typed, label: typed };
  }

  await startPlayer({
    bounds, epochs: built.epochs, source, noteFor: frameNote, onStatus,
  });

  const span = `${built.epochs[0].label} to ${built.epochs[built.epochs.length - 1].label}`;
  onStatus(`${built.epochs.length} frames, ${span}`
    + (built.stride > 1 ? `, one in every ${built.stride} ${step}s` : "")
    + (built.blind
      ? `. ${built.blind} fall outside the years ${typed || built.collection.label} flew — those will be blank.`
      : ". Press play, or drag the bar."));
  return { frames: built.epochs.length, stride: built.stride, blind: built.blind };
}

if (typeof window !== "undefined") {
  window.GeoIDImageryTimelapse = { startImageryTimelapse, stopImageryTimelapse: stopPlayer, framesFor };
}
