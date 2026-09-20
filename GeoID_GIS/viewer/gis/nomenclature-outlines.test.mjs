/**
 * Run: node GeoID_GIS/viewer/gis/nomenclature-outlines.test.mjs
 *
 * The IAU outline layer: which worlds are offered, the west-positive flip, the
 * frame a moon's outlines are hung in -- and, where the bake is on disk, that
 * every file will be taken by the importer as georeferenced and carries the
 * columns the card reads.
 *
 * THE FRAME IS THE PART WORTH PINNING. A moon's outlines are placed by a
 * mapping from the gazetteer's east longitude to that moon's mesh, and the
 * obvious source for it -- inverting the viewer's own °W rule -- is wrong on
 * six of the twenty moons, whose "°W" is really an east longitude. The
 * orthogonality check in `moonFrame` cannot catch that, because the error is a
 * REFLECTION and a reflection is orthogonal. So the mapping is fitted to the
 * moon's own markers, and these checks hold it there.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
let passed = 0; const failures = [];
const ok = (cond, msg) => { if (cond) passed += 1; else failures.push(msg); };
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`${passed} passed${failures.length ? `, ${failures.length} failed` : ""}`);
  if (failures.length) process.exitCode = 1;
});

const m = await import("./nomenclature-outlines.js");
const src = readFileSync(join(HERE, "nomenclature-outlines.js"), "utf8");

/* ── Which worlds ─────────────────────────────────────────────────────── */

ok(Object.keys(m.OUTLINE_BODIES).sort().join() === "mars,mercury,moon,pluto,venus",
  "the five surfaced worlds the gazetteer outlines");
ok(Object.keys(m.OUTLINE_MOONS).length === 20, "twenty moons carry outlines");
ok(m.MOON_HOSTS.has("jupiter") && m.MOON_HOSTS.has("saturn") && !m.MOON_HOSTS.has("earth"),
  "a gas giant hosts moons; Earth is not here at all");

/**
 * THE BAKE AND THE VIEWER NAME ONE LIST. A world in one and not the other is
 * either a tick that can only fail or a published file nothing offers.
 */
const bake = readFileSync(join(ROOT, "GeoID_GIS", "services", "bake-nomenclature.py"), "utf8");
const bakedMoons = (bake.match(/MOONS = \{m\.lower\(\): m for m in \(([\s\S]*?)\)\}/) || [, ""])[1]
  .match(/"([A-Z]+)"/g)?.map((s) => s.replace(/"/g, "").toLowerCase()).sort() || [];
ok(bakedMoons.join() === Object.keys(m.OUTLINE_MOONS).sort().join(),
  `the bake and the viewer offer the same moons (${bakedMoons.length} baked)`);
const bakedBodies = (bake.match(/BODIES = \{([\s\S]*?)\}/) || [, ""])[1]
  .match(/"([a-z]+)":/g)?.map((s) => s.slice(1, -2)).sort() || [];
ok(bakedBodies.join() === Object.keys(m.OUTLINE_BODIES).sort().join(),
  "the bake and the viewer offer the same planets");

/* ── The west-positive flip ───────────────────────────────────────────── */

ok(m.isWestPositive("mercury") && !m.isWestPositive("moon") && !m.isWestPositive("venus")
  && !m.isWestPositive("pluto") && !m.isWestPositive("mars"),
  "only Mercury's viewer reads longitude west-positive");
const fc = { type: "FeatureCollection", features: [
  { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[10, 1], [-20, 2], [0, 3], [10, 1]]] } },
  { type: "Feature", properties: {}, geometry: null }] };
const w = m.toWestPositive(fc);
ok(JSON.stringify(w.features[0].geometry.coordinates) === "[[[-10,1],[20,2],[0,3],[-10,1]]]",
  "the flip negates longitude and keeps latitude");
ok(fc.features[0].geometry.coordinates[0][0][0] === 10, "and does not touch the file it was given");
ok(w.features[1].geometry === null, "a feature with no geometry passes through");

/* ── The centre a card and a match both read ──────────────────────────── */

const box = { type: "Polygon", coordinates: [[[10, -4], [20, -4], [20, 6], [10, 6], [10, -4]]] };
const c = m.bboxCentre(box);
ok(c.lon === 15 && c.lat === 1, "the bbox centre, longitude 0-360");
ok(m.bboxCentre({ type: "Polygon", coordinates: [[[-170, 0], [170, 0], [175, 5], [-170, 0]]] }).lon === 180,
  "a feature cut at the seam centres on 180, not on 0");
ok(m.bboxCentre({ type: "Point", coordinates: [-30, 0] }).lon === 330, "a west longitude wraps to 0-360");
ok(m.bboxCentre(null) === null && m.bboxCentre({ type: "Polygon" }) === null,
  "no coordinates, no centre");
