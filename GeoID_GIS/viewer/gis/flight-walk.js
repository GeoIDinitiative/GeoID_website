/**
 * On foot in Earth Flight: step out of the aircraft and walk the real ground.
 *
 * The owner's aim: "Use the walk anywhere function ... so flight sim allows VR
 * site investigation like the Everest ascent game (his tools at hand like
 * 3DTeLC) - merges the Manchester, Everest, flight sim (3D building, lights)
 * and geoHUB tools (layers, 3D GIS tools, terrain etc)". So this walks the
 * flight's own world instead of building another: the same flight terrain, 3D
 * buildings, lights, drapes and open GIS tools, seen from eye height. The
 * craft waits above, carried round with the planet, and G goes back to it.
 *
 * Nothing else needs telling. Terrain, buildings, labels and drapes all stream
 * from `__flightSim.shipLatLon` and `shipAltUnits`, so publishing the walker
 * there brings the world along; `__flightSim.walkCamera` hands over the camera.
 *
 * W A S D walk, Shift runs, drag looks, the arrow keys turn and look. The
 * panel reads what a compass-clinometer would: elevation, slope and the
 * direction of steepest descent, measured off the terrain over 30 m.
 */

const UNITS_PER_M = 3.2 / 6371000;
const EYE_M = 1.8;
const WALK_MS = 2;
const RUN_MS = 8;
const NEAR_M = 0.3;
const BASELINE_M = 30;
const M_PER_DEG = 111320;
const RAD = Math.PI / 180;

/** Move a point on the ground: heading in degrees from north, metres ahead and to the right. */
export function moved(lat, lon, headingDeg, aheadM, rightM) {
  const h = headingDeg * RAD;
  const north = aheadM * Math.cos(h) - rightM * Math.sin(h);
  const east = aheadM * Math.sin(h) + rightM * Math.cos(h);
  return {
    lat: lat + north / M_PER_DEG,
    lon: lon + east / (M_PER_DEG * Math.max(0.05, Math.cos(lat * RAD))),
  };
}

/**
 * Slope and dip direction off a height function (metres at lat, lon): central
 * differences over `stepM`. `dipDir` is the bearing water would run, degrees
 * from north; null on level ground, or where the ground cannot be read.
 */
export function slopeAt(heightAt, lat, lon, stepM = BASELINE_M) {
  const dLat = stepM / M_PER_DEG;
  const dLon = stepM / (M_PER_DEG * Math.max(0.05, Math.cos(lat * RAD)));
  const n = heightAt(lat + dLat, lon);
  const s = heightAt(lat - dLat, lon);
  const e = heightAt(lat, lon + dLon);
  const w = heightAt(lat, lon - dLon);
  if (![n, s, e, w].every(Number.isFinite)) return { slopeDeg: null, dipDir: null };
  const dzEast = (e - w) / (2 * stepM);
  const dzNorth = (n - s) / (2 * stepM);
  const grade = Math.hypot(dzEast, dzNorth);
  return {
    slopeDeg: Math.atan(grade) / RAD,
    dipDir: grade < 1e-4 ? null : (Math.atan2(-dzEast, -dzNorth) / RAD + 360) % 360,
  };
}

/** Eight points of the compass. */
export function compassPoint(deg) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

let walker = null;      // { lat, lon, heading, pitch, prevNear, prevFar, panelAt, three }
const keys = new Set();
const fs = () => window.__flightSim;
const terrain = () => window.GeoIDFlightTerrain;

function onKeyDown(e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")
    || document.activeElement?.isContentEditable) return;
  if (e.code === "KeyG" && fs()?.active && !e.ctrlKey && !e.metaKey && !e.altKey) { toggle(); return; }
  if (walker) keys.add(e.code);
}
function onKeyUp(e) { keys.delete(e.code); }

let dragging = null;
function onPointerDown(e) {
  if (walker && e.button === 0 && e.target === window.GeoIDViewer?.renderer?.domElement) {
    dragging = { x: e.clientX, y: e.clientY };
  }
}
function onPointerMove(e) {
  if (!walker || !dragging) return;
  walker.heading = (walker.heading + (e.clientX - dragging.x) * 0.15 + 360) % 360;
  walker.pitch = Math.max(-80, Math.min(80, walker.pitch - (e.clientY - dragging.y) * 0.12));
  dragging = { x: e.clientX, y: e.clientY };
}
function onPointerUp() { dragging = null; }

function groundUnits(lat, lon) {
  return terrain()?.heightUnits?.(lat, lon) || 0;
}

/** A place in world space, `lift` scene units over the drawn ground's sphere. */
function worldAt(V, lat, lon, lift, out) {
  const p = V.surfacePoint(lat, lon, lift);
  out.set(-p.x, p.y, -p.z);
  return V.globe.localToWorld(out);
}

