/**
 * LAND ICE (CPOM): THE BAKE AND THE LAYER, PINNED TO EACH OTHER.
 *
 * The manifest's grid is what the drape's lattice is built from, and the
 * bands it lists are what the time bar steps through — a manifest that drifts
 * from the bake draws Antarctica in the wrong place or a year under the wrong
 * label, and neither throws. So the shapes are checked here, along with the
 * colour classes, the elevation-to-mass conversion and the chart.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KINDS, PALETTE, classOf, valueAt, paint, legendFor, epochLabel, rebase,
  seriesOptions, seriesFor, chartSvg, niceStep, reconcileText,
} from "./cpom-landice.js";
import { inverse } from "./polar-stereo.js";

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const dir = path.join(root, "data", "global", "ice", "cpom");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const panel = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
const baker = fs.readFileSync(path.join(root, "GeoID_GIS", "services", "bake-cpom-landice.py"), "utf8");

// ── the manifest ────────────────────────────────────────────────────────
const ant = manifest.regions?.antarctica;
ok("manifest lists Antarctica as published", ant?.status === "published");
ok("Antarctica is EPSG:3031", ant?.crs === "EPSG:3031");
ok("the grid is CPOM's 5 km 1128 × 968", ant?.grid?.nx === 1128 && ant?.grid?.ny === 968 && ant?.grid?.dx === 5000);
ok("rows are north-up: the first row is the top (y0 > 0)", ant?.grid?.y0 === 2417500 && ant?.grid?.x0 === -2817500);
ok("bands start in 1993", ant?.bands?.[0]?.end?.startsWith("1993"));
ok("bands run to 2025 or later", Number(ant?.bands?.at(-1)?.end?.slice(0, 4)) >= 2025);
ok("bands are numbered 0..n-1 in order", ant?.bands?.every((b, i) => b.band === i));
ok("the density band follows the last year", ant?.density_band === ant?.bands?.length);
ok("a freshness probe is named on CEDA's download host", /^https:\/\/dap\.ceda\.ac\.uk\//.test(ant?.next || ""));
ok("a citation and a licence are recorded", /CPOM/.test(ant?.citation || "") && /ESA CCI/.test(ant?.licence || ""));
// The grid's top-left corner is in the South Pacific sector, not mirrored.
{
  const c = inverse(ant.grid.x0, ant.grid.y0);
  ok("the top-left cell is at ~57°S, ~49°W (EPSG:3031 orientation)",
    Math.abs(c.lat + 56.76) < 0.01 && Math.abs(c.lon + 49.37) < 0.01, JSON.stringify(c));
}

// ── Greenland is a stub until the portal publishes it ───────────────────
const gr = manifest.regions?.greenland;
ok("Greenland has a manifest entry", Boolean(gr));
ok("Greenland is pending, with no raster", gr?.status === "pending" && !gr?.raster);
ok("Greenland's grid would be EPSG:3413", gr?.crs === "EPSG:3413");
ok("the bake keeps a Greenland entry to fill in", /"greenland":\s*\{/.test(baker));

// ── the basin series ────────────────────────────────────────────────────
const series = JSON.parse(fs.readFileSync(path.join(dir, "antarctica-basins.json"), "utf8"));
ok("one value per band in every basin", series.basins.every((b) => b.mass_gt.length === ant.bands.length));
ok("all eighteen IMBIE basins are named", series.basins.length === 18
  && new Set(series.basins.map((b) => b.name)).size === 18);
ok("Pine Island and Thwaites is G-H, in West Antarctica",
  series.basins.some((b) => b.name === "G-H" && b.region === "West" && /Thwaites/.test(b.place)));
{
  const gh = series.basins.find((b) => b.name === "G-H");
  ok("G-H has lost mass since 1993 (Amundsen Sea)", gh.mass_gt.at(-1) < -1000, gh.mass_gt.at(-1));
  const west = series.regions.West.mass_gt.at(-1);
  const total = series.regions.Antarctica.mass_gt.at(-1);
  ok("West Antarctica has lost mass", west < 0, west);
  const sum = ["East", "West", "Peninsula"].reduce((a, r) => a + series.regions[r].mass_gt.at(-1), 0);
  ok("the sheet total is the sum of its regions", Math.abs(sum - total) < 1, `${sum} vs ${total}`);
  const basinSum = series.basins.reduce((a, b) => a + (b.mass_gt.at(-1) || 0), 0);
  ok("the basins sum to the sheet total", Math.abs(basinSum - total) < 2, `${basinSum} vs ${total}`);
}
// ── reconciliation with IMBIE ───────────────────────────────────────────
{
  const im = series.imbie;
  ok("IMBIE 2021 is carried for all four regions", ["Antarctica", "West", "East", "Peninsula"].every((r) => im?.series?.[r]?.gt?.length));
  ok("IMBIE is re-zeroed at Jan 1993 (starts at ~0)", Math.abs(im.series.Antarctica.gt[0]) < 15, im.series.Antarctica.gt[0]);
  ok("IMBIE AIS 1993-2020 is about −2,600 Gt (Otosaka et al. 2023)",
    im.series.Antarctica.gt.at(-1) < -2400 && im.series.Antarctica.gt.at(-1) > -2800, im.series.Antarctica.gt.at(-1));
  ok("IMBIE is cited with its licence", /10\.5194\/essd-15-1597-2023/.test(im.citation) && /Open Government Licence/.test(im.licence));
  const r = series.reconcile;
  ok("the reconciliation window ends where IMBIE does (2020)", r?.to?.startsWith("2020"));
  ok("IMBIE regions sum to its sheet total", Math.abs(["West", "East", "Peninsula"].reduce((a, k) => a + r.imbie_gt[k], 0) - r.imbie_gt.Antarctica) < 15);
  const sens = Object.values(r.density_sensitivity_gt);
  ok("the density sensitivity brackets IMBIE's total", Math.min(...sens) < r.imbie_gt.Antarctica && Math.max(...sens) > r.imbie_gt.Antarctica, JSON.stringify(r.density_sensitivity_gt));
  ok("the sensitivity includes this product's own rule, equal to its sheet total",
    Math.abs(r.density_sensitivity_gt["this product's rule"] - r.altimetry_gt.Antarctica) < 2);
  const text = reconcileText(series);
  ok("the reconciliation says outright it is not the IMBIE number", /^Not the IMBIE number/.test(text) && /IMBIE 2021 −2,6\d\d Gt/.test(text), text);
  ok("and names the cause (density / firn models)", /firn-densification/.test(text));
}
ok("a gravimetric series rides beside it", Boolean(series.gravimetric?.series?.Antarctica?.gt?.length));

// ── classes and values ──────────────────────────────────────────────────
ok("nine colours for eight edges", PALETTE.length === KINDS.sec.edges.length + 1
  && PALETTE.length === KINDS.mass.edges.length + 1);
ok("classOf: deep loss is class 0", classOf(-50, KINDS.sec.edges) === 0);
ok("classOf: no change is the middle class", classOf(0, KINDS.sec.edges) === 4);
ok("classOf: big gain is the last class", classOf(50, KINDS.sec.edges) === 8);
ok("valueAt: centimetres to metres", valueAt(-123, null, "sec") === -1.23);
ok("valueAt: nodata is null", valueAt(-32768, 917, "sec") === null);
ok("valueAt: mass is dh × density / 1000 (m w.e.)", Math.abs(valueAt(-1000, 917, "mass") + 9.17) < 1e-9);
ok("valueAt: mass with no density is null", valueAt(-1000, -32768, "mass") === null);
{
  const px = paint(new Int16Array([-32768, -3000, 0, 3000]), null, "sec", { scale: 0.01, nodata: -32768 });
  ok("paint: nodata is transparent", px[3] === 0);
  ok("paint: −30 m is the deepest red", px[4] === PALETTE[0][0] && px[7] > 0);
  ok("paint: 0 m is the pale middle", px[8] === PALETTE[4][0]);
  ok("paint: +30 m is the deepest blue", px[14] === PALETTE[8][2]);
}
{
  const l = legendFor("mass");
  ok("legend: one label per colour", l.labels.length === l.palette.length);
  ok("legend: states its unit", /m w\.e\./.test(l.label) && l.unit === "m w.e.");
}
ok("epochLabel: a full year is the year", epochLabel("202412") === "2024");
ok("epochLabel: the partial last year keeps its month", epochLabel("202511", { last: true }) === "Nov 2025");

// ── the chart ───────────────────────────────────────────────────────────
{
  const g = rebase({ years: [2000, 2001, 2002], gt: [10, 20, 30] }, [2000, 2001, 2002], [110, 120, 130]);
  ok("rebase: shifts by the mean difference", g.join() === "110,120,130", g.join());
  const opts = seriesOptions(series);
  ok("chart choices: the sheet first, then three regions, then basins",
    opts[0].value === "region:Antarctica" && opts.length === 1 + 3 + 18);
  const s = seriesFor(series, "region:West");
  ok("regions carry the gravimetric line", Boolean(s.grav?.gt?.length));
  ok("basins do not (GRACE's basins are not IMBIE's)", seriesFor(series, "basin:9").grav === null);
  const svg = chartSvg(series, "region:Antarctica", { index: ant.bands.length - 1 });
  // altimetry + IMBIE + IMBIE's band + GRACE
  ok("chart: altimetry, IMBIE (line and band) and GRACE, and a marker",
    svg.startsWith("<svg") && (svg.match(/<path/g) || []).length === 4 && /<circle/.test(svg), (svg.match(/<path/g) || []).length);
  ok("chart: labelled in Gt since Jan 1993", /Gt since Jan 1993/.test(svg));
  ok("chart: a key names the altimetry line and IMBIE apart", /Altimetry \(this layer\)/.test(svg) && /IMBIE 2021/.test(svg));
  const xs = [...svg.matchAll(/<text x="([\d.]+)" y="21"[^>]*>([^<]+)</g)].map((m) => [Number(m[1]), m[2]]);
  ok("chart key labels do not overlap", xs.every(([x, label], i) => i === 0 || x >= xs[i - 1][0] + xs[i - 1][1].length * 4.4),
    JSON.stringify(xs));
  ok("chart key fits the chart", xs.length && xs.at(-1)[0] + xs.at(-1)[1].length * 4.4 <= 300, JSON.stringify(xs.at(-1)));
  ok("a basin chart has no IMBIE line (IMBIE is per region)", seriesFor(series, "basin:9").imbie === null);
  ok("niceStep is 1-2-5", niceStep(4000) === 1000 && niceStep(700) === 200 && niceStep(30) === 10);
}

// ── the panel ───────────────────────────────────────────────────────────
for (const id of ["cpom-sheets", "cpom-sheet", "cpom-kind", "cpom-run", "cpom-basin", "cpom-chart", "cpom-status"]) {
  ok(`panel has #${id}`, panel.includes(`id="${id}"`));
}
ok("the module is loaded by the page", /gis\/cpom-landice\.js\?v=/.test(panel));
ok("it sits in the Ice cover subtab", panel.indexOf('id="geology-ice-cpom"') > panel.indexOf('id="geology-ice"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
