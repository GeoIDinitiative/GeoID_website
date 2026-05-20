/**
 * GeoID: Earth — Mount Etna 3D Viewer
 * Coordinate convention: Three.js X=(E-500000)/1000 (east km), Z=(N-4175000)/1000 (north km), Y=elev/1000
 *   — origin is domain centre, Y-up: positive Y = above sea level.
 */
console.log('[etna-viewer] build v65');

import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { STLLoader } from './vendor/STLLoader.js';
import {
  buildEtnaLabelLayer,
  updateEtnaLabelVisibility,
  applyEtnaLabelVertExag,
  getThemePalette,
  ETNA_POIS,
} from './etna-label-layer.js';

// ─── Station network ──────────────────────────────────────────────────────────

// ─── INGV monitoring station network (all types, Three.js coords) ─────────────
// Format: [name, X_km, Y_km, Z_km]  X=east, Y=elev, Z=south (+Z=south)
// Source: station_data.csv, x_model/y_model columns converted to Three.js space

const STATION_CFG = {
  GNSS:    { color: 0x00e5ff, hex: '#00e5ff', label: 'GNSS'    },
  GPS:     { color: 0x76ff03, hex: '#76ff03', label: 'GPS'     },
  GRAVITY: { color: 0xff9100, hex: '#ff9100', label: 'Gravity' },
  SEISMIC: { color: 0xff3d00, hex: '#ff3d00', label: 'Seismic' },
  STRAIN:  { color: 0xe040fb, hex: '#e040fb', label: 'Strain'  },
  TILT:    { color: 0xffea00, hex: '#ffea00', label: 'Tilt'    },
};

const ALL_STATIONS = {
  GNSS: [
    ["ESCV",-16.277,0.6416,-2.759],["ESML",-10.65,0.414,11.556],["ECHR",-7.676,1.1599,3.992],
    ["EMGL",-7.184,1.6112,-0.439],["EMEG",-6.415,1.6152,-4.669],["EMAL",-6.061,1.5511,-7.689],
    ["EMSG",-4.439,1.4785,-11.012],["ESLN",-2.263,1.7752,3.2],["EPLU",-1.257,2.9646,-4.754],
    ["ECPN",-1.188,3.0371,-2.383],["EINT",-0.18,2.5486,0.306],["ECNE",0.156,2.9456,-4.774],
    ["EDAM",0.818,1.7558,-10.976],["EPDN",1.478,2.8678,-4.831],["ENIC",1.734,0.7714,12.026],
    ["ESPC",2.418,1.6534,3.298],["EMCN",2.951,1.911,-7.659],["EPED",5.286,0.664,11.655],
    ["EIIV",7.254,0.105,23.147],["EMFN",7.942,1.2046,-1.492],["ECRI",8.924,1.2434,-8.272],
    ["EBDA",10.787,0.4004,9.81],["ELIN",11.974,0.3413,6.176],["EBAG",14.192,0.2833,2.196],
    ["ELAC",14.697,0.075,17.844],["EPMN",15.615,0.52,-10.929],["ETEC",15.705,0.076,9.333],
    ["EPOZ",16.627,0.13,5.567],["ERIP",17.413,0.104,-0.703],["EFIU",18.513,0.117,-7.493],
  ],
  GPS: [
    ["EPZF",-10.871,1.1747,-11.874],["ECOR",6.608,1.4218,-9.843],["ESAL",11.85,0.7576,-3.651],
  ],
  GRAVITY: [
    ["ADR",-13.88,0.59,5.143],["CC",-6.79,1.13,4.642],["CH",-10.061,0.91,4.438],
    ["CE",-5.405,1.32,3.688],["ZAF",9.998,0.525,3.507],["HP",8.429,0.68,3.464],
    ["IF",-2.663,1.66,3.39],["PT",7.353,0.98,3.31],["CF",-3.756,1.56,3.279],
    ["VE",-1.411,1.74,3.169],["BP",6.171,1.14,2.933],["TG",-0.67,1.86,2.78],
    ["FM",1.684,1.75,2.691],["RS",-0.282,1.89,2.614],["M0",4.813,1.35,2.601],
    ["MS",0.661,1.86,2.57],["FV",3.658,1.55,2.347],["GAL",-4.385,1.875,-1.181],
    ["MSC",-4.364,1.72,-5.377],["MSP",-3.327,1.45,-11.231],["SLN",-2.255,1.74,3.232],
    ["MNT",-0.014,2.5,0.473],["PDN",1.467,2.82,-4.837],["CVE",2.201,1.68,2.77],
    ["GPA",2.466,1.57,-11.668],["PPR",3.128,1.81,-8.432],["SES",4.529,1.735,-5.536],
    ["CPC",7.739,1.15,-2.795],
  ],
  SEISMIC: [
    ["CAGR",-44.124,0.548,11.228],["GALF",-37.901,0.74,1.273],["ME02",-35.982,0.677,-34.223],
    ["MNO",-26.364,1.83,-23.091],["ECNV",-25.599,0.484,13.525],["MCPD",-23.667,0.199,-44.164],
    ["ME07",-16.663,0.739,-39.708],["ESCV",-15.857,0.64,-3.093],["EPZF",-12.322,1.14,-10.853],
    ["HLNI",-11.514,0.146,41.292],["MUCR",-11.407,1.042,-35.261],["ESML",-10.59,0.417,11.339],
    ["ECZM",-8.812,1.391,-0.863],["ME15",-8.759,0.116,-49.682],["ECHR",-7.935,1.168,3.575],
    ["LIBRI",-6.139,0.945,-39.694],["EMSA",-4.42,0.14,24.657],["ESVO",-4.404,1.736,-5.298],
    ["EMSG",-4.401,1.435,-10.845],["EMPL",-2.645,1.484,4.688],["ESLN",-2.645,1.787,3.579],
    ["ECPN",-0.881,3.038,-1.968],["EMFS",0.0,2.552,0.251],["ECNE",0.0,2.946,-5.297],
    ["EPDN",1.761,2.862,-5.297],["ENIC",1.765,0.877,10.236],["EMNR",2.64,1.845,-10.844],
    ["EMCN",2.641,1.916,-7.516],["ESPC",2.645,1.655,3.579],["EMAS",4.415,0.612,15.782],
    ["EPIT",5.281,1.657,-9.736],["ECBD",7.925,1.465,-6.41],["EMFO",7.93,1.209,-1.972],
    ["GIO",9.714,0.2,16.887],["ECTS",10.553,0.681,-17.508],["ESAL",11.451,0.768,-4.195],
    ["NOV",12.287,0.775,-34.153],["EVRN",12.343,0.421,3.57],["EPMN",15.842,0.541,-10.859],
    ["EPOZ",16.756,0.124,5.781],["EFIU",18.49,0.097,-7.536],["MCSR",20.177,1.064,-37.497],
    ["AIO",20.202,0.751,-27.511],["MMME",21.967,0.959,-24.187],["MPNC",30.666,0.479,-47.516],
    ["MALI",35.095,1.005,-36.438],["ATN",40.299,1.13,-48.668],
  ],
  STRAIN: [
    ["DRUV",-10.307,1.2516,-2.729],["DEGI",-6.394,1.6083,-4.678],
    ["DMSC",-4.75,1.7045,-5.514],["DPDN",1.478,2.8234,-4.831],
  ],
  TILT: [
    ["MGL",-7.515,1.5239,-0.572],["MGT",-6.43,1.591,-4.633],["MEG",-6.423,1.6053,-4.672],
    ["MLT",-6.075,1.511,-7.74],["MMT",-6.061,1.5508,-7.689],["EC1",-5.73,1.48,2.135],
    ["MSP",-4.489,1.4708,-11.147],["MSC",-3.699,1.678,-6.074],["MDZ",-3.453,1.6945,2.839],
    ["PLC",-1.26,2.9225,-4.753],["ECP",-1.105,3.006,-2.418],["INT",0.441,2.0,1.915],
    ["DAM",0.831,1.7446,-11.121],["PDN",1.48,2.8249,-4.842],["SPC",1.852,1.659,3.801],
    ["MNR",2.273,1.9454,-9.921],["MCN",2.921,1.9081,-7.65],["CUAD",3.8,0.141,23.105],
    ["CDV",3.924,1.5065,2.53],["MAS",4.64,0.45,15.88],["ECIT",5.285,1.74,-4.189],
    ["ECOR",6.162,1.45,-9.737],["EC10",7.276,1.017,3.41],["FAR",7.318,1.017,3.354],
    ["CBD",7.617,1.445,-6.49],
  ],
};



// Geological domain — from sea level (Y=0) down to −50 km
const DOMAIN_W = 100, DOMAIN_H = 50; // width km, height km (0 to -50)
const DOMAIN_CY = -25; // Y centre = -25 km (top at 0, bottom at -50)

// Northing correction: the STL UTM origin (4175000 N) sits 3.638 km south of the
// declared geographic centre (37.755°N). The STL loader subtracts this from gy so
// the terrain appears at the correct latitude. All hardcoded-coordinate overlays
// (domain box, sea plane, coastline) share this same Z offset.
const GEO_Z_OFFSET = 3.638;

// ─── Satellite basemap — ESRI World Imagery tiles, zoom 11 ───────────────────
// Domain geographic extent (Etna 100×100 km centred ~37.755°N 15.003°E)
const SAT_LON_W = 14.433, SAT_LON_E = 15.573; // domain west / east longitude
const SAT_LAT_N = 38.205, SAT_LAT_S = 37.305; // domain north / south latitude
// Tile grid at zoom 13 covering domain + GEO_Z_OFFSET south extension (28×30 = 840 tiles, 7168×7680 px, ~14 m/px)
const SAT_Z = 13, SAT_X0 = 4424, SAT_X1 = 4451, SAT_Y0 = 3152, SAT_Y1 = 3181;
// Tile grid geographic extent (used to compute UV offsets)
function _tileToLon(tx) { return tx / Math.pow(2, SAT_Z) * 360 - 180; }
function _tileToLat(ty) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / Math.pow(2, SAT_Z)))) * 180 / Math.PI; }
const SAT_GRID_LON_W = _tileToLon(SAT_X0);
const SAT_GRID_LON_E = _tileToLon(SAT_X1 + 1);
const SAT_GRID_LAT_N = _tileToLat(SAT_Y0);
const SAT_GRID_LAT_S = _tileToLat(SAT_Y1 + 1);

// ─── IndexedDB cache helpers ──────────────────────────────────────────────────
// Two IDB entries: processed STL geometry (positions + UVs) and composited
// satellite canvas (as a JPEG Blob). Both are keyed so that changing the source
// data constants automatically invalidates the old entry.

const _IDB_NAME  = 'etna-viewer-cache';
const _IDB_STORE = 'data';
// Bump suffix when STL file or vertex transform logic changes
const GEOM_CACHE_KEY = 'etna-geom-v1';
// Encodes tile params — auto-invalidates if grid constants change
const SAT_CACHE_KEY  = `etna-sat-z${SAT_Z}-${SAT_X0}-${SAT_X1}-${SAT_Y0}-${SAT_Y1}`;

function _openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE);
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
async function _idbGet(key) {
  try {
    const db = await _openIDB();
    return await new Promise((res, rej) => {
      const tx  = db.transaction(_IDB_STORE, 'readonly');
      const req = tx.objectStore(_IDB_STORE).get(key);
      req.onsuccess = e => res(e.target.result ?? null);
      req.onerror   = e => rej(e.target.error);
    });
  } catch { return null; }
}
async function _idbSet(key, value) {
  try {
    const db = await _openIDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).put(value, key);
      tx.oncomplete = res;
      tx.onerror    = e => rej(e.target.error);
    });
  } catch (e) { console.warn('IDB write failed', e); }
}

// ─── State ────────────────────────────────────────────────────────────────────

let renderer, scene, camera, controls;
let surfaceMesh = null;
let hazardOverlayMesh = null;
let terrainSkirt = null;
let seaPlane = null;
let oceanVolume = null;
let _seaClipPlane = null; // THREE.Plane keeping fragments at Y <= current sea level

let domainBox = null;
let domainEdges = null;
let domainOverdraw = null;  // transparent clone rendered after rings to repaint walls over any ring bleed
let domainLayerEdges = null; // horizontal boundary lines between geological layers
let ionianSlab = null;       // subducting Ionian oceanic slab (mantle lithosphere)
let faultRootGroup = null;   // parent group for all surface fault overlays (scale.y tracks vertExag)
let seismicMesh = null;      // THREE.InstancedMesh — one instance per seismic event
let _seismicEvents = null;   // raw array [[x,z,y,ml,year], …] loaded from etna-seismicity.json
let _seismicMlMin  = 1.5;   // current magnitude-cutoff filter
let _seismicDEnabled = { shallow:true, mid:true, deep:true, vdeep:true }; // depth-band toggles
let _seismicSelectionIdx       = -1;   // instanceId of the currently selected seismic event
let _seismicSelectionRing      = null; // THREE.Mesh — cyan pulsing ring around the selected event
let _seismicSelectionOrigColor = null; // THREE.Color — original depth color of the selected instance
let ionianCrust = null;      // oceanic crust cap (~7 km) atop the slab surface
let maltaEscarpment = null;  // Hyblean-Malta Escarpment — continental/oceanic boundary
let stepFault = null;        // STEP fault — lateral slab tear edge allowing upwelling
let mantleConduit = null;    // deep magmatic feeder conduit through slab window
let skirtOverdraw = null;   // same for terrain skirt
let stencilMask = null;     // FrontSide terrain clone that writes stencil=1; rings test stencil=1 to stay above-surface-only
let hazardGroup       = null;
let _hazardDomainPlanes = null;  // 4 domain-boundary clipping planes for hazard meshes
const _hazardObjects  = [];      // ring meshes for raycasting
let stationMarkers = []; // kept as empty array — no longer contains meshes
let stationMarkersByType = {}; // type → [] (unused, kept for safety)
let stationDOMByType = {}; // type → DOM pin elements for immediate toggle control
let chamberMeshes = [];
let chamberCapMeshes = []; // 2D cross-section shapes lying in the cut plane
let labels = [];
let clipPlane = null;
let crossSectionCap = null;
let crossSectionCapOverdraw = null;
let _crossCapTerrainGeo = null;  // terrain geometry ref stored after STL load
let _crossCapRebuildTimer = null;
let crossSectionEnabled = false;
let crossSectionAngle = 0; // degrees about Y axis
let showCapFace = true;
const showStationType  = { GNSS: false, GPS: false, GRAVITY: false, SEISMIC: false, STRAIN: false, TILT: false };
const categoryEnabled  = { settlement: true, fault: true, vent: true, fissure: true, general: true };
let currentLodLevel    = 3; // label density slider: 1=landmarks only, 3=all
let etnaLabelLayer      = null;
let activePopupFeature  = null;
let _selectedLabelEntry = null; // currently pulsing label entry
let _vertExag          = 1;

// ─── Measurement state ────────────────────────────────────────────────────────
let measureMode    = '';      // 'distance' | 'area' | 'profile' | ''
let measurePoints  = [];      // { x, z, y, lat, lon, elevM } each in scene-km
let measureProfileSamples = [];
let measureGroup   = null;    // THREE.Group, added to scene in init()
let measureVisuals = [];      // disposable child refs
let _mResultAnchor = null;    // anchor element for result card positioning
let showSurfaceLabels  = true;
let compassScene, compassCamera;
let surfaceWireframe = false;
let spinEnabled = false;
let satelliteTexture = null;
let basemapMode = 'satellite';

// ─── Hazard zones ─────────────────────────────────────────────────────────────
const HAZARD_ZONES = [
  {
    label: 'Extreme Risk', rInner: 0, rOuter: 5,
    color: 0xff1a1a, colorHex: '#ff1a1a', alpha: 0.40,
    kicker: '0 – 5 km from summit',
    hazards: [
      'Ballistic projectiles — blocks and bombs > 30 cm',
      'Pyroclastic density currents (PDCs)',
      'Lava flow inundation',
      'Extreme volcanic gas concentrations (SO₂, HCl, H₂S, CO₂)',
      'Ground deformation and structural collapse',
      'Phreatic explosions without warning',
    ],
    detail: 'The primary exclusion zone during any eruptive or unrest phase. Ballistics from lava fountains and Strombolian explosions can be ejected over 1 km from active vents. Pyroclastic density currents — fast-moving avalanches of hot gas and rock — regularly travel 3–5 km down Etna\'s flanks during paroxysmal episodes. Emergency evacuation is mandatory when eruptive activity intensifies.',
  },
  {
    label: 'Very High Risk', rInner: 5, rOuter: 10,
    color: 0xff6600, colorHex: '#ff6600', alpha: 0.32,
    kicker: '5 – 10 km from summit',
    hazards: [
      'Heavy tephra and scoria fall (5–20 cm depth in major events)',
      'Smaller ballistic ejecta during explosive episodes',
      'PDC run-out into deep valleys (Valle del Bove)',
      'Volcanic gas corridors concentrated along valleys',
      'Acid rain and aerosol deposition',
      'Infrastructure damage from lava flows on active fissures',
    ],
    detail: 'Encompasses Etna\'s upper flanks, including Rifugio Sapienza and Piano Provenzana ski station — both were partially destroyed by lava flows in 2001 and 2002. During major paroxysms, heavy tephra fall can begin within minutes. The Valle del Bove depression channels lava flows and occasional PDC overflow toward the inhabited eastern coast.',
  },
  {
    label: 'High Risk', rInner: 10, rOuter: 20,
    color: 0xffaa00, colorHex: '#ffaa00', alpha: 0.26,
    kicker: '10 – 20 km from summit',
    hazards: [
      'Moderate–heavy ash fall (1–5 cm depth)',
      'Roof loading and structural stress from prolonged tephra',
      'Volcanic gas and acid rain affecting crops and water',
      'Lahar risk along river valleys after heavy rainfall',
      'Airport and road transport disruption',
    ],
    detail: 'Towns including Nicolosi, Zafferana Etnea, Linguaglossa, and Randazzo fall within this band. Ash deposits of 1–5 cm damage crops, contaminate water supplies, and stress building roofs. Catania International Airport (25 km south) regularly suspends operations during major eruptive episodes due to ash ingestion risk in aircraft engines.',
  },
  {
    label: 'Moderate Risk', rInner: 20, rOuter: 35,
    color: 0xddcc00, colorHex: '#ddcc00', alpha: 0.20,
    kicker: '20 – 35 km from summit',
    hazards: [
      'Light–moderate ash fall (millimetres to 1 cm)',
      'Reduced air quality and visibility',
      'Vehicle and machinery damage from fine ash',
      'Acid rain affecting vegetation and open water sources',
      'Near-field aviation hazard from dispersing ash cloud',
    ],
    detail: 'Catania city centre and coastal towns are regularly affected by ash fall during sustained eruptive episodes. Even a few millimetres of ash disrupts road transport, irritates respiratory systems, and contaminates open water. The volcanic ash cloud can extend hundreds of kilometres downwind — this zone captures the near-field deposition footprint.',
  },
  {
    label: 'Low Risk', rInner: 35, rOuter: 50,
    color: 0x44cc66, colorHex: '#44cc66', alpha: 0.14,
    kicker: '35 – 50 km from summit',
    hazards: [
      'Trace ash fall and volcanic dust (< 1 mm)',
      'Volcanic aerosol, SO₂ odour, and fine particulates (PM₂.₅)',
      'Reduced air quality for sensitive individuals',
      'Potential disruption to coastal marine traffic',
    ],
    detail: 'At this distance the primary hazards are trace ash fall during prolonged eruptions and volcanic aerosols that may temporarily affect air quality. Messina (~40 km NE), southern Calabria, and the Aeolian Islands can experience these effects when winds blow northeastward. No life-threatening hazard is expected here under normal eruptive scenarios.',
  },
];
const HAZARD_SUMMIT_X = -0.70;  // scene X km of summit centroid
const HAZARD_SUMMIT_Z =  0.90;  // scene Z km of summit centroid

