/**
 * Place pages: one page for a location many members study, and the story of
 * it that they build together.
 *
 * A PLACE is a named circle (Etna, 40 km). Anybody with a study area can open
 * one; if a page already covers that spot, they are sent to it rather than
 * splitting the story. What belongs to a place:
 *   - its STORYBOARD (place_entries): papers by DOI (resolved through
 *     Crossref), Network posts, links to reports and data, and dated
 *     milestones -- in the order things happened;
 *   - what the Network already holds there, gathered rather than copied:
 *     posts located inside it or tagged with its slug (questions are its
 *     forum; jobs and events its opportunities), the members whose study
 *     areas fall inside it and which of them mentor;
 *   - photographs from Wikimedia Commons near it, linked and credited, never
 *     stored (members' own photos come from their posts, under their quota).
 *
 * WEIGHT. Every entry carries how strong it is, and says why:
 *   evidence   a peer-reviewed paper 3; another DOI (preprint, dataset, report) 2;
 *              a post, link or milestone 1
 *   standing   who added it: a verified ORCID iD, a verified affiliation, a
 *              record of contribution (badges) -- up to 3
 *   endorsed   members who found it useful (a verified member counts double), up to 3
 * The "strongest first" view sorts by it; the timeline shows it beside each
 * entry. Nothing is hidden for being weak -- it is shown for what it is.
 */
import { now, str, id, fail, requireUser, currentUser, readJson, isAdmin, parse, url, tags, rateLimit, usersById, notify, canSeePost } from "./lib.js";
import { all, one, run } from "./collab.js";
import { crossref, normalDoi } from "./verify.js";
import { km } from "./rooms.js";
import { shapePosts, olderThan, pageOf } from "./posts.js";
import { VISIBLE_POSTS, visibleBinds } from "./lib.js";

const DAY = 86400;
const KINDS = ["paper", "post", "link", "milestone"];
const PEER_REVIEWED = new Set(["journal-article", "proceedings-article", "book-chapter"]);

const LETTERS = { "ð": "d", "þ": "th", "æ": "ae", "ø": "o", "ß": "ss", "ł": "l", "œ": "oe", "ı": "i" };
export const slugOf = (name) => String(name || "").toLowerCase().replace(/[ðþæøßłœı]/g, (c) => LETTERS[c]).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const when = (v) => (DATE_RE.test(String(v || "").trim()) ? String(v).trim() : "");

async function placeOr404(env, slug) {
  const p = await one(env, "SELECT * FROM places WHERE slug = ?", String(slug || "").toLowerCase());
  if (!p) fail(404, "No such place page.");
  return p;
}

/** A box around a place, then the true distance. */
function nearSql(prefix, p, radius = p.radius_km) {
  const dLat = radius / 111;
  const dLon = radius / (111 * Math.max(0.15, Math.cos(p.lat * Math.PI / 180)));
  return { sql: `${prefix}.lat BETWEEN ? AND ? AND ${prefix}.lon BETWEEN ? AND ?`, binds: [p.lat - dLat, p.lat + dLat, p.lon - dLon, p.lon + dLon] };
}

/** Who studies here: members with a study area inside the place, nearest first. */
async function peopleHere(env, p) {
  const box = nearSql("s", p);
  const rows = await all(env,
    `SELECT s.user_id, s.name, s.lat, s.lon, u.mentoring_open FROM study_areas s JOIN users u ON u.id = s.user_id
      WHERE s.world = ? AND s.on_map = 1 AND u.suspended_until < ? AND u.email NOT LIKE 'erased:%' AND ${box.sql}`,
    p.world, now(), ...box.binds);
  const seen = new Map();
  for (const r of rows) {
    const d = km(p.lat, p.lon, r.lat, r.lon);
    if (d > p.radius_km) continue;
    if (!seen.has(r.user_id) || seen.get(r.user_id).km > d) seen.set(r.user_id, { user_id: r.user_id, area: r.name, km: Math.round(d), mentor: !!r.mentoring_open });
  }
  return [...seen.values()].sort((a, b) => a.km - b.km);
}

// ── Standing and weight ────────────────────────────────────────────────────

/** {score 0-3, reasons[]} for a member: what makes their word count for more here. */
export async function standingOf(env, userId) {
  const u = await one(env, "SELECT orcid_verified FROM users WHERE id = ?", userId);
  const aff = await one(env, "SELECT 1 AS x FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? AND m.verified = 1 AND o.verified = 1", userId);
  const badges = (await one(env, "SELECT COUNT(*) AS n FROM badges WHERE user_id = ? AND revoked_at IS NULL", userId))?.n || 0;
  const reasons = [];
  if (u?.orcid_verified) reasons.push("verified ORCID iD");
  if (aff) reasons.push("verified affiliation");
  if (badges >= 2) reasons.push(`${badges} contribution badges`);
  return { score: reasons.length, reasons };
}

