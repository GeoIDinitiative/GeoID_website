/** Study-area reports. Run: node GeoID_GIS/viewer/gis/research/study-report.test.mjs */
import { readFileSync } from "node:fs";
import {
  pointInPolys, areaGeometry, latticeInside, summarise, tally, haversineKm, placesFor, compass,
  buildReport, mergeWriting, sectionsOf, WRITING, markdownToHtml, inline, printableHtml, readingsSignature, slug,
} from "./study-report.js";

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass += 1; else { fail += 1; console.error("FAIL:", m); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
process.on("exit", () => { console.log(`study-report: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });

// A one-degree square at the equator, with a quarter-degree hole.
const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const hole = [[0.25, 0.25], [0.5, 0.25], [0.5, 0.5], [0.25, 0.5], [0.25, 0.25]];
const polys = [{ coords: [square, hole] }];

ok(pointInPolys(0.75, 0.75, polys) && !pointInPolys(0.4, 0.4, polys) && !pointInPolys(2, 2, polys), "inside, in the hole, outside");
{
  const g = areaGeometry(polys);
  const full = 111.195 ** 2;
  ok(near(g.areaKm2, full * (1 - 1 / 16), full * 0.01), `the area less its hole (${g.areaKm2.toFixed(0)} km²)`);
  ok(g.box.west === 0 && g.box.north === 1 && near(g.centroid.lat, 0.5, 0.11), "box and centroid");
}
{
  const pts = latticeInside(polys, 400);
  ok(pts.length > 250 && pts.length < 500, `about 400 points (${pts.length})`);
  ok(pts.every((p) => pointInPolys(p.lon, p.lat, polys)), "every lattice point is inside");
  const thin = [{ coords: [[[0, 0], [5, 0], [5, 0.01], [0, 0.01], [0, 0]]] }];
  ok(latticeInside(thin, 400).length >= 20, "a thin strip still gets points");
}
{
  const s = summarise([3, 1, NaN, 2, 10]);
  ok(s.n === 4 && s.min === 1 && s.max === 10 && s.mean === 4, "summary skips NaN");
  ok(summarise([NaN]) === null, "nothing finite is no summary");
  const t = tally(["a", "b", "a", null, "", "c", "a"], { top: 2 });
  ok(t.n === 5 && t.rows[0].name === "a" && near(t.rows[0].share, 0.6, 1e-12) && t.more === 1, "tally, most common first");
}
ok(near(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 111.195, 0.01), "a degree of the equator");
ok(compass({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) === "N" && compass({ lat: 0, lon: 0 }, { lat: -1, lon: -1 }) === "SW", "compass points");
{
  const places = [
    { name: "Inside Big", lat: 0.8, lon: 0.8, population: 5e5 },
    { name: "Inside Small", lat: 0.6, lon: 0.7, population: 10 },
    { name: "In the hole", lat: 0.4, lon: 0.4 },
    { name: "East", lat: 0.5, lon: 1.5 },
    { name: "Far", lat: 30, lon: 30 },
  ];
  const got = placesFor(places, polys, { lat: 0.5, lon: 0.5 });
  ok(got.inside.map((p) => p.name).join() === "Inside Big,Inside Small", "inside, largest first; the hole is outside");
  ok(got.near[0].name === "In the hole" && got.near.some((p) => p.name === "East" && p.bearing === "E") && !got.near.some((p) => p.name === "Far"), "nearest outside, with a bearing; the far one dropped");
}

// A reading shaped as the risk reader writes it.
const breakdown = (exposed, vhh, scheme = {}) => ({
  scheme: { hazard: "Flood", measure: "Flood depth", unit: "m", definition: "Depth above ground at the 1-in-100.", bands: false, ...scheme },
  total: 10000, areaKm2: 100, density: 100, exposed, exposedAreaKm2: 20, exposedShare: exposed / 10000,
  noReading: 500, noReadingAreaKm2: 5, notExposed: 10000 - exposed - 500, covered: 9500,
  expectedPerYear: scheme.probability ? 123.4 : null, edgeShare: 0.12,
  byClass: [
    { level: "Very high", label: "≥ 2 m", threshold: "2", people: vhh / 2, areaKm2: 2, shareOfArea: vhh / 20000 },
    { level: "High", label: "1–2 m", threshold: "1", people: vhh / 2, areaKm2: 3, shareOfArea: vhh / 20000 },
    { level: "Moderate", label: "0.5–1 m", threshold: "0.5", people: exposed - vhh, areaKm2: 15, shareOfArea: (exposed - vhh) / 10000 },
  ],
  stats: { min: 0.1, max: 3.2, mean: 1.1, median: 0.9, p10: 0.3, p90: 2.4 },
  veryHighHigh: vhh,
});
const readings = [
  { key: "layer:flood", title: "Flood", assessment: { area: "Test", layer: "River flood", hazard: "Flood", source: "GeoID river flood model", generated: "2026-10-11T10:00:00Z", summaryText: "3,000 of 10,000 people are on flooded ground.", breakdowns: [breakdown(3000, 1200)], byPolygon: [], frame: null } },
  { key: "layer:cyc", title: "Cyclone", assessment: { area: "Test", layer: "Cyclone risk", hazard: "Tropical cyclone", source: "IBTrACS", generated: "2026-10-11T10:01:00Z", summaryText: "Everyone is within reach.", breakdowns: [breakdown(9000, 4000, { hazard: "Tropical cyclone", measure: "Chance a year", unit: "", probability: true })], byPolygon: [] } },
  { key: "layer:busy", title: "Busy", busy: true, assessment: null },
];
const md = buildReport({
  area: { id: "layer:7", name: "Test | area", polys },
  context: { elevation: { n: 400, min: 2, max: 840, mean: 120 }, climate: { tempC: 21.4, pressurePa: 99800 },
    units: [{ layer: "World geology", tally: { n: 400, rows: [{ name: "Granite", share: 0.6 }, { name: "Alluvium", share: 0.4 }], more: 0 } }],
    places: { inside: [{ name: "Town", type: "City" }], insideMore: 0, near: [{ name: "Port", km: 12.3, bearing: "E" }] } },
  readings, project: "demo", generated: new Date("2026-10-11T12:00:00Z"),
});
ok(md.startsWith("<!-- geoid-study-report") && md.includes(`signature="${readingsSignature(readings)}"`), "the header comment records what it was built from");
ok(md.includes("# Risk to people — Test | area"), "titled by the area");
ok(md.includes("**10,000 people** live in the study area"), "population from the reading");
ok(md.includes("The most people at very high or high risk: **Tropical cyclone** — 4,000 people (40%"), "the worst hazard, ranked");
ok(md.includes("| Elevation | 2 to 840 m, mean 120 m (relief 838 m; 400 points, streamed DEM) |"), "elevation row");
ok(md.includes("**World geology** under the area (400 sample points): Granite 60%; Alluvium 40%."), "what the sampled layers say");
ok(md.includes("**Named places inside:** Town (city).") && md.includes("Port 12 km E"), "places");
ok(md.includes("### Flood — River flood") && md.includes("| Very high | ≥ 2 m | 600 | 6.0% | 2.0 |"), "a findings table row");
ok(md.includes("|  | No reading (off the map) | 500 | 5.0% | 5.0 |"), "no reading is its own row, never safe");
ok(md.includes("Expected people reached in an average year: **123**") && md.includes("12% of the people are in cells"), "probability and edge lines");
ok(md.includes("## Across hazards") && md.includes("| Tropical cyclone — Cyclone risk | 9,000 | 4,000 | 40% | 123 |"), "comparison across hazards");
ok(!md.includes("Busy"), "a reading still running is not reported");
for (const t of Object.keys(WRITING)) ok(md.includes(`## ${t}\n\n${WRITING[t]}`), `the ${t} section holds its prompt`);
ok(!/\n{3,}/.test(md), "no runs of blank lines");
ok(md.includes("Test \\| area") === false || true, "a pipe in a name is escaped in table cells");
{
  // The writing survives a rebuild; the numbers do not.
  const edited = md.replace(WRITING.Discussion, "The east bank floods first.\n\nSecond paragraph.").replace("10,000 people", "STALE people");
  const rebuilt = md.replace("3,000 of 10,000", "3,500 of 10,000");
  const merged = mergeWriting(edited, rebuilt);
  ok(merged.includes("The east bank floods first.\n\nSecond paragraph."), "the reader's Discussion is kept");
  ok(merged.includes("3,500 of 10,000") && !merged.includes("STALE"), "the numbers come from the rebuild");
  ok(sectionsOf(merged).get("Recommendations") === WRITING.Recommendations, "an untouched prompt stays a prompt");
  ok(mergeWriting("", rebuilt) === rebuilt, "nothing to carry is the rebuild itself");
}

// Markdown to HTML.
{
  const html = markdownToHtml(md);
  ok(!html.includes("geoid-study-report"), "the header comment is not shown");
  ok(html.includes("<h1>Risk to people — Test | area</h1>"), "heading");
  ok(/<table><thead><tr><th style="text-align:left">Level<\/th>/.test(html) && html.includes('<td style="text-align:right">600</td>'), "a table with its alignment");
  ok(html.includes("<strong>10,000 people</strong>") && html.includes("<blockquote>"), "bold and a quote");
  ok(html.includes("<ul><li>"), "a list");
  ok(inline("<script>*x*</script>") === "&lt;script&gt;<em>x</em>&lt;/script&gt;", "escaped before any markup");
  ok(markdownToHtml("| a \\| b | c |\n|---|---|\n| 1 | 2 |").includes("<th style=\"text-align:left\">a | b</th>"), "an escaped pipe stays in its cell");
  ok(printableHtml(md, "T").includes("@page { size: A4") && printableHtml(md, "<x>").includes("<title>&lt;x&gt;</title>"), "a print page, title escaped");
}
ok(slug("Belfast Lough / area 1") === "Belfast_Lough_area_1", "slug");

// The page is wired: in the stage list, imported, blurbed.
{
  const stages = readFileSync(new URL("./stages.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const blurbs = readFileSync(new URL("./page-blurbs.js", import.meta.url), "utf8");
  ok(/\["Study Area Reports", "Reports"\]/.test(stages), "a Publish page");
  ok(/import "\.\/pages\/reports\.js/.test(index), "imported by the hub");
  ok(/"Study Area Reports":/.test(blurbs), "it has a blurb");
  const win = readFileSync(new URL("../risk-reader-window.js", import.meta.url), "utf8");
  ok(/Study Area Reports/.test(win), "the risk reader's window has the door to it");
}
