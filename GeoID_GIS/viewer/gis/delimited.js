/**
 * Reading the head of a delimited file, and choosing what its columns mean.
 *
 * `xyz-adapter.js` already guessed: it matched header names against a list
 * (`lon/long/longitude/x/easting`, and so on) and fell back to column ORDER
 * when nothing matched. That guess is right often enough to be dangerous —
 * a file whose first three columns are `id, depth, station` imports silently
 * as longitude, latitude and elevation, lands somewhere in the Gulf of Guinea,
 * and looks like a working layer. Nothing about it says it is wrong.
 *
 * So the guess stays, as a DEFAULT the user can see and overrule, and this
 * module is the part that can be tested without a browser: split a line, read
 * the first few rows, propose a mapping, and say what a chosen mapping will do.
 * The dialog renders it; the adapter consumes it; neither owns the rule.
 */

/**
 * One delimiter for the whole file, chosen from the header.
 *
 * Sniffing per line looked more forgiving and was worse: a comma-separated file
 * with a space inside one quoted field would change delimiter halfway down and
 * every row after it shifted by a column.
 */
export function detectDelimiter(headerLine = "") {
  const candidates = [
    { delim: ",", re: /,/g },
    { delim: "\t", re: /\t/g },
    { delim: ";", re: /;/g },
    // Whitespace last: it matches almost anything, so it only wins when no
    // real separator is present — which is what a .xyz point cloud looks like.
    { delim: /\s+/, re: /\s+/g },
  ];
  let best = { delim: /\s+/, count: 0 };
  candidates.forEach(({ delim, re }) => {
    const count = (headerLine.match(re) || []).length;
    if (count > best.count) best = { delim, count };
  });
  return best.delim;
}

