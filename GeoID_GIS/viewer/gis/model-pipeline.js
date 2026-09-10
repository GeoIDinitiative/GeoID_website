import {
  buildSurface, planGrid, surfaceStl, domainStl, stlStats,
  gmshScript, femSpec, makeLocalFrame, DEFAULT_MATERIALS,
  nativeStepM, sizeField, structuredFieldText, DEFAULT_FLAGS, atmosphereStl, DEFAULT_MAX_NODES, triangleWriter,
} from "./model-build.js?v=20260910-9a9362a";
import { ringsFromCollection } from "./extraction.js?v=20260910-9a9362a";
import {
  buildTin, tinHeightAt, tinSurfaceStl, tinShellStl, samplingSizeField,
  extendBoundary, extendedBoundaryLines, gridAsTin, shellFacets,
} from "./surface-sampling.js?v=20260910-9a9362a";
import { renderFeatureCollection } from "./vector-render.js?v=20260910-9a9362a";
import { promptDrawTool } from "./extent-picker.js?v=20260910-9a9362a";
import {
  profileAlong, profileHeightAt, sectionPolygons, sectionPositions, sectionGmshScript, profileCsv,
} from "./section-model.js?v=20260910-9a9362a";
import { defaultField, describeField, FIELD_TYPES, smallestSize } from "./mesh-size-fields.js?v=20260910-9a9362a";

/**
 * The Model Builder tab: the GIS study area becomes a meshable domain.
 *
 * It is a PIPELINE rather than a panel of controls, and the tab reads as one —
 * six numbered steps, each unlocked by the one before it, each stating what it
 * produced. That shape is the point: packaging a study for a solver is a
 * sequence of decisions where every later one depends on an earlier
 * (a boundary condition needs surfaces, and surfaces need a domain, and a
 * domain needs ground), and a flat panel of eighteen controls hides that
 * order behind the reader's own guesswork.
 *
 * What each step contributes to the run, so the chain is legible:
 *
 *   1 Study area  → WHERE. The drawn shape or any polygon layer; the model is
 *                   the box over it.
 *   2 Layers      → WHAT. Every workspace layer takes a role — surface
 *                   elevation, initial condition, boundary condition, material
 *                   region, embedded points — plus the resolution.
 *   3 Surface     → the terrain, sampled at that resolution, written as an STL.
 *   4 Domain      → solid / fluid / gas / thermal, its depth and its materials.
 *   5 Conditions  → which named boundary each condition acts on, and the points
 *                   the mesh must pass through.
 *   6 Build       → the domain STL, the gmsh script and `fem_runs/<run>/spec.json`
 *                   the FEM pages and the sidecar's deck prepare already read.
 *
 * The arithmetic all lives in `model-build.js`, which is pure and tested against
 * closed forms; this module is the panel and the project writes.
 */

const byId = (id) => document.getElementById(id);

const STEPS = [
  { id: "area", n: 1, title: "Study area", blurb: "Where the model is." },
  { id: "layers", n: 2, title: "Layers and roles", blurb: "What goes into it." },
  { id: "surface", n: 3, title: "Surface", blurb: "The ground, as geometry." },
  { id: "domain", n: 4, title: "Domain", blurb: "What it is made of." },
  { id: "conditions", n: 5, title: "Conditions and points", blurb: "How it is driven." },
  { id: "build", n: 6, title: "Build", blurb: "Mesh and run specification." },
];

const ROLE_OPTIONS = [
  { id: "ignore", label: "Not in the model" },
  { id: "surface", label: "Surface elevation" },
  { id: "initial", label: "Initial condition" },
  { id: "boundary", label: "Boundary condition" },
  { id: "material", label: "Material region" },
  { id: "points", label: "Embedded points" },
  { id: "refine", label: "Refine the mesh here" },
];

// "top" is the GROUND in both shells; "base" is a subsurface lid and "sky"
// an atmosphere one, so a package that has both keeps them apart.
const SURFACES = ["top", "base", "sky", "north", "south", "east", "west"];

const state = {
  bounds: null,
  roles: new Map(),
  pointDepth: new Map(),
  resolution: { mode: "native", stepM: 100 },
  nativeStepM: null,
  demReady: null,
  // Per-layer element size for the layers given the "refine" role.
  refineSize: new Map(),
  // The integer tag each face, the volume and each point carries. A solver
  // reads the number, not the name, so the study owns it.
  flags: { ...DEFAULT_FLAGS },
  pointFlag: new Map(),
  // Elements where the ground needs them: coarse away from the action, fine on
  // the slopes, and finer still inside a region somebody names.
  grading: { on: true, coarseM: 0, fineM: 0, slopeRefDeg: 30 },
  surface: null,
  domain: { type: "solid", depthM: 5000, materials: {} },
  /**
   * HOW THE GROUND IS SAMPLED. Uniform is one step everywhere; variable is a
   * base step outside and the DEM's own (or a chosen) step inside BUFFERS the
   * reader draws -- a square or a circle about a point -- graded between the
   * two so the triangles grow rather than jump. Layers given the refine role
   * join the buffers with their bounding box.
   */
  sampling: { mode: "uniform", baseM: 0, gradeM: null, buffers: [] },
  /**
   * WHAT KIND OF MODEL. A 3D block; a 2D SURFACE ONLY (the terrain STL and
   * nothing under or over it); or a 2D CROSS-SECTION -- the DEM sampled
   * along a line A-B, with the subsurface and the atmosphere as FACES in the
   * vertical plane through it rather than volumes.
   */
  kind: "3d",
  section: { a: null, b: null, n: 200 },
  profile: null,
  /** Points placed on the globe, embedded at the surface's own interpolated height. */
  customPoints: [],
  /** A flag chosen for ONE point by name (on the model page's card); wins over its layer's. */
  pointFlagByName: new Map(),
  /** A mesh size chosen for ONE point by name, the size gmsh gives its node. */
  pointSizeByName: new Map(),
  /**
   * MESH SIZE FIELDS, gmsh's own: at a point, along a flagged boundary, in a
   * box or a circle, from a formula -- each user-defined, drawn on the globe,
   * combined by Min (or Max) and set as the background mesh. See
   * mesh-size-fields.js. `meshOptions` are the global knobs beside them:
   * a cap (or none), a floor (or auto), the combination, and gmsh's own
   * size sources, which are OFF beside a field unless asked.
   */
  sizeFields: [],
  meshOptions: { combine: "min", sizeMaxM: undefined, sizeMinM: undefined, extendFromBoundary: false, fromPoints: false, fromCurvature: 0, algorithm2d: null, algorithm3d: null },
  /** The air over the ground, as its own closed shell and its own gmsh script. */
  atmosphere: { on: false, heightM: 5000 },
  /** Layer ids of what this builder draws on the globe, by kind. */
  previews: {},
  conditions: [],
  outputs: null,
  open: "area",
};

/* ── The world underneath ────────────────────────────────────────────────── */

function viewer() {
  return window.GeoIDViewer || null;
}

function bodyRadiusKm() {
  return viewer()?.bodyRadiusKm || 6371.0088;
}

function loadedLayers() {
  /**
   * NEVER THE BUILDER'S OWN PREVIEWS. The embedded-points preview is a point
   * layer, so it took the "points" role by default and fed itself back into
   * the list it was drawn from -- measured, one placed point embedded three
   * times, twice from its own picture. What this builder draws is not input.
   */
  const own = new Set(Object.values(PREVIEW_NAMES));
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((layer) => layer.status === "loaded" && !own.has(layer.name));
}

/**
 * The elevation reader the surface is sampled through: a layer given the
 * "surface elevation" role, else this world's own DEM.
 *
 * The viewer's DEM is indexed 0-360 east, which is the trap every sampler in
 * this tree has to answer for.
 */
function elevationReader() {
  const chosen = loadedLayers().find((layer) =>
    state.roles.get(String(layer.id)) === "surface" && layer.sampler);
  if (chosen) {
    return {
      name: chosen.name,
      read: (lat, lon) => {
        const value = chosen.sampler(lat, lon);
        return Number.isFinite(value?.value) ? value.value
          : (Number.isFinite(value) ? value : NaN);
      },
    };
  }
  /**
   * THE STREAMED PYRAMID, AT THE FINEST LEVEL THIS AREA CAN HAVE.
   *
   * `sampleElevationMeters` answers from whatever the DEM happens to hold,
   * which is whatever the VIEW asked for — so a model built while zoomed out
   * was carved from zoom-6 posts however small its study area, and nothing
   * said so. A study area is a different question from a glance: it is the
   * thing being asked about, and it deserves the source's own ceiling.
   *
   * `ensureBestDem` (below) loads that before the surface is sampled; this
   * reads through `heightAt`, which is the pyramid's own answer rather than
   * the viewer's interpolation of it. The viewer's sampler stays as the
   * fallback, for a body with no streamed DEM at all.
   */
  const dem = window.GeoIDDem;
  if (dem?.heightAt && state.demReady) {
    return {
      name: `${state.demReady.label} (streamed DEM)`,
      read: (lat, lon) => {
        const value = dem.heightAt(lat, lon);
        return Number.isFinite(value) ? value : NaN;
      },
    };
  }
  const v = viewer();
  if (!v?.sampleElevationMeters) return null;
  return {
    name: "this world's DEM",
    read: (lat, lon) => {
      const lon360 = ((lon % 360) + 360) % 360;
      const value = v.sampleElevationMeters(lat, lon360);
      return Number.isFinite(value) ? value : NaN;
    },
  };
}

/**
 * Load the finest DEM this study area can be given, and say what it is.
 *
 * The zoom is chosen by the AREA rather than by a budget borrowed from the
 * view: `plan` reports the level a tile count buys, and a model is worth more
 * tiles than a glance. What comes back is the level actually loaded and the
 * ground spacing of its posts, which is the number the Surface step should be
 * quoting when it says how fine a grid is worth building.
 */
async function ensureBestDem(bounds) {
  const dem = window.GeoIDDem;
  if (!dem?.ensure || !bounds) { state.demReady = null; return null; }
  try {
    /**
     * MORE TILES, NOT A HIGHER CEILING.
     *
     * A study area is worth many more tiles than a glance, so the budget goes
     * up — but the CAP stays the pyramid's own. `dem-tiles` measured where the
     * information runs out (z13 carries 7.69 m RMS of real detail, z14 1.26,
     * z15 0.74 — "interpolation, nothing more"), and its cap is one past that
     * on purpose. Asking for z15 would quadruple the tiles to buy the
     * publisher's own resampling, and would let this step report 2.8 m posts
     * over ground surveyed at 30.
     */
    const out = await dem.ensure(bounds, { maxTiles: 256 });
    if (!out?.ok) { state.demReady = null; return null; }
    const lat = (bounds.south + bounds.north) / 2;
    const metres = dem.metresPerPixel(out.zoom, lat);
    // Past z13 the levels are the source's own resampling of 30 m data, and a
    // spacing quoted without that reads as a survey nobody made.
    const interpolated = out.zoom > 13;
    state.demReady = {
      zoom: out.zoom,
      postM: metres,
      interpolated,
      tiles: out.tiles ?? null,
      label: `zoom ${out.zoom}, ${metres < 10 ? metres.toFixed(1) : Math.round(metres)} m posts`
        + (interpolated ? " (resampled from ~30 m source data)" : ""),
    };
    return state.demReady;
  } catch (error) {
    state.demReady = null;
    return null;
  }
}

/**
 * The DEM's own sample spacing, MEASURED rather than declared.
 *
 * The sampler interpolates bilinearly, so between two pixel centres the values
 * run exactly linearly and every kink in the second difference is a pixel
 * boundary. Walking a short line and taking the median spacing of those kinks
 * is therefore the raster's native resolution, and it needs no seam any viewer
 * would have to grow. Over flat ground there are no kinks to find and it says
 * so rather than inventing a number — "native" then falls back to the study's
 * own size, which is the honest default.
 */
/**
 * Moved into model-build.js, which is the pure half and is what the terrain
 * TOOL imports too — the Surface step and that tool must quote the same
 * number, and two copies of a measurement is how they stop doing so.
 */
function probeNativeStepM(read, lat, lon) {
  return nativeStepM({ read, lat, lon, radiusKm: bodyRadiusKm() });
}

/* ── Bounds ──────────────────────────────────────────────────────────────── */

function polygonLayers() {
  return loadedLayers().filter((layer) => (layer.collection?.features || [])
    .some((f) => f?.geometry?.type === "Polygon" || f?.geometry?.type === "MultiPolygon"));
}

function boundsOfRings(rings) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  rings.forEach((ring) => ring.vertices.forEach((v) => {
    const lon = v.lon > 180 ? v.lon - 360 : v.lon;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, v.lat);
    north = Math.max(north, v.lat);
  }));
  return { west, east, south, north };
}

function resolveBounds(value) {
  if (value && value.startsWith("layer:")) {
    const layer = loadedLayers().find((l) => String(l.id) === value.slice(6));
    if (!layer?.collection) return { error: "That layer is no longer loaded." };
    const rings = ringsFromCollection(layer.collection);
    if (!rings.length) return { error: "That layer holds no polygons." };
    return { label: layer.name, rings, bbox: boundsOfRings(rings), layerId: String(layer.id) };
  }
  const v = viewer();
  const geometry = v?.getExtractionGeometry?.("study") || v?.getExtractionGeometry?.("buffer");
  if (!geometry) {
    return { error: "Draw a study area on the globe, or pick a polygon layer." };
  }
  const rings = [{ vertices: geometry.vertices, holes: [], center: geometry.center }];
  return { label: "the drawn area", rings, bbox: boundsOfRings(rings), layerId: null };
}

/* ── Step readiness: the pipeline's own rule ─────────────────────────────── */

function blockedReason(stepId) {
  if (stepId === "area") return null;
  if (!state.bounds) return "Choose the study area first.";
  if (stepId === "layers") return null;
  if (stepId === "surface") return null;
  // A section's surface IS its profile: the steps below it open on that.
  if (state.kind === "section" ? !state.profile : !state.surface) {
    return state.kind === "section" ? "Build the profile first — the faces hang from it." : "Build the surface first — the domain sits under it.";
  }
  if (stepId === "domain") return null;
  if (stepId === "conditions") return null;
  return null;
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

function fmt(value, digits = 1) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(labelText, control) {
  const wrap = el("label", "row");
  wrap.appendChild(el("span", null, labelText));
  wrap.appendChild(control);
  return wrap;
}

function select(id, options, value) {
  const node = el("select", "input");
  node.id = id;
  options.forEach((option) => {
    const opt = el("option", null, option.label);
    opt.value = option.id;
    node.appendChild(opt);
  });
  if (value !== undefined && [...node.options].some((o) => o.value === value)) {
    node.value = value;
  }
  return node;
}

function number(id, value, step) {
  const node = el("input", "input");
  node.id = id;
  node.type = "number";
  node.value = String(value);
  if (step) node.step = String(step);
  return node;
}

function say(stepId, message) {
  const node = byId(`gis-mb-status-${stepId}`);
  if (node) node.textContent = message;
}

function stepDone(stepId) {
  const built = Boolean(state.kind === "section" ? state.profile : state.surface);
  if (stepId === "area") return Boolean(state.bounds);
  if (stepId === "layers") return Boolean(state.bounds);
  if (stepId === "surface") return built;
  if (stepId === "domain") return built;
  if (stepId === "conditions") return built;
  if (stepId === "build") return Boolean(state.outputs);
  return false;
}

function render() {
  const host = byId("gis-mesh-body");
  if (!host) return;
  let wrap = byId("gis-model-pipeline");
  if (!wrap) {
    wrap = el("div", null);
    wrap.id = "gis-model-pipeline";
    host.appendChild(wrap);
  }
  wrap.innerHTML = "";

  STEPS.forEach((step) => {
    const blocked = blockedReason(step.id);
    const section = el("details", "control-section gis-tool-section gis-mb-step");
    section.dataset.step = step.id;
    if (state.open === step.id && !blocked) section.open = true;
    if (blocked) section.classList.add("is-blocked");
    if (stepDone(step.id)) section.classList.add("is-done");

    const summary = el("summary", "section-toggle");
    // The step NUMBER is this card's mark, so claim the shared icon painter's
    // own opt-out rather than letting it add its fallback bracket beside it:
    // two glyphs for one heading, and the bracket says nothing the number does
    // not. (side-panels' paintToolIcons skips a summary already stamped.)
    summary.dataset.toolIcon = "1";
    const main = el("div", "section-toggle-main");
    const heading = el("div", "section-heading");
    const title = el("div", "section-title");
    const titleRow = el("span", "section-title-row");
    const chip = el("span", "gis-mb-num", stepDone(step.id) ? "✓" : String(step.n));
    titleRow.appendChild(chip);
    titleRow.appendChild(el("span", null, step.title));
    title.appendChild(titleRow);
    heading.appendChild(title);
    main.appendChild(heading);
    summary.appendChild(main);
    section.appendChild(summary);

    const body = el("div", "section-body gis-tool-body");
    body.appendChild(el("p", "tool-copy gis-mb-blurb", step.blurb));
    if (blocked) {
      body.appendChild(el("div", "gis-metric", blocked));
    } else {
      buildStep(step.id, body);
    }
    const status = el("div", "gis-metric");
    status.id = `gis-mb-status-${step.id}`;
    body.appendChild(status);
    section.appendChild(body);

    section.addEventListener("toggle", () => {
      if (section.open) state.open = step.id;
    });
    wrap.appendChild(section);
  });

  STEP_STATUS.forEach((message, id) => say(id, message));
}

// Status survives the redraw the way the Research Hub's does: the message is
// about what the step produced, and a rebuild is not a reason to forget it.
const STEP_STATUS = new Map();
function report(stepId, message) {
  STEP_STATUS.set(stepId, message);
  say(stepId, message);
}

/* ── The steps ───────────────────────────────────────────────────────────── */

function buildStep(stepId, body) {
  if (stepId === "area") return stepArea(body);
  if (stepId === "layers") return stepLayers(body);
  if (stepId === "surface") return stepSurface(body);
  if (stepId === "domain") return stepDomain(body);
  if (stepId === "conditions") return stepConditions(body);
  return stepBuild(body);
}


/* ── What the builder draws on the globe ─────────────────────────────────── */

const PREVIEW_NAMES = {
  fields: "Model Builder — mesh size fields",
  section: "Model Builder — section line",
  sectionFaces: "Model Builder — cross-section faces",
  buffers: "Model Builder — sampling buffers",
  sampling: "Model Builder — surface sampling",
  points: "Model Builder — embedded points",
  extend: "Model Builder — extended boundary",
  model: "Model Builder — full model (surface, subsurface, atmosphere)",
};
const UNITS_PER_METRE = 3.2 / 6371008.8;
let three = null;

function removePreview(kind) {
  const id = state.previews[kind];
  if (id === undefined) return;
  delete state.previews[kind];
  try { window.GeoIDImportManager?.removeLayer?.(id); } catch (e) { /* already gone */ }
}

function bboxOf(fc) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const eat = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < b.minX) b.minX = c[0]; if (c[0] > b.maxX) b.maxX = c[0];
      if (c[1] < b.minY) b.minY = c[1]; if (c[1] > b.maxY) b.maxY = c[1];
    } else c.forEach(eat);
  };
  fc.features.forEach((f) => eat(f.geometry.coordinates));
  return Number.isFinite(b.minX) ? b : null;
}

