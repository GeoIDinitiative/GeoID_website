import * as THREE from "../vendor/three.module.js";
import { currentBody, getBody, currentBodyId } from "./bodies.js?v=20260911-dc6971a";
import { PRIMITIVES, buildSurface, buildInside, boundingBoxOf } from "./mesh-primitives.js?v=20260911-dc6971a";
import {
  latticeTetMesh, tetBoundarySurface, qualityStats, elementCounts, toGmsh22,
} from "./mesh-volume.js?v=20260911-dc6971a";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260911-dc6971a";
import { downloadText } from "./extraction.js?v=20260911-dc6971a";
import { shellPositions, surfacePositions, tinHeightAt, tinToGrid, gridAsTin } from "./surface-sampling.js?v=20260911-dc6971a";
import { sectionPolygons, sectionPositions, profileHeightAt } from "./section-model.js?v=20260911-dc6971a";
import { faceParts, partPositions, studioGmshScript, DEFAULT_FACE_FLAGS } from "./studio-gmsh.js?v=20260911-dc6971a";
import { describeField, FIELD_TYPES } from "./mesh-size-fields.js?v=20260911-dc6971a";
import { femSpec } from "./model-build.js?v=20260911-dc6971a";

// Meshing Studio, ported from atlas-ai/services/mesh/meshing_studio.
//
// The Qt app's structure is kept deliberately: the same toolbar actions in the
// same order, the same Add/Model/Label/History and Mesh/Structured/Refine/Log
// decks, the same field types. What differs is the engine underneath — Gmsh's
// OCC kernel and Delaunay mesher are replaced by parametric solids with exact
// inside-tests and a lattice tet mesher, because those can run in a browser.

const byId = (id) => document.getElementById(id);

let gisTerrain = null;
let geoGroupWasVisible = null;

const state = {
  solids: [],
  fields: [],
  history: [],
  // A set, because the studio supports multi-select (Ctrl-click to add).
  selection: new Set(),
  mesh: null,
  kind: "box",
  params: {},
  /** The prebuilt scenario chosen in the Add tab, and the numbers edited on it. */
  template: "etna_chamber",
  templateParams: {},
  groups: [],
  /** The studio's own atmosphere: a box over the ground (z = baseZ) cut by the model. */
  atmosphere: { on: false, heightM: 0, baseZ: 0, entryId: null },
  /** Embedded points placed on the model page: a node exactly there. */
  points: [],
  /** The next volume flag a new primitive takes: 10, 11, 12 … (11 is the air's when there is one). */
  nextVolumeFlag: 10,
  placingPoint: false,
};

// The studio highlights the current selection in orange; the same cue is used
// here so a picked volume reads the same way.
const SELECT_COLOR = 0xff8b3d;

function entitiesOf() {
  return state.solids;
}

function findById(id) {
  return state.solids.find((s) => s.id === id) || null;
}

/** Repaints every entity so selected ones stand out and hidden ones vanish. */
function syncEntityAppearance() {
  state.solids.forEach((entry) => {
    const object = entry.object3D;
    if (!object) return;
    object.visible = entry.visible !== false;
    const selected = state.selection.has(entry.id);
    // A domain may be a GROUP of face meshes: the highlight reaches each.
    const materials = [];
    object.traverse((o) => { if (o.material) materials.push(o.material); });
    materials.forEach((material) => {
      if (selected) {
        material.emissive?.setHex(SELECT_COLOR);
        material.emissiveIntensity = 0.55;
      } else {
        material.emissive?.setHex(0x000000);
        material.emissiveIntensity = 0;
      }
      material.needsUpdate = true;
    });
  });
}

function setSelection(ids, { additive = false } = {}) {
  if (!additive) {
    state.selection.clear();
  }
  ids.forEach((id) => {
    if (additive && state.selection.has(id)) {
      state.selection.delete(id);
    } else {
      state.selection.add(id);
    }
  });
  syncEntityAppearance();
  renderModelTree();
  renderSelection();
}

function log(line) {
  const host = byId("studio-log");
  if (host) {
    const stamp = new Date().toLocaleTimeString();
    host.textContent += `${host.textContent ? "\n" : ""}[${stamp}] ${line}`;
    host.scrollTop = host.scrollHeight;
  }
}

function status(text) {
  const node = byId("studio-status");
  if (node) node.textContent = text;
}

/**
 * Report what is being worked on, and where.
 *
 * This used to draw a line inside the studio's mode bar. That bar is a CSS
 * grid, so an extra span became its own grid row and sat on top of the label —
 * which is what "NO PROJECT · MERCURY" overlapping the mode buttons was. The
 * shell header carries it instead: outside the iframe, where there is room for
 * it and nothing to collide with.
 */
function updateStudioContext() {
  announceContext(
    window.GeoIDResearch?.store?.getActive?.() || null,
    studioBody()?.name || null,
  );
}

/**
 * Tell the GeoHUB shell what is being worked on.
 *
 * The header lives outside the iframe, so it cannot read the project store or
 * the body registry — it is told, over the same postMessage bridge the mode
 * switch already uses. Sent for every mode, not just Model: "which project, and
 * which world" is a standing fact about the page, not a studio detail.
 */
function announceContext(project, world) {
  if (window.self === window.top) return;
  try {
    window.parent.postMessage({
      type: "geoid:context",
      project: project?.name || null,
      world: world || null,
    }, "*");
  } catch (error) {
    /* cross-origin parent, ignore */
  }
}

function record(op) {
  state.history.push({ op, at: Date.now() });
  renderHistory();
}

// ── Palette (Add tab) ───────────────────────────────────────────────────────

/**
 * PREBUILT SCENARIOS -- a whole model in one press, and every number of it
 * editable BEFORE it is added.
 *
 * They used to build from hard-coded params, so the only prebuilt geometry in
 * the studio was the one somebody else had sized: a volcano was always 3 km
 * tall over a 20 km crust. Each one now declares its own `params` in the same
 * shape a primitive does, and `build(p)` maps them onto the entities it
 * expands into -- so the Prebuilt scenarios card reads exactly like the Build
 * your own card beside it, and the two are told apart by what they make
 * (an assembly against one shape) rather than by which is editable.
 */
const TEMPLATES = {
  etna_chamber: {
    label: "Volcano + chamber",
    blurb: "An edifice on a crust block with a magma chamber cut out of it — the chamber keeps a volume of its own.",
    params: {
      crust_width: ["Crust width", 20],
      crust_depth: ["Crust depth", 10],
      height: ["Edifice height", 3],
      base_radius: ["Base radius", 5],
      summit_radius: ["Summit radius", 0.5],
      chamber_depth: ["Chamber depth", 3],
      chamber_radius: ["Chamber radius", 2],
      chamber_height: ["Chamber half-height", 1.2],
    },
    build: (p) => [
      { kind: "volcano_edifice", op: "union", params: {
        crust_width: p.crust_width, crust_depth: p.crust_depth,
        height: p.height, base_radius: p.base_radius, summit_radius: p.summit_radius,
      } },
      { kind: "ellipsoid", op: "difference", params: {
        x: 0, y: 0, z: -Math.abs(p.chamber_depth),
        rx: p.chamber_radius, ry: p.chamber_radius, rz: p.chamber_height,
      } },
    ],
  },
  layered_dike: {
    label: "Layered crust + dike",
    blurb: "A stack of layers, each its own volume, with a dike through them — the dike keeps a volume of its own.",
    params: {
      width: ["Block width", 12],
      depth: ["Block depth", 12],
      thicknesses: ["Layer thicknesses", "2,3,5"],
      length: ["Dike length", 6],
      height: ["Dike height", 5],
      thickness: ["Dike thickness", 0.6],
      top_depth: ["Dike top depth", 1],
      strike: ["Strike (deg)", 30],
      dip: ["Dip (deg)", 80],
    },
    build: (p) => [
      { kind: "layered_halfspace", op: "union", params: { width: p.width, depth: p.depth, thicknesses: p.thicknesses } },
      { kind: "dike", op: "difference", params: {
        x: 0, y: 0, length: p.length, height: p.height, thickness: p.thickness,
        top_depth: p.top_depth, strike: p.strike, dip: p.dip,
      } },
    ],
  },
};

/** A spec's defaults, for a template as for a primitive. */
function defaultsOf(spec) {
  const out = {};
  Object.entries(spec.params).forEach(([key, [, value]]) => { out[key] = value; });
  return out;
}

/**
 * Parameter rows into a host, from a `params` spec. One renderer for both
 * cards, so a scenario's numbers are edited exactly as a shape's are.
 */
function renderParamRows(host, spec, values, mark) {
  if (!host || !spec) return;
  host.innerHTML = "";
  Object.entries(spec.params).forEach(([key, [label, fallback]]) => {
    const row = document.createElement("div");
    row.className = "studio-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const input = document.createElement("input");
    input.className = "studio-input";
    input.dataset[mark] = key;
    input.type = typeof fallback === "string" ? "text" : "number";
    input.step = "any";
    input.value = String(values?.[key] ?? fallback);
    // KEPT ON THE STATE, or a redraw hands back the defaults: adding a
    // scenario re-renders the pane, and the numbers just typed were gone.
    input.addEventListener("input", () => { if (values) values[key] = input.value; });
    input.addEventListener("keydown", (event) => event.stopPropagation());
    row.appendChild(lab);
    row.appendChild(input);
    host.appendChild(row);
  });
}

function readParamRows(selector, attr) {
  const out = {};
  document.querySelectorAll(selector).forEach((input) => { out[input.dataset[attr]] = input.value; });
  return out;
}

/**
 * BUILD YOUR OWN: the shapes, under the heading each declares
 * (`PRIMITIVES[kind].group` -- Basic, Geological), so a reader looking for a
 * dike is not reading past six boxes and spheres to find it.
 */
function renderPalette() {
  const host = byId("studio-palette");
  if (host) {
    host.innerHTML = "";
    const groups = new Map();
    Object.entries(PRIMITIVES).forEach(([id, spec]) => {
      const key = spec.group || "Shapes";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([id, spec]);
    });
    groups.forEach((entries, groupName) => {
      const caption = document.createElement("div");
      caption.className = "studio-palette-caption";
      caption.textContent = groupName;
      host.appendChild(caption);
      const grid = document.createElement("div");
      grid.className = "studio-palette-grid";
      entries.forEach(([id, spec]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = spec.label;
        button.dataset.kind = id;
        button.classList.toggle("is-on", id === state.kind);
        button.addEventListener("click", () => {
          state.kind = id;
          state.params = {};
          renderPalette();
          renderParams();
        });
        grid.appendChild(button);
      });
      host.appendChild(grid);
    });
  }
  renderTemplates();
}

/** PREBUILT SCENARIOS: one button each, and the chosen one's numbers below. */
function renderTemplates() {
  const host = byId("studio-templates");
  if (!host) return;
  host.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "studio-palette-grid";
  Object.entries(TEMPLATES).forEach(([id, tpl]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tpl.label;
    button.title = tpl.blurb;
    button.dataset.template = id;
    button.classList.toggle("is-on", id === state.template);
    button.addEventListener("click", () => {
      state.template = id;
      state.templateParams = {};
      renderTemplates();
    });
    grid.appendChild(button);
  });
  host.appendChild(grid);
  const tpl = TEMPLATES[state.template];
  if (!tpl) return;
  const blurb = document.createElement("div");
  blurb.className = "studio-readout";
  blurb.textContent = tpl.blurb;
  host.appendChild(blurb);
  renderParamRows(byId("studio-template-params"), tpl, state.templateParams, "tparam");
}

function renderParams() {
  const spec = PRIMITIVES[state.kind];
  renderParamRows(byId("studio-params"), spec, state.params, "param");
}

function readParams() {
  return readParamRows("#studio-params [data-param]", "param");
}

// ── Scene ───────────────────────────────────────────────────────────────────

// Model space is Z-up (Z is elevation, as in the studio and in survey data);
// three.js is Y-up. Converting on display keeps "up" actually up and makes a
// z = 0 ground plane meaningful.
const MODEL_TO_SCENE = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

// One scale for the whole model, not per-object. Normalising each solid
// separately made a 1 m sphere and a 100 m box render the same size, which
// destroys the relative proportions the model is meant to show.
let studioScale = 1;
const studioMeshes = new Set();

function modelRadius() {
  const b = combinedBounds();
  if (!b) return 1;
  const r = Math.max(
    Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2,
    Math.max(Math.abs(b.maxX), Math.abs(b.minX), Math.abs(b.maxY),
      Math.abs(b.minY), Math.abs(b.maxZ), Math.abs(b.minZ)),
  );
  return r > 0 ? r : 1;
}

/** Recomputes the shared scale and re-applies it to every studio mesh. */
/**
 * The studio works at true size: one scene unit is one metre.
 *
 * Models used to be normalised to a fixed on-screen radius while the reference
 * sphere was clamped to its own unrelated radius, so the scene held two
 * different metres-per-unit at once -- a 1000 m box came out larger than the
 * Earth. Nothing is rescaled now, so model metres, ground distances, the scale
 * bar and the coordinate readout are all the same units.
 *
 * baseScale still records what the normalising factor would have been, because
 * GIS mode uses it to shrink a model onto the globe; it is recorded rather than
 * applied.
 */
function refreshStudioScale() {
  studioScale = 1;
  const normalising = MODEL_MODE_RADIUS / modelRadius();
  studioMeshes.forEach((mesh) => {
    if (!mesh.parent) {
      studioMeshes.delete(mesh);
      return;
    }
    mesh.scale.setScalar(1);
    mesh.userData.baseScale = normalising;
  });
  updateGround();
}

function displayMesh(positions, name, color, { opacity = 1, renderOrder = 0 } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.applyMatrix4(MODEL_TO_SCENE);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // A translucent volume writes no depth, or the ground inside it is culled
  // by the very shell that is meant to be seen through.
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide, flatShading: true,
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
  }));
  mesh.renderOrder = renderOrder;
  mesh.name = name;
  mesh.userData.localModel = true;
  studioMeshes.add(mesh);
  const boundingSphere = geometry.boundingSphere?.clone();
  window.GeoIDImportManager?.addDerivedLayer(name, {
    object3D: mesh, boundingSphere, georeferenced: false,
    info: { triangleCount: positions.length / 9 },
  }, "mesh");
  // Re-parent onto the surface anchor: the mesh keeps local model coordinates
  // and the anchor carries the spherical placement.
  const anchor = ensureModelAnchor();
  if (anchor) anchor.add(mesh);
  // Scale after the layer is registered so the shared factor covers it too.
  refreshStudioScale();
  if (boundingSphere) boundingSphere.radius *= studioScale;
  return mesh;
}

// ── Scene helpers: starfield, ground, view alignment ────────────────────────

/**
 * The radius of the world this model sits on.
 *
 * Read from the body registry rather than fixed at Earth's: the ground patch,
 * the horizon distance and the scale bar are all derived from it, and a Mars
 * model drawn against a 6371 km sphere has a horizon almost twice as far away
 * as it should be. Resolved on each call because the studio can be opened on
 * any world, and the page it is on is the answer.
 */
/**
 * The world the studio is modelling on, which need NOT be the world whose page
 * this is.
 *
 * Model mode has no globe in it — the body is only a radius, setting the ground
 * curvature, the horizon and the scale. So switching worlds here is a number,
 * not a navigation: the planet strip sets this and the model stays exactly
 * where it is. Navigating to another viewer instead would reload the page and
 * throw the model away to change one float.
 *
 * Null means "whatever page this is", which is the right answer on arrival.
 */
let studioBodyId = null;

function studioBody() {
  return (studioBodyId ? getBody(studioBodyId) : null) || currentBody();
}

function bodyRadiusM() {
  return studioBody()?.radiusM ?? 6371000;
}

/**
 * Move the model onto another world, in place.
 *
 * Everything sized from the radius has to be re-derived together: the ground
 * sphere is rebuilt at the new curvature, the pull-back limit is re-applied
 * (it is `groundRadius * 4`, so Jupiter needs forty times the Moon's), and the
 * camera is re-floored — otherwise switching to a larger body leaves the camera
 * *inside* the new sphere.
 */
export function setStudioBody(id) {
  const body = getBody(id);
  if (!body) return null;
  const previousRadius = groundRadius;
  studioBodyId = body.id;
  groundRadius = computeGroundRadius();

  /**
   * Carry the camera and the orbit target with the surface.
   *
   * The model is anchored ON the ground, at `y = groundRadius`, so changing the
   * radius moves the ground out from under whatever is looking at it. Left
   * behind, a larger body simply swallows the camera: the target ends up inside
   * the new sphere, the dolly floor fires, and zoom dies. Measured going from
   * Earth to Jupiter — `minDistance` jumped from 0.002 m to 63,596 km, which is
   * "cannot zoom in at all".
   *
   * Shifting both by the same delta keeps the model exactly where it was on
   * screen, so switching worlds changes the curvature, the horizon and the
   * scale, and nothing else.
   */
  const shift = groundRadius - previousRadius;
  const viewer = window.GeoIDViewer;
  if (shift && viewer?.camera && viewer?.controls) {
    viewer.camera.position.y += shift;
    viewer.controls.target.y += shift;
  }

  // Force the patch to be rebuilt: its size is judged against the horizon, and
  // the horizon just moved.
  patchRadius = 0;
  updateGround();
  applyOrbitDistanceLimits();
  keepCameraAboveGround();
  updateScaleReadout();
  updateStudioContext();
  viewer?.controls?.update?.();
  return body;
}

export function getStudioBody() {
  return studioBody();
}
let groundMesh = null;

// Mesh space is a local tangent frame on WGS84: model X/Y/Z are east/north/up
// metres about this origin, which is what the lat/lon/elevation readout
// reports against.
const studioOrigin = { lat: 0, lon: 0, elevation: 0 };

function starfield() {
  // The viewer adds its starfield straight to the scene as the only Points
  // object at that level.
  return window.GeoIDViewer?.scene?.children?.find((c) => c.isPoints) || null;
}

function setStarsVisible(on) {
  const stars = starfield();
  if (stars) stars.visible = on;
}

/**
 * Coordinate model
 * ----------------
 * Scene origin is the centre of the Earth. The ground sphere sits there and is
 * reference framing only. The model does not live at the origin: it is anchored
 * to a point on the *surface* at (lat0, lon0), inside a group oriented to the
 * local east/north/up frame. Model x/y/z therefore stay local metres relative
 * to the ground -- which is what import and export continue to read and write
 * -- while their place in the world is a spherical transform held by the
 * anchor.
 *
 * Sphere size is truthful where it can be. At true scale the radius is 6371 km
 * expressed in scene units, which for a metre-scale model is millions of units
 * and past what a float32 depth buffer resolves. It is therefore clamped: large
 * models get real curvature, small ones a representational globe, and
 * getGroundInfo() reports which applies.
 */
// Opening pitch above the local horizontal -- low enough that the horizon
// stays in shot, high enough to read the model in three dimensions.
const HORIZON_PITCH_RAD = 16 * Math.PI / 180;
// Closest the camera may come to straight-down. Keeps the plan view readable
// without ever reaching the vertical, where lookAt degenerates.
const MIN_POLAR_RAD = 8 * Math.PI / 180;
// Ground shown when the studio is empty, in metres.
const DEFAULT_WORK_RADIUS_M = 250;
// Closest the camera may come to what it is looking at. Small enough to inspect
// millimetre detail on a model.
const MIN_DOLLY_DISTANCE_M = 0.002;


let groundRadius = bodyRadiusM();
let patchRadius = 0;
let modelAnchor = null;
/**
 * Real terrain under the model, when a study area has been sent over.
 *
 * Null means the analytic sphere cap — right for a model that is about its own
 * geometry. A sampler means the ground is the actual landscape at the origin,
 * which is what makes a model of a slope, a dam or a caldera sit ON the thing
 * it is modelling. Heights are metres above the ellipsoid, relative to the
 * origin's own height so the anchor stays at y=0.
 */
let groundElevation = null;

function computeGroundRadius() {
  // To scale with the model, always: the sphere is the Earth at the size the
  // model actually is, not a representative ball at a convenient radius.
  return bodyRadiusM() * studioScale;
}

export function getGroundInfo() {
  const trueRadius = bodyRadiusM() * studioScale;
  return {
    radius: groundRadius,
    trueRadius,
    toScale: true,
    metresPerUnit: 1 / (studioScale || 1),
  };
}

/** Earth-frame direction: X to (0,0), Y to (0,90E), Z to the north pole. */
function geodeticDirection(latDeg, lonDeg) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  return new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  );
}

/**
 * Positions and orients the anchor so its local axes are the surface frame at
 * the origin: +X east, +Y up (radial), +Z south -- matching the Z-up to Y-up
 * convention the display meshes already use.
 */
/**
 * Places the model's local frame on top of the reference sphere, on the world
 * +Y axis, with +X east / +Y up / +Z south.
 *
 * The anchor is deliberately NOT put at the sphere's true geodetic direction
 * for the origin's lat/lon. OrbitControls bakes its orbit axis from the
 * camera's up vector once, when it is constructed, and the viewer built it with
 * the world +Y default -- assigning camera.up afterwards does nothing. So if the
 * anchor sat anywhere else, a horizontal drag would rotate about world +Y while
 * the local up pointed elsewhere, and the horizon would swing wildly on what
 * should be a pure azimuth turn.
 *
 * Nothing is lost by pinning it here: the sphere is scenery, its orientation is
 * arbitrary, and lat/lon comes from the local frame and the studio origin
 * rather than from where the anchor sits on the sphere.
 */
function updateModelAnchor() {
  if (!modelAnchor) return;
  const { elevation } = studioOrigin;
  modelAnchor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0),   // east
    new THREE.Vector3(0, 1, 0),   // up
    new THREE.Vector3(0, 0, 1),   // south
  ));
  // The origin's elevation lifts the anchor off the reference sphere, in the
  // same scene units the model itself is drawn in.
  modelAnchor.position.set(
    0,
    groundRadius + (elevation || 0) * (studioScale || 1),
    0,
  );
  modelAnchor.updateMatrixWorld(true);
}

function ensureModelAnchor() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.scene) return null;
  if (!modelAnchor) {
    modelAnchor = new THREE.Group();
    modelAnchor.name = "studio-model-anchor";
    viewer.scene.add(modelAnchor);
  }
  updateModelAnchor();
  return modelAnchor;
}

/** A colour from the live theme, or the fallback where the theme has none. */
function themeColour(token, fallback) {
  try {
    const hex = window.GeoIDTheme?.hex?.(token);
    if (hex) return new THREE.Color(hex);
  } catch (e) { /* no theme seam on this page */ }
  return new THREE.Color(fallback);
}

