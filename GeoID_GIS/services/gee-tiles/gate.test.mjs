/**
 * The membership gate on the Earth Engine service.
 *
 * What it proves, against real HS256 signatures made with node's own crypto
 * rather than with the function's: an unsigned request is refused, a valid
 * pass is served, and every way a pass can be wrong — another secret, the
 * session token's audience rather than the data pass's, an expiry in the
 * past, a mangled signature — is refused the same way. It also proves the
 * two things that are easy to get backwards: `?list` stays open because it
 * costs nothing, and a deployment with no secret refuses rather than waving
 * requests through.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { __testing } = require("./index.js");
const { validPass, refuseRequest, buckets } = __testing;

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
};

const SECRET = "a-test-signing-secret";
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function sign(payload, secret = SECRET) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const mac = crypto.createHmac("sha256", secret)
    .update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${mac}`;
}

const now = () => Math.floor(Date.now() / 1000);
const dataPass = (over = {}) =>
  sign({ aud: "data", iat: now(), exp: now() + 900, ...over });

// ── The verifier ───────────────────────────────────────────────────────────

check("a real data pass verifies", !!validPass(dataPass(), SECRET));
check("another secret is refused", validPass(dataPass(), "not-the-secret") === null);
check("the session token's audience is refused",
  validPass(dataPass({ aud: "site" }), SECRET) === null);
check("an expired pass is refused",
  validPass(dataPass({ exp: now() - 1 }), SECRET) === null);
check("a pass with no expiry is refused",
  validPass(sign({ aud: "data" }), SECRET) === null);
check("a mangled signature is refused",
  validPass(`${dataPass().slice(0, -3)}aaa`, SECRET) === null);
check("a token of the wrong shape is refused and does not throw",
  validPass("not-a-token", SECRET) === null);
check("an empty token is refused", validPass("", SECRET) === null);

// ── The gate ───────────────────────────────────────────────────────────────

const reqFor = (headers = {}, query = {}, ip = "198.51.100.1") => ({
  ip,
  query,
  get: (name) => headers[String(name).toLowerCase()],
});

function withEnv(env, fn) {
  const before = { ...process.env };
  Object.assign(process.env, env);
  buckets.clear();
  try {
    return fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

withEnv({ JWT_SECRET: SECRET }, () => {
  const bare = refuseRequest(reqFor(), { billed: true });
  check("a billed request with no pass is refused 402",
    bare && bare.code === 402, bare ? `got ${bare.code}` : "allowed");
  check("the refusal names membership rather than the reason it failed",
    !!bare && /membership/i.test(bare.message) && !/signature|expired/i.test(bare.message));

  const good = refuseRequest(
    reqFor({ authorization: `Bearer ${dataPass()}` }), { billed: true });
  check("a member's pass is served", good === null, good ? good.message : "");

  const viaQuery = refuseRequest(
    reqFor({}, { t: dataPass() }, "198.51.100.9"), { billed: true });
  check("a pass in the query string is served too", viaQuery === null);

  const stale = refuseRequest(
    reqFor({ authorization: `Bearer ${dataPass({ exp: now() - 1 })}` },
      {}, "198.51.100.2"), { billed: true });
  check("an expired pass is refused 402", stale && stale.code === 402);

  check("the catalogue listing stays open",
    refuseRequest(reqFor({}, { list: "" }, "198.51.100.3"), { billed: false }) === null);
});

withEnv({ JWT_SECRET: "" }, () => {
  const none = refuseRequest(reqFor(), { billed: true });
  check("with no secret it refuses rather than serving", none && none.code === 503,
    none ? `got ${none.code}` : "ALLOWED — fails open");
});

withEnv({ JWT_SECRET: SECRET, REQUIRE_MEMBERSHIP: "0" }, () => {
  check("REQUIRE_MEMBERSHIP=0 is the only way past the gate",
    refuseRequest(reqFor({}, {}, "198.51.100.4"), { billed: true }) === null);
});

// ── The rate limit ─────────────────────────────────────────────────────────

withEnv({ JWT_SECRET: SECRET, RATE_PER_MIN_IP: "5" }, () => {
  const req = () => refuseRequest(
    reqFor({ authorization: `Bearer ${dataPass()}` }, {}, "203.0.113.7"), { billed: true });
  let refused = null;
  for (let i = 0; i < 200 && !refused; i += 1) {
    const answer = req();
    if (answer) refused = answer;
  }
  check("a runaway loop from one address is stopped",
    refused && refused.code === 429, refused ? `got ${refused.code}` : "never refused");
  check("the 429 says to wait rather than naming membership",
    !!refused && /wait/i.test(refused.message));
});

withEnv({ JWT_SECRET: SECRET, RATE_PER_MIN_PASS: "3" }, () => {
  const pass = dataPass();
  let refused = null;
  // A fresh address each time, so only the PASS limit can be what stops it.
  for (let i = 0; i < 200 && !refused; i += 1) {
    const answer = refuseRequest(
      reqFor({ authorization: `Bearer ${pass}` }, {}, `192.0.2.${i % 200}`),
      { billed: true });
    if (answer) refused = answer;
  }
  check("one pass cannot spend an instance's whole budget",
    refused && refused.code === 429, refused ? `got ${refused.code}` : "never refused");
});

process.on("exit", () => {
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  if (failed) process.exitCode = 1;
});
