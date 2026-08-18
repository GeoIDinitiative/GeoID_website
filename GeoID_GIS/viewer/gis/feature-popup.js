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

import { pointInPolygon, boundsOf, haversineMetres } from "./geometry.js?v=20260818-9a89934";
import { sphericalPolygonAreaKm2 } from "./geo-utils.js?v=20260818-9a89934";

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

export function hidePopup() {
  if (popup) popup.hidden = true;
  clearPin();
}

/* Attributes worth leading with, in the order a geologist reads them. Anything
   not named here still shows, below these; nothing is hidden. */
const PREFERRED = [
  "name", "NAME", "lex_d", "rcs_d", "lex_rcs_d", "bgstype", "max_time_d",
  "min_time_d", "max_period", "min_period", "max_era", "age_onegl",
  "waterway", "value", "class", "unit", "description",
];

function titleOf(props) {
  for (const key of ["lex_d", "name", "NAME", "Name", "lex_rcs_d", "rcs_d", "id"]) {
    const v = props?.[key];
    if (v != null && String(v).trim()) return String(v);
  }
  return "Feature";
}

function orderedEntries(props) {
  const seen = new Set();
  const rows = [];
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
    rows.push([key, v]);
  });
  return rows;
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

function showStack(x, y, hits, at) {
  const [top, ...beneath] = hits;
  showPopup(x, y, top.layer.name || "Layer", top.feature, top.layer);
  const host = ensurePopup();
  beneath.forEach(({ layer, feature }) => {
    const head = document.createElement("div");
    head.className = "gis-fp-beneath";
    head.textContent = layer.name || "Layer";
    const list = document.createElement("dl");
    orderedEntries(feature.properties || {}).slice(0, 8).forEach(([key, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = String(value);
      list.append(dt, dd);
    });
    host.append(head, list);
  });
  if (beneath.length) {
    const note = document.createElement("div");
    note.className = "gis-fp-more";
    note.textContent = `${hits.length} layers at this point.`;
    host.appendChild(note);
  }
  // The pin and the outline go on the polygon that answered, which is the top
  // one -- the same feature the title names.
  if (at) void showPin(at.lat, at.lon, top.feature);
  // Re-measure: the stack made the popup taller than showPopup placed it for.
  const box = host.getBoundingClientRect();
  host.style.left = `${Math.min(Math.max(8, x + 14), window.innerWidth - box.width - 8)}px`;
  host.style.top = `${Math.min(Math.max(8, y + 12), window.innerHeight - box.height - 8)}px`;
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

async function showPin(lat, lon, feature) {
  const viewer = window.GeoIDViewer;
  const group = markerGroup();
  if (!viewer?.surfacePoint || !group) return;
  const THREE = await import("../vendor/three.module.js");

  clearPin();
  const holder = new THREE.Group();
  holder.name = "GeoID-FeaturePin";

  /**
   * The pin is sized from the VIEW, not in scene units.
   *
   * A fixed 0.012 radius is 0.4% of the globe, which is about 48 km across --
   * from orbit an invisible speck and over Northern Ireland a magenta blob a
   * third the width of the country, painted over the map it was meant to point
   * at. Same class of mistake as the measure marker's fixed lift that CLAUDE.md
   * records: a constant in scene units is a different thing at every altitude.
   *
   * Sized as a fraction of the distance from the camera to the point, it
   * subtends a constant small angle and therefore looks the same at every zoom.
   */
  const anchor = viewer.surfacePoint(lat, lon, 0.001);
  const viewDistance = viewer.camera
    ? Math.max(0.02, viewer.camera.position.distanceTo(anchor)) : 1;
  // No upper cap: a ceiling in scene units is the very thing being fixed, and
  // it re-broke the far view -- clamped at 0.012 the pin subtended a tenth of
  // the angle from orbit that it did up close. 0.006 of the view distance is
  // about 0.7 degrees across, roughly fourteen pixels, at every altitude. The
  // floor only stops it vanishing when the camera is almost on the ground.
  const headRadius = Math.max(0.0004, viewDistance * 0.006);
  const stemLength = headRadius * 4;

  const base = viewer.surfacePoint(lat, lon, 0.001);
  const top = viewer.surfacePoint(lat, lon, 0.001 + stemLength);
  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([base, top]),
    new THREE.LineBasicMaterial({ color: 0xff2bd6, depthTest: false, transparent: true }),
  );
  stem.renderOrder = 240;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headRadius, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xff2bd6, depthTest: false, transparent: true }),
  );
  head.position.copy(top);
  head.renderOrder = 241;
  holder.add(stem, head);

  // The outline of the polygon that answered, drawn on the ground. Long edges
  // are split for the same reason every other surface line is: a straight chord
  // across 1 degree of arc already dips below the terrain.
  const rings = feature?.geometry
    ? (feature.geometry.type === "Polygon" ? feature.geometry.coordinates
      : feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates.flat() : [])
    : [];
  rings.slice(0, 24).forEach((ring) => {
    const points = [];
    for (let i = 0; i < ring.length; i += 1) {
      const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
      const steps = Math.max(1, Math.ceil(
        Math.max(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) / 1,
      ));
      for (let k = 0; k < steps; k += 1) {
        const t = k / steps;
        points.push(viewer.surfacePoint(a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t, 0.004));
      }
    }
    if (points.length < 2) return;
    const loop = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    loop.renderOrder = 239;
    holder.add(loop);
  });

  group.add(holder);
  pinState = holder;
}

