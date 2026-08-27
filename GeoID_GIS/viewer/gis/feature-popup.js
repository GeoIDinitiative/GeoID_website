/**
 * Click a vector feature, read what it is.
 *
 * The Mars and Moon viewers have had this for their geology since the start —
 * a polygon is not a colour, it is a unit with a name, an age and a lithology,
 * and a map you cannot interrogate is a picture. Imported vector layers had no
 * equivalent: the BGS bedrock polygons carry fifty-seven attributes each and
 * there was no way to see one of them.
 *
 * It hit-tests in COORDINATES, not in geometry. A click asks the viewer what
 * lat/lon the pixel is (`surfaceLatLonAt`), and the answer is tested against
 * each visible layer's GeoJSON with the same `pointInPolygon` the query engine
 * and the extraction use. That matters for three reasons: the drape meshes are
 * built with `depthTest: false` and would raycast in an order that has nothing
 * to do with what you see; a simplified render mesh is not the feature; and
 * this way the popup and a spatial query can never disagree about which
 * polygon a point is in.
 *
 * Topmost wins, where "top" is the layer stack the hierarchy already defines —
 * the same order the eye reads, so the answer is the polygon you clicked.
 */

import { pointInPolygon, boundsOf, haversineMetres } from "./geometry.js?v=20260827-8fdfe1b";
import { sphericalPolygonAreaKm2 } from "./geo-utils.js?v=20260827-8fdfe1b";

/* A line has no interior, so it is picked by proximity. Scaled to the view:
   8 px worth of ground at the current altitude, floored so a click at orbital
   distance cannot select a river 400 km away. */
const LINE_PIXELS = 8;
const LINE_FLOOR_M = 30;
const LINE_CEILING_M = 20000;

let installed = false;
let popup = null;
let suppressUntil = 0;

/* ── the popup ──────────────────────────────────────────────────────────── */

const STYLE = `
#gis-feature-popup.geo-popup {
  /* .geo-popup pulls itself above an anchor on the globe and pulses; this popup
     is placed beside the pointer, so both are switched off and the paint kept. */
  transform: none;
  animation: none;
}
/* Geometry and type only. The border, ground, radius and glow come from
   .geo-popup, and an id beats a class -- restating them here is how this popup
   kept its own 0.4rem corners while claiming to wear the planetary card. */
#gis-feature-popup {
  position: fixed;
  z-index: 21;
  max-width: 22rem;
  max-height: 60vh;
  overflow-y: auto;
  font-family: "Exo 2", system-ui, sans-serif;
  font-size: 0.72rem;
  color: var(--text, #e8e2f2);
}
#gis-feature-popup[hidden] { display: none; }
#gis-feature-popup .gis-fp-head {
  display: flex; align-items: flex-start; gap: 0.5rem;
  margin-bottom: 0.4rem;
}
#gis-feature-popup .gis-fp-title {
  flex: 1; font-weight: 600; line-height: 1.25;
  color: var(--nav-accent, #ff3cac);
}
#gis-feature-popup .gis-fp-close {
  flex: 0 0 auto; width: 1.2rem; height: 1.2rem; padding: 0;
  border: 0; border-radius: 0.2rem; cursor: pointer;
  background: transparent; color: inherit; font-size: 0.8rem; line-height: 1;
}
#gis-feature-popup .gis-fp-close:hover { background: rgba(255, 255, 255, 0.12); }
#gis-feature-popup .gis-fp-layer {
  margin-bottom: 0.35rem; letter-spacing: 0.06em; text-transform: uppercase;
  font-size: 0.6rem; opacity: 0.7;
}
#gis-feature-popup dl {
  display: grid; grid-template-columns: minmax(5.5rem, auto) 1fr;
  gap: 0.15rem 0.6rem; margin: 0;
}
#gis-feature-popup dt {
  color: var(--skin-data, #59f2ff); opacity: 0.85;
  overflow-wrap: anywhere;
}
#gis-feature-popup dd { margin: 0; overflow-wrap: anywhere; }
#gis-feature-popup .gis-fp-more {
  margin-top: 0.4rem; font-size: 0.62rem; opacity: 0.65;
}

/* The drawn-shape editor. NEVER a backtick in this block -- it is a template
   literal and one ends it; module-css.test.mjs catches that, a browser does not. */
#gis-feature-popup .gis-fp-head-stacked {
  display: block;
  position: relative;
  padding-right: 1.2rem;
}
#gis-feature-popup .gis-fp-head-stacked .gis-fp-close {
  position: absolute;
  top: 0;
  right: 0;
}
#gis-feature-popup .gis-fp-raw { margin-top: 0.45rem; }
/* A link in the attribute list: the accent, and elided rather than wrapped so
   one long URL cannot double the height of the popup it sits in. */
#gis-feature-popup .gis-fp-link {
  color: rgb(var(--nav-accent-rgb, 255 45 210));
  text-decoration: none;
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
#gis-feature-popup .gis-fp-link:hover { text-decoration: underline; }
#gis-feature-popup .gis-fp-raw > summary {
  cursor: pointer;
  font: 500 0.6rem/1.3 'Exo 2', sans-serif;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  opacity: 0.65;
}
#gis-feature-popup .gis-fp-detail { margin: 0.5rem 0 0.2rem; }
#gis-feature-popup .gis-fp-kicker { margin: 0.1rem 0 0; }
#gis-feature-popup .gis-fp-copy { margin: 0.2rem 0 0.1rem; }
#gis-feature-popup .gis-fp-copy:empty { display: none; }
#gis-feature-popup .gis-fp-beneath {
  margin-top: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font: 600 0.62rem/1.3 'Exo 2', sans-serif;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--skin-data, #7ee7ff);
}
#gis-feature-popup .gis-fp-edit {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}
#gis-feature-popup .gis-fp-field {
  display: grid;
  grid-template-columns: 3.6rem 1fr;
  gap: 0.35rem;
  align-items: center;
}
#gis-feature-popup .gis-fp-field span {
  font: 500 0.6rem/1.2 'Exo 2', sans-serif;
  letter-spacing: 0.04em;
  color: var(--skin-data, #7ee7ff);
}
#gis-feature-popup .gis-fp-field input {
  width: 100%;
  min-width: 0;
  padding: 0.12rem 0.3rem;
  font: 400 0.65rem/1.35 'Exo 2', sans-serif;
  color: var(--text, #e8f4ff);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 0.18rem;
}
#gis-feature-popup .gis-fp-field input:focus {
  outline: none;
  border-color: rgba(var(--nav-accent-rgb), 0.85);
}
#gis-feature-popup .gis-fp-save {
  margin-top: 0.2rem;
  padding: 0.25rem 0.5rem;
  font: 600 0.62rem/1.2 'Exo 2', sans-serif;
  letter-spacing: 0.05em;
  color: var(--skin-chrome-ink, #2b0030);
  background: rgb(var(--nav-accent-rgb));
  border: none;
  border-radius: 0.2rem;
  cursor: pointer;
}
#gis-feature-popup .gis-fp-said {
  font: 400 0.6rem/1.3 'Exo 2', sans-serif;
  opacity: 0.8;
}
#gis-feature-popup .gis-fp-said:empty { display: none; }
`;

