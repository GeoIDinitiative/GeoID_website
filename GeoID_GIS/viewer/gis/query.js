/**
 * The query engine — "Select by Attribute" and "Select by Location" in one
 * expression language.
 *
 * Every GIS splits these into two dialogs because their SQL layer cannot see
 * geometry. Here the parser owns both, so `landuse = 'peat' AND within('Study
 * area') AND distance('Rivers') < 500` is one query rather than three passes
 * with intermediate layers. That is the whole reason for a hand-written parser
 * instead of handing a WHERE clause to something else.
 *
 * The module is PURE and node-testable: no DOM, no window, no import of the
 * layer registry. A spatial predicate names a layer as a string and the caller
 * supplies `resolveLayer` at evaluation time, which is what lets the same
 * function run against hand-built FeatureCollections in `query.test.mjs` and
 * against `window.GeoIDImportManager.getLayers()` in the browser.
 *
 * Three grammar decisions worth knowing before editing:
 *
 * - **A bare word is a field name, everywhere.** So the right-hand side of a
 *   comparison may be a field too (`pop_2020 > pop_2010`), and a literal string
 *   must be quoted. There is no "unquoted string" case at all, which removes
 *   the class of bug where `status = active` silently means one thing in the
 *   parser and another to the person who typed it. `[Field With Spaces]`
 *   escapes a name the bare-word rule cannot reach, keywords included.
 * - **Comparison type is decided by the values, not declared.** ISO-8601 dates
 *   compare as dates, anything both sides coerce to a finite number compares
 *   numerically, everything else compares as strings. Only ISO forms take the
 *   date path — an ambiguous `01/03/2026` is never silently reinterpreted as a
 *   date, because there is no way to know which field is the month.
 * - **An absent value is not comparable.** A missing or null property is false
 *   for `=`, `>`, `<`, `>=`, `<=`, `contains` and `in`, and true for `!=`. That
 *   keeps `NOT (a = 1)` and `a != 1` in agreement, which the SQL three-valued
 *   answer does not.
 *
 * Spatial predicates are planar over lon/lat, exactly as geometry.js's boolean
 * ops are, and distance is metric — see `minDistanceMetres` for the projection
 * and its stated error.
 */

import {
  pointInPolygon, boundsOf, boundsIntersect,
} from "./geometry.js?v=20260830-ecc1aa5";

/** IUGG mean radius. geometry.js holds the same value privately. */
const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;
/** Planar tolerance in degrees — well below any real coordinate precision. */
const EPS = 1e-12;

const SPATIAL_OPS = new Set(["intersects", "within", "contains"]);
/** Words that can never be a bare field name; `[name]` escapes any of them. */
const RESERVED = new Set([
  "and", "or", "not", "in", "contains", "intersects", "within", "distance",
]);
const COMPARE_OPS = new Set(["=", "!=", ">", "<", ">=", "<="]);

/** Examples the UI can list verbatim; also the grammar's documentation. */
export const QUERY_HELP = [
  { example: "landuse = 'peat'", means: "text match — literals are quoted, bare words are field names" },
  { example: "pop > 10000", means: "numeric comparison; also < >= <= !=" },
  { example: "pop_2020 > pop_2010", means: "compare one field against another" },
  { example: "name contains 'ballym'", means: "substring, ignoring case" },
  { example: "county in ('Antrim', 'Down', 3)", means: "any of a list, mixed types allowed" },
  { example: "surveyed >= '2026-01-01'", means: "ISO dates compare as dates, not as text" },
  { example: "NOT status = 'closed'", means: "NOT binds tighter than AND, which binds tighter than OR" },
  { example: "(a = 1 OR b = 2) AND c = 3", means: "brackets group" },
  { example: "intersects('Flood extent')", means: "touches or overlaps any feature of that layer" },
  { example: "within('Study area')", means: "falls entirely inside a polygon of that layer" },
  { example: "contains('Boreholes')", means: "encloses a feature of that layer" },
  { example: "distance('Rivers') < 500", means: "nearer than 500 metres; also > <= >=" },
  { example: "[Field With Spaces] = 'x'", means: "brackets quote a field name the bare-word rule cannot reach" },
];

