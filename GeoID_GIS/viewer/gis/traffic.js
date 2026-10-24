/**
 * Aircraft and ships, live — the satellite tracker's arrangement, applied to
 * the two kinds of traffic that report their own positions.
 *
 * Every piece of the satellite tab is kept, because it is what makes a live
 * layer an ordinary one: a layer row with its eye and legend
 * (`addDerivedLayer`), round dots in a nested band-198 group so a streamed
 * drape cannot paint over them, a screen-space picker, the same corner card
 * through `featureToItem` + `openSceneFeature`, a fly-to and a follow, and
 * the craft drawn as a model at TRUE SIZE close in — an InstancedMesh per
 * STL part, camera-relative, so a 38 m airliner does not shimmer six
 * thousand kilometres from the planet's centre.
 *
 * What differs is only what the feeds differ in, and `traffic-feeds.js` owns
 * that: which services answer a browser with no key of ours, the shapes they
 * answer in, and dead reckoning between answers. Positions are real time —
 * a report is about NOW — so the tracker drops the globe to the LIVE rate as
 * the satellite tracker does, and puts the time-lapse back only if it did so.
 */
import * as THREE from "../vendor/three.module.js";
// Unversioned, as the satellite tracker imports it.
import { STLLoader } from "../vendor/STLLoader.js";
import {
  AIR_SOURCES, AIR_CATEGORIES, SHIP_CATEGORIES, readDigitraffic, foldAisStream, aisStreamSubscription,
  boxAbout, deadReckon, radiusForView, mergeRecords, cardRows, headingBasis, KT_TO_MS,
} from "./traffic-feeds.js?v=20261024-16ef562";
import { isParked } from "./parked.js?v=20261024-16ef562";
import { followFrame, FOLLOW_PITCH_MAX } from "./satellites.js?v=20261024-16ef562";

const KM_TO_UNITS = 3.2 / 6371;
const M_TO_UNITS = KM_TO_UNITS / 1000;
const AIS_KEY = "geoid-gis:aisstream-key";
const MODEL_VERSION = "1";
const MODEL_MAX = 64;
/** Fintraffic's feed covers the Baltic and around Finland, and nothing else. */
const DIGITRAFFIC_BOX = { south: 53, north: 66.5, west: 9, east: 32 };

const signedLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/* ── the two trackers ────────────────────────────────────────────────────── */

const SPECS = {
  air: {
    key: "air",
    layerName: "Live aircraft (ADS-B)",
    noun: "Aircraft",
    categories: AIR_CATEGORIES,
    staleMs: 75_000,
    refreshMs: 10_000,
    modelLength: 37.6,
    landFactor: 4,
    models: [
      { file: "aircraft_body.stl", colour: 0xf2f4f8, metalness: 0.25, roughness: 0.45 },
      { file: "aircraft_wings.stl", colour: 0xb8bec8, metalness: 0.4, roughness: 0.4 },
      { file: "aircraft_accent.stl", colour: 0xffffff, metalness: 0.1, roughness: 0.5, tinted: true },
    ],
    dot: { fill: 6, outline: 8.6, shape: "disc" },
    ids: { toggle: "traffic-air-toggle", status: "traffic-air-status", categories: "traffic-air-categories", labels: "traffic-air-labels", symbology: "traffic-air-symbology" },
    citation: "ADS-B positions from adsb.lol (ODbL 1.0), airplanes.live or the OpenSky Network, whichever answers.",
  },
  sea: {
    key: "sea",
    layerName: "Live ships (AIS)",
    noun: "Ship",
    categories: SHIP_CATEGORIES,
    staleMs: 20 * 60_000,
    refreshMs: 60_000,
    modelLength: 200,
    landFactor: 3,
    models: [
      { file: "ship_hull.stl", colour: 0x343a44, metalness: 0.2, roughness: 0.7 },
      { file: "ship_deck.stl", colour: 0xe8e6e0, metalness: 0.1, roughness: 0.6 },
      { file: "ship_cargo.stl", colour: 0xffffff, metalness: 0.1, roughness: 0.6, tinted: true },
    ],
    dot: { fill: 5.6, outline: 8, shape: "diamond" },
    ids: { toggle: "traffic-sea-toggle", status: "traffic-sea-status", categories: "traffic-sea-categories", labels: "traffic-sea-labels", symbology: "traffic-sea-symbology" },
    citation: "AIS from Fintraffic's Digitraffic (CC BY 4.0) or aisstream.io with the reader's own key.",
  },
};

/** Per tracker: everything a running tracker holds, or null when off. */
const trackers = { air: null, sea: null };
const enabled = { air: new Set(AIR_CATEGORIES.map(([n]) => n)), sea: new Set(SHIP_CATEGORIES.map(([n]) => n)) };
const runIds = { air: 0, sea: 0 };
let liveClaims = 0;
let autoRealTime = false;

function say(spec, message) {
  const node = document.getElementById(spec.ids.status);
  if (node) node.textContent = message || "";
}

function layerOf(spec) {
  return (window.GeoIDImportManager?.getLayers?.() || []).find((l) => l.name === spec.layerName);
}

function colourOf(spec, record) {
  if (record.colour) return record.colour;
  return (spec.categories.find(([n]) => n === record.category) || spec.categories[spec.categories.length - 1])[1];
}

/* ── textures ────────────────────────────────────────────────────────────── */

const textures = {};
function dotTexture(shape) {
  if (textures[shape]) return textures[shape];
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  if (shape === "diamond") {
    ctx.moveTo(size / 2, size * 0.08);
    ctx.lineTo(size * 0.92, size / 2);
    ctx.lineTo(size / 2, size * 0.92);
    ctx.lineTo(size * 0.08, size / 2);
    ctx.closePath();
  } else if (shape === "ring") {
    ctx.lineWidth = size * 0.09;
    ctx.strokeStyle = "#ffffff";
    ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    textures[shape] = new THREE.CanvasTexture(canvas);
    return textures[shape];
  } else {
    ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
  }
  ctx.fill();
  textures[shape] = new THREE.CanvasTexture(canvas);
  return textures[shape];
}

/* ── where a craft is ────────────────────────────────────────────────────── */

const _v = new THREE.Vector3();

/**
 * A craft's place in the layer's own (baseline, Earth-fixed) frame, and the
 * radius of the drawn ground under it.
 *
 * The GROUND is read the way the globe is drawn — the shipped elevation
 * times the live exaggeration — and an aircraft stands its own height above
 * THAT, never above a bare sphere: the exaggerated relief would otherwise
 * swallow every low flight from orbit. Read through `elevationNormalized`
 * rather than `surfacePoint` on purpose: the seam's surfacePoint caches by
 * position, and a thousand moving craft a second would grow that cache for
 * the life of the page.
 */
