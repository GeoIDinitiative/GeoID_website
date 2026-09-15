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
import worker, {
  sign, verify, stripeSignatureValid, applyStripeEvent,
  STRIPE_GRACE_SECONDS, STRIPE_TOLERANCE_SECONDS,
} from "./worker.js";
import { createHmac } from "node:crypto";

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

// ── 6. Stripe: the signature, and what a payment does to the list ──────────

// The signature is built here with node's OWN HMAC, not the Worker's, so a
// pass means the two implementations agree on Stripe's scheme rather than
// that one agrees with itself.
const WHSEC = "whsec_test_signing_secret";
const stripeHeader = (payload, t = now(), secret = WHSEC) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
const payload = JSON.stringify({ id: "evt_sig", type: "invoice.paid" });

check("a genuine Stripe signature passes",
  await stripeSignatureValid(payload, stripeHeader(payload), WHSEC));
check("a signature under another secret is refused",
  !(await stripeSignatureValid(payload, stripeHeader(payload, now(), "whsec_other"), WHSEC)));
check("a changed body is refused",
  !(await stripeSignatureValid(`${payload} `, stripeHeader(payload), WHSEC)));
check("a stale timestamp is refused (replay)",
  !(await stripeSignatureValid(payload, stripeHeader(payload, now() - STRIPE_TOLERANCE_SECONDS - 5), WHSEC)));
check("a header with no v1 is refused",
  !(await stripeSignatureValid(payload, `t=${now()}`, WHSEC)));
check("no secret means no delivery is genuine",
  !(await stripeSignatureValid(payload, stripeHeader(payload), "")));
check("a second v1 (a secret being rotated) still passes",
  await stripeSignatureValid(payload, `${stripeHeader(payload)},v1=deadbeef`, WHSEC));

// A KV stub: the Map is the whole of what the Worker may know.
function kv() {
  const m = new Map();
  return {
    m,
    MEMBERS: {
      get: async (k) => (m.has(k) ? m.get(k) : null),
      put: async (k, v) => { m.set(k, String(v)); },
    },
  };
}
const member = (env, email) => JSON.parse(env.m.get(`member:${email}`) || "null");
const T = 1_800_000_000;
const YEAR_GRACE = 366 * 86400 + STRIPE_GRACE_SECONDS;

