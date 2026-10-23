/**
 * Conversations: direct messages, groups and team chats.
 *
 * WHO MAY START ONE is the recipient's contact_pref: `anyone` lets a message
 * straight in, `followers` lets in people the recipient follows (everybody
 * else lands in Requests), `nobody` sends everything to Requests. A block
 * either way stops it outright. A person in "request" status reads the
 * request but cannot reply until they accept it, so a stranger cannot learn
 * they were read.
 *
 * Unread counts compare message times to the member's last_read; the page
 * polls GET .../messages?after=<epoch seconds> for new ones.
 */
import {
  fail, now, id, str, int, parse, requireUser, rateLimit, notify, usersById, userByHandle, blockedBetween, avatarUrl,
} from "./lib.js";
import { body, all, one, run, param, bool } from "./collab.js";

const BLOCKED = "You can't message this person.";

async function membership(env, conversationId, userId) {
  return one(env, "SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?", conversationId, userId);
}

/** The conversation and the caller's membership, or 404 for non-members and leavers. */
async function memberOf(ctx, user) {
  const conv = await one(ctx.env, "SELECT * FROM conversations WHERE id = ?", str(ctx.params.id, 60));
  const me = conv && await membership(ctx.env, conv.id, user.id);
  if (!me || me.status === "left") fail(404, "No such conversation.");
  return { conv, me };
}

/** "active" when the recipient's contact_pref admits the sender, else "request". */
async function admission(env, recipient, sender) {
  if (recipient.contact_pref === "anyone") return "active";
  if (recipient.contact_pref === "nobody") return "request";
  const follows = await one(env,
    "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = 'user' AND target_id = ?", recipient.id, sender.id);
  return follows ? "active" : "request";
}

async function shapes(env, user, rows) {
  const out = [];
  for (const c of rows) {
    const members = await all(env,
      "SELECT user_id, status FROM conversation_members WHERE conversation_id = ? AND status != 'left'", c.id);
    const last = await one(env,
      "SELECT body, sender_id, created_at FROM messages WHERE conversation_id = ? AND removed_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1", c.id);
    const unread = await one(env,
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND removed_at IS NULL AND sender_id != ? AND created_at > ?",
      c.id, user.id, c.my_last_read || 0);
    const users = await usersById(env, [...members.map((m) => m.user_id), last && last.sender_id]);
    out.push({
      id: c.id,
      kind: c.kind,
      title: c.title,
      team_id: c.team_id,
      members: members.map((m) => users[m.user_id]).filter(Boolean),
      last: last ? { body: str(last.body, 200), at: last.created_at, sender: users[last.sender_id] || null } : null,
      unread: unread.n,
      status: c.my_status,
      muted: !!c.my_muted,
      last_at: c.last_at,
    });
  }
  return out;
}

async function loadShape(env, user, conversationId) {
  const rows = await all(env,
    `SELECT c.*, cm.status AS my_status, cm.last_read AS my_last_read, cm.muted AS my_muted FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ? WHERE c.id = ?`, user.id, conversationId);
  return (await shapes(env, user, rows))[0];
}

/** Media keys to attach: the sender's own uploads only, re-scoped to the conversation. */
async function attach(env, user, conversationId, list) {
  const keys = (Array.isArray(list) ? list : []).slice(0, 4).map((m) => str(typeof m === "string" ? m : m && m.key, 200)).filter(Boolean);
  const out = [];
  for (const key of keys) {
    const row = await one(env, "SELECT key, type FROM media WHERE key = ? AND owner_id = ?", key, user.id);
    if (!row) fail(400, "Attach files you uploaded.");
    await run(env, "UPDATE media SET scope = ? WHERE key = ?", `conversation:${conversationId}`, key);
    out.push({ key: row.key, type: row.type });
  }
  return out;
}

