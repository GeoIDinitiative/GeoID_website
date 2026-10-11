/**
 * Aircraft and ships, live: the pure half.
 *
 * The satellite tracker's arrangement, applied to the two kinds of traffic
 * that report their own positions in the open: aircraft by ADS-B, ships by
 * AIS. What this module owns is what every feed says differently and what is
 * the same once said — one normalised record per craft:
 *
 *   { id, name, kind, lat, lon, altM, onGround, speedMs, headingDeg,
 *     category, lengthM, timeMs, source, props }
 *
 * — and the arithmetic a live map needs between two answers: dead reckoning
 * along the reported track, a true size for the model, the legend's classes.
 *
 * WHICH FEEDS, AND WHY THESE. Only services a browser may call with no key of
 * ours: a key in a public page is a published key. Aircraft come from the
 * community ADS-B aggregators that serve the ADSBExchange v2 shape openly
 * (adsb.lol, ODbL; airplanes.live) and from OpenSky's anonymous REST API.
 * Ships come from Fintraffic's Digitraffic (CC BY 4.0, the Baltic and around
 * Finland, no key) and, for anywhere else, from aisstream.io with the
 * READER'S OWN key, which stays in their browser — never ours, never sent
 * anywhere but to that service.
 */

export const KT_TO_MS = 0.514444;
export const FT_TO_M = 0.3048;
const EARTH_M = 6371008.8;
const NM_M = 1852;

/* ── aircraft ─────────────────────────────────────────────────────────── */

/**
 * The open ADS-B aggregators, tried in this order. Each asks for a circle:
 * a point and a radius in NAUTICAL MILES, capped at 250 by every one of them.
 */
export const AIR_SOURCES = [
  { id: "adsblol", name: "adsb.lol", licence: "ODbL 1.0 — © adsb.lol contributors",
    url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${Math.round(nm)}`, read: (j) => readAdsbx(j, "adsb.lol") },
  { id: "airplaneslive", name: "airplanes.live", licence: "airplanes.live — non-commercial use, attribution",
    url: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${Math.round(nm)}`, read: (j) => readAdsbx(j, "airplanes.live") },
  { id: "opensky", name: "OpenSky Network", licence: "OpenSky Network — non-commercial research use, cite Schäfer et al. (2014)",
    url: (lat, lon, nm) => {
      const b = boxAbout(lat, lon, nm * NM_M);
      return `https://opensky-network.org/api/states/all?lamin=${b.south.toFixed(3)}&lomin=${b.west.toFixed(3)}&lamax=${b.north.toFixed(3)}&lomax=${b.east.toFixed(3)}`;
    }, read: (j) => readOpenSky(j) },
];

/** The altitude bands the aircraft legend is coloured by. */
export const AIR_CATEGORIES = [
  ["On the ground", "#9aa3b2"],
  ["Below 3,000 m", "#2ee06a"],
  ["3,000–9,000 m", "#ffc400"],
  ["Above 9,000 m", "#00e5ff"],
];

export function airCategory(altM, onGround) {
  if (onGround) return "On the ground";
  if (!Number.isFinite(altM) || altM < 3000) return "Below 3,000 m";
  return altM < 9000 ? "3,000–9,000 m" : "Above 9,000 m";
}

/**
 * Length in metres by ADS-B emitter category (DO-260B): A1 light, A2 small,
 * A3 large, A4 high-vortex large (a 757), A5 heavy, A6 high performance, A7
 * rotorcraft; B1 glider, B2 balloon, B4 ultralight, B6 drone. The model is one
 * generic airliner scaled to this, which is the honest claim: right size
 * beside the ground, not the right type.
 */
const AIR_LENGTH_M = { A1: 9, A2: 15, A3: 38, A4: 47, A5: 66, A6: 18, A7: 15, B1: 8, B2: 20, B4: 6, B6: 2 };
export function aircraftLengthM(emitter) {
  return AIR_LENGTH_M[String(emitter || "").toUpperCase()] || 38;
}

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

