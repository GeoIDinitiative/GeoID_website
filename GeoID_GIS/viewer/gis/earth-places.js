/**
 * Earth's gazetteer on the globe: many thousands of named places — seas,
 * landforms, islands, mountains, volcanoes, rivers, lakes, faults and plates,
 * cities — ranked 1–5 by
 * significance and drawn through the viewer's OWN label engine, so every name
 * wears the same chip, declutters with the curated ones and opens the same
 * card.
 *
 * The data is baked (services/bake-earth-places.py → data/global/earth-places
 * .json); this module only turns it into label items and owns the per-category
 * tick boxes in Explorer ▸ Locations. What a category LOOKS like and how a
 * rank becomes a size live in the viewer (placeCategories / rankPlace), beside
 * the curated places that use them.
 *
 * Earth only: the page's own script tag loads it, the planets never do.
 */
import { dataUrl } from "./data-base.js?v=20260925-f7cb0d0";
import { holdLaunch } from "./launch-ready.js?v=20260925-f7cb0d0";

const PATH = "/data/global/earth-places.json";
const ON_KEY = "geoid-gis:earth-places-on";   // what was switched ON — see note
const BATCH = 320;

/**
 * THE PLACE NAMES ARE OFF WHEN THE PAGE OPENS, so what is stored is which
 * rows somebody switched ON: the exceptions to the default, never the default
 * itself (a stored list of the default goes stale the moment a category is
 * added). This replaced an off-list from when the names opened on; that key
 * is simply no longer read. A storage that throws answers "nothing on".
 */
