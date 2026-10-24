/**
 * #/map — who works where, and how to reach them.
 *
 * THE JOB OF THIS PAGE is to answer "who is working on this place?" quickly:
 * a full-width map showing the DISTRIBUTION of people (small discs sized by
 * how many distinct researchers work there), and beside it the LIST of those
 * people for whatever part of the world is on screen, each with a Message
 * button. Pan or zoom and the list follows the view; click a disc and it
 * narrows to that spot. "Find a place" jumps to any named study area.
 *
 * Markers are deliberately small (3-12 px): at world scale big discs merged
 * into blobs and hid the distribution they were meant to show. Overlaps are
 * resolved in screen space by declutter.js, never by drawing on top.
 *
 * "Posts & projects" is the second view: the content itself, as small dots.
 * "Live earthquakes" overlays the official USGS feed, labelled as such.
 * The panel carries the same content as text for keyboard and screen
 * readers: the canvas is a picture, the lists are the content.
 */
import * as api from "../api.js?v=20261024-c6fb513";
import { store } from "../store.js?v=20261024-c6fb513";
import { h, clear, input, select, errorBox, loading, put } from "../dom.js?v=20261024-c6fb513";
import { kindLabel, userChip, followButton, messageDialog, requireSignIn } from "../components.js?v=20261024-c6fb513";
import { createMap } from "../mapcore.js?v=20261024-c6fb513";
import { groupMarkers, placeLabels } from "../declutter.js?v=20261024-c6fb513";

const CYAN = [0, 212, 192];
const AMBER = [240, 176, 48];
const QUAKE = [255, 92, 92];
const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";

const KIND_COLOUR = {
  observation: "#ffd166", scene: "#7ad7ff", analysis: "#9aa8ff", monitor: "#9aa8ff", model: "#9aa8ff",
  dataset: "#8be28b", workflow: "#8be28b", repo: "#8be28b", paper: "#d8c4ff", question: "#ffffff",
  discussion: "#ffffff", event: "#ff9f7a", opportunity: "#ff9f7a", challenge: "#ff9f7a", project: "#35d6b8", text: "#cfd8e3",
};

