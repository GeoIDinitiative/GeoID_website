/**
 * Coordinates. Three frames, and mixing them is the bug that costs a day.
 *
 *   geodetic   lat/lon degrees, WGS84 — what the route table is written in
 *   mercator   EPSG:3857 metres — what both tile services are cut on
 *   local      metres east / up / south about ORIGIN — what the game runs in
 *
 * The local frame is Mercator scaled by cos(lat0). Mercator's own metre is
 * stretched by 1/cos(lat), so undoing it at the origin latitude makes local
 * distances true ground metres there, and 0.09% wrong at the edge of a 26 km
 * play area. That is nine metres in ten kilometres — smaller than the DEM's
 * own cell — so the game does not correct for it, but a measurement quoted to
 * the player should not claim more precision than that.
 */

import { ORIGIN } from "./config.js?v=1c22a4f-d22a29b4";

export const R_EARTH = 6378137.0;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Ground metres per Mercator metre at the origin latitude. */
export const K = Math.cos(ORIGIN.lat * D2R);

export function lonToMercX(lon) { return R_EARTH * lon * D2R; }
export function latToMercY(lat) {
  return R_EARTH * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
}
export function mercXToLon(x) { return x / R_EARTH * R2D; }
export function mercYToLat(y) {
  return (2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) * R2D;
}

const MX0 = lonToMercX(ORIGIN.lon);
const MY0 = latToMercY(ORIGIN.lat);

/** Geodetic → local. Returns {x: east, z: south} in metres. */
export function llToLocal(lat, lon) {
  return {
    x: (lonToMercX(lon) - MX0) * K,
    z: -(latToMercY(lat) - MY0) * K,
  };
}

/** Local → geodetic. */
export function localToLL(x, z) {
  return {
    lat: mercYToLat(MY0 - z / K),
    lon: mercXToLon(MX0 + x / K),
  };
}

/* ── Tiles ───────────────────────────────────────────────────────────────
   Slippy-map XYZ. Both services use the same grid; they differ only in the
   order the path puts x and y in, which each URL template states. */

export function lonToTileX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
export function latToTileY(lat, z) {
  const r = lat * D2R;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
}
export function tileXToLon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
export function tileYToLat(y, z) {
  const n = Math.PI * (1 - 2 * y / Math.pow(2, z));
  return R2D * Math.atan(Math.sinh(n));
}

/** Ground metres per pixel of a 256 px tile at this zoom and latitude. */
export function metresPerPixel(zoom, lat = ORIGIN.lat) {
  return 156543.03392 * Math.cos(lat * D2R) / Math.pow(2, zoom);
}

/** Local metres per pixel — the same thing, but in the frame the game uses,
 *  where the cos() has already been divided out. Constant with latitude,
 *  which is exactly why the local frame is defined the way it is. */
export function localMetresPerPixel(zoom) {
  return 156543.03392 * K / Math.pow(2, zoom);
}

/**
 * The tile window covering a square of local metres.
 * Returns integer tile bounds plus the local-metre extent those tiles
 * actually cover, which is always at least as large as what was asked for —
 * the caller composites into that extent, not into the requested one, or
 * every sample is off by a fraction of a tile.
 */
export function tileWindow(centreX, centreZ, half, zoom) {
  const a = localToLL(centreX - half, centreZ + half);   // south-west
  const b = localToLL(centreX + half, centreZ - half);   // north-east
  const x0 = Math.floor(lonToTileX(a.lon, zoom));
  const x1 = Math.ceil(lonToTileX(b.lon, zoom));
  const y0 = Math.floor(latToTileY(b.lat, zoom));        // north edge = smaller y
  const y1 = Math.ceil(latToTileY(a.lat, zoom));

  const nw = llToLocal(tileYToLat(y0, zoom), tileXToLon(x0, zoom));
  const se = llToLocal(tileYToLat(y1, zoom), tileXToLon(x1, zoom));
  return {
    zoom, x0, y0, x1, y1,
    nx: x1 - x0, ny: y1 - y0,
    minX: nw.x, maxX: se.x,
    minZ: nw.z, maxZ: se.z,       // z grows southward, so minZ is the north edge
    width: se.x - nw.x, height: se.z - nw.z,
    pxWidth: (x1 - x0) * 256, pxHeight: (y1 - y0) * 256,
  };
}

/** Great-circle distance in metres — for anything shown to the player, where
 *  the local frame's 0.09% would be quoting false precision. */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
  const s = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Compass bearing, degrees from north, for the HUD. */
export function bearing(fromX, fromZ, toX, toZ) {
  const deg = Math.atan2(toX - fromX, -(toZ - fromZ)) * R2D;
  return (deg + 360) % 360;
}

export const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compassPoint(deg) {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
