// Earth Flight's place labels: the Mars flight sim's, verbatim.
//
// Owner, 2026-10-24: "look at mars flight sim implementation, it has
// conditional visibility relative to location, horizon position and
// neighbouring labels (hierarchy based on significance) - needs to be copied
// verbatim". So this is not a re-implementation. It runs the Mars viewer's
// own label module, planet_explorer/mars/viewer/label-layer.js, unchanged --
// buildLabelLayer, updateLabelVisibility (its declutter: significance, label
// density, screen overlap, the mosaic close layout) and updateLabelAnchors --
// and below, between the markers, the Mars viewer's flight "horizon POI
// system" (mars-viewer.js, render(), "FLIGHT-SIM: horizon POI system"),
// copied byte for byte (Earth's few changes are marked EARTH):
//
//   * a place whose GROUND POINT clears the horizon (with hysteresis) is the
//     standard label, re-anchored straight above its dot, and drawn only
//     while the place itself is inside the view;
//   * a place beyond the horizon is a skyline flag -- a category triangle, its
//     name and its range -- sitting just above the sampled skyline in its
//     direction, fading and shrinking with distance past the horizon;
//   * flags are decluttered by significance first (item.lod), then azimuth
//     bins (14 named, 40 triangles at most), then actual screen overlap, the
//     less significant one always losing.
//
// What Earth supplies is only what the Mars viewer supplied from its own
// scope: the places (the Location labels switch's set, GeoIDViewer.
// getPlaceLabels), the ground under them (the globe frame plus Earth
// Flight's terrain, flight-terrain.js), the skyline heights, and the radius.
// The globe's own place labels stand down in flight (earth-viewer.js,
// updateLabelVisibility) so the two never double up.

import * as THREE from "../vendor/three.module.js";
// The Mars module, loaded when flight labels start: it imports three.js by an
// absolute web path, which only a browser resolves (Node tests import this file).
const MARS_LABELS = "../../../planet_explorer/mars/viewer/label-layer.js?v=20261024-d21ca2f";
let buildLabelLayer = null, updateLabelVisibility = null, updateLabelAnchors = null, makeLabelTexture = null;

/* ── What the Mars viewer's scope provided, from Earth ─────────────────── */

// label-layer.js reads MARS_RADIUS_METERS as a bare global in its close-zoom
// marker sizing (the Mars viewer sets window.MARS_RADIUS_METERS for exactly
// this, mars-viewer.js "FLIGHT-SIM"); on Earth it is Earth's radius. The
// horizon block below reads the module-scope one for its range readout.
const MARS_RADIUS_METERS = 6371000;
if (typeof window !== "undefined" && window.MARS_RADIUS_METERS === undefined) window.MARS_RADIUS_METERS = MARS_RADIUS_METERS;
// The Mars viewer's CTX streamer, core view and landing-site layer: Earth
// Flight has none of them.
const ctxDetailStreamer = null, baseLayerSelect = null, baseSiteLayer = null;
const coreToggle = { checked: false };
// Skyline heights. Mars samples its normalised elevation map x the relief;
// Earth's are the flight terrain's drawn heights in scene units, so relief is
// 1. The Mars block's longitude, atan2(z, -x), reads the opposite meridian in
// Earth's globe frame (lon = atan2(-z, x)), hence the half turn.
const elevationSampler = true;
const getEffectiveTerrainRelief = () => 1;
function sampleElevationNormalized(_sampler, lat, lonE) {
  const lon = ((lonE - 180) % 360 + 540) % 360 - 180;
  return window.GeoIDFlightTerrain?.heightUnits?.(lat, lon) || 0;
}

/** A place on the ground, in the globe's frame, on Earth Flight's terrain. */
function getReliefPoint(radius, _sampler, _cache, _relief, lat, lon, lift = 0) {
  const viewer = window.GeoIDViewer;
  const p = viewer.surfacePoint(lat, lon, 0);
  const v = new THREE.Vector3(-p.x, p.y, -p.z);
  v.setLength(v.length() + (window.GeoIDFlightTerrain?.heightUnits?.(lat, lon) || 0) + lift);
  return v;
}

/*
 * EARTH: relevance. The Mars pass flags every feature on the near side of
 * the planet; on Earth that put Berlin and Scandinavia on the skyline over
 * Wales (reported: "be more intuitive"). So a place is labelled only within
 * reach -- about three horizons (150-700 km), a little further for the most
 * significant (lod 1 x1.6, lod 2 x1.25) -- and an AREA name (an island, a
 * landform, a sea) is dropped while the aircraft is inside or near it: the
 * HUD names where you are (gis/flight-place.js), and "Great Britain" hung
 * over Great Britain says nothing.
 */