function placeCraft(record, lat, lon, target) {
  const viewer = window.GeoIDViewer;
  const relief = viewer?.getEffectiveRelief?.() ?? 0;
  const norm = viewer?.elevationNormalized?.(lat, lon);
  const groundR = 3.2 + (Number.isFinite(norm) ? norm : 0) * relief;
  let aboveM = 0;
  if (record.kind === "Aircraft" && !record.onGround && Number.isFinite(record.altM)) {
    const groundM = Math.max(0, Number(viewer?.sampleElevationMeters?.(lat, lon)) || 0);
    aboveM = Math.max(0, record.altM - groundM);
  }
  const r = groundR + aboveM * M_TO_UNITS;
  const p = viewer?.latLonToVector3?.(lat, lon, r);
  if (!p) return null;
  target.copy(p);
  return groundR;
}

/* ── models ─────────────────────────────────────────────────────────────── */

const modelData = { air: null, sea: null };
const modelPromise = { air: null, sea: null };
function loadModel(spec) {
  if (modelPromise[spec.key]) return modelPromise[spec.key];
  const loader = new STLLoader();
  modelPromise[spec.key] = Promise.all(spec.models.map((part) => new Promise((resolve, reject) => {
    const url = new URL(`../assets/models/${part.file}?v=${MODEL_VERSION}`, import.meta.url).href;
    loader.load(url, resolve, undefined, reject);
  }))).then((geometries) => {
    modelData[spec.key] = { geometries };
    return modelData[spec.key];
  }).catch(() => {
    // A model that cannot load leaves the dots exactly as they were.
    modelData[spec.key] = { failed: true };
    return null;
  });
  return modelPromise[spec.key];
}

function ensureModelMeshes(t) {
  const data = modelData[t.spec.key];
  if (t.models || !data?.geometries) return;
  const group = new THREE.Group();
  group.name = `traffic-models-${t.spec.key}`;
  group.renderOrder = 197;
  group.userData.keepRenderOrder = true;
  const meshes = t.spec.models.map((part, k) => {
    const material = new THREE.MeshStandardMaterial({
      color: part.colour, metalness: part.metalness, roughness: part.roughness,
      side: THREE.DoubleSide, transparent: true, opacity: 1, depthWrite: true,
    });
    const mesh = new THREE.InstancedMesh(data.geometries[k], material, MODEL_MAX);
    mesh.name = `traffic-model-${part.file.replace(/\.stl$/, "")}`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (part.tinted) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MODEL_MAX * 3).fill(1), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  });
  t.group.add(group);
  t.models = { group, meshes };
}

/** A craft is drawn as a model within a pixel or so of being visible. */
const modelFarUnits = (record) => record.lengthM * 2000 * M_TO_UNITS;
const landUnits = (spec, record) => Math.max(120, record.lengthM * spec.landFactor) * M_TO_UNITS;
const followMinUnits = (record) => record.lengthM * 0.8 * M_TO_UNITS;
const FOLLOW_MAX_UNITS = 2000 * KM_TO_UNITS;

/* ── the dots, every tick ───────────────────────────────────────────────── */