function groundGridMaterial() {
  return new THREE.ShaderMaterial({
    // Opaque and depth-writing, front faces only, so the far side of the globe
    // is occluded and no lines show through the planet or past the horizon.
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    // A model resting on the ground shares a plane with it, and coplanar faces
    // tear into each other as the camera closes in. Pushing the ground back a
    // fraction of a depth unit lets whatever sits on it win cleanly.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    uniforms: {
      uStepM: { value: 100 },
      uStepCoarse: { value: 500 },
      uBlend: { value: 1 },
      uMajorEvery: { value: 5 },
      /**
       * QUIET RULING, not neon. The first grid was the skin's own chrome and
       * data colours at full strength with a bloom under every line, drawn
       * at 1.2 pixels -- reported as harsh, and it was: a reference surface
       * should sit UNDER the model, not compete with it. Minor lines are a
       * desaturated slate at a third of their old weight, major lines the
       * accent muted, the bloom all but gone, and the ruling fades with
       * distance so the far field is a tone rather than a stripe. Colours
       * come from the theme where it has them, so a skin restyles the floor.
       */
      // MINIMAL: one family of hairlines in a dim slate, no bloom, no colour
      // split between minor and major -- a major line is merely a little
      // brighter. The two-colour theme ruling was reported as no better than
      // the neon it replaced; a reference grid is furniture, not a subject.
      // SUBTLE DARK GREY, DENSE, SEE-THROUGH. Asked for by name after the
      // ruled ground was removed: a lattice of hairlines in a dark grey,
      // majors a shade lighter, no fill (the plane is lines only, so what is
      // under it shows), no bloom, fading with distance.
      // Light grey, by request, over the dark grey that was asked for first.
      uMinor: { value: new THREE.Color(0x8e959f) },
      uMajor: { value: new THREE.Color(0xc4c9d1) },
      uBase: { value: new THREE.Color(0x000000) },
      uFadeM: { value: 40000 },
      // 1 when the model reaches below the ground: the fill between the lines
      // is DISCARDED, so the floor is a ruled grid you can see through while
      // its lines still write depth and pass the depth test like anything
      // else. A ground that merely stopped writing depth drew its lines over
      // whatever was in front of it, which is what "the gridlines fail the
      // depth test" looked like.
      uOpen: { value: 0 },
      // The model's plan footprint (east min, north min, east max, north max,
      // in metres of the origin): the ground has a HOLE there while the model
      // reaches below it. A reference plane at z = 0 otherwise cuts straight
      // through a subsurface, and its lines, depth-tested honestly, show inside
      // the block wherever the wall below the plane is what is in front.
      uHole: { value: new THREE.Vector4(0, 0, 0, 0) },
    },
    vertexShader: `
      varying vec3 vLocal;
      varying float vDist;
      void main() {
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uStepM;
      uniform float uStepCoarse;
      uniform float uBlend;
      uniform float uMajorEvery;
      uniform vec3 uMinor;
      uniform vec3 uMajor;
      uniform vec3 uBase;
      uniform float uOpen;
      uniform vec4 uHole;
      uniform float uFadeM;
      varying vec3 vLocal;
      varying float vDist;

      // One grid level: line coverage, glow, and which family is nearer.
      void gridLevel(float e, float n, float step, float wE, float wN,
                     out float line, out float bloom,
                     out float parallels, out float meridians) {
        float dLat = abs(fract(e / step - 0.5) - 0.5) * step;
        float dLon = abs(fract(n / step - 0.5) - 0.5) * step;
        parallels = 1.0 - smoothstep(0.0, wE, dLat);
        meridians = 1.0 - smoothstep(0.0, wN, dLon);
        // Retire lines as cells approach pixel size rather than let them alias
        // into noise near the limb.
        float density = clamp(step / (max(wE, wN) * 10.0), 0.0, 1.0);
        line = max(parallels, meridians) * density;
        bloom = 0.0;
      }

      void main() {
        // The patch is already in metres east/up/north of the model's origin,
        // so the grid reads straight off the position. The model is authored in
        // metres, so the ground it stands on is ruled in metres too -- a degree
        // grid would bear no relation to it.
        float lat = vLocal.x;
        float lon = -vLocal.z;

        // Under a pixel wide: the smoothstep over fwidth is the anti-aliasing,
        // and 0.7 of it reads as a hairline rather than a stroke.
        float wLat = fwidth(lat) * 0.7 + 1e-6;
        float wLon = fwidth(lon) * 0.7 + 1e-6;

        // Two grid levels are drawn at once and crossfaded, so zooming brings
        // the finer one up gradually instead of swapping the whole graticule
        // between frames.
        float lineFine = 0.0, bloomFine = 0.0, parFine = 0.0, merFine = 0.0;
        gridLevel(lat, lon, uStepM, wLat, wLon, lineFine, bloomFine, parFine, merFine);
        float lineCoarse = 0.0, bloomCoarse = 0.0, parCoarse = 0.0, merCoarse = 0.0;
        gridLevel(lat, lon, uStepCoarse, wLat, wLon, lineCoarse, bloomCoarse, parCoarse, merCoarse);

        // The coarse level stays fully lit: its lines are a subset of the fine
        // one, so fading it too would dim the shared lines as the blend moves.
        float line = max(lineCoarse, lineFine * uBlend);
        float bloom = max(bloomCoarse, bloomFine * uBlend);

        float step_ = uBlend > 0.5 ? uStepM : uStepCoarse;
        float par = uBlend > 0.5 ? parFine : parCoarse;
        float mer = uBlend > 0.5 ? merFine : merCoarse;
        bool major = (par >= mer)
          ? abs(mod(floor(lat / step_ + 0.5), uMajorEvery)) < 0.5
          : abs(mod(floor(lon / step_ + 0.5), uMajorEvery)) < 0.5;
        vec3 colour = major ? uMajor : uMinor;

        // The far field is a tone, not a stripe: the ruling fades over uFadeM
        // of view distance while the base colour stays, so the horizon reads
        // as ground rather than as a moiré of lines.
        float fade = exp(-vDist / max(uFadeM, 1.0));
        if (uOpen > 0.5) {
          // SEE-THROUGH: only each line's core survives, painted in its own
          // colour. Keeping the anti-aliased edge and the bloom drew them as
          // near-black opaque pixels (base + almost no colour) wherever the
          // plane passed in front of the rock -- dark bands across the walls.
          if (line < 0.5 || fade < 0.04) discard;
          if (lat > uHole.x && lat < uHole.z && lon > uHole.y && lon < uHole.w) discard;
          gl_FragColor = vec4(uBase + colour * fade, 1.0);
          return;
        }
        gl_FragColor = vec4(uBase + colour * (line + bloom) * fade, 1.0);
      }
    `,
  });
}

/**
 * The ground, built as a patch of the Earth's surface in metres relative to the
 * model's origin rather than as a whole sphere about the scene origin.
 *
 * A 6371 km sphere cannot be drawn usefully at model scale. Its vertices sit at
 * six-million-metre magnitudes, where a 32-bit float resolves about half a
 * metre, and even 256 segments leaves triangles 150 km across -- far coarser
 * than a horizon a few hundred metres up. Both problems disappear when the
 * surface is expressed as an offset from the origin: coordinates are small, so
 * precision is full, and the tessellation can be concentrated where the camera
 * actually is.
 *
 * Vertices lie exactly on the sphere, so the curvature and the horizon are
 * real, not approximated. Rings are spaced quadratically to keep detail near
 * the model, where the user works.
 */
function buildGroundPatch(patchRadius, rings = 128, segments = 192) {
  const R = groundRadius;
  const limit = Math.min(patchRadius, R * 0.999);
  const positions = new Float32Array((rings + 1) * (segments + 1) * 3);
  let p = 0;
  for (let i = 0; i <= rings; i += 1) {
    const t = i / rings;
    const r = limit * t * t;
    // Height of the sphere's surface at horizontal distance r, measured down
    // from the tangent point. Written as a chord so it stays accurate when r
    // is small compared with R.
    const drop = (r * r) / (Math.sqrt(Math.max(R * R - r * r, 0)) + R);
    for (let j = 0; j <= segments; j += 1) {
      const a = (j / segments) * Math.PI * 2;
      const east = r * Math.cos(a);
      const north = r * Math.sin(a);
      positions[p] = east;
      // The relief rides on top of the curvature rather than replacing it:
      // the sphere is still the sphere, the DEM is the surface on it.
      positions[p + 1] = -drop + (groundElevation ? groundElevation(east, north) : 0);
      positions[p + 2] = north;
      p += 3;
    }
  }
  const indices = [];
  const rowLen = segments + 1;
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * rowLen + j;
      const b = a + rowLen;
      // Wound so the surface faces up: the reverse order points the normals
      // into the planet and the patch vanishes to back-face culling.
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Regrows the ground when the viewpoint has moved far enough to need it. */
function updateGroundReach() {
  if (!groundMesh?.visible) return;
  const wanted = desiredPatchRadius();
  if (patchRadius > 0 && wanted < patchRadius * 1.6 && wanted > patchRadius / 1.6) return;
  updateGround();
}

/** How far the ground should reach: past the horizon, and past the model. */
function desiredPatchRadius() {
  const camera = window.GeoIDViewer?.camera;
  const focus = modelFocus();
  const modelReach = (focus ? focus.radius : DEFAULT_WORK_RADIUS_M) * 8;
  if (!camera) return modelReach;
  const altitude = Math.max(camera.position.length() - groundRadius, 0.01);
  const horizon = Math.sqrt(2 * groundRadius * altitude + altitude * altitude);
  return Math.max(horizon * 1.4, modelReach);
}

function updateGround() {
  ensureModelAnchor();
  if (!groundMesh) return;
  groundRadius = computeGroundRadius();
  // Rebuilt only when the view has changed enough to matter, so panning and
  // small zooms do not regenerate the geometry.
  const wanted = desiredPatchRadius();
  if (!(patchRadius > 0) || wanted > patchRadius * 1.6 || wanted < patchRadius / 1.6) {
    patchRadius = wanted;
    groundMesh.geometry?.dispose();
    groundMesh.geometry = buildGroundPatch(patchRadius);
  }
  // The patch is expressed relative to the model's origin, so it is positioned
  // there rather than at the centre of the Earth.
  groundMesh.position.set(0, groundRadius, 0);
  groundMesh.rotation.set(0, 0, 0);
  groundMesh.updateMatrixWorld(true);
  applyOrbitDistanceLimits();
  refreshGraticuleStep();
}

// Grid spacing in metres, coarse to fine: 1-2-5 per decade, from a kilometre
// down to a millimetre and up to continental distances.
const GRID_STEPS_M = (() => {
  const steps = [];
  for (let e = 7; e >= -3; e -= 1) {
    [5, 2, 1].forEach((m) => steps.push(m * (10 ** e)));
  }
  return steps;
})();

function refreshGraticuleStep() {
  const viewer = window.GeoIDViewer;
  const uniforms = groundMesh?.material?.uniforms;
  const camera = viewer?.camera;
  if (!uniforms || !camera) return;
  // The grid is metric, so its spacing follows how many metres are actually in
  // shot rather than an angle on the sphere.
  const target = viewer.controls?.target;
  const distance = target ? camera.position.distanceTo(target) : camera.position.length();
  const fovRad = (camera.fov || 45) * Math.PI / 180;
  const visibleMetres = Math.max(2 * Math.tan(fovRad / 2) * distance, 1e-4);
  // Aim for roughly ten divisions across the view.
  // DENSE: about twenty cells across the view rather than ten.
  const ideal = visibleMetres / 20;

  // Snapping from one standard step to the next doubles or quintuples the grid
  // density in a single frame, which is what made the horizon jump on zoom.
  // Instead the two steps either side of the ideal are drawn together and
  // crossfaded, so the finer grid fades in as the view closes rather than
  // appearing all at once.
  let i = GRID_STEPS_M.findIndex((step) => step <= ideal);
  if (i < 0) i = GRID_STEPS_M.length - 1;
  const coarse = GRID_STEPS_M[Math.max(0, i - 1)];
  const fine = GRID_STEPS_M[i];
  // Position between the pair on a log scale, so the fade tracks how the grid
  // actually grows rather than the raw difference between the two steps.
  const blend = coarse > fine
    ? Math.min(1, Math.max(0, Math.log(coarse / ideal) / Math.log(coarse / fine)))
    : 1;
  uniforms.uStepM.value = fine;
  uniforms.uStepCoarse.value = coarse;
  uniforms.uBlend.value = blend;
  if (uniforms.uFadeM) uniforms.uFadeM.value = Math.max(coarse * 12, 2000);
}

function setGroundVisible(requested) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.scene) return;
  const on = Boolean(requested);
  if (on && !groundMesh) {
    groundRadius = computeGroundRadius();
    patchRadius = desiredPatchRadius();
    groundMesh = new THREE.Mesh(buildGroundPatch(patchRadius), groundGridMaterial());
    groundMesh.frustumCulled = false;
    groundMesh.name = "studio-ground";
    viewer.scene.add(groundMesh);
    updateGround();
  }
  if (groundMesh) groundMesh.visible = on;
  applyBelowGround();
}

/**
 * Scene point to WGS84. The sphere is centred on the origin and is the Earth
 * frame, so this is a straight cartesian-to-spherical conversion. Elevation is
 * reported in model metres, using the model's own scale rather than the
 * sphere's, because that is the quantity the mesh is authored in.
 */
/**
 * Scene position to WGS84.
 *
 * The studio is a local tangent space: the model keeps its own flat metres,
 * unprojected, and the sphere is scenery drawn at whatever radius frames it.
 * That radius is nothing like the Earth's, so reading lat/lon off the sphere's
 * own geometry is meaningless -- a point 1 km east of the origin came out 5,000
 * km away. The point is instead taken into the anchor's local frame, converted
 * from scene units back to model metres, and carried out from the origin along
 * the real Earth. That is what registers a flat local model to global
 * coordinates.
 *
 * The drawn grid is deliberately left alone: it is framing, not a survey
 * graticule, so it stays at sphere scale where it reads cleanly.
 */
function sceneToWgs84(point) {
  if (!modelAnchor) {
    return { lat: studioOrigin.lat, lon: studioOrigin.lon, elevation: studioOrigin.elevation };
  }
  modelAnchor.updateMatrixWorld(true);
  const local = modelAnchor.worldToLocal(point.clone());
  const s = studioScale || 1;
  // Anchor frame is +X east, +Y up, +Z south.
  return enuToWgs84(local.x / s, -local.z / s, local.y / s);
}

/** Local east/north/up metres at the studio origin to WGS84. */
/**
 * ONE CRS FOR BOTH PAGES. The Model Builder's frame is local east/north
 * metres about the study centre, equirectangular scaled at the origin's
 * latitude on this body's radius -- the frame every STL, size field and
 * embedded point in the package is written in. The studio's own conversion
 * is azimuthal-equidistant about the same origin, which agrees to the metre
 * at the centre and drifts by ~9 m at 9 km (measured). Two definitions of
 * one metre is a CRS mismatch, however small, so once a GIS terrain is
 * adopted the studio reads and writes through the TERRAIN'S frame and the
 * two pages cannot disagree about where a point is.
 */
function enuToWgs84(eastM, northM, upM) {
  if (terrainFrame()) {
    const ll = terrainFrame().fromLocal(eastM, northM);
    return { lat: ll.lat, lon: (((ll.lon + 540) % 360) - 180), elevation: studioOrigin.elevation + upM };
  }
  const toRad = Math.PI / 180;
  const R = bodyRadiusM() + studioOrigin.elevation;
  const distance = Math.hypot(eastM, northM);
  const elevation = studioOrigin.elevation + upM;
  if (distance < 1e-9) {
    return { lat: studioOrigin.lat, lon: studioOrigin.lon, elevation };
  }
  // Direct geodesic on a sphere: exact rather than a flat approximation, so it
  // holds for large models and across the poles and the antimeridian.
  const bearing = Math.atan2(eastM, northM);
  const delta = distance / R;
  const lat1 = studioOrigin.lat * toRad;
  const lon1 = studioOrigin.lon * toRad;
  const sinLat = Math.sin(lat1) * Math.cos(delta)
    + Math.cos(lat1) * Math.sin(delta) * Math.cos(bearing);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat)));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(delta) * Math.cos(lat1),
    Math.cos(delta) - Math.sin(lat1) * sinLat,
  );
  return { lat: lat2 / toRad, lon: (((lon2 / toRad) + 540) % 360) - 180, elevation };
}

/** WGS84 to local east/north/up metres at the studio origin. */
function wgs84ToEnu(lat, lon, elevation = 0) {
  if (terrainFrame()) {
    const l = terrainFrame().toLocal(lat, lon);
    return { east: l.x, north: l.y, up: elevation - studioOrigin.elevation };
  }
  const toRad = Math.PI / 180;
  const R = bodyRadiusM() + studioOrigin.elevation;
  const lat1 = studioOrigin.lat * toRad;
  const lat2 = lat * toRad;
  const dLon = (lon - studioOrigin.lon) * toRad;
  const cosDelta = Math.sin(lat1) * Math.sin(lat2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const distance = Math.acos(Math.max(-1, Math.min(1, cosDelta))) * R;
  const bearing = Math.atan2(
    Math.sin(dLon) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon),
  );
  return {
    east: distance * Math.sin(bearing),
    north: distance * Math.cos(bearing),
    up: elevation - studioOrigin.elevation,
  };
}

/** WGS84 to a scene position, the inverse of sceneToWgs84. */
function wgs84ToScene(lat, lon, elevation = 0) {
  const { east, north, up } = wgs84ToEnu(lat, lon, elevation);
  const s = studioScale || 1;
  const local = new THREE.Vector3(east * s, up * s, -north * s);
  if (!modelAnchor) return local;
  modelAnchor.updateMatrixWorld(true);
  return modelAnchor.localToWorld(local);
}

/**
 * Cursor position, drawn by the viewer's own readout rather than a studio one,
 * so the Model page reports position exactly as the GIS page does. Only the
 * numbers come from here -- the studio's local frame instead of the globe.
 */
function updateCoordinateReadout(point, elevationOverride) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.renderCursorReadout) return;
  if (!point) {
    viewer.hideCursorReadout();
    return;
  }
  const geo = sceneToWgs84(point);
  // The viewer's readout prints degrees EAST, 0..360, as the globe does.
  const lonEast = ((geo.lon % 360) + 360) % 360;
  viewer.renderCursorReadout(geo.lat, lonEast,
    Number.isFinite(elevationOverride) ? elevationOverride : geo.elevation);
}

/**
 * Scale bar, again drawn by the viewer's own code. Its globe estimator cannot
 * be used here: it measures against a planet, and the studio's sphere is
 * scenery at an arbitrary radius. Metres per pixel is taken from the model's
 * own scale at the orbit target, which is where the user is working.
 */
function updateScaleReadout() {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  if (!viewer?.renderScaleBar || !camera) return;
  const target = viewer.controls?.target;
  const distance = target ? camera.position.distanceTo(target) : camera.position.length();
  const height = viewer.renderer?.domElement?.clientHeight || 0;
  if (!height || !Number.isFinite(distance) || distance <= 0) {
    viewer.hideScaleBar();
    return;
  }
  // Scene units spanned by one pixel at the target's distance, converted into
  // model metres through the studio's shared scale.
  const fovRad = (camera.fov || 45) * Math.PI / 180;
  const unitsPerPixel = (2 * Math.tan(fovRad / 2) * distance) / height;
  viewer.renderScaleBar(unitsPerPixel / (studioScale || 1));
}

// The viewer's orbit limits are tuned for a 3.2-unit globe, which caps the
// camera well inside the studio's ground sphere -- you could never pull back
// far enough to see it. Model mode widens them and restores them on exit.
let orbitLimits = null;

function setStudioOrbitLimits(on) {
  const controls = window.GeoIDViewer?.controls;
  if (!controls) return;
  if (on) {
    if (!orbitLimits) {
      orbitLimits = {
        min: controls.minDistance,
        max: controls.maxDistance,
        minPolar: controls.minPolarAngle,
        maxPolar: controls.maxPolarAngle,
        zoom: controls.enableZoom,
      };
    }
    applyOrbitDistanceLimits();
    // The orbit target sits on (or just above) the ground and "up" is radial,
    // so a polar angle of 90 degrees puts the camera level with it. Stopping
    // just short keeps the camera in the sky rather than under the surface.
    // Polar angle is measured from the camera's up, which is radial here: 0 is
    // directly overhead, 90 degrees is level with the target. The floor keeps a
    // true bird's-eye (and its singular lookAt) out of reach; the ceiling keeps
    // the camera above the surface.
    controls.minPolarAngle = MIN_POLAR_RAD;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    // The viewer turns OrbitControls' zoom off and drives the wheel itself in
    // globe units. Model mode wants the standard dolly towards the target.
    controls.enableZoom = true;
    patchControlsUpdate(true);
    keepCameraAboveGround();
  } else if (orbitLimits) {
    controls.minDistance = orbitLimits.min;
    controls.maxDistance = orbitLimits.max;
    controls.minPolarAngle = orbitLimits.minPolar;
    controls.maxPolarAngle = orbitLimits.maxPolar;
    controls.enableZoom = orbitLimits.zoom;
    patchControlsUpdate(false);
    orbitLimits = null;
  }
  controls.update();
}

/**
 * Pull-back range, sized from the ground sphere so it is always possible to
 * retreat far enough for the grid to close into a globe. The ground radius is
 * not known when Model mode is first entered -- the sphere has not been built
 * yet -- so this is re-applied whenever it is resized rather than set once,
 * which previously left the limit stuck at the placeholder value.
 */
function applyOrbitDistanceLimits() {
  const controls = window.GeoIDViewer?.controls;
  if (!controls || !orbitLimits) return;
  controls.maxDistance = groundRadius * 4;
  applyBelowGround();
  applyDollyFloor();
}

/**
 * Hard floor on the camera. The polar limit handles orbiting, but panning and
 * dollying can still drive the camera into the planet, so its distance from the
 * Earth's centre is clamped to sit just above the reference sphere.
 *
 * This runs after OrbitControls has finished solving rather than on its change
 * event: the solve rewrites the camera position from its own spherical state,
 * so a correction applied beforehand is simply undone. Clamping last means the
 * position that gets rendered is always above ground, and the next solve reads
 * back the corrected position.
 */
/**
 * THE FLOOR IS THE MODEL'S BASE, NOT THE GROUND. The camera used to be held
 * above the ground sphere and the orbit capped at the horizon, so nothing
 * under z = 0 could be looked at -- and a subsurface is all under z = 0. When
 * the model reaches below the ground the floor drops to its base, the orbit
 * may swing under the horizon, and the ground's fill between its lines is
 * discarded so the rock beneath shows through a grid whose lines still
 * depth-test honestly. A model that sits on the ground keeps every old limit.
 */
function modelBelowGroundM() {
  const b = combinedBounds();
  return b && Number.isFinite(b.minZ) ? Math.min(0, b.minZ * studioScale) : 0;
}

function cameraFloorRadius() {
  const below = modelBelowGroundM();
  if (below >= 0) return groundRadius + minCameraAltitude();
  // ROOM TO STAND UNDER THE MODEL. A floor AT the base lets the camera reach
  // the underside's plane and no further, so the underside could never be
  // looked at -- reported as "we cannot navigate the camera to the
  // underside". The floor drops below the base by the model's own diagonal.
  const b = combinedBounds();
  const span = b ? Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * studioScale : 0;
  return groundRadius + below - Math.max(span, 1000);
}

function applyBelowGround() {
  const controls = window.GeoIDViewer?.controls;
  const below = modelBelowGroundM() < 0 || !groundMesh?.visible;
  if (controls && orbitLimits) {
    controls.maxPolarAngle = below ? Math.PI - MIN_POLAR_RAD : Math.PI / 2 - 0.02;
  }
  if (groundMesh?.material?.uniforms?.uOpen) {
    // Lines only, always: a lattice has no fill. The hole under a buried
    // model is still only cut when there is a model below.
    groundMesh.material.uniforms.uOpen.value = 1;
    const b = below ? combinedBounds() : null;
    groundMesh.material.uniforms.uHole.value.set(
      b ? b.minX * studioScale : 0, b ? b.minY * studioScale : 0,
      b ? b.maxX * studioScale : 0, b ? b.maxY * studioScale : 0,
    );
  }
}

function keepCameraAboveGround() {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  if (!camera) return;
  // No ground, no floor: with the ruled surface gone there is nothing to
  // keep the camera out of, and a model is looked at from wherever it reads.
  if (!groundMesh?.visible) return;
  const floor = cameraFloorRadius();
  if (camera.position.length() >= floor) return;

  // Last resort only. Descent is normally stopped before it happens by the
  // dolly limit below, which is why this can afford to be a blunt radial nudge:
  // it now only catches panning, where the target itself moves underground.
  camera.position.setLength(floor);
  camera.updateMatrixWorld(true);
}

/**
 * Keeps the camera from dollying into the ground by raising the controls' own
 * minimum distance, instead of correcting the position afterwards.
 *
 * Correcting afterwards is what made the horizon lurch: at a shallow viewing
 * angle the camera has to travel a long way along its view ray to regain any
 * altitude, so a small scroll near the ground threw it far backwards. Limiting
 * the distance up front means the zoom simply stops, with the camera where the
 * user left it.
 */
function applyDollyFloor() {
  const viewer = window.GeoIDViewer;
  const controls = viewer?.controls;
  if (!controls || !orbitLimits) return;
  const target = controls.target;
  if (target.lengthSq() < 1e-12) return;
  if (!groundMesh?.visible) { controls.minDistance = MIN_DOLLY_DISTANCE_M; return; }
  const floor = cameraFloorRadius();

  // Zooming in walks the camera towards the target, so the lowest it can ever
  // get is the target's own altitude. If the target is already clear of the
  // ground -- which it is whenever it is on a model rather than on the surface
  // -- no dolly limit is needed at all, and the view can close to millimetres.
  // The previous rule derived a stand-off from the viewing angle, which held
  // the camera tens of metres out even when it was heading somewhere safe.
  if (target.length() >= floor) {
    controls.minDistance = MIN_DOLLY_DISTANCE_M;
    return;
  }

  // The target is at or below the floor, so solve for the distance along the
  // view ray at which the camera would reach it.
  const dir = viewer.camera.position.clone().sub(target);
  if (dir.lengthSq() < 1e-12) return;
  dir.normalize();
  const td = target.dot(dir);
  const disc = td * td - (target.lengthSq() - floor * floor);
  if (disc < 0) {
    controls.minDistance = MIN_DOLLY_DISTANCE_M;
    return;
  }
  controls.minDistance = Math.max(MIN_DOLLY_DISTANCE_M, -td + Math.sqrt(disc));
}

