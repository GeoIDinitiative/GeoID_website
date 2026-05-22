/**
 * GeoID: Earth — Mount Etna 3D Viewer
 * Coordinate convention: Three.js X=(E-500000)/1000 (east km), Z=(N-4175000)/1000 (north km), Y=elev/1000
 *   — origin is domain centre, Y-up: positive Y = above sea level.
 */
console.log('[etna-viewer] build v77');

import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { STLLoader } from './vendor/STLLoader.js';
import {
  buildEtnaLabelLayer,
  updateEtnaLabelVisibility,
  applyEtnaLabelVertExag,
  getThemePalette,
  makeLabelTexture,
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



// Geological domain — from sea level (Y=0) down to −80 km
const DOMAIN_W = 100, DOMAIN_H = 80; // width km, height km (0 to -80)
const DOMAIN_CY = -40; // Y centre = -40 km (top at 0, bottom at -80)

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
let sicilianThrustSlab = null; // African carbonate platform — Sicilian Chain Thrust Front
const _slabTears = [];          // planar dyke sheets representing slab tears
const _slabHeatZoneMeshes = []; // heat-zone circles — hidden during cross-section
let _plumbingLabelGroup = null;
const _plumbingLabelData = [];         // { hit, sprite, anchor, poi }[]
const _plumbingLabelInteractives = []; // hit spheres + sprites for click raycasting
let faultRootGroup = null;   // parent group for all surface fault overlays (scale.y tracks vertExag)
let seismicMesh = null;      // THREE.InstancedMesh — one instance per seismic event
let _seismicEvents = null;   // raw array [[x,z,y,ml,year], …] loaded from etna-seismicity.json
let _seismicMlMin  = 1.5;   // current magnitude-cutoff filter
let _seismicDEnabled = { shallow:true, mid:true, deep:true, vdeep:true }; // depth-band toggles
let _seismicSelectionIdx  = -1;   // instanceId of the currently selected seismic event
const _seismicRingEl = () => document.getElementById('seismic-selection-ring');
let ionianCrust = null;      // oceanic crust cap (~7 km) atop the slab surface
let stepFault = null;        // STEP fault — lateral slab tear edge allowing upwelling
let skirtOverdraw = null;   // same for terrain skirt
let stencilMask = null;     // FrontSide terrain clone that writes stencil=1; rings test stencil=1 to stay above-surface-only
let hazardGroup       = null;
let _hazardDomainPlanes = null;  // 4 domain-boundary clipping planes for hazard meshes
const _hazardObjects  = [];      // ring meshes for raycasting
let stationMarkers = []; // kept as empty array — no longer contains meshes
let stationMarkersByType = {}; // type → [] (unused, kept for safety)
let stationDOMByType = {}; // type → DOM pin elements for immediate toggle control
let chamberMeshes = [];
let hvbMesh = null;        // High-Velocity Body obstacle (not a magma chamber)
let _layerLabelGroup = null;
const _layerLabelInteractives = [];
let _selectedCoreEntry = null;  // currently pulsing core label entry
let _coreSelectionRing = null;  // ring mesh that orbits the selected dot
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
const categoryEnabled  = { settlement: true, fault: true, vent: true, fissure: true, general: true, hydro: true };
let currentLodLevel    = 5; // label density slider: 1=landmarks only, 5=all
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
let regionalGeologyMesh = null; // canvas-texture overlay: EGDI 1:1M regional geology (full domain)
let _egdiGeoFeats       = null; // EGDI features for PIP — [id,name,lithology,age,source,color_hex,rings]
let etnaGeologyMesh     = null; // canvas-texture overlay: INGV EtnaGeoMap per-feature polygons
let _ingvGeoFeats       = null; // INGV features for PIP — [id,sigle,name,type,age,fm,lith,info,color,rings]
let tectonicFaultRoot   = null; // regional tectonic faults (GEM / DISS) as draped lines
let _faultRibbonData    = [];   // [{columns:[{top,bot},...], color, geo}] for face intersection + vert-exag update
let _faultRibbonGroup   = null; // child of tectonicFaultRoot with scale.y=1/_vertExag — ribbons + face lines sit here
const _faultRibbonMeshes = [];  // all ribbon THREE.Mesh objects — used for click raycasting
let _selectedFaultMesh   = null; // currently selected ribbon mesh
let _faultPerimeterLine  = null; // animated perimeter outline of selected ribbon
const _ghostSurfaceTraceMats = []; // ghost copies of surface-trace line materials (inactive half)
let _faultSideLineGroup = null; // intersection lines on the 4 domain side faces (built once)
let _faultCapLineGroup  = null; // intersection lines on the cross-section cap (rebuilt on angle)
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

// ── Volumetric property texture ───────────────────────────────────────────────
// 64×64×32 Data3DTexture (RGBA float) sampled in the domain-face shader.
// NY=32 (1.5625 km/voxel) captures the oblate lower reservoir (ry=0.8 km).
// Indexed in LOCAL domain coordinates: X -50→+50, Z -50→+50, depth 0→50 km.
// Built CPU-side: background geotherm + topographic overburden + chamber halos.
const _PT_NX = 64, _PT_NY = 32, _PT_NZ = 64;

// Chamber definitions in world space (X, Y, Z km).
// Exact match to buildChambers() 3D meshes and _CAP_GLSL_GEO inAnyChamber().
// Deep storage (index 4) is tilted — _ptInChamber applies R^T before testing.
const _CHAMBERS_PT = [
  { cx: -0.26,  cy:  1.5,  cz:  0.42, rx: 0.5,  ry: 0.5,  rz: 0.5,  Tmag: 1150 }, // summit
  { cx: -0.79,  cy: -2.0,  cz:  4.08, rx: 0.25, ry: 1.0,  rz: 0.25, Tmag: 1130 }, // prolate conduit
  { cx: -1.14,  cy: -5.0,  cz:  5.31, rx: 1.4,  ry: 0.7,  rz: 1.2,  Tmag: 1100 }, // melt shell
  { cx: -8.67,  cy:-10.0,  cz:  2.34, rx: 3.0,  ry: 1.0,  rz: 3.0,  Tmag: 1080 }, // mid-crustal lens
  { cx:-20.73,  cy:-18.0,  cz: -2.40, rx: 6.0,  ry: 2.0,  rz: 6.0,  Tmag: 1050 }, // deep storage (tilted)
];
let _propTex = null;

// CPU mirrors of the GLSL physics — equations and constants match ptGeotherm/ptThermal exactly.
function _ptTemp(d) {
  if (d <= 0) return 15;
  const Tl = 15 + 25*d - 0.10*d*d;           // Fourier conduction, q_s/k (LAB at ~55 km)
  const Ta = 1215 + 0.5*Math.max(0, d - 60);  // mantle adiabat (below LAB base)
  const w  = 1 / (1 + Math.exp(-(d - 55)));   // logistic LAB blend at 55 km
  return Tl*(1 - w) + Ta*w;
}
// Ionian slab fraction: 0 = outside, 1 = fully inside slab core.
// Slab plane defined by (50,−28)→(35,−50) in world XY; normal (−22,15)/26.63 toward mantle wedge.
function _ptSlabFraction(wx, wy) {
  if (wx < 22 || wy > -22) return 0;
  const sd = (-22*(wx - 50) + 15*(wy + 28)) / 26.63;
  const t  = Math.max(0, Math.min(1, -sd / 8));
  return t*t*(3 - 2*t);  // smoothstep
}
// Plume fraction: 0 = outside, 1 = inside plume core.
// Matches buildChambers() plume geometry: stem r=2 (y -80→-40), flare widens to r=16 at y=-25.
function _ptPlumeFraction(wx, wy, wz) {
  const ss = (x, lo, hi) => { const t = Math.max(0, Math.min(1, (hi-x)/(hi-lo))); return t*t*(3-2*t); };
  let w = 0;
  if (wy <= -38 && wy >= -82) {
    const dr = Math.hypot(wx + 21.02, wz - 3.03);
    w = Math.max(w, ss(dr, 1.0, 3.5));
  }
  if (wy > -42 && wy < -25) {
    const t   = Math.max(0, Math.min(1, (wy + 42) / 17));
    const axX = -21.02 + t * (-23.95 - (-21.02));
    const axZ =   3.03 + t * (-2.62  -   3.03);
    const maxR = 2 + t * 14;
    const dr   = Math.hypot(wx - axX, wz - axZ);
    w = Math.max(w, ss(dr, maxR * 0.5, maxR * 1.4));
  }
  return w;
}
function _ptPressure(d) {
  return 9.81e-6 * 2900 * (d - 0.42*(1 - Math.exp(-d/3)));
}
function _ptMeltFrac(T, P) {
  return Math.min(Math.max((T - (1100 + 15*P)) / 200, 0), 1) * 0.08;
}
function _ptYoungs(P, T, phi) {
  let E = 40 + 45*(1 - Math.exp(-P/0.3));
  E -= 0.015*Math.max(0, T - 15);
  const t = Math.min(Math.max(phi/0.04, 0), 1);
  E *= 1 - (3*t*t - 2*t*t*t);    // smoothstep polynomial
  return Math.max(2, E);
}
function _ptPoisson(P, phi) {
  const v = 0.18 + 0.10*(1 - Math.exp(-P/0.3));
  const t = Math.min(Math.max(phi/0.04, 0), 1);
  return v*(1 - t) + 0.48*t;
}

// Returns the chamber object if world point (wx, wy, wz) is inside any chamber.
// Deep storage (index 4) requires R^T rotation before the ellipsoid test.
function _ptInChamber(wx, wy, wz) {
  for (let i = 0; i < 4; i++) {
    const ch = _CHAMBERS_PT[i];
    const nx = (wx - ch.cx) / ch.rx;
    const ny = (wy - ch.cy) / ch.ry;
    const nz = (wz - ch.cz) / ch.rz;
    if (nx*nx + ny*ny + nz*nz < 1.0) return ch;
  }
  {
    const ch = _CHAMBERS_PT[4];
    const dx = wx - ch.cx, dy = wy - ch.cy, dz = wz - ch.cz;
    const lx = ( 0.9679*dx + 0.2435*dy - 0.062 *dz) / ch.rx;
    const ly = (-0.2435*dx + 0.848 *dy - 0.4706*dz) / ch.ry;
    const lz = (-0.062 *dx + 0.4706*dy + 0.8801*dz) / ch.rz;
    if (lx*lx + ly*ly + lz*lz < 1.0) return ch;
  }
  return null;
}

// Temperature (°C) at world point — mirrors ptThermal() GLSL exactly.
// Geotherm + slab cold anomaly + plume hot anomaly + 1/r chamber halos.
function _ptTempAtPoint(wx, wy, wz) {
  const ch_in = _ptInChamber(wx, wy, wz);
  if (ch_in) return ch_in.Tmag;

  const h    = _sampleHeight(wx, wz);
  const dEff = Math.max(0, -wy + h);
  let T = _ptTemp(dEff);

  // Ionian slab cold anomaly
  const sf = _ptSlabFraction(wx, wy);
  if (sf > 0) {
    const Tslab = 350 + 300 * Math.exp(-Math.max(0, dEff - 25) / 25);
    T = T + sf * (Math.min(T, Tslab) - T); // slab only cools
  }

  // Mantle plume hot anomaly
  const pf = _ptPlumeFraction(wx, wy, wz);
  if (pf > 0) {
    const Tplume = 1340 + 0.4 * Math.max(0, -wy - 45);
    T = T + pf * 0.85 * (Math.max(T, Tplume) - T); // plume only heats
  }

  // 1/r chamber halos (∇²T = 0 superposition)
  for (let ci = 0; ci < _CHAMBERS_PT.length; ci++) {
    const ch = _CHAMBERS_PT[ci];
    let dN;
    if (ci === 4) {
      const dx = wx-ch.cx, dy = wy-ch.cy, dz = wz-ch.cz;
      const lx = ( 0.9679*dx + 0.2435*dy - 0.062 *dz) / ch.rx;
      const ly = (-0.2435*dx + 0.848 *dy - 0.4706*dz) / ch.ry;
      const lz = (-0.062 *dx + 0.4706*dy + 0.8801*dz) / ch.rz;
      dN = Math.sqrt(lx*lx + ly*ly + lz*lz);
    } else {
      const nx = (wx-ch.cx)/ch.rx, ny = (wy-ch.cy)/ch.ry, nz = (wz-ch.cz)/ch.rz;
      dN = Math.sqrt(nx*nx + ny*ny + nz*nz);
    }
    if (dN >= 1.0) T += Math.max(0, ch.Tmag - _ptTemp(Math.max(0, -ch.cy))) / dN;
  }
  return Math.min(T, 1350);
}

// All rock properties at world point — used by subsurface HUD.
// Differentiates magma chambers, Ionian slab, plume, and host rock.
function _ptPropsAtPoint(wx, wy, wz) {
  const h      = _sampleHeight(wx, wz);
  const dEff   = Math.max(0, -wy + h);
  const P      = _ptPressure(dEff);
  const ch_in  = _ptInChamber(wx, wy, wz);
  const T      = ch_in ? ch_in.Tmag : _ptTempAtPoint(wx, wy, wz);
  const phi    = _ptMeltFrac(T, P);

  let E, nu, rho;
  if (ch_in) {
    E = 1.5; nu = 0.499; rho = 2650;
  } else {
    const sf = _ptSlabFraction(wx, wy);
    // Host-rock baseline
    E   = _ptYoungs(P, T, phi);
    nu  = _ptPoisson(P, phi);
    rho = Math.round(2900*(1 - 0.14*Math.exp(-dEff/3))*(1 + P/70 - 3e-5*Math.max(0, T-15)) - 250*phi);
    if (sf > 0.01) {
      // Ionian oceanic lithosphere: old, cold, rigid, dense
      const Eslab   = 150 + 30*(1 - Math.exp(-P/0.5));
      const nuSlab  = 0.27;
      const rhoSlab = Math.round(3280*(1 + P/120) - 1.5*Math.max(0, T - 15));
      E   = E   + sf*(Eslab   - E);
      nu  = nu  + sf*(nuSlab  - nu);
      rho = Math.round(rho + sf*(rhoSlab - rho));
    }
  }
  return { T, P, phi, E, nu, rho, dEff, inChamber: !!ch_in };
}

// Build a 64×64 topographic height map (km) from processed STL vertices.
// Uses LOCAL coordinates (GEO_Z_OFFSET stripped) so it matches the texture UVW.
function _buildPropTopoMap(terrainGeo) {
  const H   = new Float32Array(_PT_NX * _PT_NZ);
  const cnt = new Uint8Array(_PT_NX * _PT_NZ);
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wy = pos.getY(i);
    const lz = pos.getZ(i) - GEO_Z_OFFSET; // strip offset → local Z
    const ix = Math.floor((wx + 50) / 100 * _PT_NX);
    const iz = Math.floor((lz + 50) / 100 * _PT_NZ);
    if (ix < 0 || ix >= _PT_NX || iz < 0 || iz >= _PT_NZ) continue;
    const k = iz * _PT_NX + ix;
    if (wy > H[k]) { H[k] = wy; cnt[k] = 1; }
  }
  // Fill empty cells with neighbour average (1-pass 3×3 diffusion)
  for (let iz = 0; iz < _PT_NZ; iz++)
    for (let ix = 0; ix < _PT_NX; ix++)
      if (!cnt[iz*_PT_NX + ix]) {
        let s = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const jz = iz+dz, jx = ix+dx;
          if (jz>=0 && jz<_PT_NZ && jx>=0 && jx<_PT_NX && cnt[jz*_PT_NX+jx])
            { s += H[jz*_PT_NX+jx]; n++; }
        }
        H[iz*_PT_NX + ix] = n ? s/n : 0;
      }
  return H;
}

// Build and upload the Data3DTexture.
// H: Float32Array[NX×NZ] of terrain heights (km), or null for flat h=0.
// RGBA channels: T_norm (15–1230°C), P_norm (0–1.5 GPa), E_norm (2–64 GPa), ν_norm (0.18–0.48).
// Temperature baked via steady-state Fourier superposition (1/r law, ∇²T = 0).
function _buildPropertyTexture(H) {
  const data = new Float32Array(_PT_NX * _PT_NY * _PT_NZ * 4);
  // Precompute geotherm at each chamber centroid (constant across all voxels)
  const _chTbg = _CHAMBERS_PT.map(ch => _ptTemp(Math.max(0, -ch.cy)));

  for (let iz = 0; iz < _PT_NZ; iz++) {
    // local Z → world Z = local Z + GEO_Z_OFFSET
    const wz = (-50 + (iz + 0.5) * 100 / _PT_NZ) + GEO_Z_OFFSET;
    for (let iy = 0; iy < _PT_NY; iy++) {
      const wy   = -(iy + 0.5) * 50 / _PT_NY;   // km (negative = below sea level)
      for (let ix = 0; ix < _PT_NX; ix++) {
        const wx   = -50 + (ix + 0.5) * 100 / _PT_NX;
        const h    = H ? H[iz * _PT_NX + ix] : 0;
        const dEff = Math.max(0, -wy + h);   // true depth from true surface

        // ── Temperature: background geotherm + steady-state 1/r chamber halos ──
        // Superposition principle (∇²T = 0): ΔT_i = (T_wall_i − T_bg_at_ci) / d_norm_i
        let T = _ptTemp(dEff);
        let inChamber = false;
        for (let ci = 0; ci < _CHAMBERS_PT.length; ci++) {
          const ch = _CHAMBERS_PT[ci];
          const nx = (wx - ch.cx) / ch.rx;
          const ny = (wy - ch.cy) / ch.ry;
          const nz = (wz - ch.cz) / ch.rz;
          const dN = Math.sqrt(nx*nx + ny*ny + nz*nz);
          if (dN < 1.0) { T = ch.Tmag; inChamber = true; break; }
          // Steady-state Fourier conduction: no exponential, pure algebraic decay
          T += Math.max(0, ch.Tmag - _chTbg[ci]) / dN;
        }
        if (!inChamber) T = Math.min(T, _CHAMBERS_PT[0].Tmag); // cap at peak chamber temp
        const P = _ptPressure(dEff);

        const phi = _ptMeltFrac(T, P);
        const E   = inChamber ? 1.5                : _ptYoungs(P, T, phi);
        const nu  = inChamber ? 0.499              : _ptPoisson(P, phi);

        // Data3DTexture layout: data[z*NX*NY + y*NX + x]
        const idx  = (iz * _PT_NX * _PT_NY + iy * _PT_NX + ix) * 4;
        data[idx+0] = (T  - 15)   / 1215;
        data[idx+1] = P            / 1.5;
        data[idx+2] = Math.max(0, (E  - 2)    / 62);
        data[idx+3] = Math.min(1, (nu - 0.18) / 0.30);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, _PT_NX, _PT_NY, _PT_NZ);
  tex.format     = THREE.RGBAFormat;
  tex.type       = THREE.FloatType;
  tex.minFilter  = THREE.LinearFilter;
  tex.magFilter  = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function _applyPropertyTexture(tex) {
  _propTex = tex;
  _domainFaceMats.forEach(m => { m.uniforms.uPropTex.value = tex; });
}

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
  // Cancel any in-progress fly-to when the user grabs the camera
  controls.domElement.addEventListener('pointerdown', () => { _flyToken++; _clearTourFlightTimer(); });
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
  _propTex = _buildPropertyTexture(null); // flat terrain (h=0) until STL loads
  buildGeologicalDomain();
  buildDomainLayerLabels();
  buildIonianSlab();
  buildSicilianThrustFront();
  buildSlabTears();
  buildSlabHeatZone();
  buildSlabFaultLines();
  buildIonianCrust();
  buildSTEPFault();
  buildChambers();
  buildPlumbingLabels();
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

  // Warm glow simulating magma heat — positioned at melt shell centroid
  const magmaGlow = new THREE.PointLight(0xff3300, 0.6, 25);
  magmaGlow.position.set(-1.14, -5.0, 5.31);
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
  _applyPropertyTexture(_buildPropertyTexture(_buildPropTopoMap(geo)));
  etnaLabelLayer = buildEtnaLabelLayer(scene, _sampleHeight);
  _buildOceanVolumeFromTerrain(geo);
  _buildTerrainSkirt(geo);
  buildHazardZones();
  buildFaultOverlays();
  buildGeologyOverlays(geo);
  buildTectonicFaults();
  buildSeismicOverlay();
  updateClipPlanes();
  if (basemapMode === 'satellite') applyBasemap('satellite');
  setStatus('');
}

// ─── Geological domain — layered structure from surface to −50 km ─────────────
// Two units visible as coloured bands on domain side / bottom faces.

// Lithosphere and mantle — simplified from full stratigraphy
// (Nicolich et al. 2000; Patanè et al. 2006)
const GEO_LAYERS = [
  {
    color: 0x7a5c38, emissive: 0x1e1208, label: 'Crust / Accretionary wedge', depth: '0–10 km',
    name: 'Crust / Accretionary wedge',
    kicker: 'Upper crust · 0–10 km depth',
    theme: 'general',
    meta: 'Vp ≈ 5.5–6.5 km/s · Thickness ~10 km · Nicolich et al. 2000',
    description: 'Continental and oceanic crustal material, including the accreted sedimentary wedge of the African plate subducting beneath Eurasia. Seismic velocities of 5.5–6.5 km/s indicate granitic to gabbroic compositions.',
  },
  {
    color: 0x6a3c20, emissive: 0x1a0c04, label: 'Lower crust + cusp', depth: '10–25.5 km',
    name: 'Lower crust + cusp',
    kicker: 'Lower crust · 10–25.5 km depth',
    theme: 'general',
    meta: 'Vp ≈ 6.5–7.4 km/s · mafic lower crust · Moho at ~25.5 km',
    description: 'Mafic lower crust and transitional cusp zone approaching the Moho discontinuity at ~25.5 km. Seismic velocities of 6.5–7.4 km/s indicate gabbroic to ultramafic compositions. The Moho discontinuity at ~25.5 km marks the base of the crust beneath central Sicily.',
  },
  {
    color: 0x8c3818, emissive: 0x280a04, label: 'Thinned lithospheric mantle — heated, melt-permeated', depth: '25.5–60 km',
    name: 'Thinned lithospheric mantle',
    kicker: 'Thinned lithospheric mantle · 25.5–60 km depth',
    theme: 'general',
    meta: 'Low-Vs anomaly · T ≈ 1100–1300 °C · partial melt fraction ~1–3%',
    description: 'Anomalously thin and thermally modified lithospheric mantle beneath the Etna edifice. The STEP fault and slab rollback have thinned and heated this zone, introducing melt fractions and metasomatic fluids from the asthenosphere below. Seismic tomography shows pronounced low-velocity anomalies consistent with partial melt percolation.',
  },
  {
    color: 0x4a1606, emissive: 0x140402, label: 'Asthenosphere / Mantle plume', depth: '60–80 km',
    name: 'Asthenosphere / Mantle plume',
    kicker: 'Convecting asthenosphere · 60–80 km depth',
    theme: 'general',
    meta: 'T > 1250 °C · Vp anomaly −3% · Schellart et al. 2008',
    description: 'Hot, partially molten asthenospheric mantle actively convecting beneath the subducting Ionian slab. The STEP (Slab Tear Edge Propagator) fault allows sub-slab asthenosphere to well up through the slab window, providing the anomalously hot, OIB-like magma source for Etna — distinct from typical subduction-related arc volcanism.',
  },
];

// Boundary surfaces — 5 entries for 4 layers. Each is [SW_y, SE_y, NW_y, NE_y] in km bsl.
const GEO_LAYER_BOUNDS = [
  [   0,    0,    0,    0],  // surface 0: terrain top
  [ -10,  -10,  -10,  -10],  // surface 1: lower crust top (~10 km bsl)
  [ -25.5, -25.5, -25.5, -25.5],  // surface 2: Moho / thinned litho top (~25.5 km bsl)
  [ -60,  -60,  -60,  -60],  // surface 3: LAB / asthenosphere top (~60 km bsl)
  [ -80,  -80,  -80,  -80],  // surface 4: domain floor
];

// ─── Domain layer labels (cross-section mode) ────────────────────────────────
// Verbatim port of the Mars core-view label pattern (mars-viewer.js:6717-6766).
// Dot marker on the cut face · invisible hit sphere · connector line · sprite.
// Mirrors the Mars core-view label pattern exactly:
// • Dot at the CENTRE of the cut face at each layer's mid-depth (not the edge).
// • Line from centre outward along the cut-face tangent to just beyond the domain wall.
// • Sprite at the far end of the line.
// All positions recompute on every angle change.

const _layerLabelData = []; // { dot, hit, lineGeo, sprite, anchorY, sw }
let _coreLabelsEnabled = true;

// Distance along (tx,tz) from (sx,sz) to first domain-wall hit.
function _domainExitT(sx, sz, tx, tz) {
  const hw = DOMAIN_W / 2;
  const ts = [];
  if (Math.abs(tx) > 1e-6) { ts.push((-hw - sx) / tx); ts.push((hw - sx) / tx); }
  if (Math.abs(tz) > 1e-6) { ts.push((-hw + GEO_Z_OFFSET - sz) / tz); ts.push((hw + GEO_Z_OFFSET - sz) / tz); }
  const pos = ts.filter(t => t > 0.5);
  return pos.length ? Math.min(...pos) : 55;
}

// Compute the centre of the cut face in XZ — project the domain centre (0, GEO_Z_OFFSET)
// onto the cut-plane line through (SX,SZ) with direction (tx,tz).
function _cutFaceCentre(SX, SZ, tx, tz) {
  // t = dot( domainCentre - planeOrigin, tangent )
  const t = (0 - SX) * tx + (GEO_Z_OFFSET - SZ) * tz;
  return { cx: SX + tx * t, cz: SZ + tz * t };
}

function buildDomainLayerLabels() {
  if (_layerLabelGroup) { scene.remove(_layerLabelGroup); _layerLabelGroup = null; }
  _layerLabelData.length = 0;
  _layerLabelInteractives.length = 0;
  _selectedCoreEntry = null;
  const group = new THREE.Group();

  const markerGeo = new THREE.SphereGeometry(0.8,  10, 10); // visible dot at domain depth scale
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffcf9d, depthTest: true, depthWrite: false });
  const hitGeo    = new THREE.SphereGeometry(2.8,  10, 10);
  const hitMat    = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: true, depthWrite: false });

  for (const [i, layer] of GEO_LAYERS.entries()) {
    const anchorY = (GEO_LAYER_BOUNDS[i][0] + GEO_LAYER_BOUNDS[i + 1][0]) / 2;
    const ph = new THREE.Vector3(0, anchorY, 0);

    const dot = new THREE.Mesh(markerGeo, markerMat.clone());
    dot.position.copy(ph);
    dot.userData.feature = layer;
    group.add(dot);

    const hit = new THREE.Mesh(hitGeo, hitMat.clone());
    hit.position.copy(ph);
    hit.userData.feature = layer;
    group.add(hit);
    _layerLabelInteractives.push(hit, dot);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([ph.clone(), ph.clone()]);
    // depthTest: true — line lives in the hidden (clipped) half where domain body is absent,
    // so it remains visible there but is correctly occluded by any domain wall that screens it.
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffcf9d, transparent: true, opacity: 0.45, depthTest: true });
    const line = new THREE.Line(lineGeo, lineMat);
    group.add(line);

    const labelTex = makeLabelTexture(layer.label);
    const spriteMat = new THREE.SpriteMaterial({
      map: labelTex.texture, transparent: true, opacity: 0.88,
      // depthTest: true — sprite is in the hidden half (domain body clipped there), so it
      // remains visible but is correctly occluded by any domain wall that screens it.
      depthTest: true, depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    const sw = (labelTex.width  / 200) * 0.85 * 10 * 1.65; // +65% size
    const sh = (labelTex.height / 200) * 0.85 * 10 * 1.65;
    sprite.scale.set(sw, sh, 1);
    sprite.position.copy(ph);
    sprite.renderOrder = 10;
    sprite.userData.feature = layer;
    group.add(sprite);
    _layerLabelInteractives.push(sprite);

    _layerLabelData.push({ dot, hit, line, lineGeo, sprite, layerId: layer.name, anchorY, sw });
  }

  // ── Core selection ring — mirrors Mars coreSelectionRing (line 11245) ────
  _coreSelectionRing = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
  );
  _coreSelectionRing.renderOrder = 203;
  _coreSelectionRing.visible = false;
  group.add(_coreSelectionRing);
  // ──────────────────────────────────────────────────────────────────────────

  group.visible = false;
  scene.add(group);
  _layerLabelGroup = group;
  _updateDomainLayerLabels();
}

