/**
 * v1.3 events: RSVPs with capacity and a waitlist, who may see attendees,
 * the calendar file, the reminder hook for the cron track, and poster
 * sessions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { dueReminders, markReminded, sendReminders, icsEscape, icsFold } from "../events.js";

const T = () => Math.floor(Date.now() / 1000);
async function api(env, method, path, opts = {}) {
  const res = await call(env, method, path, opts);
  const text = res.body instanceof ArrayBuffer ? new TextDecoder().decode(res.body) : JSON.stringify(res.body);
  assert.ok(!text.includes("@example.com"), `${method} ${path} leaked an email: ${text.slice(0, 300)}`);
  return res;
}
const as = (handle) => `${handle}@example.com`;
const ok = (res, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  return res.body;
};
async function people(env, ...handles) {
  const ids = {};
  for (const h of handles) {
    ok(await api(env, "GET", "/v1/conversations", { as: as(h) }));
    ids[h] = env.DB.raw.prepare("SELECT id FROM users WHERE handle = ?").get(h).id;
  }
  return ids;
}
const row = (env, text, ...args) => env.DB.raw.prepare(text).get(...args);
const event = (env, who, meta, extra = {}) => api(env, "POST", "/v1/posts", { as: as(who), body: {
  title: "Etna, Wednesday", body: "Talk; Q&A, then drinks.", kind: "event", meta: { starts_at: T() + 7 * 86400, format: "webinar", ...meta }, ...extra,
} }).then((r) => ok(r));

test("RSVP: counts for all, names only for the organiser or people who chose to show", async () => {
  const env = makeEnv();
  const ids = await people(env, "org", "ana", "ben", "cat");
  const ev = await event(env, "org", {});
  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("ana"), body: { status: "maybe" } }), 400);
  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { body: { status: "going" } }), 401);
  const a = ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("ana"), body: { status: "going", show_me: true } }));
  assert.deepEqual(a.mine, { status: "going", show_me: true });
  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("ben"), body: { status: "going" } }));
  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("cat"), body: { status: "interested" } }));
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'event'", ids.org));

  const pub = ok(await api(env, "GET", `/v1/events/${ev.id}/rsvp`));
  assert.deepEqual(pub.counts, { going: 2, interested: 1, not_going: 0, waitlist: 0 });
  assert.deepEqual(pub.attendees.map((x) => x.user.handle), ["ana"], "only people who chose to show are named");
  assert.equal(pub.mine, null);
  const org = ok(await api(env, "GET", `/v1/events/${ev.id}/rsvp`, { as: as("org") }));
  assert.equal(org.organiser, true);
  assert.deepEqual(org.attendees.map((x) => x.user.handle).sort(), ["ana", "ben", "cat"]);
  assert.equal(org.attendees.find((x) => x.user.handle === "ben").shown, false);

  // A block hides the shown attendee from the blocker.
  ok(await api(env, "POST", "/v1/blocks", { as: as("cat"), body: { handle: "ana" } }));
  assert.equal(ok(await api(env, "GET", `/v1/events/${ev.id}/rsvp`, { as: as("cat") })).attendees.length, 0);

  // Batch counts for the list, and my events.
  const batch = ok(await api(env, "GET", `/v1/event-rsvps?ids=${ev.id},nope`, { as: as("ben") }));
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].mine.status, "going");
  const mine = ok(await api(env, "GET", "/v1/me/rsvps", { as: as("ben") }));
  assert.equal(mine.items[0].id, ev.id);
  assert.equal(mine.items[0].rsvp.status, "going");

  const gone = ok(await api(env, "DELETE", `/v1/events/${ev.id}/rsvp`, { as: as("ben") }));
  assert.equal(gone.counts.going, 1);
  assert.equal(gone.mine, null);
});

test("RSVPs respect the event's visibility, and refuse when it is over or not an event", async () => {
  const env = makeEnv();
  await people(env, "org", "ana");
  const priv = await event(env, "org", {}, { visibility: "private" });
  ok(await api(env, "GET", `/v1/events/${priv.id}/rsvp`, { as: as("ana") }), 404);
  ok(await api(env, "POST", `/v1/events/${priv.id}/rsvp`, { as: as("ana"), body: { status: "going" } }), 404);
  ok(await api(env, "GET", `/v1/events/${priv.id}/ics`, { as: as("ana") }), 404);
  const past = await event(env, "org", { starts_at: T() - 7200, ends_at: T() - 3600 });
  ok(await api(env, "POST", `/v1/events/${past.id}/rsvp`, { as: as("ana"), body: { status: "going" } }), 409);
  const text = ok(await api(env, "POST", "/v1/posts", { as: as("org"), body: { title: "Not an event" } }));
  ok(await api(env, "GET", `/v1/events/${text.id}/rsvp`), 404);
  const batch = ok(await api(env, "GET", `/v1/event-rsvps?ids=${priv.id}`, { as: as("ana") }));
  assert.equal(batch.items.length, 0);
});

test("capacity: a full event waitlists, a freed place goes to the longest-waiting person", async () => {
  const env = makeEnv();
  const ids = await people(env, "org", "ana", "ben", "cat", "dan");
  const ev = await event(env, "org", { capacity: 2 });
  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("ana"), body: { status: "going" } }));
  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("ben"), body: { status: "going" } }));
  const c = ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("cat"), body: { status: "going" } }));
  assert.equal(c.mine.status, "waitlist");
  assert.equal(c.spots_left, 0);
  env.DB.raw.prepare("UPDATE event_rsvps SET updated_at = updated_at - 10 WHERE user_id = ?").run(ids.cat);
  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("dan"), body: { status: "going" } }));
  // Ticking show_me does not lose your place in the queue.
  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("cat"), body: { status: "going", show_me: true } }));
  assert.equal(row(env, "SELECT status FROM event_rsvps WHERE user_id = ?", ids.cat).status, "waitlist");

  ok(await api(env, "POST", `/v1/events/${ev.id}/rsvp`, { as: as("ana"), body: { status: "not_going" } }));
  assert.equal(row(env, "SELECT status FROM event_rsvps WHERE user_id = ?", ids.cat).status, "going");
  assert.equal(row(env, "SELECT status FROM event_rsvps WHERE user_id = ?", ids.dan).status, "waitlist");
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND text LIKE 'A place opened up%'", ids.cat));

  // The organiser raises the capacity: the waitlist moves at once.
  ok(await api(env, "PATCH", `/v1/events/${ev.id}`, { as: as("ana"), body: { capacity: 5 } }), 403);
  ok(await api(env, "PATCH", `/v1/events/${ev.id}`, { as: as("org"), body: { capacity: -1 } }), 400);
  const raised = ok(await api(env, "PATCH", `/v1/events/${ev.id}`, { as: as("org"), body: { capacity: 5 } }));
  assert.equal(raised.capacity, 5);
  assert.equal(raised.counts.going, 3);
  assert.equal(raised.counts.waitlist, 0);
  const cleared = ok(await api(env, "PATCH", `/v1/events/${ev.id}`, { as: as("org"), body: { capacity: null } }));
  assert.equal(cleared.capacity, null);
  assert.equal(ok(await api(env, "GET", `/v1/posts/${ev.id}`)).meta.capacity, undefined);
});

test("the .ics file: UTC times, escaped text, lines folded at 75 octets, CRLF", async () => {
  const env = makeEnv();
  await people(env, "org");
  const start = Date.UTC(2026, 10, 3, 14, 30) / 1000;
  const ev = await event(env, "org", {
    starts_at: start, ends_at: start + 5400, where: "Room 2; Catania, Sicily",
    url: "https://example.org/join",
  }, { title: "Etna, flank; \\ and a very long title that runs on well past the seventy-five octet line limit — Mátra 🌋" });
  const res = await api(env, "GET", `/v1/events/${ev.id}/ics`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/calendar/);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="geohub-event-.+\.ics"/);
  const raw = new TextDecoder().decode(res.body);
  assert.ok(raw.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(raw), "every line ends in CRLF");
  for (const line of raw.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `too long: ${line}`);
  const unfolded = raw.replace(/\r\n /g, "");
  assert.match(unfolded, /DTSTART:20261103T143000Z\r\n/);
  assert.match(unfolded, /DTEND:20261103T160000Z\r\n/);
  assert.match(unfolded, /SUMMARY:Etna\\, flank\\; \\\\ and a very long title.*Mátra 🌋\r\n/);
  assert.match(unfolded, /LOCATION:Room 2\\; Catania\\, Sicily\r\n/);
  assert.match(unfolded, /DESCRIPTION:Talk\\; Q&A\\, then drinks\.\\n\\nJoin: https:\/\/example\.org\/join/);
  assert.match(unfolded, /UID:.+@localhost:8790\r\n/);
  assert.ok(!/ORGANIZER/.test(raw));
  const noStart = ok(await api(env, "POST", "/v1/posts", { as: as("org"), body: { title: "TBC", kind: "event", meta: { format: "seminar" } } }));
  ok(await api(env, "GET", `/v1/events/${noStart.id}/ics`), 409);

  assert.equal(icsEscape("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const folded = icsFold(`DESCRIPTION:${"é".repeat(80)}`);
  for (const line of folded.split("\r\n")) {
    assert.ok(new TextEncoder().encode(line).length <= 75);
    assert.ok(!line.includes("�"));
  }
  assert.equal(folded.replace(/\r\n /g, ""), `DESCRIPTION:${"é".repeat(80)}`);
});

test("dueReminders: going/interested, within 24 h, not yet reminded, still visible", async () => {
  const env = makeEnv();
  const ids = await people(env, "org", "ana", "ben", "cat", "dan");
  const t = T();
  const soon = await event(env, "org", { starts_at: t + 3600 });
  const later = await event(env, "org", { starts_at: t + 3 * 86400 });
  ok(await api(env, "POST", `/v1/events/${soon.id}/rsvp`, { as: as("ana"), body: { status: "going" } }));
  ok(await api(env, "POST", `/v1/events/${soon.id}/rsvp`, { as: as("ben"), body: { status: "interested" } }));
  ok(await api(env, "POST", `/v1/events/${soon.id}/rsvp`, { as: as("cat"), body: { status: "not_going" } }));
  ok(await api(env, "POST", `/v1/events/${soon.id}/rsvp`, { as: as("dan"), body: { status: "going" } }));
  ok(await api(env, "POST", `/v1/events/${later.id}/rsvp`, { as: as("ana"), body: { status: "going" } }));
  // dan blocks the organiser after saying yes: the event is no longer his to see.
  ok(await api(env, "POST", "/v1/blocks", { as: as("dan"), body: { handle: "org" } }));

  const due = await dueReminders(env, t, { mark: false });
  assert.deepEqual(due.map((d) => d.user_id).sort(), [ids.ana, ids.ben].sort());
  assert.ok(due.every((d) => d.event_id === soon.id && d.ref_type === "post" && d.kind === "event"));
  assert.equal((await dueReminders(env, t * 1000, { mark: false })).length, 2, "milliseconds are accepted");
  assert.equal(row(env, "SELECT COUNT(*) AS n FROM event_rsvps WHERE reminded_at IS NOT NULL").n, 0, "mark: false only reads");
  await markReminded(env, due.slice(0, 1), t);
  assert.equal((await dueReminders(env, t, { mark: false })).length, 1);
  const sent = await sendReminders(env, t);
  assert.equal(sent.sent, 1);
  assert.equal((await dueReminders(env, t)).length, 0);
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE kind = 'event' AND text LIKE '%starts within 24 hours%'"));
  // Two days on, the later event is due -- once: the default marks what it returns.
  assert.deepEqual((await dueReminders(env, t + 2 * 86400 + 60)).map((d) => d.event_id), [later.id]);
  assert.equal((await dueReminders(env, t + 2 * 86400 + 60)).length, 0);
});

test("poster sessions: attendees submit their own posts, the organiser approves, the gallery shows approved ones", async () => {
  const env = makeEnv();
  const ids = await people(env, "org", "ana", "ben", "cat");
  const webinar = await event(env, "org", {});
  const session = await event(env, "org", { format: "poster-session" });
  const poster = ok(await api(env, "POST", "/v1/posts", { as: as("ana"), body: { title: "InSAR at Etna", kind: "analysis" } }));
  const hidden = ok(await api(env, "POST", "/v1/posts", { as: as("ana"), body: { title: "Mine only", visibility: "private" } }));
  const bens = ok(await api(env, "POST", "/v1/posts", { as: as("ben"), body: { title: "Ben's poster" } }));

  ok(await api(env, "POST", `/v1/events/${webinar.id}/posters`, { as: as("ana"), body: { post_id: poster.id } }), 400);
  ok(await api(env, "POST", `/v1/events/${session.id}/posters`, { as: as("ana"), body: { post_id: poster.id } }), 403);
  ok(await api(env, "POST", `/v1/events/${session.id}/rsvp`, { as: as("ana"), body: { status: "going" } }));
  ok(await api(env, "POST", `/v1/events/${session.id}/posters`, { as: as("ana"), body: { post_id: bens.id } }), 404);
  ok(await api(env, "POST", `/v1/events/${session.id}/posters`, { as: as("ana"), body: { post_id: hidden.id } }), 400);
  const sub = ok(await api(env, "POST", `/v1/events/${session.id}/posters`, { as: as("ana"), body: { post_id: poster.id, note: "A1 poster" } }));
  assert.equal(sub.status, "pending");
  ok(await api(env, "POST", `/v1/events/${session.id}/posters`, { as: as("ana"), body: { post_id: poster.id } }), 409);
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'event' AND text LIKE 'Submitted a poster%'", ids.org));

  assert.equal(ok(await api(env, "GET", `/v1/events/${session.id}/posters`, { as: as("cat") })).items.length, 0, "pending posters are not in the gallery");
  assert.equal(ok(await api(env, "GET", `/v1/events/${session.id}/posters`, { as: as("ana") })).items[0].status, "pending");
  const orgView = ok(await api(env, "GET", `/v1/events/${session.id}/posters`, { as: as("org") }));
  assert.equal(orgView.organiser, true);
  assert.equal(orgView.items[0].submitted_by.handle, "ana");

  ok(await api(env, "POST", `/v1/events/${session.id}/posters/${poster.id}`, { as: as("ana"), body: { status: "approved" } }), 403);
  ok(await api(env, "POST", `/v1/events/${session.id}/posters/${poster.id}`, { as: as("org"), body: { status: "approved" } }));
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND text LIKE 'Approved your poster%'", ids.ana));
  const gallery = ok(await api(env, "GET", `/v1/events/${session.id}/posters`));
  assert.equal(gallery.items.length, 1);
  assert.equal(gallery.items[0].post.id, poster.id);
  assert.equal(gallery.items[0].post.title, "InSAR at Etna");

  // The organiser's own poster needs no approval; the presenter can take theirs down.
  const orgPoster = ok(await api(env, "POST", "/v1/posts", { as: as("org"), body: { title: "Keynote poster" } }));
  assert.equal(ok(await api(env, "POST", `/v1/events/${session.id}/posters`, { as: as("org"), body: { post_id: orgPoster.id } })).status, "approved");
  ok(await api(env, "DELETE", `/v1/events/${session.id}/posters/${poster.id}`, { as: as("cat") }), 403);
  ok(await api(env, "DELETE", `/v1/events/${session.id}/posters/${poster.id}`, { as: as("ana") }));
  assert.deepEqual(ok(await api(env, "GET", `/v1/events/${session.id}/posters`)).items.map((x) => x.post.id), [orgPoster.id]);
  // A poster post removed later drops out of the gallery.
  ok(await api(env, "DELETE", `/v1/posts/${orgPoster.id}`, { as: as("org") }));
  assert.equal(ok(await api(env, "GET", `/v1/events/${session.id}/posters`)).items.length, 0);
});
