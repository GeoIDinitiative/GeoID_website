/**
 * Turning a drawn shape into a layer.
 *
 * The conversion is where the coordinate conventions meet: the viewer carries
 * east-positive 0..360 and a GeoJSON ring is signed and closed. Getting either
 * wrong puts a Sicilian study area in the mid-Atlantic, which is a fault this
 * project has already had once through `signedLon`.
 */

globalThis.window = globalThis;
const { drawnFeature } = await import("./drawn-layers.js");

let passed = 0;
const failures = [];
function check(name, fn) { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } }
function eq(a, b, what) { if (a !== b) throw new Error(`${what || "value"} — expected ${b}, got ${a}`); }

const box = (pts, areaKm2 = null) => ({ vertices: pts.map(([lat, lon]) => ({ lat, lon })), areaKm2 });

check("a drawn box becomes a closed signed ring", () => {
  const f = drawnFeature(box([[54, -7], [54, -6], [55, -6], [55, -7]]));
  const ring = f.geometry.coordinates[0];
  eq(ring.length, 5, "four corners and the closing point");
  eq(ring[0][0], -7, "longitude is signed");
  eq(ring[0][1], 54, "latitude");
  eq(JSON.stringify(ring[0]), JSON.stringify(ring[4]), "the ring closes");
});

check("east-positive longitude comes back signed", () => {
  // 353.2 is what the viewer's own readout says over Ireland; unconverted it
  // is the middle of the Pacific.
  const f = drawnFeature(box([[54, 353], [54, 354], [55, 354]]));
  eq(f.geometry.coordinates[0][0][0], -7, "converted");
});

check("an already-closed ring is not closed twice", () => {
  const f = drawnFeature(box([[54, -7], [54, -6], [55, -6], [54, -7]]));
  eq(f.geometry.coordinates[0].length, 4, "unchanged");
});

check("fewer than three points is not a polygon", () => {
  eq(drawnFeature(box([[54, -7], [54, -6]])), null, "two points");
  eq(drawnFeature(null), null, "nothing");
});

check("the area and vertex count travel as attributes", () => {
  // The area is computed from the ring, not taken from the draw tool — the
  // study geometry does not always carry one, and an attribute that is
  // sometimes null cannot be charted or sorted by. A 1x1 degree triangle at
  // 54N is about 3,590 km2.
  const f = drawnFeature(box([[54, -7], [54, -6], [55, -6]]));
  if (!(f.properties.area_km2 > 3000 && f.properties.area_km2 < 4200)) {
    throw new Error(`area came out ${f.properties.area_km2}`);
  }
  eq(f.properties.vertices, 3, "vertices");
  eq(f.properties.kind, "drawn", "kind");
});

check("a name can be given, and null options are survivable", () => {
  const shape = box([[1, 1], [1, 2], [2, 2]]);
  eq(drawnFeature(shape, { name: "Site A" }).properties.name, "Site A", "given");
  eq(drawnFeature(shape).properties.name.startsWith("Drawn area"), true, "default");
  eq(drawnFeature(shape, null).properties.name.startsWith("Drawn area"), true, "explicit null");
});

check("a vertex with a bad coordinate is dropped, not made NaN", () => {
  const f = drawnFeature({ vertices: [
    { lat: 54, lon: -7 }, { lat: 54, lon: -6 }, { lat: 55, lon: -6 }, { lat: NaN, lon: 0 }] });
  eq(f.geometry.coordinates[0].length, 4, "three good points plus the close");
  eq(f.geometry.coordinates[0].every((c) => c.every(Number.isFinite)), true, "no NaN survived");
});

if (failures.length) {
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