/** Small on purpose: the distribution, not the dots, is the picture. */
const discR = (n) => Math.min(12, 3 + 1.8 * Math.sqrt(Math.max(1, n || 1)));
const placeText = (c) => c.place || `${Number(c.lat).toFixed(1)}°, ${Number(c.lon).toFixed(1)}°`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function render(root, { query }) {
  const mode = select("mode", [["people", "People"], ["posts", "Posts & projects"]], query.mode === "posts" ? "posts" : "people");
  mode.setAttribute("aria-label", "Show");
  const topic = input("topic", { value: query.tag || "", placeholder: "Topic, e.g. volcanology", "aria-label": "Filter by topic" });
  const find = input("find", { type: "search", placeholder: "Find a place…", "aria-label": "Find a place", list: "s-map-places", autocomplete: "off" });
  const placesList = h("datalist", { id: "s-map-places" });
  const quakesBox = h("input", { type: "checkbox", id: "s-map-quakes" });
  const canvas = h("canvas", { class: "s-mapfull-canvas", tabindex: "0", role: "img",
    "aria-label": "Map of where members work. Drag or arrow keys to pan, wheel or plus and minus to zoom; click a disc to see who is there." });
  const zoomIn = h("button", { type: "button", class: "s-icon-btn", "aria-label": "Zoom in" }, "+");
  const zoomOut = h("button", { type: "button", class: "s-icon-btn", "aria-label": "Zoom out" }, "−");
  const home = h("button", { type: "button", class: "s-icon-btn", "aria-label": "Whole world", title: "Whole world" }, "⌂");
  const status = h("p", { class: "s-mapfull-status", role: "status", "aria-live": "polite" });
  const panel = h("aside", { class: "s-mapfull-panel", "aria-label": "People and places in view" });

  const controls = h("div", { class: "s-mapfull-controls" },
    h("div", { class: "s-mapfull-find" }, find, placesList),
    mode, topic,
    h("label", { class: "s-check s-mapfull-quakes", for: "s-map-quakes" }, quakesBox, h("span", {}, "Live earthquakes (USGS)")));

  let interest = null;
  let content = { clusters: [], points: [] };
  let quakes = [];
  let drawn = [];
  let focusCell = null;        // a clicked disc narrows the list to that spot
  let seq = 0; let peopleSeq = 0;
  let map = null;
  const isPeople = () => mode.value === "people";
  const zOf = (zoom) => Math.max(0, Math.round(Math.log2(zoom)) + 1);
  const bboxText = (view) => view.bbox.map((v) => v.toFixed(3)).join(",");

  // ── Data ─────────────────────────────────────────────────────────────────
  const load = async (view) => {
    const my = ++seq;
    const tag = topic.value.trim().toLowerCase().replace(/^#/, "");
    status.textContent = "Loading…";
    try {
      if (isPeople()) {
        interest = await api.get("/v1/map/interest", { world: "earth", bbox: bboxText(view), z: zOf(view.zoom), tag });
        if (my !== seq) return;
        const n = interest?.researchers || 0;
        status.textContent = n ? `${plural(n, "researcher")} in view` : "Nobody has placed their work here yet";
      } else {
        const data = await api.get("/v1/map", { world: "earth", bbox: bboxText(view), z: zOf(view.zoom), tag });
        if (my !== seq) return;
        content = { clusters: data?.clusters || [], points: data?.points || [] };
        const n = content.points.length + content.clusters.reduce((s, c) => s + (c.count || 0), 0);
        status.textContent = n ? `${plural(n, "item")} in view` : "Nothing shared here yet";
      }
      map.draw();
      if (!focusCell) listForView(view);
    } catch (error) {
      if (my !== seq) return;
      status.textContent = error.message || "Could not load the map.";
    }
  };

  // Every named place, once, for "Find a place".
  const places = new Map();
  api.get("/v1/map/interest", { world: "earth", bbox: "-180,-90,180,90", z: 7 }).then((d) => {
    for (const c of d?.cells || []) if (c.place && !places.has(c.place.toLowerCase())) places.set(c.place.toLowerCase(), c);
    clear(placesList);
    for (const c of places.values()) put(placesList, h("option", { value: c.place }));
  }).catch(() => {});
  const goToPlace = () => {
    const want = find.value.trim().toLowerCase();
    if (!want) return;
    const hit = places.get(want) || [...places.values()].find((c) => c.place.toLowerCase().includes(want));
    if (!hit) { status.textContent = `No study area called “${find.value.trim()}” yet.`; return; }
    focusCell = null;
    map.setView(hit.lon, hit.lat, 12);
  };
  find.addEventListener("change", goToPlace);
  find.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); goToPlace(); } });

  const loadQuakes = async () => {
    if (!quakesBox.checked) { quakes = []; map.draw(); return; }
    try {
      const r = await fetch(USGS_FEED, { cache: "no-cache" });
      const j = await r.json();
      quakes = (j.features || []).map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], mag: f.properties.mag }))
        .filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.lon));
    } catch (error) { quakes = []; status.textContent = "The USGS feed could not be reached."; }
    map.draw();
  };
  quakesBox.addEventListener("change", loadQuakes);

  // ── The list: people in view, or at the clicked spot ────────────────────
  const contact = (user) => {
    const btn = h("button", { type: "button", class: "s-mini-act", title: `Message ${user.name || user.handle}` }, "Message");
    btn.addEventListener("click", () => (store.me
      ? messageDialog([user.handle], `Message ${user.name || "@" + user.handle}`, { stay: true })
      : requireSignIn("contact members")));
    return btn;
  };
  const personRow = (p) => h("li", { class: "s-person" },
    userChip(p.user),
    h("p", { class: "s-person-why", text: p.reasons.join(" · ") }),
    h("div", { class: "s-person-acts" }, contact(p.user),
      h("a", { class: "s-mini-act", href: `#/u/${encodeURIComponent(p.user.handle)}` }, "Profile")));

  const drawPeople = (title, sub, people, extra = null) => {
    clear(panel);
    put(panel,
      focusCell ? h("button", { type: "button", class: "s-linkish s-back", onClick: () => { focusCell = null; map.draw(); listForView({ ...map.view, bbox: map.bbox() }); } }, "← Everyone in view") : null,
      h("h2", { class: "s-mapfull-title", text: title }),
      sub ? h("p", { class: "s-muted s-mapfull-sub", text: sub }) : null,
      people.length ? h("ul", { class: "s-people" }, people.map(personRow))
        : h("p", { class: "s-muted", text: "Nobody here yet. Zoom out, or add your own study areas so others can find you." }),
      extra,
      h("p", { class: "s-fine" }, store.me
        ? h("span", {}, "You appear here through the study areas on ", h("a", { href: "#/me" }, "your profile"), ".")
        : "Members appear through the study areas on their profiles and what they share publicly."));
  };

  const listForView = async (view) => {
    const my = ++peopleSeq;
    if (!isPeople()) { drawPostsPanel(); return; }
    put(clear(panel), loading("Finding people…"));
    try {
      const d = await api.get("/v1/map/interest/people", { world: "earth", bbox: bboxText(view) });
      if (my !== peopleSeq) return;
      const people = d?.people || [];
      const top = (interest?.trending || []).slice(0, 3);
      drawPeople(people.length ? `${people.length} ${people.length === 1 ? "person" : "people"} working here` : "People in this view",
        "Pan or zoom to change the area. Click a disc to narrow to one spot.", people,
        top.length ? h("div", { class: "s-mapfull-trend" }, h("h3", { class: "s-side-title", text: "Busier this month" }),
          h("ul", { class: "s-plain" }, top.map((c) => h("li", {},
            h("button", { type: "button", class: "s-linkish", onClick: () => openCell(c, true) }, placeText(c)),
            h("span", { class: "s-muted", text: ` · ${plural(c.researchers, "researcher")}` }))))) : null);
    } catch (error) { if (my === peopleSeq) put(clear(panel), errorBox(error)); }
  };

  const openCell = async (c, fly = false) => {
    focusCell = c;
    peopleSeq += 1;
    if (fly) map.setView(c.lon, c.lat, Math.max(map.view.zoom, 10));
    put(clear(panel), loading());
    try {
      const d = await api.get("/v1/map/interest/cell", { world: "earth", s: c.cell.s, w: c.cell.w, size: c.cell.size });
      const sub = [plural(c.researchers, "researcher"), c.top_tags?.length ? c.top_tags.map((t) => `#${t}`).join(" ") : ""].filter(Boolean).join(" · ");
      drawPeople(placeText(c), sub, d?.people || [],
        store.me ? h("p", {}, followButton("place", `${Number(c.lat).toFixed(1)},${Number(c.lon).toFixed(1)}`, false, "this place")) : null);
    } catch (error) { put(clear(panel), errorBox(error)); }
  };

  const drawPostsPanel = () => {
    clear(panel);
    const pts = content.points.slice(0, 50);
    put(panel, h("h2", { class: "s-mapfull-title", text: "Posts & projects in view" }),
      pts.length ? h("ul", { class: "s-plain s-mapfull-items" }, pts.map((p) => h("li", {},
        h("span", { class: "s-dot", style: `background:${KIND_COLOUR[p.kind] || "#fff"}` }),
        h("a", { href: p.kind === "project" ? `#/p/${encodeURIComponent(p.id)}` : `#/post/${encodeURIComponent(p.id)}` }, p.title || kindLabel(p.kind)),
        p.author ? h("span", { class: "s-muted", text: ` · @${p.author.handle}` }) : null)))
        : h("p", { class: "s-muted", text: content.clusters.length ? "Zoom in to see individual items." : "Nothing shared here yet." }));
  };

  // ── Drawing ──────────────────────────────────────────────────────────────
  const disc = (ctx, x, y, r, colour) => {
    ctx.fillStyle = rgba(colour, 0.55);
    ctx.strokeStyle = rgba(colour, 0.95);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  };

  const drawInterest = (ctx, project, w, hgt) => {
    const items = (interest?.cells || []).map((c) => { const [x, y] = project(c.lon, c.lat); return { x, y, weight: c.researchers, cell: c }; });
    const groups = groupMarkers(items, { gap: 2, radiusOf: (g) => discR(g.weight) });
    drawn = groups.map((g) => {
      const cells = g.members.map((m) => m.cell);
      const lead = cells.reduce((a, b) => (b.researchers > a.researchers ? b : a));
      return { ...g, cells, lead, colour: cells.some((c) => c.trend !== "steady") ? AMBER : CYAN };
    });
    for (const g of drawn) {
      disc(ctx, g.x, g.y, g.r, g.colour);
      if (focusCell && g.cells.includes(focusCell)) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(g.x, g.y, g.r + 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Quiet name labels for the busiest places, only where there is room.
    ctx.font = "600 10px 'Public Sans', system-ui, sans-serif";
    const wanted = drawn.slice(0, 10).map((g) => {
      const text = `${placeText(g.lead)} · ${g.weight}`;
      return { x: g.x, y: g.y, r: g.r, w: ctx.measureText(text).width + 10, h: 15, text };
    });
    for (const l of placeLabels(wanted, drawn.map((g) => ({ x: g.x, y: g.y, r: g.r })), { bounds: { x: 4, y: 4, w: w - 8, h: hgt - 8 } })) {
      const { x, y, w: bw, h: bh } = l.box;
      ctx.fillStyle = "rgba(4, 8, 22, 0.78)"; ctx.beginPath(); ctx.roundRect(x, y, bw, bh, 4); ctx.fill();
      ctx.fillStyle = "rgba(230, 240, 255, 0.92)"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(l.text, x + 5, y + bh / 2 + 0.5);
    }
  };

  const drawPosts = (ctx, project) => {
    const items = [
      ...content.points.map((p) => { const [x, y] = project(p.lon, p.lat); return { x, y, weight: 1, point: p }; }),
      ...content.clusters.map((c) => { const [x, y] = project(c.lon, c.lat); return { x, y, weight: c.count, cluster: c }; }),
    ];
    const groups = groupMarkers(items, { gap: 2, radiusOf: (g) => (g.weight > 1 ? discR(g.weight) : 3.5) });
    drawn = groups.map((g) => ({ ...g, point: g.members.length === 1 ? g.members[0].point : null }));
    for (const g of drawn) {
      if (g.point) {
        ctx.fillStyle = KIND_COLOUR[g.point.kind] || "#fff"; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(g.x, g.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        disc(ctx, g.x, g.y, g.r, CYAN);
      }
    }
  };

  const drawQuakes = (ctx, project) => {
    ctx.strokeStyle = rgba(QUAKE, 0.8); ctx.lineWidth = 1;
    for (const q of quakes) {
      const [x, y] = project(q.lon, q.lat);
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, (q.mag - 2) * 1.2), 0, Math.PI * 2); ctx.stroke();
    }
  };

  const hitTest = (x, y) => {
    let best = null;
    for (const d of drawn) {
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd <= d.r + 4 && (!best || dd < best.dd)) best = { ...d, dd };
    }
    return best;
  };

  // ── Page ─────────────────────────────────────────────────────────────────
  const legend = h("p", { class: "s-mapfull-legend" },
    h("span", { class: "s-dot", style: `background:${rgba(CYAN, 0.9)}` }), " people working there  ",
    h("span", { class: "s-dot", style: `background:${rgba(AMBER, 0.9)}` }), " busier this month  ",
    h("span", { class: "s-dot s-dot-ring", style: `border-color:${rgba(QUAKE, 0.9)}` }), " USGS earthquake (when shown)");

  put(clear(root),
    h("h1", { class: "s-visually-hidden", text: "Map" }),
    h("div", { class: "s-mapfull" },
      h("div", { class: "s-mapfull-stage" },
        canvas,
        controls,
        h("div", { class: "s-mapfull-zoom" }, zoomIn, zoomOut, home),
        h("div", { class: "s-mapfull-foot" }, status, legend)),
      panel));

  map = createMap(canvas, {
    fill: true,
    onView: (view) => { load(view); },
    onClick: ({ x, y }) => {
      const hit = hitTest(x, y);
      if (!hit) return;
      if (isPeople()) {
        if (hit.cells.length === 1) openCell(hit.cells[0]);
        else { const [lon, lat] = map.unproject(hit.x, hit.y); map.setView(lon, lat, map.view.zoom * 2.5); }
        map.draw();
        return;
      }
      if (hit.point) location.hash = hit.point.kind === "project" ? `#/p/${encodeURIComponent(hit.point.id)}` : `#/post/${encodeURIComponent(hit.point.id)}`;
      else { const [lon, lat] = map.unproject(hit.x, hit.y); map.setView(lon, lat, map.view.zoom * 2.5); }
    },
    onDraw: (ctx, { project, w, h: hgt }) => {
      if (isPeople()) drawInterest(ctx, project, w, hgt); else drawPosts(ctx, project);
      if (quakes.length) drawQuakes(ctx, project);
    },
  });
  zoomIn.addEventListener("click", () => map.zoomBy(1.6));
  zoomOut.addEventListener("click", () => map.zoomBy(1 / 1.6));
  home.addEventListener("click", () => { focusCell = null; map.setView(0, 15, 1); });
  mode.addEventListener("change", () => { focusCell = null; load({ ...map.view, bbox: map.bbox() }); });
  topic.addEventListener("change", () => { focusCell = null; load({ ...map.view, bbox: map.bbox() }); });
  requestAnimationFrame(() => load({ ...map.view, bbox: map.bbox() }));
  return () => map.destroy();
}
