/**
 * Earth Engine, live, from the browser — no second process.
 *
 * Earth Engine's REST API takes an OAuth bearer token. The browser flow that
 * mints one needs only a Client ID, which is public by design, so the whole
 * path fits in a page: sign in, ask for a computed image, drape its tiles.
 *
 * Four pieces, and the first three are pure so they can be tested without a
 * Google account:
 *
 *   1. the request bodies — what GFS image a window of time means
 *   2. the tile template EE returns, turned into an XYZ url
 *   3. the frame list for a date range
 *   4. the calls themselves, which need a token and are the only impure part
 *
 * GFS is `NOAA/GFS0P25`, forecast runs on a 0.25° grid. Its precipitation band
 * is `total_precipitation_surface`, which is CUMULATIVE within a run — so a
 * step's rainfall is a difference between two forecast hours, not the band
 * read directly, and getting that wrong makes every map monotonic.
 */

const EE = "https://earthengine.googleapis.com/v1";
const SCOPE = "https://www.googleapis.com/auth/earthengine.readonly";
const GSI = "https://accounts.google.com/gsi/client";

/* ── 1. what to ask for ─────────────────────────────────────────────────── */

/** The ISO instants bounding one step of the forecast. */
export function frames(startIso, { hours = 384, stepHours = 3 } = {}) {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return [];
  const out = [];
  for (let h = 0; h < hours; h += stepHours) {
    out.push({
      index: out.length,
      from: new Date(start + h * 3600e3).toISOString(),
      to: new Date(start + (h + stepHours) * 3600e3).toISOString(),
      hours: stepHours,
    });
  }
  return out;
}

/**
 * The expression for one step's rainfall.
 *
 * `total_precipitation_surface` accumulates through a run, so the rain that
 * fell in a window is the last value minus the first. Taking the band as-is
 * gives a surface that only ever grows — a map that can never dry out, which
 * looks like a broken model rather than a wrong reading.
 */
export function stepImageBody(frame, bounds, { collection = "NOAA/GFS0P25" } = {}) {
  const region = {
    type: "Polygon",
    coordinates: [[
      [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
      [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY], [bounds.minX, bounds.minY],
    ]],
  };
  return {
    expression: {
      // A named expression rather than a serialised graph: EE accepts an
      // "expression" object and this keeps the request readable in a network
      // log, which matters when the failure mode is a 400 with no detail.
      collection,
      band: "total_precipitation_surface",
      reducer: "difference",
      window: { start: frame.from, end: frame.to },
      region,
    },
    fileFormat: "GEO_TIFF",
    grid: { dimensions: { width: 128, height: 128 } },
  };
}

/* ── 2. tiles ───────────────────────────────────────────────────────────── */

/** EE returns a map NAME; the tiles hang off it in XYZ order. */
export function tileTemplate(mapName) {
  if (!mapName) return null;
  return `${EE}/${mapName}/tiles/{z}/{x}/{y}`;
}

/** Visualisation for rainfall, in the units GFS reports (kg/m² ≈ mm). */
export function rainVis({ maxMm = 10 } = {}) {
  return {
    bands: ["total_precipitation_surface"],
    min: 0,
    max: maxMm,
    palette: ["000000", "1f4b99", "3d8fd1", "7ecfa4", "f4e04d", "e8712f", "c1272d"],
  };
}

/* ── 3. reading a returned grid ─────────────────────────────────────────── */

/**
 * Rainfall at a coordinate, from a grid EE returned for a bounds box.
 *
 * Nearest cell rather than interpolated: GFS is a 0.25° model and pretending
 * to sub-cell precision would be inventing weather.
 */
export function sampleGrid(grid, bounds, lat, lon) {
  if (!grid?.values || !grid.width || !grid.height) return null;
  if (lat < bounds.minY || lat > bounds.maxY || lon < bounds.minX || lon > bounds.maxX) return null;
  const x = Math.min(grid.width - 1, Math.max(0, Math.floor(
    ((lon - bounds.minX) / (bounds.maxX - bounds.minX)) * grid.width)));
  const y = Math.min(grid.height - 1, Math.max(0, Math.floor(
    ((bounds.maxY - lat) / (bounds.maxY - bounds.minY)) * grid.height)));
  const v = grid.values[y * grid.width + x];
  return Number.isFinite(v) ? v : null;
}

/* ── 4. the impure half ─────────────────────────────────────────────────── */

let tokenValue = null;
let tokenExpires = 0;

export function settings() {
  try {
    return JSON.parse(window.localStorage.getItem("geoid:earth-engine") || "null")
      || { clientId: "", project: "" };
  } catch (error) {
    return { clientId: "", project: "" };
  }
}

function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI}"]`);
    if (existing) { existing.addEventListener("load", () => resolve()); return; }
    const tag = document.createElement("script");
    tag.src = GSI;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error("Google's sign-in script could not be loaded"));
    document.head.appendChild(tag);
  });
}

/**
 * A token, asking the user to sign in if there is not a live one.
 *
 * Held in memory and never written anywhere: it expires in an hour, and a
 * token in storage is a credential in storage.
 */
