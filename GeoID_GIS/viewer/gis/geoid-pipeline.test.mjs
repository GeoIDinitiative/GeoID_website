/**
 * The pipeline's pure parts: the weather grid, the cell table, the step clock.
 *
 * These are where the wiring can be silently wrong — a rainfall surface read
 * at the wrong point, a grid thinned so far it is not a map, a clock that
 * wraps and implies the weather repeated.
 */

globalThis.window = globalThis;
import { makeRaster } from "./raster-analysis.js";
const P = await import("./geoid-pipeline.js");

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} — expected ~${b}, got ${a}`);
}
function ok(condition, what) { if (!condition) throw new Error(what); }

const AREA = { minX: -7, minY: 54, maxX: -6, maxY: 55 };

check("the weather grid covers the area and stays inside it", () => {
  const pts = P.weatherPoints(AREA, { across: 4 });
  eq(pts.length, 16, "points");
  pts.forEach((p) => {
    if (p.lon < AREA.minX || p.lon > AREA.maxX) throw new Error("longitude escaped");
    if (p.lat < AREA.minY || p.lat > AREA.maxY) throw new Error("latitude escaped");
  });
});

check("one request carries every point", () => {
  const url = new URL(P.weatherUrl(P.weatherPoints(AREA, { across: 3 })));
  eq(url.searchParams.get("latitude").split(",").length, 9, "latitudes");
  eq(url.searchParams.get("models"), "gfs_seamless", "model");
  eq(url.searchParams.get("forecast_days"), "16", "days");
});

check("the many-point response and the one-point response both parse", () => {
  const one = { latitude: 54.5, longitude: -6.5,
    daily: { time: ["2026-08-16"], precipitation_sum: [4] } };
  eq(P.parseWeatherGrid(one, [{ lat: 54.5, lon: -6.5 }]).series.length, 1, "single object");
  eq(P.parseWeatherGrid([one, one], []).series.length, 2, "array");
});

check("an all-null forecast is refused, not drawn as a dry fortnight", () => {
  const nulls = { daily: { time: ["a", "b"], precipitation_sum: [null, null] } };
  eq(P.parseWeatherGrid(nulls, []).ok, false, "refused");
});

check("rainfall is interpolated between the model's points", () => {
  const series = [
    { lat: 54, lon: -7, rain: [0] },
    { lat: 55, lon: -6, rain: [100] },
  ];
  eq(P.rainAt(series, 54, -7, 0), 0, "on a point returns that point");
  const middle = P.rainAt(series, 54.5, -6.5, 0);
  near(middle, 50, 1, "halfway is halfway");
});

check("the cell table takes slope from the DEM and clips to the area", () => {
  // A ramp falling east: slope is constant and non-zero everywhere.
  const w = 20; const h = 20;
  const band = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = 200 - x * 10;
  const dem = makeRaster(band, w, h, { minX: -7, minY: 54, maxX: -6, maxY: 55 }, NaN);
  const out = P.buildCells(dem, { minX: -6.6, minY: 54.4, maxX: -6.4, maxY: 54.6 });
  eq(out.ok, true, "ok");
  if (!out.cells.length) throw new Error("no cells");
  out.cells.forEach((c) => {
    if (c.lon < -6.61 || c.lon > -6.39) throw new Error("a cell outside the area survived");
    if (!(c.slopeDeg > 0)) throw new Error("a ramp gave zero slope");
    if (!c.material?.friction) throw new Error("no material assigned");
  });
});

check("a big DEM is thinned to a budget, and says by how much", () => {
  const w = 400; const h = 400;
  const dem = makeRaster(new Float32Array(w * h).fill(100), w, h, AREA, NaN);
  const out = P.buildCells(dem, AREA, { maxCells: 2500 });
  eq(out.ok, true, "ok");
  if (out.cells.length > 3000) throw new Error(`${out.cells.length} cells is over budget`);
  if (out.stride < 2) throw new Error("nothing was thinned");
  if (!out.message.includes("spacing")) throw new Error("the thinning was not reported");
});

check("geology reaches the cell as a material", () => {
  // Horn's slope needs a 3x3 neighbourhood, so a 2x2 grid is all no-data and
  // the cell table comes back empty — a fixture too small to have an answer.
  const w = 8; const h = 8;
  const band = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = 100 - x * 5;
  const dem = makeRaster(band, w, h, AREA, NaN);
  const out = P.buildCells(dem, AREA, { geologyAt: () => "ANTRIM BASALT" });
  eq(out.ok, true, "ok");
  eq(out.cells[0].material.matched, "basalt", "matched");
});

check("no cells in the area is a refusal with a reason", () => {
  const dem = makeRaster(Float32Array.from([1]), 1, 1, AREA, NaN);
  eq(P.buildCells(dem, { minX: 10, minY: 10, maxX: 11, maxY: 11 }).ok, false, "refused");
});

check("colours follow the bands, and not-applicable has none", () => {
  eq(JSON.stringify(P.fosColour(0.8)), JSON.stringify([215, 25, 28]), "failure is red");
  eq(P.fosColour(null), null, "flat ground");
  eq(P.fosColour(3) !== null, true, "stable has a colour");
});

check("the clock picks its day, and clamps rather than wrapping", () => {
  const dates = ["2026-08-16", "2026-08-17", "2026-08-18"];
  eq(P.stepForClock(Date.parse("2026-08-17T12:00:00Z"), dates), 1, "middle");
  eq(P.stepForClock(Date.parse("2026-08-10T00:00:00Z"), dates), 0, "before the run");
  // Past the horizon holds the last step: wrapping would imply the weather
  // repeated, which is the one thing a forecast must not say.
  eq(P.stepForClock(Date.parse("2026-09-30T00:00:00Z"), dates), 2, "after the run");
});

/* ── the depth comes from the thickness model, per cell ─────────────────────
   It was a constant per lithology class -- 1.0 to 2.5 m over a whole map --
   because there was nothing spatial to put there. */
check("a cell takes its depth from the thickness model where there is one", () => {
  const dem = makeRaster(new Float32Array(32 * 32).map((_, i) => (i % 32) * 40),
    32, 32, AREA, null);
  const out = P.buildCells(dem, AREA, {
    maxCells: 400,
    geologyAt: () => "TILL",
    // Thin on the west side, a basin on the east.
    thicknessAt: (lat, lon) => (lon < -6.5 ? 0.8 : 40),
  });
  eq(out.ok, true, "built");
  const thin = out.cells.find((c) => c.lon < -6.5);
  const deep = out.cells.find((c) => c.lon >= -6.5);
  near(thin.material.depth, 0.8, 1e-9, "the thin cover is used as measured");
  near(deep.material.depth, 3, 1e-9, "the basin is capped at the shallow plane");
  eq(deep.thicknessM, 40, "and the model's own number is kept beside it");
  // Till's own default is 2.5 m: neither cell is using it.
  ok(thin.material.depth !== 2.5 && deep.material.depth !== 2.5,
    "so the class constant is gone");
  ok(out.modelledDepths === out.cells.length, "every cell was modelled");
  ok(/took their depth from the thickness model/.test(out.message), out.message);
});

check("and keeps the lithology default where the model has no reading", () => {
  const dem = makeRaster(new Float32Array(32 * 32).map((_, i) => (i % 32) * 40),
    32, 32, AREA, null);
  const out = P.buildCells(dem, AREA, {
    maxCells: 400, geologyAt: () => "TILL", thicknessAt: () => null,
  });
  near(out.cells[0].material.depth, 2.5, 1e-9, "till's own default");
  eq(out.modelledDepths, 0, "and the run says none were modelled");
  ok(/0 took their depth/.test(out.message), out.message);
});

check("a run with no thickness reader is unchanged", () => {
  const dem = makeRaster(new Float32Array(32 * 32).map((_, i) => (i % 32) * 40),
    32, 32, AREA, null);
  const out = P.buildCells(dem, AREA, { maxCells: 400, geologyAt: () => "TILL" });
  near(out.cells[0].material.depth, 2.5, 1e-9, "the default stands");
  ok(!/thickness model/.test(out.message), "and the message does not claim otherwise");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
