/**
 * The rock model: Hoek–Brown, Culmann, the joint water, the slope's height and
 * rockfall reach, each against a closed form or a brute-force answer; and the
 * two models side by side in the pipeline. Run with `node rock-slope.test.mjs`.
 */
import { readFileSync } from "node:fs";
import {
  hoekBrown, equivalentMohrCoulomb, culmann, culmannAt, criticalHeight, jointWater, localRelief, rockfallReach, velocityOf, rockCell,
} from "./rock-slope.js";
import { mfdTopology, fillSinks } from "./hydrology.js";
import { makeRaster } from "./raster-analysis.js";
import { stationStep, upslopeWeights } from "./landslide-stations.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`rock-slope: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

const R = Math.PI / 180;

/* ── the rock mass ─────────────────────────────────────────────────────────── */

{
  const intact = hoekBrown({ gsi: 100, mi: 10 });
  check("an unjointed rock mass is the intact rock: s = 1, mb = mi, a = ½", Math.abs(intact.s - 1) < 1e-12 && Math.abs(intact.mb - 10) < 1e-12 && Math.abs(intact.a - 0.5) < 1e-3);
  const poor = hoekBrown({ gsi: 25, mi: 10 }); const good = hoekBrown({ gsi: 75, mi: 10 });
  check("a worse rock mass is weaker in every constant", poor.mb < good.mb && poor.s < good.s && poor.a > good.a);
  const mud = equivalentMohrCoulomb({ sci: 25, gsi: 45, mi: 4, gamma: 23, H: 100 });
  const gran = equivalentMohrCoulomb({ sci: 180, gsi: 65, mi: 32, gamma: 26, H: 100 });
  check("a mudstone mass is far weaker than a granite one", mud.c < gran.c / 3 && mud.phi < gran.phi, `${mud.c.toFixed(0)}/${mud.phi.toFixed(1)} vs ${gran.c.toFixed(0)}/${gran.phi.toFixed(1)}`);
  check("and the numbers are a rock mass's, not the intact rock's (c′ hundreds of kPa for mudstone)", mud.c > 100 && mud.c < 2000 && mud.phi > 20 && mud.phi < 45);
  const low = equivalentMohrCoulomb({ sci: 25, gsi: 45, mi: 4, gamma: 23, H: 20 });
  const high = equivalentMohrCoulomb({ sci: 25, gsi: 45, mi: 4, gamma: 23, H: 500 });
  check("a higher slope loads the mass harder: more cohesion, less friction — the curved envelope", high.c > low.c && high.phi < low.phi);
}

/* ── Culmann ───────────────────────────────────────────────────────────────── */

{
  const m = equivalentMohrCoulomb({ sci: 25, gsi: 45, mi: 4, gamma: 23, H: 100 });
  const beta = 60 * R;
  const Hc = criticalHeight({ betaRad: beta, c: m.c, phi: m.phi, gamma: 23 });
  const atHc = culmann({ H: Hc, betaRad: beta, c: m.c, phi: m.phi, gamma: 23 });
  check("at Culmann's critical height the factor of safety is 1", Math.abs(atHc.fos - 1) < 1e-6, String(atHc.fos));
  check("on the plane halfway between the face and the friction angle", Math.abs(atHc.theta - (60 + m.phi) / 2) < 0.01, `${atHc.theta} vs ${(60 + m.phi) / 2}`);
  const f = (th, H, b, ru) => (2 * m.c * Math.sin(b)) / (23 * H * Math.sin(th) * Math.sin(b - th)) + (1 - ru) * Math.tan(m.phi * R) / Math.tan(th);
  let brute = Infinity; for (let t = 1e-3; t < 45 * R; t += 1e-5) brute = Math.min(brute, f(t, 200, 45 * R, 0.2));
  const got = culmann({ H: 200, betaRad: 45 * R, c: m.c, phi: m.phi, gamma: 23, ru: 0.2 });
  check("the bisection finds the minimum a brute-force search does", Math.abs(got.fos - brute) < 1e-4, `${got.fos} vs ${brute}`);
  check("water in the joints lowers it, a higher slope lowers it, a gentler face raises it",
    got.fos < culmann({ H: 200, betaRad: 45 * R, c: m.c, phi: m.phi, gamma: 23 }).fos
    && culmann({ H: 400, betaRad: 45 * R, c: m.c, phi: m.phi, gamma: 23 }).fos < culmann({ H: 200, betaRad: 45 * R, c: m.c, phi: m.phi, gamma: 23 }).fos
    && culmann({ H: 200, betaRad: 30 * R, c: m.c, phi: m.phi, gamma: 23 }).fos > culmann({ H: 200, betaRad: 45 * R, c: m.c, phi: m.phi, gamma: 23 }).fos);
  check("flat or height-less ground cannot slide: the cap", culmann({ H: 0, betaRad: 30 * R, c: 100, phi: 30, gamma: 23 }).fos === 100
    && culmann({ H: 50, betaRad: 0, c: 100, phi: 30, gamma: 23 }).fos === 100);

  // The per-map evaluation on the dry plane against re-minimising, across the range.
  let worst = 0;
  for (const [sci, gsi, mi, gm] of [[25, 45, 4, 23], [70, 55, 17, 23], [180, 65, 32, 26], [5, 25, 4, 21]]) {
    for (const H of [20, 150, 900]) for (const bd of [25, 45, 65, 75]) for (const ru of [0.05, 0.2, 0.25]) {
      const e = equivalentMohrCoulomb({ sci, gsi, mi, gamma: gm, H });
      const dry = culmann({ H, betaRad: bd * R, c: e.c, phi: e.phi, gamma: gm });
      const wet = culmann({ H, betaRad: bd * R, c: e.c, phi: e.phi, gamma: gm, ru });
      if (wet.fos >= 100) continue;
      const at = culmannAt({ H, betaRad: bd * R, c: e.c, phi: e.phi, gamma: gm, ru, thetaRad: dry.theta * R });
      worst = Math.max(worst, (at - wet.fos) / wet.fos);
    }
  }
  check("keeping each cell's dry plane for the wet maps overestimates by under half a percent", worst >= 0 && worst < 0.005, `${(worst * 100).toFixed(3)} %`);
}

