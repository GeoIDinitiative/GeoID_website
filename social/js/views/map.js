/**
 * #/map — where the community works, in two modes, with its history and,
 * on request, official hazard data beside it.
 *
 * STUDY INTEREST (the default) is the distribution of people: each disc is a
 * grid cell sized by how many distinct researchers have a reason to be there
 * (a study area on their profile, a public post, a public project), amber
 * where activity is rising, cyan where it is steady. Click one to see who is
 * there and why each is counted. The panel lists what is trending.
 *
 * POSTS & PROJECTS is the content itself; the server clusters when a view
 * holds more than 300 items, and a click opens what is near (/v1/places).
 *
 * HISTORY. The time slider picks a calendar month (or "All time"); the map
 * then shows that month alone, or everything up to its end. Play steps
 * through the months. Each frame is an ordinary request (`since`/`until` on
 * /v1/map/interest and /v1/map), cached, with the next one fetched while the
 * current one is on screen. With reduced motion the frames do not fade and
 * advance more slowly; nothing moves on its own until Play is pressed.
 *
 * LIVE HAZARDS are the USGS real-time feed of M2.5+ earthquakes in the past
 * seven days, fetched by the browser straight from earthquake.usgs.gov. They
 * are OFFICIAL data and look it: hollow red rings, never the filled glow of
 * community content, labelled as USGS in the legend, the list and the panel.
 * The time slider does not apply to them.
 *
 * Nothing overlaps: community markers are grouped in screen space for the
 * zoom being drawn (declutter.js), hazard markers are grouped among
 * themselves and then moved off the community's (with a leader line home),
 * and labels are placed only where free. The list under the canvas carries
 * the same content for keyboard and screen reader use: the canvas is a
 * picture, the list is the content.
 */
import * as api from "../api.js";
import { store } from "../store.js";
import { h, clear, field, input, select, errorBox, loading, dateToEpoch, dateText, extLink, put, pollWhileVisible } from "../dom.js";
import { KINDS, kindLabel, userRow, postCard, followButton } from "../components.js";
import { createMap } from "../mapcore.js";
import { groupMarkers, fanOut, groupRadius, placeLabels, avoidDiscs, FAN_MAX } from "../declutter.js";
import { monthRange } from "../plotmath.js";

// The hero tile's two marker colours: cyan for steady, amber for live/rising.
const CYAN = [0, 212, 192];
const AMBER = [240, 176, 48];
// Official hazard data: a red no community marker uses, and only ever as a ring.
const HAZARD = [255, 77, 109];
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

const USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";
const USGS_SOURCE = "U.S. Geological Survey (USGS) — official real-time feed, M2.5+ earthquakes, past 7 days";

const KIND_COLOUR = {
  observation: "#ffd166", scene: "#7ad7ff", analysis: "#9aa8ff", monitor: "#9aa8ff", dataset: "#8be28b", workflow: "#8be28b",
  model: "#9aa8ff", repo: "#8be28b", paper: "#d8c4ff", question: "#ffffff", discussion: "#ffffff", event: "#ff9f7a",
  opportunity: "#ff9f7a", challenge: "#ff9f7a", project: "#35d6b8", text: "#cfd8e3",
};

const TREND_TEXT = { new: "New activity", rising: "Rising", steady: "Steady" };
const bubbleR = (n) => 9 + Math.min(18, Math.log2((n || 1) + 1) * 3);
const cellR = (researchers) => Math.min(30, 5 + 3.2 * Math.sqrt(researchers || 1));
const quakeR = (mag) => 4 + Math.max(0, (Number(mag) || 2.5) - 2.5) * 2.6;
const placeText = (c, more = c.places_more || 0) =>
  `${c.place || `${Number(c.lat).toFixed(1)}°, ${Number(c.lon).toFixed(1)}°`}${more ? ` +${more}` : ""}`;
const monthName = (m) => new Date(m.start * 1000).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonth = (m) => new Date(m.start * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

/** USGS GeoJSON to the few fields drawn, dropping anything without a usable point. */
function readQuakes(fc) {
  const out = [];
  for (const f of Array.isArray(fc?.features) ? fc.features : []) {
    const [lon, lat, depth] = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates : [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    const p = f.properties || {};
    let link = "";
    // Only ever a link to the USGS itself: this is official data, and its
    // links must not be a way to send a reader anywhere else.
    try { const u = new URL(String(p.url || "")); if (u.protocol === "https:" && /(^|\.)usgs\.gov$/.test(u.hostname)) link = u.toString(); } catch (e) { /* none */ }
    out.push({
      id: String(f.id || ""), lon, lat, depth: Number.isFinite(depth) ? depth : null,
      mag: Number.isFinite(p.mag) ? p.mag : null, magType: String(p.magType || ""), place: String(p.place || ""),
      time: Number.isFinite(p.time) ? Math.floor(p.time / 1000) : null, tsunami: !!p.tsunami, alert: p.alert ? String(p.alert) : "", link,
    });
  }
  return out.sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0));
}

