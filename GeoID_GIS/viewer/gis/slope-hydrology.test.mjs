/**
 * The hydrogeological slope model and its two feeds: GFS rainfall maps and
 * multiple-flow-direction routing. Every check here is against a closed form,
 * the real rock-properties database, or a synthetic hillslope whose answer is
 * known. Run with `node slope-hydrology.test.mjs`.
 */
import { readFileSync } from "node:fs";
import {
  cosbyKsat, textureClass, columnMaterial, soilColumn, steadyWetness, planeWetness,
  factorOfSafety, criticalRecharge, fosClass, WATER_UNIT_WEIGHT,
} from "./slope-hydrology.js";
import { factorOfSafety as fosLegacy } from "./fos.js";
import { mfdTopology, routeFlux, fillSinks } from "./hydrology.js";
import { makeRaster } from "./raster-analysis.js";
import {
  fetchWindow, gfsLattice, gfsUrl, nodesFromResponses, nodeGrid, interpolatorFor, rainfallFrames,
  GFS_NODE_DEG, GFS_ARCHIVE_START,
} from "./gfs-rain.js";
import { useRockProperties, parameterValue, resolveLithology } from "./rock-properties.js";
import { stateOf } from "./landslide-pipeline.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
// The verdict is an exit hook, so a check appended anywhere still counts.
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`slope-hydrology: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ── the material, from the database — never its intact rock ─────────────── */

useRockProperties(JSON.parse(readFileSync(new URL("../../data/global/rock-properties.json", import.meta.url), "utf8")));
const rp = (name, key) => parameterValue(name, key);
// The resolver is handed over: the pipeline imports a STAMPED copy of the
// database module, a second instance this test never loaded.
const st = (t) => stateOf(t, resolveLithology);

{
  const k = cosbyKsat(40, 20);
  check("Cosby: log10 Ks[in/h] = −0.6 + 0.0126·sand − 0.0064·clay, in m/s",
    near(k, 10 ** (-0.6 + 0.504 - 0.128) * 0.0254 / 3600, 1e-12), String(k));
  check("more sand drains faster and more clay slower", cosbyKsat(80, 10) > cosbyKsat(40, 10) && cosbyKsat(40, 40) < cosbyKsat(40, 10));
  check("no texture, no pedotransfer", cosbyKsat(null, 20) === null);
  check("the dominant fraction names the texture", textureClass({ sand: 60, silt: 25, clay: 15 }) === "sand");
  check("but clay governs from 35%, well before it is the largest part", textureClass({ sand: 33, silt: 32, clay: 35 }) === "clay");
}

{
  const till = columnMaterial({ lith: "till", rp, state: st });
  check("a mapped deposit is itself: till, from the database", till.name === "till" && /mapped deposit/.test(till.from)
    && till.friction === 33 && near(till.cohesionKPa, 20, 1e-6), JSON.stringify(till));
  check("and keeps the database's conductivity for it", near(till.K, 1e-9, 1e-15) && /mapped deposit/.test(till.kFrom));
  check("saturated unit weight is the dry solids plus the pores full of water",
    near(till.unitWeight, (2100 / 1000 + 0.22) * WATER_UNIT_WEIGHT, 0.01), String(till.unitWeight));
  const overGranite = columnMaterial({ lith: "granite", rp, state: st });
  check("over bedrock the column is the database's REGOLITH, not the rock",
    overGranite.name === "regolith" && overGranite.friction === 33 && near(overGranite.cohesionKPa, 20, 1e-6));
  check("a granite's intact 52° and 30 MPa are never put on a shallow slide",
    overGranite.friction !== 52 && overGranite.cohesionKPa < 100);
  const tex = { sand: 60, silt: 25, clay: 15 };
  const sandy = columnMaterial({ lith: "granite", texture: tex, rp, state: st });
  check("the soil map's texture outranks the regolith, and Cosby gives its Ks",
    sandy.name === "sand" && near(sandy.K, cosbyKsat(60, 15), 1e-15) && /Cosby/.test(sandy.kFrom));
  const clayDeposit = columnMaterial({ lith: "clay", texture: { sand: 20, silt: 40, clay: 40 }, rp, state: st });
  check("a mapped clay keeps its strength, but its Ks is the soil map's field value, not the intact 1e-11",
    clayDeposit.name === "clay" && clayDeposit.friction === 24 && near(clayDeposit.K, cosbyKsat(20, 40), 1e-15));
  const residual = columnMaterial({ lith: "till", rp, state: st, strength: "residual" });
  check("residual strength reads the residual columns", residual.friction === 26 && residual.cohesionKPa === 0);
  const rooted = columnMaterial({ lith: "till", rp, state: st, rootCohesionKPa: 7 });
  check("root cohesion is added to the soil's own", near(rooted.cohesionKPa, 27, 1e-6));
  check("a map with no ground at all still gets a stated regolith", /no map/.test(columnMaterial({ rp, state: st }).from));
}

{
  const thin = soilColumn(0);
  check("the thickness model's 0 is whole metres — a thin veneer, still modelled", thin.thin && thin.zs === 0.5 && thin.zf === 0.5 && !thin.bare);
  const deep = soilColumn(12);
  check("a deep column keeps its thickness for the water and caps the failure plane at 3 m",
    deep.zs === 12 && deep.zf === 3 && !deep.bare);
  check("no thickness takes the stated default", soilColumn(NaN, 2).zs === 2 && /default/.test(soilColumn(NaN).from));
}

/* ── the steady water table and the plane it wets ────────────────────────── */

{
  const cell = { b: 30, K: 1e-5, zs: 2, slopeRad: 30 * Math.PI / 180 };
  check("no recharge, no water table", steadyWetness({ ...cell, q: 0 }) === 0);
  const half = cell.b * cell.K * Math.sin(cell.slopeRad) * cell.zs / 2;
  check("the table is linear in the flux: h = q / (b·K·sin β)", near(steadyWetness({ ...cell, q: half }), 0.5, 1e-9));
  check("and saturates at the column", steadyWetness({ ...cell, q: half * 10 }) === 1);
  check("lateral flow F times faster lowers the table F times",
    near(steadyWetness({ ...cell, q: half, lateral: 10 }), 0.05, 1e-9));
  check("the failure plane is dry until the table rises into it", planeWetness(0.3, 5, 3) === 0);
  check("then wet by the depth above it", near(planeWetness(0.8, 5, 3), (4 - 2) / 3, 1e-9));
  check("and saturated with the column", planeWetness(1, 5, 3) === 1);
}

{
  const args = { slopeRad: 32 * Math.PI / 180, c: 5, phi: 30, gamma: 19, zf: 1.5 };
  const legacy = fosLegacy({ slopeDeg: 32, cohesion: 5, friction: 30, unitWeight: 19, depth: 1.5, wetFraction: 0.6 });
  check("the infinite slope agrees with fos.js", near(factorOfSafety({ ...args, m: 0.6 }), legacy, 1e-3), `${legacy}`);
  check("water lowers the factor of safety", factorOfSafety({ ...args, m: 1 }) < factorOfSafety({ ...args, m: 0 }));
  check("flat ground has a factor of safety too: capped, and stable", factorOfSafety({ ...args, slopeRad: 0, m: 1 }) === 100
    && fosClass(factorOfSafety({ ...args, slopeRad: 0.5 * Math.PI / 180, m: 1 })) === 4);
  check("the classes cut at 1, 1.1, 1.3 and 1.5", fosClass(0.9) === 0 && fosClass(1.05) === 1 && fosClass(1.2) === 2
    && fosClass(1.4) === 3 && fosClass(2) === 4 && fosClass(NaN) === -1);
}

{
  // The rainfall to fail, run forwards again: that recharge must give FoS = 1.
  const cell = { slopeRad: 34 * Math.PI / 180, c: 4, phi: 32, gamma: 20, zs: 2.5, zf: 2.5, K: 2e-5, b: 30, areaM2: 30 * 30 * 12, lateral: 30 };
  const r = criticalRecharge(cell);
  check("a finite rainfall to fail", Number.isFinite(r) && r > 0, String(r));
  const q = (r / 1000 / 86400) * cell.areaM2;
  const W = steadyWetness({ q, b: cell.b, K: cell.K, zs: cell.zs, slopeRad: cell.slopeRad, lateral: cell.lateral });
  const fos = factorOfSafety({ ...cell, m: planeWetness(W, cell.zs, cell.zf) });
  check("and that steady recharge brings the cell exactly to FoS = 1", near(fos, 1, 1e-6), `FoS ${fos}`);
  check("a gentle, strong slope holds even saturated",
    criticalRecharge({ ...cell, slopeRad: 12 * Math.PI / 180, c: 15 }) === Infinity);
  check("a steep, cohesionless one fails even dry",
    criticalRecharge({ ...cell, slopeRad: 45 * Math.PI / 180, c: 0, phi: 30 }) === 0);
}

/* ── multiple-flow-direction routing ──────────────────────────────────────── */

const lattice = (w, h, f) => {
  const band = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = f(x, y);
  // ~11 m cells at the equator
  return makeRaster(band, w, h, { minX: 0, maxX: w * 1e-4, minY: 0, maxY: h * 1e-4 }, NaN);
};

{
  const plane = lattice(30, 20, (x) => 100 - x * 1.0);
  const topo = mfdTopology(plane);
  const src = new Float64Array(30 * 20).fill(1);
  const acc = routeFlux(topo, src);
  let out = 0;
  for (let i = 0; i < acc.length; i += 1) if (topo.recv[i * 8] < 0) out += acc[i];
  check("routing conserves the water: what leaves is what fell", near(out, 600, 1e-3), String(out));
  check("down a plane the flow grows with the distance run", acc[10 * 30 + 25] > acc[10 * 30 + 5]);
}

{
  // A V-shaped valley draining east: the axis collects what both sides shed.
  const w = 40; const h = 41; const mid = 20;
  const valley = lattice(w, h, (x, y) => 200 - 0.5 * x + 2 * Math.abs(y - mid));
  const topo = mfdTopology(fillSinks(valley));
  const acc = routeFlux(topo, new Float64Array(w * h).fill(1));
  const axis = acc[mid * w + 30]; const side = acc[(mid - 12) * w + 30];
  check("a hollow gathers far more of the hillside than the slope beside it", axis > 20 * side, `${axis} against ${side}`);
  check("every cell passes on at most eight shares, and they sum to one",
    [...Array(w * h).keys()].every((i) => {
      let s = 0; for (let k = 0; k < 8 && topo.recv[i * 8 + k] >= 0; k += 1) s += topo.frac[i * 8 + k];
      return topo.recv[i * 8] < 0 || near(s, 1, 1e-5);
    }));
}

/* ── GFS rainfall maps ────────────────────────────────────────────────────── */

{
  const ok = fetchWindow({ start: "2023-05-15", end: "2023-05-17", windowH: 24, today: "2026-09-11" });
  check("the fetch starts early by the rainfall window", ok.ok && ok.from === "2023-05-14" && ok.to === "2023-05-17" && ok.days === 3, JSON.stringify(ok));
  check("a 72 h window starts three days early", fetchWindow({ start: "2023-05-15", end: "2023-05-17", windowH: 72, today: "2026-09-11" }).from === "2023-05-12");
  check("forecasts reach fifteen days", fetchWindow({ start: "2026-09-11", end: "2026-09-26", today: "2026-09-11" }).ok
    && !fetchWindow({ start: "2026-09-11", end: "2026-09-27", today: "2026-09-11" }).ok);
  check("and the archive begins in March 2021", !fetchWindow({ start: "2021-01-10", end: "2021-01-12", today: "2026-09-11" }).ok
    && GFS_ARCHIVE_START === "2021-03-24");
  check("a backwards window is refused, not repaired", !fetchWindow({ start: "2023-05-17", end: "2023-05-15", today: "2026-09-11" }).ok);
}

{
  const b = { west: 11.55, south: 44.05, east: 11.95, north: 44.30 };
  const lat = gfsLattice(b);
  check("the request lattice is at half the node spacing, over the area and a node and a half of margin",
    near(lat.step, GFS_NODE_DEG / 2, 1e-12) && lat.points[0].lat < b.south - GFS_NODE_DEG && lat.points.at(-1).lon > b.east + GFS_NODE_DEG);
  const url = gfsUrl(lat.points.slice(0, 2), { from: "2023-05-14", to: "2023-05-17" });
  check("asked of GFS, hourly, by date, in UTC", /historical-forecast-api\.open-meteo\.com/.test(url) && /models=gfs_global/.test(url)
    && /hourly=precipitation/.test(url) && /start_date=2023-05-14/.test(url) && /timezone=UTC/.test(url));
  check("longitudes go out signed", /longitude=[-0-9.,]+/.test(url) && !/longitude=3/.test(gfsUrl([{ lat: 0, lon: 350 }], { from: "a", to: "b" })));
}

{
  // Four nodes answering nine requests: the duplicates are the same node.
  const times = ["2023-05-15T00:00", "2023-05-15T01:00"];
  const node = (lat, lon, v) => ({ latitude: lat, longitude: lon, elevation: 100, hourly: { time: times, precipitation: [v, v] } });
  const answer = [node(44, 11, 1), node(44, 11, 1), node(44, 12, 2), node(45, 11, 3), node(45, 12, 4), node(45, 12, 4)];
  const { nodes } = nodesFromResponses([answer]);
  check("the answers are de-duplicated to the nodes", nodes.length === 4);
  const grid = nodeGrid(nodes);
  check("a full lattice of nodes reads as a regular grid", grid.regular && grid.lats.length === 2 && grid.lons.length === 2);
  // The field lat + 2·lon is a plane; bilinear is exact on it.
  const plane = nodes.map((n) => n.lat + 2 * n.lon);
  const it = interpolatorFor(grid, nodes, 44.3, 11.7);
  const v = [0, 1, 2, 3].reduce((s, k) => s + it.wt[k] * plane[it.idx[k]], 0);
  check("bilinear between nodes is exact on a plane", near(v, 44.3 + 2 * 11.7, 1e-6), String(v));
  const holey = nodeGrid(nodes.slice(0, 3));
  check("a lattice with a hole is read by distance instead", !holey.regular
    && interpolatorFor(holey, nodes.slice(0, 3), 44, 11).wt[0] === 1);
}

{
  // 48 hours of 1 mm/h at one node: a 24 h map holds 24 mm.
  const times = Array.from({ length: 72 }, (_, t) => new Date(Date.UTC(2023, 4, 14) + t * 3600000).toISOString().slice(0, 16));
  const nodes = [{ lat: 0, lon: 0, rain: Float32Array.from({ length: 72 }, (_, t) => (t < 24 ? 0 : 1)) }];
  const s = rainfallFrames(times, nodes, { start: "2023-05-15", windowH: 24, everyH: 6 });
  check("the maps begin at the start date, one every six hours", s.frames[0].time === "2023-05-15T00:00"
    && s.frames[1].time === "2023-05-15T06:00" && s.frames.length === 8, s.frames.map((f) => f.time).join(" "));
  check("each map is the rain in the window before it", s.accumulation(s.frames[0])[0] === 1
    && s.accumulation(s.frames[4])[0] === 24, `${s.accumulation(s.frames[0])[0]} / ${s.accumulation(s.frames[4])[0]}`);
  const many = rainfallFrames(times, nodes, { start: "2023-05-14", windowH: 1, everyH: 1, maxFrames: 10 });
  check("past the frame budget the maps are strided, and the stride is said", many.stride > 1 && many.frames.length <= 10);
  const gap = rainfallFrames(times, [{ lat: 0, lon: 0, rain: Float32Array.from({ length: 72 }, (_, t) => (t === 30 ? NaN : 1)) }], { start: "2023-05-15" });
  check("a missing hour is counted, and counts as dry", gap.missing === 1);
}
