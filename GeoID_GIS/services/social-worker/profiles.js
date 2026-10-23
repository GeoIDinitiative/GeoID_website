/**
 * People: the signed-in profile, other people's profiles, people search,
 * following anything, blocking, and the two UK GDPR routes (export, erase).
 *
 * The public key of a person is their HANDLE. Internal user ids are stored in
 * follows/blocks so the visibility SQL in lib.js can join on them, and are
 * translated back to handles (or slugs) on the way out.
 */
import {
  PAGE, fail, now, id, str, url, int, tags, parse, readJson,
  requireUser, currentUser, isAdmin, validHandle, publicUser, fullUser,
  userByHandle, blockedBetween, NOT_BLOCKED, VISIBLE_POSTS, visibleBinds,
  canSeePost, encodeCursor, decodeCursor, notify, audit, rateLimit,
} from "./lib.js";
import { identityErasureStatements, identityExport } from "./orgs.js";
import { verificationsForItems } from "./verify.js";
import { erasureStatements as reshareErasure, exportRows as reshareExport } from "./reposts.js";

const ITEM_KINDS =["publication", "dataset", "education", "experience", "credential", "repository", "award",
  "fieldwork", "talk", "other"];
const ITEM_VISIBILITY = ["public", "unlisted", "private"];
const FOLLOW_TYPES = ["user", "project", "tag", "place", "community", "post", "org"];
const AVAILABILITY = ["open", "limited", "closed"];
const JOB_STATUS = ["", "seeking", "hiring", "consulting"];
const CONTACT = ["anyone", "followers", "nobody"];
const NOTIFY_KINDS = ["follow", "comment", "reaction", "mention", "invite", "grant", "review", "message",
  "fork", "verify", "moderation", "badge", "project_update", "mentoring", "repost"];
const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/** Reject a value outside an enumeration with 400, as CONTRACT.md asks. */
export function enumOf(value, allowed, label) {
  if (!allowed.includes(value)) fail(400, `${label} must be one of: ${allowed.filter(Boolean).join(", ")}.`);
  return value;
}

/** LIKE pattern with the user's own % and _ taken literally (use with ESCAPE '\'). */
export function likeOf(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** An erased account keeps its row (so old threads still join) but is nobody. */
export const isErased = (row) => !row || String(row.email).startsWith("erased:");

// ── Counts and the /me shape ───────────────────────────────────────────────

async function countsOf(env, userId, viewer) {
  const followers = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM follows WHERE target_type = 'user' AND target_id = ?",
  ).bind(userId).first("n");
  const following = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM follows WHERE follower_id = ? AND target_type = 'user'",
  ).bind(userId).first("n");
  // Posts counted as the viewer can see them: a count of private posts would
  // tell a stranger that private posts exist.
  const posts = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM posts p WHERE p.author_id = ? AND ${VISIBLE_POSTS}`,
  ).bind(userId, ...visibleBinds(viewer)).first("n");
  return { followers, following, posts };
}

async function meShape(ctx, user) {
  const env = ctx.env;
  const fresh = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  const unreadNotes = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0",
  ).bind(user.id).first("n");
  const unreadMessages = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
      WHERE cm.status = 'active' AND m.created_at > cm.last_read AND m.sender_id != ? AND m.removed_at IS NULL`,
  ).bind(user.id, user.id).first("n");
  const communities = (await env.DB.prepare(
    `SELECT c.slug, c.name, cm.role FROM community_members cm JOIN communities c ON c.id = cm.community_id
      WHERE cm.user_id = ? AND cm.status = 'active' ORDER BY c.name`,
  ).bind(user.id).all()).results;
  const teams = (await env.DB.prepare(
    `SELECT t.slug, t.name, tm.role FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ? AND tm.status = 'active' ORDER BY t.name`,
  ).bind(user.id).all()).results;
  return {
    user: { ...fullUser(env, fresh), handle_editable: true, notify: parse(fresh.notify_json, {}),
      onboarding_done: !!fresh.onboarding_done },
    counts: await countsOf(env, user.id, user),
    unread: { notifications: unreadNotes || 0, messages: unreadMessages || 0 },
    communities,
    teams,
    admin: isAdmin(env, user),
  };
}

async function getMe(ctx) {
  return meShape(ctx, await requireUser(ctx));
}

