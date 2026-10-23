/**
 * Posts: every kind of post, its comments, reactions, bookmarks,
 * verifications, forks and citations, and the feeds.
 *
 * Two rules hold everywhere in this file:
 *   * A post the viewer may not see is a 404, never a 403, so a probe cannot
 *     learn that it exists. canSeePost() decides single posts and
 *     VISIBLE_POSTS decides lists; both live in lib.js so they cannot drift.
 *   * Counters (reactions, comments, forks) are RECOUNTED from the rows they
 *     count in the same batch as the write, never incremented. A double tap,
 *     a retry or two requests racing cannot make them drift, and removal is
 *     the same statement as addition.
 */
import {
  PAGE, fail, now, id, str, url, int, oneOf, tags, parse, readJson,
  requireUser, currentUser, isAdmin, publicPost, usersById, userByHandle,
  canSeePost, VISIBLE_POSTS, visibleBinds, snapLocation, encodeCursor, decodeCursor,
  notify, rateLimit, teamRole, communityRole, blockedBetween, NOT_BLOCKED,
} from "./lib.js";
import { enumOf, recountStatement } from "./profiles.js";

export const KINDS = ["text", "scene", "analysis", "monitor", "observation", "workflow", "dataset", "paper",
  "question", "discussion", "event", "opportunity", "challenge", "model", "repo"];
const PROVENANCE = ["observed", "derived", "modelled", "forecast", "ai", "unverified"];
const VISIBILITY = ["public", "unlisted", "followers", "team", "community", "project", "private"];
export const REACTIONS = ["like", "insightful", "reproduced", "useful"];
const COMMENT_KINDS = ["comment", "correction", "suggestion"];
const OPPORTUNITY_TYPES = ["job", "grant", "fellowship", "internship", "studentship", "project", "consultancy",
  "expedition", "hackathon", "expertise", "service"];
const EVENT_FORMATS = ["webinar", "seminar", "workshop", "hackathon", "field-course", "poster-session"];
const RESEARCH_KINDS = ["analysis", "workflow", "dataset", "paper", "monitor", "model", "repo"];
const MESHERS = ["gmsh", "blender"];
const REPO_HOSTS = ["github", "gitlab", "codeberg", "other"];
const MAX_MODEL_CONFIG_BYTES = 32 * 1024;
const OPPORTUNITY_KINDS = ["opportunity", "event", "challenge"];

// ── Paging ─────────────────────────────────────────────────────────────────

/** "Older than the cursor" over `alias`.created_at/id, newest-first lists. */
export function olderThan(cursorText, alias = "p") {
  const c = decodeCursor(cursorText);
  if (!c) return { sql: "", binds: [] };
  return {
    sql: ` AND (${alias}.created_at < ? OR (${alias}.created_at = ? AND ${alias}.id < ?))`,
    binds: [c.at, c.at, c.id],
  };
}

/** Rows fetched with LIMIT PAGE + 1 -> the page and the cursor after it. */
export function pageOf(rows, limit = PAGE, key = (r) => r) {
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  return { page, next: more ? encodeCursor(key(page[page.length - 1])) : null };
}

// ── Cleaning what was sent ─────────────────────────────────────────────────

/**
 * Free-form JSON (meta, method) made safe to store and render: every string
 * through str(), bounded depth, keys and lengths, no functions or NaN. The
 * renderer then never meets a 2 MB string or a 40-level object.
 */
function cleanValue(value, depth = 0) {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return str(value, 4000);
  if (depth >= 5) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => cleanValue(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 60)) {
      const key = str(k, 60);
      if (key) out[key] = cleanValue(v, depth + 1);
    }
    return out;
  }
  return null;
}

function cleanObject(value, label, maxBytes = 16 * 1024) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail(400, `${label} must be an object.`);
  const out = cleanValue(value);
  if (JSON.stringify(out).length > maxBytes) fail(413, `${label} is too large.`);
  return out;
}

/**
 * An integer, or `fallback` when absent. lib.js int() reads null and "" as 0
 * (Number(null) is finite), which would turn a missing `until` into 1970.
 */
export const optInt = (v, fallback = null) => (v == null || v === "" ? fallback : int(v, fallback));

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Kind-specific meta. Fields the contract names are typed (times as epoch
 * seconds, links through url(), skills through tags()); anything else the
 * page sends is kept, cleaned.
 */
function hostOf(link) {
  const host = new URL(link).hostname;
  return host === "github.com" ? "github" : host === "gitlab.com" ? "gitlab" : host === "codeberg.org" ? "codeberg" : "other";
}

