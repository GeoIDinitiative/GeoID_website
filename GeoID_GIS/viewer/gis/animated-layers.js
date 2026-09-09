/**
 * A LAYER THAT PLAYS OVER TIME OPENS ITS BAR WHEN IT ARRIVES.
 *
 * There were buttons — "▶ Play seasons", "▶ Play the estimate" — and a button
 * is a second decision for one intent: somebody who ticks a sequence on has
 * said they want to look at it, and pressing a second control to be shown the
 * thing they just switched on is the volcano Names button's own fault, which
 * this tree has now removed twice.
 *
 * WHAT MAKES IT SAFE IS WHERE THE BAR PARKS. It opens on the frame that leaves
 * the layer saying what its own name says — the whole archive, the full-record
 * estimate — so ticking changes NOTHING about what is drawn and every step
 * back from there is pure gain. A bar that opened on frame 0 would answer a
 * tick for "every storm on record" with 105 storms of 13,513, which is the
 * layer being replaced rather than annotated. Each driver names its own
 * parking frame; this module only decides WHEN.
 *
 * ONE BAR, because there is one player. Ticking a second animated layer hands
 * the bar over, which is `timelapse-player`'s own rule rather than a choice
 * made here — and unticking the one that owns it puts the bar away.
 */

import { grouped, layerForDataset } from "./global-data.js?v=20260909-f81a4d0";
import { stopPlayer } from "./timelapse-player.js?v=20260909-f81a4d0";

/** Which entry owns the bar, or null. */
let owner = null;
/**
 * Entries whose bar the reader CLOSED. Without this the poll below reopens it
 * on the next tick and the ✕ does nothing at all -- press it, watch the bar
 * come straight back. A dismissal lasts until the layer goes and returns,
 * because re-ticking a dataset is asking for it again.
 */
const dismissed = new Set();
/** Opens are async; a second pass must not start the same one twice. */
let opening = false;

const entries = () => grouped().flatMap((group) => group.entries || [])
  .filter((entry) => entry?.animation?.open);

/** Entries whose layer is on the globe right now. */
export function armed(list, lookup) {
  return (list || []).filter((entry) => {
    const layer = lookup(entry.id);
    /**
     * REGISTERED IS NOT LOADED. `importFileList` puts a layer in the list when
     * the import STARTS, so a sequence opened on the first `layers-changed`
     * finds a row with no features and reports "tick the layer on first" over
     * a layer that is on its way. Wait for something to play.
     */
    return layer && layer.status === "loaded"
      && (layer.features?.length || layer.raster || layer.collection);
  });
}

async function sync() {
  if (opening) return;
  const live = armed(entries(), layerForDataset);
  const stillThere = owner && live.some((entry) => entry.id === owner);
  if (owner && !stillThere) {
    // The layer that owned the bar has gone. Its driver's own onStop puts back
    // whatever it stood down.
    owner = null;
    stopPlayer();
    return;
  }
  // A dataset that has left the globe forgets its dismissal: ticking it on
  // again is asking for it again.
  [...dismissed].forEach((id) => {
    if (!live.some((entry) => entry.id === id)) dismissed.delete(id);
  });
  if (owner || !live.length) return;
  const entry = live.find((candidate) => !dismissed.has(candidate.id));
  if (!entry) return;
  opening = true;
  owner = entry.id;
  try {
    await entry.animation.open(layerForDataset(entry.id));
  } catch (error) {
    // A sequence that cannot open must not leave the row looking as though it
    // owns a bar that is not there.
    owner = null;
  } finally {
    opening = false;
  }
}

/**
 * A DISMISSAL IS ANNOUNCED, NEVER INFERRED.
 *
 * This used to be a poll: an owner with no `#geoid-timelapse` on the page was
 * read as the reader having pressed ✕. A HANDOVER has exactly that shape --
 * the next sequence takes the bar down before its own is built, and the risk
 * map's build is seconds long -- so ticking the risk marked the tracks
 * dismissed, and unticking the risk then left the tracks bar-less while they
 * were still on the globe. Two flags were added to paper over the window and
 * the window kept moving. The player now says WHY it stopped, and only the ✕
 * is a decision about the sequence that was up.
 */
function onStopped(event) {
  if (event.detail?.reason !== "dismiss" || !owner) return;
  dismissed.add(owner);
  owner = null;
}

/**
 * A DRIVER REBUILDING OR OPENING ITS OWN SEQUENCE says so, with the flag the
 * open already uses, held for the length of the work -- `sync` stands still
 * while it is up, so it cannot open a second sequence over one being built.
 */
async function hold(work, id = null) {
  opening = true;
  try {
    return await work();
  } finally {
    opening = false;
    /**
     * AND THE BAR CHANGES HANDS. A driver opened from OUTSIDE this module --
     * the catalogue applying a dataset's default view -- puts its own bar up
     * and takes the previous owner's down, and nothing here knew: `owner`
     * went on naming the tracks while the risk's bar was on screen, and the
     * next sync opened the risk entry ITSELF over the sequence the catalogue
     * had just built -- two drapes and two Workspace rows for one tick.
     * Whoever's bar is up when a held open lands owns it.
     */
    if (id && document.getElementById("geoid-timelapse")) owner = id;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("geoid-gis:layers-changed", () => { void sync(); });
  document.addEventListener("geoid-gis:timelapse-stopped", onStopped);
  setInterval(() => { void sync(); }, 700);
  window.GeoIDAnimatedLayers = {
    sync, hold, owns: () => owner, dismissed: () => [...dismissed],
  };
}
