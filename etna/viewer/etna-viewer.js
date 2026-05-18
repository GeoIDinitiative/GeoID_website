/**
 * GeoID: Earth — Mount Etna 3D Viewer
 * Renders GMSH surface topography (STL) + procedural magma plumbing system.
 * Coordinate convention: Three.js XYZ = GMSH (x-50000)/1000, z/1000, (y-50000)/1000
 *   — origin is domain centre (50km, 50km, 0) in GMSH space.
 *   — Y-up: positive Y = above sea level, negative Y = subsurface depth in km.
 */

import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { STLLoader } from './vendor/STLLoader.js';

// ─── Geometry parameters from GMSH .geo files ────────────────────────────────
// Transform: three = { x: (gmsh_x - 50000) / 1000, y: gmsh_z / 1000, z: (gmsh_y - 50000) / 1000 }

const CHAMBERS = {
  upper: {
    center: new THREE.Vector3(0, -2.0, 0),
    radii: { x: 0.25, y: 0.25, z: 0.25 },
    color: 0xff4500,
    label: 'Upper Magma Chamber',
    sublabel: '~2 km depth',
  },
  middle: {
    center: new THREE.Vector3(0, -2.85, 0),
    radii: { x: 0.25, y: 0.25, z: 0.25 },
    color: 0xdd3300,
    label: 'Intermediate Chamber',
    sublabel: '~2.85 km depth',
  },
  lower: {
    center: new THREE.Vector3(0, -6.8, 0),
    radii: { x: 6.0, y: 0.8, z: 6.0 },
    color: 0x990000,
    label: 'Lower Magma Reservoir',
    sublabel: '~6.8 km depth',
  },
};

// Dyke conduit vertical extents (Three.js Y coordinates)
const DYKES = {
  conduit1: { y1: -2.25, y2: -6.0, radius: 0.05, label: 'Main Conduit' },
  conduit2: { y1: -3.1,  y2: -6.0, radius: 0.05, label: 'Secondary Conduit' },
};

// Summit vent area (approximate Three.js coords)
const SURFACE_FEATURES = [
  { pos: new THREE.Vector3(0.05,  3.28,  0.20), label: 'Voragine',    kicker: 'Summit Crater' },
  { pos: new THREE.Vector3(-0.30, 3.22, -0.30), label: 'Bocca Nuova', kicker: 'Summit Crater' },
  { pos: new THREE.Vector3( 0.55, 3.22,  0.70), label: 'NE Crater',   kicker: 'Summit Crater' },
  { pos: new THREE.Vector3( 0.30, 3.10, -0.40), label: 'SE Crater',   kicker: 'Summit Crater' },
  { pos: new THREE.Vector3( 5.50, 1.20, -2.50), label: 'Valle del Bove', kicker: 'Collapse Depression' },
];

// Selected INGV seismic stations (GMSH coords → Three.js)
function gmshToThree(gx, gy, gz) {
  return new THREE.Vector3((gx - 50000) / 1000, gz / 1000, (gy - 50000) / 1000);
}

const STATIONS = [
  { name: 'ECPN', pos: gmshToThree(48895, 52418, 3006.8) },
  { name: 'PDN',  pos: gmshToThree(51480, 54842, 2816.4) },
  { name: 'CDV',  pos: gmshToThree(53924, 47470, 1462.9) },
  { name: 'CBD',  pos: gmshToThree(57617, 56490, 1407.7) },
  { name: 'DAM',  pos: gmshToThree(50831, 61121, 1705.2) },
  { name: 'MSP',  pos: gmshToThree(45511, 61147, 1418.0) },
  { name: 'MGL',  pos: gmshToThree(42485, 50572, 1476.0) },
  { name: 'MAS',  pos: gmshToThree(54640, 34120,  448.7) },
  { name: 'MDZ',  pos: gmshToThree(46547, 47161, 1649.1) },
  { name: 'MCN',  pos: gmshToThree(52921, 57650, 1868.8) },
];

// ─── Satellite tile constants (ESRI World Imagery, zoom 10) ──────────────────
// Tiles cover the 100×100 km GMSH domain centred on Etna (37.75°N, 15.00°E).
// UV_x = SAT_U0 + (gmsh_x / 100000) * (SAT_U1 - SAT_U0)
// UV_y = SAT_V0 + (1 - gmsh_y / 100000) * (SAT_V1 - SAT_V0)
const SAT_Z = 10, SAT_X0 = 553, SAT_NX = 4, SAT_Y0 = 394, SAT_NY = 4;
const SAT_U0 = 0.027, SAT_U1 = 0.823; // u at gmsh_x = 0 and 100000 m
const SAT_V0 = 0.070, SAT_V1 = 0.860; // v at gmsh_y = 100000 (N) and 0 (S)

// Geological domain — extends 50 km below sea level
const DOMAIN_W = 100, DOMAIN_H = 52; // width km, height km (+2 to -50)
const DOMAIN_CY = (2 - 50) / 2; // Y centre = -24 km

// ─── State ────────────────────────────────────────────────────────────────────

