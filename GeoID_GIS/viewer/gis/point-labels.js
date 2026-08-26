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
 *
 * ── What a label IS, and why it is not just the text ──────────────────────
 *
 * The planet viewers have had the full form since the start and this had only
 * half of it: a name floating over a dot, in one colour, at one size. The rest
 * of it carries meaning that the text cannot:
 *
 * - **A chip, offset from a dot.** A name drawn ON its point covers the point.
 *   The dot marks which of them is named and the chip sits with its bottom-left
 *   corner on it, extending up and to the right — accent bar nearest the dot.
 * - **Colour from the LAYER'S OWN symbology.** Not a palette of this file's
 *   own: the map is already coloured by something the user chose, and a label
 *   in an unrelated colour is a second key to learn. Colour the name the same
 *   as the thing it names and the legend explains both.
 * - **Size by significance.** `label_rank` is what the data says matters — for
 *   the volcanoes, eruption recency. Rank drives the type size and the dot,
 *   so a glance at a crowded region reads the hierarchy without reading a
 *   word of it.
 * - **A card on click.** The name is the affordance, so the name has to be the
 *   target; `feature-popup.js` raises the same card the dot would.
 */

/** How many labels a view may hold. Beyond this it is texture, not text. */
const MAX_LABELS = 42;

/** Screen-space radius each label claims, in pixels. */
const CLAIM_PX = 46;

/**
 * Rank, made visible.
 *
 * Five tiers, because the data has five. `size` is the type height in CSS
 * pixels and `dot` the marker's radius: both grow with rank, so the eye sorts
 * a crowded coastline before it reads any of it. `claim` grows with them —
 * a bigger label needs more room, and a fixed spacing would let the largest
 * names overlap while the smallest were held apart.
 */
const TIERS = {
  5: { size: 15, dot: 4.6, claim: 62 },
  4: { size: 14, dot: 4.1, claim: 56 },
  3: { size: 13, dot: 3.6, claim: 50 },
  2: { size: 12, dot: 3.2, claim: 46 },
  1: { size: 11, dot: 2.8, claim: 42 },
};
const tierFor = (rank) => TIERS[Math.max(1, Math.min(5, Math.round(rank)))] || TIERS[1];

/** The colour a label falls back to when the layer has no symbology to read. */
const DEFAULT_COLOUR = "#f2e9ff";

const layers = new Map();
let THREE = null;
let frame = null;

/* ── the sprite ───────────────────────────────────────────────────────────── */

const textures = new Map();
let dotTexture = null;

/**
 * How big a name will be, before deciding whether to draw it.
 *
 * The declutter has to know the label's WIDTH -- a name is a box, not a dot --
 * and the texture is only built for the labels that survive. So the measure is
 * split out and cached on the same key.
 */
const measures = new Map();
let probeCtx = null;

/**
 * The chip the Mars and Moon viewers draw, in this file's own hand.
 *
 * Their `makeLabelTexture` is a closure inside a 17,000-line module and cannot
 * be imported, so the DRAWING is reproduced here: a rounded panel at 14 px
 * radius, a hairline stroke, a coloured accent bar inside the left edge, and
 * Orbitron over it. The proportions are theirs -- 14 px side padding, a 6 px
 * accent, a body inset of padding + accent + 7, a 34 px panel for 15 px type,
 * drawn at 4x and mipmapped -- so a name reads the same on Earth as it does on
 * the Moon.
 *
 * What is NOT theirs is the accent COLOUR. Those viewers key it to a theme, so
 * every volcano is the same red; here it comes from the layer's own symbology,
 * and 2,666 volcanoes carry the type colours the legend beside them already
 * explains. One shape, coloured by the map it is on.
 */
const CHIP = { padX: 14, accent: 6, bodyLeft: 27, radius: 14, minWidth: 110 };
const chipFont = (size) => `600 ${size}px Orbitron, "Exo 2", Aldrich, "Trebuchet MS", sans-serif`;

function measureLabel(text, size) {
  const key = `${size}|${text}`;
  const hit = measures.get(key);
  if (hit) return hit;
  probeCtx = probeCtx || document.createElement("canvas").getContext("2d");
  probeCtx.font = chipFont(size);
  const width = Math.max(
    CHIP.minWidth, Math.ceil(probeCtx.measureText(text).width) + CHIP.bodyLeft + CHIP.padX,
  );
  // 34 px of panel for 15 px of type, which is the planet viewers' ratio.
  const record = { width, height: Math.round(size * (34 / 15)) };
  measures.set(key, record);
  return record;
}

