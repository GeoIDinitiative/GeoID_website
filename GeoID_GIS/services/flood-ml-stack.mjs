#!/usr/bin/env node
/**
 * The bake's door into viewer/gis/flood-ml.js: the features are computed by
 * the page's own module, so the forest is trained on exactly what the page
 * will feed it.
 *
 *   node flood-ml-stack.mjs <job-dir>
 *
 * <job-dir>/job.json      { grid: {west,east,south,north,cell}, plan, lcK,
 *                           soil: "grid"|"window", soilWindow?, }
 * <job-dir>/dem_mosaic.f32  decoded Terrarium mosaic (plan.cols*256 x plan.rows*256)
 * <job-dir>/lc.u8           land-cover classes at lcK pixels per cell
 * <job-dir>/soil.*          soil.f32 on the grid, or soil_window.u8 (native)
 * <job-dir>/<file>.f32      job.rain.{normal,r3,r30} = {file, lattice} -- each a field on
 *                           its own regular lon/lat lattice, put on the grid by
 *                           latticeOnGrid exactly as the page does
 *
 * Writes <job-dir>/features.f32 (FEATURES planes, each width*height),
 * mask.u8 and stack.json (grid, feature names, land count, gap fills).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeGrid, demOnGrid, buildStack, soilOnGrid, latticeOnGrid, FEATURES } from "../viewer/gis/flood-ml.js";

const dir = process.argv[2];
const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
const f32 = (name) => { const b = readFileSync(join(dir, name)); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const grid = makeGrid(job.grid, job.grid.cell);
const dem = demOnGrid(f32("dem_mosaic.f32"), job.plan, grid);
const onGrid = (spec) => latticeOnGrid(f32(spec.file), spec.lattice, grid);
const lcBytes = readFileSync(join(dir, "lc.u8"));
const soil = job.soil === "window"
  ? soilOnGrid({ ...job.soilWindow, band: new Uint8Array(readFileSync(join(dir, "soil_window.u8"))) }, grid)
  : f32("soil.f32").slice();
const { stack, mask, land, fills } = buildStack({
  grid, dem, lcClasses: new Uint8Array(lcBytes), lcK: job.lcK, soil,
  rainNormal: onGrid(job.rain.normal), rain3: onGrid(job.rain.r3), rain30: onGrid(job.rain.r30),
});
const n = grid.width * grid.height;
const out = new Float32Array(n * FEATURES.length);
FEATURES.forEach((name, k) => out.set(stack[name], k * n));
writeFileSync(join(dir, "features.f32"), Buffer.from(out.buffer));
writeFileSync(join(dir, "mask.u8"), Buffer.from(mask.buffer));
writeFileSync(join(dir, "stack.json"), JSON.stringify({ grid, features: FEATURES, land, fills }));
