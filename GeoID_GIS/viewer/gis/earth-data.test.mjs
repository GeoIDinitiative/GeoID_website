/**
 * The three services, against responses they actually sent.
 *
 * Every expected value below was taken from a live call recorded while this
 * was written, not from the documentation: SoilGrids' integer scaling and
 * WorldPop's finished-but-failed task are both things the docs describe
 * loosely and the service does exactly.
 */

import {
  soilUrl, parseSoil, strengthFromTexture, SOIL_PROPERTIES,
  stationUrl, waveformUrl, parseStationText, FDSN_NODES,
  populationUrl, taskUrl, parseTask,
} from "./earth-data.js";

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL  ${name}  — ${e.message}`);
  }
}
function eq(a, b, what = "") {
  if (a !== b) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function near(a, b, tol, what = "") {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} expected ~${b}, got ${a}`);
}

/* ── SoilGrids ────────────────────────────────────────────────────────────── */

check("the soil query names each property and depth separately", () => {
  const u = soilUrl(54.5, -6.8, { properties: ["clay", "sand"], depths: ["0-5cm"] });
  eq(u.includes("lat=54.50000"), true, "lat");
  eq(u.includes("lon=-6.80000"), true, "lon");
  eq((u.match(/property=/g) || []).length, 2, "one parameter per property");
  eq(u.includes("value=mean"), true, "mean");
});

// The real response for 54.5N 6.8W, trimmed to two properties.
const SOIL_RESPONSE = {
  properties: {
    layers: [
      {
        name: "bdod",
        unit_measure: { d_factor: 100, mapped_units: "cg/cm³", target_units: "kg/dm³" },
        depths: [{ label: "0-5cm", values: { mean: 95 } },
                 { label: "5-15cm", values: { mean: 99 } }],
      },
      {
        name: "clay",
        unit_measure: { d_factor: 10, mapped_units: "g/kg", target_units: "%" },
        depths: [{ label: "0-5cm", values: { mean: 212 } },
                 { label: "5-15cm", values: { mean: 215 } }],
      },
    ],
  },
};

check("integers are scaled by the factor IN THE RESPONSE, not a remembered one", () => {
  const out = parseSoil(SOIL_RESPONSE);
  eq(out.ok, true, "ok");
  const clay = out.rows.find((r) => r.property === "clay" && r.depth === "0-5cm");
  const bdod = out.rows.find((r) => r.property === "bdod" && r.depth === "0-5cm");
  // 212 / 10 = 21.2 % clay, 95 / 100 = 0.95 kg/dm3. The two factors differ,
  // which is why one constant cannot serve both.
  near(clay.value, 21.2, 1e-9, "clay");
  near(bdod.value, 0.95, 1e-9, "bulk density");
  eq(clay.unit, "%", "clay unit");
  eq(bdod.unit, "kg/dm³", "density unit");
});

check("an unmapped point is null, never zero", () => {
  const out = parseSoil({ properties: { layers: [{
    name: "clay",
    unit_measure: { d_factor: 10 },
    depths: [{ label: "0-5cm", values: { mean: null } }],
  }] } });
  eq(out.rows[0].value, null, "value");
  eq(out.ok, false, "an ocean point is not a reading");
  eq(/does not map/.test(out.message), true, `says why: ${out.message}`);
});

check("every property this asks for has a label and a unit", () => {
  Object.entries(SOIL_PROPERTIES).forEach(([key, meta]) => {
    eq(Boolean(meta.label), true, `${key} label`);
    eq(typeof meta.unit, "string", `${key} unit`);
  });
});

check("texture gives strength that falls with clay, and stays modest", () => {
  const sand = strengthFromTexture(5, 85);
  const clay = strengthFromTexture(60, 10);
  eq(sand.frictionDeg > clay.frictionDeg, true, "sand has the higher friction angle");
  near(sand.frictionDeg, 35.3, 0.05, "clean sand");
  near(clay.frictionDeg, 27.6, 0.05, "heavy clay");
  // Generous cohesion is what makes an infinite-slope model call everything
  // safe, so it is capped where shallow soil actually sits.
  eq(clay.cohesionKpa <= 8, true, "cohesion capped");
  eq(sand.cohesionKpa < clay.cohesionKpa, true, "sand holds less");
  eq(clay.screening, true, "flagged as screening values");
});

