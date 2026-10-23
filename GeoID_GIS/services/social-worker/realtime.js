/**
 * Live messages: a Durable Object per open room, so a conversation that is on
 * somebody's screen gets new messages pushed instead of polled.
 *
 * TWO KINDS OF ROOM, one class. `c:<conversation id>` carries the messages of
 * one conversation (and "typing…") to the members who have it open.
 * `u:<user id>` is a member's own room: it only ever hears "something new
 * arrived in conversation X", which is what lets the inbox list and its
 * unread badges move without a poll. Room names are made here from ids the
 * Worker has checked, never taken from the page.
 *
 * SIGNING IN TO A SOCKET. A browser cannot put an Authorization header on a
 * WebSocket, so the page first asks POST .../ticket (an ordinary Bearer
 * request, membership checked) for a ticket good for 60 seconds and one room,
 * and opens .../live?ticket=. The ticket is HMAC-signed with the social secret
 * plus a suffix of its own, with its own audience, so it is no use as a
 * sign-in token, and a sign-in token is no use as a ticket. Membership is
 * checked again at the upgrade, and on every broadcast the Worker names who
 * may still hear it: a member who has left is disconnected at the next
 * message rather than kept listening.
 *
 * COST. The hibernation API (state.acceptWebSocket) lets the object sleep
 * between messages with its sockets still open; the page's 30 s keep-alive
 * ping is answered by the runtime's auto-response without waking it.
 *
 * WITHOUT THE BINDING (tests, or a deploy before the DO migration) every
 * helper here is a quiet no-op and /live answers 503, and the page keeps its
 * 10-second poll.
 */
import { fail, now, str, sign, verify, requireUser } from "./lib.js";
import { all, one } from "./collab.js";

const TICKET_SECONDS = 60;
const MAX_SOCKETS = 200;          // per room; a team chat is far smaller
const MAX_FRAME = 1024;           // pages only ever send small control frames
const TYPING_EVERY_MS = 2500;
const FANOUT_MAX = 25;            // personal-room pings per message; bigger groups poll for their badges

// ── Tickets ────────────────────────────────────────────────────────────────

function ticketSecret(env) {
  const base = env.SOCIAL_JWT_SECRET || env.JWT_SECRET;
  return base ? `${base}\u0000chat` : "";
}

/** A ticket for `userId` to join `room` ("c:<id>" or "u:<id>"), good for 60 s. */
export async function makeTicket(env, userId, room, t = now()) {
  const secret = ticketSecret(env);
  if (!secret) return "";
  return sign({ aud: "chat", sub: userId, room, exp: t + TICKET_SECONDS }, secret);
}

/** The ticket's payload if it is genuine, unexpired and for exactly this room; else null. */
export async function readTicket(env, ticket, room) {
  const payload = await verify(ticket, ticketSecret(env), { audience: "chat" });
  return payload && payload.sub && payload.room === room ? payload : null;
}

// ── Talking to rooms ───────────────────────────────────────────────────────

function roomStub(env, room) {
  return env.CHAT.get(env.CHAT.idFromName(room));
}

async function roomPost(env, room, payload, to) {
  const res = await roomStub(env, room).fetch("https://chat.internal/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload, to }),
  });
  return res.ok;
}

/**
 * After a message is saved (messages.js): push it to the conversation's room,
 * and an "unread" ping to each other member's own room. Never throws; with no
 * binding it does nothing. Uses ctx.exec.waitUntil when the Worker passed
 * one, so the sender's answer does not wait for the push.
 */
