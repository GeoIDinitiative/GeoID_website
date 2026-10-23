/**
 * #/map — where the community works, in two modes.
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
 * Nothing overlaps: markers, fans and discs are grouped in screen space for
 * the zoom being drawn (declutter.js), and labels are placed only where free.
 * The list under the canvas carries the same content for keyboard and screen
 * reader use: the canvas is a picture, the list is the content.
 */
import * as api from "../api.js";
import { store } from "../store.js";
import { h, clear, field, input, select, errorBox, loading, dateToEpoch, put } from "../dom.js";
import { KINDS, kindLabel, userRow, postCard, followButton } from "../components.js";
import { createMap } from "../mapcore.js";
import { groupMarkers, fanOut, groupRadius, placeLabels, FAN_MAX } from "../declutter.js";

// The hero tile's two marker colours: cyan for steady, amber for live/rising.
const CYAN = [0, 212, 192];
const AMBER = [240, 176, 48];
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

const KIND_COLOUR = {
  observation: "#ffd166", scene: "#7ad7ff", analysis: "#9aa8ff", monitor: "#9aa8ff", dataset: "#8be28b", workflow: "#8be28b",
  model: "#9aa8ff", repo: "#8be28b", paper: "#d8c4ff", question: "#ffffff", discussion: "#ffffff", event: "#ff9f7a",
  opportunity: "#ff9f7a", challenge: "#ff9f7a", project: "#35d6b8", text: "#cfd8e3",
};

const TREND_TEXT = { new: "New activity", rising: "Rising", steady: "Steady" };
const bubbleR = (n) => 9 + Math.min(18, Math.log2((n || 1) + 1) * 3);
const cellR = (researchers) => Math.min(30, 5 + 3.2 * Math.sqrt(researchers || 1));
const placeText = (c, more = c.places_more || 0) =>
  `${c.place || `${Number(c.lat).toFixed(1)}°, ${Number(c.lon).toFixed(1)}°`}${more ? ` +${more}` : ""}`;

