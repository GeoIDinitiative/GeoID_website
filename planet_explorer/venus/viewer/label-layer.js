import * as THREE from "./vendor/three.module.js";

// SIGNIFICANCE RAMPS, indexed by item.lod (1 = most significant … 5 = least).
// Index 0 is unused; items with no lod stay at 1.0.
//
// Two ramps because the two sizing paths compose differently. The world-scale
// path multiplies this by entry.baseScale, which ALREADY carries a per-tier
// multiplier baked in at build time, so the two compound and the ramp can be
// gentle-looking while landing hard. The mosaic path targets an absolute pixel
// height and cancels baseScale entirely, so its ramp is the only thing acting
// and it needs a floor that keeps lod-5 text legible.
const LOD_TIER_SCALE = [1.0, 1.0, 0.84, 0.70, 0.57, 0.44];
const LOD_MOSAIC_TIER = [1.0, 1.0, 0.88, 0.77, 0.67, 0.58];
function lodTierFactor(lod, table = LOD_TIER_SCALE) {
  const n = Number(lod);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? table[n] : 1.0;
}


function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

// Moon feature catalogs use IAU small-body convention (opposite handedness).
// moonDataLonToSceneLon flips the longitude so textures render correctly.
function _normDeg360(v) { return ((v % 360) + 360) % 360; }
function _moonDataLonToScene(lon) { return _normDeg360(360 - Number(lon || 0)); }
export function moonLatLonToVector3(latDegrees, lonDegrees, radius) {
  const lat = THREE.MathUtils.degToRad(latDegrees);
  const lon = THREE.MathUtils.degToRad(_moonDataLonToScene(lonDegrees));
  return new THREE.Vector3(
    -radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.sin(lon),
  );
}

// buildLabelLayer and updateLabelAnchors receive getReliefPoint as a parameter to avoid importing from the main module.
export function makeLabelTexture(labelInput, options = {}) {
  const isObject = typeof labelInput === "object" && labelInput !== null;
  const text = isObject ? ((labelInput.name || "").replace(/\s*\([^)]*\)\s*/g, " ").trim()) : String(labelInput);
  const theme = options.theme || (isObject ? labelInput.theme : "") || "standard";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const backingScale = options.backingScale ?? 2;
  const paddingX = 14;
  const accentWidth = 6;
  const bodyLeft = paddingX + accentWidth + 7;
  const titleFont = "600 15px Orbitron, 'Exo 2', Aldrich, 'Trebuchet MS', sans-serif";
  context.font = titleFont;
  const textWidth = Math.ceil(context.measureText(text).width);
  const logicalWidth = Math.max(110, textWidth + bodyLeft + paddingX);
  const logicalHeight = 34;
  canvas.width = logicalWidth * backingScale;
  canvas.height = logicalHeight * backingScale;
  context.scale(backingScale, backingScale);

  const palette = options.customPalette || (theme === "volcanic"
    ? {
        bg: "rgba(28, 10, 10, 0.72)",
        stroke: "rgba(255, 122, 96, 0.56)",
        accent: "rgba(255, 88, 69, 0.92)",
        title: "rgba(255, 234, 230, 0.96)",
      }
    : theme === "mission"
      ? {
          bg: "rgba(10, 22, 14, 0.74)",
          stroke: "rgba(128, 229, 160, 0.42)",
          accent: "rgba(98, 222, 132, 0.94)",
          title: "rgba(237, 255, 242, 0.96)",
        }
    : theme === "moon"
      ? {
          bg: "rgba(10, 14, 22, 1.0)",
          stroke: "rgba(255, 255, 255, 0.55)",
          accent: "rgba(255, 255, 255, 0.96)",
          title: "rgba(255, 255, 255, 1.0)",
        }
    : theme === "moon-poi"
      ? {
          bg: "rgba(9, 14, 24, 0.64)",
          stroke: "rgba(90, 214, 233, 0.52)",
          accent: "rgba(58, 238, 232, 1)",
          title: "rgba(255, 255, 255, 0.96)",
        }
    : theme === "habitation"
      ? {
          bg: "rgba(8, 20, 11, 0.74)",
          stroke: "rgba(112, 232, 146, 0.46)",
          accent: "rgba(92, 222, 118, 0.96)",
          title: "rgba(234, 255, 238, 0.96)",
        }
    : theme === "crater"
      ? {
          bg: "rgba(28, 8, 18, 0.74)",
          stroke: "rgba(255, 95, 170, 0.50)",
          accent: "rgba(255, 95, 170, 0.92)",
          title: "rgba(255, 228, 242, 0.96)",
        }
    : theme === "landing"
      ? {
          bg: "rgba(22, 20, 0, 0.78)",
          stroke: "rgba(255, 229, 0, 0.58)",
          accent: "rgba(255, 229, 0, 0.96)",
          title: "rgba(255, 252, 200, 0.96)",
        }
    : theme === "tectonic"
      ? {
          bg: "rgba(18, 10, 4, 0.76)",
          stroke: "rgba(184, 115, 51, 0.50)",
          accent: "rgba(184, 115, 51, 0.92)",
          title: "rgba(255, 235, 210, 0.96)",
        }
    : theme === "fluvial"
      ? {
          bg: "rgba(4, 10, 26, 0.78)",
          stroke: "rgba(26, 95, 191, 0.56)",
          accent: "rgba(26, 95, 191, 0.92)",
          title: "rgba(204, 220, 255, 0.96)",
        }
    : {
        bg: "rgba(9, 14, 24, 0.62)",
        stroke: "rgba(90, 214, 233, 0.28)",
        accent: "rgba(58, 214, 208, 0.92)",
        title: "rgba(242, 247, 250, 0.94)",
      });

  context.textBaseline = "middle";
  context.fillStyle = palette.bg;
  context.strokeStyle = palette.stroke;
  context.lineWidth = 1.6;
  const radius = 14;
  context.beginPath();
  context.moveTo(radius, 1);
  context.lineTo(logicalWidth - radius, 1);
  context.quadraticCurveTo(logicalWidth - 1, 1, logicalWidth - 1, radius);
  context.lineTo(logicalWidth - 1, logicalHeight - radius - 1);
  context.quadraticCurveTo(logicalWidth - 1, logicalHeight - 1, logicalWidth - radius, logicalHeight - 1);
  context.lineTo(radius, logicalHeight - 1);
  context.quadraticCurveTo(1, logicalHeight - 1, 1, logicalHeight - radius);
  context.lineTo(1, radius);
  context.quadraticCurveTo(1, 1, radius, 1);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = palette.accent;
  context.beginPath();
  context.moveTo(radius + 1, 4);
  context.lineTo(radius + accentWidth, 4);
  context.lineTo(radius + accentWidth, logicalHeight - 4);
  context.lineTo(radius + 1, logicalHeight - 4);
  context.closePath();
  context.fill();

  context.font = titleFont;
  context.fillStyle = palette.title;
  context.fillText(text, bodyLeft, logicalHeight / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  // Release the CPU canvas backing store after the first GPU upload.
  texture.onUpdate = () => { texture.image = null; texture.onUpdate = null; };
  return { texture, width: logicalWidth, height: logicalHeight };
}


function isPointOccludedByPlanet(pointLocal, marsGroup, camera, bodyRadius = 3.2) {
  const inverseWorld = marsGroup.matrixWorld.clone().invert();
  const cameraLocal = camera.position.clone().applyMatrix4(inverseWorld);
  const anchorLocal = pointLocal.clone();
  const ray = anchorLocal.clone().sub(cameraLocal);
  const segmentLength = ray.length();
  if (segmentLength <= 1e-5) {
    return false;
  }
  ray.divideScalar(segmentLength);
  const b = 2 * cameraLocal.dot(ray);
  const c = cameraLocal.lengthSq() - (bodyRadius * bodyRadius);
  const discriminant = (b * b) - (4 * c);
  if (discriminant <= 0) {
    return false;
  }
  const root = Math.sqrt(discriminant);
  const near = (-b - root) * 0.5;
  const far = (-b + root) * 0.5;
  const epsilon = 1e-4;
  return (near > epsilon && near < segmentLength - epsilon)
    || (far > epsilon && far < segmentLength - epsilon);
}

export function buildMoonLayer(textureMap, moonData, moonOrbitEccentricity = {}) {
  const group = new THREE.Group();
  const orbitGroup = new THREE.Group();
  const labelGroup = new THREE.Group();
  group.add(orbitGroup);
  group.add(labelGroup);
  const entries = [];
  const interactiveObjects = [];

  function getMoonOrbitPoint(semiMajorAxis, eccentricity, theta, y = 0) {
    const semiMinorAxis = semiMajorAxis * Math.sqrt(Math.max(0, 1 - eccentricity * eccentricity));
    return new THREE.Vector3(
      Math.cos(theta) * semiMajorAxis,
      y,
      Math.sin(theta) * semiMinorAxis,
    );
  }

  for (const item of moonData) {
    const anchor = new THREE.Vector3(item.moon_anchor[0], item.moon_anchor[1], item.moon_anchor[2]);
    const moonRadius = Number(item.moon_radius || 0.09);
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(moonRadius, 96, 96),
      new THREE.MeshStandardMaterial({
        map: textureMap.get(item.name) || null,
        color: new THREE.Color(textureMap.get(item.name) ? "#ffffff" : (item.moon_color || "#d8d2c8")),
        roughness: 0.96,
        metalness: 0.02,
        transparent: false,
        opacity: 1,
        depthTest: true,
        depthWrite: true,
      }),
    );
    moonMesh.position.copy(anchor);
    moonMesh.userData.feature = item;
    group.add(moonMesh);

    const orbitRadius = Math.hypot(anchor.x, anchor.z);
    const orbitEccentricity = Number(item.orbit_eccentricity ?? moonOrbitEccentricity[item.name] ?? 0);
    const orbitSemiMinorAxis = orbitRadius * Math.sqrt(Math.max(0, 1 - orbitEccentricity * orbitEccentricity));
    const initialAngle = Math.atan2(orbitSemiMinorAxis > 0 ? (anchor.z / orbitSemiMinorAxis) : anchor.z, anchor.x / orbitRadius);
    const orbitPoints = [];
    for (let i = 0; i <= 128; i += 1) {
      const theta = (i / 128) * Math.PI * 2;
      orbitPoints.push(getMoonOrbitPoint(orbitRadius, orbitEccentricity, theta, anchor.y));
    }
    const orbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(orbitPoints),
      new THREE.LineBasicMaterial({
        color: 0x8ea5b8,
        transparent: true,
        opacity: 0.18,
      }),
    );
    orbitGroup.add(orbitLine);

    const label = makeLabelTexture(item, { theme: "moon" });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: label.texture,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
    }));
    sprite.renderOrder = 300;
    sprite.scale.set((label.width / 200) * 0.42, (label.height / 200) * 0.42, 1);
    const baseScale = sprite.scale.clone();
    const lift = Number(item.moon_label_lift || 0.24);
    const labelPos = anchor.clone().add(new THREE.Vector3(0, lift, 0));
    sprite.position.copy(labelPos);
    sprite.userData.feature = item;
    labelGroup.add(sprite);

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        anchor.clone().add(new THREE.Vector3(0, moonRadius * 0.4, 0)),
        labelPos.clone().add(new THREE.Vector3(0, -0.06, 0)),
      ]),
      new THREE.LineBasicMaterial({
        color: 0xd9e4ef,
        transparent: true,
        opacity: 0.36,
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.renderOrder = 210;
    labelGroup.add(line);

    interactiveObjects.push(moonMesh, sprite);
    entries.push({ moonMesh, sprite, line, orbitLine, item, anchor, orbitRadius, orbitEccentricity, orbitSemiMinorAxis, initialAngle, moonRadius, lift, baseScale, priority: 6 });
  }

  return { group, orbitGroup, labelGroup, entries, interactiveObjects };
}

