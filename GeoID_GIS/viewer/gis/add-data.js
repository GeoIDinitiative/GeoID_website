/**
 * One Add-data dialog, opened from wherever data belongs.
 *
 * What this replaces: a single "Data · Import" tab, which is where you went to
 * add anything at all. That is a filing cabinet rather than a workflow — you
 * were adding a basemap, or a geology map, or a shapefile, and the panel about
 * that thing had no way to accept one. So the tab is gone and each panel that
 * owns a kind of data carries a **+ Add** of its own, all of them opening this.
 *
 * The context travels with the click (`ROLES` below): which panel asked, what
 * it will accept, what the layer should be called. Everything else is the same
 * dialog, because a CRS is a CRS and a column is a column whichever panel you
 * came from — and one dialog is one place to fix a bug in.
 *
 * **The buttons are injected, not written into markup.** `basemap-relief-section`
 * and `geology-section` live in Earth's `index.html` AND in `gis/shell.html`,
 * so writing a button into the markup means editing eleven files and watching
 * them drift — the failure this codebase has paid for six times. One module
 * finds the panels by id and gives each the same affordance, on all ten worlds.
 *
 * Three things the old importer could not do, and this can:
 *
 * - **CRS is answered per import, for every format.** New data always has
 *   coordinates and they always mean something; the old path guessed from a
 *   `.prj` when one happened to be there and silently assumed WGS84 otherwise.
 * - **CSV columns are chosen, not guessed.** The head of the file is on screen
 *   with the proposed mapping already applied, so a wrong guess is visible
 *   before the import rather than discovered as a layer in the wrong ocean.
 * - **Symbology is set on the way in**, rather than found afterwards in another
 *   panel and applied to something already drawn wrongly.
 */

import { CRS_OPTIONS } from "./projection.js?v=20260830-8d45139";
import { readHead, validateMapping } from "./delimited.js?v=20260830-8d45139";
import { RAMP_NAMES } from "./symbology.js?v=20260830-8d45139";
import { isEarth } from "./bodies.js?v=20260830-8d45139";
import { DATA_TYPES, inferType, applyTag, markUserInput, suppressNextArrival } from "./data-tags.js?v=20260830-8d45139";

/* ── Where data belongs ──────────────────────────────────────────────────────
 *
 * `panel` is the element the + Add is injected into. `accept` narrows the file
 * picker to what that panel can actually use — offering a mesh under Geology
 * would be a promise the import cannot keep.
 */
const ROLES = [
  {
    /**
     * THE master doorway — the Workspace box's + Data. The per-tab + Data
     * and + GEE rows are gone (see init): one place where user data comes
     * in, which is what the Workspace box exists to be. Its accept list is
     * therefore the UNION of every old role's — the per-tab narrowing was
     * the one thing those buttons did that this one must not lose — and
     * `takeFiles` flips the CRS default to "none" when the chosen files
     * are meshes, which was the mesh role's other job.
     */
    id: "vector",
    panel: "gis-group-polygons",
    title: "Add data",
    hint: "Vectors, rasters or meshes — shapefile, GeoJSON, KML, GPX, CSV/XYZ, GeoTIFF, ASCII grid, STL, Gmsh, OBJ, PLY",
    accept: ".shp,.dbf,.shx,.prj,.geojson,.json,.kml,.gpx,.wkt,.csv,.xyz,.pts,.txt,"
      + ".tif,.tiff,.asc,.png,.jpg,.jpeg,.tfw,.pgw,.jgw,.stl,.msh,.obj,.ply",
  },
  {
    id: "basemap",
    panel: "basemap-relief-section",
    title: "Add a basemap or relief layer",
    hint: "GeoTIFF, ASCII grid, or an image with a world file",
    accept: ".tif,.tiff,.asc,.png,.jpg,.jpeg,.prj,.tfw,.pgw,.jgw",
  },
  {
    id: "geology",
    panel: "geology-section",
    title: "Add a geology layer",
    hint: "Shapefile or GeoJSON of mapped units, or a classified raster",
    accept: ".shp,.dbf,.shx,.prj,.geojson,.json,.kml,.tif,.tiff",
  },
  {
    id: "hydrology",
    panel: "sea-level-section",
    title: "Add a hydrology layer",
    hint: "Rivers, coastlines, basins — shapefile, GeoJSON, KML, points or a raster",
    accept: ".shp,.dbf,.shx,.prj,.geojson,.json,.kml,.gpx,.csv,.xyz,.tif,.tiff",
  },
  {
    id: "atmosphere",
    panel: "gis-group-modelled",
    title: "Add an atmospheric dataset",
    hint: "Gridded rasters or station vectors — GeoTIFF, ASCII grid, GeoJSON, CSV",
    accept: ".tif,.tiff,.asc,.png,.jpg,.jpeg,.prj,.tfw,.geojson,.json,.csv",
  },
  {
    id: "geohazards",
    panel: "modelled-data-section",
    title: "Add a hazard layer",
    hint: "Susceptibility or hazard maps — GeoTIFF, ASCII grid, shapefile or GeoJSON",
    accept: ".tif,.tiff,.asc,.shp,.dbf,.shx,.prj,.geojson,.json,.kml",
  },
  {
    id: "mesh",
    // Its own tab: a mesh is not a GIS layer and does not belong under any of
    // the three above. Built by `ensureMeshGroup()` rather than added to the
    // shared markup, for the same eleven-files reason.
    panel: "gis-group-mesh",
    title: "Add a mesh model",
    hint: "STL, Gmsh (.msh), OBJ or PLY",
    accept: ".stl,.msh,.obj,.ply",
  },
];

