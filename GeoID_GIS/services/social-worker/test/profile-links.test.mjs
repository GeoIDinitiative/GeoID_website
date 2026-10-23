import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";

const ME = "linked@example.com";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test("profile customisation: bio, institution, LinkedIn and picture are all optional", async () => {
  const env = makeEnv();
  await call(env, "PATCH", "/v1/me", { as: ME, body: { handle: "linked" } });
  const saved = await call(env, "PATCH", "/v1/me", { as: ME, body: {
    bio: "Glaciologist.", institution: "University of Leeds", linkedin: "https://www.linkedin.com/in/someone" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const pub = (await call(env, "GET", "/v1/users/linked")).body.user;
  assert.equal(pub.linkedin, "https://www.linkedin.com/in/someone");
  assert.equal(pub.institution, "University of Leeds");
  assert.equal(pub.bio, "Glaciologist.");

  // Not LinkedIn, not https, or a lookalike host: refused rather than labelled LinkedIn.
  for (const bad of ["https://evil.example/in/x", "http://www.linkedin.com/in/x", "https://linkedin.com.evil.example/x", "javascript:alert(1)"]) {
    assert.equal((await call(env, "PATCH", "/v1/me", { as: ME, body: { linkedin: bad } })).status, 400, bad);
  }
  // Clearing each optional field works.
  await call(env, "PATCH", "/v1/me", { as: ME, body: { linkedin: "", institution: "", bio: "" } });
  const cleared = (await call(env, "GET", "/v1/users/linked")).body.user;
  assert.equal(cleared.linkedin, ""); assert.equal(cleared.institution, ""); assert.equal(cleared.bio, "");

  // Picture: upload, set, then remove.
  const form = new FormData();
  form.append("file", new Blob([PNG], { type: "image/png" }), "me.png");
  const up = await call(env, "POST", "/v1/media", { as: ME, form });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  await call(env, "PATCH", "/v1/me", { as: ME, body: { avatar_key: up.body.key } });
  assert.ok((await call(env, "GET", "/v1/users/linked")).body.user.avatar);
  await call(env, "PATCH", "/v1/me", { as: ME, body: { avatar_key: "" } });
  assert.equal((await call(env, "GET", "/v1/users/linked")).body.user.avatar, "");
});
