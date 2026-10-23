/**
 * Email: a daily digest of unread notifications, immediate mail for the
 * kinds a member chose, and a one-click way out of all of it.
 *
 * NOTHING IS SENT FROM A REQUEST. notify() in lib.js only adds a row to
 * mail_queue for the kinds that may be mailed at once; the 15-minute cron
 * (cron.js) reads the member's choice and sends. So a burst of notifications
 * costs one INSERT each, a member reading the message in the app before the
 * cron runs gets no mail about it, and several notifications become one email.
 *
 * WHAT AN EMAIL MAY SAY. It is composed at send time from the notification
 * row, never from what was queued, and it says no more than the recipient can
 * see right now in the app: a message's body never goes into an email (only
 * who wrote), a post that is not public contributes its title alone, and a
 * post the recipient can no longer see contributes nothing. Other people's
 * email addresses never appear; the only address used is the recipient's own,
 * in the To: line.
 *
 * GATED ON RESEND_API_KEY + MAIL_FROM. Without both, immediate rows stay
 * queued (and expire into the next digest after a day) and digests are not
 * composed; nothing leaves the Worker.
 */
import {
  fail, now, id, str, parse, sign, verify, requireUser, rateLimit, readJson, canSeePost, blockedBetween,
} from "./lib.js";
import { all, one, run } from "./collab.js";

/** Kinds a member may have mailed as they happen, with the words Settings shows. */
export const IMMEDIATE_KINDS = [
  ["message", "New messages"],
  ["invite", "Invitations to teams and communities"],
  ["grant", "A project is shared with you"],
  ["review", "Peer review requests and replies"],
  ["mention", "Someone mentions you"],
  ["request", "Collaboration requests"],
  ["mentoring", "Mentoring requests"],
  ["event", "Events: reminders, a place opening up, replies to yours"],
];
export const IMMEDIATE_IDS = IMMEDIATE_KINDS.map(([k]) => k);
export const DEFAULT_IMMEDIATE = ["message", "invite"];

/**
 * Other tracks may name a kind differently ("collab_request"); each maps to
 * the one choice a member sees, so a new spelling cannot slip past a member's
 * "no" by not being on the list. lib.js MAIL_NOW_KINDS must hold every key
 * and value here (a test checks).
 */
export const KIND_ALIAS = {
  collab_request: "request", collaboration_request: "request", collaboration: "request",
  mentor: "mentoring", mentor_request: "mentoring", mentorship: "mentoring",
  event_reminder: "event", reminder: "event",
  team_invite: "invite", review_invite: "review",
};
export const mailKind = (kind) => KIND_ALIAS[kind] || kind;

const DAY = 86400;
const MIN_AGE = 120;              // let a member who is in the app read it there first
const IMMEDIATE_TTL = DAY;        // older queued rows go into the digest instead
const DIGEST_GAP = 20 * 3600;     // at most one digest per ~day
const DIGEST_WINDOW = 7 * DAY;    // a digest never reaches further back than a week
const DIGEST_ITEMS = 25;
const EMAILS_PER_RUN = 40;        // a cron run stays well inside its subrequest budget

export const mailConfigured = (env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);

// ── Signed links ───────────────────────────────────────────────────────────

/**
 * The unsubscribe key is the social secret with a suffix of its own, so a
 * mail token is no use as a sign-in token (different key AND audience) and
 * the other way round.
 */
function mailSecret(env) {
  const base = env.SOCIAL_JWT_SECRET || env.JWT_SECRET;
  return base ? `${base}\u0000mail` : "";
}

/** A link that turns off all GeoID Network email for `userId`, valid two years. */
export async function unsubscribeToken(env, userId, t = now()) {
  const secret = mailSecret(env);
  if (!secret) return "";
  return sign({ aud: "mail", act: "unsubscribe", sub: userId, exp: t + 2 * 365 * DAY }, secret);
}

export async function readUnsubscribeToken(env, token) {
  const payload = await verify(token, mailSecret(env), { audience: "mail" });
  return payload && payload.act === "unsubscribe" && payload.sub ? payload : null;
}

// ── Preferences ────────────────────────────────────────────────────────────

