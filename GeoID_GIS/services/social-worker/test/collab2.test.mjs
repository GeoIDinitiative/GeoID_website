/**
 * v1.3 collaboration depth: requests for help, and the credit for corrections
 * and suggestions a post's author accepts. Every response is checked for an
 * email address on the way through.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";

async function api(env, method, path, opts = {}) {
  const res = await call(env, method, path, opts);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes("@example.com"), `${method} ${path} leaked an email: ${text.slice(0, 300)}`);
  return res;
}
const as = (handle) => `${handle}@example.com`;
const ok = (res, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  return res.body;
};
async function people(env, ...handles) {
  const ids = {};
  for (const h of handles) {
    ok(await api(env, "GET", "/v1/conversations", { as: as(h) }));
    ids[h] = env.DB.raw.prepare("SELECT id FROM users WHERE handle = ?").get(h).id;
  }
  return ids;
}
const row = (env, text, ...args) => env.DB.raw.prepare(text).get(...args);
const rows = (env, text, ...args) => env.DB.raw.prepare(text).all(...args);

// ── Requests ───────────────────────────────────────────────────────────────

test("a named request: only the requester and the person asked can open it; accepting opens a DM", async () => {
  const env = makeEnv();
  const ids = await people(env, "prof", "expert", "stranger");
  ok(await api(env, "POST", "/v1/requests", { as: as("prof"), body: { title: "x" } }), 400);
  ok(await api(env, "POST", "/v1/requests", { as: as("prof"), body: { title: "x", kind: "dance", handles: ["expert"] } }), 400);
  ok(await api(env, "POST", "/v1/requests", { as: as("prof"), body: { title: "x", handles: ["nobody_here"] } }), 404);
  const made = ok(await api(env, "POST", "/v1/requests", { as: as("prof"), body: {
    kind: "review_method", title: "Check my InSAR unwrapping", detail: "SNAPHU settings", skills: ["InSAR", "python"], handles: ["@expert"],
  } }));
  const rid = made.request.id;
  assert.equal(made.request.status, "open");
  assert.equal(made.request.audience, "member");
  assert.deepEqual(made.request.skills, ["insar", "python"]);
  assert.equal(made.viewer_role, "requester");
  assert.equal(made.participants[0].user.handle, "expert");
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'request' AND ref_id = ?", ids.expert, rid));

  ok(await api(env, "GET", `/v1/requests/${rid}`, { as: as("stranger") }), 404);
  ok(await api(env, "GET", `/v1/requests/${rid}`), 404);
  const open = ok(await api(env, "GET", "/v1/requests", { as: as("stranger") }));
  assert.equal(open.items.length, 0, "a named request is not discoverable");
  const asked = ok(await api(env, "GET", "/v1/requests?role=asked", { as: as("expert") }));
  assert.equal(asked.items[0].id, rid);
  assert.equal(asked.items[0].my_status, "invited");
  ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("stranger"), body: { accept: true } }), 404);

  const accepted = ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("expert"), body: { accept: true, message: "Happy to" } }));
  assert.equal(accepted.request.status, "accepted");
  assert.equal(accepted.viewer_role, "helper");
  const convId = accepted.conversation_id;
  assert.ok(convId);
  const conv = row(env, "SELECT * FROM conversations WHERE id = ?", convId);
  assert.equal(conv.kind, "dm");
  assert.equal(rows(env, "SELECT * FROM conversation_members WHERE conversation_id = ? AND status = 'active'", convId).length, 2);
  // Both sides consented, so the requester can read it without accepting a request.
  const theirs = ok(await api(env, "GET", `/v1/conversations/${convId}/messages`, { as: as("prof") }));
  assert.ok(JSON.stringify(theirs).includes("Check my InSAR unwrapping"));
  const helping = ok(await api(env, "GET", "/v1/requests?role=helping", { as: as("expert") }));
  assert.equal(helping.items[0].my_status, "accepted");

  // Status machine: the helper starts and finishes; the requester acknowledges.
  ok(await api(env, "PATCH", `/v1/requests/${rid}`, { as: as("expert"), body: { status: "withdrawn" } }), 403);
  ok(await api(env, "POST", `/v1/requests/${rid}/acknowledge`, { as: as("prof"), body: {} }), 409);
  ok(await api(env, "PATCH", `/v1/requests/${rid}`, { as: as("expert"), body: { status: "in_progress" } }));
  const done = ok(await api(env, "PATCH", `/v1/requests/${rid}`, { as: as("expert"), body: { status: "completed" } }));
  assert.equal(done.request.status, "completed");
  ok(await api(env, "PATCH", `/v1/requests/${rid}`, { as: as("prof"), body: { status: "open" } }), 409);
  ok(await api(env, "POST", `/v1/requests/${rid}/acknowledge`, { as: as("expert"), body: {} }), 403);
  const ack = ok(await api(env, "POST", `/v1/requests/${rid}/acknowledge`, { as: as("prof"), body: { note: "Fixed the phase jumps" } }));
  assert.equal(ack.participants.find((p) => p.user.handle === "expert").acknowledged, true);
  const credit = row(env, "SELECT * FROM contributions WHERE user_id = ? AND ref_type = 'request'", ids.expert);
  assert.equal(credit.ref_id, rid);
  assert.equal(credit.note, "Fixed the phase jumps");
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'contribution'", ids.expert));
  // Acknowledging twice keeps one credit.
  ok(await api(env, "POST", `/v1/requests/${rid}/acknowledge`, { as: as("prof"), body: { handle: "expert" } }));
  assert.equal(rows(env, "SELECT * FROM contributions WHERE user_id = ?", ids.expert).length, 1);

  // A private request is counted in reputation, not named.
  const rep = ok(await api(env, "GET", "/v1/users/expert/reputation"));
  const cat = rep.categories.find((c) => c.id === "accepted_contributions");
  assert.equal(cat.count, 1);
  assert.equal(cat.evidence[0].id, null);
});

test("an existing DM is reused when a request is accepted", async () => {
  const env = makeEnv();
  await people(env, "ana", "ben");
  const dm = ok(await api(env, "POST", "/v1/conversations", { as: as("ana"), body: { handles: ["ben"], body: "hi" } }));
  const made = ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: { title: "Share your DEM", kind: "contribute_dataset", handles: ["ben"] } }));
  const acc = ok(await api(env, "POST", `/v1/requests/${made.request.id}/respond`, { as: as("ben"), body: { accept: true } }));
  assert.equal(acc.conversation_id, dm.id);
});

test("declining by everyone asked marks the request declined; reopening asks again", async () => {
  const env = makeEnv();
  await people(env, "ana", "ben", "cat");
  const made = ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: { title: "Validate my model", kind: "validate_model", handles: ["ben", "cat"] } }));
  const rid = made.request.id;
  ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("ben"), body: { accept: false, message: "No time" } }));
  let r = ok(await api(env, "GET", `/v1/requests/${rid}`, { as: as("ana") }));
  assert.equal(r.request.status, "open");
  ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("cat"), body: { accept: false } }));
  r = ok(await api(env, "GET", `/v1/requests/${rid}`, { as: as("ana") }));
  assert.equal(r.request.status, "declined");
  assert.ok(r.responses.some((x) => x.kind === "decline" && x.body === "No time"));
  r = ok(await api(env, "PATCH", `/v1/requests/${rid}`, { as: as("ana"), body: { status: "open" } }));
  assert.equal(r.request.status, "open");
  assert.ok(r.participants.every((p) => p.status === "invited"));
  r = ok(await api(env, "PATCH", `/v1/requests/${rid}`, { as: as("ana"), body: { status: "withdrawn" } }));
  assert.equal(r.request.status, "withdrawn");
  ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("ben"), body: { accept: true } }), 409);
});

test("an open request is discoverable by skill; people offer and the requester chooses", async () => {
  const env = makeEnv();
  const ids = await people(env, "ana", "ben", "cat", "dan");
  const made = ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: {
    title: "Need a seismologist for Etna", kind: "join_project", audience: "everyone", skills: ["seismology"],
  } }), 400);
  assert.match(made.error, /project_id/);
  const open = ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: {
    title: "Need a seismologist for Etna", kind: "other", audience: "everyone", skills: ["seismology"],
  } }));
  const rid = open.request.id;
  ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: { title: "Lidar help", audience: "everyone", skills: ["lidar"] } }));

  const all = ok(await api(env, "GET", "/v1/requests"));
  assert.equal(all.items.length, 2, "signed-out readers see requests open to everyone");
  const bySkill = ok(await api(env, "GET", "/v1/requests?skill=Seismology", { as: as("ben") }));
  assert.deepEqual(bySkill.items.map((r) => r.id), [rid]);
  const mineInOpen = ok(await api(env, "GET", "/v1/requests", { as: as("ana") }));
  assert.equal(mineInOpen.items.length, 0, "your own requests are under Mine, not Open");

  // A reader cannot write on the thread before offering.
  ok(await api(env, "POST", `/v1/requests/${rid}/messages`, { as: as("ben"), body: { body: "hello" } }), 403);
  const offered = ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("ben"), body: { accept: true, message: "I run a broadband network there" } }));
  assert.equal(offered.my_status, "offered");
  ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("ben"), body: { accept: true } }), 409);
  ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("cat"), body: { accept: true, message: "me too" } }));
  // Offers are between each offerer and the requester.
  const asCat = ok(await api(env, "GET", `/v1/requests/${rid}`, { as: as("cat") }));
  assert.ok(!asCat.participants.some((p) => p.user.handle === "ben"));
  assert.ok(!asCat.responses.some((x) => x.author.handle === "ben"));
  const asAna = ok(await api(env, "GET", `/v1/requests/${rid}`, { as: as("ana") }));
  assert.equal(asAna.request.counts.offers, 2);
  assert.equal(asAna.participants.length, 2);

  ok(await api(env, "POST", `/v1/requests/${rid}/choose`, { as: as("ben"), body: { handle: "cat", accept: true } }), 403);
  ok(await api(env, "POST", `/v1/requests/${rid}/choose`, { as: as("ana"), body: { handle: "dan", accept: true } }), 404);
  const chosen = ok(await api(env, "POST", `/v1/requests/${rid}/choose`, { as: as("ana"), body: { handle: "ben", accept: true } }));
  assert.equal(chosen.request.status, "accepted");
  assert.equal(row(env, "SELECT kind FROM conversations WHERE id = ?", chosen.conversation_id).kind, "dm");
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'request' AND text LIKE 'Accepted your offer%'", ids.ben));
  // No longer open: gone from discovery, and no new offers.
  assert.equal(ok(await api(env, "GET", "/v1/requests?skill=seismology", { as: as("dan") })).items.length, 0);
  ok(await api(env, "POST", `/v1/requests/${rid}/respond`, { as: as("dan"), body: { accept: true } }), 409);
  // A second helper moves the work to a group named after the request.
  const second = ok(await api(env, "POST", `/v1/requests/${rid}/choose`, { as: as("ana"), body: { handle: "cat", accept: true } }));
  const group = row(env, "SELECT * FROM conversations WHERE id = ?", second.conversation_id);
  assert.equal(group.kind, "group");
  assert.match(group.title, /Request: Need a seismologist/);
  assert.equal(rows(env, "SELECT * FROM conversation_members WHERE conversation_id = ?", group.id).length, 3);
  // Helpers are named to any reader; that is the credit.
  const asDan = ok(await api(env, "GET", `/v1/requests/${rid}`, { as: as("dan") }));
  assert.equal(asDan.viewer_role, "reader");
  assert.deepEqual(asDan.participants.map((p) => p.user.handle).sort(), ["ben", "cat"]);
  assert.equal(asDan.responses.length, 0);
  assert.equal(asDan.conversation_id, null);
  // With two helpers, acknowledging needs a handle.
  ok(await api(env, "PATCH", `/v1/requests/${rid}`, { as: as("ana"), body: { status: "completed" } }));
  ok(await api(env, "POST", `/v1/requests/${rid}/acknowledge`, { as: as("ana"), body: {} }), 400);
  ok(await api(env, "POST", `/v1/requests/${rid}/acknowledge`, { as: as("ana"), body: { handle: "dan" } }), 404);
  ok(await api(env, "POST", `/v1/requests/${rid}/acknowledge`, { as: as("ana"), body: { handle: "cat" } }));
  const rep = ok(await api(env, "GET", "/v1/users/cat/reputation"));
  const cat = rep.categories.find((c) => c.id === "accepted_contributions");
  assert.deepEqual(cat.evidence[0], { type: "request", id: rid, title: "Need a seismologist for Etna" });
  const contribs = ok(await api(env, "GET", "/v1/users/cat/contributions"));
  assert.equal(contribs.items[0].ref_id, rid);
});

test("community requests are for members; blocks hide requests both ways", async () => {
  const env = makeEnv();
  await people(env, "ana", "ben", "cat");
  ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: { title: "x", community_slug: "volcanology" } }), 404);
  ok(await api(env, "POST", "/v1/communities/volcanology/join", { as: as("ana") }));
  ok(await api(env, "POST", "/v1/communities/volcanology/join", { as: as("ben") }));
  const made = ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: { title: "Gas data for Stromboli", community_slug: "volcanology", kind: "contribute_dataset" } }));
  const rid = made.request.id;
  assert.equal(made.request.community.slug, "volcanology");
  assert.equal(ok(await api(env, "GET", "/v1/requests", { as: as("ben") })).items.length, 1);
  assert.equal(ok(await api(env, "GET", "/v1/requests?community=volcanology", { as: as("ben") })).items.length, 1);
  assert.equal(ok(await api(env, "GET", "/v1/requests", { as: as("cat") })).items.length, 0);
  ok(await api(env, "GET", `/v1/requests/${rid}`, { as: as("cat") }), 404);
  ok(await api(env, "GET", `/v1/requests/${rid}`), 404);

  ok(await api(env, "POST", "/v1/blocks", { as: as("ben"), body: { handle: "ana" } }));
  assert.equal(ok(await api(env, "GET", "/v1/requests", { as: as("ben") })).items.length, 0);
  ok(await api(env, "GET", `/v1/requests/${rid}`, { as: as("ben") }), 404);
  ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: { title: "x", handles: ["ben"] } }), 403);
  ok(await api(env, "POST", `/v1/requests/${rid}/invite`, { as: as("ana"), body: { handle: "ben" } }), 403);
});

test("requests link only posts and projects the requester can see, and show them only to viewers who can", async () => {
  const env = makeEnv();
  const ids = await people(env, "ana", "ben", "cat");
  const priv = ok(await api(env, "POST", "/v1/posts", { as: as("ben"), body: { title: "Secret", visibility: "private" } }));
  ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: { title: "x", audience: "everyone", post_id: priv.id } }), 404);
  const mine = ok(await api(env, "POST", "/v1/posts", { as: as("ana"), body: { title: "Draft map", visibility: "followers" } }));
  const project = ok(await api(env, "POST", "/v1/projects", { as: as("ana"), body: { title: "Etna twin", visibility: "private" } }));
  ok(await api(env, "POST", "/v1/requests", { as: as("ben"), body: { title: "x", kind: "join_project", audience: "everyone", project_id: project.project.id } }), 404);
  const made = ok(await api(env, "POST", "/v1/requests", { as: as("ana"), body: {
    title: "Join the Etna twin", kind: "join_project", audience: "everyone", post_id: mine.id, project_id: project.project.id,
  } }));
  assert.equal(made.request.post.id, mine.id);
  assert.equal(made.request.project.id, project.project.id);
  const seen = ok(await api(env, "GET", `/v1/requests/${made.request.id}`, { as: as("cat") }));
  assert.equal(seen.request.post, null, "a followers-only post is not shown to a non-follower");
  assert.equal(seen.request.project, null, "a private project is not shown to a stranger");
  assert.ok(ids.cat);
});

// ── Accepted corrections and suggestions ───────────────────────────────────

test("the post's author accepts a correction: credited, notified, listed, counted -- and takes it back", async () => {
  const env = makeEnv();
  const ids = await people(env, "ana", "ben", "cat");
  const post = ok(await api(env, "POST", "/v1/posts", { as: as("ana"), body: { title: "Etna lava flow map", kind: "analysis" } }));
  const fix = ok(await api(env, "POST", `/v1/posts/${post.id}/comments`, { as: as("ben"), body: { body: "The 2021 flow is mislabelled as 2020.", kind: "correction" } }));
  const chat = ok(await api(env, "POST", `/v1/posts/${post.id}/comments`, { as: as("cat"), body: { body: "Nice map", kind: "comment" } }));
  const own = ok(await api(env, "POST", `/v1/posts/${post.id}/comments`, { as: as("ana"), body: { body: "Self note", kind: "suggestion" } }));
  assert.equal(fix.status, "");

  ok(await api(env, "POST", `/v1/comments/${fix.id}/status`, { as: as("cat"), body: { status: "accepted" } }), 403);
  ok(await api(env, "POST", `/v1/comments/${chat.id}/status`, { as: as("ana"), body: { status: "accepted" } }), 400);
  ok(await api(env, "POST", `/v1/comments/${own.id}/status`, { as: as("ana"), body: { status: "accepted" } }), 400);
  ok(await api(env, "POST", `/v1/comments/${fix.id}/status`, { as: as("ana"), body: { status: "merged" } }), 400);

  const decided = ok(await api(env, "POST", `/v1/comments/${fix.id}/status`, { as: as("ana"), body: { status: "accepted", note: "Fixed in v2" } }));
  assert.equal(decided.status, "accepted");
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'contribution' AND text LIKE 'Accepted your correction%'", ids.ben));
  const thread = ok(await api(env, "GET", `/v1/posts/${post.id}/comments`));
  const shown = thread.items.find((c) => c.id === fix.id);
  assert.equal(shown.status, "accepted");
  assert.equal(shown.status_note, "Fixed in v2");
  const list = ok(await api(env, "GET", `/v1/posts/${post.id}/contributions`));
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].user.handle, "ben");
  assert.equal(list.items[0].kind, "correction");
  assert.equal(list.items[0].note, "Fixed in v2");
  let rep = ok(await api(env, "GET", "/v1/users/ben/reputation"));
  let cat = rep.categories.find((c) => c.id === "accepted_contributions");
  assert.equal(cat.count, 1);
  assert.deepEqual(cat.evidence[0], { type: "post", id: post.id, title: "Etna lava flow map" });

  // A blocked viewer does not see the contributor in the list.
  ok(await api(env, "POST", "/v1/blocks", { as: as("cat"), body: { handle: "ben" } }));
  assert.equal(ok(await api(env, "GET", `/v1/posts/${post.id}/contributions`, { as: as("cat") })).items.length, 0);

  // Declining takes the credit back; deleting an accepted comment does too.
  ok(await api(env, "POST", `/v1/comments/${fix.id}/status`, { as: as("ana"), body: { status: "declined" } }));
  assert.equal(rows(env, "SELECT * FROM contributions WHERE user_id = ?", ids.ben).length, 0);
  ok(await api(env, "POST", `/v1/comments/${fix.id}/status`, { as: as("ana"), body: { status: "accepted" } }));
  ok(await api(env, "DELETE", `/v1/comments/${fix.id}`, { as: as("ben") }));
  rep = ok(await api(env, "GET", "/v1/users/ben/reputation"));
  cat = rep.categories.find((c) => c.id === "accepted_contributions");
  assert.equal(cat.count, 0);
  assert.equal(ok(await api(env, "GET", `/v1/posts/${post.id}/contributions`)).items.length, 0);
});

test("contributions on a post the viewer cannot see are a 404", async () => {
  const env = makeEnv();
  await people(env, "ana", "ben");
  const post = ok(await api(env, "POST", "/v1/posts", { as: as("ana"), body: { title: "Private", visibility: "private" } }));
  ok(await api(env, "GET", `/v1/posts/${post.id}/contributions`, { as: as("ben") }), 404);
});

// ── Export and erasure ─────────────────────────────────────────────────────

test("export includes the collaboration tables; erasure clears them", async () => {
  const env = makeEnv();
  const ids = await people(env, "ana", "ben");
  const post = ok(await api(env, "POST", "/v1/posts", { as: as("ana"), body: { title: "Map" } }));
  const fix = ok(await api(env, "POST", `/v1/posts/${post.id}/comments`, { as: as("ben"), body: { body: "typo", kind: "suggestion" } }));
  ok(await api(env, "POST", `/v1/comments/${fix.id}/status`, { as: as("ana"), body: { status: "accepted", note: "thanks" } }));
  const req = ok(await api(env, "POST", "/v1/requests", { as: as("ben"), body: { title: "Help me", handles: ["ana"] } }));
  ok(await api(env, "POST", `/v1/requests/${req.request.id}/respond`, { as: as("ana"), body: { accept: true, message: "ok" } }));
  const event = ok(await api(env, "POST", "/v1/posts", { as: as("ana"), body: { title: "Webinar", kind: "event", meta: { starts_at: Math.floor(Date.now() / 1000) + 9000 } } }));
  ok(await api(env, "POST", `/v1/events/${event.id}/rsvp`, { as: as("ben"), body: { status: "going" } }));

  const res = await call(env, "GET", "/v1/me/export", { as: as("ben") });
  const data = res.body;
  assert.equal(data.collab_requests.length, 1);
  assert.equal(data.contributions.length, 1);
  assert.equal(data.contributions[0].credited_by, "ana");
  assert.equal(data.event_rsvps.length, 1);
  const anaData = (await call(env, "GET", "/v1/me/export", { as: as("ana") })).body;
  assert.equal(anaData.collab_participation[0].status, "accepted");
  assert.equal(anaData.collab_responses[0].body, "ok");

  ok(await api(env, "DELETE", "/v1/me", { as: as("ben"), body: { confirm: "ben" } }));
  assert.equal(rows(env, "SELECT * FROM contributions WHERE user_id = ?", ids.ben).length, 0);
  assert.equal(rows(env, "SELECT * FROM event_rsvps WHERE user_id = ?", ids.ben).length, 0);
  const left = row(env, "SELECT * FROM collab_requests WHERE id = ?", req.request.id);
  assert.equal(left.title, "");
  assert.equal(left.status, "withdrawn");
  ok(await api(env, "DELETE", "/v1/me", { as: as("ana"), body: { confirm: "ana" } }));
  assert.equal(rows(env, "SELECT * FROM collab_participants WHERE user_id = ?", ids.ana).length, 0);
  assert.equal(row(env, "SELECT body FROM collab_responses WHERE author_id = ?", ids.ana).body, "");
});