// Reset a core label entry's material to its pre-pulse state (mirrors resetLabelEntryPulse)
function _resetCoreEntryPulse(entry) {
  if (!entry?._pulseBase) return;
  const pb = entry._pulseBase;
  if (entry.sprite?.material) { entry.sprite.material.color.copy(pb.spriteColor); entry.sprite.material.opacity = pb.spriteOpacity; }
  if (entry.dot?.material)    { entry.dot.material.color.copy(pb.dotColor); }
  if (entry.line?.material)   { entry.line.material.opacity = pb.lineOpacity; }
  delete entry._pulseBase;
}

// Set (or clear) the active core label entry — resets the previous one first
function _setCoreSelection(feature) {
  _resetCoreEntryPulse(_selectedCoreEntry);
  _selectedCoreEntry = feature
    ? (_layerLabelData.find(e => e.dot?.userData?.feature === feature) ?? null)
    : null;
  if (_coreSelectionRing && !_selectedCoreEntry) _coreSelectionRing.visible = false;
}

function _clearFaultSelection() {
  if (_faultPerimeterLine) {
    _faultRibbonGroup?.remove(_faultPerimeterLine);
    _faultPerimeterLine.geometry.dispose();
    _faultPerimeterLine.material.dispose();
    _faultPerimeterLine = null;
  }
  _selectedFaultMesh = null;
}

function _selectFaultMesh(mesh) {
  _clearFaultSelection();
  _selectedFaultMesh = mesh;
  const pos = mesh.geometry.attributes.position;
  const n = pos.count / 2; // vertex layout: top, bottom, top, bottom ...
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(pos.getX(i*2), pos.getY(i*2), pos.getZ(i*2)));
  for (let i = n - 1; i >= 0; i--) pts.push(new THREE.Vector3(pos.getX(i*2+1), pos.getY(i*2+1), pos.getZ(i*2+1)));
  pts.push(pts[0].clone()); // close the loop
  _faultPerimeterLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x00ffee, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
  );
  _faultPerimeterLine.renderOrder = 200;
  _faultRibbonGroup.add(_faultPerimeterLine);
}

function _updateDomainLayerLabels() {
  if (!_layerLabelGroup) return;
  const show = crossSectionEnabled && _coreLabelsEnabled;
  _layerLabelGroup.visible = show;
  if (!show || !_layerLabelData.length) return;

  // Summit world coords matching setCrossSectionAngle: d = -(nx*(-0.79) + nz*4.08)
  const SX = -0.79, SZ = 4.08;
  const PAD = 6; // km beyond the domain wall before the line ends

  const rad = (crossSectionAngle * Math.PI) / 180;
  const nx  = -Math.sin(rad);
  const nz  = -Math.cos(rad);
  // Tangent — used only to find the cut-face centre (projects domain centre onto cut plane)
  const tx  = nz, tz = -nx;

  // Centre of the cut face at each layer depth — mirrors Mars anchorPoint
  const { cx, cz } = _cutFaceCentre(SX, SZ, tx, tz);

  // Label direction: anti-normal = into the hidden/clipped half.
  // Mars: cut at x=0, normal=+X, labels go in -X (anti-normal, into hidden half).
  // Etna: labels go in (-nx, -nz) direction, perpendicular to the face.
  const lx = -nx, lz = -nz;
  const exitT = _domainExitT(cx, cz, lx, lz);
  const lineDist = (exitT + PAD) * 0.5; // 50% of full exit distance

  _layerLabelData.forEach(({ dot, hit, lineGeo, sprite, anchorY, sw }) => {
    dot.position.set(cx, anchorY, cz);
    hit.position.set(cx, anchorY, cz);

    // Line endpoint: fixed distance from face centre
    const lineX = cx + lx * lineDist;
    const lineZ = cz + lz * lineDist;

    const p = lineGeo.attributes.position;
    p.setXYZ(0, cx,    anchorY, cz);
    p.setXYZ(1, lineX, anchorY, lineZ);
    p.needsUpdate = true;
    lineGeo.computeBoundingSphere();

    // Sprite centre: sw/2 beyond line endpoint so near edge lands exactly on line end
    sprite.position.set(lineX + lx * sw * 0.5, anchorY, lineZ + lz * sw * 0.5);
  });
}

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
      // LAB top face: closes the mantle box at Y=−40
      pos.push(
        -hw, tSW, hw,   hw, tNE,-hw,   hw, tSE, hw,
        -hw, tSW, hw,  -hw, tNW,-hw,   hw, tNE,-hw
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.computeVertexNormals();

    const mat = _makeCapShaderMat({ clippingPlanes: [] });
    const mesh = new THREE.Mesh(geo, mat);
    layerGroup.add(mesh);
    _domainFaceMeshes.push(mesh);
    _domainFaceMats.push(mat);

    // Overdraw counterpart — covers hazard-ring bleed; must sync colorMode with base
    const odMat = _makeCapShaderMat({ clippingPlanes: [], depthTest: true, depthWrite: false });
    const odMesh = new THREE.Mesh(geo, odMat);
    odMesh.renderOrder = 10;
    overdrawGroup.add(odMesh);
    _domainFaceMats.push(odMat);
  });

  scene.add(layerGroup);
  scene.add(overdrawGroup);
  domainBox      = layerGroup;
  domainOverdraw = overdrawGroup;

  // ── Tilted boundary lines following each geological surface perimeter ─────
  const edgeGroup = new THREE.Group();
  edgeGroup.position.set(0, 0, GEO_Z_OFFSET);

  // Internal boundary surfaces (skip terrain top and domain floor)
  GEO_LAYER_BOUNDS.slice(1, -1).forEach((bounds) => {
    const mat = new THREE.LineBasicMaterial({ color: 0xc8a880, transparent: true, opacity: 0.85 });

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
    side: THREE.DoubleSide, depthWrite: true, clippingPlanes: [],
  });

  ionianSlab = new THREE.Mesh(slabGeo, slabMat);
  ionianSlab.position.z = GEO_Z_OFFSET;
  ionianSlab.renderOrder = 2;
  ionianSlab.visible = document.getElementById('ionian-slab-toggle')?.checked ?? false;
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
    side: THREE.DoubleSide, depthWrite: true, clippingPlanes: [],
  });

  ionianCrust = new THREE.Mesh(crustGeo, crustMat);
  ionianCrust.position.z = GEO_Z_OFFSET;
  ionianCrust.renderOrder = 3;
  ionianCrust.visible = document.getElementById('ionian-slab-toggle')?.checked ?? false;
  scene.add(ionianCrust);
}

// ─── Hyblean-Malta Escarpment ────────────────────────────────────────────────

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
    side: THREE.DoubleSide, depthWrite: true, clippingPlanes: [],
  });

  stepFault = new THREE.Mesh(geo, mat);
  stepFault.position.z = GEO_Z_OFFSET;
  stepFault.renderOrder = 4;
  stepFault.visible = document.getElementById('step-fault-toggle')?.checked ?? false;
  scene.add(stepFault);
}

// ─── Sicilian Chain Thrust Front — 3D slab volume ─────────────────────────────
// Face A = EUR_ITCS029 fault ribbon polygon (same math as _buildFaultRibbon,
// dip=32°, depth=18 km, dipRight=false). Face B = Face A displaced 10 km down.
// All 4 connecting faces and 2 end caps close the prism.
//
// Coordinate system: world XZ = _lonLatToModel XZ directly (same as _faultRibbonGroup,
// NO position.z offset — adding GEO_Z_OFFSET would shift 3.638 km off the ribbon).
// Non-indexed geometry so computeVertexNormals gives per-face normals at sharp edges.

function buildSicilianThrustFront() {
  // EUR_ITCS029 trace: _lonLatToModel [x, z] — world XZ (no position offset)
  const trace = [
    [ 13.37, 25.21],
    [  6.40, 28.35],
    [ -0.58, 31.50],
    [ -7.55, 34.64],
    [-13.83, 37.85],
    [-20.11, 41.06],
    [-26.38, 44.27],
    [-33.09, 48.96],
    [-34.58, 50.00],
  ];
  const DIP_DEG   = 32;
  const DIP_DEPTH = 38;  // km — extended 20 km beyond EUR_ITCS029 seismogenic base (18 km)
  const H_RUN     = DIP_DEPTH / Math.tan(DIP_DEG * Math.PI / 180);  // ≈ 28.80 km
  const DUP_DY    = -10; // Face B is 10 km below Face A
  const n         = trace.length;

  // Compute Face A ribbon vertices (mirror of _buildFaultRibbon, dipRight=false)
  // h ≈ 0 for southern lowlands; bottom Y = h - depth = -DIP_DEPTH
  const Atop = [], Abot = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = trace[i];
    let dx = 0, dz = 0;
    if (i < n - 1) { dx = trace[i+1][0] - x;  dz = trace[i+1][1] - z; }
    else            { dx = x - trace[i-1][0];  dz = z - trace[i-1][1]; }
    const len = Math.sqrt(dx*dx + dz*dz);
    if (len > 1e-8) { dx /= len; dz /= len; }
    const hx = -dz, hz = dx;          // left of travel direction = northward
    Atop.push([x,              0,          z            ]);
    Abot.push([x + hx*H_RUN,  -DIP_DEPTH, z + hz*H_RUN ]);
  }
  const Btop = Atop.map(([x, y, z]) => [x, y + DUP_DY, z]);
  const Bbot = Abot.map(([x, y, z]) => [x, y + DUP_DY, z]);

  // Non-indexed: each quad emits 6 unique vertices so computeVertexNormals
  // produces per-face normals with no averaging across the sharp prism edges.
  const pos  = [];
  const push3 = ([x,y,z]) => pos.push(x,y,z);
  const tri   = (a,b,c)   => { push3(a); push3(b); push3(c); };
  const quad  = (a,b,c,d) => { tri(a,b,c); tri(a,c,d); };

  for (let i = 0; i < n - 1; i++) {
    const [at0,ab0,bt0,bb0] = [Atop[i],  Abot[i],  Btop[i],  Bbot[i] ];
    const [at1,ab1,bt1,bb1] = [Atop[i+1],Abot[i+1],Btop[i+1],Bbot[i+1]];
    quad(at0, at1, ab1, ab0);  // Face A — fault ribbon
    quad(bt0, bb0, bb1, bt1);  // Face B — displaced copy
    quad(at0, bt0, bt1, at1);  // Top curtain  (surface trace, A↔B)
    quad(ab0, ab1, bb1, bb0);  // Bottom curtain (dip-bottom, A↔B)
  }
  quad(Atop[0],   Btop[0],   Bbot[0],   Abot[0]  );  // East end cap
  quad(Atop[n-1], Abot[n-1], Bbot[n-1], Btop[n-1]);  // West end cap

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhongMaterial({
    color: 0xc2b48a, emissive: 0x2a2010,
    specular: 0x4a3c22, shininess: 22,
    flatShading: true,
    transparent: true, opacity: 0.92,
    side: THREE.DoubleSide, depthWrite: true, clippingPlanes: [],
  });

  sicilianThrustSlab = new THREE.Mesh(geo, mat);
  // No position offset — world XZ = vertex XZ (matches _faultRibbonGroup convention)
  sicilianThrustSlab.renderOrder = 2;
  scene.add(sicilianThrustSlab);
}

// ─── Slab tears: cylinders at the plume–slab interface ───────────────────────
function buildSlabTears() {
  const tearMat = new THREE.MeshPhongMaterial({
    color: 0xff4400, emissive: 0xff2000, emissiveIntensity: 1.4,
    transparent: true, opacity: 0.88,
    side: THREE.DoubleSide, depthWrite: false, clippingPlanes: [],
  });

  // Build a cylinder from p1 to p2 with radius derived from w.
  // azRot unused for cylinders but kept so call-sites are unchanged.
  function sheet(p1, p2, w, azRot = 0) {
    const v1  = new THREE.Vector3(...p1), v2 = new THREE.Vector3(...p2);
    const len = v1.distanceTo(v2);
    const u   = new THREE.Vector3().subVectors(v2, v1).normalize();
    const r   = Math.max(0.03, w / 28);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.65, r, len, 8, 1, false),
      tearMat.clone()
    );
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    mesh.position.copy(v1.clone().lerp(v2, 0.5));
    mesh.renderOrder = 3;
    scene.add(mesh);
    _slabTears.push(mesh);
  }

  // Face B depth at any XZ — plane through plume disk centre (-23.95, -35.39, -2.62),
  // upward normal (-0.244, 0.848, -0.471):  y = [(0.244*(x+23.95) + 0.471*(z+2.62)) / 0.848] − 35.39
  function faceB(x, z) {
    return (0.244*(x + 23.95) + 0.471*(z + 2.62)) / 0.848 - 35.39;
  }

  const cx = -23.95, cz = -2.62;
  const EMERGE = 2.5;

  // [Δx, Δz, width_km, below_faceB_km, slab_frac, topAbsolute?]
  const defs = [
    // ── Central cluster (r < 3 km) ──────────────────────────────────────────────
    [  0.0,  0.0,  8.0, 4.0, 1.0],
    [ -1.8,  1.5,  6.5, 3.0, 1.0],
    [  2.0, -1.0,  6.0, 2.5, 1.0],
    [ -0.5, -2.2,  7.0, 3.5, 1.0],
    [  1.5,  2.5,  5.5, 2.5, 1.0],

    // ── Inner ring (r ≈ 4–6 km) ─────────────────────────────────────────────────
    [  4.5,  0.5,  4.5, 2.0, 1.0],
    [ -4.0,  2.0,  4.0, 1.5, 1.0],
    [  2.5,  4.5,  3.5, 1.5, 0.9],
    [ -2.5, -4.5,  4.5, 2.0, 1.0],
    [  4.0, -3.5,  3.0, 1.0, 0.9],
    [ -4.5, -2.0,  3.5, 1.5, 0.9],
    [  0.5,  5.5,  3.0, 1.0, 0.8],

    // ── Middle ring (r ≈ 7–10 km) ───────────────────────────────────────────────
    [  7.5,  2.0,  2.5, 0.5, 0.7],
    [ -7.0, -1.5,  2.5, 0.5, 0.7],
    [  5.0,  6.5,  2.0, 0.0, 0.6],
    [ -5.5, -6.0,  2.5, 0.0, 0.6],
    [  1.0,  9.0,  1.5, 0.0, 0.5],
    [ -1.5, -8.5,  2.0, 0.0, 0.5],
    [  8.5, -4.0,  1.5, 0.0, 0.5],
    [ -8.0,  4.5,  1.5, 0.0, 0.5],

    // ── Outer fringe (r ≈ 11–16 km) ─────────────────────────────────────────────
    [ 11.0,  2.0,  1.2, 0.0, 0.35],
    [-11.0, -1.5,  1.0, 0.0, 0.30],
    [  7.0, -9.0,  1.2, 0.0, 0.35],
    [ -7.0,  9.5,  1.0, 0.0, 0.30],
    [ 13.0, -1.0,  0.8, 0.0, 0.25],
    [ -4.0, 12.0,  1.0, 0.0, 0.30],
    [  3.0,-12.5,  0.9, 0.0, 0.25],

    // ── Chamber connector ────────────────────────────────────────────────────────
    [  3.22,  0.22,  5.0, 1.0, 0.0, -16.0],
  ];

  defs.forEach(([dx, dz, w, below, hFrac, topAbs]) => {
    const x = cx + dx, z = cz + dz;
    const yB   = faceB(x, z);
    const yBot = yB - below;
    const yTop = (topAbs !== undefined) ? topAbs : yB + hFrac * 10.0 + EMERGE;

    const isChamberConnector = (topAbs !== undefined);
    const leanScale = isChamberConnector ? 0.04 : 0.18;
    const azScale   = isChamberConnector ? 0.15 : 1.05;

    const height = yTop - yBot;
    const lx = (Math.random() - 0.5) * 2 * height * leanScale;
    const lz = (Math.random() - 0.5) * 2 * height * leanScale;
    const azRot = (Math.random() - 0.5) * 2 * azScale;

    sheet([x, yBot, z], [x + lx, yTop, z + lz], w, azRot);
  });

  // Small disc-like magma pockets sitting along some conduits
  function disc(x, y, z, r, thickness, tiltX = 0, tiltZ = 0) {
    const mat = tearMat.clone();
    mat.emissiveIntensity = 1.8;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, thickness, 20, 1, false),
      mat
    );
    mesh.position.set(x, y, z);
    mesh.rotation.x = tiltX;
    mesh.rotation.z = tiltZ;
    mesh.renderOrder = 3;
    scene.add(mesh);
    _slabTears.push(mesh);
  }

  disc(cx,        -31.5, cz,        1.10, 0.22,  0.08, -0.05);
  disc(cx - 1.8,  -29.2, cz + 1.5,  0.80, 0.18, -0.06,  0.10);
  disc(cx - 0.5,  -33.8, cz - 2.2,  0.95, 0.20,  0.10,  0.04);
  disc(cx + 2.0,  -27.8, cz - 1.0,  0.65, 0.16, -0.07,  0.09);
  disc(cx + 4.5,  -28.5, cz + 0.5,  0.55, 0.14,  0.12, -0.06);
  disc(cx - 4.0,  -30.8, cz + 2.0,  0.50, 0.14, -0.09,  0.11);
  disc(cx + 1.5,  -32.2, cz + 2.5,  0.60, 0.16, -0.05, -0.08);
}

// ─── Horizontal fault/stress lines on Face A showing slab degradation with depth ─
function buildSlabFaultLines() {
  // Face A orthonormal basis (same as buildSlabHeatZone)
  const STRIKE   = new THREE.Vector3(-0.889,  0.000,  0.460);
  const DIP_UP   = new THREE.Vector3( 0.390,  0.530,  0.753);
  const NORM_OUT = new THREE.Vector3(-0.244,  0.848, -0.471);
  const DIP_DOWN = DIP_UP.clone().negate();
  const BASIS    = new THREE.Matrix4().makeBasis(STRIKE, DIP_UP, NORM_OUT);

  // Face A top-centre: average of trace points (x,0,z) — where dip fraction d=0
  const TOP_CENTER = new THREE.Vector3(-12.93, 0.0, 37.98);
  const DIP_LENGTH = 71.7; // km — sqrt(H_RUN²+DIP_DEPTH²), 60.8²+38²

  // Physical offset above Face A to defeat z-fighting at any zoom level
  const SURFACE_LIFT = 0.30; // km in NORM_OUT direction

  // Lines at [dip_fraction, width_km, thickness_km, opacity]
  // Evenly-intentioned spacing (no random jitter) so no invisible gaps appear.
  // d=0 → surface trace; d=1 → max depth.  Density and darkness increase with depth.
  const lines = [
    // ── Shallow — one every ~7 km dip, very faint ────────────────────────────
    [0.10, 58, 0.09, 0.28],
    [0.18, 58, 0.09, 0.32],
    [0.26, 58, 0.10, 0.36],
    [0.34, 58, 0.10, 0.40],
    // ── Mid — every ~5 km dip ────────────────────────────────────────────────
    [0.41, 60, 0.11, 0.45],
    [0.47, 60, 0.11, 0.49],
    [0.53, 60, 0.12, 0.53],
    [0.59, 60, 0.12, 0.57],
    // ── Deep-mid — every ~3 km dip ───────────────────────────────────────────
    [0.63, 60, 0.13, 0.61],
    [0.67, 60, 0.13, 0.64],
    [0.71, 60, 0.14, 0.67],
    [0.75, 60, 0.14, 0.70],
    [0.79, 60, 0.15, 0.73],
    // ── Deep — every ~1.5 km dip, dense and dark ─────────────────────────────
    [0.82, 60, 0.15, 0.76],
    [0.84, 60, 0.16, 0.78],
    [0.86, 60, 0.16, 0.80],
    [0.88, 60, 0.17, 0.82],
    [0.90, 60, 0.17, 0.83],
    [0.92, 60, 0.18, 0.85],
    [0.94, 60, 0.18, 0.86],
    [0.96, 60, 0.19, 0.88],
    [0.98, 60, 0.19, 0.90],
  ];

  const baseMat = new THREE.MeshBasicMaterial({
    color: 0x0a0300,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    clippingPlanes: [],
  });

  lines.forEach(([d, w, thickness, opacity]) => {
    const pos = TOP_CENTER.clone()
      .addScaledVector(DIP_DOWN, DIP_LENGTH * d)
      .addScaledVector(NORM_OUT, SURFACE_LIFT);

    const mat = baseMat.clone();
    mat.opacity = opacity;

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, thickness), mat);
    mesh.quaternion.setFromRotationMatrix(BASIS);
    mesh.position.copy(pos);
    mesh.renderOrder = 4;
    scene.add(mesh);
    _slabTears.push(mesh);
  });
}

// ─── Lava heat-crack texture on Face A of the Sicilian Thrust slab ────────────
// Generates a procedural canvas crack network and applies it additively to the
// slab surface around the plume contact zone.

function _generateCrackCanvas(S) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);

  const allPaths = [];
  const cx = S * 0.5, cy = S * 0.5;

  function addCrack(x, y, angle, depth) {
    if (depth < 0) return;
    const pts = [[x, y]];
    let a = angle;
    const steps = Math.max(6, 14 + Math.floor(Math.random() * 14) - depth * 3);
    const segL  = S * (0.022 - depth * 0.004) * (0.7 + Math.random() * 0.6);
    for (let i = 0; i < steps; i++) {
      a += (Math.random() - 0.5) * 0.45;
      x += Math.cos(a) * segL;
      y += Math.sin(a) * segL;
      if (x < -S*0.1 || x > S*1.1 || y < -S*0.1 || y > S*1.1) break;
      pts.push([x, y]);
      if (depth > 0 && Math.random() < 0.14) {
        const dir = Math.random() > 0.5 ? 1 : -1;
        addCrack(x, y, a + dir * (0.5 + Math.random() * 1.0), depth - 1);
      }
    }
    if (pts.length >= 2) allPaths.push({ pts, depth });
  }

  // Radial cracks from the centre — heat rising from below
  for (let i = 0; i < 12; i++) {
    addCrack(cx, cy, (i / 12) * Math.PI * 2, 3);
  }
  // Edge-crossing cracks for a denser web
  const PI = Math.PI;
  addCrack(S*0.20, 0,      PI*0.48, 2);
  addCrack(S*0.68, 0,      PI*0.52, 2);
  addCrack(0,      S*0.32, 0.08,    2);
  addCrack(S,      S*0.60, PI,      2);
  addCrack(S*0.44, S,     -PI*0.5,  2);
  addCrack(S*0.82, S,     -PI*0.5+0.30, 2);
  addCrack(S*0.10, S,     -PI*0.5-0.28, 2);

  // Draw: far-glow → outer → orange → bright core → hot white
  allPaths.forEach(({ pts, depth }) => {
    const s = depth === 3 ? 1.0 : depth === 2 ? 0.60 : 0.36;
    const draw = (w, r, g, b, a) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
      ctx.lineWidth   = w * s;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.stroke();
    };
    draw(S*0.028, 120, 12,  0,  0.30);
    draw(S*0.018, 210, 45,  0,  0.55);
    draw(S*0.010, 255, 120, 0,  0.85);
    draw(S*0.004, 255, 210, 35, 1.00);
    draw(S*0.0016,255, 255, 200,1.00);
  });

  return canvas;
}

