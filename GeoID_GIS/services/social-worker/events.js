/**
 * Events: RSVPs, capacity and waitlists, calendar files, reminders, and
 * virtual poster sessions.
 *
 * An event IS a post (kind "event", meta.starts_at / ends_at / where / url /
 * format, and optionally meta.capacity), so who may see it is canSeePost and
 * nothing here invents a second rule: every route below 404s for a viewer who
 * cannot open the event post.
 *
 * ATTENDANCE IS PRIVATE BY DEFAULT. Counts are public to whoever sees the
 * event; names are shown to the organiser always, and to everybody else only
 * for people who ticked "show that I'm coming" (show_me) -- and never across
 * a block.
 *
 * CAPACITY. When meta.capacity is set and full, "going" becomes "waitlist";
 * a place freed (somebody stops going, or the organiser raises the capacity)
 * goes to the longest-waiting person, who is told.
 *
 * REMINDERS are not sent from a request: dueReminders(env, now) says who
 * should hear about an event starting within 24 hours (and marks them, so
 * each RSVP is reminded once); sendReminders() also notifies. cron.js calls
 * dueReminders; nothing here schedules anything.
 */
import {
  fail, now, str, oneOf, int, parse, requireUser, currentUser, rateLimit, notify, usersById,
  canSeePost, NOT_BLOCKED,
} from "./lib.js";
import { body, all, one, run, param, bool } from "./collab.js";
import { shapePosts, postUrl } from "./posts.js";

const RSVP = ["going", "interested", "not_going"];
const DAY = 24 * 3600;
const MAX_POSTERS = 200;
const MAX_CAPACITY = 100000;

export function capacityOf(meta) {
  const n = Number(meta && meta.capacity);
  return Number.isInteger(n) && n > 0 ? n : null;
}
const startsOf = (meta) => int(meta && meta.starts_at, null);
const endsOf = (meta) => {
  const s = startsOf(meta);
  const e = int(meta && meta.ends_at, null);
  return e != null && s != null && e > s ? e : s;
};

/** The event post and its meta for this viewer, or the same 404 as an event that never existed. */
async function loadEvent(ctx, user) {
  const post = await one(ctx.env, "SELECT * FROM posts WHERE id = ?", str(ctx.params.id, 60));
  if (!post || post.kind !== "event" || !(await canSeePost(ctx.env, user, post))) fail(404, "No such event.");
  return { post, meta: parse(post.meta_json, {}) };
}

async function goingCount(env, postId) {
  return (await one(env, "SELECT COUNT(*) AS n FROM event_rsvps WHERE post_id = ? AND status = 'going'", postId)).n;
}

/** Counts, capacity, the viewer's own answer, and the attendees this viewer may see. */
async function summary(env, viewer, post, meta) {
  const counts = { going: 0, interested: 0, not_going: 0, waitlist: 0 };
  for (const r of await all(env, "SELECT status, COUNT(*) AS n FROM event_rsvps WHERE post_id = ? GROUP BY status", post.id)) {
    if (r.status in counts) counts[r.status] = r.n;
  }
  const organiser = !!viewer && viewer.id === post.author_id;
  const mine = viewer ? await one(env, "SELECT status, show_me FROM event_rsvps WHERE post_id = ? AND user_id = ?", post.id, viewer.id) : null;
  let rows;
  if (organiser) {
    rows = await all(env, `SELECT user_id, status, show_me FROM event_rsvps WHERE post_id = ? AND status != 'not_going'
      ORDER BY CASE status WHEN 'going' THEN 0 WHEN 'waitlist' THEN 1 ELSE 2 END, updated_at, user_id LIMIT 500`, post.id);
  } else {
    const binds = [post.id];
    let blocked = "";
    if (viewer) { blocked = ` AND ${NOT_BLOCKED("user_id")}`; binds.push(viewer.id, viewer.id); }
    rows = await all(env, `SELECT user_id, status, show_me FROM event_rsvps WHERE post_id = ? AND show_me = 1
      AND status IN ('going', 'interested')${blocked} ORDER BY status, updated_at, user_id LIMIT 200`, ...binds);
  }
  const users = await usersById(env, rows.map((r) => r.user_id));
  const capacity = capacityOf(meta);
  const end = endsOf(meta);
  return {
    event_id: post.id,
    organiser,
    format: meta.format || "",
    starts_at: startsOf(meta),
    ends_at: int(meta.ends_at, null),
    over: end != null && end < now(),
    capacity,
    spots_left: capacity == null ? null : Math.max(0, capacity - counts.going),
    counts,
    mine: mine ? { status: mine.status, show_me: !!mine.show_me } : null,
    attendees: rows.map((r) => ({ user: users[r.user_id] || null, status: r.status, ...(organiser ? { shown: !!r.show_me } : {}) }))
      .filter((a) => a.user),
  };
}

