/**
 * Editing v1 — digitise, vertex edit, snap, undo (Phase 7).
 *
 * Two halves, deliberately separated:
 *
 * 1. A PURE core with no DOM, no globe and no window — `makeEditSession`,
 *    `snapTo`, `nearestVertex`, `buildGeometry`, `pendingGeometry`,
 *    `pickToleranceDeg`, `signedLon`. Everything that can be wrong in a way a
 *    screenshot will not show lives here, and `edit-tools.test.mjs` runs it
 *    under node with no browser at all.
 * 2. A UI half — `window.GeoIDEditTools = { start, finish, cancel }` — which is
 *    a thin driver over that core plus the viewer's own pick seam.
 *
 * **Clicks route through `window.GeoIDViewer.pickOnGlobe()`**, the one-shot
 * picker every viewer already exposes and the same one the Research bridge
 * fills coordinate fields with (`research/bridge.js:284`). It resolves with the
 * viewer's own east-positive 0..360 longitude and rejects on Escape, so a
 * digitising session is a loop over one-shot picks rather than a second
 * click-handling path that would have to re-derive the inverse the cursor
 * readout uses. Longitude is converted to signed −180..180 on the way in,
 * because GeoJSON means signed and `buildVectorLayerResult`'s own point-in-
 * polygon sampler already assumes it.
 *
 * **The source layer is never mutated.** The session edits a deep copy and
 * `finish()` publishes the result as a NEW derived layer, `edit_<name>`, through
 * the same `buildVectorLayerResult` + `addDerivedLayer` seam every tool uses —
 * so an edit is undoable by deleting a layer, and the thing that was imported
 * is still on disk and still on the globe.
 *
 * **A world with no pick seam is a fact about the body, not a gap.** The four
 * gas giants have no surface to click, so `start()` renders the toolbar, says
 * so, and disables every control that would need a click rather than offering
 * buttons that quietly do nothing.
 *
 * Cross-module code is loaded by DYNAMIC import (vector-render pulls in three.js
 * and the globe) so this module still parses, still registers its seam and is
 * still node-testable when neither is present — the tool-dialog.js pattern.
 */

/* ══ PURE CORE ═══════════════════════════════════════════════════════════════
   Nothing below this line until "UI" touches document, window or the network.
   ═════════════════════════════════════════════════════════════════════════ */

/** How many snapshots an edit session keeps. Older ones are dropped, so a long
    session cannot grow without bound; 50 is deep enough that undo feels
    unlimited and shallow enough that a big collection stays cheap. */
export const MAX_SNAPSHOTS = 50;

/** The pick tolerance when the viewer cannot say how high the camera is. */
export const DEFAULT_PICK_TOLERANCE_DEG = 1;

const MIN_PICK_TOLERANCE_DEG = 0.0002;
const MAX_PICK_TOLERANCE_DEG = 5;
/** A click is good to roughly a tenth of what is on screen, and the visible
    span at altitude h is about h (a ~50° field of view gives 0.93h). */
const PICK_FRACTION = 0.1;
const KM_PER_DEG = 111.32;

/** East-positive 0..360 (what every viewer carries) to the signed −180..180
    that GeoJSON, EPSG:4326 and the project schema all mean. 180 lands on −180,
    which is the same meridian. */
export function signedLon(lon) {
  return ((Number(lon) % 360) + 540) % 360 - 180;
}

/** Structural copy that preserves what JSON would not (NaN, −0, undefined
    properties), because a snapshot must restore the state that was, not a
    normalised version of it. */
function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = copyValue(value[key]);
    return out;
  }
  return value;
}

const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);

function isPosition(p) {
  return Array.isArray(p) && p.length >= 2 && isFiniteNumber(Number(p[0]))
    && isFiniteNumber(Number(p[1])) && p[0] !== null && p[1] !== null
    && p[0] !== "" && p[1] !== "";
}

const clonePosition = (p) => [Number(p[0]), Number(p[1])];

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (message) => ({ ok: false, message });

/** An FC, an array of features or nothing, as a fresh FeatureCollection. */
function normaliseCollection(fc) {
  const features = Array.isArray(fc) ? fc : (Array.isArray(fc?.features) ? fc.features : []);
  return { type: "FeatureCollection", features: features.map(copyValue) };
}

/**
 * The editable parts of a geometry, in document order, as LIVE arrays inside
 * it — so writing into `coords` edits the geometry.
 *
 * `ringOrLineIndex` addresses this list: ring 1 of a Polygon is its first hole,
 * and a MultiPolygon's rings are flattened across its polygons in order, which
 * is what makes one integer enough for every type. `min` is the shortest the
 * part may become and still be that geometry — 4 for a closed ring (three
 * corners plus the repeat), 2 for a line, 1 for a bag of points.
 *
 * A Point has no such array (its `coordinates` IS a position) and is handled by
 * the ops directly.
 */
