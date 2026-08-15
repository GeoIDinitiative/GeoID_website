// Inverse map projections to WGS84 lat/lon.
//
// proj4 is not vendored (and would be a large dependency for a handful of
// CRSs), so the two families that actually appear in this project's data are
// implemented directly: UTM — the Etna model grid is EPSG:32633 / UTM 33N — and
// Lambert Azimuthal Equal Area, which covers EPSG:3035.

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const UTM_K0 = 0.9996;

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

// EPSG:3035 — ETRS89-extended / LAEA Europe.
const LAEA_3035_DEF = { lat0: 52, lon0: 10, falseEasting: 4321000, falseNorthing: 3210000 };

/** Inverse UTM (Snyder series). Accurate to a few mm within a zone. */
export function utmToLatLon(easting, northing, zone, northernHemisphere = true) {
  const e2 = WGS84_E2;
  const ep2 = e2 / (1 - e2);
  const x = easting - 500000;
  const y = northernHemisphere ? northing : northing - 10000000;

  const m = y / UTM_K0;
  const mu = m / (WGS84_A * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const e1_2 = e1 * e1;
  const e1_3 = e1_2 * e1;
  const e1_4 = e1_3 * e1;

  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1_3) / 32) * Math.sin(2 * mu)
    + ((21 * e1_2) / 16 - (55 * e1_4) / 32) * Math.sin(4 * mu)
    + ((151 * e1_3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1_4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const c1 = ep2 * cosPhi1 * cosPhi1;
  const t1 = tanPhi1 * tanPhi1;
  const n1 = WGS84_A / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const r1 = (WGS84_A * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const d = x / (n1 * UTM_K0);

  const d2 = d * d;
  const d3 = d2 * d;
  const d4 = d3 * d;
  const d5 = d4 * d;
  const d6 = d5 * d;

  const lat = phi1 - ((n1 * tanPhi1) / r1) * (
    d2 / 2
    - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d4) / 24
    + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d6) / 720
  );

  const lonOffset = (
    d
    - ((1 + 2 * t1 + c1) * d3) / 6
    + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d5) / 120
  ) / cosPhi1;

  const lon0 = (zone - 1) * 6 - 180 + 3;
  return { lat: lat * DEG, lon: lon0 + lonOffset * DEG };
}

/** Inverse Lambert Azimuthal Equal Area on the ellipsoid (Snyder 24-15..24-20). */
export function laeaToLatLon(x, y, { lat0, lon0, falseEasting = 0, falseNorthing = 0 }) {
  const e2 = WGS84_E2;
  const e = Math.sqrt(e2);
  const a = WGS84_A;
  const phi0 = lat0 * RAD;
  const lambda0 = lon0 * RAD;

  const qOf = (phi) => {
    const sinPhi = Math.sin(phi);
    return (1 - e2) * (
      sinPhi / (1 - e2 * sinPhi * sinPhi)
      - (1 / (2 * e)) * Math.log((1 - e * sinPhi) / (1 + e * sinPhi))
    );
  };

  const qp = qOf(Math.PI / 2);
  const q0 = qOf(phi0);
  const beta0 = Math.asin(q0 / qp);
  const rq = a * Math.sqrt(qp / 2);
  const d = a * (Math.cos(phi0) / Math.sqrt(1 - e2 * Math.sin(phi0) * Math.sin(phi0)))
    / (rq * Math.cos(beta0));

  const xr = x - falseEasting;
  const yr = y - falseNorthing;
  const rho = Math.sqrt((xr / d) * (xr / d) + (d * yr) * (d * yr));
  if (rho < 1e-12) {
    return { lat: lat0, lon: lon0 };
  }
  const ce = 2 * Math.asin(rho / (2 * rq));
  const cosCe = Math.cos(ce);
  const sinCe = Math.sin(ce);

  const beta = Math.asin(cosCe * Math.sin(beta0) + ((d * yr * sinCe * Math.cos(beta0)) / rho));
  const lambda = lambda0 + Math.atan2(
    xr * sinCe,
    d * rho * Math.cos(beta0) * cosCe - d * d * yr * Math.sin(beta0) * sinCe,
  );

  // Authalic latitude -> geodetic, via the standard series.
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const phi = beta
    + (e2 / 3 + (31 * e4) / 180 + (517 * e6) / 5040) * Math.sin(2 * beta)
    + ((23 * e4) / 360 + (251 * e6) / 3780) * Math.sin(4 * beta)
    + ((761 * e6) / 45360) * Math.sin(6 * beta);

  return { lat: phi * DEG, lon: lambda * DEG };
}

