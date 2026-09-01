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

import { sphericalPolygonAreaKm2 } from "./geo-utils.js?v=20260901-6274bf4";

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
function groundKm2(feature) {
  const geometry = feature?.geometry;
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  let km2 = 0;
  for (const rings of polygons) {
    rings.forEach((ring, i) => {
      const area = sphericalPolygonAreaKm2(ring.map(([lon, lat]) => ({ lat, lon })));
      km2 += (i === 0 ? 1 : -1) * Math.abs(area);
    });
  }
  return km2;
}

export function categoriesFrom(features, labelKey, colourKey) {
  const seen = new Map();
  for (const feature of features || []) {
    const props = feature?.properties || {};
    const value = props[labelKey];
    const colour = props[colourKey];
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const key = String(value);
    const row = seen.get(key)
      || { value: key, colour: String(colour || "").trim(), count: 0, km2: 0 };
    row.count += 1;
    row.km2 += groundKm2(feature);
    seen.set(key, row);
  }
  /**
   * RANKED BY GROUND, so the key this file opens with is the key it left with.
   * The legend on screen ranks by area -- a unit broken into nine slivers
   * outranks one solid mass on a count, and the mass is what a reader is
   * looking at -- and a style ordered any other way makes a round trip come
   * back listing the same units in a different order.
   */
  return [...seen.values()]
    .filter((c) => /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c.colour))
    .sort((a, b) => (b.km2 - a.km2) || (b.count - a.count));
}

/**
 * THE CONTACT INK, computed the way the renderer computes it.
 *
 * `vector-render` multiplies a unit's own fill by `contacts.shade` to ink its
 * boundary, so a dark green edge belongs to the green unit and the sheet still
 * reads as its own legend. The multiply happens on a `THREE.Color`, whose
 * components are LINEAR — so doing it on the sRGB bytes gives a visibly
 * different colour, and the exported style would draw the same map in a
 * different set of edges.
 *
 * Written out here rather than imported because this module is loaded in Node
 * by the tests and must not drag three.js in with it. It is four lines and the
 * test pins it against the renderer's own arithmetic.
 */
function shadeHex(hex, factor) {
  const text = String(hex || "").trim().replace("#", "");
  const full = text.length === 3 ? text.split("").map((c) => c + c).join("")
    : text.padEnd(6, "0").slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return "#8a8a8a";
  const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * (v ** (1 / 2.4)) - 0.055);
  const channel = (byte) => {
    const lit = toLinear(byte / 255) * factor;
    const out = Math.round(Math.max(0, Math.min(1, toSrgb(lit))) * 255);
    return out.toString(16).padStart(2, "0");
  };
  return `#${channel((n >> 16) & 255)}${channel((n >> 8) & 255)}${channel(n & 255)}`;
}

/** The outline a category draws, given the layer's contact style. */
function outlineFor(colour, contacts) {
  const mode = contacts?.mode || null;
  if (mode === "ink") return rgba(contacts?.colour || "#1a1420", 255);
  if (mode === "shade") {
    const shade = Number.isFinite(contacts?.shade) ? contacts.shade : 0.45;
    return rgba(shadeHex(colour, shade), 255);
  }
  // "match" draws the boundary in the fill's own colour, which is the renderer
  // saying "no visible contact" -- and an outline equal to the fill is exactly
  // that in QGIS too.
  if (mode === "match") return rgba(colour, 255);
  return null;
}

/**
 * A QGIS style document for a categorised fill.
 *
 * `styleCategories="Symbology"` so loading it changes how the layer draws and
 * nothing else — not its name, not its scale limits, not its field aliases.
 */