export function isVolcanicMoonFeature(item) {
  const content = [
    item.theme,
    item.type,
    item.name,
    item.description,
    item.origin,
    item.interpretation,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(?:cryo)?volcan|patera|caldera|plume|vent|eruption|lava|basalt|fluctus|tholus|corona|farrum/.test(content);
}

export function isCraterMoonFeature(item) {
  const t = String(item && item.type || "").toLowerCase().trim();
  return t === "impact crater" || t === "crater";
}

export function isTectonicMoonFeature(item) {
  const t = String(item && item.type || "").toLowerCase().trim();
  return /^(chasma|fossa|sulcus|rupes|dorsum|cavus|labyrinthus|linea|scopulus|tessera|graben)$/.test(t);
}

export function isFluvialMoonFeature(item) {
  const t = String(item && item.type || "").toLowerCase().trim();
  return /^(vallis|catena|flumen|rima)$/.test(t);
}

export function classifyMoonFeature(item) {
  if (isVolcanicMoonFeature(item)) return "volcanic";
  if (isCraterMoonFeature(item))   return "crater";
  if (isFluvialMoonFeature(item))  return "fluvial";
  if (isTectonicMoonFeature(item)) return "tectonic";
  return "moon-feature";
}


export function getMoonFeatureConnectorStart(markerPoint, labelPoint, moonRadius) {
  return markerPoint.clone();
}

export function buildMoonFeatureLabelLayer(moonData, moonFeatureData) {
  const group = new THREE.Group();
  const entries = [];
  const interactiveObjects = [];
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });

  for (const item of moonFeatureData) {
    const parentMoon = moonData.find((moon) => moon.name === item.moon_name);
    if (!parentMoon || !Array.isArray(parentMoon.moon_anchor)) {
      continue;
    }
    const lat = item.lat !== undefined ? item.lat : item.anchor_lat;
    const lon = item.lon !== undefined ? item.lon : item.anchor_lon;
    if (lat === undefined || lon === undefined) {
      continue;
    }
    const moonAnchor = new THREE.Vector3(parentMoon.moon_anchor[0], parentMoon.moon_anchor[1], parentMoon.moon_anchor[2]);
    const moonRadius = Number(parentMoon.moon_radius || 0.1);
    const markerR = moonRadius * 0.01;
    const hitR = moonRadius * 0.08;
    const labelDistance = moonRadius * 0.12;
    const anchor = moonLatLonToVector3(lat, lon, moonRadius + moonRadius * 0.02).add(moonAnchor);
    const hitPoint = anchor.clone();
    const surfacePoint = moonLatLonToVector3(lat, lon, moonRadius).add(moonAnchor);
    const normal = anchor.clone().sub(moonAnchor).normalize();
    const east = new THREE.Vector3(-normal.z, 0, normal.x);
    if (east.lengthSq() < 0.0001) {
      east.set(1, 0, 0);
    }
    east.normalize();
    const up = normal.clone().cross(east).normalize();
    const direction = normal.clone().multiplyScalar(0.82).addScaledVector(east, lat >= 0 ? 0.36 : -0.36).addScaledVector(up, lat > 35 ? -0.08 : 0.06).normalize();
    const labelPos = anchor.clone().addScaledVector(normal, moonRadius * 0.12).addScaledVector(direction, labelDistance);
    const relMarkerPos = anchor.clone().sub(moonAnchor);
    const relHitPos = hitPoint.clone().sub(moonAnchor);
    const relSurfacePoint = surfacePoint.clone().sub(moonAnchor);
    const relLabelPos = labelPos.clone().sub(moonAnchor);

    const _CAT_PALETTE = {
      "volcanic":     { marker: 0xff5849, line: 0xff7e6a, theme: "volcanic" },
      "crater":       { marker: 0xff5faa, line: 0xff82c0, theme: "crater" },
      "tectonic":     { marker: 0xd4965a, line: 0xe6b07a, theme: "tectonic" },
      "fluvial":      { marker: 0x2d78e0, line: 0x6aa6f2, theme: "fluvial" },
      "moon-feature": { marker: 0x4fe0db, line: 0x7be7e3, theme: "moon-poi" },
    };
    const _featCategory = classifyMoonFeature(item);
    const _pal = _CAT_PALETTE[_featCategory] || _CAT_PALETTE["moon-feature"];
    const isCrater = _featCategory === "crater";
    const markerColor = _pal.marker;
    const lineColor   = _pal.line;
    const labelTheme  = _pal.theme;

    const marker = new THREE.Mesh(new THREE.SphereGeometry(markerR, 10, 10), new THREE.MeshBasicMaterial({
      color: markerColor,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    }));
    marker.renderOrder = 210;
    marker.position.copy(anchor);
    marker.userData.feature = item;
    group.add(marker);

    const hitTarget = new THREE.Mesh(new THREE.SphereGeometry(hitR, 12, 12), hitMaterial);
    hitTarget.renderOrder = 212;
    hitTarget.position.copy(hitPoint);
    hitTarget.userData.feature = item;
    group.add(hitTarget);

    const label = makeLabelTexture(item, { theme: labelTheme });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: label.texture,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    }));
    sprite.renderOrder = 211;
    sprite.scale.set((label.width / 200) * moonRadius * 0.35, (label.height / 200) * moonRadius * 0.35, 1);
    sprite.position.copy(labelPos);
    sprite.userData.feature = item;
    group.add(sprite);

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        getMoonFeatureConnectorStart(anchor, labelPos, moonRadius),
        labelPos.clone(),
      ]),
      new THREE.LineBasicMaterial({
        color: lineColor,
        transparent: true,
        opacity: 0.42,
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.renderOrder = 210;
    line.frustumCulled = false;
    group.add(line);

    const category = _featCategory;
    interactiveObjects.push(hitTarget, marker, sprite);
    entries.push({ item, parentMoon, moonAnchor, marker, hitTarget, sprite, line, surfacePoint, relMarkerPos, relHitPos, relSurfacePoint, relLabelPos, rel0MarkerPos: relMarkerPos.clone(), rel0HitPos: relHitPos.clone(), rel0SurfacePoint: relSurfacePoint.clone(), rel0LabelPos: relLabelPos.clone(), category, priority: 5 });
  }

  return { group, entries, interactiveObjects };
}

export function updateMoonFeatureLabelVisibility(entries, marsGroup, camera, renderer, activeMoonFeature, volcanicEnabled = true, landingEnabled = true, habitationEnabled = true, craterEnabled = true, activePopupFeature = null, isPointOccludedByAnyMoon = () => false) {
  const projected = new THREE.Vector3();
  const moonCenterWorld = new THREE.Vector3();
  const surfaceWorldPosition = new THREE.Vector3();
  const spriteWorldPosition = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const connectorStart = new THREE.Vector3();
  const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
  const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
  const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
  const occupiedRects = [];
  const candidates = [];

  for (const entry of entries) {
    const isActiveMoon = Boolean(activeMoonFeature) && entry.parentMoon.name === activeMoonFeature.name;
    entry.marker.visible = false;
    entry.hitTarget.visible = false;
    entry.sprite.visible = false;
    entry.line.visible = false;
    const categoryEnabled = entry.category === "volcanic" ? volcanicEnabled
      : entry.category === "landing" || entry.category === "mission" ? landingEnabled
      : entry.category === "habitation" ? habitationEnabled
      : entry.category === "crater" ? (craterEnabled)
      : true;
    if (!isActiveMoon || !categoryEnabled) {
      continue;
    }
    moonCenterWorld.copy(entry.moonAnchor).applyMatrix4(marsGroup.matrixWorld);
    surfaceWorldPosition.copy(entry.surfacePoint).applyMatrix4(marsGroup.matrixWorld);
    cameraDirection.copy(camera.position).sub(surfaceWorldPosition).normalize();
    const normal = surfaceWorldPosition.clone().sub(moonCenterWorld).normalize();
    // In moon-viewer mode at close range, tighten backface culling to avoid limb labels
    const _moonCamDist = camera.position.distanceTo(moonCenterWorld);
    const _moonRelDist = _moonCamDist / Math.max(entry.parentMoon?.moon_radius || 0.001, 0.001);
    const _minNormalDot = (activeMoonFeature && _moonRelDist < 2.5)
      ? Math.min(0.25, (2.5 - _moonRelDist) * 0.12)
      : 0.02;
    if (normal.dot(cameraDirection) <= _minNormalDot) {
      continue;
    }
    if (isPointOccludedByAnyMoon(surfaceWorldPosition, camera, entry.parentMoon.name)) {
      continue;
    }
    entry.marker.visible = true;
    entry.hitTarget.visible = true;
    // Cap marker dot pixel radius in moon-viewer mode to keep it proportional at close zoom
    if (activeMoonFeature) {
      if (entry.marker.userData._baseMSX === undefined) {
        entry.marker.userData._baseMSX = entry.marker.scale.x;
        entry.marker.userData._baseMSY = entry.marker.scale.y;
        entry.marker.userData._baseMSZ = entry.marker.scale.z;
      } else {
        entry.marker.scale.set(entry.marker.userData._baseMSX, entry.marker.userData._baseMSY, entry.marker.userData._baseMSZ);
      }
      const _geomR = entry.marker.geometry?.parameters?.radius ?? 0.001;
      const _markerDist = Math.max(camera.position.distanceTo(surfaceWorldPosition), 0.001);
      const _markerRadiusPx = _geomR * entry.marker.scale.x * (fovScale / _markerDist);
      if (_markerRadiusPx > 8) {
        entry.marker.scale.setScalar(8 / _markerRadiusPx);
      }
    }
    entry.sprite.getWorldPosition(spriteWorldPosition);
    if (isPointOccludedByAnyMoon(spriteWorldPosition, camera, entry.parentMoon.name)) {
      entry.marker.visible = false;
      entry.hitTarget.visible = false;
      continue;
    }
    // Persist original scale so close-zoom capping is reversible when zooming back out
    if (entry.sprite.userData._baseSX === undefined) {
      entry.sprite.userData._baseSX = entry.sprite.scale.x;
      entry.sprite.userData._baseSY = entry.sprite.scale.y;
    } else {
      entry.sprite.scale.set(entry.sprite.userData._baseSX, entry.sprite.userData._baseSY, 1);
    }
    // In moon-viewer mode, cap sprite pixel height so labels stay readable at any zoom.
    // Use surface point distance as a stable reference — the sprite may be just behind
    // the camera near-clip plane making its own distance unreliably small.
    if (activeMoonFeature) {
      const _refDist = Math.max(camera.position.distanceTo(surfaceWorldPosition), 0.001);
      const _renderedH = entry.sprite.userData._baseSY * (fovScale / _refDist);
      if (_renderedH > 24) {
        const _r = 24 / _renderedH;
        entry.sprite.scale.set(entry.sprite.userData._baseSX * _r, entry.sprite.userData._baseSY * _r, 1);
      }
    }
    projected.copy(spriteWorldPosition).project(camera);
    if (projected.z < -1 || projected.z > 1) {
      if (!activeMoonFeature) {
        entry.marker.visible = false;
        entry.hitTarget.visible = false;
        continue;
      }
      // Sprite is behind the camera at max zoom — reposition it next to the surface marker
      const anchorProj = surfaceWorldPosition.clone().project(camera);
      if (anchorProj.z < -1 || anchorProj.z > 1) continue;
      const anchorSX = ((anchorProj.x + 1) * 0.5) * viewportWidth;
      const anchorSY = ((1 - anchorProj.y) * 0.5) * viewportHeight;
      if (anchorSX < 0 || anchorSX > viewportWidth || anchorSY < 0 || anchorSY > viewportHeight) continue;
      const _nudgePPU = fovScale / Math.max(camera.position.distanceTo(surfaceWorldPosition), 0.001);
      const nudgePx = Math.max(12, entry.sprite.scale.x * _nudgePPU * 0.7);
      const nudgeX = (anchorSX + nudgePx < viewportWidth - 12) ? nudgePx : -nudgePx;
      const nudgeSX = Math.max(12, Math.min(viewportWidth - 12, anchorSX + nudgeX));
      const nudgeSY = Math.max(12, Math.min(viewportHeight - 12, anchorSY));
      const repositioned = new THREE.Vector3(
        (nudgeSX / viewportWidth) * 2 - 1,
        1 - (nudgeSY / viewportHeight) * 2,
        anchorProj.z,
      ).unproject(camera);
      const localRepositioned = marsGroup.worldToLocal(repositioned.clone());
      entry.sprite.position.copy(localRepositioned);
      if (entry.line?.geometry?.attributes?.position) {
        const fp = entry.line.geometry.attributes.position.array;
        fp[3] = localRepositioned.x; fp[4] = localRepositioned.y; fp[5] = localRepositioned.z;
        entry.line.geometry.attributes.position.needsUpdate = true;
      }
      spriteWorldPosition.copy(repositioned);
      projected.set(
        (nudgeSX / viewportWidth) * 2 - 1,
        1 - (nudgeSY / viewportHeight) * 2,
        anchorProj.z,
      );
    }
    const distance = camera.position.distanceTo(spriteWorldPosition);
    const pixelsPerWorldUnit = fovScale / Math.max(distance, 0.001);
    const rectWidth = Math.max(88, entry.sprite.scale.x * pixelsPerWorldUnit * 1.02);
    const rectHeight = Math.max(26, entry.sprite.scale.y * pixelsPerWorldUnit * 1.06);
    const screenX = ((projected.x + 1) * 0.5) * viewportWidth;
    const screenY = ((1 - projected.y) * 0.5) * viewportHeight;
    candidates.push({
      entry,
      distance,
      rect: {
        left: screenX - rectWidth * 0.5,
        right: screenX + rectWidth * 0.5,
        top: screenY - rectHeight * 0.5,
        bottom: screenY + rectHeight * 0.5,
      },
    });
  }

  candidates.sort((a, b) => {
    const aPinned = Boolean(activePopupFeature && a.entry.item.name === activePopupFeature.name);
    const bPinned = Boolean(activePopupFeature && b.entry.item.name === activePopupFeature.name);
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }
    return a.distance - b.distance;
  });
  for (const candidate of candidates) {
    const isPinned = Boolean(activePopupFeature && candidate.entry.item.name === activePopupFeature.name);
    const overlaps = occupiedRects.some((rect) => (
      candidate.rect.left - 2 < rect.right &&
      candidate.rect.right + 2 > rect.left &&
      candidate.rect.top - 2 < rect.bottom &&
      candidate.rect.bottom + 2 > rect.top
    ));
    if (overlaps && !isPinned) {
      continue;
    }
    candidate.entry.sprite.visible = true;
    candidate.entry.line.visible = true;
    connectorStart.copy(getMoonFeatureConnectorStart(
      candidate.entry.marker.position,
      candidate.entry.sprite.position,
      candidate.entry.parentMoon?.moon_radius,
    ));
    const _mlp = candidate.entry.line.geometry.attributes.position;
    _mlp.array[0] = connectorStart.x; _mlp.array[1] = connectorStart.y; _mlp.array[2] = connectorStart.z;
    _mlp.array[3] = candidate.entry.sprite.position.x; _mlp.array[4] = candidate.entry.sprite.position.y; _mlp.array[5] = candidate.entry.sprite.position.z;
    _mlp.needsUpdate = true;
    candidate.entry.line.geometry.computeBoundingSphere();
    occupiedRects.push(candidate.rect);
  }
}