function showPreview(kind, fc, { colourFor, outlineOnly = true, legendInfo = null, description = "" } = {}) {
  removePreview(kind);
  if (!fc.features.length) return null;
  const made = renderFeatureCollection(fc, { colourFor, outlineOnly, name: PREVIEW_NAMES[kind] });
  const node = made?.object3D || made;
  if (!node) return null;
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(PREVIEW_NAMES[kind], {
    object3D: node, georeferenced: true, bounds: bboxOf(fc), features: fc.features, collection: fc,
    legendInfo, home: "model", opacity: 1,
    metadata: { source: "GeoHUB Model Builder", dataType: "model", description },
  }, "derived");
  if (layer) state.previews[kind] = layer.id;
  return layer;
}

function studyCentre() {
  const b = state.bounds?.bbox;
  return b ? { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 } : null;
}

function studySpanM() {
  if (!state.bounds) return 0;
  const p = planGrid({ bounds: state.bounds.bbox, stepM: 1, radiusKm: bodyRadiusKm() });
  return Math.max(p.widthM, p.heightM);
}

function nativeM() {
  return state.demReady?.postM || state.nativeStepM || null;
}

/** Layers given the refine role, as square buffers over their bounding box. */
function refineBuffers() {
  const out = [];
  loadedLayers().forEach((layer) => {
    if (state.roles.get(String(layer.id)) !== "refine") return;
    const rings = ringsFromCollection(layer.collection || { features: layer.features || [] });
    if (!rings?.length) return;
    let w = Infinity; let e = -Infinity; let sth = Infinity; let n = -Infinity;
    rings.forEach((ring) => ring.forEach(([lon, lat]) => {
      if (lon < w) w = lon; if (lon > e) e = lon; if (lat < sth) sth = lat; if (lat > n) n = lat;
    }));
    if (!Number.isFinite(w) || e <= w) return;
    const lat = (sth + n) / 2;
    const kmX = (e - w) * 111.32 * Math.cos((lat * Math.PI) / 180) * (bodyRadiusKm() / 6371.0088);
    const kmY = (n - sth) * 111.32 * (bodyRadiusKm() / 6371.0088);
    const size = Number(state.refineSize?.get(String(layer.id)));
    out.push({
      id: `layer:${layer.id}`, name: layer.name, shape: "square", lat, lon: (w + e) / 2,
      sizeKm: Math.max(kmX, kmY), stepM: Number.isFinite(size) && size > 0 ? size : null, fromLayer: true,
    });
  });
  return out;
}

function allBuffers() {
  return [...state.sampling.buffers, ...refineBuffers()];
}

/** A buffer's outline on the ground, as a lon/lat ring. */
function bufferRing(b) {
  const R = bodyRadiusKm();
  const kmLat = (Math.PI * R) / 180;
  const kmLon = kmLat * Math.max(Math.cos((b.lat * Math.PI) / 180), 0.01);
  const half = Number(b.sizeKm) / 2;
  const ring = [];
  if (b.shape === "circle") {
    for (let k = 0; k <= 48; k += 1) {
      const a = (k / 48) * 2 * Math.PI;
      ring.push([b.lon + (half * Math.cos(a)) / kmLon, b.lat + (half * Math.sin(a)) / kmLat]);
    }
  } else {
    const dx = half / kmLon; const dy = half / kmLat;
    ring.push([b.lon - dx, b.lat - dy], [b.lon + dx, b.lat - dy], [b.lon + dx, b.lat + dy], [b.lon - dx, b.lat + dy], [b.lon - dx, b.lat - dy]);
  }
  return ring;
}

const BUFFER_COLOURS = { native: "#52e4e8", step: "#ffb84d", layer: "#ff2bd6" };
function bufferColour(b) {
  return b.fromLayer ? BUFFER_COLOURS.layer : (b.stepM ? BUFFER_COLOURS.step : BUFFER_COLOURS.native);
}

function drawBuffers() {
  const buffers = allBuffers();
  const fc = { type: "FeatureCollection", features: buffers.map((b) => ({
    type: "Feature",
    properties: {
      name: b.name, shape: b.shape, size_km: b.sizeKm,
      resolution: b.stepM ? `${b.stepM} m` : "native", kind: bufferColour(b),
    },
    geometry: { type: "Polygon", coordinates: [bufferRing(b)] },
  })) };
  showPreview("buffers", fc, {
    colourFor: (f) => f.properties.kind,
    outlineOnly: true,
    legendInfo: {
      palette: [BUFFER_COLOURS.native.slice(1), BUFFER_COLOURS.step.slice(1), BUFFER_COLOURS.layer.slice(1)],
      labels: ["Native resolution", "A chosen step", "From a refine-role layer"],
      label: "Where the surface is sampled finer", classed: true, categorical: true, unit: null,
    },
    description: "Buffers the reader drew: the ground is sampled at the DEM's own step inside them, graded to the base step outside.",
  });
}

/** The sampling as line work: every triangle edge, coloured by its spacing. */
function drawSampling(tin) {
  const spacing = tin.nodeSpacing || null;
  const edges = new Map();
  tin.tris.forEach(([a, b, c]) => {
    [[a, b], [b, c], [c, a]].forEach(([p, q]) => {
      const k = p < q ? `${p}|${q}` : `${q}|${p}`;
      if (edges.has(k)) return;
      const size = spacing ? Math.min(spacing[p], spacing[q]) : tin.spacingMinM;
      edges.set(k, { p, q, size: Math.round(size) });
    });
  });
  const classes = [...new Set([...edges.values()].map((e) => e.size))].sort((x, y) => x - y);
  const shown = classes.slice(0, 12);
  const ramp = (i) => {
    const t = shown.length > 1 ? i / (shown.length - 1) : 0;
    const r = Math.round(255 * Math.min(1, 1.6 - 1.6 * t));
    const g = Math.round(120 + 100 * t);
    const b = Math.round(80 + 175 * t);
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
  };
  const byClass = new Map(shown.map((c) => [c, []]));
  edges.forEach((e) => {
    const c = shown.find((x) => x >= e.size) ?? shown[shown.length - 1];
    byClass.get(c).push([[tin.lons[e.p], tin.lats[e.p]], [tin.lons[e.q], tin.lats[e.q]]]);
  });
  const features = shown.map((c, i) => ({
    type: "Feature",
    properties: { spacing_m: c, edges: byClass.get(c).length, colour: ramp(i) },
    geometry: { type: "MultiLineString", coordinates: byClass.get(c) },
  })).filter((f) => f.geometry.coordinates.length);
  showPreview("sampling", { type: "FeatureCollection", features }, {
    colourFor: (f) => f.properties.colour,
    outlineOnly: true,
    legendInfo: {
      palette: features.map((f) => f.properties.colour.slice(1)),
      labels: features.map((f) => `${fmt(f.properties.spacing_m)} m spacing · ${f.properties.edges.toLocaleString()} edges`),
      label: "Surface sampling", classed: true, categorical: true, unit: "m",
    },
    description: `${tin.nodes.toLocaleString()} nodes, ${tin.triangles.toLocaleString()} triangles; spacing ${fmt(tin.spacingMinM)}–${fmt(tin.spacingMaxM)} m.`,
  });
}

function drawPoints() {
  const points = embeddedPoints();
  const fc = { type: "FeatureCollection", features: points.map((p) => ({
    type: "Feature",
    properties: {
      name: p.name, layer: p.layer, ground_elevation_m: Number(p.groundZ ?? (p.z + p.depthM)).toFixed(1),
      depth_below_surface_m: p.depthM, node_z_m: Number(p.z).toFixed(1),
      x_m: Number(p.x).toFixed(1), y_m: Number(p.y).toFixed(1), label_rank: 0,
    },
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
  })) };
  showPreview("points", fc, {
    colourFor: () => "#ffd166",
    outlineOnly: false,
    legendInfo: { palette: ["ffd166"], labels: ["Embedded point (a mesh node exactly here)"], label: "Embedded points", classed: true, categorical: true, unit: null },
    description: "Points the mesh must pass through, at the surface's own interpolated elevation less their depth.",
  });
}

/**
 * The extended boundary, as etna's outer_box adds it: the rim's four corners
 * carried to the base and to the sky, drawn through the ground so the box is
 * visible where it is. TRUE vertical scale -- the globe's relief is
 * exaggerated by the slider, this box is not -- and the status says so.
 */
async function drawExtend(ext) {
  removePreview("extend");
  const t = surfaceLike();
  if (!ext || !t) return;
  if (!three) three = await import("../vendor/three.module.js");
  const viewer = window.GeoIDViewer;
  if (!viewer?.surfacePoint) return;
  const lines = extendedBoundaryLines(t, ext);
  const positions = [];
  const colours = [];
  const at = (x, y, z) => {
    const ll = t.frame.fromLocal(x, y);
    const ground = tinHeightAt(t, x, y);
    const lift = (z - (Number.isFinite(ground) ? ground : z)) * UNITS_PER_METRE;
    const p = viewer.surfacePoint(ll.lat, ll.lon, lift);
    return [p.x, p.y, p.z];
  };
  lines.forEach(([a, b]) => {
    const up = a[2] > t.zMax || b[2] > t.zMax;
    const c = up ? [0.62, 0.85, 1] : [0.79, 0.72, 0.61];
    positions.push(...at(a[0], a[1], a[2]), ...at(b[0], b[1], b[2]));
    colours.push(...c, ...c);
  });
  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new three.Float32BufferAttribute(colours, 3));
  const material = new three.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 });
  const segments = new three.LineSegments(geometry, material);
  segments.renderOrder = 235;
  segments.frustumCulled = false;
  const group = new three.Group();
  group.name = "GeoID-ModelBuilder-Extend";
  group.add(segments);
  const b = t.bounds;
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(PREVIEW_NAMES.extend, {
    object3D: group, georeferenced: true,
    bounds: { minX: b.west, minY: b.south, maxX: b.east, maxY: b.north },
    legendInfo: {
      palette: ["c9b79c", "9fd8ff"], labels: [
        `Subsurface: base ${ext.baseZ !== null ? `${fmt(ext.baseZ)} m` : "off"}`,
        `Atmosphere: sky ${ext.skyZ !== null ? `${fmt(ext.skyZ)} m` : "off"}`,
      ], label: "Extended boundary (true vertical scale)", classed: true, categorical: true, unit: null,
    },
    home: "model",
    metadata: { source: "GeoHUB Model Builder", dataType: "model", description: "The rim's corners carried to the base and the sky (etna.py outer_box). Drawn at true vertical scale through the exaggerated globe." },
  }, "derived");
  if (layer) state.previews.extend = layer.id;
}

/**
 * THE FULL MODEL ON THE GLOBE: the surface STL as a lit skin, the subsurface
 * as an earthen shell down to its base, the atmosphere as a translucent sky
 * up to its lid -- the three solids the package writes, drawn where they are,
 * through the ground (depth test off) at TRUE vertical scale. What the
 * Meshing Studio shows, seen on the map it came from.
 */
async function drawFullModel() {
  removePreview("model");
  const t = surfaceLike();
  if (!t) return;
  if (!three) three = await import("../vendor/three.module.js");
  const viewer = window.GeoIDViewer;
  if (!viewer?.surfacePoint) return;
  const at = (x, y, z) => {
    const ll = t.frame.fromLocal(x, y);
    const ground = tinHeightAt(t, x, y);
    const lift = (z - (Number.isFinite(ground) ? ground : z)) * UNITS_PER_METRE;
    const p = viewer.surfacePoint(ll.lat, ll.lon, lift);
    return [p.x, p.y, p.z];
  };
  const meshOf = (facets, colour, opacity, order) => {
    const positions = new Float32Array(facets.length * 9);
    facets.forEach((f, k) => {
      [f.a, f.b, f.c].forEach((v, m) => {
        const p = at(v[0], v[1], v[2]);
        positions.set(p, k * 9 + m * 3);
      });
    });
    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new three.Mesh(geometry, new three.MeshStandardMaterial({
      color: colour, roughness: 0.8, metalness: 0.02, side: three.DoubleSide, flatShading: true,
      transparent: true, opacity, depthTest: false, depthWrite: false,
    }));
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    return mesh;
  };
  const group = new three.Group();
  group.name = "GeoID-ModelBuilder-FullModel";
  const rock = shellFacets(t, { belowM: state.domain.depthM }).facets.filter((f) => f.face !== "ground");
  group.add(meshOf(rock, 0xa8703f, 0.5, 236));
  const skin = t.tris.map(([a, b, c]) => ({ a: [t.xs[a], t.ys[a], t.z[a]], b: [t.xs[b], t.ys[b], t.z[b]], c: [t.xs[c], t.ys[c], t.z[c]] }));
  group.add(meshOf(skin, 0x6fbf73, 0.85, 237));
  if (state.atmosphere.on) {
    const air = shellFacets(t, { aboveM: state.atmosphere.heightM }).facets.filter((f) => f.face !== "ground");
    group.add(meshOf(air, 0x7fc8ff, 0.22, 238));
  }
  const b = t.bounds;
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(PREVIEW_NAMES.model, {
    object3D: group, georeferenced: true,
    bounds: { minX: b.west, minY: b.south, maxX: b.east, maxY: b.north },
    legendInfo: {
      palette: ["a8703f", "6fbf73", ...(state.atmosphere.on ? ["7fc8ff"] : [])],
      labels: [
        `Subsurface — down to ${fmt(t.zMin - state.domain.depthM)} m`,
        `Surface STL — ${t.triangles.toLocaleString()} triangles, ${fmt(t.zMin)} to ${fmt(t.zMax)} m`,
        ...(state.atmosphere.on ? [`Atmosphere — up to ${fmt(t.zMax + state.atmosphere.heightM)} m`] : []),
      ],
      label: "The full model, at true vertical scale", classed: true, categorical: true, unit: null,
    },
    home: "model",
    metadata: { source: "GeoHUB Model Builder", dataType: "model", description: "The surface, subsurface and atmosphere solids the package writes, drawn through the ground at true vertical scale." },
  }, "derived");
  if (layer) state.previews.model = layer.id;
}

function clearPreviews() {
  Object.keys(state.previews).forEach(removePreview);
}

/** The surface in one shape whatever it was sampled as. */
function surfaceLike() {
  const sfc = state.surface;
  if (!sfc) return null;
  if (sfc.kind === "tin") return sfc;
  if (!sfc._tinLike) sfc._tinLike = gridAsTin(sfc);
  return sfc._tinLike;
}

