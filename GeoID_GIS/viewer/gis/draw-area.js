/**
 * The Draw tool's preset box.
 *
 * Clicking out a polygon is right when the shape matters and wrong when it does
 * not: "sample 10 km around this volcano" is a size, not a shape, and drawing it
 * by hand gives an approximate box with a made-up area. So the tool takes a
 * width and a height in kilometres and builds the polygon, which then goes
 * through the *same* path a drawn one does — the viewer's `setStudyAreaPolygon`
 * hands it to `activateStudyArea`, so the overlay, the area readout and
 * extraction cannot tell the two apart.
 *
 * Longitude stays in the viewer's own convention (east-positive 0–360)
 * throughout; converting to signed degrees is the job of whatever leaves for a
 * file, and doing it here would put the box a hemisphere away.
 */

/**
 * A degree of latitude, in kilometres, on a body of a given radius.
 *
 * This was the Earth constant 111.32, hard-coded — so a "200 km" box on Mars
 * came out 106 km across and reported 11,296 km² against the 40,000 asked for,
 * exactly (R_earth/R_mars)² out. The Draw tool is on every world, so the body
 * has to be a parameter.
 */
export const EARTH_RADIUS_KM = 6371.0088;
export const kmPerDegLat = (radiusKm = EARTH_RADIUS_KM) => (Math.PI * radiusKm) / 180;
/**
 * Longer edges are split.
 *
 * A straight segment across 12° of arc dips 0.0175 below the surface in render
 * units — far past any clearance the overlay has — and 1° keeps that at 0.0001
 * (see CLAUDE.md, "Chords sag"). A 10 km box is one segment an edge; a
 * continental one follows the ground.
 */
const MAX_SEGMENT_DEG = 1;

/** Degrees of longitude per kilometre at a given latitude. */
export function lonDegPerKm(lat, radiusKm = EARTH_RADIUS_KM) {
  const cos = Math.cos((lat * Math.PI) / 180);
  // Within ~0.1° of a pole the scaling runs away; clamp so a box there is
  // merely wrong-looking rather than infinite.
  return 1 / (kmPerDegLat(radiusKm) * Math.max(cos, 0.0018));
}

/**
 * Walks a closed ring, splitting any edge longer than `maxSegmentDeg`.
 *
 * Every shape here needs it for the same reason — see MAX_SEGMENT_DEG above —
 * so it is written once. A small shape is one segment an edge and comes back
 * unchanged; a continental one follows the ground.
 */
function subdivideRing(corners, maxSegmentDeg = MAX_SEGMENT_DEG) {
  const vertices = [];
  for (let i = 0; i < corners.length; i += 1) {
    const from = corners[i];
    const to = corners[(i + 1) % corners.length];
    const steps = Math.max(1, Math.ceil(
      Math.max(Math.abs(to.lat - from.lat), Math.abs(to.lon - from.lon)) / maxSegmentDeg,
    ));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      vertices.push({
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t,
      });
    }
  }
  return vertices;
}

/**
 * A width × height box in kilometres, centred on a coordinate.
 *
 * **The width is exact at the centre latitude and only there.** A box in
 * lat/lon is not a rectangle on a sphere: its north edge is shorter on the
 * ground than its south edge, by cos(north)/cos(south). That is what every GIS
 * means by a bounding box, and pretending otherwise would need a projection the
 * rest of this page does not use — but it is worth knowing before quoting the
 * area of a tall one. `areaHintKm2` is the flat product, so a caller can show
 * what was asked for beside the true spherical area the viewer computes.
 */
export function rectangleVertices({
  lat, lon, widthKm, heightKm, maxSegmentDeg = MAX_SEGMENT_DEG,
  radiusKm = EARTH_RADIUS_KM,
} = {}) {
  const wide = Number(widthKm);
  const tall = Number(heightKm);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!(wide > 0) || !(tall > 0)) return null;

  const halfLat = Math.min(tall / 2 / kmPerDegLat(radiusKm), 89.9);
  const halfLon = Math.min((wide / 2) * lonDegPerKm(lat, radiusKm), 179.9);
  const south = Math.max(-89.99, lat - halfLat);
  const north = Math.min(89.99, lat + halfLat);
  const west = lon - halfLon;
  const east = lon + halfLon;

  // Anticlockwise from the south-west corner, each edge subdivided so a large
  // box follows the ground rather than cutting through it.
  const corners = [
    { lat: south, lon: west }, { lat: south, lon: east },
    { lat: north, lon: east }, { lat: north, lon: west },
  ];
  const vertices = subdivideRing(corners, maxSegmentDeg);
  return {
    vertices,
    bounds: { south, north, west, east },
    areaHintKm2: wide * tall,
  };
}

