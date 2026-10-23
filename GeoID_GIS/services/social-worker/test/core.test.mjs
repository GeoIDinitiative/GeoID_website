/**
 * Core routes: profiles, posts, media, discovery, notifications.
 * Every response goes through `api()`, which fails the test if an email
 * address appears anywhere in it -- the one exemption is /v1/me/export,
 * where the caller's own address is the point.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";

const ANA = "ana@example.com";
const BOB = "bob@example.com";
const CAT = "cat@example.com";
const ADMIN = "admin@example.com";

async function api(env, method, path, opts = {}) {
  const res = await call(env, method, path, opts);
  if (!path.startsWith("/v1/me/export")) {
    const text = res.body instanceof ArrayBuffer ? new TextDecoder().decode(res.body) : JSON.stringify(res.body);
    assert.ok(!text.includes("@example.com"), `${method} ${path} leaked an email: ${text.slice(0, 300)}`);
  }
  return res;
}

/** Sign everybody in once so their rows (and handles ana/bob/cat) exist. */
async function world() {
  const env = makeEnv();
  for (const who of [ANA, BOB, CAT, ADMIN]) assert.equal((await api(env, "GET", "/v1/me", { as: who })).status, 200);
  return env;
}

const post = async (env, as, body) => {
  const res = await api(env, "POST", "/v1/posts", { as, body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
const uid = (env, handle) => env.DB.raw.prepare("SELECT id FROM users WHERE handle = ?").get(handle).id;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const fileForm = (bytes, name = "a.png", scope) => {
  const form = new FormData();
  form.append("file", new Blob([bytes]), name);
  if (scope) form.append("scope", scope);
  return form;
};

// ── profiles ───────────────────────────────────────────────────────────────

test("me: 401 signed out, created on first sight, editable", async () => {
  const env = makeEnv();
  assert.equal((await api(env, "GET", "/v1/me")).status, 401);
  const me = await api(env, "GET", "/v1/me", { as: ANA });
  assert.equal(me.body.user.handle, "ana");
  assert.equal(me.body.user.handle_editable, true);
  assert.deepEqual(me.body.counts, { followers: 0, following: 0, posts: 0 });

  const patched = await api(env, "PATCH", "/v1/me", {
    as: ANA,
    body: { headline: "Volcanologist", skills: ["InSAR", "Python", "#insar"], availability: "open", website: "javascript:alert(1)x" },
  });
  assert.equal(patched.status, 400, "a javascript: website is refused");
  const ok = await api(env, "PATCH", "/v1/me", {
    as: ANA, body: { headline: "Volcanologist", skills: ["InSAR", "Python", "#insar"], availability: "open", handle: "ana_v" },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.user.skills, ["insar", "python"]);
  assert.equal(ok.body.user.handle, "ana_v");
  assert.equal((await api(env, "PATCH", "/v1/me", { as: ANA, body: { availability: "sometimes" } })).status, 400);
  await api(env, "GET", "/v1/me", { as: BOB });
  assert.equal((await api(env, "PATCH", "/v1/me", { as: BOB, body: { handle: "ana_v" } })).status, 409);
  assert.equal((await api(env, "PATCH", "/v1/me", { as: BOB, body: { handle: "No!" } })).status, 400);
});

test("people search, profile page and portfolio items", async () => {
  const env = await world();
  await api(env, "PATCH", "/v1/me", { as: ANA, body: { skills: ["insar"], availability: "open", regions: ["Sicily"] } });
  let res = await api(env, "GET", "/v1/users?skill=InSAR");
  assert.deepEqual(res.body.items.map((u) => u.handle), ["ana"]);
  assert.deepEqual(res.body.items[0].skills, ["insar"]);
  res = await api(env, "GET", "/v1/users?available=1&region=sicily");
  assert.deepEqual(res.body.items.map((u) => u.handle), ["ana"]);
  res = await api(env, "GET", "/v1/users?q=bo");
  assert.deepEqual(res.body.items.map((u) => u.handle), ["bob"]);

  const item = await api(env, "POST", "/v1/me/items", { as: ANA, body: { kind: "publication", title: "Etna paper", year: 2024, verified: true } });
  assert.equal(item.status, 200);
  assert.equal(item.body.verified, false, "verified is never self-set");
  const hidden = await api(env, "POST", "/v1/me/items", { as: ANA, body: { kind: "award", title: "Secret", visibility: "private" } });
  assert.equal((await api(env, "POST", "/v1/me/items", { as: ANA, body: { kind: "hobby", title: "x" } })).status, 400);
  assert.equal((await api(env, "PATCH", `/v1/me/items/${item.body.id}`, { as: BOB, body: { title: "mine" } })).status, 404);
  assert.equal((await api(env, "PATCH", `/v1/me/items/${item.body.id}`, { as: ANA, body: { title: "Etna, revised" } })).body.title, "Etna, revised");

  const page = await api(env, "GET", "/v1/users/ana", { as: BOB });
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.items.map((i) => i.title), ["Etna, revised"]);
  assert.equal((await api(env, "GET", "/v1/users/ana", { as: ANA })).body.items.length, 2);
  assert.equal((await api(env, "DELETE", `/v1/me/items/${hidden.body.id}`, { as: ANA })).status, 200);
  assert.equal((await api(env, "GET", "/v1/users/nobody_here")).status, 404);
});

test("follow anything, notify the followed person, list both ways", async () => {
  const env = await world();
  assert.equal((await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } })).status, 200);
  assert.equal((await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } })).status, 200, "idempotent");
  assert.equal((await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "bob" } })).status, 400);
  assert.equal((await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "planet", id: "x" } })).status, 400);
  await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "tag", id: "#Volcanology" } });
  await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "place", id: "37.7512,14.9934" } });
  await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "community", id: "volcanology" } });

  const following = await api(env, "GET", "/v1/me/following", { as: BOB });
  const ids = following.body.items.map((i) => `${i.type}:${i.id}`).sort();
  assert.deepEqual(ids, ["community:volcanology", "place:37.8,15.0", "tag:volcanology", "user:ana"]);

  const notes = await api(env, "GET", "/v1/notifications", { as: ANA });
  assert.equal(notes.body.items.length, 1, "one notification despite the repeated follow");
  assert.equal(notes.body.items[0].kind, "follow");
  assert.equal(notes.body.items[0].actor.handle, "bob");

  assert.deepEqual((await api(env, "GET", "/v1/users/ana/followers")).body.items.map((u) => u.handle), ["bob"]);
  assert.deepEqual((await api(env, "GET", "/v1/users/bob/following")).body.items.map((u) => u.handle), ["ana"]);
  const rel = await api(env, "GET", "/v1/users/ana", { as: BOB });
  assert.equal(rel.body.relationship.following, true);
  assert.equal(rel.body.counts.followers, 1);

  await api(env, "DELETE", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } });
  assert.equal((await api(env, "GET", "/v1/users/ana/followers")).body.items.length, 0);
});