check("no texture, no strength — rather than a default", () => {
  eq(strengthFromTexture(null, null), null);
});

/* ── FDSN ─────────────────────────────────────────────────────────────────── */

check("both nodes are the ones verified to allow a browser", () => {
  eq(FDSN_NODES.length, 2, "nodes");
  eq(FDSN_NODES.some((n) => /earthscope|iris/i.test(n.base)), false,
    "EarthScope sends no CORS header and must not be offered");
});

check("a station query asks by radius around the point", () => {
  const u = stationUrl(FDSN_NODES[0].base, { lat: 37.75, lon: 15.0, radiusDeg: 1.5 });
  eq(u.includes("latitude=37.7500"), true, "lat");
  eq(u.includes("maxradius=1.5"), true, "radius");
  eq(u.includes("format=text"), true, "text");
});

check("an empty location becomes --, which is what FDSN means by it", () => {
  const u = waveformUrl(FDSN_NODES[0].base, {
    net: "GE", sta: "STU", loc: "", cha: "BHZ",
    start: "2023-02-06T01:18:00Z", end: "2023-02-06T01:20:00Z",
  });
  eq(u.includes("loc=--"), true, `location: ${u}`);
  // Omitting it means "any", which returns co-located sensors stitched
  // together into a trace that is not of anything.
  eq(u.includes("start=2023-02-06T01%3A18%3A00"), true, "start, seconds only");
});

check("the pipe-delimited station list parses, and drops the header", () => {
  const text = [
    "#Network|Station|Location|Channel|Latitude|Longitude|Elevation|Depth|Azimuth|Dip|Sensor|Scale|ScaleFreq|ScaleUnits|SampleRate|StartTime|EndTime",
    "2Q|AQG||MGZ|37.76589|15.016805|2920.0|0.0|0.0|-90.0||1.0|1.0|M/S**2|1.8518|2020-07-01T00:00:00|2024-12-31T23:59:59",
  ].join("\n");
  const rows = parseStationText(text);
  eq(rows.length, 1, "one channel");
  eq(rows[0].id, "2Q.AQG..MGZ", "id");
  near(rows[0].lat, 37.76589, 1e-9, "lat");
  near(rows[0].sampleRate, 1.8518, 1e-9, "rate");
});

check("a station row with no coordinates is not a station", () => {
  eq(parseStationText("XX|YY||ZZZ|||\n").length, 0);
});

/* ── WorldPop ─────────────────────────────────────────────────────────────── */

const BOX = {
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[-6.6, 54.4], [-5.9, 54.4],
    [-5.9, 54.7], [-6.6, 54.7], [-6.6, 54.4]]] },
};

check("a Feature is unwrapped to its geometry, which is what the API accepts", () => {
  const u = populationUrl(BOX);
  const geo = JSON.parse(decodeURIComponent(u.split("geojson=")[1]));
  eq(geo.type, "Polygon", "bare geometry");
  // Sending the Feature returns a task that finishes with error: true and
  // "is not valid under any of the given schemas" -- two polls later.
  eq("geometry" in geo, false, "not wrapped");
});

check("the task endpoint is built from the id", () => {
  eq(taskUrl("abc-123").endsWith("/tasks/abc-123"), true);
});

check("a finished task carries the population", () => {
  const out = parseTask({ status: "finished", error: false,
                          data: { total_population: 587132.58 } });
  eq(out.done, true, "done");
  eq(out.ok, true, "ok");
  eq(out.people, 587133, "rounded people");
});

check("FINISHED IS NOT SUCCEEDED — error is its own field", () => {
  const out = parseTask({ status: "finished", error: true,
                          error_message: "Invalid GeoJSON" });
  eq(out.done, true, "done");
  eq(out.ok, false, "must not report a failed task as an answer");
  eq(out.message, "Invalid GeoJSON", "carries the reason");
});

check("a task still running is not done", () => {
  eq(parseTask({ status: "created" }).done, false);
  eq(parseTask(null).done, false);
});

if (failures.length) process.exitCode = 1;
export const results = { passed, failures };
