/** Climate change from the archive. Run: node GeoID_GIS/viewer/gis/climate-change.test.mjs */
import { readFileSync } from "node:fs";
import {
  CLIMATE_VARS, WINDOWS, windowOf, yearsFor, rampMaxForDays, alignGrid, baselineMean, anomalies,
  symmetricRange, twoSidedP, senMannKendall, pixelTrends, rowWeights, areaSeries, paletteAt,
  frameRGBA, signed, pixelOf, seriesCsv, decodeScene,
} from "./climate-change.js";

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass += 1; else { fail += 1; console.error("FAIL:", m); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
process.on("exit", () => { console.log(`climate-change: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });

// Windows: DJF is the winter ENDING in the year; the end is exclusive.
ok(windowOf(2020, "djf").from === "2019-12-01" && windowOf(2020, "djf").to === "2020-03-01", "DJF 2020 is Dec 2019 to Feb 2020");
ok(windowOf(2020, "djf").days === 91, "a leap-year winter is 91 days");
ok(windowOf(2021, "year").days === 365 && windowOf(2020, "year").days === 366, "a year is its own length");
ok(windowOf(2020, "m12").to === "2021-01-01" && windowOf(2020, "m02").days === 29, "a month's window");
ok(WINDOWS.length === 17, "year, four seasons and twelve months");
let threw = false; try { windowOf(2020, "nope"); } catch { threw = true; }
ok(threw, "an unknown window is refused");

// Years: inside the dataset, never a window still running.
const now = Date.parse("2026-07-15T00:00:00Z");
const y = yearsFor("lst", 1990, 2026, "jja", now);
ok(y[0] === 2001 && y[y.length - 1] === 2025, `LST summers 2001-2025 when this summer is under way (${y[0]}-${y[y.length - 1]})`);
ok(yearsFor("lst", 2001, 2002, "djf", now)[0] === 2002, "DJF needs the previous December inside the record");
ok(yearsFor("rain", 1975, 1983, "year", now)[0] === 1981, "CHIRPS starts in 1981");
ok(rampMaxForDays(31) === 2000 && rampMaxForDays(92) === 4000 && rampMaxForDays(366) === 10000, "a summed composite's ramp grows with the window");

// Decode goes through the shared palette inversion.
{
  const data = new Uint8ClampedArray([255, 255, 255, 255, 11, 47, 138, 255, 0, 0, 0, 0]);
  const v = decodeScene(data, 3, 1, { palette: ["ffffff", "bfe9ff", "2f6bff", "0b2f8a"], legend: { min: 0, max: 300 } });
  ok(near(v[0], 0, 2) && near(v[1], 300, 2) && Number.isNaN(v[2]), "the ramp's ends and a transparent pixel");
}

// Grid alignment is the identity at the same size and nearest otherwise.
{
  const a = new Float32Array([1, 2, 3, 4]);
  ok(alignGrid(a, 2, 2, 2, 2) === a, "same size, same array");
  const b = alignGrid(a, 2, 2, 4, 4);
  ok(b.length === 16 && b[0] === 1 && b[3] === 2 && b[15] === 4, "nearest neighbour up");
}

// Baseline and anomalies.
{
  const frames = [new Float32Array([1, NaN]), new Float32Array([3, NaN]), new Float32Array([5, 7])];
  const base = baselineMean(frames, [0, 1]);
  ok(base[0] === 2 && Number.isNaN(base[1]), "the baseline mean, NaN where no baseline year has a value");
  const an = anomalies(frames, base);
  ok(an[2][0] === 3 && Number.isNaN(an[2][1]), "anomaly is value less baseline, NaN without one");
}

// The range is symmetric and robust.
{
  const big = new Float32Array(1000);
  for (let i = 0; i < 1000; i += 1) big[i] = (i % 2 ? 1 : -1) * (i / 1000);
  big[999] = 1000;
  const r = symmetricRange([big]);
  ok(r > 0.9 && r < 1.01, `one wild pixel does not set the range (${r})`);
}

// Sen and Mann-Kendall against hand-worked cases.
ok(near(twoSidedP(1.959964), 0.05, 2e-4) && near(twoSidedP(0), 1, 1e-6), "the two-sided normal p");
{
  const years = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009];
  const line = years.map((yr) => 0.03 * (yr - 2000) + 10);
  const t = senMannKendall(line, years);
  ok(near(t.slope, 0.03, 1e-9) && t.s === 45 && t.p < 0.001, `a straight warming line: slope 0.03/yr, S 45, significant (p ${t.p})`);
  const wild = [...line]; wild[4] = 99; wild[7] = -50;
  ok(near(senMannKendall(wild, years).slope, 0.03, 0.006), "Sen's slope shrugs off two wild years");
  const flat = years.map((_, k) => (k % 2 ? 1 : -1));
  ok(senMannKendall(flat, years).p > 0.5, "an alternating series is not a trend");
  ok(Number.isNaN(senMannKendall([1, NaN, NaN, 2], [1, 2, 3, 4]).slope), "fewer than four finite years is not a trend");
  // n = 10, S = 45: Var = 10*9*25/18 = 125, Z = 44/sqrt(125).
  ok(near(senMannKendall(line, years).z, 44 / Math.sqrt(125), 1e-12), "Z with the continuity correction");
}
{
  const years = [1, 2, 3, 4, 5];
  const frames = years.map((yr) => new Float32Array([yr * 0.2, 7, NaN]));
  const t = pixelTrends(frames, years);
  ok(near(t.slope[0], 2, 1e-6) && t.slope[1] === 0 && Number.isNaN(t.slope[2]), "per-pixel slope per DECADE; flat is 0; empty is NaN");
}

// Area weighting by latitude.
{
  const w = rowWeights(2, 60, 0);
  ok(near(w[0], Math.cos(45 * Math.PI / 180), 1e-12) && near(w[1], Math.cos(15 * Math.PI / 180), 1e-12), "row centres' cosines");
  const frames = [new Float32Array([1, 1, 3, 3]), new Float32Array([2, NaN, 4, 4])];
  const s = areaSeries(frames, 2, 2, { north: 60, south: 0, west: 0, east: 10 });
  ok(s.common && near(s.validShare, 0.75, 1e-12), "the mask valid in every frame");
  const expect = (1 * w[0] + 3 * w[1] + 3 * w[1]) / (w[0] + 2 * w[1]);
  ok(near(s.means[0], expect, 1e-9), "the first frame is averaged over the common mask only");
}

// Colour.
ok(paletteAt(["000000", "ffffff"], 0.5).join() === "128,128,128" || paletteAt(["000000", "ffffff"], 0.5).join() === "127,127,127", "half way between black and white");
{
  const px = frameRGBA(new Float32Array([-1, 0, 1, NaN]), ["0000ff", "ffffff", "ff0000"], 1, { fade: new Uint8Array([0, 1, 0, 0]) });
  ok(px[2] === 255 && px[0] === 0, "negative is the cool end");
  ok(px[4] === 255 && px[5] === 255 && px[6] === 255 && px[7] === Math.round(235 / 3), "zero is white, a faded pixel a third of the alpha");
  ok(px[8] === 255 && px[10] === 0 && px[15] === 0, "positive is the warm end; NaN transparent");
}
ok(signed(1.234, "°C") === "+1.23 °C" && signed(-34.6, "mm") === "−34.6 mm" && signed(NaN) === "—", "signed values");
ok(pixelOf(5, 5, { west: 0, east: 10, south: 0, north: 10 }, 10, 10) === 55 && pixelOf(11, 5, { west: 0, east: 10, south: 0, north: 10 }, 10, 10) === -1, "a coordinate's pixel");
ok(seriesCsv([2000, 2001], [1, 2], 1.5, "°C", "LST").includes("2001,2.00000,0.50000"), "the series CSV");

// Every variable names a curated, deployed dataset.
{
  const service = readFileSync(new URL("../../services/gee-tiles/index.js", import.meta.url), "utf8");
  for (const [id, spec] of Object.entries(CLIMATE_VARS)) {
    ok(service.includes(`"${spec.dataset}"`), `${id}: the deployed service has ${spec.dataset}`);
    ok(spec.anomalyPalette.length >= 3 && spec.anomalyPalette[Math.floor(spec.anomalyPalette.length / 2)] === "f7f7f7", `${id}: diverging, white in the middle`);
  }
}
