/**
 * "Which patch of ground?" — asked once, answered the same way everywhere.
 *
 * The weather card grew a good answer to this: use the box on the globe if
 * there is one, else the last one somebody CAPTURED, else arm the Draw tool
 * and say so — and offer every drawn polygon still on the globe BY NAME, so
 * reusing "Fetch Polygon 1" is a choice rather than a guess about which one a
 * fallback would take. Earth Engine had a third of that: a "Drawn polygon"
 * option that read the live overlay and returned null when there wasn't one,
 * which is a dead end wearing the clothes of a control.
 *
 * This is that answer lifted out so both ask it. Not copied — copied is how
 * the polygon-area formula came to be wrong in ten files, and how the credit
 * and the licence lines came to describe different maps. One implementation,
 * two callers.
 *
 * Everything here speaks SIGNED degrees (`{west, south, east, north}`,
 * −180..180). The viewer carries east-positive 0–360, so anything read off it
 * is converted on the way out — unconverted, an extent over Sicily records as
 * longitude 315 and reads as mid-Atlantic downstream, which is the same trap
 * `signedLon` in bridge.js exists for.
 */
import { ringsFromCollection, maskFromRings } from "./extraction.js?v=20260831-cc12052";

const byId = (id) => document.getElementById(id);

/** Viewer longitude (0–360 east) to the signed degrees every file format wants. */
export const signedLon = (lon) => ((lon + 540) % 360) - 180;

/**
 * The drawn shapes that are still on the globe.
 *
 * Three ways a layer earns its place, because three paths create them: the
 * weather card stamps `weatherExtent`, `captureDrawn` files them as `drawn`,
 * and anything carrying a `drawn_at` on its first feature came from the draw
 * tools too. The ring check is not decoration — a layer mid-import has a name
 * and no coordinates, and listing it offers an extent that resolves to null.
 */
export function drawnPolygonLayers() {
  return (window.GeoIDImportManager?.getLayers?.() || [])
    .filter((layer) => (
      layer.weatherExtent
      || layer.ext === "drawn"
      || layer.collection?.features?.[0]?.properties?.drawn_at)
      && layer.collection?.features?.[0]?.geometry?.coordinates?.[0]?.length);
}

/** A saved polygon layer's bounding box, already signed (GeoJSON always is). */
export function layerBounds(layer) {
  const ring = layer?.collection?.features?.[0]?.geometry?.coordinates?.[0];
  if (!ring?.length) return null;
  const lons = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  return {
    west: Math.min(...lons), south: Math.min(...lats),
    east: Math.max(...lons), north: Math.max(...lats),
    reusedFrom: layer.name,
  };
}

/** The newest VISIBLE drawn polygon — the no-overlay fallback. */
export function capturedExtentBounds() {
  const layers = drawnPolygonLayers().filter((layer) => layer.visible !== false);
  return layers.length ? layerBounds(layers[layers.length - 1]) : null;
}

/** The live drawing overlay's bounds, or null when nothing is drawn. */
export function drawnOverlayBounds() {
  const vertices = window.GeoIDViewer?.getExtractionGeometry?.()?.vertices;
  if (!vertices?.length) return null;
  const lats = vertices.map((v) => v.lat);
  const lons = vertices.map((v) => signedLon(v.lon));
  return {
    west: Math.min(...lons), south: Math.min(...lats),
    east: Math.max(...lons), north: Math.max(...lats),
  };
}

/**
 * Raise the drawer rather than telling somebody to go and find it.
 *
 * The tool rail's own Draw button, so there is one drawer and one way it is
 * armed — the same press a hand on the rail would make.
 */
export function promptDrawTool() {
  const button = byId("tool-rail-area");
  if (button && !button.classList.contains("is-active")) button.click();
  return Boolean(button);
}

/**
 * The study-area STATS card is furniture from the analysis flow; while a fetch
 * owns the box it covers the very corner the fetch reports into, so it stands
 * down. A hand-drawn area keeps it.
 */
