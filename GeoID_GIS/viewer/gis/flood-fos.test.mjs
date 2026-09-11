/**
 * The flood model, against answers worked out by hand.
 *
 * The two that matter most are the ones a plausible-looking wrong model would
 * still pass the others with: MASS is conserved by the wave (what goes in
 * leaves or is still held, to the drop), and the wave's STEADY STATE is the
 * static model's own routed flux — so the flood model and the slope model
 * cannot disagree about how much water is moving, only about when.
 */

import { readFileSync } from "node:fs";
import {
  bankfullCapacity, partition, cellVelocity, residenceTimes, waveStep, floodFos, riseFor,
  floodClass, FLOOD_CLASSES, RUNOFF_CLASSES, DISCHARGE_CLASSES, BANKFULL_RATIO,
  CHANNEL_V_COEF, CHANNEL_V_EXP, HILLSLOPE_V, V_MIN, V_MAX,
} from "./flood-fos.js";
import { meanFlowFromWidth, channelDepth, DEPTH_EXPONENT } from "./inundation.js";
import { mfdTopology, routeFlux, fillSinks } from "./hydrology.js";
import { makeRaster } from "./raster-analysis.js";
import { FOS_CAP } from "./slope-hydrology.js";

let pass = 0; let fail = 0;
const check = (name, ok) => { if (ok) { pass += 1; } else { fail += 1; console.log(`  FAIL ${name}`); } };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/* ── capacity ──────────────────────────────────────────────────────────── */
{
  // w = 7.2 Q^0.5, so 7.2 m of width is 1 m³/s of mean flow and 5 at the brim.
  check("a 7.2 m river has a mean flow of 1 m3/s", near(meanFlowFromWidth(7.2), 1, 1e-12));
  check("bankfull is the annual flood's multiple of it", near(bankfullCapacity(7.2), BANKFULL_RATIO, 1e-12));
  check("and width grows as the square root of it", near(bankfullCapacity(72), BANKFULL_RATIO * 100, 1e-9));
  check("a ratio of 1 is the mean flow itself", near(bankfullCapacity(7.2, 1), 1, 1e-12));
}

/* ── the partition, and the water balance ──────────────────────────────── */
{
  const K = 1e-5;
  const dry = partition({ rainMs: K / 2, K, W: 0 });
  check("rain under Ks on a dry column all soaks in", dry.runoff === 0 && near(dry.infiltrated, K / 2));
  check("and its runoff coefficient is zero", dry.coefficient === 0);

  const fast = partition({ rainMs: 3 * K, K, W: 0 });
  check("rain faster than Ks leaves exactly the excess on the surface", near(fast.horton, 2 * K));
  check("Horton excess is all of the runoff on a dry column", near(fast.runoff, 2 * K) && fast.dunne === 0);

  const full = partition({ rainMs: K / 2, K, W: 1 });
  check("on a SATURATED column every drop runs off, however slowly it falls",
    near(full.runoff, K / 2) && near(full.coefficient, 1) && near(full.infiltrated, 0));
  check("and it is saturation excess, not infiltration excess", full.horton === 0 && near(full.dunne, K / 2));

  const half = partition({ rainMs: K / 2, K, W: 0.5 });
  check("half-full returns half of what soaked in", near(half.dunne, K / 4) && near(half.infiltrated, K / 4));

  // The balance is what stops the two hazards double-counting one storm.
  for (const W of [0, 0.25, 0.5, 0.75, 1]) {
    for (const P of [K / 4, K, 2 * K, 10 * K]) {
      const p = partition({ rainMs: P, K, W });
      if (!near(p.infiltrated + p.runoff, P, 1e-18)) { check(`balance closes at W=${W}, P=${P}`, false); }
    }
  }
  check("what soaks in plus what runs off is the rain, at every wetness", true);

  check("no rain is no runoff", partition({ rainMs: 0, K, W: 1 }).runoff === 0);
  check("uncapped infiltration leaves nothing to run off on a dry column",
    partition({ rainMs: 10 * K, K, W: 0, infiltration: false }).runoff === 0);
}

