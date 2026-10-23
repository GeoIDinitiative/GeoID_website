/**
 * Reports, appeals and what moderators do about them.
 *
 * Admins (lib isAdmin) see and act on everything. A community's owner and
 * moderators see and act on reports about POSTS IN THEIR COMMUNITY only, and
 * cannot suspend accounts, which is sitewide. Every action, and every read of
 * the report queue (which shows removed and private content), is audited.
 *
 * Nothing is deleted: remove sets removed_at, restore clears it, so a wrong
 * call can be undone and the record of it stays.
 */
import {
  fail, now, id, str, oneOf, int, requireUser, rateLimit, notify, audit, isAdmin, usersById, userByHandle,
  publicUser, publicPost, canSeePost, parse,
} from "./lib.js";
import { body, all, one, run, param, cursorClause, paged, limitOf } from "./collab.js";
import { loadReview, reviewRole } from "./reviews.js";
import { BADGES } from "./reputation.js";

const TARGETS = ["post", "comment", "user", "message", "community", "review", "badge"];
const REASONS = ["spam", "harassment", "misinformation", "privacy", "copyright", "unsafe-location", "other"];
const ACTIONS = ["dismiss", "remove", "restore", "warn", "suspend"];

/** Community ids the user moderates (active owner/moderator). */
async function moderated(env, user) {
  return (await all(env,
    "SELECT community_id FROM community_members WHERE user_id = ? AND status = 'active' AND role IN ('owner', 'moderator')", user.id))
    .map((r) => r.community_id);
}

/** May `user` act on `report`? Admins: all. Community mods: posts in their communities. */
async function mayHandle(env, user, report, mine) {
  if (isAdmin(env, user)) return true;
  if (report.target_type !== "post") return false;
  const post = await one(env, "SELECT community_id FROM posts WHERE id = ?", report.target_id);
  return !!(post && post.community_id && mine.includes(post.community_id));
}