/** The weight of one entry, and why. */
export function weigh(entry, standing, endorsements) {
  const evidence = entry.kind === "paper" ? (entry.peer_reviewed ? 3 : 2) : (entry.doi ? 2 : 1);
  const endorsed = Math.min(3, endorsements.reduce((n, e) => n + (e.verified ? 1 : 0.5), 0));
  const why = [entry.kind === "paper" ? (entry.peer_reviewed ? "peer-reviewed paper" : "paper with a DOI (not peer reviewed)") : entry.doi ? "has a DOI" : `member ${entry.kind}`,
    ...standing.reasons.map((r) => `added by someone with a ${r}`),
    endorsements.length ? `endorsed by ${endorsements.length}${endorsements.some((e) => e.verified) ? ` (${endorsements.filter((e) => e.verified).length} verified)` : ""}` : ""].filter(Boolean);
  const score = evidence * 2 + standing.score + endorsed;
  return { score: Math.round(score * 10) / 10, level: score >= 8 ? "strong" : score >= 4 ? "good" : "member", evidence, why };
}

async function shapeEntries(env, viewer, rows) {
  const users = await usersById(env, rows.map((r) => r.added_by));
  const standings = {};
  for (const uid of new Set(rows.map((r) => r.added_by))) standings[uid] = await standingOf(env, uid);
  const out = [];
  for (const r of rows) {
    const ends = await all(env, `SELECT e.user_id, u.orcid_verified FROM place_endorsements e JOIN users u ON u.id = e.user_id WHERE e.entry_id = ?`, r.id);
    const endorsements = ends.map((e) => ({ verified: !!e.orcid_verified }));
    let post = null;
    if (r.post_id) {
      const pr = await one(env, "SELECT * FROM posts WHERE id = ?", r.post_id);
      if (pr && !pr.removed_at && await canSeePost(env, viewer, pr)) post = { id: pr.id, kind: pr.kind, title: pr.title, provenance: pr.provenance };
      else if (pr) continue;                                // a post the viewer can't see isn't shown on the story either
    }
    out.push({
      id: r.id, kind: r.kind, title: r.title, summary: r.summary, doi: r.doi, url: r.url, post, happened_on: r.happened_on,
      peer_reviewed: !!r.peer_reviewed, venue: r.venue, authors: r.authors, added_by: users[r.added_by] || null, created_at: r.created_at,
      endorsements: endorsements.length, endorsed_by_me: !!viewer && ends.some((e) => e.user_id === viewer.id),
      mine: !!viewer && viewer.id === r.added_by,
      weight: weigh(r, standings[r.added_by], endorsements),
    });
  }
  return out;
}

// ── Routes ─────────────────────────────────────────────────────────────────

const placeShape = (p, extra = {}) => ({ id: p.id, slug: p.slug, name: p.name, summary: p.summary, world: p.world, lat: p.lat, lon: p.lon,
  radius_km: p.radius_km, created_at: p.created_at, updated_at: p.updated_at, ...extra });

/** GET /v1/places?near=lat,lon -- pages near a point (or the busiest, without one). */
async function listPlaces(ctx) {
  const env = ctx.env;
  const near = String(ctx.url.searchParams.get("near") || "").split(",").map(Number);
  const rows = await all(env, `SELECT p.*, (SELECT COUNT(*) FROM place_entries e WHERE e.place_id = p.id AND e.removed_at IS NULL) AS entries
    FROM places p ORDER BY p.updated_at DESC LIMIT 200`);
  let items = rows.map((r) => placeShape(r, { entries: r.entries }));
  if (near.length === 2 && near.every(Number.isFinite)) {
    items = items.map((p) => ({ ...p, km: Math.round(km(near[0], near[1], p.lat, p.lon)) }))
      .filter((p) => p.km <= Math.max(p.radius_km, 25) * 2).sort((a, b) => a.km - b.km);
  }
  return { items: items.slice(0, 60) };
}

