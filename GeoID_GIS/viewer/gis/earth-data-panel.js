/**
 * Data · Earth systems: the three services, wired to the place you are looking
 * at.
 *
 * `earth-data.js` is the pure half — URLs in, parsed answers out, tested
 * without a network. This is the half that knows where "here" is, what to do
 * with an answer, and how to say when a service declines to have one.
 *
 * Each of the three takes its place from something the app already knows
 * rather than asking for coordinates:
 *
 *   Soil        the sub-camera point, which is what the readout calls Center
 *   Seismograms the same point, for the station search
 *   Population  the STUDY AREA, because people are counted in an area and
 *               there is no honest way to answer it for a point
 *
 * The waveform does not stop at a plot. It is written into the open project as
 * `post_processing/extracted_dofs/<channel>.csv`, which is the folder the
 * Signal Processing and Spectral pages already list through `findTables` — so
 * a trace fetched here appears in the analysis pages without a second step,
 * and the DSP that was written for FEM probe output works on a seismogram
 * because both are a column of numbers against time.
 */

import {
  fetchSoil, strengthFromTexture,
  fetchStations, fetchWaveform, FDSN_NODES,
  fetchPopulation, SOILGRIDS, WORLDPOP,
} from "./earth-data.js?v=20260823-feb0f36";

const byId = (id) => document.getElementById(id);

function say(id, html) {
  const node = byId(id);
  if (node) node.innerHTML = html;
}

/**
 * Where "here" is.
 *
 * The sub-camera point, not a raycast through the middle pixel: the globe does
 * not sit at the centre of the canvas -- the panels take the left of it -- so
 * that ray misses and returns nothing at the default view. The same trap the
 * draw box hit, and the viewer already answers it.
 */
function viewCentre() {
  const c = window.GeoIDViewer?.getViewCentreLatLon?.();
  if (!c || !Number.isFinite(c.lat)) return null;
  // The viewer carries east-positive 0-360; every service here wants signed.
  const lon = c.lon > 180 ? c.lon - 360 : c.lon;
  return { lat: c.lat, lon };
}

