/**
 * Reading values back out of a GEE drape.
 *
 * Every failure here is silent and confident: a wrong inverse produces a
 * plausible number in a spreadsheet, and a missing distance guard turns ocean
 * into rainfall. So the round trip is checked against values pushed through the
 * *forward* rendering first — colour in, value out, compared with what went in.
 *
 * Run: node GeoID_GIS/viewer/gis/gee-sample.test.mjs
 */

import {
  parseHex, paletteRamp, valueFromColour, pixelFor, columnName, makeSampler,
  MAX_RAMP_DISTANCE,
} from "./gee-sample.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const close = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

// The real CHIRPS rainfall entry from the cache manifest.
const CHIRPS = ["ffffff", "bfe9ff", "2f6bff", "0b2f8a"];
const RAIN = { label: "Rainfall", min: 0, max: 300, unit: "mm" };
// And the diverging anomaly palette, which is not monotonic in brightness.
const LST = { label: "Day LST", min: -13, max: 57, unit: "°C" };
const LST_PALETTE = ["040274", "3ac2ff", "ffd25f", "ff6f31", "911003"];

// ── Colours ──────────────────────────────────────────────────────────────────
check("a hex stop parses", JSON.stringify(parseHex("ff6f31")) === JSON.stringify({ r: 255, g: 111, b: 49 }));
check("a leading hash is allowed", parseHex("#0b2f8a").b === 138);
check("nonsense is not a colour", parseHex("zzz") === null);
check("and neither is a short string", parseHex("fff") === null);

// ── The ramp ─────────────────────────────────────────────────────────────────
{
  const ramp = paletteRamp(CHIRPS, 256);
  check("the ramp spans the stops", ramp.length === 256);
  check("it starts at the first stop", ramp[0].r === 255 && ramp[0].g === 255 && ramp[0].b === 255);
  check("and ends at the last", Math.round(ramp[255].r) === 11 && Math.round(ramp[255].b) === 138);
  check("a single stop is not a ramp", paletteRamp(["ffffff"]) === null);
  check("no palette, no ramp", paletteRamp(null) === null);
}

// ── The round trip, which is the whole point ─────────────────────────────────
// Push a value forward through the rendering (value -> t -> colour), then read
// it back. Anything that does not survive this is not an inverse.
{
  const ramp = paletteRamp(CHIRPS);
  const render = (value) => {
    const t = (value - RAIN.min) / (RAIN.max - RAIN.min);
    const entry = ramp[Math.round(t * (ramp.length - 1))];
    // Rendered as 8-bit, as a PNG is.
    return { r: Math.round(entry.r), g: Math.round(entry.g), b: Math.round(entry.b), a: 255 };
  };
  let worst = 0;
  for (const mm of [0, 12, 40, 75, 120, 180, 240, 300]) {
    const back = valueFromColour(render(mm), ramp, RAIN);
    check(`${mm} mm survives the round trip`, back !== null, `${back}`);
    if (back !== null) worst = Math.max(worst, Math.abs(back - mm));
  }
  // The quantisation is real and worth stating: this is a reading of a picture.
  check("and does so within a few mm", worst < 4, `worst ${worst.toFixed(2)} mm`);
}
{
  // The same, on a five-stop diverging palette through its middle.
  const ramp = paletteRamp(LST_PALETTE);
  const render = (value) => {
    const t = (value - LST.min) / (LST.max - LST.min);
    const e = ramp[Math.round(t * (ramp.length - 1))];
    return { r: Math.round(e.r), g: Math.round(e.g), b: Math.round(e.b), a: 255 };
  };
  let worst = 0;
  for (const c of [-13, -5, 0, 12, 22, 35, 48, 57]) {
    const back = valueFromColour(render(c), ramp, LST);
    if (back === null) { check(`${c} °C survives`, false); continue; }
    worst = Math.max(worst, Math.abs(back - c));
  }
  check("a five-stop palette inverts too", worst < 1.5, `worst ${worst.toFixed(2)} °C`);
}

