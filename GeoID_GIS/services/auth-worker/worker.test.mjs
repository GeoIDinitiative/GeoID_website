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
  sign, verify, stripeSignatureValid, applyStripeEvent, PROVIDERS,
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

// ── 7. Microsoft, and the link for the address on the receipt ──────────────

const realFetch = globalThis.fetch;
const withFetch = async (handler, fn) => {
  globalThis.fetch = handler;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
};
const graph = (me) => async () => new Response(JSON.stringify(me), { status: 200 });
const baseEnv = () => ({
  ...kv(), JWT_SECRET: SECRET, SELF_ORIGIN: "https://auth.example.org",
  SITE_ORIGIN: "https://example.org", RETURN_ORIGINS: "https://example.org",
  RESEND_API_KEY: "re_test", MAIL_FROM: "sign-in@example.org", MS_CLIENT_ID: "ms-id",
});

{
  const r = await worker.fetch(new Request(
    "https://auth.example.org/auth/start?provider=microsoft&return=https://example.org/sign-in/"), baseEnv());
  const loc = new URL(r.headers.get("location") || "https://x/");
  check("microsoft sign-in starts at login.microsoftonline.com/common",
    r.status === 302 && loc.hostname === "login.microsoftonline.com" && loc.pathname.startsWith("/common/")
      && loc.searchParams.get("client_id") === "ms-id"
      && loc.searchParams.get("redirect_uri") === "https://auth.example.org/auth/callback/microsoft",
    loc.toString().slice(0, 80));
}
check("microsoft: a personal account's UPN is its address",
  (await withFetch(graph({ userPrincipalName: "Some.One@outlook.com", displayName: "S" }),
    () => PROVIDERS.microsoft.identify("t"))).email === "some.one@outlook.com");
check("microsoft: a work account's mail wins over its UPN",
  (await withFetch(graph({ mail: "s@uni.ac.uk", userPrincipalName: "s@tenant.onmicrosoft.com" }),
    () => PROVIDERS.microsoft.identify("t"))).email === "s@uni.ac.uk");
check("microsoft: a guest's #EXT# UPN is refused",
  await withFetch(graph({ userPrincipalName: "x_gmail.com#EXT#@tenant.onmicrosoft.com" }),
    () => PROVIDERS.microsoft.identify("t").then(() => false, () => true)));

{
  const env = baseEnv();
  env.m.set("member:mem@outlook.com", JSON.stringify({ until: now() + 30 * 86400, plan: "member" }));
  const sent = [];
  const mailer = async (u, init) => { sent.push({ u, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); };
  const ask = (email, ret = "https://example.org/sign-in/?next=%2Fgeohub%2F") => withFetch(mailer, () =>
    worker.fetch(new Request("https://auth.example.org/auth/email", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, return: ret }),
    }), env));

  const r1 = await ask("Mem@Outlook.com");
  const j1 = await r1.json();
  check("a member's address gets a link, through the mail service",
    r1.status === 200 && sent.length === 1 && sent[0].u === "https://api.resend.com/emails"
      && sent[0].body.to[0] === "mem@outlook.com" && sent[0].body.from === "sign-in@example.org",
    JSON.stringify(j1).slice(0, 80));
  const link = (sent[0]?.body.text.match(/https:\S+/) || [""])[0];
  check("the link is the service's own email callback",
    link.startsWith("https://auth.example.org/auth/callback/email?token="), link.slice(0, 60));
  const r2 = await ask("nobody@example.org");
  const j2 = await r2.json();
  check("a non-member's address gets the same sentence and no mail",
    r2.status === 200 && j2.message === j1.message && sent.length === 1);
  const r3 = await ask("mem@outlook.com");
  check("a second ask within a minute sends no second mail", r3.status === 200 && sent.length === 1);
  const r5 = await ask("not-an-address");
  check("a non-address is refused", r5.status === 400);

  const f1 = await worker.fetch(new Request(link), env);
  const to = new URL(f1.headers.get("location") || "https://x/");
  const tok = decodeURIComponent(to.hash.replace(/^#token=/, ""));
  const claims = await verify(tok, SECRET, { audience: "site" });
  check("following the link issues a member session at the return address",
    f1.status === 302 && `${to.origin}${to.pathname}${to.search}` === "https://example.org/sign-in/?next=%2Fgeohub%2F"
      && claims?.email === "mem@outlook.com" && claims.member === true, to.hash.slice(0, 30));
  const f2 = await worker.fetch(new Request(link), env);
  const to2 = new URL(f2.headers.get("location") || "https://x/");
  check("the link works once", f2.status === 302 && to2.hash.startsWith("#auth-error="), to2.hash.slice(0, 40));
  check("a link token is not a session",
    (await verify(new URL(link).searchParams.get("token"), SECRET, { audience: "site" })) === null);
  const f3 = await worker.fetch(new Request("https://auth.example.org/auth/callback/email?token=nope"), env);
  check("a bad link is refused", f3.status === 400);

  // A return address off the allowlist is not carried into the link.
  env.m.delete("link:mem@outlook.com");
  await ask("mem@outlook.com", "https://evil.example/steal");
  const evilLink = (sent[1]?.body.text.match(/https:\S+/) || [""])[0];
  const evilClaims = evilLink ? await verify(new URL(evilLink).searchParams.get("token"), SECRET, { audience: "link" }) : null;
  check("a return address off the allowlist is not carried into the link",
    !!evilClaims && new URL(evilClaims.r).origin === "https://example.org", evilClaims?.r);

  const off = baseEnv(); delete off.RESEND_API_KEY;
  const r4 = await worker.fetch(new Request("https://auth.example.org/auth/email",
    { method: "POST", body: JSON.stringify({ email: "a@b.co" }) }), off);
  check("without a mail key the door says it is not set up", r4.status === 503, String(r4.status));
}

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