/** The reported thing, removed or not, and who is responsible for it. */
async function targetOf(env, type, targetId) {
  switch (type) {
    case "post": {
      const row = await one(env, "SELECT * FROM posts WHERE id = ?", targetId);
      if (!row) return null;
      const authors = await usersById(env, [row.author_id]);
      return { owner: row.author_id, removed_at: row.removed_at, content: { ...publicPost(env, row, authors), removed_at: row.removed_at } };
    }
    case "comment": {
      const row = await one(env, "SELECT * FROM comments WHERE id = ?", targetId);
      if (!row) return null;
      const users = await usersById(env, [row.author_id]);
      return { owner: row.author_id, removed_at: row.removed_at, post_id: row.post_id,
        content: { id: row.id, post_id: row.post_id, author: users[row.author_id] || null, body: row.body, created_at: row.created_at, removed_at: row.removed_at } };
    }
    case "message": {
      const row = await one(env, "SELECT * FROM messages WHERE id = ?", targetId);
      if (!row) return null;
      const users = await usersById(env, [row.sender_id]);
      return { owner: row.sender_id, removed_at: row.removed_at,
        content: { id: row.id, conversation_id: row.conversation_id, sender: users[row.sender_id] || null, body: row.body, created_at: row.created_at, removed_at: row.removed_at } };
    }
    case "user": {
      const row = await one(env, "SELECT * FROM users WHERE id = ?", targetId);
      if (!row) return null;
      return { owner: row.id, content: { ...publicUser(env, row), bio: row.bio, suspended_until: row.suspended_until } };
    }
    case "review": {
      const row = await loadReview(env, targetId);
      if (!row) return null;
      return { owner: row.requester_id, content: { id: row.id, title: row.title, abstract: row.abstract, status: row.status } };
    }
    case "community": {
      const row = await one(env, "SELECT * FROM communities WHERE id = ?", targetId);
      if (!row) return null;
      return { owner: row.created_by, content: { slug: row.slug, name: row.name, description: row.description } };
    }
    case "badge": {
      const badge = BADGES.find((b) => b.id === targetId);
      return badge ? { owner: null, content: badge } : null;
    }
    default:
      return null;
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function report(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const type = oneOf(b.target_type, TARGETS, null);
  if (!type) fail(400, `target_type must be one of ${TARGETS.join(", ")}.`);
  const kind = oneOf(b.kind, ["report", "appeal"], "report");
  let targetId = str(b.target_id, 120);
  if (!targetId) fail(400, "Say what you are reporting (target_id).");
  // Resolve the target, and refuse (as not found) anything the reporter cannot
  // see: a report must not become a way to probe for private content.
  const missing = () => fail(404, "Nothing to report there.");
  if (type === "post") {
    const post = await one(env, "SELECT * FROM posts WHERE id = ?", targetId);
    // An author appealing a removal can still name their own removed post.
    if (!post || !(await canSeePost(env, user, post) || (kind === "appeal" && post.author_id === user.id))) missing();
  } else if (type === "comment") {
    const c = await one(env, "SELECT * FROM comments WHERE id = ?", targetId);
    const post = c && await one(env, "SELECT * FROM posts WHERE id = ?", c.post_id);
    if (!c || !(await canSeePost(env, user, post) || (kind === "appeal" && c.author_id === user.id))) missing();
  } else if (type === "message") {
    const m = await one(env, "SELECT * FROM messages WHERE id = ?", targetId);
    const member = m && await one(env, "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?", m.conversation_id, user.id);
    if (!member) missing();
  } else if (type === "user") {
    const target = (await userByHandle(env, targetId)) || (await one(env, "SELECT * FROM users WHERE id = ?", targetId));
    if (!target) missing();
    targetId = target.id;
  } else if (type === "review") {
    if (!(await reviewRole(env, user, await loadReview(env, targetId)))) missing();
  } else if (type === "community") {
    const c = await one(env, "SELECT * FROM communities WHERE slug = ? OR id = ?", targetId.toLowerCase(), targetId);
    if (!c) missing();
    if (c.visibility === "private" && !(await one(env,
      "SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ? AND status IN ('active', 'invited')", c.id, user.id))) missing();
    targetId = c.id;
  } else if (type === "badge") {
    if (!BADGES.some((x) => x.id === targetId)) missing();
  }
  const open = await one(env,
    "SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'", user.id, type, targetId);
  if (open) fail(409, "You have already reported this. A moderator will look at it.");
  const reportId = id("rp");
  await run(env,
    "INSERT INTO reports (id, reporter_id, kind, target_type, target_id, reason, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)",
    reportId, user.id, kind, type, targetId, oneOf(b.reason, REASONS, "other"), str(b.note, 2000), now());
  return { id: reportId, status: "open" };
}

async function queue(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const admin = isAdmin(env, user);
  const mine = admin ? [] : await moderated(env, user);
  if (!admin && !mine.length) fail(403, "Only moderators can see reports.");
  const status = oneOf(param(ctx, "status"), ["open", "actioned", "dismissed"], "open");
  const limit = limitOf(ctx);
  const cur = cursorClause(ctx, "r.created_at", "r.id");
  const rows = admin
    ? await all(env, `SELECT r.* FROM reports r WHERE r.status = ?${cur.sql} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
      status, ...cur.binds, limit + 1)
    : await all(env,
      `SELECT r.* FROM reports r JOIN posts p ON r.target_type = 'post' AND p.id = r.target_id
       WHERE r.status = ? AND p.community_id IN (${mine.map(() => "?").join(",")})${cur.sql}
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, status, ...mine, ...cur.binds, limit + 1);
  const page = paged(rows, limit);
  const people = await usersById(env, page.items.flatMap((r) => [r.reporter_id, r.handled_by]));
  const items = [];
  for (const r of page.items) {
    const target = await targetOf(env, r.target_type, r.target_id);
    items.push({
      id: r.id, kind: r.kind, target_type: r.target_type, target_id: r.target_id, reason: r.reason, note: r.note,
      status: r.status, resolution: r.resolution, reporter: people[r.reporter_id] || null,
      handled_by: people[r.handled_by] || null, created_at: r.created_at, handled_at: r.handled_at,
      target: target ? target.content : null,
    });
  }
  if (items.length) await audit(env, user.id, "mod.read", "reports", status, { reports: items.map((i) => i.id) });
  return { items, next: page.next };
}

/** Set removed_at on the target (remove) or clear it (restore). Returns true if it changed. */
async function setRemoved(env, type, targetId, removed, actorId) {
  const t = removed ? now() : null;
  if (type === "post") {
    const res = await run(env, `UPDATE posts SET removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS ${removed ? "" : "NOT "}NULL`,
      t, removed ? actorId : null, targetId);
    return res.meta.changes > 0;
  }
  if (type === "comment") {
    const res = await run(env, `UPDATE comments SET removed_at = ? WHERE id = ? AND removed_at IS ${removed ? "" : "NOT "}NULL`, t, targetId);
    if (res.meta.changes > 0) {
      // Keep the post's comment_count honest with what readers can see.
      const c = await one(env, "SELECT post_id FROM comments WHERE id = ?", targetId);
      await run(env, `UPDATE posts SET comment_count = MAX(0, comment_count ${removed ? "- 1" : "+ 1"}) WHERE id = ?`, c.post_id);
    }
    return res.meta.changes > 0;
  }
  if (type === "message") {
    const res = await run(env, `UPDATE messages SET removed_at = ? WHERE id = ? AND removed_at IS ${removed ? "" : "NOT "}NULL`, t, targetId);
    return res.meta.changes > 0;
  }
  fail(400, "Only posts, comments and messages can be removed or restored.");
}

async function act(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const admin = isAdmin(env, user);
  const reportRow = await one(env, "SELECT * FROM reports WHERE id = ?", str(ctx.params.id, 60));
  const mine = admin ? [] : await moderated(env, user);
  if (!reportRow || !(await mayHandle(env, user, reportRow, mine))) fail(404, "No such report.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const action = oneOf(b.action, ACTIONS, null);
  if (!action) fail(400, `action must be one of ${ACTIONS.join(", ")}.`);
  if (action === "suspend" && !admin) fail(403, "Only site admins can suspend accounts.");
  const note = str(b.note, 2000);
  const target = await targetOf(env, reportRow.target_type, reportRow.target_id);
  const detail = { report: reportRow.id, target_type: reportRow.target_type, target_id: reportRow.target_id, note };

  if (action === "remove" || action === "restore") {
    if (reportRow.target_type === "badge") {
      // A badge appeal: restore gives the badge back to the appellant, remove takes it.
      await run(env,
        `INSERT INTO badges (user_id, badge, evidence_json, awarded_at, revoked_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, badge) DO UPDATE SET revoked_at = excluded.revoked_at`,
        reportRow.reporter_id, reportRow.target_id, JSON.stringify({ appeal: reportRow.id }), now(), action === "remove" ? now() : null);
    } else {
      if (!target) fail(404, "The reported content no longer exists.");
      detail.changed = await setRemoved(env, reportRow.target_type, reportRow.target_id, action === "remove", user.id);
    }
  } else if (action === "suspend") {
    if (!target || !target.owner) fail(400, "There is nobody to suspend for this report.");
    const days = Math.min(Math.max(int(b.days, 7), 1), 3650);
    await run(env, "UPDATE users SET suspended_until = ? WHERE id = ?", now() + days * 86400, target.owner);
    detail.days = days;
    detail.user = target.owner;
  } else if (action === "warn") {
    if (!target || !target.owner) fail(400, "There is nobody to warn for this report.");
    detail.user = target.owner;
  }

  const status = action === "dismiss" ? "dismissed" : "actioned";
  await run(env, "UPDATE reports SET status = ?, resolution = ?, handled_by = ?, handled_at = ? WHERE id = ?",
    status, note ? `${action}: ${note}` : action, user.id, now(), reportRow.id);
  await audit(env, user.id, `mod.${action}`, reportRow.target_type, reportRow.target_id, detail);

  const owner = target && target.owner;
  const why = note ? ` ${note}` : "";
  if (owner && action === "remove") await notify(env, owner, "moderation", null, reportRow.target_type, reportRow.target_id, `A moderator removed your ${reportRow.target_type}.${why}`);
  if (owner && action === "restore") await notify(env, owner, "moderation", null, reportRow.target_type, reportRow.target_id, `A moderator restored your ${reportRow.target_type}.${why}`);
  if (owner && action === "warn") await notify(env, owner, "moderation", null, reportRow.target_type, reportRow.target_id, `A moderator sent you a warning.${why}`);
  if (owner && action === "suspend") await notify(env, owner, "moderation", null, "user", owner, `Your account is suspended for ${detail.days} days.${why}`);
  if (reportRow.reporter_id !== owner) {
    await notify(env, reportRow.reporter_id, "moderation", null, "report", reportRow.id,
      action === "dismiss" ? "A moderator reviewed your report and took no action." : "A moderator acted on your report.");
  }
  return { id: reportRow.id, status, action };
}

async function auditLog(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  if (!isAdmin(env, user)) fail(403, "Only site admins can read the audit log.");
  const limit = limitOf(ctx);
  const cur = cursorClause(ctx, "created_at", "id");
  const where = [];
  const binds = [];
  for (const k of ["action", "ref_type", "ref_id"]) {
    const v = str(param(ctx, k), 120);
    if (v) { where.push(`${k} = ?`); binds.push(v); }
  }
  const rows = await all(env,
    `SELECT * FROM audit WHERE 1 = 1 ${where.map((w) => `AND ${w}`).join(" ")}${cur.sql} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ...binds, ...cur.binds, limit + 1);
  const page = paged(rows, limit);
  const actors = await usersById(env, page.items.map((r) => r.actor_id));
  return {
    items: page.items.map((r) => ({ id: r.id, actor: actors[r.actor_id] || null, action: r.action, ref_type: r.ref_type,
      ref_id: r.ref_id, detail: parse(r.detail_json, {}), created_at: r.created_at })),
    next: page.next,
  };
}

export const routes = [
  ["POST", "/v1/reports", report],
  ["GET", "/v1/mod/reports", queue],
  ["POST", "/v1/mod/reports/:id", act],
  ["GET", "/v1/mod/audit", auditLog],
];
