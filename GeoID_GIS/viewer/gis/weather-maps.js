/**
 * Live weather maps, fetched by EXTENT: the most recent radar composite or
 * GFS-derived surface field over a box the user defines — the drawn study
 * area, or typed coordinate bounds.
 *
 * This is the browser-feasible core of what the Hetzner fetch scripts did
 * continuously: NOMADS GRIB is not CORS-reachable from a page and never
 * will be, but two services answer browsers directly and are enough for
 * "fetch the most recent map here":
 *
 * - **RainViewer** — the global radar composite as PNG tiles, frames every
 *   ten minutes, `weather-maps.json` naming the newest one. CORS `*`,
 *   measured. The tiles are Web Mercator, so the composite is row-resampled
 *   to equirectangular before draping — the sphere's UVs are linear in
 *   latitude, and an unresampled Mercator canvas slides every echo
 *   poleward (the basemap's own documented trap).
 * - **Open-Meteo** — GFS/ICON-blend surface fields sampled on a grid of
 *   points (multi-location in one call, CORS `*`, measured), rendered
 *   through a ramp and draped with a real legend. Coarse by construction —
 *   a 16×16 grid — and honest about it in the layer's summary.
 *
 * A relay on the Hetzner box (the scripts' old home) slots in as another
 * SOURCES entry serving pre-fetched GRIB renders with CORS headers; the
 * registry is the seam, and nothing else here would change.
 */

import { drape } from "./gee.js?v=20260827-1668938";
import { currentBodyId } from "./bodies.js?v=20260827-1668938";
import { rectangleVertices } from "./draw-area.js?v=20260827-1668938";

const byId = (id) => document.getElementById(id);

const RAINVIEWER_MAPS = "https://api.rainviewer.com/public/weather-maps.json";
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const GRID = 16;          // Open-Meteo sample grid per side
const MAX_TILES = 48;     // radar tile budget per fetch
const CANVAS_W = 1024;    // draped canvas width

const SOURCES = {
  radar: {
    label: "Radar composite (RainViewer)",
    kind: "radar",
    citation: "Radar data © RainViewer (rainviewer.com), from national weather radar networks",
  },
  precip: {
    /**
     * A 24-hour ACCUMULATION, not the instantaneous rate: "current
     * precipitation" is the preceding hour, which over any dry box is
     * legitimately zero everywhere — fetched once, it drew an honest but
     * useless 0–0 mm map and read as a failed fetch. A day's total is a
     * real map almost everywhere.
     */
    label: "Precipitation · last 24 h (Open-Meteo · GFS/ICON)",
    kind: "grid",
    variable: "precipitation",
    hourlySum: 24,
    unit: "mm",
    ramp: [[240, 249, 255], [116, 169, 207], [5, 112, 176], [3, 50, 97], [255, 210, 60]],
    citation: "Open-Meteo (open-meteo.com, CC BY 4.0) — NOAA GFS / DWD ICON blend",
  },
  temp: {
    label: "2 m temperature (Open-Meteo · GFS/ICON)",
    kind: "grid",
    variable: "temperature_2m",
    unit: "°C",
    ramp: [[40, 60, 150], [90, 160, 210], [230, 230, 160], [235, 130, 60], [180, 30, 40]],
    citation: "Open-Meteo (open-meteo.com, CC BY 4.0) — NOAA GFS / DWD ICON blend",
  },
  wind: {
    label: "10 m wind speed (Open-Meteo · GFS/ICON)",
    kind: "grid",
    variable: "wind_speed_10m",
    unit: "km/h",
    ramp: [[235, 245, 250], [140, 200, 220], [60, 140, 190], [120, 80, 170], [200, 40, 120]],
    citation: "Open-Meteo (open-meteo.com, CC BY 4.0) — NOAA GFS / DWD ICON blend",
  },
};

function say(message) {
  const node = byId("weather-maps-status");
  if (node) node.textContent = message || "";
}

const signedLon = (lon) => ((lon + 540) % 360) - 180;