async function patchMe(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const body = await readJson(ctx.request);
  const env = ctx.env;
  const set = {};
  const has = (k) => body[k] !== undefined;

  if (has("handle")) {
    const handle = String(body.handle).toLowerCase();
    if (!validHandle(handle)) fail(400, "A handle is 3 to 30 letters, digits or underscores.");
    if (handle !== user.handle) {
      const taken = await env.DB.prepare("SELECT 1 FROM users WHERE handle = ?").bind(handle).first();
      if (taken) fail(409, "That handle is taken.");
      set.handle = handle;
    }
  }
  if (has("name")) {
    const name = str(body.name, 80);
    if (!name) fail(400, "A name can't be empty.");
    set.name = name;
  }
  if (has("headline")) set.headline = str(body.headline, 140);
  if (has("bio")) set.bio = str(body.bio, 4000);
  if (has("institution")) set.institution = str(body.institution, 140);
  // Free text on purpose ("Catania, Sicily"): a profile never stores coordinates.
  if (has("location")) set.location = str(body.location, 120);
  if (has("website")) {
    set.website = url(body.website);
    if (str(body.website) && !set.website) fail(400, "The website must be an http(s) link.");
  }
  if (has("orcid")) {
    const orcid = str(body.orcid, 19).toUpperCase();
    if (orcid && !ORCID_RE.test(orcid)) fail(400, "An ORCID iD looks like 0000-0002-1825-0097.");
    if (orcid !== user.orcid) {
      set.orcid = orcid;
      // Verification belongs to the iD that was checked, not to the field.
      set.orcid_verified = 0;
    }
  }
  if (has("skills")) set.skills_json = JSON.stringify(tags(body.skills));
  if (has("interests")) set.interests_json = JSON.stringify(tags(body.interests));
  if (has("regions")) {
    const list = (Array.isArray(body.regions) ? body.regions : String(body.regions || "").split(","))
      .map((r) => str(r, 60)).filter(Boolean);
    set.regions_json = JSON.stringify([...new Set(list)].slice(0, 12));
  }
  if (has("availability")) set.availability = enumOf(body.availability, AVAILABILITY, "availability");
  if (has("job_status")) set.job_status = enumOf(body.job_status ?? "", JOB_STATUS, "job_status");
  if (has("contact_pref")) set.contact_pref = enumOf(body.contact_pref, CONTACT, "contact_pref");
  if (has("match_opt_in")) set.match_opt_in = body.match_opt_in ? 1 : 0;
  if (has("linkedin")) {
    // Optional. Only a linkedin.com address is accepted, so the "LinkedIn"
    // label on the profile cannot be pinned to somewhere else.
    const link = url(body.linkedin);
    let ok = false;
    try { ok = !!link && /(^|\.)linkedin\.com$/.test(new URL(link).hostname) && new URL(link).protocol === "https:"; } catch (e) { ok = false; }
    if (str(body.linkedin) && !ok) fail(400, "The LinkedIn link must be an https://www.linkedin.com/… address.");
    set.linkedin = ok ? link : "";
  }
  if (has("avatar_key") || has("avatar")) {
    const key = str(body.avatar_key ?? body.avatar, 200);
    if (key) {
      // An avatar is drawn for everybody, so only a public image of one's own will do.
      const media = await env.DB.prepare("SELECT * FROM media WHERE key = ?").bind(key).first();
      if (!media || media.owner_id !== user.id) fail(400, "Upload the picture first.");
      if (media.scope !== "public") fail(400, "An avatar must be a public upload.");
      if (!media.type.startsWith("image/")) fail(400, "An avatar must be an image.");
    }
    set.avatar_key = key;
  }
  if (has("notify")) {
    if (!body.notify || typeof body.notify !== "object" || Array.isArray(body.notify)) {
      fail(400, "notify is an object of {kind: true|false}.");
    }
    const prefs = parse(user.notify_json, {});
    for (const [kind, on] of Object.entries(body.notify)) {
      if (NOTIFY_KINDS.includes(kind)) prefs[kind] = !!on;
    }
    set.notify_json = JSON.stringify(prefs);
  }

  const cols = Object.keys(set);
  if (cols.length) {
    set.updated_at = now();
    cols.push("updated_at");
    await env.DB.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...cols.map((c) => set[c]), user.id).run();
  }
  return meShape(ctx, user);
}

// ── Other people ───────────────────────────────────────────────────────────

/**
 * The person behind a handle as the viewer may see them, or 404.
 * Somebody who blocked the viewer does not exist to the viewer; somebody the
 * viewer blocked is still found, so the block can be undone from their page.
 */
async function visiblePerson(ctx, handle, viewer) {
  const row = await userByHandle(ctx.env, handle);
  if (isErased(row)) fail(404, "No such person.");
  if (viewer && row.id !== viewer.id) {
    const theyBlocked = await ctx.env.DB.prepare(
      "SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?",
    ).bind(row.id, viewer.id).first();
    if (theyBlocked) fail(404, "No such person.");
  }
  return row;
}

function itemShape(row) {
  return {
    id: row.id, kind: row.kind, title: row.title, detail: row.detail, url: row.url, doi: row.doi,
    year: row.year, verified: !!row.verified, visibility: row.visibility,
  };
}

