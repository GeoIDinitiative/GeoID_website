/**
 * Collaboration requests, and the credit for work other people contribute.
 *
 * A REQUEST is a member asking for help -- to join a project, review a
 * method, contribute a dataset or validate a model -- either of named people
 * (audience "member": only they and the requester can open it) or of a
 * community or everybody with the skills listed (discoverable while open).
 * Named people accept or decline; anybody else who can see an open request
 * OFFERS, and the requester chooses whom to take. The first acceptance opens
 * a conversation (reusing an existing DM between the two when there is one),
 * so the work moves to where people already talk.
 *
 *   open -> accepted | declined -> in_progress -> completed | withdrawn
 *
 * CREDIT is a contributions row, written only by the person whose work was
 * improved: the requester acknowledging a finished request, or a post's
 * author accepting a correction or suggestion comment on it. Nobody can
 * credit themselves, and reputation.js counts a row only while the comment or
 * request it points at is still there.
 *
 * Who may see what follows the rest of the Worker: an unseeable request is a
 * 404, never a 403; blocks hide a request either way; linked posts and
 * projects are shown only to viewers who may open them.
 */
import {
  fail, now, id, str, oneOf, int, tags, parse, requireUser, currentUser, rateLimit, notify,
  usersById, userByHandle, blockedBetween, teamRole, communityRole, canSeePost, NOT_BLOCKED,
} from "./lib.js";
import { body, all, one, run, param, cursorClause, paged, limitOf, bool } from "./collab.js";
import { loadProject, projectRole, atLeast } from "./projects.js";

export const REQUEST_KINDS = ["join_project", "review_method", "contribute_dataset", "validate_model", "other"];
const AUDIENCES = ["member", "community", "everyone"];
const MAX_INVITES = 10;
// What each status may become. "accepted" is never set by hand: it follows an
// acceptance (respond) or a choice (choose).
const NEXT = {
  open: ["withdrawn"],
  accepted: ["in_progress", "completed", "withdrawn"],
  declined: ["open", "withdrawn"],
  in_progress: ["completed", "withdrawn"],
  completed: [],
  withdrawn: ["open"],
};
const REQUESTER_MOVES = ["withdrawn", "open", "in_progress", "completed"];
const HELPER_MOVES = ["in_progress", "completed"];
const STATUS_TEXT = {
  open: "Reopened", in_progress: "Started work on", completed: "Marked as completed", withdrawn: "Withdrew",
};

export async function loadRequest(env, requestId) {
  return one(env, "SELECT * FROM collab_requests WHERE id = ?", str(requestId, 60));
}

async function participant(env, requestId, userId) {
  return userId ? one(env, "SELECT * FROM collab_participants WHERE request_id = ? AND user_id = ?", requestId, userId) : null;
}

/**
 * The viewer's relation to a request: "requester" | "helper" (accepted) |
 * "participant" (invited, offered or declined) | "reader", or null (= 404).
 * A block either way hides it, even from somebody who was asked.
 */
export async function requestRole(env, user, req) {
  if (!req) return null;
  if (user && req.requester_id === user.id) return "requester";
  if (user && await blockedBetween(env, user.id, req.requester_id)) return null;
  const mine = user && await participant(env, req.id, user.id);
  if (mine) return mine.status === "accepted" ? "helper" : "participant";
  // Asked on behalf of a team: the team can see what was asked in its name.
  if (user && req.team_id && await teamRole(env, req.team_id, user.id)) return "reader";
  if (req.audience === "everyone") return "reader";
  if (req.audience === "community" && user && req.community_id && await communityRole(env, req.community_id, user.id)) return "reader";
  return null;
}

async function visible(ctx, user) {
  const req = await loadRequest(ctx.env, ctx.params.id);
  const role = await requestRole(ctx.env, user, req);
  if (!role) fail(404, "No such request.");
  return { req, role };
}

const inList = (n) => Array(n).fill("?").join(",");

