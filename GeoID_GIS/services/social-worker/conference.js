/**
 * Conferences: the meetings where this community actually meets.
 *
 * An event post whose meta.format is "conference" (made by a member, or
 * imported from a society's calendar) gets, beside RSVP and "who's going"
 * (events.js):
 *   - the programme as members declare it: their talks, posters, PICOs and
 *     the sessions they convene, by session code, so people find each other
 *     by topic before they arrive;
 *   - meet-ups: small events whose meta.parent_event names the conference;
 *   - the poster gallery (events.js), open for a month after it ends.
 */
import { now, str, id, fail, requireUser, currentUser, readJson, int, rateLimit, usersById, canSeePost, VISIBLE_POSTS, visibleBinds, parse } from "./lib.js";
import { all, one, run } from "./collab.js";
import { shapePosts } from "./posts.js";

export const ITEM_KINDS = { talk: "Talk", poster: "Poster", pico: "PICO", convening: "Convening a session" };

async function conferenceOr404(env, viewer, eid) {
  const post = await one(env, "SELECT * FROM posts WHERE id = ? AND removed_at IS NULL", eid);
  if (!post || post.kind !== "event" || !(await canSeePost(env, viewer, post))) fail(404, "Not found.");
  const meta = parse(post.meta_json, {});
  if (meta.format !== "conference") fail(400, "That event isn't a conference.");
  return { post, meta };
}

/** GET /v1/events/:id/programme?session= -- what members present, by session. */
async function programme(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const { post } = await conferenceOr404(env, viewer, ctx.params.id);
  const session = str(ctx.url.searchParams.get("session"), 40);
  const rows = await all(env,
    `SELECT * FROM conference_items WHERE event_id = ? ${session ? "AND session LIKE ?" : ""} ORDER BY session, COALESCE(starts_at, 0), created_at`,
    post.id, ...(session ? [`${session.replace(/[%_]/g, "")}%`] : []));
  const users = await usersById(env, rows.map((r) => r.user_id));
  const items = rows.filter((r) => users[r.user_id]).map((r) => ({
    id: r.id, kind: r.kind, kind_label: ITEM_KINDS[r.kind], session: r.session, title: r.title, starts_at: r.starts_at,
    post_id: r.post_id, user: users[r.user_id], mine: !!viewer && viewer.id === r.user_id,
  }));
  const sessions = [...new Set(items.map((i) => i.session).filter(Boolean))];
  return { items, sessions };
}

/** POST /v1/events/:id/programme {kind, session, title, starts_at, post_id} -- add what you're presenting. */
async function addItem(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const { post, meta } = await conferenceOr404(env, user, ctx.params.id);
  const going = await one(env, "SELECT status FROM event_rsvps WHERE post_id = ? AND user_id = ? AND status != 'not_going'", post.id, user.id);
  // Before and during the meeting the programme is the attendees'; afterwards
  // anybody who presented can add what they showed.
  const over = Number(meta.ends_at || meta.starts_at || 0) < now();
  if (!going && !over && post.author_id !== user.id) fail(403, "Say you're going first: the programme is the attendees'.");
  const b = await readJson(ctx.request);
  if (!ITEM_KINDS[b.kind]) fail(400, `kind must be one of ${Object.keys(ITEM_KINDS).join(", ")}.`);
  const title = str(b.title, 300);
  if (!title) fail(400, "Give the title.");
  const mine = (await one(env, "SELECT COUNT(*) AS n FROM conference_items WHERE event_id = ? AND user_id = ?", post.id, user.id))?.n || 0;
  if (mine >= 10) fail(409, "Ten entries each is plenty.");
  let postId = null;
  if (b.post_id) {
    const p = await one(env, "SELECT id, author_id FROM posts WHERE id = ? AND removed_at IS NULL", str(b.post_id, 40));
    if (!p || p.author_id !== user.id) fail(400, "Link one of your own posts.");
    postId = p.id;
  }
  const row = { id: id("ci"), event_id: post.id, user_id: user.id, kind: b.kind, session: str(b.session, 40).toUpperCase(), title,
    starts_at: int(b.starts_at, null), post_id: postId, created_at: now() };
  await run(env, `INSERT INTO conference_items (id, event_id, user_id, kind, session, title, starts_at, post_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...Object.values(row));
  return { ok: true, id: row.id };
}

async function removeItem(ctx) {
  const user = await requireUser(ctx);
  await run(ctx.env, "DELETE FROM conference_items WHERE id = ? AND user_id = ?", ctx.params.item, user.id);
  return { ok: true };
}

/** GET /v1/events/:id/meetups -- events members set up at the conference. */
async function meetups(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const { post } = await conferenceOr404(env, viewer, ctx.params.id);
  const rows = await all(env,
    `SELECT p.* FROM posts p WHERE ${VISIBLE_POSTS} AND p.kind = 'event' AND json_extract(p.meta_json, '$.parent_event') = ?
      ORDER BY COALESCE(json_extract(p.meta_json, '$.starts_at'), p.created_at) ASC LIMIT 50`,
    ...visibleBinds(viewer), post.id);
  return { items: await shapePosts(env, viewer, rows) };
}

export const routes = [
  ["GET", "/v1/events/:id/programme", programme],
  ["POST", "/v1/events/:id/programme", addItem],
  ["DELETE", "/v1/events/:id/programme/:item", removeItem],
  ["GET", "/v1/events/:id/meetups", meetups],
];