/** POST /v1/places {name, lat, lon, radius_km, summary} -- open a page, unless one already covers the spot. */
async function createPlace(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await readJson(ctx.request);
  const name = str(b.name, 80);
  const lat = Number(b.lat), lon = Number(b.lon);
  if (!name) fail(400, "Name the place.");
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) fail(400, "Give the place a lat and lon.");
  const radius = Math.min(500, Math.max(2, Math.round(Number(b.radius_km) || 40)));
  const world = str(b.world, 20).toLowerCase() || "earth";
  // One story per place: a page whose centre is inside this circle or this centre inside it is the same place.
  for (const p of await all(env, "SELECT * FROM places WHERE world = ?", world)) {
    const d = km(lat, lon, p.lat, p.lon);
    if (d <= Math.max(p.radius_km, radius) * 0.6) return { exists: true, place: placeShape(p, { km: Math.round(d) }) };
  }
  let slug = slugOf(b.slug || name) || "place";
  for (let i = 2; await one(env, "SELECT 1 AS x FROM places WHERE slug = ?", slug); i += 1) slug = `${slugOf(name)}-${i}`;
  const t = now();
  const row = { id: id("pl"), slug, name, summary: str(b.summary, 2000), world, lat, lon, radius_km: radius, created_by: user.id, created_at: t, updated_at: t };
  await run(env, `INSERT INTO places (id, slug, name, summary, world, lat, lon, radius_km, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.id, row.slug, row.name, row.summary, row.world, row.lat, row.lon, row.radius_km, row.created_by, t, t);
  // Everybody who studies the spot hears that its page exists.
  for (const person of await peopleHere(env, row)) {
    await notify(env, person.user_id, "place", user.id, "place", row.slug, `A place page for ${name} is open: add to its story`);
  }
  return { exists: false, place: placeShape(row) };
}

/** GET /v1/places/:slug -- the page: who studies here, its numbers, and whether the viewer follows it. */
async function getPlace(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const p = await placeOr404(env, ctx.params.slug);
  const people = await peopleHere(env, p);
  const users = await usersById(env, people.slice(0, 60).map((x) => x.user_id));
  const counts = await one(env, `SELECT
      (SELECT COUNT(*) FROM place_entries WHERE place_id = ? AND removed_at IS NULL) AS entries,
      (SELECT COUNT(*) FROM place_entries WHERE place_id = ? AND removed_at IS NULL AND peer_reviewed = 1) AS peer_reviewed`, p.id, p.id);
  const creator = (await usersById(env, [p.created_by]))[p.created_by] || null;
  return placeShape(p, {
    creator,
    people: people.slice(0, 60).filter((x) => users[x.user_id]).map((x) => ({ user: users[x.user_id], area: x.area, km: x.km, mentor: x.mentor })),
    counts: { ...counts, people: people.length, mentors: people.filter((x) => x.mentor).length },
    viewer: viewer ? {
      following: !!await one(env, "SELECT 1 AS x FROM follows WHERE follower_id = ? AND target_type = 'placepage' AND target_id = ?", viewer.id, p.id),
      can_edit: viewer.id === p.created_by || isAdmin(env, viewer),
      studies_here: people.some((x) => x.user_id === viewer.id),
    } : null,
  });
}

/** PATCH /v1/places/:slug {summary, radius_km, name} -- the person who opened it, or an admin. */
async function patchPlace(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const p = await placeOr404(env, ctx.params.slug);
  if (user.id !== p.created_by && !isAdmin(env, user)) fail(403, "Only the person who opened this page, or an admin, can edit its summary.");
  const b = await readJson(ctx.request);
  const t = now();
  await run(env, "UPDATE places SET name = ?, summary = ?, radius_km = ?, updated_at = ? WHERE id = ?",
    str(b.name, 80) || p.name, b.summary !== undefined ? str(b.summary, 2000) : p.summary,
    b.radius_km ? Math.min(500, Math.max(2, Math.round(Number(b.radius_km)))) : p.radius_km, t, p.id);
  return placeShape(await placeOr404(env, p.slug));
}

/** GET /v1/places/:slug/story?order=time|weight&kind= */
async function story(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const p = await placeOr404(env, ctx.params.slug);
  const kind = ctx.url.searchParams.get("kind");
  const rows = await all(env, `SELECT * FROM place_entries WHERE place_id = ? AND removed_at IS NULL ${KINDS.includes(kind) ? "AND kind = ?" : ""}
    ORDER BY happened_on DESC, created_at DESC LIMIT 300`, p.id, ...(KINDS.includes(kind) ? [kind] : []));
  let items = await shapeEntries(env, viewer, rows);
  if (ctx.url.searchParams.get("order") === "weight") items = items.sort((a, b) => b.weight.score - a.weight.score || (b.happened_on > a.happened_on ? 1 : -1));
  return { items };
}

/** POST /v1/places/:slug/story {kind, doi | post_id | url, title, summary, happened_on} -- add to the story. */
async function addEntry(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const p = await placeOr404(env, ctx.params.slug);
  const b = await readJson(ctx.request);
  if (!KINDS.includes(b.kind)) fail(400, `kind must be one of ${KINDS.join(", ")}.`);
  const row = { id: id("pe"), place_id: p.id, kind: b.kind, title: str(b.title, 300), summary: str(b.summary, 1200), doi: "", url: "", post_id: null,
    happened_on: when(b.happened_on), peer_reviewed: 0, venue: "", authors: "", added_by: user.id, created_at: now() };
  if (b.kind === "paper") {
    const doi = normalDoi(b.doi);
    if (!doi) fail(400, "Give the paper's DOI, e.g. 10.1029/2021GL093123.");
    if (await one(env, "SELECT 1 AS x FROM place_entries WHERE place_id = ? AND doi = ? AND removed_at IS NULL", p.id, doi)) fail(409, "That paper is already on this place's story.");
    const found = await crossref(env, doi);
    if (found.status === "not-found") fail(400, "Crossref doesn't know that DOI. Check it, or add it as a link.");
    if (found.status !== "ok") fail(502, "Crossref didn't answer. Try again in a minute.");
    const w = found.work;
    const year = w.issued?.["date-parts"]?.[0]?.[0] || w.published?.["date-parts"]?.[0]?.[0];
    Object.assign(row, { doi, url: `https://doi.org/${doi}`, title: str(Array.isArray(w.title) ? w.title[0] : w.title, 300) || row.title || doi,
      venue: str(Array.isArray(w["container-title"]) ? w["container-title"][0] : w["container-title"], 200),
      authors: (w.author || []).slice(0, 4).map((a) => [a.given, a.family].filter(Boolean).join(" ") || a.name).filter(Boolean).join(", ") + ((w.author || []).length > 4 ? " et al." : ""),
      peer_reviewed: PEER_REVIEWED.has(w.type) ? 1 : 0, happened_on: row.happened_on || (year ? String(year) : "") });
  } else if (b.kind === "post") {
    const post = await one(env, "SELECT * FROM posts WHERE id = ? AND removed_at IS NULL", str(b.post_id, 40));
    if (!post || post.visibility !== "public") fail(400, "Only a public post can join a place's story.");
    if (await one(env, "SELECT 1 AS x FROM place_entries WHERE place_id = ? AND post_id = ? AND removed_at IS NULL", p.id, post.id)) fail(409, "That post is already on the story.");
    Object.assign(row, { post_id: post.id, title: row.title || post.title || "A post", happened_on: row.happened_on || new Date(post.created_at * 1000).toISOString().slice(0, 10) });
  } else if (b.kind === "link") {
    row.url = url(b.url) || fail(400, "Give the link (https://…).");
    const doi = normalDoi(b.doi);
    if (doi) row.doi = doi;
    if (!row.title) fail(400, "Give the link a title.");
  } else if (!row.title) fail(400, "Say what happened.");
  if (b.kind === "milestone" && !row.happened_on) fail(400, "A milestone needs a date (a year is enough).");
  await run(env, `INSERT INTO place_entries (id, place_id, kind, title, summary, doi, url, post_id, happened_on, peer_reviewed, venue, authors, added_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, row.id, row.place_id, row.kind, row.title, row.summary, row.doi, row.url, row.post_id,
    row.happened_on, row.peer_reviewed, row.venue, row.authors, row.added_by, row.created_at);
  await run(env, "UPDATE places SET updated_at = ? WHERE id = ?", row.created_at, p.id);
  for (const f of await all(env, "SELECT follower_id FROM follows WHERE target_type = 'placepage' AND target_id = ? AND follower_id != ? LIMIT 300", p.id, user.id)) {
    await notify(env, f.follower_id, "place", user.id, "place", p.slug, `${p.name}: ${row.title}`);
  }
  return (await shapeEntries(env, user, [row]))[0];
}

/** POST /v1/places/entries/:id/endorse {on} -- "this is useful"; DELETE /v1/places/entries/:id -- the adder or an admin. */
async function endorse(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const e = await one(env, "SELECT * FROM place_entries WHERE id = ? AND removed_at IS NULL", ctx.params.id);
  if (!e) fail(404, "Not found.");
  if (e.added_by === user.id) fail(400, "Others endorse what you add.");
  const b = await readJson(ctx.request).catch(() => ({}));
  if (b.on === false) await run(env, "DELETE FROM place_endorsements WHERE entry_id = ? AND user_id = ?", e.id, user.id);
  else await run(env, "INSERT OR IGNORE INTO place_endorsements (entry_id, user_id, created_at) VALUES (?, ?, ?)", e.id, user.id, now());
  return (await shapeEntries(env, user, [e]))[0];
}

async function removeEntry(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const e = await one(env, "SELECT * FROM place_entries WHERE id = ? AND removed_at IS NULL", ctx.params.id);
  if (!e) fail(404, "Not found.");
  if (e.added_by !== user.id && !isAdmin(env, user)) fail(403, "Only who added it, or an admin, can take it off.");
  await run(env, "UPDATE place_entries SET removed_at = ? WHERE id = ?", now(), e.id);
  return { ok: true };
}

/** GET /v1/places/:slug/photos -- Wikimedia Commons near the place (linked, credited, cached a week). */
async function photos(ctx) {
  const env = ctx.env;
  const p = await placeOr404(env, ctx.params.slug);
  const t = now();
  if (p.commons_at && t - p.commons_at < 7 * DAY) return { items: parse(p.commons_json, []), source: "Wikimedia Commons" };
  let items = [];
  try {
    const radius = Math.min(10000, Math.max(1000, p.radius_km * 1000));
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${p.lat}%7C${p.lon}`
      + `&ggsradius=${radius}&ggslimit=24&ggsnamespace=6&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=480`;
    const r = await (env.fetchImpl || fetch)(u, { headers: { "user-agent": "GeoIDNetwork/1.0 (https://geoidinitiative.com/social/)" } });
    const data = r.ok ? await r.json() : null;
    const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    items = Object.values(data?.query?.pages || {}).map((pg) => {
      const ii = pg.imageinfo?.[0] || {};
      const md = ii.extmetadata || {};
      return { title: strip(pg.title).replace(/^File:/, "").replace(/\.[a-z]{3,4}$/i, ""), thumb: ii.thumburl || "", page: ii.descriptionurl || "",
        author: str(strip(md.Artist?.value), 120), licence: str(strip(md.LicenseShortName?.value), 60) };
    }).filter((x) => x.thumb && /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(x.thumb) && /\.(jpe?g|png|webp)(\?|$)/i.test(x.thumb.split("?")[0] + "?")).slice(0, 18);
  } catch (error) { items = parse(p.commons_json, []); }
  // Nothing found (or Commons busy): try again tomorrow rather than in a week.
  await run(env, "UPDATE places SET commons_json = ?, commons_at = ? WHERE id = ?", JSON.stringify(items), items.length ? t : t - 6 * DAY, p.id);
  return { items, source: "Wikimedia Commons" };
}