test("blocking removes follows both ways and hides people from each other", async () => {
  const env = await world();
  await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } });
  await api(env, "POST", "/v1/follow", { as: ANA, body: { type: "user", id: "bob" } });
  assert.equal((await api(env, "POST", "/v1/blocks", { as: ANA, body: { handle: "bob" } })).status, 200);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM follows WHERE target_type = 'user'").get().n, 0);
  assert.equal((await api(env, "GET", "/v1/users/ana", { as: BOB })).status, 404, "the blocked side cannot see the blocker");
  const fromAna = await api(env, "GET", "/v1/users/bob", { as: ANA });
  assert.equal(fromAna.body.relationship.blocked, true, "the blocker can still find them to unblock");
  assert.equal((await api(env, "GET", "/v1/users?q=ana", { as: BOB })).body.items.length, 0);
  assert.equal((await api(env, "GET", "/v1/search?type=people&q=bob", { as: ANA })).body.items.length, 0);
  assert.equal((await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } })).status, 403);
  assert.deepEqual((await api(env, "GET", "/v1/blocks", { as: ANA })).body.items.map((u) => u.handle), ["bob"]);
  await api(env, "DELETE", "/v1/blocks/bob", { as: ANA });
  assert.equal((await api(env, "GET", "/v1/users/ana", { as: BOB })).status, 200);
});

// ── posts ──────────────────────────────────────────────────────────────────

test("create validates enums, needs content, snaps location before storing", async () => {
  const env = await world();
  assert.equal((await api(env, "POST", "/v1/posts", { body: { title: "x" } })).status, 401);
  assert.equal((await api(env, "POST", "/v1/posts", { as: ANA, body: { title: "", body: "" } })).status, 400);
  assert.equal((await api(env, "POST", "/v1/posts", { as: ANA, body: { title: "x", kind: "tweet" } })).status, 400);
  assert.equal((await api(env, "POST", "/v1/posts", { as: ANA, body: { title: "x", provenance: "gossip" } })).status, 400);
  assert.equal((await api(env, "POST", "/v1/posts", { as: ANA, body: { title: "x", visibility: "friends" } })).status, 400);
  assert.equal((await api(env, "POST", "/v1/posts", { as: ANA, body: { title: "x", visibility: "team" } })).status, 400);

  const p = await post(env, ANA, {
    title: "Fumarole", kind: "observation", tags: ["Etna", "volcanology"],
    location: { lat: 37.75123, lon: 14.99344, precision: "approx", place: "Etna" },
    scene: { world: "earth", camera: { lat: 37.75123, lon: 14.99344, alt: 3000 }, annotations: [{ lat: 37.75123, lon: 14.99344, text: "here" }] },
    links: [{ url: "javascript:alert(1)" }, { url: "https://example.org/a", label: "ok" }],
  });
  assert.deepEqual(p.location, { lat: 37.8, lon: 15, precision: "approx", place: "Etna" });
  const stored = env.DB.raw.prepare("SELECT lat, lon FROM posts WHERE id = ?").get(p.id);
  assert.deepEqual({ ...stored }, { lat: 37.8, lon: 15 }, "the exact point never reached the database");
  assert.equal(p.scene.camera.lat, 37.8, "scene coordinates follow the post's precision");
  assert.equal(p.scene.annotations[0].lon, 15);
  assert.deepEqual(p.links.map((l) => l.url), ["https://example.org/a"]);
  assert.deepEqual(p.tags, ["etna", "volcanology"]);
  assert.deepEqual(env.DB.raw.prepare("SELECT tag FROM post_tags WHERE post_id = ? ORDER BY tag").all(p.id).map((r) => r.tag), ["etna", "volcanology"]);

  const h = await post(env, ANA, { title: "Secret spring", location: { lat: 37.1, lon: 14.2, precision: "hidden" } });
  assert.equal(h.location, null);

  // PATCH keeps post_tags in sync and is author-only.
  const edited = await api(env, "PATCH", `/v1/posts/${p.id}`, { as: ANA, body: { tags: ["insar"] } });
  assert.deepEqual(edited.body.tags, ["insar"]);
  assert.deepEqual(env.DB.raw.prepare("SELECT tag FROM post_tags WHERE post_id = ?").all(p.id).map((r) => r.tag), ["insar"]);
  assert.equal((await api(env, "PATCH", `/v1/posts/${p.id}`, { as: BOB, body: { title: "mine" } })).status, 403);
  assert.equal((await api(env, "DELETE", `/v1/posts/${p.id}`, { as: BOB })).status, 403);
  assert.equal((await api(env, "DELETE", `/v1/posts/${p.id}`, { as: ANA })).status, 200);
  assert.equal((await api(env, "GET", `/v1/posts/${p.id}`, { as: ANA })).status, 404);
});

test("followers-only and private posts are 404 to those who can't see them", async () => {
  const env = await world();
  const f = await post(env, ANA, { title: "For followers", visibility: "followers" });
  const pr = await post(env, ANA, { title: "Just me", visibility: "private" });
  assert.equal((await api(env, "GET", `/v1/posts/${f.id}`)).status, 404);
  assert.equal((await api(env, "GET", `/v1/posts/${f.id}`, { as: BOB })).status, 404);
  assert.equal((await api(env, "POST", `/v1/posts/${f.id}/comments`, { as: BOB, body: { body: "hi" } })).status, 404);
  assert.equal((await api(env, "POST", `/v1/posts/${f.id}/react`, { as: BOB, body: { kind: "like" } })).status, 404);
  assert.equal((await api(env, "PATCH", `/v1/posts/${f.id}`, { as: BOB, body: { title: "x" } })).status, 404);
  await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } });
  const seen = await api(env, "GET", `/v1/posts/${f.id}`, { as: BOB });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.viewer.following_author, true);
  assert.equal((await api(env, "GET", `/v1/posts/${pr.id}`, { as: BOB })).status, 404);
  const feed = await api(env, "GET", "/v1/feed?tab=following", { as: BOB });
  assert.deepEqual(feed.body.items.map((p) => p.title), ["For followers"]);
  const author = await api(env, "GET", "/v1/feed?tab=following&author=ana", { as: CAT });
  assert.equal(author.status, 200);
  assert.equal(author.body.items.length, 0);
});