/** Forward UTM (Snyder series), the inverse of utmToLatLon. */
export function latLonToUtm(lat, lon, zone = utmZoneForLon(lon)) {
  const e2 = WGS84_E2;
  const ep2 = e2 / (1 - e2);
  const phi = lat * RAD;
  const lambda = lon * RAD;
  const lambda0 = ((zone - 1) * 6 - 180 + 3) * RAD;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const n = WGS84_A / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const t = tanPhi * tanPhi;
  const c = ep2 * cosPhi * cosPhi;
  const a = (lambda - lambda0) * cosPhi;

  const m = WGS84_A * (
    (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi)
  );

  const a2 = a * a;
  const a3 = a2 * a;
  const a4 = a3 * a;
  const a5 = a4 * a;
  const a6 = a5 * a;

  const easting = UTM_K0 * n * (
    a + ((1 - t + c) * a3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * a5) / 120
  ) + 500000;

  let northing = UTM_K0 * (m + n * tanPhi * (
    a2 / 2
    + ((5 - t + 9 * c + 4 * c * c) * a4) / 24
    + ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * a6) / 720
  ));
  if (lat < 0) {
    northing += 10000000;
  }
  return { x: easting, y: northing, zone, north: lat >= 0 };
}

/** Forward Lambert Azimuthal Equal Area, the inverse of laeaToLatLon. */
export function latLonToLaea(lat, lon, { lat0, lon0, falseEasting = 0, falseNorthing = 0 }) {
  const e2 = WGS84_E2;
  const e = Math.sqrt(e2);
  const a = WGS84_A;
  const phi = lat * RAD;
  const phi0 = lat0 * RAD;
  const lambdaDelta = (lon - lon0) * RAD;

  const qOf = (p) => {
    const sinP = Math.sin(p);
    return (1 - e2) * (
      sinP / (1 - e2 * sinP * sinP)
      - (1 / (2 * e)) * Math.log((1 - e * sinP) / (1 + e * sinP))
    );
  };

  const qp = qOf(Math.PI / 2);
  const beta = Math.asin(qOf(phi) / qp);
  const beta0 = Math.asin(qOf(phi0) / qp);
  const rq = a * Math.sqrt(qp / 2);
  const d = a * (Math.cos(phi0) / Math.sqrt(1 - e2 * Math.sin(phi0) * Math.sin(phi0)))
    / (rq * Math.cos(beta0));

  const denom = 1
    + Math.sin(beta0) * Math.sin(beta)
    + Math.cos(beta0) * Math.cos(beta) * Math.cos(lambdaDelta);
  const b = rq * Math.sqrt(2 / denom);

  return {
    x: b * d * Math.cos(beta) * Math.sin(lambdaDelta) + falseEasting,
    y: (b / d) * (
      Math.cos(beta0) * Math.sin(beta)
      - Math.sin(beta0) * Math.cos(beta) * Math.cos(lambdaDelta)
    ) + falseNorthing,
  };
}

export function utmZoneForLon(lon) {
  return Math.floor((((lon + 180) % 360 + 360) % 360) / 6) + 1;
}



/* ── National transverse Mercator grids ──────────────────────────────────── */

/**
 * The grids the British Isles' open data actually ships in.
 *
 * OSNI's DTM and GSNI's mapping are Irish Grid; the Republic's newer data is
 * ITM; Ordnance Survey GB is the National Grid. Until now the transformer
 * spoke UTM and LAEA only, so every one of those datasets needed an external
 * ogr2ogr before it could be imported — the "runnable with this app's
 * toolset" claim failed at the first NI dataset.
 *
 * Two things make these different from UTM, and both matter:
 *
 * 1. They are not on WGS84. TM65 (Irish Grid) uses the Airy Modified
 *    ellipsoid and OSGB36 uses Airy 1830, so a projection alone lands
 *    hundreds of metres out — the datum shift is not optional. The Helmert
 *    parameters here are the published national ones (OSi/OSNI for TM65,
 *    OSGB for OSGB36); they are metre-level, which is right for 1:250k
 *    geology and for a 100 m working grid, and NOT a substitute for OSTN15 if
 *    someone needs centimetres.
 * 2. ITM is on GRS80/ETRS89, which is within centimetres of WGS84 for this
 *    purpose, so it takes the projection and no shift at all.
 */