/* ── velocity, and the hydraulic-geometry closure ──────────────────────── */
{
  // v = Q/(w·d) with w = 7.2 Q^0.5 and d = 0.27 Q^0.3 — the exponents close
  // on 1, which is what makes this consistent with the depth law next door.
  for (const Q of [1, 10, 100, 1000]) {
    const w = 7.2 * Math.sqrt(Q);
    const d = 0.27 * (Q ** 0.3);
    const v = cellVelocity({ slopeRad: 0, capacity: Q });
    if (!near(v * w * d, Q, Math.abs(Q) * 1e-9)) check(`velocity closes at Q=${Q}`, false);
  }
  check("channel velocity times width times depth IS the discharge", true);
  check("and it is about 2 m/s on a large river", near(cellVelocity({ slopeRad: 0, capacity: 1000 }), CHANNEL_V_COEF * (1000 ** CHANNEL_V_EXP), 1e-12));

  const steep = cellVelocity({ slopeRad: Math.asin(0.25), capacity: NaN });
  check("a hillslope's velocity is k·sqrt(sin beta)", near(steep, HILLSLOPE_V * 0.5, 1e-9));
  check("flat ground crawls at the floor rather than stopping", cellVelocity({ slopeRad: 0, capacity: NaN }) === V_MIN);
  check("and nothing exceeds the ceiling", cellVelocity({ slopeRad: 0, capacity: 1e12 }) === V_MAX);

  const k = residenceTimes({ n: 2, slopeRad: new Float32Array([0, Math.asin(0.25)]), cellM: 30 });
  check("residence time is the cell's length over its velocity", near(k[1], 30 / (HILLSLOPE_V * 0.5), 1e-4));
  check("and a slow cell holds water longer than a fast one", k[0] > k[1]);
}

/* ── the wave ──────────────────────────────────────────────────────────── */

/** A straight west-to-east ramp: every cell drains to its eastern neighbour. */
function ramp(width, height, drop = 1) {
  const band = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) band[y * width + x] = (width - x) * drop;
  }
  const bounds = { minX: 0, maxX: width * 1e-4, minY: 0, maxY: height * 1e-4 };
  return mfdTopology(fillSinks(makeRaster(band, width, height, bounds, NaN)));
}

{
  const w = 8; const h = 3; const n = w * h;
  const topo = ramp(w, h);
  const k = new Float32Array(n).fill(1800);     // half an hour a cell
  const store = new Float64Array(n);
  const source = new Float64Array(n);
  source[0] = 10;                                // 10 m³/s arriving at the top-left

  const dt = 600;
  let released = 0;
  for (let s = 0; s < 400; s += 1) {
    const q = waveStep({ topo, store, source, k, dtS: dt });
    // What leaves the grid is what the outlet column passes on.
    for (let y = 0; y < h; y += 1) {
      const i = y * w + (w - 1);
      if (topo.offsets[i] === topo.offsets[i + 1]) released += q[i] * dt;
    }
  }
  const held = store.reduce((a, b) => a + b, 0);
  const put = 10 * dt * 400;
  // The discharge is reported as Float32 (it is drawn), so the readout is
  // what bounds this, not the arithmetic — the store itself is Float64.
  check("the wave conserves mass — in equals out plus held", Math.abs((released + held) - put) < put * 1e-5);
}

{
  // A wave LAGS and ATTENUATES: a pulse at the top arrives later and lower
  // downstream, which is the whole reason this is not a steady-state model.
  const w = 12; const h = 1; const n = w * h;
  const topo = ramp(w, h);
  const k = new Float32Array(n).fill(3600);
  const store = new Float64Array(n);
  const source = new Float64Array(n);
  const dt = 600;
  const upstream = []; const downstream = [];
  for (let s = 0; s < 120; s += 1) {
    source[0] = s < 6 ? 100 : 0;                 // an hour of rain, then nothing
    const q = waveStep({ topo, store, source, k, dtS: dt });
    upstream.push(q[0]); downstream.push(q[w - 2]);
  }
  const peakAt = (a) => a.indexOf(Math.max(...a));
  check("the peak arrives later downstream", peakAt(downstream) > peakAt(upstream));
  check("and it is lower than the peak that made it", Math.max(...downstream) < Math.max(...upstream));
  check("the downstream peak is a real flood, not a trickle", Math.max(...downstream) > 1);
}

{
  /**
   * THE WAVE'S STEADY STATE IS THE STATIC MODEL'S ANSWER. Held under constant
   * rain the cascade must settle on exactly the flux `routeFlux` computes, or
   * the flood model and the slope model disagree about how much water is
   * moving down the same hillside.
   */
  const w = 10; const h = 6; const n = w * h;
  const topo = ramp(w, h);
  const source = new Float64Array(n);
  for (let i = 0; i < n; i += 1) source[i] = 0.5 + (i % 7) * 0.1;
  const steady = routeFlux(topo, Float64Array.from(source));
  const k = new Float32Array(n);
  for (let i = 0; i < n; i += 1) k[i] = 600 + (i % 5) * 300;
  const store = new Float64Array(n);
  let q = null;
  for (let s = 0; s < 3000; s += 1) q = waveStep({ topo, store, source, k, dtS: 900 });
  let worst = 0;
  for (let i = 0; i < n; i += 1) {
    const rel = Math.abs(q[i] - steady[i]) / Math.max(1e-9, steady[i]);
    if (rel > worst) worst = rel;
  }
  check("under constant rain the wave settles on the static model's own flux", worst < 1e-6);
}