function groupShown(t) {
  if (!t || t.layer?.visible === false) return false;
  for (let node = t.group; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function ensureCapacity(t, n) {
  if (t.capacity >= n) return;
  let capacity = Math.max(256, t.capacity);
  while (capacity < n) capacity *= 2;
  const pos = new THREE.Float32BufferAttribute(new Float32Array(capacity * 3), 3);
  const col = new THREE.Float32BufferAttribute(new Float32Array(capacity * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  t.geometry.setAttribute("position", pos);
  t.geometry.setAttribute("color", col);
  t.capacity = capacity;
}

/** Move every dot to where its craft is now, carried along its track. */
function tick(t) {
  if (!t || trackers[t.spec.key] !== t) return;
  if (!layerOf(t.spec)) { stop(t.spec); return; }
  const now = Date.now();
  mergeRecords(t.held, [], now, t.spec.staleMs);
  const list = [];
  t.held.forEach((record) => { if (enabled[t.spec.key].has(record.category)) list.push(record); });
  ensureCapacity(t, list.length);
  const colours = t.geometry.attributes.color;
  const c = new THREE.Color();
  list.forEach((record, i) => {
    const at = deadReckon(record, now);
    record.index = i;
    record.pos = record.pos || new THREE.Vector3();
    const groundR = placeCraft(record, at.lat, at.lon, record.pos);
    record.groundR = groundR || 0;
    c.set(colourOf(t.spec, record));
    colours.setXYZ(i, c.r, c.g, c.b);
    record.feature.geometry.coordinates[0] = +at.lon.toFixed(5);
    record.feature.geometry.coordinates[1] = +at.lat.toFixed(5);
  });
  t.list = list;
  t.geometry.setDrawRange(0, list.length);
  colours.needsUpdate = true;
  t.layer.features = list.map((r) => r.feature);
  // Streamed ships have no fetch of their own to report through.
  if (t.ais && (t.aisTicks = (t.aisTicks || 0) + 1) % 5 === 0) {
    updateLegendCounts(t);
    say(t.spec, `${t.held.size.toLocaleString()} ships streaming from aisstream.io with your key `
      + `(${t.ais.count.toLocaleString()} reports this session) — moored ships report every few minutes.`);
  }
  maybeRefresh(t);
}

/* ── fetching ───────────────────────────────────────────────────────────── */

function viewNow() {
  const viewer = window.GeoIDViewer;
  const centre = viewer?.getViewCentreLatLon?.();
  const altM = viewer?.getZoomAltitudeMetres?.()?.metres;
  if (!centre || !Number.isFinite(centre.lat)) return null;
  return { lat: centre.lat, lon: signedLon(centre.lon), altKm: Number.isFinite(altM) ? altM / 1000 : 20_000 };
}

/** Fetch early when the view has moved past half the area last asked for. */
function maybeRefresh(t) {
  if (t.fetching || !groupShown(t)) return;
  const now = Date.now();
  const view = viewNow();
  const due = now - t.lastFetch > t.spec.refreshMs;
  let moved = false;
  if (view && t.lastView) {
    const dKm = Math.hypot(view.lat - t.lastView.lat,
      (view.lon - t.lastView.lon) * Math.cos((view.lat * Math.PI) / 180)) * 111.2;
    const rKm = radiusForView(t.lastView.altKm) * 1.852;
    moved = dKm > rKm * 0.5 || view.altKm < t.lastView.altKm / 3;
  }
  if (due || (moved && now - t.lastFetch > 3000)) refresh(t);
}

function explain(error) {
  if (error?.name === "AbortError") return "did not answer in time";
  if (error instanceof TypeError) return "did not answer this page (network, or a CORS refusal)";
  return error?.message || String(error);
}

async function fetchJson(url, ms = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(t) {
  if (t.fetching) return;
  t.fetching = true;
  t.lastFetch = Date.now();
  const view = viewNow();
  t.lastView = view;
  try {
    if (t.spec.key === "air") await refreshAir(t, view);
    else await refreshSea(t, view);
  } finally {
    t.fetching = false;
  }
  // What arrived is drawn now, not on the next tick.
  if (trackers[t.spec.key] === t) { tick(t); refreshSelectedCard(t); }
}

async function refreshAir(t, view) {
  if (!view) { say(t.spec, "Waiting for the globe to say where it is looking."); return; }
  const nm = radiusForView(view.altKm);
  const order = [t.goodSource, ...AIR_SOURCES.map((_, i) => i).filter((i) => i !== t.goodSource)];
  const failures = [];
  for (const i of order) {
    const source = AIR_SOURCES[i];
    try {
      const json = await fetchJson(source.url(view.lat, view.lon, nm));
      if (trackers.air !== t) return;
      const fresh = source.read(json);
      fresh.forEach((r) => adopt(t, r));
      mergeRecords(t.held, fresh, Date.now(), t.spec.staleMs);
      t.goodSource = i;
      t.sourceName = source.name;
      t.licence = source.licence;
      updateLegendCounts(t);
      say(t.spec, `${t.held.size.toLocaleString()} aircraft within ${Math.round(nm)} nm of the view's centre `
        + `— from ${source.name}, refreshing every ${t.spec.refreshMs / 1000} s, carried along their tracks between reports.`);
      return;
    } catch (error) {
      failures.push(`${source.name} ${explain(error)}`);
    }
  }
  say(t.spec, `No aircraft feed answered: ${failures.join("; ")}. ${t.held.size ? "Showing the last positions until they go stale." : ""}`);
}

/** Every record carries a feature the card and the table read. */
function adopt(t, record) {
  const old = t.held.get(record.id);
  record.feature = old?.feature || { type: "Feature", geometry: { type: "Point", coordinates: [record.lon, record.lat] }, properties: {} };
  record.pos = old?.pos;
}

function inBox(view, box) {
  return view && view.lat >= box.south && view.lat <= box.north && view.lon >= box.west && view.lon <= box.east;
}

async function refreshSea(t, view) {
  const key = readAisKey();
  if (key) { openAisStream(t, key, view); return; }
  closeAisStream(t);
  if (!inBox(view, DIGITRAFFIC_BOX)) {
    say(t.spec, "Without a key, open AIS reaches the Baltic around Finland (Fintraffic's Digitraffic) — fly there, "
      + "or add your own free aisstream.io key below for ships anywhere.");
    return;
  }
  try {
    const km = Math.min(radiusForView(view.altKm) * 1.852, 600);
    const from = Date.now() - 20 * 60_000;
    const base = "https://meri.digitraffic.fi/api/ais/v1";
    const positions = await fetchJson(`${base}/locations?latitude=${view.lat.toFixed(4)}&longitude=${view.lon.toFixed(4)}&radius=${Math.round(km)}&from=${from}`, 25_000);
    if (trackers.sea !== t) return;
    if (!t.vessels || Date.now() - t.vesselsAt > 30 * 60_000) {
      try {
        t.vessels = await fetchJson(`${base}/vessels?from=${Date.now() - 24 * 3600_000}`, 30_000);
        t.vesselsAt = Date.now();
      } catch (error) { t.vessels = t.vessels || []; }
    }
    if (trackers.sea !== t) return;
    const fresh = readDigitraffic(positions, t.vessels);
    fresh.forEach((r) => adopt(t, r));
    mergeRecords(t.held, fresh, Date.now(), t.spec.staleMs);
    t.sourceName = "Digitraffic (Fintraffic)";
    updateLegendCounts(t);
    say(t.spec, `${t.held.size.toLocaleString()} ships within ${Math.round(km)} km — Fintraffic's open AIS (CC BY 4.0), `
      + `refreshing every ${t.spec.refreshMs / 1000} s.`);
  } catch (error) {
    say(t.spec, `Digitraffic ${explain(error)}.`);
  }
}

/* ── aisstream.io, with the reader's own key ─────────────────────────────── */

function readAisKey() {
  try { return window.localStorage.getItem(AIS_KEY) || ""; } catch (error) { return ""; }
}

function openAisStream(t, key, view) {
  if (!view) return;
  const box = boxAbout(view.lat, view.lon, radiusForView(view.altKm) * 1852);
  if (t.ais?.socket && t.ais.socket.readyState <= 1) {
    // An open stream takes a new subscription in place.
    if (t.ais.socket.readyState === 1) t.ais.socket.send(aisStreamSubscription(key, box));
    t.ais.box = box;
    return;
  }
  let socket;
  try { socket = new WebSocket("wss://stream.aisstream.io/v0/stream"); } catch (error) {
    say(t.spec, `aisstream.io ${explain(error)}.`);
    return;
  }
  t.ais = { socket, box, count: 0 };
  socket.addEventListener("open", () => { socket.send(aisStreamSubscription(key, t.ais?.box || box)); });
  socket.addEventListener("message", async (event) => {
    if (trackers.sea !== t) return;
    try {
      const text = typeof event.data === "string" ? event.data : await event.data.text();
      const message = JSON.parse(text);
      if (message?.error) { say(t.spec, `aisstream.io refused: ${message.error}`); return; }
      const record = foldAisStream(message, t.held);
      if (record) {
        if (!record.feature) adopt(t, record);
        t.ais.count += 1;
      }
    } catch (error) { /* one unreadable message must not stop the stream */ }
  });
  socket.addEventListener("close", (event) => {
    if (trackers.sea !== t || t.ais?.socket !== socket) return;
    t.ais = null;
    say(t.spec, `aisstream.io closed the stream${event.code === 1000 ? "" : ` (code ${event.code})`} — `
      + "a refused key closes it at once; check the key, or Forget it to use the open Baltic feed.");
  });
  t.sourceName = "aisstream.io";
  say(t.spec, "Streaming AIS from aisstream.io with your key — ships appear as they report (moored ones every few minutes).");
}

function closeAisStream(t) {
  const socket = t?.ais?.socket;
  if (t) t.ais = null;
  try { socket?.close?.(1000); } catch (error) { /* already gone */ }
}

/* ── the legend ─────────────────────────────────────────────────────────── */

function updateLegendCounts(t) {
  const counts = t.spec.categories.map(([name]) => 0);
  t.held.forEach((r) => {
    const k = t.spec.categories.findIndex(([n]) => n === r.category);
    if (k >= 0) counts[k] += 1;
  });
  t.legendInfo.counts = counts;
  t.held.forEach((r) => { r.feature.properties = featureProperties(t, r); });
  refreshCategoryCounts(t);
}

function featureProperties(t, r) {
  const rows = cardRows(r, Date.now());
  const speed = Number.isFinite(r.speedMs) ? `${Math.round(r.speedMs / KT_TO_MS)} kn` : "speed not reported";
  const height = r.kind === "Aircraft"
    ? (r.onGround ? "on the ground" : Number.isFinite(r.altM) ? `${Math.round(r.altM).toLocaleString("en-GB")} m` : "altitude not reported")
    : (r.props?.status || "under way");
  return {
    ...r.props,
    name: r.name,
    kind: r.kind === "Aircraft" ? "Aircraft" : (r.category === "Other or unknown" ? "Ship" : `${r.category} ship`),
    category: r.category,
    label_rank: 0,
    no_flash: true,
    dimension: `${height} · ${speed}`,
    extra_rows: rows,
    summary: `${r.name} is tracked live from ${r.source}, drawn ${r.kind === "Aircraft" ? "at its reported altitude" : "where it reported"} `
      + "and carried along its reported track between reports. Drawn at its true size close in.",
  };
}

/* ── per category toggles ────────────────────────────────────────────────── */

function buildCategoryList(spec) {
  const host = document.getElementById(spec.ids.categories);
  if (!host || host.dataset.built) return;
  host.dataset.built = "1";
  host.textContent = "";
  spec.categories.forEach(([name, colour]) => {
    const row = document.createElement("label");
    row.className = "traffic-category";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = enabled[spec.key].has(name);
    box.addEventListener("change", () => {
      if (box.checked) enabled[spec.key].add(name); else enabled[spec.key].delete(name);
      const t = trackers[spec.key];
      if (t) tick(t);
    });
    const swatch = document.createElement("span");
    swatch.className = "traffic-swatch";
    swatch.style.background = colour;
    const text = document.createElement("span");
    text.className = "traffic-category-name";
    text.textContent = name;
    const count = document.createElement("span");
    count.className = "traffic-category-count";
    count.dataset.category = name;
    row.append(box, swatch, text, count);
    host.appendChild(row);
  });
}

function refreshCategoryCounts(t) {
  const host = document.getElementById(t.spec.ids.categories);
  if (!host) return;
  t.spec.categories.forEach(([name], k) => {
    const node = host.querySelector(`.traffic-category-count[data-category="${CSS.escape(name)}"]`);
    if (node) node.textContent = t.legendInfo.counts[k] ? String(t.legendInfo.counts[k]) : "";
  });
}

/* ── picking, cards and the selection ───────────────────────────────────── */

const _world = new THREE.Vector3();
const _camLocal = new THREE.Vector3();
const _inverse = new THREE.Matrix4();

/** The craft whose dot is nearest the pointer, within its drawn size. */
function recordAt(t, clientX, clientY) {
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  if (!canvas || !t?.list?.length || !groupShown(t)) return null;
  const rect = canvas.getBoundingClientRect();
  const reach = t.spec.dot.outline / 2 + 5;
  let best = null;
  let bestD = reach;
  for (const record of t.list) {
    // Only what the frame drew: the dot pass has already put everything over
    // the horizon away.
    const p = record.drawn;
    if (!p) continue;
    _world.copy(p).applyMatrix4(t.group.matrixWorld).project(viewer.camera);
    if (_world.z > 1) continue;
    const x = (_world.x * 0.5 + 0.5) * rect.width + rect.left;
    const y = (-_world.y * 0.5 + 0.5) * rect.height + rect.top;
    const d = Math.hypot(x - clientX, y - clientY);
    if (d < bestD) { bestD = d; best = record; }
  }
  return best;
}

/** Where a record's dot is drawn this frame, in the group's frame, or null. */
function drawnAt(t, record) {
  return record && t.list[record.index] === record ? record.drawn || null : null;
}

function openRecord(t, record) {
  const viewer = window.GeoIDViewer;
  if (!record || !viewer) return false;
  record.feature.properties = featureProperties(t, record);
  const item = window.GeoIDPointLabels?.featureToItem?.(record.feature, t.legendInfo);
  if (!item || !viewer.openSceneFeature?.(item)) return false;
  window.GeoIDCardOwner?.own?.("viewer", t.spec.layerName, () => window.GeoIDViewer?.closeCards?.());
  select(t, record);
  flyTo(t, record);
  return true;
}

/** The card is redrawn with the newest report while it is open. */
function refreshSelectedCard(t) {
  const record = t.selected;
  if (!record || !cardOpen()) return;
  const fresh = t.held.get(record.id);
  if (!fresh) return;
  if (fresh !== record) {
    t.selected = fresh;
    if (t.follow?.record === record) t.follow.record = fresh;
  }
  fresh.feature.properties = featureProperties(t, fresh);
  const item = window.GeoIDPointLabels?.featureToItem?.(fresh.feature, t.legendInfo);
  if (item) window.GeoIDViewer?.openSceneFeature?.(item);
}

function cardOpen() {
  const kicker = document.querySelector("#scene-popup-kicker, [class*=\"scene-popup-kicker\"]");
  return Boolean(kicker && kicker.offsetParent !== null);
}

function select(t, record) {
  t.selected = record;
  if (!t.pulse) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(3), 3));
    t.pulse = new THREE.Points(g, new THREE.PointsMaterial({
      size: 22, sizeAttenuation: false, map: dotTexture("ring"), alphaTest: 0.05,
      transparent: true, depthWrite: false, depthTest: false, color: 0xffbf6f, opacity: 0.9,
    }));
    t.pulse.frustumCulled = false;
    t.pulse.renderOrder = 3;
    t.dotsGroup.add(t.pulse);
  }
  t.pulse.visible = true;
}

function deselect(t) {
  t.selected = null;
  if (t.pulse) t.pulse.visible = false;
  if (t.follow) endFollow(t);
}

/* ── fly to and follow ───────────────────────────────────────────────────── */

function flyTo(t, record) {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  if (!camera || typeof viewer.flyCameraTo !== "function") return false;
  // A craft asked for before its first tick has not been placed yet.
  if (!record.pos) {
    const at = deadReckon(record, Date.now());
    record.pos = new THREE.Vector3();
    record.groundR = placeCraft(record, at.lat, at.lon, record.pos) || 0;
    if (!record.groundR) { record.pos = null; return false; }
  }
  loadModel(t.spec);
  t.group.updateWorldMatrix(true, false);
  const world = record.pos.clone().applyMatrix4(t.group.matrixWorld);
  const camDistKm = camera.position.distanceTo(world) / KM_TO_UNITS;
  const angle = camera.position.clone().normalize().angleTo(world.clone().normalize());
  const tourHop = angle > THREE.MathUtils.degToRad(25) || camDistKm > 4000;
  const durationMs = tourHop ? 2800 : 1400;
  const land = landUnits(t.spec, record);
  const end = world.clone().multiplyScalar((world.length() + land) / world.length());
  endFollow(t);
  viewer.clearZoomTarget?.();
  t.follow = { record, phase: "flying", dist: land, flyStarted: performance.now(), flyMs: durationMs };
  window.addEventListener("wheel", t.onWheel, { capture: true, passive: false });
  const ok = viewer.flyCameraTo(end, {
    tourHop,
    durationMs,
    onComplete: () => {
      const follow = t.follow;
      if (!follow || follow.record.id !== record.id) return;
      follow.phase = "follow";
      follow.landedAt = performance.now();
      follow.blendFrom = camera.position.clone();
      follow.yaw = 0;
      follow.pitch = 0.6;
      const controls = viewer.controls;
      if (controls) {
        follow.controlsWere = controls.enabled;
        follow.heldControls = true;
        controls.enabled = false;
      }
      say(t.spec, `Following ${follow.record.name} at true size (${Math.round(follow.record.lengthM)} m long) — `
        + "drag to look round it, scroll to zoom, Escape or close its card to let go.");
    },
  });
  if (!ok) { endFollow(t); return false; }
  return true;
}

function endFollow(t) {
  if (!t?.follow) return;
  const follow = t.follow;
  t.follow = null;
  t.orbitDrag = null;
  window.removeEventListener("wheel", t.onWheel, true);
  const viewer = window.GeoIDViewer;
  const controls = viewer?.controls;
  if (follow.heldControls && controls) {
    controls.enabled = follow.controlsWere !== false;
    controls.target.set(0, 0, 0);
    viewer.camera?.up?.set?.(0, 1, 0);
    controls.update?.();
  }
}

function followStep(t, camera) {
  const follow = t.follow;
  const record = t.held.get(follow.record.id) || follow.record;
  follow.record = record;
  if (t.selected?.id !== record.id || !groupShown(t) || !record.pos) { endFollow(t); return; }
  if (follow.phase === "flying") {
    if (performance.now() - follow.flyStarted > follow.flyMs + 1500) endFollow(t);
    return;
  }
  const world = record.pos.clone().applyMatrix4(t.group.matrixWorld);
  const frame = followFrame(world, follow.yaw || 0, follow.pitch || 0);
  const desired = world.clone().addScaledVector(frame.dir, follow.dist);
  const blend = Math.min(1, (performance.now() - follow.landedAt) / 700);
  if (blend < 1 && follow.blendFrom) camera.position.lerpVectors(follow.blendFrom, desired, 1 - ((1 - blend) ** 3));
  else camera.position.copy(desired);
  camera.up.copy(frame.up);
  camera.lookAt(world);
  camera.updateMatrixWorld();
}

/* ── the frame: models, lifted dots, the pulse and the near plane ────────── */

const _s = {
  fwd: new THREE.Vector3(), left: new THREE.Vector3(), zen: new THREE.Vector3(),
  matrix: new THREE.Matrix4(), colour: new THREE.Color(), pos: new THREE.Vector3(),
  screenUp: new THREE.Vector3(), rot: new THREE.Matrix3(),
};

function modelStep(t, camera, camLocal) {
  if (!groupShown(t) || modelData[t.spec.key]?.failed) {
    if (t.models) t.models.meshes.forEach((m) => { m.count = 0; });
    return;
  }
  const now = Date.now();
  const candidates = [];
  const followedId = t.follow?.record?.id;
  for (const record of t.list || []) {
    if (!record.pos) continue;
    const d2 = record.pos.distanceToSquared(camLocal);
    const far = modelFarUnits(record);
    if (d2 < far * far || record.id === followedId) candidates.push({ record, d2: record.id === followedId ? -1 : d2 });
  }
  if (!candidates.length) {
    if (t.models) t.models.meshes.forEach((m) => { m.count = 0; });
    return;
  }
  if (!modelData[t.spec.key]) { loadModel(t.spec); return; }
  ensureModelMeshes(t);
  if (!t.models) return;
  candidates.sort((a, b) => a.d2 - b.d2);
  if (candidates.length > MODEL_MAX) candidates.length = MODEL_MAX;

  _s.rot.setFromMatrix4(_inverse);
  const screenUp = _s.screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion).applyMatrix3(_s.rot).normalize();
  t.models.group.position.copy(camLocal);
  t.models.group.updateMatrixWorld(true);
  let count = 0;
  let nearestClear = Infinity;
  for (const { record } of candidates) {
    // Placed again THIS frame, carried along its track to now: the dots
    // move once a second, a model drawn that coarsely would jump.
    const at = deadReckon(record, now);
    const groundR = placeCraft(record, at.lat, at.lon, _s.pos);
    if (!groundR) continue;
    const pos = _s.pos;
    // An aircraft climbing or descending is pitched by its own flight path.
    const vz = record.props?.vertical_rate_m_s;
    const pitch = record.kind === "Aircraft" && Number.isFinite(vz) && record.speedMs > 20 ? Math.atan2(vz, record.speedMs) : 0;
    const basis = headingBasis([pos.x, pos.y, pos.z], record.headingDeg, pitch);
    const fwd = _s.fwd.fromArray(basis.fwd);
    const left = _s.left.fromArray(basis.left);
    const zen = _s.zen.fromArray(basis.up);
    const scale = (record.lengthM / t.spec.modelLength) * M_TO_UNITS;
    _s.matrix.set(
      fwd.x * scale, left.x * scale, zen.x * scale, pos.x - camLocal.x,
      fwd.y * scale, left.y * scale, zen.y * scale, pos.y - camLocal.y,
      fwd.z * scale, left.z * scale, zen.z * scale, pos.z - camLocal.z,
      0, 0, 0, 1,
    );
    _s.colour.set(colourOf(t.spec, record));
    t.models.meshes.forEach((mesh) => {
      mesh.setMatrixAt(count, _s.matrix);
      if (mesh.instanceColor) mesh.setColorAt(count, _s.colour);
    });
    count += 1;
    // The dot rides just over its model, on screen.
    record.pos.copy(pos);
    record.groundR = groundR;
    const lift = record.lengthM * 0.4 * M_TO_UNITS;
    record.liftPos = (record.liftPos || new THREE.Vector3()).copy(pos).addScaledVector(screenUp, lift);
    record.liftedFrame = frameNo;
    nearestClear = Math.min(nearestClear, pos.distanceTo(camLocal) - record.lengthM * M_TO_UNITS);
  }
  t.models.meshes.forEach((mesh) => {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  // The near plane, as for the satellites: the renderer's logarithmic depth
  // makes a near plane well inside the closest model safe, and the loop sets
  // it afresh next frame.
  if (count && Number.isFinite(nearestClear)) {
    const wanted = Math.max(1e-8, nearestClear * 0.5);
    if (wanted < camera.near) {
      camera.near = wanted;
      camera.updateProjectionMatrix();
    }
  }
}

/**
 * Every dot, every frame. The dots draw with the depth test OFF — at the
 * drawn ground they would otherwise be buried by the relief they stand on —
 * so the far side is put away here, by the tangent-plane test p·c >= R² in
 * the layer's own frame (never a hemisphere: that names a continent), the
 * events' own rule. A craft drawn as a model wears its dot just over it.
 */
const FAR_AWAY = 1e9;
let frameNo = 0;
function dotStep(t, camLocal) {
  const positions = t.geometry.attributes.position;
  const shown = groupShown(t);
  for (const record of t.list) {
    const p = record.pos;
    const visible = shown && p && record.groundR && p.dot(camLocal) >= record.groundR * record.groundR;
    const at = visible ? (record.liftedFrame === frameNo ? record.liftPos : p) : null;
    record.drawn = at;
    const i = record.index;
    if (at) positions.setXYZ(i, at.x, at.y, at.z);
    else positions.setXYZ(i, FAR_AWAY, FAR_AWAY, FAR_AWAY);
  }
  positions.needsUpdate = true;
}

function pulseStep(t) {
  if (!t.selected || !t.pulse) return;
  if (!cardOpen()) { deselect(t); return; }
  const p = drawnAt(t, t.held.get(t.selected.id) || t.selected);
  if (!p) { t.pulse.visible = false; return; }
  const a = t.pulse.geometry.attributes.position;
  a.setXYZ(0, p.x, p.y, p.z);
  a.needsUpdate = true;
  t.pulse.visible = true;
  t.pulse.material.opacity = 0.55 + 0.4 * ((Math.sin(performance.now() * 0.004) + 1) / 2);
}

/* ── names on the map, close in ─────────────────────────────────────────── */

const LABEL_MAX = 24;
const LABEL_BELOW_KM = 900;

/**
 * Plain string concatenation, not a template literal: a backtick in a CSS
 * comment ends a template literal and takes the module out with it, which
 * this tree has paid for six times.
 */
const STYLE = [
  "#traffic-labels { position: fixed; inset: 0; pointer-events: none; z-index: 5; }",
  ".traffic-label { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer;",
  "  font: 600 10.5px/1.3 'Exo 2', system-ui, sans-serif; letter-spacing: 0.04em; white-space: nowrap;",
  "  max-width: 160px; overflow: hidden; text-overflow: ellipsis; padding: 1px 6px 1px 5px; border-radius: 3px;",
  "  background: var(--skin-panel, rgba(10, 12, 20, 0.78)); color: var(--skin-ink, #f5f7fc);",
  "  border: 1px solid rgba(var(--skin-data-rgb, 82, 228, 232), 0.28); border-left: 3px solid var(--traffic-accent, #ffffff); }",
  ".traffic-label[hidden] { display: none; }",
  ".traffic-category { display: flex; align-items: center; gap: 0.4rem; font-size: 0.74rem; margin: 0.12rem 0; cursor: pointer; }",
  ".traffic-swatch { width: 0.7rem; height: 0.7rem; border-radius: 2px; flex: 0 0 auto; }",
  ".traffic-category-name { flex: 1 1 auto; }",
  ".traffic-category-count { opacity: 0.65; font-variant-numeric: tabular-nums; }",
].join("\n");

function installStyle() {
  if (document.getElementById("traffic-style")) return;
  const tag = document.createElement("style");
  tag.id = "traffic-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

function labelHost() {
  let host = document.getElementById("traffic-labels");
  if (host) return host;
  host = document.createElement("div");
  host.id = "traffic-labels";
  document.body.appendChild(host);
  return host;
}

function labelStep(t, camera) {
  const host = labelHost();
  const pool = t.labelNodes || (t.labelNodes = []);
  const viewer = window.GeoIDViewer;
  const canvas = viewer?.renderer?.domElement;
  const wanted = document.getElementById(t.spec.ids.labels)?.checked !== false;
  const altKm = (viewer?.getZoomAltitudeMetres?.()?.metres ?? Infinity) / 1000;
  const mode = document.body.dataset.viewMode;
  let shown = 0;
  if (canvas && wanted && groupShown(t) && altKm < LABEL_BELOW_KM && (!mode || mode === "gis")
    && (!document.body.classList.contains("fs-flying") || document.body.classList.contains("fs-open-chrome"))) {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const candidates = [];
    for (const record of t.list || []) {
      const p = record.drawn;
      if (!p) continue;
      _world.copy(p).applyMatrix4(t.group.matrixWorld).project(camera);
      if (_world.z > 1 || Math.abs(_world.x) > 1 || Math.abs(_world.y) > 1) continue;
      const x = (_world.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (-_world.y * 0.5 + 0.5) * rect.height + rect.top;
      candidates.push({ record, x, y, d: Math.hypot(x - cx, y - cy) });
    }
    candidates.sort((a, b) => a.d - b.d);
    const placed = [];
    for (const c of candidates) {
      if (shown >= LABEL_MAX) break;
      const w = Math.min(160, 14 + c.record.name.length * 6.6);
      const box = { x: c.x + 8, y: c.y - 9, w, h: 17 };
      if (placed.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
      placed.push(box);
      let node = pool[shown];
      if (!node) {
        node = document.createElement("button");
        node.type = "button";
        node.className = "traffic-label";
        node.addEventListener("click", (event) => {
          event.stopPropagation();
          const tracker = trackers[node.dataset.tracker];
          const record = tracker?.held.get(node.dataset.id);
          if (record) openRecord(tracker, record);
        });
        host.appendChild(node);
        pool[shown] = node;
      }
      if (node.dataset.id !== c.record.id) {
        node.textContent = c.record.name;
        node.dataset.id = c.record.id;
        node.dataset.tracker = t.spec.key;
        node.title = `${c.record.name} — ${c.record.category}`;
      }
      node.style.setProperty("--traffic-accent", colourOf(t.spec, c.record));
      node.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      node.hidden = false;
      shown += 1;
    }
  }
  for (let k = shown; k < pool.length; k += 1) pool[k].hidden = true;
}

/* ── the per-frame hook ──────────────────────────────────────────────────── */

let frameHookScene = null;
function installFrameHook() {
  const scene = window.GeoIDViewer?.scene;
  if (!scene || frameHookScene === scene) return;
  frameHookScene = scene;
  const previous = typeof scene.onBeforeRender === "function" ? scene.onBeforeRender.bind(scene) : null;
  scene.onBeforeRender = function trafficFrame(...args) {
    if (previous) previous(...args);
    const camera = args[2];
    if (!camera || camera !== window.GeoIDViewer?.camera) return;
    frameNo += 1;
    for (const t of Object.values(trackers)) {
      if (!t) continue;
      try {
        if (t.follow) followStep(t, camera);
        const camLocal = t.camLocal || (t.camLocal = new THREE.Vector3());
        _inverse.copy(t.group.matrixWorld).invert();
        camLocal.copy(camera.position).applyMatrix4(_inverse);
        modelStep(t, camera, camLocal);
        dotStep(t, camLocal);
        pulseStep(t);
        labelStep(t, camera);
      } catch (error) { /* one bad frame must not stop the render */ }
    }
  };
}

/* ── input ──────────────────────────────────────────────────────────────── */

let downAt = null;
function onDown(event) { downAt = { x: event.clientX, y: event.clientY }; }

function onClick(event) {
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (!canvas || event.target !== canvas) return;
  if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4) return;
  // Aircraft first: they fly over the ships, and a dot drawn on top takes the click.
  for (const key of ["air", "sea"]) {
    const t = trackers[key];
    const record = recordAt(t, event.clientX, event.clientY);
    if (!record) continue;
    if (!openRecord(t, record)) return;
    window.GeoIDUiSound?.playClick?.();
    window.GeoIDFeaturePopup?.suppress?.(500);
    event.stopPropagation();
    return;
  }
}

function followOf() { return Object.values(trackers).find((t) => t?.follow?.phase === "follow"); }

function onPointerDown(event) {
  const t = followOf();
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (!t || event.target !== canvas || event.button !== 0) return;
  t.orbitDrag = { x: event.clientX, y: event.clientY, id: event.pointerId };
}

function onPointerMove(event) {
  const t = followOf();
  if (!t?.orbitDrag) return;
  if (event.pointerId !== t.orbitDrag.id || !(event.buttons & 1)) { t.orbitDrag = null; return; }
  const height = window.GeoIDViewer?.renderer?.domElement?.clientHeight || 800;
  const k = (2 * Math.PI) / height;
  t.follow.yaw = (t.follow.yaw || 0) - (event.clientX - t.orbitDrag.x) * k;
  t.follow.pitch = THREE.MathUtils.clamp((t.follow.pitch || 0) - (event.clientY - t.orbitDrag.y) * k, 0, FOLLOW_PITCH_MAX);
  t.orbitDrag.x = event.clientX;
  t.orbitDrag.y = event.clientY;
  t.follow.blendFrom = null;
}

function onPointerUp(event) {
  const t = followOf();
  if (t?.orbitDrag && event.pointerId === t.orbitDrag.id) t.orbitDrag = null;
}

function onKey(event) {
  if (event.key !== "Escape") return;
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  for (const t of Object.values(trackers)) {
    if (!t?.follow) continue;
    const name = t.follow.record?.name;
    endFollow(t);
    if (name) say(t.spec, `Let go of ${name}.`);
  }
}

function makeWheel(t) {
  return (event) => {
    const follow = t.follow;
    const canvas = window.GeoIDViewer?.renderer?.domElement;
    if (!follow || follow.phase !== "follow" || event.target !== canvas) return;
    event.preventDefault();
    event.stopPropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const next = follow.dist * Math.exp(event.deltaY * unit * 0.0015);
    if (next > FOLLOW_MAX_UNITS) { endFollow(t); return; }
    follow.dist = Math.max(followMinUnits(follow.record), next);
  };
}

let listening = false;
function listen(on) {
  if (on === listening) return;
  listening = on;
  const method = on ? "addEventListener" : "removeEventListener";
  window[method]("pointerdown", onDown, true);
  window[method]("click", onClick, true);
  window[method]("pointerdown", onPointerDown, true);
  window[method]("pointermove", onPointerMove, true);
  window[method]("pointerup", onPointerUp, true);
  window[method]("keydown", onKey, true);
}

/* ── start and stop ─────────────────────────────────────────────────────── */

function start(spec) {
  const id = ++runIds[spec.key];
  if (trackers[spec.key]) return true;
  const viewer = window.GeoIDViewer;
  if (!viewer?.latLonToVector3) { say(spec, "The globe is not ready yet."); return false; }
  const geometry = new THREE.BufferGeometry();
  const fill = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: spec.dot.fill, sizeAttenuation: false, map: dotTexture(spec.dot.shape), alphaTest: 0.35,
    transparent: true, depthWrite: false, depthTest: false, vertexColors: true,
  }));
  const outline = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: spec.dot.outline, sizeAttenuation: false, map: dotTexture(spec.dot.shape), alphaTest: 0.35,
    transparent: true, depthWrite: false, depthTest: false, color: 0x0b0f17,
  }));
  fill.renderOrder = 1;
  fill.frustumCulled = false;
  outline.frustumCulled = false;
  const group = new THREE.Group();
  group.name = `traffic-${spec.key}`;
  // A nested band-198 group, as the satellites' dots: the hierarchy stamps
  // the layer into the data band, where a depth-test-off drape would paint
  // over it.
  const dotsGroup = new THREE.Group();
  dotsGroup.name = `traffic-${spec.key}-dots`;
  dotsGroup.renderOrder = 198;
  dotsGroup.userData.keepRenderOrder = true;
  dotsGroup.add(outline, fill);
  group.add(dotsGroup);
  const legendInfo = {
    palette: spec.categories.map(([, c]) => c.replace("#", "")),
    labels: spec.categories.map(([n]) => n),
    values: spec.categories.map(([n]) => n),
    counts: spec.categories.map(() => 0),
    categorical: true,
    classed: true,
    field: "category",
  };
  const layer = window.GeoIDImportManager?.addDerivedLayer?.(spec.layerName, {
    object3D: group,
    georeferenced: true,
    // Its own true-3D picking: the ground picker would answer an aircraft's
    // click with the field ten kilometres under it.
    groundPick: false,
    legendInfo,
    info: {
      source: spec.key === "air" ? "Live ADS-B (adsb.lol / airplanes.live / OpenSky Network)" : "Live AIS (Digitraffic / aisstream.io)",
      citation: spec.citation,
      crs: "EPSG:4326; aircraft drawn at their reported altitude above the drawn ground",
      summary: spec.key === "air"
        ? "Aircraft reporting by ADS-B around the view, carried along their tracks between reports and drawn at true size close in."
        : "Ships reporting by AIS, carried along their courses between reports and drawn at true size close in.",
    },
  }, "live");
  if (!layer) { say(spec, "The layer could not be registered."); return false; }
  if (id !== runIds[spec.key]) { window.GeoIDImportManager?.removeLayer?.(layer.id); return false; }
  layer.featureNoun = spec.noun;
  layer.features = [];
  const t = {
    spec, layer, group, dotsGroup, geometry, fill, legendInfo,
    held: new Map(), list: [], capacity: 0,
    lastFetch: 0, lastView: null, fetching: false, goodSource: 0,
  };
  t.onWheel = makeWheel(t);
  layer.repaint = (colourFn) => {
    t.held.forEach((record) => { record.colour = colourFn(record.feature) || null; });
    tick(t);
  };
  layer.cataloguePalette = { field: "category", colours: Object.fromEntries(spec.categories) };
  ensureCapacity(t, 256);
  trackers[spec.key] = t;
  t.timer = window.setInterval(() => tick(t), 1000);
  listen(true);
  installFrameHook();
  buildCategoryList(spec);
  window.GeoIDLayerHierarchy?.render?.();
  say(spec, spec.key === "air" ? "Asking the open ADS-B feeds for the aircraft around the view…" : "Asking for ships around the view…");
  liveClaims += 1;
  const v = window.GeoIDViewer;
  if (v?.getTimeRate?.() === "lapse") { v.setTimeRate?.("real"); autoRealTime = true; }
  refresh(t);
  return true;
}