/** Fill free places from the waitlist, longest-waiting first, and tell each person. */
async function promote(env, post, meta) {
  const cap = capacityOf(meta);
  const room = cap == null ? 10000 : cap - await goingCount(env, post.id);
  if (room <= 0) return 0;
  const rows = await all(env, "SELECT user_id FROM event_rsvps WHERE post_id = ? AND status = 'waitlist' ORDER BY updated_at, user_id LIMIT ?",
    post.id, room);
  const t = now();
  for (const r of rows) {
    await run(env, "UPDATE event_rsvps SET status = 'going', updated_at = ? WHERE post_id = ? AND user_id = ? AND status = 'waitlist'", t, post.id, r.user_id);
    await notify(env, r.user_id, "event", post.author_id, "post", post.id, `A place opened up at "${post.title || "an event"}": you're going`);
  }
  return rows.length;
}

// ── RSVP routes ────────────────────────────────────────────────────────────

async function getRsvp(ctx) {
  const user = await currentUser(ctx);
  const { post, meta } = await loadEvent(ctx, user);
  return summary(ctx.env, user, post, meta);
}

async function setRsvp(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { post, meta } = await loadEvent(ctx, user);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const wanted = oneOf(b.status, RSVP, null);
  if (!wanted) fail(400, "status must be going, interested or not_going.");
  const end = endsOf(meta);
  if (end != null && end < now()) fail(409, "This event is over.");
  const existing = await one(env, "SELECT * FROM event_rsvps WHERE post_id = ? AND user_id = ?", post.id, user.id);
  const showMe = b.show_me === undefined ? (existing ? existing.show_me : 0) : (bool(b.show_me) ? 1 : 0);
  let status = wanted;
  if (wanted === "going" && !(existing && existing.status === "going")) {
    const cap = capacityOf(meta);
    if (cap != null && await goingCount(env, post.id) >= cap) status = "waitlist";
  }
  const t = now();
  // updated_at is "in this status since": the waitlist is served in that order,
  // so ticking show_me must not move anybody back in the queue.
  await run(env,
    `INSERT INTO event_rsvps (post_id, user_id, status, show_me, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(post_id, user_id) DO UPDATE SET status = excluded.status, show_me = excluded.show_me,
       updated_at = CASE WHEN event_rsvps.status = excluded.status THEN event_rsvps.updated_at ELSE excluded.updated_at END`,
    post.id, user.id, status, showMe, t, t);
  if (existing && existing.status === "going" && status !== "going") await promote(env, post, meta);
  if (status === "going" && (!existing || existing.status !== "going")) {
    await notify(env, post.author_id, "event", user.id, "post", post.id, `Is going to "${post.title || "your event"}"`);
  }
  return summary(env, user, post, meta);
}

