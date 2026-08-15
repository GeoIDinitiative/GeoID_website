/**
 * What CRS is this shapefile in? — sniffing a .prj sidecar.
 *
 * A shapefile carries its coordinate system in a sibling `.prj` file holding
 * one line of WKT, and nothing else in the format says where the numbers are.
 * Import that file without reading it and eastings get treated as longitudes:
 * a British National Grid layer lands somewhere off the coast of Somalia at
 * 0°N 0°E, which is the single most common "my data is in the wrong place"
 * report in any GIS.
 *
 * Two things make this readable rather than a guess:
 *
 * 1. **An EPSG AUTHORITY code is the answer whenever it is present.** WKT nests
 *    authorities — a projected CRS contains its base geographic CRS, which
 *    contains a datum, a spheroid, a prime meridian and a unit, each with its
 *    own code — so a regex for the first (or the last) EPSG number in the file
 *    returns the spheroid's 7001 or the unit's 9001 about as often as the code
 *    that matters. The text is therefore walked as a bracket tree and only an
 *    authority whose PARENT is the outermost CRS node is taken. That is what
 *    stops WKT2's `BASEGEOGCRS[… ID["EPSG",4258]]` from shadowing the
 *    `ID["EPSG",3035]` that describes the file.
 *
 * 2. **Names are recognised only as a fallback, and order matters inside them.**
 *    ESRI writes .prj files with no authority at all, so the name is all there
 *    is — and `WGS_1984_Web_Mercator_Auxiliary_Sphere` contains "WGS 1984"
 *    while being 3857, `TM75 / Irish Grid` contains "Irish Grid" while being
 *    29903 rather than 29902. The specific pattern is always tested before the
 *    general one.
 *
 * A name we do not recognise returns `epsg: null` with the name it read, which
 * is the honest answer: the caller can then ask, rather than being handed a
 * confident wrong number.
 *
 * detectCrs(wkt) -> { epsg, name, isGeographic, unit, source }
 */

/** The codes this module can name without a lookup service. */
export const KNOWN_CRS = {
  4326: { name: "WGS 84", geographic: true, unit: "degree" },
  4258: { name: "ETRS89", geographic: true, unit: "degree" },
  4277: { name: "OSGB36", geographic: true, unit: "degree" },
  3857: { name: "WGS 84 / Pseudo-Mercator", geographic: false, unit: "metre" },
  27700: { name: "OSGB36 / British National Grid", geographic: false, unit: "metre" },
  29902: { name: "TM65 / Irish Grid", geographic: false, unit: "metre" },
  29903: { name: "TM75 / Irish Grid", geographic: false, unit: "metre" },
  2157: { name: "IRENET95 / Irish Transverse Mercator", geographic: false, unit: "metre" },
  3035: { name: "ETRS89-extended / LAEA Europe", geographic: false, unit: "metre" },
};

/** A readable label for a code, including the UTM zones, which are formulaic. */
export function crsLabel(epsg) {
  const code = Number(epsg);
  // Number(null) is 0, which is finite and is not a CRS.
  if (epsg === null || epsg === undefined || epsg === "" || !Number.isFinite(code) || code <= 0) return "";
  if (KNOWN_CRS[code]) return KNOWN_CRS[code].name;
  if (code > 32600 && code < 32661) return `WGS 84 / UTM zone ${code - 32600}N`;
  if (code > 32700 && code < 32761) return `WGS 84 / UTM zone ${code - 32700}S`;
  return `EPSG:${code}`;
}

/* ── the bracket walk ─────────────────────────────────────────────────────── */

// Nodes that are a coordinate reference system in their own right. An
// authority hanging directly off one of these describes the CRS; an authority
// under DATUM, SPHEROID, PRIMEM, UNIT, AXIS or a WKT2 BASE* node does not.
const CRS_KEYWORDS = new Set([
  "PROJCS", "GEOGCS", "GEOCCS", "VERT_CS", "COMPD_CS", "LOCAL_CS",
  "PROJCRS", "GEOGCRS", "GEODCRS", "GEODETICCRS", "PROJECTEDCRS",
  "VERTCRS", "VERTICALCRS", "COMPOUNDCRS", "ENGCRS", "ENGINEERINGCRS",
]);

