import * as THREE from "../vendor/three.module.js";
import { authService } from "./membership.js?v=20261024-2dc6cd0";
import { currentBodyId, currentBody, getBody, metresPerUnit } from "./bodies.js?v=20261024-2dc6cd0";
import { latLonToVector3 } from "./geo-utils.js?v=20261024-2dc6cd0";
import { visibleBounds, viewFocus, altitudeUnits, onViewSettled, viewChangedEnough }
  from "./view-extent.js?v=20261024-2dc6cd0";
import { DATASETS, layerNameOf, addDataset } from "./global-data.js?v=20261024-2dc6cd0";
import { paintByField } from "./symbology-dialog.js?v=20261024-2dc6cd0";
import * as projectStore from "./research/project-store.js?v=20261024-2dc6cd0";
import {
  socialBase, viewRequest, mapUrl, mapToFeatures, featuresKey, readDeepLink, worldUrl,
  cameraFromScene, layersToEnable, annotationsToFeatures, bannerText, buildSharePayload,
  buildWorkspacePayload, headingPitch, describePlaces, socialHref, validId, toEastLon,
  SOCIAL_APP, SHARE_KEY, WORKSPACE_KEY, BASE_OVERRIDE_KEY,
  COMMUNITY_LAYER_NAME, COMMUNITY_SOURCE, ANNOTATION_LAYER_NAME,
  buildWorkspaceManifest, readSocialLink, makeSocialLink, remoteVersion, linkState, linkTag,
  publishProjectBody, pushVersionBody, sharedRows, PUBLISH_VISIBILITY, SHARE_KINDS, SHARE_KIND_LABELS,
  shareDestinations, destinationKey, parseDestination, repoPrefill, buildShareHandoff,
  buildModelMeta, modelSettingsFromConfig, boxRing, describeModel, postWorld,
  interestRequest, interestUrl, interestToFeatures, communityLayerName, COMMUNITY_MODES,
  INTEREST_LAYER_NAME, INTEREST_SOURCE, TREND_COLOURS,
} from "./social-core.js?v=20261024-2dc6cd0";

/**
 * GeoID Network, inside the viewer.
 *
 * Five things, and the seam to the network is one small client:
 *
 *   * the COMMUNITY layer -- public posts and projects near the view, as an
 *     ordinary layer in the Workspace, off until somebody ticks it;
 *   * DEEP LINKS -- `?post=` opens a shared scene (or a shared model, into the
 *     Model Builder) where it was shared from, `?project=` a published
 *     workspace;
 *   * SHARE -- this view, a model or a repository, to the public feed or into
 *     one of the reader's teams, communities or projects (contract v1.1),
 *     handed to the Social app to compose;
 *   * SAVED PROJECTS, LINKED -- each local project records its Social
 *     counterpart in its own metadata and publishes, pushes and pulls
 *     versions directly; "Shared with me" saves somebody else's locally;
 *   * an Atlas tool that lists what the community has posted near the view.
 *
 * THE LAYER GOES THROUGH THE IMPORTER, not a scene graph of its own. Every
 * hard thing about drawing a point on one of ten globes -- the 23.44° tilt
 * group (`earthSceneGroup`), the spin synced on the renderer's own frame, the
 * relief the markers ride, the Workspace row, opacity and draw order -- is
 * answered once in `import-manager.js`, and a second answer here would be a
 * second thing to drift. `nomenclature-outlines.js` is the pattern: a
 * FeatureCollection handed over as a file, in the viewer's own longitude.
 *
 * COMMUNITY CONTENT IS LABELLED AS SUCH everywhere it appears: the layer's
 * source, its card and the Atlas answer all say it is unverified unless the
 * post itself says otherwise. A dot from a member of the public must never
 * read as one from the USGS.
 */

const byId = (id) => document.getElementById(id);
const now = () => Math.floor(Date.now() / 1000);
const isWest = () => /^west/.test(currentBody()?.lonConvention || "");
const manager = () => window.GeoIDImportManager || null;
const layers = () => manager()?.getLayers?.() || [];
const namedLayer = (name) => layers().find((l) => l.name === name) || null;

/* ── The client ────────────────────────────────────────────────────────── */

function base() {
  let stored = "";
  try { stored = window.localStorage?.getItem(BASE_OVERRIDE_KEY) || ""; } catch (_e) { /* private mode */ }
  return socialBase({
    meta: document.querySelector('meta[name="geoid-social"]')?.content || "",
    stored,
    hostname: window.location.hostname,
  });
}

let token = "";
let tokenExp = 0;
let tokenInFlight = null;
let tokenRefusedUntil = 0;

/**
 * A bearer for GeoID Network, minted by the auth service against the session
 * cookie (`POST /auth/social-token`). Held in memory only: it says who
 * somebody is, so it never goes into storage or a URL. A refusal is
 * remembered for a minute so a signed-out reader panning the map does not
 * ask the auth service again on every settle.
 */
async function socialToken() {
  const auth = authService();
  if (!auth) return "";
  if (token && tokenExp - 60 > now()) return token;
  if (tokenRefusedUntil > now()) return "";
  if (tokenInFlight) return tokenInFlight;
  tokenInFlight = (async () => {
    try {
      const res = await fetch(`${auth}/auth/social-token`, { method: "POST", credentials: "include" });
      if (!res.ok) { token = ""; tokenExp = 0; tokenRefusedUntil = now() + 60; return ""; }
      const body = await res.json();
      token = String(body.token || "");
      tokenExp = Number(body.expires) || 0;
      return token;
    } catch (_e) {
      tokenRefusedUntil = now() + 60;
      return "";
    } finally {
      tokenInFlight = null;
    }
  })();
  return tokenInFlight;
}

// Signing out must drop the pass with the session -- and everything it read.
document.addEventListener("geoid:membership", () => {
  token = ""; tokenExp = 0; tokenRefusedUntil = 0;
  answers.clear();
});

