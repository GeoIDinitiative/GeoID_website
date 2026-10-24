/**
 * Draft-paper review: a professor or student asks named reviewers (or a team,
 * a community, or everybody) to read a draft and comment on it, anchored to a
 * page, line or section.
 *
 * The draft PDF is a media row whose scope becomes `review:<id>` when the
 * review is created, so from then on media.js serves it only to the requester
 * and the reviewers.
 *
 * Reviewer summaries and recommendations are shown to the requester at once
 * and to everybody else only once the review is closed, so one reviewer's
 * verdict cannot anchor another's.
 */
import {
  fail, now, id, str, oneOf, int, tags, url, parse, requireUser, currentUser, rateLimit, notify,
  usersById, userByHandle, blockedBetween, avatarUrl, teamRole, communityRole,
} from "./lib.js";
import { body, all, one, run, param, cursorClause, paged, limitOf } from "./collab.js";
import { loadProject, projectRole } from "./projects.js";

const VISIBILITIES = ["private", "team", "community", "open"];
const SEVERITIES = ["general", "major", "minor", "typo"];
const RECOMMENDATIONS = ["accept", "minor", "major", "reject"];
// Reviewers who are actually reviewing (as opposed to merely invited or declined).
const ACTIVE = ["accepted", "volunteered", "submitted"];

export async function loadReview(env, reviewId) {
  return one(env, "SELECT * FROM reviews WHERE id = ?", str(reviewId, 60));
}

/**
 * The viewer's relation to a review: "requester" | "reviewer" | "reader", or
 * null (= 404). A reviewer who declined falls back to the visibility rule.
 */
export async function reviewRole(env, user, review) {
  if (!review) return null;
  if (user && review.requester_id === user.id) return "requester";
  if (user) {
    const row = await one(env, "SELECT status FROM reviewers WHERE review_id = ? AND user_id = ?", review.id, user.id);
    if (row && row.status !== "declined") return "reviewer";
    if (await blockedBetween(env, user.id, review.requester_id)) return null;
  }
  switch (review.visibility) {
    case "open": return "reader";
    case "team": return user && review.team_id && await teamRole(env, review.team_id, user.id) ? "reader" : null;
    case "community": return user && review.community_id && await communityRole(env, review.community_id, user.id) ? "reader" : null;
    default: return null;
  }
}

async function visible(ctx, user) {
  const review = await loadReview(ctx.env, ctx.params.id);
  const role = await reviewRole(ctx.env, user, review);
  if (!role) fail(404, "No such review.");
  return { review, role };
}

async function reviewerRow(env, reviewId, userId) {
  return one(env, "SELECT * FROM reviewers WHERE review_id = ? AND user_id = ?", reviewId, userId);
}

async function scopeNames(env, rows) {
  const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))];
  const commIds = [...new Set(rows.map((r) => r.community_id).filter(Boolean))];
  const teams = teamIds.length ? await all(env, `SELECT id, slug, name FROM teams WHERE id IN (${teamIds.map(() => "?").join(",")})`, ...teamIds) : [];
  const comms = commIds.length ? await all(env, `SELECT id, slug, name FROM communities WHERE id IN (${commIds.map(() => "?").join(",")})`, ...commIds) : [];
  return {
    teams: Object.fromEntries(teams.map((t) => [t.id, { slug: t.slug, name: t.name }])),
    communities: Object.fromEntries(comms.map((c) => [c.id, { slug: c.slug, name: c.name }])),
  };
}

async function reviewShapes(env, rows) {
  const users = await usersById(env, rows.map((r) => r.requester_id));
  const names = await scopeNames(env, rows);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    abstract: r.abstract,
    doc: r.doc_key ? avatarUrl(env, r.doc_key) : "",
    doc_key: r.doc_key,
    doc_url: r.doc_url,
    expertise: parse(r.expertise_json, []),
    visibility: r.visibility,
    team: names.teams[r.team_id] || null,
    community: names.communities[r.community_id] || null,
    project_id: r.project_id,
    due_at: r.due_at,
    status: r.status,
    requester: users[r.requester_id] || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/** {page, x, y, quote} from a client, or null: page 1..2000, x/y clamped to the page. */
export function cleanPin(raw) {
  if (!raw || typeof raw !== "object") return null;
  const page = Math.trunc(Number(raw.page));
  if (!(page >= 1 && page <= 2000)) return null;
  const unit = (v) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : 0);
  return { page, x: unit(raw.x), y: unit(raw.y), quote: str(raw.quote, 500) };
}

