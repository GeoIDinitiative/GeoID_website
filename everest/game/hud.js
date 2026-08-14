/**
 * The interface.
 *
 * The *language* is Red Dead Redemption's: cores rather than bars, a radial
 * wheel that slows time instead of a menu that stops it, a journal you read
 * rather than a stats screen, small-caps notifications low on the screen, and
 * letterbox bars when the game wants a moment.
 *
 * The *palette* is the myGeoID viewer skin — magenta chrome, cyan data,
 * purple-black ground, from `styles/viewer-skin.css`. The four cores use a
 * synthwave sunset (pink, yellow, orange) plus cyan for oxygen, which is the
 * one place four colours have to be told apart at a glance.
 *
 * The control bar at the top is the shell's: clock, every toggle, altitude
 * and standing in one strip, each button carrying the shortcut that does the
 * same thing and lit from the same state, so the two can never disagree.
 *
 * Cores are drawn to a canvas rather than built from DOM: four rings redrawn
 * every frame is one canvas op, where four sets of nested divs with box
 * shadows is a layout pass.
 */

import { Director } from "./director.js?v=566aa96-a64ca6d4";
import { ITEMS } from "./survival.js?v=566aa96-a64ca6d4";
import { compassPoint } from "./geo.js?v=566aa96-a64ca6d4";

/* The skin, restated for the canvas.
   A 2D context cannot read a CSS custom property, so these must be kept in
   step with `everest.css` by hand — they are the only place in the project
   where the palette is written twice. */
/* One palette for every canvas the HUD draws (compass, wheel, cores):
   the Etna explorer's warm instrument set, matching the CSS variables. */
const CHROME = "#4d8dff";
const CHROME_BRIGHT = "rgba(77,141,255,0.88)";
const CHROME_LINE = "rgba(77,141,255,0.34)";
const CHROME_FAINT = "rgba(77,141,255,0.20)";
const DATA = "#8fb8ff";
const INK = "#eef4ff";
const INK_SOFT = "rgba(238,244,255,0.86)";
const INK_DIM = "rgba(200,216,245,0.62)";
const INK_FAINT = "rgba(200,216,245,0.30)";