/** A point projected onto the section line: its distance along it, and the profile's height there. */
function sectionPointOf(lat, lon) {
  const p = state.profile;
  if (!p) return null;
  const l = p.frame.toLocal(lat, lon);
  const sM = (l.x - p.start.x) * p.dir.x + (l.y - p.start.y) * p.dir.y;
  if (sM < 0 || sM > p.lengthM) return null;
  const off = Math.hypot(l.x - (p.start.x + p.dir.x * sM), l.y - (p.start.y + p.dir.y * sM));
  return { s: sM, z: profileHeightAt(p, sM), x: p.start.x + p.dir.x * sM, y: p.start.y + p.dir.y * sM, offM: off };
}

function groundAtLatLon(lat, lon) {
  if (state.kind === "section") {
    const q = sectionPointOf(lat, lon);
    return q ? { x: q.x, y: q.y, z: q.z, s: q.s, offM: q.offM } : null;
  }
  const t = surfaceLike();
  if (!t) return null;
  const local = t.frame.toLocal(lat, lon);
  const h = tinHeightAt(t, local.x, local.y);
  return Number.isFinite(h) ? { x: local.x, y: local.y, z: h } : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pickPoint(stepId) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.pickOnGlobe) { report(stepId, "The globe cannot be picked from here."); return null; }
  report(stepId, "Click the globe to place it.");
  try {
    const { lat, lon } = await viewer.pickOnGlobe();
    return { lat, lon: ((lon + 540) % 360) - 180 };
  } catch (error) {
    report(stepId, `No point picked: ${error.message}`);
    return null;
  }
}

function stepArea(body) {
  const options = [{ id: "drawn", label: "Drawn / boxed study area" }];
  polygonLayers().forEach((layer) => {
    options.push({ id: `layer:${layer.id}`, label: `▱ ${layer.name}` });
  });
  const picker = select("gis-mb-area", options,
    state.bounds?.layerId ? `layer:${state.bounds.layerId}` : "drawn");
  body.appendChild(row("Study area", picker));

  /**
   * THE DRAWER IS RAISED FROM HERE, rather than named and left to be found.
   *
   * The step read `getExtractionGeometry` and nothing else, so "draw a study
   * area" was an instruction to go and look for a tool on the other side of
   * the screen — and whichever one was found first decided which flow the
   * reader was in. `promptDrawTool` presses the tool rail's OWN Draw button,
   * which is what raises the shape bar: one drawer, armed one way, whether
   * the press comes from a hand on the rail, the extent picker or here.
   */
  const draw = el("button", "tool-button", "Draw on the globe");
  draw.type = "button";
  draw.addEventListener("click", () => {
    picker.value = "drawn";
    if (promptDrawTool()) {
      report("area", "Pick a shape on the bar and drag it out on the globe."
        + " Done files it, and this step takes it from there.");
    } else {
      report("area", "This world has no surface to draw a study area on.");
    }
  });

  const use = el("button", "tool-button", "Use this area");
  use.type = "button";
  use.addEventListener("click", () => {
    const resolved = resolveBounds(picker.value);
    if (resolved.error) {
      state.bounds = null;
      report("area", resolved.error);
      render();
      return;
    }
    state.bounds = resolved;
    state.surface = null;
    state.outputs = null;
    const plan = planGrid({
      bounds: resolved.bbox, stepM: 100, radiusKm: bodyRadiusKm(),
    });
    report("area", `${resolved.label} — model domain ${fmt(plan.widthM / 1000, 2)}`
      + ` × ${fmt(plan.heightM / 1000, 2)} km. The domain is the BOX over the shape:`
      + " a mesh that follows a hand-drawn outline inherits every jag as a sliver.");
    state.open = "layers";
    render();
  });
  const buttons = el("div", "gis-btn-row");
  buttons.appendChild(draw);
  buttons.appendChild(use);
  body.appendChild(buttons);

  const kindSel = select("gis-mb-kind", [
    { id: "3d", label: "3D block — surface, subsurface and atmosphere volumes" },
    { id: "surface", label: "2D surface only — the terrain STL, nothing under or over it" },
    { id: "section", label: "2D cross-section — a face along a line A–B" },
  ], state.kind);
  kindSel.addEventListener("change", () => {
    state.kind = kindSel.value;
    state.surface = null; state.profile = null; state.outputs = null;
    clearPreviews();
    render();
  });
  body.appendChild(row("Model", kindSel));

  if (state.kind === "section") {
    const sec = state.section;
    if (!sec.a || !sec.b) {
      const c = studyCentre();
      const b0 = state.bounds?.bbox;
      if (c && b0) {
        sec.a = { lat: c.lat, lon: b0.west + (b0.east - b0.west) * 0.05 };
        sec.b = { lat: c.lat, lon: b0.east - (b0.east - b0.west) * 0.05 };
      }
    }
    const line = el("div", "gis-metric", sec.a && sec.b
      ? `A ${sec.a.lat.toFixed(4)}°, ${sec.a.lon.toFixed(4)}° → B ${sec.b.lat.toFixed(4)}°, ${sec.b.lon.toFixed(4)}°`
        + ` — ${fmt(lineLengthKm(sec.a, sec.b), 2)} km. West to east through the centre until you pick otherwise.`
      : "Choose a study area first; the line starts west–east through its centre.");
    body.appendChild(line);
    ["a", "b"].forEach((end) => {
      const pick = el("button", "button secondary", `Pick ${end.toUpperCase()} on the globe`);
      pick.type = "button";
      pick.addEventListener("click", () => {
        void (async () => {
          const p = await pickPoint("area");
          if (!p) return;
          sec[end] = { lat: p.lat, lon: p.lon };
          state.profile = null; state.outputs = null;
          report("area", `${end.toUpperCase()} at ${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}°.`);
          drawSectionLine();
          render();
        })();
      });
      body.appendChild(pick);
    });
    if (sec.a && sec.b && state.previews.section === undefined) drawSectionLine();
  } else {
    removePreview("section");
  }
}

function lineLengthKm(a, b) {
  const R = bodyRadiusKm();
  const kmLat = (Math.PI * R) / 180;
  const kmLon = kmLat * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((b.lon - a.lon) * kmLon, (b.lat - a.lat) * kmLat);
}

/**
 * The section line on the ground, with its ends marked. RE-ENTRANT GUARD:
 * `addDerivedLayer` announces the change SYNCHRONOUSLY, the announcement
 * re-renders the builder, and the render saw no preview recorded yet (the
 * id is written after the call returns) and drew the line again -- an
 * unbounded recursion that hung the page. Measured, not theorised.
 */
let sectionLineBusy = false;
function drawSectionLine() {
  const sec = state.section;
  if (!sec.a || !sec.b || sectionLineBusy) return;
  sectionLineBusy = true;
  try { drawSectionLineNow(sec); } finally { sectionLineBusy = false; }
}

function drawSectionLineNow(sec) {
  const fc = { type: "FeatureCollection", features: [
    { type: "Feature", properties: { name: "Section A–B", colour: "#ffb84d" }, geometry: { type: "LineString", coordinates: [[sec.a.lon, sec.a.lat], [sec.b.lon, sec.b.lat]] } },
    { type: "Feature", properties: { name: "A", colour: "#ffd166" }, geometry: { type: "Point", coordinates: [sec.a.lon, sec.a.lat] } },
    { type: "Feature", properties: { name: "B", colour: "#ffd166" }, geometry: { type: "Point", coordinates: [sec.b.lon, sec.b.lat] } },
  ] };
  showPreview("section", fc, {
    colourFor: (f) => f.properties.colour, outlineOnly: false,
    legendInfo: { palette: ["ffb84d"], labels: ["The section line A–B"], label: "Cross-section", classed: true, categorical: true, unit: null },
    description: "The line the DEM is sampled along for the 2D cross-section.",
  });
}

/**
 * The section's faces, drawn where they stand: the profile at ground, the
 * base and the sky as lines under and over it, the ends joined -- through
 * the ground at true vertical scale, as the 3D extended boundary is drawn.
 */
async function drawSectionFaces() {
  removePreview("sectionFaces");
  const p = state.profile;
  if (!p) return;
  if (!three) three = await import("../vendor/three.module.js");
  const viewer = window.GeoIDViewer;
  if (!viewer?.surfacePoint) return;
  const polys = sectionPolygons(p, { belowM: state.domain.depthM, aboveM: state.atmosphere.on ? state.atmosphere.heightM : 0 });
  const at = (i, z) => { const lift = (z - p.z[i]) * UNITS_PER_METRE; const q = viewer.surfacePoint(p.lats[i], p.lons[i], lift); return [q.x, q.y, q.z]; };
  const positions = []; const colours = [];
  const seg = (a, b, c) => { positions.push(...a, ...b); colours.push(...c, ...c); };
  const rock = [0.79, 0.58, 0.36]; const air = [0.62, 0.85, 1]; const top = [0.44, 0.75, 0.45];
  for (let i = 0; i < p.n - 1; i += 1) seg(at(i, p.z[i]), at(i + 1, p.z[i + 1]), top);
  if (polys.baseZ !== null) {
    seg(at(0, polys.baseZ), at(p.n - 1, polys.baseZ), rock);
    seg(at(0, p.z[0]), at(0, polys.baseZ), rock); seg(at(p.n - 1, p.z[p.n - 1]), at(p.n - 1, polys.baseZ), rock);
  }
  if (polys.skyZ !== null) {
    seg(at(0, polys.skyZ), at(p.n - 1, polys.skyZ), air);
    seg(at(0, p.z[0]), at(0, polys.skyZ), air); seg(at(p.n - 1, p.z[p.n - 1]), at(p.n - 1, polys.skyZ), air);
  }
  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new three.Float32BufferAttribute(colours, 3));
  const segments = new three.LineSegments(geometry, new three.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }));
  segments.renderOrder = 236; segments.frustumCulled = false;
  const group = new three.Group(); group.name = "GeoID-ModelBuilder-Section"; group.add(segments);
  const layer = window.GeoIDImportManager?.addDerivedLayer?.("Model Builder — cross-section faces", {
    object3D: group, georeferenced: true,
    bounds: { minX: Math.min(p.a.lon, p.b.lon), maxX: Math.max(p.a.lon, p.b.lon), minY: Math.min(p.a.lat, p.b.lat), maxY: Math.max(p.a.lat, p.b.lat) },
    legendInfo: { palette: ["70bf73", "c9945c", "9fd8ff"], labels: ["Profile (the surface along the line)", `Subsurface face to ${polys.baseZ !== null ? `${fmt(polys.baseZ)} m` : "—"}`, `Atmosphere face to ${polys.skyZ !== null ? `${fmt(polys.skyZ)} m` : "—"}`], label: "Cross-section (true vertical scale)", classed: true, categorical: true, unit: null },
    home: "model",
    metadata: { source: "GeoHUB Model Builder", dataType: "model", description: "The 2D cross-section's faces, drawn in the vertical plane through the line at true vertical scale." },
  }, "derived");
  if (layer) state.previews.sectionFaces = layer.id;
}

function stepLayers(body) {
  const layers = loadedLayers();
  if (!layers.length) {
    body.appendChild(el("div", "gis-metric", "No layers loaded — add data in Workspace."));
  }
  layers.forEach((layer) => {
    const id = String(layer.id);
    if (!state.roles.has(id)) state.roles.set(id, defaultRole(layer));
    const picker = select(`gis-mb-role-${id}`, ROLE_OPTIONS, state.roles.get(id));
    picker.addEventListener("change", () => {
      state.roles.set(id, picker.value);
      state.surface = null;
      render();
    });
    body.appendChild(row(layer.name, picker));
    if (state.roles.get(id) === "points") {
      const depth = number(`gis-mb-depth-${id}`, state.pointDepth.get(id) ?? 0, 10);
      depth.addEventListener("input", () => {
        state.pointDepth.set(id, Number(depth.value) || 0);
      });
      body.appendChild(row("  ↳ metres below surface", depth));
    }
  });

  const reader = elevationReader();
  body.appendChild(el("div", "gis-metric", reader
    ? `Elevation from ${reader.name}.`
    : "No elevation source — this world exposes no DEM."));

  const modeOptions = [
    { id: "native", label: "Native (the source's own sampling)" },
    { id: "step", label: "Fixed step (metres)" },
  ];
  const mode = select("gis-mb-res-mode", modeOptions, state.resolution.mode);
  body.appendChild(row("Resolution", mode));
  const stepField = number("gis-mb-res-step", state.resolution.stepM, 10);
  const stepRow = row("Step (m)", stepField);
  stepRow.hidden = state.resolution.mode !== "step";
  body.appendChild(stepRow);
  mode.addEventListener("change", () => {
    state.resolution.mode = mode.value;
    stepRow.hidden = mode.value !== "step";
    state.surface = null;
  });
  stepField.addEventListener("input", () => {
    state.resolution.stepM = Number(stepField.value) || 100;
    state.surface = null;
  });

  const probe = el("button", "button secondary", "Measure native resolution");
  probe.type = "button";
  probe.addEventListener("click", () => {
    if (!reader || !state.bounds) {
      report("layers", "Choose a study area with an elevation source first.");
      return;
    }
    const centre = {
      lat: (state.bounds.bbox.south + state.bounds.bbox.north) / 2,
      lon: (state.bounds.bbox.west + state.bounds.bbox.east) / 2,
    };
    const measured = probeNativeStepM(reader.read, centre.lat, centre.lon);
    state.nativeStepM = measured;
    report("layers", measured
      ? `Native sampling is about ${fmt(measured)} m — measured from where the`
        + " source's own interpolation kinks, not declared."
      : "The elevation here is too flat to measure a native step; the study's"
        + " own size sets the resolution instead.");
    // The Surface step quotes this number, and it was built before the
    // measurement existed.
    render();
  });
  body.appendChild(probe);
}

/**
 * A REFINE REGION is a layer somebody points at, not a number they type.
 *
 * The study already holds polygons — a landslide scar, a dam footprint, a
 * catchment — and the mesh should be finer inside them. Their bounding box in
 * the model's own local metres is what `Field.Box` wants; the box rather than
 * the outline, for the same reason the domain is a box, which is that a mesh
 * graded to a hand-drawn jag inherits the jag as slivers.
 */
function refineRegions(grid) {
  if (!grid?.frame) return [];
  const out = [];
  loadedLayers().forEach((layer) => {
    if (state.roles.get(String(layer.id)) !== "refine") return;
    const rings = ringsFromCollection(layer.collection || { features: layer.features || [] });
    if (!rings?.length) return;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    rings.forEach((ring) => ring.forEach(([lon, lat]) => {
      const local = grid.frame.toLocal(lat, lon);
      if (local.x < xMin) xMin = local.x;
      if (local.x > xMax) xMax = local.x;
      if (local.y < yMin) yMin = local.y;
      if (local.y > yMax) yMax = local.y;
    }));
    if (!Number.isFinite(xMin) || xMax <= xMin) return;
    const size = Number(state.refineSize?.get(String(layer.id)));
    out.push({
      name: layer.name || "refine region",
      xMin, xMax, yMin, yMax,
      sizeM: Number.isFinite(size) && size > 0 ? size : undefined,
    });
  });
  return out;
}

function defaultRole(layer) {
  if (layer.source?.text || (layer.collection?.features || [])
    .every((f) => f?.geometry?.type === "Point")) {
    return (layer.collection?.features || []).length ? "points" : "ignore";
  }
  return "ignore";
}

/**
 * The step the surface is sampled at, and whether it is finer than the source.
 *
 * A global DEM has kilometre pixels; a 10 km study area is a fraction of one.
 * Sampling it at 80 m is legitimate — a mesh needs geometry, and interpolating
 * between DEM samples is how you get a smooth one — but it is NOT new detail,
 * and the step says so rather than letting a 121 x 121 grid imply the ground
 * was measured that finely. Same discipline as the imagery zoom ceiling: a
 * server answering is not the sensor having seen it.
 */
function resolutionPlan() {
  const plan = planGrid({ bounds: state.bounds.bbox, stepM: 1, radiusKm: bodyRadiusKm() });
  const span = Math.max(plan.widthM, plan.heightM);
  // A surface needs enough nodes to be a surface, whatever the source's own
  // sampling: eight cells across is the floor below which a "mesh" is a box.
  const meshFloor = span / 120;
  if (state.resolution.mode === "step") {
    const chosen = Math.max(state.resolution.stepM, 1);
    return { stepM: chosen, interpolated: state.nativeStepM ? chosen < state.nativeStepM : false };
  }
  if (state.nativeStepM) {
    if (state.nativeStepM <= span / 8) {
      return { stepM: state.nativeStepM, interpolated: false };
    }
    return { stepM: meshFloor, interpolated: true, coarserThanStudy: true };
  }
  return { stepM: meshFloor, interpolated: false, unmeasured: true };
}