test("team and community posts need membership", async () => {
  const env = await world();
  const ana = uid(env, "ana");
  env.DB.raw.prepare("INSERT INTO teams (id, slug, name, created_by, created_at) VALUES ('t_1','lab','Lab',?,0)").run(ana);
  env.DB.raw.prepare("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES ('t_1', ?, 'lead', 0)").run(ana);
  assert.equal((await api(env, "POST", "/v1/posts", { as: BOB, body: { title: "x", visibility: "team", team_id: "lab" } })).status, 403);
  const t = await post(env, ANA, { title: "Lab note", visibility: "team", team_id: "lab" });
  assert.equal((await api(env, "GET", `/v1/posts/${t.id}`, { as: BOB })).status, 404);
  env.DB.raw.prepare("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES ('t_1', ?, 'member', 1)").run(uid(env, "bob"));
  assert.equal((await api(env, "GET", `/v1/posts/${t.id}`, { as: BOB })).status, 200);

  assert.equal((await api(env, "POST", "/v1/posts", { as: ANA, body: { title: "x", community_id: "volcanology" } })).status, 403);
  env.DB.raw.prepare("INSERT INTO community_members (community_id, user_id, created_at) VALUES ('cm_volcanology', ?, 0)").run(ana);
  const c = await post(env, ANA, { title: "Members only", visibility: "community", community_id: "volcanology" });
  assert.equal(c.community_id, "cm_volcanology");
  assert.equal((await api(env, "GET", `/v1/posts/${c.id}`, { as: CAT })).status, 404);
});

test("a block hides posts and stops comments both ways", async () => {
  const env = await world();
  const p = await post(env, ANA, { title: "Public thing" });
  const c = await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: CAT, body: { body: "nice" } });
  assert.equal(c.status, 200);
  await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: BOB, body: { body: "bob was here" } });
  await api(env, "POST", "/v1/blocks", { as: ANA, body: { handle: "bob" } });
  assert.equal((await api(env, "GET", `/v1/posts/${p.id}`, { as: BOB })).status, 404);
  assert.equal((await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: BOB, body: { body: "hello?" } })).status, 404);
  const discover = await api(env, "GET", "/v1/feed?tab=discover", { as: BOB });
  assert.ok(!discover.body.items.some((x) => x.id === p.id));
  // Cat blocks bob: bob's comment drops out of cat's view of ana's thread.
  await api(env, "POST", "/v1/blocks", { as: CAT, body: { handle: "bob" } });
  const thread = await api(env, "GET", `/v1/posts/${p.id}/comments`, { as: CAT });
  assert.deepEqual(thread.body.items.map((x) => x.body), ["nice"]);
});

test("reaction, comment and fork counts stay consistent", async () => {
  const env = await world();
  const p = await post(env, ANA, { title: "Countable", kind: "workflow" });
  await api(env, "POST", `/v1/posts/${p.id}/react`, { as: BOB, body: { kind: "like" } });
  await api(env, "POST", `/v1/posts/${p.id}/react`, { as: BOB, body: { kind: "like" } });
  let r = await api(env, "POST", `/v1/posts/${p.id}/react`, { as: CAT, body: { kind: "insightful" } });
  assert.equal(r.body.counts.reactions, 2, "a double tap counts once");
  assert.equal((await api(env, "POST", `/v1/posts/${p.id}/react`, { as: CAT, body: { kind: "love" } })).status, 400);
  r = await api(env, "DELETE", `/v1/posts/${p.id}/react`, { as: BOB, body: { kind: "like" } });
  assert.equal(r.body.counts.reactions, 1);
  assert.deepEqual(r.body.viewer.reacted, []);
  await api(env, "DELETE", `/v1/posts/${p.id}/react`, { as: BOB, body: { kind: "like" } });
  assert.equal((await api(env, "GET", `/v1/posts/${p.id}`)).body.counts.reactions, 1, "unreacting twice does not go negative");

  const c1 = await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: BOB, body: { body: "first", lat: 37.75123, lon: 14.99 } });
  assert.deepEqual(c1.body.location, { lat: 37.8, lon: 15 }, "a comment's point on an unplaced post is snapped to approx");
  const c2 = await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: CAT, body: { body: "reply", parent_id: c1.body.id } });
  assert.equal(c2.body.parent_id, c1.body.id);
  assert.equal((await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: CAT, body: { body: "x", kind: "rant" } })).status, 400);
  assert.equal((await api(env, "GET", `/v1/posts/${p.id}`)).body.counts.comments, 2);
  assert.equal((await api(env, "DELETE", `/v1/comments/${c2.body.id}`, { as: BOB })).status, 403, "a stranger to the comment can't remove it");
  assert.equal((await api(env, "DELETE", `/v1/comments/${c2.body.id}`, { as: ANA })).status, 200, "the post author can");
  await api(env, "DELETE", `/v1/comments/${c2.body.id}`, { as: ANA });
  assert.equal((await api(env, "GET", `/v1/posts/${p.id}`)).body.counts.comments, 1);
  assert.equal((await api(env, "GET", `/v1/posts/${p.id}/comments`)).body.items.length, 1);

  const fork = await api(env, "POST", `/v1/posts/${p.id}/fork`, { as: BOB, body: {} });
  assert.equal(fork.status, 200);
  assert.equal(fork.body.forked_from, p.id);
  assert.equal((await api(env, "GET", `/v1/posts/${p.id}`)).body.counts.forks, 1);
  assert.deepEqual((await api(env, "GET", `/v1/posts/${p.id}/forks`)).body.items.map((x) => x.id), [fork.body.id]);
  await api(env, "DELETE", `/v1/posts/${fork.body.id}`, { as: BOB });
  assert.equal((await api(env, "GET", `/v1/posts/${p.id}`)).body.counts.forks, 0, "a removed fork stops counting");
});

