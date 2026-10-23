/**
 * Research teams: a shared space with roles (lead | editor | member | viewer),
 * tasks, projects and a team conversation.
 *
 * The team conversation's members are DERIVED from the active team members:
 * every change to membership calls syncTeamConversation(), so a person removed
 * from the team stops reading its chat in the same request.
 */
import {
  fail, now, id, str, oneOf, int, requireUser, currentUser, rateLimit, notify, audit,
  publicUser, usersById, userByHandle, blockedBetween, isAdmin, teamRole,
} from "./lib.js";
import { body, all, one, run, param, slugify, SLUG_RE } from "./collab.js";
import { projectRole, projectShapes } from "./projects.js";

const ROLES = ["lead", "editor", "member", "viewer"];
const TASK_STATUS = ["todo", "doing", "done"];

export async function teamBySlug(env, slug) {
  return one(env, "SELECT * FROM teams WHERE slug = ?", str(slug, 60).toLowerCase());
}

async function membership(env, teamId, userId) {
  if (!userId) return null;
  return one(env, "SELECT * FROM team_members WHERE team_id = ? AND user_id = ?", teamId, userId);
}

/**
 * The team, or 404. A private team does not exist for anybody who is not an
 * active member or holding an invitation (they need to see what they are
 * invited to).
 */
async function visibleTeam(ctx, user) {
  const team = await teamBySlug(ctx.env, ctx.params.slug);
  if (!team) fail(404, "No such team.");
  const member = user ? await membership(ctx.env, team.id, user.id) : null;
  if (team.visibility !== "public" && !isAdmin(ctx.env, user)
      && !(member && (member.status === "active" || member.status === "invited"))) {
    fail(404, "No such team.");
  }
  return { team, member };
}

const activeRole = (member) => (member && member.status === "active" ? member.role : null);

async function leadCount(env, teamId) {
  return (await one(env,
    "SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role = 'lead' AND status = 'active'", teamId)).n;
}

