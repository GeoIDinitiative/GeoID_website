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

import { startFlightTerrain, stopFlightTerrain, setVex, primeLaunchSite } from "./flight-terrain.js?v=20261031-1e4de64";
import { startFlightTerrainGpu, stopFlightTerrainGpu } from "./flight-terrain-gpu.js?v=20261031-1e4de64";
import { startFlightLabels, stopFlightLabels } from "./flight-labels.js?v=20261031-1e4de64";
import { startFlightGazetteer, stopFlightGazetteer } from "./flight-gazetteer.js?v=20261031-1e4de64";
import { showFlightMap, hideFlightMap } from "./flight-map.js?v=20261031-1e4de64";
import { showFlightSky, hideFlightSky } from "./flight-sky.js?v=20261031-1e4de64";
import { startFlightTiles, stopFlightTiles } from "./flight-tiles.js?v=20261031-1e4de64";
import { startFlightClouds, stopFlightClouds } from "./flight-clouds.js?v=20261031-1e4de64";
import { startFlightLights, stopFlightLights } from "./flight-lights.js?v=20261031-1e4de64";
import "./flight-place.js?v=20261031-1e4de64";
import { isEarth } from "./bodies.js?v=20261031-1e4de64";

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
  // Hidden (owner, 2026-10-24): buildings and shadows are part of the mode,
  // always on, and the counts are not something to read in flight. The
  // switches stay in the page, so the settings and their storage still work.
  rows.hidden = true;
  rows.innerHTML = `
    <div class="row"><label for="earth-buildings-toggle">3D buildings</label>
      <input id="earth-buildings-toggle" type="checkbox" checked></div>
    <div class="row"><label for="earth-buildings-shadows">Shadows</label>
      <input id="earth-buildings-shadows" type="checkbox" checked></div>
    <p class="compact-copy" id="earth-buildings-status"
       style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0.2rem 0 0;"></p>`;
  stack.appendChild(rows);
  // One line each (owner, 2026-10-24): the shared panel's "Vertical
  // exaggeration" took two lines in this column.
  const vex = section.querySelector('label[for="fs-vex"]');
  if (vex) vex.textContent = "Vertical scale";
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
      status.textContent = `Buildings below ${km(b.thresholds.SHOW_BELOW_M)} km (now ${km(s.altitude)} km)`;
    else {
      // One line: compact counts, the detail in the tooltip.
      const n = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : (v || 0).toLocaleString());
      status.textContent = `${n(s.buildings)} buildings · ${n(s.woods)} woods · ${n(s.trees)} trees` + (b.pending() ? " · loading…" : "");
      status.title = `${s.buildings.toLocaleString()} buildings, ${(s.woods || 0).toLocaleString()} woods and ${(s.trees || 0).toLocaleString()} park trees in ${s.tiles} tiles`
        + (s.shadows ? ", with sun shadows" : "");
    }
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

/**
 * KEEP a deep link's aim for the first seconds of pre-flight. The launch site
 * is the screen-centre reticle, and on a slow load something re-posed the
 * camera after the aim (to the default 20 N 0 E view), so Launch flew from
 * the Sahara. Re-aim while the camera has drifted more than half a degree,
 * for ten seconds or until the user touches the globe themselves.
 */
function holdAim(lat, lon) {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  let stop = false;
  const release = () => { stop = true; };
  canvas?.addEventListener("pointerdown", release, { once: true });
  canvas?.addEventListener("wheel", release, { once: true, passive: true });
  const started = performance.now();
  const timer = setInterval(async () => {
    if (stop || performance.now() - started > 10000 || !document.body.classList.contains("fs-preflight")) { clearInterval(timer); return; }
    const local = viewer.globe.worldToLocal(viewer.camera.position.clone());
    local.set(-local.x, local.y, -local.z);
    const r = local.length() || 1;
    const cLat = Math.asin(Math.max(-1, Math.min(1, local.y / r))) * 180 / Math.PI;
    const cLon = Math.atan2(local.z, -local.x) * 180 / Math.PI;
    const dLon = ((cLon - lon + 540) % 360) - 180;
    if (Math.abs(cLat - lat) > 0.5 || Math.abs(dLon) > 0.5) await aimAt(lat, lon);
  }, 400);
}