/**
 * Closest the camera may get to the ground, in metres. A small absolute figure
 * rather than a fraction of anything: it only has to stop the camera dipping
 * through the surface, and scaling it to the model prevented close inspection
 * of large ones.
 */
function minCameraAltitude() {
  return 0.05;
}

// The viewer drives its own animation loop, so there is no update hook to
// register with. Wrapping the controls' update is the one place every camera
// move -- ours, the user's, and the loop's -- has to pass through.
let unpatchedUpdate = null;

function patchControlsUpdate(on) {
  const controls = window.GeoIDViewer?.controls;
  if (!controls) return;
  if (on) {
    if (unpatchedUpdate) return;
    unpatchedUpdate = controls.update.bind(controls);
    controls.update = (...args) => {
      applyDollyFloor();
      const result = unpatchedUpdate(...args);
      keepCameraAboveGround();
      // Clip planes, grid spacing, the scale bar, and how far the ground needs
      // to reach all depend on the viewpoint, so they are refreshed wherever
      // the camera can move rather than only when a view button is pressed.
      // Leaving the planes fixed was what made the ground vanish on zoom: the
      // far plane stayed where the last framing left it and stopped reaching
      // the horizon within a few tens of kilometres.
      const focusPoint = controls.target;
      applyCameraClip(window.GeoIDViewer.camera,
        window.GeoIDViewer.camera.position.distanceTo(focusPoint));
      refreshGraticuleStep();
      updateScaleReadout();
      updateGroundReach();
      return result;
    };
  } else if (unpatchedUpdate) {
    controls.update = unpatchedUpdate;
    unpatchedUpdate = null;
  }
}

/**
 * Frames the model. The orbit target is the model's own origin on the surface,
 * never the centre of the Earth -- otherwise every orbit would swing the camera
 * around the planet instead of around the thing being built.
 */
function centreOnOrigin() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera || !viewer.controls) return;
  const anchor = ensureModelAnchor();
  if (!anchor) return;
  const focus = modelFocus();
  const centre = focus ? focus.center : anchor.getWorldPosition(new THREE.Vector3());
  // With nothing loaded there is no model to frame, so the studio opens on a
  // default working area -- a few hundred metres of ground, looking out at the
  // horizon.
  const radius = focus ? focus.radius : DEFAULT_WORK_RADIUS_M;
  const up = centre.clone().normalize();
  const east = new THREE.Vector3(1, 0, 0).applyQuaternion(anchor.quaternion);
  const south = new THREE.Vector3(0, 0, 1).applyQuaternion(anchor.quaternion);
  // A low oblique: the camera stands off the model and looks across it, so the
  // horizon and the curve of the ground are both in frame. A steeper angle
  // flattens into a plan view and loses the sense of standing on a surface.
  const d = Math.max(radius * 3.4, MODEL_MODE_RADIUS);
  const pitch = HORIZON_PITCH_RAD;
  viewer.controls.target.copy(centre);
  viewer.camera.up.copy(up);
  viewer.camera.position.copy(centre)
    .addScaledVector(up, d * Math.sin(pitch))
    .addScaledVector(east, d * Math.cos(pitch) * 0.6)
    .addScaledVector(south, d * Math.cos(pitch) * 0.8);
  applyCameraClip(viewer.camera, d);
  viewer.controls.update();
  keepCameraAboveGround();
  refreshGraticuleStep();
}

// ── Model operations ────────────────────────────────────────────────────────

function addSolid(kind, op, paramOverrides) {
  const params = paramOverrides || readParams();
  const { positions, params: merged } = buildSurface(kind, params);
  const entry = {
    id: state.solids.length + 1,
    kind,
    op,
    enabled: true,
    params: merged,
    test: buildInside(kind, params),
    bounds: boundingBoxOf(kind, params),
    region: PRIMITIVES[kind].region ? PRIMITIVES[kind].region(merged) : null,
    object3D: null,
  };
  attachParts(entry, positions, op === "difference" ? 0xff7a6b : 0x9fd8ff);
  state.solids.push(entry);
  record(`${op} ${kind}`);
  renderModelTree();
  renderDomainsPanel();
  // THE FIRST SOLID IS FRAMED. The studio opens on its own working area --
  // a few hundred metres of ground -- and a default 1 m box dropped into
  // that is a speck the reader has to hunt for. Only the first: a later add
  // must not yank the view away from what is being worked on.
  if (state.solids.length === 1) fitView();
  status(`${state.solids.length} entities`);
  log(`${op}: ${PRIMITIVES[kind].label} — ${entry.parts.length} face(s), volume flag ${entry.flags.volume}`);
}

/**
 * A PRIMITIVE IS ITS FACES, as a GIS terrain is: the display surface is split
 * by normal into the faces a reader can point at (a box's six, a cylinder's
 * caps and side, a sphere's one surface), each its own mesh in a group with
 * its own flag, row and card. The entity keeps a volume flag of its own. The
 * same parts feed the gmsh script, which finds each face again among the OCC
 * surfaces by its centroid and normal.
 */
function attachParts(entry, positions, colour, { opacity = 1 } = {}) {
  const faces = faceParts(positions);
  const group = new THREE.Group();
  group.name = `${entry.kind}_${entry.id}`;
  entry.flags = entry.flags || {};
  if (!(Number(entry.flags.volume) > 0)) { entry.flags.volume = state.nextVolumeFlag; state.nextVolumeFlag += 1; }
  entry.flags.faces = entry.flags.faces || {};
  entry.parts = [];
  const label = PRIMITIVES[entry.kind]?.label ?? entry.params?.label ?? entry.kind;
  faces.forEach((face) => {
    const flag = Number(entry.flags.faces[face.face]) > 0 ? Number(entry.flags.faces[face.face]) : face.flag;
    entry.flags.faces[face.face] = flag;
    const mesh = displayMesh(partPositions(positions, face), `${entry.kind}_${entry.id}_${face.face}`, colour, { opacity });
    group.add(mesh);
    entry.parts.push({
      id: `${entry.id}:${face.face}`, name: `Volume ${entry.id} — ${face.face}`, kind: "face", face: face.face, flag, mesh,
      solidId: entry.id, colour, domain: `solid:${entry.id}`, studio: true, curved: face.curved, centroid: face.centroid, normal: face.normal, area: face.area,
      rows: [
        ["What", `${face.curved ? "The curved surface" : `The ${face.face} face`} of Volume ${entry.id} (${label}, ${entry.op})`],
        ["Physical flag", `${flag} — gmsh physical surface "${face.face}"; a condition names this face`],
        ["Domain", `volume ${entry.id} · volume flag ${entry.flags.volume}`],
        ["Centroid", `${face.centroid.map((v) => Math.round(v * 100) / 100).join(", ")} m`],
        ["Area", `${Math.round(face.area).toLocaleString()} m²`],
        ["Triangles", face.triangles.length.toLocaleString()],
      ],
    });
  });
  const anchor = ensureModelAnchor();
  if (anchor) anchor.add(group);
  entry.object3D = group;
  return entry;
}

/** Every part on the page: the GIS terrain's, every primitive's, the air's, the points'. */
function allParts() {
  return [
    ...(gisTerrain?.parts || []),
    ...state.solids.flatMap((e) => e.parts || []),
    ...(state.pointParts || []),
  ];
}

function solidOfPart(part) {
  return Number.isFinite(part?.solidId) ? state.solids.find((e) => e.id === part.solidId) || null : null;
}

function combinedInside() {
  const active = state.solids.filter((s) => s.enabled);
  if (!active.length) return null;
  return (p) => {
    let value = false;
    active.forEach((entry) => {
      const hit = entry.test(p);
      if (entry.op === "difference") value = value && !hit;
      else if (entry.op === "intersect") value = value && hit;
      else value = value || hit;
    });
    return value;
  };
}

function combinedBounds() {
  const active = state.solids.filter((s) => s.enabled);
  if (!active.length) return null;
  const additive = active.filter((s) => s.op === "union");
  const source = additive.length ? additive : active;
  return source.reduce((acc, e) => ({
    minX: Math.min(acc.minX, e.bounds.minX), maxX: Math.max(acc.maxX, e.bounds.maxX),
    minY: Math.min(acc.minY, e.bounds.minY), maxY: Math.max(acc.maxY, e.bounds.maxY),
    minZ: Math.min(acc.minZ, e.bounds.minZ), maxZ: Math.max(acc.maxZ, e.bounds.maxZ),
  }), { ...source[0].bounds });
}

/** Box faces as triangle soup, one array per face, for the air's sky and sides. */
function boxFacePositions(x0, y0, z0, x1, y1, z1) {
  const q = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  return {
    sky: q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    sides: [
      ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
      ...q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
      ...q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]),
      ...q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]),
    ],
  };
}

/**
 * THE STUDIO'S ATMOSPHERE, as the Model Builder's: a box over the ground
 * (z = baseZ, the studio's own ground by default) up to a height, cut by the
 * model, so the air wraps whatever stands above the ground. An entity like
 * any other -- inside-test, bounds, parts (sky, sides), a volume flag -- so
 * the lattice mesher, the picker, the Domains panel and the script all see
 * it; its floor is the model's top and is not drawn.
 */
function applyStudioAtmosphere() {
  const a = state.atmosphere;
  if (a.entryId !== null) {
    const old = findById(a.entryId);
    if (old) { const keep = state.atmosphere; deleteEntities([old.id]); state.atmosphere = keep; }
    a.entryId = null;
  }
  if (!a.on || !(Number(a.heightM) > 0)) { renderModelTree(); renderDomainsPanel(); return null; }
  const solids = state.solids.filter((s) => s.enabled !== false && s.kind !== "atmosphere");
  const b = combinedBounds();
  if (!b) { log("Atmosphere: add a solid first — the air is a box over the model."); a.on = false; return null; }
  const pad = 0;
  const x0 = b.minX - pad, x1 = b.maxX + pad, y0 = b.minY - pad, y1 = b.maxY + pad;
  const z0 = Number.isFinite(a.baseZ) ? a.baseZ : 0; const z1 = z0 + Number(a.heightM);
  const modelInside = combinedInside() || (() => false);
  const entry = {
    id: state.solids.reduce((m, e) => Math.max(m, e.id), 0) + 1,
    kind: "atmosphere", op: "union", enabled: true,
    params: { label: "Atmosphere", heightM: a.heightM, baseZ: z0 },
    test: (q) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1 && q[2] >= z0 && q[2] <= z1 && !modelInside(q),
    bounds: { minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 },
    region: null, object3D: null,
    // A volume flag of its own, never one a primitive already took: measured, the
    // air defaulted to 11 beside a chamber that had just been given 11.
    flags: { volume: Number(a.flags?.volume) > 0 ? Number(a.flags.volume) : state.nextVolumeFlag, faces: { sky: a.flags?.sky ?? 4, sides: a.flags?.sides ?? 6 } },
    parts: [],
  };
  const faces = boxFacePositions(x0, y0, z0, x1, y1, z1);
  const group = new THREE.Group(); group.name = `atmosphere_${entry.id}`;
  [["sky", faces.sky, 0x9fd8ff, `A flat lid ${Math.round(a.heightM)} m over the ground`], ["sides", faces.sides, 0x7fc8ff, "The air's lateral boundary, one flag for all four sides"]].forEach(([face, pos, colour, blurb]) => {
    const mesh = displayMesh(Float32Array.from(pos), `atmosphere_${entry.id}_${face}`, colour, { opacity: 0.22, renderOrder: 2 });
    group.add(mesh);
    entry.parts.push({
      id: `${entry.id}:${face}`, name: `Atmosphere — ${face}`, kind: "face", face, flag: entry.flags.faces[face], mesh, solidId: entry.id, colour, domain: `solid:${entry.id}`, studio: true,
      centroid: face === "sky" ? [(x0 + x1) / 2, (y0 + y1) / 2, z1] : [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], normal: face === "sky" ? [0, 0, 1] : null,
      rows: [["What", blurb], ["Physical flag", `${entry.flags.faces[face]} — gmsh physical surface "${face === "sky" ? "sky" : "sides_above"}"`], ["Domain", `volume ${entry.id} · volume flag ${entry.flags.volume}`], ["Elevation", face === "sky" ? `${Math.round(z1)} m` : `${Math.round(z0)} to ${Math.round(z1)} m`]],
    });
  });
  const anchor = ensureModelAnchor();
  if (anchor) anchor.add(group);
  entry.object3D = group;
  if (!(Number(a.flags?.volume) > 0)) { a.flags = { ...(a.flags || {}), volume: entry.flags.volume }; state.nextVolumeFlag += 1; }
  state.solids.push(entry);
  a.entryId = entry.id;
  record(`atmosphere ${a.heightM} m`);
  renderModelTree();
  renderDomainsPanel();
  status(`${state.solids.length} entities`);
  log(`Atmosphere: ${Math.round(a.heightM)} m over z = ${Math.round(z0)}, volume flag ${entry.flags.volume}, sky ${entry.flags.faces.sky}, sides ${entry.flags.faces.sides}.`);
  return entry;
}

/** The embedded points as spheres, each a part with a card. */
function renderStudioPoints() {
  (state.pointParts || []).forEach((p) => {
    p.mesh.parent?.remove(p.mesh); p.mesh.geometry?.dispose?.(); studioMeshes.delete(p.mesh);
    const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.object3D === p.mesh);
    if (layer) window.GeoIDImportManager.removeLayer(layer.id);
  });
  state.pointParts = [];
  const b = combinedBounds();
  const span = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) : 10;
  const r = Math.max(span / 120, 1e-3);
  state.points.forEach((p, i) => {
    const geo = new THREE.SphereGeometry(r, 12, 8).toNonIndexed();
    const pos = geo.getAttribute("position").array;
    for (let k = 0; k < pos.length; k += 3) { pos[k] += p.x; pos[k + 1] += p.y; pos[k + 2] += p.z; }
    geo.dispose();
    const mesh = displayMesh(Float32Array.from(pos), `point_${p.name}`, 0xffd166, { renderOrder: 3 });
    state.pointParts.push({
      id: `spoint:${i}`, name: `Point — ${p.name}`, kind: "point", face: p.name, flag: p.flag, mesh, solidId: null, colour: 0xffd166, domain: "spoints", studio: true, at: [p.x, p.y, p.z],
      rows: [["What", "An embedded point: the mesh gets a node exactly here"], ["Position", `x ${p.x}, y ${p.y}, z ${p.z} m`], ["Physical flag", `${p.flag} — gmsh embeds it in the volume that holds it and tags it`], ["Node size", `${p.sizeM} m`]],
    });
  });
}

/** The two cards the Model pane grew: Atmosphere and Embedded points (the studio's own; a GIS terrain brings its own). */
function ensureStudioCards() {
  const pane = document.querySelector('.studio-pane[data-pane="model"]');
  if (!pane || gisTerrain) { byId("studio-air-card")?.remove(); byId("studio-points-card")?.remove(); return; }
  let air = byId("studio-air-card");
  if (!air) {
    air = document.createElement("details");
    air.id = "studio-air-card"; air.className = "gis-tool-section studio-fold-section";
    air.innerHTML = '<summary data-tool-icon="1">Atmosphere</summary><div class="gis-tool-body"></div>';
    pane.appendChild(air);
  }
  const body = air.querySelector(".gis-tool-body");
  body.innerHTML = "";
  const a = state.atmosphere;
  const rowOf = (label, input) => { const r = document.createElement("div"); r.className = "studio-row"; const l = document.createElement("label"); l.textContent = label; r.appendChild(l); r.appendChild(input); return r; };
  const num = (val, step = "any") => { const i = document.createElement("input"); i.className = "studio-input"; i.type = "number"; i.step = step; i.value = String(val); return i; };
  const h = num(a.heightM || (combinedBounds() ? Math.round((combinedBounds().maxZ - combinedBounds().minZ) * 0.5) : 0));
  const z = num(a.baseZ ?? 0);
  body.appendChild(rowOf("Height (m)", h));
  body.appendChild(rowOf("Ground level z (m)", z));
  const flags = document.createElement("div"); flags.className = "studio-row";
  const fl = document.createElement("label"); fl.textContent = "Flags"; flags.appendChild(fl);
  const fwrap = document.createElement("span"); fwrap.style.cssText = "display:flex;gap:0.3rem;align-items:center;flex-wrap:wrap";
  const vol = flagInput(a.flags?.volume ?? 11, (v) => { a.flags = { ...(a.flags || {}), volume: Number(v) }; }, "Volume flag");
  const sky = flagInput(a.flags?.sky ?? 4, (v) => { a.flags = { ...(a.flags || {}), sky: Number(v) }; }, "Sky flag");
  const sides = flagInput(a.flags?.sides ?? 6, (v) => { a.flags = { ...(a.flags || {}), sides: Number(v) }; }, "Sides flag");
  fwrap.appendChild(document.createTextNode("vol")); fwrap.appendChild(vol); fwrap.appendChild(document.createTextNode("sky")); fwrap.appendChild(sky); fwrap.appendChild(document.createTextNode("sides")); fwrap.appendChild(sides);
  flags.appendChild(fwrap); body.appendChild(flags);
  const btn = document.createElement("button"); btn.type = "button"; btn.className = a.on ? "studio-secondary" : "studio-primary";
  btn.textContent = a.on ? "Rebuild the atmosphere" : "Add an atmosphere";
  btn.addEventListener("click", () => { a.on = true; a.heightM = Number(h.value) || 0; a.baseZ = Number(z.value) || 0; applyStudioAtmosphere(); ensureStudioCards(); });
  body.appendChild(btn);
  if (a.on) {
    const off = document.createElement("button"); off.type = "button"; off.className = "studio-secondary"; off.textContent = "Remove the atmosphere";
    off.addEventListener("click", () => { a.on = false; applyStudioAtmosphere(); ensureStudioCards(); });
    body.appendChild(off);
  }
  const note = document.createElement("div"); note.className = "studio-readout";
  note.textContent = "A box over the ground cut by the model, as the Model Builder's: the air wraps what stands above z. In the gmsh script it is occ.cut, then everything is fragmented so the interfaces conform.";
  body.appendChild(note);

  let pts = byId("studio-points-card");
  if (!pts) {
    pts = document.createElement("details");
    pts.id = "studio-points-card"; pts.className = "gis-tool-section studio-fold-section";
    pts.innerHTML = '<summary data-tool-icon="1">Embedded points</summary><div class="gis-tool-body"></div>';
    pane.appendChild(pts);
  }
  const pb = pts.querySelector(".gis-tool-body");
  pb.innerHTML = "";
  const list = document.createElement("div"); list.className = "studio-list";
  if (!state.points.length) { const e = document.createElement("div"); e.className = "studio-item"; e.innerHTML = "<span>No embedded points</span>"; list.appendChild(e); }
  state.points.forEach((p, i) => {
    const row = document.createElement("div"); row.className = "studio-item";
    const name = document.createElement("span"); name.textContent = `${p.name} · (${p.x}, ${p.y}, ${p.z})`; name.style.cssText = "flex:1;cursor:pointer";
    name.addEventListener("click", () => { const part = state.pointParts?.[i]; if (part) { const r = row.getBoundingClientRect(); showPartCard(part, r.right + 8, r.top); } });
    const fb = flagInput(p.flag, (v) => { p.flag = Number(v); renderStudioPoints(); renderDomainsPanel(); }, `Flag for point "${p.name}"`);
    const kill = document.createElement("button"); kill.type = "button"; kill.className = "studio-mini"; kill.textContent = "✕";
    kill.addEventListener("click", () => { state.points.splice(i, 1); renderStudioPoints(); renderDomainsPanel(); ensureStudioCards(); });
    row.appendChild(name); row.appendChild(fb); row.appendChild(kill); list.appendChild(row);
  });
  pb.appendChild(list);
  const px = num(0), py = num(0), pz = num(0);
  const pname = document.createElement("input"); pname.className = "studio-input"; pname.type = "text"; pname.value = `point_${state.points.length + 1}`;
  pb.appendChild(rowOf("Name", pname)); pb.appendChild(rowOf("X (m)", px)); pb.appendChild(rowOf("Y (m)", py)); pb.appendChild(rowOf("Z (m)", pz));
  const add = document.createElement("button"); add.type = "button"; add.className = "studio-secondary"; add.textContent = "Add at x, y, z";
  add.addEventListener("click", () => {
    state.points.push({ name: pname.value || `point_${state.points.length + 1}`, x: Number(px.value) || 0, y: Number(py.value) || 0, z: Number(pz.value) || 0, flag: 20, sizeM: Math.max((Number(byId("studio-size-lo")?.value) || 1) / 2, 1e-3) });
    renderStudioPoints(); renderDomainsPanel(); ensureStudioCards();
    log(`Embedded point "${state.points[state.points.length - 1].name}" added.`);
  });
  pb.appendChild(add);
  const place = document.createElement("button"); place.type = "button"; place.className = state.placingPoint ? "studio-primary" : "studio-secondary";
  place.textContent = state.placingPoint ? "Click the model to place it… (Esc cancels)" : "Place by clicking the model";
  place.addEventListener("click", () => { state.placingPoint = !state.placingPoint; ensureStudioCards(); });
  pb.appendChild(place);
}

function renderModelTree() {
  applyBelowGround();
  ensureStudioCards();
  const entities = byId("studio-entities");
  if (entities) {
    entities.innerHTML = "";
    state.solids.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "studio-item";
      row.classList.toggle("is-selected", state.selection.has(entry.id));
      const label = document.createElement("span");
      label.textContent = `Volume ${entry.id} · ${PRIMITIVES[entry.kind]?.label ?? entry.params?.label ?? entry.kind}`
        + (entry.visible === false ? " (hidden)" : "");
      const controls = document.createElement("span");
      controls.className = "studio-item-actions";

      const eye = document.createElement("button");
      eye.type = "button";
      eye.className = "studio-mini";
      eye.textContent = entry.visible === false ? "Show" : "Hide";
      eye.title = "Hide or show this entity";
      eye.addEventListener("click", (event) => {
        event.stopPropagation();
        entry.visible = entry.visible === false;
        syncEntityAppearance();
        renderModelTree();
        log(`Volume ${entry.id} ${entry.visible === false ? "hidden" : "shown"}`);
      });

      const kill = document.createElement("button");
      kill.type = "button";
      kill.className = "studio-mini";
      kill.textContent = "Del";
      kill.title = "Delete this entity";
      kill.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteEntities([entry.id]);
      });

      controls.appendChild(eye);
      controls.appendChild(kill);
      row.appendChild(label);
      row.appendChild(controls);
      // Ctrl/Shift-click adds to the selection, as in the studio's 3D view.
      row.addEventListener("click", (event) => {
        setSelection([entry.id], { additive: event.ctrlKey || event.metaKey || event.shiftKey });
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (!state.selection.has(entry.id)) setSelection([entry.id]);
        showContextMenu(event.clientX, event.clientY);
      });
      entities.appendChild(row);
    });
  }
  const info = byId("studio-info");
  if (info) {
    const b = combinedBounds();
    info.innerHTML = state.solids.length
      ? `${state.solids.length} entities, ${state.fields.length} fields<br>`
        + (b ? `extent ${(b.maxX - b.minX).toFixed(2)} × ${(b.maxY - b.minY).toFixed(2)} × ${(b.maxZ - b.minZ).toFixed(2)}` : "")
      : "Empty model.";
  }
  const groups = byId("studio-groups");
  if (groups) {
    groups.innerHTML = state.groups.length
      ? ""
      : '<div class="studio-item"><span>No physical groups</span></div>';
    state.groups.forEach((g) => {
      const row = document.createElement("div");
      row.className = "studio-item";
      row.innerHTML = `<span>${g.name}</span><span>${g.entities.length} entities</span>`;
      groups.appendChild(row);
    });
  }
}

function renderSelection() {
  const node = byId("studio-selection");
  if (!node) return;
  const picked = [...state.selection].map(findById).filter(Boolean);
  node.textContent = picked.length
    ? `Selected: ${picked.map((e) => `Volume ${e.id} (${PRIMITIVES[e.kind]?.label ?? e.params?.label ?? e.kind})`).join(", ")}`
    : "Nothing selected";
}

