/**
 * River corridor zones: sized by the river, cut by the terrain, merged by the
 * innermost. Run with `node river-zones.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { burnRivers, nearestSource, riverZones, zoneAreas, ZONES,
  NONE, MARGIN, BELT, FLOODPLAIN, CHANNEL } from "./river-zones.js";

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

/* A strip across the equator, 10 m a cell east–west: 1e-4 degrees of longitude
   is 11.132 m there, so the grid below is 11.132 m a column. One row tall is
   enough for distances along a line. */
const COL_M = 1e-4 * 111320;
function strip(cols, rows = 3) {
  return { west: 0, east: cols * 1e-4, south: -rows * 0.5e-4, north: rows * 0.5e-4 };
}

/* ── rules ────────────────────────────────────────────────────────────── */

const reach = Object.fromEntries(ZONES.map((z) => [z.key, z.reach]));
check("the seasonal margin has a 10 m floor", reach.margin(30) === 10 && reach.margin(400) === 100);
check("the migration belt is 3 W from the bank", reach.belt(100) === 300);
check("the floodplain is 10 W and capped at 5 m above the channel",
  reach.floodplain(100) === 1000 && ZONES.find((z) => z.key === "floodplain").maxAbove === 5);

/* ── burning ──────────────────────────────────────────────────────────── */

{
  // A north–south river down column 5 of a 20 x 20 grid, 0.001° a cell.
  const b = { west: 0, east: 0.02, south: 0, north: 0.02 };
  const { riverWidth } = burnRivers([{ properties: { width_median_m: 60, lake_flag: 0 },
    geometry: { type: "LineString", coordinates: [[0.0055, 0.0001], [0.0055, 0.0199]] } }], b, 20, 20);
  let col5 = 0; let other = 0;
  for (let j = 0; j < 20; j += 1) for (let i = 0; i < 20; i += 1) {
    if (Number.isFinite(riverWidth[(j * 20) + i])) { if (i === 5) col5 += 1; else other += 1; }
  }
  check("a centreline marks every cell it crosses and no others", col5 === 20 && other === 0,
    `${col5} / ${other}`);
  const lake = burnRivers([{ properties: { width_median_m: 60, lake_flag: 1 },
    geometry: { type: "LineString", coordinates: [[0.0055, 0.0001], [0.0055, 0.0199]] } }], b, 20, 20);
  check("a reach GRWL flags as running through a lake is left out",
    lake.riverWidth.every((v) => Number.isNaN(v)));
}

/* ── distance, in metres, on the right axis ───────────────────────────── */

{
  const b = strip(100, 1);
  const src = (c) => c === 0;
  const { dist } = nearestSource(src, 100, 1, b);
  check("distance is metres, not cells", Math.abs(dist[50] - (50 * COL_M)) < 0.5,
    `${dist[50]} vs ${50 * COL_M}`);
  // At 60°N a degree of longitude is half as long.
  const north = { west: 0, east: 0.01, south: 59.9999, north: 60.0001 };
  const d60 = nearestSource(src, 100, 1, north).dist;
  check("and a degree of longitude shrinks with latitude",
    Math.abs(d60[50] - (50 * 1e-4 * 111320 * Math.cos(Math.PI / 3))) < 0.5);
}

/* ── zones ────────────────────────────────────────────────────────────── */

