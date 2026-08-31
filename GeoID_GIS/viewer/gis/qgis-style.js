/**
 * A SHAPEFILE CARRIES NO SYMBOLOGY, so the export ships the style beside it.
 *
 * The geometry and the attributes were never the problem — measured on a 10 km
 * clip, 8 of 8 features carried a NAME and a COLOR, six distinct units and six
 * distinct colours. What a shapefile cannot carry is how to DRAW them, so QGIS
 * opens one in a single arbitrary fill with one legend entry reading the file
 * name. Reported, fairly, as "none of the actual rock types are named — imports
 * as one colour": everything the reader needs is in the file and nothing tells
 * the reader to use it.
 *
 * QGIS looks for `<basename>.qml` next to the layer and loads it without being
 * asked, which is the one hook that makes an export open correct rather than
 * open and need styling. The style is CATEGORIZED on the unit's own name, each
 * category taking the colour the survey published, so the legend reads as the
 * legend in this app does.
 *
 * `.sld` is written too — the OGC style format, which ArcGIS Pro and GeoServer
 * read where they will not read a QML. It cannot express everything a QML can;
 * for a categorised fill it is exact.
 */

/** `#RRGGBB` to the `R,G,B,A` triple-plus-alpha QGIS wants. */
function rgba(hex, alpha = 255) {
  const text = String(hex || "").trim().replace("#", "");
  const full = text.length === 3
    ? text.split("").map((c) => c + c).join("")
    : text.padEnd(6, "0").slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return `128,128,128,${alpha}`;
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha}`;
}

/** XML text, with the five characters that cannot appear raw. */
function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * The categories a style needs: one per distinct value of the label field,
 * each with the colour its features are painted in.
 *
 * Keyed on the VALUE, because that is what QGIS matches on. Where one unit
 * name somehow arrives in two colours the first is kept — a category can only
 * have one fill, and inventing a second category for a name that reads
 * identically in the legend would be worse than choosing.
 */
export function categoriesFrom(features, labelKey, colourKey) {
  const seen = new Map();
  for (const feature of features || []) {
    const props = feature?.properties || {};
    const value = props[labelKey];
    const colour = props[colourKey];
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const key = String(value);
    if (seen.has(key)) { seen.get(key).count += 1; continue; }
    seen.set(key, { value: key, colour: String(colour || "").trim(), count: 1 });
  }
  return [...seen.values()]
    .filter((c) => /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c.colour))
    .sort((a, b) => b.count - a.count);
}

/**
 * A QGIS style document for a categorised fill.
 *
 * `styleCategories="Symbology"` so loading it changes how the layer draws and
 * nothing else — not its name, not its scale limits, not its field aliases.
 */
export function buildQml(features, {
  field, valueKey = field, colourField, outline = "35,35,35,255",
} = {}) {
  // `field` is the DBF column the style matches on; `valueKey` is the property
  // the VALUES are read from. They differ by definition -- a column is
  // uppercased and cut to ten characters on its way into the table -- and
  // reading with the column name found nothing at all.
  const categories = categoriesFrom(features, valueKey, colourField);
  if (!categories.length) return null;
  const symbol = (i, colour) => `
    <symbol type="fill" name="${i}" alpha="1" clip_to_extent="1" force_rhr="0">
      <layer class="SimpleFill" enabled="1" locked="0" pass="0">
        <Option type="Map">
          <Option name="color" type="QString" value="${rgba(colour)}"/>
          <Option name="outline_color" type="QString" value="${outline}"/>
          <Option name="outline_style" type="QString" value="solid"/>
          <Option name="outline_width" type="QString" value="0.06"/>
          <Option name="outline_width_unit" type="QString" value="MM"/>
          <Option name="style" type="QString" value="solid"/>
        </Option>
      </layer>
    </symbol>`;
  return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.28.0" styleCategories="Symbology">
  <renderer-v2 type="categorizedSymbol" attr="${xml(field)}" forceraster="0" symbollevels="0" enableorderby="0">
    <categories>
${categories.map((c, i) => `      <category render="true" symbol="${i}" value="${xml(c.value)}" label="${xml(c.value)}"/>`).join("\n")}
    </categories>
    <symbols>${categories.map((c, i) => symbol(i, c.colour)).join("")}
    </symbols>
  </renderer-v2>
  <blendMode>0</blendMode>
  <featureBlendMode>0</featureBlendMode>
  <layerOpacity>1</layerOpacity>
</qgis>
`;
}

/** The same categories as OGC SLD, for readers that will not take a QML. */
export function buildSld(features, {
  field, valueKey = field, colourField, layerName = "layer",
} = {}) {
  const categories = categoriesFrom(features, valueKey, colourField);
  if (!categories.length) return null;
  const hex = (c) => `#${String(c).replace("#", "").toUpperCase()}`;
  const rule = (c) => `
      <se:Rule>
        <se:Name>${xml(c.value)}</se:Name>
        <se:Description><se:Title>${xml(c.value)}</se:Title></se:Description>
        <ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">
          <ogc:PropertyIsEqualTo>
            <ogc:PropertyName>${xml(field)}</ogc:PropertyName>
            <ogc:Literal>${xml(c.value)}</ogc:Literal>
          </ogc:PropertyIsEqualTo>
        </ogc:Filter>
        <se:PolygonSymbolizer>
          <se:Fill>
            <se:SvgParameter name="fill">${hex(c.colour)}</se:SvgParameter>
          </se:Fill>
          <se:Stroke>
            <se:SvgParameter name="stroke">#232323</se:SvgParameter>
            <se:SvgParameter name="stroke-width">0.2</se:SvgParameter>
          </se:Stroke>
        </se:PolygonSymbolizer>
      </se:Rule>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:se="http://www.opengis.net/se" version="1.1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xsi:schemaLocation="http://www.opengis.net/sld http://www.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <se:Name>${xml(layerName)}</se:Name>
    <UserStyle>
      <se:Name>${xml(layerName)}</se:Name>
      <se:FeatureTypeStyle>${categories.map(rule).join("")}
      </se:FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
`;
}
