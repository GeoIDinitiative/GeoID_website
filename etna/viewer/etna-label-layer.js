/**
 * GeoID: Earth — Etna POI label layer
 * Three.js sprite labels (canvas pill textures), surface dots, and connector lines.
 * Architecture mirrors the Mars viewer label-layer.js exactly.
 */

import * as THREE from './vendor/three.module.js';

// ─── Theme palette (matches Mars viewer conventions) ─────────────────────────

const THEME_PALETTE = {
  settlement: {
    bg:     'rgba(10, 22, 14, 0.74)',
    stroke: 'rgba(128, 229, 160, 0.42)',
    accent: 'rgba(98, 222, 132, 0.94)',
    title:  'rgba(237, 255, 242, 0.96)',
    markerColor:   0x65dc78,
    lineColor:     0x86f19a,
    spriteOpacity: 0.94,
    accentHex:     '#65dc78',
  },
  fault: {
    bg:     'rgba(18, 10, 4, 0.76)',
    stroke: 'rgba(184, 115, 51, 0.50)',
    accent: 'rgba(184, 115, 51, 0.92)',
    title:  'rgba(255, 235, 210, 0.96)',
    markerColor:   0xb87333,
    lineColor:     0xd4965a,
    spriteOpacity: 0.86,
    accentHex:     '#b87333',
  },
  vent: {
    bg:     'rgba(28, 10, 10, 0.72)',
    stroke: 'rgba(255, 122, 96, 0.56)',
    accent: 'rgba(255, 88, 69, 0.92)',
    title:  'rgba(255, 234, 230, 0.96)',
    markerColor:   0xff735d,
    lineColor:     0xff8c73,
    spriteOpacity: 0.94,
    accentHex:     '#ff735d',
  },
  fissure: {
    bg:     'rgba(28, 14, 4, 0.74)',
    stroke: 'rgba(255, 160, 60, 0.48)',
    accent: 'rgba(255, 145, 0, 0.92)',
    title:  'rgba(255, 235, 200, 0.96)',
    markerColor:   0xff9100,
    lineColor:     0xffb347,
    spriteOpacity: 0.90,
    accentHex:     '#ff9100',
  },
  general: {
    bg:     'rgba(9, 14, 24, 0.62)',
    stroke: 'rgba(90, 214, 233, 0.28)',
    accent: 'rgba(58, 214, 208, 0.92)',
    title:  'rgba(242, 247, 250, 0.94)',
    markerColor:   0x34d7d1,
    lineColor:     0x46d7d1,
    spriteOpacity: 0.82,
    accentHex:     '#34d7d1',
  },
};

export function getThemePalette(theme) {
  return THEME_PALETTE[theme] || THEME_PALETTE.general;
}

// ─── POI data ─────────────────────────────────────────────────────────────────
// Coordinates in Etna viewer space: X = east km, Z = south km (from domain centre)
// Y is sampled from terrain at build time. Domain centre ≈ 37.755°N, 15.003°E.
// 1° lat ≈ 111 km, 1° lon at 37.755°N ≈ 87.8 km