test("fork respects allow_fork and cannot widen a restricted post", async () => {
  const env = await world();
  const closed = await post(env, ANA, { title: "No forks", allow_fork: false });
  assert.equal((await api(env, "POST", `/v1/posts/${closed.id}/fork`, { as: BOB })).status, 403);
  const f = await post(env, ANA, { title: "Followers' method", visibility: "followers", method: { software: "GMT" } });
  await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } });
  assert.equal((await api(env, "POST", `/v1/posts/${f.id}/fork`, { as: BOB, body: { visibility: "public" } })).status, 400);
  const fork = await api(env, "POST", `/v1/posts/${f.id}/fork`, { as: BOB, body: { title: "My copy" } });
  assert.equal(fork.body.visibility, "private");
  assert.deepEqual(fork.body.method, { software: "GMT" });
  const notes = await api(env, "GET", "/v1/notifications", { as: ANA });
  assert.ok(notes.body.items.some((n) => n.kind === "fork"));
});

test("@mentions notify only people who can see the post", async () => {
  const env = await world();
  await post(env, BOB, { title: "Etna", body: "Thoughts @cat? (mail me at bob@uni.ac.uk is not a mention)" });
  let notes = await api(env, "GET", "/v1/notifications", { as: CAT });
  assert.deepEqual(notes.body.items.map((n) => n.kind), ["mention"]);
  await post(env, BOB, { title: "Quiet", body: "@ana you can't see this", visibility: "followers" });
  notes = await api(env, "GET", "/v1/notifications", { as: ANA });
  assert.equal(notes.body.items.length, 0, "a mention must not reveal a post its target can't read");
  // In a comment: the post author is notified as a comment, a mentioned third party as a mention.
  const p = await post(env, ANA, { title: "Public" });
  await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: BOB, body: { body: "agree with @cat and @ana" } });
  notes = await api(env, "GET", "/v1/notifications", { as: ANA });
  assert.deepEqual(notes.body.items.map((n) => n.kind), ["comment"]);
  notes = await api(env, "GET", "/v1/notifications", { as: CAT });
  assert.deepEqual(notes.body.items.map((n) => n.kind), ["mention", "mention"]);
  // An edit does not re-ping somebody already mentioned.
  const m = await post(env, ANA, { title: "x", body: "@cat" });
  await api(env, "PATCH", `/v1/posts/${m.id}`, { as: ANA, body: { body: "@cat again" } });
  assert.equal((await api(env, "GET", "/v1/notifications", { as: CAT })).body.items.length, 3);
});

test("comment and reaction notifications reach post author and parent commenter", async () => {
  const env = await world();
  const p = await post(env, ANA, { title: "Thread" });
  const c = await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: BOB, body: { body: "top" } });
  await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: CAT, body: { body: "reply", parent_id: c.body.id } });
  await api(env, "POST", `/v1/posts/${p.id}/react`, { as: CAT, body: { kind: "useful" } });
  const ana = await api(env, "GET", "/v1/notifications", { as: ANA });
  assert.deepEqual(ana.body.items.map((n) => n.kind).sort(), ["comment", "comment", "reaction"]);
  const bob = await api(env, "GET", "/v1/notifications?unread=1", { as: BOB });
  assert.deepEqual(bob.body.items.map((n) => n.kind), ["comment"]);
  const read = await api(env, "POST", "/v1/notifications/read", { as: ANA, body: { ids: [ana.body.items[0].id] } });
  assert.equal(read.body.unread, 2);
  await api(env, "POST", "/v1/notifications/read", { as: ANA, body: {} });
  assert.equal((await api(env, "GET", "/v1/notifications?unread=1", { as: ANA })).body.items.length, 0);
  assert.equal((await api(env, "GET", "/v1/me", { as: ANA })).body.unread.notifications, 0);
});

