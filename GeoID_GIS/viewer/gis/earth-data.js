/**
 * Three open services, each answering a question the globe could not.
 *
 * `connectors.js` already pulls EVENT feeds — things that happened, as points.
 * These are the other kind: you have a place, or an area, and you want to know
 * something about it that no layer on the globe carries.
 *
 *   SoilGrids   what the ground is made of, here
 *   FDSN        what the ground DID, here, at that moment
 *   WorldPop    how many people are in the area you drew
 *
 * Every function that builds a URL or reads a response is pure and tested;
 * the only impure things are the three `fetch` wrappers at the bottom. That
 * split is the same one `connectors.js` uses and it is what makes a service's
 * quirks — SoilGrids' integer scaling, WorldPop's two-step task API — testable
 * without a network.
 *
 * ALL THREE ANSWER WITH `Access-Control-Allow-Origin: *`, verified before a
 * line of this was written, because a browser-only app cannot use a service
 * that does not. Two near-misses worth recording so nobody spends the
 * afternoon again:
 *
 * - **EarthScope/IRIS does not.** `service.iris.edu` 307s to
 *   `service.earthscope.org` and neither sends the header, so the largest
 *   seismic archive in the world is unreachable from a page. GEOFON and
 *   ORFEUS both do send it, which is why they are the nodes here.
 * - **GHSL has no browser-reachable global service.** The population question
 *   is answered by WorldPop instead, which is a better fit anyway: it returns
 *   the number of people in a polygon rather than a picture to look at, and
 *   the polygon is the study area somebody already drew.
 */

/* ── SoilGrids (ISRIC) ────────────────────────────────────────────────────── */

export const SOILGRIDS = {
  id: "soilgrids",
  name: "SoilGrids 250 m (ISRIC)",
  endpoint: "https://rest.isric.org/soilgrids/v2.0/properties/query",
  licence: "ISRIC SoilGrids — CC BY 4.0",
  attribution: "Poggio et al. (2021), SoilGrids 2.0, ISRIC — World Soil Information",
};

/**
 * The properties worth asking for, and what each is FOR here.
 *
 * Not the whole catalogue: SoilGrids serves a dozen properties at six depths
 * with five statistics each, and asking for all of it is a slow request whose
 * answer nobody reads. These five are the ones the slope-stability model
 * actually consumes — texture decides friction angle and cohesion, bulk
 * density is the unit weight the infinite-slope equation divides by, and
 * organic carbon flags the peat that makes a hillside behave unlike its map
 * unit.
 */
export const SOIL_PROPERTIES = {
  clay: { label: "Clay", unit: "%", factor: 10 },
  sand: { label: "Sand", unit: "%", factor: 10 },
  silt: { label: "Silt", unit: "%", factor: 10 },
  bdod: { label: "Bulk density", unit: "kg/dm³", factor: 100 },
  soc: { label: "Organic carbon", unit: "g/kg", factor: 10 },
};

export const SOIL_DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm"];

export function soilUrl(lat, lon, {
  properties = Object.keys(SOIL_PROPERTIES),
  depths = ["0-5cm", "5-15cm"],
} = {}) {
  const q = new URLSearchParams();
  q.set("lon", Number(lon).toFixed(5));
  q.set("lat", Number(lat).toFixed(5));
  properties.forEach((p) => q.append("property", p));
  depths.forEach((d) => q.append("depth", d));
  q.append("value", "mean");
  return `${SOILGRIDS.endpoint}?${q}`;
}

/**
 * SoilGrids returns INTEGERS, and the divisor is in the response.
 *
 * Clay comes back as 212 and means 21.2%; bulk density as 95 and means
 * 0.95 kg/dm³. The factor is `unit_measure.d_factor` on each layer, and using
 * a remembered constant instead is how a soil map ends up an order of
 * magnitude out with every number still looking plausible. Read it from the
 * response, every time.
 */
export function parseSoil(json) {
  const layers = json?.properties?.layers;
  if (!Array.isArray(layers) || !layers.length) {
    return { ok: false, message: "SoilGrids returned no layers for this point" };
  }
  const rows = [];
  layers.forEach((layer) => {
    const factor = Number(layer?.unit_measure?.d_factor) || 1;
    const meta = SOIL_PROPERTIES[layer.name] || {};
    (layer.depths || []).forEach((depth) => {
      const raw = depth?.values?.mean;
      rows.push({
        property: layer.name,
        label: meta.label || layer.name,
        depth: depth.label,
        // null rather than 0 where the model has no answer -- ocean, ice, and
        // the rock outcrops that matter most to a slope model all come back
        // empty, and a zero there would be read as "no clay" rather than as
        // "not mapped".
        value: raw == null ? null : raw / factor,
        unit: meta.unit || layer?.unit_measure?.target_units || "",
      });
    });
  });
  const mapped = rows.filter((r) => r.value != null);
  return {
    ok: Boolean(mapped.length),
    rows,
    mapped: mapped.length,
    message: mapped.length
      ? `${mapped.length} of ${rows.length} values mapped here`
      : "SoilGrids does not map this point — ocean, ice or bare rock",
  };
}