async function fetchJson(path, { auth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (auth) {
    const t = await socialToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const url = /^https?:/i.test(path) ? path : `${base()}${path}`;
  const res = await fetch(url, { headers });
  let body = null;
  try { body = await res.json(); } catch (_e) { body = null; }
  if (!res.ok) {
    const error = new Error(body?.error || `GeoID Network answered ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return body;
}

/**
 * A write. Refused here, before the request, when there is no pass: a 401
 * from the Worker says the same thing later and less usefully.
 */
async function sendJson(path, body, { method = "POST" } = {}) {
  const t = await socialToken();
  if (!t) {
    const error = new Error("Sign in first — GeoID Network uses your GeoID account.");
    error.status = 401;
    throw error;
  }
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(body ?? {}),
  });
  let answer = null;
  try { answer = await res.json(); } catch (_e) { answer = null; }
  if (!res.ok) {
    const error = new Error(answer?.error || `GeoID Network answered ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return answer;
}

/**
 * Answers kept for a minute.
 *
 * The Project dialog re-renders on every store change, and a re-render that
 * asked Social for /v1/me, both project lists and every link's state each time
 * would be four requests per keystroke-adjacent event. A write forgets what it
 * could have changed; signing in or out forgets everything.
 */
const answers = new Map();
async function cached(key, fn, ttl = 60) {
  const hit = answers.get(key);
  if (hit && now() - hit.at < ttl) return hit.value;
  const value = await fn();
  answers.set(key, { at: now(), value });
  return value;
}
const forget = (prefix) => { [...answers.keys()].forEach((k) => { if (k.startsWith(prefix)) answers.delete(k); }); };

const signedIn = async () => Boolean(await socialToken());
const meAnswer = () => cached("me", () => fetchJson("/v1/me", { auth: true }));
async function projectLists() {
  const list = (q) => cached(`projects:${q}`, () => fetchJson(`/v1/projects?${q}=1`, { auth: true }))
    .then((a) => (Array.isArray(a?.items) ? a.items : []))
    .catch(() => []);
  const [mine, shared] = await Promise.all([list("mine"), list("shared")]);
  return { mine, shared };
}
const remoteProject = (id) => cached(`remote:${id}`, () => fetchJson(`/v1/projects/${encodeURIComponent(id)}`, { auth: true }));

/* ── Where the camera is ───────────────────────────────────────────────── */

function viewerReady() {
  const v = window.GeoIDViewer;
  return v?.camera && v?.scene ? v : null;
}

/** Metres above the surface: the viewer's own answer where it gives one. */
function altitudeMetres(viewer) {
  const zoom = viewer.getZoomAltitudeMetres?.();
  if (Number.isFinite(zoom?.metres)) return zoom.metres;
  const body = currentBody() || getBody("earth");
  return altitudeUnits(viewer) * metresPerUnit(body, viewer.GLOBE_RADIUS || 3.2);
}

/** The planet's north axis in world space, as the globe's own group carries it. */
function poleWorld(viewer) {
  const group = viewer.earthSceneGroup || viewer.scene;
  group.updateMatrixWorld?.(true);
  return new THREE.Vector3(0, 1, 0).transformDirection(group.matrixWorld);
}

function currentCamera() {
  const viewer = viewerReady();
  if (!viewer) return null;
  const focus = viewFocus(viewer, THREE);
  if (!focus) return null;
  const forward = new THREE.Vector3();
  viewer.camera.getWorldDirection(forward);
  const p = viewer.camera.position;
  const pole = poleWorld(viewer);
  const hp = headingPitch([p.x, p.y, p.z], [forward.x, forward.y, forward.z], [pole.x, pole.y, pole.z]);
  return {
    focus,
    alt: altitudeMetres(viewer),
    heading: isWest() ? (360 - hp.heading) % 360 : hp.heading,
    pitch: hp.pitch,
  };
}

/**
 * Point the camera at a coordinate (the viewer's own longitude) and bring it
 * to an altitude.
 *
 * The direction is built the way the imported layers are placed --
 * `latLonToVector3` in the baseline frame, turned by the viewer's spin, then
 * through the tilt group -- so the camera lands over the same ground the
 * markers stand on. The distance is left to the viewer's own zoom
 * (`setZoomAltitudeMetres`), which eases exactly as the wheel does; moving
 * the camera's distance directly fights that easing. Heading and pitch are
 * recorded but not applied: every orbit here keeps the target at the planet's
 * centre, so the view arrives looking straight down, which is said in the
 * banner's own terms by the scene opening rather than by a sentence.
 */
function flyTo(lat, lon, altMetres) {
  const viewer = viewerReady();
  if (!viewer) return false;
  const dir = latLonToVector3(lat, lon, 1);
  const spin = viewer.getSpinDeltaRadians?.();
  if (Number.isFinite(spin)) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), spin);
  const group = viewer.earthSceneGroup || null;
  if (group) {
    group.updateMatrixWorld(true);
    dir.applyMatrix4(new THREE.Matrix4().extractRotation(group.matrixWorld));
  }
  dir.normalize();
  const distance = viewer.camera.position.length();
  const end = dir.clone().multiplyScalar(distance);
  const settle = () => {
    if (Number.isFinite(altMetres) && altMetres > 0) viewer.setZoomAltitudeMetres?.(altMetres);
  };
  if (typeof viewer.flyCameraTo === "function" && viewer.flyCameraTo(end, { onComplete: settle })) return true;
  viewer.camera.position.copy(end);
  viewer.controls?.target?.set(0, 0, 0);
  viewer.controls?.update?.();
  settle();
  return true;
}

/* ── The Community layer ───────────────────────────────────────────────── */

/**
 * Two modes, one tick. POSTS is the content (points and clusters from
 * /v1/map); STUDY INTEREST is the people (discs from /v1/map/interest, sized
 * by how many distinct researchers work in each cell, amber where rising).
 * Each is its own named layer in the Workspace, so a reader never mistakes a
 * head count for a post, and both go through the same importer.
 */
const community = {
  on: false,
  mode: "posts",
  stop: null,
  key: "",
  lastBox: null,
  busy: false,
  seq: 0,
  say: () => {},
};

async function importCollection(fc, name) {
  const m = manager();
  if (!m?.importFileList) throw new Error("the GIS layer is still starting");
  const blob = new Blob([JSON.stringify(fc)], { type: "application/geo+json" });
  await m.importFileList([new File([blob], `${name}.geojson`, { type: "application/geo+json" })],
    { name, frame: false, hold: false });
  const layer = namedLayer(name);
  if (!layer || layer.status === "error") {
    if (layer) m.removeLayer(layer.id);
    throw new Error(layer?.message || "the importer did not take it");
  }
  return layer;
}

async function refreshCommunity({ force = false } = {}) {
  if (!community.on) return;
  const viewer = viewerReady();
  if (!viewer) return;
  const box = visibleBounds(viewer, THREE);
  if (!force && community.lastBox && box && !viewChangedEnough(community.lastBox, box)) return;
  community.lastBox = box;
  const interest = community.mode === "interest";
  const { bbox, z } = interest ? interestRequest(box, { west: isWest() }) : viewRequest(box, { west: isWest() });
  const seq = ++community.seq;
  let answer;
  try {
    answer = await fetchJson(interest
      ? interestUrl(base(), { world: currentBodyId(), bbox, z })
      : mapUrl(base(), { world: currentBodyId(), bbox, z }));
  } catch (error) {
    if (seq === community.seq) community.say(`GeoID Network did not answer (${error.message}).`);
    return;
  }
  // A slower answer for a view already left behind (or the other mode's)
  // must not overwrite a newer one.
  if (seq !== community.seq || !community.on || interest !== (community.mode === "interest")) return;
  const fc = interest ? interestToFeatures(answer, { west: isWest() }) : mapToFeatures(answer, { west: isWest() });
  const name = communityLayerName(community.mode);
  const source = interest ? INTEREST_SOURCE : COMMUNITY_SOURCE;
  const key = `${community.mode}|${featuresKey(fc)}`;
  const existing = namedLayer(name);
  if (key === community.key && existing) return;
  community.key = fc.features.length ? key : "";
  community.busy = true;
  try {
    // Carried across the rebuild, so a reader who dimmed or hid the layer
    // does not have it reset by panning.
    const keep = existing ? { visible: existing.visible, opacity: existing.opacity } : null;
    if (existing) manager().removeLayer(existing.id);
    if (!fc.features.length) {
      community.say(interest
        ? "Nobody has shared a study area or a located public post in this view yet."
        : "No public community posts in this view yet.");
      return;
    }
    const layer = await importCollection(fc, name);
    layer.metadata = {
      ...(layer.metadata || {}),
      source,
      citation: source,
      crs: "Planetocentric latitude/longitude, as posted",
      format: interest ? "live GeoID Network map of interest" : "live GeoID Network feed",
      featureCount: fc.features.length,
    };
    layer.info = { ...(layer.info || {}), source, citation: source };
    // A click opens this module's card, not the attribute table (feature-popup.js).
    layer.cardFor = communityCard;
    try {
      if (interest) paintByField(layer, "trend_label", { overrides: new Map(Object.entries(TREND_COLOURS)) });
      else paintByField(layer, "kind");
    } catch (_e) { /* the default colour is fine */ }
    // Discs are areas over the ground: see-through by default, so the
    // terrain under a busy cell is still readable.
    const opacity = Number.isFinite(keep?.opacity) ? keep.opacity : (interest ? 0.55 : null);
    if (keep?.visible === false && layer.object3D) { layer.visible = false; layer.object3D.visible = false; }
    if (Number.isFinite(opacity)) { layer.opacity = opacity; layer.applyOpacity?.(opacity); }
    if (interest) {
      const n = Number(answer?.researchers) || 0;
      community.say(`${n} researcher${n === 1 ? "" : "s"} in ${fc.features.length} place${fc.features.length === 1 ? "" : "s"} in view — sized by people, not posts; amber is rising. ${source}.`);
    } else {
      const points = fc.features.filter((f) => f.properties.social_type === "point").length;
      community.say(points === fc.features.length
        ? `${points} community item${points === 1 ? "" : "s"} in view. ${source}.`
        : `Clustered: zoom in to see single posts. ${source}.`);
    }
    window.GeoIDLayerHierarchy?.render?.();
  } catch (error) {
    community.say(`The community layer did not draw (${error.message || error}).`);
  } finally {
    community.busy = false;
  }
}

/** Both modes' layers, removed without the Workspace watcher reading it as the reader's untick. */
function removeCommunityLayers() {
  community.busy = true;
  for (const mode of COMMUNITY_MODES) {
    const layer = namedLayer(communityLayerName(mode));
    if (layer) manager().removeLayer(layer.id);
  }
  community.busy = false;
}

/** Switch between posts and study interest; redraws at once when the layer is on. */
function setCommunityMode(mode) {
  const next = COMMUNITY_MODES.includes(mode) ? mode : "posts";
  const pick = byId("social-community-mode");
  if (pick) pick.value = next;
  if (next === community.mode) return next;
  community.mode = next;
  community.seq += 1;
  community.key = "";
  if (manager()) removeCommunityLayers();
  if (community.on) {
    community.say(next === "interest" ? "Asking GeoID Network where people work in view…" : "Asking GeoID Network what is in view…");
    community.lastBox = null;
    void refreshCommunity({ force: true });
  }
  return next;
}

function setCommunity(on) {
  community.on = Boolean(on);
  const tick = byId("social-community-toggle");
  if (tick) tick.checked = community.on;
  if (community.on) {
    const viewer = viewerReady();
    if (!viewer) { community.say("The globe is still starting — try again in a moment."); community.on = false; if (tick) tick.checked = false; return false; }
    community.say("Asking GeoID Network what is in view…");
    community.lastBox = null;
    community.key = "";
    // Polled on the camera, settled not continuous: a drag across a continent
    // is one request when it stops, not one per frame.
    community.stop?.();
    community.stop = onViewSettled(viewer, () => { void refreshCommunity(); }, { settleMs: 600 });
    void refreshCommunity({ force: true });
    return true;
  }
  community.stop?.();
  community.stop = null;
  community.seq += 1;
  removeCommunityLayers();
  community.key = "";
  community.say("");
  return false;
}

/** The card a click on a community marker opens: small, and honest about its source. */
function communityCard(feature) {
  const p = feature?.properties || {};
  const card = document.createElement("div");
  card.className = "gis-social-card";
  const kicker = document.createElement("p");
  kicker.className = "gis-fp-kicker feature-kicker";
  const title = document.createElement("p");
  title.className = "gis-fp-title feature-title";
  title.textContent = p.name || "Community post";
  const meta = document.createElement("p");
  meta.className = "gis-fp-layer feature-meta";
  const note = document.createElement("p");
  note.className = "gis-fp-copy feature-copy";
  if (p.social_type === "interest") {
    // A head count, not content: say what it counts and what it does not.
    kicker.textContent = `Community · study interest · ${p.trend_label || "Steady"}`;
    title.textContent = p.place || "Where community members work";
    const n = Number(p.researchers) || 0;
    meta.textContent = [`${n} researcher${n === 1 ? "" : "s"}`, `${p.posts || 0} posts`, `${p.projects || 0} projects`,
      `${p.study_areas || 0} study areas`].join(" · ") + (p.top_tags ? ` · ${p.top_tags}` : "");
    note.textContent = "Sized by how many people have a reason to be here — a study area, a public post or project — not by how much they post. Community content.";
    const open = document.createElement("a");
    open.className = "button small";
    open.textContent = "Who works here (Social map)";
    open.href = `${SOCIAL_APP}#/map`;
    open.target = "_top";
    open.rel = "noopener";
    card.append(kicker, title, meta, note, open);
    return card;
  }
  if (p.social_type === "cluster") {
    kicker.textContent = "Community · cluster";
    meta.textContent = p.kinds || "";
    note.textContent = "Zoom in to see the posts one by one.";
    card.append(kicker, title, meta, note);
    return card;
  }
  kicker.textContent = `Community · ${p.kind_label || "Post"}`;
  meta.textContent = [p.provenance, p.author].filter(Boolean).join(" · ");
  note.textContent = "Community content — unverified unless marked.";
  const open = document.createElement("a");
  open.className = "button small";
  open.textContent = "Open in the Network";
  open.href = validId(p.social_id) ? socialHref(p.kind, p.social_id) : SOCIAL_APP;
  // The Social app is a page of the site, not of the viewer's frame.
  open.target = "_top";
  open.rel = "noopener";
  card.append(kicker, title, meta, note, open);
  return card;
}

/* ── Deep links ────────────────────────────────────────────────────────── */

function banner(text, { href = "", linkText = "" } = {}) {
  byId("social-scene-banner")?.remove();
  const bar = document.createElement("div");
  bar.id = "social-scene-banner";
  bar.setAttribute("role", "status");
  bar.style.cssText = "position:fixed;top:0.6rem;left:50%;transform:translateX(-50%);z-index:60;"
    + "display:flex;gap:0.6rem;align-items:center;max-width:calc(100% - 2rem);padding:0.45rem 0.8rem;"
    + "border-radius:0.6rem;background:var(--panel-bg, rgba(8,14,24,0.92));color:var(--text, #dce8f2);"
    + "border:1px solid var(--panel-border, rgba(120,170,210,0.35));font:500 0.8rem/1.3 'Public Sans',sans-serif;";
  const words = document.createElement("span");
  words.textContent = text;
  bar.appendChild(words);
  if (href) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_top";
    a.textContent = linkText || "Open discussion";
    a.style.color = "var(--accent, #58c6b3)";
    bar.appendChild(a);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Dismiss");
  close.style.cssText = "background:none;border:0;color:inherit;cursor:pointer;font-size:0.9rem;";
  close.addEventListener("click", () => bar.remove());
  bar.appendChild(close);
  document.body.appendChild(bar);
  return bar;
}

/**
 * Leave for the world a shared thing was made on.
 *
 * Through the TOP window when this viewer is framed by the shell -- the
 * shell is what maps `?world=` to a viewer and carries `?post=` through, and
 * a world loaded into this frame directly would arrive without its header,
 * its mode bar or its transit.
 */
function goToWorld(world, link) {
  const to = worldUrl(world, link);
  try {
    if (window.top && window.top !== window.self) { window.top.location.assign(to); return; }
  } catch (_e) { /* a cross-origin parent: go here instead */ }
  window.location.assign(to);
}

/** The scene's layers, matched against what this viewer can switch on. */
async function availableLayers() {
  const out = DATASETS.filter((d) => !d.hidden).map((d) => ({ id: d.id, name: layerNameOf(d), kind: "dataset" }));
  if (currentBodyId() === "earth") {
    try {
      const { MAP_LAYERS, layerNameOf: mapName } = await import(`./map-layers.js${new URL(import.meta.url).search}`);
      MAP_LAYERS.forEach((e) => out.push({ id: e.id, name: mapName(e), kind: "map" }));
    } catch (_e) { /* no map overlays on this page */ }
  }
  return out;
}

async function enableLayers(sceneLayers) {
  const { found, missing } = layersToEnable(sceneLayers, await availableLayers());
  for (const entry of found) {
    try {
      if (entry.kind === "map") {
        const { addMapLayer } = await import(`./map-layers.js${new URL(import.meta.url).search}`);
        await addMapLayer(entry.id);
      } else {
        await addDataset(entry.id);
      }
    } catch (_e) { missing.push(entry.name); }
  }
  return { on: found.length, missing };
}

let annotationHandle = null;

async function showAnnotations(annotations) {
  const fc = annotationsToFeatures(annotations, { west: isWest() });
  if (!fc.features.length) return 0;
  const old = namedLayer(ANNOTATION_LAYER_NAME);
  if (old) manager().removeLayer(old.id);
  const layer = await importCollection(fc, ANNOTATION_LAYER_NAME);
  layer.metadata = { ...(layer.metadata || {}), source: COMMUNITY_SOURCE, citation: COMMUNITY_SOURCE };
  /**
   * Named where point-labels.js runs (it reads `label_rank`); on a page
   * without it, straight through the viewer's own label machinery, so the
   * notes read as text on the ground rather than as anonymous dots.
   */
  if (!window.GeoIDPointLabels && typeof window.GeoIDViewer?.addSurfaceLabels === "function") {
    annotationHandle?.remove?.();
    annotationHandle = window.GeoIDViewer.addSurfaceLabels(fc.features.map((f) => ({
      name: f.properties.name, type: "Annotation",
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      category: "dataset", priority: 5,
    })));
  }
  return fc.features.length;
}

async function applyScene(scene, { bannerFor, href, linkText }) {
  const cam = cameraFromScene(scene, { west: isWest() });
  if (cam) flyTo(cam.lat, cam.lon, cam.alt);
  const { missing } = await enableLayers(scene?.layers);
  try { await showAnnotations(scene?.annotations); } catch (_e) { /* the scene still opens */ }
  const extra = missing.length
    ? ` (${missing.length} layer${missing.length === 1 ? " isn't" : "s aren't"} available here)`
    : "";
  banner(`${bannerFor}${extra} —`, { href, linkText });
}

const globeReady = () => whenReady(() => viewerReady() && manager()?.importFileList);

/**
 * A shared post, opened.
 *
 * FETCHED BEFORE THE GLOBE IS WAITED FOR: the post says which world it is on,
 * and a post from Mars opened on Earth leaves for Mars at once rather than
 * after the Earth globe has finished building for nothing.
 */
async function openPost(id) {
  let post;
  try {
    post = await fetchJson(`/v1/posts/${encodeURIComponent(id)}`, { auth: true });
  } catch (error) {
    banner(error.status === 404
      ? "That shared post isn't available — it may be private, removed, or the link is wrong."
      : `GeoID Network did not answer (${error.message}).`);
    return;
  }
  const world = postWorld(post);
  if (world && getBody(world) && world !== currentBodyId()) { goToWorld(world, { post: id }); return; }
  // The globe and the importer both have to be up: the camera has nothing to
  // fly and the layers nowhere to land until they are.
  if (!await globeReady()) return;
  if (post?.kind === "model") { await openModelPost(post, id); return; }
  await applyScene(post?.scene || {}, {
    bannerFor: bannerText(post), href: socialHref(post?.kind, id), linkText: "Open discussion",
  });
}

/** A project's workspace, or the sentence a banner or a status line says instead. */
async function fetchWorkspace(id, version = null) {
  const q = version ? `?version=${encodeURIComponent(version)}` : "";
  try {
    return await fetchJson(`/v1/projects/${encodeURIComponent(id)}/workspace${q}`, { auth: true });
  } catch (error) {
    error.message = error.status === 404 || error.status === 401 || error.status === 403
      ? "That project's workspace isn't available to you — it may be private, or you may need to sign in."
      : `GeoID Network did not answer (${error.message}).`;
    throw error;
  }
}

async function openProject(id) {
  let answer;
  try {
    answer = await fetchWorkspace(id);
  } catch (error) {
    banner(error.message);
    return;
  }
  await applyWorkspace(answer, id);
}

/**
 * THE ONE RESTORE PATH for a Social workspace: the `?project=` deep link, the
 * Projects page's "Update from Social" and "Save to my projects" all end here,
 * so a workspace cannot open one way from a link and another from a button.
 */
async function applyWorkspace(answer, id) {
  const manifest = answer?.manifest || {};
  const world = String(manifest.world || "").toLowerCase();
  if (world && getBody(world) && world !== currentBodyId()) { goToWorld(world, { project: id }); return; }
  if (!await globeReady()) return;
  /**
   * THERE IS NO RESTORE PATH FOR A REMOTE MANIFEST, and this does not invent
   * one. A project here is a folder (research/project-store.js) and its
   * layers come back from files in it (`bridge.restoreLayers`); a published
   * workspace is the manifest by reference -- names, catalogue ids, a camera
   * -- with no files behind it. So it is applied the way a shared scene is:
   * the camera, and every catalogue layer this viewer can switch on.
   */
  await applyScene({ camera: manifest.camera, layers: manifest.layers, annotations: manifest.annotations }, {
    bannerFor: `Viewing a shared project workspace${answer?.version ? ` (version ${answer.version})` : ""}`,
    href: socialHref("project", id), linkText: "Open project",
  });
}

async function whenReady(test, tries = 120, ms = 250) {
  for (let i = 0; i < tries; i += 1) {
    if (test()) return true;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  return false;
}

async function handleDeepLink() {
  const link = readDeepLink(window.location.search);
  if (!link.post && !link.project) return;
  if (link.post) await openPost(link.post);
  else await openProject(link.project);
}

/* ── Sharing ───────────────────────────────────────────────────────────── */

/** The layer manifest, with the catalogue id of each layer that came from one. */
function manifestLayers() {
  const rows = window.GeoIDProject?.layerManifest?.() || [];
  const byName = new Map(DATASETS.map((d) => [layerNameOf(d), d.id]));
  return rows
    .filter((r) => r.name !== COMMUNITY_LAYER_NAME && r.name !== INTEREST_LAYER_NAME && r.name !== ANNOTATION_LAYER_NAME)
    .map((r) => ({ ...r, catalogueId: byName.get(r.name) || null }));
}

/** Same origin, so the Social app reads what was left here; the TOP window, so it is a page. */
function openSocial(hash) {
  const to = `${SOCIAL_APP}${hash}`;
  try {
    if (window.top && window.top !== window.self) { window.top.location.assign(to); return; }
  } catch (_e) { /* fall through */ }
  window.location.assign(to);
}

function stash(key, value) {
  /**
   * sessionStorage is per TAB and per origin, and the Social app is the same
   * origin opened in the same tab, so this is a hand-over and not a store:
   * nothing is left behind for another tab or another visit to pick up.
   */
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch (_e) { return false; }
}

function sharePayload() {
  const cam = currentCamera();
  return buildSharePayload({
    world: currentBodyId(),
    focus: cam?.focus || null,
    alt: cam?.alt ?? null,
    heading: cam?.heading ?? 0,
    pitch: cam?.pitch ?? -90,
    layers: manifestLayers(),
    annotations: [],
    time: Math.floor((window.GeoIDViewer?.getSimulatedUtcMs?.() ?? Date.now()) / 1000),
    west: isWest(),
  });
}

/** Straight to compose with this view for the public feed -- the picker's default, without the picker. */
function shareView() {
  const built = buildShareHandoff({ kind: "scene", target: { type: "public", id: null }, scene: sharePayload() });
  if (built.error || !stash(SHARE_KEY, built.handoff)) return false;
  openSocial("#/compose?from=geohub");
  return true;
}

function activeProject() {
  try { return projectStore.getActive?.() || null; } catch (_e) { return null; }
}

/** The open project's workspace, as every door publishes and versions it. */
function currentManifest(active) {
  return buildWorkspaceManifest({ share: sharePayload(), name: active?.name || active?.dir || "" });
}

async function publishWorkspace() {
  const active = activeProject();
  if (!active) return false;
  if (!stash(WORKSPACE_KEY, buildWorkspacePayload({
    title: active.name || active.dir, world: currentBodyId(), manifest: currentManifest(active),
  }))) return false;
  openSocial("#/projects?new=1");
  return true;
}

/* ── The share picker ──────────────────────────────────────────────────── */

const node = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
};

const PICKER_STYLE = `
#social-share-picker{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  padding:1rem;background:rgba(2,6,12,0.55);}
#social-share-picker .ssp-panel{width:min(30rem,100%);max-height:calc(100vh - 2rem);overflow:auto;padding:1rem 1.1rem;
  border-radius:0.8rem;background:var(--panel-bg, rgba(8,14,24,0.97));color:var(--text, #dce8f2);
  border:1px solid var(--panel-border, rgba(120,170,210,0.35));font:400 0.85rem/1.4 'Public Sans',sans-serif;
  display:flex;flex-direction:column;gap:0.7rem;}
#social-share-picker h2{margin:0;font-size:1rem;font-weight:600;}
#social-share-picker fieldset{border:0;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:0.4rem 0.9rem;}
#social-share-picker legend,#social-share-picker .ssp-label{font-weight:600;font-size:0.78rem;margin-bottom:0.25rem;display:block;}
#social-share-picker label.ssp-kind{display:flex;align-items:center;gap:0.35rem;cursor:pointer;}
#social-share-picker label.ssp-kind.is-off{opacity:0.55;cursor:not-allowed;}
#social-share-picker .input{width:100%;box-sizing:border-box;}
#social-share-picker .ssp-note{margin:0;font-size:0.78rem;opacity:0.85;}
#social-share-picker .ssp-note.is-error{color:var(--danger, #ff8a80);opacity:1;}
#social-share-picker .ssp-actions{display:flex;justify-content:flex-end;gap:0.5rem;}
`;

/** The Model Builder's model, as a v1.1 `model` meta -- or why there is none yet. */
function modelShareMeta() {
  const pipeline = window.GeoIDModelPipeline;
  if (!pipeline?.getState) return { error: "The Model Builder isn't on this page." };
  const layerNames = Object.fromEntries(layers().map((l) => [String(l.id), l.name]));
  return buildModelMeta({ state: pipeline.getState(), world: currentBodyId(), west: isWest(), layerNames, mesher: window.GeoIDMeshStudio?.getMesher?.() });
}

/**
 * What to share and where it goes, asked before anything leaves.
 *
 * KIND × DESTINATION is the whole of it: a globe view, a model or a
 * repository, to the public feed or into one of the reader's teams,
 * communities or projects. The destinations are the reader's own (GET
 * /v1/me, and their projects at commenter or better), fetched when the
 * picker opens -- signed out there is only the public feed, and the picker
 * says why rather than showing an empty list. Composing still happens in the
 * Social app: this writes the v1.1 hand-off and goes there.
 */
async function openSharePicker({ kind = "scene" } = {}) {
  byId("social-share-picker")?.remove();
  if (!byId("social-share-picker-style")) {
    const style = document.createElement("style");
    style.id = "social-share-picker-style";
    style.textContent = PICKER_STYLE;
    document.head.appendChild(style);
  }
  const overlay = node("div");
  overlay.id = "social-share-picker";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "ssp-title");
  const form = node("form", "ssp-panel");
  const title = node("h2", null, "Share to GeoID Network");
  title.id = "ssp-title";

  const model = modelShareMeta();
  const kinds = node("fieldset");
  kinds.appendChild(node("legend", null, "What"));
  const why = { model: model.error || "" };
  SHARE_KINDS.forEach((k) => {
    const label = node("label", "ssp-kind");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "ssp-kind";
    radio.value = k;
    radio.checked = k === kind && !why[k];
    if (why[k]) { radio.disabled = true; label.classList.add("is-off"); label.title = why[k]; }
    label.append(radio, document.createTextNode(SHARE_KIND_LABELS[k]));
    kinds.appendChild(label);
  });
  if (!kinds.querySelector("input:checked")) kinds.querySelector('input[value="scene"]').checked = true;

  const destLabel = node("label");
  destLabel.appendChild(node("span", "ssp-label", "Where"));
  const dest = node("select", "input");
  dest.id = "ssp-destination";
  const pub = node("option", null, "Public feed");
  pub.value = destinationKey({ type: "public" });
  dest.appendChild(pub);
  destLabel.appendChild(dest);
  const destNote = node("p", "ssp-note", "Looking up your teams, communities and projects…");

  const titleLabel = node("label");
  titleLabel.appendChild(node("span", "ssp-label", "Title (optional)"));
  const titleInput = node("input", "input");
  titleInput.maxLength = 200;
  titleLabel.appendChild(titleInput);

  const repoLabel = node("label");
  repoLabel.appendChild(node("span", "ssp-label", "Repository URL"));
  const repoInput = node("input", "input");
  repoInput.type = "url";
  repoInput.placeholder = "https://github.com/…";
  repoInput.value = repoPrefill(activeProject()?.meta);
  repoLabel.appendChild(repoInput);
  const repoNote = node("p", "ssp-note", repoInput.value
    ? "From the open project. GeoHUB has no GitHub connection, so check it is the right one."
    : "Paste the https address of the repository — GitHub, GitLab, Codeberg or any other host.");

  const status = node("p", "ssp-note");
  status.setAttribute("aria-live", "polite");
  const say = (m, isError = false) => { status.textContent = m || ""; status.classList.toggle("is-error", isError); };

  const actions = node("div", "ssp-actions");
  const cancel = node("button", "button secondary", "Cancel");
  cancel.type = "button";
  const go = node("button", "button", "Continue to the Network");
  go.type = "submit";
  actions.append(cancel, go);

  const chosenKind = () => kinds.querySelector("input:checked")?.value || "scene";
  const sync = () => {
    const k = chosenKind();
    repoLabel.hidden = k !== "repo";
    repoNote.hidden = k !== "repo";
    if (k === "model" && model.meta) say(describeModel(model.meta)
      + (model.omitted?.length ? ` (left out to fit 32 KB: ${model.omitted.join(", ")})` : ""));
    else if (k !== "model") say("");
  };
  kinds.addEventListener("change", sync);

  const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  cancel.addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const k = chosenKind();
    const target = parseDestination(dest.value) || { type: "public", id: null };
    let built;
    if (k === "scene") built = buildShareHandoff({ kind: k, target, scene: sharePayload(), title: titleInput.value });
    else if (k === "model") built = model.meta ? buildShareHandoff({ kind: k, target, meta: model.meta, title: titleInput.value }) : model;
    else built = buildShareHandoff({ kind: k, target, meta: { url: repoInput.value }, title: titleInput.value });
    if (built.error) { say(built.error, true); return; }
    if (!stash(SHARE_KEY, built.handoff)) { say("This browser would not hold the hand-off (private mode?).", true); return; }
    close();
    openSocial("#/compose?from=geohub");
  });

  form.append(title, kinds, destLabel, destNote, titleLabel, repoLabel, repoNote, status, actions);
  overlay.appendChild(form);
  document.body.appendChild(overlay);
  sync();
  (kinds.querySelector("input:checked") || titleInput).focus();

  if (!await signedIn()) {
    destNote.textContent = "Sign in to GeoID Network to share into your teams, communities and projects.";
    return;
  }
  try {
    const [me, lists] = await Promise.all([meAnswer(), projectLists()]);
    // Roles for every project the reader can see; posting into one needs commenter+.
    const projects = sharedRows({ shared: lists.shared, mine: lists.mine });
    const options = shareDestinations(me, projects);
    options.slice(1).forEach((d) => {
      const opt = node("option", null, d.label);
      opt.value = destinationKey(d);
      dest.appendChild(opt);
    });
    destNote.textContent = options.length > 1
      ? "A team, community or project post is seen only by its members."
      : "You are not in any teams, communities or projects yet — this goes to the public feed.";
  } catch (error) {
    destNote.textContent = `Only the public feed for now — GeoID Network did not answer (${error.message}).`;
  }
}

