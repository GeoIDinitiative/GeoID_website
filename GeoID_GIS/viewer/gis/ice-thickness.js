/**
 * HOW MUCH ICE, not just where it is.
 *
 * An outline is a shape; the question anybody asks next is how much ice is in
 * it — for melt, for runoff, for sea level. RGI publishes no volume, so this
 * reads the table `services/bake-ice-thickness.py` writes from **IceBoost v2.0**
 * (Maffezzoli 2026, CC BY 4.0), a deep-learning ensemble trained on the
 * GlaThiDa measurements and published per RGI 7.0 glacier COMPLEX — the very
 * key this site's tiles carry, so the join is by identity rather than by
 * position.
 *
 * A sidecar for the same reasons the names are: 5.5 MB that loads once, beside
 * an 82 MB pyramid that would otherwise be re-baked for every revision of a
 * model that is revised.
 */

import { dataUrl } from "./data-base.js?v=20260905-3edf317";

const URL_PATH = "/data/global/ice/thickness.json";

/** Ice to water, and water to sea level: 1 km³ over 361.8 million km² of ocean. */
const ICE_TO_WATER = 0.917;
const KM3_PER_MM = 361.8;

let once = null;
let table = null;

export function loadIceThickness() {
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
 * What is known about one complex's ice, or null.
 *
 * `bsl` — the part below sea level — is absent for all but the tidewater
 * glaciers, and it is what a sea-level number must subtract: ice already below
 * the waterline is already displacing its own volume.
 */
export function iceVolumeFor(rgiId) {
  if (!table || !rgiId) return null;
  const row = table[String(rgiId).replace("RGI2000-v7.0-C-", "")];
  if (!row) return null;
  const [volume, error, below = 0] = row;
  return {
    volumeKm3: volume,
    errorKm3: error,
    belowSeaLevelKm3: below,
    seaLevelMm: ((volume - below) * ICE_TO_WATER) / KM3_PER_MM,
  };
}

export function iceThicknessReady() {
  return Boolean(table);
}

if (typeof window !== "undefined") {
  window.GeoIDIceThickness = { loadIceThickness, iceVolumeFor, iceThicknessReady };
}