/**
 * Texture to the two numbers the slope model needs.
 *
 * Screening values from standard engineering-geology ranges, interpolated by
 * clay fraction, and they are a STARTING POINT rather than site investigation
 * — the same standing as the lithology table in `fos.js`, and said as plainly.
 * What this changes is where the numbers come from: a per-pixel measurement of
 * this hillside instead of one value for every polygon sharing a rock name.
 */
export function strengthFromTexture(clayPercent, sandPercent) {
  if (!Number.isFinite(clayPercent)) return null;
  const clay = Math.max(0, Math.min(100, clayPercent));
  // Friction angle falls with clay: ~36 degrees in clean sand, ~22 in a heavy
  // clay. Linear between, which is as much as a screening model can justify.
  const phi = 36 - 0.14 * clay;
  // Effective cohesion rises with clay, and stays small: a few kPa is what
  // shallow soil actually holds, and generous cohesion is what makes an
  // infinite-slope model declare everything safe.
  const cohesion = Math.min(8, 0.08 * clay);
  return {
    frictionDeg: Number(phi.toFixed(1)),
    cohesionKpa: Number(cohesion.toFixed(2)),
    basis: `clay ${clay.toFixed(1)}%`
      + (Number.isFinite(sandPercent) ? `, sand ${sandPercent.toFixed(1)}%` : ""),
    screening: true,
  };
}

/* ── FDSN (seismic waveforms) ─────────────────────────────────────────────── */

/**
 * The nodes, and why these two.
 *
 * FDSN is a standard, not a server: a hundred archives answer the same three
 * paths. What is not standard is whether they let a browser in. Verified:
 * GEOFON and ORFEUS send `Access-Control-Allow-Origin: *`; EarthScope (which
 * `service.iris.edu` now redirects to) does not, and so cannot be used from a
 * page at all however much data it holds.
 */
export const FDSN_NODES = [
  {
    id: "geofon",
    name: "GEOFON (GFZ Potsdam)",
    base: "https://geofon.gfz-potsdam.de/fdsnws",
    note: "GE global network and European partners",
    licence: "GEOFON data are open; cite the network DOI",
  },
  {
    id: "orfeus",
    name: "ORFEUS (EIDA)",
    base: "https://www.orfeus-eu.org/fdsnws",
    note: "European regional and temporary networks",
    licence: "per-network; most are CC BY 4.0",
  },
];

const iso = (t) => (t instanceof Date ? t : new Date(t)).toISOString().replace(/\.\d+Z$/, "");

/**
 * Stations within a radius of a point — the "what recorded this?" question.
 *
 * `start`/`end` are the answer to a trap that costs a whole fetch: a station
 * service asked without a window returns every instrument that has EVER been
 * at that place. Around the 2023 Kahramanmaras epicentre the nearest four are
 * an aftershock deployment installed days AFTER the earthquake — real
 * stations, correctly returned, holding nothing for the moment being asked
 * about, and the request that follows comes back 204 with no hint why. Passing
 * the window makes the service drop them.
 */
export function stationUrl(base, {
  lat, lon, radiusDeg = 2, channel = "?HZ", level = "channel", start, end,
}) {
  const q = new URLSearchParams({
    latitude: Number(lat).toFixed(4),
    longitude: Number(lon).toFixed(4),
    maxradius: String(radiusDeg),
    channel,
    level,
    format: "text",
  });
  // Only when asked: without a window the question is "what is there", which
  // is the right question when nobody has named a moment.
  if (start) q.set("starttime", iso(start));
  if (end) q.set("endtime", iso(end));
  return `${base}/station/1/query?${q}`;
}

/** Waveforms for one channel over one window. */
export function waveformUrl(base, { net, sta, loc = "", cha, start, end }) {
  const q = new URLSearchParams({
    net, sta, cha, start: iso(start), end: iso(end),
  });
  // An empty location is "--" to FDSN, and omitting it means "any", which
  // quietly returns several co-located sensors stitched into one request.
  q.set("loc", loc === "" ? "--" : loc);
  return `${base}/dataselect/1/query?${q}`;
}