// Height grid — 200×200 samples of terrain Y (km), built from STL vertices
let _heightGrid = null;
const _HG_RES = 200;
const _HG_STEP = 100 / _HG_RES; // 0.5 km per cell

function _buildHeightGrid(geo) {
  const pos = geo.attributes.position;
  const grid = new Float32Array(_HG_RES * _HG_RES).fill(-Infinity);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const col = Math.floor((x + 50) / _HG_STEP);
    const row = Math.floor((z + 50) / _HG_STEP);
    if (col < 0 || col >= _HG_RES || row < 0 || row >= _HG_RES) continue;
    const idx = row * _HG_RES + col;
    if (y > grid[idx]) grid[idx] = y;
  }
  for (let i = 0; i < grid.length; i++) {
    if (!isFinite(grid[i])) grid[i] = 0;
  }
  _heightGrid = grid;
}

function _sampleHeight(x, z) {
  if (!_heightGrid) return 0.02;
  const col = (x + 50) / _HG_STEP;
  const row = (z + 50) / _HG_STEP;
  const c0 = Math.max(0, Math.min(_HG_RES - 1, Math.floor(col)));
  const r0 = Math.max(0, Math.min(_HG_RES - 1, Math.floor(row)));
  const c1 = Math.min(_HG_RES - 1, c0 + 1);
  const r1 = Math.min(_HG_RES - 1, r0 + 1);
  const fc = col - c0, fr = row - r0;
  const g = _heightGrid;
  const y00 = g[r0 * _HG_RES + c0], y10 = g[r0 * _HG_RES + c1];
  const y01 = g[r1 * _HG_RES + c0], y11 = g[r1 * _HG_RES + c1];
  return (1 - fr) * ((1 - fc) * y00 + fc * y10) + fr * ((1 - fc) * y01 + fc * y11) + 0.02;
}

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
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(40, 28, 65);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -10, 0); // Look at mid-depth so domain block is centred
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 400;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
  controls.update();

  measureGroup = new THREE.Group();
  scene.add(measureGroup);

  setupLighting();
  buildCompass();
  buildGeologicalDomain();
  buildIonianSlab();
  buildIonianCrust();
  buildMaltaEscarpment();
  buildSTEPFault();
  buildMantleConduit();
  buildChambers();
  buildChamberCaps();
  buildCrossSectionCap();
  buildCoastlineSea();
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



// ─── STL surface ──────────────────────────────────────────────────────────────
// STL raw: col0=easting 0-100000, col1=northing 0-100000, col2=elevation m
// Three.js: X=(E-50000)/1000, Y=elev/1000, Z=(50000-N)/1000  (+Z=south, -Z=north)

async function loadSurface() {
  setStatus('Loading surface…');

  // Fast path: reconstruct BufferGeometry from IDB-cached processed arrays,
  // skipping the 5.4 MB STL download and vertex transform loop entirely.
  const geomCached = await _idbGet(GEOM_CACHE_KEY);
  if (geomCached) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(geomCached.positions), 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(geomCached.uvs),       2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    _finalizeSurface(geo);
    return;
  }

  // Slow path: download STL, transform vertices, compute UVs, then cache.
  const loader = new STLLoader();
  loader.load('../ETNA_3_chambers/etna.stl', (geo) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const gx = pos.getX(i); // easting  0-100000
      const gy = pos.getY(i); // northing 0-100000
      const gz = pos.getZ(i); // elevation m
      pos.setXYZ(i, (gx - 50000) / 1000, gz / 1000, (50000 - gy) / 1000 + GEO_Z_OFFSET);
    }
    pos.needsUpdate = true;

    const uvArr = new Float32Array(pos.count * 2);
    const lonSpan = SAT_GRID_LON_E - SAT_GRID_LON_W;
    const latSpan = SAT_GRID_LAT_N - SAT_GRID_LAT_S;
    for (let i = 0; i < pos.count; i++) {
      const X = pos.getX(i), Z = pos.getZ(i);
      const lon = SAT_LON_W + (X + 50) / 100 * (SAT_LON_E - SAT_LON_W);
      const lat = SAT_LAT_N + (Z + 50) / 100 * (SAT_LAT_S - SAT_LAT_N);
      uvArr[i * 2]     = (lon - SAT_GRID_LON_W) / lonSpan;
      uvArr[i * 2 + 1] = (SAT_GRID_LAT_N - lat) / latSpan; // V=0 at north
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    // Persist processed arrays so the next load skips STL download + transform
    _idbSet(GEOM_CACHE_KEY, {
      positions: pos.array.slice().buffer,
      uvs: uvArr.buffer,
    });

    _finalizeSurface(geo);
  }, undefined, (e) => {
    console.error('STL load error', e);
    setStatus('Failed to load surface.', true);
  });
}

