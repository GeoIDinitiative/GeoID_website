/** Aircraft and ships, the pure half. Run: node GeoID_GIS/viewer/gis/traffic-feeds.test.mjs */
import {
  AIR_SOURCES, AIR_CATEGORIES, SHIP_CATEGORIES, airCategory, aircraftLengthM, readAdsbx, readOpenSky,
  shipCategory, shipLengthM, readDigitraffic, foldAisStream, aisStreamSubscription,
  boxAbout, deadReckon, radiusForView, mergeRecords, cardRows, headingBasis, KT_TO_MS, FT_TO_M,
} from "./traffic-feeds.js";

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass += 1; else { fail += 1; console.error("FAIL:", m); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
process.on("exit", () => { console.log(`traffic-feeds: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });

// ── aircraft ──
{
  const json = { now: 1_700_000_000_000, ac: [
    { hex: "4CA87D", flight: "RYR4KJ  ", r: "EI-DCL", t: "B738", category: "A3", lat: 53.4, lon: -6.2, alt_baro: 36000, alt_geom: 36200, gs: 450, track: 90, seen_pos: 2.5, baro_rate: 1200, squawk: "4521" },
    { hex: "abc123", alt_baro: "ground", lat: 53.42, lon: -6.27, gs: 8, track: 270 },
    { hex: "nopos", flight: "X" },
  ] };
  const got = readAdsbx(json, "adsb.lol");
  ok(got.length === 2, "a craft with no position is skipped");
  const a = got[0];
  ok(a.id === "air:4ca87d" && a.name === "RYR4KJ" && a.kind === "Aircraft", "id lower-cased, callsign trimmed");
  ok(near(a.altM, 36200 * FT_TO_M, 1e-6), "geometric altitude preferred, in metres");
  ok(near(a.speedMs, 450 * KT_TO_MS, 1e-9) && a.headingDeg === 90, "knots to m/s, track as heading");
  ok(a.category === "Above 9,000 m" && a.lengthM === 38, "altitude band and emitter length");
  ok(a.timeMs === 1_700_000_000_000 - 2500, "report time is now less seen_pos");
  ok(near(a.props.vertical_rate_m_s, 1200 * FT_TO_M / 60, 1e-9), "ft/min to m/s");
  const g = got[1];
  ok(g.onGround && g.altM === 0 && g.category === "On the ground" && g.name === "ABC123", "on the ground; hex as the name");
}
{
  const json = { time: 1_700_000_000, states: [
    ["3c6444", "DLH4AB ", "Germany", 1_699_999_990, 1_699_999_995, 8.5, 50.0, 10000, false, 230, 45, -2, null, 10200, "1000", false, 0, 6],
    ["a00001", "", "United States", null, 1_699_999_995, null, null, null, true, 0, 0, null, null, null, null, false, 0, 0],
  ] };
  const got = readOpenSky(json);
  ok(got.length === 1 && got[0].id === "air:3c6444", "OpenSky: a state with no position is skipped");
  ok(got[0].altM === 10200 && got[0].speedMs === 230 && got[0].props.emitter === "A5" && got[0].lengthM === 66, "OpenSky: metres, m/s, category 6 is A5 heavy");
  ok(got[0].timeMs === 1_699_999_990_000, "OpenSky: time_position in seconds");
}
ok(airCategory(2999, false) === "Below 3,000 m" && airCategory(3000, false) === "3,000–9,000 m" && airCategory(NaN, false) === "Below 3,000 m", "altitude bands");
ok(aircraftLengthM("a7") === 15 && aircraftLengthM("") === 38, "emitter lengths, airliner by default");
ok(AIR_SOURCES[0].url(53.4, -6.2, 100.4) === "https://api.adsb.lol/v2/point/53.4000/-6.2000/100", "adsb.lol URL");
ok(/lamin=5[0-9.]+&lomin=-[0-9.]+&lamax=5[0-9.]+&lomax=-[0-9.]+/.test(AIR_SOURCES[2].url(53.4, -6.2, 50)), "OpenSky asks a box");
ok(AIR_CATEGORIES.length === 4 && SHIP_CATEGORIES.length === 8, "legend sizes");

// ── ships ──
ok(shipCategory(70) === "Cargo" && shipCategory(84) === "Tanker" && shipCategory(60) === "Passenger" && shipCategory(30) === "Fishing", "AIS families");
ok(shipCategory(52) === "Tug and special" && shipCategory(37) === "Pleasure and sailing" && shipCategory(0) === "Other or unknown" && shipCategory(undefined) === "Other or unknown", "more families and the fallback");
ok(shipLengthM({ A: 150, B: 30 }, "Cargo") === 180 && shipLengthM({}, "Tanker") === 230 && shipLengthM({ A: 900, B: 0 }, "Fishing") === 25, "length from dimensions, else typical, nonsense refused");
{
  const positions = { features: [
    { mmsi: 230145000, geometry: { coordinates: [24.95, 60.15] }, properties: { mmsi: 230145000, sog: 12, cog: 181, heading: 511, navStat: 0, timestampExternal: 1_700_000_000_000 } },
    { mmsi: 1, geometry: { coordinates: [] }, properties: {} },
  ] };
  const vessels = [{ mmsi: 230145000, name: "VIKING GRACE ", shipType: 60, referencePointA: 180, referencePointB: 38, destination: "TURKU", callSign: "OJMS", imo: 9606900, draught: 68 }];
  const got = readDigitraffic(positions, vessels);
  ok(got.length === 1 && got[0].name === "VIKING GRACE" && got[0].category === "Passenger" && got[0].lengthM === 218, "Digitraffic: joined to the register");
  ok(got[0].headingDeg === 181 && near(got[0].speedMs, 12 * KT_TO_MS, 1e-9), "heading 511 means none: course instead");
  ok(got[0].props.draught_m === 6.8 && got[0].props.status === "Under way using engine", "draught in tenths; status in words");
}
{
  const known = new Map();
  const pos = { MetaData: { MMSI: 366999999, ShipName: "PACIFIC ", time_utc: "2023-11-14 22:13:20.000 +0000 UTC" }, Message: { PositionReport: { Latitude: 37.8, Longitude: -122.4, Sog: 10, TrueHeading: 45, Cog: 50, NavigationalStatus: 0 } } };
  const r = foldAisStream(pos, known);
  ok(r && r.name === "PACIFIC" && r.lat === 37.8 && r.headingDeg === 45 && r.timeMs === Date.parse("2023-11-14T22:13:20.000Z"), "aisstream: a position report places a ship");
  const stat = { MetaData: { MMSI: 366999999 }, Message: { ShipStaticData: { Type: 80, Dimension: { A: 200, B: 40 }, CallSign: "WXYZ", Destination: "OAKLAND", Name: "PACIFIC STAR" } } };
  const r2 = foldAisStream(stat, known);
  ok(r2.category === "Tanker" && r2.lengthM === 240 && r2.name === "PACIFIC STAR" && r2.lat === 37.8, "aisstream: static data names and sizes it");
  ok(foldAisStream({ MetaData: { MMSI: 1 }, Message: { ShipStaticData: { Type: 70 } } }, new Map()) === null, "static data alone places nothing");
  ok(foldAisStream({ MetaData: {} }, new Map()) === null, "no MMSI is nothing");
  const sub = JSON.parse(aisStreamSubscription("k", { south: 1, west: 2, north: 3, east: 4 }));
  ok(sub.APIKey === "k" && JSON.stringify(sub.BoundingBoxes) === "[[[1,2],[3,4]]]", "the subscription box is [[lat, lon], [lat, lon]]");
}

// ── geometry ──
{
  const b = boxAbout(0, 0, 111_195);
  ok(near(b.north, 1, 0.001) && near(b.east, 1, 0.001), "a degree of the equator either side");
  const r = deadReckon({ lat: 0, lon: 0, speedMs: 250, headingDeg: 0, timeMs: 0 }, 60_000);
  ok(near(r.lat, 0.13490, 1e-4) && near(r.lon, 0, 1e-9), "250 m/s north for a minute");
  const e = deadReckon({ lat: 60, lon: 10, speedMs: 100, headingDeg: 90, timeMs: 0 }, 60_000);
  ok(e.lat < 60 && near(e.lat, 60, 0.01) && e.lon > 10.1, "east at 60°N runs twice as far in longitude, along a great circle");
  const capped = deadReckon({ lat: 0, lon: 0, speedMs: 250, headingDeg: 0, timeMs: 0 }, 3_600_000, 90_000);
  ok(near(capped.lat, 0.13490 * 1.5, 1e-4), "carried no further than the cap");
  const still = deadReckon({ lat: 5, lon: 5, speedMs: 0.1, headingDeg: 0, timeMs: 0 }, 60_000);
  ok(still.lat === 5 && still.lon === 5, "a moored ship stays put");
  ok(deadReckon({ lat: 5, lon: 5, speedMs: 200, headingDeg: 0, timeMs: 0, onGround: true }, 60_000).lat === 5, "a taxiing aircraft is not extrapolated");
  const wrap = deadReckon({ lat: 0, lon: 179.99, speedMs: 250, headingDeg: 90, timeMs: 0 }, 60_000);
  ok(wrap.lon < -179.8, "east across the antimeridian wraps");
  ok(radiusForView(10) === 25 && radiusForView(100_000) === 250 && near(radiusForView(200), 118.8, 0.1), "radius by altitude within the feeds' caps");
}
{
  const held = new Map();
  const a = (id, t, props = {}) => ({ id, timeMs: t, props });
  mergeRecords(held, [a("x", 100, { name: "kept" })], 100, 1000);
  mergeRecords(held, [a("x", 200, { other: 1, name: null })], 200, 1000);
  ok(held.get("x").props.name === "kept" && held.get("x").props.other === 1, "a later report keeps the static facts it lacks");
  mergeRecords(held, [a("x", 150, { name: "older" })], 300, 1000);
  ok(held.get("x").timeMs === 200, "an older report does not replace a newer one");
  mergeRecords(held, [], 5000, 1000);
  ok(!held.has("x"), "the stale are dropped");
}
{
  const rows = cardRows({ kind: "Aircraft", altM: 10000, speedMs: 230, headingDeg: 45, lengthM: 38, timeMs: 0, source: "adsb.lol", props: { callsign: "DLH", vertical_rate_m_s: -6 } }, 120_000);
  const get = (k) => rows.find((r) => r[0] === k)?.[1];
  ok(get("Altitude") === "10,000 m (32,808 ft)" && get("Climb") === "−6.0 m/s" && get("Speed") === "828 km/h (447 kn)", "card rows in words");
  ok(/120 s ago — moved on/.test(get("Reported")) && get("Source") === "adsb.lol", "an old report says it was carried on");
}

// ── the model points where the craft is going ──
{
  // The viewer's own formula (earth-viewer.js latLonToVector3), written here
  // independently of the module.
  const scene = (lat, lon) => {
    const a = (lat * Math.PI) / 180; const b = (lon * Math.PI) / 180;
    return [-Math.cos(a) * Math.cos(b), Math.sin(a), Math.cos(a) * Math.sin(b)];
  };
  for (const [lat, lon, heading] of [[0, 0, 0], [51.5, -0.1, 90], [60, 25, 297], [-33.9, 151.2, 200], [10, 170, 45]]) {
    const start = { lat, lon, speedMs: 200, headingDeg: heading, timeMs: 0 };
    const end = deadReckon(start, 5_000);
    const p0 = scene(lat, lon); const p1 = scene(end.lat, end.lon);
    const d = p1.map((v, i) => v - p0[i]); const n = Math.hypot(...d);
    const { fwd, left, up } = headingBasis(p0, heading);
    const along = fwd.reduce((acc, v, i) => acc + v * d[i] / n, 0);
    ok(along > 0.9999, `forward is the direction of travel at ${lat},${lon} heading ${heading} (cos ${along.toFixed(6)})`);
    ok(Math.abs(up.reduce((acc, v, i) => acc + v * p0[i], 0) - 1) < 1e-9, "up is the radial");
    ok(Math.abs(left.reduce((acc, v, i) => acc + v * fwd[i], 0)) < 1e-9, "port is square to the bow");
  }
  // Port is to the LEFT of the bow: heading north at the equator, port is west.
  const { left } = headingBasis(scene(0, 0), 0);
  const west = scene(0, -1).map((v, i) => v - scene(0, 0)[i]);
  ok(left.reduce((a, v, i) => a + v * west[i], 0) > 0, "heading north, port is west");
  const { fwd: climb } = headingBasis(scene(0, 0), 0, 0.1);
  ok(climb.reduce((a, v, i) => a + v * scene(0, 0)[i], 0) > 0.09, "a climbing aircraft's nose is above the horizon");
}

// ── the page half is wired where the satellites are ──
{
  const { readFileSync } = await import("node:fs");
  const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  const traffic = read("./traffic.js");
  const index = read("../index.html");
  ok(/id="traffic-section"/.test(index) && /gis\/traffic\.js\?v=/.test(index), "the section and its script are on the Earth page");
  ok(/id: "traffic-section", host: "earth-system-satellites-host"/.test(read("./toolbox.js")), "nested beside the satellites");
  ok(/"traffic-section"/.test(read("./mode-manager.js")) && /Live aircraft/.test(read("./section-activity.js")), "the mode shows it and the tab lights for it");
  ok(/geoid-gis:aisstream-key", feature: null, explicitOnly: true/.test(read("./credential-wipe.js")), "the reader's own AIS key is wiped only on request");
  ok(/extra_rows: Array\.isArray\(p\.extra_rows\)/.test(read("./point-labels.js")), "card rows pass through featureToItem");
  const style = traffic.slice(traffic.indexOf("const STYLE = ["), traffic.indexOf("].join("));
  ok(style.length > 100 && !style.includes("`"), "the stylesheet is no template literal and holds no backtick");
  ok(/groundPick: false/.test(traffic) && /keepRenderOrder = true/.test(traffic), "its own picking, and its dots kept in band 198");
  ok(/p\.dot\(camLocal\) >= record\.groundR \* record\.groundR/.test(traffic), "the far side is put away by the horizon test, never a hemisphere");
  ok(!/surfacePoint\(/.test(traffic.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "no call to the seam's caching surfacePoint for moving craft");
}