function partsOf(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  const coords = geometry.coordinates;
  if (!Array.isArray(coords)) return [];
  switch (geometry.type) {
    case "MultiPoint": return [{ coords, closed: false, min: 1 }];
    case "LineString": return [{ coords, closed: false, min: 2 }];
    case "MultiLineString": return coords.map((line) => ({ coords: line, closed: false, min: 2 }));
    case "Polygon": return coords.map((ring) => ({ coords: ring, closed: true, min: 4 }));
    case "MultiPolygon":
      return coords.flatMap((polygon) => (Array.isArray(polygon) ? polygon : [])
        .map((ring) => ({ coords: ring, closed: true, min: 4 })));
    default: return [];
  }
}

const KNOWN_TYPES = new Set([
  "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon",
]);

/** Every position in a geometry, with the address that reaches it. Closed
    rings do NOT report their repeated closing vertex: it is the same corner as
    index 0, and offering it twice means a click near that corner picks the
    copy, moves it, and tears the ring open. */
function eachVertex(geometry, visit) {
  if (!geometry) return;
  if (geometry.type === "Point") {
    if (isPosition(geometry.coordinates)) visit(geometry.coordinates, 0, 0);
    return;
  }
  partsOf(geometry).forEach((part, partIndex) => {
    const last = part.coords.length - 1;
    part.coords.forEach((position, vertexIndex) => {
      if (part.closed && vertexIndex === last && last > 0) return;
      if (isPosition(position)) visit(position, partIndex, vertexIndex);
    });
  });
}

/**
 * Distance between two lon/lat positions in degrees on the graticule, taking
 * the short way round the antimeridian.
 *
 * This is deliberately NOT scaled by cos(latitude): the parameter is called a
 * tolerance in DEGREES and that is what it is measured in. Worth knowing before
 * quoting it as a ground distance — at 60° north a 0.01° tolerance reaches
 * 1.11 km north-south and 0.56 km east-west.
 */
export function degreeDistance(a, b) {
  // signedLon is exactly the wrap this needs: a difference of 359.98° between
  // 179.99 and −179.99 is 0.02° of ground, and the unwrapped form would call
  // two vertices either side of the antimeridian the furthest apart on Earth.
  const dLon = signedLon(Number(b[0]) - Number(a[0]));
  const dLat = Number(b[1]) - Number(a[1]);
  return Math.hypot(dLon, dLat);
}

/**
 * The vertex of `fc` closest to `position`, or null when there is none.
 *
 * Returns `{featureIndex, ringOrLineIndex, vertexIndex, position, distanceDeg}`
 * — the address the vertex ops take, so a click resolves straight into an op.
 * `position` is a copy; mutating it cannot reach the collection.
 */
export function nearestVertex(fc, position) {
  if (!isPosition(position)) return null;
  const features = Array.isArray(fc?.features) ? fc.features : [];
  let best = null;
  features.forEach((feature, featureIndex) => {
    eachVertex(feature?.geometry, (vertex, ringOrLineIndex, vertexIndex) => {
      const distanceDeg = degreeDistance(position, vertex);
      if (best && distanceDeg >= best.distanceDeg) return;
      best = {
        featureIndex, ringOrLineIndex, vertexIndex,
        position: clonePosition(vertex), distanceDeg,
      };
    });
  });
  return best;
}

/**
 * `position` snapped to the nearest existing vertex within `toleranceDeg`, or
 * the input unchanged.
 *
 * On a miss the INPUT ARRAY ITSELF comes back (identity, not a copy), so a
 * caller can tell a snap from a pass-through without comparing floats. On a hit
 * the result is a copy of the vertex, never the collection's own array.
 */
export function snapTo(fc, position, toleranceDeg) {
  const tolerance = Number(toleranceDeg);
  if (!isPosition(position) || !Number.isFinite(tolerance) || tolerance <= 0) return position;
  const hit = nearestVertex(fc, position);
  if (!hit || hit.distanceDeg > tolerance) return position;
  return hit.position;
}

/**
 * How near a click has to be to count as hitting a vertex, given the camera's
 * altitude in metres. Clamped at both ends: a tolerance larger than the screen
 * grabs vertices nobody aimed at, and one smaller than a pixel is unclickable.
 * A viewer that cannot say how high it is gets the documented default.
 */
export function pickToleranceDeg(altitudeMetres) {
  const metres = Number(altitudeMetres);
  if (!Number.isFinite(metres) || metres <= 0) return DEFAULT_PICK_TOLERANCE_DEG;
  const degrees = ((metres / 1000) * PICK_FRACTION) / KM_PER_DEG;
  return Math.min(MAX_PICK_TOLERANCE_DEG, Math.max(MIN_PICK_TOLERANCE_DEG, degrees));
}

const samePosition = (a, b) => Number(a[0]) === Number(b[0]) && Number(a[1]) === Number(b[1]);

