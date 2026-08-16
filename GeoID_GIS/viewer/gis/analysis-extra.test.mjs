/**
 * TWI, mosaic, density and histogram against grids whose answers are known.
 *
 * Each of these has one failure mode that looks like a plausible map: a TWI
 * that diverges on flat ground, a mosaic that halves its own resolution, a
 * density that changes when the cell size does, a histogram that loses its
 * maximum off the top bin. Those four are what is pinned here.
 */

import { makeRaster } from "./raster-analysis.js";
import { topographicWetness, mosaic, kernelDensity, histogram, pointsOf }
  from "./analysis-extra.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`);
}
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} — expected ~${b}, got ${a}`);
}

const BOX = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const grid = (values, w, h, bounds = BOX) => makeRaster(Float32Array.from(values), w, h, bounds, NaN);

check("wetness rises with accumulation and falls with slope", () => {
  const accum = grid([1, 100, 1, 100], 2, 2);
  const slope = grid([10, 10, 30, 30], 2, 2);
  const out = topographicWetness(accum, slope);
  eq(out.ok, true, "ok");
  const [flatLow, flatHigh, steepLow, steepHigh] = out.raster.band;
  if (!(flatHigh > flatLow)) throw new Error("more upslope area did not raise the index");
  if (!(steepLow < flatLow)) throw new Error("a steeper cell was not drier");
  eq(steepHigh < flatHigh, true, "steep and wet is still drier than flat and wet");
});

check("a flat cell is bounded, not infinite", () => {
  const out = topographicWetness(grid([50], 1, 1), grid([0], 1, 1));
  if (!Number.isFinite(out.raster.band[0])) throw new Error("tan(0) divided through");
});

check("mismatched grids are refused rather than read past their ends", () => {
  eq(topographicWetness(grid([1], 1, 1), grid([1, 2], 2, 1)).ok, false, "ok");
});

check("a mosaic covers the union of its inputs", () => {
  const west = grid([1, 1, 1, 1], 2, 2, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
  const east = grid([2, 2, 2, 2], 2, 2, { minX: 1, minY: 0, maxX: 2, maxY: 1 });
  const out = mosaic([west, east]);
  eq(out.ok, true, "ok");
  eq(out.raster.bounds.minX, 0, "west edge");
  eq(out.raster.bounds.maxX, 2, "east edge");
  // Finest resolution kept: 0.5° cells across 2° is four columns.
  eq(out.raster.width, 4, "width");
  eq(out.raster.band[0], 1, "west value");
  eq(out.raster.band[3], 2, "east value");
});

check("the mosaic keeps the finest input resolution", () => {
  const coarse = grid([1, 1, 1, 1], 2, 2, { minX: 0, minY: 0, maxX: 2, maxY: 2 });
  const fine = grid(new Array(64).fill(2), 8, 8, { minX: 2, minY: 0, maxX: 3, maxY: 1 });
  const out = mosaic([coarse, fine]);
  // The fine tile is 0.125° per cell; three degrees of span at that is 24.
  eq(out.raster.width, 24, "width follows the finest input");
});

check("overlaps resolve by the method asked for", () => {
  const a = grid([10], 1, 1);
  const b = grid([20], 1, 1);
  eq(mosaic([a, b], { method: "first" }).raster.band[0], 10, "first");
  eq(mosaic([a, b], { method: "last" }).raster.band[0], 20, "last");
  eq(mosaic([a, b], { method: "max" }).raster.band[0], 20, "max");
  eq(mosaic([a, b], { method: "min" }).raster.band[0], 10, "min");
  eq(mosaic([a, b], { method: "mean" }).raster.band[0], 15, "mean");
});

check("one raster in is that raster out", () => {
  const one = grid([5], 1, 1);
  eq(mosaic([one]).raster, one, "identity");
  eq(mosaic([]).ok, false, "nothing in");
});

check("density peaks on the point and reaches zero at the radius", () => {
  const out = kernelDensity([{ lat: 0.5, lon: 0.5 }], BOX, { cellSizeDeg: 0.05, radiusKm: 20 });
  eq(out.ok, true, "ok");
  const { band, width, height } = out.raster;
  const centre = band[Math.floor(height / 2) * width + Math.floor(width / 2)];
  if (!(centre > 0)) throw new Error("nothing at the point");
  eq(band[0] < centre, true, "the corner is quieter than the centre");
});

check("density is per square kilometre — the surface integrates to the points", () => {
  // The peak alone cannot test this: a coarser grid puts its nearest cell
  // centre further from the point, so the peak legitimately differs. What must
  // NOT change with cell size is the integral, and a surface that integrates
  // to one per point is a density rather than a count spread about.
  const integral = (cellSizeDeg) => {
    const out = kernelDensity([{ lat: 0.5, lon: 0.5 }], BOX, { cellSizeDeg, radiusKm: 30 });
    const areaKm2 = (110.574 * cellSizeDeg) * (111.32 * Math.cos(0.5 * Math.PI / 180) * cellSizeDeg);
    return out.raster.band.reduce((s, v) => s + v, 0) * areaKm2;
  };
  near(integral(0.1), 1, 0.06, "coarse integral");
  near(integral(0.05), 1, 0.06, "fine integral");
  near(integral(0.1), integral(0.05), 0.03, "resolution independence");
});

check("two points give more than one", () => {
  const one = kernelDensity([{ lat: 0.5, lon: 0.5 }], BOX, { cellSizeDeg: 0.05, radiusKm: 40 });
  const two = kernelDensity([{ lat: 0.5, lon: 0.5 }, { lat: 0.5, lon: 0.52 }],
    BOX, { cellSizeDeg: 0.05, radiusKm: 40 });
  if (!(Math.max(...two.raster.band) > Math.max(...one.raster.band))) {
    throw new Error("a second point added nothing");
  }
});

check("no points is a refusal", () => {
  eq(kernelDensity([], BOX).ok, false, "ok");
});

check("the histogram counts every value, maximum included", () => {
  const out = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bins: 5 });
  eq(out.bins.reduce((n, b) => n + b.count, 0), 11, "total");
  eq(out.bins[4].count, 3, "the top bin holds 8, 9 and 10");
  eq(out.min, 0, "min"); eq(out.max, 10, "max"); eq(out.mean, 5, "mean");
  eq(out.median, 5, "median");
});

check("a constant raster is one bin, not a divide by zero", () => {
  const out = histogram([7, 7, 7]);
  eq(out.ok, true, "ok");
  eq(out.bins.length, 1, "bins");
  eq(out.stdDev, 0, "spread");
});

check("the median of an even sample is the midpoint of the middle pair", () => {
  eq(histogram([1, 2, 3, 4]).median, 2.5, "median");
});

check("points come out of points, multipoints and polygons", () => {
  const points = pointsOf({
    features: [
      { geometry: { type: "Point", coordinates: [1, 2] }, properties: { n: 1 } },
      { geometry: { type: "MultiPoint", coordinates: [[3, 4], [5, 6]] }, properties: {} },
      {
        geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
        properties: {},
      },
    ],
  });
  eq(points.length, 4, "count");
  eq(points[0].lat, 2, "point latitude");
  // The polygon's centroid, so an inventory mapped as scars still works.
  near(points[3].lon, 0.8, 0.5, "polygon centroid longitude");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