function buildSlabHeatZone() {
  const NORM_OUT = new THREE.Vector3(-0.244, 0.848, -0.471);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), NORM_OUT
  );

  const makeMat = (canvas) => new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true, opacity: 1.0,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    clippingPlanes: [],
  });

  // Face B — full-intensity cracks on the plume contact surface
  const meshB = new THREE.Mesh(new THREE.CircleGeometry(16, 64), makeMat(_generateCrackCanvas(1024)));
  meshB.quaternion.copy(q);
  meshB.position.set(-23.95, -35.39, -2.62);
  meshB.renderOrder = 5;
  scene.add(meshB);
  _slabTears.push(meshB);
  _slabHeatZoneMeshes.push(meshB);

  // Face A — same cracks but fading to transparent at the circumference
  const canvasA = _generateCrackCanvas(1024);
  const ctxA    = canvasA.getContext('2d');
  const S       = canvasA.width;
  ctxA.globalCompositeOperation = 'destination-in';
  const fade = ctxA.createRadialGradient(S/2, S/2, S*0.25, S/2, S/2, S*0.52);
  fade.addColorStop(0.0, 'rgba(255,255,255,1)');
  fade.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctxA.fillStyle = fade;
  ctxA.fillRect(0, 0, S, S);
  ctxA.globalCompositeOperation = 'source-over';

  const meshA = new THREE.Mesh(new THREE.CircleGeometry(16, 64), makeMat(canvasA));
  meshA.quaternion.copy(q);
  meshA.position.set(-23.95, -25.39, -2.62);
  meshA.renderOrder = 5;
  scene.add(meshA);
  _slabTears.push(meshA);
  _slabHeatZoneMeshes.push(meshA);
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
  // Sync initial visibility from master toggle (set before this build runs)
  const _fMaster = document.getElementById('faults-master-toggle');
  faultRootGroup.visible = _fMaster ? _fMaster.checked : true;
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
          line.renderOrder = 60; // above seismic mesh (50)
          group.add(line);
        }

        faultRootGroup.add(group);
      }
      updateClipPlanes(); // register fault materials with cross-section plane
    })
    .catch(e => console.warn('[faults] Failed to load etna-faults.json', e));
}


// ─── Geology canvas overlays ─────────────────────────────────────────────────
// Canvas-texture overlay meshes draped on the terrain (same BufferGeometry).
// UVs are aligned to SAT_GRID tile extent; coordinates map lon/lat → canvas px
// using the same formula as the basemap texture: u = (lon−GRID_W)/(GRID_E−GRID_W),
// v = (GRID_N−lat)/(GRID_N−GRID_S), with flipY=false.

function _lonLatToCanvas(lon, lat, w, h) {
  return [
    (lon - SAT_GRID_LON_W) / (SAT_GRID_LON_E - SAT_GRID_LON_W) * w,
    (SAT_GRID_LAT_N - lat) / (SAT_GRID_LAT_N - SAT_GRID_LAT_S) * h,
  ];
}

// Parse a lava flow age string to an approximate calendar year.
// Returns -999 for clearly prehistoric (radiometric ka/Ma), null for unparseable.
function _parseLavaYear(ageStr) {
  if (!ageStr || !ageStr.trim()) return null;
  const s = ageStr.trim();
  if (/\bka\b|\bMa\b|Radiometric|40Ar|39Ar/i.test(s)) return -999;
  const m = s.match(/\b(\d{3,4})\b/);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y >= 500 && y <= 2100) return y;
  }
  return null;
}

// Return canvas fillStyle colour for a lava flow's age string.
// Palette graduates from bright crimson (recent) to dark earthy brown (prehistoric).
function _lavaAgeColor(ageStr) {
  const y = _parseLavaYear(ageStr);
  if (y === -999) return 'rgba(98,46,26,0.80)';   // prehistoric (radiometric)
  if (y === null) return 'rgba(148,66,36,0.82)';  // unknown / no age data
  if (y >= 1900)  return 'rgba(218,42,10,0.91)';  // 20th–21st c — bright crimson
  if (y >= 1800)  return 'rgba(202,76,20,0.89)';  // 19th c — deep orange-red
  if (y >= 1600)  return 'rgba(180,96,28,0.87)';  // 17th–18th c — orange-brown
  if (y >= 1000)  return 'rgba(152,72,34,0.85)';  // medieval — medium brown-red
  return                  'rgba(118,55,30,0.83)';  // ancient (pre-1000 AD)
}

function _lonLatToModel(lon, lat) {
  return {
    x: (lon - SAT_LON_W) / (SAT_LON_E - SAT_LON_W) * 100 - 50,
    z: (SAT_LAT_N - lat) / (SAT_LAT_N - SAT_LAT_S) * 100 - 50,
  };
}

function _modelToLonLat(x, z) {
  return {
    lon: (x + 50) / 100 * (SAT_LON_E - SAT_LON_W) + SAT_LON_W,
    lat: SAT_LAT_N - (z + 50) / 100 * (SAT_LAT_N - SAT_LAT_S),
  };
}

// Even-odd ray-casting PIP across all rings (handles exterior + holes + MultiPolygon).
function _pointInPolygonRings(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}




function _makeCanvasOverlayMesh(terrainGeo, canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 1.0,
    depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3,
    side: THREE.FrontSide,
    clippingPlanes: [],
  });
  const mesh = new THREE.Mesh(terrainGeo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

function buildGeologyOverlays(geo) {
  const maxTex = renderer.capabilities.maxTextureSize;
  // Geology polygons are simplified at 22–111 m; 2048 px over 100 km = 48 m/px,
  // finer than source precision. Cap here saves ~192 MB vs 4096 (two 64 MB canvases).
  const HI = Math.min(2048, maxTex);

  const opSlider      = document.getElementById('geology-opacity');
  const baseOp        = opSlider ? parseFloat(opSlider.value) : 0.72;
  const masterTog     = document.getElementById('geology-master-toggle');
  const regionalGeoTog = document.getElementById('regional-geology-master-toggle');

  // ── Regional geology — EGDI 1:1M pan-European surface geology ────────────────
  const regCanvas = document.createElement('canvas');
  regCanvas.width = HI; regCanvas.height = HI;
  const regCtx = regCanvas.getContext('2d');

  fetch('./etna-regional-geology.json').then(r => r.json()).then(geoData => {
    _egdiGeoFeats = geoData.features;

    // Pass 1 — stroke each polygon outward with its own color to bleed into adjacent gaps.
    // lineWidth 6 at HI resolution ≈ the same order as the 0.001° simplification tolerance,
    // so gaps from mismatched simplified edges are fully covered by the nearest feature's color.
    regCtx.lineJoin = 'round';
    regCtx.lineCap  = 'round';
    for (const feat of _egdiGeoFeats) {
      regCtx.strokeStyle = feat[5];
      regCtx.lineWidth   = 6;
      regCtx.beginPath();
      for (const ring of feat[6]) {
        const [x0, y0] = _lonLatToCanvas(ring[0][0], ring[0][1], HI, HI);
        regCtx.moveTo(x0, y0);
        for (let j = 1; j < ring.length; j++) {
          const [xj, yj] = _lonLatToCanvas(ring[j][0], ring[j][1], HI, HI);
          regCtx.lineTo(xj, yj);
        }
        regCtx.closePath();
      }
      regCtx.stroke();
    }

    // Pass 2 — fill each polygon cleanly on top of the bleed layer.
    for (const feat of _egdiGeoFeats) {
      regCtx.fillStyle = feat[5];
      regCtx.beginPath();
      for (const ring of feat[6]) {
        const [x0, y0] = _lonLatToCanvas(ring[0][0], ring[0][1], HI, HI);
        regCtx.moveTo(x0, y0);
        for (let j = 1; j < ring.length; j++) {
          const [xj, yj] = _lonLatToCanvas(ring[j][0], ring[j][1], HI, HI);
          regCtx.lineTo(xj, yj);
        }
        regCtx.closePath();
      }
      regCtx.fill('evenodd');
    }

    regionalGeologyMesh = _makeCanvasOverlayMesh(geo, regCanvas);
    regionalGeologyMesh.renderOrder = 1;
    regionalGeologyMesh.material.opacity = baseOp;
    regionalGeologyMesh.visible = (masterTog?.checked !== false) && (regionalGeoTog?.checked !== false);
    scene.add(regionalGeologyMesh);
    updateClipPlanes();
    // Force GPU upload before releasing the CPU canvas — without this, an initially
    // hidden mesh never triggers a render in the 200 ms window and the texture is
    // lost when the canvas is blanked.
    renderer.initTexture(regionalGeologyMesh.material.map);
    setTimeout(() => { regCanvas.width = 1; regCanvas.height = 1; }, 200);
  }).catch(e => console.warn('[geology] EGDI load failed:', e));

  // ── Etna geology — INGV EtnaGeoMap verbatim from WMS KML ─────────────────────
  // 3,907 polygon features with per-feature WMS colours, names, ages and lithology
  // descriptions sourced directly from the INGV GeoServer (Branca et al. 2011/2015).
  // Features: [id, sigle_cart, name, type, age, formation, lithology, info_en1, color_hex, rings]
  const etnaCanvas = document.createElement('canvas');
  etnaCanvas.width = HI; etnaCanvas.height = HI;
  const etnaCtx = etnaCanvas.getContext('2d');
  const etnaGeoTog = document.getElementById('etna-geology-master-toggle');

  fetch('./etna-geology-ingv.json').then(r => r.json()).then(geoData => {
    _ingvGeoFeats = geoData.features;

    for (const feat of _ingvGeoFeats) {
      etnaCtx.fillStyle = feat[8]; // WMS SLD colour verbatim
      etnaCtx.beginPath();
      for (const ring of feat[9]) {
        const [x0, y0] = _lonLatToCanvas(ring[0][0], ring[0][1], HI, HI);
        etnaCtx.moveTo(x0, y0);
        for (let j = 1; j < ring.length; j++) {
          const [xj, yj] = _lonLatToCanvas(ring[j][0], ring[j][1], HI, HI);
          etnaCtx.lineTo(xj, yj);
        }
        etnaCtx.closePath();
      }
      etnaCtx.fill('evenodd');
    }

    etnaGeologyMesh = _makeCanvasOverlayMesh(geo, etnaCanvas);
    etnaGeologyMesh.renderOrder = 2;
    etnaGeologyMesh.material.opacity = baseOp;
    etnaGeologyMesh.visible = (masterTog?.checked !== false) && (etnaGeoTog?.checked !== false);
    scene.add(etnaGeologyMesh);
    updateClipPlanes();
    renderer.initTexture(etnaGeologyMesh.material.map);
    setTimeout(() => { etnaCanvas.width = 1; etnaCanvas.height = 1; }, 200);
  }).catch(e => console.warn('[geology] Failed to load etna-geology-ingv.json:', e));
}

// ─── Regional tectonic faults ─────────────────────────────────────────────────
// GEM Global Active Faults + ISPRA ITHACA clipped to domain, draped on terrain.
// Each fault also gets a 3D plane (ribbon mesh) extruded down-dip to the
// brittle–ductile transition. Geometry is clipped by domain planes so planes
// never protrude through the sides; top vertices sit at terrain surface so
// planes never protrude above ground.
//
// BDT depth 20 km — regional seismicity cutoff (Chiarabba et al. 2012; Neri et al. 2003).
// Named-fault dip/depth from: Lentini et al. 2006 & Catalano et al. 2008 (Malta
// Escarpment), Catalano et al. 2013 (Sicilian Chain Thrust), Palano et al. 2012
// (Tindari-Letojanni), Scicli from Monaco & Tortorici 2000, Ionian Subduction
// dip from Faccenna et al. 2011 & GEM slip model.

const _FP_BDT_KM = 20; // brittle–ductile transition — maximum fault plane depth

// Named-fault geometry overrides (literature-derived dip, dip direction, seismogenic depth)
const _FP_NAMED = {
  'EUR_ITCS016': { dip: 55, dipRight: false, maxDepth: 20 }, // Malta Escarpment: WSW-dipping normal
  'EUR_ITCS029': { dip: 32, dipRight: false, maxDepth: 18 }, // Sicilian Chain Thrust: N-vergent reverse
  'EUR_ITCS042': { dip: 80, dipRight: true,  maxDepth: 15 }, // Tindari-Letojanni: steep left-lateral
  'EUR_ITCS035': { dip: 85, dipRight: true,  maxDepth: 15 }, // Scicli: near-vertical left-lateral
  'PB_419.0':    { dip: 12, dipRight: false, maxDepth: 20 }, // Ionian Subduction: shallow thrust
};

// Kinematic-class defaults for ITHACA faults (dip from ITHACA statistical medians,
// depth from regional seismogenic thickness studies)
const _FP_KINEMATICS_DEF = {
  'Normal':             { dip: 65, maxDepth: 15 },
  'Normal Oblique DX':  { dip: 65, maxDepth: 12 },
  'Normal Oblique SX':  { dip: 65, maxDepth: 12 },
  'Oblique Normal DX':  { dip: 60, maxDepth: 12 },
  'Oblique Normal SX':  { dip: 60, maxDepth: 12 },
  'Strike Slip DX':     { dip: 80, maxDepth: 15 },
  'Strike Slip SX':     { dip: 80, maxDepth: 15 },
  'Oblique Reverse SX': { dip: 45, maxDepth: 15 },
  'Oblique Reverse DX': { dip: 45, maxDepth: 15 },
  'Reverse':            { dip: 35, maxDepth: 18 },
  'ND':                 { dip: 70, maxDepth: 10 },
  '':                   { dip: 70, maxDepth: 10 },
};

// Build a down-dip ribbon mesh from a surface-trace run.
// seg: [[x, h_unscaled, z], ...] in scene-km (h = terrain elevation, unscaled).
// vertExag: current vertical exaggeration — baked into top vertex Y so the ribbon
// surface trace matches the scaled terrain. The group containing this mesh has
// scale.y = 1/_vertExag (cancels tectonicFaultRoot.scale.y) so absolute Y is preserved.
// Bottom vertex Y = h - depth (absolute elevation below sea level) — never changes.
function _buildFaultRibbon(seg, dipDeg, dipRight, maxDepthKm, color, opacity, vertExag) {
  if (seg.length < 2) return null;
  const dipRad = Math.max(1, dipDeg) * Math.PI / 180;
  const depth  = Math.min(maxDepthKm, _FP_BDT_KM);
  const hRun   = depth / Math.tan(dipRad); // horizontal distance to BDT

  const verts   = [];
  const columns = []; // top stores UNSCALED h; bot stores fixed absolute elevation
  for (let i = 0; i < seg.length; i++) {
    const [x, h, z] = seg[i]; // h = unscaled terrain height

    let dx, dz;
    if (i < seg.length - 1) {
      dx = seg[i + 1][0] - x;  dz = seg[i + 1][2] - z;
    } else {
      dx = x - seg[i - 1][0];  dz = z - seg[i - 1][2];
    }
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 1e-8) { dx /= len; dz /= len; }

    const hx = dipRight ?  dz : -dz;
    const hz = dipRight ? -dx :  dx;

    const bx = x + hx * hRun, bd = h - depth, bz = z + hz * hRun;
    // Top Y baked as h*vertExag (net scale.y=1 group renders it at that position).
    // Bottom Y = h-depth: absolute elevation, anchored regardless of vertExag.
    verts.push(x, h * vertExag, z, bx, bd, bz);
    columns.push({ top: [x, h, z], bot: [bx, bd, bz] }); // top[1] = unscaled h
  }

  const nPairs = seg.length;
  const indices = [];
  for (let i = 0; i < nPairs - 1; i++) {
    const t0 = i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
    indices.push(t0, b0, t1,  b0, b1, t1);
  }
  if (indices.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    clippingPlanes: [],
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 58;
  return { mesh, columns, geo };
}

function buildTectonicFaults() {
  tectonicFaultRoot = new THREE.Group();
  tectonicFaultRoot.scale.y = _vertExag;
  const _tecTog      = document.getElementById('tectonic-faults-toggle');
  const _tecFltMaster = document.getElementById('faults-master-toggle');
  tectonicFaultRoot.visible = (_tecFltMaster ? _tecFltMaster.checked : true) && (_tecTog ? _tecTog.checked : true);
  scene.add(tectonicFaultRoot);

  // _faultRibbonGroup sits inside tectonicFaultRoot but counteracts its scale.y so
  // ribbon/face-line Y coordinates are in absolute km (not scaled by vert-exag).
  // Top vertex Y is baked as h*_vertExag; bottom vertex Y is absolute elevation.
  _faultRibbonGroup = new THREE.Group();
  _faultRibbonGroup.scale.y = 1 / _vertExag;
  tectonicFaultRoot.add(_faultRibbonGroup);

  // ITHACA kinematics colour scheme (ISPRA classification)
  const SLIP_COLORS = {
    'Normal':              0x4499ff,
    'Normal Oblique DX':   0x66aaff,
    'Normal Oblique SX':   0x66aaff,
    'Oblique Normal DX':   0x88bbff,
    'Oblique Normal SX':   0x88bbff,
    'Strike Slip DX':      0x2ec46a,
    'Strike Slip SX':      0x2ec46a,
    'Oblique Reverse SX':  0xe05050,
    'Oblique Reverse DX':  0xe05050,
    'Reverse':             0xe05050,
    'ND':                  0x999999,
  };

  // Map each feature to one of the 5 named sub-groups (or 'local' for all other ITHACA faults).
  function _tectonicSubGroup(id, name) {
    const n = (name || '').toLowerCase();
    if (id === 'EUR_ITCS016' || n.includes('scarpata di malta') || n.includes('scarpata di malta'))
      return 'malta';
    if (id === 'EUR_ITCS029') return 'thrust-front';
    if (typeof id === 'string' && id.startsWith('PB_')) return 'subduction';
    if (id === 'EUR_ITCS042') return 'tindari';
    if (id === 'EUR_ITCS035') return 'scicli';
    return 'local';
  }

  // Create one THREE.Group per sub-group, named for toggle lookup.
  const _tecSubGroupNames = ['thrust-front', 'subduction', 'malta', 'tindari', 'scicli', 'local'];
  const _tecSubGroups = {};
  for (const key of _tecSubGroupNames) {
    const g = new THREE.Group();
    g.name = `tectonic-${key}`;
    g.visible = (document.getElementById(`tectonic-${key}-toggle`)?.checked ?? true);
    tectonicFaultRoot.add(g);
    _tecSubGroups[key] = g;
  }

  fetch('./etna-tectonic-faults.json')
    .then(r => r.json())
    .then(data => {
      for (const feat of data.features) {
        // [id, name, kinematics, rank, url, source, coords]
        const [id, name, kinematics, rank, , , coords] = feat;
        const isRegional = rank === 'Regional';
        const color   = SLIP_COLORS[kinematics] ?? 0xaaaaaa;
        const opacity = isRegional ? 1.0 : rank === 'Primary' ? 0.88 : 0.48;
        const mat = new THREE.LineBasicMaterial({
          color, transparent: true, opacity, clippingPlanes: [],
        });
        const ghostMat = new THREE.LineBasicMaterial({
          color, transparent: true, opacity: 0, clippingPlanes: [], // opacity set live in updateClipPlanes
        });
        _ghostSurfaceTraceMats.push(ghostMat);
        const subGroup = _tecSubGroups[_tectonicSubGroup(id, name)];
        // Fault plane parameters: named override → kinematic default
        const _fpNamed = _FP_NAMED[id] ?? {};
        const _fpKin   = _FP_KINEMATICS_DEF[kinematics] ?? _FP_KINEMATICS_DEF[''];
        const fpDip    = _fpNamed.dip      ?? _fpKin.dip;
        const fpDipR   = _fpNamed.dipRight ?? true;
        const fpDepth  = _fpNamed.maxDepth ?? _fpKin.maxDepth;
        const fpOp     = isRegional ? 0.35 : rank === 'Primary' ? 0.22 : 0.12;

        for (const seg of coords) {
          // ── Surface trace line ──────────────────────────────────────────────
          let run = [];
          const flush = () => {
            if (run.length < 2) { run = []; return; }
            const posArr = new Float32Array(run.length * 3);
            run.forEach(([px, py, pz], i) => {
              posArr[i * 3] = px; posArr[i * 3 + 1] = py; posArr[i * 3 + 2] = pz;
            });
            const lgeo = new THREE.BufferGeometry();
            lgeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
            const line = new THREE.Line(lgeo, mat);
            line.renderOrder = isRegional ? 70 : 65;
            subGroup.add(line);
            // Ghost: same geometry, no cross-section clip — shows inactive half at low opacity
            const ghostLine = new THREE.Line(lgeo, ghostMat);
            ghostLine.renderOrder = isRegional ? 70 : 65;
            subGroup.add(ghostLine);
            run = [];
          };
          for (let i = 0; i < seg.length; i++) {
            const { x, z } = _lonLatToModel(seg[i][0], seg[i][1]);
            const h = _sampleHeight(x, z);
            if (isNaN(h) || h < -3.0) { flush(); continue; }
            run.push([x, Math.max(h, 0.02) + 0.01, z]);
          }
          flush();

          // ── Down-dip fault plane ribbon ─────────────────────────────────────
          let ribbon = [];
          const flushRibbon = () => {
            if (ribbon.length >= 2) {
              const result = _buildFaultRibbon(ribbon, fpDip, fpDipR, fpDepth, color, fpOp, _vertExag);
              if (result) {
                result.mesh.userData.feature = {
                  theme: 'fault',
                  name: name,
                  kicker: `${kinematics || 'Unknown kinematics'} · ${rank} fault`,
                  meta: `Dip: ${fpDip}° ${fpDipR ? 'right' : 'left'} · Max depth: ${fpDepth} km`,
                  description: `Fault ID: ${id}. ${kinematics ? kinematics + ' fault' : 'Fault'} with a dip of ${fpDip}° to the ${fpDipR ? 'right' : 'left'} of the trace direction. The seismogenic layer extends to approximately ${fpDepth} km depth.`,
                };
                _faultRibbonGroup.add(result.mesh);
                _faultRibbonMeshes.push(result.mesh);
                _faultRibbonData.push({ columns: result.columns, color, geo: result.geo });
              }
            }
            ribbon = [];
          };
          for (let i = 0; i < seg.length; i++) {
            const { x, z } = _lonLatToModel(seg[i][0], seg[i][1]);
            const h = _sampleHeight(x, z);
            if (isNaN(h) || h < -3.0) { flushRibbon(); continue; }
            ribbon.push([x, Math.max(h, 0.02), z]);
          }
          flushRibbon();
        }
      }
      updateClipPlanes();
      _buildFaultSideFaceLines();
      _updateFaultCapLines();
    })
    .catch(e => console.warn('[tectonic] Failed to load etna-tectonic-faults.json:', e));
}

// ─── Fault face intersection lines ───────────────────────────────────────────
// Where a fault plane ribbon intersects a domain face (4 side walls or the
// cross-section cap), draw the intersection as a coloured line ON that face.
// This avoids any hide/show of the 3D planes — the planes remain, and the
// face lines are additive overlays for geological cross-section readout.
//
// Groups are children of tectonicFaultRoot so they inherit scale.y (vert-exag),
// visibility, and clip-plane cascade automatically from updateClipPlanes().

// Compute the LineSegments vertex data for the intersection of one ribbon with
// one plane. Returns a Float32Array of [p0x,p0y,p0z, p1x,p1y,p1z, ...] pairs,
// or null. epsilon: inward offset (along plane.normal) to prevent z-fighting.
// vertExag: applied to top vertex Y so intersection Y matches the scaled geometry.
// Bottom vertex Y is already the absolute elevation (no scaling needed).
function _intersectRibbonWithPlane(columns, plane, epsilon, vertExag) {
  const n = plane.normal, c = plane.constant;
  const nx = n.x, ny = n.y, nz = n.z;
  const ve = vertExag ?? 1;
  const pts = [];
  for (let i = 0; i < columns.length - 1; i++) {
    const { top: t0, bot: b0 } = columns[i];
    const { top: t1, bot: b1 } = columns[i + 1];
    // Scale top Y to match the rendered position; bottom Y is absolute (no scaling)
    const T0 = [t0[0], t0[1] * ve, t0[2]];
    const B0 = b0; // absolute elevation
    const T1 = [t1[0], t1[1] * ve, t1[2]];
    const B1 = b1;
    const dT0 = nx*T0[0] + ny*T0[1] + nz*T0[2] + c;
    const dB0 = nx*B0[0] + ny*B0[1] + nz*B0[2] + c;
    const dT1 = nx*T1[0] + ny*T1[1] + nz*T1[2] + c;
    const dB1 = nx*B1[0] + ny*B1[1] + nz*B1[2] + c;
    const edges = [[T0,B0,dT0,dB0],[T1,B1,dT1,dB1],[T0,T1,dT0,dT1],[B0,B1,dB0,dB1]];
    const isects = [];
    for (const [a, b, da, db] of edges) {
      if (da * db < 0) {
        const tt = da / (da - db);
        isects.push([
          a[0] + (b[0]-a[0])*tt + nx*epsilon,
          a[1] + (b[1]-a[1])*tt + ny*epsilon,
          a[2] + (b[2]-a[2])*tt + nz*epsilon,
        ]);
      }
      if (isects.length === 2) break;
    }
    if (isects.length === 2) pts.push(...isects[0], ...isects[1]);
  }
  return pts.length >= 6 ? new Float32Array(pts) : null;
}

// Build intersection lines on the 4 domain side faces. Called once after fault
// data loads. Groups parented to tectonicFaultRoot for auto clip-plane cascade.
function _buildFaultSideFaceLines() {
  if (_faultSideLineGroup) {
    _faultRibbonGroup?.remove(_faultSideLineGroup);
    _faultSideLineGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    _faultSideLineGroup = null;
  }
  if (!_faultRibbonData.length || !_hazardDomainPlanes || !_faultRibbonGroup) return;

  _faultSideLineGroup = new THREE.Group();

  // One Object3D per face holding a single merged LineSegments (vertex colours).
  // One draw call per face eliminates the per-object sort that caused shimmer when
  // multiple depthTest:false segments at the same renderOrder swapped draw order.
  for (const domainPlane of _hazardDomainPlanes) {
    const allPos = [], allCol = [];
    for (const { columns, color } of _faultRibbonData) {
      const pts = _intersectRibbonWithPlane(columns, domainPlane, 0, _vertExag);
      if (!pts) continue;
      const c = new THREE.Color(color);
      for (let i = 0; i < pts.length; i += 3) {
        allPos.push(pts[i], pts[i+1], pts[i+2]);
        allCol.push(c.r, c.g, c.b);
      }
    }
    if (!allPos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPos), 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(allCol), 3));
    const ls = new THREE.LineSegments(geo,
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, clippingPlanes: [] }));
    ls.renderOrder = 90;
    ls.userData.domainPlane = domainPlane;
    _faultSideLineGroup.add(ls);
  }

  _faultRibbonGroup.add(_faultSideLineGroup);
  updateClipPlanes();
}

