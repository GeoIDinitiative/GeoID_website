/**
 * Reputation rewards contribution, not popularity.
 *
 * FOLLOWER COUNTS ARE NEVER AN INPUT, here or in the matcher: every number
 * below counts something a person made or did that others can open and check
 * (a dataset, an accepted answer, a submitted review), and each category
 * carries that evidence.
 *
 * BADGES are published criteria (GET /v1/badges) and an award stores the
 * evidence it was given for. /v1/badges/refresh re-checks the caller only, so
 * nobody can award themselves anything the rules do not already give them.
 */
import {
  fail, now, str, tags, parse, requireUser, currentUser, rateLimit, notify, publicUser, userByHandle,
} from "./lib.js";
import { body, all, one, run } from "./collab.js";
import { loadProject, projectRole } from "./projects.js";

export const BADGES = [
  { id: "open-data-contributor", name: "Open Data Contributor", description: "Shares data others can reuse.",
    criteria: "At least 1 public dataset post with an open licence." },
  { id: "reproducible-workflow", name: "Reproducible Workflow", description: "Wrote a workflow somebody else re-ran.",
    criteria: "A public workflow post forked by at least 1 other person and marked 'reproduced' by someone other than the author." },
  { id: "community-mentor", name: "Community Mentor", description: "Answers that solved other people's questions.",
    criteria: "At least 5 accepted answers on other people's questions." },
  { id: "peer-reviewer", name: "Peer Reviewer", description: "Reviews drafts for others.",
    criteria: "At least 3 submitted draft reviews." },
  { id: "field-observer", name: "Field Observer", description: "Observations the community has checked.",
    criteria: "At least 3 public observation posts that are community-verified (2 or more confirms, more confirms than disputes)." },
  { id: "verified-researcher", name: "Verified Researcher", description: "ORCID identity confirmed.",
    criteria: "ORCID iD verified by signing in with ORCID." },
];

const NOTE = "Suggestions explain themselves and are not a ranking of anybody's ability.";
const OPEN_LICENCE = "p.licence != '' AND p.licence != 'all-rights-reserved'";
const PUBLIC = "p.visibility = 'public' AND p.removed_at IS NULL";
// Community-verified, as lib/posts define it: confirms >= 2 and confirms > disputes.
const VERIFIED = `(SELECT COUNT(*) FROM verifications v WHERE v.post_id = p.id AND v.verdict = 'confirm') >= 2
  AND (SELECT COUNT(*) FROM verifications v WHERE v.post_id = p.id AND v.verdict = 'confirm')
    > (SELECT COUNT(*) FROM verifications v WHERE v.post_id = p.id AND v.verdict = 'dispute')`;
const EVIDENCE_MAX = 10;

const postEvidence = (rows) => rows.slice(0, EVIDENCE_MAX).map((r) => ({ type: "post", id: r.id, title: r.title || str(r.body, 80) }));

