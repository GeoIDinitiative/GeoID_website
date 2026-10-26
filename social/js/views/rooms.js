/**
 * #/rooms and #/room/:id -- event rooms (rooms.js in the Worker): one for
 * each significant earthquake, eruption, flood, cyclone, wildfire or drought,
 * opened from the USGS and GDACS feeds.
 *
 * A room is the feed's facts (credited and linked), a map, Earth Flight over
 * the place, the members who study the area, papers about the place and the
 * hazard, and the room's own thread: observations, analyses and questions
 * members post into it.
 */
import * as api from "../api.js?v=20261026-b97ef24";
import { store } from "../store.js?v=20261026-b97ef24";
import { h, put, clear, loading, errorBox, empty, timeEl, extLink, dateText } from "../dom.js?v=20261026-b97ef24";
import { postCard, pagedList, followButton, userChip } from "../components.js?v=20261026-b97ef24";
import { createMap } from "../mapcore.js?v=20261026-b97ef24";

export const ROOM_LABEL = { earthquake: "Earthquake", cyclone: "Tropical cyclone", flood: "Flood", volcano: "Volcano",
  wildfire: "Wildfire", drought: "Drought" };

const ago = (s) => {
  const d = Math.max(0, Date.now() / 1000 - s);
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
};

/** The field each kind of room belongs to: its colour and edge glow are the Network's topic ones (topics.js). */
const ROOM_TOPIC = {
  earthquake: { label: "Seismology", rgb: "255, 184, 64" }, volcano: { label: "Volcanology", rgb: "255, 92, 56" },
  flood: { label: "Hydrology", rgb: "70, 150, 255" }, drought: { label: "Hydrology", rgb: "70, 150, 255" },
  cyclone: { label: "Atmosphere", rgb: "180, 130, 255" }, wildfire: { label: "Wildfire", rgb: "255, 140, 40" },
};

/** "M 6.5 - Bonin Islands, Japan region" -> the place; the magnitude is shown on its own. */
const roomTitle = (r) => (r.kind === "earthquake" ? r.title.replace(/^M\s*[\d.]+\s*-\s*/i, "") : r.title);
/** The one number that says how big: "M 6.5", "194 km/h", else the feed's words, short. */
function roomFigure(r) {
  if (r.kind === "earthquake") return r.severity;
  const wind = /(\d+)\s*km\/h/.exec(r.severity || "");
  if (wind) return `${wind[1]} km/h`;
  return "";
}

/** A room as a Network card: the field's glowing edge, labels, the place, how big, how fresh. */
export function roomChip(r, { compact = false } = {}) {
  const topic = ROOM_TOPIC[r.kind] || { label: ROOM_LABEL[r.kind] || r.kind, rgb: "154, 168, 255" };
  const figure = roomFigure(r);
  const alert = ["orange", "red"].includes(r.alert) ? r.alert : "";
  const card = h("article", { class: `s-card s-post-card s-room-card${compact ? " is-compact" : ""}`, "data-topic": r.kind, "aria-labelledby": `rt-${r.id}` },
    h("div", { class: "s-room-card-top" },
      h("div", { class: "s-labels" },
        h("span", { class: "s-kind", text: ROOM_LABEL[r.kind] || r.kind }),
        h("span", { class: "s-topic", text: topic.label }),
        alert ? h("span", { class: `s-alert s-alert-${alert}`, text: `${alert[0].toUpperCase()}${alert.slice(1)} alert` }) : null),
      figure ? h("span", { class: "s-room-figure", text: figure }) : null),
    h("h3", { class: "s-card-title", id: `rt-${r.id}` }, h("a", { href: `#/room/${encodeURIComponent(r.id)}` }, roomTitle(r))),
    compact || !r.place || r.place === roomTitle(r) ? null : h("p", { class: "s-card-body", text: r.place }),
    h("footer", { class: "s-card-foot s-room-foot" },
      h("span", {}, r.status === "archived" ? "Archived" : h("span", { class: "s-room-open", text: "Open" }), ` · began ${ago(r.started_at)}`),
      h("span", { class: "s-muted", text: r.posts ? `${r.posts} post${r.posts === 1 ? "" : "s"}` : "No posts yet" })));
  card.style.setProperty("--topic-rgb", topic.rgb);
  return card;
}

