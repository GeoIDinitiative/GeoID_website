/**
 * Column mapping.
 *
 * The failure this guards against is silent: a file whose columns are guessed
 * wrongly still imports, still draws, and still reports a sensible-looking
 * extent — it is simply somewhere else on Earth. So the checks below assert
 * what a mapping RESOLVES TO, not that parsing succeeded.
 *
 * Run: node GeoID_GIS/viewer/gis/delimited.test.mjs
 */

import {
  readHead, proposeMapping, validateMapping, parseRows, detectDelimiter, looksLikeHeader,
  attributeHead, rankColourFields,
} from "./delimited.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── Delimiters ───────────────────────────────────────────────────────────────
eq("a comma file is comma-delimited", detectDelimiter("lon,lat,z"), ",");
eq("a tab file is tab-delimited", detectDelimiter("lon\tlat\tz"), "\t");
eq("a semicolon file is semicolon-delimited", detectDelimiter("lon;lat;z"), ";");
check("a space-separated point cloud falls back to whitespace",
  detectDelimiter("14.99 37.75 1200") instanceof RegExp);

// ── Header detection ─────────────────────────────────────────────────────────
check("names are a header", looksLikeHeader(["lon", "lat", "z"]));
check("numbers are not a header", !looksLikeHeader(["14.99", "37.75", "1200"]));
check("a mixed row is a header", looksLikeHeader(["station", "37.75", "1200"]));

// ── The head, and the mapping it proposes ────────────────────────────────────
{
  const csv = [
    "# survey export",
    "station,longitude,latitude,elevation,magnitude",
    "ETNA1,14.99,37.75,1200,3.4",
    "ETNA2,15.01,37.76,1350,2.9",
    "ETNA3,15.03,37.74,1410,4.1",
  ].join("\n");
  const head = readHead(csv);
  eq("the comment line is not a column", head.columns,
    ["station", "longitude", "latitude", "elevation", "magnitude"]);
  eq("three data rows are previewed", head.rows.length, 3);
  eq("the first row is the first row", head.rows[0], ["ETNA1", "14.99", "37.75", "1200", "3.4"]);
  check("a header was recognised", head.hasHeader);
  // Named columns must win over position -- position would make `station` the
  // longitude, which is exactly the silent failure this exists to prevent.
  eq("longitude is found by name, not position", head.mapping.lon, 1);
  eq("latitude too", head.mapping.lat, 2);
  eq("elevation too", head.mapping.elev, 3);
  eq("magnitude too", head.mapping.magnitude, 4);
  check("and it does not claim to be a guess", head.mapping.guessed === false);
}

// A headerless point cloud: position is all there is, and it says so.
{
  const xyz = "14.99 37.75 1200\n15.01 37.76 1350\n";
  const head = readHead(xyz);
  eq("columns are synthesised", head.columns, ["Column 1", "Column 2", "Column 3"]);
  check("no header row was consumed as names", head.hasHeader === false);
  eq("both rows survive", head.rows.length, 2);
  eq("mapping falls back to position", [head.mapping.lon, head.mapping.lat, head.mapping.elev], [0, 1, 2]);
  check("and it admits the columns were assumed", head.mapping.guessed === true);
}

// The dangerous file: three columns, none of them coordinates by name.
{
  const csv = "id,depth,station\n1,20,ETNA1\n2,35,ETNA2\n";
  const head = readHead(csv);
  check("an unrecognised header still yields a mapping", Boolean(head.mapping));
  check("but it is flagged as a guess so the dialog can say so", head.mapping.guessed === true);
}

// ── Validation ───────────────────────────────────────────────────────────────
{
  const ok = validateMapping({ lon: 0, lat: 1, elev: 2, magnitude: -1 }, 3);
  check("a complete mapping validates", ok.ok, JSON.stringify(ok.problems));
  const noX = validateMapping({ lon: -1, lat: 1 }, 3);
  check("no X is a problem", !noX.ok && /X \/ longitude/.test(noX.problems[0]));
  const same = validateMapping({ lon: 1, lat: 1 }, 3);
  check("X and Y cannot be the same column", !same.ok && same.problems.some((p) => /same column/.test(p)));
  const outside = validateMapping({ lon: 0, lat: 1, elev: 9 }, 3);
  check("a Z outside the file is a problem", !outside.ok);
  const noZ = validateMapping({ lon: 0, lat: 1, elev: -1, magnitude: -1 }, 3);
  check("but choosing NO Z is not", noZ.ok, JSON.stringify(noZ.problems));
}

// ── Applying a mapping ───────────────────────────────────────────────────────
{
  const csv = [
    "station,longitude,latitude,elevation,magnitude",
    "ETNA1,14.99,37.75,1200,3.4",
    "ETNA2,15.01,37.76,1350,2.9",
    "bad,,,,",
    "ETNA3,15.03,37.74,1410,notanumber",
  ].join("\n");
  const head = readHead(csv);
  const { points, skipped } = parseRows(csv, head.mapping,
    { delimiter: head.delimiter, hasHeader: head.hasHeader });
  eq("three usable rows", points.length, 3);
  eq("and one refused", skipped, 1);
  eq("the first point is the first row", points[0], { x: 14.99, y: 37.75, z: 1200, magnitude: 3.4 });
  // A magnitude that will not parse is absent, not zero -- zero is a reading.
  eq("an unreadable magnitude is null, not 0", points[2].magnitude, null);

  // The whole point of the feature: choose different columns, get different data.
  const swapped = parseRows(csv, { lon: 3, lat: 4, elev: -1, magnitude: -1 },
    { delimiter: head.delimiter, hasHeader: head.hasHeader });
  eq("a different mapping reads different columns", swapped.points[0], { x: 1200, y: 3.4, z: 0 });
}