export function hideAreaCard() {
  const card = byId("measurement-result-card");
  if (card) card.hidden = true;
}

/**
 * Resolve the polygon half of an extent choice.
 *
 * Two modes, and the fallback chain is the whole point of the second:
 *
 *   `layer:<id>`  a named polygon somebody chose — exact, no guessing
 *   `drawn`       the live overlay, else the last captured one, else arm the
 *                 Draw tool and say so
 *
 * Returns signed bounds, or `{ error }` with a sentence fit to show a user.
 * Anything else returns null, so a caller keeps its own modes (Earth Engine
 * has "global" and "current view"; the weather card has typed bounds and a
 * box by size) without this module knowing about them.
 */
export function resolvePolygonExtent(mode, { arm = true } = {}) {
  if (typeof mode === "string" && mode.startsWith("layer:")) {
    const id = mode.slice(6);
    const drawnLayer = drawnPolygonLayers().find((l) => String(l.id) === id);
    if (drawnLayer) return layerBounds(drawnLayer);
    /**
     * Any other loaded layer answers with its BOUNDING BOX. The bounds the
     * import manager stamps are `{minX..maxY}` in signed degrees (measured:
     * `collectionBounds` on a UK box returns minX −10); this module speaks
     * `{west..north}`, so the shape converts here rather than leaking two
     * bound vocabularies to every caller — the exact trap `drape()` documents.
     */
    const layer = (window.GeoIDImportManager?.getLayers?.() || [])
      .find((l) => String(l.id) === id);
    const b = layer?.bounds;
    if (!layer || !b) return { error: "That layer is no longer on the globe — pick another extent." };
    return {
      west: Number(b.minX ?? b.west), south: Number(b.minY ?? b.south),
      east: Number(b.maxX ?? b.east), north: Number(b.maxY ?? b.north),
      reusedFrom: layer.name,
    };
  }
  if (mode !== "drawn" && mode !== "polygon") return null;
  const live = drawnOverlayBounds();
  if (live) return live;
  const kept = capturedExtentBounds();
  if (kept) return kept;
  if (arm) promptDrawTool();
  return {
    error: arm
      ? "Draw the area on the globe — the Draw tool is now active — then request again."
      : "Nothing is drawn yet. Draw an area on the globe first.",
  };
}

/**
 * The same choice, answered as RINGS rather than as a box.
 *
 * Two shapes of answer, one chain. A fetcher wants a bounding box because that
 * is what a tile service takes; a CLIP wants the polygon itself, and giving it
 * a box would quietly widen every study area to its own extent. So the modes,
 * the option list and above all the FALLBACK are shared, and only the shape of
 * the answer differs.
 *
 * The fallback is what this was missing. Extraction resolved "the drawn area"
 * from the LIVE overlay alone — and pressing Done captures the shape and
 * clears that overlay, so the moment a drawing became a real layer the panel
 * answered "Mark out an area first" about a polygon sitting in front of the
 * user. A shape you already drew is the commonest case there is.
 */
