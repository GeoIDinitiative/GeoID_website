/**
 * A FILL TRIANGLE MAY NOT CARRY AN EDGE LONGER THAN A DEGREE.
 *
 * Reported as "geometric patterns on the poles of the soils dataset" — a
 * diamond drawn across the Arctic with fainter arcs behind it. The cause is
 * upstream and the symptom is here: the bake's simplify tolerance is wider
 * than a thin Arctic soil belt, so the belt collapses to a five-point
 * rectangle, the tiler clips it to tile edges, and the renderer is handed a
 * polygon ninety degrees wide. Drawn as a chord that passes through the planet
 * — and with `depthTest: false` it is painted anyway.
 *
 * Run: node GeoID_GIS/viewer/gis/fill-chords.test.mjs
 */

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (e) { failures.push(`${name}: ${e.message}`); console.log(`FAIL ${name}: ${e.message}`); }
};
const ok = (c, what) => { if (!c) throw new Error(what); };

globalThis.window = { GeoIDViewer: { elevationNormalized: () => 0.5, surfacePoint: null } };
const { renderFeatureCollection } = await import("./vector-render.js");

const R = 3.2;
const KM = 6371 / R;                    // one scene unit, in kilometres

const polygon = (ring) => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { code: "x" },
    geometry: { type: "Polygon", coordinates: [ring] } }],
});

/** Every FILL triangle: not the seam (indexed), not the outline (not a mesh). */
function fillStats(fc) {
  const built = renderFeatureCollection(fc, { name: "t", colourFor: () => "#8899aa" });
  let worstKm = 0;
  let triangles = 0;
  built.object3D.traverse((n) => {
    if (!n.isMesh || n.userData?.geoidSeam || n.geometry?.index) return;
    const p = n.geometry.attributes.position;
    for (let i = 0; i + 3 <= p.count; i += 3) {
      triangles += 1;
      for (const [j, k] of [[0, 1], [1, 2], [2, 0]]) {
        const d = Math.hypot(p.getX(i + j) - p.getX(i + k),
          p.getY(i + j) - p.getY(i + k), p.getZ(i + j) - p.getZ(i + k));
        worstKm = Math.max(worstKm, d * KM);
      }
    }
  });
  return { worstKm, triangles };
}

/**
 * THE EXACT RING dumped out of baked tile 2/2/0 — Gelic Gleysols, ninety
 * degrees of longitude and seven hundredths of a degree of latitude. Before
 * the fix its triangles reached 3,263 km even from a densified ring.
 */
const ARCTIC_STRIP = [
  [0, 68.753], [90, 68.784], [90, 68.712], [0, 68.712], [0, 68.753],
];

check("a tile-wide sliver is not drawn as a chord through the planet", () => {
  const { worstKm, triangles } = fillStats(polygon(ARCTIC_STRIP));
  ok(triangles > 100, `it was actually filled: ${triangles} triangles`);
  // Two degrees of arc is 222 km, and the measure is max(|dlon|,|dlat|), so a
  // diagonal edge may be root-two longer. 330 km is that, with room.
  ok(worstKm < 330, `worst edge ${worstKm.toFixed(0)} km`);
});

/**
 * The sag is the reason for the number. A chord across 90° leaves the surface
 * by R(1 - cos 45°) = 1,866 km; across 1.4° it is 480 m, which is under a
 * screen pixel at any altitude the fill is legible from.
 */
check("and what is left sags by metres rather than by thousands of kilometres", () => {
  const { worstKm } = fillStats(polygon(ARCTIC_STRIP));
  const halfAngle = (worstKm / 6371) / 2;
  const sagKm = 6371 * (1 - Math.cos(halfAngle));
  // The 3,873 km chord left the surface by 147 km. This one is measured at
  // 58 km and 130 m -- under a screen pixel at any altitude a zoom-2 polygon
  // is drawn from.
  ok(sagKm < 1, `sag ${(sagKm * 1000).toFixed(0)} m`);
});

check("a polygon already finer than the rule is left alone", () => {
  // Four degrees a side: split, but only to the same rule.
  const coarse = fillStats(polygon([[10, 40], [14, 40], [14, 44], [10, 44], [10, 40]]));
  ok(coarse.worstKm < 330, `worst edge ${coarse.worstKm.toFixed(0)} km`);
  // Under the threshold on every edge, so nothing is added at all -- which is
  // the ordinary case for every polygon on every map here.
  const fine = fillStats(polygon([[10, 40], [11, 40], [11, 41], [10, 41], [10, 40]]));
  ok(fine.triangles === 2, `an untouched quad is two triangles, not ${fine.triangles}`);
});

/**
 * The cost is what decided the approach. Densifying the RING first and then
 * splitting produced 65,998 triangles in 220 ms for this one polygon, against
 * 3,734 in 37 ms for splitting alone -- and the same worst edge either way.
 */
check("the split is bounded, so a pathological polygon cannot hang the page", () => {
  const started = Date.now();
  const { triangles } = fillStats(polygon(ARCTIC_STRIP));
  const ms = Date.now() - started;
  ok(triangles < 20000, `${triangles} triangles`);
  ok(ms < 2000, `${ms} ms`);
});

/** A whole-world ring: the zoom-0 case, 359.9° wide. */
check("even the zoom-0 span, which is the whole world, comes back to the ground", () => {
  const { worstKm, triangles } = fillStats(polygon([
    [-179.95, 68.75], [179.95, 68.8], [179.95, 68.7], [-179.95, 68.7], [-179.95, 68.75],
  ]));
  ok(triangles > 100, `filled: ${triangles}`);
  ok(worstKm < 200, `worst edge ${worstKm.toFixed(0)} km`);
});

if (failures.length) {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.error(`${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
