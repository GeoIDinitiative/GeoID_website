/**
 * The collaboration half of GeoID Network: projects and grants, teams,
 * communities, reviews, messages, moderation, reputation and the matcher.
 *
 * Rows the other modules would normally create (posts, media) are inserted
 * straight into the database, so these tests do not depend on them.
 * Every response is checked for an email address on the way through.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";

const T = () => Math.floor(Date.now() / 1000);

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

/** Make users exist (first sight creates them) and return their ids by handle. */
async function people(env, ...handles) {
  const ids = {};
  for (const h of handles) {
    ok(await api(env, "GET", "/v1/conversations", { as: as(h) }));
    ids[h] = env.DB.raw.prepare("SELECT id FROM users WHERE handle = ?").get(h).id;
  }
  return ids;
}
const sql = (env, text, ...args) => env.DB.raw.prepare(text).run(...args);
const row = (env, text, ...args) => env.DB.raw.prepare(text).get(...args);
const rows = (env, text, ...args) => env.DB.raw.prepare(text).all(...args);

function rawPost(env, p) {
  const t = p.created_at || T();
  sql(env, `INSERT INTO posts (id, author_id, kind, title, tags_json, visibility, community_id, licence, sources_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, p.id, p.author, p.kind || "text", p.title || "A post", JSON.stringify(p.tags || []),
  p.visibility || "public", p.community_id || null, p.licence || "CC-BY-4.0", JSON.stringify(p.sources || []), t, t);
  for (const tag of p.tags || []) sql(env, "INSERT INTO post_tags (post_id, tag) VALUES (?, ?)", p.id, tag);
}

// ── Projects and grants ────────────────────────────────────────────────────

test("a professor shares a private project with a student as viewer", async () => {
  const env = makeEnv();
  const ids = await people(env, "prof", "student");
  const created = ok(await api(env, "POST", "/v1/projects", { as: as("prof"), body: {
    title: "Etna deformation", visibility: "private",
    workspace: { world: "earth", layers: [{ id: "insar", source: "https://data.example.org/etna.tif" }] },
  } }));
  const pid = created.project.id;
  assert.equal(created.access.role, "owner");
  assert.equal(created.project.current_version, 1);

  ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("student") }), 404);
  ok(await api(env, "GET", `/v1/projects/${pid}/workspace`, { as: as("student") }), 404);
  ok(await api(env, "GET", `/v1/projects/${pid}`), 404);

  const grant = ok(await api(env, "POST", `/v1/projects/${pid}/grants`, { as: as("prof"), body: { handle: "student", role: "viewer" } }));
  assert.equal(grant.role, "viewer");
  assert.equal(grant.grantee.handle, "student");
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'grant'", ids.student));
  assert.ok(row(env, "SELECT 1 AS x FROM audit WHERE action = 'grant.create' AND ref_id = ?", pid));

  const seen = ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("student") }));
  assert.equal(seen.access.role, "viewer");
  assert.equal(seen.grants, undefined, "grants are for the owner and editors only");
  const ws = ok(await api(env, "GET", `/v1/projects/${pid}/workspace`, { as: as("student") }));
  assert.equal(ws.version, 1);
  assert.equal(ws.manifest.layers[0].id, "insar");

  ok(await api(env, "POST", `/v1/projects/${pid}/versions`, { as: as("student"), body: { manifest: { layers: [] } } }), 403);
  ok(await api(env, "PATCH", `/v1/projects/${pid}`, { as: as("student"), body: { title: "Mine now" } }), 403);
  ok(await api(env, "POST", `/v1/projects/${pid}/fork`, { as: as("student"), body: {} }), 403);

  const shared = ok(await api(env, "GET", "/v1/projects?shared=1", { as: as("student") }));
  assert.deepEqual(shared.items.map((p) => p.id), [pid]);

  const v2 = ok(await api(env, "POST", `/v1/projects/${pid}/versions`, { as: as("prof"), body: { manifest: { layers: [{ id: "dem" }] }, note: "DEM" } }));
  assert.equal(v2.version, 2);
  assert.equal(ok(await api(env, "GET", `/v1/projects/${pid}/workspace?version=1`, { as: as("student") })).version, 1);
  assert.equal(ok(await api(env, "GET", `/v1/projects/${pid}/workspace`, { as: as("student") })).manifest.layers[0].id, "dem");

  const big = { layers: [{ id: "x", note: "a".repeat(49 * 1024) }] };
  ok(await api(env, "POST", `/v1/projects/${pid}/versions`, { as: as("prof"), body: { manifest: big } }), 413);
  ok(await api(env, "POST", `/v1/projects/${pid}/versions`, { as: as("prof"), body: { manifest: { img: "data:image/png;base64,AAAA" } } }), 400);

  ok(await api(env, "DELETE", `/v1/projects/${pid}/grants/${grant.id}`, { as: as("prof") }));
  ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("student") }), 404);
  assert.ok(row(env, "SELECT 1 AS x FROM audit WHERE action = 'grant.revoke' AND ref_id = ?", pid));
  assert.equal(row(env, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'grant'", ids.student).n, 2);
});

test("a team grant reaches active team members and stops when one is removed", async () => {
  const env = makeEnv();
  await people(env, "prof", "lead", "stud");
  ok(await api(env, "POST", "/v1/teams", { as: as("lead"), body: { name: "Rock Lab", visibility: "public" } }));
  ok(await api(env, "POST", "/v1/teams/rock-lab/invite", { as: as("lead"), body: { handle: "stud", role: "member" } }));
  const pid = ok(await api(env, "POST", "/v1/projects", { as: as("prof"), body: { title: "Shared", workspace: { layers: [] } } })).project.id;

  // Invited is not a member yet.
  ok(await api(env, "POST", `/v1/projects/${pid}/grants`, { as: as("prof"), body: { team_slug: "rock-lab", role: "commenter" } }));
  ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("stud") }), 404);

  ok(await api(env, "POST", "/v1/teams/rock-lab/respond", { as: as("stud"), body: { accept: true } }));
  assert.equal(ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("stud") })).access.role, "commenter");
  assert.equal(ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("lead") })).access.role, "commenter");
  assert.equal(ok(await api(env, "GET", "/v1/projects?shared=1", { as: as("stud") })).items.length, 1);

  ok(await api(env, "DELETE", "/v1/teams/rock-lab/members/stud", { as: as("lead") }));
  ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("stud") }), 404);
  assert.equal(ok(await api(env, "GET", "/v1/projects?shared=1", { as: as("stud") })).items.length, 0);
});

test("an expired grant is ignored, and a grant cannot be made already expired", async () => {
  const env = makeEnv();
  const ids = await people(env, "prof", "visitor");
  const pid = ok(await api(env, "POST", "/v1/projects", { as: as("prof"), body: { title: "Old", workspace: { a: 1 } } })).project.id;
  ok(await api(env, "POST", `/v1/projects/${pid}/grants`, { as: as("prof"), body: { handle: "visitor", role: "viewer", expires_at: T() - 5 } }), 400);
  const g = ok(await api(env, "POST", `/v1/projects/${pid}/grants`, { as: as("prof"), body: { handle: "visitor", role: "viewer", expires_at: T() + 3600 } }));
  assert.equal(ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("visitor") })).access.role, "viewer");
  sql(env, "UPDATE grants SET expires_at = ? WHERE id = ?", T() - 1, g.id);
  ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("visitor") }), 404);
  ok(await api(env, "GET", `/v1/projects/${pid}/workspace`, { as: as("visitor") }), 404);
  assert.equal(ok(await api(env, "GET", "/v1/projects?shared=1", { as: as("visitor") })).items.length, 0);
  assert.ok(ids.visitor);
});

test("an editor can grant at most commenter and cannot revoke", async () => {
  const env = makeEnv();
  await people(env, "prof", "editor1", "xone", "xtwo");
  const pid = ok(await api(env, "POST", "/v1/projects", { as: as("prof"), body: { title: "Paper", workspace: { a: 1 } } })).project.id;
  ok(await api(env, "POST", `/v1/projects/${pid}/grants`, { as: as("prof"), body: { handle: "editor1", role: "editor" } }));
  const res = await api(env, "POST", `/v1/projects/${pid}/grants`, { as: as("editor1"), body: { handle: "xone", role: "editor" } });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /at most commenter/);
  ok(await api(env, "POST", `/v1/projects/${pid}/grants`, { as: as("editor1"), body: { handle: "xone", role: "forker" } }), 403);
  const g = ok(await api(env, "POST", `/v1/projects/${pid}/grants`, { as: as("editor1"), body: { handle: "xtwo", role: "commenter" } }));
  ok(await api(env, "DELETE", `/v1/projects/${pid}/grants/${g.id}`, { as: as("editor1") }), 403);
  ok(await api(env, "POST", `/v1/projects/${pid}/versions`, { as: as("editor1"), body: { manifest: { a: 2 } } }));
  ok(await api(env, "PATCH", `/v1/projects/${pid}`, { as: as("editor1"), body: { visibility: "public" } }), 403);
  const detail = ok(await api(env, "GET", `/v1/projects/${pid}`, { as: as("editor1") }));
  assert.equal(detail.grants.length, 2);
});

test("fork rules: forker grant or allow_fork, copying the latest manifest", async () => {
  const env = makeEnv();
  await people(env, "prof", "viewer1", "forker1", "anyone");
  const priv = ok(await api(env, "POST", "/v1/projects", { as: as("prof"), body: { title: "Private", workspace: { v: 1 } } })).project.id;
  ok(await api(env, "POST", `/v1/projects/${priv}/versions`, { as: as("prof"), body: { manifest: { v: 2 } } }));
  ok(await api(env, "POST", `/v1/projects/${priv}/grants`, { as: as("prof"), body: { handle: "viewer1", role: "viewer" } }));
  ok(await api(env, "POST", `/v1/projects/${priv}/grants`, { as: as("prof"), body: { handle: "forker1", role: "forker" } }));
  ok(await api(env, "POST", `/v1/projects/${priv}/fork`, { as: as("viewer1"), body: {} }), 403);
  ok(await api(env, "POST", `/v1/projects/${priv}/fork`, { as: as("anyone"), body: {} }), 404);
  const fork = ok(await api(env, "POST", `/v1/projects/${priv}/fork`, { as: as("forker1"), body: { title: "My copy" } }));
  assert.equal(fork.project.forked_from, priv);
  assert.equal(fork.project.owner.handle, "forker1");
  assert.equal(fork.project.visibility, "private");
  assert.equal(ok(await api(env, "GET", `/v1/projects/${fork.project.id}/workspace`, { as: as("forker1") })).manifest.v, 2);

  const open = ok(await api(env, "POST", "/v1/projects", { as: as("prof"), body: { title: "Open", visibility: "public", allow_fork: true, workspace: { o: 1 } } })).project.id;
  const closed = ok(await api(env, "POST", "/v1/projects", { as: as("prof"), body: { title: "Closed", visibility: "public", workspace: { c: 1 } } })).project.id;
  assert.equal(ok(await api(env, "GET", `/v1/projects/${open}`)).access.role, "public");
  ok(await api(env, "POST", `/v1/projects/${open}/fork`, { as: as("anyone"), body: {} }));
  ok(await api(env, "POST", `/v1/projects/${closed}/fork`, { as: as("anyone"), body: {} }), 403);
  ok(await api(env, "POST", `/v1/projects/${open}/fork`, { body: {} }), 401);
  ok(await api(env, "GET", `/v1/projects/${closed}/workspace`));
});

// ── Teams ──────────────────────────────────────────────────────────────────

test("private teams and communities are 404 to outsiders", async () => {
  const env = makeEnv();
  await people(env, "owner", "outsider", "guest");
  ok(await api(env, "POST", "/v1/teams", { as: as("owner"), body: { name: "Secret Lab" } }));
  ok(await api(env, "GET", "/v1/teams/secret-lab", { as: as("outsider") }), 404);
  ok(await api(env, "GET", "/v1/teams/secret-lab"), 404);
  ok(await api(env, "GET", "/v1/teams/secret-lab/tasks", { as: as("outsider") }), 404);
  ok(await api(env, "POST", "/v1/teams/secret-lab/request", { as: as("outsider") }), 404);
  assert.equal(ok(await api(env, "GET", "/v1/teams", { as: as("outsider") })).items.length, 0);
  // The invitee can see what they are invited to.
  ok(await api(env, "POST", "/v1/teams/secret-lab/invite", { as: as("owner"), body: { handle: "guest" } }));
  ok(await api(env, "GET", "/v1/teams/secret-lab", { as: as("guest") }));

  ok(await api(env, "POST", "/v1/communities", { as: as("owner"), body: { name: "Hidden Club", visibility: "private" } }));
  ok(await api(env, "GET", "/v1/communities/hidden-club", { as: as("outsider") }), 404);
  ok(await api(env, "POST", "/v1/communities/hidden-club/join", { as: as("outsider") }), 404);
  ok(await api(env, "GET", "/v1/communities/hidden-club/members", { as: as("outsider") }), 404);
  assert.ok(!ok(await api(env, "GET", "/v1/communities", { as: as("outsider") })).items.some((c) => c.slug === "hidden-club"));
  assert.ok(ok(await api(env, "GET", "/v1/communities", { as: as("owner") })).items.some((c) => c.slug === "hidden-club"));
  ok(await api(env, "POST", "/v1/communities/hidden-club/members/guest", { as: as("owner"), body: { status: "invited" } }));
  assert.equal(ok(await api(env, "POST", "/v1/communities/hidden-club/join", { as: as("guest") })).status, "active");
  assert.equal(ok(await api(env, "GET", "/v1/communities/hidden-club", { as: as("guest") })).community.member_count, 2);

  // A channel under a public community: only its moderators may make one.
  ok(await api(env, "POST", "/v1/communities", { as: as("outsider"), body: { name: "Mods only", parent: "volcanology" } }), 403);
});

test("approval communities: request, moderator approval, directory, pinning", async () => {
  const env = makeEnv();
  const ids = await people(env, "founder", "joiner", "other");
  ok(await api(env, "POST", "/v1/communities", { as: as("founder"), body: { name: "Lava Lab", visibility: "approval" } }));
  assert.equal(ok(await api(env, "POST", "/v1/communities/lava-lab/join", { as: as("joiner") })).status, "requested");
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND ref_id = 'lava-lab'", ids.founder));
  ok(await api(env, "GET", "/v1/communities/lava-lab/members?status=requested", { as: as("joiner") }), 403);
  const pending = ok(await api(env, "GET", "/v1/communities/lava-lab/members?status=requested", { as: as("founder") }));
  assert.deepEqual(pending.items.map((u) => u.handle), ["joiner"]);
  ok(await api(env, "POST", "/v1/communities/lava-lab/members/joiner", { as: as("joiner"), body: { status: "active" } }), 403);
  ok(await api(env, "POST", "/v1/communities/lava-lab/members/joiner", { as: as("founder"), body: { status: "active" } }));
  const c = ok(await api(env, "GET", "/v1/communities/lava-lab", { as: as("joiner") }));
  assert.equal(c.community.member_count, 2);
  assert.equal(c.viewer.status, "active");

  sql(env, "UPDATE users SET skills_json = '[\"insar\",\"python\"]' WHERE id = ?", ids.joiner);
  const bySkill = ok(await api(env, "GET", "/v1/communities/lava-lab/members?skill=InSAR", { as: as("other") }));
  assert.deepEqual(bySkill.items.map((u) => u.handle), ["joiner"]);
  assert.deepEqual(bySkill.items[0].skills, ["insar", "python"]);

  const cid = row(env, "SELECT id FROM communities WHERE slug = 'lava-lab'").id;
  rawPost(env, { id: "p_pin", author: ids.joiner, community_id: cid, title: "Read me first" });
  rawPost(env, { id: "p_else", author: ids.joiner, community_id: "cm_floods" });
  ok(await api(env, "POST", "/v1/communities/lava-lab/pin/p_pin", { as: as("joiner") }), 403);
  ok(await api(env, "POST", "/v1/communities/lava-lab/pin/p_else", { as: as("founder") }), 404);
  ok(await api(env, "POST", "/v1/communities/lava-lab/pin/p_pin", { as: as("founder") }));
  assert.deepEqual(ok(await api(env, "GET", "/v1/communities/lava-lab")).pinned.map((p) => p.id), ["p_pin"]);
  ok(await api(env, "DELETE", "/v1/communities/lava-lab/pin/p_pin", { as: as("founder") }));
  assert.equal(ok(await api(env, "GET", "/v1/communities/lava-lab")).pinned.length, 0);

  ok(await api(env, "POST", "/v1/communities/lava-lab/leave", { as: as("joiner") }));
  assert.equal(row(env, "SELECT member_count FROM communities WHERE id = ?", cid).member_count, 1);
  ok(await api(env, "POST", "/v1/communities/lava-lab/leave", { as: as("founder") }), 409);

  // An open community joins at once and keeps its count.
  ok(await api(env, "POST", "/v1/communities/volcanology/join", { as: as("other") }));
  assert.equal(row(env, "SELECT member_count FROM communities WHERE slug = 'volcanology'").member_count, 1);
});

test("a team always keeps a lead", async () => {
  const env = makeEnv();
  await people(env, "boss", "helper");
  ok(await api(env, "POST", "/v1/teams", { as: as("boss"), body: { name: "Field Team" } }));
  ok(await api(env, "DELETE", "/v1/teams/field-team/members/boss", { as: as("boss") }), 409);
  ok(await api(env, "POST", "/v1/teams/field-team/members/boss", { as: as("boss"), body: { role: "member" } }), 409);
  ok(await api(env, "POST", "/v1/teams/field-team/invite", { as: as("boss"), body: { handle: "helper", role: "member" } }));
  ok(await api(env, "POST", "/v1/teams/field-team/respond", { as: as("helper"), body: { accept: true } }));
  ok(await api(env, "POST", "/v1/teams/field-team/members/boss", { as: as("helper"), body: { role: "member" } }), 403);
  ok(await api(env, "POST", "/v1/teams/field-team/members/helper", { as: as("boss"), body: { role: "lead" } }));
  ok(await api(env, "POST", "/v1/teams/field-team/members/boss", { as: as("boss"), body: { role: "member" } }));
  ok(await api(env, "DELETE", "/v1/teams/field-team/members/helper", { as: as("helper") }), 409);
  const team = ok(await api(env, "GET", "/v1/teams/field-team", { as: as("boss") }));
  assert.deepEqual(team.members.map((m) => [m.user.handle, m.role]), [["helper", "lead"], ["boss", "member"]]);
});

test("the team conversation follows team membership; tasks follow roles", async () => {
  const env = makeEnv();
  await people(env, "lead", "mem", "watcher");
  const created = ok(await api(env, "POST", "/v1/teams", { as: as("lead"), body: { name: "Chat Team" } }));
  const conv = created.conversation_id;
  assert.ok(conv);
  ok(await api(env, "POST", "/v1/teams/chat-team/invite", { as: as("lead"), body: { handle: "mem", role: "member" } }));
  ok(await api(env, "GET", `/v1/conversations/${conv}/messages`, { as: as("mem") }), 404);
  ok(await api(env, "POST", "/v1/teams/chat-team/respond", { as: as("mem"), body: { accept: true } }));
  const mine = ok(await api(env, "GET", "/v1/conversations", { as: as("mem") }));
  assert.equal(mine.items[0].id, conv);
  assert.equal(mine.items[0].kind, "team");
  ok(await api(env, "POST", `/v1/conversations/${conv}/messages`, { as: as("mem"), body: { body: "Hello team" } }));
  ok(await api(env, "POST", `/v1/conversations/${conv}/leave`, { as: as("mem") }), 409);
  assert.equal(ok(await api(env, "GET", "/v1/conversations", { as: as("lead") })).items[0].unread, 1);

  ok(await api(env, "POST", "/v1/teams/chat-team/invite", { as: as("lead"), body: { handle: "watcher", role: "viewer" } }));
  ok(await api(env, "POST", "/v1/teams/chat-team/respond", { as: as("watcher"), body: { accept: true } }));
  const task = ok(await api(env, "POST", "/v1/teams/chat-team/tasks", { as: as("mem"), body: { title: "Collect samples", assignee: "lead" } }));
  assert.equal(task.assignee.handle, "lead");
  ok(await api(env, "POST", "/v1/teams/chat-team/tasks", { as: as("watcher"), body: { title: "Nope" } }), 403);
  ok(await api(env, "PATCH", `/v1/tasks/${task.id}`, { as: as("watcher"), body: { status: "done" } }), 403);
  assert.equal(ok(await api(env, "GET", "/v1/teams/chat-team/tasks", { as: as("watcher") })).items.length, 1);
  assert.equal(ok(await api(env, "PATCH", `/v1/tasks/${task.id}`, { as: as("mem"), body: { status: "done" } })).status, "done");
  assert.equal(ok(await api(env, "GET", "/v1/teams/chat-team", { as: as("mem") })).tasks.length, 0);

  ok(await api(env, "DELETE", "/v1/teams/chat-team/members/mem", { as: as("lead") }));
  ok(await api(env, "GET", `/v1/conversations/${conv}/messages`, { as: as("mem") }), 404);
  ok(await api(env, "POST", `/v1/conversations/${conv}/messages`, { as: as("mem"), body: { body: "still here?" } }), 404);
  const members = rows(env, "SELECT u.handle, cm.status FROM conversation_members cm JOIN users u ON u.id = cm.user_id WHERE conversation_id = ? ORDER BY u.handle", conv);
  assert.deepEqual(members.map((m) => [m.handle, m.status]), [["lead", "active"], ["mem", "left"], ["watcher", "active"]]);
});

// ── Reviews ────────────────────────────────────────────────────────────────

test("draft review end to end", async () => {
  const env = makeEnv();
  const ids = await people(env, "author", "rev", "reader", "thief");
  sql(env, "INSERT INTO media (key, owner_id, type, bytes, scope, created_at) VALUES (?, ?, 'application/pdf', 1000, 'owner', ?)",
    "m/author/draft.pdf", ids.author, T());
  sql(env, "INSERT INTO media (key, owner_id, type, bytes, scope, created_at) VALUES (?, ?, 'application/pdf', 1000, 'owner', ?)",
    "m/thief/other.pdf", ids.thief, T());
  ok(await api(env, "POST", "/v1/reviews", { as: as("author"), body: { title: "Mine", doc_key: "m/thief/other.pdf" } }), 400);
  const created = ok(await api(env, "POST", "/v1/reviews", { as: as("author"), body: {
    title: "Magma ascent rates at Etna", abstract: "We estimate...", doc_key: "m/author/draft.pdf",
    expertise: ["volcanology", "InSAR"], visibility: "open",
  } }));
  const rid = created.review.id;
  assert.equal(created.viewer_role, "requester");
  assert.deepEqual(created.review.expertise, ["volcanology", "insar"]);
  assert.equal(row(env, "SELECT scope FROM media WHERE key = 'm/author/draft.pdf'").scope, `review:${rid}`);
  assert.equal(row(env, "SELECT scope FROM media WHERE key = 'm/thief/other.pdf'").scope, "owner");

  ok(await api(env, "POST", `/v1/reviews/${rid}/invite`, { as: as("reader"), body: { handle: "rev" } }), 403);
  ok(await api(env, "POST", `/v1/reviews/${rid}/invite`, { as: as("author"), body: { handle: "rev" } }));
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'review'", ids.rev));
  ok(await api(env, "POST", `/v1/reviews/${rid}/comments`, { as: as("rev"), body: { body: "early" } }), 403);
  ok(await api(env, "POST", `/v1/reviews/${rid}/respond`, { as: as("rev"), body: { accept: true } }));
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND text LIKE 'Agreed%'", ids.author));
  assert.equal(ok(await api(env, "GET", "/v1/reviews?role=assigned", { as: as("rev") })).items[0].id, rid);
  assert.equal(ok(await api(env, "GET", "/v1/reviews?role=open", { as: as("reader") })).items[0].id, rid);

  const c = ok(await api(env, "POST", `/v1/reviews/${rid}/comments`, { as: as("rev"), body: { body: "Units in eq. 3?", anchor: "p3 l120", severity: "major" } }));
  assert.equal(c.anchor, "p3 l120");
  assert.equal(c.severity, "major");
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND text LIKE 'Commented%'", ids.author));
  ok(await api(env, "POST", `/v1/reviews/${rid}/comments`, { as: as("reader"), body: { body: "drive-by" } }), 403);
  ok(await api(env, "POST", `/v1/review-comments/${c.id}/resolve`, { as: as("rev") }), 403);
  assert.equal(ok(await api(env, "POST", `/v1/review-comments/${c.id}/resolve`, { as: as("author") })).resolved, true);

  ok(await api(env, "POST", `/v1/reviews/${rid}/submit`, { as: as("reader"), body: { recommendation: "accept", summary: "x" } }), 403);
  ok(await api(env, "POST", `/v1/reviews/${rid}/submit`, { as: as("rev"), body: { recommendation: "minor", summary: "Solid work." } }));
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND text LIKE 'Submitted%'", ids.author));

  const before = ok(await api(env, "GET", `/v1/reviews/${rid}`, { as: as("reader") }));
  assert.equal(before.viewer_role, "reader");
  assert.equal(before.reviewers[0].summary, undefined);
  assert.equal(before.reviewers[0].recommendation, "hidden");
  assert.equal(before.comments[0].resolved, true);
  const forRequester = ok(await api(env, "GET", `/v1/reviews/${rid}`, { as: as("author") }));
  assert.equal(forRequester.reviewers[0].summary, "Solid work.");
  assert.equal(forRequester.reviewers[0].recommendation, "minor");

  ok(await api(env, "PATCH", `/v1/reviews/${rid}`, { as: as("rev"), body: { status: "closed" } }), 403);
  ok(await api(env, "PATCH", `/v1/reviews/${rid}`, { as: as("author"), body: { status: "closed" } }));
  const after = ok(await api(env, "GET", `/v1/reviews/${rid}`, { as: as("reader") }));
  assert.equal(after.reviewers[0].summary, "Solid work.");
  ok(await api(env, "POST", `/v1/reviews/${rid}/comments`, { as: as("author"), body: { body: "Thanks" } }), 409);

  const priv = ok(await api(env, "POST", "/v1/reviews", { as: as("author"), body: { title: "Private draft", doc_url: "https://overleaf.example.org/x" } })).review.id;
  ok(await api(env, "GET", `/v1/reviews/${priv}`, { as: as("reader") }), 404);
  ok(await api(env, "POST", `/v1/reviews/${priv}/volunteer`, { as: as("reader") }), 404);
  const openId = ok(await api(env, "POST", "/v1/reviews", { as: as("author"), body: { title: "Open draft", abstract: "x", visibility: "open" } })).review.id;
  assert.equal(ok(await api(env, "POST", `/v1/reviews/${openId}/volunteer`, { as: as("reader") })).status, "volunteered");
  ok(await api(env, "POST", `/v1/reviews/${openId}/comments`, { as: as("reader"), body: { body: "As a volunteer", severity: "typo" } }));
});

// ── Messages ───────────────────────────────────────────────────────────────

test("messages: contact_pref, requests, unread counts, polling", async () => {
  const env = makeEnv();
  const ids = await people(env, "alice", "bob", "carol", "dan");
  // bob keeps the default (followers) and follows carol only.
  sql(env, "INSERT INTO follows (follower_id, target_type, target_id, created_at) VALUES (?, 'user', ?, ?)", ids.bob, ids.carol, T());
  const conv = ok(await api(env, "POST", "/v1/conversations", { as: as("alice"), body: { handles: ["bob"], body: "Hi Bob, about your InSAR work" } }));
  assert.equal(conv.kind, "dm");
  const bobs = ok(await api(env, "GET", "/v1/conversations?status=request", { as: as("bob") }));
  assert.equal(bobs.items.length, 1);
  assert.equal(bobs.items[0].status, "request");
  assert.equal(bobs.items[0].unread, 1);
  ok(await api(env, "POST", `/v1/conversations/${conv.id}/messages`, { as: as("bob"), body: { body: "reply" } }), 403);

  const again = ok(await api(env, "POST", "/v1/conversations", { as: as("alice"), body: { handles: ["bob"], body: "Second note" } }));
  assert.equal(again.id, conv.id, "a second DM to the same person reuses the conversation");

  ok(await api(env, "POST", `/v1/conversations/${conv.id}/accept`, { as: as("bob") }));
  const read = ok(await api(env, "GET", `/v1/conversations/${conv.id}/messages`, { as: as("bob") }));
  assert.deepEqual(read.items.map((m) => m.body), ["Hi Bob, about your InSAR work", "Second note"]);
  assert.equal(ok(await api(env, "GET", "/v1/conversations", { as: as("bob") })).items[0].unread, 0);
  const sent = ok(await api(env, "POST", `/v1/conversations/${conv.id}/messages`, { as: as("bob"), body: { body: "Happy to talk" } }));
  const poll = ok(await api(env, "GET", `/v1/conversations/${conv.id}/messages?after=${sent.created_at}`, { as: as("alice") }));
  assert.ok(poll.items.some((m) => m.id === sent.id));
  const none = ok(await api(env, "GET", `/v1/conversations/${conv.id}/messages?after=${sent.created_at + 1}`, { as: as("alice") }));
  assert.equal(none.items.length, 0);
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'message'", ids.alice));

  // Somebody bob follows lands straight in his inbox.
  const fromCarol = ok(await api(env, "POST", "/v1/conversations", { as: as("carol"), body: { handles: ["bob"], body: "hey" } }));
  assert.equal(row(env, "SELECT status FROM conversation_members WHERE conversation_id = ? AND user_id = ?", fromCarol.id, ids.bob).status, "active");
  sql(env, "UPDATE users SET contact_pref = 'nobody' WHERE id = ?", ids.carol);
  sql(env, "UPDATE users SET contact_pref = 'anyone' WHERE id = ?", ids.dan);
  const group = ok(await api(env, "POST", "/v1/conversations", { as: as("alice"), body: { handles: ["carol", "dan"], title: "Field trip", body: "Plans" } }));
  assert.equal(group.kind, "group");
  assert.equal(row(env, "SELECT status FROM conversation_members WHERE conversation_id = ? AND user_id = ?", group.id, ids.carol).status, "request");
  assert.equal(row(env, "SELECT status FROM conversation_members WHERE conversation_id = ? AND user_id = ?", group.id, ids.dan).status, "active");
  ok(await api(env, "GET", `/v1/conversations/${group.id}/messages`, { as: as("bob") }), 404);
});

test("a block stops messages both ways with 403", async () => {
  const env = makeEnv();
  const ids = await people(env, "erin", "frank", "gina");
  sql(env, "UPDATE users SET contact_pref = 'anyone' WHERE id IN (?, ?)", ids.erin, ids.frank);
  const conv = ok(await api(env, "POST", "/v1/conversations", { as: as("frank"), body: { handles: ["erin"], body: "hello" } }));
  sql(env, "INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)", ids.erin, ids.frank, T());
  const res = await api(env, "POST", "/v1/conversations", { as: as("frank"), body: { handles: ["erin"], body: "again" } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "You can't message this person.");
  ok(await api(env, "POST", `/v1/conversations/${conv.id}/messages`, { as: as("frank"), body: { body: "hello?" } }), 403);
  ok(await api(env, "POST", `/v1/conversations/${conv.id}/messages`, { as: as("erin"), body: { body: "bye" } }), 403);
  ok(await api(env, "POST", "/v1/conversations", { as: as("erin"), body: { handles: ["gina", "frank"], body: "group" } }), 403);
});

// ── Moderation ─────────────────────────────────────────────────────────────

test("moderation: reports, community-moderator scope, remove/restore, suspend, audit", async () => {
  const env = makeEnv();
  const ids = await people(env, "admin", "volmod", "poster", "reporter", "bystander");
  sql(env, "INSERT INTO community_members (community_id, user_id, role, status, created_at) VALUES ('cm_volcanology', ?, 'moderator', 'active', ?)", ids.volmod, T());
  rawPost(env, { id: "p_vol", author: ids.poster, community_id: "cm_volcanology", title: "Spammy" });
  rawPost(env, { id: "p_flood", author: ids.poster, community_id: "cm_floods", title: "Elsewhere" });
  rawPost(env, { id: "p_hidden", author: ids.poster, visibility: "private", title: "Private" });

  ok(await api(env, "POST", "/v1/reports", { as: as("reporter"), body: { target_type: "post", target_id: "p_hidden", reason: "spam" } }), 404);
  const r1 = ok(await api(env, "POST", "/v1/reports", { as: as("reporter"), body: { target_type: "post", target_id: "p_vol", reason: "spam", note: "ads" } }));
  ok(await api(env, "POST", "/v1/reports", { as: as("reporter"), body: { target_type: "post", target_id: "p_vol", reason: "spam" } }), 409);
  const r2 = ok(await api(env, "POST", "/v1/reports", { as: as("reporter"), body: { target_type: "post", target_id: "p_flood", reason: "other" } }));
  const r3 = ok(await api(env, "POST", "/v1/reports", { as: as("reporter"), body: { target_type: "user", target_id: "poster", reason: "harassment" } }));

  ok(await api(env, "GET", "/v1/mod/reports", { as: as("bystander") }), 403);
  const modQueue = ok(await api(env, "GET", "/v1/mod/reports?status=open", { as: as("volmod") }));
  assert.deepEqual(modQueue.items.map((r) => r.id), [r1.id]);
  assert.equal(modQueue.items[0].target.title, "Spammy");
  assert.equal(ok(await api(env, "GET", "/v1/mod/reports", { as: as("admin") })).items.length, 3);

  ok(await api(env, "POST", `/v1/mod/reports/${r2.id}`, { as: as("volmod"), body: { action: "remove" } }), 404);
  ok(await api(env, "POST", `/v1/mod/reports/${r3.id}`, { as: as("volmod"), body: { action: "warn" } }), 404);
  ok(await api(env, "POST", `/v1/mod/reports/${r1.id}`, { as: as("volmod"), body: { action: "suspend", days: 3 } }), 403);
  ok(await api(env, "POST", `/v1/mod/reports/${r1.id}`, { as: as("volmod"), body: { action: "remove", note: "Advertising" } }));
  assert.ok(row(env, "SELECT removed_at FROM posts WHERE id = 'p_vol'").removed_at);
  assert.ok(row(env, "SELECT 1 AS x FROM audit WHERE action = 'mod.remove' AND ref_id = 'p_vol' AND actor_id = ?", ids.volmod));
  assert.ok(row(env, "SELECT 1 AS x FROM notifications WHERE user_id = ? AND kind = 'moderation'", ids.poster));
  const actioned = ok(await api(env, "GET", "/v1/mod/reports?status=actioned", { as: as("volmod") }));
  assert.equal(actioned.items[0].target.removed_at > 0, true, "moderators still see removed content");
  ok(await api(env, "POST", `/v1/mod/reports/${r1.id}`, { as: as("volmod"), body: { action: "restore" } }));
  assert.equal(row(env, "SELECT removed_at FROM posts WHERE id = 'p_vol'").removed_at, null);
  assert.ok(row(env, "SELECT 1 AS x FROM audit WHERE action = 'mod.restore' AND ref_id = 'p_vol'"));

  ok(await api(env, "POST", `/v1/mod/reports/${r3.id}`, { as: as("admin"), body: { action: "suspend", days: 2, note: "Repeated harassment" } }));
  assert.ok(row(env, "SELECT suspended_until FROM users WHERE id = ?", ids.poster).suspended_until > T() + 86400);
  ok(await api(env, "POST", "/v1/teams", { as: as("poster"), body: { name: "Should fail" } }), 403);
  ok(await api(env, "POST", `/v1/mod/reports/${r2.id}`, { as: as("admin"), body: { action: "dismiss" } }));
  assert.equal(row(env, "SELECT status FROM reports WHERE id = ?", r2.id).status, "dismissed");

  ok(await api(env, "GET", "/v1/mod/audit", { as: as("volmod") }), 403);
  const log = ok(await api(env, "GET", "/v1/mod/audit", { as: as("admin") }));
  const actions = log.items.map((a) => a.action);
  for (const a of ["mod.remove", "mod.restore", "mod.suspend", "mod.dismiss"]) assert.ok(actions.includes(a), a);
});

// ── Reputation ─────────────────────────────────────────────────────────────

test("matcher: opt-in only, explains itself, ignores followers", async () => {
  const env = makeEnv();
  const ids = await people(env, "seeker", "amatch", "zfamous", "closedguy", "shy", "blocker", "documented");
  const set = (h, fields) => sql(env, `UPDATE users SET match_opt_in = ?, availability = ?, skills_json = ? WHERE id = ?`,
    fields.opt, fields.avail, JSON.stringify(fields.skills), ids[h]);
  set("seeker", { opt: 1, avail: "open", skills: ["insar"] });
  set("amatch", { opt: 1, avail: "open", skills: ["insar"] });
  set("zfamous", { opt: 1, avail: "limited", skills: ["insar"] });
  set("closedguy", { opt: 1, avail: "closed", skills: ["insar"] });
  set("shy", { opt: 0, avail: "open", skills: ["insar"] });
  set("blocker", { opt: 1, avail: "open", skills: ["insar"] });
  set("documented", { opt: 1, avail: "open", skills: ["insar"] });
  sql(env, "INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)", ids.blocker, ids.seeker, T());
  // zfamous has a crowd of followers; it must change nothing.
  for (let i = 0; i < 30; i += 1) {
    sql(env, "INSERT INTO users (id, email, handle, created_at, updated_at) VALUES (?, ?, ?, 0, 0)", `u_f${i}`, `f${i}@example.com`, `fan${i}`);
    sql(env, "INSERT INTO follows (follower_id, target_type, target_id, created_at) VALUES (?, 'user', ?, 0)", `u_f${i}`, ids.zfamous);
  }
  rawPost(env, { id: "p_a1", author: ids.documented, kind: "analysis", tags: ["insar"] });
  rawPost(env, { id: "p_a2", author: ids.documented, kind: "analysis", tags: ["insar"] });
  rawPost(env, { id: "p_a3", author: ids.shy, kind: "analysis", tags: ["insar"] });

  const res = ok(await api(env, "POST", "/v1/match", { as: as("seeker"), body: { skills: ["InSAR"] } }));
  assert.equal(res.note, "Suggestions explain themselves and are not a ranking of anybody's ability.");
  assert.deepEqual(res.items.map((i) => i.user.handle), ["documented", "amatch", "zfamous"]);
  assert.deepEqual(res.items[0].reasons, ["Lists insar as a skill (self-declared)", "Posted 2 analyses tagged insar (documented)"]);
  assert.deepEqual(res.items[2].reasons, ["Lists insar as a skill (self-declared)"]);
  ok(await api(env, "POST", "/v1/match", { as: as("seeker"), body: {} }), 400);
});

test("badges: published criteria, refresh awards and revokes with evidence; reputation breakdown", async () => {
  const env = makeEnv();
  const ids = await people(env, "obs", "fan");
  const badges = ok(await api(env, "GET", "/v1/badges"));
  assert.equal(badges.items.length, 6);
  assert.ok(badges.items.every((b) => b.id && b.name && b.criteria));

  sql(env, "UPDATE users SET orcid_verified = 1, orcid = '0000-0002-1825-0097' WHERE id = ?", ids.obs);
  rawPost(env, { id: "p_ds", author: ids.obs, kind: "dataset", title: "GNSS series", licence: "CC-BY-4.0" });
  rawPost(env, { id: "p_closed", author: ids.obs, kind: "dataset", title: "Closed", licence: "all-rights-reserved" });
  rawPost(env, { id: "p_tut", author: ids.obs, title: "How to unwrap", tags: ["tutorial"] });
  // Followers are not reputation.
  sql(env, "INSERT INTO follows (follower_id, target_type, target_id, created_at) VALUES (?, 'user', ?, 0)", ids.fan, ids.obs);

  const first = ok(await api(env, "POST", "/v1/badges/refresh", { as: as("obs") }));
  assert.deepEqual(first.awarded.sort(), ["open-data-contributor", "verified-researcher"]);
  assert.deepEqual(JSON.parse(row(env, "SELECT evidence_json FROM badges WHERE user_id = ? AND badge = 'open-data-contributor'", ids.obs).evidence_json).posts, ["p_ds"]);
  assert.equal(row(env, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'badge'", ids.obs).n, 2);
  const second = ok(await api(env, "POST", "/v1/badges/refresh", { as: as("obs") }));
  assert.deepEqual(second.awarded, []);
  assert.equal(row(env, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'badge'", ids.obs).n, 2);

  const rep = ok(await api(env, "GET", "/v1/users/obs/reputation"));
  const cat = Object.fromEntries(rep.categories.map((c) => [c.id, c]));
  assert.equal(cat.datasets_workflows.count, 2);
  assert.equal(cat.teaching.count, 1);
  assert.equal(cat.teaching.evidence[0].id, "p_tut");
  assert.equal(rep.badges.length, 2);
  assert.ok(!JSON.stringify(rep).includes("follow"));

  sql(env, "UPDATE posts SET removed_at = ? WHERE id = 'p_ds'", T());
  const third = ok(await api(env, "POST", "/v1/badges/refresh", { as: as("obs") }));
  assert.deepEqual(third.revoked, ["open-data-contributor"]);
  assert.deepEqual(third.badges.map((b) => b.id), ["verified-researcher"]);
  ok(await api(env, "GET", "/v1/users/nobody_here/reputation"), 404);

  // A badge appeal goes through reports.
  ok(await api(env, "POST", "/v1/reports", { as: as("obs"), body: { kind: "appeal", target_type: "badge", target_id: "open-data-contributor", reason: "other" } }));
});