export function resolvePolygonRings(mode, { arm = true } = {}) {
  const fromLayer = (layer) => {
    if (!layer?.collection) {
      return { error: "That bounds layer is no longer loaded — pick another." };
    }
    const rings = ringsFromCollection(layer.collection);
    if (!rings.length) return { error: "That layer holds no polygons to bound with." };
    // The layer's OWN collection is the mask, holes and all -- rebuilding it
    // from the rings would be a second copy of the same polygons.
    return { label: layer.name, rings, maskFc: layer.collection, layerId: String(layer.id) };
  };

  if (typeof mode === "string" && mode.startsWith("layer:")) {
    const id = mode.slice(6);
    return fromLayer((window.GeoIDImportManager?.getLayers?.() || [])
      .find((l) => String(l.id) === id));
  }
  if (mode !== "drawn" && mode !== "polygon") return null;

  // 1. whatever the Draw tool is holding right now
  const viewer = window.GeoIDViewer;
  const geometry = viewer?.getExtractionGeometry?.("study")
    || viewer?.getExtractionGeometry?.("buffer");
  if (geometry?.vertices?.length) {
    const rings = [{ vertices: geometry.vertices, holes: [], center: geometry.center }];
    return { label: "the drawn area", rings, maskFc: maskFromRings(rings), layerId: null };
  }
  // 2. the last drawn polygon still ON the globe -- captured, but right there
  const kept = drawnPolygonLayers().filter((l) => l.visible !== false);
  if (kept.length) return fromLayer(kept[kept.length - 1]);
  // 3. nothing to work with: raise the tool rather than describing where it is
  if (arm) promptDrawTool();
  return {
    error: arm
      ? "Draw the area on the globe — the Draw tool is now active — then run again."
      : "Nothing is drawn yet. Draw an area on the globe first.",
  };
}

/**
 * Put every drawn polygon into a `<select>` by name, and keep the choice.
 *
 * The options are rebuilt on every layer change, so the element cannot hold
 * the state — the same reason the catalogue dropdowns keep theirs in a module
 * Map. A choice whose layer has since been removed falls back to `fallback`
 * rather than leaving the select pointing at an id nothing answers to.
 */
export function refreshPolygonOptions(select, fallback = "drawn", { allLayers = false } = {}) {
  if (!select) return;
  const chosen = select.value;
  select.querySelectorAll("option[data-polygon]").forEach((option) => option.remove());
  const drawn = drawnPolygonLayers();
  drawn.forEach((layer) => {
    const option = document.createElement("option");
    option.value = `layer:${layer.id}`;
    option.dataset.polygon = "1";
    option.textContent = `▱ ${layer.name}`;
    select.appendChild(option);
  });
  /**
   * EVERY loaded vector layer as an extent, not only the drawn ones.
   *
   * The GFS card's rule, kept when that card went: "a polygon you already
   * have is the commonest case and was the one with no way to express it".
   * A coastline, an imported shapefile or a catalogue layer is a perfectly
   * good answer to "over where?", by its bounding box. The drawn shapes keep
   * their ▱ and come first — they are the deliberate extents.
   */
  if (allLayers) {
    const drawnIds = new Set(drawn.map((l) => String(l.id)));
    (window.GeoIDImportManager?.getLayers?.() || [])
      .filter((l) => l.status === "loaded" && l.bounds
        && (l.features?.length || l.collection)
        && !drawnIds.has(String(l.id)))
      .forEach((layer) => {
        const option = document.createElement("option");
        option.value = `layer:${layer.id}`;
        option.dataset.polygon = "1";
        option.textContent = layer.name;
        select.appendChild(option);
      });
  }
  select.value = [...select.options].some((option) => option.value === chosen)
    ? chosen : fallback;
}

/**
 * Keep the drawn extent as a real layer once data has been pulled over it.
 *
 * A row in Layer Visibility, relief-hugging (the vector renderer's lines
 * follow the ground where the drawing overlay floats at its display lift),
 * saved to the open project, and reusable — the next fetch finds it by name.
 * `captureDrawn` is idempotent by shape, so refetching the same box never
 * stacks a duplicate. The floating overlay then stands down.
 */
export function persistExtent(bounds, { name, mark = "weatherExtent" } = {}) {
  const label = name || `Fetch extent ${(bounds.east - bounds.west).toFixed(1)}×`
    + `${(bounds.north - bounds.south).toFixed(1)}°`;
  const capture = window.GeoIDDrawnLayers?.captureDrawn?.({ name: label });
  if (capture?.ok && capture.layer) {
    capture.layer[mark] = true;
    window.GeoIDViewer?.clearStudyArea?.();
  }
  hideAreaCard();
  return capture;
}
