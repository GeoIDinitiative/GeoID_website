/**
 * Trust, once the Network has traffic.
 *
 *   - Recruitment scams: an opportunity from a new, unverified account that
 *     reads like one (contact me on WhatsApp, a registration fee, send your
 *     passport...), or a burst of them, is HELD: kept private to its author,
 *     with its intended visibility remembered, until a moderator approves or
 *     rejects it. Imported adverts, admins and verified organisations are
 *     never held.
 *   - Response times: each report reason has a target the moderators work
 *     to (RESPONSE_HOURS); the queue shows what is due and what is overdue,
 *     and the code of conduct publishes the same numbers.
 *   - Verified employers: an opportunity posted as a verified organisation
 *     carries that, on the card and the post (posts.js shapePosts).
 */
import { now, fail, requireUser, isAdmin, readJson, str, parse, notify, audit, usersById, publicPost } from "./lib.js";
import { all, one, run } from "./collab.js";

const DAY = 86400;
/** How fast moderators answer a report, by reason (hours). The code of conduct says the same. */
export const RESPONSE_HOURS = { harassment: 24, privacy: 24, "unsafe-location": 24, spam: 48, misinformation: 72, copyright: 72, other: 72 };
export const dueAt = (r) => r.created_at + (RESPONSE_HOURS[r.reason] || 72) * 3600;

const SCAM = [
  [/\b(whats\s?app|telegram|signal|wechat)\b/i, "asks to move to a chat app"],
  [/\b(registration|processing|training|application|visa)\s+fees?\b|\bpay\s+(a|the|an)\s+\w*\s*fee\b/i, "asks the applicant to pay"],
  [/\b(send|share|upload)\s+(us\s+)?(your\s+)?(passport|bank|id card|national insurance|social security)/i, "asks for identity or bank documents"],
  [/\b(bitcoin|crypto|usdt|gift\s?cards?)\b/i, "mentions crypto or gift cards"],
  [/\b(earn|make)\s+[$£€]\s?\d+[\d,]*\s*(\+\s*)?(per|a|each)\s+(day|week|hour)\b/i, "promises fixed earnings"],
  [/\bno (experience|qualifications?) (needed|required)\b.*\b(geolog|scien)/i, "no experience for a specialist role"],
  [/\b[\w.+-]+@(gmail|yahoo|hotmail|outlook|proton(mail)?)\.(com|me)\b/i, "a personal email address for an employer"],
];
const NEW_ACCOUNT = 7 * DAY;
const BURST = 3;          // opportunities a day before the rest wait

/** Why an opportunity should wait for a moderator ([] when it need not). */
export async function holdReasons(env, user, row, { org = null, t = now() } = {}) {
  if (row.kind !== "opportunity" || isAdmin(env, user) || org?.verified) return [];
  const meta = parse(row.meta_json, {});
  if (meta.imported) return [];
  const text = `${row.title}\n${row.body}\n${meta.apply_url || ""}\n${meta.org || ""}`;
  const reasons = SCAM.filter(([re]) => re.test(text)).map(([, why]) => why);
  const isNew = t - (user.created_at || 0) < NEW_ACCOUNT;
  const vouched = !!user.orcid_verified || !!(await one(env, "SELECT 1 FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? AND m.verified = 1 AND o.verified = 1", user.id));
  const today = (await one(env, "SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND kind = 'opportunity' AND created_at > ?", user.id, t - DAY))?.n || 0;
  if (today >= BURST) reasons.push(`more than ${BURST} opportunities in a day`);
  // One signal from an established or vouched-for member is not enough; any from a new, unknown account is.
  if (reasons.length >= 2 || (reasons.length && isNew && !vouched)) return reasons;
  return [];
}

/** Hold a row about to be stored: private to its author until a moderator decides. */
export function hold(row, reasons, t = now()) {
  const meta = parse(row.meta_json, {});
  meta.held_visibility = row.visibility;
  return { ...row, visibility: "private", meta_json: JSON.stringify(meta), held_at: t, held_reasons: reasons.join("; ") };
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function heldList(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  if (!isAdmin(env, user)) fail(403, "Admins only.");
  const rows = await all(env, "SELECT * FROM posts WHERE held_at IS NOT NULL AND removed_at IS NULL ORDER BY held_at ASC LIMIT 100");
  const authors = await usersById(env, rows.map((r) => r.author_id));
  return { items: rows.map((r) => ({ ...publicPost(env, r, authors), held_at: r.held_at, held_reasons: r.held_reasons, wanted: parse(r.meta_json, {}).held_visibility || "public" })) };
}

async function decide(ctx) {
  const env = ctx.env;
  const user = await requireUser(ctx);
  if (!isAdmin(env, user)) fail(403, "Admins only.");
  const post = await one(env, "SELECT * FROM posts WHERE id = ? AND held_at IS NOT NULL", ctx.params.id);
  if (!post) fail(404, "Not found.");
  const b = await readJson(ctx.request);
  const meta = parse(post.meta_json, {});
  const wanted = meta.held_visibility || "public";
  delete meta.held_visibility;
  const t = now();
  if (b.approve) {
    await run(env, "UPDATE posts SET visibility = ?, meta_json = ?, held_at = NULL, held_reasons = '', updated_at = ? WHERE id = ?", wanted, JSON.stringify(meta), t, post.id);
    await notify(env, post.author_id, "moderation", user.id, "post", post.id, "Your opportunity was checked and is now published.");
  } else {
    await run(env, "UPDATE posts SET removed_at = ?, removed_by = ?, held_at = NULL WHERE id = ?", t, user.id, post.id);
    await notify(env, post.author_id, "moderation", user.id, "post", post.id, `Your opportunity was not published${b.note ? `: ${str(b.note, 160)}` : "."}`);
  }
  await audit(env, user.id, b.approve ? "held.approve" : "held.reject", "post", post.id, { reasons: post.held_reasons, note: str(b.note, 300) });
  return { ok: true };
}

export const routes = [
  ["GET", "/v1/mod/held", heldList],
  ["POST", "/v1/mod/held/:id", decide],
];
