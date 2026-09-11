/**
 * River flood inundation: the stage from the river's own size, the flood over
 * ground joined to the channel, and the depth classes a reader can picture.
 * Run with `node inundation.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { channelDepth, stageRise, sourceFields, inundate, mergeOuterDepth, depthClass,
  floodAreas, SCENARIOS, DEFAULTS, DEPTH_CLASSES } from "./inundation.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ok    ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ── the stage ────────────────────────────────────────────────────────── */

// Moody & Troutman: w = 7.2 Q^0.5, d = 0.27 Q^0.3. A river 7.2 m wide carries
// Q = 1 and is 0.27 m deep; one 720 m wide carries 10^4 and is 0.27·10^1.2.
check("channel depth is Moody & Troutman's with Q eliminated",
  near(channelDepth(7.2), 0.27, 1e-9) && near(channelDepth(720), 0.27 * (10 ** 1.2), 1e-9));
check("a 100 m river is about 1.3 m deep", near(channelDepth(100), 1.31, 0.01), channelDepth(100));
const p100 = { ...DEFAULTS, flow: 12.5 };
check("the rise is D((Q/Q̄)^f − 1): at mean flow nothing rises",
  stageRise(500, { ...DEFAULTS, flow: 1 }) === 0);
check("and the 1-in-100 flood lifts a 100 m river about 2.3 m",
  near(stageRise(100, p100), channelDepth(100) * ((12.5 ** 0.4) - 1), 1e-9)
  && near(stageRise(100, p100), 2.29, 0.02), stageRise(100, p100));
check("a bigger river rises more, in metres, for the same flood",
  stageRise(2000, p100) > stageRise(300, p100) && stageRise(300, p100) > stageRise(50, p100));
check("the extra level is added to every river", near(stageRise(100, { ...p100, extra: 1.5 }),
  stageRise(100, p100) + 1.5, 1e-9));
check("a river wider than the cap stays at mean flow, but still takes the extra level",
  stageRise(500, { ...p100, widthCap: 100, extra: 0.4 }) === 0.4
  && stageRise(80, { ...p100, widthCap: 100 }) > 0);
check("the scenarios run from seasonal to flash, and the flash flood is small-channel only",
  SCENARIOS.map((s) => s.id).join() === "seasonal,winter,ten,hundred,flash"
  && SCENARIOS.find((s) => s.id === "flash").widthCap === 100
  && SCENARIOS.every((s, i, a) => i === 0 || s.flow > a[i - 1].flow));

/* ── the flood ────────────────────────────────────────────────────────── */

// A valley 200 columns across at the equator, 11.13 m a column: a 100 m river
// down the middle at 10 m, the ground rising 0.05 m per column either side.
const COL_M = 1e-4 * 111320;
const W = 200; const H = 3;
const bounds = { west: 0, east: W * 1e-4, south: -1.5e-4, north: 1.5e-4 };
const mid = 100;
const valley = () => {
  const h = new Float32Array(W * H);
  for (let j = 0; j < H; j += 1) for (let i = 0; i < W; i += 1) h[(j * W) + i] = 10 + (0.05 * Math.abs(i - mid));
  return h;
};
const riverWidth = new Float32Array(W * H).fill(NaN);
for (let j = 0; j < H; j += 1) riverWidth[(j * W) + mid] = 100;
const fields = sourceFields(riverWidth, W, H, bounds);
check("one band of widths holds the river", fields.length === 1 && fields[0].lo === 100);

