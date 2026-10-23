/**
 * Communities: open (anyone joins), approval (ask, a moderator approves) and
 * private (invitation only, and invisible to everybody else). A private
 * channel is a private community with a parent, made by the parent's
 * moderators.
 *
 * member_count is recounted from community_members after every change rather
 * than incremented, so a double click or a failed request can never leave it
 * drifting.
 */
import {
  fail, now, id, str, oneOf, tags, url, parse, requireUser, currentUser, rateLimit, notify, audit,
  usersById, userByHandle, publicUser, publicPost, VISIBLE_POSTS, visibleBinds, isAdmin, blockedBetween,
} from "./lib.js";
import { body, all, one, run, param, slugify, SLUG_RE, cursorClause, paged, limitOf } from "./collab.js";

const VISIBILITIES = ["open", "approval", "private"];
const MODS = ["owner", "moderator"];

export async function communityBySlug(env, slug) {
  return one(env, "SELECT * FROM communities WHERE slug = ?", str(slug, 60).toLowerCase());
}

async function membership(env, communityId, userId) {
  if (!userId) return null;
  return one(env, "SELECT * FROM community_members WHERE community_id = ? AND user_id = ?", communityId, userId);
}

const activeRole = (m) => (m && m.status === "active" ? m.role : null);

/** Owner/moderator of this community (active), or a site admin acting as owner. */
function modRole(env, user, member) {
  if (isAdmin(env, user)) return "owner";
  const role = activeRole(member);
  return MODS.includes(role) ? role : null;
}

/**
 * The community, or 404. A private community (and so a channel) exists only
 * for its active members, people holding an invitation, the moderators of its
 * parent, and admins.
 */
async function visibleCommunity(ctx, user) {
  const { env } = ctx;
  const community = await communityBySlug(env, ctx.params.slug);
  if (!community) fail(404, "No such community.");
  const member = user ? await membership(env, community.id, user.id) : null;
  if (community.visibility === "private" && !isAdmin(env, user)) {
    const inside = member && (member.status === "active" || member.status === "invited");
    let parentMod = false;
    if (!inside && community.parent_id && user) {
      parentMod = MODS.includes(activeRole(await membership(env, community.parent_id, user.id)));
    }
    if (!inside && !parentMod) fail(404, "No such community.");
  }
  return { community, member };
}

async function recount(env, communityId) {
  await run(env,
    "UPDATE communities SET member_count = (SELECT COUNT(*) FROM community_members WHERE community_id = ? AND status = 'active') WHERE id = ?",
    communityId, communityId);
}

function summary(row, extra = {}) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    tags: parse(row.tags_json, []),
    visibility: row.visibility,
    member_count: row.member_count,
    ...extra,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function list(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const rows = await all(env,
    `SELECT c.*, cm.role AS my_role, cm.status AS my_status FROM communities c
     LEFT JOIN community_members cm ON cm.community_id = c.id AND cm.user_id = ?
     WHERE (c.visibility IN ('open', 'approval') AND c.parent_id IS NULL)
        OR (cm.status = 'active')
     ORDER BY c.member_count DESC, c.name LIMIT 200`, user ? user.id : "");
  return {
    items: rows.map((r) => summary(r, r.my_role ? { role: r.my_role, status: r.my_status } : {})),
    next: null,
  };
}

async function create(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const name = str(b.name, 80);
  if (!name) fail(400, "A community needs a name.");
  const slug = b.slug ? str(b.slug, 40).toLowerCase() : slugify(name);
  if (!SLUG_RE.test(slug)) fail(400, "A community slug is 2-40 characters of a-z, 0-9 and dashes.");
  if (await communityBySlug(env, slug)) fail(409, "That community name is taken.");
  let parentId = null;
  let visibility = oneOf(b.visibility, VISIBILITIES, "open");
  if (b.parent) {
    const parent = await communityBySlug(env, b.parent);
    const pm = parent && await membership(env, parent.id, user.id);
    if (!parent || (parent.visibility === "private" && !activeRole(pm) && !isAdmin(env, user))) fail(404, "No such community.");
    if (!modRole(env, user, pm)) fail(403, "Only the parent community's moderators can make a channel.");
    parentId = parent.id;
    visibility = "private";
  }
  const t = now();
  const cid = id("cm");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO communities (id, slug, name, description, rules, tags_json, visibility, parent_id, created_by, member_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(cid, slug, name, str(b.description, 2000), str(b.rules, 4000), JSON.stringify(tags(b.tags)),
      visibility, parentId, user.id, t),
    env.DB.prepare(
      "INSERT INTO community_members (community_id, user_id, role, status, created_at) VALUES (?, ?, 'owner', 'active', ?)",
    ).bind(cid, user.id, t),
  ]);
  ctx.params.slug = slug;
  return get(ctx);
}

