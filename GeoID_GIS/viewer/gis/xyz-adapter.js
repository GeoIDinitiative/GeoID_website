import * as THREE from "../vendor/three.module.js";
import { latLonToVector3, drapedRadius, looksLikeGeographic, computeBounds2D } from "./geo-utils.js?v=20260904-200ef9b";
import {
  readHead, parseRows, validateMapping, rowsToPointCollection,
} from "./delimited.js?v=20260904-200ef9b";
import { rampColour } from "./symbology.js?v=20260904-200ef9b";
import { markerDiscTexture } from "./vector-render.js?v=20260904-200ef9b";
import { registerDrape } from "./geotiff-adapter.js?v=20260904-200ef9b";

const MAX_POINTS = 2000000;

// Header names used by the common exporters, so a CSV with labelled columns is
// mapped correctly instead of relying on column order.
const LON_KEYS = ["lon", "long", "longitude", "x", "easting"];
const LAT_KEYS = ["lat", "latitude", "y", "northing"];
const ELEV_KEYS = ["z", "elev", "elevation", "height", "alt", "altitude", "depth", "value"];

function splitFields(line) {
  return line.trim().split(/[\s,;]+/);
}

function detectHeader(line) {
  const fields = splitFields(line).map((f) => f.toLowerCase().replace(/^["']|["']$/g, ""));
  if (!fields.length || fields.every((f) => Number.isFinite(Number(f)))) {
    return null;
  }
  const lonIndex = fields.findIndex((f) => LON_KEYS.includes(f));
  const latIndex = fields.findIndex((f) => LAT_KEYS.includes(f));
  const elevIndex = fields.findIndex((f) => ELEV_KEYS.includes(f));
  if (lonIndex === -1 || latIndex === -1) {
    // Unrecognised header row; skip it and fall back to positional columns.
    return { skip: true, lonIndex: 0, latIndex: 1, elevIndex: 2 };
  }
  return { skip: true, lonIndex, latIndex, elevIndex: elevIndex === -1 ? 2 : elevIndex };
}

/**
 * A point's colour.
 *
 * Points are coloured HERE rather than by `applyImportSymbology`, and that is not
 * a duplicate path: that helper works through `layer.repaint`, which needs either
 * a raster band or per-feature attributes, and a point cloud has neither. So a
 * ramp chosen in the Add-data dialog has to be honoured at build time or it
 * silently does nothing -- which is exactly what it did until this.
 *
 * The old built-in was a hard-coded HSL sweep unrelated to any ramp the
 * symbology panel offers; going through `rampColour` means "Magma" here and
 * "Magma" there are the same seven stops.
 */
function colorForHeight(t, ramp) {
  const color = new THREE.Color();
  if (ramp) {
    const [r, g, b] = rampColour(ramp, t);
    color.setRGB(r / 255, g / 255, b / 255);
    return color;
  }
  color.setHSL(0.62 - 0.62 * Math.min(1, Math.max(0, t)), 0.75, 0.55);
  return color;
}

/** Does this mapping give the points a value worth grading? */
function isGradedMapping(mapping) {
  return Boolean(mapping) && (mapping.elev >= 0 || mapping.magnitude >= 0);
}

/**
 * A point cloud or a CSV of readings.
 *
 * `options.columns` is the mapping the Add-data dialog collected — which column
 * is X, which is Y, which is Z, which is magnitude. Without it the file is read
 * exactly as before, by `readHead`'s proposal: names first, position as a last
 * resort. The difference is that the guess is now visible before the import
 * rather than discovered afterwards from a layer in the wrong ocean.
 */
/** Past this the file is a survey, not a table: about 8 MB of text. */
const MAX_SOURCE_CHARS = 8_000_000;

/**
 * Past this many points a cloud stays DISPLAY-ONLY.
 *
 * A GeoJSON FeatureCollection is what makes a layer real to the rest of the
 * app: `layersByType("vector")` filters on `collection`, so without one an
 * imported CSV was invisible to every vector tool -- IDW offered "None
 * available" over two hundred points drawn on the globe -- and `layerKind`
 * fell through to "mesh", so the only export formats were STL and OBJ. The
 * points could be looked at and nothing else.
 *
 * The reason not to build one always is the other end of the range: this
 * reader accepts two million points, and a feature object apiece is a great
 * deal of memory and garbage for something no one is going to run a spatial
 * join over. A hundred thousand is where a table stops being a table.
 *
 * Above the line the layer says so in `info.displayOnlyReason`, so the limit
 * is visible rather than looking like the old silent nothing.
 */
const COLLECTION_MAX_POINTS = 100_000;

/** Rows, counted without allocating an array per line. */
function countLines(text) {
  let n = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  return n;
}

export async function loadXyzPoints(file, options = {}) {
  const text = await file.text();
  const head = readHead(text);
  if (!head.mapping) throw new Error("No readable rows were found in this file.");

  const mapping = options.columns || head.mapping;
  const symbology = options.symbology || {};
  // A flat colour only means something when there is nothing to grade; with a Z
  // or a magnitude the ramp wins, which is what the dialog says it will do.
  const graded = isGradedMapping(mapping);
  const ramp = graded ? (symbology.ramp || null) : null;
  const flatColour = !graded && symbology.colour ? new THREE.Color(symbology.colour) : null;
  const valid = validateMapping(mapping, head.columns.length);
  if (!valid.ok) throw new Error(valid.problems.join(" "));

  // Decided from the LINE COUNT rather than the parsed length, because the
  // choice has to be made before the parse that would answer it. It is an
  // over-estimate -- blank and comment lines are counted -- which errs the
  // safe way: a file near the line keeps its columns.
  const keepFields = countLines(text) <= COLLECTION_MAX_POINTS;
  const { points: parsed, skipped } = parseRows(text, mapping, {
    delimiter: head.delimiter, hasHeader: head.hasHeader, limit: MAX_POINTS, keepFields,
  });

  const rawX = [];
  const rawY = [];
  const rawZ = [];
  // Magnitude is kept alongside Z rather than replacing it: a survey point has
  // an elevation AND a reading, and colouring by one must not lose the other.
  const rawMag = [];
  let hasMagnitude = false;
  parsed.forEach((point) => {
    rawX.push(point.x);
    rawY.push(point.y);
    rawZ.push(point.z);
    if (point.magnitude !== undefined) {
      rawMag.push(point.magnitude);
      if (point.magnitude !== null) hasMagnitude = true;
    }
  });

  if (!rawX.length) {
    throw new Error("No numeric coordinate rows were found.");
  }

  const flat = new Float64Array(rawX.length * 2);
  for (let i = 0; i < rawX.length; i += 1) {
    flat[i * 2] = rawX[i];
    flat[i * 2 + 1] = rawY[i];
  }
  const bounds = computeBounds2D(flat);
  const georeferenced = looksLikeGeographic(bounds);

  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < rawZ.length; i += 1) {
    if (rawZ[i] < zMin) zMin = rawZ[i];
    if (rawZ[i] > zMax) zMax = rawZ[i];
  }
  const zRange = zMax - zMin || 1;

  // Declared here because the span and the dot size both read it. The offset
  // is 0 now: this is the no-globe fallback radius, not a clearance.
  const baseRadius = drapedRadius(0);
  const surfacePoint = georeferenced ? window.GeoIDViewer?.surfacePoint : null;

  /**
   * How wide the survey is, in scene units. Both the dot size and the vertical
   * exaggeration are read off it, so neither is a constant that happens to
   * suit one dataset.
   */
  const spanDeg = Math.max(
    (bounds.maxX - bounds.minX)
      * Math.cos(((bounds.minY + bounds.maxY) / 2) * Math.PI / 180),
    bounds.maxY - bounds.minY,
  ) || 0.01;
  const sceneSpan = georeferenced ? spanDeg * (Math.PI / 180) * baseRadius : 6;

  /**
   * Point size comes from the DATA, and it used to be a constant.
   *
   * `0.012` scene units is about twenty-four kilometres at the globe's scale,
   * so every imported CSV drew as a field of enormous overlapping squares
   * covering far more ground than the survey did -- and being world-space, the
   * only thing zooming changed was how many of them you could see at once.
   *
   * Average spacing (span / sqrt(n)) is the natural size: dots that nearly
   * touch when the cloud is even, and separate when it is sparse. The clamp
   * keeps both ends honest -- no dot wider than a twentieth of the survey, none
   * so small that a million-point LiDAR tile renders as nothing at all.
   */
  const pointSize = Math.min(
    sceneSpan / 20,
    Math.max(sceneSpan / 2000, sceneSpan / Math.sqrt(rawX.length || 1)),
  );

  /**
   * A CLOUD SITS ON THE GROUND. It used to hover, twice over.
   *
   * `baseRadius` was `drapedRadius(0.005)` -- a flat 9,950 m above a sphere of
   * radius 3.2, ignoring terrain entirely, so the layer floated over lowland
   * and sank into anything tall. On top of that each point was lifted by
   * `height * 0.12`, another 239 km at full scale, which is its own commit.
   *
   * Both are gone. Points are laid on the viewer's own displaced surface, the
   * same `surfacePoint` the raster drapes use, at the clearance the line
   * renderer calls its minimum -- about three metres, which is touch-tight at
   * any altitude a dot is legible from and still enough that a sprite is not
   * fighting the very cell it stands on.
   *
   * The cost is that Z no longer shows as height. It cannot: the column's
   * units are unknowable -- `depth_km`, `elev_ft` and a bare `z` all arrive as
   * numbers -- so the only honest choices were an invented exaggeration or the
   * ground. Z still drives the colour ramp, which is where the reading was
   * always legible.
   */
  const CLOUD_DRAPE = 0.0000015;

  const positions = new Float32Array(rawX.length * 3);
  const colors = new Float32Array(rawX.length * 3);
  const vertex = new THREE.Vector3();

  // Projected data keeps its own units, recentred and normalised so it is
  // visible at the scene's scale instead of being kilometres off-screen.
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;
  const localScale = 6 / Math.max(spanX, spanY);
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;

  // What the ramp is drawn through. Magnitude is the reason someone chose a
  // magnitude column, so it wins the colour when it is present.
  let mMin = Infinity;
  let mMax = -Infinity;
  if (hasMagnitude) {
    rawMag.forEach((m) => {
      if (m === null) return;
      if (m < mMin) mMin = m;
      if (m > mMax) mMax = m;
    });
  }
  const mRange = (mMax - mMin) || 1;

  for (let i = 0; i < rawX.length; i += 1) {
    const height = (rawZ[i] - zMin) / zRange;
    const t = hasMagnitude && rawMag[i] !== null ? (rawMag[i] - mMin) / mRange : height;
    if (georeferenced) {
      if (surfacePoint) {
        vertex.copy(surfacePoint(rawY[i], rawX[i], CLOUD_DRAPE));
      } else {
        // No globe (Model mode, tests): a plain sphere is the honest fallback,
        // the same one the raster drape falls back to.
        vertex.copy(latLonToVector3(rawY[i], rawX[i], baseRadius));
      }
    } else {
      vertex.set((rawX[i] - midX) * localScale, height * 1.6, -(rawY[i] - midY) * localScale);
    }
    positions[i * 3] = vertex.x;
    positions[i * 3 + 1] = vertex.y;
    positions[i * 3 + 2] = vertex.z;
    const color = flatColour || colorForHeight(t, ramp);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const opacity = Number.isFinite(symbology.opacity) ? symbology.opacity : 1;
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: pointSize,
    sizeAttenuation: true,
    vertexColors: true,
    // Without a map a point is a hard SQUARE; this is the same disc the vector
    // markers use, and `alphaTest` cuts it round without needing depth sorting.
    map: markerDiscTexture(),
    alphaTest: 0.4,
    /**
     * ALWAYS transparent, and never writing depth -- the markers' own answer.
     *
     * `transparent: opacity < 1` made VISIBILITY depend on the symbology. A
     * cloud sits about three metres above the ground now, which at a radius of
     * 6,371 km is well inside the depth buffer's noise, so an OPAQUE cloud is
     * drawn in the opaque pass and loses to the globe: measured, the same 200
     * points painted 0 pixels opaque and 29,144 transparent.
     *
     * It only ever looked fine because the Add-data dialog defaults opacity to
     * 0.85. Anything importing without symbology -- the re-import a point edit
     * makes, a catalogue, a script -- got opacity 1 and a layer that loaded,
     * reported its points, sat in the scene visible and unculled, and drew
     * nothing at all.
     *
     * The transparent pass runs after the opaque one, so the points are laid
     * over the ground they stand on; `depthTest` stays true, so the far limb
     * still occludes them.
     */
    transparent: true,
    depthWrite: false,
    opacity,
  }));
  points.name = file.name;
  /**
   * Re-laid when the ground moves, exactly as a raster drape is.
   *
   * The relief taper is driven by altitude inside the render loop, so a
   * geometry baked at one exaggeration is left hanging as soon as the camera
   * descends -- being ON the surface at build time is not the same as staying
   * there. The registry polls and re-lays only what has drifted.
   */
  if (georeferenced && surfacePoint) {
    points.userData.rebuildDrape = () => {
      const surface = window.GeoIDViewer?.surfacePoint;
      if (!surface) return;
      const pos = geometry.attributes.position;
      const at = new THREE.Vector3();
      for (let i = 0; i < rawX.length; i += 1) {
        at.copy(surface(rawY[i], rawX[i], CLOUD_DRAPE));
        pos.setXYZ(i, at.x, at.y, at.z);
      }
      pos.needsUpdate = true;
      geometry.computeBoundingSphere();
      points.userData.builtRelief = window.GeoIDViewer?.getEffectiveRelief?.();
    };
    points.userData.builtRelief = window.GeoIDViewer?.getEffectiveRelief?.();
    registerDrape(points);
  }
  if (!georeferenced) {
    // Projected clouds are built in local scene units, so they need the same
    // mode-aware placement as imported meshes.
    points.userData.localModel = true;
    points.userData.baseScale = 1;
  }

  /**
   * Only georeferenced clouds get a collection: a projected file's x and y are
   * metres in some grid, and a FeatureCollection carrying those as if they were
   * lon/lat would be read as a point off the coast of Africa by every tool that
   * touched it. Reprojection is the dialog's job, not a silent one here.
   */
  const wantCollection = georeferenced && keepFields
    && parsed.length <= COLLECTION_MAX_POINTS;
  const collection = wantCollection
    ? rowsToPointCollection(parsed, head.columns, mapping)
    : null;
  const displayOnlyReason = collection ? null
    : (!georeferenced
      ? "These coordinates are not lon/lat, so the rows are not offered as a table. "
        + "Re-import with the file's own reference system to place it on the globe."
      : `Over ${COLLECTION_MAX_POINTS.toLocaleString()} points, so this is kept as a `
        + "display cloud: the vector tools and the vector export formats are not "
        + "offered for it.");

  return {
    object3D: points,
    georeferenced,
    collection,
    // The popup's picker reads `features` while the tool runner reads
    // `collection`; they are the same array, and a layer that answers one and
    // not the other is clickable but untoolable, or the reverse.
    features: collection ? collection.features : null,
    /**
     * The rows AS THEY CAME, so the table window has something to open.
     *
     * This reader keeps x, y, z and a magnitude and drops every other column
     * — which is right for a point cloud and means a CSV of sample sites
     * arrives on the globe with its names, depths and notes already gone. It
     * was then unreachable: the values existed in a file the app no longer
     * held. Keeping the text costs a copy of a file somebody just chose, and
     * only up to a cap — a hundred-megabyte LiDAR dump is not a spreadsheet
     * and nobody is going to edit it in a grid.
     */
    source: text.length <= MAX_SOURCE_CHARS
      ? { text, delimiter: head.delimiter, hasHeader: head.hasHeader, mapping }
      : null,
    bounds: georeferenced ? bounds : null,
    boundingSphere: geometry.boundingSphere?.clone() || null,
    info: {
      pointCount: rawX.length,
      min: zMin,
      max: zMax,
      projected: !georeferenced,
      colouredBy: flatColour ? "single colour" : (hasMagnitude ? "magnitude" : "elevation"),
      ramp: ramp || null,
      magnitudeRange: hasMagnitude ? { min: mMin, max: mMax } : null,
      skippedRows: skipped,
      truncated: rawX.length >= MAX_POINTS,
      attributeRows: collection ? collection.features.length : 0,
      displayOnly: !collection,
      displayOnlyReason,
    },
  };
}