/**
 * The aircraft's credit, for the Metadata window while it flies. Not a
 * Workspace row: the aircraft is the mode itself (owner, 2026-10-24).
 */
function aircraftCredit() {
  const ship = window.__flightSim?.ship;
  if (!ship || !window.__flightSim?.active) return null;
  return ship.userData?.model === "aircraft"
    ? { title: "Earth Flight aircraft", source: "assets/aircraft/cessna_*.stl, generated by scripts/make-aircraft-stl.py", crs: "model metres",
        citation: "Light aircraft (Cessna 172-class), original geometry by GeoID; © GeoID Initiative, all rights reserved." }
    : { title: "Earth Flight craft", source: `assets/ships/ (${ship.userData?.model || "ship"})`, crs: "model metres",
        citation: "Flight-sim ship models shared with the Planet Explorer worlds; see assets/ships/." };
}
if (typeof window !== "undefined") {   // the tests import parseFlightLink in Node
  window.GeoIDEarthFlight = Object.assign(window.GeoIDEarthFlight || {}, { aircraftCredit });
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

  // DAYTIME ONLY, by clicking the clock -- in flight only (owner, 2026-10-26).
  // The click that opens the date picker in GeoHUB toggles a noon sun over
  // the aircraft instead (earth-viewer.js, updateSolarModel); the choice is
  // kept per browser, and landing leaves the GeoHUB's clock as it was.
  const DAY_KEY = "geoid-flight-daytime";
  const setDaytime = (on) => {
    window.__fsDaytime = Boolean(on);
    document.body.classList.toggle("fs-daytime", Boolean(on));
    const btn = document.getElementById("time-scrub-toggle");
    if (btn) btn.title = window.__flightSim?.active
      ? (on ? "Daytime only (sun at noon over the aircraft) -- click for the live clock" : "Live clock -- click for daytime only")
      : "Model time — click to jump to a date & time";
    try { localStorage.setItem(DAY_KEY, on ? "1" : "0"); } catch (_e) { /* per-browser nicety */ }
  };
  let daytime = false;
  try { daytime = localStorage.getItem(DAY_KEY) === "1"; } catch (_e) { /* storage blocked */ }
  document.getElementById("time-scrub-toggle")?.addEventListener("click", (e) => {
    if (!window.__flightSim?.active) return;              // GeoHUB: the date picker, as ever
    e.stopImmediatePropagation();
    e.preventDefault();
    daytime = !daytime;
    setDaytime(daytime);
  }, true);
  window.addEventListener("flightsim:engaged", () => {
    setDaytime(daytime);
    // A time bar opened before take-off hid the clock; flight keeps it.
    const c = document.getElementById("time-scrub-toggle");
    if (c && c.style.display === "none") c.style.display = "";
  });
  // A layer switched on or off in flight reaches the ground at once, not on
  // the drapes' timers (gis/flight-terrain-gpu.js markDrapesDirty).
  const hookDrapes = (n = 0) => {
    const m = window.GeoIDImportManager;
    if (m?.onChange) m.onChange(() => { if (window.__flightSim?.active) window.GeoIDFlightTerrainGpu?.markDrapesDirty?.(); });
    else if (n < 80) setTimeout(() => hookDrapes(n + 1), 250);
  };
  hookDrapes();
  window.addEventListener("flightsim:disengaged", () => {
    window.__fsDaytime = false;
    document.body.classList.remove("fs-daytime");
    const btn = document.getElementById("time-scrub-toggle");
    if (btn) btn.title = "Model time — click to jump to a date & time";
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
    // ...and the locator map stands above the bar, wider than it, low enough
    // to share the row's height: the row stops short of whichever is wider.
    const sc = document.getElementById("scale-readout")?.getBoundingClientRect();
    const mp = document.getElementById("fs-locator-map")?.getBoundingClientRect();
    const left = Math.min(sc && sc.width ? sc.left : Infinity, mp && mp.width ? mp.left : Infinity);
    if (Number.isFinite(left)) document.body.style.setProperty("--fs-right-reserve", `${Math.round(window.innerWidth - left)}px`);
    // Too little room between the meters and the map for the row (a narrow
    // window with the nav open stacked it one instrument per line): lift it
    // above them and let it span the whole free width instead.
    const free = r && r.width ? r.left : 0;
    const gap = (Number.isFinite(left) ? left : window.innerWidth) - (free + (m?.width || 0) + 32);
    document.body.classList.toggle("fs-hud-lifted", gap < 380);
    // Above everything in the two bottom corners: the meters, the compass
    // column over them, and the map.
    const tops = [m?.height ? m.top : Infinity, r?.height ? r.top : Infinity, mp?.height ? mp.top : Infinity];
    const top = Math.min(...tops);
    if (Number.isFinite(top)) document.body.style.setProperty("--fs-lift-bottom", `${Math.round(window.innerHeight - top + 8)}px`);
  };
  if (hudColumn) {
    layoutHud();
    for (const ev of ["flightsim:engaged", "flightsim:disengaged", "resize"]) window.addEventListener(ev, () => setTimeout(layoutHud, 50));
    // The nav slides over 0.32 s; follow it closely while flying.
    setInterval(() => { if (document.body.classList.contains("fs-flying")) layoutHud(); }, 250);
  }

  // The view gets the screen (owner, 2026-10-24). Pre-flight folds the Events
  // and Legend dropdowns away while the site is aimed; the nav stays, because
  // Launch lives in it. Once the site is chosen and the aircraft launches,
  // the nav folds too. Each panel's own state is recorded the first time it
  // is folded and put back on Exit (or on cancelling pre-flight). All are a
  // click away throughout: the Mission Control tab, the two dropdowns.
  //
  // The sim announces `flightsim:engaged` both on entering pre-flight and on
  // launch, and BEFORE it marks itself active -- so which one this is is read
  // a moment later, from the sim's state.
  let folded = null;
  const PANELS = {
    nav: { open: () => !document.getElementById("ui")?.classList.contains("is-collapsed"),
      close: "nav-collapse-btn", reopen: "nav-tab" },
    events: { open: () => isPanelOpen("events-panel"), close: "events-panel-toggle", reopen: "events-panel-toggle" },
    legend: { open: () => isPanelOpen("map-legend-panel"), close: "map-legend-toggle", reopen: "map-legend-toggle" },
  };
  function isPanelOpen(id) { const p = document.getElementById(id); return !!p && !p.hidden; }
  const fold = (names) => {
    folded = folded || {};
    for (const name of names) {
      const p = PANELS[name];
      if (!(name in folded)) folded[name] = p.open();
      if (p.open()) document.getElementById(p.close)?.click();
    }
  };
  window.addEventListener("flightsim:engaged", () => setTimeout(() => {
    if (window.__flightSim?.active) fold(["nav", "events", "legend"]);
    else if (document.body.classList.contains("fs-preflight")) fold(["events", "legend"]);
  }, 60));
  window.addEventListener("flightsim:disengaged", () => {
    if (!folded) return;
    for (const [name, wasOpen] of Object.entries(folded)) {
      const p = PANELS[name];
      if (wasOpen && !p.open()) document.getElementById(p.reopen)?.click();
    }
    folded = null;
  });

  // Plate boundaries and the events feed start OFF in flight (owner,
  // 2026-10-25: "initially the plate boundaries and events are not active in
  // the flight sim"): they are the globe's defaults, read from orbit, and from
  // a cockpit they are lines and markers across the scenery. Each is switched
  // off once per flight -- the first time it is found on, so a default that
  // loads late is caught too -- and switching it back on mid-flight sticks.
  // Leaving flight gives back whatever this turned off; the GeoHUB's own
  // remembered choices are not touched.
  const QUIET_LAYERS = ["plate-boundaries", "plate-boundary-symbols"];
  let quieted = null;
  function quietGlobeOverlays() {
    quieted = quieted || { ids: new Set(), layers: [], events: null };
    const G = window.GeoIDGlobalData, H = window.GeoIDLayerHierarchy;
    for (const id of QUIET_LAYERS) {
      if (quieted.ids.has(id)) continue;
      const layer = G?.layerForDataset?.(id);
      // Only once it has landed: a layer still loading has no geometry yet,
      // and the geometry that arrives later comes in visible.
      if (!layer || layer.status !== "loaded" || !layer.object3D) continue;
      quieted.ids.add(id);
      if (layer.visible === false) continue;
      if (H?.setVisible) H.setVisible(layer, false);
      else { layer.visible = false; if (layer.object3D) layer.object3D.visible = false; }
      quieted.layers.push(layer);
    }
    const E = window.GeoIDEvents;
    if (quieted.events === null && E?.isActive) {
      quieted.events = Boolean(E.isActive());
      // quiet: step aside, leaving the list, the section and the spin alone
      if (quieted.events) E.setActive(false, { remember: false, quiet: true });
    }
  }
  function restoreGlobeOverlays() {
    if (!quieted) return;
    const H = window.GeoIDLayerHierarchy;
    for (const layer of quieted.layers) {
      if (layer.visible !== false) continue;          // the reader already put it back
      if (H?.setVisible) H.setVisible(layer, true);
      else { layer.visible = true; if (layer.object3D) layer.object3D.visible = true; }
    }
    if (quieted.events && !window.GeoIDEvents?.isActive?.()) window.GeoIDEvents?.setActive?.(true, { remember: false, quiet: true });
    quieted = null;
  }
  window.addEventListener("flightsim:engaged", () => {
    // Again over the first half-minute, for a launch default still on its way.
    for (const ms of [60, 2000, 5000, 10000, 20000, 30000]) setTimeout(() => { if (quieted || ms === 60) quietGlobeOverlays(); }, ms);
  });
  window.addEventListener("flightsim:disengaged", restoreGlobeOverlays);

  // Expanding the nav DURING FLIGHT opens it on Earth Flight (owner,
  // 2026-10-24): the Explorer group and the flight panel are opened and the
  // panel is scrolled to the middle of the nav, rather than the nav coming
  // back as a column of closed sections. Flight only -- the ordinary nav keeps
  // whatever it had.
  document.getElementById("nav-tab")?.addEventListener("click", () => {
    if (!window.__flightSim?.active) return;
    const group = document.getElementById("geoid-controls-group");
    const section = document.getElementById("flightsim-section");
    if (!section) return;
    if (group && !group.open) group.open = true;
    if (!section.open) section.open = true;
    // After the nav has slid in (0.32 s), so the scroller has its height.
    setTimeout(() => section.scrollIntoView({ block: "center", behavior: "smooth" }), 360);
  });

  // A sky over the aircraft -- day, dusk or night from the real sun -- in
  // place of the viewer's space backdrop, while flying (flight-sky.js).
  window.addEventListener("flightsim:engaged", () => setTimeout(() => {
    if (!window.__flightSim?.active && document.body.classList.contains("fs-preflight")) primeLaunchSite();
    if (window.__flightSim?.active) {
      setVex(document.getElementById("fs-vex")?.value || 1);
      startFlightTerrain(); startFlightTerrainGpu(); startFlightTiles(); startFlightClouds(); startFlightLights(); showFlightSky(); showFlightMap(); startFlightGazetteer(); startFlightLabels();
    }
  }, 60));
  window.addEventListener("flightsim:disengaged", () => { stopFlightTerrain(); stopFlightTerrainGpu(); stopFlightTiles(); stopFlightClouds(); stopFlightLights(); hideFlightSky(); hideFlightMap(); stopFlightLabels(); stopFlightGazetteer(); });
  // The Vertical scale slider exaggerates the flight terrain (1 = true scale).
  document.addEventListener("input", (e) => { if (e.target?.id === "fs-vex") setVex(e.target.value); });


  let link = parseFlightLink(window.location.search);
  try { link = link || parseFlightLink(window.top.location.search); } catch (e) { /* cross-origin top */ }
  if (!link) return;
  whenReady(() => window.GeoIDViewer?.globe && window.__flightSimHooks && window.__flightSim?.enterPreflight,
    async () => {
      window.GeoIDViewer.setSpinPaused?.(true);
      if (link.lat != null) await aimAt(link.lat, link.lon);
      setTimeout(() => window.__flightSim.enterPreflight(), 300);
      if (link.lat != null) holdAim(link.lat, link.lon);
    });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
}
