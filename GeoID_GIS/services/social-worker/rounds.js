/**
 * Feedback rounds: review timed to the moments that need it.
 *
 * An admin opens a round against a real deadline -- "EGU abstracts", "PhD
 * applications: CV review", "Mock interviews, November". Members who can help
 * volunteer (with how many they can take); members who want feedback bring a
 * draft through the ordinary review request (reviews.js, private by default)
 * naming the round, and are matched to the volunteer with the most room left,
 * preferring shared expertise. Mock interviews pair a mentee with a mentor
 * and leave them to pick a time (office hours, messages).
 *
 * Giving review is credited: /v1/users/:handle/review-record lists the
 * reviews a member has submitted -- in rounds and outside them -- for the
 * profile and a printable record.
 */
import { now, str, id, fail, requireUser, currentUser, isAdmin, readJson, int, parse, url, notify, usersById, userByHandle, rateLimit } from "./lib.js";
import { all, one, run } from "./collab.js";

export const ROUND_KINDS = { abstract: "Abstract review", cv: "CV review", cover_letter: "Cover-letter review", mock_interview: "Mock interviews" };

const shape = (r, extra = {}) => ({
  id: r.id, kind: r.kind, kind_label: ROUND_KINDS[r.kind] || r.kind, title: r.title, description: r.description, link: r.link,
  deadline_at: r.deadline_at, closes_at: r.closes_at, status: r.closes_at && r.closes_at < now() ? "closed" : r.status, ...extra,
});

async function roundOr404(env, rid) {
  const r = await one(env, "SELECT * FROM feedback_rounds WHERE id = ?", rid);
  if (!r) fail(404, "Not found.");
  return r;
}
const isOpen = (r) => r.status === "open" && (!r.closes_at || r.closes_at >= now());

async function listRounds(ctx) {
  const env = ctx.env;
  const viewer = await currentUser(ctx);
  const rows = await all(env, "SELECT * FROM feedback_rounds ORDER BY (status = 'open') DESC, COALESCE(closes_at, deadline_at, created_at) ASC LIMIT 50");
  const out = [];
  for (const r of rows) {
    const stats = await one(env, `SELECT
      (SELECT COUNT(*) FROM reviews WHERE round_id = ?) AS drafts,
      (SELECT COUNT(*) FROM round_pairs WHERE round_id = ?) AS mentees,
      (SELECT COALESCE(SUM(capacity - assigned), 0) FROM round_volunteers WHERE round_id = ?) AS room,
      (SELECT COUNT(*) FROM round_volunteers WHERE round_id = ?) AS volunteers`, r.id, r.id, r.id, r.id);
    const mine = viewer ? {
      volunteering: !!await one(env, "SELECT 1 FROM round_volunteers WHERE round_id = ? AND user_id = ?", r.id, viewer.id),
      drafts: (await one(env, "SELECT COUNT(*) AS n FROM reviews WHERE round_id = ? AND requester_id = ?", r.id, viewer.id))?.n || 0,
    } : null;
    out.push(shape(r, { stats, viewer: mine }));
  }
  return { items: out };
}