/** The feed's "Happening now" strip: active rooms, newest first. Nothing at all when there are none. */
export function happeningNow() {
  const box = h("section", { class: "s-now", "aria-label": "Happening now", hidden: true });
  api.get("/v1/rooms", { limit: 8 }).then((d) => {
    const items = d?.items || [];
    if (!items.length) return;
    put(box, h("div", { class: "s-now-head" }, h("h2", { class: "s-h3", text: "Happening now" }), h("a", { href: "#/rooms" }, "All event rooms")),
      h("div", { class: "s-now-row" }, items.slice(0, 4).map((r) => roomChip(r, { compact: true }))));
    box.hidden = false;
  }).catch(() => {});
  return box;
}

export function renderList(root, { query }) {
  const archived = query.status === "archived";
  const tab = (on, href, label) => h("a", { href, class: on ? "is-active" : "", "aria-current": on ? "page" : null }, label);
  const list = h("div", { class: "s-room-list" }, loading());
  put(clear(root),
    h("h1", { class: "s-h1", text: "Event rooms" }),
    h("p", { class: "s-muted", text: "When the Earth does something significant, a room opens for it: the facts, a map, the people who study the area, the papers, and what members see and work out." }),
    h("nav", { class: "s-tabs", "aria-label": "Rooms" }, tab(!archived, "#/rooms", "Open"), tab(archived, "#/rooms?status=archived", "Archive")),
    list);
  api.get("/v1/rooms", { status: archived ? "archived" : "active", limit: 50 }).then((d) => {
    const items = d?.items || [];
    put(clear(list), items.length ? items.map((r) => roomChip(r)) : empty(archived ? "No archived rooms yet." : "Nothing significant right now.",
      archived ? "" : "Rooms open by themselves for significant earthquakes, and for orange and red alerts on cyclones, floods, volcanoes, wildfires and droughts."));
  }).catch((error) => put(clear(list), errorBox(error)));
}