const TM_GRIDS = {
  // TM65 / Irish Grid — GSNI, OSNI, the Geological Survey of Ireland's older sets.
  "epsg:29902": {
    label: "TM65 / Irish Grid (EPSG:29902)",
    a: 6377340.189, f: 1 / 299.3249646,
    lat0: 53.5, lon0: -8, k0: 1.000035, fe: 200000, fn: 250000,
    // Airy Modified -> WGS84, published TM65 parameters.
    helmert: { dx: 482.5, dy: -130.6, dz: 564.6, rx: -1.042, ry: -0.214, rz: -0.631, s: 8.15 },
  },
  // TM75 / Irish Grid — the same grid on a later realisation; same numbers
  // to the precision this transformer claims.
  "epsg:29903": {
    label: "TM75 / Irish Grid (EPSG:29903)",
    a: 6377340.189, f: 1 / 299.3249646,
    lat0: 53.5, lon0: -8, k0: 1.000035, fe: 200000, fn: 250000,
    helmert: { dx: 482.5, dy: -130.6, dz: 564.6, rx: -1.042, ry: -0.214, rz: -0.631, s: 8.15 },
  },
  // IRENET95 / Irish Transverse Mercator — ETRS89, so no datum shift.
  "epsg:2157": {
    label: "IRENET95 / Irish Transverse Mercator (EPSG:2157)",
    a: 6378137, f: 1 / 298.257222101,
    lat0: 53.5, lon0: -8, k0: 0.99982, fe: 600000, fn: 750000,
    helmert: null,
  },
  // OSGB36 / British National Grid.
  "epsg:27700": {
    label: "OSGB36 / British National Grid (EPSG:27700)",
    a: 6377563.396, f: 1 / 299.3249646,
    lat0: 49, lon0: -2, k0: 0.9996012717, fe: 400000, fn: -100000,
    helmert: { dx: 446.448, dy: -125.157, dz: 542.06, rx: 0.1502, ry: 0.247, rz: 0.8421, s: -20.4894 },
  },
};

/** Geodetic to geocentric (X, Y, Z) on a given ellipsoid. */
function toGeocentric(lat, lon, a, f, height = 0) {
  const rad = Math.PI / 180;
  const e2 = f * (2 - f);
  const sinLat = Math.sin(lat * rad);
  const cosLat = Math.cos(lat * rad);
  const nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  return {
    X: (nu + height) * cosLat * Math.cos(lon * rad),
    Y: (nu + height) * cosLat * Math.sin(lon * rad),
    Z: ((1 - e2) * nu + height) * sinLat,
  };
}

/** Geocentric back to geodetic, by the standard iteration on latitude. */
function toGeodetic(X, Y, Z, a, f) {
  const deg = 180 / Math.PI;
  const e2 = f * (2 - f);
  const lon = Math.atan2(Y, X);
  const p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - e2));
  for (let i = 0; i < 8; i += 1) {
    const sinLat = Math.sin(lat);
    const nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    lat = Math.atan2(Z + e2 * nu * sinLat, p);
  }
  return { lat: lat * deg, lon: lon * deg };
}

/**
 * Seven-parameter Helmert, in the position-vector convention the national
 * parameters above are published in. `inverse` runs it the other way, which
 * is a sign flip on every term rather than a separate set of numbers.
 */
function helmert(point, h, inverse = false) {
  const sec = Math.PI / (180 * 3600);
  const sign = inverse ? -1 : 1;
  const s = 1 + (sign * h.s) / 1e6;
  const rx = sign * h.rx * sec;
  const ry = sign * h.ry * sec;
  const rz = sign * h.rz * sec;
  const { X, Y, Z } = point;
  return {
    X: sign * h.dx + s * (X - rz * Y + ry * Z),
    Y: sign * h.dy + s * (rz * X + Y - rx * Z),
    Z: sign * h.dz + s * (-ry * X + rx * Y + Z),
  };
}