async function getUser(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const row = await visiblePerson(ctx, ctx.params.handle, viewer);
  const self = viewer && viewer.id === row.id;
  // The profile page is the "link" for unlisted entries, so those show too;
  // private ones only to their owner.
  const items = (await env.DB.prepare(
    `SELECT * FROM profile_items WHERE user_id = ? ${self ? "" : "AND visibility IN ('public','unlisted')"}
      ORDER BY sort, created_at DESC`,
  ).bind(row.id).all()).results.map(itemShape);
  // What was checked, beside each checked item (verify.js), so a tick shows its evidence.
  const checks = await verificationsForItems(env, items.map((it) => it.id));
  for (const it of items) it.verification = checks[it.id] || null;
  const badges = (await env.DB.prepare(
    "SELECT badge, evidence_json, awarded_at FROM badges WHERE user_id = ? AND revoked_at IS NULL ORDER BY awarded_at",
  ).bind(row.id).all()).results.map((b) => ({ id: b.badge, awarded_at: b.awarded_at, evidence: parse(b.evidence_json, {}) }));
  let relationship = { following: false, followed_by: false, blocked: false };
  if (viewer && !self) {
    const q = (sql, a, b) => env.DB.prepare(sql).bind(a, b).first();
    relationship = {
      following: !!await q("SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'user' AND target_id = ?", viewer.id, row.id),
      followed_by: !!await q("SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'user' AND target_id = ?", row.id, viewer.id),
      blocked: !!await q("SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?", viewer.id, row.id),
    };
  }
  return { user: fullUser(env, row), items, badges, counts: await countsOf(env, row.id, viewer), relationship };
}

async function searchUsers(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const q = ctx.url.searchParams;
  const where = ["u.suspended_until <= ?", "u.email NOT LIKE 'erased:%'"];
  const binds = [now()];
  if (viewer) { where.push(NOT_BLOCKED("u.id")); binds.push(viewer.id, viewer.id); }
  const text = str(q.get("q"), 100);
  if (text) {
    where.push("(u.handle LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.headline LIKE ? ESCAPE '\\' OR u.institution LIKE ? ESCAPE '\\')");
    const like = likeOf(text);
    binds.push(like, like, like, like);
  }
  // Skills and interests are stored through tags(), so the same normalisation
  // makes the query match exactly one JSON array element.
  const skill = tags([q.get("skill") || ""])[0];
  if (skill) { where.push("EXISTS (SELECT 1 FROM json_each(u.skills_json) WHERE value = ?)"); binds.push(skill); }
  const interest = tags([q.get("interest") || ""])[0];
  if (interest) { where.push("EXISTS (SELECT 1 FROM json_each(u.interests_json) WHERE value = ?)"); binds.push(interest); }
  const region = str(q.get("region"), 60);
  if (region) { where.push("u.regions_json LIKE ? ESCAPE '\\'"); binds.push(likeOf(region)); }
  if (q.get("available") === "1") where.push("u.availability != 'closed'");
  // Mentors (orgs.js): open to mentoring, optionally on a topic.
  if (q.get("mentor") === "1") where.push("u.mentoring_open = 1");
  const mentorTopic = tags([q.get("mentor_topic") || ""])[0];
  if (mentorTopic) { where.push("EXISTS (SELECT 1 FROM json_each(u.mentoring_topics_json) WHERE value = ?)"); binds.push(mentorTopic); }
  const cursor = decodeCursor(q.get("cursor"));
  if (cursor) { where.push("(u.created_at < ? OR (u.created_at = ? AND u.id < ?))"); binds.push(cursor.at, cursor.at, cursor.id); }
  const rows = (await env.DB.prepare(
    `SELECT u.* FROM users u WHERE ${where.join(" AND ")} ORDER BY u.created_at DESC, u.id DESC LIMIT ?`,
  ).bind(...binds, PAGE + 1).all()).results;
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  return {
    items: page.map((r) => ({ ...publicUser(env, r), skills: parse(r.skills_json, []), availability: r.availability,
      mentoring_topics: r.mentoring_open ? parse(r.mentoring_topics_json, []) : [] })),
    next: more ? encodeCursor(page[page.length - 1]) : null,
  };
}

/** Followers or following of a person, newest first, blocks removed both ways. */
function followList(direction) {
  return async (ctx) => {
    const env = ctx.env;
    const viewer = await currentUser(ctx);
    const person = await visiblePerson(ctx, ctx.params.handle, viewer);
    const [mine, theirs] = direction === "followers" ? ["target_id", "follower_id"] : ["follower_id", "target_id"];
    const where = ["f.target_type = 'user'", `f.${mine} = ?`];
    const binds = [person.id];
    if (viewer) { where.push(NOT_BLOCKED("u.id")); binds.push(viewer.id, viewer.id); }
    const cursor = decodeCursor(ctx.url.searchParams.get("cursor"));
    if (cursor) { where.push("(f.created_at < ? OR (f.created_at = ? AND u.id < ?))"); binds.push(cursor.at, cursor.at, cursor.id); }
    const rows = (await env.DB.prepare(
      `SELECT u.*, f.created_at AS f_at FROM follows f JOIN users u ON u.id = f.${theirs}
        WHERE ${where.join(" AND ")} ORDER BY f.created_at DESC, u.id DESC LIMIT ?`,
    ).bind(...binds, PAGE + 1).all()).results;
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => publicUser(env, r)),
      next: more ? encodeCursor({ created_at: last.f_at, id: last.id }) : null,
    };
  };
}

