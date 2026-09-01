/**
 * GLACIER TIME-LAPSE — the archive's own dates, stepped through.
 *
 * A change map answers "how much" in one number. A reader looking at a
 * retreating tongue wants to SEE it, and the archive has what that needs: not
 * two outlines but every outline anybody submitted, each with the date of the
 * image it was drawn from. This plays them in order, with imagery from the
 * same date underneath, so the outline and the ground move together.
 *
 * WHAT IS HERE, AND WHAT IS NOT. The bar, the slider, the play loop, the scene
 * cache and the GEE→GIBS→none fallback are `timelapse-player.js`, shared with
 * the imagery animator — there is one player over this globe and two drivers
 * for it. What is this file's own is the half that is about ICE: which dates
 * the archive holds, what the ice looked like on each of them, and which
 * satellite was overhead in that year.
 *
 * `glims-outlines` fetches the outlines (`all: true`, which keeps the older
 * ones the change layer deliberately drops) and `renderFeatureCollection`
 * builds each frame's geometry once.
 *
 * EVERY SCENE IS A REQUEST, and Earth Engine's are billed, so nothing is
 * fetched until the timeline reaches it, everything is cached, and the panel
 * says how many frames it is about to step through before it starts.
 */

const search = new URL(import.meta.url).search;

import { startPlayer, stopPlayer, datasetForYear, seasonFor, IMAGERY_SOURCES }
  from "./timelapse-player.js?v=20260901-6fd0a7e";

// Re-exported rather than re-implemented: the panel, the tests and this file
// must be talking about the SAME rule for which satellite covers which year.
export { datasetForYear, seasonFor, IMAGERY_SOURCES };

/**
 * The dates worth stepping through.
 *
 * One epoch per distinct date the archive holds here. Where there are more
 * than the bar can be scrubbed through usefully, the fullest dates win — an
 * epoch holding three outlines of a valley is a frame nobody can read, and
 * dropping it is better than a slider with two hundred stops. What was dropped
 * is RETURNED rather than swallowed, so the panel can say so.
 */
export function epochsFrom(features, { max = 24 } = {}) {
  const byDate = new Map();
  for (const feature of features || []) {
    const date = String(feature?.properties?.outline_date
      || feature?.properties?.src_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(feature);
  }
  const all = [...byDate.entries()].map(([date, list]) => ({ date, features: list }));
  all.sort((a, b) => b.features.length - a.features.length);
  const kept = all.slice(0, max).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { epochs: kept, dropped: Math.max(0, all.length - kept.length) };
}

/**
 * THE STATE OF THE ICE AS OF EACH DATE, not the outlines filed on it.
 *
 * The archive is a record of SUBMISSIONS, and they are wildly uneven: measured
 * over one Valais box, 410 outlines were filed on 2003-08-13 and 8 on
 * 2018-09-01. Drawing each date's own filings made whole glaciers appear and
 * vanish between frames — reported as the fills jumping around, and they were.
 *
 * A frame should say what the ice WAS on that date: for every glacier, the most
 * recent outline up to and including it. A glacier nobody remapped simply keeps
 * the outline it had, which is exactly what a reader means by "then", and what
 * moves between frames is only the ice that was actually remapped.
 *
 * Nothing is invented: every polygon drawn is a real outline with a real date,
 * and the card still names the date THAT outline was taken from.
 */
export function stateAsOf(features, epochs) {
  const held = new Map();
  const byDate = new Map();
  for (const feature of features || []) {
    const date = String(feature?.properties?.outline_date
      || feature?.properties?.src_date || "").slice(0, 10);
    const id = feature?.properties?.glac_id;
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ id, feature });
  }
  const dates = [...byDate.keys()].sort();
  let next = 0;
  return epochs.map((epoch) => {
    // Everything filed at or before this epoch has already been folded in, so
    // each step only applies what is NEW — the cursor never walks back, and
    // the sequence is built once, in order, rather than re-scanned per frame.
    const fresh = new Set();
    while (next < dates.length && dates[next] <= epoch.date) {
      for (const { id, feature } of byDate.get(dates[next])) {
        held.set(id, feature);
        if (dates[next] === epoch.date) fresh.add(id);
      }
      next += 1;
    }
    return { features: [...held.values()], fresh };
  });
}

/**
 * What the bar says under the date: what is DRAWN, and what changed to make
 * this frame — because "620 glaciers" and "8 remapped on this date" are two
 * different facts and the second is the one that explains the first.
 */
function frameNote(epoch, tail) {
  const shown = epoch.shown ?? epoch.features.length;
  return `${shown.toLocaleString()} glaciers · `
    + `${epoch.features.length} remapped on this date · ${tail}`;
}

/** Take the whole thing off the globe. */
export function stopTimelapse() {
  stopPlayer();
}

/**
 * Build the sequence for one box and one window of time.
 *
 * Returns what it found so the panel can say it — including what it had to
 * drop, because a slider that quietly holds a quarter of the dates is the
 * same silent cap this file's neighbours keep paying for.
 */
