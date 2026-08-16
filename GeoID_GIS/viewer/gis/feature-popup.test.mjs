/**
 * The hit test behind the click-for-popup.
 *
 * These run in node against a stubbed import manager, because the thing that
 * broke was pure: `boundsOf` answers an OBJECT and the pre-filter indexed it
 * as an array, so every comparison was `undefined >= NaN` — false — and the
 * search rejected every feature on the globe before it ever reached
 * `pointInPolygon`. A hit test that silently never hits looks exactly like a
 * layer that failed to load, which is where the debugging went first.
 *
 * The last case reads the shipped BGS bedrock file and asserts a named unit at
 * a known coordinate, so a change to the shipping pipeline that mangles the
 * geometry fails here rather than in someone's hands.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what || "value"} — expected ${expected}, got ${actual}`);
  }
}

/* The module writes to window on import; give it one and take it back after. */
globalThis.window = globalThis;
globalThis.document = {
  readyState: "complete",
  addEventListener() {},
  querySelector: () => null,
  getElementById: () => null,
  createElement: () => ({ style: {}, append() {}, appendChild() {},
    setAttribute() {}, addEventListener() {}, getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
  head: { appendChild() {} },
  body: { appendChild() {} },
};

const { featureAt } = await import("./feature-popup.js");

function square(cx, cy, half, props) {
  return {
    type: "Feature",
    properties: props,
    geometry: {
      type: "Polygon",
      coordinates: [[
        [cx - half, cy - half], [cx + half, cy - half],
        [cx + half, cy + half], [cx - half, cy + half], [cx - half, cy - half],
      ]],
    },
  };
}

function stubLayers(layers) {
  globalThis.GeoIDImportManager = { getVectorLayers: () => layers };
}

check("a point inside a polygon finds it", () => {
  stubLayers([{ name: "Units", features: [square(-6, 54, 0.5, { lex_d: "GALA GROUP" })] }]);
  const hit = featureAt(54, -6);
  eq(hit?.feature.properties.lex_d, "GALA GROUP", "unit");
});

check("a point outside every polygon finds nothing", () => {
  stubLayers([{ name: "Units", features: [square(-6, 54, 0.5, { lex_d: "GALA GROUP" })] }]);
  eq(featureAt(54, -2), null, "hit");
});

check("the bounds pre-filter does not reject a real hit", () => {
  // The regression: boundsOf returns {minX,…}. If inBounds indexes it
  // numerically this fails while pointInPolygon alone would pass.
  stubLayers([{ name: "Units", features: [square(-6.775, 54.67, 0.01, { lex_d: "TINY" })] }]);
  eq(featureAt(54.67, -6.775)?.feature.properties.lex_d, "TINY", "unit");
});

check("the topmost layer wins", () => {
  stubLayers([
    { name: "Bedrock", features: [square(-6, 54, 1, { lex_d: "UNDER" })] },
    { name: "Superficial", features: [square(-6, 54, 1, { lex_d: "OVER" })] },
  ]);
  eq(featureAt(54, -6)?.feature.properties.lex_d, "OVER", "unit");
});

check("a hidden layer is not picked", () => {
  stubLayers([{ name: "Units", visible: false,
    features: [square(-6, 54, 1, { lex_d: "HIDDEN" })] }]);
  eq(featureAt(54, -6), null, "hit");
});

check("a line is picked by proximity, a distant one is not", () => {
  const river = { type: "Feature", properties: { name: "Lagan" },
    geometry: { type: "LineString", coordinates: [[-6, 54], [-6, 54.2]] } };
  stubLayers([{ name: "Rivers", features: [river] }]);
  // ~11 m off the line — inside any sane tolerance.
  eq(featureAt(54.1, -6.0001)?.feature.properties.name, "Lagan", "near");
  // 0.4° away — about 44 km, past the ceiling.
  eq(featureAt(54.1, -5.6), null, "far");
});

check("the shipped BGS bedrock answers at a known coordinate", () => {
  const file = path.join(here, "../../../ni-prototype/data/ni_bedrock.geojson");
  if (!fs.existsSync(file)) throw new Error("ni_bedrock.geojson is not shipped");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  stubLayers([{ name: "NI bedrock geology (BGS 625k).geojson", features: data.features }]);
  const hit = featureAt(54.30, -6.30);
  eq(hit?.feature.properties.lex_d, "GALA GROUP", "unit at 54.30N 6.30W");
  if (Object.keys(hit.feature.properties).length < 40) {
    throw new Error("the popup reads the attributes; they were dropped");
  }
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