function commentShape(row, users) {
  return {
    id: row.id,
    author: users[row.author_id] || null,
    parent_id: row.parent_id,
    anchor: row.anchor,
    // Pinned to the draft PDF (v1.4): page from 1, x/y as 0..1 of the page, and
    // the selected text if there was any. Null on a comment not pinned.
    pin: row.page ? { page: row.page, x: row.x, y: row.y, quote: row.quote || "" } : null,
    severity: row.severity,
    body: row.body,
    resolved: !!row.resolved,
    created_at: row.created_at,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function create(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const title = str(b.title, 300);
  if (!title) fail(400, "A review request needs a title.");
  const visibility = oneOf(b.visibility, VISIBILITIES, "private");
  let teamId = null;
  let communityId = null;
  if (b.team_slug) {
    const team = await one(env, "SELECT id FROM teams WHERE slug = ?", str(b.team_slug, 60).toLowerCase());
    if (!team || !(await teamRole(env, team.id, user.id))) fail(404, "No such team.");
    teamId = team.id;
  }
  if (b.community_slug) {
    const c = await one(env, "SELECT id FROM communities WHERE slug = ?", str(b.community_slug, 60).toLowerCase());
    if (!c || !(await communityRole(env, c.id, user.id))) fail(404, "No such community, or you aren't a member.");
    communityId = c.id;
  }
  if (visibility === "team" && !teamId) fail(400, "A team review needs a team_slug.");
  if (visibility === "community" && !communityId) fail(400, "A community review needs a community_slug.");
  let projectId = null;
  if (b.project_id) {
    const project = await loadProject(env, b.project_id);
    if (!(await projectRole(env, user, project))) fail(404, "No such project.");
    projectId = project.id;
  }
  let docKey = "";
  if (b.doc_key) {
    // Only the requester's own upload can be put under review, or anybody
    // could re-scope (and so hide or expose) somebody else's file.
    const media = await one(env, "SELECT key, owner_id FROM media WHERE key = ?", str(b.doc_key, 200));
    if (!media || media.owner_id !== user.id) fail(400, "Attach a file you uploaded.");
    docKey = media.key;
  }
  const docUrl = url(b.doc_url);
  if (!docKey && !docUrl && !str(b.abstract, 10)) fail(400, "Attach the draft (doc_key or doc_url) or write an abstract.");
  const t = now();
  const reviewId = id("rv");
  const statements = [env.DB.prepare(
    `INSERT INTO reviews (id, requester_id, title, abstract, doc_key, doc_url, expertise_json, visibility, team_id,
       community_id, project_id, due_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).bind(reviewId, user.id, title, str(b.abstract, 5000), docKey, docUrl, JSON.stringify(tags(b.expertise)), visibility,
    teamId, communityId, projectId, int(b.due_at, null), t, t)];
  if (docKey) {
    statements.push(env.DB.prepare("UPDATE media SET scope = ? WHERE key = ? AND owner_id = ?").bind(`review:${reviewId}`, docKey, user.id));
  }
  await env.DB.batch(statements);
  ctx.params.id = reviewId;
  return get(ctx);
}

async function list(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const role = oneOf(param(ctx, "role"), ["mine", "assigned", "open"], "open");
  const limit = limitOf(ctx);
  const cur = cursorClause(ctx, "r.created_at", "r.id");
  let rows;
  if (role === "mine" || role === "assigned") {
    if (!user) fail(401, "Sign in to see your reviews.");
    rows = role === "mine"
      ? await all(env, `SELECT r.* FROM reviews r WHERE r.requester_id = ?${cur.sql} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
        user.id, ...cur.binds, limit + 1)
      : await all(env, `SELECT r.*, rv.status AS my_status FROM reviews r JOIN reviewers rv ON rv.review_id = r.id AND rv.user_id = ?
          WHERE rv.status != 'declined'${cur.sql} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, user.id, ...cur.binds, limit + 1);
  } else {
    const uid = user ? user.id : "";
    rows = await all(env,
      `SELECT r.* FROM reviews r WHERE r.status = 'open' AND r.requester_id != ? AND (
         r.visibility = 'open'
         OR (r.visibility = 'team' AND r.team_id IN (SELECT team_id FROM team_members WHERE user_id = ? AND status = 'active'))
         OR (r.visibility = 'community' AND r.community_id IN (SELECT community_id FROM community_members WHERE user_id = ? AND status = 'active')))
       AND r.requester_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)
       AND r.requester_id NOT IN (SELECT user_id FROM blocks WHERE blocked_id = ?)${cur.sql}
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`, uid, uid, uid, uid, uid, ...cur.binds, limit + 1);
  }
  const page = paged(rows, limit);
  const shapes = await reviewShapes(env, page.items);
  page.items.forEach((r, i) => { if (r.my_status) shapes[i].my_status = r.my_status; });
  return { items: shapes, next: page.next };
}

async function get(ctx) {
  const { env } = ctx;
  const user = await currentUser(ctx);
  const { review, role } = await visible(ctx, user);
  const [shape] = await reviewShapes(env, [review]);
  const reviewers = await all(env, "SELECT * FROM reviewers WHERE review_id = ? ORDER BY created_at", review.id);
  const comments = await all(env, "SELECT * FROM review_comments WHERE review_id = ? ORDER BY created_at, rowid", review.id);
  const users = await usersById(env, [...reviewers.map((r) => r.user_id), ...comments.map((c) => c.author_id)]);
  const open = review.status === "open";
  return {
    review: shape,
    viewer_role: role,
    reviewers: reviewers.map((r) => {
      const verdictShown = role === "requester" || !open || (user && r.user_id === user.id);
      return {
        user: users[r.user_id] || null,
        status: r.status,
        recommendation: verdictShown ? r.recommendation : (r.recommendation ? "hidden" : ""),
        ...(verdictShown ? { summary: r.summary } : {}),
        submitted_at: r.submitted_at,
      };
    }),
    comments: comments.map((c) => commentShape(c, users)),
  };
}

async function invite(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { review, role } = await visible(ctx, user);
  if (role !== "requester") fail(403, "Only the person who asked for the review can invite reviewers.");
  if (review.status !== "open") fail(409, "This review is closed.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const target = await userByHandle(env, b.handle);
  if (!target) fail(404, "No one has that handle.");
  if (target.id === user.id) fail(400, "You can't review your own draft.");
  if (await blockedBetween(env, user.id, target.id)) fail(403, "You can't invite this person.");
  const existing = await reviewerRow(env, review.id, target.id);
  if (existing && existing.status !== "declined") fail(409, "They are already a reviewer.");
  if (existing) {
    await run(env, "UPDATE reviewers SET status = 'invited', created_at = ? WHERE review_id = ? AND user_id = ?", now(), review.id, target.id);
  } else {
    await run(env, "INSERT INTO reviewers (review_id, user_id, status, created_at) VALUES (?, ?, 'invited', ?)", review.id, target.id, now());
  }
  await notify(env, target.id, "review", user.id, "review", review.id, `Invited you to review "${review.title}"`);
  return { status: "invited" };
}

async function volunteer(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { review, role } = await visible(ctx, user);
  if (role === "requester") fail(400, "You can't review your own draft.");
  if (review.visibility === "private") fail(403, "This review is by invitation only.");
  if (review.status !== "open") fail(409, "This review is closed.");
  if (await reviewerRow(env, review.id, user.id)) fail(409, "You are already listed on this review.");
  await rateLimit(ctx, user);
  await run(env, "INSERT INTO reviewers (review_id, user_id, status, created_at) VALUES (?, ?, 'volunteered', ?)", review.id, user.id, now());
  await notify(env, review.requester_id, "review", user.id, "review", review.id, `Volunteered to review "${review.title}"`);
  return { status: "volunteered" };
}

async function respond(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const review = await loadReview(env, ctx.params.id);
  const row = review && await reviewerRow(env, review.id, user.id);
  if (!row || row.status !== "invited") fail(404, "You have no invitation to this review.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const status = b.accept ? "accepted" : "declined";
  await run(env, "UPDATE reviewers SET status = ? WHERE review_id = ? AND user_id = ?", status, review.id, user.id);
  await notify(env, review.requester_id, "review", user.id, "review", review.id,
    b.accept ? `Agreed to review "${review.title}"` : `Declined to review "${review.title}"`);
  return { status };
}

async function comment(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { review, role } = await visible(ctx, user);
  let mine = null;
  if (role !== "requester") {
    mine = await reviewerRow(env, review.id, user.id);
    if (!mine || !ACTIVE.includes(mine.status)) fail(403, "Only the requester and reviewers who accepted can comment.");
  }
  if (review.status !== "open") fail(409, "This review is closed.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const text = str(b.body, 10000);
  if (!text) fail(400, "Write something.");
  let parent = null;
  if (b.parent_id) {
    parent = await one(env, "SELECT * FROM review_comments WHERE id = ? AND review_id = ?", str(b.parent_id, 60), review.id);
    if (!parent) fail(400, "That comment isn't on this review.");
  }
  const t = now();
  const commentId = id("rc");
  const pin = cleanPin(b.pin);
  // A pinned comment still says where it is in words, for email and export.
  const anchor = str(b.anchor, 120) || (pin ? `p${pin.page}` : "");
  await run(env,
    "INSERT INTO review_comments (id, review_id, author_id, parent_id, anchor, severity, body, page, x, y, quote, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    commentId, review.id, user.id, parent ? parent.id : null, anchor, oneOf(b.severity, SEVERITIES, "general"), text,
    pin ? pin.page : null, pin ? pin.x : null, pin ? pin.y : null, pin ? pin.quote : "", t);
  await run(env, "UPDATE reviews SET updated_at = ? WHERE id = ?", t, review.id);
  const told = new Set();
  if (role !== "requester") told.add(review.requester_id);
  if (parent) told.add(parent.author_id);
  for (const uid of told) {
    await notify(env, uid, "review", user.id, "review", review.id, `Commented on "${review.title}"`);
  }
  const users = await usersById(env, [user.id]);
  return commentShape(await one(env, "SELECT * FROM review_comments WHERE id = ?", commentId), users);
}

async function resolve(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const row = await one(env, "SELECT * FROM review_comments WHERE id = ?", str(ctx.params.id, 60));
  const review = row && await loadReview(env, row.review_id);
  const role = await reviewRole(env, user, review);
  if (!role) fail(404, "No such comment.");
  if (role !== "requester") fail(403, "Only the person who asked for the review can resolve comments.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const resolved = b.resolved === undefined ? 1 : (b.resolved ? 1 : 0);
  await run(env, "UPDATE review_comments SET resolved = ? WHERE id = ?", resolved, row.id);
  return { id: row.id, resolved: !!resolved };
}

async function submit(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { review } = await visible(ctx, user);
  const row = await reviewerRow(env, review.id, user.id);
  if (!row || !ACTIVE.includes(row.status)) fail(403, "Only a reviewer who accepted can submit a review.");
  if (review.status !== "open") fail(409, "This review is closed.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const recommendation = oneOf(b.recommendation, RECOMMENDATIONS, null);
  if (!recommendation) fail(400, "recommendation must be accept, minor, major or reject.");
  const summary = str(b.summary, 20000);
  if (!summary) fail(400, "Write a summary of your review.");
  const t = now();
  await run(env, "UPDATE reviewers SET status = 'submitted', recommendation = ?, summary = ?, submitted_at = ? WHERE review_id = ? AND user_id = ?",
    recommendation, summary, t, review.id, user.id);
  await run(env, "UPDATE reviews SET updated_at = ? WHERE id = ?", t, review.id);
  await notify(env, review.requester_id, "review", user.id, "review", review.id, `Submitted a review of "${review.title}"`);
  return { status: "submitted", recommendation, submitted_at: t };
}

async function patch(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { review, role } = await visible(ctx, user);
  if (role !== "requester") fail(403, "Only the person who asked for the review can change it.");
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const title = b.title !== undefined ? str(b.title, 300) : review.title;
  if (!title) fail(400, "A review request needs a title.");
  const status = b.status !== undefined ? oneOf(b.status, ["open", "closed"], review.status) : review.status;
  await run(env, "UPDATE reviews SET title = ?, abstract = ?, status = ?, due_at = ?, updated_at = ? WHERE id = ?",
    title, b.abstract !== undefined ? str(b.abstract, 5000) : review.abstract, status,
    b.due_at !== undefined ? int(b.due_at, null) : review.due_at, now(), review.id);
  return get(ctx);
}

export const routes = [
  ["POST", "/v1/reviews", create],
  ["GET", "/v1/reviews", list],
  ["GET", "/v1/reviews/:id", get],
  ["PATCH", "/v1/reviews/:id", patch],
  ["POST", "/v1/reviews/:id/invite", invite],
  ["POST", "/v1/reviews/:id/volunteer", volunteer],
  ["POST", "/v1/reviews/:id/respond", respond],
  ["POST", "/v1/reviews/:id/comments", comment],
  ["POST", "/v1/reviews/:id/submit", submit],
  ["POST", "/v1/review-comments/:id/resolve", resolve],
];