const roleById = (id) => ROLES.find((r) => r.id === id) || ROLES[0];

/** Formats whose columns the user can choose. */
const DELIMITED = new Set(["csv", "xyz", "pts", "txt", "tsv"]);
const extensionOf = (name) => String(name).split(".").pop().toLowerCase();
const isDelimited = (file) => DELIMITED.has(extensionOf(file?.name || ""));

/* ── Style ───────────────────────────────────────────────────────────────── */

const STYLE = `
#gis-add-data-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(4, 3, 10, 0.72);
}
#gis-add-data-backdrop[hidden] { display: none !important; }
#gis-add-data {
  width: min(38rem, 100%);
  max-height: calc(100vh - 3rem);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(12, 10, 22, 0.98);
  border: 1px solid rgba(var(--nav-accent-rgb), 0.45);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
}
#gis-add-data .add-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.7rem 0.9rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
#gis-add-data .add-title {
  font: 600 0.8rem/1.2 'Exo 2', sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
#gis-add-data .add-hint {
  font: 400 0.66rem/1.3 'Exo 2', sans-serif;
  opacity: 0.7;
}
#gis-add-data .add-body {
  padding: 0.8rem 0.9rem;
  overflow-y: auto;
  min-height: 0;
}
/* No white scrollbars: the standard pair carries modern Chrome and Firefox,
   the webkit pseudos carry Safari, both in the panel cyan so it does not
   matter which answers -- the events panel's documented discipline. */
#gis-add-data .add-body {
  scrollbar-width: thin;
  scrollbar-color: rgba(82, 228, 232, 0.38) transparent;
}
#gis-add-data .add-body::-webkit-scrollbar { width: 8px; height: 8px; }
#gis-add-data .add-body::-webkit-scrollbar-thumb { background: rgba(82, 228, 232, 0.38); border-radius: 4px; }
#gis-add-data .add-body::-webkit-scrollbar-track { background: transparent; }

#gis-add-data .add-foot {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.65rem 0.9rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
#gis-add-data fieldset {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 0.6rem 0.7rem 0.7rem;
  margin: 0 0 0.7rem;
}
#gis-add-data legend {
  padding: 0 0.35rem;
  font: 600 0.62rem/1 'Exo 2', sans-serif;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--skin-data, #7ee7ff);
}
#gis-add-data .add-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.35rem 0 0;
}
#gis-add-data .add-row > label {
  flex: 0 0 8.5rem;
  font: 500 0.66rem/1.25 'Exo 2', sans-serif;
  color: var(--skin-data, #7ee7ff);
}
#gis-add-data .add-row .input { flex: 1 1 auto; min-width: 0; }
#gis-add-data .drop-zone {
  display: block;
  width: 100%;
  padding: 1.1rem 0.8rem;
  border: 1px dashed rgba(var(--nav-accent-rgb), 0.5);
  border-radius: 8px;
  background: rgba(var(--nav-accent-rgb), 0.06);
  text-align: center;
  cursor: pointer;
  font: 400 0.72rem/1.4 'Exo 2', sans-serif;
}
#gis-add-data .drop-zone.is-over {
  background: rgba(var(--nav-accent-rgb), 0.18);
  border-style: solid;
}
#gis-add-data .head-table-wrap { overflow-x: auto; margin-top: 0.4rem; }
#gis-add-data table.head-table {
  border-collapse: collapse;
  font: 400 0.62rem/1.3 'Exo 2', sans-serif;
  width: max-content;
  min-width: 100%;
}
#gis-add-data .head-table th,
#gis-add-data .head-table td {
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0.2rem 0.42rem;
  white-space: nowrap;
  text-align: left;
}
#gis-add-data .head-table th {
  color: var(--skin-data, #7ee7ff);
  font-weight: 600;
}
/* A column that has been given a meaning is tinted, so the table itself shows
   the mapping rather than making the eye check four dropdowns against it. */
#gis-add-data .head-table .is-mapped { background: rgba(var(--nav-accent-rgb), 0.16); }
#gis-add-data .add-note {
  margin: 0.45rem 0 0;
  font: 400 0.64rem/1.35 'Exo 2', sans-serif;
  opacity: 0.8;
}
#gis-add-data .add-note.is-warning { color: #ffb454; opacity: 1; }
#gis-add-data .add-note:empty { display: none; }
.gis-add-button {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0 0 0.5rem;
}
.gis-add-row { display: flex; gap: 0.6rem; align-items: stretch; margin: 0.2rem 0 0.7rem; }
/* Icon buttons in the Workspace header: small squares pinned right, names
   in the tooltip. */
.layer-dock-head .gis-add-row-icons {
  margin: 0 0 0 auto;
  gap: 0.28rem;
  align-items: center;
}
/* The head's right-hand caret is gone — it leads on the left as a chevron
   now, like every tab — so the icon row is the only thing claiming the
   slack and nothing has to be held back from it. */
.layer-dock-head .gis-add-row-icons .button {
  flex: 0 0 auto;
  width: 1.55rem;
  height: 1.55rem;
  min-height: 0;
  padding: 0.28rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.38rem;
}
.layer-dock-head .gis-add-row-icons .button svg { width: 100%; height: 100%; display: block; }
.gis-add-row .button {
  flex: 1 1 0;
  justify-content: center;
  margin: 0;
  padding: 0.42rem 0.6rem;
}
/* The third doorway wears its own colour — amber, against the magenta add
   and the cyan GEE — with !important because the skin paints .button's
   border and colour with !important of its own. */
.gis-add-row .gis-custom-button {
  border-color: rgba(255, 180, 84, 0.55) !important;
  color: #ffb454 !important;
  background: rgba(255, 180, 84, 0.08);
}
.gis-add-row .gis-custom-button:hover {
  border-color: #ffb454 !important;
  color: #ffd9a8 !important;
  box-shadow: 0 0 14px -2px rgba(255, 180, 84, 0.55) !important;
}
`;