export function splitLine(line, delimiter) {
  return String(line).trim().split(delimiter)
    .map((f) => f.trim().replace(/^["']|["']$/g, ""));
}

/**
 * A number, where an EMPTY field is not one.
 *
 * `Number("")` is 0, so a row with blank coordinates parsed as (0, 0) and
 * imported as a point in the Gulf of Guinea — accepted, drawn, and counted as a
 * success. Every numeric read in this file goes through here.
 */
function num(field) {
  const text = String(field ?? "").trim();
  return text === "" ? NaN : Number(text);
}

/** A line that carries no data: blank, or one of the two comment forms. */
const isSkippable = (line) => {
  const t = String(line).trim();
  return !t || t.startsWith("#") || t.startsWith("//");
};

/**
 * A header is a row that is not all numbers.
 *
 * A .xyz point cloud has no header at all and starts with numbers, so treating
 * the first line as names would eat a point and label every column "0.0".
 */
export function looksLikeHeader(fields) {
  return Array.isArray(fields) && fields.length > 0
    && !fields.every((f) => Number.isFinite(num(f)));
}

const LON_KEYS = ["lon", "long", "longitude", "x", "easting", "lng"];
const LAT_KEYS = ["lat", "latitude", "y", "northing"];
const ELEV_KEYS = ["z", "elev", "elevation", "height", "alt", "altitude", "depth"];
const MAG_KEYS = ["mag", "magnitude", "value", "val", "amplitude", "intensity", "m"];

function findKey(names, keys) {
  return names.findIndex((n) => keys.includes(n));
}

/**
 * Read the first rows of a delimited file: the `.head()` the dialog shows.
 *
 * Returns the column names (synthesised as "Column 1…" when there is no header
 * row), a sample of rows, and the mapping that WOULD be used if the user
 * changed nothing — so the preview and the import cannot disagree.
 */
export function readHead(text, { rows = 8 } = {}) {
  const lines = String(text).split(/\r?\n/);
  const dataLines = [];
  let headerFields = null;
  let delimiter = ",";

  for (let i = 0; i < lines.length; i += 1) {
    if (isSkippable(lines[i])) continue;
    if (headerFields === null) {
      delimiter = detectDelimiter(lines[i]);
      const fields = splitLine(lines[i], delimiter);
      if (looksLikeHeader(fields)) {
        headerFields = fields;
        continue;
      }
      // No header: the first data row still tells us how many columns there are.
      headerFields = fields.map((_, index) => `Column ${index + 1}`);
      dataLines.push(fields);
      continue;
    }
    dataLines.push(splitLine(lines[i], delimiter));
    if (dataLines.length >= rows) break;
  }

  if (headerFields === null) {
    return { columns: [], rows: [], delimiter, hasHeader: false, mapping: null };
  }
  const hadHeaderRow = !headerFields.every((h, i) => h === `Column ${i + 1}`);
  return {
    columns: headerFields,
    rows: dataLines,
    delimiter,
    hasHeader: hadHeaderRow,
    mapping: proposeMapping(headerFields),
  };
}

/**
 * The default mapping: names first, then position.
 *
 * Position is the fallback the old adapter used ALWAYS, and it is kept only as
 * a last resort — with `guessed: true` so the dialog can say the columns were
 * assumed rather than read, which is the difference between a default and a
 * silent decision.
 */
export function proposeMapping(columns = []) {
  const names = columns.map((c) => String(c).toLowerCase());
  const lon = findKey(names, LON_KEYS);
  const lat = findKey(names, LAT_KEYS);
  const elev = findKey(names, ELEV_KEYS);
  const magnitude = findKey(names, MAG_KEYS);
  const named = lon !== -1 && lat !== -1;
  return {
    lon: named ? lon : 0,
    lat: named ? lat : 1,
    elev: elev !== -1 ? elev : (named ? -1 : Math.min(2, columns.length - 1)),
    magnitude,
    guessed: !named,
  };
}

/**
 * Is this mapping usable, and what is wrong with it?
 *
 * X and Y are the only required pair — a point with no position is not a point.
 * Z and magnitude are optional and -1 means "none", which is a real choice
 * rather than a missing answer.
 */
export function validateMapping(mapping, columnCount) {
  const problems = [];
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < columnCount;
  if (!inRange(mapping?.lon)) problems.push("Choose the X / longitude column.");
  if (!inRange(mapping?.lat)) problems.push("Choose the Y / latitude column.");
  if (inRange(mapping?.lon) && mapping.lon === mapping.lat) {
    problems.push("X and Y cannot be the same column.");
  }
  [["elev", "Z"], ["magnitude", "Magnitude"]].forEach(([key, label]) => {
    const value = mapping?.[key];
    if (value === -1 || value === undefined || value === null) return;
    if (!inRange(value)) problems.push(`${label} is not a column in this file.`);
  });
  return { ok: problems.length === 0, problems };
}

/**
 * Apply a mapping to the whole file.
 *
 * Rows whose X or Y will not parse are counted rather than thrown on: a survey
 * export with a trailing total line should not cost you the other 40,000 points,
 * but you should be told it happened.
 */
export function parseRows(text, mapping, { delimiter = ",", hasHeader = true, limit = 2000000 } = {}) {
  const lines = String(text).split(/\r?\n/);
  const points = [];
  let skipped = 0;
  let seenHeader = !hasHeader;
  for (let i = 0; i < lines.length && points.length < limit; i += 1) {
    if (isSkippable(lines[i])) continue;
    if (!seenHeader) { seenHeader = true; continue; }
    const fields = splitLine(lines[i], delimiter);
    const x = num(fields[mapping.lon]);
    const y = num(fields[mapping.lat]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { skipped += 1; continue; }
    const point = { x, y };
    if (mapping.elev >= 0) {
      const z = num(fields[mapping.elev]);
      point.z = Number.isFinite(z) ? z : 0;
    } else {
      point.z = 0;
    }
    if (mapping.magnitude >= 0) {
      const m = num(fields[mapping.magnitude]);
      // A non-numeric magnitude is null, not zero: zero is a reading and this
      // is the absence of one, and a ramp drawn through invented zeroes lies
      // about the bottom of its own scale.
      point.magnitude = Number.isFinite(m) ? m : null;
    }
    points.push(point);
  }
  return { points, skipped };
}

/* ── Attribute tables ─────────────────────────────────────────────────────── */

/**
 * The head of a VECTOR layer's attribute table.
 *
 * The same `.head()` the CSV importer shows, for data that arrived as geometry
 * rather than as rows. A BGS bedrock polygon carries **fifty-seven** columns and
 * only a handful describe the rock, so choosing which one to colour by without
 * seeing the values is guesswork — `lex_d` and `rcs_d` are the rock, `mslink`
 * and `objectid` are database plumbing, and nothing about the names says which
 * is which.
 *
 * Columns are ordered by how useful they are to colour by, which is a real
 * property of the column rather than a preference: a field with one value paints
 * the layer one colour, and a field with a value per feature paints a legend
 * nobody can read. `distinct` is what says so, and it is returned rather than
 * hidden so the picker can show it.
 */
export function attributeHead(features, { rows = 6, maxColumns = 80 } = {}) {
  const list = Array.isArray(features) ? features : [];
  if (!list.length) return { columns: [], rows: [], count: 0 };
  const columns = [];
  const seen = new Set();
  list.forEach((f) => {
    Object.keys(f?.properties || {}).forEach((key) => {
      if (seen.has(key) || seen.size >= maxColumns) return;
      seen.add(key);
      columns.push(key);
    });
  });
  // Counting distinct values stops at a cap, because a column with a value per
  // feature would otherwise build a 100,000-entry Set to prove it is useless.
  // `capped` says the number is a floor rather than a count -- reporting "201
  // values" for a column with 758 is a small lie, and the picker shows it.
  const DISTINCT_CAP = 200;
  const stats = columns.map((key) => {
    const values = new Set();
    let filled = 0;
    let capped = false;
    /**
     * Whether the column is NUMBERS, and the range if it is.
     *
     * The distinct count alone cannot tell a magnitude from an identifier:
     * `s1_mpa` has 193 values and `wsm_id` has 32,464, and both look like "too
     * many to colour by" to a picker that only counts. One of them is a
     * measurement that wants classes; the other is a name that wants nothing.
     * So the type is measured here, once, where the values are already being
     * walked, rather than each caller sampling a few rows and guessing.
     */
    let numeric = true;
    let min = Infinity;
    let max = -Infinity;
    list.forEach((f) => {
      const v = f?.properties?.[key];
      if (v === undefined || v === null || String(v).trim() === "") return;
      filled += 1;
      if (values.size < DISTINCT_CAP) values.add(String(v));
      else if (!values.has(String(v))) capped = true;
      if (!numeric) return;
      // Number("") is 0 and Number(" 12 ") is 12; the blank case is already
      // filtered above, and a padded number is still a number.
      const n = typeof v === "boolean" ? NaN : Number(v);
      if (!Number.isFinite(n)) { numeric = false; return; }
      if (n < min) min = n;
      if (n > max) max = n;
    });
    return {
      key,
      distinct: values.size,
      filled,
      capped,
      numeric: numeric && filled > 0,
      min: numeric && filled > 0 ? min : null,
      max: numeric && filled > 0 ? max : null,
    };
  });
  return {
    count: list.length,
    columns: stats,
    rows: list.slice(0, rows).map((f) => columns.map((key) => {
      const v = f?.properties?.[key];
      return v === undefined || v === null ? "" : String(v);
    })),
  };
}

/**
 * Which column is worth colouring by, best first.
 *
 * One distinct value is a constant and paints nothing; one per feature is an id
 * and paints noise. Between those, more classes is more informative, so the
 * score is the distinct count with both ends refused outright.
 */
export function rankColourFields(head, { maxClasses = 60 } = {}) {
  const total = head?.count || 0;
  return (head?.columns || [])
    .filter((c) => !c.capped && c.distinct > 1 && c.distinct <= maxClasses && c.distinct < total)
    .sort((a, b) => b.distinct - a.distinct)
    .map((c) => c.key);
}