/** The chosen extent as {west, south, east, north} in signed degrees, or null. */
function chosenBounds() {
  const mode = byId("weather-extent")?.value || "box";
  if (mode === "box") {
    // A box already on the globe — dragged, resized, or just drawn — is the
    // truth; the inputs are how one is created or replaced.
    const drawn = window.GeoIDViewer?.getExtractionGeometry?.();
    if (drawn?.vertices?.length && !chosenBounds.forceRebuild) {
      const lats = drawn.vertices.map((v) => v.lat);
      const lons = drawn.vertices.map((v) => signedLon(v.lon));
      return {
        west: Math.min(...lons), south: Math.min(...lats),
        east: Math.max(...lons), north: Math.max(...lats),
      };
    }
    chosenBounds.forceRebuild = false;
    /**
     * The clean path: a box DEFINED here — size in km, centred on the view
     * or on typed coordinates — built by the same `rectangleVertices` the
     * Draw tool's presets use and SHOWN on the globe via the same
     * `setStudyAreaPolygon`, so what will be fetched is visible before the
     * request goes out. No side quest to another tool.
     */
    const widthKm = Number(byId("weather-box-width")?.value) || 500;
    const heightKm = Number(byId("weather-box-height")?.value) || widthKm;
    let centre;
    if (byId("weather-box-centre")?.value === "manual") {
      const lat = Number(byId("weather-box-lat")?.value);
      const lon = Number(byId("weather-box-lon")?.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { error: "Type the centre latitude and longitude (longitude signed, east positive)." };
      }
      centre = { lat, lon };
    } else {
      centre = window.GeoIDViewer?.getViewCentreLatLon?.();
      if (!centre) return { error: "The view centre could not be read — try typed coordinates." };
    }
    const rect = rectangleVertices({
      lat: centre.lat, lon: centre.lon, widthKm, heightKm,
    });
    if (!rect) return { error: "That size did not make a box — check the kilometres." };
    window.GeoIDViewer?.setStudyAreaPolygon?.(rect.vertices);
    hideAreaCard();
    return {
      west: signedLon(rect.bounds.west), south: rect.bounds.south,
      east: signedLon(rect.bounds.east), north: rect.bounds.north,
    };
  }
  if (mode === "bounds") {
    const value = (id) => Number(byId(id)?.value);
    const bounds = {
      west: value("weather-west"), south: value("weather-south"),
      east: value("weather-east"), north: value("weather-north"),
    };
    if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)) {
      return { error: "Type all four bounds, in degrees (west and south negative)." };
    }
    if (bounds.east <= bounds.west || bounds.north <= bounds.south) {
      return { error: "East must exceed west and north exceed south." };
    }
    return bounds;
  }
  const area = window.GeoIDViewer?.getExtractionGeometry?.();
  const vertices = area?.vertices;
  if (!vertices?.length) {
    promptDrawTool();
    return { error: "Draw the box on the globe, then press Fetch — the Draw tool is now active." };
  }
  const lats = vertices.map((v) => v.lat);
  const lons = vertices.map((v) => signedLon(v.lon));
  return {
    west: Math.min(...lons), south: Math.min(...lats),
    east: Math.max(...lons), north: Math.max(...lats),
  };
}

/* ── Mercator helpers, for the radar tiles ──────────────────────────────── */

const mercY = (lat) => {
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
};

function tileRange(bounds, zoom) {
  const n = 2 ** zoom;
  return {
    x0: Math.floor(((bounds.west + 180) / 360) * n),
    x1: Math.floor(((bounds.east + 180) / 360) * n),
    y0: Math.floor(mercY(bounds.north) * n),
    y1: Math.floor(mercY(bounds.south) * n),
  };
}

/** The finest zoom whose tile count over the box stays inside the budget. */
function zoomFor(bounds) {
  // 7 is RainViewer's LAST REAL zoom: measured, every tile from 8 up is one
  // identical "zoom not supported" placeholder whatever the ground below.
  for (let zoom = 7; zoom >= 2; zoom -= 1) {
    const r = tileRange(bounds, zoom);
    const count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    if (count <= MAX_TILES) return zoom;
  }
  return 2;
}

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("a tile could not be loaded"));
  img.src = url;
});

/**
 * Fetch the newest radar frame's tiles over the box, composite them in
 * Mercator, then RESAMPLE row by row to equirectangular for the drape.
 */
