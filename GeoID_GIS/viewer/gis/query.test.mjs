/**
 * The query engine, against answers that were planted rather than observed.
 *
 * Two kinds of check live here and they fail for different reasons:
 *
 * - **Grammar** — the shape of the tree, one case per operator plus the three
 *   precedence rules. A precedence bug is invisible in a result set unless the
 *   fixture is built so the two readings disagree, so the evaluation cases pick
 *   data where left-to-right and NOT > AND > OR give different answers.
 * - **Geometry** — hand-placed squares, segments and points whose containment
 *   is obvious by eye and whose one distance is known in closed form: a point
 *   at (0, 0) against the meridian lon = 0.01°, which is
 *   R · 0.01° · cos(0) = 6371008.8 × 1.74533e-4 = 1111.95 m. The two distance
 *   predicates bracket that to a metre, so the projection cannot drift without
 *   this failing.
 *
 * Run: node GeoID_GIS/viewer/gis/query.test.mjs
 */

import {
  parseQuery, evaluateQuery, runQuery, queryLayers, compareValues, QUERY_HELP,
} from "./query.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

/* ── fixtures ── */

const feature = (properties, geometry = null) => ({ type: "Feature", properties, geometry });
const collection = (features) => ({ type: "FeatureCollection", features });
const pt = (c) => ({ type: "Point", coordinates: c });
const line = (c) => ({ type: "LineString", coordinates: c });
const poly = (rings) => ({ type: "Polygon", coordinates: rings });

/** Run a query and reduce it to a comparable string. */
function ids(text, fc, layers = {}) {
  const out = runQuery(fc, text, {
    resolveLayer: (name) => (Object.prototype.hasOwnProperty.call(layers, name) ? layers[name] : null),
  });
  return out.ok ? out.indices.join(",") : `ERROR: ${out.message}`;
}
const selects = (name, text, fc, want, layers) =>
  check(name, ids(text, fc, layers) === want, `got "${ids(text, fc, layers)}", want "${want}"`);

const towns = collection([
  feature({ name: "Ballymena", pop: 29551, county: "Antrim", surveyed: "2026-03-04", grade: "B" }),
  feature({ name: "Bangor", pop: 61011, county: "Down", surveyed: "2025-11-20T09:00:00Z", grade: "A" }),
  // pop is a STRING here: shapefile attributes arrive that way constantly.
  feature({ name: "Omagh", pop: "19910", county: "Tyrone", surveyed: "2026-01-01", grade: "A" }),
  feature({ name: "Newry", pop: 27913, county: "Down", grade: "C" }),
  feature({ name: "Derry", pop: 83163, county: "Londonderry", surveyed: "2026-07-31", grade: null }),
]);

/* ── grammar: one case per operator ── */

{
  const r = parseQuery("landuse = 'peat'");
  check("a comparison parses", r.ok && r.ast.type === "cmp");
  check("the field is a bare word", r.ok && r.ast.field === "landuse");
  check("the operator survives", r.ok && r.ast.op === "=");
  check("a quoted literal is a string", r.ok && r.ast.value.kind === "str" && r.ast.value.value === "peat");
}

["=", "!=", ">", "<", ">=", "<="].forEach((op) => {
  const r = parseQuery(`pop ${op} 100`);
  check(`operator ${op} parses`, r.ok && r.ast.type === "cmp" && r.ast.op === op
    && r.ast.value.kind === "num" && r.ast.value.value === 100);
});

{
  check("<> is read as !=", parseQuery("a <> 1").ast.op === "!=");
  check("== is read as =", parseQuery("a == 1").ast.op === "=");
}

{
  const r = parseQuery("name contains 'bally'");
  check("contains parses as its own node", r.ok && r.ast.type === "contains"
    && r.ast.field === "name" && r.ast.value.value === "bally");
}

{
  const r = parseQuery("county in ('Antrim', \"Down\", 3)");
  check("in parses a mixed list", r.ok && r.ast.type === "in" && r.ast.values.length === 3);
  check("its members keep their types", r.ok
    && r.ast.values[0].kind === "str" && r.ast.values[1].kind === "str"
    && r.ast.values[2].kind === "num" && r.ast.values[2].value === 3);
}

