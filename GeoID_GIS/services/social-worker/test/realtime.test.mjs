/**
 * v1.3 live messages: tickets, the /live upgrade checks, the push after a
 * message is saved, and the ChatRoom Durable Object with fake sockets.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { sign, now } from "../lib.js";
import { makeTicket, readTicket, ChatRoom } from "../realtime.js";

const ANA = "ana@example.com";
const BOB = "bob@example.com";
const EVE = "eve@example.com";
const uid = (env, handle) => env.DB.raw.prepare("SELECT id FROM users WHERE handle = ?").get(handle).id;

/** A CHAT namespace that records what the Worker asks of each room. */
function fakeChat() {
  const calls = [];
  return {
    calls,
    idFromName: (name) => ({ name }),
    get: (id) => ({
      fetch: async (url, init = {}) => {
        const headers = new Headers(init.headers || {});
        calls.push({ room: id.name, url: String(url), method: init.method || "GET", headers, body: init.body ? JSON.parse(init.body) : null });
        return new Response(JSON.stringify({ delivered: 1 }), { status: 200, headers: { "content-type": "application/json" } });
      },
    }),
  };
}

async function conversation(env) {
  await call(env, "GET", "/v1/me", { as: ANA });
  await call(env, "GET", "/v1/me", { as: BOB });
  await call(env, "GET", "/v1/me", { as: EVE });
  await call(env, "PATCH", "/v1/me", { as: BOB, body: { contact_pref: "anyone" } });
  const res = await call(env, "POST", "/v1/conversations", { as: ANA, body: { handles: ["bob"], body: "hello" } });
  return res.body.id;
}

test("tickets: one room, one minute, their own key and audience", async () => {
  const env = makeEnv();
  const t = now();
  const ticket = await makeTicket(env, "u_1", "c:cv_1", t);
  assert.equal((await readTicket(env, ticket, "c:cv_1")).sub, "u_1");
  assert.equal(await readTicket(env, ticket, "c:cv_2"), null, "wrong room");
  assert.equal(await readTicket(env, await makeTicket(env, "u_1", "c:cv_1", t - 120), "c:cv_1"), null, "expired");
  const [h, b] = ticket.split(".");
  assert.equal(await readTicket(env, `${h}.${b}.AAAA`, "c:cv_1"), null, "tampered");
  // Signed with the plain social secret (a sign-in token's key): refused.
  const forged = await sign({ aud: "chat", sub: "u_1", room: "c:cv_1", exp: t + 60 }, env.JWT_SECRET);
  assert.equal(await readTicket(env, forged, "c:cv_1"), null);
  // And a ticket does not sign anybody in.
  const res = await call(env, "GET", "/v1/me", { token: ticket });
  assert.equal(res.status, 401);
  assert.equal(await makeTicket({}, "u_1", "c:cv_1"), "", "no secret, no ticket");
});

test("ticket route: members only", async () => {
  const env = makeEnv();
  const cid = await conversation(env);
  assert.equal((await call(env, "POST", `/v1/conversations/${cid}/ticket`, {})).status, 401);
  assert.equal((await call(env, "POST", `/v1/conversations/${cid}/ticket`, { as: EVE })).status, 404);
  const res = await call(env, "POST", `/v1/conversations/${cid}/ticket`, { as: BOB });
  assert.equal(res.status, 200);
  assert.equal(res.body.path, `/v1/conversations/${cid}/live`);
  assert.equal(res.body.live, false);
  assert.ok(await readTicket(env, res.body.ticket, `c:${cid}`));
  const mine = await call(env, "POST", "/v1/me/live/ticket", { as: BOB });
  assert.ok(await readTicket(env, mine.body.ticket, `u:${uid(env, "bob")}`));
});

