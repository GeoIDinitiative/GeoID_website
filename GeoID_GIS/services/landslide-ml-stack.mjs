#!/usr/bin/env node
/**
 * The landslide bake's door into viewer/gis/landslide-ml.js -- flood-ml-stack.mjs
 * for the landslide features (relief and GLiM lithology on top of the flood
 * stack). Same job directory layout; job.glim names the GLiM asset file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeGrid, demOnGrid, soilOnGrid, latticeOnGrid } from "../viewer/gis/flood-ml.js";
import { buildLandslideStack, LS_FEATURES } from "../viewer/gis/landslide-ml.js";

const dir = process.argv[2];
const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
const f32 = (name) => { const b = readFileSync(join(dir, name)); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const grid = makeGrid(job.grid, job.grid.cell);
const dem = demOnGrid(f32("dem_mosaic.f32"), job.plan, grid);
const soil = job.soil === "window"
  ? soilOnGrid({ ...job.soilWindow, band: new Uint8Array(readFileSync(join(dir, "soil_window.u8"))) }, grid)
  : f32("soil.f32").slice();
const glim = JSON.parse(readFileSync(job.glim, "utf8"));
const { stack, mask, land, fills } = buildLandslideStack({
  grid, dem, lcClasses: new Uint8Array(readFileSync(join(dir, "lc.u8"))), lcK: job.lcK, soil,
  rainNormal: latticeOnGrid(f32(job.rain.normal.file), job.rain.normal.lattice, grid), glim,
});
const n = grid.width * grid.height;
const out = new Float32Array(n * LS_FEATURES.length);
LS_FEATURES.forEach((name, k) => out.set(stack[name], k * n));
writeFileSync(join(dir, "features.f32"), Buffer.from(out.buffer));
writeFileSync(join(dir, "mask.u8"), Buffer.from(mask.buffer));
writeFileSync(join(dir, "stack.json"), JSON.stringify({ grid, features: LS_FEATURES, land, fills }));