export function render(root, { query }) {
  const mode = select("mode", [["interest", "Study interest"], ["posts", "Posts & projects"]], query.mode || "interest");
  const kind = select("kinds", [["", "All kinds"], ["project", "Projects"], ...Object.keys(KINDS).map((k) => [k, kindLabel(k)])], query.kinds || "");
  const since = input("since", { type: "date", value: query.since || "" });
  const tag = input("tag", { value: query.tag || "", placeholder: "e.g. volcanology" });
  const layer = select("layer", [["public", "Public"], ["mine", "Mine"], ["teams", "My teams"]], query.layer || "public");
  if (!store.me) { [...layer.options].forEach((o) => { if (o.value !== "public") o.disabled = true; }); }
  const hazardBox = h("input", { type: "checkbox", name: "hazards", checked: query.hazards === "1" });
  const hazardToggle = h("label", { class: "s-check s-hazard-toggle" }, hazardBox,
    h("span", {}, "Live hazards", h("small", { class: "s-hint", text: "USGS earthquakes, past 7 days (official data)" })));
  const sinceField = field("Since", since);
  const postFields = [field("Kind", kind), sinceField, field("Layer", layer, store.me ? "" : "Sign in to see your own and your teams' items.")];
  const filters = h("form", { class: "s-filters", "aria-label": "Map filters" }, field("Show", mode), field("Topic", tag), ...postFields, hazardToggle);

  // ── Time controls ──
  const months = monthRange(Math.floor(Date.now() / 1000), 24);
  const ALL = months.length;
  const slider = h("input", { type: "range", min: 0, max: ALL, step: 1, value: ALL, class: "s-time-range",
    "aria-label": "Month shown on the map" });
  const sliderText = h("output", { class: "s-time-label" }, "All time");
  const span = select("span", [["month", "That month only"], ["upto", "Everything up to then"]], "month");
  span.setAttribute("aria-label", "Which period each month shows");
  const playBtn = h("button", { type: "button", class: "s-icon-btn s-play", "aria-pressed": "false", "aria-label": "Play the map's history month by month" }, "▶");
  const timebar = h("div", { class: "s-timebar", role: "group", "aria-label": "Map history" },
    playBtn,
    h("div", { class: "s-time-track" }, slider,
      h("div", { class: "s-time-ends", "aria-hidden": "true" }, h("span", {}, shortMonth(months[0])), h("span", {}, "All time"))),
    sliderText, span);

  const canvas = h("canvas", { class: "s-map", tabindex: "0", role: "img",
    "aria-label": "Map of where community members work. Drag or use arrow keys to pan, mouse wheel or plus and minus to zoom, click a disc or marker for details." });
  const zoomIn = h("button", { type: "button", class: "s-icon-btn", "aria-label": "Zoom in" }, "+");
  const zoomOut = h("button", { type: "button", class: "s-icon-btn", "aria-label": "Zoom out" }, "−");
  const status = h("p", { class: "s-hint", role: "status", "aria-live": "polite" });
  const hazardStatus = h("p", { class: "s-hint s-hazard-status", "aria-live": "polite", hidden: true });
  const panel = h("aside", { class: "s-side s-place-panel", "aria-live": "polite" });
  const listBox = h("details", { class: "s-map-list" }, h("summary", {}, "What is in view, as a list"), h("ul", { class: "s-plain" }));
  const legend = h("ul", { class: "s-legend", "aria-label": "Legend" });

  let interest = null;               // /v1/map/interest response
  let content = { clusters: [], points: [] };
  let quakes = null;                 // readQuakes(USGS feed), or null when off / not loaded
  let drawn = [];                    // hit targets from the last draw
  let seq = 0;
  let map = null;
  let playing = false;
  let fadeFrom = 0;                  // performance.now() when the current frame arrived
  let stopHazardPoll = null;
  const cache = new Map();
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const isInterest = () => mode.value === "interest";
  const frame = () => Number(slider.value);

  /** The slider's period in words, or "" for "All time". */
  const period = () => {
    const i = frame();
    if (i >= ALL) return { label: "" };
    const m = months[i];
    return { label: span.value === "month" ? monthName(m) : `up to the end of ${monthName(m)}` };
  };

  const drawLegend = () => {
    clear(legend);
    if (isInterest()) {
      put(legend,
        h("li", {}, h("span", { class: "s-swatch", style: `background:${rgba(CYAN, 0.9)}` }), "Steady interest"),
        h("li", {}, h("span", { class: "s-swatch", style: `background:${rgba(AMBER, 0.9)}` }), "Rising or new in the last 30 days"),
        h("li", {}, h("span", { class: "s-swatch s-swatch-ring" }), "Size = number of researchers"));
    } else {
      [["observation", "Observations"], ["scene", "Scenes"], ["analysis", "Analyses, models"], ["dataset", "Data, workflows, code"],
        ["event", "Events & opportunities"], ["project", "Projects"]].forEach(([k, label]) =>
        put(legend, h("li", {}, h("span", { class: "s-swatch", style: `background:${KIND_COLOUR[k]}` }), label)));
      put(legend, h("li", {}, h("span", { class: "s-swatch s-swatch-ring" }), "Group (number = items); small groups fan out"));
    }
    if (hazardBox.checked) {
      put(legend, h("li", { class: "s-legend-official" }, h("span", { class: "s-swatch s-swatch-hazard" }),
        "Earthquake, M2.5+, past 7 days — official USGS data, not community content"));
    }
  };

  const syncFilters = () => {
    postFields.forEach((f) => { f.hidden = isInterest(); });
    // A month on the slider is the period; the Since date would contradict it.
    since.disabled = frame() < ALL;
    sinceField.title = since.disabled ? "The time slider sets the period while a month is chosen." : "";
    drawLegend();
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  const paramsFor = (view, i = frame()) => {
    const z = Math.max(0, Math.round(Math.log2(view.zoom)) + 1);
    const bbox = view.bbox.map((v) => v.toFixed(3)).join(",");
    const m = i < ALL ? months[i] : null;
    const win = m ? { since: span.value === "month" ? m.start : null, until: m.end } : { since: null, until: null };
    if (isInterest()) {
      return ["/v1/map/interest", { world: "earth", bbox, z, tag: tag.value.trim().toLowerCase(), since: win.since, until: win.until }];
    }
    return ["/v1/map", {
      world: "earth", bbox, z, kinds: kind.value,
      since: m ? win.since : dateToEpoch(since.value),
      // /v1/map's until is inclusive; the month's end is the next month's first second.
      until: m ? win.until - 1 : null,
      tag: tag.value.trim().toLowerCase(), layer: layer.value,
    }];
  };
  const cached = ([path, params]) => {
    const key = `${path}?${JSON.stringify(params)}`;
    if (cache.has(key)) return cache.get(key);
    const pending = api.get(path, params).catch((error) => { cache.delete(key); throw error; });
    cache.set(key, pending);
    if (cache.size > 80) cache.delete(cache.keys().next().value);
    return pending;
  };

  const load = async (view) => {
    const my = ++seq;
    const p = period();
    status.textContent = "Loading…";
    try {
      const data = await cached(paramsFor(view));
      if (my !== seq) return;
      const when = p.label ? `${p.label[0].toUpperCase()}${p.label.slice(1)}: ` : "";
      if (isInterest()) {
        interest = data;
        const n = data?.researchers || 0;
        status.textContent = when + (n ? `${n} researcher${n === 1 ? "" : "s"} ${p.label ? "active" : "working"} in this view.`
          : (p.label ? "nobody shared a study area or a located post here in this period." : "Nobody has shared a study area or a located post here yet."));
        if (!panel.dataset.cell) drawOverview();
      } else {
        content = { clusters: data?.clusters || [], points: data?.points || [] };
        const n = content.points.length + content.clusters.reduce((s, c) => s + (c.count || 0), 0);
        status.textContent = when + (n ? `${n} item${n === 1 ? "" : "s"} in view.` : "nothing in view with these filters.");
        if (!panel.dataset.cell) drawPostsHint();
      }
      fadeFrom = playing && !reduced?.matches ? performance.now() : 0;
      drawList();
      map.draw();
    } catch (error) {
      if (my !== seq) return;
      status.textContent = error.message || "Could not load the map.";
    }
  };
  const reload = () => load({ ...map.view, bbox: map.bbox() });

  // ── Time slider and Play ─────────────────────────────────────────────────
  const syncSliderText = () => {
    const i = frame();
    const text = i >= ALL ? "All time" : (span.value === "month" ? monthName(months[i]) : `Up to ${monthName(months[i])}`);
    sliderText.textContent = text;
    slider.setAttribute("aria-valuetext", text);
    span.disabled = i >= ALL;
  };
  const setPlaying = (on) => {
    playing = on;
    playBtn.textContent = on ? "❚❚" : "▶";
    playBtn.setAttribute("aria-pressed", String(on));
    playBtn.setAttribute("aria-label", on ? "Pause the history" : "Play the map's history month by month");
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const play = async () => {
    if (playing) { setPlaying(false); return; }
    setPlaying(true);
    if (frame() >= ALL) slider.value = "0";
    while (playing) {
      syncSliderText(); syncFilters();
      await reload();
      if (!playing) break;
      // Warm the next frame while this one is on screen.
      const nextI = frame() + 1;
      if (nextI > ALL) break;
      cached(paramsFor({ ...map.view, bbox: map.bbox() }, nextI)).catch(() => {});
      await wait(reduced?.matches ? 2600 : 1200);
      if (!playing) break;
      slider.value = String(nextI);
      if (nextI === ALL) { syncSliderText(); syncFilters(); await reload(); break; }
    }
    setPlaying(false);
  };
  playBtn.addEventListener("click", () => { void play(); });
  slider.addEventListener("input", () => { setPlaying(false); syncSliderText(); syncFilters(); delete panel.dataset.cell; reload(); });
  span.addEventListener("change", () => { syncSliderText(); reload(); });

  // ── Live hazards ─────────────────────────────────────────────────────────
  const loadQuakes = async () => {
    hazardStatus.hidden = false;
    if (!quakes) hazardStatus.textContent = "Fetching the USGS earthquake feed…";
    try {
      const res = await fetch(USGS_FEED, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error(`USGS answered ${res.status}`);
      const list = readQuakes(await res.json());
      if (!hazardBox.checked) return;
      quakes = list;
      hazardStatus.textContent = `Official USGS data: ${list.length} earthquake${list.length === 1 ? "" : "s"} of M2.5+ worldwide in the past 7 days, fetched ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. The time slider does not apply to them.`;
      drawList();
      map.draw();
    } catch (error) {
      hazardStatus.textContent = `The USGS earthquake feed could not be reached (${error.message || "network error"}).`;
    }
  };
  const syncHazards = () => {
    stopHazardPoll?.(); stopHazardPoll = null;
    if (hazardBox.checked) {
      void loadQuakes();
      // The feed itself refreshes every minute; every five is plenty here.
      stopHazardPoll = pollWhileVisible(() => { void loadQuakes(); }, 5 * 60 * 1000);
    } else {
      quakes = null; hazardStatus.hidden = true;
      if (panel.dataset.cell === "quake") drawSideDefault();
      drawList(); map?.draw();
    }
    drawLegend();
  };

  // ── Panels ───────────────────────────────────────────────────────────────
  const studyAreaCta = () => (store.me
    ? h("p", { class: "s-hint" }, "Your study areas put you on this map. ", h("a", { href: "#/me" }, "Add or edit yours"), ".")
    : h("p", { class: "s-hint", text: "Members appear here through the study areas on their profiles and what they share publicly." }));

  const drawSideDefault = () => (isInterest() ? drawOverview() : drawPostsHint());

  const drawOverview = () => {
    delete panel.dataset.cell;
    clear(panel);
    const cells = interest?.cells || [];
    const p = period();
    put(panel, h("h2", { class: "s-side-title", text: p.label ? `Trending, ${p.label}` : "Trending study areas" }));
    const trending = interest?.trending || [];
    if (!trending.length) put(panel, h("p", { class: "s-muted", text: p.label ? "Nothing was rising in this view then." : "Nothing is rising in this view in the last 30 days." }));
    else {
      put(panel, h("ol", { class: "s-trend-list" }, trending.map((c) => h("li", {},
        h("button", { type: "button", class: "s-linkish", onClick: () => { map.setView(c.lon, c.lat, Math.max(map.view.zoom, 4)); openCell(c); } }, placeText(c)),
        h("span", { class: `s-trend s-trend-${c.trend}`, text: TREND_TEXT[c.trend] }),
        h("span", { class: "s-muted", text: ` ${c.researchers} researcher${c.researchers === 1 ? "" : "s"} · ${c.recent} new item${c.recent === 1 ? "" : "s"} in 30 days (${c.prior} the month before)` }),
        c.top_tags?.length ? h("span", { class: "s-muted", text: ` · ${c.top_tags.map((t) => `#${t}`).join(" ")}` }) : null))));
    }
    const busiest = cells.slice(0, 5);
    if (busiest.length) {
      put(panel, h("h3", { class: "s-h3", text: "Where most people work" }),
        h("ol", { class: "s-trend-list" }, busiest.map((c) => h("li", {},
          h("button", { type: "button", class: "s-linkish", onClick: () => { map.setView(c.lon, c.lat, Math.max(map.view.zoom, 4)); openCell(c); } }, placeText(c)),
          h("span", { class: "s-muted", text: ` ${c.researchers} researcher${c.researchers === 1 ? "" : "s"}` })))));
    }
    put(panel, h("p", { class: "s-fine", text: interest?.note || "" }), studyAreaCta());
  };

  const drawPostsHint = () => {
    delete panel.dataset.cell;
    put(clear(panel), h("p", { class: "s-muted", text: "Click a marker or anywhere on the map to see what is near that place." }));
  };

  const openCell = async (c) => {
    panel.dataset.cell = c.key || "1";
    put(clear(panel), loading());
    try {
      const data = await api.get("/v1/map/interest/cell", { world: "earth", s: c.cell.s, w: c.cell.w, size: c.cell.size });
      clear(panel);
      put(panel,
        h("button", { type: "button", class: "s-linkish s-back", onClick: drawOverview }, "← Trending"),
        h("h2", { class: "s-side-title", text: placeText(c) }),
        h("p", {}, h("span", { class: `s-trend s-trend-${c.trend}`, text: TREND_TEXT[c.trend] }),
          h("span", { class: "s-muted", text: ` ${c.researchers} researcher${c.researchers === 1 ? "" : "s"} · ${c.posts} posts · ${c.projects} projects · ${c.study_areas} study areas` })),
        c.top_tags?.length ? h("p", { class: "s-muted", text: c.top_tags.map((t) => `#${t}`).join("  ") }) : null);
      if (store.me) put(panel, followButton("place", `${Number(c.lat).toFixed(1)},${Number(c.lon).toFixed(1)}`, false, "this area"));
      const people = data?.people || [];
      if (people.length) {
        put(panel, h("h3", { class: "s-h3", text: "Who works here" }),
          h("ul", { class: "s-rows" }, people.map((p) => userRow(p.user, h("span", { class: "s-muted s-why", text: p.reasons.join(" · ") })))));
      }
      const posts = data?.posts || [];
      if (posts.length) put(panel, h("h3", { class: "s-h3", text: "Recent here" }), h("div", { class: "s-list s-list-tight" }, posts.map(postCard)));
      put(panel, studyAreaCta());
    } catch (error) { put(clear(panel), errorBox(error)); }
  };

  const openPlace = async (lat, lon, point) => {
    panel.dataset.cell = "place";
    put(clear(panel), loading());
    try {
      const data = await api.get("/v1/places", { lat: lat.toFixed(3), lon: lon.toFixed(3), radius_km: 50 });
      clear(panel);
      put(panel, h("h2", { class: "s-side-title", text: `Near ${lat.toFixed(2)}, ${lon.toFixed(2)}` }));
      if (point) put(panel, h("p", {}, h("a", { href: point.kind === "project" ? `#/p/${encodeURIComponent(point.id)}` : `#/post/${encodeURIComponent(point.id)}` }, point.title || kindLabel(point.kind)), ` (${kindLabel(point.kind)})`));
      if (store.me) put(panel, followButton("place", `${lat.toFixed(1)},${lon.toFixed(1)}`, false, "this place"));
      const posts = data?.posts || []; const projects = data?.projects || []; const people = data?.people || []; const comms = data?.communities_active || [];
      if (!posts.length && !projects.length) put(panel, h("p", { class: "s-muted", text: "Nothing shared within 50 km yet." }));
      if (posts.length) put(panel, h("h3", { class: "s-h3", text: "Posts" }), h("div", { class: "s-list s-list-tight" }, posts.slice(0, 10).map(postCard)));
      if (projects.length) put(panel, h("h3", { class: "s-h3", text: "Projects" }), h("ul", { class: "s-plain" }, projects.map((p) => h("li", {}, h("a", { href: `#/p/${encodeURIComponent(p.id)}` }, p.title)))));
      if (comms.length) put(panel, h("h3", { class: "s-h3", text: "Active communities" }), h("ul", { class: "s-plain" }, comms.map((c) => h("li", {}, h("a", { href: `#/c/${encodeURIComponent(c.slug)}` }, c.name || c.slug), ` (${c.count})`))));
      if (people.length) put(panel, h("h3", { class: "s-h3", text: "People who posted here" }), h("ul", { class: "s-rows" }, people.slice(0, 10).map((u) => userRow(u))));
    } catch (error) { put(clear(panel), errorBox(error)); }
  };

  /** An earthquake's own panel: the USGS's numbers, said to be the USGS's. */
  const openQuake = (q) => {
    panel.dataset.cell = "quake";
    clear(panel);
    put(panel,
      h("button", { type: "button", class: "s-linkish s-back", onClick: drawSideDefault }, "← Back"),
      h("p", { class: "s-official", text: "Official data · USGS" }),
      h("h2", { class: "s-side-title", text: `M ${q.mag != null ? q.mag.toFixed(1) : "?"} earthquake` }),
      h("p", {}, q.place || `${q.lat.toFixed(2)}, ${q.lon.toFixed(2)}`),
      h("dl", { class: "s-dl" },
        h("dt", {}, "Time"), h("dd", {}, q.time ? dateText(q.time, true) : "—"),
        h("dt", {}, "Magnitude"), h("dd", {}, `${q.mag != null ? q.mag.toFixed(1) : "—"}${q.magType ? ` (${q.magType})` : ""}`),
        h("dt", {}, "Depth"), h("dd", {}, q.depth != null ? `${q.depth.toFixed(1)} km` : "—"),
        q.alert ? [h("dt", {}, "PAGER alert"), h("dd", {}, q.alert)] : null,
        q.tsunami ? [h("dt", {}, "Tsunami"), h("dd", {}, "The USGS flags this event as in a tsunami region; see the event page.")] : null),
      q.link ? h("p", {}, extLink(q.link, "Event page on usgs.gov")) : null,
      h("p", { class: "s-fine", text: `Source: ${USGS_SOURCE}. Shown as published, not checked or changed by GeoHUB Social, and not community content.` }),
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => openPlace(q.lat, q.lon, null) }, "Community activity near here"));
  };

  const drawList = () => {
    const ul = listBox.querySelector("ul");
    clear(ul);
    if (isInterest()) {
      (interest?.cells || []).slice(0, 200).forEach((c) => put(ul, h("li", {},
        h("button", { type: "button", class: "s-linkish", onClick: () => openCell(c) }, placeText(c)),
        h("span", { class: "s-muted", text: ` — ${c.researchers} researcher${c.researchers === 1 ? "" : "s"}, ${TREND_TEXT[c.trend].toLowerCase()}${c.top_tags?.length ? `, ${c.top_tags.join(", ")}` : ""}` }))));
    } else {
      content.points.slice(0, 300).forEach((p) => put(ul, h("li", {},
        h("a", { href: p.kind === "project" ? `#/p/${encodeURIComponent(p.id)}` : `#/post/${encodeURIComponent(p.id)}` }, p.title || kindLabel(p.kind)),
        h("span", { class: "s-muted" }, ` — ${kindLabel(p.kind)}, ${Number(p.lat).toFixed(1)}, ${Number(p.lon).toFixed(1)}${p.precision && p.precision !== "exact" ? ` (${p.precision})` : ""}`))));
      content.clusters.forEach((c) => put(ul, h("li", { class: "s-muted", text: `A group of ${c.count} near ${Number(c.lat).toFixed(1)}, ${Number(c.lon).toFixed(1)} — zoom in to see them.` })));
    }
    if (quakes?.length && map) {
      const [w, s, e, n] = map.bbox();
      const inView = quakes.filter((q) => q.lon >= w && q.lon <= e && q.lat >= s && q.lat <= n);
      put(ul, h("li", { class: "s-list-head" }, h("strong", {}, `Official USGS earthquakes in view (${inView.length})`)));
      inView.slice(0, 100).forEach((q) => put(ul, h("li", {},
        h("button", { type: "button", class: "s-linkish", onClick: () => openQuake(q) }, `M ${q.mag != null ? q.mag.toFixed(1) : "?"} — ${q.place || `${q.lat.toFixed(1)}, ${q.lon.toFixed(1)}`}`),
        h("span", { class: "s-muted", text: q.time ? ` — ${dateText(q.time, true)}` : "" }))));
    }
  };

  // ── Drawing ──────────────────────────────────────────────────────────────
  const glowDisc = (ctx, x, y, r, colour, alpha) => {
    ctx.save();
    ctx.shadowColor = rgba(colour, 0.55); ctx.shadowBlur = 14;
    ctx.fillStyle = rgba(colour, alpha);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = rgba(colour, 0.95); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  };

  /**
   * Pill labels, hero-tile style: solid colour, dark text, only where free.
   * Community labels are asked for first, so official markers never push a
   * community label off the map; every disc drawn is an obstacle to both.
   * Official labels are dark tags with a red rule, never a community pill.
   */
  const drawLabels = (ctx, wanted, discs, w, hgt) => {
    ctx.font = "700 11px 'Public Sans', system-ui, sans-serif";
    const sized = wanted.filter((l) => l.text).map((l) => ({ ...l, w: ctx.measureText(l.text).width + 16, h: 18 }));
    const placed = placeLabels(sized, discs, { bounds: { x: 4, y: 4, w: w - 8, h: hgt - 8 } });
    for (const l of placed) {
      const { x, y, w: bw, h: bh } = l.box;
      if (l.official) {
        ctx.fillStyle = "rgba(10, 6, 14, 0.88)";
        ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 4); ctx.fill();
        ctx.strokeStyle = rgba(HAZARD, 0.9); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = rgba(HAZARD, 1);
      } else {
        ctx.fillStyle = rgba(l.colour, 0.9);
        ctx.beginPath(); ctx.roundRect(x, y, bw, bh, bh / 2); ctx.fill();
        ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
      }
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(l.text, x + bw / 2, y + bh / 2 + 0.5);
    }
  };

  const drawInterest = (ctx, project) => {
    const items = (interest?.cells || []).map((c) => {
      const [x, y] = project(c.lon, c.lat);
      return { x, y, weight: c.researchers, cell: c };
    });
    const groups = groupMarkers(items, { gap: 4, radiusOf: (g) => cellR(g.weight) });
    const targets = groups.map((g) => {
      const cells = g.members.map((m) => m.cell);
      const hot = cells.some((c) => c.trend !== "steady");
      const lead = cells.reduce((a, b) => (b.researchers > a.researchers ? b : a));
      // A disc that merged several cells names its biggest and counts the rest.
      const more = cells.reduce((n, c) => n + (c.places_more || 0) + (c.place ? 1 : 0), 0) - (lead.place ? 1 : 0);
      return { ...g, cells, colour: hot ? AMBER : CYAN, label: `${placeText(lead, Math.max(0, more))} · ${g.weight}` };
    });
    for (const g of targets) {
      glowDisc(ctx, g.x, g.y, g.r, g.colour, 0.32);
      if (g.r >= 11) {
        ctx.fillStyle = "#fff"; ctx.font = "700 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(g.weight), g.x, g.y + 0.5);
      }
    }
    return { targets, labels: targets.slice(0, 14).map((g) => ({ x: g.x, y: g.y, r: g.r, text: g.label, colour: g.colour })) };
  };

  const drawPosts = (ctx, project) => {
    const items = [
      ...content.points.map((p) => { const [x, y] = project(p.lon, p.lat); return { x, y, weight: 1, point: p }; }),
      ...content.clusters.map((c) => { const [x, y] = project(c.lon, c.lat); return { x, y, weight: c.count, cluster: c }; }),
    ];
    const radiusOf = (g) => {
      const onlyPoints = g.members.every((m) => m.point);
      return onlyPoints && g.members.length <= FAN_MAX ? groupRadius(g.members.length) : bubbleR(g.weight);
    };
    const groups = groupMarkers(items, { gap: 3, radiusOf });
    const targets = [];
    for (const g of groups) {
      const onlyPoints = g.members.every((m) => m.point);
      if (onlyPoints && g.members.length === 1) {
        const p = g.members[0].point;
        drawPoint(ctx, g.x, g.y, p);
        targets.push({ x: g.x, y: g.y, r: 8, point: p });
      } else if (onlyPoints && g.members.length <= FAN_MAX) {
        // Fan out round the group's centre; a spoke points back to where
        // each item really is (often the same rounded spot for all of them).
        const spots = fanOut(g.x, g.y, g.members.length, 14);
        ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1;
        g.members.forEach((m, i) => { ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(spots[i].x, spots[i].y); ctx.stroke(); });
        ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.arc(g.x, g.y, 2, 0, Math.PI * 2); ctx.fill();
        g.members.forEach((m, i) => {
          drawPoint(ctx, spots[i].x, spots[i].y, m.point);
          targets.push({ x: spots[i].x, y: spots[i].y, r: 8, point: m.point });
        });
        // The whole fan is one obstacle for the hazard layer, not a hit target.
        targets.push({ x: g.x, y: g.y, r: g.r, fan: true });
      } else {
        const r = bubbleR(g.weight);
        glowDisc(ctx, g.x, g.y, r, CYAN, 0.25);
        ctx.fillStyle = "#fff"; ctx.font = "700 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(g.weight), g.x, g.y + 0.5);
        targets.push({ x: g.x, y: g.y, r, group: g });
      }
    }
    return { targets, labels: [] };
  };

  const drawPoint = (ctx, x, y, p) => {
    ctx.fillStyle = KIND_COLOUR[p.kind] || "#fff";
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (p.kind === "project") ctx.rect(x - 5, y - 5, 10, 10); else ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  };

  /**
   * USGS earthquakes: grouped among themselves, then moved off the community
   * discs already drawn. A single quake is a ring sized by magnitude with a
   * dot at its centre; a group is a double ring with its count. A moved
   * marker keeps a thin leader line to a small cross at its true place.
   */
  const drawQuakes = (ctx, project, communityDiscs, w, hgt) => {
    if (!quakes?.length) return { targets: [], labels: [] };
    const items = [];
    for (const q of quakes) {
      const [x, y] = project(q.lon, q.lat);
      if (x < -30 || y < -30 || x > w + 30 || y > hgt + 30) continue;
      items.push({ x, y, weight: Math.max(0.5, (q.mag ?? 2.5) - 2), quake: q });
    }
    const radiusOf = (g) => (g.members.length === 1 ? quakeR(g.members[0].quake.mag) : Math.min(22, 8 + Math.log2(g.members.length + 1) * 3));
    const groups = groupMarkers(items, { gap: 2, radiusOf });
    const moved = avoidDiscs(groups, communityDiscs, { gap: 3, maxShift: 90 });
    const targets = []; const labels = [];
    for (const g of moved) {
      if (!g.placed) continue;
      if (g.moved) {
        ctx.strokeStyle = rgba(HAZARD, 0.5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(g.ax, g.ay); ctx.lineTo(g.x, g.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(g.ax - 3, g.ay - 3); ctx.lineTo(g.ax + 3, g.ay + 3); ctx.moveTo(g.ax + 3, g.ay - 3); ctx.lineTo(g.ax - 3, g.ay + 3); ctx.stroke();
      }
      ctx.fillStyle = "rgba(10, 6, 14, 0.55)";
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(HAZARD, 0.95); ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.stroke();
      if (g.members.length === 1) {
        const q = g.members[0].quake;
        ctx.fillStyle = rgba(HAZARD, 1);
        ctx.beginPath(); ctx.arc(g.x, g.y, 1.8, 0, Math.PI * 2); ctx.fill();
        targets.push({ x: g.x, y: g.y, r: Math.max(g.r, 6), quake: q });
        if ((q.mag ?? 0) >= 4.5) labels.push({ x: g.x, y: g.y, r: g.r, text: `M${q.mag.toFixed(1)}`, official: true, weight: q.mag });
      } else {
        ctx.beginPath(); ctx.arc(g.x, g.y, Math.max(3, g.r - 4), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = rgba(HAZARD, 1); ctx.font = "700 10px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(g.members.length), g.x, g.y + 0.5);
        const top = g.members.reduce((a, b) => ((b.quake.mag ?? 0) > (a.quake.mag ?? 0) ? b : a)).quake;
        targets.push({ x: g.x, y: g.y, r: g.r, quakeGroup: g });
        if ((top.mag ?? 0) >= 4.5) labels.push({ x: g.x, y: g.y, r: g.r, text: `max M${top.mag.toFixed(1)}`, official: true, weight: top.mag });
      }
    }
    labels.sort((a, b) => b.weight - a.weight);
    return { targets, labels: labels.slice(0, 8) };
  };

  const onDraw = (ctx, { project, w, h: hgt }) => {
    // A new history frame fades in, unless the reader asked for less motion.
    const t = fadeFrom ? Math.min(1, (performance.now() - fadeFrom) / 380) : 1;
    ctx.save();
    ctx.globalAlpha = t;
    const community = isInterest() ? drawInterest(ctx, project) : drawPosts(ctx, project);
    ctx.restore();
    const discs = community.targets.map((d) => ({ x: d.x, y: d.y, r: d.r }));
    // The zoom buttons sit over the canvas's top-right corner: nothing the
    // page can move (hazard markers, labels) is put under them.
    const controls = [{ x: w - 25.6, y: 25.6, r: 19 }, { x: w - 25.6, y: 62.4, r: 19 }];
    const hazards = drawQuakes(ctx, project, [...discs, ...controls], w, hgt);
    drawLabels(ctx, [...community.labels, ...hazards.labels],
      [...discs, ...controls, ...hazards.targets.map((d) => ({ x: d.x, y: d.y, r: d.r }))], w, hgt);
    drawn = [...hazards.targets, ...community.targets.filter((d) => !d.fan)];
    if (t < 1) requestAnimationFrame(() => map.draw()); else fadeFrom = 0;
  };

  const hitTest = (x, y) => {
    let best = null;
    for (const d of drawn) {
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd <= d.r + 3 && (!best || dd < best.dd)) best = { ...d, dd };
    }
    return best;
  };

  // ── Page ─────────────────────────────────────────────────────────────────
  put(clear(root),
    h("h1", { class: "s-h1", text: "Map" }),
    h("p", { class: "s-muted", text: "Where members work and what is gaining attention. Locations are only as precise as each member chose — most are rounded to about 11 km or 110 km — and hidden ones never appear." }),
    filters,
    timebar,
    h("div", { class: "s-map-layout" },
      h("div", { class: "s-map-wrap" }, canvas, h("div", { class: "s-map-zoom" }, zoomIn, zoomOut), status, hazardStatus, legend, listBox),
      panel));
  syncSliderText();
  syncFilters();

  map = createMap(canvas, {
    onView: (view) => { load(view); },
    onClick: ({ lon, lat, x, y }) => {
      const hit = hitTest(x, y);
      if (hit?.quake) { openQuake(hit.quake); return; }
      if (hit?.quakeGroup) { const [glon, glat] = map.unproject(hit.x, hit.y); map.setView(glon, glat, map.view.zoom * 2.5); return; }
      if (isInterest()) {
        if (!hit?.cells) return;
        if (hit.cells.length === 1) openCell(hit.cells[0]);
        else { const [glon, glat] = map.unproject(hit.x, hit.y); map.setView(glon, glat, map.view.zoom * 2.5); }
        return;
      }
      if (hit?.group) { const [glon, glat] = map.unproject(hit.x, hit.y); map.setView(glon, glat, map.view.zoom * 2.5); return; }
      if (hit?.point) { openPlace(hit.point.lat, hit.point.lon, hit.point); return; }
      openPlace(lat, lon, null);
    },
    onDraw,
  });
  zoomIn.addEventListener("click", () => map.zoomBy(1.6));
  zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.6));
  filters.addEventListener("change", (e) => {
    if (e.target === hazardBox) { syncHazards(); return; }
    if (e.target === mode) { delete panel.dataset.cell; syncFilters(); }
    reload();
  });
  filters.addEventListener("submit", (e) => { e.preventDefault(); reload(); });
  requestAnimationFrame(() => { reload(); if (hazardBox.checked) syncHazards(); });
  return () => { setPlaying(false); stopHazardPoll?.(); map.destroy(); };
}