/** Make the team conversation's members exactly the team's active members. */
export async function syncTeamConversation(env, team) {
  if (!team.conversation_id) return;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, status, last_read)
       SELECT ?, user_id, 'active', 0 FROM team_members WHERE team_id = ? AND status = 'active'
       ON CONFLICT(conversation_id, user_id) DO UPDATE SET status = 'active'`,
    ).bind(team.conversation_id, team.id),
    env.DB.prepare(
      `UPDATE conversation_members SET status = 'left' WHERE conversation_id = ? AND user_id NOT IN
         (SELECT user_id FROM team_members WHERE team_id = ? AND status = 'active')`,
    ).bind(team.conversation_id, team.id),
  ]);
}

async function notifyLeads(env, team, actorId, text) {
  const leads = await all(env, "SELECT user_id FROM team_members WHERE team_id = ? AND role = 'lead' AND status = 'active'", team.id);
  for (const l of leads) await notify(env, l.user_id, "invite", actorId, "team", team.slug, text);
}

function teamShape(row, extra = {}) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    member_count: row.member_count ?? undefined,
    created_at: row.created_at,
    ...extra,
  };
}

const COUNT = "(SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id AND m.status = 'active') AS member_count";

// ── Teams ──────────────────────────────────────────────────────────────────

async function list(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  if (param(ctx, "mine") === "1") {
    if (!user) fail(401, "Sign in to see your teams.");
    const rows = await all(env,
      `SELECT t.*, tm.role AS my_role, tm.status AS my_status, ${COUNT} FROM teams t
       JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
       ORDER BY t.name LIMIT 200`, user.id);
    return { items: rows.map((r) => teamShape(r, { role: r.my_role, status: r.my_status })), next: null };
  }
  const text = str(param(ctx, "q"), 100);
  const rows = text
    ? await all(env, `SELECT t.*, ${COUNT} FROM teams t WHERE t.visibility = 'public'
        AND (t.name LIKE ? OR t.slug LIKE ? OR t.description LIKE ?) ORDER BY t.name LIMIT 50`,
      `%${text}%`, `%${text}%`, `%${text}%`)
    : await all(env, `SELECT t.*, ${COUNT} FROM teams t WHERE t.visibility = 'public' ORDER BY t.created_at DESC LIMIT 50`);
  return { items: rows.map((r) => teamShape(r)), next: null };
}

async function create(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const name = str(b.name, 80);
  if (!name) fail(400, "A team needs a name.");
  const slug = b.slug ? str(b.slug, 40).toLowerCase() : slugify(name);
  if (!SLUG_RE.test(slug)) fail(400, "A team slug is 2-40 characters of a-z, 0-9 and dashes.");
  if (await teamBySlug(env, slug)) fail(409, "That team name is taken.");
  const t = now();
  const teamId = id("t");
  const convId = id("cv");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO teams (id, slug, name, description, visibility, conversation_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(teamId, slug, name, str(b.description, 2000), oneOf(b.visibility, ["public", "private"], "private"), convId, user.id, t),
    env.DB.prepare(
      "INSERT INTO team_members (team_id, user_id, role, status, created_at) VALUES (?, ?, 'lead', 'active', ?)",
    ).bind(teamId, user.id, t),
    env.DB.prepare(
      "INSERT INTO conversations (id, kind, title, team_id, created_by, last_at, created_at) VALUES (?, 'team', ?, ?, ?, ?, ?)",
    ).bind(convId, name, teamId, user.id, t, t),
    env.DB.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id, status, last_read) VALUES (?, ?, 'active', 0)",
    ).bind(convId, user.id),
  ]);
  ctx.params.slug = slug;
  return get(ctx);
}

async function get(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const { team, member } = await visibleTeam(ctx, user);
  const role = activeRole(member);
  // Outsiders see who is in a public team; pending invitations and requests
  // are the team's own business.
  const members = await all(env,
    `SELECT * FROM team_members WHERE team_id = ? ${role ? "" : "AND status = 'active'"}
     ORDER BY CASE role WHEN 'lead' THEN 0 WHEN 'editor' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, created_at`, team.id);
  const users = await usersById(env, members.map((m) => m.user_id));
  const projectRows = await all(env,
    "SELECT * FROM projects WHERE team_id = ? AND removed_at IS NULL ORDER BY updated_at DESC LIMIT 50", team.id);
  const seen = [];
  for (const p of projectRows) if (await projectRole(env, user, p)) seen.push(p);
  const tasks = role
    ? await taskShapes(env, team, await all(env,
      "SELECT * FROM tasks WHERE team_id = ? AND status != 'done' ORDER BY COALESCE(due_at, 9e18), created_at LIMIT 200", team.id))
    : [];
  return {
    team: teamShape(team, { member_count: members.filter((m) => m.status === "active").length }),
    viewer: member ? { role: member.role, status: member.status } : null,
    members: members.map((m) => ({ user: users[m.user_id] || null, role: m.role, status: m.status, since: m.created_at })),
    projects: await projectShapes(env, seen),
    tasks,
    conversation_id: role ? team.conversation_id : null,
  };
}

async function requireLead(ctx) {
  const user = await requireUser(ctx);
  const { team, member } = await visibleTeam(ctx, user);
  if (activeRole(member) !== "lead") fail(403, "Only a team lead can do that.");
  await rateLimit(ctx, user);
  return { user, team };
}

async function patch(ctx) {
  const { env } = ctx;
  const { team } = await requireLead(ctx);
  const b = await body(ctx);
  const name = b.name !== undefined ? str(b.name, 80) : team.name;
  if (!name) fail(400, "A team needs a name.");
  await run(env, "UPDATE teams SET name = ?, description = ?, visibility = ? WHERE id = ?",
    name, b.description !== undefined ? str(b.description, 2000) : team.description,
    oneOf(b.visibility, ["public", "private"], team.visibility), team.id);
  if (team.conversation_id) await run(env, "UPDATE conversations SET title = ? WHERE id = ?", name, team.conversation_id);
  return get(ctx);
}

async function invite(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { team, member } = await visibleTeam(ctx, user);
  const mine = activeRole(member);
  if (mine !== "lead" && mine !== "editor") fail(403, "Only a lead or an editor can invite people.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const role = oneOf(b.role, ROLES, "member");
  // Editors bring in members and viewers; making someone a lead or editor is a lead's call.
  if (mine === "editor" && (role === "lead" || role === "editor")) fail(403, "Editors can invite members and viewers only.");
  const target = await userByHandle(env, b.handle);
  if (!target) fail(404, "No one has that handle.");
  if (await blockedBetween(env, user.id, target.id)) fail(403, "You can't invite this person.");
  const existing = await membership(env, team.id, target.id);
  if (existing && existing.status === "active") fail(409, "They are already in the team.");
  if (existing && existing.status === "requested") {
    // They asked; an invitation from inside the team is the answer.
    await run(env, "UPDATE team_members SET status = 'active', role = ? WHERE team_id = ? AND user_id = ?", role, team.id, target.id);
    await syncTeamConversation(env, team);
    await notify(env, target.id, "invite", user.id, "team", team.slug, `You joined ${team.name}`);
  } else if (existing) {
    await run(env, "UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?", role, team.id, target.id);
    await notify(env, target.id, "invite", user.id, "team", team.slug, `Invited you to join ${team.name} as ${role}`);
  } else {
    await run(env, "INSERT INTO team_members (team_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'invited', ?)",
      team.id, target.id, role, now());
    await notify(env, target.id, "invite", user.id, "team", team.slug, `Invited you to join ${team.name} as ${role}`);
  }
  const row = await membership(env, team.id, target.id);
  return { user: publicUser(env, target), role: row.role, status: row.status };
}

async function respond(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { team, member } = await visibleTeam(ctx, user);
  if (!member || member.status !== "invited") fail(404, "You have no invitation to this team.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  if (b.accept) {
    await run(env, "UPDATE team_members SET status = 'active' WHERE team_id = ? AND user_id = ?", team.id, user.id);
    await notifyLeads(env, team, user.id, `Joined ${team.name}`);
  } else {
    await run(env, "DELETE FROM team_members WHERE team_id = ? AND user_id = ?", team.id, user.id);
  }
  await syncTeamConversation(env, team);
  return { status: b.accept ? "active" : "declined" };
}

async function request(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { team, member } = await visibleTeam(ctx, user);
  if (team.visibility !== "public") fail(404, "No such team.");
  if (member) fail(409, member.status === "invited" ? "You are already invited: accept the invitation." : "You are already in this team or have asked to join.");
  await rateLimit(ctx, user);
  await run(env, "INSERT INTO team_members (team_id, user_id, role, status, created_at) VALUES (?, ?, 'member', 'requested', ?)",
    team.id, user.id, now());
  await notifyLeads(env, team, user.id, `Asked to join ${team.name}`);
  return { status: "requested" };
}

async function setMember(ctx) {
  const { env } = ctx;
  const { user, team } = await requireLead(ctx);
  const b = await body(ctx);
  const target = await userByHandle(env, ctx.params.handle);
  const row = target ? await membership(env, team.id, target.id) : null;
  if (!row) fail(404, "They aren't in this team.");
  let status = row.status;
  if (b.status !== undefined) {
    if (b.status !== "active") fail(400, "status can only be set to active (approve a request). To remove someone, DELETE them.");
    if (row.status === "invited") fail(409, "They have to accept the invitation themselves.");
    status = "active";
  }
  const role = b.role !== undefined ? oneOf(b.role, ROLES, null) : row.role;
  if (!role) fail(400, "role must be lead, editor, member or viewer.");
  if (row.status === "active" && row.role === "lead" && role !== "lead" && await leadCount(env, team.id) <= 1) {
    fail(409, "A team needs at least one lead. Make someone else a lead first.");
  }
  await run(env, "UPDATE team_members SET role = ?, status = ? WHERE team_id = ? AND user_id = ?", role, status, team.id, target.id);
  await syncTeamConversation(env, team);
  if (status !== row.status) await notify(env, target.id, "invite", user.id, "team", team.slug, `You joined ${team.name}`);
  else if (role !== row.role) await notify(env, target.id, "invite", user.id, "team", team.slug, `You are now ${role} in ${team.name}`);
  if (role !== row.role) await audit(env, user.id, "team.role", "team", team.id, { user: target.id, from: row.role, to: role });
  return { user: publicUser(env, target), role, status };
}

async function removeMember(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { team, member } = await visibleTeam(ctx, user);
  const target = await userByHandle(env, ctx.params.handle);
  const self = target && target.id === user.id;
  // Anybody may leave; only a lead may remove somebody else.
  if (!self && activeRole(member) !== "lead") fail(403, "Only a team lead can remove members.");
  const row = target ? await membership(env, team.id, target.id) : null;
  if (!row) fail(404, "They aren't in this team.");
  if (row.status === "active" && row.role === "lead" && await leadCount(env, team.id) <= 1) {
    fail(409, "A team needs at least one lead. Make someone else a lead first.");
  }
  await rateLimit(ctx, user);
  await run(env, "DELETE FROM team_members WHERE team_id = ? AND user_id = ?", team.id, target.id);
  await syncTeamConversation(env, team);
  if (!self) {
    await audit(env, user.id, "team.remove", "team", team.id, { user: target.id, role: row.role, status: row.status });
    await notify(env, target.id, "invite", user.id, "team", team.slug, `You were removed from ${team.name}`);
  }
  return { ok: true };
}

// ── Tasks ──────────────────────────────────────────────────────────────────

async function taskShapes(env, team, rows) {
  const users = await usersById(env, rows.flatMap((r) => [r.assignee_id, r.created_by]));
  return rows.map((r) => ({
    id: r.id,
    team: team.slug,
    project_id: r.project_id,
    title: r.title,
    detail: r.detail,
    status: r.status,
    assignee: users[r.assignee_id] || null,
    due_at: r.due_at,
    created_by: users[r.created_by] || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/** An assignee handle -> an active member id, or null for "", or a 400. */
async function assigneeId(env, team, handle) {
  if (!handle) return null;
  const target = await userByHandle(env, handle);
  if (!target || !(await teamRole(env, team.id, target.id))) fail(400, "Tasks can only be assigned to team members.");
  return target.id;
}

async function taskProject(env, team, projectId) {
  if (!projectId) return null;
  const p = await one(env, "SELECT id FROM projects WHERE id = ? AND team_id = ? AND removed_at IS NULL", str(projectId, 60), team.id);
  if (!p) fail(400, "That project isn't one of the team's.");
  return p.id;
}

async function listTasks(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { team, member } = await visibleTeam(ctx, user);
  if (!activeRole(member)) fail(403, "Only team members can see its tasks.");
  const status = oneOf(param(ctx, "status"), TASK_STATUS, null);
  const rows = status
    ? await all(env, "SELECT * FROM tasks WHERE team_id = ? AND status = ? ORDER BY COALESCE(due_at, 9e18), created_at LIMIT 500", team.id, status)
    : await all(env, "SELECT * FROM tasks WHERE team_id = ? ORDER BY status = 'done', COALESCE(due_at, 9e18), created_at LIMIT 500", team.id);
  return { items: await taskShapes(env, team, rows), next: null };
}

async function createTask(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { team, member } = await visibleTeam(ctx, user);
  const role = activeRole(member);
  if (!role) fail(403, "Only team members can add tasks.");
  if (role === "viewer") fail(403, "Viewers can read tasks but not change them.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const title = str(b.title, 200);
  if (!title) fail(400, "A task needs a title.");
  const t = now();
  const taskId = id("tk");
  const assignee = await assigneeId(env, team, b.assignee);
  await run(env,
    `INSERT INTO tasks (id, team_id, project_id, title, detail, status, assignee_id, due_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    taskId, team.id, await taskProject(env, team, b.project_id), title, str(b.detail, 4000),
    oneOf(b.status, TASK_STATUS, "todo"), assignee, int(b.due_at, null), user.id, t, t);
  const [shape] = await taskShapes(env, team, [await one(env, "SELECT * FROM tasks WHERE id = ?", taskId)]);
  return shape;
}

