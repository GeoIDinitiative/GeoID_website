/**
 * The Mogi source against its own closed form, and an inversion that must
 * recover the source it was given.
 */
import { mogi, volumeFromPressure, shearModulus, bestVolume, invertMogi, topSurfaceNodes } from "./analytic-sources.js";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass += 1; else failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(a), Math.abs(b));

const src = { x0: 0, y0: 0, depth: 5000, dV: 1e7, nu: 0.25 };
const above = mogi(src, 0, 0);
check("mogi: over the source, u_z = (1 − ν) ΔV / (π d²) and nothing horizontal", near(above[2], (0.75 * 1e7) / (Math.PI * 25e6)) && above[0] === 0 && above[1] === 0);
const at = mogi(src, 5000, 0);
check("mogi: at r = d the horizontal equals the vertical, each 1/2^1.5 of the peak", near(at[0], at[2]) && near(at[2], above[2] / 2 ** 1.5));
const r = mogi(src, 3000, 4000);
check("mogi: the horizontal points away from the source, radially", r[0] > 0 && r[1] > 0 && near(r[1] / r[0], 4 / 3));
check("mogi: a deflating source subsides", mogi({ ...src, dV: -1e7 }, 100, 0)[2] < 0);
check("mogi: far away it falls as 1/r² (u_r) — ratio 4 from r to 2r at r ≫ d", near(mogi(src, 2e5, 0)[0] / mogi(src, 4e5, 0)[0], 4, 1e-3));
check("pressure: ΔV = π a³ ΔP / G, and G = E / 2(1 + ν)", near(volumeFromPressure(1e7, 1000, 1e10), Math.PI * 1e9 * 1e-3) && near(shearModulus(25e9, 0.25), 10e9));

// Synthetic GNSS from a known source, sigmas and all.
const truth = { x0: 1200, y0: -800, depth: 6300, dV: 2.4e7, nu: 0.25 };
const stations = [];
for (let i = -3; i <= 3; i += 1) for (let j = -3; j <= 3; j += 1) {
  const x = i * 3000; const y = j * 3000;
  stations.push({ x, y, obs: mogi(truth, x, y), sigma: [0.002, 0.002, 0.004] });
}
const fixed = bestVolume(stations, truth);
check("best volume: at the true position and depth, ΔV is recovered and nothing is left", near(fixed.dV, truth.dV, 1e-9) && fixed.misfit < 1e-12 && near(fixed.explained, 1, 1e-9));

const inv = invertMogi(stations, { depthRange: [500, 20000], nu: 0.25 });
check("invert: position within 1% of the depth, depth and ΔV within 1%", Math.hypot(inv.x0 - truth.x0, inv.y0 - truth.y0) < 0.01 * truth.depth && Math.abs(inv.depth / truth.depth - 1) < 0.01 && Math.abs(inv.dV / truth.dV - 1) < 0.01, JSON.stringify({ x0: inv.x0, y0: inv.y0, depth: inv.depth, dV: inv.dV }));
const lowest = inv.curve.reduce((a, b) => (b.misfit < a.misfit ? b : a));
check("invert: the misfit along depth is lowest near the true depth", Math.abs(lowest.depth / truth.depth - 1) < 0.1);

// Line of sight only: Sentinel-1 ascending.
const los = [-0.615, -0.131, 0.777];
const losStations = stations.map((s) => ({ x: s.x, y: s.y, obs: [s.obs[0] * los[0] + s.obs[1] * los[1] + s.obs[2] * los[2]], sigma: [0.005] }));
const invLos = invertMogi(losStations, { depthRange: [500, 20000], los });
check("invert: line-of-sight data alone recover the source", Math.abs(invLos.depth / truth.depth - 1) < 0.02 && Math.abs(invLos.dV / truth.dV - 1) < 0.03, JSON.stringify({ depth: invLos.depth, dV: invLos.dV }));
check("invert: fewer than two stations is no answer", invertMogi(stations.slice(0, 1)) === null);

// A box: a top at z = 0 with a bump, walls, and a base at z = -100.
const coords = [];
const surf = [];
let id = 0;
for (let i = 0; i <= 10; i += 1) for (let j = 0; j <= 10; j += 1) {
  coords.push(i * 10, j * 10, i === 5 && j === 5 ? 3 : 0); surf.push(id++);
  coords.push(i * 10, j * 10, -100); surf.push(id++);
}
const bounds = { min: [0, 0, -100], max: [100, 100, 3] };
const top = topSurfaceNodes(new Float64Array(coords), Int32Array.from(surf), bounds, { cells: 11, wallMargin: 0.05 });
check("top surface: the highest node per plan cell, no base, no wall", top.length === 81 && top.every((i) => coords[i * 3 + 2] >= 0));

const shallow = invertMogi(stations, { depthRange: [500, 3000] });
check("invert: refinement never leaves the depth range, and a best depth on its edge says so", shallow.depth <= 3000 * (1 + 1e-9) && shallow.atEdge.depth === true && inv.atEdge.depth === false && inv.atEdge.position === false);
const boxed = invertMogi(stations, { bounds: { minX: 5000, maxX: 9000, minY: -9000, maxY: 9000 }, depthRange: [500, 20000] });
check("invert: nor the position bounds", boxed.x0 >= 5000 && boxed.x0 <= 9000 && boxed.atEdge.position === true);
check("invert: says whether its misfit is weighted (χ²) or in the data's own units", inv.weighted === true && invertMogi(stations.map((st) => ({ ...st, sigma: null })), { depthRange: [500, 20000] }).weighted === false);