// Build intersection lines on the cross-section cap face. Called whenever the
// cross-section is toggled or its angle changes.
function _updateFaultCapLines() {
  if (_faultCapLineGroup) {
    _faultRibbonGroup?.remove(_faultCapLineGroup);
    _faultCapLineGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    _faultCapLineGroup = null;
  }
  if (!crossSectionEnabled || !clipPlane || !_faultRibbonData.length || !_faultRibbonGroup) return;

  _faultCapLineGroup = new THREE.Group();

  const capPos = [], capCol = [];
  for (const { columns, color } of _faultRibbonData) {
    const pts = _intersectRibbonWithPlane(columns, clipPlane, 0, _vertExag);
    if (!pts) continue;
    const c = new THREE.Color(color);
    for (let i = 0; i < pts.length; i += 3) {
      capPos.push(pts[i], pts[i+1], pts[i+2]);
      capCol.push(c.r, c.g, c.b);
    }
  }
  if (capPos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capPos), 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(capCol), 3));
    const ls = new THREE.LineSegments(geo,
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, clippingPlanes: [] }));
    ls.renderOrder = 91;
    _faultCapLineGroup.add(ls);
  }

  _faultRibbonGroup.add(_faultCapLineGroup);
  updateClipPlanes();
}

// ─── Geology contacts (3D lines) ─────────────────────────────────────────────
// Polylines from etna-contacts.json draped on terrain — same pattern as tectonic
// faults. Two tiers rendered: regional (ISPRA dissolved litho, full domain) and
// major (INGV EtnaGeoMap type boundaries, edifice). Minor tier skipped — INGV
// Three tiers: regional (ISPRA dissolved litho, full domain), major (INGV type
// boundaries) and minor (INGV formation boundaries within same type — essential
// for the volcanic edifice where everything is Volcanic type).
// One THREE.Line per feature (continuous strip) — same as buildTectonicFaults.



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
      const sphereGeo = new THREE.SphereGeometry(1, 16, 12);

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

// ─── Magma convection swirl shaders ──────────────────────────────────────────
// Shared GLSL functions injected into chamber mesh, chamber cap, and domain face
// cap shaders. _CAP_GLSL_NOISE must be defined first (fbm, swirl dependency).

const _CAP_GLSL_NOISE = `
  float h21(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+45.32);return fract(p.x*p.y);}
  float vnoise(vec2 p){
    vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),
               mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);
  }
  float fbm(vec2 p){float v=0.;float a=0.5;
    for(int i=0;i<6;i++){v+=a*vnoise(p);p*=2.15;a*=0.5;}return v;}
  float ridged(vec2 p){
    float v=0.;float a=0.5;
    for(int i=0;i<5;i++){float n=1.0-abs(vnoise(p)*2.0-1.0);v+=n*a;p*=2.05;a*=0.5;}
    return v;
  }
  vec2 swirl(vec2 p,float amount){
    float a=amount*(fbm(p*0.6)-0.5)*6.28318;
    float s=sin(a),c=cos(a);
    return mat2(c,-s,s,c)*p;
  }
`;

const _SWIRL_GLSL = `
  // 3D magma convection — viscous Rayleigh–Bénard-style rolls.
  // norm:     normalised position in chamber frame, [-1,1]³
  // rotSpeed: angular speed (rad/s) for large-scale differential rotation;
  //           pass 0.0 for the lower reservoir (no rigid-body spin on a large body).
  // t:        time in seconds
  vec3 magmaSwirl(vec3 norm, float rotSpeed, float t) {
    float ca = cos(t * rotSpeed), sa = sin(t * rotSpeed);
    vec2 rxz = vec2(ca*norm.x - sa*norm.z, sa*norm.x + ca*norm.z);
    float ta = t * 0.032;
    float n1 = fbm(swirl(rxz * 2.4 + vec2(ta*0.70, -ta*0.40), 0.55));
    float n2 = fbm(       rxz * 1.3 - vec2(ta*0.50, -ta*0.30) + vec2(4.1, 2.7));
    float buoy = clamp(-norm.y*0.35 + (1.0 - length(norm.xz))*0.25, -0.25, 0.45);
    float heat = clamp(n1*0.45 + n2*0.30 + buoy + 0.28, 0.0, 1.0);
    heat = mix(heat, 0.05, smoothstep(0.58, 0.95, length(norm)) * 0.55);
    vec3 crust  = vec3(0.36, 0.04, 0.01);
    vec3 dark   = vec3(0.52, 0.07, 0.01);
    vec3 orange = vec3(0.90, 0.26, 0.03);
    vec3 bright = vec3(1.00, 0.78, 0.18);
    if(heat < 0.33) return mix(crust,  dark,   heat * 3.0);
    if(heat < 0.66) return mix(dark,   orange, (heat - 0.33) * 3.0);
    return             mix(orange, bright, (heat - 0.66) * 3.0);
  }

  // 2D variant for cross-section cap fills (horizontal×vertical slice).
  vec3 magmaSwirl2D(vec2 norm2D, float t) {
    float ta = t * 0.032;
    float n1 = fbm(swirl(norm2D * 2.4 + vec2(ta*0.70, -ta*0.40), 0.55));
    float n2 = fbm(      norm2D * 1.3 - vec2(ta*0.50, -ta*0.30) + vec2(4.1, 2.7));
    float buoy = clamp(-norm2D.y*0.35 + (1.0 - length(norm2D))*0.25, -0.25, 0.45);
    float heat = clamp(n1*0.45 + n2*0.30 + buoy + 0.28, 0.0, 1.0);
    heat = mix(heat, 0.05, smoothstep(0.58, 0.95, length(norm2D)) * 0.55);
    vec3 crust  = vec3(0.36, 0.04, 0.01);
    vec3 dark   = vec3(0.52, 0.07, 0.01);
    vec3 orange = vec3(0.90, 0.26, 0.03);
    vec3 bright = vec3(1.00, 0.78, 0.18);
    if(heat < 0.33) return mix(crust,  dark,   heat * 3.0);
    if(heat < 0.66) return mix(dark,   orange, (heat - 0.33) * 3.0);
    return             mix(orange, bright, (heat - 0.66) * 3.0);
  }
`;

// Vertex shader shared by chamber mesh ShaderMaterials.
// uNormScale divides local position so vNorm is always in [-1,1]³,
// regardless of geometry radius.
const _CHAMBER_VERT = `
  uniform vec3 uNormScale;
  #include <clipping_planes_pars_vertex>
  out vec3 vNorm;
  void main(){
    vNorm = position / uNormScale;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    #include <clipping_planes_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const _CHAMBER_FRAG = `
  #include <clipping_planes_pars_fragment>
  in vec3 vNorm;
  uniform float uTime;
  uniform float uRotSpeed;
  uniform bool  uIsConduit;
  out vec4 fragColor;
  ${_CAP_GLSL_NOISE}
  ${_SWIRL_GLSL}
  void main(){
    #include <clipping_planes_fragment>
    vec3 c;
    if(uIsConduit){
      // Conduits: static warm glow with very slow fbm drift — no motion artifacts.
      float h = fbm(vNorm.xy * 1.4 + vec2(0.0, uTime * 0.010));
      c = mix(vec3(0.58, 0.08, 0.01), vec3(0.90, 0.26, 0.03), clamp(h * 0.5 + 0.30, 0.0, 1.0));
    } else {
      c = magmaSwirl(vNorm, uRotSpeed, uTime);
    }
    fragColor = vec4(c, 0.93);
  }
