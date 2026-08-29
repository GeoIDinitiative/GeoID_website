/**
 * Three open services, each mounted in the tab that already asks its question.
 *
 * They began as a tab of their own -- "Data · Earth systems" -- and that was
 * the wrong shape. A tab is a place you go to do a KIND of work, and none of
 * these three is a kind of work: soil is a fact about the ground under the
 * view, which is what the Geology tab is for; a seismogram is a time series
 * for the analysis pages, which is what Analyse is for; and people in a
 * polygon is a number about the study area, which is what Extract is for.
 * Filed together they were a fourth place to look for something that belonged
 * beside what it answers, and the last one anybody would have looked in.
 *
 * So this module now builds its own cards and mounts each one where its
 * question is already being asked. Nothing about the services changed.
 *
 * `earth-data.js` is the pure half — URLs in, parsed answers out, tested
 * without a network. This is the half that knows where "here" is, what to do
 * with an answer, and how to say when a service declines to have one.
 *
 * Each takes its place from something the app already knows rather than
 * asking for coordinates:
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
} from "./earth-data.js?v=20260829-90e9f42";

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

/** Great-circle kilometres between two {lat, lon} points. */
function distanceKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

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

/** The window the form is currently asking for, if it has a valid one. */
function windowNow() {
  const startField = byId("earthdata-start")?.value;
  if (!startField) return {};
  const start = new Date(`${startField}:00Z`);
  if (Number.isNaN(start.getTime())) return {};
  const minutes = Math.max(1, Math.min(60, Number(byId("earthdata-minutes")?.value) || 5));
  return { start, end: new Date(start.getTime() + minutes * 60000) };
}

async function runStations(at) {
  const p = at || viewCentre();
  if (!p) return say("earthdata-seis-out", "Point the globe at somewhere first.");
  const node = byId("earthdata-node")?.value || FDSN_NODES[0].id;
  say("earthdata-seis-out", `Looking for instruments within 2° of ${place(p)}…`);
  // Vertical broadband and short-period channels: the ones an earthquake is
  // read from. Asking for every channel returns barometers and tiltmeters too,
  // which is a longer list and not what the button offers.
  // Narrowed to the window the fetch will ask for, when there is one. A
  // station service asked without a window returns every instrument that has
  // ever stood there, including the temporary deployments installed AFTER the
  // event being read -- which answer a waveform request with 204 and no
  // explanation. `windowNow()` reads the form, so the manual path is narrowed
  // by whatever is in the date box.
  const span = windowNow();
  /**
   * Widen until something answers, rather than reporting an empty circle.
   *
   * Two degrees is about 220 km, which is the right first question -- the
   * nearest instrument gives the clearest arrival -- and often the wrong last
   * one. Measured around the 2023 Kahramanmaras epicentre with the window
   * applied: nothing at all inside 2 degrees was recording that minute, while
   * GE.ARPR at 2.5 degrees was, and every broadband station in Europe caught
   * it. A seismogram from 600 km away is a seismogram; an empty list is not.
   */
  let out = { ok: true, stations: [], message: "no stations in range" };
  let usedRadius = 0;
  for (const radiusDeg of [2, 6, 15]) {
    usedRadius = radiusDeg;
    // eslint-disable-next-line no-await-in-loop -- each radius is only asked
    // for because the one before it came back empty.
    out = await fetchStations(node, {
      lat: p.lat, lon: p.lon, radiusDeg, channel: "?HZ", ...span,
    });
    if (!out.ok || out.stations.length) break;
    if (radiusDeg !== 15) {
      say("earthdata-seis-out",
        `Nothing recording within ${radiusDeg}° of ${place(p)} then — looking wider…`);
    }
  }
  const select = byId("earthdata-channel");
  if (select) {
    select.innerHTML = "";
    /**
     * Nearest first, and the fastest channel of each station first.
     *
     * The archive returns its channels in its own order, which is neither --
     * so the top of the list was whatever the file happened to start with, and
     * "the first station" meant nothing in particular. Sorting also makes the
     * automatic walk below meaningful: it can stop at the first that answers
     * because the first is genuinely the closest.
     */
    const ranked = out.stations
      .map((s) => ({ ...s, km: distanceKm(p, s) }))
      .sort((a, b) => (a.km - b.km) || ((b.sampleRate || 0) - (a.sampleRate || 0)));
    ranked.forEach((s) => {
      const option = document.createElement("option");
      option.value = JSON.stringify({
        net: s.network, sta: s.station, loc: s.location, cha: s.channel,
      });
      option.dataset.station = `${s.network}.${s.station}`;
      option.dataset.rate = String(s.sampleRate || 0);
      // Carried on the option so the fetch can hand it back with the trace:
      // how far the instrument was from the epicentre is what turns a wiggle
      // into arrival times, and re-deriving it downstream would mean a second
      // copy of the station list.
      option.dataset.km = String(s.km);
      option.dataset.lat = String(s.lat);
      option.dataset.lon = String(s.lon);
      option.textContent = `${s.id} · ${s.sampleRate || "?"} Hz · ${Math.round(s.km)} km`;
      option.title = `${s.startTime?.slice(0, 10)} to ${s.endTime?.slice(0, 10) || "open"}`;
      select.appendChild(option);
    });
  }
  say("earthdata-seis-out", out.ok
    ? (out.stations.length
      ? `${out.message} within ${usedRadius}° of ${place(p)}`
        + `${span.start ? ", recording at that moment" : ""}. Pick one and fetch.`
      : `No instrument within ${usedRadius}° of ${place(p)} was recording then.`)
    : out.message);
}

