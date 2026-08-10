/**
 * A horizontal zoom control, annotated by what you can actually see at each
 * altitude rather than by an abstract level number.
 *
 * The scroll wheel answers "a bit closer"; it does not answer "take me to
 * regional scale" or "how far in am I?". A globe with five orders of magnitude
 * of range needs a control that shows the whole range at once, which is what
 * every mapping product ships and this did not have.
 *
 * **Logarithmic, because zoom is.** Linear in altitude, ninety-nine percent of
 * the travel would be spent between orbit and the stratosphere and the entire
 * useful range — regional to site — would live in the last pixel. Each band
 * below is a decade or so of altitude and gets a comparable share of the track.
 *
 * It drives the same target the wheel does (`setZoomAltitudeMetres`) rather
 * than moving the camera, so a drag glides exactly as a scroll does and the two
 * cannot fight over the camera.
 */

import { isEarth } from "./bodies.js?v=20260810-d5b078d";

/**
 * The bands, named for what the view is of — the thing a person is actually
 * choosing. Boundaries in metres above the surface.
 */
export const ZOOM_BANDS = [
  { name: "Site", upTo: 10e3 },
  { name: "Local", upTo: 100e3 },
  { name: "Regional", upTo: 1000e3 },
  { name: "Continental", upTo: 8000e3 },
  { name: "Global", upTo: Infinity },
];

export function bandFor(metres) {
  return ZOOM_BANDS.find((b) => metres < b.upTo)?.name || "Global";
}

/** Altitude to a 0..1 position on the track, and back. */
export function altitudeToFraction(metres, minMetres, maxMetres) {
  const lo = Math.log(Math.max(1, minMetres));
  const hi = Math.log(Math.max(lo + 1e-6, maxMetres));
  const v = Math.log(Math.min(Math.max(metres, minMetres), maxMetres));
  return (v - lo) / (hi - lo);
}

export function fractionToAltitude(fraction, minMetres, maxMetres) {
  const lo = Math.log(Math.max(1, minMetres));
  const hi = Math.log(Math.max(lo + 1e-6, maxMetres));
  return Math.exp(lo + (hi - lo) * Math.min(1, Math.max(0, fraction)));
}

/** A distance a person reads without converting: 2.4 km, 850 m, 1400 km. */
export function formatAltitude(metres) {
  if (!Number.isFinite(metres)) return "—";
  if (metres >= 1e6) return `${Math.round(metres / 1000).toLocaleString()} km`;
  if (metres >= 10e3) return `${Math.round(metres / 1000)} km`;
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}

const STYLE = `
#geoid-zoom-bar {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: 5.4rem; z-index: 14; width: min(38rem, 62vw);
  padding: 0.45rem 0.7rem 0.3rem;
  background: rgba(8, 10, 22, 0.72);
  border: 1px solid rgba(var(--nav-accent-rgb, 120 200 255), 0.28);
  border-radius: 0.6rem; backdrop-filter: blur(6px);
  font-family: "Exo 2", system-ui, sans-serif; pointer-events: auto;
}
#geoid-zoom-bar[hidden] { display: none; }
#geoid-zoom-bar .zb-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(220, 232, 255, 0.72); margin-bottom: 0.15rem;
}
#geoid-zoom-bar .zb-alt { font-variant-numeric: tabular-nums; color: rgb(var(--nav-accent-rgb, 120 200 255)); }
#geoid-zoom-bar input[type=range] { width: 100%; margin: 0; cursor: ew-resize; }
#geoid-zoom-bar .zb-scale {
  position: relative; height: 1.05rem; margin-top: 0.1rem;
  font-size: 0.62rem; color: rgba(200, 214, 240, 0.6);
}
#geoid-zoom-bar .zb-tick {
  position: absolute; transform: translateX(-50%); white-space: nowrap;
}
#geoid-zoom-bar .zb-tick.is-active { color: rgb(var(--nav-accent-rgb, 120 200 255)); font-weight: 600; }
`;

let installed = false;