export function updateMoonVisibility(entries, marsGroup, camera, renderer, moonsEnabled, labelsEnabled, activeMoonViewerFeature = null, isPointOccludedByAnyMoon = () => false) {
  const projected = new THREE.Vector3();
  const moonWorldPosition = new THREE.Vector3();
  const spriteWorldPosition = new THREE.Vector3();
  const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
  const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
  const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
  const occupiedRects = [];
  const candidates = [];
  const activeMoonName = activeMoonViewerFeature?.name || null;

  for (const entry of entries) {
    const isMoonViewerFocus = Boolean(activeMoonViewerFeature) && entry.item?.name === activeMoonViewerFeature.name;
    const labelScaleFactor = isMoonViewerFocus ? 0.58 : 1;
    entry.orbitLine.visible = moonsEnabled && (!activeMoonName || isMoonViewerFocus);
    entry.sprite.visible = false;
    entry.line.visible = false;
    if (entry.baseScale) {
      entry.sprite.scale.set(
        entry.baseScale.x * labelScaleFactor,
        entry.baseScale.y * labelScaleFactor,
        1,
      );
    }
    if (!isMoonViewerFocus && isPointOccludedByPlanet(entry.moonMesh.position, marsGroup, camera)) {
      entry.moonMesh.visible = false;
      continue;
    }

    moonWorldPosition.copy(entry.moonMesh.position).applyMatrix4(marsGroup.matrixWorld);
    projected.copy(moonWorldPosition).project(camera);
    if (projected.z < -1 || projected.z > 1) {
      entry.moonMesh.visible = false;
      entry.orbitLine.visible = false;
      continue;
    }
    entry.moonMesh.visible = true;
    if (!moonsEnabled || !labelsEnabled) {
      continue;
    }

    spriteWorldPosition.copy(entry.sprite.position).applyMatrix4(marsGroup.matrixWorld);
    if (isPointOccludedByAnyMoon(spriteWorldPosition, camera)) {
      continue;
    }
    projected.copy(spriteWorldPosition).project(camera);
    if (projected.z < -1 || projected.z > 1) {
      continue;
    }
    const distance = camera.position.distanceTo(spriteWorldPosition);
    const pixelsPerWorldUnit = fovScale / Math.max(distance, 0.001);
    const rectWidth = entry.sprite.scale.x * pixelsPerWorldUnit * 1.02;
    const rectHeight = entry.sprite.scale.y * pixelsPerWorldUnit * 1.06;
    const screenX = ((projected.x + 1) * 0.5) * viewportWidth;
    const screenY = ((1 - projected.y) * 0.5) * viewportHeight;
    candidates.push({
      entry,
      distance,
      rect: {
        left: screenX - rectWidth * 0.5,
        right: screenX + rectWidth * 0.5,
        top: screenY - rectHeight * 0.5,
        bottom: screenY + rectHeight * 0.5,
      },
    });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    const overlaps = occupiedRects.some((rect) => (
      candidate.rect.left - 3 < rect.right &&
      candidate.rect.right + 3 > rect.left &&
      candidate.rect.top - 2 < rect.bottom &&
      candidate.rect.bottom + 2 > rect.top
    ));
    if (overlaps && candidate.entry.category !== "volcanic") {
      continue;
    }
    candidate.entry.sprite.visible = true;
    candidate.entry.line.visible = !(activeMoonViewerFeature && candidate.entry.item?.name === activeMoonViewerFeature.name);
    occupiedRects.push(candidate.rect);
  }
}

export function buildLabelLayer(radius, elevationSampler, elevationCache, getTerrainRelief, getReliefPoint, labelData) {
  const group = new THREE.Group();
  const markerGeometry = new THREE.SphereGeometry(0.011, 10, 10);
  const hitGeometry = new THREE.SphereGeometry(0.18, 14, 14);
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const entries = [];
  const interactiveObjects = [];

  function sampleLabelSurfacePoint(latDegrees, lonDegrees, lift = 0) {
    return getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, latDegrees, lonDegrees, lift);
  }

  function labelThemeStyle(theme) {
    if (theme === "volcanic") {
      return { markerColor: 0xff735d, lineColor: 0xff8c73, spriteOpacity: 0.94, priority: 4, category: "volcanic" };
    }
    if (theme === "landing") {
      return { markerColor: 0xffe500, lineColor: 0xffed4d, spriteOpacity: 0.95, priority: 6, category: "landing" };
    }
    if (theme === "mission") {
      return { markerColor: 0x63dc86, lineColor: 0x82ef9f, spriteOpacity: 0.92, priority: 5, category: "mission" };
    }
    if (theme === "habitation") {
      return { markerColor: 0x65dc78, lineColor: 0x86f19a, spriteOpacity: 0.94, priority: 5, category: "habitation" };
    }
    if (theme === "crater") {
      return { markerColor: 0xff5faa, lineColor: 0xff82c0, spriteOpacity: 0.86, priority: 2, category: "crater" };
    }
    if (theme === "fluvial") {
      return { markerColor: 0x1a5fbf, lineColor: 0x2d78e0, spriteOpacity: 0.86, priority: 3, category: "fluvial" };
    }
    if (theme === "tectonic") {
      return { markerColor: 0xb87333, lineColor: 0xd4965a, spriteOpacity: 0.86, priority: 3, category: "tectonic" };
    }
    return { markerColor: 0x34d7d1, lineColor: 0x46d7d1, spriteOpacity: 0.82, priority: 1, category: "surface" };
  }

  // Build Three.js scene objects for one entry on first visibility.
  // Defers ~21 MB of Object3D allocation until labels are actually needed.
  function buildEntry(entry) {
    const item = entry.item;
    const style = entry._style;
    const anchor = entry.labelAnchor;
    const hitPoint = sampleLabelSurfacePoint(item.lat, item.lon, 0.002);
    const spritePos = anchor.clone()
      .addScaledVector(entry.labelNormal, 0.22)
      .addScaledVector(entry.labelDirection, entry.labelDistance)
      .addScaledVector(entry.labelUp, entry.labelPushUp)
      .addScaledVector(entry.labelEast, entry.labelPushEast);

    const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
      color: style.markerColor,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    }));
    marker.position.copy(anchor);
    marker.renderOrder = 200;
    marker.userData.feature = item;
    group.add(marker);

    const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial);
    hitTarget.position.copy(hitPoint);
    hitTarget.renderOrder = 202;
    hitTarget.userData.feature = item;
    group.add(hitTarget);

    const spriteMaterial = new THREE.SpriteMaterial({
      map: null,
      transparent: true,
      opacity: style.spriteOpacity,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set((110 / 200) * 0.66, (34 / 200) * 0.66, 1);
    sprite.renderOrder = 201;
    sprite.position.copy(spritePos);
    sprite.userData.feature = item;
    group.add(sprite);

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([anchor.clone(), spritePos.clone()]),
      new THREE.LineBasicMaterial({
        color: style.lineColor,
        transparent: true,
        opacity: 0.42,
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.renderOrder = 199;
    group.add(line);

    interactiveObjects.push(hitTarget, marker, sprite);

    entry.marker = marker;
    entry.hitTarget = hitTarget;
    entry.sprite = sprite;
    entry.line = line;
    // Tier-aware label sizing: more prominent (lower-lod) features render larger.
    // tier 1 = 1.55×, tier 2 = 1.30×, tier 3 = 1.10×, tier 4 = 1.00×, tier 5 = 0.88×.
    const _lodForScale = item?.lod;
    const _lodScaleMult = _lodForScale === 1 ? 1.55
                        : _lodForScale === 2 ? 1.30
                        : _lodForScale === 3 ? 1.10
                        : _lodForScale === 5 ? 0.88
                        : 1.00;
    sprite.scale.set(sprite.scale.x * _lodScaleMult, sprite.scale.y * _lodScaleMult, 1);
    entry.baseScale = sprite.scale.clone();
    entry.markerBaseScale = marker.scale.clone();
    entry.hitBaseScale = hitTarget.scale.clone();
    entry._built = true;
    entries._builtCount = (entries._builtCount || 0) + 1;
    // Keep _style so disposeEntry can rebuild later.
  }
  entries._buildEntry = buildEntry;
  entries._builtCount = 0;

  // Reverse of buildEntry: remove Three.js objects from scene and free WebGL resources.
  // Called when a label has been off-screen long enough that the memory is worth reclaiming.
  function disposeEntry(entry) {
    if (!entry._built) return;
    group.remove(entry.marker);
    group.remove(entry.hitTarget);
    group.remove(entry.sprite);
    group.remove(entry.line);
    const io = interactiveObjects;
    let i = io.indexOf(entry.hitTarget); if (i !== -1) io.splice(i, 1);
    i = io.indexOf(entry.marker);    if (i !== -1) io.splice(i, 1);
    i = io.indexOf(entry.sprite);    if (i !== -1) io.splice(i, 1);
    if (entry.sprite.material.map) {
      entry.sprite.material.map.image = null;
      entry.sprite.material.map.dispose();
    }
    entry.sprite.material.dispose();
    entry.line.geometry.dispose();
    entry.line.material.dispose();
    entry.marker.material.dispose();
    entry.marker = null;
    entry.hitTarget = null;
    entry.sprite = null;
    entry.line = null;
    entry.baseScale = null;
    entry.markerBaseScale = null;
    entry.hitBaseScale = null;
    entry._built = false;
    entry._lastVisibleAt = null;
    entry._pc = null;
    entries._builtCount = Math.max(0, (entries._builtCount || 0) - 1);
  }
  entries._disposeEntry = disposeEntry;

  let sortIndex = 0;
  for (const item of labelData) {
    const style = labelThemeStyle(item.theme);
    const anchor = sampleLabelSurfacePoint(item.lat, item.lon, 0.0);
    const normal = anchor.clone().normalize();
    const east = new THREE.Vector3(-normal.z, 0, normal.x);
    if (east.lengthSq() < 0.0001) {
      east.set(1, 0, 0);
    }
    east.normalize();
    const up = normal.clone().cross(east).normalize();
    const direction = item.lat >= 0 ? east.clone().multiplyScalar(1.0) : east.clone().multiplyScalar(-1.0);
    direction.addScaledVector(up, item.lat > 35 ? -0.28 : 0.18).normalize();
    const labelDistance = item.label_distance !== undefined ? item.label_distance : 0.52;

    entries.push({
      marker: null,
      hitTarget: null,
      sprite: null,
      line: null,
      surfacePoint: anchor.clone(),
      item,
      priority: style.priority,
      category: style.category,
      baseScale: null,
      labelDistance,
      labelPushUp: item.label_push_up || 0,
      labelPushEast: item.label_push_east || 0,
      labelOffsetFactor: 1,
      labelAnchor: anchor.clone(),
      labelNormal: normal.clone(),
      labelDirection: direction.clone(),
      labelUp: up.clone(),
      labelEast: east.clone(),
      markerBaseScale: null,
      markerRadiusWorld: 0.011,
      hitBaseScale: null,
      hitRadiusWorld: 0.18,
      sortIndex,
      _globalVisible: false,
      _labelDeferred: true,
      _lastVisibleAt: null,
      _built: false,
      _style: style,
    });
    sortIndex += 1;
  }

  return { group, entries, interactiveObjects };
}

const USER_PIN_WORLD_HEIGHT = 0.028;
const USER_PIN_LABEL_DISTANCE = 0.14;
const CTX_MOSAIC_MIN_SCALEBAR_METERS = 1000;

function getUserPinTargetPixelSize(scaleBarMeters = null) {
  return 14;
}

export function getEntryConnectorStart(entry) {
  const isUserPin = entry?.item?.type === "User pin" || entry?.item?.type === "Imported pin";
  if (isUserPin && entry?.marker?.position) {
    return entry.marker.position.clone();
  }
  if (entry?.labelAnchor) {
    return entry.labelAnchor.clone();
  }
  if (entry?.marker?.position) {
    return entry.marker.position.clone();
  }
  return new THREE.Vector3();
}

export function updateLabelAnchors(labelLayer, elevationSampler, elevationCache, getTerrainRelief, radius = 3.2, getReliefPoint) {
  if (!labelLayer || !labelLayer.entries) {
    return;
  }
  for (const entry of labelLayer.entries) {
    const item = entry.item;
    const anchor = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, item.lat, item.lon, 0);
    const hitPoint = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, item.lat, item.lon, 0.01);
    const surfacePoint = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, item.lat, item.lon, 0);
    const normal = anchor.clone().normalize();
    const isUserPin = item?.type === "User pin" || item?.type === "Imported pin";
    const east = new THREE.Vector3(-normal.z, 0, normal.x);
    if (east.lengthSq() < 0.0001) {
      east.set(1, 0, 0);
    }
    east.normalize();
    const up = normal.clone().cross(east).normalize();
    const direction = isUserPin
      ? normal.clone()
      : item.lat >= 0 ? east.clone().multiplyScalar(1.0) : east.clone().multiplyScalar(-1.0);
    if (!isUserPin) {
      direction.addScaledVector(up, item.lat > 35 ? -0.28 : 0.18).normalize();
    }
    const labelDistance = item.label_distance !== undefined ? item.label_distance : (isUserPin ? USER_PIN_LABEL_DISTANCE : 0.52);
    const pinHeadPos = anchor.clone().addScaledVector(normal, isUserPin ? USER_PIN_WORLD_HEIGHT * 0.72 : 0);
    const spritePos = isUserPin
      ? pinHeadPos.clone().addScaledVector(normal, labelDistance)
      : anchor.clone().addScaledVector(normal, 0.22).addScaledVector(direction, labelDistance)
        .addScaledVector(up, item.label_push_up || 0)
        .addScaledVector(east, item.label_push_east || 0);

    if (entry.marker) entry.marker.position.copy(anchor);
    if (entry.hitTarget) entry.hitTarget.position.copy(hitPoint);
    if (entry.sprite) entry.sprite.position.copy(spritePos);
    entry.surfacePoint.copy(surfacePoint);
    entry.labelDistance = labelDistance;
    entry.labelPushUp = isUserPin ? 0 : (item.label_push_up || 0);
    entry.labelPushEast = isUserPin ? 0 : (item.label_push_east || 0);
    entry.labelAnchor = isUserPin ? pinHeadPos.clone() : anchor.clone();
    entry.labelNormal = normal.clone();
    entry.labelDirection = direction.clone();
    entry.labelUp = isUserPin ? normal.clone() : up.clone();
    entry.labelEast = east.clone();
    if (entry.line) {
      const connectorStart = getEntryConnectorStart(entry);
      entry.line.geometry.dispose();
      entry.line.geometry = new THREE.BufferGeometry().setFromPoints([
        connectorStart,
        isUserPin
          ? spritePos.clone().addScaledVector(normal, -Math.min(0.03, labelDistance * 0.18))
          : spritePos.clone(),
      ]);
    }
  }
}

