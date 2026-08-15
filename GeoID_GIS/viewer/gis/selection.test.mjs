/**
 * The selection store — its mutations, and the announcements consumers redraw
 * on.
 *
 * The announcements are the half worth testing hardest: a missing one leaves
 * the globe showing a stale highlight (the app lying about what the next tool
 * run will act on), and a spurious one redraws every subscriber on every mouse
 * move. So each mutation is checked for the event it emits AND for the events
 * it must not emit — the no-op cases (setting the same members, clearing an
 * empty layer) are pinned as deliberately silent.
 *
 * The module is imported dynamically, after a stand-in `window` exists, so the
 * `window.GeoIDSelection` seam is exercised here rather than assumed.
 *
 * Run: node GeoID_GIS/viewer/gis/selection.test.mjs
 */

globalThis.window = globalThis.window || {};
const { makeSelectionStore, selection } = await import("./selection.js");

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const sorted = (set) => [...set].sort((a, b) => a - b).join(",");

/** A store plus a log of everything it announced. */
function fresh() {
  const store = makeSelectionStore();
  const events = [];
  store.onChange((e) => events.push(e));
  return { store, events };
}

/* ── reading ── */

{
  const { store } = fresh();
  check("an unknown layer reads as an empty set", store.get("nope").size === 0);
  check("and it really is a Set", store.get("nope") instanceof Set);
  check("count starts at zero", store.count() === 0);
  check("layers() starts empty", store.layers().length === 0);
  check("has() is false for anything", store.has("nope", 0) === false);
}

/* ── set ── */

{
  const { store, events } = fresh();
  check("set reports that it changed something", store.set("roads", [3, 1, 2]) === true);
  check("the members are stored", sorted(store.get("roads")) === "1,2,3");
  check("set announced once", events.length === 1);
  check("and named the layer", events[0].layerId === "roads");

  const copy = store.get("roads");
  copy.add(99);
  copy.delete(1);
  check("get returns a COPY — mutating it cannot reach the store",
    sorted(store.get("roads")) === "1,2,3");

  check("an identical set is silent", store.set("roads", [2, 3, 1]) === false && events.length === 1);
  check("a different set announces again", store.set("roads", [1]) === true && events.length === 2);

  store.set("rivers", new Set([7, 8]));
  check("a Set is accepted as input", sorted(store.get("rivers")) === "7,8");
  store.set("wells", [1, 1, 2, "3", -1, 2.5, null, undefined, NaN, "", true, {}]);
  check("duplicates collapse and only whole non-negative indices survive",
    sorted(store.get("wells")) === "1,2,3", sorted(store.get("wells")));
  check("null does NOT coerce to index 0", store.has("wells", 0) === false);
  check("nor does a toggle of null", store.toggle("wells", null) === false
    && store.has("wells", 0) === false);
}

/* ── emptying by setting ── */

{
  const { store, events } = fresh();
  store.set("roads", [1, 2]);
  check("setting an empty list clears the layer", store.set("roads", []) === true
    && store.count("roads") === 0);
  check("and the layer stops being listed", store.layers().length === 0);
  check("that counted as a change", events.length === 2);
  check("setting empty on an already empty layer is silent",
    store.set("roads", []) === false && events.length === 2);
}

/* ── toggle ── */

{
  const { store, events } = fresh();
  check("toggle on returns the new state", store.toggle("wells", 5) === true);
  check("and the index is selected", store.has("wells", 5));
  check("toggle again returns off", store.toggle("wells", 5) === false);
  check("and the index is gone", store.has("wells", 5) === false);
  check("each toggle announced", events.length === 2 && events[1].layerId === "wells");
  store.toggle("wells", 1);
  store.toggle("wells", 2);
  check("toggles accumulate", sorted(store.get("wells")) === "1,2");
  check("a non-integer toggle is refused", store.toggle("wells", 1.5) === false);
  check("and it changed nothing", sorted(store.get("wells")) === "1,2" && events.length === 4);
}

/* ── clear ── */

{
  const { store, events } = fresh();
  store.set("roads", [1, 2]);
  store.set("rivers", [3]);
  check("two layers hold a selection", store.layers().join("|") === "roads|rivers");
  check("count() totals across layers", store.count() === 3);
  check("count(layer) is that layer alone", store.count("roads") === 2);

  const before = events.length;
  check("clearing one layer reports the change", store.clear("rivers") === true);
  check("only that layer went", store.count() === 2 && store.layers().join("|") === "roads");
  check("and it announced itself by name",
    events.length === before + 1 && events[before].layerId === "rivers");
  check("clearing it again is silent",
    store.clear("rivers") === false && events.length === before + 1);

  store.set("rivers", [3]);
  const mark = events.length;
  check("clear() with no argument empties everything", store.clear() === true && store.count() === 0);
  check("a clear-all announces exactly ONCE", events.length === mark + 1);
  check("with layerId null, meaning assume everything moved", events[mark].layerId === null);
  check("clearing an empty store is silent", store.clear() === false && events.length === mark + 1);
}

/* ── subscription ── */

{
  const store = makeSelectionStore();
  const seen = [];
  const stop = store.onChange((e) => seen.push(e.layerId));
  store.set("a", [1]);
  store.toggle("b", 2);
  check("every mutation reached the listener", seen.join("|") === "a|b");
  stop();
  store.set("c", [3]);
  check("unsubscribing stops it", seen.join("|") === "a|b");
  check("but the store still changed", store.count("c") === 1);

  const other = [];
  store.onChange(() => { throw new Error("this listener is broken"); });
  store.onChange((e) => other.push(e.layerId));
  const warn = console.warn;
  console.warn = () => {};
  store.set("d", [4]);
  console.warn = warn;
  check("a listener that throws does not stop the ones after it", other.join("|") === "d");
  check("and the mutation still landed", store.count("d") === 1);
  check("onChange of a non-function is a no-op unsubscribe",
    typeof store.onChange(null) === "function");
}

/* ── isolation and the seam ── */

{
  const a = makeSelectionStore();
  const b = makeSelectionStore();
  a.set("roads", [1]);
  check("two stores are independent", b.count() === 0 && a.count() === 1);

  check("an empty layer id is refused", a.set("", [1]) === false);
  check("a null layer id is refused", a.set(null, [1]) === false);
  check("and neither reached the store", a.count() === 1);

  check("the module exports one shared store", typeof selection.onChange === "function");
  check("and hangs it on the window seam", window.GeoIDSelection === selection);
  selection.set("seam-check", [0]);
  check("the seam is the same object, not a copy",
    window.GeoIDSelection.count("seam-check") === 1);
  selection.clear();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
