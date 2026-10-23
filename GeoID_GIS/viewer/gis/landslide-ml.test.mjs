/**
 * The landslide forest's features: relief against brute force, GLiM's class
 * one-hot at the right cell, the stack masking sea, and -- once the bake has
 * exported a forest -- the page's evaluator against scikit-learn on its check
 * rows. The flood stack underneath is pinned by flood-ml.test.mjs.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGrid, decodeForest, predictForest } from "./flood-ml.js";
import { relief, reliefRadius, lithologyOnGrid, buildLandslideStack, landslideRows, LS_FEATURES, GLIM_GROUPS }
  from "./landslide-ml.js";

const HERE = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); } catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}`); }
}
function ok(c, what) { if (!c) throw new Error(what); }

check("relief is the height range within r cells, over land only", () => {
  const g = makeGrid({ west: 0, east: 0.012, south: 0, north: 0.009 }, 0.001);
  const n = g.width * g.height;
  const dem = new Float32Array(n).map((_, i) => ((i * 37) % 23) * 1.5);
  const mask = new Uint8Array(n).map((_, i) => (i % 11 === 0 ? 0 : 1));
  const r = 2;
  const out = relief(dem, mask, g, r);
  for (let y = 0; y < g.height; y += 1) {
    for (let x = 0; x < g.width; x += 1) {
      const i = y * g.width + x;
      if (!mask[i]) { ok(Number.isNaN(out[i]), `sea cell ${i} has relief`); continue; }
      let hi = -Infinity; let lo = Infinity;
      for (let yy = Math.max(0, y - r); yy <= Math.min(g.height - 1, y + r); yy += 1) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(g.width - 1, x + r); xx += 1) {
          const j = yy * g.width + xx;
          if (mask[j]) { hi = Math.max(hi, dem[j]); lo = Math.min(lo, dem[j]); }
        }
      }
      ok(Math.abs(out[i] - (hi - lo)) < 1e-4, `cell ${i}: ${out[i]} vs ${hi - lo}`);
    }
  }
});

check("the relief window is ~1 km, at least one cell", () => {
  ok(reliefRadius(makeGrid({ west: 0, east: 1, south: 50, north: 51 }, 0.0025)) === 6, "250 m");
  ok(reliefRadius(makeGrid({ west: 0, east: 10, south: 0, north: 10 }, 0.1)) === 1, "0.1°");
});

check("GLiM's dominant class lands one-hot in its group at the nearest 0.5° cell", () => {
  const glim = { lattice: { nLat: 2, nLon: 2, lat0: 50.75, lon0: 0.25, dLat: -0.5, dLon: 0.5 }, values: [8, 6, 16, -9999] };
  const g = makeGrid({ west: 0.1, east: 0.9, south: 50.1, north: 50.9 }, 0.2);
  const lith = lithologyOnGrid(glim, g);
  const at = (lon, lat) => { const c = Math.floor((lon - g.west) / g.cell); const r = Math.floor((g.north - lat) / g.cell); return r * g.width + c; };
  ok(lith.lith_metamorphic[at(0.3, 50.7)] === 1 && lith.lith_carbonate[at(0.3, 50.7)] === 0, "NW cell should be metamorphic");
  ok(lith.lith_carbonate[at(0.7, 50.7)] === 1, "NE cell should be carbonate");
  ok(Object.keys(GLIM_GROUPS).every((k) => lith[k][at(0.3, 50.3)] === 0), "ice (16) should set no group");
});

check("the landslide stack masks sea and every feature is finite on land", () => {
  const g = makeGrid({ west: 0, east: 0.02, south: 0, north: 0.02 }, 0.001);
  const n = g.width * g.height;
  const dem = new Float32Array(n).map((_, i) => (i % g.width < 3 ? -40 : 5 + (i % g.width) * 2));
  const k = 2;
  const glim = { lattice: { nLat: 1, nLon: 1, lat0: 0.25, lon0: 0.25, dLat: -0.5, dLon: 0.5 }, values: [3] };
  const { stack, mask, land } = buildLandslideStack({ grid: g, dem, lcClasses: new Uint8Array(n * k * k).fill(2), lcK: k,
    soil: new Float32Array(n).fill(4), rainNormal: new Float32Array(n).fill(900), glim });
  ok(land === n - 3 * g.height, `land ${land}`);
  const cells = [...Array(n).keys()].filter((i) => mask[i]);
  const { rows, dropped } = landslideRows(stack, cells);
  ok(dropped === 0 && rows.length === cells.length * LS_FEATURES.length, `dropped ${dropped}`);
  ok(stack.lith_siliciclastic[cells[0]] === 1 && Number.isNaN(stack.lith_siliciclastic[0]), "lithology masked");
});

for (const tier of ["fine", "coarse"]) {
  const local = join(HERE, `../../../data/global/landslide-ml/forest-${tier}.json`);
  const main = `/home/owen/GeoID_webpage_v1/data/global/landslide-ml/forest-${tier}.json`;
  const file = existsSync(local) ? local : existsSync(main) ? main : null;
  check(`the ${tier} landslide forest gives scikit-learn's own answers${file ? "" : " (not baked here; skipped)"}`, () => {
    if (!file) return;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    ok(JSON.stringify(doc.features) === JSON.stringify(LS_FEATURES), "feature order differs from landslide-ml.js");
    const p = predictForest(decodeForest(doc), new Float32Array(doc.check.rows.flat()), LS_FEATURES.length);
    doc.check.proba.forEach((q, i) => ok(Math.abs(p[i] - q) < 1e-5, `row ${i}: ${p[i]} vs ${q}`));
  });
}

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
