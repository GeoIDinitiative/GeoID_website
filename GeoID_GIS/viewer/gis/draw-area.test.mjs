/**
 * The preset box.
 *
 * A box that is the wrong size still draws, still reports an area, and still
 * extracts — it is simply wrong about the ground it covers, which no amount of
 * looking at it will reveal. So the dimensions are checked against distances
 * computed independently of the code under test.
 *
 * Run: node GeoID_GIS/viewer/gis/draw-area.test.mjs
 */

import { rectangleVertices, lonDegPerKm, kmPerDegLat, EARTH_RADIUS_KM } from "./draw-area.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const close = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

/** Haversine, so the check does not share arithmetic with the thing checked. */
const R = 6371.0088;
function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── The size it says it is ───────────────────────────────────────────────────
{
  // Etna, in the viewer's east-positive convention.
  const box = rectangleVertices({ lat: 37.75, lon: 14.99, widthKm: 10, heightKm: 10 });
  check("a small box is built", Boolean(box) && box.vertices.length >= 4);
  const { south, north, west, east } = box.bounds;
  close("it is 10 km tall on the ground",
    haversineKm({ lat: south, lon: west }, { lat: north, lon: west }), 10, 0.05);
  // Width is exact at the centre latitude, which is what a bounding box means.
  close("and 10 km wide at the centre latitude",
    haversineKm({ lat: 37.75, lon: west }, { lat: 37.75, lon: east }), 10, 0.05);
  check("the flat area hint is the product asked for", box.areaHintKm2 === 100);
}

// The north edge really is shorter than the south edge — the documented limit,
// pinned so nobody "fixes" it into a claim the geometry does not support.
{
  const box = rectangleVertices({ lat: 60, lon: 10, widthKm: 200, heightKm: 200 });
  const { south, north, west, east } = box.bounds;
  const southEdge = haversineKm({ lat: south, lon: west }, { lat: south, lon: east });
  const northEdge = haversineKm({ lat: north, lon: west }, { lat: north, lon: east });
  check("a tall box is narrower along its north edge", northEdge < southEdge,
    `${northEdge.toFixed(1)} vs ${southEdge.toFixed(1)} km`);
  close("and exact across the middle",
    haversineKm({ lat: 60, lon: west }, { lat: 60, lon: east }), 200, 0.5);
}

// ── Latitude scaling ─────────────────────────────────────────────────────────
// Against the MEAN radius, which is what the haversine check above uses too.
// These expected 111.32 -- the degree at the equatorial radius, 6378 km -- while
// the code now derives them from whichever radius the body has.
close("a degree of longitude is ~111 km at the equator", 1 / lonDegPerKm(0), 111.195, 0.01);
close("and about half that at 60°", 1 / lonDegPerKm(60), 55.60, 0.05);
check("it never divides by zero at the pole", Number.isFinite(lonDegPerKm(90)));

// ── Subdivision ──────────────────────────────────────────────────────────────
{
  // A chord across 12° of arc sags 0.0175 below the surface; 1° keeps it at
  // 0.0001, so a large box must be split rather than drawn corner to corner.
  const big = rectangleVertices({ lat: 0, lon: 0, widthKm: 2000, heightKm: 2000 });
  let longest = 0;
  for (let i = 0; i < big.vertices.length; i += 1) {
    const a = big.vertices[i];
    const b = big.vertices[(i + 1) % big.vertices.length];
    longest = Math.max(longest, Math.abs(a.lat - b.lat), Math.abs(a.lon - b.lon));
  }
  check("a continental box is split to follow the ground", longest <= 1.0001,
    `longest segment ${longest.toFixed(3)}°`);
  check("and a small one is not needlessly dense",
    rectangleVertices({ lat: 0, lon: 0, widthKm: 10, heightKm: 10 }).vertices.length === 4);
}

// ── Refusals ─────────────────────────────────────────────────────────────────
check("no size, no box", rectangleVertices({ lat: 0, lon: 0, widthKm: 0, heightKm: 5 }) === null);
check("a negative size is not a box",
  rectangleVertices({ lat: 0, lon: 0, widthKm: -5, heightKm: 5 }) === null);
check("no centre, no box", rectangleVertices({ widthKm: 5, heightKm: 5 }) === null);
check("text is not a size",
  rectangleVertices({ lat: 0, lon: 0, widthKm: "wide", heightKm: 5 }) === null);

// ── Poles ────────────────────────────────────────────────────────────────────
{
  const polar = rectangleVertices({ lat: 89.9, lon: 0, widthKm: 500, heightKm: 500 });
  check("a box at the pole stays on the globe",
    polar.vertices.every((v) => v.lat <= 90 && v.lat >= -90), JSON.stringify(polar.bounds));
}

// ── The viewer's longitude convention is preserved ───────────────────────────
{
  // 300°E must stay 300°E, not become -60: the viewer is east-positive 0-360
  // and converting here would put the box a hemisphere away.
  const box = rectangleVertices({ lat: 0, lon: 300, widthKm: 10, heightKm: 10 });
  check("east-positive longitude is left alone",
    box.vertices.every((v) => v.lon > 299 && v.lon < 301), `${box.vertices[0].lon}`);
}

// ── Other worlds ─────────────────────────────────────────────────────────────
// The Draw tool is on every world, and a degree is not 111 km on any of the
// others. Hard-coding Earth's made a "200 km" box on Mars 106 km across, which
// reported 11,296 km2 against the 40,000 asked for -- exactly (R_e/R_m)^2 out.
{
  const MARS_R = 3389.5;
  const marsKm = (a, b) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * MARS_R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const box = rectangleVertices({ lat: 0, lon: 80, widthKm: 200, heightKm: 200, radiusKm: MARS_R });
  const { south, north, west, east } = box.bounds;
  close("a 200 km box on Mars is 200 km tall on Mars",
    marsKm({ lat: south, lon: west }, { lat: north, lon: west }), 200, 0.5);
  close("and 200 km wide at its centre latitude",
    marsKm({ lat: 0, lon: west }, { lat: 0, lon: east }), 200, 0.5);
  // The same request on Earth's radius must span more degrees, not fewer.
  const earth = rectangleVertices({ lat: 0, lon: 80, widthKm: 200, heightKm: 200 });
  check("a Mars box spans more degrees than an Earth one of the same size",
    (box.bounds.north - box.bounds.south) > (earth.bounds.north - earth.bounds.south),
    `${(box.bounds.north - box.bounds.south).toFixed(2)}° vs ${(earth.bounds.north - earth.bounds.south).toFixed(2)}°`);
}
close("a degree of latitude is ~111 km on Earth", kmPerDegLat(), 111.19, 0.02);
close("and ~59 km on Mars", kmPerDegLat(3389.5), 59.16, 0.02);
check("the default radius is Earth's", kmPerDegLat(EARTH_RADIUS_KM) === kmPerDegLat());

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
