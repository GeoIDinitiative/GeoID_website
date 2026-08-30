/**
 * THE UNITS THEMSELVES, not the tiles they were served in.
 *
 * `carto` is a tile service and a tile is a cut of the map, so a unit crossing
 * a tile boundary arrives as two polygons meeting along a straight edge.
 * Measured on a 45 km study area at zoom 13: 417 pieces in a visible lattice,
 * one unit ruled into two wherever a tile edge crossed it. The JSON API takes
 * `map_id` in batches and answers with the mapped polygon.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};

const macro = await import("./macrostrat.js");

const feature = (id) => ({
  type: "Feature", properties: { map_id: id, color: "#812B92" },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

const withFetch = async (impl, fn) => {
  const had = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = had; }
};
const answering = (calls) => async (url) => {
  calls.push(url);
  const ids = new URL(url).searchParams.get("map_id").split(",");
  return { ok: true, json: async () => ({ features: ids.map((i) => feature(Number(i))) }) };
};

{
  const calls = [];
  const fc = await withFetch(answering(calls), () => macro.unitsByMapId([1, 2, 3]));
  ok("every id asked for comes back", fc.features.length === 3);
  ok("one batch is one request", calls.length === 1);
  ok("it asks the JSON API, not the tile service", /macrostrat\.org\/api/.test(calls[0]));
  ok("it asks for geometry", /format=geojson_bare/.test(calls[0]));
}

{
  const calls = [];
  // 120 ids at 50 per batch is three requests, not 120.
  const ids = Array.from({ length: 120 }, (_, i) => i + 1);
  const fc = await withFetch(answering(calls), () => macro.unitsByMapId(ids));
  ok("a long list is batched", calls.length === 3);
  ok("batching loses nothing", fc.features.length === 120);
}

{
  const calls = [];
  const fc = await withFetch(answering(calls), () => macro.unitsByMapId([7, 7, 7, 7]));
  ok("a repeated id is asked for once", fc.features.length === 1);
}

{
  // A batch that fails costs its units, never the run: the caller still has
  // the tiled pieces for those, and a hole is worse than a seam.
  let n = 0;
  const flaky = async (url) => {
    n += 1;
    if (n === 1) throw new Error("network");
    const ids = new URL(url).searchParams.get("map_id").split(",");
    return { ok: true, json: async () => ({ features: ids.map((i) => feature(Number(i))) }) };
  };
  const ids = Array.from({ length: 100 }, (_, i) => i + 1);
  const fc = await withFetch(flaky, () => macro.unitsByMapId(ids, { concurrency: 1 }));
  ok("a failed batch does not fail the fetch", fc.features.length === 50);
}

{
  const fc = await withFetch(async () => ({ ok: false, status: 500 }), () => macro.unitsByMapId([1]));
  ok("an error status yields no features rather than throwing", fc.features.length === 0);
  ok("nothing to ask for is answered without a request",
    (await macro.unitsByMapId([])).features.length === 0);
  ok("rubbish ids are dropped", (await macro.unitsByMapId([null, "x", undefined])).features.length === 0);
}

{
  const dropped = async (url) => {
    const ids = new URL(url).searchParams.get("map_id").split(",");
    // The API answers for the first id only: the rest must keep their tiles.
    return { ok: true, json: async () => ({ features: [feature(Number(ids[0]))] }) };
  };
  const fc = await withFetch(dropped, () => macro.unitsByMapId([11, 12, 13]));
  ok("ids the API does not return are simply absent", fc.features.length === 1);
  ok("and the one it did return is the one asked for",
    fc.features[0].properties.map_id === 11);
}

/**
 * BOTH BOX VOCABULARIES, or the fetch is skipped in silence.
 *
 * `areaOfInterest` answers in minX/minY/maxX/maxY and the tile side speaks
 * west/south/east/north. Reading the wrong one makes every comparison false,
 * so no unit is ever "near", the API is never asked, and the clip falls back
 * to tile pieces with nothing in the message to say so. That shipped once.
 */
{
  const { __touches: touches } = await import("./tool-runner.js");
  const unit = {
    geometry: { type: "Polygon", coordinates: [[[-7.2, 54.95], [-7.0, 54.95], [-7.0, 55.1], [-7.2, 54.95]]] },
  };
  const geo = { west: -7.3, east: -6.6, south: 54.9, north: 55.25 };
  const cart = { minX: -7.3, maxX: -6.6, minY: 54.9, maxY: 55.25 };
  ok("a unit inside is near, in tile words", touches(unit, geo) === true);
  ok("a unit inside is near, in extent words", touches(unit, cart) === true);
  const far = { minX: 10, maxX: 11, minY: 10, maxY: 11 };
  ok("a unit far away is not near", touches(unit, far) === false);
  ok("a unit merely OVERLAPPING the edge still counts",
    touches(unit, { minX: -7.05, maxX: 0, minY: 50, maxY: 60 }) === true);
  ok("an unreadable box asks for everything rather than nothing",
    touches(unit, { left: 1, right: 2 }) === true);
  ok("a feature with no geometry is not near", touches({}, cart) === false);
}

