import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";

const PROF = "prof@example.com", STUDENT = "student@example.com", OUT = "outsider@example.com", MATE = "mate@example.com";

async function setup() {
  const env = makeEnv();
  for (const [who, handle] of [[PROF, "prof"], [STUDENT, "student"], [OUT, "outsider"], [MATE, "mate"]]) {
    await call(env, "PATCH", "/v1/me", { as: who, body: { handle } });
  }
  const project = (await call(env, "POST", "/v1/projects", { as: PROF, body: {
    title: "Etna reservoir", visibility: "private", workspace: { world: "earth", layers: [] } } })).body;
  const pid = project.id || project.project?.id;
  await call(env, "POST", `/v1/projects/${pid}/grants`, { as: PROF, body: { handle: "student", role: "commenter" } });
  return { env, pid };
}

test("a project-visibility post is seen by people with access and nobody else", async () => {
  const { env, pid } = await setup();
  const post = await call(env, "POST", "/v1/posts", { as: PROF, body: {
    kind: "scene", title: "Shared globe for the group", visibility: "project", project_id: pid,
    scene: { world: "earth", camera: { lat: 37.7, lon: 15, alt: 9000 } } } });
  assert.equal(post.status, 200, JSON.stringify(post.body));
  assert.equal((await call(env, "GET", `/v1/posts/${post.body.id}`, { as: STUDENT })).status, 200);
  assert.equal((await call(env, "GET", `/v1/posts/${post.body.id}`, { as: OUT })).status, 404);
  assert.equal((await call(env, "GET", `/v1/posts/${post.body.id}`)).status, 404);
  const studentFeed = await call(env, "GET", `/v1/feed?project=${pid}`, { as: STUDENT });
  assert.equal(studentFeed.body.items.length, 1);
  const outFeed = await call(env, "GET", `/v1/feed?project=${pid}`, { as: OUT });
  assert.equal(outFeed.body.items.length, 0);
});

test("a commenter can post into the project; a stranger cannot; project visibility needs a project", async () => {
  const { env, pid } = await setup();
  const mine = await call(env, "POST", "/v1/posts", { as: STUDENT, body: { title: "My mesh attempt", visibility: "project", project_id: pid } });
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  const stranger = await call(env, "POST", "/v1/posts", { as: OUT, body: { title: "x", visibility: "project", project_id: pid } });
  assert.equal(stranger.status, 400);
  const loose = await call(env, "POST", "/v1/posts", { as: PROF, body: { title: "x", visibility: "project" } });
  assert.equal(loose.status, 400);
});

test("a team grant opens project posts to team members, and removal closes them", async () => {
  const { env, pid } = await setup();
  const team = (await call(env, "POST", "/v1/teams", { as: PROF, body: { name: "Lab group" } })).body;
  const slug = team.slug || team.team?.slug;
  await call(env, "POST", `/v1/teams/${slug}/invite`, { as: PROF, body: { handle: "mate", role: "member" } });
  await call(env, "POST", `/v1/teams/${slug}/respond`, { as: MATE, body: { accept: true } });
  await call(env, "POST", `/v1/projects/${pid}/grants`, { as: PROF, body: { team_slug: slug, role: "viewer" } });
  const post = (await call(env, "POST", "/v1/posts", { as: PROF, body: { title: "For the lab", visibility: "project", project_id: pid } })).body;
  assert.equal((await call(env, "GET", `/v1/posts/${post.id}`, { as: MATE })).status, 200);
  await call(env, "DELETE", `/v1/teams/${slug}/members/mate`, { as: PROF });
  assert.equal((await call(env, "GET", `/v1/posts/${post.id}`, { as: MATE })).status, 404);
});

test("model posts keep config by reference and refuse an off-site page", async () => {
  const { env } = await setup();
  const ok = await call(env, "POST", "/v1/posts", { as: PROF, body: { kind: "model", title: "Etna FEM domain",
    meta: { page: "/GeoID_GIS/viewer/model-builder/", domain: { world: "earth", bbox: [14.8, 37.6, 15.2, 37.9] },
      solver: "elastic", params: { E: 30e9 }, config: { refine: 3 } } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.meta.mesher, "gmsh");
  assert.equal(ok.body.meta.page, "/GeoID_GIS/viewer/model-builder/");
  const redirect = await call(env, "POST", "/v1/posts", { as: PROF, body: { kind: "model", title: "x", meta: { page: "https://evil.example/" } } });
  assert.equal(redirect.body.meta.page, "");
  const big = await call(env, "POST", "/v1/posts", { as: PROF, body: { kind: "model", title: "x", meta: { config: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "x".repeat(3000)])) } } });
  assert.equal(big.status, 413);
  const research = await call(env, "GET", "/v1/feed?tab=research", { as: OUT });
  assert.ok(research.body.items.some((p) => p.kind === "model"));
});

test("repo posts need an https repository link and infer the host", async () => {
  const { env } = await setup();
  const ok = await call(env, "POST", "/v1/posts", { as: PROF, body: { kind: "repo", title: "rf-susceptibility",
    meta: { url: "https://github.com/example/rf-susceptibility", language: "Python" } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.meta.host, "github");
  const bad = await call(env, "POST", "/v1/posts", { as: PROF, body: { kind: "repo", title: "x", meta: { url: "javascript:alert(1)" } } });
  assert.equal(bad.status, 400);
});
