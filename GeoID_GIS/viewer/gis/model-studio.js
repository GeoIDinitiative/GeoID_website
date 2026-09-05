import * as THREE from "../vendor/three.module.js";
import { currentBody, getBody, currentBodyId } from "./bodies.js?v=20260905-15e1ef6";
import { PRIMITIVES, buildSurface, buildInside, boundingBoxOf } from "./mesh-primitives.js?v=20260905-15e1ef6";
import {
  latticeTetMesh, tetBoundarySurface, qualityStats, elementCounts, toGmsh22,
} from "./mesh-volume.js?v=20260905-15e1ef6";
import { MODEL_MODE_RADIUS } from "./geo-utils.js?v=20260905-15e1ef6";
import { downloadText } from "./extraction.js?v=20260905-15e1ef6";

// Meshing Studio, ported from atlas-ai/services/mesh/meshing_studio.
//
// The Qt app's structure is kept deliberately: the same toolbar actions in the
// same order, the same Add/Model/Label/History and Mesh/Structured/Refine/Log
// decks, the same field types. What differs is the engine underneath — Gmsh's
// OCC kernel and Delaunay mesher are replaced by parametric solids with exact
// inside-tests and a lattice tet mesher, because those can run in a browser.

const byId = (id) => document.getElementById(id);