{
  check("a doubled quote is an escaped quote",
    parseQuery("name = 'O''Neill'").ast.value.value === "O'Neill");
  check("double quotes make a string, not a field",
    parseQuery('name = "Down"').ast.value.kind === "str");
  check("a bare word on the right is a FIELD reference",
    parseQuery("pop_2020 > pop_2010").ast.value.kind === "field"
    && parseQuery("pop_2020 > pop_2010").ast.value.name === "pop_2010");
  check("a negative number in value position is one number",
    parseQuery("z = -2.5e3").ast.value.value === -2500);
  check("brackets quote a field name with spaces",
    parseQuery("[Field With Spaces] = 'x'").ast.field === "Field With Spaces");
  const bracketed = parseQuery("[contains] = 1");
  check("and a bracketed keyword becomes that field, not the operator",
    bracketed.ok && bracketed.ast.type === "cmp" && bracketed.ast.field === "contains",
    JSON.stringify(bracketed));
}

/* ── grammar: precedence and grouping ── */

{
  const r = parseQuery("a = 1 OR b = 2 AND c = 3");
  check("AND binds tighter than OR", r.ok && r.ast.type === "or" && r.ast.right.type === "and");
  check("so the left of the OR is the lone term", r.ok && r.ast.left.type === "cmp" && r.ast.left.field === "a");
}
{
  const r = parseQuery("NOT a = 1 AND b = 2");
  check("NOT binds tighter than AND", r.ok && r.ast.type === "and" && r.ast.left.type === "not");
  check("and takes only the term beside it", r.ok && r.ast.left.expr.field === "a");
}
{
  const r = parseQuery("(a = 1 OR b = 2) AND c = 3");
  check("brackets override precedence", r.ok && r.ast.type === "and" && r.ast.left.type === "or");
}
{
  check("NOT NOT is allowed and nests", parseQuery("NOT NOT a = 1").ast.expr.type === "not");
  check("! is a shorthand for NOT", parseQuery("!a = 1").ast.type === "not");
  check("keywords are case-insensitive",
    parseQuery("a = 1 and b = 2 or c = 3").ok && parseQuery("a = 1 AnD b = 2 Or c = 3").ok);
}

/* ── grammar: spatial and temporal ── */

["intersects", "within", "contains"].forEach((op) => {
  const r = parseQuery(`${op}('Study area')`);
  check(`${op}(LAYER) parses`, r.ok && r.ast.type === "spatial" && r.ast.op === op
    && r.ast.layer === "Study area");
});
{
  const r = parseQuery("distance('Rivers') <= 500");
  check("distance parses with its operator and metres", r.ok && r.ast.type === "distance"
    && r.ast.layer === "Rivers" && r.ast.op === "<=" && r.ast.value === 500);
  const bad = parseQuery("distance('Rivers') = 500");
  check("distance refuses = , naming the operators it takes",
    !bad.ok && /< > <= or >=/.test(bad.message), bad.message);
  check("a spatial predicate composes with an attribute one",
    parseQuery("landuse = 'peat' AND within('Study area')").ast.type === "and");
  check("queryLayers lists each layer once",
    queryLayers(parseQuery("intersects('A') AND distance('A') < 5 OR within('B')").ast).join("|") === "A|B");
}

/* ── grammar: refusals ── */

[
  ["an empty query", "", /Type a condition/],
  ["a missing value", "a =", /value is missing/],
  ["an unclosed bracket", "(a = 1", /never closed/],
  ["an unclosed quote", "a = 'x", /never closed/],
  ["trailing rubbish", "a = 1 b = 2", /Unexpected/],
  ["a keyword used as a field", "and = 1", /keyword/],
  ["a keyword used as a value", "a = and", /keyword/],
  ["an unknown character", "a $ 1", /Unexpected character/],
  ["an empty in list", "a in ()", /value/],
].forEach(([label, text, pattern]) => {
  const r = parseQuery(text);
  check(`refused: ${label}`, !r.ok && pattern.test(r.message), r.ok ? "parsed" : r.message);
});

check("every QUERY_HELP example parses",
  QUERY_HELP.every((h) => parseQuery(h.example).ok),
  QUERY_HELP.filter((h) => !parseQuery(h.example).ok).map((h) => h.example).join(" / "));
check("and every one explains itself", QUERY_HELP.every((h) => h.means && h.means.length > 4));

/* ── evaluation: attributes ── */