/** The member's choice, with the defaults for somebody who never made one. */
export async function prefsOf(env, userId) {
  const row = await one(env, "SELECT * FROM mail_prefs WHERE user_id = ?", userId);
  const immediate = row ? parse(row.immediate_json, []).filter((k) => IMMEDIATE_IDS.includes(k)) : [...DEFAULT_IMMEDIATE];
  const digest = row ? !!row.digest : true;
  return {
    digest,
    immediate,
    mode: !digest && !immediate.length ? "off" : immediate.length ? "immediate" : "digest",
    unsubscribed: !!(row && row.unsubscribed_at),
    last_digest_at: row ? row.last_digest_at : 0,
  };
}

async function savePrefs(env, userId, { digest, immediate, unsubscribed = false }, t = now()) {
  await run(env,
    `INSERT INTO mail_prefs (user_id, digest, immediate_json, unsubscribed_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET digest = excluded.digest, immediate_json = excluded.immediate_json,
       unsubscribed_at = excluded.unsubscribed_at, updated_at = excluded.updated_at`,
    userId, digest ? 1 : 0, JSON.stringify(immediate), unsubscribed ? t : null, t);
}

// ── Composing ──────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function siteLink(env, hash) {
  return `${String(env.SITE_ORIGIN || "https://geoidinitiative.com").replace(/\/$/, "")}/social/${hash}`;
}

/** Where a notification opens in the app; mirrors REF_ROUTES in social/js/views/inbox.js. */
export function refHash(refType, refId, recipientHandle = "") {
  const e = encodeURIComponent(refId || "");
  switch (refType) {
    case "post": case "comment": return `#/post/${e}`;
    case "user": return `#/u/${e}`;
    case "project": return `#/p/${e}`;
    case "review": return `#/r/${e}`;
    case "team": return `#/t/${e}`;
    case "community": return `#/c/${e}`;
    case "conversation": return `#/messages/${e}`;
    case "badge": return recipientHandle ? `#/u/${encodeURIComponent(recipientHandle)}` : "#/notifications";
    case "event": return "#/events";
    case "request": return `#/requests/${e}`;
    default: return "#/notifications";
  }
}

const PHRASE = {
  follow: "started following you", comment: "commented", reaction: "reacted to your post", mention: "mentioned you",
  invite: "sent you an invitation", grant: "shared a project with you", review: "has news about a peer review",
  message: "sent you a message", fork: "forked your work", verify: "checked your observation",
  moderation: "Moderation notice", badge: "You earned a badge", project_update: "updated something you follow",
  request: "sent you a collaboration request", mentoring: "sent you a mentoring request", event: "Event reminder",
};

/**
 * One notification as a line of an email: { text, href, kind } -- or null
 * when it should not be mailed at all (the actor is now blocked). Applies the
 * rules in the header comment: no message bodies, titles only for posts that
 * are not public, nothing for posts the recipient cannot see.
 */
export async function describe(env, recipient, n, actorsById = {}) {
  if (n.actor_id && await blockedBetween(env, recipient.id, n.actor_id)) return null;
  const actor = n.actor_id ? actorsById[n.actor_id] : null;
  const kind = mailKind(n.kind);
  const who = actor ? (actor.name || `@${actor.handle}`) : "";
  const phrase = PHRASE[kind] || "sent you a notification";
  let detail = "";
  if (kind === "message") {
    detail = "";
  } else if (n.ref_type === "post" || n.ref_type === "comment") {
    const post = n.ref_type === "post"
      ? await one(env, "SELECT * FROM posts WHERE id = ?", n.ref_id)
      : await one(env, "SELECT p.* FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?", n.ref_id);
    if (post && await canSeePost(env, recipient, post)) {
      detail = post.visibility === "public" || post.visibility === "unlisted" ? str(n.text, 200) : str(post.title, 120);
    }
  } else {
    // Team, community, project, review, badge and event texts are written by
    // the server from names and titles the invitation or grant itself shows.
    detail = str(n.text, 200);
  }
  const lead = who ? `${who} ${phrase}` : phrase;
  // The detail often repeats the actor's name ("Ana commented on X"); say it once.
  const text = detail ? (who && detail.startsWith(who) ? detail : `${lead}: ${detail}`) : lead;
  return { text, href: siteLink(env, refHash(n.ref_type, n.ref_id, recipient.handle)), kind };
}

