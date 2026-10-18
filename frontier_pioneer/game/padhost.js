/**
 * The controller and the computer: while the game is in front, the pad is the game's.
 *
 * On this machine AntiMicroX maps the DualShock to the desktop: in its "desktop" profile the left
 * stick is the mouse pointer, Cross is left click and Circle right click (a context menu). The game
 * reads the same pad, so every movement and press did two things at once. The rule now:
 *
 *   the game page is visible and focused, a pad is connected   -> "flight"  (AntiMicroX maps nothing:
 *                                                                 sticks, buttons and D-pad are the game's,
 *                                                                 in play, menus, cutscenes and the title)
 *   the window loses focus, the tab is hidden, the page closes -> "desktop" (the pointer again)
 *
 * In the menus the stick moves the selection ring (padnav.js); Cross selects, Circle goes back.
 *
 * The switch is the host broker (127.0.0.1:8787: POST /native/controller-mode), which accepts this
 * page's origin for those two routes only. Inside the Atlas window (window.__ATLAS_HOST, or framed)
 * the shell also switches the mapper from the controller module's own mode announcements, so there
 * the request is re-asserted a moment after each announcement, and focus changes are the shell's.
 *
 * Where it runs: this machine's own server (localhost), and the live site only once its owner has
 * opted in on this browser with ?atlaspad=1 (?atlaspad=0 to stop): a public page reaching a loopback
 * address makes the browser ask about local-network access, which no other visitor should see.
 * Never under browser automation (the headless tests have no broker). With no broker, no controller
 * or no mapper, every request fails quietly.
 */

const BROKER = "http://127.0.0.1:8787/native/controller-mode";
const OPT_KEY = "geoid.mars_surface.atlasPad";
let sent = null, timer = 0;

const hosted = () => { try { return window.__ATLAS_HOST === true || window.top !== window; } catch { return true; } };
/** The controller module flags the document while a pad is connected. */
const padOn = () => document.documentElement.classList.contains("geoid-pad-on");

function post(mode, { keepalive = false, force = false } = {}) {
  if (mode === sent && !force) return;
  sent = mode;
  try {
    fetch(BROKER, { method: "POST", mode: "cors", keepalive, headers: { "Content-Type": "application/json", "X-Atlas-Native": "1" }, body: JSON.stringify({ mode }) })
      .catch(() => { if (sent === mode) sent = null; });
  } catch { sent = null; }
}

/** What the mapper should be in now. null: leave it (hosted and not focused: the shell decides). */
function want() {
  const front = document.visibilityState === "visible" && (hosted() || document.hasFocus());
  if (front && padOn()) return "flight";
  if (hosted()) return document.hasFocus() ? "atlas" : null;
  return "desktop";
}

function sync({ now = false, force = false } = {}) {
  const m = want();
  if (!m) return;
  if (m !== "flight" && sent === null) return;    // never asked for flight: leave the mapper alone
  clearTimeout(timer);
  // giving the pad back is immediate; taking it waits a beat so a focus flicker does not toggle the profile twice
  if (now || m !== "flight") post(m, { keepalive: now, force }); else timer = setTimeout(() => post(m, { force }), 120);
}

function optedIn() {
  try {
    const q = new URLSearchParams(location.search).get("atlaspad");
    if (q === "1") localStorage.setItem(OPT_KEY, "1");
    if (q === "0") localStorage.removeItem(OPT_KEY);
    return localStorage.getItem(OPT_KEY) === "1";
  } catch { return false; }
}
/** This machine's own server, or the live site after the owner opted in; never under automation. */
const enabled = () => !navigator.webdriver && (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || optedIn());

export function installPadHost() {
  if (installPadHost.done || !enabled()) return; installPadHost.done = true;
  // a pad connecting or going, and every mode the module announces (in Atlas the shell acts on those too:
  // re-assert "flight" just after it, so the game keeps the pad in its menus as well)
  window.addEventListener("geoid:controller-mode", () => { sync(); if (hosted()) setTimeout(() => sync({ force: true }), 250); });
  window.addEventListener("gamepadconnected", () => sync());
  window.addEventListener("focus", () => sync({ force: hosted() }));
  if (!hosted()) window.addEventListener("blur", () => { clearTimeout(timer); if (sent === "flight") post("desktop"); });
  document.addEventListener("visibilitychange", () => sync());
  window.addEventListener("pagehide", () => { clearTimeout(timer); if (sent === "flight") post(hosted() ? "atlas" : "desktop", { keepalive: true }); });
  sync();
}

export const _test = { want, sync, get sent() { return sent; }, padOn };
installPadHost();