// ── Portfolio items ────────────────────────────────────────────────────────

function itemFields(body, base) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!base || has("kind")) out.kind = enumOf(body.kind, ITEM_KINDS, "kind");
  if (!base || has("title")) {
    out.title = str(body.title, 300);
    if (!out.title) fail(400, "An entry needs a title.");
  }
  if (!base || has("detail")) out.detail = str(body.detail, 2000);
  if (!base || has("url")) out.url = url(body.url);
  if (!base || has("doi")) out.doi = str(body.doi, 120);
  if (!base || has("year")) {
    const year = int(body.year, null);
    out.year = year != null && year >= 1800 && year <= 2200 ? year : null;
  }
  if (!base || has("visibility")) {
    out.visibility = body.visibility == null ? "public" : enumOf(body.visibility, ITEM_VISIBILITY, "visibility");
  }
  if (has("sort")) out.sort = int(body.sort, 0);
  return out;
}

async function addItem(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const fields = itemFields(await readJson(ctx.request), null);
  const row = { id: id("pi"), user_id: user.id, ...fields, verified: 0, sort: fields.sort ?? 0, created_at: now() };
  // `verified` is never taken from the body: only a process that checked the
  // entry may set it.
  await ctx.env.DB.prepare(
    `INSERT INTO profile_items (id, user_id, kind, title, detail, url, doi, year, verified, visibility, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).bind(row.id, row.user_id, row.kind, row.title, row.detail, row.url, row.doi, row.year, row.visibility, row.sort, row.created_at).run();
  return itemShape(row);
}

async function ownItem(ctx, user) {
  const row = await ctx.env.DB.prepare("SELECT * FROM profile_items WHERE id = ?").bind(ctx.params.id).first();
  if (!row || row.user_id !== user.id) fail(404, "No such entry.");
  return row;
}

async function patchItem(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const row = await ownItem(ctx, user);
  const fields = itemFields(await readJson(ctx.request), row);
  // A tick belongs to the DOI that was checked (verify.js), not to the entry.
  if (fields.doi !== undefined && fields.doi !== row.doi) fields.verified = 0;
  const cols = Object.keys(fields);
  if (cols.length) {
    await ctx.env.DB.prepare(`UPDATE profile_items SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...cols.map((c) => fields[c]), row.id).run();
  }
  return itemShape({ ...row, ...fields });
}

async function deleteItem(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const row = await ownItem(ctx, user);
  await ctx.env.DB.prepare("DELETE FROM profile_items WHERE id = ?").bind(row.id).run();
  return { ok: true };
}

// ── Following ──────────────────────────────────────────────────────────────

/**
 * Turn the {type, id} a page sends into what is stored. `forWrite` adds the
 * visibility checks a new follow needs; an unfollow only has to find the row.
 */
async function resolveTarget(ctx, user, type, rawId, forWrite) {
  const env = ctx.env;
  enumOf(type, FOLLOW_TYPES, "type");
  const given = str(rawId, 200);
  if (!given) fail(400, "Say what to follow.");
  switch (type) {
    case "user": {
      const person = await userByHandle(env, given);
      if (isErased(person)) fail(404, "No such person.");
      if (forWrite) {
        if (person.id === user.id) fail(400, "You can't follow yourself.");
        if (await blockedBetween(env, user.id, person.id)) fail(403, "You can't follow this person.");
      }
      return { targetId: person.id, person };
    }
    case "community": {
      const c = await env.DB.prepare("SELECT * FROM communities WHERE slug = ?").bind(given.toLowerCase()).first();
      if (!c) fail(404, "No such community.");
      if (forWrite && c.visibility === "private") {
        const member = await env.DB.prepare(
          "SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ? AND status = 'active'",
        ).bind(c.id, user.id).first();
        if (!member) fail(404, "No such community.");
      }
      return { targetId: c.id };
    }
    case "project": {
      const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(given).first();
      if (!p || (forWrite && p.removed_at)) fail(404, "No such project.");
      if (forWrite && !["public", "unlisted"].includes(p.visibility) && p.owner_id !== user.id) {
        const grant = await env.DB.prepare(
          `SELECT 1 FROM grants WHERE project_id = ? AND (expires_at IS NULL OR expires_at > ?) AND (
             (grantee_type = 'user' AND grantee_id = ?) OR
             (grantee_type = 'team' AND grantee_id IN (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active')))`,
        ).bind(p.id, now(), user.id, user.id).first();
        const team = p.team_id && await env.DB.prepare(
          "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'",
        ).bind(p.team_id, user.id).first();
        if (!grant && !team) fail(404, "No such project.");
      }
      return { targetId: p.id };
    }
    case "tag": {
      const tag = tags([given])[0];
      if (!tag) fail(400, "That isn't a usable tag.");
      return { targetId: tag };
    }
    case "place": {
      // One row per ~11 km cell, so everybody following Etna shares a key.
      const [la, lo] = given.split(",").map(Number);
      if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
        fail(400, "A place is \"lat,lon\".");
      }
      return { targetId: `${(Math.round(la * 10) / 10).toFixed(1)},${(Math.round(lo * 10) / 10).toFixed(1)}` };
    }
    case "post": {
      const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(given).first();
      if (!post || (forWrite && !(await canSeePost(env, user, post)))) fail(404, "No such post.");
      return { targetId: post.id };
    }
    case "org": {
      // An organisation (orgs.js), by slug; removed ones can only be unfollowed.
      const o = await env.DB.prepare("SELECT id, removed_at FROM orgs WHERE slug = ?").bind(given.toLowerCase()).first();
      if (!o || (forWrite && o.removed_at)) fail(404, "No such organisation.");
      return { targetId: o.id };
    }
    default:
      return fail(400, "Unknown follow type.");
  }
}