/** Removes entities and their scene objects, then refreshes the panels. */
function deleteEntities(ids) {
  if (!ids.length) {
    log("Delete: nothing selected");
    return;
  }
  ids.forEach((id) => {
    const idx = state.solids.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const [entry] = state.solids.splice(idx, 1);
    entry.object3D?.parent?.remove(entry.object3D);
    entry.object3D?.traverse?.((o) => {
      o.geometry?.dispose?.(); o.material?.dispose?.();
      studioMeshes.delete(o);
      const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.object3D === o);
      if (layer) window.GeoIDImportManager.removeLayer(layer.id);
    });
    if (state.atmosphere.entryId === id) { state.atmosphere.on = false; state.atmosphere.entryId = null; }
    state.selection.delete(id);
  });
  record(`delete ${ids.length}`);
  renderModelTree();
  renderDomainsPanel();
  renderSelection();
  status(`${state.solids.length} entities`);
  log(`Deleted ${ids.length} ${ids.length === 1 ? "entity" : "entities"}`);
}

function setHidden(ids, hidden) {
  ids.forEach((id) => {
    const entry = findById(id);
    if (entry) entry.visible = !hidden;
  });
  syncEntityAppearance();
  renderModelTree();
  log(`${hidden ? "Hid" : "Showed"} ${ids.length} ${ids.length === 1 ? "entity" : "entities"}`);
}

/** Right-click menu over the tree and the viewport, mirroring the studio's. */
function showContextMenu(x, y) {
  hideContextMenu();
  const ids = [...state.selection];
  const menu = document.createElement("div");
  menu.className = "studio-context";
  menu.id = "studio-context";
  const items = [
    ["Hide", () => setHidden(ids, true)],
    ["Show", () => setHidden(ids, false)],
    ["Isolate", () => {
      state.solids.forEach((e) => { e.visible = state.selection.has(e.id); });
      syncEntityAppearance();
      renderModelTree();
      log(`Isolated ${ids.length}`);
    }],
    ["Show all", () => setHidden(state.solids.map((e) => e.id), false)],
    ["Delete", () => deleteEntities(ids)],
  ];
  items.forEach(([label, fn]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => { fn(); hideContextMenu(); });
    menu.appendChild(button);
  });
  menu.style.left = `${Math.min(x, window.innerWidth - 140)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 160)}px`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener("pointerdown", hideContextMenu, { once: true }), 0);
}

function hideContextMenu() {
  document.getElementById("studio-context")?.remove();
}

// ── Viewport picking ────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pressedAt = null;

function pickAt(clientX, clientY) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera) return null;
  const canvas = viewer.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, viewer.camera);
  const targets = state.solids
    .filter((entry) => entry.object3D && entry.visible !== false)
    .map((entry) => entry.object3D);
  if (!targets.length) return null;
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return null;
  const owner = state.solids.find((entry) => {
    let o = hits[0].object;
    while (o) { if (o === entry.object3D) return true; o = o.parent; }
    return false;
  });
  return owner ? owner.id : null;
}

function installPicking() {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || canvas.dataset.studioPicking) return;
  canvas.dataset.studioPicking = "1";

  canvas.addEventListener("pointerdown", (event) => {
    pressedAt = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener("pointerup", (event) => {
    if (window.GeoIDModeManager?.getMode?.() !== "model") return;
    if (!pressedAt) return;
    const moved = Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y);
    pressedAt = null;
    // Orbiting must not select, so only a near-stationary press counts.
    if (moved > 6 || event.button !== 0) return;
    if (state.placingPoint) {
      const targets = state.solids.filter((e) => e.object3D && e.visible !== false && e.kind !== "atmosphere").map((e) => e.object3D);
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, viewer.camera);
      const hit = targets.length ? raycaster.intersectObjects(targets, true)[0] : null;
      if (hit && modelAnchor) {
        const local = modelAnchor.worldToLocal(hit.point.clone());
        const s = studioScale || 1;
        const r = (v) => Math.round(v * 1000) / 1000;
        // The anchor's frame: x east, y up, z south -- the model's z is up.
        state.points.push({ name: `point_${state.points.length + 1}`, x: r(local.x / s), y: r(-local.z / s), z: r(local.y / s), flag: 20, sizeM: Math.max((Number(byId("studio-size-lo")?.value) || 1) / 2, 1e-3) });
        state.placingPoint = false;
        renderStudioPoints(); renderDomainsPanel(); ensureStudioCards();
        log(`Embedded point placed at ${r(local.x / s)}, ${r(-local.z / s)}, ${r(local.y / s)} m.`);
      } else {
        log("Place: click on the model itself.");
      }
      return;
    }
    const part = partAt(event.clientX, event.clientY);
    if (part) {
      showPartCard(part, event.clientX, event.clientY);
      if (part.solidId !== null && part.solidId !== undefined) setSelection([part.solidId]);
      log(`Picked ${part.name}`);
      return;
    }
    closePartCard();
    const id = pickAt(event.clientX, event.clientY);
    if (id === null) {
      setSelection([]);
      return;
    }
    setSelection([id], { additive: event.ctrlKey || event.metaKey || event.shiftKey });
    const entry = findById(id);
    log(`Picked Volume ${id} (${PRIMITIVES[entry.kind]?.label ?? entry.params?.label ?? entry.kind})`);
  });

  // Live WGS84 readout follows the cursor across the ground and the model.
  //
  // NOT WHILE A BUTTON IS DOWN, and not more than a dozen times a second. A
  // drag is how the view is rotated, and every pointermove of it was a
  // raycast against every solid -- three meshes of 95,000 triangles each,
  // with no acceleration structure -- so rotating a GIS terrain was a
  // slideshow. Nobody reads a coordinate under a cursor they are dragging.
  let lastReadoutAt = 0;
  canvas.addEventListener("pointermove", (event) => {
    if (window.GeoIDModeManager?.getMode?.() !== "model") return;
    if (event.buttons) return;
    const now = performance.now();
    if (now - lastReadoutAt < 80) return;
    lastReadoutAt = now;
    const viewer = window.GeoIDViewer;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, viewer.camera);
    /**
     * THE READOUT READS THE GROUND, NOT THE AIR. The nearest hit from above
     * was the atmosphere's lid -- a translucent shell is still a mesh to a
     * raycaster -- so every point over the terrain read "3,849 m", the sky's
     * height, at the lid's own lat/lon. Measured: three ground points at 279,
     * 508 and 158 m all reporting the lid. Translucent solids are skipped,
     * the surface skin is asked first, and the height comes from the full
     * TIN rather than the display stand-in.
     */
    const targets = [];
    if (gisTerrain?.skin?.visible) targets.push(gisTerrain.skin);
    state.solids.filter((e) => e.object3D && e.visible !== false).forEach((e) => targets.push(e.object3D));
    if (groundMesh?.visible) targets.push(groundMesh);
    const hit = targets.length
      ? raycaster.intersectObjects(targets, true)
        .find((h) => h.object.visible && !(h.object.material?.transparent && h.object.material.opacity < 1))
      : null;
    let elevation;
    if (hit && (gisTerrain?.surface || gisTerrain?.profile) && modelAnchor && hit.object !== groundMesh) {
      const local = modelAnchor.worldToLocal(hit.point.clone());
      const s = studioScale || 1;
      const h = terrainHeightAt(local.x / s, -local.z / s);
      if (Number.isFinite(h) && hit.object === gisTerrain.skin) elevation = h;
    }
    updateCoordinateReadout(hit ? hit.point : null, elevation);
  });

  canvas.addEventListener("contextmenu", (event) => {
    if (window.GeoIDModeManager?.getMode?.() !== "model") return;
    const id = pickAt(event.clientX, event.clientY);
    if (id === null) return;
    event.preventDefault();
    if (!state.selection.has(id)) setSelection([id]);
    showContextMenu(event.clientX, event.clientY);
  });

  // Delete key removes the picked entities, as in the desktop studio.
  window.addEventListener("keydown", (event) => {
    if (window.GeoIDModeManager?.getMode?.() !== "model") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteEntities([...state.selection]);
    } else if (event.key === "Escape") {
      setSelection([]);
      if (state.placingPoint) { state.placingPoint = false; ensureStudioCards(); }
    }
  });
}

function renderHistory() {
  const host = byId("studio-history");
  if (!host) return;
  host.innerHTML = "";
  state.history.forEach((h, i) => {
    const row = document.createElement("div");
    row.className = "studio-item";
    row.innerHTML = `<span>${i + 1}. ${h.op}</span>`;
    host.appendChild(row);
  });
}

/**
 * THE SIZE FIELDS, in the Model Builder's vocabulary and the emitter's own
 * shape (coordinates are already the model's): a card per field with its
 * numbers editable, the same types the builder offers. `mesh-size-fields.js`
 * writes them into the script.
 */
const FIELD_KEYS = {
  point: [["x", "X"], ["y", "Y"], ["z", "Z"], ["sizeM", "Size at the point"], ["distMinM", "Held to"], ["distMaxM", "Graded out to"], ["sizeMaxM", "Size past that (blank = cap)"]],
  boundary: [["flag", "Flag of the face(s)"], ["sizeM", "Size on the boundary"], ["distMinM", "Held to"], ["distMaxM", "Graded out to"], ["sizeMaxM", "Size past that (blank = cap)"]],
  box: [["xMin", "X min"], ["xMax", "X max"], ["yMin", "Y min"], ["yMax", "Y max"], ["zMin", "Z min"], ["zMax", "Z max"], ["sizeM", "Size inside"], ["sizeOutM", "Size outside (blank = cap)"], ["thicknessM", "Blend over"]],
  ball: [["x", "X"], ["y", "Y"], ["z", "Z"], ["radiusM", "Radius"], ["sizeM", "Size inside"], ["sizeOutM", "Size outside (blank = cap)"], ["thicknessM", "Blend over"]],
  expr: [["expression", "F(x, y, z)"]],
};

function studioDefaultField(type) {
  const coarse = Number(byId("studio-size-hi")?.value) || 1;
  const fine = Math.max(coarse / 4, 1e-3);
  const b = combinedBounds();
  const c = b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2] : [0, 0, 0];
  const span = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) : 10;
  const base = { id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, type, on: true, name: FIELD_TYPES[type]?.label || type };
  switch (type) {
    case "point": return { ...base, x: c[0], y: c[1], z: c[2], sizeM: fine, distMinM: coarse, distMaxM: coarse * 5, sizeMaxM: null };
    case "boundary": return { ...base, key: "top", flag: 1, entityDim: 2, sizeM: fine, distMinM: coarse / 2, distMaxM: coarse * 4, sizeMaxM: null };
    case "box": return { ...base, xMin: c[0] - span / 8, xMax: c[0] + span / 8, yMin: c[1] - span / 8, yMax: c[1] + span / 8, zMin: null, zMax: null, sizeM: fine, sizeOutM: null, thicknessM: coarse };
    case "ball": return { ...base, x: c[0], y: c[1], z: c[2], radiusM: span / 6, sizeM: fine, sizeOutM: null, thicknessM: coarse };
    case "expr": return { ...base, expression: `${coarse}` };
    default: return base;
  }
}

function renderFields() {
  const host = byId("studio-fields");
  if (!host) return;
  host.innerHTML = "";
  if (!state.fields.length) { host.innerHTML = '<div class="studio-item"><span>No size fields — one size everywhere</span></div>'; return; }
  const coarse = Number(byId("studio-size-hi")?.value) || 1;
  state.fields.forEach((fld, i) => {
    const card = document.createElement("div");
    card.className = "gis-tool-section";
    card.style.padding = "0.4rem 0.5rem";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:0.35rem";
    const on = document.createElement("input"); on.type = "checkbox"; on.checked = fld.on !== false;
    on.addEventListener("change", () => { fld.on = on.checked; });
    const name = document.createElement("input"); name.className = "studio-input"; name.type = "text"; name.value = fld.name || fld.type; name.style.flex = "1";
    name.addEventListener("change", () => { fld.name = name.value || fld.type; });
    const kill = document.createElement("button"); kill.type = "button"; kill.className = "studio-mini"; kill.textContent = "✕";
    kill.addEventListener("click", () => { state.fields.splice(i, 1); renderFields(); log("Field removed"); });
    head.appendChild(on); head.appendChild(name); head.appendChild(kill);
    card.appendChild(head);
    const kind = document.createElement("div"); kind.className = "studio-readout"; kind.textContent = FIELD_TYPES[fld.type]?.label || fld.type;
    card.appendChild(kind);
    (FIELD_KEYS[fld.type] || []).forEach(([key, label]) => {
      const row = document.createElement("div"); row.className = "studio-row";
      const l = document.createElement("label"); l.textContent = label;
      const input = document.createElement("input"); input.className = "studio-input";
      input.type = key === "expression" ? "text" : "number"; input.step = "any";
      input.value = fld[key] === null || fld[key] === undefined ? "" : String(fld[key]);
      input.addEventListener("change", () => { const v = input.value.trim(); fld[key] = key === "expression" ? v : (v === "" ? null : Number(v)); says.textContent = describeField(fld, coarse); });
      input.addEventListener("keydown", (e) => e.stopPropagation());
      row.appendChild(l); row.appendChild(input); card.appendChild(row);
    });
    const says = document.createElement("div"); says.className = "studio-readout"; says.textContent = describeField(fld, coarse);
    card.appendChild(says);
    host.appendChild(card);
  });
}

// ── Meshing ─────────────────────────────────────────────────────────────────

function meshModel(dim) {
  const inside = combinedInside();
  const bounds = combinedBounds();
  if (!inside || !bounds) {
    status("nothing to mesh");
    log("Mesh aborted: model is empty");
    return;
  }
  const sizeMax = Number(byId("studio-size-hi")?.value) || 1;
  const sizeMin = Number(byId("studio-size-lo")?.value) || sizeMax;
  const active = state.fields.find((f) => f.type === "ball" && f.on !== false) || null;
  const refine = active ? { x: active.x, y: active.y, z: active.z, radius: active.radiusM ?? active.radius } : null;
  const regionSource = state.solids.find((s) => s.enabled && s.region);

  status("meshing…");
  log(`Mesh ${dim}D: size ${sizeMin}–${sizeMax}${refine ? ", ball refine" : ""}`);
  window.requestAnimationFrame(() => {
    const t0 = performance.now();
    const result = latticeTetMesh(inside, bounds, {
      cellSize: Math.max(sizeMin, 1e-6),
      refine,
      regionFn: regionSource ? regionSource.region : null,
    });
    if (!result.ok) {
      status("mesh failed");
      log(result.message);
      byId("studio-mesh-info").textContent = result.message;
      return;
    }
    const surface = tetBoundarySurface(result.nodes, result.tets);
    state.mesh = { ...result, surface };
    const counts = elementCounts(result.nodes, result.tets, surface);
    // 1D/2D requests still mesh the volume (the lattice is inherently 3D) but
    // only the boundary is shown, matching what those buttons display.
    displayMesh(surface, `mesh_${dim}d_${counts.tetrahedra}`, 0xc9b79c);
    byId("studio-mesh-info").innerHTML =
      `<strong>${counts.tetrahedra.toLocaleString()}</strong> tets · `
      + `${counts.nodes.toLocaleString()} nodes · ${counts.boundaryTriangles.toLocaleString()} tris`;
    status(`${counts.tetrahedra.toLocaleString()} elements`);
    log(`Meshed in ${Math.round(performance.now() - t0)} ms`);
    showQuality();
    ["studio-exp-msh", "studio-exp-stl", "studio-exp-obj", "studio-exp-ply"]
      .forEach((id) => { const b = byId(id); if (b) b.disabled = false; });
    record(`mesh ${dim}D`);
  });
}

function showQuality() {
  if (!state.mesh) return;
  const q = qualityStats(state.mesh.nodes, state.mesh.tets);
  if (!q) return;
  const canvas = byId("studio-quality");
  if (!canvas) return;
  canvas.hidden = false;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const peak = Math.max(...q.histogram, 1);
  const w = canvas.width / q.histogram.length;
  q.histogram.forEach((count, i) => {
    const h = (count / peak) * (canvas.height - 14);
    ctx.fillStyle = i < 2 ? "#ff7a6b" : "#8ef6c4";
    ctx.fillRect(i * w + 1, canvas.height - h, w - 2, h);
  });
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "9px monospace";
  ctx.fillText(`min ${q.min.toFixed(2)}  mean ${q.mean.toFixed(2)}  inv ${q.invertedElements}`, 3, 10);
  log(`Quality: min ${q.min.toFixed(3)}, mean ${q.mean.toFixed(3)}, volume ${q.volume.toFixed(3)}`);
}

// ── Export ──────────────────────────────────────────────────────────────────

function surfaceToStl(p) {
  const out = ["solid geoid"];
  for (let i = 0; i < p.length; i += 9) {
    out.push("facet normal 0 0 0", "  outer loop");
    for (let v = 0; v < 3; v += 1) out.push(`    vertex ${p[i + v * 3]} ${p[i + v * 3 + 1]} ${p[i + v * 3 + 2]}`);
    out.push("  endloop", "endfacet");
  }
  out.push("endsolid geoid");
  return out.join("\n");
}

function surfaceToObj(p) {
  const out = [];
  for (let i = 0; i < p.length; i += 3) out.push(`v ${p[i]} ${p[i + 1]} ${p[i + 2]}`);
  for (let f = 0; f < p.length / 9; f += 1) out.push(`f ${f * 3 + 1} ${f * 3 + 2} ${f * 3 + 3}`);
  return out.join("\n");
}

function surfaceToPly(p) {
  const n = p.length / 3;
  const out = ["ply", "format ascii 1.0", `element vertex ${n}`,
    "property float x", "property float y", "property float z",
    `element face ${n / 3}`, "property list uchar int vertex_index", "end_header"];
  for (let i = 0; i < p.length; i += 3) out.push(`${p[i]} ${p[i + 1]} ${p[i + 2]}`);
  for (let f = 0; f < n / 3; f += 1) out.push(`3 ${f * 3} ${f * 3 + 1} ${f * 3 + 2}`);
  return out.join("\n");
}

/** The model as a runnable gmsh script — the text, so it can be downloaded
 *  OR handed to the sidecar to run without a round trip through the disk. */
/** The Mesh pane's knobs as the emitter's options. */
function studioMeshOptions() {
  const alg2 = { MeshAdapt: 1, Delaunay: 5, "Frontal-Delaunay": 6 }[byId("studio-alg2")?.value] || null;
  const alg3 = { Delaunay: 1, HXT: 10 }[byId("studio-alg3")?.value] || null;
  const hi = Number(byId("studio-size-hi")?.value); const lo = Number(byId("studio-size-lo")?.value);
  return { combine: "min", sizeMaxM: hi > 0 ? hi : null, sizeMinM: lo > 0 ? lo : null, extendFromBoundary: false, fromPoints: false, fromCurvature: 0, algorithm2d: alg2, algorithm3d: alg3 };
}

/** The studio's model as the emitter reads it: entities with their parts' flags, the air, the points, the fields. */
function studioModel(name = "geoid_studio") {
  const a = state.atmosphere;
  const airEntry = a.entryId !== null ? findById(a.entryId) : null;
  return {
    name,
    solids: state.solids.filter((e) => e.kind !== "atmosphere").map((e, i) => ({
      kind: e.kind, op: e.op, enabled: e.enabled, params: e.params, name: `${e.kind}_${e.id}`,
      flags: { volume: e.flags?.volume, faces: e.flags?.faces || {}, layers: e.flags?.layers, void: Boolean(e.flags?.void) },
      parts: (e.parts || []).map((p) => ({ face: p.face, flag: p.flag, centroid: p.centroid, normal: p.normal })),
    })),
    atmosphere: airEntry ? { on: true, heightM: a.heightM, baseZ: airEntry.bounds.minZ, minX: airEntry.bounds.minX, maxX: airEntry.bounds.maxX, minY: airEntry.bounds.minY, maxY: airEntry.bounds.maxY, flags: { volume: airEntry.flags.volume, sky: airEntry.flags.faces.sky, sides: airEntry.flags.faces.sides } } : null,
    points: state.points.map((p) => ({ ...p })),
    sizeFields: state.fields.filter((f) => f.on !== false),
    meshOptions: studioMeshOptions(),
    order: Number(byId("studio-order")?.value) || 1,
  };
}

function buildGmshScript() {
  return studioGmshScript({ ...studioModel(), meshFile: "geoid_studio.msh" });
}

/**
 * THE PACKAGE, the Model Builder's own: an STL of every part, the gmsh
 * script and a spec, into the open project's meshes/ and fem_runs/. A model
 * that came from the GIS page goes back through the builder's writer, so a
 * DEM-derived model and a built one leave the same set of files.
 */
async function exportPackage() {
  if (gisTerrain) {
    const pipeline = window.GeoIDModelPipeline;
    if (pipeline?.build) { log("A GIS terrain: the Model Builder writes its package."); await pipeline.build(); return; }
  }
  if (!state.solids.length) { log("Nothing to package — add a solid first."); return; }
  const name = "geoid_studio";
  const model = studioModel(name);
  const script = studioGmshScript({ ...model, meshFile: `${name}.msh` });
  const stl = [`solid ${name}`];
  allParts().filter((p) => p.studio && p.kind === "face").forEach((p) => {
    const pos = p.mesh.geometry.getAttribute("position").array;
    // back from the scene frame (y up, z south) to the model's (z up)
    for (let i = 0; i < pos.length; i += 9) {
      const v = (k) => [pos[i + k], -pos[i + k + 2], pos[i + k + 1]];
      const a = v(0), b = v(3), c = v(6);
      stl.push("  facet normal 0 0 0", "    outer loop", `      vertex ${a.join(" ")}`, `      vertex ${b.join(" ")}`, `      vertex ${c.join(" ")}`, "    endloop", "  endfacet");
    }
  });
  stl.push(`endsolid ${name}`);
  const run = `${name}_run`;
  const spec = femSpec({
    run, mesh: `${name}.msh`, domain: "solid", dim: 3,
    provenance: {
      kind: "studio model", built_at: new Date().toISOString(),
      entities: model.solids.map((e) => ({ kind: e.kind, op: e.op, params: e.params, flags: e.flags })),
      atmosphere: model.atmosphere, embedded_points: model.points,
      mesh: { options: model.meshOptions, size_fields: model.sizeFields.map((f) => ({ type: f.type, name: f.name, says: describeField(f, model.meshOptions.sizeMaxM) })) },
      crs: "the studio's own local metres about its origin (x east, y north, z up)",
    },
  });
  const store = window.GeoIDResearch?.store;
  const project = store?.getActive?.();
  if (!project) {
    downloadText(`${name}.stl`, `${stl.join("\n")}\n`);
    downloadText(`${name}_gmsh.py`, script, "text/x-python");
    downloadText(`${run}_spec.json`, JSON.stringify(spec, null, 2), "application/json");
    log("No project open — the package was downloaded instead (STL, gmsh script, spec).");
    return;
  }
  try {
    await store.writeProjectFile(`meshes/${name}.stl`, `${stl.join("\n")}\n`);
    await store.writeProjectFile(`meshes/${name}_gmsh.py`, script);
    await store.writeProjectFile(`fem_runs/${run}/spec.json`, JSON.stringify(spec, null, 2));
    log(`Package written into ${project.name}: meshes/${name}.stl, meshes/${name}_gmsh.py, fem_runs/${run}/spec.json.`);
    status("package written");
  } catch (error) {
    log(`Could not write the package: ${error.message}`);
  }
}

function buildGmshScriptLegacy() {
  const lines = ["import gmsh", "gmsh.initialize()", 'gmsh.model.add("geoid")',
    "occ = gmsh.model.occ", ""];
  state.solids.forEach((entry) => {
    const p = entry.params;
    const f = (v) => Number(v).toFixed(6);
    if (entry.kind === "box") {
      lines.push(`occ.addBox(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.dx)}, ${f(p.dy)}, ${f(p.dz)})  # ${entry.op}`);
    } else if (entry.kind === "sphere") {
      lines.push(`occ.addSphere(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.r)})  # ${entry.op}`);
    } else if (entry.kind === "cylinder") {
      lines.push(`occ.addCylinder(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, 0, 0, ${f(p.h)}, ${f(p.r)})  # ${entry.op}`);
    } else if (entry.kind === "cone") {
      lines.push(`occ.addCone(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, 0, 0, ${f(p.h)}, ${f(p.r1)}, ${f(p.r2)})  # ${entry.op}`);
    } else if (entry.kind === "torus") {
      lines.push(`occ.addTorus(${f(p.x)}, ${f(p.y)}, ${f(p.z)}, ${f(p.r1)}, ${f(p.r2)})  # ${entry.op}`);
    } else if (entry.kind === "volcano_edifice") {
      lines.push(`_crust = (3, occ.addBox(${f(-p.crust_width / 2)}, ${f(-p.crust_width / 2)}, ${f(-p.crust_depth)}, ${f(p.crust_width)}, ${f(p.crust_width)}, ${f(p.crust_depth)}))`);
      lines.push(`_cone = (3, occ.addCone(0, 0, 0, 0, 0, ${f(p.height)}, ${f(p.base_radius)}, ${f(p.summit_radius)}))`);
      lines.push("occ.fuse([_crust], [_cone])");
    } else if (entry.kind === "layered_halfspace") {
      lines.push(`# layered halfspace ${p.width} x ${p.depth}, thicknesses ${p.thicknesses}`);
    } else if (entry.kind === "dike") {
      lines.push(`# dike L=${f(p.length)} H=${f(p.height)} T=${f(p.thickness)} strike=${f(p.strike)} dip=${f(p.dip)}`);
    } else {
      lines.push(`# ${entry.kind} ${JSON.stringify(p)}`);
    }
  });
  lines.push("", "occ.synchronize()",
    `gmsh.option.setNumber("Mesh.MeshSizeMax", ${Number(byId("studio-size-hi")?.value) || 1})`,
    "gmsh.model.mesh.generate(3)", 'gmsh.write("geoid.msh")', "gmsh.finalize()");
  return lines.join("\n");
}

