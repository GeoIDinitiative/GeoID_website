/**
 * Checks for the membership service's token, which is the gate itself.
 *
 *     node GeoID_GIS/services/auth-worker/worker.test.mjs
 *
 * Only the arithmetic is checked here -- signing, verifying, expiry, audience --
 * because that is the part that can be wrong SILENTLY and in the worst
 * direction. A verify that accepts a forged token is not a gate, and one that
 * accepts an expired one is a membership nobody can revoke. The OAuth round
 * trip is not simulated: it needs two providers and a deployment, and faking it
 * would only prove the fake agrees with itself.
 *
 * Node has WebCrypto on `globalThis.crypto` from 18, which is the same API the
 * Worker runtime gives, so this is the real implementation rather than a copy.
 */
import { sign, verify } from "./worker.js";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const SECRET = "a-long-random-string-of-the-kind-openssl-rand-gives";
const now = () => Math.floor(Date.now() / 1000);
const claims = (over = {}) => ({
  sub: "r@example.org", email: "r@example.org", name: "Rae",
  member: true, aud: "site", iat: now(), exp: now() + 3600, ...over,
});

// ── 1. A token this service signed, it accepts ─────────────────────────────

const good = await sign(claims(), SECRET);
check("a signed token has three parts", good.split(".").length === 3);
const read = await verify(good, SECRET);
check("...and verifies", !!read, read ? "" : "refused its own token");
check("...carrying what was signed",
  read?.email === "r@example.org" && read?.member === true, JSON.stringify(read));

// ── 2. Anything else, it refuses — and refuses the SAME WAY ────────────────

// Null for every failure, so a caller cannot tell them apart and act
// differently on one of them.
check("a token signed with another key is refused",
  (await verify(await sign(claims(), "the-wrong-key"), SECRET)) === null);
check("a token with a tampered payload is refused",
  await (async () => {
    const [h, , s] = good.split(".");
    const forged = Buffer.from(JSON.stringify(claims({ member: true, email: "attacker@example.org" })))
      .toString("base64url");
    return (await verify(`${h}.${forged}.${s}`, SECRET)) === null;
  })());
check("a malformed token is refused", (await verify("not.a.token", SECRET)) === null);
check("an empty token is refused", (await verify("", SECRET)) === null);
check("a two-part token is refused", (await verify("a.b", SECRET)) === null);

// ── 3. Expiry is checked HERE, not left to the caller ──────────────────────

// A token that never runs out is one a revoked member keeps for ever, so an
// absent `exp` is as bad as a past one and is refused the same way.
check("an expired token is refused",
  (await verify(await sign(claims({ exp: now() - 1 }), SECRET), SECRET)) === null);
check("a token with no expiry is refused",
  (await verify(await sign({ email: "r@example.org" }, SECRET), SECRET)) === null);
check("a non-numeric expiry is refused",
  (await verify(await sign(claims({ exp: "later" }), SECRET), SECRET)) === null);

// ── 4. The audience keeps the two tokens apart ─────────────────────────────

// The data token travels in a query string and is worth fifteen minutes; the
// session token is worth a week and answers who somebody is. Letting one stand
// in for the other would make the short one long.
const dataToken = await sign({ aud: "data", iat: now(), exp: now() + 900 }, SECRET);
check("a data token does not pass as a session",
  (await verify(dataToken, SECRET, { audience: "site" })) === null);
check("a session token does not pass at the bucket",
  (await verify(good, SECRET, { audience: "data" })) === null);
check("each passes for its own audience",
  !!(await verify(dataToken, SECRET, { audience: "data" }))
  && !!(await verify(good, SECRET, { audience: "site" })));

// ── 5. It round-trips what a payload actually holds ────────────────────────

const named = await verify(await sign(claims({ name: "Ràe Ó Súilleabháin" }), SECRET), SECRET);
check("a name outside ASCII survives the round trip",
  named?.name === "Ràe Ó Súilleabháin", named?.name);

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