export function rebuildLabelTextures(labelLayer) {
  if (!labelLayer || !labelLayer.entries) {
    return;
  }
  for (const entry of labelLayer.entries) {
    if (!entry._built) continue;
    const nextLabel = makeLabelTexture(entry.item, {
      theme: entry.item.theme,
    });
    const style = entry.item.theme === "volcanic"
      ? { opacity: 0.92 }
      : entry.item.theme === "landing" || entry.item.theme === "mission"
        ? { opacity: 0.9 }
        : entry.item.theme === "habitation"
          ? { opacity: 0.94 }
          : { opacity: 0.84 };
            entry.sprite.material.map.dispose();
    entry.sprite.material.map = nextLabel.texture;
    entry.sprite.material.opacity = style.opacity;
    entry.sprite.scale.set((nextLabel.width / 200) * 0.66, (nextLabel.height / 200) * 0.66, 1);
    entry.sprite.material.needsUpdate = true;
  }
}

export function updateLabelVisibility(
  entries,
  marsGroup,
  globe,
  camera,
  renderer,
  surfaceLabelsEnabled,
  volcanicLabelsEnabled,
  landingLabelsEnabled,
  habitationLabelsEnabled,
  cutawayModeEnabled,
  mosaicMode = false,
  mosaicScaleBarMeters = null,
  craterLabelsEnabled = true,
  fluvialLabelsEnabled = true,
  tectonicLabelsEnabled = true,
  currentLodLevel = 5,
  activeMoonViewerFeature = null,
  activeCutClipPlane = null,
  isPointOccludedByAnyMoon = () => false,
  moonLayer = null,
  activePopupFeature = null,
) {
  const now = performance.now();
  const groupWorldPosition = new THREE.Vector3();
  const surfaceWorldPosition = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const spriteWorldPosition = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const tempSpritePos = new THREE.Vector3();
  const tempLineEnd = new THREE.Vector3();
  const viewportPadding = 12;
  const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
  const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
  const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
  const occupiedRects = [];
  const candidates = [];
  marsGroup.getWorldPosition(groupWorldPosition);
  const cameraDistance = camera.position.distanceTo(groupWorldPosition);
  const globalView = cameraDistance >= 7.2;
  // Cap new Three.js object allocations per frame to prevent a heap spike on first
  // render where all ~1000 visible labels would otherwise be built simultaneously.
  // Hard cap prevents unbounded GPU + heap growth when many labels face the camera.
  const MAX_BUILT_LABELS = 500;
  let _buildBudget = 40;

  // Pre-computed placement cache.
  // Solve pass (full overlap check + placeForceLabel) runs only when the camera
  // moves beyond a threshold. Apply pass (every frame) repositions labels from
  // the cached slot, tracking zoom and camera rotation smoothly without re-running
  // the full placement algorithm — eliminates frame-to-frame label jumping.
  // Compass slot indices match this fixed order (mirrors the Phase 2 compassDirs array).
  const COMPASS_SIGNS = [
    [+1,  0], [+1, +1], [ 0, +1], [-1, +1],
    [-1,  0], [-1, -1], [ 0, -1], [+1, -1],
  ];
  if (!entries._sv) entries._sv = { q: new THREE.Quaternion(), d: 0, valid: false };
  const _needsSolve = globalView || !entries._sv.valid
    || entries._sv.q.dot(camera.quaternion) < 0.9962   // > ~5° rotation
    || Math.abs(cameraDistance / Math.max(entries._sv.d, 1e-6) - 1) > 0.20; // > 20% zoom

  const resolvedScaleBarMeters = Number.isFinite(mosaicScaleBarMeters)
    ? mosaicScaleBarMeters
    : (Number.isFinite(window.__lastScaleBarMeters)
        ? window.__lastScaleBarMeters
        : (mosaicMode ? 50000 : null));
  const hasScaleBar = Number.isFinite(resolvedScaleBarMeters);
  const scaleBarMeters = hasScaleBar ? resolvedScaleBarMeters : null;
  const useMosaicCloseLayout = mosaicMode && hasScaleBar && scaleBarMeters <= 200000;
  const baseViewportPadding = 12;

  // Per-frame camera basis vectors in marsGroup local space.
  // Used so each label radiates outward from the viewport centre rather than
  // all stacking in the same baked geographic-east screen direction.
  const _invMarsLocal = marsGroup.matrixWorld.clone().invert();
  const _camRightLocal = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).transformDirection(_invMarsLocal);
  const _camUpLocal    = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).transformDirection(_invMarsLocal);
  const _vcx = viewportWidth  * 0.5;
  const _vcy = viewportHeight * 0.5;

  const overlapsRect = (a, b, gapX = 3, gapY = 2) => (
    a.left - gapX < b.right &&
    a.right + gapX > b.left &&
    a.top - gapY < b.bottom &&
    a.bottom + gapY > b.top
  );

  const countRectOverlaps = (rect, rects, gapX = 3, gapY = 2) => {
    let count = 0;
    for (const other of rects) {
      if (overlapsRect(rect, other, gapX, gapY)) {
        count += 1;
      }
    }
    return count;
  };

  // Liang-Barsky segment–AABB intersection test.
  // Returns true if the line segment (x1,y1)→(x2,y2) passes through rect r.
  // Used to detect connecting-line crossings with already-placed labels.
  const segmentCrossesRect = (x1, y1, x2, y2, r) => {
    const dx = x2 - x1, dy = y2 - y1;
    let tMin = 0, tMax = 1;
    for (const [p, q] of [
      [-dx, x1 - r.left ], [dx, r.right  - x1],
      [-dy, y1 - r.top  ], [dy, r.bottom - y1],
    ]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > tMax) return false; tMin = Math.max(tMin, t); }
      else        { if (t < tMin) return false; tMax = Math.min(tMax, t); }
    }
    return tMin <= tMax;
  };

  const clampLabelCenter = (x, y, halfWidth, halfHeight, padding) => ({
    x: clamp(x, padding + halfWidth, viewportWidth - padding - halfWidth),
    y: clamp(y, padding + halfHeight, viewportHeight - padding - halfHeight),
  });

  const rectFromCenter = (x, y, width, height) => ({
    left: x - width * 0.5,
    right: x + width * 0.5,
    top: y - height * 0.5,
    bottom: y + height * 0.5,
  });

  const buildMosaicMetrics = (entry, distanceToSurface, pixelsPerWorldUnit) => {
    const scaleLog = Math.log10(Math.max(scaleBarMeters || 50, 50));
    const zoomStrength = clamp(1 - ((scaleLog - 1.7) / 4.8), 0, 1);
    const nearStrength = clamp(1 - (distanceToSurface / 2.4), 0, 1);
    const microScaleStrength = clamp(1 - ((scaleLog - 3.1) / 1.6), 0, 1);
    const stableLabelPx = 36;
    const closeZoomBoost = clamp(1 - ((scaleLog - 4.4) / 1.8), 0, 1);
    // Layout geometry (marker, connector, altitude) stays on the UNSCALED size so
    // the tier ramp changes how big a label is, not where it sits.
    const labelPxBase = clamp(
      stableLabelPx + closeZoomBoost * 2 + nearStrength * 2,
      36,
      40,
    );
    // SIGNIFICANCE. This path sets an absolute pixel height, and the conversion
    // back to a sprite scale in updateLabelVisibility divides by baseScale.y —
    // so baseScale, and with it every per-tier multiplier applied when the label
    // was built, cancels out exactly. Without this factor a lod-5 crater renders
    // the same 36-40 px as a lod-1 landmark, which is what it was doing.
    const labelPx = clamp(
      labelPxBase * lodTierFactor(entry.item?.lod, LOD_MOSAIC_TIER),
      20,
      44,
    );
    const markerPx = clamp(
      labelPxBase * (0.055 - microScaleStrength * 0.02 + nearStrength * 0.004),
      1.4,
      5.2,
    );
    const tangentPx = clamp(
      labelPxBase * (0.88 + zoomStrength * 0.2 + microScaleStrength * 0.32) + nearStrength * 16,
      58,
      168,
    );
    const altitudeWorld = clamp(
      (labelPxBase / Math.max(pixelsPerWorldUnit, 1e-6)) * (0.016 + nearStrength * 0.007 - microScaleStrength * 0.008),
      0.001,
      0.03,
    );
    const tangentWorld = clamp(
      tangentPx / Math.max(pixelsPerWorldUnit, 1e-6),
      0.08,
      1.35,
    );
    const offsetFactor = clamp(
      tangentWorld / Math.max(entry.labelDistance || 0.52, 0.06),
      0.45,
      2.8,
    );
    const viewportPadding = clamp(labelPx * 0.28, baseViewportPadding, 42);
    return {
      labelPx,
      markerPx,
      tangentPx,
      altitudeWorld,
      tangentWorld,
      offsetFactor,
      viewportPadding,
      overlapGapX: clamp(labelPx * 0.04, 2, 8),
      overlapGapY: clamp(labelPx * 0.025, 2, 6),
    };
  };

  // Update a 2-point line geometry in place — avoids dispose+create allocation churn.
  // Three.js will re-upload the Float32Array to the GPU on next render via needsUpdate.
  // Falls back to a full rebuild only on first use (before the attribute exists).
  const setLinePoints = (line, sx, sy, sz, ex, ey, ez) => {
    const pos = line.geometry.attributes?.position;
    if (pos && pos.array.length >= 6) {
      pos.array[0] = sx; pos.array[1] = sy; pos.array[2] = sz;
      pos.array[3] = ex; pos.array[4] = ey; pos.array[5] = ez;
      pos.needsUpdate = true;
    } else {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry();
      line.geometry.setAttribute('position', new THREE.BufferAttribute(
        new Float32Array([sx, sy, sz, ex, ey, ez]), 3
      ));
    }
  };

  const applyLabelOffset = (entry, factor, normalLift, tempPos, tempEnd, dirOverride) => {
    if (!entry.labelAnchor || !entry.labelDirection || !entry.labelNormal) {
      return false;
    }
    entry.labelOffsetFactor = factor;
    const distance = (entry.labelDistance || 0.52) * factor;
    const _dir = dirOverride || entry.labelDirection;
    tempPos.copy(entry.labelAnchor)
      .addScaledVector(entry.labelNormal, normalLift)
      .addScaledVector(_dir, distance)
      .addScaledVector(entry.labelUp || new THREE.Vector3(), entry.labelPushUp || 0)
      .addScaledVector(entry.labelEast || new THREE.Vector3(), entry.labelPushEast || 0);
    entry.sprite.position.copy(tempPos);
    if (entry.line) {
      const cs = getEntryConnectorStart(entry);
      setLinePoints(entry.line, cs.x, cs.y, cs.z, tempPos.x, tempPos.y, tempPos.z);
    }
    return true;
  };

  const placeMosaicLabel = (entry, metrics, anchorProjected, occupiedRectsLocal) => {
    const _pml = (window.__pmlStats = window.__pmlStats || { called: 0, offscreen: 0, noSlot: 0, ok: 0 });
    _pml.called++;
    const spriteParent = entry.sprite.parent || marsGroup;
    const anchorScreenX = ((anchorProjected.x + 1) * 0.5) * viewportWidth;
    const anchorScreenY = ((1 - anchorProjected.y) * 0.5) * viewportHeight;
    const anchorViewportMargin = clamp(metrics.viewportPadding * 0.35, 8, 18);
    if (
      anchorProjected.x < -1 || anchorProjected.x > 1 ||
      anchorProjected.y < -1 || anchorProjected.y > 1 ||
      anchorScreenX < anchorViewportMargin ||
      anchorScreenX > viewportWidth - anchorViewportMargin ||
      anchorScreenY < anchorViewportMargin ||
      anchorScreenY > viewportHeight - anchorViewportMargin
    ) {
      _pml.offscreen++;
      return null;
    }
    const anchorWorld = new THREE.Vector3();
    entry.marker.getWorldPosition(anchorWorld);
    const distanceToAnchor = camera.position.distanceTo(anchorWorld);
    const pixelsPerWorldUnit = fovScale / Math.max(distanceToAnchor, 0.001);
    const baseDirectionWorld = entry.labelAnchor.clone()
      .addScaledVector(entry.labelDirection || new THREE.Vector3(1, 0, 0), metrics.tangentWorld);
    const directionSampleWorld = spriteParent.localToWorld(baseDirectionWorld);
    const directionProjected = directionSampleWorld.clone().project(camera);
    let dirX = ((directionProjected.x + 1) * 0.5) * viewportWidth - anchorScreenX;
    let dirY = ((1 - directionProjected.y) * 0.5) * viewportHeight - anchorScreenY;
    if (directionProjected.z > 1 || directionProjected.z < -1 || !Number.isFinite(dirX) || !Number.isFinite(dirY)) {
      dirX = 1;
      dirY = -0.35;
    }
    const dirLength = Math.hypot(dirX, dirY) || 1;
    dirX /= dirLength;
    dirY /= dirLength;

    const labelWidth = Math.max(40, entry.sprite.scale.x * pixelsPerWorldUnit * 1.02);
    const labelHeight = Math.max(20, entry.sprite.scale.y * pixelsPerWorldUnit * 1.06);
    const halfWidth = labelWidth * 0.5;
    const halfHeight = labelHeight * 0.5;
    const connectorPx = clamp(metrics.tangentPx * 0.62, 18, 72);

    const angleOffsets = [0, 30, -30, 60, -60, 100, -100, 145, -145, 180];
    const radialScales = [1, 1.28, 1.6, 1.95];
    let best = null;

    for (const angleDeg of angleOffsets) {
      const angleRad = angleDeg * Math.PI / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const rotatedX = dirX * cos - dirY * sin;
      const rotatedY = dirX * sin + dirY * cos;
      for (const radialScale of radialScales) {
        const centerOffsetPx = connectorPx + Math.max(halfWidth * 0.96, halfHeight * 0.75) + (metrics.tangentPx * 0.35 * (radialScale - 1));
        const rawX = anchorScreenX + rotatedX * centerOffsetPx;
        const rawY = anchorScreenY + rotatedY * centerOffsetPx;
        const clamped = clampLabelCenter(rawX, rawY, halfWidth, halfHeight, metrics.viewportPadding);
        const rect = rectFromCenter(clamped.x, clamped.y, labelWidth, labelHeight);
        const overlaps = countRectOverlaps(rect, occupiedRectsLocal, metrics.overlapGapX, metrics.overlapGapY);
        const clampPenalty = Math.abs(clamped.x - rawX) + Math.abs(clamped.y - rawY);
        const anglePenalty = Math.abs(angleDeg) * 0.2;
        const radialPenalty = (radialScale - 1) * 12;
        const score = overlaps * 1000 + clampPenalty + anglePenalty + radialPenalty;
        if (!best || score < best.score) {
          best = {
            x: clamped.x,
            y: clamped.y,
            rect,
            score,
          };
        }
        if (overlaps === 0 && clampPenalty < 1) {
          break;
        }
      }
    }

    if (!best) {
      _pml.noSlot++;
      return null;
    }

    tempSpritePos.set(
      (best.x / viewportWidth) * 2 - 1,
      1 - (best.y / viewportHeight) * 2,
      anchorProjected.z,
    ).unproject(camera);
    spriteParent.worldToLocal(tempSpritePos);
    entry.sprite.position.copy(tempSpritePos);
    if (entry.line) {
      const cs = getEntryConnectorStart(entry);
      const sp = entry.sprite.position;
      setLinePoints(entry.line, cs.x, cs.y, cs.z, sp.x, sp.y, sp.z);
      entry.line.visible = true;
    }
    entry.sprite.visible = true;
    entry.sprite.getWorldPosition(spriteWorldPosition);
    projected.copy(spriteWorldPosition).project(camera);
    _pml.ok++;
    return best.rect;
  };

  // In moon viewer mode: pre-compute the active moon's projected screen disk so we can
  // cull surface markers that visually project onto the moon body. The standard geometric
  // occluder test only catches markers physically behind the moon sphere; markers that are
  // beside it in 3D can still overlap the moon's screen disk because depthTest is disabled.
  let activeMoonScreenDisk = null;
  if (activeMoonViewerFeature && moonLayer && Array.isArray(moonLayer.entries)) {
    const activeMoonEntry = moonLayer.entries.find((e) => e.item?.name === activeMoonViewerFeature.name);
    if (activeMoonEntry) {
      const moonWorld = new THREE.Vector3();
      activeMoonEntry.moonMesh.getWorldPosition(moonWorld);
      const moonDistFromCam = camera.position.distanceTo(moonWorld);
      const moonProj = moonWorld.clone().project(camera);
      if (moonProj.z > -1 && moonProj.z < 1) {
        const moonPPU = fovScale / Math.max(moonDistFromCam, 1e-6);
        activeMoonScreenDisk = {
          x: ((moonProj.x + 1) * 0.5) * viewportWidth,
          y: ((1 - moonProj.y) * 0.5) * viewportHeight,
          r: activeMoonEntry.moonRadius * moonPPU * 1.15,
          distFromCam: moonDistFromCam,
        };
      }
    }
  }

  for (const entry of entries) {
    const isUserPinEntry = entry.item?.type === "User pin" || entry.item?.type === "Imported pin";
    // Use stored surfacePoint for world-space position (same result as marker.getWorldPosition).
    surfaceWorldPosition.copy(entry.surfacePoint).applyMatrix4(marsGroup.matrixWorld);

    // Lazy Three.js build: skip entries that are not yet visible to avoid allocating
    // scene objects for labels on the far side of the globe or filtered by LOD.
    if (!entry._built) {
      const _n = surfaceWorldPosition.clone().sub(groupWorldPosition).normalize();
      cameraDirection.copy(camera.position).sub(surfaceWorldPosition).normalize();
      const _catEnabled = entry.category === "volcanic" ? volcanicLabelsEnabled
        : entry.category === "landing" || entry.category === "mission" ? landingLabelsEnabled
        : entry.category === "habitation" ? habitationLabelsEnabled
        : entry.category === "crater" ? craterLabelsEnabled
        : entry.category === "fluvial" ? fluvialLabelsEnabled
        : entry.category === "tectonic" ? tectonicLabelsEnabled
        : surfaceLabelsEnabled;
      const _lod = entry.item?.lod;
      const _survivesCut = !cutawayModeEnabled || (activeCutClipPlane ? activeCutClipPlane.distanceToPoint(surfaceWorldPosition) : surfaceWorldPosition.x) >= -0.02;
      const _wouldBeVisible = _catEnabled && _survivesCut && (_lod == null || _lod <= currentLodLevel)
        && _n.dot(cameraDirection) > (useMosaicCloseLayout ? -0.14 : -0.06);
      if (!_wouldBeVisible) continue;
      if (_buildBudget <= 0) continue;
      if ((entries._builtCount || 0) >= MAX_BUILT_LABELS) continue;
      _buildBudget--;
      entries._buildEntry(entry);
    }

    const normal = surfaceWorldPosition.clone().sub(groupWorldPosition).normalize();
    cameraDirection.copy(camera.position).sub(surfaceWorldPosition).normalize();
    const categoryEnabled = entry.category === "volcanic"
      ? volcanicLabelsEnabled
      : entry.category === "landing" || entry.category === "mission"
        ? landingLabelsEnabled
      : entry.category === "habitation"
        ? habitationLabelsEnabled
      : entry.category === "crater"
        ? craterLabelsEnabled
      : entry.category === "fluvial"
        ? fluvialLabelsEnabled
      : entry.category === "tectonic"
        ? tectonicLabelsEnabled
      : surfaceLabelsEnabled;
    const survivesCut = !cutawayModeEnabled || (activeCutClipPlane ? activeCutClipPlane.distanceToPoint(surfaceWorldPosition) : surfaceWorldPosition.x) >= -0.02;
    const facingThreshold = useMosaicCloseLayout ? -0.14 : -0.06; // was 0.02
    const entryLod = entry.item?.lod;
    const survivesLod = entryLod == null || entryLod <= currentLodLevel;
    const isVisible = categoryEnabled && survivesCut && survivesLod && normal.dot(cameraDirection) > facingThreshold;
    entry.marker.visible = isVisible;
    entry.hitTarget.visible = isVisible;
    if (useMosaicCloseLayout) {
      entry.marker.visible = isVisible;
      entry.hitTarget.visible = isVisible;
    }
    entry.sprite.visible = false;
    if (entry.line) {
      entry.line.visible = false;
    }
    if (!isVisible) {
      if (entry._built) {
        const atCap = (entries._builtCount || 0) >= MAX_BUILT_LABELS;
        const age = entry._lastVisibleAt !== null ? (now - entry._lastVisibleAt) : 0;
        if ((atCap && age > 200) || age > 8000) {
          entries._disposeEntry(entry);
        }
      }
      continue;
    }
    entry._lastVisibleAt = now;
    if (isPointOccludedByAnyMoon(surfaceWorldPosition, camera)) {
      if (!useMosaicCloseLayout) {
        entry.marker.visible = false;
        entry.hitTarget.visible = false;
      }
      continue;
    }

    // Screen-space disk check: hide markers further from camera than the active moon
    // that visually project onto the moon's disk (depthTest:false can't block them).
    if (activeMoonScreenDisk) {
      const markerDistFromCam = camera.position.distanceTo(surfaceWorldPosition);
      if (markerDistFromCam > activeMoonScreenDisk.distFromCam) {
        const p = surfaceWorldPosition.clone().project(camera);
        if (p.z > -1 && p.z < 1) {
          const sx = ((p.x + 1) * 0.5) * viewportWidth;
          const sy = ((1 - p.y) * 0.5) * viewportHeight;
          const dx = sx - activeMoonScreenDisk.x;
          const dy = sy - activeMoonScreenDisk.y;
          if (Math.sqrt(dx * dx + dy * dy) < activeMoonScreenDisk.r) {
            entry.marker.visible = false;
            entry.hitTarget.visible = false;
            continue;
          }
        }
      }
    }

    // Allocate the canvas texture on first visibility for deferred labels.
    if (entry._labelDeferred && !entry.sprite.material.map) {
      const _theme = entry.item.theme === "landing" ? "landing" : entry.item.theme;
      const _dl = makeLabelTexture(entry.item, { theme: _theme, backingScale: 1 });
      entry.sprite.material.map = _dl.texture;
      entry.sprite.material.needsUpdate = true;
      entry.sprite.scale.set((_dl.width / 200) * 0.66, (_dl.height / 200) * 0.66, 1);
      entry.baseScale = entry.sprite.scale.clone();
    }

    const baseScale = entry.baseScale;
    let mosaicMetrics = null;
    if (baseScale) {
      const distanceToSurface = camera.position.distanceTo(surfaceWorldPosition);
      const t = clamp((distanceToSurface - 0.2) / 6.2, 0, 1);
      const easedT = Math.pow(t, 0.85);
      const pixelsPerWorldUnit = fovScale / Math.max(distanceToSurface, 0.001);
      const worldUnitsPerPixel = 1 / Math.max(pixelsPerWorldUnit, 1e-6);
      let labelScale = 0.12 + (1.35 - 0.12) * easedT;
      let scaleFactor = 0.03 + (1.35 - 0.03) * easedT;
      // In moon viewer mode Mars is small and distant — scale labels down so they
      // don't visually dominate the globe.
      const moonViewerLabelMult = activeMoonViewerFeature ? 0.55 : 1.0;
      // At close zoom the label system normally keeps pixel size constant (high ppu
      // cancels small labelScale). Intentionally shrink labels as zoom increases so
      // dense regions have more breathing room for collision avoidance.
      // Grow labels slightly at close zoom so all tiers remain readable.
      // Density is managed by priority occlusion rather than shrinking labels.
      const closeZoomLabelScale = clamp(1.0 + 0.28 * (1 - easedT), 1.0, 1.28);
      // LOD tier → proportional label size so prominent features read larger than
      // minor ones at every zoom level, creating a natural cartographic hierarchy.
      // Moon features (no lod field) stay at full size.
      const _lod = entry.item?.lod;
      const lodTierScale = _lod ? [1.0, 1.0, 0.84, 0.70, 0.57, 0.44][_lod] : 1.0;
      const standardLabelPx = baseScale.y * pixelsPerWorldUnit * labelScale * moonViewerLabelMult * closeZoomLabelScale * lodTierScale;
      const standardMarkerPx = ((entry.markerRadiusWorld || 1) * (entry.markerBaseScale?.x || 1) * pixelsPerWorldUnit) * scaleFactor * moonViewerLabelMult * closeZoomLabelScale * lodTierScale;
      if (useMosaicCloseLayout) {
        mosaicMetrics = buildMosaicMetrics(entry, distanceToSurface, pixelsPerWorldUnit);
        labelScale = (mosaicMetrics.labelPx * moonViewerLabelMult) / Math.max(baseScale.y * pixelsPerWorldUnit, 1e-6);
        scaleFactor = (mosaicMetrics.markerPx * moonViewerLabelMult) / Math.max((entry.markerRadiusWorld || 1) * (entry.markerBaseScale?.x || 1) * pixelsPerWorldUnit, 1e-6);
      } else {
        labelScale = standardLabelPx / Math.max(baseScale.y * pixelsPerWorldUnit, 1e-6);
        scaleFactor = standardMarkerPx / Math.max((entry.markerRadiusWorld || 1) * (entry.markerBaseScale?.x || 1) * pixelsPerWorldUnit, 1e-6);
      }
      entry.sprite.scale.set(baseScale.x * labelScale, baseScale.y * labelScale, 1);
      if (entry.markerBaseScale) {
        let markerScale = clamp(scaleFactor, useMosaicCloseLayout ? 0.003 : 0.12, useMosaicCloseLayout ? 0.3 : 1.4);
        if (useMosaicCloseLayout && isUserPinEntry) {
          const targetPinPx = getUserPinTargetPixelSize(scaleBarMeters);
          const targetPinScale = (worldUnitsPerPixel * targetPinPx) / Math.max(entry.markerBaseScale.x || 1e-6, 1e-6);
          markerScale = clamp(targetPinScale, 0.035, 0.34);
        }
        if (useMosaicCloseLayout && scaleBarMeters <= 2000) {
          const targetMarkerDiameterMeters = clamp(scaleBarMeters * 0.14, 100, 200);
          const targetMarkerRadiusWorld = (targetMarkerDiameterMeters * 0.5) * (3.2 / MARS_RADIUS_METERS);
          const targetMarkerScale = targetMarkerRadiusWorld / Math.max((entry.markerRadiusWorld || 0.011) * (entry.markerBaseScale.x || 1), 1e-6);
          if (!isUserPinEntry) {
            markerScale = Math.min(markerScale, targetMarkerScale);
          }
        }
        entry.marker.scale.set(
          entry.markerBaseScale.x * markerScale,
          entry.markerBaseScale.y * markerScale,
          entry.markerBaseScale.z * markerScale,
        );
      }
      if (entry.hitBaseScale) {
        const hitScaleBase = useMosaicCloseLayout
          ? (mosaicMetrics.markerPx * 2.4) / Math.max((entry.hitRadiusWorld || 1) * (entry.hitBaseScale.x || 1) * pixelsPerWorldUnit, 1e-6)
          : scaleFactor * 1.35;
        const hitScale = clamp(hitScaleBase, useMosaicCloseLayout ? 0.01 : 0.2, useMosaicCloseLayout ? 0.16 : 2.2);
        entry.hitTarget.scale.set(
          entry.hitBaseScale.x * hitScale,
          entry.hitBaseScale.y * hitScale,
          entry.hitBaseScale.z * hitScale,
        );
      }
    }

    if (useMosaicCloseLayout && isUserPinEntry && scaleBarMeters <= 2500) {
      entry.sprite.visible = false;
      if (entry.line) {
        entry.line.visible = false;
      }
      continue;
    }

    if (useMosaicCloseLayout) {
      if (mosaicMetrics) {
        applyLabelOffset(entry, mosaicMetrics.offsetFactor, mosaicMetrics.altitudeWorld, tempSpritePos, tempLineEnd);
      }
    } else {
      const _entryLod = entry.item?.lod;
      const _lodLineFactor = _entryLod ? [1.0, 1.0, 0.84, 0.70, 0.57, 0.44][_entryLod] : 1.0;
      // Pin line length to screen pixels so labels sit close at all zoom levels.
      // Target 40 screen-pixels for tier-1, scaled by LOD tier so the visual
      // hierarchy is preserved. At global zoom this cuts lines to ~40 % of their
      // former length; placeForceLabel Phase 2 (compass) extends when needed.
      const _ppu = fovScale / Math.max(camera.position.distanceTo(surfaceWorldPosition), 0.001);
      const _targetPx = clamp(60 * _lodLineFactor, 18, 80);
      const _pixelFactor = _targetPx / Math.max(_ppu * (entry.labelDistance || 0.52), 1e-6);
      const _lineFactor = Math.min(_lodLineFactor, _pixelFactor);
      entry.labelOffsetFactor = activeMoonViewerFeature ? 0.5 : _lineFactor;
      applyLabelOffset(entry, entry.labelOffsetFactor, 0.22, tempSpritePos, tempLineEnd);
    }
    entry.sprite.getWorldPosition(spriteWorldPosition);
    const forceLabel = useMosaicCloseLayout
      ? true
      : entry.marker?.visible && entry.hitTarget?.visible;
    if (!forceLabel && isPointOccludedByAnyMoon(spriteWorldPosition, camera)) {
      entry.marker.visible = false;
      entry.hitTarget.visible = false;
      continue;
    }
    projected.copy(spriteWorldPosition).project(camera);
    if (projected.z < -1 || projected.z > 1) {
      if (useMosaicCloseLayout) {
        spriteWorldPosition.copy(surfaceWorldPosition);
        projected.copy(spriteWorldPosition).project(camera);
      } else if (!globalView) {
        if (forceLabel && entry.labelAnchor && entry.labelNormal) {
          applyLabelOffset(entry, 0.18, 0.28, tempSpritePos, tempLineEnd);
          entry.sprite.position.copy(entry.labelAnchor).addScaledVector(entry.labelNormal, 0.28);
          if (entry.line) {
            const cs = getEntryConnectorStart(entry);
            const sp = entry.sprite.position;
            setLinePoints(entry.line, cs.x, cs.y, cs.z, sp.x, sp.y, sp.z);
          }
          spriteWorldPosition.copy(entry.sprite.position).applyMatrix4(marsGroup.matrixWorld);
          projected.copy(spriteWorldPosition).project(camera);
        }
        if (projected.z < -1 || projected.z > 1) {
          if (forceLabel) {
            spriteWorldPosition.copy(surfaceWorldPosition);
            projected.copy(spriteWorldPosition).project(camera);
            if (projected.z < -1 || projected.z > 1) {
              continue;
            }
          } else {
            continue;
          }
        }
      } else {
        continue;
      }
    }

    if (useMosaicCloseLayout) {
      const anchorWorld = new THREE.Vector3();
      entry.marker.getWorldPosition(anchorWorld);
      const anchorProjected = anchorWorld.clone().project(camera);
      if (anchorProjected.z < -1 || anchorProjected.z > 1) {
        continue;
      }
      const rect = placeMosaicLabel(entry, mosaicMetrics || buildMosaicMetrics(entry, camera.position.distanceTo(anchorWorld), fovScale / Math.max(camera.position.distanceTo(anchorWorld), 0.001)), anchorProjected, occupiedRects);
      if (!rect) {
        continue;
      }
      occupiedRects.push(rect);
      continue;
    }

    const distance = camera.position.distanceTo(spriteWorldPosition);
    const pixelsPerWorldUnit = fovScale / Math.max(distance, 0.001);
    const rectFromProjected = (proj) => {
      const width = entry.sprite.scale.x * pixelsPerWorldUnit * 1.02;
      const height = entry.sprite.scale.y * pixelsPerWorldUnit * 1.06;
      const sx = ((proj.x + 1) * 0.5) * viewportWidth;
      const sy = ((1 - proj.y) * 0.5) * viewportHeight;
      return {
        left: sx - width * 0.5,
        right: sx + width * 0.5,
        top: sy - height * 0.5,
        bottom: sy + height * 0.5,
      };
    };
    let rect = rectFromProjected(projected);

    const needsFit = !globalView && (rect.left < baseViewportPadding
      || rect.right > viewportWidth - baseViewportPadding
      || rect.top < baseViewportPadding
      || rect.bottom > viewportHeight - baseViewportPadding);

    if (needsFit && entry.labelAnchor) {
      // Try progressively shorter offsets to pull the label back on-screen.
      // Use fractions of the current baseline so this stays correct whether the
      // baseline is the old world-space 1.0 or the new pixel-capped value.
      const _baseF = entry.labelOffsetFactor || 0.5;
      const _fitSteps = [_baseF * 0.6, _baseF * 0.35, _baseF * 0.15, 0.06];
      for (const _fitF of _fitSteps) {
        applyLabelOffset(entry, _fitF, 0.22, tempSpritePos, tempLineEnd);
        spriteWorldPosition.copy(entry.sprite.position).applyMatrix4(marsGroup.matrixWorld);
        projected.copy(spriteWorldPosition).project(camera);
        rect = rectFromProjected(projected);
        if (rect.left >= baseViewportPadding && rect.right <= viewportWidth - baseViewportPadding
          && rect.top >= baseViewportPadding && rect.bottom <= viewportHeight - baseViewportPadding) break;
      }
    }
    candidates.push({
      entry,
      distance,
      rect,
      pixelsPerWorldUnit,
    });
  }

  candidates.sort((a, b) => {
    const aPinned = Boolean(activePopupFeature && a.entry.item?.name === activePopupFeature.name);
    const bPinned = Boolean(activePopupFeature && b.entry.item?.name === activePopupFeature.name);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    // Higher theme-priority first (e.g. landing > crater > standard)
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority;
    // Within the same theme priority, sort by LOD tier so tier-1 landmarks
    // always claim space before tier-5 minor features.
    const aLod = a.entry.item?.lod ?? 3;
    const bLod = b.entry.item?.lod ?? 3;
    if (aLod !== bLod) return aLod - bLod;
    if (globalView) {
      if (a.entry._globalVisible !== b.entry._globalVisible) {
        return a.entry._globalVisible ? -1 : 1;
      }
      return a.entry.sortIndex - b.entry.sortIndex;
    }
    return a.distance - b.distance;
  });

  const placeForceLabel = (candidate) => {
    const entry = candidate.entry;
    if (!entry.labelAnchor || !entry.labelNormal || !entry.labelDirection) {
      return false;
    }

    const tryPlacement = (posLocal) => {
      entry.sprite.position.copy(posLocal);
      if (entry.line) {
        const cs = getEntryConnectorStart(entry);
        setLinePoints(entry.line, cs.x, cs.y, cs.z, posLocal.x, posLocal.y, posLocal.z);
      }
      spriteWorldPosition.copy(posLocal).applyMatrix4(marsGroup.matrixWorld);
      projected.copy(spriteWorldPosition).project(camera);
      if (projected.z < -1 || projected.z > 1) return false;
      const sx = ((projected.x + 1) * 0.5) * viewportWidth;
      const sy = ((1 - projected.y) * 0.5) * viewportHeight;
      const hw = entry.sprite.scale.x * candidate.pixelsPerWorldUnit * 0.51;
      const hh = entry.sprite.scale.y * candidate.pixelsPerWorldUnit * 0.53;
      const rect = { left: sx - hw, right: sx + hw, top: sy - hh, bottom: sy + hh };
      const within = rect.left >= viewportPadding && rect.right <= viewportWidth - viewportPadding
        && rect.top >= viewportPadding && rect.bottom <= viewportHeight - viewportPadding;
      if (!within) return false;
      const overlaps = occupiedRects.some((r) =>
        rect.left - 3 < r.right && rect.right + 3 > r.left &&
        rect.top - 2 < r.bottom && rect.bottom + 2 > r.top
      );
      if (overlaps) return false;
      // Also reject if the connecting line would cross an occupied label rect.
      if (entry.marker && occupiedRects.length > 0) {
        const _fdw2 = new THREE.Vector3();
        entry.marker.getWorldPosition(_fdw2);
        const _fdp2 = _fdw2.clone().project(camera);
        if (_fdp2.z > -1 && _fdp2.z < 1) {
          const _dsx2 = ((_fdp2.x + 1) * 0.5) * viewportWidth;
          const _dsy2 = ((1 - _fdp2.y) * 0.5) * viewportHeight;
          const _lineLenSq2 = (sx - _dsx2) ** 2 + (sy - _dsy2) ** 2;
          if (_lineLenSq2 > 18 * 18) {
            const _lineCrosses2 = occupiedRects.some((r) =>
              segmentCrossesRect(_dsx2, _dsy2, sx, sy, r)
            );
            if (_lineCrosses2) return false;
          }
        }
      }
      if (entry.marker) {
        const _fdw = new THREE.Vector3();
        entry.marker.getWorldPosition(_fdw);
        const _fdp = _fdw.clone().project(camera);
        if (_fdp.z > -1 && _fdp.z < 1) {
          const MIN_DOT_GAP = 14;
          const _fdsx = ((_fdp.x + 1) * 0.5) * viewportWidth;
          const _fdsy = ((1 - _fdp.y) * 0.5) * viewportHeight;
          if (_fdsx > rect.left - MIN_DOT_GAP && _fdsx < rect.right + MIN_DOT_GAP
            && _fdsy > rect.top - MIN_DOT_GAP && _fdsy < rect.bottom + MIN_DOT_GAP) return false;
        }
      }
      candidate.rect = rect;
      return true;
    };

    // Phase 1 — world-space direction-based placements using the baked labelDirection.
    // Strategy: first try the same bearing at progressively shorter line lengths
    // (current length is the maximum). Two nearby labels that both want to go east
    // can coexist if one sits at 40% length — direction stays semantically correct.
    // Only after exhausting shorter-line options does the algorithm try flipped
    // or orthogonal bearings.
    const _p1Dir = entry.labelDirection;
    const _fullF = entry.labelOffsetFactor || 1;
    const placements = [
      { factor: _fullF,       dir:  1, up: 0     },  // full length, primary bearing
      { factor: _fullF * 0.75, dir:  1, up: 0    },  // 75 % — pull toward dot
      { factor: _fullF * 0.55, dir:  1, up: 0    },  // 55 %
      { factor: _fullF * 0.35, dir:  1, up: 0    },  // 35 %
      { factor: _fullF * 0.60, dir:  1, up:  0.10 }, // slight vertical at medium
      { factor: _fullF * 0.60, dir:  1, up: -0.10 },
      { factor: _fullF * 0.60, dir: -1, up:  0.10 }, // opposite bearing
      { factor: 0.35,          dir: -1, up: -0.08 },
      { factor: 1.1,           dir: -1, up:  0.04 },
      { factor: 0.8,           dir:  1, up: -0.15 },
      { factor: 0.8,           dir: -1, up: -0.15 },
    ];
    const _maxOffPx = Math.min(viewportWidth, viewportHeight) * 0.12;
    const _adaptF = _maxOffPx / Math.max(candidate.pixelsPerWorldUnit * (entry.labelDistance || 0.52), 1e-6);
    if (_adaptF < 0.30) {
      placements.push(
        { factor: _adaptF,        dir:  1, up: 0    },
        { factor: _adaptF,        dir: -1, up: 0    },
        { factor: _adaptF * 0.7,  dir:  1, up: 0.08 },
        { factor: _adaptF * 0.7,  dir: -1, up: 0.08 },
      );
    }
    for (const option of placements) {
      const direction = _p1Dir.clone().multiplyScalar(option.dir);
      tempSpritePos.copy(entry.labelAnchor)
        .addScaledVector(entry.labelNormal, 0.22)
        .addScaledVector(direction, (entry.labelDistance || 0.52) * option.factor)
        .addScaledVector(entry.labelUp || new THREE.Vector3(), (entry.labelPushUp || 0) + option.up)
        .addScaledVector(entry.labelEast || new THREE.Vector3(), entry.labelPushEast || 0);
      if (tryPlacement(tempSpritePos)) {
        entry._pc = { phase: 1, factor: option.factor, dirMult: option.dir, upOff: option.up };
        return true;
      }
    }

    // Phase 2 — screen-space compass placement.
    // Reuse the per-frame cam basis (already transformed to marsGroup local space).
    // Sort the 8 compass candidates so the direction most aligned with this dot's
    // outward vector is tried first — this prevents line crossings between adjacent dots.
    const camRight = _camRightLocal;
    const camUp    = _camUpLocal;
    const ppu = candidate.pixelsPerWorldUnit;
    const hw = entry.sprite.scale.x * 0.5; // world-space half-width
    const hh = entry.sprite.scale.y * 0.5; // world-space half-height
    const gw = 14 / Math.max(ppu, 1);      // 14px gap in world units
    // Each entry: [rightScale, upScale, compassIdx] — label centre offset from dot
    // in cam-plane directions. compassIdx maps to COMPASS_SIGNS for the apply pass.
    const compassDirs = [
      [ hw + gw,  0,         0 ],   // right
      [ hw + gw,  hh + gw,   1 ],   // up-right
      [ 0,        hh + gw,   2 ],   // up
      [-(hw + gw), hh + gw,  3 ],   // up-left
      [-(hw + gw), 0,        4 ],   // left
      [-(hw + gw),-(hh + gw),5 ],   // down-left
      [ 0,       -(hh + gw), 6 ],   // down
      [ hw + gw, -(hh + gw), 7 ],   // down-right
    ];
    // Compute outward screen direction fresh from dot screen position.
    // Avoids storing per-entry frame data and keeps Phase 2 self-contained.
    let _outR = 0, _outU = 0;
    if (entry.marker) {
      const _dw2 = new THREE.Vector3();
      entry.marker.getWorldPosition(_dw2);
      const _dp2 = _dw2.clone().project(camera);
      if (_dp2.z > -1 && _dp2.z < 1) {
        const _dx2 = ((_dp2.x + 1) * 0.5) * viewportWidth  - viewportWidth  * 0.5;
        const _dy2 = ((_dp2.y + 1) * 0.5) * viewportHeight - viewportHeight * 0.5;
        const _dl2 = Math.sqrt(_dx2 * _dx2 + _dy2 * _dy2);
        if (_dl2 > 8) { _outR = _dx2 / _dl2; _outU = _dy2 / _dl2; }
      }
    }
    compassDirs.sort((a, b) => {
      const la = Math.sqrt(a[0] * a[0] + a[1] * a[1]) || 1;
      const lb = Math.sqrt(b[0] * b[0] + b[1] * b[1]) || 1;
      return ((b[0] / lb) * _outR + (b[1] / lb) * _outU) -
             ((a[0] / la) * _outR + (a[1] / la) * _outU);
    });
    const basePos = entry.labelAnchor.clone().addScaledVector(entry.labelNormal, 0.22);
    for (const [rs, us, slotIdx] of compassDirs) {
      tempSpritePos.copy(basePos)
        .addScaledVector(camRight, rs)
        .addScaledVector(camUp, us);
      if (tryPlacement(tempSpritePos)) {
        entry._pc = { phase: 2, slotIdx };
        return true;
      }
    }

    return false;
  };

  if (_needsSolve) {
    // Pre-initialise every entry as hidden; commit loop overwrites visible ones.
    for (const entry of entries) entry._pc = { hidden: true };
  }

  if (_needsSolve) for (const candidate of candidates) {
    const isPinned = Boolean(activePopupFeature && candidate.entry.item?.name === activePopupFeature.name);
    if (useMosaicCloseLayout) {
      const overlaps = occupiedRects.some((rect) => (
        candidate.rect.left - 3 < rect.right &&
        candidate.rect.right + 3 > rect.left &&
        candidate.rect.top - 2 < rect.bottom &&
        candidate.rect.bottom + 2 > rect.top
      ));
      if (overlaps && !isPinned) {
        continue;
      }
      candidate.entry.sprite.visible = true;
      if (candidate.entry.line) {
        candidate.entry.line.visible = true;
      }
      // Record the placement. Every entry was pre-initialised to
      // { hidden: true } above, and this branch used to `continue` without
      // overwriting it — so the label survived the solve frame and then
      // vanished on the next APPLY frame, where the per-entry loop forces
      // sprite.visible = false and the apply pass skips anything still marked
      // hidden. In orbit the camera sits still and almost every frame solves,
      // which hid it; in flight the camera never stops and most frames apply.
      candidate.entry._pc = { phase: 'abs', localPos: candidate.entry.sprite.position.clone() };
      occupiedRects.push(candidate.rect);
      continue;
    }
    const forceLabel = candidate.entry.marker?.visible && candidate.entry.hitTarget?.visible;
    // Only tier-1 & tier-2 non-crater labels get smart repositioning via
    // placeForceLabel.  All other labels use pure occlusion: shown if space
    // is available, hidden if not — no frame-to-frame jumping in dense areas.
    const _entryLodTier = candidate.entry.item?.lod ?? 1;
    const _isCraterEntry = candidate.entry.category === "crater";
    const _useSmartPlace = !globalView && forceLabel && !_isCraterEntry && _entryLodTier <= 3;
    // was: _entryLodTier <= 2

    if (!globalView) {
      const outOfBounds = candidate.rect.left < baseViewportPadding
        || candidate.rect.right > viewportWidth - baseViewportPadding
        || candidate.rect.top < baseViewportPadding
        || candidate.rect.bottom > viewportHeight - baseViewportPadding;
      if (outOfBounds && _useSmartPlace) {
        placeForceLabel(candidate); // best-effort; don't drop even if it can't fit
      } else if (outOfBounds) {
        if (!useMosaicCloseLayout) continue;
      }
    }
    const _overlapGapX = _entryLodTier >= 4 ? 1 : 3;
    const _overlapGapY = _entryLodTier >= 4 ? 0 : 2;
    const overlaps = occupiedRects.some((rect) => (
      candidate.rect.left - _overlapGapX < rect.right &&
      candidate.rect.right + _overlapGapX > rect.left &&
      candidate.rect.top - _overlapGapY < rect.bottom &&
      candidate.rect.bottom + _overlapGapY > rect.top
    ));
    if (overlaps) {
      if (_useSmartPlace) {
        if (!placeForceLabel(candidate)) continue;
      } else if (globalView && candidate.entry._globalVisible) {
        // Keep previously visible labels stable in global view to avoid flicker.
      } else {
        continue; // pure occlusion — hide, no repositioning
      }
    }

    // Check if the connecting line from dot to label crosses any already-placed
    // label rect.  Tier-1/2/3 non-crater labels get a repositioning attempt;
    // tier-4/5 labels skip this check — a crossed connector is preferable to
    // hiding the label entirely when the label rect itself doesn't overlap.
    if (!globalView && !isPinned && candidate.entry.marker && occupiedRects.length > 0 && _entryLodTier <= 3) {
      const _lw = new THREE.Vector3();
      candidate.entry.marker.getWorldPosition(_lw);
      const _lp = _lw.clone().project(camera);
      if (_lp.z > -1 && _lp.z < 1) {
        const _dotSX = ((_lp.x + 1) * 0.5) * viewportWidth;
        const _dotSY = ((1 - _lp.y) * 0.5) * viewportHeight;
        const _labCX = (candidate.rect.left + candidate.rect.right) * 0.5;
        const _labCY = (candidate.rect.top  + candidate.rect.bottom) * 0.5;
        const _lineLenSq = (_labCX - _dotSX) ** 2 + (_labCY - _dotSY) ** 2;
        if (_lineLenSq > 18 * 18) {
          const _lineCrosses = occupiedRects.some((r) =>
            segmentCrossesRect(_dotSX, _dotSY, _labCX, _labCY, r)
          );
          if (_lineCrosses) {
            if (_useSmartPlace) {
              if (!placeForceLabel(candidate)) continue;
            } else {
              continue;
            }
          }
        }
      }
    }

    // Guarantee label never sits on its own marker dot.
    // Project the dot to screen space and check clearance from the label rect.
    if (candidate.entry.marker && candidate.entry.labelDirection && candidate.entry.labelAnchor) {
      const _dw = new THREE.Vector3();
      candidate.entry.marker.getWorldPosition(_dw);
      const _dp = _dw.clone().project(camera);
      if (_dp.z > -1 && _dp.z < 1) {
        const _dsx = ((_dp.x + 1) * 0.5) * viewportWidth;
        const _dsy = ((1 - _dp.y) * 0.5) * viewportHeight;
        const _rc = candidate.rect;
        const _lcx = (_rc.left + _rc.right) * 0.5;
        const _lcy = (_rc.top + _rc.bottom) * 0.5;
        const MIN_DOT_GAP = 14; // px clearance between dot edge and label rect edge
        // Check if dot falls inside or within MIN_DOT_GAP of label rect
        if (_dsx > _rc.left - MIN_DOT_GAP && _dsx < _rc.right + MIN_DOT_GAP
          && _dsy > _rc.top - MIN_DOT_GAP && _dsy < _rc.bottom + MIN_DOT_GAP) {
          let _ex = _lcx - _dsx;
          let _ey = _lcy - _dsy;
          const _elen = Math.sqrt(_ex * _ex + _ey * _ey);
          if (_elen < 1) { _ex = 1; _ey = 0; } else { _ex /= _elen; _ey /= _elen; }
          const _halfW = (_rc.right - _rc.left) * 0.5;
          const _halfH = (_rc.bottom - _rc.top) * 0.5;
          // Amount needed to push the nearest rect edge clear of the dot + gap
          const _pushPx = MIN_DOT_GAP + _halfW * Math.abs(_ex) + _halfH * Math.abs(_ey) - _elen;
          if (_pushPx > 0) {
            const _pushW = _pushPx / Math.max(candidate.pixelsPerWorldUnit, 1e-6);
            // Determine which direction along the placement axis matches our push direction
            const _pushDir = candidate.entry.labelDirection;
            const _ldSample = candidate.entry.labelAnchor.clone().add(_pushDir);
            const _ldWorld = marsGroup.localToWorld(_ldSample);
            const _ldP = _ldWorld.clone().project(camera);
            const _ldSx = ((_ldP.x + 1) * 0.5) * viewportWidth - _dsx;
            const _ldSy = ((1 - _ldP.y) * 0.5) * viewportHeight - _dsy;
            const _sign = (_ldSx * _ex + _ldSy * _ey) >= 0 ? 1 : -1;
            candidate.entry.sprite.position.addScaledVector(candidate.entry.labelDirection, _sign * _pushW);
            // Keep line endpoint in sync with nudged sprite position.
            if (candidate.entry.line) {
              const _ncs = getEntryConnectorStart(candidate.entry);
              const _np = candidate.entry.sprite.position;
              setLinePoints(candidate.entry.line, _ncs.x, _ncs.y, _ncs.z, _np.x, _np.y, _np.z);
            }
            // Cache the absolute nudged position so apply frames don't revert it.
            candidate.entry._pc = { phase: 'abs', localPos: candidate.entry.sprite.position.clone() };
          }
        }
      }
    }
    // If placeForceLabel didn't run (or wasn't needed), record baked position.
    if (candidate.entry._pc?.hidden) candidate.entry._pc = { phase: 0 };
    candidate.entry.sprite.visible = true;
    if (candidate.entry.line) {
      candidate.entry.line.visible = true;
    }
    occupiedRects.push(candidate.rect);
  } // end _needsSolve commit loop
  if (_needsSolve) {
    // Diagnostic surface for the flight-label work: which layout ran, how many
    // entries reached the solve, how many became candidates, and how many were
    // actually committed visible.
    let _llWin = 0;
    for (const e of entries) if (e.sprite && e.sprite.visible) _llWin++;
    window.__llStats = {
      mosaic: !!useMosaicCloseLayout,
      entries: entries.length,
      candidates: candidates.length,
      winners: _llWin,
      solves: ((window.__llStats && window.__llStats.solves) || 0) + 1,
    };
  }

  if (_needsSolve) {
    entries._sv.q = camera.quaternion.clone();
    entries._sv.d = cameraDistance;
    entries._sv.valid = true;
  } else {
    // Apply pass — reposition labels from cache without re-running overlap checks.
    // Phase 2 (compass) entries track the current camera basis for smooth rotation.
    // Phase 1 (baked direction) entries are world-space stable; re-apply to handle zoom.
    // Phase 0 entries were already positioned by applyLabelOffset in the per-entry loop.
    const _apScratch = new THREE.Vector3(); // reused across entries — no per-entry alloc
    for (const entry of entries) {
      const _pc = entry._pc;
      if (!_pc || _pc.hidden) continue;
      if (!entry.marker?.visible) { entry.sprite.visible = false; continue; }

      if (_pc.phase === 2 && entry.labelAnchor && entry.labelNormal) {
        entry.marker.getWorldPosition(_apScratch);
        const _ppu = fovScale / Math.max(camera.position.distanceTo(_apScratch), 0.001);
        const _hw = entry.sprite.scale.x * 0.5;
        const _hh = entry.sprite.scale.y * 0.5;
        const _gw = 14 / Math.max(_ppu, 1);
        const [rs_s, us_s] = COMPASS_SIGNS[_pc.slotIdx];
        const _rs = rs_s * (_hw + _gw);
        const _us = us_s * (_hh + _gw);
        tempSpritePos.copy(entry.labelAnchor)
          .addScaledVector(entry.labelNormal, 0.22)
          .addScaledVector(_camRightLocal, _rs)
          .addScaledVector(_camUpLocal, _us);
        entry.sprite.position.copy(tempSpritePos);
        if (entry.line) {
          const cs = getEntryConnectorStart(entry);
          setLinePoints(entry.line, cs.x, cs.y, cs.z, tempSpritePos.x, tempSpritePos.y, tempSpritePos.z);
          entry.line.visible = true;
        }
      } else if (_pc.phase === 1 && entry.labelAnchor && entry.labelNormal && entry.labelDirection) {
        tempSpritePos.copy(entry.labelAnchor)
          .addScaledVector(entry.labelNormal, 0.22)
          .addScaledVector(entry.labelDirection, (entry.labelDistance || 0.52) * _pc.factor * _pc.dirMult)
          .addScaledVector(entry.labelUp || _apScratch.set(0,0,0), (entry.labelPushUp || 0) + _pc.upOff)
          .addScaledVector(entry.labelEast || _apScratch.set(0,0,0), entry.labelPushEast || 0);
        entry.sprite.position.copy(tempSpritePos);
        if (entry.line) {
          const cs = getEntryConnectorStart(entry);
          setLinePoints(entry.line, cs.x, cs.y, cs.z, tempSpritePos.x, tempSpritePos.y, tempSpritePos.z);
          entry.line.visible = true;
        }
      } else if (_pc.phase === 'abs') {
        // Dot-gap nudge was applied at solve time — restore that exact position.
        entry.sprite.position.copy(_pc.localPos);
        if (entry.line) {
          const cs = getEntryConnectorStart(entry);
          const lp = _pc.localPos;
          setLinePoints(entry.line, cs.x, cs.y, cs.z, lp.x, lp.y, lp.z);
          entry.line.visible = true;
        }
      } else {
        // Phase 0: position already set by per-entry applyLabelOffset — just show.
        if (entry.line) entry.line.visible = true;
      }
      entry.sprite.visible = true;
    }
  }

  if (globalView) {
    for (const entry of entries) {
      entry._globalVisible = !!entry.sprite?.visible;
    }
  }
}