`;

// All animated chamber + conduit ShaderMaterials — uTime updated each frame.
const _chamberMats = [];

// ─── Magmatic plumbing system ─────────────────────────────────────────────────
// Firetto Carlino et al. magma plumbing system:
//   Conduit → Melt shell (wrapping HVB obstacle) → Deep storage
// Coordinates: world-space km (X=east, Y=up, Z=south with GEO_Z_OFFSET baked in).

function buildChambers() {
  function mkChamberMat(normScale, isConduit = false, rotSpeed = 0.0) {
    const m = new THREE.ShaderMaterial({
      vertexShader:   _CHAMBER_VERT,
      fragmentShader: _CHAMBER_FRAG,
      uniforms: {
        uNormScale:  { value: normScale instanceof THREE.Vector3 ? normScale : new THREE.Vector3(...normScale) },
        uTime:       { value: 0 },
        uRotSpeed:   { value: rotSpeed },
        uIsConduit:  { value: isConduit },
      },
      glslVersion: THREE.GLSL3,
      side: THREE.FrontSide,
      transparent: true,
      opacity: 0.93,
      clipping: true,
    });
    _chamberMats.push(m);
    return m;
  }

  // Summit spherical chamber: r=0.5 km, 1.5 km asl, directly under craters
  const summitChamber = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 32),
    mkChamberMat(new THREE.Vector3(1, 1, 1), false, 0.0)
  );
  summitChamber.scale.set(0.5, 0.5, 0.5);
  summitChamber.position.set(-0.26, 1.5, 0.42);  // 37.784°N 15.00°E
  scene.add(summitChamber);
  chamberMeshes.push(summitChamber);

  // Prolate spheroid: semi-major 1 km (vertical), semi-minor 0.5 km (horizontal)
  // Centre at sea level (y=0); top y=+1 touches summit chamber bottom y=+1 seamlessly
  const prolateChamber = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 32),
    mkChamberMat(new THREE.Vector3(1, 1, 1), false, 0.0)
  );
  prolateChamber.scale.set(0.25, 1.0, 0.25);
  prolateChamber.position.set(-0.79, -2, 4.08);
  scene.add(prolateChamber);
  chamberMeshes.push(prolateChamber);

  // Melt shell: oblate ellipsoid wrapping HVB obstacle
  // Strike 045° (NE-SW), dip 15° SE; rx=3, ry=1.5, rz=2.5 km
  const meltShell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 40),
    mkChamberMat(new THREE.Vector3(1, 1, 1), false, 0.0)
  );
  meltShell.scale.set(1.4, 0.7, 1.2);
  meltShell.position.set(-1.14, -5.0, 5.31);
  scene.add(meltShell);
  chamberMeshes.push(meltShell);

  // Intermediate oblate lens at 10 km depth — 6 km across × 2 km height
  // Sits on the conduit from deep storage (-20.73,-18,-2.40) → melt shell (-1.14,-5,5.31).
  // Polar axis aligned to that conduit direction (0.792, 0.525, 0.312).
  const midLens = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 40),
    mkChamberMat(new THREE.Vector3(1, 0.33, 1), false, 0.0)
  );
  midLens.scale.set(3, 1, 3);
  midLens.position.set(-8.67, -10.0, 2.34);
  scene.add(midLens);
  chamberMeshes.push(midLens);

  // ── Shallow sill complex: oblate spheroids arcing toward mid lens at (-8.67,-10,2.34).
  // Arc trend: deeper = further west/southwest. Large scatter breaks up regularity.
  // [x, y, z, r_eq, r_polar]
  [
    [ 0.30, -0.8,  5.10,  0.50, 0.08],
    [-1.60, -1.1,  2.60,  0.45, 0.07],
    [ 0.10, -1.4,  4.70,  0.55, 0.09],
    [-0.40, -1.7,  3.00,  0.50, 0.08],
    [-2.40, -1.3,  5.40,  0.48, 0.08],
    [-1.00, -2.1,  2.20,  0.60, 0.10],
    [-3.50, -2.4,  4.90,  0.70, 0.11],
    [-0.80, -2.8,  3.60,  0.55, 0.09],
    [-4.20, -2.2,  2.00,  0.65, 0.10],
    [-2.10, -3.3,  5.20,  0.60, 0.10],
    [-5.10, -3.1,  3.80,  0.65, 0.10],
    [-2.80, -3.7,  1.60,  0.55, 0.09],
    [-3.60, -4.2,  4.80,  0.80, 0.12],
    [-5.80, -3.9,  2.60,  0.60, 0.10],
    [-3.00, -4.9,  1.40,  0.65, 0.10],
    [-6.30, -4.6,  4.20,  0.55, 0.09],
    [-4.50, -5.4,  3.10,  0.60, 0.09],
    [-5.20, -5.1,  1.20,  0.55, 0.09],
    [-7.10, -5.7,  3.60,  0.50, 0.08],
    [-4.80, -6.2,  4.50,  0.50, 0.08],
    [-6.50, -6.6,  1.80,  0.45, 0.08],
    [-5.40, -7.1,  3.40,  0.45, 0.07],
    [-7.80, -6.9,  2.80,  0.40, 0.07],
    [-6.90, -7.5,  1.50,  0.42, 0.07],
    [-7.40, -7.3,  3.10,  0.40, 0.07],
    [-6.20, -7.8,  2.20,  0.45, 0.08],
    [-7.90, -7.6,  1.90,  0.38, 0.07],
    // E and SE extensions
    [ 1.20, -1.0,  3.80,  0.55, 0.09],
    [ 2.50, -1.4,  4.60,  0.50, 0.08],
    [ 1.80, -0.7,  5.80,  0.48, 0.08],
    [ 3.40, -2.1,  3.20,  0.60, 0.10],
    [ 1.60, -2.5,  6.50,  0.55, 0.09],
    [ 2.80, -1.8,  5.40,  0.52, 0.08],
    [ 4.10, -1.2,  4.80,  0.45, 0.07],
    [ 0.90, -3.2,  7.20,  0.60, 0.10],
    [ 3.20, -3.5,  5.90,  0.55, 0.09],
    [ 2.10, -4.0,  6.80,  0.50, 0.08],
    [ 4.50, -2.8,  3.60,  0.48, 0.08],
    [ 1.40, -4.6,  5.20,  0.55, 0.09],
    [ 3.60, -4.2,  6.40,  0.45, 0.07],
    [ 0.60, -5.0,  7.50,  0.50, 0.08],
    [ 2.40, -5.5,  4.90,  0.45, 0.07],
  ].forEach(([x, y, z, rEq, rPol]) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      mkChamberMat(new THREE.Vector3(1, rPol / rEq, 1), false, 0.0)
    );
    m.scale.set(rEq, rPol, rEq);
    m.position.set(x, y, z);
    scene.add(m);
    chamberMeshes.push(m);
  });

  // Deep magma storage: vertical ellipsoid rx=2, ry=2.5, rz=1.5 km
  const deepStorage = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 40),
    mkChamberMat(new THREE.Vector3(1, 1, 1), false, 0.0)
  );
  deepStorage.scale.set(6, 2, 6);
  // Thin axis (local Y) aligned to slab normal (-0.244, 0.848, -0.471)
  deepStorage.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-0.244, 0.848, -0.471)
  );
  deepStorage.position.set(-20.73, -18.0, -2.40);
  scene.add(deepStorage);
  chamberMeshes.push(deepStorage);

  // Connecting dykes — thin cylinders oriented along the feed path
  function addDyke(p1, p2, r) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, len, 12),
      mkChamberMat(new THREE.Vector3(r, len / 2, r), true)
    );
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    scene.add(mesh);
    chamberMeshes.push(mesh);
  }
  // Returns point on mesh's ellipsoid surface facing otherPt, pulled inward to frac of radius.
  // Handles quaternion rotation (e.g. tilted deep storage).
  function shellPt(mesh, otherPt, frac) {
    frac = frac !== undefined ? frac : 0.92;
    const dWorld = new THREE.Vector3().subVectors(otherPt, mesh.position);
    const dLocal = dWorld.clone().applyQuaternion(mesh.quaternion.clone().invert());
    const rx = mesh.scale.x, ry = mesh.scale.y, rz = mesh.scale.z;
    const t = frac / Math.sqrt((dLocal.x / rx) ** 2 + (dLocal.y / ry) ** 2 + (dLocal.z / rz) ** 2);
    return dLocal.multiplyScalar(t).applyQuaternion(mesh.quaternion).add(mesh.position);
  }

  // Main conduit chain — endpoints anchored to chamber ellipsoid surfaces
  addDyke(shellPt(summitChamber,  prolateChamber.position), shellPt(prolateChamber, summitChamber.position),  0.05); // A
  addDyke(shellPt(prolateChamber, meltShell.position),      shellPt(meltShell,      prolateChamber.position), 0.05); // B
  addDyke(shellPt(meltShell,      midLens.position),        shellPt(midLens,        meltShell.position),      0.05); // C1
  addDyke(shellPt(midLens,        deepStorage.position),    shellPt(deepStorage,    midLens.position),        0.05); // C2

  // ── Sill pathway network — all conduits flow strictly upward (deep → shallow) ─
  const V = (x,y,z) => new THREE.Vector3(x,y,z);

  // Roots: mid lens surface → deepest sills
  addDyke(shellPt(midLens, V(-7.20,-7.9, 2.60)), V(-7.20,-7.9, 2.60), 0.05);
  addDyke(shellPt(midLens, V(-6.20,-7.8, 2.20)), V(-6.20,-7.8, 2.20), 0.05);
  addDyke(shellPt(midLens, V(-7.80,-6.9, 2.80)), V(-7.80,-6.9, 2.80), 0.05);

  // Deepest layer (y ≈ -7.9 to -7.2) — branching upward
  addDyke(V(-7.20,-7.9, 2.60), V(-7.90,-7.6, 1.90), 0.04);
  addDyke(V(-7.20,-7.9, 2.60), V(-7.00,-7.6, 2.90), 0.04);
  addDyke(V(-7.00,-7.6, 2.90), V(-7.40,-7.3, 3.10), 0.04);
  addDyke(V(-7.40,-7.3, 3.10), V(-6.60,-7.2, 3.00), 0.04);
  addDyke(V(-6.20,-7.8, 2.20), V(-6.90,-7.5, 1.50), 0.04);
  addDyke(V(-6.20,-7.8, 2.20), V(-5.40,-7.1, 3.40), 0.04);

  // Mid-deep layer (y ≈ -7.5 to -5.7)
  addDyke(V(-6.90,-7.5, 1.50), V(-6.50,-6.6, 1.80), 0.04);
  addDyke(V(-7.80,-6.9, 2.80), V(-6.50,-6.6, 1.80), 0.04);
  addDyke(V(-7.40,-7.3, 3.10), V(-7.10,-5.7, 3.60), 0.05);
  addDyke(V(-6.60,-7.2, 3.00), V(-7.10,-5.7, 3.60), 0.04);
  addDyke(V(-5.40,-7.1, 3.40), V(-4.80,-6.2, 4.50), 0.04);

  // Mid layer (y ≈ -6.6 to -4.6)
  addDyke(V(-6.50,-6.6, 1.80), V(-5.20,-5.1, 1.20), 0.04);
  addDyke(V(-6.50,-6.6, 1.80), V(-5.80,-3.9, 2.60), 0.05);
  addDyke(V(-4.80,-6.2, 4.50), V(-4.50,-5.4, 3.10), 0.04);
  addDyke(V(-4.80,-6.2, 4.50), V(-4.60,-5.4, 4.70), 0.04);
  addDyke(V(-7.10,-5.7, 3.60), V(-6.30,-4.6, 4.20), 0.05);
  addDyke(V(-5.20,-5.1, 1.20), V(-4.20,-2.2, 2.00), 0.04);

  // Upper-mid (y ≈ -5.4 to -3.1)
  addDyke(V(-4.50,-5.4, 3.10), V(-3.60,-4.2, 4.80), 0.04);
  addDyke(V(-4.50,-5.4, 3.10), V(-3.00,-4.9, 1.40), 0.04);
  addDyke(V(-6.30,-4.6, 4.20), V(-5.10,-3.1, 3.80), 0.05);
  addDyke(V(-5.80,-3.9, 2.60), V(-2.80,-3.7, 1.60), 0.05);
  addDyke(V(-3.60,-4.2, 4.80), V(-2.10,-3.3, 5.20), 0.04);
  addDyke(V(-5.10,-3.1, 3.80), V(-3.50,-2.4, 4.90), 0.05);
  addDyke(V(-3.50,-2.4, 4.90), V(-4.20,-2.2, 2.00), 0.04);

  // Shallow (y ≈ -3.7 to -1.1)
  addDyke(V(-2.80,-3.7, 1.60), V(-1.00,-2.1, 2.20), 0.04);
  addDyke(V(-2.10,-3.3, 5.20), V(-3.50,-2.4, 4.90), 0.04);
  addDyke(V(-3.50,-2.4, 4.90), V(-2.40,-1.3, 5.40), 0.04);
  addDyke(V(-3.50,-2.4, 4.90), V(-0.80,-2.8, 3.60), 0.05);
  addDyke(V(-1.00,-2.1, 2.20), V(-1.60,-1.1, 2.60), 0.04);
  addDyke(V(-0.80,-2.8, 3.60), V(-0.40,-1.7, 3.00), 0.04);
  addDyke(V(-0.80,-2.8, 3.60), V( 0.10,-1.4, 4.70), 0.04);
  addDyke(V(-0.40,-1.7, 3.00), V(-1.60,-1.1, 2.60), 0.04);

  // E/SE chain — all upward from deepest E/SE sills
  addDyke(V(-4.80,-6.2, 4.50), shellPt(meltShell, V(-4.80,-6.2, 4.50)), 0.05);  // T → melt shell
  addDyke(V(-4.80,-6.2, 4.50), V( 2.40,-5.5, 4.90), 0.04);  // lateral feed to E/SE
  addDyke(V( 2.40,-5.5, 4.90), V( 0.60,-5.0, 7.50), 0.04);
  addDyke(V( 2.40,-5.5, 4.90), V( 1.40,-4.6, 5.20), 0.04);
  addDyke(V( 1.40,-4.6, 5.20), V( 2.10,-4.0, 6.80), 0.04);
  addDyke(V( 2.10,-4.0, 6.80), V( 0.90,-3.2, 7.20), 0.04);
  addDyke(V( 1.40,-4.6, 5.20), V( 4.50,-2.8, 3.60), 0.04);
  addDyke(V( 4.50,-2.8, 3.60), V( 3.40,-2.1, 3.20), 0.04);
  addDyke(V( 3.60,-4.2, 6.40), V( 3.20,-3.5, 5.90), 0.04);
  addDyke(V( 3.20,-3.5, 5.90), V( 1.60,-2.5, 6.50), 0.04);
  addDyke(V( 3.20,-3.5, 5.90), V( 2.80,-1.8, 5.40), 0.04);
  addDyke(V( 0.90,-3.2, 7.20), V(-0.80,-2.8, 3.60), 0.04);
  addDyke(V( 3.40,-2.1, 3.20), V( 1.20,-1.0, 3.80), 0.04);
  addDyke(V( 2.80,-1.8, 5.40), V( 2.50,-1.4, 4.60), 0.04);
  addDyke(V( 2.50,-1.4, 4.60), V( 4.10,-1.2, 4.80), 0.04);
  addDyke(V( 2.50,-1.4, 4.60), V( 0.30,-0.8, 5.10), 0.04);
  addDyke(V( 1.20,-1.0, 3.80), V( 1.80,-0.7, 5.80), 0.04);

  // ── Mantle plume 3D geometry ──────────────────────────────────────────────
  // One continuous LatheGeometry traces the full mushroom profile:
  //   stem (r=2 km) rising from domain base (−80) and flaring into an oblate
  //   head that reaches r=8 km at the Moho (−25.5 km, flat top).
  // A CircleGeometry disk closes the flat top face.
  // Both pushed to chamberMeshes so updateClipPlanes() applies the cut plane.
  const _plumeMat = new THREE.MeshPhongMaterial({
    color:             0xff5500,
    emissive:          0xff3300,
    emissiveIntensity: 1.0,
    transparent:       true,
    opacity:           0.88,
    side:              THREE.DoubleSide,
    clipping:          true,
  });

  // Vertical stem: CylinderGeometry from domain floor to base of flare.
  // Flare base (local 0,−42,0 after tilt) lands at world (−21.02, −45.57, 3.03).
  const plumeStem = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2, 40, 32),  // y=−80 → y=−40, penetrates flare base
    _plumeMat
  );
  plumeStem.position.set(-21.02, -60, 3.03);   // centre at (−80 + −40)/2 = −60
  scene.add(plumeStem);
  chamberMeshes.push(plumeStem);

  // Tilted flare only (y=−42 → y=−30 in local space), axis aligned to slab normal.
  const _plumeProfile = [
    new THREE.Vector2( 2.0, -42),  // base — connects to stem top
    new THREE.Vector2( 6.0, -40),  // flare begins
    new THREE.Vector2(11.0, -36),  // mid flare
    new THREE.Vector2(15.0, -32),  // upper flare
    new THREE.Vector2(16.0, -30),  // oblate head rim
  ];
  const plumeBody = new THREE.Mesh(
    new THREE.LatheGeometry(_plumeProfile, 64),
    _plumeMat
  );
  // Tilt axis to match disk normal; back-solve position so top rim (local 0,−30,0) lands at disk centre
  plumeBody.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-0.244, 0.848, -0.471)
  );
  plumeBody.position.set(-31.27, -9.95, -16.75);
  scene.add(plumeBody);
  chamberMeshes.push(plumeBody);

  // Flat disk closing the top face ~at the Moho (y≈−25.5 km)
  const plumeTop = new THREE.Mesh(
    new THREE.CircleGeometry(16, 64),
    _plumeMat
  );
  // Tilt to match slab dip: normal = upward face of 32°-NW-dipping plane
  // n = sin(32°)*dip_dir + cos(32°)*up = sin(32°)*(-0.460,0,-0.889) + cos(32°)*(0,1,0)
  //   = (-0.244, 0.848, -0.471)
  plumeTop.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),                // CircleGeometry default normal
    new THREE.Vector3(-0.244, 0.848, -0.471)   // slab upward normal (dip 32° to NW)
  );
  plumeTop.position.set(-23.95, -35.39, -2.62);
  scene.add(plumeTop);
  chamberMeshes.push(plumeTop);
}

// ─── Subsurface plumbing labels ───────────────────────────────────────────────
// Floating pill sprites anchored to each major plumbing element.
// Visible whenever the plumbing toggle is on; clipped to the camera-facing half
// during cross-section.

const PLUMBING_POIS = [
  // ── Magma chambers ──────────────────────────────────────────────────────────
  { name: 'Summit Chamber',        kicker: 'Shallow Magma Chamber',           theme: 'plumbing',
    meta: '~1–2 km depth  ·  T ≈ 1,150 °C',
    description: 'Shallow ellipsoidal reservoir directly beneath the summit crater complex at 1–2 km depth. Inferred from seismic tomography and SO₂ flux measurements. Acts as the immediate source for summit Strombolian and effusive activity — pressure cycles within this chamber drive Etna\'s short-period eruption patterns.',
    wx: -0.26, wy:  1.5, wz:  0.42,
  },
  { name: 'Prolate Conduit Zone',  kicker: 'Sub-summit Conduit',              theme: 'plumbing',
    meta: '~2–5 km depth  ·  T ≈ 1,130 °C',
    description: 'Narrow prolate magmatic body connecting the shallow summit chamber to the melt shell below. Inferred from velocity anomalies in local earthquake tomography (Patanè et al. 2006). The roughly cylindrical geometry constrains magma ascent rates to ~0.5–1 m/s during active recharge phases.',
    wx: -0.79, wy: -2.0, wz:  4.08, lx: -5,
  },
  { name: 'Melt Accumulation Zone', kicker: 'Shallow Melt Shell',             theme: 'plumbing',
    meta: '~4–6 km depth  ·  T ≈ 1,100 °C',
    description: 'Oblate accumulation zone at ~4–6 km depth where melt partially segregates before ascending to the summit. Interpreted as the source reservoir for some flank eruptions that tap it laterally via dyking. The oblate geometry reflects ponding at a density or rheological discontinuity in the crust.',
    wx: -1.14, wy: -5.0, wz:  5.31, lx:  5,
  },
  { name: 'Shallow Sill Complex',  kicker: 'Sill Network (5–8 km)',           theme: 'plumbing',
    meta: '~5–8 km depth  ·  42 sill bodies',
    description: 'Network of ~42 oblate magma bodies (sills) at 5–8 km depth feeding the melt shell and summit conduit from the NW and E flanks. Inferred from high-resolution seismic tomography and relocated microseismicity. The sills preferentially intrude along subhorizontal planes controlled by the layered crustal stratigraphy and the stress shadow of the edifice load.',
    wx: -4.0,  wy: -6.5, wz:  3.0,  lx:  6,
  },
  { name: 'Mid-Crustal Lens',      kicker: 'Intermediate Reservoir',          theme: 'plumbing',
    meta: '~8–13 km depth  ·  T ≈ 1,080 °C',
    description: 'Major intermediate-depth magma body at ~8–13 km. Inferred from P-wave velocity perturbations and GPS surface deformation modelling. Likely the primary source reservoir for most historical eruptions — volume change here drives the kilometre-scale geodetic signal seen by InSAR during eruption cycles.',
    wx: -8.67, wy:-10.0, wz:  2.34,
  },
  { name: 'Deep Storage Reservoir', kicker: 'Lower Crustal Reservoir',        theme: 'plumbing',
    meta: '~16–22 km depth  ·  T ≈ 1,050 °C',
    description: 'Large tilted ellipsoidal body at ~16–22 km in the lower crust, near the crust–mantle boundary. Geochemical evidence (Sr, Nd, Pb isotopes; CO₂/SO₂ ratios) points to magma storage near the Moho where primitive basaltic magma from the mantle plume accumulates and differentiates. The tilted axis reflects structural control by the STEP fault geometry.',
    wx:-20.73, wy:-18.0, wz: -2.40,
  },
  // ── Mantle plume ─────────────────────────────────────────────────────────────
  { name: 'Mantle Plume Head',     kicker: 'Moho Contact Disk',               theme: 'plumbing',
    meta: '~25.5 km depth  ·  Moho boundary  ·  Ø ~32 km',
    description: 'The ~32 km-diameter plume head at the Moho (~25.5 km depth), where ascending mantle-derived melt ponds beneath the lithosphere. The circular geometry reflects radial spreading of buoyant plume material against the base of the crust. Partial melt fraction here reaches 4–6%, directly feeding the deep storage reservoir above.',
    wx:-23.95, wy:-35.39, wz: -2.62,
  },
  { name: 'Mantle Plume Body',     kicker: 'Asthenospheric Upwelling',        theme: 'plumbing',
    meta: '~25.5–80 km depth  ·  32° NW tilt',
    description: 'The widening flare of the asthenospheric upwelling where the cylindrical stem transitions to the spreading head at the Moho. The ~32° NW tilt mirrors the dip of the subducting Ionian slab and the slab window geometry. Temperatures in the rising plume exceed 1,300 °C, driving partial melting at the Moho (~25.5 km).',
    wx:-22.49, wy:-40.5, wz:  0.21, lx: -8,
  },
  { name: 'Mantle Plume Stem',     kicker: 'Deep Mantle Conduit',             theme: 'plumbing',
    meta: '>40 km depth  ·  Ø ~4 km  ·  Vertical',
    description: 'Deep vertical conduit in the upper mantle (>40 km depth) feeding the asthenospheric upwelling. The ~4 km radius is consistent with geophysical and geodynamic models of Etna\'s mantle source. The absence of a subducting slab to the west (the slab window) allows this material to rise directly from depth without lateral deflection.',
    wx:-21.02, wy:-60.0, wz:  3.03,
  },
  // ── Slabs ────────────────────────────────────────────────────────────────────
  { name: 'Ionian Slab',           kicker: 'Subducting Oceanic Lithosphere',  theme: 'slab',
    meta: '~28–50 km depth  ·  NW dip ~56°  ·  Age ~270 Ma',
    description: 'The subducting Ionian oceanic lithosphere — the oldest and densest oceanic plate in the Mediterranean (~270 Ma). Dipping ~56° NW beneath the Calabrian arc, it drives the broader Calabro-Ionian subduction zone. Its western edge (the STEP fault) defines the boundary of the slab window through which Etna\'s mantle source rises.',
    wx: 42.5, wy:-39.0, wz:  3.64,
  },
  { name: 'Oceanic Crust',         kicker: 'Ionian Oceanic Crust (~7 km)',    theme: 'slab',
    meta: 'Atop Ionian slab  ·  Vp ≈ 6.5–7.0 km/s',
    description: 'The ~7 km-thick oceanic crust forming the top layer of the Ionian slab, composed of basaltic pillow lavas and gabbro. Dehydration of the basaltic crust during subduction releases fluids that flux the overlying mantle wedge — the primary driver of arc magmatism in the Calabrian arc further north.',
    wx: 36.7, wy:-35.1, wz:  3.64, lx: -6,
  },
  { name: 'STEP Fault',            kicker: 'Slab Tear Edge Propagator',       theme: 'fault',
    meta: 'Western slab boundary  ·  Asthenospheric upwelling pathway',
    description: 'The Subduction-Transform Edge Propagator — the lateral slab tear at the western boundary of the Ionian slab. As the Calabrian slab rolls back eastward, this tear propagates southward, creating a slab window. Sub-slab asthenospheric mantle flows around the slab edge and upwells through this window, driving Etna\'s strongly alkalic, OIB-like volcanism.',
    wx: 40.0, wy:-42.5, wz:  3.64, lx: -6,
  },
  { name: 'Sicilian Thrust Slab',  kicker: 'Hyblean Carbonate Platform',      theme: 'slab',
    meta: 'African foreland  ·  NW underthrusting  ·  Dip 32°',
    description: 'The African continental platform underthrusting the Apennine-Maghrebian thrust belt from the south. Composed of Hyblean carbonate platform limestones and early Miocene calcarenites, explaining its lighter colour. The thrust front influences the regional stress field and seismicity below Etna\'s southern flank.',
    wx:-10.0, wy:-19.0, wz: 38.0,
  },
];

function buildPlumbingLabels() {
  if (_plumbingLabelGroup) scene.remove(_plumbingLabelGroup);
  _plumbingLabelData.length        = 0;
  _plumbingLabelInteractives.length = 0;

  const group  = new THREE.Group();
  const hitGeo = new THREE.SphereGeometry(3.5, 10, 10);

  for (const poi of PLUMBING_POIS) {
    const anchor    = new THREE.Vector3(poi.wx, poi.wy, poi.wz);
    const spritePos = new THREE.Vector3(
      poi.wx + (poi.lx || 0),
      poi.wy + 4,
      poi.wz + (poi.lz || 0),
    );

    // Invisible hit sphere for click raycasting — sits at the 3D feature centre
    const hit = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: true, depthWrite: false }),
    );
    hit.position.copy(anchor);
    hit.userData.feature = poi;
    group.add(hit);
    _plumbingLabelInteractives.push(hit);

    // Pill sprite — depthTest: false so it shows through terrain
    const { texture, width, height } = makeLabelTexture(poi.name, poi.theme ?? 'plumbing');
    const spriteMat = new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity: 0.88,
      depthTest: false, depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(
      (width  / 200) * 0.85 * 10 * 1.5,
      (height / 200) * 0.85 * 10 * 1.5,
      1,
    );
    sprite.position.copy(spritePos);
    sprite.renderOrder = 15;
    sprite.userData.feature = poi;
    group.add(sprite);
    _plumbingLabelInteractives.push(sprite);

    _plumbingLabelData.push({ hit, sprite, anchor, poi });
  }

  group.visible = false;
  scene.add(group);
  _plumbingLabelGroup = group;
}

// Show/hide individual entries based on cross-section clip plane and plumbing-on state.
// Call from _setPlumbing() and updateClipPlanes() to keep visibility in sync.
function updatePlumbingLabelVisibility(plumbingOn) {
  if (!_plumbingLabelGroup) return;
  const on = plumbingOn ?? !!(sicilianThrustSlab?.visible);
  _plumbingLabelGroup.visible = on;
  if (!on) return;
  for (const entry of _plumbingLabelData) {
    const onVisibleSide = !crossSectionEnabled || !clipPlane ||
      clipPlane.distanceToPoint(entry.anchor) >= 0;
    entry.sprite.visible = onVisibleSide;
    entry.hit.visible    = onVisibleSide;
  }
}

// ─── Cross-section cap ────────────────────────────────────────────────────────
// Intersects the cross-section plane with every terrain triangle, then drops
// each intersection segment vertically to the domain bottom (Y=-80 km).
// Result: a cap face that exactly follows the terrain surface profile —
// connected to the terrain above, the domain sides, and the bottom face.
// Geometry is rebuilt in world-space on demand (debounced, not every frame).

// Colormaps + sampler3D uniform + chamber analytical checks injected into _CAP_FRAG.
// Physics are baked CPU-side into a 64×64×32 Data3DTexture (uPropTex) with
// topographic overburden + chamber thermal halos. Chamber INTERIORS are handled
// analytically in the shader so their precise boundaries are resolution-independent.
const _CAP_GLSL_GEO = `
  uniform float uColorMode;
  uniform float uTime;
  uniform sampler3D uPropTex;

  ${_SWIRL_GLSL}

  // ── Analytical geotherm (mirrors CPU _ptTemp exactly) ────────────────────
  float ptGeotherm(float d){
    if(d <= 0.0) return 15.0;
    float Tl = 15.0 + 25.0*d - 0.10*d*d;
    float Ta = 1215.0 + 0.5*max(0.0, d - 60.0);
    float w  = 1.0 / (1.0 + exp(-(d - 55.0)));
    return Tl*(1.0 - w) + Ta*w;
  }

  // ── Ionian slab geometry ──────────────────────────────────────────────────
  // Slab plane defined by vertices (50,−28)→(35,−50) in world XY.
  // Normal pointing toward mantle wedge: (−22, 15) / 26.63.
  // slabFraction: 0 = outside/surface, 1 = fully inside cold lithospheric core.
  float slabFraction(vec3 wp){
    if(wp.x < 22.0 || wp.y > -22.0) return 0.0;
    float sd = (-22.0*(wp.x - 50.0) + 15.0*(wp.y + 28.0)) / 26.63;
    return smoothstep(0.0, -8.0, sd);
  }

  // ── Mantle plume geometry ─────────────────────────────────────────────────
  // Stem: vertical cylinder r=2 km at (−21.02, 3.03) in XZ, y −80→−40.
  // Body: tilted flare, axis interpolates stem→head, radius 2→16 km at y −40→−25.
  float plumeFraction(vec3 wp){
    float w = 0.0;
    if(wp.y <= -38.0 && wp.y >= -82.0){
      float dr = length(vec2(wp.x + 21.02, wp.z - 3.03));
      w = max(w, smoothstep(3.5, 1.0, dr));
    }
    if(wp.y > -42.0 && wp.y < -25.0){
      float t    = clamp((wp.y + 42.0) / 17.0, 0.0, 1.0);
      vec2  axXZ = mix(vec2(-21.02, 3.03), vec2(-23.95, -2.62), t);
      float maxR = mix(2.0, 16.0, t);
      float dr   = length(vec2(wp.x, wp.z) - axXZ);
      w = max(w, smoothstep(maxR * 1.4, maxR * 0.5, dr));
    }
    return w;
  }

  // ── Full thermal field ────────────────────────────────────────────────────
  // Geotherm + slab cold anomaly + plume hot anomaly + 1/r chamber halos.
  float ptThermal(vec3 wp){
    float d = max(0.0, -wp.y);
    float T = ptGeotherm(d);

    // Ionian slab cold anomaly — old oceanic lithosphere suppresses isotherms ~300–400°C
    float sf = slabFraction(wp);
    if(sf > 0.0){
      float Tslab = 350.0 + 300.0*exp(-max(0.0, d - 25.0)/25.0); // 650°C shallow, 350°C deep
      T = mix(T, min(T, Tslab), sf);
    }

    // Mantle plume hot anomaly — rising asthenosphere 1280–1360°C in core
    float pf = plumeFraction(wp);
    if(pf > 0.0){
      float Tplume = 1340.0 + 0.4*max(0.0, d - 45.0);
      T = mix(T, max(T, Tplume), pf * 0.85);
    }

    // Summit chamber
    vec3 eSum = (wp - vec3(-0.26, 1.5, 0.42)) / vec3(0.5, 0.5, 0.5);
    float dSum = length(eSum);
    if(dSum < 1.0) return 1150.0;
    T += max(0.0, 1150.0 - ptGeotherm(0.0)) / dSum;

    // Prolate conduit
    vec3 ePro = (wp - vec3(-0.79, -2.0, 4.08)) / vec3(0.25, 1.0, 0.25);
    float dPro = length(ePro);
    if(dPro < 1.0) return 1130.0;
    T += max(0.0, 1130.0 - ptGeotherm(2.0)) / dPro;

    // Melt shell
    vec3 eMlt = (wp - vec3(-1.14, -5.0, 5.31)) / vec3(1.4, 0.7, 1.2);
    float dMlt = length(eMlt);
    if(dMlt < 1.0) return 1100.0;
    T += max(0.0, 1100.0 - ptGeotherm(5.0)) / dMlt;

    // Mid-crustal lens
    vec3 eMid = (wp - vec3(-8.67, -10.0, 2.34)) / vec3(3.0, 1.0, 3.0);
    float dMid = length(eMid);
    if(dMid < 1.0) return 1080.0;
    T += max(0.0, 1080.0 - ptGeotherm(10.0)) / dMid;

    // Deep storage: tilted 6×2×6 km ellipsoid — R^T applied before test
    vec3 e2w = wp - vec3(-20.73, -18.0, -2.40);
    vec3 e2l = vec3( 0.9679*e2w.x+0.2435*e2w.y-0.062 *e2w.z,
                    -0.2435*e2w.x+0.848 *e2w.y-0.4706*e2w.z,
                    -0.062 *e2w.x+0.4706*e2w.y+0.8801*e2w.z) / vec3(6.0,2.0,6.0);
    float dN2 = length(e2l);
    if(dN2 < 1.0) return 1050.0;
    T += max(0.0, 1050.0 - ptGeotherm(18.0)) / dN2;

    return min(T, 1350.0);
  }

  // Returns true if wp is inside any magma chamber; fills tMag with chamber temperature.
  bool inAnyChamber(vec3 wp, out float tMag){
    vec3 dSum = (wp - vec3(-0.26,  1.5,  0.42)) / vec3(0.5,  0.5,  0.5 );
    if(dot(dSum,dSum) < 1.0){ tMag=1150.0; return true; }
    vec3 dPro = (wp - vec3(-0.79, -2.0,  4.08)) / vec3(0.25, 1.0,  0.25);
    if(dot(dPro,dPro) < 1.0){ tMag=1130.0; return true; }
    vec3 dMlt = (wp - vec3(-1.14, -5.0,  5.31)) / vec3(1.4,  0.7,  1.2 );
    if(dot(dMlt,dMlt) < 1.0){ tMag=1100.0; return true; }
    vec3 dMid = (wp - vec3(-8.67,-10.0,  2.34)) / vec3(3.0,  1.0,  3.0 );
    if(dot(dMid,dMid) < 1.0){ tMag=1080.0; return true; }
    vec3 d2w = wp - vec3(-20.73,-18.0, -2.40);
    vec3 d2  = vec3( 0.9679*d2w.x+0.2435*d2w.y-0.062*d2w.z,
                    -0.2435*d2w.x+0.848 *d2w.y-0.4706*d2w.z,
                    -0.062 *d2w.x+0.4706*d2w.y+0.8801*d2w.z) / vec3(6.0,2.0,6.0);
    if(dot(d2,d2) < 1.0){ tMag=1050.0; return true; }
    tMag=0.0; return false;
  }

  // ── Colormaps ─────────────────────────────────────────────────────────────
  vec3 cmapTemp(float t){
    t=clamp(t,0.0,1.0);
    vec3 c0=vec3(0.03,0.06,0.18), c1=vec3(0.77,0.17,0.03), c2=vec3(1.00,0.87,0.00);
    return t<0.5?mix(c0,c1,t*2.0):mix(c1,c2,(t-0.5)*2.0);
  }
  vec3 cmapPressure(float t){
    t=clamp(t,0.0,1.0);
    vec3 c0=vec3(0.91,0.94,0.98), c1=vec3(0.23,0.44,0.75), c2=vec3(0.02,0.08,0.23);
    return t<0.5?mix(c0,c1,t*2.0):mix(c1,c2,(t-0.5)*2.0);
  }
  vec3 cmapDensity(float t){
    t=clamp(t,0.0,1.0);
    vec3 c0=vec3(0.83,0.72,0.59), c1=vec3(0.48,0.37,0.24), c2=vec3(0.11,0.17,0.12);
    return t<0.5?mix(c0,c1,t*2.0):mix(c1,c2,(t-0.5)*2.0);
  }
  vec3 cmapYoungs(float t){
    t=clamp(t,0.0,1.0);
    vec3 c0=vec3(0.86,0.96,0.90), c1=vec3(0.10,0.60,0.55), c2=vec3(0.04,0.13,0.28);
    return t<0.5?mix(c0,c1,t*2.0):mix(c1,c2,(t-0.5)*2.0);
  }
  vec3 cmapPoisson(float t){
    t=clamp(t,0.0,1.0);
    return mix(vec3(0.23,0.43,0.66),vec3(0.83,0.31,0.42),t);
  }
  vec3 cmapRegime(float T){
    vec3 brittle=vec3(1.00,0.42,0.42);
    vec3 bdz    =vec3(1.00,0.70,0.28);
    vec3 visco  =vec3(0.46,0.78,0.91);
    vec3 pmelt  =vec3(1.00,0.55,0.00);
    vec3 asthen =vec3(1.00,0.27,0.00);
    vec3 c=mix(brittle,bdz,  smoothstep(270.0,330.0,T));
         c=mix(c,      visco,smoothstep(520.0,580.0,T));
         c=mix(c,      pmelt,smoothstep(870.0,930.0,T));
         c=mix(c,      asthen,smoothstep(1070.0,1130.0,T));
    return c;
  }