function ensurePopup() {
  if (popup) return popup;
  if (!document.getElementById("gis-feature-popup-style")) {
    const style = document.createElement("style");
    style.id = "gis-feature-popup-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  popup = document.createElement("div");
  popup.id = "gis-feature-popup";
  // The planetary geology card's own look -- border, ground, radius, glow --
  // by wearing its class rather than copying twenty declarations that would
  // then drift. Only the two rules that assume it is anchored to a point on
  // the globe are overridden below, because this one places beside the click.
  popup.classList.add("geo-popup");
  popup.setAttribute("role", "dialog");
  popup.hidden = true;
  document.body.appendChild(popup);
  return popup;
}

export function hidePopup({ keepOutline = false } = {}) {
  if (popup) popup.hidden = true;
  if (!keepOutline) clearPin();
}

/* Attributes worth leading with, in the order a geologist reads them. Anything
   not named here still shows, below these; nothing is hidden. */
const PREFERRED = [
  "name", "NAME", "lex_d", "rcs_d", "lex_rcs_d", "bgstype", "max_time_d",
  "min_time_d", "max_period", "min_period", "max_era", "age_onegl",
  // Volcanoes (Smithsonian GVP): what it is, when it last erupted and where it
  // sits tectonically -- the three questions a click on a volcano is asking,
  // ahead of the country and the region, which the map has already answered.
  "volcano_type", "activity", "last_eruption", "elevation_m", "tectonic_setting",
  "rock_type", "landform", "epoch", "summary",
  // World Stress Map: what was measured, how well, by what method, and -- for
  // the few hundred records that carry them -- the principal stress
  // MAGNITUDES. Those are the rarest and most valuable numbers in the
  // database (249 of 32,464), so they go near the front: the eight-row cap on
  // the card would otherwise cut exactly the rows that make a record unusual.
  "azimuth", "regime", "s1_mpa", "s2_mpa", "s3_mpa", "quality", "method",
  "waterway", "value", "class", "unit", "description",
];

/**
 * Columns whose names are for machines, and the units they are missing.
 *
 * A card that says `s1_mpa 48.5` has told you the number and left you to know
 * what it is. These are the ones this app ships and can therefore name
 * properly; everything else still shows exactly as its own survey wrote it,
 * because inventing a friendly label for a column somebody else defined is how
 * you end up mislabelling it.
 */
const FIELD_LABEL = {
  azimuth: "SHmax azimuth",
  regime: "Faulting regime",
  // The Smithsonian's columns, which read as database headings otherwise --
  // and `summary` carries the paragraph that is most of the reason to click.
  summary: "Description",
  activity: "Activity",
  epoch: "Epoch",
  landform: "Landform",
  rock_type: "Rock type",
  volcano_type: "Volcano type",
  tectonic_setting: "Tectonic setting",
  subregion: "Subregion",
  quality: "WSM quality class",
  method: "Measured by",
  depth_km: "Depth",
  // Named WITHOUT asserting the ranking, on purpose. By convention
  // S1 >= S2 >= S3, and the obvious labels would say so — but the database's
  // published values do not always honour it: wsm00025, a Swedish mini-frac,
  // carries S1 11.5, S2 5.5, S3 6.3 MPa. Whether that is a transcription in
  // the original or a different convention at that site is not something this
  // app can decide, and a label reading "intermediate" over a number smaller
  // than the one below it is the app inventing an order the record does not
  // have. The values are shown as published.
  s1_mpa: "S1 magnitude",
  s2_mpa: "S2 magnitude",
  s3_mpa: "S3 magnitude",
  regime_code: "WSM regime code",
  wsm_id: "WSM record",
  elevation_m: "Elevation",
  last_eruption: "Last eruption",
  volcano_type: "Type",
  tectonic_setting: "Tectonic setting",
};

const FIELD_UNIT = {
  azimuth: "°",
  depth_km: " km",
  s1_mpa: " MPa",
  s2_mpa: " MPa",
  s3_mpa: " MPa",
  elevation_m: " m",
};

/** A column's own name, or the plain-English one where this app owns it. */
export const fieldLabel = (key) => FIELD_LABEL[key] || key;

/**
 * The value with its unit, and the unit only where the number is one.
 *
 * `48.5 MPa` is a stress; `48.5` is a number in a column. But a unit welded on
 * to something that is not numeric -- a survey writing "not determined" into a
 * depth column, which they do -- reads as "not determined km".
 */
export function fieldValue(key, value) {
  const unit = FIELD_UNIT[key];
  const text = String(value);
  return unit && Number.isFinite(Number(text)) ? `${text}${unit}` : text;
}

/** The first of these columns that has anything in it. */
function firstOf(props, keys) {
  for (const key of keys) {
    const v = props?.[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

/** What this feature is CALLED, if the data names it at all. */
function nameOf(props) {
  return firstOf(props, ["name", "NAME", "Name", "name_en", "lex_d", "label", "title"]);
}

/**
 * What this feature IS, where it has no name.
 *
 * A BGS fault carries no name -- `fltname_d` is blank on all 281 -- but it does
 * say `feature_d`, "Fault at rockhead", which is the useful thing to head the
 * card with. The old title fell back to the literal string "Feature", which is
 * the one word on the card that could not be wrong and could not help.
 */
function kindOf(props) {
  return firstOf(props, [
    "feature_d", "featurecla", "rcs_d", "lex_rcs_d", "description", "type",
    "TYPE", "class", "CLASS", "waterway", "highway", "landuse", "natural",
    // A GEM fault says how it moves and a WSM record says how it was measured.
    // Both are the answer to "what IS this", and without them the card fell
    // through to the geometry and said "Mapped line" over a named fault.
    "slip_type", "method",
  ]);
}

function titleOf(props) {
  return nameOf(props) || kindOf(props) || "Feature";
}

/**
 * Columns that describe the RECORD rather than the thing.
 *
 * Every survey ships them and none of them tells you anything about the fault
 * you just clicked: a row id, a database link, an internal version. They still
 * show -- nothing is hidden -- but after everything that describes the feature,
 * so they are the ones a cap cuts rather than the ones it keeps.
 */
const PLUMBING = new Set([
  // The WSM's own two-letter regime code, which the row above it already
  // spells out, and the country, which the map has answered by being a map.
  "regime_code", "country", "site",
  "objectid", "OBJECTID", "id", "ID", "fid", "FID", "gid", "mslink", "MSLINK",
  "version", "released", "nom_scale", "nom_os_yr", "nom_bgs_yr", "sheet",
  "shape_leng", "shape_area", "min_zoom", "min_label", "scalerank", "dissolve",
  "rivernum", "note",
  // A record number and a photo credit are true, and they are not what the
  // click was asking. They go to the tail rather than being dropped: the
  // number is how you find the record again, and a credit must not be lost.
  "gvp_number", "type_group", "photo_caption", "photo_credit", "evidence",
  // How the label engine ranks the point: machinery, not a fact about the
  // volcano, and it was showing on the card as "label_rank 5".
  "label_rank",
]);

function orderedEntries(props) {
  const seen = new Set();
  const rows = [];
  const tail = [];
  PREFERRED.forEach((key) => {
    if (props[key] != null && String(props[key]).trim() && !seen.has(key)) {
      seen.add(key);
      rows.push([key, props[key]]);
    }
  });
  Object.keys(props).forEach((key) => {
    if (seen.has(key)) return;
    const v = props[key];
    if (v == null || !String(v).trim() || String(v) === "0") return;
    seen.add(key);
    (PLUMBING.has(key) ? tail : rows).push([key, v]);
  });
  return rows.concat(tail);
}


/**
 * Rename and annotate a shape you drew, where you clicked it.
 *
 * The name goes through `renameLayer` rather than being written here, because
 * it lives in three places and this popup can only see one of them. Notes and
 * any custom field go onto the feature's own properties, which is the copy that
 * travels into an export and into the project -- metadata that only existed in
 * the viewer would be lost by the first thing that read the file.
 */
function buildEditor(layerRecord, feature, titleNode) {
  const wrap = document.createElement("div");
  wrap.className = "gis-fp-edit";

  const field = (labelText, value, placeholder) => {
    const row = document.createElement("label");
    row.className = "gis-fp-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = placeholder || "";
    // The viewer intercepts Space document-wide and blurs the focused element,
    // which would make every one of these fields one word long.
    input.addEventListener("keydown", (e) => e.stopPropagation());
    row.append(span, input);
    wrap.appendChild(row);
    return input;
  };

  const name = field("Name", layerRecord.name, "Name this shape");
  const notes = field("Notes", feature.properties?.notes, "What is it, why it matters");
  const keyInput = field("Field", "", "e.g. surveyed_by");
  const valueInput = field("Value", "", "e.g. O. Mitchell");

  const save = document.createElement("button");
  save.type = "button";
  save.className = "gis-fp-save";
  save.textContent = "Save";
  const said = document.createElement("div");
  said.className = "gis-fp-said";

  save.addEventListener("click", () => {
    const manager = window.GeoIDImportManager;
    const wanted = name.value.trim();
    const changes = [];
    if (wanted && wanted !== layerRecord.name) {
      manager?.renameLayer?.(layerRecord, wanted);
      if (titleNode) titleNode.textContent = wanted;
      changes.push("renamed");
    }
    const meta = {};
    const noteText = notes.value.trim();
    if (noteText !== String(feature.properties?.notes || "")) {
      meta.notes = noteText;
      changes.push(noteText ? "notes saved" : "notes cleared");
    }
    const key = keyInput.value.trim();
    if (key) {
      meta[key] = valueInput.value.trim();
      changes.push(`${key} set`);
      keyInput.value = "";
      valueInput.value = "";
    }
    if (Object.keys(meta).length) manager?.setLayerMetadata?.(layerRecord, meta);
    said.textContent = changes.length ? changes.join(", ") : "Nothing changed.";
  });

  wrap.append(save, said);
  return wrap;
}



/**
 * One popup, a section per layer under the point.
 *
 * The top hit keeps the title and, for a drawn shape, the editor -- it is the
 * thing you clicked. Everything beneath is listed under its own heading, so a
 * click on Northern Ireland answers with the superficial deposit AND the
 * bedrock under it rather than making you hide a layer to reach the other.
 */

/**
 * The stat strip at the foot of the planetary card -- "AREA  79,335 km2".
 *
 * Built with the viewers' own `scene-popup-detail` classes, so the rows line up
 * and letterspace exactly as they do on Mars. The area is COMPUTED from the ring
 * rather than read from an attribute: a BGS polygon does not carry one, and the
 * spherical line-integral form is the same one the Draw tool quotes, so two
 * numbers for the same shape cannot disagree.
 */
function buildDetail(feature, props) {
  const rows = [];
  const rings = feature?.geometry?.type === "Polygon" ? feature.geometry.coordinates
    : feature?.geometry?.type === "MultiPolygon" ? feature.geometry.coordinates.map((p) => p[0]).map((r) => [r])
      : [];
  let km2 = 0;
  rings.forEach((ring) => {
    const outer = Array.isArray(ring[0]?.[0]) ? ring[0] : ring;
    // Deliberately NOT wrapped in try/catch. It was, and the catch swallowed a
    // ReferenceError from an import that had never been added -- the area read
    // zero, the row vanished, and nothing anywhere said why.
    if (outer.length >= 3) {
      km2 += sphericalPolygonAreaKm2(outer.map(([lon, lat]) => ({ lat, lon })));
    }
  });
  if (km2 > 0) {
    // A sliver is not nothing. Rounding to whole square kilometres printed
    // "Area 0 km²" for a polygon that plainly exists, which reads as a broken
    // measurement rather than a small one.
    const area = km2 >= 100 ? Math.round(km2).toLocaleString()
      : km2 >= 1 ? km2.toFixed(1)
        : km2.toPrecision(2);
    rows.push(["Area", `${area} km²`]);
  }
  // The code beside the name, where the survey publishes one -- it is what a
  // map sheet is keyed by and it is short enough to belong in the strip.
  const code = props.lex || props.lex_rcs || props.map_code || props.unit || null;
  if (code) rows.push(["Code", String(code)]);
  const age = props.max_period && props.min_period
    ? (props.max_period === props.min_period ? props.max_period
      : `${props.min_period} – ${props.max_period}`)
    : props.max_time_d || null;
  if (age) rows.push(["Age", String(age)]);
  if (!rows.length) return null;

  const block = document.createElement("div");
  block.className = "scene-popup-detail gis-fp-detail";
  rows.forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "scene-popup-detail-row";
    const k = document.createElement("span");
    k.className = "scene-popup-detail-key";
    k.textContent = key;
    const v = document.createElement("span");
    v.className = "scene-popup-detail-val";
    v.textContent = value;
    row.append(k, v);
    block.appendChild(row);
  });
  return block;
}

/**
 * What kind of thing was clicked — from the LAYER first, its geometry after.
 *
 * Geometry alone gave "Mapped line", which is equally true of a coastline, a
 * river, a fault, a border and a stress measurement, and therefore says
 * nothing about any of them. A shipped dataset knows what it is made of and
 * declares it (`featureNoun` in the catalogue), so a fault is headed as a
 * fault. The geometry stays as the fallback, because a file somebody dropped
 * on the globe really is just a line until it says otherwise.
 */
function featureKind(feature, layer = null) {
  const noun = layer?.featureNoun;
  if (typeof noun === "string" && noun.trim()) return noun.trim();
  const type = feature?.geometry?.type || "";
  if (type.includes("Polygon")) return "Mapped area";
  if (type.includes("LineString")) return "Mapped line";
  if (type.includes("Point")) return "Mapped point";
  return "Mapped feature";
}

/** Length along a line, in kilometres, for the card's detail strip. */
function lineLengthKm(feature) {
  const parts = linesOf(feature?.geometry || {});
  if (!parts.length) return 0;
  const R = 6371;
  const rad = Math.PI / 180;
  let km = 0;
  parts.forEach((line) => {
    for (let i = 1; i < line.length; i += 1) {
      const [lon1, lat1] = line[i - 1];
      const [lon2, lat2] = line[i];
      const dLat = (lat2 - lat1) * rad;
      const dLon = (lon2 - lon1) * rad;
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
      km += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    }
  });
  return km;
}

/**
 * One card for everything on the globe.
 *
 * This module used to draw its own: a box titled SELECTED FEATURE with the file
 * name under it and a folded "all N attributes" list, beside a magenta sphere
 * on the surface. The geology click already had the card this should have been
 * -- kicker, title, the source, a detail strip, anchored to a pin that tracks
 * the globe as it turns -- so the feature is handed to THAT, in the shape it
 * reads, rather than a second card being kept in step with it by hand.
 *
 * The attributes travel as `rows`, and the layers under the top one as `stack`,
 * which is what the geology card already does for bedrock beneath superficial.
 */
function showViewerCard(hits, at) {
  const viewer = window.GeoIDViewer;
  const [top, ...beneath] = hits;
  const props = top.feature?.properties || {};
  const name = nameOf(props);
  const kind = kindOf(props);
  const km2 = polygonAreaKm2(top.feature);
  const km = km2 > 0 ? 0 : lineLengthKm(top.feature);
  // Whatever is already on the card as the title or the line under it does not
  // also belong in the attribute rows.
  const shown = new Set([name, kind].filter(Boolean));
  const rows = orderedEntries(props)
    .filter(([, value]) => !shown.has(String(value).trim()))
    // Ten rather than eight: a stress record carries nine columns before its
    // magnitudes, and the cap was cutting the three numbers that make one
    // record in a hundred and thirty worth clicking on.
    .slice(0, 10)
    .map(([key, value]) => [fieldLabel(key), fieldValue(key, value)]);
  const feature = {
    type: featureKind(top.feature, top.layer),
    /**
     * The card reads `rock_type` for its heading and `name` for the line
     * under it, so both are set from here rather than left to fall through:
     * heading is what the thing is CALLED, or what it IS when the data never
     * names it (a BGS fault has no name and does say "Fault at rockhead"), or
     * failing both its geometry. The line under it carries the kind only when
     * the heading is a name, or the card says the same words twice.
     */
    rock_type: name || kind || featureKind(top.feature, top.layer),
    name: null,
    description: name && kind ? kind : null,
    origin: top.layer.name || null,
    mapped_area_km2: km2 > 0 ? Number(km2.toFixed(km2 >= 100 ? 0 : 2)) : null,
    length_km: km > 0 ? Number(km.toFixed(km >= 100 ? 0 : 2)) : null,
    rows,
    stack: beneath.map(({ layer, feature: f }) => ({
      label: layer.name || "Layer",
      unit: titleOf(f.properties || {}) || featureKind(f, layer),
    })),
  };
  if (!viewer?.showFeatureCard?.(feature, at?.lat, at?.lon)) return false;
  // The outline stays: on a map of hundreds of polygons the card alone cannot
  // say WHICH one answered. The pin does not -- the card brings its own.
  if (at) void showOutline(top.feature);
  return true;
}

function showStack(x, y, hits, at) {
  const [top] = hits;
  /**
   * A point from a nameable catalogue gets the VIEWER'S card, labelled or not.
   *
   * A labelled volcano already answers through its label's hit target and the
   * scene popup in the corner; an unlabelled dot of the same layer landed
   * here and got this module's anchored card instead — two card styles for
   * two dots of one dataset, decided by which happened to rank a name. The
   * mapping is `point-labels.js`'s own (`sceneItemFor`), so both clicks build
   * the same item and read the same card.
   */
  const item = window.GeoIDPointLabels?.sceneItemFor?.(top.layer, top.feature);
  if (item && window.GeoIDViewer?.openSceneFeature?.(item)) {
    hidePopup({ keepOutline: false });
    return;
  }
  // A drawn shape opens the editor instead: it is where you rename it and give
  // it metadata, which is a form rather than a readout, and the viewer's card
  // has nowhere to type.
  if (top.layer?.drawn) {
    showPopup(x, y, top.layer.name || "Layer", top.feature, top.layer);
    if (at) void showOutline(top.feature);
    return;
  }
  if (showViewerCard(hits, at)) { hidePopup({ keepOutline: true }); return; }
  // No viewer seam (an older page): the local card is still better than
  // nothing, and it is the only reason this fallback exists.
  showPopup(x, y, top.layer.name || "Layer", top.feature, top.layer);
  if (at) void showOutline(top.feature);
}

/** Area of a polygon feature in km2, or 0 for anything else. */
function polygonAreaKm2(feature) {
  const rings = feature?.geometry?.type === "Polygon" ? [feature.geometry.coordinates]
    : feature?.geometry?.type === "MultiPolygon" ? feature.geometry.coordinates : [];
  let km2 = 0;
  rings.forEach((poly) => {
    const outer = poly[0];
    if (Array.isArray(outer) && outer.length >= 3) {
      km2 += sphericalPolygonAreaKm2(outer.map(([lon, lat]) => ({ lat, lon })));
    }
  });
  return km2;
}

/* ── The pin, and the outline of what was clicked ────────────────────────────
 *
 * What the Mars and Moon geology viewers do, and what this did not: mark the
 * place and show which polygon answered. Without them a click is a popup that
 * appeared from nowhere -- on a map of 758 units you cannot tell which one you
 * hit, or whether the reading belongs to the polygon you meant.
 *
 * Both are built from `viewer.surfacePoint(lat, lon, lift)`, never
 * `radius + offset`: the basemap is displaced by the relief, so a fixed radius
 * sits under the terrain everywhere (CLAUDE.md, "Draping onto the globe"). They
 * are parented to the imported-layers group because that group already holds
 * the globe's spin -- put them in the scene and they slide as the planet turns.
 */
let pinState = null;

function markerGroup() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.scene) return null;
  return viewer.scene.getObjectByName("GeoID-ImportedGeoLayers") || null;
}

