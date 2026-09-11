/**
 * The forecast landslide pipeline: its pure pieces run, the static model on a
 * synthetic hillslope, and the wiring pinned. Run with
 * `node landslide-pipeline.test.mjs`.
 */
import { readFileSync } from "node:fs";
import {
  demGridFor, withMargin, autoMarginKm, samplerOver, lithologyOf, groundText, stateOf, textureOf,
  staticStep, readiness, hornAt, cellSlope,
} from "./landslide-pipeline.js";
import { mfdTopology, fillSinks } from "./hydrology.js";
import { makeRaster } from "./raster-analysis.js";
import { useRockProperties, resolveLithology } from "./rock-properties.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`landslide-pipeline: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

useRockProperties(JSON.parse(readFileSync(new URL("../../data/global/rock-properties.json", import.meta.url), "utf8")));

/* ── the grid, the margin, the maps' words ────────────────────────────────── */

{
  const grid = demGridFor({ west: 0, east: 0.1, south: 0, north: 0.1 }, () => 10, { maxCells: 500 });
  check("a grid over the area at about the cell budget", grid.width * grid.height <= 520 && grid.known === grid.width * grid.height);
  const b = { west: 11.55, east: 11.95, south: 44.05, north: 44.3 };
  const m = withMargin(b, 2);
  check("the margin widens the box by its kilometres", Math.abs((b.south - m.south) * 110.574 - 2) < 1e-9
    && m.west < b.west && m.east > b.east);
  check("the auto margin is a tenth of the larger side, at least 1 km, at most 5", Math.abs(autoMarginKm(b) - 3.19) < 0.02
    && autoMarginKm({ west: 0, east: 0.01, south: 0, north: 0.01 }) === 1 && autoMarginKm({ west: 0, east: 5, south: 0, north: 5 }) === 5);
  const sampler = samplerOver([{ properties: { lith: "till" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }], lithologyOf);
  check("a point inside a unit reads its lithology, outside nothing", sampler(0.5, 0.5) === "till" && sampler(2, 2) === null);
  check("GLiM's unconsolidated class reads as alluvium, never the rock prior", groundText("Unconsolidated Sediments") === "alluvium"
    && stateOf(groundText("Unconsolidated Sediments"), resolveLithology) === "soil");
  check("a deposit is soil, a bedrock is rock, and nothing is nothing", stateOf("alluvium, till", resolveLithology) === "soil"
    && stateOf("Major:{claystone}, Minor{siltstone}", resolveLithology) === "rock" && stateOf("", resolveLithology) === null);
  check("a Histosol is peat, a non-soil has no texture, a soil its fractions",
    textureOf({ group: "HISTOSOLS", name: "Dystric Histosols" }).peat === true
    && textureOf({ group: "Not a soil", name: "Water" }) === null
    && textureOf({ group: "CAMBISOLS", sand_pct: 40, silt_pct: 35, clay_pct: 25 }).clay === 25);
}

/* ── the static model on a hillslope with a hollow ────────────────────────── */

{
  // A V-valley draining east, 20° side slopes, ~11 m cells: one material, one column.
  // K here IS the lateral conductivity, so the lateral factor is 1.
  const w = 40; const h = 41; const mid = 20; const n = w * h;
  const cellM = 1e-4 * 111320;
  const tan = Math.tan(20 * Math.PI / 180);
  const band = new Float32Array(n);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = 500 - 0.1 * cellM * x + tan * cellM * Math.abs(y - mid);
  const dem = makeRaster(band, w, h, { minX: 0, maxX: w * 1e-4, minY: 0, maxY: h * 1e-4 }, NaN);
  const topo = mfdTopology(fillSinks(dem));
  const cells = {
    data: new Uint8Array(n).fill(1), model: new Uint8Array(n).fill(1),
    K: new Float32Array(n).fill(1e-4), zs: new Float32Array(n).fill(2), zf: new Float32Array(n).fill(2),
    slopeRad: new Float32Array(n), c: new Float32Array(n).fill(2), phi: new Float32Array(n).fill(30), gamma: new Float32Array(n).fill(20),
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      cells.slopeRad[i] = y === mid ? Math.atan(0.1) : Math.atan(Math.hypot(tan, 0.1));
    }
  }
  const rain = (mm) => new Float32Array(n).fill(mm);
  const dry = staticStep({ rainMm: rain(0), windowH: 24, cells, topo, lateral: 1 });
  check("no rain, no water table anywhere", dry.meanW === 0 && dry.failing === 0);
  const wet = staticStep({ rainMm: rain(30), windowH: 24, cells, topo, lateral: 1 });
  const nearAxis = wet.W[(mid - 1) * w + 30]; const ridge = wet.W[1 * w + 30];
  check("the hollow's flank saturates before the ridge above it", nearAxis > 3 * ridge, `${nearAxis} against ${ridge}`);
  const wetter = staticStep({ rainMm: rain(90), windowH: 24, cells, topo, lateral: 1 });
  check("more rain, more cells failing, and never fewer", wetter.failing >= wet.failing && wetter.failing > dry.failing,
    `${dry.failing} → ${wet.failing} → ${wetter.failing}`);
  const firstFail = [...Array(n).keys()].filter((i) => wetter.fos[i] < 1).map((i) => Math.abs(Math.floor(i / w) - mid));
  const meanDist = firstFail.reduce((a, b) => a + b, 0) / Math.max(1, firstFail.length);
  check("and what fails is next to the hollow, not up on the ridge", firstFail.length > 0 && meanDist < mid / 2, `mean ${meanDist}`);
  const axis = mid * w + 30;
  check("the valley floor gets a water table and a factor of safety — large, and stable",
    Number.isFinite(wet.W[axis]) && wet.fos[axis] > 1.5, `${wet.W[axis]} / ${wet.fos[axis]}`);
  const capped = staticStep({ rainMm: rain(1000), windowH: 24, cells, topo, lateral: 1, infiltration: true });
  const uncapped = staticStep({ rainMm: rain(1000), windowH: 24, cells, topo, lateral: 1, infiltration: false });
  check("rain faster than Ks runs off rather than recharging", capped.meanW <= uncapped.meanW);
  check("every cell is modelled, the valley floor included", staticStep({ rainMm: rain(100), windowH: 24, cells, topo, lateral: 1 }).applicable === n);
}