async function dropRsvp(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { post, meta } = await loadEvent(ctx, user);
  await rateLimit(ctx, user);
  const existing = await one(env, "SELECT status FROM event_rsvps WHERE post_id = ? AND user_id = ?", post.id, user.id);
  await run(env, "DELETE FROM event_rsvps WHERE post_id = ? AND user_id = ?", post.id, user.id);
  if (existing && existing.status === "going") await promote(env, post, meta);
  return summary(env, user, post, meta);
}

/**
 * Organiser settings that live in the event's meta: capacity (null clears it).
 * Raising it fills the new places from the waitlist at once.
 */
async function patchEvent(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { post } = await loadEvent(ctx, user);
  if (post.author_id !== user.id) fail(403, "Only the organiser can change the event.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  if (b.capacity !== undefined) {
    const cap = b.capacity == null || b.capacity === "" || Number(b.capacity) === 0 ? null : int(b.capacity, NaN);
    if (cap !== null && !(Number.isInteger(cap) && cap > 0 && cap <= MAX_CAPACITY)) fail(400, `capacity must be a whole number from 1 to ${MAX_CAPACITY}, or empty.`);
    if (cap == null) {
      await run(env, "UPDATE posts SET meta_json = json_remove(meta_json, '$.capacity'), updated_at = ? WHERE id = ?", now(), post.id);
    } else {
      await run(env, "UPDATE posts SET meta_json = json_set(meta_json, '$.capacity', ?), updated_at = ? WHERE id = ?", cap, now(), post.id);
    }
  }
  const saved = await one(env, "SELECT * FROM posts WHERE id = ?", post.id);
  const meta = parse(saved.meta_json, {});
  await promote(env, saved, meta);
  return summary(env, user, saved, meta);
}

/** RSVP counts and the viewer's own answer for a page of events (the #/events list). */
async function batchRsvps(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const ids = [...new Set(String(param(ctx, "ids") || "").split(",").map((s) => str(s, 60)).filter(Boolean))].slice(0, 50);
  const items = [];
  for (const eventId of ids) {
    const post = await one(env, "SELECT * FROM posts WHERE id = ?", eventId);
    if (!post || post.kind !== "event" || !(await canSeePost(env, user, post))) continue;
    const meta = parse(post.meta_json, {});
    const s = await summary(env, user, post, meta);
    items.push({ event_id: post.id, counts: s.counts, capacity: s.capacity, spots_left: s.spots_left, mine: s.mine, over: s.over });
  }
  return { items, next: null };
}

/** The events the caller said they are going to or interested in. */
async function myRsvps(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const past = param(ctx, "when") === "past";
  const t = now();
  const rows = await all(env,
    `SELECT p.*, r.status AS rsvp_status, CAST(json_extract(p.meta_json, '$.starts_at') AS INTEGER) AS starts_at
     FROM event_rsvps r JOIN posts p ON p.id = r.post_id
     WHERE r.user_id = ? AND r.status != 'not_going' AND p.kind = 'event' AND p.removed_at IS NULL
       AND ${past ? "CAST(json_extract(p.meta_json, '$.starts_at') AS INTEGER) < ?" : "COALESCE(CAST(json_extract(p.meta_json, '$.starts_at') AS INTEGER), ?) >= ?"}
     ORDER BY starts_at ${past ? "DESC" : "ASC"}, p.id LIMIT 100`, user.id, ...(past ? [t] : [t, t - DAY]));
  const seen = [];
  for (const r of rows) if (await canSeePost(env, user, r)) seen.push(r);
  const shaped = await shapePosts(env, user, seen);
  return { items: shaped.map((p, i) => ({ ...p, rsvp: { status: seen[i].rsvp_status } })), next: null };
}

// ── Calendar file ──────────────────────────────────────────────────────────