const item = m.sceneItem({ properties: { name: "Aeneas", type: "Crater, craters", diameter_km: 161, approved: 1982 }, geometry: box });
ok(item.name === "Aeneas" && item.type === "Crater" && item.lon === 15 && item.lat === 1,
  "the card's item reads that same centre");
ok(m.sceneItem({ properties: {}, geometry: box }) === null, "a feature with no name opens no card");

/* ── The frame, fitted from the markers ───────────────────────────────── */

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const pairsFrom = (sgn, b, easts, lat = 0) => easts.map((east) => ({
  name: `f${east}`, east, lat, meshLon: wrap180(sgn * east + b),
}));

for (const [sgn, b] of [[1, 30], [-1, 200], [1, -145], [-1, 0]]) {
  const fit = m.fitEastToMesh(pairsFrom(sgn, b, [0, 40, 95, 200, 310]));
  const worst = fit ? Math.max(...[0, 40, 95, 200, 310].map(
    (e) => Math.abs(wrap180(fit(e) - (sgn * e + b))))) : Infinity;
  ok(fit && worst < 1e-9, `the fit recovers sgn ${sgn} offset ${b} (worst ${worst.toFixed(12)})`);
}

/**
 * The whole point: a MIRRORED reading of the same markers must lose. These
 * pairs are sgn -1; a fit that answered sgn +1 would place every outline on
 * the other side of the prime meridian, which is the fault this file exists
 * to close, and `moonFrame` would accept it.
 */
const mirrored = m.fitEastToMesh(pairsFrom(-1, 200, [10, 55, 130, 240, 300]));
ok(mirrored && Math.abs(wrap180(mirrored(90) - mirrored(0) + 90)) < 1e-9,
  "the handedness is read off the markers, not assumed");
ok(m.fitEastToMesh(pairsFrom(1, 0, [10])) === null, "one pair cannot say which way round it is");
ok(m.fitEastToMesh([]) === null && m.fitEastToMesh(null) === null, "no pairs, no fit");
ok(m.fitEastToMesh([
  { east: 0, lat: 0, meshLon: 0 }, { east: 90, lat: 0, meshLon: 12 },
  { east: 180, lat: 0, meshLon: 155 }, { east: 270, lat: 0, meshLon: 41 },
]) === null, "markers that agree with neither handedness are refused rather than fitted");
ok(m.fitEastToMesh(pairsFrom(1, 30, [0, 40, 95], 78)) === null,
  "a pair near the pole is not evidence about longitude");
const noisy = pairsFrom(1, 30, [0, 40, 95, 200, 310]);
noisy[2].meshLon += 140;               // one feature centred across a seam
const robust = m.fitEastToMesh(noisy);
ok(robust && Math.abs(wrap180(robust(0) - 30)) < 1e-9,
  "one wild pair does not move the fit: the median decides");

/* ── The frame the fit is turned into ─────────────────────────────────── */

const rad = Math.PI / 180;
const eastFrame = (lat, lon) => ({
  x: Math.cos(lat * rad) * Math.cos(lon * rad),
  y: Math.sin(lat * rad),
  z: Math.cos(lat * rad) * Math.sin(lon * rad),
});
ok(m.moonFrame((east) => east, eastFrame) !== null, "an affine mapping gives a frame");
ok(m.moonFrame((east) => 2 * east, eastFrame) === null,
  "a mapping with the wrong SCALE fails the orthogonality check");
ok(m.moonFrame(null, eastFrame) === null && m.moonFrame("east", eastFrame) === null,
  "moonFrame takes the mapping itself, never a rule to invert");

/* ── The picker and the loading path ──────────────────────────────────── */

const tri = (lon, lat, r) => ({ type: "Polygon", coordinates: [[[lon - r, lat - r], [lon + r, lat - r], [lon + r, lat + r], [lon - r, lat + r], [lon - r, lat - r]]] });
const feats = [
  { properties: { name: "Regio" }, geometry: tri(0, 0, 20) },
  { properties: { name: "Crater" }, geometry: tri(0, 0, 2) },
];
ok(m.featureUnder(feats, 0, 0).properties.name === "Crater",
  "a regio holds the crater: the pointer means the smallest");
ok(m.featureUnder(feats, 0, 10).properties.name === "Regio", "and the regio where the crater is not");
ok(m.featureUnder(feats, 80, 0) === null, "nothing under a point on neither");