function _finalizeSurface(geo) {
  const terrainMat = new THREE.MeshPhongMaterial({
    color: 0x8a7260,
    specular: 0x221111,
    shininess: 12,
    side: THREE.DoubleSide,
    clippingPlanes: [],
  });

  surfaceMesh = new THREE.Mesh(geo, terrainMat);
  surfaceMesh.receiveShadow = true;
  surfaceMesh.renderOrder = 1;
  scene.add(surfaceMesh);

  // Hazard zone overlay: ShaderMaterial computing zone color per-pixel from world
  // XZ distance to summit. Cross-section clipping is implemented as explicit
  // uniforms (uClipEnabled, uClipNormal, uClipConst) rather than via Three.js's
  // material.clippingPlanes, which is silently ignored for ShaderMaterial unless
  // the full clipping-plane GLSL infrastructure is included — unreliable across
  // engine versions. updateClipPlanes() keeps the uniforms in sync.
  const overlayMat = new THREE.ShaderMaterial({
    uniforms: {
      uSummitXZ:    { value: new THREE.Vector2(HAZARD_SUMMIT_X, HAZARD_SUMMIT_Z) },
      uClipEnabled: { value: 0.0 },
      uClipNormal:  { value: new THREE.Vector3(0, 0, -1) },
      uClipConst:   { value: 0.0 },
      uCameraY:     { value: 0.0 },
    },
    vertexShader: `
      varying vec2 vWorldXZ;
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldXZ = wp.xz;
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vWorldXZ;
      varying vec3 vWorldPos;
      uniform vec2  uSummitXZ;
      uniform float uClipEnabled;
      uniform vec3  uClipNormal;
      uniform float uClipConst;
      uniform float uCameraY;
      void main() {
        if (uCameraY < 0.0) discard;
        if (uClipEnabled > 0.5 && dot(vWorldPos, uClipNormal) + uClipConst < 0.0) discard;
        float d = length(vWorldXZ - uSummitXZ);
        vec3 col; float amt;
        if      (d <  5.0) { col = vec3(1.00,0.10,0.10); amt = 0.55; }
        else if (d < 10.0) { col = vec3(1.00,0.40,0.00); amt = 0.44; }
        else if (d < 20.0) { col = vec3(1.00,0.67,0.00); amt = 0.34; }
        else if (d < 35.0) { col = vec3(0.87,0.80,0.00); amt = 0.26; }
        else if (d < 50.0) { col = vec3(0.27,0.80,0.40); amt = 0.18; }
        else discard;
        gl_FragColor = vec4(col * amt, 1.0);
      }
    `,
    transparent: false,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
  hazardOverlayMesh = new THREE.Mesh(geo, overlayMat);
  hazardOverlayMesh.renderOrder = 2;
  hazardOverlayMesh.visible = false;
  scene.add(hazardOverlayMesh);



  _crossCapTerrainGeo = geo;
  _buildHeightGrid(geo);
  etnaLabelLayer = buildEtnaLabelLayer(scene, _sampleHeight);
  _buildOceanVolumeFromTerrain(geo);
  _buildTerrainSkirt(geo);
  buildHazardZones();
  buildFaultOverlays();
  buildSeismicOverlay();
  updateClipPlanes();
  if (basemapMode === 'satellite') applyBasemap('satellite');
  setStatus('');
}

// ─── Geological domain — layered structure from surface to −50 km ─────────────
// Five geological units visible as coloured bands on domain side / bottom faces.
// BoxGeometry face order: 0=+X, 1=-X, 2=+Y(top), 3=-Y(bottom), 4=+Z, 5=-Z.

// Eight-layer stratigraphy derived from Etna crustal tomography studies
// (Nicolich et al. 2000; Laigle et al. 2000; Chiarabba et al. 2004; Patanè et al. 2006)
const GEO_LAYERS = [
  { color: 0x28233c, emissive: 0x09080e, label: 'Volcanic edifice',                depth: '0–3 km'       },
  { color: 0xc8a868, emissive: 0x2a2010, label: 'Plio-Quat. sediments',            depth: '3–12 km'      },
  { color: 0xa08858, emissive: 0x221a08, label: 'Hyblean carbonate platform',      depth: '5–20 km'      },
  { color: 0x68583c, emissive: 0x180e08, label: 'Apenninic-Maghrebian allochthon', depth: '12–28 km'     },
  { color: 0x746070, emissive: 0x1a1218, label: 'Pre-Alpine crystalline basement', depth: '17–34 km'     },
  { color: 0x3c3045, emissive: 0x0e0c12, label: 'Lower crust / Moho zone',         depth: '21–40 km'     },
  { color: 0x384838, emissive: 0x0c1008, label: 'Lithospheric mantle (SCLM)',      depth: '26–48 km'     },
  { color: 0x8c3c14, emissive: 0x280c04, label: 'Asthenosphere',                   depth: '40–50 km'     },
];

// Boundary surfaces between geological layers.
// 9 entries (for 8 layers): each is [SW_y, SE_y, NW_y, NE_y] in km.
// SW = (X=−50, Z=+50)  SE = (X=+50, Z=+50)  ← south edge of domain
// NW = (X=−50, Z=−50)  NE = (X=+50, Z=−50)  ← north edge of domain
// Key constraints (Nicolich et al. 2000; Patanè et al. 2006):
//   Moho: ~26–28 km under Hyblean foreland (south) → ~36–42 km under Apenninic orogen (north)
//   LAB : ~40 km south → ~48 km north
const GEO_LAYER_BOUNDS = [
  [   0,    0,    0,    0],  // surface 0: terrain top (flat, Y=0)
  [  -3,   -3,   -3,   -3],  // surface 1: base volcanic edifice (flat)
  [  -5,   -7,   -9,  -12],  // surface 2: base Plio-Quat. sediments (deepens N/E)
  [ -12,  -15,  -15,  -20],  // surface 3: base Hyblean carbonate platform
  [ -17,  -20,  -22,  -28],  // surface 4: base Apenninic-Maghrebian allochthon
  [ -21,  -24,  -27,  -33],  // surface 5: base crystalline basement
  [ -26,  -28,  -36,  -42],  // surface 6: Moho (26 km S → 42 km NE)
  [ -40,  -42,  -44,  -48],  // surface 7: LAB
  [ -50,  -50,  -50,  -50],  // surface 8: domain floor (flat)
];

function buildGeologicalDomain() {
  const hw = DOMAIN_W / 2; // 50 km

  const layerGroup    = new THREE.Group();
  layerGroup.position.set(0, 0, GEO_Z_OFFSET);
  const overdrawGroup = new THREE.Group();
  overdrawGroup.position.set(0, 0, GEO_Z_OFFSET);

  GEO_LAYERS.forEach((layer, idx) => {
    const topB = GEO_LAYER_BOUNDS[idx];
    const botB = GEO_LAYER_BOUNDS[idx + 1];
    const isBot = idx === GEO_LAYERS.length - 1;

    // Corner Y values for top and bottom boundary surfaces
    const [tSW, tSE, tNW, tNE] = topB;
    const [bSW, bSE, bNW, bNE] = botB;

    // Build 4 side faces (each a planar quad at constant X or Z).
    // Top face omitted (covered by terrain); bottom face only for deepest layer.
    const pos = [];

    // East face (X=+hw): reveals the N–S geological cross-section
    pos.push(
       hw, tSE, hw,   hw, tNE,-hw,   hw, bSE, hw,
       hw, bSE, hw,   hw, tNE,-hw,   hw, bNE,-hw
    );
    // West face (X=−hw)
    pos.push(
      -hw, tNW,-hw,  -hw, tSW, hw,  -hw, bNW,-hw,
      -hw, bNW,-hw,  -hw, tSW, hw,  -hw, bSW, hw
    );
    // South face (Z=+hw): reveals the W–E cross-section
    pos.push(
      -hw, tSW, hw,   hw, tSE, hw,  -hw, bSW, hw,
      -hw, bSW, hw,   hw, tSE, hw,   hw, bSE, hw
    );
    // North face (Z=−hw)
    pos.push(
       hw, tNE,-hw,  -hw, tNW,-hw,   hw, bNE,-hw,
       hw, bNE,-hw,  -hw, tNW,-hw,  -hw, bNW,-hw
    );

    if (isBot) {
      // Bottom face: domain floor (flat at Y=−50)
      pos.push(
        -hw, bSW, hw,   hw, bSE, hw,   hw, bNE,-hw,
        -hw, bSW, hw,   hw, bNE,-hw,  -hw, bNW,-hw
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshPhongMaterial({
      color: layer.color, emissive: layer.emissive,
      specular: 0x1a0e08, shininess: 8,
      side: THREE.DoubleSide, clippingPlanes: [],
    });
    const mesh = new THREE.Mesh(geo, mat);
    layerGroup.add(mesh);

    // Overdraw counterpart — covers hazard-ring bleed
    const odMat = new THREE.MeshPhongMaterial({
      color: layer.color, emissive: layer.emissive,
      specular: 0x1a0e08, shininess: 8,
      side: THREE.DoubleSide, clippingPlanes: [],
      transparent: true, opacity: 1.0,
      depthTest: true, depthWrite: false,
    });
    const odMesh = new THREE.Mesh(geo, odMat);
    odMesh.renderOrder = 10;
    overdrawGroup.add(odMesh);
  });

  scene.add(layerGroup);
  scene.add(overdrawGroup);
  domainBox      = layerGroup;
  domainOverdraw = overdrawGroup;

  // ── Tilted boundary lines following each geological surface perimeter ─────
  const edgeGroup = new THREE.Group();
  edgeGroup.position.set(0, 0, GEO_Z_OFFSET);

  // Surfaces 1–7 (internal boundaries; skip terrain top and domain floor)
  const MOHO_IDX = 6, LAB_IDX = 7;
  GEO_LAYER_BOUNDS.slice(1, 8).forEach((bounds, bi) => {
    const surfIdx = bi + 1;
    const bright  = surfIdx === MOHO_IDX || surfIdx === LAB_IDX;
    const col = bright ? 0xc8a880 : 0x7a6a58;
    const op  = bright ? 0.85 : 0.50;
    const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op });

    const [ySW, ySE, yNW, yNE] = bounds;
    const pts = new Float32Array([
      -hw, ySW, hw,   hw, ySE, hw,   // south edge W→E
       hw, ySE, hw,   hw, yNE,-hw,   // east edge  S→N
       hw, yNE,-hw,  -hw, yNW,-hw,   // north edge E→W
      -hw, yNW,-hw,  -hw, ySW, hw,   // west edge  N→S
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    edgeGroup.add(new THREE.LineSegments(bGeo, mat));
  });
  scene.add(edgeGroup);
  domainLayerEdges = edgeGroup;

  // ── Full outer domain edge outline ────────────────────────────────────────
  const fullGeo = new THREE.BoxGeometry(DOMAIN_W, DOMAIN_H, DOMAIN_W);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x6a5248, transparent: true, opacity: 0.7 });
  domainEdges = new THREE.LineSegments(new THREE.EdgesGeometry(fullGeo), edgeMat);
  domainEdges.position.set(0, DOMAIN_CY, GEO_Z_OFFSET);
  scene.add(domainEdges);
}

// ─── Ionian oceanic slab (mantle lithosphere) ────────────────────────────────
// The Ionian oceanic plate is the subducting body beneath the Calabrian arc.
// At Etna's latitude the slab dips ~55–60° toward the NW and its surface is
// inferred at ~29 km (Moho depth) at the eastern domain boundary.  The slab
// is absent west of ~X=+33 km — the "slab window" permitting asthenospheric
// upwelling that ultimately feeds Etna's magmatic system.

function buildIonianSlab() {
  // Slab top-surface (world XYZ; position.z = GEO_Z_OFFSET added below).
  // Entry follows the tilted Moho: SE corner (south, east) at −28 km;
  // NE corner (north, east) at −42 km — consistent with GEO_LAYER_BOUNDS surface 6.
  // Dip ≈ 56° westward; domain-floor exits: south at X≈+35, north at X≈+45.
  const slabPts = new Float32Array([
    50, -28,  44,   50, -42, -44,   35, -50,  44,   // tri 1
    50, -42, -44,   45, -50, -44,   35, -50,  44,   // tri 2
  ]);
  const slabGeo = new THREE.BufferGeometry();
  slabGeo.setAttribute('position', new THREE.BufferAttribute(slabPts, 3));
  slabGeo.computeVertexNormals();

  const slabMat = new THREE.MeshPhongMaterial({
    color: 0x18283e, emissive: 0x040810,
    specular: 0x0c1c30, shininess: 18,
    transparent: true, opacity: 0.88,
    side: THREE.DoubleSide, depthWrite: false, clippingPlanes: [],
  });

  ionianSlab = new THREE.Mesh(slabGeo, slabMat);
  ionianSlab.position.z = GEO_Z_OFFSET;
  ionianSlab.renderOrder = 7;
  scene.add(ionianSlab);
}

// ─── Ionian oceanic crust — thin cap atop the slab surface ───────────────────
// The Ionian oceanic crust is ~7 km thick (Vp ≈ 6.5–7.0 km/s).
// It rides on the slab surface and shows on the east face as a distinct
// dark-blue panel above the darker mantle-slab body.
// The apparent width perpendicular to the slab dip is 7 / sin(56°) ≈ 8.4 km
// (projected into world X–Y); the normal-offset vector from the slab top is
// (-0.829, +0.559) in XY (rotated 90° CW from the dip unit vector).

function buildIonianCrust() {
  // Crust rides ~7 km above (perpendicular to) the slab surface.
  // Average dip vector from updated slab geometry: (50,-28)→(35,-50) south side.
  // dx=−15, dy=−22; normal CW: (−22,15) → normalised (−0.826,+0.563); ×7 → (−5.78,+3.94).
  const ox = -5.78, oy = 3.94;

  const crustPts = new Float32Array([
    50+ox, -28+oy,  44,   50+ox, -42+oy, -44,   35+ox, -50+oy,  44,
    50+ox, -42+oy, -44,   45+ox, -50+oy, -44,   35+ox, -50+oy,  44,
  ]);
  const crustGeo = new THREE.BufferGeometry();
  crustGeo.setAttribute('position', new THREE.BufferAttribute(crustPts, 3));
  crustGeo.computeVertexNormals();

  const crustMat = new THREE.MeshPhongMaterial({
    color: 0x1e3858, emissive: 0x060c14,
    specular: 0x102040, shininess: 22,
    transparent: true, opacity: 0.84,
    side: THREE.DoubleSide, depthWrite: false, clippingPlanes: [],
  });

  ionianCrust = new THREE.Mesh(crustGeo, crustMat);
  ionianCrust.position.z = GEO_Z_OFFSET;
  ionianCrust.renderOrder = 8;
  scene.add(ionianCrust);
}

// ─── Hyblean-Malta Escarpment ────────────────────────────────────────────────
// The Hyblean-Maltese Escarpment is the major NNW–SSE-striking fault system
// (~15.3°E in this domain) that separates the Hyblean continental platform to
// the west from the Ionian oceanic crust to the east.  It extends from the
// surface through the entire crust to the Moho (~29 km).
// In scene coords the escarpment strikes N–S (parallel to the Z-axis) at X≈+28 km.

function buildMaltaEscarpment() {
  // Near-vertical plane: full N–S extent, sea level to Moho (Y=0 → Y=−29).
  // Slight eastward tilt (2°) for realism. Position.z = GEO_Z_OFFSET applied below.
  const pts = new Float32Array([
    28,   0, -50,   28,   0,  50,   29.5, -29,  50,
    28,   0, -50,   29.5, -29,  50,   29.5, -29, -50,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhongMaterial({
    color: 0xd0c090, emissive: 0x2a2008,
    specular: 0x604820, shininess: 30,
    transparent: true, opacity: 0.62,
    side: THREE.DoubleSide, depthWrite: false, clippingPlanes: [],
  });

  maltaEscarpment = new THREE.Mesh(geo, mat);
  maltaEscarpment.position.z = GEO_Z_OFFSET;
  maltaEscarpment.renderOrder = 9;
  scene.add(maltaEscarpment);
}

// ─── STEP fault (Slab Tear Edge Propagator) ──────────────────────────────────
// The STEP fault is the lateral tear at the southern/western edge of the
// Calabrian subducting slab.  Slab rollback has propagated this tear southward;
// today it passes close to Etna's domain at ~X=+32 km in our coordinate system.
// The tear allows sub-slab asthenosphere to flow around the slab edge and upwell
// through the slab window — the principal driver of Etna's alkalic volcanism.

function buildSTEPFault() {
  // Sub-vertical tear at the western slab boundary (the slab window edge).
  // Runs from the slab's NW deep corner to the south at Moho depth.
  // South at X=35 (slab floor), north shallows to X=45 at Y=-42 (NE Moho).
  const pts = new Float32Array([
    35, -28,  44,   45, -42, -44,   35, -50,  44,   // tri 1
    35, -50,  44,   45, -42, -44,   45, -50, -44,   // tri 2
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhongMaterial({
    color: 0xd04010, emissive: 0x500c02,
    specular: 0x601808, shininess: 40,
    transparent: true, opacity: 0.70,
    side: THREE.DoubleSide, depthWrite: false, clippingPlanes: [],
  });

  stepFault = new THREE.Mesh(geo, mat);
  stepFault.position.z = GEO_Z_OFFSET;
  stepFault.renderOrder = 9;
  scene.add(stepFault);
}

// ─── Deep magmatic feeder conduit ─────────────────────────────────────────────
// Tapered cylinder representing the inferred deep asthenospheric supply zone.
// Positioned in the slab window west of the STEP fault.  Wider at depth
// (broad mantle source) → narrows toward the lower chamber at Y=−7.6 km.
// The X offset (+6 km) places it slightly east of centre, reflecting the
// upwelling path through the gap between the STEP fault and the Hyblean crust.

function buildMantleConduit() {
  const topY = -7.6, botY = -44.0;
  const h    = topY - botY;         // 36.4 km
  const cy   = (topY + botY) / 2;   // −25.8 km

  const geo = new THREE.CylinderGeometry(
    1.2,   // top radius km — narrow feeder neck into chamber system
    5.5,   // bottom radius km — broad asthenospheric source zone
    h, 32, 1, true
  );

  const mat = new THREE.MeshPhongMaterial({
    color: 0xc04010, emissive: 0x501004,
    specular: 0x441100, shininess: 35,
    transparent: true, opacity: 0.42,
    side: THREE.DoubleSide, depthWrite: false, clippingPlanes: [],
  });

  mantleConduit = new THREE.Mesh(geo, mat);
  mantleConduit.position.set(6, cy, 0); // slightly east to align with slab window
  mantleConduit.renderOrder = 6;
  scene.add(mantleConduit);
}

// ─── Sea level plane ──────────────────────────────────────────────────────────

// ─── Accurate coastline land polygon ─────────────────────────────────────────
// ─── Ocean surface mesh data ──────────────────────────────────────────────────
// Source: Natural Earth 1:10m land polygon, clipped to domain, then subtracted
// from domain rectangle. Delaunay triangulation of the ocean area only.
// Flat [x, z, x, z, …] pairs per triangle vertex (y=0 added in buildCoastlineSea).
// x=east km, z=south km (+Z=south, Three.js convention). 60 triangles.
const OCEAN_VERTS_XZ = new Float32Array([
  -50.0,-50.0,-50.0,-32.6628,-43.0939,-32.1532,-50.0,-50.0,-43.0939,-32.1532,-32.3146,-36.2765,-50.0,-50.0,-32.3146,-36.2765,-29.4092,-38.2432,
  -50.0,-50.0,-29.4092,-38.2432,-26.9321,-40.671,-50.0,-50.0,-26.9321,-40.671,-23.6198,-44.7355,-50.0,-50.0,-23.6198,-44.7355,-22.6489,-45.1514,
  -50.0,-50.0,-22.6489,-45.1514,-9.2569,-47.8822,-50.0,-50.0,-9.2569,-47.8822,-8.4145,-48.0766,-50.0,-50.0,-8.4145,-48.0766,18.8018,-50.0,
  18.8018,-50.0,-8.4145,-48.0766,-5.9374,-47.8822,18.8018,-50.0,-5.9374,-47.8822,-5.0879,-47.4211,18.8018,-50.0,-5.0879,-47.4211,3.1643,-44.2563,
  18.8018,-50.0,3.1643,-44.2563,4.0352,-44.089,18.8018,-50.0,4.0352,-44.089,10.4885,-42.8954,18.8018,-50.0,10.4885,-42.8954,17.57,-47.5883,
  48.949,-50.0,48.8514,-49.4194,50.0,-49.4563,48.949,-50.0,50.0,-49.4563,50.0,-50.0,50.0,50.0,50.0,-49.0414,43.626,-36.6608,
  50.0,50.0,43.626,-36.6608,34.1745,-24.5713,50.0,50.0,34.1745,-24.5713,26.2934,-12.1563,50.0,50.0,26.2934,-12.1563,24.6016,-8.6615,
  50.0,50.0,24.6016,-8.6615,19.0549,5.3631,50.0,50.0,19.0549,5.3631,18.6908,6.4753,50.0,50.0,18.6908,6.4753,16.9989,11.1004,
  50.0,50.0,16.9989,11.1004,15.3999,16.7427,50.0,50.0,15.3999,16.7427,14.1078,20.8117,50.0,50.0,14.1078,20.8117,12.7419,50.0,
  12.7419,50.0,14.1078,20.8117,9.9032,25.8573,12.7419,50.0,9.9032,25.8573,7.5902,32.8379,12.7419,50.0,7.5902,32.8379,7.8115,43.8288,
  12.7419,50.0,7.8115,43.8288,8.2184,45.7005,12.7419,50.0,8.2184,45.7005,9.4463,48.1284,9.4463,48.1284,8.2184,45.7005,8.8181,47.2467,
  -50.0,-32.6628,-47.27,-31.353,-43.0939,-32.1532,-22.6489,-45.1514,-19.7721,-44.9163,-17.9731,-45.0384,-22.6489,-45.1514,-17.9731,-45.0384,-10.085,-47.5115,
  -22.6489,-45.1514,-10.085,-47.5115,-9.2569,-47.8822,-5.0879,-47.4211,-3.5032,-45.3775,-1.8613,-44.8078,-5.0879,-47.4211,-1.8613,-44.8078,3.1643,-44.2563,
  3.1643,-44.2563,-1.8613,-44.8078,0.3802,-44.089,4.0352,-44.089,4.3921,-43.7092,10.4885,-42.8954,10.4885,-42.8954,4.3921,-43.7092,8.9751,-42.0545,
  10.4885,-42.8954,15.3,-44.5908,17.57,-47.5883,24.6016,-8.6615,23.0953,-6.324,19.0549,5.3631,19.0549,5.3631,23.0953,-6.324,18.9121,4.1017,
  18.6908,6.4753,17.4701,7.7366,17.1988,8.8082,18.6908,6.4753,17.1988,8.8082,16.9989,11.1004,16.9989,11.1004,15.9282,14.3556,15.3999,16.7427,
  17.8556,0.8058,18.0055,1.9948,18.4267,-0.7179,-17.9731,-45.0384,-11.3128,-46.7429,-10.085,-47.5115,-3.5032,-45.3775,-2.9178,-44.9163,-1.8613,-44.8078,
  5.2845,-42.2986,5.7628,-41.8103,7.4475,-41.4713,5.2845,-42.2986,7.4475,-41.4713,4.3921,-43.7092,4.3921,-43.7092,7.4475,-41.4713,8.9751,-42.0545,
  20.8966,-4.5066,18.4267,-0.7179,18.9121,4.1017,20.8966,-4.5066,18.9121,4.1017,23.0953,-6.324,18.9121,4.1017,18.4267,-0.7179,18.0055,1.9948,
  9.9032,25.8573,8.2184,28.9498,7.7687,30.8351,9.9032,25.8573,7.7687,30.8351,7.5902,32.8379,43.626,-36.6608,50.0,-49.0414,45.9674,-42.4207
]);

function buildCoastlineSea() {
  // Build ocean mesh directly from pre-triangulated OCEAN_VERTS_XZ data.
  // Avoids Three.js Shape+hole earcut failures when the hole shares edges with
  // the outer rectangle (which happens when the clipped coastline touches all
  // four domain boundaries).
  const xz = OCEAN_VERTS_XZ;
  const pos = new Float32Array((xz.length / 2) * 3);
  for (let i = 0, j = 0; i < xz.length; i += 2, j += 3) {
    pos[j]     = xz[i];      // x (east)
    pos[j + 1] = 0;          // y = sea level
    pos[j + 2] = xz[i + 1]; // z (south)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.MeshBasicMaterial({
    color: 0x1a6699,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    clippingPlanes: [],
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.01; // tiny lift to avoid z-fighting with Y=0 domain top
  seaPlane = new THREE.Group();
  seaPlane.add(mesh);
  seaPlane.position.z = GEO_Z_OFFSET;
  scene.add(seaPlane);
}

// ─── Hazard zone geometry helpers ────────────────────────────────────────────

const _RING_LIFT = 0.10;
const _SEA_Y    = 0.02;
function _rH(x, z) {
  const h = _sampleHeight(x, z);
  return h > 0.01 ? h + _RING_LIFT : _SEA_Y;
}

function _buildHazardRingGeo(rInner, rOuter, N) {
  const positions = [];
  const cx = HAZARD_SUMMIT_X, cz = HAZARD_SUMMIT_Z;
  const K = Math.max(1, Math.ceil((rOuter - rInner) / 1.0));
  for (let k = 0; k < K; k++) {
    const ra = rInner + (rOuter - rInner) * (k / K);
    const rb = rInner + (rOuter - rInner) * ((k + 1) / K);
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const xa0 = cx + Math.cos(a0) * ra, za0 = cz + Math.sin(a0) * ra;
      const xb0 = cx + Math.cos(a0) * rb, zb0 = cz + Math.sin(a0) * rb;
      const xa1 = cx + Math.cos(a1) * ra, za1 = cz + Math.sin(a1) * ra;
      const xb1 = cx + Math.cos(a1) * rb, zb1 = cz + Math.sin(a1) * rb;
      positions.push(xa0, _rH(xa0, za0), za0, xb0, _rH(xb0, zb0), zb0, xb1, _rH(xb1, zb1), zb1);
      positions.push(xa0, _rH(xa0, za0), za0, xb1, _rH(xb1, zb1), zb1, xa1, _rH(xa1, za1), za1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geo;
}

function _buildHazardDiscGeo(rOuter, N) {
  const positions = [];
  const cx = HAZARD_SUMMIT_X, cz = HAZARD_SUMMIT_Z;
  const K = Math.max(1, Math.ceil(rOuter / 1.0));
  const yc = _rH(cx, cz);
  const r0 = rOuter / K;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * r0, z0 = cz + Math.sin(a0) * r0;
    const x1 = cx + Math.cos(a1) * r0, z1 = cz + Math.sin(a1) * r0;
    positions.push(cx, yc, cz, x0, _rH(x0, z0), z0, x1, _rH(x1, z1), z1);
  }
  for (let k = 1; k < K; k++) {
    const ra = rOuter * k / K, rb = rOuter * (k + 1) / K;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const xa0 = cx + Math.cos(a0) * ra, za0 = cz + Math.sin(a0) * ra;
      const xb0 = cx + Math.cos(a0) * rb, zb0 = cz + Math.sin(a0) * rb;
      const xa1 = cx + Math.cos(a1) * ra, za1 = cz + Math.sin(a1) * ra;
      const xb1 = cx + Math.cos(a1) * rb, zb1 = cz + Math.sin(a1) * rb;
      positions.push(xa0, _rH(xa0, za0), za0, xb0, _rH(xb0, zb0), zb0, xb1, _rH(xb1, zb1), zb1);
      positions.push(xa0, _rH(xa0, za0), za0, xb1, _rH(xb1, zb1), zb1, xa1, _rH(xa1, za1), za1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geo;
}

function _buildHazardBorderGeo(radius, N) {
  const pts = [];
  const cx = HAZARD_SUMMIT_X, cz = HAZARD_SUMMIT_Z;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
    pts.push(new THREE.Vector3(x, _rH(x, z) + 0.01, z));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function _buildSmoothedBorderRibbonGeo(radius, halfWidth) {
  const N = 512, W = 11, half = Math.floor(W / 2);
  const cx = HAZARD_SUMMIT_X, cz = HAZARD_SUMMIT_Z;
  const rI = Math.max(0.01, radius - halfWidth), rO = radius + halfWidth;

  const xI = new Float32Array(N), zI = new Float32Array(N);
  const xO = new Float32Array(N), zO = new Float32Array(N);
  const yIr = new Float32Array(N), yOr = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    xI[i] = cx + Math.cos(a) * rI;  zI[i] = cz + Math.sin(a) * rI;
    xO[i] = cx + Math.cos(a) * rO;  zO[i] = cz + Math.sin(a) * rO;
    yIr[i] = _rH(xI[i], zI[i]);
    yOr[i] = _rH(xO[i], zO[i]);
  }

  // Moving-average smooth to remove height-grid coastline spikes
  const yI = new Float32Array(N), yO = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let si = 0, so = 0;
    for (let j = -half; j <= half; j++) {
      si += yIr[(i + j + N) % N];
      so += yOr[(i + j + N) % N];
    }
    yI[i] = si / W;  yO[i] = so / W;
  }

  const positions = [];
  for (let i = 0; i < N; i++) {
    const i1 = (i + 1) % N;
    positions.push(
      xI[i],  yI[i],  zI[i],
      xO[i],  yO[i],  zO[i],
      xO[i1], yO[i1], zO[i1],
      xI[i],  yI[i],  zI[i],
      xO[i1], yO[i1], zO[i1],
      xI[i1], yI[i1], zI[i1],
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geo;
}

function buildHazardZones() {
  if (hazardGroup) { scene.remove(hazardGroup); hazardGroup = null; _hazardObjects.length = 0; }
  hazardGroup = new THREE.Group();
  hazardGroup.visible = false;

  // Four planes that clip hazard meshes to the 100×100 km model domain
  _hazardDomainPlanes = [
    new THREE.Plane(new THREE.Vector3( 1, 0,  0),  50),
    new THREE.Plane(new THREE.Vector3(-1, 0,  0),  50),
    new THREE.Plane(new THREE.Vector3( 0, 0,  1),  50 - GEO_Z_OFFSET),
    new THREE.Plane(new THREE.Vector3( 0, 0, -1),  50 + GEO_Z_OFFSET),
  ];

  const N = 96;

  HAZARD_ZONES.forEach((zone) => {
    const geo = zone.rInner === 0
      ? _buildHazardDiscGeo(zone.rOuter, N)
      : _buildHazardRingGeo(zone.rInner, zone.rOuter, N);

    const mat = new THREE.MeshBasicMaterial({
      color: zone.color,
      transparent: true,
      opacity: zone.alpha,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      clippingPlanes: [..._hazardDomainPlanes],
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.userData.hazardZone = zone;
    hazardGroup.add(mesh);
    _hazardObjects.push(mesh);

    // Boundary ring line
    const bLine = new THREE.Line(
      _buildHazardBorderGeo(zone.rOuter, N),
      new THREE.LineBasicMaterial({
        color: zone.color,
        transparent: true,
        opacity: 0.85,
        depthTest: true,
        clippingPlanes: [..._hazardDomainPlanes],
      }),
    );
    bLine.renderOrder = 3;
    hazardGroup.add(bLine);
  });

  hazardGroup.scale.y = _vertExag;
  scene.add(hazardGroup);
}

// ─── Surface fault overlays ───────────────────────────────────────────────────
// Loads etna-faults.json (5 fault systems in Three.js coords), drapes each
// polyline on the terrain by sampling _sampleHeight(x, z), then adds a small
// 5 m vertical lift so the lines don't z-fight with the terrain mesh.
// All lines are grouped under faultRootGroup whose scale.y tracks _vertExag.

// Fault system visual config: id → { color, label }
const FAULT_SYSTEM_CFG = {
  PFS: { color: 0xff6a00, label: 'Pernicana Fault System',  desc: 'Left-lateral transtensive; active creep' },
  RFS: { color: 0xc966e0, label: 'Ragalna Fault System',    desc: 'Right-lateral transcurrent; seismogenic' },
  RNF: { color: 0xffe040, label: 'Ripe della Naca Faults',  desc: 'Normal dip-slip; NE rift flank' },
  SFS: { color: 0x2ec46a, label: 'South Fault System',      desc: 'Right-lateral strike-slip; volcanic tectonic' },
  TFS: { color: 0x00c8e0, label: 'Timpe Fault System',      desc: 'Normal faults on eastern flank; active' },
};

function buildFaultOverlays() {
  faultRootGroup = new THREE.Group();
  faultRootGroup.scale.y = _vertExag;
  scene.add(faultRootGroup);

  fetch('./etna-faults.json')
    .then(r => r.json())
    .then(data => {
      for (const fs of data.faultSystems) {
        const cfg = FAULT_SYSTEM_CFG[fs.id] || {};
        const color = cfg.color ?? parseInt(fs.color.replace('#', ''), 16);
        const mat = new THREE.LineBasicMaterial({
          color, transparent: true, opacity: 0.85, clippingPlanes: [],
        });

        const group = new THREE.Group();
        group.name = `fault-${fs.id}`;

        for (const seg of fs.lines) {
          const pts = seg.pts;
          const posArr = new Float32Array(pts.length * 3);
          for (let i = 0; i < pts.length; i++) {
            const [x, z] = pts[i];
            posArr[i * 3]     = x;
            posArr[i * 3 + 1] = _sampleHeight(x, z) + 0.005; // 5 m lift
            posArr[i * 3 + 2] = z;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
          const line = new THREE.Line(geo, mat);
          line.renderOrder = 2;
          group.add(line);
        }

        faultRootGroup.add(group);
      }
      updateClipPlanes(); // register fault materials with cross-section plane
    })
    .catch(e => console.warn('[faults] Failed to load etna-faults.json', e));
}


// ─── Seismicity overlay ───────────────────────────────────────────────────────
// 12 k+ earthquake events rendered as InstancedMesh spheres sized by magnitude.
// Depth colour ramp:  0–5 km = orange-red  │  5–15 = orange  │  15–30 = yellow  │  >30 = blue
const SEISMIC_DEPTH_BANDS = [
  { id: 'shallow', label: '0–5 km',   color: 0x44ff00, yMin: -5,  yMax:  0 },
  { id: 'mid',     label: '5–15 km',  color: 0xccff00, yMin: -15, yMax: -5 },
  { id: 'deep',    label: '15–30 km', color: 0xff5500, yMin: -30, yMax:-15 },
  { id: 'vdeep',   label: '>30 km',   color: 0xff0000, yMin: -55, yMax:-30 },
];

// Continuous depth→THREE.Color: shallow=cyan → green → orange → deep=red
function _seismicDepthColor(depthKm) {
  // HSL sweep green→yellow→orange→red across 0–25 km.
  // Normalising to 25 km (not 40) means the full colour range maps onto
  // the actual Etna seismicity distribution rather than bunching at the shallow end.
  const t = Math.min(1, Math.max(0, depthKm / 25));
  const c = new THREE.Color();
  c.setHSL(0.33 * (1 - t), 1.0, 0.50);
  return c;
}

// Magnitude → sphere radius in km.  Reduced scale so events read as points,
// not blobs. ML 1 ≈ 40 m, ML 2 ≈ 75 m, ML 3 ≈ 140 m, ML 4 ≈ 260 m.
function _seismicRadius(ml) {
  return Math.min(0.5, Math.max(0.02, 0.025 * Math.pow(10, 0.4 * ml)));
}

function buildSeismicOverlay() {
  fetch('./etna-seismicity.json')
    .then(r => r.json())
    .then(data => {
      _seismicEvents = data.events; // [[x, z, y, ml, year], …]

      // Low-poly sphere: radius=1, scale set per instance
      const sphereGeo = new THREE.SphereGeometry(1, 8, 5);

      // depthTest:false + high renderOrder = spheres always visible through the
      // geological domain volume and terrain, so the XY distribution is readable
      // from any camera angle including birds-eye.
      const mat = new THREE.MeshPhongMaterial({
        specular: 0x220000, shininess: 30,
        transparent: true, opacity: 0.78,
        depthTest: false, depthWrite: false,
        clippingPlanes: [],
      });

      seismicMesh = new THREE.InstancedMesh(sphereGeo, mat, _seismicEvents.length);
      seismicMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      seismicMesh.renderOrder = 50; // draw after all scene geometry
      seismicMesh.visible = false; // hidden until the Seismicity section is opened
      scene.add(seismicMesh);

      // Thin cyan ring tight around the sphere — 1.05–1.45 × sphere radius in model space
      _seismicSelectionRing = new THREE.Mesh(
        new THREE.RingGeometry(1.05, 1.45, 48),
        new THREE.MeshBasicMaterial({
          color: 0x00ffee,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        })
      );
      _seismicSelectionRing.renderOrder = 55;
      _seismicSelectionRing.visible = false;
      scene.add(_seismicSelectionRing);

      updateSeismicDisplay();
      updateClipPlanes(); // register with cross-section plane
    })
    .catch(e => console.warn('[seismicity] Failed to load etna-seismicity.json', e));
}

function updateSeismicDisplay() {
  if (!seismicMesh || !_seismicEvents) return;

  const dummy    = new THREE.Object3D();
  const events   = _seismicEvents;
  const n        = events.length;
  const mlMin    = _seismicMlMin;
  const dEnabled = _seismicDEnabled;
  let visible    = 0;

  for (let i = 0; i < n; i++) {
    const [x, z, y3d, ml] = events[i]; // y3d = -depth_km
    const depthKm = -y3d;

    let band;
    if      (depthKm <  5) band = 'shallow';
    else if (depthKm < 15) band = 'mid';
    else if (depthKm < 30) band = 'deep';
    else                   band = 'vdeep';

    const show = ml >= mlMin && dEnabled[band];
    if (!show) {
      dummy.scale.setScalar(0); dummy.updateMatrix();
      seismicMesh.setMatrixAt(i, dummy.matrix);
      continue;
    }

    const r = _seismicRadius(ml);
    dummy.position.set(x, y3d, z);
    dummy.scale.setScalar(r);
    dummy.updateMatrix();
    seismicMesh.setMatrixAt(i, dummy.matrix);
    seismicMesh.setColorAt(i, _seismicDepthColor(depthKm));
    visible++;
  }

  seismicMesh.instanceMatrix.needsUpdate = true;
  if (seismicMesh.instanceColor) seismicMesh.instanceColor.needsUpdate = true;
  return visible;
}

// ─── Terrain boundary skirt ───────────────────────────────────────────────────
// Vertical brown walls at domain perimeter for above-sea boundary edges,
// connecting the terrain surface edge down to Y=0 (sea level / domain top).
// Complements the ocean volume walls which handle below-sea edges.

function _buildTerrainSkirt(terrainGeo) {
  const src = terrainGeo.attributes.position;
  const n = src.count;
  const numTris = n / 3;

  // Boundary edge detection using raw float32 bit keys (same STL vertex sharing guarantee)
  const rawF32 = src.array;
  const rawU32 = new Uint32Array(rawF32.buffer, rawF32.byteOffset, rawF32.length);
  function vk(i) { const b = i * 3; return `${rawU32[b]}_${rawU32[b+1]}_${rawU32[b+2]}`; }

  const edgeMap = new Map();
  for (let t = 0; t < numTris; t++) {
    const b = t * 3;
    for (let e = 0; e < 3; e++) {
      const ia = b + e, ib = b + ((e + 1) % 3);
      const ka = vk(ia), kb = vk(ib);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const rec = edgeMap.get(key);
      if (rec) { rec.cnt++; }
      else { edgeMap.set(key, { ia, ib, cnt: 1 }); }
    }
  }

  const walls = [];

  for (const { ia, ib, cnt } of edgeMap.values()) {
    if (cnt !== 1) continue; // interior edge

    let ax = src.getX(ia), ay = src.getY(ia), az = src.getZ(ia);
    let bx = src.getX(ib), by = src.getY(ib), bz = src.getZ(ib);

    if (ay <= 0 && by <= 0) continue; // fully below/at sea level — ocean handles this

    // Clip to above-sea portion: if one endpoint is below Y=0, move it to Y=0
    if (ay < 0) {
      const t0 = -ay / (by - ay);
      ax += t0 * (bx - ax); az += t0 * (bz - az); ay = 0;
    } else if (by < 0) {
      const t0 = -by / (ay - by);
      bx += t0 * (ax - bx); bz += t0 * (az - bz); by = 0;
    }

    // Wall quad from terrain edge down to Y=0 — two triangles
    walls.push(ax, ay, az,  ax, 0, az,  bx, 0, bz);
    walls.push(ax, ay, az,  bx, 0, bz,  bx, by, bz);
  }

  if (walls.length === 0) return;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(walls), 3));
  geo.computeVertexNormals();

  terrainSkirt = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    color: 0x8a7260,
    specular: 0x221111,
    shininess: 12,
    side: THREE.DoubleSide,
    clippingPlanes: [],
  }));
  terrainSkirt.receiveShadow = true;
  scene.add(terrainSkirt);

  // Skirt overdraw — repaints skirt colour over ring bleed after rings render.
  skirtOverdraw = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    color: 0x8a7260, specular: 0x221111, shininess: 12,
    side: THREE.DoubleSide, clippingPlanes: [],
    transparent: true, opacity: 1.0,
    depthTest: true, depthWrite: false,
  }));
  skirtOverdraw.renderOrder = 10;
  scene.add(skirtOverdraw);
}

// ─── Ocean volume ─────────────────────────────────────────────────────────────
// Clips each terrain triangle at Y=0, keeping only truly submerged portions.
// Above-sea triangles are discarded entirely. Mixed triangles are clipped at
// the shoreline. Boundary perimeter edges get vertical walls extruded to Y=0.

function _buildOceanVolumeFromTerrain(terrainGeo) {
  // Build geometry up to MAX_SEA_Y so the slider's full +8 m range is covered.
  // A GPU clip plane (_seaClipPlane) trims the top surface to the current sea
  // level at runtime — no mesh rebuild needed when the slider moves.
  const MAX_SEA_Y = 0.010; // 10 m above datum, comfortably above +8 m slider max

  const src = terrainGeo.attributes.position;
  const numTris = src.count / 3;

  // Clip segment endpoint B→A to Y=cy plane (B below, A above)
  function clipAtY(b, a, cy) {
    const t = (cy - b[1]) / (a[1] - b[1]);
    return [b[0] + t * (a[0] - b[0]), cy, b[2] + t * (a[2] - b[2])];
  }

  // ── Step 1: clip triangles at Y=MAX_SEA_Y (keep parts below) ────────────────
  const triVerts = [];

  for (let t = 0; t < numTris; t++) {
    const b = t * 3;
    const p = [
      [src.getX(b),   src.getY(b),   src.getZ(b)],
      [src.getX(b+1), src.getY(b+1), src.getZ(b+1)],
      [src.getX(b+2), src.getY(b+2), src.getZ(b+2)],
    ];
    const below = p.filter(v => v[1] < MAX_SEA_Y);
    const above = p.filter(v => v[1] >= MAX_SEA_Y);

    if (below.length === 0) continue; // entirely above slider max — discard

    if (below.length === 3) {
      triVerts.push(p[0][0],p[0][1],p[0][2], p[1][0],p[1][1],p[1][2], p[2][0],p[2][1],p[2][2]);
      continue;
    }

    if (below.length === 1) {
      const bv = below[0];
      const c0 = clipAtY(bv, above[0], MAX_SEA_Y);
      const c1 = clipAtY(bv, above[1], MAX_SEA_Y);
      triVerts.push(bv[0],bv[1],bv[2], c0[0],MAX_SEA_Y,c0[2], c1[0],MAX_SEA_Y,c1[2]);
    } else {
      const b0 = below[0], b1 = below[1], av = above[0];
      const c0 = clipAtY(b0, av, MAX_SEA_Y);
      const c1 = clipAtY(b1, av, MAX_SEA_Y);
      triVerts.push(b0[0],b0[1],b0[2], b1[0],b1[1],b1[2], c1[0],MAX_SEA_Y,c1[2]);
      triVerts.push(b0[0],b0[1],b0[2], c1[0],MAX_SEA_Y,c1[2], c0[0],MAX_SEA_Y,c0[2]);
    }
  }

  // ── Step 2: find perimeter boundary edges of the clipped mesh ───────────────
  const P = 500;
  function pk(x, y, z) { return `${Math.round(x*P)}_${Math.round(y*P)}_${Math.round(z*P)}`; }

  const edgeMap = new Map();
  const numClipped = triVerts.length / 9;
  for (let t = 0; t < numClipped; t++) {
    const b = t * 9;
    for (let e = 0; e < 3; e++) {
      const ia = b + e * 3, ib = b + ((e + 1) % 3) * 3;
      const ka = pk(triVerts[ia], triVerts[ia+1], triVerts[ia+2]);
      const kb = pk(triVerts[ib], triVerts[ib+1], triVerts[ib+2]);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const rec = edgeMap.get(key);
      if (rec) { rec.cnt++; }
      else {
        edgeMap.set(key, {
          ax: triVerts[ia], ay: triVerts[ia+1], az: triVerts[ia+2],
          bx: triVerts[ib], by: triVerts[ib+1], bz: triVerts[ib+2],
          cnt: 1,
        });
      }
    }
  }

  // ── Step 3: build vertical walls at domain perimeter ────────────────────────
  const walls = [];
  for (const { ax, ay, az, bx, by, bz, cnt } of edgeMap.values()) {
    if (cnt !== 1) continue;
    if (ay >= MAX_SEA_Y && by >= MAX_SEA_Y) continue;
    walls.push(ax, ay, az,  ax, MAX_SEA_Y, az,  bx, MAX_SEA_Y, bz);
    walls.push(ax, ay, az,  bx, MAX_SEA_Y, bz,  bx, by, bz);
  }

  // ── Step 4: assemble final geometry ─────────────────────────────────────────
  const combined = new Float32Array(triVerts.length + walls.length);
  combined.set(triVerts, 0);
  combined.set(walls, triVerts.length);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(combined, 3));
  geo.computeVertexNormals();

  // Clip plane: keep fragments with world Y <= current sea level.
  // normal=(0,-1,0), constant=seaY → dot((0,-1,0),p)+seaY >= 0 → p.y <= seaY
  _seaClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

  const mat = new THREE.MeshPhongMaterial({
    color: 0x1255a0,
    emissive: 0x06203a,
    specular: 0x4488cc,
    shininess: 40,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    clippingPlanes: [_seaClipPlane],
  });

  if (oceanVolume) { scene.remove(oceanVolume); oceanVolume.geometry.dispose(); }
  oceanVolume = new THREE.Mesh(geo, mat);
  oceanVolume.renderOrder = 11;
  scene.add(oceanVolume);
}

// ─── Magmatic plumbing system ─────────────────────────────────────────────────
// Parameters from 3_chambers.geo (GMSH units → Three.js km)
// Coord transform: X=(gx-50000)/1000, Y=gz/1000, Z=(50000-gy)/1000

function buildChambers() {
  function chamberMat(color, emissive) {
    return new THREE.MeshPhongMaterial({
      color, emissive, specular: 0x441100, shininess: 40,
      side: THREE.DoubleSide, transparent: true, opacity: 0.92, clippingPlanes: [],
    });
  }

  // ── Upper chamber: sphere r=0.25 km at Y=-2 km
  const upperMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 32, 24),
    chamberMat(0xee6622, 0x3a0c00)
  );
  upperMesh.position.set(0, -2, 0);
  scene.add(upperMesh);
  chamberMeshes.push(upperMesh);

  // ── Intermediate chamber: sphere r=0.25 km at Y=-2.85 km
  const midMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 32, 24),
    chamberMat(0xe05518, 0x300a00)
  );
  midMesh.position.set(0, -2.85, 0);
  scene.add(midMesh);
  chamberMeshes.push(midMesh);

  // ── Lower reservoir: oblate spheroid, rx=rz=6 km, ry=0.8 km at Y=-6.8 km
  const lowerMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 40),
    chamberMat(0xc03808, 0x280600)
  );
  lowerMesh.scale.set(6, 0.8, 6);
  lowerMesh.position.set(0, -6.8, 0);
  scene.add(lowerMesh);
  chamberMeshes.push(lowerMesh);

  // ── Conduit 1: upper chamber bottom (Y=-2.25) → intermediate top (Y=-2.6)
  const c1h = 2.6 - 2.25;
  const cond1Mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, c1h, 16),
    chamberMat(0xe06020, 0x300800)
  );
  cond1Mesh.position.set(0, (-2.25 + -2.6) / 2, 0);
  scene.add(cond1Mesh);
  chamberMeshes.push(cond1Mesh);

  // ── Conduit 2: intermediate bottom (Y=-3.1) → lower reservoir top (Y=-6.0)
  const c2h = 6.0 - 3.1;
  const cond2Mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, c2h, 16),
    chamberMat(0xe06020, 0x300800)
  );
  cond2Mesh.position.set(0, (-3.1 + -6.0) / 2, 0);
  scene.add(cond2Mesh);
  chamberMeshes.push(cond2Mesh);
}