`;

const _CAP_VERT = `
  #include <clipping_planes_pars_vertex>
  out vec3 vWorldPos;
  void main(){
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    #include <clipping_planes_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const _CAP_FRAG = `
  #include <clipping_planes_pars_fragment>
  in vec3 vWorldPos;
  out vec4 fragColor;
  ${_CAP_GLSL_NOISE}
  ${_CAP_GLSL_GEO}
  void main(){
    #include <clipping_planes_fragment>
    float y = vWorldPos.y;

    // ── Property-mode coloring (overrides geology shading when uColorMode > 0) ──
    int mode = int(uColorMode + 0.5);
    if(mode > 0){
      // T: full analytical field — geotherm + 1/r chamber superposition, exact at every fragment.
      float T = ptThermal(vWorldPos);

      // P: read from texture (topographic overburden baked in on CPU; lithostatic, chamber-independent).
      float u = clamp((vWorldPos.x + 50.0) / 100.0,       0.001, 0.999);
      float v = clamp(-y / 50.0,                           0.001, 0.999);
      float w = clamp((vWorldPos.z - 3.638 + 50.0)/100.0, 0.001, 0.999);
      float P = texture(uPropTex, vec3(u, v, w)).g * 1.5;

      // E, ν, φ, ρ: derived analytically from T and P.
      // Inside chambers: melt-state values override.
      float chTmag;
      bool isChamber = inAnyChamber(vWorldPos, chTmag);

      // Chamber interior: show convective swirl regardless of property mode.
      // The swirl colour communicates the spatial temperature heterogeneity
      // (bright = rising hot magma, dark = sinking denser melt).
      if(isChamber){
        vec3 norm;
        vec3 dSum = (vWorldPos - vec3(-0.26,  1.5,  0.42)) / vec3(0.5,  0.5,  0.5 );
        if(dot(dSum,dSum) < 1.0)    { norm = dSum; }
        else {
          vec3 dPro = (vWorldPos - vec3(-0.79, -2.0,  4.08)) / vec3(0.25, 1.0,  0.25);
          if(dot(dPro,dPro) < 1.0)  { norm = dPro; }
          else {
            vec3 dMlt = (vWorldPos - vec3(-1.14, -5.0,  5.31)) / vec3(1.4,  0.7,  1.2 );
            if(dot(dMlt,dMlt) < 1.0){ norm = dMlt; }
            else {
              vec3 dMid = (vWorldPos - vec3(-8.67,-10.0,  2.34)) / vec3(3.0,  1.0,  3.0 );
              if(dot(dMid,dMid) < 1.0){ norm = dMid; }
              else {
                vec3 dw = vWorldPos - vec3(-20.73,-18.0,-2.40);
                norm = vec3(0.9679*dw.x+0.2435*dw.y-0.062*dw.z,
                           -0.2435*dw.x+0.848*dw.y-0.4706*dw.z,
                           -0.062*dw.x+0.4706*dw.y+0.8801*dw.z) / vec3(6.0,2.0,6.0);
              }
            }
          }
        }
        fragColor = vec4(magmaSwirl(norm, 0.0, uTime), 1.0);
        return;
      }

      float d   = max(0.0, -y);
      float phi = clamp((T - (1100.0 + 15.0*P)) / 200.0, 0.0, 1.0) * 0.08;
      float Ec  = 40.0 + 45.0*(1.0 - exp(-P/0.3)) - 0.015*max(0.0, T - 15.0);
      float tp  = clamp(phi/0.04, 0.0, 1.0);
      float E   = max(2.0, Ec * (1.0 - (3.0*tp*tp - 2.0*tp*tp*tp)));
      float nu  = (0.18 + 0.10*(1.0 - exp(-P/0.3))) * (1.0 - tp) + 0.48*tp;
      float rho = 2900.0*(1.0 - 0.14*exp(-d/3.0))*(1.0 + P/70.0 - 3.0e-5*max(0.0,T-15.0)) - 250.0*phi;

      // Ionian oceanic lithosphere: rigid (E 150–180 GPa), dense (ρ ~3280 kg/m³), ν ~0.27
      float _psf = slabFraction(vWorldPos);
      if(_psf > 0.01){
        float Eslab   = 150.0 + 30.0*(1.0 - exp(-P/0.5));
        float rhoSlab = 3280.0*(1.0 + P/120.0) - 1.5*max(0.0, T - 15.0);
        E   = mix(E,   Eslab,   _psf);
        nu  = mix(nu,  0.27,    _psf);
        rho = mix(rho, rhoSlab, _psf);
      }

      vec3 c;
      if(mode==1){ c=cmapTemp(    clamp((T-15.0)/1215.0,    0.0,1.0)); }
      else if(mode==2){ c=cmapPressure(clamp(P/1.5,          0.0,1.0)); }
      else if(mode==3){ c=cmapDensity( clamp((rho-2400.0)/500.0,0.0,1.0)); }
      else if(mode==4){ c=cmapYoungs(  clamp((E-2.0)/62.0,  0.0,1.0)); }
      else if(mode==5){ c=cmapPoisson( clamp((nu-0.18)/0.30, 0.0,1.0)); }
      else             { c=cmapRegime(T); }
      fragColor=vec4(c,1.0);
      return;
    }

    // ── Geology mode: chamber check — swirl overrides litho pattern inside chambers ──
    {
      float chTmag;
      if(inAnyChamber(vWorldPos, chTmag)){
        vec3 norm;
        vec3 dSum = (vWorldPos - vec3(-0.26,  1.5,  0.42)) / vec3(0.5,  0.5,  0.5 );
        if(dot(dSum,dSum) < 1.0)    { norm = dSum; }
        else {
          vec3 dPro = (vWorldPos - vec3(-0.79, -2.0,  4.08)) / vec3(0.25, 1.0,  0.25);
          if(dot(dPro,dPro) < 1.0)  { norm = dPro; }
          else {
            vec3 dMlt = (vWorldPos - vec3(-1.14, -5.0,  5.31)) / vec3(1.4,  0.7,  1.2 );
            if(dot(dMlt,dMlt) < 1.0){ norm = dMlt; }
            else {
              vec3 dMid = (vWorldPos - vec3(-8.67,-10.0,  2.34)) / vec3(3.0,  1.0,  3.0 );
              if(dot(dMid,dMid) < 1.0){ norm = dMid; }
              else {
                vec3 dw = vWorldPos - vec3(-20.73,-18.0,-2.40);
                norm = vec3(0.9679*dw.x+0.2435*dw.y-0.062*dw.z,
                           -0.2435*dw.x+0.848*dw.y-0.4706*dw.z,
                           -0.062*dw.x+0.4706*dw.y+0.8801*dw.z) / vec3(6.0,2.0,6.0);
              }
            }
          }
        }
        fragColor = vec4(magmaSwirl(norm, 0.0, uTime), 1.0);
        return;
      }
    }

    // ── Zone 1: Upper crust (y > −10) — warm brown with fbm texture ──
    vec2 lp = vec2((vWorldPos.x + vWorldPos.z) * 0.035, y * 0.05 + 2.5);
    float lNoise = fbm(lp * 1.6);
    vec3 lithoBrown = vec3(0.478, 0.361, 0.220);
    vec3 lithoDark  = vec3(0.340, 0.250, 0.145);
    vec3 lithoColor = mix(lithoDark, lithoBrown, 0.45 + lNoise * 0.55);

    // ── Zone 2: Lower crust + cusp (−10 to −30) — mafic, denser ──
    vec2 lc_p = vec2(vWorldPos.x * 0.030, vWorldPos.z * 0.030 + y * 0.020);
    float lcNoise = fbm(lc_p * 1.8 + vec2(5.3, 2.1));
    vec3 lowerCrustColor = mix(vec3(0.36, 0.16, 0.07), vec3(0.48, 0.23, 0.09), lcNoise * 0.6 + 0.4);

    // ── Zone 3: Thinned lithospheric mantle (−30 to −60) — heated, melt-permeated ──
    vec2 um_p = vec2(vWorldPos.x * 0.028, vWorldPos.z * 0.028 + y * 0.018);
    float umNoise = fbm(um_p * 2.0 + vec2(3.1, 7.4));
    vec3 thinnedLithoColor = mix(vec3(0.52, 0.20, 0.06), vec3(0.72, 0.34, 0.10), umNoise * 0.7 + 0.3);
    float meltStreak = pow(max(ridged(um_p * 3.5 + vec2(1.7, 4.2)) - 0.30, 0.0) * 1.8, 2.0);
    thinnedLithoColor = mix(thinnedLithoColor, vec3(0.85, 0.40, 0.08), meltStreak * 0.35);

    // ── Zone 4: Asthenosphere (y < −60) — convective mantle pattern, darkened ──
    float depth = -(y + 60.0) / 10.0;  // 0 at LAB base, positive deeper
    vec2 p = vec2(vWorldPos.x, vWorldPos.z) * 0.030 + vec2(depth * 0.45, depth * 0.28);
    vec2 flow      = swirl(p * 1.5, 0.70);
    float bulk     = fbm(flow * 2.6 + vec2(2.2, 6.1));
    float ang      = atan(flow.y, flow.x);
    float plumeBands = pow(abs(sin(ang * 3.5 + fbm(flow * 3.1) * 5.5)), 3.5);
    float plumeHeads = pow(max(ridged(flow * 4.0) - 0.40, 0.0) * 2.5, 2.0);
    float coolDown   = smoothstep(0.50, 0.78, fbm(p * 3.2 + vec2(7.3, 1.9)));

    vec3 deep   = vec3(0.07, 0.02, 0.01);
    vec3 warm   = vec3(0.18, 0.05, 0.01);
    vec3 hot    = vec3(0.36, 0.11, 0.02);
    vec3 aHot   = vec3(0.52, 0.20, 0.04);
    vec3 bright = vec3(0.66, 0.32, 0.08);
    vec3 cool   = vec3(0.05, 0.01, 0.00);

    vec3 mantleColor = mix(deep, warm, bulk);
    mantleColor = mix(mantleColor, hot,   plumeBands * 0.30 + plumeHeads * 0.15);
    mantleColor = mix(mantleColor, aHot,  plumeHeads * 0.52);
    mantleColor = mix(mantleColor, bright, pow(plumeHeads, 2.0) * 0.22);
    mantleColor = mix(mantleColor, cool,   coolDown * 0.30);

    // ── Blend zones ──
    // Lower crust+cusp fades radially around the plume stem axis (−21.02, 3.03).
    float _plR2D    = length(vec2(vWorldPos.x + 21.02, vWorldPos.z - 3.03));
    float _lcFade   = exp(-(_plR2D * _plR2D) / (37.5 * 37.5));
    float tLowerCrust = smoothstep(-7.0, -13.0, y) * _lcFade;

    float tMoho = smoothstep(-22.5, -28.5, y);
    float tAST  = smoothstep(-58.0, -62.0, y);

    vec3 col = mix(lithoColor, lowerCrustColor, tLowerCrust);
    col = mix(col, thinnedLithoColor, tMoho);
    col = mix(col, mantleColor, tAST);

    // Moho glow at −25.5 km
    float mohoGlow = exp(-abs(y + 25.5) * 0.9) * 0.22;
    col += vec3(0.78, 0.42, 0.12) * mohoGlow;

    // LAB glow at −60 km
    float labGlow = exp(-abs(y + 60.0) * 0.50) * 0.50;
    col += vec3(0.92, 0.55, 0.12) * labGlow;

    // ── Mantle plume — follows actual 3D geometry (stem + tilted flare) ─────
    {
      float plFrac = plumeFraction(vWorldPos);
      if(plFrac > 0.0){
        vec3 plumeColor = clamp(mantleColor * 5.5, 0.0, 1.0);
        plumeColor = mix(plumeColor, vec3(1.00, 0.58, 0.06), 0.42);
        col = mix(col, plumeColor, plFrac * 0.88);
        col += vec3(0.82, 0.34, 0.02) * plFrac * 0.55;
      }
    }

    // ── Ionian slab — cold oceanic lithosphere (dark blue-grey) ─────────────
    {
      float _sfGeo = slabFraction(vWorldPos);
      if(_sfGeo > 0.01){
        vec2 slP = vec2(vWorldPos.x*0.045, vWorldPos.y*0.040);
        float slN = fbm(slP + vec2(8.4, 3.7));
        vec3 slabColor = mix(vec3(0.07,0.11,0.20), vec3(0.13,0.19,0.32), slN*0.6 + 0.2);
        // Thin oceanic-crust band brightens the slab face (< 9 km from surface)
        float sdRaw = (-22.0*(vWorldPos.x-50.0)+15.0*(vWorldPos.y+28.0))/26.63;
        float crustBand = smoothstep(-9.0, -2.0, sdRaw);
        slabColor = mix(slabColor, vec3(0.11,0.17,0.29), crustBand * 0.5);
        col = mix(col, slabColor, _sfGeo);
      }
    }

    fragColor = vec4(col, 1.0);
  }
`;

function _makeCapShaderMat(extra) {
  return new THREE.ShaderMaterial(Object.assign({
    vertexShader:   _CAP_VERT,
    fragmentShader: _CAP_FRAG,
    uniforms: {
      uColorMode: { value: 0.0 },
      uPropTex:   { value: _propTex },
      uTime:      { value: 0.0 },
    },
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    clipping: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }, extra));
}

function buildCrossSectionCap() {
  const capGeo = new THREE.BufferGeometry();
  crossSectionCap = new THREE.Mesh(capGeo, _makeCapShaderMat());
  crossSectionCap.visible = false;
  crossSectionCap.renderOrder = 6;  // above all slab tear overlays (max rO=5)
  scene.add(crossSectionCap);
  _domainFaceMeshes.push(crossSectionCap);
  _domainFaceMats.push(crossSectionCap.material);

  // Overdraw clone — shares geometry so it auto-updates with _rebuildCapGeometry.
  // Renders at rO=10 (transparent pass, after rings) to repaint cap face over
  // any hazard-ring bleed on the cross-section plane.
  const capOdMat = _makeCapShaderMat({ depthTest: true, depthWrite: false });
  crossSectionCapOverdraw = new THREE.Mesh(capGeo, capOdMat);
  crossSectionCapOverdraw.visible = false;
  crossSectionCapOverdraw.renderOrder = 10;
  scene.add(crossSectionCapOverdraw);
  _domainFaceMats.push(capOdMat);
}

function _rebuildCapGeometry() {
  if (!crossSectionCap || !_crossCapTerrainGeo || !crossSectionEnabled) return;

  const rad = (crossSectionAngle * Math.PI) / 180;
  const nx = -Math.sin(rad), nz = -Math.cos(rad);
  // Use the same summit-anchored offset as setCrossSectionAngle
  const planeD = -(nx * (-0.79) + nz * 4.08);
  const src = _crossCapTerrainGeo.attributes.position;
  const numTris = src.count / 3;
  const BOTTOM = -DOMAIN_H; // -50 km

  const verts = [];

  for (let t = 0; t < numTris; t++) {
    const b = t * 3;
    // Signed distance from cross-section plane (nx·x + nz·z + planeD = 0)
    const d0 = nx * src.getX(b)   + nz * src.getZ(b)   + planeD;
    const d1 = nx * src.getX(b+1) + nz * src.getZ(b+1) + planeD;
    const d2 = nx * src.getX(b+2) + nz * src.getZ(b+2) + planeD;

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

  function applyPlanes(obj, overridePlanes) {
    const p = overridePlanes ?? planes;
    if (!obj) return;
    if (obj.isGroup) { obj.children.forEach(c => applyPlanes(c, p)); return; }
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => { m.clippingPlanes = p; });
      } else {
        obj.material.clippingPlanes = p;
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
  if (domainLayerEdges) applyPlanes(domainLayerEdges);
  if (ionianSlab) applyPlanes(ionianSlab);
  if (ionianCrust) applyPlanes(ionianCrust);
  if (stepFault) applyPlanes(stepFault);
  if (sicilianThrustSlab) {
    const slabP = _hazardDomainPlanes
      ? (crossSectionEnabled ? [..._hazardDomainPlanes, clipPlane] : [..._hazardDomainPlanes])
      : planes;
    applyPlanes(sicilianThrustSlab, slabP);
    _slabTears.forEach(m => applyPlanes(m, slabP));
    // Heat-zone circles use additive blending — hide them in cross-section so they
    // can't bleed glow onto the cap face where no cap geometry covers them.
    const _plumbingOn = sicilianThrustSlab.visible;
    _slabHeatZoneMeshes.forEach(m => { m.visible = _plumbingOn && !crossSectionEnabled; });
  }
  // Apply the cross-section clip plane so chambers are halved in core view.
  // The camera-side 3D half remains visible; cap fills cover the cut face.
  chamberMeshes.forEach(m => applyPlanes(m));
  if (hvbMesh) applyPlanes(hvbMesh);
  {
    const faultPlanes = _hazardDomainPlanes
      ? (crossSectionEnabled ? [..._hazardDomainPlanes, clipPlane] : [..._hazardDomainPlanes])
      : planes;
    if (faultRootGroup)    applyPlanes(faultRootGroup,    faultPlanes);
    if (tectonicFaultRoot) applyPlanes(tectonicFaultRoot, faultPlanes);
    // Ghost surface traces: keep fully hidden (ghost effect removed — inactive half is dark).
    for (const m of _ghostSurfaceTraceMats) {
      m.clippingPlanes = faultPlanes;
      m.opacity = 0;
      m.needsUpdate = true;
    }
  }
  if (regionalGeologyMesh) applyPlanes(regionalGeologyMesh);
  if (etnaGeologyMesh)     applyPlanes(etnaGeologyMesh);
  if (seismicMesh)        applyPlanes(seismicMesh);

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
  updatePlumbingLabelVisibility();
}

// ─── Vertical exaggeration ────────────────────────────────────────────────────
// Scales all above-sea surface elements uniformly in Y around sea level (Y=0).
// Station markers and labels are updated individually so they track the surface.

function applyVertExag(factor) {
  _vertExag = factor;
  if (surfaceMesh)        surfaceMesh.scale.y        = factor;
  if (hazardOverlayMesh)  hazardOverlayMesh.scale.y  = factor;
  if (regionalGeologyMesh) regionalGeologyMesh.scale.y = factor;
  if (etnaGeologyMesh)     etnaGeologyMesh.scale.y     = factor;
  if (terrainSkirt) terrainSkirt.scale.y = factor;
  if (skirtOverdraw)    skirtOverdraw.scale.y  = factor;
  if (hazardGroup)      hazardGroup.scale.y     = factor;
  if (faultRootGroup)    faultRootGroup.scale.y    = factor;
  if (tectonicFaultRoot) tectonicFaultRoot.scale.y = factor;
  // Counter-scale ribbon group so bottom vertices stay at absolute depth
  if (_faultRibbonGroup) _faultRibbonGroup.scale.y = 1 / factor;
  // Bake new vert-exag into ribbon top vertex Y positions (bottom Y never changes)
  for (const { columns, geo } of _faultRibbonData) {
    const pos = geo.attributes.position;
    for (let i = 0; i < columns.length; i++) {
      pos.setY(i * 2, columns[i].top[1] * factor);
    }
    pos.needsUpdate = true;
  }
  // Rebuild face intersection lines to match updated ribbon geometry
  _buildFaultSideFaceLines();
  _updateFaultCapLines();
  labels.forEach(lbl => { if (lbl.origY !== undefined) lbl.pos.y = lbl.origY * factor; });
  if (etnaLabelLayer) applyEtnaLabelVertExag(etnaLabelLayer.entries, factor);
}

function setCrossSectionAngle(deg) {
  crossSectionAngle = deg;
  const rad = (deg * Math.PI) / 180;
  const nx  = -Math.sin(rad);
  const nz  = -Math.cos(rad);
  // Plane passes through Etna summit at world (x=-0.79, z=4.08)
  const d   = -(nx * (-0.79) + nz * 4.08);
  clipPlane.set(new THREE.Vector3(nx, 0, nz), d);
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
let _scDepthRow = null, _scDepth = null;
let _scDensityRow = null, _scDensity = null;
let _scYoungsRow = null, _scYoungs = null;
let _scPoissonRow = null, _scPoisson = null;
let _scRegimeRow = null, _scRegime = null, _scRegimeDesc = null;
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

// ─── Subsurface geophysical model (Etna) ─────────────────────────────────────
// d = depth in km below sea level (positive downward). Y scene coords → d = -y.

// Piecewise density column (kg/m³) matching Etna's basaltic/lithospheric stack.
const _SUB_DENSITY_SEGS = [
  [0,  5,  2500],   // young porous volcanic rock
  [5,  15, 2750],   // dense basaltic upper crust
  [15, 25.5, 2900],   // lower-crustal granulite/gabbro
  [25.5, 40, 3050],   // mafic lower crust / Moho transition
  [40, 50, 3280],   // upper-mantle peridotite
];

function _subTemp(d) {
  // Enhanced geothermal gradient (~120 mW/m² heat flux) for Etna's active system.
  if (d <= 0)  return 15;                        // surface ISA baseline
  if (d <= 15) return 15  + 40 * d;              // upper volcanic crust: ~40 °C/km
  if (d <= 40) return 615 + 24 * (d - 15);       // lower crust: ~24 °C/km
  return 1215 + 6  * (d - 40);                   // mantle adiabat: ~6 °C/km
}

function _subLithoP(d) {
  // Lithostatic pressure in GPa = integral of ρ(z)·g·dz, 0→d.
  let P = 0;
  for (const [top, bot, rho] of _SUB_DENSITY_SEGS) {
    if (d <= top) break;
    P += rho * 9.81 * (Math.min(d, bot) - top) * 1000; // Pa (h in m)
  }
  return P / 1e9; // → GPa
}

function _subDensity(d) {
  for (const [top, bot, rho] of _SUB_DENSITY_SEGS) {
    if (d <= bot) return rho;
  }
  return 3280;
}

function _subYoungsModulus(d, T) {
  // Undrained elastic modulus (GPa); temperature-softened.
  let E0;
  if      (d <=  5) E0 = 55;
  else if (d <= 15) E0 = 78;
  else if (d <= 30) E0 = 95;
  else if (d <= 40) E0 = 120;
  else              E0 = 165;
  return Math.max(E0 * 0.5, E0 - 0.012 * Math.max(0, T - 20));
}

function _subPoisson(d) {
  // Vp/Vs-derived Poisson's ratio.
  if (d <= 15) return +(0.250 + 0.002  * d           ).toFixed(3);
  if (d <= 40) return +(0.270 + 0.0008 * (d - 15)    ).toFixed(3);
  return 0.290;
}

const _REGIME_DEFS = [
  [ 350, 'Brittle',          '#ff6b6b', 'Elastic–brittle; seismogenic zone'        ],
  [ 600, 'Brittle–Ductile',  '#ffb347', 'Mixed mode; fault creep begins'           ],
  [1000, 'Viscoelastic',     '#76c8e8', 'Ductile flow; creep-dominated deformation'],
  [1200, 'Partial Melt',     '#ff8c00', 'Viscoelastic + partial melt; LAB zone'    ],
  [Infinity, 'Asthenosphere','#ff4500', 'Convective mantle; plastic flow'          ],
];

function _subRegime(T) {
  for (const [thresh, label, color, desc] of _REGIME_DEFS) {
    if (T < thresh) return { label, color, desc };
  }
}

// Meshes that trigger the subsurface reader on hover (domain walls + cap).
const _domainFaceMeshes = [];
// Materials for all domain face meshes — updated together when property mode changes.
const _domainFaceMats = [];
function _setSubColorMode(mode) {
  _domainFaceMats.forEach(mat => { mat.uniforms.uColorMode.value = mode; });
}
// Consecutive frames without a domain-face hit before we clear the subsurface rows.
// Prevents flicker when the raycaster briefly misses on mesh edges.
let _subMissFrames = 0;
const _SUB_MISS_HOLD = 12;

// Returns true when cross-section is active and pt is on the clipped (hidden) side.
// Three.js clipping planes don't affect raycasting, so every hit consumer must call this.
// Epsilon of 0.08 (≈80 m) prevents false rejections of cap-face hits whose points land
// exactly on the plane — floating-point precision otherwise flips the sign frame-to-frame.
function _isClipped(pt) {
  return crossSectionEnabled && clipPlane != null && clipPlane.distanceToPoint(pt) < -0.08;
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
  let hitIsTerrain = false;
  if (_mouseActive && surfaceMesh && surfaceMesh.visible) {
    const hits = raycaster.intersectObject(surfaceMesh);
    if (hits.length > 0 && !_isClipped(hits[0].point)) {
      hitPoint = hits[0].point;
      hitIsTerrain = true;
    }
  }

  // Fall back to domain face hit for cursor readout when terrain not hit.
  // Also covers core-view (cross-section) where the terrain is clipped away.
  if (!hitPoint && _mouseActive && _domainFaceMeshes.length) {
    const visF = _domainFaceMeshes.filter(m => m.visible);
    if (visF.length) {
      const dh = raycaster.intersectObjects(visF, false);
      // Iterate (not just [0]) — hidden-side walls are geometrically hit first
      // but rejected by _isClipped; the cap or visible-side wall follows.
      const vh = dh.find(h => !_isClipped(h.point));
      if (vh) hitPoint = vh.point;
    }
  }

  // ── Cursor readout: lat / lon / elevation or depth ──────────────────────────
  if (_cursorReadout) {
    if (hitPoint) {
      const lon = SAT_LON_W + (hitPoint.x + 50) / 100 * (SAT_LON_E - SAT_LON_W);
      const lat = SAT_LAT_N - (hitPoint.z - GEO_Z_OFFSET + 50) / 100 * (SAT_LAT_N - SAT_LAT_S);
      if (hitIsTerrain) {
        const elevM = hitPoint.y * 1000;
        const elevSign = elevM >= 0 ? '+' : '';
        const elevCol  = elevM >= 0 ? '#a8d4a0' : '#7ab2e8';
        _cursorReadout.hidden = false;
        _cursorReadout.innerHTML =
          `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E &nbsp;|&nbsp; ` +
          `<span style="color:${elevCol}">${elevSign}${Math.round(elevM)} m</span>`;
      } else {
        const depthKm = Math.max(0, -hitPoint.y);
        _cursorReadout.hidden = false;
        _cursorReadout.innerHTML =
          `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E &nbsp;|&nbsp; ` +
          `<span style="color:#7ab2e8">−${depthKm.toFixed(1)} km</span>`;
      }
    } else {
      _cursorReadout.hidden = true;
    }
  }

  // ── Surface conditions: ISA temp + pressure at cursor elevation ─────────────
  // Only fires on terrain hits; domain-face hits are handled by the subsurface block.
  if (_scTemp && _scPressure && hitIsTerrain) {
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
  } else if (!hitPoint && _scTemp && _scPressure) {
    _scTemp.textContent = '—';
    _scPressure.textContent = '—';
    if (_scContext) _scContext.textContent = 'ATMOS. EST.';
  }

  // ── Subsurface conditions: geophysical model when hovering domain faces ──────
  // Active when a domain face (not terrain surface) is under the cursor.
  // hitPoint is already set by the domain-face pre-check above; reuse it directly
  // to avoid a redundant raycast and so the clipped-hit iteration is consistent.
  // _subMissFrames debounces so brief raycaster misses on mesh edges don't flicker.
  {
    let freshHit = false;
    if (!hitIsTerrain && hitPoint && _mouseActive) {
      freshHit = true;
      _subMissFrames = 0;
      const pt = hitPoint;
      // Full 3D physics: topographic overburden + chamber thermal superposition
      const props  = _ptPropsAtPoint(pt.x, pt.y, pt.z);
      const regime = _subRegime(props.T);
      if (_scTemp)     _scTemp.textContent     = props.inChamber ? `${Math.round(props.T)} °C  ·  MAGMA` : `${Math.round(props.T)} °C`;
      if (_scPressure) _scPressure.textContent = `${props.P.toFixed(2)} GPa`;
      if (_scContext)  _scContext.textContent  = props.inChamber ? 'CHAMBER INTERIOR' : 'SUBSURFACE MODEL';
      if (_scDepthRow)   { _scDepthRow.style.display   = 'flex'; if (_scDepth)   _scDepth.textContent   = `${props.dEff.toFixed(1)} km`; }
      if (_scDensityRow) { _scDensityRow.style.display = 'flex'; if (_scDensity) _scDensity.textContent = `${props.rho} kg/m³`; }
      if (_scYoungsRow)  { _scYoungsRow.style.display  = 'flex'; if (_scYoungs)  _scYoungs.textContent  = `${props.E.toFixed(1)} GPa`; }
      if (_scPoissonRow) { _scPoissonRow.style.display = 'flex'; if (_scPoisson) _scPoisson.textContent = props.nu.toFixed(3); }
      if (_scRegimeRow) {
        _scRegimeRow.style.display = 'flex';
        if (_scRegime)     { _scRegime.textContent = regime.label; _scRegime.style.color = regime.color; }
        if (_scRegimeDesc)   _scRegimeDesc.textContent = regime.desc;
      }
    }
    if (!freshHit) {
      _subMissFrames++;
    }
    // Only clear the display after _SUB_MISS_HOLD consecutive frames without a hit.
    // This holds the last valid reading through brief raycaster misses at mesh edges.
    if (!freshHit && _subMissFrames >= _SUB_MISS_HOLD) {
      if (_scDepthRow)   _scDepthRow.style.display   = 'none';
      if (_scDensityRow) _scDensityRow.style.display = 'none';
      if (_scYoungsRow)  _scYoungsRow.style.display  = 'none';
      if (_scPoissonRow) _scPoissonRow.style.display = 'none';
      if (_scRegimeRow)  _scRegimeRow.style.display  = 'none';
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
    if (hazardHits.length > 0 && !_isClipped(hazardHits[0].point)) renderer.domElement.style.cursor = 'pointer';
  }

  // Geology overlay hover cursor — show pointer when mousing over terrain with geology visible.
  // Full per-polygon PIP is deferred to click; here we just signal "clickable terrain".
  if (!measureMode && _mouseActive && (_ingvGeoFeats || _egdiGeoFeats) &&
      (etnaGeologyMesh?.visible || regionalGeologyMesh?.visible) &&
      surfaceMesh && surfaceMesh.visible) {
    const hits = raycaster.intersectObject(surfaceMesh);
    if (hits.length > 0 && !_isClipped(hits[0].point)) renderer.domElement.style.cursor = 'pointer';
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

  // ── Section expand / scroll helper ─────────────────────────────────────────
  // Syncs a <details> section's open state to a master toggle and, when opening,
  // scrolls the section to the centre of the nav panel.
  const _navScroll = document.getElementById('ui-scroll-body');
  function _syncSection(sectionId, checked) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.open = checked;
    if (checked && _navScroll) {
      const sTop    = section.offsetTop - _navScroll.offsetTop;
      const sHeight = section.offsetHeight;
      const target  = sTop - (_navScroll.clientHeight - sHeight) / 2;
      _navScroll.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }

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
  _scDepthRow    = document.getElementById('sc-depth-row');
  _scDepth       = document.getElementById('sc-depth');
  _scDensityRow  = document.getElementById('sc-density-row');
  _scDensity     = document.getElementById('sc-density');
  _scYoungsRow   = document.getElementById('sc-youngs-row');
  _scYoungs      = document.getElementById('sc-youngs');
  _scPoissonRow  = document.getElementById('sc-poisson-row');
  _scPoisson     = document.getElementById('sc-poisson');
  _scRegimeRow   = document.getElementById('sc-regime-row');
  _scRegime      = document.getElementById('sc-regime');
  _scRegimeDesc  = document.getElementById('sc-regime-desc');
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
      _syncSection('cross-section-section', crossToggle.checked);
      crossSectionEnabled = crossToggle.checked;
      if (!crossSectionEnabled) _setCoreSelection(null);
      if (!clipPlane) {
        clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
        setCrossSectionAngle(crossSectionAngle);
      }
      if (crossControls) crossControls.style.display = crossSectionEnabled ? '' : 'none';
      updateClipPlanes();
      updateCrossSectionCap();
      _updateFaultCapLines();
      _updateDomainLayerLabels();
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
      updateCrossSectionCap();
      _updateFaultCapLines();
      _updateDomainLayerLabels();
    });
  }

  // Core view layer-labels toggle
  const coreLabelsToggle = document.getElementById('core-labels-toggle');
  if (coreLabelsToggle) {
    coreLabelsToggle.addEventListener('change', () => {
      _coreLabelsEnabled = coreLabelsToggle.checked;
      _updateDomainLayerLabels();
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

  // ── Deep Structure — domain walls & stratigraphy sub-toggle ─────────────────
  function _setDomainWalls(on) {
    if (domainBox)        domainBox.visible        = on;
    if (domainOverdraw)   domainOverdraw.visible   = on;
    if (domainEdges)      domainEdges.visible      = on;
    if (domainLayerEdges) domainLayerEdges.visible  = on;
    if (domainToggle)     domainToggle.checked      = on;
    const dwt = document.getElementById('domain-walls-toggle');
    if (dwt) dwt.checked = on;
  }

  const domainWallsToggle = document.getElementById('domain-walls-toggle');
  if (domainWallsToggle) {
    domainWallsToggle.addEventListener('change', () => _setDomainWalls(domainWallsToggle.checked));
  }

  // ── Deep Structure — slabs / plume / chambers sub-toggle ─────────────────────
  function _setPlumbing(on) {
    if (ionianSlab)         ionianSlab.visible        = on;
    if (ionianCrust)        ionianCrust.visible       = on;
    if (sicilianThrustSlab) sicilianThrustSlab.visible = on;
    _slabTears.forEach(m => { m.visible = on; });
    _slabHeatZoneMeshes.forEach(m => { m.visible = on && !crossSectionEnabled; });
    chamberMeshes.forEach(m => { m.visible = on; });
    updatePlumbingLabelVisibility(on);
    const pt = document.getElementById('plumbing-toggle');
    if (pt) pt.checked = on;
  }

  const plumbingToggle = document.getElementById('plumbing-toggle');
  if (plumbingToggle) {
    plumbingToggle.addEventListener('change', () => _setPlumbing(plumbingToggle.checked));
  }

  const plumbingLabelsToggle = document.getElementById('plumbing-labels-toggle');
  if (plumbingLabelsToggle) {
    plumbingLabelsToggle.addEventListener('change', () => {
      if (_plumbingLabelGroup) _plumbingLabelGroup.visible = plumbingLabelsToggle.checked;
      if (plumbingLabelsToggle.checked) updatePlumbingLabelVisibility();
    });
  }

  // ── Deep Structure master toggle — cascades to both sub-toggles ──────────────
  const deepStructureMaster = document.getElementById('deep-structure-master-toggle');
  if (deepStructureMaster) {
    deepStructureMaster.addEventListener('change', () => {
      const on = deepStructureMaster.checked;
      _setDomainWalls(on);
      _setPlumbing(on);
      if (plumbingLabelsToggle) plumbingLabelsToggle.checked = on;
      if (_plumbingLabelGroup) _plumbingLabelGroup.visible = on;
      if (on) updatePlumbingLabelVisibility();
      _syncSection('deep-structure-section', on);
    });
  }

  // ── Subsurface property visualisation (Deep Structure section) ──────────────
  document.querySelectorAll('input[name="sub-prop-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const mode = parseInt(radio.value, 10);
      _setSubColorMode(mode);
      const rl = document.getElementById('regime-legend');
      if (rl) rl.style.display = mode === 6 ? 'grid' : 'none';
    });
  });
  // Sync initial state with checked radio (value="0" → geology texture)
  const _initPropRadio = document.querySelector('input[name="sub-prop-mode"]:checked');
  if (_initPropRadio) _setSubColorMode(parseInt(_initPropRadio.value, 10));

  // ── Seismicity controls ──────────────────────────────────────────────────────
  const seismicMaster = document.getElementById('seismicity-master-toggle');
  if (seismicMaster) {
    seismicMaster.addEventListener('change', () => {
      _syncSection('seismicity-section', seismicMaster.checked);
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
  const faultMaster    = document.getElementById('faults-master-toggle');
  const etnaFaultsMaster = document.getElementById('etna-faults-master-toggle');

  function getFaultGroup(id) {
    if (!faultRootGroup) return null;
    return faultRootGroup.children.find(g => g.name === `fault-${id}`) ?? null;
  }

  function _setEtnaFaults(on) {
    if (etnaFaultsMaster) etnaFaultsMaster.checked = on;
    FAULT_IDS.forEach(id => {
      const sub = document.getElementById(`fault-${id.toLowerCase()}-toggle`);
      if (sub) sub.checked = on;
      const g = getFaultGroup(id);
      if (g) g.visible = on;
    });
  }

  // Individual INGV fault toggles
  FAULT_IDS.forEach(id => {
    const el = document.getElementById(`fault-${id.toLowerCase()}-toggle`);
    if (!el) return;
    el.addEventListener('change', () => {
      const g = getFaultGroup(id);
      if (g) g.visible = el.checked;
    });
  });

  // Etna Faults sub-group master
  if (etnaFaultsMaster) {
    etnaFaultsMaster.addEventListener('change', () => {
      _setEtnaFaults(etnaFaultsMaster.checked);
    });
  }

  const tectonicTog = document.getElementById('tectonic-faults-toggle');
  const TECTONIC_SUB_IDS = ['thrust-front', 'subduction', 'malta', 'tindari', 'scicli'];

  function getTectonicSubGroup(key) {
    return tectonicFaultRoot?.children.find(g => g.name === `tectonic-${key}`) ?? null;
  }

  if (faultMaster) {
    faultMaster.addEventListener('change', () => {
      _syncSection('surface-faults-section', faultMaster.checked);
      const on = faultMaster.checked;
      // Show/hide the root group itself first
      if (faultRootGroup) faultRootGroup.visible = on;
      // Cascade to Etna Faults sub-group
      _setEtnaFaults(on);
      // Cascade to regional tectonic faults and each sub-group
      if (tectonicTog) tectonicTog.checked = on;
      if (tectonicFaultRoot) tectonicFaultRoot.visible = on;
      TECTONIC_SUB_IDS.forEach(key => {
        const sub = document.getElementById(`tectonic-${key}-toggle`);
        if (sub) sub.checked = on;
        const g = getTectonicSubGroup(key);
        if (g) g.visible = on;
      });
    });
  }

  // Regional tectonic master toggle — cascades to all sub-groups
  if (tectonicTog) {
    tectonicTog.addEventListener('change', () => {
      const on = tectonicTog.checked;
      if (tectonicFaultRoot) tectonicFaultRoot.visible = on;
      TECTONIC_SUB_IDS.forEach(key => {
        const sub = document.getElementById(`tectonic-${key}-toggle`);
        if (sub) sub.checked = on;
        const g = getTectonicSubGroup(key);
        if (g) g.visible = on;
      });
    });
  }

  // Individual regional lineament toggles
  TECTONIC_SUB_IDS.forEach(key => {
    const el = document.getElementById(`tectonic-${key}-toggle`);
    if (!el) return;
    el.addEventListener('change', () => {
      const g = getTectonicSubGroup(key);
      if (g) g.visible = el.checked;
    });
  });

  // ── Geology overlay controls ─────────────────────────────────────────────────
  const geologyMaster    = document.getElementById('geology-master-toggle');
  const etnaGeoMaster    = document.getElementById('etna-geology-master-toggle');
  const regionalGeoMaster = document.getElementById('regional-geology-master-toggle');
  const geologyOpacity   = document.getElementById('geology-opacity');
  function _syncGeoVisibility() {
    const masterOn    = geologyMaster?.checked !== false;
    const etnaOn      = etnaGeoMaster?.checked !== false;
    const regionalOn  = regionalGeoMaster?.checked !== false;
    if (etnaGeologyMesh)     etnaGeologyMesh.visible     = masterOn && etnaOn;
    if (regionalGeologyMesh) regionalGeologyMesh.visible = masterOn && regionalOn;
  }

  if (geologyMaster)      geologyMaster.addEventListener('change', () => { _syncSection('geology-section', geologyMaster.checked); _syncGeoVisibility(); });
  if (etnaGeoMaster)      etnaGeoMaster.addEventListener('change', _syncGeoVisibility);
  if (regionalGeoMaster)  regionalGeoMaster.addEventListener('change', _syncGeoVisibility);
  if (geologyOpacity) {
    geologyOpacity.addEventListener('input', () => {
      const v = parseFloat(geologyOpacity.value);
      if (etnaGeologyMesh)     etnaGeologyMesh.material.opacity     = v;
      if (regionalGeologyMesh) regionalGeologyMesh.material.opacity = v;
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
      _syncSection('stations-section', stationsMaster.checked);
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
  ['settlement', 'fault', 'vent', 'fissure', 'general', 'hydro'].forEach(theme => {
    const el = document.getElementById(`label-${theme}-toggle`);
    if (el) el.addEventListener('change', () => { categoryEnabled[theme] = el.checked; });
  });
  const locationsMasterToggle = document.getElementById('locations-master-toggle');
  if (locationsMasterToggle) {
    locationsMasterToggle.addEventListener('change', () => {
      const on = locationsMasterToggle.checked;
      ['settlement', 'fault', 'vent', 'fissure', 'general', 'hydro'].forEach(theme => {
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
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === 'Escape') {
      // Priority: help overlay → scene popup → measure mode
      if (helpOverlay && !helpOverlay.hidden) { helpOverlay.hidden = true; return; }
      if (activePopupFeature || document.getElementById('scene-popup')?.hasAttribute('hidden') === false) {
        hideFeaturePopup(); return;
      }
      if (measureMode || measurePoints.length) { _setMeasureMode(''); return; }
    }

    if (e.code === 'Space' && !inInput) {
      e.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      spinEnabled = !spinEnabled;
      if (controls) controls.autoRotate = spinEnabled;
      const spinBtn = document.getElementById('spin-toggle');
      if (spinBtn) spinBtn.classList.toggle('is-active', spinEnabled);
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
  const LOD_LABELS    = ['', 'Landmarks only', 'Key features', 'Major features', 'Detailed', 'All features'];
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

  function _renderSearchResults(results, idx = -1) {
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

  function _refreshSearch(preserveIndex = false, showAll = false) {
    const q = (featureSearch?.value || '').trim().toLowerCase();
    if (!q && !showAll) {
      if (featureSearchRes) { featureSearchRes.hidden = true; featureSearchRes.innerHTML = ''; }
      _activeSearchResults = []; _activeSearchIndex = -1; return;
    }
    const results = q
      ? _searchPool.filter(c => c.name.toLowerCase().includes(q))
      : _searchPool.slice().sort((a, b) => a.name.localeCompare(b.name));
    const idx = preserveIndex ? Math.min(_activeSearchIndex, results.length - 1) : -1;
    _renderSearchResults(results, idx);
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
    featureSearch.addEventListener('focus',  () => _refreshSearch(false, true));
    featureSearch.addEventListener('keydown', (e) => {
      const n = _activeSearchResults.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _activeSearchIndex = n ? (_activeSearchIndex < 0 ? 0 : (_activeSearchIndex + 1) % n) : 0;
        _syncSearchHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _activeSearchIndex = n ? (_activeSearchIndex <= 0 ? n - 1 : _activeSearchIndex - 1) : 0;
        _syncSearchHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = _activeSearchIndex >= 0 ? _activeSearchResults[_activeSearchIndex] : _activeSearchResults[0];
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
    hazardsToggle.addEventListener('change', () => {
      _syncSection('hazards-section', hazardsToggle.checked);
      _applyHazardToggle(hazardsToggle.checked);
    });
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

  // ── Tour mode ──────────────────────────────────────────────────────────────
  const tourFacetSel = document.getElementById('tour-mode-facet');
  const tourToggle   = document.getElementById('tour-mode-toggle');
  const tourPrev     = document.getElementById('tour-mode-prev');
  const tourNext     = document.getElementById('tour-mode-next');
  const tourTarget   = document.getElementById('tour-mode-target');

  // Populate facet dropdown
  if (tourFacetSel && tourFacetSel.options.length === 0) {
    for (const facet of TOUR_MODE_FACETS) {
      const opt = document.createElement('option');
      opt.value = facet.id;
      opt.textContent = facet.label;
      tourFacetSel.appendChild(opt);
    }
  }

  if (tourToggle) {
    tourToggle.addEventListener('change', () => {
      if (tourToggle.checked) {
        const first = _getTourFeatures()[0];
        if (first) _presentTourStop(first);
        else _syncTourControls(null);
      } else {
        _deactivateTour();
      }
    });
  }

  if (tourFacetSel) {
    tourFacetSel.addEventListener('change', () => {
      activeTourModeFacetId = tourFacetSel.value;
      const first = _getTourFeatures()[0];
      if (activeTourModeFeature && first) _presentTourStop(first);
      else _syncTourControls(null);
    });
  }

  if (tourTarget) {
    tourTarget.addEventListener('change', () => {
      const feature = _getTourFeatures().find(f => f.name === tourTarget.value);
      if (feature) _presentTourStop(feature);
    });
  }

  if (tourPrev) tourPrev.addEventListener('click', () => _cycleTour(-1));
  if (tourNext) tourNext.addEventListener('click', () => _cycleTour(1));

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

  // Advance animation time for all convection swirl shaders
  const _t = performance.now() / 1000;
  for (const m of _chamberMats) m.uniforms.uTime.value = _t;
  for (const m of _domainFaceMats) m.uniforms.uTime.value = _t;

  if (hazardOverlayMesh && hazardOverlayMesh.visible && hazardOverlayMesh.material.uniforms) {
    hazardOverlayMesh.material.uniforms.uCameraY.value = camera.position.y;
  }

  // Cull side-face fault lines to the face(s) visible from the camera.
  // Hysteresis band of ±1 km prevents flickering when OrbitControls damping
  // oscillates the camera near a face boundary (typical jitter << 0.01 km).
  if (_faultSideLineGroup) {
    for (const ls of _faultSideLineGroup.children) {
      const p = ls.userData.domainPlane;
      if (!p) continue;
      const d = p.distanceToPoint(camera.position);
      if (d < -1.0) ls.visible = true;       // clearly outside → show
      else if (d > 1.0) ls.visible = false;  // clearly inside → hide
      // |d| <= 1 km: keep current state (hysteresis dead band)
    }
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

  // ── Core label pulse — verbatim Mars selectedLabelEntryIsCore block ───────
  if (_selectedCoreEntry && _coreSelectionRing && crossSectionEnabled && _coreLabelsEnabled) {
    const entryDot = _selectedCoreEntry.dot;
    if (!_selectedCoreEntry._pulseBase) {
      _selectedCoreEntry._pulseBase = {
        spriteColor:   _selectedCoreEntry.sprite?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
        spriteOpacity: _selectedCoreEntry.sprite?.material?.opacity ?? 0.88,
        dotColor:      _selectedCoreEntry.dot?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
        lineOpacity:   _selectedCoreEntry.line?.material?.opacity ?? 0.45,
      };
    }
    const pulse = (Math.sin(performance.now() * 0.004) + 1) * 0.5;
    _coreSelectionRing.visible = true;
    _coreSelectionRing.position.copy(entryDot.position);
    _coreSelectionRing.material.opacity = 0.35 + pulse * 0.55;
    _coreSelectionRing.scale.setScalar((1.2 + pulse * 0.6) * 10); // ×10: Mars units → Etna km
    if (_selectedCoreEntry.sprite?.material) {
      _selectedCoreEntry.sprite.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
      _selectedCoreEntry.sprite.material.opacity = 0.78 + pulse * 0.22;
    }
    if (_selectedCoreEntry.dot?.material) {
      _selectedCoreEntry.dot.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
    }
    if (_selectedCoreEntry.line?.material) {
      _selectedCoreEntry.line.material.opacity = 0.42 + pulse * 0.4;
    }
  } else {
    if (_coreSelectionRing) _coreSelectionRing.visible = false;
  }

  // ── Fault plane perimeter pulse ────────────────────────────────────────────
  if (_faultPerimeterLine) {
    const pulse = (Math.sin(performance.now() * 0.003) + 1) * 0.5;
    _faultPerimeterLine.material.opacity = 0.35 + pulse * 0.65;
  }

  // ── Seismic selection ring (screen-space DOM, constant apparent size) ────
  {
    const ringEl = _seismicRingEl();
    if (ringEl) {
      if (_seismicSelectionIdx >= 0 && _seismicEvents) {
        const ev = _seismicEvents[_seismicSelectionIdx];
        if (ev) {
          const [x, z, y3d, ml] = ev;
          const r = _seismicRadius(ml);
          // Project 3D → screen
          const wp = new THREE.Vector3(x, y3d, z).project(camera);
          const cw = renderer.domElement.clientWidth;
          const ch = renderer.domElement.clientHeight;
          const sx = (wp.x *  0.5 + 0.5) * cw;
          const sy = (wp.y * -0.5 + 0.5) * ch;
          // Compute sphere screen radius in pixels
          const dist = camera.position.distanceTo(new THREE.Vector3(x, y3d, z));
          const unitsPerPx = (2 * Math.tan(camera.fov * Math.PI / 360) * dist) / ch;
          const spherePx = r / unitsPerPx;
          // Ring scales proportionally — always ~35% larger radius than the sphere.
          // No fixed px offset so the ring stays tight at all zoom levels.
          const diam = Math.max(8, spherePx * 2.7);
          ringEl.style.left   = `${sx}px`;
          ringEl.style.top    = `${sy}px`;
          ringEl.style.width  = `${diam}px`;
          ringEl.style.height = `${diam}px`;
          ringEl.hidden = false;
        }
      } else {
        ringEl.hidden = true;
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

  const depthBand = depthKm < 5 ? 'Shallow crustal' : depthKm < 15 ? 'Mid crustal' : depthKm < 25.5 ? 'Deep crustal' : 'Sub-crustal';
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

// Description lookup for common INGV EtnaGeoMap non-lava unit names
const _INGV_UNIT_DESC = {
  // ── INGV EtnaGeoMap WMS formations (Branca et al. 2011) ──────────────────
  // Listed youngest → oldest; descriptions lead with lithology then age/context.
  'Torre del Filosofo Formation':
    'Olivine-phyric trachybasalt to basaltic trachyandesite; both aa and block lava facies. The most recently erupted lavas on the summit cone and upper flanks, including the major historical eruptions of 1991–93, 2001, and 2002–03.',
  'Pietracannone Formation':
    'Olivine–clinopyroxene trachybasalt lava flows from lower-flank fissure vents. Erupted during the historical period ca. 1600–1900 AD; the 1669 eruption — among the most destructive in Etna\'s recorded history — belongs to this formation.',
  'Portella Giumenta formation':
    'Dense, massive trachybasalt lava flows from Etna\'s peripheral vent system. Prehistoric age; outcrops concentrated on the middle and upper southern flank.',
  'Piano Provenzana Formation':
    'Trachybasalt lavas associated with the Ellittico caldera-forming phase (~15–18 ka). Dense, well-jointed flows dominating the northern flank between 1,800 and 2,200 m a.s.l.',
  'Pizzi Deneri Formation':
    'Scoriaceous spatter and lapilli-fall deposits from Etna\'s explosive summit-cone building phase. Associated with the Ellittico caldera (~15 ka) and post-caldera pyroclastic activity.',
  'Monte Calvario formation':
    'Loose scoria, lapilli, and ash from prehistoric effusive–explosive eruptions. Forms scoria cones and pyroclastic aprons on Etna\'s mid-flanks; poorly consolidated.',
  'Simeto formation':
    'Fluvial gravels, sands, and silts of the Simeto River valley. Quaternary age; reworked volcanic detritus and minor limestone pebbles from surrounding uplands.',
  'Serra delle Concazze Formation':
    'Prehistoric trachybasalt lavas forming the northern rim of the Ellittico caldera. Well-consolidated, heavily jointed flows exposed at high altitude on the northern flank.',
  'Canalone della Montagnola Formation':
    'Scoriaceous spatter and lapilli from a major prehistoric fissure eruption on the southern upper flank. Monte Montagnola (2,632 m) is the dominant cone of this unit; associated lava flows are dense olivine–clinopyroxene trachybasalts.',
  'Serra Cuvigghiuni Formation':
    'Dense trachybasalt lava flows with well-developed columnar jointing on the southern upper flank. Associated with flank effusive activity during the Ellittico volcanic phase.',
  'Acqua della Rocca Formation':
    'Olivine–clinopyroxene trachybasalt lava flows on the southeastern flank. Erupted from flank vents during the pre-Mongibello volcanic phase; typically massive with minor scoriaceous tops.',
  'Serra del Salifizio Formation':
    'Massive trachybasalt lava flows with well-developed levees, forming extensive outcrops across Etna\'s mid-flanks. Part of the proto-Etna/Ellittico eruptive phase.',
  'Valle degli Zappini Formation':
    'Clinopyroxene–olivine trachybasalt lavas forming basal outcrops of the Valle del Bove headwall escarpment on the northeastern flank.',
  'Serra Giannicola Grande Formation':
    'Dense, massive trachybasalt lava flows on the southeastern flank and Valle del Bove walls. Part of the long-lived Ellittico volcanic phase.',
  'Monte Fior di Cosimo formation':
    'Trachybasalt lava flows on the eastern flank exposed in the Valle del Bove. Interbedded with pyroclastic horizons marking phases of increased explosive activity.',
  'Monte Scorsone Formation':
    'Dense massive trachybasalt and minor aa lava flows exposed in the upper Valle del Bove walls. Part of the early Mongibello volcanic phase.',
  'Piano del Trifoglietto formation':
    'Remnant lavas of the ancient Trifoglietto I/II volcanic centres (~100–60 ka), precursors to Etna\'s current edifice. Trachybasalt to phonotephrite composition; erupted from vents now largely buried beneath the Valle del Bove depression.',
  'Rocche formation':
    'Trachybasalt to phonotephrite lavas exposed in the Valle del Bove headwall. Among the oldest accessible lavas of Etna\'s main shield-building phase; partially altered by hydrothermal fluids.',
  'Contrada Passo Cannelli formation':
    'Clinopyroxene-rich trachybasalt lava flows on the southeastern flank; stratigraphically among the oldest units of Etna\'s post-Trifoglietto phase.',
  'Valverde formation':
    'Trachybasalt lavas at the lower southeastern flank, near sea level. Among the earliest lavas of Etna\'s shield-building phase (~100 ka); form the basement of coastal headlands.',
  'Moscarello formation':
    'Pillow lavas and hyaloclastites erupted in a submarine to shallow-water environment during early growth of the ancestral Etna edifice (~200–100 ka). Exposed at the southeastern base of the edifice.',
  'Calanna formation':
    'Subalkalic to mildly alkalic basalt lavas of the pre-Trifoglietto Calanna volcanic centre (~200–230 ka). The oldest exposed volcanic products at Etna; form the structural basement of the edifice.',
  'S. Maria degli Ammalati formation':
    'Quaternary alluvial and colluvial deposits at the eastern and southeastern piedmont. Sand, gravel, and volcanic detritus partially reworked from Etna\'s erosional apron; intercalated with lava flow toes.',
  'Timpa formation':
    'Pleistocene marine sands, clays, and bioclastic calcarenites exposed along the Ionian coastline. Deposited in a shallow-to-intermediate shelf environment and uplifted by the active Timpa fault system.',
  'Timpa di Don Masi formation':
    'Fossiliferous calcarenites and marls of the coastal escarpment south of Acireale. Record rapid Quaternary sea-level and tectonic uplift changes along the Ionian coast.',
  'San Placido Formation':
    'Coarse volcanic gravel, pebbles, and sandy matrix; Quaternary fluvial and alluvial-fan deposits on the western and southern flanks banked against pre-Etna basement.',
  'S. Maria di Licodia Formation':
    'Coarse volcanic gravel in a sandy matrix; Pleistocene alluvial deposits at the southwestern piedmont. Records early phases of Etna\'s erosional history on the Simeto valley margins.',
  'S. Giorgio sands Formation':
    'Pliocene to early Pleistocene bioclastic, quartz-rich marine sands deposited in a regressive coastal-shelf environment beneath the eastern Catania plain.',
  'Acicastello Formation':
    'Pillow lavas and hyaloclastites erupted in a shallow-marine environment during the early growth of Etna\'s ancestral edifice (~500–300 ka). Exposed in the sea cliffs at Acicastello on the Ionian coast.',
  'Argille grigio-azzurre Formation':
    'Pliocene grey-blue marine clays forming the pre-Etna substrate beneath the Catania plain and eastern piedmont. Deposited in a deep-water shelf environment; locally exposed where erosion has stripped the overlying volcanic cover.',
  // ── Generic deposit types (INGV EtnaGeoMap + ISPRA fallback) ─────────────
  'Scoria cone':                     'Monogenetic cone built of loose scoria and agglutinate from single-vent explosive eruptions. Etna\'s flanks host hundreds of cones formed over the past 15,000 years.',
  'Distal pyroclastic fall deposit':  'Airfall tephra deposited downwind from Etna\'s summit craters. Persistent trade winds carry material preferentially SE. Dated tephra layers form the stratigraphic backbone of Etna\'s eruptive history.',
  'Pyroclastic fallout deposit':      'Tephra settled gravitationally from eruption columns. Grain size decreases with distance from source; individual layers record the intensity and duration of each eruption.',
  'Flow and fallout pyroclastic deposits': 'Mixed pyroclastic materials — both airfall tephra and pyroclastic density-current deposits from Etna\'s paroxysmal explosive episodes.',
  'Slope deposit':                    'Unconsolidated colluvium and gravitationally reworked volcanic debris mantling hillslopes. Includes remobilised tephra, scoria, and lava fragments.',
  'Landslide deposit':                'Mass-movement deposit. The eastern flank of Etna is subject to large-scale gravitational instability driven by repeated dyke intrusion, hydrothermal alteration, and flank unbuttressing.',
  'Alluvial deposit':                 'Fluvial gravel, sand, and silt deposited by streams draining the edifice. Quaternary age; locally covers older volcanic units in valley floors.',
  'Present alluvial deposit':         'Active sediment on modern riverbeds and floodplains. Entirely Holocene; reworked from volcanic source material.',
  'Recent alluvial deposit':          'Late Quaternary fluvial deposit in valley floors and piedmont areas around the edifice.',
  'Alluvial fan':                     'Fan-shaped body of stream-transported sediment where channels debouch onto the Simeto valley floor. Volumetrically significant along the western and southern flanks.',
  'Numidian flysch':                  'Oligocene–Miocene quartz arenite turbidites, one of the most areally extensive flysch units in the central Mediterranean. Deposited in a deep-water basin ahead of advancing Apenninic thrust fronts.',
};

// ── EGDI INSPIRE lithology descriptions (keyed by camelCase code) ────────────

const _EGDI_LITH_DESC = {
  'impureLimestone':
    'Argillaceous or marly limestone — a carbonate rock with a significant clay or silt fraction. In Sicily these units dominate the Apenninic thrust sheets and the Sicilide nappe complex, recording deposition in Mesozoic–Palaeogene pelagic and slope environments. The impure fraction reflects terrigenous input during periods of tectonic instability along the palaeo-African margin.',
  'limestone':
    'Pure to near-pure carbonate rock deposited in shallow-marine platform or reef environments. The Hyblean carbonate platform south of Etna — one of the thickest carbonate successions in the central Mediterranean — comprises Triassic to Miocene limestones largely unaffected by Alpine deformation. These rocks form the rigid basement that stops Apenninic thrust fronts ~40 km south of the volcano.',
  'clasticSediment':
    'Unconsolidated or weakly consolidated sand, silt, and gravel of Quaternary age. Around Etna these sediments fill the Catania plain and coastal lowlands, deposited by rivers draining the volcanic edifice and reworked by marine processes along the Ionian coast. Their low permeability restricts groundwater flow and amplifies seismic shaking relative to adjacent bedrock.',
  'mudstone':
    'Fine-grained lithified mud deposited in low-energy, deep-water or lagoonal settings. In the Etna region mudstones occur within the Pliocene marine sequences of the Catania basin and in the Cretaceous–Eocene pelagic successions of the Sicilide units. They form aquitards that confine groundwater aquifers and reduce slope stability where exposed on hillsides.',
  'carbonateSedimentaryRock':
    'A broad category covering limestones, dolostones, and calcarenites — carbonate rocks formed by biological or chemical precipitation in marine environments. These units underlie much of southeastern Sicily as part of the foreland Hyblean platform and are also present within the Apenninic nappe stack. They host the main regional aquifer system that supplies drinking water to the Catania plain.',
  'shale':
    'Fissile fine-grained clastic rock rich in clay minerals, formed by compaction of deep-water or shelf muds. Shales in the Etna region belong principally to the Eocene–Oligocene flysch sequences of the Maghrebian nappe, thrust northward over the Hyblean foreland. Easily eroded and prone to swelling when wet, they control slope failure risk across the Nebrodi and Peloritani foothills.',
  'clasticSedimentaryRock':
    'Consolidated clastic rock — sandstone, siltstone, or conglomerate — formed by lithification of sediment transported by currents or gravity flows. In the Etna region these rocks include the Oligo-Miocene Numidian Flysch (quartz-rich turbiditic sandstones) and coarser-grained Messinian and Pliocene foredeep sequences. They record successive phases of basin infilling as the Apenninic–Maghrebian chain migrated southeastward.',
  'basalt':
    'Mafic volcanic rock crystallised from low-viscosity, iron- and magnesium-rich magma. At the 1:1M regional scale, basalt outcrop reflects Etna\'s extensive lava field as well as older rift-related volcanism along the Iblean–Malta Escarpment zone. Etna\'s basalts are trachybasaltic in composition, erupted from both summit craters and the dense network of flank fissures that cross the edifice.',
  'gneiss':
    'High-grade metamorphic rock formed by intense pressure and heat that recrystallises sedimentary or igneous protoliths into banded, foliated aggregates of quartz, feldspar, and mica. In the Etna region gneiss forms the Variscan–Alpine crystalline basement of the Calabrian Arc, exposed in the Peloritani Mountains to the north. These ancient rocks (>300 Ma) represent the deepest structural level of the southern Apennines and formed the rigid backstop during Neogene nappe emplacement.',
  'andesite':
    'Intermediate volcanic rock with silica content between basalt and dacite, typically erupted from subduction-related or transitional tectonic settings. In the EGDI 1:1M dataset, andesite classification in the Etna domain may encompass trachyandesitic lava from Etna\'s earlier, more evolved eruptive phases, or volcanic products of the Aeolian arc system to the north. Trachyandesites are common in the pre-shield and elliptical-cone stages of Etna\'s construction (~100–15 ka).',
  'phyllite':
    'Low- to medium-grade metamorphic rock derived from shale or mudstone, characterised by a silky sheen from fine-grained mica on cleavage surfaces. In the Etna region phyllites belong to the Palaeozoic basement of the Calabrian Arc, part of a Variscan orogenic belt later fragmented and transported to its present position during Neogene opening of the Tyrrhenian basin. They are exposed in the Peloritani and Aspromonte massifs.',
  'micaSchist':
    'Medium- to high-grade metamorphic rock composed mainly of quartz and micas (muscovite, biotite), with well-developed schistosity from directed pressure. Mica schists in the Etna region are part of the Calabrian Arc crystalline nappe, exhumed from mid-crustal depths during Miocene back-arc extension. They represent some of the oldest rocks exposed at the surface in the region, providing a record of multiple metamorphic and deformational cycles.',
  'sandstone':
    'Clastic sedimentary rock formed by cementation of sand grains, most commonly quartz. In the Etna region sandstones occur within the Numidian Flysch (Oligo-Miocene turbiditic quartzarenites) and in shallower-water Pliocene–Pleistocene deltaic and coastal sequences. The Numidian Flysch sandstones are notably mature and quartz-rich, derived from distant cratonic sources and transported by deep-water turbidity currents across the proto-Mediterranean basin.',
  'impureCarbonateSediment':
    'Mixed carbonate–siliciclastic sediment containing both calcium carbonate and terrigenous clay or silt, representing transitional depositional environments between pure carbonate platforms and clastic input zones. In the Etna region such sediments occur at the margins of the Hyblean platform and in Pliocene–Quaternary shelf sequences of the Catania basin, recording fluctuating sea levels and changing sediment supply from the emerging Apenninic mountains.',
};

function _egdiLithDesc(lithCode) {
  if (!lithCode || lithCode === 'unknown') return '';
  if (_EGDI_LITH_DESC[lithCode]) return _EGDI_LITH_DESC[lithCode];
  // Try prefix match for unlisted codes
  for (const key of Object.keys(_EGDI_LITH_DESC)) {
    if (lithCode.toLowerCase().startsWith(key.toLowerCase())) return _EGDI_LITH_DESC[key];
  }
  return '';
}

function _ingvUnitDesc(name) {
  if (!name) return '';
  if (_INGV_UNIT_DESC[name]) return _INGV_UNIT_DESC[name];
  const lower = name.toLowerCase();
  if (lower.includes('scoria cone'))      return _INGV_UNIT_DESC['Scoria cone'];
  if (lower.includes('pyroclastic fall')) return _INGV_UNIT_DESC['Distal pyroclastic fall deposit'];
  if (lower.includes('pyroclastic'))      return _INGV_UNIT_DESC['Flow and fallout pyroclastic deposits'];
  if (lower.includes('alluvial fan'))     return _INGV_UNIT_DESC['Alluvial fan'];
  if (lower.includes('alluvial'))         return _INGV_UNIT_DESC['Alluvial deposit'];
  if (lower.includes('slope deposit'))    return _INGV_UNIT_DESC['Slope deposit'];
  if (lower.includes('landslide'))        return _INGV_UNIT_DESC['Landslide deposit'];
  return '';
}

// Returns a human-readable feature-type label from the INGV name + broad type.
function _ingvFeatureLabel(name, type) {
  const n = (name || '').toLowerCase();
  if (n.includes('lava flow'))            return 'Basaltic Lava Flow';
  if (n.includes('lava'))                 return 'Lava';
  if (n.includes('scoria cone'))          return 'Scoria Cone';
  if (n.includes('scoria'))              return 'Scoria Deposit';
  if (n.includes('pyroclastic fall'))     return 'Pyroclastic Fall';
  if (n.includes('pyroclastic'))          return 'Pyroclastic Deposit';
  if (n.includes('tuff'))                 return 'Tuff';
  if (n.includes('lahar'))                return 'Lahar Deposit';
  if (n.includes('alluvial fan'))         return 'Alluvial Fan';
  if (n.includes('alluvial'))             return 'Alluvial Deposit';
  if (n.includes('slope deposit'))        return 'Slope Deposit';
  if (n.includes('landslide'))            return 'Landslide Deposit';
  if (n.includes('sand'))                 return 'Sand / Gravel';
  if (n.includes('flysch'))               return 'Flysch';
  if (n.includes('limestone'))            return 'Limestone';
  if (n.includes('clay') || n.includes('marl')) return 'Clay / Marl';
  // Fall back to title-casing the broad type field
  if (type) return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  return 'Geological Unit';
}

// Approximate polygon area in km² from geographic rings (Shoelace + lat correction).
function _polyAreaKm2(rings) {
  if (!rings || !rings.length) return 0;
  const ring = rings[0];
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  const areaDeg2 = Math.abs(sum) / 2;
  let latSum = 0;
  for (let i = 0; i < n; i++) latSum += ring[i][1];
  const latRad = (latSum / n) * (Math.PI / 180);
  return areaDeg2 * 111.32 * 111.32 * Math.cos(latRad);
}

function showGeologyPopup(feat, isLava) {
  const popup = document.getElementById('scene-popup');
  if (!popup) return;

  const src = isLava === 'egdi'   ? 'egdi'
            : isLava === 'ingv_wms' ? 'ingv_wms'
            : isLava                ? 'lava'
                                    : 'ingv';

  let titleText, metaText, kickerText, copyText, tableRows, stateText;

  if (src === 'egdi') {
    // EGDI 1:1M feature: [id, name, lithology, age, source, color_hex, rings]
    const lithCode  = feat[2] || 'unknown';
    const age       = feat[3] || '';
    const egdiSrc   = feat[4] || '';
    const area      = _polyAreaKm2(feat[6]);
    // Expand camelCase INSPIRE lithology code → title-case label ("clasticSediment" → "Clastic Sediment")
    const lithTitle = lithCode.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    stateText  = lithTitle;
    titleText  = lithTitle;
    metaText   = '';
    kickerText = '';   // EGDI has no formation name; leave blank rather than show dataset
    copyText   = _egdiLithDesc(lithCode);
    tableRows  = [
      age     ? ['Age / Era',   age]                                                                   : null,
      egdiSrc ? ['Data source', egdiSrc]                                                               : null,
      area > 0.01 ? ['Area', area < 1 ? (area * 100).toFixed(1) + ' ha' : area.toFixed(2) + ' km²']  : null,
      ['Dataset', 'EGDI 1:1M pan-European Geology (CC-BY 4.0)'],
    ].filter(Boolean);

  } else if (src === 'ingv_wms') {
    // INGV EtnaGeoMap verbatim feature: [id,sigle,name,type,age,formation,lithology,info_en1,color,rings]
    const sigle     = feat[1] || '';
    const name      = feat[2] || '';
    const age       = feat[4] || '';
    const formation = feat[5] || '';
    const lithology = feat[6] || '';
    const info_en1  = feat[7] || '';
    const rings     = feat[9];
    const area      = _polyAreaKm2(rings);
    stateText  = _ingvFeatureLabel(name, feat[3]);
    titleText  = name || formation || 'Geological unit';
    metaText   = '';
    kickerText = formation || '';
    copyText   = info_en1 || lithology || _ingvUnitDesc(name);
    tableRows  = [
      age    ? ['Age / Eruption', age]   : null,
      sigle  ? ['Map code',  sigle]      : null,
      area > 0.01 ? ['Area', area < 1 ? (area * 100).toFixed(1) + ' ha' : area.toFixed(2) + ' km²'] : null,
      ['Dataset', 'INGV EtnaGeoMap — Branca et al. 2011'],
    ].filter(Boolean);

  } else if (isLava) {
    // Legacy lava format kept for safety — [id, name, formation, age, code, rings]
    const name      = feat[1] || 'Lava flow';
    const formation = feat[2] || '';
    const year      = feat[3] || '';

    stateText = 'Lava Flow';
    titleText = name;
    metaText  = 'Basaltic lava flow';
    copyText  = 'Effusive eruption of basaltic to trachybasaltic lava from Etna\'s flank or summit vents. '
              + 'Lava flows are Etna\'s primary hazard mechanism, advancing at 50–300 m/h and reaching up to 15 km from source. '
              + 'Individual flows are typically 1–10 m thick; repeated eruptions build the broad shield of the edifice.';
    tableRows = [
      year      ? ['Year erupted', year]     : null,
      formation ? ['Formation',   formation] : null,
    ].filter(Boolean);

  } else {
    // INGV non-lava legacy path — [id, name, type, formation, code, source, coords]
    const name    = feat[1] || '';
    const etaGeol = feat[3] || '';

    stateText  = 'Geology';
    titleText  = name || 'Volcanic deposit';
    metaText   = etaGeol || '';
    kickerText = name || etaGeol || '';
    copyText   = _ingvUnitDesc(name);
    tableRows  = etaGeol ? [['Formation', etaGeol]] : [];
  }

  const state = document.getElementById('scene-popup-state');
  if (state) {
    state.textContent = stateText || '';
    state.hidden = false;
  }

  const kicker = document.getElementById('scene-popup-kicker');
  if (kicker) {
    kicker.textContent = kickerText || metaText || '';
    kicker.style.color = src === 'egdi' ? '#3a88c8' : '#d45a30';
  }

  const title = document.getElementById('scene-popup-title');
  if (title) title.textContent = titleText;

  const meta = document.getElementById('scene-popup-meta');
  if (meta) meta.textContent = metaText || '';

  const copy = document.getElementById('scene-popup-copy');
  if (copy) { copy.textContent = copyText || ''; copy.hidden = !copyText; }

  const detail = document.getElementById('scene-popup-detail');
  if (detail) {
    detail.hidden = tableRows.length === 0;
    detail.innerHTML = tableRows.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:0.72rem;margin-top:0.4rem;">` +
        tableRows.map(([k, v]) =>
          `<tr><td style="color:var(--muted);padding:0.15rem 0.5rem 0.15rem 0;">${k}</td>` +
          `<td style="text-align:right;font-weight:600;">${v}</td></tr>`
        ).join('') + `</table>`
      : '';
  }

  const img = document.getElementById('scene-popup-img');
  if (img) img.hidden = true;

  popup.removeAttribute('hidden');
  activePopupFeature = { name: titleText, theme: 'general', isGeology: true };
}

