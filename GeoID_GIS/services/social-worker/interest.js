/**
 * Where members work: declared study areas, and the map of interest built
 * from them.
 *
 * THE MAP COUNTS PEOPLE, NOT POSTS. A cell's size is the number of distinct
 * researchers with a reason to be there -- a declared study area, a public
 * post, a public project -- so one prolific author does not look like a
 * crowd, and somebody who quietly declares Etna as their study area counts as
 * much as somebody who posts about it daily. Posts and projects are reported
 * beside the head count, not folded into it.
 *
 * TRENDING is activity in the last 30 days against the 30 before, per cell.
 * It says where attention is growing, not who is best; the page says so.
 *
 * CONSENT. Only study areas the member put on the map (on_map = 1), public
 * posts and public projects count, and only at the precision already stored
 * (snapped on write). The people listed for a cell are those same members,
 * each with the reason they are counted, and never anyone either side of a
 * block from the viewer.
 */
import {
  fail, now, id, str, int, tags, parse, oneOf, snapLocation, currentUser, requireUser,
  rateLimit, usersById, userByHandle, blockedBetween, NOT_BLOCKED, readJson,
} from "./lib.js";
import { shapePosts } from "./posts.js";

const MAX_AREAS = 10;
const WINDOW = 30 * 24 * 3600;
const RADII = [5, 10, 25, 50, 100, 250, 500];
const MIN_CELL = 0.25;
const MAX_CELL = 45;

function areaShape(row) {
  return {
    id: row.id, name: row.name, world: row.world,
    location: { lat: row.lat, lon: row.lon, precision: row.loc_precision },
    radius_km: row.radius_km, tags: parse(row.tags_json, []), on_map: !!row.on_map, created_at: row.created_at,
  };
}

function areaFields(body, base) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!base || has("name")) {
    out.name = str(body.name, 120);
    if (!out.name) fail(400, "Give the study area a name, e.g. “Mount Etna”.");
  }
  if (!base || has("location") || has("lat") || has("lon")) {
    const loc = body.location && typeof body.location === "object" ? body.location : body;
    // Approx or region only: a study area is a place of work, and "exact"
    // would be the one precision that could point at a field station gate.
    const precision = oneOf(loc.precision, ["approx", "region"], "approx");
    const snapped = snapLocation(loc.lat, loc.lon, precision);
    if (snapped.lat == null) fail(400, "A study area needs a latitude and longitude.");
    Object.assign(out, { lat: snapped.lat, lon: snapped.lon, loc_precision: snapped.loc_precision });
  }
  if (!base || has("world")) out.world = str(body.world, 40).toLowerCase() || "earth";
  if (!base || has("radius_km")) {
    const r = int(body.radius_km, 50);
    out.radius_km = RADII.reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), 50);
  }
  if (!base || has("tags")) out.tags_json = JSON.stringify(tags(body.tags));
  if (!base || has("on_map")) out.on_map = body.on_map === false || body.on_map === 0 ? 0 : 1;
  return out;
}

async function myAreas(ctx) {
  const user = await requireUser(ctx);
  const { results } = await ctx.env.DB.prepare(
    "SELECT * FROM study_areas WHERE user_id = ? ORDER BY created_at",
  ).bind(user.id).all();
  return { items: results.map(areaShape), next: null, max: MAX_AREAS };
}

async function addArea(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM study_areas WHERE user_id = ?").bind(user.id).first("n");
  if (n >= MAX_AREAS) fail(409, `You can list up to ${MAX_AREAS} study areas.`);
  const f = areaFields(await readJson(ctx.request), null);
  const row = { id: id("sa"), user_id: user.id, ...f, created_at: now() };
  await ctx.env.DB.prepare(
    `INSERT INTO study_areas (id, user_id, name, world, lat, lon, loc_precision, radius_km, tags_json, on_map, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.user_id, row.name, row.world, row.lat, row.lon, row.loc_precision, row.radius_km,
    row.tags_json, row.on_map, row.created_at).run();
  return areaShape(row);
}

async function ownArea(ctx) {
  const user = await requireUser(ctx);
  const row = await ctx.env.DB.prepare("SELECT * FROM study_areas WHERE id = ?").bind(ctx.params.id).first();
  if (!row || row.user_id !== user.id) fail(404, "No such study area.");
  return { user, row };
}

async function editArea(ctx) {
  const { user, row } = await ownArea(ctx);
  await rateLimit(ctx, user);
  const f = areaFields(await readJson(ctx.request), row);
  const cols = Object.keys(f);
  if (cols.length) {
    await ctx.env.DB.prepare(`UPDATE study_areas SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...cols.map((c) => f[c]), row.id).run();
  }
  return areaShape({ ...row, ...f });
}