/**
 * The geometry a finished digitising run produces: "point" from one position,
 * "line" from two or more, "polygon" from three or more with the ring closed
 * here rather than by the user clicking the first corner again. Returns null
 * when there are not enough positions — a two-corner polygon is not a shape,
 * and silently making one is how a layer ends up with slivers.
 */
export function buildGeometry(mode, positions) {
  const list = (Array.isArray(positions) ? positions : []).filter(isPosition).map(clonePosition);
  if (mode === "point") {
    return list.length ? { type: "Point", coordinates: list[0] } : null;
  }
  if (mode === "line") {
    return list.length >= 2 ? { type: "LineString", coordinates: list } : null;
  }
  if (mode === "polygon") {
    if (list.length < 3) return null;
    const ring = list.slice();
    if (!samePosition(ring[0], ring[ring.length - 1])) ring.push(clonePosition(ring[0]));
    if (ring.length < 4) return null;
    return { type: "Polygon", coordinates: [ring] };
  }
  return null;
}

/**
 * What to DRAW while a shape is still being clicked out — one pending vertex is
 * a point, two are a line whichever mode is running, and a polygon only closes
 * once it has three. Preview only: it is never applied to the session, so a
 * half-finished polygon is visible without ever becoming a feature.
 */
export function pendingGeometry(mode, positions) {
  const list = (Array.isArray(positions) ? positions : []).filter(isPosition);
  if (!list.length) return null;
  if (list.length === 1) return buildGeometry("point", list);
  if (mode === "polygon" && list.length >= 3) return buildGeometry("polygon", list);
  return buildGeometry("line", list);
}

/* ── the ops ──────────────────────────────────────────────────────────────── */

/**
 * Op constructors. An op is a plain object, so it can be logged, replayed and
 * compared; `apply` also accepts one written out by hand. The vertex address is
 * `ringOrLineIndex` as the spec names it (`partIndex` is accepted as an alias,
 * because that is what the internals call it).
 */
export const ops = {
  addFeature: (geometry, properties = {}) => ({ type: "addFeature", geometry, properties }),
  moveVertex: (featureIndex, ringOrLineIndex, vertexIndex, position) =>
    ({ type: "moveVertex", featureIndex, ringOrLineIndex, vertexIndex, position }),
  insertVertex: (featureIndex, ringOrLineIndex, afterIndex, position) =>
    ({ type: "insertVertex", featureIndex, ringOrLineIndex, afterIndex, position }),
  deleteVertex: (featureIndex, ringOrLineIndex, vertexIndex) =>
    ({ type: "deleteVertex", featureIndex, ringOrLineIndex, vertexIndex }),
  deleteFeature: (index) => ({ type: "deleteFeature", index }),
};

function resolveFeature(fc, index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= fc.features.length) return null;
  return fc.features[i];
}

