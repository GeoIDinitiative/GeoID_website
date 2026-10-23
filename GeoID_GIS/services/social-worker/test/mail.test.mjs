/**
 * v1.3 engagement: email preferences, the queue notify() fills, immediate and
 * digest mail through a stubbed Resend, the unsubscribe link, and the
 * scheduled() dispatch.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import worker from "../worker.js";
import { MAIL_NOW_KINDS, sign, now } from "../lib.js";
import {
  IMMEDIATE_IDS, KIND_ALIAS, flushQueue, sendDigests, unsubscribeToken, readUnsubscribeToken, describe, prefsOf,
} from "../mail.js";
import { runJobs, reminders, prune, FREQUENT, DAILY } from "../cron.js";

const ANA = "ana@example.com";
const BOB = "bob@example.com";
const MAIL_ENV = { RESEND_API_KEY: "re_test", MAIL_FROM: "GeoHUB Social <social@example.com>" };

const uid = (env, handle) => env.DB.raw.prepare("SELECT id FROM users WHERE handle = ?").get(handle).id;
const rows = (env, sql, ...a) => env.DB.raw.prepare(sql).all(...a);

/** A fetch that records what it was asked to send and answers like Resend. */
function resendStub(status = 200) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: "em_1" }), { status, headers: { "content-type": "application/json" } });
  };
  return { sent, fetchImpl };
}

async function pair(env) {
  await call(env, "GET", "/v1/me", { as: ANA });
  await call(env, "GET", "/v1/me", { as: BOB });
  // Bob lets anyone write, so Ana's message is not a request.
  await call(env, "PATCH", "/v1/me", { as: BOB, body: { contact_pref: "anyone" } });
}

test("lib's mail-now kinds are exactly mail.js's kinds and aliases", () => {
  const expected = new Set([...IMMEDIATE_IDS, ...Object.keys(KIND_ALIAS), ...Object.values(KIND_ALIAS)]);
  assert.deepEqual(new Set(MAIL_NOW_KINDS), expected);
});

test("preferences: defaults, modes, aliases and bad kinds", async () => {
  const env = makeEnv();
  assert.equal((await call(env, "GET", "/v1/me/mail")).status, 401);
  let res = await call(env, "GET", "/v1/me/mail", { as: ANA });
  assert.equal(res.status, 200);
  assert.equal(res.body.digest, true);
  assert.deepEqual(res.body.immediate, ["message", "invite"]);
  assert.equal(res.body.mode, "immediate");
  assert.equal(res.body.sending, false);
  assert.ok(res.body.kinds.some((k) => k.id === "mentoring"));

  res = await call(env, "PATCH", "/v1/me/mail", { as: ANA, body: { mode: "off" } });
  assert.equal(res.body.mode, "off");
  assert.equal(res.body.digest, false);
  assert.deepEqual(res.body.immediate, []);

  res = await call(env, "PATCH", "/v1/me/mail", { as: ANA, body: { digest: true, immediate: ["collab_request", "grant"] } });
  assert.equal(res.body.mode, "immediate");
  assert.deepEqual(res.body.immediate, ["request", "grant"]);

  res = await call(env, "PATCH", "/v1/me/mail", { as: ANA, body: { immediate: ["reaction"] } });
  assert.equal(res.status, 400);
  res = await call(env, "PATCH", "/v1/me/mail", { as: ANA, body: { mode: "loud" } });
  assert.equal(res.status, 400);
  res = await call(env, "GET", "/v1/me/mail", { as: ANA, });
  assert.deepEqual(res.body.immediate, ["request", "grant"]);
});

test("notify() queues only the kinds that may be mailed at once", async () => {
  const env = makeEnv();
  await pair(env);
  const conv = await call(env, "POST", "/v1/conversations", { as: ANA, body: { handles: ["bob"], body: "Secret field notes" } });
  assert.equal(conv.status, 200);
  await call(env, "POST", "/v1/follow", { as: ANA, body: { type: "user", id: "bob" } });
  const queued = rows(env, "SELECT kind, user_id FROM mail_queue");
  assert.deepEqual(queued.map((r) => r.kind), ["message"]);
  assert.equal(queued[0].user_id, uid(env, "bob"));
});

