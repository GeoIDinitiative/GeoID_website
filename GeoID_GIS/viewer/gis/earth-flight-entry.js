// The Earth Flight entry in Explorer, and the switches for the globe's own
// streamed 3D buildings (osm-buildings.js).
//
// The other worlds fly in place: scripts/flightsim.js injects a
// `#flightsim-section` into the sidebar and the toolbox folds it into
// Explorer with every other control-section. Earth's flight is its own page
// (flight_sim/earth/, photoreal imagery on real terrain with OSM buildings),
// so the section is written in Earth's markup instead -- same place, same
// Enter button -- and Enter carries the view across: the point the camera is
// centred on, the way it is facing, and its height, clamped to something
// flyable. The viewer runs inside GeoHUB's iframe, so the page that changes
// is the top one; the flight page's back link returns to GeoHUB.

import { isEarth } from "./bodies.js?v=20261023-9468c0f";

const FLIGHT_URL = "/flight_sim/earth/";
const DEG = 180 / Math.PI;

/** Lat/lon where a screen ray (NDC) meets the globe, in the baseline frame. */
function rayLatLon(viewer, THREE, ndcX, ndcY) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), viewer.camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), viewer.GLOBE_RADIUS || 3.2), hit)) return null;
  viewer.globe.updateMatrixWorld(true);
  const local = hit.applyMatrix4(new THREE.Matrix4().copy(viewer.globe.matrixWorld).invert());
  local.set(-local.x, local.y, -local.z);
  const r = local.length() || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, local.y / r))) * DEG, lon: Math.atan2(local.z, -local.x) * DEG };
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a, b) {
  const p1 = a.lat / DEG, p2 = b.lat / DEG, dl = (b.lon - a.lon) / DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * DEG) + 360) % 360;
}

/** The flight page URL for a view: centre, heading, and a flyable height. */
export function flightUrl({ lat, lon, heading = 0, altitude = 400, choice = "view" }) {
  const alt = choice === "view"
    ? Math.round(Math.min(3000, Math.max(150, Number(altitude) || 400)))
    : Number(choice);
  const q = new URLSearchParams({
    lat: lat.toFixed(5), lon: lon.toFixed(5), hdg: String(Math.round(heading)),
    alt: String(alt), pitch: "-8", from: "geohub",
  });
  return `${FLIGHT_URL}?${q}`;
}

async function enterFlight() {
  const viewer = window.GeoIDViewer;
  if (!viewer?.camera || !viewer.globe) return;
  const THREE = await import("../vendor/three.module.js");
  const centre = rayLatLon(viewer, THREE, 0, 0) || rayLatLon(viewer, THREE, 0, -0.5);
  if (!centre) return;
  // Facing: from the view's centre toward a point higher up the screen,
  // which is "ahead" for any tilted view. Straight down, there is no ahead:
  // the two points nearly coincide and north is as good as any.
  const ahead = rayLatLon(viewer, THREE, 0, 0.35);
  const heading = ahead && Math.hypot(ahead.lat - centre.lat, ahead.lon - centre.lon) > 1e-6
    ? bearing(centre, ahead) : 0;
  const altitude = viewer.getZoomAltitudeMetres?.()?.metres;
  const choice = document.getElementById("earth-flight-alt")?.value || "view";
  const url = flightUrl({ ...centre, heading, altitude, choice });
  try { window.top.location.assign(url); } catch (e) { window.location.assign(url); }
}

function wire() {
  if (!isEarth()) return;
  const enter = document.getElementById("earth-flight-enter");
  if (!enter || enter.dataset.wired) return;
  enter.dataset.wired = "1";
  // The button sits in the <summary>; without this the click also folds the section.
  enter.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); enterFlight(); });

  const bldg = document.getElementById("earth-buildings-toggle");
  const shadows = document.getElementById("earth-buildings-shadows");
  const status = document.getElementById("earth-buildings-status");
  const sync = () => {
    const b = window.GeoIDBuildings;
    if (!b) return;
    bldg.checked = b.isEnabled();
    shadows.checked = b.shadowsOn();
  };
  bldg?.addEventListener("change", () => window.GeoIDBuildings?.setEnabled(bldg.checked));
  shadows?.addEventListener("change", () => window.GeoIDBuildings?.setShadows(shadows.checked));
  document.addEventListener("geoid:buildings-ready", sync);
  sync();
  // A one-line readout of what the globe is holding, so "why are there no
  // buildings" has an answer on screen: too high, or how many are loaded.
  setInterval(() => {
    const b = window.GeoIDBuildings;
    if (!b || !status) return;
    const s = b.stats, km = (m) => (m / 1000).toFixed(m < 10000 ? 1 : 0);
    if (!b.isEnabled()) status.textContent = "Off.";
    else if (s.altitude == null) status.textContent = "";
    else if (s.altitude > b.thresholds.SHOW_BELOW_M && !s.tiles)
      status.textContent = `Appear below ${km(b.thresholds.SHOW_BELOW_M)} km — now ${km(s.altitude)} km up.`;
    else status.textContent = `${s.buildings.toLocaleString()} buildings in ${s.tiles} tiles`
      + (s.shadows ? " · sun shadows" : "") + (b.pending() ? " · loading…" : "");
  }, 1000);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
}