test("questions, bookmarks, verifications, citations", async () => {
  const env = await world();
  const q = await post(env, ANA, { title: "Why?", kind: "question" });
  const a = await api(env, "POST", `/v1/posts/${q.id}/comments`, { as: BOB, body: { body: "Because." } });
  assert.equal((await api(env, "POST", `/v1/posts/${q.id}/accept`, { as: BOB, body: { comment_id: a.body.id } })).status, 403);
  const acc = await api(env, "POST", `/v1/posts/${q.id}/accept`, { as: ANA, body: { comment_id: a.body.id } });
  assert.equal(acc.body.accepted_comment_id, a.body.id);
  assert.equal((await api(env, "GET", `/v1/posts/${q.id}/comments`)).body.items[0].accepted, true);

  await api(env, "POST", `/v1/posts/${q.id}/bookmark`, { as: CAT, body: { collection: "Reading" } });
  let bm = await api(env, "GET", "/v1/me/bookmarks?collection=Reading", { as: CAT });
  assert.deepEqual(bm.body.items.map((p) => p.id), [q.id]);
  assert.equal(bm.body.items[0].viewer.bookmarked, true);
  await api(env, "PATCH", `/v1/posts/${q.id}`, { as: ANA, body: { visibility: "private" } });
  bm = await api(env, "GET", "/v1/me/bookmarks", { as: CAT });
  assert.equal(bm.body.items.length, 0, "a post made private drops out of other people's bookmarks");

  const obs = await post(env, ANA, { title: "Ash fall", kind: "observation" });
  assert.equal(obs.verification.status, "unverified");
  assert.equal((await api(env, "POST", `/v1/posts/${obs.id}/verify`, { as: ANA, body: { verdict: "confirm" } })).status, 403);
  assert.equal((await api(env, "POST", `/v1/posts/${q.id}/verify`, { as: BOB, body: { verdict: "confirm" } })).status, 404, "private now");
  assert.equal((await api(env, "POST", `/v1/posts/${obs.id}/verify`, { as: BOB, body: { verdict: "maybe" } })).status, 400);
  await api(env, "POST", `/v1/posts/${obs.id}/verify`, { as: BOB, body: { verdict: "confirm" } });
  const v = await api(env, "POST", `/v1/posts/${obs.id}/verify`, { as: CAT, body: { verdict: "confirm", note: "saw it" } });
  assert.deepEqual(v.body.verification, { confirms: 2, disputes: 0, status: "community-verified" });
  assert.equal(v.body.viewer.verified, "confirm");
  const text = await post(env, ANA, { title: "Plain" });
  assert.equal((await api(env, "POST", `/v1/posts/${text.id}/verify`, { as: BOB, body: { verdict: "confirm" } })).status, 400);

  const cite = await api(env, "GET", `/v1/posts/${obs.id}/cite`);
  assert.match(cite.body.text, /^ana \(\d{4}\)\. Ash fall\. GeoHUB Social\. http/);
  assert.match(cite.body.bibtex, /@misc\{geohub_/);
  assert.equal((await api(env, "GET", `/v1/posts/${q.id}/cite`)).status, 404);
});

test("feeds: discover ranks engagement and skips followed authors; tabs filter", async () => {
  const env = await world();
  const quiet = await post(env, ANA, { title: "Quiet" });
  const loud = await post(env, ANA, { title: "Loud" });
  const fromCat = await post(env, CAT, { title: "Cat's", tags: ["volcanology"] });
  // Make "quiet" the newest and "loud" the most engaged.
  env.DB.raw.prepare("UPDATE posts SET created_at = created_at - 3600 WHERE id IN (?, ?)").run(loud.id, fromCat.id);
  await api(env, "POST", `/v1/posts/${loud.id}/react`, { as: BOB, body: { kind: "like" } });
  await api(env, "POST", `/v1/posts/${loud.id}/comments`, { as: BOB, body: { body: "!" } });
  let d = await api(env, "GET", "/v1/feed?tab=discover", { as: CAT });
  assert.deepEqual(d.body.items.map((p) => p.title), ["Loud", "Quiet"], "own posts left out, engagement first");
  d = await api(env, "GET", "/v1/feed");
  assert.equal(d.body.items[0].title, "Loud");
  await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "user", id: "ana" } });
  d = await api(env, "GET", "/v1/feed?tab=discover", { as: BOB });
  assert.deepEqual(d.body.items.map((p) => p.title), ["Cat's"]);

  await api(env, "POST", "/v1/follow", { as: BOB, body: { type: "tag", id: "volcanology" } });
  const f = await api(env, "GET", "/v1/feed?tab=following", { as: BOB });
  assert.deepEqual(f.body.items.map((p) => p.title).sort(), ["Cat's", "Loud", "Quiet"]);
  assert.equal((await api(env, "GET", "/v1/feed?tab=following")).status, 401);

  await post(env, ANA, { title: "Data", kind: "dataset" });
  await post(env, ANA, { title: "Postdoc", kind: "opportunity", meta: { type: "job", skills: ["InSAR"], apply_url: "https://x.org" } });
  await post(env, ANA, { title: "Grant", kind: "opportunity", meta: { type: "grant" } });
  assert.equal((await api(env, "POST", "/v1/posts", { as: ANA, body: { title: "bad", kind: "opportunity", meta: { type: "gig" } } })).status, 400);
  assert.deepEqual((await api(env, "GET", "/v1/feed?tab=research")).body.items.map((p) => p.title), ["Data"]);
  assert.deepEqual((await api(env, "GET", "/v1/feed?tab=opportunities&type=job&skill=insar")).body.items.map((p) => p.title), ["Postdoc"]);
  await post(env, ANA, { title: "Placed", location: { lat: 10, lon: 10, precision: "region" } });
  assert.deepEqual((await api(env, "GET", "/v1/feed?tab=world")).body.items.map((p) => p.title), ["Placed"]);
  assert.deepEqual((await api(env, "GET", "/v1/feed?tab=world&tag=volcanology")).body.items.length, 0);
});

test("feed pages with cursors, discover with an offset cursor", async () => {
  const env = await world();
  for (let i = 0; i < 25; i += 1) await post(env, ANA, { title: `n${i}`, kind: "paper" });
  const one = await api(env, "GET", "/v1/feed?tab=research");
  assert.equal(one.body.items.length, 20);
  const two = await api(env, "GET", `/v1/feed?tab=research&cursor=${encodeURIComponent(one.body.next)}`);
  assert.equal(two.body.items.length, 5);
  assert.equal(two.body.next, null);
  const seen = new Set([...one.body.items, ...two.body.items].map((p) => p.id));
  assert.equal(seen.size, 25);
  const d1 = await api(env, "GET", "/v1/feed?tab=discover");
  const d2 = await api(env, "GET", `/v1/feed?tab=discover&cursor=${encodeURIComponent(d1.body.next)}`);
  assert.equal(new Set([...d1.body.items, ...d2.body.items].map((p) => p.id)).size, 25);
});

// ── media ──────────────────────────────────────────────────────────────────