{
  const heights = valley();
  const flow = { ...DEFAULTS, flow: 12.5, reach: 50 };
  const rise = stageRise(100, flow);
  const { depth, channel } = inundate({ heights, riverWidth, fields, width: W, height: H, params: flow });
  const at = (i) => depth[(1 * W) + i];
  // The edge is where 0.05·|i − mid| = rise.
  const edge = rise / 0.05;
  check("the channel is painted with the rise above the river's normal level, so the flood has no gap",
    channel[(1 * W) + mid] === 1 && near(at(mid), rise, 1e-4));
  const areas = floodAreas(depth, null, W, H, bounds, null, channel);
  const withChannel = floodAreas(depth, null, W, H, bounds, null, null);
  check("but the river's own channel is not counted as flooded ground",
    areas.total < withChannel.total && areas.deepest < rise);
  check("ground below the raised water floods, to the depth between",
    near(at(mid + 10), rise - 0.5, 1e-4) && near(at(mid - 10), rise - 0.5, 1e-4));
  check("and ground above it stays dry", Number.isNaN(at(Math.ceil(mid + edge + 1))),
    `edge ${edge.toFixed(1)} columns`);
  const small = inundate({ heights, riverWidth, fields, width: W, height: H,
    params: { ...flow, flow: 2 } }).depth;
  let wetBig = 0; let wetSmall = 0;
  for (let i = 0; i < W; i += 1) { if (at(i) > 0) wetBig += 1; if (small[(1 * W) + i] > 0) wetSmall += 1; }
  check("a bigger flood covers more ground", wetBig > wetSmall && wetSmall > 0, `${wetSmall} → ${wetBig}`);
  const capped = inundate({ heights, riverWidth, fields, width: W, height: H,
    params: { ...flow, reach: 2 } }).depth;
  check("the reach in channel widths stops the spread",
    capped[(1 * W) + mid + 20] > 0 && Number.isNaN(capped[(1 * W) + mid + 30]),
    `bank at 20 cols is ${(20 * COL_M - 50).toFixed(0)} m, at 30 ${(30 * COL_M - 50).toFixed(0)} m`);
}

{
  // A hollow behind a ridge: lower than the flood, and not joined to it.
  const heights = valley();
  for (let j = 0; j < H; j += 1) {
    heights[(j * W) + mid + 20] = 30;                          // the ridge
    for (let i = mid + 21; i < mid + 30; i += 1) heights[(j * W) + i] = 10.5;   // above normal, below the flood
  }
  const flow = { ...DEFAULTS, flow: 12.5, reach: 50 };
  const joined = inundate({ heights, riverWidth, fields, width: W, height: H, params: flow });
  check("a hollow behind a ridge stays dry, and is reported as cut off",
    Number.isNaN(joined.depth[(1 * W) + mid + 25]) && joined.cutOff[(1 * W) + mid + 25] === 1);
  const loose = inundate({ heights, riverWidth, fields, width: W, height: H,
    params: { ...flow, connected: false } });
  check("with the connection switched off it fills, as if it rained there",
    loose.depth[(1 * W) + mid + 25] > 0);
}

{
  // A river on a levee: the land beside it is lower than its water already.
  const heights = valley();
  for (let j = 0; j < H; j += 1) for (let i = mid + 3; i < mid + 15; i += 1) heights[(j * W) + i] = 8;
  const flow = { ...DEFAULTS, flow: 2, reach: 50 };
  const held = inundate({ heights, riverWidth, fields, width: W, height: H, params: flow });
  check("land below the river's normal level is left dry while defences hold, and counted",
    Number.isNaN(held.depth[(1 * W) + mid + 8]) && held.defended[(1 * W) + mid + 8] === 1);
  const failed = inundate({ heights, riverWidth, fields, width: W, height: H,
    params: { ...flow, defended: false } });
  check("and floods when they fail, to the depth below the raised river",
    near(failed.depth[(1 * W) + mid + 8], 10 + stageRise(100, flow) - 8, 1e-4));
  // A centreline cell that caught the bank reads high; the water is the lowest ground at it.
  const banked = valley();
  for (let j = 0; j < H; j += 1) banked[(j * W) + mid] = 12;
  const lowered = inundate({ heights: banked, riverWidth, fields, width: W, height: H,
    params: { ...DEFAULTS, flow: 1, reach: 50 } });
  let wet = 0;
  for (let i = 0; i < W; i += 1) if (lowered.depth[(1 * W) + i] > 0) wet += 1;
  check("the river's surface is the lowest ground at its cell, not the bank it caught",
    wet === 0, `${wet} cells flooded at mean flow`);
}

