/**
 * The controller and the desktop pointer: who owns the sticks.
 *
 * On this machine AntiMicroX maps the DualShock to the desktop: in its
 * "desktop" mode the left stick IS the mouse pointer. The game reads the same
 * stick through GeoIDPad, so while driving or walking every movement did two
 * things at once (the rover steered and the pointer flew across the screen).
 *
 * The host broker (127.0.0.1:8787, which accepts this page's origin) switches
 * AntiMicroX: "flight" leaves the sticks to the page, "desktop" gives them
 * back to the pointer. This module follows the game's own controller mode
 * (main.js syncPadMode -> GeoIDPad.setMode, mirrored as "geoid:controller-mode"):
 *
 *   flight (driving, walking, building)        -> "flight"
 *   app (menus, help) / none (page hidden)     -> "desktop"  (the pointer for the menus)
 *   the window loses focus, is hidden or closes -> "desktop"
 *
 * Inside the Atlas window (window.__ATLAS_HOST, or framed) the shell already
 * does this from the same announcement, and also owns the "atlas" mode, so
 * here only the two in-game transitions are repeated (flight on, and back to
 * "atlas" while the window has focus) and focus changes are left to the shell.
 *
 * Mars game only: nothing outside this folder is changed, and with no broker
 * (or no controller) every request simply fails quietly.
 */

const BROKER = "http://127.0.0.1:8787/native/controller-mode";
let sent = null, timer = 0;

const hosted = () => { try { return window.__ATLAS_HOST === true || window.top !== window; } catch { return true; } };
/** The controller module flags the document while a pad is connected (and reports "none" without one). */
const padOn = () => document.documentElement.classList.contains("geoid-pad-on");

function post(mode, keepalive = false) {
  if (mode === sent) return;
  sent = mode;
  try {
    fetch(BROKER, { method: "POST", mode: "cors", keepalive, headers: { "Content-Type": "application/json", "X-Atlas-Native": "1" }, body: JSON.stringify({ mode }) })
      .catch(() => { if (sent === mode) sent = null; });
  } catch { sent = null; }
}

/** What the mapper should be in, from the game's controller mode. */
function want(padMode) {
  if (padMode === "flight" && document.visibilityState === "visible" && (hosted() || document.hasFocus())) return "flight";
  if (hosted()) return document.hasFocus() ? "atlas" : null;      // focus changes are the shell's
  return "desktop";
}

function sync(padMode, now = false) {
  const m = want(padMode ?? (padOn() && window.GeoIDPad ? window.GeoIDPad.mode : "none"));
  if (!m) return;
  if (m !== "flight" && sent === null) return;    // never asked for flight: leave the mapper alone
  clearTimeout(timer);
  // leaving flight is immediate; entering waits a beat so a menu flick does not toggle the profile twice
  if (now || m !== "flight") post(m, now); else timer = setTimeout(() => post(m), 120);
}

/** Only on this machine's own server, and never under browser automation (the headless tests have no broker,
 *  and a refused connection logs a console error the suites count). On the public site there is no mapper to
 *  talk to, and a request to a loopback address would make browsers ask about local-network access. */
const local = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !navigator.webdriver;

export function installPadHost() {
  if (installPadHost.done || !local()) return; installPadHost.done = true;
  window.addEventListener("geoid:controller-mode", (e) => sync(e.detail && e.detail.mode));
  // a pad connecting is announced through the same event (none -> flight / app)
  window.addEventListener("focus", () => sync());
  if (!hosted()) window.addEventListener("blur", () => { clearTimeout(timer); if (sent === "flight") post("desktop"); });
  document.addEventListener("visibilitychange", () => sync());
  window.addEventListener("pagehide", () => { clearTimeout(timer); if (sent === "flight") post(hosted() ? "atlas" : "desktop", true); });
  sync();
}

export const _test = { want, sync, get sent() { return sent; }, padOn };
installPadHost();