export function readOn() {
  try {
    const raw = JSON.parse(localStorage.getItem(ON_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch (_error) {
    return new Set();
  }
}
function writeOn(on) {
  try { localStorage.setItem(ON_KEY, JSON.stringify([...on])); } catch (_error) { /* per-browser nicety */ }
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/^(the|mount|mt\.?|lake|gulf of|sea of)\s+/, "").replace(/[^a-z0-9]/g, "");

/**
 * A curated place and a baked one naming the same feature: the curated one
 * wins (it has the hand-written description), matched on a name stem and
 * three degrees of distance so "Himalaya" meets "Himalayas" and "Amazon
 * Basin" meets "Amazon basin", but two Sierra Nevadas do not.
 */
export function isCuratedDuplicate(place, curated) {
  const a = norm(place.name);
  if (!a) return false;
  return curated.some((c) => {
    const b = norm(c.name);
    // An ocean or a continent is one feature however far apart the two
    // anchors sit (the curated Atlantic is on the equator, Natural Earth's in
    // the North Atlantic): the same name at tier 1–2 is the same place.
    if (a === b && place.lod <= 2) return true;
    if (!b || !(a.startsWith(b.slice(0, 6)) || b.startsWith(a.slice(0, 6)))) return false;
    const dLat = Math.abs(place.lat - c.lat);
    const dLon = Math.abs((((place.lon - c.lon) % 360) + 540) % 360 - 180);
    return dLat < 3 && dLon < 3;
  });
}

/** The baked row as a label item the viewer's engine reads. */
export function toItem(row, rank) {
  const item = {
    name: row.name,
    type: row.type,
    lat: row.lat,
    lon: row.lon,
    theme: "standard",
    description: row.description,
    source: row.source,
    region: row.region,
    population: row.population,
    elevation_m: typeof row.elevation_m === "number" ? row.elevation_m : undefined,
    length_km: row.length_km || row.geometry_km || undefined,
    place: true,
    lazy_label: true,
    label_backing: 2,
    // a gazetteer chip sits closer to its anchor than a curated landmark's:
    // thousands of long leaders would cross each other everywhere
    label_distance: 0.22,
  };
  return rank(item, row.lod, `place-${row.category}`);
}

let loaded = null;
let onSet = readOn();

/**
 * Rows the Locations list shows as ONE entry. Oceans and seas, rivers and
 * lakes are one subject to somebody deciding what to read on the globe; the
 * categories stay separate underneath, because each keeps its own label
 * colour. A group's box turns every member on or off together.
 */
export const PLACE_GROUPS = [
  { key: "water", label: "Water bodies", ids: ["place-marine", "place-river", "place-lake"] },
];

/** The list's rows, in the viewer's category order, a group at its first member. */
export function placeRows(categories) {
  const rows = [];
  const grouped = new Map();
  for (const g of PLACE_GROUPS) for (const id of g.ids) grouped.set(id, g);
  for (const cat of categories) {
    const g = grouped.get(cat.id);
    if (!g) { rows.push({ key: cat.id.replace(/^place-/, ""), label: cat.label, colour: cat.colour, ids: [cat.id] }); continue; }
    if (rows.some((r) => r.group === g.key)) continue;
    rows.push({ key: g.key, group: g.key, label: g.label, colour: cat.colour,
      ids: g.ids.filter((id) => categories.some((c) => c.id === id)) });
  }
  return rows;
}

function drawRows(viewer) {
  const host = document.getElementById("place-category-rows");
  if (!host) return;
  host.textContent = "";
  for (const entry of placeRows(viewer.placeCategories())) {
    const row = document.createElement("div");
    row.className = "row";
    const id = `place-toggle-${entry.key}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.style.color = entry.colour;
    label.textContent = entry.label;
    const wrap = document.createElement("span");
    wrap.className = "checkbox-wrap";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = id;
    box.dataset.placeCategory = entry.ids.join(" ");
    box.checked = entry.ids.some((cid) => onSet.has(cid));
    box.addEventListener("change", () => {
      for (const cid of entry.ids) { if (box.checked) onSet.add(cid); else onSet.delete(cid); }
      writeOn(onSet);
      syncMaster();
    });
    wrap.appendChild(box);
    row.append(label, wrap);
    host.appendChild(row);
  }
}

// The Locations master counts these rows too: a master reading off over a
// globe full of place names is the lie its own sync note warns about.
function syncMaster() {
  const master = document.getElementById("locations-master-toggle");
  if (!master) return;
  if (document.querySelector("#place-category-rows input:checked")) master.checked = true;
}

function wireMaster() {
  const master = document.getElementById("locations-master-toggle");
  if (!master || master.dataset.placesWired) return;
  master.dataset.placesWired = "1";
  master.addEventListener("change", () => {
    for (const box of document.querySelectorAll("#place-category-rows input[type=checkbox]")) {
      box.checked = master.checked;
      for (const cid of box.dataset.placeCategory.split(" ")) {
        if (master.checked) onSet.add(cid); else onSet.delete(cid);
      }
    }
    writeOn(onSet);
  });
}

/**
 * The fetch starts when this module LOADS, not when the viewer is ready: the
 * viewer takes seconds to boot and the file has nothing to wait for. The
 * labels are still added once there is a globe to add them to.
 */
let docPromise = null;
function fetchDoc() {
  docPromise ||= dataUrl(PATH).then((url) => fetch(url)).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  return docPromise;
}

async function load(viewer) {
  const doc = await fetchDoc();
  const curated = viewer.curatedPlaces();
  const rank = (item, lod, category) => viewer.rankPlace(item, lod, category);
  const places = (doc.places || []).filter((p) => !isCuratedDuplicate(p, curated));
  /**
   * SEARCHABLE WHETHER OR NOT THEY ARE DRAWN. A reader looking for Vesuvius
   * has not first ticked "Volcanoes" on -- that tick decides what is written
   * across the globe, and the search box is how you get to a place you cannot
   * see. So every row is offered, and the category filter governs the labels
   * alone.
   *
   * Built on the FIRST ask and kept, never per keystroke: 13,200 rows is a
   * cheap list to hold and an expensive one to rebuild sixty times a minute.
   * Lighter than a label item -- no chip, no palette, no scale -- because
   * nothing here is drawn.
   */
  let searchItems = null;
  viewer.registerFeatureSource?.("earth-places", () => {
    searchItems ||= places.map((row) => ({
      name: row.name, type: row.type, lat: row.lat, lon: row.lon,
      theme: "standard", description: row.description, source: row.source,
      region: row.region, population: row.population,
      elevation_m: typeof row.elevation_m === "number" ? row.elevation_m : undefined,
      place: true, lod: row.lod, category: `place-${row.category}`,
    }));
    return searchItems;
  });
  drawRows(viewer);
  wireMaster();
  viewer.setPlaceCategoryFilter((category) => onSet.has(category));
  // ONE TIER AND ONE CATEGORY PER BATCH, most significant first, built across
  // frames. The viewer detaches a whole batch while the density slider, the
  // zoom or its category toggle rules it out (syncPlaceBatches), which is what
  // lets the gazetteer run to thousands of names without costing a frame.
  const byBatch = new Map();
  for (const row of places) {
    const k = `${row.lod}|${row.category}`;
    if (!byBatch.has(k)) byBatch.set(k, []);
    byBatch.get(k).push(row);
  }
  const keys = [...byBatch.keys()].sort((a, b) => Number(a.split("|")[0]) - Number(b.split("|")[0]));
  const handles = [];
  for (const k of keys) {
    const rows = byBatch.get(k);
    for (let i = 0; i < rows.length; i += BATCH) {
      handles.push(viewer.addSurfaceLabels(rows.slice(i, i + BATCH).map((row) => toItem(row, rank))));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }
  return { count: places.length, baked: doc.baked, handles };
}

function start(tries = 0) {
  const viewer = window.GeoIDViewer;
  if (!viewer?.addSurfaceLabels || !viewer.placeCategories || !viewer.rankPlace) {
    if (tries < 160) setTimeout(() => start(tries + 1), 250);
    else window.dispatchEvent(new CustomEvent("geoid-gis:places-failed"));
    return;
  }
  if (loaded) return;
  loaded = load(viewer).then((result) => {
    window.dispatchEvent(new CustomEvent("geoid-gis:places-loaded", { detail: { count: result.count } }));
    return result;
  }).catch((error) => {
    console.warn("[earth-places] gazetteer did not load:", error);
    window.dispatchEvent(new CustomEvent("geoid-gis:places-failed"));
    const host = document.getElementById("place-category-rows");
    if (host) {
      const note = document.createElement("p");
      note.className = "compact-copy";
      note.textContent = `Place names did not load (${error.message || error}).`;
      host.appendChild(note);
    }
    return null;
  });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.GeoIDEarthPlaces = {
    loaded: () => loaded,
    isOn: (category) => onSet.has(category),
  };
  // The start-up screen waits for the names (gis/launch-ready.js).
  const releasePlaces = holdLaunch("places", 14000);
  fetchDoc().catch(() => {});
  window.addEventListener("geoid-gis:places-loaded", releasePlaces, { once: true });
  window.addEventListener("geoid-gis:places-failed", releasePlaces, { once: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => start());
  else start();
}