function stop(spec) {
  runIds[spec.key] += 1;
  const t = trackers[spec.key];
  if (!t) return;
  trackers[spec.key] = null;
  window.clearInterval(t.timer);
  endFollow(t);
  closeAisStream(t);
  t.models?.meshes.forEach((mesh) => { mesh.material.dispose?.(); mesh.dispose?.(); });
  (t.labelNodes || []).forEach((node) => node.remove());
  const layer = layerOf(spec);
  if (layer) window.GeoIDImportManager?.removeLayer?.(layer.id);
  if (!Object.values(trackers).some(Boolean)) listen(false);
  liveClaims = Math.max(0, liveClaims - 1);
  if (!liveClaims && autoRealTime && window.GeoIDViewer?.getTimeRate?.() === "real") {
    window.GeoIDViewer.setTimeRate?.("lapse");
    autoRealTime = false;
  }
  say(spec, `${spec.key === "air" ? "Aircraft" : "Ships"} off.`);
}

/* ── the panel ──────────────────────────────────────────────────────────── */

function wireSpec(spec) {
  const box = document.getElementById(spec.ids.toggle);
  if (!box || box.dataset.wired) return;
  box.dataset.wired = "1";
  buildCategoryList(spec);
  box.addEventListener("change", () => {
    if (box.checked) {
      if (!start(spec)) box.checked = false;
    } else {
      stop(spec);
    }
  });
  document.getElementById(spec.ids.symbology)?.addEventListener("click", async () => {
    const layer = layerOf(spec);
    if (!layer) { say(spec, "Turn the tracker on first — symbology colours the live layer."); return; }
    const dialog = await import("./symbology-dialog.js?v=20261024-16ef562");
    dialog.openSymbologyDialog(layer);
  });
  window.GeoIDImportManager?.onChange?.(() => {
    if (trackers[spec.key] && !layerOf(spec)) { stop(spec); box.checked = false; }
  });
}

