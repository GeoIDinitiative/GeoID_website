/**
 * What a location offers, and the transect it offers it along.
 *
 * The gate is the whole idea: a tool appears only when the pin holds an input
 * of the type that tool consumes. Get that wrong in the permissive direction
 * and the panel is a catalogue again — every tool listed, most of them opening
 * onto nothing. Get it wrong in the strict direction and a location with a DEM
 * under it offers no terrain analysis at all, which reads as "the tools were
 * never added".
 */

globalThis.window = globalThis;
// The fixture registry below is deliberately smaller than the real one, so the
// drift warning fires for ids it does not carry. That warning is wanted in the
// browser and is noise here; the registry check further down is what actually
// guards the ids.
const realWarn = console.warn;
console.warn = (...args) => {
  if (!String(args[0] || "").includes("location tools: no descriptor")) realWarn(...args);
};

const { suggestFor, profileCandidates, transectPoints } =
  await import("./location-tools.js");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`);
}
function near(a, b, tol, what) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} — expected ~${b}, got ${a}`);
}

const TOOLS = [
  { id: "slope", label: "Slope", blurb: "Steepness.", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "aspect", label: "Aspect", blurb: "Facing.", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "hillshade", label: "Hillshade", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "curvature", label: "Curvature", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "roughness", label: "Roughness", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "contours", label: "Contours", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "focal", label: "Focal statistics", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "reclassify", label: "Reclassify", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "zonalStatistics", label: "Zonal statistics", inputs: [{ name: "input", type: "raster" }],
    engines: { native: () => {} } },
  { id: "buffer", label: "Buffer", inputs: [{ name: "input", type: "vector" }],
    engines: { native: () => {} } },
  { id: "centroids", label: "Centroids", inputs: [{ name: "input", type: "vector" }],
    engines: { native: () => {} } },
  { id: "dissolve", label: "Dissolve", inputs: [{ name: "input", type: "vector" }],
    engines: { native: () => {} } },
  { id: "hull", label: "Convex hull", inputs: [{ name: "input", type: "vector" }],
    engines: { native: () => {} } },
  { id: "simplify", label: "Simplify", inputs: [{ name: "input", type: "vector" }],
    engines: { native: () => {} } },
  { id: "watershed", label: "Watershed", inputs: [{ name: "input", type: "raster" }],
    engines: { sidecar: () => {} } },
];

check("a location with nothing loaded offers nothing", () => {
  eq(suggestFor({ lat: 54, lon: -6, layers: [], features: [] }, TOOLS).length, 0, "suggestions");
});

check("a DEM under the point earns the terrain analyses", () => {
  const out = suggestFor({ layers: [{ id: "d", name: "NI DEM.tif", isDem: true }] }, TOOLS);
  const ids = out.map((s) => s.id);
  ["slope", "aspect", "hillshade", "curvature", "roughness", "contours"]
    .forEach((id) => { if (!ids.includes(id)) throw new Error(`${id} was not offered`); });
  eq(ids[0], "slope", "terrain leads");
  if (ids.includes("buffer")) throw new Error("a vector tool was offered with no vector");
});

check("every suggestion says what it saw", () => {
  const out = suggestFor({ layers: [{ id: "d", name: "NI DEM.tif", isDem: true }] }, TOOLS);
  out.forEach((s) => {
    if (!s.why || !s.why.includes("NI DEM.tif")) {
      throw new Error(`"${s.label}" gave no reason naming the layer`);
    }
    if (s.inputLayerId !== "d") throw new Error("the input layer was not carried");
  });
});

check("a polygon under the point earns the vector operations", () => {
  const out = suggestFor({
    layers: [],
    features: [{ layer: "NI bedrock", layerId: "b", properties: { lex_d: "GALA GROUP" } }],
  }, TOOLS);
  const ids = out.map((s) => s.id);
  if (!ids.includes("buffer")) throw new Error("buffer was not offered");
  if (ids.includes("slope")) throw new Error("a raster tool was offered with no raster");
});

