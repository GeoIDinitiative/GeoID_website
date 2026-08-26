/**
 * Names on a point layer, drawn by the VIEWER'S own label engine.
 *
 * This module used to draw its own labels — its own chip texture, its own
 * spacing, its own click handling — and it looked like a different app bolted
 * onto this one: chips overflowing the screen, names overlapping, none of the
 * polish of the curated labels an arm's length away on the same globe. All of
 * that machinery is gone. `earth-viewer.js` exposes `addSurfaceLabels`, which
 * feeds items through the SAME `buildLabelLayer` the curated volcanic-feature
 * labels use, into the same per-frame declutter, with the same click path to
 * the same card in the corner. What is left here is a translation: a GeoJSON
 * feature becomes the item shape that engine reads, and nothing more.
 *
 * The two knobs the engine honours per item:
 *
 * - **`priority` from `label_rank`.** The engine's LOD filter keeps only the
 *   top priorities when zoomed out and admits lower ranks as the camera comes
 *   in — hierarchy by significance, using the ranking the data itself carries
 *   (for volcanoes, eruption recency).
 * - **`label_scale` from `label_rank`.** A rank-5 name is set larger than a
 *   rank-1, so a crowded arc reads its own hierarchy at a glance.
 *
 * Clicking a label opens the viewer's scene popup — the card in the corner
 * with the kicker, the description and the detail rows — because the entries
 * ARE the viewer's entries and their hit targets ride its raycaster.
 */

/**
 * The detail slider's five positions, as what each one MEANS.
 *
 * Rank only, no count cap. There WAS a cap, and it cut Vesuvius: level 3
 * admitted rank ≥ 3 but kept the 360 most recent, and 1944 is old among the
 * volcanoes that erupted since 1900 — so the one volcano somebody flew to
 * Naples for had no label while Whakaari did. A level must mean what its
 * caption says. The texture bill this used to bound is paid instead by
 * `label_backing: 2` on the items: half the backing store is a quarter of
 * the memory, and a chip drawn at 34 px from a 68 px mipmapped texture is
 * still sharp.
 */
export const DETAIL_LEVELS = {
  1: { minRank: 5 },
  2: { minRank: 4 },
  3: { minRank: 3 },
  4: { minRank: 2 },
  5: { minRank: 1 },
};
export const DEFAULT_DETAIL = 3;

/**
 * What each position admits — the caption under the slider.
 *
 * The words follow `label_rank`'s own bands in bake-volcanoes.py (5: erupted
 * since 2000, 4: since 1900, 3: since 1500, 2: any dated Holocene eruption,
 * 1: Holocene undated), so the slider says what the ranking means rather than
 * inventing a second description of it.
 */
export const DETAIL_COPY = {
  1: "Erupted since 2000",
  2: "Erupted since 1900",
  3: "Erupted since 1500",
  4: "Any dated Holocene eruption",
  5: "Every Holocene volcano",
};

/** A legend hex ("4e79a7" or "#4e79a7") as rgba at the given alpha. */
function rgba(hex, alpha) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The colour the LAYER'S OWN LEGEND gives this feature.
 *
 * The legend beside the map already explains the type colours — blue
 * stratovolcano, orange shield — so the label wears the same one rather than
 * a second vocabulary. Read from `legendInfo`, which the symbology paint
 * writes, and never recomputed: two derivations of the same colours are two
 * things that can disagree, and the one that would be wrong is the one drawn
 * on top.
 */
function legendColour(legend, properties) {
  const field = legend?.field;
  if (!field || !Array.isArray(legend.values) || !Array.isArray(legend.palette)) return null;
  const raw = properties?.[field];
  if (raw == null) return null;
  const i = legend.values.indexOf(String(raw));
  if (i < 0 || !legend.palette[i]) return null;
  return `#${String(legend.palette[i]).replace("#", "")}`;
}

/**
 * A GeoJSON point feature as the item the viewer's label builder reads.
 *
 * Pure and exported for the tests: the mapping is now the whole behaviour of
 * this module, and the field names on the right are the CONTRACT with
 * `openFeature` — `type` becomes the card's kicker, `description` its copy,
 * `rock_type` and `region` its detail rows.
 */