async function runWaveform() {
  const raw = byId("earthdata-channel")?.value;
  if (!raw) {
    say("earthdata-seis-out", "Find stations first, then pick a channel.");
    return { ok: false, message: "no channel chosen" };
  }
  const query = JSON.parse(raw);
  const node = byId("earthdata-node")?.value || FDSN_NODES[0].id;
  const startField = byId("earthdata-start")?.value;
  if (!startField) {
    say("earthdata-seis-out", "Set a window start — UTC.");
    return { ok: false, message: "no window" };
  }
  const minutes = Math.max(1, Math.min(60, Number(byId("earthdata-minutes")?.value) || 5));
  // The field is naive local time in the browser's zone; FDSN wants UTC, and a
  // trace an hour off is a trace of the wrong thing.
  const start = new Date(`${startField}:00Z`);
  const end = new Date(start.getTime() + minutes * 60000);

  const chosen = byId("earthdata-channel")?.selectedOptions?.[0];
  const station = chosen ? {
    id: `${query.net}.${query.sta}`,
    km: Number(chosen.dataset.km),
    lat: Number(chosen.dataset.lat),
    lon: Number(chosen.dataset.lon),
  } : null;

  say("earthdata-seis-out", `Fetching ${query.net}.${query.sta}.${query.cha}…`);
  const out = await fetchWaveform(node, { ...query, start, end });
  if (!out.ok) {
    say("earthdata-seis-out", out.message);
    return { ok: false, message: out.message };
  }
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
  // The trace itself goes back to the caller: the event popup draws it, and
  // this panel is one of two places it is wanted rather than the only one.
  return {
    ok: true,
    trace,
    // Where the instrument was and when the window opened: both are needed to
    // put an arrival time on the picture, and only this side knows them.
    station,
    startMs: start.getTime(),
    problems: out.problems,
    message: out.message,
    saved: Boolean(saved),
  };
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

/* ── where each card is mounted ───────────────────────────────────────────── */

/**
 * A tool card, built rather than written into the panel markup.
 *
 * The three cards go into three different panels, and two of those panels are
 * themselves built at runtime -- the geology tab by `geology-panel.js`, the
 * GIS tabs by `panels.js`. Markup in any one file could only reach one of
 * them, so the card comes with the code that runs it.
 */
function card(title, copy, body) {
  const node = document.createElement("details");
  node.className = "gis-tool-section";
  node.innerHTML = `<summary>${title}</summary>
    <div class="gis-tool-body"><p class="tool-copy">${copy}</p>${body}</div>`;
  return node;
}

/**
 * Mount when the host exists, however it got there.
 *
 * `panels.js` writes its markup after this module loads and `geology-panel.js`
 * builds its own; there is no one event that means "the panels are up". A
 * short poll is honest about that and stops itself once every card has landed.
 */
function whenHost(selector, place) {
  let tries = 0;
  const tick = () => {
    const host = document.querySelector(selector);
    if (host) { place(host); return; }
    // About fifteen seconds, which is far longer than any panel takes; a page
    // without the host (a planet viewer, say) simply never mounts that card.
    if ((tries += 1) < 50) window.setTimeout(tick, 300);
  };
  tick();
}

function mountSoil() {
  // Earth only: SoilGrids maps this planet, and `geology-section` is Earth's
  // own tab. The planet viewers get nothing here, which is correct rather than
  // a gap.
  whenHost("#geology-section .section-body .control-stack", (host) => {
    if (byId("earthdata-soil")) return;
    host.appendChild(card(
      "Soil here (SoilGrids)",
      "Texture, bulk density and organic carbon at 250 m, from ISRIC — the material "
      + "above the mapped rock. The two strength parameters the slope model needs are "
      + "derived from the texture and shown beside it.",
      `<div class="gis-btn-row">
        <button id="earthdata-soil" class="button" type="button">Sample the view centre</button>
      </div>
      <div id="earthdata-soil-out" class="gis-metric"></div>`,
    ));
    byId("earthdata-soil")?.addEventListener("click", () => { void runSoil(); });
  });
}

function mountSeismograms() {
  whenHost("#gis-group-analysis .section-body", (host) => {
    if (byId("earthdata-waveform")) return;
    host.appendChild(card(
      "Seismograms (FDSN)",
      "Instruments near the view centre, and the waveform one of them recorded. Saved "
      + "into the open project as a time series the Signal and Spectral pages read, so "
      + "the analysis written for solver output works on a real earthquake.",
      `<label class="row"><span>Archive</span>
        <select id="earthdata-node" class="input"></select>
      </label>
      <div class="gis-btn-row">
        <button id="earthdata-stations" class="button" type="button">Find stations</button>
      </div>
      <label class="row"><span>Channel</span>
        <select id="earthdata-channel" class="input"></select>
      </label>
      <label class="row"><span>Window start (UTC)</span>
        <input id="earthdata-start" class="input" type="datetime-local">
      </label>
      <label class="row"><span>Minutes</span>
        <input id="earthdata-minutes" class="input" type="number" min="1" max="60" value="5">
      </label>
      <div class="gis-btn-row">
        <button id="earthdata-waveform" class="button primary" type="button">Fetch waveform</button>
      </div>
      <div id="earthdata-seis-out" class="gis-metric"></div>`,
    ));
    fillNodes();
    byId("earthdata-stations")?.addEventListener("click", () => { void runStations(); });
    byId("earthdata-waveform")?.addEventListener("click", () => { void runWaveform(); });
    // A window nobody has to invent: the 2023 Kahramanmaras M7.8, which every
    // broadband station on the planet recorded. An empty datetime field is a
    // question with no obvious answer.
    const start = byId("earthdata-start");
    if (start && !start.value) start.value = "2023-02-06T01:18";
  });
}

function mountPopulation() {
  // The Extract panel is where the study area is drawn and sampled, and people
  // in that area is one more thing sampled across it.
  whenHost("#gis-analysis-section .section-body", (host) => {
    if (byId("earthdata-population")) return;
    host.appendChild(card(
      "People here (WorldPop)",
      "How many people live inside the area you drew. Hazard becomes risk at this "
      + "step, and it takes a study area rather than a point.",
      `<div class="gis-btn-row">
        <button id="earthdata-population" class="button" type="button">Count the study area</button>
      </div>
      <div id="earthdata-pop-out" class="gis-metric"></div>`,
    ));
    byId("earthdata-population")?.addEventListener("click", () => { void runPopulation(); });
  });
}

/* ── from an earthquake on the globe ──────────────────────────────────────── */

/** An FDSN window start, in the naive-local form the datetime field takes. */
function startFieldValue(timeMs) {
  // The field is read back as UTC (`${value}:00Z`), so it must be WRITTEN as
  // UTC too -- toISOString, not the browser's local formatting, or a trace
  // comes back offset by the reader's timezone and looks like the wrong event.
  return new Date(timeMs).toISOString().slice(0, 16);
}

/**
 * Walk the station list, one distinct station at a time, until one answers.
 *
 * A station having a RECORD is not the same as an archive having its DATA, and
 * nothing in the metadata distinguishes them. Measured on the 2023
 * Kahramanmaras M7.8: GEOFON lists GE.ARPR and GE.MALT as operating that
 * minute and returns 204 No Content for both, while ORFEUS returns 86 KB from
 * TU.ANDN, 46 km from the epicentre. So the only way to find out is to ask.
 */
async function tryNearest(limit = 4) {
  const select = byId("earthdata-channel");
  const options = [...(select?.options || [])];
  const seen = new Set();
  let tried = 0;
  for (let i = 0; i < options.length && tried < limit; i += 1) {
    const option = options[i];
    // One channel per STATION: the list holds BHZ, HHZ and VHZ for the same
    // instrument, so trying four channels was trying one station four times.
    // And a 0.1 Hz very-long-period channel cannot show a body wave -- it is
    // the right record of the wrong thing.
    if (seen.has(option.dataset.station) || Number(option.dataset.rate) < 1) continue;
    seen.add(option.dataset.station);
    tried += 1;
    select.selectedIndex = i;
    say("earthdata-seis-out", `Asking ${option.textContent}…`);
    // eslint-disable-next-line no-await-in-loop -- deliberately one at a time:
    // the first station that answers is the one wanted, and firing four
    // waveform requests at somebody else's archive to discard three is rude.
    const out = await runWaveform();
    if (out?.ok) return out;
  }
  return { ok: false, message: `nothing from the ${tried} nearest station(s)` };
}

/**
 * "Show me what this earthquake looked like on a seismometer."
 *
 * The events feed knows where and when; this knows how to ask an archive. One
 * button on the popup joins them, rather than leaving somebody to copy an
 * epicentre and a UTC time into a form three panels away.
 *
 * BOTH archives are asked, in turn, because which one holds a given trace is
 * not something anybody should have to know: GEOFON carries the GE network and
 * its partners, ORFEUS routes to Europe's regional and temporary networks, and
 * the station nearest an epicentre belongs to whichever it belongs to.
 */
async function seismogramNear(lat, lon, timeMs, { focusPanel = true } = {}) {
  // The panel is opened when somebody asked for it there. Called from an event
  // popup it is NOT: throwing the sidebar to another section is the app
  // deciding where you were looking, and the popup draws the trace itself.
  if (focusPanel) {
    const section = document.getElementById("gis-group-analysis");
    if (section) section.open = true;
    const host = byId("earthdata-waveform")?.closest("details.gis-tool-section");
    if (host) {
      host.open = true;
      host.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
  const start = byId("earthdata-start");
  // A minute before it happened, so the trace carries the quiet the arrival
  // stands out against.
  if (start && Number.isFinite(timeMs)) start.value = startFieldValue(timeMs - 60000);

  const nodeSelect = byId("earthdata-node");
  const chosen = nodeSelect?.value || FDSN_NODES[0].id;
  // The one already selected first: somebody who picked an archive meant it.
  const order = [chosen, ...FDSN_NODES.map((n) => n.id).filter((id) => id !== chosen)];
  for (const node of order) {
    if (nodeSelect) nodeSelect.value = node;
    // The window is set FIRST, because the station search is narrowed by it --
    // searching before setting it lists instruments that did not exist yet.
    // eslint-disable-next-line no-await-in-loop -- the second archive is only
    // asked because the first had nothing.
    await runStations({ lat, lon });
    // eslint-disable-next-line no-await-in-loop
    const out = await tryNearest();
    if (out?.ok) return out;
  }
  const message = "Neither archive holds a trace from the nearest stations for that "
    + "window. Try a wider window, or pick a station further out from the list.";
  say("earthdata-seis-out", message);
  return { ok: false, message };
}

/* ── wiring ───────────────────────────────────────────────────────────────── */

function init() {
  mountSoil();
  mountSeismograms();
  mountPopulation();
  // The seam the events popup calls, so it does not have to import a module
  // that may not be on a given page.
  window.GeoIDEarthData = { seismogramNear, runSoil, runStations, runWaveform, runPopulation };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

export { init, runSoil, runStations, runWaveform, runPopulation, seismogramNear };