export async function renderOne(root, { params }) {
  put(clear(root), loading());
  let r;
  try { r = await api.get(`/v1/rooms/${encodeURIComponent(params.id)}`); } catch (error) {
    put(clear(root), errorBox(error)); return undefined;
  }
  document.title = `${r.title} — GeoID Network`;
  const d = r.data || {};
  const facts = [
    ["What", ROOM_LABEL[r.kind] || r.kind],
    r.severity ? ["Severity", r.severity] : null,
    r.kind === "earthquake" && d.depth_km != null ? ["Depth", `${Math.round(d.depth_km)} km`] : null,
    r.alert ? ["Alert", `${r.alert[0].toUpperCase()}${r.alert.slice(1)}${r.source === "usgs" ? " (USGS PAGER)" : r.source === "gdacs" ? " (GDACS)" : ""}`] : null,
    d.tsunami ? ["Tsunami", "The USGS flags a tsunami possibility"] : null,
    d.felt ? ["Felt reports", String(d.felt)] : null,
    ["Began", dateText(r.started_at, true)],
    r.place ? ["Where", r.place] : null,
  ].filter(Boolean);
  const canvas = h("canvas", { class: "s-room-map", tabindex: "0", "aria-label": `Map of ${r.place || r.title}` });
  const flyHref = r.lat != null ? `/?flight=earth&lat=${r.lat.toFixed(4)}&lon=${r.lon.toFixed(4)}` : "";
  const papers = h("div", {}, loading("Finding papers…"));
  const actions = h("div", { class: "s-actions" },
    h("a", { class: "btn-primary", href: `#/compose?kind=observation&room=${encodeURIComponent(r.id)}` }, "Post an observation"),
    h("a", { class: "btn-ghost", href: `#/compose?kind=analysis&room=${encodeURIComponent(r.id)}` }, "Post an analysis"),
    h("a", { class: "btn-ghost", href: `#/compose?kind=question&room=${encodeURIComponent(r.id)}` }, "Ask a question"),
    store.me ? followButton("room", r.id, r.viewer?.following, "room") : null);

  put(clear(root),
    h("header", { class: `s-room-head s-room-${r.kind} s-head-alert-${r.alert || "none"}` },
      h("p", { class: "s-labels" },
        h("span", { class: "s-kind", text: ROOM_LABEL[r.kind] || r.kind }),
        r.status === "archived" ? h("span", { class: "s-vis", text: "Archived" }) : h("span", { class: "s-room-open", text: "Open" })),
      h("h1", { class: "s-h1", text: r.title }),
      h("p", { class: "s-muted" }, `${r.posts || 0} post${r.posts === 1 ? "" : "s"} from ${r.contributors || 0} member${r.contributors === 1 ? "" : "s"} · data: `,
        r.source_url ? extLink(r.source_url, r.credit) : r.credit),
      actions),
    h("div", { class: "s-grid-main s-room-grid" },
      h("div", {},
        h("section", { class: "s-section", "aria-labelledby": "rt-h" },
          h("h2", { class: "s-h2", id: "rt-h", text: "In this room" }),
          pagedList((cursor) => api.get("/v1/feed", { tab: "all", room: r.id, cursor }), postCard,
            { emptyTitle: "Nobody has posted yet.", emptyDetail: "An observation from the ground, a first analysis, a question for people who know the area: each one helps." }))),
      h("aside", { class: "s-side s-room-side" },
        h("section", { class: "s-room-facts" }, canvas,
          h("dl", { class: "s-dl" }, facts.map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])),
          flyHref ? h("a", { class: "btn-ghost s-btn-sm s-fly", href: flyHref }, "Fly over it in GeoHUB") : null),
        h("section", { class: "s-section", "aria-labelledby": "rp-h" },
          h("h2", { class: "s-h3", id: "rp-h", text: "People who study the area" }),
          (r.people_near || []).length
            ? h("ul", { class: "s-rows" }, r.people_near.map((p) => h("li", { class: "s-row" }, userChip(p.user),
              h("span", { class: "s-muted", text: `${p.area} · ${p.km} km` }))))
            : h("p", { class: "s-muted", text: "No members have a study area within 500 km yet." })),
        h("section", { class: "s-section", "aria-labelledby": "rpa-h" },
          h("h2", { class: "s-h3", id: "rpa-h", text: "Papers" }), papers))));

  api.get(`/v1/rooms/${encodeURIComponent(r.id)}/papers`).then((pd) => {
    const items = pd?.items || [];
    put(clear(papers), items.length ? h("ol", { class: "s-papers" }, items.map((p) => h("li", {},
      h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer" }, p.title),
      h("span", { class: "s-muted", text: ` ${p.authors.join(", ")}${p.more_authors ? " et al." : ""}${p.year ? ` (${p.year})` : ""}${p.venue ? `, ${p.venue}` : ""}` }))))
      : h("p", { class: "s-muted", text: "No papers found for this place yet." }),
      h("p", { class: "s-hint", text: "From OpenAlex, by place and hazard." }));
  }).catch(() => put(clear(papers), h("p", { class: "s-muted", text: "Papers didn't load." })));

  if (r.lat == null) { canvas.remove(); return undefined; }
  const map = createMap(canvas, {
    minZoom: 1,
    onDraw: (ctx, { project }) => {
      const [x, y] = project(r.lon, r.lat);
      ctx.fillStyle = "rgba(255, 80, 80, 0.25)";
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff5d5d"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    },
  });
  map.setView(r.lon, r.lat, 6);
  return () => map.destroy();
}