function stepSurface(body) {
  if (state.kind === "section") { stepProfile(body); return; }
  const reader = elevationReader();
  const res = resolutionPlan();
  const plan = planGrid({ bounds: state.bounds.bbox, stepM: res.stepM, radiusKm: bodyRadiusKm() });
  const variable = state.sampling.mode === "variable";

  const modeSel = select("gis-mb-sampling", [
    { id: "uniform", label: "Uniform grid — one step everywhere" },
    { id: "variable", label: "Variable — native inside buffers, coarser outside" },
  ], state.sampling.mode);
  modeSel.addEventListener("change", () => {
    state.sampling.mode = modeSel.value;
    state.surface = null;
    state.outputs = null;
    removePreview("sampling");
    if (modeSel.value === "variable") drawBuffers(); else removePreview("buffers");
    render();
  });
  body.appendChild(row("Sampling", modeSel));

  if (variable) {
    samplingControls(body);
  } else {
    body.appendChild(el("div", "gis-metric",
      `${plan.nx} × ${plan.ny} nodes at ${fmt(plan.stepXm)} × ${fmt(plan.stepYm)} m`
      + `${plan.capped ? " (coarsened to stay inside the node budget)" : ""}.`
      + (res.coarserThanStudy
        ? ` The source samples every ${fmt(state.nativeStepM / 1000, 2)} km — coarser than`
          + " this whole study area, so the surface is INTERPOLATED between DEM samples."
          + " That is a smooth mesh, not new ground detail."
        : res.interpolated
          ? ` Finer than the source's own ${fmt(state.nativeStepM)} m sampling: interpolated,`
            + " not new detail."
          : res.unmeasured
            ? " Measure the native resolution in step 2 to know whether this is detail"
              + " or interpolation."
            : " At the source's own sampling.")));
  }

  const build = el("button", "tool-button", "Build surface");
  build.type = "button";
  build.addEventListener("click", () => {
    if (!reader && !window.GeoIDDem?.ensure) {
      report("surface", "No elevation source to sample.");
      return;
    }
    report("surface", "Loading the finest DEM for this area…");
    void (async () => {
      /**
       * THE DEM IS CLIPPED BEFORE IT IS SAMPLED, and at this area's own
       * ceiling rather than the view's. A model built while zoomed out used to
       * be carved from whatever posts the glance had loaded, and said nothing.
       */
      const best = await ensureBestDem(state.bounds?.bbox);
      const live = resolutionPlan();
      const source = elevationReader();
      if (!source) {
        report("surface", "No elevation source to sample.");
        render();
        return;
      }
      report("surface", best ? `Sampling ${best.label}…` : "Sampling…");
      window.requestAnimationFrame(() => {
        if (state.sampling.mode === "variable") {
          buildVariable(source, best);
          return;
        }
        // Read at PRESS time, never from the render that drew the button: the
        // native measurement in step 2 happens after this card is built, and a
        // closed-over step silently sampled at the pre-measurement resolution.
        const grid = buildSurface({
          bounds: state.bounds.bbox,
          stepM: live.stepM,
          radiusKm: bodyRadiusKm(),
          sampleElevation: source.read,
        });
        if (!grid.ok) {
          state.surface = null;
          report("surface", grid.message);
          render();
          return;
        }
        state.surface = grid;
        state.outputs = null;
        const skin = stlStats(surfaceStl(grid));
        drawSampling(gridAsTin(grid));
        report("surface", `${grid.nx} × ${grid.ny} nodes, ${fmt(grid.stepXm)} m spacing,`
          + ` elevation ${fmt(grid.zMin)} to ${fmt(grid.zMax)} m`
          + ` (relief ${fmt(grid.reliefM)} m) — ${skin.triangles.toLocaleString()} triangles`
          + `${grid.filledNodes ? `, ${grid.filledNodes} node(s) filled with the area mean` : ""}`
          + `${grid.repairedNodes
            ? `, ${grid.repairedNodes} source hole(s) repaired`
              + ` (worst ${fmt(grid.repairWorstM)} m)` : ""}`
          + `${best ? `, from ${best.label}` : ""}. Drawn on the globe as "${PREVIEW_NAMES.sampling}".`);
        state.open = "domain";
        render();
      });
    })();
  });
  body.appendChild(build);

  if (state.surface) {
    const isTin = state.surface.kind === "tin";
    const download = el("button", "button secondary", "Download surface STL");
    download.type = "button";
    download.addEventListener("click", () => {
      downloadText(`${modelName()}_surface.stl`, isTin
        ? tinSurfaceStl(state.surface, modelName()) : surfaceStl(state.surface, modelName()));
    });
    body.appendChild(download);
    const shown = state.previews.sampling !== undefined;
    const toggle = el("button", "button secondary", shown ? "Hide the sampling mesh" : "Show the sampling mesh");
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      if (shown) removePreview("sampling"); else drawSampling(surfaceLike());
      render();
    });
    body.appendChild(toggle);
  }
}

/**
 * THE PROFILE: the DEM along A-B, at a count of samples. The 2D model's
 * surface is this line, and everything below or above it is a face.
 */
function stepProfile(body) {
  const sec = state.section;
  const count = number("gis-mb-section-n", sec.n, 10);
  count.addEventListener("change", () => { sec.n = Math.max(2, Math.round(Number(count.value)) || 200); state.profile = null; state.outputs = null; });
  body.appendChild(row("Samples along the line", count));
  if (sec.a && sec.b) {
    const km = lineLengthKm(sec.a, sec.b);
    body.appendChild(el("div", "gis-metric", `${fmt(km, 2)} km from A to B; ${sec.n} samples is one every ${fmt((km * 1000) / Math.max(1, sec.n - 1))} m. The DEM is loaded at the finest level the line deserves first.`));
  } else {
    body.appendChild(el("div", "gis-metric", "Pick A and B in step 1."));
  }
  const build = el("button", "tool-button", "Build profile");
  build.type = "button";
  build.addEventListener("click", () => {
    if (!sec.a || !sec.b) { report("surface", "Pick A and B in step 1."); return; }
    report("surface", "Loading the finest DEM along the line…");
    void (async () => {
      const box = {
        west: Math.min(sec.a.lon, sec.b.lon) - 0.01, east: Math.max(sec.a.lon, sec.b.lon) + 0.01,
        south: Math.min(sec.a.lat, sec.b.lat) - 0.01, north: Math.max(sec.a.lat, sec.b.lat) + 0.01,
      };
      const best = await ensureBestDem(box);
      const source = elevationReader();
      if (!source) { report("surface", "No elevation source to sample."); render(); return; }
      const centre = studyCentre() || { lat: (sec.a.lat + sec.b.lat) / 2, lon: (sec.a.lon + sec.b.lon) / 2 };
      const frame = makeLocalFrame({ lat: centre.lat, lon: centre.lon, radiusKm: bodyRadiusKm() });
      const profile = profileAlong({ a: sec.a, b: sec.b, n: sec.n, heightAt: source.read, radiusKm: bodyRadiusKm(), frame });
      if (!profile.ok) { state.profile = null; report("surface", profile.message); render(); return; }
      state.profile = profile;
      state.outputs = null;
      drawSectionLine();
      void drawSectionFaces();
      report("surface", `${profile.n} samples over ${fmt(profile.lengthM / 1000, 2)} km (one every ${fmt(profile.stepM)} m); elevation ${fmt(profile.zMin)} to ${fmt(profile.zMax)} m (relief ${fmt(profile.reliefM)} m)`
        + `${profile.filledNodes ? `, ${profile.filledNodes} sample(s) filled with the mean` : ""}${best ? `, from ${best.label}` : ""}. Drawn on the globe as the section line and its faces.`);
      state.open = "domain";
      render();
    })();
  });
  body.appendChild(build);
  if (state.profile) {
    const csv = el("button", "button secondary", "Download the profile CSV");
    csv.type = "button";
    csv.addEventListener("click", () => downloadText(`${modelName()}_section.csv`, profileCsv(state.profile), "text/csv"));
    body.appendChild(csv);
  }
}

/**
 * The buffers: where the ground is sampled finer, and how much finer.
 * Edits apply on CHANGE rather than on every keystroke, because each edit
 * redraws the buffers on the globe and the layer change re-renders this card.
 */
function samplingControls(body) {
  const s = state.sampling;
  const span = studySpanM();
  const native = nativeM();
  if (!(s.baseM > 0)) s.baseM = Math.round(Math.max(native ? native * 8 : span / 60, span / 200));
  if (!(s.gradeM >= 0) || s.gradeM === null) s.gradeM = s.baseM * 2;

  const base = number("gis-mb-base", s.baseM, 10);
  base.addEventListener("change", () => { s.baseM = Math.max(1, Number(base.value) || s.baseM); state.surface = null; state.outputs = null; render(); });
  body.appendChild(row("Base step outside buffers (m)", base));
  const grade = number("gis-mb-grade", s.gradeM, 10);
  grade.addEventListener("change", () => { s.gradeM = Math.max(0, Number(grade.value) || 0); state.surface = null; state.outputs = null; render(); });
  body.appendChild(row("Grade back to the base over (m)", grade));

  body.appendChild(el("div", "gis-metric",
    `Native step ${native ? `${fmt(native)} m` : "not yet known — measure it in step 2, or build once and it is read off the DEM"}.`
    + ` Outside every buffer the ground is sampled every ${fmt(s.baseM)} m; inside one, at its own`
    + ` resolution; between, the spacing grows linearly over ${fmt(s.gradeM)} m.`
    + ` The finest buffer wins where they overlap. Node budget ${(DEFAULT_MAX_NODES * 2).toLocaleString()}: past it everything coarsens together.`));

  const list = el("div", null);
  body.appendChild(list);
  const buffers = allBuffers();
  if (!buffers.length) {
    list.appendChild(el("div", "gis-metric", "No buffers yet — the whole area is sampled at the base step. Add a square or a circle, or give a polygon layer the refine role in step 2."));
  }
  buffers.forEach((b, index) => {
    const card = el("div", "gis-tool-grid");
    if (b.fromLayer) {
      card.appendChild(el("div", "gis-metric", `▱ ${b.name} (refine-role layer): ${fmt(b.sizeKm, 2)} km box, ${b.stepM ? `${fmt(b.stepM)} m` : "native"} inside. Its step is the layer's refine size in step 2.`));
      list.appendChild(card);
      return;
    }
    const name = el("input", "input");
    name.value = b.name;
    name.addEventListener("change", () => { b.name = name.value || b.name; drawBuffers(); });
    card.appendChild(row("Name", name));
    const shape = select(`gis-mb-buf-shape-${index}`, [{ id: "square", label: "Square (side)" }, { id: "circle", label: "Circle (diameter)" }], b.shape);
    shape.addEventListener("change", () => { b.shape = shape.value; state.surface = null; drawBuffers(); render(); });
    card.appendChild(row("Shape", shape));
    const size = number(`gis-mb-buf-size-${index}`, Number(b.sizeKm).toFixed(2), 0.1);
    size.addEventListener("change", () => { b.sizeKm = Math.max(0.01, Number(size.value) || b.sizeKm); state.surface = null; drawBuffers(); render(); });
    card.appendChild(row("Size across (km)", size));
    const resSel = select(`gis-mb-buf-res-${index}`, [{ id: "native", label: "Native (the DEM's own step)" }, { id: "step", label: "A coarser step (m)" }], b.stepM ? "step" : "native");
    resSel.addEventListener("change", () => { b.stepM = resSel.value === "step" ? Math.max(1, Number(b.stepM) || (native ? native * 2 : 60)) : null; state.surface = null; drawBuffers(); render(); });
    card.appendChild(row("Resolution inside", resSel));
    if (b.stepM) {
      const step = number(`gis-mb-buf-step-${index}`, b.stepM, 5);
      step.addEventListener("change", () => { b.stepM = Math.max(1, Number(step.value) || b.stepM); state.surface = null; drawBuffers(); render(); });
      card.appendChild(row("  ↳ step (m)", step));
    }
    card.appendChild(el("div", "gis-metric", `Centre ${b.lat.toFixed(4)}°, ${b.lon.toFixed(4)}°.`));
    const pick = el("button", "button secondary", "Pick the centre on the globe");
    pick.type = "button";
    pick.addEventListener("click", () => {
      void (async () => {
        const p = await pickPoint("surface");
        if (!p) return;
        b.lat = p.lat; b.lon = p.lon; state.surface = null; state.outputs = null;
        report("surface", `${b.name} centred at ${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}°.`);
        drawBuffers();
        render();
      })();
    });
    card.appendChild(pick);
    const remove = el("button", "button secondary", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      s.buffers = s.buffers.filter((x) => x !== b);
      state.surface = null; state.outputs = null;
      drawBuffers();
      render();
    });
    card.appendChild(remove);
    list.appendChild(card);
  });

  const addBuffer = (shape) => {
    const centre = studyCentre();
    if (!centre) return;
    const n = s.buffers.length + 1;
    s.buffers.push({
      id: `b${Date.now()}`, name: `${shape === "circle" ? "Circle" : "Square"} ${n}`, shape,
      lat: centre.lat, lon: centre.lon, sizeKm: Math.max(0.2, Math.round((span / 4000) * 100) / 100), stepM: null,
    });
    state.surface = null; state.outputs = null;
    drawBuffers();
    render();
  };
  const addSquare = el("button", "button secondary", "Add a square buffer");
  addSquare.type = "button";
  addSquare.addEventListener("click", () => addBuffer("square"));
  body.appendChild(addSquare);
  const addCircle = el("button", "button secondary", "Add a circle buffer");
  addCircle.type = "button";
  addCircle.addEventListener("click", () => addBuffer("circle"));
  body.appendChild(addCircle);
}

/** The variable-resolution build: a TIN from the buffers, drawn as it is sampled. */
function buildVariable(source, best) {
  const s = state.sampling;
  const native = nativeM() || (best?.postM) || 30;
  const tin = buildTin({
    bounds: state.bounds.bbox,
    radiusKm: bodyRadiusKm(),
    heightAt: source.read,
    spacing: { baseM: s.baseM, gradeM: s.gradeM, buffers: allBuffers() },
    nativeM: native,
    maxNodes: DEFAULT_MAX_NODES * 2,
    minStepM: Math.max(1, native / 2),
  });
  if (!tin.ok) {
    state.surface = null;
    report("surface", tin.message);
    render();
    return;
  }
  state.surface = tin;
  state.outputs = null;
  drawSampling(tin);
  report("surface", `${tin.nodes.toLocaleString()} nodes, ${tin.triangles.toLocaleString()} triangles,`
    + ` spacing ${fmt(tin.spacingMinM)} to ${fmt(tin.spacingMaxM)} m over ${tin.leaves.toLocaleString()} cells`
    + ` (${tin.deepest} levels of refinement)${tin.capped ? `, coarsened ×${fmt(tin.factor, 2)} to stay inside the node budget` : ""};`
    + ` elevation ${fmt(tin.zMin)} to ${fmt(tin.zMax)} m (relief ${fmt(tin.reliefM)} m)`
    + `${tin.filledNodes ? `, ${tin.filledNodes} node(s) filled with the area mean` : ""}`
    + `${tin.repairedNodes ? `, ${tin.repairedNodes} source hole(s) repaired (worst ${fmt(tin.repairWorstM)} m)` : ""}`
    + `${best ? `, from ${best.label}` : ""}. Drawn on the globe as "${PREVIEW_NAMES.sampling}".`);
  state.open = "domain";
  render();
}

