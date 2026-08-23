/**
 * Names on a point layer, for the few worth naming.
 *
 * 2,666 volcanoes with 2,666 labels is a white globe. Any label layer's real
 * job is CHOOSING, and the two ways of choosing are both here because neither
 * is enough alone:
 *
 * - **Rank.** The data says which points matter, in a `label_rank` property —
 *   for volcanoes that is eruption recency, which is the significance the
 *   record actually supports. The layer never invents it.
 * - **Room.** Rank alone still puts 231 names on one hemisphere. So labels are
 *   also spaced: a candidate is dropped if a higher-ranked one has already
 *   taken the screen space near it, which is what every cartographic label
 *   engine does and the only thing that makes a global view readable.
 *
 * Both are re-decided as the camera moves, because both answers depend on it:
 * zooming in frees room, so the next rank down appears — the density is the
 * same at every scale, which is the property that makes it feel designed
 * rather than thresholded.
 *
 * The labels are sprites in the imported-layer group, so they carry the globe's
 * spin with the points they name and need no frame of their own.
 */

/** How many labels a view may hold. Beyond this it is texture, not text. */
const MAX_LABELS = 42;

/** Screen-space radius each label claims, in pixels. */
const CLAIM_PX = 46;

const layers = new Map();
let THREE = null;
let frame = null;

/* ── the sprite ───────────────────────────────────────────────────────────── */

const textures = new Map();

/**
 * A label as a canvas texture, cached by its text.
 *
 * Drawn at 2x and scaled down, because a sprite at exactly its pixel size is
 * resampled by the GPU and the type goes soft. The dark stroke under the fill
 * is what keeps a name legible over both ocean and a bright geological map --
 * a drop shadow disappears against one of them whichever way it is tuned.
 */
function labelTexture(text) {
  if (textures.has(text)) return textures.get(text);
  const scale = 2;
  const font = `600 ${13 * scale}px "Exo 2", "Segoe UI", sans-serif`;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const width = Math.ceil(probe.measureText(text).width) + 12 * scale;
  const height = 20 * scale;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3.5 * scale;
  ctx.strokeStyle = "rgba(6, 3, 14, 0.92)";
  ctx.lineJoin = "round";
  ctx.strokeText(text, 6 * scale, height / 2);
  ctx.fillStyle = "#f2e9ff";
  ctx.fillText(text, 6 * scale, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const record = { texture, width: width / scale, height: height / scale };
  textures.set(text, record);
  return record;
}

/* ── choosing ─────────────────────────────────────────────────────────────── */

/**
 * Which points get a name in this view.
 *
 * Pure, and exported for the tests: the ordering and the spacing are the whole
 * behaviour, and both are easy to get subtly wrong in a way that only shows as
 * "the labels look messy".
 *
 * @param {Array} candidates  `{ rank, x, y, visible }` in screen pixels
 * @param {object} options    `max` labels, `claim` radius in pixels
 */
export function chooseLabels(candidates, { max = MAX_LABELS, claim = CLAIM_PX } = {}) {
  const kept = [];
  const ordered = candidates
    .filter((c) => c.visible && c.rank > 0)
    // Rank first, then nearer the middle of the view: of two equally ranked
    // volcanoes the one you are looking at is the one to name.
    .sort((a, b) => (b.rank - a.rank) || (a.fromCentre - b.fromCentre));
  for (const candidate of ordered) {
    if (kept.length >= max) break;
    // Squared distance, so the spacing test costs no square roots at 2,666
    // candidates a frame.
    const clash = kept.some((k) => {
      const dx = k.x - candidate.x;
      const dy = k.y - candidate.y;
      return dx * dx + dy * dy < claim * claim;
    });
    if (!clash) kept.push(candidate);
  }
  return kept;
}

/* ── the layer ────────────────────────────────────────────────────────────── */

function group(layer) {
  const existing = layers.get(layer.id);
  if (existing) return existing;
  const node = new THREE.Group();
  node.name = `labels-${layer.name}`;
  // Into the layer's own object, so visibility, the draw order the stack
  // stamps, and the spin all follow the points without a second rule.
  layer.object3D?.add(node);
  const record = { node, layer, sprites: new Map() };
  layers.set(layer.id, record);
  return record;
}

/**
 * Where a label sits, in the frame its group is in.
 *
 * The viewer's own `surfacePoint` follows the relief and the terrain slider, so
 * a label rides the ground the way the marker under it does. It answers in the
 * BASELINE frame -- the imported group applies the spin -- which is exactly the
 * frame the sprites live in, so nothing has to be un-rotated here.
 */
function project(viewer, lat, lon) {
  return viewer.surfacePoint
    ? viewer.surfacePoint(lat, lon, 0.012)
    : viewer.latLonToVector3(lat, lon, (viewer.GLOBE_RADIUS || 3.2) + 0.012);
}

/** Rebuild the visible label set for one layer, from where the camera is now. */
function refresh(record) {
  const viewer = window.GeoIDViewer;
  const camera = viewer?.camera;
  const canvas = viewer?.renderer?.domElement;
  if (!camera || !canvas || !record.layer.features) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const centre = new THREE.Vector2(rect.width / 2, rect.height / 2);
  const cam = camera.position.clone().normalize();
  const candidates = [];
  record.layer.features.forEach((feature, index) => {
    const rank = Number(feature?.properties?.label_rank) || 0;
    if (rank <= 0) return;
    const coords = feature?.geometry?.coordinates;
    if (!coords) return;
    // `surfacePoint` answers in the same frame the group is in, so the point
    // has to go to WORLD space through the group's matrix before it can be
    // projected -- the group carries the spin and the 23.44 degree tilt.
    const world = record.node.localToWorld(project(viewer, coords[1], coords[0]).clone());
    // Only the side facing the camera: a label on the far hemisphere would
    // draw through the planet, which is the fault the seam had.
    if (world.clone().normalize().dot(cam) <= 0.12) return;
    const s = world.clone().project(camera);
    if (Math.abs(s.x) > 1 || Math.abs(s.y) > 1) return;
    const x = (s.x * 0.5 + 0.5) * rect.width;
    const y = (-s.y * 0.5 + 0.5) * rect.height;
    candidates.push({
      index,
      rank,
      x,
      y,
      visible: true,
      fromCentre: Math.hypot(x - centre.x, y - centre.y),
      name: feature.properties.name,
      lat: coords[1],
      lon: coords[0],
    });
  });

  const kept = chooseLabels(candidates);
  const wanted = new Set(kept.map((k) => k.index));

  // Drop what is no longer chosen. Sprites are cheap to rebuild and holding
  // 2,666 of them hidden is 2,666 draw calls the renderer still walks.
  record.sprites.forEach((sprite, index) => {
    if (wanted.has(index)) return;
    record.node.remove(sprite);
    sprite.material?.dispose?.();
    record.sprites.delete(index);
  });

  const px = viewer.camera.position.length();
  kept.forEach((candidate) => {
    let sprite = record.sprites.get(candidate.index);
    if (!sprite) {
      const { texture, width, height } = labelTexture(candidate.name);
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, transparent: true, depthTest: true, depthWrite: false,
        sizeAttenuation: false,
      }));
      sprite.userData.aspect = width / height;
      sprite.userData.labelHeight = height;
      record.node.add(sprite);
      record.sprites.set(candidate.index, sprite);
    }
    const world = project(window.GeoIDViewer, candidate.lat, candidate.lon);
    sprite.position.copy(world);
    /**
     * `sizeAttenuation: false` sizes a sprite in CLIP space, not pixels.
     *
     * A scale of 1 fills the viewport. So the height is the label's pixel
     * height as a fraction of the canvas, and the width follows from the
     * texture's own aspect -- taking the scale from world units instead makes
     * the type grow as you zoom in, which is exactly what a label must not do.
     */
    const h = (sprite.userData.labelHeight / rect.height) * 2;
    sprite.scale.set(h * sprite.userData.aspect, h, 1);
    // Above the dot rather than on it, by half a label.
    sprite.center.set(0.5, -0.35);
    sprite.renderOrder = (record.layer.object3D?.renderOrder || 0) + 0.25;
  });
  record.visible = kept.length;
}

