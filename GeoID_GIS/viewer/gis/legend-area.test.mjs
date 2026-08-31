/**
 * A LEGEND IS RANKED BY GROUND, not by how many pieces a unit arrived in.
 *
 * Sorting on feature COUNT reads a map by fragmentation: a unit broken into
 * nine slivers outranks one solid mass, and the mass is what a reader is
 * looking at. Measured on a 47 km clip of Macrostrat, the legend said "12 of
 * 23 units" and the unit it left out was a SINGLE polygon covering 351 km2 —
 * pale enough to read as white, so with no legend row there was nothing to
 * tell a reader it was a unit rather than a hole. It was reported as missing
 * data twice before the cause was the legend.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

const { legendFrom, featureAreaKm2 } = await import("./macrostrat.js");

const box = (lon, lat, w, h) => [[
  [lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat],
]];
const feat = (name, colour, geometry) => ({
  type: "Feature", properties: { name, color: colour }, geometry,
});
const poly = (lon, lat, w, h) => ({ type: "Polygon", coordinates: box(lon, lat, w, h) });

/* ── the area measure itself ───────────────────────────────────────────── */
{
  // One degree square at the equator is about 111.32 km on a side.
  const oneDeg = featureAreaKm2(feat("a", "#fff", poly(0, 0, 1, 1)));
  ok("a degree square at the equator is about 12,300 km2",
    Math.abs(oneDeg - 12308) < 60, `got ${Math.round(oneDeg)}`);
  // The same square at 55 N covers far less ground.
  const at55 = featureAreaKm2(feat("a", "#fff", poly(0, 55, 1, 1)));
  ok("the same square at 55 N is much smaller", at55 < oneDeg * 0.62, `got ${Math.round(at55)}`);
  ok("a hole is subtracted from its outer ring", (() => {
    const solid = featureAreaKm2(feat("a", "#fff", poly(0, 0, 1, 1)));
    const holed = featureAreaKm2({ type: "Feature", properties: {}, geometry: {
      type: "Polygon", coordinates: [box(0, 0, 1, 1)[0], box(0.25, 0.25, 0.5, 0.5)[0]] } });
    return holed < solid && holed > 0;
  })());
  ok("a multipolygon sums its parts", (() => {
    const two = featureAreaKm2({ type: "Feature", properties: {}, geometry: {
      type: "MultiPolygon", coordinates: [box(0, 0, 1, 1), box(5, 0, 1, 1)] } });
    return Math.abs(two - 2 * featureAreaKm2(feat("a", "#f", poly(0, 0, 1, 1)))) < 60;
  })());
  ok("no geometry is no area", featureAreaKm2({ properties: {} }) === 0);
}

/* ── the ranking ───────────────────────────────────────────────────────── */
{
  // THE REPORTED CASE: one big polygon against a unit in many small pieces.
  const features = [
    feat("big single mass", "#EBEBEB", poly(0, 55, 1, 1)),
    ...Array.from({ length: 9 }, (_, i) =>
      feat("many small pieces", "#FF0000", poly(2 + i * 0.01, 55, 0.005, 0.005))),
  ];
  const legend = legendFrom(features, { count: 1 });
  ok("the unit covering the most ground takes the single row",
    legend.labels[0] === "big single mass", legend.labels.join(", "));
  const both = legendFrom(features, { count: 2 });
  ok("and it is listed FIRST when there is room for both",
    both.labels[0] === "big single mass");
  ok("the legend reports the areas it ranked on",
    Array.isArray(both.areasKm2) && both.areasKm2[0] > both.areasKm2[1]);
}
{
  // Count still breaks a tie, so features with no geometry order sensibly.
  const noGeom = [
    { type: "Feature", properties: { name: "twice", color: "#111" }, geometry: null },
    { type: "Feature", properties: { name: "twice", color: "#111" }, geometry: null },
    { type: "Feature", properties: { name: "once", color: "#222" }, geometry: null },
  ];
  const legend = legendFrom(noGeom, { count: 2 });
  ok("with no geometry to measure, count decides", legend.labels[0] === "twice");
}
{
  const legend = legendFrom([
    feat("kept", "#123456", poly(0, 0, 1, 1)),
    { type: "Feature", properties: { name: "no colour" }, geometry: poly(0, 0, 2, 2) },
  ], { count: 5 });
  ok("a unit with no colour cannot be drawn and is not listed",
    legend.labels.length === 1 && legend.labels[0] === "kept");
  ok("the total counts what could be listed", legend.total === 1 && legend.shown === 1);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
