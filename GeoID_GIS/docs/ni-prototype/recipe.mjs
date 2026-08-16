/**
 * The NI acceptance test, run through the real analysis engines.
 *
 * Every call below is the same function the tool descriptors call — the
 * engines are pure, so the science runs at full resolution here while the
 * browser check proves the same chain through the GUI. Nothing is
 * reimplemented: if a number is wrong, the tool is wrong.
 *
 * Usage: node recipe.mjs <area>   where area is "ni" or "sw"
 */
import { readFileSync, writeFileSync } from "node:fs";

const GIS = "/home/owen/GeoID_webpage/GeoID_GIS/viewer/gis";
const RA = await import(`${GIS}/raster-analysis.js`);
const GP = await import(`${GIS}/geoprocessing.js`);
const IN = await import(`${GIS}/interpolation.js`);
const { writeGeoTiff } = await import(`${GIS}/geotiff-writer.js`);
/** The deliverable goes out through the app's OWN writer — the same one the
 *  export path uses — so what a user downloads is byte-for-byte this. */
const OUT = "/home/owen/geoid_projects/earth/ni-prototype/data/processed";
const writeTif = (raster, name) => { writeFileSync(`${OUT}/${name}.tif`, Buffer.from(writeGeoTiff(raster, { noDataOut: -9999 }))); console.log(`   wrote ${name}.tif`); };

const AREA = process.argv[2] || "ni";
const S = "/tmp/claude-1000/-home-owen-GeoID-webpage/06b7b1d5-5743-40dc-8cf8-08faea9b3529/scratchpad";

/* ── ESRI ASCII in and out (the sidecar's own interchange format) ────────── */

function readAsc(path) {
  const text = readFileSync(path, "utf8");
  const head = {};
  let offset = 0;
  for (let i = 0; i < 6; i += 1) {
    const end = text.indexOf("\n", offset);
    const [k, v] = text.slice(offset, end).trim().split(/\s+/);
    head[k.toLowerCase()] = Number(v);
    offset = end + 1;
  }
  const { ncols, nrows, xllcorner, yllcorner } = head;
  const dx = head.dx ?? head.cellsize;
  const dy = head.dy ?? head.cellsize;
  const noData = head.nodata_value;
  const band = new Float32Array(ncols * nrows);
  let at = 0;
  // Split on whitespace once: 2.6 M numbers, so a per-line regex is the
  // difference between seconds and minutes.
  const body = text.slice(offset);
  let n = 0;
  let sign = 1;
  let value = 0;
  let frac = 0;
  let inNum = false;
  for (let i = 0; i < body.length; i += 1) {
    const c = body.charCodeAt(i);
    if (c === 45 && !inNum) { sign = -1; inNum = true; }
    else if (c >= 48 && c <= 57) { inNum = true; if (frac) { value += (c - 48) / frac; frac *= 10; } else value = value * 10 + (c - 48); }
    else if (c === 46) { frac = 10; }
    else if (inNum) {
      const v = sign * value;
      band[at++] = (noData !== undefined && v === noData) ? NaN : v;
      n += 1; sign = 1; value = 0; frac = 0; inNum = false;
    }
  }
  if (inNum) band[at++] = sign * value;
  return RA.makeRaster(band, ncols, nrows, {
    minX: xllcorner, maxX: xllcorner + ncols * dx,
    minY: yllcorner, maxY: yllcorner + nrows * dy,
  }, NaN);
}

function writeAsc(raster, path) {
  const { width, height, bounds } = raster;
  const dx = (bounds.maxX - bounds.minX) / width;
  const dy = (bounds.maxY - bounds.minY) / height;
  const out = [`ncols ${width}`, `nrows ${height}`,
    `xllcorner ${bounds.minX}`, `yllcorner ${bounds.minY}`,
    `dx ${dx}`, `dy ${dy}`, "NODATA_value -9999"];
  for (let y = 0; y < height; y += 1) {
    const row = new Array(width);
    for (let x = 0; x < width; x += 1) {
      const v = raster.band[y * width + x];
      row[x] = Number.isFinite(v) ? Math.round(v * 1000) / 1000 : -9999;
    }
    out.push(row.join(" "));
  }
  writeFileSync(path, out.join("\n"));
}

const load = (name) => JSON.parse(readFileSync(`${S}/${name}`, "utf8"));
const t0 = Date.now();
const step = (msg) => console.log(`[${String((Date.now() - t0) / 1000).padStart(6)}s] ${msg}`);

/* ── the factor score tables, from docs/ni-prototype/methodology.md ─────── */