selects("a numeric comparison selects the big towns", "pop > 30000", towns, "1,4");
selects("a string-typed number still compares numerically", "pop > 19000 AND pop < 30000", towns, "0,2,3");
selects("equality on text", "county = 'Down'", towns, "1,3");
selects("in matches any member", "county in ('Antrim', 'Tyrone')", towns, "0,2");
selects("contains ignores case", "name contains 'BALLY'", towns, "0");
selects("contains is a substring, not a prefix", "name contains 'gh'", towns, "2");
selects("NOT inverts", "NOT county = 'Down'", towns, "0,2,4");
selects("OR unions", "county = 'Down' OR grade = 'A'", towns, "1,2,3");
selects("AND intersects", "county = 'Down' AND grade = 'A'", towns, "1");
// Left-to-right would read this as (Down OR Antrim) AND grade='A' and answer "1".
selects("precedence holds at evaluation too",
  "county = 'Down' OR county = 'Antrim' AND grade = 'A'", towns, "1,3");
selects("brackets change the answer",
  "(county = 'Down' OR county = 'Antrim') AND grade = 'A'", towns, "1");

/* ── evaluation: dates ── */

selects("an ISO date compares as a date", "surveyed >= '2026-01-01'", towns, "0,2,4");
selects("and the other way", "surveyed < '2026-01-01'", towns, "1");
selects("a timestamp is still a date", "surveyed < '2026-01-01T00:00:00Z'", towns, "1");

/* ── evaluation: absent values ── */

selects("a missing field cannot equal anything", "surveyed = '2026-01-01'", towns, "2");
selects("but it IS not-equal — so != and NOT = agree", "surveyed != '2026-01-01'", towns, "0,1,3,4");
selects("...and NOT = gives the same set", "NOT surveyed = '2026-01-01'", towns, "0,1,3,4");
selects("a null value is absent too", "grade = 'A'", towns, "1,2");
selects("a missing field never contains anything", "surveyed contains '2026'", towns, "0,2,4");

/* ── evaluation: field against field, booleans ── */

{
  const pairs = collection([
    feature({ a: 5, b: 3 }), feature({ a: 2, b: 9 }), feature({ a: 7, b: 7 }),
  ]);
  selects("a field compares against another field", "a > b", pairs, "0");
  selects("equality between fields", "a = b", pairs, "2");
  selects("inequality between fields", "a != b", pairs, "0,1");

  const flags = collection([feature({ open: true }), feature({ open: false })]);
  selects("a bare true matches a boolean property", "open = true", flags, "0");
  selects("and false matches the other", "open = false", flags, "1");
}

/* ── ordering rules, directly ── */

{
  check("numbers order numerically, not as text", compareValues(9, 10) < 0);
  check("a numeric string coerces", compareValues("9", 10) < 0);
  check("text orders as text", compareValues("apple", "banana") < 0);
  check("an ISO date beats text ordering", compareValues("2026-01-02", "2025-12-31T23:00:00Z") > 0);
  check("equal values compare equal", compareValues("5", 5) === 0);
}

/* ── evaluation: spatial, on hand-placed geometry ── */

