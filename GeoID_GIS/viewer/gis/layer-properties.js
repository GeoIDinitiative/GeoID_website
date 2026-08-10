import * as THREE from "../vendor/three.module.js";
import { placeLocalModel, placeGeoreferencedModel } from "./geo-utils.js?v=20260810-596d640";
import { CRS_OPTIONS, projectedToLatLon } from "./projection.js?v=20260810-596d640";

// Derived from ETNA_3_chambers/station_data.txt (summit station at local
// 50000,50000) against Etna's true summit at 37.751N 14.993E.
export const ETNA_PRESET = { crs: "epsg:32633", offsetX: 449383, offsetY: 4128189 };

/**
 * Anchors a model to real coordinates: the source bounding box centre is
 * shifted by the false easting/northing that was baked into the export, run
 * through the chosen CRS, and the model is then placed and scaled on the globe.
 *
 * The reference Etna mesh is a 0-100000 local grid that is EPSG:32633 with
 * +450000E / +4125000N removed, which is why the offsets are user-editable.
 */
export function applyModelGeoreference(layer, config) {
  const bounds = layer.object3D?.userData?.sourceBounds;
  if (!bounds) {
    return { ok: false, message: "This layer has no source coordinates." };
  }
  const {
    crs, offsetX = 0, offsetY = 0, unitsPerMetre = 1,
    verticalExaggeration = 1, liftM = 0,
  } = config;
  if (!crs || crs === "none") {
    layer.georef = null;
    placeLocalModel(layer.object3D, window.GeoIDModeManager?.getMode?.());
    return { ok: true, message: "Georeferencing cleared." };
  }

  const centreX = (bounds.minX + bounds.maxX) / 2 + offsetX;
  const centreY = (bounds.minY + bounds.maxY) / 2 + offsetY;
  const latLon = projectedToLatLon(centreX, centreY, crs);
  if (!latLon || !Number.isFinite(latLon.lat) || !Number.isFinite(latLon.lon)) {
    return { ok: false, message: "Could not convert those coordinates." };
  }

  const sourceRadius = layer.object3D.geometry?.boundingSphere?.radius || 1;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  const placement = placeGeoreferencedModel(layer.object3D, {
    lat: latLon.lat,
    lon: latLon.lon,
    metresPerSourceUnit: 1 / (unitsPerMetre || 1),
    sourceRadius,
    altitudeM: centreZ / (unitsPerMetre || 1),
    verticalExaggeration,
    liftM,
  });

  layer.georef = { ...config, lat: latLon.lat, lon: latLon.lon };
  layer.bounds = null;
  return {
    ok: true,
    lat: latLon.lat,
    lon: latLon.lon,
    message: `Anchored at ${latLon.lat.toFixed(4)}, ${latLon.lon.toFixed(4)}`,
    sceneRadius: placement.sceneRadius,
  };
}

// Styling reaches into every material under a layer, because imported layers
// are sometimes a single mesh and sometimes a group (shapefiles emit lines and
// points together).
function eachMaterial(object3D, fn) {
  object3D.traverse((child) => {
    const material = child.material;
    if (Array.isArray(material)) {
      material.forEach(fn);
    } else if (material) {
      fn(material);
    }
  });
}

export function setLayerOpacity(layer, opacity) {
  eachMaterial(layer.object3D, (material) => {
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.needsUpdate = true;
  });
  layer.style = { ...(layer.style || {}), opacity };
}

export function setLayerColor(layer, hex) {
  eachMaterial(layer.object3D, (material) => {
    // Textured rasters carry their own colour ramp; tinting them would hide it.
    if (material.map) {
      return;
    }
    material.color?.set(hex);
    material.needsUpdate = true;
  });
  layer.style = { ...(layer.style || {}), color: hex };
}

export function setLayerWireframe(layer, wireframe) {
  eachMaterial(layer.object3D, (material) => {
    if ("wireframe" in material) {
      material.wireframe = wireframe;
      material.needsUpdate = true;
    }
  });
  layer.style = { ...(layer.style || {}), wireframe };
}

