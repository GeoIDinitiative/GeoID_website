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

globalThis.window = globalThis.window || {};
const { publishedColourField, buildVectorLayerResult }
  = await import("./vector-render.js");

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

  /**
   * A column covering only a fraction of the map is not the map's colouring:
   * a stray `fill` on a tenth of the rows would grey out the other nine
   * tenths. Two of three is below the threshold and refused.
   */
  {
    // One row in ten is vestigial, not a colouring.
    const vestigial = fc([feat({ name: "coloured", color: "#FF9BCD" }),
      ...Array.from({ length: 9 }, (_, i) => feat({ name: `plain ${i}` }))]);
    ok("a named column on one row in ten is vestigial and refused",
      publishedColourField(vestigial) === null);

    // A GUESSED column has to prove itself even at four rows in five.
    const guessed = fc([...Array.from({ length: 3 }, (_, i) =>
      feat({ name: `u${i}`, fill: "#FF9BCD" })), feat({ name: "u3" }), feat({ name: "u4" })]);
    ok("a `fill` column below the strict bar is refused",
      publishedColourField(guessed) === null);
    const solid = fc(Array.from({ length: 5 }, (_, i) => feat({ name: `u${i}`, fill: "#FF9BCD" })));
    ok("and taken when it covers everything", publishedColourField(solid) === "fill");
  }

  /**
   * THE ODD UNCOLOURED UNIT DOES NOT COST THE OTHERS THEIR COLOURS.
   *
   * Requiring EVERY feature to carry a hex was the first rule here and it was
   * wrong: measured on a re-imported clip, blanking one colour of 96 sent the
   * whole layer back to this app's twelve-class ramp with an "(other)" bucket
   * — a different map from the one the file describes. Reported as the import
   * failing to assign polygons.
   */
  {
    const nine = Array.from({ length: 9 }, (_, i) =>
      feat({ name: `unit ${i}`, color: "#FF9BCD" }));
    const withHole = fc([...nine, feat({ name: "uncoloured unit" })]);
    ok("nine of ten coloured is still the file's own colouring",
      publishedColourField(withHole) === "color");

    globalThis.window = globalThis.window || {};
    const built = buildVectorLayerResult(withHole, { name: "holed" });
    ok("and the layer is painted from it", built.publishedColourField === "color");
    const palette = built.legendInfo?.palette || [];
    const labels = built.legendInfo?.labels || [];
    ok("the published colour is in the key", palette.includes("FF9BCD"));
    ok("no ramp colour is", !palette.some((c) =>
      ["4e79a7", "f28e2b", "59a14f", "e15759"].includes(c)), JSON.stringify(palette));
    ok("and there is no invented (other) bucket",
      !labels.some((l) => /other/i.test(String(l))), JSON.stringify(labels));
    ok("the uncoloured feature gets a row of its own",
      labels.includes("No colour published"), JSON.stringify(labels));
    ok("in a neutral grey, listed last",
      palette[palette.length - 1] === "8a8a8a", JSON.stringify(palette));
  }
  {
    // And that row appears ONLY when something wears it.
    const allColoured = fc([feat({ name: "a", color: "#FF9BCD" }),
      feat({ name: "b", color: "#7FC64E" })]);
    const labels = buildVectorLayerResult(allColoured, { name: "whole" }).legendInfo?.labels || [];
    ok("a fully coloured layer gets no grey row",
      !labels.includes("No colour published"), JSON.stringify(labels));
  }

  /**
   * A blank is not a colour — but it is one feature's blank, not the column's
   * disqualification. The value is refused; the column stands.
   */
  {
    const withBlanks = fc([feat({ name: "a", color: "#FF9BCD" }), feat({ name: "b", color: "" }),
      feat({ name: "c", color: null }), feat({ name: "d", color: "#7FC64E" })]);
    ok("a blank does not disqualify the column",
      publishedColourField(withBlanks) === "color");
    const labels = buildVectorLayerResult(withBlanks, { name: "blanks" }).legendInfo?.labels || [];
    ok("and the blank features are drawn in the neutral, and said so",
      labels.includes("No colour published"), JSON.stringify(labels));
    ok("while the coloured ones keep their own",
      (buildVectorLayerResult(withBlanks, { name: "blanks2" }).legendInfo?.palette || [])
        .includes("FF9BCD"));
  }

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
  /**
   * The dock draws a legend as a gradient unless it is told the rows are
   * classes, so a key of named units without this is a rainbow bar naming
   * none of them — which is how 22 geological units, correctly coloured,
   * still read as "no differentiation".
   */
  ok("the legend declares itself a class list, not a ramp",
    built.legendInfo?.classed === true);

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
  ok("that default classification is a class list too", plain.legendInfo?.classed === true);

  // One flat wash is still a row with a name, not a one-colour gradient.
  const wash = buildVectorLayerResult(fc([feat({ id: 1 }), feat({ id: 2 })]), { name: "wash" });
  ok("an unclassifiable layer's single row is classed as well",
    wash.legendInfo === null || wash.legendInfo.classed === true);
}