/**
 * Lithology susceptibility, mapped onto the BGS 625k `rcs_d` classes that
 * actually occur in the data — the methodology names the units, this names
 * the rock classifications the service returns for them.
 */
function lithologyScore(rcs) {
  const t = String(rcs || "").toUpperCase();
  if (!t) return 3;
  // 5 — weak mudstone-dominated sequences; the Lias staircase under the
  // Antrim basalts is the classic NI failure geometry.
  if (/MUDSTONE, CHERT|SMECTITE|CLAYSTONE/.test(t)) return 5;
  if (/^MUDSTONE|MUDSTONE, SILTSTONE|MUDSTONE AND |SHALE/.test(t)) return 5;
  // 4 — the basalt scarps themselves (interbasaltic laterites fail), and
  // interbedded Carboniferous sequences with mudstone in them.
  if (/MAFIC LAVA|MAFIC TUFF|MAFIC IGNEOUS/.test(t)) return 4;
  if (/LIMESTONE, MUDSTONE|MUDSTONE, SILTSTONE, LIMESTONE|SILTSTONE AND MUDSTONE/.test(t)) return 4;
  if (/SANDSTONE, SILTSTONE AND MUDSTONE|SANDSTONE, MUDSTONE/.test(t)) return 4;
  // 3 — competent but jointed metasediments and greywackes.
  if (/WACKE|PSAMMITE|SEMIPELITE|PELITE|SCHIST|GNEISS/.test(t)) return 3;
  // 2 — strong sedimentary rock.
  if (/CHALK|LIMESTONE|SANDSTONE|CONGLOMERATE|METALIMESTONE|QUARTZITE/.test(t)) return 2;
  // 1 — massive intrusives: the Mournes, Slieve Gullion, Carlingford.
  if (/FELSIC|GRANITE|GABBRO|DOLERITE|INTRUSI|MICROGRANITE|SYENITE/.test(t)) return 1;
  return 3;
}

/** Superficial permeability for the flood recipe: runoff, not landslides. */
function permeabilityScore(rcs) {
  const t = String(rcs || "").toUpperCase();
  if (!t) return 3;
  if (/ALLUVIUM|SILT|LACUSTRINE|ESTUARINE|TIDAL FLAT/.test(t)) return 5;
  if (/PEAT|TILL|DIAMICTON|CLAY/.test(t)) return 4;
  if (/SAND|GRAVEL|GLACIOFLUVIAL|RAISED BEACH/.test(t)) return 2;
  if (/BEDROCK|LIMESTONE|SANDSTONE/.test(t)) return 1;
  return 3;
}

/** Adds a numeric score field to every feature — the field calculator's job. */
function scoreCollection(fc, field, fn) {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      properties: { ...f.properties, [field]: fn(f.properties?.rcs_d ?? f.properties?.RCS_D) },
    })),
  };
}

const classStats = (raster, label) => {
  const counts = new Map();
  let total = 0;
  for (const v of raster.band) {
    if (!Number.isFinite(v)) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
    total += 1;
  }
  const rows = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  console.log(`\n${label} — ${total.toLocaleString()} scored cells`);
  rows.forEach(([k, n]) => console.log(`   class ${k}: ${String(n).padStart(9)}  ${(100 * n / total).toFixed(1)}%`));
  return { rows, total };
};

/* ── the run ────────────────────────────────────────────────────────────── */

const prefix = AREA === "ni" ? "ni" : "sw";
step(`reading the ${AREA.toUpperCase()} DEM`);
const dem = readAsc(`${S}/${prefix}_dem_100m.asc`);
step(`DEM ${dem.width}x${dem.height} = ${(dem.width * dem.height / 1e6).toFixed(2)} M cells`);

// A — LANDSLIDE SUSCEPTIBILITY
step("slope");
const slope = RA.slope(dem);
step("reclassify slope");
const slopeC = RA.reclassify(slope, RA.parseReclassifyRules("0..5:1, 5..12:2, 12..20:3, 20..30:4, 30..90:5").rules);

step("lithology: score + rasterize");
const bedrock = load(`${prefix}_bedrock.geojson`);
const lithoC = RA.rasterizeByAttribute(scoreCollection(bedrock, "ls_score", lithologyScore), "ls_score", dem);

step("rainfall: centroids, interpolate, resample");
const rain = load(`${prefix}_rainfall.geojson`);
/**
 * Rainfall is a CONTINUOUS field measured on a coarse grid, and the HadUK
 * cells do not tile the ground: burning the polygons straight in leaves holes
 * wherever the observational grid has none — Lough Neagh and Slieve Donard
 * both came back no-data, and the overlay then deleted that ground from the
 * map entirely. So the cells become points and the points become a surface,
 * which is what interpolation is for. IDW runs on a coarse grid and is
 * resampled onto the DEM's, because 2.6 M cells x 112 samples is work with no
 * answer in it — the field has no detail at 100 m to recover.
 */