async function radarCanvas(bounds) {
  const maps = await (await fetch(RAINVIEWER_MAPS)).json();
  const frame = maps.radar?.past?.at(-1);
  if (!frame) throw new Error("RainViewer listed no radar frames");
  const zoom = zoomFor(bounds);
  const n = 2 ** zoom;
  const r = tileRange(bounds, zoom);
  const merc = document.createElement("canvas");
  merc.width = (r.x1 - r.x0 + 1) * 256;
  merc.height = (r.y1 - r.y0 + 1) * 256;
  const mctx = merc.getContext("2d");
  const jobs = [];
  for (let x = r.x0; x <= r.x1; x += 1) {
    for (let y = r.y0; y <= r.y1; y += 1) {
      // colour scheme 2 (universal blue), smoothed, snow shown.
      const url = `${maps.host}${frame.path}/256/${zoom}/${((x % n) + n) % n}/${y}/2/1_1.png`;
      jobs.push(loadImage(url)
        .then((img) => mctx.drawImage(img, (x - r.x0) * 256, (y - r.y0) * 256))
        .catch(() => {})); // an empty tile must not sink the map
    }
  }
  await Promise.all(jobs);
  // Crop offsets of the box inside the tile grid, in Mercator pixels.
  const px = (lon) => (((lon + 180) / 360) * n - r.x0) * 256;
  const py = (lat) => (mercY(lat) * n - r.y0) * 256;
  const sx = px(bounds.west);
  const sw = px(bounds.east) - sx;
  // Row-resample to linear latitude: each output row samples the Mercator
  // row its latitude actually lives on.
  const out = document.createElement("canvas");
  out.width = CANVAS_W;
  out.height = Math.max(64, Math.round(
    CANVAS_W * ((bounds.north - bounds.south)
      / Math.max(1e-6, bounds.east - bounds.west)),
  ));
  const octx = out.getContext("2d");
  for (let row = 0; row < out.height; row += 1) {
    const lat = bounds.north - ((row + 0.5) / out.height) * (bounds.north - bounds.south);
    octx.drawImage(merc, sx, py(lat) - 0.5, sw, 1, 0, row, out.width, 1);
  }
  // A dry box composites to a fully transparent canvas, which drapes as
  // nothing and reads as a failed fetch. Count the ink and say so instead.
  const sample = octx.getImageData(0, 0, out.width, out.height).data;
  let inked = 0;
  for (let i = 3; i < sample.length; i += 4) if (sample[i] > 8) inked += 1;
  return { canvas: out, time: new Date(frame.time * 1000), empty: inked === 0 };
}

/* ── Open-Meteo grid fields ─────────────────────────────────────────────── */