export function render(root, { query }) {
  const mode = select("mode", [["interest", "Study interest"], ["posts", "Posts & projects"]], query.mode || "interest");
  const kind = select("kinds", [["", "All kinds"], ["project", "Projects"], ...Object.keys(KINDS).map((k) => [k, kindLabel(k)])], query.kinds || "");
  const since = input("since", { type: "date", value: query.since || "" });
  const tag = input("tag", { value: query.tag || "", placeholder: "e.g. volcanology" });
  const layer = select("layer", [["public", "Public"], ["mine", "Mine"], ["teams", "My teams"]], query.layer || "public");
  if (!store.me) { [...layer.options].forEach((o) => { if (o.value !== "public") o.disabled = true; }); }
  const postFields = [field("Kind", kind), field("Since", since), field("Layer", layer, store.me ? "" : "Sign in to see your own and your teams' items.")];
  const filters = h("form", { class: "s-filters", "aria-label": "Map filters" }, field("Show", mode), field("Topic", tag), ...postFields);
  const canvas = h("canvas", { class: "s-map", tabindex: "0", role: "img",
    "aria-label": "Map of where community members work. Drag or use arrow keys to pan, mouse wheel or plus and minus to zoom, click a disc or marker for details." });
  const zoomIn = h("button", { type: "button", class: "s-icon-btn", "aria-label": "Zoom in" }, "+");
  const zoomOut = h("button", { type: "button", class: "s-icon-btn", "aria-label": "Zoom out" }, "−");
  const status = h("p", { class: "s-hint", role: "status", "aria-live": "polite" });
  const panel = h("aside", { class: "s-side s-place-panel", "aria-live": "polite" });
  const listBox = h("details", { class: "s-map-list" }, h("summary", {}, "What is in view, as a list"), h("ul", { class: "s-plain" }));
  const legend = h("ul", { class: "s-legend", "aria-label": "Legend" });

  let interest = null;               // /v1/map/interest response
  let content = { clusters: [], points: [] };
  let drawn = [];                    // hit targets from the last draw
  let seq = 0;
  let map = null;
  const isInterest = () => mode.value === "interest";

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
  };

  const syncFilters = () => { postFields.forEach((f) => { f.hidden = isInterest(); }); drawLegend(); };

  // ── Loading ──────────────────────────────────────────────────────────────
  const load = async (view) => {
    const my = ++seq;
    const z = Math.max(0, Math.round(Math.log2(view.zoom)) + 1);
    const bbox = view.bbox.map((v) => v.toFixed(3)).join(",");
    status.textContent = "Loading…";
    try {
      if (isInterest()) {
        const data = await api.get("/v1/map/interest", { world: "earth", bbox, z, tag: tag.value.trim().toLowerCase() });
        if (my !== seq) return;
        interest = data;
        const n = data?.researchers || 0;
        status.textContent = n ? `${n} researcher${n === 1 ? "" : "s"} working in this view.` : "Nobody has shared a study area or a located post here yet.";
        if (!panel.dataset.cell) drawOverview();
      } else {
        const data = await api.get("/v1/map", {
          world: "earth", bbox, z, kinds: kind.value, since: dateToEpoch(since.value),
          tag: tag.value.trim().toLowerCase(), layer: layer.value,
        });
        if (my !== seq) return;
        content = { clusters: data?.clusters || [], points: data?.points || [] };
        const n = content.points.length + content.clusters.reduce((s, c) => s + (c.count || 0), 0);
        status.textContent = n ? `${n} item${n === 1 ? "" : "s"} in view.` : "Nothing in view with these filters.";
        if (!panel.dataset.cell) drawPostsHint();
      }
      drawList();
      map.draw();
    } catch (error) {
      if (my !== seq) return;
      status.textContent = error.message || "Could not load the map.";
    }
  };

  // ── Panels ───────────────────────────────────────────────────────────────
  const studyAreaCta = () => (store.me
    ? h("p", { class: "s-hint" }, "Your study areas put you on this map. ", h("a", { href: "#/me" }, "Add or edit yours"), ".")
    : h("p", { class: "s-hint", text: "Members appear here through the study areas on their profiles and what they share publicly." }));

  const drawOverview = () => {
    delete panel.dataset.cell;
    clear(panel);
    const cells = interest?.cells || [];
    put(panel, h("h2", { class: "s-side-title", text: "Trending study areas" }));
    const trending = interest?.trending || [];
    if (!trending.length) put(panel, h("p", { class: "s-muted", text: "Nothing is rising in this view in the last 30 days." }));
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

  const drawList = () => {
    const ul = listBox.querySelector("ul");
    clear(ul);
    if (isInterest()) {
      (interest?.cells || []).slice(0, 200).forEach((c) => put(ul, h("li", {},
        h("button", { type: "button", class: "s-linkish", onClick: () => openCell(c) }, placeText(c)),
        h("span", { class: "s-muted", text: ` — ${c.researchers} researcher${c.researchers === 1 ? "" : "s"}, ${TREND_TEXT[c.trend].toLowerCase()}${c.top_tags?.length ? `, ${c.top_tags.join(", ")}` : ""}` }))));
      return;
    }
    content.points.slice(0, 300).forEach((p) => put(ul, h("li", {},
      h("a", { href: p.kind === "project" ? `#/p/${encodeURIComponent(p.id)}` : `#/post/${encodeURIComponent(p.id)}` }, p.title || kindLabel(p.kind)),
      h("span", { class: "s-muted" }, ` — ${kindLabel(p.kind)}, ${Number(p.lat).toFixed(1)}, ${Number(p.lon).toFixed(1)}${p.precision && p.precision !== "exact" ? ` (${p.precision})` : ""}`))));
    content.clusters.forEach((c) => put(ul, h("li", { class: "s-muted", text: `A group of ${c.count} near ${Number(c.lat).toFixed(1)}, ${Number(c.lon).toFixed(1)} — zoom in to see them.` })));
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

  /** Pill labels, hero-tile style: solid colour, dark text, only where free. */
  const drawLabels = (ctx, groups, w, hgt) => {
    ctx.font = "700 11px 'Public Sans', system-ui, sans-serif";
    const wanted = groups.slice(0, 14).map((g) => {
      const text = `${g.label}`;
      return { x: g.x, y: g.y, r: g.r, w: ctx.measureText(text).width + 16, h: 18, text, colour: g.colour };
    }).filter((l) => l.text);
    const placed = placeLabels(wanted, groups.map((g) => ({ x: g.x, y: g.y, r: g.r })), { bounds: { x: 4, y: 4, w: w - 8, h: hgt - 8 } });
    for (const l of placed) {
      const { x, y, w: bw, h: bh } = l.box;
      ctx.fillStyle = rgba(l.colour, 0.9);
      ctx.beginPath(); ctx.roundRect(x, y, bw, bh, bh / 2); ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.82)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(l.text, x + bw / 2, y + bh / 2 + 0.5);
    }
  };

  const drawInterest = (ctx, project, w, hgt) => {
    const items = (interest?.cells || []).map((c) => {
      const [x, y] = project(c.lon, c.lat);
      return { x, y, weight: c.researchers, cell: c };
    });
    const groups = groupMarkers(items, { gap: 4, radiusOf: (g) => cellR(g.weight) });
    drawn = groups.map((g) => {
      const cells = g.members.map((m) => m.cell);
      const hot = cells.some((c) => c.trend !== "steady");
      const lead = cells.reduce((a, b) => (b.researchers > a.researchers ? b : a));
      // A disc that merged several cells names its biggest and counts the rest.
      const more = cells.reduce((n, c) => n + (c.places_more || 0) + (c.place ? 1 : 0), 0) - (lead.place ? 1 : 0);
      return { ...g, cells, colour: hot ? AMBER : CYAN, label: `${placeText(lead, Math.max(0, more))} · ${g.weight}` };
    });
    for (const g of drawn) {
      glowDisc(ctx, g.x, g.y, g.r, g.colour, 0.32);
      if (g.r >= 11) {
        ctx.fillStyle = "#fff"; ctx.font = "700 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(g.weight), g.x, g.y + 0.5);
      }
    }
    drawLabels(ctx, drawn, w, hgt);
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
    drawn = [];
    for (const g of groups) {
      const onlyPoints = g.members.every((m) => m.point);
      if (onlyPoints && g.members.length === 1) {
        const p = g.members[0].point;
        drawPoint(ctx, g.x, g.y, p);
        drawn.push({ x: g.x, y: g.y, r: 8, point: p });
      } else if (onlyPoints && g.members.length <= FAN_MAX) {
        // Fan out round the group's centre; a spoke points back to where
        // each item really is (often the same rounded spot for all of them).
        const spots = fanOut(g.x, g.y, g.members.length, 14);
        ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1;
        g.members.forEach((m, i) => { ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(spots[i].x, spots[i].y); ctx.stroke(); });
        ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.arc(g.x, g.y, 2, 0, Math.PI * 2); ctx.fill();
        g.members.forEach((m, i) => {
          drawPoint(ctx, spots[i].x, spots[i].y, m.point);
          drawn.push({ x: spots[i].x, y: spots[i].y, r: 8, point: m.point });
        });
      } else {
        const r = bubbleR(g.weight);
        glowDisc(ctx, g.x, g.y, r, CYAN, 0.25);
        ctx.fillStyle = "#fff"; ctx.font = "700 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(g.weight), g.x, g.y + 0.5);
        drawn.push({ x: g.x, y: g.y, r, group: g });
      }
    }
  };

  const drawPoint = (ctx, x, y, p) => {
    ctx.fillStyle = KIND_COLOUR[p.kind] || "#fff";
    ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (p.kind === "project") ctx.rect(x - 5, y - 5, 10, 10); else ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
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
    h("div", { class: "s-map-layout" },
      h("div", { class: "s-map-wrap" }, canvas, h("div", { class: "s-map-zoom" }, zoomIn, zoomOut), status, legend, listBox),
      panel));
  syncFilters();

  map = createMap(canvas, {
    onView: load,
    onClick: ({ lon, lat, x, y }) => {
      const hit = hitTest(x, y);
      if (isInterest()) {
        if (!hit) return;
        if (hit.cells.length === 1) openCell(hit.cells[0]);
        else { const [glon, glat] = map.unproject(hit.x, hit.y); map.setView(glon, glat, map.view.zoom * 2.5); }
        return;
      }
      if (hit?.group) { const [glon, glat] = map.unproject(hit.x, hit.y); map.setView(glon, glat, map.view.zoom * 2.5); return; }
      if (hit?.point) { openPlace(hit.point.lat, hit.point.lon, hit.point); return; }
      openPlace(lat, lon, null);
    },
    onDraw: (ctx, { project, w, h: hgt }) => (isInterest() ? drawInterest(ctx, project, w, hgt) : drawPosts(ctx, project)),
  });
  zoomIn.addEventListener("click", () => map.zoomBy(1.6));
  zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.6));
  filters.addEventListener("change", (e) => {
    if (e.target === mode) { delete panel.dataset.cell; syncFilters(); }
    load({ ...map.view, bbox: map.bbox() });
  });
  filters.addEventListener("submit", (e) => { e.preventDefault(); load({ ...map.view, bbox: map.bbox() }); });
  requestAnimationFrame(() => load({ ...map.view, bbox: map.bbox() }));
  return () => map.destroy();
}