async function get(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const { community, member } = await visibleCommunity(ctx, user);
  const pinned = await all(env,
    `SELECT p.* FROM posts p WHERE p.community_id = ? AND p.pinned = 1 AND ${VISIBLE_POSTS}
     ORDER BY p.created_at DESC LIMIT 20`, community.id, ...visibleBinds(user));
  const authors = await usersById(env, pinned.map((p) => p.author_id));
  const mods = await all(env,
    "SELECT user_id, role FROM community_members WHERE community_id = ? AND status = 'active' AND role IN ('owner', 'moderator') ORDER BY role DESC, created_at",
    community.id);
  const modUsers = await usersById(env, mods.map((m) => m.user_id));
  const isMod = !!modRole(env, user, member);
  // A channel is listed to its own members, and to the parent's moderators who look after it.
  const channels = await all(env,
    `SELECT c.* FROM communities c WHERE c.parent_id = ? AND (? = 1 OR EXISTS
       (SELECT 1 FROM community_members cm WHERE cm.community_id = c.id AND cm.user_id = ? AND cm.status = 'active'))
     ORDER BY c.name`, community.id, isMod ? 1 : 0, user ? user.id : "");
  const parent = community.parent_id ? await one(env, "SELECT slug, name FROM communities WHERE id = ?", community.parent_id) : null;
  return {
    community: {
      ...summary(community),
      rules: community.rules,
      faq: parse(community.faq_json, []),
      resources: parse(community.resources_json, []),
      parent: parent ? { slug: parent.slug, name: parent.name } : null,
      created_at: community.created_at,
    },
    pinned: pinned.map((p) => publicPost(env, p, authors)),
    moderators: mods.map((m) => ({ user: modUsers[m.user_id] || null, role: m.role })),
    channels: channels.map((c) => summary(c)),
    viewer: member ? { role: member.role, status: member.status } : null,
  };
}

async function requireMod(ctx) {
  const user = await requireUser(ctx);
  const { community, member } = await visibleCommunity(ctx, user);
  const role = modRole(ctx.env, user, member);
  if (!role) fail(403, "Only the community's moderators can do that.");
  await rateLimit(ctx, user);
  return { user, community, member, role };
}

function cleanList(list, fn, max = 30) {
  return (Array.isArray(list) ? list : []).slice(0, max).map(fn).filter(Boolean);
}

async function patch(ctx) {
  const { env } = ctx;
  const { community, role } = await requireMod(ctx);
  const b = await body(ctx);
  const sets = [];
  const binds = [];
  const set = (col, v) => { sets.push(`${col} = ?`); binds.push(v); };
  if (b.name !== undefined) {
    const name = str(b.name, 80);
    if (!name) fail(400, "A community needs a name.");
    set("name", name);
  }
  if (b.description !== undefined) set("description", str(b.description, 2000));
  if (b.rules !== undefined) set("rules", str(b.rules, 4000));
  if (b.tags !== undefined) set("tags_json", JSON.stringify(tags(b.tags)));
  if (b.faq !== undefined) {
    set("faq_json", JSON.stringify(cleanList(b.faq, (f) => (f && str(f.q, 300) ? { q: str(f.q, 300), a: str(f.a, 2000) } : null))));
  }
  if (b.resources !== undefined) {
    set("resources_json", JSON.stringify(cleanList(b.resources, (r) => (r && url(r.url) ? { label: str(r.label, 120), url: url(r.url) } : null))));
  }
  if (b.visibility !== undefined && !community.parent_id) {
    // Opening a private community exposes who is in it: the owner's decision.
    if (role !== "owner") fail(403, "Only the owner can change who can join.");
    set("visibility", oneOf(b.visibility, VISIBILITIES, community.visibility));
  }
  if (sets.length) await run(env, `UPDATE communities SET ${sets.join(", ")} WHERE id = ?`, ...binds, community.id);
  return get(ctx);
}

