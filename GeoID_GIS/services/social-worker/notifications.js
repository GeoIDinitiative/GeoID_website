/**
 * The notification inbox. Rows are written by notify() in lib.js from every
 * module; this file only reads them and marks them read.
 */
import { PAGE, fail, int, str, readJson, requireUser, usersById, NOT_BLOCKED, rateLimit } from "./lib.js";
import { olderThan, pageOf } from "./posts.js";

async function list(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const q = ctx.url.searchParams;
  // notify() refuses across a block, but a block made AFTER a notification
  // must hide it too, so the list filters actors again.
  const where = ["n.user_id = ?", `(n.actor_id IS NULL OR (${NOT_BLOCKED("n.actor_id")}))`];
  const binds = [user.id, user.id, user.id];
  if (q.get("unread") === "1") where.push("n.read = 0");
  const cursor = olderThan(q.get("cursor"), "n");
  const rows = (await env.DB.prepare(
    `SELECT n.* FROM notifications n WHERE ${where.join(" AND ")}${cursor.sql}
      ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
  ).bind(...binds, ...cursor.binds, PAGE + 1).all()).results;
  const { page, next } = pageOf(rows);
  const actors = await usersById(env, page.map((r) => r.actor_id));
  return {
    items: page.map((r) => ({
      id: r.id,
      kind: r.kind,
      actor: actors[r.actor_id] || null,
      ref_type: r.ref_type,
      ref_id: r.ref_id,
      text: r.text,
      read: !!r.read,
      created_at: r.created_at,
    })),
    next,
  };
}

async function markRead(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const body = await readJson(ctx.request);
  if (body.ids !== undefined && !Array.isArray(body.ids)) fail(400, "ids is a list.");
  const ids = (body.ids || []).map((v) => str(v, 40)).filter(Boolean).slice(0, 500);
  if (body.ids && ids.length) {
    // user_id in the WHERE: one person cannot mark another's notifications.
    await env.DB.prepare(
      `UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    ).bind(user.id, ...ids).run();
  } else if (!body.ids) {
    await env.DB.prepare("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0").bind(user.id).run();
  }
  const unread = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0")
    .bind(user.id).first("n");
  return { ok: true, unread: int(unread, 0) };
}

export const routes = [
  ["GET", "/v1/notifications", list],
  ["POST", "/v1/notifications/read", markRead],
];
