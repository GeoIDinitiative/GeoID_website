/**
 * Projects: the shareable scientific object. Its workspace is the GeoHUB
 * project manifest (layers by reference, camera, AOI, parameters), versioned,
 * and shared through grants: a professor gives a student, a team or a
 * reviewer a role on it.
 *
 * WHO MAY DO WHAT is decided in ONE place, projectRole(), and every route
 * (and teams.js, reviews.js, reputation.js) asks it, so a grant, an expiry or
 * a team removal reads the same everywhere.
 */
import {
  fail, now, id, str, oneOf, int, tags, parse, snapLocation, requireUser, currentUser,
  rateLimit, notify, audit, usersById, userByHandle, blockedBetween, publicPost,
  VISIBLE_POSTS, visibleBinds, teamRole,
} from "./lib.js";
import { body, all, one, run, param, cursorClause, paged, limitOf } from "./collab.js";

export const ROLE_RANK = { public: 0, viewer: 1, commenter: 2, forker: 3, editor: 4, owner: 5 };
export const atLeast = (role, min) => role != null && ROLE_RANK[role] >= ROLE_RANK[min];
const GRANTABLE = ["viewer", "commenter", "forker", "editor"];
// A project that belongs to a team is the team's working space, so its active
// members get a role from their team role without a grant row each.
const TEAM_ROLE = { lead: "editor", editor: "editor", member: "commenter", viewer: "viewer" };
const STAGES = ["idea", "analysis", "workspace", "twin"];
const VISIBILITIES = ["public", "unlisted", "team", "private"];
export const MAX_MANIFEST_BYTES = 48 * 1024;

/**
 * The caller's role on a project, or null (= 404).
 *
 * owner > the best of: non-expired user grant, non-expired grant to a team the
 * caller is an ACTIVE member of, the caller's team role on a team project >
 * "public" (read-only) for public/unlisted projects. Grants are looked up live
 * on every call, so an expiry or a removal from a team takes effect at once.
 */
export async function projectRole(env, user, project) {
  if (!project || project.removed_at) return null;
  if (user && project.owner_id === user.id) return "owner";
  let best = null;
  const offer = (role) => {
    if (role && ROLE_RANK[role] != null && role !== "owner" && (best == null || ROLE_RANK[role] > ROLE_RANK[best])) best = role;
  };
  if (user) {
    const grants = await all(env,
      `SELECT role FROM grants WHERE project_id = ? AND (expires_at IS NULL OR expires_at > ?) AND (
         (grantee_type = 'user' AND grantee_id = ?)
         OR (grantee_type = 'team' AND grantee_id IN
             (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active')))`,
      project.id, now(), user.id, user.id);
    for (const g of grants) if (GRANTABLE.includes(g.role)) offer(g.role);
    if (project.team_id) offer(TEAM_ROLE[await teamRole(env, project.team_id, user.id)]);
  }
  if (best) return best;
  if (project.visibility === "public" || project.visibility === "unlisted") {
    if (user && await blockedBetween(env, user.id, project.owner_id)) return null;
    return "public";
  }
  return null;
}

export async function loadProject(env, projectId) {
  return one(env, "SELECT * FROM projects WHERE id = ? AND removed_at IS NULL", str(projectId, 60));
}

/** The project and the caller's role, or a 404 that does not say whether it exists. */
async function visible(ctx, user) {
  const project = await loadProject(ctx.env, ctx.params.id);
  const role = await projectRole(ctx.env, user, project);
  if (!role) fail(404, "No such project.");
  return { project, role };
}

// ── Shapes ─────────────────────────────────────────────────────────────────

async function teamsById(env, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await all(env, `SELECT id, slug, name FROM teams WHERE id IN (${unique.map(() => "?").join(",")})`, ...unique);
  return Object.fromEntries(rows.map((t) => [t.id, { slug: t.slug, name: t.name }]));
}