{
  // A finer step must not change the answer: the release is the reservoir's
  // exact integral over dt, not a forward difference that drifts with it.
  const n = 1;
  const topo = { order: Int32Array.from([0]), offsets: Int32Array.from([0, 0]), recv: new Int32Array(0), frac: new Float32Array(0) };
  const k = new Float32Array([3600]);
  const run = (dt, steps) => {
    const store = new Float64Array(n); const source = new Float64Array([5]);
    let out = 0;
    for (let s = 0; s < steps; s += 1) out += waveStep({ topo, store, source, k, dtS: dt })[0] * dt;
    return { out, held: store[0] };
  };
  const coarse = run(3600, 10);
  const fine = run(300, 120);
  // Float32 again: `out` is summed from the reported discharge, ten values in
  // one case and a hundred and twenty in the other.
  check("the same hours stepped finely release the same water", Math.abs(coarse.out - fine.out) < coarse.out * 1e-6);
  check("and that is the continuous answer: what fell, less what the store holds",
    Math.abs(fine.out - (5 * 36000 - 5 * 3600 * (1 - Math.exp(-10)))) < 1);
  check("and hold the same amount back", Math.abs(coarse.held - fine.held) < Math.max(1, coarse.held) * 1e-9);
  check("a reservoir under steady rain holds the continuous answer, u times k", Math.abs(run(3600, 200).held - 5 * 3600) < 1);
}

{
  // The scratch buffers must not change the answer.
  const w = 6; const n = w * 2;
  const topo = ramp(w, 2);
  const k = new Float32Array(n).fill(1200);
  const source = new Float64Array(n).fill(1);
  const plain = new Float64Array(n); const reused = new Float64Array(n);
  const out = new Float32Array(n); const inflow = new Float64Array(n);
  let a = null; let b = null;
  for (let s = 0; s < 20; s += 1) {
    a = Float32Array.from(waveStep({ topo, store: plain, source, k, dtS: 600 }));
    b = Float32Array.from(waveStep({ topo, store: reused, source, k, dtS: 600, out, inflow }));
  }
  check("reusing the buffers gives the same discharge", a.every((v, i) => v === b[i]));
}

/* ── the factor of safety, and the stage ───────────────────────────────── */
{
  check("FoS is the capacity over the discharge", near(floodFos(100, 40), 2.5));
  check("a channel over its brim is below 1", floodFos(100, 250) < 1);
  check("no discharge is not a failure — it is the cap", floodFos(100, 0) === FOS_CAP);
  check("and it never runs away", floodFos(1e9, 1e-9) === FOS_CAP);
  check("no capacity is no answer", Number.isNaN(floodFos(0, 5)) && Number.isNaN(floodFos(NaN, 5)));

  check("the classes cover every finite value", floodClass(0.5) === 0 && floodClass(1e9) === FLOOD_CLASSES.length - 1);
  check("and refuse one that is not", floodClass(NaN) === -1);
  check("the runoff and discharge ladders end open", RUNOFF_CLASSES.at(-1).max === Infinity && DISCHARGE_CLASSES.at(-1).max === Infinity);

  const cap = bankfullCapacity(200);
  check("at the mean flow the water stands at its normal level",
    near(riseFor({ widthM: 200, q: cap / BANKFULL_RATIO, capacity: cap }), 0, 1e-12));
  const brim = riseFor({ widthM: 200, q: cap, capacity: cap });
  check("at the brim it stands the channel's own depth's worth higher",
    near(brim, channelDepth(200) * ((BANKFULL_RATIO ** DEPTH_EXPONENT) - 1), 1e-9));
  check("and a bigger flood stands higher still", riseFor({ widthM: 200, q: 3 * cap, capacity: cap }) > brim);
  check("below the mean the river FALLS rather than flooding", riseFor({ widthM: 200, q: cap / 50, capacity: cap }) < 0);
}

/* ── the coupling is the slope model's own number ──────────────────────── */
{
  const src = readFileSync(new URL("./flood-fos.js", import.meta.url), "utf8");
  check("the partition reads the slope model's saturation W", /dunne = r \* wet/.test(src) && /W\b/.test(src));
  check("the capacity comes from inundation.js, not a second copy of the relation",
    /meanFlowFromWidth/.test(src) && !/7\.2 \* Math\.sqrt/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
  check("the stage is inundation.js's own law", /stageRise/.test(src));
}

process.on("exit", () => {
  console.log(`flood-fos: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
