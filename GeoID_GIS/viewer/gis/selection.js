/**
 * The selection store — one place that knows what is selected, for every
 * surface that draws or acts on it.
 *
 * A selection is the join between the query engine, the attribute table, the
 * globe highlight, the tool dialogs ("selected features only") and export.
 * Each of those was going to keep its own list, and the first time two of them
 * disagreed the user would be right and the app wrong — a table row highlighted
 * while the globe shows something else is not a cosmetic bug, it is the app
 * lying about what the next tool run will operate on. So there is exactly one
 * store, module-level, and every consumer subscribes rather than caching.
 *
 * Nothing here renders. That is deliberate: the store has no idea a globe
 * exists, which is what keeps it node-testable and what lets a new surface
 * join by subscribing rather than by being wired in here.
 *
 * Contract notes for consumers:
 *
 * - `get(layerId)` returns a **copy**. Mutating it changes nothing — the store
 *   can only be changed through `set`/`toggle`/`clear`, which is what makes
 *   "every change announces" true rather than hopeful.
 * - Every announcement is `{layerId}`. A clear-all announces **once** with
 *   `layerId: null`, meaning "assume everything moved", rather than one event
 *   per layer.
 * - A `set` that stores the same members as before does not announce. Re-running
 *   the same query, or a hover path that re-sets the current selection, must not
 *   make every subscriber redraw.
 * - Indices are non-negative integers into the layer's `collection.features`.
 *   Anything else is dropped on the way in, so a listener never has to defend
 *   against a stray value.
 */

/**
 * A feature index, or null. Only a number or a numeric string qualifies:
 * coercing anything else would turn null, "" and false into index 0 — a
 * feature nobody selected, silently highlighted.
 */
function normaliseIndex(raw) {
  if (typeof raw === "number") return (Number.isInteger(raw) && raw >= 0) ? raw : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  return (Number.isInteger(n) && n >= 0) ? n : null;
}

function normaliseIndices(indices) {
  const out = new Set();
  if (!indices) return out;
  const iterable = typeof indices[Symbol.iterator] === "function" ? indices : [];
  for (const raw of iterable) {
    const n = normaliseIndex(raw);
    if (n !== null) out.add(n);
  }
  return out;
}

function sameMembers(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

function validId(layerId) {
  return typeof layerId === "string" ? layerId.length > 0 : (layerId !== undefined && layerId !== null);
}

/**
 * A fresh, isolated store. The app uses the `selection` singleton below; this
 * exists so a test (and any future scratch/preview surface) can hold its own
 * without touching the app's.
 */
export function makeSelectionStore() {
  /** @type {Map<string, Set<number>>} — a layer with an empty set is deleted. */
  const sets = new Map();
  const listeners = new Set();

  function announce(layerId) {
    // Copied before iterating: a listener may unsubscribe itself in its own
    // callback, and a listener that throws must not stop the ones after it.
    [...listeners].forEach((fn) => {
      try {
        fn({ layerId });
      } catch (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[GeoID selection] a change listener threw", err);
        }
      }
    });
  }

  function store(layerId, next) {
    const before = sets.get(layerId);
    if (before && sameMembers(before, next)) return false;
    if (!before && !next.size) return false;
    if (next.size) sets.set(layerId, next);
    else sets.delete(layerId);
    announce(layerId);
    return true;
  }

  return {
    /** The selected indices for a layer, as a copy. Empty set when none. */
    get(layerId) {
      const found = validId(layerId) ? sets.get(layerId) : null;
      return new Set(found || []);
    },

    /** Is one feature selected? Cheaper than `get(...).has(...)`. */
    has(layerId, index) {
      const found = validId(layerId) ? sets.get(layerId) : null;
      return !!found && found.has(index);
    },

    /** Replace a layer's selection. Accepts any iterable of indices. */
    set(layerId, indices) {
      if (!validId(layerId)) return false;
      return store(layerId, normaliseIndices(indices));
    },

    /** Flip one feature. Returns whether it is selected afterwards. */
    toggle(layerId, index) {
      if (!validId(layerId)) return false;
      const n = normaliseIndex(index);
      if (n === null) return false;
      const next = new Set(sets.get(layerId) || []);
      const nowOn = !next.has(n);
      if (nowOn) next.add(n);
      else next.delete(n);
      store(layerId, next);
      return nowOn;
    },

    /** Clear one layer, or every layer when called with nothing. */
    clear(layerId) {
      if (layerId === undefined) {
        if (!sets.size) return false;
        sets.clear();
        announce(null);
        return true;
      }
      if (!validId(layerId) || !sets.has(layerId)) return false;
      sets.delete(layerId);
      announce(layerId);
      return true;
    },

    /** Total selected features, or one layer's count. */
    count(layerId) {
      if (layerId === undefined) {
        let total = 0;
        sets.forEach((s) => { total += s.size; });
        return total;
      }
      const found = validId(layerId) ? sets.get(layerId) : null;
      return found ? found.size : 0;
    },

    /** Ids of the layers holding a selection, in insertion order. */
    layers() {
      return [...sets.keys()];
    },

    /** Subscribe; returns the unsubscribe. Called as `fn({layerId})`. */
    onChange(fn) {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

/** The one selection every surface in the GIS reads and writes. */
export const selection = makeSelectionStore();

// Seam, matching the house pattern (window.GeoIDImportManager,
// window.GeoIDToolSearch): the store is a module singleton and this is how a
// non-module surface reaches it. Guarded so the module still imports in node.
if (typeof window !== "undefined") {
  try {
    window.GeoIDSelection = selection;
  } catch (err) {
    /* a frozen or cross-origin window must not break the import */
  }
}