function panel(w) {
  const T = terrain();
  const heightAt = (a, b) => T?.groundMetres?.(a, b) ?? NaN;
  const here = heightAt(w.lat, w.lon);
  const { slopeDeg, dipDir } = slopeAt(heightAt, w.lat, w.lon);
  const node = document.getElementById("fs-walk-panel");
  if (!node) return;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  node.innerHTML = `<h4>On foot</h4><dl>${
    row("Position", `${Math.abs(w.lat).toFixed(5)}°${w.lat >= 0 ? "N" : "S"} ${Math.abs(w.lon).toFixed(5)}°${w.lon >= 0 ? "E" : "W"}`)
  }${row("Elevation", Number.isFinite(here) ? `${Math.round(here)} m` : "—")
  }${row("Slope", slopeDeg == null ? "—" : `${slopeDeg.toFixed(1)}°`)
  }${row("Dip direction", dipDir == null ? "level" : `${String(Math.round(dipDir)).padStart(3, "0")}° ${compassPoint(dipDir)}`)
  }${row("Facing", `${String(Math.round(w.heading)).padStart(3, "0")}° ${compassPoint(w.heading)}`)
  }</dl><p>WASD walk · Shift run · drag to look · G back to the aircraft</p>`;
}

function tick(camera) {
  const f = fs();
  const w = walker;
  const V = window.GeoIDViewer;
  if (!w || !V?.surfacePoint) return;
  const now = performance.now();
  const dt = Math.min(0.1, (now - (w.last || now)) / 1000);
  w.last = now;
  if (keys.has("ArrowLeft")) w.heading = (w.heading - 70 * dt + 360) % 360;
  if (keys.has("ArrowRight")) w.heading = (w.heading + 70 * dt) % 360;
  if (keys.has("ArrowUp")) w.pitch = Math.min(80, w.pitch + 45 * dt);
  if (keys.has("ArrowDown")) w.pitch = Math.max(-80, w.pitch - 45 * dt);
  const ahead = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const right = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  if (ahead || right) {
    const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? RUN_MS : WALK_MS) * dt;
    const norm = Math.hypot(ahead, right);
    const to = moved(w.lat, w.lon, w.heading, (ahead / norm) * speed, (right / norm) * speed);
    w.lat = to.lat; w.lon = to.lon;
  }
  // Published as the craft's, which is what every streamer follows.
  f.shipLatLon = { lat: w.lat, lon: w.lon };
  f.focusLatLon = { lat: w.lat, lon: w.lon };
  f.shipAltUnits = EYE_M * UNITS_PER_M;
  f.shipSpeedDegPerSec = 0;
  f.headingDeg = w.heading;

  const THREE = camera.position.constructor;
  const lift = groundUnits(w.lat, w.lon) + EYE_M * UNITS_PER_M;
  const pos = worldAt(V, w.lat, w.lon, lift, w.a ??= new THREE());
  const up = (w.up ??= new THREE()).copy(pos).normalize();
  const north = worldAt(V, w.lat + 0.001, w.lon, lift, w.b ??= new THREE()).sub(pos);
  north.addScaledVector(up, -north.dot(up)).normalize();
  const east = (w.e ??= new THREE()).crossVectors(north, up).normalize();
  const h = w.heading * RAD;
  const p = w.pitch * RAD;
  const look = (w.f ??= new THREE()).copy(north).multiplyScalar(Math.cos(h) * Math.cos(p))
    .addScaledVector(east, Math.sin(h) * Math.cos(p)).addScaledVector(up, Math.sin(p));
  camera.position.copy(pos);
  camera.up.copy(up);
  camera.lookAt(look.add(pos));
  const near = NEAR_M * UNITS_PER_M;
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  if (now - (w.panelAt || 0) > 250) { w.panelAt = now; panel(w); }
}

function start() {
  const f = fs();
  const T = terrain();
  const at = f?.shipLatLon;
  if (!f?.active || !at || !T?.active?.()) return;
  const here = T.groundMetres?.(at.lat, at.lon);
  if (here == null || here <= 0.5) { f.flash?.("OPEN WATER BELOW · NOWHERE TO STAND"); return; }
  const V = window.GeoIDViewer;
  walker = { lat: at.lat, lon: at.lon, heading: f.headingDeg || 0, pitch: -6,
    prevNear: V?.camera?.near, prevFar: V?.camera?.far };
  f.walkCamera = tick;
  f.setShipVisible?.(false);
  document.body.classList.add("fs-walking");
  const b = document.getElementById("fs-walk-toggle");
  b?.setAttribute("aria-pressed", "true");
  const node = document.getElementById("fs-walk-panel");
  if (node) node.hidden = false;
  f.flash?.("ON FOOT");
}

function stop() {
  if (!walker) return;
  const f = fs();
  const V = window.GeoIDViewer;
  if (V?.camera && Number.isFinite(walker.prevNear)) {
    V.camera.near = walker.prevNear; V.camera.far = walker.prevFar;
    V.camera.updateProjectionMatrix();
  }
  walker = null;
  keys.clear();
  dragging = null;
  if (f) { f.walkCamera = null; f.setShipVisible?.(true); }
  document.body.classList.remove("fs-walking");
  document.getElementById("fs-walk-toggle")?.setAttribute("aria-pressed", "false");
  const node = document.getElementById("fs-walk-panel");
  if (node) node.hidden = true;
}

function toggle() { if (walker) { stop(); fs()?.flash?.("BACK AT THE CONTROLS"); } else start(); }

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("flightsim:disengaged", stop);
  const wire = () => {
    const b = document.getElementById("fs-walk-toggle");
    if (!b || b.dataset.wired) return Boolean(b);
    b.dataset.wired = "1";
    b.hidden = false;
    b.addEventListener("click", toggle);
    return true;
  };
  if (!wire()) {
    let tries = 0;
    const wait = setInterval(() => { if (wire() || ++tries > 60) clearInterval(wait); }, 500);
  }
}
