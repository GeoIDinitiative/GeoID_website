// The watershed extractor and the runoff arithmetic, against surfaces whose
// answers are known by construction.
import {
  fill, d8, accumulate, snapOutlet, upstreamMask, touchesEdge, traceOutline, ringArea,
  streamNetwork, velocities, travelToOutlet, scsRunoff, excessSeries, timeAreaHydrograph,
  kirpichMinutes, cellMetres, cellOf, catchmentStats,
} from "./catchment.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
process.on("exit", () => {
  console.log(`catchment: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
  if (fail) process.exitCode = 1;
});

// A V-valley draining south: height = |x - cx| * 5 + (H - 1 - y) * 2 metres,
// so every column falls towards the centre and the centre falls south.
function valley(W = 21, H = 30, cellDeg = 0.001) {
  const band = new Float32Array(W * H);
  const cx = (W - 1) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) band[y * W + x] = Math.abs(x - cx) * 5 + (H - 1 - y) * 2 + 100;
  return { band, width: W, height: H, bounds: { minX: 10, maxX: 10 + W * cellDeg, minY: 45, maxY: 45 + H * cellDeg } };
}

{
  const g = valley();
  const filled = fill(g);
  const cm = cellMetres(g);
  const flow = d8(filled, g.width, g.height, cm);
  const acc = accumulate(flow, g.width, g.height);
  const cx = 10; const bottom = g.height - 1;
  const outlet = bottom * g.width + cx;
  ok("a pit-free surface fills to itself", g.band.every((h, i) => Math.abs(filled[i] - h) < 1e-3));
  ok("the valley floor at the bottom collects the whole grid", acc[outlet] === g.width * g.height, `acc=${acc[outlet]}`);
  const snapped = snapOutlet(acc, g.width, g.height, cx + 3, bottom - 1, 4);
  ok("a click beside the channel snaps onto it", snapped === outlet || acc[snapped] >= acc[outlet] * 0.9, `snapped=${snapped}`);
  const one = snapOutlet(acc, g.width, g.height, cx, bottom, 0);
  ok("radius 0 does not move the outlet", one === outlet);
  const { mask, cells } = upstreamMask(flow, g.width, g.height, outlet);
  ok("the outlet's catchment is the whole valley", cells === g.width * g.height);
  ok("that catchment touches the grid edge", touchesEdge(mask, g.width, g.height));

  // A catchment part-way down the channel: everything upstream of row 15.
  const mid = 15 * g.width + cx;
  const up = upstreamMask(flow, g.width, g.height, mid);
  // D8 on this surface sends a side cell SIDEWAYS first — 5 m over 79 m of
  // cell beats the diagonal's 7 m over 136 m — so every cell in rows 0..15
  // reaches the channel at or above row 15.
  const expected = 16 * g.width;
  ok("a mid-channel outlet takes the triangle above it", up.cells === expected, `got ${up.cells} expected ${expected}`);

  // Outline: the polygon's area in cells equals the mask's cell count.
  const rings = traceOutline(up.mask, g.width, g.height, g.bounds);
  const degPerCellX = (g.bounds.maxX - g.bounds.minX) / g.width;
  const degPerCellY = (g.bounds.maxY - g.bounds.minY) / g.height;
  const areaCells = Math.abs(ringArea(rings[0])) / (degPerCellX * degPerCellY);
  ok("the outline holds exactly the mask's cells", Math.abs(areaCells - up.cells) < 1e-6, `${areaCells} vs ${up.cells}`);
  ok("the outer ring winds counter-clockwise", ringArea(rings[0]) > 0);
  ok("the ring is closed", rings[0][0][0] === rings[0].at(-1)[0] && rings[0][0][1] === rings[0].at(-1)[1]);

  // Streams: the centre column is a single first-order channel.
  const net = streamNetwork(flow, acc, mask, g, 25);
  ok("the network finds a channel", net.features.length >= 1 && net.maxOrder >= 1);
  ok("every reach has a length", net.features.every((f) => f.properties.length_m > 0));

  // Travel time on uniform velocity is distance over velocity.
  const vel = new Float32Array(g.width * g.height).fill(2);
  const tr = travelToOutlet(flow, mask, g.width, outlet, vel);
  const top = cx;  // centre of the top row: straight down the channel
  const straight = (g.height - 1) * cm.y;
  ok("a straight run's distance is its length", Math.abs(tr.dist[top] - straight) < 1e-3 * straight, `${tr.dist[top]} vs ${straight}`);
  ok("its travel time is length over velocity", Math.abs(tr.time[top] - straight / 2) < 1e-3 * straight);

  const stats = catchmentStats(g, filled, flow, mask, outlet, tr);
  ok("the area is cells times cell area", Math.abs(stats.areaKm2 - (g.width * g.height * cm.x * cm.y) / 1e6) < 1e-9);
  ok("relief is max minus min", Math.abs(stats.reliefM - (Math.max(...g.band) - Math.min(...g.band))) < 1e-3);

  // Velocities: K√S with a floor, the channel velocity on streams.
  const v2 = velocities(flow, net.isStream, { overlandK: 4.918, channelV: 1.5, floorV: 0.05 });
  const hill = 0; // top-left corner: never a stream
  ok("a hillslope cell takes K√S", Math.abs(v2[hill] - 4.918 * Math.sqrt(flow.tan[hill])) < 1e-6);
  ok("a stream cell takes the channel velocity", net.isStream[outlet] ? v2[outlet] === 1.5 : true);
}

// A closed pit fills to its rim.
{
  const W = 5, H = 5;
  const band = new Float32Array(W * H).fill(10);
  band[12] = 1;
  const f = fill({ band, width: W, height: H });
  ok("a pit is filled to its rim", f[12] >= 10 && f[12] < 10.01);
}

// SCS curve number: textbook values (TR-55): P = 100 mm, CN 80 → S = 63.5 mm,
// Ia = 12.7, Q = (87.3²)/(150.8) = 50.54 mm.
ok("SCS runoff matches the TR-55 formula", Math.abs(scsRunoff(100, 80) - 50.54) < 0.05, `${scsRunoff(100, 80)}`);
ok("no runoff below the initial abstraction", scsRunoff(10, 80) === 0);
ok("CN 100 runs everything off", Math.abs(scsRunoff(50, 100) - 50) < 1e-9);
const ex = excessSeries(100, 2, 80, 600);
ok("the excess series sums to the storm's runoff", Math.abs(ex.reduce((a, b) => a + b, 0) - scsRunoff(100, 80)) < 1e-9);

// Time–area: the hydrograph's volume is the excess depth times the area.
{
  const W = 4, H = 1;
  const mask = new Uint8Array([1, 1, 1, 1]);
  const time = new Float32Array([0, 600, 1200, 1800]);
  const excess = new Float64Array([5, 5, 0]); // mm per 600 s step
  const h = timeAreaHydrograph(time, mask, 1e4, excess, 600);
  const expectedVol = (10 / 1000) * 1e4 * 4;
  ok("the hydrograph conserves volume", Math.abs(h.volume - expectedVol) < 1e-6, `${h.volume} vs ${expectedVol}`);
  ok("time of concentration is the longest travel time", h.tcS === 1800);
}

ok("Kirpich: 1,000 m at 1% is 0.0195·1000^0.77·0.01^−0.385 = 23.4 minutes", Math.abs(kirpichMinutes(1000, 0.01) - 23.44) < 0.05, `${kirpichMinutes(1000, 0.01)}`);
ok("cellOf refuses a point off the grid", cellOf(valley(), 0, 0) === null);
