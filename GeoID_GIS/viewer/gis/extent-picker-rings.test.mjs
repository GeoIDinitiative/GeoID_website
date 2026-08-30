/**
 * "Which patch of ground?" must be answered ONCE, and a shape you already drew
 * must count.
 *
 * `extent-picker` was lifted out so this question would stop being answered
 * three ways, and the extraction panel never adopted it: it kept its own option
 * list and its own "drawn" branch that read the LIVE overlay and nothing else.
 * Pressing Done CAPTURES the shape and clears that overlay — so the moment a
 * drawing became a real layer, extraction answered "Mark out an area first"
 * about a polygon sitting in front of the user.
 *
 * The fallback chain is the whole point and is what these pin.
 */
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}`); }
};

globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };

const ring = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const drawnLayer = (id, name, visible = true) => ({
  id, name, visible, status: "loaded", ext: "drawn",
  collection: { type: "FeatureCollection", features: [{ type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [ring(-6, 54, -5, 55)] } }] },
});

const setLayers = (layers) => { window.GeoIDImportManager = { getLayers: () => layers }; };
const setDrawn = (vertices) => {
  window.GeoIDViewer = { getExtractionGeometry: () => (vertices ? { vertices, center: vertices[0] } : null) };
};

const { resolvePolygonRings } = await import("./extent-picker.js");

// 1. the live overlay wins when there is one
{
  setLayers([drawnLayer(1, "Study area 1")]);
  setDrawn([{ lat: 10, lon: 20 }, { lat: 11, lon: 21 }, { lat: 10, lon: 22 }]);
  const r = resolvePolygonRings("drawn");
  ok("the live overlay is used when something is being drawn",
    r.label === "the drawn area" && r.layerId === null && r.rings.length === 1);
  ok("and it carries the vertices actually drawn", r.rings[0].vertices.length === 3);
}

// 2. THE FIX: nothing live, but a captured polygon is on the globe
{
  setLayers([drawnLayer(1, "Study area 1")]);
  setDrawn(null);
  const r = resolvePolygonRings("drawn");
  ok("a PRE-EXISTING drawn polygon is used when nothing is live",
    !r.error && r.label === "Study area 1" && r.layerId === "1");
  ok("and it is the polygon itself, not a bounding box", r.rings.length === 1
    && Array.isArray(r.rings[0].vertices) && r.rings[0].vertices.length >= 4);
  ok("the mask is the layer's own collection, not a rebuild",
    r.maskFc === setLayersLast().collection);
}
function setLayersLast() { return window.GeoIDImportManager.getLayers()[0]; }

// 3. the NEWEST visible one, and hidden ones are not the fallback
{
  setLayers([drawnLayer(1, "Study area 1"), drawnLayer(2, "Study area 2")]);
  setDrawn(null);
  ok("the newest drawn polygon is the fallback", resolvePolygonRings("drawn").layerId === "2");
  setLayers([drawnLayer(1, "Study area 1"), drawnLayer(2, "Study area 2", false)]);
  ok("a HIDDEN polygon is not the fallback — it is not on the globe to reuse",
    resolvePolygonRings("drawn").layerId === "1");
}

// 4. nothing at all: an honest error, and no arming in a headless check
{
  setLayers([]);
  setDrawn(null);
  const r = resolvePolygonRings("drawn", { arm: false });
  ok("with nothing drawn it refuses in a sentence", Boolean(r.error) && !r.rings);
  ok("and does not claim the tool was armed", !/now active/.test(r.error));
}

// 5. an explicit layer is exact, and a removed one is an error rather than
//    a silent resolve to nothing
{
  setLayers([drawnLayer(7, "Buffer 1")]);
  setDrawn([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }, { lat: 1, lon: 3 }]);
  ok("an explicit layer beats the live overlay",
    resolvePolygonRings("layer:7").layerId === "7");
  ok("a layer that is gone is an error, not an empty area",
    Boolean(resolvePolygonRings("layer:999").error));
}

// 6. a mode this module does not own is handed back, so callers keep their own
{
  ok("an unknown mode answers null", resolvePolygonRings("global") === null);
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
