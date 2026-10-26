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
//
// A PARTITION (owner, 2026-10-25): the globe's labels are the GeoHUB's
// generalised set, the flight's are "all encompassing, like a location museum
// as we fly". So the flight takes EVERY curated place (getAllPlaceItems, not
// the Location labels switch's set, and not the legend's ticks), adds the
// places it streams itself (flight-gazetteer.js: towns, villages, peaks,
// parks, airports from OpenStreetMap; landmarks, buildings, museums and
// historic sites from Wikipedia), and shows each one only inside its tier's
// window -- how high the aircraft is, how far the place is (gazetteer.js
// TIER_WINDOW): the White House close and low, a capital from the
// stratosphere. The label layer holds only the places that window admits
// round the aircraft, added and dropped as it flies, so the Mars module's
// budgets (500 built labels) go to what can actually be seen.

import * as THREE from "../vendor/three.module.js";
import { TIER_WINDOW, TIER_SIZE, SMALL_REACH_KM, distanceKm } from "../../../flight_sim/earth/game/gazetteer.js?v=2";
// The Mars module, loaded when flight labels start: it imports three.js by an
// absolute web path, which only a browser resolves (Node tests import this file).
const MARS_LABELS = "../../../planet_explorer/mars/viewer/label-layer.js?v=20261026-29486bd";
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
/** A place's window: the highest it is labelled from, and how far (km). */
function windowOf(item) {
  const lod = Number(item?.lod) || 3;
  const w = TIER_WINDOW[Math.min(7, Math.max(1, lod))];
  const reachKm = item?.reachKm ?? w.reachKm;
  // the small tiers name only what is around you, curated ones included
  return { maxAltKm: item?.maxAltKm ?? w.maxAltKm, reachKm: lod >= 5 ? Math.min(reachKm, SMALL_REACH_KM) : reachKm };
}

function earthHidden(entry, km, altKm, beyondHorizon) {
  const lod = Number(entry.item?.lod) || 3;
  const win = windowOf(entry.item);
  // DYNAMIC: a place is labelled only from low enough and near enough for
  // its tier, so coming down fills the scene in and climbing thins it out.
  if (altKm > win.maxAltKm || km > win.reachKm) return true;
  // The small tiers name what is in front of you, never the skyline.
  if (beyondHorizon && lod >= 6) return true;
  const horizonKm = Math.sqrt(2 * (MARS_RADIUS_METERS / 1000) * Math.max(0.05, altKm));
  const reach = Math.min(700, Math.max(150, 3 * horizonKm)) * (lod <= 1 ? 1.6 : lod === 2 ? 1.25 : 1);
  if (km > reach) return true;
  if (!beyondHorizon && AREA_CATEGORIES.has(entry.item?.category)) {
    const areaKm = lod <= 1 ? 500 : lod === 2 ? 200 : 60;
    if (km < areaKm) return true;
  }
  return false;
}

/*
 * EARTH: READABLE DISTANCE BY TIER. A place in view is NAMED only this close
 * (km, along the ground); beyond it, out to its window's reach, it is an icon.
 * Roughly a third to a half of each tier's reach (gazetteer.js TIER_WINDOW):
 * a capital is named from a long way off, a village only once it is close.
 */
const NAME_KM = { 1: 400, 2: 250, 3: 110, 4: 45, 5: 5, 6: 5, 7: 3.5 };
/** At most this many names, and this many bare icons, in view at once. */
const MAX_NAMED_IN_VIEW = 22, MAX_ICONS_IN_VIEW = 70;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / Math.max(b - a, 1e-9))); return t * t * (3 - 2 * t); };

/*
 * EARTH: IS THIS PLACE BEHIND THE TERRAIN? The in-view labels are drawn with
 * no depth test (they must sit over the ground and the aircraft), so nothing
 * hid a village behind the mountain in front of it (reported over the
 * Himalaya). March the sight line from the camera to the place's ground point
 * against the drawn terrain (GeoIDFlightTerrain.heightUnits: the same heights
 * the mesh and the anchors use), samples bunched toward the place, where the
 * nearer ridges sit, and stopping short of its own last 150 m so it cannot
 * occlude itself. With hysteresis: once hidden, a place must clear the ridge
 * by 10 m to come back; to be hidden, the ridge must stand 15 m into the line.
 */
