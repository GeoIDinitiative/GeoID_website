/**
 * A 3D model of the atmosphere over a study area, built from the GFS forecast
 * on its pressure levels and opened in the Model page's Results reader the way
 * a solved FEM run is — slices, isosurfaces, thresholds by layer, vector
 * glyphs and stream lines of the wind, statistics by layer, VTK out.
 *
 * WHY PRESSURE LEVELS AND NOT SATELLITE IMAGERY. A picture of the sky says
 * where the cloud tops are; it does not say the dew point at 3 km. The 3D
 * state of the air is what a numerical model assimilates the satellites INTO,
 * and GFS publishes it on 25+ pressure levels: temperature, humidity, dew
 * point, cloud cover, wind and the geopotential height of each level. Earth
 * Engine carries ERA5's pressure levels too, but this site's Earth Engine
 * service renders pictures, and a model needs numbers — so the numbers come
 * from Open-Meteo, which serves GFS's own.
 *
 * WHAT IS DERIVED here, per node, from what GFS gives: specific humidity
 * (Bolton 1980 vapour pressure from the dew point), potential temperature,
 * equivalent potential temperature (Bolton's approximation), air density
 * from the virtual temperature, the vertical wind from ω where GFS gives it
 * in Pa/s, and per COLUMN the precipitable water — the depth of rain the
 * column would make if every gram of its vapour fell out.
 *
 * THE LAYERS are classified per column, each cell given one as its "material"
 * so the Results reader treats it as a domain: below the ground, the boundary
 * layer (within 1.5 km of the ground), the free troposphere, the tropopause
 * layer (within 1.5 km of the WMO tropopause: the lowest level above 5 km
 * where the lapse rate falls to 2 K/km and stays at or under it on average
 * for the 2 km above), and the stratosphere.
 */

import { vtuParts } from "./vtk-export.js?v=20261026-6de4f5a";

export const LEVELS = [1000, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500,
  450, 400, 350, 300, 250, 200, 150, 100, 70, 50, 30, 20, 10];

const VARS = ["temperature", "relative_humidity", "dew_point", "cloud_cover",
  "wind_speed", "wind_direction", "geopotential_height", "vertical_velocity"];

export const LAYER_NAMES = {
  0: "below the ground",
  1: "boundary layer",
  2: "free troposphere",
  3: "tropopause layer",
  4: "stratosphere",
};

const R_EARTH = 6371008.8;
const RAD = Math.PI / 180;
const G = 9.80665;
const RD = 287.05;

/** The hourly variable names for every level. */
export function levelVariables(levels = LEVELS) {
  return levels.flatMap((p) => VARS.map((v) => `${v}_${p}hPa`));
}

/** Saturation vapour pressure over water, hPa, Bolton (1980). */
export function vapourPressure(tC) {
  return 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));
}

/** Specific humidity in g/kg from the dew point and the pressure. */
export function specificHumidity(dewC, pHpa) {
  const e = vapourPressure(dewC);
  return (1000 * 0.622 * e) / (pHpa - 0.378 * e);
}

/** Potential temperature, K. */
export function potentialTemperature(tC, pHpa) {
  return (tC + 273.15) * Math.pow(1000 / pHpa, 0.2857);
}

/**
 * Equivalent potential temperature, K — the potential temperature a parcel
 * would have if all its vapour condensed: Bolton's (1980) eq. 43 with the LCL
 * temperature from his eq. 15. What a forecaster reads instability from.
 */
export function equivalentPotentialTemperature(tC, dewC, pHpa) {
  const T = tC + 273.15;
  const Td = dewC + 273.15;
  const r = specificHumidity(dewC, pHpa) / (1 - specificHumidity(dewC, pHpa) / 1000); // g/kg mixing ratio
  const TL = 1 / (1 / (Td - 56) + Math.log(T / Td) / 800) + 56;
  const thetaL = T * Math.pow(1000 / pHpa, 0.2854 * (1 - 0.00028 * r));
  return thetaL * Math.exp((3.376 / TL - 0.00254) * r * (1 + 0.00081 * r));
}

/** Air density from pressure, temperature and specific humidity (virtual temperature). */
export function airDensity(pHpa, tC, qGkg) {
  const q = qGkg / 1000;
  const Tv = (tC + 273.15) * (1 + 0.608 * q);
  return (pHpa * 100) / (RD * Tv);
}

/**
 * The WMO tropopause of one column: the lowest level above `minHeight` at
 * which the lapse rate falls to 2 K/km, provided the average lapse rate from
 * there to every level within the next 2 km does not exceed it. Heights in m,
 * temperatures in °C, both ordered by rising height. Null when the column
 * does not reach one.
 */
