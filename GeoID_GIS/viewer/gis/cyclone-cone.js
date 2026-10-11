/**
 * A tropical cyclone's forecast track and its cone of uncertainty — the pure
 * half, pinned in Node.
 *
 * WHAT THE CONE IS. Not the storm's size, and not where its winds reach: the
 * area the CENTRE is expected to stay inside about two times in three, built
 * the way the US National Hurricane Center builds its own. At each forecast
 * lead time a circle is drawn whose radius encloses two thirds of the
 * official track errors of the previous five seasons, and the cone is the
 * envelope those circles sweep as the forecast centre moves. So it widens
 * with lead time because the forecast gets worse, not because the storm gets
 * bigger, and a third of storms leave it. Both of those are said wherever the
 * cone is.
 *
 * Where a source publishes its own cone (GDACS sometimes carries the issuing
 * agency's), that cone is drawn and this one is not; this is the fallback
 * that turns a published forecast TRACK into a cone with the stated method.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const NM_KM = 1.852;
const EARTH_KM = 6371.0088;

/**
 * The NHC's two-thirds-probability circle radii for the Atlantic, in nautical
 * miles by forecast hour (the 2024 season's set, which averages 2019–2023
 * errors). The eastern Pacific's are smaller and other agencies' larger; one
 * table is used everywhere and the layer says so, rather than inventing
 * per-basin numbers nobody published for this use.
 */
export const CONE_RADII_NM = [
  [0, 0], [12, 26], [24, 39], [36, 53], [48, 65], [60, 79], [72, 99], [96, 139], [120, 191],
];

/** The cone's radius in km at a lead time in hours, linear between the table's rows. */
export function coneRadiusKm(leadHours, table = CONE_RADII_NM) {
  const h = Math.max(0, Number(leadHours) || 0);
  if (h >= table.at(-1)[0]) {
    // Past the table, grow at the last interval's rate rather than freezing.
    const [h0, r0] = table.at(-2);
    const [h1, r1] = table.at(-1);
    return (r1 + ((r1 - r0) / (h1 - h0)) * (h - h1)) * NM_KM;
  }
  for (let i = 1; i < table.length; i += 1) {
    const [h1, r1] = table[i];
    if (h <= h1) {
      const [h0, r0] = table[i - 1];
      return (r0 + ((r1 - r0) * (h - h0)) / (h1 - h0)) * NM_KM;
    }
  }
  return 0;
}

/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const unwrap = (lon, ref) => {
  let x = lon;
  while (x - ref > 180) x -= 360;
  while (x - ref < -180) x += 360;
  return x;
};

/**
 * The forecast track sampled every `stepHours`, by straight interpolation in
 * time between the published fixes (longitudes unwrapped across the
 * antimeridian so a storm crossing it is not interpolated the long way
 * round). Each sample carries its lead time from the first point.
 */
export function interpolateTrack(points, stepHours = 3) {
  const pts = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  if (pts.length < 2) return pts.map((p) => ({ ...p, lead: 0 }));
  const t0 = pts[0].time;
  const out = [];
  let lonRef = pts[0].lon;
  const unwrapped = pts.map((p) => {
    const lon = unwrap(p.lon, lonRef);
    lonRef = lon;
    return { ...p, lon };
  });
  for (let i = 0; i < unwrapped.length - 1; i += 1) {
    const a = unwrapped[i];
    const b = unwrapped[i + 1];
    const span = (b.time - a.time) / 3_600_000;
    const n = Math.max(1, Math.ceil(span / stepHours));
    for (let k = 0; k < n; k += 1) {
      const f = k / n;
      out.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        time: a.time + (b.time - a.time) * f,
        wind: Number.isFinite(a.wind) && Number.isFinite(b.wind) ? a.wind + (b.wind - a.wind) * f : a.wind,
      });
    }
  }
  out.push({ ...unwrapped.at(-1) });
  return out.map((p) => ({ ...p, lead: (p.time - t0) / 3_600_000 }));
}