/**
 * The outline of what answered -- and nothing else on the surface.
 *
 * There used to be a marker here too: a sphere sized from the view distance,
 * which is the right way to size a thing in scene units and the wrong thing to
 * have at all. The viewer's card carries its own anchor and stem, drawn in the
 * page and tracking the point as the globe turns, so a second marker was a
 * magenta disc painted over the map it was pointing at.
 *
 * The outline stays, because the card cannot say WHICH polygon answered on a
 * map of hundreds of them.
 */
/**
 * The shape of what answered, as overlay geometry — whatever shape that is.
 *
 * This drew POLYGON rings and nothing else, so a click on a coastline, a
 * fault, a submarine cable or a landing station highlighted nothing: the card
 * opened and the map gave no sign which of three hundred lines it was about.
 * Lines and points are now built too, which is what the satellite tracker has
 * always done for an orbit and its dot.
 *
 * Long edges are split for the reason every other surface line here is: a
 * straight chord across 1° of arc already dips below the terrain.
 */
function buildHighlight(THREE, feature, { colour, opacity, width = 1, lift = 0.004 }) {
  const viewer = window.GeoIDViewer;
  const nodes = [];
  const geometry = feature?.geometry;
  const type = geometry?.type;
  const coords = geometry?.coordinates;
  if (!type || !coords) return nodes;

  const walk = (path, close) => {
    const points = [];
    const last = close ? path.length : path.length - 1;
    for (let i = 0; i < last; i += 1) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const steps = Math.max(1, Math.ceil(
        Math.max(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) / 1));
      for (let k = 0; k < steps; k += 1) {
        const t = k / steps;
        points.push(viewer.surfacePoint(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t, lift));
      }
    }
    if (close && path.length) {
      points.push(viewer.surfacePoint(path[0][1], path[0][0], lift));
    }
    if (points.length < 2) return;
    const line = new THREE[close ? "LineLoop" : "Line"](
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: colour, depthTest: false, transparent: true, opacity, linewidth: width,
      }),
    );
    line.renderOrder = 239;
    nodes.push(line);
  };

  const dots = (positions) => {
    const points = positions
      .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map((c) => viewer.surfacePoint(c[1], c[0], lift));
    if (!points.length) return;
    const cloud = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.PointsMaterial({
        color: colour, size: 14, sizeAttenuation: false,
        depthTest: false, transparent: true, opacity,
      }),
    );
    cloud.renderOrder = 240;
    nodes.push(cloud);
  };

  if (type === "Polygon") coords.slice(0, 24).forEach((ring) => walk(ring, true));
  else if (type === "MultiPolygon") coords.flat().slice(0, 24).forEach((ring) => walk(ring, true));
  else if (type === "LineString") walk(coords, false);
  // A cable is mapped as many parts; 60 is well past any real one and stops a
  // pathological geometry from building thousands of draw objects on a hover.
  else if (type === "MultiLineString") coords.slice(0, 60).forEach((part) => walk(part, false));
  else if (type === "Point") dots([coords]);
  else if (type === "MultiPoint") dots(coords);
  return nodes;
}

