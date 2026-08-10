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

import { isEarth } from "./bodies.js?v=20260810-bc997f7";

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

/**
 * Which band an altitude is in, and the one a step away.
 *
 * Stepping by *band* rather than by a fixed factor is the whole idea: the
 * question a person has is "show me this regionally", not "multiply my altitude
 * by 2.5". Index 0 is the closest band.
 */
export function bandIndexFor(metres) {
  const at = ZOOM_BANDS.findIndex((b) => metres < b.upTo);
  return at < 0 ? ZOOM_BANDS.length - 1 : at;
}

/**
 * A representative altitude for a band: its geometric middle.
 *
 * Geometric, not arithmetic, because the bands are decades — the arithmetic
 * middle of 100–1000 km is 550 km, which sits visually against the top of the
 * band rather than in it.
 */
export function bandAltitude(index, { minMetres = 1, maxMetres = Infinity } = {}) {
  const i = Math.max(0, Math.min(ZOOM_BANDS.length - 1, index));
  const lower = i === 0 ? Math.max(1, minMetres) : ZOOM_BANDS[i - 1].upTo;
  const upper = Number.isFinite(ZOOM_BANDS[i].upTo)
    ? ZOOM_BANDS[i].upTo
    : Math.max(lower * 4, maxMetres);
  const lo = Math.max(lower, minMetres);
  const hi = Math.min(upper, maxMetres);
  if (!(hi > lo)) return Math.max(minMetres, Math.min(maxMetres, lower));
  return Math.exp((Math.log(lo) + Math.log(hi)) / 2);
}

/** Bands the current floor and ceiling actually allow. */
export function reachableBands({ minMetres, maxMetres }) {
  return ZOOM_BANDS
    .map((b, i) => i)
    .filter((i) => {
      const lower = i === 0 ? 0 : ZOOM_BANDS[i - 1].upTo;
      const upper = ZOOM_BANDS[i].upTo;
      return upper > minMetres && lower < maxMetres;
    });
}

const STYLE = `
#geoid-zoom-step {
  display: flex; align-items: stretch; gap: 0;
  border: 1px solid rgba(var(--nav-accent-rgb, 120 200 255), 0.32);
  border-radius: 0.4rem; overflow: hidden;
  background: rgba(8, 10, 22, 0.66); backdrop-filter: blur(6px);
  font-family: "Exo 2", system-ui, sans-serif;
}
#geoid-zoom-step[hidden] { display: none; }
#geoid-zoom-step button {
  background: none; border: 0; color: rgba(226, 236, 255, 0.9);
  font: inherit; cursor: pointer; padding: 0 0.5rem; line-height: 1;
}
#geoid-zoom-step button:hover:not(:disabled) {
  background: rgba(var(--nav-accent-rgb, 120 200 255), 0.16);
  color: #fff;
}
#geoid-zoom-step button:disabled { opacity: 0.32; cursor: default; }
#geoid-zoom-step .zs-step { font-size: 0.95rem; font-weight: 600; }
#geoid-zoom-step .zs-band {
  min-width: 6.6rem; text-align: center; font-size: 0.7rem;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: rgb(var(--nav-accent-rgb, 120 200 255));
  border-left: 1px solid rgba(var(--nav-accent-rgb, 120 200 255), 0.22);
  border-right: 1px solid rgba(var(--nav-accent-rgb, 120 200 255), 0.22);
}
`;

let installed = false;

export function installZoomBar() {
  if (installed || typeof document === "undefined") return false;
  const viewer = window.GeoIDViewer;
  if (!viewer?.getZoomAltitudeMetres || !viewer.setZoomAltitudeMetres) return false;
  if (viewer.getZoomAltitudeMetres() === null) return false;
  // Sits inside the viewer's own control cluster rather than floating beside it:
  // it is a flex row, so being the first child puts this to the LEFT of the
  // tools with no coordinates to keep in step as that cluster changes.
  const host = document.getElementById("top-right-controls");
  if (!host) return false;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "geoid-zoom-step";
  box.innerHTML = `
    <button class="zs-step" id="zs-out" type="button" title="Zoom out" aria-label="Zoom out">‹</button>
    <button class="zs-band" id="zs-band" type="button" title="Scale">Global</button>
    <button class="zs-step" id="zs-in" type="button" title="Zoom in" aria-label="Zoom in">›</button>`;
  host.prepend(box);

  const out = box.querySelector("#zs-out");
  const into = box.querySelector("#zs-in");
  const label = box.querySelector("#zs-band");

  /**
   * A step moves one band, except at the closest one, where it goes to the
   * floor — otherwise "closer" would do nothing exactly when a person most
   * wants it, since the floor drops as you descend.
   */
  const step = (direction) => {
    const r = viewer.getZoomAltitudeMetres();
    if (!r) return;
    const here = bandIndexFor(r.metres);
    const next = here + direction;             // +1 = coarser, -1 = closer
    if (next < 0) { viewer.setZoomAltitudeMetres(0); return; }
    if (next >= ZOOM_BANDS.length) { viewer.setZoomAltitudeMetres(r.maxMetres); return; }
    /**
     * Asked for WITHOUT the floor, deliberately.
     *
     * The floor only drops once you descend — the relief tapers on the way in —
     * so at 999 km the floor is still 995 km and a request clamped to it asks
     * for where you already are. Measured: stepping Global → Continental →
     * Regional worked and then stalled, because Local clamped to 995 km.
     * Asking for the band's own altitude leaves the request floor-limited, and
     * the viewer walks the floor down until it can be satisfied. The ceiling is
     * still real, since nothing lifts that.
     */
    viewer.setZoomAltitudeMetres(bandAltitude(next, { minMetres: 1, maxMetres: r.maxMetres }));
  };
  out.addEventListener("click", () => step(+1));
  into.addEventListener("click", () => step(-1));
  // The band name is a control too: clicking re-centres on the current band,
  // which is how you get back to a round number after a lot of scrolling.
  label.addEventListener("click", () => {
    const r = viewer.getZoomAltitudeMetres();
    if (r) viewer.setZoomAltitudeMetres(bandAltitude(bandIndexFor(r.metres), r));
  });

  let shown = "";
  const paint = () => {
    const r = viewer.getZoomAltitudeMetres();
    if (!r) return;
    const band = bandFor(r.metres);
    const text = `${band} · ${formatAltitude(r.metres)}`;
    if (text === shown) return;
    shown = text;
    label.textContent = band;
    label.title = `${band} — ${formatAltitude(r.metres)} above the surface`;
    // Greyed at the ends of what is actually reachable, so the control never
    // offers a scale the floor forbids.
    const bands = reachableBands(r);
    const here = bandIndexFor(r.metres);
    into.disabled = here <= Math.min(...bands) && r.metres <= r.minMetres * 1.05;
    out.disabled = here >= Math.max(...bands) && r.metres >= r.maxMetres * 0.95;
  };
  paint();
  setInterval(paint, 150);

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
  // The viewer boots async and the control cluster is in the page markup, so
  // keep trying until both are there.
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
