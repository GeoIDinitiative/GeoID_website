/**
 * Delimited text into named columns.
 *
 * The repo already splits lines in a few places, but each does it for one
 * purpose -- XYZ triples, point CSVs -- and none handles quoted fields or gives
 * columns names. The Plotter and the signal pages both need "pick a column by
 * its header", so that lives here once.
 */

/** Splits one line, honouring double quotes and doubled quotes inside them. */
export function splitLine(line, delimiter) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Guesses the delimiter from the header line: whichever splits it most. */
export function sniffDelimiter(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  candidates.forEach((d) => {
    const count = splitLine(first, d).length;
    if (count > bestCount) { bestCount = count; best = d; }
  });
  // A single column means nothing split; whitespace is the usual culprit.
  if (bestCount <= 1 && /\s/.test(first.trim())) return /\s+/;
  return best;
}

function split(line, delimiter) {
  return delimiter instanceof RegExp
    ? line.trim().split(delimiter).map((f) => f.trim())
    : splitLine(line, delimiter);
}

/**
 * @returns {{columns: string[], rows: string[][], numeric: boolean[]}}
 * Rows are kept as text; callers convert the columns they actually plot, so a
 * non-numeric label column does not poison the whole table.
 */
export function parseTable(text, { delimiter } = {}) {
  const sep = delimiter ?? sniffDelimiter(text);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return { columns: [], rows: [], numeric: [] };

  const first = split(lines[0], sep);
  // A header is a first row that is not all numbers. Files without one still
  // work; their columns are named by position.
  const looksNumeric = (v) => v !== "" && Number.isFinite(Number(v));
  const hasHeader = !first.every(looksNumeric);
  const columns = hasHeader
    ? first.map((name, i) => name || `col_${i + 1}`)
    : first.map((_, i) => `col_${i + 1}`);

  const rows = lines.slice(hasHeader ? 1 : 0).map((line) => split(line, sep));
  const numeric = columns.map((_, i) =>
    rows.length > 0 && rows.every((r) => r[i] === undefined || r[i] === "" || looksNumeric(r[i])));
  return { columns, rows, numeric };
}

/** One column as numbers, with unparseable cells dropped alongside their pair. */
export function column(table, name) {
  const index = table.columns.indexOf(name);
  if (index < 0) return [];
  return table.rows.map((r) => Number(r[index]));
}

/** Two columns as an aligned pair, skipping rows where either is not a number. */
export function columnPair(table, xName, yName) {
  const xi = table.columns.indexOf(xName);
  const yi = table.columns.indexOf(yName);
  const x = [];
  const y = [];
  if (xi < 0 || yi < 0) return { x, y };
  table.rows.forEach((row) => {
    const a = Number(row[xi]);
    const b = Number(row[yi]);
    if (Number.isFinite(a) && Number.isFinite(b)) { x.push(a); y.push(b); }
  });
  return { x, y };
}

/** Evenly spaced sample index, for files with no time column. */
export function indexSeries(n) {
  return Array.from({ length: n }, (_, i) => i);
}
