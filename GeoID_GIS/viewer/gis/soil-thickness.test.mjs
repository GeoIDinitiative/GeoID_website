/**
 * Reading a window out of the soil-thickness COG.
 *
 * The arithmetic is pinned because the way it goes wrong is a fixed offset on
 * the ground rather than an error: the layer draws, its legend is right, and
 * it sits beside the coastline instead of on it.
 *
 * Run: node GeoID_GIS/viewer/gis/soil-thickness.test.mjs
 */

import { readFileSync } from "node:fs";
import { cellAt, cellSizeKm, thicknessCard } from "./thickness-probe.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name}: ${error.message}`); }
}
function ok(c, what) { if (!c) throw new Error(what); }
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: ${a} vs ${b}`);
}

const meta = JSON.parse(readFileSync(
  new URL("../../../data/global/soil-thickness/meta.json", import.meta.url), "utf8"));

/* ── the grid the file declares ──────────────────────────────────────────── */

check("the sidecar describes the grid the bake produced", () => {
  ok(meta.grid[0] === 43200 && meta.grid[1] === 18000, `grid ${meta.grid}`);
  ok(meta.bounds.north === 90 && meta.bounds.south === -60, "clipped at 60S");
  ok(meta.noData === 255, `nodata ${meta.noData}`);
  ok(meta.range[0] === 0 && meta.range[1] === 50, `range ${meta.range}`);
});

check("a pixel is 30 arcseconds on both axes", () => {
  const [gw, gh] = meta.grid;
  near((meta.bounds.east - meta.bounds.west) / gw, 1 / 120, 1e-9, "lon");
  near((meta.bounds.north - meta.bounds.south) / gh, 1 / 120, 1e-9, "lat");
});

/* ── the window, and the bounds it is labelled with ──────────────────────── */

/**
 * The window is snapped OUT to whole source pixels, so the image covers up to
 * one pixel more than the request on every side. Labelling it with the REQUEST
 * stretches it onto the wrong ground by up to 30 arcseconds -- 930 m at the
 * equator, which is invisible from orbit and the whole story at a fjord.
 */
check("the read window is reported by the pixels it actually covers", () => {
  const [gw, gh] = meta.grid;
  const px = (lon) => ((lon - meta.bounds.west) / (meta.bounds.east - meta.bounds.west)) * gw;
  const py = (lat) => ((meta.bounds.north - lat) / (meta.bounds.north - meta.bounds.south)) * gh;
  // A request that lands mid-pixel on every side, which is the ordinary case.
  const want = { west: 8.0041, east: 8.5041, north: 46.5041, south: 46.0041 };
  const x0 = Math.floor(px(want.west));
  const x1 = Math.ceil(px(want.east));
  const y0 = Math.floor(py(want.north));
  const y1 = Math.ceil(py(want.south));
  const lon = (x) => meta.bounds.west + (x / gw) * (meta.bounds.east - meta.bounds.west);
  const lat = (y) => meta.bounds.north - (y / gh) * (meta.bounds.north - meta.bounds.south);
  const got = { west: lon(x0), east: lon(x1), north: lat(y0), south: lat(y1) };
  ok(got.west <= want.west && got.east >= want.east, "the read covers the request");
  const offsetDeg = Math.max(Math.abs(got.west - want.west), Math.abs(got.north - want.north));
  ok(offsetDeg > 0, "and differs from it, which is the whole point");
  ok(offsetDeg <= 1 / 120 + 1e-9, `by at most one pixel, not ${offsetDeg}`);
});

check("the module labels the layer with the READ bounds", () => {
  const src = readFileSync(new URL("./soil-thickness.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/minX: read\.bounds\.west/.test(src), "buildRasterLayer is given read.bounds");
  ok(!/minX: bounds\.west/.test(src), "and never the requested bounds");
});

/* ── what a zero means ───────────────────────────────────────────────────── */

/**
 * 0 and nodata are DIFFERENT ANSWERS and the file is careful about it: the sea
 * is -1 (stored 255) and bare rock is 0. Measured over a 3x2 degree window on
 * New Zealand: 47,151 valid cells, of which 16.4% are exactly 0 -- the
 * Southern Alps, which is precisely the ground a landslide study is about.
 * Turning 0 into nodata would throw that distinction away in the data as well
 * as in the picture.
 */
check("nodata is the file's own, and zero is not it", () => {
  ok(meta.noData === 255 && meta.range[0] === 0, "0 is inside the valid range");
  ok(/-1 in the source is nodata/.test(meta.note), "the sidecar says what -1 was");
});

/* ── the click: which cell, and what the card says about it ──────────────── */

/**
 * A CLICK IS ANSWERED FROM THE CELL IT LANDS IN, and the way that goes wrong
 * is silent: an index off by one returns a plausible number for the wrong
 * kilometre, and nothing on the card looks amiss.
 */
check("a point resolves to the cell that contains it", () => {
  const at = cellAt(54.9832, -7.6591, meta);
  ok(!at.outside, "Inishowen is inside the grid");
  const size = (meta.bounds.east - meta.bounds.west) / meta.grid[0];
  // The cell's own ground contains the point, on both axes, by construction.
  ok(at.west <= -7.6591 && -7.6591 < at.west + size, `lon ${at.west}`);
  ok(at.north >= 54.9832 && 54.9832 > at.north - size, `lat ${at.north}`);
  // ...and it is floor, not round: a point in the eastern half of a cell
  // belongs to that cell, not to the nearer centre next door.
  const east = cellAt(54.9832, at.west + size * 0.9, meta);
  ok(east.x === at.x, `east half stayed in the cell: ${east.x} vs ${at.x}`);
});

check("the grid's own corners land on its first and last cells", () => {
  const [gw, gh] = meta.grid;
  const size = (meta.bounds.east - meta.bounds.west) / gw;
  const nw = cellAt(meta.bounds.north, meta.bounds.west, meta);
  ok(nw.x === 0 && nw.y === 0, `north-west ${nw.x},${nw.y}`);
  const se = cellAt(meta.bounds.south, meta.bounds.east - size / 2, meta);
  ok(se.x === gw - 1 && se.y === gh - 1, `south-east ${se.x},${se.y}`);
});

/**
 * 180E IS 180W -- one meridian, and the grid's first column starts there. A
 * boundary belongs to the cell east of it, and east of the antimeridian is
 * column 0, so the wrap answering 0 for +180 is the right answer rather than
 * the clamp it looks like.
 */
check("the antimeridian belongs to the column that starts at it", () => {
  ok(cellAt(0, 180, meta).x === 0, "180E lands on the first column");
  ok(cellAt(0, -180, meta).x === 0, "and so does 180W, which is the same line");
  const last = cellAt(0, 179.999, meta);
  ok(last.x === meta.grid[0] - 1, `just west of it is the last column: ${last.x}`);
});

/**
 * The Mars side of this codebase works in 0..360 and this viewer in -180..180.
 * An unwrapped 352 indexes off the end and clamps to the last column, which
 * answers for the Bering Strait a click on Ireland.
 */
check("longitude is wrapped before it is indexed", () => {
  const west = cellAt(54.98, -7.66, meta);
  const same = cellAt(54.98, 352.34, meta);
  ok(same.x === west.x, `${same.x} vs ${west.x}`);
});

check("south of the model's edge is outside, not clamped to its last row", () => {
  const at = cellAt(-72, 0, meta);
  ok(at.outside, "Antarctica is outside a model clipped at 60S");
  ok(thicknessCard(at, meta).title === "Outside the model", "and the card says so");
});

check("a 30 arcsecond cell is not square, and shrinks with latitude", () => {
  const size = (meta.bounds.east - meta.bounds.west) / meta.grid[0];
  const equator = cellSizeKm(0, size);
  near(equator.height, 0.9277, 0.01, "a cell is about 930 m tall");
  near(equator.width, equator.height, 1e-6, "and as wide at the equator");
  ok(cellSizeKm(60, size).width < equator.width * 0.55, "half as wide at 60N");
});

/**
 * NODATA AND ZERO ARE DIFFERENT ANSWERS all the way to the card. The file
 * keeps them apart (255 against 0); throwing that away at the last step -- by
 * printing "0 m" for the Atlantic -- would be the same loss, later.
 */
check("the card never prints a number the model did not give", () => {
  const cell = cellAt(54.98, -7.66, meta);
  const sea = thicknessCard({ ...cell, metres: null }, meta);
  ok(sea.title === "Not modelled here", `title ${sea.title}`);
  ok(!/\d\s*m\b/.test(sea.title), "and no metres in it");
  const rock = thicknessCard({ ...cell, metres: 0 }, meta);
  ok(rock.title === "0 m", `a real zero keeps its number: ${rock.title}`);
  ok(/bedrock/i.test(rock.meta), "with the line that says what zero means");
  const soil = thicknessCard({ ...cell, metres: 12 }, meta);
  ok(soil.title === "12 m", `title ${soil.title}`);
});

check("the card says the number is a model's, for a whole cell", () => {
  const card = thicknessCard({ ...cellAt(54.98, -7.66, meta), metres: 12 }, meta);
  const basis = card.rows.find(([key]) => key === "Basis");
  ok(basis && /not a measurement/i.test(basis[1]), "the basis line is on the card");
  ok(card.source === meta.credit, "and Pelletier is credited");
  ok(card.headline.some(([key]) => key === "Sampled at"), "the point is stated");
});

/* ── the wiring ──────────────────────────────────────────────────────────── */

/**
 * A sheet has no features, so the click lands in the branch that dismisses the
 * card for hitting nothing. That is what made the map unclickable, and it is
 * one line -- so the line is pinned.
 */
check("a click on nothing is offered to the sheet before it is dismissed", () => {
  const src = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
  const claim = src.indexOf("GeoIDSoilThickness?.probeAt");
  const dismiss = src.indexOf("clearSceneFlash?.()", claim);
  ok(claim > 0, "the popup offers the click to the thickness sheet");
  ok(dismiss > claim, "before it dismisses the card");
});

check("the sheet answers from the file, not from the drawn texture", () => {
  const src = readFileSync(new URL("./soil-thickness.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/readRasters\(\{\s*window: \[cell\.x, cell\.y, cell\.x \+ 1, cell\.y \+ 1\]/.test(src),
    "sampleAt reads a one-pixel window at full resolution");
  ok(/soil: true/.test(src), "and the card refuses the rock-property fold");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