async function follow(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const body = await readJson(ctx.request);
  const target = await resolveTarget(ctx, user, body.type, body.id, true);
  const res = await ctx.env.DB.prepare(
    "INSERT OR IGNORE INTO follows (follower_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)",
  ).bind(user.id, body.type, target.targetId, now()).run();
  if (target.person && res.meta.changes) {
    await notify(ctx.env, target.person.id, "follow", user.id, "user", user.handle, `${user.name} started following you`);
  }
  return { ok: true, following: true };
}

async function unfollow(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const body = await readJson(ctx.request);
  const target = await resolveTarget(ctx, user, body.type, body.id, false);
  await ctx.env.DB.prepare(
    "DELETE FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ?",
  ).bind(user.id, body.type, target.targetId).run();
  return { ok: true, following: false };
}

async function myFollowing(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const type = ctx.url.searchParams.get("type");
  if (type) enumOf(type, FOLLOW_TYPES, "type");
  const rows = (await env.DB.prepare(
    `SELECT * FROM follows WHERE follower_id = ? ${type ? "AND target_type = ?" : ""} ORDER BY created_at DESC LIMIT 500`,
  ).bind(...(type ? [user.id, type] : [user.id])).all()).results;
  const items = [];
  for (const f of rows) {
    if (f.target_type === "user") {
      const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(f.target_id).first();
      if (!isErased(u)) items.push({ type: "user", id: u.handle, label: u.name });
    } else if (f.target_type === "community") {
      const c = await env.DB.prepare("SELECT slug, name FROM communities WHERE id = ?").bind(f.target_id).first();
      if (c) items.push({ type: "community", id: c.slug, label: c.name });
    } else if (f.target_type === "project") {
      const p = await env.DB.prepare("SELECT id, title FROM projects WHERE id = ? AND removed_at IS NULL").bind(f.target_id).first();
      if (p) items.push({ type: "project", id: p.id, label: p.title });
    } else if (f.target_type === "post") {
      const p = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(f.target_id).first();
      if (await canSeePost(env, user, p)) items.push({ type: "post", id: p.id, label: p.title || str(p.body, 80) });
    } else if (f.target_type === "org") {
      const o = await env.DB.prepare("SELECT slug, name FROM orgs WHERE id = ? AND removed_at IS NULL").bind(f.target_id).first();
      if (o) items.push({ type: "org", id: o.slug, label: o.name });
    } else {
      items.push({ type: f.target_type, id: f.target_id, label: f.target_type === "tag" ? `#${f.target_id}` : f.target_id });
    }
  }
  return { items, next: null };
}

// ── Blocking ───────────────────────────────────────────────────────────────

async function block(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const body = await readJson(ctx.request);
  const person = await userByHandle(ctx.env, str(body.handle, 40));
  if (isErased(person)) fail(404, "No such person.");
  if (person.id === user.id) fail(400, "You can't block yourself.");
  // One batch: a block that left a follow behind would keep a followers-only
  // post visible across it.
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)").bind(user.id, person.id, now()),
    ctx.env.DB.prepare(
      "DELETE FROM follows WHERE target_type = 'user' AND ((follower_id = ? AND target_id = ?) OR (follower_id = ? AND target_id = ?))",
    ).bind(user.id, person.id, person.id, user.id),
  ]);
  return { ok: true, blocked: true };
}

async function unblock(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const person = await userByHandle(ctx.env, ctx.params.handle);
  if (person) {
    await ctx.env.DB.prepare("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?").bind(user.id, person.id).run();
  }
  return { ok: true, blocked: false };
}

async function listBlocks(ctx) {
  const user = await requireUser(ctx);
  const rows = (await ctx.env.DB.prepare(
    "SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC",
  ).bind(user.id).all()).results;
  return { items: rows.map((r) => publicUser(ctx.env, r)), next: null };
}

// ── UK GDPR: access (Art. 15/20) and erasure (Art. 17) ─────────────────────

