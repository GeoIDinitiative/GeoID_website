/**
 * EVERY INPUT BRINGS ITS BEST DATA FOR THE RUN'S GROUND.
 *
 * The geology clip proved the shape: use what is in hand to learn WHAT is
 * there, then fetch the real thing for the area. The same question applies to
 * every source, and the answer differs by kind rather than by tool — an Earth
 * Engine layer re-renders at the study area's scale, a feature service re-asks
 * for the bbox, and a file says it is already native.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};

/* ── the pixel budget that reaches native resolution ───────────────────── */
{
  const { bestDimensions, overlapBounds } = await import("./gee.js");

  // 1 degree at the equator is 111.3 km; at 30 m native that is ~3,700 px,
  // which the cap holds at 2048.
  const oneDeg = { minX: 0, maxX: 1, minY: -0.5, maxY: 0.5 };
  ok("a degree at 30 m native is capped, not asked for in full",
    bestDimensions(oneDeg, 30) === 2048);
  // A tenth of a degree is 11.1 km; at 30 m that is 371 px, comfortably inside.
  const tenth = { minX: 0, maxX: 0.1, minY: -0.05, maxY: 0.05 };
  ok("a tenth of a degree at 30 m asks for what it needs",
    Math.abs(bestDimensions(tenth, 30) - 371) <= 2);
  ok("a coarse dataset is not asked for detail it does not hold",
    bestDimensions(tenth, 1000) === 256);
  ok("no native scale falls back to the service's own budget",
    bestDimensions(tenth, null) === 1024);
  ok("a nonsense extent still answers a usable number",
    bestDimensions(null, 30) === 1024);
  // Latitude narrows the ground a degree covers, so the same box needs fewer
  // pixels to reach the same metres per pixel.
  const north = { minX: 0, maxX: 0.1, minY: 59.95, maxY: 60.05 };
  ok("latitude is accounted for: the same box needs fewer pixels at 60 N",
    bestDimensions(north, 30) < bestDimensions(tenth, 30));

  /* ── asking only for ground the layer actually covers ─────────────────── */
  const layer = { minX: -8, maxX: -5, minY: 54, maxY: 56 };
  const inside = overlapBounds({ minX: -7, maxX: -6, minY: 54.5, maxY: 55 }, layer);
  ok("a study area inside the layer is itself",
    inside.minX === -7 && inside.maxX === -6);
  const over = overlapBounds({ minX: -9, maxX: -6, minY: 53, maxY: 55 }, layer);
  ok("a study area hanging off the edge is trimmed to what exists",
    over.minX === -8 && over.minY === 54);
  ok("a study area the layer does not reach answers null",
    overlapBounds({ minX: 10, maxX: 11, minY: 10, maxY: 11 }, layer) === null);
  ok("a layer with no bounds accepts the whole area",
    overlapBounds({ minX: 1, maxX: 2, minY: 1, maxY: 2 }, null).maxX === 2);
  ok("no area at all is null", overlapBounds(null, layer) === null);
}

/* ── a feature service re-asks only when a cap cut its answer ──────────── */
{
  const { attachWfsRefine } = await import("./wfs-import.js");

  const makeLayer = (name, features) => ({
    name, features, collection: { type: "FeatureCollection", features },
  });
  const feature = (i) => ({ type: "Feature", properties: { i }, geometry: null });

  {
    const layer = makeLayer("complete", [feature(1), feature(2)]);
    attachWfsRefine(layer, "http://x", {}, {}, { truncated: false });
    const note = await layer.refineFor({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    ok("an untruncated layer says so rather than spending a request",
      /already in hand/.test(note));
    ok("and keeps the features it had", layer.features.length === 2);
  }
  {
    // The capped case: the import holds the first two of a longer answer.
    const layer = makeLayer("capped", [feature(1), feature(2)]);
    const fetched = [];
    const runOpts = {
      fetchImpl: async (url) => {
        fetched.push(url);
        return { ok: true, status: 200, json: async () => ({
          type: "FeatureCollection",
          features: [feature(10), feature(11), feature(12)],
        }) };
      },
    };
    attachWfsRefine(layer, "https://example.test/collections/x/items",
      { kind: "ogcapi", collection: "x" }, runOpts, { truncated: true });
    const note = await layer.refineFor({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    ok("a truncated layer re-asks the service", fetched.length >= 1);
    ok("with the study area as a bbox", /bbox=/.test(fetched[0]));
    ok("and holds the fuller answer for the run", layer.features.length === 3);
    ok("the note says what changed", /re-fetched for the study area/.test(note));
    layer.restoreLive();
    ok("restoreLive puts the layer back, so a clip does not shrink the map",
      layer.features.length === 2);
  }
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