/**
 * Plain, accessible HTML and its text twin. One column, a real heading and
 * list, link text that says where it goes, system fonts, no images, no
 * tracking pixels, contrast above 7:1.
 */
export function layout({ heading, intro, lines, settingsUrl, unsubscribeUrl, footer }) {
  const items = lines.map((l) =>
    `<li style="margin:0 0 12px 0"><a href="${esc(l.href)}" style="color:#0b4f8a">${esc(l.text)}</a></li>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font:16px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto">
<p style="margin:0 0 16px 0;font-weight:600;letter-spacing:.02em">GeoID Network</p>
<h1 style="font-size:20px;margin:0 0 12px 0">${esc(heading)}</h1>
${intro ? `<p style="margin:0 0 16px 0">${esc(intro)}</p>` : ""}
<ul style="padding-left:20px;margin:0 0 24px 0">${items}</ul>
<hr style="border:0;border-top:1px solid #d0d0d0;margin:24px 0">
<p style="font-size:14px;color:#444444;margin:0 0 8px 0">${esc(footer)}</p>
<p style="font-size:14px;color:#444444;margin:0"><a href="${esc(settingsUrl)}" style="color:#0b4f8a">Choose which emails you get</a> · <a href="${esc(unsubscribeUrl)}" style="color:#0b4f8a">Unsubscribe from all GeoID Network email</a></p>
</div></body></html>`;
  const text = [
    "GeoID Network", "", heading, "", ...(intro ? [intro, ""] : []),
    ...lines.flatMap((l) => [`- ${l.text}`, `  ${l.href}`]),
    "", "--", footer,
    `Choose which emails you get: ${settingsUrl}`,
    `Unsubscribe from all GeoID Network email: ${unsubscribeUrl}`,
  ].join("\n");
  return { html, text };
}

async function envelope(env, user, { subject, heading, intro, lines, footer }) {
  const token = await unsubscribeToken(env, user.id);
  // No working way out, no mail: the secret is what signs the link.
  if (!token) return null;
  const unsubscribeUrl = `${String(env.SELF_ORIGIN || "").replace(/\/$/, "")}/v1/mail/unsubscribe?t=${encodeURIComponent(token)}`;
  const { html, text } = layout({ heading, intro, lines, settingsUrl: siteLink(env, "#/settings"), unsubscribeUrl, footer });
  return {
    to: user.email, subject, html, text,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

/** The email for notifications mailed as they happened. */
export async function composeImmediate(env, user, lines) {
  const subject = lines.length === 1 ? str(lines[0].text, 120) : `${lines.length} new notifications on GeoID Network`;
  return envelope(env, user, {
    subject,
    heading: lines.length === 1 ? "You have a new notification" : `You have ${lines.length} new notifications`,
    intro: "",
    lines,
    footer: "You get this email because you asked to hear about these straight away.",
  });
}

/** The daily digest; `more` is how many unread notifications did not fit. */
export async function composeDigest(env, user, lines, more = 0) {
  const total = lines.length + more;
  return envelope(env, user, {
    subject: `Your GeoID Network digest: ${total} unread notification${total === 1 ? "" : "s"}`,
    heading: "While you were away",
    intro: more ? `The latest ${lines.length} of ${total} unread notifications:` : "",
    lines: more ? [...lines, { text: `See all ${total} notifications`, href: siteLink(env, "#/notifications?unread=1") }] : lines,
    footer: "You get this daily digest when you have unread notifications. Reading them in the app stops them being mailed.",
  });
}

/** One email through Resend. Throws on a refusal so the caller can count it. */
export async function sendEmail(env, mail, { idempotencyKey = "", fetchImpl = fetch } = {}) {
  const headers = { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const r = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers,
    }),
  });
  if (!r.ok) throw new Error(`The mail service answered ${r.status}.`);
  return true;
}

