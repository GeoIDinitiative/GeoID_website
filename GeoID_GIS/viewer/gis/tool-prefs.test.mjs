/**
 * Tool prefs — the customisation state under the tool dialog, tested against
 * an injected Map-backed storage so no browser is involved.
 *
 * What this file pins, per tool-ux-spec.md §5: recents dedupe + cap 8 newest
 * first, favourite toggle idempotence, the openTool merge order (prefill
 * beats saved beats default — and an undefined never erases a value), the
 * history ring cap 50, the exact localStorage key names from the spec table,
 * and that a broken or absent storage degrades to defaults without throwing —
 * the house try/catch law, which fails silently by design and so needs a
 * test to stay true.
 *
 * Run: node GeoID_GIS/viewer/gis/tool-prefs.test.mjs
 */

import {
  makePrefs, mergeParams, prefs as defaultPrefs, KEYS, RECENTS_CAP, HISTORY_CAP,
} from "./tool-prefs.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want} ±${tol}`);

/** localStorage's shape over a Map — what the browser instance sees, minus
    the browser. `_map` is exposed so key names can be asserted directly. */
function mapStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

/* ── recents: dedupe + cap ── */

{
  const p = makePrefs(mapStorage());
  ["a", "b", "a", "c"].forEach((id, i) => p.pushRecent(id, 1000 + i));
  const recents = p.getRecents();
  check("re-running a tool moves it, never duplicates it",
    recents.map((r) => r.id).join(",") === "c,a,b");
  near("the moved entry carries its fresh timestamp", recents[1].t, 1002, 0);
  check("recents length is the distinct-tool count", recents.length === 3);
}
{
  const p = makePrefs(mapStorage());
  for (let i = 0; i < 12; i += 1) p.pushRecent(`tool${i}`, i);
  const recents = p.getRecents();
  check(`recents cap at ${RECENTS_CAP}`, recents.length === RECENTS_CAP);
  check("newest first, oldest dropped",
    recents[0].id === "tool11" && recents.every((r) => r.id !== "tool0"));
}

/* ── favourites: toggle idempotence ── */

{
  const p = makePrefs(mapStorage());
  check("toggle on reports true", p.toggleFavourite("buffer") === true);
  check("and the id is listed", p.getFavourites().includes("buffer"));
  check("isFavourite agrees", p.isFavourite("buffer"));
  check("toggle off reports false", p.toggleFavourite("buffer") === false);
  check("two toggles restore the original state", !p.isFavourite("buffer"));
  p.toggleFavourite("clip");
  p.toggleFavourite("buffer");
  p.toggleFavourite("buffer");
  check("toggling one id never disturbs another",
    p.isFavourite("clip") && !p.isFavourite("buffer"));
  // Toggling must not duplicate: on-off-on has to yield exactly one entry.
  p.toggleFavourite("hull");
  p.toggleFavourite("hull");
  p.toggleFavourite("hull");
  check("on-off-on lists the id exactly once",
    p.getFavourites().filter((id) => id === "hull").length === 1);
}

/* ── merge order: prefill beats saved beats default ── */

{
  const defaults = { distance: 1000, dissolve: true };
  const saved = { distance: 500 };
  const prefill = { distance: 250 };
  const out = mergeParams(defaults, saved, prefill);
  near("prefill wins over saved and default", out.distance, 250, 0);
  check("defaults survive where nothing overrides", out.dissolve === true);
  near("saved wins over default when prefill is silent",
    mergeParams(defaults, saved, {}).distance, 500, 0);
  near("absent layers fall through to defaults",
    mergeParams(defaults, null, undefined).distance, 1000, 0);
  // An explicit undefined is "I did not say", not "unset it" — a spread
  // would get this wrong, which is why mergeParams exists at all.
  near("undefined in prefill does not erase the saved value",
    mergeParams(defaults, saved, { distance: undefined }).distance, 500, 0);
}

/* ── per-tool params: save / read / clear ── */

