/**
 * The attribute table, in a window you can edit.
 *
 * A CSV somebody imports becomes points on the globe and then becomes
 * unreachable: the values are in the click card one feature at a time, and
 * the only way to correct a typo in a site name — or move a point by ten
 * metres, or add a column the analysis needs — was to fix the file outside
 * the app and import it again. This is the table that file deserved, opened
 * over the globe from the layer's own drawer.
 *
 * What it edits: every property of every feature, and for POINT layers the
 * latitude and longitude too, because a point's position is one of its
 * columns in every CSV it ever came from. Lines and polygons keep their
 * geometry — a ring is not something to retype in a grid — and only their
 * attributes are offered.
 *
 * Saving goes through `importFileList`, the ONE importer, exactly as the
 * catalogue and the drawing tools do. The alternative was to mutate the
 * layer's own collection and re-render it, which would have been a second
 * path into the renderer that only this window used and only this window
 * would keep working. The cost is that the edit is a NEW layer, so the
 * things somebody chose about the old one — visibility, opacity, its data
 * tag and note — are carried across by hand; that is the rebuild rule the
 * tiled geology already documents.
 */

import { splitLine } from "./delimited.js?v=20260901-7091869";

const byId = (id) => document.getElementById(id);

/** How many rows the grid will draw. Beyond this it is a file, not a table. */
const MAX_ROWS = 2000;

let editing = null;   // { layer, columns, rows, geo }

/* ── What can be edited ──────────────────────────────────────────────────── */

/**
 * A layer this window can usefully open: it has features with attributes.
 * Rasters have no rows, and a tiled catalogue layer is somebody else's data
 * that this app re-fetches — editing it would be edited away on the next tick.
 */
export function isEditable(layer) {
  if (!layer || layer.status !== "loaded") return false;
  if (layer.ext === "tiles" || layer.ext === "gee") return false;
  // A CSV or XYZ keeps its own text, and that is the better thing to edit:
  // the point reader keeps x/y/z and drops every other column, so the
  // features it produced know less than the file does.
  if (typeof layer.source?.text === "string") return true;
  if (layer.raster) return false;
  return Array.isArray(layer.collection?.features) && layer.collection.features.length > 0;
}

/* ── The delimited kind: a CSV edited as the grid it already is ──────────── */

/**
 * The file's own rows, every column of them.
 *
 * Parsed here rather than reusing `parseRows`, which answers in the point
 * reader's vocabulary (x, y, z, magnitude) and has already thrown away the
 * columns this window exists to show.
 */