async function actorsOf(env, rows) {
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
  if (!ids.length) return {};
  const found = await all(env, `SELECT id, handle, name FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  return Object.fromEntries(found.map((u) => [u.id, u]));
}

const marks = (ids) => ids.map(() => "?").join(",");

// ── The jobs (called from cron.js) ─────────────────────────────────────────

/**
 * Send what is queued. Rows are grouped per member into one email; message
 * rows for the same conversation become one line. Returns counts for the log.
 */
export async function flushQueue(env, t = now(), { fetchImpl = fetch, limit = 200 } = {}) {
  const out = { sent: 0, skipped: 0, expired: 0, failed: 0, held: 0 };
  const expired = await run(env,
    "UPDATE mail_queue SET status = 'expired' WHERE status = 'queued' AND kind != 'digest' AND created_at < ?", t - IMMEDIATE_TTL);
  out.expired = Number(expired?.meta?.changes || 0);
  if (!mailConfigured(env)) {
    out.held = (await one(env, "SELECT COUNT(*) AS n FROM mail_queue WHERE status = 'queued'"))?.n || 0;
    return out;
  }
  const rows = await all(env,
    `SELECT q.id AS qid, q.user_id, q.kind AS qkind, n.id, n.kind, n.actor_id, n.ref_type, n.ref_id, n.text, n.read, n.created_at
       FROM mail_queue q LEFT JOIN notifications n ON n.id = q.notification_id
      WHERE q.status = 'queued' AND q.kind != 'digest' AND q.created_at <= ?
      ORDER BY q.created_at LIMIT ?`, t - MIN_AGE, limit);
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  const skipRows = async (ids) => {
    if (!ids.length) return;
    await run(env, `UPDATE mail_queue SET status = 'skipped' WHERE id IN (${marks(ids)})`, ...ids);
    out.skipped += ids.length;
  };
  let emails = 0;
  for (const [userId, list] of byUser) {
    if (emails >= EMAILS_PER_RUN) break;
    const user = await one(env, "SELECT id, email, handle, name FROM users WHERE id = ?", userId);
    const prefs = user ? await prefsOf(env, userId) : null;
    const keep = [];
    const skip = [];
    for (const r of list) {
      const wanted = !!user && !String(user.email).startsWith("erased:") && prefs.immediate.includes(mailKind(r.qkind));
      // Already read in the app, or a message the member has since read in its thread.
      let stale = !r.id || !!r.read;
      if (!stale && r.ref_type === "conversation") {
        const cm = await one(env, "SELECT last_read, status FROM conversation_members WHERE conversation_id = ? AND user_id = ?", r.ref_id, userId);
        stale = !cm || cm.status === "left" || cm.last_read >= r.created_at;
      }
      if (wanted && !stale) keep.push(r);
      else skip.push(r.qid);
    }
    await skipRows(skip);
    if (!keep.length) continue;
    const actors = await actorsOf(env, keep);
    const lines = [];
    const used = [];
    const threads = new Map();
    for (const r of keep) {
      const line = await describe(env, user, r, actors);
      if (!line) { await skipRows([r.qid]); continue; }
      used.push(r.qid);
      if (r.ref_type === "conversation") {
        const prior = threads.get(r.ref_id);
        if (prior) { prior.count += 1; prior.line.text = `${prior.base} (${prior.count} messages)`; continue; }
        threads.set(r.ref_id, { line, base: line.text, count: 1 });
      }
      lines.push(line);
    }
    if (!lines.length) continue;
    const mail = await composeImmediate(env, user, lines);
    if (!mail) { out.held += used.length; continue; }
    emails += 1;
    try {
      await sendEmail(env, mail, { idempotencyKey: `q-${used[0]}`, fetchImpl });
      await run(env, `UPDATE mail_queue SET status = 'sent', sent_at = ? WHERE id IN (${marks(used)})`, t, ...used);
      out.sent += 1;
    } catch (error) {
      // Three tries, one per cron run; after that the digest carries it.
      await run(env, `UPDATE mail_queue SET attempts = attempts + 1, error = ?,
        status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'queued' END
        WHERE id IN (${marks(used)})`, str(error.message, 200), ...used);
      out.failed += 1;
    }
  }
  return out;
}

/**
 * Daily digests for members who want one and have unread notifications they
 * have not already been mailed. `limit` members per run; the rest are still
 * due on the next run, so a big day spreads over a few ticks.
 */
export async function sendDigests(env, t = now(), { fetchImpl = fetch, limit = EMAILS_PER_RUN } = {}) {
  const out = { sent: 0, empty: 0, failed: 0, held: 0 };
  if (!mailConfigured(env)) return { ...out, held: -1 };
  const due = await all(env,
    `SELECT u.id, u.email, u.handle, u.name, COALESCE(mp.last_digest_at, 0) AS last
       FROM users u LEFT JOIN mail_prefs mp ON mp.user_id = u.id
      WHERE COALESCE(mp.digest, 1) = 1 AND u.email NOT LIKE 'erased:%' AND u.suspended_until <= ?
        AND COALESCE(mp.last_digest_at, 0) <= ?
        AND EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.read = 0
              AND n.created_at > COALESCE(mp.last_digest_at, 0) AND n.created_at > ?)
        AND NOT EXISTS (SELECT 1 FROM mail_queue q WHERE q.user_id = u.id AND q.kind = 'digest'
              AND q.status = 'failed' AND q.created_at > ?)
      LIMIT ?`, t, t - DIGEST_GAP, t - DIGEST_WINDOW, t - 3600, limit);
  for (const user of due) {
    const since = Math.max(user.last, t - DIGEST_WINDOW);
    const where = `n.user_id = ? AND n.read = 0 AND n.created_at > ? AND n.created_at <= ?
      AND NOT EXISTS (SELECT 1 FROM mail_queue q WHERE q.notification_id = n.id AND q.status = 'sent')`;
    const rows = await all(env, `SELECT n.* FROM notifications n WHERE ${where} ORDER BY n.created_at DESC LIMIT ?`,
      user.id, since, t, DIGEST_ITEMS);
    const total = (await one(env, `SELECT COUNT(*) AS n FROM notifications n WHERE ${where}`, user.id, since, t))?.n || 0;
    const actors = await actorsOf(env, rows);
    const lines = [];
    for (const r of rows) {
      const line = await describe(env, user, r, actors);
      if (line) lines.push(line);
    }
    const stamp = () => run(env,
      `INSERT INTO mail_prefs (user_id, last_digest_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_digest_at = excluded.last_digest_at`, user.id, t, t);
    if (!lines.length) { await stamp(); out.empty += 1; continue; }
    const mail = await composeDigest(env, user, lines, Math.max(0, total - rows.length));
    if (!mail) { out.held += 1; continue; }
    const logId = id("mq");
    try {
      await sendEmail(env, mail, { idempotencyKey: `d-${user.id}-${Math.floor(t / DAY)}`, fetchImpl });
      await stamp();
      await run(env, "INSERT INTO mail_queue (id, user_id, kind, status, created_at, sent_at) VALUES (?, ?, 'digest', 'sent', ?, ?)",
        logId, user.id, t, t);
      out.sent += 1;
    } catch (error) {
      await run(env, "INSERT INTO mail_queue (id, user_id, kind, status, error, attempts, created_at) VALUES (?, ?, 'digest', 'failed', ?, 1, ?)",
        logId, user.id, str(error.message, 200), t);
      out.failed += 1;
    }
  }
  return out;
}

/** Bookkeeping older than a month goes; queued rows are handled by flushQueue. */
export async function pruneMail(env, t = now()) {
  const r = await run(env, "DELETE FROM mail_queue WHERE status != 'queued' AND created_at < ?", t - 30 * DAY);
  return Number(r?.meta?.changes || 0);
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function shape(env, userId) {
  const p = await prefsOf(env, userId);
  return {
    digest: p.digest, immediate: p.immediate, mode: p.mode, unsubscribed: p.unsubscribed,
    kinds: IMMEDIATE_KINDS.map(([k, label]) => ({ id: k, label })),
    defaults: { digest: true, immediate: DEFAULT_IMMEDIATE },
    sending: mailConfigured(env),
  };
}

async function getPrefs(ctx) {
  const user = await requireUser(ctx);
  return shape(ctx.env, user.id);
}

async function patchPrefs(ctx) {
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await readJson(ctx.request);
  const cur = await prefsOf(ctx.env, user.id);
  let digest = cur.digest;
  let immediate = cur.immediate;
  if (b.mode !== undefined) {
    if (!["off", "digest", "immediate"].includes(b.mode)) fail(400, "mode must be one of: off, digest, immediate.");
    if (b.mode === "off") { digest = false; immediate = []; }
    if (b.mode === "digest") { digest = true; immediate = []; }
    if (b.mode === "immediate") { digest = true; if (!immediate.length) immediate = [...DEFAULT_IMMEDIATE]; }
  }
  if (b.digest !== undefined) digest = !!b.digest;
  if (b.immediate !== undefined) {
    if (!Array.isArray(b.immediate)) fail(400, "immediate is a list of kinds.");
    const wanted = [...new Set(b.immediate.map((k) => mailKind(str(k, 40))))];
    const bad = wanted.filter((k) => !IMMEDIATE_IDS.includes(k));
    if (bad.length) fail(400, `immediate kinds must be from: ${IMMEDIATE_IDS.join(", ")}.`);
    immediate = wanted;
  }
  await savePrefs(ctx.env, user.id, { digest, immediate });
  return shape(ctx.env, user.id);
}

function page(title, paragraphs, form = "") {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — GeoID Network</title></head>
<body style="margin:0;padding:32px 16px;background:#ffffff;color:#1a1a1a;font:17px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<main style="max-width:520px;margin:0 auto"><p style="font-weight:600">GeoID Network</p><h1 style="font-size:24px">${esc(title)}</h1>
${paragraphs.map((p) => `<p>${p}</p>`).join("\n")}${form}</main></body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

const settingsLinkHtml = (env) => `<a href="${esc(siteLink(env, "#/settings"))}" style="color:#0b4f8a">Settings</a>`;

/**
 * GET: the link in every email. One click, no sign-in: the signed token says
 * whose mail to stop. It turns off ALL GeoID Network email (digest and
 * immediate), says so, and offers an undo in case a link scanner or a slip
 * of the finger clicked it.
 * POST: the same, for mail clients that implement RFC 8058 one-click.
 */
async function unsubscribe(ctx) {
  const { env } = ctx;
  const token = ctx.url.searchParams.get("t") || "";
  const claims = await readUnsubscribeToken(env, token);
  const user = claims && await one(env, "SELECT id FROM users WHERE id = ? AND email NOT LIKE 'erased:%'", claims.sub);
  if (!user) {
    if (ctx.request.method === "POST") fail(400, "This unsubscribe link is not valid.");
    return page("This link has expired", [
      `It may be old, or copied incompletely. You can turn email off in ${settingsLinkHtml(env)} after signing in.`]);
  }
  await savePrefs(env, user.id, { digest: false, immediate: [], unsubscribed: true });
  if (ctx.request.method === "POST") return { ok: true, unsubscribed: true };
  const undo = `<form method="post" action="/v1/mail/resubscribe?t=${esc(encodeURIComponent(token))}">
<button type="submit" style="font:inherit;padding:8px 16px;border:1px solid #0b4f8a;background:#ffffff;color:#0b4f8a;border-radius:6px;cursor:pointer">Undo: turn email back on</button></form>`;
  return page("You are unsubscribed", [
    "GeoID Network will not send you any more email. Your notifications are still there in the app.",
    `To choose some emails again, use ${settingsLinkHtml(env)}.`], undo);
}

async function resubscribe(ctx) {
  const { env } = ctx;
  const claims = await readUnsubscribeToken(env, ctx.url.searchParams.get("t") || "");
  const user = claims && await one(env, "SELECT id FROM users WHERE id = ? AND email NOT LIKE 'erased:%'", claims.sub);
  if (!user) return page("This link has expired", [`You can turn email on in ${settingsLinkHtml(env)} after signing in.`]);
  await savePrefs(env, user.id, { digest: true, immediate: [...DEFAULT_IMMEDIATE] });
  return page("Email is back on", [
    "You will get a daily digest of unread notifications, and messages and invitations as they happen.",
    `Change that any time in ${settingsLinkHtml(env)}.`]);
}

export const routes = [
  ["GET", "/v1/me/mail", getPrefs],
  ["PATCH", "/v1/me/mail", patchPrefs],
  ["GET", "/v1/mail/unsubscribe", unsubscribe],
  ["POST", "/v1/mail/unsubscribe", unsubscribe],
  ["POST", "/v1/mail/resubscribe", resubscribe],
];