export async function token({ interactive = true } = {}) {
  if (tokenValue && Date.now() < tokenExpires - 60e3) return tokenValue;
  const { clientId } = settings();
  if (!clientId) throw new Error("no Client ID — set one in Settings");
  await loadGsi();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt: interactive ? "" : "none",
      callback: (response) => {
        if (!response?.access_token) {
          reject(new Error(response?.error || "sign-in did not return a token"));
          return;
        }
        tokenValue = response.access_token;
        tokenExpires = Date.now() + (Number(response.expires_in) || 3600) * 1000;
        resolve(tokenValue);
      },
      error_callback: (error) => reject(new Error(error?.message || "sign-in was dismissed")),
    });
    client.requestAccessToken();
  });
}

async function post(path, body) {
  const { project } = settings();
  if (!project) throw new Error("no Earth Engine project — set one in Settings");
  const bearer = await token();
  const response = await fetch(`${EE}/projects/${project}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // EE's errors are the useful part of a failed run; carry them out whole.
    const detail = await response.text().catch(() => "");
    throw new Error(`Earth Engine answered ${response.status}: ${detail.slice(0, 200)}`);
  }
  return response;
}

/** One step's rainfall as a grid of numbers over the bounds. */
export async function fetchStepGrid(frame, bounds, options = {}) {
  const response = await post("/image:computePixels", stepImageBody(frame, bounds, options));
  const buffer = await response.arrayBuffer();
  const { loadGeoTiffFromArrayBuffer } = await import(`./geotiff-adapter.js${new URL(import.meta.url).search}`);
  const layer = await loadGeoTiffFromArrayBuffer(buffer, { name: `GFS ${frame.from}` });
  const raster = layer?.raster;
  if (!raster?.band) throw new Error("Earth Engine returned no readable pixels");
  return { width: raster.width, height: raster.height, values: raster.band, bounds: raster.bounds };
}

/** A tile template for the same step, for drawing rather than reading. */
export async function fetchStepTiles(frame, bounds, options = {}) {
  const response = await post("/maps", {
    ...stepImageBody(frame, bounds, options),
    visualizationOptions: rainVis(options),
  });
  const body = await response.json();
  return tileTemplate(body?.name);
}

/**
 * One frame, on the globe.
 *
 * Deliberately the smallest thing that proves the whole chain — sign-in,
 * request, decode, drape — because every part of this session that went wrong
 * went wrong by assembling six links and testing none of them.
 */
export async function showOneFrame() {
  const status = document.getElementById("gee-gfs-status");
  const say = (t) => { if (status) status.textContent = t; };
  const view = window.GeoIDViewer;
  const geometry = view?.getExtractionGeometry?.("study");
  const bounds = geometry ? boundsOf(geometry) : null;
  if (!bounds) { say("Draw a study area first — Earth Engine is asked for a box, not the world."); return; }
  try {
    say("Signing in…");
    await token();
    const frame = frames(new Date().toISOString(), { hours: 3, stepHours: 3 })[0];
    say(`Asking Earth Engine for GFS ${frame.from}…`);
    const grid = await fetchStepGrid(frame, bounds);
    const stamp = new URL(import.meta.url).search;
    const { buildRasterLayer } = await import(`./geotiff-adapter.js${stamp}`);
    const built = buildRasterLayer([grid.values], grid.width, grid.height, bounds,
      { name: `GFS rain ${frame.from.slice(0, 16)}`, isDem: false });
    const layer = window.GeoIDImportManager?.addDerivedLayer?.(
      `GFS rain ${frame.from.slice(0, 16)}`, built, "gfs");
    let peak = 0;
    grid.values.forEach((v) => { if (Number.isFinite(v) && v > peak) peak = v; });
    say(layer
      ? `GFS ${frame.from.slice(0, 16)} on the globe — peak ${peak.toFixed(1)} mm in this 3-hour step.`
      : "Earth Engine answered, but the layer could not be drawn.");
  } catch (error) {
    say(error.message);
  }
}

function boundsOf(geometry) {
  const vs = geometry?.vertices || [];
  if (!vs.length) return null;
  const lons = vs.map((v) => (v.lon > 180 ? v.lon - 360 : v.lon));
  const lats = vs.map((v) => v.lat);
  return {
    minX: Math.min(...lons), maxX: Math.max(...lons),
    minY: Math.min(...lats), maxY: Math.max(...lats),
  };
}

if (typeof window !== "undefined") {
  // Guarded: the unit run imports this file for the pure half and has no DOM,
  // and an unguarded `document` here takes the whole module down with it.
  if (typeof document !== "undefined") {
    const wire = () => document.getElementById("gee-gfs-fetch")
      ?.addEventListener("click", () => { void showOneFrame(); });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
    else wire();
  }
  window.GeoIDEarthEngine = {
    showOneFrame,
    frames, stepImageBody, tileTemplate, rainVis, sampleGrid,
    settings, token, fetchStepGrid, fetchStepTiles,
  };
}