export function gridFrom(source) {
  const lines = String(source?.text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { columns: [], rows: [], header: false };
  const delimiter = source.delimiter || ",";
  const cells = lines.map((line) => splitLine(line, delimiter));
  const header = source.hasHeader !== false;
  const width = cells.reduce((n, row) => Math.max(n, row.length), 0);
  const columns = header
    ? Array.from({ length: width }, (_, i) => cells[0][i] ?? `column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `column ${i + 1}`);
  const rows = (header ? cells.slice(1) : cells)
    .slice(0, MAX_ROWS)
    .map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
  const tail = (header ? cells.slice(1) : cells).slice(MAX_ROWS);
  return { columns, rows, header, delimiter, tail, truncated: tail.length };
}

/**
 * Back to a delimited file. Quoting is applied only where it is needed —
 * a value carrying the delimiter, a quote or a newline — so a file that
 * arrived unquoted goes back out looking like itself.
 */
export function textFrom({ columns, rows, header, delimiter = ",", tail = [] }) {
  const quote = (value) => {
    const text = String(value ?? "");
    return /["\n\r]/.test(text) || text.includes(delimiter)
      ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const out = [];
  if (header) out.push(columns.map(quote).join(delimiter));
  rows.forEach((row) => out.push(row.map(quote).join(delimiter)));
  tail.forEach((row) => out.push(row.map(quote).join(delimiter)));
  return `${out.join("\n")}\n`;
}

/** Point layers get their coordinates as columns; everything else does not. */
function pointLayer(collection) {
  const features = collection?.features || [];
  return features.length > 0 && features.every((f) => f?.geometry?.type === "Point");
}

/**
 * Properties the app writes for itself, kept OUT of the grid.
 *
 * `data-tags.js` mirrors a layer's classification into the first feature's
 * properties so a saved project brings it back with the file. They are real
 * properties and they are not the user's columns: the drawer has the control
 * that owns them, and two places to edit one value is how they drift. Hidden
 * here, carried through a save untouched.
 */
const INTERNAL_KEYS = new Set(["data_type", "data_note"]);

/** The union of every feature's property keys, in first-seen order. */
function columnsOf(features) {
  const seen = [];
  const known = new Set();
  features.forEach((feature) => {
    Object.keys(feature?.properties || {}).forEach((key) => {
      if (INTERNAL_KEYS.has(key) || known.has(key)) return;
      known.add(key);
      seen.push(key);
    });
  });
  return seen;
}

/**
 * The table as plain data — pure, so the round trip can be tested without a
 * document. Row 0 is the first feature; `lat`/`lon` are present only for
 * point layers, and always first, because that is where a CSV puts them.
 */
export function tableFrom(collection) {
  const features = collection?.features || [];
  const geo = pointLayer(collection);
  const columns = columnsOf(features);
  const rows = features.slice(0, MAX_ROWS).map((feature) => {
    const row = { props: { ...(feature.properties || {}) } };
    if (geo) {
      const [lon, lat] = feature.geometry?.coordinates || [];
      row.lon = Number.isFinite(lon) ? lon : "";
      row.lat = Number.isFinite(lat) ? lat : "";
    } else {
      /**
       * The geometry rides ON THE ROW, never looked up by index later.
       *
       * A line or polygon is not retyped in a grid, so its shape has to be
       * carried through the edit — and carrying it by position would hand
       * row 3's outline to row 2 the moment somebody deletes a row above it.
       * Silently: every attribute right, every shape one place out.
       */
      row.geometry = feature.geometry;
    }
    return row;
  });
  // Anything past the cap is not drawn and not edited — but it IS kept, or a
  // save would quietly delete the part of the layer nobody could see.
  const tail = features.slice(MAX_ROWS);
  return { geo, columns, rows, tail, truncated: tail.length };
}

/**
 * Back to GeoJSON. A row whose coordinates are not numbers is DROPPED rather
 * than written at 0°N 0°E — the Gulf of Guinea is where every bad coordinate
 * in this codebase has ended up, and a silently placed point is worse than a
 * missing one. The count of what went is reported to the person saving.
 */
/**
 * A coordinate, or NaN if the cell is empty.
 *
 * `Number("")` is ZERO, not NaN — so a blank latitude passes `isFinite` and
 * the point is written at 0°N 0°E, in the Gulf of Guinea. This codebase has
 * been there once already, with a station list whose blank rows came back as
 * real stations in the Atlantic. An emptied cell means "no coordinate".
 */
function coordinate(value) {
  const text = String(value ?? "").trim();
  return text === "" ? NaN : Number(text);
}

export function collectionFrom({ geo, columns, rows, tail = [] }) {
  const kept = [];
  let dropped = 0;
  rows.forEach((row) => {
    const properties = {};
    // Anything the grid did not show — the app's own bookkeeping — rides
    // through untouched rather than being dropped by a save.
    Object.keys(row.props || {}).forEach((key) => {
      if (INTERNAL_KEYS.has(key)) properties[key] = row.props[key];
    });
    columns.forEach((key) => {
      const value = row.props[key];
      if (value === undefined) return;
      // Numbers that arrived as numbers go back as numbers: a column read as
      // text sorts and classes as text, and the symbology dialog would then
      // refuse to grade it.
      const asNumber = Number(value);
      properties[key] = (value !== "" && Number.isFinite(asNumber) && String(value).trim() !== "")
        ? asNumber : value;
    });
    let geometry;
    if (geo) {
      const lon = coordinate(row.lon);
      const lat = coordinate(row.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) { dropped += 1; return; }
      geometry = { type: "Point", coordinates: [lon, lat] };
    } else {
      // A row added by hand to a line or polygon layer has no shape to give
      // it, so it is dropped rather than written as a feature with no
      // geometry — which parses, draws nothing, and counts as data.
      geometry = row.geometry;
      if (!geometry) { dropped += 1; return; }
    }
    kept.push({ type: "Feature", geometry, properties });
  });
  return {
    collection: { type: "FeatureCollection", features: [...kept, ...tail] },
    dropped,
  };
}

/* ── The window ──────────────────────────────────────────────────────────── */

const STYLE = `
#gis-table-backdrop {
  position: fixed; inset: 0; z-index: 70; display: flex;
  align-items: center; justify-content: center; padding: 1.4rem;
  background: rgba(4, 3, 10, 0.72);
}
#gis-table-backdrop[hidden] { display: none !important; }
#gis-table-card {
  width: min(64rem, 100%); height: min(42rem, calc(100vh - 3rem));
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: 12px; background: rgba(12, 10, 22, 0.98);
  border: 1px solid rgba(var(--nav-accent-rgb), 0.45);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6); color: var(--text, #eaf6fb);
}
#gis-table-card .tbl-head {
  display: flex; align-items: baseline; gap: 0.8rem;
  padding: 0.7rem 0.9rem; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
#gis-table-card .tbl-title {
  font: 600 0.8rem/1.2 'Exo 2', sans-serif;
  letter-spacing: 0.08em; text-transform: uppercase;
}
#gis-table-card .tbl-sub { font: 400 0.66rem/1.3 'Exo 2', sans-serif; opacity: 0.7; }
#gis-table-card .tbl-head .button { margin-left: auto; }
#gis-table-body { flex: 1; min-height: 0; overflow: auto; }
/* No white scrollbars: the standard pair carries modern Chrome and Firefox,
   the webkit pseudos carry Safari, both in the panel cyan so it does not
   matter which answers -- the events panel's documented discipline. */