export const ETNA_POIS = [

  // ── Settlements ──────────────────────────────────────────────────────────────
  {
    name: 'Catania', kicker: 'City', theme: 'settlement', x: 7.4, z: 28.1, lod: 1,
    meta: '37.50°N  15.09°E  ·  8 m asl',
    description: "Sicily's second city, 28 km south of the summit on the Ionian coast. Population ~300,000. Severely damaged in the catastrophic 1669 eruption — lava reached the city walls and entered the harbour, and a 1693 earthquake devastated the rebuilt city.",
  },
  {
    name: 'Nicolosi', kicker: 'Town', theme: 'settlement', x: 2.7, z: 15.8, lod: 2,
    meta: '37.61°N  15.03°E  ·  698 m asl',
    description: "Gateway town on Etna's southern flank. Main base for the southern summit route via the Funivia cable car and Rifugio Sapienza. INGV Osservatorio Etneo is 1 km west. Nicolosi sits on extensive lava flows from the 17th–19th century.",
  },
  {
    name: 'Zafferana Etnea', kicker: 'Town', theme: 'settlement', x: 9.2, z: 7.0, lod: 2,
    meta: '37.69°N  15.11°E  ·  574 m asl',
    description: "Eastern flank town famously menaced by the 1991–93 lava flows descending Valle del Bove. Flows stopped 1 km short after the Italian Army constructed diversion barriers and drilled drainage tunnels into the lava tube system.",
  },
  {
    name: 'Bronte', kicker: 'Town', theme: 'settlement', x: -14.7, z: -3.6, lod: 2,
    meta: '37.79°N  14.84°E  ·  760 m asl',
    description: "Town on Etna's western flank on ancient lava flows. World-renowned for pistachio cultivation on the mineral-rich volcanic soil — Bronte pistachios hold DOP status. Nelson's estate (Castello Maniace) is nearby.",
  },
  {
    name: 'Randazzo', kicker: 'Town', theme: 'settlement', x: -5.0, z: -13.7, lod: 2,
    meta: '37.88°N  14.95°E  ·  765 m asl',
    description: "Medieval town on Etna's northern lava flows. Despite its position at the volcano's base, Randazzo has never been inundated by lava — bedrock topography deflects flows to either side. Its historic centre survives largely intact.",
  },
  {
    name: 'Linguaglossa', kicker: 'Town', theme: 'settlement', x: 12.2, z: -9.8, lod: 3,
    meta: '37.84°N  15.14°E  ·  550 m asl',
    description: "NE flank town built on ancient lavas. Northern gateway to the Piano Provenzana ski area. The 2002 lava flows reached within 6 km to the west before stalling.",
  },
  {
    name: 'Adrano', kicker: 'Town', theme: 'settlement', x: -14.8, z: 10.4, lod: 3,
    meta: '37.66°N  14.83°E  ·  560 m asl',
    description: "SW flank town founded on Quaternary lava flows. The Greek colony of Adranon was established here in 400 BCE. The Simeto River valley marks a major NW–SE structural lineament controlling SW flank volcanism.",
  },

  // ── Faults ───────────────────────────────────────────────────────────────────
  {
    name: 'Timpe Fault System', kicker: 'Active Fault', theme: 'fault', x: 11.2, z: 0.8, lod: 2,
    meta: 'E flank  ·  N-trending normal faults',
    description: "Series of N–S normal fault scarps on Etna's eastern flank, producing steps of 50–100 m. Quaternary active structure linked to seaward gravitational spreading of the volcanic edifice above weak Pleistocene marine clays. Associated with shallow seismicity and ground deformation.",
  },
  {
    name: 'Pernicana Fault', kicker: 'Active Fault', theme: 'fault', x: 3.7, z: -7.5, lod: 2,
    meta: 'NE flank  ·  E–W transtensional',
    description: "Major E–W transtensional fault accommodating the eastward sliding of Etna's NE sector toward the Ionian Sea. Slipped ~10 cm during the 2002–03 eruption, destroying Piano Provenzana. One of Etna's most seismically productive structures, with near-continuous creep.",
  },
  {
    name: 'Ragalna Fault', kicker: 'Active Fault', theme: 'fault', x: -3.9, z: 8.0, lod: 3,
    meta: 'SW flank  ·  NNW-trending normal',
    description: "NNW-trending normal fault on the SW flank associated with slow aseismic creep and episodic seismic swarms. Part of the SW rift zone that channels dykes toward flank eruptive fissures. Intersects the 2001 eruption fissure system.",
  },
  {
    name: 'Santa Venerina Fault', kicker: 'Seismogenic Fault', theme: 'fault', x: 13.5, z: 6.7, lod: 3,
    meta: 'SE piedmont  ·  NNW-trending',
    description: "Piedmont fault on Etna's SE flank associated with damaging historical earthquakes, including an ML 4.8 event in 2018 that caused widespread damage to villages on the lower eastern flank. Part of the broader eastern fault system linked to flank instability.",
  },

  // ── Vents & Craters ──────────────────────────────────────────────────────────
  {
    name: 'Voragine', kicker: 'Summit Crater', theme: 'vent', x: -0.80, z: 0.80, lod: 1,
    meta: '37.748°N  14.994°E  ·  3,350 m asl',
    description: "Central summit crater named for its deep 'chasm'. First described in the 17th century. Site of major paroxysmal lava fountain episodes, most recently December 2015 — the most powerful fountaining since 1998. A persistent lava lake has been observed intermittently since the 1990s.",
  },
  {
    name: 'Bocca Nuova', kicker: 'Summit Crater', theme: 'vent', x: -1.00, z: 0.90, lod: 1,
    meta: '37.747°N  14.992°E  ·  3,340 m asl',
    description: "Summit crater formed 1968 as a collapse pit at the W rim of Voragine. Twin to Voragine in eruption chronology — they share a common magma connection. Shows periodic Strombolian activity, ash emissions, and intracrater lava ponding.",
  },
  {
    name: 'NE Crater', kicker: 'Summit Crater', theme: 'vent', x: -0.60, z: 0.50, lod: 1,
    meta: '37.751°N  14.996°E  ·  3,329 m asl',
    description: "Highest of the four summit craters — at 3,329 m, marking the official summit elevation. Most active in the 1970s–90s, producing frequent lava fountaining and building the current cone. Activity has significantly declined since 2001 as the SE Crater became the dominant vent.",
  },
  {
    name: 'SE Crater', kicker: 'Summit Crater', theme: 'vent', x: -0.30, z: 1.40, lod: 1,
    meta: '37.743°N  15.000°E  ·  ~3,350 m asl',
    description: "Youngest and currently most active summit vent, first opened 1971 on the SE rim. The New SE Cone (formed 2011–13) grew rapidly via lava fountain episodes and is now comparable in height to NE Crater. Dominated by Strombolian and effusive activity since 2010.",
  },
  {
    name: 'Ellittico Caldera', kicker: 'Ancient Caldera', theme: 'vent', x: -0.80, z: 0.70, lod: 3,
    meta: '~15,000 years BP  ·  2.5 × 3.5 km',
    description: "Remnant of a major summit caldera formed ~15,000 years BP following a large explosive eruption and partial collapse of the Ellittico cone. The present summit crater complex sits entirely within this structure. The caldera rim is visible as a subtle topographic break at ~3,100 m on the upper flanks.",
  },
  {
    name: 'Monte Rosso', kicker: 'Flank Vent', theme: 'vent', x: 0.5, z: 9.7, lod: 3,
    meta: 'S flank  ·  1669 eruption  ·  1,100 m asl',
    description: "Twin cinder cones built during the catastrophic 1669 eruption — Etna's most destructive in recorded history. Lava flows travelled 15 km, reached Catania, breached the city walls, and extended 1 km into the sea to form a new promontory. Eruption lasted 122 days; ~70 villages affected.",
  },

  // ── Fissures & Eruptions ─────────────────────────────────────────────────────
  {
    name: '2001 Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: -0.9, z: 5.5, lod: 2,
    meta: 'July – August 2001  ·  SW & S fissures',
    description: "Two fissure systems opened simultaneously — the first such simultaneous multi-fissure eruption in recorded history. One system was fed by summit-derived magma; the other tapped a deeper, more primitive source. Anomalous SO₂-rich gas and HCl emissions. Rifugio Sapienza was partially destroyed by lava flows.",
  },
  {
    name: '2002–03 Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: 1.5, z: -4.5, lod: 2,
    meta: 'Oct 2002 – Jan 2003  ·  N & SE fissures',
    description: "Largest eruption by volume in 20 years. Northern fissures opened near Piano Provenzana, destroying the ski resort. Pernicana Fault slipped ~10 cm. A simultaneous SE fissure eruption made this the first bilateral flank eruption in decades. Ash clouds reached North Africa and closed Catania airport for weeks.",
  },
  {
    name: '1991–93 Lava Flow', kicker: 'Fissure Zone', theme: 'fissure', x: 6.4, z: 2.8, lod: 2,
    meta: 'Dec 1991 – Mar 1993  ·  473 days',
    description: "Etna's longest 20th-century eruption. Lava descended Valle del Bove in a compound lava field threatening Zafferana Etnea. The Italian Army and INGV scientists detonated explosive charges and drilled a 300 m diversion tunnel to drain the lava tube system. Total erupted volume ~300 million m³.",
  },
  {
    name: '2004–05 Eruption', kicker: 'Fissure Zone', theme: 'fissure', x: 2.0, z: -2.2, lod: 3,
    meta: 'Sep 2004 – Mar 2005  ·  Upper E flank',
    description: "Unusually quiet effusive eruption on the upper E flank sourced from the summit plumbing system. No seismic precursors, minimal ground deformation. Lava flowed into upper Valle del Bove with no impact on populated areas. Significant for demonstrating passive magma drainage from the summit reservoir.",
  },

  // ── General POI ──────────────────────────────────────────────────────────────
  {
    name: 'Rifugio Sapienza', kicker: 'Visitor Hub', theme: 'general', x: -0.30, z: 6.30, lod: 2,
    meta: '37.698°N  15.000°E  ·  1,910 m asl',
    description: "Main southern visitor hub and trailhead at 1,910 m. Starting point for the Funivia cable car (to 2,500 m) and southern summit trails. The refuge was partially buried by 2001 lava flows and rebuilt in 2002. Site of the INGV southern monitoring station.",
  },
  {
    name: 'Piano Provenzana', kicker: 'Ski Station', theme: 'general', x: 4.30, z: -4.70, lod: 3,
    meta: '37.797°N  15.052°E  ·  1,800 m asl',
    description: "Northern ski station and NE gateway to Etna's summit routes. The original station was destroyed by 2002 lava flows; the rebuilt facility opened 2009. Sits directly on 2002 lava — a visible reminder of how rapidly Etna's landscape can change.",
  },
  {
    name: 'Valle del Bove', kicker: 'Depression', theme: 'general', x: 3.50, z: 4.20, lod: 2,
    meta: '8 × 5 km  ·  1,200 m deep',
    description: "Massive horseshoe-shaped depression on Etna's eastern flank, formed by sector collapse ~8,000 years BP. Acts as a natural lava flow trap — most flank eruptions pour into it. The 1991–93 flows filled a significant fraction. Walls expose 30,000 years of lava stratigraphy.",
  },
  {
    name: 'Pizzi Deneri', kicker: 'Observatory', theme: 'general', x: 1.60, z: -1.60, lod: 3,
    meta: '37.769°N  15.021°E  ·  2,847 m asl',
    description: "Astrophysical and geophysical observatory on the NE summit rim at 2,847 m. Operates continuously as an INGV monitoring post with thermal cameras providing 24/7 surveillance of NE Crater activity. The summit trail from Piano Provenzana passes through here.",
  },
];