const UNITS_PER_M = 3.2 / 6371000;
const _tbS = new THREE.Vector3();
export function terrainBlocks(C, P, Rg, wasHidden = false, heightUnits = window.GeoIDFlightTerrain?.heightUnits) {
  if (typeof heightUnits !== "function") return false;
  const dist = C.distanceTo(P);
  if (!(dist > 1e-9)) return false;
  const tEnd = 1 - Math.min(0.25, (150 * UNITS_PER_M) / dist);
  const tol = (wasHidden ? -10 : 15) * UNITS_PER_M;
  const N = 28;
  for (let i = 1; i <= N; i += 1) {
    const t = tEnd * (1 - (1 - i / N) ** 1.6);
    _tbS.copy(C).lerp(P, t);
    const r = _tbS.length();
    const lat = Math.asin(Math.max(-1, Math.min(1, _tbS.y / r))) * 180 / Math.PI;
    const lon = Math.atan2(-_tbS.z, _tbS.x) * 180 / Math.PI;
    if (r < Rg + heightUnits(lat, lon) - tol) return true;
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
      const k = TIER_SIZE[Math.min(7, Math.max(1, Number(item.lod) || 4))] || 1.0;
      entry.sprite.scale.set((t.width / 200) * 0.66 * k, (t.height / 200) * 0.66 * k, 1);
      entry.baseScale = entry.sprite.scale.clone();
    }
  };
  labelLayer.group.name = "GeoID-FlightPlaceLabels";
  viewer.globe.add(labelLayer.group);
}

/*
 * THE ACTIVE SET. Every curated place (13k) and every streamed one is
 * offered; a place joins the label layer when the aircraft is within 1.25x
 * its reach and 1.25x its ceiling (so a place does not flicker in and out at
 * its edge), and leaves when it is no longer. Entries are added and removed
 * in place -- the Mars module's entries are plain records whose 3D objects
 * are built on first sight, so a new place costs nothing until it shows --
 * and never more than ACTIVE_MAX at once, most significant and nearest first.
 */
const ACTIVE_MAX = 1800;

/**
 * THE GEOHUB'S OWN LABEL CONTROLS STEER THE FLIGHT'S LABELS (owner,
 * 2026-10-25: "while in flight mode we cannot control/toggle the location
 * labels -- dead connection in the workspace and in the explorer tab").
 *
 * The partition stays: flight shows its own all-encompassing set, on by
 * default, whatever the globe's categories say. What the controls do in
 * flight is what a reader means by touching them there:
 *   - the Workspace's Location labels eye, or Explorer > Locations' master
 *     switch: every flight label off, or back on;
 *   - a category's own box (Cities & towns, Volcanoes...), ticked or unticked
 *     BY HAND during the flight: that category's flight labels follow it. Only
 *     a hand's tick counts (isTrusted): the eye switching every box off and
 *     back on is a cascade of the app's own events, not a choice per category;
 *   - the Workspace's label-size slider: the flight's chips grow and shrink
 *     with it (the size pass below).
 * None of this writes anything back: the globe's own labels and the boxes'
 * saved state are exactly what the controls already made them.
 */
const control = { on: true, off: new Set() };
export function flightLabelAllowed(item, c = control) {
  return c.on && !c.off.has(item?.category);
}
/**
 * ONE SWITCH, SEEN FROM EVERYWHERE. The Workspace row and the Locations
 * master read this while flying (layer-hierarchy.js flyingLabels) and are told
 * whenever it moves; a flight starts with labels off only if they were
 * switched off by hand in GeoHUB, and the master is put back to what the
 * globe's own boxes say on landing.
 */
