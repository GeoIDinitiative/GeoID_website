/**
 * THE TIME-LAPSE PLAYER — one bar, one scene cache, one play loop.
 *
 * There are two animators over this globe and they differ in exactly one
 * thing: what, if anything, is drawn ON TOP of each frame. The glacier
 * time-lapse steps the GLIMS archive's own dates with a set of outlines per
 * frame; the imagery time-lapse steps a range of dates with nothing but the
 * picture. Everything else — the bar, the slider, the play loop, the swap on
 * ready, the prefetch, the GEE→GIBS→none fallback, the four bbox vocabularies
 * — is the same apparatus, and this file is the reason there is one of it.
 *
 * That is this tree's oldest rule, paid for by the polygon-area formula in ten
 * files and by an imitated label engine: an implementation that copies another
 * is wrong wherever they differ, and they differ everywhere you did not look.
 *
 * WHAT A DRIVER SUPPLIES: a box, an ordered list of EPOCHS, and optionally one
 * scene-graph node per epoch to show with it. An epoch is
 * `{ date, from, to, dataset, label? }` — the date is what the bar shows and
 * what GIBS is asked for; `from`/`to` are the window Earth Engine composites
 * over; `dataset` is the collection to ask it for, or null for none. Choosing
 * those is the driver's job, because "which imagery for this frame" is the one
 * question the two animators genuinely answer differently.
 *
 * ONE PLAYER AT A TIME, deliberately: two bars over one globe is nonsense, so
 * starting either animator stops whichever was running.
 */

const search = new URL(import.meta.url).search;

/** The bar's own furniture. Mind the STYLE literal: no backticks inside it. */
const STYLE = `
.geoid-timelapse {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: 5.6rem; z-index: 24;
  display: flex; align-items: center; gap: 0.55rem;
  /* Room under the row for the tick labels, which hang below the track. */
  padding: 0.45rem 0.7rem 0.95rem;
  background: var(--skin-tab-ground, rgb(16, 7, 36));
  border: 1px solid rgba(var(--nav-accent-rgb), 0.55);
  border-radius: 0.78rem;
  box-shadow: 0 0 18px rgba(var(--nav-accent-rgb), 0.22);
  font-family: "Exo 2", system-ui, sans-serif;
  max-width: min(46rem, 88vw);
}
.geoid-timelapse button {
  min-width: 2.1rem; height: 1.85rem;
  border-radius: 0.4rem;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.5);
  background: rgba(var(--nav-accent-rgb), 0.12);
  color: var(--text); cursor: pointer; font-size: 0.85rem;
}
.geoid-timelapse button:hover { background: rgba(var(--nav-accent-rgb), 0.3); }
.geoid-timelapse button.tl-overlay.is-off {
  opacity: 0.45;
  border-style: dashed;
}
.geoid-timelapse input[type="range"] { flex: 1 1 12rem; accent-color: var(--nav-accent); }
.geoid-timelapse .tl-date {
  font-size: 0.82rem; letter-spacing: 0.06em; color: var(--text);
  min-width: 6.2rem; text-align: center; font-variant-numeric: tabular-nums;
}
/* THE NOTE IS NOT SQUEEZED TO NOTHING. It is the only part of the bar that
   says anything about the frame, and as an ordinary flex item it was giving
   its width up to its neighbours: measured at 104px against 130px of content,
   so "13513 storms, 5733 named" read as "13513 storms, 5733...". It keeps its
   own width up to the cap, and the cap is what stops a long note pushing the
   close button off a narrow screen. */
/* The rate pill: the same bordered square the other controls wear, with room
   for two characters rather than one glyph. */
.geoid-timelapse .tl-speed { min-width: 2.2rem; font-variant-numeric: tabular-nums; }
/* THE SLIDER TAKES THE SLACK. A 355-frame sequence in 129px is a handle with
   nowhere to go and ticks two pixels apart; the bar has the room and nothing
   else in it wants to grow. */
.geoid-timelapse .tl-scale { flex: 1 1 auto; min-width: 17rem; position: relative; }
.geoid-timelapse .tl-scale input[type=range] { width: 100%; display: block; }
/* DRAWN, not left to the browser. A datalist on a range is the standard answer
   and what it renders is at the browser's discretion -- Chrome hides the marks
   entirely once the element is laid out at zero size, which is what it takes
   to keep the list itself off the bar. These are ours, so they are there. */
.geoid-timelapse .tl-ticks {
  position: absolute; left: 0; right: 0; bottom: -1px; height: 0.5rem;
  pointer-events: none;
}
.geoid-timelapse .tl-tick {
  position: absolute; bottom: 0; width: 1px; height: 0.22rem;
  background: rgba(var(--nav-accent-rgb), 0.55);
}
/* A LABELLED tick stands taller, because a scale with a number every mark is a
   row of numbers rather than a scale. */
.geoid-timelapse .tl-tick.is-major { height: 0.42rem; background: rgba(var(--nav-accent-rgb), 0.9); }
.geoid-timelapse .tl-tick span {
  position: absolute; left: 50%; transform: translateX(-50%);
  bottom: -0.72rem; font-size: 0.52rem; opacity: 0.65; white-space: nowrap;
}
.geoid-timelapse .tl-note {
  font-size: 0.68rem; opacity: 0.75; color: var(--soft-light);
  flex: 0 1 auto; min-width: max-content;
  max-width: 15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
`;