async function post(env, user, conv, text, media) {
  const t = now();
  const messageId = id("msg");
  const files = await attach(env, user, conv.id, media);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, body, media_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(messageId, conv.id, user.id, text, JSON.stringify(files), t),
    env.DB.prepare("UPDATE conversations SET last_at = ? WHERE id = ?").bind(t, conv.id),
    env.DB.prepare("UPDATE conversation_members SET last_read = ? WHERE conversation_id = ? AND user_id = ?").bind(t, conv.id, user.id),
  ]);
  const others = await all(env,
    "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ? AND status != 'left' AND muted = 0", conv.id, user.id);
  for (const o of others) {
    await notify(env, o.user_id, "message", user.id, "conversation", conv.id, str(text, 120));
  }
  return { id: messageId, created_at: t, media: files };
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function list(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const status = param(ctx, "status");
  const where = status === "request" ? "cm.status = 'request'" : status === "active" ? "cm.status = 'active'" : "cm.status != 'left'";
  const rows = await all(env,
    `SELECT c.*, cm.status AS my_status, cm.last_read AS my_last_read, cm.muted AS my_muted FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
     WHERE ${where} ORDER BY c.last_at DESC, c.id DESC LIMIT 100`, user.id);
  return { items: await shapes(env, user, rows), next: null };
}