async function join(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const community = await communityBySlug(env, ctx.params.slug);
  if (!community) fail(404, "No such community.");
  const member = await membership(env, community.id, user.id);
  if (member && member.status === "banned") {
    fail(community.visibility === "private" ? 404 : 403, community.visibility === "private" ? "No such community." : "You can't join this community.");
  }
  if (member && member.status === "active") return { status: "active", role: member.role };
  await rateLimit(ctx, user);
  if (member && member.status === "invited") {
    await run(env, "UPDATE community_members SET status = 'active' WHERE community_id = ? AND user_id = ?", community.id, user.id);
    await recount(env, community.id);
    return { status: "active", role: member.role };
  }
  if (community.visibility === "private") fail(404, "No such community.");
  if (member && member.status === "requested") return { status: "requested" };
  const status = community.visibility === "approval" ? "requested" : "active";
  await run(env, "INSERT INTO community_members (community_id, user_id, role, status, created_at) VALUES (?, ?, 'member', ?, ?)",
    community.id, user.id, status, now());
  if (status === "requested") {
    const mods = await all(env,
      "SELECT user_id FROM community_members WHERE community_id = ? AND status = 'active' AND role IN ('owner', 'moderator')", community.id);
    for (const m of mods) await notify(env, m.user_id, "invite", user.id, "community", community.slug, `Asked to join ${community.name}`);
  } else {
    await recount(env, community.id);
  }
  return { status, role: "member" };
}

async function leave(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const community = await communityBySlug(env, ctx.params.slug);
  const member = community && await membership(env, community.id, user.id);
  if (!member) fail(404, "You aren't in this community.");
  // Leaving must not wipe a ban, or leave-and-rejoin would undo it.
  if (member.status === "banned") return { ok: true };
  if (member.role === "owner" && member.status === "active") {
    const owners = await one(env,
      "SELECT COUNT(*) AS n FROM community_members WHERE community_id = ? AND role = 'owner' AND status = 'active'", community.id);
    if (owners.n <= 1) fail(409, "Hand ownership to someone else before leaving.");
  }
  await rateLimit(ctx, user);
  await run(env, "DELETE FROM community_members WHERE community_id = ? AND user_id = ?", community.id, user.id);
  await recount(env, community.id);
  return { ok: true };
}

async function members(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const { community, member } = await visibleCommunity(ctx, user);
  const status = oneOf(param(ctx, "status"), ["active", "requested", "invited", "banned"], "active");
  if (status !== "active" && !modRole(env, user, member)) fail(403, "Only moderators can see pending and banned members.");
  const where = ["cm.community_id = ?", "cm.status = ?"];
  const binds = [community.id, status];
  const skill = tags([param(ctx, "skill")])[0];
  if (skill) { where.push("u.skills_json LIKE ?"); binds.push(`%"${skill}"%`); }
  const text = str(param(ctx, "q"), 80);
  if (text) { where.push("(u.handle LIKE ? OR u.name LIKE ? OR u.headline LIKE ?)"); binds.push(`%${text}%`, `%${text}%`, `%${text}%`); }
  const limit = limitOf(ctx);
  const cur = cursorClause(ctx, "cm.created_at", "cm.user_id");
  const rows = await all(env,
    `SELECT u.*, cm.role AS m_role, cm.status AS m_status, cm.created_at AS m_at FROM community_members cm
     JOIN users u ON u.id = cm.user_id WHERE ${where.join(" AND ")}${cur.sql}
     ORDER BY cm.created_at DESC, cm.user_id DESC LIMIT ?`, ...binds, ...cur.binds, limit + 1);
  const page = paged(rows, limit, (r) => ({ created_at: r.m_at, id: r.id }));
  return {
    items: page.items.map((r) => ({
      ...publicUser(env, r),
      skills: parse(r.skills_json, []),
      availability: r.availability,
      role: r.m_role,
      status: r.m_status,
      since: r.m_at,
    })),
    next: page.next,
  };
}

