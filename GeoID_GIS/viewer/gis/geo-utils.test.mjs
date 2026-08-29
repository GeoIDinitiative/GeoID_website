/**
 * Spherical polygon area.
 *
 * This is the number every study area is quoted by — the measure readout, the
 * saved area, the extraction summary — and a wrong one is completely invisible:
 * the polygon still draws, the extraction still runs, and the figure beside it
 * is simply false. So it is checked against closed-form answers, and above all
 * against **itself at different vertex counts**, which is the property the
 * previous implementation lacked.
 *
 * Run: node GeoID_GIS/viewer/gis/geo-utils.test.mjs
 */

import { sphericalPolygonAreaKm2, EARTH_MEAN_RADIUS_KM as R } from "./geo-utils.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const near = (name, got, want, tolFraction) =>
  check(name, Math.abs(got - want) <= Math.abs(want) * tolFraction,
    `got ${Math.round(got).toLocaleString()}, want ${Math.round(want).toLocaleString()}`);

const rad = (d) => (d * Math.PI) / 180;
/** Closed form for a lat/lon box: R² Δλ (sin φ₂ − sin φ₁). */
const boxArea = (south, north, west, east) =>
  R * R * rad(east - west) * (Math.sin(rad(north)) - Math.sin(rad(south)));

/** The ring a box produces, optionally subdivided as the Draw tool does. */
function ring(south, north, west, east, maxSegmentDeg) {
  const corners = [
    { lat: south, lon: west }, { lat: south, lon: east },
    { lat: north, lon: east }, { lat: north, lon: west },
  ];
  const out = [];
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const steps = maxSegmentDeg
      ? Math.max(1, Math.ceil(
        Math.max(Math.abs(b.lat - a.lat), Math.abs(b.lon - a.lon)) / maxSegmentDeg))
      : 1;
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
  }
  return out;
}

// ── Against the closed form ──────────────────────────────────────────────────
{
  const box = [-3.347467, -0.652533, 20.651712, 23.348288];   // the 300 km box
  near("a 300 km box matches the closed form",
    sphericalPolygonAreaKm2(ring(...box)), boxArea(...box), 1e-6);
}
{
  const box = [20, 60, 0, 40];                                 // 40° x 40°
  near("and so does a 40-degree box",
    sphericalPolygonAreaKm2(ring(...box)), boxArea(...box), 1e-6);
}
// A hemisphere is half the sphere, which is the strongest single check there is.
near("a hemisphere is half the globe",
  sphericalPolygonAreaKm2(ring(-90, 90, 0, 180, 1)), 2 * Math.PI * R * R, 1e-3);

// ── Subdivision invariance: the property that was missing ────────────────────
// The old implementation gave 89,806 at 4 vertices and then 58,939 / 96,124 /
// 113,026 at 12 / 24 / 44 — diverging with vertex count rather than converging.
{
  const box = [-3.347467, -0.652533, 20.651712, 23.348288];
  const exact = boxArea(...box);
  const counts = [];
  for (const seg of [null, 1, 0.5, 0.25, 0.1]) {
    const pts = ring(...box, seg);
    counts.push({ n: pts.length, area: sphericalPolygonAreaKm2(pts) });
  }
  const spread = Math.max(...counts.map((c) => c.area)) - Math.min(...counts.map((c) => c.area));
  check("subdividing an edge cannot change the area",
    spread / exact < 1e-9, `${counts.map((c) => `${c.n}v:${Math.round(c.area)}`).join(" ")}`);
  check("and every count matches the closed form",
    counts.every((c) => Math.abs(c.area - exact) / exact < 1e-6));
}

// ── Winding, wrapping and degenerate input ───────────────────────────────────
{
  const box = [10, 20, 10, 20];
  const forward = sphericalPolygonAreaKm2(ring(...box, 1));
  const backward = sphericalPolygonAreaKm2(ring(...box, 1).reverse());
  near("winding does not change the area", backward, forward, 1e-12);
}
{
  // Across the antimeridian: 170°E to 190°E is 20° of longitude, not 340.
  const wrapped = sphericalPolygonAreaKm2(ring(-5, 5, 170, 190, 1));
  near("a polygon over the antimeridian takes the short way round",
    wrapped, boxArea(-5, 5, 170, 190), 1e-6);
  check("rather than most of the planet", wrapped < 0.05 * 4 * Math.PI * R * R,
    `${Math.round(wrapped).toLocaleString()} km2`);
}
check("fewer than three points has no area", sphericalPolygonAreaKm2([{ lat: 0, lon: 0 }]) === 0);
check("nothing has no area", sphericalPolygonAreaKm2(null) === 0);
{
  // A degenerate ring -- every vertex the same place -- is zero, not NaN.
  const same = [{ lat: 5, lon: 5 }, { lat: 5, lon: 5 }, { lat: 5, lon: 5 }];
  check("a collapsed polygon is zero, not NaN", sphericalPolygonAreaKm2(same) === 0);
}

// ── Another body ─────────────────────────────────────────────────────────────
{
  // The radius is a parameter, so a Mars study area is quoted in Mars km2.
  const marsR = 3389.5;
  near("a different radius scales as the square",
    sphericalPolygonAreaKm2(ring(0, 10, 0, 10, 1), marsR),
    sphericalPolygonAreaKm2(ring(0, 10, 0, 10, 1)) * (marsR / R) ** 2, 1e-9);
}

/* ── The radius the area is measured ON ──────────────────────────────────────
   The default used to be Earth's constant, and four callers took it — so
   every area quoted on a planet was scaled by (R_earth / R_body)^2. Measured
   on Mars: a 4x3 degree box near Olympus Mons recorded 140,689 km2 against a
   true 39,826, which is exactly 3.533. */
{
  const box = [
    { lat: 17, lon: 224 }, { lat: 17, lon: 228 },
    { lat: 20, lon: 228 }, { lat: 20, lon: 224 },
  ];
  const MARS_KM = 3389.5;
  const onEarth = sphericalPolygonAreaKm2(box);
  const onMars = sphericalPolygonAreaKm2(box, MARS_KM);
  check("an explicit radius is honoured",
    Math.abs(onMars / onEarth - (MARS_KM / 6371.0088) ** 2) < 1e-6,
    `${(onMars / onEarth).toFixed(4)}`);
  check("the Mars box is about 39,800 km2, not 140,000",
    Math.abs(onMars - 39826) < 400, onMars.toFixed(0));

  // With a viewer on the page, the DEFAULT follows the body.
  const had = typeof globalThis.window !== "undefined" ? globalThis.window : undefined;
  globalThis.window = { GeoIDViewer: { bodyRadiusKm: MARS_KM } };
  const byDefault = sphericalPolygonAreaKm2(box);
  if (had === undefined) delete globalThis.window; else globalThis.window = had;
  check("and the default is THIS body's radius, not Earth's",
    Math.abs(byDefault - onMars) < 1e-6, `${byDefault.toFixed(0)} vs ${onMars.toFixed(0)}`);
  check("with no viewer at all it falls back to Earth",
    Math.abs(sphericalPolygonAreaKm2(box) - onEarth) < 1e-6);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