function resolvePart(feature, op) {
  const index = Number(op.ringOrLineIndex ?? op.partIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  return partsOf(feature.geometry)[index] || null;
}

/** Re-close a ring after its first vertex changed or went away. */
function closeRing(coords) {
  if (coords.length > 1) coords[coords.length - 1] = clonePosition(coords[0]);
}

function applyOp(fc, op) {
  if (!op || typeof op !== "object") return fail("No operation given.");
  switch (op.type) {
    case "addFeature": {
      const geometry = op.geometry;
      if (!geometry || !KNOWN_TYPES.has(geometry.type)) {
        return fail("That is not a geometry this editor can add.");
      }
      if (geometry.type === "Point" ? !isPosition(geometry.coordinates)
        : !partsOf(geometry).some((part) => part.coords.length >= part.min)) {
        return fail("That geometry has too few vertices to be a feature.");
      }
      fc.features.push({
        type: "Feature",
        geometry: copyValue(geometry),
        properties: op.properties ? copyValue(op.properties) : {},
      });
      return ok({ featureIndex: fc.features.length - 1 });
    }
    case "deleteFeature": {
      const i = Number(op.index);
      if (!Number.isInteger(i) || i < 0 || i >= fc.features.length) {
        return fail("No feature at that index.");
      }
      fc.features.splice(i, 1);
      return ok({ featureIndex: i });
    }
    case "moveVertex": {
      const feature = resolveFeature(fc, op.featureIndex);
      if (!feature?.geometry) return fail("No feature at that index.");
      if (!isPosition(op.position)) return fail("A vertex needs a finite lon/lat.");
      const position = clonePosition(op.position);
      if (feature.geometry.type === "Point") {
        if (Number(op.ringOrLineIndex ?? op.partIndex) !== 0 || Number(op.vertexIndex) !== 0) {
          return fail("A point has one vertex, addressed (0, 0).");
        }
        feature.geometry.coordinates = position;
        return ok();
      }
      const part = resolvePart(feature, op);
      if (!part) return fail("No ring or line at that index.");
      const vertexIndex = Number(op.vertexIndex);
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= part.coords.length) {
        return fail("No vertex at that index.");
      }
      part.coords[vertexIndex] = position;
      // A closed ring's first and last vertices are the same corner; moving one
      // without the other tears the ring open, and it renders as a gap that
      // looks like a rendering bug rather than an edit.
      if (part.closed) {
        const last = part.coords.length - 1;
        if (vertexIndex === 0) part.coords[last] = clonePosition(position);
        else if (vertexIndex === last) part.coords[0] = clonePosition(position);
      }
      return ok();
    }
    case "insertVertex": {
      const feature = resolveFeature(fc, op.featureIndex);
      if (!feature?.geometry) return fail("No feature at that index.");
      if (feature.geometry.type === "Point") return fail("A point cannot take another vertex.");
      if (!isPosition(op.position)) return fail("A vertex needs a finite lon/lat.");
      const part = resolvePart(feature, op);
      if (!part) return fail("No ring or line at that index.");
      const afterIndex = Number(op.afterIndex);
      if (!Number.isInteger(afterIndex) || afterIndex < 0 || afterIndex >= part.coords.length) {
        return fail("No vertex at that index to insert after.");
      }
      // Inserting after a ring's closing vertex means inserting on the last
      // edge, not after the closure — the closure must stay last.
      let at = afterIndex + 1;
      if (part.closed && at > part.coords.length - 1) at = part.coords.length - 1;
      part.coords.splice(at, 0, clonePosition(op.position));
      return ok({ vertexIndex: at });
    }
    case "deleteVertex": {
      const feature = resolveFeature(fc, op.featureIndex);
      if (!feature?.geometry) return fail("No feature at that index.");
      if (feature.geometry.type === "Point") {
        return fail("A point has a single vertex — delete the feature instead.");
      }
      const part = resolvePart(feature, op);
      if (!part) return fail("No ring or line at that index.");
      const vertexIndex = Number(op.vertexIndex);
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= part.coords.length) {
        return fail("No vertex at that index.");
      }
      if (part.coords.length <= part.min) {
        return fail(part.closed
          ? "A ring needs three corners — delete the feature instead."
          : "A line needs two vertices — delete the feature instead.");
      }
      const last = part.coords.length - 1;
      if (part.closed && (vertexIndex === 0 || vertexIndex === last)) {
        // Both ends are the same corner: drop the first and re-close on what is
        // now the first, which keeps the ring valid whichever end was clicked.
        part.coords.splice(0, 1);
        closeRing(part.coords);
      } else {
        part.coords.splice(vertexIndex, 1);
      }
      return ok();
    }
    default:
      return fail(`Unknown edit operation "${op?.type}".`);
  }
}

/**
 * An edit session over a copy of `fc`, with snapshot undo/redo.
 *
 * Snapshot rather than inverse-op undo: an op is small but its inverse is not
 * always expressible (deleting a ring's first vertex re-closes the ring, so
 * "undo" is not "insert it back"), and a whole-collection copy of an editable
 * layer is cheap. The cap is what keeps that true — `MAX_SNAPSHOTS` deep, oldest
 * dropped.
 *
 * A REFUSED op leaves the stacks untouched, so pressing undo after a rejected
 * click undoes the last real edit rather than nothing.
 */
export function makeEditSession(fc, { limit = MAX_SNAPSHOTS } = {}) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : MAX_SNAPSHOTS;
  let current = normaliseCollection(fc);
  const past = [];
  const future = [];

  const push = (stack, snapshot) => {
    stack.push(snapshot);
    if (stack.length > cap) stack.shift();
  };

  return {
    /** Run an op. Returns {ok, message?} — check it; a refusal is not an
        exception because a mis-aimed click is ordinary. */
    apply(op) {
      const next = copyValue(current);
      const result = applyOp(next, op);
      if (!result.ok) return result;
      push(past, current);
      current = next;
      future.length = 0;
      return result;
    },
    undo() {
      if (!past.length) return false;
      future.push(current);
      current = past.pop();
      return true;
    },
    redo() {
      if (!future.length) return false;
      push(past, current);
      current = future.pop();
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    /** How much history there is, for a toolbar that wants to say so. */
    depth: () => ({ undo: past.length, redo: future.length }),
    count: () => current.features.length,
    /** A COPY of the edited collection: the session cannot be corrupted by
        whatever the caller does with what it hands out. */
    collection: () => copyValue(current),
  };
}

/* ══ UI ══════════════════════════════════════════════════════════════════════
   Everything below needs a document, a globe and the import manager.
   ═════════════════════════════════════════════════════════════════════════ */

const VECTOR_RENDER_URL = "./vector-render.js?v=20260904-73b249a";

/* NEVER a backtick inside this literal — it ends the string and kills the
   module silently. Geometry and layout only: viewer-skin.css paints .button
   and .input with !important and restating a colour here loses. */