function stepDomain(body) {
  const kinds = [
    { id: "solid", label: "Solid (elastostatic — deformation)" },
    { id: "fluid", label: "Fluid (incompressible flow)" },
    { id: "gas", label: "Gas (compressible / atmospheric)" },
    { id: "thermal", label: "Thermal (heat conduction)" },
  ];
  const kind = select("gis-mb-domain", kinds, state.domain.type);
  body.appendChild(row("Domain", kind));

  const depth = number("gis-mb-depth", state.domain.depthM, 100);
  body.appendChild(row("Depth below the lowest ground (m)", depth));
  depth.addEventListener("input", () => {
    state.domain.depthM = Number(depth.value) || 1000;
    state.outputs = null;
  });

  /**
   * EXTEND THE BOUNDARY: etna's outer_box as a decision. The subsurface is
   * always built (the depth above); the ATMOSPHERE is a second closed shell
   * over the same ground, its own volume and its own gmsh script.
   */
  if (state.kind === "surface") {
    body.appendChild(el("div", "gis-metric", "Surface only: no subsurface or atmosphere is written for this model — the depth above is kept for when the kind changes."));
  }
  if (state.kind === "section") {
    body.appendChild(el("div", "gis-metric", "A cross-section: the depth and the height below become FACES in the vertical plane through A–B, sharing the profile as one edge."));
  }
  const airOn = el("input", null);
  airOn.type = "checkbox";
  airOn.id = "gis-mb-air";
  airOn.checked = state.atmosphere.on;
  airOn.addEventListener("change", () => { state.atmosphere.on = airOn.checked; state.outputs = null; render(); });
  body.appendChild(row("Atmosphere volume over the ground", airOn));
  if (state.atmosphere.on) {
    const height = number("gis-mb-air-height", state.atmosphere.heightM, 100);
    height.addEventListener("input", () => { state.atmosphere.heightM = Number(height.value) || 1000; state.outputs = null; });
    body.appendChild(row("Height above the highest ground (m)", height));
  }
  if (state.kind === "section") {
    const showSec = el("button", "button secondary", state.previews.sectionFaces !== undefined ? "Redraw the section faces" : "Show the section faces on the globe");
    showSec.type = "button";
    showSec.addEventListener("click", () => { if (!state.profile) { report("domain", "Build the profile first."); return; } void drawSectionFaces().then(() => { report("domain", "Section faces drawn at true vertical scale."); render(); }); });
    body.appendChild(showSec);
    return;
  }
  if (state.kind === "surface") return;
  const showExt = el("button", "button secondary", state.previews.extend !== undefined ? "Hide the extended boundary" : "Show the extended boundary on the globe");
  showExt.type = "button";
  showExt.addEventListener("click", () => {
    if (state.previews.extend !== undefined) { removePreview("extend"); render(); return; }
    const t = surfaceLike();
    if (!t) { report("domain", "Build the surface first."); return; }
    const ext = extendBoundary(t, { belowM: state.domain.depthM, aboveM: state.atmosphere.on ? state.atmosphere.heightM : 0 });
    void drawExtend(ext).then(() => {
      report("domain", `Rim corners carried to ${fmt(ext.baseZ)} m${ext.skyZ !== null ? ` and up to ${fmt(ext.skyZ)} m` : ""} — etna.py's outer_box points. Drawn at TRUE vertical scale; the globe's relief is exaggerated by the slider, this box is not.`);
      render();
    });
  });
  body.appendChild(showExt);
  const showModel = el("button", "button secondary", state.previews.model !== undefined ? "Hide the full model" : "Show the full model on the globe");
  showModel.type = "button";
  showModel.title = "The surface STL, the subsurface shell and the atmosphere shell, drawn through the ground at true vertical scale.";
  showModel.addEventListener("click", () => {
    if (state.previews.model !== undefined) { removePreview("model"); render(); return; }
    if (!surfaceLike()) { report("domain", "Build the surface first."); return; }
    void drawFullModel().then(() => {
      report("domain", `Full model drawn: surface, subsurface to ${fmt(state.domain.depthM)} m below the lowest ground${state.atmosphere.on ? `, atmosphere to ${fmt(state.atmosphere.heightM)} m above the highest` : ""} — at true vertical scale, through the ground.`);
      render();
    });
  });
  body.appendChild(showModel);

  const host = el("div", null);
  body.appendChild(host);
  const drawMaterials = () => {
    host.innerHTML = "";
    const type = state.domain.type;
    const base = DEFAULT_MATERIALS[type] || DEFAULT_MATERIALS.solid;
    const chosen = state.domain.materials[type] || { ...base };
    state.domain.materials[type] = chosen;
    Object.keys(base).forEach((key) => {
      const field = number(`gis-mb-mat-${key}`, chosen[key], "any");
      field.addEventListener("input", () => {
        chosen[key] = Number(field.value);
        state.outputs = null;
      });
      body.appendChild(row(MATERIAL_LABELS[key] || key, field));
      host.appendChild(field.parentElement);
    });
  };
  kind.addEventListener("change", () => {
    state.domain.type = kind.value;
    state.outputs = null;
    render();
  });
  drawMaterials();

  if (state.surface) {
    const baseZ = state.surface.zMin - Math.max(state.domain.depthM, 1);
    body.appendChild(el("div", "gis-metric",
      `The block runs from ${fmt(baseZ)} m at its base to ${fmt(state.surface.zMax)} m`
      + ` at the highest ground — ${fmt(state.surface.zMax - baseZ)} m thick.`));
  }
}

const MATERIAL_LABELS = {
  density: "Density (kg/m³)",
  young: "Young's modulus (Pa)",
  poisson: "Poisson's ratio",
  viscosity: "Dynamic viscosity (Pa·s)",
};

function stepConditions(body) {
  body.appendChild(el("p", "tool-copy",
    "A condition names one of the mesh's own boundary surfaces. The build script"
    + " creates them as physical groups, so these names are what the solver reads."));

  /**
   * THE FLAGS, which are what a solver actually reads.
   *
   * gmsh carries a name and a number for every group, and GALES' preprocessor
   * takes the NUMBER — `int(result[5])` out of the `$Entities` block — so a
   * deck written against an existing model means particular integers. The
   * study sets them here rather than inheriting whatever this file happened to
   * choose.
   *
   * ONE FLAG IS ONE GROUP: faces sharing a number are one boundary as far as
   * gmsh is concerned, which is how the four sides become a single lateral
   * boundary the way `etna_3d/input/gmsh_mesh.py` writes it. It is also how a
   * shared edge is decided — the lowest flag owns the curve and its corners —
   * so four sides at one number have no ambiguity between them at all.
   */
  const flags = el("details", "gis-tool-fold");
  const flagHead = el("summary", null, "Flags (the numbers a solver reads)");
  flags.appendChild(flagHead);
  const grid = el("div", "gis-tool-grid");
  [...SURFACES, "domain", "points"].forEach((key) => {
    const input = number(`gis-mb-flag-${key}`, state.flags[key] ?? DEFAULT_FLAGS[key], 1);
    input.addEventListener("input", () => {
      const value = Math.round(Number(input.value));
      if (value > 0) { state.flags[key] = value; state.outputs = null; }
    });
    grid.appendChild(row(key === "domain" ? "Volume"
      : key === "points" ? "Embedded points" : key, input));
  });
  flags.appendChild(grid);
  flags.appendChild(el("p", "tool-copy",
    "Faces given the same number become one boundary — four sides at 5 is the"
    + " single lateral boundary the GALES decks are written against. Where two"
    + " faces meet, the lower number owns the edge and its corners, which is"
    + " what keeps every point tagged: a point with no flag stops the mesh"
    + " being read at all."));
  body.appendChild(flags);

  const list = el("div", null);
  body.appendChild(list);

  const drawList = () => {
    list.innerHTML = "";
    if (!state.conditions.length) {
      list.appendChild(el("div", "gis-metric", "No conditions yet."));
    }
    state.conditions.forEach((bc, index) => {
      const card = el("div", "gis-tool-grid");
      const surface = select(`gis-mb-bc-surface-${index}`,
        SURFACES.map((s) => ({ id: s, label: s })), bc.surface);
      surface.addEventListener("change", () => { bc.surface = surface.value; state.outputs = null; });
      const kind = select(`gis-mb-bc-kind-${index}`, [
        { id: "dirichlet", label: "Fixed value (Dirichlet)" },
        { id: "neumann", label: "Flux / traction (Neumann)" },
        { id: "initial", label: "Initial condition" },
      ], bc.type);
      kind.addEventListener("change", () => { bc.type = kind.value; state.outputs = null; });
      const field = el("input", "input");
      field.value = bc.field || "";
      field.placeholder = "quantity, e.g. displacement";
      field.addEventListener("input", () => { bc.field = field.value; state.outputs = null; });
      const value = el("input", "input");
      value.value = bc.value ?? "";
      value.placeholder = "value";
      value.addEventListener("input", () => { bc.value = value.value; state.outputs = null; });
      card.appendChild(row("Surface", surface));
      card.appendChild(row("Type", kind));
      card.appendChild(row("Quantity", field));
      card.appendChild(row("Value", value));
      const remove = el("button", "button secondary", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        state.conditions.splice(index, 1);
        state.outputs = null;
        drawList();
      });
      card.appendChild(remove);
      if (bc.source) card.appendChild(el("div", "gis-metric", `From ${bc.source}.`));
      list.appendChild(card);
    });
  };

  const add = el("button", "button secondary", "Add a condition");
  add.type = "button";
  add.addEventListener("click", () => {
    state.conditions.push({ surface: "base", type: "dirichlet", field: "", value: "" });
    state.outputs = null;
    drawList();
  });
  body.appendChild(add);

  // Layers given a condition role seed rows rather than being silently ignored:
  // step 2 is where somebody said this layer drives the model, and this is the
  // step where that has to become something the solver can read.
  const seeds = loadedLayers().filter((layer) =>
    ["initial", "boundary"].includes(state.roles.get(String(layer.id))));
  if (seeds.length) {
    const seed = el("button", "button secondary",
      `Seed from ${seeds.length} assigned layer${seeds.length === 1 ? "" : "s"}`);
    seed.type = "button";
    seed.addEventListener("click", () => {
      seeds.forEach((layer) => {
        const role = state.roles.get(String(layer.id));
        if (state.conditions.some((bc) => bc.source === layer.name)) return;
        state.conditions.push({
          surface: role === "initial" ? "top" : "base",
          type: role === "initial" ? "initial" : "dirichlet",
          field: "",
          value: "",
          source: layer.name,
        });
      });
      state.outputs = null;
      drawList();
    });
    body.appendChild(seed);
  }
  drawList();

  pointControls(body);
  const points = embeddedPoints();
  body.appendChild(el("div", "gis-metric", points.length
    ? `${points.length} point${points.length === 1 ? "" : "s"} will be embedded in the`
      + " mesh — the solver gets a node exactly there, at the surface's own interpolated height less its depth."
    : "No embedded points. Place one on the globe, or give a point layer the \"Embedded points\" role in step 2."));
}

/**
 * Points placed by hand: a site, a borehole, a probe. Each takes the surface's
 * own INTERPOLATED height at its lat/lon -- barycentric on the triangle it
 * falls in -- less a depth, and is drawn on the globe so the reader can see
 * where the mesh will have a node.
 */
function pointControls(body) {
  const list = el("div", null);
  body.appendChild(list);
  const draw = () => {
    list.innerHTML = "";
    state.customPoints.forEach((p, index) => {
      const card = el("div", "gis-tool-grid");
      const name = el("input", "input");
      name.value = p.name;
      name.addEventListener("change", () => { p.name = name.value || p.name; state.outputs = null; drawPoints(); });
      card.appendChild(row("Name", name));
      const depth = number(`gis-mb-cp-depth-${index}`, p.depthM, 10);
      depth.addEventListener("change", () => { p.depthM = Number(depth.value) || 0; state.outputs = null; drawPoints(); draw(); });
      card.appendChild(row("Metres below the surface", depth));
      const g = groundAtLatLon(p.lat, p.lon);
      card.appendChild(el("div", "gis-metric", `${p.lat.toFixed(5)}°, ${p.lon.toFixed(5)}° — `
        + (g ? `surface ${fmt(g.z)} m (interpolated), node at ${fmt(g.z - (p.depthM || 0))} m; local x ${fmt(g.x)} y ${fmt(g.y)} m`
          : state.surface ? "outside the surface" : "build the surface to read its height")));
      const remove = el("button", "button secondary", "Remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        state.customPoints = state.customPoints.filter((x) => x !== p);
        state.outputs = null;
        drawPoints();
        render();
      });
      card.appendChild(remove);
      list.appendChild(card);
    });
  };
  const addAt = (lat, lon) => {
    state.customPoints.push({ id: `p${Date.now()}`, name: `point_${state.customPoints.length + 1}`, lat, lon, depthM: 0 });
    state.outputs = null;
    drawPoints();
    render();
  };
  const pick = el("button", "button secondary", "Place a point on the globe");
  pick.type = "button";
  pick.addEventListener("click", () => {
    void (async () => {
      const p = await pickPoint("conditions");
      if (!p) return;
      const g = groundAtLatLon(p.lat, p.lon);
      report("conditions", g ? `Point placed at ${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}°: surface ${fmt(g.z)} m.`
        : `Point placed at ${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}° — outside the surface, so it will not embed.`);
      addAt(p.lat, p.lon);
    })();
  });
  body.appendChild(pick);
  const centre = el("button", "button secondary", "Add a point at the study centre");
  centre.type = "button";
  centre.addEventListener("click", () => { const c = studyCentre(); if (c) addAt(c.lat, c.lon); });
  body.appendChild(centre);
  draw();
}

/**
 * The points the mesh must pass through, in the model's own metric frame.
 *
 * A site, a borehole or a probe is only useful if the mesh has a node AT it —
 * otherwise every reading downstream is an interpolation nobody asked for.
 * Depth is measured from the ground the surface step sampled, so "50 m below
 * the surface" means below the terrain rather than below sea level.
 */
function embeddedPoints() {
  const t = state.kind === "section" ? state.profile : surfaceLike();
  if (!t) return [];
  const sizeM = Math.max((state.kind === "section" ? t.stepM : t.spacingMinM) / 3, 1);
  const sizeFor = (name) => { const v = Number(state.pointSizeByName.get(String(name))); return v > 0 ? v : sizeM; };
  const out = [];
  loadedLayers().forEach((layer) => {
    if (state.roles.get(String(layer.id)) !== "points") return;
    const depth = state.pointDepth.get(String(layer.id)) || 0;
    (layer.collection?.features || []).forEach((f, index) => {
      if (f?.geometry?.type !== "Point") return;
      const [lon, lat] = f.geometry.coordinates;
      const g = groundAtLatLon(lat, lon);
      if (!g) return;
      out.push({
        x: g.x,
        y: g.y,
        // Strictly inside: a point ON the top surface is not in the volume, and
        // gmsh refuses to embed it there.
        z: g.z - depth,
        sizeM: sizeFor(f.properties?.name || f.properties?.site || `${layer.name}_${index + 1}`),
        name: String(f.properties?.name || f.properties?.site || `${layer.name}_${index + 1}`),
        layer: layer.name,
        // Per LAYER, not per point: a study flags "the piezometers", and a
        // point that wants its own number is its own layer.
        flag: Number(state.pointFlagByName.get(String(f.properties?.name || f.properties?.site || `${layer.name}_${index + 1}`)))
          || Number(state.pointFlag.get(String(layer.id)))
          || state.flags.points || DEFAULT_FLAGS.points,
        lat,
        lon,
        depthM: depth,
        groundZ: g.z,
      });
    });
  });
  state.customPoints.forEach((p, index) => {
    const g = groundAtLatLon(p.lat, p.lon);
    if (!g) return;
    out.push({
      x: g.x, y: g.y, z: g.z - (p.depthM || 0), sizeM: sizeFor(p.name || `point_${index + 1}`), s: g.s,
      name: String(p.name || `point_${index + 1}`), layer: "placed on the globe",
      flag: Number(state.pointFlagByName.get(String(p.name || `point_${index + 1}`))) || state.flags.points || DEFAULT_FLAGS.points,
      lat: p.lat, lon: p.lon, depthM: p.depthM || 0, groundZ: g.z,
    });
  });
  return out;
}

function modelName() {
  const label = state.bounds?.label || "model";
  return `geoid_${String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`.slice(0, 48);
}

/** What the grading will actually do to this surface, before it is built. */
/**
 * The default element size is twice the surface's COARSE spacing. For a TIN
 * that is the base step, not the finest buffer: MeshSizeMax caps every element
 * in the volume, and capping at twice a 7 m buffer over a 16 km box asked for
 * millions of tetrahedra. The size FIELD is what brings a buffer down.
 */
function defaultMeshSizeM() {
  if (state.kind === "section") return state.profile ? Math.max(10, Math.round(state.profile.stepM * 4)) : 200;
  const grid = state.surface;
  if (!grid) return 200;
  const coarse = grid.kind === "tin" ? grid.spacingMaxM : grid.stepXm;
  return Math.max(1, Math.round((coarse || 100) * 2));
}

function sizeFieldPreview() {
  const grid = state.surface;
  if (!grid) return null;
  const base = Number(state.meshSizeM) || defaultMeshSizeM();
  const field = sizeField(grid, {
    coarseM: Number(state.grading.coarseM) > 0 ? Number(state.grading.coarseM) : base,
    fineM: Number(state.grading.fineM) > 0 ? Number(state.grading.fineM) : base / 4,
    slopeRefDeg: Number(state.grading.slopeRefDeg) || 30,
  });
  if (!field) return null;
  if (field.minM === field.maxM) {
    return `This ground is flat enough that the field is one size, ${fmt(field.maxM)} m —`
      + " grading it would change nothing.";
  }
  return `${fmt(field.minM)} to ${fmt(field.maxM)} m across the study, steepest`
    + ` slope ${fmt(field.steepestDeg)}°.`;
}

/** The boundaries a field can be measured from, by the study's own keys and flags. */
function boundaryKeys() {
  const F = state.flags;
  const keys = [["top", "the ground (top)", F.terrain ?? F.top], ["base", "the base", F.base], ["sides_below", "the rock's sides", F.sides_below]];
  if (state.atmosphere.on) keys.push(["sky", "the sky", F.sky], ["sides_above", "the air's sides", F.sides_above]);
  return keys;
}

/** Which script a boundary field belongs in: the rock's has top/base/sides_below, the air's top/sky/sides_above. */
const SCRIPT_KEYS = { subsurface: ["top", "base", "sides_below"], atmosphere: ["top", "sky", "sides_above"], section: ["top", "base", "sides_below", "sky", "sides_above"] };

/**
 * A FIELD RESOLVED into the coordinates the script meshes in: east/north/up
 * metres for a block, (s, z, 0) for a section. Lat/lon go through the
 * study's frame, a named point through the embedded points, a depth through
 * the surface's own height there. A field that cannot be placed (no point
 * picked yet) is left out and the status says so.
 */