function announce() {
  const master = document.getElementById("locations-master-toggle");
  if (master && window.__flightSim?.active) master.checked = control.on;
  window.dispatchEvent(new CustomEvent("geoid:flight-labels-changed", { detail: { on: control.on } }));
}
function setLabelsOn(on) {
  if (control.on === Boolean(on)) return;
  control.on = Boolean(on);
  lastItemsAt = 0;
  announce();
}
if (typeof window !== "undefined") {
  window.GeoIDFlightLabels = { isOn: () => control.on, setOn: setLabelsOn };
}
function onLabelControl(e) {
  const t = e.target;
  if (!t || !window.__flightSim?.active) return;
  if (t.id === "locations-master-toggle" || t.matches?.('.layer-row-labels [data-role="visible"]')) { setLabelsOn(t.checked); return; }
  else if (e.isTrusted && t.dataset?.placeCategory) {
    for (const id of t.dataset.placeCategory.split(" ")) {
      if (t.checked) control.off.delete(id); else control.off.add(id);
    }
  } else return;
  lastItemsAt = 0;   // re-cut the places on the next frame, not in a second
}
let curatedCache = null, curatedCount = -1, sortCounter = 0;
function curatedPlaces(viewer) {
  const all = viewer.getAllPlaceItems?.() || [];
  if (all.length !== curatedCount) {
    curatedCount = all.length;
    curatedCache = all.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon) && i.name);
  }
  return curatedCache || [];
}

function syncPlaces(viewer) {
  const f = window.__flightSim;
  if (!f?.shipLatLon) return;
  const { lat, lon } = f.shipLatLon;
  const altKm = (Number(f.shipAltUnits) || 0) / (3.2 / 6371000) / 1000;
  const curated = curatedPlaces(viewer);
  const streamed = window.GeoIDFlightGazetteer?.getItems?.(curated) || [];
  const admit = [];
  const consider = (item) => {
    if (!flightLabelAllowed(item)) return;
    const w = windowOf(item);
    if (altKm > w.maxAltKm * 1.25) return;
    // A cheap box first: 13k great-circle distances a second is not free.
    const reach = w.reachKm * 1.25;
    if (Math.abs(item.lat - lat) * 111.32 > reach) return;
    const km = distanceKm(lat, lon, item.lat, item.lon);
    if (km <= reach) admit.push({ item, km, lod: Number(item.lod) || 3 });
  };
  for (const item of curated) consider(item);
  for (const item of streamed) consider(item);
  admit.sort((a, b) => (a.lod - b.lod) || (a.km - b.km));
  const want = new Set(admit.slice(0, ACTIVE_MAX).map((a) => a.item));
  if (!labelLayer) {
    rebuild(viewer, [...want]);
    terrainVersion = -1;
    return;
  }
  const entries = labelLayer.entries;
  let changed = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (want.has(e.item)) continue;
    disposeProxies(e);
    entries._disposeEntry?.(e);
    entries.splice(i, 1);
    changed = true;
  }
  const have = new Set(entries.map((e) => e.item));
  const add = [...want].filter((it) => !have.has(it));
  if (add.length) {
    // Records only: built by the layer's own (wrapped) _buildEntry on first sight.
    const extra = buildLabelLayer(3.2, null, null, null, getReliefPoint, add);
    for (const e of extra.entries) { e.sortIndex = sortCounter++; entries.push(e); }
    changed = true;
  }
  if (changed) window.__fsPlaceStats = { active: entries.length, admitted: admit.length, streamed: streamed.length, curated: curated.length };
}

/** A horizon flag's three sprites, out of the scene and the pick list. */
function disposeProxies(e) {
  for (const k of ["_fsTri", "_fsHLabel", "_fsDist"]) {
    const o = e[k];
    if (!o) continue;
    o.parent?.remove(o);
    o.material.dispose();
    const io = labelLayer?.interactiveObjects;
    const at = io ? io.indexOf(o) : -1;
    if (at !== -1) io.splice(at, 1);
    e[k] = null;
  }
  e._fsPill?.tex?.dispose?.();
  e._fsPill = null;
}

function dispose() {
  if (!labelLayer) return;
  for (const e of labelLayer.entries) labelLayer.entries._disposeEntry?.(e);
  for (const e of labelLayer.entries) disposeProxies(e);
  labelLayer.group.parent?.remove(labelLayer.group);
  labelLayer = null;
}

