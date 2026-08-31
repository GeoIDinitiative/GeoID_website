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
 * THE COARSE SURVEY'S GROUND IS TAKEN AWAY WHERE A FINER ONE MAPS IT.
 *
 * Drawing the finer survey on top is not enough, and dropping only the wholly
 * covered ones is not either: measured, 3,155 of 3,156 points on detailed
 * ground still had a regional polygon underneath, because a coarse unit that
 * runs offshore is only PARTLY covered.
 *
 * `geoprocessing.difference` is the engine for it. `geometry.booleanOp` is
 * not: against a coarse 2x2 with a finer square in its CORNER it returned
 * EMPTY and deleted the polygon whole, and with one strictly INSIDE it cut
 * nothing, a hole being inexpressible as one ring.
 */
{
  const { __dropOutranked: drop } = await import("./tool-runner.js");
  const GP = await import("./geoprocessing.js");
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const feat = (rank, ring, id) => ({ type: "Feature", properties: { id, rank },
    geometry: { type: "Polygon", coordinates: [ring] } });
  const rankOf = (f) => f.properties.rank;
  const area = (f) => {
    const ps = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    return ps.reduce((s, poly) => s + poly.reduce((t, r, ri) => {
      let a = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        a += (r[j][0] * r[i][1]) - (r[i][0] * r[j][1]);
      }
      return t + (ri === 0 ? 1 : -1) * Math.abs(a / 2);
    }, 0), 0);
  };
  const byId = (out, id) => out.find((f) => f.properties.id === id);

  {
    // The real shape of the problem: a coarse unit running offshore, a finer
    // survey over the land part of it.
    const out = drop([feat(1, sq(0, 0, 2, 2), "coarse"), feat(9, sq(0.25, 0.25, 0.75, 0.75), "fine")],
      rankOf, GP.difference);
    const coarse = byId(out, "coarse");
    ok("the coarse polygon loses exactly the finer survey's ground",
      coarse && Math.abs(area(coarse) - 3.75) < 1e-6);
    ok("and the finer one is untouched", Math.abs(area(byId(out, "fine")) - 0.25) < 1e-9);
  }
  {
    const out = drop([feat(1, sq(0, 0, 1, 1), "coarse"), feat(9, sq(-1, -1, 2, 2), "fine")],
      rankOf, GP.difference);
    ok("a wholly covered coarse polygon is gone", !byId(out, "coarse"));
    ok("leaving only the finer survey", out.length === 1);
  }
  {
    // THE OFFSHORE CASE: nothing finer reaches it, so it keeps every bit.
    const out = drop([feat(1, sq(10, 10, 12, 12), "offshore"), feat(9, sq(0, 0, 1, 1), "fine")],
      rankOf, GP.difference);
    ok("ground no finer survey maps is kept whole",
      Math.abs(area(byId(out, "offshore")) - 4) < 1e-9);
  }
  {
    const out = drop([feat(5, sq(0, 0, 2, 2), "a"), feat(5, sq(1, 1, 3, 3), "b")],
      rankOf, GP.difference);
    ok("polygons of EQUAL rank never cut each other",
      out.length === 2 && Math.abs(area(out[0]) - 4) < 1e-9 && Math.abs(area(out[1]) - 4) < 1e-9);
  }
  {
    const three = drop([feat(1, sq(0, 0, 3, 3), "coarse"), feat(5, sq(0.5, 0.5, 1, 1), "mid"),
      feat(9, sq(2, 2, 2.5, 2.5), "fine")], rankOf, GP.difference);
    ok("three tiers each cut by everything finer",
      Math.abs(area(byId(three, "coarse")) - (9 - 0.25 - 0.25)) < 1e-6);
  }
  /**
   * A CUT THAT LOSES GROUND IS REFUSED, not believed.
   *
   * `geoprocessing.difference` subtracts each mask polygon in turn with a
   * routine exact only for a CONVEX clipper, and a survey's units are not
   * convex. Measured on a 47 km clip over Inishowen: subtracting a fine survey
   * covering 1.5% of the north-west quadrant took 15% of the coarse survey's
   * ground there and 44% across the study area — reported three times as
   * "missing polygons". The engine reported no failure either time, because a
   * wrong answer and a right one are both collections.
   */
  {
    // An engine that eats half the subject and touches nothing it should.
    const halfEater = (fc) => ({ type: "FeatureCollection", features: fc.features.map((f) => ({
      ...f, geometry: { type: "Polygon", coordinates: [sq(0, 0, 2, 1)] } })) });
    const out = drop([feat(1, sq(0, 0, 2, 2), "coarse"), feat(9, sq(0.25, 0.25, 0.75, 0.75), "fine")],
      rankOf, halfEater);
    ok("a cut that drops ground no finer survey maps is thrown away",
      Math.abs(area(byId(out, "coarse")) - 4) < 1e-9,
      `got ${area(byId(out, "coarse"))}`);
    ok("and the feature is still there to be kept whole", out.length === 2);
  }
  {
    // An engine that deletes the subject outright, as the real one did to the
    // coarse survey over Inishowen.
    const deleter = () => ({ type: "FeatureCollection", features: [] });
    const out = drop([feat(1, sq(0, 0, 2, 2), "coarse"), feat(9, sq(0.25, 0.25, 0.75, 0.75), "fine")],
      rankOf, deleter);
    ok("a feature deleted whole while it still owed ground is kept",
      byId(out, "coarse") && Math.abs(area(byId(out, "coarse")) - 4) < 1e-9);
  }
  {
    // The other half of the rule: a deletion the finer survey has EARNED
    // still goes through, so the covered case does not regress.
    const deleter = () => ({ type: "FeatureCollection", features: [] });
    const out = drop([feat(1, sq(0, 0, 1, 1), "coarse"), feat(9, sq(-1, -1, 2, 2), "fine")],
      rankOf, deleter);
    ok("a wholly covered feature is still dropped when the engine deletes it",
      !byId(out, "coarse") && out.length === 1);
  }
  {
    /**
     * A BOUNDARY THAT SEPARATES NOTHING is refused, even when no ground is
     * lost. `subtractPolygons` joins the disjoint lobes of a concave subject
     * with a CHORD — measured on the Inishowen clip, unit 3146589 went from
     * one part of 29 vertices to 12 parts of 1,673 carrying a 25.66 km
     * straight edge across the middle of the map. The ground was all still
     * there, which is why checking only for loss let it through.
     */
    const chord = (fc) => ({ type: "FeatureCollection", features: fc.features.map((f) => ({
      ...f,
      // The same 2x2 ground, delivered as two lobes joined across the middle:
      // area intact, with a false edge through one unit.
      geometry: { type: "MultiPolygon", coordinates: [[sq(0, 0, 2, 1)], [sq(0, 1, 2, 2)]] } })) });
    const out = drop([feat(1, sq(0, 0, 2, 2), "coarse"), feat(9, sq(0.25, 0.25, 0.75, 0.75), "fine")],
      rankOf, chord);
    ok("a cut that draws a boundary through the middle of a unit is refused",
      byId(out, "coarse")?.geometry?.type === "Polygon"
        && Math.abs(area(byId(out, "coarse")) - 4) < 1e-9);
  }
  {
    // The other side of that rule: an edge with the FINER SURVEY along it is a
    // real boundary and the cut stands, however long the edge is.
    const alongTheMask = (fc) => ({ type: "FeatureCollection", features: fc.features.map((f) => ({
      ...f, geometry: { type: "Polygon", coordinates: [sq(0, 0.5, 2, 2)] } })) });
    const out = drop([feat(1, sq(0, 0, 2, 2), "coarse"), feat(9, sq(0, 0, 2, 0.5), "fine")],
      rankOf, alongTheMask);
    ok("a long cut edge that the finer survey lies along is accepted",
      Math.abs(area(byId(out, "coarse")) - 3) < 1e-9,
      `got ${area(byId(out, "coarse"))}`);
  }
  {
    // Each feature is judged on its OWN ground: one bad cut must not condemn
    // the good ones, and one good cut must not vouch for the bad.
    const eatsTheSecond = (fc) => ({ type: "FeatureCollection", features: fc.features.map((f) =>
      (f.properties.id === "b"
        ? { ...f, geometry: { type: "Polygon", coordinates: [sq(5, 5, 5.1, 5.1)] } }
        : f)) });
    const out = drop([
      feat(1, sq(0, 0, 2, 2), "a"), feat(1, sq(3, 0, 5, 2), "b"),
      feat(9, sq(0.25, 0.25, 0.75, 0.75), "fine"),
    ], rankOf, eatsTheSecond);
    ok("a bad cut on one feature does not condemn another",
      Math.abs(area(byId(out, "a")) - 4) < 1e-9 && Math.abs(area(byId(out, "b")) - 4) < 1e-9);
  }
  {
    const boom = () => { throw new Error("degenerate"); };
    const out = drop([feat(1, sq(0, 0, 2, 2), "coarse"), feat(9, sq(0.25, 0.25, 0.75, 0.75), "fine")],
      rankOf, boom);
    ok("a failed cut keeps the ground rather than losing it",
      Math.abs(area(byId(out, "coarse")) - 4) < 1e-9);
    ok("and a non-collection answer is refused too",
      Math.abs(area(byId(drop([feat(1, sq(0, 0, 2, 2), "coarse"),
        feat(9, sq(0.25, 0.25, 0.75, 0.75), "fine")], rankOf, () => null), "coarse")) - 4) < 1e-9);
  }
  {
    ok("one tier is left exactly as it came",
      drop([feat(5, sq(0, 0, 1, 1), "a")], rankOf, GP.difference).length === 1);
    ok("nothing in, nothing out", drop([], rankOf, GP.difference).length === 0);
  }
}