/* ── Models ────────────────────────────────────────────────────────────── */

/**
 * A shared model, opened into this page's Model Builder.
 *
 * THE BUILDER HAS NO LOAD FUNCTION, so this is the nearest honest thing: its
 * exported state and setters take the settings (`modelSettingsFromConfig`
 * checks every one), and the domain comes in through the viewer's
 * `setStudyAreaPolygon` -- the door every drawn or preset study area uses, so
 * the builder adopts it exactly as it adopts a drawn one. What cannot be
 * restored is said, not skipped: layer roles need their layers loaded, and
 * the surface, mesh and package are rebuilt here rather than shipped.
 */
async function openModelPost(post, id) {
  const meta = post?.meta || {};
  const who = (typeof post?.author === "object" ? post.author?.handle : post?.author) || "someone";
  const line = describeModel(meta);
  const settings = modelSettingsFromConfig(meta.config, { west: isWest() });
  const pipeline = window.GeoIDModelPipeline;
  const notes = [];
  let loaded = false;
  if (pipeline?.getState && settings) {
    try { loaded = applyModelSettings(pipeline, settings, notes); } catch (error) { notes.push(`settings did not load (${error.message})`); }
  }
  if (settings?.area) {
    const a = settings.area;
    let east = a.east;
    if (east <= a.west) east += 360;
    const lat = (a.south + a.north) / 2;
    const lon = (a.west + east) / 2;
    const spanDeg = Math.max(a.north - a.south, (east - a.west) * Math.cos((lat * Math.PI) / 180));
    const radiusM = (viewerReady()?.bodyRadiusKm || 6371) * 1000;
    flyTo(lat, lon, Math.max(2000, spanDeg * (Math.PI / 180) * radiusM * 1.8));
  }
  // The Model Builder is a folded group in the GIS toolbox: open it, so the
  // settings just loaded are in front of the reader rather than behind a fold.
  const group = byId("gis-group-mesh");
  if (group) { group.open = true; group.scrollIntoView?.({ block: "nearest" }); }
  const tail = loaded
    ? "Its settings are in the Model Builder: build the surface to mesh it here."
    : "Shown read-only — this page has no Model Builder to load it into.";
  banner(`Shared model by @${String(who).replace(/^@/, "")}: ${line}. ${tail}${notes.length ? ` (${notes.join("; ")})` : ""} —`,
    { href: socialHref("model", id), linkText: "Open discussion" });
}

