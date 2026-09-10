/**
 * THE CUTAWAY IS A PROPERTY OF THE SCENE, NOT A LIST OF MATERIALS.
 *
 * Core View removes half the planet so the interior shells can be read off the
 * cut face. The viewer does that with one world-space clipping plane, and it
 * applied that plane to a HAND-WRITTEN LIST of its own materials: the base
 * texture, the geology sheet, the contacts, the structures, the minerals, the
 * sea, the region mask and the selected unit's outline.
 *
 * Every layer the GIS page puts on the globe was outside that list. Measured
 * live with the cutaway on: the base material carried one plane and the plate
 * boundaries, the live event markers and 312,500 earthquakes carried NONE
 * across 14 materials -- so a coastline, a marker and a dot cloud went on
 * being drawn across the removed half, hanging in the air over a planet that
 * had been cut open under them.
 *
 * This file is the answer to the shape rather than to the instance. A layer's
 * materials are not knowable in advance -- they are built by the importer, the
 * tilers, the drapes, the repaints and the animators, and a new one appears
 * every time somebody ticks a box -- so the plane is applied by a PASS over
 * whatever is on the globe now, re-run whenever either half of the question
 * changes: the cutaway toggling, or the set of layers changing. That is what
 * makes a layer loaded AFTER the cutaway came up arrive already cut.
 *
 * The three places a material can appear between passes are wired to call in
 * directly, because none of them announces a layer change:
 *
 *   - a tiled layer builds a tile on every settle (`vector-tiles.js`, beside
 *     the renderOrder and opacity it already copies onto a new tile);
 *   - a vector layer rebuilds every material on every repaint
 *     (`vector-render.js`, beside `applyOpacity`);
 *   - a raster drape re-lays itself when the relief moves, and keeps its
 *     material, so it needs nothing.
 *
 * `keepUnclipped` is the opt-out, and it excludes the whole SUBTREE. It is for
 * geometry that is deliberately not on the surface -- the satellites orbit at
 * up to three Earth radii, and cutting them at the plane would take half of
 * every orbit off a shell that was never part of the ground being cut.
 */

/** Nothing is cut. One shared empty array, so `sameCut` can compare cheaply. */
const NO_PLANES = [];

/**
 * The event the viewer fires when Core View comes up or goes down.
 *
 * Dispatched on `document` AND listened for on both, deliberately: this tree's
 * other viewer-side announcement (`geoid-study-area-edited`) is a plain
 * `Event` on `document`, which does not bubble, and a `window` listener
 * therefore hears nothing at all -- measured once as zero events for a shape
 * that had plainly landed. Listening on both costs nothing and cannot be got
 * wrong by whichever viewer dispatches it.
 */
export const CUTAWAY_EVENT = "geoid-gis:cutaway-changed";

/**
 * The planes the scene is cut by right now, straight from the viewer.
 *
 * Read rather than remembered: the plane's own normal is re-set whenever the
 * axial tilt changes (`applyPlanetViewMode` turns it to match), so a copy
 * taken at install time would cut along a tilt the planet has since left.
 * three.js reads `Material.clippingPlanes` in WORLD space, so the viewer's own
 * plane object is the right thing to hand to a layer in any group.
 */
export function cutawayPlanes() {
  // `globalThis.window` rather than a bare `window`: a bare one is a
  // ReferenceError under Node, and this module is imported by the suite so
  // the real functions are what get exercised rather than a copy of them.
  const planes = globalThis.window?.GeoIDViewer?.getCutawayPlanes?.();
  return Array.isArray(planes) && planes.length ? planes : NO_PLANES;
}

/**
 * Is this material already cut the way it should be?
 *
 * The count is what matters: three.js compiles the clip count into the shader,
 * so going from none to one -- or one to none -- costs a recompile, and going
 * from one plane to the same plane costs nothing at all. Without this test
 * every hierarchy change would set `needsUpdate` on every material of every
 * layer, which on a 312,500-point cloud is a stutter for no change.
 */
function sameCut(material, planes) {
  const current = material.clippingPlanes;
  const held = current ? current.length : 0;
  if (held !== planes.length) return false;
  for (let i = 0; i < planes.length; i += 1) {
    if (current[i] !== planes[i]) return false;
  }
  return true;
}

function cutNode(node, planes, seen) {
  // A subtree opts out whole: `traverse` has no early exit, which is why this
  // walks the children by hand rather than using it.
  if (node.userData?.keepUnclipped) return;
  const material = node.material;
  if (material) {
    const list = Array.isArray(material) ? material : [material];
    for (const m of list) {
      if (!m || sameCut(m, planes)) continue;
      // `null` rather than `[]` when nothing is cut: three.js treats both as
      // no clipping, and null is what an untouched material carries, so a
      // layer that has never met the cutaway is left byte-identical.
      m.clippingPlanes = planes.length ? planes : null;
      m.needsUpdate = true;
      seen.changed += 1;
    }
  }
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) cutNode(children[i], planes, seen);
}

/**
 * Cut one object3D and everything under it. Returns how many materials moved,
 * which is what a probe should assert on -- "the pass ran" and "the pass
 * changed something" are different claims.
 */
export function applyCutaway(object3D, planes = cutawayPlanes()) {
  if (!object3D) return 0;
  const seen = { changed: 0 };
  cutNode(object3D, planes, seen);
  return seen.changed;
}

/** Every layer on the globe, cut to whatever the viewer is cutting by now. */
export function applyCutawayToLayers() {
  const planes = cutawayPlanes();
  const layers = globalThis.window?.GeoIDImportManager?.getLayers?.() || [];
  let changed = 0;
  for (const layer of layers) changed += applyCutaway(layer?.object3D, planes);
  return changed;
}

let installed = false;

/**
 * Watch both halves of the question.
 *
 * The import manager may not exist yet -- this module can load before it -- so
 * the subscription is retried on a bounded schedule rather than polled for the
 * life of the page. The same bound the draw HUD uses for a late viewer seam.
 */
export function installCutaway() {
  if (installed) return;
  installed = true;
  const applyAll = () => applyCutawayToLayers();
  /**
   * GUARD ON THE LISTENER, NOT ON `window`.
   *
   * Three test files in this tree stub `window = globalThis`, which has no
   * `addEventListener` -- so a `typeof window !== "undefined"` guard passes and
   * the call throws at IMPORT, taking down every suite that imports anything
   * importing this. That is a fault this tree has already paid for once, in
   * `volcanic-hazards.js`, and the note it left says exactly this.
   */
  for (const target of [globalThis.document, globalThis.window]) {
    if (typeof target?.addEventListener === "function") {
      target.addEventListener(CUTAWAY_EVENT, applyAll);
    }
  }
  let tries = 0;
  const subscribe = () => {
    const im = globalThis.window?.GeoIDImportManager;
    if (im?.onChange) {
      // A layer ARRIVING is the other half: this is what makes a dataset
      // ticked on while the cutaway is up arrive already cut.
      im.onChange(applyAll);
      applyAll();
      return;
    }
    if (tries++ > 120 || typeof setTimeout !== "function") return;
    setTimeout(subscribe, 100);
  };
  subscribe();
}

// Self-installing, and gated on the one capability the install actually needs.
// A stubbed `window` is not a browser; see the note inside `installCutaway`.
if (typeof globalThis.document?.addEventListener === "function") {
  installCutaway();
}
