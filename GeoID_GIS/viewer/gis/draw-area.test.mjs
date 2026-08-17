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

import {
  rectangleVertices, regularPolygonVertices, lineVertices,
  lonDegPerKm, kmPerDegLat, EARTH_RADIUS_KM,
} from "./draw-area.js";

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

// ── Regular polygons ─────────────────────────────────────────────────────────
// A shape that is the wrong size draws just as convincingly as one that is not.
// So the edges are measured with haversine, which shares no arithmetic with the
// code under test, and the vertex count is checked BEFORE subdivision can hide a
// shape that came out with the wrong number of corners.
{
  const near = { lat: 37.75, lon: 14.99 };   // Etna, east-positive.
  [3, 4, 5, 6].forEach((n) => {
    const shape = regularPolygonVertices({ ...near, sides: n, sideKm: 10 });
    check(`a ${n}-sided shape has ${n} corners`, shape.vertices.length === n,
      `got ${shape.vertices.length}`);
    // Every edge the same length, and that length the one asked for.
    const edges = shape.vertices.map((v, i) =>
      haversineKm(v, shape.vertices[(i + 1) % shape.vertices.length]));
    const worst = Math.max(...edges.map((e) => Math.abs(e - 10)));
    check(`and every edge is 10 km`, worst <= 0.06, `worst edge off by ${worst.toFixed(3)} km`);
  });

  // The whole point of quoting size as an EDGE: a 4-sided shape at 10 km must be
  // the same object the box preset calls a 10 km square. If these two ever
  // disagree, one of the two controls is lying about the ground it covers.
  const square = regularPolygonVertices({ ...near, sides: 4, sideKm: 10, rotationDeg: 45 });
  const box = rectangleVertices({ ...near, widthKm: 10, heightKm: 10 });
  close("a 4-sided 10 km shape is the 10 km box",
    square.areaHintKm2, box.areaHintKm2, 0.001);
  const lats = square.vertices.map((v) => v.lat);
  const lons = square.vertices.map((v) => v.lon);
  close("and lands on the same north edge", Math.max(...lats), box.bounds.north, 0.0005);
  close("and the same west edge", Math.min(...lons), box.bounds.west, 0.0005);
}

// A circle is quoted as a diameter, because it has no edge worth naming.
{
  const circle = regularPolygonVertices({ lat: 0, lon: 0, sides: 64, spanKm: 100 });
  const centre = { lat: 0, lon: 0 };
  const radii = circle.vertices.map((v) => haversineKm(centre, v));
  close("every point of a 100 km circle is 50 km out",
    Math.max(...radii), 50, 0.05);
  close("and none of them nearer", Math.min(...radii), 50, 0.05);
  // 64 segments is within 0.2% of pi r^2 -- close enough to quote.
  close("its area hint is a circle's", circle.areaHintKm2, Math.PI * 50 * 50, 20);
}

// Sized on whichever world this is, the same trap the box preset fell into.
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
  const hex = regularPolygonVertices({ lat: 0, lon: 80, sides: 6, sideKm: 200, radiusKm: MARS_R });
  // The perimeter, not vertices[0]→[1]: a 200 km edge on Mars spans 3.4°, so it
  // is subdivided and the first pair is a sub-segment. Measuring it as an edge
  // reads 66.6 km — a third of the answer — and looks exactly like the
  // hard-coded-Earth-radius bug this whole family of checks exists for.
  const perimeter = hex.vertices.reduce((sum, v, i) =>
    sum + marsKm(v, hex.vertices[(i + 1) % hex.vertices.length]), 0);
  close("a 200 km hexagon on Mars has 200 km edges on Mars", perimeter / 6, 200, 1.5);
}

// Subdivision, and the refusals, on the same terms as the box.
{
  const big = regularPolygonVertices({ lat: 0, lon: 0, sides: 3, sideKm: 3000 });
  let longest = 0;
  for (let i = 0; i < big.vertices.length; i += 1) {
    const a = big.vertices[i];
    const b = big.vertices[(i + 1) % big.vertices.length];
    longest = Math.max(longest, Math.abs(a.lat - b.lat), Math.abs(a.lon - b.lon));
  }
  check("a continental polygon is split to follow the ground", longest <= 1.0001,
    `longest segment ${longest.toFixed(3)}°`);
}
check("two sides is not a polygon",
  regularPolygonVertices({ lat: 0, lon: 0, sides: 2, sideKm: 10 }) === null);
check("no size, no polygon",
  regularPolygonVertices({ lat: 0, lon: 0, sides: 5, sideKm: 0 }) === null);
check("no centre, no polygon", regularPolygonVertices({ sides: 5, sideKm: 10 }) === null);
{
  const polar = regularPolygonVertices({ lat: 89.9, lon: 0, sides: 6, sideKm: 500 });
  check("a polygon at the pole stays on the globe",
    polar.vertices.every((v) => v.lat <= 90 && v.lat >= -90));
  const east = regularPolygonVertices({ lat: 0, lon: 300, sides: 5, sideKm: 10 });
  check("east-positive longitude is left alone",
    east.vertices.every((v) => v.lon > 299 && v.lon < 301), `${east.vertices[0].lon}`);
}

// ── Lines ────────────────────────────────────────────────────────────────────
// A line is an OPEN path: closing it would double the transect back on itself,
// and every downstream length would come out twice what was asked for.
{
  const line = lineVertices({ lat: 0, lon: 0, lengthKm: 100, bearingDeg: 90 });
  close("a 100 km line is 100 km long",
    haversineKm(line.vertices[0], line.vertices[line.vertices.length - 1]), 100, 0.05);
  check("it is centred on the coordinate, not started there",
    Math.abs(line.vertices[0].lon) > 0 && line.vertices[0].lon < 0
      && line.vertices[line.vertices.length - 1].lon > 0);
  close("due east keeps the same latitude", line.vertices[0].lat, 0, 1e-9);
  const north = lineVertices({ lat: 0, lon: 0, lengthKm: 100, bearingDeg: 0 });
  close("due north keeps the same longitude", north.vertices[0].lon, 0, 1e-9);
  close("and runs 100 km up the meridian",
    haversineKm(north.vertices[0], north.vertices[north.vertices.length - 1]), 100, 0.05);
  check("a short line is two points", line.vertices.length === 2, `${line.vertices.length}`);
  const long = lineVertices({ lat: 0, lon: 0, lengthKm: 4000, bearingDeg: 90 });
  check("a long one is split like every other edge", long.vertices.length > 30,
    `${long.vertices.length} points`);
  check("no length, no line", lineVertices({ lat: 0, lon: 0, lengthKm: 0 }) === null);
  check("no centre, no line", lineVertices({ lengthKm: 10 }) === null);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