/**
 * GET /v1/places/pages/:slug/posts?kind= -- what the Network holds here: posts
 * located inside the place or tagged with its slug. kind=question is its
 * forum; opportunity and event its openings.
 */
async function placePosts(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const p = await placeOr404(env, ctx.params.slug);
  const kind = str(ctx.url.searchParams.get("kind"), 20);
  const box = nearSql("p", p);
  const where = [VISIBLE_POSTS, `((p.world = ? AND p.lat IS NOT NULL AND ${box.sql}) OR EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ?))`];
  const binds = [...visibleBinds(viewer), p.world, ...box.binds, p.slug];
  if (kind) { where.push("p.kind = ?"); binds.push(kind); }
  const cursor = olderThan(ctx.url.searchParams.get("cursor"));
  const rows = (await env.DB.prepare(`SELECT p.* FROM posts p WHERE ${where.join(" AND ")}${cursor.sql} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .bind(...binds, ...cursor.binds, 21).all()).results || [];
  // The box is square; drop what lies outside the circle (tagged posts stay wherever they are).
  const inside = rows.filter((r) => r.lat == null || km(p.lat, p.lon, r.lat, r.lon) <= p.radius_km * 1.05 || parse(r.tags_json, []).includes(p.slug));
  const { page, next } = pageOf(rows);
  const keep = new Set(inside.map((r) => r.id));
  return { items: await shapePosts(env, viewer, page.filter((r) => keep.has(r.id))), next };
}

export const routes = [
  ["GET", "/v1/places/pages/:slug/posts", placePosts],
  ["GET", "/v1/places/pages", listPlaces],
  ["POST", "/v1/places/pages", createPlace],
  ["GET", "/v1/places/pages/:slug", getPlace],
  ["PATCH", "/v1/places/pages/:slug", patchPlace],
  ["GET", "/v1/places/pages/:slug/story", story],
  ["POST", "/v1/places/pages/:slug/story", addEntry],
  ["GET", "/v1/places/pages/:slug/photos", photos],
  ["POST", "/v1/places/entries/:id/endorse", endorse],
  ["DELETE", "/v1/places/entries/:id", removeEntry],
];

