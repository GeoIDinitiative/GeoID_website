/**
 * How strongly a layer LANDS, decided by what it draws rather than by who
 * loaded it.
 *
 * A filled area is a claim over ground: draw one at full strength and it hides
 * the map it was loaded to be read AGAINST, which is the ordinary reason
 * anybody loads a second layer at all. A mark is the opposite — a dot is a few
 * pixels wide, it hides nothing, and fading it only makes it harder to see.
 * So areas open at half and marks open solid, and the rule is stated once here
 * instead of being a number typed into each panel that happens to load
 * something.
 *
 * THIS ONLY EVER FADES. `defaultOpacityFor` returns 1 for everything it cannot
 * confidently call an area, and the caller is expected to leave a layer alone
 * at 1 rather than to set it — two reasons, and the second is a real fault:
 *
 *   1. Untouched means the reader's own slider and every restore path behave
 *      exactly as they did before this file existed.
 *   2. `setOpacity` SCALES what an element was drawn at, and only the contact
 *      seal records a weight of its own (`baseOpacity`). The line buffer is
 *      built at 0.9 and records nothing, so setting a layer to 1 PROMOTES its
 *      lines to full — the same shape as the fault that made contacts get
 *      heavier as a sheet faded. A rule that never sets 1 cannot promote
 *      anything.
 *
 * Kept pure and DOM-free so it can be pinned in Node: what counts as an area
 * is the sort of judgement that drifts silently.
 */

/** A filled area opens at half, so whatever is under it is still readable. */
export const AREA_OPACITY = 0.5;

/** A dot, a line, a picture: nothing to see through, so nothing to fade. */
export const MARK_OPACITY = 1;

/**
 * Does this layer paint ground, as opposed to marking it?
 *
 * Three things are deliberately NOT areas:
 *
 * - **A raster.** A drape is a picture of a measurement, and half a picture
 *   over a basemap is two maps averaged rather than one map read.
 * - **An OUTLINED polygon layer.** A drawn study area is polygons and is drawn
 *   as an edge; the whole point of the outline mode is that it does not cover
 *   the ground it encloses. Fading it just makes the boundary harder to see.
 * - **A layer with no features in hand.** A tiled layer's `features` is a
 *   SNAPSHOT and is routinely empty at the moment it registers — measured, a
 *   GLiM layer reporting nothing while its tiles held half a million polygons.
 *   Guessing from an empty list would fade some sessions and not others, so a
 *   tiled sheet states its own opening strength on its catalogue entry.
 */
export function drawsFilledAreas(layer) {
  if (!layer) return false;
  if (layer.raster) return false;
  const mode = layer.getFillMode?.() || layer.fillMode || "solid";
  if (mode === "outline") return false;
  const features = layer.features || layer.collection?.features;
  if (!Array.isArray(features) || !features.length) return false;
  // Short-circuits on the first polygon, so a mixed collection costs nothing;
  // an all-point catalogue is walked once, at import, and never again.
  return features.some((f) => String(f?.geometry?.type || "").includes("Polygon"));
}

/**
 * The opacity a layer should land at, given nobody has said otherwise.
 *
 * `MARK_OPACITY` here means "no opinion" as much as it means solid: see the
 * header on why a caller should read that as "leave it alone".
 */
export function defaultOpacityFor(layer) {
  return drawsFilledAreas(layer) ? AREA_OPACITY : MARK_OPACITY;
}

/**
 * Wear an opacity, across everything a layer has drawn.
 *
 * ONE implementation, because there are two callers and they used to be three
 * copies that disagreed. The layer row's slider is the obvious one; the other
 * is a vector layer's own REPAINT, which replaces every child of its group
 * with freshly built materials — so a sheet faded to 40% and then re-coloured
 * came back solid while its slider still read 0.4. Same shape as a streaming
 * layer's next tile arriving at the old weight, which is why the tiler is told
 * as well.
 *
 * Two rules ride in here rather than in either caller:
 *
 * - **Blending is switched ON when it is needed and never OFF again.** Taking
 *   a layer back to 100% used to make it opaque, and the renderer draws every
 *   opaque object before every transparent one with no `renderOrder` crossing
 *   between the two — so a layer dragged up to full disappeared under the
 *   sheet beneath it, and a point cloud drawn three metres above the ground
 *   stopped being drawn at all.
 * - **An element's own weight is SCALED, not replaced.** The contact stroke is
 *   drawn subtly on purpose; overwriting it meant fading a sheet to 40%
 *   PROMOTED its 25% contacts to 40%, the boundaries getting heavier as the
 *   map faded. `baseOpacity` defaults to 1, so anything with no weight of its
 *   own is unaffected.
 */
export function paintOpacity(object3D, value) {
  if (!object3D?.traverse) return;
  object3D.traverse((node) => {
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      if (value < 0.999) material.transparent = true;
      const base = Number.isFinite(material.userData?.baseOpacity)
        ? material.userData.baseOpacity : 1;
      material.opacity = value * base;
      material.needsUpdate = true;
    });
  });
}
