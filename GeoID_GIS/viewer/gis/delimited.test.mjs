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

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