const AREA_CATEGORIES = new Set(["place-island", "place-landform", "place-marine"]);
function earthHidden(entry, km, altKm, beyondHorizon) {
  // The Location legend's category ticks (Cities, Islands, Seas...).
  if (entry.item?.category && window.GeoIDViewer?.isPlaceCategoryEnabled?.(entry.item.category) === false) return true;
  const lod = Number(entry.item?.lod) || 3;
  const horizonKm = Math.sqrt(2 * (MARS_RADIUS_METERS / 1000) * Math.max(0.05, altKm));
  const reach = Math.min(700, Math.max(150, 3 * horizonKm)) * (lod <= 1 ? 1.6 : lod === 2 ? 1.25 : 1);
  if (km > reach) return true;
  if (!beyondHorizon && AREA_CATEGORIES.has(entry.item?.category)) {
    const areaKm = lod <= 1 ? 500 : lod === 2 ? 200 : 60;
    if (km < areaKm) return true;
  }
  return false;
}

let labelLayer = null;
let itemsKey = "";
let terrainVersion = -1;
let frame = null;
let frameCount = 0;
let lastAnchorAt = 0;
let lastItemsAt = 0;

function rebuild(viewer, items) {
  dispose();
  labelLayer = buildLabelLayer(3.2, null, null, null, getReliefPoint, items);
  // EARTH: the Location legend's colours. Each place carries its category's
  // colour and chip palette (earth-viewer.js PLACE_CATEGORIES: cities white,
  // islands green, seas blue...); Mars builds a label from its own themes,
  // so the build is wrapped: the chip is made with the place's palette
  // before Mars's lazy path would make a themed one, and the dot, the leader
  // and the horizon triangle (which copies the dot) take its colour.
  const build = labelLayer.entries._buildEntry;
  labelLayer.entries._buildEntry = (entry) => {
    build(entry);
    const item = entry.item;
    if (item.label_colour) {
      entry.marker?.material?.color?.set(item.label_colour);
      entry.line?.material?.color?.set(item.label_colour);
    }
    if (item.label_palette && entry.sprite && !entry.sprite.material.map) {
      const t = makeLabelTexture(item, { customPalette: item.label_palette, backingScale: 1 });
      entry.sprite.material.map = t.texture;
      entry.sprite.material.needsUpdate = true;
      const k = item.lod === 1 ? 1.55 : item.lod === 2 ? 1.30 : item.lod === 3 ? 1.10 : item.lod === 5 ? 0.88 : 1.0;
      entry.sprite.scale.set((t.width / 200) * 0.66 * k, (t.height / 200) * 0.66 * k, 1);
      entry.baseScale = entry.sprite.scale.clone();
    }
  };
  labelLayer.group.name = "GeoID-FlightPlaceLabels";
  viewer.globe.add(labelLayer.group);
}

function dispose() {
  if (!labelLayer) return;
  for (const e of labelLayer.entries) labelLayer.entries._disposeEntry?.(e);
  for (const e of labelLayer.entries) {
    for (const k of ["_fsTri", "_fsHLabel", "_fsDist"]) {
      if (!e[k]) continue;
      e[k].parent?.remove(e[k]);
      e[k].material.dispose();
    }
  }
  labelLayer.group.parent?.remove(labelLayer.group);
  labelLayer = null;
}