{
  // Open water is never painted, and conducts.
  const heights = valley();
  const water = new Uint8Array(W * H);
  for (let j = 0; j < H; j += 1) for (let i = mid + 5; i < mid + 8; i += 1) water[(j * W) + i] = 1;
  const { depth } = inundate({ heights, riverWidth, water, fields, width: W, height: H,
    params: { ...DEFAULTS, reach: 50 } });
  check("the sea and lakes are left unpainted", Number.isNaN(depth[(1 * W) + mid + 6]));
  check("and the flood carries on past them", depth[(1 * W) + mid + 10] > 0);
}

{
  // A flood from a river out of shot, taken where the view is dry.
  const b = { west: 0, east: 1, south: 0, north: 1 };
  const outer = { bounds: { west: -1, east: 2, south: 0, north: 1 }, width: 3, height: 1,
    depth: new Float32Array([NaN, 0.8, NaN]) };
  const fine = new Float32Array([NaN, 2, NaN, NaN]);
  const water = new Uint8Array([0, 0, 1, 0]);
  mergeOuterDepth(fine, outer, b, 4, 1, water);
  check("a flood reaching in from a river out of shot is drawn in the view",
    near(fine[0], 0.8, 1e-6) && near(fine[3], 0.8, 1e-6), `${[...fine]}`);
  check("but never over the view's own answer or its water", fine[1] === 2 && Number.isNaN(fine[2]));
}

/* ── the classes ──────────────────────────────────────────────────────── */

check("depth classes are the NWS thresholds, 15 cm, 30 cm and 60 cm",
  DEPTH_CLASSES[0].max === 0.15 && DEPTH_CLASSES[1].max === 0.3 && DEPTH_CLASSES[2].max === 0.6);
check("a depth falls in the class that holds it", depthClass(0.1) === 0 && depthClass(0.45) === 2
  && depthClass(5) === DEPTH_CLASSES.length - 1 && depthClass(0) === -1 && depthClass(NaN) === -1);
{
  const b = { west: 0, east: 10, south: 0, north: 10 };
  const d = new Float32Array(100).fill(0.45);
  const a = floodAreas(d, null, 10, 10, b);
  const cap = 6371.0088 ** 2 * (10 * Math.PI / 180) * Math.sin(10 * Math.PI / 180);
  check("flooded areas are ground areas on the sphere", near(a.byClass[2], cap, cap * 0.001)
    && near(a.total, cap, cap * 0.001) && near(a.deepest, 0.45, 1e-6));
}

/* ── wired in ─────────────────────────────────────────────────────────── */

const here = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const sheets = here("./dem-layer.js");
check("the flood is a sheet of the streamed DEM, reading GRWL and the ground round the view",
  /inundation:\s*\{/.test(sheets) && /inundate\(\{/.test(sheets) && /floodOuter\(bounds, params\)/.test(sheets)
  && /waterFeatures\("rivers"/.test(sheets));
check("and keeps each view's nearest-river fields, so a slider costs arithmetic",
  /floodState\.fields\?\.key !== key/.test(sheets) && /sourceFields\(riverWidth, width, height, bounds\)/.test(sheets));
const page = here("../index.html");
check("the Flood subtab holds the row, its drawer and its script",
  /id="flood-catalogue"/.test(page) && /id="flood-inundation-controls" hidden/.test(page)
  && /gis\/flood-panel\.js/.test(page)
  && ["flood-flow", "flood-extra", "flood-reach", "flood-cap", "flood-exponent", "flood-connected",
    "flood-defended"]
    .every((id) => page.includes(`id="${id}"`)));
const panels = here("./catalogue-panels.js");
check("the row names its drawer", /id: "flood-inundation",[\s\S]{0,2400}settings: "flood-inundation-controls"/.test(panels));
const eq = here("./equations.js");
check("the ⓘ states the model the code applies",
  /"flood-inundation": \{/.test(eq) && /0\.27 · \(W \/ 7\.2\)\^0\.6/.test(eq) && /\(Q\/Q̄\)\^f − 1/.test(eq));