/**
 * WHICH IMAGERY FOR WHICH YEAR, in the order the sources actually cover.
 *
 * Sentinel-2 is 10 m and starts in 2015; the Landsat archive reaches 1984 and
 * is what the older half of any record needs. The ids are Earth Engine's own;
 * a service that has not been redeployed refuses the Landsat ones, which is
 * why every one of these has GIBS behind it.
 */
export function datasetForYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  if (y >= 2015) return { id: "COPERNICUS/S2_SR_HARMONIZED", label: "Sentinel-2", metres: 10 };
  if (y >= 2013) return { id: "LANDSAT/LC08/C02/T1_L2", label: "Landsat 8", metres: 30 };
  if (y >= 1999) return { id: "LANDSAT/LE07/C02/T1_L2", label: "Landsat 7", metres: 30 };
  if (y >= 1984) return { id: "LANDSAT/LT05/C02/T1_L2", label: "Landsat 5", metres: 30 };
  return null;
}

/**
 * WHICH IMAGERY THE READER ASKED FOR.
 *
 * "auto" takes the best that will answer for the year; the rest are a choice,
 * because a reader comparing two frames may want the SAME instrument in both
 * even where a better one exists for one of them — a change that is really a
 * change of sensor is the easiest false reading a time-lapse can produce.
 */
export const IMAGERY_SOURCES = {
  auto: "Best available",
  gee: "Earth Engine (Sentinel-2 / Landsat)",
  gibs: "NASA GIBS (MODIS / VIIRS, 250 m)",
  none: "None — no imagery",
};

/**
 * THE MELT SEASON OF THAT YEAR, not a few weeks around the date.
 *
 * Measured on the service: Sentinel-2 over Iceland for 2016 answered "no
 * imagery" for a 90-day window and returned a picture for the summer — one
 * satellite over one glacier in six weeks is mostly cloud, and the composite
 * the service builds over a season is the picture the outline was drawn from
 * anyway. Southern-hemisphere ice melts in the other half of the year, so the
 * season follows the latitude rather than the calendar.
 */
export function seasonFor(date, lat) {
  const year = Number(String(date).slice(0, 4));
  if (!Number.isFinite(year)) return null;
  if (Number(lat) < 0) return { from: `${year - 1}-11-01`, to: `${year}-04-30` };
  return { from: `${year}-05-01`, to: `${year}-10-31` };
}

/**
 * THE WORLD CLOCK BELONGS TO THE WORLD, NOT TO A SEQUENCE.
 *
 * The corner pill (LIVE / ×720 / paused) and the seven-segment clock report
 * the MODEL's moment — the wall clock the globe spins on and every fetch is
 * stamped in. A time-lapse is running on its own clock entirely, and the two
 * on screen together say that "2020" and "01/09/26 19:47 UTC" are both the
 * time being shown. So they stand down while a sequence is up, and come back
 * exactly as they were when it closes.
 *
 * The spin goes with them, and not merely because the pill that stops it is
 * hidden: a sequence is about one box, and a globe turning at 3°/s walks it
 * off the limb while somebody is reading it. `holdTheGlobe()` already does
 * this on every import — through the viewer's OWN `setSpinPaused`, so the
 * corner pill stays truthful — and a sequence is the same kind of moment.
 *
 * Restored, never forced: a reader who had the globe paused before pressing
 * play does not want it turning afterwards.
 */
const WORLD_CLOCK = ["time-rate-toggle", "time-scrub-toggle", "time-scrub-panel"];