/** Move a point `km` along a compass bearing, on the sphere. */
export function destination(lat, lon, bearingDeg, km) {
  const d = km / EARTH_KM;
  const b = bearingDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * DEG, l2 * DEG];
}

/** The initial compass bearing from one point to another. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * DEG) + 360) % 360;
}

/**
 * The cone as one polygon ring, [lon, lat] pairs, closed.
 *
 * The envelope of the circles is traced as the two sides of the track offset
 * by each sample's radius, perpendicular to the local heading, with a half
 * circle closing each end. The radius changes slowly against the spacing of
 * the samples, so the offset curve and the true envelope agree to well under
 * the cone's own uncertainty; at a hairpin the two sides could cross, so a
 * side point that would land inside an EARLIER sample's circle is dropped.
 */
export function conePolygon(track, { radiusKm = coneRadiusKm, capSteps = 12 } = {}) {
  const pts = track.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 2) return null;
  const radii = pts.map((p) => Math.max(1, radiusKm(p.lead ?? 0)));
  const heading = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    return bearing(a.lat, a.lon, b.lat, b.lon);
  });
  const inside = (lat, lon, upto) => {
    for (let j = 0; j < upto; j += 1) {
      if (distanceKm(lat, lon, pts[j].lat, pts[j].lon) < radii[j] * 0.98) return true;
    }
    return false;
  };
  const left = [];
  const right = [];
  pts.forEach((p, i) => {
    const l = destination(p.lat, p.lon, heading[i] - 90, radii[i]);
    const r = destination(p.lat, p.lon, heading[i] + 90, radii[i]);
    if (!inside(l[0], l[1], i)) left.push(l);
    if (!inside(r[0], r[1], i)) right.push(r);
  });
  const ring = [];
  // Start cap: from the right side round the back to the left.
  const first = pts[0];
  for (let k = 0; k <= capSteps; k += 1) {
    const b = heading[0] + 90 + (180 * k) / capSteps;
    ring.push(destination(first.lat, first.lon, b, radii[0]));
  }
  ring.push(...left);
  // End cap: from the left side round the front to the right.
  const last = pts.at(-1);
  const hl = heading.at(-1);
  for (let k = 0; k <= capSteps; k += 1) {
    const b = hl - 90 + (180 * k) / capSteps;
    ring.push(destination(last.lat, last.lon, b, radii.at(-1)));
  }
  ring.push(...right.reverse());
  ring.push(ring[0]);
  return ring.map(([lat, lon]) => [lon, lat]);
}

/** Point-in-ring, [lon, lat] ring, even-odd. */
export function inRing(lat, lon, ring) {
  let inside = false;
  const ref = ring[0][0];
  const x = unwrap(lon, ref);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = unwrap(ring[i][0], ref), yi = ring[i][1];
    const xj = unwrap(ring[j][0], ref), yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && x < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * What a forecast means for a PLACE: whether it is inside the cone, how close
 * the forecast centre passes, and when. This is what the myGeoID score reads
 * for "a cyclone is approaching", so it is here rather than in the layer.
 */
export function threatTo(lat, lon, track, cone) {
  if (!track?.length) return null;
  let best = null;
  for (const p of track) {
    const d = distanceKm(lat, lon, p.lat, p.lon);
    if (!best || d < best.km) best = { km: d, time: p.time, lead: p.lead, wind: p.wind };
  }
  return { ...best, inCone: cone ? inRing(lat, lon, cone) : false };
}

/* ── GDACS ─────────────────────────────────────────────────────────────── */

/** GDACS's list of tropical cyclones with an episode in the last `days`. */
export function gdacsCycloneListUrl(days = 10, now = Date.now()) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    + `?fromDate=${day(now - days * 86400000)}&toDate=${day(now)}`
    + "&alertlevel=Green;Orange;Red&eventlist=TC";
}

/** The geometry endpoint for one event's episode. */
export function gdacsGeometryUrl(eventId, episodeId) {
  return "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry"
    + `?eventtype=TC&eventid=${encodeURIComponent(eventId)}&episodeid=${encodeURIComponent(episodeId)}`;
}