/** FDSN's pipe-delimited text: a header line starting `#`, then rows. */
export function parseStationText(text) {
  // `Number("")` is 0, not NaN, so a row with a blank latitude would come back
  // as a perfectly finite station at 0N 0E -- in the Gulf of Guinea, on the
  // map, clickable. Blank has to become NaN before the filter can see it.
  const num = (v) => (String(v ?? "").trim() === "" ? NaN : Number(v));
  const lines = String(text || "").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  return lines.map((line) => {
    const f = line.split("|");
    return {
      network: f[0], station: f[1], location: f[2] || "", channel: f[3],
      lat: num(f[4]), lon: num(f[5]), elevation: num(f[6]),
      sampleRate: num(f[14]),
      startTime: f[15], endTime: f[16],
      id: `${f[0]}.${f[1]}.${f[2] || ""}.${f[3]}`,
    };
  }).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

/* ── WorldPop (people in an area) ─────────────────────────────────────────── */

export const WORLDPOP = {
  id: "worldpop",
  name: "WorldPop 100 m population",
  endpoint: "https://api.worldpop.org/v1",
  licence: "WorldPop — CC BY 4.0",
  attribution: "WorldPop (www.worldpop.org), University of Southampton",
};

/**
 * WorldPop takes a bare GEOMETRY, not a Feature.
 *
 * Handing it a `{type: "Feature"}` returns a task that finishes with
 * `error: true` and "is not valid under any of the given schemas" -- a 200,
 * a task id, and a failure two polls later. Unwrapping here means a caller can
 * pass whatever the draw tool produced.
 */
export function populationUrl(geometry, { dataset = "wpgppop", year = 2020 } = {}) {
  const geom = geometry?.type === "Feature" ? geometry.geometry : geometry;
  const q = new URLSearchParams({
    dataset, year: String(year), geojson: JSON.stringify(geom),
  });
  return `${WORLDPOP.endpoint}/services/stats?${q}`;
}

export const taskUrl = (taskId) => `${WORLDPOP.endpoint}/tasks/${taskId}`;

/** A finished task is not a successful one: `error` is a separate field. */
export function parseTask(json) {
  if (!json) return { done: false };
  if (json.status !== "finished") return { done: false, status: json.status };
  if (json.error) return { done: true, ok: false, message: json.error_message || "task failed" };
  const total = json?.data?.total_population;
  return {
    done: true,
    ok: Number.isFinite(total),
    people: Number.isFinite(total) ? Math.round(total) : null,
    message: Number.isFinite(total)
      ? `${Math.round(total).toLocaleString()} people`
      : "the task finished without a population",
  };
}

/* ── the impure edge ──────────────────────────────────────────────────────── */

async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** What the ground is made of, at a point. */
export async function fetchSoil(lat, lon, options = {}) {
  try {
    return parseSoil(await getJson(soilUrl(lat, lon, options), options.signal));
  } catch (error) {
    return { ok: false, message: `SoilGrids did not answer: ${error.message}` };
  }
}

/** Which instruments are near a point, at the node given. */
export async function fetchStations(node, query) {
  const base = (FDSN_NODES.find((n) => n.id === node) || FDSN_NODES[0]).base;
  try {
    const response = await fetch(stationUrl(base, query));
    // 204 is FDSN for "nothing matched", which is an answer rather than a
    // failure -- an empty radius around a mid-ocean epicentre is normal.
    if (response.status === 204) return { ok: true, stations: [], message: "no stations in range" };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const stations = parseStationText(await response.text());
    return { ok: true, stations, message: `${stations.length} channels` };
  } catch (error) {
    return { ok: false, stations: [], message: `station service: ${error.message}` };
  }
}

/**
 * The waveform itself, decoded.
 *
 * Imported lazily because `mseed.js` is only wanted by whoever asks for a
 * trace, and most sessions never do.
 */
export async function fetchWaveform(node, query) {
  const base = (FDSN_NODES.find((n) => n.id === node) || FDSN_NODES[0]).base;
  try {
    const response = await fetch(waveformUrl(base, query));
    if (response.status === 204) {
      return { ok: false, message: "the archive holds nothing for that channel and window" };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return { ok: false, message: "empty response" };
    const { readStream } = await import(`./mseed.js${new URL(import.meta.url).search}`);
    const out = readStream(buffer);
    return {
      ok: Boolean(out.traces.length),
      ...out,
      message: out.traces.length
        ? `${out.traces.length} trace(s), ${out.records} records`
          + (out.problems.length ? `, ${out.problems.length} dropped` : "")
        : "no readable records",
    };
  } catch (error) {
    return { ok: false, message: `dataselect: ${error.message}` };
  }
}

/**
 * People inside a polygon.
 *
 * Two steps, because the service is: a request returns a task id, and the
 * answer arrives at a second endpoint some seconds later. Polling is bounded
 * -- a task that has not finished in half a minute is not going to, and a
 * page that polls for ever is worse than one that gives up and says so.
 */
export async function fetchPopulation(geometry, options = {}) {
  const { tries = 12, waitMs = 2500 } = options;
  try {
    const started = await getJson(populationUrl(geometry, options));
    if (!started?.taskid) return { ok: false, message: "WorldPop returned no task" };
    for (let i = 0; i < tries; i += 1) {
      await new Promise((r) => { setTimeout(r, waitMs); });
      const state = parseTask(await getJson(taskUrl(started.taskid)));
      if (state.done) return state;
    }
    return { ok: false, message: `WorldPop is still working after ${(tries * waitMs) / 1000}s` };
  } catch (error) {
    return { ok: false, message: `WorldPop: ${error.message}` };
  }
}