/** Requests as the page draws them; linked post/project only where the viewer may open them. */
async function shapes(env, viewer, rows) {
  if (!rows.length) return [];
  const users = await usersById(env, rows.map((r) => r.requester_id));
  const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))];
  const commIds = [...new Set(rows.map((r) => r.community_id).filter(Boolean))];
  const teams = teamIds.length ? await all(env, `SELECT id, slug, name FROM teams WHERE id IN (${inList(teamIds.length)})`, ...teamIds) : [];
  const comms = commIds.length ? await all(env, `SELECT id, slug, name FROM communities WHERE id IN (${inList(commIds.length)})`, ...commIds) : [];
  const ids = rows.map((r) => r.id);
  const counts = await all(env,
    `SELECT request_id, status, COUNT(*) AS n FROM collab_participants WHERE request_id IN (${inList(ids.length)}) GROUP BY request_id, status`, ...ids);
  const out = [];
  for (const r of rows) {
    let post = null;
    if (r.post_id) {
      const p = await one(env, "SELECT * FROM posts WHERE id = ?", r.post_id);
      if (await canSeePost(env, viewer, p)) post = { id: p.id, kind: p.kind, title: p.title || str(p.body, 80) };
    }
    let project = null;
    if (r.project_id) {
      const pr = await loadProject(env, r.project_id);
      if (await projectRole(env, viewer, pr)) project = { id: pr.id, title: pr.title };
    }
    const n = (status) => counts.filter((c) => c.request_id === r.id && c.status === status).reduce((s, c) => s + c.n, 0);
    const team = teams.find((t) => t.id === r.team_id);
    const comm = comms.find((c) => c.id === r.community_id);
    out.push({
      id: r.id,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      skills: parse(r.skills_json, []),
      audience: r.audience,
      community: comm ? { slug: comm.slug, name: comm.name } : null,
      team: team ? { slug: team.slug, name: team.name } : null,
      project,
      post,
      due_at: r.due_at,
      status: r.status,
      requester: users[r.requester_id] || null,
      counts: { helpers: n("accepted"), offers: n("offered"), invited: n("invited") },
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  }
  return out;
}

async function respondNote(env, requestId, authorId, kind, text) {
  await run(env, "INSERT INTO collab_responses (id, request_id, author_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id("cr"), requestId, authorId, kind, str(text, 5000), now());
}

async function touch(env, req, status = req.status) {
  await run(env, "UPDATE collab_requests SET status = ?, updated_at = ? WHERE id = ?", status, now(), req.id);
  req.status = status;
}

/**
 * The request's conversation, made or reused when somebody is accepted.
 *
 * One helper: an existing DM between the two is reused (they already talk
 * there), else a new DM. A second helper moves it to a group of everybody
 * accepted, titled after the request. Both sides chose this -- one asked, the
 * other accepted -- so nobody lands in Requests.
 */
async function ensureConversation(env, req, actor, helperId) {
  const t = now();
  const helpers = (await all(env, "SELECT user_id FROM collab_participants WHERE request_id = ? AND status = 'accepted'", req.id))
    .map((r) => r.user_id);
  const members = [req.requester_id, ...helpers];
  let conv = req.conversation_id ? await one(env, "SELECT * FROM conversations WHERE id = ?", req.conversation_id) : null;
  if (conv && conv.kind === "dm" && helpers.length > 1) conv = null;
  if (!conv && helpers.length === 1) {
    conv = await one(env,
      `SELECT c.* FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.kind = 'dm' ORDER BY c.last_at DESC LIMIT 1`, req.requester_id, helperId);
  }
  const statements = [];
  if (!conv) {
    const convId = id("cv");
    const dm = helpers.length === 1;
    statements.push(env.DB.prepare("INSERT INTO conversations (id, kind, title, created_by, last_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(convId, dm ? "dm" : "group", dm ? "" : str(`Request: ${req.title}`, 120), actor.id, t, t));
    conv = { id: convId };
  }
  for (const uid of members) {
    statements.push(env.DB.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, status, last_read) VALUES (?, ?, 'active', 0)
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET status = 'active'`).bind(conv.id, uid));
  }
  const text = `About the request "${req.title}": accepted, so let's work on it here.`;
  statements.push(
    env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, body, media_json, created_at) VALUES (?, ?, ?, ?, '[]', ?)")
      .bind(id("msg"), conv.id, actor.id, text, t),
    env.DB.prepare("UPDATE conversations SET last_at = ? WHERE id = ?").bind(t, conv.id),
    env.DB.prepare("UPDATE conversation_members SET last_read = ? WHERE conversation_id = ? AND user_id = ?").bind(t, conv.id, actor.id),
    env.DB.prepare("UPDATE collab_requests SET conversation_id = ?, updated_at = ? WHERE id = ?").bind(conv.id, t, req.id),
  );
  await env.DB.batch(statements);
  req.conversation_id = conv.id;
  return conv.id;
}

// ── Routes: requests ───────────────────────────────────────────────────────

async function create(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const title = str(b.title, 200);
  if (!title) fail(400, "Say what you need help with in a title.");
  const kind = b.kind == null ? "other" : oneOf(b.kind, REQUEST_KINDS, null);
  if (!kind) fail(400, `kind must be one of ${REQUEST_KINDS.join(", ")}.`);

  // Whom: named people, a community, or everybody.
  const handles = [...new Set((Array.isArray(b.handles) ? b.handles : b.handle ? [b.handle] : [])
    .map((h) => str(h, 40).toLowerCase().replace(/^@/, "")).filter(Boolean))];
  if (handles.length > MAX_INVITES) fail(400, `Ask at most ${MAX_INVITES} people by name; open it to a community for more.`);
  const invitees = [];
  for (const h of handles) {
    const target = await userByHandle(env, h);
    if (!target) fail(404, `No one has the handle ${h}.`);
    if (target.id === user.id) fail(400, "You can't ask yourself.");
    if (await blockedBetween(env, user.id, target.id)) fail(403, `You can't ask ${h}.`);
    invitees.push(target);
  }
  let audience = oneOf(b.audience, AUDIENCES, null);
  let communityId = null;
  if (b.community_slug) {
    const c = await one(env, "SELECT id FROM communities WHERE slug = ?", str(b.community_slug, 60).toLowerCase());
    if (!c || !(await communityRole(env, c.id, user.id))) fail(404, "No such community, or you aren't a member.");
    communityId = c.id;
    audience = "community";
  }
  if (!audience) audience = "member";
  if (audience === "community" && !communityId) fail(400, "A community request needs a community_slug.");
  if (audience === "member" && !invitees.length) fail(400, "Name who you are asking, or open it to a community or to everyone.");

  let teamId = null;
  if (b.team_slug) {
    const team = await one(env, "SELECT id FROM teams WHERE slug = ?", str(b.team_slug, 60).toLowerCase());
    const role = team && await teamRole(env, team.id, user.id);
    if (!role) fail(404, "No such team.");
    if (role === "viewer") fail(403, "Viewers can't ask on a team's behalf.");
    teamId = team.id;
  }
  let projectId = null;
  if (b.project_id) {
    const project = await loadProject(env, b.project_id);
    const role = await projectRole(env, user, project);
    if (!role) fail(404, "No such project.");
    // Inviting somebody INTO a project is the project's people's call.
    if (kind === "join_project" && !atLeast(role, "editor")) fail(403, "Only the project's owner or editors can invite people to join it.");
    projectId = project.id;
  }
  if (kind === "join_project" && !projectId) fail(400, "A request to join a project needs the project_id.");
  let postId = null;
  if (b.post_id) {
    const post = await one(env, "SELECT * FROM posts WHERE id = ?", str(b.post_id, 60));
    if (!(await canSeePost(env, user, post))) fail(404, "No such post.");
    postId = post.id;
  }

  const t = now();
  const requestId = id("rq");
  const statements = [env.DB.prepare(
    `INSERT INTO collab_requests (id, requester_id, kind, title, detail, skills_json, audience, community_id, team_id,
       project_id, post_id, due_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).bind(requestId, user.id, kind, title, str(b.detail, 5000), JSON.stringify(tags(b.skills)), audience, communityId, teamId,
    projectId, postId, int(b.due_at, null), t, t)];
  for (const target of invitees) {
    statements.push(env.DB.prepare(
      "INSERT INTO collab_participants (request_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'invited', ?, ?)",
    ).bind(requestId, target.id, t, t));
  }
  await env.DB.batch(statements);
  for (const target of invitees) {
    await notify(env, target.id, "request", user.id, "request", requestId, `Asked you for help: "${title}"`);
  }
  ctx.params.id = requestId;
  return get(ctx);
}

async function list(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const role = oneOf(param(ctx, "role"), ["open", "mine", "asked", "helping"], "open");
  const limit = limitOf(ctx);
  const cur = cursorClause(ctx, "r.created_at", "r.id");
  const where = [];
  const binds = [];
  const skill = tags([param(ctx, "skill") || ""])[0];
  if (skill) { where.push("EXISTS (SELECT 1 FROM json_each(r.skills_json) WHERE value = ?)"); binds.push(skill); }
  const kind = oneOf(param(ctx, "kind"), REQUEST_KINDS, null);
  if (kind) { where.push("r.kind = ?"); binds.push(kind); }
  if (param(ctx, "community")) {
    const c = await one(env, "SELECT id FROM communities WHERE slug = ?", str(param(ctx, "community"), 60).toLowerCase());
    where.push("r.community_id = ?"); binds.push(c ? c.id : "");
  }
  const extra = where.length ? ` AND ${where.join(" AND ")}` : "";
  let rows;
  if (role === "open") {
    const uid = user ? user.id : "";
    rows = await all(env,
      `SELECT r.* FROM collab_requests r WHERE r.status = 'open' AND r.requester_id != ? AND (
         r.audience = 'everyone'
         OR (r.audience = 'community' AND r.community_id IN (SELECT community_id FROM community_members WHERE user_id = ? AND status = 'active')))
       AND ${NOT_BLOCKED("r.requester_id")}${extra}${cur.sql}
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, uid, uid, uid, uid, ...binds, ...cur.binds, limit + 1);
  } else {
    if (!user) fail(401, "Sign in to see your requests.");
    if (role === "mine") {
      rows = await all(env, `SELECT r.* FROM collab_requests r WHERE r.requester_id = ?${extra}${cur.sql}
        ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, user.id, ...binds, ...cur.binds, limit + 1);
    } else {
      const statuses = role === "asked" ? "('invited', 'declined')" : "('accepted', 'offered')";
      rows = await all(env,
        `SELECT r.*, cp.status AS my_status FROM collab_requests r
         JOIN collab_participants cp ON cp.request_id = r.id AND cp.user_id = ? AND cp.status IN ${statuses}
         WHERE ${NOT_BLOCKED("r.requester_id")}${extra}${cur.sql}
         ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, user.id, user.id, user.id, ...binds, ...cur.binds, limit + 1);
    }
  }
  const page = paged(rows, limit);
  const items = await shapes(env, user, page.items);
  page.items.forEach((r, i) => { if (r.my_status) items[i].my_status = r.my_status; });
  return { items, next: page.next };
}

async function get(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const { req, role } = await visible(ctx, user);
  const [shape] = await shapes(env, user, [req]);
  // Who was asked and who offered is between them and the requester; the
  // people actually helping are named to every reader -- that is the credit.
  const parts = await all(env, "SELECT * FROM collab_participants WHERE request_id = ? ORDER BY created_at, user_id", req.id);
  const shown = parts.filter((p) => role === "requester" || p.status === "accepted" || (user && p.user_id === user.id));
  // The thread: the requester reads all of it; somebody on the request reads
  // their own notes, the requester's, and the record of who accepted what.
  let responses = [];
  if (role === "requester") {
    responses = await all(env, "SELECT * FROM collab_responses WHERE request_id = ? ORDER BY created_at, rowid LIMIT 500", req.id);
  } else if (role === "helper" || role === "participant") {
    responses = await all(env,
      `SELECT * FROM collab_responses WHERE request_id = ? AND (author_id = ? OR author_id = ? OR kind IN ('accept', 'status'))
       ORDER BY created_at, rowid LIMIT 500`, req.id, user.id, req.requester_id);
  }
  const users = await usersById(env, [...shown.map((p) => p.user_id), ...responses.map((r) => r.author_id)]);
  const mine = user ? parts.find((p) => p.user_id === user.id) : null;
  return {
    request: shape,
    viewer_role: role,
    my_status: mine ? mine.status : null,
    participants: shown.map((p) => ({
      user: users[p.user_id] || null, status: p.status, acknowledged: !!p.acknowledged_at, acknowledged_at: p.acknowledged_at,
    })).filter((p) => p.user),
    responses: responses.map((r) => ({ id: r.id, author: users[r.author_id] || null, kind: r.kind, body: r.body, created_at: r.created_at })),
    conversation_id: role === "requester" || role === "helper" ? req.conversation_id : null,
  };
}

async function patch(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { req, role } = await visible(ctx, user);
  if (role !== "requester" && role !== "helper") fail(403, "Only the person who asked, or somebody helping, can change this request.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  if (role === "requester") {
    const title = b.title !== undefined ? str(b.title, 200) : req.title;
    if (!title) fail(400, "A request needs a title.");
    const kind = b.kind !== undefined ? oneOf(b.kind, REQUEST_KINDS, null) : req.kind;
    if (!kind) fail(400, `kind must be one of ${REQUEST_KINDS.join(", ")}.`);
    await run(env, "UPDATE collab_requests SET title = ?, kind = ?, detail = ?, skills_json = ?, due_at = ?, updated_at = ? WHERE id = ?",
      title, kind, b.detail !== undefined ? str(b.detail, 5000) : req.detail,
      b.skills !== undefined ? JSON.stringify(tags(b.skills)) : req.skills_json,
      b.due_at !== undefined ? int(b.due_at, null) : req.due_at, now(), req.id);
    req.title = title;
  }
  if (b.status !== undefined && b.status !== req.status) {
    const to = String(b.status);
    const allowed = role === "requester" ? REQUESTER_MOVES : HELPER_MOVES;
    if (!allowed.includes(to)) fail(403, role === "helper" ? "Helpers can mark a request in progress or completed." : `status can't be set to ${str(to, 20)}.`);
    if (!(NEXT[req.status] || []).includes(to)) fail(409, `A request that is ${req.status.replace("_", " ")} can't become ${to.replace("_", " ")}.`);
    if (to === "open") {
      // Reopening asks the people who said no again, so they can answer anew.
      await run(env, "UPDATE collab_participants SET status = 'invited', updated_at = ? WHERE request_id = ? AND status = 'declined'", now(), req.id);
    }
    await touch(env, req, to);
    await respondNote(env, req.id, user.id, "status", STATUS_TEXT[to] || to);
    const told = role === "requester"
      ? (await all(env, "SELECT user_id FROM collab_participants WHERE request_id = ? AND status IN ('accepted', 'invited', 'offered')", req.id)).map((r) => r.user_id)
      : [req.requester_id];
    for (const uid of told) {
      await notify(env, uid, "request", user.id, "request", req.id, `${STATUS_TEXT[to] || to} "${req.title}"`);
    }
  }
  return get(ctx);
}

/**
 * The answer of somebody who is not the requester.
 *   invited  -> accept: helping (a conversation opens) | decline
 *   anyone else on an open, non-private request -> accept: an offer the
 *   requester chooses from | decline: withdraw their own offer
 */
async function respond(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { req, role } = await visible(ctx, user);
  if (role === "requester") fail(400, "This is your own request.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const accept = bool(b.accept, false);
  const message = str(b.message, 5000);
  const mine = await participant(env, req.id, user.id);
  const t = now();
  if (mine && mine.status === "invited") {
    if (!["open", "accepted", "in_progress"].includes(req.status)) fail(409, "This request is no longer open.");
    await run(env, "UPDATE collab_participants SET status = ?, updated_at = ? WHERE request_id = ? AND user_id = ?",
      accept ? "accepted" : "declined", t, req.id, user.id);
    await respondNote(env, req.id, user.id, accept ? "accept" : "decline", message);
    if (accept) {
      if (req.status === "open") await touch(env, req, "accepted");
      await ensureConversation(env, req, user, user.id);
    } else {
      // Everybody asked has said no and nobody is helping: the request says so.
      const left = await one(env, "SELECT COUNT(*) AS n FROM collab_participants WHERE request_id = ? AND status IN ('invited', 'accepted', 'offered')", req.id);
      if (req.status === "open" && req.audience === "member" && !left.n) await touch(env, req, "declined");
    }
    await notify(env, req.requester_id, "request", user.id, "request", req.id,
      `${accept ? "Agreed to help with" : "Declined"} "${req.title}"${message ? `: ${message}` : ""}`);
    return get(ctx);
  }
  if (mine && mine.status === "accepted") fail(409, "You are already helping with this.");
  if (req.audience === "member") fail(403, "This request is by invitation only.");
  if (!accept) {
    if (mine && mine.status === "offered") {
      await run(env, "DELETE FROM collab_participants WHERE request_id = ? AND user_id = ?", req.id, user.id);
      await respondNote(env, req.id, user.id, "decline", message || "Withdrew their offer");
    }
    return get(ctx);
  }
  if (req.status !== "open") fail(409, "This request is no longer taking offers.");
  if (mine && mine.status === "offered") fail(409, "You have already offered to help.");
  if (mine) {
    await run(env, "UPDATE collab_participants SET status = 'offered', updated_at = ? WHERE request_id = ? AND user_id = ?", t, req.id, user.id);
  } else {
    await run(env, "INSERT INTO collab_participants (request_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'offered', ?, ?)",
      req.id, user.id, t, t);
  }
  await respondNote(env, req.id, user.id, "offer", message);
  await notify(env, req.requester_id, "request", user.id, "request", req.id,
    `Offered to help with "${req.title}"${message ? `: ${message}` : ""}`);
  return get(ctx);
}

/** The requester takes (or turns down) somebody who offered. */
async function choose(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { req, role } = await visible(ctx, user);
  if (role !== "requester") fail(403, "Only the person who asked can choose who helps.");
  if (!["open", "accepted", "in_progress"].includes(req.status)) fail(409, "This request is no longer open.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const target = await userByHandle(env, str(b.handle, 40).replace(/^@/, ""));
  const row = target && await participant(env, req.id, target.id);
  if (!row || row.status !== "offered") fail(404, "That person has not offered to help.");
  const accept = bool(b.accept, false);
  if (accept && await blockedBetween(env, user.id, target.id)) fail(403, "You can't work with this person.");
  await run(env, "UPDATE collab_participants SET status = ?, updated_at = ? WHERE request_id = ? AND user_id = ?",
    accept ? "accepted" : "declined", now(), req.id, target.id);
  await respondNote(env, req.id, user.id, accept ? "accept" : "decline", `${accept ? "Accepted" : "Declined"} @${target.handle}'s offer`);
  if (accept) {
    if (req.status === "open") await touch(env, req, "accepted");
    await ensureConversation(env, req, user, target.id);
  }
  await notify(env, target.id, "request", user.id, "request", req.id,
    accept ? `Accepted your offer to help with "${req.title}"` : `Thanked you, but chose someone else for "${req.title}"`);
  return get(ctx);
}

async function invite(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { req, role } = await visible(ctx, user);
  if (role !== "requester") fail(403, "Only the person who asked can invite people.");
  if (["completed", "withdrawn"].includes(req.status)) fail(409, "This request is closed.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const target = await userByHandle(env, str(b.handle, 40).replace(/^@/, ""));
  if (!target) fail(404, "No one has that handle.");
  if (target.id === user.id) fail(400, "You can't ask yourself.");
  if (await blockedBetween(env, user.id, target.id)) fail(403, "You can't ask this person.");
  const count = await one(env, "SELECT COUNT(*) AS n FROM collab_participants WHERE request_id = ? AND status = 'invited'", req.id);
  if (count.n >= MAX_INVITES * 2) fail(409, "That is a lot of people waiting to answer. Give them time, or open the request to a community.");
  const row = await participant(env, req.id, target.id);
  if (row && ["invited", "accepted"].includes(row.status)) fail(409, "They are already on this request.");
  const t = now();
  if (row) {
    await run(env, "UPDATE collab_participants SET status = 'invited', updated_at = ? WHERE request_id = ? AND user_id = ?", t, req.id, target.id);
  } else {
    await run(env, "INSERT INTO collab_participants (request_id, user_id, status, created_at, updated_at) VALUES (?, ?, 'invited', ?, ?)",
      req.id, target.id, t, t);
  }
  if (req.status === "declined") await touch(env, req, "open");
  await notify(env, target.id, "request", user.id, "request", req.id, `Asked you for help: "${req.title}"`);
  return { status: "invited", handle: target.handle };
}

/** A note on the request's thread, between the requester and the people on it. */
async function message(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { req, role } = await visible(ctx, user);
  if (role === "reader") fail(403, "Offer to help first; then you can write to the person who asked.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const text = str(b.body, 5000);
  if (!text) fail(400, "Write something.");
  const responseId = id("cr");
  const t = now();
  await run(env, "INSERT INTO collab_responses (id, request_id, author_id, kind, body, created_at) VALUES (?, ?, ?, 'message', ?, ?)",
    responseId, req.id, user.id, text, t);
  const told = role === "requester"
    ? (await all(env, "SELECT user_id FROM collab_participants WHERE request_id = ? AND status IN ('accepted', 'offered', 'invited')", req.id)).map((r) => r.user_id)
    : [req.requester_id];
  for (const uid of told) await notify(env, uid, "request", user.id, "request", req.id, `Wrote on "${req.title}": ${text}`);
  const users = await usersById(env, [user.id]);
  return { id: responseId, author: users[user.id], kind: "message", body: text, created_at: t };
}

/** The requester credits a helper's finished work: a contributions row they can point to. */
async function acknowledge(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { req, role } = await visible(ctx, user);
  if (role !== "requester") fail(403, "Only the person who asked can acknowledge the work.");
  if (req.status !== "completed") fail(409, "Mark the request completed first.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  let helpers = await all(env, "SELECT * FROM collab_participants WHERE request_id = ? AND status = 'accepted'", req.id);
  if (b.handle) {
    const target = await userByHandle(env, str(b.handle, 40).replace(/^@/, ""));
    helpers = helpers.filter((h) => target && h.user_id === target.id);
    if (!helpers.length) fail(404, "That person was not helping with this request.");
  } else if (helpers.length !== 1) {
    fail(400, helpers.length ? "Say whose contribution to acknowledge (handle)." : "Nobody was helping with this request.");
  }
  const helper = helpers[0];
  const t = now();
  const note = str(b.note, 500);
  await env.DB.batch([
    env.DB.prepare("UPDATE collab_participants SET acknowledged_at = COALESCE(acknowledged_at, ?), updated_at = ? WHERE request_id = ? AND user_id = ?")
      .bind(t, t, req.id, helper.user_id),
    env.DB.prepare(
      `INSERT INTO contributions (id, user_id, credited_by, kind, ref_type, ref_id, post_id, note, created_at)
       VALUES (?, ?, ?, 'request', 'request', ?, ?, ?, ?)
       ON CONFLICT(ref_type, ref_id, user_id) DO UPDATE SET note = excluded.note`,
    ).bind(id("ct"), helper.user_id, user.id, req.id, req.post_id, note, t),
  ]);
  await notify(env, helper.user_id, "contribution", user.id, "request", req.id, `Acknowledged your contribution to "${req.title}"`);
  return get(ctx);
}

// ── Routes: accepted corrections and suggestions ───────────────────────────

const DECISIONS = { accepted: "accepted", declined: "declined", open: "", "": "" };

/**
 * The post's author decides on a correction or suggestion. Accepting credits
 * the commenter (a contributions row) and tells them; declining, or undoing,
 * takes the credit back. Comments of kind "comment" are not changes to the
 * work, so they have nothing to accept.
 */
async function decide(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const comment = await one(env, "SELECT * FROM comments WHERE id = ? AND removed_at IS NULL", str(ctx.params.id, 60));
  const post = comment && await one(env, "SELECT * FROM posts WHERE id = ?", comment.post_id);
  if (!comment || !(await canSeePost(env, user, post))) fail(404, "No such comment.");
  if (post.author_id !== user.id) fail(403, "Only the post's author can accept or decline a change.");
  if (comment.kind !== "correction" && comment.kind !== "suggestion") fail(400, "Only corrections and suggestions can be accepted.");
  if (comment.author_id === user.id) fail(400, "You can't accept your own suggestion.");
  const b = await body(ctx);
  const status = DECISIONS[String(b.status ?? "")];
  if (status === undefined) fail(400, "status must be accepted, declined or open.");
  const note = str(b.note, 500);
  const t = now();
  const statements = [env.DB.prepare("UPDATE comments SET status = ?, status_note = ?, status_at = ? WHERE id = ?")
    .bind(status, status ? note : "", status ? t : null, comment.id)];
  if (status === "accepted") {
    statements.push(env.DB.prepare(
      `INSERT INTO contributions (id, user_id, credited_by, kind, ref_type, ref_id, post_id, note, created_at)
       VALUES (?, ?, ?, ?, 'comment', ?, ?, ?, ?)
       ON CONFLICT(ref_type, ref_id, user_id) DO UPDATE SET note = excluded.note`,
    ).bind(id("ct"), comment.author_id, user.id, comment.kind, comment.id, post.id, note, t));
  } else {
    statements.push(env.DB.prepare("DELETE FROM contributions WHERE ref_type = 'comment' AND ref_id = ?").bind(comment.id));
  }
  await env.DB.batch(statements);
  if (status && status !== comment.status) {
    const what = comment.kind === "correction" ? "correction" : "suggestion";
    await notify(env, comment.author_id, "contribution", user.id, "post", post.id,
      `${status === "accepted" ? "Accepted" : "Declined"} your ${what} on "${post.title || "a post"}"${note ? `: ${note}` : ""}`);
  }
  return { id: comment.id, kind: comment.kind, status, status_note: status ? note : "", status_at: status ? t : null };
}

/** "Changes accepted from the community" on a post, crediting each contributor. */
async function postContributions(ctx) {
  const { env } = ctx;
  const viewer = await currentUser(ctx);
  const post = await one(env, "SELECT * FROM posts WHERE id = ?", str(ctx.params.id, 60));
  if (!(await canSeePost(env, viewer, post))) fail(404, "No such post.");
  const binds = [post.id];
  let blocked = "";
  if (viewer) { blocked = ` AND ${NOT_BLOCKED("c.author_id")}`; binds.push(viewer.id, viewer.id); }
  const rows = await all(env,
    `SELECT c.id, c.author_id, c.kind, c.body, c.status_note, c.status_at FROM comments c
     WHERE c.post_id = ? AND c.removed_at IS NULL AND c.status = 'accepted'${blocked}
     ORDER BY c.status_at, c.id LIMIT 200`, ...binds);
  const users = await usersById(env, rows.map((r) => r.author_id));
  return {
    items: rows.map((r) => ({
      comment_id: r.id, user: users[r.author_id] || null, kind: r.kind, excerpt: str(r.body, 280), note: r.status_note, accepted_at: r.status_at,
    })).filter((r) => r.user),
    next: null,
  };
}

/** A member's credited contributions, as public evidence (private work is counted, not named). */
async function userContributions(ctx) {
  const { env } = ctx;
  const viewer = await currentUser(ctx);
  const target = await userByHandle(env, ctx.params.handle);
  if (!target) fail(404, "No one has that handle.");
  if (viewer && await blockedBetween(env, viewer.id, target.id)) fail(404, "No one has that handle.");
  const rows = await all(env,
    `SELECT ct.*, p.title AS post_title, p.visibility AS post_visibility, r.title AS request_title, r.audience
     FROM contributions ct
     LEFT JOIN comments c ON ct.ref_type = 'comment' AND c.id = ct.ref_id
     LEFT JOIN collab_requests r ON ct.ref_type = 'request' AND r.id = ct.ref_id
     LEFT JOIN posts p ON p.id = ct.post_id
     WHERE ct.user_id = ? AND (
       (ct.ref_type = 'comment' AND c.id IS NOT NULL AND c.removed_at IS NULL AND c.status = 'accepted' AND p.removed_at IS NULL)
       OR (ct.ref_type = 'request' AND r.id IS NOT NULL))
     ORDER BY ct.created_at DESC LIMIT 100`, target.id);
  return {
    items: rows.map((r) => {
      const open = r.ref_type === "comment" ? r.post_visibility === "public" : r.audience === "everyone";
      return {
        kind: r.kind,
        ref_type: r.ref_type,
        ref_id: open ? (r.ref_type === "comment" ? r.post_id : r.ref_id) : null,
        title: open ? ((r.ref_type === "comment" ? r.post_title : r.request_title) || "Untitled") : "A contribution to work shared privately",
        note: open ? r.note : "",
        created_at: r.created_at,
      };
    }),
    next: null,
  };
}

export const routes = [
  ["POST", "/v1/requests", create],
  ["GET", "/v1/requests", list],
  ["GET", "/v1/requests/:id", get],
  ["PATCH", "/v1/requests/:id", patch],
  ["POST", "/v1/requests/:id/respond", respond],
  ["POST", "/v1/requests/:id/choose", choose],
  ["POST", "/v1/requests/:id/invite", invite],
  ["POST", "/v1/requests/:id/messages", message],
  ["POST", "/v1/requests/:id/acknowledge", acknowledge],
  ["POST", "/v1/comments/:id/status", decide],
  ["GET", "/v1/posts/:id/contributions", postContributions],
  ["GET", "/v1/users/:handle/contributions", userContributions],
];
