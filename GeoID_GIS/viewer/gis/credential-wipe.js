/**
 * Clear every credential this app keeps in a browser.
 *
 * FOUR THINGS ARE STORED, and each is somebody's own rather than ours:
 *
 *   geoid-gis:gee-endpoint        the Earth Engine service address
 *   geoid-gis:google-credentials  a Google OAuth Client ID, for Docs and Sheets
 *   geoid-gis:sidecar             the local sidecar's host AND ITS TOKEN
 *   geoid-gis:atlas-endpoint      an Atlas hub address
 *
 * NONE OF THEM IS A SECRET OF OURS. The Earth Engine endpoint has never been
 * one — what protects it is ALLOWED_ORIGINS on the deployment, which
 * `gee.js`'s own header says — and a browser cannot hold a secret at all, which
 * is why `google-credentials.js` THROWS on anything shaped like a client
 * secret. The sidecar token is minted by a process on the reader's own machine.
 *
 * So this is not a defence. It is not leaving somebody's configuration sitting
 * in a browser that may no longer use the thing it configures, and it is one
 * call rather than four modules each remembering to do it.
 *
 * WIPED WHEN MEMBERSHIP GOES, and at load. `gee.js` already cleared its own on
 * the same events; that stays, because the reader of a value should refuse it
 * whatever else has run. This is the sweep beside it.
 */
import { may } from "./membership.js?v=20260914-a3436ee";

/**
 * Every key, and which feature it belongs to.
 *
 * A key with no feature is cleared whenever ANY of them is locked -- the Atlas
 * endpoint and the sidecar are not gated in their own right, but they are
 * configuration for a session that is over.
 */
const CREDENTIALS = [
  { key: "geoid-gis:gee-endpoint", feature: "gee", what: "the Earth Engine service" },
  { key: "geoid-gis:google-credentials", feature: null, what: "the Google Client ID" },
  { key: "geoid-gis:sidecar", feature: null, what: "the local sidecar and its token" },
  { key: "geoid-gis:atlas-endpoint", feature: null, what: "the Atlas hub" },
];

/** Names only — never values. A log line is not the place for a credential. */
export function storedCredentials() {
  return CREDENTIALS.filter(({ key }) => {
    try { return window.localStorage.getItem(key) !== null; } catch (error) { return false; }
  }).map(({ key, what }) => ({ key, what }));
}

/**
 * Clear them.
 *
 * `everything` is the explicit form — the Settings button, and what to run
 * before going live on a machine that has been used for testing. Without it,
 * only what the reader may no longer use is cleared.
 */
export function wipeCredentials({ everything = false } = {}) {
  const gone = [];
  for (const { key, feature, what } of CREDENTIALS) {
    const locked = feature ? !may(feature) : !may("gee");
    if (!everything && !locked) continue;
    try {
      if (window.localStorage.getItem(key) === null) continue;
      window.localStorage.removeItem(key);
      gone.push(what);
    } catch (error) { /* storage unavailable: nothing stored to clear */ }
  }
  return gone;
}

/**
 * Guarded on the LISTENER rather than on `document`: a suite stubs a bare
 * document, and a module that throws at import takes every suite importing its
 * importer down with it. This tree has paid for that twice.
 */
try {
  wipeCredentials();
  if (typeof document?.addEventListener === "function") {
    document.addEventListener("geoid:membership", () => wipeCredentials());
  }
  if (typeof window !== "undefined") {
    // The seam the Settings panel's button calls, and the one to run by hand
    // on a machine that has been used for testing before it goes live.
    window.GeoIDCredentials = { wipeCredentials, storedCredentials };
  }
} catch (error) { /* no document: a test, or node */ }
