/**
 * River flood inundation: the stage from the river's own size, the flood over
 * ground joined to the channel, and the depth classes a reader can picture.
 * Run with `node inundation.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { channelDepth, stageRise, sourceFields, inundate, mergeOuterDepth, depthClass,
  floodAreas, SCENARIOS, DEFAULTS, DEPTH_CLASSES, meanFlowFromWidth, selectRiver, riverField,
  flowRatio } from "./inundation.js";

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

{
  // The outer flood's LEVEL read against the view's own heights: one coarse
  // cell at 12 m over four fine cells at 10, 11, 12.5 and 13 m.
  const b = { west: 0, east: 1, south: 0, north: 1 };
  const outer = { bounds: b, width: 1, height: 1, level: new Float32Array([12]),
    depth: new Float32Array([1]) };
  const fine = new Float32Array(4).fill(NaN);
  mergeOuterDepth(fine, outer, b, 4, 1, null, new Float32Array([10, 11, 12.5, 13]));
  check("a flood from out of shot takes its edge from the fine ground, not the coarse cell",
    near(fine[0], 2, 1e-6) && near(fine[1], 1, 1e-6) && Number.isNaN(fine[2]) && Number.isNaN(fine[3]),
    `${[...fine]}`);
}

{
  // Two coarse cells, the west one under water at 12 m, the east one dry; the
  // fine ground is flat at 11 m. The water should run on past the coarse
  // cell's edge rather than stop square at it.
  const b = { west: 0, east: 2, south: 0, north: 1 };
  const outer = { bounds: b, width: 2, height: 1, level: new Float32Array([12, NaN]) };
  const fine = new Float32Array(8).fill(NaN);
  mergeOuterDepth(fine, outer, b, 8, 1, null, new Float32Array(8).fill(11));
  check("and the edge is not the coarse cell's: the level carries past it onto low fine ground",
    fine[4] > 0 && fine[5] > 0, `${[...fine]}`);
}

{
  // A level handed on to another grid: at the channel it is the river's
  // SURFACE plus the rise. The centreline cell here reads 13 m (it holds the
  // bank) while the lowest ground round it is its neighbours' 10.05 m.
  const h = valley();
  for (let j = 0; j < H; j += 1) h[(j * W) + mid] = 13;
  const flow = { ...DEFAULTS, flow: 12.5, reach: 50 };
  const rise = stageRise(100, flow);
  const out = inundate({ heights: h, riverWidth, fields, width: W, height: H, params: flow });
  const c = (1 * W) + mid;
  check("the level at the channel is its surface plus the rise, not its bank-high height",
    near(out.level[c], 10.05 + rise, 1e-4) && near(out.normal[c], 10.05, 1e-4),
    `level ${out.level[c]} against ${10.05 + rise}`);
  check("and on flooded ground it is the height plus the depth — one surface",
    near(out.level[c + 10], out.normal[c + 10] + rise, 1e-4)
    && near(out.level[c + 10], h[c + 10] + out.depth[c + 10], 1e-4),
    `${out.level[c + 10]} / ${out.normal[c + 10]}`);
  check("dry ground carries no level", Number.isNaN(out.level[c + 199 - mid]));
}

{
  // The outer flood reaching a PIT: one coarse centre, level 12 m over a river
  // whose normal level is 11 m, and fine ground at 11.5 m and 6 m. The pit is
  // below the river, so while the defences hold it stays dry.
  const b = { west: 0, east: 1, south: 0, north: 1 };
  const outer = { bounds: b, width: 1, height: 1, level: new Float32Array([12]),
    normal: new Float32Array([11]) };
  const held = new Float32Array(2).fill(NaN);
  mergeOuterDepth(held, outer, b, 2, 1, null, new Float32Array([11.5, 6]));
  check("a flood from out of shot leaves ground below the river's normal level dry",
    near(held[0], 0.5, 1e-6) && Number.isNaN(held[1]), `${[...held]}`);
  const failed = new Float32Array(2).fill(NaN);
  mergeOuterDepth(failed, outer, b, 2, 1, null, new Float32Array([11.5, 6]), { defended: false });
  check("and floods it when the defences fail", near(failed[1], 6, 1e-6), `${[...failed]}`);
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

/* ── by discharge: one river at a flow in m³/s ────────────────────────── */