async function gridCanvas(bounds, source) {
  const lats = [];
  const lons = [];
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      lats.push((bounds.south + ((j + 0.5) / GRID) * (bounds.north - bounds.south)).toFixed(3));
      lons.push((bounds.west + ((i + 0.5) / GRID) * (bounds.east - bounds.west)).toFixed(3));
    }
  }
  const query = source.hourlySum
    ? `&hourly=${source.variable}&past_hours=${source.hourlySum}&forecast_hours=0`
    : `&current=${source.variable}`;
  const url = `${OPEN_METEO}?latitude=${lats.join(",")}&longitude=${lons.join(",")}`
    + `${query}&wind_speed_unit=kmh`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
  const payload = await response.json();
  const cells = Array.isArray(payload) ? payload : [payload];
  const values = cells.map((cell) => {
    if (!source.hourlySum) return cell?.current?.[source.variable];
    const hours = cell?.hourly?.[source.variable];
    if (!Array.isArray(hours)) return undefined;
    const finiteHours = hours.filter((v) => Number.isFinite(v));
    return finiteHours.length ? finiteHours.reduce((a, b) => a + b, 0) : undefined;
  });
  if (!values.some((v) => Number.isFinite(v))) throw new Error("no values in the answer");
  const finite = values.filter((v) => Number.isFinite(v));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const ramp = source.ramp;
  const colourOf = (v) => {
    const t = Math.max(0, Math.min(1, (v - min) / span)) * (ramp.length - 1);
    const k = Math.min(ramp.length - 2, Math.floor(t));
    const f = t - k;
    return [0, 1, 2].map((c) => Math.round(ramp[k][c] + (ramp[k + 1][c] - ramp[k][c]) * f));
  };
  // The grid drawn at its own resolution and let the GPU's linear sampling
  // smooth it: a 16x16 field IS coarse, and pretending otherwise would be
  // the interpolated-WSM mistake wearing weather colours.
  const out = document.createElement("canvas");
  out.width = GRID;
  out.height = GRID;
  const ctx = out.getContext("2d");
  const image = ctx.createImageData(GRID, GRID);
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const v = values[j * GRID + i];
      const at = ((GRID - 1 - j) * GRID + i) * 4;   // canvas rows run north-first
      if (Number.isFinite(v)) {
        const [rr, gg, bb] = colourOf(v);
        image.data[at] = rr; image.data[at + 1] = gg; image.data[at + 2] = bb;
        image.data[at + 3] = 195;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  const bandValues = values.map((v) => (Number.isFinite(v) ? v : NaN));
  const time = source.hourlySum
    ? cells.find((c) => c?.hourly?.time?.length)?.hourly?.time?.at(-1)
    : cells.find((c) => c?.current?.time)?.current?.time;
  return {
    canvas: out, min, max,
    values: bandValues,
    flatZero: min === 0 && max === 0,
    time: time ? new Date(time) : new Date(),
    palette: ramp.map((c) => c.map((v) => v.toString(16).padStart(2, "0")).join("")),
  };
}

/**
 * The study-area STATS card is furniture from the analysis flow; while the
 * weather card owns the box it covers the very corner the fetch reports
 * into, so it stands down. A hand-drawn area keeps it.
 */
function hideAreaCard() {
  const card = document.getElementById("measurement-result-card");
  if (card) card.hidden = true;
}

/**
 * Raise the square-polygon drawer: the tool rail's own Draw button, which
 * activates area mode and opens the draw card with its box preset — the
 * same press a hand on the rail would make, so there is one drawer and one
 * way it is armed.
 */
function promptDrawTool() {
  const button = byId("tool-rail-area");
  if (button && !button.classList.contains("is-active")) button.click();
}

/* ── Fetch, drape, register ─────────────────────────────────────────────── */

let busy = false;