async function editableTask(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const task = await one(env, "SELECT * FROM tasks WHERE id = ?", str(ctx.params.id, 60));
  const team = task && await one(env, "SELECT * FROM teams WHERE id = ?", task.team_id);
  const role = team && await teamRole(env, team.id, user.id);
  if (!role) fail(404, "No such task.");
  if (role === "viewer") fail(403, "Viewers can read tasks but not change them.");
  await rateLimit(ctx, user);
  return { user, task, team };
}

async function patchTask(ctx) {
  const { env } = ctx;
  const { task, team } = await editableTask(ctx);
  const b = await body(ctx);
  const title = b.title !== undefined ? str(b.title, 200) : task.title;
  if (!title) fail(400, "A task needs a title.");
  await run(env,
    "UPDATE tasks SET title = ?, detail = ?, status = ?, assignee_id = ?, due_at = ?, project_id = ?, updated_at = ? WHERE id = ?",
    title,
    b.detail !== undefined ? str(b.detail, 4000) : task.detail,
    b.status !== undefined ? oneOf(b.status, TASK_STATUS, task.status) : task.status,
    b.assignee !== undefined ? await assigneeId(env, team, b.assignee) : task.assignee_id,
    b.due_at !== undefined ? int(b.due_at, null) : task.due_at,
    b.project_id !== undefined ? await taskProject(env, team, b.project_id) : task.project_id,
    now(), task.id);
  const [shape] = await taskShapes(env, team, [await one(env, "SELECT * FROM tasks WHERE id = ?", task.id)]);
  return shape;
}

async function deleteTask(ctx) {
  const { task } = await editableTask(ctx);
  await run(ctx.env, "DELETE FROM tasks WHERE id = ?", task.id);
  return { ok: true };
}

export const routes = [
  ["GET", "/v1/teams", list],
  ["POST", "/v1/teams", create],
  ["GET", "/v1/teams/:slug", get],
  ["PATCH", "/v1/teams/:slug", patch],
  ["POST", "/v1/teams/:slug/invite", invite],
  ["POST", "/v1/teams/:slug/respond", respond],
  ["POST", "/v1/teams/:slug/request", request],
  ["POST", "/v1/teams/:slug/members/:handle", setMember],
  ["DELETE", "/v1/teams/:slug/members/:handle", removeMember],
  ["GET", "/v1/teams/:slug/tasks", listTasks],
  ["POST", "/v1/teams/:slug/tasks", createTask],
  ["PATCH", "/v1/tasks/:id", patchTask],
  ["DELETE", "/v1/tasks/:id", deleteTask],
];