function cleanMeta(kind, raw) {
  const meta = cleanObject(raw, "meta");
  if (kind === "opportunity") {
    if (meta.type != null) meta.type = enumOf(meta.type, OPPORTUNITY_TYPES, "meta.type");
    if ("org" in meta) meta.org = str(meta.org, 200);
    if ("deadline" in meta) meta.deadline = optInt(meta.deadline);
    if ("skills" in meta) meta.skills = tags(meta.skills);
    if ("paid" in meta) meta.paid = !!meta.paid;
    if ("apply_url" in meta) meta.apply_url = url(meta.apply_url);
  }
  if (kind === "event") {
    if ("starts_at" in meta) meta.starts_at = optInt(meta.starts_at);
    if ("ends_at" in meta) meta.ends_at = optInt(meta.ends_at);
    if ("where" in meta) meta.where = str(meta.where, 200);
    if ("url" in meta) meta.url = url(meta.url);
    if (meta.format != null && meta.format !== "") meta.format = enumOf(meta.format, EVENT_FORMATS, "meta.format");
  }
  if (kind === "workflow" || kind === "dataset") {
    if ("repo" in meta) meta.repo = url(meta.repo);
    if ("doi" in meta) meta.doi = str(meta.doi, 120);
    if ("version" in meta) meta.version = str(meta.version, 60);
  }
  if (kind === "paper") {
    if ("doi" in meta) meta.doi = str(meta.doi, 120);
    if ("journal" in meta) meta.journal = str(meta.journal, 200);
    if ("year" in meta) meta.year = optInt(meta.year);
  }
  if (kind === "monitor") {
    if ("updated_at" in meta) meta.updated_at = optInt(meta.updated_at);
    if ("series" in meta) {
      meta.series = (Array.isArray(meta.series) ? meta.series : []).slice(0, 20).map((s) => ({
        label: str(s?.label, 120),
        unit: str(s?.unit, 40),
        points: (Array.isArray(s?.points) ? s.points : []).slice(0, 5000)
          .filter((pt) => Array.isArray(pt) && num(pt[0]) != null && num(pt[1]) != null)
          .map((pt) => [num(pt[0]), num(pt[1])]),
      }));
    }
  }
  if (kind === "analysis") {
    if ("uncertainty" in meta) meta.uncertainty = str(meta.uncertainty, 4000);
  }
  if (kind === "model") {
    // A model page's setup BY REFERENCE: which mesher, which page opens it,
    // the domain and the parameters. Never a mesh -- those are rebuilt from
    // the config, or stay on the author's disk.
    meta.mesher = meta.mesher == null || meta.mesher === "" ? "gmsh" : enumOf(meta.mesher, MESHERS, "meta.mesher");
    if ("page" in meta) {
      const page = str(meta.page, 200);
      // A site path only: "Open in GeoHUB" navigates to it, so a full URL here
      // would be an open redirect dressed as a model.
      meta.page = /^\/[A-Za-z0-9_\-./]*$/.test(page) && !page.startsWith("//") ? page : "";
    }
    if ("solver" in meta) meta.solver = str(meta.solver, 120);
    if ("config" in meta && JSON.stringify(meta.config).length > MAX_MODEL_CONFIG_BYTES) {
      fail(413, "The model config is too large to share — share it by reference (≤ 32 KB).");
    }
  }
  if (kind === "repo") {
    meta.url = url(meta.url);
    if (!meta.url || !meta.url.startsWith("https://")) fail(400, "A repository post needs an https link to the repository.");
    meta.host = meta.host == null || meta.host === "" ? hostOf(meta.url) : enumOf(meta.host, REPO_HOSTS, "meta.host");
    if ("language" in meta) meta.language = str(meta.language, 60);
    if ("licence" in meta) meta.licence = str(meta.licence, 60);
    if ("default_branch" in meta) meta.default_branch = str(meta.default_branch, 100);
  }
  if (JSON.stringify(meta).length > 256 * 1024) fail(413, "meta is too large.");
  return meta;
}

/**
 * A scene: what GeoHUB needs to reopen a view. Its coordinates are snapped
 * to the post's location precision because a camera parked over a field
 * site says where the site is just as plainly as `location` does; a post
 * with a hidden location snaps its scene to 1 deg (region) so the scene
 * still opens near the right place without pinpointing it.
 */
function cleanScene(raw, precision) {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) fail(400, "scene must be an object.");
  const p = precision === "hidden" ? "region" : precision;
  const pt = (lat, lon) => {
    const s = snapLocation(lat, lon, p);
    return s.lat == null ? { lat: null, lon: null } : { lat: s.lat, lon: s.lon };
  };
  const cam = raw.camera && typeof raw.camera === "object" ? raw.camera : {};
  return {
    world: str(raw.world, 40) || "earth",
    camera: { ...pt(cam.lat, cam.lon), alt: num(cam.alt), heading: num(cam.heading), pitch: num(cam.pitch) },
    layers: (Array.isArray(raw.layers) ? raw.layers : []).slice(0, 50).map((l) => ({
      id: str(l?.id, 120), name: str(l?.name, 200), source: str(l?.source, 500),
      opacity: num(l?.opacity) == null ? 1 : Math.min(1, Math.max(0, num(l.opacity))),
      visible: l?.visible !== false,
    })),
    annotations: (Array.isArray(raw.annotations) ? raw.annotations : []).slice(0, 100)
      .map((a) => ({ ...pt(a?.lat, a?.lon), text: str(a?.text, 500) })),
    time: raw.time == null ? null : str(raw.time, 60),
  };
}

function cleanLinks(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 20)
    .map((l) => ({ url: url(l?.url ?? l), label: str(l?.label, 200) })).filter((l) => l.url);
}

function cleanSources(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 50).map((s) => ({
    label: str(s?.label ?? (typeof s === "string" ? s : ""), 300), url: url(s?.url), doi: str(s?.doi, 120), licence: str(s?.licence, 60),
  })).filter((s) => s.label || s.url || s.doi);
}

/** Team by id or slug. */
async function findTeam(env, ref) {
  if (!ref) return null;
  return env.DB.prepare("SELECT * FROM teams WHERE id = ? OR slug = ?").bind(String(ref), String(ref)).first();
}
/** Community by id or slug. */
export async function findCommunity(env, ref) {
  if (!ref) return null;
  return env.DB.prepare("SELECT * FROM communities WHERE id = ? OR slug = ?").bind(String(ref), String(ref).toLowerCase()).first();
}

/** May `user` attach a post to `project`? Owner, its team, or a write-ish grant. */
async function mayPostToProject(env, user, project) {
  if (!project || project.removed_at) return false;
  if (project.owner_id === user.id) return true;
  if (project.team_id && await teamRole(env, project.team_id, user.id)) return true;
  const grant = await env.DB.prepare(
    `SELECT 1 FROM grants WHERE project_id = ? AND role IN ('editor', 'commenter', 'forker')
        AND (expires_at IS NULL OR expires_at > ?) AND (
          (grantee_type = 'user' AND grantee_id = ?) OR
          (grantee_type = 'team' AND grantee_id IN (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active')))`,
  ).bind(project.id, now(), user.id, user.id).first();
  return !!grant;
}