function step() {
  frame = requestAnimationFrame(step);
  const viewer = window.GeoIDViewer;
  if (!viewer?.globe || !viewer.camera || !viewer.renderer || !window.__flightSim?.active) return;
  // The place set (the Location labels switch, its categories) is a 13k-item
  // list: look at it once a second, not every frame.
  if (performance.now() - lastItemsAt > 1000 || !itemsKey) {
    lastItemsAt = performance.now();
    const items = viewer.getPlaceLabels?.() || [];
    const key = `${items.length}|${items[0]?.name || ""}|${items[items.length - 1]?.name || ""}`;
    if (key !== itemsKey) { itemsKey = key; if (items.length) rebuild(viewer, items); else dispose(); terrainVersion = -1; }
  }
  if (!labelLayer) return;
  const camera = viewer.camera, renderer = viewer.renderer, globe = viewer.globe;
  // The ground under the places moves as the terrain streams in: re-anchor,
  // as the Mars viewer does when its relief changes, at most once a second.
  const tv = window.GeoIDFlightTerrain?.getVersion?.() ?? 0;
  if (tv !== terrainVersion && performance.now() - lastAnchorAt > 1000) {
    terrainVersion = tv; lastAnchorAt = performance.now();
    updateLabelAnchors(labelLayer, null, null, null, 3.2, getReliefPoint);
  }
  // The Mars viewer's render(): the declutter verdict on "heavy" frames (every
  // third while moving -- in flight the camera always is), then the horizon pass.
  frameCount += 1;
  const _heavyFrame = frameCount % 3 === 0;
  if (_heavyFrame) {
    updateLabelVisibility(
      labelLayer.entries,
      globe,
      globe,
      camera,
      renderer,
      true,
      true,
      true,
      true,
      false,
      true,
      Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
      true,
      true,
      true,
      viewer.getLabelDensity?.() ?? 3,
      null,
      null,
      () => false,
      null,
      null,
    );
    for (const e of labelLayer.entries) e._fsBaseVisible = e.sprite ? e.sprite.visible : false;
  }
  {
    // ── FLIGHT-SIM: horizon POI system (mars-viewer.js, verbatim) ──────────
  if (!window.__fsTriTex) { // white glyph so per-category tinting works
    const _c = document.createElement("canvas"); _c.width = 64; _c.height = 64;
    const _g = _c.getContext("2d");
    _g.beginPath(); _g.moveTo(6, 12); _g.lineTo(58, 12); _g.lineTo(32, 56); _g.closePath();
    _g.fillStyle = "#ffffff"; _g.fill();
    _g.lineWidth = 5; _g.strokeStyle = "rgba(8,10,14,0.9)"; _g.stroke();
    window.__fsTriTex = new THREE.CanvasTexture(_c);
  }
  const grp = labelLayer.group;
  const camLocal = grp.worldToLocal(camera.position.clone()); // camera in label/map frame
  const d = camLocal.length() || 1;
  const Chat = camLocal.clone().multiplyScalar(1 / d);        // radial "up" at the camera
  const Rg = globe.geometry?.parameters?.radius || 3.2;
  const relief = Math.max(0, (typeof getEffectiveTerrainRelief === "function" ? getEffectiveTerrainRelief() : 0) || 0);
  let tileLift = 0; // CTX tiles float above the datum; the skyline includes that
  if (ctxDetailStreamer && (baseLayerSelect?.value === "ctx-mosaic" || baseLayerSelect?.value === "ctx-mosaic-color")) {
    tileLift = (ctxDetailStreamer.surfaceLiftBase || 0) + relief * (ctxDetailStreamer.surfaceLiftReliefFactor || 0);
  }
  // Robust viewport height: clientHeight is 0 while the tab isn't
  // compositing (hidden/mid-resize) — fall back to the drawing buffer
  // then the window so pixel→angle math never degenerates.
  const vpH = renderer.domElement.clientHeight || renderer.domElement.height || window.innerHeight || 800;
  const fovScale = vpH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
  const anglePerPx = 1 / Math.max(fovScale, 1e-4);            // radians per screen pixel
  const alpha = Math.acos(Math.max(-1, Math.min(1, Rg / d))); // camera's horizon angle
  const Dh = Math.sqrt(Math.max(d * d - Rg * Rg, 1e-8));      // slant distance to the horizon
  const uppH = Dh * anglePerPx;                               // world units per px at the horizon
  const EPS = 0.008;                                          // hysteresis band (rad)
  const canSample = typeof sampleElevationNormalized === "function" && elevationSampler;
  // View-cone culling: labels/proxies for features to the SIDE or BEHIND
  // the camera are dropped outright. Without this, a behind-camera anchor
  // can still project onto the screen ("forced into view" far from the
  // real location). Proxies cull at the frustum edge + margin.
  const fwdLocal = grp.worldToLocal(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position)).sub(camLocal).normalize();
  const vpW = renderer.domElement.clientWidth || renderer.domElement.width || window.innerWidth || vpH * 1.7;
  const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * (vpW / vpH));
  const COS_PROXY_CULL = Math.cos(Math.min(hHalf + 0.21, 1.45)); // horizontal frustum edge + ~12°
  const fwdH = fwdLocal.clone().addScaledVector(Chat, -fwdLocal.dot(Chat)); // forward azimuth on the horizon
  const fwdHValid = fwdH.lengthSq() > 1e-6;
  if (fwdHValid) fwdH.normalize();
  const lookV = new THREE.Vector3();
  const upV = new THREE.Vector3();
  // "Location out of view → label dropped": the authoritative test is the
  // FEATURE's own position against the view frustum (+20% margin), not the
  // sprite's — anchors lift sprites far above markers, so a just-passed
  // feature's label could otherwise hang on-screen with its location
  // already out of frame behind the ship.
  camera.updateMatrixWorld();
  if (!window.__fsCamInv) window.__fsCamInv = new THREE.Matrix4();
  const camInv = window.__fsCamInv.copy(camera.matrixWorld).invert();
  const grpM = grp.matrixWorld;
  const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  const aspect = vpW / vpH;
  const markerInView = (Plocal) => {
    lookV.copy(Plocal).applyMatrix4(grpM).applyMatrix4(camInv); // → camera space
    if (lookV.z > -1e-4) return false;                          // behind the camera
    const lim = -lookV.z * tanHalfV * 1.2;
    return Math.abs(lookV.y) <= lim && Math.abs(lookV.x) <= lim * aspect;
  };
  const cullStats = { promotedShown: 0, promotedCulled: 0, proxiesShown: 0, baseCulled: 0 };
  const hideProxies = (e) => {
    if (e._fsTri) e._fsTri.visible = false;
    if (e._fsHLabel) e._fsHLabel.visible = false;
    if (e._fsDist) e._fsDist.visible = false;
    e._fsRamp = 0;
  };
  // Cached distance-readout textures. Cached by STRING, and the value is
  // rounded to coarse steps, so a feature 300 km out does not mint a new
  // texture every frame as the range ticks down.
  if (!window.__fsDistTex) window.__fsDistTex = new Map();
  const fsDistTexture = (txt) => {
    const cache = window.__fsDistTex;
    const hit = cache.get(txt);
    if (hit) return hit;
    const fsz = 34, pad = 9;
    const meas = document.createElement("canvas").getContext("2d");
    meas.font = `600 ${fsz}px "Exo 2", sans-serif`;
    const cv = document.createElement("canvas");
    cv.width = Math.max(8, Math.ceil(meas.measureText(txt).width) + pad * 2);
    cv.height = fsz + pad * 2;
    const g2 = cv.getContext("2d");
    g2.font = `600 ${fsz}px "Exo 2", sans-serif`;
    g2.textAlign = "center";
    g2.textBaseline = "middle";
    g2.lineWidth = 6;
    g2.strokeStyle = "rgba(8,10,14,0.92)";
    g2.strokeText(txt, cv.width / 2, cv.height / 2);
    g2.fillStyle = "#bfe0ff";
    g2.fillText(txt, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    if (cache.size > 160) {
      for (const k of cache.keys()) {
        cache.get(k)?.dispose?.();
        cache.delete(k);
        if (cache.size <= 120) break;
      }
    }
    cache.set(txt, tex);
    return tex;
  };
  // Screen box of a sprite, in CSS pixels. Sprites are sized in WORLD
  // units, so the pixel size follows from the perspective relation
  // pxPerUnit = viewportH / (2 * dist * tan(fov/2)). Returns null behind
  // the camera, where the projection is meaningless.
  // PERF, and this one froze the main thread: `clientWidth`/`clientHeight`
  // force a style+layout flush on every read. Reading them INSIDE this
  // helper meant one forced layout per label per frame — hundreds per
  // frame at max label density — which locks the browser. They are hoisted
  // to once per frame here, along with the constant fov term. The scratch
  // vectors likewise avoid allocating two Vector3 per label per frame.
  const _srVw = renderer.domElement.clientWidth || 1;
  const _srVh = renderer.domElement.clientHeight || 1;
  const _srTanHalfFov = Math.tan((camera.fov * Math.PI / 180) / 2);
  const _srV = new THREE.Vector3();
  const _srN = new THREE.Vector3();
  const spriteScreenRect = (sprite) => {
    if (!sprite) return null;
    _srV.copy(sprite.position);
    grp.localToWorld(_srV);
    const dist = camera.position.distanceTo(_srV);
    if (!(dist > 1e-9)) return null;
    const ndc = _srN.copy(_srV).project(camera);
    if (ndc.z > 1) return null;                      // behind the camera
    const vh = _srVh, vw = _srVw;
    const pxPerUnit = vh / (2 * dist * _srTanHalfFov);
    const hPx = sprite.scale.y * pxPerUnit;
    const wPx = sprite.scale.x * pxPerUnit;
    const cx = (ndc.x * 0.5 + 0.5) * vw;
    const cy = (-ndc.y * 0.5 + 0.5) * vh;
    // 2 px of padding so boxes that merely touch still count as clashing.
    return { l: cx - wPx / 2 - 2, r: cx + wPx / 2 + 2,
             t: cy - hPx / 2 - 2, b: cy + hPx / 2 + 2 };
  };
  const rectsOverlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

  // Every box already claimed this frame: real in-view labels first (they
  // always win), then proxy names in significance order.
  const occupiedRects = [];

  // Pass 1 — classify every label: in view (promote) or beyond horizon.
  const candidates = [];
  const promoted = [];
  for (const entry of labelLayer.entries) {
    if (!entry || !entry.sprite || !entry.marker) continue;
    // Base visibility = the viewer's own declutter verdict, refreshed on
    // "heavy" frames (updateLabelVisibility just recomputed sprite.visible
    // earlier in this same render pass); light frames keep the last known.
    if ((_heavyFrame && !coreToggle.checked) || entry._fsBaseVisible === undefined) entry._fsBaseVisible = !!entry.sprite.visible;
    if (!entry._fsBaseVisible) { hideProxies(entry); continue; }
    const P = entry.marker.position;
    const R = P.length() || 1;
    const cosG = (P.x * Chat.x + P.y * Chat.y + P.z * Chat.z) / R;
    const gamma = Math.acos(Math.max(-1, Math.min(1, cosG)));
    // GROUND-POINT horizon test (no anchor "reach"): label anchors float
    // well above the surface (relief + exaggeration lifts), and a high
    // anchor is genuinely line-of-sight visible far beyond the horizon —
    // which promoted full labels whose dot hung in the sky. A feature IS
    // its ground location: it counts as in view only once that location
    // clears the datum horizon.
    const over = gamma - alpha;            // >0 → ground point behind the planet's curve
    const wasOut = entry._fsMode === "out";
    const out = wasOut ? over > -EPS : over > EPS; // hysteresis
    entry._fsMode = out ? "out" : "in";
    // EARTH: only what is relevant from here (see earthHidden).
    if (earthHidden(entry, gamma * Rg * (MARS_RADIUS_METERS / 1000 / Rg), (d - Rg) * (MARS_RADIUS_METERS / 1000 / Rg), out)) {
      entry.sprite.visible = false;
      if (entry.line) entry.line.visible = false;
      entry.marker.visible = false;
      hideProxies(entry);
      continue;
    }
    if (!out) { // promote: the standard viewer label — shown only while the
      // feature's LOCATION is inside the view frustum; out of frame
      // (side/behind) the whole label is dropped, never forced on-screen.
      const onScreen = markerInView(P); // (leaves camera-space P in lookV)
      entry.sprite.visible = onScreen;
      if (entry.sprite.material) {
        entry.sprite.material.depthTest = false;
        // ...and no depth WRITE either. The ship is drawn after labels
        // (renderOrder 400 vs 201) but still depth-tests against the
        // terrain; a label writing depth nearer than the hull would
        // reject those fragments and the label would win anyway. This
        // is what let labels paint across the ship.
        entry.sprite.material.depthWrite = false;
      }
      if (entry.line) { entry.line.visible = onScreen; if (entry.line.material) entry.line.material.depthTest = false; }
      entry.marker.visible = onScreen;
      if (entry.marker.material) entry.marker.material.depthTest = false;
      if (onScreen) {
        // FLIGHT RE-ANCHOR: the orbit anchor lift is negligible at flight
        // proximity, leaving labels hugging the ground with a horizontal
        // connector. Re-anchor each frame: dot stays on the surface, the
        // label floats comfortably above it (≥1.4 label-heights, or a
        // 62 px screen-constant lift when that is larger), and the
        // connector is rewritten surface → label, i.e. sub-vertical.
        // Orbit anchors self-restore on exit via syncTerrainReliefState.
        const distCam = lookV.length();
        const lift = Math.max(distCam * anglePerPx * 62, entry.sprite.scale.y * 1.4);
        upV.copy(P).multiplyScalar(1 / (P.length() || 1)); // radial up at the feature
        entry.sprite.position.copy(P).addScaledVector(upV, lift);
        const lp = entry.line?.geometry?.attributes?.position;
        if (lp && lp.count === 2) {
          const endLift = Math.max(lift - entry.sprite.scale.y * 0.55, lift * 0.4);
          lp.array[0] = P.x; lp.array[1] = P.y; lp.array[2] = P.z;
          lp.array[3] = P.x + upV.x * endLift;
          lp.array[4] = P.y + upV.y * endLift;
          lp.array[5] = P.z + upV.z * endLift;
          lp.needsUpdate = true;
          entry.line.geometry.computeBoundingSphere?.();
        }
      }
      hideProxies(entry);
      // A REAL, in-view label always outranks a horizon proxy. Bank its
      // screen box so the declutter pass below can yield to it rather
      // than stacking a skyline flag on top of it.
      // EARTH: banked after the loop, most significant first (see below).
      if (onScreen) promoted.push({ entry, gamma });
      if (onScreen) cullStats.promotedShown++; else cullStats.promotedCulled++;
      continue;
    }
    entry.sprite.visible = false;
    if (entry.line) entry.line.visible = false;
    entry.marker.visible = false;
    if (cosG <= 0.03) { cullStats.farSide = (cullStats.farSide || 0) + 1; hideProxies(entry); continue; } // far side — not "upcoming"
    cullStats.candidates = (cullStats.candidates || 0) + 1;
    candidates.push({ entry, over, cosG, P, R });
  }
  // EARTH: in-view labels never overlap. They are re-anchored above their
  // dots after the viewer's declutter ran, so two near places could still
  // land on each other (reported: Newcastle over Sunderland). Most
  // significant first, then nearest; a label whose box is taken is hidden.
  promoted.sort((a, b) => ((Number(a.entry.item?.lod) || 3) - (Number(b.entry.item?.lod) || 3)) || (a.gamma - b.gamma));
  for (const { entry } of promoted) {
    const rect = spriteScreenRect(entry.sprite);
    if (rect && occupiedRects.some((r) => rectsOverlap(r, rect))) {
      entry.sprite.visible = false;
      if (entry.line) entry.line.visible = false;
      entry.marker.visible = false;
      cullStats.promotedDecluttered = (cullStats.promotedDecluttered || 0) + 1;
    } else if (rect) occupiedRects.push(rect);
  }
  // Pass 2 — declutter the horizon band: nearest feature wins each
  // azimuth bin, capped so the skyline never crowds.
  // MAX_NAMED caps how many carry a NAME; MAX_TRI is the larger cap on
  // bare triangles, which are cheap and are the "queued" state — a
  // feature keeps its marker so you can see it coming, and earns its
  // name when it wins a slot or comes into view.
  const MAX_NAMED = 14, MAX_TRI = 40, BIN_RAD = 6 * Math.PI / 180;
  let Ub = new THREE.Vector3(0, 1, 0).cross(Chat);
  if (Ub.lengthSq() < 1e-6) Ub = new THREE.Vector3(1, 0, 0).cross(Chat);
  Ub.normalize();
  const Vb = new THREE.Vector3().crossVectors(Chat, Ub);
  // SIGNIFICANCE FIRST, distance second. `lod` is the label-density rank
  // carried by every feature (1 = continent-scale, 5 = individual craters
  // that only appear at max density), so at high density the map floods
  // with lod-5 names that would otherwise win purely by being nearer.
  const sig = (c) => Number(c.entry.item?.lod) || 3;
  candidates.sort((a, b) => (sig(a) - sig(b)) || (a.over - b.over));
  const usedBins = new Set();
  const shown = [];
  for (const c of candidates) {
    const tang = c.P.clone().multiplyScalar(1 / c.R).addScaledVector(Chat, -c.cosG);
    if (tang.lengthSq() < 1e-9) { cullStats.degenerate = (cullStats.degenerate || 0) + 1; hideProxies(c.entry); continue; }
    tang.normalize();
    // Off-view azimuth (side/behind the heading) → drop; the horizon band
    // only flags what lies AHEAD, and bins aren't wasted on hidden ones.
    if (fwdHValid && tang.dot(fwdH) < COS_PROXY_CULL) { cullStats.azimuth = (cullStats.azimuth || 0) + 1; hideProxies(c.entry); continue; }
    if (shown.length >= MAX_TRI) { hideProxies(c.entry); continue; }
    // Losing the azimuth bin, or running past the name budget, DEMOTES to
    // a bare triangle instead of vanishing — that is the queue.
    const bin = Math.round(Math.atan2(tang.dot(Vb), tang.dot(Ub)) / BIN_RAD);
    const namedSlotFree = !usedBins.has(bin) && shown.filter((x) => x.named).length < MAX_NAMED;
    if (namedSlotFree) usedBins.add(bin);
    c.named = namedSlotFree;
    c.sig = sig(c);
    c.tang = tang;
    shown.push(c);
  }
  // Pass 3 — place the survivors just above the sampled skyline.
  const sDir = new THREE.Vector3(), sPos = new THREE.Vector3(), look = new THREE.Vector3();
  for (const c of shown) {
    const { entry, tang } = c;
    // Skyline elevation along this azimuth: the highest sightline angle
    // to terrain sampled at 60/85/100% of the way to the horizon.
    let maxSin = Math.sin(-alpha); // floor: the geometric (datum) horizon
    if (canSample) {
      // EARTH: close in too -- at a few hundred metres up the ridges that
      // hide the skyline are a few km away, not 60-100% of the horizon.
      for (const f of [0.02, 0.05, 0.1, 0.2, 0.35, 0.6, 0.85, 1.0]) {
        const a = alpha * f;
        sDir.copy(Chat).multiplyScalar(Math.cos(a)).addScaledVector(tang, Math.sin(a));
        const lat = Math.asin(Math.max(-1, Math.min(1, sDir.y))) * 180 / Math.PI;
        const lonE = ((Math.atan2(sDir.z, -sDir.x) * 180 / Math.PI) % 360 + 360) % 360;
        let en = 0.5;
        try { en = sampleElevationNormalized(elevationSampler, lat, lonE) ?? 0.5; } catch (_e) {}
        sPos.copy(sDir).multiplyScalar(Rg + en * relief + tileLift);
        look.copy(sPos).sub(camLocal);
        const sinE = look.dot(Chat) / (look.length() || 1);
        if (sinE > maxSin) maxSin = sinE;
      }
    }
    const eSky = Math.asin(Math.max(-1, Math.min(1, maxSin)));
    // Size + fade as a function of how far beyond the horizon it lies —
    // floors keep even the farthest flags readable.
    const t = Math.min(1, c.over / 0.9);
    const fade = 0.95 - t * 0.55;                 // 0.95 → 0.40
    // SIZE BY SIGNIFICANCE. lod 1 (continent-scale) draws ~15% larger than
    // the baseline, lod 5 (individual craters) ~15% smaller, so the
    // skyline reads as a hierarchy instead of a wall of equal flags.
    const sigScale = 1.18 - 0.075 * (c.sig || 3);   // lod1 1.10 → lod5 0.81
    const triPx = (16 - t * 5) * sigScale;
    const labPx = (18 - t * 4) * sigScale;
    const triH = uppH * triPx, labH = uppH * labPx;
    const liveMap = entry.sprite.material?.map || null;
    if (!entry._fsTri) {
      entry._fsTri = new THREE.Sprite(new THREE.SpriteMaterial({ map: window.__fsTriTex, transparent: true, depthTest: true, depthWrite: false }));
      entry._fsTri.renderOrder = 93; entry._fsTri.frustumCulled = false; grp.add(entry._fsTri);
      // Clickable, exactly like an in-view label: carry the feature and
      // join the raycast set. Hidden proxies are filtered out by the
      // existing isObjectActuallyVisible() test, so an off-horizon
      // triangle cannot be picked.
      entry._fsTri.userData.feature = entry.item;
      labelLayer.interactiveObjects.push(entry._fsTri);
    }
    if (!entry._fsHLabel && liveMap) {
      entry._fsHLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: liveMap, transparent: true, depthTest: true, depthWrite: false }));
      entry._fsHLabel.renderOrder = 93; entry._fsHLabel.frustumCulled = false; grp.add(entry._fsHLabel);
      entry._fsHLabel.userData.feature = entry.item;
      labelLayer.interactiveObjects.push(entry._fsHLabel);
    }
    if (entry.marker.material?.color) entry._fsTri.material.color.copy(entry.marker.material.color);
    entry._fsRamp = Math.min(1, (entry._fsRamp || 0) + 0.08); // fade-in, no popping
    const op = fade * entry._fsRamp;
    // Sightline elevation for the triangle: skyline + 8 px pad + half its height.
    const eTri = eSky + (8 + triPx * 0.5) * anglePerPx;
    sDir.copy(tang).multiplyScalar(Math.cos(eTri)).addScaledVector(Chat, Math.sin(eTri));
    entry._fsTri.visible = true;
    entry._fsTri.material.opacity = op;
    entry._fsTri.position.copy(camLocal).addScaledVector(sDir, Dh);
    entry._fsTri.scale.set(triH, triH, 1);
    // RANGE READOUT, directly under the triangle. Surface distance from
    // the ship's ground point to the feature's: cosG is the cosine of
    // the central angle between them, so gamma * Rg converts straight to
    // ground range. Rounded to coarse steps (5 / 10 / 50 km by
    // magnitude) so the text is stable to read and the texture cache
    // does not churn while closing on a target.
    {
      const gamma = Math.acos(Math.max(-1, Math.min(1, c.cosG)));
      const distKm = gamma * Rg * ((MARS_RADIUS_METERS / 1000) / 3.2);
      const stepKm = distKm < 100 ? 5 : distKm < 1000 ? 10 : 50;
      const shown = Math.max(stepKm, Math.round(distKm / stepKm) * stepKm);
      const txt = `${shown} km`;
      if (!entry._fsDist) {
        // depthTest OFF, unlike the glyph and name above it. The range sits
        // BELOW the triangle (eDist subtracts where the name adds), which
        // puts it right on the skyline, so a depth-tested sprite gets its
        // lower half eaten by the terrain it is annotating. The whole proxy
        // is an over-horizon readout — there is nothing in front of it that
        // should legitimately occlude it — and renderOrder 94 keeps it above
        // the glyph and name it belongs to.
        entry._fsDist = new THREE.Sprite(new THREE.SpriteMaterial({
          // EARTH: depth-tested like its glyph and name. Over real terrain a
          // nearer ridge must hide the readout too (reported: the km figures
          // drawn across the hills).
          transparent: true, depthTest: true, depthWrite: false,
        }));
        entry._fsDist.renderOrder = 94;
        entry._fsDist.frustumCulled = false;
        grp.add(entry._fsDist);
        entry._fsDist.userData.feature = entry.item;
        labelLayer.interactiveObjects.push(entry._fsDist);
      }
      if (entry._fsDistTxt !== txt) {
        entry._fsDist.material.map = fsDistTexture(txt);
        entry._fsDist.material.needsUpdate = true;
        entry._fsDistTxt = txt;
      }
      const dmap = entry._fsDist.material.map;
      const dImg = dmap && dmap.image;
      const dAspect = dImg && dImg.height ? dImg.width / dImg.height : 3;
      const distPx = 13 - t * 3;
      const distH = uppH * distPx;
      // BELOW the glyph: subtract, where the name label adds.
      const eDist = eTri - (triPx * 0.5 + distPx * 0.62) * anglePerPx;
      sDir.copy(tang).multiplyScalar(Math.cos(eDist)).addScaledVector(Chat, Math.sin(eDist));
      entry._fsDist.visible = c.named;
      entry._fsDist.material.opacity = Math.min(1, op * 1.35);
      entry._fsDist.position.copy(camLocal).addScaledVector(sDir, Dh);
      entry._fsDist.scale.set(distH * dAspect, distH, 1);
    }
    if (entry._fsHLabel && liveMap && c.named) {
      // Keep the proxy's texture in lockstep with the live label texture:
      // rebuildLabelTextures() swaps/disposes label maps, and a proxy left
      // holding a disposed map draws NOTHING — the "triangle with no name".
      if (entry._fsHLabel.material.map !== liveMap) {
        entry._fsHLabel.material.map = liveMap;
        entry._fsHLabel.material.needsUpdate = true;
      }
      const img = liveMap.image;
      const labAspect = img && img.height ? img.width / img.height : 4;
      const eLab = eTri + (triPx * 0.5 + labPx * 0.62) * anglePerPx;
      sDir.copy(tang).multiplyScalar(Math.cos(eLab)).addScaledVector(Chat, Math.sin(eLab));
      entry._fsHLabel.visible = true;
      // Thin outlined text vanishes at the triangle's far-fade alpha —
      // boost it so the name stays legible as far as the glyph itself.
      entry._fsHLabel.material.opacity = Math.min(1, op * 1.45);
      entry._fsHLabel.position.copy(camLocal).addScaledVector(sDir, Dh);
      entry._fsHLabel.scale.set(labH * labAspect, labH, 1);
    } else if (entry._fsHLabel) {
      entry._fsHLabel.visible = false;
    }
    // SCREEN-SPACE OVERLAP. Azimuth bins alone cannot prevent the pile-up
    // in a crowded band: bins measure DIRECTION, but a label has WIDTH, so
    // two flags 7° apart still overlap when their names are long. Test the
    // actual projected box against everything already placed — real
    // in-view labels first, then higher-significance proxies — and demote
    // to a bare triangle on collision. Candidates arrive in significance
    // order, so the loser is always the less important one.
    if (entry._fsHLabel?.visible) {
      const rect = spriteScreenRect(entry._fsHLabel);
      if (rect && occupiedRects.some((r) => rectsOverlap(r, rect))) {
        entry._fsHLabel.visible = false;
        if (entry._fsDist) entry._fsDist.visible = false;
        cullStats.declutteredNames = (cullStats.declutteredNames || 0) + 1;
      } else if (rect) {
        occupiedRects.push(rect);
      }
    }
  }
  // Landing-site labels (Beagle 2, Viking, …) get the same off-view drop —
  // their anchors can equally be flung on-screen from behind. Snapshot
  // pattern so turning back toward one restores it immediately.
  if (baseSiteLayer?.entries) {
    for (const e of baseSiteLayer.entries) {
      if (!e || !e.sprite) continue;
      if (e._fsBaseVisible === undefined) e._fsBaseVisible = !!e.sprite.visible;
      if (!e._fsBaseVisible) continue;
      const p = e.marker?.position || e.sprite.position;
      const onScreen = markerInView(p);
      e.sprite.visible = onScreen;
      if (e.line) e.line.visible = onScreen;
      if (e.marker) e.marker.visible = onScreen;
      if (!onScreen) cullStats.baseCulled++;
    }
  }
  cullStats.proxiesShown = shown.length;
  window.__fsCullStats = cullStats;
  window.__fsTriActive = true;
  }
}

