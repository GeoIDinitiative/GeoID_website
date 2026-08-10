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

const KM_PER_DEG_LAT = 111.32;
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
export function lonDegPerKm(lat) {
  const cos = Math.cos((lat * Math.PI) / 180);
  // Within ~0.1° of a pole the scaling runs away; clamp so a box there is
  // merely wrong-looking rather than infinite.
  return 1 / (KM_PER_DEG_LAT * Math.max(cos, 0.0018));
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
} = {}) {
  const wide = Number(widthKm);
  const tall = Number(heightKm);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!(wide > 0) || !(tall > 0)) return null;

  const halfLat = Math.min(tall / 2 / KM_PER_DEG_LAT, 89.9);
  const halfLon = Math.min((wide / 2) * lonDegPerKm(lat), 179.9);
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
  return {
    vertices,
    bounds: { south, north, west, east },
    areaHintKm2: wide * tall,
  };
}