ok(/frame: false, hold: false/.test(src), "loading does not throw the camera or stop the globe");
ok(/<input id="nomenclature-outlines-toggle" type="checkbox"\n/.test(src)
  && !/nomenclature-outlines-toggle" type="checkbox" checked/.test(src), "the tick opens OFF");
ok(/<summary[^>]*>[\s\S]*nomenclature-outlines-toggle[\s\S]*<\/summary>/.test(src),
  "the tick is on the card header, visible while folded");
ok(/importFileList/.test(src), "it goes in through the importer, so it is an ordinary Workspace layer");
ok(/"\.\/nomenclature-outlines\.js"/.test(readFileSync(join(HERE, "boot.js"), "utf8")),
  "the planet pages load it");
ok(/groundPick = false/.test(src), "a moon layer opts out of this planet's ground picker");

/**
 * THE ORDER IS THE FIX. Comments are stripped first: the header explains the
 * fallback by name, and prose is not a call.
 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const hang = code.slice(code.indexOf("function hangOnMoon"));
const fitAt = hang.indexOf("fitEastToMesh(");
const ruleAt = hang.indexOf("eastToMeshLon(");
ok(fitAt > 0 && ruleAt > 0 && fitAt < ruleAt,
  "hangOnMoon fits from the markers BEFORE falling back to the viewer's °W rule");
ok(/const toMesh = fitted \|\| eastToMeshLon/.test(hang),
  "and the rule is only ever the fallback");

/* ── Extents: the gazetteer's box, not the feature's shape ────────────── */

ok(m.isExtent({ properties: { extent: true } }), "a flagged feature is an extent");
ok(!m.isExtent({ properties: { name: "Copernicus" } }), "an outline is not");
ok(!m.isExtent({}) && !m.isExtent(null), "and neither is nothing");

ok(m.outlineSummary([{ properties: {} }, { properties: {} }]) === "2 named features outlined",
  "a world with no extents says so plainly");
const mixed = m.outlineSummary([{ properties: { extent: true } }, { properties: {} }]);
ok(/1 of them the gazetteer's EXTENT/.test(mixed) && /drawn unfilled/.test(mixed),
  "a world with extents says how many, and what is done about them");
ok(!/outlined/.test(mixed), "and does not call them outlined");

/**
 * THE PREDICATE MUST REACH THE RENDERER, on BOTH paint paths. A layer that is
 * filled on load and unfilled after its first recolour is worse than either.
 */
const renderSrc = readFileSync(join(HERE, "vector-render.js"), "utf8");
ok(/unfilled = null,/.test(renderSrc), "renderFeatureCollection takes the predicate");
ok((renderSrc.match(/strokeScale, flat, unfilled,/g) || []).length === 2,
  "and buildVectorLayerResult forwards it on the build AND the repaint");
ok(/const asOutline = outlineOnly \|\| \(unfilled \?/.test(renderSrc),
  "the fill is decided per feature, not per layer");
ok(/unfilled: typeof ctx\?\.unfilled === "function"/.test(readFileSync(join(HERE, "import-manager.js"), "utf8")),
  "and the importer carries it from the caller");
ok(/unfilled: isExtent/.test(src), "the outlines layer asks for it");

/* ── The bake on disk ─────────────────────────────────────────────────── */

const checkFile = (key, name, minFeatures) => {
  const p = join(ROOT, "data", "global", "nomenclature", `${key}.geojson`);
  if (!existsSync(p)) { console.log(`   (${key}.geojson not on disk -- bake-nomenclature.py; skipped)`); return; }
  const d = JSON.parse(readFileSync(p, "utf8"));
  let lonBad = 0; let latBad = 0;
  const walk = (co) => {
    if (typeof co[0] === "number") {
      if (Math.abs(co[0]) > 180) lonBad += 1;
      if (Math.abs(co[1]) > 90) latBad += 1;
    } else co.forEach(walk);
  };
  d.features.forEach((f) => f.geometry && walk(f.geometry.coordinates));
  ok(lonBad === 0 && latBad === 0,
    `${name}: every coordinate is signed east inside ±180/±90 (${lonBad}, ${latBad})`);
  ok(d.features.length >= minFeatures
    && d.features.every((f) => f.properties.name && f.properties.type),
    `${name}: named and typed features (${d.features.length})`);
  ok(!d.features.some((f) => /Ã/.test(f.properties.name)), `${name}: names decoded as UTF-8`);
  ok(d.features.every((f) => f.geometry && m.bboxCentre(f.geometry)),
    `${name}: every feature has a centre a card and a match can read`);
};

for (const [key, body] of Object.entries(m.OUTLINE_BODIES)) checkFile(key, body.name, 50);
// a moon may honestly have one: Hyperion's gazetteer holds a single dorsum
for (const [key, name] of Object.entries(m.OUTLINE_MOONS)) checkFile(key, name, 1);

/* ── The boxes are held back ──────────────────────────────────────────────
 *
 * The gazetteer splits in two and the map has to say so. Seven bodies are
 * digitised outlines with no box among them; eighteen are mostly or entirely
 * the feature's BOUNDING BOX -- Venus 373 of 414, Titania and Oberon every
 * one. A box drawn is a claim about a shape nobody drew, so the default is
 * the features somebody outlined and the boxes are one tick away.
 *
 * Pinned on the SOURCE as well as the arithmetic: the filter is one line in
 * the fetch, and a later edit that drops it would leave every check below
 * passing while the map went back to rectangles.
 */
{
  const box = (name) => ({ type: "Feature", properties: { name, extent: true },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] } });
  const drawn = (name) => ({ type: "Feature", properties: { name },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0.5, 2], [0, 0]]] } });

  const fc = { type: "FeatureCollection", _source: "kept",
    features: [box("a"), drawn("b"), box("c"), drawn("d")] };
  const cut = m.withoutExtents(fc);
  ok(cut.features.length === 2 && cut.features.every((f) => !m.isExtent(f)),
     "withoutExtents keeps only what was outlined");
  ok(cut.features.map((f) => f.properties.name).join() === "b,d",
     "withoutExtents keeps them in file order");
  ok(fc.features.length === 4,
     "withoutExtents does not mutate the collection it was given");
  ok(cut._source === "kept",
     "withoutExtents carries the file's own _source through");
  ok(m.withoutExtents({ type: "FeatureCollection", features: [] }).features.length === 0
     && m.withoutExtents({}).features.length === 0,
     "withoutExtents survives an empty or shapeless collection");

  // The sentence is the only thing that says why a world is emptier than its
  // feature count. All three cases have to be distinguishable.
  const held = m.outlineSummary([drawn("b"), drawn("d")], 373);
  ok(/\b2\b/.test(held) && /373/.test(held) && /held back/i.test(held),
     "the summary names what is drawn AND what is held back");
  const none = m.outlineSummary([], 16);
  ok(/outlined none/i.test(none) && /16/.test(none) && !/^0\b/.test(none),
     "a body of nothing but boxes says the gazetteer outlined none of them");
  ok(!/held back/i.test(m.outlineSummary([drawn("b")], 0)),
     "a body with no boxes says nothing about boxes");
  ok(/unfilled/.test(m.outlineSummary([box("a"), drawn("b")], 0)),
     "with the boxes shown, the summary still says they are drawn unfilled");

  // Source: comments stripped first, because the prose above the code names
  // every one of these strings -- the scanner would otherwise pass on its own
  // explanation, which this tree has paid for before.
  const src = readFileSync(join(HERE, "nomenclature-outlines.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(/showExtents\(\)\s*\?\s*all\s*:\s*withoutExtents\(all\)/.test(src),
     "the fetch filters the boxes out unless they are asked for");
  ok(/unfilled:\s*isExtent/.test(src),
     "a box that IS drawn is still drawn unfilled");
  ok(/id="nomenclature-extents-toggle"/.test(src),
     "the panel offers the tick that draws them");
  ok(/localStorage\?\.setItem\(EXTENTS_KEY/.test(src)
     && /localStorage\?\.getItem\(EXTENTS_KEY\)/.test(src),
     "the choice is remembered per browser");
  ok(/catch\s*\{\s*return false;\s*\}/.test(src),
     "a storage that throws answers 'hidden' rather than throwing");
}

/* What each baked body would DRAW with the boxes held back, from the files
 * themselves. The three that draw nothing are the reason the empty case is a
 * sentence rather than a failed import. */
{
  const dir = join(HERE, "..", "..", "..", "data", "global", "nomenclature");
  const names = { ...m.OUTLINE_BODIES, ...m.OUTLINE_MOONS };
  let checked = 0, allBoxes = [];
  for (const key of Object.keys(names)) {
    const file = join(dir, `${key}.geojson`);
    if (!existsSync(file)) continue;
    checked += 1;
    const d = JSON.parse(readFileSync(file, "utf8"));
    const kept = m.withoutExtents(d).features.length;
    ok(kept + d.features.filter(m.isExtent).length === d.features.length,
       `${key}: every feature is either an outline or a box`);
    if (!kept) allBoxes.push(key);
  }
  if (checked) {
    ok(allBoxes.sort().join() === "hyperion,oberon,titania",
       `only Titania, Oberon and Hyperion are nothing but boxes (got ${allBoxes.join() || "none"})`);
    const venus = join(dir, "venus.geojson");
    if (existsSync(venus)) {
      const d = JSON.parse(readFileSync(venus, "utf8"));
      ok(m.withoutExtents(d).features.length === 41 && d.features.length === 414,
         `Venus draws 41 of its 414 (got ${m.withoutExtents(d).features.length} of ${d.features.length})`);
    }
  }
}