/**
 * WHERE TWO SURVEYS COVER THE SAME GROUND, THE FINER ONE IS THE MAP.
 *
 * Macrostrat's tiles hide the overlap — `carto` picks one survey per scale —
 * so fetching whole units brings every survey back on top of each other:
 * measured on a 45 km clip, 80% of it covered by more than one survey, 2,888
 * of 4,900 points by all three. `/defs/sources` answers empty for these ids, so
 * the rank comes from the geometry: VERTICES PER UNIT AREA, boundary detail per
 * unit of ground.
 */
{
  const { __surveyRanks: ranks } = await import("./tool-runner.js");
  // A unit square, so area is 1 and the rank is just the vertex count.
  const square = (id, source, extra = 0) => ({
    properties: { map_id: id, source_id: source },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1],
      ...Array.from({ length: extra }, (_, i) => [1 - (i + 1) / (extra + 1), 1]), [0, 0]]] },
  });
  const r = ranks([square(1, 23, 40), square(2, 147, 0)]);
  ok("the more finely drawn survey ranks higher",
    r.get("23") > r.get("147"));
  ok("every survey present is ranked", r.size === 2);
  ok("a survey with no area is not ranked above a real one",
    ranks([{ properties: { source_id: 9 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 0], [0, 0]]] } }])
      .get("9") === 0);
  ok("features with no source are skipped", ranks([{ properties: {}, geometry: null }]).size === 0);
  ok("nothing in, nothing out", ranks([]).size === 0 && ranks(null).size === 0);

  // The measured ordering on the real clip, as a regression:
  // 23 at 14,624 verts/deg2 beat 154 at 1,549 and 147 at 1,008.
  const many = [];
  for (let i = 0; i < 51; i += 1) many.push(square(i, 23, 43));
  for (let i = 0; i < 15; i += 1) many.push(square(100 + i, 147, 12));
  const rr = ranks(many);
  ok("the detailed land survey outranks the regional ones",
    rr.get("23") > rr.get("147"));
}

/**
 * THE PICKER AND THE PAINTER MUST AGREE ABOUT WHO OWNS THE GROUND.
 *
 * `featureInLayer` returns the FIRST feature whose polygon contains the point,
 * and the extraction sampler is built from the same array in the same order.
 * The draw order is the opposite — coarse first, so the fine fill lands on top.
 * Left as fetched, a click on ground the fine survey holds came back as a
 * regional unit that was not even the one drawn there.
 */
{
  const { __surveyRanks: ranks } = await import("./tool-runner.js");
  const square = (source, extra) => ({
    properties: { source_id: source },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1],
      ...Array.from({ length: extra }, (_, i) => [1 - (i + 1) / (extra + 1), 1]), [0, 0]]] },
  });
  const features = [square(154, 0), square(23, 40)];   // coarse first, as fetched
  const r = ranks(features);
  const rankOf = (f) => r.get(String(f.properties.source_id)) || 0;
  const forPicking = [...features].sort((a, b) => rankOf(b) - rankOf(a));
  const forDrawing = [...features].sort((a, b) => rankOf(a) - rankOf(b));

  ok("the picker meets the FINEST survey first",
    forPicking[0].properties.source_id === 23);
  ok("the painter draws the finest survey LAST, so it lands on top",
    forDrawing[forDrawing.length - 1].properties.source_id === 23);
  ok("the two orders are exact opposites",
    forPicking[0] === forDrawing[forDrawing.length - 1]);
}

/**
 * A COARSE POLYGON A FINER SURVEY ALREADY MAPS IN FULL IS DROPPED.
 *
 * Subtracting the finer polygons is the obvious move and `booleanOp` cannot do
 * it. Measured against a coarse 2x2: a finer square in its CORNER (sharing two
 * edges) came back EMPTY — the whole polygon deleted, 3 units of real ground
 * lost — while a finer square strictly INSIDE returned 4.0, no cut at all,
 * because a hole is not expressible as one ring. A cut that deletes a polygon
 * whenever two share an edge is exactly the "gaps in the mapping" this is
 * meant to end, so geometry is left alone and containment decides.
 */
{
  const { __dropOutranked: drop } = await import("./tool-runner.js");
  const { pointInPolygon } = await import("./geometry.js");
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const feat = (rank, ring, id) => ({ properties: { id, rank },
    geometry: { type: "Polygon", coordinates: [ring] } });
  const rankOf = (f) => f.properties.rank;
  const ids = (out) => out.map((f) => f.properties.id).sort().join(",");

  ok("a coarse polygon a finer survey covers entirely is dropped",
    ids(drop([feat(1, sq(0, 0, 1, 1), "coarse"), feat(9, sq(-1, -1, 2, 2), "fine")],
      rankOf, pointInPolygon)) === "fine");

  ok("a partly covered coarse polygon is KEPT, whole",
    ids(drop([feat(1, sq(0, 0, 2, 2), "coarse"), feat(9, sq(0, 0, 1, 1), "fine")],
      rankOf, pointInPolygon)) === "coarse,fine");

  // THE OFFSHORE CASE: nothing finer reaches it.
  ok("ground no finer survey maps is kept",
    ids(drop([feat(1, sq(10, 10, 12, 12), "offshore"), feat(9, sq(0, 0, 1, 1), "fine")],
      rankOf, pointInPolygon)) === "fine,offshore");

  ok("a polygon is never dropped by one of EQUAL rank",
    drop([feat(5, sq(0, 0, 1, 1), "a"), feat(5, sq(-1, -1, 2, 2), "b")],
      rankOf, pointInPolygon).length === 2);

  ok("a finer polygon is never dropped by a coarser one",
    ids(drop([feat(9, sq(0, 0, 1, 1), "fine"), feat(1, sq(-1, -1, 2, 2), "coarse")],
      rankOf, pointInPolygon)) === "coarse,fine");

  ok("two coarse polygons under one finer blanket both go",
    ids(drop([feat(1, sq(0, 0, 1, 1), "c1"), feat(1, sq(1, 1, 2, 2), "c2"),
      feat(9, sq(-1, -1, 3, 3), "fine")], rankOf, pointInPolygon)) === "fine");

  ok("nothing in, nothing out", drop([], rankOf, pointInPolygon).length === 0);
  ok("a feature with no geometry is kept rather than lost",
    drop([{ properties: { id: "x", rank: 1 }, geometry: null }], rankOf, pointInPolygon).length === 1);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