/** Redraw every registered layer's labels, on a frame. */
function tick() {
  frame = null;
  layers.forEach((record) => {
    if (record.layer.status !== "loaded" || record.layer.visible === false) {
      record.node.visible = false;
      return;
    }
    record.node.visible = true;
    try { refresh(record); } catch (error) { /* one bad layer must not stop the rest */ }
  });
}

function schedule() {
  if (frame) return;
  frame = window.requestAnimationFrame(tick);
}

/**
 * Turn labels on for a layer, or off.
 *
 * Any point layer carrying `label_rank` can use this; the volcanoes are the
 * first, and cities or named landforms would need nothing added.
 */
export async function setLabels(layer, on) {
  if (!layer) return false;
  if (!THREE) THREE = await import("../vendor/three.module.js");
  if (!on) {
    const record = layers.get(layer.id);
    if (record) {
      record.node.parent?.remove(record.node);
      record.sprites.forEach((s) => s.material?.dispose?.());
      layers.delete(layer.id);
    }
    return false;
  }
  const ranked = (layer.features || []).some((f) => Number(f?.properties?.label_rank) > 0);
  if (!ranked) return false;
  group(layer);
  schedule();
  return true;
}

export const isLabelled = (layer) => layers.has(layer?.id);

/** Whether a layer has anything to label at all — for offering the control. */
export const canLabel = (layer) =>
  (layer?.features || []).some((f) => Number(f?.properties?.label_rank) > 0);

if (typeof window !== "undefined") {
  // The camera moves without telling anyone, so the label set is re-chosen on
  // a slow poll rather than hooked to an event that does not exist. 200 ms is
  // below the point where a label visibly lags the dot it names.
  window.setInterval(() => { if (layers.size) schedule(); }, 200);
  window.GeoIDPointLabels = { setLabels, isLabelled, canLabel, chooseLabels };
}