let renderer, scene, camera, controls;
let surfaceMesh = null;
let seaPlane = null;
let domainBox = null;
let domainEdges = null;
let chamberMeshes = {};
let dykeMeshes = {};
let stationMarkers = [];
let labels = [];
let clipPlane = null;
let activeModel = '2'; // '2' or '3'
let crossSectionEnabled = false;
let crossSectionAngle = 0; // degrees about Y axis
let showStations = true;
let showSurfaceLabels = true;
let showSubsurfaceLabels = true;
let geoGroup = null;
let terrainHeightMap = null;
let compassScene, compassCamera;
let showSurface = true;
let surfaceWireframe = false;
let spinEnabled = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('app').appendChild(renderer.domElement);
  renderer.shadowMap.enabled = true;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x03070d, 1);
  renderer.autoClear = false; // managed manually so compass inset can overlay main scene

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03070d, 0.004);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(40, 28, 65);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -10, 0); // Look at mid-depth so domain block is centred
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 120;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
  controls.update();

  setupLighting();
  buildCompass();
  buildGeologicalDomain();
  buildCoastlineSea();
  buildSubsurface('2');
  buildStations();
  buildLabels();
  loadSurface();

  renderer.domElement.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('resize', onResize);
  animate();
}

// ─── Lighting ─────────────────────────────────────────────────────────────────

function setupLighting() {
  const ambient = new THREE.AmbientLight(0xffeedd, 0.45);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff0e0, 1.1);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8899cc, 0.3);
  fill.position.set(-20, 10, -15);
  scene.add(fill);

  // Warm glow from below simulating magma
  const magmaGlow = new THREE.PointLight(0xff3300, 0.6, 20);
  magmaGlow.position.set(0, -6.8, 0);
  scene.add(magmaGlow);
}

// ─── Terrain height map (used to drape geology polygons) ─────────────────────
// Built from STL vertex positions once surface loads; cheap bilinear lookup.

const HMAP_N = 150;           // grid resolution (150×150 cells, ~0.67 km each)
const HMAP_MIN = -50, HMAP_MAX = 50;
const HMAP_STEP = (HMAP_MAX - HMAP_MIN) / HMAP_N;

function buildTerrainHeightMap() {
  terrainHeightMap = new Float32Array(HMAP_N * HMAP_N).fill(-999);
  const pos = surfaceMesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ix = Math.floor((pos.getX(i) - HMAP_MIN) / HMAP_STEP);
    const iz = Math.floor((pos.getZ(i) - HMAP_MIN) / HMAP_STEP);
    if (ix < 0 || ix >= HMAP_N || iz < 0 || iz >= HMAP_N) continue;
    const idx = iz * HMAP_N + ix;
    const y = pos.getY(i);
    if (terrainHeightMap[idx] < y) terrainHeightMap[idx] = y;
  }
  // Fill empty cells with 0 (sea level)
  for (let i = 0; i < terrainHeightMap.length; i++)
    if (terrainHeightMap[i] === -999) terrainHeightMap[i] = 0;
}

function getTerrainY(x, z) {
  if (!terrainHeightMap) return 0.02;
  const fx = (x - HMAP_MIN) / HMAP_STEP;
  const fz = (z - HMAP_MIN) / HMAP_STEP;
  const ix = Math.max(0, Math.min(HMAP_N - 2, Math.floor(fx)));
  const iz = Math.max(0, Math.min(HMAP_N - 2, Math.floor(fz)));
  const tx = fx - ix, tz = fz - iz;
  const h = (1 - tz) * ((1 - tx) * terrainHeightMap[ iz      * HMAP_N + ix    ] +
                              tx  * terrainHeightMap[ iz      * HMAP_N + ix + 1]) +
                  tz  * ((1 - tx) * terrainHeightMap[(iz + 1) * HMAP_N + ix    ] +
                              tx  * terrainHeightMap[(iz + 1) * HMAP_N + ix + 1]);
  return h + 0.025; // small lift to avoid z-fighting with terrain
}

// ─── Geology overlay ──────────────────────────────────────────────────────────
// Data from INGV EtnaGeoMap (Branca et al. 2011), CC BY 4.0.
// Format: [colorHex, label, type, syntem, age, rings] where rings = [[x,z],…]

function buildGeologyOverlay(data) {
  if (geoGroup) { scene.remove(geoGroup); geoGroup = null; }
  geoGroup = new THREE.Group();
  scene.add(geoGroup);

  for (const [colorHex, , , , , rings] of data) {
    for (const ring of rings) {
      if (ring.length < 3) continue;

      // ── Filled polygon (terrain-draped ShapeGeometry) ────────────────────
      const shape = new THREE.Shape();
      shape.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
      const fillGeo = new THREE.ShapeGeometry(shape);
      fillGeo.rotateX(Math.PI / 2); // shape XY → scene XZ
      const fp = fillGeo.attributes.position;
      for (let i = 0; i < fp.count; i++)
        fp.setY(i, getTerrainY(fp.getX(i), fp.getZ(i)));
      fp.needsUpdate = true;

      geoGroup.add(new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
        clippingPlanes: [],
      })));

      // ── Outline (LineLoop) ───────────────────────────────────────────────
      const linePts = ring.map(([x, z]) =>
        new THREE.Vector3(x, getTerrainY(x, z) + 0.005, z));
      linePts.push(linePts[0]); // close
      const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
      geoGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.85,
        clippingPlanes: [],
      })));
    }
  }
}