/**
 * The selection PULSES, the way a selected satellite does.
 *
 * One shared phase rather than one per node — per-object phases read as
 * shimmer, which is the lesson the event markers already record. Shallow and
 * slow (1.6 s), because a map that will not sit still cannot be read and a
 * fast pulse reads as an alarm. The loop ends itself when the selection is
 * cleared, so nothing has to remember to stop it.
 */
function startPulse(nodes, baseOpacity) {
  const started = performance.now();
  const sizes = nodes.map((n) => n.material?.size || 0);
  const tick = () => {
    if (!pinState || !nodes.length || !nodes[0].parent) return;
    const phase = Math.sin(((performance.now() - started) / 1600) * Math.PI * 2);
    nodes.forEach((node, i) => {
      if (!node.material) return;
      node.material.opacity = baseOpacity * (0.62 + 0.38 * (phase * 0.5 + 0.5));
      if (sizes[i]) node.material.size = sizes[i] * (1 + 0.16 * phase);
    });
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

/**
 * The outline of what answered -- and nothing else on the surface.
 *
 * There used to be a marker here too: a sphere sized from the view distance,
 * which is the right way to size a thing in scene units and the wrong thing to
 * have at all. The viewer's card carries its own anchor and stem, drawn in the
 * page and tracking the point as the globe turns, so a second marker was a
 * magenta disc painted over the map it was pointing at.
 *
 * The outline stays, because the card cannot say WHICH feature answered on a
 * map of hundreds of them — and now it pulses, so it says so at a glance.
 */
async function showOutline(feature) {
  const viewer = window.GeoIDViewer;
  const group = markerGroup();
  if (!viewer?.surfacePoint || !group) return;
  const THREE = await import("../vendor/three.module.js");

  clearPin();
  const holder = new THREE.Group();
  holder.name = "GeoID-FeatureOutline";
  // The same gold the viewer's own label selection wears, so one colour means
  // "this is the thing you picked" everywhere on the globe.
  const nodes = buildHighlight(THREE, feature, { colour: 0xffd166, opacity: 0.95, lift: 0.004 });
  nodes.forEach((node) => holder.add(node));
  if (!nodes.length) return;

  group.add(holder);
  pinState = holder;
  startPulse(nodes, 0.95);
}

export function clearPin() {
  if (!pinState) return;
  pinState.parent?.remove(pinState);
  pinState.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
  pinState = null;
}

/* ── Hover ───────────────────────────────────────────────────────────────
   What is under the cursor, brightened, before you commit to clicking it.

   The satellites do this for an orbit and it is the affordance that says a
   line is a THING rather than decoration. Throttled hard: `featuresAt` walks
   every feature of every vector layer, and running that per mousemove turns a
   pan into a slideshow — the same reason the orbit hover is throttled. */
let hoverState = null;
/* The feature OBJECT, compared by identity rather than by a key built from
   its properties: an unnamed cable has no name to key on, so every unnamed
   feature in a layer would share one key and hovering between them would
   never rebuild the overlay. */
let hoverFeature = null;
let hoverAt = 0;

function clearHover() {
  if (!hoverState) return;
  hoverState.parent?.remove(hoverState);
  hoverState.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
  hoverState = null;
  hoverFeature = null;
}

async function showHover(feature) {
  const viewer = window.GeoIDViewer;
  const group = markerGroup();
  if (!viewer?.surfacePoint || !group) return;
  const THREE = await import("../vendor/three.module.js");
  // Another hover may have overtaken this await.
  if (hoverFeature !== feature) return;
  const stale = hoverState;
  if (stale) {
    stale.parent?.remove(stale);
    stale.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
  }
  const holder = new THREE.Group();
  holder.name = "GeoID-FeatureHover";
  // Dimmer and cooler than the selection gold: hover is "you could pick this",
  // selection is "you did". Two states have to look like two states.
  const nodes = buildHighlight(THREE, feature, { colour: 0x8ef6ff, opacity: 0.55, lift: 0.0035 });
  if (!nodes.length) { hoverState = null; return; }
  nodes.forEach((node) => holder.add(node));
  group.add(holder);
  hoverState = holder;
}

function handleHover(event) {
  const now = performance.now();
  if (now - hoverAt < 90) return;
  hoverAt = now;
  const canvas = viewerCanvas();
  if (!canvas) return;
  const viewer = window.GeoIDViewer;
  // The drawing tools own the canvas while armed, and a highlight under a
  // half-drawn box is noise.
  if (viewer?.isMeasuring?.()) { clearHover(); return; }
  const at = viewer?.surfaceLatLonAt?.(event.clientX, event.clientY);
  if (!at) { clearHover(); if (canvas.style.cursor === "pointer") canvas.style.cursor = ""; return; }
  const hit = featureAt(at.lat, at.lon);
  if (!hit) {
    clearHover();
    if (canvas.style.cursor === "pointer") canvas.style.cursor = "";
    return;
  }
  canvas.style.cursor = "pointer";
  // Identity, so moving ALONG one cable does not rebuild its overlay every
  // 90 ms: a 60-part MultiLineString is real geometry to build.
  if (hit.feature === hoverFeature) return;
  hoverFeature = hit.feature;
  void showHover(hit.feature);
}

function showPopup(x, y, layerName, feature, layerRecord = null) {
  const host = ensurePopup();
  host.innerHTML = "";
  const props = feature.properties || {};

  const head = document.createElement("div");
  head.className = "gis-fp-head gis-fp-head-stacked";
  const title = document.createElement("span");
  // The planetary viewers' own class, so a unit clicked on Earth reads exactly
  // as one clicked on Mars: same face, weight and tracking, from the same rule
  // in styles.css rather than a second copy of it here.
  title.className = "gis-fp-title feature-title";
  title.textContent = titleOf(props);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gis-fp-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", hidePopup);
  head.append(title, close);

  // Kicker, title, meta, copy -- the planetary popup's own shape. A geological
  // unit says so above its name, which is what "Geologic unit" is doing in the
  // markup's #geo-popup that Earth never got to use.
  const kicker = document.createElement("p");
  kicker.className = "gis-fp-kicker feature-kicker";
  kicker.textContent = layerRecord?.geologyDataset ? "Geologic unit"
    : layerRecord?.ext === "drawn" ? "Drawn shape" : "Selected feature";

  const layer = document.createElement("div");
  layer.className = "gis-fp-layer feature-meta";
  layer.textContent = layerName;

  // The unit's own description, where the data carries one, in the place the
  // planetary popup puts it -- above the attribute table rather than lost
  // among fifty-seven rows of it.
  const copyText = props.rcs_d || props.bgstype || props.description || props.rock_d || "";
  const copy = document.createElement("p");
  copy.className = "gis-fp-copy feature-copy";
  copy.textContent = String(copyText || "");

  const list = document.createElement("dl");
  const rows = orderedEntries(props);
  rows.slice(0, 24).forEach(([key, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = fieldLabel(key);
    const dd = document.createElement("dd");
    /**
     * A value that IS a URL becomes a link, whatever column it came from.
     *
     * A record that cites its own source -- the volcano catalogue links every
     * entry to its GVP page and its photograph -- was printing that source as
     * unclickable text, which is the one form in which a citation is no use.
     * Read from the value rather than from a list of known columns, so any
     * dataset carrying a link gets the same treatment. `rel=noopener` because
     * these lead off the site; the text is elided by CSS, not by truncating
     * the href, so what opens is what was published.
     */
    const text = fieldValue(key, value);
    if (/^https?:\/\//i.test(text)) {
      const a = document.createElement("a");
      a.href = text;
      a.textContent = text.replace(/^https?:\/\/(www\.)?/i, "");
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "gis-fp-link";
      dd.appendChild(a);
    } else {
      dd.textContent = text;
    }
    list.append(dt, dd);
  });

  const detail = buildDetail(feature, props);
  // Kicker above the title, as the planetary card reads: the class of thing
  // first, then which one. The close button lives in the head row, so the head
  // stays where it is and the kicker is inserted into it rather than after.
  head.insertBefore(kicker, head.firstChild);
  head.insertBefore(title, kicker.nextSibling);
  host.append(head, layer, copy);
  if (detail) host.appendChild(detail);
  // Mars shows the curated fields and stops. Fifty-seven raw columns under them
  // is an attribute table wearing a popup's clothes -- so they fold, and the
  // summary above is what the card actually says.
  const more = document.createElement("details");
  more.className = "gis-fp-raw";
  const summary = document.createElement("summary");
  summary.textContent = `All ${rows.length} attributes`;
  more.append(summary, list);
  host.appendChild(more);
  // A shape you drew is yours to name and annotate; a shapefile somebody else
  // published is a record, and letting this popup rewrite its attributes would
  // be editing the source. So the editor is offered for drawn layers only.
  if (layerRecord?.ext === "drawn") {
    host.appendChild(buildEditor(layerRecord, feature, title));
  }
  if (rows.length > 24) {
    const more = document.createElement("div");
    more.className = "gis-fp-more";
    more.textContent = `+${rows.length - 24} more fields — the attribute table has all of them.`;
    host.appendChild(more);
  }

  host.hidden = false;
  // Place it beside the click, then pull it back inside the window. Measuring
  // after it is shown is the only way to know how tall it ended up.
  const box = host.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - box.width - 8);
  const top = Math.min(Math.max(8, y + 12), window.innerHeight - box.height - 8);
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

/* ── hit testing ────────────────────────────────────────────────────────── */

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function inBounds(point, coords, padDeg = 0) {
  // boundsOf answers {minX, minY, maxX, maxY} — an OBJECT, not the [w, s, e, n]
  // array the rest of the GeoJSON world uses. Indexing it numerically yields
  // undefined, every comparison is false, and the pre-filter then rejects every
  // feature on the globe: a hit test that silently never hits.
  const b = boundsOf(coords);
  if (!b || !Number.isFinite(b.minX)) return false;
  return point[0] >= b.minX - padDeg && point[0] <= b.maxX + padDeg
    && point[1] >= b.minY - padDeg && point[1] <= b.maxY + padDeg;
}

/** Distance from a point to a polyline, in metres, by nearest vertex-segment. */
function distanceToLine(point, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let t = 0;
    if (dx || dy) {
      t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy);
      t = Math.max(0, Math.min(1, t));
    }
    const near = [a[0] + t * dx, a[1] + t * dy];
    const d = haversineMetres(point, near);
    if (d < best) best = d;
  }
  return best;
}

function lineTolerance() {
  const metres = window.GeoIDViewer?.getZoomAltitudeMetres?.()?.metres;
  if (!Number.isFinite(metres)) return LINE_CEILING_M;
  // The view is roughly the altitude across, over a 60° field; 8 px of a
  // ~900 px canvas is therefore about altitude/110.
  const scaled = (metres / 110) * (LINE_PIXELS / 8);
  return Math.min(LINE_CEILING_M, Math.max(LINE_FLOOR_M, scaled));
}

/**
 * A DOT's hit radius is its drawn size, at any altitude — no ceiling.
 *
 * The line ceiling exists so an orbital click cannot select a river 400 km
 * away: a line is drawn at true ground width, so far away it is sub-pixel and
 * a big tolerance would be selecting the invisible. A marker dot is the
 * opposite kind of thing — drawn at a FIXED pixel size, so from orbit the dot
 * you can plainly see spans ~100 km of ground while the 20 km ceiling left
 * only its centre pixel clickable. Measured at the continental zoom: a 7 px
 * dot 90 km wide on the ground, a 20 km hit radius, and most of the visible
 * dot inert. The hit area is the drawn area, scaled a pixel generous.
 */
function pointToleranceMetres() {
  const metres = window.GeoIDViewer?.getZoomAltitudeMetres?.()?.metres;
  if (!Number.isFinite(metres)) return LINE_CEILING_M;
  // 12/8 rather than 9/8: the marker grows to ~12 px near the ground
  // (setMarkerSizeFromAltitude), and the hit area is the drawn area.
  return Math.max(LINE_FLOOR_M, (metres / 110) * (12 / 8));
}

/**
 * The feature under a coordinate, searching the visible vector layers from the
 * top of the stack down. Exported for the tests and for anything that wants to
 * ask without a click.
 */
/**
 * EVERY layer under a coordinate, topmost first.
 *
 * `featureAt` answers with the top hit alone, which is right for a stack of
 * unrelated imports and wrong for geology: superficial deposits lie over
 * bedrock by definition, so the top hit is the drift and the rock beneath it is
 * unreachable. Measured on the BGS sheets: **522 of 758 bedrock polygons could
 * not be clicked** -- 30.9% reachable -- while every one of them passed the
 * geometry test. Nothing was wrong with the hit test; the answer was being
 * thrown away.
 *
 * So the popup asks for all of them and shows a section per layer, which is
 * also what a geologist wants from one click: what is the cover, and what is
 * under it.
 */
export function featuresAt(lat, lon) {
  const layers = window.GeoIDImportManager?.getVectorLayers?.() || [];
  const point = [lon, lat];
  const tolerance = lineTolerance();
  const pointTolerance = pointToleranceMetres();
  const hits = [];
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer.visible === false) continue;
    if (layer.object3D && layer.object3D.visible === false) continue;
    /**
     * A layer may refuse ground picking outright. The satellites' feature
     * coordinates are live subsatellite points — the dot is at altitude and
     * the layer runs its own true-3D picker — so answering for them here put
     * the hover highlight and the click catchment on the SURFACE beneath the
     * dot, and a missed pill click then closed the card their own picker had
     * just opened.
     */
    if (layer.groundPick === false) continue;
    const found = featureInLayer(layer, point, tolerance, pointTolerance);
    if (found) hits.push({ layer, feature: found });
  }
  return hits;
}

