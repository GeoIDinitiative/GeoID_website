/**
 * The forecast landslide pipeline: the pure pieces, run.
 */
import { readFileSync } from "node:fs";
import { archiveUrl, bucketFor, demGridFor, samplerOver, lithologyOf, runSteps, readiness, HYDRO_DEFAULTS } from "./landslide-pipeline.js";
import { materialFor } from "./fos.js";

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass += 1;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
};

/* ── rainfall by date ─────────────────────────────────────────────────────── */
const url = archiveUrl([{ lat: 54.5, lon: -6.5 }], { start: "2024-01-01", end: "2024-01-31" });
check("the archive is asked by date, hourly, in UTC", /archive-api\.open-meteo\.com/.test(url) && /start_date=2024-01-01/.test(url) && /hourly=precipitation/.test(url) && /timezone=UTC/.test(url), true);

/* ── the bucket is the ground's own ───────────────────────────────────────── */
const clay = bucketFor({ porosity: 0.45, conductivity: 1e-9, depthM: 2, slopeDeg: 20 });
const gravel = bucketFor({ porosity: 0.3, conductivity: 1e-3, depthM: 2, slopeDeg: 20 });
check("capacity is the pore space of the column, in mm", clay.capacityMm, 900);
check("a clay drains at the floor and a gravel at the ceiling", [clay.drainPerDay, gravel.drainPerDay], [0.02, 0.95]);
check("a porosity given in percent is read as a fraction", bucketFor({ porosity: 30, conductivity: 1e-6, depthM: 1, slopeDeg: 10 }).n, 0.3);
check("no published value takes the stated default", bucketFor({ depthM: 1, slopeDeg: 10 }).n, HYDRO_DEFAULTS.porosity);

/* ── the DEM grid and the sampler ─────────────────────────────────────────── */
const grid = demGridFor({ west: -6.6, east: -6.5, south: 54.4, north: 54.5 }, (lat, lon) => 100 + (lon + 6.6) * 5000, { maxCells: 400 });
check("a grid over the area at about the cell budget", grid.width * grid.height <= 520 && grid.known === grid.width * grid.height, true);
const sampler = samplerOver([{ properties: { lith: "till" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }], lithologyOf);
check("a point inside a unit reads its lithology, outside nothing", [sampler(0.5, 0.5), sampler(2, 2)], ["till", null]);

/* ── a storm on a slope ───────────────────────────────────────────────────── */
const cells = [{ slopeDeg: 32, material: { ...materialFor("clay"), depth: 2 } }, { slopeDeg: 3, material: { ...materialFor("clay"), depth: 2 } }];
const dates = Array.from({ length: 48 }, (_, i) => `2024-01-01T${String(i % 24).padStart(2, "0")}:00`);
const storm = runSteps({ cells, dates, stepHours: 1, rainFor: (cell, s) => (s >= 12 && s < 24 ? 12 : 0), bucketOf: () => ({ capacityMm: 150, drainPerDay: 0.1 }) });
check("the flat cell is never modelled", storm.steps.every((s) => !Number.isFinite(s.values[1])), true);
const before = storm.steps[10].values[0]; const during = storm.steps[23].values[0];
check("the slope's FoS falls through the storm", during < before, true);
check("and the wetness has memory: still wet hours after it stopped", storm.wet[0][30] > storm.wet[0][10], true);
check("readiness gates each step on the one above", readiness({ bounds: null, rain: null, ground: null, run: null }).rain, "blocked");
check("and opens once the area is set", readiness({ bounds: {}, rain: null, ground: null, run: null }).rain, "ready");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check("the page hosts the flowchart in the Landslides subtab and loads the module", /id="landslide-pipeline"/.test(html) && /gis\/landslide-pipeline\.js\?v=/.test(html), true);
const popup = readFileSync(new URL("./feature-popup.js", import.meta.url), "utf8");
check("a click on the risk layer is offered to the pipeline", /GeoIDLandslidePipeline\?\.probeAt/.test(popup), true);

process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`landslide-pipeline: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