const CORE_DEFS = [
  { key: "health",  label: "Health",  colour: "#ff2d6f" },
  { key: "energy",  label: "Stamina", colour: "#ffd166" },
  { key: "warmth",  label: "Warmth",  colour: "#ff8a3c" },
  { key: "oxygen",  label: "Oxygen",  colour: "#00e5ff" },
];

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {};
    this.build();
    this.wheelOpen = false;
    this.journalOpen = false;
    this.wheelIndex = 0;
    this.notifications = [];
    this.subtitle = null;
    this.cinematic = 0;
    this._last = {};
  }

  build() {
    const mk = (cls, parent, tag = "div") => {
      const e = document.createElement(tag);
      e.className = cls;
      (parent || this.root).appendChild(e);
      return e;
    };

    /* ── Screen effects: vignette, whiteout, damage ── */
    this.el.fx = mk("fx-layer");
    this.el.vignette = mk("fx-vignette", this.el.fx);
    this.el.flash = mk("fx-flash", this.el.fx);
    this.el.frost = mk("fx-frost", this.el.fx);

    /* ── Cinematic bars ── */
    this.el.barTop = mk("cine-bar cine-top");
    this.el.barBottom = mk("cine-bar cine-bottom");

    /* ── POI labels live in their own layer so they sit under the panels ── */
    this.el.labels = mk("poi-layer");

    /* ── Cores, bottom-left ── */
    this.el.cores = mk("cores");
    this.coreCanvas = document.createElement("canvas");
    this.coreCanvas.width = 340; this.coreCanvas.height = 104;
    this.coreCanvas.className = "core-canvas";
    this.el.cores.appendChild(this.coreCanvas);
    this.cctx = this.coreCanvas.getContext("2d");
    this.el.coreNote = mk("core-note", this.el.cores);

    /* ── Instrument block, bottom-right: the numbers a climber would
          actually have — altimeter, temperature, wind, slope, time. ── */
    /* One horizontal strip under the compass, in the flight sim's readout
       idiom: every number a climber checks, in one glance line, no panel to
       open. The ids are unchanged so updateInstruments needs no rewiring. */
    this.el.instr = mk("info-bar");
    this.el.instr.innerHTML = `
      <span class="ib-seg ib-alt"><span class="v" id="i-alt">—</span><span class="u">m</span></span>
      <span class="ib-seg"><span class="k">Dist</span><span class="v" id="i-dist">—</span></span>
      <span class="ib-seg"><span class="k">Avy</span><span class="v" id="i-avy">—</span></span>
      <span class="ib-seg"><span class="k">Temp</span><span class="v" id="i-temp">—</span></span>
      <span class="ib-seg"><span class="k">Wind</span><span class="v" id="i-wind">—</span></span>
      <span class="ib-seg"><span class="k">Resist</span><span class="v" id="i-resist">—</span></span>
      <span class="ib-seg"><span class="k">Slope</span><span class="v" id="i-slope">—</span></span>
      <span class="ib-seg"><span class="k">SpO\u2082</span><span class="v" id="i-spo2">—</span></span>
      <span class="ib-seg"><span class="k">O\u2082</span><span class="v" id="i-flow">—</span></span>
`;
    for (const id of ["alt", "dist", "temp", "wind", "resist", "slope", "spo2", "flow", "avy"]) {
      this.el["i_" + id] = this.el.instr.querySelector("#i-" + id);
    }

    /* ── Gio, the guide: hazard-area messages, top right beside the
          logo. One card at a time; an alert tone announces it and it
          fades itself off screen after thirty seconds. ── */
    this.el.gio = mk("gio-card");
    this.el.gio.style.display = "none";
    this._gioTimer = 0;
    this.guideSay = (text) => {
      this.el.gio.innerHTML = `
        <div class="gio-head"><span class="gio-name">Gio</span><span class="gio-role">\u00b7 guide</span></div>
        <div class="gio-text">${text}</div>`;
      this.el.gio.style.display = "";
      this.el.gio.classList.remove("out");
      clearTimeout(this._gioTimer);
      this._gioTimer = setTimeout(() => {
        this.el.gio.classList.add("out");
        setTimeout(() => { this.el.gio.style.display = "none"; }, 900);
      }, 30000);
      /* Two rising tones — an alert, not an alarm. */
      try {
        const ctx = this._blipCtx || (this._blipCtx = new (window.AudioContext || window.webkitAudioContext)());
        if (ctx.state !== "suspended") {
          for (const [f, t0] of [[740, 0], [1108, 0.14]]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = "sine"; o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
            g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + t0 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + 0.22);
            o.connect(g).connect(ctx.destination);
            o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + 0.25);
          }
        }
      } catch { /* silence is fine */ }
    };

    /* ── POI card: the planet explorers' scene-popup, bottom right ── */
    this.el.poiCard = mk("scene-popup");
    this.el.poiCard.style.display = "none";
    this.el.poiCard.innerHTML = `
      <button class="scene-popup-close" id="poi-card-close" aria-label="Close">\u2715</button>
      <p class="feature-kicker" id="poi-card-kicker">Selected feature</p>
      <h3 class="feature-title" id="poi-card-title"></h3>
      <p class="feature-meta" id="poi-card-meta"></p>
      <p class="feature-copy" id="poi-card-copy"></p>`;
    this.el.poiCard.querySelector("#poi-card-close")
      .addEventListener("click", () => this.closePoiCard());
    this.poiCardOpen = false;

    /* ── Corner readout, bottom right: the clock over the coordinates,
          the planet viewers' cursor-readout idiom. ── */
    this.el.corner = mk("corner-readout");
    this.el.corner.innerHTML = `
      <canvas id="cr-clock" width="340" height="96"></canvas>
      <div class="cr-latlon" id="cr-latlon">\u2014</div>`;
    this.el.crLatlon = this.el.corner.querySelector("#cr-latlon");
    /* A drawn seven-segment clock, not a font: lit segments in LED blue
       with a glow, unlit segments ghosted behind them the way a real LCD
       shows its whole figure-eight, the panel slanted like every display
       readout here. Redrawn only when the minute changes. */
    this.clockCanvas = this.el.corner.querySelector("#cr-clock");
    this.clockCanvas.style.transform = "skewX(-8deg)";
    this._clockShown = "";
    this._drawClock = (text) => {
      if (text === this._clockShown) return;
      this._clockShown = text;
      const c = this.clockCanvas.getContext("2d");
      const W = this.clockCanvas.width, H = this.clockCanvas.height;
      c.clearRect(0, 0, W, H);
      const SEGS = {
        a: [[0.14, 0.04], [0.86, 0.04], [0.72, 0.16], [0.28, 0.16]],
        b: [[0.88, 0.06], [0.88, 0.48], [0.76, 0.42], [0.76, 0.18]],
        c: [[0.88, 0.52], [0.88, 0.94], [0.76, 0.82], [0.76, 0.58]],
        d: [[0.14, 0.96], [0.86, 0.96], [0.72, 0.84], [0.28, 0.84]],
        e: [[0.12, 0.52], [0.12, 0.94], [0.24, 0.82], [0.24, 0.58]],
        f: [[0.12, 0.06], [0.12, 0.48], [0.24, 0.42], [0.24, 0.18]],
        g: [[0.16, 0.50], [0.28, 0.44], [0.72, 0.44], [0.84, 0.50], [0.72, 0.56], [0.28, 0.56]],
      };
      const DIGIT = {
        "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc",
        "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcfgd",
      };
      const dw = 64, dh = 88, gap = 14, colonW = 22;
      const drawDigit = (x0, y0, lit) => {
        for (const [name, poly] of Object.entries(SEGS)) {
          const on = lit.includes(name);
          c.beginPath();
          for (let i = 0; i < poly.length; i++) {
            const px = x0 + poly[i][0] * dw, py = y0 + poly[i][1] * dh;
            if (i) c.lineTo(px, py); else c.moveTo(px, py);
          }
          c.closePath();
          if (on) {
            c.shadowColor = "rgba(31,58,166,0.9)";
            c.shadowBlur = 10;
            c.fillStyle = "#2244b8";
          } else {
            c.shadowBlur = 0;
            c.fillStyle = "rgba(34,68,184,0.12)";
          }
          c.fill();
        }
        c.shadowBlur = 0;
      };
      let x = 8;
      const y = 4;
      for (const ch of text) {
        if (ch === ":") {
          for (const cy of [0.30, 0.70]) {
            c.shadowColor = "rgba(31,58,166,0.9)";
            c.shadowBlur = 8;
            c.fillStyle = "#2244b8";
            c.beginPath();
            c.arc(x + colonW / 2, y + cy * dh, 5, 0, Math.PI * 2);
            c.fill();
          }
          c.shadowBlur = 0;
          x += colonW + gap * 0.5;
        } else {
          drawDigit(x, y, DIGIT[ch] ?? "");
          x += dw + gap;
        }
      }
    };

    /* ── Footer collapse: one arrow folds the compass and info bar down
          into the edge, U mirrors it from the keyboard. ── */
    this.barsHidden = false;
    this.el.barsTab = mk("bars-tab");
    this.el.barsTab.textContent = "Close \u25BE U";
    this.el.barsTab.title = "Collapse bars (U)";
    this.el.barsTab.addEventListener("click", () => this.setBarsHidden(!this.barsHidden));

    /* ── Compass strip, bottom-centre ── */
    this.el.compass = mk("compass");
    this.compassCanvas = document.createElement("canvas");
    this.compassCanvas.width = 760; this.compassCanvas.height = 40;
    this.el.compass.appendChild(this.compassCanvas);
    this.compctx = this.compassCanvas.getContext("2d");

    /* ── Control centre ──
       One bar, the way the myGeoID shell does it: the clock and every toggle
       in a single place rather than scattered around the edges of the screen.
       Each button is also a keyboard shortcut and says so, because a player
       who learns the key stops using the bar and that is the point of it.

       Time of day lives here rather than floating in the middle of the
       screen. It is not flavour on this mountain — you leave the South Col
       before midnight so you are on the Balcony when it gets light, and you
       turn round at a fixed hour whether or not you are close — so it needs
       to be somewhere you cannot miss it, but not somewhere it is in the way
       of the mountain. */
    /* ── The bar hides, Etna-style ─────────────────────────────────────
       Same interaction as the Etna explorer's side panel: the whole bar
       slides off-screen and a slim tab stays pinned to the edge to bring it
       back. A mountain viewer's chrome should be dismissible — the mountain
       is the point — but never *lost*, so the tab is always there and the
       Escape-free shortcut (backtick) toggles it from the keyboard. */
    /* ── Binocular mask ────────────────────────────────────────────────
       A full-screen canvas painted black with two soft-edged circles
       punched out (destination-out), redrawn on resize. CSS mask-composite
       would do this declaratively but its cross-engine behaviour is a
       gamble; a canvas is eight lines and identical everywhere. Sits above
       the scene, below the panel, ignores the mouse. */
    /* ── The map — an interactive navigation hub, the Etna way ─────────
       The Etna explorer's map interaction, rebuilt for a 2D orthophoto:
       wheel zooms about the cursor, drag pans, and every location is the
       same label furniture Etna draws in 3D — a surface dot, a thin leader
       stem, and a rounded pill with a left accent bar (its exact canvas
       recipe: 34 px pill, dark fill, accent stripe, Orbitron title —
       transcribed here into DOM so the pills stay crisp at any zoom).

       One transform drives everything: the world plane carries
       translate+scale, and each pin counter-scales by 1/k about its own
       anchor, so dots stay pinned to the geography while pills hold
       constant screen size — which is precisely how a 3D sprite label
       behaves, and why the Etna look survives the transplant. */
    this.el.map = mk("map-view");
    this.el.map.style.display = "none";
    this.el.map.innerHTML = `
      <div class="mv-head">
        <span class="mv-title">Khumbu — navigation</span>
        <span class="mv-hint">wheel zoom · drag pan · click a label</span>
        <button class="mv-btn" id="mv-zin">＋</button>
        <button class="mv-btn" id="mv-zout">－</button>
        <button class="mv-btn" id="mv-fit">⌂</button>
        <button class="mv-btn" id="mv-close">✕</button>
      </div>
      <div class="mv-frame" id="mv-frame">
        <div class="mv-world" id="mv-world">
          <img class="mv-img" src="data/khumbu_map.png?r=3" draggable="false">
          <img class="mv-contours" src="data/khumbu_contours.png" draggable="false" alt="">
          <div class="mv-pins" id="mv-pins"></div>
        </div>
        <div class="mv-north" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 2 L17 20 L12 16 L7 20 Z" fill="currentColor"/></svg>
          <span>N</span>
        </div>
        <div class="mv-scale" id="mv-scale" aria-hidden="true">
          <div class="scale-labels">
            <span data-f="0" style="left:0%">0</span>
            <span data-f="0.125" style="left:12.5%">\u2014</span>
            <span data-f="0.25" style="left:25%">\u2014</span>
            <span data-f="0.5" style="left:50%">\u2014</span>
            <span data-f="0.75" style="left:75%">\u2014</span>
            <span data-f="1" style="left:100%">\u2014</span>
          </div>
          <div class="scale-bar-track">
            <span class="scale-segment is-dark"></span><span class="scale-segment is-light"></span>
            <span class="scale-segment is-dark"></span><span class="scale-segment is-light"></span>
            <span class="scale-segment is-dark"></span><span class="scale-segment is-light"></span>
            <span class="scale-segment is-dark"></span><span class="scale-segment is-light"></span>
          </div>
        </div>
      </div>
      <div class="mv-pop" id="mv-pop" style="display:none">
        <div class="mv-pop-name" id="mv-pop-name"></div>
        <div class="mv-pop-meta" id="mv-pop-meta"></div>
        <div class="mv-pop-text" id="mv-pop-text"></div>
        <div class="mv-pop-actions">
          <button class="btn" id="mv-travel">Fast travel</button>
          <button class="btn ghost" id="mv-dismiss">Close</button>
        </div>
      </div>`;
    this.mapOpen = false;
    this._mapPoi = null;
    this.onFastTravel = null;

    const frame = this.el.map.querySelector("#mv-frame");
    const world = this.el.map.querySelector("#mv-world");
    const mimg = this.el.map.querySelector(".mv-img");
    const M = this._map = { k: 1, kMin: 0.1, tx: 0, ty: 0, iw: 3228, ih: 3026 };
    /* The scale bar answers "how far is that" at the current zoom: ground
       metres per screen pixel fall out of the bounds box and the transform,
       and the bar picks the roundest distance that fits its rail — the
       Mars viewer's readout, driven by this map's own numbers. */
    this._updateScale = () => {
      const el = this.el.map.querySelector("#mv-scale");
      if (!el) return;
      const B = { W: 86.780, E: 87.070, N: 28.120, S: 27.880 };
      const midLat = (B.N + B.S) / 2;
      const groundW = (B.E - B.W) * 111320 * Math.cos(midLat * Math.PI / 180);
      const mPerScreenPx = groundW / M.iw / M.k;
      const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
      let D = nice[0];
      for (const d of nice) if (d / mPerScreenPx <= 260) D = d;
      const px = D / mPerScreenPx;
      el.style.setProperty("--scale-bar-width", px.toFixed(0) + "px");
      const fmt = (m) => m >= 1000 ? (m / 1000).toLocaleString() + " km" : m + " m";
      for (const span of el.querySelectorAll(".scale-labels span")) {
        const f = parseFloat(span.dataset.f);
        span.textContent = f === 0 ? "0" : fmt(Math.round(D * f));
      }
    };
    const apply = () => {
      /* The box is fixed; the imagery moves inside it, and only inside it.
         Pan is clamped so the image's edges can never cross into the frame —
         which is also what makes the failure mode reported ("zoom out past
         the bounds, then drag the box itself around") impossible: there is
         no state in which frame-background shows behind the map. */
      const fw = frame.clientWidth, fh = frame.clientHeight;
      M.tx = Math.min(0, Math.max(fw - M.iw * M.k, M.tx));
      M.ty = Math.min(0, Math.max(fh - M.ih * M.k, M.ty));
      world.style.transform = `translate(${M.tx}px, ${M.ty}px) scale(${M.k})`;
      world.style.setProperty("--invk", (1 / M.k).toFixed(4));
      this._updateScale();
    };
    this._mapApply = apply;
    this._mapFrame = frame;
    /* The wearer of the map. A pulsing marker distinct from every pill,
       positioned from the last known lat/lon each time the map opens. */
    this._mapPlayer = document.createElement("div");
    this._mapPlayer.className = "mv-player";
    world.appendChild(this._mapPlayer);
    this._mapFit = () => {
      const fw = frame.clientWidth, fh = frame.clientHeight;
      if (!fw || !fh) return;
      /* COVER, not contain: the minimum zoom fills the box completely, so
         zooming out can never make the map smaller than its frame. */
      M.kMin = Math.max(fw / M.iw, fh / M.ih);
      M.k = Math.max(M.k, M.kMin);
      if (M.k === M.kMin) {
        M.tx = (fw - M.iw * M.k) / 2;
        M.ty = (fh - M.ih * M.k) / 2;
      }
      apply();
    };
    // The frame's size follows the window; the floor must follow with it.
    addEventListener("resize", () => { if (this.mapOpen) this._mapFit(); });
    mimg.addEventListener("load", () => {
      M.iw = mimg.naturalWidth; M.ih = mimg.naturalHeight;
      mimg.style.width = M.iw + "px"; mimg.style.height = M.ih + "px";
      /* The contour sheet shares the ortho's exact extent and pixel grid,
         so it takes the same size and rides the same transform. */
      const cimg = this.el.map.querySelector(".mv-contours");
      cimg.style.width = M.iw + "px"; cimg.style.height = M.ih + "px";
      this._mapFit();
      /* The first open races this load: centring computed against the
         placeholder dimensions is centring on the wrong map. Redone here,
         it is right the moment the real image exists. */
      if (this.mapOpen) this._mapCentrePlayer();
    });
    const zoomAt = (mx, my, factor) => {
      const k2 = Math.max(M.kMin, Math.min(M.kMin * 14, M.k * factor));
      M.tx = mx - (mx - M.tx) * (k2 / M.k);
      M.ty = my - (my - M.ty) * (k2 / M.k);
      M.k = k2;
      apply();
    };
    frame.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = frame.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });
    // Drag pans; a real drag suppresses the click that follows it, so
    // grabbing the map through a pill never teleports anyone by accident.
    let drag = null;
    this._mapDragged = 0;
    frame.addEventListener("pointerdown", (e) => {
      /* preventDefault, or the browser runs its own gesture in parallel:
         image ghost-drag and text selection both start from an unprevented
         pointerdown, and once a native drag begins the browser stops
         delivering pointermove — so the user sees a translucent copy of the
         map sliding around the screen while the real map never pans. That is
         "drag moves the map on the screen, not the map itself", verbatim. */
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    });
    frame.addEventListener("dragstart", (e) => e.preventDefault());
    frame.addEventListener("pointercancel", () => { drag = null; });
    frame.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      /* Capture only once it IS a drag. Capturing on pointerdown retargets
         the entire pointer sequence — including the click that follows — to
         the frame, so a plain click on a label pill never reached the pill:
         no popup, no fast travel, for every real mouse. Synthetic
         pin.click() in the test harness skipped the pointer pipeline
         entirely, which is exactly how that bug shipped verified. */
      // try/catch: capture throws on an already-lifted pointer (and on
      // synthetic events, which is how the test harness found this), and a
      // failed capture must not abort the pan itself.
      if (!drag.moved) { try { frame.setPointerCapture(drag.id); } catch (_) {} }
      drag.moved = true;
      M.tx += dx; M.ty += dy;
      drag.x = e.clientX; drag.y = e.clientY;
      apply();
    });
    frame.addEventListener("pointerup", () => {
      if (drag && drag.moved) this._mapDragged = performance.now();
      drag = null;
    });
    this.el.map.querySelector("#mv-zin").addEventListener("click", () =>
      zoomAt(frame.clientWidth / 2, frame.clientHeight / 2, 1.5));
    this.el.map.querySelector("#mv-zout").addEventListener("click", () =>
      zoomAt(frame.clientWidth / 2, frame.clientHeight / 2, 1 / 1.5));
    this.el.map.querySelector("#mv-fit").addEventListener("click", () => this._mapFit());
    this.el.map.querySelector("#mv-close").addEventListener("click", () => this.toggleMap());
    this.el.map.querySelector("#mv-dismiss").addEventListener("click", () => {
      this.el.map.querySelector("#mv-pop").style.display = "none";
    });
    this.el.map.querySelector("#mv-travel").addEventListener("click", () => {
      if (this._mapPoi && this.onFastTravel) {
        this.onFastTravel(this._mapPoi);
        this.toggleMap();
      }
    });

    this.el.binoc = mk("binoc-mask", this.root, "canvas");
    this.el.binoc.style.display = "none";
    this._drawBinocMask = () => {
      const c = this.el.binoc, x = c.getContext("2d");
      c.width = innerWidth; c.height = innerHeight;
      x.fillStyle = "#000";
      x.fillRect(0, 0, c.width, c.height);
      const r = Math.min(c.width, c.height) * 0.46;
      x.globalCompositeOperation = "destination-out";
      for (const cx of [c.width / 2 - r * 0.62, c.width / 2 + r * 0.62]) {
        const grad = x.createRadialGradient(cx, c.height / 2, r * 0.86, cx, c.height / 2, r);
        grad.addColorStop(0, "rgba(0,0,0,1)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = grad;
        x.beginPath(); x.arc(cx, c.height / 2, r, 0, Math.PI * 2); x.fill();
      }
      x.globalCompositeOperation = "source-over";
    };
    this._drawBinocMask();
    addEventListener("resize", this._drawBinocMask);

    /* The Earth Explorer logo, top right, linking home — same asset and
       placement as every explorer page. */
    this.el.logo = document.createElement("a");
    this.el.logo.id = "top-right-logo-link";
    this.el.logo.href = "/earth_explorer/";
    this.el.logo.target = "_top";
    this.el.logo.setAttribute("aria-label", "Back to Earth Explorer");
    this.el.logo.innerHTML = `<img id="top-right-logo" src="/earth_explorer/assets/logo.png" alt="GeoID logo">`;
    document.body.appendChild(this.el.logo);

    this.el.navTab = mk("nav-tab");
    this.el.navTab.textContent = "Open \u25B8 Tab";
    this.el.navTab.style.display = "none";
    this.el.navTab.addEventListener("click", () => this.setNavHidden(false));


    this.navHidden = false;

    this.el.nav = mk("navbar");
    /* Structured the way the Etna explorer structures its panel: a photo
       hero naming the mountain, then collapsible sections that each explain
       themselves before offering their controls. The flat strip of eight
       unlabelled toggles told a new player nothing; a section that says
       what its switches do is the difference between chrome and a guide. */
    this.el.nav.innerHTML = `
      <div class="brand-toprow">
        <p class="eyebrow">GeoID: Earth Explorer</p>
        <div class="brand-toprow-actions">
          <button class="info-btn" id="nav-info" aria-label="Guide" title="Guide (H)">i</button>
          <button id="nav-collapse-btn" aria-label="Collapse navigation panel" title="Collapse panel (Tab)">\u2039</button>
        </div>
      </div>
      <div id="ui-scroll-body">
        <div class="brand-banner">
          <div class="brand-hero">
            <div class="brand">
              <h1>Everest <svg class="nepal-flag" viewBox="0 0 22 26" aria-label="Nepal" role="img"><path d="M1 1 L15 7.5 L8 10 L21 19 L1 25 Z" fill="#dc143c" stroke="#003893" stroke-width="1.6" stroke-linejoin="round"/></svg></h1>
              <p class="brand-subtitle">Khumbu, Nepal \u00b7 8,848.86 m</p>
            </div>
          </div>
        </div>
        <div class="controls" id="nav-sections"></div>
      </div>
      <div class="nav-status">
        <span class="nav-brandline">\u00a9 2026 GeoID: Explorer. The GeoID Initiative, led by Owen McCluskey. All rights reserved.</span>
        <span class="nav-clock-hidden" hidden><span id="c-time"></span><span id="c-day"></span><span id="c-phase"></span></span>
      </div>`;
    this.el.nav.querySelector("#nav-collapse-btn")
      .addEventListener("click", () => this.setNavHidden(true));
    this.el.nav.querySelector("#nav-info")
      .addEventListener("click", () => this.onTool && this.onTool("help"));

    this.tools = [
      { id: "labels",  key: "T",   label: "Place labels",  icon: "\u2316", tip: "Name pills over camps, peaks and route features. They hide behind terrain like everything else." },
      { id: "route",   key: "N",   label: "Route guider",  icon: "\u27CB", tip: "The fixed line up the South Col route, drawn on the ground." },
      { id: "third",   key: "V",   label: "3rd person",    icon: "\u25E7", tip: "Step outside the climber. Scroll to set the camera distance." },
      { id: "torch",   key: "L",   label: "Head torch",    icon: "\u2600", tip: "The only light between eight in the evening and five in the morning." },
      { id: "items",   key: "Q",   label: "Items wheel",   icon: "\u25CE", tip: "Food, water, dex, the flare. Scroll to choose, click to use." },
      { id: "rope",    key: "R",   label: "Rope up",       icon: "\u2307", tip: "Clip the fixed line. In the Icefall this is what holds a bridge fall." },
      { id: "oxygen",  key: "O",   label: "Oxygen flow",   icon: "\u25CD", tip: "Cycles the regulator: off, 1, 2, 4 L/min. Watch the bottle." },
      { id: "journal", key: "J",   label: "Journal",       icon: "\u25A4", tip: "The forecast, the plan, and what has happened so far." },
      { id: "binoculars", key: "B", label: "Binoculars", icon: "\u25CC", tip: "Zoom the centre of view through the glasses." },
      { id: "map",     key: "M",   label: "Open map",      icon: "\u25A6", tip: "" },
      { id: "help",    key: "H",   label: "Controls card", icon: "?",       tip: "" },
    ];
    const SECTIONS = [
      { id: "display", title: "Display",
        icon: '<svg viewBox="0 0 16 16"><path d="M1.5 8s2.6-4.2 6.5-4.2S14.5 8 14.5 8 11.9 12.2 8 12.2 1.5 8 1.5 8Z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
        copy: "What the mountain shows. Every switch is a preference \u2014 set it here, or use its key anywhere.",
        tools: ["labels", "route", "third", "torch"] },
      { id: "climb", title: "Climb",
        icon: '<svg viewBox="0 0 16 16"><path d="m2 13 4.4-7 2.4 3.6L11 6.4 14 13Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        copy: "The whole expedition from one place: gas, gear, glass and the record. Each control shows its live state.",
        tools: ["oxygen", "items", "rope", "binoculars", "torch", "journal"] },
      { id: "map", title: "Map & fast travel",
        icon: '<svg viewBox="0 0 16 16"><path d="M2 3.6 6 2l4 1.6L14 2v10.4L10 14l-4-1.6L2 14Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 2v10.4M10 3.6V14" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
        copy: "The navigation hub: the massif from above, every named place labelled. Click a pill for its story; fast travel to anywhere you have reached.",
        tools: ["map"] },
      { id: "guide", title: "Guide",
        icon: '<svg viewBox="0 0 16 16"><path d="M3 2.5h6.5a2 2 0 0 1 2 2V13.5H5a2 2 0 0 0-2 2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 2.5v13" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
        copy: "You are walking the real mountain \u2014 Esri imagery on a real elevation model. Head up the glacier, rope up before the Icefall, and mind the oxygen above the Col.",
        tools: ["help"],
        extra: `<dl class="key-list">
          <div><dt>W A S D</dt><dd>walk</dd></div>
          <div><dt>Shift</dt><dd>run</dd></div>
          <div><dt>Mouse / arrows</dt><dd>look</dd></div>
          <div><dt>Space</dt><dd>probe a snow bridge</dd></div>
          <div><dt>B</dt><dd>binoculars</dd></div>
          <div><dt>U</dt><dd>fold compass + info bar</dd></div>
          <div><dt>Tab</dt><dd>fold this panel</dd></div>
          <div><dt>Esc</dt><dd>close any view</dd></div>
        </dl>` },
    ];
    const host = this.el.nav.querySelector("#nav-sections");
    this.toolEls = {};
    for (const sec of SECTIONS) {
      const d = document.createElement("details");
      d.className = "control-section";
      if (sec.open) d.open = true;
      const tools = sec.tools.map((id) => this.tools.find((t) => t.id === id));
      d.innerHTML = `
        <summary class="section-toggle">
          <div class="section-toggle-main">
            <div class="section-title"><span class="section-title-row"><span class="section-icon" aria-hidden="true">${sec.icon}</span><span>${sec.title}</span></span></div>
          </div>
        </summary>
        <div class="section-body">
          <p class="section-summary-copy">${sec.copy}</p>
          <div class="section-tools"></div>
          ${sec.extra || ""}
        </div>`;
      const holder = d.querySelector(".section-tools");
      for (const t of tools) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "nav-btn";
        b.dataset.tool = t.id;
        if (t.tip) b.title = t.tip;
        b.innerHTML = `<span class="nb-icon">${t.icon}</span>` +
                      `<span class="nb-label">${t.label}</span>` +
                      `<span class="nb-key">${t.key}</span>`;
        b.addEventListener("click", (e) => { e.preventDefault(); this.onTool && this.onTool(t.id); });
        holder.appendChild(b);
        /* A tool may sit in more than one section (the torch is Display and
           Climb); every button gets state updates, so the store is a list. */
        (this.toolEls[t.id] || (this.toolEls[t.id] = [])).push(b);
      }
      host.appendChild(d);
    }
    /* A dry click as the cursor crosses anything pressable — WebAudio so it
       needs no asset; created on first use because the context must follow
       a user gesture. */
    this._blip = () => {
      try {
        const ctx = this._blipCtx || (this._blipCtx = new (window.AudioContext || window.webkitAudioContext)());
        if (ctx.state === "suspended") return;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "square"; o.frequency.value = 1750;
        g.gain.setValueAtTime(0.045, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
        o.connect(g).connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.035);
      } catch { /* no audio is not an error */ }
    };
    for (const el of this.el.nav.querySelectorAll(".nav-btn, .section-toggle, .info-btn, #nav-collapse-btn")) {
      el.addEventListener("mouseenter", this._blip);
    }
    for (const [k, id] of [["cTime", "c-time"], ["cDay", "c-day"], ["cPhase", "c-phase"]]) {
      this.el[k] = this.el.nav.querySelector("#" + id);
    }

    /* ── Objective, top-left ── */
    this.el.objective = mk("objective");
    this.el.objective.innerHTML =
      `<div class="obj-eyebrow">Next</div><div class="obj-name" id="o-name">—</div>` +
      `<div class="obj-meta" id="o-meta"></div>`;
    this.el.oName = this.el.objective.querySelector("#o-name");
    this.el.oMeta = this.el.objective.querySelector("#o-meta");

    /* ── Notifications + subtitle, bottom-centre above the compass ── */
    this.el.notify = mk("notify");
    this.el.sub = mk("subtitle");

    /* ── Interact prompt ── */
    this.el.prompt = mk("prompt");

    /* ── Radial wheel ── */
    this.el.wheel = mk("wheel");
    this.wheelCanvas = document.createElement("canvas");
    this.wheelCanvas.width = 560; this.wheelCanvas.height = 560;
    this.el.wheel.appendChild(this.wheelCanvas);
    this.wctx = this.wheelCanvas.getContext("2d");
    this.el.wheelInfo = mk("wheel-info", this.el.wheel);

    /* ── Journal ── */
    this.el.journal = mk("journal");
    this.el.journal.innerHTML = `
      <div class="journal-inner">
        <div class="journal-head">
          <div class="journal-title">Field Journal</div>
          <div class="journal-tabs">
            <button data-tab="route" class="jt active">Route</button>
            <button data-tab="weather" class="jt">Weather</button>
            <button data-tab="places" class="jt">Places</button>
            <button data-tab="body" class="jt">Body</button>
            <button data-tab="log" class="jt">Log</button>
          </div>
        </div>
        <div class="journal-body" id="j-body"></div>
        <div class="journal-foot">TAB to close</div>
      </div>`;
    this.el.jBody = this.el.journal.querySelector("#j-body");
    this.journalTab = "route";
    for (const b of this.el.journal.querySelectorAll(".jt")) {
      b.addEventListener("click", () => {
        this.journalTab = b.dataset.tab;
        for (const o of this.el.journal.querySelectorAll(".jt")) o.classList.toggle("active", o === b);
        this.renderJournal();
      });
    }

    /* ── POI reader ── */
    this.el.reader = mk("reader");
    this.el.reader.innerHTML =
      `<div class="reader-inner"><div class="reader-kind" id="r-kind"></div>` +
      `<h2 id="r-name"></h2><div class="reader-meta" id="r-meta"></div>` +
      `<p id="r-text"></p><button class="reader-close">Close</button></div>`;
    this.el.rKind = this.el.reader.querySelector("#r-kind");
    this.el.rName = this.el.reader.querySelector("#r-name");
    this.el.rMeta = this.el.reader.querySelector("#r-meta");
    this.el.rText = this.el.reader.querySelector("#r-text");
    this.el.reader.querySelector(".reader-close").addEventListener("click", () => this.closeReader());

    /* ── Standing ── */
    // Standing now lives in the control bar; nothing else draws it.
  }

  /* ── Notifications ─────────────────────────────────────────────────── */

  notify(text, kind = "info") {
    const e = document.createElement("div");
    e.className = "note note-" + kind;
    e.textContent = text;
    this.el.notify.appendChild(e);
    const item = { e, t: 0, life: 5.5 + Math.min(6, text.length / 28) };
    this.notifications.push(item);
    while (this.notifications.length > 5) {
      const old = this.notifications.shift();
      old.e.remove();
    }
  }

  say(text, seconds = 7) {
    this.el.sub.textContent = text;
    this.el.sub.classList.add("on");
    this._subTimer = seconds;
  }

  showReader(poi) {
    this.el.rKind.textContent = ({
      camp: "Camp", summit: "Summit", route: "On the route",
      peak: "Peak", site: "Place", warning: "Warning",
    })[poi.kind] || "Place";
    this.el.rName.textContent = poi.name;
    const bits = [];
    bits.push(`${poi.lat.toFixed(4)}° N, ${poi.lon.toFixed(4)}° E`);
    if (poi.summitHeight) bits.push(`${poi.summitHeight.toFixed(2)} m surveyed`);
    else if (poi.published) bits.push(`${poi.published} m`);
    if (poi.kind === "peak" && poi.published) bits.push(`elevation model reads ${Math.round(poi.demHeight ?? poi.y)} m`);
    this.el.rMeta.textContent = bits.join("  ·  ");
    this.el.rText.textContent = poi.text || "No entry.";
    this.el.reader.classList.add("on");
    this.readerOpen = true;
  }
  closeReader() { this.el.reader.classList.remove("on"); this.readerOpen = false; }

  /* ── Per-frame ─────────────────────────────────────────────────────── */

  update(dt, s) {
    // s: the whole game state slice the HUD needs.
    this.drawCores(s);
    this.drawCompass(s);
    this.updateInstruments(s);
    this.updateFx(dt, s);

    for (let i = this.notifications.length - 1; i >= 0; i--) {
      const n = this.notifications[i];
      n.t += dt;
      if (n.t > n.life) { n.e.classList.add("out"); }
      if (n.t > n.life + 0.7) { n.e.remove(); this.notifications.splice(i, 1); }
    }
    if (this._subTimer > 0) {
      this._subTimer -= dt;
      if (this._subTimer <= 0) this.el.sub.classList.remove("on");
    }

    if (this.wheelOpen) this.drawWheel(s);
    if (this.journalOpen) this.journalTick = (this.journalTick || 0) + dt;

    // Objective
    const nxt = s.nextCamp;
    if (nxt) {
      this.setText(this.el.oName, nxt.name);
      const up = Math.round((nxt.published ?? nxt.y) - s.altitude);
      this.setText(this.el.oMeta,
        `${s.distanceToNext > 1200 ? (s.distanceToNext / 1000).toFixed(1) + " km" : Math.round(s.distanceToNext) + " m"}` +
        `  ·  ${up > 0 ? "+" : ""}${up} m  ·  ${compassPoint(s.bearingToNext)}`);
    }


    // Interact prompt
    const p = s.prompt;
    if (p) { this.el.prompt.innerHTML = p; this.el.prompt.classList.add("on"); }
    else this.el.prompt.classList.remove("on");
  }

  setText(el, t) {
    if (this._last[el.className + el.id] === t) return;
    this._last[el.className + el.id] = t;
    el.textContent = t;
  }

  drawCores(s) {
    const c = this.cctx, W = this.coreCanvas.width, H = this.coreCanvas.height;
    c.clearRect(0, 0, W, H);
    const values = {
      health: s.survival.health / 100,
      energy: s.survival.energy / 100,
      warmth: s.survival.warmth / 100,
      oxygen: Math.max(0, Math.min(1, (s.spo2 - 45) / 53)),
    };
    const R = 22, step = 78;
    CORE_DEFS.forEach((def, i) => {
      const cx = 36 + i * step, cy = 40;
      const v = values[def.key];

      // Outer ring — the ring is the reserve, the fill is what is left.
      c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2);
      c.strokeStyle = CHROME_FAINT; c.lineWidth = 3; c.stroke();

      c.beginPath();
      c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v);
      c.strokeStyle = def.colour; c.lineWidth = 3;
      c.shadowColor = def.colour; c.shadowBlur = v < 0.25 ? 12 : 5;
      c.stroke();
      c.shadowBlur = 0;

      /* The core itself: a filled disc that dims as the reserve goes. RDR2's
         central conceit — the ring is the moment, the core is the day. */
      const core = Math.max(0.06, v);
      c.beginPath(); c.arc(cx, cy, R * 0.52 * core, 0, Math.PI * 2);
      c.fillStyle = def.colour;
      c.globalAlpha = v < 0.2 ? 0.45 + 0.55 * Math.abs(Math.sin(performance.now() / 260)) : 0.85;
      c.fill();
      c.globalAlpha = 1;

      /* Labelled in the core's own colour rather than in white. Four white
         captions under four coloured rings makes you read the ring to know
         which is which; colouring the word means you never have to. */
      /* Readable captions: a real size, clear air under the ring, and a
         dark halo so the coloured word holds on snow. */
      c.font = "700 12px Orbitron, 'Exo 2', system-ui, sans-serif";
      c.textAlign = "center";
      c.lineWidth = 3;
      c.strokeStyle = "rgba(2,6,14,0.85)";
      c.strokeText(def.label.toUpperCase(), cx, cy + R + 24);
      c.fillStyle = def.colour;
      c.fillText(def.label.toUpperCase(), cx, cy + R + 24);
    });

    // The one-line reason, when there is one.
    const sv = s.survival;
    let note = "";
    if (s.buried) note = "BURIED — hold SPACE to dig";
    else if (sv.health < 25) note = "You are in trouble";
    else if (sv.warmth < 25) note = "Losing heat faster than you are making it";
    else if (sv.energy < 20) note = "Nothing left in the legs";
    else if (s.spo2 < 60) note = "Not enough air";
    else if (sv.frostbite > 30) note = `Frostbite — ${Math.round(sv.frostbite)}%`;
    else if (sv.snowBlind > 55) note = "Your eyes are burning";
    this.setText(this.el.coreNote, note);
    this.el.coreNote.dataset.on = note ? "1" : "0";
  }

  /** Populate pins once, from the world's POI list — Etna label furniture:
   *  dot on the ground truth, leader stem, accent-barred pill. Positioned in
   *  IMAGE PIXELS inside the transformed plane, counter-scaled per pin. */
  /** Draw the climbing route on the map: one SVG polyline in image-pixel
   *  space, under the pins, its stroke counter-scaled so the line keeps a
   *  constant screen width at any zoom. */
  bindMapRoute(points) {
    const B = { W: 86.780, E: 87.070, N: 28.120, S: 27.880 };
    const M = this._map;
    const world = this.el.map.querySelector("#mv-world");
    const old = world.querySelector(".mv-route");
    if (old) old.remove();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mv-route");
    svg.setAttribute("viewBox", `0 0 ${M.iw} ${M.ih}`);
    svg.setAttribute("width", M.iw);
    svg.setAttribute("height", M.ih);
    const d = points.map((p, i) => {
      const x = ((p.lon - B.W) / (B.E - B.W)) * M.iw;
      const y = ((B.N - p.lat) / (B.N - B.S)) * M.ih;
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
    const casing = document.createElementNS("http://www.w3.org/2000/svg", "path");
    casing.setAttribute("d", d);
    casing.setAttribute("class", "mv-route-casing");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", d);
    line.setAttribute("class", "mv-route-line");
    svg.appendChild(casing);
    svg.appendChild(line);
    const pins = world.querySelector("#mv-pins");
    world.insertBefore(svg, pins);
  }

  bindMapPois(pois) {
    const B = { W: 86.780, E: 87.070, N: 28.120, S: 27.880 };
    const host = this.el.map.querySelector("#mv-pins");
    const M = this._map;
    host.innerHTML = "";
    for (const poi of pois) {
      if (!poi.name) continue;
      const u = (poi.lon - B.W) / (B.E - B.W), v = (B.N - poi.lat) / (B.N - B.S);
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const pin = document.createElement("button");
      pin.className = "mv-pin";
      pin.dataset.kind = poi.kind || "site";
      pin.style.left = (u * M.iw).toFixed(1) + "px";
      pin.style.top = (v * M.ih).toFixed(1) + "px";
      pin.innerHTML = `<i class="pin-dot"></i><b class="pin-stem"></b>
        <span class="pin-pill">${poi.name}</span>`;
      pin.addEventListener("click", () => {
        if (performance.now() - this._mapDragged < 250) return;   // it was a pan
        this._mapPoi = poi;
        this.el.map.querySelector("#mv-pop-name").textContent = poi.name;
        this.el.map.querySelector("#mv-pop-meta").textContent =
          `${poi.lat.toFixed(4)}° N, ${poi.lon.toFixed(4)}° E` +
          (poi.published ? `  ·  ${poi.published.toLocaleString()} m` : "");
        this.el.map.querySelector("#mv-pop-text").textContent =
          poi.text || "No notes on this location.";
        this.el.map.querySelector("#mv-pop").style.display = "";
      });
      host.appendChild(pin);
    }
  }

  /** Plant the player marker at their coordinates and centre the view on
   *  it at a readable zoom — the map opens ON the player, not wherever it
   *  was last left. */
  _mapCentrePlayer() {
    if (this._lastLat === undefined) return;
    const B = { W: 86.780, E: 87.070, N: 28.120, S: 27.880 };
    const M = this._map;
    const px = ((this._lastLon - B.W) / (B.E - B.W)) * M.iw;
    const py = ((B.N - this._lastLat) / (B.N - B.S)) * M.ih;
    this._mapPlayer.style.left = px.toFixed(1) + "px";
    this._mapPlayer.style.top = py.toFixed(1) + "px";
    M.k = Math.max(M.kMin * 3, M.k);
    const fw = this._mapFrame.clientWidth, fh = this._mapFrame.clientHeight;
    M.tx = fw / 2 - px * M.k;
    M.ty = fh / 2 - py * M.k;
    this._mapApply();
  }

  showPoiCard(poi) {
    const KIND = { camp: "Camp", summit: "Summit", peak: "Peak", warning: "Hazard", route: "Route feature", site: "Site" };
    this.el.poiCard.querySelector("#poi-card-kicker").textContent = KIND[poi.kind] || "Selected feature";
    this.el.poiCard.querySelector("#poi-card-title").textContent = poi.name;
    this.el.poiCard.querySelector("#poi-card-meta").textContent =
      `${poi.lat.toFixed(4)}\u00b0 N, ${poi.lon.toFixed(4)}\u00b0 E` +
      (poi.published ? `  \u00b7  ${Math.round(poi.published).toLocaleString()} m` : "");
    this.el.poiCard.querySelector("#poi-card-copy").textContent =
      poi.text || "No notes on this location.";
    this.el.poiCard.style.display = "";
    this.poiCardOpen = true;
  }

  closePoiCard() {
    this.el.poiCard.style.display = "none";
    this.poiCardOpen = false;
  }

  toggleMap() {
    this.mapOpen = !this.mapOpen;
    this.el.map.style.display = this.mapOpen ? "" : "none";
    this.el.map.querySelector("#mv-pop").style.display = "none";
    if (this.mapOpen) {
      if (document.pointerLockElement) document.exitPointerLock();
      requestAnimationFrame(() => {
        this._mapFit();
        this._mapCentrePlayer();
      });
    }
  }

  setBinoculars(on) {
    this.binocularsOn = on;
    this.el.binoc.style.display = on ? "" : "none";
  }

  setNavHidden(hidden) {
    this.navHidden = hidden;
    this.el.nav.classList.toggle("is-hidden", hidden);
    this.el.navTab.style.display = hidden ? "" : "none";
  }

  setBarsHidden(on) {
    this.barsHidden = on;
    document.body.classList.toggle("bars-hidden", on);
    this.el.barsTab.textContent = on ? "Open \u25B4 U" : "Close \u25BE U";
  }

  drawCompass(s) {
    const c = this.compctx, W = this.compassCanvas.width, H = this.compassCanvas.height;
    c.clearRect(0, 0, W, H);
    const pxPerDeg = W / 150;                       // 150° of arc across the strip
    const heading = s.heading;

    c.strokeStyle = CHROME_LINE;
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, H - 2); c.lineTo(W, H - 2); c.stroke();

    /* Ticks live at fixed WORLD bearings and the viewport scrolls over
       them. The first version put ticks at fixed offsets from the current
       heading — so the ticks never moved while the "is this a 45?" test
       flickered true and false underneath them as the camera turned, and
       the whole strip appeared to stutter. Iterating the actual multiples
       of five degrees inside the window makes every tick and glyph ride
       smoothly across the strip, and snapping x to the pixel grid stops
       the 2-3 px lines shimmering between columns. */
    const first = Math.ceil((heading - 80) / 5) * 5;
    for (let deg = first; deg <= heading + 80; deg += 5) {
      const x = Math.round(W / 2 + (deg - heading) * pxPerDeg);
      if (x < 0 || x > W) continue;
      const bearing = ((deg % 360) + 360) % 360;
      const major = bearing % 45 === 0;
      c.strokeStyle = major ? CHROME_BRIGHT : INK_FAINT;
      c.lineWidth = major ? 4.5 : 3;
      c.beginPath(); c.moveTo(x, H - 2); c.lineTo(x, H - (major ? 17 : 9)); c.stroke();
      if (major) {
        /* No plate behind this strip any more, so the glyphs carry their own
           contrast: a heavy dark outline stroked first, then the fill. On
           snow the outline is the legibility; on rock it disappears into the
           shadowed pixels and costs nothing. */
        c.font = "800 13px 'Exo 2', system-ui, sans-serif";
        c.textAlign = "center";
        c.lineWidth = 3.5;
        c.strokeStyle = "rgba(8,1,20,0.85)";
        c.strokeText(compassPoint(bearing), x, H - 16);
        c.fillStyle = DATA;
        c.fillText(compassPoint(bearing), x, H - 16);
      }
    }

    // Where the next camp is, and where the wind is coming from.
    const mark = (bearing, colour, glyph) => {
      let d = ((bearing - heading + 540) % 360) - 180;
      if (Math.abs(d) > 78) return;
      const x = W / 2 + d * pxPerDeg;
      c.font = "800 13px 'Exo 2', system-ui, sans-serif";
      c.textAlign = "center";
      c.lineWidth = 3.5;
      c.strokeStyle = "rgba(8,1,20,0.85)";
      c.strokeText(glyph, x, 13);
      c.fillStyle = colour;
      c.fillText(glyph, x, 13);
    };
    if (s.nextCamp) mark(s.bearingToNext, CHROME, "▲");

    c.fillStyle = CHROME;
    c.beginPath(); c.moveTo(W / 2, H - 2); c.lineTo(W / 2 - 5, H - 12); c.lineTo(W / 2 + 5, H - 12); c.closePath();
    c.fill();
  }

  updateInstruments(s) {
    this.setText(this.el.cTime, s.clock);
    this.setText(this.el.cDay, `Day ${Math.floor(s.seasonDay) + 1}`);
    this.setText(this.el.cPhase, s.phase);
    this.el.nav.dataset.night = s.sunAltitude < -1 ? "1" : "0";

    /* Every toggle's lit state comes from the game, once a frame — so the
       bar cannot drift out of step with the shortcut that does the same
       thing. The torch also shows what is left in it. */
    const on = s.toggles || {};
    for (const t of this.tools) {
      for (const el of this.toolEls[t.id] || []) {
        const v = on[t.id];
        el.dataset.on = v ? "1" : "0";
        if (t.id === "torch") {
          el.dataset.warn = s.lampBattery < 25 ? "1" : "0";
          el.querySelector(".nb-key").textContent = v ? `${Math.round(s.lampBattery)}%` : t.key;
        }
        if (t.id === "oxygen") {
          const f = s.survival.o2Flow, litres = Math.round(s.survival.bottleLitres);
          el.dataset.on = f > 0 && litres > 0 ? "1" : "0";
          el.querySelector(".nb-key").textContent = f > 0 ? `${f} L \u00b7 ${litres}` : t.key;
        }
        if (t.id === "binoculars") el.dataset.on = this.binocularsOn ? "1" : "0";
      }
    }

    /* Each reading carries its own temperature: 0 is deep blue (cold, low,
       calm), 1 is red (hot, high, severe), and the neutral middle keeps the
       data ink so a quiet bar stays quiet. The scale is per-parameter — the
       same helper, different framing of what "high" means. */
    const tint = (el, t) => {
      t = Math.max(0, Math.min(1, t));
      const lerp = (a, b, k) => Math.round(a + (b - a) * k);
      const c = t < 0.5
        ? [lerp(96, 168, t * 2), lerp(170, 205, t * 2), lerp(255, 232, t * 2)]
        : [lerp(168, 255, (t - 0.5) * 2), lerp(205, 92, (t - 0.5) * 2), lerp(232, 92, (t - 0.5) * 2)];
      el.style.color = `rgb(${c[0]},${c[1]},${c[2]})`;
    };
    this.setText(this.el.i_alt, Math.round(s.altitude).toLocaleString());
    /* Total ground covered this expedition, walked or fallen. */
    if (s.distance !== undefined) {
      this.setText(this.el.i_dist, s.distance >= 1000
        ? (s.distance / 1000).toFixed(2) + " km"
        : Math.round(s.distance) + " m");
    }
    this.setText(this.el.i_temp, `${s.tempC.toFixed(0)}°C  (${s.chillC.toFixed(0)}°)`);
    tint(this.el.i_temp, (s.tempC + 35) / 50);
    this.setText(this.el.i_wind, `${(s.windMs * 3.6).toFixed(0)} km/h ${compassPoint(s.windFrom)}`);
    tint(this.el.i_wind, (s.windMs * 3.6) / 130);
    /* What the environment would cost the body — wind drag plus the
       altitude/condition deficit — shown as a reading now that neither is
       allowed to slow the player. */
    this.setText(this.el.i_resist, `${Math.round((s.resistance || 0) * 100)}%`);
    tint(this.el.i_resist, s.resistance || 0);
    this.setText(this.el.i_slope, `${s.slopeDeg.toFixed(0)}°`);
    tint(this.el.i_slope, s.slopeDeg / 55);
    this.setText(this.el.i_spo2, `${Math.round(s.spo2)}%`);
    /* SpO2 is the one reading where LOW is the emergency, so its scale is
       inverted: full red at 60%, settled blue at 95%. */
    tint(this.el.i_spo2, (95 - s.spo2) / 35);
    this.setText(this.el.i_flow, s.survival.o2Flow > 0 && s.survival.bottleLitres > 0
      ? `${s.survival.o2Flow} L/min · ${Math.round(s.survival.bottleLitres)} L`
      : "off");
    this._drawClock(s.clock);
    if (s.lat !== undefined && s.lon !== undefined) {
      this._lastLat = s.lat; this._lastLon = s.lon;
      this.setText(this.el.crLatlon,
        `${Math.abs(s.lat).toFixed(5)}\u00b0 ${s.lat < 0 ? "S" : "N"}  ` +
        `${Math.abs(s.lon).toFixed(5)}\u00b0 ${s.lon < 0 ? "W" : "E"}`);
    }
    const r = Director.rate(s.stability);
    this.setText(this.el.i_avy, r.word);
    tint(this.el.i_avy, { Low: 0.1, Moderate: 0.45, Considerable: 0.75, High: 1 }[this.el.i_avy.textContent] ?? 0.5);
    this.el.i_avy.dataset.level = r.level;
  }

  updateFx(dt, s) {
    const d = s.survival.distress(s.altitude);
    const blind = s.survival.snowBlind / 100;
    // The vignette is hypoxia, not damage: tunnel vision is one of the first
    // things to go, and it goes before you notice it has.
    this.el.vignette.style.opacity = String(Math.min(0.94, d * 0.85 + blind * 0.5));
    this.el.vignette.style.setProperty("--squeeze", `${18 + d * 46}%`);
    this.el.frost.style.opacity = String(Math.min(0.7, Math.max(0, (28 - s.survival.warmth) / 28) * 0.7));
    this.el.fx.style.setProperty("--desat", String(Math.min(0.85, d * 0.7 + blind * 0.6)));

    const bars = this.cinematic;
    this.el.barTop.style.height = `${bars * 11}vh`;
    this.el.barBottom.style.height = `${bars * 11}vh`;
    this.root.dataset.cinematic = bars > 0.05 ? "1" : "0";
  }

  flash(colour = "rgba(220,60,40,0.55)") {
    this.el.flash.style.background = colour;
    this.el.flash.style.opacity = "1";
    requestAnimationFrame(() => { this.el.flash.style.opacity = "0"; });
  }

  /* ── Radial wheel ──────────────────────────────────────────────────── */

  wheelItems(survival) {
    return Object.keys(ITEMS).filter((k) => survival.inventory[k] > 0 || k === "goggles");
  }

  drawWheel(s) {
    const c = this.wctx, W = this.wheelCanvas.width, H = this.wheelCanvas.height;
    const cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);
    const items = this.wheelItems(s.survival);
    if (!items.length) return;
    const n = items.length;
    const R0 = 96, R1 = 214;

    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + (i - 0.5) * (Math.PI * 2 / n) + 0.018;
      const a1 = a0 + (Math.PI * 2 / n) - 0.036;
      const sel = i === this.wheelIndex;
      c.beginPath();
      c.arc(cx, cy, sel ? R1 + 12 : R1, a0, a1);
      c.arc(cx, cy, R0, a1, a0, true);
      c.closePath();
      c.fillStyle = sel ? "rgba(77,141,255,0.26)" : "rgba(6,10,20,0.78)";
      c.fill();
      c.strokeStyle = sel ? CHROME : "rgba(77,141,255,0.30)";
      c.lineWidth = sel ? 2 : 1;
      c.stroke();

      const am = (a0 + a1) / 2;
      const tr = (R0 + R1) / 2;
      c.fillStyle = sel ? INK : "rgba(214,194,255,0.74)";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = `${sel ? "700" : "600"} 17px 'Exo 2', system-ui, sans-serif`;
      c.fillText(ITEMS[items[i]].short, cx + Math.cos(am) * tr, cy + Math.sin(am) * tr - 9);
      const count = s.survival.inventory[items[i]];
      c.font = "600 13px 'Exo 2', system-ui, sans-serif";
      c.fillStyle = CHROME_BRIGHT;
      c.fillText(items[i] === "goggles"
        ? (s.survival.wearingGoggles ? "worn" : "up")
        : `×${count}`, cx + Math.cos(am) * tr, cy + Math.sin(am) * tr + 12);
    }

    // Oxygen flow lives in the middle of the wheel, because it is the thing
    // you change most often and it is not an item you use up in one go.
    c.beginPath(); c.arc(cx, cy, R0 - 8, 0, Math.PI * 2);
    c.fillStyle = "rgba(4,7,15,0.88)"; c.fill();
    c.strokeStyle = "rgba(77,141,255,0.45)"; c.lineWidth = 1; c.stroke();
    c.fillStyle = CHROME; c.textAlign = "center";
    c.font = "700 26px 'Exo 2', system-ui, sans-serif";
    c.fillText(`${s.survival.o2Flow}`, cx, cy - 6);
    c.font = "600 11px 'Exo 2', system-ui, sans-serif";
    c.fillStyle = "rgba(214,194,255,0.72)";
    c.fillText("L/MIN  ← →", cx, cy + 16);
    c.fillText(s.survival.bottleLitres > 0 ? `${Math.round(s.survival.bottleLitres)} L left` : "no bottle", cx, cy + 34);

    const it = ITEMS[items[this.wheelIndex]];
    this.el.wheelInfo.innerHTML =
      `<div class="wi-name">${it.name}</div><div class="wi-desc">${it.desc}</div>` +
      `<div class="wi-use">ENTER to use  ·  ${it.weight.toFixed(2)} kg each</div>`;
  }

  openWheel() { this.wheelOpen = true; this.el.wheel.classList.add("on"); }
  closeWheel() { this.wheelOpen = false; this.el.wheel.classList.remove("on"); }
  wheelMove(d, survival) {
    const n = this.wheelItems(survival).length || 1;
    this.wheelIndex = ((this.wheelIndex + d) % n + n) % n;
  }
  wheelSelected(survival) { return this.wheelItems(survival)[this.wheelIndex]; }

  /* ── Journal ───────────────────────────────────────────────────────── */

  toggleJournal(state) {
    this.journalOpen = state !== undefined ? state : !this.journalOpen;
    this.el.journal.classList.toggle("on", this.journalOpen);
    if (this.journalOpen) this.renderJournal();
  }

  renderJournal() {
    const s = this.journalState;
    if (!s) return;
    const b = this.el.jBody;
    if (this.journalTab === "route") {
      b.innerHTML = `<div class="j-list">` + s.world.pois
        .filter((p) => p.kind === "camp" || p.kind === "summit" || p.kind === "route")
        .sort((a, c) => (a.order ?? 0) - (c.order ?? 0))
        .map((p) => {
          const done = s.reached.has(p.id);
          const dist = Math.hypot(p.x - s.px, p.z - s.pz);
          return `<div class="j-row ${done ? "done" : ""} ${p.camp ? "camp" : ""}">
            <span class="j-tick">${done ? "●" : "○"}</span>
            <span class="j-name">${p.name}</span>
            <span class="j-alt">${p.published ? p.published.toLocaleString() + " m" : ""}</span>
            <span class="j-dist">${dist > 1200 ? (dist / 1000).toFixed(1) + " km" : Math.round(dist) + " m"}</span>
          </div>`;
        }).join("") + `</div>`;
    } else if (this.journalTab === "weather") {
      const w = s.weather;
      b.innerHTML = `
        <p class="j-lead">The jet stream sits on this mountain for most of the year. It is
        ${(w.jetLift() * 100).toFixed(0)}% lifted today. A summit push needs it lifted and
        the wind on top under about 50 km/h — and a forecast five days out is a guess
        wearing a number.</p>
        <div class="j-forecast">` + w.forecast.map((f) => `
          <div class="j-fc">
            <div class="fc-day">+${f.day}d</div>
            <div class="fc-state">${f.name}</div>
            <div class="fc-wind ${f.summitWind < 50 ? "ok" : f.summitWind < 90 ? "warn" : "bad"}">${f.summitWind} km/h</div>
            <div class="fc-conf">${Math.round(f.confidence * 100)}% conf.</div>
          </div>`).join("") + `</div>
        <div class="j-now">Now: <b>${w.label}</b> · summit wind ${(w.windAt(8849) * 3.6).toFixed(0)} km/h ·
        visibility ${w.visibility > 2000 ? (w.visibility / 1000).toFixed(0) + " km" : Math.round(w.visibility) + " m"} ·
        fresh snow ${(w.snowFall * 100).toFixed(0)}%</div>`;
    } else if (this.journalTab === "places") {
      b.innerHTML = `<div class="j-places">` + s.world.pois
        .filter((p) => p.text)
        .map((p) => `<div class="j-place"><h4>${p.name}</h4><p>${p.text}</p></div>`)
        .join("") + `</div>`;
    } else if (this.journalTab === "body") {
      const sv = s.survival;
      const pk = s.pressureKPa(s.altitude);
      b.innerHTML = `
        <p class="j-lead">At this altitude the air pressure is <b>${pk.toFixed(1)} kPa</b> against
        101.3 at the sea, and the oxygen you are actually breathing in is
        <b>${s.piO2.toFixed(1)} kPa</b> against 19.9. That one number is the whole mountain.</p>
        <div class="j-body-grid">
          <div><span>Saturation</span><b>${Math.round(s.spo2)}%</b></div>
          <div><span>Acclimatisation</span><b>${Math.round(sv.acclimatisation * 100)}%</b></div>
          <div><span>Highest slept</span><b>${Math.round(sv.highestSlept)} m</b></div>
          <div><span>Frostbite</span><b>${Math.round(sv.frostbite)}%</b></div>
          <div><span>Snow blindness</span><b>${Math.round(sv.snowBlind)}%</b></div>
          <div><span>Carried</span><b>${sv.carriedWeight.toFixed(1)} kg</b></div>
          <div><span>Time above 8,000 m</span><b>${(sv.deathZoneSeconds / 3600).toFixed(1)} h</b></div>
          <div><span>Roped</span><b>${sv.roped ? "yes" : "no"}</b></div>
        </div>`;
    } else {
      b.innerHTML = `<div class="j-log">` +
        (s.survival.log.length ? s.survival.log.slice().reverse().map((l) => `<p>${l.text}</p>`).join("")
                               : `<p class="j-empty">Nothing written down yet.</p>`) + `</div>`;
    }
  }
}