export function installZoomBar() {
  if (installed || typeof document === "undefined") return false;
  const viewer = window.GeoIDViewer;
  if (!viewer?.getZoomAltitudeMetres || !viewer.setZoomAltitudeMetres) return false;
  const range = viewer.getZoomAltitudeMetres();
  if (!range) return false;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "geoid-zoom-bar";
  box.innerHTML = `
    <div class="zb-head"><span id="zb-band">Global</span><span class="zb-alt" id="zb-alt">—</span></div>
    <input id="zb-range" type="range" min="0" max="1000" value="1000" step="1"
           aria-label="Zoom altitude">
    <div class="zb-scale" id="zb-scale"></div>`;
  document.body.appendChild(box);

  const slider = box.querySelector("#zb-range");
  const bandOut = box.querySelector("#zb-band");
  const altOut = box.querySelector("#zb-alt");
  const scale = box.querySelector("#zb-scale");

  // Ticks at the band boundaries, placed where they actually fall on the log
  // track -- so the annotation is the scale rather than a decoration beside it.
  const drawTicks = ({ minMetres, maxMetres }) => {
    scale.textContent = "";
    ZOOM_BANDS.forEach((band, i) => {
      const lower = i === 0 ? minMetres : ZOOM_BANDS[i - 1].upTo;
      const upper = Math.min(band.upTo, maxMetres);
      if (!(upper > lower)) return;
      const mid = Math.exp((Math.log(lower) + Math.log(upper)) / 2);
      const tick = document.createElement("span");
      tick.className = "zb-tick";
      tick.dataset.band = band.name;
      tick.textContent = band.name;
      tick.style.left = `${altitudeToFraction(mid, minMetres, maxMetres) * 100}%`;
      scale.appendChild(tick);
    });
  };
  drawTicks(range);

  let dragging = false;
  slider.addEventListener("pointerdown", () => { dragging = true; });
  window.addEventListener("pointerup", () => { dragging = false; });
  slider.addEventListener("input", () => {
    const now = viewer.getZoomAltitudeMetres();
    if (!now) return;
    const fraction = Number(slider.value) / 1000;
    /**
     * The ends of the track mean "as far as this goes", not "as far as it goes
     * right now".
     *
     * The floor is not fixed — descending tapers the terrain, which lowers it —
     * so mapping 0 to the *current* minimum asks for a value that is satisfied
     * on the way down and then abandoned. Measured: dragging to the bottom
     * stopped at 130 km while the floor settled at 53 km a moment later, and it
     * took repeated drags to actually arrive. Asking for zero instead leaves the
     * request permanently floor-limited, and the viewer follows the floor the
     * rest of the way.
     */
    const metres = fraction <= 0 ? 0
      : fraction >= 1 ? now.maxMetres
      : fractionToAltitude(fraction, now.minMetres, now.maxMetres);
    viewer.setZoomAltitudeMetres(metres);
    paint(Math.max(metres, now.minMetres), now);
  });

  const paint = (metres, r) => {
    const band = bandFor(metres);
    bandOut.textContent = band;
    altOut.textContent = formatAltitude(metres);
    scale.querySelectorAll(".zb-tick").forEach((t) => {
      t.classList.toggle("is-active", t.dataset.band === band);
    });
    if (!dragging) slider.value = String(Math.round(
      altitudeToFraction(metres, r.minMetres, r.maxMetres) * 1000,
    ));
  };

  /**
   * Follow the camera, whatever moved it.
   *
   * Polled rather than event-driven because the render loop moves the camera
   * itself — the surface barrier clamps it every frame and the zoom easing
   * closes distance over many frames — so there is no single event that means
   * "the altitude changed".
   */
  let lastShown = -1;
  let lastFloor = range.minMetres;
  setInterval(() => {
    const r = viewer.getZoomAltitudeMetres();
    if (!r) return;
    // The floor is not fixed: close-range imagery drops it from about 995 km to
    // 1.8 km, which is nearly three decades of new track and brings Site and
    // Local into reach. Redraw the scale when it moves, or the bands keep
    // describing a range that is no longer the one you are on.
    if (Math.abs(Math.log(r.minMetres / lastFloor)) > 0.01) {
      lastFloor = r.minMetres;
      drawTicks(r);
      lastShown = -1;                       // force a repaint against the new track
    }
    if (Math.abs(Math.log((r.metres + 1) / (lastShown + 1))) > 0.004) {
      lastShown = r.metres;
      paint(r.metres, r);
    }
  }, 120);

  // A globe control belongs to the globe: hidden in Model and Research modes.
  const syncMode = () => {
    const mode = window.GeoIDModeManager?.getMode?.() || document.body.dataset.viewMode;
    box.hidden = mode !== "gis" || !isEarth();
  };
  syncMode();
  window.addEventListener("geoid-gis:mode-change", syncMode);

  installed = true;
  return true;
}

if (typeof document !== "undefined") {
  // The viewer boots async, so keep trying until its seam is there.
  let tries = 0;
  const attempt = () => {
    if (installZoomBar() || (tries += 1) > 60) return;
    setTimeout(attempt, 500);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attempt);
  } else {
    attempt();
  }
}