/**
 * Hidden with an INLINE display, not the `hidden` attribute: these elements
 * are laid out by id rules in `styles.css`, and `hidden` is only a UA-level
 * `display: none` that any author rule outranks — the trap this tree has paid
 * for in the symbology dialog and the Research Hub both.
 */
function holdWorldClock() {
  const held = [];
  for (const id of WORLD_CLOCK) {
    const el = document.getElementById(id);
    if (!el) continue;
    held.push([el, el.style.display]);
    el.style.display = "none";
  }
  const viewer = window.GeoIDViewer;
  const wasPaused = viewer?.isSpinPaused?.() ?? null;
  viewer?.setSpinPaused?.(true);
  return () => {
    for (const [el, display] of held) el.style.display = display;
    if (wasPaused === false) viewer?.setSpinPaused?.(false);
  };
}

let state = null;
let pendingToggle = null;
/**
 * The rates the pill cycles. x1 is the driver's own interval, so a sequence
 * that knows it is long opens at a sane pace and these only ever multiply it.
 */
const SPEEDS = [1, 2, 4, 8];
/** Kept across sequences: a reader who wants it fast wants it fast again. */
let speedAt = 0;

function styleOnce() {
  if (document.getElementById("geoid-timelapse-style")) return;
  const tag = document.createElement("style");
  tag.id = "geoid-timelapse-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/** The imagery for one epoch, or null — and it says which source answered. */
async function sceneFor(epoch, bounds, say, choice = "auto") {
  if (choice === "none") return { object3D: null, note: "imagery off" };
  const wanted = epoch.dataset || null;
  const gee = await import(`./gee.js${search}`);

  if (wanted && choice !== "gibs") {
    try {
      const data = await gee.fetchScene({
        dataset: wanted.id,
        bounds: { minX: bounds.west, minY: bounds.south, maxX: bounds.east, maxY: bounds.north },
        from: epoch.from, to: epoch.to, dimensions: epoch.dimensions || 1024,
      });
      if (data?.imageUrl) {
        return {
          object3D: await gee.drape(data.imageUrl, data.bounds),
          note: `${wanted.label}${wanted.metres ? `, ${wanted.metres} m` : ""}`
            + ` · ${data.from}–${data.to} · Earth Engine`,
        };
      }
    } catch (error) {
      // The deployed service refuses anything outside its allowlist — today
      // that is every Landsat id — and answers 404 where a window genuinely
      // holds no scene. Both are a reason to fall through, not to fail.
      if (choice === "gee") {
        return { object3D: null, note: `no ${wanted.label} here — ${error.message}` };
      }
      say?.(`Earth Engine has no ${wanted.label} for ${epoch.date} — using NASA GIBS.`);
    }
  }
  if (choice === "gee") {
    return { object3D: null, note: `Earth Engine has nothing for ${epoch.date}` };
  }

  const sources = await import(`./tile-sources.js${search}`);
  const id = sources.gibsSourceFor(epoch.date);
  if (!id) return { object3D: null, note: "no imagery before 2000" };
  const drapeMod = await import(`./basemap-drape.js${search}`);
  /**
   * A FOURTH BOX VOCABULARY, and it cost this feature its imagery until it was
   * measured. `basemap-drape` speaks `{minLat, maxLat, minLon, maxLon}`; this
   * module and the extent picker speak `{west, south, east, north}`; `gee.drape`
   * speaks `{minX, minY, maxX, maxY}`. Handed the wrong one, nothing throws:
   * `lonToPixelX(undefined)` is NaN, `chooseZoom` falls to 0, every tile URL
   * carries NaN, and the composite reports "no tiles for this area" — which
   * reads as a service with no coverage rather than a mismatched shape.
   *
   * `credit: false` because the banner is BURNT INTO the texture, and on a
   * frame of a sequence it is a caption stamped across the ground that changes
   * every second. The condition is still met: the bar names the instrument,
   * the date and NASA GIBS, in text a reader can actually read.
   */
  const result = await drapeMod.composite(
    { minLon: bounds.west, minLat: bounds.south, maxLon: bounds.east, maxLat: bounds.north },
    id, { credit: false },
  );
  return {
    object3D: await gee.drape(result.canvas.toDataURL("image/jpeg", 0.86),
      { minX: bounds.west, minY: bounds.south, maxX: bounds.east, maxY: bounds.north }),
    note: `${sources.TILE_SOURCES[id].label} · 250 m · NASA EOSDIS GIBS`,
  };
}

/** The scene for an epoch, fetched at most once and remembered. */
function sceneOf(epoch) {
  if (!state.scenes.has(epoch.date)) {
    state.scenes.set(epoch.date, sceneFor(epoch, state.bounds, state.say, state.source)
      .catch((error) => ({ object3D: null, note: `imagery unavailable — ${error.message}` })));
  }
  return state.scenes.get(epoch.date);
}

/**
 * Show one epoch: whatever is drawn over it at once, and its picture WHEN IT
 * ARRIVES.
 *
 * The flicker was here. The old order hid every drape the moment the step
 * happened and put the new one up when it landed, so each step went
 * imagery → bare basemap → imagery, and the whole frame appeared to blink.
 * Nothing is taken away now until its replacement is in hand: the ground holds
 * the previous date for the second it takes to fetch, which is what a reader
 * reads as a dissolve rather than a fault.
 */
async function show(index) {
  if (!state) return;
  const epoch = state.epochs[index];
  if (!epoch) return;
  state.index = index;
  if (state.frames) state.frames.forEach((node, i) => { node.visible = i === index; });
  /**
   * The driver hears the step BEFORE the picture is fetched, because what it
   * does with it — pointing the layer's feature list at the frame on screen —
   * is what a click on a polygon reads a moment later. A list left on the
   * whole fetch answers with whichever of a glacier's outlines came first in
   * the array, which may be an 1850 one under a 2016 frame.
   */
  state.onShow?.(index, epoch);
  state.bar.date.textContent = epoch.label || epoch.date;
  state.bar.slider.value = String(index);
  state.bar.note.textContent = state.noteFor(epoch, epoch.note || "reading imagery…");
  // The bar is one line and the note is 15rem of it, so a driver may have more
  // to say than fits. `noteTitle` is where the sentence goes rather than being
  // cut in half -- and the half that gets cut is always the end, which is
  // where the qualification lives.
  state.bar.note.title = state.noteTitle?.(epoch) || "";

  const scene = await sceneOf(epoch);
  if (!state || state.index !== index) return;   // a newer step won the race
  epoch.note = scene.note;
  state.bar.note.textContent = state.noteFor(epoch, scene.note);
  state.bar.note.title = state.noteTitle?.(epoch) || "";

  if (scene.object3D) {
    if (!scene.object3D.parent) {
      scene.object3D.userData.geoidLayer = true;
      /**
       * ABOVE THE BASEMAP, BELOW EVERY WORKSPACE LAYER.
       *
       * `drape()` hands back a mesh at renderOrder 6 — the viewer's own basemap
       * shell band — because the GEE path registers it as a LAYER and lets
       * `applyStack` stamp the band on afterwards. A frame of a sequence is not
       * a layer, so it keeps what it was given: measured, the picture was on
       * the globe, visible, and drawn under the streamed imagery patch at 40,
       * which is indistinguishable from no imagery at all. 45 puts it over that
       * patch and under the imported band (50+), so anything in Workspace —
       * glacier outlines included — still draws on top of the film.
       */
      scene.object3D.traverse((node) => { node.renderOrder = 45; });
      window.GeoIDViewer?.globe?.add?.(scene.object3D);
    }
    scene.object3D.visible = true;
  }
  // Only now does the previous picture come down.
  for (const [date, pending] of state.scenes) {
    if (date === epoch.date) continue;
    const held = await pending;
    if (held.object3D) held.object3D.visible = false;
  }

  // The next frame, fetched while this one is being looked at.
  const next = state.epochs[(index + 1) % state.epochs.length];
  if (next && next !== epoch) void sceneOf(next);
}

function step(by) {
  if (!state) return;
  const next = (state.index + by + state.epochs.length) % state.epochs.length;
  void show(next);
}

function play(on) {
  if (!state) return;
  state.playing = on;
  state.bar.play.textContent = on ? "❚❚" : "▶";
  window.clearTimeout(state.timer);
  state.timer = null;
  if (!on) return;
  /**
   * A STEP WAITS FOR ITS PICTURE, up to a point.
   *
   * A fixed interval marches past a scene that is still arriving, so a slow
   * frame is skipped and the sequence reads as a stutter. This advances when
   * the next frame is in hand — or after four seconds, because a source that
   * is not going to answer must not stop the sequence either.
   */
  const tick = async () => {
    if (!state?.playing) return;
    const next = state.epochs[(state.index + 1) % state.epochs.length];
    await Promise.race([
      sceneOf(next),
      new Promise((done) => { window.setTimeout(done, 4000); }),
    ]);
    if (!state?.playing) return;
    await show((state.index + 1) % state.epochs.length);
    if (!state?.playing) return;
    state.timer = window.setTimeout(tick, state.interval);
  };
  state.timer = window.setTimeout(tick, state.interval);
}

function buildBar() {
  styleOnce();
  const bar = document.createElement("div");
  bar.className = "geoid-timelapse";
  bar.id = "geoid-timelapse";
  const back = document.createElement("button");
  back.textContent = "◀";
  back.title = "The frame before";
  const playBtn = document.createElement("button");
  playBtn.textContent = "▶";
  playBtn.title = "Play the sequence";
  const forward = document.createElement("button");
  forward.textContent = "▶|";
  forward.title = "The next frame";
  const date = document.createElement("span");
  date.className = "tl-date";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.step = "1";
  const note = document.createElement("span");
  note.className = "tl-note";
  const close = document.createElement("button");
  close.textContent = "✕";
  close.title = "Close the time-lapse";

  /**
   * THE OVERLAY TOGGLE, and only where there is an overlay to toggle.
   *
   * A driver that draws something over its frames (the glacier outlines) says
   * so; the imagery animator passes none and gets no button, because a control
   * that does nothing is worse than none.
   *
   * It is NOT a second switch. It drives the layer through the hierarchy's own
   * `setVisible`, so the bar and the eye in Workspace are one state seen twice
   * — this tree's own "one layer, one control".
   */
  let overlay = null;
  if (state?.toggle || pendingToggle) {
    overlay = document.createElement("button");
    overlay.className = "tl-overlay";
    overlay.textContent = "◇";
    overlay.title = "Show or hide what is drawn over the imagery";
    overlay.addEventListener("click", () => {
      state?.toggle?.setOn(!state.toggle.isOn());
      syncOverlay();
    });
  }

  /**
   * THE RATE, as a pill that cycles rather than a row of buttons.
   *
   * A sequence's natural pace depends entirely on how many frames it has: the
   * cyclone archive stepped one storm at a time is 4,982 frames, which at the
   * 1.2 s a 47-season sequence wants would take a hundred minutes. So the rate
   * is a control rather than a constant — and one pill rather than three
   * buttons, because this bar is already seven controls wide and the choice is
   * a cycle, not a menu.
   *
   * The driver's own `interval` is x1; the pill multiplies it, so a sequence
   * that knows it is long can still open at a sane pace.
   */
  const speed = document.createElement("button");
  speed.className = "tl-speed";
  const sayRate = () => {
    const rate = SPEEDS[speedAt];
    speed.textContent = rate === 1 ? "1x" : `${rate}x`;
    const ms = Math.round((state?.baseInterval || 1200) / rate);
    speed.title = `Playing a frame every ${ms} ms. Press for the next rate.`;
  };
  speed.addEventListener("click", () => {
    speedAt = (speedAt + 1) % SPEEDS.length;
    sayRate();
    if (state) {
      state.interval = Math.round(state.baseInterval / SPEEDS[speedAt]);
      // Restart the timer so the new rate takes effect on THIS frame rather
      // than after the current one has finished waiting out the old one.
      if (state.timer) { play(false); play(true); }
    }
  });

  /**
   * TICKS ON THE SLIDER, because a bare track says nothing about where in the
   * record the handle is. A `datalist` is the browser's own answer and needs
   * no drawing of ours; the driver says which frames deserve a mark, since
   * only it knows whether they are decades, seasons or months.
   */
  const scale = document.createElement("div");
  scale.className = "tl-scale";
  const ticks = document.createElement("div");
  ticks.className = "tl-ticks";
  scale.append(slider, ticks);

  back.addEventListener("click", () => { play(false); step(-1); });
  forward.addEventListener("click", () => { play(false); step(1); });
  playBtn.addEventListener("click", () => play(!state?.timer));
  slider.addEventListener("input", () => { play(false); void show(Number(slider.value)); });
  close.addEventListener("click", () => stopPlayer());

  bar.append(back, playBtn, forward, speed, date, scale, note);
  if (overlay) bar.appendChild(overlay);
  bar.appendChild(close);
  document.body.appendChild(bar);
  sayRate();
  return { bar, date, slider, note, play: playBtn, overlay, speed, ticks, sayRate };
}

/**
 * The button says what the LAYER says, not what was last pressed — the eye in
 * Workspace moves the same state, and a bar that disagreed with it would be
 * the second control this deliberately is not.
 */
function syncOverlay() {
  if (!state?.bar?.overlay || !state.toggle) return;
  const on = state.toggle.isOn();
  state.bar.overlay.classList.toggle("is-off", !on);
  state.bar.overlay.setAttribute("aria-pressed", on ? "true" : "false");
}

if (typeof window !== "undefined") {
  window.addEventListener("geoid-gis:layers-changed", () => syncOverlay());
}

/** Take the whole thing off the globe, and let the driver clear up its own. */
export function stopPlayer() {
  if (!state) return;
  window.clearTimeout(state.timer);
  state.bar.bar.remove();
  for (const pending of state.scenes.values()) {
    void pending.then((scene) => scene?.object3D?.parent?.remove(scene.object3D)).catch(() => {});
  }
  const done = state.onStop;
  const restore = state.restoreClock;
  state = null;
  restore?.();
  done?.();
}

/** Is a sequence running, and which frame is up? (For the drivers and tests.) */
export function playerIndex() {
  return state ? state.index : -1;
}

/**
 * Put a sequence on the globe and show its first frame.
 *
 * `frames` is optional and parallel to `epochs`: one scene-graph node per
 * epoch, shown with it and hidden with it. The imagery animator passes none.
 */
export async function startPlayer({ bounds, epochs, source = "auto", frames = null,
  noteFor = (epoch, tail) => tail, noteTitle = null,
  onStatus = () => {}, onStop = null,
  overlayToggle = null, onShow = null, interval = 1200,
  /**
   * WHERE THE BAR OPENS. Frame 0 for a sequence somebody pressed play on --
   * that is the beginning, and it is what every driver wanted until now.
   *
   * A bar that opens BECAUSE A LAYER WAS TICKED needs the other end: the
   * reader asked for the layer, not for the first frame of it, so the bar has
   * to park somewhere that leaves the layer saying what its own name says.
   * Opening a cyclone track sequence at 1980 would answer a tick for "every
   * storm on record" with 105 of 13,513.
   */
  startAt = 0 }) {
  stopPlayer();
  // `buildBar` needs to know whether there is an overlay before `state` exists.
  pendingToggle = overlayToggle;
  state = {
    epochs, frames, bounds, source, noteFor, noteTitle, onStop, onShow,
    // The driver's pace is x1; the pill multiplies it.
    baseInterval: interval,
    interval: Math.round(interval / SPEEDS[speedAt]),
    toggle: overlayToggle,
    index: 0, timer: null, scenes: new Map(), bar: buildBar(),
    say: onStatus, playing: false, restoreClock: holdWorldClock(),
  };
  pendingToggle = null;
  syncOverlay();
  state.bar.slider.max = String(epochs.length - 1);
  state.bar.sayRate?.();
  /**
   * A tick per marked frame. The driver names them because only it knows what
   * they mean; with none it says so by drawing none, rather than this guessing
   * an interval that would be wrong for every sequence but one.
   */
  const marked = epochs
    .map((epoch, i) => (epoch.tick ? { epoch, i } : null))
    .filter(Boolean);
  /**
   * A LABEL ON EVERY MARK IS A ROW OF NUMBERS, not a scale. Forty-eight years
   * across nine rems is a number every four pixels, so only every nth mark is
   * written — chosen from how many there are rather than fixed, because the
   * same bar carries 47 seasons and 354 storm frames.
   */
  /**
   * How many labels the TRACK can hold, not a fixed count: a four-character
   * year needs about 34px to stand clear of its neighbours, and this bar is
   * the same width whether it is carrying 47 seasons or 354 storm frames.
   */
  const room = Math.max(2, Math.floor(
    (state.bar.slider.getBoundingClientRect().width || 260) / 34));
  const every = Math.max(1, Math.ceil(marked.length / room));
  const span = Math.max(1, epochs.length - 1);
  marked.forEach(({ epoch, i }, n) => {
    const mark = document.createElement("i");
    mark.className = "tl-tick";
    mark.style.left = `${(i / span) * 100}%`;
    if (n % every === 0 && epoch.tickLabel) {
      mark.classList.add("is-major");
      const text = document.createElement("span");
      text.textContent = epoch.tickLabel;
      mark.appendChild(text);
    }
    state.bar.ticks.appendChild(mark);
  });
  const opening = Math.min(Math.max(0, startAt | 0), epochs.length - 1);
  await show(opening);
  return { frames: epochs.length };
}