/** Emits the model as a runnable gmsh script, matching the studio's action. */
function exportScript() {
  downloadText("geoid_model.py", buildGmshScript(), "text/x-python");
  log("Exported gmsh script");
}

/**
 * Mesh with the real gmsh, in the sidecar.
 *
 * The browser's lattice mesher is capped at 400k cells and knows nothing of
 * OCC booleans; gmsh does both properly. Until now the studio could only
 * write the script and ask the user to run it by hand — this hands the exact
 * same text to `/jobs/gmsh`, which runs it beside the project and leaves the
 * mesh in `meshes/` where FEM Setup and the GALES prepare already look.
 *
 * Degrades honestly: no sidecar, no gmsh, or no project each produce a
 * sentence saying which, and the Export script button still does what it
 * always did.
 */
async function meshWithGmsh() {
  const sidecar = window.GeoIDResearch?.sidecar;
  const store = window.GeoIDResearch?.store;
  if (!sidecar?.isConnected?.()) {
    log("Gmsh runs in the local sidecar — connect it in Settings, or use Export script.");
    return;
  }
  const project = store?.getActive?.();
  if (!project) {
    log("Open a project first: the mesh is written into its meshes/ folder.");
    return;
  }
  if (!state.solids.length) {
    log("Nothing to mesh — add a solid first.");
    return;
  }
  try {
    status("meshing in gmsh…");
    log("Sending the model to gmsh in the sidecar…");
    const name = `studio_${new Date().toISOString().slice(0, 10)}`;
    const jobId = await sidecar.runGmsh({
      project: project.folder || project.name,
      script: buildGmshScript(),
      name,
      dim: 3,
    });
    const snap = await sidecar.awaitJob(jobId);
    if (snap.status !== "done" || snap.exit_code) {
      log(`Gmsh failed (exit ${snap.exit_code ?? "?"}). The Jobs drawer has its log.`);
      status("gmsh failed");
      return;
    }
    log(`Gmsh wrote meshes/${name}.msh — FEM Setup will list it.`);
    status("mesh ready");
  } catch (error) {
    // A 409 from the sidecar is the honest "gmsh is not installed here".
    log(`Gmsh could not run: ${error.message}`);
    status("gmsh unavailable");
  }
}

function exportMesh(kind) {
  if (!state.mesh) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const map = {
    msh: () => [toGmsh22(state.mesh.nodes, state.mesh.tets, state.mesh.regions), "msh", "text/plain"],
    stl: () => [surfaceToStl(state.mesh.surface), "stl", "model/stl"],
    obj: () => [surfaceToObj(state.mesh.surface), "obj", "text/plain"],
    ply: () => [surfaceToPly(state.mesh.surface), "ply", "text/plain"],
  };
  const [text, ext, mime] = map[kind]();
  const filename = `geoid_mesh_${stamp}.${ext}`;

  /**
   * A .msh belongs in the project's meshes/, and only there.
   *
   * The default download path files everything under exports/ as kind
   * "export", but nothing that consumes a mesh looks in exports/: the FEM
   * Setup dropdown lists meshes/, and the sidecar's GALES prepare globs
   * meshes/*.msh. So "To GALES" produced a file the rest of the pipeline
   * could not see, while bridge.saveMesh -- which files to meshes/ as kind
   * "mesh" -- sat uncalled. Only the .msh goes there: listMeshes offers every
   * file in that folder as a FEM mesh, and an .stl accepted by the dropdown
   * would then fail GALES prepare, which reads .msh alone.
   */
  if (kind === "msh") {
    const saveMesh = window.GeoIDResearch?.bridge?.saveMesh;
    if (saveMesh) {
      saveMesh(filename, text, {
        body: studioBody()?.id,
        nodes: state.mesh.nodes.length,
        tets: state.mesh.tets.length,
      }).then(
        (path) => log(`Mesh filed in project: ${path}`),
        () => log("No project open — mesh downloaded only"),
      );
    }
    downloadText(filename, text, mime, { project: false });
  } else {
    downloadText(filename, text, mime);
  }
  log(`Exported ${ext.toUpperCase()}`);
}

// ── Viewport controls ───────────────────────────────────────────────────────

function eachModelMaterial(fn) {
  (window.GeoIDImportManager?.getLayers?.() || []).forEach((layer) => {
    layer.object3D?.traverse?.((child) => {
      if (child.material) fn(child.material, child);
    });
  });
}

/**
 * Bounding sphere of every visible imported layer, in world space. This is what
 * the camera frames -- the model, never the reference sphere's centre.
 */
/**
 * Near and far planes for a view framed at distance `d`.
 *
 * The sphere is the whole Earth now, so a far plane covering its diameter would
 * span eight orders of magnitude and leave the depth buffer with nothing left
 * for the model. Only as far as the horizon is ever needed from close in, which
 * keeps the ratio small enough for the model to render cleanly; pulled back, it
 * opens up to take in the whole globe.
 */
function applyCameraClip(camera, d) {
  const altitude = Math.max(camera.position.length() - groundRadius, 0.01);
  const horizon = Math.sqrt(2 * groundRadius * altitude + altitude * altitude);
  camera.near = Math.max(d / 1000, 0.01);
  camera.far = Math.max(d * 40, horizon * 2, altitude * 2);
  camera.updateProjectionMatrix();
}

/**
 * The globe view, put aside while the studio has the camera.
 *
 * The studio parks the orbit target on the model's origin, which sits far out
 * along +Y at the Earth's radius. Left there, returning to the globe aims the
 * camera at that point instead of the planet -- which reads as the view jumping
 * to the north pole.
 */
/**
 * The globe's view as the page launched, captured once and never overwritten.
 *
 * Model mode moves the camera into a completely different frame — the studio
 * works in metres about a point on the surface, millions of scene units from
 * where the globe camera sits — so coming back is a jump however it is done.
 * Restoring "wherever you were before" made that jump unpredictable: it
 * depended on what you had been looking at, and after switching worlds in the
 * studio it could land somewhere that made no sense on the globe at all.
 *
 * So the return is fixed: always the view the page opened with. One known
 * place, every time. The cost is real and worth stating — a close look at Etna
 * is not resumed after a trip to the studio — but a predictable jump beats an
 * arbitrary one, and the zoom pill puts you back in three presses.
 */
let launchGlobeView = null;

/**
 * THE VIEW IS REMEMBERED IN THE BODY'S FRAME, never in world space.
 *
 * Eight of the nine planet viewers and Earth put their body at the world
 * origin, so the two frames are the same thing and this is arithmetic on
 * zero. The MOON does not: Earth holds the origin there and the Moon orbits
 * it about 708 scene units out, moving the whole time. A view remembered as
 * world coordinates therefore names a place the Moon has since left, and
 * restoring it puts the camera and the orbit pivot beside the Moon rather
 * than on it.
 *
 * Measured on a cold load, before the fix: the anchor is exact until
 * mode-manager sets the opening mode at ~10 s, then jumps 12.06 units off the
 * Moon's centre in one frame — nearly four Moon radii, on a globe of radius
 * 3.2 — and stays there, because the render loop's orbital follow adds the
 * Moon's per-frame delta to camera and target alike and so carries the error
 * forward for the life of the page. Everything downstream reads the target as
 * the body centre, so drag-to-orbit swung the Moon across the screen and the
 * zoom pill reported 4,552 km against a true 10,030 km.
 *
 * `viewer.globe` is the body mesh on every one of the eleven viewers, so its
 * world position is the centre without a new seam to keep in step.
 */
function bodyCentreOf(viewer, out) {
  const centre = out || new THREE.Vector3();
  const body = viewer?.globe;
  if (!body) return centre.set(0, 0, 0);
  body.updateWorldMatrix(true, false);
  return centre.setFromMatrixPosition(body.matrixWorld);
}

/** Captured once — the first call wins, so later ones cannot drift it. */
function rememberGlobeView() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera || launchGlobeView) return;
  const centre = bodyCentreOf(viewer);
  launchGlobeView = {
    position: viewer.camera.position.clone().sub(centre),
    target: (viewer.controls?.target.clone() || new THREE.Vector3()).sub(centre),
    up: viewer.camera.up.clone(),
    near: viewer.camera.near,
    far: viewer.camera.far,
    // The altitude too, because the globe's zoom is a TARGET the render loop
    // eases towards, not a position. Restoring the camera without it leaves a
    // stale target alive and the loop simply pulls the camera back off the
    // restored view over the next second -- measured: restored to 4.57 units
    // and dragged back to 3.70 within three seconds, which reads as the view
    // "offsetting dramatically" a beat after the mode switch.
    altitudeMetres: viewer.getZoomAltitudeMetres?.()?.metres ?? null,
  };
}

function restoreGlobeView() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera || !launchGlobeView) return;
  // Re-anchored to where the body is NOW, which is the whole point.
  const centre = bodyCentreOf(viewer);
  viewer.camera.position.copy(launchGlobeView.position).add(centre);
  viewer.camera.up.copy(launchGlobeView.up);
  viewer.camera.near = launchGlobeView.near;
  viewer.camera.far = launchGlobeView.far;
  viewer.camera.updateProjectionMatrix();
  viewer.controls?.target.copy(launchGlobeView.target).add(centre);
  viewer.controls?.update();
  // Point the zoom target at where the camera now is, so the easing agrees with
  // the restore instead of undoing it.
  if (Number.isFinite(launchGlobeView.altitudeMetres)) {
    viewer.setZoomAltitudeMetres?.(launchGlobeView.altitudeMetres);
  }
  // Deliberately NOT cleared: this is the launch view, and every return to the
  // globe uses it. Clearing it meant the second trip had nothing to restore.
}

function modelFocus() {
  /**
   * THE STUDIO'S OWN MESHES, not every layer the import manager holds. The
   * GIS layers -- the launch defaults, the Model Builder's previews -- stay
   * registered and visible while Model mode is up, and they sit in the
   * globe's frame at the world origin; a box over them AND a terrain solid
   * anchored 6,371 km out had its centre halfway to the Earth's core.
   * Measured: the fit put the target at y = 3,187,423 on a model at
   * y = 6,371,000, and the camera 8,000 km away looking at nothing.
   */
  /**
   * AND ONLY WHAT IS ACTUALLY DRAWN. `object3D.visible` is the node's OWN
   * flag: model mode hides the whole `GeoID-ImportedGeoLayers` group, and
   * every GIS layer inside it still reports true. So on a fresh page -- the
   * launch defaults loaded, no model built yet -- `own` was empty, the
   * fallback framed the plate boundaries at the world origin, and Model mode
   * opened 6,371 km from the anchor looking at the Earth's centre: a black
   * viewport with a 2,000 km scale bar, which is what "the model page is
   * broken" was. A hidden ancestor means the layer is not on screen.
   */
  const drawn = (node) => {
    let o = node;
    while (o) { if (!o.visible) return false; o = o.parent; }
    return true;
  };
  const all = (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((l) => l.object3D && drawn(l.object3D));
  const own = all.filter((l) => studioMeshes.has(l.object3D) || l.object3D?.userData?.localModel);
  const layers = own.length ? own : all;
  if (!layers.length) return null;
  const box = new THREE.Box3();
  layers.forEach((l) => {
    /**
     * FROM THE ROOT DOWN. `updateMatrixWorld(true)` refreshes a node and its
     * DESCENDANTS from whatever its parent's matrix currently says -- and a
     * group added to the anchor in this same tick still carries the identity,
     * so every vertex boxed at the world ORIGIN and a fit on the first solid
     * flew the camera to the Earth's centre. `updateWorldMatrix(true, true)`
     * walks the ancestors first, which is the question being asked.
     */
    l.object3D.updateWorldMatrix(true, true);
    box.expandByObject(l.object3D);
  });
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) sphere.radius = MODEL_MODE_RADIUS;
  return sphere;
}

function viewAxis(axis) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera) return;
  const anchor = ensureModelAnchor();
  if (!anchor) return;
  // Frame the user's model, not the surface origin and not the sphere centre.
  // Falling back to the anchor keeps the axis buttons useful on an empty scene.
  const focus = modelFocus();
  const centre = focus ? focus.center : anchor.getWorldPosition(new THREE.Vector3());
  const d = focus
    ? Math.max(focus.radius * 2.6, MODEL_MODE_RADIUS * 0.5)
    : MODEL_MODE_RADIUS * 2;
  // Axis views are in the model's surface frame: X east, Y up, Z south.
  const local = {
    x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1],
    iso: [0.577, 0.577, 0.577],
  }[axis] || [0.577, 0.577, 0.577];
  const radialUp = centre.clone().normalize();
  const dir = new THREE.Vector3(local[0], local[1], local[2])
    .applyQuaternion(anchor.quaternion)
    .normalize();
  // "Up" stays radial in every view so the horizon reads level and orbiting
  // behaves the same from any starting view. Looking straight down that same
  // radial axis would make lookAt singular, so the plan view is tilted just off
  // vertical -- which is also why a true bird's-eye is never reachable.
  if (Math.abs(radialUp.dot(dir)) > Math.cos(MIN_POLAR_RAD)) {
    const south = new THREE.Vector3(0, 0, 1).applyQuaternion(anchor.quaternion);
    dir.copy(radialUp).multiplyScalar(Math.cos(MIN_POLAR_RAD))
      .addScaledVector(south, Math.sin(MIN_POLAR_RAD)).normalize();
  }
  const offset = dir.multiplyScalar(d);
  viewer.camera.position.copy(centre).add(offset);
  viewer.camera.up.copy(radialUp);
  applyCameraClip(viewer.camera, d);
  viewer.controls.target.copy(centre);
  viewer.controls.update();
  refreshGraticuleStep();
}

function fitView() {
  const viewer = window.GeoIDViewer;
  const sphere = modelFocus();
  if (!viewer?.camera || !sphere) return;
  const d = Math.max(sphere.radius * 2.6, 0.01);
  // The model sits out on the surface, so the camera is offset from the
  // model's own centre in its local frame. Positioning at absolute world
  // coordinates would drop the camera near the centre of the Earth.
  const anchor = ensureModelAnchor();
  const q = anchor ? anchor.quaternion : new THREE.Quaternion();
  const up = sphere.center.lengthSq() > 0
    ? sphere.center.clone().normalize()
    : new THREE.Vector3(0, 1, 0);
  const offset = new THREE.Vector3(0.6, 0.5, 0.6).applyQuaternion(q).multiplyScalar(d);
  viewer.camera.up.copy(up);
  viewer.camera.position.copy(sphere.center).add(offset);
  applyCameraClip(viewer.camera, d);
  viewer.controls.target.copy(sphere.center);
  viewer.controls.update();
  refreshGraticuleStep();
}

let clipPlane = null;

function applyClip() {
  const viewer = window.GeoIDViewer;
  const on = byId('[data-toggle="clip"]') || document.querySelector('[data-toggle="clip"]');
  const enabled = on?.classList.contains("is-on");
  const axis = byId("studio-clip-axis")?.value || "x";
  const t = Number(byId("studio-clip")?.value ?? 50) / 100;
  if (!viewer?.renderer) return;
  if (!enabled) {
    viewer.renderer.clippingPlanes = [];
    clipPlane = null;
    return;
  }
  const normal = axis === "x" ? new THREE.Vector3(-1, 0, 0)
    : axis === "y" ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1);
  const box = new THREE.Box3();
  (window.GeoIDImportManager?.getLayers?.() || []).forEach((l) => {
    if (l.object3D?.visible) box.expandByObject(l.object3D);
  });
  if (box.isEmpty()) return;
  const lo = axis === "x" ? box.min.x : axis === "y" ? box.min.y : box.min.z;
  const hi = axis === "x" ? box.max.x : axis === "y" ? box.max.y : box.max.z;
  clipPlane = new THREE.Plane(normal, lo + (hi - lo) * t);
  viewer.renderer.localClippingEnabled = true;
  viewer.renderer.clippingPlanes = [clipPlane];
}

// ── Wiring ──────────────────────────────────────────────────────────────────

const ACTIONS = {
  new: () => {
    state.solids.forEach((s) => s.object3D?.parent?.remove(s.object3D));
    state.solids.length = 0;
    state.fields.length = 0;
    state.points.length = 0;
    (state.pointParts || []).forEach((p) => p.mesh.parent?.remove(p.mesh));
    state.pointParts = [];
    state.atmosphere = { on: false, heightM: 0, baseZ: 0, entryId: null };
    state.nextVolumeFlag = 10;
    closePartCard();
    state.history.length = 0;
    state.selection.clear();
    state.mesh = null;
    studioMeshes.clear();
    refreshStudioScale();
    renderModelTree(); renderFields(); renderHistory(); renderSelection(); renderDomainsPanel();
    status("new model"); log("New model");
  },
  open: () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".msproj.json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        ACTIONS.new();
        (data.solids || []).forEach((s) => {
          addSolid(s.kind, s.op, s.params);
          const entry = state.solids[state.solids.length - 1];
          if (s.flags && entry) {
            if (Number(s.flags.volume) > 0) entry.flags.volume = Number(s.flags.volume);
            Object.entries(s.flags.faces || {}).forEach(([face, flag]) => { entry.flags.faces[face] = Number(flag); const p = entry.parts.find((q) => q.face === face); if (p) { p.flag = Number(flag); refreshPartRows(p); } });
          }
        });
        state.points = (data.points || []).map((p) => ({ ...p }));
        state.fields.length = 0; (data.fields || []).forEach((f) => state.fields.push({ ...f }));
        if (data.atmosphere?.on) { state.atmosphere = { ...state.atmosphere, ...data.atmosphere, entryId: null }; applyStudioAtmosphere(); }
        renderStudioPoints(); renderFields(); renderDomainsPanel(); renderModelTree();
        log(`Opened project with ${(data.solids || []).length} ops`);
      } catch (error) {
        log(`Open failed: ${error.message}`);
      }
    });
    input.click();
  },
  save: () => {
    downloadText("model.msproj.json", JSON.stringify({
      solids: state.solids.filter((s) => s.kind !== "atmosphere").map((s) => ({ kind: s.kind, op: s.op, params: s.params, flags: s.flags })),
      atmosphere: state.atmosphere.on ? { on: true, heightM: state.atmosphere.heightM, baseZ: state.atmosphere.baseZ, flags: state.atmosphere.flags || null } : null,
      points: state.points,
      fields: state.fields,
      history: state.history,
    }, null, 2), "application/json");
    log("Project saved");
  },
  undo: () => {
    const entry = state.solids[state.solids.length - 1];
    if (!entry) return;
    deleteEntities([entry.id]);
    record("undo");
    log("Undo");
  },
  redo: () => log("Redo: nothing to reapply"),
  "import-cad": () => document.getElementById("import-file-input")?.click(),
  "import-xyz": () => document.getElementById("import-file-input")?.click(),
  fuse: () => setOpOnSelection("union"),
  cut: () => setOpOnSelection("difference"),
  intersect: () => setOpOnSelection("intersect"),
  fragment: () => {
    log("Fragment: lattice meshing already conforms across shared interfaces");
    status("fragment is implicit");
  },
  transform: () => log("Transform: use the layer Style panel for scale and rotation"),
  delete: () => deleteEntities([...state.selection]),
  "export-script": exportScript,
  "export-package": () => { void exportPackage(); },
  "mesh-gmsh": meshWithGmsh,
  "to-gales": () => exportMesh("msh"),
  "to-explorer": () => {
    exportMesh("stl");
    log("Exported STL for the Earth viewer; import it in GIS mode to place it");
  },
  "save-template": () => {
    downloadText("template.json", JSON.stringify(
      state.solids.map((s) => ({ kind: s.kind, op: s.op, params: s.params })), null, 2,
    ), "application/json");
    log("Template saved");
  },
  snapshot: () => {
    const viewer = window.GeoIDViewer;
    if (!viewer?.renderer) return;
    viewer.renderer.render(viewer.scene, viewer.camera);
    const url = viewer.renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "studio_snapshot.png";
    a.click();
    log("Snapshot saved");
  },
};

function setOpOnSelection(op) {
  const picked = [...state.selection].map(findById).filter(Boolean);
  if (!picked.length) { log(`${op}: select an entity first`); return; }
  picked.forEach((entry) => { entry.op = op; });
  record(`${op} on ${picked.length}`);
  renderModelTree();
  log(`${op} applied to ${picked.map((e) => `Volume ${e.id}`).join(", ")}`);
}

