/**
 * The frame the whole sim runs in.
 *
 *   geodetic   lat/lon degrees, WGS84
 *   mercator   EPSG:3857 metres — what every tile service here is cut on
 *   local      metres east (+x) / up (+y) / south (+z) about an origin
 *
 * Same construction as Everest's geo.js (local = Mercator × cos(lat0)), with
 * one difference that matters for a plane: the origin MOVES. Everest's player
 * walks 26 km; a plane crosses that in under two minutes, and float32 on the
 * GPU (the shadow lookup and the curvature drop both run in world space)
 * starts to show centimetre jitter a few hundred kilometres out. So the origin
 * is re-centred under the aircraft by a pure translation every 20 km.
 *
 * The scale K stays fixed for a session (it is set when a city is chosen).
 * Re-deriving it on every rebase would rescale the world under the camera;
 * leaving it costs ~1.5 % per degree of latitude flown, which nobody can see.
 */

export const R_EARTH = 6378137.0;
export const R_MEAN = 6371000.0;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const WORLD = 2 * Math.PI * R_EARTH;          // Mercator world width, metres

export const frame = {
  K: 1,          // ground metres per Mercator metre at the session latitude
  mx0: 0,        // Mercator x of local (0,0)
  my0: 0,        // Mercator y of local (0,0)
  lat0: 0,
};

export function lonToMercX(lon) { return R_EARTH * lon * D2R; }
export function latToMercY(lat) {
  return R_EARTH * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
}
export function mercXToLon(x) { return x / R_EARTH * R2D; }
export function mercYToLat(y) {
  return (2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) * R2D;
}

/** Start a session at a place: sets the scale and the origin together. */
export function setSession(lat, lon) {
  frame.lat0 = lat;
  frame.K = Math.cos(lat * D2R);
  frame.mx0 = lonToMercX(lon);
  frame.my0 = latToMercY(lat);
}

/** Move the origin by (dx, dz) local metres. Returns the shift so callers
 *  can move what they own by the same amount. */
export function shiftOrigin(dx, dz) {
  frame.mx0 += dx / frame.K;
  frame.my0 -= dz / frame.K;
}

export function mercToLocal(mx, my) {
  return { x: (mx - frame.mx0) * frame.K, z: -(my - frame.my0) * frame.K };
}
export function llToLocal(lat, lon) {
  return mercToLocal(lonToMercX(lon), latToMercY(lat));
}
export function localToLL(x, z) {
  return { lat: mercYToLat(frame.my0 - z / frame.K), lon: mercXToLon(frame.mx0 + x / frame.K) };
}

/** Size of a z tile in Mercator metres, and in local metres. */
export function tileMerc(z) { return WORLD / Math.pow(2, z); }
export function tileLocal(z) { return tileMerc(z) * frame.K; }

/** Mercator coords of a tile's north-west corner. */
export function tileNW(z, x, y) {
  const s = tileMerc(z);
  return { mx: -WORLD / 2 + x * s, my: WORLD / 2 - y * s };
}
/** Local coords of a tile's north-west corner. */
export function tileNWLocal(z, x, y) {
  const nw = tileNW(z, x, y);
  return mercToLocal(nw.mx, nw.my);
}

/** Which z tile (fractional) a local point falls in. */
export function localToTile(x, z, zoom) {
  const mx = frame.mx0 + x / frame.K, my = frame.my0 - z / frame.K;
  const s = tileMerc(zoom);
  return { tx: (mx + WORLD / 2) / s, ty: (WORLD / 2 - my) / s };
}

/** Ground metres per pixel of a 256 px tile at a latitude. */
export function metresPerPixel(zoom, lat) {
  return WORLD * Math.cos(lat * D2R) / (256 * Math.pow(2, zoom));
}

export function haversine(lat1, lon1, lat2, lon2) {
  const a = Math.sin((lat2 - lat1) * D2R / 2) ** 2
    + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin((lon2 - lon1) * D2R / 2) ** 2;
  return 2 * R_MEAN * Math.asin(Math.sqrt(a));
}