test("live upgrade: checks in order, then hands a checked member to the room", async () => {
  const env = makeEnv();
  const cid = await conversation(env);
  const ticket = (await call(env, "POST", `/v1/conversations/${cid}/ticket`, { as: BOB })).body.ticket;
  const path = `/v1/conversations/${cid}/live?ticket=${encodeURIComponent(ticket)}`;
  const ws = { Upgrade: "websocket" };

  assert.equal((await call(env, "GET", path)).status, 426, "not a WebSocket");
  assert.equal((await call(env, "GET", `/v1/conversations/${cid}/live?ticket=bad`, { headers: ws })).status, 401);
  assert.equal((await call(env, "GET", path, { headers: { ...ws, Origin: "https://evil.example" } })).status, 403);
  assert.equal((await call(env, "GET", path, { headers: ws })).status, 503, "no binding: the page polls");
  // A ticket for another conversation does not open this one.
  const other = await call(env, "POST", "/v1/conversations", { as: EVE, body: { handles: ["bob"], body: "hi" } });
  assert.equal((await call(env, "GET", `/v1/conversations/${other.body.id}/live?ticket=${encodeURIComponent(ticket)}`, { headers: ws })).status, 401);

  env.CHAT = fakeChat();
  const res = await call(env, "GET", path, { headers: ws });
  assert.equal(res.status, 200);
  const hop = env.CHAT.calls.at(-1);
  assert.equal(hop.room, `c:${cid}`);
  assert.equal(hop.headers.get("upgrade"), "websocket");
  assert.equal(hop.headers.get("x-chat-user"), uid(env, "bob"));
  assert.equal(hop.headers.get("x-chat-handle"), "bob");
  assert.equal(hop.headers.get("x-chat-can-send"), "1");

  // Leaving revokes it even with a ticket still in hand.
  await call(env, "POST", `/v1/conversations/${cid}/leave`, { as: BOB });
  assert.equal((await call(env, "GET", path, { headers: ws })).status, 404);

  // The personal room: its own ticket only.
  const mine = (await call(env, "POST", "/v1/me/live/ticket", { as: ANA })).body.ticket;
  assert.equal((await call(env, "GET", `/v1/me/live?ticket=${encodeURIComponent(mine)}`, { headers: ws })).status, 200);
  assert.equal(env.CHAT.calls.at(-1).room, `u:${uid(env, "ana")}`);
  assert.equal((await call(env, "GET", `/v1/me/live?ticket=${encodeURIComponent(ticket)}`, { headers: ws })).status, 401);
});

test("sending a message pushes it to the room and pings the other members' own rooms", async () => {
  const env = makeEnv();
  const cid = await conversation(env);
  // Without a binding, sending works exactly as before.
  assert.equal((await call(env, "POST", `/v1/conversations/${cid}/messages`, { as: BOB, body: { body: "no socket" } })).status, 200);

  env.CHAT = fakeChat();
  const res = await call(env, "POST", `/v1/conversations/${cid}/messages`, { as: BOB, body: { body: "live one" } });
  assert.equal(res.status, 200);
  const rooms = env.CHAT.calls.map((c) => c.room).sort();
  assert.deepEqual(rooms, [`c:${cid}`, `u:${uid(env, "ana")}`].sort());
  const toRoom = env.CHAT.calls.find((c) => c.room === `c:${cid}`);
  assert.equal(toRoom.method, "POST");
  assert.equal(toRoom.body.payload.type, "message");
  assert.equal(toRoom.body.payload.message.body, "live one");
  assert.equal(toRoom.body.payload.message.sender.handle, "bob");
  assert.deepEqual(new Set(toRoom.body.to), new Set([uid(env, "ana"), uid(env, "bob")]));
  const ping = env.CHAT.calls.find((c) => c.room.startsWith("u:"));
  assert.deepEqual(ping.body.payload, { type: "unread", conversation_id: cid });
  assert.ok(!JSON.stringify(ping.body).includes("live one"), "a ping carries no content");

  // A push that fails never fails the send.
  env.CHAT = { idFromName: () => ({}), get: () => ({ fetch: async () => { throw new Error("down"); } }) };
  assert.equal((await call(env, "POST", `/v1/conversations/${cid}/messages`, { as: BOB, body: { body: "still saved" } })).status, 200);
});

// ── The Durable Object, with fake state and sockets ────────────────────────