check("mean flow from width inverts w = 7.2 Q^0.5",
  near(meanFlowFromWidth(7.2), 1, 1e-12) && near(meanFlowFromWidth(72), 100, 1e-9)
  && near(meanFlowFromWidth(720), 10000, 1e-6));
check("and a width of nothing is not a flow of nothing: it floors at a metre",
  meanFlowFromWidth(0) > 0 && meanFlowFromWidth(null) === meanFlowFromWidth(1));
check("a discharge is read as a multiple of the river's mean",
  flowRatio(500, 100) === 5 && flowRatio(50, 100) === 0.5);
check("with no mean to read it against it is the mean itself, never NaN",
  flowRatio(500, null) === 1 && flowRatio(500, 0) === 1 && flowRatio(null, 100) === 1);
check("below its mean a river falls, so a low flow floods nothing",
  stageRise(100, { ...DEFAULTS, flow: 0.5 }) < 0);

{
  // Two rivers down one valley: a 100 m main stem in column 60 widening to
  // 150 m, and a 20 m tributary joining it along row 1 from column 61 to 90;
  // and a separate 100 m river in column 150, never joined.
  const w2 = new Float32Array(W * H).fill(NaN);
  for (let j = 0; j < H; j += 1) {
    w2[(j * W) + 60] = j === 2 ? 150 : 100;
    w2[(j * W) + 150] = 100;
  }
  for (let i = 61; i <= 90; i += 1) w2[(1 * W) + i] = 20;
  const lonOf = (i) => bounds.west + ((i + 0.5) * 1e-4);
  const near60 = selectRiver(w2, W, H, bounds, { lat: 0, lon: lonOf(58) });
  check("a pick takes the river nearest it, grown along its own channel",
    near60.mask[(0 * W) + 60] === 1 && near60.mask[(2 * W) + 60] === 1 && near60.cells === 3,
    `${near60.cells} cells`);
  check("its widening stays in, but a tributary a fifth of its size stays out",
    near60.mask[(1 * W) + 70] === 0 && near60.mask[(0 * W) + 150] === 0);
  check("the river's width is the median of what was traced", near60.width === 100);
  const fromTrib = selectRiver(w2, W, H, bounds, { lat: 0, lon: lonOf(75) });
  check("picked on the tributary, the tributary is the river",
    fromTrib.width === 20 && fromTrib.mask[(1 * W) + 60] === 0 && fromTrib.cells === 30,
    `${fromTrib.cells} cells, ${fromTrib.width} m`);
  const kept = selectRiver(w2, W, H, bounds, { lat: 0, lon: lonOf(75), width: 100 });
  check("a known width keeps the same river on another grid, even with a nearer one",
    kept.width === 100 && kept.mask[(1 * W) + 70] === 0);
  check("nowhere to pick, nothing selected",
    selectRiver(w2, W, H, bounds, null).cells === 0
    && selectRiver(new Float32Array(W * H).fill(NaN), W, H, bounds, { lat: 0, lon: 0 }).seed === -1);
  check("an empty selection has no field, so nothing is flooded from it",
    riverField(new Uint8Array(W * H), W, H, bounds).length === 0);

  // The main stem at five times its mean floods its banks; the river at 150,
  // not picked, keeps its normal level and floods nothing.
  const h2 = new Float32Array(W * H);
  for (let j = 0; j < H; j += 1) {
    for (let i = 0; i < W; i += 1) {
      h2[(j * W) + i] = 10 + (0.05 * Math.min(Math.abs(i - 60), Math.abs(i - 150)));
    }
  }
  const one = riverField(near60.mask, W, H, bounds);
  const params = { ...DEFAULTS, flow: flowRatio(5 * meanFlowFromWidth(100), meanFlowFromWidth(100)),
    reach: 50, widthCap: Infinity };
  const out = inundate({ heights: h2, riverWidth: w2, fields: one, width: W, height: H, params });
  check("one river's field floods round that river",
    out.depth[(1 * W) + 55] > 0 && out.channel[(1 * W) + 60] === 1);
  check("and only that river: the unpicked one is not a channel and floods nothing",
    out.channel[(1 * W) + 150] === 0 && Number.isNaN(out.depth[(1 * W) + 145]));
  const low = inundate({ heights: h2, riverWidth: w2, fields: one, width: W, height: H,
    params: { ...params, flow: flowRatio(0.5 * meanFlowFromWidth(100), meanFlowFromWidth(100)) } });
  let wet = 0;
  for (let i = 0; i < W; i += 1) if (low.depth[(1 * W) + i] > 0 && !low.channel[(1 * W) + i]) wet += 1;
  check("at half its mean flow the river stays in its channel", wet === 0, `${wet} cells wet`);
}