function hideFeaturePopup() {
  const popup = document.getElementById('scene-popup');
  if (popup) popup.setAttribute('hidden', '');
  const state = document.getElementById('scene-popup-state');
  if (state) state.hidden = true;
  activePopupFeature = null;
  _seismicSelectionIdx = -1;
  const _re = _seismicRingEl(); if (_re) _re.hidden = true;
  _clearFaultSelection();
}

// ─── Tour mode ────────────────────────────────────────────────────────────────

const TOUR_MODE_FACETS = [
  {
    id: 'highlights',
    label: 'Highlights',
    description: 'A curated tour of Etna\'s most iconic volcanic, geological, and cultural landmarks.',
    matches: item => [
      'Valle del Bove', 'SE Crater', 'New SE Crater', 'Voragine',
      'Monti Rossi', '2002–03 Eruption', '1991–93 Lava Flow',
      'Pernicana Fault', 'Timpe Fault System',
      'Catania', 'Taormina', 'Zafferana Etnea',
    ].includes(item.name),
  },
  {
    id: 'vents',
    label: 'Craters & vents',
    description: 'Summit craters, parasitic cones, and historic eruptive vents.',
    matches: item => item.theme === 'vent',
  },
  {
    id: 'fissures',
    label: 'Eruptions & fissures',
    description: 'Historic and recent flank eruption fissure zones.',
    matches: item => item.theme === 'fissure',
  },
  {
    id: 'faults',
    label: 'Faults & rift zones',
    description: 'Active faults, seismogenic structures, and magmatic rift zones.',
    matches: item => item.theme === 'fault',
  },
  {
    id: 'settlements',
    label: 'Towns & cities',
    description: 'Settlements on and around the Etna domain — from high-altitude villages to coastal cities.',
    matches: item => item.theme === 'settlement',
  },
  {
    id: 'general',
    label: 'Landmarks & features',
    description: 'Visitor hubs, observatories, and major geographical features.',
    matches: item => item.theme === 'general',
  },
];