// ─── Chamber cross-section fills (2D shapes lying in cut plane) ───────────────
// Each shape starts in the XY plane. rotation.y = π + cutAngle rotates the
// shape's +Z normal onto the cut plane normal (-sin(a), 0, -cos(a)), so the
// mesh lies flat in the cut face regardless of slice direction.
// Chamber centres are all at X=0, Z=0 which satisfies nx*0 + nz*0 = 0 for
// any (nx, nz), so they always lie on the cut plane.

function buildChamberCaps() {
  function capMat(color) {
    return new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  function addCap(geo, color, x, y, z) {
    const m = new THREE.Mesh(geo, capMat(color));
    m.position.set(x, y, z);
    m.visible = false;
    scene.add(m);
    chamberCapMeshes.push(m);
  }

  // Upper chamber — circle r=0.25 km at Y=-2
  addCap(new THREE.CircleGeometry(0.25, 64), 0xee6622, 0, -2, 0);

  // Intermediate chamber — circle r=0.25 km at Y=-2.85
  addCap(new THREE.CircleGeometry(0.25, 64), 0xe05518, 0, -2.85, 0);

  // Lower reservoir — ellipse rx=6, ry=0.8 km at Y=-6.8
  // Cross-section of an oblate spheroid (rx=rz=6, ry=0.8) on any vertical
  // plane through its centre is always the same ellipse (6 × 0.8 km), because
  // the horizontal radii are equal.
  const ellipseShape = new THREE.Shape();
  ellipseShape.absellipse(0, 0, 6, 0.8, 0, Math.PI * 2, false, 0);
  addCap(new THREE.ShapeGeometry(ellipseShape, 128), 0xc03808, 0, -6.8, 0);

  // Conduit 1 — thin rect, width=2*r=0.09 km, Y=-2.25 → -2.6
  addCap(new THREE.PlaneGeometry(0.09, 0.35), 0xe06020, 0, -2.425, 0);

  // Conduit 2 — thin rect, width=0.09 km, Y=-3.1 → -6.0
  addCap(new THREE.PlaneGeometry(0.09, 2.9), 0xe06020, 0, -4.55, 0);
}

function updateChamberCaps() {
  // Visible whenever cross-section is active — independent of cap face toggle
  const visible = crossSectionEnabled;
  const rotY = Math.PI + (crossSectionAngle * Math.PI) / 180;
  chamberCapMeshes.forEach((m) => {
    m.visible = visible;
    m.rotation.y = rotY;
  });
}

// ─── Cross-section cap ────────────────────────────────────────────────────────
// Intersects the cross-section plane with every terrain triangle, then drops
// each intersection segment vertically to the domain bottom (Y=-50 km).
// Result: a cap face that exactly follows the terrain surface profile —
// connected to the terrain above, the domain sides, and the bottom face.
// Geometry is rebuilt in world-space on demand (debounced, not every frame).

function buildCrossSectionCap() {
  const capGeo = new THREE.BufferGeometry();
  crossSectionCap = new THREE.Mesh(
    capGeo,
    new THREE.MeshPhongMaterial({
      color: 0x7a5c44,
      specular: 0x1a0c06,
      shininess: 6,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  crossSectionCap.visible = false;
  scene.add(crossSectionCap);

  // Overdraw clone — shares geometry so it auto-updates with _rebuildCapGeometry.
  // Renders at rO=10 (transparent pass, after rings) to repaint cap face over
  // any hazard-ring bleed on the cross-section plane.
  crossSectionCapOverdraw = new THREE.Mesh(
    capGeo,
    new THREE.MeshPhongMaterial({
      color: 0x7a5c44, specular: 0x1a0c06, shininess: 6,
      side: THREE.DoubleSide,
      transparent: true, opacity: 1.0,
      depthTest: true, depthWrite: false,
    })
  );
  crossSectionCapOverdraw.visible = false;
  crossSectionCapOverdraw.renderOrder = 10;
  scene.add(crossSectionCapOverdraw);
}

function _rebuildCapGeometry() {
  if (!crossSectionCap || !_crossCapTerrainGeo || !crossSectionEnabled) return;

  const rad = (crossSectionAngle * Math.PI) / 180;
  const nx = -Math.sin(rad), nz = -Math.cos(rad);
  const src = _crossCapTerrainGeo.attributes.position;
  const numTris = src.count / 3;
  const BOTTOM = -DOMAIN_H; // -50 km

  const verts = [];

  for (let t = 0; t < numTris; t++) {
    const b = t * 3;
    // Signed distance from cross-section plane (nx·x + nz·z = 0)
    const d0 = nx * src.getX(b)   + nz * src.getZ(b);
    const d1 = nx * src.getX(b+1) + nz * src.getZ(b+1);
    const d2 = nx * src.getX(b+2) + nz * src.getZ(b+2);

    // Find the two edge crossings for this triangle
    const crosses = [];
    for (const [ea, eb, da, db] of [[0,1,d0,d1],[1,2,d1,d2],[2,0,d2,d0]]) {
      if ((da >= 0) !== (db >= 0)) {
        const f = da / (da - db);
        const ia = b + ea, ib = b + eb;
        crosses.push([
          src.getX(ia) + f * (src.getX(ib) - src.getX(ia)),
          src.getY(ia) + f * (src.getY(ib) - src.getY(ia)),
          src.getZ(ia) + f * (src.getZ(ib) - src.getZ(ia)),
        ]);
      }
    }
    if (crosses.length !== 2) continue;

    // Intersection points are already in world space on the cut plane.
    // Drop each point to BOTTOM — vertical fill quad.
    const [Ax, Ay, Az] = crosses[0];
    const [Bx, By, Bz] = crosses[1];
    verts.push(
      Ax, Ay,     Az,   Bx, By,     Bz,   Bx, BOTTOM, Bz,
      Ax, Ay,     Az,   Bx, BOTTOM, Bz,   Ax, BOTTOM, Az,
    );
  }

  const attr = new THREE.BufferAttribute(new Float32Array(verts), 3);
  crossSectionCap.geometry.setAttribute('position', attr);
  crossSectionCap.geometry.computeVertexNormals();
  crossSectionCap.geometry.computeBoundingSphere();
}

function updateCrossSectionCap() {
  if (!crossSectionCap) return;
  const capVis = crossSectionEnabled && showCapFace;
  crossSectionCap.visible = capVis;
  if (crossSectionCapOverdraw) crossSectionCapOverdraw.visible = capVis;
  updateChamberCaps();
  if (!crossSectionEnabled) return;
  clearTimeout(_crossCapRebuildTimer);
  _crossCapRebuildTimer = setTimeout(_rebuildCapGeometry, 60);
}

// ─── Monitoring stations ──────────────────────────────────────────────────────

// Station markers are DOM pins — no 3D sphere geometry needed
// Reusable vectors — declared once to avoid per-frame GC pressure
const _vDir   = new THREE.Vector3(); // compass camera direction
const _scP0   = new THREE.Vector3(); // scale bar projected point 0
const _scP1   = new THREE.Vector3(); // scale bar projected point 1
const _lblTemp = new THREE.Vector3(); // updateLabelPositions scratch
const _lblToStn = new THREE.Vector3(); // updateLabelPositions scratch

function buildStations() {
  // Station markers are DOM pins built in buildLabels() — nothing to add to scene.
  Object.keys(ALL_STATIONS).forEach(type => {
    stationMarkersByType[type] = [];
    stationDOMByType[type] = [];
  });
}

// ─── Labels ───────────────────────────────────────────────────────────────────

// Surface POI labels → Three.js sprites built in etnaLabelLayer (see etna-label-layer.js).
// Station labels → lightweight DOM text spans (137 items).
function buildLabels() {
  const overlay = document.getElementById('label-overlay');
  if (!overlay) return;

  Object.entries(ALL_STATIONS).forEach(([type, list]) => {
    const cfg = STATION_CFG[type];
    list.forEach(([name, x, y, z]) => {
      const pin = document.createElement('div');
      pin.className = 'stn-pin';
      pin.style.display = 'none'; // hidden until toggled on
      const nameEl = document.createElement('span');
      nameEl.className = 'stn-pin-name';
      nameEl.textContent = name;
      nameEl.style.color = cfg.hex;
      const tri = document.createElement('span');
      tri.className = 'stn-pin-tri';
      tri.style.borderTopColor = cfg.hex;
      pin.appendChild(nameEl);
      pin.appendChild(tri);
      overlay.appendChild(pin);
      stationDOMByType[type].push(pin);
      labels.push({ el: pin, pos: new THREE.Vector3(x, y, z + GEO_Z_OFFSET), origY: y, type: 'station', stationType: type });
    });
  });
}

// Height-grid line-of-sight terrain occlusion — O(STEPS) grid lookups per station,
// far cheaper than raycasting 37k terrain triangles. Marches from `from` to `to`
// and returns true if terrain (×vertExag) rises above the LOS at any sample point.
const _LOS_STEPS = 14;
function _terrainOccludesLOS(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  for (let i = 1; i <= _LOS_STEPS; i++) {
    const t  = i / (_LOS_STEPS + 1);
    const sy = from.y + t * dy;
    const th = _sampleHeight(from.x + t * dx, from.z + t * dz) * _vertExag;
    if (th > sy + 0.05) return true;
  }
  return false;
}

function updateLabelPositions() {
  const w    = renderer.domElement.clientWidth;
  const h    = renderer.domElement.clientHeight;
  const temp = _lblTemp;
  const toStn = _lblToStn;

  const occluders = [];
  if (domainBox && domainBox.visible) occluders.push(domainBox);

  labels.forEach(({ el, pos, stationType }) => {
    if (!(showStationType[stationType] ?? true)) { el.style.display = 'none'; return; }

    temp.copy(pos).project(camera);
    if (temp.z > 1) { el.style.display = 'none'; return; }

    if (crossSectionEnabled && clipPlane && clipPlane.distanceToPoint(pos) < 0) {
      el.style.display = 'none'; return;
    }

    // Hide if station is below the terrain surface at its own XZ position
    const surfaceH = _sampleHeight(pos.x, pos.z) * _vertExag;
    if (pos.y < surfaceH - 0.15) { el.style.display = 'none'; return; }

    // Domain-box raycast occlusion
    toStn.subVectors(pos, camera.position);
    const dist = toStn.length();
    occluderRay.set(camera.position, toStn.multiplyScalar(1 / dist));
    occluderRay.near = 0;
    occluderRay.far  = dist * 0.95;
    if (occluderRay.intersectObjects(occluders, true).length > 0) {
      el.style.display = 'none'; return;
    }

    // Terrain LOS occlusion — catches stations visible through the surface or far side
    if (_terrainOccludesLOS(camera.position, pos)) { el.style.display = 'none'; return; }

    el.style.display = '';
    el.style.left    = ((temp.x * 0.5 + 0.5) * w) + 'px';
    el.style.top     = ((-temp.y * 0.5 + 0.5) * h) + 'px';
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
  if (terrainSkirt) applyPlanes(terrainSkirt);
  if (skirtOverdraw) applyPlanes(skirtOverdraw);
  if (seaPlane) applyPlanes(seaPlane);
  // Ocean volume always carries _seaClipPlane alongside any cross-section plane
  if (oceanVolume) {
    const seaP = _seaClipPlane ? [_seaClipPlane] : [];
    oceanVolume.material.clippingPlanes = [...planes, ...seaP];
  }
  if (domainBox) applyPlanes(domainBox);
  if (domainOverdraw) applyPlanes(domainOverdraw);
  if (ionianSlab) applyPlanes(ionianSlab);
  if (ionianCrust) applyPlanes(ionianCrust);
  if (maltaEscarpment) applyPlanes(maltaEscarpment);
  if (stepFault) applyPlanes(stepFault);
  if (mantleConduit) applyPlanes(mantleConduit);
  chamberMeshes.forEach(applyPlanes);
  if (faultRootGroup) applyPlanes(faultRootGroup);
  if (seismicMesh)    applyPlanes(seismicMesh);

  // Hazard rings: combine domain boundary planes with cross-section plane
  if (hazardGroup && _hazardDomainPlanes) {
    const allPlanes = crossSectionEnabled
      ? [..._hazardDomainPlanes, clipPlane]
      : [..._hazardDomainPlanes];
    hazardGroup.traverse((child) => {
      if (!child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => { m.clippingPlanes = allPlanes; });
    });
  }

  // Overlay ShaderMaterial: sync cross-section clip via explicit uniforms
  // (material.clippingPlanes is not honoured for ShaderMaterial without full
  //  clipping-plane GLSL infrastructure, so we pass the plane directly).
  if (hazardOverlayMesh && hazardOverlayMesh.material.uniforms) {
    const u = hazardOverlayMesh.material.uniforms;
    const on = crossSectionEnabled && !!clipPlane;
    u.uClipEnabled.value = on ? 1.0 : 0.0;
    if (on) {
      u.uClipNormal.value.copy(clipPlane.normal);
      u.uClipConst.value = clipPlane.constant;
    }
  }
}

// ─── Vertical exaggeration ────────────────────────────────────────────────────
// Scales all above-sea surface elements uniformly in Y around sea level (Y=0).
// Station markers and labels are updated individually so they track the surface.

function applyVertExag(factor) {
  _vertExag = factor;
  if (surfaceMesh)       surfaceMesh.scale.y       = factor;
  if (hazardOverlayMesh) hazardOverlayMesh.scale.y = factor;
  if (terrainSkirt) terrainSkirt.scale.y = factor;
  if (skirtOverdraw)    skirtOverdraw.scale.y  = factor;
  if (hazardGroup)      hazardGroup.scale.y     = factor;
  if (faultRootGroup)   faultRootGroup.scale.y  = factor;
  labels.forEach(lbl => { if (lbl.origY !== undefined) lbl.pos.y = lbl.origY * factor; });
  if (etnaLabelLayer) applyEtnaLabelVertExag(etnaLabelLayer.entries, factor);
}

function setCrossSectionAngle(deg) {
  crossSectionAngle = deg;
  const rad = (deg * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const nz = -Math.cos(rad);
  clipPlane.set(new THREE.Vector3(nx, 0, nz), 0);

}

// ─── Context HUD + cursor readout + scale bar ─────────────────────────────────

const raycaster = new THREE.Raycaster();
const occluderRay = new THREE.Raycaster(); // reused each frame for label occlusion
const clickRay    = new THREE.Raycaster(); // raycasts on pointer up for POI selection
const mouse = new THREE.Vector2();
let _mouseActive = false;

// DOM refs — populated in setupUI
let _cursorReadout = null, _scaleReadout = null;
let _scaleLabel0 = null, _scaleLabel1 = null, _scaleLabel2 = null;
let _scaleLabel3 = null, _scaleLabel4 = null, _scaleLabel5 = null;
let _scTemp = null, _scPressure = null, _scContext = null;
let _compassAnchor = null;

// Nice scale-bar distances in metres
const _NICE_DIST = [1,2,5,10,20,50,100,200,500,1000,2000,5000,10000,20000,50000];

function _formatScaleLabel(m) {
  if (m >= 1000) return `${m / 1000} km`;
  return `${m} m`;
}

// International Standard Atmosphere at elevation h metres
function _isaTemp(h)     { return (15 - 0.0065 * h).toFixed(1) + ' °C'; }
function _isaPressMb(h)  {
  const p = 1013.25 * Math.pow(1 - 0.0065 * h / 288.15, 5.2561);
  return p.toFixed(0) + ' hPa';
}

function onMouseMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
  _mouseActive = true;
}

function onMouseLeave() { _mouseActive = false; }

function updateContextHUD() {
  raycaster.setFromCamera(mouse, camera);

  let hitPoint = null;
  if (_mouseActive && surfaceMesh && surfaceMesh.visible) {
    const hits = raycaster.intersectObject(surfaceMesh);
    if (hits.length > 0) hitPoint = hits[0].point;
  }

  // ── Cursor readout: lat / lon / elevation ───────────────────────────────────
  if (_cursorReadout) {
    if (hitPoint) {
      const elevM = hitPoint.y * 1000; // scene Y in km → metres
      const lon = SAT_LON_W + (hitPoint.x + 50) / 100 * (SAT_LON_E - SAT_LON_W);
      const lat = SAT_LAT_N - (hitPoint.z + 50) / 100 * (SAT_LAT_N - SAT_LAT_S);
      const elevSign = elevM >= 0 ? '+' : '';
      const elevCol = elevM >= 0 ? '#a8d4a0' : '#7ab2e8';
      _cursorReadout.hidden = false;
      _cursorReadout.innerHTML =
        `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E &nbsp;|&nbsp; ` +
        `<span style="color:${elevCol}">${elevSign}${Math.round(elevM)} m</span>`;
    } else {
      _cursorReadout.hidden = true;
    }
  }

  // ── Surface conditions: ISA temp + pressure at cursor elevation ─────────────
  if (_scTemp && _scPressure) {
    if (hitPoint) {
      const elevM = hitPoint.y * 1000;
      _scTemp.textContent = _isaTemp(elevM);
      _scPressure.textContent = _isaPressMb(elevM);
      if (_scContext) _scContext.textContent = 'SURFACE ISA';
    } else {
      _scTemp.textContent = '—';
      _scPressure.textContent = '—';
      if (_scContext) _scContext.textContent = 'ATMOS. EST.';
    }
  }

  // ── Scale bar ────────────────────────────────────────────────────────────────
  if (_scaleReadout) {
    const cEl = renderer.domElement;
    const cW = cEl.clientWidth;

    // Project two terrain-level scene points 1 km apart
    const p0 = _scP0.set(0, 0, 0).project(camera);
    const p1 = _scP1.set(1, 0, 0).project(camera);
    const pxPerKm = Math.abs(p1.x - p0.x) * 0.5 * cW;

    if (pxPerKm < 0.5) { _scaleReadout.hidden = true; return; }

    const mPerPx = 1000 / pxPerKm;
    const barPx = 168; // 10.5rem @ 16px
    const fullBarM = mPerPx * barPx;

    let niceDist = _NICE_DIST[0];
    for (const d of _NICE_DIST) { if (d <= fullBarM * 0.85) niceDist = d; else break; }

    _scaleReadout.hidden = false;

    // Three labels only: 0 | midpoint (no unit) | total (with unit).
    // Slots 1, 2, 4 are blanked so the bar stays uncluttered.
    const half = niceDist / 2;
    const halfStr = half >= 1000 ? `${half / 1000}` : `${half}`;
    if (_scaleLabel0) { _scaleLabel0.textContent = '0';                          _scaleLabel0.style.left = '0%';   _scaleLabel0.style.transform = 'none'; }
    if (_scaleLabel1) { _scaleLabel1.textContent = '';                            _scaleLabel1.style.left = '12.5%'; }
    if (_scaleLabel2) { _scaleLabel2.textContent = '';                            _scaleLabel2.style.left = '25%'; }
    if (_scaleLabel3) { _scaleLabel3.textContent = halfStr;                       _scaleLabel3.style.left = '50%';  _scaleLabel3.style.transform = 'translateX(-50%)'; }
    if (_scaleLabel4) { _scaleLabel4.textContent = '';                            _scaleLabel4.style.left = '75%'; }
    if (_scaleLabel5) { _scaleLabel5.textContent = _formatScaleLabel(niceDist);  _scaleLabel5.style.left = '100%'; _scaleLabel5.style.transform = 'translateX(-100%)'; }
  }

  // Hazard zone hover cursor
  if (!measureMode && hazardGroup && hazardGroup.visible && _hazardObjects.length > 0 && _mouseActive) {
    const hazardHits = raycaster.intersectObjects(_hazardObjects, false);
    if (hazardHits.length > 0) renderer.domElement.style.cursor = 'pointer';
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

// ─── Satellite basemap ────────────────────────────────────────────────────────

// Decode a Blob into a Canvas using <img> + createObjectURL — works on all
// browsers including iOS Safari where createImageBitmap is absent or buggy.
function _blobToCanvas(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function fetchSatelliteTiles() {
  const bbox = `${SAT_GRID_LON_W.toFixed(6)},${SAT_GRID_LAT_S.toFixed(6)},${SAT_GRID_LON_E.toFixed(6)},${SAT_GRID_LAT_N.toFixed(6)}`;
  const cols = SAT_X1 - SAT_X0 + 1; // 28
  const rows = SAT_Y1 - SAT_Y0 + 1; // 30
  // Cap to the device's actual WebGL texture limit — mobile GPUs are often 2048.
  const maxTex = renderer.capabilities.maxTextureSize;
  const scale  = Math.min(maxTex / (cols * 256), maxTex / (rows * 256));
  const w = Math.round(cols * 256 * scale);
  const h = Math.round(rows * 256 * scale);
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&size=${w},${h}&imageSR=4326&format=jpg&f=image`;

  const resp = await fetch(url, { mode: 'cors' });
  if (!resp.ok) throw new Error(`Satellite export fetch failed: ${resp.status}`);
  return _blobToCanvas(await resp.blob());
}

async function applyBasemap(mode) {
  basemapMode = mode;
  if (!surfaceMesh) return;
  if (mode === 'satellite') {
    if (!satelliteTexture) {
      setStatus('Loading satellite imagery…');
      try {
        let canvas;

        // Try IDB-cached composite blob first (skips 840 tile fetches + canvas assembly)
        const cachedBlob = await _idbGet(SAT_CACHE_KEY);
        if (cachedBlob) {
          canvas = await _blobToCanvas(cachedBlob);
        } else {
          canvas = await fetchSatelliteTiles();
          // Persist the composite as JPEG for fast reconstruction on next load
          canvas.toBlob(blob => { if (blob) _idbSet(SAT_CACHE_KEY, blob); }, 'image/jpeg', 0.93);
        }

        satelliteTexture = new THREE.CanvasTexture(canvas);
        satelliteTexture.flipY = false;
      } catch (e) {
        console.error('Satellite tile fetch failed', e);
        setStatus('Satellite imagery unavailable.', true);
        return;
      }
      setStatus('');
    }
    surfaceMesh.material.map = satelliteTexture;
    surfaceMesh.material.color.set(0xffffff);
  } else {
    surfaceMesh.material.map = null;
    surfaceMesh.material.color.set(0x8a7260);
  }
  surfaceMesh.material.needsUpdate = true;
}

// ─── UI setup ────────────────────────────────────────────────────────────────

function setupUI() {
  // ── Measurement DOM refs ────────────────────────────────────────────────────
  _measureCopy           = document.getElementById('measure-copy');
  _measurePanel          = document.getElementById('measure-panel');
  _measureMetric         = document.getElementById('measure-metric');
  _measureExport         = document.getElementById('measure-export');
  _profileCanvas         = document.getElementById('profile-canvas');
  _measureResultCard     = document.getElementById('measurement-result-card');
  _measureResultTitle    = document.getElementById('measurement-result-title');
  _measureResultBody     = document.getElementById('measurement-result-body');
  _profileModal          = document.getElementById('profile-modal');
  _profileModalTitle     = document.getElementById('profile-modal-title');
  _profileModalSummary   = document.getElementById('profile-modal-summary');
  _profileModalCanvas    = document.getElementById('profile-modal-canvas');
  _profileModalExportPng = document.getElementById('profile-modal-export-png');
  _profileModalClose     = document.getElementById('profile-modal-close');
  _measureDistanceBtn    = document.getElementById('measure-distance');
  _measureAreaBtn        = document.getElementById('measure-area');
  _measureProfileBtn     = document.getElementById('measure-profile');
  _toolRailDistanceBtn   = document.getElementById('tool-rail-distance');
  _toolRailAreaBtn       = document.getElementById('tool-rail-area');
  _toolRailProfileBtn    = document.getElementById('tool-rail-profile');
  _measureRailButtons    = [...document.querySelectorAll('[data-measure-mode]')];
  _measureRailActionGroups = [...document.querySelectorAll('[data-measure-actions]')];
  _measureRailExportButtons = [...document.querySelectorAll('[data-measure-export]')];

  if (_measureDistanceBtn) { _measureDistanceBtn.dataset.mode = 'distance'; _measureDistanceBtn.addEventListener('click', () => _setMeasureMode('distance')); }
  if (_measureAreaBtn)     { _measureAreaBtn.dataset.mode = 'area';         _measureAreaBtn.addEventListener('click',     () => _setMeasureMode('area')); }
  if (_measureProfileBtn)  { _measureProfileBtn.dataset.mode = 'profile';   _measureProfileBtn.addEventListener('click',  () => _setMeasureMode('profile')); }
  _measureRailButtons.forEach(btn => btn.addEventListener('click', () => _setMeasureMode(btn.dataset.measureMode)));
  _measureRailExportButtons.forEach(btn => btn.addEventListener('click', _exportMeasureCsv));
  if (_measureExport) _measureExport.addEventListener('click', _exportMeasureCsv);
  if (_profileModalClose)     _profileModalClose.addEventListener('click', _hideProfileModal);
  if (_profileModalExportPng) _profileModalExportPng.addEventListener('click', _exportProfilePng);

  // Escape key closes profile modal
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _hideProfileModal(); });

  // Grab HUD DOM refs used across the render loop
  _cursorReadout = document.getElementById('cursor-readout');
  _scaleReadout  = document.getElementById('scale-readout');
  _scaleLabel0   = document.getElementById('scale-label-0');
  _scaleLabel1   = document.getElementById('scale-label-1');
  _scaleLabel2   = document.getElementById('scale-label-2');
  _scaleLabel3   = document.getElementById('scale-label-3');
  _scaleLabel4   = document.getElementById('scale-label-4');
  _scaleLabel5   = document.getElementById('scale-label-5');
  _scTemp        = document.getElementById('sc-temp');
  _scPressure    = document.getElementById('sc-pressure');
  _scContext     = document.getElementById('sc-context');
  _compassAnchor = document.getElementById('compass-anchor');

  // mouseleave clears cursor readout when pointer leaves the canvas
  // (mousemove is already registered on renderer.domElement in init())
  document.addEventListener('mouseleave', onMouseLeave);

  const uiPanel = document.getElementById('ui');
  const navCollapseBtn = document.getElementById('nav-collapse-btn');
  const navTab = document.getElementById('nav-tab');

  if (uiPanel && navCollapseBtn && navTab) {
    openPanel();
    if (isMobileLayout()) closePanel();

    navCollapseBtn.addEventListener('click', closePanel);
    navTab.addEventListener('click', openPanel);
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
      updateCrossSectionCap();
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

  // Cross-section cap face toggle
  const capToggle = document.getElementById('cap-face-toggle');
  if (capToggle) {
    capToggle.addEventListener('change', () => {
      showCapFace = capToggle.checked;
      updateCrossSectionCap();
    });
  }

  // Surface toggle
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
      if (oceanVolume) oceanVolume.visible = seaToggle.checked;
    });
  }

  // Geological domain block
  const domainToggle = document.getElementById('domain-toggle');
  if (domainToggle) {
    domainToggle.addEventListener('change', () => {
      if (domainBox) domainBox.visible = domainToggle.checked;
      if (domainEdges) domainEdges.visible = domainToggle.checked;
      if (domainLayerEdges) domainLayerEdges.visible = domainToggle.checked;
    });
  }

  // Ionian slab + crust (treated as one feature)
  const slabToggle = document.getElementById('ionian-slab-toggle');
  if (slabToggle) {
    slabToggle.addEventListener('change', () => {
      const on = slabToggle.checked;
      if (ionianSlab)  ionianSlab.visible  = on;
      if (ionianCrust) ionianCrust.visible  = on;
    });
  }

  // Malta Escarpment toggle
  const escarpToggle = document.getElementById('malta-escarpment-toggle');
  if (escarpToggle) {
    escarpToggle.addEventListener('change', () => {
      if (maltaEscarpment) maltaEscarpment.visible = escarpToggle.checked;
    });
  }

  // STEP fault toggle
  const stepToggle = document.getElementById('step-fault-toggle');
  if (stepToggle) {
    stepToggle.addEventListener('change', () => {
      if (stepFault) stepFault.visible = stepToggle.checked;
    });
  }

  // Mantle conduit toggle
  const conduitToggle = document.getElementById('mantle-conduit-toggle');
  if (conduitToggle) {
    conduitToggle.addEventListener('change', () => {
      if (mantleConduit) mantleConduit.visible = conduitToggle.checked;
    });
  }

  // ── Seismicity controls ──────────────────────────────────────────────────────
  const seismicMaster = document.getElementById('seismicity-master-toggle');
  if (seismicMaster) {
    seismicMaster.addEventListener('change', () => {
      if (seismicMesh) seismicMesh.visible = seismicMaster.checked;
    });
  }

  const seismicMlSlider = document.getElementById('seismic-ml-slider');
  const seismicMlValue  = document.getElementById('seismic-ml-value');
  if (seismicMlSlider) {
    seismicMlSlider.addEventListener('input', () => {
      _seismicMlMin = parseFloat(seismicMlSlider.value);
      if (seismicMlValue) seismicMlValue.textContent = `≥ ${_seismicMlMin.toFixed(1)}`;
      updateSeismicDisplay();
    });
  }

  ['shallow', 'mid', 'deep', 'vdeep'].forEach(band => {
    const el = document.getElementById(`seismic-${band}-toggle`);
    if (!el) return;
    el.addEventListener('change', () => {
      _seismicDEnabled[band] = el.checked;
      updateSeismicDisplay();
    });
  });

  // ── Surface fault system toggles ────────────────────────────────────────────
  const FAULT_IDS = ['PFS', 'RFS', 'RNF', 'SFS', 'TFS'];
  const faultMaster = document.getElementById('faults-master-toggle');

  function getFaultGroup(id) {
    if (!faultRootGroup) return null;
    return faultRootGroup.children.find(g => g.name === `fault-${id}`) ?? null;
  }

  FAULT_IDS.forEach(id => {
    const el = document.getElementById(`fault-${id.toLowerCase()}-toggle`);
    if (!el) return;
    el.addEventListener('change', () => {
      const g = getFaultGroup(id);
      if (g) g.visible = el.checked;
    });
  });

  if (faultMaster) {
    faultMaster.addEventListener('change', () => {
      const on = faultMaster.checked;
      FAULT_IDS.forEach(id => {
        const sub = document.getElementById(`fault-${id.toLowerCase()}-toggle`);
        if (sub) { sub.checked = on; const g = getFaultGroup(id); if (g) g.visible = on; }
      });
    });
  }

  // Station type toggles (Stations section)
  Object.keys(ALL_STATIONS).forEach(type => {
    const id = `stn-${type.toLowerCase()}-toggle`;
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      showStationType[type] = el.checked;
      (stationDOMByType[type] || []).forEach(pin => { pin.style.display = el.checked ? '' : 'none'; });
    });
  });
  // Stations master toggle
  const stationsMaster = document.getElementById('stations-master-toggle');
  if (stationsMaster) {
    stationsMaster.addEventListener('change', () => {
      const on = stationsMaster.checked;
      Object.keys(ALL_STATIONS).forEach(type => {
        const id = `stn-${type.toLowerCase()}-toggle`;
        const sub = document.getElementById(id);
        if (sub) sub.checked = on;
        showStationType[type] = on;
        (stationDOMByType[type] || []).forEach(pin => { pin.style.display = on ? '' : 'none'; });
      });
    });
  }

  // POI category toggles (Locations section)
  ['settlement', 'fault', 'vent', 'fissure', 'general'].forEach(theme => {
    const el = document.getElementById(`label-${theme}-toggle`);
    if (el) el.addEventListener('change', () => { categoryEnabled[theme] = el.checked; });
  });
  const locationsMasterToggle = document.getElementById('locations-master-toggle');
  if (locationsMasterToggle) {
    locationsMasterToggle.addEventListener('change', () => {
      const on = locationsMasterToggle.checked;
      ['settlement', 'fault', 'vent', 'fissure', 'general'].forEach(theme => {
        categoryEnabled[theme] = on;
        const sub = document.getElementById(`label-${theme}-toggle`);
        if (sub) sub.checked = on;
      });
    });
  }

  // POI popup close
  const popupClose = document.getElementById('scene-popup-close');
  if (popupClose) popupClose.addEventListener('click', hideFeaturePopup);

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

  // Video popup
  const videoBtn     = document.getElementById('etna-video-btn');
  const videoOverlay = document.getElementById('etna-video-overlay');
  const videoClose   = document.getElementById('etna-video-close');
  const videoEl      = document.getElementById('etna-video-el');
  if (videoBtn && videoOverlay) {
    videoBtn.addEventListener('click', () => { videoOverlay.hidden = false; });
  }
  if (videoClose && videoOverlay) {
    videoClose.addEventListener('click', () => { videoOverlay.hidden = true; if (videoEl) videoEl.pause(); });
  }
  if (videoOverlay) {
    videoOverlay.addEventListener('click', (e) => {
      if (e.target === videoOverlay) { videoOverlay.hidden = true; if (videoEl) videoEl.pause(); }
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

  // Basemap selector
  const basemapSelect = document.getElementById('basemap-select');
  if (basemapSelect) {
    basemapSelect.addEventListener('change', () => {
      applyBasemap(basemapSelect.value);
    });
  }

  // Vertical exaggeration slider
  const vertExagSlider = document.getElementById('vert-exag-slider');
  const vertExagValue  = document.getElementById('vert-exag-value');
  if (vertExagSlider) {
    vertExagSlider.addEventListener('input', () => {
      const v = parseFloat(vertExagSlider.value);
      if (vertExagValue) vertExagValue.textContent = `${v.toFixed(1)}×`;
      applyVertExag(v);
    });
  }

  // LOD / label density slider
  const lodSlider     = document.getElementById('lod-slider');
  const lodValueLabel = document.getElementById('lod-value-label');
  const LOD_LABELS    = ['', 'Landmarks only', 'Major features', 'All features'];
  function syncLodLabel() {
    if (lodValueLabel) lodValueLabel.textContent = LOD_LABELS[currentLodLevel] || 'All features';
  }
  syncLodLabel();
  if (lodSlider) {
    lodSlider.addEventListener('input', () => {
      currentLodLevel = parseInt(lodSlider.value, 10);
      syncLodLabel();
    });
  }

  // Feature search — exact same pattern as Mars viewer
  const featureSearch    = document.getElementById('feature-search');
  const featureSearchGo  = document.getElementById('feature-search-go');
  const featureSearchRes = document.getElementById('feature-search-results');

  // Build flat search pool from POIs + station names
  const _searchPool = [];
  for (const poi of ETNA_POIS) {
    _searchPool.push({ name: poi.name, type: poi.kicker, poi });
  }
  Object.entries(ALL_STATIONS).forEach(([type, list]) => {
    list.forEach(([name, x, y, z]) => {
      _searchPool.push({ name, type: `${type} station`, station: { name, x, y, z, type } });
    });
  });

  let _activeSearchResults = [];
  let _activeSearchIndex   = -1;

  function _syncSearchHighlight() {
    if (!featureSearchRes) return;
    featureSearchRes.querySelectorAll('.search-suggestion').forEach((btn, i) => {
      btn.classList.toggle('is-active', i === _activeSearchIndex);
    });
  }

  function _renderSearchResults(results, idx = 0) {
    if (!featureSearchRes) return;
    featureSearchRes.innerHTML = '';
    if (!results.length) { featureSearchRes.hidden = true; return; }
    _activeSearchResults = results;
    _activeSearchIndex   = idx;
    for (const [i, item] of results.entries()) {
      const btn  = document.createElement('button');
      btn.type   = 'button';
      btn.className = 'search-suggestion' + (i === idx ? ' is-active' : '');
      btn.textContent = item.name;
      const meta = document.createElement('span');
      meta.className  = 'search-suggestion-meta';
      meta.textContent = item.type || 'Feature';
      btn.appendChild(meta);
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _selectResult(item); });
      featureSearchRes.appendChild(btn);
    }
    featureSearchRes.hidden = false;
  }

  function _refreshSearch(preserveIndex = false) {
    const q = (featureSearch?.value || '').trim().toLowerCase();
    if (!q) { featureSearchRes.hidden = true; featureSearchRes.innerHTML = ''; _activeSearchResults = []; _activeSearchIndex = -1; return; }
    const results = _searchPool.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);
    const idx = preserveIndex ? Math.min(_activeSearchIndex, results.length - 1) : 0;
    _renderSearchResults(results, Math.max(0, idx));
  }

  function _clearSearch(resetInput = false) {
    if (resetInput && featureSearch) featureSearch.value = '';
    if (featureSearchRes) { featureSearchRes.hidden = true; featureSearchRes.innerHTML = ''; }
    _activeSearchResults = [];
    _activeSearchIndex   = -1;
  }

  function _selectResult(item) {
    _clearSearch(false);
    if (featureSearch) featureSearch.value = item.name;
    if (item.poi) {
      const entry = etnaLabelLayer?.entries.find(e => e.item.name === item.poi.name);
      const pos = entry ? entry.mPos : new THREE.Vector3(item.poi.x, 0, item.poi.z);
      flyTo(pos);
      showFeaturePopup(item.poi);
    } else if (item.station) {
      flyTo(new THREE.Vector3(item.station.x, item.station.y, item.station.z + GEO_Z_OFFSET));
    }
  }

  if (featureSearch) {
    featureSearch.addEventListener('input',  () => _refreshSearch(false));
    featureSearch.addEventListener('change', () => _refreshSearch(false));
    featureSearch.addEventListener('focus',  () => _refreshSearch(false));
    featureSearch.addEventListener('keydown', (e) => {
      const n = _activeSearchResults.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _activeSearchIndex = n ? (_activeSearchIndex + 1) % n : 0;
        _syncSearchHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _activeSearchIndex = n ? ((_activeSearchIndex - 1) + n) % n : 0;
        _syncSearchHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = _activeSearchResults[_activeSearchIndex] ?? _activeSearchResults[0];
        if (item) _selectResult(item);
      } else if (e.key === 'Escape') {
        _clearSearch(false);
      }
    });
  }
  if (featureSearchGo) {
    featureSearchGo.addEventListener('click', () => {
      const item = _activeSearchResults[_activeSearchIndex] ?? _activeSearchResults[0];
      if (item) _selectResult(item);
      else _refreshSearch(false);
    });
  }
  // Close suggestions when clicking outside
  document.addEventListener('pointerdown', (e) => {
    if (!featureSearch?.contains(e.target) && !featureSearchGo?.contains(e.target) && !featureSearchRes?.contains(e.target)) {
      if (featureSearchRes) featureSearchRes.hidden = true;
    }
  }, true);

  // Reset view (explore-reset button)
  const exploreReset = document.getElementById('explore-reset');
  if (exploreReset) {
    exploreReset.addEventListener('click', () => {
      camera.position.set(40, 28, 65);
      controls.target.set(0, -10, 0);
      controls.update();
      hideFeaturePopup();
      _clearSearch(true);
    });
  }

  // Hazard zones toggle
  const hazardsToggle = document.getElementById('hazards-toggle');
  function _applyHazardToggle(on) {
    if (hazardGroup) hazardGroup.visible = on;
    if (hazardOverlayMesh) hazardOverlayMesh.visible = on;
  }
  if (hazardsToggle) {
    hazardsToggle.addEventListener('change', () => _applyHazardToggle(hazardsToggle.checked));
    // Sync initial checkbox state (checkbox may already be checked on load)
    _applyHazardToggle(hazardsToggle.checked);
  }
  document.querySelectorAll('[data-hazard-zone]').forEach(btn => {
    btn.addEventListener('click', () => {
      const zone = HAZARD_ZONES[parseInt(btn.dataset.hazardZone, 10)];
      if (zone) showHazardPopup(zone);
    });
  });

  // Sea level slider — non-linear mapping: internal 0–1000, left 70% = geological
  // (−200 m → 0 m), right 30% = climate projections (0 m → +8 m).
  // Reference marks in HTML are pre-positioned using the same mapping.
  const seaLevelSlider = document.getElementById('sea-level-slider');
  const seaLevelValue  = document.getElementById('sea-level-value');
  function _sliderToMeters(raw) {
    const r = parseInt(raw, 10);
    return r <= 700 ? -200 + (r / 700) * 200 : ((r - 700) / 300) * 8;
  }
  function _updateSeaLevelSlider() {
    const raw = parseInt(seaLevelSlider.value, 10);
    const m   = _sliderToMeters(raw);
    const pct = raw / 10; // 0–100
    if (seaLevelValue) {
      const abs = Math.abs(m);
      seaLevelValue.textContent = m === 0 ? '0 m'
        : m > 0  ? `+${abs < 2 ? m.toFixed(1) : Math.round(m)} m`
        :           `${Math.round(m).toLocaleString()} m`;
      seaLevelValue.style.left      = `${pct}%`;
      seaLevelValue.style.transform = pct <= 5  ? 'none'
                                    : pct >= 95 ? 'translateX(-100%)'
                                    :              'translateX(-50%)';
    }
    const yKm = m / 1000;
    if (seaPlane) seaPlane.position.y = yKm;
    // Update GPU clip plane — ocean volume geometry stays fixed; the plane
    // discards fragments above the current sea level (p.y > yKm).
    if (_seaClipPlane) _seaClipPlane.constant = yKm;
  }
  if (seaLevelSlider) {
    seaLevelSlider.addEventListener('input', _updateSeaLevelSlider);
    _updateSeaLevelSlider();
  }

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
// North in world space = −Z (Three.js +Z = south in current convention).

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
  // Convention: north = -Z, east = +X, south = +Z, west = -X
  const tickColors = [0xdd2200, 0x666666, 0x666666, 0x666666];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2; // 0=N(-Z), π/2=E(+X), π=S(+Z), 3π/2=W(-X)
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.016, 0.2),
      new THREE.MeshBasicMaterial({ color: tickColors[i] })
    );
    tick.position.set(Math.sin(a) * 0.85, 0, -Math.cos(a) * 0.85); // negate Z to flip N/S
    tick.rotation.y = -a;
    compassScene.add(tick);
  }

  // N-S needle — north half (red) points toward -Z (world north)
  const nBody = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.58, 16), matN);
  nBody.rotation.x = Math.PI / 2;
  nBody.position.z = -0.29;
  compassScene.add(nBody);

  const nHead = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 16), matN);
  nHead.rotation.x = -Math.PI / 2;
  nHead.position.z = -(0.58 + 0.21);
  compassScene.add(nHead);

  // S half (white/light) points toward +Z (world south)
  const sBody = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.58, 16), matS);
  sBody.rotation.x = Math.PI / 2;
  sBody.position.z = 0.29;
  compassScene.add(sBody);

  const sHead = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 16), matS);
  sHead.rotation.x = Math.PI / 2;
  sHead.position.z = 0.58 + 0.21;
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
  nSprite.position.set(0, 0, -1.35);
  nSprite.scale.set(0.5, 0.5, 1);
  compassScene.add(nSprite);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (hazardOverlayMesh && hazardOverlayMesh.visible && hazardOverlayMesh.material.uniforms) {
    hazardOverlayMesh.material.uniforms.uCameraY.value = camera.position.y;
  }
  updateContextHUD();
  updateLabelPositions();
  if (etnaLabelLayer) {
    updateEtnaLabelVisibility(
      etnaLabelLayer.entries, camera, renderer,
      surfaceMesh, domainBox,
      crossSectionEnabled, clipPlane,
      categoryEnabled,
      activePopupFeature,
      currentLodLevel,
    );

    // ── Selected-label pulse (mirrors Mars: ring + colour + opacity animation) ──
    const _nextEntry = activePopupFeature
      ? etnaLabelLayer.entries.find(e => e.item.name === activePopupFeature.name) ?? null
      : null;

    // Deselect: restore original material properties on the outgoing entry
    if (_selectedLabelEntry && _selectedLabelEntry !== _nextEntry && _selectedLabelEntry._pulseBase) {
      const pb = _selectedLabelEntry._pulseBase;
      if (_selectedLabelEntry.sprite?.material) {
        _selectedLabelEntry.sprite.material.color.copy(pb.spriteColor);
        _selectedLabelEntry.sprite.material.opacity = pb.spriteOpacity;
      }
      if (_selectedLabelEntry.marker?.material) {
        _selectedLabelEntry.marker.material.color.copy(pb.markerColor);
      }
      if (_selectedLabelEntry.line?.material) {
        _selectedLabelEntry.line.material.opacity = pb.lineOpacity;
      }
      delete _selectedLabelEntry._pulseBase;
    }
    _selectedLabelEntry = _nextEntry;

    const { selectionRing } = etnaLabelLayer;
    if (_selectedLabelEntry && _selectedLabelEntry.marker.visible) {
      // Cache original values on first frame of selection
      if (!_selectedLabelEntry._pulseBase) {
        _selectedLabelEntry._pulseBase = {
          spriteColor:   _selectedLabelEntry.sprite?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
          spriteOpacity: _selectedLabelEntry.sprite?.material?.opacity ?? 1,
          markerColor:   _selectedLabelEntry.marker?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
          lineOpacity:   _selectedLabelEntry.line?.material?.opacity ?? 0.42,
        };
      }
      const pulse = (Math.sin(performance.now() * 0.004) + 1) * 0.5; // 0–1, ~1.57 s period
      if (_selectedLabelEntry.sprite?.material) {
        _selectedLabelEntry.sprite.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
        _selectedLabelEntry.sprite.material.opacity = 0.78 + pulse * 0.22;
      }
      if (_selectedLabelEntry.marker?.material) {
        _selectedLabelEntry.marker.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
      }
      if (_selectedLabelEntry.line?.material) {
        _selectedLabelEntry.line.material.opacity = 0.42 + pulse * 0.4;
      }
      // Ring: follows the marker dot, scales with its current rendered size
      selectionRing.visible = true;
      selectionRing.position.copy(_selectedLabelEntry.marker.position);
      selectionRing.material.opacity = 0.35 + pulse * 0.55;
      selectionRing.scale.setScalar((1.2 + pulse * 0.6) * (_selectedLabelEntry.marker.scale.x || 1));
    } else {
      if (selectionRing) selectionRing.visible = false;
    }
  }

  // ── Seismic selection: gold sphere + tight cyan ring pulse ───────────────
  if (_seismicSelectionIdx >= 0 && _seismicEvents && seismicMesh) {
    const ev = _seismicEvents[_seismicSelectionIdx];
    if (ev) {
      const [x, z, y3d, ml] = ev;
      const r = _seismicRadius(ml);
      const pulse = (Math.sin(performance.now() * 0.003) + 1) * 0.5; // 0–1, ~2.1 s period

      // Cache original depth color on first frame of selection
      if (!_seismicSelectionOrigColor) {
        _seismicSelectionOrigColor = new THREE.Color();
        seismicMesh.getColorAt(_seismicSelectionIdx, _seismicSelectionOrigColor);
      }
      // Pulse sphere gold (matches selected POI label colour sweep)
      const gc = new THREE.Color(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
      seismicMesh.setColorAt(_seismicSelectionIdx, gc);
      seismicMesh.instanceColor.needsUpdate = true;

      // Ring: sits flush against the sphere surface, breathes slightly
      if (_seismicSelectionRing) {
        _seismicSelectionRing.position.set(x, y3d, z);
        _seismicSelectionRing.quaternion.copy(camera.quaternion);
        _seismicSelectionRing.scale.setScalar(r * (1.0 + pulse * 0.18));
        _seismicSelectionRing.material.opacity = 0.55 + pulse * 0.4;
        _seismicSelectionRing.visible = true;
      }
    }
  }

  const cEl = renderer.domElement;
  const cW = cEl.clientWidth;
  const cH = cEl.clientHeight;

  // ── Main scene ────────────────────────────────────────────────────────────
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, cW, cH);
  renderer.clear();
  renderer.render(scene, camera);

  // ── Compass inset (bottom-left, anchored to #compass-anchor CSS element) ─────
  // Reading the anchor's position from the DOM lets CSS control the layout
  // (the anchor moves with the nav-panel collapse transition automatically).
  let cx = 14, cy = 14, cSize = 112;
  if (_compassAnchor) {
    const r = _compassAnchor.getBoundingClientRect();
    cx    = r.left;
    cy    = cH - r.bottom; // flip: Three.js Y=0 is canvas bottom
    cSize = r.width;
  }
  renderer.setScissorTest(true);
  renderer.setViewport(cx, cy, cSize, cSize);
  renderer.setScissor(cx, cy, cSize, cSize);
  renderer.clearDepth();

  // Position compass camera opposite to main camera's look direction
  // so it always faces the compass arrow from the viewer's perspective
  camera.getWorldDirection(_vDir);
  compassCamera.position.copy(_vDir.negate().multiplyScalar(9));
  compassCamera.up.copy(camera.up);
  compassCamera.lookAt(0, 0, 0);

  renderer.render(compassScene, compassCamera);

  // Reset to full viewport
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, cW, cH);
}

// ─── POI popup ────────────────────────────────────────────────────────────────

function showFeaturePopup(feature) {
  const popup = document.getElementById('scene-popup');
  if (!popup) return;
  const pal = getThemePalette(feature.theme);

  const state  = document.getElementById('scene-popup-state');
  if (state)  { state.textContent = 'Current Focus'; state.hidden = false; }

  const kicker = document.getElementById('scene-popup-kicker');
  if (kicker) { kicker.textContent = feature.kicker || ''; kicker.style.color = pal.accentHex; }

  const title  = document.getElementById('scene-popup-title');
  if (title)   title.textContent = feature.name;

  const meta   = document.getElementById('scene-popup-meta');
  if (meta)    meta.textContent  = feature.meta || '';

  const copy   = document.getElementById('scene-popup-copy');
  if (copy)    copy.textContent  = feature.description || '';

  const detail = document.getElementById('scene-popup-detail');
  if (detail)  { detail.hidden = true; detail.innerHTML = ''; }

  const img    = document.getElementById('scene-popup-img');
  if (img)     img.hidden = true;

  popup.removeAttribute('hidden');
  activePopupFeature = feature;
}

function showSeismicPopup(idx) {
  if (!_seismicEvents || idx < 0 || idx >= _seismicEvents.length) return;
  const [x, z, y3d, ml, year] = _seismicEvents[idx];
  const depthKm = Math.max(0, -y3d);
  const lon = SAT_LON_W + (x + 50) / 100 * (SAT_LON_E - SAT_LON_W);
  const lat = SAT_LAT_N - (z + 50) / 100 * (SAT_LAT_N - SAT_LAT_S);
  const col = _seismicDepthColor(depthKm);
  const hex = '#' + col.getHexString();

  const depthBand = depthKm < 5 ? 'Shallow crustal' : depthKm < 15 ? 'Mid crustal' : depthKm < 30 ? 'Deep crustal' : 'Sub-crustal';
  const mlDesc   = ml < 2 ? 'Micro' : ml < 3 ? 'Minor' : ml < 4 ? 'Light' : ml < 5 ? 'Moderate' : 'Strong';

  const popup  = document.getElementById('scene-popup');
  if (!popup) return;

  const state  = document.getElementById('scene-popup-state');
  if (state)   { state.textContent = 'Seismic Event'; state.hidden = false; }

  const kicker = document.getElementById('scene-popup-kicker');
  if (kicker)  { kicker.textContent = `${mlDesc} · M${ml.toFixed(1)} · ${year}`; kicker.style.color = hex; }

  const title  = document.getElementById('scene-popup-title');
  if (title)   title.textContent = `M${ml.toFixed(1)} Earthquake`;

  const meta   = document.getElementById('scene-popup-meta');
  if (meta)    meta.textContent = `${lat.toFixed(4)}°N  ${lon.toFixed(4)}°E`;

  const copy   = document.getElementById('scene-popup-copy');
  if (copy)    copy.textContent = `${depthBand} · ${depthKm.toFixed(1)} km depth · ${year}`;

  const detail = document.getElementById('scene-popup-detail');
  if (detail) {
    detail.hidden = false;
    detail.innerHTML =
      `<table style="width:100%;border-collapse:collapse;font-size:0.72rem;margin-top:0.4rem;">` +
      [['Magnitude ML', ml.toFixed(1)],
       ['Depth', `${depthKm.toFixed(1)} km`],
       ['Depth class', depthBand],
       ['Year', year],
       ['Latitude', `${lat.toFixed(4)}°N`],
       ['Longitude', `${lon.toFixed(4)}°E`]]
      .map(([k, v]) =>
        `<tr><td style="color:var(--muted);padding:0.15rem 0.5rem 0.15rem 0;">${k}</td>` +
        `<td style="text-align:right;font-weight:600;">${v}</td></tr>`)
      .join('') +
      `</table>`;
  }

  const img = document.getElementById('scene-popup-img');
  if (img) img.hidden = true;

  popup.removeAttribute('hidden');
  activePopupFeature = { name: `M${ml.toFixed(1)} Earthquake`, theme: 'vent' };
  _seismicSelectionIdx = idx; // arm the ring
}

function showHazardPopup(zone) {
  const popup = document.getElementById('scene-popup');
  if (!popup) return;
  const state = document.getElementById('scene-popup-state');
  if (state) { state.textContent = 'Hazard Zone'; state.hidden = false; }
  const kicker = document.getElementById('scene-popup-kicker');
  if (kicker) { kicker.textContent = zone.kicker; kicker.style.color = zone.colorHex; }
  const title = document.getElementById('scene-popup-title');
  if (title) title.textContent = zone.label;
  const meta = document.getElementById('scene-popup-meta');
  if (meta) meta.textContent = '';
  const copy = document.getElementById('scene-popup-copy');
  if (copy) copy.textContent = zone.detail;
  const detail = document.getElementById('scene-popup-detail');
  if (detail) {
    detail.hidden = false;
    detail.innerHTML =
      '<p class="hazard-popup-subhead">Primary hazards</p>' +
      '<ul class="hazard-hazards-list">' +
      zone.hazards.map(h => `<li>${h}</li>`).join('') +
      '</ul>';
  }
  const img = document.getElementById('scene-popup-img');
  if (img) img.hidden = true;
  popup.removeAttribute('hidden');
  activePopupFeature = { name: zone.label, kicker: zone.kicker, theme: 'vent', isHazardZone: true };
}

function hideFeaturePopup() {
  const popup = document.getElementById('scene-popup');
  if (popup) popup.setAttribute('hidden', '');
  const state = document.getElementById('scene-popup-state');
  if (state) state.hidden = true;
  activePopupFeature = null;
  // Restore original depth colour on the previously selected seismic sphere
  if (_seismicSelectionIdx >= 0 && _seismicSelectionOrigColor && seismicMesh) {
    seismicMesh.setColorAt(_seismicSelectionIdx, _seismicSelectionOrigColor);
    seismicMesh.instanceColor.needsUpdate = true;
  }
  _seismicSelectionIdx = -1;
  _seismicSelectionOrigColor = null;
  if (_seismicSelectionRing) _seismicSelectionRing.visible = false;
}

// ─── Fly-to: animate camera to look at a 3D position ────────────────────────

const _flyVec = new THREE.Vector3();

function flyTo(targetPos, duration = 900) {
  const startPos    = camera.position.clone();
  const startTarget = controls.target.clone();
  // Orbit the target point from a fixed offset (30 km away, 12 km above, 40 km south)
  const offset   = new THREE.Vector3(8, 18, 35);
  const endPos   = new THREE.Vector3(targetPos.x + offset.x, targetPos.y + offset.y, targetPos.z + offset.z);
  const endTarget= new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z);
  const t0 = performance.now();

  function step(now) {
    const t = Math.min((now - t0) / duration, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
    camera.position.lerpVectors(startPos, endPos, e);
    _flyVec.lerpVectors(startTarget, endTarget, e);
    controls.target.copy(_flyVec);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── Measurement system ───────────────────────────────────────────────────────

// DOM refs populated by setupUI
let _measureCopy = null, _measurePanel = null, _measureMetric = null;
let _measureExport = null, _profileCanvas = null;
let _measureResultCard = null, _measureResultTitle = null, _measureResultBody = null;
let _profileModal = null, _profileModalTitle = null, _profileModalSummary = null;
let _profileModalCanvas = null, _profileModalExportPng = null, _profileModalClose = null;
let _measureRailButtons = [], _measureRailActionGroups = [], _measureRailExportButtons = [];
let _measureDistanceBtn = null, _measureAreaBtn = null, _measureProfileBtn = null;
let _toolRailDistanceBtn = null, _toolRailAreaBtn = null, _toolRailProfileBtn = null;
let _currentProfilePlotState = null;
const _profileRay = new THREE.Raycaster();

// ── Geometry helpers ──────────────────────────────────────────────────────────

// Flat planimetric distance in km (ignores elevation)
function _measureDistKm(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// 3D surface distance in km
function _measure3dDistKm(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Bearing from a → b, degrees 0-360, North=-Z East=+X
function _measureBearing(a, b) {
  const dEast = b.x - a.x, dNorth = -(b.z - a.z);
  return (((Math.atan2(dEast, dNorth) * 180 / Math.PI) % 360) + 360) % 360;
}

// Flat polygon area (shoelace) in km²
function _measureAreaKm2(pts) {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) * 0.5;
}

// Perimeter of polygon (planimetric)
function _measurePerimeterKm(pts) {
  if (pts.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    total += _measureDistKm(pts[i], pts[(i + 1) % pts.length]);
  }
  return total;
}

// Sample terrain elevation (km) by raycasting downward at (x, z)
function _sampleTerrainY(x, z) {
  if (!surfaceMesh) return 0;
  _profileRay.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
  const hits = _profileRay.intersectObject(surfaceMesh);
  return hits.length > 0 ? hits[0].point.y : 0;
}

// Sample N evenly-spaced profile points between two measurement points
function _sampleProfile(a, b, n = 72) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const xi = a.x + (b.x - a.x) * t;
    const zi = a.z + (b.z - a.z) * t;
    const yi = _sampleTerrainY(xi, zi);
    const distAlongKm = _measureDistKm(a, { x: xi, z: zi });
    const lon = SAT_LON_W + (xi + 50) / 100 * (SAT_LON_E - SAT_LON_W);
    const lat = SAT_LAT_N - (zi + 50) / 100 * (SAT_LAT_N - SAT_LAT_S);
    samples.push({ x: xi, z: zi, y: yi, lat, lon, elevation: yi * 1000, distanceAlongKm: distAlongKm });
  }
  return samples;
}

// ── Profile chart helpers ─────────────────────────────────────────────────────

function _buildNiceTicks(minVal, maxVal, target = 4) {
  const span = Math.max(1e-9, maxVal - minVal);
  const rough = span / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(rough));
  let step = pow;
  for (const c of [1, 2, 5, 10]) {
    if (rough <= pow * c) { step = pow * c; break; }
  }
  const first = Math.ceil(minVal / step) * step;
  const ticks = [];
  for (let v = first; v <= maxVal + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  if (!ticks.length) ticks.push(Number(minVal.toFixed(10)), Number(maxVal.toFixed(10)));
  return { step, ticks };
}

function _fmtDist(km) {
  if (km < 1) return km === 0 ? '0' : km.toFixed(km < 0.1 ? 2 : 1);
  if (km < 10) return km.toFixed(1);
  return `${Math.round(km)}`;
}

function _fmtElev(m) {
  const a = Math.abs(m);
  if (a >= 10000) return `${(m / 1000).toFixed(0)}k`;
  if (a >= 1000)  return `${(m / 1000).toFixed(1)}k`;
  return `${Math.round(m)}`;
}

function _drawProfile(canvas, samples) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const large = H >= 200;
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(6,11,19,0.98)');
  bg.addColorStop(1, 'rgba(10,16,28,0.98)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (!samples.length) return;

  const dists = samples.map(s => s.distanceAlongKm);
  const elevs = samples.map(s => s.elevation);
  const minE = Math.min(...elevs), maxE = Math.max(...elevs);
  const totalD = Math.max(...dists, 0.001);
  const elevSpan = Math.max(1, maxE - minE);
  const ePad = Math.max(40, elevSpan * 0.08);
  const { ticks: yTicks } = _buildNiceTicks(minE - ePad, maxE + ePad, large ? 7 : 4);
  const yMin = Math.min(yTicks[0], minE - ePad * 0.25);
  const yMax = Math.max(yTicks[yTicks.length - 1], maxE + ePad * 0.25);
  const { ticks: xTicks } = _buildNiceTicks(0, totalD, large ? 6 : (W < 200 ? 3 : 4));

  const cT = large ? 14 : 16, cB = H - (large ? 46 : 28);
  const cL = large ? 68 : 54, cR = W - (large ? 18 : 16);
  const cW = Math.max(1, cR - cL), cH = Math.max(1, cB - cT);
  const xf = d => cL + (d / totalD) * cW;
  const yf = e => cB - ((e - yMin) / Math.max(yMax - yMin, 1e-6)) * cH;

  const tickFnt = large ? "500 11.5px 'Exo 2',sans-serif" : "500 10px 'Exo 2',sans-serif";
  const axFnt   = large ? "600 13px 'Exo 2',sans-serif"   : "600 11px 'Exo 2',sans-serif";

  ctx.font = tickFnt;
  ctx.fillStyle = 'rgba(222,233,241,0.84)';
  ctx.strokeStyle = 'rgba(160,190,214,0.15)';
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  for (const t of yTicks) {
    const y = yf(t);
    if (y < cT - 1 || y > cB + 1) continue;
    ctx.beginPath(); ctx.moveTo(cL, y); ctx.lineTo(cR, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(_fmtElev(t), cL - 7, y);
  }
  ctx.textBaseline = 'top';
  for (const t of xTicks) {
    const x = xf(Math.min(t, totalD));
    ctx.beginPath(); ctx.moveTo(x, cT); ctx.lineTo(x, cB); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(_fmtDist(t), x, cB + 7);
  }
  ctx.strokeStyle = 'rgba(192,214,230,0.38)'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(cL, cT); ctx.lineTo(cL, cB); ctx.lineTo(cR, cB); ctx.stroke();

  ctx.font = axFnt; ctx.fillStyle = 'rgba(222,233,241,0.92)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('Distance (km)', (cL + cR) * 0.5, H - 4);
  ctx.save();
  ctx.translate(large ? 14 : 11, (cT + cB) * 0.5);
  ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top';
  ctx.fillText('Elevation (m)', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.rect(cL, cT, cW, cH); ctx.clip();
  const areaGrad = ctx.createLinearGradient(0, cT, 0, cB);
  areaGrad.addColorStop(0, 'rgba(87,218,244,0.22)');
  areaGrad.addColorStop(1, 'rgba(87,218,244,0.03)');
  ctx.beginPath();
  samples.forEach((s, i) => {
    const x = xf(dists[i]), y = yf(s.elevation);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(xf(dists[dists.length - 1]), cB);
  ctx.lineTo(cL, cB);
  ctx.closePath(); ctx.fillStyle = areaGrad; ctx.fill();

  ctx.strokeStyle = 'rgba(87,218,244,0.98)'; ctx.lineWidth = large ? 2.2 : 2.0;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const x = xf(dists[i]), y = yf(s.elevation);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = 'rgba(87,218,244,0.98)';
  ctx.beginPath(); ctx.arc(xf(dists[0]), yf(samples[0].elevation), 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(xf(dists[dists.length - 1]), yf(samples[samples.length - 1].elevation), 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  if (!large) {
    const relief = maxE - minE;
    ctx.font = "500 10px 'Exo 2',sans-serif"; ctx.fillStyle = 'rgba(190,240,247,0.9)';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';   ctx.fillText(`Min ${Math.round(minE)} m`, cL, 2);
    ctx.textAlign = 'center'; ctx.fillText(`Relief ${Math.round(relief)} m`, (cL + cR) * 0.5, 2);
    ctx.textAlign = 'right';  ctx.fillText(`Max ${Math.round(maxE)} m`, cR, 2);
  }
}

// ── Profile modal ─────────────────────────────────────────────────────────────

function _showProfileModal(title, summary, samples) {
  if (!_profileModal || !_profileModalCanvas) return;
  if (_profileModalTitle)   _profileModalTitle.textContent   = title   || 'Elevation Profile';
  if (_profileModalSummary) _profileModalSummary.textContent = summary || 'Distance and elevation profile.';
  _currentProfilePlotState = { title: title || 'Elevation Profile', samples: samples ? [...samples] : [] };
  _drawProfile(_profileModalCanvas, samples || []);
  _profileModal.hidden = false;
}

function _hideProfileModal() {
  if (_profileModal) _profileModal.hidden = true;
}

function _exportProfilePng() {
  if (!_profileModalCanvas || !_currentProfilePlotState?.samples?.length) return;
  const base = (_currentProfilePlotState.title || 'etna_elevation_profile')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'etna_elevation_profile';
  const a = document.createElement('a');
  a.href = _profileModalCanvas.toDataURL('image/png');
  a.download = `${base}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}

// ── Result card ───────────────────────────────────────────────────────────────

function _positionResultCard(anchorEl) {
  if (!_measureResultCard || _measureResultCard.hidden) return;
  if (!anchorEl) { _measureResultCard.style.left = ''; _measureResultCard.style.top = ''; _measureResultCard.style.right = '5.2rem'; return; }
  const r = anchorEl.getBoundingClientRect(), cr = _measureResultCard.getBoundingClientRect(), gap = 12;
  const left = Math.max(12, r.left - cr.width - gap);
  const top  = Math.max(12, Math.min(window.innerHeight - cr.height - 12, r.top + r.height * 0.5 - cr.height * 0.5));
  _measureResultCard.style.right = 'auto';
  _measureResultCard.style.left  = `${left}px`;
  _measureResultCard.style.top   = `${top}px`;
}

function _showResultCard(title, bodyHtml, anchorEl = null) {
  if (!_measureResultCard) return;
  _mResultAnchor = anchorEl;
  if (_measureResultTitle) _measureResultTitle.textContent = title || 'Measurement';
  if (_measureResultBody)  _measureResultBody.innerHTML    = bodyHtml || '';
  _measureResultCard.hidden = false;
  requestAnimationFrame(() => _positionResultCard(_mResultAnchor));
}

function _hideResultCard() {
  _mResultAnchor = null;
  if (!_measureResultCard) return;
  _measureResultCard.hidden = true;
  _measureResultCard.style.left = ''; _measureResultCard.style.top = ''; _measureResultCard.style.right = '';
  if (_measureResultTitle) _measureResultTitle.textContent = 'Measurement';
  if (_measureResultBody)  _measureResultBody.innerHTML = '';
}

// ── CSV download ──────────────────────────────────────────────────────────────

function _downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(v => {
    const c = String(v ?? '');
    return /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function _exportMeasureCsv() {
  if (!measureMode || !measurePoints.length) return;

  if (measureMode === 'distance' && measurePoints.length >= 2) {
    const a = measurePoints[0], b = measurePoints[1];
    _downloadCsv('etna_distance_measurement.csv', [
      ['type', 'start_lat_deg', 'start_lon_deg_e', 'start_elev_m', 'end_lat_deg', 'end_lon_deg_e', 'end_elev_m', 'horiz_dist_km', 'surface_dist_km', 'bearing_deg'],
      ['distance', a.lat.toFixed(6), a.lon.toFixed(6), Math.round(a.elevM),
        b.lat.toFixed(6), b.lon.toFixed(6), Math.round(b.elevM),
        _measureDistKm(a, b).toFixed(3), _measure3dDistKm(a, b).toFixed(3),
        _measureBearing(a, b).toFixed(1)],
    ]);
    return;
  }

  if (measureMode === 'area' && measurePoints.length >= 3) {
    const areaKm2 = _measureAreaKm2(measurePoints);
    const rows = [['type', 'vertex_index', 'lat_deg', 'lon_deg_e', 'elev_m', 'local_x_km', 'local_z_km', 'total_area_km2']];
    measurePoints.forEach((p, i) => rows.push([
      'area', i + 1, p.lat.toFixed(6), p.lon.toFixed(6), Math.round(p.elevM),
      p.x.toFixed(3), p.z.toFixed(3), i === 0 ? areaKm2.toFixed(3) : '',
    ]));
    _downloadCsv('etna_area_measurement.csv', rows);
    return;
  }

  if (measureMode === 'profile' && measureProfileSamples.length >= 2) {
    const rows = [['sample_index', 'distance_along_km', 'lat_deg', 'lon_deg_e', 'elevation_m', 'local_x_km', 'local_z_km']];
    measureProfileSamples.forEach((s, i) => rows.push([
      i + 1, s.distanceAlongKm.toFixed(3), s.lat.toFixed(6), s.lon.toFixed(6),
      s.elevation.toFixed(1), s.x.toFixed(3), s.z.toFixed(3),
    ]));
    _downloadCsv('etna_profile_measurement.csv', rows);
  }
}

// ── Three.js measurement visuals ──────────────────────────────────────────────

function _clearMeasureGroup() {
  measureVisuals.length = 0;
  while (measureGroup.children.length > 0) {
    const child = measureGroup.children.pop();
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.());
    else child.material?.dispose?.();
  }
}

function _addMeasureMarker(pt, index) {
  const LIFT = 0.04; // km above terrain
  const markerPos = new THREE.Vector3(pt.x, pt.y + LIFT, pt.z);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd0b0, depthTest: false, depthWrite: false }),
  );
  marker.position.copy(markerPos);
  marker.renderOrder = 90; marker.frustumCulled = false;
  measureGroup.add(marker);

  const letter = String.fromCharCode(65 + index);
  const fSize = 28;
  const lc = document.createElement('canvas');
  lc.width = fSize * 2; lc.height = fSize * 2;
  const lctx = lc.getContext('2d');
  lctx.font = `bold ${fSize}px sans-serif`;
  lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
  lctx.strokeStyle = 'rgba(10,10,18,0.9)'; lctx.lineWidth = fSize * 0.28; lctx.lineJoin = 'round';
  lctx.strokeText(letter, lc.width / 2, lc.height / 2);
  lctx.fillStyle = '#ffd0b0'; lctx.fillText(letter, lc.width / 2, lc.height / 2);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(lc), transparent: true, depthTest: false, depthWrite: false,
  }));
  spr.scale.set(0.8, 0.8, 1);
  spr.position.set(pt.x, pt.y + LIFT + 0.32, pt.z);
  spr.renderOrder = 91; spr.frustumCulled = false;
  measureGroup.add(spr);
}

function _buildTerrainLine(pts, color) {
  const LIFT = 0.04;
  const STEPS = 30;
  const linePoints = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = 0; j < STEPS; j++) {
      const t  = j / STEPS;
      const xi = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
      const zi = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
      linePoints.push(new THREE.Vector3(xi, _sampleTerrainY(xi, zi) + LIFT, zi));
    }
  }
  linePoints.push(new THREE.Vector3(pts[pts.length - 1].x, _sampleTerrainY(pts[pts.length - 1].x, pts[pts.length - 1].z) + LIFT, pts[pts.length - 1].z));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(linePoints),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.98, depthTest: false, depthWrite: false }),
  );
  line.renderOrder = 95; line.frustumCulled = false;
  return line;
}