function projectShape(row, owners, teams) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    stage: row.stage,
    world: row.world,
    location: row.lat == null ? null : { lat: row.lat, lon: row.lon, precision: row.loc_precision },
    tags: parse(row.tags_json, []),
    licence: row.licence,
    visibility: row.visibility,
    allow_fork: !!row.allow_fork,
    forked_from: row.forked_from,
    needs_skills: parse(row.needs_skills_json, []),
    current_version: row.current_version,
    owner: owners[row.owner_id] || null,
    team: teams[row.team_id] || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function projectShapes(env, rows) {
  const owners = await usersById(env, rows.map((r) => r.owner_id));
  const teams = await teamsById(env, rows.map((r) => r.team_id));
  return rows.map((r) => projectShape(r, owners, teams));
}

async function grantShapes(env, rows) {
  const users = await usersById(env, rows.filter((g) => g.grantee_type === "user").map((g) => g.grantee_id));
  const teams = await teamsById(env, rows.filter((g) => g.grantee_type === "team").map((g) => g.grantee_id));
  const t = now();
  return rows.map((g) => {
    const u = users[g.grantee_id];
    const tm = teams[g.grantee_id];
    return {
      id: g.id,
      grantee: g.grantee_type === "user"
        ? { type: "user", handle: u ? u.handle : null, name: u ? u.name : "" }
        : { type: "team", slug: tm ? tm.slug : null, name: tm ? tm.name : "" },
      role: g.role,
      expires_at: g.expires_at,
      expired: g.expires_at != null && g.expires_at <= t,
      created_at: g.created_at,
    };
  });
}

/**
 * A workspace manifest, checked: a JSON object of at most 48 KB. It is the
 * GeoHUB manifest BY REFERENCE -- layers point at their source -- so inline
 * base64 data is refused rather than quietly turning D1 into a file store.
 */
function manifestText(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    fail(400, "A workspace is a JSON object (the GeoHUB project manifest).");
  }
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > MAX_MANIFEST_BYTES) {
    fail(413, "A workspace manifest is at most 48 KB. Keep layers by reference, not inline.");
  }
  if (/"data:[a-z0-9.+/-]*;base64,/i.test(text)) {
    fail(400, "A workspace holds layers by reference. Upload data elsewhere and link to it.");
  }
  return text;
}

async function detail(env, user, project, role) {
  const [shape] = await projectShapes(env, [project]);
  const versions = await all(env,
    "SELECT version, note, created_by, created_at FROM project_versions WHERE project_id = ? ORDER BY version DESC LIMIT 100",
    project.id);
  const by = await usersById(env, versions.map((v) => v.created_by));
  const out = {
    project: shape,
    access: { role },
    versions: versions.map((v) => ({ version: v.version, note: v.note, created_at: v.created_at, by: by[v.created_by] || null })),
  };
  if (atLeast(role, "editor")) {
    out.grants = await grantShapes(env, await all(env,
      "SELECT * FROM grants WHERE project_id = ? ORDER BY created_at DESC", project.id));
  }
  const posts = await all(env,
    `SELECT p.* FROM posts p WHERE p.project_id = ? AND ${VISIBLE_POSTS} ORDER BY p.created_at DESC LIMIT 20`,
    project.id, ...visibleBinds(user));
  const authors = await usersById(env, posts.map((p) => p.author_id));
  out.posts = posts.map((p) => publicPost(env, p, authors));
  return out;
}