/** Each category: { id, label, count, evidence }. Public, checkable items only. */
async function categories(env, userId) {
  const q = (sql, ...binds) => all(env, sql, ...binds);
  const research = await q(`SELECT p.id, p.title, p.body FROM posts p WHERE p.author_id = ? AND ${PUBLIC}
    AND p.kind IN ('analysis', 'paper') AND p.sources_json NOT IN ('', '[]') ORDER BY p.created_at DESC`, userId);
  const data = await q(`SELECT p.id, p.title, p.body FROM posts p WHERE p.author_id = ? AND ${PUBLIC}
    AND p.kind IN ('dataset', 'workflow') ORDER BY p.created_at DESC`, userId);
  const reuse = await q(`SELECT f.id, f.title, f.body FROM posts f JOIN posts p ON p.id = f.forked_from
    WHERE p.author_id = ? AND f.author_id != ? AND f.visibility = 'public' AND f.removed_at IS NULL ORDER BY f.created_at DESC`, userId, userId);
  const answers = await q(`SELECT p.id, p.title, p.body FROM posts p JOIN comments c ON c.id = p.accepted_comment_id
    WHERE c.author_id = ? AND p.author_id != ? AND c.removed_at IS NULL AND ${PUBLIC} ORDER BY p.created_at DESC`, userId, userId);
  const reviews = await q(`SELECT r.id, r.title, r.visibility FROM reviewers rv JOIN reviews r ON r.id = rv.review_id
    WHERE rv.user_id = ? AND rv.status = 'submitted' ORDER BY rv.submitted_at DESC`, userId);
  const observations = await q(`SELECT p.id, p.title, p.body FROM posts p WHERE p.author_id = ? AND ${PUBLIC}
    AND p.kind = 'observation' AND ${VERIFIED} ORDER BY p.created_at DESC`, userId);
  const teaching = await q(`SELECT DISTINCT p.id, p.title, p.body, p.created_at FROM posts p JOIN post_tags t ON t.post_id = p.id
    WHERE p.author_id = ? AND ${PUBLIC} AND t.tag IN ('education', 'tutorial') ORDER BY p.created_at DESC`, userId);
  const mentoring = await q(`SELECT DISTINCT p.id, p.title, p.body, p.created_at FROM comments c JOIN posts p ON p.id = c.post_id
    JOIN communities cm ON cm.id = p.community_id
    WHERE c.author_id = ? AND p.author_id != ? AND c.removed_at IS NULL AND cm.slug = 'careers' AND ${PUBLIC}
    ORDER BY p.created_at DESC`, userId, userId);
  return [
    { id: "research", label: "Research", rows: research },
    { id: "datasets_workflows", label: "Datasets and workflows", rows: data },
    { id: "reuse", label: "Reused by others", rows: reuse },
    { id: "answers", label: "Accepted answers", rows: answers },
    {
      id: "reviews", label: "Draft reviews", rows: reviews,
      // A draft under private review is not public: count it, but do not name it.
      evidence: reviews.slice(0, EVIDENCE_MAX).map((r) => ({ type: "review", id: r.visibility === "open" ? r.id : null,
        title: r.visibility === "open" ? r.title : "A review of a draft shared privately" })),
    },
    { id: "observations", label: "Verified observations", rows: observations },
    { id: "teaching", label: "Teaching", rows: teaching },
    { id: "mentoring", label: "Mentoring (careers community)", rows: mentoring },
  ].map((c) => ({ id: c.id, label: c.label, count: c.rows.length, evidence: c.evidence || postEvidence(c.rows) }));
}

/** Which badges `user` has earned now: { badgeId: evidence } . */
async function earned(env, user) {
  const out = {};
  const ids = (rows) => rows.map((r) => r.id);
  const data = await all(env, `SELECT p.id FROM posts p WHERE p.author_id = ? AND ${PUBLIC} AND p.kind = 'dataset' AND ${OPEN_LICENCE}`, user.id);
  if (data.length >= 1) out["open-data-contributor"] = { posts: ids(data).slice(0, EVIDENCE_MAX) };
  const workflows = await all(env, `SELECT p.id FROM posts p WHERE p.author_id = ? AND ${PUBLIC} AND p.kind = 'workflow'
    AND EXISTS (SELECT 1 FROM posts f WHERE f.forked_from = p.id AND f.author_id != p.author_id AND f.removed_at IS NULL)
    AND EXISTS (SELECT 1 FROM reactions r WHERE r.post_id = p.id AND r.kind = 'reproduced' AND r.user_id != p.author_id)`, user.id);
  if (workflows.length >= 1) out["reproducible-workflow"] = { posts: ids(workflows).slice(0, EVIDENCE_MAX) };
  const answers = await all(env, `SELECT c.id, p.id AS post_id FROM posts p JOIN comments c ON c.id = p.accepted_comment_id
    WHERE c.author_id = ? AND p.author_id != ? AND c.removed_at IS NULL AND p.removed_at IS NULL`, user.id, user.id);
  if (answers.length >= 5) out["community-mentor"] = { comments: ids(answers).slice(0, EVIDENCE_MAX), count: answers.length };
  const reviews = await all(env, "SELECT review_id AS id FROM reviewers WHERE user_id = ? AND status = 'submitted'", user.id);
  if (reviews.length >= 3) out["peer-reviewer"] = { reviews: reviews.length };
  const obs = await all(env, `SELECT p.id FROM posts p WHERE p.author_id = ? AND ${PUBLIC} AND p.kind = 'observation' AND ${VERIFIED}`, user.id);
  if (obs.length >= 3) out["field-observer"] = { posts: ids(obs).slice(0, EVIDENCE_MAX), count: obs.length };
  if (user.orcid_verified) out["verified-researcher"] = { orcid: user.orcid || true };
  return out;
}