function resolveSizeFields(which) {
  const section = state.kind === "section";
  const t = section ? state.profile : surfaceLike();
  if (!t) return { fields: [], skipped: [] };
  const points = embeddedPoints();
  const F = state.flags;
  const local = (lat, lon, depthM = 0, zM = null) => {
    const g = groundAtLatLon(lat, lon);
    if (!g) return null;
    const z = Number.isFinite(Number(zM)) && zM !== null && zM !== "" ? Number(zM) : g.z - (Number(depthM) || 0);
    return section ? { x: g.s, y: z, z: 0 } : { x: g.x, y: g.y, z };
  };
  const out = []; const skipped = [];
  (state.sizeFields || []).forEach((fld) => {
    if (fld.on === false) return;
    const base = { type: fld.type, name: fld.name, on: true };
    if (fld.type === "point") {
      let at = null;
      if (fld.pointName) {
        const p = points.find((q) => q.name === fld.pointName);
        if (p) at = section ? { x: p.s, y: p.z, z: 0 } : { x: p.x, y: p.y, z: p.z };
      } else if (Number.isFinite(fld.lat) && Number.isFinite(fld.lon)) at = local(fld.lat, fld.lon, fld.depthM);
      if (!at) { skipped.push(fld.name); return; }
      out.push({ ...base, ...at, sizeM: fld.sizeM, distMinM: fld.distMinM, distMaxM: fld.distMaxM, sizeMaxM: fld.sizeMaxM });
    } else if (fld.type === "boundary") {
      if (which && !SCRIPT_KEYS[which]?.includes(fld.key)) return;
      const flag = fld.key === "top" ? (F.terrain ?? F.top) : F[fld.key];
      if (!(flag > 0)) { skipped.push(fld.name); return; }
      out.push({ ...base, key: fld.key, flag, entityDim: section ? 1 : 2, sizeM: fld.sizeM, distMinM: fld.distMinM, distMaxM: fld.distMaxM, sizeMaxM: fld.sizeMaxM });
    } else if (fld.type === "box") {
      if (![fld.west, fld.east, fld.south, fld.north].every((v) => Number.isFinite(v))) { skipped.push(fld.name); return; }
      if (section) {
        const a = sectionPointOf((fld.south + fld.north) / 2, fld.west); const b = sectionPointOf((fld.south + fld.north) / 2, fld.east);
        const corners = [a, b].filter(Boolean);
        if (!corners.length) { skipped.push(fld.name); return; }
        const xs = corners.map((c) => c.s);
        out.push({ ...base, xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Number.isFinite(fld.zMinM) ? fld.zMinM : -1e9, yMax: Number.isFinite(fld.zMaxM) ? fld.zMaxM : 1e9, zMin: -1, zMax: 1, sizeM: fld.sizeM, sizeOutM: fld.sizeOutM, thicknessM: fld.thicknessM });
      } else {
        const a = t.frame.toLocal(fld.south, fld.west); const b = t.frame.toLocal(fld.north, fld.east);
        out.push({ ...base, xMin: Math.min(a.x, b.x), xMax: Math.max(a.x, b.x), yMin: Math.min(a.y, b.y), yMax: Math.max(a.y, b.y), zMin: Number.isFinite(fld.zMinM) ? fld.zMinM : null, zMax: Number.isFinite(fld.zMaxM) ? fld.zMaxM : null, sizeM: fld.sizeM, sizeOutM: fld.sizeOutM, thicknessM: fld.thicknessM });
      }
    } else if (fld.type === "ball") {
      const at = Number.isFinite(fld.lat) && Number.isFinite(fld.lon) ? local(fld.lat, fld.lon, fld.depthM, fld.zM) : null;
      if (!at) { skipped.push(fld.name); return; }
      out.push({ ...base, ...at, radiusM: fld.radiusM, sizeM: fld.sizeM, sizeOutM: fld.sizeOutM, thicknessM: fld.thicknessM });
    } else if (fld.type === "expr") {
      if (!String(fld.expression || "").trim()) { skipped.push(fld.name); return; }
      out.push({ ...base, expression: String(fld.expression) });
    }
  });
  return { fields: out, skipped };
}

/** The global knobs as the script emitter reads them; undefined means the study's default. */
function effectiveMeshOptions(coarseM, autoFloorM = null) {
  const o = state.meshOptions || {};
  const sizeMaxM = o.sizeMaxM === undefined ? coarseM : (Number(o.sizeMaxM) > 0 ? Number(o.sizeMaxM) : null);
  let sizeMinM = o.sizeMinM === undefined ? autoFloorM : (Number(o.sizeMinM) > 0 ? Number(o.sizeMinM) : null);
  const smallest = smallestSize(state.sizeFields);
  if (o.sizeMinM === undefined && smallest !== null) sizeMinM = Math.max(1, Math.min(sizeMinM ?? Infinity, smallest / 2));
  return {
    combine: o.combine === "max" ? "max" : "min",
    sizeMaxM, sizeMinM,
    extendFromBoundary: Boolean(o.extendFromBoundary), fromPoints: Boolean(o.fromPoints),
    fromCurvature: Number(o.fromCurvature) > 0 ? Number(o.fromCurvature) : 0,
    algorithm2d: Number(o.algorithm2d) > 0 ? Number(o.algorithm2d) : null,
    algorithm3d: Number(o.algorithm3d) > 0 ? Number(o.algorithm3d) : null,
  };
}

/** The fields on the globe: a ring at each point's reach, a circle, a box; coloured by their size. */
function drawSizeFields() {
  removePreview("fields");
  const fields = (state.sizeFields || []).filter((fld) => fld.on !== false);
  const points = embeddedPoints();
  const features = [];
  const sizeOf = (fld) => `${Math.round(fld.sizeM)} m`;
  fields.forEach((fld) => {
    if (fld.type === "point") {
      let lat = fld.lat; let lon = fld.lon;
      if (fld.pointName) { const p = points.find((q) => q.name === fld.pointName); if (p) { lat = p.lat; lon = p.lon; } }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      features.push({ type: "Feature", properties: { name: fld.name, size: sizeOf(fld) }, geometry: { type: "Polygon", coordinates: [bufferRing({ shape: "circle", lat, lon, sizeKm: (fld.distMaxM * 2) / 1000 })] } });
      features.push({ type: "Feature", properties: { name: `${fld.name} (inner)`, size: sizeOf(fld) }, geometry: { type: "Polygon", coordinates: [bufferRing({ shape: "circle", lat, lon, sizeKm: (fld.distMinM * 2) / 1000 })] } });
    } else if (fld.type === "ball") {
      if (!Number.isFinite(fld.lat) || !Number.isFinite(fld.lon)) return;
      features.push({ type: "Feature", properties: { name: fld.name, size: sizeOf(fld) }, geometry: { type: "Polygon", coordinates: [bufferRing({ shape: "circle", lat: fld.lat, lon: fld.lon, sizeKm: (fld.radiusM * 2) / 1000 })] } });
    } else if (fld.type === "box") {
      if (![fld.west, fld.east, fld.south, fld.north].every((v) => Number.isFinite(v))) return;
      features.push({ type: "Feature", properties: { name: fld.name, size: sizeOf(fld) }, geometry: { type: "Polygon", coordinates: [[[fld.west, fld.south], [fld.east, fld.south], [fld.east, fld.north], [fld.west, fld.north], [fld.west, fld.south]]] } });
    }
  });
  if (!features.length) return false;
  const sizes = [...new Set(features.map((f) => f.properties.size))].sort((a, b) => parseFloat(a) - parseFloat(b));
  const palette = ["ff5c8a", "ffb84d", "ffe66d", "7ed957", "5cc8ff", "b28dff", "ff8c42", "9ad9dd"];
  const colourOf = (size) => `#${palette[sizes.indexOf(size) % palette.length]}`;
  showPreview("fields", { type: "FeatureCollection", features }, {
    colourFor: (f) => colourOf(f.properties.size), outlineOnly: true,
    legendInfo: { palette: sizes.map((sz) => colourOf(sz).slice(1)), labels: sizes.map((sz) => `elements of ${sz}`), label: "Mesh size fields", classed: true, categorical: true, unit: null },
    description: "Where the mesh is asked to be a size: a point's reach (inner and outer rings), a circle, a box. Boundary and formula fields have no outline to draw.",
  });
  return true;
}

/**
 * THE MESH SIZE CONTROLS. Not one element size: gmsh's fields, user-defined,
 * each a card -- pick a point, name a boundary, draw a box or a circle, type
 * a formula -- with the global cap, floor, combination and gmsh's own
 * sources as controls rather than defaults nobody sees.
 */
function sizeFieldControls(body) {
  const coarseDefault = defaultMeshSizeM();
  const o = state.meshOptions;
  const optNum = (id, label, key, placeholder, step) => {
    const input = number(id, o[key] === undefined ? "" : (o[key] ?? ""), step);
    input.placeholder = placeholder;
    input.addEventListener("change", () => {
      const v = input.value.trim();
      o[key] = v === "" ? null : Number(v);
      if (key === "sizeMaxM") state.meshSizeM = Number(v) > 0 ? Number(v) : null;
      state.outputs = null;
    });
    body.appendChild(row(label, input));
    return input;
  };
  const cap = optNum("gis-mb-size-max", "Element size cap (m)", "sizeMaxM", `${coarseDefault} = twice the coarse spacing; blank = gmsh decides`, 10);
  if (o.sizeMaxM === undefined) cap.value = String(state.meshSizeM || coarseDefault);
  optNum("gis-mb-size-min", "Element size floor (m)", "sizeMinM", "blank = half the smallest field size", 1);

  const combine = select("gis-mb-combine", [{ id: "min", label: "the smallest wins (Min)" }, { id: "max", label: "the largest wins (Max)" }], o.combine || "min");
  combine.addEventListener("change", () => { o.combine = combine.value; state.outputs = null; });
  body.appendChild(row("Where fields overlap", combine));

  const tick = (id, label, key) => {
    const box = el("input", null); box.type = "checkbox"; box.id = id; box.checked = Boolean(o[key]);
    box.addEventListener("change", () => { o[key] = box.checked; state.outputs = null; });
    body.appendChild(row(label, box));
  };
  tick("gis-mb-src-boundary", "gmsh: extend sizes from the boundary", "extendFromBoundary");
  tick("gis-mb-src-points", "gmsh: sizes from the geometry's points", "fromPoints");
  const curv = number("gis-mb-src-curv", o.fromCurvature || 0, 1);
  curv.placeholder = "0 = off; else elements per 2π";
  curv.addEventListener("change", () => { o.fromCurvature = Number(curv.value) || 0; state.outputs = null; });
  body.appendChild(row("gmsh: sizes from curvature", curv));
  if (state.kind !== "section") {
    const alg = select("gis-mb-alg3d", [{ id: "", label: "gmsh's default (Delaunay)" }, { id: "1", label: "1 — Delaunay" }, { id: "4", label: "4 — Frontal" }, { id: "7", label: "7 — MMG3D" }, { id: "10", label: "10 — HXT (parallel)" }], o.algorithm3d ? String(o.algorithm3d) : "");
    alg.addEventListener("change", () => { o.algorithm3d = alg.value ? Number(alg.value) : null; state.outputs = null; });
    body.appendChild(row("3D algorithm", alg));
  } else {
    const alg = select("gis-mb-alg2d", [{ id: "", label: "gmsh's default" }, { id: "1", label: "1 — MeshAdapt" }, { id: "5", label: "5 — Delaunay" }, { id: "6", label: "6 — Frontal-Delaunay" }, { id: "8", label: "8 — Frontal-Delaunay for quads" }], o.algorithm2d ? String(o.algorithm2d) : "");
    alg.addEventListener("change", () => { o.algorithm2d = alg.value ? Number(alg.value) : null; state.outputs = null; });
    body.appendChild(row("2D algorithm", alg));
  }

  body.appendChild(el("div", "gis-metric", "Size fields — gmsh's own. Each is combined with the others and set as the background mesh; the cap above is only a ceiling over them."));
  const list = el("div", "gis-tool-grid");
  list.style.gridTemplateColumns = "minmax(0, 1fr)";
  const fields = state.sizeFields || [];
  if (!fields.length) list.appendChild(el("div", "gis-metric", "No fields yet: one element size everywhere (graded on slopes if that is ticked below)."));
  const num = (card, label, fld, key, step, blankLabel = null) => {
    const input = number(`gis-mb-f-${fld.id}-${key}`, fld[key] ?? "", step);
    if (blankLabel) input.placeholder = blankLabel;
    input.addEventListener("change", () => { const v = input.value.trim(); fld[key] = v === "" ? null : Number(v); state.outputs = null; });
    card.appendChild(row(label, input));
  };
  const pickInto = (card, fld, label, after) => {
    const btn = el("button", "button secondary", label); btn.type = "button";
    btn.addEventListener("click", () => { void (async () => { const p = await pickPoint("build"); if (!p) return; after(p); state.outputs = null; report("build", `${fld.name}: ${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}°.`); drawSizeFields(); render(); })(); });
    card.appendChild(btn);
  };
  fields.forEach((fld) => {
    const card = el("div", "gis-tool-section");
    card.style.padding = "0.45rem 0.6rem";
    const head = el("div", null);
    head.style.cssText = "display:flex;align-items:center;gap:0.4rem";
    const on = el("input", null); on.type = "checkbox"; on.checked = fld.on !== false;
    on.addEventListener("change", () => { fld.on = on.checked; state.outputs = null; });
    const name = el("input", "input"); name.value = fld.name; name.style.flex = "1";
    name.addEventListener("change", () => { fld.name = name.value || fld.name; state.outputs = null; });
    const kind = el("span", "gis-metric", FIELD_TYPES[fld.type]?.label || fld.type);
    const remove = el("button", "button secondary", "✕"); remove.type = "button"; remove.title = "Remove this field";
    remove.addEventListener("click", () => { state.sizeFields = state.sizeFields.filter((x) => x !== fld); state.outputs = null; drawSizeFields(); render(); });
    head.appendChild(on); head.appendChild(name); head.appendChild(remove);
    card.appendChild(head); card.appendChild(kind);
    if (fld.type === "point") {
      const pts = embeddedPoints();
      const at = select(`gis-mb-f-${fld.id}-at`, [{ id: "", label: fld.lat !== null ? `picked: ${Number(fld.lat).toFixed(4)}°, ${Number(fld.lon).toFixed(4)}°` : "a point on the globe (pick below)" }, ...pts.map((p) => ({ id: p.name, label: `embedded point "${p.name}"` }))], fld.pointName || "");
      at.addEventListener("change", () => { fld.pointName = at.value || null; state.outputs = null; drawSizeFields(); });
      card.appendChild(row("At", at));
      pickInto(card, fld, "Pick the point on the globe", (p) => { fld.lat = p.lat; fld.lon = p.lon; fld.pointName = null; });
      num(card, "Depth below the surface (m)", fld, "depthM", 10);
      num(card, "Size at the point (m)", fld, "sizeM", 1);
      num(card, "Held to this distance (m)", fld, "distMinM", 10);
      num(card, "Graded out to (m)", fld, "distMaxM", 10);
      num(card, "Size past that (m)", fld, "sizeMaxM", 10, "blank = the cap");
    } else if (fld.type === "boundary") {
      const keys = boundaryKeys();
      const key = select(`gis-mb-f-${fld.id}-key`, keys.map(([k, label, flag]) => ({ id: k, label: `${label} — flag ${flag}` })), fld.key);
      key.addEventListener("change", () => { fld.key = key.value; state.outputs = null; });
      card.appendChild(row("Boundary", key));
      num(card, "Size on the boundary (m)", fld, "sizeM", 1);
      num(card, "Held to this distance (m)", fld, "distMinM", 10);
      num(card, "Graded out to (m)", fld, "distMaxM", 10);
      num(card, "Size past that (m)", fld, "sizeMaxM", 10, "blank = the cap");
    } else if (fld.type === "box") {
      const where = fld.west !== null && fld.east !== null ? `${Number(fld.west).toFixed(4)}…${Number(fld.east).toFixed(4)}°E, ${Number(fld.south).toFixed(4)}…${Number(fld.north).toFixed(4)}°N` : "no corners yet";
      card.appendChild(el("div", "gis-metric", where));
      pickInto(card, fld, "Pick the first corner", (p) => { fld.west = p.lon; fld.south = p.lat; if (fld.east === null) { fld.east = p.lon; fld.north = p.lat; } });
      pickInto(card, fld, "Pick the opposite corner", (p) => { const w = Math.min(fld.west ?? p.lon, p.lon), e = Math.max(fld.west ?? p.lon, p.lon), so = Math.min(fld.south ?? p.lat, p.lat), n = Math.max(fld.south ?? p.lat, p.lat); fld.west = w; fld.east = e; fld.south = so; fld.north = n; });
      const layers = polygonLayers();
      if (layers.length) {
        const from = select(`gis-mb-f-${fld.id}-layer`, [{ id: "", label: "— a layer's bounding box —" }, ...layers.map((l) => ({ id: String(l.id), label: l.name }))], "");
        from.addEventListener("change", () => {
          const layer = layers.find((l) => String(l.id) === from.value); if (!layer) return;
          const rings = ringsFromCollection(layer.collection || { features: layer.features || [] }); const b = boundsOfRings(rings);
          if (b && Number.isFinite(b.west) && Number.isFinite(b.north)) { fld.west = b.west; fld.east = b.east; fld.south = b.south; fld.north = b.north; fld.name = layer.name; state.outputs = null; drawSizeFields(); render(); }
        });
        card.appendChild(row("Or from", from));
      }
      num(card, "From elevation (m)", fld, "zMinM", 10, "blank = the whole depth");
      num(card, "To elevation (m)", fld, "zMaxM", 10, "blank = the whole height");
      num(card, "Size inside (m)", fld, "sizeM", 1);
      num(card, "Size outside (m)", fld, "sizeOutM", 10, "blank = the cap");
      num(card, "Blend over (m)", fld, "thicknessM", 10);
    } else if (fld.type === "ball") {
      card.appendChild(el("div", "gis-metric", fld.lat !== null ? `centre ${Number(fld.lat).toFixed(4)}°, ${Number(fld.lon).toFixed(4)}°` : "no centre yet"));
      pickInto(card, fld, "Pick the centre on the globe", (p) => { fld.lat = p.lat; fld.lon = p.lon; });
      num(card, "Centre depth below the surface (m)", fld, "depthM", 10);
      num(card, "Or centre elevation (m)", fld, "zM", 10, "blank = from the depth");
      num(card, "Radius (m)", fld, "radiusM", 10);
      num(card, "Size inside (m)", fld, "sizeM", 1);
      num(card, "Size outside (m)", fld, "sizeOutM", 10, "blank = the cap");
      num(card, "Blend over (m)", fld, "thicknessM", 10);
    } else if (fld.type === "expr") {
      const expr = el("input", "input"); expr.value = fld.expression || "";
      expr.placeholder = state.kind === "section" ? "in s (x) and z (y): e.g. 20 + 0.05*abs(y)" : "in x, y, z: e.g. 50 + 0.01*sqrt(x*x+y*y)";
      expr.addEventListener("change", () => { fld.expression = expr.value; state.outputs = null; });
      card.appendChild(row("F(x, y, z) =", expr));
    }
    card.appendChild(el("div", "gis-metric", describeField(fld, Number(state.meshSizeM) || coarseDefault)));
    list.appendChild(card);
  });
  body.appendChild(list);
  const adders = el("div", "gis-btn-row");
  [["point", "+ At a point"], ["boundary", "+ Along a boundary"], ["box", "+ In a box"], ["ball", "+ In a circle"], ["expr", "+ A formula"]].forEach(([type, label]) => {
    const btn = el("button", "button secondary", label); btn.type = "button";
    btn.title = FIELD_TYPES[type].blurb;
    btn.addEventListener("click", () => {
      const fld = defaultField(type, { coarseM: Number(state.meshSizeM) || coarseDefault });
      if (type === "point" || type === "ball") { const c = studyCentre(); if (c) { fld.lat = c.lat; fld.lon = c.lon; } }
      state.sizeFields.push(fld); state.outputs = null; drawSizeFields(); render();
    });
    adders.appendChild(btn);
  });
  body.appendChild(adders);
  if (fields.length) {
    const show = el("button", "button secondary", state.previews.fields !== undefined ? "Redraw the fields on the globe" : "Show the fields on the globe");
    show.type = "button";
    show.addEventListener("click", () => { const ok = drawSizeFields(); report("build", ok ? "Size fields drawn: rings at each point's reach, circles and boxes." : "Nothing to draw: boundary and formula fields have no outline."); render(); });
    body.appendChild(show);
  }
}

