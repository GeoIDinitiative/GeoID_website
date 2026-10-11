/** The published risk grids read at a point. Run: node background-risk.test.mjs */
import { boxOf, cellIndex, cellAt, GRIDS } from "./background-risk.js";

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass += 1; else { fail += 1; console.error("FAIL:", m); } };
process.on("exit", () => { console.log(`background-risk: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });

const cell = (w, s, e, n, p) => ({ type: "Feature", properties: { p_yr: p }, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
const big = cell(0, 0, 8, 8, 0.01);
const small = cell(2, 2, 2.5, 2.5, 0.2);
ok(JSON.stringify(boxOf(big)) === JSON.stringify({ w: 0, e: 8, s: 0, n: 8 }), "a cell's box is its rectangle");
const idx = cellIndex([big, small, cell(-10, -10, -9, -9, 0.5)]);
ok(cellAt(idx, 2.2, 2.2).p === 0.2, "the smallest containing cell is the finest answer");
ok(cellAt(idx, 5, 5).p === 0.01, "elsewhere the coarse cell answers");
ok(cellAt(idx, 20, 20) === null, "a place no event reached has no cell");
ok(cellAt(idx, -9.5, -9.5).p === 0.5, "negative degrees bucket by floor");
ok(GRIDS.map((g) => g.id).join() === "cyclone,seismic,volcanic", "three grids");
ok(GRIDS[0].layer.test("Cyclone risk — chance of a storm within 200 km") && !GRIDS[1].layer.test("Earthquakes (USGS ComCat)"), "a ticked layer is matched to its grid by name");