async function rowsOf(env, sql, ...binds) {
  return (await env.DB.prepare(sql).bind(...binds).all()).results;
}

/**
 * Everything held about the caller, as stored. This is the ONE route that
 * returns an email address, and only the caller's own: the right of access
 * covers the join key too. Other people appear by handle, never by email.
 */
async function exportMe(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const u = user.id;
  const handles = async (ids) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return {};
    const rows = await rowsOf(env, `SELECT id, handle FROM users WHERE id IN (${unique.map(() => "?").join(",")})`, ...unique);
    return Object.fromEntries(rows.map((r) => [r.id, r.handle]));
  };
  const profile = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(u).first();
  const follows = await rowsOf(env, "SELECT target_type, target_id, created_at FROM follows WHERE follower_id = ?", u);
  const blocks = await rowsOf(env, "SELECT blocked_id, created_at FROM blocks WHERE user_id = ?", u);
  const names = await handles([
    ...follows.filter((f) => f.target_type === "user").map((f) => f.target_id),
    ...blocks.map((b) => b.blocked_id),
  ]);
  const { notify_json: notifyJson, ...profileRest } = profile;
  const data = {
    exported_at: now(),
    note: "Everything GeoID Network holds about you. Other people appear by handle only.",
    profile: { ...profileRest, notify: parse(notifyJson, {}) },
    profile_items: await rowsOf(env, "SELECT * FROM profile_items WHERE user_id = ?", u),
    study_areas: await rowsOf(env, "SELECT * FROM study_areas WHERE user_id = ?", u),
    follows: follows.map((f) => ({ ...f, target_id: f.target_type === "user" ? names[f.target_id] || null : f.target_id })),
    blocks: blocks.map((b) => ({ handle: names[b.blocked_id] || null, created_at: b.created_at })),
    posts: await rowsOf(env, "SELECT * FROM posts WHERE author_id = ?", u),
    comments: await rowsOf(env, "SELECT * FROM comments WHERE author_id = ?", u),
    reactions: await rowsOf(env, "SELECT * FROM reactions WHERE user_id = ?", u),
    bookmarks: await rowsOf(env, "SELECT * FROM bookmarks WHERE user_id = ?", u),
    verifications: await rowsOf(env, "SELECT * FROM verifications WHERE user_id = ?", u),
    media: await rowsOf(env, "SELECT * FROM media WHERE owner_id = ?", u),
    community_memberships: await rowsOf(env,
      "SELECT c.slug, c.name, cm.role, cm.status, cm.created_at FROM community_members cm JOIN communities c ON c.id = cm.community_id WHERE cm.user_id = ?", u),
    team_memberships: await rowsOf(env,
      "SELECT t.slug, t.name, tm.role, tm.status, tm.created_at FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = ?", u),
    projects: await rowsOf(env, "SELECT * FROM projects WHERE owner_id = ?", u),
    project_versions: await rowsOf(env,
      "SELECT * FROM project_versions WHERE created_by = ? OR project_id IN (SELECT id FROM projects WHERE owner_id = ?)", u, u),
    grants_made: await rowsOf(env, "SELECT * FROM grants WHERE granted_by = ?", u),
    reviews_requested: await rowsOf(env, "SELECT * FROM reviews WHERE requester_id = ?", u),
    reviews_as_reviewer: await rowsOf(env, "SELECT * FROM reviewers WHERE user_id = ?", u),
    review_comments: await rowsOf(env, "SELECT * FROM review_comments WHERE author_id = ?", u),
    conversations: await rowsOf(env,
      `SELECT c.id, c.kind, c.title, c.created_at, c.last_at, cm.status, cm.last_read, cm.muted
         FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id WHERE cm.user_id = ?`, u),
    messages_sent: await rowsOf(env, "SELECT * FROM messages WHERE sender_id = ?", u),
    notifications: await rowsOf(env, "SELECT * FROM notifications WHERE user_id = ?", u),
    reports_filed: await rowsOf(env, "SELECT * FROM reports WHERE reporter_id = ?", u),
    // v1.3 identity (orgs.js, verify.js): affiliations, mentoring, publication checks.
    ...await identityExport(env, u),
    reshares: await reshareExport(env, u),
    // v1.3 engagement (mail.js): the email choice and the log of what was mailed.
    mail_prefs: await rowsOf(env, "SELECT * FROM mail_prefs WHERE user_id = ?", u),
    mail_log: await rowsOf(env, "SELECT kind, notification_id, status, created_at, sent_at FROM mail_queue WHERE user_id = ?", u),
    // v1.3 collaboration (requests.js, events.js). Other people by handle only.
    ...await collabExport(env, u, handles),
  };
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": "attachment; filename=\"geohub-social-export.json\"",
      "cache-control": "no-store",
    },
  });
}