{
  const p = makePrefs(mapStorage());
  check("unknown tool has no saved prefs", p.getToolPrefs("buffer") === null);
  p.saveToolPrefs("buffer", { params: { distance: 750 }, outputName: "ring_roads" });
  const saved = p.getToolPrefs("buffer");
  near("params round-trip", saved.params.distance, 750, 0);
  check("output name rides with them", saved.outputName === "ring_roads");
  p.clearToolPrefs("buffer");
  check("clear returns the tool to descriptor defaults", p.getToolPrefs("buffer") === null);
}

/* ── history: ring cap, newest first ── */

{
  const p = makePrefs(mapStorage());
  for (let i = 0; i < HISTORY_CAP + 5; i += 1) {
    p.pushHistory({ tool: "buffer", ok: true, t: i });
  }
  const history = p.getHistory();
  check(`history ring caps at ${HISTORY_CAP}`, history.length === HISTORY_CAP);
  near("newest record first", history[0].t, HISTORY_CAP + 4, 0);
  check("the oldest fell off the ring", history.every((r) => r.t >= 5));
  p.pushHistory(null);
  check("a null record is refused, not stored", p.getHistory().length === HISTORY_CAP);
}

/* ── the spec table's key names, pinned against the storage itself ── */

{
  const storage = mapStorage();
  const p = makePrefs(storage);
  p.toggleFavourite("buffer");
  p.pushRecent("buffer");
  p.saveToolPrefs("buffer", { params: {} });
  p.pushHistory({ tool: "buffer" });
  check("favourites key is geoid-gis:tool-favourites",
    storage._map.has("geoid-gis:tool-favourites") && KEYS.favourites === "geoid-gis:tool-favourites");
  check("recents key is geoid-gis:tool-recents", storage._map.has("geoid-gis:tool-recents"));
  check("per-tool key is geoid-gis:tool-params:<toolId>",
    storage._map.has("geoid-gis:tool-params:buffer") && KEYS.params("clip") === "geoid-gis:tool-params:clip");
  check("history key is geoid-gis:tool-history", storage._map.has("geoid-gis:tool-history"));
}

/* ── degradation: broken or absent storage never throws ── */

{
  const p = makePrefs(null);
  let threw = false;
  try {
    p.toggleFavourite("buffer");
    p.pushRecent("buffer");
    p.saveToolPrefs("buffer", { params: { d: 1 } });
    p.pushHistory({ tool: "buffer" });
  } catch {
    threw = true;
  }
  check("storage-less prefs accept every write silently", !threw);
  check("and answer every read with its empty default",
    p.getFavourites().length === 0 && p.getRecents().length === 0
    && p.getToolPrefs("buffer") === null && p.getHistory().length === 0);
}
{
  const bomb = {
    getItem: () => { throw new Error("quota"); },
    setItem: () => { throw new Error("quota"); },
    removeItem: () => { throw new Error("quota"); },
  };
  const p = makePrefs(bomb);
  let threw = false;
  try {
    p.toggleFavourite("x");
    p.clearToolPrefs("x");
  } catch {
    threw = true;
  }
  check("a throwing storage is swallowed, per the house try/catch law", !threw);
  check("reads through it fall back to defaults", p.getFavourites().length === 0);
}
{
  // Garbage already in storage — a hand-edited or corrupted value — must
  // read as the default, not crash JSON.parse into the caller.
  const storage = mapStorage();
  storage.setItem("geoid-gis:tool-favourites", "{not json");
  storage.setItem("geoid-gis:tool-recents", '"a string, not an array"');
  const p = makePrefs(storage);
  check("corrupt JSON reads as the default", p.getFavourites().length === 0);
  check("a wrong-shaped value reads as the default", p.getRecents().length === 0);
}

/* ── the default instance exists and is inert in Node ── */

{
  check("default instance is constructed without a window",
    Array.isArray(defaultPrefs.getFavourites()));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
