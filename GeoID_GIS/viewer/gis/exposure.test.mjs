// Exposure: people are conserved from WorldPop onto any hazard grid, and the
// integrals inside a polygon come to what the arithmetic says they must.
import {
  boxOf, inPolygon, polygonsOf, polygonIndex, peopleOnGrid, polygonMask, gridExposure,
  riskExposure, formatPeople, seriesCsv,
} from "./exposure.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
process.on("exit", () => {
  console.log(`exposure: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
  if (fail) process.exitCode = 1;
});
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// A 4×4 population window over 0..4°E, 0..4°N with a count of (row*4+col+1).
const pop = { width: 4, height: 4, bounds: { west: 0, east: 4, south: 0, north: 4 }, band: new Float32Array(16) };
let popTotal = 0;
for (let i = 0; i < 16; i++) { pop.band[i] = i + 1; popTotal += i + 1; }

ok("boxOf reads all four spellings",
  JSON.stringify(boxOf({ minX: 1, maxX: 2, minY: 3, maxY: 4 })) === JSON.stringify(boxOf({ west: 1, east: 2, south: 3, north: 4 }))
  && boxOf({ minLon: 1, maxLon: 2, minLat: 3, maxLat: 4 }).east === 2);

// A FINER grid: 16 hazard cells per population cell. People are conserved.
const fine = { width: 16, height: 16, bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 } };
const pf = peopleOnGrid(pop, fine);
ok("a finer grid holds exactly the population it was read from", close(pf.reduce((a, b) => a + b, 0), popTotal));
ok("a fine cell carries a sixteenth of its population cell", close(pf[0], 1 / 16) && close(pf[16 * 16 - 1], 16 / 16));

// A COARSER grid: 2×2 over the same ground sums the four cells under each.
const coarse = { width: 2, height: 2, bounds: { west: 0, east: 4, south: 0, north: 4 } };
const pc = peopleOnGrid(pop, coarse);
ok("a coarser grid sums its population cells", close(pc[0], 1 + 2 + 5 + 6) && close(pc[3], 11 + 12 + 15 + 16));
ok("and conserves the total", close(pc.reduce((a, b) => a + b, 0), popTotal));

// A grid covering HALF a population cell takes half its people, not all of
// them: the edge of a hazard grid must not inflate.
{
  const edge = { width: 2, height: 4, bounds: { west: 0, east: 0.5, south: 3, north: 4 } };
  const pe = peopleOnGrid(pop, edge);
  ok("a grid over half a population cell takes half of it", close(pe.reduce((a, b) => a + b, 0), 1 / 2), `${pe.reduce((a, b) => a + b, 0)}`);
}

// A misaligned finer grid over half the window takes only what is under it.
const half = { width: 8, height: 8, bounds: { west: 0, east: 2, south: 2, north: 4 } };
const ph = peopleOnGrid(pop, half);
ok("a grid over part of the window takes that part's people", close(ph.reduce((a, b) => a + b, 0), 1 + 2 + 5 + 6));

// No data is nobody.
const holey = { ...pop, band: Float32Array.from(pop.band) };
holey.band[0] = -3.4e38; holey.band[1] = NaN;
ok("no-data cells carry nobody", close(peopleOnGrid(holey, coarse)[0], 5 + 6));

// The polygon: a square over the western half (0..2°E, full height).
const square = { type: "FeatureCollection", features: [{ type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]] } }] };
const polys = polygonsOf(square);
ok("a point inside the square is inside", inPolygon(1, 1, polys[0].coords));
ok("a point outside it is not", !inPolygon(3, 1, polys[0].coords));
const mask = polygonMask(fine, polys);
const people = pf;
const westHalf = [1, 2, 5, 6, 9, 10, 13, 14].reduce((a, b) => a + b, 0);
const inside = people.reduce((a, p, i) => a + (mask[i] ? p : 0), 0);
ok("the polygon's people are the western half's", close(inside, westHalf), `${inside} vs ${westHalf}`);

// Exposure by class on a FoS-like grid: everything north of 2°N fails.
const fos = new Float32Array(fine.width * fine.height);
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) fos[y * 16 + x] = y < 8 ? 0.8 : 2;
const ex = gridExposure({ people, values: fos, mask, width: 16, classes: ["Failing", "Marginal"],
  classOf: (v) => (v < 1 ? 0 : v < 1.5 ? 1 : -1) });
ok("the total is the polygon's people", close(ex.total, westHalf));
ok("the failing class holds the northern half of the polygon", close(ex.byClass[0].people, 1 + 2 + 5 + 6), `${ex.byClass[0].people}`);
ok("exposed is the sum of the classes", close(ex.exposed, ex.byClass.reduce((a, c) => a + c.people, 0)));
ok("the edge share is a share", ex.edgeShare > 0 && ex.edgeShare <= 1);

// A probability map: two risk cells, west p = 0.1, east p = 0.01; the study
// area is the western square, so every person inside meets p = 0.1.
const risk = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { p_yr: 0.1 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]] } },
  { type: "Feature", properties: { p_yr: 0.01 }, geometry: { type: "Polygon", coordinates: [[[2, 0], [4, 0], [4, 4], [2, 4], [2, 0]]] } },
] };
const idx = polygonIndex(polygonsOf(risk));
const re = riskExposure({ pop, polys, index: idx, edges: [0.02, 0.2], labels: ["rarer", "1 in 5–50", "commoner"] });
ok("expected people a year is Σ people × p", close(re.expectedPerYear, westHalf * 0.1));
ok("everyone falls in the class their p is in", close(re.byClass[1].people, westHalf) && re.byClass[0].people === 0);
ok("nobody is uncovered where the map covers the area", re.uncovered === 0);

ok("formatPeople says thousands", formatPeople(12345) === "12 thousand" && formatPeople(1234) === "1.2 thousand");
ok("formatPeople says fewer than one", formatPeople(0.3) === "<1");
const csv = seriesCsv({ times: ["2026-01-01T00:00"], total: 100.4, series: [{ label: "FoS < 1", values: [12.6] }] });
ok("the CSV has a row per map and a column per class", csv.trim().split("\n")[1] === "2026-01-01T00:00,100,13");