export function clearPin() {
  if (!pinState) return;
  pinState.parent?.remove(pinState);
  pinState.traverse?.((n) => { n.geometry?.dispose?.(); n.material?.dispose?.(); });
  pinState = null;
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
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
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
  const hits = [];
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer.visible === false) continue;
    if (layer.object3D && layer.object3D.visible === false) continue;
    const found = featureInLayer(layer, point, tolerance);
    if (found) hits.push({ layer, feature: found });
  }
  return hits;
}

/**
 * The feature in ONE layer under a point: a polygon that contains it, else the
 * nearest line within tolerance. Shared by both entry points so the "top hit"
 * and the "every hit" answers cannot disagree about what a hit is.
 */
function featureInLayer(layer, point, tolerance) {
  let nearest = null;
  for (const feature of layer.features || []) {
    const geometry = feature?.geometry;
    const polys = polygonsOf(geometry);
    for (const poly of polys) {
      if (!poly?.length || !inBounds(point, poly[0])) continue;
      if (pointInPolygon(point, poly)) return feature;
    }
    if (polys.length) continue;
    for (const line of linesOf(geometry)) {
      if (line.length < 2 || !inBounds(point, line, tolerance / 111000)) continue;
      const d = distanceToLine(point, line);
      if (d <= tolerance && (!nearest || d < nearest.d)) nearest = { d, feature };
    }
  }
  return nearest ? nearest.feature : null;
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

  canvas.addEventListener("click", (event) => {
    const moved = downAt
      ? Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y)
      : 0;
    downAt = null;
    if (moved > 4) return;
    if (Date.now() < suppressUntil) return;
    // The Draw tool and the measure modes own the click while they are armed.
    if (window.GeoIDViewer?.isMeasuring?.()) return;
    const at = window.GeoIDViewer?.surfaceLatLonAt?.(event.clientX, event.clientY);
    if (!at) { hidePopup(); return; }
    /**
     * Geology belongs to the viewer's own interactive path.
     *
     * `setGeologyInteractive` hands it the same catalogue Mars and the Moon
     * load from their manifests, so a click on a unit raises THAT card --
     * anchored to a pin, tracking the point as the globe turns. This popup
     * would otherwise put a second one beside it for the same click.
     */
    const hits = featuresAt(at.lat, at.lon).filter((h) => !h.layer.geologyDataset);
    if (!hits.length) { hidePopup(); return; }
    // Every layer under the point, not just the top one -- superficial deposits
    // lie over bedrock by definition, and answering with only the drift made
    // 522 of 758 bedrock polygons unclickable.
    showStack(event.clientX, event.clientY, hits, at);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePopup();
  });
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
