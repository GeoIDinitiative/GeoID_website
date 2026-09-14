/**
 * The risk assessment's arithmetic and wording, against answers worked by hand.
 */
import {
  SCHEMES, LEVELS, chanceScheme, bandScheme, schemeForLayerName, riskLayerKind, classIndex,
  weightedQuantile, newTally, addCell, finishTally, assessGrid, assessPopulation, groupByFeature,
  featureName, formatCount, formatShare, returnPeriod, stackedBarSvg, classBarsSvg, assessmentCsv,
  reportHtml, summarySentence, windLookup,
} from "./risk-assessment.js";
import { polygonsOf } from "./exposure.js";
import { readFileSync } from "node:fs";

let pass = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass += 1; else failures.push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
process.on("exit", () => {
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

// ── Schemes ────────────────────────────────────────────────────────────────
{
  for (const [id, s] of Object.entries(SCHEMES)) {
    check(`${id}: five classes, worst first, each with a threshold`, s.classes.length === 5 && s.classes.every((c, k) => c.level === LEVELS[k] && c.threshold && c.label));
  }
  const fos = SCHEMES.landslide;
  check("landslide: FoS 0.8 is very high, 1.1 high, 1.3 moderate, 1.7 low, 3 very low", [0.8, 1.1, 1.3, 1.7, 3].map((v) => classIndex(fos, v)).join() === "0,1,2,3,4");
  check("landslide: a class boundary belongs to the safer class (FoS 1 is marginal, not failing)", classIndex(fos, 1) === 1 && classIndex(fos, 1.5) === 3);
  check("no reading is −1, never a class", classIndex(fos, NaN) === -1 && classIndex(fos, null) === -1);
  const flood = SCHEMES.flood;
  check("flood: 2.5 m very high, 1.5 high, 0.7 moderate, 0.3 low, 0.05 very low, dry not exposed", [2.5, 1.5, 0.7, 0.3, 0.05, 0].map((v) => classIndex(flood, v)).join() === "0,1,2,3,4,-2");
  const p = SCHEMES.annualChance;
  check("annual chance: 0.6, 0.2, 0.05, 0.005, 0.0005, and zero not exposed", [0.6, 0.2, 0.05, 0.005, 0.0005, 0].map((v) => classIndex(p, v)).join() === "0,1,2,3,4,-2");
  check("wind: Category 5 (140 kt) very high, Cat 3 (100) high, Cat 1 (70) moderate, TS (40) low, TD (25) very low", [140, 100, 70, 40, 25, 0].map((v) => classIndex(SCHEMES.wind, v)).join() === "0,1,2,3,4,-2");
  check("magnitude and VEI read the same way", classIndex(SCHEMES.magnitude, 9.1) === 0 && classIndex(SCHEMES.magnitude, 6.4) === 2 && classIndex(SCHEMES.vei, 3) === 2 && classIndex(SCHEMES.vei, 0) === 4 && classIndex(SCHEMES.vei, -1) === -2);
  const hur = chanceScheme("Tropical cyclone", "Hurricane-force winds within 200 km");
  check("a chance scheme retitled keeps the probability arithmetic", hur.probability && hur.measure === "Hurricane-force winds within 200 km" && classIndex(hur, 0.3) === 1);
  const bands = bandScheme(0, 50, { measure: "Thickness", unit: "m" });
  check("value bands: no risk level, top band first, labelled by value", bands.bands && bands.classes.every((c) => c.level === null) && bands.classes[0].label === "40.0–50.0 m" && classIndex(bands, 50) === 0 && classIndex(bands, 0) === 4);
  check("scheme from a layer's name", schemeForLayerName("Landslide risk — forecast") === SCHEMES.landslide && schemeForLayerName("River flood inundation — 1 in 100") === SCHEMES.flood && schemeForLayerName("Soil thickness") === null);
  check("which risk map", riskLayerKind("Tropical cyclone risk") === "cyclone" && riskLayerKind("x", { mag_max: 7 }) === "seismic" && riskLayerKind("Volcanic ashfall — VEI 3") === "volcanic" && riskLayerKind("mystery") === "risk");
}

// ── Tallies ────────────────────────────────────────────────────────────────
{
  check("weighted quantiles: people, not cells, decide the median", weightedQuantile([[1, 1], [10, 100], [20, 1]], 0.5) === 10 && weightedQuantile([[5, 3]], 0.9) === 5 && Number.isNaN(weightedQuantile([], 0.5)));
  const t = newTally(SCHEMES.flood);
  addCell(t, 100, 1, 2.5);
  addCell(t, 50, 2, 0.3);
  addCell(t, 30, 1, 0);
  addCell(t, 20, 1, null, { edge: true });
  const f = finishTally(t);
  check("tally: total, area, exposed, not exposed and no reading each counted once", f.total === 200 && f.areaKm2 === 5 && f.exposed === 150 && f.notExposed === 30 && f.noReading === 20 && f.noReadingAreaKm2 === 1);
  check("tally: shares and densities", near(f.exposedShare, 0.75) && f.byClass[0].people === 100 && near(f.byClass[0].shareOfArea, 0.5) && near(f.byClass[0].shareOfExposed, 100 / 150) && f.byClass[3].density === 25 && f.density === 40);
  check("tally: people-weighted statistics over people with a reading", near(f.stats.mean, (2.5 * 100 + 0.3 * 50 + 0 * 30) / 180) && f.stats.max === 2.5 && f.stats.min === 0 && f.stats.median === 2.5);
  check("tally: very high + high, and the edge share", f.veryHighHigh === 100 && near(f.edgeShare, 0.1));
  check("tally: no expected-per-year on a scheme that is not a probability", f.expectedPerYear === null);
  const q = newTally(SCHEMES.annualChance);
  addCell(q, 1000, 1, 0.2);
  addCell(q, 500, 1, 0.01);
  check("expected people reached a year is Σ people × p", near(finishTally(q).expectedPerYear, 1000 * 0.2 + 500 * 0.01));
}

// ── A grid, and a population read against lookups ──────────────────────────
{
  // A 2 × 2 grid over one degree at the equator; people 10 each; FoS 0.5, 1.1, 3, NaN.
  const grid = assessGrid({
    people: new Float32Array([10, 10, 10, 10]), values: new Float32Array([0.5, 1.1, 3, NaN]),
    mask: new Uint8Array([1, 1, 1, 1]), width: 2, height: 2,
    bounds: { west: 0, east: 1, south: -0.5, north: 0.5 }, scheme: SCHEMES.landslide,
  });
  check("grid: classes by cell, NaN is no reading", grid.total === 40 && grid.byClass[0].people === 10 && grid.byClass[1].people === 10 && grid.byClass[4].people === 10 && grid.noReading === 10);
  check("grid: area per cell from its latitude (a degree square at the equator is ~12,309 km²)", near(grid.areaKm2, 110.574 * 111.32 * (Math.cos(0.25 * Math.PI / 180) * 2) / 2, 1e-6));
  const masked = assessGrid({ people: new Float32Array([10, 10, 10, 10]), values: new Float32Array([0.5, 1.1, 3, NaN]), mask: new Uint8Array([1, 0, 0, 0]), width: 2, height: 2, bounds: { west: 0, east: 1, south: -0.5, north: 0.5 }, scheme: SCHEMES.landslide });
  check("grid: the mask keeps only the polygon's cells", masked.total === 10 && masked.byClass[0].people === 10);

  const pop = { width: 4, height: 1, bounds: { west: 0, east: 4, south: 0, north: 1 }, band: new Float32Array([100, 200, 300, -3.4e38]) };
  const polys = polygonsOf({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Box" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [3.5, 0], [3.5, 1], [0, 1], [0, 0]]] } }] });
  const [chance, mag] = assessPopulation({
    pop, polys, schemes: [
      { scheme: SCHEMES.annualChance, valueAt: (lon) => (lon < 1 ? 0.6 : lon < 2 ? 0.05 : null) },
      { scheme: SCHEMES.magnitude, valueAt: (lon) => (lon < 1 ? 8.2 : 6.5) },
    ],
  });
  check("population: every scheme sees the same people", chance.total === 600 && mag.total === 600);
  check("population: a lookup returning null is no reading", chance.noReading === 300 && chance.byClass[0].people === 100 && chance.byClass[2].people === 200);
  check("population: expected per year", near(chance.expectedPerYear, 100 * 0.6 + 200 * 0.05));
  check("population: the magnitude breakdown", mag.byClass[0].people === 100 && mag.byClass[2].people === 500);
  const two = polygonsOf({ type: "FeatureCollection", features: [
    { type: "Feature", properties: { NAME: "North" }, geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]]] } },
    { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[5, 0], [6, 0], [6, 1], [5, 1], [5, 0]]] } },
  ] });
  const { groups } = groupByFeature(two);
  check("polygons group by the feature they came from, named by its own name field", groups.length === 2 && groups[0].name === "North" && groups[0].polys.length === 2 && groups[1].name === "Polygon 2");
  check("feature names: common fields, else a number", featureName({ district: "Kent" }, 0) === "Kent" && featureName(null, 4) === "Polygon 5");
}

