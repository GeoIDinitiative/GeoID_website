/**
 * Tool customisation state — favourites, recents, remembered params, run
 * history. Spec: GeoID_GIS/docs/ni-prototype/tool-ux-spec.md §5.
 *
 * Pure persistence, deliberately split from the descriptor registry:
 * *defaults* (output-name templates, param defaults, keywords) live in the
 * descriptors in tool-runner.js — shippable, testable data — while *user
 * state* lives only here, keyed by descriptor id and merged at openTool time.
 * Nothing in this module ever writes into the registry.
 *
 * The factory takes its storage as an argument so the whole module tests
 * without a browser (tool-prefs.test.mjs injects a Map-backed storage). The
 * default instance binds to window.localStorage, and every access is wrapped
 * in try/catch (the house pattern, atlas-assistant.js:55–63): localStorage
 * can throw on access in private windows and when quota is hit, and a
 * preference that cannot be saved must never take the tool run down with it.
 */

/** All keys in the house namespace (`geoid-gis:<name>`), per the §5 table. */
export const KEYS = {
  favourites: "geoid-gis:tool-favourites",
  recents: "geoid-gis:tool-recents",
  history: "geoid-gis:tool-history",
  params: (toolId) => `geoid-gis:tool-params:${toolId}`,
};

/** Recents cap 8 — mirrors ArcGIS Pro's Recents tab, per the spec table. */
export const RECENTS_CAP = 8;
/** History is a ring, cap 50, per §1.3 / §5. */
export const HISTORY_CAP = 50;

/**
 * Merge order for opening a tool (§4.4): descriptor defaults ← saved per-tool
 * prefs ← prefill, later wins. Exported pure so the test can pin the order.
 *
 * A layer's `undefined` values are skipped rather than spread: an object
 * spread would let `{ distance: undefined }` in a prefill erase a saved
 * value, and "I did not say" must never mean "unset it".
 */
export function mergeParams(defaults, saved, prefill) {
  const merged = {};
  [defaults, saved, prefill].forEach((layer) => {
    if (!layer || typeof layer !== "object") return;
    Object.keys(layer).forEach((key) => {
      if (layer[key] !== undefined) merged[key] = layer[key];
    });
  });
  return merged;
}

/**
 * Build a prefs instance over any localStorage-shaped object
 * (getItem/setItem/removeItem). `storage` may be null or broken; every
 * operation then degrades to its in-memory answer without throwing.
 */
export function makePrefs(storage) {
  function read(key, fallback) {
    try {
      const raw = storage?.getItem?.(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      storage?.setItem?.(key, JSON.stringify(value));
    } catch {
      /* A preference that cannot persist is dropped, never thrown. */
    }
  }

  function remove(key) {
    try {
      storage?.removeItem?.(key);
    } catch {
      /* ditto */
    }
  }

  return {
    // ── Favourites: ["buffer", "clip"] ─────────────────────────────────────
    getFavourites() {
      const list = read(KEYS.favourites, []);
      return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
    },
    isFavourite(toolId) {
      return this.getFavourites().includes(toolId);
    },
    /** Returns the new state: true = now a favourite. Toggling twice is a no-op. */
    toggleFavourite(toolId) {
      const list = this.getFavourites();
      const index = list.indexOf(toolId);
      if (index >= 0) {
        list.splice(index, 1);
        write(KEYS.favourites, list);
        return false;
      }
      list.push(toolId);
      write(KEYS.favourites, list);
      return true;
    },

    // ── Recents: [{id, t}], cap 8, newest first ────────────────────────────
    getRecents() {
      const list = read(KEYS.recents, []);
      return Array.isArray(list)
        ? list.filter((r) => r && typeof r.id === "string")
        : [];
    },
    /**
     * Dedupe by id: re-running a tool moves it to the front with a fresh
     * timestamp rather than filling the list with copies of itself.
     */
    pushRecent(toolId, t = Date.now()) {
      const list = this.getRecents().filter((r) => r.id !== toolId);
      list.unshift({ id: toolId, t });
      write(KEYS.recents, list.slice(0, RECENTS_CAP));
    },

    // ── Per-tool remembered params: { params: {...}, outputName } ──────────
    getToolPrefs(toolId) {
      const saved = read(KEYS.params(toolId), null);
      return saved && typeof saved === "object" ? saved : null;
    },
    saveToolPrefs(toolId, { params = {}, outputName } = {}) {
      write(KEYS.params(toolId), { params, outputName });
    },
    /** The dialog's "Defaults" button: back to the descriptor's own values. */
    clearToolPrefs(toolId) {
      remove(KEYS.params(toolId));
    },

    // ── History ring, cap 50, newest first (the fallback when no project
    //    is open — with one open the runner writes metadata/tool_history.json
    //    through the store instead, per §1.3) ─────────────────────────────
    getHistory() {
      const list = read(KEYS.history, []);
      return Array.isArray(list) ? list.filter((r) => r && typeof r === "object") : [];
    },
    pushHistory(record) {
      if (!record || typeof record !== "object") return;
      const list = this.getHistory();
      list.unshift(record);
      write(KEYS.history, list.slice(0, HISTORY_CAP));
    },
  };
}

/**
 * The shared browser instance. `window.localStorage` is reached inside a
 * try/catch because the *property access itself* can throw a SecurityError
 * (sandboxed iframes, some privacy modes); in Node there is no window and
 * the instance simply runs storage-less, which makePrefs handles.
 */
function defaultStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const prefs = makePrefs(defaultStorage());