/**
 * One feature as the item the viewer's card and label builder read.
 *
 * Shared by the labels (which filter by rank first) and by the click on an
 * UNLABELLED dot (which does not): both must produce the same card for the
 * same volcano, so both go through the same mapping.
 */
export function featureToItem(feature, legend = null) {
  const p = feature?.properties || {};
  const coords = feature?.geometry?.coordinates;
  if (!coords || !p.name) return null;
  const rank = Number(p.label_rank) || 0;
  const colour = legendColour(legend, p);
  return {
    name: String(p.name),
    // The kicker: "Stratovolcano", not the generic "Volcanic Feature".
    type: p.volcano_type || p.type_group || "Volcano",
    lat: coords[1],
    lon: coords[0],
    theme: "volcanic",
    // Governed by the Names button that added these, not by the Locations
    // checkboxes — see the category clause in updateLabelVisibility.
    category: "dataset",
    priority: rank,
    // Rank as size: 0.91 at rank 1 up to 1.15 at rank 5. Subtle on
    // purpose — the hierarchy should be readable, not a headline.
    label_scale: 0.85 + rank * 0.06,
    /**
     * Close to the dot, because there are hundreds of these.
     *
     * The curated default (0.52 world units) was set for ~45 labels read
     * from orbit, where a long leader declutters a whole hemisphere. At a
     * continental zoom it is ~600 px — measured: Aira's name at x=-542
     * for a dot on Kyushu mid-screen, every Japanese label off the left
     * edge of the canvas while its volcano sat in view. A dense dataset
     * wants its names AT its dots and leaves the spreading-out to the
     * engine's fit-and-overlap passes, which already know the screen.
     */
    label_distance: 0.14,
    description: p.summary || "",
    elevation_m: Number.isFinite(Number(p.elevation_m)) ? Number(p.elevation_m) : undefined,
    rock_type: p.rock_type || undefined,
    region: p.region || undefined,
    // The legend's colour for this feature, worn by the marker, the
    // leader line and the chip's accent bar. Absent, the volcanic theme's
    // red stands — which is also what the curated labels wear.
    label_colour: colour || undefined,
    label_palette: colour ? {
      bg: "rgba(10, 12, 20, 0.74)",
      stroke: rgba(colour, 0.55),
      accent: colour,
      title: "rgba(245, 247, 252, 0.96)",
    } : undefined,
    // Half the curated backing store: see DETAIL_LEVELS on why the count is
    // unbounded and the memory is bounded here instead.
    label_backing: 2,
    // Not read by the card; carried so a caller's cap can prefer the most
    // recently active among equal ranks.
    last_eruption: Number(p.last_eruption),
  };
}

export function toLabelItems(features, { max = Infinity, minRank = 1, legend = null } = {}) {
  return (features || [])
    .map((feature) => {
      const rank = Number(feature?.properties?.label_rank) || 0;
      if (rank < minRank || rank <= 0) return null;
      return featureToItem(feature, legend);
    })
    .filter(Boolean)
    // The cap keeps the MOST significant: rank first, then the most recently
    // active — the same order the ranking itself was built from.
    .sort((a, b) => (b.priority - a.priority)
      || ((Number.isFinite(b.last_eruption) ? b.last_eruption : -1e9)
        - (Number.isFinite(a.last_eruption) ? a.last_eruption : -1e9)))
    .slice(0, max);
}

/* ── wiring one layer to the viewer ──────────────────────────────────────── */

/** layer.id → { handle, level } — present means the user asked for names. */
const active = new Map();

/** Levels chosen before the Names button was pressed, honoured when it is. */
const chosenLevel = new Map();

/** The items a layer gets at a detail level, colours from its own legend. */
function itemsFor(layer, level) {
  const detail = DETAIL_LEVELS[level] || DETAIL_LEVELS[DEFAULT_DETAIL];
  return toLabelItems(layer.features, { ...detail, legend: layer.legendInfo });
}

function viewerSeam() {
  const viewer = window.GeoIDViewer;
  return typeof viewer?.addSurfaceLabels === "function" ? viewer : null;
}