/** Transverse Mercator forward (Redfearn), on the grid's own ellipsoid. */
function tmForward(lat, lon, g) {
  const rad = Math.PI / 180;
  const e2 = g.f * (2 - g.f);
  const n = g.f / (2 - g.f);
  const phi = lat * rad;
  const lam = lon * rad;
  const phi0 = g.lat0 * rad;
  const lam0 = g.lon0 * rad;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const nu = g.a * g.k0 / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const rho = g.a * g.k0 * (1 - e2) / ((1 - e2 * sinPhi * sinPhi) ** 1.5);
  const eta2 = nu / rho - 1;
  // The meridional arc scales with the SEMI-MINOR axis, not the semi-major:
  // b·F0, in the Ordnance Survey's own notation. Using a here is a silent
  // northing error that grows with distance from the grid's latitude of
  // origin — measured against PROJ at 2.9 km on Ben Nevis, while the easting
  // stayed exact to a millimetre, which is exactly what makes it look like a
  // datum problem rather than an arithmetic one.
  const b = g.a * (1 - g.f) * g.k0;
  const M = b * (
    (1 + n + 1.25 * n * n + 1.25 * n ** 3) * (phi - phi0)
    - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(phi - phi0) * Math.cos(phi + phi0)
    + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * (phi - phi0)) * Math.cos(2 * (phi + phi0))
    - (35 / 24) * n ** 3 * Math.sin(3 * (phi - phi0)) * Math.cos(3 * (phi + phi0))
  );
  const I = M + g.fn;
  const II = (nu / 2) * sinPhi * cosPhi;
  const III = (nu / 24) * sinPhi * cosPhi ** 3 * (5 - tanPhi ** 2 + 9 * eta2);
  const IIIA = (nu / 720) * sinPhi * cosPhi ** 5 * (61 - 58 * tanPhi ** 2 + tanPhi ** 4);
  const IV = nu * cosPhi;
  const V = (nu / 6) * cosPhi ** 3 * (nu / rho - tanPhi ** 2);
  const VI = (nu / 120) * cosPhi ** 5
    * (5 - 18 * tanPhi ** 2 + tanPhi ** 4 + 14 * eta2 - 58 * tanPhi ** 2 * eta2);
  const dl = lam - lam0;
  return {
    x: g.fe + IV * dl + V * dl ** 3 + VI * dl ** 5,
    y: I + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6,
  };
}

/** Transverse Mercator inverse (Redfearn), on the grid's own ellipsoid. */
function tmInverse(x, y, g) {
  const deg = 180 / Math.PI;
  const rad = Math.PI / 180;
  const e2 = g.f * (2 - g.f);
  const n = g.f / (2 - g.f);
  const b = g.a * (1 - g.f) * g.k0;   // semi-minor, as in tmForward
  const phi0 = g.lat0 * rad;
  let phi = (y - g.fn) / b + phi0;
  let M = 0;
  for (let i = 0; i < 12; i += 1) {
    M = b * (
      (1 + n + 1.25 * n * n + 1.25 * n ** 3) * (phi - phi0)
      - (3 * n + 3 * n * n + 2.625 * n ** 3) * Math.sin(phi - phi0) * Math.cos(phi + phi0)
      + (1.875 * n * n + 1.875 * n ** 3) * Math.sin(2 * (phi - phi0)) * Math.cos(2 * (phi + phi0))
      - (35 / 24) * n ** 3 * Math.sin(3 * (phi - phi0)) * Math.cos(3 * (phi + phi0))
    );
    const residual = y - g.fn - M;
    if (Math.abs(residual) < 1e-6) break;
    phi += residual / b;
  }
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const nu = g.a * g.k0 / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const rho = g.a * g.k0 * (1 - e2) / ((1 - e2 * sinPhi * sinPhi) ** 1.5);
  const eta2 = nu / rho - 1;
  const dE = x - g.fe;
  const VII = tanPhi / (2 * rho * nu);
  const VIII = (tanPhi / (24 * rho * nu ** 3)) * (5 + 3 * tanPhi ** 2 + eta2 - 9 * tanPhi ** 2 * eta2);
  const IX = (tanPhi / (720 * rho * nu ** 5)) * (61 + 90 * tanPhi ** 2 + 45 * tanPhi ** 4);
  const X = 1 / (cosPhi * nu);
  const XI = (1 / (6 * cosPhi * nu ** 3)) * (nu / rho + 2 * tanPhi ** 2);
  const XII = (1 / (120 * cosPhi * nu ** 5)) * (5 + 28 * tanPhi ** 2 + 24 * tanPhi ** 4);
  const XIIA = (1 / (5040 * cosPhi * nu ** 7))
    * (61 + 662 * tanPhi ** 2 + 1320 * tanPhi ** 4 + 720 * tanPhi ** 6);
  return {
    lat: (phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6) * deg,
    lon: (g.lon0 * rad + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7) * deg,
  };
}

