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

// ─── State ────────────────────────────────────────────────────────────────────

let renderer, scene, camera, controls;
let surfaceMesh = null;
let seaPlane = null;
let chamberMeshes = {};
let dykeMeshes = {};
let stationMarkers = [];
let labels = [];
let clipPlane = null;
let clipPlaneHelper = null;
let activeModel = '2'; // '2' or '3'
let crossSectionEnabled = false;
let crossSectionAngle = 0; // degrees about Y axis
let showStations = true;
let showSurfaceLabels = true;
let showSubsurfaceLabels = true;
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

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03070d, 0.004);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(18, 12, 28);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 120;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
  controls.update();

  setupLighting();
  buildSeaLevelPlane();
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
      setStatus('');
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
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const gx = pos.getX(i);
    const gy = pos.getY(i);
    const gz = pos.getZ(i);
    pos.setXYZ(i, (gx - 50000) / 1000, gz / 1000, (gy - 50000) / 1000);
  }
  pos.needsUpdate = true;
}

// ─── Sea level plane ──────────────────────────────────────────────────────────

function buildSeaLevelPlane() {
  const geo = new THREE.PlaneGeometry(100, 100, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x1155aa,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
    clippingPlanes: [],
  });
  seaPlane = new THREE.Mesh(geo, mat);
  seaPlane.rotation.x = -Math.PI / 2;
  seaPlane.position.y = 0;
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
  Object.values(chamberMeshes).forEach(applyPlanes);
  Object.values(dykeMeshes).forEach(applyPlanes);
}

function setCrossSectionAngle(deg) {
  crossSectionAngle = deg;
  const rad = (deg * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const nz = -Math.cos(rad);
  clipPlane.set(new THREE.Vector3(nx, 0, nz), 0);
  if (clipPlaneHelper) clipPlaneHelper.updateMatrixWorld();
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
      camera.position.set(18, 12, 28);
      controls.target.set(0, 1.5, 0);
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateContextHUD();
  updateLabelPositions();
  renderer.render(scene, camera);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

setupUI();
init();