export function buildQml(features, {
  field, valueKey = field, colourField, outline = "35,35,35,255", contacts = null,
} = {}) {
  // `field` is the DBF column the style matches on; `valueKey` is the property
  // the VALUES are read from. They differ by definition -- a column is
  // uppercased and cut to ten characters on its way into the table -- and
  // reading with the column name found nothing at all.
  const categories = categoriesFrom(features, valueKey, colourField);
  if (!categories.length) return null;
  /**
   * EVERY UNIT'S EDGE IS ITS OWN, not one flat grey for the sheet.
   *
   * This wrote `35,35,35,255` for every category, so an export opened in QGIS
   * as the right fills under near-black contacts -- a different map from the
   * one on screen, where each boundary is its unit's own colour darkened. The
   * layer's contact style decides it now, and falls back to the old flat grey
   * for a layer that declares none.
   */
  const symbol = (i, colour) => `
    <symbol type="fill" name="${i}" alpha="1" clip_to_extent="1" force_rhr="0">
      <layer class="SimpleFill" enabled="1" locked="0" pass="0">
        <Option type="Map">
          <Option name="color" type="QString" value="${rgba(colour)}"/>
          <Option name="outline_color" type="QString" value="${outlineFor(colour, contacts) || outline}"/>
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
${contacts ? `  <customproperties>
    <Option type="Map">
      <Option name="geoid/contacts" type="QString" value="${xml(JSON.stringify(contacts))}"/>
    </Option>
  </customproperties>
` : ""}</qgis>
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

/**
 * READ BACK WHAT WE WROTE.
 *
 * A shapefile carries no symbology, so the export ships a `.qml` beside it —
 * and the import ignored it, then tried to reconstruct the colouring from the
 * attribute table instead. That works when the colour column is complete and
 * falls off a cliff when it is not: a clip whose column was sparse came back
 * in this app's ramp with an "(other)" bucket, and the map the file described
 * was lost even though the file was carrying an exact description of it.
 *
 * So the style is read. It names the column, every category and every colour;
 * nothing has to be inferred, and a round trip through this app returns the
 * map it started as.
 *
 * `DOMParser` rather than a regular expression, because a unit name is user
 * data: "Sand & Gravel" is escaped in the file and has to come back unescaped,
 * and a name containing `value="` would end a naive match in the wrong place.
 */
/** The five entities `xml()` writes, turned back into the characters. */
function unxml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * The same read without a DOM, for Node -- the tests run there and a style
 * that cannot be tested is a style nobody can trust.
 *
 * Scanning attributes is safe HERE for the reason the writer escapes them: a
 * literal quote inside a value is written `&quot;`, so `value="([^"]*)"` can
 * never end early. That holds for anything this app wrote; a QML from
 * elsewhere is read by `DOMParser` in the browser, which is where those turn
 * up.
 */
/**
 * The contact style the writer recorded, if this QML is one of ours.
 *
 * A QGIS custom property is the right shelf for it: QGIS carries it through
 * untouched and ignores it, while a style written anywhere else simply has
 * none and the layer falls back to its own default. Read from the raw text so
 * the DOM and no-DOM paths cannot disagree about it.
 */
function contactsFrom(text) {
  const raw = (/<Option name="geoid\/contacts"[^>]*value="([^"]*)"/.exec(text) || [])[1];
  if (!raw) return null;
  try {
    const value = JSON.parse(unxml(raw));
    return value && typeof value === "object" && typeof value.mode === "string" ? value : null;
  } catch (error) { return null; }
}

function parseQmlWithoutDom(text) {
  const renderer = /<renderer-v2\b([^>]*)>/.exec(text);
  if (!renderer) return null;
  if (!/type="categorizedSymbol"/.test(renderer[1])) return null;
  const field = unxml((/attr="([^"]*)"/.exec(renderer[1]) || [])[1] || "");
  if (!field) return null;
  const colours = new Map();
  for (const block of text.split(/<symbol\b/).slice(1)) {
    const name = (/name="([^"]*)"/.exec(block) || [])[1];
    const colour = (/<Option name="color"[^>]*value="([^"]*)"/.exec(block) || [])[1];
    if (name && colour) colours.set(name, colour);
  }
  const categories = [];
  const pattern = /<category\b([^>]*)\/>/g;
  let match = pattern.exec(text);
  while (match) {
    const attrs = match[1];
    const value = (/value="([^"]*)"/.exec(attrs) || [])[1];
    const label = (/label="([^"]*)"/.exec(attrs) || [])[1];
    const rgba = colours.get((/symbol="([^"]*)"/.exec(attrs) || [])[1]);
    if (value !== undefined && rgba) {
      const [r, g, b] = String(rgba).split(",").map((n) => Number(n));
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        categories.push({ value: unxml(value), label: unxml(label ?? value),
          colour: `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n))
            .toString(16).padStart(2, "0")).join("")}` });
      }
    }
    match = pattern.exec(text);
  }
  return categories.length ? { field, categories, contacts: contactsFrom(text) } : null;
}

export function parseQml(text) {
  if (!text) return null;
  if (typeof DOMParser !== "function") return parseQmlWithoutDom(text);
  let doc;
  try { doc = new DOMParser().parseFromString(text, "application/xml"); }
  catch (error) { return null; }
  if (!doc || doc.querySelector("parsererror")) return null;
  const renderer = doc.querySelector("renderer-v2");
  if (!renderer || renderer.getAttribute("type") !== "categorizedSymbol") return null;
  const field = renderer.getAttribute("attr");
  if (!field) return null;
  // symbol name -> fill colour, from the Option map QGIS 3 writes.
  const colours = new Map();
  renderer.querySelectorAll("symbols > symbol").forEach((symbol) => {
    const name = symbol.getAttribute("name");
    let colour = null;
    symbol.querySelectorAll("Option").forEach((option) => {
      if (option.getAttribute("name") === "color") colour = option.getAttribute("value");
    });
    if (name && colour) colours.set(name, colour);
  });
  const categories = [];
  renderer.querySelectorAll("categories > category").forEach((category) => {
    const value = category.getAttribute("value");
    const rgba = colours.get(category.getAttribute("symbol"));
    if (value === null || !rgba) return;
    const [r, g, b] = String(rgba).split(",").map((n) => Number(n));
    if (![r, g, b].every((n) => Number.isFinite(n))) return;
    const hex = `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n))
      .toString(16).padStart(2, "0")).join("")}`;
    categories.push({ value, label: category.getAttribute("label") || value, colour: hex });
  });
  if (!categories.length) return null;
  return { field, categories, contacts: contactsFrom(text) };
}