async function start(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const handles = [...new Set((Array.isArray(b.handles) ? b.handles : [b.handles])
    .map((h) => str(h, 40).toLowerCase().replace(/^@/, "")).filter(Boolean))];
  if (!handles.length) fail(400, "Who is this to? Send handles.");
  if (handles.length > 20) fail(400, "A group conversation has at most 20 other people.");
  const text = str(b.body, 5000);
  const recipients = [];
  for (const h of handles) {
    const target = await userByHandle(env, h);
    if (!target) fail(404, `No one has the handle ${h}.`);
    if (target.id === user.id) continue;
    if (await blockedBetween(env, user.id, target.id)) fail(403, BLOCKED);
    recipients.push(target);
  }
  if (!recipients.length) fail(400, "You can't start a conversation with only yourself.");
  const t = now();
  let conv = null;
  if (recipients.length === 1) {
    // One conversation per pair: a second "new message" continues the first.
    conv = await one(env,
      `SELECT c.* FROM conversations c
       JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
       JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
       WHERE c.kind = 'dm' LIMIT 1`, user.id, recipients[0].id);
  }
  if (conv) {
    // Writing to somebody is consent to hear back from them: the sender is active.
    await run(env, "UPDATE conversation_members SET status = 'active' WHERE conversation_id = ? AND user_id = ?", conv.id, user.id);
    const them = await membership(env, conv.id, recipients[0].id);
    if (them.status === "left") {
      await run(env, "UPDATE conversation_members SET status = ? WHERE conversation_id = ? AND user_id = ?",
        await admission(env, recipients[0], user), conv.id, recipients[0].id);
    }
  } else {
    const convId = id("cv");
    const statements = [
      env.DB.prepare("INSERT INTO conversations (id, kind, title, created_by, last_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(convId, recipients.length === 1 ? "dm" : "group", recipients.length === 1 ? "" : str(b.title, 120), user.id, t, t),
      env.DB.prepare("INSERT INTO conversation_members (conversation_id, user_id, status, last_read) VALUES (?, ?, 'active', ?)")
        .bind(convId, user.id, t),
    ];
    for (const r of recipients) {
      statements.push(env.DB.prepare("INSERT INTO conversation_members (conversation_id, user_id, status, last_read) VALUES (?, ?, ?, 0)")
        .bind(convId, r.id, await admission(env, r, user)));
    }
    await env.DB.batch(statements);
    conv = await one(env, "SELECT * FROM conversations WHERE id = ?", convId);
  }
  if (text || (Array.isArray(b.media) && b.media.length)) await post(env, user, conv, text, b.media);
  return loadShape(env, user, conv.id);
}

async function messages(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { conv } = await memberOf(ctx, user);
  const after = int(param(ctx, "after"), null);
  const before = int(param(ctx, "before") ?? param(ctx, "cursor"), null);
  let rows;
  if (after != null) {
    // Inclusive on purpose: times are whole seconds, so a message written in
    // the same second as the last poll would be lost by ">"; the page drops
    // ids it already has.
    rows = await all(env,
      "SELECT * FROM messages WHERE conversation_id = ? AND removed_at IS NULL AND created_at >= ? ORDER BY created_at, rowid LIMIT 200",
      conv.id, after);
  } else {
    rows = (await all(env,
      `SELECT * FROM messages WHERE conversation_id = ? AND removed_at IS NULL ${before != null ? "AND created_at < ?" : ""}
       ORDER BY created_at DESC, rowid DESC LIMIT 51`, conv.id, ...(before != null ? [before] : []))).reverse();
  }
  const more = after == null && rows.length > 50;
  if (more) rows = rows.slice(1);
  await run(env, "UPDATE conversation_members SET last_read = MAX(last_read, ?) WHERE conversation_id = ? AND user_id = ?",
    now(), conv.id, user.id);
  const users = await usersById(env, rows.map((m) => m.sender_id));
  return {
    items: rows.map((m) => ({
      id: m.id,
      sender: users[m.sender_id] || null,
      body: m.body,
      media: parse(m.media_json, []).map((f) => ({ ...f, url: avatarUrl(env, f.key) })),
      created_at: m.created_at,
    })),
    // Older pages: ?before=<created_at of the first item>.
    next: more && rows.length ? String(rows[0].created_at) : null,
  };
}

async function send(ctx) {
  const { env } = ctx;
  const user = await requireUser(ctx);
  const { conv, me } = await memberOf(ctx, user);
  if (me.status !== "active") fail(403, "Accept the message request to reply.");
  if (conv.kind === "dm") {
    const other = await one(env, "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?", conv.id, user.id);
    if (other && await blockedBetween(env, user.id, other.user_id)) fail(403, BLOCKED);
  }
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const text = str(b.body, 5000);
  if (!text && !(Array.isArray(b.media) && b.media.length)) fail(400, "Write something.");
  const sent = await post(env, user, conv, text, b.media);
  return { id: sent.id, body: text, media: sent.media.map((f) => ({ ...f, url: avatarUrl(env, f.key) })), created_at: sent.created_at,
    sender: (await usersById(env, [user.id]))[user.id] };
}

async function accept(ctx) {
  const user = await requireUser(ctx);
  const { conv } = await memberOf(ctx, user);
  await rateLimit(ctx, user);
  await run(ctx.env, "UPDATE conversation_members SET status = 'active' WHERE conversation_id = ? AND user_id = ?", conv.id, user.id);
  return loadShape(ctx.env, user, conv.id);
}

async function leave(ctx) {
  const user = await requireUser(ctx);
  const { conv } = await memberOf(ctx, user);
  // A team chat follows team membership (teams.js keeps it in sync); mute it, or leave the team.
  if (conv.kind === "team") fail(409, "This is a team conversation: mute it, or leave the team.");
  await rateLimit(ctx, user);
  await run(ctx.env, "UPDATE conversation_members SET status = 'left' WHERE conversation_id = ? AND user_id = ?", conv.id, user.id);
  return { ok: true };
}

async function mute(ctx) {
  const user = await requireUser(ctx);
  const { conv } = await memberOf(ctx, user);
  await rateLimit(ctx, user);
  const b = await body(ctx);
  const muted = bool(b.muted, true) ? 1 : 0;
  await run(ctx.env, "UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?", muted, conv.id, user.id);
  return { muted: !!muted };
}

export const routes = [
  ["GET", "/v1/conversations", list],
  ["POST", "/v1/conversations", start],
  ["GET", "/v1/conversations/:id/messages", messages],
  ["POST", "/v1/conversations/:id/messages", send],
  ["POST", "/v1/conversations/:id/accept", accept],
  ["POST", "/v1/conversations/:id/leave", leave],
  ["POST", "/v1/conversations/:id/mute", mute],
];