const rainPoints = GP.centroids(rain);
const rainCoarse = IN.idwRaster(rainPoints, "pr", dem.bounds, { cellsAcross: 192, power: 2 });
const rainRaw = RA.resampleToGrid(rainCoarse, dem);
const rainC = RA.reclassify(rainRaw, RA.parseReclassifyRules("0..900:1, 900..1100:2, 1100..1300:3, 1300..1600:4, 1600..4000:5").rules);

let distC = null;
try {
  const rivers = load(`${prefix}_rivers.geojson`);
  step(`drainage: distance transform over ${rivers.features.length} waterways`);
  const dist = RA.distanceRaster(rivers, dem);
  distC = RA.reclassify(dist, RA.parseReclassifyRules("0..50:5, 50..100:4, 100..250:3, 250..500:2, 500..1000000000:1").rules);
} catch { step("drainage: no rivers layer for this area — factor omitted, weights renormalise"); }

step("weighted overlay");
const factors = [
  { raster: slopeC, weight: 0.35 },
  { raster: lithoC, weight: 0.25 },
  { raster: rainC, weight: 0.15 },
];
if (distC) factors.push({ raster: distC, weight: 0.10 });
const lsiRaw = RA.weightedOverlay(factors);
if (!lsiRaw.ok) { console.error(lsiRaw.message); process.exit(1); }

/**
 * The slope gate: a landslide needs a slope.
 *
 * A weighted sum treats slope as merely the heaviest factor, so flat ground
 * on weak rock beside a river scores like a scarp — Belfast city centre came
 * out in the worst class on the first run, which is not a defensible map.
 * Slope is a NECESSARY condition, so below 2 degrees the index is floored and
 * between 2 and 5 it is capped rather than zeroed (a shallow failure in soft
 * material is possible; a rock slide is not).
 *
 * Kept because it was TESTED, not because it sounds right: against the 1,242
 * inventoried landslides of South Wales it moves the success-rate AUC from
 * 0.826 to 0.841, and captures the same 80.8% of slides in the worst 30%.
 */
const lsi = {
  ok: true,
  raster: RA.makeRaster(Float32Array.from(lsiRaw.raster.band, (v, i) => {
    const s = slope.band[i];
    if (!Number.isFinite(v) || !Number.isFinite(s)) return NaN;
    if (s < 2) return 1;
    if (s < 5) return Math.min(v, 2.5);
    return v;
  }), lsiRaw.raster.width, lsiRaw.raster.height, lsiRaw.raster.bounds, NaN),
};
const lsiC = RA.reclassify(lsi.raster,
  RA.parseReclassifyRules("1..1.8:1, 1.8..2.6:2, 2.6..3.4:3, 3.4..4.2:4, 4.2..5:5").rules);
const lsiStats = classStats(lsiC, `LANDSLIDE SUSCEPTIBILITY (${AREA.toUpperCase()})`);

step("writing the landslide map");
writeAsc(lsiC, `${S}/${prefix}_landslide_susceptibility.asc`);
  writeTif(lsiC, `${prefix}_landslide_susceptibility`);

/**
 * Quantile classes: each class is a fixed SHARE OF AREA, so "High + Very
 * High" means the top 30% of the ranked index by construction.
 *
 * The methodology states two criteria — capture ≥70% of the inventory in
 * High+Very High, with those classes covering ≤30% of the area — and
 * equal-interval breaks cannot honour both at once: they are set by the
 * index's arithmetic range, not by how much ground each class claims. Fixing
 * the area share is the standard susceptibility-class convention and is what
 * makes the pair of criteria a single, falsifiable question: does the worst
 * 30% of the ground hold 70% of the landslides?
 */
function quantileClassify(raster, shares = [0.35, 0.20, 0.15, 0.20, 0.10]) {
  // Classes 4 and 5 sum to 0.30 deliberately: "High + Very High" is then the
  // worst 30% of the ground, which is precisely the area the criterion caps.
  const values = [...raster.band].filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return { raster, breaks: [] };
  const breaks = [];
  let acc = 0;
  for (let i = 0; i < shares.length - 1; i += 1) {
    acc += shares[i];
    breaks.push(values[Math.min(values.length - 1, Math.floor(acc * values.length))]);
  }
  const out = new Float32Array(raster.band.length).fill(NaN);
  for (let i = 0; i < raster.band.length; i += 1) {
    const v = raster.band[i];
    if (!Number.isFinite(v)) continue;
    let cls = shares.length;
    for (let b = 0; b < breaks.length; b += 1) {
      if (v <= breaks[b]) { cls = b + 1; break; }
    }
    out[i] = cls;
  }
  return {
    raster: RA.makeRaster(out, raster.width, raster.height, raster.bounds, NaN),
    breaks,
  };
}

