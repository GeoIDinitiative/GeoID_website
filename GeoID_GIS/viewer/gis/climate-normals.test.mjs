/**
 * The climate normals: the grid is read where it is, and carried to the ground.
 * Run with `node climate-normals.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { decodeNormals, bilinear, surfaceHeight, downscale, readAt, LAPSE, climateGrid }
  from "./climate-normals.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* A 4 x 3 grid over the whole planet: 90° a column, 90° a row, poles included.
   Temperature rises one degree per column and ten per row, so bilinear has a
   closed-form answer anywhere. */
const W = 4; const H = 3;
const t = []; const p = []; const z = [];
for (let j = 0; j < H; j += 1) {
  for (let i = 0; i < W; i += 1) {
    t.push((i + (10 * j)) * 10);          // tenths of a degree
    p.push(100000 - (1000 * j));
    z.push(i === 1 && j === 1 ? 2000 : 0);
  }
}
const normals = decodeNormals({
  period: "test",
  grid: { west: -180, south: -90, dlon: 90, dlat: 90, width: W, height: H },
  t2m_c10: t, ps_pa: p, elev_m: z,
});

check("a cell centre reads the cell", near(bilinear(normals, "tempC", 0, -90), 11, 1e-9));
check("half-way between two columns is their mean",
  near(bilinear(normals, "tempC", 0, -135), 10.5, 1e-9));
check("longitude wraps: 0–360 and signed agree",
  near(bilinear(normals, "tempC", 0, 225), bilinear(normals, "tempC", 0, -135), 1e-9));
check("and the last column blends into the first across the seam",
  near(bilinear(normals, "tempC", 0, 135), (13 + 10) / 2, 1e-9));
check("latitude clamps at the pole rather than reading off the grid",
  Number.isFinite(bilinear(normals, "tempC", 95, 0)));
check("a missing corner is left out, not averaged in as nothing", (() => {
  const holed = { ...normals, tempC: normals.tempC.slice() };
  holed.tempC[(1 * W) + 1] = NaN;
  return near(bilinear(holed, "tempC", 0, -135), 10, 1e-9);
})());

/* ── the sea surface, and depressions ─────────────────────────────────── */

check("land keeps its own height", surfaceHeight(1200, 900) === 1200);
check("the open ocean is read at the SEA SURFACE, not the seabed", surfaceHeight(-4000, 0) === 0);
check("a shallow sea in a sea-level cell is water (the Caspian)", surfaceHeight(-28, -20) === 0);
check("a depression inside high ground keeps its depth (the Dead Sea)",
  surfaceHeight(-430, 350) === -430);
check("deep water beside a mountainous coast is still the sea",
  surfaceHeight(-3000, 800) === 0);

/* ── downscaling ─────────────────────────────────────────────────────── */

const cell = { tempC: 10, pressurePa: 90000, cellM: 1000 };
check("temperature falls 6.5 K per km above the cell's own height",
  near(downscale(cell, 2000).tempC, 10 - (LAPSE * 1000), 1e-9));
check("and rises below it", downscale(cell, 0).tempC > 10);
check("at the cell's height nothing changes",
  near(downscale(cell, 1000).tempC, 10, 1e-12) && near(downscale(cell, 1000).pressurePa, 90000, 1e-6));
check("pressure falls by the hypsometric equation — about 11% over the first km",
  near(downscale(cell, 2000).pressurePa / 90000, Math.exp(-9.80665 * 1000 / (287.05 * (273.15 + 10 - 3.25))), 1e-9));

const summit = readAt(normals, 0, -90, 5000);
check("a summit inside a 2 km cell reads the lapse rate from 2 km, not from sea level",
  near(summit.tempC, 11 - (LAPSE * 3000), 1e-6), JSON.stringify(summit));
const sea = readAt(normals, 0, 90, -4000);
check("a cursor over the deep ocean is read at the sea surface", sea.sea && sea.heightM === 0);
check("and so is NOT forty degrees warmer than the air above it",
  near(sea.tempC, bilinear(normals, "tempC", 0, 90), 1e-9));

/* ── the map is the readout's own function over a grid ───────────────── */

const heights = new Float32Array([5000, -4000, -32768, 0]);
const box = { minX: -135, maxX: 45, minY: -45, maxY: 45 };   // 2 x 2, 90° cells
const map = climateGrid(normals, heights, 2, 2, box, -32768, "tempC");
check("every map cell is exactly what the readout says at that place and height",
  near(map[0], readAt(normals, 22.5, -90, 5000).tempC, 1e-5)
  && near(map[1], readAt(normals, 22.5, 0, -4000).tempC, 1e-5));
check("a cell the DEM has not streamed is read at the grid's own height, not dropped",
  Number.isFinite(map[2]) && near(map[2], readAt(normals, -22.5, -90, NaN).tempC, 1e-5));

/* ── wired into the readout, with the model as the fallback ──────────── */

const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
check("the readout asks the climatology first", /GeoIDClimate\?\.at\?\.\(/.test(viewer));
check("and falls back to the formula only while it has not loaded",
  /estimateEarthTemperature\(latLon\.lat, elevationMeters\)/.test(viewer));
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check("the page loads the module", /gis\/climate-normals\.js/.test(page));