function wireAisKey() {
  const field = document.getElementById("traffic-ais-key");
  const save = document.getElementById("traffic-ais-save");
  const forget = document.getElementById("traffic-ais-forget");
  if (!field || field.dataset.wired) return;
  field.dataset.wired = "1";
  const sync = () => {
    const held = Boolean(readAisKey());
    field.placeholder = held ? "a key is stored in this browser" : "optional — your own free key";
    if (forget) forget.disabled = !held;
  };
  sync();
  save?.addEventListener("click", () => {
    const value = field.value.trim();
    if (!value) { say(SPECS.sea, "Paste your aisstream.io key first."); return; }
    try { window.localStorage.setItem(AIS_KEY, value); } catch (error) { say(SPECS.sea, "This browser will not store it."); return; }
    field.value = "";
    sync();
    const t = trackers.sea;
    if (t) { t.lastFetch = 0; refresh(t); } else say(SPECS.sea, "Key stored in this browser only. Tick the tracker to stream ships anywhere.");
  });
  forget?.addEventListener("click", () => {
    try { window.localStorage.removeItem(AIS_KEY); } catch (error) { /* nothing stored */ }
    sync();
    const t = trackers.sea;
    if (t) { closeAisStream(t); t.lastFetch = 0; refresh(t); } else say(SPECS.sea, "Key forgotten.");
  });
}

