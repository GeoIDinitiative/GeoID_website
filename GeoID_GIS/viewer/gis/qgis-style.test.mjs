/**
 * A SHAPEFILE CARRIES NO SYMBOLOGY, so the export ships the style beside it.
 *
 * The geometry and the attributes were never the problem: measured on a 10 km
 * clip, 8 of 8 features carried a NAME and a COLOR, six units and six colours.
 * What a shapefile cannot carry is how to DRAW them, so QGIS opened one in a
 * single arbitrary fill with the file name for a legend — reported as "none of
 * the actual rock types are named, imports as one colour".
 */
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};

const { buildQml, buildSld, categoriesFrom } = await import("./qgis-style.js");

const f = (name, colour) => ({ type: "Feature", properties: { name, color: colour },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });

const units = [
  f("Argyll Group", "#FF9BCD"),
  f("Argyll Group", "#FF9BCD"),
  f("Roe Valley Group", "#8CB06C"),
  f("Sherwood Sandstone Group", "#9AD9DD"),
];

/* ── the categories ────────────────────────────────────────────────────── */
{
  const cats = categoriesFrom(units, "name", "color");
  ok("one category per distinct unit, not per feature", cats.length === 3,
    `got ${cats.length}`);
  ok("the commonest unit is listed first", cats[0].value === "Argyll Group");
  ok("each keeps its published colour",
    cats.find((c) => c.value === "Roe Valley Group").colour === "#8CB06C");

  ok("a feature with no name is not a category",
    categoriesFrom([...units, f("", "#123456"), f(null, "#123456")], "name", "color").length === 3);
  ok("a unit whose colour is not a colour is left out rather than invented",
    categoriesFrom([...units, f("Prose Group", "pale greenish grey")], "name", "color").length === 3);
  ok("three-digit hex counts",
    categoriesFrom([f("Short", "#f0a")], "name", "color").length === 1);
}

/* ── the QML QGIS loads without being asked ────────────────────────────── */
{
  const qml = buildQml(units, { field: "NAME", valueKey: "name", colourField: "color" });
  ok("a style is produced", Boolean(qml));
  ok("it is categorised, not a single symbol", qml.includes('type="categorizedSymbol"'));
  ok("it matches on the DBF COLUMN name, which is uppercased and cut to ten",
    qml.includes('attr="NAME"'));
  ok("every unit is named in the legend",
    qml.includes('label="Argyll Group"') && qml.includes('label="Roe Valley Group"')
      && qml.includes('label="Sherwood Sandstone Group"'));
  ok("colours are converted to the R,G,B,A QGIS wants",
    qml.includes('value="255,155,205,255"'), "#FF9BCD");
  ok("and it only changes symbology, not the layer's name or scale rules",
    qml.includes('styleCategories="Symbology"'));

  // The values are read from the PROPERTY, never from the column name: reading
  // with the column found nothing at all and shipped no style.
  const wrong = buildQml(units, { field: "NAME", colourField: "color" });
  ok("reading values by the column name alone finds nothing", wrong === null);
}

/* ── refusing to invent ────────────────────────────────────────────────── */
{
  const noColour = [f("Argyll Group", null), f("Roe Valley Group", undefined)];
  ok("a layer that cannot say what colour it is gets no style file",
    buildQml(noColour, { field: "NAME", valueKey: "name", colourField: "color" }) === null);
  ok("and no SLD either",
    buildSld(noColour, { field: "NAME", valueKey: "name", colourField: "color" }) === null);
}

/* ── XML is XML ────────────────────────────────────────────────────────── */
{
  const awkward = [f('Sand & "Gravel" <drift>', "#FF9BCD")];
  const qml = buildQml(awkward, { field: "NAME", valueKey: "name", colourField: "color" });
  ok("a unit name with markup characters is escaped",
    qml.includes("Sand &amp; &quot;Gravel&quot; &lt;drift&gt;")
      && !qml.includes('"Gravel"'), "an unescaped quote ends the attribute early");

  const sld = buildSld(awkward, { field: "NAME", valueKey: "name", colourField: "color" });
  ok("and in the SLD too", sld.includes("Sand &amp; &quot;Gravel&quot; &lt;drift&gt;"));
}

