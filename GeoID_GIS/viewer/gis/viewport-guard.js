/**
 * A VIEWER THAT STARTED WITH NO SIZE GETS ONE (2026-10-18).
 *
 * The transit loads the destination viewer into a frame that is display:none
 * while the sequence plays. A viewer initialising there reads a 0 x 0 window,
 * sizes its renderer to nothing and sets camera.aspect to NaN. The transit
 * nudges it with a resize event when it reveals the frame -- but each viewer
 * registers its resize handler late in start-up, after its textures load, so
 * on a cold first visit the nudge arrives before anyone is listening and the
 * viewer draws thirty frames a second into a 0 x 0 canvas: the page is there,
 * the planet is not (reported: "Mars does NOT load on the first attempt";
 * Pluto and the Moon the same; reproduced from the planet strip, never from
 * /?world=, which reveals the frame at once).
 *
 * This watches for exactly that state -- a renderer canvas with no width, or a
 * NaN aspect, while the window has a size -- and dispatches a resize so the
 * viewer's own handler sizes itself the way it always does. It keeps
 * watching, cheaply, because the handler may not exist yet the first time.
 */

function check() {
  if (window.__geoidNoViewportGuard) return;   // test switch: reproduce the bug
  const v = window.GeoIDViewer;
  const canvas = v?.renderer?.domElement;
  if (!canvas || !(window.innerWidth > 0) || !(window.innerHeight > 0)) return;
  const broken = canvas.width === 0 || canvas.height === 0
    || !Number.isFinite(v.camera?.aspect);
  if (broken) window.dispatchEvent(new Event("resize"));
}

if (typeof window !== "undefined") {
  setInterval(check, 500);
}