const GEOGRAPHIC_KEYWORDS = new Set([
  "GEOGCS", "GEOGCRS", "GEODCRS", "GEODETICCRS",
]);

const UNIT_KEYWORDS = new Set(["UNIT", "LENGTHUNIT", "ANGLEUNIT"]);

/**
 * Every `KEYWORD[…]` node in the text, with its depth and its parent.
 *
 * Quoted strings are consumed whole, so brackets and commas inside a CRS name
 * — `AXIS["geodetic latitude (Lat)", north]` — cannot unbalance the walk.
 */
function parseNodes(text) {
  const nodes = [];
  const stack = [];
  const length = text.length;
  let i = 0;
  while (i < length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      let value = "";
      while (j < length && text[j] !== '"') {
        value += text[j];
        j += 1;
      }
      if (stack.length) stack[stack.length - 1].strings.push(value);
      i = j + 1;
      continue;
    }
    if (ch === "[" || ch === "(") {
      let j = i - 1;
      while (j >= 0 && /\s/.test(text[j])) j -= 1;
      const end = j + 1;
      while (j >= 0 && /[A-Za-z0-9_]/.test(text[j])) j -= 1;
      const node = {
        keyword: text.slice(j + 1, end).toUpperCase(),
        depth: stack.length,
        parent: stack.length ? stack[stack.length - 1].keyword : null,
        strings: [],
        numbers: [],
      };
      nodes.push(node);
      stack.push(node);
      i += 1;
      continue;
    }
    if (ch === "]" || ch === ")") {
      stack.pop();
      i += 1;
      continue;
    }
    if (ch === "-" || ch === "+" || ch === "." || (ch >= "0" && ch <= "9")) {
      const match = /^[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(text.slice(i));
      if (match) {
        if (stack.length) stack[stack.length - 1].numbers.push(Number(match[0]));
        i += match[0].length;
        continue;
      }
    }
    i += 1;
  }
  return nodes;
}

/** The EPSG code of the outermost CRS node, or null. */
function authorityCode(nodes) {
  let best = null;
  for (const node of nodes) {
    if (node.keyword !== "AUTHORITY" && node.keyword !== "ID") continue;
    if (String(node.strings[0] || "").toUpperCase() !== "EPSG") continue;
    if (!CRS_KEYWORDS.has(String(node.parent || ""))) continue;
    const code = Number(node.strings[1] !== undefined ? node.strings[1] : node.numbers[0]);
    if (!Number.isFinite(code)) continue;
    // The outermost CRS wins: in a compound or bound CRS the shallower node is
    // the one the file is actually in.
    if (!best || node.depth < best.depth) best = { code, depth: node.depth };
  }
  return best ? best.code : null;
}

/** The unit the top-level CRS measures in, as written. */
function unitNode(nodes) {
  const candidates = nodes.filter((node) => UNIT_KEYWORDS.has(node.keyword)
    && node.parent !== "SPHEROID" && node.parent !== "ELLIPSOID"
    && node.parent !== "PRIMEM" && node.parent !== "PARAMETER");
  // A direct child of the CRS is the CRS's own unit (WKT1, and WKT2's
  // LENGTHUNIT). Failing that, WKT2 hangs the angle unit off each AXIS.
  return candidates.find((node) => node.depth === 1)
    || candidates.find((node) => node.parent === "AXIS" || node.parent === "CS")
    || null;
}

function normaliseUnit(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (/^met(er|re)s?$/i.test(text) || /^m$/i.test(text)) return "metre";
  if (/degree/i.test(text)) return "degree";
  return text;
}

/* ── name recognition, most specific first ───────────────────────────────── */