/**
 * WHICH SURVEY IS FINER IS THE PUBLISHER'S ANSWER, not a guess from geometry.
 *
 * Vertices per unit area describes how geometry was DELIVERED, not how finely
 * ground was mapped. Measured over Inishowen it inverted: Macrostrat's source
 * 154 scored 1,157 against source 147's 797, because 147's units had been
 * swapped for smooth verbatim API shapes while 154 was still ragged tile
 * pieces. The regional map then outranked the national one, cut it away, and
 * filled the study area with a blanket over ground already better mapped —
 * "you've used the low resolution polygons, it's missing detailed lines".
 *
 * The tile reader knows the real answer while it climbs: this source switches
 * between surveys BY SCALE, so the deepest zoom a survey is served at is its
 * scale. `surveyRanks` takes it when it is offered.
 */
{
  const { __surveyRanks: ranks } = await import("./tool-runner.js");
  const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const at = (src, ring) => ({ type: "Feature", properties: { source_id: src },
    geometry: { type: "Polygon", coordinates: [ring] } });
  // A smooth verbatim polygon from the fine survey, a ragged tiled sliver from
  // the coarse one — the exact shape that inverted the measurement.
  const smoothFine = at(147, box(0, 0, 10, 10));
  const raggedCoarse = at(154, (() => {
    const ring = [];
    for (let i = 0; i <= 60; i += 1) ring.push([i / 6, (i % 2) * 0.01]);
    for (let i = 60; i >= 0; i -= 1) ring.push([i / 6, 1 + (i % 2) * 0.01]);
    ring.push(ring[0]);
    return ring;
  })());
  const features = [smoothFine, raggedCoarse];

  ok("geometry alone ranks the ragged coarse survey above the smooth fine one",
    (ranks(features).get("154") || 0) > (ranks(features).get("147") || 0),
    "the inversion this guards against must stay reproducible");

  {
    // Macrostrat serves 147 to zoom 9 over this ground and 154 only to zoom 6.
    const told = ranks(features, { 147: 9, 154: 6 });
    ok("the published scale puts the finer survey on top", told.get("147") > told.get("154"));
    ok("and the rank IS the zoom, so it reads back", told.get("147") === 9);
  }

  {
    // An unplaced survey would rank 0 and be cut by everything, so a partial
    // answer is refused whole and the measurement runs instead.
    const partial = ranks(features, { 147: 9 });
    ok("a scale map that does not place every survey present is not used",
      partial.get("147") !== 9 && (partial.get("154") || 0) > (partial.get("147") || 0),
      `got ${JSON.stringify([...partial.entries()])}`);
  }

  ok("one zoom for every survey separates nothing and falls through to geometry",
    (() => { const r = ranks(features, { 147: 6, 154: 6 });
      return (r.get("154") || 0) > (r.get("147") || 0); })());

  ok("no scale map at all still ranks by geometry", ranks(features, null).size === 2);

  ok("a single survey is left alone whatever it is told",
    ranks([smoothFine], { 147: 9 }).size === 1);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