async function createRound(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  if (!isAdmin(env, user)) fail(403, "Admins only.");
  const b = await readJson(ctx.request);
  if (!ROUND_KINDS[b.kind]) fail(400, `kind must be one of ${Object.keys(ROUND_KINDS).join(", ")}.`);
  const title = str(b.title, 160);
  if (!title) fail(400, "Give the round a title.");
  const row = { id: id("fr"), kind: b.kind, title, description: str(b.description, 2000), link: url(b.link) || "",
    deadline_at: int(b.deadline_at, null), closes_at: int(b.closes_at, null), status: "open", created_by: user.id, created_at: now() };
  await run(env, `INSERT INTO feedback_rounds (id, kind, title, description, link, deadline_at, closes_at, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...Object.values(row));
  return shape(row);
}

async function patchRound(ctx) {
  const user = await requireUser(ctx);
  if (!isAdmin(ctx.env, user)) fail(403, "Admins only.");
  const r = await roundOr404(ctx.env, ctx.params.id);
  const b = await readJson(ctx.request);
  if (b.status) await run(ctx.env, "UPDATE feedback_rounds SET status = ? WHERE id = ?", b.status === "closed" ? "closed" : "open", r.id);
  return shape(await roundOr404(ctx.env, r.id));
}

/** POST /v1/rounds/:id/volunteer {capacity} -- offer to review (or to interview, for mock interviews). */
async function volunteer(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const r = await roundOr404(env, ctx.params.id);
  if (!isOpen(r)) fail(409, "This round has closed.");
  const b = await readJson(ctx.request).catch(() => ({}));
  const capacity = Math.min(5, Math.max(1, int(b.capacity, 2) || 2));
  if (b.withdraw) {
    await run(env, "DELETE FROM round_volunteers WHERE round_id = ? AND user_id = ? AND assigned = 0", r.id, user.id);
    return { volunteering: false };
  }
  await run(env, `INSERT INTO round_volunteers (round_id, user_id, capacity, assigned, created_at) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(round_id, user_id) DO UPDATE SET capacity = MAX(excluded.capacity, round_volunteers.assigned)`, r.id, user.id, capacity, now());
  if (r.kind === "mock_interview") await pairWaiting(env, r);
  else await assignWaiting(env, r);
  return { volunteering: true, capacity };
}

/** The volunteer with most room left, preferring one who shares an expertise tag; never the author. */
async function pickVolunteer(env, round, authorId, expertise = []) {
  const rows = await all(env,
    `SELECT v.user_id, v.capacity - v.assigned AS room, u.skills_json, u.interests_json FROM round_volunteers v JOIN users u ON u.id = v.user_id
      WHERE v.round_id = ? AND v.user_id != ? AND v.capacity > v.assigned AND u.suspended_until < ? ORDER BY room DESC, v.created_at ASC`,
    round.id, authorId, now());
  if (!rows.length) return null;
  const want = new Set(expertise);
  const shared = rows.find((r) => [...parse(r.skills_json, []), ...parse(r.interests_json, [])].some((tg) => want.has(tg)));
  return (shared || rows[0]).user_id;
}

/** Give a round's draft a reviewer, if one has room. */
export async function assignReview(env, round, review) {
  if (await one(env, "SELECT 1 FROM reviewers WHERE review_id = ? AND status != 'declined'", review.id)) return null;
  const who = await pickVolunteer(env, round, review.requester_id, parse(review.expertise_json, []));
  if (!who) return null;
  const t = now();
  await run(env, "INSERT OR IGNORE INTO reviewers (review_id, user_id, status, created_at) VALUES (?, ?, 'accepted', ?)", review.id, who, t);
  await run(env, "UPDATE round_volunteers SET assigned = assigned + 1 WHERE round_id = ? AND user_id = ?", round.id, who);
  await notify(env, who, "review", review.requester_id, "review", review.id, `${round.title}: a draft for you to review`);
  await notify(env, review.requester_id, "review", null, "review", review.id, `${round.title}: a reviewer has your draft`);
  return who;
}

/** Drafts waiting in a round get the volunteers who just arrived. */
async function assignWaiting(env, round) {
  const waiting = await all(env,
    `SELECT * FROM reviews r WHERE r.round_id = ? AND NOT EXISTS (SELECT 1 FROM reviewers x WHERE x.review_id = r.id AND x.status != 'declined')
      ORDER BY r.created_at ASC LIMIT 50`, round.id);
  for (const rv of waiting) if (!(await assignReview(env, round, rv))) break;
}

/** reviews.js: the round a new request names, checked BEFORE the request is stored. */
export async function openRound(env, roundId) {
  const round = await one(env, "SELECT * FROM feedback_rounds WHERE id = ?", str(roundId, 40));
  if (!round || round.kind === "mock_interview") fail(400, "No such feedback round.");
  if (!isOpen(round)) fail(409, "That round has closed.");
  return round;
}

/** reviews.js: the stored request joins the round and is matched to a volunteer. */
export async function joinRound(env, round, review) {
  await run(env, "UPDATE reviews SET round_id = ? WHERE id = ?", round.id, review.id);
  await assignReview(env, round, review);
}

// ── Mock interviews ────────────────────────────────────────────────────────

async function pairWaiting(env, round) {
  const waiting = await all(env, "SELECT * FROM round_pairs WHERE round_id = ? AND status = 'waiting' ORDER BY created_at ASC LIMIT 50", round.id);
  for (const p of waiting) {
    const mentor = await pickVolunteer(env, round, p.mentee_id, []);
    if (!mentor) break;
    await run(env, "UPDATE round_pairs SET mentor_id = ?, status = 'paired' WHERE id = ?", mentor, p.id);
    await run(env, "UPDATE round_volunteers SET assigned = assigned + 1 WHERE round_id = ? AND user_id = ?", round.id, mentor);
    const people = await usersById(env, [mentor, p.mentee_id]);
    await notify(env, mentor, "mentoring", p.mentee_id, "user", people[p.mentee_id]?.handle, `${round.title}: you're paired with ${people[p.mentee_id]?.name || "a member"} for a mock interview`);
    await notify(env, p.mentee_id, "mentoring", mentor, "user", people[mentor]?.handle, `${round.title}: ${people[mentor]?.name || "a mentor"} will give you a mock interview`);
  }
}

