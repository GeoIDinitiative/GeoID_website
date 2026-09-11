/**
 * A CARD DESCRIBES SOMETHING ON THE GLOBE, SO IT GOES WHEN THAT THING DOES.
 *
 * Reported as "when we select an event/geology/layer and then toggle the main
 * tab tickbox, and/or jump to the model page - the pop ups linger". Measured:
 * leaving GIS and the feed's own master tick were already clean, but the
 * Workspace EYE was not -- hide the Live events layer with an event's card
 * open and the markers went while the card stayed, its selection ring still
 * pulsing over an empty patch of ground. Every card on this page had the same
 * shape of fault, because each one closed on the gestures its own module knew
 * about and none of them knew the layer could go away under it.
 *
 * So a card CLAIMS the layer it describes when it opens, and this module
 * closes it -- through the card's own closer, which also takes its highlight
 * -- the moment that layer is no longer on the globe: hidden, removed, or
 * unticked from a catalogue.
 *
 * Three things decide whether it works:
 *
 * - ONE OWNER PER SLOT. The viewer's geology and scene cards share a slot
 *   because only one is ever open; the event card and the feature card have
 *   their own. A newer card replaces the claim, so hiding an OLD card's layer
 *   can never close the card that replaced it.
 * - MATCHED BY NAME AS WELL AS ID. A tiled layer rebuilds itself as a new
 *   object on every settle; matched by identity, a geology card would close
 *   each time the camera stopped moving.
 * - CHECKED A BEAT LATER, and re-checked. A rebuild can take the old layer out
 *   a moment before the new one arrives, and a card that closed in that gap
 *   would be the app deciding the reader had finished with it.
 */

const slots = new Map();
const SETTLE_MS = 250;
let timer = null;

function keyOf(layer) {
  if (!layer) return null;
  if (typeof layer === "string") return { id: null, name: layer };
  return { id: layer.id != null ? String(layer.id) : null, name: layer.name || null };
}

/** Is a layer with this identity on the globe right now? */
export function shown(key, layers = globalThis.window?.GeoIDImportManager?.getLayers?.() || []) {
  if (!key) return false;
  return layers.some((l) => {
    const same = (key.id && String(l.id) === key.id) || (key.name && l.name === key.name);
    return same && l.visible !== false && l.object3D?.visible !== false;
  });
}

/** Claim a slot for a card about this layer; `close` puts the card away. */
/**
 * ONE CARD ON THE GLOBE. Claiming a slot closes the cards held in the OTHER
 * slots, through their own closers, so their highlights go with them. The
 * slots were independent, so an event card opened over a geology card left
 * both up -- and pressing ✕ on one left the other's outline or ring lit, with
 * its card hidden behind the new one. Snapshot first: a closer releases its
 * own slot while this walks them.
 */
export function own(slot, layer, close) {
  const key = keyOf(layer);
  if (!slot || !key || typeof close !== "function") { slots.delete(slot); return; }
  for (const [other, owner] of [...slots]) {
    if (other === slot) continue;
    slots.delete(other);
    try { owner.close(); } catch { /* a closer that throws must not keep this one from opening */ }
  }
  slots.set(slot, { key, close });
}

/** The card in this slot closed on its own; forget what it described. */
export function release(slot) {
  slots.delete(slot);
}

/** Close every card whose layer has left the globe. Returns the slots closed. */
export function check(layers) {
  const closed = [];
  for (const [slot, owner] of [...slots]) {
    if (shown(owner.key, layers)) continue;
    slots.delete(slot);
    closed.push(slot);
    try { owner.close(); } catch { /* a closer that throws must not keep the rest open */ }
  }
  return closed;
}

function checkSoon() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; check(); }, SETTLE_MS);
}

let installed = false;

export function install() {
  if (installed) return;
  installed = true;
  // Hiding a layer announces here; removing one goes through the manager.
  globalThis.window?.addEventListener?.("geoid-gis:layers-changed", checkSoon);
  let tries = 0;
  const subscribe = () => {
    const im = globalThis.window?.GeoIDImportManager;
    if (im?.onChange) { im.onChange(checkSoon); return; }
    if (tries++ > 120 || typeof setTimeout !== "function") return;
    setTimeout(subscribe, 100);
  };
  subscribe();
}

if (typeof globalThis.document?.addEventListener === "function" && globalThis.window) {
  globalThis.window.GeoIDCardOwner = { own, release, check, shown };
  install();
}