export async function startTimelapse({ bounds, from = null, to = null,
  source = "auto", onStatus = () => {} }) {
  stopTimelapse();
  const [{ runConnector }, render] = await Promise.all([
    import(`./research/connectors.js${search}`),
    import(`./vector-render.js${search}`),
  ]);
  onStatus("Reading every outline the archive holds here…");
  const result = await runConnector("glims-outlines", {
    bbox: {
      minLon: bounds.west, minLat: bounds.south,
      maxLon: bounds.east, maxLat: bounds.north,
    },
    from, to, all: true, limit: 8000,
  });
  const { epochs, dropped } = epochsFrom(result.geojson.features);
  if (epochs.length < 2) {
    onStatus("Fewer than two dates here — nothing to play. Try a wider area or window.");
    return { epochs: 0 };
  }

  /**
   * WHICH SATELLITE, AND OVER WHICH WEEKS — this driver's own decision, and
   * the reason the player takes a window rather than working one out. A
   * glacier frame composites that year's MELT SEASON, hemisphere-aware,
   * because one satellite over one glacier in six weeks is mostly cloud.
   */
  const middle = (bounds.north + bounds.south) / 2;
  for (const epoch of epochs) {
    const season = seasonFor(epoch.date, middle);
    epoch.dataset = datasetForYear(epoch.date.slice(0, 4));
    epoch.from = season?.from || epoch.date;
    epoch.to = season?.to || epoch.date;
  }

  const THREE = await import("../vendor/three.module.js");
  const group = new THREE.Group();
  group.name = "Glacier time-lapse";
  /**
   * A GHOST OF EVERY GLACIER, under the sequence and never hidden.
   *
   * It marks where the ice is in the whole window, so a reader can see what
   * the earliest frames do not yet hold. It is outline-only and therefore
   * holds no FILL, which is why it could never have answered the frames
   * jumping — that is what `stateAsOf` is for.
   */
  const seen = new Set();
  const ghostFeatures = [];
  for (const feature of result.geojson.features) {
    const id = feature?.properties?.glac_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ghostFeatures.push(feature);
  }
  const ghost = render.renderFeatureCollection(
    { type: "FeatureCollection", features: ghostFeatures },
    { colourFor: () => "#4d7f96", outlineOnly: true },
  );
  const ghostNode = ghost?.object3D || ghost;
  group.add(ghostNode);

  /**
   * Each frame is the ice as it stood, so a glacier nobody remapped keeps its
   * last outline instead of blinking out. Built once, in order; a step is then
   * a visibility flip rather than a rebuild.
   */
  const frames = stateAsOf(result.geojson.features, epochs);
  epochs.forEach((epoch, i) => { epoch.shown = frames[i].features.length; });
  const groups = epochs.map((epoch, i) => {
    const { features, fresh } = frames[i];
    const built = render.renderFeatureCollection(
      { type: "FeatureCollection", features },
      {
        /**
         * ONE PALETTE ACROSS EVERY FRAME, and the brightness marks what is
         * NEW rather than which frame this is. Colouring the last epoch apart
         * made the whole map change colour on the final step — a second jump,
         * on top of the one `stateAsOf` removes. What a reader wants marked is
         * the ice that was actually remapped on this date.
         */
        colourFor: (feature) =>
          (fresh.has(feature?.properties?.glac_id) ? "#eaf7ff" : "#8fd3f4"),
        outlineOnly: false,
      },
    );
    const node = built?.object3D || built;
    node.visible = false;
    group.add(node);
    return node;
  });

  const layer = window.GeoIDImportManager?.addDerivedLayer?.("Glacier time-lapse", {
    object3D: group,
    georeferenced: true,
    bounds: { minX: bounds.west, maxX: bounds.east, minY: bounds.south, maxY: bounds.north },
    features: result.geojson.features,
    collection: result.geojson,
  }, "glims");

  await startPlayer({
    bounds, epochs, source, frames: groups, noteFor: frameNote, onStatus,
    // The player owns the bar and the scenes; the outlines are this driver's,
    // so closing the bar has to take them with it.
    onStop: () => {
      const held = (window.GeoIDImportManager?.getLayers?.() || [])
        .find((l) => l.id === layer?.id);
      if (held) window.GeoIDImportManager?.removeLayer?.(held.id);
    },
  });
  onStatus(`${epochs.length} dates from ${epochs[0].date} to ${epochs[epochs.length - 1].date}`
    + `, ${result.geojson.features.length.toLocaleString()} outlines`
    + (dropped ? `, ${dropped} sparser dates left out` : "")
    + ". Press play, or drag the bar.");
  return { epochs: epochs.length, dropped };
}

if (typeof window !== "undefined") {
  window.GeoIDGlacierTimelapse = { startTimelapse, stopTimelapse, datasetForYear, epochsFrom };
}