function stepBuild(body) {
  const runField = el("input", "input");
  runField.id = "gis-mb-run";
  runField.value = state.runName || `${modelName()}_run`;
  runField.addEventListener("input", () => { state.runName = runField.value; });
  body.appendChild(row("Run name", runField));

  sizeFieldControls(body);

  /**
   * GRADING: one size for a study area spends the same elements on a plateau
   * as on the headwall above it. These say how much finer the slopes get, and
   * what counts as steep.
   */
  const gradeOn = el("input", null);
  gradeOn.type = "checkbox";
  gradeOn.id = "gis-mb-grade";
  gradeOn.checked = state.grading.on !== false;
  gradeOn.addEventListener("change", () => {
    state.grading.on = gradeOn.checked;
    state.outputs = null;
    render();
  });
  if (state.kind !== "section") body.appendChild(row("Finer mesh on slopes", gradeOn));

  if (state.kind !== "section" && state.grading.on !== false) {
    const base = Number(state.meshSizeM) || defaultMeshSizeM();
    const coarse = number("gis-mb-grade-coarse", state.grading.coarseM || base, 10);
    coarse.addEventListener("input", () => {
      state.grading.coarseM = Number(coarse.value); state.outputs = null;
    });
    body.appendChild(row("Size on flat ground (m)", coarse));

    const fine = number("gis-mb-grade-fine", state.grading.fineM || Math.round(base / 4), 5);
    fine.addEventListener("input", () => {
      state.grading.fineM = Number(fine.value); state.outputs = null;
    });
    body.appendChild(row("Size on steep ground (m)", fine));

    const ref = number("gis-mb-grade-slope", state.grading.slopeRefDeg || 30, 1);
    ref.addEventListener("input", () => {
      state.grading.slopeRefDeg = Number(ref.value); state.outputs = null;
    });
    body.appendChild(row("Slope counted as steep (°)", ref));

    body.appendChild(el("p", "tool-copy",
      "The ground is graded with the volume: the script rebuilds the STL as"
      + " geometry before the field is read, so gmsh remeshes the terrain too."
      + " Measured on a ridge — 40 m elements on the flanks against 294 on the"
      + " flat, from an STL written at a uniform 60."));

    if (state.surface) {
      const preview = sizeFieldPreview();
      if (preview) body.appendChild(el("div", "gis-metric", preview));
    }
  }

  const build = el("button", "tool-button", "Build model package");
  build.type = "button";
  build.addEventListener("click", () => { void writePackage(); });
  body.appendChild(build);

  if (state.outputs) {
    const files = el("div", "gis-metric",
      `Wrote ${state.outputs.files.join(", ")}.`);
    body.appendChild(files);

    const mesh = el("button", "button secondary", "Mesh now in the sidecar");
    mesh.type = "button";
    mesh.addEventListener("click", () => { void meshInSidecar(); });
    body.appendChild(mesh);

    const dl = el("button", "button secondary", "Download the gmsh script");
    dl.type = "button";
    dl.addEventListener("click", () => {
      downloadText(`${modelName()}_gmsh.py`, state.outputs.script, "text/x-python");
    });
    body.appendChild(dl);
    if (state.outputs.airScript) {
      const dla = el("button", "button secondary", "Download the atmosphere gmsh script");
      dla.type = "button";
      dla.addEventListener("click", () => {
        downloadText(`${modelName()}_atmosphere_gmsh.py`, state.outputs.airScript, "text/x-python");
      });
      body.appendChild(dla);
    }
  }
  if (state.surface || state.profile) {
    const studio = el("button", "button secondary", "Open in the Meshing Studio");
    studio.type = "button";
    studio.title = "Hand the surface to the model page as a terrain solid: the subsurface and the atmosphere as volumes, in metres.";
    studio.addEventListener("click", () => { void openInStudio(); });
    body.appendChild(studio);
  }
}

/**
 * THE MODEL PAGE takes the same surface as a SOLID: the subsurface (and the
 * atmosphere, if asked for) as volumes the Meshing Studio's own mesher and
 * booleans work on, with the extend-boundary depth and height as its
 * parameters. One surface object, handed over rather than re-read.
 */
async function openInStudio() {
  if (state.kind === "section") { await openSectionInStudio(); return; }
  const t = surfaceLike();
  if (!t) { report("build", "Build the surface first."); return; }
  window.GeoIDModeManager?.setMode?.("model");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (window.GeoIDMeshStudio?.adoptTerrainSolid) break;
    await sleep(100);
  }
  const studio = window.GeoIDMeshStudio;
  if (!studio?.adoptTerrainSolid) { report("build", "The Meshing Studio did not come up."); return; }
  studio.adoptTerrainSolid({
    name: modelName(), surface: t, origin: t.origin,
    belowM: state.kind === "surface" ? 0 : state.domain.depthM,
    aboveM: state.kind !== "surface" && state.atmosphere.on ? state.atmosphere.heightM : 0,
    points: embeddedPoints(),
    flags: { ...state.flags },
  });
}

async function openSectionInStudio() {
  const p = state.profile;
  if (!p) { report("build", "Build the profile first."); return; }
  window.GeoIDModeManager?.setMode?.("model");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (window.GeoIDMeshStudio?.adoptSectionModel) break;
    await sleep(100);
  }
  const studio = window.GeoIDMeshStudio;
  if (!studio?.adoptSectionModel) { report("build", "The Meshing Studio did not come up."); return; }
  studio.adoptSectionModel({
    name: modelName(), profile: p, origin: p.origin,
    belowM: state.domain.depthM,
    aboveM: state.atmosphere.on ? state.atmosphere.heightM : 0,
    points: embeddedPoints(),
    flags: { ...state.flags },
  });
}

/* ── Writing the package ─────────────────────────────────────────────────── */

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The 2D cross-section's faces as an STL anybody can open, in the local frame. */
function sectionStl(profile, ring, name, hint) {
  const out = [`solid ${name}`];
  const tri = triangleWriter(out, hint);
  const pos = sectionPositions(profile, ring);
  for (let i = 0; i < pos.length; i += 9) {
    tri([pos[i], pos[i + 1], pos[i + 2]], [pos[i + 3], pos[i + 4], pos[i + 5]], [pos[i + 6], pos[i + 7], pos[i + 8]]);
  }
  out.push(`endsolid ${name}`);
  return `${out.join("\n")}\n`;
}

async function writeSectionPackage() {
  const p = state.profile;
  const name = modelName();
  const run = state.runName || `${name}_run`;
  const meshSizeM = Number(state.meshSizeM) || Math.max(10, Math.round(p.stepM * 4));
  const belowM = state.domain.depthM;
  const aboveM = state.atmosphere.on ? state.atmosphere.heightM : 0;
  const polys = sectionPolygons(p, { belowM, aboveM });
  const points = embeddedPoints();
  const resolved = resolveSizeFields("section");
  const meshOptions = effectiveMeshOptions(meshSizeM, null);
  if (resolved.skipped.length) report("build", `Size field(s) left out — nothing to place them at yet: ${resolved.skipped.join(", ")}.`);
  const script = sectionGmshScript({
    name, profile: p, belowM, aboveM, meshSizeM, flags: state.flags,
    sizeFields: resolved.fields, meshOptions,
    embedPoints: points.map((q) => ({ s: q.s, z: q.z, name: q.name, flag: q.flag, sizeM: q.sizeM })),
    meshFile: `${name}.msh`,
  });
  const normal = [-p.dir.y, p.dir.x, 0];
  const stl = [
    `solid ${name}`,
    ...(polys.rock ? sectionStl(p, polys.rock, `${name}_subsurface`, normal).split("\n").slice(1, -2) : []),
    ...(polys.air ? sectionStl(p, polys.air, `${name}_atmosphere`, normal).split("\n").slice(1, -2) : []),
    `endsolid ${name}`,
  ].join("\n") + "\n";
  const spec = femSpec({
    run, mesh: `${name}.msh`, domain: state.domain.type, dim: 2, time: {},
    materials: { solid: state.domain.materials.solid, fluid: state.domain.materials.fluid || state.domain.materials.gas },
    initial: {}, boundary: state.conditions,
    provenance: {
      kind: "2d cross-section",
      mesh: {
        options: meshOptions,
        size_fields: state.sizeFields.filter((f) => f.on !== false).map((f) => ({ type: f.type, name: f.name, says: describeField(f, meshSizeM) })),
        left_out: resolved.skipped,
      },
      study_area: state.bounds?.label, body: viewer()?.bodyName || undefined, body_radius_km: bodyRadiusKm(),
      origin: p.origin,
      crs: `2D: s = metres along the line from A, z = metres above sea level; the line lies in the local east/north frame about (lat ${p.origin.lat}, lon ${p.origin.lon}), from A (${p.a.lat}, ${p.a.lon}) to B (${p.b.lat}, ${p.b.lon})`,
      section: { a: p.a, b: p.b, samples: p.n, length_m: p.lengthM, step_m: p.stepM, elevation_m: { min: p.zMin, max: p.zMax, relief: p.reliefM }, filled: p.filledNodes },
      extend_boundary: { below_m: belowM, base_z_m: polys.baseZ, above_m: aboveM, sky_z_m: polys.skyZ },
      dem: state.demReady ? { zoom: state.demReady.zoom, post_spacing_m: state.demReady.postM } : null,
      flags: { ...state.flags },
      embedded_points: points.map((q) => ({ name: q.name, lat: q.lat, lon: q.lon, s: q.s, z: q.z, depth_below_surface_m: q.depthM })),
      built_at: new Date().toISOString(),
    },
  });
  const csv = profileCsv(p);
  state.outputs = { script, spec, sectionText: stl, csvText: csv, files: [] };
  const store = window.GeoIDResearch?.store;
  const project = store?.getActive?.();
  const summary = `${p.n}-sample profile over ${fmt(p.lengthM / 1000, 2)} km; ${polys.rock ? `rock face to ${fmt(polys.baseZ)} m` : "no rock face"}${polys.air ? `, air face to ${fmt(polys.skyZ)} m` : ""}; ${points.length} embedded point(s).`;
  if (!project) {
    downloadText(`${name}_section.csv`, csv, "text/csv");
    downloadText(`${name}_section.stl`, stl);
    downloadText(`${name}_section_gmsh.py`, script, "text/x-python");
    downloadText(`${run}_spec.json`, JSON.stringify(spec, null, 2), "application/json");
    state.outputs.files = ["downloads (no project open)"];
    report("build", `${summary} No project open — downloaded instead.`);
    render();
    return;
  }
  try {
    await store.writeProjectFile(`meshes/${name}_section.csv`, csv);
    await store.writeProjectFile(`meshes/${name}_section.stl`, stl);
    await store.writeProjectFile(`meshes/${name}_section_gmsh.py`, script);
    await store.writeProjectFile(`fem_runs/${run}/spec.json`, JSON.stringify(spec, null, 2));
    state.outputs.files = [`meshes/${name}_section.csv`, `meshes/${name}_section.stl`, `meshes/${name}_section_gmsh.py`, `fem_runs/${run}/spec.json`];
    report("build", `${summary} Written into ${project.name}.`);
  } catch (error) {
    report("build", `Could not write into the project: ${error.message}`);
  }
  render();
}

