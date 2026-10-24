/**
 * Office hours: a mentor's bookable slots, so asking for advice is a click on
 * a time rather than a message into the void. A mentor offers half-hours (a
 * video link, or "message me"); a mentee books one with a line on what they
 * want; both are told, both get a calendar file. Cancelling frees the slot.
 *
 * The 30-day check-in (checkins(), daily cron): an active mentoring pair is
 * asked once, a month in, how it is going -- the moment pairings quietly
 * fizzle out.
 */
import { fail, now, str, int, id, requireUser, currentUser, rateLimit, readJson, notify, userByHandle, usersById, url as cleanUrl } from "./lib.js";
import { all, one, run } from "./collab.js";

const DAY = 86400;
const MAX_FUTURE_SLOTS = 60;
const MAX_BOOKINGS_WITH_ONE_MENTOR = 2;

function slotShape(row, users, viewer) {
  const mine = viewer && (row.mentor_id === viewer.id || row.booked_by === viewer.id);
  return {
    id: row.id,
    mentor: users[row.mentor_id] || null,
    starts_at: row.starts_at,
    minutes: row.minutes,
    topic: row.topic,
    status: row.status,
    booked: !!row.booked_by,
    // Who booked, the note and the meeting link are for the two of them only.
    ...(mine ? { booked_by: users[row.booked_by] || null, note: row.note, where: row.where_text } : {}),
  };
}

/** GET /v1/mentoring/slots?mentor=<handle> -- that mentor's coming slots. */
async function listSlots(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const handle = str(ctx.url.searchParams.get("mentor"), 40);
  const mentor = handle ? await userByHandle(env, handle) : viewer;
  if (!mentor) fail(404, "Not found.");
  const t = now();
  const own = viewer && viewer.id === mentor.id;
  const rows = await all(env,
    `SELECT * FROM mentor_slots WHERE mentor_id = ? AND starts_at > ? AND status != 'cancelled'
       ${own ? "" : "AND (status = 'open' OR booked_by = ?)"} ORDER BY starts_at LIMIT 100`,
    mentor.id, t - 3600, ...(own ? [] : [viewer ? viewer.id : ""]));
  const users = await usersById(env, [mentor.id, ...rows.map((r) => r.booked_by).filter(Boolean)]);
  return { items: rows.map((r) => slotShape(r, users, viewer)) };
}

/** GET /v1/me/slots -- slots I offer and slots I booked. */
async function mySlots(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const t = now() - 3600;
  const rows = await all(env,
    "SELECT * FROM mentor_slots WHERE (mentor_id = ? OR booked_by = ?) AND starts_at > ? AND status != 'cancelled' ORDER BY starts_at LIMIT 200",
    user.id, user.id, t);
  const users = await usersById(env, [...new Set(rows.flatMap((r) => [r.mentor_id, r.booked_by]).filter(Boolean))]);
  return {
    offering: rows.filter((r) => r.mentor_id === user.id).map((r) => slotShape(r, users, user)),
    booked: rows.filter((r) => r.booked_by === user.id).map((r) => slotShape(r, users, user)),
  };
}

/** POST /v1/mentoring/slots {starts_at, minutes?, topic?, where?, repeat_weeks?} */
async function addSlots(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await readJson(ctx.request);
  const t = now();
  const start = int(b.starts_at);
  if (!start || start < t + 600 || start > t + 365 * DAY) fail(400, "Pick a time at least ten minutes ahead and within a year.");
  const minutes = [15, 20, 30, 45, 60].includes(int(b.minutes)) ? int(b.minutes) : 30;
  const repeat = Math.min(12, Math.max(1, int(b.repeat_weeks) || 1));
  const where = cleanUrl(b.where) || str(b.where, 200);
  const future = (await one(env, "SELECT COUNT(*) AS n FROM mentor_slots WHERE mentor_id = ? AND starts_at > ? AND status != 'cancelled'", user.id, t))?.n || 0;
  if (future + repeat > MAX_FUTURE_SLOTS) fail(400, `You can offer up to ${MAX_FUTURE_SLOTS} coming slots.`);
  const ids = [];
  for (let w = 0; w < repeat; w += 1) {
    const sid = id("ms");
    await run(env,
      "INSERT INTO mentor_slots (id, mentor_id, starts_at, minutes, topic, where_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
      sid, user.id, start + w * 7 * DAY, minutes, str(b.topic, 120), where, t);
    ids.push(sid);
  }
  return { created: ids };
}

async function slotOr404(env, slotId) {
  const row = await one(env, "SELECT * FROM mentor_slots WHERE id = ?", str(slotId, 60));
  if (!row || row.status === "cancelled") fail(404, "Not found.");
  return row;
}