function _buildAreaFillMesh(pts) {
  if (pts.length < 3) return null;
  const LIFT = 0.06;
  // Fan triangulate from centroid
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const cy = _sampleTerrainY(cx, cz) + LIFT;
  const positions = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ay = _sampleTerrainY(a.x, a.z) + LIFT;
    const by = _sampleTerrainY(b.x, b.z) + LIFT;
    positions.push(cx, cy, cz, a.x, ay, a.z, b.x, by, b.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x58d0f6, transparent: true, opacity: 0.22,
    side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  }));
  mesh.renderOrder = 80; mesh.frustumCulled = false;
  return mesh;
}

// ── Sync rail buttons + actions ───────────────────────────────────────────────

function _syncRailStates() {
  _measureRailButtons.forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.measureMode === measureMode);
  });
  [_measureDistanceBtn, _measureAreaBtn, _measureProfileBtn].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle('is-active', btn.dataset.mode === measureMode);
  });
}

function _syncRailActions() {
  const canExp = {
    distance: measurePoints.length >= 2,
    area: measurePoints.length >= 3,
    profile: measureProfileSamples.length >= 2,
  };
  _measureRailActionGroups.forEach(g => {
    const m = g.dataset.measureActions;
    g.hidden = !(measureMode === m);
  });
  _measureRailExportButtons.forEach(btn => {
    const m = btn.dataset.measureExport;
    btn.disabled = !canExp[m];
    btn.textContent = 'Export CSV';
  });
  if (_measureExport) _measureExport.disabled = !(canExp[measureMode]);
}