// ─── Canvas pill texture — identical to Mars viewer ──────────────────────────

export function makeLabelTexture(name, theme = 'general', options = {}) {
  const pal          = THEME_PALETTE[theme] || THEME_PALETTE.general;
  const canvas       = document.createElement('canvas');
  const ctx          = canvas.getContext('2d');
  const backingScale = options.backingScale ?? 2;
  const paddingX     = 14;
  const accentWidth  = 6;
  const bodyLeft     = paddingX + accentWidth + 7;
  const titleFont    = "600 15px Orbitron, 'Exo 2', Aldrich, 'Trebuchet MS', sans-serif";
  ctx.font = titleFont;
  const textWidth    = Math.ceil(ctx.measureText(name).width);
  const logicalW     = Math.max(110, textWidth + bodyLeft + paddingX);
  const logicalH     = 34;
  canvas.width       = logicalW * backingScale;
  canvas.height      = logicalH * backingScale;
  ctx.scale(backingScale, backingScale);

  // Background + border
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = pal.bg;
  ctx.strokeStyle  = pal.stroke;
  ctx.lineWidth    = 1.6;
  const rad = 14;
  ctx.beginPath();
  ctx.moveTo(rad, 1);
  ctx.lineTo(logicalW - rad, 1);
  ctx.quadraticCurveTo(logicalW - 1, 1, logicalW - 1, rad);
  ctx.lineTo(logicalW - 1, logicalH - rad - 1);
  ctx.quadraticCurveTo(logicalW - 1, logicalH - 1, logicalW - rad, logicalH - 1);
  ctx.lineTo(rad, logicalH - 1);
  ctx.quadraticCurveTo(1, logicalH - 1, 1, logicalH - rad);
  ctx.lineTo(1, rad);
  ctx.quadraticCurveTo(1, 1, rad, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Left accent bar
  ctx.fillStyle = pal.accent;
  ctx.beginPath();
  ctx.moveTo(rad + 1, 4);
  ctx.lineTo(rad + accentWidth, 4);
  ctx.lineTo(rad + accentWidth, logicalH - 4);
  ctx.lineTo(rad + 1, logicalH - 4);
  ctx.closePath();
  ctx.fill();

  // Label text
  ctx.font      = titleFont;
  ctx.fillStyle = pal.title;
  ctx.fillText(name, bodyLeft, logicalH / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace         = THREE.SRGBColorSpace;
  texture.generateMipmaps    = true;
  texture.minFilter          = THREE.LinearMipmapLinearFilter;
  texture.magFilter          = THREE.LinearFilter;
  texture.needsUpdate        = true;
  // Release the CPU canvas backing store after the first GPU upload
  texture.onUpdate = () => { texture.image = null; texture.onUpdate = null; };
  return { texture, width: logicalW, height: logicalH };
}

// ─── Build label layer ────────────────────────────────────────────────────────

// Shared geometries (created once, reused across all markers)
// Marker radius 0.06 km — pixel size controlled per-frame in the update loop
const _markerGeo   = new THREE.SphereGeometry(0.06, 8, 6);
const _MARKER_RADIUS = 0.06; // must match _markerGeo radius
const _hitGeo      = new THREE.SphereGeometry(0.90, 12, 12);
const _hitMat      = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0, depthTest: false, depthWrite: false,
});