test("immediate mail: held without a key; sent once with one; never the message body", async () => {
  const env = makeEnv();
  await pair(env);
  await call(env, "POST", "/v1/conversations", { as: ANA, body: { handles: ["bob"], body: "Secret field notes" } });
  const later = now() + 300;

  const stub = resendStub();
  let out = await flushQueue(env, later, { fetchImpl: stub.fetchImpl });
  assert.equal(out.held, 1);
  assert.equal(stub.sent.length, 0);

  Object.assign(env, MAIL_ENV);
  // Too fresh: a member in the app gets two minutes to read it there.
  out = await flushQueue(env, now(), { fetchImpl: stub.fetchImpl });
  assert.equal(stub.sent.length, 0);

  out = await flushQueue(env, later, { fetchImpl: stub.fetchImpl });
  assert.equal(out.sent, 1);
  assert.equal(stub.sent.length, 1);
  const mail = stub.sent[0];
  assert.equal(mail.url, "https://api.resend.com/emails");
  assert.deepEqual(mail.body.to, [BOB]);
  assert.equal(mail.body.from, MAIL_ENV.MAIL_FROM);
  assert.ok(!mail.body.html.includes("Secret field notes") && !mail.body.text.includes("Secret field notes"));
  assert.ok(!mail.body.html.includes(ANA) && !mail.body.text.includes(ANA), "never the sender's address");
  assert.match(mail.body.subject, /sent you a message/);
  assert.match(mail.body.text, /\/social\/#\/messages\/cv_/);
  assert.match(mail.body.headers["List-Unsubscribe"], /^<http:\/\/localhost:8790\/v1\/mail\/unsubscribe\?t=/);
  assert.equal(mail.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(mail.headers["Idempotency-Key"]);

  out = await flushQueue(env, later + 60, { fetchImpl: stub.fetchImpl });
  assert.equal(stub.sent.length, 1, "sent once");
});

test("immediate mail skips what was read in the app, and members who chose otherwise", async () => {
  const env = makeEnv(MAIL_ENV);
  await pair(env);
  const conv = await call(env, "POST", "/v1/conversations", { as: ANA, body: { handles: ["bob"], body: "one" } });
  // Bob opens the thread: the message is read, so it is not mailed.
  await call(env, "GET", `/v1/conversations/${conv.body.id}/messages`, { as: BOB });
  const stub = resendStub();
  let out = await flushQueue(env, now() + 300, { fetchImpl: stub.fetchImpl });
  assert.equal(stub.sent.length, 0);
  assert.equal(out.skipped, 1);

  await call(env, "PATCH", "/v1/me/mail", { as: BOB, body: { mode: "digest" } });
  await call(env, "POST", `/v1/conversations/${conv.body.id}/messages`, { as: ANA, body: { body: "two" } });
  out = await flushQueue(env, now() + 300, { fetchImpl: stub.fetchImpl });
  assert.equal(stub.sent.length, 0);
  assert.equal(out.skipped, 1);
});

test("several messages in one thread are one line of one email; a failure retries", async () => {
  const env = makeEnv(MAIL_ENV);
  await pair(env);
  const conv = await call(env, "POST", "/v1/conversations", { as: ANA, body: { handles: ["bob"], body: "one" } });
  await call(env, "POST", `/v1/conversations/${conv.body.id}/messages`, { as: ANA, body: { body: "two" } });
  const failing = resendStub(500);
  let out = await flushQueue(env, now() + 300, { fetchImpl: failing.fetchImpl });
  assert.equal(out.failed, 1);
  assert.equal(rows(env, "SELECT * FROM mail_queue WHERE status = 'queued' AND attempts = 1").length, 2);
  const stub = resendStub();
  out = await flushQueue(env, now() + 300, { fetchImpl: stub.fetchImpl });
  assert.equal(stub.sent.length, 1);
  assert.match(stub.sent[0].body.text, /\(2 messages\)/);
});

test("digest: unread notifications not already mailed, once a day, nothing private", async () => {
  const env = makeEnv(MAIL_ENV);
  await pair(env);
  const pub = await call(env, "POST", "/v1/posts", { as: BOB, body: { title: "Etna tremor", body: "x", visibility: "public" } });
  await call(env, "POST", `/v1/posts/${pub.body.id}/comments`, { as: ANA, body: { body: "Nice" } });
  await call(env, "POST", "/v1/follow", { as: ANA, body: { type: "user", id: "bob" } });
  await call(env, "POST", "/v1/conversations", { as: ANA, body: { handles: ["bob"], body: "Private words" } });
  const stub = resendStub();
  // The message goes immediately, so the digest must not repeat it.
  await flushQueue(env, now() + 300, { fetchImpl: stub.fetchImpl });
  assert.equal(stub.sent.length, 1);

  let out = await sendDigests(env, now() + 600, { fetchImpl: stub.fetchImpl });
  assert.equal(out.sent, 1);
  const digest = stub.sent[1].body;
  assert.deepEqual(digest.to, [BOB]);
  assert.match(digest.subject, /digest: 2 unread notifications/);
  assert.match(digest.text, /Etna tremor/);
  assert.match(digest.text, /started following you/);
  assert.ok(!digest.text.includes("Private words") && !digest.text.includes("sent you a message"));
  assert.match(digest.html, /<html lang="en">/);
  assert.match(digest.html, /Unsubscribe from all GeoHUB Social email/);

  out = await sendDigests(env, now() + 3600, { fetchImpl: stub.fetchImpl });
  assert.equal(out.sent, 0, "not twice in a day");
  // Ana has no unread notifications: no digest for her at all.
  assert.ok(stub.sent.every((m) => m.body.to[0] === BOB));
});

test("describe(): a post the recipient cannot see contributes nothing; a followers-only post only its title", async () => {
  const env = makeEnv();
  await pair(env);
  const priv = await call(env, "POST", "/v1/posts", { as: ANA, body: { title: "Hidden", body: "secret", visibility: "private" } });
  const fol = await call(env, "POST", "/v1/posts", { as: ANA, body: { title: "For followers", body: "x", visibility: "followers" } });
  const bob = env.DB.raw.prepare("SELECT * FROM users WHERE handle = 'bob'").get();
  const ana = env.DB.raw.prepare("SELECT * FROM users WHERE handle = 'ana'").get();
  const base = { kind: "mention", actor_id: ana.id, ref_type: "post", text: "Ana mentioned you in secret body text" };
  let line = await describe(env, bob, { ...base, ref_id: priv.body.id }, { [ana.id]: ana });
  assert.equal(line.text, "ana mentioned you");
  await call(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } });
  line = await describe(env, bob, { ...base, ref_id: fol.body.id }, { [ana.id]: ana });
  assert.equal(line.text, "ana mentioned you: For followers");
  await call(env, "POST", "/v1/blocks", { as: BOB, body: { handle: "ana" } });
  assert.equal(await describe(env, bob, { ...base, ref_id: fol.body.id }, { [ana.id]: ana }), null);
});