/**
 * The stored columns for a post from a request body. `base` is the existing
 * row on PATCH (only fields present in the body change) or null on create.
 */
async function postFields(env, user, body, base) {
  const has = (k) => body[k] !== undefined;
  const out = {};
  const pick = (k, fn) => { if (!base || has(k)) out[k] = fn(body[k]); };

  if (!base || has("kind")) out.kind = body.kind == null ? (base?.kind || "text") : enumOf(body.kind, KINDS, "kind");
  const kind = out.kind || base.kind;
  pick("title", (v) => str(v, 300));
  pick("body", (v) => str(v, 20000));
  if (has("body") && String(body.body ?? "").length > 20000) fail(413, "A post body is at most 20,000 characters.");
  const title = out.title ?? base?.title ?? "";
  const text = out.body ?? base?.body ?? "";
  if (!title && !text) fail(400, "A post needs a title or a body.");

  if (!base || has("tags")) out.tags_json = JSON.stringify(tags(body.tags));
  if (!base || has("location")) {
    const loc = body.location && typeof body.location === "object" ? body.location : null;
    const snapped = loc ? snapLocation(loc.lat, loc.lon, loc.precision) : snapLocation(null, null, "hidden");
    out.lat = snapped.lat;
    out.lon = snapped.lon;
    out.loc_precision = snapped.loc_precision;
    out.place_name = loc ? str(loc.place, 120) : "";
  }
  if (!base || has("world")) out.world = str(body.world, 40).toLowerCase().replace(/[^a-z0-9-]/g, "") || "earth";
  if (!base || has("scene") || has("location")) {
    const precision = out.loc_precision ?? base?.loc_precision ?? "hidden";
    const raw = has("scene") ? body.scene : parse(base?.scene_json, null);
    const scene = cleanScene(raw, precision);
    out.scene_json = scene ? JSON.stringify(scene) : null;
  }
  if (!base || has("media")) {
    const list = (Array.isArray(body.media) ? body.media : []).slice(0, 12);
    const media = [];
    for (const m of list) {
      const key = str(m?.key ?? m, 200);
      if (!key) continue;
      const row = await env.DB.prepare("SELECT * FROM media WHERE key = ?").bind(key).first();
      // Somebody else's key would make their private file part of this post.
      if (!row || row.owner_id !== user.id) fail(400, "Attach only files you uploaded.");
      media.push({ key, type: row.type, alt: str(m?.alt, 500) });
    }
    out.media_json = JSON.stringify(media);
  }
  if (!base || has("links")) out.links_json = JSON.stringify(cleanLinks(body.links));
  if (!base || has("licence")) out.licence = str(body.licence, 60) || "CC-BY-4.0";
  if (!base || has("provenance")) {
    out.provenance = body.provenance == null ? "observed" : enumOf(body.provenance, PROVENANCE, "provenance");
  }
  if (!base || has("sources")) out.sources_json = JSON.stringify(cleanSources(body.sources));
  if (!base || has("method")) out.method_json = JSON.stringify(cleanObject(body.method, "method"));
  if (!base || has("limitations")) out.limitations = str(body.limitations, 5000);
  if (!base || has("meta") || has("kind")) {
    out.meta_json = JSON.stringify(cleanMeta(kind, has("meta") ? body.meta : parse(base?.meta_json, {})));
  }
  if (!base || has("allow_fork")) out.allow_fork = body.allow_fork === undefined ? 1 : (body.allow_fork ? 1 : 0);
  if (!base || has("sponsored_by")) out.sponsored_by = str(body.sponsored_by, 200);

  // Where it lives and who may read it.
  if (!base || has("visibility")) {
    out.visibility = body.visibility == null ? "public" : enumOf(body.visibility, VISIBILITY, "visibility");
  }
  if (!base || has("team_id")) {
    const team = body.team_id ? await findTeam(env, body.team_id) : null;
    if (body.team_id && !team) fail(400, "No such team.");
    out.team_id = team ? team.id : null;
  }
  if (!base || has("community_id")) {
    const c = body.community_id ? await findCommunity(env, body.community_id) : null;
    if (body.community_id && !c) fail(400, "No such community.");
    out.community_id = c ? c.id : null;
  }
  if (!base || has("project_id")) {
    if (body.project_id) {
      const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(String(body.project_id)).first();
      if (!(await mayPostToProject(env, user, project))) fail(400, "You can't post to that project.");
      out.project_id = project.id;
    } else {
      out.project_id = null;
    }
  }
  const visibility = out.visibility ?? base.visibility;
  const teamId = out.team_id !== undefined ? out.team_id : base.team_id;
  const communityId = out.community_id !== undefined ? out.community_id : base.community_id;
  if (visibility === "team") {
    if (!teamId) fail(400, "A team post needs team_id.");
    if (!(await teamRole(env, teamId, user.id))) fail(403, "Only team members can post to the team.");
  }
  if (visibility === "community" && !communityId) fail(400, "A community post needs community_id.");
  // Project visibility: seen by whoever can open the project (lib.js
  // canSeePost). Posting into it was already checked by mayPostToProject.
  const projectId = out.project_id !== undefined ? out.project_id : base.project_id;
  if (visibility === "project" && !projectId) fail(400, "A project post needs project_id.");
  // Posting INTO a community at all (public or members-only) needs membership,
  // so a stranger cannot fill a community's page; checked only when it changes.
  if (communityId && (!base || out.community_id !== undefined && out.community_id !== base.community_id)) {
    if (!(await communityRole(env, communityId, user.id))) fail(403, "Join the community to post in it.");
  }
  return out;
}