// A headerless file must not lose its first row when the mapping is applied.
{
  const xyz = "14.99 37.75 1200\n15.01 37.76 1350\n";
  const head = readHead(xyz);
  const { points } = parseRows(xyz, head.mapping,
    { delimiter: head.delimiter, hasHeader: head.hasHeader });
  eq("both points survive a headerless file", points.length, 2);
  eq("including the very first line", points[0], { x: 14.99, y: 37.75, z: 1200 });
}

// ── Attribute tables ─────────────────────────────────────────────────────────
// A BGS polygon carries 57 columns and only a handful describe the rock. The
// ranking is what makes the picker usable, and it is a property of the data
// rather than a preference: a constant column paints one colour, an id column
// paints one class per feature.
{
  const features = [
    { properties: { lex_d: "Basalt", rcs_d: "Igneous", objectid: 1, sheet: "NI", blank: "" } },
    { properties: { lex_d: "Sandstone", rcs_d: "Sedimentary", objectid: 2, sheet: "NI", blank: "" } },
    { properties: { lex_d: "Basalt", rcs_d: "Igneous", objectid: 3, sheet: "NI", blank: "" } },
    { properties: { lex_d: "Chalk", rcs_d: "Sedimentary", objectid: 4, sheet: "NI", blank: "" } },
  ];
  const head = attributeHead(features, { rows: 3 });
  eq("every column is found", head.columns.map((c) => c.key),
    ["lex_d", "rcs_d", "objectid", "sheet", "blank"]);
  eq("the feature count is the whole layer", head.count, 4);
  eq("only the asked-for rows are previewed", head.rows.length, 3);
  eq("a row reads across the columns", head.rows[0], ["Basalt", "Igneous", "1", "NI", ""]);
  const by = Object.fromEntries(head.columns.map((c) => [c.key, c]));
  eq("distinct values are counted", by.lex_d.distinct, 3);
  eq("a constant column has one", by.sheet.distinct, 1);
  eq("an id column has one per feature", by.objectid.distinct, 4);
  eq("an empty column has none", by.blank.distinct, 0);
  eq("and is counted as unfilled", by.blank.filled, 0);

  const ranked = rankColourFields(head);
  check("a constant column is not offered", !ranked.includes("sheet"));
  check("an id column is not offered", !ranked.includes("objectid"));
  check("an empty column is not offered", !ranked.includes("blank"));
  eq("the most informative column leads", ranked[0], "lex_d");
  eq("and the rest follow by class count", ranked, ["lex_d", "rcs_d"]);
  // A field with more classes than a legend can show is refused by the cap.
  eq("the class cap is honoured", rankColourFields(head, { maxClasses: 2 }), ["rcs_d"]);
}
// The distinct count stops at a cap, and says so rather than reporting a floor
// as though it were a total.
{
  const many = Array.from({ length: 260 }, (_, i) => ({ properties: { id: `v${i}`, kind: i % 3 } }));
  const head = attributeHead(many, { rows: 2 });
  const by = Object.fromEntries(head.columns.map((c) => [c.key, c]));
  check("a high-cardinality column is capped", by.id.capped === true);
  eq("and stops at the cap", by.id.distinct, 200);
  check("a small column is not capped", by.kind.capped === false);
  eq("and is counted exactly", by.kind.distinct, 3);
  const ranked = rankColourFields(head, { maxClasses: 500 });
  check("a capped column is never offered, whatever the class cap allows",
    !ranked.includes("id"), JSON.stringify(ranked));
  eq("the countable one still is", ranked, ["kind"]);
}

/* ── numbers are not names ────────────────────────────────────────────────
 *
 * The distinct count alone cannot tell a magnitude from an identifier, and the
 * symbology picker needs to: a numeric column with 200+ values is the one most
 * worth CLASSING, while a text column with 200+ values is an id and worth
 * nothing. `s1_mpa` (193 readings) and `wsm_id` (32,464) both looked like "too
 * many to colour by", so a stress magnitude could not be mapped at all.
 */
{
  const rows = [
    { properties: { depth: 1.5, code: "BO", flag: true, blank: "", mixed: "12" } },
    { properties: { depth: "40", code: "FMS", flag: false, blank: "", mixed: "x" } },
    { properties: { depth: -3, code: "OC", flag: true, blank: "", mixed: "7" } },
  ];
  const by = Object.fromEntries(attributeHead(rows).columns.map((c) => [c.key, c]));
  check("a column of numbers says so", by.depth.numeric === true);
  eq("with the range it covers", [by.depth.min, by.depth.max], [-3, 40]);
  check("a number written as text still counts", by.depth.numeric === true,
    "the CSV path hands every value over as a string");
  check("but one non-number disqualifies the column", by.mixed.numeric === false);
  check("a column of codes is not numeric", by.code.numeric === false);
  check("and neither are booleans, whatever Number() says of them",
    by.flag.numeric === false);
  check("an empty column claims no range", by.blank.numeric === false);
  eq("and no bounds either", [by.blank.min, by.blank.max], [null, null]);
}

check("no features, no head", attributeHead([]).columns.length === 0);
check("and nothing to rank", rankColourFields(attributeHead([])).length === 0);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