export function pushMessage(ctx, conversationId, senderId, message) {
  const env = ctx.env;
  if (!env.CHAT) return Promise.resolve(false);
  const work = (async () => {
    const members = await all(env,
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND status != 'left'", conversationId);
    const ids = members.map((m) => m.user_id);
    const tasks = [roomPost(env, `c:${conversationId}`, { type: "message", conversation_id: conversationId, message }, ids)];
    for (const uid of ids.filter((u) => u !== senderId).slice(0, FANOUT_MAX)) {
      tasks.push(roomPost(env, `u:${uid}`, { type: "unread", conversation_id: conversationId }, [uid]));
    }
    await Promise.allSettled(tasks);
    return true;
  })().catch((error) => { console.error("live push", error && error.message); return false; });
  if (ctx.exec && typeof ctx.exec.waitUntil === "function") { ctx.exec.waitUntil(work); return Promise.resolve(true); }
  return work;
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function conversationMember(env, conversationId, userId) {
  const me = await one(env,
    "SELECT status FROM conversation_members WHERE conversation_id = ? AND user_id = ?", conversationId, userId);
  return me && me.status !== "left" ? me : null;
}

async function conversationTicket(ctx) {
  const user = await requireUser(ctx);
  const cid = str(ctx.params.id, 60);
  if (!(await conversationMember(ctx.env, cid, user.id))) fail(404, "No such conversation.");
  const ticket = await makeTicket(ctx.env, user.id, `c:${cid}`);
  if (!ticket) fail(503, "Live messages are not available.");
  return { ticket, expires: now() + TICKET_SECONDS, path: `/v1/conversations/${encodeURIComponent(cid)}/live`, live: !!ctx.env.CHAT };
}

async function personalTicket(ctx) {
  const user = await requireUser(ctx);
  const ticket = await makeTicket(ctx.env, user.id, `u:${user.id}`);
  if (!ticket) fail(503, "Live updates are not available.");
  return { ticket, expires: now() + TICKET_SECONDS, path: "/v1/me/live", live: !!ctx.env.CHAT };
}

/**
 * The upgrade itself. Order matters: a plain GET learns nothing (426), a bad
 * ticket learns nothing (401), and only a checked member reaches the object.
 * A page on an origin outside RETURN_ORIGINS is refused even with a ticket:
 * cross-site WebSocket hijacking is the one attack a ticket alone invites.
 */
async function connect(ctx, room, recheck) {
  const { env, request } = ctx;
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") fail(426, "This address is a WebSocket.");
  const origin = request.headers.get("Origin");
  const allowed = String(env.RETURN_ORIGINS || "").split(/\s+/).filter(Boolean);
  if (origin && !allowed.includes(origin)) fail(403, "Not from this page.");
  const claims = await readTicket(env, ctx.url.searchParams.get("ticket") || "", room);
  if (!claims) fail(401, "This live link has expired; ask for a new ticket.");
  const user = await one(env, "SELECT id, handle, suspended_until FROM users WHERE id = ?", claims.sub);
  if (!user || user.suspended_until > now()) fail(403, "This account cannot connect.");
  const canSend = await recheck(user);
  if (canSend === null) fail(404, "No such conversation.");
  if (!env.CHAT) fail(503, "Live messages are not available here; the page will poll.");
  return roomStub(env, room).fetch("https://chat.internal/connect", {
    headers: {
      Upgrade: "websocket",
      "x-chat-user": user.id,
      "x-chat-handle": user.handle,
      "x-chat-room": room,
      "x-chat-can-send": canSend ? "1" : "0",
    },
  });
}

async function conversationLive(ctx) {
  const cid = str(ctx.params.id, 60);
  return connect(ctx, `c:${cid}`, async (user) => {
    const me = await conversationMember(ctx.env, cid, user.id);
    return me ? me.status === "active" : null;
  });
}

async function personalLive(ctx) {
  // The room is the ticket holder's own, so its name comes from the ticket;
  // connect() then checks the ticket was issued for exactly that room.
  const peek = await verify(ctx.url.searchParams.get("ticket") || "", ticketSecret(ctx.env), { audience: "chat" });
  return connect(ctx, `u:${peek && peek.sub ? peek.sub : "-"}`, async () => true);
}

export const routes = [
  ["POST", "/v1/conversations/:id/ticket", conversationTicket],
  ["GET", "/v1/conversations/:id/live", conversationLive],
  ["POST", "/v1/me/live/ticket", personalTicket],
  ["GET", "/v1/me/live", personalLive],
];

// ── The Durable Object ─────────────────────────────────────────────────────

const attachmentOf = (ws) => {
  try { return ws.deserializeAttachment() || {}; } catch (error) { return {}; }
};

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Keep-alive pings answered by the runtime itself, without waking the object.
    try {
      if (typeof WebSocketRequestResponsePair === "function" && state.setWebSocketAutoResponse) {
        state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
      }
    } catch (error) { /* older runtime: webSocketMessage answers instead */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if ((request.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
      const who = {
        uid: request.headers.get("x-chat-user") || "",
        handle: request.headers.get("x-chat-handle") || "",
        room: request.headers.get("x-chat-room") || "",
        canSend: request.headers.get("x-chat-can-send") === "1",
      };
      if (!who.uid) return new Response("Who?", { status: 400 });
      if (this.state.getWebSockets().length >= MAX_SOCKETS) return new Response("Room full.", { status: 503 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.accept(server, who);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const { payload, to } = await request.json();
      return new Response(JSON.stringify({ delivered: this.broadcast(payload, to) }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Not found.", { status: 404 });
  }

  /** Take a server-side socket into the room (hibernatable), remembering who it is. */
  accept(ws, who) {
    this.state.acceptWebSocket(ws, [who.uid]);
    ws.serializeAttachment({ uid: who.uid, handle: who.handle, room: who.room, canSend: !!who.canSend, typedAt: 0 });
    try { ws.send(JSON.stringify({ type: "hello", room: who.room })); } catch (error) { /* closed already */ }
  }

  /**
   * Send `payload` to every socket whose user is in `to` (all, when `to` is
   * not a list). A socket whose user is no longer listed has lost the right
   * to listen and is closed with 4403, which tells the page not to retry.
   */
  broadcast(payload, to) {
    const allowed = Array.isArray(to) ? new Set(to) : null;
    const text = JSON.stringify(payload);
    let delivered = 0;
    for (const ws of this.state.getWebSockets()) {
      const who = attachmentOf(ws);
      if (allowed && !allowed.has(who.uid)) {
        try { ws.close(4403, "No longer a member."); } catch (error) { /* gone */ }
        continue;
      }
      try { ws.send(text); delivered += 1; } catch (error) { /* gone; the runtime reaps it */ }
    }
    return delivered;
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_FRAME) return;
    let msg = null;
    try { msg = JSON.parse(data); } catch (error) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ping") { try { ws.send('{"type":"pong"}'); } catch (error) { /* gone */ } return; }
    if (msg.type !== "typing") return;
    const who = attachmentOf(ws);
    // Typing is a conversation-room thing, from somebody who may reply, at most every 2.5 s.
    if (!String(who.room).startsWith("c:") || !who.canSend) return;
    const t = Date.now();
    if (t - (who.typedAt || 0) < TYPING_EVERY_MS) return;
    ws.serializeAttachment({ ...who, typedAt: t });
    const out = JSON.stringify({ type: "typing", handle: who.handle });
    for (const other of this.state.getWebSockets()) {
      if (other === ws || attachmentOf(other).uid === who.uid) continue;
      try { other.send(out); } catch (error) { /* gone */ }
    }
  }

  async webSocketClose(ws, code, reason) {
    // 1005/1006 are "no code" markers and may not be sent back.
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, str(reason, 100)); } catch (error) { /* closed */ }
  }

  async webSocketError(ws) {
    try { ws.close(1011, "Error."); } catch (error) { /* closed */ }
  }
}