function applyModelSettings(pipeline, s, notes) {
  const state = pipeline.getState();
  const P = s.patch || {};
  if (P.kind) state.kind = P.kind;
  if (P.meshSizeM) state.meshSizeM = P.meshSizeM;
  ["domain", "resolution", "grading", "sampling", "atmosphere", "layers", "faults", "section"].forEach((key) => {
    if (P[key] && state[key] && typeof state[key] === "object") Object.assign(state[key], P[key]);
  });
  if (P.customPoints) state.customPoints = P.customPoints;
  if (P.conditions) state.conditions = P.conditions;
  Object.entries(s.flags || {}).forEach(([k, v]) => { state.flags[k] = Math.round(v); });
  Object.entries(s.pointFlagByName || {}).forEach(([k, v]) => state.pointFlagByName?.set?.(k, Math.round(v)));
  Object.entries(s.pointSizeByName || {}).forEach(([k, v]) => state.pointSizeByName?.set?.(k, v));
  // Only the knobs the builder already has: a stored post must not add keys
  // the mesher would then read.
  const knobs = Object.fromEntries(Object.entries(s.meshOptions || {})
    .filter(([k, v]) => k in (state.meshOptions || {}) && (v === null || ["number", "boolean", "string"].includes(typeof v))));
  if (Object.keys(knobs).length) pipeline.setMeshOptions?.(knobs);
  if (Array.isArray(s.sizeFields) && s.sizeFields.length && pipeline.addSizeField) {
    state.sizeFields = [];
    s.sizeFields.forEach((f) => pipeline.addSizeField(f));
  }
  // Roles by layer NAME, matched against what is loaded here.
  let missing = 0;
  (s.roles || []).forEach((r) => {
    const hit = layers().find((l) => l.name === r.layer);
    if (hit && state.roles?.set) state.roles.set(String(hit.id), r.role); else missing += 1;
  });
  if (missing) notes.push(`${missing} layer role${missing === 1 ? " needs its layer" : "s need their layers"} loaded first`);
  if (s.omitted?.length) notes.push(`shared without ${s.omitted.join(", ")}`);
  state.surface = null;
  state.profile = null;
  state.outputs = null;
  const ring = boxRing(s.area);
  const viewer = viewerReady();
  if (ring && viewer?.setStudyAreaPolygon) {
    // The builder adopts a drawn area only while its picker says "drawn"; a
    // reader who had picked a polygon layer would otherwise keep their own.
    state.bounds = null;
    pipeline.render?.();
    if (!viewer.setStudyAreaPolygon(ring)) notes.push("the domain could not be drawn — draw the study area to continue");
  } else if (!ring) {
    notes.push("no domain in the post — draw the study area to continue");
  } else {
    notes.push("this world's globe cannot take a study area — draw it to continue");
  }
  pipeline.render?.();
  return true;
}