test("media: sniffed types only, size limit, scopes enforced, headers set", async () => {
  const env = await world();
  const up = await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(PNG, "x.txt") });
  assert.equal(up.status, 200);
  assert.equal(up.body.type, "image/png", "type from bytes, not from the name");
  assert.match(up.body.key, /^m\/u_[0-9a-f]+\/[0-9a-f]{24}\.png$/);
  assert.equal(env.MEDIA.store.get(up.body.key).httpMetadata.contentType, "image/png");
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  assert.equal((await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(html, "evil.png") })).status, 400);
  const big = new Uint8Array(8 * 1024 * 1024 + 1); big.set(PNG);
  assert.equal((await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(big) })).status, 413);
  assert.equal((await api(env, "POST", "/v1/media", { form: fileForm(PNG) })).status, 401);

  const path = (k) => `/v1/media/${encodeURIComponent(k)}`;
  const pub = await api(env, "GET", path(up.body.key));
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get("x-content-type-options"), "nosniff");
  assert.equal(pub.headers.get("content-security-policy"), "default-src 'none'");
  assert.match(pub.headers.get("content-disposition"), /^inline/);
  assert.equal(new Uint8Array(pub.body)[0], 0x89);

  const pdf = new TextEncoder().encode("%PDF-1.7 draft");
  const own = await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(pdf, "d.pdf", "owner") });
  assert.equal(own.body.type, "application/pdf");
  assert.equal((await api(env, "GET", path(own.body.key))).status, 404);
  assert.equal((await api(env, "GET", path(own.body.key), { as: BOB })).status, 404);
  const mine = await api(env, "GET", path(own.body.key), { as: ANA });
  assert.equal(mine.status, 200);
  assert.match(mine.headers.get("content-disposition"), /^attachment/);

  assert.equal((await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(PNG, "a.png", "team:t_1") })).status, 403);
  const ana = uid(env, "ana");
  env.DB.raw.prepare("INSERT INTO teams (id, slug, name, created_by, created_at) VALUES ('t_1','lab','Lab',?,0)").run(ana);
  env.DB.raw.prepare("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES ('t_1', ?, 'lead', 0)").run(ana);
  const team = await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(PNG, "a.png", "team:t_1") });
  assert.equal(team.status, 200);
  assert.equal((await api(env, "GET", path(team.body.key), { as: BOB })).status, 404);
  env.DB.raw.prepare("INSERT INTO team_members (team_id, user_id, role, status, created_at) VALUES ('t_1', ?, 'member', 'invited', 1)").run(uid(env, "bob"));
  assert.equal((await api(env, "GET", path(team.body.key), { as: BOB })).status, 404, "an invitation is not membership");
  env.DB.raw.prepare("UPDATE team_members SET status = 'active' WHERE user_id = ?").run(uid(env, "bob"));
  assert.equal((await api(env, "GET", path(team.body.key), { as: BOB })).status, 200);

  // Conversation and review scopes, written directly as other modules would.
  env.DB.raw.prepare("INSERT INTO media (key, owner_id, type, bytes, scope, created_at) VALUES ('m/x/c.png', ?, 'image/png', 16, 'conversation:cv_1', 0)").run(ana);
  env.DB.raw.prepare("INSERT INTO media (key, owner_id, type, bytes, scope, created_at) VALUES ('m/x/r.pdf', ?, 'application/pdf', 5, 'review:r_1', 0)").run(ana);
  await env.MEDIA.put("m/x/c.png", PNG); await env.MEDIA.put("m/x/r.pdf", pdf);
  env.DB.raw.prepare("INSERT INTO conversations (id, created_by, last_at, created_at) VALUES ('cv_1', ?, 0, 0)").run(ana);
  env.DB.raw.prepare("INSERT INTO conversation_members (conversation_id, user_id) VALUES ('cv_1', ?)").run(uid(env, "cat"));
  env.DB.raw.prepare("INSERT INTO reviews (id, requester_id, title, created_at, updated_at) VALUES ('r_1', ?, 'Draft', 0, 0)").run(ana);
  env.DB.raw.prepare("INSERT INTO reviewers (review_id, user_id, status, created_at) VALUES ('r_1', ?, 'accepted', 0)").run(uid(env, "bob"));
  assert.equal((await api(env, "GET", path("m/x/c.png"), { as: CAT })).status, 200);
  assert.equal((await api(env, "GET", path("m/x/c.png"), { as: BOB })).status, 404);
  assert.equal((await api(env, "GET", path("m/x/r.pdf"), { as: BOB })).status, 200);
  assert.equal((await api(env, "GET", path("m/x/r.pdf"), { as: CAT })).status, 404);

  // Only your own keys go into a post; only the owner deletes.
  assert.equal((await api(env, "POST", "/v1/posts", { as: BOB, body: { title: "x", media: [{ key: up.body.key }] } })).status, 400);
  const withMedia = await post(env, ANA, { title: "pic", media: [{ key: up.body.key, alt: "a fumarole" }] });
  assert.equal(withMedia.media[0].type, "image/png");
  assert.equal(withMedia.media[0].alt, "a fumarole");
  assert.equal((await api(env, "DELETE", path(up.body.key), { as: BOB })).status, 403);
  assert.equal((await api(env, "DELETE", path(own.body.key), { as: BOB })).status, 404);
  assert.equal((await api(env, "DELETE", path(up.body.key), { as: ANA })).status, 200);
  assert.equal(env.MEDIA.store.has(up.body.key), false);
});

test("avatar must be the user's own public image", async () => {
  const env = await world();
  const up = await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(PNG) });
  assert.equal((await api(env, "PATCH", "/v1/me", { as: BOB, body: { avatar_key: up.body.key } })).status, 400);
  const me = await api(env, "PATCH", "/v1/me", { as: ANA, body: { avatar_key: up.body.key } });
  assert.match(me.body.user.avatar, /\/v1\/media\/m%2F/);
});

// ── discovery ──────────────────────────────────────────────────────────────

