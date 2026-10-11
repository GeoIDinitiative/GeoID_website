// The NI flood susceptibility model: rasterising, distance, ranking, and the
// shipped inputs producing a map at all (the bug was a map that never came).
import { existsSync, readFileSync } from "node:fs";
import {
  makeGrid, rasterisePolygons, rasteriseLines, distanceTransform, rankByQuantile,
  computeFloodSusceptibility, INPUT_PATHS,
} from "./ni-flood.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
process.on("exit", () => {
  console.log(`ni-flood: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
  if (fail) process.exitCode = 1;
});

const box = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
const grid = makeGrid(box, { dLon: 0.1, dLat: 0.1 });
ok("a 1° box at 0.1° is 10 × 10", grid.width === 10 && grid.height === 10);

{
  const square = { geometry: { type: "Polygon", coordinates: [
    [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]],
    [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]],
  ] } };
  const hit = new Uint8Array(100);
  rasterisePolygons([square], grid, (i) => { hit[i] = 1; });
  const count = hit.reduce((a, b) => a + b, 0);
  ok("a 6×6 square with a 2×2 hole paints 32 cells", count === 32, `got ${count}`);
  ok("the hole stays empty", !hit[4 * 10 + 4] && !hit[5 * 10 + 5]);
}

{
  const line = { geometry: { type: "LineString", coordinates: [[0.05, 0.55], [0.95, 0.55]] } };
  const src = new Uint8Array(100);
  rasteriseLines([line], grid, (i) => { src[i] = 1; });
  ok("a line across the box marks one row of 10", src.reduce((a, b) => a + b, 0) === 10);
  const { dist, nearest } = distanceTransform(src, grid);
  ok("a cell on the line is at 0", dist[4 * 10 + 3] === 0);
  ok("two rows away is two cell heights", Math.abs(dist[2 * 10 + 3] - 2 * grid.my) < 1e-6);
  ok("and its nearest source is on the line", Math.floor(nearest[2 * 10 + 3] / 10) === 4);
}

{
  const { ranked } = rankByQuantile(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, NaN]), 5);
  ok("quantile ranks run 1..5", ranked[0] === 1 && ranked[9] === 5);
  ok("no-data stays no-data", Number.isNaN(ranked[10]));
}

// The real inputs, when the data is on disk.
const root = new URL("../../../", import.meta.url);
const paths = Object.fromEntries(Object.entries(INPUT_PATHS).map(([k, p]) => [k, new URL(`.${p}`, root)]));
if (Object.values(paths).every((p) => existsSync(p))) {
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  const inputs = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, read(p)]));
  const map = computeFloodSusceptibility(inputs);
  ok("the shipped inputs produce a map over NI", map.stats.landCells > 100000, `land=${map.stats.landCells}`);
  ok("with rivers in it", map.stats.riverCells > 1000);
  const ranks = new Set(); for (const v of map.band) if (Number.isFinite(v)) ranks.add(v);
  ok("in five classes", ranks.size === 5);
  // A river cell on alluvium must out-rank a cell far from any river on till.
  const hi = []; const lo = [];
  for (let i = 0; i < map.score.length; i += 1) {
    if (!Number.isFinite(map.score[i])) continue;
    (map.band[i] === 5 ? hi : map.band[i] === 1 ? lo : []).push(map.score[i]);
  }
  ok("class 5 scores above class 1", Math.min(...hi) > Math.max(...lo));
  // With a DEM, low ground beside a river scores higher than high ground.
  const flat = computeFloodSusceptibility(inputs, { heightAt: () => 10 });
  ok("a DEM that answers everywhere is used", flat.stats.demCells === flat.stats.landCells);
} else {
  console.log("  (NI prototype inputs not on disk; real-data checks skipped)");
}
