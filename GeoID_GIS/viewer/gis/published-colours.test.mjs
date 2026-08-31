/**
 * A MAP IS DRAWN IN THE COLOURS ITS SOURCE PUBLISHED.
 *
 * A 47 km Macrostrat clip exported to GeoJSON and to shapefile and re-imported
 * came back with all 97 features and every `COLOR` value intact — and painted
 * in twelve colours from this app's qualitative ramp instead: measured
 * #E05859, #4F78A6, #F28D2F where the survey had said #FF9BCD, #EBEBEB,
 * #7FC64E. The legend listed the ramp, so the categories a reader was given
 * matched nothing on the globe, and the polygons the ramp painted pale read as
 * missing ground. Both faults were the same missing question: does this file
 * already say what colour it is?
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

const { publishedColourField } = await import("./vector-render.js");

const fc = (features) => ({ type: "FeatureCollection", features });
const feat = (properties) => ({
  type: "Feature", properties,
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

/* ── finding the column ────────────────────────────────────────────────── */
{
  ok("GeoJSON's lower-case `color` is found",
    publishedColourField(fc([feat({ color: "#FF9BCD" }), feat({ color: "#7FC64E" })])) === "color");

  ok("a shapefile's upper-case COLOR is found",
    publishedColourField(fc([feat({ COLOR: "#FF9BCD" }), feat({ COLOR: "#EBEBEB" })])) === "COLOR");

  ok("British spelling counts",
    publishedColourField(fc([feat({ colour: "#123456" })])) === "colour");

  ok("`fill` counts", publishedColourField(fc([feat({ fill: "#123456" })])) === "fill");

  ok("a bare hex with no hash counts",
    publishedColourField(fc([feat({ color: "FF9BCD" }), feat({ color: "7FC64E" })])) === "color");

  ok("three-digit hex counts",
    publishedColourField(fc([feat({ color: "#f0a" })])) === "color");

  ok("surrounding whitespace does not disqualify a column",
    publishedColourField(fc([feat({ color: " #FF9BCD " })])) === "color");

  ok("one feature is enough to have a published colour",
    publishedColourField(fc([feat({ color: "#FF9BCD" })])) === "color");
}

/* ── refusing to find one ──────────────────────────────────────────────── */
{
  ok("no colour column at all is null",
    publishedColourField(fc([feat({ name: "Argyll Group" })])) === null);

  ok("an empty collection is null", publishedColourField(fc([])) === null);
  ok("a missing collection is null", publishedColourField(null) === null);

  // The rule `inheritedColouring` already uses: a column that covers only part
  // of the map would paint some features from the file and the rest from a
  // ramp, which is a worse map than either answer on its own.
  ok("a column missing on one feature is refused", publishedColourField(fc([
    feat({ color: "#FF9BCD" }), feat({ color: "#7FC64E" }), feat({ name: "no colour" }),
  ])) === null);

  ok("an empty string is not a colour",
    publishedColourField(fc([feat({ color: "#FF9BCD" }), feat({ color: "" })])) === null);

  ok("a null value is not a colour",
    publishedColourField(fc([feat({ color: "#FF9BCD" }), feat({ color: null })])) === null);

  // A rock description column called "colour" is prose, not symbology.
  ok("a described colour is not a hex and is refused",
    publishedColourField(fc([feat({ colour: "pale greenish grey" })])) === null);

  ok("a named CSS colour is refused",
    publishedColourField(fc([feat({ color: "red" })])) === null);

  ok("a five-digit hex is refused",
    publishedColourField(fc([feat({ color: "#12345" })])) === null);

  ok("rgb() notation is refused",
    publishedColourField(fc([feat({ color: "rgb(255,0,0)" })])) === null);
}

/* ── which column wins when a file carries two ─────────────────────────── */
{
  // `color` is listed before `fill`: a fill is a drawing hint, a colour column
  // is what the survey published.
  ok("`color` outranks `fill`",
    publishedColourField(fc([feat({ color: "#FF9BCD", fill: "#000000" })])) === "color");
}

/* ── the built layer paints and legends from it ────────────────────────── */
{
  // The renderer drapes onto whatever globe is loaded and asks `window` for
  // it; with no viewer it falls back to the sphere, which is all this needs.
  globalThis.window = globalThis.window || {};
  const { buildVectorLayerResult } = await import("./vector-render.js");
  const macrostrat = fc([
    feat({ name: "Argyll Group", color: "#FF9BCD" }),
    feat({ name: "Argyll Group", color: "#FF9BCD" }),
    feat({ name: "Southern Highland Group", color: "#7FC64E" }),
    feat({ name: "Unnamed Igneous Intrusion", color: "#EBEBEB" }),
  ]);
  const built = buildVectorLayerResult(macrostrat, { name: "rt.geojson" });

  ok("the built layer names the column it was painted from",
    built.publishedColourField === "color");

  const palette = built.legendInfo?.palette || [];
  ok("the legend is in the file's colours, not a ramp",
    palette.includes("FF9BCD") && palette.includes("7FC64E") && palette.includes("EBEBEB"),
    `got ${JSON.stringify(palette)}`);
  ok("no ramp colour is anywhere in the legend",
    !palette.some((c) => ["4e79a7", "f28e2b", "59a14f", "e15759"].includes(c)),
    `got ${JSON.stringify(palette)}`);

  const labels = built.legendInfo?.labels || [];
  ok("the legend is labelled by unit, not by hex",
    labels.includes("Argyll Group") && labels.includes("Southern Highland Group"),
    `got ${JSON.stringify(labels)}`);
  ok("a unit arriving in two pieces is ONE legend row",
    labels.filter((l) => l === "Argyll Group").length === 1);
  ok("the legend says which column it classified by", built.legendInfo?.field === "name");
  ok("the legend is categorical", built.legendInfo?.categorical === true);

  // Two units sharing a colour are two rows: Macrostrat gives every
  // Proterozoic quartzite the same pink, and collapsing on colour would lose
  // one of them from the key.
  const shared = buildVectorLayerResult(fc([
    feat({ name: "quartzite A", color: "#FF9BCD" }),
    feat({ name: "quartzite B", color: "#FF9BCD" }),
  ]), { name: "shared" });
  ok("two units in one colour keep two rows",
    (shared.legendInfo?.labels || []).length === 2,
    `got ${JSON.stringify(shared.legendInfo?.labels)}`);

  // And the ordinary path is untouched: no published column, ramp as before.
  const plain = buildVectorLayerResult(fc([
    feat({ name: "a" }), feat({ name: "b" }), feat({ name: "c" }),
  ]), { name: "plain" });
  ok("a file with no colour column still gets the default classification",
    plain.publishedColourField === null && (plain.legendInfo?.palette || []).length > 0);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