/**
 * Keep the labels in step with the layer they name.
 *
 * The layer box can hide or remove a layer without asking this module, and
 * labels for an invisible layer are labels for nothing. Re-adding on re-show
 * rebuilds the textures, a one-off cost paid only when somebody actually
 * brings the layer back.
 */
function sync() {
  const layers = window.GeoIDImportManager?.getLayers?.() || [];
  active.forEach((state, layerId) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) {
      state.handle?.remove();
      active.delete(layerId);
      return;
    }
    const shouldShow = layer.status === "loaded" && layer.visible !== false;
    if (shouldShow && !state.handle) {
      state.handle = viewerSeam()?.addSurfaceLabels(itemsFor(layer, state.level)) || null;
    } else if (!shouldShow && state.handle) {
      state.handle.remove();
      state.handle = null;
    }
  });
}

/**
 * Turn labels on for a layer, or off.
 *
 * Any point layer carrying `label_rank` can use this; the volcanoes are the
 * first, and cities or named landforms would need nothing added.
 */
export async function setLabels(layer, on, { level = null } = {}) {
  if (!layer) return false;
  const state = active.get(layer.id);
  if (!on) {
    state?.handle?.remove();
    active.delete(layer.id);
    return false;
  }
  if (state) return true;
  const viewer = viewerSeam();
  if (!viewer) return false;
  const wanted = level ?? chosenLevel.get(layer.id) ?? DEFAULT_DETAIL;
  const items = itemsFor(layer, wanted);
  if (!items.length) return false;
  const handle = viewer.addSurfaceLabels(items);
  if (!handle) return false;
  active.set(layer.id, { handle, level: wanted });
  return true;
}

/**
 * Move a labelled layer to another detail level.
 *
 * A REBUILD, not a filter: the deeper levels have labels the shallower ones
 * never built, so the set is taken down and put back with the new one's
 * items. That is a few hundred canvas textures, which is why this listens to
 * the slider's `change` and not its `input` — one rebuild per release, not
 * one per pixel of drag.
 *
 * On a layer whose labels are OFF it only records the level, so the slider
 * can be set before the Names button without turning the names on uninvited.
 */
export function setDetailLevel(layer, level) {
  if (!layer || !DETAIL_LEVELS[level]) return false;
  chosenLevel.set(layer.id, level);
  const state = active.get(layer.id);
  if (!state) return false;
  if (state.level === level) return true;
  state.level = level;
  if (state.handle) {
    state.handle.remove();
    state.handle = viewerSeam()?.addSurfaceLabels(itemsFor(layer, level)) || null;
  }
  return true;
}

export const detailLevelOf = (layer) =>
  active.get(layer?.id)?.level ?? chosenLevel.get(layer?.id) ?? DEFAULT_DETAIL;

export const isLabelled = (layer) => active.has(layer?.id);

/**
 * The scene-card item for a clicked feature, if this layer is the kind whose
 * points get one.
 *
 * "The kind" is decided by the DATA — a layer whose features carry
 * `label_rank` is a catalogue of nameable places — and not by whether this
 * particular point ranked high enough for a label: the click on a Pleistocene
 * volcano deserves the same card as the click on Vesuvius.
 */
export function sceneItemFor(layer, feature) {
  if (!layer || !feature) return null;
  if (!/Point$/.test(feature.geometry?.type || "")) return null;
  if (!canLabel(layer)) return null;
  return featureToItem(feature, layer.legendInfo);
}

/** Whether a layer has anything to label at all — for offering the control. */
export const canLabel = (layer) =>
  (layer?.features || []).some((f) => Number(f?.properties?.label_rank) > 0);

if (typeof window !== "undefined") {
  window.GeoIDImportManager?.onChange?.(sync);
  window.addEventListener("geoid-gis:layers-changed", sync);
  window.GeoIDPointLabels = {
    setLabels, setDetailLevel, detailLevelOf, isLabelled, canLabel,
    toLabelItems, featureToItem, sceneItemFor,
    DETAIL_LEVELS, DETAIL_COPY, DEFAULT_DETAIL,
  };
}