function init() {
  if (!byId("model-studio")) return;
  renderPalette();
  renderParams();
  renderModelTree();
  renderFields();
  renderSelection();

  /**
   * A DECK IS AN ACCORDION, the GIS page's tab column: each pane is a
   * `toolbox-group` that opens in place, and opening one closes the others in
   * that deck so the column never becomes a wall. Which one is open is
   * remembered per deck.
   */
  /**
   * ONE OPEN PER BAND, not per deck. The mesh tabs joined the build tabs in
   * one column, and one-open-across-all-eight would have meant toggling back
   * and forth to press Mesh 3D on the model you have open. A band is Build or
   * Mesh, so a reader keeps one of each in view.
   */
  document.querySelectorAll("#model-studio .studio-group").forEach((group) => {
    group.addEventListener("toggle", () => {
      const band = group.dataset.band || "build";
      if (!group.open) {
        // Shutting the band's open tab is a decision too: leave the stored
        // name standing and the next load reopens the tab just put away.
        if (readFolds()[`band-${band}`] === group.dataset.group) writeFold(`band-${band}`, "");
        return;
      }
      document.querySelectorAll(`#model-studio .studio-group[data-band="${band}"]`).forEach((other) => {
        if (other !== group) other.open = false;
      });
      writeFold(`band-${band}`, group.dataset.group);
    });
  });
  // EVERY TAB ARRIVES SHUT -- the markup opens none, so a fresh deck is eight
  // names and nothing else. Only a remembered choice opens one.
  ["build", "mesh"].forEach((band) => {
    const want = readFolds()[`band-${band}`];
    if (!want) return;
    document.querySelectorAll(`#model-studio .studio-group[data-band="${band}"]`).forEach((g) => {
      g.open = g.dataset.group === want;
    });
  });

  document.querySelectorAll("#model-studio [data-act]").forEach((button) => {
    button.addEventListener("click", () => {
      const fn = ACTIONS[button.dataset.act];
      if (fn) fn();
      closeMenus();
    });
  });
  wireRibbonAndFolds();
  foldPaneSections();

  document.querySelectorAll("[data-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.toggle("is-on");
      const on = button.classList.contains("is-on");
      const which = button.dataset.toggle;
      if (which === "wireframe") {
        eachModelMaterial((m) => { m.wireframe = on; m.needsUpdate = true; });
      } else if (which === "edges") {
        eachModelMaterial((m) => { m.flatShading = on; m.needsUpdate = true; });
      } else if (which === "stars") {
        setStarsVisible(on);
      } else if (which === "grid") {
        setGroundVisible(on);
      } else if (which === "clip") {
        applyClip();
      } else if (which === "gizmo") {
        log(`Gizmo ${on ? "on" : "off"} — drag handles are not implemented yet`);
      }
    });
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const which = button.dataset.view;
      if (which === "fit") fitView(); else viewAxis(which);
    });
  });

  byId("studio-clip")?.addEventListener("input", applyClip);
  byId("studio-clip-axis")?.addEventListener("change", applyClip);

  byId("studio-origin-apply")?.addEventListener("click", () => {
    setStudioOrigin(
      byId("studio-origin-lat")?.value,
      byId("studio-origin-lon")?.value,
      byId("studio-origin-elev")?.value,
    );
    const info = getGroundInfo();
    const note = byId("studio-origin-note");
    if (note) {
      note.textContent = info.toScale
        ? `Anchored at ${studioOrigin.lat.toFixed(5)}, ${studioOrigin.lon.toFixed(5)} — globe is to scale.`
        : `Anchored at ${studioOrigin.lat.toFixed(5)}, ${studioOrigin.lon.toFixed(5)} — globe is representational `
          + `(${Math.round(info.metresPerUnit)} m per unit); model metres are unaffected.`;
    }
  });

  byId("studio-add")?.addEventListener("click", () => addSolid(state.kind, "union"));
  byId("studio-template-add")?.addEventListener("click", () => {
    const tpl = TEMPLATES[state.template];
    if (!tpl) { log("Choose a scenario first."); return; }
    const values = { ...defaultsOf(tpl), ...readParamRows("#studio-template-params [data-tparam]", "tparam") };
    Object.keys(values).forEach((k) => { if (typeof tpl.params[k][1] === "number") values[k] = Number(values[k]); });
    const parts = tpl.build(values);
    parts.forEach((entry) => addSolid(entry.kind, entry.op, entry.params));
    log(`Scenario "${tpl.label}" added as ${parts.length} entities: ${parts.map((e) => `${e.op} ${e.kind}`).join(", ")}.`);
  });
  byId("studio-mesh1d")?.addEventListener("click", () => meshModel(1));
  byId("studio-mesh2d")?.addEventListener("click", () => meshModel(2));
  byId("studio-mesh3d")?.addEventListener("click", () => meshModel(3));
  byId("studio-clear-mesh")?.addEventListener("click", () => {
    state.mesh = null;
    byId("studio-mesh-info").textContent = "No mesh.";
    byId("studio-quality").hidden = true;
    log("Mesh cleared");
  });
  byId("studio-suggest")?.addEventListener("click", () => {
    const b = combinedBounds();
    if (!b) { log("Suggest: empty model"); return; }
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
    const suggested = Number((span / 20).toPrecision(2));
    byId("studio-size-lo").value = String(suggested);
    byId("studio-size-hi").value = String(suggested * 2);
    log(`Suggested size ${suggested} from a ${span.toFixed(2)} extent`);
  });

  // The Refine pane speaks the builder's vocabulary: the type select lists it
  // and the fixed x/y/z/r rows of the old form stand down (each field's card
  // carries its own numbers).
  const typeSel = byId("studio-field-type");
  if (typeSel) {
    typeSel.innerHTML = "";
    Object.entries(FIELD_TYPES).filter(([k]) => k !== "slope").forEach(([k, meta]) => { const o = document.createElement("option"); o.value = k; o.textContent = meta.label; typeSel.appendChild(o); });
    ["x", "y", "z", "r", "dmin", "dmax"].forEach((k) => { byId(`studio-field-${k}`)?.closest(".studio-row")?.remove(); });
    byId("studio-field-remove")?.remove();
  }
  byId("studio-field-add")?.addEventListener("click", () => {
    const fld = studioDefaultField(byId("studio-field-type")?.value || "point");
    state.fields.push(fld);
    renderFields();
    log(`Added a size field: ${describeField(fld, Number(byId("studio-size-hi")?.value) || 1)}`);
  });

  byId("studio-label-apply")?.addEventListener("click", () => {
    const name = byId("studio-label-name").value.trim();
    if (!name || !state.selection.size) { log("Label: name and selection needed"); return; }
    state.groups.push({ name, entities: [...state.selection] });
    renderModelTree();
    log(`Labelled ${state.selection.size} entities as "${name}"`);
  });
  byId("studio-refine-sel")?.addEventListener("click", () => {
    const entry = [...state.selection].map(findById).filter(Boolean)[0];
    if (!entry) { log("Refine: select an entity"); return; }
    const b = entry.bounds;
    state.fields.push({
      id: `f${Date.now().toString(36)}`, type: "ball", on: true, name: `refine Volume ${entry.id}`,
      x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2,
      radiusM: Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2,
      sizeM: Number(byId("studio-size-min").value) || 0.25, sizeOutM: Number(byId("studio-size-max").value) || null,
      thicknessM: Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 4,
    });
    renderFields();
    log(`Refinement field added around Volume ${entry.id}`);
  });

  byId("studio-tf-auto")?.addEventListener("click", () => {
    const nodes = Number(byId("studio-tf-nodes").value) || 10;
    const b = combinedBounds();
    if (!b) { log("Transfinite: empty model"); return; }
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ);
    byId("studio-size-lo").value = String(Number((span / nodes).toPrecision(3)));
    byId("studio-structured-info").textContent =
      `Lattice set to ${nodes} nodes across the longest extent.`;
    log(`Auto transfinite: ${nodes} nodes across ${span.toFixed(2)}`);
  });
  ["studio-tf-surfaces", "studio-tf-volumes", "studio-recombine-sel"].forEach((id) => {
    byId(id)?.addEventListener("click", () => log(
      `${id.replace("studio-", "")}: the lattice mesher is structured by construction`,
    ));
  });

  ["msh", "stl", "obj", "ply"].forEach((fmt) => {
    byId(`studio-exp-${fmt}`)?.addEventListener("click", () => exportMesh(fmt));
  });

  byId("studio-ai")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const text = event.target.value.trim();
    if (!text) return;
    buildFromText(text);
    event.target.value = "";
  });

  const waitForViewer = () => {
    if (window.GeoIDViewer?.renderer) {
      installPicking();
      /**
       * The launch view, captured before anything can move the camera.
       *
       * Taking it at the first switch to Model instead would capture wherever
       * the user had already navigated to, which is exactly the arbitrary
       * starting point this is meant to replace. It is the first call that
       * wins, so this one is the one that counts.
       */
      rememberGlobeView();
      updateStudioContext();
      /**
       * The Research store loads on its own schedule, so subscribing is retried
       * rather than assumed. Without it the line would be right on arrival and
       * then go stale the moment a different project was opened.
       */
      (function subscribeToProject(tries = 0) {
        const store = window.GeoIDResearch?.store;
        if (store?.onChange) { store.onChange(updateStudioContext); updateStudioContext(); return; }
        if (tries < 40) setTimeout(() => subscribeToProject(tries + 1), 500);
      })();
      const startsInModel = window.GeoIDModeManager?.getMode?.() === "model";
      if (startsInModel) {
        // The capture above already ran, which is what a page restored straight
        // into Model mode needs: the mode-change event never fires on that
        // path, so nothing was saved and leaving for GIS left the camera
        // wherever the studio had put it -- straight up the +Y axis, which
        // renders as the north pole. Measured at (0, 11.6, 0), the locator
        // reading 66.56 degrees: 90 minus the 23.44 axial tilt.
        setStudioOrbitLimits(true);
      }
      // Only Model mode wants the studio's scene: it hides the starfield and
      // raises the ground. Running it unconditionally at startup stripped the
      // stars out of the GIS page, which never asked for either.
      if (startsInModel) {
        applyStudioScene();
      }
      if (startsInModel) {
        // Restoring Model mode from a previous session skips the mode-change
        // handler, so the camera keeps the globe viewer's position -- which is
        // deep inside the studio's ground sphere, and renders as a black or
        // banded screen. Frame it the same way entering the mode does.
        centreOnOrigin();
      }
      // Graticule spacing depends on the viewpoint, so it is refreshed as the
      // camera settles rather than only when the model changes.
      window.GeoIDViewer.controls?.addEventListener?.("change", refreshGraticuleStep);
      return;
    }
    requestAnimationFrame(waitForViewer);
  };
  waitForViewer();

  // Re-apply the studio's scene preferences whenever Model mode is entered,
  // since the other modes want the starfield back and the ground gone.
  window.addEventListener("geoid-gis:mode-change", (event) => {
    // THE GIS LAYERS ARE NOT THE STUDIO'S. Model mode hides the globe and
    // keeps the import groups (the studio's own meshes live in one), so every
    // georeferenced layer -- 150,000 lines of sampling mesh, the volcanic
    // buffers, the plate boundaries -- went on being drawn under a model
    // that cannot show where they are. Off while the studio is up, back as
    // they were on the way out.
    // AND THE OTHER WAY: the studio's meshes hang off its anchor, a scene
    // child the mode manager knows nothing about, so a terrain solid in
    // metres went on being drawn in GIS mode -- measured, three
    // `geoid_*` meshes visible under a globe of radius 3.2. The anchor is
    // the model page's and is shown with it.
    const anchor = ensureModelAnchor();
    if (anchor) anchor.visible = event.detail?.mode === "model";
    const geo = window.GeoIDViewer?.scene?.getObjectByName("GeoID-ImportedGeoLayers");
    if (geo) {
      if (event.detail?.mode === "model") { geoGroupWasVisible = geo.visible; geo.visible = false; }
      else if (geoGroupWasVisible !== null) { geo.visible = geoGroupWasVisible; geoGroupWasVisible = null; }
    }
    if (event.detail?.mode === "model") {
      rememberGlobeView();
      setStudioOrbitLimits(true);
      applyStudioScene();
      // COMING BACK TO A MODEL: the GIS page scales local models to its own
      // globe (`userData.baseScale`), so a terrain returned to the studio
      // was 0.0003 of its size -- measured, a 16 km block in a 6 m box --
      // and centring on the origin framed nothing. The studio's meshes are
      // put back to their metres and the view fitted to them.
      // AFTER the mode switch has finished, not during it: this listener runs
      // in the middle of `setMode`, and what runs after it -- the GIS side's
      // own re-scaling of local models, the viewer's zoom easing picking the
      // camera back up -- undid a fit made here. Measured: fitted to 31 km,
      // read back at 12 m. One tick later the scene is at rest.
      setTimeout(() => {
        // And the globe's pending zoom must not ease this camera: measured,
        // a fit to 31 km walked back to 12 m over the next second.
        window.GeoIDViewer?.clearZoomTarget?.();
        refreshStudioScale();
        if (state.solids.length) fitView(); else centreOnOrigin();
      }, 0);
      updateStudioContext();
    } else {
      /**
       * Leaving the studio for a globe means leaving for THAT world's globe.
       *
       * Switching worlds in Model mode is a radius, not a navigation — the page
       * stays put, which is the point. But the globe of another world is a
       * different page, so if the studio was moved somewhere else, this is the
       * moment to go there. Without it you always landed back on whichever
       * viewer you happened to open, whatever the strip was showing.
       *
       * `currentBodyId()` reads the page, `studioBody()` reads the studio; they
       * agree unless the strip was used in Model mode.
       */
      const wanted = studioBody();
      if (wanted && wanted.id !== currentBodyId() && wanted.path) {
        const built = state.solids.length + state.fields.length;
        if (!built || window.confirm(
          `Opening the ${wanted.name} globe will load a new page and discard `
          + `this model (${built === 1 ? "1 object" : `${built} objects`}). `
          + "Export it first if you want to keep it.\n\nOpen anyway?")) {
          window.location.assign(wanted.path);
          return;
        }
        // Declined: stay, and put the studio back on this page's world so the
        // strip is not left claiming somewhere we are not going.
        setStudioBody(currentBodyId());
      }
      setStudioOrbitLimits(false);
      setStarsVisible(true);
      setGroundVisible(false);
      restoreGlobeView();
      updateCoordinateReadout(null);
      // The globe drives both readouts in its own modes; clear the studio's
      // last values so nothing stale is left on screen through the handover.
      window.GeoIDViewer?.hideScaleBar?.();
    }
  });

  log("Meshing Studio ready — click a volume to select, Ctrl-click to add, right-click for Hide/Delete");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/**
 * Take a study area from the GIS page: anchor there, and stand the ground up.
 *
 * This is the missing half of the pipeline — `setStudioOrigin` and
 * `wgs84ToEnu` were built and never called, so a model had no way to know
 * where on Earth it was. `sendToStudio` on the bridge calls this.
 *
 * The elevation sampler is the viewer's own (`sampleElevationMeters`), so the
 * ground under the model is the SAME terrain the globe draws — not a second
 * DEM path that could disagree with it. Heights are taken relative to the
 * origin, so the anchor sits at y = 0 whatever the absolute elevation is, and
 * scaled by `studioScale` like every other metre in the scene.
 *
 * Sampling is memoised per patch build: a 128x192 patch is ~25k lookups and
 * the same rings are rebuilt whenever the camera pulls back.
 */
export function adoptStudyArea({ lat, lon, elevation, radiusM, terrain = true } = {}) {
  const sampler = terrain ? window.GeoIDViewer?.sampleElevationMeters : null;
  const originHeight = sampler
    ? (sampler(Number(lat), ((Number(lon) % 360) + 360) % 360) || 0)
    : 0;
  groundElevation = sampler
    ? (east, north) => {
      const point = enuToWgs84(east, north, 0);
      // The viewer carries east-positive 0..360; a signed longitude read
      // straight from a study area would sample the wrong hemisphere.
      const lon360 = ((point.lon % 360) + 360) % 360;
      const height = sampler(point.lat, lon360);
      return Number.isFinite(height) ? (height - originHeight) * studioScale : 0;
    }
    : null;
  setStudioOrigin(lat, lon, elevation === undefined ? originHeight : elevation);
  // A study area is a size as well as a place: reaching past it once means the
  // first view shows the ground the analysis was done on.
  if (radiusM > 0) {
    patchRadius = 0;      // force a rebuild at the new reach
    updateGround();
  }
  log(groundElevation
    ? `Anchored on the study area with real terrain (${Math.round(radiusM || 0)} m across).`
    : "Anchored on the study area; ground is the analytic sphere.");
  return { lat: studioOrigin.lat, lon: studioOrigin.lon, terrain: Boolean(groundElevation) };
}

/** Moves the model's surface anchor to a new WGS84 origin. */
function setStudioOrigin(lat, lon, elevation = studioOrigin.elevation) {
  studioOrigin.lat = Number(lat) || 0;
  studioOrigin.lon = Number(lon) || 0;
  studioOrigin.elevation = Number(elevation) || 0;
  updateGround();
  centreOnOrigin();
  log(`Origin set to ${studioOrigin.lat.toFixed(5)}, ${studioOrigin.lon.toFixed(5)}`);
}

/**
 * THE GIS PACKAGE AS A SOLID. The Model Builder hands over its surface -- a
 * TIN or a grid, in the study's own local metres -- and it becomes one or two
 * entities here: the SUBSURFACE (ground down to a base) and, if asked for, the
 * ATMOSPHERE (ground up to a sky). Each is an inside-test against the
 * heightfield, which is what the studio's mesher and booleans work on, and a
 * displayed shell built from the SAME facets the STL was written with.
 *
 * 1 UNIT = 1 METRE, because that is the studio's own scale: its ground is the
 * planet's surface to scale (`getGroundInfo().metresPerUnit` is 1), so a
 * terrain handed over in kilometres sat as a sixteen-METRE model on a
 * planet-sized ground -- measured, the scale bar read 2,000 km across the
 * grid. The display normalises the whole model to the studio radius anyway,
 * so only the ground and the mesher's cell size care, and both want metres.
 * The mesher's size fields are set from the surface's own coarse spacing on
 * adoption, since the presets' 0.5-1 would be half-metre cells over a
 * sixteen-kilometre box. The depth and height are the extend-boundary
 * decision (etna.py's outer_box), and the card this adds lets them be
 * changed on this page without going back to the GIS.
 */
// (`gisTerrain` and `geoGroupWasVisible` are declared beside `state` at the top:
// `init()` runs at module end and now reads them, and a `let` below that call is a TDZ.)

/** The frame both pages compute lat/lon through: the surface's, or the section's. */
function terrainFrame() {
  return gisTerrain?.surface?.frame || gisTerrain?.frame || null;
}

/** Ground height at a local (x, y): the TIN for a 3D terrain, the profile for a section. */
function terrainHeightAt(x, y) {
  if (gisTerrain?.surface) return tinHeightAt(gisTerrain.surface, x, y);
  const p = gisTerrain?.profile;
  if (!p) return null;
  const sM = (x - p.start.x) * p.dir.x + (y - p.start.y) * p.dir.y;
  if (sM < 0 || sM > p.lengthM) return null;
  return profileHeightAt(p, sM);
}

/** Take the previous terrain's entities and parts off the page before another is adopted. */
function clearTerrain() {
  if (gisTerrain?.entries?.length) {
    deleteEntities(gisTerrain.entries.map((e) => e.id).filter((id) => findById(id)));
  }
  (gisTerrain?.parts || []).filter((p) => p.solidId === null).forEach((p) => {
    const m = p.mesh;
    m.parent?.remove(m);
    m.geometry?.dispose?.();
    studioMeshes.delete(m);
    const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.object3D === m);
    if (layer) window.GeoIDImportManager.removeLayer(layer.id);
  });
  closePartCard();
}

/**
 * A 2D CROSS-SECTION AS A MODEL. The Model Builder hands over a PROFILE --
 * the DEM sampled along a line A-B -- and the subsurface and the atmosphere
 * arrive as FACES in the vertical plane through that line, sharing the
 * profile as one edge, rather than as volumes. Same frame as the 3D
 * package (local east/north metres about the study centre, z above sea
 * level), same flags, same parts and cards, same Domains panel; what
 * differs is that a face has no inside, so each domain's "solid" here is
 * a thin slab -- one sample step thick -- about the plane, which is what
 * lets the studio's 3D mesher and the inside-tests still have something
 * to answer about. The 2D gmsh script in the package is the real product.
 */
export function adoptSectionModel({ name = "gis_section", profile, belowM = 0, aboveM = 0, origin = null, points = [], flags = null } = {}) {
  if (!profile?.n || !profile?.frame) { log("GIS section: no profile to adopt."); return null; }
  clearTerrain();
  gisTerrain = {
    name, kind: "section", surface: null, profile, frame: profile.frame,
    belowM: Number(belowM) || 0, aboveM: Number(aboveM) || 0, entries: [], points, flags, parts: [],
  };
  if (origin && Number.isFinite(origin.lat)) {
    adoptStudyArea({ lat: origin.lat, lon: origin.lon, elevation: 0, radiusM: Math.max(profile.lengthM / 2, 1000), terrain: false });
  }
  const polys = sectionPolygons(profile, { belowM: gisTerrain.belowM, aboveM: gisTerrain.aboveM });
  gisTerrain.flags = { terrain: 1, base: 2, sky: 4, sides_below: 5, sides_above: 6, subsurface: 10, atmosphere: 11, points: 20, ...(flags || {}) };
  const F = gisTerrain.flags;
  const half = Math.max(profile.stepM, 1) / 2;
  const nx = -profile.dir.y; const ny = profile.dir.x;
  const lengthKm = (profile.lengthM / 1000).toFixed(2);
  const addPart = (part) => { gisTerrain.parts.push(part); return part; };
  const inRing = (ring, sM, zM) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [si, zi] = ring[i]; const [sj, zj] = ring[j];
      if ((zi > zM) !== (zj > zM) && sM < ((sj - si) * (zM - zi)) / (zj - zi) + si) inside = !inside;
    }
    return inside;
  };
  const make = (which, ring, extentM) => {
    if (!ring) return;
    const below = which === "subsurface";
    const id = state.solids.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    const group = new THREE.Group();
    group.name = `${name}_${which}`;
    const colour = below ? 0xa8703f : 0x7fc8ff;
    const positions = sectionPositions(profile, ring, 1);
    const mesh = below
      ? displayMesh(positions, `${name}_${which}_face`, colour)
      : displayMesh(positions, `${name}_${which}_face`, colour, { opacity: 0.35, renderOrder: 2 });
    group.add(mesh);
    const lidZ = below ? polys.baseZ : polys.skyZ;
    addPart({
      id: `${which}:face`, name: `${which === "subsurface" ? "Subsurface" : "Atmosphere"} — face`, kind: "face",
      which, face: "face", flag: below ? F.subsurface : F.atmosphere, mesh, solidId: id, colour, domain: which,
      rows: [
        ["What", below
          ? `The rock face of the section: from the profile down to a flat base ${Math.round(extentM)} m under the lowest ground`
          : `The air face of the section: from the profile up to a flat sky ${Math.round(extentM)} m over the highest ground`],
        ["Physical flag", `${below ? F.subsurface : F.atmosphere} — gmsh physical SURFACE "${which}" in the 2D script`],
        ["Edges", below
          ? `top ${F.terrain} (the profile), base ${F.base}, sides ${F.sides_below}`
          : `top ${F.terrain} (the profile), sky ${F.sky}, sides ${F.sides_above}`],
        ["Elevation", `${Math.round(below ? lidZ : profile.zMin)} to ${Math.round(below ? profile.zMax : lidZ)} m`],
        ["Length", `${lengthKm} km along A–B`],
        ["Triangles", (positions.length / 9).toLocaleString()],
      ],
    });
    const anchorNode = ensureModelAnchor();
    if (anchorNode) anchorNode.add(group);
    const test = (q) => {
      const dx = q[0] - profile.start.x; const dy = q[1] - profile.start.y;
      const off = dx * nx + dy * ny;
      if (Math.abs(off) > half) return false;
      const sM = dx * profile.dir.x + dy * profile.dir.y;
      if (sM < 0 || sM > profile.lengthM) return false;
      return inRing(ring, sM, q[2]);
    };
    const xs = [profile.start.x, profile.start.x + profile.dir.x * profile.lengthM];
    const ys = [profile.start.y, profile.start.y + profile.dir.y * profile.lengthM];
    const entry = {
      id, kind: "gis_terrain", op: "union", enabled: true,
      params: { label: `GIS section — ${which}`, which, extent_km: extentM, name },
      test, region: null, object3D: group,
      bounds: {
        minX: Math.min(...xs) - half, maxX: Math.max(...xs) + half,
        minY: Math.min(...ys) - half, maxY: Math.max(...ys) + half,
        minZ: below ? lidZ : profile.zMin, maxZ: below ? profile.zMax : lidZ,
      },
    };
    state.solids.push(entry);
    gisTerrain.entries.push(entry);
    record(`union gis section ${which}`);
  };
  make("subsurface", polys.rock, gisTerrain.belowM);
  make("atmosphere", polys.air, gisTerrain.aboveM);
  // The profile itself: a thin ribbon standing in the plane, so the line
  // the DEM was read along is a thing to point at, in the surface's green.
  const ribbonW = Math.max(profile.stepM / 4, 2);
  const ribbon = [];
  for (let i = 0; i < profile.n - 1; i += 1) {
    const a = [profile.xs[i], profile.ys[i], profile.z[i]];
    const b = [profile.xs[i + 1], profile.ys[i + 1], profile.z[i + 1]];
    const a1 = [a[0] + nx * ribbonW, a[1] + ny * ribbonW, a[2]]; const a2 = [a[0] - nx * ribbonW, a[1] - ny * ribbonW, a[2]];
    const b1 = [b[0] + nx * ribbonW, b[1] + ny * ribbonW, b[2]]; const b2 = [b[0] - nx * ribbonW, b[1] - ny * ribbonW, b[2]];
    ribbon.push(...a1, ...b1, ...b2, ...a1, ...b2, ...a2);
  }
  gisTerrain.skin = displayMesh(Float32Array.from(ribbon), `${name}_profile`, 0x6fbf73, { renderOrder: 1 });
  addPart({
    id: "surface", name: "Profile — the ground along A–B", kind: "surface", flag: F.terrain, mesh: gisTerrain.skin, solidId: null, colour: 0x6fbf73, domain: "surface", face: "ground",
    rows: [
      ["What", "The DEM sampled along the line: the rock face's top edge and the air face's floor, flag 1 on both"],
      ["Physical flag", `${F.terrain} — "top" curves and their points in the 2D script`],
      ["Samples", `${profile.n.toLocaleString()} (one every ${Math.round(profile.stepM)} m)`],
      ["Elevation", `${Math.round(profile.zMin)} to ${Math.round(profile.zMax)} m (relief ${Math.round(profile.reliefM)} m)`],
      ["Length", `${lengthKm} km`],
      ["Ends", `A ${profile.a.lat.toFixed(4)}°, ${profile.a.lon.toFixed(4)}° → B ${profile.b.lat.toFixed(4)}°, ${profile.b.lon.toFixed(4)}°`],
    ],
  });
  const pointR = Math.max(10, profile.stepM / 3);
  (points || []).forEach((p, i) => {
    const geo = new THREE.SphereGeometry(pointR, 12, 8).toNonIndexed();
    const pos = geo.getAttribute("position").array;
    for (let k = 0; k < pos.length; k += 3) { pos[k] += p.x; pos[k + 1] += p.y; pos[k + 2] += p.z; }
    geo.dispose();
    const mesh = displayMesh(Float32Array.from(pos), `${name}_point_${p.name}`, 0xffd166, { renderOrder: 3 });
    addPart({
      id: `point:${i}`, name: `Point — ${p.name}`, kind: "point", flag: p.flag ?? F.points, mesh, solidId: null, colour: 0xffd166, domain: "points", face: p.name,
      rows: [
        ["What", `An embedded point: the 2D mesh gets a node exactly here (from ${p.layer || "the study"})`],
        ["Position", `${Number(p.lat).toFixed(5)}°, ${Number(p.lon).toFixed(5)}°`],
        ["Along the line", `${Math.round(p.s ?? 0)} m from A`],
        ["Ground", `${Math.round(p.groundZ ?? (p.z + (p.depthM || 0)))} m (the profile's interpolated height)`],
        ["Depth", `${Number(p.depthM || 0)} m below the surface`],
        ["Physical flag", `${p.flag ?? F.points} — gmsh embeds it in the face and tags it`],
      ],
    });
  });
  renderModelTree();
  status(`${state.solids.length} entities`);
  const lo = byId("studio-size-lo");
  const hi = byId("studio-size-hi");
  const coarse = Math.max(1, Math.round(profile.stepM * 2));
  if (lo && !(Number(lo.value) >= coarse / 4)) lo.value = String(coarse);
  if (hi && !(Number(hi.value) >= coarse / 2)) hi.value = String(coarse * 2);
  log(`GIS section "${name}": ${profile.n.toLocaleString()} samples over ${lengthKm} km (one every ${Math.round(profile.stepM)} m),`
    + ` elevation ${Math.round(profile.zMin)} to ${Math.round(profile.zMax)} m. A 2D model: brown is the rock face, translucent blue the air face, green the profile.`
    + ` Each face stands in the vertical plane through A–B; as solids here they are one sample step thick.`
    + ` 1 unit = 1 m, z above sea level, in the GIS study's own local frame about ${profile.origin.lat.toFixed(5)}, ${profile.origin.lon.toFixed(5)}.`
    + ` Subsurface ${gisTerrain.belowM} m below the lowest ground${gisTerrain.aboveM > 0 ? `, atmosphere ${gisTerrain.aboveM} m above the highest` : ""}.`
    + `${points?.length ? ` ${points.length} embedded point(s) carried.` : ""}`);
  ensureTerrainCard();
  renderDomainsPanel();
  showGroup("model");
  fitView?.();
  return gisTerrain;
}