/** POST /v1/rounds/:id/interview {note} -- ask for a mock interview. */
async function askInterview(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const r = await roundOr404(env, ctx.params.id);
  if (r.kind !== "mock_interview") fail(400, "This round is not for mock interviews.");
  if (!isOpen(r)) fail(409, "This round has closed.");
  if (await one(env, "SELECT 1 FROM round_pairs WHERE round_id = ? AND mentee_id = ?", r.id, user.id)) fail(409, "You're already in this round.");
  const b = await readJson(ctx.request).catch(() => ({}));
  await run(env, "INSERT INTO round_pairs (id, round_id, mentee_id, note, status, created_at) VALUES (?, ?, ?, ?, 'waiting', ?)",
    id("rp"), r.id, user.id, str(b.note, 500), now());
  await pairWaiting(env, r);
  return mine(ctx);
}

/** GET /v1/rounds/:id/mine -- my drafts, the drafts I'm reviewing, my interview pair. */
async function mine(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  const r = await roundOr404(env, ctx.params.id);
  const drafts = await all(env, "SELECT id, title, status FROM reviews WHERE round_id = ? AND requester_id = ? ORDER BY created_at DESC", r.id, user.id);
  const reviewing = await all(env,
    "SELECT rv.id, rv.title, x.status FROM reviews rv JOIN reviewers x ON x.review_id = rv.id WHERE rv.round_id = ? AND x.user_id = ?", r.id, user.id);
  const pairs = await all(env, "SELECT * FROM round_pairs WHERE round_id = ? AND (mentee_id = ? OR mentor_id = ?)", r.id, user.id, user.id);
  const people = await usersById(env, pairs.flatMap((p) => [p.mentee_id, p.mentor_id]));
  const vol = await one(env, "SELECT capacity, assigned FROM round_volunteers WHERE round_id = ? AND user_id = ?", r.id, user.id);
  return {
    round: shape(r), drafts, reviewing, volunteer: vol || null,
    pairs: pairs.map((p) => ({ id: p.id, status: p.status, role: p.mentee_id === user.id ? "mentee" : "mentor",
      other: people[p.mentee_id === user.id ? p.mentor_id : p.mentee_id] || null, note: p.mentor_id === user.id ? p.note : "" })),
  };
}

// ── Credit ─────────────────────────────────────────────────────────────────

/** GET /v1/users/:handle/review-record -- reviews this member submitted (titles of private drafts are not shown). */
async function reviewRecord(ctx) {
  const env = ctx.env;
  const person = await userByHandle(env, ctx.params.handle);
  if (!person || String(person.email).startsWith("erased:")) fail(404, "No such person.");
  const rows = await all(env,
    `SELECT x.submitted_at, x.recommendation, rv.visibility, rv.title, rv.status, fr.title AS round_title, fr.kind AS round_kind
       FROM reviewers x JOIN reviews rv ON rv.id = x.review_id LEFT JOIN feedback_rounds fr ON fr.id = rv.round_id
      WHERE x.user_id = ? AND x.submitted_at IS NOT NULL ORDER BY x.submitted_at DESC LIMIT 500`, person.id);
  const items = rows.map((r) => ({
    submitted_at: r.submitted_at,
    what: r.round_kind ? ROUND_KINDS[r.round_kind] : "Draft review",
    round: r.round_title || null,
    // A draft's title is the author's: shown only once the review is closed and open to all.
    title: r.visibility === "open" && r.status === "closed" ? r.title : null,
  }));
  return { handle: person.handle, name: person.name, total: items.length, rounds: items.filter((i) => i.round).length, items };
}

export const routes = [
  ["GET", "/v1/rounds", listRounds],
  ["POST", "/v1/rounds", createRound],
  ["PATCH", "/v1/rounds/:id", patchRound],
  ["POST", "/v1/rounds/:id/volunteer", volunteer],
  ["POST", "/v1/rounds/:id/interview", askInterview],
  ["GET", "/v1/rounds/:id/mine", mine],
  ["GET", "/v1/users/:handle/review-record", reviewRecord],
];
