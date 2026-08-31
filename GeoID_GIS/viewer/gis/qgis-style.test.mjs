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

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