function installStyle() {
  if (document.getElementById("gis-add-data-style")) return;
  const tag = document.createElement("style");
  tag.id = "gis-add-data-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}


/**
 * Which of the two symbology controls this file will actually use.
 *
 * A raster or a point set with a value to grade takes the RAMP; a polygon layer
 * with nothing to grade takes the flat COLOUR. The dialog offers both because
 * only the file settles it, and saying which one applies is the difference
 * between a control and a decoration.
 */
const GRADED_EXTENSIONS = new Set(["tif", "tiff", "asc"]);

function symbologyModeFor() {
  const file = state.files.find((f) => !["prj", "dbf", "shx", "tfw", "pgw", "jgw"]
    .includes(extensionOf(f.name)));
  if (!file) return null;
  if (GRADED_EXTENSIONS.has(extensionOf(file.name))) return "ramp";
  if (state.mapping) {
    return (state.mapping.elev >= 0 || state.mapping.magnitude >= 0) ? "ramp" : "colour";
  }
  return "colour";
}

function describeSymbology() {
  if (!ui) return;
  const mode = symbologyModeFor();
  /**
   * A raster is not symbolised here.
   *
   * Choosing a ramp for it at import time is a decision made before you have
   * seen the data, and the thing you actually want -- five classes, their
   * thresholds, one of them recoloured by hand -- is what the symbology panel
   * does. Offering a single ramp here implied that was the whole choice.
   */
  ui.symSet.hidden = mode === "ramp" && !state.mapping;
  if (ui.symSet.hidden) {
    ui.symNote.textContent = "";
    return;
  }
  // The irrelevant control is HIDDEN, not merely disclaimed: a ramp row
  // under a flat-colour vector was the dialog asking a question it had just
  // said it would ignore.
  ui.colourRow.hidden = mode === "ramp";
  ui.rampRow.hidden = mode === "colour";
  ui.symNote.textContent = mode === "ramp"
    ? "This layer has values to grade, so the ramp applies."
    : mode === "colour"
      ? "Nothing here to grade, so the flat colour applies."
      : "";
}

/* ── State ───────────────────────────────────────────────────────────────── */

let backdrop = null;
let ui = null;
const state = { role: ROLES[0], files: [], head: null, mapping: null, dtypeTouched: false };

function say(message, warning = false) {
  if (!ui?.note) return;
  ui.note.textContent = message || "";
  ui.note.classList.toggle("is-warning", Boolean(warning) && Boolean(message));
}

/* ── Building ────────────────────────────────────────────────────────────── */

function row(labelText, control) {
  const wrap = document.createElement("div");
  wrap.className = "add-row";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.append(label, control);
  return wrap;
}

function select(options, value) {
  const el = document.createElement("select");
  el.className = "input";
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = String(opt.value);
    o.textContent = opt.label;
    if (String(opt.value) === String(value)) o.selected = true;
    el.appendChild(o);
  });
  return el;
}

