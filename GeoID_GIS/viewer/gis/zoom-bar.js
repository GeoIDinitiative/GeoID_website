/**
 * A zoom control in the top-right corner, annotated by what you can actually
 * see at each altitude rather than by an abstract level number.
 *
 * The scroll wheel answers "a bit closer"; it does not answer "how far in am
 * I?" or "keep going". So: a `‹ REGIONAL ›` pill whose arrows zoom **while
 * held**, continuously, and whose middle names the scale you are at.
 *
 * **The travel is exponential, because zoom is.** A fixed number of metres per
 * tick is imperceptible at 10,000 km and a leap at 2 km; a fixed *ratio* per
 * second reads as one steady glide at every scale. Holding therefore multiplies
 * the target by `e^(rate·dt)` each frame rather than adding to it.
 *
 * It drives the same target the wheel does (`setZoomAltitudeMetres`) rather
 * than moving the camera, so a hold glides exactly as a scroll does and the two
 * cannot fight over the camera.
 */

import { isEarth } from "./bodies.js?v=20260810-570c14d";

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

// ── Holding an arrow ─────────────────────────────────────────────────────────

/** One press, before any hold begins: small enough to aim with. */
export const CLICK_RATIO = 1.35;
/**
 * A hold accelerates. It starts gently so a short press is fine-grained, and
 * reaches full rate after RAMP_MS so a long one crosses the whole range in a
 * few seconds rather than asking someone to hold an arrow for half a minute.
 * Rates are e-folds per second.
 */
export const HOLD = { rateMin: 1.1, rateMax: 3.2, rampMs: 900, delayMs: 260 };

/** The rate a hold has reached, ramped over its first RAMP_MS. */
export function holdRate(heldMs, { rateMin, rateMax, rampMs } = HOLD) {
  const t = Math.min(1, Math.max(0, heldMs / rampMs));
  return rateMin + (rateMax - rateMin) * t;
}

/**
 * How far the request may run ahead of the camera.
 *
 * The camera eases toward the target, so the target is always a little ahead —
 * fine, that is the glide. But at the zoom floor the camera **stops** while a
 * held arrow would go on compounding, and releasing would then leave it flying
 * on for seconds into ground it can never reach. Bounding the lead means a hold
 * against the floor simply idles there, and release settles at once.
 */
export const LEAD = 2.2;

/**
 * The next zoom request: exponential, bounded ahead of the camera, and
 * deliberately **not** floored.
 *
 * `dir` is +1 for further out, −1 for closer. The low end clamps to 0, not to
 * `minMetres`: the floor drops only as you descend, so a request clamped to the
 * floor of the moment asks for where you already are. See CLAUDE.md — this is
 * the third place that trap has surfaced.
 */
export function zoomRequest({ achieved, pending, dir, factor, maxMetres, lead = LEAD }) {
  const from = Number.isFinite(pending) && pending !== null ? pending : achieved;
  const base = Math.min(achieved * lead, Math.max(achieved / lead, from));
  const next = dir > 0 ? base * factor : base / factor;
  return Math.min(maxMetres, Math.max(0, next));
}