async function loadGeology() {
  try {
    const r = await fetch('./etna-geology.json');
    if (!r.ok) return;
    const data = await r.json();
    buildGeologyOverlay(data);
  } catch (e) {
    console.warn('Geology data unavailable:', e);
  }
}

// ─── STL surface ──────────────────────────────────────────────────────────────

function loadSurface() {
  setStatus('Loading surface topography…');
  const loader = new STLLoader();
  loader.load(
    '../ETNA_3_chambers/etna.stl',
    (geometry) => {
      transformSTLGeometry(geometry);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();

      const mat = new THREE.MeshPhongMaterial({
        color: 0x8a7260,
        specular: 0x221111,
        shininess: 12,
        side: THREE.DoubleSide,
        clippingPlanes: [],
      });

      surfaceMesh = new THREE.Mesh(geometry, mat);
      surfaceMesh.receiveShadow = true;
      surfaceMesh.castShadow = false;
      scene.add(surfaceMesh);

      updateClipPlanes();
      buildTerrainHeightMap();
      loadGeology();            // drapes geology onto terrain after height map is ready
      setStatus('Loading satellite imagery…');
      loadSatelliteTiles().then((tex) => {
        if (surfaceMesh && tex) {
          surfaceMesh.material.map = tex;
          surfaceMesh.material.color.setHex(0xffffff);
          surfaceMesh.material.needsUpdate = true;
        }
        setStatus('');
      }).catch(() => setStatus(''));
    },
    (xhr) => {
      const pct = Math.round(xhr.loaded / xhr.total * 100);
      setStatus(`Loading surface… ${pct}%`);
    },
    (err) => {
      console.error('STL load error', err);
      setStatus('Failed to load surface model.', true);
    }
  );
}

function transformSTLGeometry(geo) {
  // GMSH (x_m, y_m, z_m) → Three.js ((x-50k)/1k, z/1k, (y-50k)/1k)
  // Also builds UV coords for satellite texture projection.
  const pos = geo.attributes.position;
  const uvArr = new Float32Array(pos.count * 2);
  const du = SAT_U1 - SAT_U0;
  const dv = SAT_V1 - SAT_V0;
  for (let i = 0; i < pos.count; i++) {
    const gx = pos.getX(i); // GMSH x (0–100000 m, west→east)
    const gy = pos.getY(i); // GMSH y (0–100000 m, south→north)
    const gz = pos.getZ(i); // GMSH z (elevation m)
    pos.setXYZ(i, (gx - 50000) / 1000, gz / 1000, (gy - 50000) / 1000);
    uvArr[i * 2]     = SAT_U0 + (gx / 100000) * du;
    uvArr[i * 2 + 1] = SAT_V0 + (1 - gy / 100000) * dv;
  }
  pos.needsUpdate = true;
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
}

// ─── Satellite tile loader ─────────────────────────────────────────────────────