function labelTexture(text, size, colour) {
  const key = `${size}|${colour}|${text}`;
  if (textures.has(key)) return textures.get(key);
  const { width, height } = measureLabel(text, size);
  const backing = 4;
  const canvas = document.createElement("canvas");
  canvas.width = width * backing;
  canvas.height = height * backing;
  const ctx = canvas.getContext("2d");
  ctx.scale(backing, backing);

  const r = CHIP.radius;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(9, 14, 24, 0.72)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.lineTo(width - r, 1);
  ctx.quadraticCurveTo(width - 1, 1, width - 1, r);
  ctx.lineTo(width - 1, height - r - 1);
  ctx.quadraticCurveTo(width - 1, height - 1, width - r, height - 1);
  ctx.lineTo(r, height - 1);
  ctx.quadraticCurveTo(1, height - 1, 1, height - r);
  ctx.lineTo(1, r);
  ctx.quadraticCurveTo(1, 1, r, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colour;
  ctx.fillRect(r + 1, 4, CHIP.accent - 1, height - 8);

  ctx.font = chipFont(size);
  ctx.fillStyle = "rgba(242, 247, 250, 0.96)";
  ctx.fillText(text, CHIP.bodyLeft, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const record = { texture, width, height };
  textures.set(key, record);
  return record;
}

/**
 * The marker under a name: one white disc, tinted per label.
 *
 * One texture for every dot, coloured by the sprite material rather than
 * redrawn per colour -- a canvas each would be forty textures for a thing that
 * is a circle. The dark ring is drawn INTO it, because a dot in a pale colour
 * on a pale basemap has no edge otherwise.
 */
function dot() {
  if (dotTexture) return dotTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = size * 0.1;
  ctx.strokeStyle = "rgba(6, 3, 14, 0.85)";
  ctx.stroke();
  dotTexture = new THREE.CanvasTexture(canvas);
  dotTexture.needsUpdate = true;
  return dotTexture;
}

/* ── colour ───────────────────────────────────────────────────────────────── */

/**
 * The colour the LAYER gives this feature, so a name matches what it names.
 *
 * Read from `legendInfo`, which both paints write: the categorical path leaves
 * `values` beside `palette`, and the graduated one leaves `breaks`. Neither is
 * recomputed here -- a second derivation of the same colours is two things
 * that can disagree, and the one that would be wrong is the one drawn on top.
 */
function colourFor(layer, feature) {
  const info = layer?.legendInfo;
  const field = info?.field;
  if (!field || !Array.isArray(info.palette) || !info.palette.length) return DEFAULT_COLOUR;
  const raw = feature?.properties?.[field];
  if (raw == null || String(raw).trim() === "") return DEFAULT_COLOUR;
  if (Array.isArray(info.values) && info.values.length) {
    const i = info.values.indexOf(String(raw));
    // A value in the "other" class has no swatch of its own; the layer draws
    // it in the other row's colour, and so does its name.
    if (i >= 0) return `#${String(info.palette[i]).replace("#", "")}`;
    return DEFAULT_COLOUR;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Array.isArray(info.breaks)) return DEFAULT_COLOUR;
  let klass = 0;
  while (klass < info.breaks.length && n >= info.breaks[klass]) klass += 1;
  const hex = info.palette[Math.min(klass, info.palette.length - 1)];
  return hex ? `#${String(hex).replace("#", "")}` : DEFAULT_COLOUR;
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
/**
 * Do two candidates collide?
 *
 * By their RECTANGLES when both carry one, because a label is a box: "Campi
 * Flegrei" is 110 px of chip and its dot is 46 px from Vesuvius's, so a
 * circular claim round each dot passed them both and the map read
 * "Campi FleVesuvius". A radius cannot express a word.
 *
 * The circle stays as the fallback for a caller that knows only a point -- it
 * is the honest answer when there is no box to test.
 */
const PAD = 6;

function overlaps(a, b, claim) {
  if (a.rect && b.rect) {
    // 6 px of air, not 2: chips that merely touch read as one run-on label,
    // which is the thing the boxes were introduced to stop.
    return a.rect.left - PAD < b.rect.right && a.rect.right + PAD > b.rect.left
      && a.rect.top - PAD < b.rect.bottom && a.rect.bottom + PAD > b.rect.top;
  }
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const room = Math.max(a.claim || claim, b.claim || claim);
  return dx * dx + dy * dy < room * room;
}

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
    //
    // A candidate may carry its OWN claim -- a rank-5 name is set larger and
    // needs more room than a rank-1 -- and the pair is separated by the LARGER
    // of the two, or the big one would be held off the small one while the
    // small one was free to sit under the big one's descenders.
    const clash = kept.some((k) => overlaps(k, candidate, claim));
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
  const record = { node, layer, marks: new Map(), hits: [] };
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
    const tier = tierFor(rank);
    const name = feature.properties.name;
    const size = measureLabel(String(name || ""), tier.size);
    /**
     * Where the CHIP will be, in the same terms the renderer will put it.
     *
     * The leader goes up and right by a fixed number of pixels, so the box is
     * that offset plus the measured chip -- one formula used by the declutter,
     * by the click target and by the draw, so all three agree about where a
     * label is.
     */
    candidates.push({
      index,
      rank,
      x,
      y,
      visible: true,
      claim: tier.claim,
      size,
      // The chip's own box: bottom-left on the dot, extending up and right.
      // Exactly what the renderer does below, so the space reserved and the
      // space used are one formula rather than two that drift.
      rect: {
        left: x,
        right: x + size.width,
        top: y - size.height,
        bottom: y,
      },
      tier,
      colour: colourFor(record.layer, feature),
      fromCentre: Math.hypot(x - centre.x, y - centre.y),
      name,
      lat: coords[1],
      lon: coords[0],
    });
  });

  const kept = chooseLabels(candidates);
  const wanted = new Set(kept.map((k) => k.index));

  // Drop what is no longer chosen. The parts are cheap to rebuild and holding
  // 2,666 of them hidden is 2,666 draw calls the renderer still walks.
  record.marks.forEach((mark, index) => {
    if (wanted.has(index)) return;
    disposeMark(record, mark);
    record.marks.delete(index);
  });

  const base = record.layer.object3D?.renderOrder || 0;
  const hits = [];
  kept.forEach((candidate) => {
    let mark = record.marks.get(candidate.index);
    const wanted3 = `${candidate.tier.size}|${candidate.colour}`;
    if (mark && mark.style !== wanted3) { disposeMark(record, mark); mark = null; }
    if (!mark) {
      mark = buildMark(record, candidate);
      record.marks.set(candidate.index, mark);
    }

    const anchor = project(viewer, candidate.lat, candidate.lon);

    mark.dot.position.copy(anchor);
    // A pixel is a pixel on both axes: see the note on the chip scale below.
    const across = candidate.tier.dot * 2;
    mark.dot.scale.set((across / rect.width) * 2, (across / rect.height) * 2, 1);
    mark.dot.renderOrder = base + 0.2;

    /**
     * The chip is placed at the DOT and offset in screen space by its centre.
     *
     * It was offset in world space instead -- east and up along the surface --
     * and that is not the same direction on screen at every latitude and every
     * camera roll. The declutter reserved a box up and to the right; the chip
     * landed somewhere else; and the two disagreed by enough that names
     * overlapped anyway, which is the exact fault the rectangles were added to
     * fix. `sprite.center` moves a screen-space sprite in fractions of its own
     * size, so the offset is exact and orientation cannot enter into it.
     */
    mark.sprite.position.copy(anchor);
    /**
     * `sizeAttenuation: false` sizes a sprite in CLIP space, not pixels.
     *
     * A scale of 1 fills the viewport, so a pixel size becomes a fraction of
     * the canvas -- and the two axes have DIFFERENT canvases. x spans the
     * width and y the height, so a width taken as `height x aspect` is
     * stretched by the viewport's own aspect ratio: measured at 1113 x 851, a
     * 268 px name was drawn 350 px wide, 31% too long, and every label was
     * wide and soft. It read as "the labels are too big", because that is what
     * it looks like. Each axis is converted against its own dimension.
     */
    const chipW = candidate.size.width;
    const chipH = candidate.size.height;
    mark.sprite.scale.set((chipW / rect.width) * 2, (chipH / rect.height) * 2, 1);
    /**
     * Lower-left corner ON the dot, and no offset beyond that.
     *
     * `center` is the point of the sprite that sits at the position, so (0, 0)
     * puts the chip's bottom-left there and the chip extends up and to the
     * right -- which is the placement, and the whole placement. An extra
     * offset had to be expressed as a fraction of the chip's own size, and a
     * fraction of 34 px is not the same nudge as a fraction of 243 px: wide
     * names flew further from their dots than short ones, by up to 100 px.
     */
    mark.sprite.center.set(0, 0);
    mark.sprite.renderOrder = base + 0.25;

    /**
     * Where the CHIP is on screen, so clicking it can raise the card.
     *
     * The rectangle the declutter reserved, not a second derivation of it:
     * the name is drawn off its point, so the canvas hit-test under the text
     * finds open ocean, and this is the only place that knows the two are
     * connected.
     */
    hits.push({ ...candidate.rect, lat: candidate.lat, lon: candidate.lon });
  });
  record.hits = hits;
  record.visible = kept.length;
}