/** Uniform scale multiplier applied on top of the import-time normalisation. */
export function setModelScale(layer, multiplier) {
  layer.style = { ...(layer.style || {}), scaleMultiplier: multiplier };
  const base = layer.object3D.userData.baseScale || 1;
  const mode = window.GeoIDModeManager?.getMode?.();
  placeLocalModel(layer.object3D, mode);
  // placeLocalModel resets scale from baseScale, so re-apply the multiplier.
  layer.object3D.scale.multiplyScalar(multiplier);
  return base;
}

export function setModelRotation(layer, degrees) {
  layer.style = { ...(layer.style || {}), rotationDeg: degrees };
  const radians = THREE.MathUtils.degToRad(degrees);
  const mode = window.GeoIDModeManager?.getMode?.();
  placeLocalModel(layer.object3D, mode);
  layer.object3D.rotateY(radians);
  const multiplier = layer.style.scaleMultiplier || 1;
  if (multiplier !== 1) {
    layer.object3D.scale.multiplyScalar(multiplier);
  }
}

/**
 * Radial offset for draped georeferenced layers, so overlapping layers can be
 * separated instead of z-fighting on the globe surface.
 */
export function setDrapeOffset(layer, offset) {
  layer.style = { ...(layer.style || {}), drapeOffset: offset };
  const previous = layer._appliedDrapeOffset || 0;
  const delta = offset - previous;
  if (delta !== 0) {
    layer.object3D.traverse((child) => {
      const position = child.geometry?.attributes?.position;
      if (!position) {
        return;
      }
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i += 1) {
        vertex.fromBufferAttribute(position, i);
        const length = vertex.length();
        if (length > 0.0001) {
          vertex.multiplyScalar((length + delta) / length);
          position.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }
      }
      position.needsUpdate = true;
      child.geometry.computeBoundingSphere();
    });
  }
  layer._appliedDrapeOffset = offset;
}

function row(labelText, control) {
  const wrap = document.createElement("div");
  wrap.className = "layer-prop-row";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(control);
  return wrap;
}

function slider(min, max, step, value, onInput) {
  const input = document.createElement("input");
  input.type = "range";
  input.className = "slider layer-prop-slider";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => onInput(Number(input.value)));
  return input;
}

function numberField(value, step = 1) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "input layer-prop-number";
  input.step = String(step);
  input.value = String(value);
  return input;
}

