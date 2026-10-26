/**
 * Event rooms: when the Earth does something significant, the Network opens
 * a room for it.
 *
 * WHERE ROOMS COME FROM. The 15-minute cron reads two public feeds:
 *   - USGS's "significant earthquakes" (the USGS's own test: magnitude, felt
 *     reports, PAGER alert), and
 *   - GDACS (the UN/EC Global Disaster Alert and Coordination System), for
 *     orange and red alerts on cyclones, floods, volcanoes and wildfires that
 *     are still going, and red droughts.
 * One room per event (source + its id), kept up to date while the feed lists
 * it, archived a fortnight after the feed last changed it. An admin can open
 * one by hand for anything the feeds miss.
 *
 * WHAT A ROOM IS. The facts the feed gave (credited and linked), a map, the
 * posts members make into it (observations with provenance, analyses,
 * questions -- posts.room_id), the members who study the area (study areas,
 * on_map only), and papers about the place and the hazard (OpenAlex, read
 * once and cached). Members near it, or who follow the hazard's field, are
 * told when it opens.
 */
import { now, str, id, fail, requireUser, currentUser, isAdmin, readJson, int, parse, url, notify, usersById } from "./lib.js";
import { all, one, run } from "./collab.js";

const DAY = 86400;
const ARCHIVE_AFTER = 14 * DAY;
const UA = "Mozilla/5.0 (compatible; GeoIDNetworkBot/1.0; +https://geoidinitiative.com/social/)";
export const USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson";
export const GDACS_FEED = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;FL;VO;WF;DR&alertlevel=Orange;Red";
export const ROOM_KINDS = ["earthquake", "cyclone", "flood", "volcano", "wildfire", "drought"];
const GDACS_KIND = { TC: "cyclone", FL: "flood", VO: "volcano", WF: "wildfire", DR: "drought" };
// The tag a room's field goes by, for "follows the field" notifications.
export const ROOM_TAG = { earthquake: "seismology", volcano: "volcanology", flood: "hydrology", cyclone: "meteorology",
  wildfire: "wildfire", drought: "hydrology" };
const NEAR_KM = 500;
const MAX_TOLD = 200;

// ── Reading the feeds ───────────────────────────────────────────────────────