function shareModelButton(id, className) {
  const b = node("button", className, "Share model to the Network");
  b.type = "button";
  b.id = id;
  b.title = "Post this model's settings — never its mesh files — to the public feed, a team, a community or a project.";
  b.addEventListener("click", (event) => { event.stopPropagation(); void openSharePicker({ kind: "model" }); });
  return b;
}

/**
 * "Share model to the Network" on both of the model's doors: under the Model
 * Builder's six steps in the GIS toolbox, and in the Meshing Studio's Export
 * menu beside "Model package". Polled for, as the panels themselves are: the
 * Model Builder renders into a tab add-data.js builds whenever it gets to it.
 */
function installModelShare(tries = 0) {
  const pipelineWrap = byId("gis-model-pipeline");
  if (pipelineWrap && !byId("social-share-model")) {
    const wrap = node("div", "gis-btn-row");
    wrap.id = "social-model-share";
    wrap.style.margin = "0.6rem 0";
    wrap.appendChild(shareModelButton("social-share-model", "button secondary small"));
    pipelineWrap.insertAdjacentElement("afterend", wrap);
  }
  const exportMenu = document.querySelector('#model-studio [data-menu="export"] .studio-menu-pop');
  if (exportMenu && !byId("social-share-model-studio")) {
    exportMenu.appendChild(node("span", "studio-sep"));
    exportMenu.appendChild(shareModelButton("social-share-model-studio", "studio-btn"));
  }
  if ((!byId("social-share-model") || !byId("social-share-model-studio")) && tries < 120) {
    setTimeout(() => installModelShare(tries + 1), 500);
  }
}