/** Read GDACS's event list into the storms worth asking about. */
export function gdacsStorms(payload) {
  return (payload?.features || []).map((f) => {
    const p = f?.properties || {};
    const c = f?.geometry?.coordinates;
    if (!p.eventid) return null;
    return {
      eventId: p.eventid,
      episodeId: p.episodeid,
      name: p.name || p.eventname || `Cyclone ${p.eventid}`,
      alert: p.alertlevel || null,
      current: Boolean(p.iscurrent === true || p.iscurrent === "true"),
      geometryUrl: p.url?.geometry || null,
      report: p.url?.report || p.url?.details || null,
      lat: Array.isArray(c) ? c[1] : null,
      lon: Array.isArray(c) ? c[0] : null,
      to: p.todate || null,
    };
  }).filter(Boolean);
}

/**
 * A time from whatever a feature calls it. GDACS writes several spellings
 * across its products, and "dd/mm/yyyy hh:mm" is one of them, which
 * `Date.parse` would read the American way round.
 */
export function parseTime(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  const s = String(value).trim();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dmy) {
    const [, d, m, y, hh, mm, ss] = dmy;
    return Date.UTC(+y, +m - 1, +d, +hh, +mm, +(ss || 0));
  }
  const iso = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`);
  return Number.isFinite(iso) ? iso : NaN;
}

const TIME_KEYS = ["trackdate", "polygondate", "datetime", "date", "time", "fromdate", "todate"];
const WIND_KEYS = ["windspeed", "wind_speed", "maxwind", "vmax", "wind", "maxwindspeed"];

/**
 * A GDACS episode's geometry, read into a forecast track and (where it is
 * there) the agency's own cone. Defensive on purpose: the endpoint mixes
 * the track's points, its line, the wind-radius polygons and sometimes a
 * cone, under property names that vary by product. A point is a FIX when it
 * has a time; it is a FORECAST fix when it says so or lies after `nowMs`.
 * Winds are read as km/h (GDACS's own unit) and returned in knots.
 */
export function readGdacsGeometry(fc, nowMs = Date.now()) {
  const past = [];
  const forecast = [];
  let cone = null;
  for (const f of fc?.features || []) {
    const p = f?.properties || {};
    const g = f?.geometry;
    const klass = String(p.Class || p.class || p.polygonlabel || "").toLowerCase();
    if (g && /polygon/i.test(g.type) && /cone/.test(klass)) {
      const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((poly) => poly[0]);
      cone = rings.sort((a, b) => b.length - a.length)[0] || null;
      continue;
    }
    if (g?.type !== "Point") continue;
    const time = TIME_KEYS.map((k) => parseTime(p[k])).find(Number.isFinite);
    if (!Number.isFinite(time)) continue;
    const windRaw = WIND_KEYS.map((k) => Number(p[k])).find((x) => Number.isFinite(x) && x > 0);
    const fix = {
      lat: g.coordinates[1],
      lon: g.coordinates[0],
      time,
      wind: Number.isFinite(windRaw) ? windRaw / NM_KM : NaN, // km/h -> kt
      category: p.category || p.stormcategory || null,
    };
    const said = String(p.forecast ?? p.isforecast ?? "").toLowerCase();
    const isForecast = said === "true" || said === "1" || said === "yes"
      || (said === "" && time > nowMs + 30 * 60_000);
    (isForecast ? forecast : past).push(fix);
  }
  const byTime = (a, b) => a.time - b.time;
  past.sort(byTime);
  forecast.sort(byTime);
  // The forecast starts from the latest observed position.
  const start = past.at(-1);
  const track = start ? [start, ...forecast.filter((f) => f.time > start.time)] : forecast;
  return { past, forecast, track, cone };
}

/** Saffir–Simpson category for a wind in knots (0 = tropical storm, -1 = depression). */
export function saffirSimpson(kt) {
  if (!Number.isFinite(kt)) return null;
  if (kt >= 137) return 5;
  if (kt >= 113) return 4;
  if (kt >= 96) return 3;
  if (kt >= 83) return 2;
  if (kt >= 64) return 1;
  if (kt >= 34) return 0;
  return -1;
}