/** RFC 5545 TEXT: backslash, semicolon and comma escaped; newlines as \n; no other controls. */
export function icsEscape(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n|\r|\n/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Fold a content line at 75 OCTETS (not characters), continuing with CRLF and
 * one space, and never inside a UTF-8 sequence: iterating by code point keeps
 * "Mátra" and emoji whole on one side of a fold.
 */
export function icsFold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74; // the leading space of a continuation line is one of its 75
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Epoch seconds -> 20261023T140000Z (UTC, the form every calendar reads). */
export function icsTime(seconds) {
  return new Date(seconds * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** The VCALENDAR text for one event post. No email anywhere, so no ORGANIZER line (it requires one). */
export function icsFor(env, post, organiserName = "") {
  const meta = parse(post.meta_json, {});
  const start = startsOf(meta);
  if (start == null) return null;
  const endRaw = int(meta.ends_at, null);
  const end = endRaw != null && endRaw > start ? endRaw : start + 3600;
  const link = postUrl(env, post.id);
  const host = (() => { try { return new URL(env.SELF_ORIGIN || "https://social.geoidinitiative.com").host; } catch (e) { return "geohub-social"; } })();
  const description = [
    str(post.body, 4000),
    meta.url ? `Join: ${meta.url}` : "",
    organiserName ? `Organised by ${organiserName}` : "",
    `On GeoID Network: ${link}`,
  ].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GeoID Initiative//GeoID Network//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${post.id}@${host}`,
    `DTSTAMP:${icsTime(now())}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `LAST-MODIFIED:${icsTime(post.updated_at || post.created_at)}`,
    `SUMMARY:${icsEscape(post.title || "GeoHUB event")}`,
    `DESCRIPTION:${icsEscape(description)}`,
    meta.where ? `LOCATION:${icsEscape(str(meta.where, 200))}` : null,
    `URL:${link}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

async function ics(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const { post } = await loadEvent(ctx, user);
  const organiser = await one(env, "SELECT name, handle FROM users WHERE id = ?", post.author_id);
  const text = icsFor(env, post, organiser ? organiser.name || organiser.handle : "");
  if (!text) fail(409, "This event has no start time yet.");
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="geohub-event-${post.id.replace(/[^a-z0-9_]/gi, "")}.ics"`,
      "cache-control": "no-store",
    },
  });
}

// ── Reminders (called by the cron track) ───────────────────────────────────

/**
 * Who should be reminded now: RSVPs of going or interested, not yet
 * reminded, to a live event starting in (at, at + 24 h], that the person can
 * still see. `at` is epoch seconds (an epoch in milliseconds is accepted).
 *
 * What it returns is MARKED reminded (reminded_at) before it returns, so the
 * next pass -- cron.js runs every 15 minutes -- does not return it again;
 * cron.js then notifies, and also skips a text it sent in the last two days.
 * { mark: false } makes it a pure read (sendReminders, tests).
 *
 * -> [{ user_id, event_id, title, starts_at, status, kind: "event", ref_type: "post", ref_id, text }]
 */
export async function dueReminders(env, at = now(), { window = DAY, limit = 500, mark = true } = {}) {
  const t = Math.floor(at > 1e12 ? at / 1000 : at);
  const rows = await all(env,
    `SELECT r.user_id, r.status, p.*, CAST(json_extract(p.meta_json, '$.starts_at') AS INTEGER) AS starts_at
     FROM event_rsvps r JOIN posts p ON p.id = r.post_id
     WHERE r.status IN ('going', 'interested') AND r.reminded_at IS NULL AND p.kind = 'event' AND p.removed_at IS NULL
       AND CAST(json_extract(p.meta_json, '$.starts_at') AS INTEGER) > ?
       AND CAST(json_extract(p.meta_json, '$.starts_at') AS INTEGER) <= ?
     ORDER BY starts_at, p.id, r.user_id LIMIT ?`, t, t + window, limit);
  const out = [];
  for (const r of rows) {
    const person = await one(env, "SELECT * FROM users WHERE id = ?", r.user_id);
    if (!person || String(person.email).startsWith("erased:")) continue;
    const post = { ...r, id: r.id };
    if (!(await canSeePost(env, person, post))) continue;
    const title = r.title || "An event";
    out.push({
      user_id: r.user_id, event_id: r.id, title, starts_at: r.starts_at, status: r.status,
      kind: "event", ref_type: "post", ref_id: r.id,
      text: `"${title}" starts within 24 hours${r.status === "interested" ? " (you said you're interested)" : ""}`,
    });
  }
  if (mark) await markReminded(env, out, t);
  return out;
}

/** Record that these reminders went out, so the next pass skips them. */
export async function markReminded(env, items, at = now()) {
  const t = Math.floor(at > 1e12 ? at / 1000 : at);
  if (!items || !items.length) return 0;
  await env.DB.batch(items.map((i) => env.DB.prepare(
    "UPDATE event_rsvps SET reminded_at = ? WHERE post_id = ? AND user_id = ? AND reminded_at IS NULL",
  ).bind(t, i.event_id, i.user_id)));
  return items.length;
}

/** dueReminders + notify() + markReminded, for a cron that wants it done in one call. */
export async function sendReminders(env, at = now()) {
  const items = await dueReminders(env, at, { mark: false });
  for (const i of items) await notify(env, i.user_id, i.kind, null, i.ref_type, i.ref_id, i.text);
  await markReminded(env, items, at);
  return { sent: items.length };
}

// ── Virtual poster sessions ────────────────────────────────────────────────

// Conferences take posters too, and keep taking them for a month after they
// end: the gallery is how a meeting's posters outlast the meeting.
const isPosterSession = (meta) => meta.format === "poster-session" || meta.format === "conference";
const POSTER_GRACE = (meta) => (meta.format === "conference" ? 30 * 86400 : 0);

/**
 * A poster must be readable by everybody who can see the session: public,
 * unlisted, or written for the very same team/community/project as it.
 */
function posterFitsEvent(poster, event) {
  if (poster.visibility === "public" || poster.visibility === "unlisted") return true;
  if (poster.visibility !== event.visibility) return false;
  if (poster.visibility === "team") return !!poster.team_id && poster.team_id === event.team_id;
  if (poster.visibility === "community") return !!poster.community_id && poster.community_id === event.community_id;
  if (poster.visibility === "project") return !!poster.project_id && poster.project_id === event.project_id;
  return false;
}

async function listPosters(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const { post } = await loadEvent(ctx, user);
  const organiser = !!user && user.id === post.author_id;
  const rows = await all(env,
    `SELECT * FROM event_posters WHERE event_id = ? AND (status = 'approved' OR ? = 1 OR submitted_by = ?)
     ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, created_at, post_id LIMIT ?`,
    post.id, organiser ? 1 : 0, user ? user.id : "", MAX_POSTERS);
  const posts = [];
  const kept = [];
  for (const r of rows) {
    const p = await one(env, "SELECT * FROM posts WHERE id = ?", r.post_id);
    if (p && await canSeePost(env, user, p)) { posts.push(p); kept.push(r); }
  }
  const shaped = await shapePosts(env, user, posts);
  const users = await usersById(env, kept.map((r) => r.submitted_by));
  return {
    items: kept.map((r, i) => ({
      post: shaped[i], status: r.status, note: r.note, submitted_by: users[r.submitted_by] || null,
      created_at: r.created_at, decided_at: r.decided_at,
    })),
    organiser,
    next: null,
  };
}

async function submitPoster(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { post, meta } = await loadEvent(ctx, user);
  if (!isPosterSession(meta)) fail(400, "Only poster sessions and conferences take posters.");
  await rateLimit(ctx, user);
  const end = endsOf(meta);
  if (end != null && end + POSTER_GRACE(meta) < now()) fail(409, "This session is over.");
  const organiser = user.id === post.author_id;
  if (!organiser) {
    const mine = await one(env, "SELECT status FROM event_rsvps WHERE post_id = ? AND user_id = ?", post.id, user.id);
    if (!mine || mine.status === "not_going") fail(403, "RSVP to the session first; posters come from attendees.");
  }
  const b = await body(ctx);
  const poster = await one(env, "SELECT * FROM posts WHERE id = ?", str(b.post_id, 60));
  if (!poster || poster.removed_at || poster.author_id !== user.id) fail(404, "Choose one of your own posts.");
  if (poster.id === post.id || poster.kind === "event") fail(400, "An event can't be a poster.");
  if (!posterFitsEvent(poster, post)) fail(400, "Everybody at the session must be able to read the poster: make the post public or unlisted first.");
  if (await one(env, "SELECT 1 AS x FROM event_posters WHERE event_id = ? AND post_id = ?", post.id, poster.id)) fail(409, "That post is already a poster here.");
  const count = await one(env, "SELECT COUNT(*) AS n FROM event_posters WHERE event_id = ?", post.id);
  if (count.n >= MAX_POSTERS) fail(409, "This session is full of posters.");
  const t = now();
  // The organiser's own posters need nobody's approval.
  const status = organiser ? "approved" : "pending";
  await run(env, "INSERT INTO event_posters (event_id, post_id, submitted_by, status, note, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    post.id, poster.id, user.id, status, str(b.note, 500), t, organiser ? t : null);
  if (!organiser) {
    await notify(env, post.author_id, "event", user.id, "post", post.id, `Submitted a poster to "${post.title || "your session"}": ${poster.title || "untitled"}`);
  }
  return { event_id: post.id, post_id: poster.id, status };
}

async function decidePoster(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { post } = await loadEvent(ctx, user);
  if (post.author_id !== user.id) fail(403, "Only the organiser can approve posters.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const status = oneOf(b.status, ["approved", "rejected", "pending"], null);
  if (!status) fail(400, "status must be approved, rejected or pending.");
  const row = await one(env, "SELECT * FROM event_posters WHERE event_id = ? AND post_id = ?", post.id, str(ctx.params.post_id, 60));
  if (!row) fail(404, "No such poster.");
  await run(env, "UPDATE event_posters SET status = ?, note = ?, decided_at = ? WHERE event_id = ? AND post_id = ?",
    status, b.note !== undefined ? str(b.note, 500) : row.note, status === "pending" ? null : now(), post.id, row.post_id);
  if (status !== row.status && status !== "pending") {
    await notify(env, row.submitted_by, "event", user.id, "post", post.id,
      `${status === "approved" ? "Approved" : "Did not take"} your poster for "${post.title || "the session"}"`);
  }
  return { event_id: post.id, post_id: row.post_id, status };
}

async function removePoster(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { post } = await loadEvent(ctx, user);
  await rateLimit(ctx, user);
  const row = await one(env, "SELECT * FROM event_posters WHERE event_id = ? AND post_id = ?", post.id, str(ctx.params.post_id, 60));
  if (!row) fail(404, "No such poster.");
  if (row.submitted_by !== user.id && post.author_id !== user.id) fail(403, "Only the presenter or the organiser can take a poster down.");
  await run(env, "DELETE FROM event_posters WHERE event_id = ? AND post_id = ?", post.id, row.post_id);
  return { ok: true };
}

export const routes = [
  ["GET", "/v1/events/:id/rsvp", getRsvp],
  ["POST", "/v1/events/:id/rsvp", setRsvp],
  ["DELETE", "/v1/events/:id/rsvp", dropRsvp],
  ["PATCH", "/v1/events/:id", patchEvent],
  ["GET", "/v1/events/:id/ics", ics],
  ["GET", "/v1/events/:id/posters", listPosters],
  ["POST", "/v1/events/:id/posters", submitPoster],
  ["POST", "/v1/events/:id/posters/:post_id", decidePoster],
  ["DELETE", "/v1/events/:id/posters/:post_id", removePoster],
  ["GET", "/v1/event-rsvps", batchRsvps],
  ["GET", "/v1/me/rsvps", myRsvps],
];