export function tropopauseHeight(heights, temps, { minHeight = 5000 } = {}) {
  const n = heights.length;
  for (let k = 0; k < n - 1; k += 1) {
    const z = heights[k];
    if (!(z >= minHeight)) continue;
    const lapse = -((temps[k + 1] - temps[k]) / ((heights[k + 1] - z) / 1000));
    if (!(lapse <= 2)) continue;
    let holds = true;
    for (let j = k + 1; j < n && heights[j] - z <= 2000; j += 1) {
      const mean = -((temps[j] - temps[k]) / ((heights[j] - z) / 1000));
      if (mean > 2) { holds = false; break; }
    }
    if (holds) return z;
  }
  return null;
}

/** Which layer a height is in, given its column's ground and tropopause. */
export function layerOf(z, ground, tropopause) {
  if (Number.isFinite(ground) && z < ground) return 0;
  if (Number.isFinite(ground) && z - ground < 1500) return 1;
  if (Number.isFinite(tropopause)) {
    if (Math.abs(z - tropopause) <= 1500) return 3;
    if (z > tropopause) return 4;
  }
  return 2;
}

/**
 * Precipitable water of a column, mm: ∫ q dp / g over the levels, by the
 * trapezium rule. One kg of water over a square metre is one mm deep.
 */
