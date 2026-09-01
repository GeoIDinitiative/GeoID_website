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

/**
 * THE CONTACTS TRAVEL WITH THE STYLE.
 *
 * A geological map is its fills AND its unit boundaries, and the style shipped
 * only the first: every category was written with a flat `35,35,35` outline,
 * so an export opened in QGIS as the right fills under near-black edges, and
 * re-imported here with no contact style at all. Measured on a 52 km clip, the
 * source drew 32 distinct colours -- 16 fills and 16 contacts, each its unit's
 * own colour darkened -- and the re-import drew 16. Every colour it drew was
 * one of the source's, so nothing looked wrong until you looked for the edges.
 */
{
  const features = [
    { properties: { NAME: "Argyll Group", COLOR: "#7bc771" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
    { properties: { NAME: "Gala Group", COLOR: "#d81e5b" },
      geometry: { type: "Polygon", coordinates: [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]] } },
  ];
  const { parseQml } = await import("./qgis-style.js");
  const opts = { field: "NAME", valueKey: "NAME", colourField: "COLOR" };

  const plain = buildQml(features, opts);
  ok("with no contact style the flat default still stands",
    (plain.match(/outline_color" type="QString" value="35,35,35,255"/g) || []).length === 2);
  ok("and a plain style records no contact property", !/geoid\/contacts/.test(plain));

  const shaded = buildQml(features, { ...opts, contacts: { mode: "shade", shade: 0.62, opacity: 0.55 } });
  const outlines = [...shaded.matchAll(/outline_color" type="QString" value="([^"]*)"/g)].map((m) => m[1]);
  ok("every category gets its OWN edge, not one grey for the sheet",
    outlines.length === 2 && outlines[0] !== outlines[1], outlines.join(" | "));
  ok("no edge is the flat default any more",
    outlines.every((o) => o !== "35,35,35,255"), outlines.join(" | "));
  /**
   * The renderer multiplies a THREE.Color, whose components are LINEAR. Doing
   * it on the sRGB bytes gives a visibly different colour, so the check is
   * against the linear answer and would fail on the naive one: #7bc771 shaded
   * by 0.62 is 0x62-ish per channel in linear and 0x4c-ish in sRGB.
   */
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * (v ** (1 / 2.4)) - 0.055);
  const expect = [0x7b, 0xc7, 0x71]
    .map((b) => Math.round(Math.max(0, Math.min(1, toSrgb(toLinear(b / 255) * 0.62))) * 255));
  ok("the shade is computed in LINEAR space, as the renderer computes it",
    outlines[0] === `${expect[0]},${expect[1]},${expect[2]},255`,
    `${outlines[0]} want ${expect.join(",")},255`);
  const naive = [0x7b, 0xc7, 0x71].map((b) => Math.round(b * 0.62));
  ok("and is NOT the sRGB-space multiply that looks the same in source",
    outlines[0] !== `${naive[0]},${naive[1]},${naive[2]},255`);

  ok("the mode is recorded where QGIS will carry it untouched",
    /Option name="geoid\/contacts"/.test(shaded));
  const back = parseQml(shaded);
  ok("and reads back as the style the layer was wearing",
    back?.contacts?.mode === "shade" && back.contacts.shade === 0.62
    && back.contacts.opacity === 0.55, JSON.stringify(back?.contacts));
  ok("the categories still survive alongside it", back?.categories?.length === 2);
  ok("a style from anywhere else simply has none", parseQml(plain)?.contacts === null);

  const inked = buildQml(features, { ...opts, contacts: { mode: "ink", colour: "#1a1420" } });
  const inkOutlines = [...inked.matchAll(/outline_color" type="QString" value="([^"]*)"/g)].map((m) => m[1]);
  ok("one flat ink means one edge colour for every unit",
    inkOutlines.length === 2 && inkOutlines[0] === inkOutlines[1] && inkOutlines[0] === "26,20,32,255",
    inkOutlines.join(" | "));

  const matched = buildQml(features, { ...opts, contacts: { mode: "match" } });
  const matchOutlines = [...matched.matchAll(/outline_color" type="QString" value="([^"]*)"/g)].map((m) => m[1]);
  ok("\"match\" means no visible contact, which is an edge equal to the fill",
    matchOutlines[0] === "123,199,113,255", matchOutlines[0]);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