/** A person's current (not revoked) badges, for profiles.js and this module. */
export async function badgesOf(env, userId) {
  const rows = await all(env, "SELECT * FROM badges WHERE user_id = ? AND revoked_at IS NULL ORDER BY awarded_at", userId);
  const byId = Object.fromEntries(BADGES.map((b) => [b.id, b]));
  return rows.filter((r) => byId[r.badge]).map((r) => ({
    id: r.badge, name: byId[r.badge].name, description: byId[r.badge].description,
    awarded_at: r.awarded_at, evidence: parse(r.evidence_json, {}),
  }));
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function listBadges() {
  return { items: BADGES, next: null };
}

async function reputation(ctx) {
  const { env } = ctx;
  await currentUser(ctx);
  const user = await userByHandle(env, ctx.params.handle);
  if (!user) fail(404, "No one has that handle.");
  return { user: publicUser(env, user), categories: await categories(env, user.id), badges: await badgesOf(env, user.id) };
}

async function refresh(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const have = Object.fromEntries((await all(env, "SELECT * FROM badges WHERE user_id = ?", user.id)).map((r) => [r.badge, r]));
  const now_ = now();
  const won = await earned(env, user);
  const awarded = [];
  const revoked = [];
  for (const badge of BADGES) {
    const evidence = won[badge.id];
    const row = have[badge.id];
    if (evidence) {
      if (!row || row.revoked_at) {
        await run(env,
          `INSERT INTO badges (user_id, badge, evidence_json, awarded_at, revoked_at) VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(user_id, badge) DO UPDATE SET evidence_json = excluded.evidence_json, awarded_at = excluded.awarded_at, revoked_at = NULL`,
          user.id, badge.id, JSON.stringify(evidence), now_);
        awarded.push(badge.id);
        await notify(env, user.id, "badge", null, "badge", badge.id, `You earned the ${badge.name} badge`);
      } else {
        await run(env, "UPDATE badges SET evidence_json = ? WHERE user_id = ? AND badge = ?", JSON.stringify(evidence), user.id, badge.id);
      }
    } else if (row && !row.revoked_at) {
      // The evidence went away (a dataset deleted, a verification withdrawn):
      // the badge goes with it, kept as a revoked row so the history is there.
      await run(env, "UPDATE badges SET revoked_at = ? WHERE user_id = ? AND badge = ?", now_, user.id, badge.id);
      revoked.push(badge.id);
    }
  }
  return { badges: await badgesOf(env, user.id), awarded, revoked };
}

const KIND_PLURAL = { analysis: ["analysis", "analyses"], dataset: ["dataset", "datasets"], workflow: ["workflow", "workflows"],
  paper: ["paper", "papers"], observation: ["observation", "observations"], monitor: ["monitor", "monitors"] };
const plural = (n, one_, many) => `${n} ${n === 1 ? one_ : many}`;

/**
 * The collaboration matcher. Only people who opted in (match_opt_in = 1) and
 * are not closed to collaboration, never the caller, never either side of a
 * block, never a suspended account. Every suggestion carries its reasons,
 * each saying whether it is self-declared or documented by public work, and
 * the order is by how many reasons there are -- not by followers, reactions
 * or anything else that measures popularity.
 */
async function match(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  let skills = tags(b.skills);
  let topics = tags(b.topic ? String(b.topic).split(/[,\s]+/) : []);
  const region = str(b.region, 80).toLowerCase();
  if (b.project_id) {
    const project = await loadProject(env, b.project_id);
    if (!(await projectRole(env, user, project))) fail(404, "No such project.");
    skills = tags([...skills, ...parse(project.needs_skills_json, [])]);
    topics = tags([...topics, ...parse(project.tags_json, [])]);
  }
  if (!skills.length && !topics.length && !region) fail(400, "Say what you need: skills, a topic or a region.");

  const candidates = await all(env,
    `SELECT * FROM users WHERE match_opt_in = 1 AND availability != 'closed' AND id != ? AND suspended_until <= ?
       AND id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?) AND id NOT IN (SELECT user_id FROM blocks WHERE blocked_id = ?)
     LIMIT 2000`, user.id, now(), user.id, user.id);
  if (!candidates.length) return { items: [], note: NOTE };
  const reasons = Object.fromEntries(candidates.map((c) => [c.id, []]));
  const add = (uid, text) => { if (reasons[uid]) reasons[uid].push(text); };

  const words = [...new Set([...skills, ...topics])];
  const marks = words.map(() => "?").join(",");
  // Documented evidence, one grouped query each, all public and live.
  const posted = words.length ? await all(env,
    `SELECT p.author_id, p.kind, t.tag, COUNT(*) AS n FROM posts p JOIN post_tags t ON t.post_id = p.id
     WHERE t.tag IN (${marks}) AND ${PUBLIC} GROUP BY p.author_id, p.kind, t.tag`, ...words) : [];
  const reviewed = words.length ? await all(env,
    `SELECT rv.user_id, je.value AS tag, COUNT(*) AS n FROM reviewers rv JOIN reviews r ON r.id = rv.review_id, json_each(r.expertise_json) je
     WHERE rv.status = 'submitted' AND je.value IN (${marks}) GROUP BY rv.user_id, je.value`, ...words) : [];
  const answered = words.length ? await all(env,
    `SELECT c.author_id, t.tag, COUNT(*) AS n FROM posts p JOIN comments c ON c.id = p.accepted_comment_id
     JOIN post_tags t ON t.post_id = p.id WHERE t.tag IN (${marks}) AND c.removed_at IS NULL AND ${PUBLIC}
     GROUP BY c.author_id, t.tag`, ...words) : [];

  for (const c of candidates) {
    const declared = parse(c.skills_json, []).map((s) => String(s).toLowerCase());
    const interests = parse(c.interests_json, []).map((s) => String(s).toLowerCase());
    for (const s of skills) if (declared.includes(s)) add(c.id, `Lists ${s} as a skill (self-declared)`);
    for (const t of topics) if (interests.includes(t)) add(c.id, `Lists ${t} as an interest (self-declared)`);
    if (region && parse(c.regions_json, []).some((r) => String(r).toLowerCase().includes(region))) {
      add(c.id, `Lists ${str(b.region, 80)} as a region of expertise (self-declared)`);
    }
  }
  for (const r of posted) {
    const [one_, many] = KIND_PLURAL[r.kind] || ["post", "posts"];
    add(r.author_id, `Posted ${plural(r.n, one_, many)} tagged ${r.tag} (documented)`);
  }
  for (const r of reviewed) add(r.user_id, `Submitted ${plural(r.n, "review", "reviews")} in ${r.tag} (documented)`);
  for (const r of answered) add(r.author_id, `Gave ${plural(r.n, "accepted answer", "accepted answers")} on ${r.tag} questions (documented)`);

  const items = candidates
    .filter((c) => reasons[c.id].length)
    .map((c) => ({ user: publicUser(env, c), availability: c.availability, reasons: reasons[c.id] }))
    // Ties break on handle so the order is reproducible and says nothing more.
    .sort((x, y) => y.reasons.length - x.reasons.length || x.user.handle.localeCompare(y.user.handle))
    .slice(0, 20);
  return { items, note: NOTE };
}

export const routes = [
  ["GET", "/v1/badges", listBadges],
  ["POST", "/v1/badges/refresh", refresh],
  ["GET", "/v1/users/:handle/reputation", reputation],
  ["POST", "/v1/match", match],
];