#gis-table-body {
  scrollbar-width: thin;
  scrollbar-color: rgba(82, 228, 232, 0.38) transparent;
}
#gis-table-body::-webkit-scrollbar { width: 8px; height: 8px; }
#gis-table-body::-webkit-scrollbar-thumb { background: rgba(82, 228, 232, 0.38); border-radius: 4px; }
#gis-table-body::-webkit-scrollbar-track { background: transparent; }

/* No white scrollbars: the standard pair carries modern Chrome and Firefox,
   the webkit pseudos carry Safari, both in the panel cyan so it does not
   matter which answers -- the events panel's documented discipline. */
#gis-table-body {
  scrollbar-width: thin;
  scrollbar-color: rgba(82, 228, 232, 0.38) transparent;
}
#gis-table-body::-webkit-scrollbar { width: 8px; height: 8px; }
#gis-table-body::-webkit-scrollbar-thumb { background: rgba(82, 228, 232, 0.38); border-radius: 4px; }
#gis-table-body::-webkit-scrollbar-track { background: transparent; }

#gis-table-body table { border-collapse: collapse; width: max-content; min-width: 100%; }
#gis-table-body th, #gis-table-body td {
  border: 1px solid rgba(255, 255, 255, 0.09); padding: 0; white-space: nowrap;
}
#gis-table-body th {
  position: sticky; top: 0; z-index: 1;
  background: rgb(24, 13, 47);
  font: 600 0.6rem/2.1 'Exo 2', sans-serif; letter-spacing: 0.07em;
  text-transform: uppercase; padding: 0 0.5rem; text-align: left;
}
#gis-table-body th.is-geo { color: var(--skin-data, #7ee7ff); }
#gis-table-body td input {
  width: 100%; min-width: 6.5rem; border: 0; background: transparent;
  color: inherit; font: 400 0.72rem/1.9 'Exo 2', sans-serif;
  padding: 0 0.5rem; color-scheme: dark;
}
#gis-table-body td input:focus {
  outline: 0; background: rgba(var(--nav-accent-rgb), 0.16);
}
#gis-table-body tr:nth-child(even) td { background: rgba(255, 255, 255, 0.02); }
#gis-table-body td.tbl-rownum {
  padding: 0 0.45rem; font: 400 0.58rem/1.9 'Exo 2', sans-serif;
  opacity: 0.5; text-align: right; background: rgb(16, 7, 36);
  position: sticky; left: 0;
}
#gis-table-body th.tbl-rownum { position: sticky; left: 0; z-index: 2; }
#gis-table-body td.tbl-drop { padding: 0 0.2rem; }
#gis-table-body td.tbl-drop button {
  border: 0; background: transparent; color: inherit; opacity: 0.5;
  cursor: pointer; font-size: 0.75rem; line-height: 1.9; padding: 0 0.3rem;
}
#gis-table-body td.tbl-drop button:hover { opacity: 1; color: #ff5c4d; }
#gis-table-foot {
  display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;
  padding: 0.6rem 0.9rem; border-top: 1px solid rgba(255, 255, 255, 0.1);
}
#gis-table-note { font: 400 0.64rem/1.4 'Exo 2', sans-serif; opacity: 0.78; flex: 1 1 12rem; }
`;

function ensureStyle() {
  if (byId("gis-table-editor-style")) return;
  const tag = document.createElement("style");
  tag.id = "gis-table-editor-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/**
 * One window on the page, found by ID rather than held in a variable — the
 * symbology dialog's lesson: modules load from cache-busted URLs, so a second
 * query string is a second instance with its own private backdrop under the
 * same id, and `getElementById` then answers with whichever came first.
 */
function ensureCard() {
  ensureStyle();
  let backdrop = byId("gis-table-backdrop");
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "gis-table-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = [
    '<div id="gis-table-card" role="dialog" aria-label="Edit the layer’s table">',
    '<div class="tbl-head">',
    '<span class="tbl-title" id="gis-table-title">Table</span>',
    '<span class="tbl-sub" id="gis-table-sub"></span>',
    '<button id="gis-table-close" class="button secondary" type="button">Close</button>',
    "</div>",
    '<div id="gis-table-body"></div>',
    '<div id="gis-table-foot">',
    '<button id="gis-table-add-row" class="button secondary" type="button">+ Row</button>',
    '<button id="gis-table-add-col" class="button secondary" type="button">+ Column</button>',
    '<span id="gis-table-note"></span>',
    '<button id="gis-table-save" class="button primary" type="button">Save changes</button>',
    "</div></div>",
  ].join("");
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  byId("gis-table-close").addEventListener("click", close);
  byId("gis-table-add-row").addEventListener("click", addRow);
  byId("gis-table-add-col").addEventListener("click", addColumn);
  byId("gis-table-save").addEventListener("click", save);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !byId("gis-table-backdrop")?.hidden) close();
  });
  return backdrop;
}

function note(message) {
  const node = byId("gis-table-note");
  if (node) node.textContent = message || "";
}

function close() {
  const backdrop = byId("gis-table-backdrop");
  if (backdrop) backdrop.hidden = true;
  editing = null;
}

function draw() {
  const host = byId("gis-table-body");
  if (!host || !editing) return;
  if (editing.delimited) { drawGrid(host); return; }
  const { geo, columns, rows } = editing;
  const table = document.createElement("table");

  const head = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "tbl-rownum";
  corner.textContent = "#";
  head.appendChild(corner);
  const heads = [...(geo ? ["lat", "lon"] : []), ...columns];
  heads.forEach((key) => {
    const cell = document.createElement("th");
    cell.textContent = key;
    if (geo && (key === "lat" || key === "lon")) cell.className = "is-geo";
    head.appendChild(cell);
  });
  head.appendChild(document.createElement("th"));
  table.appendChild(head);

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const num = document.createElement("td");
    num.className = "tbl-rownum";
    num.textContent = String(index + 1);
    tr.appendChild(num);
    heads.forEach((key) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      const isGeo = geo && (key === "lat" || key === "lon");
      input.value = isGeo ? row[key] : (row.props[key] ?? "");
      input.addEventListener("input", () => {
        if (isGeo) row[key] = input.value;
        else row.props[key] = input.value;
      });
      td.appendChild(input);
      tr.appendChild(td);
    });
    const drop = document.createElement("td");
    drop.className = "tbl-drop";
    const button = document.createElement("button");
    button.type = "button";
    button.title = "Delete this row";
    button.textContent = "✕";
    button.addEventListener("click", () => {
      editing.rows.splice(index, 1);
      draw();
      note(`${editing.rows.length} row${editing.rows.length === 1 ? "" : "s"} — not saved yet.`);
    });
    drop.appendChild(button);
    tr.appendChild(drop);
    table.appendChild(tr);
  });

  host.innerHTML = "";
  host.appendChild(table);
}

/** The delimited grid: no geometry columns, because the file names its own. */
function drawGrid(host) {
  const { columns, rows } = editing;
  const table = document.createElement("table");
  const head = document.createElement("tr");
  const corner = document.createElement("th");
  corner.className = "tbl-rownum";
  corner.textContent = "#";
  head.appendChild(corner);
  columns.forEach((name) => {
    const cell = document.createElement("th");
    cell.textContent = name;
    head.appendChild(cell);
  });
  head.appendChild(document.createElement("th"));
  table.appendChild(head);
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const num = document.createElement("td");
    num.className = "tbl-rownum";
    num.textContent = String(index + 1);
    tr.appendChild(num);
    columns.forEach((_, col) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.value = row[col] ?? "";
      input.addEventListener("input", () => { row[col] = input.value; });
      td.appendChild(input);
      tr.appendChild(td);
    });
    const drop = document.createElement("td");
    drop.className = "tbl-drop";
    const button = document.createElement("button");
    button.type = "button";
    button.title = "Delete this row";
    button.textContent = "✕";
    button.addEventListener("click", () => {
      editing.rows.splice(index, 1);
      draw();
      note(`${editing.rows.length} row${editing.rows.length === 1 ? "" : "s"} — not saved yet.`);
    });
    drop.appendChild(button);
    tr.appendChild(drop);
    table.appendChild(tr);
  });
  host.innerHTML = "";
  host.appendChild(table);
}

function addRow() {
  if (editing?.delimited) {
    editing.rows.push(editing.columns.map(() => ""));
    draw();
    note("Row added — give it a coordinate before saving.");
    return;
  }
  if (!editing) return;
  const row = { props: {} };
  editing.columns.forEach((key) => { row.props[key] = ""; });
  if (editing.geo) { row.lat = ""; row.lon = ""; }
  editing.rows.push(row);
  draw();
  note("Row added — give it a coordinate before saving.");
}

function addColumn() {
  if (!editing) return;
  const name = window.prompt("Column name");
  if (!name) return;
  const key = String(name).trim();
  if (!key || editing.columns.includes(key)) {
    note(key ? `There is already a column called “${key}”.` : "");
    return;
  }
  editing.columns.push(key);
  if (editing.delimited) {
    editing.rows.forEach((row) => row.push(""));
    editing.tail?.forEach((row) => row.push(""));
  } else {
    editing.rows.forEach((row) => { row.props[key] = ""; });
  }
  draw();
}

/**
 * Save: through `importFileList`, then carry across what somebody chose about
 * the old layer and take it off the globe. The order matters — the new layer
 * is added BEFORE the old is removed, so an import that fails leaves the
 * original standing rather than nothing at all.
 */
async function save() {
  if (!editing) return;
  const manager = window.GeoIDImportManager;
  const layer = editing.layer;
  /**
   * A delimited layer goes back out AS A FILE OF THE SAME KIND, re-read by
   * the same reader with the same column mapping. Saving it as GeoJSON would
   * quietly change what the layer IS — a point cloud becoming a feature
   * collection, drawn differently, sampled differently — on an edit that was
   * only ever about the numbers in it.
   */
  let file;
  let dropped = 0;
  let saved;
  if (editing.delimited) {
    if (!editing.rows.length) {
      note("Nothing to save — the table is empty.");
      return;
    }
    file = new File([textFrom(editing)], `${layer.name}.csv`, { type: "text/csv" });
    saved = editing.rows.length + (editing.tail?.length || 0);
  } else {
    const out = collectionFrom(editing);
    dropped = out.dropped;
    if (!out.collection.features.length) {
      note("Nothing to save — every row is missing its coordinates.");
      return;
    }
    file = new File([JSON.stringify(out.collection)], `${layer.name}.geojson`,
      { type: "application/geo+json" });
    saved = out.collection.features.length;
  }
  const button = byId("gis-table-save");
  button?.setAttribute("disabled", "");
  note("Saving…");
  try {
    const before = new Set((manager?.getLayers?.() || []).map((l) => l.id));
    // frame: false — the layer is already where the user is looking, and
    // flying the camera to its bounds on a save moves the very view the edit
    // was made in. `columns` carries the mapping the file was READ with, or
    // the reader would re-guess and a hand-chosen lat/lon pairing would be
    // silently undone by a save that changed nothing else.
    await manager?.importFileList?.([file], {
      name: layer.name,
      frame: false,
      ...(editing.delimited && layer.source?.mapping
        ? { columns: layer.source.mapping } : {}),
    });
    const added = (manager?.getLayers?.() || []).filter((l) => !before.has(l.id));
    added.forEach((next) => {
      // A rebuild is a new layer object, so what was chosen about the old one
      // has to be carried: the tiled geology's rule, applied here.
      next.userInput = layer.userInput === true;
      if (layer.dataType) next.dataType = layer.dataType;
      if (layer.description) next.description = layer.description;
      if (layer.opacity !== undefined) next.opacity = layer.opacity;
      if (layer.metadata) next.metadata = { ...layer.metadata };
      if (layer.visible === false && next.object3D) {
        next.visible = false;
        next.object3D.visible = false;
      }
    });
    if (added.length) manager?.removeLayer?.(layer.id);
    window.dispatchEvent(new CustomEvent("geoid-gis:layers-changed"));
    window.GeoIDLayerHierarchy?.render?.();
    note(`Saved ${saved} row${saved === 1 ? "" : "s"}`
      + (dropped ? ` · ${dropped} dropped for a missing coordinate` : "") + ".");
    close();
  } catch (error) {
    note(`Could not save: ${error.message}`);
  } finally {
    button?.removeAttribute("disabled");
  }
}

/** Open the table for a layer. */
export function openTableEditor(layer) {
  if (!isEditable(layer)) return;
  const backdrop = ensureCard();
  const delimited = typeof layer.source?.text === "string";
  const built = delimited ? gridFrom(layer.source) : tableFrom(layer.collection);
  editing = { layer, delimited, ...built };
  byId("gis-table-title").textContent = layer.name || "Table";
  const count = delimited ? built.rows.length + built.truncated
    : layer.collection.features.length;
  byId("gis-table-sub").textContent = `${count.toLocaleString()} row`
    + `${count === 1 ? "" : "s"} · ${built.columns.length} column`
    + `${built.columns.length === 1 ? "" : "s"} · `
    + (delimited ? "the file as it came, every column editable"
      : built.geo ? "point layer, coordinates editable"
        : "geometry is not editable here");
  note(built.truncated
    ? `Showing the first ${MAX_ROWS.toLocaleString()} rows; `
      + `${built.truncated.toLocaleString()} more are kept as they are.`
    : "");
  draw();
  backdrop.hidden = false;
}

if (typeof window !== "undefined") {
  window.GeoIDTableEditor = { open: openTableEditor, isEditable };
}
