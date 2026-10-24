// Earth Flight in Explorer: the shared flight sim's own panel, plus Earth's
// switches for the globe's streamed 3D buildings (osm-buildings.js), plus the
// deep link that opens it.
//
// Earth Flight used to be its own page (flight_sim/earth/) with its own
// toolbar and HUD. It is now the SAME mode every other world flies --
// scripts/flightsim.js, its pre-flight crosshair and Launch, its HUD, meters
// and keys -- running on this globe through the hooks earth-viewer.js
// publishes. This module only does the three Earth-specific things the
// shared sim does not:
//
//   1. puts the sim's injected `#flightsim-section` at the top of Explorer
//      and names it Earth Flight. The sim inserts it before the first
//      control-section on DOMContentLoaded, which on this page can run after
//      the toolbox has already folded the panels into Explorer, leaving it
//      loose; placing it here makes the order not matter;
//   2. adds the buildings and shadows switches and a one-line status to that
//      panel, so the controls that belong to Earth sit with its flight;
//   3. answers `?flight=earth&lat=..&lon=..` (the old flight_sim/earth/ URL
//      bounces to /?flight=earth..., and the shell carries it into this
//      frame): aim the globe there, then open pre-flight, whose centre
//      crosshair takes the site from wherever the globe is aimed.

import { isEarth } from "./bodies.js?v=20261024-ab031d4";

/** `?flight=earth&lat=..&lon=..` -> { lat, lon } or { lat: null } or null. */
export function parseFlightLink(search) {
  let q;
  try { q = new URLSearchParams(search || ""); } catch (e) { return null; }
  const f = (q.get("flight") || "").toLowerCase();
  if (f !== "earth" && f !== "1") return null;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (q.has("lat") && q.has("lon") && Number.isFinite(lat) && Number.isFinite(lon)
      && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) return { lat, lon };
  return { lat: null, lon: null };
}

function placePanel(section) {
  const host = document.getElementById("geoid-controls-host");
  if (host && host.firstChild !== section) host.insertBefore(section, host.firstChild);
  const title = section.querySelector(".section-title-row span:last-child");
  if (title) title.textContent = "Earth Flight";
}

function addEarthRows(section) {
  if (section.querySelector("#earth-buildings-toggle")) return;
  const stack = section.querySelector(".control-stack");
  if (!stack) return;
  const rows = document.createElement("div");
  rows.className = "earth-flight-rows";
  rows.innerHTML = `
    <div class="row"><label for="earth-buildings-toggle">3D buildings on the globe</label>
      <input id="earth-buildings-toggle" type="checkbox" checked></div>
    <div class="row"><label for="earth-buildings-shadows">Building shadows</label>
      <input id="earth-buildings-shadows" type="checkbox" checked></div>
    <p class="compact-copy" id="earth-buildings-status"></p>`;
  stack.appendChild(rows);
  const bldg = rows.querySelector("#earth-buildings-toggle");
  const shadows = rows.querySelector("#earth-buildings-shadows");
  const status = rows.querySelector("#earth-buildings-status");
  const sync = () => {
    const b = window.GeoIDBuildings;
    if (!b) return;
    bldg.checked = b.isEnabled();
    shadows.checked = b.shadowsOn();
  };
  bldg.addEventListener("change", () => window.GeoIDBuildings?.setEnabled(bldg.checked));
  shadows.addEventListener("change", () => window.GeoIDBuildings?.setShadows(shadows.checked));
  document.addEventListener("geoid:buildings-ready", sync);
  sync();
  // What the globe is holding, so "why are there no buildings" has an answer.
  setInterval(() => {
    const b = window.GeoIDBuildings;
    if (!b) return;
    const s = b.stats, km = (m) => (m / 1000).toFixed(m < 10000 ? 1 : 0);
    if (!b.isEnabled()) status.textContent = "Buildings off.";
    else if (s.altitude == null) status.textContent = "";
    else if (s.altitude > b.thresholds.SHOW_BELOW_M && !s.tiles)
      status.textContent = `Buildings appear below ${km(b.thresholds.SHOW_BELOW_M)} km — now ${km(s.altitude)} km up.`;
    else status.textContent = `${s.buildings.toLocaleString()} buildings, ${(s.trees || 0).toLocaleString()} trees in ${s.tiles} tiles`
      + (s.shadows ? " · sun shadows" : "") + (b.pending() ? " · loading…" : "");
  }, 1000);
}

/** Point the orbit camera straight down at a place, from `heightUnits` up. */
async function aimAt(lat, lon, heightUnits = 0.02) {
  const viewer = window.GeoIDViewer;
  const THREE = await import("../vendor/three.module.js");
  const v = viewer.latLonToVector3(lat, lon, 1);
  const world = viewer.globe.localToWorld(new THREE.Vector3(-v.x, v.y, -v.z)).normalize();
  const centre = viewer.globe.localToWorld(new THREE.Vector3());
  viewer.clearZoomTarget?.();
  viewer.camera.position.copy(centre).addScaledVector(world, 3.2 + heightUnits);
  viewer.camera.lookAt(centre);
  viewer.controls?.update?.();
}