const STYLE = `
.gis-edit-toolbar {
  position: fixed;
  right: 60px;
  bottom: 7rem;
  width: 268px;
  max-width: calc(100vw - 2rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 30;
  background: rgba(10, 2, 14, 0.92);
  border: 1px solid rgba(var(--nav-accent-rgb), 0.34);
  border-radius: 10px;
  color: var(--text);
  box-sizing: border-box;
}
.gis-edit-toolbar[hidden] { display: none; }
.gis-edit-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem 0.35rem 0.75rem;
  border-bottom: 1px solid rgba(var(--nav-accent-rgb), 0.2);
}
.gis-edit-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--text);
  font-size: 0.76rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: "Exo 2", "Segoe UI", sans-serif;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gis-edit-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 2px 4px;
  color: inherit;
  opacity: 0.6;
}
.gis-edit-close:hover { opacity: 1; }
.gis-edit-body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem 0.55rem 0.7rem;
}
.gis-edit-modes { flex-wrap: wrap; }
.gis-edit-toolbar .gis-edit-modes .button,
.gis-edit-toolbar .gis-edit-modes .tool-button { flex: 1 1 46%; }
.gis-edit-source {
  font-size: 0.68rem;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.dataset.gisEditTools = "";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/** The modes that consume globe clicks, and what each does with one. */
const PICK_MODES = new Set(["point", "line", "polygon", "move", "deleteVertex"]);

const ui = {
  session: null,
  layer: null,          // the SOURCE layer record; never mutated
  mode: null,
  pending: [],          // positions clicked so far in line/polygon mode
  snap: true,
  moveFrom: null,       // the vertex address picked first in move mode
  root: null,
  status: null,
  source: null,
  buttons: {},
  snapBox: null,
  picking: false,
  pickable: false,
  preview: null,        // the derived layer showing the edit in progress
  previewToken: 0,
  keyBound: false,
};

const MODES = [
  { id: "point", label: "Add point" },
  { id: "line", label: "Add line" },
  { id: "polygon", label: "Add polygon" },
  { id: "move", label: "Move vertex" },
  { id: "deleteVertex", label: "Delete vertex" },
];

function say(text) {
  if (ui.status) ui.status.textContent = text;
}

function viewer() {
  return typeof window !== "undefined" ? window.GeoIDViewer : null;
}

function manager() {
  return typeof window !== "undefined" ? window.GeoIDImportManager : null;
}

/** True when this world can be clicked at all — the gas giants cannot. */
function hasPickSeam() {
  return typeof viewer()?.pickOnGlobe === "function";
}

/** The camera's height, however this viewer reports it (a number on some
    seams, {metres, targetMetres} on the ones with an eased zoom). */
function altitudeMetres() {
  try {
    const raw = viewer()?.getZoomAltitudeMetres?.();
    if (typeof raw === "number") return raw;
    if (raw && typeof raw === "object") return Number(raw.metres);
  } catch {
    /* an unhelpful seam is not a failure; the default tolerance covers it */
  }
  return NaN;
}

const tolerance = () => pickToleranceDeg(altitudeMetres());

function findLayer(ref) {
  if (ref && typeof ref === "object") return ref;
  const layers = manager()?.getLayers?.() || [];
  return layers.find((layer) => String(layer.id) === String(ref)) || null;
}

const baseName = (name) => String(name || "layer").replace(/\.[^.]+$/, "");

/** edit_<name>, stepped past any collision the way tool-runner names outputs. */
function outputName() {
  const wanted = `edit_${baseName(ui.layer?.name)}`;
  const taken = new Set((manager()?.getLayers?.() || []).map((layer) => layer.name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 10000; n += 1) {
    if (!taken.has(`${wanted}_${n}`)) return `${wanted}_${n}`;
  }
  return wanted;
}

/* ── the toolbar ──────────────────────────────────────────────────────────── */

function button(label, className, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

function buildToolbar() {
  if (ui.root) return ui.root;
  injectStyle();
  const panel = document.createElement("section");
  panel.className = "gis-edit-toolbar";
  panel.id = "gis-edit-toolbar";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Edit layer");

  const head = document.createElement("div");
  head.className = "gis-edit-head";
  const title = document.createElement("span");
  title.className = "gis-edit-title";
  title.textContent = "Edit layer";
  const close = button("✕", "gis-edit-close", () => cancel());
  close.title = "Cancel editing";
  close.setAttribute("aria-label", "Cancel editing");
  head.append(title, close);

  const body = document.createElement("div");
  body.className = "gis-edit-body";

  ui.source = document.createElement("div");
  ui.source.className = "gis-edit-source gis-metric";
  body.appendChild(ui.source);

  const modes = document.createElement("div");
  modes.className = "gis-btn-row gis-edit-modes";
  MODES.forEach((mode) => {
    const node = button(mode.label, "button secondary", () => setMode(mode.id));
    ui.buttons[mode.id] = node;
    modes.appendChild(node);
  });
  body.appendChild(modes);

  const history = document.createElement("div");
  history.className = "gis-btn-row";
  ui.buttons.undo = button("Undo", "button secondary", () => {
    if (!ui.session?.undo()) { say("Nothing to undo."); return; }
    ui.moveFrom = null;
    afterChange("Undone.");
  });
  ui.buttons.redo = button("Redo", "button secondary", () => {
    if (!ui.session?.redo()) { say("Nothing to redo."); return; }
    ui.moveFrom = null;
    afterChange("Redone.");
  });
  history.append(ui.buttons.undo, ui.buttons.redo);
  body.appendChild(history);

  const snapRow = document.createElement("label");
  snapRow.className = "row";
  snapRow.htmlFor = "gis-edit-snap";
  const snapLabel = document.createElement("span");
  snapLabel.textContent = "Snap to vertices";
  ui.snapBox = document.createElement("input");
  ui.snapBox.type = "checkbox";
  ui.snapBox.id = "gis-edit-snap";
  ui.snapBox.checked = ui.snap;
  ui.snapBox.addEventListener("change", () => {
    ui.snap = ui.snapBox.checked;
    say(ui.snap ? "Snapping on." : "Snapping off.");
  });
  snapRow.append(snapLabel, ui.snapBox);
  body.appendChild(snapRow);

  const actions = document.createElement("div");
  actions.className = "gis-btn-row";
  ui.buttons.finish = button("Finish", "tool-button", () => { finish(); });
  ui.buttons.cancel = button("Cancel", "button secondary", () => cancel());
  actions.append(ui.buttons.finish, ui.buttons.cancel);
  body.appendChild(actions);

  ui.status = document.createElement("div");
  ui.status.className = "gis-metric";
  ui.status.id = "gis-edit-status";
  ui.status.setAttribute("aria-live", "polite");
  body.appendChild(ui.status);

  panel.append(head, body);
  document.body.appendChild(panel);
  ui.root = panel;
  return panel;
}

function paintModes() {
  MODES.forEach((mode) => {
    const node = ui.buttons[mode.id];
    if (!node) return;
    // Active state through the classes the house already has, so the skin keeps
    // ownership of every colour on the page.
    node.className = ui.mode === mode.id ? "tool-button" : "button secondary";
    node.setAttribute("aria-pressed", ui.mode === mode.id ? "true" : "false");
    node.disabled = !ui.pickable;
  });
  if (ui.buttons.undo) ui.buttons.undo.disabled = !ui.session?.canUndo();
  if (ui.buttons.redo) ui.buttons.redo.disabled = !ui.session?.canRedo();
  if (ui.buttons.finish) ui.buttons.finish.disabled = !ui.pickable;
  if (ui.snapBox) ui.snapBox.disabled = !ui.pickable;
}

function describe(extra = "") {
  const count = ui.session?.count() ?? 0;
  const bits = [`${count} feature${count === 1 ? "" : "s"}`];
  if (ui.pending.length) {
    bits.push(`${ui.pending.length} pending vertex${ui.pending.length === 1 ? "" : "es"}`);
    bits.push("Enter closes, Escape cancels");
  } else if (ui.mode === "point") bits.push("click to place a point");
  else if (ui.mode === "line" || ui.mode === "polygon") bits.push("click to start");
  else if (ui.mode === "move") bits.push(ui.moveFrom ? "click where it goes" : "click a vertex");
  else if (ui.mode === "deleteVertex") bits.push("click a vertex to remove");
  return `${extra ? `${extra} ` : ""}${bits.join(" · ")}`;
}

function afterChange(message = "") {
  paintModes();
  say(describe(message));
  refreshPreview();
}

/* ── the live preview layer ───────────────────────────────────────────────── */

let renderModule = null;
async function loadRenderer() {
  if (renderModule) return renderModule;
  try {
    renderModule = await import(VECTOR_RENDER_URL);
  } catch (error) {
    console.error("[GeoID GIS] edit-tools: vector-render.js did not load", error);
    renderModule = null;
  }
  return renderModule;
}

function clearPreview() {
  const remove = manager()?.removeLayer;
  if (ui.preview && typeof remove === "function") {
    try { remove(ui.preview.id); } catch { /* a gone layer is already clear */ }
  }
  ui.preview = null;
}

/**
 * Redraw the edit in progress as one derived layer, rebuilt in place.
 *
 * It is a layer rather than bespoke geometry so it inherits the draw-order
 * stack, visibility and removal for nothing — and so cancelling leaves the
 * scene exactly as it was found. The token guards the async gap: two clicks in
 * flight must not leave two previews on the globe.
 */
async function refreshPreview() {
  // Called from synchronous handlers, so it must never reject: a rejected
  // promise nobody awaits is an unhandled rejection, and a preview is a
  // courtesy — losing it must not take the session with it.
  try {
    if (!ui.session || !ui.pickable) return;
    const mod = await loadRenderer();
    const add = manager()?.addDerivedLayer;
    if (!mod?.buildVectorLayerResult || typeof add !== "function") return;
    ui.previewToken += 1;
    const token = ui.previewToken;
    const fc = ui.session.collection();
    const provisional = pendingGeometry(ui.mode, ui.pending);
    if (provisional) {
      fc.features.push({ type: "Feature", geometry: provisional, properties: { pending: true } });
    }
    const name = `${baseName(ui.layer?.name)} (editing)`;
    const result = mod.buildVectorLayerResult(fc, { name, drape: 0.01 });
    if (token !== ui.previewToken || !ui.session) return;
    clearPreview();
    ui.preview = add(name, result, "edit") || null;
  } catch (error) {
    console.error("[GeoID GIS] edit preview failed", error);
  }
}

/* ── clicks ───────────────────────────────────────────────────────────────── */

function setMode(mode) {
  if (!ui.session || !ui.pickable) return;
  if (ui.mode === mode) {   // pressing the active mode puts the tool down
    ui.mode = null;
    discardPending();
    say(describe("Mode off."));
    paintModes();
    return;
  }
  discardPending();
  ui.mode = mode;
  ui.moveFrom = null;
  paintModes();
  say(describe());
  pickLoop();
}

function discardPending() {
  ui.pending = [];
  ui.moveFrom = null;
}

/**
 * One-shot picks, looped.
 *
 * `pickOnGlobe()` resolves on the next surface click and rejects on Escape, so
 * a digitising session is this loop and nothing else — no second click path to
 * keep in step with the cursor readout's inverse.
 */
async function pickLoop() {
  if (ui.picking) return;
  ui.picking = true;
  try {
    while (ui.session && ui.pickable && PICK_MODES.has(ui.mode)) {
      let point = null;
      try {
        point = await viewer().pickOnGlobe();
      } catch {
        // Escape, or the viewer gave up. Drop the half-drawn shape and put the
        // tool down — the loop has stopped listening, so leaving the mode
        // button lit would promise clicks that go nowhere. The edits already
        // applied are not in question.
        discardPending();
        ui.mode = null;
        if (ui.session) { paintModes(); say(describe("Cancelled.")); refreshPreview(); }
        break;
      }
      if (!ui.session) break;
      handlePick(point);
    }
  } catch (error) {
    console.error("[GeoID GIS] edit pick loop stopped", error);
  } finally {
    ui.picking = false;
  }
}

function handlePick(point) {
  const raw = [signedLon(point?.lon), Number(point?.lat)];
  if (!isPosition(raw)) return;
  const position = ui.snap ? snapTo(ui.session.collection(), raw, tolerance()) : raw;
  const snapped = position !== raw;

  if (ui.mode === "point") {
    const result = ui.session.apply(ops.addFeature(buildGeometry("point", [position])));
    afterChange(result.ok ? `Point added.${snapped ? " Snapped." : ""}` : result.message);
    return;
  }
  if (ui.mode === "line" || ui.mode === "polygon") {
    ui.pending.push(position);
    afterChange(snapped ? "Snapped." : "");
    return;
  }
  if (ui.mode === "move") {
    if (!ui.moveFrom) {
      const hit = nearestVertex(ui.session.collection(), position);
      if (!hit || hit.distanceDeg > tolerance()) { say(describe("No vertex near that click.")); return; }
      ui.moveFrom = hit;
      say(describe("Vertex picked."));
      return;
    }
    const { featureIndex, ringOrLineIndex, vertexIndex } = ui.moveFrom;
    const result = ui.session.apply(
      ops.moveVertex(featureIndex, ringOrLineIndex, vertexIndex, position),
    );
    ui.moveFrom = null;
    afterChange(result.ok ? `Vertex moved.${snapped ? " Snapped." : ""}` : result.message);
    return;
  }
  if (ui.mode === "deleteVertex") {
    const hit = nearestVertex(ui.session.collection(), position);
    if (!hit || hit.distanceDeg > tolerance()) { say(describe("No vertex near that click.")); return; }
    const result = ui.session.apply(
      ops.deleteVertex(hit.featureIndex, hit.ringOrLineIndex, hit.vertexIndex),
    );
    afterChange(result.ok ? "Vertex removed." : result.message);
  }
}

/** Enter closes the shape being drawn. */
function completePending() {
  if (!ui.session || !ui.pending.length) return;
  const geometry = buildGeometry(ui.mode, ui.pending);
  if (!geometry) {
    say(describe(ui.mode === "polygon"
      ? "A polygon needs three corners."
      : "A line needs two vertices."));
    return;
  }
  const result = ui.session.apply(ops.addFeature(geometry));
  ui.pending = [];
  afterChange(result.ok ? `${ui.mode === "polygon" ? "Polygon" : "Line"} added.` : result.message);
}

/* ── the keyboard ─────────────────────────────────────────────────────────── */

/** The mandatory text-entry exemption for any document-level keydown (the
    space-bar lesson): Enter in a form field must submit that field, not close
    a polygon behind it. */
function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const skip = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"]);
    return !skip.has(el.type);
  }
  return false;
}

function onKeydown(event) {
  if (!ui.session) return;
  if (isTextEntry(event.target)) return;
  if (event.key === "Enter") {
    if (!ui.pending.length) return;
    event.preventDefault();
    completePending();
    return;
  }
  if (event.key === "Escape") {
    // The viewer's own pick handler takes Escape in the capture phase and
    // rejects the pending pick, which lands in pickLoop's catch. This is for
    // the case where no pick is in flight; both paths are idempotent.
    if (!ui.pending.length && !ui.moveFrom) return;
    discardPending();
    afterChange("Cancelled.");
  }
}

function bindKeys() {
  if (ui.keyBound || typeof document === "undefined") return;
  document.addEventListener("keydown", onKeydown);
  ui.keyBound = true;
}

function unbindKeys() {
  if (!ui.keyBound || typeof document === "undefined") return;
  document.removeEventListener("keydown", onKeydown);
  ui.keyBound = false;
}

/* ── the seam ─────────────────────────────────────────────────────────────── */

/**
 * Begin editing a layer — by id or by record. The layer itself is untouched:
 * a copy of its FeatureCollection goes into a session and everything from here
 * happens to that.
 *
 * Returns true when a session is open. A body with no surface to click still
 * gets the toolbar, saying so, with every click-driven control disabled —
 * there is nothing here that half-works.
 */
export function start(layerId) {
  if (typeof document === "undefined") return false;
  buildToolbar();
  // A second start() replaces the session, so the previous one's preview must
  // come off the globe here rather than being orphaned there for the session.
  if (ui.session) { clearPreview(); teardown(); }
  const layer = findLayer(layerId);
  ui.root.hidden = false;
  if (!layer) {
    ui.session = null; ui.layer = null; ui.pickable = false;
    paintModes();
    say("No such layer.");
    return false;
  }
  if (!layer.collection) {
    ui.session = null; ui.layer = null; ui.pickable = false;
    paintModes();
    say(`${layer.name} holds no vector features to edit.`);
    return false;
  }
  clearPreview();
  ui.layer = layer;
  ui.session = makeEditSession(layer.collection);
  ui.mode = null;
  discardPending();
  ui.source.textContent = `Editing a copy of ${layer.name}`;
  if (!hasPickSeam()) {
    ui.pickable = false;
    paintModes();
    say("This world has no surface to click, so there is nothing to digitise here.");
    return true;
  }
  ui.pickable = true;
  bindKeys();
  paintModes();
  say(describe("Pick a mode."));
  refreshPreview();
  return true;
}

/**
 * Publish the edited collection as a NEW derived layer, `edit_<name>`, and
 * close the session. The source layer is left exactly as it was — an edit is
 * undone by deleting a layer, not by hoping the original survived.
 *
 * Async because vector-render (and three.js behind it) is imported on demand.
 * Resolves with the new layer record, or null if nothing was published.
 */
export async function finish() {
  if (!ui.session) return null;
  const fc = ui.session.collection();
  const name = outputName();
  const fields = ui.layer?.info?.fields || [];
  const mod = await loadRenderer();
  const add = manager()?.addDerivedLayer;
  if (!mod?.buildVectorLayerResult || typeof add !== "function") {
    say("The layer builder is not loaded; nothing was published.");
    return null;
  }
  clearPreview();
  let layer = null;
  try {
    const result = mod.buildVectorLayerResult(fc, { name, fields, drape: 0.008 });
    layer = add(name, result, "edit") || null;
  } catch (error) {
    console.error("[GeoID GIS] edit finish failed", error);
    say(`Could not publish: ${error.message}`);
    return null;
  }
  const count = fc.features.length;
  teardown();
  say(`${name}: ${count} feature${count === 1 ? "" : "s"}.`);
  return layer;
}

/** Throw the session away. The globe is left as it was found. */
export function cancel() {
  clearPreview();
  teardown();
  if (ui.root) ui.root.hidden = true;
  return true;
}

function teardown() {
  ui.session = null;
  ui.layer = null;
  ui.mode = null;
  discardPending();
  ui.pickable = false;
  ui.picking = false;
  unbindKeys();
  paintModes();
  if (ui.source) ui.source.textContent = "";
}

/** True while a layer is open for editing — for a toolbox button that toggles. */
export function isEditing() {
  return Boolean(ui.session);
}

if (typeof window !== "undefined") {
  // Merged non-destructively: whichever module lands second must not erase the
  // other's keys, the tool-dialog/tool-search seam rule.
  window.GeoIDEditTools = Object.assign({}, window.GeoIDEditTools, {
    start, finish, cancel, isEditing,
  });
}