// Validation, where an inventory exists.
try {
  const inventory = load(`${prefix}_landslides.geojson`);

  const report = (classified, label, criterionArea = 30) => {
    const sampled = RA.sampleAtPoints(classified, inventory, "lsi");
    const values = sampled.features.map((f) => f.properties.lsi).filter((v) => Number.isFinite(v));
    let areaHigh = 0;
    let total = 0;
    for (const v of classified.band) {
      if (!Number.isFinite(v)) continue;
      total += 1;
      if (v >= 4) areaHigh += 1;
    }
    const hitPct = 100 * values.filter((v) => v >= 4).length / values.length;
    const areaPct = 100 * areaHigh / total;
    const pass = hitPct >= 70 && areaPct <= criterionArea + 0.5;
    console.log(`\n${label} — ${values.length} inventoried landslides sampled`);
    // A sample this small cannot carry a verdict. Northern Ireland has one
    // record in the BGS National Landslide Database because that database
    // covers GREAT BRITAIN — GSNI holds the NI inventory and publishes no open
    // service. Printing PASS off n=1 would be the most misleading number in
    // this whole report, so the threshold refuses instead.
    const MIN_SAMPLE = 30;
    if (values.length < MIN_SAMPLE) {
      console.log(`   in High or Very High:   ${hitPct.toFixed(1)}%  (of ${values.length})`);
      console.log(`   those classes cover:    ${areaPct.toFixed(1)}% of area`);
      console.log(`   VERDICT: NOT ASSESSABLE — needs at least ${MIN_SAMPLE} inventoried slides, this area has ${values.length}.`);
      return { hitPct, areaPct, pass: null };
    }
    console.log(`   in High or Very High:   ${hitPct.toFixed(1)}%   (criterion: >= 70%)`);
    console.log(`   those classes cover:    ${areaPct.toFixed(1)}% of area   (criterion: <= 30%)`);
    console.log(`   VERDICT: ${pass ? "PASS" : "FAIL"}`);
    return { hitPct, areaPct, pass };
  };

  report(lsiC, "VALIDATION — equal-interval classes (as written in the methodology)");
  const q = quantileClassify(lsi.raster);
  report(q.raster, "VALIDATION — quantile classes (top 30% of the ranked index)");
  writeAsc(q.raster, `${S}/${prefix}_landslide_susceptibility_quantile.asc`);
  writeTif(q.raster, `${prefix}_landslide_susceptibility_quantile`);

  /**
   * The success-rate curve: what share of landslides falls in the worst N% of
   * the index, for every N. Its area under the curve is the single number
   * that says whether the index ranks the ground correctly at all — 0.5 is a
   * coin toss, and it is independent of where any class break is put.
   */
  const sampledRaw = RA.sampleAtPoints(lsi.raster, inventory, "lsi");
  const slideValues = sampledRaw.features.map((f) => f.properties.lsi).filter(Number.isFinite);
  const allValues = [...lsi.raster.band].filter(Number.isFinite).sort((a, b) => b - a);
  let auc = 0;
  let prev = 0;
  const curve = [];
  for (let pct = 5; pct <= 100; pct += 5) {
    const cut = allValues[Math.min(allValues.length - 1, Math.floor((pct / 100) * allValues.length) - 1)];
    const captured = slideValues.filter((v) => v >= cut).length / slideValues.length;
    curve.push([pct, captured]);
    auc += ((captured + prev) / 2) * 0.05;
    prev = captured;
  }
  console.log("\nSUCCESS-RATE CURVE (share of landslides inside the worst N% of the index)");
  curve.filter(([p]) => [10, 20, 30, 40, 50].includes(p))
    .forEach(([p, c]) => console.log(`   worst ${String(p).padStart(3)}% of area: ${(100 * c).toFixed(1)}% of landslides`));
  console.log(`   AUC = ${auc.toFixed(3)}  (0.5 = no skill)`);
} catch (error) { console.log(`\n(no landslide inventory for this area: ${error.message})`); }

// B — FLOOD SUSCEPTIBILITY
step("\nflood: elevation and slope factors");
const elevC = RA.reclassify(dem, RA.parseReclassifyRules("-10..10:5, 10..30:4, 30..75:3, 75..150:2, 150..900:1").rules);
const slopeFlood = RA.reclassify(slope, RA.parseReclassifyRules("0..1:5, 1..3:4, 3..8:3, 8..15:2, 15..90:1").rules);

