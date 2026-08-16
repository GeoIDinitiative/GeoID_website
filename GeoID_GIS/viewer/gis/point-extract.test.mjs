/**
 * Reading a coordinate list, and sampling every layer at every point.
 *
 * The parser is the part that will meet real input — pasted out of a
 * spreadsheet, copied from an email, typed with a label in front — so it is
 * pinned against all of those shapes. The rule that matters most is the one
 * about failure: a line that cannot be read is REPORTED, never skipped, or a
 * table of 199 points passes for a table of 200.
 */

globalThis.window = globalThis;
globalThis.document = { readyState: "complete", addEventListener() {}, getElementById: () => null };

const { parsePoints, formatPoints, extractAtPoints, columnName } =
  await import("./point-extract.js");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`);
}

check("comma, space and tab all separate", () => {
  const { points } = parsePoints("54.67, -6.775\n54.60 -6.30\n54.50\t-6.10");
  eq(points.length, 3, "points");
  eq(points[1].lat, 54.6, "second latitude");
  eq(points[2].lon, -6.1, "third longitude");
});

check("a third number is a height", () => {
  const { points } = parsePoints("54.67, -6.775, 120");
  eq(points[0].z, 120, "height");
});

check("a label may lead with a colon or trail as a word", () => {
  const { points } = parsePoints("Station 4: 54.6, -6.3\n54.5, -6.2 Borehole7");
  eq(points[0].label, "Station 4", "leading label");
  eq(points[1].label, "Borehole7", "trailing label");
});

check("blank lines and comments are not points and not errors", () => {
  const { points, errors } = parsePoints("# my sites\n\n54.6, -6.3\n\n");
  eq(points.length, 1, "points");
  eq(errors.length, 0, "errors");
});

check("a line that cannot be read is reported with its number", () => {
  const { points, errors } = parsePoints("54.6, -6.3\nnorth of the quarry\n54.5, -6.2");
  eq(points.length, 2, "good points kept");
  eq(errors.length, 1, "errors");
  if (!errors[0].includes("line 2")) throw new Error(`expected line 2, got "${errors[0]}"`);
});

check("an out-of-range coordinate is refused, not clamped", () => {
  const { points, errors } = parsePoints("91, -6.3\n54.6, -400");
  eq(points.length, 0, "points");
  eq(errors.length, 2, "errors");
});

check("east-positive longitude past 180 is brought back to signed", () => {
  // The cursor readout says 353.2°E; pasting that must not land in the Pacific.
  const { points } = parsePoints("54.6, 353.2");
  eq(Number(points[0].lon.toFixed(1)), -6.8, "signed longitude");
});

check("formatting round-trips through the box", () => {
  const first = parsePoints("Rig 2: 54.60000, -6.30000, 12").points;
  const second = parsePoints(formatPoints(first)).points;
  eq(second[0].label, "Rig 2", "label");
  eq(second[0].lat, 54.6, "latitude");
  eq(second[0].z, 12, "height");
});

check("a column name survives a file system and a dbf field", () => {
  eq(columnName("NI landslide susceptibility (ranked).tif"),
    "NI_landslide_susceptibility_ranked", "name");
  eq(columnName(""), "layer", "empty");
});

check("every layer is read at every point", () => {
  const layers = [
    { name: "a.tif", sampler: (lat, lon) => lat + lon },
    { name: "b.tif", sampler: () => 7 },
  ];
  const out = extractAtPoints([{ lat: 10, lon: 5 }, { lat: 1, lon: 2 }], layers);
  eq(out.ok, true, "ok");
  eq(out.rows.length, 2, "rows");
  eq(out.rows[0].a, 15, "first layer at first point");
  eq(out.rows[1].b, 7, "second layer at second point");
});

check("two layers reducing to one column name both survive", () => {
  const layers = [
    { name: "slope.tif", sampler: () => 1 },
    { name: "slope.asc", sampler: () => 2 },
  ];
  const out = extractAtPoints([{ lat: 0, lon: 0 }], layers);
  eq(out.columns.length, 2, "columns");
  eq(out.rows[0].slope, 1, "first");
  eq(out.rows[0].slope_2, 2, "second");
});

check("a sampler that throws yields null rather than losing the row", () => {
  const layers = [{ name: "bad.tif", sampler: () => { throw new Error("nope"); } }];
  const out = extractAtPoints([{ lat: 0, lon: 0 }], layers);
  eq(out.rows.length, 1, "row kept");
  eq(out.rows[0].bad, null, "value");
});

check("points outside every layer are counted in the message, not dropped", () => {
  const layers = [{ name: "a.tif", sampler: (lat) => (lat > 50 ? 1 : null) }];
  const out = extractAtPoints([{ lat: 54, lon: 0 }, { lat: 10, lon: 0 }], layers);
  eq(out.rows.length, 2, "rows");
  if (!out.message.includes("1 fell outside")) {
    throw new Error(`the message hid the miss: "${out.message}"`);
  }
});

check("a height on any point becomes a column on every row", () => {
  // Otherwise the column set is read off row one and the heights below it
  // vanish from the table and the CSV together.
  const out = extractAtPoints(
    [{ lat: 1, lon: 2 }, { lat: 3, lon: 4, z: 120 }],
    [{ name: "a", sampler: () => 1 }]);
  eq(Object.prototype.hasOwnProperty.call(out.rows[0], "z"), true, "first row has the column");
  eq(out.rows[0].z, null, "first row value");
  eq(out.rows[1].z, 120, "second row value");
});

check("no height anywhere means no height column", () => {
  const out = extractAtPoints([{ lat: 1, lon: 2 }], [{ name: "a", sampler: () => 1 }]);
  eq(Object.prototype.hasOwnProperty.call(out.rows[0], "z"), false, "no column");
});

check("no points is a refusal with a reason", () => {
  const out = extractAtPoints([], [{ name: "a", sampler: () => 1 }]);
  eq(out.ok, false, "ok");
});

check("elevation is added when the viewer can answer", () => {
  const out = extractAtPoints([{ lat: 1, lon: 2 }], [{ name: "a", sampler: () => 1 }],
    { elevation: () => 123.6 });
  eq(out.rows[0].elevation_m, 124, "rounded metres");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