async function teamForWrite(env, user, slug) {
  const team = await one(env, "SELECT * FROM teams WHERE slug = ?", str(slug, 60).toLowerCase());
  const role = team && await teamRole(env, team.id, user.id);
  if (!role) fail(404, "No such team.");
  if (role === "viewer") fail(403, "Team viewers can't add projects to the team.");
  return team;
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function create(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const title = str(b.title, 200);
  if (!title) fail(400, "A project needs a title.");
  const team = b.team_slug ? await teamForWrite(env, user, b.team_slug) : null;
  const visibility = oneOf(b.visibility, VISIBILITIES, "private");
  if (visibility === "team" && !team) fail(400, "A team project needs a team_slug.");
  const loc = b.location && typeof b.location === "object"
    ? snapLocation(b.location.lat, b.location.lon, b.location.precision)
    : { lat: null, lon: null, loc_precision: "approx" };
  const manifest = manifestText(b.workspace);
  const t = now();
  const row = {
    id: id("pr"), owner_id: user.id, team_id: team ? team.id : null, title,
    summary: str(b.summary, 4000), stage: oneOf(b.stage, STAGES, "idea"), world: str(b.world, 40) || "earth",
    lat: loc.lat, lon: loc.lon, loc_precision: loc.loc_precision, tags_json: JSON.stringify(tags(b.tags)),
    licence: str(b.licence, 60) || "CC-BY-4.0", visibility, allow_fork: b.allow_fork ? 1 : 0,
    needs_skills_json: JSON.stringify(tags(b.needs_skills)), current_version: manifest ? 1 : 0,
  };
  const statements = [env.DB.prepare(
    `INSERT INTO projects (id, owner_id, team_id, title, summary, stage, world, lat, lon, loc_precision, tags_json,
       licence, visibility, allow_fork, needs_skills_json, current_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.owner_id, row.team_id, row.title, row.summary, row.stage, row.world, row.lat, row.lon,
    row.loc_precision, row.tags_json, row.licence, row.visibility, row.allow_fork, row.needs_skills_json,
    row.current_version, t, t)];
  if (manifest) {
    statements.push(env.DB.prepare(
      "INSERT INTO project_versions (project_id, version, manifest_json, note, created_by, created_at) VALUES (?, 1, ?, ?, ?, ?)",
    ).bind(row.id, manifest, str(b.note, 500) || "First version", user.id, t));
  }
  await env.DB.batch(statements);
  return detail(env, user, await loadProject(env, row.id), "owner");
}

async function list(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const limit = limitOf(ctx);
  const cur = cursorClause(ctx, "p.created_at", "p.id");
  let rows;
  if (param(ctx, "mine") === "1") {
    if (!user) fail(401, "Sign in to see your projects.");
    rows = await all(env,
      `SELECT p.* FROM projects p WHERE p.owner_id = ? AND p.removed_at IS NULL${cur.sql}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?`, user.id, ...cur.binds, limit + 1);
  } else if (param(ctx, "shared") === "1") {
    if (!user) fail(401, "Sign in to see what is shared with you.");
    rows = await all(env,
      `SELECT p.* FROM projects p WHERE p.removed_at IS NULL AND p.owner_id != ? AND (
         p.id IN (SELECT project_id FROM grants WHERE (expires_at IS NULL OR expires_at > ?) AND (
           (grantee_type = 'user' AND grantee_id = ?)
           OR (grantee_type = 'team' AND grantee_id IN (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active'))))
         OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active'))${cur.sql}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
      user.id, now(), user.id, user.id, user.id, ...cur.binds, limit + 1);
  } else {
    const where = ["p.visibility = 'public'", "p.removed_at IS NULL"];
    const binds = [];
    const text = str(param(ctx, "q"), 100);
    if (text) {
      where.push("(p.title LIKE ? OR p.summary LIKE ?)");
      binds.push(`%${text}%`, `%${text}%`);
    }
    const tag = tags([param(ctx, "tag")])[0];
    if (tag) {
      where.push("p.tags_json LIKE ?");
      binds.push(`%"${tag}"%`);
    }
    if (user) {
      where.push("p.owner_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?) AND p.owner_id NOT IN (SELECT user_id FROM blocks WHERE blocked_id = ?)");
      binds.push(user.id, user.id);
    }
    rows = await all(env,
      `SELECT p.* FROM projects p WHERE ${where.join(" AND ")}${cur.sql} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
      ...binds, ...cur.binds, limit + 1);
  }
  const page = paged(rows, limit);
  return { items: await projectShapes(env, page.items), next: page.next };
}

async function get(ctx) {
  const user = await currentUser(ctx);
  const { project, role } = await visible(ctx, user);
  return detail(ctx.env, user, project, role);
}

async function patch(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { project, role } = await visible(ctx, user);
  if (!atLeast(role, "editor")) fail(403, "Only the owner or an editor can change this project.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const sets = [];
  const binds = [];
  const set = (col, value) => { sets.push(`${col} = ?`); binds.push(value); };
  if (b.title !== undefined) {
    const title = str(b.title, 200);
    if (!title) fail(400, "A project needs a title.");
    set("title", title);
  }
  if (b.summary !== undefined) set("summary", str(b.summary, 4000));
  if (b.stage !== undefined) set("stage", oneOf(b.stage, STAGES, project.stage));
  if (b.world !== undefined) set("world", str(b.world, 40) || "earth");
  if (b.tags !== undefined) set("tags_json", JSON.stringify(tags(b.tags)));
  if (b.needs_skills !== undefined) set("needs_skills_json", JSON.stringify(tags(b.needs_skills)));
  if (b.licence !== undefined) set("licence", str(b.licence, 60) || "CC-BY-4.0");
  if (b.location !== undefined) {
    const loc = b.location ? snapLocation(b.location.lat, b.location.lon, b.location.precision)
      : { lat: null, lon: null, loc_precision: "hidden" };
    set("lat", loc.lat); set("lon", loc.lon); set("loc_precision", loc.loc_precision);
  }
  // Who can see and copy the project is a sharing decision, so it stays the owner's.
  const ownerOnly = ["visibility", "allow_fork", "team_slug"].filter((k) => b[k] !== undefined);
  if (ownerOnly.length && role !== "owner") fail(403, "Only the owner can change who can see or fork this project.");
  if (b.team_slug !== undefined) set("team_id", b.team_slug ? (await teamForWrite(env, user, b.team_slug)).id : null);
  if (b.visibility !== undefined) set("visibility", oneOf(b.visibility, VISIBILITIES, project.visibility));
  if (b.allow_fork !== undefined) set("allow_fork", b.allow_fork ? 1 : 0);
  if (sets.length) {
    set("updated_at", now());
    await run(env, `UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, ...binds, project.id);
  }
  // "team" visibility without a team would be visible to nobody but the owner
  // and look shared; say what it is.
  await run(env, "UPDATE projects SET visibility = 'private' WHERE id = ? AND visibility = 'team' AND team_id IS NULL", project.id);
  return detail(env, user, await loadProject(env, project.id), role);
}

async function remove(ctx) {
  const user = await requireUser(ctx);
  const { project, role } = await visible(ctx, user);
  if (role !== "owner") fail(403, "Only the owner can delete this project.");
  await rateLimit(ctx, user);
  await run(ctx.env, "UPDATE projects SET removed_at = ? WHERE id = ?", now(), project.id);
  await audit(ctx.env, user.id, "project.delete", "project", project.id, {});
  return { ok: true };
}

async function workspace(ctx) {
  const user = await currentUser(ctx);
  const { project } = await visible(ctx, user);
  const asked = param(ctx, "version");
  const version = int(asked, project.current_version);
  const row = await one(ctx.env,
    "SELECT version, manifest_json, note, created_at FROM project_versions WHERE project_id = ? AND version = ?",
    project.id, version);
  if (!row) {
    if (!asked && project.current_version === 0) return { version: 0, manifest: null };
    fail(404, "No such version.");
  }
  return { version: row.version, manifest: parse(row.manifest_json, null), note: row.note, created_at: row.created_at };
}

async function addVersion(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { project, role } = await visible(ctx, user);
  if (!atLeast(role, "editor")) fail(403, "Only the owner or an editor can save a new version.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const manifest = manifestText(b.manifest);
  if (!manifest) fail(400, "Send the workspace manifest.");
  const version = project.current_version + 1;
  const t = now();
  const note = str(b.note, 500);
  // The version is the primary key, so of two saves at once the second fails
  // instead of overwriting; it answers 409 and the page reloads and retries.
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO project_versions (project_id, version, manifest_json, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(project.id, version, manifest, note, user.id, t),
      env.DB.prepare("UPDATE projects SET current_version = ?, updated_at = ? WHERE id = ?").bind(version, t, project.id),
    ]);
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error && error.message))) fail(409, "Somebody saved a version at the same moment. Reload and try again.");
    throw error;
  }
  const followers = await all(env,
    "SELECT follower_id FROM follows WHERE target_type = 'project' AND target_id = ?", project.id);
  for (const f of followers) {
    // Following does not grant access: a follower who has lost access hears nothing.
    if (await projectRole(env, { id: f.follower_id }, project)) {
      await notify(env, f.follower_id, "project_update", user.id, "project", project.id,
        `New version ${version} of ${project.title}`);
    }
  }
  return { version, note, created_at: t };
}

async function addGrant(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { project, role } = await visible(ctx, user);
  if (!atLeast(role, "editor")) fail(403, "Only the owner or an editor can share this project.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const grantRole = oneOf(b.role, GRANTABLE, null);
  if (!grantRole) fail(400, "role must be viewer, commenter, forker or editor.");
  // An editor may bring in readers and commenters; handing out forking or
  // editing rights is the owner's call.
  if (role !== "owner" && ROLE_RANK[grantRole] > ROLE_RANK.commenter) {
    fail(403, "Editors can grant at most commenter.");
  }
  let expires = null;
  if (b.expires_at != null && b.expires_at !== "") {
    expires = int(b.expires_at, null);
    if (expires == null || expires <= now()) fail(400, "expires_at must be a time in the future (epoch seconds).");
  }
  let granteeType;
  let granteeId;
  let notifyIds;
  if (b.handle) {
    const target = await userByHandle(env, b.handle);
    if (!target) fail(404, "No one has that handle.");
    if (target.id === project.owner_id) fail(400, "The owner already has full access.");
    if (await blockedBetween(env, user.id, target.id)) fail(403, "You can't share with this person.");
    granteeType = "user";
    granteeId = target.id;
    notifyIds = [target.id];
  } else if (b.team_slug) {
    const team = await one(env, "SELECT * FROM teams WHERE slug = ?", str(b.team_slug, 60).toLowerCase());
    // A private team is invisible to outsiders, so it is "no such team" to them too.
    if (!team || (team.visibility !== "public" && !(await teamRole(env, team.id, user.id)))) fail(404, "No such team.");
    granteeType = "team";
    granteeId = team.id;
    notifyIds = (await all(env, "SELECT user_id FROM team_members WHERE team_id = ? AND status = 'active'", team.id))
      .map((r) => r.user_id);
  } else {
    fail(400, "Share with a handle or a team_slug.");
  }
  const existing = await one(env,
    "SELECT * FROM grants WHERE project_id = ? AND grantee_type = ? AND grantee_id = ?", project.id, granteeType, granteeId);
  if (existing && role !== "owner" && ROLE_RANK[existing.role] > ROLE_RANK.commenter) {
    fail(403, "Only the owner can change that grant.");
  }
  const t = now();
  let grantId;
  if (existing) {
    grantId = existing.id;
    await run(env, "UPDATE grants SET role = ?, expires_at = ?, granted_by = ?, created_at = ? WHERE id = ?",
      grantRole, expires, user.id, t, existing.id);
  } else {
    grantId = id("g");
    await run(env,
      "INSERT INTO grants (id, project_id, grantee_type, grantee_id, role, granted_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      grantId, project.id, granteeType, granteeId, grantRole, user.id, expires, t);
  }
  await audit(env, user.id, existing ? "grant.update" : "grant.create", "project", project.id,
    { grant: grantId, grantee_type: granteeType, grantee_id: granteeId, role: grantRole, expires_at: expires,
      previous: existing ? existing.role : null });
  for (const uid of notifyIds) {
    await notify(env, uid, "grant", user.id, "project", project.id, `You were given ${grantRole} access to ${project.title}`);
  }
  const [shape] = await grantShapes(env, [await one(env, "SELECT * FROM grants WHERE id = ?", grantId)]);
  return shape;
}

async function removeGrant(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { project, role } = await visible(ctx, user);
  if (role !== "owner") fail(403, "Only the owner can revoke access.");
  await rateLimit(ctx, user);
  const grant = await one(env, "SELECT * FROM grants WHERE id = ? AND project_id = ?", str(ctx.params.grant_id, 60), project.id);
  if (!grant) fail(404, "No such grant.");
  await run(env, "DELETE FROM grants WHERE id = ?", grant.id);
  await audit(env, user.id, "grant.revoke", "project", project.id,
    { grant: grant.id, grantee_type: grant.grantee_type, grantee_id: grant.grantee_id, role: grant.role });
  const ids = grant.grantee_type === "user" ? [grant.grantee_id]
    : (await all(env, "SELECT user_id FROM team_members WHERE team_id = ? AND status = 'active'", grant.grantee_id)).map((r) => r.user_id);
  for (const uid of ids) {
    await notify(env, uid, "grant", user.id, "project", project.id, `Your access to ${project.title} was removed`);
  }
  return { ok: true };
}

async function fork(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { project, role } = await visible(ctx, user);
  if (!atLeast(role, "forker") && !project.allow_fork) fail(403, "This project can't be forked.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const latest = project.current_version
    ? await one(env, "SELECT manifest_json FROM project_versions WHERE project_id = ? AND version = ?", project.id, project.current_version)
    : null;
  const t = now();
  const newId = id("pr");
  // A fork starts private and unforkable: copying something does not decide
  // how widely the copy is shared.
  const statements = [env.DB.prepare(
    `INSERT INTO projects (id, owner_id, team_id, title, summary, stage, world, lat, lon, loc_precision, tags_json,
       licence, visibility, allow_fork, forked_from, needs_skills_json, current_version, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', 0, ?, ?, ?, ?, ?)`,
  ).bind(newId, user.id, str(b.title, 200) || `${project.title} (fork)`, project.summary, project.stage, project.world,
    project.lat, project.lon, project.loc_precision, project.tags_json, project.licence, project.id,
    project.needs_skills_json, latest ? 1 : 0, t, t)];
  if (latest) {
    statements.push(env.DB.prepare(
      "INSERT INTO project_versions (project_id, version, manifest_json, note, created_by, created_at) VALUES (?, 1, ?, ?, ?, ?)",
    ).bind(newId, latest.manifest_json, `Forked from ${project.id} v${project.current_version}`, user.id, t));
  }
  await env.DB.batch(statements);
  await notify(env, project.owner_id, "fork", user.id, "project", project.id, `Forked ${project.title}`);
  return detail(env, user, await loadProject(env, newId), "owner");
}

export const routes = [
  ["POST", "/v1/projects", create],
  ["GET", "/v1/projects", list],
  ["GET", "/v1/projects/:id", get],
  ["PATCH", "/v1/projects/:id", patch],
  ["DELETE", "/v1/projects/:id", remove],
  ["GET", "/v1/projects/:id/workspace", workspace],
  ["POST", "/v1/projects/:id/versions", addVersion],
  ["POST", "/v1/projects/:id/grants", addGrant],
  ["DELETE", "/v1/projects/:id/grants/:grant_id", removeGrant],
  ["POST", "/v1/projects/:id/fork", fork],
];