async function setMember(ctx) {
  const { env } = ctx;
  const { user, community, role: myRole } = await requireMod(ctx);
  const b = await body(ctx);
  const target = await userByHandle(env, ctx.params.handle);
  if (!target) fail(404, "No one has that handle.");
  const row = await membership(env, community.id, target.id);
  const wantRole = b.role !== undefined ? oneOf(b.role, ["owner", "moderator", "member"], null) : null;
  if (b.role !== undefined && !wantRole) fail(400, "role must be owner, moderator or member.");
  const wantStatus = b.status !== undefined ? oneOf(b.status, ["active", "invited", "banned"], null) : (row ? null : "invited");
  if (b.status !== undefined && !wantStatus) fail(400, "status must be active (approve), invited or banned.");
  // Moderators look after members; the owner decides who moderates.
  if (row && MODS.includes(row.role) && myRole !== "owner" && target.id !== user.id) {
    fail(403, "Only the owner can change a moderator.");
  }
  if (wantRole === "owner" && myRole !== "owner") fail(403, "Only the owner can make another owner.");
  if (row && row.role === "owner" && (wantRole && wantRole !== "owner" || wantStatus === "banned")) {
    const owners = await one(env,
      "SELECT COUNT(*) AS n FROM community_members WHERE community_id = ? AND role = 'owner' AND status = 'active'", community.id);
    if (owners.n <= 1) fail(409, "A community needs an owner.");
  }
  let status = row ? row.status : null;
  if (wantStatus === "invited") {
    if (row && row.status === "active") fail(409, "They are already a member.");
    if (row && row.status === "banned") fail(409, "They are banned; lift the ban first by approving them.");
    if (await blockedBetween(env, user.id, target.id)) fail(403, "You can't invite this person.");
    status = row && row.status === "requested" ? "active" : "invited";
  } else if (wantStatus === "active") {
    if (!row) fail(409, "They haven't asked to join. Invite them instead.");
    if (row.status === "invited") fail(409, "They have to accept the invitation themselves.");
    status = "active";
  } else if (wantStatus === "banned") {
    status = "banned";
  }
  const role = wantRole || (row ? row.role : "member");
  if (row) {
    await run(env, "UPDATE community_members SET role = ?, status = ? WHERE community_id = ? AND user_id = ?",
      role, status, community.id, target.id);
  } else {
    await run(env, "INSERT INTO community_members (community_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)",
      community.id, target.id, role, status, now());
  }
  await recount(env, community.id);
  if (!row || row.status !== status || row.role !== role) {
    await audit(env, user.id, "community.member", "community", community.id,
      { user: target.id, from: row ? { role: row.role, status: row.status } : null, to: { role, status } });
  }
  if (status === "invited" && (!row || row.status !== "invited")) {
    await notify(env, target.id, "invite", user.id, "community", community.slug, `Invited you to join ${community.name}`);
  } else if (status === "active" && row && row.status !== "active") {
    await notify(env, target.id, "invite", user.id, "community", community.slug, `You joined ${community.name}`);
  } else if (status === "banned" && (!row || row.status !== "banned")) {
    await notify(env, target.id, "moderation", user.id, "community", community.slug, `You were removed from ${community.name}`);
  } else if (row && role !== row.role) {
    await notify(env, target.id, "invite", user.id, "community", community.slug, `You are now ${role} of ${community.name}`);
  }
  return { user: publicUser(env, target), role, status };
}

async function pin(ctx, value) {
  const { env } = ctx;
  const { user, community } = await requireMod(ctx);
  const post = await one(env, "SELECT id FROM posts WHERE id = ? AND community_id = ? AND removed_at IS NULL",
    str(ctx.params.post_id, 60), community.id);
  if (!post) fail(404, "No such post in this community.");
  await run(env, "UPDATE posts SET pinned = ? WHERE id = ?", value, post.id);
  await audit(env, user.id, value ? "community.pin" : "community.unpin", "post", post.id, { community: community.id });
  return { pinned: !!value };
}

export const routes = [
  ["GET", "/v1/communities", list],
  ["POST", "/v1/communities", create],
  ["GET", "/v1/communities/:slug", get],
  ["PATCH", "/v1/communities/:slug", patch],
  ["POST", "/v1/communities/:slug/join", join],
  ["POST", "/v1/communities/:slug/leave", leave],
  ["GET", "/v1/communities/:slug/members", members],
  ["POST", "/v1/communities/:slug/members/:handle", setMember],
  ["POST", "/v1/communities/:slug/pin/:post_id", (ctx) => pin(ctx, 1)],
  ["DELETE", "/v1/communities/:slug/pin/:post_id", (ctx) => pin(ctx, 0)],
];