/* ── joint water ───────────────────────────────────────────────────────────── */

{
  const dry = jointWater({ q: 0, b: 30, K: 1e-7, betaRad: 40 * R, gamma: 25 });
  const wet = jointWater({ q: 1, b: 30, K: 1e-7, betaRad: 40 * R, gamma: 25 });
  check("no recharge, no joint water; a flood of it saturates, and r_u is then γw/2γ", dry.ru === 0 && wet.W === 1 && Math.abs(wet.ru - 9.81 / 50) < 1e-12);
}

/* ── the slope's height ─────────────────────────────────────────────────────── */

{
  const w = 9; const h = 7;
  const band = new Float32Array(w * h).map((_, i) => 100 + (i % w) * 10 + Math.floor(i / w));
  band[3 * w + 4] = NaN;
  const r = 2;
  const got = localRelief(band, w, h, r);
  let bad = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x;
    if (!Number.isFinite(band[i])) { if (Number.isFinite(got[i])) bad += 1; continue; }
    let m = Infinity;
    for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy += 1) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx += 1) {
      const v = band[yy * w + xx]; if (Number.isFinite(v)) m = Math.min(m, v);
    }
    if (Math.abs(got[i] - (band[i] - m)) > 1e-4) bad += 1;
  }
  check("each cell's height above the lowest ground within the window, edges and holes included", bad === 0, `${bad} wrong`);
}

/* ── rockfall reach ────────────────────────────────────────────────────────── */

{
  // A cliff falling onto a gentle apron: 10 m cells, a 60 m face then 5 % down to the east.
  const w = 60; const h = 3; const cell = 10;
  const band = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = x < 3 ? 200 - x * 20 : 140 - (x - 3) * 0.5;
  const filled = fillSinks(makeRaster(band, w, h, { minX: 0, maxX: w * 1e-4, minY: 0, maxY: h * 1e-4 }, NaN));
  const topo = mfdTopology(filled);
  const sources = new Uint8Array(w * h); sources[1 * w + 0] = 1;
  const E = rockfallReach({ band: filled.band, width: w, topo, sources, reachDeg: 32, cellM: 10 });
  let last = -1; for (let x = 0; x < w; x += 1) if (Number.isFinite(E[1 * w + x])) last = x;
  // The energy line from 200 m at tan 32° meets ground 140 − 0.5(x−3) where 200 − 0.625·10x ≥ ground.
  let expect = -1; for (let x = 0; x < w; x += 1) { const ground = band[1 * w + x]; if (200 - Math.tan(32 * R) * cell * x >= ground - 1e-6) expect = x; }
  check("a block runs out until the line from its source at the reach angle meets the ground", last === expect && last > 3, `${last} vs ${expect}`);
  const E2 = rockfallReach({ band: filled.band, width: w, topo, sources, reachDeg: 28, cellM: 10 });
  let last2 = -1; for (let x = 0; x < w; x += 1) if (Number.isFinite(E2[1 * w + x])) last2 = x;
  check("a lower reach angle runs further", last2 > last, `${last2} vs ${last}`);
  check("the speed at the foot of the face is the energy line's height above it", Math.abs(velocityOf(E[1 * w + 3]) - Math.sqrt(2 * 9.81 * E[1 * w + 3])) < 1e-9 && E[1 * w + 3] > 0);
}

