/**
 * The membership service: who is signed in, and what they hold.
 *
 * A Cloudflare Worker, on the account that already serves the bucket and the
 * custom domain, so membership adds no vendor and no new bill. It does three
 * things and deliberately no more:
 *
 *   GET  /auth/start?provider=google|github|microsoft&return=<url>
 *                                                           send them to sign in
 *   GET  /auth/callback/<provider>                          take them back
 *   POST /auth/email         {email, return}                a sign-in link by email
 *   GET  /auth/callback/email?token=                        the link, followed
 *   GET  /auth/me            (Bearer)                       who is this
 *   POST /auth/data-token    (Bearer)                       a short pass for the bucket
 *   POST /stripe/webhook     (Stripe-Signature)             a payment became a membership
 *
 * IT HOLDS NO WORK. A project is a folder on the member's own disk, their own
 * browser storage, or their own machine through the sidecar. What is stored
 * here is an entitlement -- an email, and until when -- and nothing else, which
 * is the whole of what a privacy notice for this has to say.
 *
 * NO PASSWORDS EVER. Sign-in is Google's, Microsoft's or GitHub's -- or a link
 * sent to the address on the receipt, for a member whose address is none of
 * those (an Outlook, an iCloud, a university's) -- so there is no password of
 * ours to hold, to leak or to reset. The provider secrets live in the
 * Worker's own environment and never reach a page: a browser cannot hold a
 * secret, which is the rule `google-credentials.js` already throws over.
 *
 * THE TOKEN COMES BACK IN THE URL FRAGMENT. A fragment is not sent to any
 * server, does not reach an access log and does not travel in a Referer, which
 * a query string does all three of.
 */

const WEEK = 7 * 24 * 3600;
const DATA_TOKEN_SECONDS = 15 * 60;

export const PROVIDERS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    idFor: (env) => env.GOOGLE_CLIENT_ID,
    secretFor: (env) => env.GOOGLE_CLIENT_SECRET,
    async identify(access) {
      const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!r.ok) throw new Error("Google would not say who that is.");
      const me = await r.json();
      // `email_verified` matters: an unverified address is a claim, not an
      // identity, and membership is looked up BY address.
      if (!me.email || me.email_verified === false) {
        throw new Error("That Google account has no verified email address.");
      }
      return { email: String(me.email).toLowerCase(), name: me.name || "" };
    },
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    idFor: (env) => env.GITHUB_CLIENT_ID,
    secretFor: (env) => env.GITHUB_CLIENT_SECRET,
    async identify(access) {
      const head = { Authorization: `Bearer ${access}`, "User-Agent": "geoid-auth", Accept: "application/vnd.github+json" };
      const [who, mails] = await Promise.all([
        fetch("https://api.github.com/user", { headers: head }).then((r) => r.json()),
        fetch("https://api.github.com/user/emails", { headers: head }).then((r) => r.json()),
      ]);
      // GitHub's profile email is whatever they chose to show, which is often
      // nothing; the primary VERIFIED address off /user/emails is the identity.
      const primary = Array.isArray(mails)
        ? mails.find((m) => m.primary && m.verified) || mails.find((m) => m.verified)
        : null;
      const email = primary?.email || who?.email;
      if (!email) throw new Error("That GitHub account has no verified email address.");
      return { email: String(email).toLowerCase(), name: who?.name || who?.login || "" };
    },
  },
  microsoft: {
    // `common` takes both a personal Microsoft account (an outlook.com, a
    // hotmail, an msn) and a work or school account in any tenant; the app
    // registration has to be made for that audience (see the README).
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid email profile User.Read",
    idFor: (env) => env.MS_CLIENT_ID,
    secretFor: (env) => env.MS_CLIENT_SECRET,
    async identify(access) {
      const r = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!r.ok) throw new Error("Microsoft would not say who that is.");
      const me = await r.json();
      // A personal account's address is its userPrincipalName; a work
      // account's is `mail`, and its UPN can be an alias. A GUEST in a tenant
      // carries a UPN of the shape `x_gmail.com#EXT#@tenant.onmicrosoft.com`,
      // which is nobody's mailbox, so it is refused rather than looked up.
      const email = String(me.mail || me.userPrincipalName || "").toLowerCase();
      if (!email || email.includes("#ext#") || !looksLikeEmail(email)) {
        throw new Error("That Microsoft account has no usable email address.");
      }
      return { email, name: me.displayName || "" };
    },
  },
};

