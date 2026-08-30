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

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
