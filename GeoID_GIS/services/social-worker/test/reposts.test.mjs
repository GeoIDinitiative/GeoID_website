import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { parseRange, sniff } from "../media.js";
import { mergeWithReshares } from "../reposts.js";

const A = "ana@example.com", B = "ben@example.com", C = "cat@example.com";
async function setup() {
  const env = makeEnv();
  for (const [who, handle] of [[A, "ana"], [B, "ben"], [C, "cat"]]) await call(env, "PATCH", "/v1/me", { as: who, body: { handle } });
  return env;
}

test("reshare: public only, not your own, one live per member, counted, notified", async () => {
  const env = await setup();
  const pub = (await call(env, "POST", "/v1/posts", { as: A, body: { title: "Etna tonight" } })).body;
  const priv = (await call(env, "POST", "/v1/posts", { as: A, body: { title: "followers only", visibility: "followers" } })).body;
  await call(env, "POST", "/v1/follow", { as: B, body: { type: "user", id: "ana" } });
  assert.equal((await call(env, "POST", `/v1/posts/${priv.id}/repost`, { as: B, body: {} })).status, 403);
  assert.equal((await call(env, "POST", `/v1/posts/${pub.id}/repost`, { as: A, body: {} })).status, 400);
  const r1 = await call(env, "POST", `/v1/posts/${pub.id}/repost`, { as: B, body: {} });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const r2 = await call(env, "POST", `/v1/posts/${pub.id}/repost`, { as: B, body: { note: "Worth watching" } });
  assert.equal(r2.body.count, 1, "re-resharing replaces, never stacks");
  const post = await call(env, "GET", `/v1/posts/${pub.id}`, { as: B });
  assert.equal(post.body.counts.reposts, 1);
  assert.equal(post.body.viewer.reshared, true);
  const who = await call(env, "GET", `/v1/posts/${pub.id}/reposts`);
  assert.equal(who.body.items[0].user.handle, "ben");
  assert.equal(who.body.items[0].note, "Worth watching");
  const notes = await call(env, "GET", "/v1/notifications", { as: A });
  assert.ok(notes.body.items.some((n) => n.kind === "repost"));
  const off = await call(env, "DELETE", `/v1/posts/${pub.id}/repost`, { as: B });
  assert.equal(off.body.count, 0);
});

test("a reshare reaches the resharer's followers, marked, once, and pages cleanly", async () => {
  const env = await setup();
  // cat follows ben; ana's post reaches cat only through ben's reshare.
  await call(env, "POST", "/v1/follow", { as: C, body: { type: "user", id: "ben" } });
  const pub = (await call(env, "POST", "/v1/posts", { as: A, body: { title: "Lava dome" } })).body;
  let feed = await call(env, "GET", "/v1/feed?tab=following", { as: C });
  assert.equal(feed.body.items.length, 0);
  await call(env, "POST", `/v1/posts/${pub.id}/repost`, { as: B, body: { note: "Look" } });
  feed = await call(env, "GET", "/v1/feed?tab=following", { as: C });
  assert.equal(feed.body.items.length, 1);
  assert.equal(feed.body.items[0].id, pub.id);
  assert.equal(feed.body.items[0].reshared_by.user.handle, "ben");
  assert.equal(feed.body.items[0].reshared_by.note, "Look");
  // Ben's profile list shows it too.
  const mine = await call(env, "GET", "/v1/feed?author=ben", { as: C });
  assert.equal(mine.body.items[0].reshared_by.user.handle, "ben");
  // A block hides it.
  await call(env, "POST", "/v1/blocks", { as: C, body: { handle: "ana" } });
  feed = await call(env, "GET", "/v1/feed?tab=following", { as: C });
  assert.equal(feed.body.items.length, 0);
  assert.ok(!JSON.stringify(feed.body).includes("@example.com"));
});

test("merging posts and reshares keeps each post once, newest first, with a usable cursor", () => {
  const originals = [{ id: "p_3", created_at: 30 }, { id: "p_1", created_at: 10 }];
  const reshares = [{ id: "p_1", rs_id: "rp_9", rs_at: 40 }, { id: "p_2", rs_id: "rp_8", rs_at: 20 }];
  const m = mergeWithReshares(originals, reshares, 10);
  assert.deepEqual(m.rows.map((r) => r.id), ["p_1", "p_3", "p_2"]);
  assert.equal(m.cursor, null);
  const page = mergeWithReshares(originals, reshares, 2);
  assert.deepEqual(page.rows.map((r) => r.id), ["p_1", "p_3"]);
  assert.deepEqual(page.cursor, { created_at: 30, id: "p_3" });
});

test("video uploads: MP4 and WebM recognised from their bytes, HEIC and MKV refused, ranges served", async () => {
  const mp4 = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2avc1mp41")]);
  assert.equal(sniff(mp4)?.type, "video/mp4");
  const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
  assert.equal(sniff(heic), null);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("\u0093B\u0082\u0084webmB\u0087\u0081\u0004B\u0085\u0081\u0002"), ...new Array(16).fill(0)]);
  assert.equal(sniff(webm)?.type, "video/webm");
  const mkv = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from("B\u0082\u0088matroska"), ...new Array(24).fill(0)]);
  assert.equal(sniff(mkv), null);

  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.equal(parseRange("bytes=2000-", 1000), "bad");
  assert.equal(parseRange(null, 1000), null);

  const env = await setup();
  const big = new Uint8Array(4096); big.set(mp4);
  const form = new FormData();
  form.append("file", new Blob([big], { type: "video/mp4" }), "clip.mp4");
  const up = await call(env, "POST", "/v1/media", { as: A, form });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.type, "video/mp4");
  const part = await call(env, "GET", `/v1/media/${encodeURIComponent(up.body.key)}`, { headers: { Range: "bytes=0-1023" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 0-1023/4096");
  assert.equal(part.body.byteLength, 1024);
  assert.match(part.headers.get("content-disposition"), /^inline/);
});
