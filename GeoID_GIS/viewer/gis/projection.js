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
  return null;
}
