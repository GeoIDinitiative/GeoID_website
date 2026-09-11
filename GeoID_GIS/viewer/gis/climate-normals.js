/**
 * THE MEAN CLIMATE UNDER THE CURSOR, from a reanalysis rather than a formula.
 *
 * The TEMP and PRESSURE readouts were arithmetic on the ground's height and
 * nothing else: 27 − 40·sin²(latitude) minus a lapse rate, and a barometric
 * curve off 101,325 Pa. That makes every place at one latitude and height the
 * same place — London and Kamchatka read alike, the Sahara and the Atlantic at
 * its latitude read alike — and over the open ocean it read the lapse rate from
 * the SEABED, so a cursor over deep tropical sea said about +50 °C.
 *
 * This reads NASA POWER's MERRA-2 climatology (2001-2020 annual means, baked by
 * `services/bake-climate.py`) on MERRA-2's own 0.5 × 0.625° grid, and then
 * DOWNSCALES it to the ground under the cursor, because 55 km is a long way in
 * mountains:
 *
 *   T(z) = T_cell − Γ · (z − z_cell)                       Γ = 6.5 K/km
 *   p(z) = p_cell · exp( −g (z − z_cell) / (R_d · T̄) )     T̄ the layer's mean
 *
 * `z_cell` is the grid cell's OWN surface height, which the bake carries for
 * exactly this: a cell's mean describes the cell's mean height, and a summit
 * inside it is colder by the height it stands above that, not above sea level.
 *
 * AT SEA THE SURFACE IS THE SEA. The streamed DEM answers with the seabed over
 * the ocean, so a negative height is read as the sea surface (z = 0) unless the
 * cell around it stands well above sea level — which is what a depression is:
 * the Dead Sea (−430 m) sits in a cell hundreds of metres up and keeps its own
 * height, while the Caspian (−28 m) sits in a cell at its own level and is
 * treated as water, which costs 0.2 °C.
 */

import { dataUrl } from "./data-base.js?v=20260911-562dd6c";

/** The environmental lapse rate, K per metre — the ICAO standard atmosphere's. */
export const LAPSE = 0.0065;
const G = 9.80665;
const RD = 287.05;

/** Above this, a cell is land; a negative DEM height inside it is a depression. */
const DEPRESSION_CELL_M = 50;
/** Below this a negative height is ocean whatever the cell says. */
const DEEPEST_DEPRESSION_M = -500;

export const SOURCE = "NASA POWER (MERRA-2), 2001–2020 mean";
export const CITATION = "These data were obtained from the NASA Langley Research "
  + "Center (LaRC) POWER Project funded through the NASA Earth Science/Applied "
  + "Science Program. MERRA-2: Gelaro et al. (2017), J. Climate 30: 5419-5454.";

/**
 * Decode the baked payload into typed arrays. Rows run SOUTH to NORTH, as the
 * bake says in `grid.rows`; a null (a cell the service left empty) becomes NaN.
 */
export function decodeNormals(payload) {
  const { grid } = payload;
  const size = grid.width * grid.height;
  const arr = (values, scale) => {
    const out = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      const v = values[i];
      out[i] = v === null || v === undefined ? NaN : v / scale;
    }
    return out;
  };
  return {
    grid,
    period: payload.period,
    tempC: arr(payload.t2m_c10, 10),
    pressurePa: arr(payload.ps_pa, 1),
    elevM: arr(payload.elev_m, 1),
  };
}

/**
 * Bilinear on the grid, longitude WRAPPING (the grid has no seam) and latitude
 * clamped at the poles. Signed or 0–360 longitude alike.
 */
export function bilinear(normals, field, lat, lon) {
  const { grid } = normals;
  const values = normals[field];
  const x = (((lon - grid.west) % 360) + 360) % 360 / grid.dlon;
  const y = Math.min(grid.height - 1, Math.max(0, (lat - grid.south) / grid.dlat));
  const i0 = Math.floor(x) % grid.width;
  const i1 = (i0 + 1) % grid.width;
  const j0 = Math.min(grid.height - 1, Math.floor(y));
  const j1 = Math.min(grid.height - 1, j0 + 1);
  const fx = x - Math.floor(x);
  const fy = y - j0;
  const at = (i, j) => values[(j * grid.width) + i];
  const corners = [
    [at(i0, j0), (1 - fx) * (1 - fy)], [at(i1, j0), fx * (1 - fy)],
    [at(i0, j1), (1 - fx) * fy], [at(i1, j1), fx * fy],
  ];
  // A missing corner is left out and the weights renormalised, so one empty
  // cell does not blank the four around it.
  let sum = 0;
  let weight = 0;
  for (const [v, w] of corners) {
    if (Number.isFinite(v) && w > 0) { sum += v * w; weight += w; }
  }
  return weight > 0 ? sum / weight : NaN;
}

