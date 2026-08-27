/**
 * The extent resolver, and the fallback chain that is the whole point of it.
 *
 * Every failure here is silent in the browser: a polygon resolved with
 * unsigned longitude asks for the wrong side of the planet and still returns
 * a plausible box; a missing fallback returns null into a status line that
 * says nothing; a stale `layer:<id>` resolves to undefined and the request
 * goes out global. None of that throws, so none of it is visible without
 * numbers.
 *
 * Run: node GeoID_GIS/viewer/gis/extent-picker.test.mjs
 */

import {
  signedLon, drawnPolygonLayers, layerBounds, capturedExtentBounds,
  drawnOverlayBounds, resolvePolygonExtent, refreshPolygonOptions,
} from "./extent-picker.js";

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

/* A DOM thin enough to run in Node — the module only ever reaches for
   getElementById and the two globals the viewer publishes. */
function stubDom({ layers = [], vertices = null, railActive = false } = {}) {
  const rail = {
    classList: { contains: () => railActive, add() {}, remove() {} },
    clicked: 0,
    click() { this.clicked += 1; },
  };
  globalThis.document = {
    getElementById: (id) => (id === "tool-rail-area" ? rail : null),
  };
  globalThis.window = {
    GeoIDImportManager: { getLayers: () => layers },
    GeoIDViewer: {
      getExtractionGeometry: () => (vertices ? { vertices } : null),
    },
  };
  return rail;
}

const ringLayer = (id, name, ring, extra = {}) => ({
  id, name, ext: "drawn",
  collection: { features: [{ geometry: { coordinates: [ring] }, properties: {} }] },
  ...extra,
});

// ── signedLon ────────────────────────────────────────────────────────────
// The viewer says 0-360 east; every file format means -180..180. This is the
// conversion a study area over Sicily needs to stop reading as mid-Atlantic.
check("0 stays 0", signedLon(0), 0);
check("15 east stays 15", signedLon(15), 15);
check("315 east is 45 west", signedLon(315), -45);
check("359 east is one degree west", signedLon(359), -1);
check("180 is the antimeridian", signedLon(180), -180);
check("an already-signed value survives", signedLon(-45), -45);

// ── layers ───────────────────────────────────────────────────────────────
stubDom({
  layers: [
    ringLayer(1, "Fetch Polygon 1", [[-11, 49], [2, 49], [2, 55], [-11, 55]]),
    { id: 2, name: "half-imported", ext: "drawn", collection: { features: [] } },
    { id: 3, name: "a coastline", ext: "geojson", collection: { features: [{ geometry: { coordinates: [[[0, 0]]] } }] } },
  ],
});
const listed = drawnPolygonLayers().map((l) => l.name);
check("a drawn polygon is listed", listed.includes("Fetch Polygon 1"), true);
check("a layer with no ring yet is NOT listed", listed.includes("half-imported"), false);
check("an ordinary import is not a drawn extent", listed.includes("a coastline"), false);

check("layerBounds reads the ring", layerBounds(drawnPolygonLayers()[0]), {
  west: -11, south: 49, east: 2, north: 55, reusedFrom: "Fetch Polygon 1",
});
check("layerBounds refuses a layer with no ring", layerBounds({ collection: { features: [] } }), null);

// ── the fallback chain ───────────────────────────────────────────────────
// 1. A named polygon is exact.
check("a named polygon resolves to its own bounds",
  resolvePolygonExtent("layer:1"),
  { west: -11, south: 49, east: 2, north: 55, reusedFrom: "Fetch Polygon 1" });

// 2. A named polygon that has been removed says so rather than resolving to
//    undefined and letting the request go out over the whole world.
check("a stale layer id is an error, not a silent global",
  Boolean(resolvePolygonExtent("layer:999")?.error), true);

// 3. Modes this module does not own are handed back.
check("an unknown mode is not claimed", resolvePolygonExtent("global"), null);
check("current view is not claimed", resolvePolygonExtent("view"), null);

// 4. The live overlay wins, and its longitudes are SIGNED on the way out.
stubDom({ vertices: [{ lat: 36, lon: 350 }, { lat: 38, lon: 355 }, { lat: 37, lon: 352 }] });
check("the live overlay resolves, in signed degrees",
  resolvePolygonExtent("drawn"),
  { west: -10, south: 36, east: -5, north: 38 });
check("the viewer's own 0-360 never escapes",
  resolvePolygonExtent("drawn").west < 0, true);

// 5. No overlay, but a captured extent is still on the globe.
stubDom({
  layers: [ringLayer(7, "Fetch extent 5.0×3.0°", [[1, 10], [6, 10], [6, 13], [1, 13]])],
});
check("a captured extent is the fallback",
  capturedExtentBounds()?.reusedFrom, "Fetch extent 5.0×3.0°");