/** The caller's collaboration requests, help given, credits, RSVPs and posters, for the export. */
async function collabExport(env, u, handles) {
  const contributions = await rowsOf(env,
    "SELECT id, kind, ref_type, ref_id, post_id, note, credited_by, created_at FROM contributions WHERE user_id = ?", u);
  const names = await handles(contributions.map((c) => c.credited_by));
  return {
    collab_requests: await rowsOf(env, "SELECT * FROM collab_requests WHERE requester_id = ?", u),
    collab_participation: await rowsOf(env,
      "SELECT request_id, status, acknowledged_at, created_at, updated_at FROM collab_participants WHERE user_id = ?", u),
    collab_responses: await rowsOf(env, "SELECT id, request_id, kind, body, created_at FROM collab_responses WHERE author_id = ?", u),
    contributions: contributions.map(({ credited_by: by, ...c }) => ({ ...c, credited_by: names[by] || null })),
    event_rsvps: await rowsOf(env, "SELECT post_id, status, show_me, reminded_at, created_at, updated_at FROM event_rsvps WHERE user_id = ?", u),
    event_posters: await rowsOf(env, "SELECT event_id, post_id, status, note, created_at, decided_at FROM event_posters WHERE submitted_by = ?", u),
  };
}

/** Recompute a post's counters from the rows they count. Shared with posts.js. */
export function recountStatement(DB, postId) {
  return DB.prepare(
    `UPDATE posts SET
       reaction_count = (SELECT COUNT(*) FROM reactions WHERE post_id = ?),
       comment_count = (SELECT COUNT(*) FROM comments WHERE post_id = ? AND removed_at IS NULL),
       fork_count = (SELECT COUNT(*) FROM posts f WHERE f.forked_from = ? AND f.removed_at IS NULL)
     WHERE id = ?`,
  ).bind(postId, postId, postId, postId);
}

/**
 * Erase the caller. Their content is blanked rather than deleted so threads
 * other people wrote into still read (a reply to a removed comment stays a
 * reply) and the counts recomputed below stay true. Nothing that identifies
 * them is left: the users row keeps only its id, an email that can never
 * match a token, and a handle that names nobody.
 */