const place = (p) => `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;

/* ── soil ─────────────────────────────────────────────────────────────────── */

async function runSoil() {
  const p = viewCentre();
  if (!p) return say("earthdata-soil-out", "Point the globe at somewhere first.");
  say("earthdata-soil-out", `Asking SoilGrids about ${place(p)}…`);
  const out = await fetchSoil(p.lat, p.lon);
  if (!out.ok) return say("earthdata-soil-out", `${out.message}`);

  const rows = out.rows.filter((r) => r.value != null)
    .map((r) => `<div>${r.label} <span style="opacity:0.6">${r.depth}</span> — `
      + `<strong>${r.value.toFixed(r.unit === "kg/dm³" ? 2 : 1)}</strong> ${r.unit}</div>`)
    .join("");

  const clay = out.rows.find((r) => r.property === "clay" && r.value != null);
  const sand = out.rows.find((r) => r.property === "sand" && r.value != null);
  const soc = out.rows.find((r) => r.property === "soc" && r.value != null);
  const strength = clay ? strengthFromTexture(clay.value, sand?.value) : null;

  /**
   * Peat is called out, because it is the case the lithology table cannot see.
   *
   * `fos.js` takes strength from the mapped rock type, and a blanket bog over
   * schist is filed as schist -- measured on a Sperrins hillside, 285 g/kg
   * organic carbon under a bedrock unit that says nothing about it. Above
   * roughly 120 g/kg the material behaving on the slope is organic soil, not
   * the rock beneath it, and any screening parameter from the map unit is
   * describing the wrong material.
   */
  const peat = soc && soc.value > 120
    ? `<div style="margin-top:0.35rem;color:#f0b542;">Organic carbon ${soc.value.toFixed(0)} g/kg `
      + "— this is peat. The mapped bedrock unit is not the material on the slope, "
      + "so strength from a lithology table describes the wrong thing here.</div>"
    : "";

  say("earthdata-soil-out",
    `<div style="opacity:0.7;margin-bottom:0.3rem;">${place(p)} — ${out.message}</div>${rows}`
    + (strength
      ? `<div style="margin-top:0.4rem;">Screening strength from texture: `
        + `<strong>φ′ ${strength.frictionDeg}°</strong>, `
        + `<strong>c′ ${strength.cohesionKpa} kPa</strong> `
        + `<span style="opacity:0.6">(${strength.basis})</span></div>`
      : "")
    + peat
    + `<div style="margin-top:0.4rem;opacity:0.6;">${SOILGRIDS.attribution} — ${SOILGRIDS.licence}</div>`);
}

/* ── seismograms ──────────────────────────────────────────────────────────── */

function fillNodes() {
  const select = byId("earthdata-node");
  if (!select || select.options.length) return;
  FDSN_NODES.forEach((node) => {
    const option = document.createElement("option");
    option.value = node.id;
    option.textContent = node.name;
    option.title = node.note;
    select.appendChild(option);
  });
}

async function runStations() {
  const p = viewCentre();
  if (!p) return say("earthdata-seis-out", "Point the globe at somewhere first.");
  const node = byId("earthdata-node")?.value || FDSN_NODES[0].id;
  say("earthdata-seis-out", `Looking for instruments within 2° of ${place(p)}…`);
  // Vertical broadband and short-period channels: the ones an earthquake is
  // read from. Asking for every channel returns barometers and tiltmeters too,
  // which is a longer list and not what the button offers.
  const out = await fetchStations(node, { lat: p.lat, lon: p.lon, radiusDeg: 2, channel: "?HZ" });
  const select = byId("earthdata-channel");
  if (select) {
    select.innerHTML = "";
    out.stations.forEach((s) => {
      const option = document.createElement("option");
      option.value = JSON.stringify({
        net: s.network, sta: s.station, loc: s.location, cha: s.channel,
      });
      option.textContent = `${s.id} · ${s.sampleRate || "?"} Hz`;
      option.title = `${s.startTime?.slice(0, 10)} to ${s.endTime?.slice(0, 10) || "open"}`;
      select.appendChild(option);
    });
  }
  say("earthdata-seis-out", out.ok
    ? `${out.message} near ${place(p)}. Pick one, set a window, and fetch.`
    : out.message);
}

async function runWaveform() {
  const raw = byId("earthdata-channel")?.value;
  if (!raw) return say("earthdata-seis-out", "Find stations first, then pick a channel.");
  const query = JSON.parse(raw);
  const node = byId("earthdata-node")?.value || FDSN_NODES[0].id;
  const startField = byId("earthdata-start")?.value;
  if (!startField) return say("earthdata-seis-out", "Set a window start — UTC.");
  const minutes = Math.max(1, Math.min(60, Number(byId("earthdata-minutes")?.value) || 5));
  // The field is naive local time in the browser's zone; FDSN wants UTC, and a
  // trace an hour off is a trace of the wrong thing.
  const start = new Date(`${startField}:00Z`);
  const end = new Date(start.getTime() + minutes * 60000);

  say("earthdata-seis-out", `Fetching ${query.net}.${query.sta}.${query.cha}…`);
  const out = await fetchWaveform(node, { ...query, start, end });
  if (!out.ok) return say("earthdata-seis-out", out.message);
  const trace = out.traces[0];

  let peak = 0;
  let sum = 0;
  for (let i = 0; i < trace.values.length; i += 1) {
    const v = trace.values[i];
    sum += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const rms = Math.sqrt(sum / (trace.values.length || 1));

  /**
   * Straight into the project, as a series the analysis pages already read.
   *
   * `post_processing/extracted_dofs/` is where the FEM loop puts probe time
   * series, and `findTables` lists that folder for the Signal and Spectral
   * pages. A seismogram is the same shape -- a column of numbers against time
   * -- so writing it there means the DSP written for a solver's output works
   * on a real earthquake with nothing added.
   */
  let saved = "";
  try {
    const bridge = window.GeoIDResearch?.bridge;
    if (bridge?.saveProcessed) {
      const name = `${trace.id.replace(/\./g, "_")}_${start.toISOString().slice(0, 19)
        .replace(/[:T]/g, "")}.csv`;
      const lines = ["t,counts"];
      for (let i = 0; i < trace.values.length; i += 1) {
        lines.push(`${(i / trace.sampleRate).toFixed(4)},${trace.values[i]}`);
      }
      await bridge.saveProcessed(`post_processing/extracted_dofs/${name}`,
        lines.join("\n"), {
          mime: "text/csv",
          provenance: { tool: "fdsn", inputs: [trace.id], kind: "waveform" },
        });
      saved = `<div style="margin-top:0.35rem;">Saved to the project as `
        + `<code>${name}</code> — the Signal pages will list it.</div>`;
    }
  } catch (error) {
    saved = `<div style="margin-top:0.35rem;opacity:0.7;">Not saved to a project: `
      + `${error.message}</div>`;
  }

  say("earthdata-seis-out",
    `<div><strong>${trace.id}</strong> — ${trace.values.length.toLocaleString()} samples `
    + `at ${trace.sampleRate} Hz, ${trace.durationS.toFixed(1)} s</div>`
    + `<div>peak ${Math.round(peak).toLocaleString()} counts, `
    + `RMS ${Math.round(rms).toLocaleString()}</div>`
    + `<div style="opacity:0.7;">${out.message}</div>`
    // Dropped records are never silent: a gap in a seismogram changes what the
    // spectrum means, and "13 records" with three of them missing is a
    // different trace from the one the header describes.
    + (out.problems.length
      ? `<div style="color:#f0b542;">${out.problems.length} record(s) failed their `
        + `integrity check and were dropped.</div>`
      : "")
    + saved);
}

/* ── population ───────────────────────────────────────────────────────────── */

async function runPopulation() {
  const geometry = window.GeoIDViewer?.getExtractionGeometry?.()
    || window.GeoIDResearch?.bridge?.studyAreaGeometry?.();
  const ring = geometry?.vertices || geometry?.coordinates?.[0];
  if (!ring || ring.length < 4) {
    return say("earthdata-pop-out",
      "Draw a study area first — people are counted in an area, and there is no "
      + "honest way to answer this for a point.");
  }
  // The viewer's own geometry is {lat, lon} vertices in its 0-360 convention;
  // GeoJSON is [lon, lat] signed.
  const coords = ring.map((v) => {
    const lat = Array.isArray(v) ? v[1] : v.lat;
    let lon = Array.isArray(v) ? v[0] : v.lon;
    if (lon > 180) lon -= 360;
    return [Number(lon.toFixed(5)), Number(lat.toFixed(5))];
  });
  if (coords[0][0] !== coords[coords.length - 1][0]
      || coords[0][1] !== coords[coords.length - 1][1]) coords.push(coords[0]);

  say("earthdata-pop-out", "WorldPop is counting — this takes a few seconds…");
  const out = await fetchPopulation({ type: "Polygon", coordinates: [coords] });
  say("earthdata-pop-out", out.ok
    ? `<div><strong>${out.people.toLocaleString()}</strong> people in the study area</div>`
      + `<div style="opacity:0.6;margin-top:0.3rem;">${WORLDPOP.name} (2020) — `
      + `${WORLDPOP.licence}</div>`
    : out.message);
}

/* ── wiring ───────────────────────────────────────────────────────────────── */

function init() {
  if (!byId("gis-group-earthdata")) return;
  fillNodes();
  byId("earthdata-soil")?.addEventListener("click", () => { void runSoil(); });
  byId("earthdata-stations")?.addEventListener("click", () => { void runStations(); });
  byId("earthdata-waveform")?.addEventListener("click", () => { void runWaveform(); });
  byId("earthdata-population")?.addEventListener("click", () => { void runPopulation(); });
  // A window nobody has to invent: the 2023 Kahramanmaras M7.8, which every
  // broadband station on the planet recorded. An empty datetime field is a
  // question with no obvious answer, and the point of the panel is to show
  // that this works.
  const start = byId("earthdata-start");
  if (start && !start.value) start.value = "2023-02-06T01:18";
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

export { init, runSoil, runStations, runWaveform, runPopulation };