// ── Core measurement update ───────────────────────────────────────────────────

function _updateMeasureViz() {
  _clearMeasureGroup();
  _syncRailActions();

  if (!measurePoints.length) {
    if (_measurePanel) _measurePanel.hidden = true;
    if (_measureMetric) _measureMetric.innerHTML = '';
    _hideResultCard();
    _hideProfileModal();
    measureProfileSamples = [];
    return;
  }
  if (_measurePanel) _measurePanel.hidden = false;

  measurePoints.forEach((p, i) => _addMeasureMarker(p, i));

  if (measureMode === 'distance' && measurePoints.length >= 2) {
    const a = measurePoints[0], b = measurePoints[1];
    const horizKm = _measureDistKm(a, b);
    const surfKm  = _measure3dDistKm(a, b);
    const bearing = _measureBearing(a, b);
    const elevDiff = b.elevM - a.elevM;
    measureGroup.add(_buildTerrainLine([a, b], 0xffcf9d));
    const body = [
      `Horiz. dist ${horizKm.toFixed(2)} km`,
      `Surface dist ${surfKm.toFixed(2)} km`,
      `Bearing ${bearing.toFixed(1)}°`,
      `Δ Elev ${elevDiff >= 0 ? '+' : ''}${Math.round(elevDiff)} m`,
    ].join('<br>');
    if (_measureMetric) _measureMetric.innerHTML = body;
    _showResultCard(`Distance: ${horizKm.toFixed(2)} km`, body, _toolRailDistanceBtn);
    measureProfileSamples = [];
    _hideProfileModal();

  } else if (measureMode === 'area' && measurePoints.length >= 3) {
    const areaKm2 = _measureAreaKm2(measurePoints);
    const perimKm = _measurePerimeterKm(measurePoints);
    const fill = _buildAreaFillMesh(measurePoints);
    if (fill) measureGroup.add(fill);
    // Polygon boundary
    const closed = [...measurePoints, measurePoints[0]];
    measureGroup.add(_buildTerrainLine(closed, 0x58d0f6));
    const body = [
      `Area ${areaKm2.toFixed(2)} km²`,
      `Perimeter ${perimKm.toFixed(2)} km`,
      `Vertices ${measurePoints.length}`,
    ].join('<br>');
    if (_measureMetric) _measureMetric.innerHTML = body;
    _showResultCard(`Area: ${areaKm2.toFixed(2)} km²`, body, _toolRailAreaBtn);
    measureProfileSamples = [];
    _hideProfileModal();

  } else if (measureMode === 'profile' && measurePoints.length >= 2) {
    const a = measurePoints[0], b = measurePoints[1];
    measureGroup.add(_buildTerrainLine([a, b], 0xffcf9d));
    const samples = _sampleProfile(a, b, 72);
    measureProfileSamples = samples;
    const elevs = samples.map(s => s.elevation);
    const minE = Math.min(...elevs), maxE = Math.max(...elevs);
    const horizKm = _measureDistKm(a, b);
    const relief = maxE - minE;
    const body = `Min ${Math.round(minE)} m · Max ${Math.round(maxE)} m · Relief ${Math.round(relief)} m`;
    if (_measureMetric) _measureMetric.innerHTML = body;
    _showProfileModal(
      'Etna Elevation Profile',
      `Dist ${horizKm.toFixed(2)} km · Min ${Math.round(minE)} m · Max ${Math.round(maxE)} m · Relief ${Math.round(relief)} m`,
      samples,
    );
    _hideResultCard();
    _syncRailActions();

  } else {
    if (_measureMetric) _measureMetric.innerHTML = 'Add more points to complete this measurement.';
    _hideResultCard();
    _hideProfileModal();
    measureProfileSamples = [];
  }
}