let permC = null;
try {
  const superficial = load(`${prefix}_superficial.geojson`);
  step("flood: superficial permeability");
  permC = RA.rasterizeByAttribute(scoreCollection(superficial, "perm_score", permeabilityScore), "perm_score", dem);
  // Superficial cover is patchy by nature, and a cell with none is not a cell
  // with no data — it is BEDROCK AT SURFACE, which the methodology's own table
  // scores 1. Left as no-data it would instead delete that ground from the
  // flood map entirely (the overlay scores a cell only where every factor has
  // a value), which is how two thirds of South Wales vanished on the first run.
  let filled = 0;
  for (let i = 0; i < permC.band.length; i += 1) {
    if (!Number.isFinite(permC.band[i]) && Number.isFinite(dem.band[i])) { permC.band[i] = 1; filled += 1; }
  }
  step(`flood: ${filled.toLocaleString()} cells have no mapped superficial — scored as bedrock at surface`);
} catch { step("flood: no superficial layer — factor omitted"); }

step("flood: weighted overlay");
const floodFactors = [
  { raster: elevC, weight: 0.25 },
  { raster: rainC, weight: 0.15 },
  { raster: slopeFlood, weight: 0.10 },
];
if (permC) floodFactors.push({ raster: permC, weight: 0.20 });
if (distC) floodFactors.push({ raster: distC, weight: 0.30 });  // drainage proximity stands in for flow accumulation
const fsi = RA.weightedOverlay(floodFactors);
const fsiC = RA.reclassify(fsi.raster,
  RA.parseReclassifyRules("1..1.8:1, 1.8..2.6:2, 2.6..3.4:3, 3.4..4.2:4, 4.2..5:5").rules);
classStats(fsiC, `FLOOD SUSCEPTIBILITY (${AREA.toUpperCase()})`);
writeAsc(fsiC, `${S}/${prefix}_flood_susceptibility.asc`);
writeTif(fsiC, `${prefix}_flood_susceptibility`);

// Sanity probes: named places whose class the methodology predicts.
const probe = (raster, lat, lon, what) => {
  const x = Math.floor(((lon - raster.bounds.minX) / (raster.bounds.maxX - raster.bounds.minX)) * raster.width);
  const y = Math.floor(((raster.bounds.maxY - lat) / (raster.bounds.maxY - raster.bounds.minY)) * raster.height);
  const v = raster.band[y * raster.width + x];
  console.log(`   ${what.padEnd(38)} class ${Number.isFinite(v) ? v : "no data"}`);
};
if (AREA === "ni") {
  console.log("\nSANITY PROBES — landslide map");
  probe(lsiC, 55.2408, -6.5116, "Giant's Causeway (basalt coast)");
  probe(lsiC, 55.075, -6.135, "Antrim plateau interior");
  probe(lsiC, 54.180, -5.921, "Slieve Donard (Mourne granite)");
  probe(lsiC, 54.600, -6.400, "Lough Neagh lowland");
  console.log("SANITY PROBES — flood map");
  probe(fsiC, 54.600, -6.400, "Lough Neagh fringe");
  probe(fsiC, 55.000, -6.300, "Antrim plateau top");
  probe(fsiC, 54.596, -5.930, "Belfast (Lagan valley floor)");
}
step("done");

/* In-memory integrity check: the gate must hold in the object we wrote. */
{
  let flat = 0, flatHigh = 0;
  for (let i = 0; i < slope.band.length; i += 1) {
    const s = slope.band[i], c = lsiC.band[i];
    if (!Number.isFinite(s) || !Number.isFinite(c)) continue;
    if (s < 2) { flat += 1; if (c > 1) flatHigh += 1; }
  }
  const idx = (la, lo) => {
    const x = Math.floor(((lo - dem.bounds.minX) / (dem.bounds.maxX - dem.bounds.minX)) * dem.width);
    const y = Math.floor(((dem.bounds.maxY - la) / (dem.bounds.maxY - dem.bounds.minY)) * dem.height);
    return y * dem.width + x;
  };
  const b = idx(54.5973, -5.9301);
  console.log(`\nGATE CHECK (in memory): ${flat.toLocaleString()} cells below 2 deg, ${flatHigh} of them above class 1`);
  console.log(`   Belfast: slope ${slope.band[b].toFixed(2)} deg -> LSI ${lsi.raster.band[b].toFixed(2)} -> class ${lsiC.band[b]}`);
}