/**
 * The feature in ONE layer under a point: a polygon that contains it, else the
 * nearest line within tolerance. Shared by both entry points so the "top hit"
 * and the "every hit" answers cannot disagree about what a hit is.
 */
function featureInLayer(layer, point, tolerance, pointTolerance = tolerance) {
  let nearest = null;
  for (const feature of layer.features || []) {
    const geometry = feature?.geometry;
    const polys = polygonsOf(geometry);
    for (const poly of polys) {
      if (!poly?.length || !inBounds(point, poly[0])) continue;
      if (pointInPolygon(point, poly)) return feature;
    }
    if (polys.length) continue;
    /**
     * POINTS ARE CLICKABLE TOO, and they were not.
     *
     * This searched polygons and lines and returned null for anything else, so
     * every point layer on the globe was inert: the world's volcanoes drew
     * 2,666 markers, each with a name, a type, an eruption history and a
     * paragraph of geology, and clicking one did nothing at all. Nothing said
     * so -- a click on empty ocean and a click on Vesuvius behaved identically.
     *
     * A point has no interior to be inside, so the test is distance, and the
     * tolerance is the same screen-derived one the lines use: a dot is drawn at
     * a fixed pixel size, so its hit area has to be a fixed pixel size too,
     * which in ground units means a radius that shrinks as you come in.
     */
    const pointCoords = pointsOf(geometry);
    for (const coord of pointCoords) {
      const d = haversineMetres(point, coord);
      if (d <= pointTolerance && (!nearest || d < nearest.d)) nearest = { d, feature };
    }
    if (pointCoords.length) continue;
    for (const line of linesOf(geometry)) {
      if (line.length < 2 || !inBounds(point, line, tolerance / 111000)) continue;
      const d = distanceToLine(point, line);
      if (d <= tolerance && (!nearest || d < nearest.d)) nearest = { d, feature };
    }
  }
  return nearest ? nearest.feature : null;
}

