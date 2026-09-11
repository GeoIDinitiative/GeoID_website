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
    data: new Uint8Array(n).fill(1), model: new Uint8Array(n).fill(1), bare: new Uint8Array(n),
    K: new Float32Array(n).fill(1e-4), zs: new Float32Array(n).fill(2), zf: new Float32Array(n).fill(2),
    slopeRad: new Float32Array(n), c: new Float32Array(n).fill(2), phi: new Float32Array(n).fill(30), gamma: new Float32Array(n).fill(20),
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      cells.slopeRad[i] = y === mid ? Math.atan(0.1) : Math.atan(Math.hypot(tan, 0.1));
      if (y === mid) cells.model[i] = 0;
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
  const capped = staticStep({ rainMm: rain(1000), windowH: 24, cells, topo, lateral: 1, infiltration: true });
  const uncapped = staticStep({ rainMm: rain(1000), windowH: 24, cells, topo, lateral: 1, infiltration: false });
  check("rain faster than Ks runs off rather than recharging", capped.meanW <= uncapped.meanW);
  const bareCells = { ...cells, bare: new Uint8Array(n).fill(1), model: new Uint8Array(n) };
  check("bare rock is never modelled", staticStep({ rainMm: rain(100), windowH: 24, cells: bareCells, topo, lateral: 1 }).applicable === 0);
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
check("the card carries its own ground and declines the shared profile", /profile: false/.test(src)
  && /feature\?\.profile === false\) return;/.test(readFileSync(new URL("./ground-profile.js", import.meta.url), "utf8")));
check("a click on the risk layer is offered to the pipeline BEFORE the polygons under it",
  popup.indexOf("GeoIDLandslidePipeline?.probeAt") > 0 && popup.indexOf("GeoIDLandslidePipeline?.probeAt") < popup.indexOf("const geologyHit = everything.find("));
const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");
check("and the viewer's own geology click yields to the sheet too", /GeoIDLandslidePipeline\.probeAt\(claim\.lat, claim\.lon\)\) return;/.test(viewer)
  && viewer.indexOf("GeoIDLandslidePipeline.probeAt(claim.lat") < viewer.indexOf("openGeoPopup(geologyFeature, surfaceHit.point, clickSpinDelta)"));
