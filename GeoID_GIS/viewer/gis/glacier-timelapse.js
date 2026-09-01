/**
 * GLACIER TIME-LAPSE — the archive's own dates, stepped through.
 *
 * A change map answers "how much" in one number. A reader looking at a
 * retreating tongue wants to SEE it, and the archive has what that needs: not
 * two outlines but every outline anybody submitted, each with the date of the
 * image it was drawn from. This plays them in order, with imagery from the
 * same date underneath, so the outline and the ground move together.
 *
 * WHAT IT IS MADE OF, and each part is somebody else's work already in this
 * app: `glims-outlines` fetches the outlines (`all: true`, which keeps the
 * older ones the change layer deliberately drops); `renderFeatureCollection`
 * builds each epoch's geometry once; `gee.js`'s `fetchScene` and `drape` put a
 * picture on the terrain; and the bar is the Draw HUD's own furniture.
 *
 * IMAGERY, IN ORDER OF WHAT IS ACTUALLY THERE.
 *
 * - **Earth Engine** where the service will answer: Sentinel-2 at 10 m from
 *   2015, and Landsat back to 1984 the moment the function is redeployed with
 *   its catalogue resolution — measured today, the deployed one still answers
 *   "Unknown or unsupported dataset" for every Landsat id, which is the
 *   shortfall `CLAUDE.md` already records.
 * - **GIBS** otherwise: MODIS true colour from 2000-02-24, VIIRS from 2012,
 *   250 m, keyless and CORS-open. Context at ice-cap scale, and honestly not
 *   an outline.
 * - **Nothing before 2000**, where the outlines play on the basemap alone. The
 *   bar says which of the three it is drawing, always.
 *
 * EVERY SCENE IS A REQUEST, and Earth Engine's are billed, so nothing is
 * fetched until the timeline reaches it, everything is cached, and the panel
 * says how many epochs it is about to step through before it starts.
 */

const search = new URL(import.meta.url).search;

/** The bar's own furniture. Mind the STYLE literal: no backticks inside it. */
const STYLE = `
.glacier-timelapse {
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
.glacier-timelapse button {
  min-width: 2.1rem; height: 1.85rem;
  border-radius: 0.4rem;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.5);
  background: rgba(var(--nav-accent-rgb), 0.12);
  color: var(--text); cursor: pointer; font-size: 0.85rem;
}
.glacier-timelapse button:hover { background: rgba(var(--nav-accent-rgb), 0.3); }
.glacier-timelapse input[type="range"] { flex: 1 1 12rem; accent-color: var(--nav-accent); }
.glacier-timelapse .tl-date {
  font-size: 0.82rem; letter-spacing: 0.06em; color: var(--text);
  min-width: 6.2rem; text-align: center; font-variant-numeric: tabular-nums;
}
.glacier-timelapse .tl-note {
  font-size: 0.68rem; opacity: 0.75; color: var(--soft-light);
  max-width: 15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
`;

/**
 * WHICH IMAGERY FOR WHICH YEAR, in the order the sources actually cover.
 *
 * Sentinel-2 is 10 m and starts in 2015; the Landsat archive reaches 1984 and
 * is what the older half of any glacier record needs. The ids are Earth
 * Engine's own; a service that has not been redeployed refuses the Landsat
 * ones, which is why every one of these has GIBS behind it.
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
 * The dates worth stepping through.
 *
 * One epoch per distinct date the archive holds here. Where there are more
 * than the bar can be scrubbed through usefully, the fullest dates win — an
 * epoch holding three outlines of a valley is a frame nobody can read, and
 * dropping it is better than a slider with two hundred stops. What was dropped
 * is RETURNED rather than swallowed, so the panel can say so.
 */