async function deleteArea(ctx) {
  const { row } = await ownArea(ctx);
  await ctx.env.DB.prepare("DELETE FROM study_areas WHERE id = ?").bind(row.id).run();
  return { ok: true };
}

async function userAreas(ctx) {
  const viewer = await currentUser(ctx);
  const target = await userByHandle(ctx.env, ctx.params.handle);
  if (!target || (viewer && await blockedBetween(ctx.env, viewer.id, target.id))) fail(404, "No such member.");
  const { results } = await ctx.env.DB.prepare(
    "SELECT * FROM study_areas WHERE user_id = ? ORDER BY created_at",
  ).bind(target.id).all();
  return { items: results.map(areaShape), next: null };
}

// ── The map of interest ────────────────────────────────────────────────────

/** A world id as used in SQL literals below: a-z, 0-9, _ and - only. */
function worldOf(text) {
  return str(text, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "") || "earth";
}

function bboxOf(text) {
  const parts = String(text || "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) return { w: -180, s: -90, e: 180, n: 90 };
  const [w, s, e, n] = parts;
  return { w: Math.max(-180, w), s: Math.max(-90, s), e: Math.min(180, e), n: Math.min(90, n) };
}

/**
 * Cell size in degrees for a map zoom level: finer than the post clusters,
 * because these are drawn as a density, and never finer than 0.25 deg --
 * below the 0.1 deg most locations are rounded to, a finer grid would only
 * split one rounded point across cells that look like separate groups.
 */
export function cellDegrees(z) {
  const deg = 360 / 2 ** (Math.max(0, Math.min(20, z)) + 4);
  return Math.min(MAX_CELL, Math.max(MIN_CELL, deg));
}

/** Rising, new or steady, from the two windows. Exported for the tests. */
export function trendOf(recent, prior) {
  if (recent >= 1 && prior === 0) return "new";
  if (recent >= 2 && recent >= prior * 1.5) return "rising";
  return "steady";
}

/**
 * The three sources as (cell, person) rows, so a person counts once per cell
 * however much they posted. Every source applies the same filters: world,
 * box, public, not blocked, and the tag if one is asked for.
 */
async function sourceRows(env, viewer, { world, box, deg, tag, t }) {
  const cell = `CAST((x.lat + 90) / ? AS INTEGER) AS cy, CAST((x.lon + 180) / ? AS INTEGER) AS cx`;
  const blocks = viewer ? [`AND ${NOT_BLOCKED("x.uid")}`, [viewer.id, viewer.id]] : ["", []];
  const inBox = "x.lat BETWEEN ? AND ? AND x.lon BETWEEN ? AND ?";
  const boxBinds = [box.s, box.n, box.w, box.e];
  const run = async (from, tagSql) => (await env.DB.prepare(
    `SELECT ${cell}, x.uid AS uid, COUNT(*) AS n,
            SUM(CASE WHEN x.created_at >= ? THEN 1 ELSE 0 END) AS recent,
            SUM(CASE WHEN x.created_at >= ? AND x.created_at < ? THEN 1 ELSE 0 END) AS prior,
            SUM(x.lat) AS slat, SUM(x.lon) AS slon
       FROM (${from}) x WHERE ${inBox} ${blocks[0]} ${tag ? tagSql : ""}
      GROUP BY cy, cx, x.uid`,
  ).bind(deg, deg, t - WINDOW, t - 2 * WINDOW, t - WINDOW, ...boxBinds, ...blocks[1], ...(tag ? [tag] : [])).all()).results;

  const posts = await run(
    `SELECT p.id, p.author_id AS uid, p.lat, p.lon, p.created_at FROM posts p
      WHERE p.removed_at IS NULL AND p.visibility = 'public' AND p.lat IS NOT NULL
        AND p.loc_precision != 'hidden' AND p.world = '${world.replace(/'/g, "")}'`,
    "AND EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = x.id AND pt.tag = ?)");
  const projects = await run(
    `SELECT pr.id, pr.owner_id AS uid, pr.lat, pr.lon, pr.created_at, pr.tags_json FROM projects pr
      WHERE pr.removed_at IS NULL AND pr.visibility = 'public' AND pr.lat IS NOT NULL
        AND pr.loc_precision != 'hidden' AND pr.world = '${world.replace(/'/g, "")}'`,
    "AND EXISTS (SELECT 1 FROM json_each(x.tags_json) WHERE value = ?)");
  const areas = await run(
    `SELECT sa.id, sa.user_id AS uid, sa.lat, sa.lon, sa.created_at, sa.tags_json FROM study_areas sa
      JOIN users u ON u.id = sa.user_id
      WHERE sa.on_map = 1 AND u.suspended_until <= ${t} AND u.email NOT LIKE 'erased:%'
        AND sa.world = '${world.replace(/'/g, "")}'`,
    "AND EXISTS (SELECT 1 FROM json_each(x.tags_json) WHERE value = ?)");
  return { posts, projects, areas };
}

/** Top tags per cell, from public posts and on-map study areas. */
async function cellTags(env, { world, box, deg }) {
  const w = world.replace(/'/g, "");
  const rows = (await env.DB.prepare(
    `SELECT cy, cx, tag, SUM(n) AS n FROM (
       SELECT CAST((p.lat + 90) / ? AS INTEGER) AS cy, CAST((p.lon + 180) / ? AS INTEGER) AS cx, pt.tag AS tag, COUNT(*) AS n
         FROM posts p JOIN post_tags pt ON pt.post_id = p.id
        WHERE p.removed_at IS NULL AND p.visibility = 'public' AND p.lat IS NOT NULL AND p.loc_precision != 'hidden'
          AND p.world = '${w}' AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ?
        GROUP BY cy, cx, pt.tag
       UNION ALL
       SELECT CAST((sa.lat + 90) / ? AS INTEGER), CAST((sa.lon + 180) / ? AS INTEGER), j.value, COUNT(*)
         FROM study_areas sa, json_each(sa.tags_json) j
        WHERE sa.on_map = 1 AND sa.world = '${w}' AND sa.lat BETWEEN ? AND ? AND sa.lon BETWEEN ? AND ?
        GROUP BY 1, 2, 3)
     GROUP BY cy, cx, tag`,
  ).bind(deg, deg, box.s, box.n, box.w, box.e, deg, deg, box.s, box.n, box.w, box.e).all()).results;
  const out = new Map();
  for (const r of rows) {
    const k = `${r.cy}:${r.cx}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([r.tag, r.n]);
  }
  for (const [k, list] of out) out.set(k, list.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag]) => tag));
  return out;
}

/** A name for each cell: the commonest place name or study-area name in it. */
async function cellPlaces(env, { world, box, deg }) {
  const w = world.replace(/'/g, "");
  const rows = (await env.DB.prepare(
    `SELECT cy, cx, name, SUM(n) AS n FROM (
       SELECT CAST((p.lat + 90) / ? AS INTEGER) AS cy, CAST((p.lon + 180) / ? AS INTEGER) AS cx, p.place_name AS name, COUNT(*) AS n
         FROM posts p WHERE p.removed_at IS NULL AND p.visibility = 'public' AND p.place_name != '' AND p.lat IS NOT NULL
          AND p.loc_precision != 'hidden' AND p.world = '${w}' AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ?
        GROUP BY 1, 2, 3
       UNION ALL
       SELECT CAST((sa.lat + 90) / ? AS INTEGER), CAST((sa.lon + 180) / ? AS INTEGER), sa.name, COUNT(*)
         FROM study_areas sa WHERE sa.on_map = 1 AND sa.world = '${w}' AND sa.lat BETWEEN ? AND ? AND sa.lon BETWEEN ? AND ?
        GROUP BY 1, 2, 3)
     GROUP BY cy, cx, name ORDER BY n DESC`,
  ).bind(deg, deg, box.s, box.n, box.w, box.e, deg, deg, box.s, box.n, box.w, box.e).all()).results;
  // The commonest name, and how many other named areas share the cell, so
  // a coarse cell spanning the Alps and the Pennines is never labelled as if
  // it were only one of them.
  const out = new Map();
  for (const r of rows) {
    const k = `${r.cy}:${r.cx}`;
    const names = out.get(k) || new Set();
    names.add(String(r.name).trim().toLowerCase() === "" ? null : r.name);
    out.set(k, names);
  }
  for (const [k, names] of out) {
    const list = [...names].filter(Boolean);
    out.set(k, { name: list[0] || "", more: Math.max(0, new Set(list.map((n) => n.toLowerCase())).size - 1) });
  }
  return out;
}

async function interest(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const q = ctx.url.searchParams;
  const world = worldOf(q.get("world"));
  const box = bboxOf(q.get("bbox"));
  const deg = cellDegrees(int(q.get("z"), 1));
  const tag = tags([q.get("tag") || ""])[0] || "";
  const t = now();
  const src = await sourceRows(env, viewer, { world, box, deg, tag, t });

  const cells = new Map();
  const everyone = new Set();
  const take = (rows, field) => {
    for (const r of rows) {
      const k = `${r.cy}:${r.cx}`;
      const c = cells.get(k) || { cy: r.cy, cx: r.cx, users: new Set(), posts: 0, projects: 0, study_areas: 0,
        recent: 0, prior: 0, slat: 0, slon: 0, n: 0 };
      c.users.add(r.uid); everyone.add(r.uid);
      c[field] += r.n; c.recent += r.recent; c.prior += r.prior;
      c.slat += r.slat; c.slon += r.slon; c.n += r.n;
      cells.set(k, c);
    }
  };
  take(src.posts, "posts");
  take(src.projects, "projects");
  take(src.areas, "study_areas");

  const tagMap = cells.size ? await cellTags(env, { world, box, deg }) : new Map();
  const placeMap = cells.size ? await cellPlaces(env, { world, box, deg }) : new Map();
  const out = [...cells.entries()].map(([k, c]) => ({
    key: k,
    lat: Number((c.slat / c.n).toFixed(3)),
    lon: Number((c.slon / c.n).toFixed(3)),
    // The cell's own bounds, so the page can ask "who is here" for exactly it.
    cell: { s: c.cy * deg - 90, w: c.cx * deg - 180, size: deg },
    researchers: c.users.size,
    posts: c.posts, projects: c.projects, study_areas: c.study_areas,
    recent: c.recent, prior: c.prior, trend: trendOf(c.recent, c.prior),
    top_tags: tagMap.get(k) || [],
    place: placeMap.get(k)?.name || "",
    places_more: placeMap.get(k)?.more || 0,
  })).sort((a, b) => b.researchers - a.researchers);

  const trending = out.filter((c) => c.recent > 0 && c.trend !== "steady")
    .sort((a, b) => (b.recent - b.prior) - (a.recent - a.prior) || b.researchers - a.researchers)
    .slice(0, 8);
  return {
    cell_deg: deg,
    window_days: WINDOW / 86400,
    researchers: everyone.size,
    cells: out,
    trending,
    note: "Sized by how many people work here, not by how much they post. Trending compares the last 30 days with the 30 before.",
  };
}

/** Who is counted in one cell, and why. */
async function interestCell(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const q = ctx.url.searchParams;
  const world = worldOf(q.get("world"));
  const s = Number(q.get("s")); const w = Number(q.get("w"));
  const size = Number(q.get("size"));
  if (![s, w, size].every(Number.isFinite) || size < MIN_CELL || size > MAX_CELL) fail(400, "Give the cell as s, w and size.");
  const box = { s, w, n: s + size, e: w + size };
  const blocks = viewer ? [`AND ${NOT_BLOCKED("x.uid")}`, [viewer.id, viewer.id]] : ["", []];
  const inBox = [box.s, box.n, box.w, box.e];
  const per = async (sql, binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;

  const areas = await per(
    `SELECT x.uid, x.name FROM (SELECT sa.user_id AS uid, sa.name, sa.lat, sa.lon FROM study_areas sa
       WHERE sa.on_map = 1 AND sa.world = ?) x WHERE x.lat >= ? AND x.lat < ? AND x.lon >= ? AND x.lon < ? ${blocks[0]}`,
    [world, ...inBox, ...blocks[1]]);
  const posts = await per(
    `SELECT x.uid, COUNT(*) AS n FROM (SELECT p.author_id AS uid, p.lat, p.lon FROM posts p
       WHERE p.removed_at IS NULL AND p.visibility = 'public' AND p.lat IS NOT NULL AND p.loc_precision != 'hidden' AND p.world = ?) x
      WHERE x.lat >= ? AND x.lat < ? AND x.lon >= ? AND x.lon < ? ${blocks[0]} GROUP BY x.uid`,
    [world, ...inBox, ...blocks[1]]);
  const projects = await per(
    `SELECT x.uid, COUNT(*) AS n FROM (SELECT pr.owner_id AS uid, pr.lat, pr.lon FROM projects pr
       WHERE pr.removed_at IS NULL AND pr.visibility = 'public' AND pr.lat IS NOT NULL AND pr.loc_precision != 'hidden' AND pr.world = ?) x
      WHERE x.lat >= ? AND x.lat < ? AND x.lon >= ? AND x.lon < ? ${blocks[0]} GROUP BY x.uid`,
    [world, ...inBox, ...blocks[1]]);

  const reasons = new Map();
  const say = (uid, text) => { if (!reasons.has(uid)) reasons.set(uid, []); reasons.get(uid).push(text); };
  for (const a of areas) say(a.uid, `Lists “${a.name}” as a study area`);
  for (const p of posts) say(p.uid, `${p.n} public post${p.n === 1 ? "" : "s"} here`);
  for (const p of projects) say(p.uid, `${p.n} public project${p.n === 1 ? "" : "s"} here`);
  const users = await usersById(env, [...reasons.keys()]);
  const people = [...reasons.entries()]
    .filter(([uid]) => users[uid] && !String(users[uid].handle).startsWith("erased_"))
    .map(([uid, why]) => ({ user: users[uid], reasons: why }))
    .sort((a, b) => b.reasons.length - a.reasons.length || a.user.handle.localeCompare(b.user.handle))
    .slice(0, 50);

  const recentPosts = (await env.DB.prepare(
    `SELECT p.* FROM posts p WHERE p.removed_at IS NULL AND p.visibility = 'public' AND p.lat IS NOT NULL
       AND p.loc_precision != 'hidden' AND p.world = ? AND p.lat >= ? AND p.lat < ? AND p.lon >= ? AND p.lon < ?
       ${viewer ? `AND ${NOT_BLOCKED("p.author_id")}` : ""}
     ORDER BY p.created_at DESC LIMIT 8`,
  ).bind(world, ...inBox, ...(viewer ? [viewer.id, viewer.id] : [])).all()).results;

  return { cell: { s, w, size }, people, posts: await shapePosts(env, viewer, recentPosts) };
}

export const routes = [
  ["GET", "/v1/me/study-areas", myAreas],
  ["POST", "/v1/me/study-areas", addArea],
  ["PATCH", "/v1/me/study-areas/:id", editArea],
  ["DELETE", "/v1/me/study-areas/:id", deleteArea],
  ["GET", "/v1/users/:handle/study-areas", userAreas],
  ["GET", "/v1/map/interest", interest],
  ["GET", "/v1/map/interest/cell", interestCell],
];
