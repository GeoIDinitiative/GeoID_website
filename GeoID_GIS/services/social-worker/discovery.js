/**
 * Finding things: search, trending tags, the map, places and events.
 *
 * Everything here is a read over content other routes wrote, so the privacy
 * rules are the ones they already enforce: VISIBLE_POSTS for posts (blocks
 * included), and locations exactly as stored -- already snapped, and NULL
 * for hidden, which the map additionally refuses by precision so a stale row
 * could not leak either.
 */
import {
  PAGE, fail, now, str, tags, parse, currentUser, publicUser, usersById,
  VISIBLE_POSTS, visibleBinds, NOT_BLOCKED, encodeCursor, decodeCursor,
} from "./lib.js";
import { optInt, shapePosts, verificationsFor, olderThan, pageOf, findCommunity, KINDS } from "./posts.js";
import { enumOf, likeOf } from "./profiles.js";

const inList = (n) => Array(n).fill("?").join(",");
const LIKE = "LIKE ? ESCAPE '\\'";

/** Projects a viewer may see on discovery surfaces: public ones, and their own. */
function projectVisibility(viewer) {
  return viewer
    ? { sql: "(pr.visibility = 'public' OR pr.owner_id = ?)", binds: [viewer.id] }
    : { sql: "pr.visibility = 'public'", binds: [] };
}

function projectShape(env, row, owners) {
  return {
    id: row.id,
    kind: "project",
    title: row.title,
    summary: row.summary,
    stage: row.stage,
    world: row.world,
    tags: parse(row.tags_json, []),
    owner: owners[row.owner_id] || null,
    location: row.lat == null || row.loc_precision === "hidden" ? null
      : { lat: row.lat, lon: row.lon, precision: row.loc_precision },
    visibility: row.visibility,
    created_at: row.created_at,
  };
}

// ── Search ─────────────────────────────────────────────────────────────────