/** One name: its dot, its leader and the type, built together and dropped together. */
function buildMark(record, candidate) {
  const { texture, width, height } = labelTexture(
    candidate.name, candidate.tier.size, candidate.colour,
  );
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: true, depthWrite: false,
    sizeAttenuation: false,
  }));
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dot(), color: new THREE.Color(candidate.colour), transparent: true,
    depthTest: true, depthWrite: false, sizeAttenuation: false,
  }));
  /**
   * NO LEADER LINE, and that is the reference implementation's own answer.
   *
   * A line needs both its ends in one coordinate system. The dot is on the
   * globe and the chip is placed in screen space, so a world-space line
   * between them is a guess that is wrong wherever the two frames disagree --
   * which is most latitudes. The Moon viewer's own labels read fine without
   * one: a dot with its chip 19 px up and to the right is unambiguous, and the
   * accent bar on the chip's left edge points back at it.
   */
  record.node.add(marker, sprite);
  return {
    sprite, dot: marker,
    aspect: width / height, labelHeight: height,
    style: `${candidate.tier.size}|${candidate.colour}`,
  };
}

function disposeMark(record, mark) {
  [mark.sprite, mark.dot].forEach((node) => {
    record.node.remove(node);
    node.material?.dispose?.();
  });
  // The chip textures are shared through the cache and must NOT be disposed.
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
      record.marks.forEach((mark) => disposeMark(record, mark));
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

/**
 * A click on a NAME raises the card its dot would.
 *
 * In the CAPTURE phase and on the window, so it runs before `feature-popup`'s
 * own listener on the canvas: that one asks the viewer what lat/lon is under
 * the pixel, which for a label offset from its point is whatever the leader is
 * pointing away from — open ocean, usually, and the card it raised was no card
 * at all. Suppressing it afterwards is what stops the two answering the same
 * click.
 *
 * The rectangles come from the last refresh, which is at most 200 ms old and
 * is the same set the reader can see.
 */
function clickedLabel(event) {
  const canvas = window.GeoIDViewer?.renderer?.domElement;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  for (const record of layers.values()) {
    if (record.node?.visible === false) continue;
    for (const hit of record.hits || []) {
      if (x >= hit.left && x <= hit.right && y >= hit.top && y <= hit.bottom) return hit;
    }
  }
  return null;
}

function installLabelClicks() {
  window.addEventListener("click", (event) => {
    if (!layers.size) return;
    const hit = clickedLabel(event);
    if (!hit) return;
    const popup = window.GeoIDFeaturePopup;
    if (!popup?.openFeatureCard) return;
    if (!popup.openFeatureCard(hit.lat, hit.lon, { x: event.clientX, y: event.clientY })) return;
    // The canvas listener is next; it would answer the same click with a
    // reading taken from under the TEXT rather than from under the dot.
    popup.suppress?.(400);
    event.stopPropagation();
  }, true);
}

if (typeof window !== "undefined") {
  // The camera moves without telling anyone, so the label set is re-chosen on
  // a slow poll rather than hooked to an event that does not exist. 200 ms is
  // below the point where a label visibly lags the dot it names.
  window.setInterval(() => { if (layers.size) schedule(); }, 200);
  installLabelClicks();
  window.GeoIDPointLabels = { setLabels, isLabelled, canLabel, chooseLabels };
}