function build() {
  installStyle();
  backdrop = document.createElement("div");
  backdrop.id = "gis-add-data-backdrop";
  backdrop.hidden = true;

  const card = document.createElement("div");
  card.id = "gis-add-data";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const head = document.createElement("div");
  head.className = "add-head";
  const titles = document.createElement("div");
  const title = document.createElement("div");
  title.className = "add-title";
  const hint = document.createElement("div");
  hint.className = "add-hint";
  titles.append(title, hint);
  const shut = document.createElement("button");
  shut.type = "button";
  shut.className = "button";
  shut.textContent = "×";
  shut.setAttribute("aria-label", "Close");
  Object.assign(shut.style, { padding: "0 0.45rem", minWidth: "0", lineHeight: "1" });
  shut.addEventListener("click", close);
  head.append(titles, shut);

  const body = document.createElement("div");
  body.className = "add-body";

  // ── File ──
  const fileSet = document.createElement("fieldset");
  const fileLegend = document.createElement("legend");
  fileLegend.textContent = "File";
  const drop = document.createElement("label");
  drop.className = "drop-zone";
  drop.textContent = "Drop files here, or click to browse";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  drop.appendChild(fileInput);
  const chosen = document.createElement("p");
  chosen.className = "add-note";
  fileSet.append(fileLegend, drop, chosen);

  // ── Coordinates ──
  const crsSet = document.createElement("fieldset");
  const crsLegend = document.createElement("legend");
  crsLegend.textContent = "Coordinates";
  const crs = select(CRS_OPTIONS.map((o) => ({ value: o.id, label: o.label })), "epsg:4326");
  const crsNote = document.createElement("p");
  crsNote.className = "add-note";
  crsSet.append(crsLegend, row("Reference system", crs), crsNote);

  // ── Columns (delimited only) ──
  const colSet = document.createElement("fieldset");
  colSet.hidden = true;
  const colLegend = document.createElement("legend");
  colLegend.textContent = "Columns";
  const tableWrap = document.createElement("div");
  tableWrap.className = "head-table-wrap";
  const colRows = document.createElement("div");
  const colNote = document.createElement("p");
  colNote.className = "add-note";
  colSet.append(colLegend, tableWrap, colRows, colNote);

  // ── Symbology ──
  const symSet = document.createElement("fieldset");
  const symLegend = document.createElement("legend");
  symLegend.textContent = "Symbology";
  const colour = document.createElement("input");
  colour.type = "color";
  colour.className = "input";
  colour.value = "#7ee7ff";
  const opacity = document.createElement("input");
  opacity.type = "range";
  opacity.className = "input";
  opacity.min = "0.1";
  opacity.max = "1";
  opacity.step = "0.05";
  opacity.value = "0.85";
  // Derived from RAMPS, not written out: a hand-typed list offered "greyscale"
  // where the engine's ramp is "greys", so that choice silently fell back to
  // viridis. The dialog and the symbology panel now cannot disagree.
  const ramp = select(
    RAMP_NAMES.map((n) => ({ value: n, label: n[0].toUpperCase() + n.slice(1) })),
    "viridis",
  );
  const symNote = document.createElement("p");
  symNote.className = "add-note";
  const colourRow = row("Colour", colour);
  const rampRow = row("Ramp", ramp);
  symSet.append(symLegend, colourRow, row("Opacity", opacity), rampRow, symNote);

  // ── Classification ──
  // The data-tags taxonomy, asked at the door: the type the layer will wear
  // as its chip, and the note that says what this input is FOR. Guessed live
  // from the chosen file and correctable here — the arrival card then stays
  // quiet for this import (suppressNextArrival), one question, one box.
  const classSet = document.createElement("fieldset");
  const classLegend = document.createElement("legend");
  classLegend.textContent = "Classification";
  const dtype = select(
    Object.entries(DATA_TYPES).map(([value, t]) => ({ value, label: t.label })),
    "vector",
  );
  dtype.addEventListener("change", () => { state.dtypeTouched = true; });
  const dnote = document.createElement("input");
  dnote.className = "input";
  dnote.type = "text";
  dnote.placeholder = "Optional note — what is this input for?";
  classSet.append(classLegend, row("Type", dtype), row("Note", dnote));

  // ── Name ──
  const nameSet = document.createElement("fieldset");
  const nameLegend = document.createElement("legend");
  nameLegend.textContent = "Layer";
  const name = document.createElement("input");
  name.className = "input";
  name.type = "text";
  name.placeholder = "Named after the file unless you say otherwise";
  nameSet.append(nameLegend, row("Name", name));

  const note = document.createElement("p");
  note.className = "add-note";

  body.append(fileSet, crsSet, colSet, symSet, classSet, nameSet, note);

  const foot = document.createElement("div");
  foot.className = "add-foot";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "button";
  add.textContent = "Add";
  add.addEventListener("click", submit);
  foot.append(cancel, add);

  card.append(head, body, foot);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  ui = {
    title, hint, drop, fileInput, chosen, crs, crsNote, symSet,
    colSet, tableWrap, colRows, colNote,
    colour, opacity, ramp, symNote, name, note, add,
    colourRow, rampRow, dtype, dnote,
  };

  // A click on the backdrop dismisses; a click inside must not.
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  card.addEventListener("click", (e) => e.stopPropagation());

  fileInput.addEventListener("change", () => {
    takeFiles(fileInput.files);
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add("is-over");
  }));
  ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("is-over")));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    takeFiles(e.dataTransfer?.files);
  });
  crs.addEventListener("change", () => {
    crsNote.textContent = crs.value === "none"
      ? "Not georeferenced: this will be placed as a local model rather than on the globe."
      : "";
  });
}

