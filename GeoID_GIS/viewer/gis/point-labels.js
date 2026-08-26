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
 * How many names one dataset may put up.
 *
 * Every label is a canvas texture on the GPU, built at 4x for crispness: a few
 * hundred is tens of megabytes, and 2,666 would be half a gigabyte for names
 * the declutter would never show anyway. 250 covers every rank-5 volcano with
 * room for the strongest rank-4s, and the LOD spreads them over the zoom
 * range.
 */
const MAX_ITEMS = 250;

/**
 * A GeoJSON point feature as the item the viewer's label builder reads.
 *
 * Pure and exported for the tests: the mapping is now the whole behaviour of
 * this module, and the field names on the right are the CONTRACT with
 * `openFeature` — `type` becomes the card's kicker, `description` its copy,
 * `rock_type` and `region` its detail rows.
 */
export function toLabelItems(features, { max = MAX_ITEMS } = {}) {
  return (features || [])
    .map((feature) => {
      const p = feature?.properties || {};
      const rank = Number(p.label_rank) || 0;
      const coords = feature?.geometry?.coordinates;
      if (rank <= 0 || !coords || !p.name) return null;
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
        description: p.summary || "",
        elevation_m: Number.isFinite(Number(p.elevation_m)) ? Number(p.elevation_m) : undefined,
        rock_type: p.rock_type || undefined,
        region: p.region || undefined,
        // Not read by the card; carried so the cap below can prefer the most
        // recently active among equal ranks.
        last_eruption: Number(p.last_eruption),
      };
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

/** layer.id → { handle } — present means the user asked for names. */
const active = new Map();

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
      state.handle = viewerSeam()?.addSurfaceLabels(toLabelItems(layer.features)) || null;
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
export async function setLabels(layer, on) {
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
  const items = toLabelItems(layer.features);
  if (!items.length) return false;
  const handle = viewer.addSurfaceLabels(items);
  if (!handle) return false;
  active.set(layer.id, { handle });
  return true;
}

export const isLabelled = (layer) => active.has(layer?.id);

/** Whether a layer has anything to label at all — for offering the control. */
export const canLabel = (layer) =>
  (layer?.features || []).some((f) => Number(f?.properties?.label_rank) > 0);

if (typeof window !== "undefined") {
  window.GeoIDImportManager?.onChange?.(sync);
  window.addEventListener("geoid-gis:layers-changed", sync);
  window.GeoIDPointLabels = { setLabels, isLabelled, canLabel, toLabelItems };
}