/**
 * A KEY THAT LISTS TWELVE OF EIGHTEEN SAYS SO.
 *
 * Measured on a re-imported 47 km clip: 18 distinct units, 12 legend rows, and
 * six units — Mercia Mudstone Group, Lias Group, Middle Triassic claystone —
 * simply absent with nothing to say they had been cut. The clip's own key has
 * carried "12 of 22 units" since it was written; its exported copy carried
 * nothing, so a named polygon looked like it had no legend entry at all.
 *
 * And the twelve are the twelve largest by GROUND, not the twelve that arrived
 * in the most pieces — the rule `legendFrom` already follows, where ranking by
 * count sent 572 km² into the remainder.
 */
{
  globalThis.window = globalThis.window || {};
  const { buildVectorLayerResult: build } = await import("./vector-render.js");
  const box = (lon, lat, w, h) => [[
    [lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]]];
  const unit = (name, colour, lon, lat, w, h) => ({ type: "Feature",
    properties: { name, color: colour },
    geometry: { type: "Polygon", coordinates: box(lon, lat, w, h) } });

  // Fourteen units so the twelve-row cap bites.
  const many = { type: "FeatureCollection", features: [] };
  for (let i = 0; i < 14; i += 1) {
    many.features.push(unit(`unit ${i}`, `#${(i * 17 + 16).toString(16).padStart(2, "0")}9BCD`,
      i * 2, 0, 1, 1));
  }
  const built = build(many, { name: "capped" });
  ok("the key is capped at twelve rows",
    (built.legendInfo?.labels || []).length === 12);
  ok("and says how many units there are",
    built.legendSummary === "12 of 14 units", `got ${built.legendSummary}`);

  const small = { type: "FeatureCollection", features: [
    unit("a", "#FF9BCD", 0, 0, 1, 1), unit("b", "#7FC64E", 2, 0, 1, 1)] };
  ok("a key that lists everything says nothing",
    build(small, { name: "whole" }).legendSummary === null);
}
{
  // Ground, not pieces: one big unit against a unit shattered into many.
  globalThis.window = globalThis.window || {};
  const { buildVectorLayerResult: build } = await import("./vector-render.js");
  const ring = (lon, lat, w, h) => [[
    [lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]]];
  const features = [{ type: "Feature", properties: { name: "one solid mass", color: "#FF9BCD" },
    geometry: { type: "Polygon", coordinates: ring(0, 0, 4, 4) } }];
  for (let i = 0; i < 9; i += 1) {
    features.push({ type: "Feature", properties: { name: "nine slivers", color: "#7FC64E" },
      geometry: { type: "Polygon", coordinates: ring(10 + i * 0.1, 0, 0.02, 0.02) } });
  }
  const labels = build({ type: "FeatureCollection", features }, { name: "ranked" })
    .legendInfo?.labels || [];
  ok("the solid mass outranks the nine slivers", labels[0] === "one solid mass",
    JSON.stringify(labels));
}

/**
 * A DECLARED STYLE MUST NOT SILENCE THE COLUMN.
 *
 * `publishedColourField` is not only how a layer gets painted -- it is how the
 * layer SAYS what it is coloured by, and two things downstream ask. The build
 * short-circuited it to null whenever a `.qml` did the painting, so a
 * re-imported clip reported `sourceColourField: null`: the symbology dialog
 * could not see the layer's own colouring and opened on a PROPOSAL instead
 * (measured: "By attribute / LITH — 20 values", twelve classes and an
 * `(other)` bucket of ten, over a map with nothing grey on it), and
 * `inheritedColouring` in the tool runner lost the colours on the next clip --
 * the round trip closed at one end and open at the other.
 */
{
  const styled = fc([
    feat({ NAME: "Argyll Group", COLOR: "#7bc771" }),
    feat({ NAME: "Gala Group", COLOR: "#d81e5b" }),
  ]);
  const style = {
    field: "NAME",
    categories: [
      { value: "Argyll Group", label: "Argyll Group", colour: "#7bc771" },
      { value: "Gala Group", label: "Gala Group", colour: "#d81e5b" },
    ],
  };
  const built = buildVectorLayerResult(styled, { name: "styled.shp", style });
  ok("the style still paints, keyed on its own field",
    built.legendInfo?.field === "NAME", String(built.legendInfo?.field));
  ok("and the colour COLUMN is reported all the same",
    built.publishedColourField === "COLOR", String(built.publishedColourField));
  ok("so the way back to the source colours is offered",
    Boolean(built.sourceSymbology?.apply));
  ok("and it knows it was declared rather than inferred",
    built.sourceSymbology?.declared === true);
  ok("its rows are the ones the map is wearing",
    (built.sourceSymbology?.rows || []).map((r) => r.value).join("|")
      === (built.legendInfo?.labels || []).join("|"));

  // The inferred half keeps saying so too, and says it is NOT declared.
  const inferred = buildVectorLayerResult(fc([
    feat({ name: "Argyll Group", color: "#7bc771" }),
    feat({ name: "Gala Group", color: "#d81e5b" }),
  ]), { name: "inferred.geojson" });
  ok("a file with no style file still reports its column",
    inferred.publishedColourField === "color");
  ok("and offers the same way home, undeclared",
    Boolean(inferred.sourceSymbology?.apply) && inferred.sourceSymbology.declared === false);

  // A layer with nothing published has no way home to offer, and must not
  // pretend to: the dialog reads exactly this to decide whether to show it.
  const plain = buildVectorLayerResult(fc([feat({ id: 1 }), feat({ id: 2 })]),
    { name: "plain.geojson" });
  ok("a layer that publishes no colours offers no source mode",
    plain.sourceSymbology === null);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