// ── Mode control ──────────────────────────────────────────────────────────────

function _resetMeasure(preserveMode = false) {
  if (!preserveMode) { measureMode = ''; _hideResultCard(); }
  measurePoints = [];
  measureProfileSamples = [];
  _clearMeasureGroup();
  if (_measurePanel)  _measurePanel.hidden  = true;
  if (_measureMetric) _measureMetric.innerHTML = '';
  if (_measureExport) _measureExport.disabled = true;
  _hideProfileModal();
  _syncRailStates();
  _syncRailActions();
  if (_measureCopy) {
    _measureCopy.textContent = measureMode
      ? `Active: ${measureMode}. Click terrain to add points.`
      : 'Choose a tool, then click the terrain to start measuring.';
  }
}

function _setMeasureMode(next) {
  measureMode = measureMode === next ? '' : next;
  if (!measureMode) _hideResultCard();
  if (renderer?.domElement) renderer.domElement.style.cursor = measureMode ? 'crosshair' : '';
  _resetMeasure(true);
}

// ── Intersect terrain for measurement click ───────────────────────────────────

function _intersectTerrainForMeasure(clientX, clientY) {
  if (!surfaceMesh) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((clientX - rect.left) / rect.width)  * 2 - 1;
  const ny = -(((clientY - rect.top)  / rect.height) * 2 - 1);
  const tmpRay = new THREE.Raycaster();
  tmpRay.setFromCamera({ x: nx, y: ny }, camera);
  const hits = tmpRay.intersectObject(surfaceMesh);
  if (!hits.length) return null;
  const pt = hits[0].point;
  const lon = SAT_LON_W + (pt.x + 50) / 100 * (SAT_LON_E - SAT_LON_W);
  const lat = SAT_LAT_N - (pt.z + 50) / 100 * (SAT_LAT_N - SAT_LAT_S);
  return { x: pt.x, y: pt.y, z: pt.z, lat, lon, elevM: pt.y * 1000 };
}