const POST_COLUMNS = ["id", "author_id", "kind", "title", "body", "tags_json", "lat", "lon", "loc_precision",
  "place_name", "world", "scene_json", "media_json", "links_json", "licence", "provenance", "sources_json",
  "method_json", "limitations", "meta_json", "visibility", "team_id", "community_id", "project_id",
  "allow_fork", "forked_from", "sponsored_by", "created_at", "updated_at"];

function insertStatements(DB, row) {
  const out = [DB.prepare(
    `INSERT INTO posts (${POST_COLUMNS.join(", ")}) VALUES (${POST_COLUMNS.map(() => "?").join(", ")})`,
  ).bind(...POST_COLUMNS.map((c) => row[c] ?? null))];
  for (const tag of parse(row.tags_json, [])) {
    out.push(DB.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)").bind(row.id, tag));
  }
  return out;
}

async function loadPost(env, postId) {
  return env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(String(postId || "")).first();
}

/** The post if the viewer may see it, else the same 404 as a post that never existed. */
export async function visiblePost(env, viewer, postId) {
  const post = await loadPost(env, postId);
  if (!(await canSeePost(env, viewer, post))) fail(404, "No such post.");
  return post;
}

// ── Shaping ────────────────────────────────────────────────────────────────

export function verificationStatus(confirms, disputes) {
  // Verified needs two people, and more than dispute it; the same rule turned
  // around makes a post disputed. Anything less is simply unverified.
  const status = confirms >= 2 && confirms > disputes ? "community-verified"
    : disputes >= 2 && disputes > confirms ? "disputed" : "unverified";
  return { confirms, disputes, status };
}

const inList = (n) => Array(n).fill("?").join(",");

/** Verification tallies for observation posts, keyed by post id. */
export async function verificationsFor(env, ids) {
  const out = {};
  if (!ids.length) return out;
  const { results } = await env.DB.prepare(
    `SELECT post_id, verdict, COUNT(*) AS n FROM verifications WHERE post_id IN (${inList(ids.length)}) GROUP BY post_id, verdict`,
  ).bind(...ids).all();
  for (const pid of ids) out[pid] = { confirm: 0, dispute: 0 };
  for (const r of results) out[r.post_id][r.verdict] = r.n;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, verificationStatus(v.confirm, v.dispute)]));
}

/**
 * Posts as the page draws them, with the viewer's own state. Every lookup is
 * one IN query over the page, not one per post.
 */
export async function shapePosts(env, viewer, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = inList(ids.length);
  const authors = await usersById(env, rows.map((r) => r.author_id));
  const verification = await verificationsFor(env, rows.filter((r) => r.kind === "observation").map((r) => r.id));
  let reacted = {}, bookmarked = new Set(), verdicts = {}, following = new Set();
  if (viewer) {
    const q = async (sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;
    for (const r of await q(`SELECT post_id, kind FROM reactions WHERE user_id = ? AND post_id IN (${marks})`, viewer.id, ...ids)) {
      (reacted[r.post_id] ||= []).push(r.kind);
    }
    bookmarked = new Set((await q(`SELECT post_id FROM bookmarks WHERE user_id = ? AND post_id IN (${marks})`, viewer.id, ...ids)).map((r) => r.post_id));
    for (const r of await q(`SELECT post_id, verdict FROM verifications WHERE user_id = ? AND post_id IN (${marks})`, viewer.id, ...ids)) {
      verdicts[r.post_id] = r.verdict;
    }
    const authorIds = [...new Set(rows.map((r) => r.author_id))];
    following = new Set((await q(
      `SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'user' AND target_id IN (${inList(authorIds.length)})`,
      viewer.id, ...authorIds)).map((r) => r.target_id));
  }
  return rows.map((row) => {
    const extra = {};
    if (viewer) {
      extra.viewer = {
        reacted: reacted[row.id] || [],
        bookmarked: bookmarked.has(row.id),
        verified: verdicts[row.id] || null,
        following_author: following.has(row.author_id),
      };
    }
    if (row.kind === "observation") extra.verification = verification[row.id];
    return publicPost(env, row, authors, extra);
  });
}

async function onePost(env, viewer, row) {
  return (await shapePosts(env, viewer, [row]))[0];
}

// ── Mentions and followers ─────────────────────────────────────────────────

/** Handles @mentioned in a text. "ana@example.com" is not a mention of "example". */
export function mentionsIn(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/(^|[^a-z0-9_@.])@([a-z0-9_]{3,30})\b/gi)) out.add(m[2].toLowerCase());
  return [...out].slice(0, 10);
}

/**
 * Notify each mentioned person who can SEE the post: a mention must not be a
 * way to tell somebody a private post exists. `already` holds handles that
 * were mentioned before an edit, so an edit does not ping them twice.
 */
async function notifyMentions(env, actor, post, text, refType, refId, already = []) {
  const handles = mentionsIn(text).filter((h) => !already.includes(h) && h !== actor.handle);
  for (const handle of handles) {
    const person = await userByHandle(env, handle);
    if (!person) continue;
    if (!(await canSeePost(env, person, post))) continue;
    await notify(env, person.id, "mention", actor.id, refType, refId, `${actor.name} mentioned you`);
  }
}

// ── Posts ──────────────────────────────────────────────────────────────────

async function createPost(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const body = await readJson(ctx.request);
  const fields = await postFields(env, user, body, null);
  const t = now();
  const row = { ...fields, id: id("p"), author_id: user.id, forked_from: null, created_at: t, updated_at: t };
  await env.DB.batch(insertStatements(env.DB, row));
  const saved = await loadPost(env, row.id);
  await notifyMentions(env, user, saved, `${saved.title}\n${saved.body}`, "post", saved.id);
  return onePost(env, user, saved);
}