/** The height the climate is being asked about: the sea surface at sea. */
export function surfaceHeight(demM, cellM) {
  if (!Number.isFinite(demM)) return Number.isFinite(cellM) ? Math.max(0, cellM) : 0;
  if (demM >= 0) return demM;
  const depression = demM > DEEPEST_DEPRESSION_M && Number.isFinite(cellM)
    && cellM > DEPRESSION_CELL_M;
  return depression ? demM : 0;
}

/**
 * Carry a cell's mean to another height: the lapse rate for temperature, the
 * hypsometric equation for pressure at the layer's mean temperature.
 */
export function downscale({ tempC, pressurePa, cellM }, z) {
  const dz = z - cellM;
  const t = tempC - (LAPSE * dz);
  const meanK = ((tempC + t) / 2) + 273.15;
  const p = pressurePa * Math.exp(-(G * dz) / (RD * meanK));
  return { tempC: t, pressurePa: p };
}

/** The whole reading at one place, or null where the grid has nothing. */
export function readAt(normals, lat, lon, demM) {
  if (!normals) return null;
  const tempC = bilinear(normals, "tempC", lat, lon);
  const pressurePa = bilinear(normals, "pressurePa", lat, lon);
  const cellM = bilinear(normals, "elevM", lat, lon);
  if (![tempC, pressurePa, cellM].every(Number.isFinite)) return null;
  const z = surfaceHeight(demM, cellM);
  const out = downscale({ tempC, pressurePa, cellM }, z);
  return {
    ...out,
    heightM: z,
    cellM,
    sea: Number.isFinite(demM) && demM < 0 && z === 0,
  };
}

/**
 * The same reading over a whole height grid — what the map draws. ONE function
 * for the map and the readout, so the colour under the cursor and the number
 * beside it are the same calculation at the same height, never two estimates
 * that happen to be close.
 *
 * `band` runs top-down (north first), as a raster band does; `bounds` is in the
 * raster vocabulary (minX/minY/maxX/maxY). A no-data height is read at the
 * cell's own height rather than dropped, so the map has no holes where the DEM
 * has not streamed.
 */
export function climateGrid(normals, band, width, height, bounds, noData, field) {
  const out = new Float32Array(width * height);
  for (let j = 0; j < height; j += 1) {
    const lat = bounds.maxY - ((j + 0.5) / height) * (bounds.maxY - bounds.minY);
    for (let i = 0; i < width; i += 1) {
      const lon = bounds.minX + ((i + 0.5) / width) * (bounds.maxX - bounds.minX);
      const h = band[(j * width) + i];
      const reading = readAt(normals, lat, lon, h === noData ? NaN : h);
      out[(j * width) + i] = reading ? reading[field] : noData;
    }
  }
  return out;
}

/* ── the page half ─────────────────────────────────────────────────────── */

let normals = null;
let loading = null;

/** Fetch once; every caller shares the one promise. */
export function load() {
  if (normals) return Promise.resolve(normals);
  if (!loading) {
    // `dataUrl` is async: it reads sources.json to learn whether the file
    // lives in the bucket and under which fingerprint.
    loading = dataUrl("/data/global/climate-normals.json")
      .then((url) => fetch(url))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((payload) => { normals = decodeNormals(payload); return normals; })
      .catch((error) => { loading = null; throw error; });
  }
  return loading;
}

export const ready = () => Boolean(normals);

/**
 * The synchronous reading the readout wants. Starts the fetch on first use and
 * answers null until it lands, so the caller can say it is still modelled
 * rather than wait.
 */
export function at(lat, lon, demM) {
  if (!normals) { load().catch(() => {}); return null; }
  return readAt(normals, lat, lon, demM);
}

export function normalsNow() {
  return normals;
}

if (typeof window !== "undefined") {
  window.GeoIDClimate = { load, at, ready, SOURCE, CITATION };
}