const box = collection([
  feature({ id: "box" }, poly([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])),
]);
const holed = collection([
  feature({ id: "holed" }, poly([
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ])),
]);
const points = collection([
  feature({ kind: "well", depth: 40 }, pt([5, 5])),        // 0 inside
  feature({ kind: "well", depth: 90 }, pt([11, 5])),       // 1 outside, east
  feature({ kind: "spring", depth: 5 }, pt([-3, -3])),     // 2 outside, southwest
  feature({ kind: "spring", depth: 120 }, pt([9.9, 9.9])), // 3 inside, near the corner
]);
const lines = collection([
  feature({ id: "crossing" }, line([[-5, 5], [5, 5]])),
  feature({ id: "inside" }, line([[2, 2], [3, 3]])),
  feature({ id: "away" }, line([[20, 20], [30, 30]])),
]);
const polys = collection([
  feature({ id: "overlap" }, poly([[[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]])),
  feature({ id: "inner" }, poly([[[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]])),
  feature({ id: "far" }, poly([[[50, 50], [60, 50], [60, 60], [50, 60], [50, 50]]])),
]);

selects("points inside the square intersect it", "intersects('Box')", points, "0,3", { Box: box });
selects("and they are within it", "within('Box')", points, "0,3", { Box: box });
selects("a point contains no polygon", "contains('Box')", points, "", { Box: box });
selects("the square contains the points that are in it", "contains('Points')", box, "0", { Points: points });
selects("a line that crosses the edge intersects", "intersects('Box')", lines, "0,1", { Box: box });
selects("but only the enclosed line is within", "within('Box')", lines, "1", { Box: box });
selects("a partly overlapping polygon intersects", "intersects('Box')", polys, "0,1", { Box: box });
selects("only the enclosed polygon is within", "within('Box')", polys, "1", { Box: box });
selects("the square contains the enclosed polygon", "contains('Polys')", box, "0", { Polys: polys });
selects("a point in a HOLE is not within the polygon", "within('Holed')", points, "3", { Holed: holed });
selects("nor does it intersect it", "intersects('Holed')", points, "3", { Holed: holed });
selects("spatial composes with attributes", "kind = 'well' AND within('Box')", points, "0", { Box: box });
selects("and with NOT", "NOT within('Box')", points, "1,2", { Box: box });
selects("and with a numeric filter", "within('Box') AND depth > 100", points, "3", { Box: box });

/* ── evaluation: distance, against a closed-form answer ── */

const origin = collection([feature({ id: "o" }, pt([0, 0]))]);
// lon = 0.01° at the equator: 6371008.8 m × 0.01 × π/180 = 1111.95 m.
const meridian = collection([feature({ id: "m" }, line([[0.01, -1], [0.01, 1]]))]);
const EXPECT_M = 6371008.8 * 0.01 * (Math.PI / 180);
near("the planted distance is 1111.95 m", EXPECT_M, 1111.95, 0.01);

selects("nearer than 1113 m — yes", "distance('M') < 1113", origin, "0", { M: meridian });
selects("nearer than 1111 m — no", "distance('M') < 1111", origin, "", { M: meridian });
selects("further than 1111 m — yes", "distance('M') > 1111", origin, "0", { M: meridian });
selects("further than 1113 m — no", "distance('M') > 1113", origin, "", { M: meridian });
selects("<= carries the same bracket", "distance('M') <= 1113", origin, "0", { M: meridian });
selects("a point ON the line is zero metres away", "distance('M') < 1",
  collection([feature({ id: "on" }, pt([0.01, 0]))]), "0", { M: meridian });
selects("distance composes with attributes", "distance('M') < 1113 AND id = 'o'", origin, "0", { M: meridian });

/* ── unresolvable layers ── */

{
  const missing = runQuery(points, "within('Ghost')", { resolveLayer: () => null });
  check("an unresolvable layer fails the query", !missing.ok);
  check("and the message names it", /"Ghost"/.test(missing.message || ""), missing.message);

  const thrown = runQuery(points, "within('Ghost')", {
    resolveLayer: () => { throw new Error("registry is asleep"); },
  });
  check("a resolver that throws is the same clean failure", !thrown.ok && /"Ghost"/.test(thrown.message));

  const noResolver = runQuery(points, "within('Box')", {});
  check("no resolver at all is also a message, not a silent empty set",
    !noResolver.ok && /"Box"/.test(noResolver.message));

  const attributeOnly = runQuery(towns, "county = 'Down'", {});
  check("an attribute query needs no resolver", attributeOnly.ok && attributeOnly.indices.length === 2);
}

/* ── evaluateQuery contract ── */

{
  const parsed = parseQuery("pop > 30000");
  const out = evaluateQuery(towns, parsed.ast, {});
  check("evaluateQuery returns indices, not features",
    out.ok && out.indices.every((i) => typeof i === "number"));
  check("indices are ascending and address the source order",
    out.indices.join(",") === "1,4" && towns.features[out.indices[0]].properties.name === "Bangor");
  check("an empty collection is an empty answer, not an error",
    evaluateQuery(collection([]), parsed.ast, {}).indices.length === 0);
  check("no AST is a refusal", !evaluateQuery(towns, null, {}).ok);
  check("a feature with no geometry never matches a spatial predicate",
    ids("within('Box')", towns, { Box: box }) === "");
  check("runQuery hands back the parse error unchanged",
    runQuery(towns, "a =", {}).ok === false);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