export function epochsFrom(features, { max = 24 } = {}) {
  const byDate = new Map();
  for (const feature of features || []) {
    const date = String(feature?.properties?.outline_date
      || feature?.properties?.src_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(feature);
  }
  const all = [...byDate.entries()].map(([date, list]) => ({ date, features: list }));
  all.sort((a, b) => b.features.length - a.features.length);
  const kept = all.slice(0, max).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { epochs: kept, dropped: Math.max(0, all.length - kept.length) };
}

let state = null;

function styleOnce() {
  if (document.getElementById("glacier-timelapse-style")) return;
  const tag = document.createElement("style");
  tag.id = "glacier-timelapse-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/**
 * WHICH IMAGERY THE READER ASKED FOR.
 *
 * "auto" takes the best that will answer for the year; the rest are a choice,
 * because a reader comparing two epochs may want the SAME instrument in both
 * even where a better one exists for one of them — a change that is really a
 * change of sensor is the easiest false reading a time-lapse can produce.
 */
export const IMAGERY_SOURCES = {
  auto: "Best available",
  gee: "Earth Engine (Sentinel-2 / Landsat)",
  gibs: "NASA GIBS (MODIS / VIIRS, 250 m)",
  none: "None — outlines only",
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

/** The imagery for one epoch, or null — and it says which source answered. */
async function sceneFor(epoch, bounds, say, choice = "auto") {
  if (choice === "none") return { object3D: null, note: "outlines only" };
  const year = Number(epoch.date.slice(0, 4));
  const wanted = datasetForYear(year);
  const gee = await import(`./gee.js${search}`);
  const middle = (bounds.north + bounds.south) / 2;
  const season = seasonFor(epoch.date, middle);

  if (wanted && choice !== "gibs") {
    try {
      const data = await gee.fetchScene({
        dataset: wanted.id,
        bounds: { minX: bounds.west, minY: bounds.south, maxX: bounds.east, maxY: bounds.north },
        from: season.from, to: season.to, dimensions: 1024,
      });
      if (data?.imageUrl) {
        return {
          object3D: await gee.drape(data.imageUrl, data.bounds),
          note: `${wanted.label}, ${wanted.metres} m · ${data.from}–${data.to}`
            + " · Earth Engine",
        };
      }
    } catch (error) {
      // The deployed service refuses anything outside its allowlist — today
      // that is every Landsat id — and answers 404 where a season genuinely
      // holds no scene. Both are a reason to fall through, not to fail.
      if (choice === "gee") {
        return { object3D: null, note: `no ${wanted.label} for ${year} — ${error.message}` };
      }
      say?.(`Earth Engine has no ${wanted.label} for ${year} — using NASA GIBS.`);
    }
  }
  if (choice === "gee") {
    return { object3D: null, note: `Earth Engine has nothing for ${year}` };
  }

  const sources = await import(`./tile-sources.js${search}`);
  const id = sources.gibsSourceFor(epoch.date);
  if (!id) return { object3D: null, note: "no imagery before 2000 — outlines only" };
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
 * Show one epoch: its outlines at once, and its picture WHEN IT ARRIVES.
 *
 * The flicker was here. The old order hid every drape the moment the step
 * happened and put the new one up when it landed, so each step went
 * imagery → bare basemap → imagery, and with the outlines swapping in the same
 * instant the whole frame appeared to blink. Nothing is taken away now until
 * its replacement is in hand: the ground holds the previous date for the
 * second it takes to fetch, which is what a reader reads as a dissolve rather
 * than a fault.
 */
async function show(index, { fetchScene = true } = {}) {
  if (!state) return;
  const epoch = state.epochs[index];
  if (!epoch) return;
  state.index = index;
  state.groups.forEach((group, i) => { group.visible = i === index; });
  state.bar.date.textContent = epoch.date;
  state.bar.slider.value = String(index);
  state.bar.note.textContent = `${epoch.features.length} outlines · ${epoch.note || "reading imagery…"}`;
  if (!fetchScene) return;

  const scene = await sceneOf(epoch);
  if (!state || state.index !== index) return;   // a newer step won the race
  epoch.note = scene.note;
  state.bar.note.textContent = `${epoch.features.length} outlines · ${scene.note}`;

  if (scene.object3D) {
    if (!scene.object3D.parent) {
      scene.object3D.userData.geoidLayer = true;
      /**
       * ABOVE THE BASEMAP, BELOW THE OUTLINES.
       *
       * `drape()` hands back a mesh at renderOrder 6 — the viewer's own basemap
       * shell band — because the GEE path registers it as a LAYER and lets
       * `applyStack` stamp the band on afterwards. A frame of a sequence is not
       * a layer, so it keeps what it was given: measured, the picture was on
       * the globe, visible, and drawn under the streamed imagery patch at 40,
       * which is indistinguishable from no imagery at all.
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
    state.timer = window.setTimeout(tick, 1200);
  };
  state.timer = window.setTimeout(tick, 1200);
}

function buildBar() {
  styleOnce();
  const bar = document.createElement("div");
  bar.className = "glacier-timelapse";
  bar.id = "glacier-timelapse";
  const back = document.createElement("button");
  back.textContent = "◀";
  back.title = "The epoch before";
  const playBtn = document.createElement("button");
  playBtn.textContent = "▶";
  playBtn.title = "Play the sequence";
  const forward = document.createElement("button");
  forward.textContent = "▶|";
  forward.title = "The next epoch";
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
  close.addEventListener("click", () => stopTimelapse());

  bar.append(back, playBtn, forward, date, slider, note, close);
  document.body.appendChild(bar);
  return { bar, date, slider, note, play: playBtn };
}

/** Take the whole thing off the globe. */
export function stopTimelapse() {
  if (!state) return;
  window.clearInterval(state.timer);
  state.bar.bar.remove();
  const layer = (window.GeoIDImportManager?.getLayers?.() || [])
    .find((l) => l.id === state.layerId);
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  for (const pending of state.scenes.values()) {
    void pending.then((scene) => scene?.object3D?.parent?.remove(scene.object3D)).catch(() => {});
  }
  state = null;
}

/**
 * Build the sequence for one box and one window of time.
 *
 * Returns what it found so the panel can say it — including what it had to
 * drop, because a slider that quietly holds a quarter of the dates is the
 * same silent cap this file's neighbours keep paying for.
 */
export async function startTimelapse({ bounds, from = null, to = null,
  source = "auto", onStatus = () => {} }) {
  stopTimelapse();
  const [{ runConnector }, render] = await Promise.all([
    import(`./research/connectors.js${search}`),
    import(`./vector-render.js${search}`),
  ]);
  onStatus("Reading every outline the archive holds here…");
  const result = await runConnector("glims-outlines", {
    bbox: {
      minLon: bounds.west, minLat: bounds.south,
      maxLon: bounds.east, maxLat: bounds.north,
    },
    from, to, all: true, limit: 8000,
  });
  const { epochs, dropped } = epochsFrom(result.geojson.features);
  if (epochs.length < 2) {
    onStatus("Fewer than two dates here — nothing to play. Try a wider area or window.");
    return { epochs: 0 };
  }

  const THREE = await import("../vendor/three.module.js");
  const group = new THREE.Group();
  group.name = "Glacier time-lapse";
  /**
   * A GHOST OF EVERY GLACIER, under the sequence and never hidden.
   *
   * Each epoch holds only the glaciers somebody mapped THAT DAY — 31 outlines
   * on one date here, 12 on the next — so stepping made whole glaciers appear
   * and vanish, which reads as the map breaking rather than as the archive
   * being uneven. The union, drawn as thin outlines and left up, is the
   * continuity: what moves between frames is then genuinely the ice that was
   * remapped.
   */
  const seen = new Set();
  const ghostFeatures = [];
  for (const feature of result.geojson.features) {
    const id = feature?.properties?.glac_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ghostFeatures.push(feature);
  }
  const ghost = render.renderFeatureCollection(
    { type: "FeatureCollection", features: ghostFeatures },
    { colourFor: () => "#4d7f96", outlineOnly: true },
  );
  const ghostNode = ghost?.object3D || ghost;
  group.add(ghostNode);

  const groups = epochs.map((epoch, i) => {
    const built = render.renderFeatureCollection(
      { type: "FeatureCollection", features: epoch.features },
      {
        // The newest epoch is the brightest: a sequence reads forwards.
        colourFor: () => (i === epochs.length - 1 ? "#eaf7ff" : "#8fd3f4"),
        outlineOnly: false,
      },
    );
    const node = built?.object3D || built;
    node.visible = false;
    group.add(node);
    return node;
  });

  const layer = window.GeoIDImportManager?.addDerivedLayer?.("Glacier time-lapse", {
    object3D: group,
    georeferenced: true,
    bounds: { minX: bounds.west, maxX: bounds.east, minY: bounds.south, maxY: bounds.north },
    features: result.geojson.features,
    collection: result.geojson,
  }, "glims");

  state = {
    epochs, groups, bounds, index: 0, timer: null, scenes: new Map(),
    bar: buildBar(), layerId: layer?.id || null, say: onStatus,
    source, playing: false,
  };
  state.bar.slider.max = String(epochs.length - 1);
  await show(0);
  onStatus(`${epochs.length} dates from ${epochs[0].date} to ${epochs[epochs.length - 1].date}`
    + `, ${result.geojson.features.length.toLocaleString()} outlines`
    + (dropped ? `, ${dropped} sparser dates left out` : "")
    + ". Press play, or drag the bar.");
  return { epochs: epochs.length, dropped };
}

if (typeof window !== "undefined") {
  window.GeoIDGlacierTimelapse = { startTimelapse, stopTimelapse, datasetForYear, epochsFrom };
}