/* ── the two models in the pipeline ────────────────────────────────────────── */

{
  const w = 20; const h = 21; const n = w * h; const cellM = 1e-4 * 111320; const tan = Math.tan(40 * R);
  const band = new Float32Array(n);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = 300 - 0.1 * cellM * x + tan * cellM * Math.abs(y - 10);
  const topo = mfdTopology(fillSinks(makeRaster(band, w, h, { minX: 0, maxX: w * 1e-4, minY: 0, maxY: h * 1e-4 }, NaN)));
  const cells = {
    data: new Uint8Array(n).fill(1), model: new Uint8Array(n).fill(1), K: new Float32Array(n).fill(2e-5), zs: new Float32Array(n).fill(2),
    zf: new Float32Array(n).fill(1.5), slopeRad: new Float32Array(n).fill(Math.atan(tan)), c: new Float32Array(n).fill(3), phi: new Float32Array(n).fill(32), gamma: new Float32Array(n).fill(19),
  };
  const rainMm = Float32Array.from({ length: n }, (_, i) => 20 + (i % 13));
  const cell = 9 * w + 15;
  const m = equivalentMohrCoulomb({ sci: 25, gsi: 45, mi: 4, gamma: 23, H: 120 });
  const dry = culmann({ H: 120, betaRad: Math.atan(tan), c: m.c, phi: m.phi, gamma: 23 });
  const rock = { c: m.c, phi: m.phi, gamma: 23, K: 1e-7, H: 120, thetaRad: dry.theta * R };
  const out = stationStep({ cell, weights: upslopeWeights(topo, cell), rainMm, windowH: 24, cells, topo, lateral: 1, rock });
  const q = (out.qb * topo.contour) / 86400;
  const direct = rockCell({ q, contour: topo.contour, betaRad: Math.atan(tan), ...rock });
  // To Float32: the station reads its slope out of the model's own array.
  check("a station's rock slope is the map's own per-cell answer under the same recharge",
    Math.abs(out.rockFos - direct.fos) / direct.fos < 1e-6 && Math.abs(out.ru - direct.ru) < 1e-12 && out.ru > 0,
    `${out.rockFos} vs ${direct.fos}`);
  check("and where there is no rock it says so rather than inventing one", Number.isNaN(stationStep({ cell, weights: upslopeWeights(topo, cell), rainMm, windowH: 24, cells, topo }).rockFos));

  const { modeOf, MODE_CLASSES } = await import("./landslide-pipeline.js");
  check("the governing mode puts a rockfall source first, then either model failing, then runout, then marginal, then stable",
    MODE_CLASSES[modeOf({ source: 1, rock: 5, soil: 0.5 })].key === "source"
    && MODE_CLASSES[modeOf({ rock: 0.9, soil: 0.5 })].key === "rock"
    && MODE_CLASSES[modeOf({ rock: 2, soil: 0.8 })].key === "soil"
    && MODE_CLASSES[modeOf({ rock: 2, soil: 0.8, exposed: 1, reached: true })].key === "runout"
    && MODE_CLASSES[modeOf({ rock: 1.2, soil: 5 })].key === "rockm"
    && MODE_CLASSES[modeOf({ rock: 3, soil: 1.2 })].key === "soilm"
    && MODE_CLASSES[modeOf({ rock: 3, soil: 3 })].key === "stable");
  check("on bare rock the soil model does not speak", MODE_CLASSES[modeOf({ rock: 3, soil: 0.4, exposed: 1 })].key === "stable");

  const src = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  check("the rock model reads the BEDROCK map, never the deposit over it", /const bedLith = bedAt \? bedAt\(lat, lon\) : null;/.test(src) && /props\.rock\[j\] = rocks\.indexOf\(bedLith\);/.test(src));
  check("an unconsolidated bedrock is not rock", /st === "soil"\s*\n\s*\? \{ name: text, lith, rock: false/.test(src));
  check("each map evaluates the rock under its own routed recharge", /out\.rockFos = rockFrame\(out\.q\);/.test(src));
  check("the soil model is silenced on bare rock, and the map opens on the governing mode",
    /value: \(i, fo, rk\) => \(rk\?\.exposed\[i\] \? -1 : fo\.fos\[i\]\)/.test(src) && /view: "mode"/.test(src));
  check("rockfall runs on the sink-filled DEM the flow network was built on", /rockfallReach\(\{ band: g\.filled,/.test(src));
}