export function adoptTerrainSolid({ name = "gis_terrain", surface, belowM = 0, aboveM = 0, origin = null, points = [], flags = null } = {}) {
  if (!surface?.tris?.length) { log("GIS terrain: no surface to adopt."); return null; }
  clearTerrain();
  gisTerrain = { name, surface, belowM: Number(belowM) || 0, aboveM: Number(aboveM) || 0, entries: [], points, flags };
  /**
   * THE STUDIO'S GROUND IS THE MODEL'S FLOOR. The ground is an opaque sphere
   * tangent to z = 0 and the camera is held above it, so anything under z = 0
   * can never be seen -- and a subsurface is, by definition, all under the
   * ground. Anchored at sea level the whole 4 km of rock was clipped away.
   * So the model is SHIFTED: its base (the subsurface's lid, or the lowest
   * ground when there is no subsurface) becomes z = 0, the origin is told
   * that elevation so lat/lon/height readouts stay true, and the GIS
   * package's absolute metres are untouched -- this is display, and the log
   * says what z is measured from.
   */
  // TRUE elevations: z is metres above sea level and the studio's ground IS
  // sea level. The model was briefly shifted so its base sat at z = 0, which
  // was working around the camera floor rather than fixing it; the floor now
  // follows the model (`applyBelowGround`), so the shift is gone.
  const baseZ = Number(belowM) > 0 ? surface.zMin - Number(belowM) : surface.zMin;
  const zShift = 0;
  if (origin && Number.isFinite(origin.lat)) {
    adoptStudyArea({ lat: origin.lat, lon: origin.lon, elevation: 0, radiusM: Math.max(surface.widthM, surface.heightM) / 2, terrain: false });
  }
  const km = 1;
  const lifted = (positions) => { for (let i = 2; i < positions.length; i += 3) positions[i] += zShift * km; return positions; };
  /**
   * WHAT IS DRAWN IS A STAND-IN; WHAT IS TESTED IS THE SURFACE. A variable
   * TIN puts most of its 95,000 triangles inside a buffer a kilometre wide,
   * and the studio drew it three times over (rock top, skin, air floor) --
   * 286,000 triangles, DoubleSide, on a machine that may be rendering in
   * software. The inside-tests read the real TIN; the display reads it
   * resampled onto a 129 x 129 grid: 33,000 triangles a copy, and the relief
   * at 16 km still reads.
   */
  const display = surface.triangles > 40000 ? gridAsTin(tinToGrid(surface, { nx: 129, ny: 129 })) : surface;
  const heightKm = (x, y) => {
    const h = tinHeightAt(surface, x / km, y / km);
    return h === null ? null : (h + zShift) * km;
  };
  const plan = {
    minX: surface.x0 * km, maxX: (surface.x0 + surface.widthM) * km,
    minY: surface.y0 * km, maxY: (surface.y0 + surface.heightM) * km,
  };
  gisTerrain.parts = [];
  gisTerrain.flags = { terrain: 1, base: 2, sky: 4, sides_below: 5, sides_above: 6, subsurface: 10, atmosphere: 11, points: 20, ...(flags || {}) };
  const F = gisTerrain.flags;
  const extentKm = [(surface.widthM / 1000).toFixed(1), (surface.heightM / 1000).toFixed(1)];
  const addPart = (part) => { gisTerrain.parts.push(part); return part; };
  const make = (which, extentM) => {
    const below = which === "subsurface";
    const lidKm = below ? (surface.zMin - extentM + zShift) * km : (surface.zMax + extentM + zShift) * km;
    const test = (q) => {
      if (q[0] < plan.minX || q[0] > plan.maxX || q[1] < plan.minY || q[1] > plan.maxY) return false;
      const h = heightKm(q[0], q[1]);
      if (h === null) return false;
      return below ? (q[2] <= h && q[2] >= lidKm) : (q[2] >= h && q[2] <= lidKm);
    };
    /**
     * A DOMAIN IS ITS FACES, and every face is a thing somebody can point
     * at: the rock is a top (the ground), a base and its sides; the air is a
     * sky and its sides (its floor IS the ground the skin shows). Each face
     * is its own mesh with its own Workspace row, its own visibility, its
     * physical flag and a card that says what it is -- the boundary a
     * condition in step 5 names. "The whole model should be interactive and
     * customisable" is this: nothing on the model is one undivided lump.
     * The rock is opaque and earthen, the air a translucent sky drawn last,
     * and the surface STL is drawn once more as a lit green skin (below).
     */
    const id = state.solids.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    const group = new THREE.Group();
    group.name = `${name}_${which}`;
    /**
     * NO SEPARATE ROCK TOP. The ground is ONE mesh -- the surface STL --
     * shared by the rock (its top) and the air (its floor). Drawing the
     * rock's own copy of the same triangles under the skin was a coplanar
     * pair held apart by polygon offset, and whichever won the depth test
     * "took precedence" wherever the offset lost. One mesh, nothing to fight.
     */
    const faces = below
      ? [["base", "lid", 0x8a5a30, F.base, `A flat floor ${Math.round(extentM)} m under the lowest ground`],
         ["sides", "wall", 0xa8703f, F.sides_below, "The skirt walls: the rock's lateral boundary, one flag for all four"]]
      : [["sky", "lid", 0x9fd8ff, F.sky, `A flat lid ${Math.round(extentM)} m over the highest ground`],
         ["sides", "wall", 0x7fc8ff, F.sides_above, "The air's lateral boundary, one flag for all four sides"]];
    faces.forEach(([face, keep, colour, flag, blurb]) => {
      const positions = lifted(shellPositions(display, below ? { belowM: extentM } : { aboveM: extentM }, km, (f) => f.face === keep));
      const mesh = below
        ? displayMesh(positions, `${name}_${which}_${face}`, colour)
        : displayMesh(positions, `${name}_${which}_${face}`, colour, { opacity: 0.22, renderOrder: 2 });
      group.add(mesh);
      addPart({
        id: `${which}:${face}`, name: `${which === "subsurface" ? "Subsurface" : "Atmosphere"} — ${face}`, kind: "face",
        which, face, flag, mesh, solidId: id, colour, domain: which,
        rows: [
          ["What", blurb],
          ["Physical flag", `${flag} — gmsh physical group "${face}"; a condition in step 5 names this face`],
          ["Domain", `${which} (volume flag ${below ? F.subsurface : F.atmosphere})`],
          ["Elevation", face === "top" ? `${Math.round(surface.zMin)} to ${Math.round(surface.zMax)} m` : (face === "base" || face === "sky") ? `${Math.round(lidKm / km - zShift)} m` : `${Math.round(below ? surface.zMin - extentM : surface.zMin)} to ${Math.round(below ? surface.zMax : surface.zMax + extentM)} m`],
          ["Extent", `${extentKm[0]} × ${extentKm[1]} km`],
          ["Triangles", (positions.length / 9).toLocaleString()],
        ],
      });
    });
    const anchorNode = ensureModelAnchor();
    if (anchorNode) anchorNode.add(group);
    const entry = {
      id, kind: "gis_terrain", op: "union", enabled: true,
      params: { label: `GIS terrain — ${which}`, which, extent_km: extentM * km, name },
      test, region: null, object3D: group,
      bounds: { ...plan, minZ: below ? lidKm : (surface.zMin + zShift) * km, maxZ: below ? (surface.zMax + zShift) * km : lidKm },
    };
    state.solids.push(entry);
    gisTerrain.entries.push(entry);
    record(`union gis terrain ${which}`);
  };
  if (gisTerrain.belowM > 0) make("subsurface", gisTerrain.belowM);
  if (gisTerrain.aboveM > 0) make("atmosphere", gisTerrain.aboveM);
  // The surface STL, as itself: not a solid (it has no inside), a skin drawn a
  // hair above the interface so it wins the depth fight with the rock's top.
  gisTerrain.skin = displayMesh(lifted(surfacePositions(display, km)), `${name}_surface`, 0x6fbf73);
  addPart({
    id: "surface", name: "Surface — the rock's top, the air's floor", kind: "surface", flag: F.terrain, mesh: gisTerrain.skin, solidId: null, colour: 0x6fbf73, domain: "surface", face: "ground",
    rows: [
      ["What", "The terrain the GIS page sampled: one mesh, the rock's top and the air's floor, flag 1 on both"],
      ["Physical flag", `${F.terrain} — "top" on the rock, the floor of the air`],
      ["Nodes", surface.nodes.toLocaleString()],
      ["Triangles", `${surface.triangles.toLocaleString()}${display !== surface ? ` (drawn from a ${display.triangles.toLocaleString()}-triangle stand-in)` : ""}`],
      ["Spacing", `${Math.round(surface.spacingMinM)} to ${Math.round(surface.spacingMaxM)} m`],
      ["Elevation", `${Math.round(surface.zMin)} to ${Math.round(surface.zMax)} m`],
      ["Extent", `${extentKm[0]} × ${extentKm[1]} km`],
    ],
  });
  /**
   * THE EMBEDDED POINTS, as things: a small sphere each, at the node the
   * mesh will have there, with a card that says where it is and how deep.
   */
  const pointR = Math.max(20, surface.spacingMaxM / 6);
  (points || []).forEach((p, i) => {
    const geo = new THREE.SphereGeometry(pointR, 12, 8).toNonIndexed();
    const pos = geo.getAttribute("position").array;
    for (let k = 0; k < pos.length; k += 3) { pos[k] += p.x * km; pos[k + 1] += p.y * km; pos[k + 2] += (p.z + zShift) * km; }
    geo.dispose();
    const mesh = displayMesh(Float32Array.from(pos), `${name}_point_${p.name}`, 0xffd166, { renderOrder: 3 });
    addPart({
      id: `point:${i}`, name: `Point — ${p.name}`, kind: "point", flag: p.flag ?? F.points, mesh, solidId: null, colour: 0xffd166, domain: "points", face: p.name,
      rows: [
        ["What", `An embedded point: the mesh gets a node exactly here (from ${p.layer || "the study"})`],
        ["Position", `${Number(p.lat).toFixed(5)}°, ${Number(p.lon).toFixed(5)}°`],
        ["Ground", `${Math.round(p.groundZ ?? (p.z + (p.depthM || 0)))} m (the surface's interpolated height)`],
        ["Depth", `${Number(p.depthM || 0)} m below the surface`],
        ["Node", `z = ${Math.round(p.z)} m; local x ${Math.round(p.x)}, y ${Math.round(p.y)} m`],
        ["Physical flag", `${p.flag ?? F.points} — gmsh embeds it in the volume and tags it`],
      ],
    });
  });
  renderModelTree();
  status(`${state.solids.length} entities`);
  // Cells the size of the surface's coarse spacing: the mesher's own default
  // (0.5 to 1) is half a metre here.
  const lo = byId("studio-size-lo");
  const hi = byId("studio-size-hi");
  const coarse = Math.max(1, Math.round(surface.spacingMaxM || 100));
  if (lo && !(Number(lo.value) >= coarse / 4)) lo.value = String(coarse);
  if (hi && !(Number(hi.value) >= coarse / 2)) hi.value = String(coarse * 2);
  log(`GIS terrain "${name}": ${surface.nodes.toLocaleString()} nodes, ${surface.triangles.toLocaleString()} triangles,`
    + ` spacing ${Math.round(surface.spacingMinM)}–${Math.round(surface.spacingMaxM)} m; 1 unit = 1 m, mesh cells set to ${coarse}–${coarse * 2} m.`
    + ` Brown is the rock, green the surface STL, translucent blue the air${display !== surface ? ` (drawn from a ${display.triangles.toLocaleString()}-triangle stand-in; the volumes test the full surface)` : ""}.`
    + ` z is metres above sea level; the base is at ${Math.round(baseZ)} m. Coordinates are the GIS frame's own: local east/north metres about ${origin ? `${origin.lat.toFixed(5)}, ${origin.lon.toFixed(5)}` : "the study centre"}.`
    + ` Subsurface ${gisTerrain.belowM} m below the lowest ground${gisTerrain.aboveM > 0 ? `, atmosphere ${gisTerrain.aboveM} m above the highest` : ""}.`
    + `${points?.length ? ` ${points.length} embedded point(s) carried.` : ""}`);
  ensureTerrainCard();
  renderDomainsPanel();
  // The domains live in the Model tab; bring it up so the toggles are seen.
  showGroup("model");
  fitView?.();
  return gisTerrain;
}

/* ── The parts: a list with a visibility toggle each, and a card on click ── */

function partAt(clientX, clientY) {
  const parts = allParts();
  if (!parts.length) return null;
  const viewer = window.GeoIDViewer;
  const canvas = viewer.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, viewer.camera);
  const meshes = parts.map((p) => p.mesh).filter((m) => m && m.visible && m.parent);
  const hits = raycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;
  // An opaque face under a translucent one is what was pointed at.
  const solid = hits.find((h) => !(h.object.material?.transparent && h.object.material.opacity < 1));
  const hit = solid || hits[0];
  return parts.find((p) => p.mesh === hit.object) || null;
}

function partVisible(part, on) {
  part.mesh.visible = on;
  part.hidden = !on;
  // The Workspace row is the other door to the same state.
  const layer = (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.object3D === part.mesh);
  if (layer && window.GeoIDLayerHierarchy?.setVisible) {
    try { window.GeoIDLayerHierarchy.setVisible(layer.id, on); } catch (e) { /* the mesh flag stands */ }
  }
}

/**
 * THE DOMAINS PANEL, in the GIS sidebar's own idiom: one collapsible
 * section per domain -- Subsurface, Atmosphere, Surface, Embedded points --
 * with a master tick in its head (three states, like a Live-events group)
 * and a row per face or point beneath, each a tick, a swatch, its flag and
 * an ⓘ for the card. It sits at the top of the Model tab, where the
 * entities are. A flat list at the foot of the Add tab was the wrong shape
 * and the wrong place, and was reported as such.
 */
const domainOpen = new Map();

function renderDomainsPanel() {
  const pane = document.querySelector('.studio-pane[data-pane="model"]');
  if (!pane) return;
  let host = byId("studio-domains");
  if (!host) {
    host = document.createElement("div");
    host.id = "studio-domains";
    host.style.cssText = "display:grid;gap:0.5rem;margin-bottom:0.6rem";
    pane.insertBefore(host, pane.firstChild);
  }
  host.innerHTML = "";
  const parts = allParts();
  host.hidden = !parts.length;
  if (!parts.length) return;
  const F = gisTerrain?.flags || { subsurface: 10, atmosphere: 11, terrain: 1, points: 20 };
  const domains = [];
  if (gisTerrain?.parts?.length) {
    domains.push(["subsurface", "Subsurface", F.subsurface], ["atmosphere", "Atmosphere", F.atmosphere],
      ["surface", "Surface", F.terrain], ["points", "Embedded points", F.points]);
  }
  state.solids.forEach((e) => {
    if (!e.parts?.length) return;
    const label = e.kind === "atmosphere" ? "Atmosphere" : `Volume ${e.id} · ${PRIMITIVES[e.kind]?.label ?? e.kind}${e.op === "difference" ? " (cut)" : ""}`;
    domains.push([`solid:${e.id}`, label, e.flags?.volume, e]);
  });
  if (state.pointParts?.length) domains.push(["spoints", "Embedded points", 20]);
  domains.forEach(([id, title, flag, solid]) => {
    const own = parts.filter((p) => p.domain === id);
    if (!own.length) return;
    const details = document.createElement("details");
    details.className = "gis-tool-section";
    // Collapsed until it is asked for: a domain is four to eight rows and a
    // column of every domain open is a wall rather than a list.
    details.open = domainOpen.get(id) ?? false;
    details.addEventListener("toggle", () => domainOpen.set(id, details.open));
    const summary = document.createElement("summary");
    summary.style.cssText = "display:flex;align-items:center;gap:0.5rem";
    // The shared icon painter's documented skip: a domain head carries a tick
    // and a name, and its fallback bracket is furniture in a 16rem deck.
    summary.dataset.toolIcon = "1";
    const master = document.createElement("input");
    master.type = "checkbox";
    const shown = own.filter((p) => p.mesh.visible !== false).length;
    master.checked = shown === own.length;
    master.indeterminate = shown > 0 && shown < own.length;
    master.title = "Show or hide the whole domain";
    master.addEventListener("click", (event) => {
      event.stopPropagation();
      const on = master.checked;
      own.forEach((p) => partVisible(p, on));
      renderDomainsPanel();
    });
    const label = document.createElement("span");
    label.textContent = title;
    // A name too long for the deck is trimmed, so it says itself on hover.
    label.title = title;
    // The head holds a tick, the name and a flag box: the name gives way, the box does not.
    label.style.cssText = "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    summary.appendChild(master);
    summary.appendChild(label);

    details.appendChild(summary);
    const body = document.createElement("div");
    body.className = "gis-tool-body";
    const list = document.createElement("div");
    list.className = "studio-list";
    /**
     * THE DOMAIN'S OWN FLAG leads its list as a row of its own -- the volume
     * for the rock and the air, the default for new points. It sat in the
     * head first, where a 3.4rem box left "Subsurface" three letters wide in
     * the studio's narrow deck; a row has the room and reads like the rest.
     */
    if (id !== "surface" && id !== "spoints") {
      const domainKey = id === "points" ? "points" : id;
      const row = document.createElement("div");
      row.className = "studio-item";
      const swatch = document.createElement("span");
      swatch.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 6px 0 22px;flex:0 0 auto;background:#${(solid ? own[0].colour : id === "subsurface" ? 0xa8703f : id === "atmosphere" ? 0x7fc8ff : 0xffd166).toString(16).padStart(6, "0")}`;
      const name = document.createElement("span");
      name.textContent = id === "points" ? "default for new points" : "volume";
      name.style.cssText = "flex:1;color:#bdb7d3";
      const flagBox = solid
        ? flagInput(solid.flags?.volume ?? flag, (val) => assignFlag({ solid, domain: title }, val), `Volume flag for ${title}`)
        : flagInput(F[domainKey], (val) => assignFlag({ key: domainKey, domain: id === "points" ? null : title }, val),
          id === "points" ? "Default flag for embedded points" : `Volume flag for the ${title.toLowerCase()}`);
      row.appendChild(swatch); row.appendChild(name); row.appendChild(flagBox);
      list.appendChild(row);
    }
    own.forEach((part) => {
      const row = document.createElement("div");
      row.className = "studio-item";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = part.mesh.visible !== false;
      box.title = "Show or hide this part";
      box.addEventListener("click", (event) => { event.stopPropagation(); partVisible(part, box.checked); renderDomainsPanel(); });
      const swatch = document.createElement("span");
      swatch.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 6px;flex:0 0 auto;background:#${part.colour.toString(16).padStart(6, "0")}`;
      const name = document.createElement("span");
      name.textContent = part.face || part.name;
      name.style.cssText = "flex:1;cursor:pointer";
      const keys = flagKeysOf(part);
      const flagBox = flagInput(part.flag, (val) => assignFlag(keys.point ? { part, point: keys.point } : { part, key: keys.own }, val),
        keys.point ? `Flag for point "${keys.point}"` : `Flag for ${part.name}`);
      const info = document.createElement("button");
      info.type = "button";
      info.className = "studio-mini";
      info.textContent = "ⓘ";
      info.title = "What this part is";
      const open = (event) => {
        event.stopPropagation();
        const r = row.getBoundingClientRect();
        showPartCard(part, r.right + 8, r.top);
        if (part.solidId !== null && part.solidId !== undefined) setSelection([part.solidId]);
      };
      info.addEventListener("click", open);
      name.addEventListener("click", open);
      row.appendChild(box); row.appendChild(swatch); row.appendChild(name); row.appendChild(flagBox); row.appendChild(info);
      list.appendChild(row);
    });
    body.appendChild(list);
    details.appendChild(body);
    host.appendChild(details);
  });
}

function closePartCard() {
  const card = byId("studio-part-card");
  if (card) card.remove();
}

/**
 * The card: what this part IS, in words a reader can act on -- its flag,
 * where it sits, what it is made of -- placed beside the click and closed by
 * its ✕, by Escape, or by the next click on nothing.
 */
/**
 * WHICH FLAG A PART CARRIES, by name in the study's flag table, so a number
 * typed on this page is the number the GIS package writes. A face maps to
 * one key; a section face also owns its EDGES (base and sides, or sky and
 * sides), which the 2D script tags by their own keys; the profile and the
 * ground are `terrain`; a point is flagged by its own name.
 */
function flagKeysOf(part) {
  if (!part) return { own: null, edges: [] };
  if (part.studio) return { own: null, studio: true, edges: [], point: part.kind === "point" ? part.face : null };
  if (part.kind === "point") return { own: null, point: part.face, edges: [] };
  if (part.kind === "surface") return { own: "terrain", edges: [] };
  const section = gisTerrain?.kind === "section";
  if (section) {
    return part.which === "subsurface"
      ? { own: "subsurface", edges: [["base", "base"], ["sides", "sides_below"]] }
      : { own: "atmosphere", edges: [["sky", "sky"], ["sides", "sides_above"]] };
  }
  if (part.face === "base") return { own: "base", edges: [] };
  if (part.face === "sky") return { own: "sky", edges: [] };
  if (part.face === "sides") return { own: part.which === "subsurface" ? "sides_below" : "sides_above", edges: [] };
  return { own: null, edges: [] };
}