async function getPost(ctx) {
  const viewer = await currentUser(ctx);
  const post = await visiblePost(ctx.env, viewer, ctx.params.id);
  return onePost(ctx.env, viewer, post);
}

async function patchPost(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const post = await visiblePost(env, user, ctx.params.id);
  if (post.author_id !== user.id) fail(403, "Only the author can edit this post.");
  const body = await readJson(ctx.request);
  const fields = await postFields(env, user, body, post);
  fields.updated_at = now();
  const cols = Object.keys(fields);
  const statements = [env.DB.prepare(`UPDATE posts SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .bind(...cols.map((c) => fields[c]), post.id)];
  if (fields.tags_json !== undefined) {
    statements.push(env.DB.prepare("DELETE FROM post_tags WHERE post_id = ?").bind(post.id));
    for (const tag of parse(fields.tags_json, [])) {
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)").bind(post.id, tag));
    }
  }
  await env.DB.batch(statements);
  const saved = await loadPost(env, post.id);
  await notifyMentions(env, user, saved, `${saved.title}\n${saved.body}`, "post", saved.id,
    mentionsIn(`${post.title}\n${post.body}`));

  // A monitor's followers asked to hear when its series moves.
  if (saved.kind === "monitor") {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT follower_id FROM follows WHERE (target_type = 'post' AND target_id = ?)
          OR (target_type = 'project' AND target_id = ?) LIMIT 1000`,
    ).bind(saved.id, saved.project_id || "").all();
    for (const { follower_id: fid } of results) {
      const follower = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(fid).first();
      if (follower && await canSeePost(env, follower, saved)) {
        await notify(env, fid, "project_update", user.id, "post", saved.id, `${saved.title || "A monitor"} was updated`);
      }
    }
  }
  return onePost(env, user, saved);
}

async function deletePost(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const admin = isAdmin(env, user);
  const post = admin ? await loadPost(env, ctx.params.id) : await visiblePost(env, user, ctx.params.id);
  if (!post || post.removed_at) fail(404, "No such post.");
  if (post.author_id !== user.id && !admin) fail(403, "Only the author can delete this post.");
  const statements = [env.DB.prepare("UPDATE posts SET removed_at = ?, removed_by = ? WHERE id = ?").bind(now(), user.id, post.id)];
  // A removed fork no longer counts on its source.
  if (post.forked_from) statements.push(recountStatement(env.DB, post.forked_from));
  await env.DB.batch(statements);
  return { ok: true };
}

// ── Feeds ──────────────────────────────────────────────────────────────────

/** Filters every tab accepts, appended to `where`/`binds`. */
async function commonFilters(ctx, viewer, where, binds) {
  const q = ctx.url.searchParams;
  const kind = q.get("kind");
  if (kind) { where.push("p.kind = ?"); binds.push(enumOf(kind, KINDS, "kind")); }
  const tag = tags([q.get("tag") || ""])[0];
  if (tag) { where.push("EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ?)"); binds.push(tag); }
  if (q.get("community")) {
    const c = await findCommunity(ctx.env, q.get("community"));
    where.push("p.community_id = ?"); binds.push(c ? c.id : "");
  }
  if (q.get("project")) { where.push("p.project_id = ?"); binds.push(q.get("project")); }
  if (q.get("author")) {
    const a = await userByHandle(ctx.env, q.get("author"));
    where.push("p.author_id = ?"); binds.push(a ? a.id : "");
  }
  if (q.get("world")) { where.push("p.world = ?"); binds.push(str(q.get("world"), 40).toLowerCase()); }
}

/** discover ranking: engagement decayed by age (hours), as CONTRACT.md says. */
export function discoverScore(row, at = now()) {
  const engagement = row.reaction_count + 2 * row.comment_count + 3 * row.fork_count;
  const hours = Math.max(0, (at - row.created_at) / 3600);
  return engagement / Math.pow(hours + 2, 1.5);
}

const DISCOVER_WINDOW = 30 * 86400;
const DISCOVER_POOL = 500;