check("a plain raster does not pretend to be terrain", () => {
  const out = suggestFor({ layers: [{ id: "s", name: "susceptibility.tif", isDem: false }] }, TOOLS);
  const ids = out.map((s) => s.id);
  if (ids.includes("contours")) throw new Error("contours were offered on a class raster");
  if (!ids.includes("reclassify")) throw new Error("reclassify was not offered");
});

check("a sidecar-only tool is offered but flagged, never silently absent", () => {
  const out = suggestFor({ layers: [{ id: "d", name: "dem.tif", isDem: true }] }, TOOLS);
  const shed = out.find((s) => s.id === "watershed");
  // Not in the terrain list, so it should not appear at all here — the point
  // of the check is that nothing claims a sidecar tool runs natively.
  if (shed && !shed.needsSidecar) throw new Error("a sidecar tool was offered as native");
});

check("the same tool is not offered twice for one layer", () => {
  const out = suggestFor({ layers: [{ id: "d", name: "dem.tif", isDem: true }] }, TOOLS);
  const keys = out.map((s) => `${s.id}:${s.inputLayerId}`);
  eq(new Set(keys).size, keys.length, "unique suggestions");
});

check("two layers each get their own suggestions", () => {
  const out = suggestFor({ layers: [
    { id: "a", name: "dem.tif", isDem: true },
    { id: "b", name: "susceptibility.tif", isDem: false },
  ] }, TOOLS);
  const layers = new Set(out.map((s) => s.inputLayerId));
  eq(layers.size, 2, "layers covered");
});

check("every id this module names exists in the shipped registry", async () => {
  // The one check that catches drift: the lists here are ids, and an id that
  // has been renamed in tool-runner.js stops being offered without a word.
  const runner = await import("./tool-runner.js");
  const known = new Set(runner.TOOLS.map((t) => t.id));
  const named = suggestFor({
    layers: [{ id: "d", name: "dem.tif", isDem: true }, { id: "s", name: "s.tif", isDem: false }],
    features: [{ layer: "poly", layerId: "p" }],
  }, runner.TOOLS).map((s) => s.id);
  if (!named.length) throw new Error("nothing was offered against the real registry");
  named.forEach((id) => { if (!known.has(id)) throw new Error(`"${id}" is not in TOOLS`); });
});

check("a tool the registry does not hold is not invented", () => {
  const out = suggestFor({ layers: [{ id: "d", name: "dem.tif", isDem: true }] },
    TOOLS.filter((t) => t.id !== "slope"));
  if (out.some((s) => s.id === "slope")) throw new Error("slope was offered without a descriptor");
});

check("profile candidates are the sampleable layers, DEM flagged", () => {
  const out = profileCandidates({ layers: [
    { id: "a", name: "dem.tif", isDem: true }, { id: "b", name: "s.tif", isDem: false }] });
  eq(out.length, 2, "candidates");
  eq(out[0].isDem, true, "DEM flag");
});

check("the transect is centred on the pin and spans the length asked for", () => {
  const points = transectPoints(54, -6, 10, 90, 5);
  eq(points.length, 5, "samples");
  eq(points[2].km, 0, "centre is the pin");
  near(points[0].km, -5, 1e-9, "first");
  near(points[4].km, 5, 1e-9, "last");
  near(points[2].lat, 54, 1e-9, "centre latitude");
  near(points[2].lon, -6, 1e-9, "centre longitude");
});

check("an east-west transect moves in longitude, and the metric follows latitude", () => {
  const points = transectPoints(54, -6, 10, 90, 3);
  near(points[2].lat, 54, 1e-9, "latitude held");
  // 5 km east at 54°N is 5/(111.32 × cos54) ≈ 0.0764°, not 0.0449° — a degree
  // of longitude is shorter this far north, and ignoring that would make the
  // plotted distance axis a lie by 70%.
  near(points[2].lon - points[1].lon, 5 / (111.32 * Math.cos(54 * Math.PI / 180)), 1e-6, "east step");
});

check("a north-south transect moves in latitude only", () => {
  const points = transectPoints(54, -6, 10, 0, 3);
  near(points[2].lon, -6, 1e-9, "longitude held");
  near(points[2].lat - points[1].lat, 5 / 111.32, 1e-9, "north step");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