// ── The guard that stops it lying ────────────────────────────────────────────
{
  const ramp = paletteRamp(CHIRPS);
  check("a transparent pixel is not a reading",
    valueFromColour({ r: 47, g: 107, b: 255, a: 0 }, ramp, RAIN) === null);
  // Ocean green under a blue-white rainfall ramp is background, not 0 mm. This
  // is the check that keeps a bounding box from becoming a claim of data.
  check("a colour off the ramp is not a reading",
    valueFromColour({ r: 30, g: 160, b: 60, a: 255 }, ramp, RAIN) === null,
    `${valueFromColour({ r: 30, g: 160, b: 60, a: 255 }, ramp, RAIN)}`);
  check("nor is one just past the tolerance",
    valueFromColour({ r: 255, g: 255 - MAX_RAMP_DISTANCE - 20, b: 255, a: 255 }, ramp, RAIN) === null);
  check("no legend, no value",
    valueFromColour({ r: 255, g: 255, b: 255, a: 255 }, ramp, null) === null);
  check("a legend without a range is no legend",
    valueFromColour({ r: 255, g: 255, b: 255, a: 255 }, ramp, { min: null, max: 300 }) === null);
}

// ── Placing a coordinate in the image ────────────────────────────────────────
{
  const world = { minX: -180, minY: -85, maxX: 180, maxY: 85 };
  const at = pixelFor(0, 0, world, 1024, 512);
  check("the origin lands mid-image", at.px === 512 && at.py === 256, JSON.stringify(at));
  check("the north-west corner is the top left",
    JSON.stringify(pixelFor(85, -180, world, 1024, 512)) === JSON.stringify({ px: 0, py: 0 }));
  check("beyond the bounds is not sampled", pixelFor(89, 0, world, 1024, 512) === null);
  // The viewer carries east-positive 0-360 in places; the image is signed.
  const wrapped = pixelFor(0, 300, world, 1024, 512);
  check("east-positive longitude is wrapped into the image's own convention",
    wrapped && wrapped.px === pixelFor(0, -60, world, 1024, 512).px, JSON.stringify(wrapped));
  check("a degenerate box samples nothing",
    pixelFor(0, 0, { minX: 1, minY: 1, maxX: 1, maxY: 1 }, 10, 10) === null);
}

// ── Naming ───────────────────────────────────────────────────────────────────
check("the unit rides on the column name",
  columnName("Rainfall (CHIRPS) · 2026-06-08–2026-08-07", RAIN) === "Rainfall_CHIRPS_mm",
  columnName("Rainfall (CHIRPS) · 2026-06-08–2026-08-07", RAIN));
check("no unit, no unit suffix", columnName("Vegetation health (NDVI)", { min: 0, max: 1, unit: "" })
  === "Vegetation_health_NDVI");

// ── The sampler end to end, with a fake image ────────────────────────────────
{
  const ramp = paletteRamp(CHIRPS);
  const mid = ramp[Math.round(0.5 * (ramp.length - 1))];
  // Left half is 150 mm, right half is transparent nodata.
  const read = (px) => (px < 5
    ? { r: Math.round(mid.r), g: Math.round(mid.g), b: Math.round(mid.b), a: 255 }
    : { r: 0, g: 0, b: 0, a: 0 });
  const sampler = makeSampler({
    read, bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    width: 10, height: 10, palette: CHIRPS, legend: RAIN,
  });
  close("a sample in the data reads its value", sampler(0, -5), 150, 4);
  check("a sample in the nodata reads nothing", sampler(0, 5) === null);
  check("a sample outside the drape reads nothing", sampler(80, 0) === null);

  // Without a legend there is no inverse, so the colour comes back AS a colour
  // rather than as a number nobody could check.
  const raw = makeSampler({
    read, bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    width: 10, height: 10, palette: null, legend: null,
  })(0, -5);
  check("no legend returns the colour, not a number",
    raw && typeof raw === "object" && "r" in raw, JSON.stringify(raw));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