/* ── Tokeniser ──────────────────────────────────────────────────────────── */

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.:]*/;

/**
 * Returns `{ tokens }` or `{ error }`. A sign is part of a number only in
 * value position, so `a-1` is not a field followed by a negative number.
 */
function tokenize(text) {
  const src = String(text === undefined || text === null ? "" : text);
  const tokens = [];
  let i = 0;
  const valuePosition = () => {
    const last = tokens[tokens.length - 1];
    if (!last) return true;
    if (last.t === "op" || last.t === "lparen" || last.t === "comma") return true;
    return last.t === "ident" && !last.bracketed && RESERVED.has(last.v.toLowerCase());
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i += 1; continue; }
    if (ch === "(") { tokens.push({ t: "lparen", v: "(", pos: i }); i += 1; continue; }
    if (ch === ")") { tokens.push({ t: "rparen", v: ")", pos: i }); i += 1; continue; }
    if (ch === ",") { tokens.push({ t: "comma", v: ",", pos: i }); i += 1; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < src.length) {
        if (src[j] === ch) {
          // A doubled quote is an escaped quote, as SQL writes it.
          if (src[j + 1] === ch) { out += ch; j += 2; continue; }
          closed = true;
          break;
        }
        out += src[j];
        j += 1;
      }
      if (!closed) return { error: `A quote opened at position ${i} is never closed.` };
      tokens.push({ t: "str", v: out, pos: i });
      i = j + 1;
      continue;
    }
    if (ch === "[") {
      const j = src.indexOf("]", i + 1);
      if (j < 0) return { error: `A "[" at position ${i} is never closed.` };
      const name = src.slice(i + 1, j).trim();
      if (!name) return { error: `An empty field name at position ${i}.` };
      tokens.push({ t: "ident", v: name, pos: i, bracketed: true });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)
      || (ch === "." && /[0-9]/.test(src[i + 1] || ""))
      || ((ch === "-" || ch === "+") && /[0-9.]/.test(src[i + 1] || "") && valuePosition())) {
      const m = NUMBER_RE.exec(src.slice(i));
      if (m) {
        tokens.push({ t: "num", v: Number(m[0]), pos: i });
        i += m[0].length;
        continue;
      }
    }
    const two = src.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "!=" || two === "<>" || two === "==") {
      const op = two === "<>" ? "!=" : (two === "==" ? "=" : two);
      tokens.push({ t: "op", v: op, pos: i });
      i += 2;
      continue;
    }
    if (ch === "=" || ch === ">" || ch === "<") {
      tokens.push({ t: "op", v: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === "!") { tokens.push({ t: "ident", v: "not", pos: i }); i += 1; continue; }
    const m = IDENT_RE.exec(src.slice(i));
    if (m) {
      tokens.push({ t: "ident", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    return { error: `Unexpected character "${ch}" at position ${i}.` };
  }
  return { tokens };
}

/* ── Parser ─────────────────────────────────────────────────────────────── */

class QueryError extends Error {}

function fail(message) {
  throw new QueryError(message);
}

/**
 * `parseQuery(text) -> {ok: true, ast} | {ok: false, message}`.
 *
 * Precedence, tightest first: NOT, AND, OR. Parentheses override.
 */
export function parseQuery(text) {
  const lexed = tokenize(text);
  if (lexed.error) return { ok: false, message: lexed.error };
  const tokens = lexed.tokens;
  if (!tokens.length) {
    return { ok: false, message: "Type a condition, for example: landuse = 'peat'" };
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const keyword = (word) => {
    const tk = tokens[pos];
    return !!tk && tk.t === "ident" && !tk.bracketed && tk.v.toLowerCase() === word;
  };
  const describe = (tk) => (tk ? `"${tk.v}" at position ${tk.pos}` : "the end of the query");

  function parseValue() {
    const tk = peek();
    if (!tk) fail("A value is missing at the end of the query.");
    if (tk.t === "num") { pos += 1; return { kind: "num", value: tk.v }; }
    if (tk.t === "str") { pos += 1; return { kind: "str", value: tk.v }; }
    if (tk.t === "ident") {
      const low = tk.v.toLowerCase();
      // true/false read as the strings a GeoJSON boolean stringifies to, so a
      // real boolean property matches without a fourth literal kind.
      if (!tk.bracketed && (low === "true" || low === "false")) {
        pos += 1;
        return { kind: "str", value: low };
      }
      if (!tk.bracketed && RESERVED.has(low)) {
        fail(`"${tk.v}" is a keyword, so it cannot be a value. Quote it ('${tk.v}') or bracket it ([${tk.v}]).`);
      }
      pos += 1;
      return { kind: "field", name: tk.v };
    }
    fail(`Expected a value but found ${describe(tk)}.`);
    return null;
  }

  function parseSpatial() {
    const head = tokens[pos];
    const op = head.v.toLowerCase();
    pos += 2;                                   // the name and its "("
    const nameTk = peek();
    if (!nameTk || (nameTk.t !== "str" && nameTk.t !== "ident")) {
      fail(`${op}(...) needs a layer name in quotes, for example ${op}('Study area').`);
    }
    const layer = String(nameTk.v);
    pos += 1;
    if (!peek() || peek().t !== "rparen") fail(`${op}(...) is missing its closing bracket.`);
    pos += 1;
    if (op !== "distance") return { type: "spatial", op, layer };
    const opTk = peek();
    if (!opTk || opTk.t !== "op" || opTk.v === "=" || opTk.v === "!=") {
      fail("A distance must be compared with < > <= or >=, for example distance('Rivers') < 500.");
    }
    pos += 1;
    const valTk = peek();
    if (!valTk || valTk.t !== "num") fail("A distance must be compared to a number of metres.");
    pos += 1;
    return { type: "distance", layer, op: opTk.v, value: valTk.v };
  }

  function parseComparison() {
    const fieldTk = peek();
    if (!fieldTk || fieldTk.t !== "ident") fail(`Expected a field name but found ${describe(fieldTk)}.`);
    if (!fieldTk.bracketed && RESERVED.has(fieldTk.v.toLowerCase())) {
      fail(`"${fieldTk.v}" is a keyword. Bracket it ([${fieldTk.v}]) to use it as a field name.`);
    }
    const field = fieldTk.v;
    pos += 1;
    if (keyword("contains")) {
      pos += 1;
      return { type: "contains", field, value: parseValue() };
    }
    if (keyword("in")) {
      pos += 1;
      if (!peek() || peek().t !== "lparen") fail(`"${field} in" needs a list, for example ${field} in ('a', 'b').`);
      pos += 1;
      const values = [];
      for (;;) {
        values.push(parseValue());
        if (peek() && peek().t === "comma") { pos += 1; continue; }
        break;
      }
      if (!peek() || peek().t !== "rparen") fail(`The list after "${field} in" is missing its closing bracket.`);
      pos += 1;
      return { type: "in", field, values };
    }
    const opTk = peek();
    if (!opTk || opTk.t !== "op") {
      fail(`"${field}" needs a comparison, for example ${field} = 'value'.`);
    }
    if (!COMPARE_OPS.has(opTk.v)) fail(`Unknown operator "${opTk.v}" at position ${opTk.pos}.`);
    pos += 1;
    return { type: "cmp", field, op: opTk.v, value: parseValue() };
  }

  function parsePrimary() {
    const tk = peek();
    if (!tk) fail("The query ends where a condition was expected.");
    if (tk.t === "lparen") {
      pos += 1;
      const node = parseOr();
      if (!peek() || peek().t !== "rparen") fail(`A "(" at position ${tk.pos} is never closed.`);
      pos += 1;
      return node;
    }
    if (tk.t === "ident" && !tk.bracketed) {
      const low = tk.v.toLowerCase();
      const next = tokens[pos + 1];
      if ((SPATIAL_OPS.has(low) || low === "distance") && next && next.t === "lparen") {
        return parseSpatial();
      }
    }
    return parseComparison();
  }

  function parseNot() {
    if (keyword("not")) {
      pos += 1;
      return { type: "not", expr: parseNot() };
    }
    return parsePrimary();
  }

  function parseAnd() {
    let left = parseNot();
    while (keyword("and")) {
      pos += 1;
      left = { type: "and", left, right: parseNot() };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (keyword("or")) {
      pos += 1;
      left = { type: "or", left, right: parseAnd() };
    }
    return left;
  }

  try {
    const ast = parseOr();
    if (pos < tokens.length) fail(`Unexpected ${describe(tokens[pos])}.`);
    return { ok: true, ast };
  } catch (err) {
    if (err instanceof QueryError) return { ok: false, message: err.message };
    return { ok: false, message: `Could not read that query: ${err && err.message ? err.message : err}` };
  }
}

/** Every layer name a query will ask `resolveLayer` for, in first-seen order. */
export function queryLayers(ast) {
  const out = [];
  (function walk(node) {
    if (!node) return;
    if (node.type === "and" || node.type === "or") { walk(node.left); walk(node.right); return; }
    if (node.type === "not") { walk(node.expr); return; }
    if (node.type === "spatial" || node.type === "distance") {
      if (!out.includes(node.layer)) out.push(node.layer);
    }
  }(ast));
  return out;
}

/* ── Value semantics ────────────────────────────────────────────────────── */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Epoch ms for an ISO-8601 string, else null. Nothing else takes the date path. */
function dateMs(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!ISO_DATE_RE.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function numberOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function stringOf(value) {
  return typeof value === "string" ? value : String(value);
}

/** −1 / 0 / +1 style ordering: dates, then numbers, then text. Exported for tests. */
export function compareValues(a, b) {
  const da = dateMs(a);
  const db = dateMs(b);
  if (da !== null && db !== null) return da - db;
  const na = numberOf(a);
  const nb = numberOf(b);
  if (na !== null && nb !== null) return na - nb;
  const sa = stringOf(a);
  const sb = stringOf(b);
  if (sa < sb) return -1;
  return sa > sb ? 1 : 0;
}

function absent(value) {
  return value === undefined || value === null;
}

function compareOp(a, b, op) {
  // An absent value is not comparable; only "is not equal" can be answered.
  if (absent(a) || absent(b)) return op === "!=";
  const c = compareValues(a, b);
  switch (op) {
    case "=": return c === 0;
    case "!=": return c !== 0;
    case ">": return c > 0;
    case "<": return c < 0;
    case ">=": return c >= 0;
    case "<=": return c <= 0;
    default: return false;
  }
}

function literalOf(node, props) {
  if (!node) return undefined;
  if (node.kind === "field") return props ? props[node.name] : undefined;
  return node.value;
}

/* ── Geometry ───────────────────────────────────────────────────────────── */

function validPosition(p) {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function collectGeometry(geometry, acc) {
  if (!geometry || typeof geometry !== "object") return;
  const c = geometry.coordinates;
  switch (geometry.type) {
    case "Point": if (validPosition(c)) acc.points.push(c); break;
    case "MultiPoint": (c || []).forEach((p) => { if (validPosition(p)) acc.points.push(p); }); break;
    case "LineString": if (Array.isArray(c)) acc.lines.push(c.filter(validPosition)); break;
    case "MultiLineString": (c || []).forEach((l) => { if (Array.isArray(l)) acc.lines.push(l.filter(validPosition)); }); break;
    case "Polygon": if (Array.isArray(c)) acc.polygons.push(c.map((r) => r.filter(validPosition))); break;
    case "MultiPolygon": (c || []).forEach((poly) => {
      if (Array.isArray(poly)) acc.polygons.push(poly.map((r) => r.filter(validPosition)));
    }); break;
    case "GeometryCollection": (geometry.geometries || []).forEach((g) => collectGeometry(g, acc)); break;
    default: break;
  }
}

function ringSegments(ring, into) {
  for (let i = 0; i + 1 < ring.length; i += 1) into.push([ring[i], ring[i + 1]]);
  if (ring.length > 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    // GeoJSON rings close themselves; a hand-made one may not.
    if (first[0] !== last[0] || first[1] !== last[1]) into.push([last, first]);
  }
}

function polygonSegments(polygon) {
  const segs = [];
  polygon.forEach((ring) => ringSegments(ring, segs));
  return segs;
}

/**
 * A geometry flattened into the three things the predicates need, plus its
 * bounds and every segment. Returns null for an empty or unusable geometry.
 */
export function shapeOf(geometry) {
  const acc = { points: [], lines: [], polygons: [] };
  collectGeometry(geometry, acc);
  const positions = [];
  acc.points.forEach((p) => positions.push(p));
  acc.lines.forEach((l) => l.forEach((p) => positions.push(p)));
  acc.polygons.forEach((poly) => poly.forEach((r) => r.forEach((p) => positions.push(p))));
  if (!positions.length) return null;
  const segments = [];
  acc.lines.forEach((l) => {
    for (let i = 0; i + 1 < l.length; i += 1) segments.push([l[i], l[i + 1]]);
  });
  acc.polygons.forEach((poly) => poly.forEach((r) => ringSegments(r, segments)));
  return { ...acc, positions, segments, bounds: boundsOf(positions) };
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function withinSpan(a, b, p) {
  return p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

function pointOnSegment(p, a, b) {
  return Math.abs(orient(a, b, p)) <= EPS && withinSpan(a, b, p);
}

/** Proper crossing or collinear touch — the standard four-orientation test. */
function segmentsCross(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  const straddle = (a, b) => (a > EPS && b < -EPS) || (a < -EPS && b > EPS);
  if (straddle(d1, d2) && straddle(d3, d4)) return true;
  if (Math.abs(d1) <= EPS && withinSpan(p3, p4, p1)) return true;
  if (Math.abs(d2) <= EPS && withinSpan(p3, p4, p2)) return true;
  if (Math.abs(d3) <= EPS && withinSpan(p1, p2, p3)) return true;
  if (Math.abs(d4) <= EPS && withinSpan(p1, p2, p4)) return true;
  return false;
}

/**
 * Do two shapes share any point? bbox reject, then vertex-in-polygon both
 * ways (which also catches full containment), then edge crossings, then the
 * degenerate point cases a vertex test cannot see.
 */
export function shapesIntersect(a, b) {
  if (!a || !b) return false;
  if (!boundsIntersect(a.bounds, b.bounds)) return false;
  for (let i = 0; i < b.polygons.length; i += 1) {
    for (let j = 0; j < a.positions.length; j += 1) {
      if (pointInPolygon(a.positions[j], b.polygons[i])) return true;
    }
  }
  for (let i = 0; i < a.polygons.length; i += 1) {
    for (let j = 0; j < b.positions.length; j += 1) {
      if (pointInPolygon(b.positions[j], a.polygons[i])) return true;
    }
  }
  for (let i = 0; i < a.segments.length; i += 1) {
    for (let j = 0; j < b.segments.length; j += 1) {
      if (segmentsCross(a.segments[i][0], a.segments[i][1],
        b.segments[j][0], b.segments[j][1])) return true;
    }
  }
  for (let i = 0; i < a.points.length; i += 1) {
    for (let j = 0; j < b.points.length; j += 1) {
      if (a.points[i][0] === b.points[j][0] && a.points[i][1] === b.points[j][1]) return true;
    }
    for (let j = 0; j < b.segments.length; j += 1) {
      if (pointOnSegment(a.points[i], b.segments[j][0], b.segments[j][1])) return true;
    }
  }
  for (let i = 0; i < b.points.length; i += 1) {
    for (let j = 0; j < a.segments.length; j += 1) {
      if (pointOnSegment(b.points[i], a.segments[j][0], a.segments[j][1])) return true;
    }
  }
  return false;
}

function boundsContain(outer, inner) {
  return outer.minX - EPS <= inner.minX && outer.maxX + EPS >= inner.maxX
    && outer.minY - EPS <= inner.minY && outer.maxY + EPS >= inner.maxY;
}

/**
 * Is `a` entirely inside `b`? Only a polygon can contain anything, and the
 * containment must be by ONE polygon: every vertex of `a` inside it and no
 * edge of `a` crossing any of its rings (holes included).
 */
export function shapeWithin(a, b) {
  if (!a || !b || !b.polygons.length) return false;
  if (!boundsContain(b.bounds, a.bounds)) return false;
  for (let i = 0; i < b.polygons.length; i += 1) {
    const poly = b.polygons[i];
    let allIn = true;
    for (let j = 0; j < a.positions.length; j += 1) {
      if (!pointInPolygon(a.positions[j], poly)) { allIn = false; break; }
    }
    if (!allIn) continue;
    const segs = polygonSegments(poly);
    let crosses = false;
    for (let j = 0; j < a.segments.length && !crosses; j += 1) {
      for (let k = 0; k < segs.length; k += 1) {
        if (segmentsCross(a.segments[j][0], a.segments[j][1], segs[k][0], segs[k][1])) {
          crosses = true;
          break;
        }
      }
    }
    if (!crosses) return true;
  }
  return false;
}

function pointSegmentDistance(p, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len2 = (vx * vx) + (vy * vy);
  let t = len2 > 0 ? ((wx * vx) + (wy * vy)) / len2 : 0;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const dx = wx - (t * vx);
  const dy = wy - (t * vy);
  return Math.sqrt((dx * dx) + (dy * dy));
}

/**
 * Nearest distance between two shapes, in metres.
 *
 * EQUIRECTANGULAR about the first shape's own centre — x = R·Δlon·cos(lat0),
 * y = R·Δlat — so a length along a meridian is exact and one along a parallel
 * is exact at lat0, degrading with the cosine away from it. Over a study
 * area's span that is a fraction of a percent, which is well inside the
 * uncertainty of the geometry being measured; a proper geodesic
 * point-to-segment solve would cost far more for less than the digitising
 * error. Brute force over every position × segment pair, both ways — intended
 * for a study area's worth of features, not a national dataset.
 */
export function minDistanceMetres(a, b) {
  if (!a || !b) return Infinity;
  if (shapesIntersect(a, b)) return 0;
  const lat0 = (a.bounds.minY + a.bounds.maxY) / 2;
  const lon0 = (a.bounds.minX + a.bounds.maxX) / 2;
  const kx = EARTH_RADIUS_M * RAD * Math.cos(lat0 * RAD);
  const ky = EARTH_RADIUS_M * RAD;
  const project = (p) => [(p[0] - lon0) * kx, (p[1] - lat0) * ky];
  const pa = a.positions.map(project);
  const pb = b.positions.map(project);
  let best = Infinity;
  for (let i = 0; i < pa.length; i += 1) {
    for (let j = 0; j < pb.length; j += 1) {
      const dx = pa[i][0] - pb[j][0];
      const dy = pa[i][1] - pb[j][1];
      const d = Math.sqrt((dx * dx) + (dy * dy));
      if (d < best) best = d;
    }
  }
  const sweep = (points, segments) => {
    const projected = segments.map((s) => [project(s[0]), project(s[1])]);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = 0; j < projected.length; j += 1) {
        const d = pointSegmentDistance(points[i], projected[j][0], projected[j][1]);
        if (d < best) best = d;
      }
    }
  };
  sweep(pa, b.segments);
  sweep(pb, a.segments);
  return best;
}

/* ── Evaluation ─────────────────────────────────────────────────────────── */

function layerShapes(fc) {
  const out = [];
  (fc.features || []).forEach((f) => {
    const s = shapeOf(f && f.geometry);
    if (s) out.push(s);
  });
  return out;
}

function matches(node, props, shape, layers) {
  switch (node.type) {
    case "and": return matches(node.left, props, shape, layers)
      && matches(node.right, props, shape, layers);
    case "or": return matches(node.left, props, shape, layers)
      || matches(node.right, props, shape, layers);
    case "not": return !matches(node.expr, props, shape, layers);
    case "cmp": return compareOp(props[node.field], literalOf(node.value, props), node.op);
    case "contains": {
      const a = props[node.field];
      const b = literalOf(node.value, props);
      if (absent(a) || absent(b)) return false;
      return stringOf(a).toLowerCase().includes(stringOf(b).toLowerCase());
    }
    case "in": return node.values.some((v) => compareOp(props[node.field], literalOf(v, props), "="));
    case "spatial": {
      const shapes = layers.get(node.layer) || [];
      if (!shape) return false;
      if (node.op === "intersects") return shapes.some((s) => shapesIntersect(shape, s));
      if (node.op === "within") return shapes.some((s) => shapeWithin(shape, s));
      return shapes.some((s) => shapeWithin(s, shape));      // contains
    }
    case "distance": {
      const shapes = layers.get(node.layer) || [];
      if (!shape || !shapes.length) return false;
      let best = Infinity;
      for (let i = 0; i < shapes.length; i += 1) {
        const d = minDistanceMetres(shape, shapes[i]);
        if (d < best) best = d;
        if (best === 0) break;
      }
      if (!Number.isFinite(best)) return false;
      return compareOp(best, node.value, node.op);
    }
    default: return false;
  }
}

/**
 * `evaluateQuery(fc, ast, {resolveLayer}) -> {ok: true, indices} | {ok: false, message}`.
 *
 * Layers are resolved ONCE, up front, so an unresolvable name is one clear
 * message rather than a silently empty result — a spatial query that quietly
 * matches nothing is indistinguishable from a correct answer, which is the
 * failure this guards against.
 */
export function evaluateQuery(fc, ast, options = {}) {
  if (!ast) return { ok: false, message: "There is no query to run." };
  const features = (fc && Array.isArray(fc.features)) ? fc.features : [];
  const resolve = typeof options.resolveLayer === "function" ? options.resolveLayer : null;
  const names = queryLayers(ast);
  const layers = new Map();
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    let other = null;
    if (resolve) {
      try { other = resolve(name); } catch (err) { other = null; }
    }
    if (!other || !Array.isArray(other.features)) {
      return { ok: false, message: `No layer named "${name}" is available for that spatial condition.` };
    }
    layers.set(name, layerShapes(other));
  }
  const wantsGeometry = names.length > 0;
  const indices = [];
  for (let i = 0; i < features.length; i += 1) {
    const f = features[i] || {};
    const props = f.properties || {};
    const shape = wantsGeometry ? shapeOf(f.geometry) : null;
    if (matches(ast, props, shape, layers)) indices.push(i);
  }
  return { ok: true, indices };
}

/** Parse and evaluate in one call — the shape a UI wants. */
export function runQuery(fc, text, options = {}) {
  const parsed = parseQuery(text);
  if (!parsed.ok) return parsed;
  return evaluateQuery(fc, parsed.ast, options);
}