export function precipitableWater(pressuresHpa, qGkg) {
  let sum = 0;
  for (let k = 0; k < pressuresHpa.length - 1; k += 1) {
    const a = qGkg[k], b = qGkg[k + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const dp = Math.abs(pressuresHpa[k] - pressuresHpa[k + 1]) * 100;
    sum += (((a + b) / 2) / 1000) * dp / G;
  }
  return sum;
}

/** Local east/north metres about an origin — the Model Builder's own frame. */
export function localFrame(lat0, lon0) {
  const k = R_EARTH * RAD;
  const c = Math.cos(lat0 * RAD);
  return {
    toXY: (lat, lon) => [(lon - lon0) * c * k, (lat - lat0) * k],
    origin: { lat: lat0, lon: lon0 },
    crs: `local east/north metres about ${lat0.toFixed(4)}°, ${lon0.toFixed(4)}°, equirectangular on a ${R_EARTH} m sphere; z metres above sea level`,
  };
}

/**
 * One location's answer at the chosen hour, as arrays over the levels in
 * rising-height order. Units read from the answer: a vertical velocity in
 * Pa/s is turned into m/s through the hydrostatic relation w = -ω / (ρ g).
 */
export function readColumn(loc, hourIndex, levels = LEVELS) {
  const h = loc.hourly;
  const units = loc.hourly_units || {};
  const col = levels.map((p) => {
    const get = (v) => {
      const x = h?.[`${v}_${p}hPa`]?.[hourIndex];
      return x === null || x === undefined ? NaN : Number(x);
    };
    const t = get("temperature");
    const dew = get("dew_point");
    const q = Number.isFinite(dew) ? specificHumidity(dew, p) : NaN;
    const rho = Number.isFinite(t) ? airDensity(p, t, Number.isFinite(q) ? q : 0) : NaN;
    const speed = get("wind_speed");
    const unitSpeed = String(units[`wind_speed_${p}hPa`] || "m/s");
    const s = /km/.test(unitSpeed) ? speed / 3.6 : /kn/.test(unitSpeed) ? speed * 0.514444 : speed;
    const dir = get("wind_direction");
    let w = get("vertical_velocity");
    if (/pa/i.test(String(units[`vertical_velocity_${p}hPa`] || ""))) w = -w / (rho * G);
    return {
      p, t, dew, q, rho,
      rh: get("relative_humidity"),
      cloud: get("cloud_cover"),
      z: get("geopotential_height"),
      u: -s * Math.sin(dir * RAD),
      v: -s * Math.cos(dir * RAD),
      w: Number.isFinite(w) ? w : 0,
    };
  });
  // Rising height. Levels the model left empty are dropped from the column.
  return col.filter((c) => Number.isFinite(c.z) && Number.isFinite(c.t)).sort((a, b) => a.z - b.z);
}

/**
 * The model as a VTK grid: a lattice of columns, each resampled onto the same
 * levels so every column has the same node count, joined into hexahedra.
 *
 *   columns   [{ lat, lon, ground, levels: readColumn(...) }], row by row (nx per row)
 *   nx, ny    the lattice
 *   exaggerate  vertical factor applied to the drawn height only (the true
 *               height rides along as the "height_m" field)
 */
export function buildAtmosphereGrid(columns, nx, ny, { exaggerate = 1, frame } = {}) {
  const nz = Math.min(...columns.map((c) => c.levels.length));
  if (!(nz >= 2)) throw new Error("the columns have fewer than two levels in common");
  const nPts = nx * ny * nz;
  const points = new Float64Array(nPts * 3);
  const names = ["temperature_C", "dew_point_C", "relative_humidity_pct", "specific_humidity_gkg",
    "cloud_cover_pct", "potential_temperature_K", "equivalent_potential_temperature_K",
    "pressure_hPa", "air_density_kgm3", "height_m", "precipitable_water_mm", "dew_point_depression_C"];
  const data = Object.fromEntries(names.map((n) => [n, new Float64Array(nPts)]));
  const velocity = new Float64Array(nPts * 3);
  const tropo = [];
  const pidx = (i, j, k) => (k * ny + j) * nx + i;
  columns.forEach((col, c) => {
    const i = c % nx;
    const j = Math.floor(c / nx);
    const [x, y] = frame.toXY(col.lat, col.lon);
    const lv = col.levels.slice(0, nz);
    const pw = precipitableWater(lv.map((l) => l.p), lv.map((l) => l.q));
    tropo[c] = tropopauseHeight(lv.map((l) => l.z), lv.map((l) => l.t));
    lv.forEach((l, k) => {
      const n = pidx(i, j, k);
      points[n * 3] = x;
      points[n * 3 + 1] = y;
      points[n * 3 + 2] = l.z * exaggerate;
      data.temperature_C[n] = l.t;
      data.dew_point_C[n] = l.dew;
      data.relative_humidity_pct[n] = l.rh;
      data.specific_humidity_gkg[n] = l.q;
      data.cloud_cover_pct[n] = l.cloud;
      data.potential_temperature_K[n] = potentialTemperature(l.t, l.p);
      data.equivalent_potential_temperature_K[n] = Number.isFinite(l.dew)
        ? equivalentPotentialTemperature(l.t, l.dew, l.p) : NaN;
      data.pressure_hPa[n] = l.p;
      data.air_density_kgm3[n] = l.rho;
      data.height_m[n] = l.z;
      data.precipitable_water_mm[n] = pw;
      data.dew_point_depression_C[n] = l.t - l.dew;
      velocity[n * 3] = l.u;
      velocity[n * 3 + 1] = l.v;
      velocity[n * 3 + 2] = l.w;
    });
  });
  const nCells = (nx - 1) * (ny - 1) * (nz - 1);
  const connectivity = new Int32Array(nCells * 8);
  const offsets = new Int32Array(nCells);
  const types = new Uint8Array(nCells).fill(12); // VTK_HEXAHEDRON
  const layer = new Int32Array(nCells);
  const counts = {};
  let cell = 0;
  for (let k = 0; k < nz - 1; k += 1) {
    for (let j = 0; j < ny - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        const ids = [pidx(i, j, k), pidx(i + 1, j, k), pidx(i + 1, j + 1, k), pidx(i, j + 1, k),
          pidx(i, j, k + 1), pidx(i + 1, j, k + 1), pidx(i + 1, j + 1, k + 1), pidx(i, j + 1, k + 1)];
        connectivity.set(ids, cell * 8);
        offsets[cell] = (cell + 1) * 8;
        // The cell's layer, from its centre against its four columns' own
        // ground and tropopause.
        const cols = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => b * nx + a);
        const zc = ids.reduce((s, id) => s + data.height_m[id], 0) / 8;
        const ground = cols.reduce((s, c) => s + (Number.isFinite(columns[c].ground) ? columns[c].ground : 0), 0) / 4;
        const tp = cols.map((c) => tropo[c]).filter(Number.isFinite);
        const tropoMean = tp.length ? tp.reduce((s, z) => s + z, 0) / tp.length : null;
        const cls = layerOf(zc, ground, tropoMean);
        layer[cell] = cls;
        counts[cls] = (counts[cls] || 0) + 1;
        cell += 1;
      }
    }
  }
  const pointData = [
    { name: "velocity", components: 3, values: velocity },
    ...names.map((name) => ({ name, components: 1, values: data[name] })),
  ];
  const cellData = [{ name: "material", components: 1, values: layer }];
  const tps = tropo.filter(Number.isFinite);
  return {
    points, cells: { connectivity, offsets, types }, pointData, cellData,
    nx, ny, nz, counts,
    tropopause: tps.length ? { min: Math.min(...tps), max: Math.max(...tps), columns: tps.length } : null,
  };
}

/** The grid as a .vtu File the Results reader opens. */
export function gridFile(grid, name = "atmosphere.vtu", time = null) {
  const { parts } = vtuParts({ points: grid.points, cells: grid.cells, pointData: grid.pointData,
    cellData: grid.cellData, time });
  return new File(parts, name, { type: "application/xml" });
}