async function fetchMap() {
  if (busy) return;
  const sourceId = byId("weather-source")?.value || "radar";
  const source = SOURCES[sourceId];
  const bounds = chosenBounds();
  if (bounds?.error) { say(bounds.error); return; }
  if ((bounds.east - bounds.west) < 0.2 || (bounds.north - bounds.south) < 0.2) {
    say("That box is under 0.2° across — draw or type something larger.");
    return;
  }
  busy = true;
  const button = byId("weather-fetch");
  if (button) button.disabled = true;
  try {
    say(`Fetching the most recent ${source.label}…`);
    const result = source.kind === "radar"
      ? await radarCanvas(bounds)
      : await gridCanvas(bounds, source);
    if (result.flatZero) {
      say(`${source.label}: zero everywhere in this box — nothing to map. `
        + "(The fetch worked; the field is genuinely flat here.)");
      return;
    }
    if (result.empty) {
      say("No radar echoes in this box right now — the frame is dry here. "
        + "(The fetch worked; there is simply nothing to draw.)");
      return;
    }
    const stampText = `${String(result.time.getUTCHours()).padStart(2, "0")}:`
      + `${String(result.time.getUTCMinutes()).padStart(2, "0")} UTC`;
    const name = `${source.label} · ${stampText}`;
    // A re-fetch REPLACES: two radar frames stacked is a smear, not a map.
    (window.GeoIDImportManager?.getLayers?.() || [])
      .filter((layer) => layer.weatherSource === sourceId)
      .forEach((layer) => window.GeoIDImportManager.removeLayer(layer.id));
    const object3D = await drape(result.canvas.toDataURL("image/png"), bounds, { segments: 72 });
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(name, {
      object3D, bounds, georeferenced: true,
    }, "tiles");
    if (!layer) throw new Error("the layer could not be registered");
    object3D.userData.geoidLayer = true;
    window.GeoIDViewer?.globe?.add?.(object3D);
    layer.weatherSource = sourceId;
    layer.metadata = {
      source: source.citation,
      importedAt: new Date().toISOString(),
      frame: result.time.toISOString(),
      extent: `${bounds.west.toFixed(2)}–${bounds.east.toFixed(2)}°E, `
        + `${bounds.south.toFixed(2)}–${bounds.north.toFixed(2)}°N`,
    };
    if (source.kind === "grid") {
      layer.legendInfo = {
        label: source.label, min: result.min, max: result.max,
        unit: source.unit, palette: result.palette,
      };
      layer.info = {
        source: source.citation,
        summary: `${GRID}×${GRID} sample grid over the box — coarse by construction.`,
      };
      /**
       * The SYMBOLOGY contract, so the layer box's drawer offers the editor:
       * `raster.band` is what the dialog classes, and `repaint` re-inks the
       * SAME canvas the drape is showing — the texture's image is pointed at
       * it once and re-uploaded per repaint, so recolouring never rebuilds
       * the mesh. fn(value) → [r,g,b] is the raster contract; null leaves
       * the cell transparent.
       */
      const values = result.values;
      const canvas = result.canvas;
      layer.raster = { band: values, noData: null };
      layer.repaint = (colourOf) => {
        const ctx = canvas.getContext("2d");
        const image = ctx.createImageData(GRID, GRID);
        for (let j = 0; j < GRID; j += 1) {
          for (let i = 0; i < GRID; i += 1) {
            const value = values[j * GRID + i];
            if (!Number.isFinite(value)) continue;
            const colour = colourOf(value);
            if (!colour) continue;
            const at = ((GRID - 1 - j) * GRID + i) * 4;
            [image.data[at], image.data[at + 1], image.data[at + 2]] = colour;
            image.data[at + 3] = 195;
          }
        }
        ctx.putImageData(image, 0, 0);
        let painted = false;
        object3D.traverse((node) => {
          const material = node.material;
          if (material?.map) {
            material.map.image = canvas;
            material.map.needsUpdate = true;
            painted = true;
          }
        });
        return painted;
      };
    } else {
      layer.info = { source: source.citation, summary: "Most recent composite frame." };
    }
    window.GeoIDLayerHierarchy?.setOpacity?.(layer, 0.85);
    window.GeoIDLayerHierarchy?.render?.();
    say(`${name} on the globe. ${source.citation}.`);
  } catch (error) {
    say(`Could not fetch: ${error.message}`);
  } finally {
    busy = false;
    if (button) button.disabled = false;
  }
}

/* ── The card, built here rather than in the shared markup: this is an
      Earth capability, and the Atmosphere section's markup is shared with
      nine planets that have no weather radar. ── */