function step() {
  frame = requestAnimationFrame(step);
  const viewer = window.GeoIDViewer;
  if (!viewer?.globe || !viewer.camera || !viewer.renderer || !window.__flightSim?.active) return;
  // The places round the aircraft, once a second: the curated set and the
  // streamed one, cut to what their windows can admit from here.
  if (performance.now() - lastItemsAt > 1000 || !labelLayer) {
    lastItemsAt = performance.now();
    syncPlaces(viewer);
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
      // Every tier: the windows (earthHidden) decide what flight shows, not
      // the GeoHUB's label density.
      7,
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
    e._fsSky = undefined;   // a flag that comes back starts from its own skyline
  };
  /**
   * CRISP TEXT FOR THE SKYLINE (owner, 2026-10-25: "distant labels over the
   * horizon are super blurry and stretched"). The flags borrowed the in-view
   * label's chip -- 34 px tall at 1x, 15 px text -- and squeezed it into a
   * 14-20 px tag, so the name came out at ~7 px through mipmaps: smeared.
   * Each skyline name (and range) now has its own texture drawn at the size
   * it is shown, one canvas pixel to one screen pixel (x devicePixelRatio),
   * no mipmaps: nothing is resampled, so it is as sharp as page text.
   * Returns { tex, w, h } with w, h in CSS pixels. Cached by text and style.
   */
  /** The place's own label chip, drawn crisp at `px` tall: { tex, w, h } in CSS px. */
  const crispPill = (entry, px) => {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const key = `${px}|${dpr}`;
    if (entry._fsPill?.key === key) return entry._fsPill;
    entry._fsPill?.tex?.dispose?.();
    const item = entry.item || {};
    const t = makeLabelTexture(item, {
      ...(item.label_palette ? { customPalette: item.label_palette } : { theme: item.theme }),
      backingScale: dpr * px / 34,
    });
    t.texture.generateMipmaps = false;
    t.texture.minFilter = THREE.LinearFilter;
    t.texture.magFilter = THREE.LinearFilter;
    entry._fsPill = { key, tex: t.texture, w: t.width * px / 34, h: px };
    return entry._fsPill;
  };
  if (!window.__fsCrisp) window.__fsCrisp = new Map();
  const crispText = (txt, px, fill, weight = 600) => {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const key = `${txt}|${px}|${fill}|${weight}|${dpr}`;
    const cache = window.__fsCrisp;
    const hit = cache.get(key);
    if (hit) return hit;
    const font = `${weight} ${Math.round(px * dpr)}px "Exo 2", "Segoe UI", sans-serif`;
    const pad = Math.round(4 * dpr), stroke = Math.max(2, Math.round(3 * dpr));
    const meas = document.createElement("canvas").getContext("2d");
    meas.font = font;
    const cv = document.createElement("canvas");
    cv.width = Math.max(4, Math.ceil(meas.measureText(txt).width) + pad * 2);
    cv.height = Math.round(px * dpr * 1.35) + pad * 2;
    const g = cv.getContext("2d");
    g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = stroke; g.strokeStyle = "rgba(6, 9, 14, 0.94)";
    g.strokeText(txt, cv.width / 2, cv.height / 2);
    g.fillStyle = fill;
    g.fillText(txt, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const out = { tex, w: cv.width / dpr, h: cv.height / dpr };
    if (cache.size > 400) {
      for (const k of cache.keys()) { cache.get(k)?.tex?.dispose?.(); cache.delete(k); if (cache.size <= 300) break; }
    }
    cache.set(key, out);
    return out;
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
  // A dot's screen box: `px` square round where a label-frame point projects.
  const pointScreenRect = (Plocal, px) => {
    _srV.copy(Plocal);
    grp.localToWorld(_srV);
    const ndc = _srN.copy(_srV).project(camera);
    if (ndc.z > 1) return null;
    const cx = (ndc.x * 0.5 + 0.5) * _srVw, cy = (-ndc.y * 0.5 + 0.5) * _srVh, h = px / 2;
    return { l: cx - h, r: cx + h, t: cy - h, b: cy + h };
  };

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
    if (!entry._fsBaseVisible) {
      // EARTH: a label the declutter hid takes its dot with it. The Mars
      // module leaves the dot on at its globe-scale size, which a few
      // hundred metres up is a ball the size of a house (reported: "those
      // just at the extent of view become large dots").
      entry.marker.visible = false;
      if (entry.line) entry.line.visible = false;
      hideProxies(entry);
      continue;
    }
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
        // EARTH: SIZE BY TIER, CONSTANT ON SCREEN. The Mars sizing grows a
        // label with its distance (right for a globe seen whole), which over
        // a city drew a park 40 km off larger than Rome under the wing. In
        // flight a label is its tier's pixel height wherever it is -- a
        // capital ~46 px, a village or a building the 24 px floor
        // (gazetteer.js TIER_SIZE) -- and its dot a few pixels, not a ball
        // beside the aircraft.
        const tier = Math.min(7, Math.max(1, Number(entry.item?.lod) || 4));
        // How near, 1 close by to 0 at the edge of the tier's naming range
        // (NAME_KM), on a log scale: sizes the chip and the dot below.
        const km = gamma * (MARS_RADIUS_METERS / 1000);
        const near = 1 - smooth(0, Math.log(NAME_KM[tier]), Math.log(Math.max(km, 1)));
        if (entry.baseScale) {
          // The chip's height in pixels, padding included: 30 px at tier 4,
          // never under 24 -- below that the name itself drops under ~11 px
          // and stops being readable (reported: labels that "just continue
          // to shrink" near the ground).
          //
          // AND BY DISTANCE (owner, 2026-10-25, over Eyjafjallajokull: "near
          // field location labels are the same as those that are far away").
          // A place close by is drawn up to 1.3x its tier's size, shrinking on
          // a log scale to 0.72x at the edge of its naming range (NAME_KM),
          // beyond which it is an icon anyway; never below 22 px, the
          // smallest a name still reads at.
          const chipPx = Math.max(22, 30 * (TIER_SIZE[tier] || 1) * (0.72 + 0.58 * near))
            * (window.GeoIDViewer?.getLabelSizeScale?.() || 1);
          const k = (distCam * anglePerPx * chipPx) / Math.max(entry.baseScale.y, 1e-9);
          entry.sprite.scale.set(entry.baseScale.x * k, entry.baseScale.y * k, 1);
        }
        // The dot: 6 px for the big tiers down to 4, a little larger near and
        // smaller far (reported: "the location label dots are also generally
        // too big"). Sized from the sphere's own RADIUS -- the 0.022 this
        // divided by before was taken for a diameter, which drew every dot
        // twice the size it was meant to be.
        const dotPx = (tier <= 3 ? 6 : tier <= 5 ? 5 : 4) * (0.75 + 0.35 * near);
        const dotR = entry.marker.geometry?.parameters?.radius || 0.011;
        entry.marker.scale.setScalar((distCam * anglePerPx * dotPx) / (2 * dotR));
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
  // EARTH: IN VIEW, AS MARS DOES THE SKYLINE -- HIDE, NAME, ICONIFY, FADE
  // (owner, 2026-10-25: labels showing through mountains, and "the horizon is
  // consistently overcrowded by far too many labels -- see how mars handles
  // crowding by fading, hiding and iconifying"). Most significant first, then
  // nearest, each place gets the best of four fates:
  //   HIDDEN   its ground is behind terrain from here (terrainBlocks): the
  //            peak in front takes the label, dot and connector with it;
  //   NAMED    near enough for its tier to be read (NAME_KM), within the
  //            budget of names, and its chip lands on free screen -- faded a
  //            little as it nears the edge of its naming range;
  //   ICON     otherwise its dot alone, category-coloured, fading with range,
  //            as long as the dot itself lands on free screen and within the
  //            icon budget: the place stays visible as something ahead,
  //            and earns its name as the aircraft closes on it;
  //   DROPPED  when even the dot would sit on another.
  promoted.sort((a, b) => ((Number(a.entry.item?.lod) || 3) - (Number(b.entry.item?.lod) || 3)) || (a.gamma - b.gamma));
  const KM_PER_RAD = MARS_RADIUS_METERS / 1000;
  let named = 0, icons = 0;
  const showAs = (entry, fate, opacity = 1) => {
    const asName = fate === "name";
    entry.sprite.visible = asName;
    if (entry.line) entry.line.visible = asName;
    entry.marker.visible = fate !== "hidden";
    // the fade eases in rather than popping as a fate changes
    entry._fsOp = (entry._fsOp ?? 0) + (opacity - (entry._fsOp ?? 0)) * 0.25;
    if (asName && entry.sprite.material) entry.sprite.material.opacity = entry._fsOp;
    if (entry.line?.material) entry.line.material.opacity = 0.36 * entry._fsOp;
    if (entry.marker.material) entry.marker.material.opacity = 0.92 * entry._fsOp;
  };
  for (const { entry, gamma } of promoted) {
    // Line of sight, refreshed every fourth frame per place (staggered).
    if (entry._fsOcc === undefined || (frameCount + (entry.sortIndex || 0)) % 4 === 0) {
      entry._fsOcc = terrainBlocks(camLocal, entry.marker.position, Rg, entry._fsOcc);
    }
    if (entry._fsOcc) { showAs(entry, "hidden", 0); entry._fsOp = 0; cullStats.occluded = (cullStats.occluded || 0) + 1; continue; }
    const tier = Math.min(7, Math.max(1, Number(entry.item?.lod) || 4));
    const km = gamma * KM_PER_RAD;
    const nameKm = NAME_KM[tier];
    if (km <= nameKm && named < MAX_NAMED_IN_VIEW) {
      const rect = spriteScreenRect(entry.sprite);
      if (rect && !occupiedRects.some((r) => rectsOverlap(r, rect))) {
        occupiedRects.push(rect);
        named += 1;
        showAs(entry, "name", 1 - 0.35 * smooth(0.55 * nameKm, nameKm, km));
        continue;
      }
    }
    const dot = icons < MAX_ICONS_IN_VIEW ? pointScreenRect(entry.marker.position, 8) : null;
    if (dot && !occupiedRects.some((r) => rectsOverlap(r, dot))) {
      occupiedRects.push(dot);
      icons += 1;
      showAs(entry, "icon", 0.85 - 0.45 * smooth(nameKm, windowOf(entry.item).reachKm, km));
      cullStats.iconified = (cullStats.iconified || 0) + 1;
    } else {
      showAs(entry, "hidden", 0);
      cullStats.promotedDecluttered = (cullStats.promotedDecluttered || 0) + 1;
    }
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
      for (const f of [0.01, 0.02, 0.035, 0.05, 0.075, 0.1, 0.15, 0.2, 0.28, 0.35, 0.45, 0.6, 0.72, 0.85, 1.0]) {
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
    // EARTH: HELD STEADY (reported: "the labels over the horizon currently
    // bob up and down"). The samples slide over the ridges as the aircraft
    // moves, so the raw skyline jumps from frame to frame; the flag follows
    // it quickly upward, so a ridge never covers it, and settles slowly down.
    const eRaw = Math.asin(Math.max(-1, Math.min(1, maxSin)));
    const ePrev = entry._fsSky;
    const eSky = ePrev === undefined ? eRaw : ePrev + (eRaw - ePrev) * (eRaw > ePrev ? 0.3 : 0.04);
    entry._fsSky = eSky;
    // Size + fade as a function of how far beyond the horizon it lies —
    // floors keep even the farthest flags readable.
    const t = Math.min(1, c.over / 0.9);
    const fade = 0.95 - t * 0.55;                 // 0.95 → 0.40
    // SIZE BY SIGNIFICANCE. lod 1 (continent-scale) draws ~15% larger than
    // the baseline, lod 5 (individual craters) ~15% smaller, so the
    // skyline reads as a hierarchy instead of a wall of equal flags.
    const sigScale = 1.18 - 0.075 * (c.sig || 3);   // lod1 1.10 → lod5 0.81
    const triPx = (16 - t * 5) * sigScale;
    const triH = uppH * triPx;
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
    if (!entry._fsHLabel) {
      entry._fsHLabel = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false }));
      entry._fsHLabel.renderOrder = 93; entry._fsHLabel.frustumCulled = false; grp.add(entry._fsHLabel);
      entry._fsHLabel.userData.feature = entry.item;
      labelLayer.interactiveObjects.push(entry._fsHLabel);
    }
    if (entry.marker.material?.color) entry._fsTri.material.color.copy(entry.marker.material.color);
    entry._fsRamp = Math.min(1, (entry._fsRamp || 0) + 0.08); // fade-in, no popping
    const op = fade * entry._fsRamp;
    // Sightline elevation for the triangle: skyline + 8 px pad + half its height.
    // A named flag carries its range UNDER the glyph: room is made for it
    // between the skyline and the glyph, or the ground at the skyline hides
    // the lower half of the figures (depth-tested, rightly, for nearer hills).
    const distRoom = c.named ? 16 : 0;
    const eTri = eSky + (8 + distRoom + triPx * 0.5) * anglePerPx;
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
      // Crisp, as the name above it (crispText): 11 px, one texel a pixel.
      const dt = crispText(txt, 11, "#bfe0ff");
      if (entry._fsDist.material.map !== dt.tex) {
        entry._fsDist.material.map = dt.tex;
        entry._fsDist.material.needsUpdate = true;
        entry._fsDistTxt = txt;
      }
      const distPx = dt.h;
      // BELOW the glyph: subtract, where the name label adds.
      // By the text, not its padded box: the crisp texture carries 4 px of
      // padding a side, and centring on the whole box dropped the figures
      // into the skyline, where the depth test hid them.
      const eDist = eTri - (triPx * 0.5 + 1 + (distPx - 8) * 0.5) * anglePerPx;
      sDir.copy(tang).multiplyScalar(Math.cos(eDist)).addScaledVector(Chat, Math.sin(eDist));
      entry._fsDist.visible = c.named;
      entry._fsDist.material.opacity = Math.min(1, op * 1.35);
      entry._fsDist.position.copy(camLocal).addScaledVector(sDir, Dh);
      entry._fsDist.scale.set(uppH * dt.w, uppH * dt.h, 1);
    }
    if (entry._fsHLabel && c.named) {
      // THE SAME PILL AS IN VIEW, AND SHARP (owner, 2026-10-26: the skyline
      // names "should be the same font and within a pill like the others").
      // The plain crisp text that replaced the squeezed chip was sharp but
      // not a label; this is the label's own chip -- its palette, its accent
      // bar, Orbitron -- drawn at the size it is shown (crispPill: one canvas
      // pixel per screen pixel, no mipmaps), 24 px tall for the most
      // significant places, 21 px for the rest.
      const ct = crispPill(entry, (c.sig || 3) <= 2 ? 24 : 21);
      if (entry._fsHLabel.material.map !== ct.tex) {
        entry._fsHLabel.material.map = ct.tex;
        entry._fsHLabel.material.needsUpdate = true;
      }
      const eLab = eTri + (triPx * 0.5 + ct.h * 0.55) * anglePerPx;
      sDir.copy(tang).multiplyScalar(Math.cos(eLab)).addScaledVector(Chat, Math.sin(eLab));
      entry._fsHLabel.visible = true;
      // Thin outlined text vanishes at the triangle's far-fade alpha —
      // boost it so the name stays legible as far as the glyph itself.
      entry._fsHLabel.material.opacity = Math.min(1, op * 1.45);
      entry._fsHLabel.position.copy(camLocal).addScaledVector(sDir, Dh);
      entry._fsHLabel.scale.set(uppH * ct.w, uppH * ct.h, 1);
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
  const item = pickDrawn(ev.clientX - rect.left, ev.clientY - rect.top, rect.width, rect.height, viewer.camera);
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
  // A place from Wikipedia carries one line; its article's summary follows
  // when it arrives, into the same card if that is still the one open.
  if (item.wikiTitle && !item._summary) {
    openCardItem = item;
    window.GeoIDFlightGazetteer?.wikiSummary?.(item.wikiTitle).then((sum) => {
      if (!sum?.extract) return;
      item._summary = sum.extract;
      if (openCardItem !== item || !window.__flightSim?.active) return;
      viewer.showFeatureCard?.({ ...card, description: [card.description, sum.extract].filter(Boolean).join(" — ") }, item.lat, item.lon);
    });
  } else if (item._summary) {
    openCardItem = item;
    viewer.showFeatureCard?.({ ...card, description: [card.description, item._summary].filter(Boolean).join(" — ") }, item.lat, item.lon);
  }
}
let openCardItem = null;

/**
 * WHAT IS UNDER THE CLICK, ON SCREEN (reported: "many distant labels are still
 * not 100% immediately clickable"). The raycast this replaces hit the Mars
 * module's small hit spheres, which stay at its own label positions after
 * flight re-anchors a label upright over its dot, and shrink to a pixel or two
 * at range; and it skipped the skyline flags. This tests exactly what is
 * drawn, by its box on screen: a named label's chip, a skyline flag's name
 * and triangle, a bare dot (given a 16 px target so a far one can be hit).
 * Where boxes overlap the name wins over a flag, a flag over a dot, and then
 * the box whose centre is nearest the click.
 */
const _pk = new THREE.Vector3();
function pickDrawn(x, y, w, h, camera) {
  if (!labelLayer) return null;
  const tanHalf = Math.tan((camera.fov * Math.PI / 180) / 2);
  const box = (obj, minPx = 0) => {
    obj.getWorldPosition(_pk);
    const dist = camera.position.distanceTo(_pk);
    const ndc = _pk.project(camera);
    if (ndc.z > 1 || !(dist > 1e-9)) return null;
    const ppu = h / (2 * dist * tanHalf);
    const sw = obj.isSprite ? Math.max(minPx, obj.scale.x * ppu) : minPx;
    const sh = obj.isSprite ? Math.max(minPx, obj.scale.y * ppu) : minPx;
    const cx = (ndc.x * 0.5 + 0.5) * w, cy = (-ndc.y * 0.5 + 0.5) * h;
    const c = obj.isSprite && obj.center ? obj.center : { x: 0.5, y: 0.5 };
    const l = cx - sw * c.x, t = cy - sh * (1 - c.y);
    return { l: l - 3, r: l + sw + 3, t: t - 3, b: t + sh + 3, cx: l + sw / 2, cy: t + sh / 2 };
  };
  const shownNow = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  let best = null;
  const consider = (entry, obj, rank, minPx) => {
    if (!obj || !shownNow(obj)) return;
    const b = box(obj, minPx);
    if (!b || x < b.l || x > b.r || y < b.t || y > b.b) return;
    const d = Math.hypot(x - b.cx, y - b.cy);
    if (!best || rank > best.rank || (rank === best.rank && d < best.d)) best = { item: entry.item, rank, d };
  };
  for (const e of labelLayer.entries) {
    consider(e, e.sprite, 4, 0);
    consider(e, e._fsHLabel, 3, 0);
    consider(e, e._fsTri, 2, 18);
    consider(e, e.marker, 1, 16);
  }
  return best?.item || null;
}

/** Start following the view (idempotent). */
export async function startFlightLabels() {
  if (frame) return;
  if (!buildLabelLayer) ({ buildLabelLayer, updateLabelVisibility, updateLabelAnchors, makeLabelTexture } = await import(MARS_LABELS));
  if (frame || !window.__flightSim?.active) return;
  control.on = !window.GeoIDLayerHierarchy?.labelsSwitchedOff?.();
  announce();
  frame = requestAnimationFrame(step);
  window.GeoIDViewer?.renderer?.domElement?.addEventListener("click", onClick, true);
  document.addEventListener("change", onLabelControl);
}

/** Stop and clear. */
export function stopFlightLabels() {
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  window.GeoIDViewer?.renderer?.domElement?.removeEventListener("click", onClick, true);
  document.removeEventListener("change", onLabelControl);
  dispose();
  itemsKey = "";
  window.__fsTriActive = false;
  // Landed: the master says what the globe's own boxes say again.
  const master = document.getElementById("locations-master-toggle");
  if (master) master.checked = Boolean(document.querySelector("#locations-section input[type=checkbox]:checked:not(#locations-master-toggle):not(#moon-toggle)"));
  window.dispatchEvent(new CustomEvent("geoid:flight-labels-changed", { detail: { on: false } }));
}