const state = {
  solids: [],
  fields: [],
  history: [],
  // A set, because the studio supports multi-select (Ctrl-click to add).
  selection: new Set(),
  mesh: null,
  kind: "box",
  params: {},
  groups: [],
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
    const material = object.material;
    if (!material) return;
    const selected = state.selection.has(entry.id);
    if (selected) {
      material.emissive?.setHex(SELECT_COLOR);
      material.emissiveIntensity = 0.55;
    } else {
      material.emissive?.setHex(0x000000);
      material.emissiveIntensity = 0;
    }
    material.needsUpdate = true;
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

const TEMPLATES = {
  etna_chamber: {
    label: "Volcano + chamber",
    build: () => [
      { kind: "volcano_edifice", op: "union", params: {} },
      { kind: "ellipsoid", op: "difference", params: { z: -3, rx: 2, ry: 2, rz: 1.2 } },
    ],
  },
  layered_dike: {
    label: "Layered crust + dike",
    build: () => [
      { kind: "layered_halfspace", op: "union", params: { width: 12, depth: 12, thicknesses: "2,3,5" } },
      { kind: "dike", op: "difference", params: { length: 6, height: 5, thickness: 0.6, top_depth: 1, strike: 30, dip: 80 } },
    ],
  },
};

function renderPalette() {
  const host = byId("studio-palette");
  if (!host) return;
  host.innerHTML = "";
  Object.entries(PRIMITIVES).forEach(([id, spec]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = spec.label;
    button.dataset.kind = id;
    button.classList.toggle("is-on", id === state.kind);
    button.addEventListener("click", () => {
      state.kind = id;
      renderPalette();
      renderParams();
    });
    host.appendChild(button);
  });

  const templates = byId("studio-templates");
  if (templates) {
    templates.innerHTML = "";
    Object.entries(TEMPLATES).forEach(([id, tpl]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tpl.label;
      button.addEventListener("click", () => {
        tpl.build().forEach((entry) => addSolid(entry.kind, entry.op, entry.params));
        log(`template "${tpl.label}" expanded into ${tpl.build().length} ops`);
      });
      templates.appendChild(button);
    });
  }
}

function renderParams() {
  const host = byId("studio-params");
  const spec = PRIMITIVES[state.kind];
  if (!host || !spec) return;
  host.innerHTML = "";
  Object.entries(spec.params).forEach(([key, [label, value]]) => {
    const row = document.createElement("div");
    row.className = "studio-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const input = document.createElement("input");
    input.className = "studio-input";
    input.dataset.param = key;
    input.type = key === "thicknesses" ? "text" : "number";
    input.step = "any";
    input.value = String(value);
    row.appendChild(lab);
    row.appendChild(input);
    host.appendChild(row);
  });
}

function readParams() {
  const out = {};
  document.querySelectorAll("#studio-params [data-param]").forEach((input) => {
    out[input.dataset.param] = input.value;
  });
  return out;
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

function displayMesh(positions, name, color) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.applyMatrix4(MODEL_TO_SCENE);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide, flatShading: true,
  }));
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
      uMinor: { value: new THREE.Color(0x2f6bff) },
      uMajor: { value: new THREE.Color(0xff2bd6) },
      uBase: { value: new THREE.Color(0x02050b) },
    },
    vertexShader: `
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
      varying vec3 vLocal;

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
        bloom = max(exp(-dLat / (step * 0.05)), exp(-dLon / (step * 0.05)))
          * 0.35 * density;
      }

      void main() {
        // The patch is already in metres east/up/north of the model's origin,
        // so the grid reads straight off the position. The model is authored in
        // metres, so the ground it stands on is ruled in metres too -- a degree
        // grid would bear no relation to it.
        float lat = vLocal.x;
        float lon = -vLocal.z;

        float wLat = fwidth(lat) * 1.2 + 1e-6;
        float wLon = fwidth(lon) * 1.2 + 1e-6;

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

        gl_FragColor = vec4(uBase + colour * (line + bloom), 1.0);
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
  const ideal = visibleMetres / 10;

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
}

function setGroundVisible(on) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.scene) return;
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
function enuToWgs84(eastM, northM, upM) {
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
function updateCoordinateReadout(point) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.renderCursorReadout) return;
  if (!point) {
    viewer.hideCursorReadout();
    return;
  }
  const geo = sceneToWgs84(point);
  viewer.renderCursorReadout(geo.lat, geo.lon, geo.elevation);
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
function keepCameraAboveGround() {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  if (!camera) return;
  const floor = groundRadius + minCameraAltitude();
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
  const floor = groundRadius + minCameraAltitude();

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
  entry.object3D = displayMesh(positions,
    `${kind}_${entry.id}`, op === "difference" ? 0xff7a6b : 0x9fd8ff);
  state.solids.push(entry);
  record(`${op} ${kind}`);
  renderModelTree();
  status(`${state.solids.length} entities`);
  log(`${op}: ${PRIMITIVES[kind].label}`);
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

function renderModelTree() {
  const entities = byId("studio-entities");
  if (entities) {
    entities.innerHTML = "";
    state.solids.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "studio-item";
      row.classList.toggle("is-selected", state.selection.has(entry.id));
      const label = document.createElement("span");
      label.textContent = `Volume ${entry.id} · ${PRIMITIVES[entry.kind].label}`
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
    ? `Selected: ${picked.map((e) => `Volume ${e.id} (${PRIMITIVES[e.kind].label})`).join(", ")}`
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
    entry.object3D?.geometry?.dispose?.();
    entry.object3D?.material?.dispose?.();
    state.selection.delete(id);
  });
  record(`delete ${ids.length}`);
  renderModelTree();
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
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return null;
  const owner = state.solids.find((entry) => entry.object3D === hits[0].object);
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
    const id = pickAt(event.clientX, event.clientY);
    if (id === null) {
      setSelection([]);
      return;
    }
    setSelection([id], { additive: event.ctrlKey || event.metaKey || event.shiftKey });
    const entry = findById(id);
    log(`Picked Volume ${id} (${PRIMITIVES[entry.kind].label})`);
  });

  // Live WGS84 readout follows the cursor across the ground and the model.
  canvas.addEventListener("pointermove", (event) => {
    if (window.GeoIDModeManager?.getMode?.() !== "model") return;
    const viewer = window.GeoIDViewer;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, viewer.camera);
    const targets = state.solids
      .filter((e) => e.object3D && e.visible !== false)
      .map((e) => e.object3D);
    if (groundMesh?.visible) targets.push(groundMesh);
    const hit = targets.length ? raycaster.intersectObjects(targets, false)[0] : null;
    updateCoordinateReadout(hit ? hit.point : null);
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

function renderFields() {
  const host = byId("studio-fields");
  if (!host) return;
  host.innerHTML = state.fields.length ? "" : '<div class="studio-item"><span>No fields</span></div>';
  state.fields.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "studio-item";
    row.classList.toggle("is-selected", f.selected);
    row.innerHTML = `<span>${i + 1}. ${f.type}</span><span>r ${f.radius}</span>`;
    row.addEventListener("click", () => {
      state.fields.forEach((o) => { o.selected = false; });
      f.selected = true;
      renderFields();
    });
    host.appendChild(row);
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
  const active = state.fields.find((f) => f.type === "ball") || null;
  const refine = active ? { x: active.x, y: active.y, z: active.z, radius: active.radius } : null;
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
function buildGmshScript() {
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
  const layers = (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((l) => l.object3D?.visible);
  if (!layers.length) return null;
  const box = new THREE.Box3();
  layers.forEach((l) => {
    l.object3D.updateMatrixWorld(true);
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
    state.history.length = 0;
    state.selection.clear();
    state.mesh = null;
    studioMeshes.clear();
    refreshStudioScale();
    renderModelTree(); renderFields(); renderHistory(); renderSelection();
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
        (data.solids || []).forEach((s) => addSolid(s.kind, s.op, s.params));
        log(`Opened project with ${(data.solids || []).length} ops`);
      } catch (error) {
        log(`Open failed: ${error.message}`);
      }
    });
    input.click();
  },
  save: () => {
    downloadText("model.msproj.json", JSON.stringify({
      solids: state.solids.map((s) => ({ kind: s.kind, op: s.op, params: s.params })),
      fields: state.fields,
      history: state.history,
    }, null, 2), "application/json");
    log("Project saved");
  },
  undo: () => {
    const entry = state.solids.pop();
    if (!entry) return;
    entry.object3D?.parent?.remove(entry.object3D);
    record("undo");
    renderModelTree();
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

  document.querySelectorAll(".studio-tabs").forEach((deck) => {
    deck.addEventListener("click", (event) => {
      const tab = event.target.closest(".studio-tab");
      if (!tab) return;
      const dock = deck.parentElement;
      dock.querySelectorAll(".studio-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      dock.querySelectorAll(".studio-pane").forEach((p) => {
        p.classList.toggle("is-active", p.dataset.pane === tab.dataset.tab);
      });
    });
  });

  document.querySelectorAll("#studio-toolbar-main [data-act]").forEach((button) => {
    button.addEventListener("click", () => {
      const fn = ACTIONS[button.dataset.act];
      if (fn) fn();
    });
  });

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
      } else if (which === "ground") {
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

  byId("studio-field-add")?.addEventListener("click", () => {
    state.fields.push({
      type: byId("studio-field-type").value,
      x: Number(byId("studio-field-x").value) || 0,
      y: Number(byId("studio-field-y").value) || 0,
      z: Number(byId("studio-field-z").value) || 0,
      radius: Number(byId("studio-field-r").value) || 1,
      distMin: Number(byId("studio-field-dmin").value) || 0,
      distMax: Number(byId("studio-field-dmax").value) || 1,
      selected: false,
    });
    renderFields();
    log(`Added ${state.fields[state.fields.length - 1].type} field`);
  });
  byId("studio-field-remove")?.addEventListener("click", () => {
    const idx = state.fields.findIndex((f) => f.selected);
    if (idx >= 0) { state.fields.splice(idx, 1); renderFields(); log("Field removed"); }
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
      type: "ball",
      x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2,
      radius: Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) / 2,
      distMin: Number(byId("studio-size-min").value) || 0,
      distMax: Number(byId("studio-size-max").value) || 1,
      selected: false,
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
    // The Qt studio plans these with a local Ollama model, which is not
    // reachable from a web page; the phrasing is matched directly instead.
    const lower = text.toLowerCase();
    if (lower.includes("volcano")) {
      TEMPLATES.etna_chamber.build().forEach((e) => addSolid(e.kind, e.op, e.params));
      log(`AI: built a volcano with a chamber from "${text}"`);
    } else if (lower.includes("dike") || lower.includes("layer")) {
      TEMPLATES.layered_dike.build().forEach((e) => addSolid(e.kind, e.op, e.params));
      log(`AI: built a layered crust with a dike from "${text}"`);
    } else {
      log(`AI: no local planner available in the browser — try "volcano" or "dike"`);
    }
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
    if (event.detail?.mode === "model") {
      rememberGlobeView();
      setStudioOrbitLimits(true);
      applyStudioScene();
      centreOnOrigin();
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

window.GeoIDMeshStudio = {
  state, addSolid, meshModel, ACTIONS, fitView, viewAxis,
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
function applyStudioScene() {
  const starsOn = document.querySelector('[data-toggle="stars"]')?.classList.contains("is-on");
  const groundOn = document.querySelector('[data-toggle="ground"]')?.classList.contains("is-on");
  setStarsVisible(Boolean(starsOn));
  setGroundVisible(Boolean(groundOn));
}