function fakeState() {
  const sockets = [];
  return {
    sockets,
    acceptWebSocket(ws, tags) { ws.tags = tags; sockets.push(ws); },
    getWebSockets() { return sockets.filter((s) => !s.closed); },
  };
}
function fakeSocket() {
  return {
    sent: [], closed: null, att: null,
    send(text) { if (this.closed) throw new Error("closed"); this.sent.push(JSON.parse(text)); },
    close(code, reason) { this.closed = [code, reason]; },
    serializeAttachment(a) { this.att = structuredClone(a); },
    deserializeAttachment() { return this.att; },
  };
}

test("ChatRoom: hello, broadcast to listed members, closes the unlisted", async () => {
  const state = fakeState();
  const room = new ChatRoom(state, {});
  const a = fakeSocket();
  const b = fakeSocket();
  room.accept(a, { uid: "u_a", handle: "ana", room: "c:cv_1", canSend: true });
  room.accept(b, { uid: "u_b", handle: "bob", room: "c:cv_1", canSend: true });
  assert.deepEqual(a.sent[0], { type: "hello", room: "c:cv_1" });
  assert.deepEqual(a.tags, ["u_a"]);

  assert.equal(room.broadcast({ type: "message", message: { id: "m1" } }, ["u_a", "u_b"]), 2);
  assert.equal(b.sent.at(-1).message.id, "m1");
  assert.equal(room.broadcast({ type: "message", message: { id: "m2" } }, ["u_a"]), 1);
  assert.deepEqual(b.closed, [4403, "No longer a member."]);
  assert.equal(a.sent.at(-1).message.id, "m2");

  const res = await room.fetch(new Request("https://chat.internal/broadcast", {
    method: "POST", body: JSON.stringify({ payload: { type: "unread", conversation_id: "cv_1" }, to: ["u_a"] }),
  }));
  assert.deepEqual(await res.json(), { delivered: 1 });
  assert.equal((await room.fetch(new Request("https://chat.internal/connect", { headers: { Upgrade: "websocket" } }))).status, 400, "no user, no socket");
  assert.equal((await room.fetch(new Request("https://chat.internal/other"))).status, 404);
});

test("ChatRoom: typing goes to the others, throttled, only from someone who may reply", async () => {
  const state = fakeState();
  const room = new ChatRoom(state, {});
  const a = fakeSocket();
  const a2 = fakeSocket();
  const b = fakeSocket();
  const r = fakeSocket();
  room.accept(a, { uid: "u_a", handle: "ana", room: "c:cv_1", canSend: true });
  room.accept(a2, { uid: "u_a", handle: "ana", room: "c:cv_1", canSend: true });
  room.accept(b, { uid: "u_b", handle: "bob", room: "c:cv_1", canSend: true });
  room.accept(r, { uid: "u_r", handle: "rae", room: "c:cv_1", canSend: false });
  const count = (ws) => ws.sent.filter((m) => m.type === "typing").length;

  await room.webSocketMessage(a, '{"type":"typing"}');
  assert.equal(count(b), 1);
  assert.equal(b.sent.at(-1).handle, "ana");
  assert.equal(count(a2), 0, "not echoed to the typer's other tabs");
  await room.webSocketMessage(a, '{"type":"typing"}');
  assert.equal(count(b), 1, "throttled");
  await room.webSocketMessage(r, '{"type":"typing"}');
  assert.equal(count(a), 0, "a pending request cannot type");

  await room.webSocketMessage(b, '{"type":"ping"}');
  assert.deepEqual(b.sent.at(-1), { type: "pong" });
  await room.webSocketMessage(b, `{"type":"typing","pad":"${"x".repeat(2000)}"}`);
  assert.equal(count(a), 0, "oversized frames are ignored");
  await room.webSocketMessage(b, "not json");

  const personal = new ChatRoom(fakeState(), {});
  const p = fakeSocket();
  const q = fakeSocket();
  personal.accept(p, { uid: "u_a", handle: "ana", room: "u:u_a", canSend: true });
  personal.accept(q, { uid: "u_b", handle: "bob", room: "u:u_a", canSend: true });
  await personal.webSocketMessage(p, '{"type":"typing"}');
  assert.equal(count(q), 0, "no typing in a personal room");

  await room.webSocketClose(a, 1006, "");
  assert.deepEqual(a.closed, [1000, ""]);
  await room.webSocketClose(b, 4000, "bye");
  assert.deepEqual(b.closed, [4000, "bye"]);
});