/** Assign a flag to a part (or one of its edges, or a domain's volume) and tell the GIS page. */
function assignFlag({ part = null, key = null, point = null, domain = null, solid = null }, value) {
  const n = Math.round(Number(value));
  if (!(n > 0)) { log("A flag is a positive integer."); return false; }
  const pipeline = window.GeoIDModelPipeline;
  // THE STUDIO'S OWN: a primitive's face, its volume, or a point placed here.
  if (solid) {
    solid.flags.volume = n;
    (solid.parts || []).forEach(refreshPartRows);
    log(`${domain || `Volume ${solid.id}`} → volume flag ${n}.`);
    renderDomainsPanel();
    return true;
  }
  if (part?.studio) {
    part.flag = n;
    const owner = solidOfPart(part);
    if (owner && part.kind === "face") owner.flags.faces[part.face] = n;
    if (part.kind === "point") { const p = state.points.find((q) => q.name === part.face); if (p) p.flag = n; }
    refreshPartRows(part);
    log(`${part.name} → flag ${n}.`);
    renderDomainsPanel();
    return true;
  }
  if (point) {
    if (part) part.flag = n;
    (gisTerrain?.points || []).filter((p) => p.name === point).forEach((p) => { p.flag = n; });
    pipeline?.setPointFlag?.(point, n);
    log(`Point "${point}" → flag ${n}.`);
  } else if (key) {
    if (gisTerrain?.flags) gisTerrain.flags[key] = n;
    if (part && flagKeysOf(part).own === key) part.flag = n;
    // Every part sharing the key follows (the ground is one mesh, the walls one flag).
    (gisTerrain?.parts || []).forEach((p) => { if (flagKeysOf(p).own === key) p.flag = n; });
    pipeline?.setFlag?.(key, n);
    log(`${domain ? `${domain} volume` : key} → flag ${n}${pipeline?.setFlag ? " (the GIS package will carry it)" : ""}.`);
  } else {
    return false;
  }
  (gisTerrain?.parts || []).forEach(refreshPartRows);
  renderDomainsPanel();
  return true;
}

/** The "Physical flag" row on a part's card says the current number. */
function refreshPartRows(part) {
  const F = gisTerrain?.flags || {};
  const { own, edges } = flagKeysOf(part);
  const owner = solidOfPart(part);
  part.rows = part.rows.map(([k, v]) => {
    if (k === "Physical flag") return [k, String(v).replace(/^\d+/, String(part.flag))];
    if (k === "Domain" && part.studio && owner) return [k, `volume ${owner.id} · volume flag ${owner.flags.volume}`];
    if (k === "Edges" && edges.length) {
      return [k, `top ${F.terrain} (the profile), ${edges.map(([e, ek]) => `${e} ${F[ek]}`).join(", ")}`];
    }
    if (k === "Domain" && own) return [k, String(v).replace(/flag \d+/, `flag ${part.which === "subsurface" ? F.subsurface : F.atmosphere}`)];
    return [k, v];
  });
}

/** A small number box that assigns a flag on Enter, blur or the ↵ button. */
function flagInput(current, onSet, title = "Type a flag number and press Enter") {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:inline-flex;align-items:center;gap:0.25rem";
  const input = document.createElement("input");
  input.type = "number"; input.min = "1"; input.step = "1";
  input.value = String(current);
  input.className = "studio-input studio-flag";
  input.style.cssText = "width:3.4rem;flex:0 0 auto;padding:0.1rem 0.25rem;font-size:0.72rem";
  input.title = title;
  const commit = () => { if (Number(input.value) !== Number(current)) onSet(input.value); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } e.stopPropagation(); });
  input.addEventListener("change", commit);
  input.addEventListener("click", (e) => e.stopPropagation());
  wrap.appendChild(input);
  return wrap;
}

function showPartCard(part, x, y) {
  closePartCard();
  const card = document.createElement("div");
  card.id = "studio-part-card";
  card.style.cssText = "position:fixed;z-index:60;max-width:22rem;padding:0.6rem 0.75rem;border:1px solid rgba(255,43,214,0.45);border-radius:0.6rem;background:rgba(16,7,36,0.96);color:#e8e6f0;font:0.74rem/1.35 'Exo 2',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.5)";
  const title = document.createElement("div");
  title.style.cssText = "display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem";
  const sw = document.createElement("span");
  sw.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:3px;background:#${part.colour.toString(16).padStart(6, "0")}`;
  const name = document.createElement("strong");
  name.textContent = part.name;
  name.style.flex = "1";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.className = "studio-mini";
  close.addEventListener("click", closePartCard);
  title.appendChild(sw); title.appendChild(name); title.appendChild(close);
  card.appendChild(title);
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:fit-content(7rem) minmax(0,1fr);gap:0.15rem 0.6rem";
  const keys = flagKeysOf(part);
  const rerender = () => { const p = card.getBoundingClientRect(); showPartCard(part, p.left - 12, p.top + 12); };
  part.rows.forEach(([k, v]) => {
    const kk = document.createElement("span"); kk.textContent = k; kk.style.cssText = "color:#52e4e8;text-transform:uppercase;letter-spacing:0.06em;font-size:0.62rem";
    const vv = document.createElement("span"); vv.style.overflowWrap = "anywhere";
    if (k === "Physical flag") {
      // THE FLAG IS EDITED HERE: the number, then what it names.
      vv.style.cssText = "display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap";
      vv.appendChild(flagInput(part.flag, (val) => {
        if (assignFlag(part.studio ? { part } : keys.point ? { part, point: keys.point } : { part, key: keys.own }, val)) rerender();
      }));
      const rest = document.createElement("span");
      rest.textContent = String(v).replace(/^\d+\s*—?\s*/, "");
      vv.appendChild(rest);
    } else if (k === "Edges" && keys.edges.length) {
      vv.style.cssText = "display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap";
      const F = gisTerrain.flags;
      vv.appendChild(document.createTextNode(`top ${F.terrain}`));
      keys.edges.forEach(([edge, ek]) => {
        vv.appendChild(document.createTextNode(` · ${edge} `));
        vv.appendChild(flagInput(F[ek], (val) => { if (assignFlag({ key: ek }, val)) rerender(); }, `Flag for the ${edge} edge (${ek})`));
      });
    } else if (k === "Domain" && part.studio && solidOfPart(part)) {
      const owner = solidOfPart(part);
      vv.style.cssText = "display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap";
      vv.appendChild(document.createTextNode(`volume ${owner.id} · volume flag `));
      vv.appendChild(flagInput(owner.flags.volume, (val) => { if (assignFlag({ solid: owner, domain: `Volume ${owner.id}` }, val)) rerender(); }, `Volume flag for Volume ${owner.id}`));
    } else if (k === "Domain" && keys.own && part.which) {
      vv.style.cssText = "display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap";
      const dk = part.which === "subsurface" ? "subsurface" : "atmosphere";
      vv.appendChild(document.createTextNode(`${part.which} · volume flag `));
      vv.appendChild(flagInput(gisTerrain.flags[dk], (val) => { if (assignFlag({ key: dk, domain: part.which }, val)) rerender(); }, `Flag for the ${part.which} volume`));
    } else {
      vv.textContent = v;
    }
    grid.appendChild(kk); grid.appendChild(vv);
  });
  card.appendChild(grid);
  /**
   * MESH SIZE HERE. A face asks for a size along its boundary graded out to
   * a distance (gmsh Distance + Threshold on the face's flag); a point asks
   * for a size at its node and a size within a reach of it. Both are size
   * fields of the GIS page's package, added through its seam, so the script
   * written there carries what was chosen here.
   */
  const pipeline = window.GeoIDModelPipeline;
  if (part.studio) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;margin-top:0.45rem;color:#bdb7d3";
    const mk = (val, title, width = "4.2rem") => { const i = document.createElement("input"); i.type = "number"; i.min = "0.001"; i.step = "any"; i.value = String(val); i.className = "studio-input"; i.style.cssText = `width:${width};padding:0.1rem 0.3rem`; i.title = title; i.addEventListener("keydown", (e) => e.stopPropagation()); i.addEventListener("click", (e) => e.stopPropagation()); return i; };
    const coarse = Number(byId("studio-size-hi")?.value) || 1;
    const size = mk(Math.max(0.001, coarse / 4), "Element size on this part");
    const reach = mk(coarse * 4, "Graded out to this distance", "5rem");
    const apply = document.createElement("button");
    apply.type = "button"; apply.className = "studio-mini"; apply.textContent = "↵ size";
    apply.title = "Add a mesh size field for this part";
    apply.addEventListener("click", (event) => {
      event.stopPropagation();
      const sizeM = Number(size.value); const distMaxM = Number(reach.value);
      if (!(sizeM > 0) || !(distMaxM > 0)) { log("A size and a reach are positive."); return; }
      const fld = part.kind === "point"
        ? { id: `f${Date.now().toString(36)}`, type: "point", on: true, name: `size at ${part.face}`, x: part.at[0], y: part.at[1], z: part.at[2], sizeM, distMinM: Math.max(sizeM, distMaxM / 8), distMaxM, sizeMaxM: null }
        : { id: `f${Date.now().toString(36)}`, type: "boundary", on: true, name: `size along ${part.name}`, key: part.face, flag: part.flag, entityDim: 2, sizeM, distMinM: Math.max(sizeM, distMaxM / 8), distMaxM, sizeMaxM: null };
      if (part.kind === "point") { const p = state.points.find((q) => q.name === part.face); if (p) p.sizeM = sizeM; }
      state.fields.push(fld);
      renderFields();
      log(`Mesh size field added: ${describeField(fld, coarse)}.`);
      apply.textContent = "✓ added";
      setTimeout(() => { apply.textContent = "↵ size"; }, 1500);
    });
    wrap.appendChild(document.createTextNode("Mesh size here"));
    wrap.appendChild(size);
    wrap.appendChild(document.createTextNode("out to"));
    wrap.appendChild(reach);
    wrap.appendChild(apply);
    card.appendChild(wrap);
  } else if (pipeline?.addSizeField && (keys.own || keys.point)) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;margin-top:0.45rem;color:#bdb7d3";
    const mk = (val, title, width = "4.2rem") => { const i = document.createElement("input"); i.type = "number"; i.min = "0.1"; i.step = "any"; i.value = String(val); i.className = "studio-input"; i.style.cssText = `width:${width};padding:0.1rem 0.3rem`; i.title = title; i.addEventListener("keydown", (e) => e.stopPropagation()); i.addEventListener("click", (e) => e.stopPropagation()); return i; };
    const coarse = Number(pipeline.getState?.()?.meshSizeM) || 100;
    const size = mk(Math.max(1, Math.round(coarse / 4)), "Element size on this part (m)");
    const reach = mk(Math.round(coarse * 4), "Graded out to this distance (m)", "5rem");
    const apply = document.createElement("button");
    apply.type = "button"; apply.className = "studio-mini"; apply.textContent = "↵ size";
    apply.title = "Add a mesh size field for this part to the GIS package";
    apply.addEventListener("click", (event) => {
      event.stopPropagation();
      const sizeM = Number(size.value); const distMaxM = Number(reach.value);
      if (!(sizeM > 0) || !(distMaxM > 0)) { log("A size and a reach are positive metres."); return; }
      let spec;
      if (keys.point) {
        spec = { type: "point", name: `size at ${keys.point}`, pointName: keys.point, sizeM, distMinM: Math.max(sizeM, distMaxM / 8), distMaxM };
      } else if (gisTerrain?.kind === "section" && part.kind === "face") {
        // A section's face is a SURFACE of the 2D mesh, not a boundary: the
        // size inside it is a box over its (s, z) extent, blended over the reach.
        const p = gisTerrain.profile;
        const polys = sectionPolygons(p, { belowM: gisTerrain.belowM, aboveM: gisTerrain.aboveM });
        const below = part.which === "subsurface";
        spec = {
          type: "box", name: `size in the ${part.which} face`,
          west: Math.min(p.a.lon, p.b.lon), east: Math.max(p.a.lon, p.b.lon), south: Math.min(p.a.lat, p.b.lat), north: Math.max(p.a.lat, p.b.lat),
          zMinM: below ? polys.baseZ : p.zMin, zMaxM: below ? p.zMax : polys.skyZ,
          sizeM, sizeOutM: null, thicknessM: distMaxM,
        };
      } else {
        spec = { type: "boundary", name: `size along ${keys.own}`, key: keys.own === "terrain" ? "top" : keys.own, sizeM, distMinM: Math.max(sizeM, distMaxM / 8), distMaxM };
      }
      if (keys.point) pipeline.setPointSize?.(keys.point, sizeM);
      const id = pipeline.addSizeField(spec);
      log(`Mesh size field added to the GIS package: ${spec.name}, ${sizeM} m graded out to ${distMaxM} m (${id}).`);
      apply.textContent = "✓ added";
      setTimeout(() => { apply.textContent = "↵ size"; }, 1500);
    });
    wrap.appendChild(document.createTextNode("Mesh size here"));
    wrap.appendChild(size);
    wrap.appendChild(document.createTextNode("m, out to"));
    wrap.appendChild(reach);
    wrap.appendChild(document.createTextNode("m"));
    wrap.appendChild(apply);
    card.appendChild(wrap);
  }
  const toggle = document.createElement("label");
  toggle.style.cssText = "display:block;margin-top:0.4rem;color:#bdb7d3";
  const box = document.createElement("input");
  box.type = "checkbox"; box.checked = part.mesh.visible !== false;
  box.addEventListener("change", () => { partVisible(part, box.checked); renderDomainsPanel(); });
  toggle.appendChild(box);
  toggle.appendChild(document.createTextNode(" shown"));
  card.appendChild(toggle);
  document.body.appendChild(card);
  const w = card.offsetWidth; const h = card.offsetHeight;
  card.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - w - 8))}px`;
  card.style.top = `${Math.max(8, Math.min(y - 12, window.innerHeight - h - 8))}px`;
}

document.addEventListener("keydown", (event) => { if (event.key === "Escape") closePartCard(); });

/** Change the extend-boundary decision on this page: rebuild both volumes. */
export function extendTerrain({ belowM, aboveM } = {}) {
  if (!gisTerrain) { log("No GIS terrain to extend — build one in the GIS page's Model Builder."); return null; }
  if (gisTerrain.kind === "section") {
    return adoptSectionModel({ ...gisTerrain, belowM: belowM ?? gisTerrain.belowM, aboveM: aboveM ?? gisTerrain.aboveM, origin: null });
  }
  return adoptTerrainSolid({ ...gisTerrain, belowM: belowM ?? gisTerrain.belowM, aboveM: aboveM ?? gisTerrain.aboveM, origin: null });
}

function ensureTerrainCard() {
  const params = byId("studio-params");
  if (!params?.parentElement) return;
  let card = byId("studio-gis-terrain");
  if (!card) {
    card = document.createElement("div");
    card.id = "studio-gis-terrain";
    card.className = "studio-params";
    params.parentElement.insertBefore(card, params.nextSibling);
  }
  card.innerHTML = "";
  const title = document.createElement("div");
  title.className = "studio-row";
  title.innerHTML = "<strong>GIS terrain — extend the boundary</strong>";
  card.appendChild(title);
  const mk = (label, key, value) => {
    const row = document.createElement("div");
    row.className = "studio-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const input = document.createElement("input");
    input.className = "studio-input";
    input.type = "number";
    input.step = "any";
    input.dataset.terrain = key;
    input.value = String(value);
    row.appendChild(lab);
    row.appendChild(input);
    card.appendChild(row);
    return input;
  };
  const below = mk("Subsurface depth (m)", "below", gisTerrain?.belowM ?? 0);
  const above = mk("Atmosphere height (m, 0 = none)", "above", gisTerrain?.aboveM ?? 0);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button secondary";
  button.textContent = "Rebuild the volumes";
  button.addEventListener("click", () => {
    extendTerrain({ belowM: Number(below.value) || 0, aboveM: Number(above.value) || 0 });
  });
  card.appendChild(button);
  const note = document.createElement("div");
  note.className = "studio-row";
  note.textContent = "The rim's corners carried down to a base and up to a sky — etna.py's outer_box. 1 unit = 1 m, z above sea level, in the GIS study's own local frame.";
  card.appendChild(note);
}

/**
 * "BUILD A VOLCANO WITH A CHAMBER" -- the studio's own text box is gone (the
 * Atlas launcher bottom-right is the one place to talk to the app), so the
 * phrase matching it did lives here and Atlas calls it. The Qt studio plans
 * these with a local model a page cannot reach; the phrasing is matched.
 */
export function buildFromText(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("volcano")) {
    TEMPLATES.etna_chamber.build(defaultsOf(TEMPLATES.etna_chamber)).forEach((e) => addSolid(e.kind, e.op, e.params));
    log(`Atlas: built a volcano with a chamber from "${text}"`);
    return { ok: true, built: "a volcano with a magma chamber" };
  }
  if (lower.includes("dike") || lower.includes("dyke") || lower.includes("layer")) {
    TEMPLATES.layered_dike.build(defaultsOf(TEMPLATES.layered_dike)).forEach((e) => addSolid(e.kind, e.op, e.params));
    log(`Atlas: built a layered crust with a dike from "${text}"`);
    return { ok: true, built: "a layered crust with a dike" };
  }
  return { ok: false, built: null, templates: Object.keys(TEMPLATES) };
}

/**
 * BRING A PANE FORWARD. The decks are accordions now, so "show the Model
 * tab" is opening its group and closing its siblings -- what a tab click
 * used to do. Callers name the deck and the pane, not a button.
 */
function showGroup(name) {
  const want = document.querySelector(`#model-studio .studio-group[data-group="${name}"]`);
  if (!want) return false;
  const band = want.dataset.band || "build";
  document.querySelectorAll(`#model-studio .studio-group[data-band="${band}"]`).forEach((g) => {
    g.open = g === want;
  });
  return true;
}

/** Every menu shut: after an action, a click outside, or Escape. */
function closeMenus() {
  document.querySelectorAll("#model-studio .studio-menu.is-open").forEach((m) => {
    m.classList.remove("is-open");
    m.querySelector(".studio-menu-btn")?.setAttribute("aria-expanded", "false");
  });
}

const FOLD_KEY = "geoid-studio:folds";
function readFolds() {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {}; } catch (e) { return {}; }
}
function writeFold(key, value) {
  try { const f = readFolds(); f[key] = value; localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch (e) { /* a storage that throws keeps the default */ }
}

/**
 * THE RIBBON AND THE FOLDS. The four menus open one at a time and shut on an
 * action, a click elsewhere or Escape; the ribbon folds to a pill; each deck
 * folds to its tab strip (a tab press unfolds it); all remembered. The decks
 * hang under the ribbon at whatever height it wraps to, through a CSS
 * variable a ResizeObserver keeps true.
 */
function wireRibbonAndFolds() {
  const root = byId("model-studio");
  const ribbon = byId("studio-ribbon");
  if (!root || !ribbon) return;
  const folds = readFolds();
  ribbon.querySelectorAll(".studio-menu-btn").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = btn.parentElement;
      const open = !menu.classList.contains("is-open");
      closeMenus();
      menu.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
    });
  });
  ribbon.querySelectorAll(".studio-menu-pop").forEach((pop) => pop.addEventListener("click", (e) => e.stopPropagation()));
  document.addEventListener("click", () => closeMenus());
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenus(); });
  const ribbonFold = ribbon.querySelector(".studio-ribbon-fold");
  const setRibbon = (folded) => {
    ribbon.classList.toggle("is-folded", folded);
    if (ribbonFold) {
      ribbonFold.title = folded ? "Show the toolbar" : "Hide the toolbar";
      ribbonFold.setAttribute("aria-expanded", folded ? "false" : "true");
    }
  };
  setRibbon(Boolean(folds.ribbon));
  ribbonFold?.addEventListener("click", (event) => {
    event.stopPropagation();
    const folded = !ribbon.classList.contains("is-folded");
    setRibbon(folded);
    writeFold("ribbon", folded);
  });
  /**
   * The decks hang under the WHOLE top row -- the mode bar and the ribbon in
   * one flex line -- so they start at one height and nothing above can land on
   * their tabs. Measured before this: the mode bar ran to y = 104 and the left
   * dock began at 96, so the GIS/MODEL/RESEARCH pills sat over the Add/Model/
   * Label/History strip.
   */
  const topbar = root.querySelector(".studio-topbar") || ribbon;
  const sizeChrome = () => root.style.setProperty("--studio-chrome-h", `${topbar.getBoundingClientRect().height}px`);
  sizeChrome();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(sizeChrome);
    ro.observe(topbar);
    ro.observe(ribbon);
  }
  window.addEventListener("resize", sizeChrome);
  /**
   * A DECK COLLAPSES INTO ITS MARGIN, the way the GIS sidebar does: the whole
   * panel slides off its own edge and leaves a vertical handle there, which
   * opens it again. Folding it to a strip of tabs still spent the column on a
   * panel nobody was reading.
   */
  document.querySelectorAll("#model-studio .studio-dock").forEach((dock) => {
    const side = dock.classList.contains("studio-dock-left") ? "left" : "right";
    const fold = dock.querySelector(`.studio-fold[data-fold="${side}"]`);
    const tab = root.querySelector(`.studio-edge-tab[data-edge="${side}"]`);
    const setDock = (folded) => {
      dock.classList.toggle("is-folded", folded);
      if (fold) fold.title = folded ? "Open this panel" : "Collapse this panel into the margin";
      if (tab) tab.hidden = !folded;
    };
    setDock(Boolean(folds[`dock-${side}`]));
    const flip = (folded) => { setDock(folded); writeFold(`dock-${side}`, folded); };
    fold?.addEventListener("click", (event) => {
      event.stopPropagation();
      flip(!dock.classList.contains("is-folded"));
    });
    tab?.addEventListener("click", (event) => { event.stopPropagation(); flip(false); });
  });
}

/**
 * EVERY SECTION OF A PANE IS A FOLDABLE CARD, the sidebar's own
 * `gis-tool-section`: a group title and what follows it, up to the next
 * title, wrapped in a <details> with the title as its summary. Ids inside
 * are untouched, so `byId` still finds every control; the fold state is
 * remembered by pane and title. Done once at boot on the markup as shipped;
 * panels built later (the Domains panel, the terrain card) are cards already.
 */
function foldPaneSections() {
  const folds = readFolds();
  document.querySelectorAll("#model-studio .studio-pane").forEach((pane) => {
    const titles = [...pane.querySelectorAll(":scope > .studio-group-title")];
    titles.forEach((title) => {
      const key = `section:${pane.dataset.pane}:${title.textContent.trim()}`;
      const details = document.createElement("details");
      details.className = "gis-tool-section studio-fold-section";
      // A nested subtab arrives COLLAPSED, the tab column's own rule: the tab
      // says what is inside it and opening one is the reader's decision. A
      // remembered state still wins, in both directions.
      details.open = Boolean(folds[key]);
      const summary = document.createElement("summary");
      summary.textContent = title.textContent.trim();
      // The shared icon painter's documented skip: these carry their own chevron.
      summary.dataset.toolIcon = "1";
      const body = document.createElement("div");
      body.className = "gis-tool-body";
      pane.insertBefore(details, title);
      details.appendChild(summary);
      details.appendChild(body);
      body.appendChild(title);
      let node = details.nextSibling;
      while (node && !(node.nodeType === 1 && node.classList.contains("studio-group-title"))) {
        const next = node.nextSibling;
        body.appendChild(node);
        node = next;
      }
      details.addEventListener("toggle", () => writeFold(key, details.open));
    });
  });
}

window.GeoIDMeshStudio = {
  state, addSolid, meshModel, ACTIONS, fitView, viewAxis,
  // The part card is on `body`; leaving the Model page must take it away.
  closePartCard,
  adoptTerrainSolid, adoptSectionModel, extendTerrain, buildFromText,
  buildGmshScript, exportPackage, getModel: () => studioModel(), addEmbeddedPoint: (p) => { state.points.push({ flag: 20, sizeM: 1, ...p }); renderStudioPoints(); renderDomainsPanel(); ensureStudioCards(); },
  setAtmosphere: (opts) => { Object.assign(state.atmosphere, opts || {}, { on: opts?.on !== false }); return applyStudioAtmosphere(); },
  setStudioBody, getStudioBody,
  origin: studioOrigin, setStudioOrigin, sceneToWgs84, wgs84ToScene,
  enuToWgs84, wgs84ToEnu, getGroundInfo,
  getAnchor: () => modelAnchor,
  adoptStudyArea,
};

/**
 * Scene defaults for Model mode: the starfield is a globe backdrop and only
 * distracts from a model, so it is off unless asked for; the ground gives the
 * spatial reference that makes the origin readable.
 */
/**
 * THE STUDIO IS EMPTY SPACE. No starfield -- that is the globe's backdrop --
 * and no ruled ground: the ground was the reference surface of an earlier
 * studio, and over a real terrain it was a second surface to read against
 * the one that matters, harsh, then quiet, then removed. The model, its
 * origin and the readouts are what say where things are.
 */
function applyStudioScene() {
  setStarsVisible(false);
  const gridOn = document.querySelector('[data-toggle="grid"]')?.classList.contains("is-on");
  setGroundVisible(gridOn !== false);
}