function buildCard() {
  const groupBody = document.querySelector("#gis-group-modelled > .section-body");
  if (!groupBody || byId("weather-maps-card")) return false;
  const card = document.createElement("details");
  card.className = "gis-tool-section";
  card.id = "weather-maps-card";
  card.innerHTML = `
    <summary>Live weather maps</summary>
    <div class="gis-tool-body">
      <p class="tool-copy">The most recent map over an extent you choose —
        the drawn study area, or typed bounds.</p>
      <label class="row"><span>Source</span>
        <select id="weather-source" class="input">
          ${Object.entries(SOURCES).map(([id, s]) => `<option value="${id}">${s.label}</option>`).join("")}
        </select>
      </label>
      <label class="row"><span>Extent</span>
        <select id="weather-extent" class="input">
          <option value="box" selected>Box — size and centre</option>
          <option value="drawn">An area drawn by hand</option>
          <option value="bounds">Typed bounds</option>
        </select>
      </label>
      <div id="weather-box-rows">
        <div class="row"><label for="weather-box-width">Width (km)</label><input id="weather-box-width" class="input" type="number" min="20" step="10" value="500"></div>
        <div class="row"><label for="weather-box-height">Height (km)</label><input id="weather-box-height" class="input" type="number" min="20" step="10" value="500"></div>
        <label class="row"><span>Centre</span>
          <select id="weather-box-centre" class="input">
            <option value="view" selected>The middle of the view</option>
            <option value="manual">Typed coordinates</option>
          </select>
        </label>
        <div class="row" id="weather-box-manual" hidden>
          <input id="weather-box-lat" class="input" type="number" step="0.01" placeholder="lat" aria-label="Centre latitude">
          <input id="weather-box-lon" class="input" type="number" step="0.01" placeholder="lon (±)" aria-label="Centre longitude, signed">
        </div>
      </div>
      <div id="weather-bounds-rows" hidden>
        <div class="row"><label for="weather-north">North</label><input id="weather-north" class="input" type="number" step="0.1" placeholder="55"></div>
        <div class="row"><label for="weather-south">South</label><input id="weather-south" class="input" type="number" step="0.1" placeholder="49"></div>
        <div class="row"><label for="weather-west">West</label><input id="weather-west" class="input" type="number" step="0.1" placeholder="-11"></div>
        <div class="row"><label for="weather-east">East</label><input id="weather-east" class="input" type="number" step="0.1" placeholder="2"></div>
      </div>
      <div class="gis-btn-row">
        <button id="weather-fetch" class="button primary" type="button">Fetch most recent</button>
      </div>
      <div id="weather-maps-status" class="gis-metric">Radar frames are ~10 minutes apart; forecast fields refresh hourly.</div>
    </div>`;
  groupBody.insertBefore(card, groupBody.firstElementChild?.nextElementSibling || null);
  byId("weather-extent").addEventListener("change", () => {
    const mode = byId("weather-extent").value;
    byId("weather-bounds-rows").hidden = mode !== "bounds";
    byId("weather-box-rows").hidden = mode !== "box";
    // Choosing "an area drawn by hand" with nothing drawn is a dead end
    // unless the drawer comes to you: the Draw tool activates itself.
    if (mode === "drawn" && !window.GeoIDViewer?.getExtractionGeometry?.()?.vertices?.length) {
      promptDrawTool();
      say("Draw the shape on the globe — the Draw tool is active — then press Fetch.");
    }
  });
  byId("weather-box-centre").addEventListener("change", () => {
    byId("weather-box-manual").hidden = byId("weather-box-centre").value !== "manual";
  });
  // Changing a size or centre REDRAWS the box at once — the input is the
  // control, the polygon on the globe is the state, and Fetch reads the
  // polygon (so a corner-dragged box is fetched as dragged).
  ["weather-box-width", "weather-box-height", "weather-box-centre",
    "weather-box-lat", "weather-box-lon"].forEach((id) => {
    byId(id)?.addEventListener("change", () => {
      if (byId("weather-extent").value !== "box") return;
      chosenBounds.forceRebuild = true;
      const bounds = chosenBounds();
      if (bounds?.error) say(bounds.error);
      else say("Box drawn — drag its corners to resize, its edges to move, then Fetch.");
    });
  });
  // A corner drag reports the new size back into the inputs.
  document.addEventListener("geoid-study-area-edited", () => {
    if (byId("weather-extent")?.value === "box") hideAreaCard();
    const drawn = window.GeoIDViewer?.getExtractionGeometry?.();
    if (!drawn?.vertices?.length) return;
    const lats = drawn.vertices.map((v) => v.lat);
    const lons = drawn.vertices.map((v) => v.lon);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const heightKm = (Math.max(...lats) - Math.min(...lats)) * 111.32;
    const widthKm = (Math.max(...lons) - Math.min(...lons)) * 111.32
      * Math.cos((midLat * Math.PI) / 180);
    if (byId("weather-box-width")) byId("weather-box-width").value = Math.round(widthKm);
    if (byId("weather-box-height")) byId("weather-box-height").value = Math.round(heightKm);
  });
  byId("weather-fetch").addEventListener("click", fetchMap);
  return true;
}

function init() {
  if (currentBodyId?.() && currentBodyId() !== "earth") return;
  let tries = 0;
  const attempt = () => {
    if (buildCard()) return;
    if ((tries += 1) < 40) setTimeout(attempt, 400);
  };
  attempt();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
