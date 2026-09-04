/**
 * THE GLACIERS' OWN NAMES, which the inventory does not carry.
 *
 * RGI's complexes have no name column at all — an ice mass is an id, a region
 * and an area — so a click read "Glacier complex, Iceland" over Mýrdalsjökull.
 * The names exist; they are just in three other places, and putting them
 * together is `services/name-glaciers.py`'s job. This is the reading half: one
 * fetch of what that bake wrote, kept behind a promise so the thousands of
 * cards that never open cost nothing.
 *
 * WHY IT IS A SIDECAR AND NOT A TILE PROPERTY. A name is 20 bytes on a feature
 * that already costs a kilobyte of geometry, so it could have gone in the
 * tiles — and then every correction to a name would mean re-baking an 82 MB
 * pyramid. This file is 1.5 MB, loads once, and can be rewritten on its own.
 */

import { dataUrl } from "./data-base.js?v=20260904-53f476b";

const URL_PATH = "/data/global/ice/names.json";

let once = null;
let table = null;

/** The table, fetched at most once. */
export function loadIceNames() {
  if (!once) {
    const stamp = new URL(import.meta.url).search;
    /**
     * Published, the URL comes back from the bucket carrying its own
     * content fingerprint, so the module stamp must NOT be appended as
     * well — that is the `manifest.json?v=X?v=X` fault. Unpublished it
     * comes back unchanged and still wants the stamp it always had.
     */
    once = dataUrl(URL_PATH)
      .then((url) => fetch(url === URL_PATH ? `${url}${stamp}` : url))
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { table = body || null; return table; })
      .catch(() => null);
  }
  return once;
}

/**
 * The name for one complex, or null.
 *
 * Keyed by the id WITHOUT its constant prefix — "06-00201", not
 * "RGI2000-v7.0-C-06-00201" — because that prefix is 14 bytes on every one of
 * forty thousand entries and says nothing.
 */
export function iceNameFor(rgiId) {
  if (!table || !rgiId) return null;
  const key = String(rgiId).replace("RGI2000-v7.0-C-", "");
  const row = table[key];
  return row ? { name: row[0], source: row[1] } : null;
}

/** Whether the table is in hand — the card decides its title synchronously. */
export function iceNamesReady() {
  return Boolean(table);
}

if (typeof window !== "undefined") {
  window.GeoIDIceNames = { loadIceNames, iceNameFor, iceNamesReady };
}
