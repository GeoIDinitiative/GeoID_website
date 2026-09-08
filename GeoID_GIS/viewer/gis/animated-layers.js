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

import { grouped, layerForDataset } from "./global-data.js?v=20260908-7645fb7";
import { stopPlayer } from "./timelapse-player.js?v=20260908-7645fb7";

/** Which entry owns the bar, or null. */
let owner = null;
/** Opens are async; a second pass must not start the same one twice. */
let opening = false;

const entries = () => grouped().flatMap((group) => group.entries || [])
  .filter((entry) => entry?.animation?.open);

/** Entries whose layer is on the globe right now. */
export function armed(list, lookup) {
  return (list || []).filter((entry) => {
    const layer = lookup(entry.id);
    return layer && layer.status !== "error";
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
  if (owner || !live.length) return;
  const entry = live[0];
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
 * The bar can also be closed from its own ✕, which no layer change announces.
 * Polled rather than wired into the player, for the reason the Draw HUD polls
 * tool state: the close paths are several and a watcher that misses one leaves
 * this module believing it still owns a bar that is gone — after which
 * unticking and re-ticking the layer would never reopen it.
 */
function watchBar() {
  if (!owner) return;
  if (!document.getElementById("geoid-timelapse")) owner = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("geoid-gis:layers-changed", () => { void sync(); });
  setInterval(() => { watchBar(); void sync(); }, 700);
  window.GeoIDAnimatedLayers = { sync, owns: () => owner };
}