/* ── Saved projects, linked to Social ──────────────────────────────────── */

/** Every local project's link, by Social project id. Empty without a projects folder. */
async function localLinks() {
  const out = new Map();
  if (!projectStore.getRoot?.() || !projectStore.readProjectMeta) return out;
  let dirs = [];
  try { dirs = await projectStore.listProjects(null); } catch (_e) { return out; }
  for (const dir of dirs) {
    try {
      const link = readSocialLink(await projectStore.readProjectMeta(dir));
      if (link) out.set(link.project_id, { link, dir });
    } catch (_e) { /* one unreadable project must not hide the rest */ }
  }
  return out;
}

/**
 * The workspace is the GLOBE's, and the globe is one world: a Mars project's
 * workspace published from the Earth view would be Earth's layers under a Mars
 * title. Refused, with the way out.
 */
function sameWorld(active) {
  const body = String(active?.meta?.body || active?.body || "earth").toLowerCase();
  if (body !== currentBodyId()) {
    throw new Error(`This is a ${getBody(body)?.name || body} project and the globe is showing `
      + `${currentBody()?.name || currentBodyId()} — open ${getBody(body)?.name || body} to publish its workspace.`);
  }
}

async function publishActive({ title, summary, visibility, team_slug }) {
  const active = activeProject();
  if (!active) throw new Error("Open a project first.");
  sameWorld(active);
  const built = publishProjectBody({
    title, summary, world: currentBodyId(), visibility, team_slug, manifest: currentManifest(active),
  });
  if (built.error) throw new Error(built.error);
  const answer = await sendJson("/v1/projects", built.body);
  const project = answer?.project && typeof answer.project === "object" ? answer.project : answer;
  if (!validId(project?.id)) throw new Error("GeoID Network did not say which project it made.");
  // The workspace sent with the publish is version 1 (contract: projects.js).
  const link = makeSocialLink({ project_id: project.id, version: remoteVersion(answer) || 1, role: "owner" });
  await projectStore.updateMetadata({ social: link });
  forget("projects:");
  return link;
}

async function pushActive(note) {
  const active = activeProject();
  const link = readSocialLink(active?.meta);
  if (!link) throw new Error("This project is not on GeoID Network yet.");
  sameWorld(active);
  const built = pushVersionBody({ manifest: currentManifest(active), note });
  if (built.error) throw new Error(built.error);
  const answer = await sendJson(`/v1/projects/${encodeURIComponent(link.project_id)}/versions`, built.body);
  forget(`remote:${link.project_id}`);
  let version = Math.floor(Number(answer?.version)) || remoteVersion(answer);
  if (!version) version = remoteVersion(await remoteProject(link.project_id));
  await projectStore.updateMetadata({ social: { ...link, version: version || link.version + 1 } });
  return version;
}