{
  // Horn at a post spacing, on a plane rising 0.5 m per metre east: 26.57°.
  const post = 27; const lat0 = 44;
  const heightAt = (lat, lon) => (lon - 11) * 111320 * Math.cos(lat0 * Math.PI / 180) * 0.5;
  const deg = hornAt(heightAt, lat0, 11.2, post / (111320 * Math.cos(lat0 * Math.PI / 180)), post / 110574, post);
  check("the native-post slope is Horn's on a plane", Math.abs(deg - Math.atan(0.5) * 180 / Math.PI) < 0.05, String(deg));
  check("and refuses where the DEM has a hole", Number.isNaN(hornAt(() => NaN, 44, 11, 1e-4, 1e-4, 27)));
  const q = 30 / 110574;
  check("a cell's slope on a plane is the plane's, whichever four points it reads",
    Math.abs(cellSlope(heightAt, lat0, 11.2, q, q, post / (111320 * Math.cos(lat0 * Math.PI / 180)), post / 110574, post) - Math.atan(0.5) * 180 / Math.PI) < 0.05);
}
check("readiness gates each step on the one above", readiness({ bounds: null, rain: null, ground: null, run: null }).rain === "blocked"
  && readiness({ bounds: {}, rain: null, ground: null, run: null }).rain === "ready"
  && readiness({ bounds: {}, rain: {}, ground: null, run: null }).run === "blocked");