async function search(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const q = ctx.url.searchParams;
  const text = str(q.get("q"), 100);
  if (text.length < 2) fail(400, "Search for at least two characters.");
  const type = q.get("type") ? enumOf(q.get("type"), ["posts", "people", "communities", "projects", "tags"], "type") : "posts";
  const like = likeOf(text);

  if (type === "posts") {
    const cursor = olderThan(q.get("cursor"));
    const rows = (await env.DB.prepare(
      `SELECT p.* FROM posts p WHERE ${VISIBLE_POSTS} AND (p.title ${LIKE} OR p.body ${LIKE})${cursor.sql}
        ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
    ).bind(...visibleBinds(viewer), like, like, ...cursor.binds, PAGE + 1).all()).results;
    const { page, next } = pageOf(rows);
    return { items: await shapePosts(env, viewer, page), next };
  }

  if (type === "people") {
    const where = ["u.suspended_until <= ?", "u.email NOT LIKE 'erased:%'",
      `(u.handle ${LIKE} OR u.name ${LIKE} OR u.headline ${LIKE} OR u.institution ${LIKE})`];
    const binds = [now(), like, like, like, like];
    if (viewer) { where.push(NOT_BLOCKED("u.id")); binds.push(viewer.id, viewer.id); }
    const c = decodeCursor(q.get("cursor"));
    if (c) { where.push("(u.created_at < ? OR (u.created_at = ? AND u.id < ?))"); binds.push(c.at, c.at, c.id); }
    const rows = (await env.DB.prepare(
      `SELECT u.* FROM users u WHERE ${where.join(" AND ")} ORDER BY u.created_at DESC, u.id DESC LIMIT ?`,
    ).bind(...binds, PAGE + 1).all()).results;
    const { page, next } = pageOf(rows);
    return { items: page.map((r) => publicUser(env, r)), next };
  }

  if (type === "communities") {
    // Private communities (and channels) exist only for their members.
    const rows = (await env.DB.prepare(
      `SELECT c.* FROM communities c WHERE (c.name ${LIKE} OR c.description ${LIKE} OR c.tags_json ${LIKE})
          AND (c.visibility != 'private' OR c.id IN (SELECT community_id FROM community_members WHERE user_id = ? AND status = 'active'))
        ORDER BY c.member_count DESC, c.name LIMIT 50`,
    ).bind(like, like, like, viewer ? viewer.id : "").all()).results;
    return {
      items: rows.map((c) => ({
        slug: c.slug, name: c.name, description: c.description, tags: parse(c.tags_json, []),
        visibility: c.visibility, member_count: c.member_count,
      })),
      next: null,
    };
  }

  if (type === "projects") {
    const vis = projectVisibility(viewer);
    const where = ["pr.removed_at IS NULL", vis.sql, `(pr.title ${LIKE} OR pr.summary ${LIKE} OR pr.tags_json ${LIKE})`];
    const binds = [...vis.binds, like, like, like];
    if (viewer) { where.push(NOT_BLOCKED("pr.owner_id")); binds.push(viewer.id, viewer.id); }
    const cursor = olderThan(q.get("cursor"), "pr");
    const rows = (await env.DB.prepare(
      `SELECT pr.* FROM projects pr WHERE ${where.join(" AND ")}${cursor.sql} ORDER BY pr.created_at DESC, pr.id DESC LIMIT ?`,
    ).bind(...binds, ...cursor.binds, PAGE + 1).all()).results;
    const { page, next } = pageOf(rows);
    const owners = await usersById(env, page.map((r) => r.owner_id));
    return { items: page.map((r) => projectShape(env, r, owners)), next };
  }

  // tags: counted over posts the viewer can see, so a tag used only in
  // private posts is not discoverable.
  const prefix = `${String(tags([text])[0] || "").replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = (await env.DB.prepare(
    `SELECT pt.tag AS tag, COUNT(*) AS count FROM post_tags pt JOIN posts p ON p.id = pt.post_id
      WHERE ${VISIBLE_POSTS} AND pt.tag ${LIKE} GROUP BY pt.tag ORDER BY count DESC, pt.tag LIMIT 20`,
  ).bind(...visibleBinds(viewer), prefix).all()).results;
  return { items: rows, next: null };
}

async function trending(ctx) {
  // Public posts only: trending is the same for everybody and may be cached.
  const rows = (await ctx.env.DB.prepare(
    `SELECT pt.tag AS tag, COUNT(*) AS count FROM post_tags pt JOIN posts p ON p.id = pt.post_id
      WHERE p.visibility = 'public' AND p.removed_at IS NULL AND p.created_at > ?
      GROUP BY pt.tag ORDER BY count DESC, pt.tag LIMIT 20`,
  ).bind(now() - 14 * 86400).all()).results;
  return { items: rows, next: null };
}

// ── Map ────────────────────────────────────────────────────────────────────

const MAX_POINTS = 300;

function parseBbox(text) {
  if (!text) return null;
  const parts = String(text).split(",").map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) fail(400, "bbox is w,s,e,n in degrees.");
  const [w, s, e, n] = parts;
  if (s > n || Math.abs(s) > 90 || Math.abs(n) > 90) fail(400, "bbox is w,s,e,n in degrees.");
  return { w, s, e, n };
}

/** SQL for "inside the bbox" over alias `a`; w > e crosses the antimeridian. */
function bboxSql(box, a) {
  if (!box) return { sql: "", binds: [] };
  const lon = box.w <= box.e ? `${a}.lon BETWEEN ? AND ?` : `(${a}.lon >= ? OR ${a}.lon <= ?)`;
  return { sql: ` AND ${a}.lat BETWEEN ? AND ? AND ${lon}`, binds: [box.s, box.n, box.w, box.e] };
}

async function map(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const q = ctx.url.searchParams;
  const world = str(q.get("world"), 40).toLowerCase() || "earth";
  const box = parseBbox(q.get("bbox"));
  const z = Math.min(20, Math.max(0, optInt(q.get("z"), 2)));
  const kinds = (q.get("kinds") || "").split(",").map((k) => k.trim()).filter(Boolean);
  for (const k of kinds) if (k !== "project") enumOf(k, KINDS, "kinds");
  const postKinds = kinds.filter((k) => k !== "project");
  const wantPosts = !kinds.length || postKinds.length > 0;
  const wantProjects = !kinds.length || kinds.includes("project");
  const since = optInt(q.get("since"));
  const until = optInt(q.get("until"));
  const tag = tags([q.get("tag") || ""])[0];
  const layer = q.get("layer") ? enumOf(q.get("layer"), ["public", "mine", "teams"], "layer") : "public";
  if (layer !== "public" && !viewer) fail(401, "Sign in to see that layer.");

  // Posts: placed, never hidden, on the chosen layer.
  const pw = ["p.removed_at IS NULL", "p.world = ?", "p.lat IS NOT NULL", "p.lon IS NOT NULL", "p.loc_precision != 'hidden'"];
  const pb = [world];
  if (layer === "public") {
    pw.push("p.visibility = 'public'");
    if (viewer) { pw.push(NOT_BLOCKED("p.author_id")); pb.push(viewer.id, viewer.id); }
  } else if (layer === "mine") {
    pw.push("p.author_id = ?"); pb.push(viewer.id);
  } else {
    pw.push(VISIBLE_POSTS, "p.visibility = 'team'"); pb.push(...visibleBinds(viewer));
  }
  if (postKinds.length) { pw.push(`p.kind IN (${inList(postKinds.length)})`); pb.push(...postKinds); }
  if (since != null) { pw.push("p.created_at >= ?"); pb.push(since); }
  if (until != null) { pw.push("p.created_at <= ?"); pb.push(until); }
  if (tag) { pw.push("EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ?)"); pb.push(tag); }
  const pbox = bboxSql(box, "p");
  const postWhere = `${pw.join(" AND ")}${pbox.sql}`;
  const postBinds = [...pb, ...pbox.binds];

  // Projects: same idea over the projects table.
  const jw = ["pr.removed_at IS NULL", "pr.world = ?", "pr.lat IS NOT NULL", "pr.lon IS NOT NULL", "pr.loc_precision != 'hidden'"];
  const jb = [world];
  if (layer === "public") {
    jw.push("pr.visibility = 'public'");
    if (viewer) { jw.push(NOT_BLOCKED("pr.owner_id")); jb.push(viewer.id, viewer.id); }
  } else if (layer === "mine") {
    jw.push("pr.owner_id = ?"); jb.push(viewer.id);
  } else {
    jw.push("pr.team_id IN (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active')"); jb.push(viewer.id);
  }
  if (since != null) { jw.push("pr.created_at >= ?"); jb.push(since); }
  if (until != null) { jw.push("pr.created_at <= ?"); jb.push(until); }
  if (tag) { jw.push("EXISTS (SELECT 1 FROM json_each(pr.tags_json) WHERE value = ?)"); jb.push(tag); }
  const jbox = bboxSql(box, "pr");
  const projectWhere = `${jw.join(" AND ")}${jbox.sql}`;
  const projectBinds = [...jb, ...jbox.binds];

  const count = async (sql, binds) => (await env.DB.prepare(sql).bind(...binds).first("n")) || 0;
  const total = (wantPosts ? await count(`SELECT COUNT(*) AS n FROM posts p WHERE ${postWhere}`, postBinds) : 0)
    + (wantProjects ? await count(`SELECT COUNT(*) AS n FROM projects pr WHERE ${projectWhere}`, projectBinds) : 0);

  if (total <= MAX_POINTS) {
    const points = [];
    if (wantPosts) {
      const rows = (await env.DB.prepare(
        `SELECT p.id, p.kind, p.title, p.lat, p.lon, p.loc_precision, p.provenance, p.author_id FROM posts p
          WHERE ${postWhere} ORDER BY p.created_at DESC LIMIT ${MAX_POINTS}`,
      ).bind(...postBinds).all()).results;
      const authors = await usersById(env, rows.map((r) => r.author_id));
      const verification = await verificationsFor(env, rows.filter((r) => r.kind === "observation").map((r) => r.id));
      for (const r of rows) {
        points.push({
          id: r.id, kind: r.kind, title: r.title, lat: r.lat, lon: r.lon, precision: r.loc_precision,
          provenance: r.provenance, verification: verification[r.id] || null, author: authors[r.author_id] || null,
        });
      }
    }
    if (wantProjects) {
      const rows = (await env.DB.prepare(
        `SELECT pr.id, pr.title, pr.lat, pr.lon, pr.loc_precision, pr.owner_id FROM projects pr
          WHERE ${projectWhere} ORDER BY pr.created_at DESC LIMIT ${MAX_POINTS}`,
      ).bind(...projectBinds).all()).results;
      const owners = await usersById(env, rows.map((r) => r.owner_id));
      for (const r of rows) {
        points.push({
          id: r.id, kind: "project", title: r.title, lat: r.lat, lon: r.lon, precision: r.loc_precision,
          provenance: null, verification: null, author: owners[r.owner_id] || null,
        });
      }
    }
    return { clusters: [], points };
  }

  // Too many to draw: clusters on a grid of 360/2^z degrees. lat+90 and
  // lon+180 are never negative, so CAST truncation is floor() without
  // needing SQLite's optional math functions.
  const cell = 360 / 2 ** z;
  const cells = new Map();
  const add = (r) => {
    const k = `${r.cy}:${r.cx}`;
    const c = cells.get(k) || { latSum: 0, lonSum: 0, count: 0, kinds: {} };
    c.latSum += r.lat_sum; c.lonSum += r.lon_sum; c.count += r.n;
    c.kinds[r.kind] = (c.kinds[r.kind] || 0) + r.n;
    cells.set(k, c);
  };
  if (wantPosts) {
    const rows = (await env.DB.prepare(
      `SELECT CAST((p.lat + 90) / ? AS INTEGER) AS cy, CAST((p.lon + 180) / ? AS INTEGER) AS cx, p.kind AS kind,
              COUNT(*) AS n, SUM(p.lat) AS lat_sum, SUM(p.lon) AS lon_sum
         FROM posts p WHERE ${postWhere} GROUP BY cy, cx, p.kind`,
    ).bind(cell, cell, ...postBinds).all()).results;
    rows.forEach(add);
  }
  if (wantProjects) {
    const rows = (await env.DB.prepare(
      `SELECT CAST((pr.lat + 90) / ? AS INTEGER) AS cy, CAST((pr.lon + 180) / ? AS INTEGER) AS cx, 'project' AS kind,
              COUNT(*) AS n, SUM(pr.lat) AS lat_sum, SUM(pr.lon) AS lon_sum
         FROM projects pr WHERE ${projectWhere} GROUP BY cy, cx`,
    ).bind(cell, cell, ...projectBinds).all()).results;
    rows.forEach(add);
  }
  const clusters = [...cells.values()].map((c) => ({
    lat: Number((c.latSum / c.count).toFixed(4)),
    lon: Number((c.lonSum / c.count).toFixed(4)),
    count: c.count,
    kinds: c.kinds,
  }));
  return { clusters, points: [] };
}

// ── Places ─────────────────────────────────────────────────────────────────

function km(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function places(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const q = ctx.url.searchParams;
  const lat = Number(q.get("lat"));
  const lon = Number(q.get("lon"));
  if (!q.get("lat") || !q.get("lon") || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    fail(400, "Give lat and lon.");
  }
  const radius = Math.min(500, Math.max(1, Number(q.get("radius_km")) || 50));
  // A box first (index-friendly), then the true distance in JS.
  const dLat = radius / 111;
  const dLon = radius / (111 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const box = [lat - dLat, lat + dLat, lon - dLon, lon + dLon];
  const near = (r) => km(lat, lon, r.lat, r.lon) <= radius;

  const postRows = (await env.DB.prepare(
    `SELECT p.* FROM posts p WHERE ${VISIBLE_POSTS} AND p.lat IS NOT NULL AND p.loc_precision != 'hidden'
        AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ? ORDER BY p.created_at DESC LIMIT 200`,
  ).bind(...visibleBinds(viewer), ...box).all()).results.filter(near);

  const vis = projectVisibility(viewer);
  const projectRows = (await env.DB.prepare(
    `SELECT pr.* FROM projects pr WHERE pr.removed_at IS NULL AND ${vis.sql} AND pr.lat IS NOT NULL
        AND pr.loc_precision != 'hidden' AND pr.lat BETWEEN ? AND ? AND pr.lon BETWEEN ? AND ?
      ORDER BY pr.created_at DESC LIMIT 50`,
  ).bind(...vis.binds, ...box).all()).results.filter(near);
  const owners = await usersById(env, projectRows.map((r) => r.owner_id));

  // Communities active here: counted over the posts the viewer can see, and
  // private communities named only to their members.
  const counts = {};
  for (const p of postRows) if (p.community_id) counts[p.community_id] = (counts[p.community_id] || 0) + 1;
  const communities_active = [];
  for (const [cid, count] of Object.entries(counts)) {
    const c = await findCommunity(env, cid);
    if (!c) continue;
    if (c.visibility === "private") {
      const member = viewer && await env.DB.prepare(
        "SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ? AND status = 'active'",
      ).bind(c.id, viewer.id).first();
      if (!member) continue;
    }
    communities_active.push({ slug: c.slug, count });
  }
  communities_active.sort((a, b) => b.count - a.count);

  // People: authors who posted here PUBLICLY. Posting a followers-only note
  // from a place is not consent to be listed as somebody who is there.
  const publicAuthors = [...new Set(postRows.filter((p) => p.visibility === "public").map((p) => p.author_id))].slice(0, 20);
  const people = Object.values(await usersById(env, publicAuthors));

  return {
    posts: await shapePosts(env, viewer, postRows.slice(0, 50)),
    projects: projectRows.map((r) => projectShape(env, r, owners)),
    communities_active,
    people,
  };
}

// ── Events ─────────────────────────────────────────────────────────────────

async function events(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const q = ctx.url.searchParams;
  const from = optInt(q.get("from"), now());
  const until = optInt(q.get("until"));
  const where = [VISIBLE_POSTS, "p.kind = 'event'", "json_extract(p.meta_json, '$.starts_at') >= ?"];
  const binds = [...visibleBinds(viewer), from];
  if (until != null) { where.push("json_extract(p.meta_json, '$.starts_at') <= ?"); binds.push(until); }
  if (q.get("community")) {
    const c = await findCommunity(env, q.get("community"));
    where.push("p.community_id = ?"); binds.push(c ? c.id : "");
  }
  // Soonest first; the cursor carries (starts_at, id) in the usual format.
  const c = decodeCursor(q.get("cursor"));
  if (c) {
    where.push("(json_extract(p.meta_json, '$.starts_at') > ? OR (json_extract(p.meta_json, '$.starts_at') = ? AND p.id > ?))");
    binds.push(c.at, c.at, c.id);
  }
  const rows = (await env.DB.prepare(
    `SELECT p.*, json_extract(p.meta_json, '$.starts_at') AS starts_at FROM posts p WHERE ${where.join(" AND ")}
      ORDER BY starts_at, p.id LIMIT ?`,
  ).bind(...binds, PAGE + 1).all()).results;
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return {
    items: await shapePosts(env, viewer, page),
    next: more ? encodeCursor({ created_at: last.starts_at, id: last.id }) : null,
  };
}

export const routes = [
  ["GET", "/v1/search", search],
  ["GET", "/v1/tags/trending", trending],
  ["GET", "/v1/map", map],
  ["GET", "/v1/places", places],
  ["GET", "/v1/events", events],
];