// ─── Canvas click — POI selection ────────────────────────────────────────────

let _pointerDragged = false;
let _pointerDownX = 0, _pointerDownY = 0;

function _onPointerDown(e) {
  _pointerDownX = e.clientX; _pointerDownY = e.clientY;
  _pointerDragged = false;
}
function _onPointerMove(e) {
  const dx = e.clientX - _pointerDownX, dy = e.clientY - _pointerDownY;
  if (Math.sqrt(dx * dx + dy * dy) > 5) _pointerDragged = true;
}
function _onPointerUp(e) {
  if (_pointerDragged) return;

  // Measurement mode takes priority over POI selection
  if (measureMode) {
    const hit = _intersectTerrainForMeasure(e.clientX, e.clientY);
    if (hit) {
      // Distance and profile: third click resets to fresh start
      if ((measureMode === 'distance' || measureMode === 'profile') && measurePoints.length >= 2) {
        measurePoints = [hit];
      } else {
        measurePoints.push(hit);
      }
      _updateMeasureViz();
      return;
    }
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  const ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  clickRay.setFromCamera({ x: nx, y: ny }, camera);

  // Hazard zone click detection (only when visible)
  if (hazardGroup && hazardGroup.visible && _hazardObjects.length > 0) {
    const hazardHits = clickRay.intersectObjects(_hazardObjects, false);
    if (hazardHits.length > 0 && hazardHits[0].object.userData.hazardZone) {
      showHazardPopup(hazardHits[0].object.userData.hazardZone);
      return;
    }
  }

  // Seismic event click (only when visible)
  if (seismicMesh && seismicMesh.visible) {
    const seismicHits = clickRay.intersectObject(seismicMesh);
    if (seismicHits.length > 0) {
      showSeismicPopup(seismicHits[0].instanceId);
      return;
    }
  }

  if (!etnaLabelLayer) return;
  const hits = clickRay.intersectObjects(etnaLabelLayer.interactiveObjects, false);
  if (hits.length > 0 && hits[0].object.userData.feature) {
    showFeaturePopup(hits[0].object.userData.feature);
  } else {
    hideFeaturePopup();
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

setupUI();
init();

// Register canvas interaction after init() creates the renderer
renderer.domElement.addEventListener('pointerdown', _onPointerDown);
renderer.domElement.addEventListener('pointermove', _onPointerMove, { passive: true });
renderer.domElement.addEventListener('pointerup',   _onPointerUp);
