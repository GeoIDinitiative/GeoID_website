/**
 * The left stick in the game's menus.
 *
 * While the game page is in front the OS mapper keeps its hands off the pad (padhost.js), so the
 * stick no longer moves the desktop pointer. In the menus (title, pause, settings, Workshop, the
 * map, story choices) the controller module only reads the D-pad and the face buttons; this lets
 * the left stick do what the D-pad does: move the selection ring, one step per push, repeating
 * while held. Cross selects and Circle goes back, as before. Nothing here runs while the world is
 * live (the stick drives or walks then).
 *
 * Reads the raw Gamepad API: the module returns zero axes outside its "flight" mode by design.
 *
 *   installPadNav(game)
 */
const DEAD = 0.55, FIRST = 380, NEXT = 140;
let held = null;

function pad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of list) if (g && g.connected && g.axes && g.axes.length >= 2) return g;
  return null;
}

/** Where the ring belongs: the topmost open layer. */
function scope() {
  const open = [".bigmap", "#screen-workshop:not([hidden])", ".st-choice:not([hidden])", ".kt:not([hidden])", ".screen:not([hidden])"];
  for (const sel of open) { const el = document.querySelector(sel); if (el && el.offsetParent !== null) return el; }
  return document.body;
}

function step(dir) {
  const P = window.GeoIDPad;
  if (!P || !P.focus) return;
  if (!P.hasFocus) P.focus.first(scope());
  else P.focus.move(dir);
}

export function installPadNav(game) {
  if (installPadNav.done) return; installPadNav.done = true;
  const loop = (t) => {
    requestAnimationFrame(loop);
    if (document.hidden) return;
    const g = pad();
    if (!g || (game && game.live)) { held = null; return; }
    const x = g.axes[0] || 0, y = g.axes[1] || 0, m = Math.max(Math.abs(x), Math.abs(y));
    if (m < DEAD) { held = null; return; }
    const dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up");
    if (!held || held.dir !== dir) { held = { dir, next: t + FIRST }; step(dir); return; }
    if (t >= held.next) { held.next = t + NEXT; step(dir); }
  };
  requestAnimationFrame(loop);
}