/** A USGS GeoJSON feature as a room. */
export function fromUsgs(f) {
  const p = f?.properties || {};
  const [lon, lat] = f?.geometry?.coordinates || [];
  if (!f?.id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const mag = Number(p.mag);
  return {
    source: "usgs", source_id: String(f.id), kind: "earthquake",
    title: str(p.title || `M ${mag} earthquake`, 200),
    place: str(p.place, 200), lat, lon,
    severity: Number.isFinite(mag) ? `M ${mag.toFixed(1)}` : "",
    alert: str(p.alert || "", 10),
    source_url: url(p.url) || "",
    started_at: Math.floor(Number(p.time) / 1000) || now(),
    updated_at: Math.floor(Number(p.updated || p.time) / 1000) || now(),
    data: { magnitude: mag, depth_km: f.geometry.coordinates[2] ?? null, tsunami: !!p.tsunami, felt: p.felt ?? null,
      mmi: p.mmi ?? null, pager: p.alert || null, significance: p.sig ?? null },
  };
}

/** A GDACS feature as a room, or null when it is not one we open (finished, or a drought below red). */
export function fromGdacs(f, t = now()) {
  const p = f?.properties || {};
  const kind = GDACS_KIND[p.eventtype];
  if (!kind) return null;
  const level = String(p.alertlevel || "").toLowerCase();
  if (kind === "drought" && level !== "red") return null;
  const until = Date.parse(p.todate) / 1000;
  // Still going: the feed's own "current" flag, or an episode within three days.
  if (!(String(p.iscurrent) === "true" || (Number.isFinite(until) && until > t - 3 * DAY))) return null;
  const [lon, lat] = f?.geometry?.coordinates || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const report = typeof p.url === "object" ? p.url?.report : p.url;
  return {
    source: "gdacs", source_id: `${p.eventtype}-${p.eventid}`, kind,
    title: str(p.name || p.eventname || `${kind} event`, 200),
    place: str(p.country, 200), lat, lon,
    severity: str(p.severitydata?.severitytext || "", 200),
    alert: level,
    source_url: url(report) || "",
    started_at: Math.floor(Date.parse(p.fromdate) / 1000) || t,
    updated_at: Math.floor(Date.parse(p.datemodified || p.todate) / 1000) || t,
    data: { alert_score: p.alertscore ?? null, countries: str(p.country, 400), episode: p.episodeid ?? null,
      until: Number.isFinite(until) ? Math.floor(until) : null, glide: p.glide || null },
  };
}

async function getJson(fetcher, u) {
  const r = await fetcher(u, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** km between two points (haversine). */
export function km(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Study areas within `radius` km of a point: [{user_id, name, distance}] nearest first. */
async function areasNear(env, lat, lon, radius) {
  const dLat = radius / 111;
  const dLon = radius / (111 * Math.max(0.15, Math.cos(lat * Math.PI / 180)));
  const rows = await all(env,
    `SELECT s.user_id, s.name, s.lat, s.lon FROM study_areas s JOIN users u ON u.id = s.user_id
      WHERE s.world = 'earth' AND s.on_map = 1 AND u.suspended_until < ? AND u.email NOT LIKE 'erased:%'
        AND s.lat BETWEEN ? AND ? AND ((s.lon BETWEEN ? AND ?) OR ? > 180 OR ? < -180)`,
    now(), lat - dLat, lat + dLat, lon - dLon, lon + dLon, lon + dLon, lon - dLon);
  return rows.map((r) => ({ ...r, distance: km(lat, lon, r.lat, r.lon) }))
    .filter((r) => r.distance <= radius).sort((a, b) => a.distance - b.distance);
}

/** Tell members who study the area, or follow the field, that a room opened. */
async function announceRoom(env, room) {
  const told = new Set();
  for (const a of await areasNear(env, room.lat, room.lon, NEAR_KM)) {
    if (told.size >= MAX_TOLD) break;
    if (told.has(a.user_id)) continue;
    told.add(a.user_id);
    await notify(env, a.user_id, "room", null, "room", room.id, `${room.title}: a room is open, near your study area “${a.name}”`);
  }
  const tag = ROOM_TAG[room.kind];
  for (const f of await all(env, "SELECT follower_id FROM follows WHERE target_type = 'tag' AND target_id = ? LIMIT ?", tag, MAX_TOLD)) {
    if (told.size >= MAX_TOLD * 2 || told.has(f.follower_id)) continue;
    told.add(f.follower_id);
    await notify(env, f.follower_id, "room", null, "room", room.id, `${room.title}: a room is open`);
  }
  return told.size;
}

/** Upsert one event as a room. Returns {room, opened}. */
export async function upsertRoom(env, ev, t = now()) {
  const known = await one(env, "SELECT * FROM rooms WHERE source = ? AND source_id = ?", ev.source, ev.source_id);
  if (known) {
    if (ev.updated_at > known.updated_at) {
      await run(env,
        `UPDATE rooms SET title = ?, place = ?, lat = ?, lon = ?, severity = ?, alert = ?, source_url = ?, data_json = ?,
           updated_at = ?, status = 'active' WHERE id = ?`,
        ev.title, ev.place, ev.lat, ev.lon, ev.severity, ev.alert, ev.source_url, JSON.stringify(ev.data || {}), ev.updated_at, known.id);
    }
    return { room: { ...known, ...ev }, opened: false };
  }
  const room = { id: id("rm"), ...ev, status: "active", created_at: t };
  await run(env,
    `INSERT INTO rooms (id, source, source_id, kind, title, place, lat, lon, severity, alert, source_url, data_json,
       status, started_at, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    room.id, ev.source, ev.source_id, ev.kind, ev.title, ev.place, ev.lat, ev.lon, ev.severity, ev.alert, ev.source_url,
    JSON.stringify(ev.data || {}), ev.started_at, ev.updated_at, t);
  await announceRoom(env, room);
  return { room, opened: true };
}

/** The cron: read both feeds, open or refresh rooms, archive quiet ones. */
export async function syncRooms(env, t = now(), { fetcher = fetch } = {}) {
  const report = { opened: 0, refreshed: 0, archived: 0, errors: [] };
  const events = [];
  try {
    const usgs = await getJson(fetcher, USGS_FEED);
    for (const f of usgs.features || []) { const ev = fromUsgs(f); if (ev) events.push(ev); }
  } catch (error) { report.errors.push(`usgs: ${error.message}`); }
  try {
    const gdacs = await getJson(fetcher, GDACS_FEED);
    for (const f of gdacs.features || []) { const ev = fromGdacs(f, t); if (ev) events.push(ev); }
  } catch (error) { report.errors.push(`gdacs: ${error.message}`); }
  for (const ev of events) {
    const { opened } = await upsertRoom(env, ev, t);
    if (opened) report.opened += 1; else report.refreshed += 1;
  }
  const quiet = await run(env, "UPDATE rooms SET status = 'archived' WHERE status = 'active' AND source != 'manual' AND updated_at < ?", t - ARCHIVE_AFTER);
  report.archived = Number(quiet?.meta?.changes || 0);
  return report;
}

// ── Papers ─────────────────────────────────────────────────────────────────

const HAZARD_WORD = { earthquake: "earthquake", cyclone: "tropical cyclone", flood: "flood", volcano: "volcano", wildfire: "wildfire", drought: "drought" };

/** The place words worth searching on: "170 km NW of Port-Olry, Vanuatu" -> "Port-Olry Vanuatu". */
export function placeWords(room) {
  const raw = String(room.place || room.title || "").replace(/^\d+\s*km\s+[NSEW]{1,3}\s+of\s+/i, "")
    .replace(/\b(region|province|state|islands?)\b/gi, "").split(/[,;]/).slice(0, 2).join(" ");
  return raw.replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Papers about the place and the hazard, from OpenAlex; cached a week on the room. */
export async function roomPapers(env, room, { fetcher = fetch, t = now() } = {}) {
  if (room.papers_at && t - room.papers_at < 7 * DAY) return parse(room.papers_json, []);
  const q = `${HAZARD_WORD[room.kind] || ""} ${placeWords(room)}`.trim();
  let papers = [];
  try {
    const u = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=8&sort=relevance_score:desc`
      + "&select=id,doi,title,publication_year,authorships,primary_location,cited_by_count&mailto=geoid.network@geoidinitiative.com";
    const data = await getJson(fetcher, u);
    papers = (data.results || []).filter((w) => w.title).map((w) => ({
      title: str(w.title, 300),
      year: w.publication_year || null,
      doi: w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//i, "") : "",
      url: w.doi || w.primary_location?.landing_page_url || w.id,
      authors: (w.authorships || []).slice(0, 3).map((a) => str(a.author?.display_name, 80)),
      more_authors: Math.max(0, (w.authorships || []).length - 3),
      venue: str(w.primary_location?.source?.display_name || "", 120),
      cited_by: w.cited_by_count || 0,
    }));
  } catch (error) { papers = parse(room.papers_json, []); }
  await run(env, "UPDATE rooms SET papers_json = ?, papers_at = ? WHERE id = ?", JSON.stringify(papers), t, room.id);
  return papers;
}

// ── Routes ─────────────────────────────────────────────────────────────────

function roomShape(r, extra = {}) {
  return {
    id: r.id, source: r.source, kind: r.kind, title: r.title, place: r.place, lat: r.lat, lon: r.lon,
    severity: r.severity, alert: r.alert, source_url: r.source_url, data: parse(r.data_json, {}),
    status: r.status, started_at: r.started_at, updated_at: r.updated_at,
    credit: r.source === "usgs" ? "U.S. Geological Survey" : r.source === "gdacs" ? "GDACS (UN / European Commission)" : "GeoID Network",
    ...extra,
  };
}

async function roomOr404(env, rid) {
  const r = await one(env, "SELECT * FROM rooms WHERE id = ?", rid);
  if (!r) fail(404, "Not found.");
  return r;
}

/** GET /v1/rooms?status=active|archived -- newest first, with how many posts each has. */
async function listRooms(ctx) {
  const status = ctx.url.searchParams.get("status") === "archived" ? "archived" : "active";
  const limit = Math.min(50, int(ctx.url.searchParams.get("limit"), 30) || 30);
  const rows = await all(ctx.env,
    `SELECT r.*, (SELECT COUNT(*) FROM posts p WHERE p.room_id = r.id AND p.removed_at IS NULL AND p.visibility = 'public') AS posts
       FROM rooms r WHERE r.status = ? ORDER BY r.started_at DESC LIMIT ?`, status, limit);
  return { items: rows.map((r) => roomShape(r, { posts: r.posts })) };
}

/** GET /v1/rooms/:id -- the room, who studies the area, and whether the viewer follows it. */
async function getRoom(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const r = await roomOr404(env, ctx.params.id);
  const near = r.lat == null ? [] : await areasNear(env, r.lat, r.lon, NEAR_KM);
  const firstPerUser = [];
  const seen = new Set();
  for (const a of near) { if (!seen.has(a.user_id)) { seen.add(a.user_id); firstPerUser.push(a); } if (firstPerUser.length >= 24) break; }
  const users = await usersById(env, firstPerUser.map((a) => a.user_id));
  const posters = await all(env,
    "SELECT author_id, COUNT(*) AS n FROM posts WHERE room_id = ? AND removed_at IS NULL AND visibility = 'public' GROUP BY author_id", r.id);
  const following = viewer ? !!await one(env, "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'room' AND target_id = ?", viewer.id, r.id) : false;
  return roomShape(r, {
    people_near: firstPerUser.filter((a) => users[a.user_id]).map((a) => ({ user: users[a.user_id], area: a.name, km: Math.round(a.distance) })),
    contributors: posters.length,
    posts: posters.reduce((n, p) => n + p.n, 0),
    viewer: { following },
  });
}

/** GET /v1/rooms/:id/papers */
async function getPapers(ctx) {
  const r = await roomOr404(ctx.env, ctx.params.id);
  return { items: await roomPapers(ctx.env, r, { fetcher: ctx.env.fetchImpl || fetch }) };
}

/** POST /v1/rooms (admin) -- open a room the feeds missed. */
async function createRoom(ctx) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx.env, user)) fail(403, "Admins only.");
  const b = await readJson(ctx.request);
  const kind = ROOM_KINDS.includes(b.kind) ? b.kind : fail(400, `kind must be one of ${ROOM_KINDS.join(", ")}.`);
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail(400, "Give the room a lat and lon.");
  if (!str(b.title, 200)) fail(400, "Give the room a title.");
  const t = now();
  const { room } = await upsertRoom(ctx.env, {
    source: "manual", source_id: id("m"), kind, title: str(b.title, 200), place: str(b.place, 200), lat, lon,
    severity: str(b.severity, 200), alert: "", source_url: url(b.source_url) || "", started_at: int(b.started_at, t) || t,
    updated_at: t, data: {},
  }, t);
  return roomShape(room);
}

/** PATCH /v1/rooms/:id (admin) {status} -- archive or reopen. */
async function patchRoom(ctx) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx.env, user)) fail(403, "Admins only.");
  const r = await roomOr404(ctx.env, ctx.params.id);
  const b = await readJson(ctx.request);
  if (b.status) await run(ctx.env, "UPDATE rooms SET status = ? WHERE id = ?", b.status === "archived" ? "archived" : "active", r.id);
  return roomShape(await roomOr404(ctx.env, r.id));
}

/** POST /v1/rooms/sync (admin) -- read the feeds now rather than at the next tick. */
async function syncNow(ctx) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx.env, user)) fail(403, "Admins only.");
  return syncRooms(ctx.env, now(), { fetcher: ctx.env.fetchImpl || fetch });
}

export const routes = [
  ["POST", "/v1/rooms/sync", syncNow],
  ["GET", "/v1/rooms", listRooms],
  ["POST", "/v1/rooms", createRoom],
  ["GET", "/v1/rooms/:id", getRoom],
  ["PATCH", "/v1/rooms/:id", patchRoom],
  ["GET", "/v1/rooms/:id/papers", getPapers],
];

// Re-exported for posts.js: a post may name an active room.
export async function roomForPost(env, rid) {
  if (!rid) return null;
  const r = await one(env, "SELECT id, status FROM rooms WHERE id = ?", String(rid));
  if (!r) fail(400, "No such event room.");
  return r;
}
