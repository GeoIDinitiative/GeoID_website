/**
 * Reshares: passing somebody's post on to your own followers, optionally with
 * a line of your own.
 *
 * PUBLIC POSTS ONLY. A reshare puts a post in front of people its author did
 * not choose, so a followers-only, team, community or project post cannot be
 * reshared -- that would be a leak with a button on it. Unlisted is excluded
 * too: "anyone with the link" is not "push it to my followers".
 *
 * A reshare never copies the post: the feed shows the original, live, with a
 * "reshared by" line. If the author edits or removes it, every reshare follows.
 *
 * Sending a post to one person is not here: that is a direct message carrying
 * the post's link (messages.js), which the page composes.
 */
import {
  fail, now, id, str, requireUser, currentUser, rateLimit, notify, usersById,
  blockedBetween, canSeePost, NOT_BLOCKED, decodeCursor, PAGE,
} from "./lib.js";

const MAX_NOTE = 500;

async function loadPost(env, postId) {
  return env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(postId).first();
}

const recount = (env, postId) => env.DB.prepare(
  "UPDATE posts SET repost_count = (SELECT COUNT(*) FROM reposts WHERE post_id = ? AND removed_at IS NULL) WHERE id = ?",
).bind(postId, postId);

async function reshare(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const post = await loadPost(env, ctx.params.id);
  if (!post || !(await canSeePost(env, user, post))) fail(404, "Not found.");
  if (post.visibility !== "public") fail(403, "Only public posts can be reshared — this one was shared with a chosen audience.");
  if (post.author_id === user.id) fail(400, "This is your own post — it is already in your followers' feeds.");
  const body = await ctx.request.json().catch(() => ({}));
  const note = str(body?.note, MAX_NOTE);
  const t = now();
  // Re-resharing (e.g. to add a note) replaces the live one rather than
  // stacking: one reshare per member per post.
  await env.DB.batch([
    env.DB.prepare("UPDATE reposts SET removed_at = ? WHERE user_id = ? AND post_id = ? AND removed_at IS NULL").bind(t, user.id, post.id),
    env.DB.prepare("INSERT INTO reposts (id, user_id, post_id, note, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id("rp"), user.id, post.id, note, t),
    recount(env, post.id),
  ]);
  await notify(env, post.author_id, "repost", user.id, "post", post.id,
    note ? `${user.name || user.handle} reshared your post: “${note.slice(0, 80)}”` : `${user.name || user.handle} reshared your post`);
  const count = await env.DB.prepare("SELECT repost_count FROM posts WHERE id = ?").bind(post.id).first("repost_count");
  return { reshared: true, note, count };
}

async function unshare(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const post = await loadPost(env, ctx.params.id);
  if (!post) fail(404, "Not found.");
  await env.DB.batch([
    env.DB.prepare("UPDATE reposts SET removed_at = ? WHERE user_id = ? AND post_id = ? AND removed_at IS NULL").bind(now(), user.id, post.id),
    recount(env, post.id),
  ]);
  const count = await env.DB.prepare("SELECT repost_count FROM posts WHERE id = ?").bind(post.id).first("repost_count");
  return { reshared: false, count };
}

/** Who reshared a post, newest first, minus anyone either side of a block. */
async function resharers(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const post = await loadPost(env, ctx.params.id);
  if (!post || !(await canSeePost(env, viewer, post))) fail(404, "Not found.");
  const where = ["r.post_id = ?", "r.removed_at IS NULL"];
  const binds = [post.id];
  if (viewer) { where.push(NOT_BLOCKED("r.user_id")); binds.push(viewer.id, viewer.id); }
  const rows = (await env.DB.prepare(
    `SELECT r.user_id, r.note, r.created_at FROM reposts r WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC LIMIT 100`,
  ).bind(...binds).all()).results;
  const users = await usersById(env, rows.map((r) => r.user_id));
  return {
    items: rows.filter((r) => users[r.user_id]).map((r) => ({ user: users[r.user_id], note: r.note, created_at: r.created_at })),
    next: null,
  };
}

/**
 * Reshare rows for a feed, as post rows carrying who reshared them.
 *
 * `who`: { followerId } for a Following feed (reshares by people they follow,
 * and their own), or { userId } for one member's own list. Each row is the
 * original post plus rs_user / rs_note / rs_at / rs_id; the sort key is the
 * reshare's own time, so a reshare arrives in a feed when it was made.
 */
export async function reshareRows(env, viewer, who, cursorText) {
  const where = ["r.removed_at IS NULL", "p.removed_at IS NULL", "p.visibility = 'public'"];
  const binds = [];
  if (who.followerId) {
    where.push(`(r.user_id = ? OR r.user_id IN (SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'user'))`);
    binds.push(who.followerId, who.followerId);
  } else if (who.userId) {
    where.push("r.user_id = ?"); binds.push(who.userId);
  } else {
    return [];
  }
  if (viewer) {
    where.push(NOT_BLOCKED("p.author_id"), NOT_BLOCKED("r.user_id"));
    binds.push(viewer.id, viewer.id, viewer.id, viewer.id);
  }
  const c = decodeCursor(cursorText);
  if (c) { where.push("(r.created_at < ? OR (r.created_at = ? AND r.id < ?))"); binds.push(c.at, c.at, c.id); }
  return (await env.DB.prepare(
    `SELECT p.*, r.user_id AS rs_user, r.note AS rs_note, r.created_at AS rs_at, r.id AS rs_id
       FROM reposts r JOIN posts p ON p.id = r.post_id
      WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
  ).bind(...binds, PAGE + 1).all()).results;
}

/**
 * Merge a page of original posts with a page of reshares, newest first, each
 * post once (its newest appearance). Both lists were fetched with the same
 * cursor rule on their own (time, id) key, so the merged order is total and
 * the next cursor is the last item's key.
 */
export function mergeWithReshares(originals, reshares, limit = PAGE) {
  const keyed = [
    ...originals.map((row) => ({ row, at: row.created_at, key: row.id })),
    ...reshares.map((row) => ({ row, at: row.rs_at, key: row.rs_id })),
  ].sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const seen = new Set();
  const out = [];
  let last = null;
  let consumed = 0;
  for (const item of keyed) {
    if (out.length >= limit) break;
    consumed += 1;
    last = item;
    if (seen.has(item.row.id)) continue;
    seen.add(item.row.id);
    out.push(item.row);
  }
  const more = consumed < keyed.length;
  return { rows: out, cursor: more && last ? { created_at: last.at, id: last.key } : null };
}

/** The "reshared by" line for shaped posts, from the rows they came from. */
export async function reshareLines(env, rows) {
  const users = await usersById(env, rows.filter((r) => r.rs_user).map((r) => r.rs_user));
  return rows.map((r) => (r.rs_user && users[r.rs_user]
    ? { user: users[r.rs_user], note: r.rs_note || "", at: r.rs_at }
    : null));
}

/** Has the viewer a live reshare of each of these posts? */
export async function viewerReshared(env, viewer, ids) {
  if (!viewer || !ids.length) return new Set();
  const rows = (await env.DB.prepare(
    `SELECT post_id FROM reposts WHERE user_id = ? AND removed_at IS NULL AND post_id IN (${ids.map(() => "?").join(",")})`,
  ).bind(viewer.id, ...ids).all()).results;
  return new Set(rows.map((r) => r.post_id));
}

// Erasure and export (called from profiles.js).
export const erasureStatements = (env, userId, t) => [
  env.DB.prepare("UPDATE reposts SET note = '', removed_at = COALESCE(removed_at, ?) WHERE user_id = ?").bind(t, userId),
  env.DB.prepare(`UPDATE posts SET repost_count = (SELECT COUNT(*) FROM reposts r WHERE r.post_id = posts.id AND r.removed_at IS NULL)
    WHERE id IN (SELECT post_id FROM reposts WHERE user_id = ?)`).bind(userId),
];
export async function exportRows(env, userId) {
  return (await env.DB.prepare("SELECT post_id, note, created_at, removed_at FROM reposts WHERE user_id = ?").bind(userId).all()).results;
}

export const routes = [
  ["POST", "/v1/posts/:id/repost", reshare],
  ["DELETE", "/v1/posts/:id/repost", unshare],
  ["GET", "/v1/posts/:id/reposts", resharers],
];