{
  const env = kv();
  const r = await applyStripeEvent(env, { id: "evt_a", type: "checkout.session.completed",
    data: { object: { mode: "subscription", customer: "cus_1", customer_details: { email: "Ann@Example.org" } } } }, T);
  check("a completed checkout grants a member year",
    r.action === "granted" && member(env, "ann@example.org")?.plan === "member", JSON.stringify(r));
  check("the address is lowercased", env.m.has("member:ann@example.org"));
  check("the customer id is remembered against the address",
    env.m.get("stripe:customer:cus_1") === "ann@example.org");
  check("the until is a year plus the grace week",
    member(env, "ann@example.org").until === T + YEAR_GRACE);
  const again = await applyStripeEvent(env, { id: "evt_a", type: "checkout.session.completed", data: { object: {} } }, T);
  check("a retried delivery is a no-op", again.action === "duplicate");
}
{
  const env = kv();
  const end = T + 30 * 86400;
  const r = await applyStripeEvent(env, { id: "evt_b", type: "invoice.paid",
    data: { object: { customer: "cus_2", customer_email: "bo@example.org",
      lines: { data: [{ period: { end } }, { period: { end: end - 100 } }] } } } }, T);
  check("an invoice grants to its latest period end plus grace",
    member(env, "bo@example.org").until === end + STRIPE_GRACE_SECONDS, JSON.stringify(r));
  const r2 = await applyStripeEvent(env, { id: "evt_c", type: "invoice.paid",
    data: { object: { customer: "cus_2", lines: { data: [{ period: { end: end + 365 * 86400 } }] } } } }, T);
  check("a renewal carrying no address finds the member by customer id",
    member(env, "bo@example.org").until === end + 365 * 86400 + STRIPE_GRACE_SECONDS, JSON.stringify(r2));
}
{
  const env = kv();
  const far = T + 10 * 365 * 86400;
  env.m.set("member:own@example.org", JSON.stringify({ until: far, plan: "owner" }));
  await applyStripeEvent(env, { id: "evt_d", type: "invoice.paid",
    data: { object: { customer_email: "own@example.org", lines: { data: [{ period: { end: T + 86400 } }] } } } }, T);
  check("an owner is never shortened or downgraded by a payment",
    member(env, "own@example.org").plan === "owner" && member(env, "own@example.org").until === far);
  await applyStripeEvent(env, { id: "evt_e", type: "charge.refunded",
    data: { object: { refunded: true, billing_details: { email: "own@example.org" } } } }, T);
  check("an owner survives a refund untouched",
    member(env, "own@example.org").plan === "owner" && member(env, "own@example.org").until === far);
}
{
  const env = kv();
  env.m.set("member:cy@example.org", JSON.stringify({ until: T + 300 * 86400, plan: "member" }));
  env.m.set("stripe:customer:cus_3", "cy@example.org");
  const end = T + 20 * 86400;
  await applyStripeEvent(env, { id: "evt_f", type: "customer.subscription.deleted",
    data: { object: { customer: "cus_3", current_period_end: end } } }, T);
  check("a cancellation keeps the paid period and ends the renewal",
    member(env, "cy@example.org").until === end + STRIPE_GRACE_SECONDS);
  await applyStripeEvent(env, { id: "evt_g", type: "customer.subscription.deleted",
    data: { object: { customer: "cus_3", current_period_end: end + 100 * 86400 } } }, T);
  check("a cancellation never lengthens a membership",
    member(env, "cy@example.org").until === end + STRIPE_GRACE_SECONDS);
  await applyStripeEvent(env, { id: "evt_h", type: "charge.refunded",
    data: { object: { refunded: true, customer: "cus_3" } } }, T);
  check("a refund ends the membership", member(env, "cy@example.org").until < T);
}
{
  const env = kv();
  const r = await applyStripeEvent(env, { id: "evt_i", type: "payment_intent.succeeded", data: { object: {} } }, T);
  check("an unrelated event is ignored and writes no member",
    r.action === "ignored" && ![...env.m.keys()].some((k) => k.startsWith("member:")));
  const r2 = await applyStripeEvent(env, { id: "evt_j", type: "invoice.paid", data: { object: { customer: "cus_none" } } }, T);
  check("an invoice with no address and no known customer grants nothing",
    r2.action === "no-email" && ![...env.m.keys()].some((k) => k.startsWith("member:")));
  const r3 = await applyStripeEvent(env, { id: "evt_k", type: "checkout.session.completed",
    data: { object: { mode: "payment", customer_details: { email: "d@example.org" } } } }, T);
  check("a one-off payment (a donation) is not a membership",
    r3.action === "not-a-subscription" && !env.m.has("member:d@example.org"));
}

// The route itself, through the Worker's own fetch.
{
  const base = kv();
  const env = { ...base, STRIPE_WEBHOOK_SECRET: WHSEC, SELF_ORIGIN: "https://auth.example.org",
    SITE_ORIGIN: "https://example.org", RETURN_ORIGINS: "https://example.org", JWT_SECRET: SECRET };
  const body = JSON.stringify({ id: "evt_r", type: "checkout.session.completed",
    data: { object: { mode: "subscription", customer_details: { email: "r@example.org" } } } });
  const post = (headers) => worker.fetch(new Request("https://auth.example.org/stripe/webhook",
    { method: "POST", headers, body }), env);
  const bad = await post({ "Stripe-Signature": stripeHeader(body, now(), "whsec_wrong") });
  check("the route refuses a bad signature and writes nothing",
    bad.status === 400 && !base.m.has("member:r@example.org"), String(bad.status));
  const good = await post({ "Stripe-Signature": stripeHeader(body) });
  const got = await good.json();
  check("the route applies a signed event",
    good.status === 200 && got.received === true && got.action === "granted" && base.m.has("member:r@example.org"),
    JSON.stringify(got));
  check("the reply carries no address", !JSON.stringify(got).includes("example.org"));
  const unset = await worker.fetch(new Request("https://auth.example.org/stripe/webhook", { method: "POST", body }),
    { ...kv(), JWT_SECRET: SECRET });
  check("with no webhook secret the route answers 503", unset.status === 503, String(unset.status));
  const get = await worker.fetch(new Request("https://auth.example.org/stripe/webhook"), env);
  check("GET on the webhook is 405", get.status === 405, String(get.status));
}

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
