/**
 * Earth Observation ▸ Atmosphere ▸ "3D atmosphere model" — the air over a
 * study area as a 3D grid, opened in the Model page's Results reader.
 *
 * The numbers are GFS's own on its pressure levels (Open-Meteo, keyless, CORS
 * open): temperature, humidity, dew point, cloud, wind, ω and the height of
 * each level, for a lattice of columns over the box at the hour asked. What
 * the forecast does not publish is derived per node in `atmosphere-model.js`
 * (specific humidity, θ, θe, density, precipitable water, the layer).
 *
 * The hand-off is the Etna tomography's road: a .vtu, opened with
 * `GeoIDGalesResults.openFolder`, so slices, isosurfaces, thresholds by layer,
 * stream lines of the wind, statistics by layer and every export work on it
 * with nothing added. When a project is open the file is filed into
 * `post_processing/atmosphere/` as well, so it can be opened again later.
 *
 * This card is Earth's: the Atmosphere markup is shared with nine planets
 * that have no GFS.
 */

import { requestUrl, chunkPoints, pickHour } from "./flow-field.js?v=20261024-1b7de02";
import { pvdText } from "./vtk-export.js?v=20261024-1b7de02";
import {
  LEVELS, levelVariables, readColumn, buildAtmosphereGrid, gridFile, localFrame, LAYER_NAMES,
} from "./atmosphere-model.js?v=20261024-1b7de02";
import { refreshPolygonOptions, resolvePolygonExtent, signedLon } from "./extent-picker.js?v=20261024-1b7de02";

const BASE = "https://api.open-meteo.com/v1/forecast";
const CHUNK = 24; // two hundred variables a point: the URL is long, so the chunks are short
const CONCURRENCY = 3;
const KM_PER_DEG = 111.195;

const byId = (id) => document.getElementById(id);
let busy = false;

function say(message) {
  const node = byId("atmosphere-model-status");
  if (node) node.textContent = message;
}

/** A box of `km` square about the middle of the view, signed degrees. */
export function boxAbout(lat, lon, km) {
  const half = km / 2;
  const dLat = half / KM_PER_DEG;
  const dLon = half / (KM_PER_DEG * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return {
    south: Math.max(-85, lat - dLat), north: Math.min(85, lat + dLat),
    west: lon - dLon, east: lon + dLon,
  };
}

/** The lattice of column centres, row by row from the south-west. */
export function lattice(box, n) {
  const lats = [];
  const lons = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      lats.push(box.south + (box.north - box.south) * (n === 1 ? 0.5 : j / (n - 1)));
      lons.push(signedLon(box.west + (box.east - box.west) * (n === 1 ? 0.5 : i / (n - 1))));
    }
  }
  return { lats, lons };
}

/** The levels from the surface up to (and including) the top asked for. */
export function levelsTo(topHpa) {
  return LEVELS.filter((p) => p >= topHpa);
}

/** Open-Meteo answers one object for one place and a list for several. */
const asList = (json) => (Array.isArray(json) ? json : [json]);

async function fetchColumns(lats, lons, levels, hoursAhead, signal) {
  const variables = levelVariables(levels);
  const chunks = chunkPoints(lats, lons, CHUNK);
  const answers = new Array(lats.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next];
      next += 1;
      const url = requestUrl(BASE, {
        lats: chunk.lats, lons: chunk.lons, variables, hoursAhead,
        extra: { models: "gfs_seamless", wind_speed_unit: "ms" },
      });
      const res = await fetch(url, { signal });
      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try { reason = (await res.json()).reason || reason; } catch { /* keep the status */ }
        throw new Error(reason);
      }
      asList(await res.json()).forEach((loc, k) => { answers[chunk.start + k] = loc; });
      done += chunk.lats.length;
      say(`Reading GFS pressure levels… ${done} of ${lats.length} columns.`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return answers;
}