check("resolve falls back to the captured extent",
  resolvePolygonExtent("drawn").west, 1);

// A hidden layer is not the fallback — it is not on the globe to be reused.
stubDom({
  layers: [ringLayer(8, "hidden one", [[1, 10], [6, 10], [6, 13], [1, 13]], { visible: false })],
});
check("a hidden polygon is not silently reused", capturedExtentBounds(), null);

// 6. Nothing anywhere: arm the tool and SAY so. Returning null here is what
//    made Earth Engine's old polygon option a dead end.
const rail = stubDom({});
const empty = resolvePolygonExtent("drawn");
check("with nothing drawn the result is an error, never null", Boolean(empty?.error), true);
check("and the Draw tool was armed", rail.clicked, 1);
check("the message tells the user what to do",
  /draw/i.test(empty.error) && /globe/i.test(empty.error), true);

const rail2 = stubDom({});
const passive = resolvePolygonExtent("drawn", { arm: false });
check("arm:false still explains itself", Boolean(passive?.error), true);
check("arm:false does not touch the tool rail", rail2.clicked, 0);

// "polygon" is the id the Earth Engine form shipped with; both spellings must
// resolve or that tab's own control breaks on the rename.
stubDom({ vertices: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { lat: 2, lon: 3 }] });
check("the legacy 'polygon' mode still resolves",
  resolvePolygonExtent("polygon"), { west: 2, south: 1, east: 4, north: 3 });

// ── the select refresher ─────────────────────────────────────────────────
function fakeSelect(values) {
  const options = values.map((v) => ({ value: v, dataset: {}, remove() {} }));
  return {
    value: values[0],
    options,
    appendChild(o) { this.options.push(o); },
    querySelectorAll: () => options.filter((o) => o.dataset.polygon),
  };
}
globalThis.document.createElement = () => ({ dataset: {}, value: "", textContent: "" });
stubDom.doc = globalThis.document;
stubDom({
  layers: [ringLayer(4, "Box A", [[0, 0], [1, 0], [1, 1], [0, 1]])],
});
globalThis.document.createElement = () => ({ dataset: {}, value: "", textContent: "" });
const select = fakeSelect(["global", "view", "drawn"]);
refreshPolygonOptions(select, "global");
check("a drawn polygon becomes an option", select.options.length, 4);
check("it is marked so a rebuild can remove it",
  select.options[3].dataset.polygon, "1");
check("it is named for the layer", select.options[3].textContent, "▱ Box A");
check("the id is addressable", select.options[3].value, "layer:4");

const stale = fakeSelect(["global", "view", "drawn"]);
stale.value = "layer:999";
refreshPolygonOptions(stale, "global");
check("a choice whose layer is gone falls back", stale.value, "global");

// ── Any loaded layer as an extent (the GFS card's rule, kept) ────────────
stubDom({
  layers: [
    ringLayer(1, "Fetch Polygon 1", [[-11, 49], [2, 49], [2, 55], [-11, 55]]),
    { id: 22, name: "NI rivers", status: "loaded", ext: "geojson",
      bounds: { minX: -8.2, minY: 54.0, maxX: -5.3, maxY: 55.4 },
      collection: { features: [{ geometry: { coordinates: [[[0, 0]]] } }] } },
    { id: 23, name: "still importing", status: "loading", bounds: null },
  ],
});
/* The import manager stamps bounds as {minX..maxY}; this module speaks
   {west..north}. Leaking both vocabularies to callers is the exact trap
   drape() documents, so the conversion happens HERE. */
check("an ordinary layer resolves by its bounding box, converted",
  resolvePolygonExtent("layer:22"),
  { west: -8.2, south: 54, east: -5.3, north: 55.4, reusedFrom: "NI rivers" });
check("a drawn polygon still resolves by its ring",
  resolvePolygonExtent("layer:1").reusedFrom, "Fetch Polygon 1");
check("a stale ordinary-layer id is an error, not a silent global",
  Boolean(resolvePolygonExtent("layer:999")?.error), true);

globalThis.document.createElement = () => ({ dataset: {}, value: "", textContent: "" });
const all = fakeSelect(["global", "view", "drawn"]);
refreshPolygonOptions(all, "global", { allLayers: true });
check("allLayers lists the drawn polygon AND the ordinary layer",
  all.options.length, 5);
check("the drawn shape keeps its ▱ and comes first",
  all.options[3].textContent, "▱ Fetch Polygon 1");
check("the ordinary layer is listed plain", all.options[4].textContent, "NI rivers");
check("a layer still importing is not offered",
  all.options.some((o) => o.textContent === "still importing"), false);
const without = fakeSelect(["global", "view", "drawn"]);
refreshPolygonOptions(without, "global");
check("without the flag only drawn shapes are listed", without.options.length, 4);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