/** A national grid easting/northing to WGS84 lat/lon, datum shift included. */
export function tmGridToLatLon(x, y, crsId) {
  const g = TM_GRIDS[crsId];
  if (!g) return null;
  const local = tmInverse(x, y, g);
  if (!g.helmert) return local;
  const geocentric = toGeocentric(local.lat, local.lon, g.a, g.f);
  const shifted = helmert(geocentric, g.helmert);
  // WGS84 ellipsoid on the far side of the shift.
  return toGeodetic(shifted.X, shifted.Y, shifted.Z, 6378137, 1 / 298.257223563);
}

/** WGS84 lat/lon to a national grid easting/northing, datum shift included. */
export function latLonToTmGrid(lat, lon, crsId) {
  const g = TM_GRIDS[crsId];
  if (!g) return null;
  let local = { lat, lon };
  if (g.helmert) {
    const geocentric = toGeocentric(lat, lon, 6378137, 1 / 298.257223563);
    const shifted = helmert(geocentric, g.helmert, true);
    local = toGeodetic(shifted.X, shifted.Y, shifted.Z, g.a, g.f);
  }
  return tmForward(local.lat, local.lon, g);
}

/** Converts lat/lon into the given CRS. Returns null for unsupported ids. */
export function latLonToProjected(lat, lon, crsId) {
  if (!crsId || crsId === "none") {
    return null;
  }
  if (crsId === "epsg:4326") {
    return { x: lon, y: lat };
  }
  const utm = /^epsg:32([67])(\d{2})$/.exec(crsId);
  if (utm) {
    return latLonToUtm(lat, lon, Number(utm[2]));
  }
  if (crsId === "epsg:3035") {
    return latLonToLaea(lat, lon, LAEA_3035_DEF);
  }
  if (TM_GRIDS[crsId]) {
    return latLonToTmGrid(lat, lon, crsId);
  }
  return null;
}

/**
 * General transformer between any two supported CRSs, routing through WGS84.
 * Coordinates are (x, y) = (easting, northing) for projected systems and
 * (lon, lat) for EPSG:4326.
 */
export function transform(x, y, fromCrs, toCrs) {
  if (fromCrs === toCrs) {
    return { x, y };
  }
  const geographic = fromCrs === "epsg:4326"
    ? { lat: y, lon: x }
    : projectedToLatLon(x, y, fromCrs);
  if (!geographic) {
    return null;
  }
  if (toCrs === "epsg:4326") {
    return { x: geographic.lon, y: geographic.lat };
  }
  return latLonToProjected(geographic.lat, geographic.lon, toCrs);
}

// CRSs offered in the UI. `local` means the data already sits in scene units
// with no geographic meaning.
export const CRS_OPTIONS = [
  { id: "none", label: "Not georeferenced" },
  { id: "epsg:4326", label: "WGS84 lat/lon (EPSG:4326)" },
  { id: "epsg:32633", label: "UTM 33N (EPSG:32633) - Etna" },
  { id: "epsg:32632", label: "UTM 32N (EPSG:32632)" },
  { id: "epsg:32634", label: "UTM 34N (EPSG:32634)" },
  { id: "epsg:3035", label: "ETRS89 LAEA Europe (EPSG:3035)" },
  { id: "epsg:29902", label: "TM65 / Irish Grid (EPSG:29902)" },
  { id: "epsg:29903", label: "TM75 / Irish Grid (EPSG:29903)" },
  { id: "epsg:2157", label: "Irish Transverse Mercator (EPSG:2157)" },
  { id: "epsg:27700", label: "OSGB36 / British National Grid (EPSG:27700)" },
];

/**
 * Converts projected coordinates to lat/lon for a supported CRS id.
 * Returns null when the CRS carries no geographic meaning.
 */
export function projectedToLatLon(x, y, crsId) {
  if (!crsId || crsId === "none") {
    return null;
  }
  if (crsId === "epsg:4326") {
    return { lat: y, lon: x };
  }
  const utm = /^epsg:32([67])(\d{2})$/.exec(crsId);
  if (utm) {
    return utmToLatLon(x, y, Number(utm[2]), utm[1] === "6");
  }
  if (crsId === "epsg:3035") {
    return laeaToLatLon(x, y, LAEA_3035_DEF);
  }
  if (TM_GRIDS[crsId]) {
    return tmGridToLatLon(x, y, crsId);
  }
  return null;
}
