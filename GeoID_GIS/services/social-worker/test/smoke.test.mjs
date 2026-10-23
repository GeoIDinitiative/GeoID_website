import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";

test("health answers and the schema loads", async () => {
  const env = makeEnv();
  const res = await call(env, "GET", "/v1/health");
  assert.equal(res.status, 200);
  const n = env.DB.raw.prepare("SELECT COUNT(*) AS n FROM communities").get().n;
  assert.equal(n, 9);
});

test("unknown route is 404", async () => {
  const res = await call(makeEnv(), "GET", "/v1/nope");
  assert.equal(res.status, 404);
});