test("unsubscribe: one click without sign-in, undo, RFC 8058 POST, and tokens stay in their lane", async () => {
  const env = makeEnv(MAIL_ENV);
  await pair(env);
  const bob = uid(env, "bob");
  const token = await unsubscribeToken(env, bob);
  assert.ok(await readUnsubscribeToken(env, token));

  let res = await call(env, "GET", `/v1/mail/unsubscribe?t=${encodeURIComponent(token)}`);
  assert.equal(res.status, 200);
  const html = new TextDecoder().decode(res.body);
  assert.match(html, /You are unsubscribed/);
  assert.match(html, /resubscribe/);
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal((await prefsOf(env, bob)).mode, "off");

  // Nothing is mailed after that.
  const conv = await call(env, "POST", "/v1/conversations", { as: ANA, body: { handles: ["bob"], body: "hi" } });
  assert.equal(conv.status, 200);
  const stub = resendStub();
  await flushQueue(env, now() + 300, { fetchImpl: stub.fetchImpl });
  await sendDigests(env, now() + 300, { fetchImpl: stub.fetchImpl });
  assert.equal(stub.sent.length, 0);

  res = await call(env, "POST", `/v1/mail/resubscribe?t=${encodeURIComponent(token)}`);
  assert.equal(res.status, 200);
  assert.deepEqual((await prefsOf(env, bob)).immediate, ["message", "invite"]);

  res = await call(env, "POST", `/v1/mail/unsubscribe?t=${encodeURIComponent(token)}`, { body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.unsubscribed, true);

  res = await call(env, "GET", "/v1/mail/unsubscribe?t=nonsense");
  assert.match(new TextDecoder().decode(res.body), /expired/);
  res = await call(env, "POST", "/v1/mail/unsubscribe?t=nonsense", { body: {} });
  assert.equal(res.status, 400);

  // A sign-in token is not an unsubscribe token, and the other way round.
  const social = await sign({ aud: "social", sub: bob, email: BOB, exp: now() + 600 }, env.JWT_SECRET);
  assert.equal(await readUnsubscribeToken(env, social), null);
  res = await call(env, "GET", "/v1/me", { token, headers: { "X-Dev-User": "" } });
  assert.equal(res.status, 401);
});

test("erasure removes mail rows; export lists them", async () => {
  const env = makeEnv();
  await pair(env);
  await call(env, "PATCH", "/v1/me/mail", { as: BOB, body: { mode: "digest" } });
  await call(env, "POST", "/v1/conversations", { as: ANA, body: { handles: ["bob"], body: "hi" } });
  const exp = await call(env, "GET", "/v1/me/export", { as: BOB });
  const data = exp.body;
  assert.equal(data.mail_prefs.length, 1);
  assert.equal(data.mail_log.length, 1);
  const bob = uid(env, "bob");
  const del = await call(env, "DELETE", "/v1/me", { as: BOB, body: { confirm: "bob" } });
  assert.equal(del.status, 200);
  assert.equal(rows(env, "SELECT * FROM mail_prefs WHERE user_id = ?", bob).length, 0);
  assert.equal(rows(env, "SELECT * FROM mail_queue WHERE user_id = ?", bob).length, 0);
});

test("scheduled(): reminders become event notifications once; frequent and daily sets dispatch", async () => {
  const env = makeEnv(MAIL_ENV);
  await pair(env);
  const bob = uid(env, "bob");
  const t = now();
  const marked = [];
  const mod = {
    dueReminders: async (e, at) => { assert.equal(at, t); return [{ user_id: bob, event_id: "ev_1", title: "Field trip" }, null, {}]; },
    markReminded: async (e, items, at) => { marked.push(...items); assert.equal(at, t); },
  };
  let r = await reminders(env, t, mod);
  assert.deepEqual(r, { sent: 1, repeated: 0 });
  assert.equal(marked.length, 1, "what was returned is marked (junk dropped)");
  r = await reminders(env, t, mod);
  assert.deepEqual(r, { sent: 0, repeated: 1 });
  const n = rows(env, "SELECT * FROM notifications WHERE user_id = ? AND kind = 'event'", bob);
  assert.equal(n.length, 1);
  assert.equal(n[0].text, "Starting soon: Field trip");
  assert.equal(rows(env, "SELECT * FROM mail_queue WHERE kind = 'event'").length, 1);
  assert.deepEqual(await reminders(env, t, {}), { skipped: "events.dueReminders is not there yet" });

  // 08:00 UTC: reminders, the queue, and digests all run.
  const morning = Math.floor(Date.UTC(2026, 9, 23, 8, 0, 0) / 1000);
  const stub = resendStub();
  let report = await runJobs(FREQUENT, env, morning, { fetchImpl: stub.fetchImpl, mod: {} });
  assert.ok(report.reminders && report.mail && report.digests, JSON.stringify(report));
  // 05:00 UTC: no digests yet.
  report = await runJobs(FREQUENT, env, morning - 3 * 3600, { fetchImpl: stub.fetchImpl, mod: {} });
  assert.equal(report.digests, undefined);

  // The real entry point, as the runtime calls it.
  const waited = [];
  report = await worker.scheduled({ cron: FREQUENT, scheduledTime: Date.now() }, env, { waitUntil: (p) => waited.push(p) });
  assert.equal(waited.length, 1);
  assert.ok("reminders" in report && "mail" in report);
});

test("daily: prunes old rows and refreshes badges from other people's activity", async () => {
  const env = makeEnv();
  await pair(env);
  const ana = uid(env, "ana");
  const t = now();
  env.DB.raw.prepare("INSERT INTO rate (user_id, minute, n) VALUES (?, ?, 1)").run(ana, Math.floor(t / 60) - 500);
  env.DB.raw.prepare("INSERT INTO notifications (id, user_id, kind, read, created_at) VALUES ('n_old', ?, 'follow', 1, ?)").run(ana, t - 200 * 86400);
  env.DB.raw.prepare("INSERT INTO notifications (id, user_id, kind, read, created_at) VALUES ('n_old_unread', ?, 'follow', 0, ?)").run(ana, t - 200 * 86400);
  const p = await prune(env, t);
  assert.equal(p.rate, 1);
  assert.equal(p.notifications, 1);
  assert.ok(rows(env, "SELECT 1 FROM notifications WHERE id = 'n_old_unread'").length, "unread ones stay");

  await call(env, "POST", "/v1/posts", { as: ANA, body: { title: "Open lava flows", kind: "dataset", licence: "CC-BY-4.0", visibility: "public" } });
  const report = await worker.scheduled({ cron: DAILY, scheduledTime: Date.now() }, env, {});
  assert.ok(report.badges.checked >= 1, JSON.stringify(report));
  assert.ok(rows(env, "SELECT 1 FROM badges WHERE user_id = ? AND badge = 'open-data-contributor'", ana).length);
});