async function eraseMe(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const body = await readJson(ctx.request);
  if (!body.confirm || str(body.confirm, 40).toLowerCase() !== user.handle) {
    fail(400, "To delete your account, send your handle as confirm.");
  }
  const u = user.id;
  const t = now();
  const DB = env.DB;
  const p = (sql, ...binds) => DB.prepare(sql).bind(...binds);

  // R2 first: if the database part then failed the user can simply retry,
  // whereas rows deleted before the bytes would orphan files nobody can find.
  const media = await rowsOf(env, "SELECT key FROM media WHERE owner_id = ?", u);
  for (const m of media) await env.MEDIA.delete(m.key);

  // Posts whose counters their reactions, comments and forks fed: recounted last.
  const touched = (await rowsOf(env,
    `SELECT post_id AS id FROM reactions WHERE user_id = ?
     UNION SELECT post_id FROM comments WHERE author_id = ?
     UNION SELECT forked_from FROM posts WHERE author_id = ? AND forked_from IS NOT NULL`, u, u, u)).map((r) => r.id);

  // A team whose last active lead leaves gets its longest-standing active
  // member as lead, so nobody is left unable to run it.
  const leads = await rowsOf(env, "SELECT team_id FROM team_members WHERE user_id = ? AND role = 'lead' AND status = 'active'", u);
  const promote = [];
  for (const { team_id: teamId } of leads) {
    const other = await p("SELECT 1 FROM team_members WHERE team_id = ? AND role = 'lead' AND status = 'active' AND user_id != ?", teamId, u).first();
    if (other) continue;
    const heir = await p(
      "SELECT user_id FROM team_members WHERE team_id = ? AND status = 'active' AND user_id != ? ORDER BY created_at, user_id LIMIT 1",
      teamId, u).first();
    if (heir) promote.push(p("UPDATE team_members SET role = 'lead' WHERE team_id = ? AND user_id = ?", teamId, heir.user_id));
  }

  const ownProjects = "SELECT id FROM projects WHERE owner_id = ?";
  const statements = [
    p("DELETE FROM media WHERE owner_id = ?", u),
    p("DELETE FROM profile_items WHERE user_id = ?", u),
    p("DELETE FROM study_areas WHERE user_id = ?", u),
    p("DELETE FROM follows WHERE follower_id = ? OR (target_type = 'user' AND target_id = ?)", u, u),
    p("DELETE FROM blocks WHERE user_id = ? OR blocked_id = ?", u, u),
    p("DELETE FROM reactions WHERE user_id = ?", u),
    p("DELETE FROM bookmarks WHERE user_id = ?", u),
    p("DELETE FROM verifications WHERE user_id = ?", u),
    p("DELETE FROM notifications WHERE user_id = ? OR actor_id = ?", u, u),
    p("DELETE FROM rate WHERE user_id = ?", u),
    // v1.3 identity (orgs.js): affiliations, mentoring requests, publication checks.
    ...identityErasureStatements(DB, u),
    ...reshareErasure({ DB }, u, now()),
    p("DELETE FROM mail_queue WHERE user_id = ?", u),
    p("DELETE FROM mail_prefs WHERE user_id = ?", u),
    p("DELETE FROM post_tags WHERE post_id IN (SELECT id FROM posts WHERE author_id = ?)", u),
    p(`UPDATE posts SET title = '', body = '', media_json = '[]', tags_json = '[]', scene_json = NULL,
         links_json = '[]', sources_json = '[]', method_json = '{}', meta_json = '{}', limitations = '',
         lat = NULL, lon = NULL, loc_precision = 'hidden', place_name = '',
         removed_at = COALESCE(removed_at, ?), removed_by = COALESCE(removed_by, ?) WHERE author_id = ?`, t, u, u),
    p("UPDATE comments SET body = '', lat = NULL, lon = NULL, removed_at = COALESCE(removed_at, ?) WHERE author_id = ?", t, u),
    p("UPDATE messages SET body = '', media_json = '[]', removed_at = COALESCE(removed_at, ?) WHERE sender_id = ?", t, u),
    p(`DELETE FROM project_versions WHERE project_id IN (${ownProjects})`, u),
    p(`DELETE FROM grants WHERE project_id IN (${ownProjects}) OR (grantee_type = 'user' AND grantee_id = ?)`, u, u),
    p("UPDATE projects SET removed_at = COALESCE(removed_at, ?), summary = '', lat = NULL, lon = NULL WHERE owner_id = ?", t, u),
    ...promote,
    p("DELETE FROM team_members WHERE user_id = ?", u),
    p("DELETE FROM community_members WHERE user_id = ?", u),
    p("DELETE FROM conversation_members WHERE user_id = ?", u),
    p("DELETE FROM reviewers WHERE user_id = ?", u),
    p("UPDATE review_comments SET body = '' WHERE author_id = ?", u),
    // v1.3 collaboration: their requests are closed and blanked (helpers keep
    // the credit they were given), their answers, RSVPs, posters and credits go.
    p(`UPDATE collab_requests SET title = '', detail = '', skills_json = '[]',
         status = CASE WHEN status = 'completed' THEN status ELSE 'withdrawn' END, updated_at = ? WHERE requester_id = ?`, t, u),
    p("DELETE FROM collab_participants WHERE user_id = ?", u),
    p("UPDATE collab_responses SET body = '' WHERE author_id = ?", u),
    p("DELETE FROM contributions WHERE user_id = ?", u),
    p("UPDATE comments SET status_note = '' WHERE post_id IN (SELECT id FROM posts WHERE author_id = ?)", u),
    p("DELETE FROM event_rsvps WHERE user_id = ?", u),
    p("DELETE FROM event_posters WHERE submitted_by = ?", u),
    p(`UPDATE users SET email = 'erased:' || id, handle = 'erased_' || substr(id, 3, 8), name = 'Former member',
         headline = '', bio = '', institution = '', location = '', website = '', linkedin = '', orcid = '', orcid_verified = 0,
         avatar_key = '', skills_json = '[]', interests_json = '[]', regions_json = '[]', availability = 'closed',
         job_status = '', contact_pref = 'nobody', match_opt_in = 0, notify_json = '{}', updated_at = ? WHERE id = ?`, t, u),
    ...[...new Set(touched)].map((postId) => recountStatement(DB, postId)),
    // member_count is kept by communities.js; recount the ones they left.
    p(`UPDATE communities SET member_count = (SELECT COUNT(*) FROM community_members cm
         WHERE cm.community_id = communities.id AND cm.status = 'active')
       WHERE id IN (SELECT community_id FROM community_members WHERE user_id = ?) OR member_count > 0`, u),
  ];
  await DB.batch(statements);
  await audit(env, u, "erase_account", "user", u, { media: media.length, posts_touched: touched.length });
  ctx._user = null;
  return { ok: true, erased: true };
}

export const routes = [
  ["GET", "/v1/me", getMe],
  ["PATCH", "/v1/me", patchMe],
  ["DELETE", "/v1/me", eraseMe],
  ["GET", "/v1/me/export", exportMe],
  ["GET", "/v1/users", searchUsers],
  ["GET", "/v1/users/:handle", getUser],
  ["GET", "/v1/users/:handle/followers", followList("followers")],
  ["GET", "/v1/users/:handle/following", followList("following")],
  ["POST", "/v1/me/items", addItem],
  ["PATCH", "/v1/me/items/:id", patchItem],
  ["DELETE", "/v1/me/items/:id", deleteItem],
  ["POST", "/v1/follow", follow],
  ["DELETE", "/v1/follow", unfollow],
  ["GET", "/v1/me/following", myFollowing],
  ["POST", "/v1/blocks", block],
  ["DELETE", "/v1/blocks/:handle", unblock],
  ["GET", "/v1/blocks", listBlocks],
];