/** CRS + false-origin controls that anchor a model to real coordinates. */
function buildGeorefControls(layer) {
  const wrap = document.createElement("div");
  wrap.className = "layer-georef";

  const bounds = layer.object3D.userData.sourceBounds;
  const existing = layer.georef || {};

  const extent = document.createElement("p");
  extent.className = "tool-copy layer-georef-extent";
  extent.textContent = bounds
    ? `Source extent X ${Math.round(bounds.minX)}..${Math.round(bounds.maxX)}, Y ${Math.round(bounds.minY)}..${Math.round(bounds.maxY)}`
    : "No source coordinates available.";
  wrap.appendChild(extent);

  const select = document.createElement("select");
  select.className = "mini-select";
  CRS_OPTIONS.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.id;
    opt.textContent = option.label;
    if (existing.crs === option.id) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  wrap.appendChild(row("Source CRS", select));

  const offsetX = numberField(existing.offsetX ?? 0, 1000);
  const offsetY = numberField(existing.offsetY ?? 0, 1000);
  wrap.appendChild(row("False East", offsetX));
  wrap.appendChild(row("False North", offsetY));

  const status = document.createElement("div");
  status.className = "gis-metric layer-georef-status";
  status.textContent = existing.lat !== undefined
    ? `Anchored at ${existing.lat.toFixed(4)}, ${existing.lon.toFixed(4)}`
    : "Not anchored.";

  // Re-anchoring with the current control values; used by the live sliders so
  // exaggeration and lift take effect without re-entering the CRS.
  const reapply = () => {
    if (!layer.georef?.crs) {
      return;
    }
    const result = applyModelGeoreference(layer, {
      crs: select.value,
      offsetX: Number(offsetX.value) || 0,
      offsetY: Number(offsetY.value) || 0,
      verticalExaggeration: Number(vertEx.value) || 1,
      liftM: Number(lift.value) || 0,
    });
    status.textContent = `${result.message} | ${vertEx.value}x vertical`;
  };

  const vertEx = slider(1, 60, 1, existing.verticalExaggeration ?? 1, reapply);
  const lift = slider(0, 50000, 500, existing.liftM ?? 0, reapply);
  wrap.appendChild(row("Vert. exagg.", vertEx));
  wrap.appendChild(row("Lift (m)", lift));

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "button secondary layer-georef-apply";
  apply.textContent = "Anchor To Coordinates";
  apply.addEventListener("click", () => {
    const result = applyModelGeoreference(layer, {
      crs: select.value,
      offsetX: Number(offsetX.value) || 0,
      offsetY: Number(offsetY.value) || 0,
    });
    status.textContent = result.message;
  });

  // The Etna mesh is the known case in this repo, so its offsets are one click
  // away. They are derived from the model's own control point rather than
  // assumed: ETNA_3_chambers/station_data.txt places the summit station at
  // local (50000, 50000, 3300.1) — the domain centre — and Etna's summit is
  // 37.751N 14.993E, which is E 499383 / N 4178189 in UTM 33N. Using the round
  // numbers 450000/4125000 instead lands the model ~3.2 km off.
  const preset = document.createElement("button");
  preset.type = "button";
  preset.className = "button secondary layer-georef-apply";
  preset.textContent = "Etna preset (UTM 33N)";
  preset.addEventListener("click", () => {
    select.value = "epsg:32633";
    offsetX.value = String(ETNA_PRESET.offsetX);
    offsetY.value = String(ETNA_PRESET.offsetY);
    const result = applyModelGeoreference(layer, ETNA_PRESET);
    status.textContent = result.message;
  });

  wrap.appendChild(apply);
  wrap.appendChild(preset);
  wrap.appendChild(status);
  return wrap;
}

/** Builds the property controls appropriate to the layer's kind. */
export function buildLayerProperties(layer) {
  const host = document.createElement("div");
  host.className = "layer-prop-panel";
  const style = layer.style || {};

  host.appendChild(row("Opacity", slider(0.05, 1, 0.05, style.opacity ?? 1,
    (value) => setLayerOpacity(layer, value))));

  const hasTexture = (() => {
    let textured = false;
    eachMaterial(layer.object3D, (material) => { if (material.map) textured = true; });
    return textured;
  })();

  if (!hasTexture) {
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "layer-prop-color";
    colorInput.value = style.color || "#d8dee9";
    colorInput.addEventListener("input", () => setLayerColor(layer, colorInput.value));
    host.appendChild(row("Colour", colorInput));
  }

  const isMesh = layer.object3D.isMesh || layer.object3D.type === "Mesh";
  if (isMesh) {
    const wire = document.createElement("input");
    wire.type = "checkbox";
    wire.checked = Boolean(style.wireframe);
    wire.addEventListener("change", () => setLayerWireframe(layer, wire.checked));
    host.appendChild(row("Wireframe", wire));
  }

  if (layer.object3D.userData.localModel) {
    host.appendChild(row("Scale", slider(0.1, 5, 0.1, style.scaleMultiplier ?? 1,
      (value) => setModelScale(layer, value))));
    host.appendChild(row("Rotate", slider(0, 360, 5, style.rotationDeg ?? 0,
      (value) => setModelRotation(layer, value))));
    host.appendChild(buildGeorefControls(layer));
  } else if (layer.georeferenced) {
    host.appendChild(row("Drape lift", slider(0, 0.1, 0.002, style.drapeOffset ?? 0,
      (value) => setDrapeOffset(layer, value))));
  }

  return host;
}
