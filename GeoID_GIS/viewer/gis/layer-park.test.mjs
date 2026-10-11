/**
 * Toggling a layer must be cheap, and following a satellite must survive the
 * mouse.
 *
 * Measured before these existed (13,000-polygon world geology, software GL):
 * an eye press 1.5 s frozen, rebuilding the click catalogue and classifying
 * every polygon's lithology again; an untick and re-tick 16 tile fetches and
 * a 3.3 s rebuild; a DEM sheet's re-tick 1.3 s of re-sampling. And a drag on
 * the globe while following a satellite ended the follow, so the satellite
 * left the frame at 7.7 km/s.
 *
 * Run: node GeoID_GIS/viewer/gis/layer-park.test.mjs
 */
import { readFileSync } from "node:fs";
import { rockClass } from "./rock-class.js";
import { followFrame, FOLLOW_PITCH_MAX } from "./satellites.js";
import * as THREE from "../vendor/three.module.js";

let failures = 0;
let passes = 0;
function check(name, ok, detail = "") {
  if (ok) passes += 1; else failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
process.on("exit", () => {
  console.log(`\n${passes} passed${failures ? `, ${failures} FAILED` : ""}`);
  if (failures) process.exitCode = 1;
});

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── rockClass is remembered ──────────────────────────────────────────── */
{
  const a = rockClass("marble, meta-limestone");
  const b = rockClass("marble, meta-limestone");
  check("the same lithology classifies the same twice", a === b && a === "Metamorphic", String(a));
  const t0 = performance.now();
  for (let i = 0; i < 20000; i += 1) rockClass("mafic lava and mafic tuff");
  const ms = performance.now() - t0;
  check("twenty thousand repeats of one lithology are cheap", ms < 200, `${ms.toFixed(0)} ms`);
  check("a tie is still refused", rockClass("sandstone and basalt") === null);
}

/* ── geology: parked, not destroyed ──────────────────────────────────── */
{
  const g = src("./geology-panel.js");
  const fn = g.slice(g.indexOf("export function unloadTiledLayer"), g.indexOf("function reclaimParked"));
  const nulled = fn.indexOf("layer.object3D = null");
  check("unloading detaches the group before the row is removed",
    nulled > -1 && nulled < fn.lastIndexOf("removeLayer?.(layer.id)"));
  check("a re-tick reclaims a parked controller", /existing\?\.tiled \|\| reclaimed \|\|/.test(g));
  check("a parked map is freed after a while", /setTimeout\(\(\) => freeParked\(id\), PARK_MS\)/.test(g));
  check("removeDerivedGeologyMap parks", /export function removeDerivedGeologyMap[\s\S]{0,160}unloadTiledLayer\(layer\)/.test(g));
  check("the click catalogue is cached per layer", /CATALOGUE_CACHE\.get\(layer\)/.test(g)
    && /CATALOGUE_CACHE\.set\(layer,/.test(g));
  const c = src("./catalogue-panels.js");
  check("the soil and GLiM rows no longer dispose before parking",
    !/tiled\?\.dispose\?\.\(\);\s*window\.GeoID(Soil|Glim)Cover/.test(c));
  check("hydrology's remove parks", !/tiled\?\.dispose/.test(src("./hydrology-cover.js")));
}

/* ── DEM sheets: only the terrain readings are parked ────────────────── */
{
  const d = src("./dem-layer.js");
  const set = d.match(/const PARKABLE = new Set\(\[([^\]]*)\]\)/)?.[1] || "";
  check("terrain readings are parkable", ["elevation", "slope", "hillshade"].every((k) => set.includes(`"${k}"`)), set);
  check("the models are never parked (their settings change what they draw)",
    ["sealevel", "inundation", "discharge", "riverzones"].every((k) => !set.includes(`"${k}"`)), set);
  check("a parked sheet is re-attached only over the same view",
    /viewChangedEnough\(asView\(held\.bounds\), asView\(next\)\)/.test(d));
}

/* ── satellites: a drag turns the view round the followed one ────────── */
{
  const s = src("./satellites.js");
  const down = s.slice(s.indexOf("function onFollowPointerDown"), s.indexOf("function onFollowPointerMove"));
  check("a press on the globe does not end the follow", !/endFollow\(\)/.test(down));
  check("Escape lets go", /function onFollowKey[\s\S]{0,200}"Escape"[\s\S]{0,300}endFollow\(\)/.test(s));
  check("the follow holds the globe's orbit off, and gives it back",
    /controls\.enabled = false/.test(s) && /controls\.enabled = follow\.controlsWere !== false/.test(s));
  const world = new THREE.Vector3(3.2, 1.1, -0.7).normalize().multiplyScalar(3.41);
  let worst = 0; let worstLen = 0;
  for (let p = 0; p <= FOLLOW_PITCH_MAX + 1e-9; p += FOLLOW_PITCH_MAX / 17) {
    for (let y = 0; y < Math.PI * 2; y += Math.PI / 9) {
      const { dir, up } = followFrame(world, y, p);
      worst = Math.max(worst, Math.abs(dir.dot(up)));
      worstLen = Math.max(worstLen, Math.abs(up.length() - 1), Math.abs(dir.length() - 1));
    }
  }
  check("the screen's up is never along the view, overhead included", worst < 1e-9, worst.toExponential(2));
  check("both are unit vectors", worstLen < 1e-9, worstLen.toExponential(2));
  const over = followFrame(world, 0, 0);
  check("pitch 0 looks straight down", over.dir.angleTo(world) < 1e-9);
}