function init() {
  installStyle();
  if (isParked("traffic-air")) {
    // Hidden from the site until the feeds have a proxy (parked.js).
    const card = document.getElementById("traffic-air-card");
    if (card) card.hidden = true;
  } else {
    wireSpec(SPECS.air);
  }
  wireSpec(SPECS.sea);
  wireAisKey();
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

if (typeof window !== "undefined") {
  window.GeoIDTraffic = {
    /** For checks: what each tracker holds and draws. */
    state() {
      const of = (t) => (t ? {
        held: t.held.size, drawn: t.list.length, source: t.sourceName || null,
        models: t.models?.meshes[0]?.count ?? 0,
        following: t.follow ? { name: t.follow.record.name, phase: t.follow.phase } : null,
        labels: (t.labelNodes || []).filter((n) => !n.hidden).length,
      } : null);
      return { air: of(trackers.air), sea: of(trackers.sea) };
    },
    /** For checks: where a craft's dot is on screen, or null when it is not drawn. */
    screenOf(id) {
      for (const t of Object.values(trackers)) {
        const record = t?.held.get(id);
        const canvas = window.GeoIDViewer?.renderer?.domElement;
        if (!record?.drawn || !canvas) continue;
        const rect = canvas.getBoundingClientRect();
        const v = record.drawn.clone().applyMatrix4(t.group.matrixWorld).project(window.GeoIDViewer.camera);
        return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top };
      }
      return null;
    },
    /**
     * For the flight-risk route: the aircraft held now, plain, and which one
     * is open in the card (or followed), if any.
     */
    aircraft() {
      const t = trackers.air;
      const plain = (r) => ({
        id: r.id, name: r.name, lat: r.lat, lon: r.lon, altM: r.altM, onGround: r.onGround,
        headingDeg: r.headingDeg, speedMs: r.speedMs, timeMs: r.timeMs, callsign: r.props?.callsign || null,
      });
      if (!t) return { list: [], selected: null };
      const sel = t.follow?.record || t.selected || null;
      return { list: [...t.held.values()].map(plain), selected: sel ? plain(t.held.get(sel.id) || sel) : null };
    },
    /** Open, fly to and follow a craft by id ("air:4ca87d", "ship:230145000") or name. */
    focus(key) {
      const wanted = String(key ?? "").trim().toUpperCase();
      for (const t of Object.values(trackers)) {
        if (!t) continue;
        const record = [...t.held.values()].find((r) => r.id.toUpperCase() === wanted || r.name.toUpperCase() === wanted);
        if (record) return openRecord(t, record);
      }
      return false;
    },
  };
}