/** A pulled workspace is kept beside the link, so what the project was last given is on disk too. */
async function keepWorkspace(id, answer) {
  try {
    await projectStore.writeJson("metadata/social_workspace.json", {
      project_id: id, version: Number(answer?.version) || null, manifest: answer?.manifest || {},
      pulled_at: new Date().toISOString(),
    });
  } catch (_e) { /* the link is what matters; the copy is a courtesy */ }
}

async function pullActive() {
  const active = activeProject();
  const link = readSocialLink(active?.meta);
  if (!link) throw new Error("This project is not on GeoID Network.");
  const answer = await fetchWorkspace(link.project_id);
  let role = link.role;
  try { role = (await remoteProject(link.project_id))?.access?.role || role; } catch (_e) { /* keep the stored role */ }
  const fresh = makeSocialLink({ project_id: link.project_id, version: Number(answer?.version) || link.version, role });
  // Recorded BEFORE it is applied: a workspace on another world leaves this page.
  await projectStore.updateMetadata({ social: { ...fresh, linked_at: link.linked_at || fresh.linked_at } });
  await keepWorkspace(link.project_id, answer);
  await applyWorkspace(answer, link.project_id);
  return fresh.version;
}

/**
 * Somebody else's project, saved as one of mine: a new local project of the
 * same name, on its own world, with the workspace applied and a link that
 * records MY role in it -- each user's link is their own (contract v1.1).
 */
async function saveShared(row) {
  if (!projectStore.getRoot?.()) throw new Error("Choose a projects folder first (Projects → Choose folder…).");
  const answer = await fetchWorkspace(row.id);
  const world = String(answer?.manifest?.world || row.world || "earth").toLowerCase();
  const overrides = { body: getBody(world) ? world : "earth" };
  try {
    await projectStore.createProject(row.title, overrides);
  } catch (error) {
    if (!/already exists/.test(error.message)) throw error;
    await projectStore.createProject(`${row.title} (${row.id.slice(-4)})`, overrides);
  }
  await keepWorkspace(row.id, answer);
  await projectStore.updateMetadata({
    social: makeSocialLink({ project_id: row.id, version: Number(answer?.version) || row.version, role: row.role }),
  });
  forget("projects:");
  await applyWorkspace(answer, row.id);
}

function linkAnchor(text, href) {
  const a = node("a", "button secondary small", text);
  a.href = href;
  // The Social app and the shell are pages of the site, not of this frame.
  a.target = "_top";
  a.rel = "noopener";
  return a;
}