/* ── the portable form ─────────────────────────────────────────────────── */
{
  const sld = buildSld(units, { field: "NAME", valueKey: "name", colourField: "color",
    layerName: "clip" });
  ok("the SLD carries one rule per unit",
    (sld.match(/<se:Rule>/g) || []).length === 3);
  ok("each rule filters on the column and fills with the unit's colour",
    sld.includes("<ogc:PropertyName>NAME</ogc:PropertyName>")
      && sld.includes(">#FF9BCD<"));
}

/**
 * READ BACK WHAT WE WROTE.
 *
 * The export ships a `.qml`; the import ignored it and reconstructed the
 * colouring from the attribute table instead. That works while the colour
 * column is complete and collapses when it is not — a clip whose column was
 * sparse came back in this app's ramp with an "(other)" bucket, losing a map
 * the file was carrying an exact description of.
 */
{
  const { parseQml } = await import("./qgis-style.js");
  const qml = buildQml(units, { field: "NAME", valueKey: "name", colourField: "color" });
  const read = parseQml(qml);
  ok("a style we wrote reads back", Boolean(read));
  ok("with the column it matches on", read.field === "NAME");
  ok("and every category", read.categories.length === 3);
  ok("with the colours converted back to hex",
    read.categories.find((c) => c.value === "Argyll Group").colour === "#ff9bcd",
    JSON.stringify(read.categories[0]));

  // A unit name is user data and the file escapes it; it has to come back
  // unescaped, or the category matches nothing.
  const awkward = [f('Sand & "Gravel" <drift>', "#FF9BCD")];
  const back = parseQml(buildQml(awkward,
    { field: "NAME", valueKey: "name", colourField: "color" }));
  ok("an escaped name comes back as it went in",
    back.categories[0].value === 'Sand & "Gravel" <drift>', JSON.stringify(back.categories[0]));

  ok("rubbish is refused rather than half-read", parseQml("<not-a-style/>") === null);
  ok("and so is an empty string", parseQml("") === null);
}

/* ── the style decides the layer, ahead of any inference ───────────────── */
{
  globalThis.window = globalThis.window || {};
  const { buildVectorLayerResult } = await import("./vector-render.js");
  const poly = (name, extra) => ({ type: "Feature",
    properties: { NAME: name, ...extra },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  // The case that broke: NO usable colour column at all.
  const fc = { type: "FeatureCollection", features: [
    poly("Argyll Group"), poly("Argyll Group"), poly("Roe Valley Group")] };
  const style = { field: "NAME", categories: [
    { value: "Argyll Group", label: "Argyll Group", colour: "#ff9bcd" },
    { value: "Roe Valley Group", label: "Roe Valley Group", colour: "#8cb06c" }] };

  const withStyle = buildVectorLayerResult(fc, { name: "styled", style });
  const labels = withStyle.legendInfo?.labels || [];
  const palette = withStyle.legendInfo?.palette || [];
  ok("the legend is the style's, named by unit",
    labels.includes("Argyll Group") && labels.includes("Roe Valley Group"),
    JSON.stringify(labels));
  ok("in the style's colours",
    palette.includes("ff9bcd") && palette.includes("8cb06c"), JSON.stringify(palette));
  ok("with no invented (other) bucket",
    !labels.some((l) => /^\(other\)$/i.test(String(l))), JSON.stringify(labels));

  // Without the style, the same features have nothing to go on and fall back.
  const without = buildVectorLayerResult(fc, { name: "bare" });
  ok("and without it the same features fall back to a ramp",
    (without.legendInfo?.palette || []).some((c) =>
      ["4e79a7", "f28e2b", "59a14f", "e15759"].includes(c)),
    JSON.stringify(without.legendInfo?.palette));

  // A value the style does not name keeps the neutral rather than an invented
  // class.
  const extra = { type: "FeatureCollection",
    features: [...fc.features, poly("Unlisted Group")] };
  const mixed = buildVectorLayerResult(extra, { name: "mixed", style });
  ok("a unit the style does not name is drawn neutral and listed as such",
    (mixed.legendInfo?.labels || []).includes("No colour published"),
    JSON.stringify(mixed.legendInfo?.labels));
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