test("map: hidden locations never appear; points, then clusters past 300", async () => {
  const env = await world();
  await post(env, ANA, { title: "Seen", kind: "observation", location: { lat: 37.75123, lon: 14.99344, precision: "approx" } });
  await post(env, ANA, { title: "Hidden", location: { lat: 37.7, lon: 15.0, precision: "hidden" } });
  await post(env, ANA, { title: "Followers", visibility: "followers", location: { lat: 37.7, lon: 15.0, precision: "exact" } });
  await post(env, BOB, { title: "Mars", world: "mars", location: { lat: 1, lon: 1, precision: "exact" } });
  env.DB.raw.prepare(`INSERT INTO projects (id, owner_id, title, visibility, lat, lon, loc_precision, created_at, updated_at)
    VALUES ('pr_1', ?, 'Etna twin', 'public', 37.7, 15.0, 'approx', 0, 0)`).run(uid(env, "ana"));
  env.DB.raw.prepare(`INSERT INTO projects (id, owner_id, title, visibility, lat, lon, loc_precision, created_at, updated_at)
    VALUES ('pr_2', ?, 'Secret twin', 'private', 37.7, 15.0, 'approx', 0, 0)`).run(uid(env, "ana"));

  const m = await api(env, "GET", "/v1/map?world=earth&bbox=14,37,16,38&z=8");
  assert.deepEqual(m.body.points.map((p) => p.title).sort(), ["Etna twin", "Seen"]);
  const seen = m.body.points.find((p) => p.title === "Seen");
  assert.deepEqual([seen.lat, seen.lon, seen.precision], [37.8, 15, "approx"]);
  assert.equal(seen.verification.status, "unverified");
  assert.equal(seen.author.handle, "ana");
  assert.ok(!JSON.stringify(m.body).includes("Hidden"));
  const mine = await api(env, "GET", "/v1/map?layer=mine", { as: ANA });
  assert.deepEqual(mine.body.points.map((p) => p.title).sort(), ["Etna twin", "Followers", "Secret twin", "Seen"]);
  assert.equal((await api(env, "GET", "/v1/map?layer=mine")).status, 401);
  assert.deepEqual((await api(env, "GET", "/v1/map?world=mars")).body.points.map((p) => p.title), ["Mars"]);
  assert.deepEqual((await api(env, "GET", "/v1/map?kinds=project")).body.points.map((p) => p.title), ["Etna twin"]);

  const insert = env.DB.raw.prepare(`INSERT INTO posts (id, author_id, kind, title, lat, lon, loc_precision, created_at, updated_at)
    VALUES (?, ?, 'observation', 'bulk', ?, ?, 'approx', 0, 0)`);
  const bob = uid(env, "bob");
  for (let i = 0; i < 310; i += 1) insert.run(`p_bulk${i}`, bob, i % 2 ? 10.1 : -20.1, i % 2 ? 10.1 : 40.1);
  const c = await api(env, "GET", "/v1/map?z=2");
  assert.equal(c.body.points.length, 0);
  const total = c.body.clusters.reduce((n, x) => n + x.count, 0);
  assert.equal(total, 312, "310 bulk + Seen + the public project, never the hidden one");
  const south = c.body.clusters.find((x) => x.lat < 0);
  assert.deepEqual(south, { lat: -20.1, lon: 40.1, count: 155, kinds: { observation: 155 } });
  const north = c.body.clusters.find((x) => x.lat > 0);
  assert.deepEqual(north.kinds, { observation: 156, project: 1 }, "Seen and the project share the 90-degree cell");
});

test("search, trending tags, places and events", async () => {
  const env = await world();
  await post(env, ANA, { title: "Etna deformation", tags: ["insar", "etna"], location: { lat: 37.75, lon: 15.0, precision: "approx" }, community_id: undefined });
  await post(env, ANA, { title: "Private Etna", visibility: "private", tags: ["secret-tag"] });
  await post(env, BOB, { title: "Etna by followers", visibility: "followers", location: { lat: 37.7, lon: 15.0, precision: "approx" } });
  assert.equal((await api(env, "GET", "/v1/search?q=e")).status, 400);
  assert.deepEqual((await api(env, "GET", "/v1/search?q=etna")).body.items.map((p) => p.title), ["Etna deformation"]);
  assert.equal((await api(env, "GET", "/v1/search?q=etna", { as: ANA })).body.items.length, 2);
  assert.equal((await api(env, "GET", "/v1/search?q=100%25")).body.items.length, 0, "% is literal");
  assert.deepEqual((await api(env, "GET", "/v1/search?type=tags&q=ins")).body.items, [{ tag: "insar", count: 1 }]);
  assert.equal((await api(env, "GET", "/v1/search?type=tags&q=secret")).body.items.length, 0);
  assert.deepEqual((await api(env, "GET", "/v1/search?type=communities&q=volcan")).body.items.map((c) => c.slug), ["volcanology"]);
  assert.equal((await api(env, "GET", "/v1/search?type=whatever&q=etna")).status, 400);
  const trend = await api(env, "GET", "/v1/tags/trending");
  assert.deepEqual(trend.body.items.map((t) => t.tag).sort(), ["etna", "insar"]);

  const place = await api(env, "GET", "/v1/places?lat=37.75&lon=15&radius_km=30");
  assert.deepEqual(place.body.posts.map((p) => p.title), ["Etna deformation"]);
  assert.deepEqual(place.body.people.map((u) => u.handle), ["ana"]);
  const asBob = await api(env, "GET", "/v1/places?lat=37.75&lon=15", { as: BOB });
  assert.equal(asBob.body.posts.length, 2);
  assert.deepEqual(asBob.body.people.map((u) => u.handle), ["ana"], "a followers-only post does not list its author");
  assert.equal((await api(env, "GET", "/v1/places?lat=abc&lon=1")).status, 400);

  const soon = Math.floor(Date.now() / 1000) + 86400;
  await post(env, ANA, { title: "Later", kind: "event", meta: { starts_at: soon + 100, format: "webinar" } });
  await post(env, ANA, { title: "Sooner", kind: "event", meta: { starts_at: String(soon) } });
  await post(env, ANA, { title: "Past", kind: "event", meta: { starts_at: 1000 } });
  assert.equal((await api(env, "POST", "/v1/posts", { as: ANA, body: { title: "x", kind: "event", meta: { format: "party" } } })).status, 400);
  const ev = await api(env, "GET", "/v1/events");
  assert.deepEqual(ev.body.items.map((p) => p.title), ["Sooner", "Later"]);
  assert.deepEqual((await api(env, "GET", `/v1/events?until=${soon + 10}`)).body.items.map((p) => p.title), ["Sooner"]);
});

// ── UK GDPR ────────────────────────────────────────────────────────────────

test("export returns everything about the caller, with their own email, as a download", async () => {
  const env = await world();
  const p = await post(env, ANA, { title: "Mine" });
  await api(env, "POST", `/v1/posts/${p.id}/comments`, { as: ANA, body: { body: "note to self" } });
  await api(env, "POST", "/v1/follow", { as: ANA, body: { type: "user", id: "bob" } });
  await api(env, "POST", "/v1/blocks", { as: ANA, body: { handle: "cat" } });
  await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(PNG) });
  assert.equal((await api(env, "GET", "/v1/me/export")).status, 401);
  const res = await call(env, "GET", "/v1/me/export", { as: ANA });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="geohub-social-export\.json"/);
  const data = res.body;
  assert.equal(data.profile.email, ANA);
  assert.equal(data.posts.length, 1);
  assert.equal(data.comments.length, 1);
  assert.equal(data.media.length, 1);
  assert.deepEqual(data.follows.map((f) => f.target_id), ["bob"]);
  assert.deepEqual(data.blocks.map((b) => b.handle), ["cat"]);
  const text = JSON.stringify(data);
  assert.ok(!text.includes(BOB) && !text.includes(CAT), "nobody else's email");
  for (const key of ["profile_items", "reactions", "bookmarks", "verifications", "community_memberships", "team_memberships",
    "projects", "project_versions", "grants_made", "reviews_requested", "reviews_as_reviewer", "review_comments",
    "conversations", "messages_sent", "notifications", "reports_filed"]) {
    assert.ok(Array.isArray(data[key]), key);
  }
});