function smallButton(text, onClick, { primary = false } = {}) {
  const b = node("button", primary ? "button small" : "button secondary small", text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** The open project's Social state, and what can be done about it. */
async function paintActiveLink(host, say, repaint) {
  host.textContent = "";
  const active = activeProject();
  if (!active) {
    host.appendChild(node("p", "research-note", "Open a project to publish it to GeoID Network or see its link."));
    return;
  }
  const link = readSocialLink(active.meta);
  if (!link) {
    host.appendChild(node("p", "research-note", `"${active.name}" is not on GeoID Network.`));
    const row = node("div", "gis-btn-row");
    const open = smallButton("Publish to the Network…", () => { form.hidden = !form.hidden; });
    row.appendChild(open);
    host.appendChild(row);
    const form = node("div", "social-publish-form");
    form.hidden = true;
    const field = (label, control) => {
      const wrap = node("label", "research-field");
      wrap.appendChild(node("span", "research-field-label", label));
      wrap.appendChild(control);
      return wrap;
    };
    const title = node("input", "input");
    title.value = active.name || "";
    title.maxLength = 200;
    const summary = node("textarea", "input");
    summary.rows = 2;
    summary.value = active.meta?.description || "";
    const vis = node("select", "input");
    PUBLISH_VISIBILITY.forEach((v) => {
      const opt = node("option", null, {
        private: "Private — only people I share it with", team: "Team — one of my teams",
        unlisted: "Unlisted — anyone with the link", public: "Public",
      }[v]);
      opt.value = v;
      vis.appendChild(opt);
    });
    const team = node("select", "input");
    const none = node("option", null, "No team");
    none.value = "";
    team.appendChild(none);
    const go = smallButton("Publish", async () => {
      go.disabled = true;
      say("Publishing…");
      try {
        const made = await publishActive({ title: title.value, summary: summary.value, visibility: vis.value, team_slug: team.value });
        say(`Published as version ${made.version}. Linked in metadata/project.json.`);
        repaint();
      } catch (error) {
        say(error.message, true);
        go.disabled = false;
      }
    }, { primary: true });
    form.append(field("Title", title), field("Summary", summary), field("Who can see it", vis), field("Team", team),
      node("p", "research-note", "The workspace is the globe's camera and its catalogue layers, by reference — no files are uploaded."));
    const goRow = node("div", "gis-btn-row");
    goRow.appendChild(go);
    form.appendChild(goRow);
    host.appendChild(form);
    if (!await signedIn()) {
      open.disabled = true;
      open.title = "Sign in first — GeoID Network uses your GeoID account.";
      host.appendChild(node("p", "research-note", "Sign in to publish to GeoID Network."));
      return;
    }
    meAnswer().then((me) => {
      (me?.teams || []).forEach((t) => {
        const opt = node("option", null, t.name || t.slug);
        opt.value = t.slug;
        team.appendChild(opt);
      });
    }).catch(() => { /* no teams to offer; "No team" stands */ });
    return;
  }

  const head = node("p", "research-note", `On GeoID Network · version ${link.version} · ${link.role}`);
  host.appendChild(head);
  const row = node("div", "gis-btn-row");
  row.appendChild(linkAnchor("Open on the Network", socialHref("project", link.project_id)));
  host.appendChild(row);
  // Signed out, a private project answers 404 -- which must not read as
  // "deleted" and offer to forget a link that is fine.
  if (!await signedIn()) {
    host.appendChild(node("p", "research-note", "Sign in to GeoID Network to check for newer versions or push one."));
    return;
  }
  let answer = null;
  try {
    answer = await remoteProject(link.project_id);
  } catch (error) {
    if (error.status === 404 || error.status === 403) {
      host.appendChild(node("p", "research-note is-error",
        "That Network project isn't available to you any more — it may have been deleted, or your access removed."));
      row.appendChild(smallButton("Forget the link", async () => {
        try { await projectStore.updateMetadata({ social: null }); repaint(); } catch (e) { say(e.message, true); }
      }));
    } else {
      host.appendChild(node("p", "research-note", `Could not check for newer versions (${error.message}).`));
    }
    return;
  }
  const st = linkState(link, answer);
  head.textContent = `On GeoID Network · version ${st.local}${st.remote ? ` of ${st.remote}` : ""} · ${st.role}`;
  if (st.behind) {
    row.appendChild(smallButton(`Update from Social (v${st.remote})`, async () => {
      say(`Pulling version ${st.remote}…`);
      try { const v = await pullActive(); say(`Updated to version ${v}.`); repaint(); } catch (e) { say(e.message, true); }
    }, { primary: true }));
  }
  if (st.canPush) {
    row.appendChild(linkAnchor("Share with people/teams…", socialHref("project", link.project_id)));
    const pushRow = node("div", "gis-btn-row");
    const note = node("input", "input");
    note.placeholder = "What changed (optional)";
    note.maxLength = 500;
    const push = smallButton("Push new version", async () => {
      push.disabled = true;
      say("Pushing…");
      try { const v = await pushActive(note.value); say(`Pushed version ${v}.`); repaint(); } catch (e) { say(e.message, true); push.disabled = false; }
    });
    pushRow.append(note, push);
    host.appendChild(pushRow);
    if (st.behind) host.appendChild(node("p", "research-note", "The Network has a newer version than this project — update first, or your push will replace it."));
  } else {
    host.appendChild(node("p", "research-note", st.why));
  }
  if (!st.behind && st.remote) host.appendChild(node("p", "research-note", `Up to date with Social (version ${st.remote}).`));
}

/** Projects shared with the reader, and their own not yet saved on this machine. */
async function paintShared(host, say, repaint) {
  host.textContent = "";
  host.appendChild(node("h4", "project-block-title", "Shared with me"));
  if (!await signedIn()) {
    host.appendChild(node("p", "research-note", "Sign in to GeoID Network to see projects shared with you."));
    return;
  }
  const [lists, links] = await Promise.all([projectLists(), localLinks()]);
  const rows = sharedRows({ shared: lists.shared, mine: lists.mine, localLinks: [...links.values()].map((v) => v.link) });
  if (!rows.length) {
    host.appendChild(node("p", "research-note", "Nothing shared with you yet."));
    return;
  }
  const list = node("div", "research-list");
  const canSave = Boolean(projectStore.getRoot?.());
  rows.forEach((r) => {
    const line = node("div", "research-list-row");
    line.appendChild(node("span", "research-list-name", r.title));
    line.appendChild(node("span", "research-list-tag", getBody(r.world)?.name || r.world));
    line.appendChild(node("span", "research-list-tag", r.source === "mine" ? "yours" : r.role));
    if (r.owner && r.source !== "mine") line.appendChild(node("span", "research-list-tag", `@${r.owner}`));
    const acts = node("span", "gis-btn-row");
    acts.appendChild(linkAnchor("Open in GeoHUB", worldUrl(r.world, { project: r.id })));
    if (r.saved) {
      acts.appendChild(node("span", "research-list-tag", `saved · ${links.get(r.id)?.dir || ""}`));
    } else {
      const save = smallButton("Save to my projects", async () => {
        save.disabled = true;
        say(`Saving "${r.title}"…`);
        try { await saveShared(r); say(`Saved "${r.title}" to your projects.`); repaint(); } catch (e) { say(e.message, true); save.disabled = false; }
      });
      if (!canSave) { save.disabled = true; save.title = "Choose a projects folder first."; }
      acts.appendChild(save);
    }
    line.appendChild(acts);
    list.appendChild(line);
  });
  host.appendChild(list);
}

/**
 * GeoID Network for saved projects: the open project's link, and "Shared with
 * me". One block, built here, shown by both places GeoHUB lists projects --
 * the Project dialog (project.js) and the Research Hub's Projects page -- so
 * the two cannot drift into two ideas of what a linked project is.
 */
function projectSocialPanel() {
  const block = node("div", "project-block social-projects");
  const mine = node("div");
  const shared = node("div");
  const status = node("p", "research-status");
  status.setAttribute("aria-live", "polite");
  const say = (m, isError = false) => { status.textContent = m || ""; status.classList.toggle("is-error", isError); };
  const repaint = () => {
    void paintActiveLink(mine, say, repaint).catch((e) => say(e.message, true));
    void paintShared(shared, say, repaint).catch((e) => say(`Shared projects did not load (${e.message}).`, true));
  };
  block.append(mine, shared, status);
  repaint();
  return block;
}

/** A project row's Social tag ("Social v3 · editor"), added when its metadata has a link. */
async function decorateProjectRow(row, dir) {
  try {
    const tag = linkTag(readSocialLink(await projectStore.readProjectMeta?.(dir)));
    if (tag && row?.isConnected !== false) row.appendChild(node("span", "research-list-tag", tag));
  } catch (_e) { /* a row without its tag is still a row */ }
}

/**
 * The GeoID Network block for the Project dialog (project.js asks for it).
 *
 * Not behind membership: posting is open to anybody signed in to Social, and
 * Social asks them to sign in. Share opens the picker (what, and where);
 * the open project's link and "Shared with me" follow.
 */
function projectBlock(_active) {
  const block = node("div", "project-block");
  block.appendChild(node("h3", "project-block-title", "GeoID Network"));
  block.appendChild(node("p", "research-note",
    "Share this view, a model or a repository — to the public feed, or into one of your teams, communities or projects."));
  const row = node("div", "gis-btn-row");
  const share = node("button", "button secondary", "Share to the Network…");
  share.type = "button";
  share.id = "social-share-view";
  share.addEventListener("click", () => { void openSharePicker({ kind: "scene" }); });
  row.appendChild(share);
  block.appendChild(row);
  block.appendChild(projectSocialPanel());
  return block;
}

/* ── The panel ─────────────────────────────────────────────────────────── */

function install(tries = 0) {
  const section = byId("locations-section");
  const sectionBody = section?.querySelector(":scope > .section-body");
  if (!sectionBody) {
    if (tries < 80) setTimeout(() => install(tries + 1), 250);
    return;
  }
  if (byId("social-community")) return;
  /**
   * Its own card in Locations, beside the IAU outlines: the community's
   * places are places, on every world, and this is the one section every
   * viewer has. The tick is on the card's header, as the outlines' is.
   */
  const wrap = document.createElement("details");
  wrap.id = "social-community";
  wrap.className = "gis-tool-section";
  wrap.dataset.toolIcon = "1";
  wrap.innerHTML = `
    <summary style="display:flex;align-items:center;gap:0.5rem;">
      <span style="flex:1 1 auto;min-width:0;">Community (GeoID Network)</span>
      <input id="social-community-toggle" type="checkbox"
        aria-label="Show community posts near the view" title="Show community posts near the view">
    </summary>
    <div class="gis-tool-body">
      <p class="compact-copy">Public posts, observations and projects the GeoID Network community has
        placed on this world, refreshed as the view settles. Community content — unverified unless a
        post says how it was observed or modelled.</p>
      <label class="row"><span>Show</span>
        <select id="social-community-mode" class="input" title="Posts and projects, or where community members work">
          <option value="posts" selected>Posts &amp; projects</option>
          <option value="interest">Study interest (people)</option>
        </select>
      </label>
      <div class="gis-btn-row"><button type="button" class="button secondary small" id="social-share-view-panel">Share to the Network…</button></div>
      <p class="compact-copy" id="social-community-status" aria-live="polite"></p>
    </div>`;
  const stack = sectionBody.querySelector(".control-stack") || sectionBody;
  const before = stack.querySelector(":scope > .lod-slider-row");
  if (before) stack.insertBefore(wrap, before); else stack.appendChild(wrap);
  const tick = byId("social-community-toggle");
  ["click", "pointerdown"].forEach((type) => tick.addEventListener(type, (event) => event.stopPropagation()));
  const status = byId("social-community-status");
  community.say = (m) => { if (status) status.textContent = m || ""; };
  tick.addEventListener("change", () => { setCommunity(tick.checked); });
  byId("social-community-mode")?.addEventListener("change", (event) => { setCommunityMode(event.target.value); });
  byId("social-share-view-panel")?.addEventListener("click", () => { void openSharePicker({ kind: "scene" }); });
  // Removed from the Workspace rather than here: the tick follows, and the
  // polling stops, rather than the next settle putting it straight back.
  const follow = () => {
    if (community.busy || !community.on) return;
    if (!namedLayer(communityLayerName(community.mode)) && community.key) setCommunity(false);
  };
  const hook = (n = 0) => {
    if (manager()?.onChange) manager().onChange(follow);
    else if (n < 80) setTimeout(() => hook(n + 1), 250);
  };
  hook();
}

/* ── Atlas ─────────────────────────────────────────────────────────────── */

/** Public posts near the centre of the view, for the `community_near` tool. */
async function near({ radiusKm = 50 } = {}) {
  const viewer = viewerReady();
  const focus = viewer ? viewFocus(viewer, THREE) : null;
  if (!focus) return { text: "Point the globe at somewhere first — there is no ground at the centre of the view.", items: [] };
  const q = new URLSearchParams({
    lat: focus.lat.toFixed(3),
    lon: toEastLon(focus.lon, isWest()).toFixed(3),
    radius_km: String(Math.max(1, Math.min(500, Number(radiusKm) || 50))),
  });
  if (currentBodyId() !== "earth") q.set("world", currentBodyId());
  const answer = await fetchJson(`/v1/places?${q.toString()}`);
  return describePlaces(answer);
}

window.GeoIDSocial = {
  base, socialToken, fetchJson, setCommunity, setCommunityMode, refreshCommunity, near,
  shareView, publishWorkspace, projectBlock, openPost, openProject,
  openSharePicker, projectSocialPanel, decorateProjectRow,
  publishActive, pushActive, pullActive, saveShared, modelShareMeta,
};

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  const start = () => { install(); installModelShare(); void handleDeepLink(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