const STYLE = `
#geoid-zoom-step {
  /**
   * Below every popup, deliberately. The readouts and description windows that
   * open near this corner all sit at 14 and up (#hover-tooltip 14, #scene-popup
   * 20, #geo-popup 22, #event-popup 40, #measurement-result-card 140), and the
   * HUD clusters at 13 — so 12 is under all of them with no reliance on DOM
   * order, and a popup can never end up behind a zoom arrow.
   */
  position: fixed; z-index: 12; pointer-events: auto;
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
  /* A hold is a press, not a gesture: no text selection, no touch scrolling. */
  user-select: none; -webkit-user-select: none; touch-action: none;
}
#geoid-zoom-step button.is-held {
  background: rgba(var(--nav-accent-rgb, 120 200 255), 0.28); color: #fff;
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

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const box = document.createElement("div");
  box.id = "geoid-zoom-step";
  box.innerHTML = `
    <button class="zs-step" id="zs-out" type="button" title="Zoom out" aria-label="Zoom out">‹</button>
    <button class="zs-band" id="zs-band" type="button" title="Scale">Global</button>
    <button class="zs-step" id="zs-in" type="button" title="Zoom in — hold to keep going" aria-label="Zoom in">›</button>`;
  document.body.appendChild(box);

  const out = box.querySelector("#zs-out");
  const into = box.querySelector("#zs-in");
  const label = box.querySelector("#zs-band");

  /**
   * Directly above the scale bar, centred on it.
   *
   * The two answer the same question — how big is what I am looking at — so
   * they belong together, and the scale bar is already the corner of the HUD
   * that reports distance. Measured from the bar's own box rather than written
   * as coordinates: it is `grid-area: scale` inside the bottom HUD, its width
   * changes with the breakpoint (10.5rem, 7rem, 5rem embedded), and a hard
   * offset would drift from it at every size.
   *
   * Not `#top-right-controls`, which was the first attempt: despite the id,
   * `body.is-embedded` sets `left:` and clears `right:`, so in the shell that
   * cluster is pinned beside the sidebar — measured at x=412 while the tool
   * rail, the real top-right furniture, was at x=822.
   */
  const GAP = 10;
  const place = () => {
    const bar = document.getElementById("scale-readout");
    const vis = bar && !bar.hidden && getComputedStyle(bar).display !== "none";
    const s = vis ? bar.getBoundingClientRect() : null;
    let left = "";
    let bottom = "";
    let right = "";
    if (s && s.width) {
      const width = box.offsetWidth || 149;
      left = `${Math.round(Math.max(8, Math.min(
        s.left + (s.width - width) / 2, window.innerWidth - width - 8,
      )))}px`;
      bottom = `${Math.round(Math.max(8, window.innerHeight - s.top + GAP))}px`;
    } else {
      // No scale bar on the page yet (it starts hidden): hold the corner it
      // will appear in rather than jumping there later.
      right = "1rem";
      bottom = "3rem";
    }
    for (const [prop, value] of [["left", left], ["right", right], ["bottom", bottom]]) {
      if (box.style[prop] !== value) box.style[prop] = value;
    }
  };
  place();
  window.addEventListener("resize", place);

  const request = (metres) => viewer.setZoomAltitudeMetres(metres);

  /** One frame's worth of travel, or one press when `factor` is CLICK_RATIO. */
  const drive = (dir, factor) => {
    const r = viewer.getZoomAltitudeMetres();
    if (!r) return;
    request(zoomRequest({
      achieved: r.metres, pending: r.targetMetres, dir, factor, maxMetres: r.maxMetres,
    }));
  };

  // Holding an arrow zooms continuously: press for a nudge, keep holding and it
  // accelerates into a glide. The rAF loop drives the same target the wheel
  // sets, so the viewer's easing does the smoothing and there is no second
  // animation to fight it.
  let raf = 0;
  let delay = 0;
  let dir = 0;
  let heldFrom = 0;
  let lastFrame = 0;
  let fromPointer = false;

  const stopHold = () => {
    clearTimeout(delay);
    if (raf) cancelAnimationFrame(raf);
    raf = 0; dir = 0;
    out.classList.remove("is-held");
    into.classList.remove("is-held");
  };

  const tick = (now) => {
    if (!dir) return;
    // Capped only against a stall, well above a real frame: at 0.05 a 5 fps
    // display advanced a quarter of its elapsed time and a hold travelled at a
    // quarter of the rate asked for. Overshoot is not the risk here — the lead
    // bound in `zoomRequest` is what stops the request running away.
    const dt = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    drive(dir, Math.exp(holdRate(now - heldFrom) * dt));
    raf = requestAnimationFrame(tick);
  };

  const startHold = (button, direction) => {
    stopHold();
    dir = direction;
    button.classList.add("is-held");
    drive(direction, CLICK_RATIO);          // the press itself, felt at once
    delay = setTimeout(() => {
      heldFrom = performance.now();
      lastFrame = heldFrom;
      raf = requestAnimationFrame(tick);
    }, HOLD.delayMs);
  };

  for (const [button, direction] of [[out, +1], [into, -1]]) {
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.preventDefault();
      fromPointer = true;
      startHold(button, direction);
    });
    // Activated from the keyboard, where there is no pointer sequence to ride.
    button.addEventListener("click", () => {
      if (fromPointer) { fromPointer = false; return; }
      drive(direction, CLICK_RATIO);
    });
  }
  // Released anywhere, or the pointer left the window mid-hold, or the tab lost
  // focus — all of them must stop it, or the globe keeps flying.
  for (const event of ["pointerup", "pointercancel", "blur"]) {
    window.addEventListener(event, stopHold);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopHold(); });

  // The band name is a control too: clicking snaps to the middle of the current
  // band, which is how you get back to a round number after a lot of zooming.
  // Asked for WITHOUT the floor, for the reason in `zoomRequest`.
  label.addEventListener("click", () => {
    const r = viewer.getZoomAltitudeMetres();
    if (r) {
      request(bandAltitude(bandIndexFor(r.metres), { minMetres: 1, maxMetres: r.maxMetres }));
    }
  });

  let shown = "";
  const paint = () => {
    place();
    const r = viewer.getZoomAltitudeMetres();
    if (!r) return;
    const band = bandFor(r.metres);
    const text = `${band} · ${formatAltitude(r.metres)}`;
    if (text === shown) return;
    shown = text;
    label.textContent = band;
    label.title = `${band} — ${formatAltitude(r.metres)} above the surface`;
    /**
     * Only the ceiling greys out. There is no honest test for "as close as it
     * gets": `minMetres` is the floor of *this moment* and descending lowers it,
     * so greying against it disables the button at 999 km — where the floor is
     * still 995 km and one more press would have moved it. The same trap as the
     * clamped request, wearing a different hat.
     */
    out.disabled = bandIndexFor(r.metres) >= Math.max(...reachableBands(r))
      && r.metres >= r.maxMetres * 0.95;
    if (out.disabled && dir > 0) stopHold();
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
