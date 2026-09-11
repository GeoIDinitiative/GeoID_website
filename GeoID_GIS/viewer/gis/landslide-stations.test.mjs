/**
 * Sampling stations: a station must read exactly what the map under it reads,
 * the series must come out as one tidy table, and the plot's time axis must
 * land on dates. Run with `node landslide-stations.test.mjs`.
 */
import { readFileSync } from "node:fs";
import { staticStep } from "./landslide-pipeline.js";
import { upslopeWeights, stationStep, lowestCells, LANDSLIDE_PARAMS } from "./landslide-stations.js";
import {
  parseStationsCsv, stationsFromFeatures, uniqueName, seriesCsv, seriesFileName, makeStation, signedLon, colourAt, STATION_COLOURS,
} from "./station-series.js";
import { timeTicks, tickLabel, yRangeOf } from "./time-series-plot.js";
import { mfdTopology, fillSinks } from "./hydrology.js";
import { makeRaster } from "./raster-analysis.js";

let pass = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) pass += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
// The verdict in an exit hook, so a check appended below it still counts.
process.on("exit", () => {
  failures.forEach((f) => console.error(`  x ${f}`));
  console.log(`landslide-stations: ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});

const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(a), Math.abs(b));

/* ── a station reads what the map reads ─────────────────────────────────────── */

{
  // The pipeline's own V-valley, but held the way the page holds it: the ground
  // on an informing lattice of 4 × 4 blocks, with the rain and the material
  // varying block to block so the routing weights actually matter.
  const w = 40; const h = 41; const mid = 20; const n = w * h;
  const cellM = 1e-4 * 111320;
  const tan = Math.tan(20 * Math.PI / 180);
  const band = new Float32Array(n);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = 500 - 0.1 * cellM * x + tan * cellM * Math.abs(y - mid);
  const topo = mfdTopology(fillSinks(makeRaster(band, w, h, { minX: 0, maxX: w * 1e-4, minY: 0, maxY: h * 1e-4 }, NaN)));
  const bk = 4; const bw = Math.ceil(w / bk); const bh = Math.ceil(h / bk); const nb = bw * bh;
  const props = {
    K: new Float32Array(nb), zs: new Float32Array(nb), zf: new Float32Array(nb),
    c: new Float32Array(nb), phi: new Float32Array(nb), gamma: new Float32Array(nb),
  };
  for (let j = 0; j < nb; j += 1) {
    props.K[j] = 5e-5 + 1e-5 * (j % 7); props.zs[j] = 1.5 + 0.1 * (j % 5); props.zf[j] = Math.min(props.zs[j], 1.8);
    props.c[j] = 1 + (j % 3); props.phi[j] = 28 + (j % 4); props.gamma[j] = 19 + 0.2 * (j % 3);
  }
  const block = new Int32Array(n);
  const slopeRad = new Float32Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      block[i] = Math.floor(y / bk) * bw + Math.floor(x / bk);
      slopeRad[i] = y === mid ? Math.atan(0.1) : Math.atan(Math.hypot(tan, 0.1));
    }
  }
  const cells = { data: new Uint8Array(n).fill(1), model: new Uint8Array(n).fill(1), block, props, slopeRad };
  const stations = [(mid - 1) * w + 30, mid * w + 38, 1 * w + 30, (mid + 3) * w + 12, mid * w + 5];
  const maps = [
    Float32Array.from({ length: nb }, (_, j) => 10 + 3 * (j % 11)),
    Float32Array.from({ length: nb }, (_, j) => (j % 4 === 0 ? 0 : 60 + (j % 9) * 4)),
    new Float32Array(nb).fill(400),
  ];
  let worst = 0; let worstQ = 0; let worstW = 0;
  for (const infiltration of [true, false]) {
    for (const rainMm of maps) {
      const field = staticStep({ rainMm, windowH: 24, cells, topo, infiltration, lateral: 3 });
      for (const s of stations) {
        const one = stationStep({ cell: s, weights: upslopeWeights(topo, s), rainMm, windowH: 24, cells, topo, infiltration, lateral: 3 });
        worst = Math.max(worst, rel(one.fos, field.fos[s]));
        worstW = Math.max(worstW, rel(one.W, field.W[s]));
        worstQ = Math.max(worstQ, rel(one.qb * topo.contour / 86400, field.q[s]));
      }
    }
  }
  check("a station's flux is the routed flux the map uses, to rounding", worstQ < 1e-9, `worst ${worstQ}`);
  check("its water table is the map's", worstW < 1e-6, `worst ${worstW}`);
  check("and its factor of safety is the map's", worst < 1e-6, `worst ${worst}`);

  // The valley also falls east, so the only cell nothing drains into is the
  // top corner at the west end — the highest ground.
  const ridge = upslopeWeights(topo, 0);
  const outlet = upslopeWeights(topo, mid * w + (w - 1));
  check("the station's own cell carries all of its own water", outlet.w[[...outlet.idx].indexOf(mid * w + (w - 1))] === 1);
  check("the highest cell drains nothing but itself; the outlet drains the valley",
    ridge.idx.length === 1 && outlet.idx.length > n / 2, `${ridge.idx.length} / ${outlet.idx.length}`);
  check("no cell sends more than all of its water to one station", [...outlet.w].every((v) => v > 0 && v <= 1 + 1e-5));
  // (The flow fractions are Float32, so a cell's shares sum to 1 within ~1e-7.)

  const minFos = Float32Array.from({ length: n }, (_, i) => 1 + (i % 97) / 50);
  minFos[5] = 0.2; minFos[6] = 0.21; minFos[400] = 0.3; minFos[900] = 0.4;
  const low = lowestCells({ minFos, model: cells.model, width: w, count: 3, spacing: 4 });
  check("the weakest cells are chosen weakest first, and never two on one slope",
    low[0] === 5 && !low.includes(6) && low.includes(400) && low.length === 3, low.join());
  const next = lowestCells({ minFos, model: cells.model, width: w, count: 3, spacing: 4, taken: low });
  check("asking again gives the next weakest, clear of the stations already placed",
    next.length === 3 && next.every((i) => !low.includes(i) && i !== 6), next.join());
  check("the parameters a station records start with the factor of safety", LANDSLIDE_PARAMS[0].key === "fos"
    && LANDSLIDE_PARAMS.some((p) => p.key === "rain" && p.unit === "mm"));
}

/* ── stations in, a series out ──────────────────────────────────────────────── */

{
  const csv = 'Station;Latitude;Longitude\n"Borehole, north";44.20;11.70\nB2;;11.8\nB3;44.1;371.5\n';
  const got = parseStationsCsv(csv);
  check("a CSV reads by its header, whatever the delimiter, with quoted names",
    got.ok && got.stations.length === 2 && got.stations[0].name === "Borehole, north" && got.stations[0].lat === 44.2, JSON.stringify(got));
  check("a blank coordinate is dropped and counted, never read as zero", got.dropped === 1);
  check("a 0–360 longitude comes back signed", Math.abs(got.stations[1].lon - 11.5) < 1e-9 && signedLon(190) === -170);
  check("a file with no coordinate columns says what it wants", !parseStationsCsv("name,x_m,y_m\nA,1,2\n").ok);
  check("…and names them", /lat and lon/.test(parseStationsCsv("name,east,north\nA,1,2\n").message));
  const fromLayer = stationsFromFeatures([
    { type: "Feature", properties: { Name: "Gauge 7" }, geometry: { type: "Point", coordinates: [11.6, 44.2] } },
    { type: "Feature", properties: {}, geometry: { type: "MultiPoint", coordinates: [[11.7, 44.1], [11.8, 44.0]] } },
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
  ]);
  check("a layer's points become stations, named from the feature where it says, lines ignored",
    fromLayer.length === 3 && fromLayer[0].name === "Gauge 7" && fromLayer[1].name === "P2", fromLayer.map((s) => s.name).join());
  check("a second station of one name is told apart", uniqueName("S1", ["S1", "S1 (2)"]) === "S1 (3)" && uniqueName("S2", ["S1"]) === "S2");
  const a = makeStation({ lat: 44.2, lon: 11.7 }, 0); const b = makeStation({ name: "Toe", lat: 44.1, lon: 11.8 }, 1);
  check("every station has an id, a name and a colour of its own", a.id !== b.id && a.name === "S1" && a.colour !== b.colour
    && colourAt(STATION_COLOURS.length) === colourAt(0));
  const series = {
    model: "landslide-forecast", times: ["2026-09-10T12:00", "2026-09-10T18:00", "2026-09-11T00:00"],
    params: [{ key: "fos", label: "FoS", unit: "" }, { key: "rain", label: "Rain", unit: "mm" }],
    stations: [{ ...a, cell: 12, note: "" }, { ...b, cell: -1, note: "outside the study area" }],
    values: { [a.id]: { fos: [1.4, 0.93, 1.1], rain: [2, 26, 13] }, [b.id]: { fos: [NaN, NaN, NaN], rain: [NaN, NaN, NaN] } },
    constants: { [a.id]: { slope_deg: 31.2, material: "sand, silt" } },
  };
  const out = seriesCsv(series).trim().split("\n");
  check("one row per station per time, under one header", out.length === 1 + 2 * 3, String(out.length));
  check("the header carries the unit in the column's name and the station's ground",
    out[0] === "model,station,lat,lon,time,fos,rain_mm,slope_deg,material,note", out[0]);
  check("a reading is written as the number, a missing one empty",
    out[2] === "landslide-forecast,S1,44.2,11.7,2026-09-10T18:00,0.93,26,31.2,\"sand, silt\"," && out[4].split(",")[5] === "", out[2]);
  check("a station the model could not read keeps its rows and says why", /outside the study area$/.test(out[6]));
  check("the file is named for the model and the span", seriesFileName(series, "landslide-stations") === "landslide-forecast_landslide-stations_2026-09-10_2026-09-11.csv");
}

/* ── the time axis ───────────────────────────────────────────────────────────── */

{
  const t0 = Date.parse("2026-09-04T00:00Z"); const t1 = Date.parse("2026-09-18T00:00Z");
  const { step, ticks } = timeTicks(t0, t1, 6);
  check("fourteen days at six ticks steps by whole days and lands on midnights",
    step % 86400000 === 0 && ticks.length <= 8 && ticks.every((t) => t % 86400000 === 0), `${step} ${ticks.length}`);
  check("a day's ticks are labelled as dates", tickLabel(ticks[0], step) === new Date(ticks[0]).toISOString().slice(5, 10));
  const hours = timeTicks(t0, t0 + 18 * 3600000, 6);
  check("a short run steps in hours and says the hour", hours.step === 3 * 3600000 && tickLabel(t0 + 6 * 3600000, hours.step) === "06h"
    && tickLabel(t0, hours.step) === "09-04");
  const [lo, hi] = yRangeOf([{ values: [0.8, 1.2, 100] }], { floor: 0, clip: 3 });
  check("a factor of safety of 100 does not flatten the plot: the range is clipped", hi < 3.5 && lo >= 0 && lo < 0.8, `${lo} ${hi}`);
}

/* ── the wiring, pinned ─────────────────────────────────────────────────────── */

{
  const src = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  const player = readFileSync(new URL("./timelapse-player.js", import.meta.url), "utf8");
  check("the stations are recorded when a run finishes, and again when they change",
    /void recordStations\(\);\s*\n\s*\} catch \(error\)/.test(src) && /if \(state\.run\) void recordStations\(\)/.test(src));
  check("a station reads the model through stationStep over its own catchment", /stationStep\(\{ cell, weights: g\.stationWeights\.get\(cell\)/.test(src));
  check("a station's catchment is traced once per ground, not per run", /g\.stationWeights = g\.stationWeights \|\| new Map\(\)/.test(src));
  check("the stations' own layer is not offered back as a source of stations", /l\.name !== STATION_LAYER/.test(src));
  check("a placing click is swallowed before it opens a card", /if \(Date\.now\(\) < swallowUntil\) return true;/.test(src)
    && /GeoIDFeaturePopup\?\.suppress\?\.\(800\)/.test(src));
  check("placing listens on pointerup with a drag gate, never stopping the event", /pointerup", onUp\)/.test(src) && !/stopPropagation\(\);\s*\n\s*const at = window\.GeoIDViewer\?\.surfaceLatLonAt/.test(src));
  check("a popped-out plot is moved onto the page, not positioned inside the sidebar",
    /const want = pl\.floating \? document\.body : host;/.test(src));
  check("the plot moves the bar through the player, so the two cannot disagree", /seekPlayer\(k\)/.test(src) && /export function seekPlayer\(index\)/.test(player));
  check("playing the bar updates the readings without rebuilding the name fields",
    /paintView\(run\.current\);\s*\n(\s*paintRain\(k\);\s*\n)?\s*updateReadings\(\);/.test(src));
  check("the export is one tidy CSV through the page's own download, filed in the project", /downloadText\(name, seriesCsv\(rec\), "text\/csv"\)/.test(src));
  check("a recorded series is announced for what reads it next", /geoid-gis:station-series/.test(src));
  check("the map and a station share one cellAnswer", /export \{ cellAnswer \};/.test(src)
    && /import \{ cellAnswer, planeWetness, slopeStresses \} from "\.\/slope-hydrology\.js/.test(readFileSync(new URL("./landslide-stations.js", import.meta.url), "utf8")));
}

/* ── the record and the forecast, told apart ─────────────────────────────── */

{
  const { periodOf } = await import("./landslide-pipeline.js");
  const now = Date.parse("2026-09-11T09:30Z");
  check("a map whose window has ended is the record; one reaching past now is a forecast",
    periodOf("2026-09-11T06:00", now) === "record" && periodOf("2026-09-11T12:00", now) === "forecast"
    && periodOf("2026-09-10", now) === "record" && periodOf("2026-09-12", now) === "forecast");
  const csv = seriesCsv({
    model: "m", times: ["2026-09-10T12:00", "2026-09-11T12:00"], periods: ["record", "forecast"], sources: ["IMERG", "GFS"],
    params: [{ key: "fos", label: "FoS", unit: "" }], stations: [{ id: "a", name: "A", lat: 1, lon: 2 }], values: { a: { fos: [1.2, 0.9] } },
  }).trim().split("\n");
  check("the export says which rows are the record and which the forecast, and from what",
    csv[0] === "model,station,lat,lon,time,period,source,fos,note" && csv[2] === "m,A,1,2,2026-09-11T12:00,forecast,GFS,0.9,", csv.join(" | "));
  const src = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  check("the rainfall opens on the week before today and the week after, on Auto",
    /id="lsp-rain-start" class="input" type="date" value="\$\{isoDay\(now - 7 \* 86400000\)\}"/.test(src)
    && /id="lsp-rain-end" class="input" type="date" value="\$\{isoDay\(now \+ 7 \* 86400000\)\}"/.test(src)
    && /<option value="auto" selected>/.test(src) && /id="lsp-rain-around"/.test(src));
  check("every frame on the bar says whether it is the record or the forecast", /label: `\$\{f\.label \|\| f\.time\.replace\("T", " "\)\} · \$\{periodOf\(f\.time\)\}`/.test(src));
  check("the plot marks now between the record and the forecast", /now: Date\.now\(\)/.test(src)
    && /fillText\("forecast"/.test(readFileSync(new URL("./time-series-plot.js", import.meta.url), "utf8")));
}

/* ── the rainfall maps as a layer ─────────────────────────────────────────── */

{
  const { rainLattice, RAIN_CLASSES, RAIN_LAYER } = await import("./landslide-pipeline.js");
  const lat = rainLattice({ west: 11.4, east: 12.1, south: 43.95, north: 44.4 });
  check("the rain is drawn on about a kilometre a cell over the fetched area, at most 256 across",
    lat.width <= 256 && lat.height <= 256 && lat.cellKm >= 0.5 && lat.cellKm < 1 && lat.lat.length === lat.width * lat.height
    && lat.lat[0] < 44.4 && lat.lon[lat.width - 1] < 12.1, `${lat.width}×${lat.height} at ${lat.cellKm}`);
  check("dry ground is left undrawn and every wetter class has a colour", RAIN_CLASSES[0].colour === null
    && RAIN_CLASSES.slice(1).every((c) => Array.isArray(c.colour)) && RAIN_CLASSES.at(-1).max === Infinity);
  const src = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  check("a fetch puts the maps in the Workspace and the bar plays them", /if \(showRainLayer\(\)\) void playRain\(\);/.test(src)
    && /addDerivedLayer\?\.\(RAIN_LAYER, built, "rain"\)/.test(src) && /setOpacity\?\.\(layer, 0\.55\)/.test(src));
  check("the layer steps with the model's frames once it has run", /paintView\(run\.current\);\s*\n\s*paintRain\(k\);/.test(src));
  check("the model and the layer read the rain through one function", /return rainAtPoints\(frame, state\.ground\.cells\.props\);/.test(src)
    && /rl\.band\.set\(rainAtPoints\(frame, rl\.pts\)\)/.test(src));
  check("a new fetch, a new area and a clear take the old maps off the globe", (src.match(/removeRainLayer\(\);/g) || []).length >= 3);
  check("the layer is named for what it is", /Rainfall maps/.test(RAIN_LAYER));
}


/* ── every term of the answer, at a station ────────────────────────────────── */

{
  const { slopeStresses, factorOfSafety, WATER_UNIT_WEIGHT } = await import("./slope-hydrology.js");
  const { LANDSLIDE_PLOTS } = await import("./landslide-stations.js");
  const { markOffset, declutter } = await import("./station-markers.js");
  const args = { slopeRad: 0.5, c: 4, phi: 30, gamma: 19, zf: 1.8, m: 0.6 };
  const st = slopeStresses(args);
  const cos = Math.cos(0.5);
  check("the factor of safety is its strength over its driving stress, and the same number as before",
    Math.abs(st.fos - st.resisting / st.driving) < 1e-12 && st.fos === factorOfSafety(args));
  check("pore pressure and effective stress sum to the column's weight normal to the plane",
    Math.abs(st.pore + st.effective - 19 * 1.8 * cos * cos) < 1e-9 && Math.abs(st.pore - 0.6 * WATER_UNIT_WEIGHT * 1.8 * cos * cos) < 1e-9);
  check("flat ground still reads as the capped, stable ratio", slopeStresses({ ...args, slopeRad: 0 }).fos === 100);

  // A station on the pipeline's own hillslope, every new term against its definition.
  const w = 20; const h = 21; const n = w * h; const cellM = 1e-4 * 111320; const tan = Math.tan(25 * Math.PI / 180);
  const band = new Float32Array(n);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) band[y * w + x] = 300 - 0.1 * cellM * x + tan * cellM * Math.abs(y - 10);
  const topo = mfdTopology(fillSinks(makeRaster(band, w, h, { minX: 0, maxX: w * 1e-4, minY: 0, maxY: h * 1e-4 }, NaN)));
  const cells = {
    data: new Uint8Array(n).fill(1), model: new Uint8Array(n).fill(1), K: new Float32Array(n).fill(2e-5), zs: new Float32Array(n).fill(2),
    zf: new Float32Array(n).fill(1.5), slopeRad: new Float32Array(n).fill(Math.atan(tan)), c: new Float32Array(n).fill(3), phi: new Float32Array(n).fill(32), gamma: new Float32Array(n).fill(19),
  };
  const rainMm = Float32Array.from({ length: n }, (_, i) => 10 + (i % 17));
  const cell = 9 * w + 15;
  const out = stationStep({ cell, weights: upslopeWeights(topo, cell), rainMm, windowH: 24, cells, topo, lateral: 2 });
  check("depth to the water table is the column less the table", Math.abs(out.depth - (2 - out.h)) < 1e-9 && out.depth >= 0);
  check("the catchment's rain is a flow-weighted mean — inside the range of the rain that fell on it",
    out.catchRain >= 10 && out.catchRain <= 26 && Number.isFinite(out.catchRain));
  check("the station's strength and stress give its factor of safety", Math.abs(Math.min(100, out.strength / out.stress) - out.fos) < 1e-9);
  check("every recorded variable is one a plot can draw, and strength is drawn against stress",
    LANDSLIDE_PARAMS.every((p) => Number.isFinite(out[p.key])) && LANDSLIDE_PLOTS.some((p) => p.series.length === 2 && p.series[1].dash));

  check("a ▼'s tip sits on its point: the mark is placed by its bottom centre", JSON.stringify(markOffset(40, 30)) === '{"dx":-20,"dy":-30}');
  const kept = declutter([{ left: 0, right: 50, top: 0, bottom: 12 }, { left: 30, right: 80, top: 4, bottom: 16 }, { left: 100, right: 140, top: 0, bottom: 12 }, null]);
  check("a name that would overlap an earlier one is muted, the others kept", kept.join() === "true,false,true,false");

  const src = readFileSync(new URL("./landslide-pipeline.js", import.meta.url), "utf8");
  check("the stations' layer draws no dots and no engine labels: the ▼ markers are the stations on the globe",
    !/label_rank: 5/.test(src) && /layer\.groundPick = false;/.test(src) && /mountStationMarkers\(\{/.test(src));
  check("a marker's click opens the station's card with every variable", /onPick: \(st\) => openStationCard\(st\)/.test(src)
    && /for \(const p of LANDSLIDE_PARAMS\) rows\.push/.test(src));
  check("the card opens on two plots, factor of safety and rain, and more can be added and popped out",
    /state\.plots = \[newPlot\("fos"\), newPlot\("rain"\)\];/.test(src) && /id="lsp-plot-add"/.test(src) && /data-act="float"/.test(src));
}

{
  const mk = readFileSync(new URL("./station-markers.js", import.meta.url), "utf8");
  check("the markers sit over the globe and under every panel", /\.gst-host \{[^}]*z-index: 5;/.test(mk));
}