async function loadSatelliteTiles() {
  const tw = 256, th = 256;
  const canvas = document.createElement('canvas');
  canvas.width  = SAT_NX * tw;
  canvas.height = SAT_NY * th;
  const ctx = canvas.getContext('2d');
  // Fallback fill in case CORS blocks some tiles
  ctx.fillStyle = '#7a6a52';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const jobs = [];
  for (let row = 0; row < SAT_NY; row++) {
    for (let col = 0; col < SAT_NX; col++) {
      const tx = SAT_X0 + col, ty = SAT_Y0 + row;
      // ESRI World Imagery — public, no key required, CORS allowed
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${SAT_Z}/${ty}/${tx}`;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      jobs.push(new Promise((resolve) => {
        img.onload  = () => { ctx.drawImage(img, col * tw, row * th); resolve(); };
        img.onerror = () => resolve(); // Silently skip failed tiles
        img.src = url;
      }));
    }
  }
  await Promise.all(jobs);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // Canvas is already north-up; Three.js default flip would invert it
  tex.needsUpdate = true;
  return tex;
}

// ─── Geological domain block (surface to −50 km) ──────────────────────────────

function buildGeologicalDomain() {
  const geo = new THREE.BoxGeometry(DOMAIN_W, DOMAIN_H, DOMAIN_W);

  // Inner faces = geological medium seen through the cross-section cut
  const mat = new THREE.MeshPhongMaterial({
    color: 0x1a0c06,
    specular: 0x000000,
    shininess: 0,
    transparent: true,
    opacity: 0.72,
    side: THREE.BackSide,
    clippingPlanes: [],
  });
  domainBox = new THREE.Mesh(geo, mat);
  domainBox.position.y = DOMAIN_CY;
  scene.add(domainBox);

  // Outer edges for domain framing
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x7a3a18, transparent: true, opacity: 0.55 });
  domainEdges = new THREE.LineSegments(edgeGeo, edgeMat);
  domainEdges.position.y = DOMAIN_CY;
  scene.add(domainEdges);
}

// ─── Sea level plane ──────────────────────────────────────────────────────────

// ─── OSM coastline data (simplified, Three.js XZ coords in km) ───────────────
// Rings assembled from Overpass API ways (ε=0.3 km RDP simplification).
// Coord convention: [x, z] where x = east (km), z = north (km) from domain centre.
const COAST_R0  = [[42.04,34.02],[44.26,37.77],[46.85,44.02],[50.5,49.19],[50.38,49.8],[49.66,49.81],[50.23,49.15],[49.17,48.85],[49.57,50.5]];
const COAST_R1  = [[8.18,-45.12],[7.52,-30.92],[7.69,-29.58],[8.41,-29.19],[8.03,-29.12],[8.38,-28.69],[8.01,-28.67],[7.94,-27.86],[8.37,-28.35],[8.69,-27.8],[8.79,-29.62],[8.51,-27.46],[9.25,-26.93],[9.59,-25.67],[10.37,-25.21],[9.9,-24.3],[10.56,-24.35],[12.58,-23.02],[13.13,-21.5],[14.43,-21.04],[14.64,-19.82],[15.56,-19.36],[15.35,-13.07],[17.45,-10.74],[17.54,-8.12],[19.31,-4.62],[18.51,-1.67],[18.47,-2.42],[18.06,-1.68],[18.3,-0.35],[21.58,5.22],[24.36,7.99],[24.31,8.59],[24.04,8.27],[23.69,8.67],[24.04,9.55],[25.2,10.87],[26.26,10.48],[26.15,11.14],[26.89,11.32],[26.11,12.42],[26.93,14.24],[30.56,17.99],[30.49,18.82],[32.09,21.22],[38.82,29.91],[39.2,31.04],[42.04,33.99]];
const COAST_R37 = [[14.64,-50.5],[13.25,-50.5],[11.55,-48.9],[9.23,-48.95],[8.18,-45.13]];
const COAST_R21 = [[6.09,42.0],[4.89,42.6],[4.89,43.6],[5.7,43.71],[4.26,43.94],[3.95,44.76],[0.69,44.41],[-2.74,44.91],[-5.1,47.82],[-7.4,49.28],[-9.78,46.95],[-11.15,46.52],[-12.57,46.69],[-18.44,44.76],[-20.24,45.0],[-19.73,45.4],[-21.01,45.25],[-22.12,46.31],[-28.15,39.08],[-32.26,35.8],[-32.84,35.77],[-32.86,36.2],[-32.88,35.75],[-33.45,35.8],[-32.85,36.39],[-36.43,34.42],[-39.01,34.57],[-41.23,32.75],[-46.32,31.5],[-48.03,31.51],[-49.27,32.3],[-50.45,32.33],[-50.5,30.18]];
const COAST_R30 = [[15.03,44.71],[8.68,41.35],[7.2,41.24],[6.11,41.98]];
const COAST_R31 = [[18.41,48.23],[15.08,44.75]];
const COAST_R97 = [[20.46,50.5],[19.76,50.5],[18.51,48.35]];

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _seaMesh(shape, mat) {
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2); // Shape XY → scene XZ (Y→north)
  const m = new THREE.Mesh(geo, mat.clone());
  m.position.y = 0.01; // tiny lift to avoid z-fighting with domain top
  return m;
}

function buildCoastlineSea() {
  const D = 50;
  const mat = new THREE.MeshBasicMaterial({
    color: 0x1a6699,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    clippingPlanes: [],
  });

  seaPlane = new THREE.Group();

  // ── Shape A: Ionian / eastern Mediterranean ──────────────────────────────
  // Traces domain east edge, then follows eastern Sicily coast going south.
  // Boundary: SE corner → NE corner → Ring0 reversed → Ring1 reversed →
  //           Ring37 reversed → south edge back to SE corner.
  const shapeA = new THREE.Shape();
  shapeA.moveTo(D, -D); // SE corner (X=east, Y=north in shape space)
  shapeA.lineTo(D, D);  // NE corner
  shapeA.lineTo(_clamp(COAST_R0[COAST_R0.length-1][0],-D,D), D); // Ring0 north exit
  for (let i = COAST_R0.length - 1; i >= 0; i--)
    shapeA.lineTo(_clamp(COAST_R0[i][0],-D,D), _clamp(COAST_R0[i][1],-D,D));
  for (let i = COAST_R1.length - 1; i >= 0; i--)
    shapeA.lineTo(_clamp(COAST_R1[i][0],-D,D), _clamp(COAST_R1[i][1],-D,D));
  for (let i = COAST_R37.length - 1; i >= 0; i--)
    shapeA.lineTo(_clamp(COAST_R37[i][0],-D,D), _clamp(COAST_R37[i][1],-D,D));
  shapeA.lineTo(D, -D); // close along south edge

  // ── Shape B: Tyrrhenian / northern sea ───────────────────────────────────
  // Boundary: NW corner → east to Ring97 exit → Ring97 → Ring31 → Ring30 →
  //           Ring21 → west edge north → NW corner.
  // Also includes the open-sea gap at north edge between Ring0 and Ring97
  // by starting from NE corner and looping fully west.
  const shapeB = new THREE.Shape();
  // Start from NE corner and go west, picking up the northern coast
  shapeB.moveTo(D, D);  // NE corner
  shapeB.lineTo(_clamp(COAST_R0[COAST_R0.length-1][0],-D,D), D); // Ring0 exits here
  // Follow Ring0 inward (going south-west)
  for (let i = COAST_R0.length - 1; i >= 0; i--)
    shapeB.lineTo(_clamp(COAST_R0[i][0],-D,D), _clamp(COAST_R0[i][1],-D,D));
  // Skip across to Ring21 start (jump over land — Triangle of gap closed by domain)
  // Bridge via shared chain: Ring0 end (42.04,34) connects to Ring1 end ≈ Ring21 start area
  // The simplest bridge: go directly to Ring21 start, accepting the shortcut crosses land.
  // Because it's a sub-sea-level plane this is visually harmless (covered by surface mesh).
  shapeB.lineTo(_clamp(COAST_R30[COAST_R30.length-1][0],-D,D), _clamp(COAST_R30[COAST_R30.length-1][1],-D,D));
  for (let i = COAST_R30.length - 1; i >= 0; i--)
    shapeB.lineTo(_clamp(COAST_R30[i][0],-D,D), _clamp(COAST_R30[i][1],-D,D));
  for (const [x,z] of COAST_R21)
    shapeB.lineTo(_clamp(x,-D,D), _clamp(z,-D,D));
  shapeB.lineTo(-D, D); // NW corner via west edge
  shapeB.lineTo(D, D);  // close at NE corner

  seaPlane.add(_seaMesh(shapeA, mat));
  seaPlane.add(_seaMesh(shapeB, mat));
  scene.add(seaPlane);
}

// ─── Subsurface geometry ──────────────────────────────────────────────────────

function buildSubsurface(model) {
  clearSubsurface();
  activeModel = model;

  buildChamber('upper');
  buildChamber('lower');
  if (model === '3') buildChamber('middle');

  buildDyke('conduit1');
  if (model === '3') buildDyke('conduit2');

  updateClipPlanes();
  updateSubsurfaceLabels();
}

function clearSubsurface() {
  Object.values(chamberMeshes).forEach(m => scene.remove(m));
  Object.values(dykeMeshes).forEach(m => scene.remove(m));
  chamberMeshes = {};
  dykeMeshes = {};
}

function chamberMaterial(color) {
  return new THREE.MeshPhongMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.25),
    specular: 0xffaa44,
    shininess: 60,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    clippingPlanes: [],
  });
}

function buildChamber(key) {
  const def = CHAMBERS[key];
  const geo = new THREE.SphereGeometry(1, 48, 32);
  const mesh = new THREE.Mesh(geo, chamberMaterial(def.color));
  mesh.scale.set(def.radii.x, def.radii.y, def.radii.z);
  mesh.position.copy(def.center);
  scene.add(mesh);
  chamberMeshes[key] = mesh;
}

function buildDyke(key) {
  const def = DYKES[key];
  const height = Math.abs(def.y2 - def.y1);
  const midY = (def.y1 + def.y2) / 2;
  const geo = new THREE.CylinderGeometry(def.radius, def.radius, height, 16, 1);
  const mat = new THREE.MeshPhongMaterial({
    color: 0xff6600,
    emissive: 0x441100,
    transparent: true,
    opacity: 0.75,
    clippingPlanes: [],
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, midY, 0);
  scene.add(mesh);
  dykeMeshes[key] = mesh;
}

// ─── Seismic stations ─────────────────────────────────────────────────────────

function buildStations() {
  const geo = new THREE.SphereGeometry(0.18, 8, 6);
  const mat = new THREE.MeshPhongMaterial({ color: 0x00e5ff, emissive: 0x003344 });
  STATIONS.forEach((st) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(st.pos);
    scene.add(mesh);
    stationMarkers.push(mesh);
  });
}

// ─── Labels ───────────────────────────────────────────────────────────────────

function buildLabels() {
  const overlay = document.getElementById('label-overlay');
  if (!overlay) return;

  SURFACE_FEATURES.forEach((feat) => {
    const el = document.createElement('div');
    el.className = 'scene-label surface-label';
    el.innerHTML = `<span class="label-kicker">${feat.kicker}</span><span class="label-name">${feat.label}</span>`;
    overlay.appendChild(el);
    labels.push({ el, pos: feat.pos.clone(), type: 'surface' });
  });

  Object.entries(CHAMBERS).forEach(([key, def]) => {
    const el = document.createElement('div');
    el.className = 'scene-label subsurface-label';
    el.innerHTML = `<span class="label-name">${def.label}</span><span class="label-sub">${def.sublabel}</span>`;
    overlay.appendChild(el);
    labels.push({ el, pos: def.center.clone(), type: 'subsurface', key });
  });

  STATIONS.forEach((st) => {
    const el = document.createElement('div');
    el.className = 'scene-label station-label';
    el.innerHTML = `<span class="label-name">${st.name}</span>`;
    overlay.appendChild(el);
    labels.push({ el, pos: st.pos.clone(), type: 'station' });
  });
}

function updateLabelPositions() {
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  const temp = new THREE.Vector3();

  labels.forEach(({ el, pos, type, key }) => {
    // Visibility checks
    const isSurface = type === 'surface';
    const isSubsurface = type === 'subsurface';
    const isStation = type === 'station';

    if (isSurface && !showSurfaceLabels) { el.style.display = 'none'; return; }
    if (isSubsurface) {
      const chamberVisible = chamberMeshes[key] && chamberMeshes[key].visible;
      if (!showSubsurfaceLabels || !chamberVisible) { el.style.display = 'none'; return; }
    }
    if (isStation && !showStations) { el.style.display = 'none'; return; }

    temp.copy(pos).project(camera);
    if (temp.z > 1) { el.style.display = 'none'; return; }

    const x = (temp.x * 0.5 + 0.5) * w;
    const y = (-temp.y * 0.5 + 0.5) * h;
    el.style.display = 'block';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  });
}

function updateSubsurfaceLabels() {
  labels.forEach((lbl) => {
    if (lbl.type !== 'subsurface') return;
    const active = lbl.key === 'upper' || lbl.key === 'lower'
      || (lbl.key === 'middle' && activeModel === '3');
    lbl.el.style.display = active ? '' : 'none';
  });
}

// ─── Clipping plane ───────────────────────────────────────────────────────────

function updateClipPlanes() {
  const planes = crossSectionEnabled ? [clipPlane] : [];

  function applyPlanes(obj) {
    if (!obj) return;
    if (obj.isGroup) { obj.children.forEach(applyPlanes); return; }
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => { m.clippingPlanes = planes; });
      } else {
        obj.material.clippingPlanes = planes;
      }
    }
  }

  if (surfaceMesh) applyPlanes(surfaceMesh);
  if (seaPlane) applyPlanes(seaPlane);
  if (domainBox) applyPlanes(domainBox);
  if (geoGroup) applyPlanes(geoGroup);
  Object.values(chamberMeshes).forEach(applyPlanes);
  Object.values(dykeMeshes).forEach(applyPlanes);
}

function setCrossSectionAngle(deg) {
  crossSectionAngle = deg;
  const rad = (deg * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const nz = -Math.cos(rad);
  clipPlane.set(new THREE.Vector3(nx, 0, nz), 0);
}

// ─── Visibility helpers ───────────────────────────────────────────────────────

function setAllMeshVisible(meshMap, visible) {
  Object.values(meshMap).forEach(m => { m.visible = visible; });
}

// ─── Context HUD ──────────────────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let lastHoverContext = '';

function onMouseMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
}

function updateContextHUD() {
  raycaster.setFromCamera(mouse, camera);
  let context = '';

  // Check chamber intersections first
  const chamberList = Object.entries(chamberMeshes);
  for (const [key, mesh] of chamberList) {
    if (!mesh.visible) continue;
    const hits = raycaster.intersectObject(mesh);
    if (hits.length > 0) {
      const def = CHAMBERS[key];
      const depthKm = Math.abs(hits[0].point.y).toFixed(1);
      context = `${def.label.toUpperCase()} · ${depthKm} km depth`;
      break;
    }
  }

  if (!context && surfaceMesh && surfaceMesh.visible) {
    const hits = raycaster.intersectObject(surfaceMesh);
    if (hits.length > 0) {
      const elev = hits[0].point.y;
      const elevStr = elev >= 0
        ? `${(elev * 1000).toFixed(0)} m a.s.l.`
        : `${Math.abs(elev * 1000).toFixed(0)} m b.s.l.`;
      context = `ETNA SURFACE · ${elevStr}`;
    }
  }

  if (!context) context = 'MOUNT ETNA';

  if (context !== lastHoverContext) {
    lastHoverContext = context;
    const el = document.getElementById('sc-context');
    if (el) el.textContent = context;
  }
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg || '© 2026 GeoID: Explorer. The GeoID Initiative, led by Owen McCluskey. All rights reserved.';
  el.classList.toggle('is-error', isError);
}

// ─── Panel collapse ───────────────────────────────────────────────────────────

const isMobileLayout = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function openPanel() {
  const ui = document.getElementById('ui');
  const navTab = document.getElementById('nav-tab');
  if (!ui || !navTab) return;
  ui.classList.remove('is-collapsed');
  navTab.style.display = 'none';
}

function closePanel() {
  const ui = document.getElementById('ui');
  const navTab = document.getElementById('nav-tab');
  if (!ui || !navTab) return;
  ui.classList.add('is-collapsed');
  navTab.style.display = '';
}

// ─── UI setup ────────────────────────────────────────────────────────────────

function setupUI() {
  const uiPanel = document.getElementById('ui');
  const navCollapseBtn = document.getElementById('nav-collapse-btn');
  const navTab = document.getElementById('nav-tab');

  if (uiPanel && navCollapseBtn && navTab) {
    openPanel();
    if (isMobileLayout()) closePanel();

    navCollapseBtn.addEventListener('click', closePanel);
    navTab.addEventListener('click', openPanel);
  }

  // Model selector
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      buildSubsurface(modelSelect.value);
    });
  }

  // Cross-section toggle
  const crossToggle = document.getElementById('cross-section-toggle');
  const crossControls = document.getElementById('cross-section-controls');
  if (crossToggle) {
    crossToggle.addEventListener('change', () => {
      crossSectionEnabled = crossToggle.checked;
      if (!clipPlane) {
        clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
        setCrossSectionAngle(crossSectionAngle);
      }
      if (crossControls) crossControls.style.display = crossSectionEnabled ? '' : 'none';
      updateClipPlanes();
    });
  }

  // Cross-section angle
  const angleSlider = document.getElementById('cross-section-angle');
  const angleLabel = document.getElementById('cross-section-angle-label');
  if (angleSlider) {
    angleSlider.addEventListener('input', () => {
      const deg = parseInt(angleSlider.value, 10);
      if (angleLabel) angleLabel.textContent = deg + '°';
      setCrossSectionAngle(deg);
    });
  }

  // Surface toggle
  const surfaceToggle = document.getElementById('surface-toggle');
  if (surfaceToggle) {
    surfaceToggle.addEventListener('change', () => {
      showSurface = surfaceToggle.checked;
      if (surfaceMesh) surfaceMesh.visible = showSurface;
    });
  }

  // Wireframe
  const wireframeToggle = document.getElementById('wireframe-toggle');
  if (wireframeToggle) {
    wireframeToggle.addEventListener('change', () => {
      surfaceWireframe = wireframeToggle.checked;
      if (surfaceMesh) surfaceMesh.material.wireframe = surfaceWireframe;
    });
  }

  // Surface transparency
  const surfaceOpacity = document.getElementById('surface-opacity');
  if (surfaceOpacity) {
    surfaceOpacity.addEventListener('input', () => {
      const v = parseFloat(surfaceOpacity.value);
      if (surfaceMesh) {
        surfaceMesh.material.transparent = v < 1;
        surfaceMesh.material.opacity = v;
      }
    });
  }

  // Sea level plane
  const seaToggle = document.getElementById('sea-toggle');
  if (seaToggle) {
    seaToggle.addEventListener('change', () => {
      if (seaPlane) seaPlane.visible = seaToggle.checked;
    });
  }

  // Geological domain block
  const domainToggle = document.getElementById('domain-toggle');
  if (domainToggle) {
    domainToggle.addEventListener('change', () => {
      if (domainBox) domainBox.visible = domainToggle.checked;
      if (domainEdges) domainEdges.visible = domainToggle.checked;
    });
  }

  const geoToggle = document.getElementById('geo-toggle');
  if (geoToggle) {
    geoToggle.addEventListener('change', () => {
      if (geoGroup) geoGroup.visible = geoToggle.checked;
    });
  }

  // Chamber individual toggles
  ['upper', 'middle', 'lower'].forEach((key) => {
    const el = document.getElementById(`chamber-${key}-toggle`);
    if (!el) return;
    el.addEventListener('change', () => {
      if (chamberMeshes[key]) chamberMeshes[key].visible = el.checked;
    });
  });

  // Internal structure master
  const structureToggle = document.getElementById('structure-master-toggle');
  if (structureToggle) {
    structureToggle.addEventListener('change', () => {
      const v = structureToggle.checked;
      setAllMeshVisible(chamberMeshes, v);
      setAllMeshVisible(dykeMeshes, v);
    });
  }

  // Dyke/conduit toggle
  const dykeToggle = document.getElementById('dyke-toggle');
  if (dykeToggle) {
    dykeToggle.addEventListener('change', () => {
      setAllMeshVisible(dykeMeshes, dykeToggle.checked);
    });
  }

  // Station markers
  const stationToggle = document.getElementById('station-toggle');
  if (stationToggle) {
    stationToggle.addEventListener('change', () => {
      showStations = stationToggle.checked;
      stationMarkers.forEach(m => { m.visible = showStations; });
    });
  }

  // Surface labels
  const surfLabelToggle = document.getElementById('surface-label-toggle');
  if (surfLabelToggle) {
    surfLabelToggle.addEventListener('change', () => {
      showSurfaceLabels = surfLabelToggle.checked;
    });
  }

  // Subsurface labels
  const subLabelToggle = document.getElementById('subsurface-label-toggle');
  if (subLabelToggle) {
    subLabelToggle.addEventListener('change', () => {
      showSubsurfaceLabels = subLabelToggle.checked;
    });
  }

  // Spin toggle — uses OrbitControls autoRotate
  const spinBtn = document.getElementById('spin-toggle');
  if (spinBtn) {
    spinBtn.addEventListener('click', () => {
      spinEnabled = !spinEnabled;
      if (controls) controls.autoRotate = spinEnabled;
      spinBtn.classList.toggle('is-active', spinEnabled);
    });
  }

  // Reset view
  const resetBtn = document.getElementById('brand-reset-button');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      camera.position.set(40, 28, 65);
      controls.target.set(0, -10, 0);
      controls.update();
    });
  }

  // Info modal
  const infoBtn = document.getElementById('info-btn');
  const helpOverlay = document.getElementById('viewer-help-overlay');
  const helpClose = document.getElementById('viewer-help-close');
  if (infoBtn && helpOverlay) {
    infoBtn.addEventListener('click', () => { helpOverlay.hidden = false; });
  }
  if (helpClose && helpOverlay) {
    helpClose.addEventListener('click', () => { helpOverlay.hidden = true; });
  }
  if (helpOverlay) {
    helpOverlay.addEventListener('click', (e) => {
      if (e.target.dataset.helpClose) helpOverlay.hidden = true;
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (helpOverlay) helpOverlay.hidden = true;
    }
  });

}

// ─── Resize ───────────────────────────────────────────────────────────────────

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ─── Animation loop ───────────────────────────────────────────────────────────

// ─── 3D Compass ───────────────────────────────────────────────────────────────
// Renders in a scissored inset viewport. The compass camera mirrors the main
// camera's orientation so the N arrow always reflects the current view azimuth.
// North in world space = +Z (Three.js Z = GMSH northing).

function buildCompass() {
  compassScene = new THREE.Scene();

  // Orthographic camera — position is set each frame from main camera direction
  const s = 2.1;
  compassCamera = new THREE.OrthographicCamera(-s, s, s, -s, 0.1, 30);

  // Lighting
  compassScene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const dLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dLight.position.set(2, 4, 3);
  compassScene.add(dLight);

  const matN    = new THREE.MeshPhongMaterial({ color: 0xdd2200, shininess: 80 });
  const matS    = new THREE.MeshPhongMaterial({ color: 0xf0f0f0, shininess: 80 });
  const matHub  = new THREE.MeshPhongMaterial({ color: 0x777777, shininess: 60 });
  const matRing = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.28, side: THREE.DoubleSide });

  // Horizon ring (XZ plane)
  const ringGeo = new THREE.RingGeometry(0.78, 0.92, 64);
  ringGeo.rotateX(-Math.PI / 2);
  compassScene.add(new THREE.Mesh(ringGeo, matRing));

  // Cardinal ticks on the ring (N red, E/S/W grey)
  const tickColors = [0xdd2200, 0x666666, 0x666666, 0x666666];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2; // 0=N(+Z), π/2=E(+X), π=S, 3π/2=W
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.016, 0.2),
      new THREE.MeshBasicMaterial({ color: tickColors[i] })
    );
    // N is +Z, E is +X, S is -Z, W is -X
    tick.position.set(Math.sin(a) * 0.85, 0, Math.cos(a) * 0.85);
    tick.rotation.y = -a;
    compassScene.add(tick);
  }

  // N-S needle — north half (red) points toward +Z
  const nBody = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.58, 16), matN);
  nBody.rotation.x = Math.PI / 2;
  nBody.position.z = 0.29;
  compassScene.add(nBody);

  const nHead = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 16), matN);
  nHead.rotation.x = Math.PI / 2;
  nHead.position.z = 0.58 + 0.21;
  compassScene.add(nHead);

  // S half (white/light)
  const sBody = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.58, 16), matS);
  sBody.rotation.x = Math.PI / 2;
  sBody.position.z = -0.29;
  compassScene.add(sBody);

  const sHead = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 16), matS);
  sHead.rotation.x = -Math.PI / 2;
  sHead.position.z = -(0.58 + 0.21);
  compassScene.add(sHead);

  // Hub sphere
  compassScene.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), matHub));

  // "N" sprite label
  const lc = document.createElement('canvas');
  lc.width = lc.height = 64;
  const lx = lc.getContext('2d');
  lx.font = 'bold 46px Arial, sans-serif';
  lx.fillStyle = '#dd2200';
  lx.textAlign = 'center';
  lx.textBaseline = 'middle';
  lx.fillText('N', 32, 34);
  const nSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(lc), transparent: true, depthTest: false,
  }));
  nSprite.position.set(0, 0, 1.35);
  nSprite.scale.set(0.5, 0.5, 1);
  compassScene.add(nSprite);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateContextHUD();
  updateLabelPositions();

  const cEl = renderer.domElement;
  const cW = cEl.clientWidth;
  const cH = cEl.clientHeight;

  // ── Main scene ────────────────────────────────────────────────────────────
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, cW, cH);
  renderer.clear();
  renderer.render(scene, camera);

  // ── Compass inset (top-right corner; Y=0 is canvas bottom in Three.js) ──────
  const cSize = 112; // CSS px
  const margin = 14;
  renderer.setScissorTest(true);
  renderer.setViewport(cW - cSize - margin, cH - cSize - margin, cSize, cSize);
  renderer.setScissor(cW - cSize - margin, cH - cSize - margin, cSize, cSize);
  renderer.clearDepth();

  // Position compass camera opposite to main camera's look direction
  // so it always faces the compass arrow from the viewer's perspective
  const vDir = new THREE.Vector3();
  camera.getWorldDirection(vDir);
  compassCamera.position.copy(vDir.negate().multiplyScalar(9));
  compassCamera.up.copy(camera.up);
  compassCamera.lookAt(0, 0, 0);

  renderer.render(compassScene, compassCamera);

  // Reset to full viewport
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, cW, cH);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

setupUI();
init();