/** The ADSBExchange v2 shape (adsb.lol, airplanes.live): `{ ac: [...], now }`. */
export function readAdsbx(json, source = "ADS-B") {
  const now = num(json?.now) || Date.now();
  const out = [];
  for (const a of json?.ac || json?.aircraft || []) {
    const lat = num(a.lat ?? a.lastPosition?.lat); const lon = num(a.lon ?? a.lastPosition?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const onGround = a.alt_baro === "ground";
    const altFt = onGround ? 0 : num(a.alt_geom ?? a.alt_baro);
    const altM = Number.isFinite(altFt) ? altFt * FT_TO_M : NaN;
    const seen = num(a.seen_pos ?? a.seen);
    const callsign = String(a.flight || "").trim();
    out.push({
      id: `air:${String(a.hex || "").toLowerCase()}`,
      name: callsign || a.r || String(a.hex || "").toUpperCase(),
      kind: "Aircraft",
      lat, lon, altM, onGround,
      speedMs: num(a.gs) * KT_TO_MS,
      headingDeg: num(a.track ?? a.true_heading ?? a.mag_heading),
      category: airCategory(altM, onGround),
      lengthM: aircraftLengthM(a.category),
      timeMs: now - (Number.isFinite(seen) ? seen * 1000 : 0),
      source,
      props: {
        callsign: callsign || null, registration: a.r || null, icao24: a.hex || null, type: a.t || null,
        description: a.desc || null, emitter: a.category || null, squawk: a.squawk || null,
        vertical_rate_m_s: Number.isFinite(num(a.baro_rate ?? a.geom_rate)) ? num(a.baro_rate ?? a.geom_rate) * FT_TO_M / 60 : null,
        emergency: a.emergency && a.emergency !== "none" ? a.emergency : null,
      },
    });
  }
  return out;
}

/**
 * OpenSky's state vectors: `{ time, states: [[icao24, callsign, country,
 * time_position, last_contact, lon, lat, baro_alt_m, on_ground, velocity,
 * true_track, vertical_rate, sensors, geo_alt_m, squawk, spi, source,
 * category]] }` — already in metres and metres per second.
 */
export function readOpenSky(json) {
  const out = [];
  const emitter = ["", "", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "B3", "B4", "", "B6"];
  for (const s of json?.states || []) {
    const lon = num(s[5]); const lat = num(s[6]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const onGround = Boolean(s[8]);
    const altM = onGround ? 0 : num(s[13] ?? s[7]);
    const callsign = String(s[1] || "").trim();
    const cat = emitter[num(s[17])] || "";
    out.push({
      id: `air:${String(s[0] || "").toLowerCase()}`,
      name: callsign || String(s[0] || "").toUpperCase(),
      kind: "Aircraft",
      lat, lon, altM, onGround,
      speedMs: num(s[9]),
      headingDeg: num(s[10]),
      category: airCategory(altM, onGround),
      lengthM: aircraftLengthM(cat),
      timeMs: (num(s[3]) || num(json?.time) || Date.now() / 1000) * 1000,
      source: "OpenSky Network",
      props: { callsign: callsign || null, icao24: s[0] || null, country: s[2] || null, squawk: s[14] || null,
        vertical_rate_m_s: Number.isFinite(num(s[11])) ? num(s[11]) : null, emitter: cat || null },
    });
  }
  return out;
}

/* ── ships ────────────────────────────────────────────────────────────── */

/** The ship legend, by AIS ship-type family. */
export const SHIP_CATEGORIES = [
  ["Cargo", "#3f8cff"],
  ["Tanker", "#ff5c4d"],
  ["Passenger", "#c26bff"],
  ["Fishing", "#2ee06a"],
  ["High speed", "#00e5ff"],
  ["Tug and special", "#ffc400"],
  ["Pleasure and sailing", "#ff8fd0"],
  ["Other or unknown", "#9aa3b2"],
];

/** AIS ship type (ITU-R M.1371) to its family. */
export function shipCategory(type) {
  const t = Math.round(num(type));
  if (t >= 70 && t <= 79) return "Cargo";
  if (t >= 80 && t <= 89) return "Tanker";
  if (t >= 60 && t <= 69) return "Passenger";
  if (t === 30) return "Fishing";
  if (t >= 40 && t <= 49) return "High speed";
  if ((t >= 50 && t <= 59) || t === 31 || t === 32 || t === 33 || t === 34 || t === 35) return "Tug and special";
  if (t === 36 || t === 37) return "Pleasure and sailing";
  return "Other or unknown";
}

const SHIP_LENGTH_M = { "Cargo": 190, "Tanker": 230, "Passenger": 170, "Fishing": 25, "High speed": 40, "Tug and special": 32, "Pleasure and sailing": 14, "Other or unknown": 60 };

/** Length from the AIS dimensions to bow and stern, else the family's typical size. */
export function shipLengthM(dims, category) {
  const a = num(dims?.A ?? dims?.referencePointA); const b = num(dims?.B ?? dims?.referencePointB);
  const L = (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
  return L >= 3 && L <= 460 ? L : (SHIP_LENGTH_M[category] || 60);
}

/** AIS navigational status codes, as words. */
export const NAV_STATUS = ["Under way using engine", "At anchor", "Not under command", "Restricted manoeuvrability",
  "Constrained by draught", "Moored", "Aground", "Engaged in fishing", "Under way sailing", "Reserved (HSC)",
  "Reserved (WIG)", "Power-driven towing astern", "Power-driven pushing or towing", "Reserved", "AIS-SART active", "Not defined"];

/**
 * Digitraffic's positions (GeoJSON, `properties.sog` knots, `cog`/`heading`
 * degrees, 511 = no heading) joined to its vessel register (`name`,
 * `shipType`, `referencePointA..D`, `destination`, `callSign`, `imo`).
 */
export function readDigitraffic(positions, vessels = []) {
  const meta = new Map((Array.isArray(vessels) ? vessels : []).map((v) => [Number(v.mmsi), v]));
  const out = [];
  for (const f of positions?.features || []) {
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const p = f.properties || {};
    const mmsi = Number(p.mmsi ?? f.mmsi);
    const v = meta.get(mmsi) || {};
    const category = shipCategory(v.shipType);
    const heading = num(p.heading);
    out.push({
      id: `ship:${mmsi}`,
      name: String(v.name || "").trim() || `MMSI ${mmsi}`,
      kind: "Ship", lat, lon, altM: 0, onGround: false,
      speedMs: num(p.sog) * KT_TO_MS,
      headingDeg: Number.isFinite(heading) && heading !== 511 ? heading : num(p.cog),
      category,
      lengthM: shipLengthM(v, category),
      timeMs: num(p.timestampExternal) || Date.now(),
      source: "Digitraffic (Fintraffic)",
      props: { mmsi, imo: v.imo || null, callsign: v.callSign || null, ship_type: v.shipType ?? null,
        destination: v.destination || null, draught_m: Number.isFinite(num(v.draught)) ? num(v.draught) / 10 : null,
        status: NAV_STATUS[num(p.navStat)] || null },
    });
  }
  return out;
}

/**
 * One aisstream.io message folded into the craft it describes. Position
 * reports move a ship; static data names and sizes it. Returns the updated
 * record, or null for a message that says nothing placeable.
 */
export function foldAisStream(message, known = new Map()) {
  const meta = message?.MetaData || {};
  const mmsi = Number(meta.MMSI);
  if (!mmsi) return null;
  const id = `ship:${mmsi}`;
  const rec = known.get(id) || { id, name: `MMSI ${mmsi}`, kind: "Ship", altM: 0, onGround: false, category: "Other or unknown", lengthM: 60, source: "aisstream.io", props: { mmsi } };
  const name = String(meta.ShipName || "").trim();
  if (name) rec.name = name;
  const body = message.Message || {};
  const pos = body.PositionReport || body.StandardClassBPositionReport || body.ExtendedClassBPositionReport;
  if (pos) {
    const lat = num(pos.Latitude ?? meta.latitude); const lon = num(pos.Longitude ?? meta.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    rec.lat = lat; rec.lon = lon;
    rec.speedMs = num(pos.Sog) * KT_TO_MS;
    const th = num(pos.TrueHeading);
    rec.headingDeg = Number.isFinite(th) && th !== 511 ? th : num(pos.Cog);
    rec.timeMs = Date.parse(String(meta.time_utc || "").replace(" +0000 UTC", "Z").replace(" ", "T")) || Date.now();
    if (Number.isFinite(num(pos.NavigationalStatus))) rec.props.status = NAV_STATUS[num(pos.NavigationalStatus)] || null;
  }
  const stat = body.ShipStaticData;
  if (stat) {
    rec.category = shipCategory(stat.Type);
    rec.lengthM = shipLengthM(stat.Dimension, rec.category);
    rec.props = { ...rec.props, ship_type: stat.Type ?? null, callsign: String(stat.CallSign || "").trim() || null,
      imo: stat.ImoNumber || null, destination: String(stat.Destination || "").trim() || null };
    if (String(stat.Name || "").trim()) rec.name = String(stat.Name).trim();
  }
  if (!Number.isFinite(rec.lat)) return null;
  known.set(id, rec);
  return rec;
}

/** The subscription aisstream.io wants first: the reader's key and the box. */
export function aisStreamSubscription(key, box) {
  return JSON.stringify({
    APIKey: key,
    BoundingBoxes: [[[box.south, box.west], [box.north, box.east]]],
    FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData"],
  });
}

/* ── geometry shared by both ──────────────────────────────────────────── */

/** A box `metres` either side of a point, longitudes signed. */
export function boxAbout(lat, lon, metres) {
  const dLat = (metres / EARTH_M) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return { south: Math.max(-90, lat - dLat), north: Math.min(90, lat + dLat), west: lon - dLon, east: lon + dLon };
}

/**
 * Where a craft is `ms` after its report, carried along its track at its
 * speed on the sphere (the destination-point formula). Capped, because a
 * report a quarter of an hour old extrapolated at 250 m/s is a guess 200 km
 * long: past `maxMs` the craft is held where it was last placed.
 */
export function deadReckon(rec, nowMs, maxMs = 90000) {
  const t0 = Number.isFinite(rec.timeMs) ? rec.timeMs : nowMs;
  const dt = Math.max(0, Math.min(maxMs, nowMs - t0)) / 1000;
  const v = rec.speedMs; const h = rec.headingDeg;
  if (!(dt > 0) || !Number.isFinite(v) || !Number.isFinite(h) || v <= 0.2 || rec.onGround) return { lat: rec.lat, lon: rec.lon };
  const d = (v * dt) / EARTH_M;
  const r = Math.PI / 180;
  const p1 = rec.lat * r; const l1 = rec.lon * r; const b = h * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / r, lon: ((((l2 / r) + 540) % 360) - 180) };
}

/**
 * A craft's axes in the scene frame, from the radial under it and its
 * heading: +X forward, +Y to port, +Z up -- the frame the models are baked
 * in. North is the pole (scene +Y) with the radial taken out, east is north
 * crossed with up, which is the viewer's own convention (`latLonToVector3`:
 * scene x = -cos lat cos lon, y = sin lat, z = cos lat sin lon). A pitch
 * tilts the nose up along the flight path. Plain arrays, so it is tested in
 * Node against dead reckoning rather than against a copy of itself.
 */
export function headingBasis(position, headingDeg, pitchRad = 0) {
  const len = Math.hypot(position[0], position[1], position[2]) || 1;
  const up = [position[0] / len, position[1] / len, position[2] / len];
  let north = [-up[0] * up[1], 1 - up[1] * up[1], -up[2] * up[1]];
  let n = Math.hypot(north[0], north[1], north[2]);
  if (n < 1e-9) { north = [1, 0, 0]; n = 1; }
  north = north.map((v) => v / n);
  const east = [north[1] * up[2] - north[2] * up[1], north[2] * up[0] - north[0] * up[2], north[0] * up[1] - north[1] * up[0]];
  const h = ((Number.isFinite(headingDeg) ? headingDeg : 0) * Math.PI) / 180;
  const level = north.map((v, i) => v * Math.cos(h) + east[i] * Math.sin(h));
  const fwd = level.map((v, i) => v * Math.cos(pitchRad) + up[i] * Math.sin(pitchRad));
  const zen = up.map((v, i) => v * Math.cos(pitchRad) - level[i] * Math.sin(pitchRad));
  const left = [zen[1] * fwd[2] - zen[2] * fwd[1], zen[2] * fwd[0] - zen[0] * fwd[2], zen[0] * fwd[1] - zen[1] * fwd[0]];
  return { fwd, left, up: zen };
}

/** The radius in nautical miles a view of `altitudeKm` deserves, within the feeds' 250 cap. */
export function radiusForView(altitudeKm, floorNm = 25) {
  const nm = (Math.max(1, altitudeKm) * 1.1 * 1000) / NM_M;
  return Math.max(floorNm, Math.min(250, nm));
}

/** Merge a new answer into what is held, newest report wins; drop the stale. */
export function mergeRecords(held, fresh, nowMs, staleMs) {
  for (const r of fresh) {
    const old = held.get(r.id);
    if (!old || !(old.timeMs > r.timeMs)) {
      // Static facts a later answer lacks are kept (a position report has no name).
      if (old) r.props = { ...old.props, ...Object.fromEntries(Object.entries(r.props).filter(([, v]) => v != null)) };
      held.set(r.id, r);
    }
  }
  for (const [id, r] of held) if (nowMs - (r.timeMs || 0) > staleMs) held.delete(id);
  return held;
}

/** The card's rows for a craft, as words. */
export function cardRows(rec, nowMs = Date.now()) {
  const rows = [];
  const age = Math.max(0, Math.round((nowMs - rec.timeMs) / 1000));
  if (rec.kind === "Aircraft") {
    rows.push(["Altitude", rec.onGround ? "on the ground" : Number.isFinite(rec.altM) ? `${Math.round(rec.altM).toLocaleString("en-GB")} m (${Math.round(rec.altM / FT_TO_M).toLocaleString("en-GB")} ft)` : "not reported"]);
    if (Number.isFinite(rec.props?.vertical_rate_m_s) && Math.abs(rec.props.vertical_rate_m_s) > 0.5) rows.push(["Climb", `${rec.props.vertical_rate_m_s > 0 ? "+" : "−"}${Math.abs(rec.props.vertical_rate_m_s).toFixed(1)} m/s`]);
  }
  if (Number.isFinite(rec.speedMs)) rows.push(["Speed", `${Math.round(rec.speedMs * 3.6)} km/h (${Math.round(rec.speedMs / KT_TO_MS)} kn)`]);
  if (Number.isFinite(rec.headingDeg)) rows.push(["Heading", `${Math.round(rec.headingDeg)}°`]);
  const p = rec.props || {};
  for (const [key, label] of [["type", "Type"], ["description", "Model"], ["registration", "Registration"], ["icao24", "ICAO 24-bit"],
    ["country", "Registered in"], ["squawk", "Squawk"], ["emergency", "Emergency"], ["mmsi", "MMSI"], ["imo", "IMO"],
    ["callsign", "Call sign"], ["destination", "Destination"], ["status", "Status"], ["draught_m", "Draught"]]) {
    if (p[key] == null || p[key] === "") continue;
    rows.push([label, key === "draught_m" ? `${p[key]} m` : String(p[key])]);
  }
  rows.push(["Size drawn", `${Math.round(rec.lengthM)} m long`]);
  rows.push(["Reported", age < 2 ? "just now" : `${age} s ago${age > 60 ? " — moved on from there by its last speed and heading" : ""}`]);
  rows.push(["Source", rec.source]);
  return rows;
}