{
  // A 100 m river down the middle of a 400-column strip; flat ground.
  const cols = 400; const b = strip(cols, 3);
  const mid = 200;
  // The river burned by hand, one cell down each row.
  const n = cols * 3;
  const riverWidth = new Float32Array(n).fill(NaN);
  for (let j = 0; j < 3; j += 1) riverWidth[(j * cols) + mid] = 100;
  const canal = new Uint8Array(n);
  const heights = new Float32Array(n).fill(20);
  const zones = riverZones({ heights, riverWidth, canal, width: cols, height: 3, bounds: b });
  const at = (m) => zones[(1 * cols) + mid + Math.round(m / COL_M)];     // m east of centreline
  check("the river's own water is the channel", at(0) === CHANNEL && at(45) === CHANNEL);
  check("just beyond the bank is the seasonal margin", at(70) === MARGIN, `${at(70)}`);
  check("then the migration belt, out to 3 W from the bank", at(200) === BELT && at(340) === BELT);
  check("then the floodplain, out to 10 W", at(500) === FLOODPLAIN && at(1040) === FLOODPLAIN);
  check("and nothing beyond it", at(1300) === NONE);

  // The valley side: the same ground 12 m above the river is no floodplain.
  const valley = new Float32Array(heights);
  for (let j = 0; j < 3; j += 1) for (let i = mid + 50; i < cols; i += 1) valley[(j * cols) + i] = 32;
  const cut = riverZones({ heights: valley, riverWidth, canal, width: cols, height: 3, bounds: b });
  check("ground more than 5 m above the channel is cut out of the floodplain",
    cut[(1 * cols) + mid + 60] === NONE && cut[(1 * cols) + mid - 60] === FLOODPLAIN);
  check("but distance zones inside it stand whatever the height",
    cut[(1 * cols) + mid + 20] === BELT);

  // A canal does not migrate.
  const canalFlag = new Uint8Array(n);
  for (let j = 0; j < 3; j += 1) canalFlag[(j * cols) + mid] = 1;
  const cz = riverZones({ heights, riverWidth, canal: canalFlag, width: cols, height: 3, bounds: b });
  check("a canal has no migration belt", cz[(1 * cols) + mid + 18] !== BELT);

  // Sea and lakes are never painted.
  const water = new Uint8Array(n);
  for (let j = 0; j < 3; j += 1) for (let i = mid + 10; i < mid + 30; i += 1) water[(j * cols) + i] = 1;
  const wz = riverZones({ heights, riverWidth, canal, water, width: cols, height: 3, bounds: b });
  // 8 columns out is 89 m from the centreline, 39 m from the bank: the belt.
  check("the sea and lakes are left unpainted", wz[(1 * cols) + mid + 20] === NONE
    && wz[(1 * cols) + mid + 8] === BELT);
}

{
  // A small stream near a big river: the big river's floodplain must survive.
  const cols = 600; const b = strip(cols, 3); const n = cols * 3;
  const riverWidth = new Float32Array(n).fill(NaN);
  for (let j = 0; j < 3; j += 1) { riverWidth[(j * cols) + 100] = 400; riverWidth[(j * cols) + 400] = 40; }
  const z = riverZones({ heights: new Float32Array(n).fill(10), riverWidth,
    canal: new Uint8Array(n), width: cols, height: 3, bounds: b });
  // 330 columns east of the big river (3.67 km) is inside its 4 km floodplain,
  // 30 columns (334 m) from the stream -- outside anything the stream gives.
  check("a stream's nearness does not hide a big river's floodplain",
    z[(1 * cols) + 430] === FLOODPLAIN, `${z[(1 * cols) + 430]}`);
  check("and next to the stream its own margin wins", z[(1 * cols) + 402] === MARGIN);
}

{
  const b = { west: 0, east: 10, south: 0, north: 10 };
  const cls = new Uint8Array(100).fill(MARGIN);
  const a = zoneAreas(cls, 10, 10, b);
  const cap = 6371.0088 ** 2 * (10 * Math.PI / 180) * Math.sin(10 * Math.PI / 180);
  check("zone areas are ground areas on the sphere", Math.abs(a[MARGIN] - cap) / cap < 0.001);
}

/* ── wired in ─────────────────────────────────────────────────────────── */

const sheets = readFileSync(new URL("./dem-layer.js", import.meta.url), "utf8");
check("the zones are a sheet of the streamed DEM", /riverzones:\s*\{/.test(sheets)
  && /riverZones\(/.test(sheets) && /waterFeatures\("rivers"/.test(sheets));

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check("the drawer holds one tick per zone and the page loads its wiring",
  [1, 2, 3].every((z) => new RegExp(`data-river-zone="${z}"`).test(page))
  && /gis\/river-zone-panel\.js/.test(page));
const panels = readFileSync(new URL("./catalogue-panels.js", import.meta.url), "utf8");
check("the hydrology row names the drawer", /id: "river-zones",[\s\S]{0,1800}settings: "river-zone-controls"/.test(panels));
const eq = readFileSync(new URL("./equations.js", import.meta.url), "utf8");
check("the ⓘ states the three rules the code applies",
  /max\(10 m, ¼ W\)/.test(eq) && /bank ≤ 3 W/.test(eq) && /≤ 5 m/.test(eq));