/* ── wired in ─────────────────────────────────────────────────────────── */

const here = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const sheets = here("./dem-layer.js");
check("the flood is a sheet of the streamed DEM, reading GRWL and the ground round the view",
  /inundation:\s*\{/.test(sheets) && /inundate\(\{/.test(sheets) && /floodOuter\(bounds, params\)/.test(sheets)
  && /waterFeatures\("rivers"/.test(sheets));
check("and keeps each view's nearest-river fields, so a slider costs arithmetic",
  /if \(!base\.fields\)/.test(sheets) && /sourceFields\(base\.riverWidth, width, height, bounds\)/.test(sheets));
check("both sheets hand the defences to the outer merge, and the outer carries the model's own level",
  (sheets.match(/\{ defended: ctx\.params\.defended !== false \}/g) || []).length === 2
  && /level: flood\.level, normal: flood\.normal/.test(sheets));
check("the discharge sheet floods from ONE river's field and reads its mean from the drawer",
  /discharge:\s*\{/.test(sheets) && /selectRiver\(base\.riverWidth/.test(sheets)
  && /riverField\(sel\.mask/.test(sheets) && /flowRatio\(dischargeState\.discharge, mean\)/.test(sheets));
check("a rebuild announces itself, so a drawer follows a build it did not start",
  /geoid-gis:sheet-built/.test(sheets) && /globalThis\.document\?\.dispatchEvent\?\./.test(sheets)
  && /geoid-gis:sheet-built/.test(here("./flood-panel.js")));
const page = here("../index.html");
check("the Flood subtab holds the row, its drawer and its script",
  /id="flood-catalogue"/.test(page) && /id="flood-inundation-controls" hidden/.test(page)
  && /gis\/flood-panel\.js/.test(page)
  && ["flood-flow", "flood-extra", "flood-reach", "flood-cap", "flood-exponent", "flood-connected",
    "flood-defended"]
    .every((id) => page.includes(`id="${id}"`)));
const panels = here("./catalogue-panels.js");
check("the row names its drawer", /id: "flood-inundation",[\s\S]{0,2400}settings: "flood-inundation-controls"/.test(panels));
check("the discharge row names its own drawer and its own sheet",
  /id: "flood-discharge",[\s\S]{0,2400}settings: "flood-discharge-controls"/.test(panels)
  && /addSheet\("discharge"/.test(panels));
check("the discharge drawer carries the pick, the mean, the flow and the box",
  /id="flood-discharge-controls" hidden/.test(page)
  && ["discharge-pick", "discharge-mean", "discharge-flow", "discharge-box", "discharge-reach",
    "discharge-defended", "discharge-readout"].every((id) => page.includes(`id="${id}"`)));
const eq = here("./equations.js");
check("the ⓘ states the model the code applies",
  /"flood-inundation": \{/.test(eq) && /0\.27 · \(W \/ 7\.2\)\^0\.6/.test(eq) && /\(Q\/Q̄\)\^f − 1/.test(eq));
check("the discharge ⓘ states the mean-flow law and the one-river rule",
  /"flood-discharge": \{/.test(eq) && /Q̄ = \(W \/ 7\.2\)²/.test(eq) && /joined to this river/.test(eq));