/** POST /v1/mentoring/slots/:id/book {note} */
async function book(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const slot = await slotOr404(env, ctx.params.id);
  if (slot.mentor_id === user.id) fail(400, "That's your own slot.");
  if (slot.status !== "open" || slot.booked_by) fail(409, "Someone has just booked that slot.");
  if (slot.starts_at < now() + 300) fail(409, "That slot has started.");
  const held = (await one(env,
    "SELECT COUNT(*) AS n FROM mentor_slots WHERE mentor_id = ? AND booked_by = ? AND starts_at > ? AND status = 'booked'",
    slot.mentor_id, user.id, now()))?.n || 0;
  if (held >= MAX_BOOKINGS_WITH_ONE_MENTOR) fail(409, "You already have two coming sessions with this mentor.");
  const b = await readJson(ctx.request).catch(() => ({}));
  const t = now();
  // Conditional update: two people pressing at once, one wins.
  const r = await run(env,
    "UPDATE mentor_slots SET booked_by = ?, booked_at = ?, note = ?, status = 'booked' WHERE id = ? AND status = 'open' AND booked_by IS NULL",
    user.id, t, str(b?.note, 500), slot.id);
  if (!Number(r?.meta?.changes || 0)) fail(409, "Someone has just booked that slot.");
  await notify(env, slot.mentor_id, "mentoring", user.id, "slot", slot.id, "booked one of your office hours");
  return { ok: true, id: slot.id };
}

/** POST /v1/mentoring/slots/:id/cancel -- the mentee lets it go, or the mentor withdraws it. */
async function cancel(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const slot = await slotOr404(env, ctx.params.id);
  if (slot.booked_by === user.id) {
    await run(env, "UPDATE mentor_slots SET booked_by = NULL, booked_at = NULL, note = '', status = 'open' WHERE id = ?", slot.id);
    await notify(env, slot.mentor_id, "mentoring", user.id, "slot", slot.id, "cancelled their booking");
    return { ok: true, status: "open" };
  }
  if (slot.mentor_id === user.id) {
    await run(env, "UPDATE mentor_slots SET status = 'cancelled' WHERE id = ?", slot.id);
    if (slot.booked_by) await notify(env, slot.booked_by, "mentoring", user.id, "slot", slot.id, "cancelled your office hour");
    return { ok: true, status: "cancelled" };
  }
  return fail(404, "Not found.");
}

/** The two of them only: an .ics for the session. */
export function slotIcs(slot, mentor, mentee, selfOrigin = "") {
  const stamp = (s) => new Date(s * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const who = (u) => (u ? u.name || `@${u.handle}` : "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GeoID Network//Office hours//EN", "BEGIN:VEVENT",
    `UID:${slot.id}@geoid-network`, `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
    `DTSTART:${stamp(slot.starts_at)}`, `DTEND:${stamp(slot.starts_at + slot.minutes * 60)}`,
    `SUMMARY:${esc(`Office hour: ${who(mentor)} and ${who(mentee)}`)}`,
    `DESCRIPTION:${esc([slot.topic, slot.note].filter(Boolean).join(" — "))}`,
    ...(slot.where_text ? [`LOCATION:${esc(slot.where_text)}`] : []),
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

async function ics(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const slot = await slotOr404(env, ctx.params.id);
  if (slot.mentor_id !== user.id && slot.booked_by !== user.id) fail(404, "Not found.");
  const users = await usersById(env, [slot.mentor_id, slot.booked_by].filter(Boolean));
  return new Response(slotIcs(slot, users[slot.mentor_id], users[slot.booked_by], env.SELF_ORIGIN), {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="office-hour.ics"` },
  });
}

/**
 * Daily: an active pairing a month old that has not been asked yet is asked
 * now -- both of them, once.
 */
export async function checkins(env, t = now(), { limit = 200 } = {}) {
  const rows = await all(env,
    `SELECT * FROM mentoring_requests WHERE status = 'active' AND checkin_sent_at IS NULL
       AND responded_at IS NOT NULL AND responded_at < ? LIMIT ?`, t - 30 * DAY, limit);
  for (const r of rows) {
    await notify(env, r.mentee_id, "mentoring", r.mentor_id, "mentoring", r.id, "A month in: how is the mentoring going? Book an office hour or say what would help.");
    await notify(env, r.mentor_id, "mentoring", r.mentee_id, "mentoring", r.id, "A month in: how is the mentoring going? Offer a slot or close it if it's done.");
    await run(env, "UPDATE mentoring_requests SET checkin_sent_at = ? WHERE id = ?", t, r.id);
  }
  return { asked: rows.length };
}

export const routes = [
  ["GET", "/v1/mentoring/slots", listSlots],
  ["POST", "/v1/mentoring/slots", addSlots],
  ["GET", "/v1/me/slots", mySlots],
  ["POST", "/v1/mentoring/slots/:id/book", book],
  ["POST", "/v1/mentoring/slots/:id/cancel", cancel],
  ["GET", "/v1/mentoring/slots/:id/ics", ics],
];