/* ── wired in ─────────────────────────────────────────────────────────────── */

const src = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
check("the rainfall is GFS, by date — the ERA5 archive is gone", /fetchGfsNodes\(cover/.test(src) && !/archive-api\.open-meteo/.test(src));
check("the GFS nodes cover the upslope margin, where water drains in from", /const cover = withMargin\(b, marginKm\(\)\)/.test(src));
check("a borrowed streaming layer is given back, whatever happens", /finally \{\s*borrowed\.forEach\(\(l\) => \{ try \{ l\.restoreLive\?\.\(\); \}/.test(src));
check("the routing is multiple-flow-direction on the sink-filled DEM", /mfdTopology\(filled, \{ exponent: 1\.1 \}\)/.test(src)
  && /fillSinks\(makeRaster\(grid\.band/.test(src));
check("the layer carries its working", /maths: mathsFor\("landslide-forecast"\)/.test(src)
  && /"landslide-forecast": \{/.test(readFileSync(new URL("./equations.js", import.meta.url), "utf8")));
check("the slope is read at the DEM's own posts when the grid is coarser", /if \(post && grid\.stepM > 1\.5 \* post\)/.test(src));
check("lateral flow is a control, with the stated default", /lateral: LATERAL_FACTOR/.test(src) && /id="lsp-lateral"/.test(src));
check("the drawn sheet is bounded by its cells' edges, not the asked box", /sub\.bounds = \{ minX: eb\.west \+ x0 \* cw/.test(src));

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check("the page hosts the flowchart in the Landslides subtab and loads the module", /id="landslide-pipeline"/.test(html) && /gis\/landslide-pipeline\.js\?v=/.test(html));
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
check("no cell is left out for its slope or its thin soil", !/MIN_SLOPE_DEG/.test(src) && !/not modelled/.test(src)
  && /cells\.model\[i\] = 1; tally\.model \+= 1;/.test(src));
check("the card carries its own ground and declines the shared profile", /profile: false/.test(src)
  && /feature\?\.profile === false\) return;/.test(readFileSync(new URL("./ground-profile.js", import.meta.url), "utf8")));
check("a click on the risk layer is offered to the pipeline BEFORE the polygons under it",
  popup.indexOf("GeoIDLandslidePipeline?.probeAt") > 0 && popup.indexOf("GeoIDLandslidePipeline?.probeAt") < popup.indexOf("const geologyHit = everything.find("));
const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
check("and the viewer's own geology click yields to the sheet too", /GeoIDLandslidePipeline\.probeAt\(claim\.lat, claim\.lon\)\) return;/.test(viewer)
  && viewer.indexOf("GeoIDLandslidePipeline.probeAt(claim.lat") < viewer.indexOf("openGeoPopup(geologyFeature, surfaceHit.point, clickSpinDelta)"));

/* ── two sources, one series ──────────────────────────────────────────────── */

import { planRain, dailyFrames } from "./landslide-pipeline.js";
import { decodeRainPixels, pixelIndex, coversBox, daysBetween } from "./gee-rain.js";
import { dayHours, rainfallFrames } from "./gfs-rain.js";

{
  const gee = { first: "1981-01-01", last: "2026-07-31" };
  const auto = planRain({ source: "auto", start: "2026-07-29", end: "2026-08-02", windowH: 24, today: "2026-09-11", gee, covers: true });
  check("auto takes Earth Engine for the days it holds and GFS after", auto.ok
    && auto.geeDays.join() === "2026-07-29,2026-07-30,2026-07-31" && auto.gfsDays.join() === "2026-08-01,2026-08-02", JSON.stringify(auto));
  const old = planRain({ source: "auto", start: "2019-05-10", end: "2019-05-12", windowH: 48, today: "2026-09-11", gee, covers: true });
  check("years before GFS's archive come from Earth Engine, the window's lead day included",
    old.ok && old.gfsDays.length === 0 && old.days[0] === "2019-05-09" && old.windowDays === 2);
  const north = planRain({ source: "auto", start: "2023-05-14", end: "2023-05-18", windowH: 24, today: "2026-09-11", gee, covers: false });
  check("beyond CHIRPS's 50° auto hands every day to GFS", north.ok && north.geeDays.length === 0 && north.gfsDays.length === 5);
  check("but a pre-2021 window there is refused, not invented",
    !planRain({ source: "auto", start: "2019-05-10", end: "2019-05-12", windowH: 24, today: "2026-09-11", gee, covers: false }).ok);
  const named = planRain({ source: "chirps", start: "2026-07-29", end: "2026-08-02", windowH: 24, today: "2026-09-11", gee, covers: true });
  check("a named archive refuses the days it does not have rather than borrowing them", !named.ok && /Auto/.test(named.message));
  check("nothing forecasts past fifteen days", !planRain({ source: "auto", start: "2026-09-20", end: "2026-09-30", windowH: 24, today: "2026-09-11", gee, covers: true }).ok);
  const frames = dailyFrames(auto);
  check("one map a day from the start, each the window's days, and a handover map says it is mixed",
    frames.length === 5 && frames[0].time === "2026-07-29" && frames[2].source === "gee" && frames[3].source === "gfs");
  const wide = dailyFrames(planRain({ source: "auto", start: "2026-07-30", end: "2026-08-01", windowH: 48, today: "2026-09-11", gee, covers: true }));
  check("a two-day window straddling the handover sums one day of each", wide[1].parts.map((p) => p.source).join() === "gee,gee"
    && wide[2].source === "mixed" && wide[2].parts.map((p) => p.day).join() === "2026-07-31,2026-08-01");
}

{
  // A 2 x 1 picture on the service's own CHIRPS ramp: white is 0, the second
  // stop (bfe9ff) is 100 mm; a transparent pixel is no value.
  const data = Uint8ClampedArray.from([255, 255, 255, 255, 191, 233, 255, 255, 0, 0, 0, 0]);
  const v = decodeRainPixels(data, 3, 1, { palette: ["ffffff", "bfe9ff", "2f6bff", "0b2f8a"], legend: { min: 0, max: 300 } });
  check("a render reads back to millimetres along its ramp", Math.abs(v[0]) < 0.6 && Math.abs(v[1] - 100) < 1.5 && Number.isNaN(v[2]), [...v].join());
  const grid = { width: 10, height: 5, bounds: { minX: 11, maxX: 12, minY: 44, maxY: 44.5 } };
  check("a cell reads the pixel it falls in, and nothing outside", pixelIndex(grid, 44.49, 11.01) === 0
    && pixelIndex(grid, 44.01, 11.99) === 49 && pixelIndex(grid, 45, 11.5) === -1);
  check("CHIRPS stops at 50° of latitude", coversBox("chirps", { south: 44, north: 44.5 }) && !coversBox("chirps", { south: 54, north: 55 }));
  check("days are inclusive", daysBetween("2023-05-30", "2023-06-02").join() === "2023-05-30,2023-05-31,2023-06-01,2023-06-02");
}

{
  // A UTC day is 01:00 to the next day's 00:00, since the value at T is the hour ending at T.
  const times = Array.from({ length: 72 }, (_, t) => new Date(Date.UTC(2023, 4, 14) + t * 3600000).toISOString().slice(0, 16));
  const h = dayHours(times, "2023-05-15");
  check("a UTC day's hours end at the next midnight", times[h.lo] === "2023-05-15T01:00" && times[h.hi] === "2023-05-16T00:00");
  const s = rainfallFrames(times, [{ lat: 0, lon: 0, rain: Float32Array.from({ length: 72 }, () => 1) }], { start: "2023-05-14", windowH: 1, everyH: 1 });
  check("and summing them gives the day's total", s.accumulateRange(h.lo, h.hi)[0] === 24);
}