test("erasure leaves nothing about the person readable through the API", async () => {
  const env = await world();
  const ana = uid(env, "ana");
  await api(env, "PATCH", "/v1/me", { as: ANA, body: { bio: "Volcanologist in Catania", skills: ["insar"] } });
  const up = await api(env, "POST", "/v1/media", { as: ANA, form: fileForm(PNG) });
  const own = await post(env, ANA, { title: "Ana's post", body: "unique-ana-text", tags: ["anatag"], media: [{ key: up.body.key }], location: { lat: 37.7, lon: 15, precision: "approx" } });
  const bobs = await post(env, BOB, { title: "Bob's post" });
  await api(env, "POST", `/v1/posts/${bobs.id}/react`, { as: ANA, body: { kind: "like" } });
  await api(env, "POST", `/v1/posts/${bobs.id}/comments`, { as: ANA, body: { body: "unique-ana-comment" } });
  await api(env, "POST", `/v1/posts/${bobs.id}/fork`, { as: ANA });
  await api(env, "POST", "/v1/follow", { as: ANA, body: { type: "user", id: "bob" } });
  await api(env, "POST", "/v1/follow", { as: CAT, body: { type: "user", id: "ana" } });
  await api(env, "POST", "/v1/me/items", { as: ANA, body: { kind: "award", title: "Prize" } });
  env.DB.raw.prepare("INSERT INTO teams (id, slug, name, created_by, created_at) VALUES ('t_1','lab','Lab',?,0)").run(ana);
  env.DB.raw.prepare("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES ('t_1', ?, 'lead', 0)").run(ana);
  env.DB.raw.prepare("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES ('t_1', ?, 'member', 5)").run(uid(env, "bob"));
  env.DB.raw.prepare("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES ('t_1', ?, 'member', 9)").run(uid(env, "cat"));
  assert.equal((await api(env, "GET", `/v1/posts/${bobs.id}`)).body.counts.reactions, 1);

  assert.equal((await api(env, "DELETE", "/v1/me", { as: ANA, body: {} })).status, 400);
  assert.equal((await api(env, "DELETE", "/v1/me", { as: ANA, body: { confirm: "bob" } })).status, 400);
  assert.equal((await api(env, "DELETE", "/v1/me", { as: ANA, body: { confirm: "ana" } })).status, 200);

  assert.equal((await api(env, "GET", "/v1/users/ana")).status, 404);
  assert.equal((await api(env, "GET", `/v1/posts/${own.id}`)).status, 404);
  assert.equal((await api(env, "GET", "/v1/users?q=ana")).body.items.length, 0);
  assert.equal((await api(env, "GET", "/v1/search?type=people&q=former")).body.items.length, 0);
  assert.equal((await api(env, "GET", "/v1/search?q=unique-ana")).body.items.length, 0);
  assert.equal((await api(env, "GET", "/v1/search?type=tags&q=anatag")).body.items.length, 0);
  assert.equal((await api(env, "GET", `/v1/media/${encodeURIComponent(up.body.key)}`)).status, 404);
  assert.equal(env.MEDIA.store.size, 0, "the bytes are gone from R2");
  const after = await api(env, "GET", `/v1/posts/${bobs.id}`);
  assert.deepEqual(after.body.counts, { reactions: 0, comments: 0, forks: 0 });
  const thread = await api(env, "GET", `/v1/posts/${bobs.id}/comments`);
  assert.equal(thread.body.items.length, 0);
  assert.equal((await api(env, "GET", "/v1/users/cat/following")).body.items.length, 0);
  assert.equal((await api(env, "GET", "/v1/map")).body.points.length, 0);
  // The longest-standing remaining member leads the team now.
  assert.equal(env.DB.raw.prepare("SELECT role FROM team_members WHERE team_id = 't_1' AND user_id = ?").get(uid(env, "bob")).role, "lead");

  // Nothing identifying left in the database row or in any of their content.
  const row = env.DB.raw.prepare("SELECT * FROM users WHERE id = ?").get(ana);
  assert.equal(row.email, `erased:${ana}`);
  assert.equal(row.name, "Former member");
  assert.equal(row.bio, "");
  const dump = JSON.stringify([
    env.DB.raw.prepare("SELECT * FROM posts").all(),
    env.DB.raw.prepare("SELECT * FROM comments").all(),
    env.DB.raw.prepare("SELECT * FROM profile_items").all(),
    env.DB.raw.prepare("SELECT * FROM notifications").all(),
  ]);
  for (const needle of ["unique-ana", "Catania", "Prize", "anatag", "Ana's post"]) assert.ok(!dump.includes(needle), needle);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM audit WHERE action = 'erase_account'").get().n, 1);

  // Signing in again with the same email is a brand-new, empty account.
  const again = await api(env, "GET", "/v1/me", { as: ANA });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.counts, { followers: 0, following: 0, posts: 0 });
});

test("tab=all lists an author's own posts newest first, unlike discover", async () => {
  const env = makeEnv();
  const me = "allfeed@example.com";
  await call(env, "GET", "/v1/me", { as: me });
  for (const t of ["one", "two"]) await call(env, "POST", "/v1/posts", { as: me, body: { title: t, body: t } });
  const handle = (await call(env, "GET", "/v1/me", { as: me })).body.user.handle;
  const all = await call(env, "GET", `/v1/feed?tab=all&author=${handle}`, { as: me });
  assert.deepEqual(all.body.items.map((p) => p.title).sort(), ["one", "two"]);
  const implicit = await call(env, "GET", `/v1/feed?author=${handle}`, { as: me });
  assert.equal(implicit.body.items.length, 2);
  const discover = await call(env, "GET", "/v1/feed?tab=discover", { as: me });
  assert.equal(discover.body.items.length, 0);
});