/* A click on a label, a flag or its name opens the place's card. */
function onClick(ev) {
  const viewer = window.GeoIDViewer;
  if (!labelLayer || !window.__flightSim?.active || !viewer?.renderer) return;
  const rect = viewer.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, viewer.camera);
  const live = labelLayer.interactiveObjects.filter((o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  });
  const hit = ray.intersectObjects(live, false)[0];
  const item = hit?.object?.userData?.feature;
  if (!item) return;
  // EARTH: the card the geology and the imported layers use, pinned to the
  // place in the scene and moving with it (owner: "more like the geology pop
  // ups"), not the corner card. The place says what it is (`type`), its name
  // heads it, and its description and source follow; `geological: false`
  // keeps the card from classifying a city as rock.
  const card = {
    geological: false,
    type: item.type || "Place",
    rock_type: String(item.name || "").replace(/\s*\([^)]*\)\s*/g, " ").trim(),
    name: item.name,
    description: [item.elevation_m != null ? `${Number(item.elevation_m).toLocaleString()} m.` : "", item.description || ""].filter(Boolean).join(" "),
    source: item.source,
    lat: item.lat, lon: item.lon,
  };
  if (!viewer.showFeatureCard?.(card, item.lat, item.lon)) viewer.openPlace?.(item);
  ev.stopPropagation();
}

/** Start following the view (idempotent). */
export async function startFlightLabels() {
  if (frame) return;
  if (!buildLabelLayer) ({ buildLabelLayer, updateLabelVisibility, updateLabelAnchors, makeLabelTexture } = await import(MARS_LABELS));
  if (frame || !window.__flightSim?.active) return;
  frame = requestAnimationFrame(step);
  window.GeoIDViewer?.renderer?.domElement?.addEventListener("click", onClick, true);
}

/** Stop and clear. */
export function stopFlightLabels() {
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  window.GeoIDViewer?.renderer?.domElement?.removeEventListener("click", onClick, true);
  dispose();
  itemsKey = "";
  window.__fsTriActive = false;
}
