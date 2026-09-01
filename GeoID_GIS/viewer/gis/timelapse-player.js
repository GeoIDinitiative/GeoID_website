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
  padding: 0.45rem 0.7rem;
  background: rgb(16, 7, 36);
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
.geoid-timelapse input[type="range"] { flex: 1 1 12rem; accent-color: var(--nav-accent); }
.geoid-timelapse .tl-date {
  font-size: 0.82rem; letter-spacing: 0.06em; color: var(--text);
  min-width: 6.2rem; text-align: center; font-variant-numeric: tabular-nums;
}
.geoid-timelapse .tl-note {
  font-size: 0.68rem; opacity: 0.75; color: var(--soft-light);
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

let state = null;

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
  state.bar.date.textContent = epoch.label || epoch.date;
  state.bar.slider.value = String(index);
  state.bar.note.textContent = state.noteFor(epoch, epoch.note || "reading imagery…");

  const scene = await sceneOf(epoch);
  if (!state || state.index !== index) return;   // a newer step won the race
  epoch.note = scene.note;
  state.bar.note.textContent = state.noteFor(epoch, scene.note);

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

  back.addEventListener("click", () => { play(false); step(-1); });
  forward.addEventListener("click", () => { play(false); step(1); });
  playBtn.addEventListener("click", () => play(!state?.timer));
  slider.addEventListener("input", () => { play(false); void show(Number(slider.value)); });
  close.addEventListener("click", () => stopPlayer());

  bar.append(back, playBtn, forward, date, slider, note, close);
  document.body.appendChild(bar);
  return { bar, date, slider, note, play: playBtn };
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
  state = null;
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
  noteFor = (epoch, tail) => tail, onStatus = () => {}, onStop = null,
  interval = 1200 }) {
  stopPlayer();
  state = {
    epochs, frames, bounds, source, noteFor, onStop, interval,
    index: 0, timer: null, scenes: new Map(), bar: buildBar(),
    say: onStatus, playing: false,
  };
  state.bar.slider.max = String(epochs.length - 1);
  await show(0);
  return { frames: epochs.length };
}