let activeTourModeFeature = null;
let activeTourModeFacetId = TOUR_MODE_FACETS[0].id;
let _activeTourFlightTimer = null;

function _clearTourFlightTimer() {
  if (_activeTourFlightTimer) { clearTimeout(_activeTourFlightTimer); _activeTourFlightTimer = null; }
}

function _getTourFacet(id = activeTourModeFacetId) {
  return TOUR_MODE_FACETS.find(f => f.id === id) || TOUR_MODE_FACETS[0];
}

function _getTourFeatures(facetId = activeTourModeFacetId) {
  const facet = _getTourFacet(facetId);
  return ETNA_POIS.filter(item => facet.matches(item));
}

function _populateTourTargetOptions(facetId = activeTourModeFacetId, selectedName = activeTourModeFeature?.name || '') {
  const sel = document.getElementById('tour-mode-target');
  if (!sel) return;
  const features = _getTourFeatures(facetId);
  sel.innerHTML = '';
  for (const f of features) {
    const opt = document.createElement('option');
    opt.value = opt.textContent = f.name;
    sel.appendChild(opt);
  }
  if (features.some(f => f.name === selectedName)) sel.value = selectedName;
  else if (features.length) sel.value = features[0].name;
}

function _syncTourControls(feature = activeTourModeFeature) {
  const features = _getTourFeatures(activeTourModeFacetId);
  const toggle   = document.getElementById('tour-mode-toggle');
  const section  = document.getElementById('tour-mode-section');
  const controls = document.getElementById('tour-mode-controls');
  const facetSel = document.getElementById('tour-mode-facet');
  const prev     = document.getElementById('tour-mode-prev');
  const next     = document.getElementById('tour-mode-next');
  const on = Boolean(feature);
  if (toggle)   toggle.checked = on;
  if (section)  section.open  = on;
  if (controls) controls.style.display = on ? '' : 'none';
  if (facetSel) facetSel.value = activeTourModeFacetId;
  _populateTourTargetOptions(activeTourModeFacetId, feature?.name || '');
  if (prev) prev.disabled = !on || features.length <= 1;
  if (next) next.disabled = !on || features.length <= 1;
}

function _deactivateTour() {
  _clearTourFlightTimer();
  activeTourModeFeature = null;
  _syncTourControls(null);
  hideFeaturePopup();
}

function _presentTourStop(feature) {
  if (!feature) return;
  activeTourModeFeature = feature;
  _clearTourFlightTimer();
  showFeaturePopup(feature);
  _syncTourControls(feature);
  setStatus(`Touring ${feature.name}.`);
  const h = _sampleHeight(feature.x, feature.z);
  const targetPos = new THREE.Vector3(feature.x, h, feature.z);
  _activeTourFlightTimer = setTimeout(() => {
    _activeTourFlightTimer = null;
    flyTo(targetPos, 2000);
  }, 500);
}

function _cycleTour(dir) {
  const features = _getTourFeatures();
  if (!features.length) return;
  const cur = activeTourModeFeature
    ? features.findIndex(f => f.name === activeTourModeFeature.name)
    : (dir >= 0 ? -1 : 0);
  const next = features[((cur + dir) % features.length + features.length) % features.length];
  _presentTourStop(next);
}

// ─── Fly-to: animate camera to look at a 3D position ────────────────────────

const _flyVec = new THREE.Vector3();
let _flyToken = 0; // incremented to cancel an in-progress flight

function flyTo(targetPos, duration = 1800) {
  if (!camera || !controls) return;
  const myToken = ++_flyToken;
  const startPos    = camera.position.clone();
  const startTarget = controls.target.clone();

  // Landing position: 15 km back along the current camera azimuth, 9 km above the target.
  // Preserves the user's viewing direction so there's no disorienting spin.
  const VIEW_BACK = 15;  // km behind target (scene units ≡ km)
  const VIEW_UP   = 9;   // km above target terrain height
  const azDir = new THREE.Vector3(
    camera.position.x - controls.target.x,
    0,
    camera.position.z - controls.target.z
  );
  if (azDir.lengthSq() < 0.0001) azDir.set(0, 0, 1);
  azDir.normalize();

  const endPos    = new THREE.Vector3(
    targetPos.x + azDir.x * VIEW_BACK,
    targetPos.y + VIEW_UP,
    targetPos.z + azDir.z * VIEW_BACK
  );
  const endTarget = targetPos.clone();

  // Arc: raise camera 15 km above the straight interpolated path at mid-flight.
  const ARC_LIFT = 15;  // km peak-lift at t=0.5

  const t0 = performance.now();
  function step(now) {
    if (_flyToken !== myToken) return; // superseded by a newer flight
    const rawT = Math.min((now - t0) / duration, 1);
    // Cubic ease-in-out for lateral motion and target lerp
    const e = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

    const baseX = startPos.x + (endPos.x - startPos.x) * e;
    const baseY = startPos.y + (endPos.y - startPos.y) * e;
    const baseZ = startPos.z + (endPos.z - startPos.z) * e;

    // Sine arc on Y — peaks at rawT=0.5, zero at start and end
    const arcY = ARC_LIFT * Math.sin(rawT * Math.PI);

    camera.position.set(baseX, baseY + arcY, baseZ);
    _flyVec.lerpVectors(startTarget, endTarget, e);
    controls.target.copy(_flyVec);
    controls.update();
    if (rawT < 1) requestAnimationFrame(step);
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
  if (!hits.length || _isClipped(hits[0].point)) return null;
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
    if (hazardHits.length > 0 && hazardHits[0].object.userData.hazardZone && !_isClipped(hazardHits[0].point)) {
      showHazardPopup(hazardHits[0].object.userData.hazardZone);
      return;
    }
  }

  // Seismic event click (only when visible)
  if (seismicMesh && seismicMesh.visible) {
    const seismicHits = clickRay.intersectObject(seismicMesh);
    if (seismicHits.length > 0 && !_isClipped(seismicHits[0].point)) {
      showSeismicPopup(seismicHits[0].instanceId);
      return;
    }
  }

  // Fault ribbon click (only when the ribbon group AND its root are visible)
  if (tectonicFaultRoot?.visible && _faultRibbonGroup?.visible && _faultRibbonMeshes.length > 0) {
    const faultHits = clickRay.intersectObjects(_faultRibbonMeshes, false);
    if (faultHits.length > 0 && !_isClipped(faultHits[0].point)) {
      const hitMesh = faultHits[0].object;
      const feature = hitMesh.userData.feature;
      if (feature) { _selectFaultMesh(hitMesh); showFeaturePopup(feature); return; }
    }
  }

  // Plumbing subsurface label click
  if (_plumbingLabelInteractives.length > 0) {
    const plumbHits = clickRay.intersectObjects(_plumbingLabelInteractives, false);
    const phit = plumbHits.find(h => h.object.visible && h.object.userData.feature);
    if (phit) { showFeaturePopup(phit.object.userData.feature); return; }
  }

  // Core layer label click — mirrors Mars: raycaster.intersectObjects(cutawayResult.interactiveObjects)
  if (crossSectionEnabled && _coreLabelsEnabled && _layerLabelInteractives.length > 0) {
    const layerHits = clickRay.intersectObjects(_layerLabelInteractives, false);
    const hit = layerHits.find(h => h.object.visible && h.object.userData.feature);
    if (hit) {
      const feature = hit.object.userData.feature;
      _setCoreSelection(feature);
      showFeaturePopup(feature);
      return;
    }
  }

  // POI label click — takes priority over geology (smaller, more specific targets)
  if (etnaLabelLayer) {
    const labelHits = clickRay.intersectObjects(etnaLabelLayer.interactiveObjects, false);
    if (labelHits.length > 0 && labelHits[0].object.userData.feature && !_isClipped(labelHits[0].object.position)) {
      showFeaturePopup(labelHits[0].object.userData.feature);
      return;
    }
  }

  // Geology click — raycast terrain → lon/lat → PIP
  if (surfaceMesh && surfaceMesh.visible && (_ingvGeoFeats || _egdiGeoFeats)) {
    const terrainHits = clickRay.intersectObject(surfaceMesh);
    if (terrainHits.length > 0 && !_isClipped(terrainHits[0].point)) {
      const pt = terrainHits[0].point;
      const { lon, lat } = _modelToLonLat(pt.x, pt.z);

      // INGV EtnaGeoMap — highest detail, iterates youngest-first
      if (etnaGeologyMesh?.visible && _ingvGeoFeats) {
        for (let i = _ingvGeoFeats.length - 1; i >= 0; i--) {
          if (_pointInPolygonRings(lon, lat, _ingvGeoFeats[i][9])) {
            showGeologyPopup(_ingvGeoFeats[i], 'ingv_wms');
            return;
          }
        }
      }

      // EGDI 1:1M regional geology — fallback for areas outside INGV footprint
      if (regionalGeologyMesh?.visible && _egdiGeoFeats) {
        for (let i = 0; i < _egdiGeoFeats.length; i++) {
          if (_pointInPolygonRings(lon, lat, _egdiGeoFeats[i][6])) {
            showGeologyPopup(_egdiGeoFeats[i], 'egdi');
            return;
          }
        }
      }
    }
  }

  hideFeaturePopup();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

setupUI();
init();

// Register canvas interaction after init() creates the renderer
renderer.domElement.addEventListener('pointerdown', _onPointerDown);
renderer.domElement.addEventListener('pointermove', _onPointerMove, { passive: true });
renderer.domElement.addEventListener('pointerup',   _onPointerUp);
