/**
 * What every route module shares: who is asking, how to answer, and the rules
 * that must read the same wherever they are applied (visibility, blocking,
 * location snapping, rate limits).
 *
 * WHO IS ASKING. The session is an httpOnly cookie on auth.geoidinitiative.com
 * and never reaches this origin, so the page asks the auth Worker for a short
 * `aud: "social"` token (POST /auth/social-token) and sends it here as a
 * Bearer. Both Workers hold SOCIAL_JWT_SECRET (a key of its own, so the site
 * session key never has to be shared or moved); the audience is what stops a
 * data pass or a site session being replayed here. Bearer-only means there is
 * no ambient credential on this origin, so there is no CSRF to defend.
 *
 * NO EMAIL LEAVES THIS FILE. `users.email` joins a token to a row; every shape
 * a route returns is built by publicUser(), which does not read it.
 */

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const PAGE = 20;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export const now = () => Math.floor(Date.now() / 1000);

/** A prefixed random id: id("p") -> "p_9f3a1c0d2b7e4a61". */
export function id(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ── JWT, HS256: the auth Worker's verify, so both agree byte for byte ───────

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => {
  try {
    return Uint8Array.from(
      atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch (error) {
    return null;
  }
};

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(payload, secret) {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(mac)}`;
}

/** The payload, or null for every failure alike. Expiry and audience checked here. */
export async function verify(token, secret, { audience = null } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !secret) return null;
  const mac = unb64url(parts[2]);
  const body = unb64url(parts[1]);
  if (!mac || !body) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret),
    mac, enc.encode(`${parts[0]}.${parts[1]}`)).catch(() => false);
  if (!ok) return null;
  let payload = null;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch (e) { return null; }
  if (!payload || !Number.isFinite(payload.exp) || payload.exp <= now()) return null;
  if (audience && payload.aud !== audience) return null;
  return payload;
}

// ── Answers ────────────────────────────────────────────────────────────────

export function cors(env, request) {
  const allowed = String(env.RETURN_ORIGINS || "").split(/\s+/).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const head = {
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (allowed.includes(origin)) {
    head["Access-Control-Allow-Origin"] = origin;
    head["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
    head["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Dev-User";
    head["Access-Control-Max-Age"] = "600";
  }
  return head;
}

export function json(data, status = 200, head = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...head },
  });
}

// ── Reading what was sent ──────────────────────────────────────────────────

export async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) fail(413, "Too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) fail(413, "Too large.");
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Expected a JSON object.");
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "Not JSON.");
  }
}

/** A trimmed string no longer than `max`, or "" -- never undefined, never an object. */
export function str(value, max = 200) {
  if (value == null) return "";
  return String(value).replace(/\u0000/g, "").trim().slice(0, max);
}

export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function int(value, fallback = null) {
  // Number(null) and Number("") are 0, which turned a missing ?until= into
  // 1970 and emptied the map. Absent is absent.
  if (value == null || String(value).trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Tags: lower-case, a-z0-9 and dashes, unique, at most 12 of 40 chars. */
export function tags(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : String(list || "").split(",")) {
    const tag = String(raw || "").toLowerCase().trim().replace(/^#/, "")
      .replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}

/** An http(s) URL or "". A javascript: link in a profile is an XSS waiting for a renderer. */
export function url(value) {
  const text = str(value, 500);
  if (!text) return "";
  try {
    const u = new URL(text);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch (error) {
    return "";
  }
}

export function parse(text, fallback) {
  if (text == null) return fallback;
  try { return JSON.parse(text); } catch (error) { return fallback; }
}

// ── Location privacy ───────────────────────────────────────────────────────

/**
 * Snap a location to the precision the author chose, BEFORE it is stored.
 *
 * Stored, not served: if the exact point is never written, no route, export,
 * backup or bug can reveal it. approx = 0.1 deg (~11 km), region = 1 deg.
 */
export function snapLocation(lat, lon, precision) {
  const p = oneOf(precision, ["exact", "approx", "region", "hidden"], "approx");
  const la = Number(lat);
  const lo = Number(lon);
  if (p === "hidden" || !Number.isFinite(la) || !Number.isFinite(lo)
      || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    return { lat: null, lon: null, loc_precision: "hidden" };
  }
  const step = p === "exact" ? 1e-5 : p === "approx" ? 0.1 : 1;
  const snap = (v) => Math.round(v / step) * step;
  return { lat: Number(snap(la).toFixed(5)), lon: Number(snap(lo).toFixed(5)), loc_precision: p };
}

// ── Cursors ────────────────────────────────────────────────────────────────

/** "created_at:id" -- stable under ties, opaque to the page. */
export function encodeCursor(row) {
  return row ? btoa(`${row.created_at}:${row.id}`) : null;
}
export function decodeCursor(text) {
  if (!text) return null;
  try {
    const [t, rowId] = atob(String(text)).split(":");
    const at = Number(t);
    return Number.isFinite(at) && rowId ? { at, id: rowId } : null;
  } catch (error) {
    return null;
  }
}

// ── Who is asking ──────────────────────────────────────────────────────────

function bearerOf(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * The claims, or null.
 *
 * DEV_AUTH lets `wrangler dev` be driven without the auth Worker: an
 * `X-Dev-User: someone@example.com` header stands in for a token. It is
 * honoured ONLY when DEV_AUTH is "1" AND the request arrived at localhost, so
 * a production deploy with the variable left on still refuses it.
 */
export async function claimsOf(request, env) {
  const host = new URL(request.url).hostname;
  if (env.DEV_AUTH === "1" && (host === "localhost" || host === "127.0.0.1")) {
    const dev = str(request.headers.get("X-Dev-User"), 200).toLowerCase();
    if (dev) return { email: dev, name: dev.split("@")[0], plan: "explorer", member: false };
  }
  const claims = await verify(bearerOf(request), env.SOCIAL_JWT_SECRET || env.JWT_SECRET, { audience: "social" });
  if (!claims || !claims.email) return null;
  return claims;
}

const HANDLE_RE = /^[a-z0-9_]{3,30}$/;
export const validHandle = (h) => HANDLE_RE.test(String(h || ""));

async function freeHandle(db, wanted) {
  let base = String(wanted || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  if (base.length < 3) base = `member${base}`;
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base.slice(0, 24)}${Math.floor(Math.random() * 9000 + 1000)}`;
    const taken = await db.prepare("SELECT 1 FROM users WHERE handle = ?").bind(candidate).first();
    if (!taken) return candidate;
  }
  return `member${Date.now().toString(36)}`;
}

/**
 * The user row for this request, made on first sight. Null when signed out.
 *
 * The plan is copied from the token on every call because membership is
 * decided by the auth Worker; here it is only drawn.
 */
export async function currentUser(ctx) {
  if (ctx._user !== undefined) return ctx._user;
  const claims = await claimsOf(ctx.request, ctx.env);
  if (!claims) { ctx._user = null; return null; }
  const db = ctx.env.DB;
  const email = String(claims.email).toLowerCase();
  let user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  const plan = claims.plan || (claims.member ? "member" : "explorer");
  if (!user) {
    const t = now();
    const handle = await freeHandle(db, String(claims.name || email.split("@")[0]).replace(/\s+/g, "_"));
    const row = {
      id: id("u"), email, handle, name: str(claims.name, 80) || handle, plan, created_at: t, updated_at: t,
    };
    await db.prepare(
      "INSERT INTO users (id, email, handle, name, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(row.id, row.email, row.handle, row.name, row.plan, row.created_at, row.updated_at).run();
    user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(row.id).first();
  } else if (user.plan !== plan) {
    await db.prepare("UPDATE users SET plan = ? WHERE id = ?").bind(plan, user.id).run();
    user.plan = plan;
  }
  ctx._user = user;
  return user;
}

export async function requireUser(ctx) {
  const user = await currentUser(ctx);
  if (!user) fail(401, "Sign in to do that.");
  if (user.suspended_until > now()) fail(403, "This account is suspended.");
  return user;
}

export function isAdmin(env, user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return String(env.ADMINS || "").toLowerCase().split(/[\s,]+/).includes(user.email);
}

// ── Shapes a route may return ──────────────────────────────────────────────

export function avatarUrl(env, key) {
  return key ? `${env.SELF_ORIGIN || ""}/v1/media/${encodeURIComponent(key)}` : "";
}

/** A person as anybody may see them. NEVER includes email. */
export function publicUser(env, row) {
  if (!row) return null;
  return {
    handle: row.handle,
    name: row.name,
    headline: row.headline,
    avatar: avatarUrl(env, row.avatar_key),
    institution: row.institution,
    plan: row.plan === "explorer" ? "" : row.plan,
    orcid_verified: !!row.orcid_verified,
  };
}

/** The whole profile: publicUser plus the portfolio fields. Still no email. */
export function fullUser(env, row) {
  return {
    ...publicUser(env, row),
    bio: row.bio,
    location: row.location,
    website: row.website,
    linkedin: row.linkedin || "",
    orcid: row.orcid,
    skills: parse(row.skills_json, []),
    interests: parse(row.interests_json, []),
    regions: parse(row.regions_json, []),
    availability: row.availability,
    job_status: row.job_status,
    contact_pref: row.contact_pref,
    match_opt_in: !!row.match_opt_in,
    joined: row.created_at,
  };
}

/** Load users by id into a map of publicUser shapes, in one query. */
export async function usersById(env, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const marks = unique.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT * FROM users WHERE id IN (${marks})`).bind(...unique).all();
  const out = {};
  for (const row of results || []) out[row.id] = publicUser(env, row);
  return out;
}

export async function userByHandle(env, handle) {
  return env.DB.prepare("SELECT * FROM users WHERE handle = ?").bind(String(handle || "").toLowerCase()).first();
}

// ── Blocking ───────────────────────────────────────────────────────────────

/** True if either has blocked the other. Blocking is mutual in effect. */
export async function blockedBetween(env, a, b) {
  if (!a || !b || a === b) return false;
  const row = await env.DB.prepare(
    "SELECT 1 FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)",
  ).bind(a, b, b, a).first();
  return !!row;
}

/** SQL fragment excluding authors either side of a block from `viewer`. Binds: viewer, viewer. */
export const NOT_BLOCKED = (col) =>
  `${col} NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?) AND ${col} NOT IN (SELECT user_id FROM blocks WHERE blocked_id = ?)`;

// ── Visibility ─────────────────────────────────────────────────────────────

/**
 * May `viewer` (a user row, or null) see `post`?
 *
 * ONE function, used by every route that returns a single post, so the rule
 * cannot drift between the post page, a comment thread and a fork. Lists use
 * VISIBLE_POSTS below, which is the same rule written as SQL.
 */
export async function canSeePost(env, viewer, post) {
  if (!post || post.removed_at) return false;
  if (viewer && post.author_id === viewer.id) return true;
  if (viewer && await blockedBetween(env, viewer.id, post.author_id)) return false;
  switch (post.visibility) {
    case "public":
    case "unlisted":
      return true;
    case "followers":
      return !!viewer && !!(await env.DB.prepare(
        "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'user' AND target_id = ?",
      ).bind(viewer.id, post.author_id).first());
    case "team":
      return !!viewer && !!post.team_id && !!(await env.DB.prepare(
        "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'",
      ).bind(post.team_id, viewer.id).first());
    case "community":
      return !!viewer && !!post.community_id && !!(await env.DB.prepare(
        "SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ? AND status = 'active'",
      ).bind(post.community_id, viewer.id).first());
    case "project":
      return !!viewer && !!post.project_id && !!(await env.DB.prepare(
        `SELECT 1 FROM projects pr WHERE pr.id = ? AND pr.removed_at IS NULL AND (${PROJECT_ACCESS})`,
      ).bind(post.project_id, ...projectAccessBinds(viewer)).first());
    default:
      // private: the author only (answered above). Moderators read reported
      // content through the moderation routes, which log the read.
      return false;
  }
}

/**
 * "Can this viewer open project `pr`?" as SQL -- at least viewer access:
 * owner, a live grant to them or to a team they are active in, or active
 * membership of the project's team. Mirrors projectRole() in projects.js,
 * minus the "public" role, which lets anybody READ a public project but is
 * not membership: a post written for a project's people stays with them.
 * Binds 4 values: viewer.id x4.
 */
export const PROJECT_ACCESS = `pr.owner_id = ?
  OR EXISTS (SELECT 1 FROM grants g WHERE g.project_id = pr.id
       AND (g.expires_at IS NULL OR g.expires_at > CAST(strftime('%s','now') AS INTEGER))
       AND ((g.grantee_type = 'user' AND g.grantee_id = ?)
         OR (g.grantee_type = 'team' AND g.grantee_id IN (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active'))))
  OR (pr.team_id IS NOT NULL AND EXISTS (SELECT 1 FROM team_members ptm WHERE ptm.team_id = pr.team_id AND ptm.user_id = ? AND ptm.status = 'active'))`;
export const projectAccessBinds = (viewer) => Array(4).fill(viewer ? viewer.id : "");

/**
 * The visibility rule as SQL over `posts p`, for lists. Binds 10 values:
 *   viewer.id x10 (or "" when signed out, which matches nothing).
 * `unlisted` is excluded from lists on purpose: it is "anyone with the link".
 */
export const VISIBLE_POSTS = `p.removed_at IS NULL AND (
  p.visibility = 'public'
  OR p.author_id = ?
  OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.target_type = 'user' AND f.target_id = p.author_id))
  OR (p.visibility = 'team' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = p.team_id AND tm.user_id = ? AND tm.status = 'active'))
  OR (p.visibility = 'community' AND EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = p.community_id AND cm.user_id = ? AND cm.status = 'active'))
  OR (p.visibility = 'project' AND EXISTS (SELECT 1 FROM projects pr WHERE pr.id = p.project_id AND pr.removed_at IS NULL AND (${PROJECT_ACCESS})))
) AND p.author_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)
  AND p.author_id NOT IN (SELECT user_id FROM blocks WHERE blocked_id = ?)`;
export const visibleBinds = (viewer) => Array(10).fill(viewer ? viewer.id : "");

/** A post as the page draws it. `authors` is a usersById map. */
export function publicPost(env, row, authors = {}, extra = {}) {
  return {
    id: row.id,
    kind: row.kind,
    author: authors[row.author_id] || null,
    title: row.title,
    body: row.body,
    tags: parse(row.tags_json, []),
    location: row.lat == null ? null
      : { lat: row.lat, lon: row.lon, precision: row.loc_precision, place: row.place_name },
    world: row.world,
    scene: parse(row.scene_json, null),
    media: parse(row.media_json, []).map((m) => ({ ...m, url: avatarUrl(env, m.key) })),
    links: parse(row.links_json, []),
    licence: row.licence,
    provenance: row.provenance,
    sources: parse(row.sources_json, []),
    method: parse(row.method_json, {}),
    limitations: row.limitations,
    meta: parse(row.meta_json, {}),
    visibility: row.visibility,
    team_id: row.team_id,
    community_id: row.community_id,
    project_id: row.project_id,
    allow_fork: !!row.allow_fork,
    forked_from: row.forked_from,
    sponsored_by: row.sponsored_by,
    accepted_comment_id: row.accepted_comment_id,
    pinned: !!row.pinned,
    counts: { reactions: row.reaction_count, comments: row.comment_count, forks: row.fork_count },
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...extra,
  };
}

// ── Side effects shared by several modules ─────────────────────────────────

/** Tell somebody something. Silently skipped for self, blocks, or a muted kind. */
export async function notify(env, userId, kind, actorId, refType, refId, text = "") {
  if (!userId || userId === actorId) return;
  if (actorId && await blockedBetween(env, userId, actorId)) return;
  const target = await env.DB.prepare("SELECT notify_json FROM users WHERE id = ?").bind(userId).first();
  const prefs = parse(target?.notify_json, {});
  if (prefs[kind] === false) return;
  await env.DB.prepare(
    "INSERT INTO notifications (id, user_id, kind, actor_id, ref_type, ref_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id("n"), userId, kind, actorId || null, refType, refId, str(text, 200), now()).run();
}

export async function audit(env, actorId, action, refType, refId, detail = {}) {
  await env.DB.prepare(
    "INSERT INTO audit (id, actor_id, action, ref_type, ref_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(id("a"), actorId, action, refType, refId, JSON.stringify(detail), now()).run();
}

/**
 * Writes per minute per user. Over the limit is a 429, not a silent drop, so
 * a page can say so. The limit is env.WRITES_PER_MIN (default 30).
 */
export async function rateLimit(ctx, user) {
  const limit = int(ctx.env.WRITES_PER_MIN, 30);
  const minute = Math.floor(now() / 60);
  await ctx.env.DB.prepare(
    "INSERT INTO rate (user_id, minute, n) VALUES (?, ?, 1) ON CONFLICT(user_id, minute) DO UPDATE SET n = n + 1",
  ).bind(user.id, minute).run();
  const row = await ctx.env.DB.prepare("SELECT n FROM rate WHERE user_id = ? AND minute = ?").bind(user.id, minute).first();
  if (Math.random() < 0.02) {
    await ctx.env.DB.prepare("DELETE FROM rate WHERE minute < ?").bind(minute - 5).run();
  }
  if (row && row.n > limit) fail(429, "Slow down a little — too many changes in a minute.");
}

/** Team role of a user, or null. */
export async function teamRole(env, teamId, userId) {
  if (!teamId || !userId) return null;
  const row = await env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'",
  ).bind(teamId, userId).first();
  return row ? row.role : null;
}

/** Community role of a user, or null. */
export async function communityRole(env, communityId, userId) {
  if (!communityId || !userId) return null;
  const row = await env.DB.prepare(
    "SELECT role FROM community_members WHERE community_id = ? AND user_id = ? AND status = 'active'",
  ).bind(communityId, userId).first();
  return row ? row.role : null;
}