async function writePackage() {
  if (state.kind === "section") {
    if (!state.profile) { report("build", "Build the profile first."); return; }
    await writeSectionPackage();
    return;
  }
  const grid = state.surface;
  if (!grid) {
    report("build", "Build the surface first.");
    return;
  }
  const isTin = grid.kind === "tin";
  const name = modelName();
  const run = state.runName || `${name}_run`;
  const meshSizeM = Number(state.meshSizeM) || defaultMeshSizeM();
  const surfaceText = isTin ? tinSurfaceStl(grid, name) : surfaceStl(grid, name);
  const surfaceOnly = state.kind === "surface";
  const domain = isTin
    ? tinShellStl(grid, { belowM: state.domain.depthM, name })
    : domainStl(grid, { depthM: state.domain.depthM, name });
  const air = state.atmosphere.on && !surfaceOnly
    ? (isTin
      ? tinShellStl(grid, { aboveM: state.atmosphere.heightM, name: `${name}_atmosphere` })
      : atmosphereStl(grid, { heightM: state.atmosphere.heightM, name: `${name}_atmosphere` }))
    : null;
  const stats = stlStats(domain.text);
  const airStats = air ? stlStats(air.text) : null;
  const points = embeddedPoints();
  /**
   * THE SIZE FIELD, on the same lattice the terrain was sampled on -- or, for
   * a TIN, on a lattice laid over it and taken to the minimum with the
   * sampling spacing, so a buffer drawn fine stays fine in the volume.
   *
   * Written as a third file beside the STL and the script, because gmsh's
   * `Field.Structured` reads one from disk -- and because a background field
   * that lives in the package is a fact about the mesh anybody can check,
   * rather than a number buried in a script.
   */
  const grading = state.grading || {};
  const gradeOpts = {
    coarseM: Number(grading.coarseM) > 0 ? Number(grading.coarseM) : meshSizeM,
    fineM: Number(grading.fineM) > 0 ? Number(grading.fineM) : meshSizeM / 4,
    slopeRefDeg: Number(grading.slopeRefDeg) || 30,
  };
  const field = grading.on === false ? null
    : (isTin ? samplingSizeField(grid, gradeOpts) : sizeField(grid, gradeOpts));
  const fieldFile = field ? `${name}_size.dat` : null;
  const minSizeM = field ? Math.max(field.minM * 0.5, 1) : Math.max(meshSizeM / 8, 1);
  const tinLike = surfaceLike();
  const ext = extendBoundary(tinLike, {
    belowM: state.domain.depthM, aboveM: state.atmosphere.on ? state.atmosphere.heightM : 0,
  });
  const resolvedRock = resolveSizeFields("subsurface");
  const resolvedAir = resolveSizeFields("atmosphere");
  const meshOptions = effectiveMeshOptions(meshSizeM, field ? minSizeM : null);
  if (resolvedRock.skipped.length) report("build", `Size field(s) left out — nothing to place them at yet: ${resolvedRock.skipped.join(", ")}.`);
  const script = gmshScript({
    name,
    stlFile: `${name}_domain.stl`,
    meshFile: `${name}.msh`,
    meshSizeM,
    // With a field, the floor is the field's own smallest size: a MeshSizeMin
    // above it would quietly overrule the refinement it was asked for.
    minSizeM,
    embedPoints: points,
    sizeFieldFile: fieldFile,
    // A TIN's refine layers are already in its sampling field.
    refineBoxes: isTin ? [] : refineRegions(grid),
    sizeFields: resolvedRock.fields,
    meshOptions,
    flags: state.flags,
    extend: {
      which: "subsurface", zBd: domain.baseZ, h: meshSizeM,
      surfaceFile: `${name}_surface.stl`, belowM: state.domain.depthM, aboveM: 0,
    },
  });
  const airScript = air ? gmshScript({
    name: `${name}_atmosphere`,
    stlFile: `${name}_atmosphere.stl`,
    meshFile: `${name}_atmosphere.msh`,
    meshSizeM,
    minSizeM,
    embedPoints: [],
    sizeFieldFile: fieldFile,
    sizeFields: resolvedAir.fields,
    meshOptions,
    // The air's lateral faces and volume carry their own numbers, kept apart
    // from the rock's: a boundary condition on the air is not one on the rock.
    flags: {
      ...state.flags,
      top: state.flags.terrain, north: state.flags.sides_above, south: state.flags.sides_above,
      east: state.flags.sides_above, west: state.flags.sides_above, domain: state.flags.atmosphere,
    },
    extend: {
      which: "atmosphere", zBd: air.skyZ, h: meshSizeM,
      surfaceFile: `${name}_surface.stl`, belowM: 0, aboveM: state.atmosphere.heightM,
    },
  }) : null;

  const spec = femSpec({
    run,
    mesh: `${name}.msh`,
    domain: state.domain.type,
    dim: 3,
    time: {},
    materials: {
      solid: state.domain.materials.solid,
      fluid: state.domain.materials.fluid || state.domain.materials.gas,
    },
    initial: {},
    boundary: state.conditions,
    provenance: {
      study_area: state.bounds.label,
      body: viewer()?.bodyName || undefined,
      body_radius_km: bodyRadiusKm(),
      bounds_deg: state.bounds.bbox,
      origin: grid.origin,
      // The one frame every file in this package is written in, stated so a
      // reader of the STL can put it back on the map without guessing.
      crs: `local east/north metres about origin (lat ${grid.origin.lat}, lon ${grid.origin.lon}) on a sphere of radius ${bodyRadiusKm()} km:`
        + " x = (lon - lon0) * m_per_deg * cos(lat0), y = (lat - lat0) * m_per_deg, z = metres above sea level (the DEM's datum); the Meshing Studio reads the same frame",
      extent_m: { width: grid.widthM, height: grid.heightM },
      kind: surfaceOnly ? "2d surface only" : "3d block",
      mesh: {
        options: meshOptions,
        size_fields: state.sizeFields.filter((f) => f.on !== false).map((f) => ({ type: f.type, name: f.name, says: describeField(f, meshSizeM) })),
        left_out: resolvedRock.skipped,
      },
      sampling: isTin ? {
        mode: "variable",
        base_step_m: state.sampling.baseM,
        grade_m: state.sampling.gradeM,
        buffers: allBuffers().map((b) => ({
          name: b.name, shape: b.shape, lat: b.lat, lon: b.lon, size_km: b.sizeKm,
          step_m: b.stepM || null, resolution: b.stepM ? "step" : "native", from_layer: Boolean(b.fromLayer),
        })),
        native_step_m: nativeM(),
        spacing_range_m: [grid.spacingMinM, grid.spacingMaxM],
        cells: grid.leaves, refinement_levels: grid.deepest,
        coarsened_by: grid.capped ? grid.factor : 1,
      } : {
        mode: "uniform",
        resolution_m: { x: grid.stepXm, y: grid.stepYm, requested: grid.requestedStepM },
      },
      elevation_m: { min: grid.zMin, max: grid.zMax, relief: grid.reliefM },
      base_z_m: domain.baseZ,
      extend_boundary: {
        below_m: state.domain.depthM, base_z_m: domain.baseZ,
        above_m: state.atmosphere.on ? state.atmosphere.heightM : 0, sky_z_m: air ? air.skyZ : null,
        corners: ext ? ext.corners.map((c) => ({ x: c.x, y: c.y, z: c.z, lat: c.lat, lon: c.lon })) : [],
        recipe: "etna.py outer_box: rim corners carried to z; the baked skirts conform to any rim",
      },
      atmosphere: air ? { file: `${name}_atmosphere.stl`, triangles: airStats.triangles, watertight: airStats.closed } : null,
      nodes: grid.nodes,
      filled_nodes: grid.filledNodes,
      repaired_nodes: grid.repairedNodes,
      repair_worst_m: grid.repairWorstM,
      surface_triangles: stats.triangles,
      watertight: stats.closed,
      dem: state.demReady ? {
        zoom: state.demReady.zoom,
        post_spacing_m: state.demReady.postM,
        resampled_beyond_source: Boolean(state.demReady.interpolated),
      } : null,
      flags: { ...state.flags },
      mesh_grading: field ? {
        coarse_m: field.coarseM, fine_m: field.fineM,
        slope_reference_deg: field.slopeRefDeg,
        steepest_deg: field.steepestDeg,
        size_range_m: [field.minM, field.maxM],
      } : null,
      embedded_points: points.map((p) => ({
        name: p.name, layer: p.layer, lat: p.lat, lon: p.lon,
        x: p.x, y: p.y, z: p.z, ground_z: p.groundZ, depth_below_surface_m: p.depthM,
      })),
      layers: loadedLayers().map((l) => ({
        name: l.name, role: state.roles.get(String(l.id)) || "ignore",
      })).filter((l) => l.role !== "ignore"),
      built_at: new Date().toISOString(),
    },
  });

  const fieldText = field ? structuredFieldText(field) : null;
  state.outputs = {
    script, airScript, spec, surfaceText, domainText: domain.text,
    atmosphereText: air ? air.text : null, fieldText, fieldFile, files: [],
  };

  const shells = `${stats.triangles.toLocaleString()} triangles,`
    + ` ${stats.closed ? "watertight" : `${stats.openEdges} OPEN EDGES — gmsh will refuse this`}`
    + (airStats ? `; atmosphere ${airStats.triangles.toLocaleString()} triangles, ${airStats.closed ? "watertight" : `${airStats.openEdges} OPEN EDGES`}` : "")
    + `. ${points.length} embedded point(s).`;

  const store = window.GeoIDResearch?.store;
  const project = store?.getActive?.();
  if (!project) {
    downloadText(`${name}_surface.stl`, surfaceText);
    downloadText(`${name}_domain.stl`, domain.text);
    if (air) downloadText(`${name}_atmosphere.stl`, air.text);
    if (fieldText) downloadText(fieldFile, fieldText);
    downloadText(`${name}_gmsh.py`, script, "text/x-python");
    if (airScript) downloadText(`${name}_atmosphere_gmsh.py`, airScript, "text/x-python");
    downloadText(`${run}_spec.json`, JSON.stringify(spec, null, 2), "application/json");
    state.outputs.files = ["downloads (no project open)"];
    report("build", `${shells} No project open — the package was downloaded instead. Open a`
      + " project and press again to file it where the FEM pages read.");
    render();
    return;
  }

  try {
    // meshes/ is where the sidecar's gmsh job runs and where FEM Setup and the
    // GALES deck prepare already look for a .msh; the input that will make the
    // mesh belongs beside it.
    await store.writeProjectFile(`meshes/${name}_surface.stl`, surfaceText);
    if (!surfaceOnly) await store.writeProjectFile(`meshes/${name}_domain.stl`, domain.text);
    if (air) await store.writeProjectFile(`meshes/${name}_atmosphere.stl`, air.text);
    if (fieldText) await store.writeProjectFile(`meshes/${fieldFile}`, fieldText);
    await store.writeProjectFile(`meshes/${name}_gmsh.py`, script);
    if (airScript) await store.writeProjectFile(`meshes/${name}_atmosphere_gmsh.py`, airScript);
    await store.writeProjectFile(`fem_runs/${run}/spec.json`, JSON.stringify(spec, null, 2));
    state.outputs.files = [
      `meshes/${name}_surface.stl`,
      ...(surfaceOnly ? [] : [`meshes/${name}_domain.stl`]),
      ...(air ? [`meshes/${name}_atmosphere.stl`] : []),
      ...(fieldText ? [`meshes/${fieldFile}`] : []),
      `meshes/${name}_gmsh.py`,
      ...(airScript ? [`meshes/${name}_atmosphere_gmsh.py`] : []),
      `fem_runs/${run}/spec.json`,
    ];
    report("build", `${shells} Written into ${project.name}.`);
  } catch (error) {
    report("build", `Could not write into the project: ${error.message}`);
  }
  render();
}

async function meshInSidecar() {
  const sidecar = window.GeoIDResearch?.sidecar;
  const store = window.GeoIDResearch?.store;
  const project = store?.getActive?.();
  if (!sidecar?.isConnected?.()) {
    report("build", "gmsh runs in the local sidecar — connect it in Settings, or"
      + " download the script and run it yourself.");
    return;
  }
  if (!project) {
    report("build", "Open a project first — the mesh is written into its meshes/.");
    return;
  }
  try {
    report("build", "Meshing in gmsh…");
    const jobId = await sidecar.runGmsh({
      project: project.folder || project.name,
      script: state.outputs.script,
      name: modelName(),
      dim: 3,
    });
    const snap = await sidecar.awaitJob(jobId);
    report("build", snap?.exit === 0
      ? `Meshed. ${modelName()}.msh is in meshes/ — FEM Setup and the GALES deck`
        + " prepare will find it."
      : `gmsh exited ${snap?.exit}. Its log is in the Jobs drawer.`);
  } catch (error) {
    report("build", `gmsh job failed: ${error.message}`);
  }
}

/* ── Style ───────────────────────────────────────────────────────────────── */

const STYLE = [
  "#gis-model-pipeline { display: grid; gap: 0.65rem; }",
  ".gis-mb-num {",
  "  display: inline-flex; align-items: center; justify-content: center;",
  "  width: 1.15rem; height: 1.15rem; border-radius: 999px; flex: 0 0 auto;",
  "  font: 700 0.62rem 'Exo 2','Segoe UI',sans-serif;",
  "  border: 1px solid rgba(var(--nav-accent-rgb, 255,43,214), 0.55);",
  "  color: var(--skin-data, var(--skin-data));",
  "}",
  ".gis-mb-step.is-done > summary .gis-mb-num {",
  "  background: rgba(var(--skin-data-rgb), 0.22); color: var(--skin-data, var(--skin-data));",
  "}",
  ".gis-mb-step.is-blocked > summary { opacity: 0.55; }",
  ".gis-mb-blurb { margin: 0 0 0.3rem; opacity: 0.75; }",
].join("\n");

/* ── Boot ────────────────────────────────────────────────────────────────── */

function init() {
  if (!byId("gis-model-pipeline-style")) {
    const style = document.createElement("style");
    style.id = "gis-model-pipeline-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  // The tab is built by add-data.js, which may not have run yet; the panels
  // rebuild constantly, so this polls for its host the way the icon painter and
  // the Earth-data cards do rather than racing one event.
  let tries = 0;
  const tick = () => {
    tries += 1;
    if (byId("gis-mesh-body")) {
      if (!byId("gis-model-pipeline")) render();
      return;
    }
    if (tries < 200) setTimeout(tick, 250);
  };
  tick();
  window.GeoIDImportManager?.onChange?.(() => {
    if (byId("gis-model-pipeline")) render();
  });
  watchDrawnArea();
}

/**
 * DONE FILES THE SHAPE, AND THIS STEP TAKES IT FROM THERE.
 *
 * Every creator of a study area flows through `setStudyAreaPolygon`, which
 * announces `geoid-study-area-edited` — the same seam `pipeline-sync` listens
 * on — so a shape drawn on the bar, a preset placed, or a corner dragged all
 * arrive here. Without it the reader drew the area, pressed Done, and then had
 * to come back and press a second button to say what they had plainly just
 * said.
 *
 * Three guards, and each is a fault this file has already paid for:
 *
 *  - only while the picker is on "drawn". A reader who has chosen a polygon
 *    LAYER as their area has not asked for whatever is being sketched beside
 *    it, and overwriting that choice is the app deciding where they are
 *    working.
 *  - only while the builder is on screen. `render()` on a page whose tab has
 *    never been opened builds a panel nobody asked for.
 *  - DEBOUNCED, and re-entrancy guarded. A drag edit announces on every
 *    pointermove, and `render()` is what draws this builder's own previews:
 *    a render that draws is a render that announces, which is the infinite
 *    recursion that hung this page once already.
 */
let drawnWatch = null;
let adopting = false;
function watchDrawnArea() {
  if (drawnWatch || typeof window === "undefined") return;
  drawnWatch = () => {
    if (adopting) return;
    window.clearTimeout(watchDrawnArea.timer);
    watchDrawnArea.timer = window.setTimeout(adoptDrawnArea, 350);
  };
  // ON `document`, because that is where the viewer dispatches it — and as a
  // plain `Event` with no `bubbles`, so a window listener never hears it at
  // all. `pipeline-sync` and the weather card both listen there; measured on
  // the live page, a window listener counted zero for a shape that had landed.
  document.addEventListener("geoid-study-area-edited", drawnWatch);
}

function adoptDrawnArea() {
  if (adopting || !byId("gis-model-pipeline")) return;
  const picker = byId("gis-mb-area");
  if (picker && picker.value !== "drawn") return;
  const resolved = resolveBounds("drawn");
  if (resolved.error) return;
  adopting = true;
  try {
    state.bounds = resolved;
    state.surface = null;
    state.profile = null;
    state.outputs = null;
    const plan = planGrid({ bounds: resolved.bbox, stepM: 100, radiusKm: bodyRadiusKm() });
    report("area", `${resolved.label} — model domain ${fmt(plan.widthM / 1000, 2)}`
      + ` × ${fmt(plan.heightM / 1000, 2)} km, taken from the shape you drew.`
      + " The domain is the BOX over it.");
    state.open = "layers";
    render();
  } finally { adopting = false; }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.GeoIDModelPipeline = {
  getState: () => state,
  render,
  build: writePackage,
  embeddedPoints,
  surfaceLike,
  drawBuffers,
  drawSampling,
  drawPoints,
  drawFullModel,
  clearPreviews,
  openInStudio,
  /**
   * THE MODEL PAGE EDITS THE FLAGS. A face, an edge, the profile or a point
   * clicked on the studio can be given a number there, and the package
   * written here carries it: the state is one, the studio is the other door.
   */
  setFlag: (key, value) => {
    const n = Math.round(Number(value));
    if (!key || !(n > 0)) return false;
    state.flags[key] = n;
    state.outputs = null;
    render();
    return true;
  },
  /** The model page adds, changes and removes size fields; the package written here carries them. */
  getSizeFields: () => state.sizeFields,
  addSizeField: (spec) => {
    const fld = { ...defaultField(spec?.type || "point", { coarseM: Number(state.meshSizeM) || defaultMeshSizeM() }), ...(spec || {}) };
    state.sizeFields.push(fld);
    state.outputs = null;
    drawSizeFields();
    render();
    return fld.id;
  },
  updateSizeField: (id, patch) => {
    const fld = state.sizeFields.find((x) => x.id === id);
    if (!fld) return false;
    Object.assign(fld, patch || {});
    state.outputs = null;
    drawSizeFields();
    render();
    return true;
  },
  removeSizeField: (id) => {
    const n = state.sizeFields.length;
    state.sizeFields = state.sizeFields.filter((x) => x.id !== id);
    state.outputs = null;
    drawSizeFields();
    render();
    return state.sizeFields.length < n;
  },
  setMeshOptions: (patch) => { Object.assign(state.meshOptions, patch || {}); state.outputs = null; render(); return { ...state.meshOptions }; },
  setPointSize: (name, value) => {
    const v = Number(value);
    if (!name || !(v > 0)) return false;
    state.pointSizeByName.set(String(name), v);
    state.outputs = null;
    render();
    return true;
  },
  setPointFlag: (name, value) => {
    const n = Math.round(Number(value));
    if (!name || !(n > 0)) return false;
    state.pointFlagByName.set(String(name), n);
    state.outputs = null;
    render();
    return true;
  },
};
