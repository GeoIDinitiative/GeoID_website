/**
 * The 3D atmosphere model against closed forms and published values.
 * Run: node GeoID_GIS/viewer/gis/atmosphere-model.test.mjs
 */
import {
  LEVELS, levelVariables, vapourPressure, specificHumidity, potentialTemperature,
  equivalentPotentialTemperature, airDensity, tropopauseHeight, layerOf, precipitableWater,
  localFrame, readColumn, buildAtmosphereGrid,
} from "./atmosphere-model.js";

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass += 1;
  else { fail += 1; console.error("FAIL:", msg); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
process.on("exit", () => {
  console.log(`atmosphere-model: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});

ok(LEVELS.length === 25 && LEVELS[0] === 1000 && LEVELS.at(-1) === 10, "25 levels, 1000 to 10 hPa");
ok(levelVariables().length === 25 * 8 && levelVariables().includes("dew_point_500hPa"), "eight variables a level");

// Bolton: 6.112 hPa at 0 °C, about 23.4 at 20 °C, 42.4 at 30 °C.
ok(near(vapourPressure(0), 6.112, 1e-9), "e_s(0 °C) = 6.112 hPa");
ok(near(vapourPressure(20), 23.37, 0.05), `e_s(20 °C) ≈ 23.4 (${vapourPressure(20)})`);
ok(near(vapourPressure(30), 42.4, 0.2), "e_s(30 °C) ≈ 42.4");
// A 20 °C dew point at 1000 hPa is about 14.7 g/kg.
ok(near(specificHumidity(20, 1000), 14.7, 0.2), `q ≈ 14.7 g/kg (${specificHumidity(20, 1000)})`);
ok(specificHumidity(-40, 300) < 0.5, "cold upper air holds almost no vapour");

ok(near(potentialTemperature(15, 1000), 288.15, 1e-9), "θ at 1000 hPa is the temperature");
ok(near(potentialTemperature(-56.5, 200), 216.65 * Math.pow(5, 0.2857), 1e-9), "θ at 200 hPa");
ok(potentialTemperature(-56.5, 200) > potentialTemperature(15, 1000), "θ rises into the stratosphere");
{
  const te = equivalentPotentialTemperature(25, 22, 1000);
  ok(te > 330 && te < 350, `a moist tropical parcel has θe ≈ 340 K (${te})`);
  ok(equivalentPotentialTemperature(25, -30, 1000) - potentialTemperature(25, 1000) < 1.5, "a dry parcel's θe ≈ θ");
}
// Standard sea level: 1.225 kg/m³.
ok(near(airDensity(1013.25, 15, 0), 1.2250, 0.0005), `ρ at standard sea level (${airDensity(1013.25, 15, 0)})`);
ok(airDensity(1013.25, 15, 15) < airDensity(1013.25, 15, 0), "moist air is lighter");

// The US standard atmosphere's tropopause: 6.5 K/km to 11 km, isothermal above.
{
  const heights = [];
  const temps = [];
  for (let z = 0; z <= 20000; z += 1000) {
    heights.push(z);
    temps.push(z <= 11000 ? 15 - 6.5 * z / 1000 : -56.5);
  }
  ok(tropopauseHeight(heights, temps) === 11000, `standard atmosphere tropopause at 11 km (${tropopauseHeight(heights, temps)})`);
  ok(tropopauseHeight(heights.slice(0, 8), temps.slice(0, 8)) === null, "a column below the tropopause has none");
  // A shallow inversion low down is not a tropopause.
  const t2 = temps.slice();
  t2[2] = t2[1] + 1;
  ok(tropopauseHeight(heights, t2) === 11000, "a 2 km inversion is ignored (under 5 km)");
}

ok(layerOf(-10, 0, 11000) === 0, "below the ground");
ok(layerOf(800, 0, 11000) === 1, "boundary layer within 1.5 km");
ok(layerOf(5000, 0, 11000) === 2, "free troposphere");
ok(layerOf(11800, 0, 11000) === 3, "tropopause layer");
ok(layerOf(16000, 0, 11000) === 4, "stratosphere");
ok(layerOf(2500, 1500, 11000) === 1, "the boundary layer follows the ground");

// A column of 10 g/kg from 1000 to 900 hPa: 10e-3 × 10000 Pa / g ≈ 10.2 mm.
ok(near(precipitableWater([1000, 900], [10, 10]), 10.197, 0.01), "precipitable water by the trapezium rule");
ok(precipitableWater([1000, 900, 800], [10, NaN, 10]) === 0, "a gap leaves its intervals out");

{
  const f = localFrame(0, 0);
  const [x, y] = f.toXY(1, 1);
  ok(near(x, 111195, 1) && near(y, 111195, 1), "a degree is 111.2 km at the equator");
  ok(near(localFrame(60, 0).toXY(60, 1)[0], 55597, 2), "a degree of longitude halves at 60°");
}

// readColumn: units, ω, ordering, gaps.
{
  const levels = [1000, 850, 500];
  const hourly = {};
  const put = (v, p, x) => { hourly[`${v}_${p}hPa`] = [x]; };
  [[1000, 110, 20, 15, 10, 0], [850, 1500, 10, 5, 20, 90], [500, 5600, -20, -30, 30, 180]].forEach(([p, z, t, td, s, d]) => {
    put("geopotential_height", p, z); put("temperature", p, t); put("dew_point", p, td);
    put("relative_humidity", p, 70); put("cloud_cover", p, 40);
    put("wind_speed", p, s); put("wind_direction", p, d); put("vertical_velocity", p, -0.5);
  });
  const units = { vertical_velocity_1000hPa: "Pa/s", vertical_velocity_850hPa: "Pa/s", vertical_velocity_500hPa: "Pa/s", wind_speed_850hPa: "km/h" };
  const col = readColumn({ hourly, hourly_units: units }, 0, levels);
  ok(col.length === 3 && col[0].z < col[1].z && col[1].z < col[2].z, "the column rises");
  ok(near(col[0].u, 0, 1e-9) && near(col[0].v, -10, 1e-9), "a north wind blows south");
  ok(near(col[1].u, -20 / 3.6, 1e-9), "km/h read as such, from the east");
  ok(near(col[2].v, 30, 1e-9), "a south wind blows north");
  ok(col[0].w > 0 && near(col[0].w, 0.5 / (col[0].rho * 9.80665), 1e-9), "rising ω (negative Pa/s) is a positive w in m/s");
  hourly.temperature_850hPa = [null];
  ok(readColumn({ hourly, hourly_units: units }, 0, levels).length === 2, "a level the model left empty is dropped");
}

// A 2 × 2 lattice of three-level columns: hexes, layers, fields.
{
  const frame = localFrame(45, 7);
  const mk = (lat, lon, ground) => ({
    lat, lon, ground,
    levels: [
      { p: 1000, z: 100, t: 15, dew: 10, q: specificHumidity(10, 1000), rho: 1.2, rh: 70, cloud: 10, u: 1, v: 2, w: 0 },
      { p: 700, z: 3000, t: -2, dew: -8, q: specificHumidity(-8, 700), rho: 0.9, rh: 60, cloud: 50, u: 5, v: 0, w: 0.1 },
      { p: 300, z: 9200, t: -45, dew: -55, q: specificHumidity(-55, 300), rho: 0.45, rh: 40, cloud: 0, u: 30, v: 5, w: 0 },
    ],
  });
  const cols = [mk(45, 7, 0), mk(45, 7.1, 0), mk(45.1, 7, 500), mk(45.1, 7.1, 0)];
  const g = buildAtmosphereGrid(cols, 2, 2, { exaggerate: 5, frame });
  ok(g.points.length === 2 * 2 * 3 * 3, "a node per level per column");
  ok(g.cells.types.length === 2 && g.cells.types.every((t) => t === 12), "two hexahedra");
  ok(g.cells.offsets[1] === 16, "offsets in eights");
  ok(near(g.points[2], 500, 1e-9), "height exaggerated ×5 in the drawing");
  const h = g.pointData.find((d) => d.name === "height_m");
  ok(h.values[0] === 100, "the true height rides along");
  const vel = g.pointData.find((d) => d.name === "velocity");
  ok(vel.components === 3 && vel.values[0] === 1 && vel.values[1] === 2, "velocity is a vector");
  ok(g.cellData[0].name === "material" && g.cellData[0].values.length === 2, "a layer per cell");
  ok(g.counts[1] === 1 && g.counts[2] === 1, `boundary layer below, free troposphere above (${JSON.stringify(g.counts)})`);
  const pw = g.pointData.find((d) => d.name === "precipitable_water_mm");
  ok(pw.values[0] > 0 && pw.values[0] === pw.values[4] && pw.values[0] === pw.values[8], "precipitable water is one number per column, on every level");
  let threw = false;
  try { buildAtmosphereGrid([{ ...cols[0], levels: cols[0].levels.slice(0, 1) }], 1, 1, { frame }); } catch { threw = true; }
  ok(threw, "a column of one level is refused");
}

// The panel's pure half and its wiring.
{
  const { boxAbout, lattice, levelsTo } = await import("./atmosphere-panel.js");
  const b = boxAbout(60, 10, 222.39);
  ok(near(b.north - b.south, 2, 1e-3) && near(b.east - b.west, 4, 1e-3), "a 222 km box is 2° of latitude and 4° of longitude at 60°");
  const { lats, lons } = lattice({ south: 0, north: 1, west: 179.5, east: 180.5 }, 3);
  ok(lats.length === 9 && lats[0] === 0 && lats[8] === 1, "a lattice row by row from the south-west");
  ok(lons[2] === -179.5, "longitudes wrap across the antimeridian");
  ok(levelsTo(100).at(-1) === 100 && levelsTo(100)[0] === 1000, "the levels up to the top asked for");
  const { readFileSync } = await import("node:fs");
  const here = new URL(".", import.meta.url);
  const page = readFileSync(new URL("../index.html", here), "utf8");
  const panel = readFileSync(new URL("atmosphere-panel.js", here), "utf8");
  ok(/gis\/atmosphere-panel\.js\?v=/.test(page), "the page loads the panel");
  ok(/GeoIDGalesResults/.test(panel) && /openFolder\(\[pvd, file\]\)/.test(panel), "the model is handed to the Results reader");
  ok(/models: "gfs_seamless"/.test(panel) && /wind_speed_unit: "ms"/.test(panel), "GFS, in metres a second");
}