/** ESRI writes `WGS_1984_UTM_Zone_29N`; EPSG writes `WGS 84 / UTM zone 29N`. */
function tidy(name) {
  return String(name || "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A datum that is NOT WGS 84, named in the file.
 *
 * This is what stops `ETRS_1989_UTM_Zone_32N` — a real ESRI .prj with no
 * authority — from being reported as 32632. The zone and hemisphere match, the
 * datum does not, and the honest answer for ETRS89 UTM (25832) is outside the
 * table this module carries.
 */
function foreignDatum(text) {
  return /ETRS|EUREF|NAD[ _]?(83|27)|OSGB|ED[ _]?50|GDA[ _]?(94|2020)|NZGD|WGS[ _]?72|AGD/i.test(text);
}

function guessFromName(name, fullText, isGeographic) {
  const label = tidy(name);
  if (!label) return null;

  // Web Mercator first: its ESRI name contains "WGS 1984" and it is not 4326.
  if (/web mercator|pseudo[ -]?mercator|popular visuali[sz]ation|mercator auxiliary sphere|auxiliary sphere/i.test(label)) {
    return 3857;
  }
  // Irish Transverse Mercator before anything matching "Irish".
  if (/irish transverse mercator|irenet95|\bITM\b/i.test(label)) return 2157;
  // TM75 before "Irish Grid": "TM75 / Irish Grid" is 29903, not 29902.
  if (/\bTM ?75\b/i.test(label)) return 29903;
  if (/\bTM ?65\b/i.test(label) || /irish (national )?grid/i.test(label)) return 29902;
  if (/british national grid/i.test(label)
    || (/\bOSGB[ ]?(1936|36)?\b/i.test(label) && /grid|bng/i.test(label))) {
    return 27700;
  }
  if (/laea|lambert azimuthal equal area/i.test(label)
    && /etrs ?(89|1989)|europe/i.test(label)) {
    return 3035;
  }
  const utm = /\bUTM ?zone ?(\d{1,2}) ?([NS])\b/i.exec(label);
  if (utm) {
    if (foreignDatum(fullText)) return null;   // right zone, wrong datum
    const zone = Number(utm[1]);
    if (zone >= 1 && zone <= 60) {
      return (utm[2].toUpperCase() === "S" ? 32700 : 32600) + zone;
    }
  }
  // Last, because half the projected CRSs in the world are named after this
  // datum: plain WGS 84 is only 4326 when the CRS is geographic.
  if (isGeographic && /\bWGS ?(84|1984)\b/i.test(label)) return 4326;
  return null;
}

/* ── the entry point ─────────────────────────────────────────────────────── */

/**
 * Read a .prj (WKT1 or WKT2, ESRI or EPSG flavoured) and say what CRS it is.
 *
 * `source` records HOW the answer was reached — "authority" for a code read out
 * of the file, "name" for a recognised name — so a caller can present a guessed
 * CRS differently from a declared one. An unrecognised file returns
 * `epsg: null` with the name it found rather than a plausible number.
 */
export function detectCrs(wktText) {
  // A .prj written by a Windows tool often starts with a byte-order mark; it is
  // invisible, and it makes the first keyword unmatchable.
  const text = String(wktText == null ? "" : wktText).replace(/^\uFEFF/, "").trim();
  const empty = { epsg: null, name: "", isGeographic: false, unit: null, source: null };
  if (!text) return empty;

  const nodes = parseNodes(text);
  const top = nodes.find((node) => node.depth === 0) || null;

  // A .prj holding no WKT at all: some tools write a bare "EPSG:27700", and
  // proj4 strings carry +init=epsg:4326. Both are declarations, not guesses.
  if (!top) {
    const bare = /(?:^|[\s+])(?:init=)?epsg[:\s=]+(\d{4,6})/i.exec(text);
    if (bare) {
      const code = Number(bare[1]);
      const known = KNOWN_CRS[code];
      return {
        epsg: code,
        name: crsLabel(code),
        isGeographic: known ? known.geographic : false,
        unit: known ? known.unit : null,
        source: "authority",
      };
    }
    return empty;
  }

  const name = top.strings[0] || "";
  const isGeographic = GEOGRAPHIC_KEYWORDS.has(top.keyword);
  const unit = normaliseUnit(unitNode(nodes)?.strings[0])
    || (isGeographic ? "degree" : "metre");

  const declared = authorityCode(nodes);
  if (declared !== null) {
    return { epsg: declared, name, isGeographic, unit, source: "authority" };
  }

  const guessed = guessFromName(name, text, isGeographic);
  if (guessed !== null) {
    return { epsg: guessed, name, isGeographic, unit, source: "name" };
  }
  return { epsg: null, name, isGeographic, unit, source: null };
}