// Base sprite scale — world-unit size stored on each entry as baseScale.
const BASE_SCALE = 0.66;   // world units for a 200-px-wide texture (same as Mars)
const LABEL_LIFT = 2.5;    // km above the surface dot
const _HNORM_EPS = 0.5;    // km finite-difference step for terrain normal

// Zoom-responsive pixel targets — grow as camera gets closer.
// At global view (~30 km) labels are smaller; at close zoom (<1 km) they are larger.
const LABEL_PX_GLOBAL = 15;   // px height at global view
const LABEL_PX_CLOSE  = 34;   // px height at maximum zoom-in
const DOT_PX_GLOBAL   = 2.5;  // px radius at global view
const DOT_PX_CLOSE    = 6.0;  // px radius at maximum zoom-in
const ZOOM_DIST_REF   = 30;   // km: distance below which zoom-in scaling kicks in

// LOD tier scale: larger lod number → slightly smaller label (same as Mars)
const _LOD_TIER_SCALE = [1.0, 1.0, 0.84, 0.70];

export function buildEtnaLabelLayer(scene, sampleHeight) {
  const group             = new THREE.Group();
  const entries           = [];
  const interactiveObjects = [];

  for (const item of ETNA_POIS) {
    const pal    = THEME_PALETTE[item.theme] || THEME_PALETTE.general;
    const surfY  = sampleHeight(item.x, item.z);
    const mPos   = new THREE.Vector3(item.x, surfY,            item.z);
    const sPos   = new THREE.Vector3(item.x, surfY + LABEL_LIFT, item.z);

    // ── Surface dot ──────────────────────────────────────────────────────────
    const marker = new THREE.Mesh(_markerGeo, new THREE.MeshBasicMaterial({
      color: pal.markerColor, transparent: true, opacity: 0.92,
      depthTest: true, depthWrite: false,
    }));
    marker.position.copy(mPos);
    marker.renderOrder      = 200;
    marker.userData.feature = item;
    group.add(marker);

    // ── Invisible hit sphere (easier to click than the tiny dot) ─────────────
    const hit = new THREE.Mesh(_hitGeo, _hitMat);
    hit.position.copy(mPos);
    hit.renderOrder      = 202;
    hit.userData.feature = item;
    group.add(hit);

    // ── Canvas pill sprite ────────────────────────────────────────────────────
    const { texture, width: tw, height: th } = makeLabelTexture(item.name, item.theme);
    const sprMat  = new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity: pal.spriteOpacity,
      depthTest: true, depthWrite: false,
    });
    const sprite = new THREE.Sprite(sprMat);
    const bsX = (tw / 200) * BASE_SCALE;
    const bsY = (th / 200) * BASE_SCALE;
    sprite.scale.set(bsX, bsY, 1);
    sprite.renderOrder      = 201;
    sprite.position.copy(sPos);
    sprite.userData.feature = item;
    group.add(sprite);
    const baseScale = new THREE.Vector2(bsX, bsY);

    // ── Connector line ────────────────────────────────────────────────────────
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([mPos.clone(), sPos.clone()]),
      new THREE.LineBasicMaterial({
        color: pal.lineColor, transparent: true, opacity: 0.42,
        depthTest: true, depthWrite: false,
      }),
    );
    line.renderOrder    = 199;
    line.frustumCulled  = false;
    group.add(line);

    // Pre-compute terrain normal via finite differences on the height grid (O(1) per frame)
    const dX = (sampleHeight(item.x + _HNORM_EPS, item.z) - sampleHeight(item.x - _HNORM_EPS, item.z)) / (2 * _HNORM_EPS);
    const dZ = (sampleHeight(item.x, item.z + _HNORM_EPS) - sampleHeight(item.x, item.z - _HNORM_EPS)) / (2 * _HNORM_EPS);
    const terrainNormal = new THREE.Vector3(-dX, 1, -dZ).normalize();

    interactiveObjects.push(hit, marker, sprite);
    entries.push({
      item, marker, hit, sprite, line,
      mPos: mPos.clone(), sPos: sPos.clone(),
      _baseY: surfY, terrainNormal, baseScale,
    });
  }

  // Selection ring — warm gold sphere placed on the active marker, pulsed from viewer animate loop
  const selectionRing = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: true, depthWrite: false }),
  );
  selectionRing.renderOrder = 203;
  selectionRing.visible = false;
  group.add(selectionRing);

  scene.add(group);
  return { group, entries, interactiveObjects, selectionRing };
}

