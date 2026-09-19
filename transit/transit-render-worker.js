/**
 * The transit picture's own thread. See transit-render.js for why: the
 * destination viewer boots on the page's main thread, and nothing drawn there
 * can move while it does. Frames here are driven by the worker's own
 * requestAnimationFrame and committed straight to the compositor.
 */
/* global GeoIDTransitRender */
"use strict";

const v = new URL(self.location.href).search;   // the page's stamp, carried on
importScripts(`transit-render.js${v}`);

/** The page's faces, which a worker cannot see: loaded here by URL. */
const FACES = [
  ["Orbitron", "url(https://fonts.gstatic.com/s/audiowide/v22/l7gdbjpo0cum0ckerWCdlg_O.woff2)", "400"],
  ["Exo 2", "url(https://fonts.gstatic.com/s/chakrapetch/v13/cIf6MapbsEk7TDLdtEz1BwkWn6pg.woff2)", "400"],
  ["Exo 2", "url(https://fonts.gstatic.com/s/chakrapetch/v13/cIflMapbsEk7TDLdtEz1BwkeQI51R5_F.woff2)", "500 900"],
];
function fontsReady(capMs) {
  if (typeof FontFace === "undefined" || !self.fonts) return Promise.resolve();
  const loads = FACES.map(([family, src, weight]) => {
    const face = new FontFace(family, src, { weight });
    self.fonts.add(face);
    return face.load().catch(() => null);
  });
  // Never hold the picture long for a face: a late one simply swaps in.
  return Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, capMs))]);
}

const raf = self.requestAnimationFrame ? (f) => self.requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 16);
let renderer = null;

self.onmessage = async (event) => {
  const m = event.data || {};
  if (m.type === "init") {
    renderer = GeoIDTransitRender.createRenderer({
      back: m.back, front: m.front, config: m.config,
      emit: (type, data) => self.postMessage({ type, ...data }),
    });
    renderer.resize(m.width, m.height, m.dpr);
    await fontsReady(900);
    self.postMessage({ type: "started" });
    const loop = (now) => {
      renderer.step(now);
      if (!renderer.state().done) raf(loop);
    };
    raf(loop);
  } else if (!renderer) {
    // nothing to do yet
  } else if (m.type === "resize") {
    renderer.resize(m.width, m.height, m.dpr);
  } else if (m.type === "release") {
    renderer.release(m.frac);
  } else if (m.type === "skip") {
    renderer.skip();
  }
};