/* ── Files and the head ──────────────────────────────────────────────────── */

async function takeFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  state.files = files;
  // The mesh role's old job, done by the FILE now that there is one dialog:
  // a mesh has no CRS to declare, and defaulting it to EPSG:4326 offered a
  // georeference the format cannot carry.
  const MESH_EXT = new Set(["stl", "msh", "obj", "ply"]);
  const RASTER_EXT = new Set(["tif", "tiff", "asc", "png", "jpg", "jpeg"]);
  const isMesh = files.every((f) => MESH_EXT.has(extensionOf(f.name)));
  const mainFile = files.find((f) => !["prj", "dbf", "shx", "tfw", "pgw", "jgw", "cpg"]
    .includes(extensionOf(f.name))) || files[0];
  const mainExt = extensionOf(mainFile.name);
  const kind = isMesh ? "mesh"
    : RASTER_EXT.has(mainExt) ? "raster"
      : DELIMITED.has(mainExt) ? "points" : "vector";
  if (isMesh) {
    ui.crs.value = "none";
    ui.crs.dispatchEvent(new Event("change"));
  } else if (ui.crs.value === "none") {
    // Swapping a mesh out for a georeferenced file must bring the CRS back —
    // "none" was the MESH's answer, not a choice about this file.
    ui.crs.value = "epsg:4326";
    ui.crs.dispatchEvent(new Event("change"));
  }
  // The dialog says what it UNDERSTOOD, beside the file names — a .tif read
  // as a raster and an .stl read as a local mesh are different imports, and
  // which one is about to happen should not be a surprise.
  const KIND_COPY = {
    mesh: "a 3D mesh (local model)",
    raster: "a raster, draped on the terrain",
    points: "a table of points — map the columns below",
    vector: "a vector layer",
  };
  state.kindCopy = KIND_COPY[kind];
  // The classification follows the file until the user takes it over.
  if (!state.dtypeTouched && ui.dtype) {
    ui.dtype.value = inferType({ ext: mainExt, name: mainFile.name, raster: kind === "raster" });
  }
  ui.chosen.textContent = (files.length === 1
    ? files[0].name
    : `${files.length} files — ${files.map((f) => f.name).join(", ")}`)
    + (state.kindCopy ? ` — imported as ${state.kindCopy}` : "");
  if (!ui.name.value) {
    ui.name.placeholder = files[0].name;
  }
  say("");

  // A sidecar .prj is the file's own answer about its CRS, so it wins the
  // default over anything guessed here.
  const prj = files.find((f) => extensionOf(f.name) === "prj");
  if (prj) {
    try {
      const { detectCrs, crsLabel } = await import(`./prj-detect.js${new URL(import.meta.url).search}`);
      const detected = detectCrs(await prj.text());
      if (detected && CRS_OPTIONS.some((o) => o.id === detected)) {
        ui.crs.value = detected;
        ui.crsNote.textContent = `Read from ${prj.name}: ${crsLabel ? crsLabel(detected) : detected}.`;
      }
    } catch (error) {
      /* a .prj we cannot read is not a reason to refuse the import */
    }
  }

  const table = files.find(isDelimited);
  if (!table) {
    ui.colSet.hidden = true;
    state.head = null;
    state.mapping = null;
    describeSymbology();
    return;
  }
  const text = await table.slice(0, 64 * 1024).text();
  const head = readHead(text);
  if (!head.mapping) {
    ui.colSet.hidden = true;
    say(`${table.name} has no readable rows.`, true);
    return;
  }
  state.head = head;
  state.mapping = { ...head.mapping };
  renderColumns();
  ui.colSet.hidden = false;
  describeSymbology();
}