/** The ground under a column, in metres; the sea is its surface. */
function groundAt(lat, lon) {
  const v = window.GeoIDViewer;
  const h = v?.sampleElevationMeters?.(lat, ((lon % 360) + 360) % 360);
  return Number.isFinite(h) ? Math.max(0, h) : 0;
}

async function fileIntoProject(file) {
  const store = window.GeoIDResearch?.store;
  if (!store?.getActive?.()) return null;
  try {
    const path = `post_processing/atmosphere/${file.name}`;
    await store.writeProjectFile(path, file);
    await store.registerData?.({ name: file.name, kind: "model", path, source: "GFS pressure levels (Open-Meteo)" });
    return path;
  } catch {
    return null;
  }
}

export async function buildModel() {
  if (busy) return;
  const v = window.GeoIDViewer;
  const mode = byId("atmosphere-extent")?.value || "view";
  let box;
  if (mode === "view") {
    const centre = v?.getViewCentreLatLon?.();
    if (!centre || !Number.isFinite(centre.lat)) { say("The globe is not ready yet."); return; }
    const km = Math.max(20, Math.min(2000, Number(byId("atmosphere-width")?.value) || 300));
    box = boxAbout(centre.lat, signedLon(centre.lon), km);
  } else {
    const got = resolvePolygonExtent(mode);
    if (!got || got.error) { say(got?.error || "Draw an area on the globe first — the Draw tool is active."); return; }
    box = got;
  }
  if (box.east - box.west > 30 || box.north - box.south > 30) {
    say("That area is wider than 30° — a model of the air is a regional thing. Choose a smaller box.");
    return;
  }
  const n = Number(byId("atmosphere-lattice")?.value) || 8;
  const top = Number(byId("atmosphere-top")?.value) || 100;
  const hoursAhead = Number(byId("atmosphere-time")?.value) || 0;
  const exaggerate = Number(byId("atmosphere-exaggerate")?.value) || 5;
  const levels = levelsTo(top);

  busy = true;
  const button = byId("atmosphere-build");
  if (button) button.disabled = true;
  try {
    const { lats, lons } = lattice(box, n);
    const answers = await fetchColumns(lats, lons, levels, hoursAhead);
    const nowMs = Date.now();
    say("Building the grid…");
    const columns = answers.map((loc, c) => {
      const idx = pickHour(loc?.hourly?.time, nowMs, hoursAhead);
      if (idx < 0) throw new Error("GFS answered without a time axis");
      return { lat: lats[c], lon: lons[c], ground: groundAt(lats[c], lons[c]), levels: readColumn(loc, idx, levels), time: loc.hourly.time[idx] };
    });
    const frame = localFrame((box.north + box.south) / 2, signedLon((box.east + box.west) / 2));
    const grid = buildAtmosphereGrid(columns, n, n, { exaggerate, frame });
    const when = columns[0].time;
    const stamp = String(when).replace(/[^0-9]/g, "").slice(0, 10);
    const file = gridFile(grid, `atmosphere_${stamp}_${n}x${n}.vtu`, hoursAhead);
    // A .pvd beside it gives the Results reader the hour as the step's time;
    // without one the reader would read the time out of the file NAME.
    const pvd = new File([pvdText([{ time: hoursAhead, file: file.name }])],
      file.name.replace(/\.vtu$/, ".pvd"), { type: "application/xml" });
    const saved = await fileIntoProject(file);
    if (saved) await fileIntoProject(pvd);
    const results = window.GeoIDGalesResults;
    if (!results?.openFolder) throw new Error("the Model page's Results reader is not loaded");
    window.GeoIDModeManager?.setMode?.("model");
    await results.openFolder([pvd, file]);
    // Open on temperature: what a reader of the air looks for first.
    const S = results.state;
    const t = S?.fields?.findIndex((f) => f.ok && /(^|\/)temperature_C$/.test(f.field)) ?? -1;
    if (t >= 0) {
      S.field = t;
      S.step = S.fields[t].steps.length - 1;
      S.component = "";
      results.renderControls?.();
      await results.refresh?.();
    }
    const layers = Object.entries(grid.counts).map(([k, c]) => `${LAYER_NAMES[k]} ${c}`).join(", ");
    const tropo = grid.tropopause
      ? ` Tropopause ${(grid.tropopause.min / 1000).toFixed(1)}–${(grid.tropopause.max / 1000).toFixed(1)} km.`
      : "";
    say(`${n}×${n} columns × ${grid.nz} levels at ${when} UTC, heights ×${exaggerate}. `
      + `Cells by layer: ${layers}.${tropo}${saved ? ` Filed as ${saved}.` : ""}`);
  } catch (error) {
    say(`Could not build the model: ${error.message}`);
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}

function buildCard() {
  const host = byId("atmosphere-weather-host");
  if (!host || byId("atmosphere-model-card")) return Boolean(host);
  const card = document.createElement("details");
  card.className = "gis-tool-section";
  card.id = "atmosphere-model-card";
  card.innerHTML = `
    <summary>3D atmosphere model</summary>
    <div class="gis-tool-body">
      <p class="tool-copy">GFS's own pressure levels over an area, built into a 3D grid
        and opened in the Model page — slices, isosurfaces, layers and wind stream lines.</p>
      <label class="row"><span>Extent</span>
        <select id="atmosphere-extent" class="input">
          <option value="view" selected>A box about the middle of the view</option>
          <option value="drawn">An area drawn by hand</option>
        </select>
      </label>
      <div class="row" id="atmosphere-width-row"><label for="atmosphere-width">Width (km)</label>
        <input id="atmosphere-width" class="input" type="number" min="20" max="2000" step="10" value="300"></div>
      <label class="row"><span>Columns</span>
        <select id="atmosphere-lattice" class="input">
          <option value="6">6 × 6</option><option value="8" selected>8 × 8</option>
          <option value="10">10 × 10</option><option value="12">12 × 12</option>
        </select>
      </label>
      <label class="row"><span>Up to</span>
        <select id="atmosphere-top" class="input">
          <option value="300">300 hPa — the troposphere</option>
          <option value="100" selected>100 hPa — past the tropopause</option>
          <option value="10">10 hPa — into the stratosphere</option>
        </select>
      </label>
      <label class="row"><span>Hour</span>
        <select id="atmosphere-time" class="input">
          <option value="0" selected>Now</option><option value="6">+6 h</option>
          <option value="12">+12 h</option><option value="24">+24 h</option><option value="48">+48 h</option>
        </select>
      </label>
      <label class="row"><span>Heights</span>
        <select id="atmosphere-exaggerate" class="input">
          <option value="1">true scale</option><option value="5" selected>×5</option><option value="10">×10</option>
        </select>
      </label>
      <div class="gis-btn-row"><button id="atmosphere-build" class="button primary" type="button">Build and open in the Model page</button></div>
      <div id="atmosphere-model-status" class="gis-metric">GFS, ~13 km, every hour; the height of each level is its own.</div>
    </div>`;
  host.appendChild(card);
  const select = byId("atmosphere-extent");
  const sync = () => {
    refreshPolygonOptions(select, "view", { allLayers: true });
    byId("atmosphere-width-row").hidden = select.value !== "view";
  };
  sync();
  window.GeoIDImportManager?.onChange?.(sync);
  select.addEventListener("change", () => { byId("atmosphere-width-row").hidden = select.value !== "view"; });
  byId("atmosphere-build").addEventListener("click", () => buildModel());
  return true;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  let tries = 0;
  const attempt = () => {
    if (buildCard() || (tries += 1) > 60) return;
    setTimeout(attempt, 500);
  };
  attempt();
  window.GeoIDAtmosphereModel = { build: buildModel };
}