// ── Saying it ──────────────────────────────────────────────────────────────
{
  check("counts: fewer than one person is <1, not 0", formatCount(0.4) === "<1" && formatCount(0) === "0" && formatCount(12345.6) === "12,346");
  check("shares", formatShare(0.1234) === "12.3%" && formatShare(0.0004) === "0.04%");
  check("return periods from a chance", returnPeriod(0) === "never on record" && returnPeriod(1 - Math.exp(-0.01)) === "1 in 100 years" && /a year/.test(returnPeriod(0.95)));

  const t = newTally(SCHEMES.flood);
  addCell(t, 100, 1, 2.5); addCell(t, 50, 2, 0.3); addCell(t, 30, 1, 0); addCell(t, 20, 1, null);
  const b = finishTally(t);
  const bar = stackedBarSvg(b);
  check("the stacked bar draws exposed classes, then not exposed, then no reading, across its width", /<svg/.test(bar) && (bar.match(/<rect x=/g) || []).length === 5 && /No reading: 20/.test(bar));
  check("class bars: a bar and a count per class", (classBarsSvg(b).match(/<rect/g) || []).length === 5 && /Very high — Over 2 m of water/.test(classBarsSvg(b)));
  const a = {
    area: "Study area 1", layer: "River flood inundation — 1 in 100", hazard: "Flood", source: "GRWL, Moody & Troutman",
    generated: "2026-09-15T10:00:00Z", generatedHuman: "15 September 2026, 10:00", generatedDate: "2026-09-15", reference: "RA-1",
    breakdowns: [b], byPolygon: [{ name: "A, north", breakdown: b }, { name: "B", breakdown: b }], polygonCount: 2, summaryText: "",
  };
  a.summaryText = summarySentence(a);
  check("the summary sentence leads with people, exposure and the worst class with people", /200 people live in Study area 1/.test(a.summaryText) && /150 \(75.0%\) are exposed/.test(a.summaryText) && /most severe class with people in it is very high/.test(a.summaryText) && /20 live where the layer has no reading/.test(a.summaryText));
  const csv = assessmentCsv(a);
  const rows = csv.split("\n");
  check("CSV: metadata, summary, breakdown and per-polygon sections", /^# GeoID risk assessment/.test(rows[0]) && rows.includes("summary,people_exposed,150,people") && rows.some((r) => /^Water depth,Very high,Over 2 m of water,depth ≥ 2 m,100,50.00,66.67/.test(r)) && rows.includes("# by polygon"));
  check("CSV: a name with a comma is quoted", rows.some((r) => r.startsWith('"A, north",200')));
  check("CSV: people with no reading have their own row", rows.some((r) => /^Water depth,,No reading,,20,10.00/.test(r)));
  const html = reportHtml(a, { mapImage: "data:image/jpeg;base64,AAAA" });
  check("report: a whole A4 print document with its title, cards and every section", /^<!doctype html>/.test(html) && /@page \{ size: A4/.test(html) && /Flood risk to people — Study area 1/.test(html) && (html.match(/class="card"/g) || []).length === 4 && /2\. Study area and hazard/.test(html) && /4\. By polygon/.test(html) && /5\. Method, assumptions and limitations/.test(html));
  check("report: thresholds printed beside levels, the map image, the sign-off fields editable", /depth ≥ 2 m/.test(html) && /data:image\/jpeg;base64,AAAA/.test(html) && /Prepared by<\/label><span contenteditable="true">/.test(html) && /window\.print\(\)/.test(html));
  check("report: text from a layer name is escaped", /&lt;b&gt;/.test(reportHtml({ ...a, layer: "<b>x</b>" })) && !/<b>x<\/b>/.test(reportHtml({ ...a, layer: "<b>x</b>" })));
  const chance = newTally(SCHEMES.annualChance); addCell(chance, 10, 1, 0.2);
  const html2 = reportHtml({ ...a, breakdowns: [finishTally(chance)], byPolygon: [], polygonCount: 1 });
  check("report: a probability map carries the expected-per-year card and caveat, and no polygon section", /people reached in an average year/.test(html2) && /A chance is not a headcount/.test(html2) && !/By polygon/.test(html2) && /4\. Method/.test(html2));
}

// ── Wind from storm tracks ─────────────────────────────────────────────────
{
  const tracks = [
    { properties: { peak_wind_kts: 140 }, geometry: { type: "LineString", coordinates: [[-80, 20], [-80, 30]] } },
    { properties: { peak_wind_kts: 50 }, geometry: { type: "MultiLineString", coordinates: [[[-82, 24], [-78, 24]]] } },
    { properties: { peak_wind_kts: 0 }, geometry: { type: "LineString", coordinates: [[-81, 24], [-79, 24]] } },
    { properties: { peak_wind_kts: 90 }, geometry: { type: "LineString", coordinates: [[179.5, 10], [-179.5, 10]] } },
  ];
  const lookup = windLookup(tracks, { west: -84, east: -76, south: 22, north: 26 });
  check("wind: the strongest track in reach wins", lookup.at(-80.5, 24) === 140);
  check("wind: 150 km from the Cat 5 track and on the tropical storm's, the Cat 5 still counts", lookup.at(-81.4, 24) === 140);
  check("wind: out of the Cat 5's reach, the weaker storm", lookup.at(-77.5, 24.5) === 50);
  check("wind: nothing within 200 km reads zero", lookup.at(-84, 26) === 0);
  check("wind: a storm with no measured peak is not a track, and a seam-crossing segment is skipped", lookup.segments === 2);
}

// ── The panel reads through this module ────────────────────────────────────
{
  const panel = readFileSync(new URL("./exposure-panel.js", import.meta.url), "utf8");
  check("the exposure panel assesses through the risk module: grids, probability maps and tracks", /assessGrid\(\{ people, values: r\.band/.test(panel) && /assessPopulation\(\{ pop, polys: area\.polys, schemes \}\)/.test(panel) && /windLookup\(/.test(panel));
  check("cyclone maps add hurricane-force chance and the strongest storm; earthquakes magnitude; volcanoes VEI", /p_hur_yr/.test(panel) && /SCHEMES\.wind/.test(panel) && /SCHEMES\.magnitude/.test(panel) && /SCHEMES\.vei/.test(panel));
  check("the report opens print-ready, gated like every save, with the CSV and HTML beside it", /\$\{url\}\$\{print \? "#print" : ""\}/.test(panel) && /if \(!may\("save"\)\)/.test(panel) && /assessmentCsv\(a\)/.test(panel) && /reportHtml\(a, \{ mapImage: mapSnapshot\(\) \}\)/.test(panel));
  check("every polygon of a multi-polygon area is assessed on its own", /groupByFeature\(area\.polys\)/.test(panel));
}