const AIRCRAFT_LAYER = "Earth Flight aircraft";
function publishAircraft() {
  const manager = window.GeoIDImportManager, ship = window.__flightSim?.ship;
  if (!manager?.adoptLayer || !ship || !window.__flightSim?.active) return;
  const own = ship.userData?.model === "aircraft";
  // A PROXY object, not the ship: the stack stamps an adopted root's draw
  // order into the 50s, and the ship draws at 400 so labels cannot paint over
  // it (scripts/flightsim.js, buildShip). The row is the credit.
  const proxy = new ship.constructor();
  proxy.name = "GeoID-EarthFlightAircraftCredit";
  const layer = manager.adoptLayer(AIRCRAFT_LAYER, proxy, {
    ext: "stl", role: "aircraft",
    info: own
      ? { source: "assets/aircraft/cessna_*.stl, generated by scripts/make-aircraft-stl.py", format: "STL",
          citation: "Light aircraft (Cessna 172-class), original geometry by GeoID; this repository's licence. See assets/aircraft/README.md.", crs: "model metres" }
      : { source: `assets/ships/ (${ship.userData?.model || "ship"})`, format: "STL",
          citation: "Flight-sim ship models shared with the Planet Explorer worlds; see assets/ships/.", crs: "model metres" },
    onRemove: () => window.__flightSim?.disengage?.(),
  });
  if (layer) layer.legendHidden = true;
}

function whenReady(test, fn, tries = 600) {
  if (test()) { fn(); return; }
  if (tries <= 0) return;
  setTimeout(() => whenReady(test, fn, tries - 1), 100);
}

function wire() {
  if (!isEarth()) return;
  // Flight on Earth keeps the whole GeoHUB around it: nav, Workspace, rail and
  // tools stay open in the air (styles/flightsim.css scopes every "flight
  // hides this" rule to bodies without this class).
  document.body.classList.add("fs-open-chrome");
  whenReady(() => document.getElementById("flightsim-section"), () => {
    const section = document.getElementById("flightsim-section");
    placePanel(section);
    addEarthRows(section);
    // Earth Flight flies the light aircraft by default; the other worlds'
    // ships stay in the same picker.
    const pick = document.getElementById("fs-ship-model");
    if (pick && !pick.dataset.earthDefault && [...pick.options].some((o) => o.value === "aircraft")) {
      pick.value = "aircraft";
      pick.dataset.earthDefault = "1";
    }
    // The toolbox re-lays the sidebar on every mode change; keep the panel first.
    const host = document.getElementById("geoid-controls-host");
    if (host) new MutationObserver(() => { if (host.firstChild !== section) placePanel(section); })
      .observe(host, { childList: true });
  });

  // Help and Controls sit under the model clock (styles/flightsim.css). The
  // clock moves with the sidebar and the window, so its foot is re-measured.
  const clock = document.getElementById("time-scrub-toggle");
  const pinUnderClock = () => {
    const r = clock?.getBoundingClientRect();
    if (!r || !r.width) return;
    document.body.style.setProperty("--fs-clock-left", `${Math.round(r.left)}px`);
    document.body.style.setProperty("--fs-clock-bottom", `${Math.round(r.bottom + 6)}px`);
  };
  if (clock) {
    pinUnderClock();
    new ResizeObserver(pinUnderClock).observe(clock);
    window.addEventListener("resize", pinUnderClock);
    for (const ev of ["flightsim:engaged", "flightsim:disengaged"]) window.addEventListener(ev, () => setTimeout(pinUnderClock, 50));
    setInterval(pinUnderClock, 1500);   // the sidebar slides; cheap enough
  }

  // The HUD's free area starts where the compass column does: that column
  // already moves with the nav's expand/collapse. Published with the meters'
  // height so the CSS can stack compass over meters in that corner and centre
  // the tape and instrument row on what is left.
  const hudColumn = document.getElementById("bottom-right-hud");
  const layoutHud = () => {
    const r = hudColumn?.getBoundingClientRect();
    if (r && r.width) document.body.style.setProperty("--fs-free-left", `${Math.round(r.left)}px`);
    const m = document.getElementById("fs-meters")?.getBoundingClientRect();
    if (m && m.height) {
      document.body.style.setProperty("--fs-meters-h", `${Math.round(m.height)}px`);
      document.body.style.setProperty("--fs-meters-w", `${Math.round(m.width)}px`);
    }
    // The scale bar keeps the bottom-right corner; the instrument row stops short of it.
    const sc = document.getElementById("scale-readout")?.getBoundingClientRect();
    if (sc && sc.width) document.body.style.setProperty("--fs-right-reserve", `${Math.round(window.innerWidth - sc.left)}px`);
  };
  if (hudColumn) {
    layoutHud();
    for (const ev of ["flightsim:engaged", "flightsim:disengaged", "resize"]) window.addEventListener(ev, () => setTimeout(layoutHud, 50));
    // The nav slides over 0.32 s; follow it closely while flying.
    setInterval(() => { if (document.body.classList.contains("fs-flying")) layoutHud(); }, 250);
  }

  // The aircraft is listed in the Workspace while it flies, so its credit is
  // in the Metadata tab with every other source on screen.
  window.addEventListener("flightsim:engaged", () => setTimeout(publishAircraft, 500));
  window.addEventListener("flightsim:disengaged", () => window.GeoIDImportManager?.releaseLayer?.(AIRCRAFT_LAYER));

  let link = parseFlightLink(window.location.search);
  try { link = link || parseFlightLink(window.top.location.search); } catch (e) { /* cross-origin top */ }
  if (!link) return;
  whenReady(() => window.GeoIDViewer?.globe && window.__flightSimHooks && window.__flightSim?.enterPreflight,
    async () => {
      window.GeoIDViewer.setSpinPaused?.(true);
      if (link.lat != null) await aimAt(link.lat, link.lon);
      setTimeout(() => window.__flightSim.enterPreflight(), 300);
    });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
}