// ─── Per-frame visibility update ──────────────────────────────────────────────

// Module-level reusable vectors — avoids per-frame allocations
const _ray      = new THREE.Raycaster();
const _tempM    = new THREE.Vector3();
const _tempS    = new THREE.Vector3();
const _lineP1   = new THREE.Vector3();
const _toPoint  = new THREE.Vector3();
const _toCam    = new THREE.Vector3();
const _camRight = new THREE.Vector3(); // camera screen-right direction, set once per frame

/**
 * @param {object} categoryEnabled  { settlement, fault, vent, fissure, general }
 * @param {object|null} activePopupFeature  currently open feature (always shown)
 * @param {number} currentLodLevel  1–5 density slider value; items with lod > level are hidden
 */
export function updateEtnaLabelVisibility(
  entries, camera, renderer, surfaceMesh, domainBox,
  crossSectionEnabled, clipPlane,
  categoryEnabled,
  activePopupFeature,
  currentLodLevel = 3,
) {
  const vw = renderer.domElement.clientWidth  || window.innerWidth;
  const vh = renderer.domElement.clientHeight || window.innerHeight;
  const fovScale = vh / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));

  // Only the domain box (12 triangles) goes into the occluder list.
  // Terrain self-occlusion is handled per-entry via the pre-computed terrainNormal dot product.
  const occluders = [];
  if (domainBox && domainBox.visible) occluders.push(domainBox);

  const occupiedRects = [];
  const candidates    = [];

  // Camera screen-right vector in world space — used for nudging repositioned labels
  _camRight.setFromMatrixColumn(camera.matrixWorld, 0);

  // Phase 1 — cull, scale, animate, and position each entry
  for (const entry of entries) {
    entry.marker.visible = false;
    entry.hit.visible    = false;
    entry.sprite.visible = false;
    entry.line.visible   = false;

    if (!(categoryEnabled[entry.item.theme] ?? true)) continue;
    if (entry.item.lod != null && entry.item.lod > currentLodLevel) continue;
    if (crossSectionEnabled && clipPlane && clipPlane.distanceToPoint(entry.mPos) < 0) continue;

    // Marker behind-camera check
    _tempM.copy(entry.mPos).project(camera);
    if (_tempM.z > 1) continue;

    // Terrain self-occlusion (O(1) dot-product against the pre-baked terrain normal)
    _toPoint.subVectors(entry.mPos, camera.position);
    const dist = _toPoint.length();
    _toCam.copy(_toPoint).multiplyScalar(-1 / dist);
    if (entry.terrainNormal.dot(_toCam) < 0.04) continue;

    // Domain box occlusion (cheap — only 12 triangles)
    _ray.set(camera.position, _toPoint.multiplyScalar(1 / dist));
    _ray.near = 0;
    _ray.far  = dist * 0.95;
    if (occluders.length && _ray.intersectObjects(occluders, true).length > 0) continue;

    entry.marker.visible = true;
    entry.hit.visible    = true;

    // ── Zoom-responsive pixel sizing ──────────────────────────────────────────
    // zf = 0 at global view (dist >= ZOOM_DIST_REF), = 1 at maximum zoom-in.
    // Both labels and dots grow in screen pixels as the camera gets closer,
    // giving a natural "loupe" feel that matches other GeoID viewers.
    const ppu = fovScale / Math.max(dist, 0.001);
    const zf  = 1 - THREE.MathUtils.clamp(dist / ZOOM_DIST_REF, 0, 1);
    const lodTier = _LOD_TIER_SCALE[entry.item.lod] ?? 1.0;

    const isPinned = Boolean(activePopupFeature && entry.item.name === activePopupFeature.name);

    // ── Label sprite size (zoom-responsive, no per-frame animation — viewer handles pulse) ─
    const targetPx   = (LABEL_PX_GLOBAL + zf * (LABEL_PX_CLOSE - LABEL_PX_GLOBAL)) * lodTier;
    const labelScale = targetPx / Math.max(entry.baseScale.y * ppu, 1e-6);
    entry.sprite.scale.set(
      entry.baseScale.x * labelScale,
      entry.baseScale.y * labelScale,
      1,
    );

    // ── Marker dot size (zoom-responsive only; colour/ring animation in viewer) ─
    const dotTargetPx = (DOT_PX_GLOBAL + zf * (DOT_PX_CLOSE - DOT_PX_GLOBAL)) * lodTier;
    entry.marker.scale.setScalar(dotTargetPx / Math.max(_MARKER_RADIUS * ppu, 1e-6));

    // ── Sprite world position — adaptive lift keeps line length constant in pixels ─
    // lift = LABEL_LIFT * (dist / ZOOM_DIST_REF), so lift × ppu ≈ constant:
    //   line_px ≈ LABEL_LIFT × fovScale / ZOOM_DIST_REF at every zoom level.
    // This gives a smooth, proportional connector that never jumps.
    const adaptiveLift = LABEL_LIFT * THREE.MathUtils.clamp(dist / ZOOM_DIST_REF, 0.03, 1.0);
    const aSY = entry.mPos.y + adaptiveLift;
    entry.sprite.position.set(entry.mPos.x, aSY, entry.mPos.z);
    _tempS.copy(entry.sprite.position).project(camera);

    // Marker screen position (already projected in _tempM above)
    const msx = ((_tempM.x + 1) * 0.5) * vw;
    const msy = ((1 - _tempM.y) * 0.5) * vh;

    const spriteBehind = _tempS.z > 1;
    let sx = spriteBehind ? msx : ((_tempS.x + 1) * 0.5) * vw;
    let sy = spriteBehind ? msy : ((1 - _tempS.y) * 0.5) * vh;
    const spriteOffScreen = spriteBehind || sx < -10 || sx > vw + 10 || sy < -10 || sy > vh + 10;

    if (spriteOffScreen) {
      // Fallback only: sprite is literally off-screen — nudge beside the dot
      if (msx < -20 || msx > vw + 20 || msy < -20 || msy > vh + 20) continue;

      const labelWidthPx = entry.sprite.scale.x * ppu;
      const nudgePx  = Math.max(14, labelWidthPx * 0.55);
      const nudgeDir = (msx + nudgePx < vw - 14) ? 1 : -1;
      const worldPerPx = dist / fovScale;

      _lineP1.copy(entry.mPos).addScaledVector(_camRight, nudgeDir * nudgePx * worldPerPx);
      entry.sprite.position.copy(_lineP1);

      _tempS.copy(_lineP1).project(camera);
      sx = ((_tempS.x + 1) * 0.5) * vw;
      sy = ((1 - _tempS.y) * 0.5) * vh;
    } else {
      _lineP1.set(entry.mPos.x, aSY, entry.mPos.z);
    }

    // Update connector line endpoints every frame (covers repositioning + vert-exag)
    const posAttr = entry.line.geometry.attributes.position;
    posAttr.setXYZ(0, entry.mPos.x, entry.mPos.y, entry.mPos.z);
    posAttr.setXYZ(1, _lineP1.x,    _lineP1.y,    _lineP1.z);
    posAttr.needsUpdate = true;

    const hw = entry.sprite.scale.x * ppu * 0.5;
    const hh = entry.sprite.scale.y * ppu * 0.5;

    candidates.push({
      entry, isPinned, camDist: dist,
      rect: { left: sx - hw, right: sx + hw, top: sy - hh, bottom: sy + hh },
    });
  }

  // Phase 2 — overlap rejection: nearest wins; pinned (popup-open) always shown
  candidates.sort((a, b) =>
    a.isPinned !== b.isPinned ? (a.isPinned ? -1 : 1) : a.camDist - b.camDist,
  );

  for (const { entry, isPinned, rect } of candidates) {
    const overlaps = occupiedRects.some(r =>
      rect.left - 2 < r.right  && rect.right  + 2 > r.left &&
      rect.top  - 2 < r.bottom && rect.bottom + 2 > r.top,
    );
    if (overlaps && !isPinned) continue;
    entry.sprite.visible = true;
    entry.line.visible   = true;
    occupiedRects.push(rect);
  }
}

// ─── Vertical exaggeration update ────────────────────────────────────────────

export function applyEtnaLabelVertExag(entries, factor) {
  for (const entry of entries) {
    const newY = entry._baseY * factor;
    const sY   = newY + LABEL_LIFT;   // LIFT is absolute, not scaled

    entry.mPos.y = newY;
    entry.sPos.y = sY;

    entry.marker.position.y = newY;
    entry.hit.position.y    = newY;
    entry.sprite.position.y = sY;

    const posAttr = entry.line.geometry.attributes.position;
    posAttr.setY(0, newY);
    posAttr.setY(1, sY);
    posAttr.needsUpdate = true;
    entry.line.geometry.computeBoundingSphere();
  }
}