function renderColumns() {
  const { columns, rows } = state.head;
  const mapped = new Set([state.mapping.lon, state.mapping.lat,
    state.mapping.elev, state.mapping.magnitude].filter((i) => i >= 0));

  const table = document.createElement("table");
  table.className = "head-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  columns.forEach((c, i) => {
    const th = document.createElement("th");
    th.textContent = c;
    if (mapped.has(i)) th.classList.add("is-mapped");
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    columns.forEach((_, i) => {
      const td = document.createElement("td");
      td.textContent = r[i] ?? "";
      if (mapped.has(i)) td.classList.add("is-mapped");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  ui.tableWrap.replaceChildren(table);

  const choices = columns.map((c, i) => ({ value: i, label: `${i + 1}. ${c}` }));
  const optional = [{ value: -1, label: "None" }, ...choices];
  ui.colRows.replaceChildren();
  [
    ["X / longitude", "lon", choices],
    ["Y / latitude", "lat", choices],
    ["Z / elevation", "elev", optional],
    ["Magnitude", "magnitude", optional],
  ].forEach(([label, key, opts]) => {
    const el = select(opts, state.mapping[key]);
    el.addEventListener("change", () => {
      state.mapping[key] = Number(el.value);
      renderColumns();
    });
    ui.colRows.appendChild(row(label, el));
  });

  // The guess is stated rather than assumed. This is the whole reason the
  // preview exists: a file with no recognisable header imports on column ORDER,
  // which is right often enough to be dangerous.
  ui.colNote.textContent = state.mapping.guessed
    ? "No coordinate column names were recognised, so these are the first columns in order — check them."
    : "";
  ui.colNote.classList.toggle("is-warning", Boolean(state.mapping.guessed));
  // Choosing a Z or a magnitude is what makes this layer gradeable, so the
  // symbology note is recomputed here as well as on the file choice.
  describeSymbology();
}

/* ── Adding ──────────────────────────────────────────────────────────────── */

async function submit() {
  if (!state.files.length) {
    say("Choose a file first.", true);
    return;
  }
  if (state.head && state.mapping) {
    const valid = validateMapping(state.mapping, state.head.columns.length);
    if (!valid.ok) {
      say(valid.problems.join(" "), true);
      return;
    }
  }
  const manager = window.GeoIDImportManager;
  if (!manager?.importFileList) {
    say("The globe is not ready yet.", true);
    return;
  }
  const options = {
    role: state.role.id,
    crs: ui.crs.value,
    name: ui.name.value.trim() || undefined,
  };
  // Only when the section is actually offered. Hiding it for rasters and then
  // sending its values anyway would apply a ramp chosen before the data was
  // seen -- the decision this stopped asking for.
  if (!ui.symSet.hidden) {
    options.symbology = {
      colour: ui.colour.value,
      opacity: Number(ui.opacity.value),
      ramp: ui.ramp.value,
    };
  }
  if (state.mapping) options.columns = state.mapping;

  ui.add.disabled = true;
  say("Adding…");
  try {
    // The dialog asked for type and note itself, so the arrival card stays
    // quiet for this import; the tag lands on whatever layers the import
    // produced, found by diffing ids — the importer names layers its own way.
    suppressNextArrival(1);
    const before = new Set((manager.getLayers?.() || []).map((l) => l.id));
    await manager.importFileList(state.files, options);
    const tag = { type: ui.dtype.value, description: ui.dnote.value.trim() };
    (manager.getLayers?.() || [])
      .filter((l) => !before.has(l.id))
      .forEach((l) => { markUserInput(l); applyTag(l, tag); });
    close();
  } catch (error) {
    say(`Could not add that: ${error.message}`, true);
  } finally {
    ui.add.disabled = false;
  }
}

/* ── Open / close ────────────────────────────────────────────────────────── */

export function open(roleId) {
  if (!backdrop) build();
  state.role = roleById(roleId);
  state.files = [];
  state.head = null;
  state.mapping = null;
  ui.title.textContent = state.role.title;
  ui.hint.textContent = state.role.hint;
  ui.fileInput.accept = state.role.accept;
  ui.chosen.textContent = "";
  ui.colSet.hidden = true;
  ui.name.value = "";
  ui.name.placeholder = "Named after the file unless you say otherwise";
  ui.crsNote.textContent = "";
  ui.symNote.textContent = "";
  ui.symSet.hidden = false;
  ui.dtype.value = "vector";
  ui.dnote.value = "";
  state.dtypeTouched = false;
  // A mesh has no map projection to speak of, so it opens on "not
  // georeferenced" rather than asking a question with no honest answer.
  ui.crs.value = state.role.id === "mesh" ? "none" : "epsg:4326";
  say("");
  backdrop.hidden = false;
}

export function close() {
  if (backdrop) backdrop.hidden = true;
}

/* ── The + Add affordances ───────────────────────────────────────────────── */

/**
 * The Mesh tab, built here rather than in the shared markup.
 *
 * It is a tab of its own because a mesh is not a GIS layer: it has no CRS worth
 * asking about and belongs to the Model side. Filing it under Vectors, Basemap
 * or Geology would put it somewhere nobody would look for it.
 */
function ensureMeshGroup() {
  if (document.getElementById("gis-group-mesh")) return;
  const host = document.getElementById("gis-panel-host")
    || document.getElementById("gis-toolbox-panels");
  if (!host) return;
  const group = document.createElement("details");
  group.id = "gis-group-mesh";
  group.className = "control-section toolbox-group";
  group.innerHTML = '<summary class="section-toggle"><div class="section-toggle-main">'
    + '<div class="section-heading"><div class="section-title"><span class="section-title-row">'
    + '<span class="section-icon" aria-hidden="true"><svg viewBox="0 0 16 16">'
    + '<path d="M8 2.4 13.4 5.4v5.2L8 13.6 2.6 10.6V5.4Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'
    + '<path d="M2.6 5.4 8 8.4l5.4-3M8 8.4v5.2" fill="none" stroke="currentColor" stroke-width="1.1"/>'
    + '</svg></span><span>Model Builder</span></span></div></div></div></summary>'
    + '<div class="section-body toolbox-group-body" id="gis-mesh-body"></div>';
  host.appendChild(group);
}

/**
 * The GEE doorway rides in the same row: "Add data via GEE…" belongs at the
 * TOP of a tab beside "+ Add data" — one place where data comes in — never
 * buried between the tab's subsections, which is where it was reported.
 * The homes are gee.js's (`data-gee-add`; empty string = whole catalogue).
 */
const GEE_HOME_BY_PANEL = {
  "gis-group-polygons": "",
  "basemap-relief-section": "basemap",
  "geology-section": "geology",
  "sea-level-section": "hydrology",
  "gis-group-modelled": "atmosphere",
  "modelled-data-section": "geohazards",
};

function addButtonFor(role) {
  /**
   * The vector role's home is the WORKSPACE BOX, not a tab: the corner
   * dock carries `#workspace-add-host` as the first thing in its body, so
   * + Data / + GEE / Custom sit above the layer hierarchy they feed. The
   * duplicate guard searches the DOCUMENT for this role because the row
   * no longer lives inside the panel it is keyed to.
   */
  /**
   * Into the Workspace box's HEADER, pinned right as icon buttons — three
   * full-width text buttons dominated the tile's space, and the header row
   * had room going spare. `#workspace-add-host` in the body stays as the
   * data-tag arrival card's anchor and as the fallback host.
   */
  const dockHost = role.panel === "gis-group-polygons"
    ? (document.querySelector("#layer-dock .layer-dock-head")
      || document.getElementById("workspace-add-host")) : null;
  const panel = document.getElementById(role.panel);
  if (!panel && !dockHost) return false;
  if (document.querySelector(`[data-add-role="${role.id}"]`)) return false;
  // Into the panel's body, not its summary: a button in a <summary> swallows
  // the click that opens the section, so the panel could never be expanded.
  const body = dockHost || panel.querySelector(".section-body") || panel;
  const row = document.createElement("div");
  row.className = "gis-add-row";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button gis-add-button";
  button.dataset.addRole = role.id;
  button.textContent = "+ Data";
  button.title = role.hint;
  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    open(role.id);
  });
  row.appendChild(button);
  // Earth only: gee.js never runs on the planet pages, and a + GEE that
  // opens nothing is a dead control wearing a live one's clothes.
  const geeHome = isEarth() ? GEE_HOME_BY_PANEL[role.panel] : undefined;
  if (geeHome !== undefined) {
    const gee = document.createElement("button");
    gee.type = "button";
    gee.className = "button secondary gis-gee-button";
    gee.dataset.geeAdd = geeHome;
    gee.textContent = "+ GEE";
    gee.title = "Browse the Google Earth Engine catalogue and draw a fetch extent";
    // Wired to the seam, not left to gee.js's document listener: in the dock
    // header this row swallows its own clicks, so a bubbling listener never
    // hears this button. Same shape as Export and Settings below.
    gee.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.GeoIDGeeCatalogue?.open?.(geeHome);
    });
    row.appendChild(gee);
  }
  /**
   * Export, the third door in the row (second off Earth): an act on the
   * working set this box holds, so it opens the Export workbench from here
   * rather than from a rail button of its own (side-panels keeps the panel,
   * `rail: false`).
   */
  if (role.panel === "gis-group-polygons") {
    const exp = document.createElement("button");
    exp.type = "button";
    exp.className = "button secondary gis-export-button";
    exp.textContent = "Export";
    exp.title = "Export layers, maps and views";
    exp.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.GeoIDSidePanels?.open?.("export");
    });
    row.appendChild(exp);
    // The gear rides here on EVERY world — Settings left the rail for the
    // Workspace header (side-panels' entry is rail: false).
    {
      const cfg = document.createElement("button");
      cfg.type = "button";
      cfg.className = "button secondary gis-settings-button";
      cfg.textContent = "Settings";
      cfg.title = "Settings";
      cfg.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.GeoIDSidePanels?.open?.("settings");
      });
      row.appendChild(cfg);
    }
  }
  if (dockHost) {
    // Icon-only in the header: the name moves into the tooltip, and the row
    // swallows its clicks so pressing a button never folds the box.
    row.classList.add("gis-add-row-icons");
    ["click", "pointerdown"].forEach((type) =>
      row.addEventListener(type, (e) => e.stopPropagation()));
    const ICONS = {
      "+ Data": '<path d="M12 5.4v13.2M5.4 12h13.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      "+ GEE": '<path d="M7.2 16.5h9.6a3.6 3.6 0 0 0 .7-7.1 5 5 0 0 0-9.7-1 4.1 4.1 0 0 0-.6 8.1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'
        + '<path d="M12 13v6.4m-2.4-2.4 2.4 2.4 2.4-2.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
      Export: '<path d="M12 15.4V4.8M7.8 9 12 4.8 16.2 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<path d="M4.8 19.2h14.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      Settings: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/>'
        + '<path d="M12 3.4v2.4M12 18.2v2.4M20.6 12h-2.4M5.8 12H3.4M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7M18.1 18.1l-1.7-1.7M7.6 7.6 5.9 5.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    };
    [...row.querySelectorAll("button")].forEach((b) => {
      const label = b.textContent.trim();
      if (!ICONS[label]) return;
      b.title = `${label} — ${b.title || ""}`.replace(/ — $/, "");
      b.setAttribute("aria-label", b.title);
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[label]}</svg>`;
    });
  }
  // The vector tab's third doorway: capturing the drawn area. The button
  // lives in the shared markup (polygons.js wires it there) and is ADOPTED
  // into this row, so the three ways data arrives sit side by side.
  // Model Builder gets its own Custom: the drawn area captured as a layer,
  // which is the shape a mesh starts from. Same amber, same capture.
  if (role.panel === "gis-group-mesh") {
    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "button secondary gis-custom-button";
    custom.textContent = "Custom";
    custom.title = "Capture the area drawn on the globe as a layer to mesh";
    custom.addEventListener("click", () => {
      const out = window.GeoIDDrawnLayers?.captureDrawn?.();
      if (out && !out.ok) {
        let note = row.nextElementSibling;
        if (!note?.classList?.contains("gis-add-note")) {
          note = document.createElement("div");
          note.className = "gis-metric gis-add-note";
          row.after(note);
        }
        note.textContent = out.message;
      }
    });
    row.appendChild(custom);
  }
  // First child in a tab body (the doorways lead); LAST in the Workspace
  // header, so the title keeps the left edge and the icons pin right.
  if (dockHost) body.appendChild(row);
  else body.insertBefore(row, body.firstChild);
  return true;
}

export function init() {
  // The stylesheet used to arrive with the dialog's first open, which left
  // the add-button ROW unstyled until then: display block, no gap, the two
  // buttons touching. The buttons are on the page from the start, so their
  // styles must be too.
  installStyle();
  ensureMeshGroup();
  /**
   * ONLY the Workspace box gets a row. Every tab used to carry its own
   * + Data / + GEE pair; with the Workspace box as the one doorway they
   * were seven copies of the same two buttons, and were asked to go. The
   * fetch-polygon buttons (`#gee-draw-area`, the weather card's draw) are
   * NOT these — they choose ground, not files — and stay where they are.
   * The other ROLES entries survive as dialog configurations (`roleById`
   * still resolves them for anything that opens the dialog by role id).
   */
  const placed = [addButtonFor(roleById("vector"))];
  return placed.some(Boolean);
}

if (typeof document !== "undefined") {
  // The panels arrive with the markup on Earth and with the shell on a planet
  // page, and `toolbox.js` moves several of them afterwards — so this retries
  // rather than assuming a moment, the same shape `side-panels.js` uses.
  let tries = 0;
  const attempt = () => {
    init();
    if ((tries += 1) > 60) return;
    setTimeout(attempt, 400);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attempt);
  } else {
    attempt();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop && !backdrop.hidden) close();
  });
}

if (typeof window !== "undefined") {
  window.GeoIDAddData = { open, close, roles: () => ROLES.map((r) => r.id) };
}