/** Every coordinate of a Point or MultiPoint geometry; nothing for the rest. */
function pointsOf(geometry) {
  const type = geometry?.type;
  if (type === "Point") return [geometry.coordinates];
  if (type === "MultiPoint") return geometry.coordinates || [];
  if (type === "GeometryCollection") {
    return (geometry.geometries || []).flatMap(pointsOf);
  }
  return [];
}

export function featureAt(lat, lon) {
  return featuresAt(lat, lon)[0] || null;
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

/**
 * A click that was really a drag must not open a popup — an orbit control
 * drag ends in a click event at the release point, and a globe you cannot
 * turn without popups appearing is worse than no popups.
 */
/**
 * The viewer's canvas, not merely the first canvas in the document.
 *
 * This page holds EIGHT canvases -- the profile plots, the meshing studio's
 * quality chart, the CSV plotter, the hemisphere locator -- and every one of
 * them is in the markup from the start, while the globe's is created by the
 * viewer's own async boot inside `#app`. `document.querySelector("canvas")`
 * therefore returned a hidden 0x0 chart, `install()` bound the click listener
 * to it and set `installed`, and the retry never ran again: clicking the globe
 * did nothing, for every vector layer, with no error anywhere.
 *
 * A zero-sized canvas is refused as well as an absent one, so a chart that
 * happens to sort first can never win this again.
 */
function viewerCanvas() {
  // The viewer's own renderer is the authoritative answer, and the globe's
  // canvas is always inside #app. Anything else is refused outright and the
  // bounded retry waits: taking "some canvas that has a size" was not enough,
  // because the 106x106 hemisphere locator has one and is created FIRST -- the
  // click listener spent its life on the corner mini-globe.
  const fromViewer = window.GeoIDViewer?.renderer?.domElement;
  if (fromViewer) return fromViewer;
  const inApp = document.querySelector?.("#app canvas");
  if (inApp) return inApp;
  // The unit test stubs a document with `querySelector` alone and no #app, so
  // its single canvas is taken there and nowhere else.
  if (typeof document.querySelectorAll !== "function") {
    return document.querySelector?.("canvas") || null;
  }
  return null;
}

function install() {
  if (installed) return;
  const canvas = viewerCanvas();
  if (!canvas) return;
  installed = true;

  let downAt = null;
  canvas.addEventListener("pointerdown", (event) => {
    downAt = { x: event.clientX, y: event.clientY };
  }, true);

  canvas.addEventListener("pointermove", handleHover);
  canvas.addEventListener("pointerleave", () => {
    clearHover();
    if (canvas.style.cursor === "pointer") canvas.style.cursor = "";
  });

  canvas.addEventListener("click", (event) => {
    const moved = downAt
      ? Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y)
      : 0;
    downAt = null;
    if (moved > 4) return;
    if (Date.now() < suppressUntil) return;
    // The Draw tool and the measure modes own the click while they are armed.
    if (window.GeoIDViewer?.isMeasuring?.()) return;
    /**
     * The viewer's own labels answer first.
     *
     * A dataset label and the feature it names occupy the same ground, so a
     * click on a volcano's name would raise the viewer's scene card AND this
     * popup's card for the same volcano — two answers to one question. The
     * viewer's card is the one anchored to its label, so where its raycaster
     * claims the click, this popup stays quiet.
     */
    const labelHit = window.GeoIDViewer?.interactiveFeatureAt?.(event.clientX, event.clientY);
    const claimedByLabel = Boolean(labelHit);
    const at = window.GeoIDViewer?.surfaceLatLonAt?.(event.clientX, event.clientY);
    if (!at && !claimedByLabel) { hidePopup(); return; }
    /**
     * The HIGHLIGHT does not care which card wins.
     *
     * A labelled layer's click is claimed by the viewer's own label path — it
     * opens the anchored scene card, and this popup stands down so one click
     * does not raise two cards. But standing down took the highlight with it,
     * so clicking a submarine cable named on the map lit nothing: the card
     * said which cable, and the map of three hundred lines gave no sign which
     * one it was. Marking what was picked belongs to the pick, not to whoever
     * draws the card, so it happens first and for both paths.
     */
    if (claimedByLabel) {
      /**
       * A label is not where its feature is, so pick at the ANCHOR.
       *
       * The chip is drawn beside the thing it names, sometimes a leader line
       * away — so `surfaceLatLonAt` at the CLICKED pixel answers with the
       * ground under the label, which for a submarine cable is open ocean
       * some way off the cable, and the highlight found nothing. The label's
       * own item carries the coordinate it was anchored to (for a line, the
       * middle vertex of its longest part), and that is on the feature by
       * construction.
       */
      const item = labelHit?.object?.userData?.feature;
      const anchor = Number.isFinite(item?.lat) && Number.isFinite(item?.lon)
        ? { lat: item.lat, lon: item.lon } : at;
      const claimed = anchor ? featuresAt(anchor.lat, anchor.lon)[0] : null;
      if (claimed) void showOutline(claimed.feature); else clearPin();
      return;
    }
    /**
     * Geology belongs to the viewer's own interactive path.
     *
     * `setGeologyInteractive` hands it the same catalogue Mars and the Moon
     * load from their manifests, so a click on a unit raises THAT card --
     * anchored to a pin, tracking the point as the globe turns. This popup
     * would otherwise put a second one beside it for the same click.
     *
     * Only what that catalogue actually contains, though: it is built from
     * POLYGONS, so a geology layer of lines -- the BGS fault traces -- is not in
     * it, and excluding those by their tab alone left a layer nothing could
     * answer for. A geology layer with no polygons keeps the ordinary card.
     */
    const hits = featuresAt(at.lat, at.lon)
      .filter((h) => !(h.layer.geologyDataset && layerHasPolygons(h.layer)));
    if (!hits.length) {
      // A click on nothing dismisses the selection wholesale — the card in
      // the corner, and the temporary label openSceneFeature raises for a
      // labelless dot. Leaving either standing is the "old popup lingers"
      // report: a reader clicks away to put a card down.
      window.GeoIDViewer?.clearSceneFlash?.();
      window.GeoIDViewer?.closeSceneFeature?.();
      hidePopup();
      return;
    }
    // Every layer under the point, not just the top one -- superficial deposits
    // lie over bedrock by definition, and answering with only the drift made
    // 522 of 758 bedrock polygons unclickable.
    showStack(event.clientX, event.clientY, hits, at);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePopup();
  });
}

/** Does this layer contribute polygons to the viewer's geology catalogue? */
function layerHasPolygons(layer) {
  if (layer._hasPolygons === undefined) {
    layer._hasPolygons = (layer.features || []).some((f) => {
      const t = f?.geometry?.type;
      return t === "Polygon" || t === "MultiPolygon";
    });
  }
  return layer._hasPolygons;
}

/** Ignore clicks for a moment — used by anything that takes over the canvas. */
export function suppress(ms = 600) {
  suppressUntil = Date.now() + ms;
}

// The canvas is created by the viewer's own async boot, so the first attempt
// usually misses it. The retry is BOUNDED — an unbounded one keeps a timer
// alive for the life of the page (and hangs node outright, where there is no
// canvas and never will be), which is how the unit run for this module first
// went silent for three minutes.
let attempts = 0;
function boot() {
  install();
  if (!installed && (attempts += 1) < 90) setTimeout(boot, 400);
}

if (typeof window !== "undefined") {
  window.GeoIDFeaturePopup = { featureAt, featuresAt, hidePopup, suppress, clearPin };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