async function feed(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const q = ctx.url.searchParams;
  // `all` is the plain newest-first list a profile, community or project page
  // needs: discover leaves out the viewer's own posts and anyone they follow,
  // so it would show a person an incomplete list of their own work. Asking for
  // an author, community or project without naming a tab means the same.
  const scoped = q.get("author") || q.get("community") || q.get("project");
  const tab = oneOf(q.get("tab"), ["all", "following", "discover", "world", "research", "opportunities"],
    scoped ? "all" : "discover");
  const where = [VISIBLE_POSTS];
  const binds = visibleBinds(viewer);
  await commonFilters(ctx, viewer, where, binds);

  if (tab === "discover") {
    // Ranked, so a created_at cursor cannot page it. The ranking is computed
    // over a bounded pool (public posts of the last 30 days, newest 500) and
    // the cursor is an OFFSET into that ranking, carried in the same opaque
    // encodeCursor format as {created_at: offset, id: "discover"}. A post
    // that gains reactions between pages can move; for a discovery list
    // that is acceptable, and it is why the pool is bounded.
    where.push("p.visibility = 'public'", "p.created_at > ?");
    binds.push(now() - DISCOVER_WINDOW);
    if (viewer) {
      where.push("p.author_id != ?",
        "p.author_id NOT IN (SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'user')");
      binds.push(viewer.id, viewer.id);
    }
    const pool = (await env.DB.prepare(
      `SELECT p.* FROM posts p WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT ${DISCOVER_POOL}`,
    ).bind(...binds).all()).results;
    const at = now();
    pool.sort((a, b) => discoverScore(b, at) - discoverScore(a, at) || b.created_at - a.created_at || (a.id < b.id ? 1 : -1));
    const c = decodeCursor(q.get("cursor"));
    const offset = c && c.id === "discover" ? Math.max(0, c.at) : 0;
    const page = pool.slice(offset, offset + PAGE);
    const more = offset + PAGE < pool.length;
    return {
      items: await shapePosts(env, viewer, page),
      next: more ? encodeCursor({ created_at: offset + PAGE, id: "discover" }) : null,
    };
  }

  if (tab === "following") {
    if (!viewer) fail(401, "Sign in to see who you follow.");
    // A followed place is a 0.1 deg key; it covers posts within 0.5 deg
    // (~50 km), the same default radius as /v1/places.
    where.push(`(p.author_id = ?
      OR p.author_id IN (SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'user')
      OR EXISTS (SELECT 1 FROM post_tags pt JOIN follows f ON f.target_type = 'tag' AND f.target_id = pt.tag
                  WHERE pt.post_id = p.id AND f.follower_id = ?)
      OR p.community_id IN (SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'community')
      OR p.community_id IN (SELECT community_id FROM community_members WHERE user_id = ? AND status = 'active')
      OR p.project_id IN (SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'project')
      OR (p.lat IS NOT NULL AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.target_type = 'place'
            AND ABS(p.lat - CAST(substr(f.target_id, 1, instr(f.target_id, ',') - 1) AS REAL)) <= 0.5
            AND ABS(p.lon - CAST(substr(f.target_id, instr(f.target_id, ',') + 1) AS REAL)) <= 0.5)))`);
    binds.push(...Array(7).fill(viewer.id));
  } else if (tab === "world") {
    where.push("p.lat IS NOT NULL", "p.loc_precision != 'hidden'");
  } else if (tab === "research") {
    where.push(`p.kind IN (${inList(RESEARCH_KINDS.length)})`); binds.push(...RESEARCH_KINDS);
  } else if (tab === "opportunities") {
    where.push(`p.kind IN (${inList(OPPORTUNITY_KINDS.length)})`); binds.push(...OPPORTUNITY_KINDS);
    const type = q.get("type");
    if (type) { where.push("json_extract(p.meta_json, '$.type') = ?"); binds.push(enumOf(type, OPPORTUNITY_TYPES, "type")); }
    const skill = tags([q.get("skill") || ""])[0];
    if (skill) {
      where.push("EXISTS (SELECT 1 FROM json_each(p.meta_json, '$.skills') WHERE value = ?)"); binds.push(skill);
    }
  }
  const cursor = olderThan(q.get("cursor"));
  const rows = (await env.DB.prepare(
    `SELECT p.* FROM posts p WHERE ${where.join(" AND ")}${cursor.sql} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
  ).bind(...binds, ...cursor.binds, PAGE + 1).all()).results;
  const { page, next } = pageOf(rows);
  return { items: await shapePosts(env, viewer, page), next };
}

// ── Comments ───────────────────────────────────────────────────────────────

function commentShape(row, authors, post) {
  return {
    id: row.id,
    author: authors[row.author_id] || null,
    body: row.body,
    kind: row.kind,
    parent_id: row.parent_id,
    location: row.lat == null ? null : { lat: row.lat, lon: row.lon },
    created_at: row.created_at,
    accepted: post.accepted_comment_id === row.id,
  };
}

async function listComments(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const post = await visiblePost(env, viewer, ctx.params.id);
  const where = ["c.post_id = ?", "c.removed_at IS NULL"];
  const binds = [post.id];
  if (viewer) { where.push(NOT_BLOCKED("c.author_id")); binds.push(viewer.id, viewer.id); }
  // Oldest first: a thread reads top to bottom, so the cursor walks forward.
  const c = decodeCursor(ctx.url.searchParams.get("cursor"));
  if (c) { where.push("(c.created_at > ? OR (c.created_at = ? AND c.id > ?))"); binds.push(c.at, c.at, c.id); }
  const rows = (await env.DB.prepare(
    `SELECT c.* FROM comments c WHERE ${where.join(" AND ")} ORDER BY c.created_at, c.id LIMIT ?`,
  ).bind(...binds, PAGE * 5 + 1).all()).results;
  const { page, next } = pageOf(rows, PAGE * 5);
  const authors = await usersById(env, page.map((r) => r.author_id));
  return { items: page.map((r) => commentShape(r, authors, post)), next };
}

async function addComment(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  // canSeePost already refuses across a block, so a blocked person gets the
  // same 404 as for a post that does not exist.
  const post = await visiblePost(env, user, ctx.params.id);
  const body = await readJson(ctx.request);
  const text = str(body.body, 5000);
  if (!text) fail(400, "A comment needs some text.");
  const kind = body.kind == null ? "comment" : enumOf(body.kind, COMMENT_KINDS, "kind");
  let parent = null;
  if (body.parent_id) {
    parent = await env.DB.prepare("SELECT * FROM comments WHERE id = ? AND post_id = ? AND removed_at IS NULL")
      .bind(String(body.parent_id), post.id).first();
    if (!parent || await blockedBetween(env, user.id, parent.author_id)) fail(404, "No such comment.");
  }
  // A comment's point is a place in a scene; it gets the post's precision
  // (hidden posts: approx) so a reply cannot pin down what the post blurred.
  const loc = body.lat == null || body.lon == null ? { lat: null, lon: null }
    : snapLocation(body.lat, body.lon, post.loc_precision === "hidden" ? "approx" : post.loc_precision);
  const row = {
    id: id("c"), post_id: post.id, author_id: user.id, parent_id: parent ? parent.id : null,
    body: text, kind, lat: loc.lat, lon: loc.lon, created_at: now(),
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO comments (id, post_id, author_id, parent_id, body, kind, lat, lon, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(row.id, row.post_id, row.author_id, row.parent_id, row.body, row.kind, row.lat, row.lon, row.created_at),
    recountStatement(env.DB, post.id),
  ]);
  const label = post.title || "your post";
  await notify(env, post.author_id, "comment", user.id, "post", post.id, `${user.name} commented on ${label}`);
  if (parent && parent.author_id !== post.author_id) {
    await notify(env, parent.author_id, "comment", user.id, "post", post.id, `${user.name} replied to your comment`);
  }
  await notifyMentions(env, user, post, text, "post", post.id,
    [(await env.DB.prepare("SELECT handle FROM users WHERE id = ?").bind(post.author_id).first("handle"))]);
  const authors = await usersById(env, [user.id]);
  return commentShape(row, authors, post);
}

async function deleteComment(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const comment = await env.DB.prepare("SELECT * FROM comments WHERE id = ? AND removed_at IS NULL").bind(ctx.params.id).first();
  const admin = isAdmin(env, user);
  const post = comment && await loadPost(env, comment.post_id);
  if (!comment || (!admin && !(await canSeePost(env, user, post)))) fail(404, "No such comment.");
  if (comment.author_id !== user.id && post.author_id !== user.id && !admin) {
    fail(403, "Only the commenter, the post's author or a moderator can remove this.");
  }
  const statements = [
    env.DB.prepare("UPDATE comments SET removed_at = ? WHERE id = ?").bind(now(), comment.id),
    recountStatement(env.DB, post.id),
  ];
  if (post.accepted_comment_id === comment.id) {
    statements.push(env.DB.prepare("UPDATE posts SET accepted_comment_id = NULL WHERE id = ?").bind(post.id));
  }
  await env.DB.batch(statements);
  return { ok: true };
}

async function acceptAnswer(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const post = await visiblePost(env, user, ctx.params.id);
  if (post.author_id !== user.id) fail(403, "Only the person who asked can accept an answer.");
  if (post.kind !== "question") fail(400, "Only questions have accepted answers.");
  const body = await readJson(ctx.request);
  if (body.comment_id == null) {
    await env.DB.prepare("UPDATE posts SET accepted_comment_id = NULL WHERE id = ?").bind(post.id).run();
    return onePost(env, user, await loadPost(env, post.id));
  }
  const comment = await env.DB.prepare("SELECT * FROM comments WHERE id = ? AND post_id = ? AND removed_at IS NULL")
    .bind(String(body.comment_id), post.id).first();
  if (!comment) fail(404, "No such comment.");
  await env.DB.prepare("UPDATE posts SET accepted_comment_id = ?, updated_at = ? WHERE id = ?").bind(comment.id, now(), post.id).run();
  await notify(env, comment.author_id, "comment", user.id, "post", post.id, `${user.name} accepted your answer`);
  return onePost(env, user, await loadPost(env, post.id));
}

// ── Reactions, bookmarks, verifications ───────────────────────────────────

async function react(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const post = await visiblePost(env, user, ctx.params.id);
  const body = await readJson(ctx.request);
  const kind = body.kind == null ? "like" : enumOf(body.kind, REACTIONS, "kind");
  const [inserted] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO reactions (post_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)")
      .bind(post.id, user.id, kind, now()),
    recountStatement(env.DB, post.id),
  ]);
  if (inserted.meta.changes) {
    await notify(env, post.author_id, "reaction", user.id, "post", post.id, `${user.name} found ${post.title || "your post"} ${kind === "like" ? "worth a like" : kind}`);
  }
  return onePost(env, user, await loadPost(env, post.id));
}

async function unreact(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const post = await visiblePost(env, user, ctx.params.id);
  const body = await readJson(ctx.request);
  const kind = body.kind == null ? null : enumOf(body.kind, REACTIONS, "kind");
  await env.DB.batch([
    kind ? env.DB.prepare("DELETE FROM reactions WHERE post_id = ? AND user_id = ? AND kind = ?").bind(post.id, user.id, kind)
      : env.DB.prepare("DELETE FROM reactions WHERE post_id = ? AND user_id = ?").bind(post.id, user.id),
    recountStatement(env.DB, post.id),
  ]);
  return onePost(env, user, await loadPost(env, post.id));
}

async function bookmark(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const post = await visiblePost(env, user, ctx.params.id);
  const body = await readJson(ctx.request);
  const collection = str(body.collection, 60) || "Saved";
  await env.DB.prepare(
    `INSERT INTO bookmarks (user_id, post_id, collection, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, post_id) DO UPDATE SET collection = excluded.collection`,
  ).bind(user.id, post.id, collection, now()).run();
  return { ok: true, bookmarked: true, collection };
}

async function unbookmark(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  await ctx.env.DB.prepare("DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?").bind(user.id, ctx.params.id).run();
  return { ok: true, bookmarked: false };
}

async function myBookmarks(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const q = ctx.url.searchParams;
  const where = ["b.user_id = ?", VISIBLE_POSTS];
  const binds = [user.id, ...visibleBinds(user)];
  if (q.get("collection")) { where.push("b.collection = ?"); binds.push(str(q.get("collection"), 60)); }
  // A bookmark keeps nothing a post's author later hid: the list re-applies
  // the visibility rule, so a post made private drops out of others' saves.
  const c = decodeCursor(q.get("cursor"));
  if (c) { where.push("(b.created_at < ? OR (b.created_at = ? AND p.id < ?))"); binds.push(c.at, c.at, c.id); }
  const rows = (await env.DB.prepare(
    `SELECT p.*, b.created_at AS b_at, b.collection AS b_collection FROM bookmarks b JOIN posts p ON p.id = b.post_id
      WHERE ${where.join(" AND ")} ORDER BY b.created_at DESC, p.id DESC LIMIT ?`,
  ).bind(...binds, PAGE + 1).all()).results;
  const { page, next } = pageOf(rows, PAGE, (r) => ({ created_at: r.b_at, id: r.id }));
  const shaped = await shapePosts(env, user, page);
  const collections = (await env.DB.prepare(
    "SELECT collection, COUNT(*) AS count FROM bookmarks WHERE user_id = ? GROUP BY collection ORDER BY collection",
  ).bind(user.id).all()).results;
  return { items: shaped.map((p, i) => ({ ...p, collection: page[i].b_collection })), next, collections };
}

async function verifyPost(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const post = await visiblePost(env, user, ctx.params.id);
  if (post.kind !== "observation") fail(400, "Only observations can be confirmed or disputed.");
  if (post.author_id === user.id) fail(403, "You can't verify your own observation.");
  const body = await readJson(ctx.request);
  const verdict = enumOf(body.verdict, ["confirm", "dispute"], "verdict");
  const note = str(body.note, 1000);
  await env.DB.prepare(
    `INSERT INTO verifications (post_id, user_id, verdict, note, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(post_id, user_id) DO UPDATE SET verdict = excluded.verdict, note = excluded.note, created_at = excluded.created_at`,
  ).bind(post.id, user.id, verdict, note, now()).run();
  await notify(env, post.author_id, "verify", user.id, "post", post.id,
    `${user.name} ${verdict === "confirm" ? "confirmed" : "disputed"} your observation`);
  return onePost(env, user, post);
}

// ── Forks and citations ────────────────────────────────────────────────────

async function forkPost(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const source = await visiblePost(env, user, ctx.params.id);
  if (!source.allow_fork) fail(403, "The author has not allowed forks of this post.");
  const body = await readJson(ctx.request);
  // A fork must not be a way to republish what its author restricted: a fork
  // of a non-public post can only be private to the forker.
  const open = ["public", "unlisted"].includes(source.visibility);
  const allowed = open ? ["public", "unlisted", "followers", "private"] : ["private"];
  const visibility = body.visibility == null ? (open ? "public" : "private") : enumOf(body.visibility, allowed, "visibility");
  const t = now();
  const row = {
    ...source,
    id: id("p"),
    author_id: user.id,
    title: str(body.title, 300) || str(`Fork of ${source.title || "a post"}`, 300),
    // Media keys belong to the original author: a fork links back instead.
    media_json: "[]",
    visibility,
    team_id: null,
    community_id: null,
    project_id: null,
    allow_fork: 1,
    forked_from: source.id,
    sponsored_by: "",
    created_at: t,
    updated_at: t,
  };
  await env.DB.batch([...insertStatements(env.DB, row), recountStatement(env.DB, source.id)]);
  await notify(env, source.author_id, "fork", user.id, "post", row.id, `${user.name} forked ${source.title || "your post"}`);
  return onePost(env, user, await loadPost(env, row.id));
}

async function listForks(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const source = await visiblePost(env, viewer, ctx.params.id);
  const cursor = olderThan(ctx.url.searchParams.get("cursor"));
  const rows = (await env.DB.prepare(
    `SELECT p.* FROM posts p WHERE p.forked_from = ? AND ${VISIBLE_POSTS}${cursor.sql}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
  ).bind(source.id, ...visibleBinds(viewer), ...cursor.binds, PAGE + 1).all()).results;
  const { page, next } = pageOf(rows);
  return { items: await shapePosts(env, viewer, page), next };
}

export function postUrl(env, postId) {
  return `${env.SITE_ORIGIN || ""}/social/?post=${encodeURIComponent(postId)}`;
}

async function cite(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const post = await visiblePost(env, viewer, ctx.params.id);
  const author = await env.DB.prepare("SELECT name, handle FROM users WHERE id = ?").bind(post.author_id).first();
  const year = new Date(post.created_at * 1000).getUTCFullYear();
  const title = post.title || str(post.body, 80) || "Untitled post";
  const link = postUrl(env, post.id);
  const name = author.name || author.handle;
  const bib = (s) => String(s).replace(/[{}\\]/g, "");
  return {
    text: `${name} (${year}). ${title}. GeoHUB Social. ${link}`,
    bibtex: `@misc{geohub_${post.id.replace(/[^a-z0-9]/gi, "")},\n  author = {${bib(name)}},\n  title = {${bib(title)}},\n  year = {${year}},\n  howpublished = {GeoHUB Social},\n  url = {${link}}\n}`,
    url: link,
  };
}

export const routes = [
  ["POST", "/v1/posts", createPost],
  ["GET", "/v1/posts/:id", getPost],
  ["PATCH", "/v1/posts/:id", patchPost],
  ["DELETE", "/v1/posts/:id", deletePost],
  ["GET", "/v1/feed", feed],
  ["GET", "/v1/posts/:id/comments", listComments],
  ["POST", "/v1/posts/:id/comments", addComment],
  ["DELETE", "/v1/comments/:id", deleteComment],
  ["POST", "/v1/posts/:id/accept", acceptAnswer],
  ["POST", "/v1/posts/:id/react", react],
  ["DELETE", "/v1/posts/:id/react", unreact],
  ["POST", "/v1/posts/:id/bookmark", bookmark],
  ["DELETE", "/v1/posts/:id/bookmark", unbookmark],
  ["GET", "/v1/me/bookmarks", myBookmarks],
  ["POST", "/v1/posts/:id/verify", verifyPost],
  ["POST", "/v1/posts/:id/fork", forkPost],
  ["GET", "/v1/posts/:id/forks", listForks],
  ["GET", "/v1/posts/:id/cite", cite],
];