/**
 * A regular polygon — triangle, square, pentagon, hexagon, circle — in km.
 *
 * The same trade the box makes, for the same reason: the size is exact at the
 * centre latitude and only there, because a shape laid out in lat/lon is not a
 * regular polygon on a sphere. Its northern half is narrower on the ground than
 * its southern half by cos(north)/cos(south), which at a study-area size is far
 * below the resolution of anything sampled through it and at continental size is
 * plainly visible. The viewer computes the true spherical area from the ring, so
 * what is reported is never this approximation.
 *
 * Size is given as `sideKm`, the edge length, so "10 km" means the same thing
 * here as it does in the box preset — a 4-sided shape at 10 km IS the 10 km
 * square. A circle has no edge worth quoting, so it takes `spanKm` (the
 * diameter) instead; pass whichever the shape has and the other is derived.
 *
 * `rotationDeg` is the bearing of the first vertex, so 0 points a corner north
 * (flat-bottomed triangle, pointy-top hexagon) and 45 on a square gives the
 * axis-aligned box everyone means by "square".
 */
export function regularPolygonVertices({
  lat, lon, sides, sideKm, spanKm, rotationDeg = 0,
  radiusKm = EARTH_RADIUS_KM, maxSegmentDeg = MAX_SEGMENT_DEG,
} = {}) {
  const n = Math.round(Number(sides));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!(n >= 3)) return null;

  // Circumradius: from the diameter if given, else from the edge length by
  // s = 2 R sin(pi/n) -- the standard relation, inverted.
  const span = Number(spanKm);
  const side = Number(sideKm);
  const circumKm = span > 0 ? span / 2
    : (side > 0 ? side / (2 * Math.sin(Math.PI / n)) : NaN);
  if (!(circumKm > 0)) return null;

  const dLatPerKm = 1 / kmPerDegLat(radiusKm);
  const dLonPerKm = lonDegPerKm(lat, radiusKm);
  // Anticlockwise, matching `rectangleVertices`. The area helper takes the
  // absolute value so winding does not change a number, but two shapes that
  // wind opposite ways is the kind of difference that surfaces later, in some
  // other tool, as a bug nobody can place.
  const corners = [];
  for (let i = 0; i < n; i += 1) {
    const bearing = ((rotationDeg - (i * 360) / n) * Math.PI) / 180;
    corners.push({
      lat: Math.max(-89.99, Math.min(89.99, lat + circumKm * Math.cos(bearing) * dLatPerKm)),
      lon: lon + circumKm * Math.sin(bearing) * dLonPerKm,
    });
  }
  return {
    vertices: subdivideRing(corners, maxSegmentDeg),
    circumKm,
    // The flat regular-polygon area, for showing what was ASKED for beside the
    // spherical area the viewer measures. (1/2) n R^2 sin(2pi/n).
    areaHintKm2: 0.5 * n * circumKm * circumKm * Math.sin((2 * Math.PI) / n),
  };
}

/**
 * A straight line of a given length through a coordinate — a transect.
 *
 * Not a study area: a line encloses nothing, so there is no ground to sample
 * across and `setStudyAreaPolygon` would have to be lied to. It becomes a
 * LineString layer instead, which is what a transect is for.
 *
 * `bearingDeg` is a compass bearing, 0 north and 90 east, and the line is
 * centred on the coordinate rather than starting at it.
 */
export function lineVertices({
  lat, lon, lengthKm, bearingDeg = 90, radiusKm = EARTH_RADIUS_KM,
  maxSegmentDeg = MAX_SEGMENT_DEG,
} = {}) {
  const length = Number(lengthKm);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(length > 0)) return null;
  const half = length / 2;
  const bearing = (Number(bearingDeg) * Math.PI) / 180;
  const dLat = half * Math.cos(bearing) / kmPerDegLat(radiusKm);
  const dLon = half * Math.sin(bearing) * lonDegPerKm(lat, radiusKm);
  const from = { lat: Math.max(-89.99, Math.min(89.99, lat - dLat)), lon: lon - dLon };
  const to = { lat: Math.max(-89.99, Math.min(89.99, lat + dLat)), lon: lon + dLon };
  // subdivideRing closes the ring, which a line must not do -- so the pair is
  // walked as an open path and the returned end is the far end, not the start.
  const steps = Math.max(1, Math.ceil(
    Math.max(Math.abs(to.lat - from.lat), Math.abs(to.lon - from.lon)) / maxSegmentDeg,
  ));
  const vertices = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    vertices.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lon: from.lon + (to.lon - from.lon) * t,
    });
  }
  return { vertices, lengthHintKm: length };
}