const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));

// ── JWT, HS256, hand-rolled because a Worker has WebCrypto and needs no dep ──

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/**
 * Decode, or null.
 *
 * NEVER throws: `atob` does on anything that is not base64, and the one caller
 * is handed whatever a stranger sent. Thrown, a malformed token is a 500 where
 * it should be "not signed in" -- which is what this cost before the test
 * caught it.
 */
const unb64url = (s) => {
  try {
    return Uint8Array.from(
      atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch (error) {
    return null;
  }
};

async function key(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(payload, secret) {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(mac)}`;
}

/**
 * Verify and return the payload, or null.
 *
 * Null for every failure -- bad shape, wrong signature, expired -- because a
 * caller must not be able to tell them apart and act differently. Expiry is
 * checked HERE rather than left to the caller: a token that never runs out is
 * one a revoked member keeps for ever.
 */
export async function verify(token, secret, { audience = null } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const mac = unb64url(parts[2]);
  const body = unb64url(parts[1]);
  if (!mac || !body) return null;
  const ok = await crypto.subtle.verify("HMAC", await key(secret),
    mac, enc.encode(`${parts[0]}.${parts[1]}`)).catch(() => false);
  if (!ok) return null;
  let payload = null;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch (e) { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
  if (audience && payload.aud !== audience) return null;
  return payload;
}

// ── Membership ──────────────────────────────────────────────────────────────

/**
 * Is this address a member, and until when?
 *
 * One KV entry per member, keyed by the verified address, holding
 * `{"until": <epoch seconds>}` and optionally a plan. Absent means an
 * explorer -- which is a real, welcome state, not a failure: they sign in,
 * they are greeted by name, and they are told what membership adds.
 */
async function membership(env, email) {
  if (!env.MEMBERS) return null;
  const raw = await env.MEMBERS.get(`member:${email}`);
  if (!raw) return null;
  let rec = null;
  try { rec = JSON.parse(raw); } catch (e) { return null; }
  const until = Number(rec?.until);
  if (!Number.isFinite(until) || until <= Math.floor(Date.now() / 1000)) return null;
  return { until, plan: rec.plan || "member" };
}

/** Only ever back to somewhere we own. An open redirect is a phishing gift. */
function allowedReturn(env, wanted) {
  const allow = String(env.RETURN_ORIGINS || "").split(/[,\s]+/).filter(Boolean);
  try {
    const url = new URL(wanted);
    if (allow.includes(url.origin)) return url.toString();
  } catch (e) { /* not a url */ }
  return env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/` : "/";
}

// ── Stripe: a payment becomes a membership ──────────────────────────────────
//
// The members list used to be written by hand (`wrangler kv key put`), which
// is fine for the first few members and not for the tenth. Stripe tells this
// Worker what happened -- a checkout completed, an invoice paid, a subscription
// cancelled, a charge refunded -- signed with a secret only Stripe and this
// Worker hold, and the Worker writes the entitlement the sign-in reads.
//
// WHAT IS STORED: `member:<email>` {until, plan} as before, plus
// `stripe:customer:<id>` → email (so a cancellation or a refund, which carry
// the customer id and not always the address, still finds its member) and
// `stripe:event:<id>` for a month (Stripe retries deliveries; a retry must not
// be a second grant). Nothing about the card, the amount, or the person
// beyond the address the sign-in is keyed on.
//
// THE UNTIL IS STRIPE'S OWN PERIOD END, plus a week of grace -- Stripe's retry
// window for a failed renewal -- so a member whose card bounced once is not
// locked out on the morning of the renewal. An OWNER entry is never lowered
// or downgraded by anything Stripe says: the master accounts are ours, not
// Stripe's, and a test purchase against one must not shorten it.

export const STRIPE_GRACE_SECONDS = 7 * 24 * 3600;
export const STRIPE_TOLERANCE_SECONDS = 300;
const STRIPE_EVENT_TTL = 30 * 24 * 3600;
const YEAR_PLUS_GRACE = 366 * 24 * 3600 + STRIPE_GRACE_SECONDS;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Stripe's signature: `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`, the
 * hex being HMAC-SHA256 over `<t>.<raw body>` with the endpoint's signing
 * secret. Verified against the RAW body -- re-serialising the JSON changes
 * the bytes and fails every genuine delivery -- and refused when the
 * timestamp is older than the tolerance, or a captured delivery could be
 * replayed for as long as the secret stands. Compared in constant time.
 */
export async function stripeSignatureValid(payload, header, secret, now = Math.floor(Date.now() / 1000)) {
  if (!secret || !header) return false;
  const parts = String(header).split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v || "");
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now - t) > STRIPE_TOLERANCE_SECONDS) return false;
  const mac = hex(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`${t}.${payload}`)));
  return sigs.some((sig) => sig.length === mac.length && timingSafeEqual(sig, mac));
}

function timingSafeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readMember(env, email) {
  const raw = await env.MEMBERS.get(`member:${email}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/** Write a member's until, never lowering an owner and never downgrading one. */
async function grant(env, email, until, source) {
  const have = await readMember(env, email);
  if (have?.plan === "owner") return { action: "kept", email, until: Number(have.until), plan: "owner" };
  const rec = { until: Math.floor(until), plan: have?.plan === "member" || !have?.plan ? "member" : have.plan, source };
  await env.MEMBERS.put(`member:${email}`, JSON.stringify(rec));
  return { action: "granted", email, until: rec.until, plan: rec.plan };
}

/** Shorten a member's until to `until` (a cancellation or a refund), never an owner's. */
async function shorten(env, email, until) {
  const have = await readMember(env, email);
  if (!have) return { action: "nothing", email };
  if (have.plan === "owner") return { action: "kept", email, until: Number(have.until), plan: "owner" };
  const next = Math.min(Number(have.until) || 0, Math.floor(until));
  await env.MEMBERS.put(`member:${email}`, JSON.stringify({ ...have, until: next }));
  return { action: "shortened", email, until: next, plan: have.plan || "member" };
}

async function rememberCustomer(env, customer, email) {
  if (customer && email) await env.MEMBERS.put(`stripe:customer:${customer}`, email);
}

async function emailForCustomer(env, customer) {
  return customer ? (await env.MEMBERS.get(`stripe:customer:${customer}`)) || "" : "";
}

const emailOf = (v) => String(v || "").trim().toLowerCase();

/**
 * One Stripe event, applied to the members list. Pure over `env.MEMBERS`, so a
 * test hands it a Map. Returns what it did, for the log and for the reply.
 */
export async function applyStripeEvent(env, event, now = Math.floor(Date.now() / 1000)) {
  const id = String(event?.id || "");
  const type = String(event?.type || "");
  const obj = event?.data?.object || {};
  if (id) {
    if (await env.MEMBERS.get(`stripe:event:${id}`)) return { action: "duplicate", type };
    await env.MEMBERS.put(`stripe:event:${id}`, "1", { expirationTtl: STRIPE_EVENT_TTL });
  }
  if (type === "checkout.session.completed") {
    const email = emailOf(obj.customer_details?.email || obj.customer_email);
    if (!email) return { action: "no-email", type };
    await rememberCustomer(env, obj.customer, email);
    if (obj.mode && obj.mode !== "subscription") return { action: "not-a-subscription", type, email };
    // The invoice that follows carries the exact period; this grants the year
    // at once so the welcome page finds a member without waiting for it.
    return { ...(await grant(env, email, now + YEAR_PLUS_GRACE, "checkout")), type };
  }
  if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
    const email = emailOf(obj.customer_email) || await emailForCustomer(env, obj.customer);
    if (!email) return { action: "no-email", type };
    await rememberCustomer(env, obj.customer, email);
    const ends = (obj.lines?.data || []).map((l) => Number(l?.period?.end)).filter(Number.isFinite);
    const periodEnd = ends.length ? Math.max(...ends) : now + 366 * 24 * 3600;
    return { ...(await grant(env, email, periodEnd + STRIPE_GRACE_SECONDS, "invoice")), type };
  }
  if (type === "customer.subscription.deleted") {
    const email = await emailForCustomer(env, obj.customer);
    if (!email) return { action: "no-email", type };
    // Cancelling stops the renewal and leaves the paid period running: the
    // until is at most the period's end plus grace, and no less than it was
    // if that is already sooner.
    const end = Number(obj.current_period_end);
    return { ...(await shorten(env, email, (Number.isFinite(end) ? end : now) + STRIPE_GRACE_SECONDS)), type };
  }
  if (type === "charge.refunded" && obj.refunded) {
    const email = emailOf(obj.billing_details?.email) || await emailForCustomer(env, obj.customer);
    if (!email) return { action: "no-email", type };
    // A refund is the 14-day right the refund page states; the membership
    // ends with it.
    return { ...(await shorten(env, email, now - 1)), type };
  }
  return { action: "ignored", type };
}

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...extra },
});

/** CORS for the site's own origins, never `*`. */
function cors(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allow = String(env.RETURN_ORIGINS || "").split(/[,\s]+/).filter(Boolean);
  if (!allow.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  };
}

// ── a session, however somebody proved who they are ─────────────────────────

/** The week-long site token, in the FRAGMENT of the return address. */
async function issueSession(env, who, returnTo) {
  const holds = await membership(env, who.email);
  const now = Math.floor(Date.now() / 1000);
  // A session never outlives the membership behind it, and never runs more
  // than a week, so a lapsed member's own copy stops working without anybody
  // having to reach into their browser.
  const exp = Math.min(now + WEEK, holds ? holds.until : now + WEEK);
  const token = await sign({
    sub: who.email, email: who.email, name: who.name || "",
    member: !!holds, plan: holds?.plan || "explorer",
    iss: env.SELF_ORIGIN, aud: "site", iat: now, exp,
  }, env.JWT_SECRET);
  // In the FRAGMENT: not sent to any server, not logged, not in a Referer.
  const home = new URL(returnTo);
  home.hash = `token=${encodeURIComponent(token)}`;
  return Response.redirect(home.toString(), 302);
}

function failSession(returnTo, message) {
  const home = new URL(returnTo);
  home.hash = `auth-error=${encodeURIComponent(message || "Sign-in failed.")}`;
  return Response.redirect(home.toString(), 302);
}

// ── the email link: for the address on the receipt, whatever it is ──────────
//
// A member who paid with an Outlook, an iCloud or a university address has
// no Google and no GitHub to sign in through, and may have no Microsoft
// account behind that address either. The one thing every member certainly
// has is the mailbox Stripe sent the receipt to, so a signed, single-use link
// to that mailbox is the door that always exists. It is sent ONLY where the
// address holds a membership -- the service must not be a relay that will
// mail any address it is handed -- and the reply is the same sentence either
// way, so the endpoint cannot be used to ask which addresses are members.

export const LINK_SECONDS = 15 * 60;
export const LINK_THROTTLE_SECONDS = 60;
export const LINK_SENTENCE = "If that address holds a membership, a sign-in link is on its way — "
  + "check the inbox (and the junk folder) in the next few minutes. "
  + "Not a member yet? Membership is at /membership/.";

async function sendMail(env, to, subject, text) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!r.ok) throw new Error(`The mail service answered ${r.status}.`);
}

/** Send the link where it may be sent; true when one went. */
export async function sendSignInLink(env, email, returnTo) {
  const holds = await membership(env, email);
  if (!holds) return false;
  // One link a minute per address: a stranger typing a member's address into
  // the form must not be able to fill that member's inbox.
  if (await env.MEMBERS.get(`link:${email}`)) return false;
  await env.MEMBERS.put(`link:${email}`, "1", { expirationTtl: LINK_THROTTLE_SECONDS });
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({
    e: email, r: returnTo, jti: crypto.randomUUID(),
    aud: "link", iat: now, exp: now + LINK_SECONDS,
  }, env.JWT_SECRET);
  const link = `${env.SELF_ORIGIN}/auth/callback/email?token=${encodeURIComponent(token)}`;
  await sendMail(env, email, "Your GeoID sign-in link",
    `Follow this link to sign in to GeoID:\n\n${link}\n\n`
    + `It works once, for the next ${LINK_SECONDS / 60} minutes, and only in the browser it is opened in. `
    + "If you did not ask for it, nothing happens unless it is followed.\n");
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const head = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: head });

    // ── start ──────────────────────────────────────────────────────────────
    if (url.pathname === "/auth/start") {
      const name = url.searchParams.get("provider") || "google";
      const provider = PROVIDERS[name];
      if (!provider) return json({ error: "No such sign-in." }, 400, head);
      // The state IS a signed token carrying where to come back to, so there
      // is nothing to store and nothing to expire in KV; five minutes is
      // longer than any sign-in and shorter than any useful replay.
      const state = await sign({
        p: name,
        r: allowedReturn(env, url.searchParams.get("return") || ""),
        exp: Math.floor(Date.now() / 1000) + 300,
      }, env.JWT_SECRET);
      const go = new URL(provider.authorize);
      go.searchParams.set("client_id", provider.idFor(env));
      go.searchParams.set("redirect_uri", `${env.SELF_ORIGIN}/auth/callback/${name}`);
      go.searchParams.set("response_type", "code");
      go.searchParams.set("scope", provider.scope);
      go.searchParams.set("state", state);
      return Response.redirect(go.toString(), 302);
    }

    // ── the email link ─────────────────────────────────────────────────────
    if (url.pathname === "/auth/email") {
      if (request.method !== "POST") return json({ error: "POST only." }, 405, head);
      if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
        return json({ error: "Email sign-in is not set up on this service." }, 503, head);
      }
      let body = {};
      try { body = await request.json(); } catch (error) { return json({ error: "Not JSON." }, 400, head); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!looksLikeEmail(email)) return json({ error: "That is not an email address." }, 400, head);
      const returnTo = allowedReturn(env, String(body.return || ""));
      try {
        await sendSignInLink(env, email, returnTo);
      } catch (error) {
        return json({ error: "The mail service did not accept the message — try again in a minute." }, 502, head);
      }
      return json({ ok: true, message: LINK_SENTENCE }, 200, head);
    }
    if (url.pathname === "/auth/callback/email") {
      const claims = await verify(url.searchParams.get("token"), env.JWT_SECRET, { audience: "link" });
      if (!claims || !claims.e || !claims.r || !claims.jti) {
        return json({ error: "That sign-in link has expired — ask for another." }, 400, head);
      }
      // Single use: the link travels through a mailbox, and a mailbox is
      // forwarded, synced and backed up. What it can prove once it cannot
      // prove twice.
      if (await env.MEMBERS.get(`link-used:${claims.jti}`)) {
        return failSession(claims.r, "That sign-in link has already been used — ask for another.");
      }
      await env.MEMBERS.put(`link-used:${claims.jti}`, "1", { expirationTtl: LINK_SECONDS + 60 });
      return issueSession(env, { email: claims.e, name: "" }, claims.r);
    }

    // ── callback ───────────────────────────────────────────────────────────
    const back = url.pathname.match(/^\/auth\/callback\/([a-z]+)$/);
    if (back) {
      const provider = PROVIDERS[back[1]];
      const state = await verify(url.searchParams.get("state"), env.JWT_SECRET);
      if (!provider || !state || state.p !== back[1]) {
        return json({ error: "That sign-in has expired — start again." }, 400, head);
      }
      const code = url.searchParams.get("code");
      if (!code) return Response.redirect(state.r, 302);

      try {
        const body = new URLSearchParams({
          client_id: provider.idFor(env),
          client_secret: provider.secretFor(env),
          code,
          grant_type: "authorization_code",
          redirect_uri: `${env.SELF_ORIGIN}/auth/callback/${back[1]}`,
        });
        const res = await fetch(provider.token, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body,
        });
        const grant = await res.json();
        if (!grant.access_token) throw new Error("The sign-in was not completed.");

        const who = await provider.identify(grant.access_token);
        return issueSession(env, who, state.r);
      } catch (error) {
        return failSession(state.r, error.message);
      }
    }

    // ── who is this ────────────────────────────────────────────────────────
    if (url.pathname === "/auth/me") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const claims = await verify(token, env.JWT_SECRET, { audience: "site" });
      if (!claims) return json({ signedIn: false }, 200, head);
      // Re-read the entitlement rather than trusting the token's own copy: a
      // membership that lapsed or was granted since was decided here, not in
      // whatever the browser is still holding.
      const holds = await membership(env, claims.email);
      return json({
        signedIn: true, email: claims.email, name: claims.name,
        member: !!holds, plan: holds?.plan || "explorer",
        until: holds?.until || 0,
      }, 200, head);
    }

    // ── a short pass for the bucket ────────────────────────────────────────
    if (url.pathname === "/auth/data-token") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const claims = await verify(token, env.JWT_SECRET, { audience: "site" });
      const holds = claims && await membership(env, claims.email);
      if (!holds) return json({ error: "Not a member." }, 403, head);
      const now = Math.floor(Date.now() / 1000);
      /**
       * A SEPARATE, SHORT token, because this one travels in a URL.
       *
       * The bucket is read by three.js's texture loader and by geotiff's range
       * requests as well as by fetch, and only a query string reaches all
       * three. A query string is logged, so what is logged has to be worth
       * little: fifteen minutes, audience `data`, and it cannot be used to ask
       * who anybody is.
       */
      return json({
        token: await sign({ aud: "data", iat: now, exp: now + DATA_TOKEN_SECONDS },
          env.JWT_SECRET),
        expires: now + DATA_TOKEN_SECONDS,
      }, 200, head);
    }

    // ── Stripe ─────────────────────────────────────────────────────────────
    if (url.pathname === "/stripe/webhook") {
      if (request.method !== "POST") return json({ error: "POST only." }, 405);
      if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "No webhook secret is set on this service." }, 503);
      const raw = await request.text();
      const ok = await stripeSignatureValid(raw, request.headers.get("Stripe-Signature") || "", env.STRIPE_WEBHOOK_SECRET);
      if (!ok) return json({ error: "Bad signature." }, 400);
      let event = null;
      try { event = JSON.parse(raw); } catch (e) { return json({ error: "Not JSON." }, 400); }
      if (!env.MEMBERS) return json({ error: "No members list is bound." }, 503);
      const did = await applyStripeEvent(env, event);
      // Never the address back to the caller: Stripe does not need it and a
      // log line is not the place for one. The action and the type are enough
      // to read a delivery's outcome in the Stripe dashboard.
      return json({ received: true, action: did.action, type: did.type || "" }, 200);
    }

    return json({ error: "No such endpoint." }, 404, head);
  },
};
